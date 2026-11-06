// contract-T T-14 b7: 予定（確定は 1 日 1 回・batch の途中の失敗で何も残らない・系譜・30 日・空き・止めたお題）
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import { topicSchedule } from '../src/routes/topics';
import { libraryTopics } from '../src/routes/library';
import { pickForDay, planDay, planStep, planStmts, type PickCandidate } from '../src/topics/schedule';
import { addDays } from '../src/topics/schema';
import { count, enable, makeBody, migratedDb, newsBody, philoBody, routeCtx, seedTopic, setSetting, talkBody, tokyoToday, topicEnv } from './topics-helpers';

let db: DatabaseSync;
let env: Env;
const D = '2026-11-20';

const cand = (o: Partial<PickCandidate> & { id: string; kind: PickCandidate['kind'] }): PickCandidate => ({
  status: 'ready',
  lineage_id: o.id,
  depth: 0,
  created_at: '2026-11-01T00:00:00.000Z',
  slot_day: '2026-11-01',
  starred: 0,
  evergreen: o.kind === 'news' ? 0 : 1,
  fresh_until: o.kind === 'news' ? addDays(D, 3) : null,
  ...o,
});

beforeEach(() => {
  db = migratedDb();
  enable(db);
  env = topicEnv(db);
});

describe('pickForDay（決定論の純関数）', () => {
  it('同じ系譜は 1 本（depth が大きい方、同じなら新しい方）', () => {
    const r = pickForDay([cand({ id: 'a', kind: 'talk' }), cand({ id: 'a2', kind: 'talk', lineage_id: 'a', depth: 1 }), cand({ id: 'a3', kind: 'talk', lineage_id: 'a', depth: 1, created_at: '2026-11-02T00:00:00.000Z' })], [], D);
    expect(r).toEqual([{ day: D, kind: 'talk', pos: 1, topic_id: 'a3', lineage_id: 'a' }]);
  });
  it('D − 30 に出した系譜は D に入らず、D − 31 は入る', () => {
    const c = [cand({ id: 'x', kind: 'philo' })];
    expect(pickForDay(c, [{ lineage_id: 'x', day: addDays(D, -30) }], D)).toEqual([]);
    expect(pickForDay(c, [{ lineage_id: 'x', day: addDays(D, -31) }], D).map((p) => p.topic_id)).toEqual(['x']);
  });
  it('足りない時は空きのまま（枠の数より少ない）・期限切れの news と ready でないものは入らない', () => {
    const r = pickForDay([cand({ id: 'n1', kind: 'news' }), cand({ id: 'n2', kind: 'news', fresh_until: addDays(D, -1) }), cand({ id: 'm1', kind: 'make', status: 'held' })], [], D);
    expect(r.map((p) => p.topic_id)).toEqual(['n1']);
  });
  it('並び: slot_day = D → まだ出していない → 最後に出した日が古い → starred → id', () => {
    const c = [
      cand({ id: 'z_star', kind: 'make', starred: 1 }),
      cand({ id: 'b_old', kind: 'make' }),
      cand({ id: 'a_new', kind: 'make' }),
      cand({ id: 'y_today', kind: 'make', slot_day: D }),
      cand({ id: 'c_never', kind: 'make' }),
    ];
    const h = [
      { lineage_id: 'b_old', day: addDays(D, -60) },
      { lineage_id: 'a_new', day: addDays(D, -40) },
      { lineage_id: 'z_star', day: addDays(D, -40) },
    ];
    expect(pickForDay(c, h, D).map((p) => [p.topic_id, p.pos])).toEqual([
      ['y_today', 1],
      ['c_never', 2],
      ['b_old', 3],
    ]);
    // 同じ日に最後に出したもの同士は starred が先
    expect(pickForDay(c.filter((x) => ['z_star', 'a_new'].includes(x.id)), h, D).map((p) => p.topic_id)).toEqual(['z_star', 'a_new']);
  });
  it('種類をまたいで同じ系譜は、後の種類の候補から外す', () => {
    const r = pickForDay([cand({ id: 'n1', kind: 'news' }), cand({ id: 't1', kind: 'talk', lineage_id: 'n1' }), cand({ id: 't2', kind: 'talk' })], [], D);
    expect(r.map((p) => p.topic_id)).toEqual(['n1', 't2']);
  });
});

