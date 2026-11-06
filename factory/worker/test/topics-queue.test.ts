// contract-T v2.6: 手動のお題の run は「取る」を route の中で行い、「走る」を queue（factory-image-gen）の受け手が行う。
// (a) POST /api/topics/runs → 202・queue に 1 通・run は calling / (b) 受け手がその message で done を書く（fake の port）
// (c) 応答の後の例外 → failed: save_failed・台帳は実額・calling が残らない / (d) send が投げる → 503・run と台帳の行が消える
// (e) token 不一致・calling でない message → 何もせず ack / (f) disabled・cap は今までどおり / (g) 画像の message は今までどおり
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { FactoryPort } from '../src/anthropic';
import type { Env, FactoryQueueMessage, TopicRunQueueMessage } from '../src/env';
import worker from '../src/index';
import { deriveTopicRoute, runTopicsRoute } from '../src/routes/topics';
import { executeTopicRun, genActualCents, type RunRequest } from '../src/topics/gen';
import { count, enable, fetchStub, genMessage, ledger, migratedDb, routeCtx, scriptedPort, seedTopic, setSetting, talkBody, tomorrow, topicEnv } from './topics-helpers';

let db: DatabaseSync;
let sent: FactoryQueueMessage[];
let sendImpl: (m: FactoryQueueMessage) => Promise<void>;
const { fetchImpl } = fetchStub({});
const far = () => Date.now() + 5 * 60_000;
const runRow = () => db.prepare('SELECT * FROM topic_runs ORDER BY rowid DESC LIMIT 1').get() as Record<string, unknown> | undefined;
const topicLedger = () => ledger(db).filter((r) => r.ref_id.startsWith('tp:'));
const fakeGenCalls = () => {
  const v = (db.prepare("SELECT value FROM settings WHERE key = 'fake_calls_json'").get() as { value: string } | undefined)?.value;
  return v ? (JSON.parse(v) as Array<{ op: string; params?: { kind?: string } }>).filter((c) => c.op === 'messages.create' && c.params?.kind === 'topic_gen').length : 0;
};

function envWith(over: Record<string, string> = {}, queue = true): Env {
  const base = topicEnv(db, over);
  return { ...base, ...(queue ? { IMAGE_GEN: { send: (m: FactoryQueueMessage) => sendImpl(m) } } : {}) } as unknown as Env;
}

/** 受け手に 1 通渡す。ack / retry のどちらが呼ばれたか */
async function deliver(env: Env, body: unknown): Promise<{ acked: number; retried: number }> {
  const r = { acked: 0, retried: 0 };
  const msg = { id: 'm1', timestamp: new Date(), attempts: 1, body, ack: () => void r.acked++, retry: () => void r.retried++ };
  await worker.queue({ queue: 'factory-image-gen', messages: [msg], ackAll: () => undefined, retryAll: () => undefined } as unknown as MessageBatch<FactoryQueueMessage>, env, {} as ExecutionContext);
  return r;
}

beforeEach(() => {
  db = migratedDb();
  enable(db);
  sent = [];
  sendImpl = async (m) => void sent.push(m);
});

