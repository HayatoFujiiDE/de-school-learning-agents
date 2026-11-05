// contract-T T-14 b4: T-7 の失敗の表の各行（偽物の port に失敗を差し込み、「その後」「台帳（0 行か 1 行か、額）」「外部の呼び出しの回数」）。
// lease を失った保存・判定が 1 行も書かない / 完了の batch を 2 回流しても、台帳の確定・決定の記録・topic_over_reserve が増えない。
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { PortError } from '../src/anthropic';
import { conditionalBatch, stmt } from '../src/db';
import type { Env } from '../src/env';
import { checkTopic, cleanupLeases } from '../src/topics/check';
import { runTopicRun } from '../src/topics/gen';
import { genReserveStmt } from '../src/topics/store';
import {
  apiError,
  checkIn,
  checkMessage,
  count,
  enable,
  fetchStub,
  genMessage,
  ledger,
  makeBody,
  migratedDb,
  scriptedPort,
  seedTopic,
  supportPassed,
  talkBody,
  timeoutError,
  tokyoToday,
  tomorrow,
  topic,
  topicEnv,
} from './topics-helpers';

let db: DatabaseSync;
let env: Env;
let batches: unknown[][];
const { fetchImpl } = fetchStub({});
const far = () => Date.now() + 10 * 60_000;
const past = () => new Date(Date.now() - 60_000).toISOString();
const genReq = (kind: 'talk' | 'philo' = 'talk') => ({ purpose: 'gen' as const, kind, trigger: 'manual' as const, slotDay: tomorrow() });
const run = () => db.prepare('SELECT * FROM topic_runs ORDER BY rowid DESC LIMIT 1').get() as Record<string, unknown>;
const topicLedger = () => ledger(db).filter((r) => r.ref_id.startsWith('tp:'));
const setting = (k: string) => (db.prepare('SELECT value FROM settings WHERE key = ?').get(k) as { value: string } | undefined)?.value ?? null;

beforeEach(() => {
  db = migratedDb();
  enable(db);
  const base = topicEnv(db);
  batches = [];
  const inner = base.DB;
  // batch を記録する（完了の batch をもう 1 回流すため）
  env = { ...base, DB: { prepare: (s: string) => inner.prepare(s), batch: async (b: unknown[]) => (batches.push(b), inner.batch(b as D1PreparedStatement[])) } as unknown as D1Database };
});

