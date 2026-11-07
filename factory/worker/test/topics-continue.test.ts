// contract-T v2.7: お題の生成の続き（pause_turn・end_turn への催促 1 回・回数 / 締め切り / 費用の上限）・キャッシュ・台帳は実額・philo は 2 本。
// (a) pause_turn → 続けて save → done（2 回目の messages の末尾 = 1 回目の content。出典は全部の応答の web_fetch で照合）
// (b) end_turn で save なし → 催促 → save → done（催促は 1 回だけ）
// (c) 4 回目まで save が無い → no_output・呼び出し 4 回 / (d) 費用の見込みが取り置きを超える → 続けず cost_cap
// (e) max_tokens → 続けず failed: max_tokens（v2.8）・ログに stop_reason / (f) genActualCents の cache の単価
// (g) 実額 > 60 → 台帳は実額・上限の判定も実額で数える / (h) philo の本数の上限は 2 / (i) tools の最後と top-level に cache_control
// 費用の見込みは pause_turn の続きも催促も直前の 1 回の実額（凍結 spec 2。催促は新しいターンで max_uses が新しくなるので安く見込まない）
import type { DatabaseSync } from 'node:sqlite';
import type { Message } from '@anthropic-ai/sdk/resources/messages/messages';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { genActualCents, runMaxCount, runTopicRun, TOPIC_GEN_MAX_CONTINUES, TOPIC_SAVE_NUDGE } from '../src/topics/gen';
import { enable, fetchStub, genMessage, ledger, makeBody, migratedDb, philoBody, scriptedPort, talkBody, tomorrow, topicEnv } from './topics-helpers';

let db: DatabaseSync;
let logs: Array<Record<string, unknown>>;
const { fetchImpl } = fetchStub({});
const far = () => Date.now() + 10 * 60_000;
const genReq = (kind: 'talk' | 'philo' | 'make' | 'news' = 'talk') => ({ purpose: 'gen' as const, kind, trigger: 'manual' as const, slotDay: tomorrow() });
const run = () => db.prepare('SELECT * FROM topic_runs ORDER BY rowid DESC LIMIT 1').get() as Record<string, unknown>;
const topicLedger = () => ledger(db).filter((r) => r.ref_id.startsWith('tp:'));
const setting = (k: string) => (db.prepare('SELECT value FROM settings WHERE key = ?').get(k) as { value: string } | undefined)?.value ?? null;
const callLogs = () => logs.filter((l) => l.at === 'topic_call');

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

const searchBlocks = (id: string) => [
  { type: 'server_tool_use', id, name: 'web_search', input: { query: 'q' } },
  { type: 'web_search_tool_result', tool_use_id: id, content: [] },
];
const fetchBlocks = (id: string, url: string, text: string) => [
  { type: 'server_tool_use', id, name: 'web_fetch', input: { url } },
  { type: 'web_fetch_tool_result', tool_use_id: id, content: { type: 'web_fetch_result', url, content: { type: 'document', source: { type: 'text', media_type: 'text/plain', data: text } } } },
];
const paused = (id = 'srvtoolu_p') => msgOf(searchBlocks(id), 'pause_turn');
const ended = () => msgOf([{ type: 'text', text: 'おわり' }], 'end_turn');