describe('(a) 手動の生成は取って queue へ送り、202 を返す', () => {
  it('POST /api/topics/runs → 202 { status: queued, run }・queue に 1 通・run は calling・台帳は取り置き 1 行・モデルは呼ばない', async () => {
    const p = scriptedPort([]);
    const res = await runTopicsRoute(routeCtx(envWith(), 'POST', '/api/topics/runs', { kind: 'philo' }, p.port));
    expect(res.status).toBe(202);
    const body = (await res.json()) as { status: string; run: { id: string; status: string; kind: string; trigger: string } };
    expect(body.status).toBe('queued');
    expect(body.run).toMatchObject({ status: 'calling', kind: 'philo', trigger: 'manual' });
    expect(sent).toHaveLength(1);
    const m = sent[0] as TopicRunQueueMessage;
    expect(m).toMatchObject({ t: 'topic_run', run_id: body.run.id, req: { purpose: 'gen', kind: 'philo', trigger: 'manual', slotDay: tomorrow() } });
    expect(m.token).toBe(runRow()!.token);
    expect(runRow()).toMatchObject({ status: 'calling' });
    expect(topicLedger().map((r) => r.cents)).toEqual([60]);
    expect(p.calls).toHaveLength(0);
  });

  it('手動の派生も同じ（202・message の req に parentId と note）', async () => {
    await seedTopic(db, { id: 'tp_p_1', body: talkBody(), status: 'ready' });
    const res = await deriveTopicRoute(routeCtx(envWith(), 'POST', '/api/topics/tp_p_1/derive', { kind: 'extend', note: '一言' }), 'tp_p_1');
    expect(res.status).toBe(202);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ t: 'topic_run', req: { purpose: 'derive', kind: 'extend', trigger: 'manual', parentId: 'tp_p_1', note: '一言' } });
    expect(runRow()).toMatchObject({ status: 'calling', purpose: 'derive', parent_topic_id: 'tp_p_1' });
  });
});

describe('(b) 受け手がその message で走らせ、done を書く', () => {
  it('fake の port（ANTHROPIC_FAKE=1・fake_enabled=1）: done・台帳は実額・ack', async () => {
    setSetting(db, 'fake_enabled', '1');
    const env = envWith({ ANTHROPIC_FAKE: '1' });
    const res = await runTopicsRoute(routeCtx(env, 'POST', '/api/topics/runs', { kind: 'talk' }));
    expect(res.status).toBe(202);
    const r = await deliver(env, sent[0]);
    expect(r).toEqual({ acked: 1, retried: 0 });
    expect(fakeGenCalls()).toBe(1);
    const row = runRow()!;
    expect(row).toMatchObject({ status: 'done', error: null });
    expect(Number(row.made)).toBeGreaterThan(0);
    expect(count(db, 'SELECT COUNT(*) AS n FROM topics WHERE run_id = ?', String(row.id))).toBe(Number(row.made));
    expect(Number(topicLedger()[0].cents)).toBe(Number(row.cents));
  });
});

describe('(c) 応答の後の例外でも calling を残さない', () => {
  it('保存の batch が投げる → failed: save_failed・台帳は実額（取り置きの 60 を残さない）', async () => {
    const env = envWith();
    expect((await runTopicsRoute(routeCtx(env, 'POST', '/api/topics/runs', { kind: 'talk' }))).status).toBe(202);
    const m = sent[0] as TopicRunQueueMessage;
    const inner = env.DB;
    let n = 0;
    // 1 本目の batch（保存）だけ投げる。2 本目（finishFailed）は通す
    const db2 = { prepare: (s: string) => inner.prepare(s), batch: async (b: D1PreparedStatement[]) => (++n === 1 ? Promise.reject(new Error('D1_ERROR: boom')) : inner.batch(b)) } as unknown as D1Database;
    const msg = genMessage([talkBody()]);
    const p = scriptedPort([msg]);
    const o = await executeTopicRun({ ...env, DB: db2 }, p.port, m.run_id, m.token, m.req, { deadline: far(), fetchImpl });
    expect(o.status).toBe('failed');
    const actual = genActualCents(msg);
    expect(actual).toBeLessThan(60);
    expect(runRow()).toMatchObject({ status: 'failed', error: 'save_failed', cents: actual });
    expect(topicLedger().map((r) => r.cents)).toEqual([actual]);
    expect(count(db, "SELECT COUNT(*) AS n FROM topic_runs WHERE status = 'calling'")).toBe(0);
    expect(count(db, 'SELECT COUNT(*) AS n FROM topics')).toBe(0);
  });
});

