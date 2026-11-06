// 作る（生成 run・派生 run。契約 contract-T T-4・T-7・T-9）。
// 順序: 入・切 → run を取る（取り置き + run の行を 1 つの条件付き batch）→ 入力（RSS・既存の題・親）→ Messages API 1 回（再送なし・絶対の締め切り）
//       → 応答の保存（全部の文が run の述語を持つ 1 つの batch。最後の文が run を done / failed にする）。
// ログは run id と状態名・件数だけ。RSS の本文・モデルの出力は log に入れない。
// v2.6: 取る（reserveTopicRun）と走る（runTaken）を分けた。cron は続けて呼ぶ（runTopicRun）。手動は route が取り、queue の受け手が走る（executeTopicRun）。
// v2.7: 呼び出しは 1 回 + 続き（pause_turn・結果の無いサーバーツール・end_turn への催促 1 回）を合計 3 回まで。回数・締め切り・費用（取り置き額）の 3 つで有限。
//       呼び出しごとに {at:'topic_call'} を 1 行（数と種類だけ。本文は出さない）。台帳は実額で精算する。

import type { Message, MessageCreateParamsNonStreaming, MessageParam, Tool } from '@anthropic-ai/sdk/resources/messages/messages';
import { PortError, type CallOpts, type FactoryPort } from '../anthropic';
import { all, cas, conditionalBatch, isUniqueViolation, nowIso, prepare, stmt, tokyoDay, type Stmt } from '../db';
import { cfg, type Env } from '../env';
import { TOPIC_FEEDS } from '../generated/topic-sources';
import { microToCents, sonnetMicroDollars, WEB_SEARCH_CENTS } from '../ledger';
import { acceptableFeedType, parseFeed } from '../scout';
import { checkSourceUrl, quoteOutcome } from './fetch-source';
import { TOPIC_KIND_LABELS, type TopicKind } from './locale';
import { EXTEND_KIND_LABEL, genSystem, genUserBlocks, SAVE_TOPICS_TOOL_NAME, type FeedHeadline } from './prompts';
import { addDays, isRealDate, TOPIC_BODY_JSON_SCHEMA, validateTopicBody, type TopicBody } from './schema';
import {
  deriveReserveStmt,
  existingTitles,
  genLedgerRef,
  genReserveStmt,
  insertTopicStmts,
  isTopicKind,
  ledgerSettleActualStmt,
  mondayOf,
  overReserveStmt,
  readRun,
  readTopic,
  runCancelStmts,
  runPred,
  RUN_LEASE_MS,
  TOPIC_GEN_MAX_TOKENS,
  TOPIC_GEN_TIMEOUT_MS,
  TOPIC_NEWS_PER_RUN,
  TOPIC_PHILO_PER_RUN,
  TOPIC_WEB_FETCH_MAX_CONTENT_TOKENS,
  TOPIC_WEB_FETCH_MAX_USES,
  TOPIC_WEB_SEARCH_MAX_USES,
  TOPIC_WEEKLY_PER_RUN,
  topicsEnabled,
  type NewTopic,
  type RunDbRow,
  type TopicDbRow,
} from './store';

export type RunRequest =
  | { purpose: 'gen'; kind: TopicKind; trigger: 'cron' | 'manual'; slotDay: string }
  | { purpose: 'derive'; kind: 'refresh' | 'extend'; trigger: 'cron' | 'manual'; parentId: string; note?: string | null };

export type NotTakenReason = 'disabled' | 'no_time' | 'run_in_progress' | 'exists' | 'parent_not_eligible' | 'week_cap' | 'cap';

export type RunOutcome =
  | { status: 'not_taken'; reason: NotTakenReason; run?: RunDbRow }
  | { status: 'done' | 'failed'; run: RunDbRow };

export interface RunOptions {
  /** 絶対の締め切り（epoch ms。cron の締め切りか、手動の上限）。呼び出しの締め切りは min(これ, 今 + TOPIC_GEN_TIMEOUT_MS) */
  deadline: number;
  fetchImpl: typeof fetch;
  now?: Date;
}

const DERIVE_CHILD_KINDS: readonly TopicKind[] = ['talk', 'philo', 'make'];

/** お題の呼び出しの前に要る、締め切りまでの残り（v2.4 の裁定 7。これ未満なら呼ばない・取り置きもしない。次の tick に回す） */
export const TOPIC_CALL_MIN_LEFT_MS = 5_000;

/** 続きの呼び出しを始めるのに要る、締め切りまでの残り（呼ばない境界 TOPIC_CALL_MIN_LEFT_MS + 余裕 25 秒。v2.7） */
export const TOPIC_CONTINUE_MIN_LEFT_MS = TOPIC_CALL_MIN_LEFT_MS + 25_000;
/** 続きの呼び出しの回数の上限（最初の呼び出しを入れて 4 回。v2.7） */
export const TOPIC_GEN_MAX_CONTINUES = 3;
/** end_turn で save_topics が無い時に 1 回だけ足す催促（v2.7。tools は変えない = キャッシュを残す） */
export const TOPIC_SAVE_NUDGE = 'ここまでに開けたページだけで、作れる本数だけ save_topics を呼んでください。1 本も作れない時は topics: [] で呼んでください。';

/** 1 run の最大本数（T-4・T-9。v2.7: philo は 2） */
export function runMaxCount(req: RunRequest): number {
  if (req.purpose === 'derive') return 1;
  return req.kind === 'news' ? TOPIC_NEWS_PER_RUN : req.kind === 'philo' ? TOPIC_PHILO_PER_RUN : TOPIC_WEEKLY_PER_RUN;
}

// ---------------------------------------------------------------------------------------------
// RSS（news の入力。T-4: 最大 8 本・1 本 256 KiB・1 本 5 秒。URL とリダイレクト先に T-5 の URL の規則。直近 3 日・最大 40 件）

