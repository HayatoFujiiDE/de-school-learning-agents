// 契約 §W: 運用の依頼箱（ops_requests）。cron の opsTick が 1 tick に 1 件だけ拾い、手動と同じ queueTopicRun を通す。
// (a) pending の topic_run → queue に 1 通・run は calling・依頼は done (b) 1 tick に 1 件だけ (c) bad payload → failed
// (d) cap / disabled / run_in_progress → failed・result に not_taken (e) 60 分超えは expired
// (f) send が投げる → run の行と台帳が消え、依頼は failed。route の 202 / 503 は test/topics-queue.test.ts がそのまま見る
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FactoryPort } from '../src/anthropic';
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

describe('§W-2 job_reingest: invalid_outputs で failed の job を running に戻す（session は作らない）', () => {
  const JOB = '0bbb62ca-1128-46c5-8249-f694d2f40975';
  const T0 = '2026-11-07T02:00:00.000Z';
  const addReingest = (id: string, payload: unknown) => {
    const t = new Date().toISOString();
    db.prepare("INSERT INTO ops_requests (id, kind, payload_json, status, result_json, created_at, updated_at) VALUES (?, 'job_reingest', ?, 'pending', NULL, ?, ?)").run(id, JSON.stringify(payload), t, t);
  };
  const seedFailed = (error = 'invalid_outputs') => {
    db.prepare("INSERT INTO materials (id, slug, title, kinds_json, work_status, publish_status, brief_md, created_at, updated_at) VALUES ('m1', 'm-1', 't', '[3]', 'idle', 'none', 'b', ?, ?)").run(T0, T0);
    db.prepare(
      `INSERT INTO factory_jobs (id, material_id, kind, model, phase, status, session_id, brief_md, error, created_at, updated_at) VALUES (?, 'm1', 'rework', 'claude-opus-5-5', 'making', 'failed', 'sesn_1', 'b', ?, ?, ?)`,
    ).run(JOB, error, T0, T0);
  };
  const jobStatus = () => (db.prepare('SELECT status FROM factory_jobs WHERE id = ?').get(JOB) as { status: string }).status;

  it('取り込み直しできる job → running に戻り、依頼は done。お題の queue には何も送らない', async () => {
    seedFailed();
    addReingest('q1', { job_id: JOB });
    const o = await opsTick(envWith());
    expect(jobStatus()).toBe('running');
    expect(req('q1').status).toBe('done');
    expect(result('q1')).toEqual({ job_id: JOB, status: 'running' });
    expect(sent).toHaveLength(0);
    expect(o.request).toEqual({ id: 'q1', kind: 'job_reingest', status: 'done' });
  });

  it('invalid_outputs 以外の failed は断る（route と同じ述語）。job はそのまま', async () => {
    seedFailed('budget_exceeded');
    addReingest('q1', { job_id: JOB });
    await opsTick(envWith());
    expect(jobStatus()).toBe('failed');
    expect(req('q1').status).toBe('failed');
    expect(result('q1')).toEqual({ refused: 'not_reingestable' });
  });

  it('形の違う payload（uuid でない・余計な項目）は bad_payload', async () => {
    seedFailed();
    addReingest('q1', { job_id: "x'; DROP TABLE factory_jobs;--" });
    await opsTick(envWith());
    expect(result('q1')).toEqual({ error: 'bad_payload' });
    addReingest('q2', { job_id: JOB, extra: 1 });
    await opsTick(envWith());
    expect(result('q2')).toEqual({ error: 'bad_payload' });
    expect(jobStatus()).toBe('failed');
  });
});