describe('(d) queue に送れない時は取り消す', () => {
  it('send が投げる → 503 queue_unavailable・run の行と台帳の行が消える', async () => {
    sendImpl = async () => {
      throw new Error('queue down');
    };
    const res = await runTopicsRoute(routeCtx(envWith(), 'POST', '/api/topics/runs', { kind: 'talk' }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'queue_unavailable' });
    expect([count(db, 'SELECT COUNT(*) AS n FROM topic_runs'), topicLedger().length]).toEqual([0, 0]);
  });
  it('IMAGE_GEN が無い → 503・行が残らない', async () => {
    const res = await runTopicsRoute(routeCtx(envWith({}, false), 'POST', '/api/topics/runs', { kind: 'talk' }));
    expect(res.status).toBe(503);
    expect([count(db, 'SELECT COUNT(*) AS n FROM topic_runs'), topicLedger().length]).toEqual([0, 0]);
  });
});

describe('(e) 行と合わない message は何もせず ack', () => {
  async function queued(): Promise<{ env: Env; m: TopicRunQueueMessage }> {
    setSetting(db, 'fake_enabled', '1');
    const env = envWith({ ANTHROPIC_FAKE: '1' });
    expect((await runTopicsRoute(routeCtx(env, 'POST', '/api/topics/runs', { kind: 'talk' }))).status).toBe(202);
    return { env, m: sent[0] as TopicRunQueueMessage };
  }

  it('token 不一致 → ack・呼び出し 0 回・run は calling のまま（lease 切れの掃除に任せる）', async () => {
    const { env, m } = await queued();
    expect(await deliver(env, { ...m, token: crypto.randomUUID() })).toEqual({ acked: 1, retried: 0 });
    expect(fakeGenCalls()).toBe(0);
    expect(runRow()).toMatchObject({ status: 'calling' });
    expect(topicLedger().map((r) => r.cents)).toEqual([60]);
  });

  it('同じ message の 2 回目（もう done）→ ack・呼び出しは 1 回のまま・行は変わらない', async () => {
    const { env, m } = await queued();
    await deliver(env, m);
    const after = runRow();
    expect(after).toMatchObject({ status: 'done' });
    expect(await deliver(env, m)).toEqual({ acked: 1, retried: 0 });
    expect(fakeGenCalls()).toBe(1);
    expect(runRow()).toEqual(after);
  });

  it('token の回し替え: 同じ message を 2 回 worker.queue に流すとモデルは 1 回だけ・2 回目は stale・行の token は message の token と違う', async () => {
    const { env, m } = await queued();
    expect(await deliver(env, m)).toEqual({ acked: 1, retried: 0 });
    expect(runRow()!.token).not.toBe(m.token);
    expect(await executeTopicRun(env, scriptedPort([]).port, m.run_id, m.token, m.req, { deadline: far(), fetchImpl })).toEqual({ status: 'stale' });
    expect(await deliver(env, m)).toEqual({ acked: 1, retried: 0 });
    expect(fakeGenCalls()).toBe(1);
  });

  it('1 回目が走っている途中（回し替え済み・calling のまま）に再配送が来ても呼ばない', async () => {
    const { env, m } = await queued();
    let mid: { acked: number; retried: number } | null = null;
    let midRow: Record<string, unknown> | undefined;
    let calls = 0;
    const port = {
      ...scriptedPort([]).port,
      async createMessage() {
        calls++;
        // モデルの応答を待っている間に、同じ message が再配送される
        mid = await deliver(env, m);
        midRow = runRow();
        return genMessage([talkBody()]);
      },
    } as unknown as FactoryPort;
    const o = await executeTopicRun(env, port, m.run_id, m.token, m.req, { deadline: far(), fetchImpl });
    expect(mid).toEqual({ acked: 1, retried: 0 });
    expect(midRow).toMatchObject({ status: 'calling' });
    expect(midRow!.token).not.toBe(m.token);
    expect(fakeGenCalls()).toBe(0); // 再配送の受け手はモデルを呼んでいない
    expect(calls).toBe(1);
    expect(o.status).toBe('done');
    expect(runRow()).toMatchObject({ status: 'done' });
  });

  it('要求の中身が行と違う（種類を書き換えた）→ 走らない', async () => {
    const { m } = await queued();
    const p = scriptedPort([genMessage([talkBody()])]);
    const req = { ...m.req, kind: 'philo' } as RunRequest;
    expect(await executeTopicRun(envWith(), p.port, m.run_id, m.token, req, { deadline: far(), fetchImpl })).toEqual({ status: 'stale' });
    expect(p.calls).toHaveLength(0);
  });

  it.each([
    ['run_id の形が違う', (m: TopicRunQueueMessage) => ({ ...m, run_id: "x' OR 1=1" })],
    ['token が無い', (m: TopicRunQueueMessage) => ({ ...m, token: undefined })],
    ['req が壊れている', (m: TopicRunQueueMessage) => ({ ...m, req: { purpose: 'gen', kind: 'evil', trigger: 'manual', slotDay: 'x' } })],
  ])('%s → ack して捨てる・呼び出し 0 回', async (_n, mut) => {
    const { env, m } = await queued();
    expect(await deliver(env, mut(m))).toEqual({ acked: 1, retried: 0 });
    expect(fakeGenCalls()).toBe(0);
    expect(runRow()).toMatchObject({ status: 'calling' });
  });
});

