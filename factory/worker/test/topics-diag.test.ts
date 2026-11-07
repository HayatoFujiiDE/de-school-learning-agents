// contract-T v2.8: お題の run の観測（topic_runs.diag_json）と max_tokens。
// (a) done の run に diag_json が入り、calls の数・stop_reason が合う
// (b) topics: [] + empty_reason → failed: no_valid_topic で diag の empty_reason が入る
// (c) 知らない empty_reason / 長い文字列は 'other'
// (d) URL・本文・検索語が diag に入らない
// (e) cost_cap・pause_turn の続き・催促の各経路で turns と nudged が合う
// (f) migration 0008 が既存のテストの D1（0007 まで + 行）に当たる
// (g) max_tokens と途中で切れた save_topics → failed: max_tokens（no_valid_topic にならない）・台帳は実額。max_tokens は 16000
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { Message } from '@anthropic-ai/sdk/resources/messages/messages';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildRunDiag, DIAG_MAX_CHARS } from '../src/topics/diag';
import { runTopicRun } from '../src/topics/gen';
import { TOPIC_REASON_LABELS } from '../src/topics/locale';
import { EMPTY_REASONS } from '../src/topics/prompts';
import { TOPIC_GEN_MAX_TOKENS } from '../src/topics/store';
import { apiError, enable, fetchStub, genMessage, ledger, migratedDb, philoBody, scriptedPort, talkBody, tomorrow, topicEnv } from './topics-helpers';

let db: DatabaseSync;
const { fetchImpl } = fetchStub({});
const far = () => Date.now() + 10 * 60_000;
const genReq = (kind: 'talk' | 'philo' = 'talk') => ({ purpose: 'gen' as const, kind, trigger: 'manual' as const, slotDay: tomorrow() });
const run = () => db.prepare('SELECT * FROM topic_runs ORDER BY rowid DESC LIMIT 1').get() as Record<string, unknown>;
const diag = () => {
  const s = run().diag_json;
  expect(typeof s).toBe('string');
  return JSON.parse(s as string) as Record<string, unknown> & { calls: Array<Record<string, unknown>> };
};

/** 1 回の応答（7 セント = 入力 20000 × $2 + 出力 3000 × $10） */
function msgOf(content: unknown[], stop: string, u: Record<string, unknown> = {}): Message {
  return {
    id: 'msg_x',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5-5',
    content,
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 20000, output_tokens: 3000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 }, ...u },
  } as unknown as Message;
}
const paused = (id = 'srvtoolu_p') => msgOf([{ type: 'server_tool_use', id, name: 'web_search', input: { query: 'ひみつの検索語' } }, { type: 'web_search_tool_result', tool_use_id: id, content: [] }], 'pause_turn');
const ended = () => msgOf([{ type: 'text', text: 'おわり' }], 'end_turn');
const saveMsg = (input: unknown, stop = 'tool_use') => msgOf([{ type: 'tool_use', id: 'toolu_1', name: 'save_topics', input }], stop);