describe('予定の確定（planDay）', () => {
  const today = tokyoToday();
  beforeEach(async () => {
    await seedTopic(db, { id: 'tp_n_1', body: newsBody(today), status: 'ready', slotDay: today });
    await seedTopic(db, { id: 'tp_t_1', body: talkBody(), status: 'ready' });
    await seedTopic(db, { id: 'tp_p_1', body: philoBody(), status: 'ready' });
    await seedTopic(db, { id: 'tp_m_1', body: makeBody(), status: 'ready' });
  });

  it('同じ日の確定を 2 回流しても行が増えない', async () => {
    expect(await planDay(env, today)).toBe('made');
    const n = count(db, 'SELECT COUNT(*) AS n FROM topic_schedule');
    expect(n).toBe(4);
    expect(await planDay(env, today)).toBe('exists');
    expect(count(db, 'SELECT COUNT(*) AS n FROM topic_schedule')).toBe(n);
    expect(db.prepare('SELECT made FROM topic_plans WHERE day = ?').get(today)).toEqual({ made: 4 });
    // 確定の後に出せるようになったお題はその日に入らない
    await seedTopic(db, { id: 'tp_m_2', body: makeBody('ダンボールで迷路を作る'), status: 'ready' });
    await planDay(env, today);
    expect(count(db, "SELECT COUNT(*) AS n FROM topic_schedule WHERE topic_id = 'tp_m_2'")).toBe(0);
  });

  it('batch の途中の失敗で topic_plans も行も残らない（now を渡し、2 行目の一意制約で落ちる）', async () => {
    const p = { day: today, kind: 'talk' as const, pos: 1, topic_id: 'tp_t_1', lineage_id: 'tp_t_1' };
    const stmts = planStmts(today, [p, { ...p, topic_id: 'tp_p_1', lineage_id: 'tp_p_1' }], new Date().toISOString()); // 2 行目が (day, kind, pos) の主キーに当たる
    // 1 文目（topic_plans）と 2 文目（予定の 1 行目）だけなら書ける = 落ちるのは 3 文目の一意制約
    db.exec('BEGIN');
    for (const s of stmts.slice(0, 2)) db.prepare(s.sql).run(...(s.params as Array<string | number | null>));
    expect(count(db, 'SELECT COUNT(*) AS n FROM topic_schedule')).toBe(1);
    db.exec('ROLLBACK');
    await expect(env.DB.batch(stmts.map((s) => env.DB.prepare(s.sql).bind(...s.params)))).rejects.toThrow(/UNIQUE constraint failed: topic_schedule/);
    expect(count(db, 'SELECT COUNT(*) AS n FROM topic_plans')).toBe(0);
    expect(count(db, 'SELECT COUNT(*) AS n FROM topic_schedule')).toBe(0);
  });

  it('予定の確定と配信は一時停止（paused）では止めない（入・切だけを見る。v2.4）', async () => {
    setSetting(db, 'paused', '1');
    expect(await planDay(env, today, { requireReady: true })).toBe('made');
    const lib = (await (await libraryTopics(env, new URL('http://x/api/library/topics'))).json()) as { topics: Array<{ topic_id: string }> };
    expect(lib.topics.length).toBeGreaterThan(0);
    const morning = new Date(`${today}T01:00:00.000Z`);
    expect((await planStep(env, morning)).today).toBe('exists');
  });

  it('同じ系譜が同じ日に 2 つ入らない（UNIQUE (day, lineage_id)）', async () => {
    await planDay(env, today);
    expect(() => db.prepare("INSERT INTO topic_schedule (day, kind, pos, topic_id, lineage_id) VALUES (?, 'make', 3, 'tp_m_1', 'tp_t_1')").run(today)).toThrow(/UNIQUE/);
  });

  it('入・切が切なら確定しない / 当日は時刻に関係なく、翌日は Asia/Tokyo の 18:00 以降だけ', async () => {
    setSetting(db, 'topics_enabled', '0');
    expect(await planDay(env, today)).toBe('disabled');
    setSetting(db, 'topics_enabled', '1');
    const morning = new Date(`${today}T01:00:00.000Z`); // 10:00 JST
    expect(await planStep(env, morning)).toEqual({ today: 'made', tomorrow: null });
    const evening = new Date(`${today}T09:30:00.000Z`); // 18:30 JST
    expect(await planStep(env, evening)).toEqual({ today: 'exists', tomorrow: 'made' });
  });

  it('当日の分は出せるお題が 1 本も無い時は確定しない（no_ready・topic_plans に行を作らない）。出せるお題ができた次の tick で確定する（v2.3）', async () => {
    db.prepare("UPDATE topics SET status = 'held'").run();
    // 期限切れの news は ready でも当日の候補にならない
    await seedTopic(db, { id: 'tp_n_old', body: newsBody(today), status: 'ready', slotDay: today });
    db.prepare("UPDATE topics SET fresh_until = ? WHERE id = 'tp_n_old'").run(addDays(today, -1));
    expect(await planDay(env, today, { requireReady: true })).toBe('no_ready');
    expect(count(db, 'SELECT COUNT(*) AS n FROM topic_plans')).toBe(0);
    const morning = new Date(`${today}T01:00:00.000Z`); // 10:00 JST
    expect(await planStep(env, morning)).toEqual({ today: 'no_ready', tomorrow: null });
    expect(count(db, 'SELECT COUNT(*) AS n FROM topic_plans')).toBe(0);
    db.prepare("UPDATE topics SET status = 'ready' WHERE id = 'tp_p_1'").run();
    expect(await planStep(env, morning)).toEqual({ today: 'made', tomorrow: null });
    expect(db.prepare('SELECT made FROM topic_plans WHERE day = ?').get(today)).toEqual({ made: 1 });
  });

  it('翌日の分は出せるお題が 0 本でも確定する（18:00 以降）', async () => {
    db.prepare("UPDATE topics SET status = 'held'").run();
    const evening = new Date(`${today}T09:30:00.000Z`); // 18:30 JST
    expect(await planStep(env, evening)).toEqual({ today: 'no_ready', tomorrow: 'made' });
    expect(db.prepare('SELECT made FROM topic_plans WHERE day = ?').get(addDays(today, 1))).toEqual({ made: 0 });
    expect(count(db, 'SELECT COUNT(*) AS n FROM topic_plans WHERE day = ?', today)).toBe(0);
  });

  it('止めたお題は配信に出ず、schedule API で stopped になる。枠の残りは empty', async () => {
    await planDay(env, today);
    db.prepare("UPDATE topics SET status = 'retired' WHERE id = 'tp_t_1'").run();
    const lib = (await (await libraryTopics(env, new URL('http://x/api/library/topics'))).json()) as { topics: Array<{ topic_id: string }> };
    expect(lib.topics.map((t) => t.topic_id).sort()).toEqual(['tp_m_1', 'tp_n_1', 'tp_p_1']);
    const s = (await (await topicSchedule(routeCtx(env, 'GET', `/api/topics/schedule?day=${today}`))).json()) as { planned: boolean; slots: Array<{ kind: string; pos: number; state: string; topic: { id: string } | null }> };
    expect(s.planned).toBe(true);
    expect(s.slots.length).toBe(7);
    expect(s.slots.map((x) => `${x.kind}${x.pos}:${x.state}`)).toEqual(['news1:ready', 'news2:empty', 'talk1:stopped', 'philo1:ready', 'make1:ready', 'make2:empty', 'make3:empty']);
    expect(s.slots.find((x) => x.kind === 'talk')?.topic?.id).toBe('tp_t_1');
    expect((await topicSchedule(routeCtx(env, 'GET', '/api/topics/schedule?day=2026-02-30'))).status).toBe(400);
  });
});