describe('T-7 生成・派生 run', () => {
  it('入・切が切 / 一時停止: 何もしない・台帳 0 行・呼び出し 0 回', async () => {
    db.prepare("UPDATE settings SET value = '0' WHERE key = 'topics_enabled'").run();
    const p = scriptedPort([genMessage([talkBody()])]);
    expect((await runTopicRun(env, p.port, genReq(), { deadline: far(), fetchImpl })).status).toBe('not_taken');
    expect([count(db, 'SELECT COUNT(*) AS n FROM topic_runs'), topicLedger().length, p.calls.length]).toEqual([0, 0, 0]);
  });

  it('上限で取れない: cron は skipped: cap を 1 行・台帳 0 行・呼び出し 0 回', async () => {
    const e = topicEnv(db, { TOPIC_DAILY_CAP_CENTS: '1' });
    const p = scriptedPort([]);
    await runTopicRun(e, p.port, { ...genReq(), trigger: 'cron' }, { deadline: far(), fetchImpl });
    expect(run()).toMatchObject({ status: 'skipped', error: 'cap' });
    expect([topicLedger().length, p.calls.length]).toEqual([0, 0]);
  });

  it('取った後、呼ぶ前に落ちた: lease 切れ（15 分）→ 次の tick が failed: abandoned・台帳 1 行（取り置き額）・呼び出し 0 回', async () => {
    const runId = crypto.randomUUID();
    const now = new Date().toISOString();
    const ok = await conditionalBatch(env.DB, [
      genReserveStmt({ env, ledgerId: crypto.randomUUID(), day: tokyoToday(), cents: 60, now, runId, kind: 'talk', trigger: 'manual', slotDay: tomorrow() }),
      stmt(
        `INSERT INTO topic_runs (id, purpose, kind, slot_day, week, parent_topic_id, trigger, status, error, dropped, made, cents, token, lease_until, created_at, updated_at)
         SELECT ?, 'gen', 'talk', ?, NULL, NULL, 'manual', 'calling', NULL, 0, 0, 0, 'tok', ?, ?, ? WHERE EXISTS (SELECT 1 FROM cost_ledger WHERE kind = 'topic' AND ref_id = ?)`,
        runId,
        tomorrow(),
        new Date(Date.now() + 15 * 60_000).toISOString(),
        now,
        now,
        `tp:${runId}:gen`,
      ),
    ]);
    expect(ok.ok).toBe(true);
    // lease の前は片付けない
    expect((await cleanupLeases(env, new Date().toISOString())).runs).toBe(0);
    db.prepare('UPDATE topic_runs SET lease_until = ? WHERE id = ?').run(past(), runId);
    expect((await cleanupLeases(env, new Date().toISOString())).runs).toBe(1);
    expect(run()).toMatchObject({ status: 'failed', error: 'abandoned', cents: 60 });
    expect(topicLedger()).toEqual([{ ref_id: `tp:${runId}:gen`, cents: 60 }]);
  });

  it.each([
    ['時間切れ', timeoutError(), 'timeout'],
    ['接続断', new PortError(false, undefined, 'connection'), 'connection'],
  ])('呼び出し中に%s: その場で failed・台帳 1 行（取り置き額）・呼び出し 1 回', async (_n, err, code) => {
    const p = scriptedPort([err]);
    const o = await runTopicRun(env, p.port, genReq(), { deadline: far(), fetchImpl });
    expect(o.status).toBe('failed');
    expect(run()).toMatchObject({ status: 'failed', error: code, cents: 60 });
    expect(topicLedger().map((r) => r.cents)).toEqual([60]);
    expect(p.calls.length).toBe(1);
  });

  it.each([
    [429, 'rate_limited', 0],
    [402, 'quota', 0],
    [401, 'auth', 0],
    [403, 'auth', 0],
    [400, 'bad_request', 0],
    [404, 'http_404', 0],
    [500, 'server', 60],
    [529, 'overloaded', 60],
  ])('%s の応答: その場で failed: %s・台帳 1 行（%s セント）・呼び出し 1 回', async (status, code, cents) => {
    const p = scriptedPort([apiError(status)]);
    await runTopicRun(env, p.port, genReq(), { deadline: far(), fetchImpl });
    expect(run()).toMatchObject({ status: 'failed', error: code, cents });
    expect(topicLedger().map((r) => r.cents)).toEqual([cents]);
    expect(p.calls.length).toBe(1);
  });

  it('応答後、保存の前に lease を失った: 保存は 1 行も書かない → lease 切れで failed: abandoned・台帳は取り置き額・呼び出し 1 回', async () => {
    const p = scriptedPort([
      () => {
        db.prepare("UPDATE topic_runs SET lease_until = ? WHERE status = 'calling'").run(past());
        return genMessage([talkBody()], { output: 100_000 });
      },
    ]);
    await runTopicRun(env, p.port, genReq(), { deadline: far(), fetchImpl });
    expect(count(db, 'SELECT COUNT(*) AS n FROM topics')).toBe(0);
    expect(count(db, 'SELECT COUNT(*) AS n FROM topic_sources')).toBe(0);
    expect(run()).toMatchObject({ status: 'calling' });
    expect(topicLedger().map((r) => r.cents)).toEqual([60]);
    expect(setting('topic_over_reserve')).toBeNull();
    await cleanupLeases(env, new Date().toISOString());
    expect(run()).toMatchObject({ status: 'failed', error: 'abandoned', cents: 60 });
    expect(p.calls.length).toBe(1);
  });

  it('保存の batch: 台帳は確定額 = min(実額, 取り置き額)、超えた時は topic_over_reserve + 1。2 回流しても増えない', async () => {
    const p = scriptedPort([genMessage([talkBody(), philoBody()], { output: 100_000, searches: 2 })]);
    const o = await runTopicRun(env, p.port, genReq(), { deadline: far(), fetchImpl });
    expect(o.status).toBe('done');
    // 実額 = (20000×2 + 100000×10)/10000 = 104 + 検索 2 = 106 > 60
    expect(run()).toMatchObject({ status: 'done', made: 1, dropped: 1, cents: 60 });
    expect(topicLedger().map((r) => r.cents)).toEqual([60]);
    expect(setting('topic_over_reserve')).toBe('1');
    const saved = batches[batches.length - 1];
    await (env.DB.batch(saved as D1PreparedStatement[]) as Promise<unknown>);
    expect(count(db, 'SELECT COUNT(*) AS n FROM topics')).toBe(1);
    expect(topicLedger().map((r) => r.cents)).toEqual([60]);
    expect(setting('topic_over_reserve')).toBe('1');
    expect(run()).toMatchObject({ status: 'done', made: 1 });
  });

  it('通るお題が 0 本: failed: no_valid_topic（台帳は確定額）/ save_topics が無い: failed: no_output（確定額）', async () => {
    const bad = { ...talkBody(), kind: 'quiz' };
    const p = scriptedPort([genMessage([bad]), genMessage(null)]);
    await runTopicRun(env, p.port, genReq(), { deadline: far(), fetchImpl });
    expect(run()).toMatchObject({ status: 'failed', error: 'no_valid_topic', dropped: 1, made: 0, cents: 7 });
    await runTopicRun(env, p.port, genReq('philo'), { deadline: far(), fetchImpl });
    expect(run()).toMatchObject({ status: 'failed', error: 'no_output', cents: 7 });
    expect(topicLedger().map((r) => r.cents)).toEqual([7, 7]);
    expect(p.calls.length).toBe(2);
  });
});

