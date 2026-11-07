// §MC-4（§W-5）運用の依頼箱 material_redo: review の版を却下して（buildReject・system:ops-redo）、新しい注文票で draft を 1 件 queue する。
// payload の検査・review / idle / queued / making の枝・失敗の表（MC-4 3）の各行・migration 0014・ログに brief を出さない。
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/env';
import { opsTick, parseRedoPayload, REDO_BRIEF_MAX_CHARS, REDO_REJECT_NOTE, REDO_REVIEWER_EMAIL } from '../src/ops';
import { d1, migratedDb, rows } from './d1-shim';

const MID = '56c7c85f-51b2-4d91-8797-07073060cae3';
const VID = '94631b96-0000-4000-8000-000000000003';
const VID_OLD = '94631b96-0000-4000-8000-000000000002';
const T0 = '2026-11-07T02:00:00.000Z';
const BRIEF = '# 注文票\nMinecraft Java 版 26.3 を前提に、ひみつの注文の中身';

let db: DatabaseSync;
/** batch の直前に呼ぶ（人の同時の操作・落ちる形を作る）。null なら何もしない */
let beforeBatch: ((sqls: string[]) => void) | null;
/** prepare の SQL を差し替える（queue が断られた形を作る） */
let rewrite: ((sql: string) => string) | null;

function env(): Env {
  const base = d1(db);
  const DB = {
    prepare: (sql: string) => base.prepare(rewrite ? rewrite(sql) : sql),
    async batch(stmts: Array<{ sql: string }>) {
      beforeBatch?.(stmts.map((s) => s.sql));
      return base.batch(stmts as never);
    },
  } as unknown as D1Database;
  return { DB, DAILY_CAP_CENTS: '1500' } as unknown as Env;
}

function addRedo(id: string, payload: unknown, createdAt = new Date().toISOString()) {
  const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
  db.prepare("INSERT INTO ops_requests (id, kind, payload_json, status, result_json, created_at, updated_at) VALUES (?, 'material_redo', ?, 'pending', NULL, ?, ?)").run(id, raw, createdAt, createdAt);
}
const req = (id: string) => db.prepare('SELECT status, result_json FROM ops_requests WHERE id = ?').get(id) as { status: string; result_json: string | null };
const result = (id: string) => JSON.parse(String(req(id).result_json)) as Record<string, unknown>;
const workStatus = () => (db.prepare('SELECT work_status FROM materials WHERE id = ?').get(MID) as { work_status: string }).work_status;
const versionStatus = (id = VID) => (db.prepare('SELECT status FROM material_versions WHERE id = ?').get(id) as { status: string }).status;
const decisions = () => rows(db, 'SELECT material_version_id, decision, reviewer_email, note, checklist_json, content_sha256_at_decision, machine_gate FROM review_decisions ORDER BY rowid');
const newJobs = () => rows(db, "SELECT id, material_id, kind, status, parent_version_id, brief_md FROM factory_jobs WHERE id NOT IN ('j1', 'j0') ORDER BY rowid");