export const TOPIC_FEED_LIMITS = { feeds: 8, bytes: 256 * 1024, timeoutMs: 5_000, days: 3, items: 40, maxRedirects: 3 } as const;

async function readCappedText(res: Response, maxBytes: number): Promise<string | null> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder().decode(buf);
}

const FEED_XML_TYPES = new Set(['application/rdf+xml']);

async function fetchFeed(url: string, fetchImpl: typeof fetch, deadline: number): Promise<string | null> {
  let target = checkSourceUrl(url);
  if (!target) return null;
  const ms = Math.min(TOPIC_FEED_LIMITS.timeoutMs, deadline - Date.now());
  if (ms < 500) return null;
  const signal = AbortSignal.timeout(ms);
  try {
    for (let hop = 0; ; hop++) {
      const res = await fetchImpl(target.toString(), { redirect: 'manual', signal, headers: { accept: 'application/rss+xml, application/atom+xml, application/rdf+xml, application/xml, text/xml' } });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        await res.body?.cancel().catch(() => undefined);
        if (!loc || hop >= TOPIC_FEED_LIMITS.maxRedirects) return null;
        const next = checkSourceUrl(new URL(loc, target).toString());
        if (!next) return null;
        target = next;
        continue;
      }
      const ct = res.headers.get('content-type');
      if (res.status < 200 || res.status >= 300 || !(acceptableFeedType(ct) || FEED_XML_TYPES.has((ct ?? '').split(';')[0].trim().toLowerCase()))) {
        await res.body?.cancel().catch(() => undefined);
        return null;
      }
      return await readCappedText(res, TOPIC_FEED_LIMITS.bytes);
    }
  } catch {
    return null;
  }
}

/** news の資料: RSS を順に開き（1 本 5 秒まで）、直近 3 日（今 + 1 日より先は捨てる）の見出し・リンク・日付を新しい順に最大 40 件（開けない RSS は飛ばす） */
export async function fetchHeadlines(fetchImpl: typeof fetch, deadline: number, now: Date, feeds: readonly string[] = TOPIC_FEEDS): Promise<FeedHeadline[]> {
  const since = new Date(now.getTime() - TOPIC_FEED_LIMITS.days * 86_400_000).toISOString();
  // 今より 1 日を超えて先の日付は捨てる（v2.4 の裁定 8: 未来の日付が直近の記事を押し出さない）
  const until = new Date(now.getTime() + 86_400_000).toISOString();
  const texts: Array<string | null> = [];
  for (const u of feeds.slice(0, TOPIC_FEED_LIMITS.feeds)) texts.push(await fetchFeed(u, fetchImpl, deadline));
  const items: FeedHeadline[] = [];
  texts.forEach((xml, i) => {
    if (xml === null) return;
    for (const it of parseFeed(xml, i)) {
      if (!it.date || it.date < since || it.date > until || !it.title) continue;
      items.push({ title: it.title.slice(0, 200), link: it.link && checkSourceUrl(it.link) ? it.link : null, date: it.date });
    }
  });
  items.sort((a, b) => (a.date! < b.date! ? 1 : a.date! > b.date! ? -1 : 0));
  return items.slice(0, TOPIC_FEED_LIMITS.items);
}

// ---------------------------------------------------------------------------------------------
// 応答の読み取り

type AnyBlock = { type?: unknown; id?: unknown; name?: unknown; input?: unknown; tool_use_id?: unknown; content?: unknown };

/** 末尾の / だけを吸収した完全一致（T-4: http→https の同一視や、それ以外の違いの吸収はしない） */
export const sameUrl = (a: string, b: string): boolean => a.replace(/\/+$/, '') === b.replace(/\/+$/, '');

/** 応答の中の web_fetch の結果: [呼び出しの URL, 本文]（本文が text の結果だけ。エラーの結果は入れない） */
export function genFetchTexts(content: readonly unknown[]): Array<{ url: string; text: string }> {
  const urlById = new Map<string, string>();
  const out: Array<{ url: string; text: string }> = [];
  for (const raw of content) {
    const b = raw as AnyBlock;
    if (!b || typeof b !== 'object') continue;
    if (b.type === 'server_tool_use' && b.name === 'web_fetch' && typeof b.id === 'string') {
      const u = (b.input as { url?: unknown } | undefined)?.url;
      if (typeof u === 'string') urlById.set(b.id, u);
    } else if (b.type === 'web_fetch_tool_result' && typeof b.tool_use_id === 'string') {
      const url = urlById.get(b.tool_use_id);
      const c = b.content as { type?: unknown; content?: { source?: { type?: unknown; data?: unknown } } } | undefined;
      if (url === undefined || !c || c.type !== 'web_fetch_result') continue;
      const src = c.content?.source;
      if (src && src.type === 'text' && typeof src.data === 'string') out.push({ url, text: src.data });
    }
  }
  return out;
}

/** 出典ごとに、同じ URL の web_fetch の結果に引用があるか（T-4）。source_id → 抜き書き */
export function matchGenFetch(body: TopicBody, fetched: ReadonlyArray<{ url: string; text: string }>): Map<string, string> {
  const out = new Map<string, string>();
  for (const s of body.sources) {
    for (const f of fetched) {
      if (!sameUrl(f.url, s.url)) continue;
      const r = quoteOutcome(f.text, s.quote);
      if (r.result === 'found' && r.excerpt) {
        out.set(s.id, r.excerpt);
        break;
      }
    }
  }
  return out;
}

/** 実額（セント）: トークンの定価 + web_search 1 回 1 セント（T-6） */
export function genActualCents(msg: Pick<Message, 'usage'>): number {
  const u = msg.usage as (Message['usage'] & { server_tool_use?: { web_search_requests?: number } | null }) | undefined;
  const searches = Number(u?.server_tool_use?.web_search_requests ?? 0);
  return microToCents(sonnetMicroDollars(u)) + (Number.isFinite(searches) && searches > 0 ? searches * WEB_SEARCH_CENTS : 0);
}