beforeEach(() => {
  db = migratedDb();
  enable(db);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('v2.8 diag_json', () => {
  it('(a) done の run: diag_json に calls（呼び出しの数）・stop_reason・usage の数・save_called・offered', async () => {
    const p = scriptedPort([paused(), genMessage([talkBody()], { searches: 1 })]);
    const o = await runTopicRun(topicEnv(db), p.port, genReq(), { deadline: far(), fetchImpl });
    expect(o.status).toBe('done');
    const d = diag();
    expect(d).toMatchObject({ v: 1, turns: 2, nudged: false, stop: null, save_called: true, offered: 1, dropped_reasons: {}, empty_reason: null });
    expect(d.calls).toHaveLength(2);
    expect(d.calls.map((c) => c.stop_reason)).toEqual(['pause_turn', 'tool_use']);
    expect(d.calls[0]).toMatchObject({ turn: 0, in: 20000, out: 3000, cache_w: 0, cache_r: 0, searches: 0, fetches: 0, fetch_errors: {}, pending_server_tool: false });
    expect(d.calls[1]).toMatchObject({ turn: 1, searches: 1 });
    expect(typeof d.calls[0].ms).toBe('number');
    expect(d.calls[0]).not.toHaveProperty('blocks');
    // API（GET /api/topics/runs の toRunRow）は変えない
    const { toRunRow } = await import('../src/topics/store');
    expect(toRunRow(run() as never)).not.toHaveProperty('diag_json');
  });

  it('(a) 捨てた本の理由コードを数える（dropped_reasons）', async () => {
    const bad = { ...talkBody(), schema_version: 2 };
    const p = scriptedPort([genMessage([bad, talkBody()])]);
    await runTopicRun(topicEnv(db), p.port, genReq(), { deadline: far(), fetchImpl });
    expect(run()).toMatchObject({ status: 'done', made: 1, dropped: 1 });
    expect(diag()).toMatchObject({ offered: 2, dropped_reasons: { schema_version: 1 } });
  });

  it('(b) topics: [] + empty_reason → failed: no_valid_topic・diag の empty_reason', async () => {
    const p = scriptedPort([saveMsg({ topics: [], empty_reason: 'rules_not_met' })]);
    const o = await runTopicRun(topicEnv(db), p.port, genReq('philo'), { deadline: far(), fetchImpl });
    expect(o.status).toBe('failed');
    expect(run()).toMatchObject({ status: 'failed', error: 'no_valid_topic', made: 0, dropped: 0, cents: 7 });
    expect(diag()).toMatchObject({ turns: 1, save_called: true, offered: 0, empty_reason: 'rules_not_met' });
    // 書いていなければ null
    const p2 = scriptedPort([saveMsg({ topics: [] })]);
    await runTopicRun(topicEnv(db), p2.port, genReq('talk'), { deadline: far(), fetchImpl });
    expect(diag()).toMatchObject({ save_called: true, offered: 0, empty_reason: null });
  });

  it('(b) topics が空でない時は empty_reason を無視する', async () => {
    const p = scriptedPort([saveMsg({ topics: [talkBody()], empty_reason: 'no_sources_found' })]);
    await runTopicRun(topicEnv(db), p.port, genReq(), { deadline: far(), fetchImpl });
    expect(run()).toMatchObject({ status: 'done' });
    expect(diag().empty_reason).toBeNull();
  });

  it('(b) save_topics の schema に任意の empty_reason（enum）が足され、required は topics だけ', async () => {
    const p = scriptedPort([genMessage([talkBody()])]);
    await runTopicRun(topicEnv(db), p.port, genReq(), { deadline: far(), fetchImpl });
    const tools = p.calls[0].params.tools as Array<{ name: string; input_schema?: { required: string[]; properties: Record<string, { enum?: string[]; description?: string }> } }>;
    const s = tools.find((t) => t.name === 'save_topics')!.input_schema!;
    expect(s.required).toEqual(['topics']);
    expect(Object.keys(s.properties)).toEqual(['topics', 'empty_reason']);
    expect(s.properties.empty_reason.enum).toEqual([...EMPTY_REASONS]);
    expect(s.properties.empty_reason.description).toContain('topics が空の配列の時は、作れなかった理由を 1 つ選びます');
  });

  it('(c) 知らない empty_reason・長い文字列・形の合わない stop_reason / fetch のエラーコードは other', async () => {
    const weird = msgOf(
      [
        { type: 'server_tool_use', id: 'f1', name: 'web_fetch', input: { url: 'https://secret.example.org/a' } },
        { type: 'web_fetch_tool_result', tool_use_id: 'f1', content: { type: 'web_fetch_tool_result_error', error_code: 'Not-A-Code' } },
        { type: 'tool_use', id: 'toolu_1', name: 'save_topics', input: { topics: [], empty_reason: 'because_i_said_so' } },
      ],
      'tool_use',
    );
    const p = scriptedPort([weird]);
    await runTopicRun(topicEnv(db), p.port, genReq(), { deadline: far(), fetchImpl });
    const d = diag();
    expect(d.empty_reason).toBe('other');
    expect(d.calls[0].fetch_errors).toEqual({ other: 1 });
    const p2 = scriptedPort([saveMsg({ topics: [], empty_reason: 'x'.repeat(500) }, 'a'.repeat(60))]);
    await runTopicRun(topicEnv(db), p2.port, genReq('philo'), { deadline: far(), fetchImpl });
    const d2 = diag();
    expect(d2.empty_reason).toBe('other');
    expect(d2.calls[0].stop_reason).toBe('other');
    // 組み立ての部品: 列挙値以外は other・鍵の数と全体の長さに上限
    const many = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`code_${'a'.repeat(30)}${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`, 1]));
    const s = buildRunDiag({ turns: 1, nudged: false, calls: [], stop: 'Stop-Max', saveCalled: true, offered: 0, droppedReasons: many, emptyReason: 42 })!;
    expect(s.length).toBeLessThanOrEqual(DIAG_MAX_CHARS);
    const o = JSON.parse(s);
    expect(o.stop).toBe('other');
    expect(o.empty_reason).toBe('other');
    expect(Object.keys(o.dropped_reasons).length).toBeLessThanOrEqual(21);
    expect(o.dropped_reasons.other).toBe(480);
  });

  it('(d) URL・本文・検索語は diag に入らない（数と列挙値だけ）', async () => {
    const b = philoBody('ひみつの題名');
    const first = msgOf(
      [
        { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'ひみつの検索語' } },
        { type: 'web_search_tool_result', tool_use_id: 's1', content: [{ type: 'web_search_result', url: 'https://secret.example.org/s', title: 'ひみつの見出し' }] },
        { type: 'server_tool_use', id: 'f1', name: 'web_fetch', input: { url: b.sources[0].url } },
        { type: 'web_fetch_tool_result', tool_use_id: 'f1', content: { type: 'web_fetch_result', url: b.sources[0].url, content: { type: 'document', source: { type: 'text', media_type: 'text/plain', data: `ひみつの本文。${b.sources[0].quote}` } } } },
        { type: 'text', text: 'ひみつの文' },
      ],
      'pause_turn',
    );
    const p = scriptedPort([first, genMessage([b, { ...b, schema_version: 9, title: { s: 'ひみつ2', e: 'ひみつ2' } }])]);
    await runTopicRun(topicEnv(db), p.port, genReq('philo'), { deadline: far(), fetchImpl });
    const s = run().diag_json as string;
    for (const x of ['ひみつ', 'secret.example.org', 'src.example.org', 'https://', b.sources[0].quote]) expect(s).not.toContain(x);
    // 値は数・真偽・null・既知の形の文字列だけ
    const walk = (v: unknown): void => {
      if (typeof v === 'string') expect(v).toMatch(/^[a-z_]{1,40}$/);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) (expect(k).toMatch(/^[a-z_]{1,40}$/), walk(x));
      else expect(v === null || typeof v === 'number' || typeof v === 'boolean').toBe(true);
    };
    walk(JSON.parse(s));
  });

  it('(e) cost_cap: turns 1・nudged false・stop cost_cap', async () => {
    const env = topicEnv(db, { TOPIC_GEN_RESERVE_CENTS: '10' });
    const p = scriptedPort([paused(), genMessage([talkBody()])]);
    await runTopicRun(env, p.port, genReq(), { deadline: far(), fetchImpl });
    expect(run()).toMatchObject({ status: 'failed', error: 'cost_cap' });
    expect(diag()).toMatchObject({ turns: 1, nudged: false, stop: 'cost_cap', save_called: false });
    expect(diag().calls).toHaveLength(1);
  });

  it('(e) pause_turn の続き 3 回 → turn_limit: turns 4・nudged false・calls 4', async () => {
    const p = scriptedPort([paused('a'), paused('b'), paused('c'), paused('d')]);
    await runTopicRun(topicEnv(db), p.port, genReq(), { deadline: far(), fetchImpl });
    expect(run()).toMatchObject({ status: 'failed', error: 'no_output' });
    const d = diag();
    expect(d).toMatchObject({ turns: 4, nudged: false, stop: 'turn_limit' });
    expect(d.calls.map((c) => c.turn)).toEqual([0, 1, 2, 3]);
  });

  it('(e) 催促 → save → done: turns 2・nudged true / 催促の後も end_turn → no_output: nudged true・stop stop_end_turn', async () => {
    const p = scriptedPort([ended(), genMessage([talkBody()])]);
    await runTopicRun(topicEnv(db), p.port, genReq(), { deadline: far(), fetchImpl });
    expect(run()).toMatchObject({ status: 'done' });
    expect(diag()).toMatchObject({ turns: 2, nudged: true, stop: null, save_called: true });
    const p2 = scriptedPort([ended(), ended()]);
    await runTopicRun(topicEnv(db), p2.port, genReq('philo'), { deadline: far(), fetchImpl });
    expect(run()).toMatchObject({ status: 'failed', error: 'no_output' });
    expect(diag()).toMatchObject({ turns: 2, nudged: true, stop: 'stop_end_turn', save_called: false });
  });

  it('(e) 呼び出しの失敗で閉じる経路にも diag（最初の失敗は turns 0・続きの途中は それまでの calls）', async () => {
    const p = scriptedPort([apiError(429)]);
    await runTopicRun(topicEnv(db), p.port, genReq(), { deadline: far(), fetchImpl });
    expect(run()).toMatchObject({ status: 'failed', error: 'rate_limited' });
    expect(diag()).toMatchObject({ turns: 0, calls: [] });
    const p2 = scriptedPort([paused(), apiError(529)]);
    await runTopicRun(topicEnv(db), p2.port, genReq('philo'), { deadline: far(), fetchImpl });
    expect(run()).toMatchObject({ status: 'failed', error: 'overloaded' });
    expect(diag()).toMatchObject({ turns: 1 });
    expect(diag().calls).toHaveLength(1);
  });
});

