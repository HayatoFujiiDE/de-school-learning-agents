// fake 実装（契約 §I）。src/anthropic.ts の fakeAllowed() ガード内からだけ読み込まれる（ANTHROPIC_FAKE='1' かつ localhost、
// または scheduled で settings.fake_enabled='1'）。本番ではこのモジュールに到達しない。
//
// fixture: test/fixtures/<scenario>/{session,events,files,verify}.json（scripts/sync-claude-assets.sh が fixtures.generated.ts に埋め込む）
//   session.json: {"initial": {"status","list_cost"}, "after": {"<送った event type>": {...}}}
//   events.json:  {"initial": [event...], "after": {"<type>": [event...]}}   … 送った event の echo の後ろに足す（同じ type は最初の 1 回だけ）
//   files.json:   {"initial": [{"filename","fixture"}], "after": {"<type>": [...]}}  … filename ごとに上書き
// 送った events と messages.create の引数は settings.fake_calls_json に追記する（smoke が (g)(h) を確認する）。
// 増額（sessions.update の budget。§B-4-f）: 使った額（list_cost）以下なら本物と同じく budget_not_raised で拒否する。
//   受け付けたら session.updated を足し、公式（managed-agents/budgets: 予算を上げる update が受理されると止まった作業は自動で再開する）
//   どおり session を running にする（session.status_running も足す）。session.json / events.json の after["sessions.update"] があれば
//   そちらを使う（例: fixture budget-raise-stays-idle は update の後も idle のまま）。

