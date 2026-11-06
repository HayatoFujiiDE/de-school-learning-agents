// テスト用: お題（contract-T）の本文・env・偽物の port と fetch・行の直接の投入。
import type { DatabaseSync } from 'node:sqlite';
import type { Message, MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/messages/messages';
import { PortError, type CallOpts, type FactoryPort } from '../src/anthropic';
import type { Env } from '../src/env';
import type { RouteCtx } from '../src/http';
import { addDays, type TopicBody } from '../src/topics/schema';
import { insertTopicStmts, TRUE_PRED } from '../src/topics/store';
import { d1, migratedDb } from './d1-shim';

export { migratedDb };

export const loc = (s: string, e: string) => ({ s, e });
export const tokyoToday = (d: Date = new Date()): string => new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
export const tomorrow = (): string => addDays(tokyoToday(), 1);

const SRC = (id: string, path: string, quote = 'これは出典のページに書いてある二十字以上の引用の文章です。') => ({ id, url: `https://src.example.org${path}`, name: '出典', quote });
const asks = () => [
  { level: 'check', text: loc('書いてあることは何ですか', 'なにがかいてある？') },
  { level: 'self', text: loc('自分ならどうしますか', 'じぶんならどうする？') },
  { level: 'open', text: loc('これからどうなると思いますか', 'これからどうなるかな？') },
];
const next = () => ({ talk: loc('話してみよう', 'はなそう'), make_title: loc('図にする', 'えにする'), make_steps: [loc('調べる', 'しらべる'), loc('書く', 'かく'), loc('見せる', 'みせる')] });

export function newsBody(slotDay: string, title = '火星の月の砂を持ち帰る探査機'): TopicBody {
  return {
    schema_version: 1,
    kind: 'news',
    locale: 'ja-JP',
    title: loc(title, title),
    lead: loc('探査機の計画を知ります', 'たんさきのけいかく'),
    event_day: slotDay,
    premises: [],
    facts: [
      { id: 'f1', text: loc('砂を採る', 'すなをとる'), source_ids: ['s1'] },
      { id: 'f2', text: loc('地球へ持ち帰る', 'もちかえる'), source_ids: ['s1'] },
    ],
    views: [],
    asks: asks(),
    stances: [
      { id: 'a', label: loc('賛成', 'さんせい') },
      { id: 'b', label: loc('迷う', 'まよう') },
    ],
    next: next(),
    make: null,
    sources: [SRC('s1', '/news/1')],
    tags: { interests: ['basics'], concept_codes: [] },
  } as TopicBody;
}

export function talkBody(title = '休み時間のボールはだれのもの'): TopicBody {
  return {
    schema_version: 1,
    kind: 'talk',
    locale: 'ja-JP',
    title: loc(title, title),
    lead: loc('みんなで使う物のきまり', 'みんなのもののきまり'),
    event_day: null,
    premises: [{ text: loc('ある日の休み時間の場面', 'あるひのやすみじかん') }],
    facts: [],
    views: [
      { id: 'v1', who: { name: '先に来た人が使うという考え', type: 'position' }, side: 'a', stance: loc('先に来た人', 'さきにきたひと'), source_ids: [] },
      { id: 'v2', who: { name: '順番に使うという考え', type: 'position' }, side: 'b', stance: loc('順番', 'じゅんばん'), source_ids: [] },
    ],
    asks: asks(),
    stances: [
      { id: 'a', label: loc('先に来た人', 'さき') },
      { id: 'b', label: loc('順番', 'じゅんばん') },
    ],
    next: next(),
    make: null,
    sources: [],
    tags: { interests: ['basics'], concept_codes: [] },
  } as TopicBody;
}

export function philoBody(title = '全部の部品を取り替えた船は同じ船か'): TopicBody {
  return {
    schema_version: 1,
    kind: 'philo',
    locale: 'ja-JP',
    title: loc(title, title),
    lead: loc('同じとは何か', 'おなじってなに'),
    event_day: null,
    premises: [],
    facts: [{ id: 'f1', text: loc('昔からある問い', 'むかしからあるとい'), source_ids: ['s1'] }],
    views: [
      { id: 'v1', who: { name: 'ある哲学者', type: 'person' }, side: 'a', stance: loc('同じだ', 'おなじ'), source_ids: ['s2'] },
      { id: 'v2', who: { name: '別だという考え', type: 'position' }, side: 'b', stance: loc('別だ', 'べつ'), source_ids: [] },
    ],
    asks: asks(),
    stances: [
      { id: 'a', label: loc('同じ', 'おなじ') },
      { id: 'b', label: loc('違う', 'ちがう') },
    ],
    next: next(),
    make: null,
    sources: [SRC('s1', '/philo/1'), SRC('s2', '/philo/2', 'ある哲学者は、部品が変わっても同じ船だと述べたと伝えられています。')],
    tags: { interests: ['basics'], concept_codes: [] },
  } as TopicBody;
}

export function makeBody(title = '消しゴムでコマ撮りアニメを作る'): TopicBody {
  return {
    schema_version: 1,
    kind: 'make',
    locale: 'ja-JP',
    title: loc(title, title),
    lead: loc('身近な物で動く映像', 'みぢかなものでえいぞう'),
    event_day: null,
    premises: [],
    facts: [],
    views: [],
    asks: [],
    stances: [],
    next: null,
    make: {
      category: 'basics',
      line: loc('少しずつ動かして撮る', 'すこしずつとる'),
      first_step: loc('物を選ぶ', 'ものをえらぶ'),
      need: loc('タブレット', 'タブレット'),
      minutes: 45,
      steps: [loc('置く', 'おく'), loc('撮る', 'とる'), loc('つなぐ', 'つなぐ')],
      safety: false,
      thumb_prompt: null,
    },
    sources: [],
    tags: { interests: ['basics'], concept_codes: [] },
  } as TopicBody;
}

// ---------------------------------------------------------------------------------------------
// env

export function topicEnv(db: DatabaseSync, over: Record<string, string> = {}): Env {
  return { DB: d1(db), DAILY_CAP_CENTS: '1500', VERIFY_TURN_RESERVE_CENTS: '150', ...over } as unknown as Env;
}

export function setSetting(db: DatabaseSync, key: string, value: string): void {
  db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value, new Date().toISOString());
}