beforeEach(() => {
  db = migratedDb();
  enable(db);
  logs = [];
  vi.spyOn(console, 'log').mockImplementation((s: unknown) => {
    try {
      logs.push(JSON.parse(String(s)) as Record<string, unknown>);
    } catch {
      // JSON でないログは数えない
    }
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('v2.7 続きの呼び出し', () => {
  it('(a) pause_turn → 同じ params で続けて save_topics → done。2 回目の messages の末尾は 1 回目の content そのもの・出典は前の応答の web_fetch で照合', async () => {
    const b = philoBody();
    const first = msgOf(
      [
        ...fetchBlocks('srvtoolu_f1', b.sources[0].url, `前置きの文。${b.sources[0].quote}後ろの文。`),
        ...fetchBlocks('srvtoolu_f2', b.sources[1].url, `前置きの文。${b.sources[1].quote}後ろの文。`),
        { type: 'server_tool_use', id: 'srvtoolu_s', name: 'web_search', input: { query: 'q' } },
      ],
      'pause_turn',
    );
    const p = scriptedPort([first, genMessage([b])]);
    const o = await runTopicRun(topicEnv(db), p.port, genReq('philo'), { deadline: far(), fetchImpl });
    expect(o.status).toBe('done');
    expect(p.calls).toHaveLength(2);
    const [c0, c1] = p.calls;
    expect(c0.params.messages).toHaveLength(1); // 0 回目の params は書き換えない
    expect(c1.params.messages).toHaveLength(2);
    expect(c1.params.messages[1]).toEqual({ role: 'assistant', content: first.content });
    expect(c1.params.messages[0]).toEqual(c0.params.messages[0]);
    // 同じ tools・同じ params（messages 以外）
    expect({ ...c1.params, messages: null }).toEqual({ ...c0.params, messages: null });
    expect(c1.opts?.maxRetries).toBe(0);
    // 出典は 1 回目の応答の web_fetch で gen_fetch に
    expect(db.prepare("SELECT COUNT(*) AS n FROM topic_sources WHERE evidence = 'gen_fetch' AND fetch_result = 'found'").get()).toEqual({ n: 2 });
    expect(run()).toMatchObject({ status: 'done', made: 1, cents: 14 });
    expect(topicLedger().map((r) => r.cents)).toEqual([14]);
    // 呼び出しごとのログ（数と種類だけ）と run の終わりの turns・cents
    expect(callLogs()).toHaveLength(2);
    expect(callLogs()[0]).toMatchObject({ turn: 0, stop_reason: 'pause_turn', in: 20000, out: 3000, cache_w: 0, cache_r: 0, fetches: 0, pending_server_tool: true });
    expect(callLogs()[0].blocks).toEqual({ server_tool_use: 3, web_fetch_tool_result: 2 });
    expect(logs.find((l) => l.at === 'topic_run' && l.status === 'done')).toMatchObject({ turns: 2, cents: 14 });
  });

  it('(b) end_turn で save_topics が無い → 催促を 1 回足して続ける → save → done。tools は変えない', async () => {
    const first = ended();
    const p = scriptedPort([first, genMessage([talkBody()])]);
    const o = await runTopicRun(topicEnv(db), p.port, genReq(), { deadline: far(), fetchImpl });
    expect(o.status).toBe('done');
    expect(p.calls).toHaveLength(2);
    const m = p.calls[1].params.messages;
    expect(m).toHaveLength(3);
    expect(m[1]).toEqual({ role: 'assistant', content: first.content });
    expect(m[2]).toEqual({ role: 'user', content: TOPIC_SAVE_NUDGE });
    expect(p.calls[1].params.tools).toEqual(p.calls[0].params.tools);
    expect(run()).toMatchObject({ status: 'done', made: 1, cents: 14 });
  });

  it('(b) 催促は 1 回だけ: 催促の後も end_turn → 続けずに no_output（呼び出し 2 回）', async () => {
    const p = scriptedPort([ended(), ended(), genMessage([talkBody()])]);
    const o = await runTopicRun(topicEnv(db), p.port, genReq(), { deadline: far(), fetchImpl });
    expect(o.status).toBe('failed');
    expect(p.calls).toHaveLength(2);
    const nudges = p.calls[1].params.messages.filter((x) => x.role === 'user' && x.content === TOPIC_SAVE_NUDGE);
    expect(nudges).toHaveLength(1);
    expect(run()).toMatchObject({ status: 'failed', error: 'no_output', cents: 14 });
    expect(logs.find((l) => l.at === 'topic_run' && l.no_output)).toMatchObject({ no_output: 'stop_end_turn', turns: 2, cents: 14 });
  });

  it('(c) 続きの上限: 4 回目まで save_topics が無い → no_output・呼び出しは 4 回まで・台帳は 4 回の実額の合計', async () => {
    const p = scriptedPort([paused('a'), paused('b'), paused('c'), paused('d'), genMessage([talkBody()])]);
    const o = await runTopicRun(topicEnv(db), p.port, genReq(), { deadline: far(), fetchImpl });
    expect(o.status).toBe('failed');
    expect(p.calls).toHaveLength(TOPIC_GEN_MAX_CONTINUES + 1);
    expect(p.calls).toHaveLength(4);
    expect(run()).toMatchObject({ status: 'failed', error: 'no_output', cents: 28 });
    expect(topicLedger().map((r) => r.cents)).toEqual([28]);
    expect(logs.find((l) => l.at === 'topic_run' && l.no_output)).toMatchObject({ no_output: 'turn_limit', turns: 4, cents: 28 });
    // 4 回目の messages は pause の応答 3 つを順に積んだもの
    expect(p.calls[3].params.messages.map((x) => x.role)).toEqual(['user', 'assistant', 'assistant', 'assistant']);
  });

  it('(d) 費用の上限: これまでの実額 + 直前の 1 回の実額 > 取り置き額 → 続けずに failed: cost_cap（台帳は実額）', async () => {
    // 取り置き 10 セント: 1 回目 7 セント → 7 + 7 = 14 > 10
    const env = topicEnv(db, { TOPIC_GEN_RESERVE_CENTS: '10' });
    const p = scriptedPort([paused(), genMessage([talkBody()])]);
    const o = await runTopicRun(env, p.port, genReq(), { deadline: far(), fetchImpl });
    expect(o.status).toBe('failed');
    expect(p.calls).toHaveLength(1);
    expect(run()).toMatchObject({ status: 'failed', error: 'cost_cap', cents: 7 });
    expect(topicLedger().map((r) => r.cents)).toEqual([7]);
    expect(logs.find((l) => l.at === 'topic_run' && l.no_output)).toMatchObject({ no_output: 'cost_cap', turns: 1, cents: 7 });
  });

  it('(d) 催促の見込みも直前の 1 回の実額: 1 回目 45 セントの end_turn → 45 + 45 > 60 で催促せず cost_cap（催促は新しいターンで max_uses が新しくなる）', async () => {
    // 1 回目: cache write 180000 × $2.50 = 45 セント。催促は検索・開くをもう一度全部できるので、見込みは 45（前半の cache read だけの 10 ではない）
    const first = msgOf([{ type: 'text', text: 'おわり' }], 'end_turn', { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 180_000 });
    const p = scriptedPort([first, genMessage([talkBody()])]);
    const o = await runTopicRun(topicEnv(db), p.port, genReq(), { deadline: far(), fetchImpl });
    expect(o.status).toBe('failed');
    expect(p.calls).toHaveLength(1);
    expect(run()).toMatchObject({ status: 'failed', error: 'cost_cap', cents: 45 });
    expect(topicLedger().map((r) => r.cents)).toEqual([45]);
    expect(logs.find((l) => l.at === 'topic_run' && l.no_output)).toMatchObject({ no_output: 'cost_cap', turns: 1, cents: 45 });
  });

  it('(d) 催促: これまでの実額 + 直前の 1 回 ≤ 取り置き額なら催促する（1 回目 30 セント → 30 + 30 = 60 ≤ 60）', async () => {
    const first = msgOf([{ type: 'text', text: 'おわり' }], 'end_turn', { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 120_000 });
    const p = scriptedPort([first, genMessage([talkBody()])]);
    const o = await runTopicRun(topicEnv(db), p.port, genReq(), { deadline: far(), fetchImpl });
    expect(o.status).toBe('done');
    expect(p.calls).toHaveLength(2);
    expect(p.calls[1].params.messages[2]).toEqual({ role: 'user', content: TOPIC_SAVE_NUDGE });
  });

  it('(d) pause_turn の続きの見込みは直前の 1 回の実額のまま: 1 回目 31 セントの pause_turn → 31 + 31 > 60 で cost_cap', async () => {
    const first = msgOf(searchBlocks('srvtoolu_p'), 'pause_turn', { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 124_000 });
    const p = scriptedPort([first, genMessage([talkBody()])]);
    const o = await runTopicRun(topicEnv(db), p.port, genReq(), { deadline: far(), fetchImpl });
    expect(o.status).toBe('failed');
    expect(p.calls).toHaveLength(1);
    expect(run()).toMatchObject({ status: 'failed', error: 'cost_cap', cents: 31 });
  });

  it('(d) 締め切りの残りが足りなければ続けない（no_output）', async () => {
    const p = scriptedPort([paused(), genMessage([talkBody()])]);
    const o = await runTopicRun(topicEnv(db), p.port, genReq(), { deadline: Date.now() + 20_000, fetchImpl });
    expect(o.status).toBe('failed');
    expect(p.calls).toHaveLength(1);
    expect(run()).toMatchObject({ status: 'failed', error: 'no_output', cents: 7 });
    expect(logs.find((l) => l.at === 'topic_run' && l.no_output)).toMatchObject({ no_output: 'no_time' });
  });

  it('(e) max_tokens → 続けずに failed: max_tokens（v2.8。v2.7 は no_output）。呼び出しのログに stop_reason（本文は出さない）', async () => {
    const p = scriptedPort([msgOf([{ type: 'text', text: '本文の途中' }], 'max_tokens'), genMessage([talkBody()])]);
    const o = await runTopicRun(topicEnv(db), p.port, genReq(), { deadline: far(), fetchImpl });
    expect(o.status).toBe('failed');
    expect(p.calls).toHaveLength(1);
    expect(run()).toMatchObject({ status: 'failed', error: 'max_tokens', cents: 7 });
    expect(callLogs()).toHaveLength(1);
    expect(callLogs()[0]).toMatchObject({ run_id: run().id, turn: 0, stop_reason: 'max_tokens', pending_server_tool: false, blocks: { text: 1 } });
    expect(typeof callLogs()[0].ms).toBe('number');
    expect(JSON.stringify(logs)).not.toContain('本文の途中');
    expect(logs.find((l) => l.at === 'topic_run' && l.no_output)).toMatchObject({ no_output: 'max_tokens' });
  });

  it('続きの途中で呼び出しが失敗 → 同じ分類のコードで閉じ、台帳はそれまでの実額', async () => {
    const { apiError } = await import('./topics-helpers');
    const p = scriptedPort([paused(), apiError(529)]);
    const o = await runTopicRun(topicEnv(db), p.port, genReq(), { deadline: far(), fetchImpl });
    expect(o.status).toBe('failed');
    expect(p.calls).toHaveLength(2);
    expect(run()).toMatchObject({ status: 'failed', error: 'overloaded', cents: 7 });
    expect(topicLedger().map((r) => r.cents)).toEqual([7]);
  });

  it('呼び出しのログは fetch のエラーを種類ごとに数える（URL・本文は出さない）', async () => {
    const m = msgOf(
      [
        { type: 'server_tool_use', id: 'f1', name: 'web_fetch', input: { url: 'https://secret.example.org/a' } },
        { type: 'web_fetch_tool_result', tool_use_id: 'f1', content: { type: 'web_fetch_tool_result_error', error_code: 'url_not_accessible' } },
        { type: 'server_tool_use', id: 'f2', name: 'web_fetch', input: { url: 'https://secret.example.org/b' } },
        { type: 'web_fetch_tool_result', tool_use_id: 'f2', content: { type: 'web_fetch_tool_result_error', error_code: 'url_not_accessible' } },
        { type: 'tool_use', id: 'toolu_1', name: 'save_topics', input: { topics: [talkBody()] } },
      ],
      'tool_use',
      { server_tool_use: { web_search_requests: 1, web_fetch_requests: 2 } },
    );
    const p = scriptedPort([m]);
    await runTopicRun(topicEnv(db), p.port, genReq(), { deadline: far(), fetchImpl });
    expect(callLogs()[0]).toMatchObject({ stop_reason: 'tool_use', searches: 1, fetches: 2, fetch_errors: { url_not_accessible: 2 } });
    expect(JSON.stringify(callLogs())).not.toContain('secret.example.org');
  });
});

describe('v2.7 費用', () => {
  it('(f) genActualCents: cache read は入力の 0.05 倍・cache write は 1.25 倍で数える', () => {
    const u = (o: Record<string, number>) => ({ usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, ...o } }) as unknown as Message;
    // 1,000,000 × $0.10 / 1M = 10 セント（入力と同じ $2 なら 200 セント）
    expect(genActualCents(u({ cache_read_input_tokens: 1_000_000 }))).toBe(10);
    // 100,000 × $2.50 / 1M = 25 セント
    expect(genActualCents(u({ cache_creation_input_tokens: 100_000 }))).toBe(25);
    // 合わせて: 入力 10000×2 + 出力 1000×10 + write 100000×2.5 + read 1000000×0.1 = 380000 µ$ = 38 セント + 検索 2
    const all = { usage: { input_tokens: 10_000, output_tokens: 1_000, cache_creation_input_tokens: 100_000, cache_read_input_tokens: 1_000_000, server_tool_use: { web_search_requests: 2 } } } as unknown as Message;
    expect(genActualCents(all)).toBe(40);
  });

  it('(g) 実額が取り置き（60）を超えた時、台帳は実額・topic_over_reserve + 1。次の取り置きの上限の判定も実額で数える', async () => {
    // 1 日のお題の上限 200: 実額 104 + 104 = 208 → 次の 60 は取れない（min(実額, 60) なら 60 + 60 + 60 = 180 で取れてしまう）
    const env = topicEnv(db, { TOPIC_DAILY_CAP_CENTS: '200' });
    const p = scriptedPort([genMessage([talkBody()], { output: 100_000 }), genMessage([philoBody()], { output: 100_000 })]);
    expect((await runTopicRun(env, p.port, genReq('talk'), { deadline: far(), fetchImpl })).status).toBe('done');
    expect(run()).toMatchObject({ status: 'done', cents: 104 });
    expect(topicLedger().map((r) => r.cents)).toEqual([104]);
    expect(setting('topic_over_reserve')).toBe('1');
    expect((await runTopicRun(env, p.port, genReq('philo'), { deadline: far(), fetchImpl })).status).toBe('done');
    expect(topicLedger().map((r) => r.cents)).toEqual([104, 104]);
    expect(setting('topic_over_reserve')).toBe('2');
    const o = await runTopicRun(env, p.port, genReq('make'), { deadline: far(), fetchImpl });
    expect(o).toMatchObject({ status: 'not_taken', reason: 'cap' });
    expect(p.calls).toHaveLength(2);
  });
});

describe('v2.7 本数とキャッシュ', () => {
  it('(h) philo の本数の上限は 2（3 本目は over_max で捨てる）。news 2・talk / make 3 は変えない', async () => {
    expect(runMaxCount(genReq('philo'))).toBe(2);
    expect(runMaxCount(genReq('news'))).toBe(2);
    expect(runMaxCount(genReq('talk'))).toBe(3);
    expect(runMaxCount(genReq('make'))).toBe(3);
    const p = scriptedPort([genMessage([philoBody('船の問い その一'), philoBody('船の問い その二'), philoBody('船の問い その三')])]);
    const o = await runTopicRun(topicEnv(db), p.port, genReq('philo'), { deadline: far(), fetchImpl });
    expect(o.status).toBe('done');
    expect(run()).toMatchObject({ status: 'done', made: 2, dropped: 1 });
    expect(logs.find((l) => l.at === 'topic_run' && l.dropped_index === 3)).toMatchObject({ reasons: ['over_max'] });
    expect(p.calls[0].params.system as string).toContain('本数: 最大 2 本。');
  });

  it('(i) params の tools の最後（save_topics）と top-level に cache_control: ephemeral（続きの呼び出しも同じ）。system 文の最後に save_topics の決まり', async () => {
    const p = scriptedPort([ended(), genMessage([makeBody()])]);
    await runTopicRun(topicEnv(db), p.port, genReq('make'), { deadline: far(), fetchImpl });
    expect(p.calls).toHaveLength(2);
    for (const c of p.calls) {
      const tools = c.params.tools as Array<Record<string, unknown>>;
      expect(tools[tools.length - 1]).toMatchObject({ name: 'save_topics', cache_control: { type: 'ephemeral' } });
      expect(tools.slice(0, -1).every((t) => t.cache_control === undefined)).toBe(true);
      // top-level（自動のキャッシュ）: 区切りが毎回のリクエストの最後の block に置かれ、続きの呼び出しも前の会話をキャッシュから読む
      expect((c.params as unknown as Record<string, unknown>).cache_control).toEqual({ type: 'ephemeral' });
    }
    const sys = p.calls[0].params.system as string;
    expect(sys.endsWith('1 本も作れない時も、topics を空の配列（topics: []）にして save_topics を呼びます。')).toBe(true);
  });

  it('topics: [] の save_topics は failed: no_valid_topic（made 0）', async () => {
    const p = scriptedPort([genMessage([])]);
    const o = await runTopicRun(topicEnv(db), p.port, genReq(), { deadline: far(), fetchImpl });
    expect(o.status).toBe('failed');
    expect(run()).toMatchObject({ status: 'failed', error: 'no_valid_topic', made: 0, dropped: 0, cents: 7 });
    expect(p.calls).toHaveLength(1);
  });
});
