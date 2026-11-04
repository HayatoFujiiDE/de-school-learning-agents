// fake 実装（契約 §I）。src/anthropic.ts の fakeAllowed() ガード内からだけ読み込まれる（ANTHROPIC_FAKE='1' かつ localhost、
// または scheduled で settings.fake_enabled='1'）。本番ではこのモジュールに到達しない。
//
// fixture: test/fixtures/<scenario>/{session,events,files,verify}.json（scripts/sync-claude-assets.sh が fixtures.generated.ts に埋め込む）
//   session.json: {"initial": {"status","list_cost"}, "after": {"<送った event type>": {...}}}
//   events.json:  {"initial": [event...], "after": {"<type>": [event...]}}   … 送った event の echo の後ろに足す（同じ type は最初の 1 回だけ）
//   files.json:   {"initial": [{"filename","fixture"}], "after": {"<type>": [...]}}  … filename ごとに上書き
// 送った events と messages.create の引数は settings.fake_calls_json に追記する（smoke が (g)(h) を確認する）。

import type { Message, MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/messages/messages';
import type { MessageBatchIndividualResponse } from '@anthropic-ai/sdk/resources/messages/batches';
import { BATCH_LIST_LIMIT, BATCH_RESULTS_MAX_BYTES, PortError, type BatchView, type FactoryPort, type FileMeta, type SessionView } from '../anthropic';
import { getSetting, nowIso, setSetting } from '../db';
import type { Env } from '../env';
import { SCOUT_FEEDS } from '../generated/scout-sources';
import { SCOUT_MODEL } from '../scout';
import { parseXaiResponse } from '../xai';
import { FIXTURE_FILES } from './fixtures.generated';

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
  verify?: { claims_text: string; assistant_turns: number };
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
  files: Map<string, string>; // filename → fixture path
}

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
  for (const f of fls.initial ?? []) files.set(f.filename, f.fixture);

  const seen = new Set<string>();
  let n = 0;
  for (const c of calls) {
    if (c.session_id !== sessionId) continue;
    if (c.op === 'sessions.archive') status = 'terminated';
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
  return { scenario: sc, status, listCost, metadata: create.metadata ?? {}, created_at: create.at, events, files };
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
      await appendCall(db, { op: 'events.send', at: nowIso(), session_id: id, events: events as unknown as Array<Record<string, unknown>> });
    },
    async archiveSession(id) {
      await appendCall(db, { op: 'sessions.archive', at: nowIso(), session_id: id });
    },
    async listFilesPage(sessionId, page) {
      const v = buildView(await readCalls(db), sessionId);
      const out: FileMeta[] = [];
      let i = 0;
      for (const [filename, fixture] of v.files) {
        const text = FIXTURE_FILES[fixture];
        if (text === undefined) continue;
        // 本物の Files API は filename にディレクトリを含めず basename だけを返す（契約 §E-0 / §R-41）。fixture の filename は論理パスのまま置く
        const basename = filename.slice(filename.lastIndexOf('/') + 1);
        out.push({ id: `file_fake_${b64url(fixture)}`, filename: basename, size_bytes: enc.encode(text).byteLength, created_at: new Date(Date.parse(v.created_at) + i++).toISOString() });
      }
      return paginate(out, page, 'files:');
    },
    async downloadFile(fileId) {
      if (!fileId.startsWith('file_fake_')) throw notFound();
      const text = FIXTURE_FILES[unb64url(fileId.slice('file_fake_'.length))];
      if (text === undefined) throw notFound();
      return enc.encode(text);
    },
    async createMessage(params: MessageCreateParamsNonStreaming): Promise<Message> {
      if (params.model === SCOUT_MODEL) return scoutMessage(db, params);
      const content = typeof params.messages[0]?.content === 'string' ? params.messages[0].content : '';
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
      return verifierReply(params.model, extractTagged(content, 'claims_json') ?? '{"claims":[]}', params.messages.filter((m) => m.role === 'assistant').length);
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
        const first = r.params.messages[0]?.content;
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
            claims_text: extractTagged(typeof first === 'string' ? first : '', 'claims_json') ?? '{"claims":[]}',
            assistant_turns: r.params.messages.filter((m) => m.role === 'assistant').length,
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
        if (Number(k.fake_results_bytes ?? 0) > (o?.maxBytes ?? BATCH_RESULTS_MAX_BYTES)) return [];
        const rt = typeof k.fake_batch_result === 'string' ? k.fake_batch_result : 'succeeded';
        if (rt !== 'succeeded') return [{ custom_id: c.custom_id ?? '', result: { type: rt } } as unknown as MessageBatchIndividualResponse];
        const message = verifierReply(VERIFIER_FAKE_MODEL, c.verify.claims_text, c.verify.assistant_turns);
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
 * 最上位の fake_pause_turns: n があれば、assistant の turn が n 未満の間は container 付きの pause_turn を返す
 */
function verifierReply(model: string, claimsText: string, assistantTurns: number): Message {
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
    content: [{ type: 'tool_use', id: 'toolu_fake_1', name: 'report_verdicts', input: { verdicts, overall_note: 'fake' }, caller: { type: 'direct' } }],
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
  if (url.pathname === '/__fake/calls' && request.method === 'GET') {
    const sid = url.searchParams.get('session_id');
    const calls = await readCalls(env.DB);
    return j(200, { calls: sid ? calls.filter((c) => c.session_id === sid) : calls });
  }
  return j(404, { error: 'not_found' });
}
