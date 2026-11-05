// contract-T T-14 b8: 派生（見直す・発展させる）と、生成の run の余り・種類違い
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import { checkTopic } from '../src/topics/check';
import { deriveCandidates, runDerive } from '../src/topics/derive';
import { runTopicRun } from '../src/topics/gen';
import {
  count,
  enable,
  fetchStub,
  genMessage,
  ledger,
  migratedDb,
  newsBody,
  philoBody,
  scriptedPort,
  seedTopic,
  supportPassed,
  talkBody,
  tomorrow,
  topic,
  topicEnv,
} from './topics-helpers';

let db: DatabaseSync;
let env: Env;
const { fetchImpl } = fetchStub({});
const far = () => Date.now() + 10 * 60_000;
const P = 'tp_p_1';
const derive = (kind: 'refresh' | 'extend', steps: Parameters<typeof scriptedPort>[0], trigger: 'cron' | 'manual' = 'manual', parentId = P) => {
  const p = scriptedPort(steps);
  return runDerive(env, p.port, { parentId, kind, trigger }, { deadline: far(), fetchImpl }).then((o) => ({ o, calls: p.calls.length }));
};
const children = (kind: string) => db.prepare('SELECT id, status, depth, lineage_id, parent_topic_id FROM topics WHERE parent_topic_id = ? AND derive_kind = ? ORDER BY rowid').all(P, kind) as Array<Record<string, unknown>>;
const check = (id: string) => checkTopic(env, scriptedPort([supportPassed()]).port, id, { deadline: far(), fetchImpl });
const runs = () => count(db, 'SELECT COUNT(*) AS n FROM topic_runs');

beforeEach(async () => {
  db = migratedDb();
  enable(db);
  env = topicEnv(db);
  await seedTopic(db, { id: P, body: newsBody(tomorrow()), status: 'ready', found: true });
});

