// 作る（生成 run・派生 run。契約 contract-T T-4・T-7・T-9）。
// 順序: 入・切 → run を取る（取り置き + run の行を 1 つの条件付き batch）→ 入力（RSS・既存の題・親）→ Messages API 1 回（再送なし・絶対の締め切り）
//       → 応答の保存（全部の文が run の述語を持つ 1 つの batch。最後の文が run を done / failed にする）。
// ログは run id と状態名・件数だけ。RSS の本文・モデルの出力は log に入れない。

import type { Message, MessageCreateParamsNonStreaming, Tool } from '@anthropic-ai/sdk/resources/messages/messages';
import { PortError, type CallOpts, type FactoryPort } from '../anthropic';
import { all, conditionalBatch, isUniqueViolation, nowIso, prepare, stmt, tokyoDay, type Stmt } from '../db';
import { cfg, type Env } from '../env';
import { TOPIC_FEEDS } from '../generated/topic-sources';
import { microToCents, sonnetMicroDollars, WEB_SEARCH_CENTS } from '../ledger';
import { acceptableFeedType, parseFeed } from '../scout';
import { checkSourceUrl, quoteOutcome } from './fetch-source';
import { TOPIC_KIND_LABELS, type TopicKind } from './locale';
import { EXTEND_KIND_LABEL, genSystem, genUserBlocks, SAVE_TOPICS_TOOL_NAME, type FeedHeadline } from './prompts';
import { addDays, TOPIC_BODY_JSON_SCHEMA, validateTopicBody, type TopicBody } from './schema';
import {
  deriveReserveStmt,
  existingTitles,
  genLedgerRef,
  genReserveStmt,
  insertTopicStmts,
  ledgerSettleStmt,
  mondayOf,
  overReserveStmt,
  readRun,
  readTopic,
  runPred,
  RUN_LEASE_MS,
  TOPIC_GEN_MAX_TOKENS,
  TOPIC_GEN_TIMEOUT_MS,
  TOPIC_NEWS_PER_RUN,
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

/** 1 run の最大本数（T-4・T-9） */
export function runMaxCount(req: RunRequest): number {
  if (req.purpose === 'derive') return 1;
  return req.kind === 'news' ? TOPIC_NEWS_PER_RUN : TOPIC_WEEKLY_PER_RUN;
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

/** 失敗の理由コードと、課金なしと分かる失敗か（T-6: 429・quota・認証・その他の 4xx は 0。5xx・応答不明は取り置き額のまま） */
export function classifyCallError(e: unknown): { code: string; noCharge: boolean; responded: boolean; status?: number } {
  if (e instanceof PortError) {
    if (e.responded && typeof e.status === 'number') {
      const s = e.status;
      const code = s === 429 ? 'rate_limited' : s === 401 || s === 403 ? 'auth' : s === 400 ? 'bad_request' : s === 402 ? 'quota' : s === 529 ? 'overloaded' : s >= 500 ? 'server' : `http_${s}`;
      return { code, noCharge: s >= 400 && s < 500, responded: true, status: s };
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

/** 生成・派生の run を 1 つ走らせる（cron と手動が呼ぶ） */
export async function runTopicRun(env: Env, port: FactoryPort, req: RunRequest, opts: RunOptions): Promise<RunOutcome> {
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

  const finishFailed = async (code: string, noCharge: boolean, made = 0, dropped = 0): Promise<RunOutcome> => {
    const t = nowIso();
    const P = runPred(runId, token, t);
    const stmts: Stmt[] = [];
    if (noCharge) stmts.push(ledgerSettleStmt(ref, 0, P));
    stmts.push(runFinishStmt({ runId, token, now: t, status: 'failed', error: code, made, dropped }));
    await conditionalBatch(db, stmts);
    const run = (await readRun(db, runId))!;
    console.log(JSON.stringify({ at: 'topic_run', run_id: runId, status: run.status, error: run.error }));
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
          // 呼んだ時の入力の形を保証させる（v2.4 の裁定 5。schema は公式の strict の制限の中: CONTRACT-factory §T 末尾）。呼ぶことは保証しないので無ければ no_output
          strict: true,
        },
      ],
      // 強制呼び出しはしない（Sonnet 5.5 は tool_choice any / tool が 400。CONTRACT-factory §T 末尾）。auto + strict。無ければ no_output
      tool_choice: { type: 'auto' },
    };
  } catch {
    return finishFailed('input_failed', false);
  }

  // 呼び出し（1 回・再送なし・絶対の締め切り）。入力（RSS）の後で残りが 5 秒未満なら呼ばない（呼んでいないので台帳は 0）
  if (opts.deadline - Date.now() < TOPIC_CALL_MIN_LEFT_MS) return finishFailed('no_time', true);
  const callOpts: CallOpts = { deadline: Math.min(opts.deadline, Date.now() + TOPIC_GEN_TIMEOUT_MS), maxTimeoutMs: TOPIC_GEN_TIMEOUT_MS, maxRetries: 0 };
  let msg: Message;
  try {
    msg = await port.createMessage(params, callOpts);
  } catch (e) {
    const k = classifyCallError(e);
    return finishFailed(k.code, k.noCharge);
  }

  // 応答の保存
  const actual = genActualCents(msg);
  const call = msg.content.find((b) => b.type === 'tool_use' && b.name === SAVE_TOPICS_TOOL_NAME) as { input?: unknown } | undefined;
  const t = nowIso();
  const P = runPred(runId, token, t);
  const settle = [overReserveStmt(ref, actual, t, P), ledgerSettleStmt(ref, actual, P)];
  if (!call) {
    await conditionalBatch(db, [...settle, runFinishStmt({ runId, token, now: t, status: 'failed', error: 'no_output', made: 0, dropped: 0 })]);
    const run = (await readRun(db, runId))!;
    console.log(JSON.stringify({ at: 'topic_run', run_id: runId, status: run.status, error: run.error }));
    return { status: 'failed', run };
  }
  const items = Array.isArray((call.input as { topics?: unknown } | undefined)?.topics) ? ((call.input as { topics: unknown[] }).topics as unknown[]) : [];
  const fetched = genFetchTexts(msg.content as unknown[]);
  const max = runMaxCount(req);
  const childSlot = addDays(today, 1);
  const accepted: NewTopic[] = [];
  let dropped = 0;
  items.forEach((raw, i) => {
    const kindOk = (k: unknown): boolean =>
      req.purpose === 'gen' ? k === req.kind : req.kind === 'refresh' ? k === parent!.kind : (DERIVE_CHILD_KINDS as readonly unknown[]).includes(k);
    const sd = req.purpose === 'gen' ? slotDay : childSlot;
    const k = (raw as { kind?: unknown } | null)?.kind;
    if (accepted.length >= max || !kindOk(k) || validateTopicBody(raw, { slotDay: sd }).length > 0) {
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
  const run = (await readRun(db, runId))!;
  console.log(JSON.stringify({ at: 'topic_run', run_id: runId, status: run.status, error: run.error, made: r.ok ? made : 0, dropped }));
  return { status: run.status === 'done' ? 'done' : 'failed', run };
}