type RawBlock = { type?: unknown; id?: unknown; name?: unknown; tool_use_id?: unknown; content?: unknown };
const SERVER_RESULT_TYPES = new Set(['web_fetch_tool_result', 'web_search_tool_result']);

/** 応答に、結果の付いていない web_fetch / web_search の server_tool_use があるか（数えるだけ。ログ用） */
export function hasPendingServerTool(content: readonly unknown[]): boolean {
  const blocks = content as RawBlock[];
  return blocks.some(
    (b) =>
      !!b &&
      b.type === 'server_tool_use' &&
      (b.name === 'web_fetch' || b.name === 'web_search') &&
      !blocks.some((x) => !!x && typeof x.type === 'string' && SERVER_RESULT_TYPES.has(x.type) && x.tool_use_id === b.id),
  );
}

/**
 * 続きにする「サーバーツールの途中」（verify.ts の isPendingWebFetch と同じ判定を web_search にも広げた）:
 * 結果の付いていない web_fetch / web_search があり、client tool の tool_use が混ざっていない
 */
export function isPendingServerTool(content: readonly unknown[]): boolean {
  if ((content as RawBlock[]).some((b) => !!b && b.type === 'tool_use')) return false;
  return hasPendingServerTool(content);
}

const SAFE_CODE = /^[a-z_]{1,40}$/;

/** 1 回の呼び出しのログの数（本文・URL は入れない。種類の名前と数だけ） */
export function topicCallStats(msg: Pick<Message, 'content' | 'usage' | 'stop_reason'>): {
  stop_reason: string;
  in: number;
  out: number;
  cache_w: number;
  cache_r: number;
  searches: number;
  fetches: number;
  fetch_errors: Record<string, number>;
  blocks: Record<string, number>;
  pending_server_tool: boolean;
} {
  const u = (msg.usage ?? {}) as Partial<Message['usage']> & { server_tool_use?: { web_search_requests?: number; web_fetch_requests?: number } | null };
  const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
  const fetchErrors: Record<string, number> = {};
  const blocks: Record<string, number> = {};
  let fetchUses = 0;
  for (const raw of msg.content as unknown as RawBlock[]) {
    if (!raw || typeof raw !== 'object') continue;
    const t = typeof raw.type === 'string' && SAFE_CODE.test(raw.type) ? raw.type : 'unknown';
    blocks[t] = (blocks[t] ?? 0) + 1;
    if (raw.type === 'server_tool_use' && raw.name === 'web_fetch') fetchUses++;
    if (raw.type === 'web_fetch_tool_result') {
      const c = raw.content as { type?: unknown; error_code?: unknown } | null;
      if (c?.type === 'web_fetch_tool_result_error') {
        const code = typeof c.error_code === 'string' && SAFE_CODE.test(c.error_code) ? c.error_code : 'unknown';
        fetchErrors[code] = (fetchErrors[code] ?? 0) + 1;
      }
    }
  }
  const stop = typeof msg.stop_reason === 'string' && SAFE_CODE.test(msg.stop_reason) ? msg.stop_reason : String(msg.stop_reason === null ? 'null' : 'unknown');
  return {
    stop_reason: stop,
    in: n(u.input_tokens),
    out: n(u.output_tokens),
    cache_w: n(u.cache_creation_input_tokens),
    cache_r: n(u.cache_read_input_tokens),
    searches: n(u.server_tool_use?.web_search_requests),
    fetches: u.server_tool_use?.web_fetch_requests !== undefined ? n(u.server_tool_use?.web_fetch_requests) : fetchUses,
    fetch_errors: fetchErrors,
    blocks,
    pending_server_tool: hasPendingServerTool(msg.content as unknown[]),
  };
}

/** 失敗の理由コードと、課金なしと分かる失敗か（T-6: 429・quota・認証・その他の 4xx は 0。5xx・応答不明は取り置き額のまま） */
export function classifyCallError(e: unknown): { code: string; noCharge: boolean; responded: boolean; status?: number; detail?: string } {
  if (e instanceof PortError) {
    if (e.responded && typeof e.status === 'number') {
      const s = e.status;
      const code = s === 429 ? 'rate_limited' : s === 401 || s === 403 ? 'auth' : s === 400 ? 'bad_request' : s === 402 ? 'quota' : s === 529 ? 'overloaded' : s >= 500 ? 'server' : `http_${s}`;
      return { code, noCharge: s >= 400 && s < 500, responded: true, status: s, detail: e.detail };
    }
    return { code: e.kind === 'timeout' ? 'timeout' : e.kind === 'connection' ? 'connection' : 'unknown', noCharge: false, responded: false };
  }
  return { code: 'internal', noCharge: false, responded: false };
}

// ---------------------------------------------------------------------------------------------
// 本体

function runFinishStmt(p: { runId: string; token: string; now: string; status: 'done' | 'failed'; error: string | null; made: number; dropped: number }): Stmt {
  return stmt(
    `UPDATE topic_runs SET status = ?, error = ?, made = ?, dropped = ?, cents = COALESCE((SELECT cents FROM cost_ledger WHERE kind = 'topic' AND ref_id = ?), 0), updated_at = ?
     WHERE id = ? AND status = 'calling' AND token = ? AND lease_until > ?`,
    p.status,
    p.error,
    p.made,
    p.dropped,
    genLedgerRef(p.runId),
    p.now,
    p.runId,
    p.token,
    p.now,
  );
}