/** 素材と、版（v2 は rejected の古い版・v3 が今の版）。workStatus と今の版の status を選ぶ */
function seed(o: { work?: string; version?: 'review' | 'rejected' | 'approved'; activeJob?: 'queued' | 'running' } = {}) {
  db.prepare("INSERT INTO materials (id, slug, title, kinds_json, work_status, publish_status, brief_md, created_at, updated_at) VALUES (?, 'mc-redstone-basics', 'レッドストーン回路のしくみ', '[3]', ?, 'none', 'b', ?, ?)").run(
    MID,
    o.work ?? 'review',
    T0,
    T0,
  );
  db.prepare("INSERT INTO factory_jobs (id, material_id, kind, model, phase, status, session_id, brief_md, created_at, updated_at) VALUES ('j0', ?, 'draft', 'claude-opus-5-5', 'making', 'done', 'sesn_0', 'b', ?, ?)").run(MID, T0, T0);
  db.prepare(`INSERT INTO factory_jobs (id, material_id, kind, model, phase, status, session_id, brief_md, created_at, updated_at) VALUES ('j1', ?, 'rework', 'claude-opus-5-5', 'making', ?, 'sesn_1', 'b', ?, ?)`).run(
    MID,
    o.activeJob ?? 'done',
    T0,
    T0,
  );
  const ins = (id: string, version: number, job: string, status: string) =>
    db
      .prepare(
        `INSERT INTO material_versions (id, material_id, version, job_id, session_id, r2_prefix, content_sha256, material_json, claims_json, adapt_rules_md, checks_json, public_paths_json, status, created_at)
         VALUES (?, ?, ?, ?, 's', 'p/', ?, '{"catalog_item_id":"mc-redstone","parts":[]}', '{"claims":[]}', 'a', '{}', '[]', ?, ?)`,
      )
      .run(id, MID, version, job, `sha-${version}`, status, T0);
  ins(VID_OLD, 2, 'j0', 'rejected');
  ins(VID, 3, 'j1', o.version ?? 'review');
}

beforeEach(() => {
  db = migratedDb();
  beforeBatch = null;
  rewrite = null;
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('MC-4 1 payload の検査（parseRedoPayload）', () => {
  it('{ material_id, brief_md } だけ。uuid の形・brief は 1〜32768 文字', () => {
    expect(REDO_BRIEF_MAX_CHARS).toBe(32768);
    expect(parseRedoPayload(JSON.stringify({ material_id: MID, brief_md: BRIEF }))).toEqual({ materialId: MID, briefMd: BRIEF });
    expect(parseRedoPayload(JSON.stringify({ material_id: MID, brief_md: 'あ'.repeat(32768) }))?.briefMd).toHaveLength(32768);
    for (const bad of [
      { material_id: MID },
      { brief_md: BRIEF },
      { material_id: MID, brief_md: BRIEF, extra: 1 },
      { material_id: MID.toUpperCase(), brief_md: BRIEF },
      { material_id: "x'; DROP TABLE materials;--", brief_md: BRIEF },
      { material_id: MID, brief_md: '' },
      { material_id: MID, brief_md: 'あ'.repeat(32769) },
      { material_id: MID, brief_md: 12 },
      [MID, BRIEF],
    ])
      expect(parseRedoPayload(JSON.stringify(bad))).toBeNull();
    expect(parseRedoPayload('not json')).toBeNull();
    expect(parseRedoPayload('null')).toBeNull();
  });
  it('形の違う payload → failed bad_payload（素材も版もそのまま）', async () => {
    seed();
    addRedo('q1', { material_id: MID, brief_md: '' });
    await opsTick(env());
    expect([req('q1').status, result('q1')]).toEqual(['failed', { error: 'bad_payload' }]);
    expect([workStatus(), versionStatus(), decisions().length, newJobs().length]).toEqual(['review', 'review', 0, 0]);
  });
});

describe('MC-4 2 処理', () => {
  it('review → 却下（system:ops-redo・note・checklist {}・machine_gate）+ draft を queue（parent null・brief が一致）。結果とログに brief を出さない', async () => {
    seed();
    addRedo('q1', { material_id: MID, brief_md: BRIEF });
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(' ')));
    const o = await opsTick(env());
    expect(REDO_REVIEWER_EMAIL).toBe('system:ops-redo');
    expect(REDO_REJECT_NOTE).toBe('オーナー指示: Java 版の最新を前提に作り直すため、この版を却下');
    expect(decisions()).toEqual([
      { material_version_id: VID, decision: 'reject', reviewer_email: 'system:ops-redo', note: REDO_REJECT_NOTE, checklist_json: '{}', content_sha256_at_decision: 'sha-3', machine_gate: 'pending' },
    ]);
    expect(versionStatus()).toBe('rejected');
    const jobs = newJobs();
    expect(jobs).toEqual([{ id: expect.any(String), material_id: MID, kind: 'draft', status: 'queued', parent_version_id: null, brief_md: BRIEF }]);
    expect(workStatus()).toBe('queued');
    expect([req('q1').status, result('q1')]).toEqual(['done', { material_id: MID, job_id: jobs[0].id, rejected_version_id: VID }]);
    expect(o.request).toEqual({ id: 'q1', kind: 'material_redo', status: 'done' });
    const redoLog = logs.map((l) => (l.startsWith('{') ? (JSON.parse(l) as Record<string, unknown>) : null)).find((l) => l?.at === 'material_redo');
    expect(redoLog).toEqual({ at: 'material_redo', material_id: MID, job_id: jobs[0].id, rejected_version_id: VID });
    expect(logs.join('\n')).not.toContain('ひみつ');
    expect(String(req('q1').result_json)).not.toContain('ひみつ');
  });

  it('idle → queue だけ（却下しない・rejected_version_id null）', async () => {
    seed({ work: 'idle', version: 'approved' });
    addRedo('q1', { material_id: MID, brief_md: BRIEF });
    await opsTick(env());
    expect(decisions()).toEqual([]);
    expect(versionStatus()).toBe('approved');
    const jobs = newJobs();
    expect(jobs).toHaveLength(1);
    expect(result('q1')).toEqual({ material_id: MID, job_id: jobs[0].id, rejected_version_id: null });
    expect(workStatus()).toBe('queued');
  });

  it.each(['making', 'queued'])('%s → refused material_busy で done（却下しない・queue しない）', async (work) => {
    seed({ work, activeJob: work === 'making' ? 'running' : 'queued' });
    addRedo('q1', { material_id: MID, brief_md: BRIEF });
    await opsTick(env());
    expect([req('q1').status, result('q1')]).toEqual(['done', { refused: 'material_busy' }]);
    expect([versionStatus(), decisions().length, newJobs().length, workStatus()]).toEqual(['review', 0, 0, work]);
  });

  it('素材が無い → failed not_found', async () => {
    addRedo('q1', { material_id: MID, brief_md: BRIEF });
    await opsTick(env());
    expect([req('q1').status, result('q1')]).toEqual(['failed', { refused: 'not_found' }]);
  });
});