describe('§W-3 version_reverify: review の版の検証を pending に戻す（route の reverify と同じ claimReverify）', () => {
  const VID = '5f0e8a51-3c7d-4b2a-9e61-0d4c2b7a9f13';
  const T0 = '2026-11-07T02:00:00.000Z';
  const addReverify = (id: string, payload: unknown, createdAt = new Date().toISOString()) => {
    db.prepare("INSERT INTO ops_requests (id, kind, payload_json, status, result_json, created_at, updated_at) VALUES (?, 'version_reverify', ?, 'pending', NULL, ?, ?)").run(
      id,
      JSON.stringify(payload),
      createdAt,
      createdAt,
    );
  };
  const seedVersion = (o: { status?: string; verification?: string } = {}) => {
    db.prepare("INSERT INTO materials (id, slug, title, kinds_json, work_status, publish_status, brief_md, created_at, updated_at) VALUES ('m1', 'm-1', 't', '[3]', 'idle', 'none', 'b', ?, ?)").run(T0, T0);
    db.prepare(
      `INSERT INTO factory_jobs (id, material_id, kind, model, phase, status, session_id, brief_md, created_at, updated_at) VALUES ('j1', 'm1', 'rework', 'claude-opus-5-5', 'making', 'done', 'sesn_1', 'b', ?, ?)`,
    ).run(T0, T0);
    db.prepare(
      `INSERT INTO material_versions (id, material_id, version, job_id, session_id, r2_prefix, content_sha256, material_json, claims_json, adapt_rules_md,
         checks_json, public_paths_json, status, verification_status, verification_attempts, verification_token,
         verify_phase, verify_phase_at, verify_batch_id, verify_turn, verify_pauses, verify_micro, verify_collect_errors, triaged_verification_id, created_at)
       VALUES (?, 'm1', 1, 'j1', 'sesn_1', 'p/', 'x', '{}', '{}', '', '{}', '[]', ?, ?, 3, 'tok', 'collecting', ?, 'batch_1', 2, 1, 500, 1, 'ver_1', ?)`,
    ).run(VID, o.status ?? 'review', o.verification ?? 'failed', T0, T0);
  };
  const version = () => db.prepare('SELECT * FROM material_versions WHERE id = ?').get(VID) as Record<string, unknown>;

  it('(a) review で検証 failed の版 → pending・attempts 0・verify_* と triaged_verification_id を初期化。依頼は done・result に version_id と pending', async () => {
    seedVersion();
    addReverify('w1', { version_id: VID });
    const o = await opsTick(envWith());
    expect(version()).toMatchObject({
      status: 'review',
      verification_status: 'pending',
      verification_attempts: 0,
      verification_token: null,
      verify_phase: null,
      verify_phase_at: null,
      verify_batch_id: null,
      verify_turn: 0,
      verify_pauses: 0,
      verify_micro: 0,
      verify_collect_errors: 0,
      triaged_verification_id: null,
    });
    expect(req('w1').status).toBe('done');
    expect(result('w1')).toEqual({ version_id: VID, verification_status: 'pending' });
    expect(o.request).toEqual({ id: 'w1', kind: 'version_reverify', status: 'done' });
    expect(sent).toHaveLength(0);
  });

  it('(b) status が review でない版 → failed・refused: not_in_review。版はそのまま', async () => {
    seedVersion({ status: 'approved', verification: 'done' });
    addReverify('w1', { version_id: VID });
    await opsTick(envWith());
    expect([req('w1').status, result('w1')]).toEqual(['failed', { refused: 'not_in_review' }]);
    expect(version()).toMatchObject({ verification_status: 'done', verification_attempts: 3, verify_phase: 'collecting' });
  });

  it('(c) 検証が走っている版 → refused: verification_running', async () => {
    seedVersion({ verification: 'running' });
    addReverify('w1', { version_id: VID });
    await opsTick(envWith());
    expect([req('w1').status, result('w1')]).toEqual(['failed', { refused: 'verification_running' }]);
    expect(version()).toMatchObject({ verification_status: 'running', verification_token: 'tok' });
  });

  it('(d) 無い id → refused: not_found', async () => {
    addReverify('w1', { version_id: VID });
    await opsTick(envWith());
    expect([req('w1').status, result('w1')]).toEqual(['failed', { refused: 'not_found' }]);
  });

  it('(e) 形の違う payload（uuid でない・余計な項目・JSON でない）は bad_payload。版はそのまま', async () => {
    seedVersion();
    addReverify('w1', { version_id: "x' OR 1=1" });
    await opsTick(envWith());
    expect(result('w1')).toEqual({ error: 'bad_payload' });
    addReverify('w2', { version_id: VID, extra: 1 });
    await opsTick(envWith());
    expect(result('w2')).toEqual({ error: 'bad_payload' });
    addReverify('w3', 'not json');
    db.prepare("UPDATE ops_requests SET payload_json = 'not json' WHERE id = 'w3'").run();
    await opsTick(envWith());
    expect(result('w3')).toEqual({ error: 'bad_payload' });
    expect(version()).toMatchObject({ verification_status: 'failed', verification_attempts: 3 });
  });

  it('(f) 1 tick に 1 件（kind をまたいでも古い順に 1 件だけ）', async () => {
    seedVersion();
    addReverify('w_old', { version_id: VID }, ago(2_000));
    addReq('r_new', { purpose: 'gen', kind: 'talk' }, ago(1_000));
    await opsTick(envWith());
    expect([req('w_old').status, req('r_new').status]).toEqual(['done', 'pending']);
    expect(sent).toHaveLength(0);
    await opsTick(envWith());
    expect([req('w_old').status, req('r_new').status]).toEqual(['done', 'done']);
    expect(sent).toHaveLength(1);
  });

  it('migration 0012: kind に version_reverify が入り、知らない kind は CHECK で落ちる', () => {
    addReverify('w1', { version_id: VID });
    expect(req('w1').status).toBe('pending');
    const t = new Date().toISOString();
    expect(() =>
      db.prepare("INSERT INTO ops_requests (id, kind, payload_json, status, result_json, created_at, updated_at) VALUES ('w2', 'version_delete', '{}', 'pending', NULL, ?, ?)").run(t, t),
    ).toThrow(/CHECK constraint failed/);
  });
});