export const enable = (db: DatabaseSync): void => setSetting(db, 'topics_enabled', '1');

// ---------------------------------------------------------------------------------------------
// 偽物の port（createMessage だけ。呼び出しの引数と CallOpts を残す）

const no = () => {
  throw new Error('not used in this test');
};

export type Step = Message | Error | ((params: MessageCreateParamsNonStreaming) => Message | Error);

export function scriptedPort(steps: Step[]): { port: FactoryPort; calls: Array<{ params: MessageCreateParamsNonStreaming; opts?: CallOpts }> } {
  const calls: Array<{ params: MessageCreateParamsNonStreaming; opts?: CallOpts }> = [];
  const port = {
    isFake: true,
    createSession: no,
    retrieveSession: no,
    updateSessionBudget: no,
    listSessionsPage: no,
    listEventsPage: no,
    sendEvents: no,
    archiveSession: no,
    listFilesPage: no,
    downloadFile: no,
    async createMessage(params: MessageCreateParamsNonStreaming, opts?: CallOpts) {
      calls.push({ params, opts });
      const s = steps.shift();
      if (s === undefined) throw new Error('no scripted response');
      const v = typeof s === 'function' ? s(params) : s;
      if (v instanceof Error) throw v;
      return v;
    },
    createBatch: no,
    retrieveBatch: no,
    batchResults: no,
    listBatchesPage: no,
    xaiResponses: no,
  } as unknown as FactoryPort;
  return { port, calls };
}

export const apiError = (status: number) => new PortError(true, status, 'api_error');
export const timeoutError = () => new PortError(false, undefined, 'timeout');

const usage = (input = 20000, output = 3000, searches = 0) => ({ input_tokens: input, output_tokens: output, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use: { web_search_requests: searches, web_fetch_requests: 0 } });

/** 生成の応答。fetches は応答の中の web_fetch の結果（URL と本文） */
export function genMessage(bodies: unknown[] | null, o: { fetches?: Array<{ url: string; text: string }>; input?: number; output?: number; searches?: number } = {}): Message {
  const content: unknown[] = [];
  (o.fetches ?? []).forEach((f, i) => {
    content.push({ type: 'server_tool_use', id: `srvtoolu_${i}`, name: 'web_fetch', input: { url: f.url } });
    content.push({ type: 'web_fetch_tool_result', tool_use_id: `srvtoolu_${i}`, content: { type: 'web_fetch_result', url: f.url, content: { type: 'document', source: { type: 'text', media_type: 'text/plain', data: f.text } } } });
  });
  if (bodies !== null) content.push({ type: 'tool_use', id: 'toolu_1', name: 'save_topics', input: { topics: bodies } });
  return { id: 'msg_t', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content, stop_reason: bodies === null ? 'end_turn' : 'tool_use', stop_sequence: null, usage: usage(o.input, o.output, o.searches) } as unknown as Message;
}

export interface CheckIn {
  sources: Array<{ source_id: string; support: string }>;
  sensitivity: 'normal' | 'heavy';
  heavy_reasons: string[];
  flags: string[];
  note: string;
}