function philoBody() {
  // 生成の run の種類（talk）と違う → dropped
  return { ...talkBody('別の種類'), kind: 'philo' };
}

describe('T-7 検査', () => {
  const T = 'tp_x_1';
  const ref1 = `tp:${T}:chk:1`;

  it('上限で取れない: draft のまま・attempts そのまま・台帳 0 行・呼び出し 0 回', async () => {
    await seedTopic(db, { id: T, body: talkBody() });
    const e = topicEnv(db, { TOPIC_DAILY_CAP_CENTS: '1' });
    const p = scriptedPort([]);
    expect((await checkTopic(e, p.port, T, { deadline: far(), fetchImpl })).status).toBe('not_taken');
    expect(topic(db, T)).toMatchObject({ status: 'draft', check_attempts: 0 });
    expect([topicLedger().length, p.calls.length]).toEqual([0, 0]);
  });

  it('形・禁止語で赤: 3 を呼ばずに判定を書く（held: forbidden）・台帳 1 行（0）・呼び出し 0 回', async () => {
    const b = makeBody();
    b.lead = { s: '作品のランキングを作る', e: 'らんきんぐ' };
    await seedTopic(db, { id: T, body: b });
    const p = scriptedPort([]);
    expect((await checkTopic(env, p.port, T, { deadline: far(), fetchImpl })).status).toBe('held');
    expect(topic(db, T)).toMatchObject({ status: 'held', hold_reason: 'forbidden' });
    expect(topicLedger()).toEqual([{ ref_id: ref1, cents: 0 }]);
    expect(p.calls.length).toBe(0);
    expect(db.prepare('SELECT verdict, approvable FROM topic_checks').all()).toEqual([{ verdict: 'red', approvable: 0 }]);
  });

  it('重複: rejected: duplicate・台帳 1 行（0）・呼び出し 0 回（自分以外の同じ種類の ready と題が一致）', async () => {
    await seedTopic(db, { id: 'tp_old_1', body: talkBody(), status: 'ready' });
    await seedTopic(db, { id: T, body: talkBody() });
    const p = scriptedPort([]);
    expect((await checkTopic(env, p.port, T, { deadline: far(), fetchImpl })).status).toBe('rejected');
    expect(topic(db, T)).toMatchObject({ status: 'rejected', hold_reason: 'duplicate' });
    expect(topicLedger()).toEqual([{ ref_id: ref1, cents: 0 }]);
    expect(p.calls.length).toBe(0);
  });

  it('時間切れ: 何も書かず checking のまま → lease 切れ（10 分）で T-3 の 1 文（draft）・台帳 1 行（取り置き額）・呼び出し 1 回', async () => {
    await seedTopic(db, { id: T, body: talkBody() });
    const p = scriptedPort([timeoutError()]);
    expect((await checkTopic(env, p.port, T, { deadline: far(), fetchImpl })).status).toBe('left');
    expect(topic(db, T)).toMatchObject({ status: 'checking', check_attempts: 1 });
    expect(topicLedger()).toEqual([{ ref_id: ref1, cents: 15 }]);
    expect((await cleanupLeases(env, new Date().toISOString())).checks).toBe(0);
    db.prepare('UPDATE topics SET check_lease_until = ? WHERE id = ?').run(past(), T);
    expect((await cleanupLeases(env, new Date().toISOString())).checks).toBe(1);
    expect(topic(db, T)).toMatchObject({ status: 'draft', hold_reason: null, check_token: null, check_attempts: 1 });
    expect(p.calls.length).toBe(1);
  });

  it('取った後に落ちた（呼び出し 0 回）が巡の上限に達していれば、lease 切れで held: check_failed', async () => {
    await seedTopic(db, { id: T, body: talkBody() });
    db.prepare("UPDATE topics SET status = 'checking', check_attempts = 2, check_token = 't', check_lease_until = ? WHERE id = ?").run(past(), T);
    await cleanupLeases(env, new Date().toISOString());
    expect(topic(db, T)).toMatchObject({ status: 'held', hold_reason: 'check_failed', check_token: null });
  });

  it.each([
    [429, 0],
    [402, 0],
    [400, 0],
    [500, 15],
    [529, 15],
  ])('%s の応答: その場で T-3 の 1 文 + check_not_before（6 時間）・台帳 1 行（%s）・呼び出し 1 回', async (status, cents) => {
    await seedTopic(db, { id: T, body: talkBody() });
    const p = scriptedPort([apiError(status)]);
    const t0 = Date.now();
    await checkTopic(env, p.port, T, { deadline: far(), fetchImpl });
    const r = topic(db, T);
    expect(r).toMatchObject({ status: 'draft', check_attempts: 1, check_token: null });
    const nb = Date.parse(String(r.check_not_before));
    expect(nb).toBeGreaterThanOrEqual(t0 + 6 * 3600_000 - 1000);
    expect(nb).toBeLessThanOrEqual(Date.now() + 6 * 3600_000 + 1000);
    expect(topicLedger()).toEqual([{ ref_id: ref1, cents }]);
    expect(p.calls.length).toBe(1);
    // check_not_before の前はまた取れない
    expect((await checkTopic(env, scriptedPort([]).port, T, { deadline: far(), fetchImpl })).status).toBe('not_taken');
  });

  it.each([
    ['save_check が無い', checkMessage(null)],
    ['形が違う', checkMessage({ sources: [], sensitivity: 'mild', heavy_reasons: [], flags: [], note: '' })],
    ['id の過不足（余分）', checkMessage(checkIn(['s9']))],
  ])('応答が使えない（%s）: T-3 の 1 文（check_not_before なし）・台帳は確定額・呼び出し 1 回', async (_n, msg) => {
    await seedTopic(db, { id: T, body: talkBody() });
    const p = scriptedPort([msg]);
    await checkTopic(env, p.port, T, { deadline: far(), fetchImpl });
    expect(topic(db, T)).toMatchObject({ status: 'draft', check_not_before: null, check_attempts: 1 });
    expect(topicLedger()).toEqual([{ ref_id: ref1, cents: 1 }]);
    expect(p.calls.length).toBe(1);
  });

  it('1 巡あたり TOPIC_CHECK_MAX_ATTEMPTS（2）回で止まり held: check_failed が残る', async () => {
    await seedTopic(db, { id: T, body: talkBody() });
    const p = scriptedPort([apiError(500), apiError(500), checkMessage(checkIn([]))]);
    await checkTopic(env, p.port, T, { deadline: far(), fetchImpl });
    db.prepare('UPDATE topics SET check_not_before = NULL WHERE id = ?').run(T);
    await checkTopic(env, p.port, T, { deadline: far(), fetchImpl });
    expect(topic(db, T)).toMatchObject({ status: 'held', hold_reason: 'check_failed', check_attempts: 2 });
    expect((await checkTopic(env, p.port, T, { deadline: far(), fetchImpl })).status).toBe('not_taken');
    expect(p.calls.length).toBe(2);
    expect(topicLedger().map((r) => r.ref_id)).toEqual([ref1, `tp:${T}:chk:2`]);
  });

  it('判定の書き込み: lease を失った判定は 1 行も書かず、台帳は取り置き額のまま', async () => {
    await seedTopic(db, { id: T, body: talkBody() });
    const p = scriptedPort([
      (params) => {
        db.prepare('UPDATE topics SET check_lease_until = ? WHERE id = ?').run(past(), T);
        return supportPassed({ sensitivity: 'heavy' })(params);
      },
    ]);
    expect((await checkTopic(env, p.port, T, { deadline: far(), fetchImpl })).status).toBe('lost');
    expect(topic(db, T)).toMatchObject({ status: 'checking', sensitivity: 'normal' });
    expect(count(db, 'SELECT COUNT(*) AS n FROM topic_checks')).toBe(0);
    expect(count(db, 'SELECT COUNT(*) AS n FROM topic_decisions')).toBe(0);
    expect(topicLedger()).toEqual([{ ref_id: ref1, cents: 15 }]);
  });

  it('判定の書き込みを 2 回流しても、状態・台帳の確定・決定の記録・topic_over_reserve が変わらない', async () => {
    await seedTopic(db, { id: T, body: talkBody() });
    const p = scriptedPort([checkMessage(checkIn([]), { output: 20_000 })]); // 実額 = (6000 + 200000)/10000 = 21 > 15
    expect((await checkTopic(env, p.port, T, { deadline: far(), fetchImpl })).status).toBe('ready');
    const snap = () => ({
      t: topic(db, T).status,
      l: topicLedger(),
      d: count(db, 'SELECT COUNT(*) AS n FROM topic_decisions'),
      c: count(db, 'SELECT COUNT(*) AS n FROM topic_checks'),
      o: setting('topic_over_reserve'),
    });
    const before = snap();
    expect(before).toEqual({ t: 'ready', l: [{ ref_id: ref1, cents: 15 }], d: 1, c: 1, o: '1' });
    await env.DB.batch(batches[batches.length - 1] as D1PreparedStatement[]);
    expect(snap()).toEqual(before);
  });
});