async function diagnose(env: Env, req: RunRequest, slotDay: string, week: string, parent: TopicDbRow | null): Promise<NotTakenReason> {
  const db = env.DB;
  if (!(await topicsEnabled(db))) return 'disabled';
  const calling = await all(db, stmt("SELECT 1 FROM topic_runs WHERE purpose = ? AND kind = ? AND status = 'calling' LIMIT 1", req.purpose, req.kind));
  if (calling.length) return 'run_in_progress';
  if (req.trigger === 'cron') {
    const dup =
      req.purpose === 'gen'
        ? await all(db, stmt("SELECT 1 FROM topic_runs WHERE purpose = 'gen' AND trigger = 'cron' AND kind = ? AND slot_day = ? LIMIT 1", req.kind, slotDay))
        : await all(db, stmt("SELECT 1 FROM topic_runs WHERE purpose = 'derive' AND trigger = 'cron' AND parent_topic_id = ? AND kind = ? AND slot_day = ? LIMIT 1", req.parentId, req.kind, slotDay));
    if (dup.length) return 'exists';
  }
  if (req.purpose === 'derive') {
    if (!parent || !(await parentEligible(db, parent, req.kind))) return 'parent_not_eligible';
    if (req.trigger === 'cron') {
      const n = await all<{ n: number }>(db, stmt("SELECT COUNT(*) AS n FROM topic_runs WHERE purpose = 'derive' AND trigger = 'cron' AND week = ?", week));
      if (Number(n[0]?.n ?? 0) >= cfg(env).topicDerivePerWeek) return 'week_cap';
    }
  }
  return 'cap';
}

/** 親にできるか（T-9。run を取る文の述語と同じ条件を読むだけ。画面と診断に使う） */
export async function parentEligible(db: D1Database, p: Pick<TopicDbRow, 'id' | 'status' | 'hold_reason' | 'depth'>, kind: 'refresh' | 'extend'): Promise<boolean> {
  if (Number(p.depth) >= 5) return false;
  if (kind === 'refresh') {
    if (!(p.status === 'ready' || (p.status === 'held' && (p.hold_reason === 'source_lost' || p.hold_reason === 'source_unreachable')))) return false;
    const live = await all(db, stmt("SELECT 1 FROM topics WHERE parent_topic_id = ? AND derive_kind = 'refresh' AND status IN ('draft','checking','held','ready') LIMIT 1", p.id));
    return live.length === 0;
  }
  if (p.status !== 'ready') return false;
  const n = await all<{ n: number }>(db, stmt("SELECT COUNT(*) AS n FROM topics WHERE parent_topic_id = ? AND derive_kind = 'extend'", p.id));
  return Number(n[0]?.n ?? 0) < 2;
}

/** 取った run（取る → 走るへ渡すもの）。slotDay は run の行の slot_day・today は取った日（Asia/Tokyo） */
export interface TakenRun {
  runId: string;
  token: string;
  slotDay: string;
  today: string;
  parent: TopicDbRow | null;
}

export type ReserveOutcome = { status: 'taken'; taken: TakenRun } | { status: 'not_taken'; reason: NotTakenReason; run?: RunDbRow };

/** 生成・派生の run を 1 つ走らせる（cron が呼ぶ。取る → 走るを続けて行う。手動は取る + queue = v2.6） */
export async function runTopicRun(env: Env, port: FactoryPort, req: RunRequest, opts: RunOptions): Promise<RunOutcome> {
  const r = await reserveTopicRun(env, req, opts);
  if (r.status === 'not_taken') return r;
  return runTaken(env, port, req, r.taken, opts);
}

/** 受け手の「走る」の選択肢。fetch は入力づくりの前に読む（読めない時も input_failed で閉じるため） */
export interface ExecuteOptions {
  deadline: number;
  loadFetch: () => Promise<typeof fetch>;
  now?: Date;
}

/**
 * 走る（queue の受け手の入口。v2.6）。最初に run の行を読み、calling・token 一致・lease 内・要求の中身と一致の時だけ走る。
 * そうでなければ何もしない（重複配送・掃除済み・取り消し済み）→ { status: 'stale' }。
 * モデルを呼ぶ前の例外（行の読み取り・回し替え・fetch・親の読み取り）は failed: input_failed・台帳 0 で閉じる（呼んでいないので 0。司令塔の裁定）
 */
export async function executeTopicRun(
  env: Env,
  port: FactoryPort,
  runId: string,
  token: string,
  req: RunRequest,
  opts: ExecuteOptions,
): Promise<RunOutcome | { status: 'stale' }> {
  const db = env.DB;
  const nowMs = (opts.now ?? new Date()).getTime();
  // 今の行の token（回し替えの前は message の token・後は新しい token）。閉じる文の述語に使う
  let current = token;
  let taken: TakenRun;
  let fetchImpl: typeof fetch;
  try {
    const row = await readRun(db, runId);
    if (!row || row.status !== 'calling' || row.token !== token || !(Date.parse(row.lease_until) > nowMs)) return { status: 'stale' };
    const same =
      row.purpose === req.purpose &&
      row.kind === req.kind &&
      row.trigger === req.trigger &&
      (req.purpose === 'gen' ? row.slot_day === req.slotDay : row.parent_topic_id === req.parentId);
    if (!same) return { status: 'stale' };
    // token の回し替え（司令塔の裁定。モデルを呼ぶ前に 1 文の CAS）: 通った 1 回だけが新しい token で走る。
    // 再配送（ack の前に呼び出しが落ちた・走っている途中に届いた）は古い token なので、ここか上の照合で stale になり、モデルを 2 回呼ばない。
    // 同じ文で lease を今 + 15 分に延ばす（queue の遅れで保存の述語が lease 切れになる経路を消す。届いた時に切れていれば上で stale）。
    // 以後の runPred / runFinishStmt / finishFailed はすべて新しい token（述語の意味は変えない）
    const fresh = crypto.randomUUID();
    const rotated = await cas(
      db,
      stmt(
        "UPDATE topic_runs SET token = ?, lease_until = ? WHERE id = ? AND token = ? AND status = 'calling' AND lease_until > ?",
        fresh,
        new Date(nowMs + RUN_LEASE_MS).toISOString(),
        runId,
        token,
        nowIso(new Date(nowMs)),
      ),
    );
    if (!rotated) return { status: 'stale' };
    current = fresh;
    fetchImpl = await opts.loadFetch();
    // 派生の親が読めなければ parent = null のまま走り、入力づくりで input_failed になる（calling を残さない）
    const parent = req.purpose === 'derive' ? await readTopic(db, req.parentId) : null;
    // 派生の slot_day は取った日（runTopicRun の today と同じ値）
    taken = { runId, token: fresh, slotDay: row.slot_day, today: row.slot_day, parent };
  } catch (e) {
    console.log(JSON.stringify({ at: 'topic_run', run_id: runId, input_error: e instanceof Error ? e.name : 'error' }));
    const run = await closeFailed(db, runId, current, 'input_failed', { noCharge: true });
    return run ? { status: 'failed', run } : { status: 'stale' };
  }
  return runTaken(env, port, req, taken, { deadline: opts.deadline, fetchImpl, now: opts.now });
}