describe('(f) 取れない時の応答は今までどおり（送らない）', () => {
  it('切 → 409 disabled', async () => {
    db.prepare("UPDATE settings SET value = '0' WHERE key = 'topics_enabled'").run();
    const res = await runTopicsRoute(routeCtx(envWith(), 'POST', '/api/topics/runs', { kind: 'talk' }));
    expect([res.status, ((await res.json()) as { error: string }).error]).toEqual([409, 'disabled']);
    expect([sent.length, count(db, 'SELECT COUNT(*) AS n FROM topic_runs'), topicLedger().length]).toEqual([0, 0, 0]);
  });
  it('上限 → 409 cap（手動は skipped の行を書かない）', async () => {
    const res = await runTopicsRoute(routeCtx(envWith({ TOPIC_DAILY_CAP_CENTS: '1' }), 'POST', '/api/topics/runs', { kind: 'talk' }));
    expect([res.status, ((await res.json()) as { error: string }).error]).toEqual([409, 'cap']);
    expect([sent.length, count(db, 'SELECT COUNT(*) AS n FROM topic_runs'), topicLedger().length]).toEqual([0, 0, 0]);
  });
  it('同じ種類が作成中 → 2 回目は 409 run_in_progress（送るのは 1 通だけ）', async () => {
    const env = envWith();
    expect((await runTopicsRoute(routeCtx(env, 'POST', '/api/topics/runs', { kind: 'talk' }))).status).toBe(202);
    const res = await runTopicsRoute(routeCtx(env, 'POST', '/api/topics/runs', { kind: 'talk' }));
    expect([res.status, ((await res.json()) as { error: string }).error]).toEqual([409, 'run_in_progress']);
    expect(sent).toHaveLength(1);
  });
});

describe('(g) 画像の message の扱いは変えない', () => {
  it('形の違う id は ack して捨てる / 無い依頼は ack', async () => {
    const env = envWith();
    expect(await deliver(env, { request_id: 'nope' })).toEqual({ acked: 1, retried: 0 });
    expect(await deliver(env, { request_id: `img_${'0'.repeat(32)}` })).toEqual({ acked: 1, retried: 0 });
  });
  it('D1 の例外は retry（Queue の再試行に任せる）', async () => {
    const base = envWith();
    const inner = base.DB;
    const env = {
      ...base,
      DB: {
        prepare: (s: string) => {
          if (s.includes('image_requests')) throw new Error('D1_ERROR: down');
          return inner.prepare(s);
        },
        batch: (b: D1PreparedStatement[]) => inner.batch(b),
      } as unknown as D1Database,
    };
    expect(await deliver(env, { request_id: `img_${'0'.repeat(32)}` })).toEqual({ acked: 0, retried: 1 });
  });
});