describe('§W-4 tip_retire: 自動で入った active の工夫だけをやめる（理由コードだけ）', () => {
  const JOB = '0bbb62ca-1128-46c5-8249-f694d2f40975';
  const TIP = '7d3f1c2a-0b5e-4c8d-9a61-2f4e8b9c0d11';
  const T0 = '2026-11-07T02:00:00.000Z';
  const addRetire = (id: string, payload: unknown) => {
    const t = new Date().toISOString();
    const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
    db.prepare("INSERT INTO ops_requests (id, kind, payload_json, status, result_json, created_at, updated_at) VALUES (?, 'tip_retire', ?, 'pending', NULL, ?, ?)").run(id, raw, t, t);
  };
  const seedTip = (o: { status?: string; decidedBy?: string | null } = {}) => {
    db.prepare("INSERT INTO materials (id, slug, title, kinds_json, work_status, publish_status, brief_md, created_at, updated_at) VALUES ('m1', 'm-1', 't', '[3]', 'idle', 'none', 'b', ?, ?)").run(T0, T0);
    db.prepare(
      `INSERT INTO factory_jobs (id, material_id, kind, model, phase, status, session_id, brief_md, error, created_at, updated_at) VALUES (?, 'm1', 'rework', 'claude-opus-5-5', 'making', 'done', 'sesn_1', 'b', NULL, ?, ?)`,
    ).run(JOB, T0, T0);
    db.prepare(
      `INSERT INTO retro_tips (id, job_id, target, text, reason, expected_saving_cents, quality_risk, status, decided_by, activated_at, created_at, updated_at)
       VALUES (?, ?, 'maker_note', '工夫の本文', '理由', 10, 'none', ?, ?, ?, ?, ?)`,
    ).run(TIP, JOB, o.status ?? 'active', o.decidedBy === undefined ? 'auto' : o.decidedBy, T0, T0, T0);
  };
  const tip = () => db.prepare('SELECT status, retire_reason, retired_at FROM retro_tips WHERE id = ?').get(TIP) as { status: string; retire_reason: string | null; retired_at: string | null };

  it('(a) 自動で入った active → retired・retire_reason は ops:factory_fault。依頼は done。お題の queue には何も送らない', async () => {
    seedTip();
    addRetire('q1', { tip_id: TIP, reason: 'factory_fault' });
    const o = await opsTick(envWith());
    expect(tip().status).toBe('retired');
    expect(tip().retire_reason).toBe('ops:factory_fault');
    expect(tip().retired_at).not.toBeNull();
    expect(req('q1').status).toBe('done');
    expect(result('q1')).toEqual({ tip_id: TIP, status: 'retired' });
    expect(sent).toHaveLength(0);
    expect(o.request).toEqual({ id: 'q1', kind: 'tip_retire', status: 'done' });
  });

  it('(b) 人が入れた工夫は止めない → refused: not_auto。工夫はそのまま', async () => {
    seedTip({ decidedBy: 'human' });
    addRetire('q1', { tip_id: TIP, reason: 'factory_fault' });
    await opsTick(envWith());
    expect(tip().status).toBe('active');
    expect(result('q1')).toEqual({ refused: 'not_auto' });
  });

  it('(c) active でない → refused: not_active・無い id → refused: not_found', async () => {
    seedTip({ status: 'proposed', decidedBy: null });
    addRetire('q1', { tip_id: TIP, reason: 'factory_fault' });
    await opsTick(envWith());
    expect(tip().status).toBe('proposed');
    expect(result('q1')).toEqual({ refused: 'not_active' });
    addRetire('q2', { tip_id: '00000000-0000-4000-8000-000000000000', reason: 'factory_fault' });
    await opsTick(envWith());
    expect(result('q2')).toEqual({ refused: 'not_found' });
  });

  it('(d) 形の違う payload（uuid でない・知らない理由・自由文・余計な項目・JSON でない）は bad_payload。工夫はそのまま', async () => {
    seedTip();
    const bad = [
      { tip_id: "x'; DROP TABLE retro_tips;--", reason: 'factory_fault' },
      { tip_id: TIP, reason: 'なんとなく' },
      { tip_id: TIP },
      { tip_id: TIP, reason: 'factory_fault', note: 'x' },
      'not json',
    ];
    for (let i = 0; i < bad.length; i++) {
      addRetire(`b${i}`, bad[i]);
      await opsTick(envWith());
      expect(result(`b${i}`)).toEqual({ error: 'bad_payload' });
    }
    expect(tip().status).toBe('active');
  });
});