/**
 * run を failed で閉じる（述語は run の calling・token・lease）。台帳: noCharge なら 0・actualCents があれば実額（応答の後の失敗。v2.6）・どちらでもなければ取り置き額のまま。
 * この batch 自身が投げた時は run_id とコードだけをログに出して投げ直す（calling は lease 切れの掃除が閉じる）。行が無ければ null
 */
async function closeFailed(
  db: D1Database,
  runId: string,
  token: string,
  code: string,
  charge: { noCharge: boolean; actualCents?: number },
  made = 0,
  dropped = 0,
  /** run の終わりのログに足す数（v2.7: 呼び出しの回数と実額） */
  extra?: { turns: number; cents: number },
): Promise<RunDbRow | null> {
  const ref = genLedgerRef(runId);
  const t = nowIso();
  const P = runPred(runId, token, t);
  const stmts: Stmt[] = [];
  // 確定は実額そのもの（v2.7。取り置き額で丸めない。超えた時の topic_over_reserve は今のまま）
  if (charge.noCharge) stmts.push(ledgerSettleActualStmt(ref, 0, P));
  else if (charge.actualCents !== undefined) stmts.push(overReserveStmt(ref, charge.actualCents, t, P), ledgerSettleActualStmt(ref, charge.actualCents, P));
  stmts.push(runFinishStmt({ runId, token, now: t, status: 'failed', error: code, made, dropped }));
  try {
    await conditionalBatch(db, stmts);
  } catch (e) {
    console.log(JSON.stringify({ at: 'topic_run', run_id: runId, finish_failed: code }));
    throw e;
  }
  const run = await readRun(db, runId);
  console.log(JSON.stringify({ at: 'topic_run', run_id: runId, status: run?.status ?? null, error: run?.error ?? null, ...(extra ?? {}) }));
  return run;
}

const RUN_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PARENT_ID_RE = /^tp_[A-Za-z0-9_-]{1,100}$/;

/**
 * queue の message（{ t: 'topic_run', run_id, token, req }）を確かめて読む（v2.6。中身は信用しない）。
 * 形が違えば null（受け手は ack して捨てる）。行との照合は executeTopicRun が行う
 */
export function parseTopicRunMessage(body: unknown): { runId: string; token: string; req: RunRequest } | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as { t?: unknown; run_id?: unknown; token?: unknown; req?: unknown };
  if (b.t !== 'topic_run' || typeof b.run_id !== 'string' || !RUN_ID_RE.test(b.run_id)) return null;
  if (typeof b.token !== 'string' || !RUN_ID_RE.test(b.token)) return null;
  const r = b.req as { purpose?: unknown; kind?: unknown; trigger?: unknown; slotDay?: unknown; parentId?: unknown; note?: unknown } | null;
  if (!r || typeof r !== 'object' || (r.trigger !== 'manual' && r.trigger !== 'cron')) return null;
  if (r.purpose === 'gen') {
    if (!isTopicKind(r.kind) || !isRealDate(r.slotDay)) return null;
    return { runId: b.run_id, token: b.token, req: { purpose: 'gen', kind: r.kind, trigger: r.trigger, slotDay: r.slotDay } };
  }
  if (r.purpose === 'derive') {
    if ((r.kind !== 'refresh' && r.kind !== 'extend') || typeof r.parentId !== 'string' || !PARENT_ID_RE.test(r.parentId)) return null;
    if (r.note !== undefined && r.note !== null && (typeof r.note !== 'string' || Array.from(r.note).length > 200)) return null;
    const note = typeof r.note === 'string' ? r.note : null;
    return { runId: b.run_id, token: b.token, req: { purpose: 'derive', kind: r.kind, trigger: r.trigger, parentId: r.parentId, note } };
  }
  return null;
}