export const checkIn = (ids: string[], o: Partial<CheckIn> = {}): CheckIn => ({
  sources: ids.map((source_id) => ({ source_id, support: 'supported' })),
  sensitivity: 'normal',
  heavy_reasons: [],
  flags: [],
  note: 'ok',
  ...o,
});

/** 検査の応答（input = null は save_check が無い応答） */
export function checkMessage(input: unknown | null, o: { input?: number; output?: number } = {}): Message {
  const content = input === null ? [{ type: 'text', text: 'done' }] : [{ type: 'tool_use', id: 'toolu_c', name: 'save_check', input }];
  return { id: 'msg_c', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content, stop_reason: 'tool_use', stop_sequence: null, usage: usage(o.input ?? 3000, o.output ?? 400) } as unknown as Message;
}

/** 渡した抜き書きの id をそのまま supported で返す検査の応答 */
export const supportPassed = (o: Partial<CheckIn> = {}) => (params: MessageCreateParamsNonStreaming): Message => {
  const blocks = (params.messages[0]?.content ?? []) as Array<{ text?: string }>;
  const ids = blocks.map((b) => /^【出典の抜き書き ([^】]+)】/.exec(b.text ?? '')?.[1]).filter((x): x is string => !!x);
  return checkMessage(checkIn(ids, o));
};

// ---------------------------------------------------------------------------------------------
// 偽物の fetch

export type Page = { status?: number; type?: string; body?: string; location?: string };

export function fetchStub(pages: Record<string, Page | (() => Page)>): { fetchImpl: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    calls.push(url);
    const p0 = pages[url];
    if (!p0) return new Response('nf', { status: 404, headers: { 'content-type': 'text/plain' } });
    const p = typeof p0 === 'function' ? p0() : p0;
    const headers: Record<string, string> = { 'content-type': p.type ?? 'text/html; charset=utf-8' };
    if (p.location) headers.location = p.location;
    return new Response(p.body ?? '', { status: p.status ?? 200, headers });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

// ---------------------------------------------------------------------------------------------
// 行の直接の投入

export interface SeedOpts {
  id: string;
  body: TopicBody;
  status?: string;
  slotDay?: string;
  origin?: 'gen' | 'derive' | 'manual';
  lineageId?: string;
  parentId?: string | null;
  deriveKind?: 'refresh' | 'extend' | null;
  depth?: number;
  /** 全部の出典を gen_fetch で found にする（抜き書きは引用そのもの） */
  found?: boolean;
  sensitivity?: 'normal' | 'heavy';
  holdReason?: string | null;
  createdAt?: string;
  starred?: number;
}

export async function seedTopic(db: DatabaseSync, o: SeedOpts): Promise<void> {
  const now = o.createdAt ?? new Date().toISOString();
  const genFound = o.found ? new Map(o.body.sources.map((s) => [s.id, s.quote])) : undefined;
  const stmts = await insertTopicStmts(
    {
      id: o.id,
      body: o.body,
      origin: o.origin ?? (o.parentId ? 'derive' : 'gen'),
      runId: null,
      slotDay: o.slotDay ?? tomorrow(),
      lineageId: o.lineageId ?? o.id,
      parentId: o.parentId ?? null,
      deriveKind: o.deriveKind ?? null,
      depth: o.depth ?? 0,
      genFound,
    },
    now,
    TRUE_PRED,
  );
  db.exec('BEGIN');
  try {
    for (const s of stmts) db.prepare(s.sql).run(...(s.params as Array<string | number | null>));
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  if (o.status || o.sensitivity || o.holdReason !== undefined || o.starred !== undefined) {
    db.prepare('UPDATE topics SET status = ?, sensitivity = ?, hold_reason = ?, starred = ? WHERE id = ?').run(o.status ?? 'draft', o.sensitivity ?? 'normal', o.holdReason ?? null, o.starred ?? 0, o.id);
  }
}

export const topic = (db: DatabaseSync, id: string) => ({ ...(db.prepare('SELECT * FROM topics WHERE id = ?').get(id) as Record<string, unknown>) });
export const count = (db: DatabaseSync, sql: string, ...p: Array<string | number | null>): number => Number((db.prepare(sql).get(...p) as { n: number }).n);
export const ledger = (db: DatabaseSync) => db.prepare("SELECT ref_id, cents FROM cost_ledger WHERE kind = 'topic' ORDER BY rowid").all() as Array<{ ref_id: string; cents: number }>;

export function routeCtx(env: Env, method: string, path: string, body?: unknown, port?: FactoryPort): RouteCtx {
  const request = new Request(`http://localhost${path}`, { method, ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}) });
  return { env, request, url: new URL(request.url), email: 'ops@example.invalid', exec: {} as ExecutionContext, port: async () => port ?? scriptedPort([]).port };
}
