// contract-T T-14 b6（gate と承認）・b6-b（やり直し）
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { FactoryPort } from '../src/anthropic';
import type { Env } from '../src/env';
import { decideTopic } from '../src/routes/topics';
import { checkTopic, cleanupLeases, stockRecheckStep } from '../src/topics/check';
import { topicGate } from '../src/topics/gate';
import {
  checkIn,
  checkMessage,
  count,
  enable,
  fetchStub,
  ledger,
  makeBody,
  migratedDb,
  newsBody,
  philoBody,
  routeCtx,
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
const empty = fetchStub({});
const far = () => Date.now() + 10 * 60_000;
const past = () => new Date(Date.now() - 60_000).toISOString();
const decisions = (id: string) => db.prepare('SELECT decision, by, read_all FROM topic_decisions WHERE topic_id = ? ORDER BY created_at, id').all(id);
const check = (id: string, port: FactoryPort, fetchImpl = empty.fetchImpl) => checkTopic(env, port, id, { deadline: far(), fetchImpl });
const sha = (id: string) => String(topic(db, id).content_sha256);
const decide = async (id: string, body: Record<string, unknown>) => {
  const r = await decideTopic(routeCtx(env, 'POST', `/api/topics/${id}/decide`, body), id);
  return { status: r.status, json: (await r.json()) as Record<string, unknown> };
};
const Q = 'これは出典のページに書いてある二十字以上の引用の文章です。';

beforeEach(() => {
  db = migratedDb();
  enable(db);
  env = topicEnv(db);
});

describe('自動で出す（topicGate.auto）', () => {
  it('全部そろって緑・重くない → ready になり、決定の記録（auto_ready）が 1 行。お題が 1 本だけでも自分を重複と数えない', async () => {
    await seedTopic(db, { id: 'tp_a_1', body: philoBody(), found: true });
    expect((await check('tp_a_1', scriptedPort([supportPassed()]).port)).status).toBe('ready');
    expect(topic(db, 'tp_a_1')).toMatchObject({ status: 'ready', check_token: null, check_lease_until: null, hold_reason: null });
    expect(decisions('tp_a_1')).toEqual([{ decision: 'auto_ready', by: 'machine', read_all: 0 }]);
  });

  it('重い → ready にならず held: heavy（重い話題は機械では上げることだけ）', async () => {
    await seedTopic(db, { id: 'tp_a_1', body: philoBody(), found: true });
    expect((await check('tp_a_1', scriptedPort([supportPassed({ sensitivity: 'heavy', heavy_reasons: ['war'] })]).port)).status).toBe('held');
    expect(topic(db, 'tp_a_1')).toMatchObject({ status: 'held', hold_reason: 'heavy', sensitivity: 'heavy' });
    expect(decisions('tp_a_1')).toEqual([{ decision: 'auto_hold', by: 'machine', read_all: 0 }]);
  });

  it('緑でない → ready にならない（flags）', async () => {
    await seedTopic(db, { id: 'tp_a_1', body: philoBody(), found: true });
    await check('tp_a_1', scriptedPort([supportPassed({ flags: ['one_sided'] })]).port);
    expect(topic(db, 'tp_a_1')).toMatchObject({ status: 'held', hold_reason: 'flagged' });
  });

  it('gate の述語: sha 違い・lease 切れ・重い・緑でない記録のそれぞれで 0 行（SQL を直接当てる）', async () => {
    await seedTopic(db, { id: 'tp_a_1', body: talkBody() });
    const now = new Date().toISOString();
    const setChecking = (lease: string) => db.prepare("UPDATE topics SET status = 'checking', check_attempts = 1, check_token = 'K', check_lease_until = ?, sensitivity = 'normal' WHERE id = 'tp_a_1'").run(lease);
    const putCheck = (o: { sha?: string; verdict?: string; sens?: string }) => {
      db.prepare('DELETE FROM topic_checks').run();
      db.prepare("INSERT INTO topic_checks VALUES ('tp_a_1', 1, ?, ?, 1, 1, 'K', ?, '[]', '{}', ?)").run(o.sha ?? sha('tp_a_1'), o.verdict ?? 'green', o.sens ?? 'normal', now);
    };
    const run = () => {
      const s = topicGate.auto({ id: 'tp_a_1', token: 'K', now: new Date().toISOString() });
      return Number(db.prepare(s.sql).run(...(s.params as Array<string | number | null>)).changes);
    };
    const future = new Date(Date.now() + 600_000).toISOString();
    setChecking(future);
    putCheck({ sha: 'f'.repeat(64) });
    expect(run()).toBe(0);
    putCheck({ verdict: 'red' });
    expect(run()).toBe(0);
    putCheck({ sens: 'heavy' });
    expect(run()).toBe(0);
    putCheck({});
    db.prepare("UPDATE topics SET sensitivity = 'heavy' WHERE id = 'tp_a_1'").run();
    expect(run()).toBe(0);
    setChecking(past());
    expect(run()).toBe(0);
    setChecking(future);
    expect(run()).toBe(1); // 全部そろえば 1 行
  });

  it('同じ題の ready が検査の途中で出た → gate は 0 行で、受け皿の文が held: duplicate_race にする（checking のまま残らない）', async () => {
    await seedTopic(db, { id: 'tp_a_1', body: talkBody() });
    await seedTopic(db, { id: 'tp_b_1', body: talkBody(), status: 'rejected' });
    const p = scriptedPort([
      (params) => {
        db.prepare("UPDATE topics SET status = 'ready' WHERE id = 'tp_b_1'").run();
        return supportPassed()(params);
      },
    ]);
    expect((await check('tp_a_1', p.port)).status).toBe('held');
    expect(topic(db, 'tp_a_1')).toMatchObject({ status: 'held', hold_reason: 'duplicate_race', check_token: null, check_lease_until: null });
    expect(decisions('tp_a_1')).toEqual([{ decision: 'auto_hold', by: 'machine', read_all: 0 }]);
  });

  it('lease が切れた後に届いた完了・片付けの後に届いた古い attempt の完了は、状態も決定の記録も 1 行も書かない', async () => {
    await seedTopic(db, { id: 'tp_a_1', body: talkBody() });
    let inner: Promise<unknown> | null = null;
    const p = scriptedPort([
      (params) => {
        // attempt 1 の呼び出し中に lease が切れて片付けられ、attempt 2 が取られる
        db.prepare("UPDATE topics SET check_lease_until = ? WHERE id = 'tp_a_1'").run(past());
        return supportPassed()(params);
      },
    ]);
    // 先に片付けと attempt 2 の取得を起こすため、port の中で片付けまで走らせる版
    const p2: FactoryPort = {
      ...p.port,
      async createMessage(params, o) {
        const m = await p.port.createMessage(params, o);
        await cleanupLeases(env, new Date().toISOString());
        inner = check('tp_a_1', scriptedPort([checkMessage(checkIn([]))]).port); // attempt 2（緑 → ready）
        await inner;
        return m;
      },
    };
    expect((await check('tp_a_1', p2)).status).toBe('lost');
    await inner;
    // attempt 2 の結果だけが残る（attempt 1 の記録・決定は無い）
    expect(db.prepare('SELECT attempt FROM topic_checks ORDER BY attempt').all()).toEqual([{ attempt: 2 }]);
    expect(db.prepare('SELECT id FROM topic_decisions').all()).toEqual([{ id: 'td:tp_a_1:2' }]);
    expect(topic(db, 'tp_a_1')).toMatchObject({ status: 'ready', check_attempts: 2 });
  });

  it('一度 heavy になったお題は、やり直しの検査が normal・緑でも held: heavy になり、read_all つきで承認できる', async () => {
    await seedTopic(db, { id: 'tp_a_1', body: philoBody(), found: true });
    await check('tp_a_1', scriptedPort([supportPassed({ sensitivity: 'heavy' })]).port);
    expect(topic(db, 'tp_a_1')).toMatchObject({ status: 'held', hold_reason: 'heavy' });
    // やり直し → 出典を開き直す（fetch は引用を返す）→ モデルは normal・緑
    expect((await decide('tp_a_1', { decision: 'recheck', content_sha256: sha('tp_a_1') })).status).toBe(200);
    const f = fetchStub({ 'https://src.example.org/philo/1': { body: `<p>${Q}</p>` }, 'https://src.example.org/philo/2': { body: '<p>ある哲学者は、部品が変わっても同じ船だと述べたと伝えられています。</p>' } });
    expect((await check('tp_a_1', scriptedPort([supportPassed()]).port, f.fetchImpl)).status).toBe('held');
    expect(topic(db, 'tp_a_1')).toMatchObject({ status: 'held', hold_reason: 'heavy', sensitivity: 'heavy' });
    expect((await decide('tp_a_1', { decision: 'approve', content_sha256: sha('tp_a_1') })).json).toEqual({ error: 'read_all_required' });
    const ok = await decide('tp_a_1', { decision: 'approve', content_sha256: sha('tp_a_1'), read_all: true, note: '全文を読んだ' });
    expect(ok.status).toBe(200);
    expect(topic(db, 'tp_a_1')).toMatchObject({ status: 'ready', hold_reason: null });
    expect(decisions('tp_a_1').slice(-1)).toEqual([{ decision: 'approve', by: 'ops@example.invalid', read_all: 1 }]);
  });
});

describe('人の承認（topicGate.approve。T-3）', () => {
  it('出典が通っていない held は 400 not_approvable（取り消し・見直し・reject だけ）', async () => {
    await seedTopic(db, { id: 'tp_a_1', body: newsBody(tomorrow()) });
    const f = fetchStub({ 'https://src.example.org/news/1': { body: '<p>違う本文</p>' } });
    await check('tp_a_1', scriptedPort([supportPassed()]).port, f.fetchImpl);
    expect(topic(db, 'tp_a_1')).toMatchObject({ status: 'held', hold_reason: 'source_not_found' });
    expect(await decide('tp_a_1', { decision: 'approve', content_sha256: sha('tp_a_1'), read_all: true })).toEqual({ status: 400, json: { error: 'not_approvable' } });
    expect(topic(db, 'tp_a_1').status).toBe('held');
  });

  it('禁止語だけで赤の held（必須の出典 0 個の make）・禁止語と flags の両方がある held は 400', async () => {
    const b = makeBody();
    b.lead = { s: '一番上手な人を決める', e: 'じょうず' };
    await seedTopic(db, { id: 'tp_a_1', body: b });
    await check('tp_a_1', scriptedPort([]).port);
    expect(topic(db, 'tp_a_1')).toMatchObject({ status: 'held', hold_reason: 'forbidden' });
    expect((await decide('tp_a_1', { decision: 'approve', content_sha256: sha('tp_a_1'), read_all: true })).json).toEqual({ error: 'not_approvable' });
    // 禁止語 + flags の記録（判定は forbidden が先）を直接作っても、hold_reason は forbidden で approvable = 0
    const b2 = talkBody('作品の順位を決める話し合い');
    await seedTopic(db, { id: 'tp_b_1', body: b2 });
    await check('tp_b_1', scriptedPort([]).port);
    expect(topic(db, 'tp_b_1')).toMatchObject({ hold_reason: 'forbidden' });
    expect((await decide('tp_b_1', { decision: 'approve', content_sha256: sha('tp_b_1'), read_all: true })).status).toBe(400);
  });

  it('一度 ready になった後に見直しで source_lost になった held は、前の検査の記録が緑でも 400', async () => {
    await seedTopic(db, { id: 'tp_a_1', body: philoBody(), found: true });
    await check('tp_a_1', scriptedPort([supportPassed()]).port);
    expect(topic(db, 'tp_a_1').status).toBe('ready');
    const f = fetchStub({ 'https://src.example.org/philo/1': { body: '<p>消えた</p>' }, 'https://src.example.org/philo/2': { body: '<p>消えた</p>' } });
    await stockRecheckStep(env, { deadline: far(), fetchImpl: f.fetchImpl });
    expect(topic(db, 'tp_a_1')).toMatchObject({ status: 'held', hold_reason: 'source_lost' });
    expect(db.prepare('SELECT verdict, approvable FROM topic_checks').all()).toEqual([{ verdict: 'green', approvable: 1 }]);
    expect((await decide('tp_a_1', { decision: 'approve', content_sha256: sha('tp_a_1'), read_all: true })).json).toEqual({ error: 'not_approvable' });
  });

  it('sha 違いは 409 / 状態違いは 409 / flags だけの held は承認できる', async () => {
    await seedTopic(db, { id: 'tp_a_1', body: philoBody(), found: true });
    await check('tp_a_1', scriptedPort([supportPassed({ flags: ['age_mismatch'] })]).port);
    expect(topic(db, 'tp_a_1')).toMatchObject({ status: 'held', hold_reason: 'flagged' });
    expect(await decide('tp_a_1', { decision: 'approve', content_sha256: 'a'.repeat(64) })).toEqual({ status: 409, json: { error: 'sha_mismatch' } });
    expect((await decide('tp_a_1', { decision: 'retire', content_sha256: sha('tp_a_1') })).json).toEqual({ error: 'state_conflict' });
    const ok = await decide('tp_a_1', { decision: 'approve', content_sha256: sha('tp_a_1') });
    expect(ok.status).toBe(200);
    expect((ok.json.topic as Record<string, unknown>).status).toBe('ready');
    expect((await decide('tp_a_1', { decision: 'approve', content_sha256: sha('tp_a_1') })).json).toEqual({ error: 'state_conflict' });
  });

  it('入力の検査: decision・sha が無い・note が 200 字超は 400 / 無いお題は 404', async () => {
    await seedTopic(db, { id: 'tp_a_1', body: talkBody() });
    expect((await decide('tp_a_1', { decision: 'bless', content_sha256: sha('tp_a_1') })).status).toBe(400);
    expect((await decide('tp_a_1', { decision: 'star' })).status).toBe(400);
    expect((await decide('tp_a_1', { decision: 'star', content_sha256: sha('tp_a_1'), note: 'あ'.repeat(201) })).status).toBe(400);
    expect((await decide('tp_zz_1', { decision: 'star', content_sha256: 'a'.repeat(64) })).status).toBe(404);
    expect((await decide('tp_a_1', { decision: 'star', content_sha256: sha('tp_a_1') })).status).toBe(200);
    expect(topic(db, 'tp_a_1').starred).toBe(1);
  });
});

describe('やり直し（T-3 の held → draft。T-14 b6-b）', () => {
  it('held（fetch_failed）→ recheck → 出典が pending に戻る → 開き直した結果で判定。2 巡しても台帳のキーと topic_checks の主キーが重ならない', async () => {
    await seedTopic(db, { id: 'tp_a_1', body: newsBody(tomorrow()) });
    const down = fetchStub({ 'https://src.example.org/news/1': { status: 503 } });
    // 1 巡目: 開けない → source_unreachable（巡の上限 2 回のうち 1 回で判定まで行く）
    await check('tp_a_1', scriptedPort([supportPassed()]).port, down.fetchImpl);
    expect(topic(db, 'tp_a_1')).toMatchObject({ status: 'held', hold_reason: 'source_unreachable', check_attempts: 1 });
    expect(db.prepare('SELECT fetch_result FROM topic_sources').all()).toEqual([{ fetch_result: 'fetch_failed' }]);
    // recheck
    expect((await decide('tp_a_1', { decision: 'recheck', content_sha256: sha('tp_a_1') })).status).toBe(200);
    expect(topic(db, 'tp_a_1')).toMatchObject({ status: 'draft', check_round_start: 1, check_attempts: 1, hold_reason: null, check_not_before: null });
    expect(db.prepare('SELECT fetch_result, evidence, excerpt FROM topic_sources').all()).toEqual([{ fetch_result: 'pending', evidence: null, excerpt: null }]);
    // 2 巡目: また開けない
    await check('tp_a_1', scriptedPort([supportPassed()]).port, down.fetchImpl);
    expect(topic(db, 'tp_a_1')).toMatchObject({ status: 'held', check_attempts: 2 });
    await decide('tp_a_1', { decision: 'recheck', content_sha256: sha('tp_a_1') });
    // 3 巡目: 開けて引用がある → 緑 → ready
    const up = fetchStub({ 'https://src.example.org/news/1': { body: `<p>${Q}</p>` } });
    expect((await check('tp_a_1', scriptedPort([supportPassed()]).port, up.fetchImpl)).status).toBe('ready');
    expect(db.prepare('SELECT fetch_result, evidence FROM topic_sources').all()).toEqual([{ fetch_result: 'found', evidence: 'worker_fetch' }]);
    expect(db.prepare('SELECT attempt FROM topic_checks ORDER BY attempt').all()).toEqual([{ attempt: 1 }, { attempt: 2 }, { attempt: 3 }]);
    expect(ledger(db).map((r) => r.ref_id).sort()).toEqual(['tp:tp_a_1:chk:1', 'tp:tp_a_1:chk:2', 'tp:tp_a_1:chk:3']);
    expect(count(db, "SELECT COUNT(*) AS n FROM topic_decisions WHERE decision = 'recheck'")).toBe(2);
  });
});