describe('見直す（refresh）', () => {
  it('子が ready になると、同じ batch で親が引退する（子は親と同じ題でもよい）。子は親の系譜・depth + 1', async () => {
    const { o } = await derive('refresh', [genMessage([{ ...newsBody(tomorrow()), lead: { s: '新しい情報', e: 'あたらしい' } }], { fetches: [{ url: 'https://src.example.org/news/1', text: 'これは出典のページに書いてある二十字以上の引用の文章です。' }] })]);
    expect(o.status).toBe('done');
    const [c] = children('refresh');
    expect(c).toMatchObject({ status: 'draft', depth: 1, lineage_id: P, parent_topic_id: P });
    expect(topic(db, String(c.id)).title).toBe(topic(db, P).title);
    expect((await check(String(c.id))).status).toBe('ready');
    expect(topic(db, P).status).toBe('retired');
    expect(db.prepare("SELECT id, decision FROM topic_decisions WHERE topic_id = ?").all(P)).toEqual([{ id: `td:${P}:retire:${c.id}`, decision: 'auto_retire' }]);
  });

  it('親が先に引退していても、子はそのまま ready になる（親は何も変わらず、記録も書かない）', async () => {
    await derive('refresh', [genMessage([newsBody(tomorrow())], { fetches: [{ url: 'https://src.example.org/news/1', text: 'これは出典のページに書いてある二十字以上の引用の文章です。' }] })]);
    db.prepare("UPDATE topics SET status = 'retired' WHERE id = ?").run(P);
    const [c] = children('refresh');
    expect((await check(String(c.id))).status).toBe('ready');
    expect(topic(db, P).status).toBe('retired');
    expect(count(db, 'SELECT COUNT(*) AS n FROM topic_decisions WHERE topic_id = ?', P)).toBe(0);
  });

  it('held（source_lost）の親からも作れる / held（flagged）の親からは取れない（台帳も run も増えない）', async () => {
    db.prepare("UPDATE topics SET status = 'held', hold_reason = 'flagged' WHERE id = ?").run(P);
    const r1 = await derive('refresh', [genMessage([newsBody(tomorrow())])]);
    expect(r1.o).toMatchObject({ status: 'not_taken', reason: 'parent_not_eligible' });
    expect([runs(), ledger(db).length, r1.calls]).toEqual([0, 0, 0]);
    db.prepare("UPDATE topics SET hold_reason = 'source_lost' WHERE id = ?").run(P);
    expect((await derive('refresh', [genMessage([newsBody(tomorrow())])])).o.status).toBe('done');
  });

  it('深さ 5 の親・状態の合わない親（draft・retired）からは run が取れず、台帳の行も増えない', async () => {
    for (const set of ["UPDATE topics SET depth = 5 WHERE id = ?", "UPDATE topics SET depth = 0, status = 'draft' WHERE id = ?", "UPDATE topics SET status = 'retired' WHERE id = ?"]) {
      db.prepare(set).run(P);
      for (const kind of ['refresh', 'extend'] as const) {
        const r = await derive(kind, [genMessage([philoBody()])]);
        expect(r.o).toMatchObject({ status: 'not_taken', reason: 'parent_not_eligible' });
        expect([runs(), ledger(db).length, r.calls]).toEqual([0, 0, 0]);
      }
    }
  });

  it('生きた見直しの子（draft・checking・ready）が 2 つできない / held の子は次の見直しを塞がない', async () => {
    await derive('refresh', [genMessage([newsBody(tomorrow())])]);
    const r2 = await derive('refresh', [genMessage([newsBody(tomorrow())])]);
    expect(r2.o).toMatchObject({ status: 'not_taken', reason: 'parent_not_eligible' });
    expect(r2.calls).toBe(0);
    expect(children('refresh').length).toBe(1);
    // 索引でも 2 つ目の生きた見直しの子は入らない
    const c = children('refresh')[0];
    expect(() => db.prepare("UPDATE topics SET parent_topic_id = ?, derive_kind = 'refresh', status = 'ready' WHERE id = ?").run(P, P)).toThrow(/UNIQUE|CHECK/);
    db.prepare("UPDATE topics SET status = 'held', hold_reason = 'source_not_found' WHERE id = ?").run(String(c.id));
    const r3 = await derive('refresh', [genMessage([newsBody(tomorrow())])]);
    expect(r3.o.status).toBe('done');
    expect(children('refresh').map((x) => x.status)).toEqual(['held', 'draft']);
  });

  it('応答が 2 本以上・種類違いの時に余りが保存されない（見直しは親と同じ種類で 1 本）', async () => {
    const r = await derive('refresh', [genMessage([talkBody(), newsBody(tomorrow()), newsBody(tomorrow(), '別の題のニュースの見出し')])]);
    expect(r.o.status).toBe('done');
    expect(db.prepare('SELECT made, dropped FROM topic_runs').get()).toEqual({ made: 1, dropped: 2 });
    expect(children('refresh').length).toBe(1);
  });
});

describe('発展させる（extend）', () => {
  it('親は残る。子の種類は talk・philo・make（news の子は保存しない）', async () => {
    const r = await derive('extend', [genMessage([newsBody(tomorrow(), '別のニュース'), philoBody()], { fetches: [] })]);
    expect(r.o.status).toBe('done');
    expect(db.prepare('SELECT made, dropped FROM topic_runs').get()).toEqual({ made: 1, dropped: 1 });
    const [c] = children('extend');
    expect(topic(db, String(c.id))).toMatchObject({ kind: 'philo', depth: 1, lineage_id: P });
    db.prepare("UPDATE topic_sources SET fetch_result = 'found', evidence = 'gen_fetch', excerpt = quote WHERE topic_id = ?").run(String(c.id));
    expect((await check(String(c.id))).status).toBe('ready');
    expect(topic(db, P).status).toBe('ready');
  });

  it('発展の子（状態を問わない）を 2 つ持つ親からは取れない（取り置きの INSERT の WHERE）', async () => {
    await derive('extend', [genMessage([philoBody()])]);
    db.prepare("UPDATE topics SET status = 'rejected' WHERE parent_topic_id = ?").run(P);
    await derive('extend', [genMessage([philoBody('友だちとは何だろう')])]);
    expect(children('extend').length).toBe(2);
    const r = await derive('extend', [genMessage([philoBody('時間はどこから来るのか')])]);
    expect(r.o).toMatchObject({ status: 'not_taken', reason: 'parent_not_eligible' });
    expect(r.calls).toBe(0);
    expect(ledger(db).length).toBe(2);
  });
});