describe('MC-4 3 失敗の表', () => {
  it('却下の batch が通る前に落ちた → 版は review のまま（却下なし）。出し直すと 2 からやり直し、却下は 1 回', async () => {
    seed();
    beforeBatch = (sqls) => {
      if (sqls[0].includes('INSERT INTO review_decisions')) throw new Error('d1_down');
    };
    addRedo('q1', { material_id: MID, brief_md: BRIEF });
    await opsTick(env());
    expect(req('q1').status).toBe('failed');
    expect([versionStatus(), workStatus(), decisions().length, newJobs().length]).toEqual(['review', 'review', 0, 0]);
    beforeBatch = null;
    addRedo('q2', { material_id: MID, brief_md: BRIEF });
    await opsTick(env());
    expect(decisions()).toHaveLength(1);
    expect([versionStatus(), workStatus(), newJobs().length]).toEqual(['rejected', 'queued', 1]);
    expect(result('q2')).toMatchObject({ rejected_version_id: VID });
  });

  it('却下が通り queue が断られた → refused で done・素材は idle。出し直すと queue だけ走る（却下は 1 回）', async () => {
    seed();
    // queue の 2 文の述語（素材が idle）を成り立たなくして 0 行にする（queueJobForMaterial の material_busy の形）
    rewrite = (sql) =>
      sql.includes('INSERT INTO factory_jobs') || sql.startsWith("UPDATE materials SET work_status = 'queued'") ? sql.replace("pm.work_status = 'idle'", "pm.work_status = 'gone'") : sql;
    addRedo('q1', { material_id: MID, brief_md: BRIEF });
    await opsTick(env());
    expect([req('q1').status, result('q1')]).toEqual(['done', { refused: 'material_busy' }]);
    expect([versionStatus(), workStatus(), decisions().length, newJobs().length]).toEqual(['rejected', 'idle', 1, 0]);
    rewrite = null;
    addRedo('q2', { material_id: MID, brief_md: BRIEF });
    await opsTick(env());
    expect(decisions()).toHaveLength(1);
    const jobs = newJobs();
    expect(jobs).toHaveLength(1);
    expect(result('q2')).toEqual({ material_id: MID, job_id: jobs[0].id, rejected_version_id: null });
    expect(workStatus()).toBe('queued');
  });

  it('queue が通り結果の記録の前に落ちた形（素材 queued・job 1 つ）→ 出し直すと material_busy で refused（二重 queue なし）', async () => {
    seed();
    addRedo('q1', { material_id: MID, brief_md: BRIEF });
    await opsTick(env());
    expect(newJobs()).toHaveLength(1);
    // 結果の記録が落ちた: 依頼は taken のまま残る（失効は pending だけ。§W のまま）
    db.prepare("UPDATE ops_requests SET status = 'taken', result_json = NULL WHERE id = 'q1'").run();
    addRedo('q2', { material_id: MID, brief_md: BRIEF });
    await opsTick(env());
    expect([req('q2').status, result('q2')]).toEqual(['done', { refused: 'material_busy' }]);
    expect([newJobs().length, decisions().length]).toEqual([1, 1]);
  });

  it('同じ素材に人が同時に差し戻した → 却下の CAS が通らず failed conflict（job は人の 1 つだけ）', async () => {
    seed();
    beforeBatch = (sqls) => {
      if (!sqls[0].includes('INSERT INTO review_decisions')) return;
      // 人の差し戻し（版は review のまま・作り直しの job が active）が先にコミットした
      db.prepare("INSERT INTO factory_jobs (id, material_id, kind, model, phase, status, brief_md, parent_version_id, created_at, updated_at) VALUES ('j_human', ?, 'rework', 'claude-opus-5-5', 'questions', 'queued', 'b', ?, ?, ?)").run(MID, VID, T0, T0);
      db.prepare("UPDATE materials SET work_status = 'queued' WHERE id = ?").run(MID);
      beforeBatch = null;
    };
    addRedo('q1', { material_id: MID, brief_md: BRIEF });
    await opsTick(env());
    expect([req('q1').status, result('q1')]).toEqual(['failed', { refused: 'conflict' }]);
    expect(decisions()).toEqual([]);
    expect(newJobs().map((j) => j.id)).toEqual(['j_human']);
    expect(versionStatus()).toBe('review');
  });
});

describe('MC-4 5 migration 0014', () => {
  it('kind の CHECK に既存の 4 つ + material_redo。知らない kind は落ちる。既存の行は写される', () => {
    const t = new Date().toISOString();
    for (const k of ['topic_run', 'job_reingest', 'version_reverify', 'tip_retire', 'material_redo'])
      db.prepare('INSERT INTO ops_requests (id, kind, payload_json, status, result_json, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?)').run(`k-${k}`, k, '{}', 'done', t, t);
    expect(() =>
      db.prepare("INSERT INTO ops_requests (id, kind, payload_json, status, result_json, created_at, updated_at) VALUES ('x', 'material_delete', '{}', 'pending', NULL, ?, ?)").run(t, t),
    ).toThrow(/CHECK constraint failed/);
    const sql = String((db.prepare("SELECT sql FROM sqlite_master WHERE name = 'ops_requests'").get() as { sql: string }).sql);
    // 0015（§W-6）が後ろに job_raise_budget を足す。0014 の 5 つは並びもそのまま残る
    expect(sql).toContain("kind IN ('topic_run','job_reingest','version_reverify','tip_retire','material_redo','job_raise_budget')");
    expect(rows(db, "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_ops_requests_status'")).toHaveLength(1);
  });
});
