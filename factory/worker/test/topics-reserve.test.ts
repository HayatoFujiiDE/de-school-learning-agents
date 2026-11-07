// contract-T T-14 b5: 取り置き（月・日・全体の日次で、上限を 1 セント超える取り置きが 0 行）/ 入・切が切・一時停止で run も呼び出しも 0 /
// お題の呼び出しに maxRetries: 0 と締め切りが渡っている（port に渡った引数で確かめる）
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { checkTopic } from '../src/topics/check';
import { runTopicRun } from '../src/topics/gen';
import { TOPIC_CHECK_TIMEOUT_MS, TOPIC_GEN_TIMEOUT_MS } from '../src/topics/store';
import { checkMessage, checkIn, count, enable, fetchStub, genMessage, ledger, migratedDb, scriptedPort, seedTopic, setSetting, talkBody, tokyoToday, tomorrow, topic, topicEnv } from './topics-helpers';

let db: DatabaseSync;
const { fetchImpl } = fetchStub({});
const far = () => Date.now() + 10 * 60_000;

function fillLedger(kind: string, cents: number, day = tokyoToday()) {
  db.prepare('INSERT INTO cost_ledger (id, day, kind, ref_id, cents, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(crypto.randomUUID(), day, kind, `pre:${crypto.randomUUID()}`, cents, new Date().toISOString());
}

const genReq = (trigger: 'cron' | 'manual' = 'manual') => ({ purpose: 'gen' as const, kind: 'talk' as const, trigger, slotDay: tomorrow() });

beforeEach(() => {
  db = migratedDb();
  enable(db);
});

describe('生成の取り置き（T-6）', () => {
  // 取り置き額 60。上限ちょうどは取れて、1 セント超えると 0 行
  it.each([
    ['月', { TOPIC_MONTHLY_CAP_CENTS: '100', TOPIC_DAILY_CAP_CENTS: '100000' }, 'topic'],
    ['日', { TOPIC_MONTHLY_CAP_CENTS: '100000', TOPIC_DAILY_CAP_CENTS: '100' }, 'topic'],
    ['全体の日次（dailyReservedSql）', { TOPIC_MONTHLY_CAP_CENTS: '100000', TOPIC_DAILY_CAP_CENTS: '100000', DAILY_CAP_CENTS: '100' }, 'session'],
  ] as const)('%s: 上限ちょうどは取れる / 1 セント超えは台帳も run も呼び出しも 0', async (_n, vars, kind) => {
    const env = topicEnv(db, vars);
    fillLedger(kind, 41); // 41 + 60 = 101 > 100
    const p1 = scriptedPort([]);
    const o1 = await runTopicRun(env, p1.port, genReq(), { deadline: far(), fetchImpl });
    expect(o1).toMatchObject({ status: 'not_taken', reason: 'cap' });
    expect(count(db, 'SELECT COUNT(*) AS n FROM topic_runs')).toBe(0);
    expect(ledger(db).filter((r) => r.ref_id.startsWith('tp:'))).toEqual([]);
    expect(p1.calls.length).toBe(0);

    db.prepare("DELETE FROM cost_ledger WHERE ref_id GLOB 'pre:*'").run();
    fillLedger(kind, 40); // 40 + 60 = 100（ちょうど）
    const p2 = scriptedPort([genMessage([talkBody()])]);
    const o2 = await runTopicRun(env, p2.port, genReq(), { deadline: far(), fetchImpl });
    expect(o2.status).toBe('done');
    expect(p2.calls.length).toBe(1);
  });

  it('cron が上限で取れない時は skipped: cap を 1 行（その日はもう試さない）', async () => {
    const env = topicEnv(db, { TOPIC_DAILY_CAP_CENTS: '10' });
    const p = scriptedPort([]);
    const o = await runTopicRun(env, p.port, genReq('cron'), { deadline: far(), fetchImpl });
    expect(o).toMatchObject({ status: 'not_taken', reason: 'cap' });
    expect(db.prepare('SELECT status, error, trigger FROM topic_runs').all()).toEqual([{ status: 'skipped', error: 'cap', trigger: 'cron' }]);
    const again = await runTopicRun(env, p.port, genReq('cron'), { deadline: far(), fetchImpl });
    expect(again).toMatchObject({ status: 'not_taken', reason: 'exists' });
    expect(count(db, 'SELECT COUNT(*) AS n FROM topic_runs')).toBe(1);
    expect(ledger(db)).toEqual([]);
    expect(p.calls.length).toBe(0);
  });
});

describe('入・切が切 / 一時停止（T-4・T-7）', () => {
  it.each([
    ['切', () => setSetting(db, 'topics_enabled', '0')],
    ['一時停止', () => setSetting(db, 'paused', '1')],
  ])('%s: run の行も台帳も呼び出しも 0', async (_n, act) => {
    act();
    const env = topicEnv(db);
    const p = scriptedPort([genMessage([talkBody()])]);
    expect(await runTopicRun(env, p.port, genReq('cron'), { deadline: far(), fetchImpl })).toMatchObject({ status: 'not_taken', reason: 'disabled' });
    expect(count(db, 'SELECT COUNT(*) AS n FROM topic_runs')).toBe(0);
    expect(ledger(db)).toEqual([]);
    expect(p.calls.length).toBe(0);
    // 検査も取らない
    await seedTopic(db, { id: 'tp_x_1', body: talkBody() });
    const pc = scriptedPort([checkMessage(checkIn([]))]);
    expect((await checkTopic(env, pc.port, 'tp_x_1', { deadline: far(), fetchImpl })).status).toBe('not_taken');
    expect(topic(db, 'tp_x_1')).toMatchObject({ status: 'draft', check_attempts: 0 });
    expect(pc.calls.length).toBe(0);
  });
});

describe('検査の取り置き（T-5「取る」）', () => {
  it('上限で取れない時は draft のまま・attempts そのまま・台帳 0 行・呼び出し 0', async () => {
    const env = topicEnv(db, { TOPIC_DAILY_CAP_CENTS: '20' });
    fillLedger('topic', 6); // 6 + 15 = 21 > 20
    await seedTopic(db, { id: 'tp_x_1', body: talkBody() });
    const p = scriptedPort([checkMessage(checkIn([]))]);
    expect((await checkTopic(env, p.port, 'tp_x_1', { deadline: far(), fetchImpl })).status).toBe('not_taken');
    expect(topic(db, 'tp_x_1')).toMatchObject({ status: 'draft', check_attempts: 0 });
    expect(ledger(db).filter((r) => r.ref_id.startsWith('tp:'))).toEqual([]);
    expect(p.calls.length).toBe(0);
  });
});

describe('再送なしと締め切り（T-4・T-5 の 3）', () => {
  it('生成と検査の呼び出しに maxRetries: 0 と絶対の締め切りが渡る', async () => {
    const env = topicEnv(db);
    const p = scriptedPort([genMessage([talkBody()]), checkMessage(checkIn([]))]);
    const t0 = Date.now();
    const r = await runTopicRun(env, p.port, genReq(), { deadline: far(), fetchImpl });
    expect(r.status).toBe('done');
    const id = (db.prepare('SELECT id FROM topics').get() as { id: string }).id;
    await checkTopic(env, p.port, id, { deadline: far(), fetchImpl });
    expect(p.calls.length).toBe(2);
    const [g, c] = p.calls;
    expect(g.opts?.maxRetries).toBe(0);
    expect(c.opts?.maxRetries).toBe(0);
    expect(typeof g.opts?.deadline).toBe('number');
    expect(typeof c.opts?.deadline).toBe('number');
    expect(g.opts!.deadline!).toBeLessThanOrEqual(Date.now() + TOPIC_GEN_TIMEOUT_MS);
    expect(g.opts!.deadline!).toBeGreaterThan(t0);
    expect(c.opts!.deadline!).toBeLessThanOrEqual(Date.now() + TOPIC_CHECK_TIMEOUT_MS);
    expect(g.opts?.maxTimeoutMs).toBe(TOPIC_GEN_TIMEOUT_MS);
    expect(c.opts?.maxTimeoutMs).toBe(TOPIC_CHECK_TIMEOUT_MS);
    // cron の締め切りが早ければそちら
    const p2 = scriptedPort([genMessage([talkBody('班の係をどう決めるか')])]);
    // 5 秒ちょうどだと「残り 5 秒未満なら呼ばない」（v2.4 裁定 7）の境界に当たって揺れる。150 秒より早く、5 秒より十分に長い値にする
    const early = Date.now() + 30_000;
    await runTopicRun(env, p2.port, { ...genReq(), kind: 'talk' }, { deadline: early, fetchImpl });
    expect(p2.calls[0].opts!.deadline!).toBeLessThanOrEqual(early);
  });

  it('生成の呼び出しは web_search（max_uses 5）・web_fetch（max_uses 8, max_content_tokens 4000。v2.7）・save_topics、max_tokens 16000（v2.8）、tool_choice auto', async () => {
    const env = topicEnv(db);
    const p = scriptedPort([genMessage([talkBody()])]);
    await runTopicRun(env, p.port, genReq(), { deadline: far(), fetchImpl });
    const params = p.calls[0].params;
    expect(params.max_tokens).toBe(16000);
    expect(params.tool_choice).toEqual({ type: 'auto' });
    expect(params.tools).toEqual([
      { type: 'web_search_20250305', name: 'web_search', max_uses: 5 },
      { type: 'web_fetch_20250910', name: 'web_fetch', max_uses: 8, max_content_tokens: 4000 },
      expect.objectContaining({ name: 'save_topics' }),
    ]);
    // 外から来た文（既存の題）は system 文に入らず user 文のブロック
    expect(typeof params.system).toBe('string');
    expect(params.system as string).not.toContain('【すでにあるお題】');
  });
});