import type { Message, MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/messages/messages';
import type { MessageBatchIndividualResponse } from '@anthropic-ai/sdk/resources/messages/batches';
import { BATCH_LIST_LIMIT, BATCH_RESULTS_MAX_BYTES, PortError, type BatchView, type CallOpts, type FactoryPort, type FileMeta, type SessionView } from '../anthropic';
import { getSetting, nowIso, setSetting } from '../db';
import type { Env } from '../env';
import { SCOUT_FEEDS } from '../generated/scout-sources';
import { SCOUT_MODEL } from '../scout';
import { parseXaiResponse } from '../xai';
import { FIXTURE_FILES } from './fixtures.generated';
import { handleFakeOpenAiControl } from './openai';
import { fakeTopicCheckReply, fakeTopicGenReply, handleTopicsFakeControl, isTopicCheckParams, isTopicGenParams } from './topics';

// 画像生成の fake（§O-4 e）。src/anthropic.ts の getImagePort が loadFake（動的 import 1 箇所）経由でここから取る
export { createFakeImagePort } from './openai';
// 動画の記録の fake（§Q-7）。src/anthropic.ts の getGeminiPort が loadFake 経由でここから取る
export { createFakeGeminiPort } from './gemini';
// YouTube の oEmbed の fake（§Q-11 2）。src/anthropic.ts の getOEmbedPort が loadFake 経由でここから取る
export { createFakeOEmbedPort } from './youtube-oembed';
// お題の RSS と出典の fetch の fake（contract-T）。src/anthropic.ts の getTopicFetch が loadFake 経由でここから取る
export { topicFetch } from './topics';

/** 入口（§K-8）の fixture。job の scenario ではない */
const INTAKE_FIXTURE_DIRS = ['scout', 'meeting'];

interface Call {
  op: string;
  at: string;
  session_id?: string;
  scenario?: string;
  metadata?: Record<string, string>;
  events?: Array<Record<string, unknown>>;
  params?: Record<string, unknown>;
  batch_id?: string;
  custom_id?: string;
  /** 検証係の batch（§L-2）だけ: 1 件目の user 文の claims_json と、送った assistant turn の数 */
  verify?: { claims_text: string; assistant_turns: number; figures?: string[]; videos?: string[] };
  /** smoke の制御 /__fake/session-append（§O-8 smoke）だけ: 足すファイル（本文は記録に持つ）・status・list_cost・識別子 */
  append?: { key: string; files: Array<{ filename: string; content: string }>; status?: string; list_cost?: string };
  /** お題の呼び出し（contract-T）だけ: 呼び出しごとに渡った再送の回数と締め切りの有無 */
  opts?: { max_retries: number | null; has_deadline: boolean; max_timeout_ms: number | null };
}

interface Staged<T> {
  initial?: T;
  after?: Record<string, T>;
}

export const SCENARIOS = [
  ...new Set(
    Object.keys(FIXTURE_FILES)
      .map((k) => k.split('/')[0])
      .filter((s) => !s.startsWith('_') && !INTAKE_FIXTURE_DIRS.includes(s)),
  ),
];

function fixtureJson<T>(scenario: string, name: string): T | null {
  const t = FIXTURE_FILES[`${scenario}/${name}`];
  return t === undefined ? null : (JSON.parse(t) as T);
}

async function appendCall(db: D1Database, call: Call): Promise<void> {
  const v = JSON.stringify(call);
  await db
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES ('fake_calls_json', json_array(json(?)), ?)
       ON CONFLICT(key) DO UPDATE SET value = json_insert(value, '$[#]', json(?)), updated_at = excluded.updated_at`,
    )
    .bind(v, nowIso(), v)
    .run();
}

async function readCalls(db: D1Database): Promise<Call[]> {
  const v = await getSetting(db, 'fake_calls_json');
  if (!v) return [];
  try {
    return JSON.parse(v) as Call[];
  } catch {
    return [];
  }
}

interface View {
  scenario: string;
  status: string;
  listCost: string;
  metadata: Record<string, string>;
  created_at: string;
  events: Array<Record<string, unknown>>;
  files: Map<string, string>; // filename → fixture path（smoke が足したファイルは INLINE_PREFIX + key/index）
  /** smoke が足したファイルの本文（INLINE_PREFIX 付きの path → 本文） */
  inline: Map<string, string>;
}

/** /__fake/session-append で足したファイルの path の印（fixture の path と混ざらない） */
const INLINE_PREFIX = 'inline/';

const notFound = () => new PortError(true, 404, 'not_found');

function buildView(calls: Call[], sessionId: string): View {
  const create = calls.find((c) => c.op === 'sessions.create' && c.session_id === sessionId);
  if (!create || !create.scenario) throw notFound();
  const sc = create.scenario;
  const sess = fixtureJson<Staged<{ status?: string; list_cost?: string }>>(sc, 'session.json') ?? {};
  const evs = fixtureJson<Staged<Array<Record<string, unknown>>>>(sc, 'events.json') ?? {};
  const fls = fixtureJson<Staged<Array<{ filename: string; fixture: string }>>>(sc, 'files.json') ?? {};

  let status = sess.initial?.status ?? 'idle';
  let listCost = sess.initial?.list_cost ?? '0';
  const events: Array<Record<string, unknown>> = [
    { type: 'user.message', id: 'sevt_fake_initial', content: [{ type: 'text', text: '(initial)' }] },
    ...(evs.initial ?? []).map((e) => ({ ...e })),
  ];
  const files = new Map<string, string>();
  const inline = new Map<string, string>();
  for (const f of fls.initial ?? []) files.set(f.filename, f.fixture);

  const seen = new Set<string>();
  let n = 0;
  for (const c of calls) {
    if (c.session_id !== sessionId) continue;
    if (c.op === 'sessions.archive') status = 'terminated';
    if (c.op === 'fake.append' && c.append) {
      // smoke の制御: 送った event と同じ順序の位置に、職人の event（custom_tool_use 等）とファイルを足す
      for (const e of c.events ?? []) events.push({ ...e });
      c.append.files.forEach((f, i) => {
        const ref = `${INLINE_PREFIX}${c.append!.key}/${i}`;
        files.set(f.filename, ref);
        inline.set(ref, f.content);
      });
      if (status !== 'terminated' && c.append.status) status = c.append.status;
      if (c.append.list_cost) listCost = c.append.list_cost;
      continue;
    }
    if (c.op === 'sessions.update') {
      const cents = Number(c.params?.budget_cents ?? 0);
      events.push({ type: 'session.updated', budget: { type: 'limit', max_list_cost: { amount: String(cents), currency: 'USD' } } });
      if (status === 'terminated') continue;
      const s = sess.after?.['sessions.update'];
      if (s) {
        // fixture の指定どおり（status が無ければ今のまま）
        if (s.status) status = s.status;
        if (s.list_cost) listCost = s.list_cost;
        for (const ae of evs.after?.['sessions.update'] ?? []) events.push({ ...ae });
      } else {
        // 既定: 予算を上げる update が受理されると止まった作業は自動で再開する（公式 managed-agents/budgets）
        status = 'running';
        events.push({ type: 'session.status_running' });
      }
      continue;
    }
    if (c.op !== 'events.send') continue;
    for (const e of c.events ?? []) {
      n++;
      events.push({ ...e, id: `sevt_fake_sent_${n}` });
      const t = String(e.type);
      if (seen.has(t)) continue;
      seen.add(t);
      const s = sess.after?.[t];
      if (s?.status) status = s.status;
      if (s?.list_cost) listCost = s.list_cost;
      for (const ae of evs.after?.[t] ?? []) events.push({ ...ae });
      for (const af of fls.after?.[t] ?? []) files.set(af.filename, af.fixture);
    }
  }
  const base = Date.parse(create.at);
  events.forEach((e, i) => {
    if (!e.id) e.id = `sevt_fake_${i}`;
    e.processed_at = new Date(base + i * 1000).toISOString();
  });
  return { scenario: sc, status, listCost, metadata: create.metadata ?? {}, created_at: create.at, events, files, inline };
}

/** inline のファイル（INLINE_PREFIX + key/index）の本文を呼び出し記録から読む */
function inlineText(calls: Call[], ref: string): string | undefined {
  const m = /^inline\/([0-9a-f-]{36})\/(\d+)$/.exec(ref);
  if (!m) return undefined;
  const c = calls.find((x) => x.op === 'fake.append' && x.append?.key === m[1]);
  return c?.append?.files[Number(m[2])]?.content;
}

/** smoke の制御 /__fake/fail-sends: session ごとに「この type を含む次の送信を n 回失敗させる」 */
type SendFailures = Record<string, { type: string; count: number }>;
async function takeSendFailure(db: D1Database, sessionId: string, events: Array<Record<string, unknown>>): Promise<boolean> {
  const raw = await getSetting(db, 'fake_send_fail_json');
  if (!raw) return false;
  let all: SendFailures = {};
  try {
    all = JSON.parse(raw) as SendFailures;
  } catch {
    return false;
  }
  const f = all[sessionId];
  if (!f || f.count <= 0 || !events.some((e) => e.type === f.type)) return false;
  all[sessionId] = { ...f, count: f.count - 1 };
  await setSetting(db, 'fake_send_fail_json', JSON.stringify(all));
  return true;
}

/**
 * custom_tool_result の image block（base64 直。§O-6 a 形 A）は、記録では data を長さと復号後の SHA-256 に置き換える
 * （fake_calls_json を 2 MB 級にしない。smoke は sha256 で image_requests.sha256 と突き合わせる）
 */
async function redactImageData(events: Array<Record<string, unknown>>): Promise<Array<Record<string, unknown>>> {
  const out: Array<Record<string, unknown>> = [];
  for (const e of events) {
    if (e.type !== 'user.custom_tool_result' || !Array.isArray(e.content)) {
      out.push(e);
      continue;
    }
    const content: unknown[] = [];
    for (const c of e.content as Array<Record<string, unknown>>) {
      const src = c?.type === 'image' ? (c.source as Record<string, unknown> | undefined) : undefined;
      if (src && src.type === 'base64' && typeof src.data === 'string') {
        const bin = atob(src.data);
        const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
        const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
        content.push({ type: 'image', source: { type: 'base64', media_type: src.media_type, data_length: src.data.length, data_sha256: digest } });
      } else content.push(c);
    }
    out.push({ ...e, content });
  }
  return out;
}

const enc = new TextEncoder();
const b64url = (s: string) => btoa(String.fromCharCode(...enc.encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s: string) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)));
};

/** 本物と同じく cursor で区切って返す（小さいページで、続き位置からの再開を smoke で通す） */
const FAKE_PAGE_SIZE = 4;
function paginate<T>(items: T[], page: string | null, prefix: string): { data: T[]; next: string | null } {
  let start = 0;
  if (page) {
    if (!page.startsWith(prefix)) throw new PortError(true, 400, 'bad_cursor');
    start = Number.parseInt(page.slice(prefix.length), 10) || 0;
  }
  const end = start + FAKE_PAGE_SIZE;
  return { data: items.slice(start, end), next: end < items.length ? `${prefix}${end}` : null };
}

/** user message の content（文字列、または content block の配列）の text をつなぐ（検証係の入力は §O-12 から配列） */
function userText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return (content as Array<{ type?: unknown; text?: unknown }>)
    .filter((b) => b?.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('\n');
}

/** 検証係の入力の図の一覧（`# 図・画像（` の見出しに続く `- {path}` 行）から、渡された図の path（容量のため渡していないものを除く） */
function fakeShownFigures(text: string): string[] {
  const i = text.indexOf('# 図・画像（');
  if (i < 0) return [];
  const out: string[] = [];
  for (const line of text.slice(i).split('\n').slice(1)) {
    if (!line.startsWith('- ')) break;
    if (line.includes('（容量のため画像は渡していません')) continue;
    const rest = line.slice(2);
    const j = rest.indexOf(': ');
    out.push(j < 0 ? rest : rest.slice(0, j));
  }
  return out;
}

/** §Q-3 4: 入力の <video_notes> で記録を入れた動画（見出しの行。本文の ## は無害化されて行頭に来ない）。fake の検証係だけが読む */
function fakeShownVideos(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/^## 動画 (v\d{1,2}) .*（Gemini が区間を見て書いた記録。職人が書いたものではない）$/gm)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

function extractTagged(text: string, tag: string): string | null {
  const m = new RegExp(`<${tag}>\\n?([\\s\\S]*?)\\n?</${tag}>`).exec(text);
  return m ? m[1] : null;
}

export function createFakePort(env: Env): FactoryPort {
  const db = env.DB;
  return {
    isFake: true,
    async createSession(params) {
      const scenario = (await getSetting(db, 'fake_scenario')) ?? 'questions-empty-then-done';
      if (!SCENARIOS.includes(scenario)) throw new PortError(true, 400, 'unknown_scenario');
      const id = `sesn_${crypto.randomUUID().replace(/-/g, '')}`;
      await appendCall(db, { op: 'sessions.create', at: nowIso(), session_id: id, scenario, metadata: params.metadata ?? {} });
      return { id };
    },
    async retrieveSession(id) {
      const v = buildView(await readCalls(db), id);
      return { id, status: v.status, listCostCents: Number.parseInt(v.listCost, 10), metadata: v.metadata, created_at: v.created_at };
    },
    async updateSessionBudget(id, cents) {
      const v = buildView(await readCalls(db), id); // 存在確認
      // 本物と同じ拒否: 終わった session は変えられない / 使った額以下へは下げられない（budget_not_raised）
      if (v.status === 'terminated') throw new PortError(true, 400, 'session_terminated');
      if (!Number.isInteger(cents) || cents <= Number.parseInt(v.listCost, 10)) throw new PortError(true, 400, 'budget_not_raised');
      await appendCall(db, { op: 'sessions.update', at: nowIso(), session_id: id, params: { budget_cents: cents } });
    },
    async listSessionsPage() {
      const calls = await readCalls(db);
      const data: SessionView[] = calls
        .filter((c) => c.op === 'sessions.create' && c.session_id)
        .reverse()
        .map((c) => {
          const v = buildView(calls, c.session_id!);
          return { id: c.session_id!, status: v.status, listCostCents: Number.parseInt(v.listCost, 10), metadata: v.metadata, created_at: v.created_at };
        });
      return { data, next: null };
    },
    async listEventsPage(id, { order, page }) {
      const v = buildView(await readCalls(db), id);
      const evs = order === 'desc' ? [...v.events].reverse() : v.events;
      return paginate(evs, page, `${order}:`);
    },
    async sendEvents(id, events) {
      buildView(await readCalls(db), id); // 存在確認
      const evs = events as unknown as Array<Record<string, unknown>>;
      if (await takeSendFailure(db, id, evs)) {
        // smoke (i11): 送信の失敗（本物の API の 5xx と同じく PortError）。記録には type だけ残す
        await appendCall(db, { op: 'events.send_failed', at: nowIso(), session_id: id, events: evs.map((e) => ({ type: e.type, custom_tool_use_id: e.custom_tool_use_id })) });
        throw new PortError(true, 500, 'api_error');
      }
      await appendCall(db, { op: 'events.send', at: nowIso(), session_id: id, events: await redactImageData(evs) });
    },
    async archiveSession(id) {
      await appendCall(db, { op: 'sessions.archive', at: nowIso(), session_id: id });
    },
    async listFilesPage(sessionId, page) {
      const v = buildView(await readCalls(db), sessionId);
      const out: FileMeta[] = [];
      let i = 0;
      for (const [filename, fixture] of v.files) {
        const text = fixture.startsWith(INLINE_PREFIX) ? v.inline.get(fixture) : FIXTURE_FILES[fixture];
        if (text === undefined) continue;
        // 本物の Files API は filename にディレクトリを含めず basename だけを返す（契約 §E-0 / §R-41）。fixture の filename は論理パスのまま置く
        const basename = filename.slice(filename.lastIndexOf('/') + 1);
        out.push({ id: `file_fake_${b64url(fixture)}`, filename: basename, size_bytes: enc.encode(text).byteLength, created_at: new Date(Date.parse(v.created_at) + i++).toISOString() });
      }
      return paginate(out, page, 'files:');
    },
    async downloadFile(fileId) {
      if (!fileId.startsWith('file_fake_')) throw notFound();
      const ref = unb64url(fileId.slice('file_fake_'.length));
      const text = ref.startsWith(INLINE_PREFIX) ? inlineText(await readCalls(db), ref) : FIXTURE_FILES[ref];
      if (text === undefined) throw notFound();
      return enc.encode(text);
    },
    async createMessage(params: MessageCreateParamsNonStreaming, o?: CallOpts): Promise<Message> {
      if (params.model === SCOUT_MODEL) return scoutMessage(db, params);
      if (isTopicGenParams(params) || isTopicCheckParams(params)) {
        // お題（contract-T）: 生成は「それまでのお題の生成の回数」で本文が決まる（決定論）。呼び出しの引数と再送・締め切りを記録する
        const gen = isTopicGenParams(params);
        const n = gen ? (await readCalls(db)).filter((x) => x.op === 'messages.create' && x.params?.kind === 'topic_gen').length : 0;
        await appendCall(db, {
          op: 'messages.create',
          at: nowIso(),
          params: {
            kind: gen ? 'topic_gen' : 'topic_check',
            model: params.model,
            max_tokens: params.max_tokens,
            tool_choice: params.tool_choice,
            tools: toolSummary(params.tools),
          },
          opts: { max_retries: o?.maxRetries ?? null, has_deadline: typeof o?.deadline === 'number', max_timeout_ms: o?.maxTimeoutMs ?? null },
        });
        return gen ? fakeTopicGenReply(params, n) : fakeTopicCheckReply(params);
      }
      const content = userText(params.messages[0]?.content);
      await appendCall(db, {
        op: 'messages.create',
        at: nowIso(),
        params: {
          model: params.model,
          max_tokens: params.max_tokens,
          thinking: params.thinking,
          tool_choice: params.tool_choice,
          tools: (params.tools ?? []).map((t) => ({
            name: (t as { name?: string }).name,
            type: (t as { type?: string }).type ?? 'custom',
            strict: (t as { strict?: boolean }).strict,
            max_uses: (t as { max_uses?: number }).max_uses,
          })),
          messages: params.messages.length,
          container: typeof params.container === 'string' ? params.container : null,
        },
      });
      return verifierReply(params.model, extractTagged(content, 'claims_json') ?? '{"claims":[]}', params.messages.filter((m) => m.role === 'assistant').length, fakeShownFigures(content), fakeShownVideos(content));
    },
    // ---- 入口（§K-8）----
    async xaiResponses(req) {
      await appendCall(db, {
        op: 'xai.responses',
        at: nowIso(),
        params: { model: req.model, max_turns: req.max_turns, store: req.store, handles: req.tools[0]?.allowed_x_handles.length ?? 0, from_date: req.tools[0]?.from_date, to_date: req.tools[0]?.to_date },
      });
      return parseXaiResponse(JSON.parse(FIXTURE_FILES['scout/xai.json'] ?? '{}'));
    },
    async createBatch(params) {
      const id = `msgbatch_fake_${crypto.randomUUID().replace(/-/g, '')}`;
      const r = params.requests[0];
      if (r && isVerifierParams(r.params)) {
        // 検証係（§L-2）: 1 ターン = 1 batch。claims と assistant turn の数を残し、retrieve / results で検証係の応答を作る
        const first = userText(r.params.messages[0]?.content);
        await appendCall(db, {
          op: 'batches.create',
          at: nowIso(),
          batch_id: id,
          custom_id: r.custom_id,
          params: {
            kind: 'verify',
            requests: params.requests.length,
            model: r.params.model,
            max_tokens: r.params.max_tokens,
            thinking: r.params.thinking,
            tool_choice: r.params.tool_choice,
            cache_control: r.params.cache_control?.type ?? null,
            tools: toolSummary(r.params.tools),
            messages: r.params.messages.length,
          },
          verify: {
            claims_text: extractTagged(first, 'claims_json') ?? '{"claims":[]}',
            assistant_turns: r.params.messages.filter((m) => m.role === 'assistant').length,
            figures: fakeShownFigures(first),
            videos: fakeShownVideos(first),
          },
        });
        const now = new Date();
        return { id, processing_status: 'in_progress', created_at: now.toISOString(), expires_at: new Date(now.getTime() + 86_400_000).toISOString() };
      }
      await appendCall(db, {
        op: 'batches.create',
        at: nowIso(),
        batch_id: id,
        custom_id: r?.custom_id,
        params: {
          requests: params.requests.length,
          model: r?.params.model,
          max_tokens: r?.params.max_tokens,
          thinking: r?.params.thinking,
          output_format: r?.params.output_config?.format?.type ?? null,
        },
      });
      const now = new Date();
      return { id, processing_status: 'in_progress', created_at: now.toISOString(), expires_at: new Date(now.getTime() + 86_400_000).toISOString() };
    },
    async retrieveBatch(id): Promise<BatchView> {
      const calls = await readCalls(db);
      const c = calls.find((x) => x.op === 'batches.create' && x.batch_id === id);
      if (!c) throw notFound();
      if (c.verify) {
        // claims.json の fake_batch_in_progress: n があれば、この batch の retrieve の n 回目までは in_progress
        const n = Number(fakeKeys(c.verify.claims_text).fake_batch_in_progress ?? 0);
        const seen = calls.filter((x) => x.op === 'batches.retrieve' && x.batch_id === id).length;
        await appendCall(db, { op: 'batches.retrieve', at: nowIso(), batch_id: id });
        return { id, processing_status: seen < n ? 'in_progress' : 'ended', created_at: c.at, expires_at: new Date(Date.parse(c.at) + 86_400_000).toISOString(), request_total: 1 };
      }
      const fx = JSON.parse(FIXTURE_FILES['meeting/batch.json'] ?? '{}') as { processing_status?: BatchView['processing_status'] };
      return { id, processing_status: fx.processing_status ?? 'ended', created_at: c.at, expires_at: new Date(Date.parse(c.at) + 86_400_000).toISOString() };
    },
    async batchResults(id, o): Promise<MessageBatchIndividualResponse[]> {
      const c = (await readCalls(db)).find((x) => x.op === 'batches.create' && x.batch_id === id);
      if (!c) throw notFound();
      await appendCall(db, { op: 'batches.results', at: nowIso(), batch_id: id });
      if (c.verify) {
        // claims.json の fake_batch_result: 'errored' | 'expired' | 'canceled' でその結果、
        // fake_results_bytes: n が上限（o.maxBytes）を超えれば本物と同じく閉じた行が無い = 空を返す
        const k = fakeKeys(c.verify.claims_text);
        // fake_results_error: 404 / 410 / 500 等の数値で API エラー、'no_results_url' で results_url の無い ended batch（本物の port と同じ PortError）
        if (k.fake_results_error === 'no_results_url') throw new PortError(true, undefined, 'no_results_url');
        if (typeof k.fake_results_error === 'number') throw new PortError(true, k.fake_results_error, 'api_error');
        if (Number(k.fake_results_bytes ?? 0) > (o?.maxBytes ?? BATCH_RESULTS_MAX_BYTES)) return [];
        const rt = typeof k.fake_batch_result === 'string' ? k.fake_batch_result : 'succeeded';
        if (rt !== 'succeeded') return [{ custom_id: c.custom_id ?? '', result: { type: rt } } as unknown as MessageBatchIndividualResponse];
        const message = verifierReply(VERIFIER_FAKE_MODEL, c.verify.claims_text, c.verify.assistant_turns, c.verify.figures ?? [], c.verify.videos ?? []);
        return [{ custom_id: c.custom_id ?? '', result: { type: 'succeeded', message } } as unknown as MessageBatchIndividualResponse];
      }
      const fx = JSON.parse(FIXTURE_FILES['meeting/results.json'] ?? '{}') as {
        result_type?: string;
        stop_reason?: string;
        usage?: Record<string, number>;
        output?: { ranked?: Array<Record<string, unknown>> };
      };
      const first = await db.prepare("SELECT id FROM proposals WHERE status = 'proposed' ORDER BY created_at ASC LIMIT 1").first<{ id: string }>();
      const output = JSON.parse(JSON.stringify(fx.output ?? {})) as { ranked?: Array<Record<string, unknown>> };
      for (const r of output.ranked ?? []) {
        if (r.proposal_id === '{{FIRST_PROPOSED}}') {
          if (first) r.proposal_id = first.id;
          else delete r.proposal_id;
        }
      }
      if (fx.result_type && fx.result_type !== 'succeeded') return [{ custom_id: c.custom_id ?? '', result: { type: fx.result_type } } as unknown as MessageBatchIndividualResponse];
      const message = {
        id: `msg_fake_${crypto.randomUUID().slice(0, 8)}`,
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-5-5',
        container: null,
        content: [
          { type: 'thinking', thinking: '', signature: 'fake' },
          { type: 'text', text: JSON.stringify(output), citations: null },
        ],
        stop_reason: fx.stop_reason ?? 'end_turn',
        stop_sequence: null,
        usage: { cache_creation_input_tokens: 0, cache_read_input_tokens: 0, ...(fx.usage ?? {}) },
      };
      return [{ custom_id: c.custom_id ?? '', result: { type: 'succeeded', message } } as unknown as MessageBatchIndividualResponse];
    },
    async listBatchesPage(): Promise<BatchView[]> {
      // 作った batch（呼び出し記録）を新しい順に BATCH_LIST_LIMIT 件。custom_id は list の応答に無いので返さない（本物と同じ）
      const made = (await readCalls(db)).filter((x) => x.op === 'batches.create' && typeof x.batch_id === 'string').reverse().slice(0, BATCH_LIST_LIMIT);
      await appendCall(db, { op: 'batches.list', at: nowIso() });
      return made.map((c) => ({
        id: c.batch_id as string,
        processing_status: 'in_progress',
        created_at: c.at,
        expires_at: new Date(Date.parse(c.at) + 86_400_000).toISOString(),
        request_total: 1,
      }));
    },
  };
}

const VERIFIER_FAKE_MODEL = 'claude-opus-5-5';

/** 検証係の params か（report_verdicts を持つ） */
function isVerifierParams(p: MessageCreateParamsNonStreaming): boolean {
  return (p.tools ?? []).some((t) => (t as { name?: string }).name === 'report_verdicts');
}

function toolSummary(tools: MessageCreateParamsNonStreaming['tools']) {
  return (tools ?? []).map((t) => ({
    name: (t as { name?: string }).name,
    type: (t as { type?: string }).type ?? 'custom',
    strict: (t as { strict?: boolean }).strict,
    max_uses: (t as { max_uses?: number }).max_uses,
    max_content_tokens: (t as { max_content_tokens?: number }).max_content_tokens,
  }));
}

/** claims.json の最上位にある fixture 専用キー（fake_*）だけを読む */
function fakeKeys(claimsText: string): Record<string, unknown> {
  try {
    const o = JSON.parse(claimsText) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(o).filter(([k]) => k.startsWith('fake_')));
  } catch {
    return {};
  }
}

/**
 * 検証係の応答（同期の messages.create と Batch の results で共通）。
 * claims.json の各 claim に fixture 専用キー fake_verdict があればそれを、無ければ confirmed を返す。
 * 最上位の fake_pause_turns: n があれば、assistant の turn が n 未満の間は container 付きの pause_turn を返す。
 * figures は入力の図の一覧のうち渡された図（§O-12）、videos は記録を入れた動画（§Q-3 4）。すべて ok を返す
 */
function verifierReply(model: string, claimsText: string, assistantTurns: number, figures: string[] = [], videos: string[] = []): Message {
  let claims: Array<{ id: string; fake_verdict?: string }> = [];
  let pauseTurns = 0;
  try {
    const parsed = JSON.parse(claimsText) as { claims?: Array<{ id: string; fake_verdict?: string }>; fake_pause_turns?: number };
    claims = parsed.claims ?? [];
    pauseTurns = Number(parsed.fake_pause_turns ?? 0);
  } catch {
    claims = [];
  }
  const fakeContainer = { id: 'container_fake_pause_1', expires_at: new Date(Date.now() + 3600_000).toISOString(), skills: null };
  if (assistantTurns < pauseTurns) {
    return {
      id: `msg_fake_${crypto.randomUUID().slice(0, 8)}`,
      type: 'message',
      role: 'assistant',
      model,
      container: fakeContainer,
      content: [{ type: 'text', text: '出典を開いています', citations: null }],
      stop_reason: 'pause_turn',
      stop_sequence: null,
      usage: { input_tokens: 6000, output_tokens: 300, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    } as unknown as Message;
  }
  const verdicts = claims.map((c) => ({
    claim_id: c.id,
    verdict: c.fake_verdict ?? 'confirmed',
    reason: 'fake: 出典の本文で確かめた',
    opened_urls: [],
  }));
  return {
    id: `msg_fake_${crypto.randomUUID().slice(0, 8)}`,
    type: 'message',
    role: 'assistant',
    model,
    container: pauseTurns > 0 ? fakeContainer : null,
    content: [{ type: 'tool_use', id: 'toolu_fake_1', name: 'report_verdicts', input: { verdicts, overall_note: 'fake', figures: figures.map((path) => ({ path, verdict: 'ok', reason: 'fake: 図を確かめた' })), analogy_gaps: [], videos: videos.map((id) => ({ id, verdict: 'ok', reason: 'fake: 動画の記録を確かめた' })) }, caller: { type: 'direct' } }],
    stop_reason: 'tool_use',
    stop_sequence: null,
    usage: { input_tokens: 12000, output_tokens: 800, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  } as unknown as Message;
}

/** 収集部隊の Haiku 仕分け（fixture: scout/haiku.json） */
async function scoutMessage(db: D1Database, params: MessageCreateParamsNonStreaming): Promise<Message> {
  await appendCall(db, {
    op: 'messages.create',
    at: nowIso(),
    params: { model: params.model, max_tokens: params.max_tokens, output_format: params.output_config?.format?.type ?? null, effort: params.output_config?.effort ?? null },
  });
  const fx = JSON.parse(FIXTURE_FILES['scout/haiku.json'] ?? '{}') as { stop_reason?: string; usage?: Record<string, number>; output?: unknown };
  return {
    id: `msg_fake_${crypto.randomUUID().slice(0, 8)}`,
    type: 'message',
    role: 'assistant',
    model: params.model,
    container: null,
    content: [{ type: 'text', text: JSON.stringify(fx.output ?? {}), citations: null }],
    stop_reason: fx.stop_reason ?? 'end_turn',
    stop_sequence: null,
    usage: { cache_creation_input_tokens: 0, cache_read_input_tokens: 0, ...(fx.usage ?? {}) },
  } as unknown as Message;
}

const rfc822 = (d: Date) => d.toUTCString();
/** fixture の {{DAYS_AGO_RFC822:n}} / {{DAYS_AGO_ISO:n}} を今からの日付に置き換える（日付で絞る処理を毎回通すため） */
export function fillFeedDates(xml: string, now: Date = new Date()): string {
  return xml.replace(/\{\{DAYS_AGO_(RFC822|ISO):(\d+)\}\}/g, (_m, fmt: string, n: string) => {
    const d = new Date(now.getTime() - Number(n) * 86_400_000);
    return fmt === 'ISO' ? d.toISOString() : rfc822(d);
  });
}

/**
 * 収集部隊の RSS 取得の fake（§K-8: FactoryPort でなく fetch を差し替える）。
 * scout-sources の 1 本目に RSS fixture、2 本目に Atom fixture、3 本目以降は text/html（対象外の種類なので捨てられる）を返す。外部へは出ない
 */
export const feedFetch: typeof fetch = async (input) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
  const i = SCOUT_FEEDS.indexOf(url);
  if (i === 0) return new Response(fillFeedDates(FIXTURE_FILES['scout/feed-rss.xml'] ?? ''), { status: 200, headers: { 'content-type': 'application/rss+xml; charset=utf-8' } });
  if (i === 1) return new Response(fillFeedDates(FIXTURE_FILES['scout/feed-atom.xml'] ?? ''), { status: 200, headers: { 'content-type': 'application/atom+xml' } });
  return new Response('<html><body>not a feed</body></html>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
};

/** /__fake/settings（POST {scenario}）と /__fake/calls（GET ?session_id=）。呼び出し元で Access を通過済み */
export async function handleFakeControl(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const openai = await handleFakeOpenAiControl(request, env);
  if (openai) return openai;
  const topics = await handleTopicsFakeControl(request, env);
  if (topics) return topics;
  const j = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  if (url.pathname === '/__fake/settings' && request.method === 'POST') {
    let b: { scenario?: unknown } = {};
    try {
      b = (await request.json()) as { scenario?: unknown };
    } catch {
      return j(400, { error: 'invalid_json' });
    }
    if (typeof b.scenario !== 'string' || !SCENARIOS.includes(b.scenario)) return j(400, { error: 'unknown_scenario', scenarios: SCENARIOS });
    await setSetting(env.DB, 'fake_scenario', b.scenario);
    await setSetting(env.DB, 'fake_enabled', '1');
    return j(200, { scenario: b.scenario, fake_enabled: true });
  }
  // smoke (j) 用: ローカル R2 のキーの有無と大きさだけを返す（本文は返さない。materials/ 配下だけ）。
  // wrangler dev が開いているローカル状態に外部ツールを当てずに、Worker 自身の binding で確かめるため
  if (url.pathname === '/__fake/r2-head' && request.method === 'GET') {
    const key = url.searchParams.get('key') ?? '';
    if (!key.startsWith('materials/') || key.includes('..')) return j(400, { error: 'bad_key' });
    const obj = await env.R2.head(key);
    return j(200, { exists: obj !== null, size: obj?.size ?? null });
  }
  // smoke（§O-8）: 既存の session に職人の event（agent.custom_tool_use・status_idle 等）とファイル（本文を直接）を足す。
  // image_id は登録の時に決まるので、image_id を参照する material.json を fixture に置けない（smoke が実行時に作って足す）
  if (url.pathname === '/__fake/session-append' && request.method === 'POST') {
    let b: { session_id?: unknown; events?: unknown; files?: unknown; status?: unknown; list_cost?: unknown } = {};
    try {
      b = (await request.json()) as typeof b;
    } catch {
      return j(400, { error: 'invalid_json' });
    }
    if (typeof b.session_id !== 'string') return j(400, { error: 'bad_session' });
    try {
      buildView(await readCalls(env.DB), b.session_id);
    } catch {
      return j(404, { error: 'not_found' });
    }
    const events = Array.isArray(b.events) ? (b.events as Array<Record<string, unknown>>).filter((e) => e && typeof e === 'object' && typeof e.type === 'string') : [];
    const files = Array.isArray(b.files)
      ? (b.files as Array<{ filename?: unknown; content?: unknown }>).filter((f) => typeof f?.filename === 'string' && typeof f?.content === 'string').map((f) => ({ filename: f.filename as string, content: f.content as string }))
      : [];
    await appendCall(env.DB, {
      op: 'fake.append',
      at: nowIso(),
      session_id: b.session_id,
      events,
      append: {
        key: crypto.randomUUID(),
        files,
        ...(typeof b.status === 'string' ? { status: b.status } : {}),
        ...(typeof b.list_cost === 'string' ? { list_cost: b.list_cost } : {}),
      },
    });
    return j(200, { events: events.length, files: files.length });
  }
  // smoke (i11): session の、type を含む次の送信を count 回失敗させる
  if (url.pathname === '/__fake/fail-sends' && request.method === 'POST') {
    let b: { session_id?: unknown; type?: unknown; count?: unknown } = {};
    try {
      b = (await request.json()) as typeof b;
    } catch {
      return j(400, { error: 'invalid_json' });
    }
    if (typeof b.session_id !== 'string' || typeof b.type !== 'string' || !Number.isInteger(b.count)) return j(400, { error: 'bad_request' });
    let all: SendFailures = {};
    try {
      all = JSON.parse((await getSetting(env.DB, 'fake_send_fail_json')) ?? '{}') as SendFailures;
    } catch {
      all = {};
    }
    all[b.session_id] = { type: b.type, count: b.count as number };
    await setSetting(env.DB, 'fake_send_fail_json', JSON.stringify(all));
    return j(200, { ok: true });
  }
  if (url.pathname === '/__fake/calls' && request.method === 'GET') {
    const sid = url.searchParams.get('session_id');
    const calls = await readCalls(env.DB);
    return j(200, { calls: sid ? calls.filter((c) => c.session_id === sid) : calls });
  }
  return j(404, { error: 'not_found' });
}