describe('v2.8 max_tokens', () => {
  it('(g) 生成の max_tokens は 16000（全部の種類で同じ）', async () => {
    expect(TOPIC_GEN_MAX_TOKENS).toBe(16000);
    for (const kind of ['talk', 'philo'] as const) {
      const p = scriptedPort([genMessage([kind === 'talk' ? talkBody() : philoBody()])]);
      await runTopicRun(topicEnv(db), p.port, genReq(kind), { deadline: far(), fetchImpl });
      expect(p.calls[0].params.max_tokens).toBe(16000);
    }
  });

  it('(g) stop_reason max_tokens + 途中で切れた save_topics → failed: max_tokens（no_valid_topic にしない）・お題 0・台帳は実額・diag', async () => {
    const cut = msgOf(
      [
        { type: 'thinking', thinking: '', signature: 'x' },
        { type: 'tool_use', id: 'toolu_1', name: 'save_topics', input: {} },
      ],
      'max_tokens',
      { input_tokens: 20000, output_tokens: 16000 },
    );
    const p = scriptedPort([cut, genMessage([talkBody()])]);
    const o = await runTopicRun(topicEnv(db), p.port, genReq('philo'), { deadline: far(), fetchImpl });
    expect(o.status).toBe('failed');
    expect(p.calls).toHaveLength(1);
    // 20000 × $2 + 16000 × $10 = 200000 µ$ = 20 セント
    expect(run()).toMatchObject({ status: 'failed', error: 'max_tokens', made: 0, dropped: 0, cents: 20 });
    expect(ledger(db).filter((r) => r.ref_id.startsWith('tp:')).map((r) => r.cents)).toEqual([20]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM topics').get()).toEqual({ n: 0 });
    expect(diag()).toMatchObject({ turns: 1, stop: 'max_tokens', save_called: true, offered: 0 });
    expect(diag().calls[0]).toMatchObject({ stop_reason: 'max_tokens', out: 16000 });
  });

  it('(g) max_tokens で切れた save_topics に形の合う本が入っていても保存しない', async () => {
    const p = scriptedPort([saveMsg({ topics: [talkBody()] }, 'max_tokens')]);
    await runTopicRun(topicEnv(db), p.port, genReq(), { deadline: far(), fetchImpl });
    expect(run()).toMatchObject({ status: 'failed', error: 'max_tokens', made: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM topics').get()).toEqual({ n: 0 });
  });

  it('(g) max_tokens の表示名（記録のタブ）', () => {
    expect(TOPIC_REASON_LABELS.max_tokens).toBe('書いている途中で長さの上限に当たりました');
    const js = readFileSync(new URL('../public/admin/topics.js', import.meta.url), 'utf8');
    expect(js).toContain("max_tokens: '書いている途中で長さの上限に当たりました'");
  });
});

describe('v2.8 migration 0008', () => {
  it('(f) 0007 までの D1 に行を入れてから 0008 を当てる: 既存の行はそのまま・diag_json は NULL', () => {
    const sql = (f: string) => readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8');
    const d = new DatabaseSync(':memory:');
    for (const f of ['0001_init.sql', '0002_intake.sql', '0003_review_triage.sql', '0004_image_gen.sql', '0005_topics.sql', '0006_retro.sql', '0007_machine_orders.sql']) d.exec(sql(f));
    const t = '2026-11-07T00:00:00.000Z';
    d.prepare(
      `INSERT INTO topic_runs (id, purpose, kind, slot_day, week, parent_topic_id, trigger, status, error, dropped, made, cents, token, lease_until, created_at, updated_at)
       VALUES ('r1', 'gen', 'philo', '2026-11-08', NULL, NULL, 'manual', 'failed', 'no_valid_topic', 0, 0, 28, 'k', ?, ?, ?)`,
    ).run(t, t, t);
    const before = d.prepare('SELECT * FROM topic_runs').all();
    d.exec(sql('0008_topic_run_diag.sql'));
    const after = d.prepare('SELECT * FROM topic_runs').all() as Array<Record<string, unknown>>;
    expect(after).toHaveLength(1);
    const { diag_json, ...rest } = after[0];
    expect(diag_json).toBeNull();
    expect(rest).toEqual({ ...(before[0] as Record<string, unknown>) });
    // test/d1-shim.ts の migratedDb も 0008 まで当てている
    expect((migratedDb().prepare("SELECT COUNT(*) AS n FROM pragma_table_info('topic_runs') WHERE name = 'diag_json'").get() as { n: number }).n).toBe(1);
  });
});