describe('週の上限（TOPIC_DERIVE_PER_WEEK = 3。cron だけ数える）', () => {
  it('cron の派生は週 3 回まで。4 回目は取り置きの文で取れない。手動は数えない', async () => {
    for (let i = 2; i <= 5; i++) await seedTopic(db, { id: `tp_p_${i}`, body: newsBody(tomorrow(), `見出し ${'あいうえお'[i - 1]}${i}`), status: 'ready', starred: 1 });
    await derive('extend', [genMessage([philoBody('問い 1')])], 'manual', 'tp_p_2');
    for (const id of ['tp_p_3', 'tp_p_4', 'tp_p_5']) expect((await derive('extend', [genMessage([philoBody(`問い ${id}`)])], 'cron', id)).o.status).toBe('done');
    const r = await derive('extend', [genMessage([philoBody('問い 最後')])], 'cron', P);
    expect(r.o).toMatchObject({ status: 'not_taken', reason: 'week_cap' });
    expect(r.calls).toBe(0);
    expect(ledger(db).length).toBe(4);
    expect(await deriveCandidates(env)).toEqual([]);
    // 手動はまだ取れる
    expect((await derive('extend', [genMessage([philoBody('問い 手動')])], 'manual', P)).o.status).toBe('done');
  });

  it('自動の候補: source_lost の held（先）/ starred の ready・期限の近い news の ready', async () => {
    await seedTopic(db, { id: 'tp_h_1', body: philoBody(), status: 'held', holdReason: 'source_lost' });
    const c = await deriveCandidates(env);
    expect(c[0]).toEqual({ parentId: 'tp_h_1', kind: 'refresh' });
    expect(c).not.toContainEqual({ parentId: P, kind: 'extend' }); // fresh_until が今日 + 2 より先・星なし
    db.prepare("UPDATE topics SET starred = 1 WHERE id = ?").run(P);
    expect(await deriveCandidates(env)).toContainEqual({ parentId: P, kind: 'extend' });
  });
});

describe('生成の run の本数の上限と種類違い（T-4）', () => {
  it('news の run は 2 本まで（3 本目は dropped）、種類違いも dropped', async () => {
    const p = scriptedPort([genMessage([newsBody(tomorrow(), 'ニュース一'), talkBody(), newsBody(tomorrow(), 'ニュース二'), newsBody(tomorrow(), 'ニュース三')])]);
    const o = await runTopicRun(env, p.port, { purpose: 'gen', kind: 'news', trigger: 'manual', slotDay: tomorrow() }, { deadline: far(), fetchImpl });
    expect(o.status).toBe('done');
    expect(db.prepare("SELECT made, dropped FROM topic_runs WHERE purpose = 'gen'").get()).toEqual({ made: 2, dropped: 2 });
    // id は run の応答の n 本目
    const run = db.prepare("SELECT id FROM topic_runs WHERE purpose = 'gen'").get() as { id: string };
    expect(count(db, "SELECT COUNT(*) AS n FROM topics WHERE run_id = ? AND kind = 'news'", run.id)).toBe(2);
    expect(db.prepare("SELECT id FROM topics WHERE run_id = ? ORDER BY id").all(run.id)).toEqual([{ id: `tp_${run.id}_1` }, { id: `tp_${run.id}_3` }]);
  });
});