/** 取る（v2.6）: 有効か・時間・親・台帳の取り置き + 'calling' の行の INSERT（1 つの条件付き batch）。取れない時は理由（cron の cap は skipped の行） */
export async function reserveTopicRun(env: Env, req: RunRequest, opts: Pick<RunOptions, 'deadline' | 'now'>): Promise<ReserveOutcome> {
  const db = env.DB;
  const c = cfg(env);
  const now = opts.now ?? new Date();
  const t0 = nowIso(now);
  const today = tokyoDay(now);
  if (!(await topicsEnabled(db))) return { status: 'not_taken', reason: 'disabled' };
  if (opts.deadline - Date.now() < TOPIC_CALL_MIN_LEFT_MS) return { status: 'not_taken', reason: 'no_time' };

  const parent = req.purpose === 'derive' ? await readTopic(db, req.parentId) : null;
  if (req.purpose === 'derive' && !parent) return { status: 'not_taken', reason: 'parent_not_eligible' };
  const slotDay = req.purpose === 'gen' ? req.slotDay : today;
  const week = mondayOf(today);
  const runId = crypto.randomUUID();
  const token = crypto.randomUUID();
  const ref = genLedgerRef(runId);
  const base = { env, ledgerId: crypto.randomUUID(), day: today, cents: c.topicGenReserveCents, now: t0, runId, trigger: req.trigger, slotDay };
  const reserve = req.purpose === 'gen' ? genReserveStmt({ ...base, kind: req.kind }) : deriveReserveStmt({ ...base, kind: req.kind, week, parentId: req.parentId });
  const insertRun = stmt(
    `INSERT INTO topic_runs (id, purpose, kind, slot_day, week, parent_topic_id, trigger, status, error, dropped, made, cents, token, lease_until, created_at, updated_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, 'calling', NULL, 0, 0, 0, ?, ?, ?, ?
     WHERE EXISTS (SELECT 1 FROM cost_ledger WHERE kind = 'topic' AND ref_id = ?)`,
    runId,
    req.purpose,
    req.kind,
    slotDay,
    req.purpose === 'derive' ? week : null,
    req.purpose === 'derive' ? req.parentId : null,
    req.trigger,
    token,
    new Date(now.getTime() + RUN_LEASE_MS).toISOString(),
    t0,
    t0,
    ref,
  );
  let taken = false;
  try {
    taken = (await conditionalBatch(db, [reserve, insertRun])).ok;
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    taken = false; // 一意制約に当たった batch は全体が巻き戻る（台帳も run も増えない）
  }
  if (!taken) {
    const reason = await diagnose(env, req, slotDay, week, parent);
    if (reason === 'cap' && req.trigger === 'cron') {
      // 上限で取れなかった時だけ skipped: cap を 1 行（同じ日にもう試さない。一意キーで重なれば足さない）
      try {
        await prepare(
          db,
          stmt(
            `INSERT INTO topic_runs (id, purpose, kind, slot_day, week, parent_topic_id, trigger, status, error, dropped, made, cents, token, lease_until, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 'cron', 'skipped', 'cap', 0, 0, 0, ?, ?, ?, ?)`,
            runId,
            req.purpose,
            req.kind,
            slotDay,
            req.purpose === 'derive' ? week : null,
            req.purpose === 'derive' ? req.parentId : null,
            token,
            t0,
            t0,
            t0,
          ),
        ).run();
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
      }
      const run = await readRun(db, runId);
      console.log(JSON.stringify({ at: 'topic_run', run_id: runId, status: 'skipped', reason }));
      return { status: 'not_taken', reason, ...(run ? { run } : {}) };
    }
    return { status: 'not_taken', reason };
  }
  return { status: 'taken', taken: { runId, token, slotDay, today, parent } };
}

