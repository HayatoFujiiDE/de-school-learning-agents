// 契約 §W: 運用の依頼箱（ops_requests）。cron の opsTick が 1 tick に 1 件だけ拾い、手動と同じ queueTopicRun を通す。
// (a) pending の topic_run → queue に 1 通・run は calling・依頼は done (b) 1 tick に 1 件だけ (c) bad payload → failed
// (d) cap / disabled / run_in_progress → failed・result に not_taken (e) 60 分超えは expired
// (f) send が投げる → run の行と台帳が消え、依頼は failed。route の 202 / 503 は test/topics-queue.test.ts がそのまま見る
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env, FactoryQueueMessage, TopicRunQueueMessage } from '../src/env';
import { opsTick, OPS_REQUEST_TTL_MS } from '../src/ops';
import { runTopicsRoute } from '../src/routes/topics';
import { count, enable, ledger, migratedDb, routeCtx, seedTopic, talkBody, tomorrow, topicEnv } from './topics-helpers';

let db: DatabaseSync;
let sent: FactoryQueueMessage[];
let sendImpl: (m: FactoryQueueMessage) => Promise<void>;

function envWith(over: Record<string, string> = {}, queue = true): Env {
  const base = topicEnv(db, over);
  return { ...base, ...(queue ? { IMAGE_GEN: { send: (m: FactoryQueueMessage) => sendImpl(m) } } : {}) } as unknown as Env;
}

/** 道具（scripts/ops-request.sh）と同じ形で 1 行入れる。createdAt は ISO（nowIso と同じ形） */
function addReq(id: string, payload: unknown, createdAt = new Date().toISOString()): void {
  const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
  db.prepare("INSERT INTO ops_requests (id, kind, payload_json, status, result_json, created_at, updated_at) VALUES (?, 'topic_run', ?, 'pending', NULL, ?, ?)").run(id, raw, createdAt, createdAt);
}
const req = (id: string) => db.prepare('SELECT * FROM ops_requests WHERE id = ?').get(id) as { status: string; result_json: string | null };
const result = (id: string) => JSON.parse(String(req(id).result_json)) as Record<string, unknown>;
const runs = () => db.prepare('SELECT * FROM topic_runs ORDER BY rowid').all() as Array<Record<string, unknown>>;
const topicLedger = () => ledger(db).filter((r) => r.ref_id.startsWith('tp:'));
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

beforeEach(() => {
  db = migratedDb();
  enable(db);
  sent = [];
  sendImpl = async (m) => void sent.push(m);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('(a) pending の topic_run → queue に 1 通・run は calling・依頼は done', () => {
  it('生成: message の req は手動と同じ（trigger manual・slotDay は明日）・台帳は取り置き 1 行・result に run_id', async () => {
    addReq('r1', { purpose: 'gen', kind: 'philo' });
    const o = await opsTick(envWith());
    expect(sent).toHaveLength(1);
    const m = sent[0] as TopicRunQueueMessage;
    expect(m).toMatchObject({ t: 'topic_run', req: { purpose: 'gen', kind: 'philo', trigger: 'manual', slotDay: tomorrow() } });
    expect(runs()).toHaveLength(1);
    expect(runs()[0]).toMatchObject({ id: m.run_id, status: 'calling', trigger: 'manual', kind: 'philo', token: m.token });
    expect(topicLedger().map((r) => r.cents)).toEqual([60]);
    expect(req('r1').status).toBe('done');
    expect(result('r1')).toEqual({ run_id: m.run_id, status: 'queued' });
    expect(o).toEqual({ expired: 0, request: { id: 'r1', kind: 'topic_run', status: 'done', run_id: m.run_id } });
  });

  it('派生: parent_id と note を req に渡す。ログと result に note の中身を出さない', async () => {
    await seedTopic(db, { id: 'tp_p_1', body: talkBody(), status: 'ready' });
    addReq('r1', { purpose: 'derive', kind: 'extend', parent_id: 'tp_p_1', note: 'ひみつのメモ' });
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(' ')));
    await opsTick(envWith());
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ t: 'topic_run', req: { purpose: 'derive', kind: 'extend', trigger: 'manual', parentId: 'tp_p_1', note: 'ひみつのメモ' } });
    expect(req('r1').status).toBe('done');
    expect(logs.some((l) => l.includes('"at":"ops_request"') && l.includes('"id":"r1"'))).toBe(true);
    expect(logs.join('\n')).not.toContain('ひみつ');
    expect(String(req('r1').result_json)).not.toContain('ひみつ');
  });

  it('pending が無ければ何もしない', async () => {
    expect(await opsTick(envWith())).toEqual({ expired: 0, request: 'none' });
    expect(sent).toHaveLength(0);
  });
});

describe('(b) 1 tick に 1 件だけ', () => {
  it('pending 3 件 → 古い順に 1 件ずつ。残りは pending のまま', async () => {
    addReq('r_new', { purpose: 'gen', kind: 'make' }, ago(1_000));
    addReq('r_old', { purpose: 'gen', kind: 'talk' }, ago(3_000));
    addReq('r_mid', { purpose: 'gen', kind: 'news' }, ago(2_000));
    await opsTick(envWith());
    expect(sent).toHaveLength(1);
    expect((sent[0] as TopicRunQueueMessage).req.kind).toBe('talk');
    expect([req('r_old').status, req('r_mid').status, req('r_new').status]).toEqual(['done', 'pending', 'pending']);
    expect(runs()).toHaveLength(1);
    await opsTick(envWith());
    expect(sent).toHaveLength(2);
    expect([req('r_old').status, req('r_mid').status, req('r_new').status]).toEqual(['done', 'done', 'pending']);
  });

  it('done / failed / taken の行は拾わない', async () => {
    addReq('r1', { purpose: 'gen', kind: 'talk' });
    db.prepare("UPDATE ops_requests SET status = 'taken'").run();
    expect(await opsTick(envWith())).toEqual({ expired: 0, request: 'none' });
    expect(sent).toHaveLength(0);
  });
});