describe('§W-6 job_raise_budget: 予算で止まった job を $5 だけ増やす（管理画面と同じ raiseBudget）', () => {
  const JOB = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
  const T0 = '2026-11-07T02:00:00.000Z';
  const updates: Array<{ id: string; cents: number }> = [];
  const port = {
    async retrieveSession(id: string) {
      return { id, status: 'idle', listCostCents: 1007, metadata: {}, created_at: T0 };
    },
    async updateSessionBudget(id: string, cents: number) {
      updates.push({ id, cents });
    },
  } as unknown as FactoryPort;
  const addRaise = (id: string, payload: unknown) => {
    const t = new Date().toISOString();
    db.prepare("INSERT INTO ops_requests (id, kind, payload_json, status, result_json, created_at, updated_at) VALUES (?, 'job_raise_budget', ?, 'pending', NULL, ?, ?)").run(id, JSON.stringify(payload), t, t);
  };
  const seedJob = (status = 'budget_reached') => {
    db.prepare("INSERT INTO materials (id, slug, title, kinds_json, work_status, publish_status, brief_md, created_at, updated_at) VALUES ('m1', 'm-1', 't', '[3]', 'making', 'none', 'b', ?, ?)").run(T0, T0);
    db.prepare(
      `INSERT INTO factory_jobs (id, material_id, kind, model, phase, status, session_id, brief_md, budget_cents, list_cost_cents, created_at, updated_at) VALUES (?, 'm1', 'rework', 'claude-opus-5-5', 'making', ?, 'sesn_1', 'b', 1000, 1007, ?, ?)`,
    ).run(JOB, status, T0, T0);
  };
  const budget = () => (db.prepare('SELECT budget_cents FROM factory_jobs WHERE id = ?').get(JOB) as { budget_cents: number }).budget_cents;
  beforeEach(() => void (updates.length = 0));

  it('(a) budget_reached → Anthropic 側と D1 の予算を 1508 に。依頼は done', async () => {
    seedJob();
    addRaise('q1', { job_id: JOB, add_cents: 500 });
    const o = await opsTick(envWith(), { port });
    expect(updates).toEqual([{ id: 'sesn_1', cents: 1508 }]);
    expect(budget()).toBe(1508);
    expect(result('q1')).toEqual({ job_id: JOB, budget_cents: 1508 });
    expect(o.request).toEqual({ id: 'q1', kind: 'job_raise_budget', status: 'done' });
  });

  it('(b) 予算で止まっていない job → refused: not_budget_reached（Anthropic は呼ばない）', async () => {
    seedJob('running');
    addRaise('q1', { job_id: JOB, add_cents: 500 });
    await opsTick(envWith(), { port });
    expect(updates).toEqual([]);
    expect(result('q1')).toEqual({ refused: 'not_budget_reached' });
  });

  it('(c) $5 以外・余計な項目・uuid でない → bad_payload。port が無い → no_port', async () => {
    seedJob();
    addRaise('b1', { job_id: JOB, add_cents: 1000 });
    addRaise('b2', { job_id: JOB, add_cents: 500, note: 'x' });
    addRaise('b3', { job_id: 'nope', add_cents: 500 });
    for (const id of ['b1', 'b2', 'b3']) {
      await opsTick(envWith(), { port });
      expect(result(id)).toEqual({ error: 'bad_payload' });
    }
    addRaise('n1', { job_id: JOB, add_cents: 500 });
    await opsTick(envWith());
    expect(result('n1')).toEqual({ error: 'no_port' });
    expect(updates).toEqual([]);
    expect(budget()).toBe(1000);
  });
});
