// fake 実装（契約 §I）。src/anthropic.ts の fakeAllowed() ガード内からだけ読み込まれる（ANTHROPIC_FAKE='1' かつ localhost、
// または scheduled で settings.fake_enabled='1'）。本番ではこのモジュールに到達しない。
//
// fixture: test/fixtures/<scenario>/{session,events,files,verify}.json（scripts/sync-claude-assets.sh が fixtures.generated.ts に埋め込む）
//   session.json: {"initial": {"status","list_cost"}, "after": {"<送った event type>": {...}}}
//   events.json:  {"initial": [event...], "after": {"<type>": [event...]}}   … 送った event の echo の後ろに足す（同じ type は最初の 1 回だけ）
//   files.json:   {"initial": [{"filename","fixture"}], "after": {"<type>": [...]}}  … filename ごとに上書き
// 送った events と messages.create の引数は settings.fake_calls_json に追記する（smoke が (g)(h) を確認する）。

import type { Message, MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/messages/messages';
import { PortError, type FactoryPort, type FileMeta, type SessionView } from '../anthropic';
import { getSetting, nowIso, setSetting } from '../db';
import type { Env } from '../env';
import { FIXTURE_FILES } from './fixtures.generated';

interface Call {
  op: string;
  at: string;
  session_id?: string;
  scenario?: string;
  metadata?: Record<string, string>;
  events?: Array<Record<string, unknown>>;
  params?: Record<string, unknown>;
}

interface Staged<T> {
  initial?: T;
  after?: Record<string, T>;
}

export const SCENARIOS = [
  ...new Set(
    Object.keys(FIXTURE_FILES)
      .map((k) => k.split('/')[0])
      .filter((s) => !s.startsWith('_')),
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
    async listEvents(id, { order, max }) {
      const v = buildView(await readCalls(db), id);
      const evs = order === 'desc' ? [...v.events].reverse() : v.events;
      return evs.slice(0, max);
    },
    async sendEvents(id, events) {
      buildView(await readCalls(db), id); // 存在確認
      await appendCall(db, { op: 'events.send', at: nowIso(), session_id: id, events: events as unknown as Array<Record<string, unknown>> });
    },
    async archiveSession(id) {
      await appendCall(db, { op: 'sessions.archive', at: nowIso(), session_id: id });
    },
    async listFiles(sessionId, max) {
      const v = buildView(await readCalls(db), sessionId);
      const out: FileMeta[] = [];
      let i = 0;
      for (const [filename, fixture] of v.files) {
        const text = FIXTURE_FILES[fixture];
        if (text === undefined) continue;
        out.push({ id: `file_fake_${b64url(fixture)}`, filename, size_bytes: enc.encode(text).byteLength, created_at: new Date(Date.parse(v.created_at) + i++).toISOString() });
      }
      return out.slice(0, max);
    },
    async downloadFile(fileId) {
      if (!fileId.startsWith('file_fake_')) throw notFound();
      const text = FIXTURE_FILES[unb64url(fileId.slice('file_fake_'.length))];
      if (text === undefined) throw notFound();
      return enc.encode(text);
    },
    async createMessage(params: MessageCreateParamsNonStreaming): Promise<Message> {
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
        },
      });
      // claims.json の各 claim に fixture 専用キー fake_verdict があればそれを、無ければ confirmed を返す
      const claimsText = extractTagged(content, 'claims_json') ?? '{"claims":[]}';
      let claims: Array<{ id: string; fake_verdict?: string }> = [];
      try {
        claims = (JSON.parse(claimsText) as { claims?: Array<{ id: string; fake_verdict?: string }> }).claims ?? [];
      } catch {
        claims = [];
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
        model: params.model,
        content: [{ type: 'tool_use', id: 'toolu_fake_1', name: 'report_verdicts', input: { verdicts, overall_note: 'fake' }, caller: { type: 'direct' } }],
        stop_reason: 'tool_use',
        stop_sequence: null,
        usage: { input_tokens: 12000, output_tokens: 800, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      } as unknown as Message;
    },
  };
}

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
  if (url.pathname === '/__fake/calls' && request.method === 'GET') {
    const sid = url.searchParams.get('session_id');
    const calls = await readCalls(env.DB);
    return j(200, { calls: sid ? calls.filter((c) => c.session_id === sid) : calls });
  }
  return j(404, { error: 'not_found' });
}