/** 走る（入力づくり → 呼び出し（+ 続き。v2.7）→ 保存）。取った run を必ず done / failed で閉じる（保存中の例外は save_failed。v2.6） */
async function runTaken(env: Env, port: FactoryPort, req: RunRequest, taken: TakenRun, opts: RunOptions): Promise<RunOutcome> {
  const db = env.DB;
  const c = cfg(env);
  const now = opts.now ?? new Date();
  const { runId, token, slotDay, today, parent } = taken;
  const ref = genLedgerRef(runId);

  /** failed で閉じる（closeFailed）。台帳: noCharge なら 0・actualCents があれば実額・どちらでもなければ取り置き額のまま */
  const finishFailed = async (code: string, noCharge: boolean, made = 0, dropped = 0, actualCents?: number, extra?: { turns: number; cents: number }): Promise<RunOutcome> => {
    const run = (await closeFailed(db, runId, token, code, { noCharge, actualCents }, made, dropped, extra))!;
    return { status: 'failed', run };
  };

  // 入力
  let params: MessageCreateParamsNonStreaming;
  let parentBody: TopicBody | null = null;
  try {
    const count = runMaxCount(req);
    let system: string;
    let headlines: FeedHeadline[] | undefined;
    let titles: string[];
    let lostSources: Array<{ url: string; name: string }> | undefined;
    let kindLabel: string;
    if (req.purpose === 'gen') {
      system = genSystem({ kind: req.kind }, count);
      kindLabel = TOPIC_KIND_LABELS[req.kind];
      if (req.kind === 'news') headlines = await fetchHeadlines(opts.fetchImpl, opts.deadline, now);
      titles = await existingTitles(db, [req.kind]);
    } else {
      parentBody = JSON.parse(parent!.body_json) as TopicBody;
      if (req.kind === 'refresh') {
        system = genSystem({ derive: 'refresh', parentKind: parent!.kind }, count);
        kindLabel = TOPIC_KIND_LABELS[parent!.kind];
        titles = await existingTitles(db, [parent!.kind]);
        lostSources = await all<{ url: string; name: string }>(
          db,
          stmt("SELECT url, name FROM topic_sources WHERE topic_id = ? AND fetch_result IN ('not_found','fetch_failed','blocked') ORDER BY source_id", parent!.id),
        );
      } else {
        system = genSystem({ derive: 'extend' }, count);
        kindLabel = EXTEND_KIND_LABEL;
        titles = await existingTitles(db, DERIVE_CHILD_KINDS);
      }
    }
    params = {
      model: c.topicGenModel,
      max_tokens: TOPIC_GEN_MAX_TOKENS,
      system,
      messages: [
        {
          role: 'user',
          content: genUserBlocks({
            headlines,
            existingTitles: titles,
            ...(parentBody ? { parentBody } : {}),
            lostSources,
            note: req.purpose === 'derive' ? (req.note ?? null) : null,
            kindLabel,
            count,
            slotDay: req.purpose === 'gen' ? slotDay : addDays(today, 1),
          }),
        },
      ],
      tools: [
        { type: 'web_search_20250305', name: 'web_search', max_uses: TOPIC_WEB_SEARCH_MAX_USES },
        { type: 'web_fetch_20250910', name: 'web_fetch', max_uses: TOPIC_WEB_FETCH_MAX_USES, max_content_tokens: TOPIC_WEB_FETCH_MAX_CONTENT_TOKENS },
        {
          name: SAVE_TOPICS_TOOL_NAME,
          description:
            'できあがったお題を保存します。最後に 1 回だけ呼びます。topics は本文の配列で、形は schema のとおりです。出典（sources）は web_fetch で開けたページだけで、quote はそのページの文を一字も変えずに写します。',
          input_schema: { type: 'object', additionalProperties: false, required: ['topics'], properties: { topics: { type: 'array', items: TOPIC_BODY_JSON_SCHEMA } } } as unknown as Tool['input_schema'],
          // strict は付けない: 本番で 400「The compiled grammar is too large」（v2.5 の裁定。CONTRACT-factory §T 末尾）。
          // 形は保証されないので、Worker の validateTopicBody が 1 本ずつ確かめ、合わない本は捨てる（dropped）
          // v2.7: tools の最後に cache_control。1 つでもあると API がサーバーツールの結果ごとにキャッシュの区切りを自動で置き、
          // ループの後半・続きの呼び出しは伸びた前半をキャッシュから読む（0.05 倍）。tools は続きでも変えない（変えるとキャッシュが全部無効）
          cache_control: { type: 'ephemeral' },
        },
      ],
      // 強制呼び出しはしない（Sonnet 5.5 は tool_choice any / tool が 400。CONTRACT-factory §T 末尾）。auto。無ければ no_output
      tool_choice: { type: 'auto' },
    };
  } catch {
    // モデルを呼ぶ前の失敗は台帳 0（司令塔の裁定。cron も同じ）
    return finishFailed('input_failed', true);
  }

  // 最初の呼び出しの前: 入力（RSS）の後で残りが 5 秒未満なら呼ばない。
  // 外部（モデル）を 1 回も呼んでいないので、run の行と取り置きの台帳の行を削除して取り消す（その日の枠を消費しない。次の tick がまた取れる。v2.4 の裁定 7）
  if (opts.deadline - Date.now() < TOPIC_CALL_MIN_LEFT_MS) {
    const r = await conditionalBatch(db, runCancelStmts(runId, token));
    console.log(JSON.stringify({ at: 'topic_run', run_id: runId, status: r.ok ? 'cancelled' : 'lost', reason: 'no_time' }));
    const run = r.ok ? null : await readRun(db, runId);
    return { status: 'not_taken', reason: 'no_time', ...(run ? { run } : {}) };
  }
  // 呼び出し（v2.7: 1 回 + 続き。再送なし・1 回ごとに絶対の締め切り = min(残り, 150 秒)）。
  // 続き: pause_turn か結果の無いサーバーツール → 応答の content を as-is で積んで同じ params で / end_turn で save_topics が無い → 催促を 1 回だけ足して。
  // 有限: 続きは合計 TOPIC_GEN_MAX_CONTINUES 回・残りが TOPIC_CONTINUE_MIN_LEFT_MS 未満なら続けない・これまでの実額 + 直前の 1 回の実額 > 取り置き額なら続けない（cost_cap）
  const reserveCents = c.topicGenReserveCents;
  const messages: MessageParam[] = [...params.messages];
  const contents: unknown[][] = [];
  let totalCents = 0;
  let lastCents = 0;
  let nudged = false;
  let turns = 0;
  /** save_topics が無いまま止めた理由（no_output のログ。cost_cap だけは run の error にもする） */
  let stopWhy: string | null = null;
  for (let turn = 0; ; turn++) {
    const callParams: MessageCreateParamsNonStreaming = turn === 0 ? params : { ...params, messages: [...messages] };
    const callOpts: CallOpts = { deadline: Math.min(opts.deadline, Date.now() + TOPIC_GEN_TIMEOUT_MS), maxTimeoutMs: TOPIC_GEN_TIMEOUT_MS, maxRetries: 0 };
    const t0 = Date.now();
    let msg: Message;
    try {
      msg = await port.createMessage(callParams, callOpts);
    } catch (e) {
      const k = classifyCallError(e);
      // 4xx の原因の切り分け: API の error.message（200 字）だけをログに出す（request 本文・鍵は出さない）
      if (k.detail) console.log(JSON.stringify({ at: 'topic_run', run_id: runId, call_error: k.code, status: k.status, detail: k.detail, turn }));
      // 最初の呼び出しの失敗は今までどおり（課金なし = 0・それ以外 = 取り置き額のまま）。
      // 続きの途中の失敗は同じ分類のコードで閉じ、台帳はそれまでの実額の合計（v2.7）
      if (turn === 0) return finishFailed(k.code, k.noCharge, 0, 0, undefined, { turns: 0, cents: 0 });
      return finishFailed(k.code, false, 0, 0, totalCents, { turns, cents: totalCents });
    }
    turns = turn + 1;
    // 実額（呼び出しごと）。万一数えられない時は取り置き額で数える（少なく数えない）
    let cents: number;
    try {
      cents = genActualCents(msg);
    } catch {
      cents = reserveCents;
    }
    totalCents += cents;
    lastCents = cents;
    const content = Array.isArray(msg.content) ? (msg.content as unknown[]) : [];
    contents.push(content);
    messages.push({ role: 'assistant', content: content as MessageParam['content'] });
    try {
      console.log(JSON.stringify({ at: 'topic_call', run_id: runId, turn, ...topicCallStats({ ...msg, content: content as Message['content'] }), ms: Date.now() - t0 }));
    } catch {
      // ログの組み立ての失敗で run を止めない
    }
    if (content.some((b) => (b as RawBlock)?.type === 'tool_use' && (b as RawBlock).name === SAVE_TOPICS_TOOL_NAME)) break;
    const stop = msg.stop_reason;
    let next: 'continue' | 'nudge' | null = null;
    if (stop === 'pause_turn' || (stop === 'tool_use' && isPendingServerTool(content))) next = 'continue';
    else if (stop === 'end_turn' && !nudged) next = 'nudge';
    if (next === null) {
      // max_tokens / refusal / 催促の後の end_turn / その他: 続けない
      stopWhy = `stop_${typeof stop === 'string' && SAFE_CODE.test(stop) ? stop : 'unknown'}`;
      break;
    }
    if (turn >= TOPIC_GEN_MAX_CONTINUES) {
      stopWhy = 'turn_limit';
      break;
    }
    if (opts.deadline - Date.now() < TOPIC_CONTINUE_MIN_LEFT_MS) {
      stopWhy = 'no_time';
      break;
    }
    if (totalCents + lastCents > reserveCents) {
      stopWhy = 'cost_cap';
      break;
    }
    if (next === 'nudge') {
      messages.push({ role: 'user', content: TOPIC_SAVE_NUDGE });
      nudged = true;
    }
  }

  // 応答の保存。ここで例外が出たら save_failed で閉じ、台帳は実額（全部の呼び出しの合計）で精算する（calling を残さない・取り置き額を残さない。v2.6・v2.7）
  const actual = totalCents;
  const runLog = { turns, cents: actual };
  let saved: { noOutput: true } | { noOutput: false; ok: boolean; made: number; dropped: number };
  try {
    // save_topics は全部の応答から探す（最後に出てきたもの）。web_fetch の結果も全部の応答を合わせて照合する
    const allContent = contents.flat();
    let call: { input?: unknown } | undefined;
    for (const b of allContent) if ((b as RawBlock)?.type === 'tool_use' && (b as RawBlock).name === SAVE_TOPICS_TOOL_NAME) call = b as { input?: unknown };
    const t = nowIso();
    const P = runPred(runId, token, t);
    const settle = [overReserveStmt(ref, actual, t, P), ledgerSettleActualStmt(ref, actual, P)];
    if (!call) {
      const error = stopWhy === 'cost_cap' ? 'cost_cap' : 'no_output';
      console.log(JSON.stringify({ at: 'topic_run', run_id: runId, no_output: stopWhy ?? 'unknown', ...runLog }));
      await conditionalBatch(db, [...settle, runFinishStmt({ runId, token, now: t, status: 'failed', error, made: 0, dropped: 0 })]);
      saved = { noOutput: true };
    } else {
      const items = Array.isArray((call.input as { topics?: unknown } | undefined)?.topics) ? ((call.input as { topics: unknown[] }).topics as unknown[]) : [];
      const fetched = genFetchTexts(allContent);
      const max = runMaxCount(req);
      const childSlot = addDays(today, 1);
      const accepted: NewTopic[] = [];
      let dropped = 0;
      items.forEach((raw, i) => {
        const kindOk = (k: unknown): boolean =>
          req.purpose === 'gen' ? k === req.kind : req.kind === 'refresh' ? k === parent!.kind : (DERIVE_CHILD_KINDS as readonly unknown[]).includes(k);
        const sd = req.purpose === 'gen' ? slotDay : childSlot;
        const k = (raw as { kind?: unknown } | null)?.kind;
        // 捨てた理由は理由コードだけをログに出す（本文は出さない）。原因の切り分け用
        const why = accepted.length >= max ? ['over_max'] : !kindOk(k) ? ['kind_mismatch'] : validateTopicBody(raw, { slotDay: sd });
        if (why.length > 0) {
          console.log(JSON.stringify({ at: 'topic_run', run_id: runId, dropped_index: i + 1, reasons: why.slice(0, 20) }));
          dropped++;
          return;
        }
        const body = raw as TopicBody;
        const id = `tp_${runId}_${i + 1}`;
        accepted.push({
          id,
          body,
          origin: req.purpose === 'gen' ? 'gen' : 'derive',
          runId,
          slotDay: sd,
          lineageId: req.purpose === 'gen' ? id : parent!.lineage_id,
          parentId: req.purpose === 'gen' ? null : parent!.id,
          deriveKind: req.purpose === 'gen' ? null : req.kind,
          depth: req.purpose === 'gen' ? 0 : Number(parent!.depth) + 1,
          genFound: matchGenFetch(body, fetched),
        });
      });
      const inserts: Stmt[] = [];
      for (const a of accepted) inserts.push(...(await insertTopicStmts(a, t, P)));
      const made = accepted.length;
      const status = made > 0 ? 'done' : 'failed';
      const r = await conditionalBatch(db, [...inserts, ...settle, runFinishStmt({ runId, token, now: t, status, error: made > 0 ? null : 'no_valid_topic', made, dropped })]);
      saved = { noOutput: false, ok: r.ok, made, dropped };
    }
  } catch (e) {
    // 例外の名前だけ（本文・鍵は出さない）
    console.log(JSON.stringify({ at: 'topic_run', run_id: runId, save_error: e instanceof Error ? e.name : 'error' }));
    return finishFailed('save_failed', false, 0, 0, actual, runLog);
  }
  const run = (await readRun(db, runId))!;
  if (saved.noOutput) {
    console.log(JSON.stringify({ at: 'topic_run', run_id: runId, status: run.status, error: run.error, ...runLog }));
    return { status: 'failed', run };
  }
  console.log(JSON.stringify({ at: 'topic_run', run_id: runId, status: run.status, error: run.error, made: saved.ok ? saved.made : 0, dropped: saved.dropped, ...runLog }));
  return { status: run.status === 'done' ? 'done' : 'failed', run };
}
