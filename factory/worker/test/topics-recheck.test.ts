// contract-T T-14 b11: ストックの見直し（T-8）
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import { stockRecheckStep } from '../src/topics/check';
import { enable, fetchStub, migratedDb, philoBody, seedTopic, talkBody, topic, topicEnv } from './topics-helpers';

let db: DatabaseSync;
let env: Env;
const Q1 = 'これは出典のページに書いてある二十字以上の引用の文章です。';
const Q2 = 'ある哲学者は、部品が変わっても同じ船だと述べたと伝えられています。';
const far = () => Date.now() + 10 * 60_000;
const weeks = (k: number) => new Date(Date.now() + k * 7 * 86_400_000);
const up = () => fetchStub({ 'https://src.example.org/philo/1': { body: `<p>${Q1}</p>` }, 'https://src.example.org/philo/2': { body: `<p>${Q2}</p>` } });

beforeEach(() => {
  db = migratedDb();
  enable(db);
  env = topicEnv(db);
});

describe('ストックの見直し', () => {
  it('全部 found → last_checked_at・recheck_tried_at を進め、recheck_fail_count = 0（recheck_tried_at が NULL のお題が対象に入る）', async () => {
    await seedTopic(db, { id: 'tp_a_1', body: philoBody(), status: 'ready', found: true });
    db.prepare("UPDATE topics SET recheck_fail_count = 2 WHERE id = 'tp_a_1'").run();
    expect(topic(db, 'tp_a_1').recheck_tried_at).toBeNull();
    const r = await stockRecheckStep(env, { deadline: far(), fetchImpl: up().fetchImpl });
    expect(r).toMatchObject({ tried: 1, ok: 1 });
    const t = topic(db, 'tp_a_1');
    expect(t).toMatchObject({ status: 'ready', recheck_fail_count: 0 });
    expect(t.recheck_tried_at).not.toBeNull();
    expect(t.last_checked_at).not.toBeNull();
    // 同じ週のうちはもう試さない
    expect((await stockRecheckStep(env, { deadline: far(), fetchImpl: up().fetchImpl })).tried).toBe(0);
  });

  it('1 つでも not_found → ready → held（source_lost・記録 auto_hold）・その出典を not_found に書き換える', async () => {
    await seedTopic(db, { id: 'tp_a_1', body: philoBody(), status: 'ready', found: true });
    const f = fetchStub({ 'https://src.example.org/philo/1': { body: `<p>${Q1}</p>` }, 'https://src.example.org/philo/2': { body: '<p>書き換わった</p>' } });
    expect((await stockRecheckStep(env, { deadline: far(), fetchImpl: f.fetchImpl })).lost).toBe(1);
    expect(topic(db, 'tp_a_1')).toMatchObject({ status: 'held', hold_reason: 'source_lost' });
    expect(db.prepare("SELECT source_id, fetch_result FROM topic_sources WHERE topic_id = 'tp_a_1' ORDER BY source_id").all()).toEqual([
      { source_id: 's1', fetch_result: 'found' },
      { source_id: 's2', fetch_result: 'not_found' },
    ]);
    expect(db.prepare("SELECT decision, by FROM topic_decisions WHERE topic_id = 'tp_a_1'").all()).toEqual([{ decision: 'auto_hold', by: 'machine' }]);
  });

  it('開けないのが 4 回（4 週）続いて held（source_unreachable）。3 回までは recheck_fail_count を進めるだけ', async () => {
    await seedTopic(db, { id: 'tp_a_1', body: philoBody(), status: 'ready', found: true });
    const down = fetchStub({ 'https://src.example.org/philo/1': { status: 503 }, 'https://src.example.org/philo/2': { body: `<p>${Q2}</p>` } });
    for (let k = 0; k < 3; k++) {
      expect((await stockRecheckStep(env, { deadline: far(), fetchImpl: down.fetchImpl, now: weeks(k) })).failed).toBe(1);
      expect(topic(db, 'tp_a_1')).toMatchObject({ status: 'ready', recheck_fail_count: k + 1 });
    }
    expect((await stockRecheckStep(env, { deadline: far(), fetchImpl: down.fetchImpl, now: weeks(3) })).unreachable).toBe(1);
    expect(topic(db, 'tp_a_1')).toMatchObject({ status: 'held', hold_reason: 'source_unreachable', recheck_fail_count: 4 });
  });

  it('開けないお題が先頭に居続けても、後ろのお題がその週のうちに試される（1 tick 最大 5 本・NULL を先に）', async () => {
    await seedTopic(db, { id: 'tp_a_0', body: philoBody('開けない問い'), status: 'ready', found: true, createdAt: '2026-01-01T00:00:00.000Z' });
    for (let i = 1; i <= 5; i++) await seedTopic(db, { id: `tp_b_${i}`, body: talkBody(`後ろの問い${i}`), status: 'ready' });
    const down = fetchStub({});
    const r1 = await stockRecheckStep(env, { deadline: far(), fetchImpl: down.fetchImpl });
    expect(r1.tried).toBe(5);
    expect(topic(db, 'tp_a_0')).toMatchObject({ recheck_fail_count: 1 });
    const r2 = await stockRecheckStep(env, { deadline: far(), fetchImpl: down.fetchImpl });
    expect(r2.tried).toBe(1);
    expect(db.prepare("SELECT COUNT(*) AS n FROM topics WHERE recheck_tried_at IS NULL").get()).toEqual({ n: 0 });
    expect((await stockRecheckStep(env, { deadline: far(), fetchImpl: down.fetchImpl })).tried).toBe(0);
  });

  it('見直しの週は古い日付へ戻さない（今の値より大きい時だけ進める）', async () => {
    await stockRecheckStep(env, { deadline: far(), fetchImpl: up().fetchImpl, now: weeks(2) });
    const v = (db.prepare("SELECT value FROM settings WHERE key = 'topic_recheck_week'").get() as { value: string }).value;
    await stockRecheckStep(env, { deadline: far(), fetchImpl: up().fetchImpl, now: weeks(0) });
    expect((db.prepare("SELECT value FROM settings WHERE key = 'topic_recheck_week'").get() as { value: string }).value).toBe(v);
  });
});