describe('(c) payload を信用しない → failed: bad_payload', () => {
  it.each([
    ['JSON でない', 'not json'],
    ['配列', '[]'],
    ['purpose が違う', { purpose: 'publish', kind: 'talk' }],
    ['kind が違う', { purpose: 'gen', kind: 'evil' }],
    ['余計な項目', { purpose: 'gen', kind: 'talk', trigger: 'cron' }],
    ['derive の kind が違う', { purpose: 'derive', kind: 'gen', parent_id: 'tp_p_1' }],
    ['parent が無い', { purpose: 'derive', kind: 'refresh', parent_id: 'tp_missing' }],
    ['parent_id の形が違う', { purpose: 'derive', kind: 'refresh', parent_id: "x' OR 1=1" }],
    ['note が 201 字', { purpose: 'derive', kind: 'refresh', parent_id: 'tp_p_1', note: 'あ'.repeat(201) }],
    ['note が文字列でない', { purpose: 'derive', kind: 'refresh', parent_id: 'tp_p_1', note: 3 }],
  ])('%s', async (_n, payload) => {
    await seedTopic(db, { id: 'tp_p_1', body: talkBody(), status: 'ready' });
    addReq('r1', payload);
    const o = await opsTick(envWith());
    expect(req('r1').status).toBe('failed');
    expect(result('r1')).toEqual({ error: 'bad_payload' });
    expect(o.request).toEqual({ id: 'r1', kind: 'topic_run', status: 'failed' });
    expect([sent.length, runs().length, topicLedger().length]).toEqual([0, 0, 0]);
  });
});

describe('(d) 取れない時は failed・result に not_taken（手動と同じ判定）', () => {
  it('上限 → not_taken: cap（手動なので skipped の行も書かない）', async () => {
    addReq('r1', { purpose: 'gen', kind: 'talk' });
    await opsTick(envWith({ TOPIC_DAILY_CAP_CENTS: '1' }));
    expect(req('r1').status).toBe('failed');
    expect(result('r1')).toEqual({ not_taken: 'cap' });
    expect([sent.length, runs().length, topicLedger().length]).toEqual([0, 0, 0]);
  });
  it('切 → not_taken: disabled', async () => {
    db.prepare("UPDATE settings SET value = '0' WHERE key = 'topics_enabled'").run();
    addReq('r1', { purpose: 'gen', kind: 'talk' });
    await opsTick(envWith());
    expect([req('r1').status, result('r1')]).toEqual(['failed', { not_taken: 'disabled' }]);
    expect([sent.length, runs().length]).toEqual([0, 0]);
  });
  it('同じ種類が管理画面から作成中 → not_taken: run_in_progress（送るのは route の 1 通だけ）', async () => {
    const env = envWith();
    expect((await runTopicsRoute(routeCtx(env, 'POST', '/api/topics/runs', { kind: 'talk' }))).status).toBe(202);
    addReq('r1', { purpose: 'gen', kind: 'talk' });
    await opsTick(env);
    expect([req('r1').status, result('r1')]).toEqual(['failed', { not_taken: 'run_in_progress' }]);
    expect(sent).toHaveLength(1);
    expect(runs()).toHaveLength(1);
  });
});

describe('(e) 作られて 60 分を超えた pending は expired', () => {
  it('61 分前の依頼は expired（送らない）・59 分前の依頼は拾う', async () => {
    addReq('r_old', { purpose: 'gen', kind: 'talk' }, ago(OPS_REQUEST_TTL_MS + 60_000));
    addReq('r_ok', { purpose: 'gen', kind: 'philo' }, ago(OPS_REQUEST_TTL_MS - 60_000));
    const o = await opsTick(envWith());
    expect(o.expired).toBe(1);
    expect(req('r_old')).toMatchObject({ status: 'expired', result_json: null });
    expect(req('r_ok').status).toBe('done');
    expect(sent).toHaveLength(1);
    expect((sent[0] as TopicRunQueueMessage).req.kind).toBe('philo');
  });
  it('taken の行は失効させない', async () => {
    addReq('r1', { purpose: 'gen', kind: 'talk' }, ago(OPS_REQUEST_TTL_MS * 2));
    db.prepare("UPDATE ops_requests SET status = 'taken'").run();
    expect((await opsTick(envWith())).expired).toBe(0);
    expect(req('r1').status).toBe('taken');
  });
});

describe('(f) queue に送れない時は取り消して failed', () => {
  it('send が投げる → run の行と台帳の行が消え、依頼は failed: queue_unavailable', async () => {
    sendImpl = async () => {
      throw new Error('queue down');
    };
    addReq('r1', { purpose: 'gen', kind: 'talk' });
    await opsTick(envWith());
    expect([req('r1').status, result('r1')]).toEqual(['failed', { error: 'queue_unavailable' }]);
    expect([count(db, 'SELECT COUNT(*) AS n FROM topic_runs'), topicLedger().length]).toEqual([0, 0]);
  });
  it('IMAGE_GEN が無い → 同じ', async () => {
    addReq('r1', { purpose: 'gen', kind: 'talk' });
    await opsTick(envWith({}, false));
    expect([req('r1').status, result('r1')]).toEqual(['failed', { error: 'queue_unavailable' }]);
    expect([count(db, 'SELECT COUNT(*) AS n FROM topic_runs'), topicLedger().length]).toEqual([0, 0]);
  });
});
