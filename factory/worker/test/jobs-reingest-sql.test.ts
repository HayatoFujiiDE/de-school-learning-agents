// reingest（契約 §B-4-e 1〜2）の CAS を node:sqlite（Node 24 同梱）の実 DB で確かめる:
// 述語成立で job running + 段階リセット + material making、非成立は 409 not_reingestable で 0 行、
// 同じ素材に active な job があれば idx_jobs_one_active_per_material で batch 全体が巻き戻って 409 material_busy。
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import { conditionalBatch } from '../src/db';
import { claimReingest, reingestClaimStmts } from '../src/jobs';
import { d1, migratedDb, one } from './d1-shim';

const T = '2026-11-04T00:00:00.000Z';
let db: DatabaseSync;
let env: Env;

function material(id: string, work = 'idle', publish = 'none') {
  db.prepare(
    `INSERT INTO materials (id, slug, title, kinds_json, work_status, publish_status, brief_md, created_at, updated_at)
     VALUES (?, ?, 't', '[3]', ?, ?, 'brief', ?, ?)`,
  ).run(id, `slug-${id}`, work, publish, T, T);
}
function job(id: string, mid: string, o: { status: string; error?: string | null; session_id?: string | null; created_at?: string }) {
  db.prepare(
    `INSERT INTO factory_jobs (id, material_id, kind, model, phase, status, session_id, brief_md, error, last_error,
       reconcile_stage, reconcile_state_json, reconcile_token, reconcile_until, last_checked_at, created_at, updated_at)
     VALUES (?, ?, 'draft', 'claude-sonnet-5-5', 'making', ?, ?, 'brief', ?, 'missing_ref:parts/p1/x.md',
       'ingested', '{"files":[],"done":[]}', 'tok', ?, ?, ?, ?)`,
  ).run(id, mid, o.status, o.session_id === undefined ? `sesn_${id}` : o.session_id, o.error === undefined ? 'invalid_outputs' : o.error, T, T, o.created_at ?? T, T);
}
const jobRow = (id: string) =>
  one(db, 'SELECT status, error, last_error, reconcile_stage, reconcile_state_json, reconcile_token, reconcile_until, last_checked_at FROM factory_jobs WHERE id = ?', id);
const matRow = (id: string) => one(db, 'SELECT work_status, publish_status FROM materials WHERE id = ?', id);

beforeEach(() => {
  db = migratedDb();
  env = { DB: d1(db) } as unknown as Env;
});

describe('claimReingest', () => {
  it('述語成立: job running・段階と lease をリセット・error を消す。material は making（publish_status は触らない）', async () => {
    material('m1', 'idle', 'available');
    job('j1', 'm1', { status: 'failed' });
    expect(await claimReingest(env, 'j1')).toBeNull();
    expect(jobRow('j1')).toEqual({
      status: 'running',
      error: null,
      last_error: null,
      reconcile_stage: 'none',
      reconcile_state_json: '{}',
      reconcile_token: null,
      reconcile_until: null,
      last_checked_at: null,
    });
    expect(matRow('m1')).toEqual({ work_status: 'making', publish_status: 'available' });
    // 2 回目は failed でないので 409
    expect(await claimReingest(env, 'j1')).toMatchObject({ status: 409, body: { error: 'not_reingestable' } });
  });

  it.each([
    ['terminated_without_outputs', 'failed', 'sesn_x'],
    ['too_many_denies', 'failed', 'sesn_x'],
    ['create_unconfirmed', 'failed', null],
    ['invalid_outputs', 'failed', null],
    ['invalid_outputs', 'done', 'sesn_x'],
    ['invalid_outputs', 'cancelled', 'sesn_x'],
  ])('error=%s status=%s session=%s は 409 not_reingestable で何も変えない', async (error, status, sid) => {
    material('m2');
    job('j2', 'm2', { status, error, session_id: sid });
    const before = jobRow('j2');
    expect(await claimReingest(env, 'j2')).toMatchObject({ status: 409, body: { error: 'not_reingestable' } });
    expect(jobRow('j2')).toEqual(before);
    expect(matRow('m2')).toEqual({ work_status: 'idle', publish_status: 'none' });
  });

  it('同じ素材に active な job があれば UNIQUE で batch 全体が巻き戻り 409 material_busy（material は idle のまま）', async () => {
    material('m3', 'idle'); // 不整合な状態でも UNIQUE が最後の砦になることを確かめる
    job('j3', 'm3', { status: 'failed' });
    job('j3b', 'm3', { status: 'queued', error: null, session_id: null });
    expect(await claimReingest(env, 'j3')).toMatchObject({ status: 409, body: { error: 'material_busy' } });
    expect(jobRow('j3').status).toBe('failed');
    expect(matRow('m3').work_status).toBe('idle');
  });

  it('素材が待機（idle）でなければ 409 material_busy（確認待ちの版を上書きしない）', async () => {
    material('m4', 'review');
    job('j4', 'm4', { status: 'failed' });
    expect(await claimReingest(env, 'j4')).toMatchObject({ status: 409, body: { error: 'material_busy' } });
    expect(jobRow('j4').status).toBe('failed');
    expect(matRow('m4').work_status).toBe('review');
  });

  it('同じ素材にこの job より新しい job があれば 409 material_busy（終端の job でも。後の注文を古い成果物で上書きしない）', async () => {
    material('m5', 'idle');
    job('j5', 'm5', { status: 'failed', created_at: '2026-11-04T00:00:00.000Z' });
    job('j5b', 'm5', { status: 'cancelled', error: null, created_at: '2026-11-04T01:00:00.000Z' });
    expect(await claimReingest(env, 'j5')).toMatchObject({ status: 409, body: { error: 'material_busy' } });
    expect(jobRow('j5').status).toBe('failed');
    expect(matRow('m5').work_status).toBe('idle');
    // 新しい方の failed(invalid_outputs) は取り込み直せる（古い方が残っていても）
    job('j5c', 'm5', { status: 'failed', created_at: '2026-11-04T02:00:00.000Z' });
    expect(await claimReingest(env, 'j5c')).toBeNull();
    expect(jobRow('j5c').status).toBe('running');
    expect(matRow('m5').work_status).toBe('making');
  });

  it('batch の述語にも「新しい job が無い」「material idle」が入っている（読みと batch の間に変わっても 0 行）', async () => {
    material('m6', 'idle');
    job('j6', 'm6', { status: 'failed', created_at: '2026-11-04T00:00:00.000Z' });
    job('j6b', 'm6', { status: 'done', error: null, created_at: '2026-11-04T01:00:00.000Z' });
    const r = await conditionalBatch(env.DB, reingestClaimStmts({ jobId: 'j6', materialId: 'm6', now: T }));
    expect(r).toEqual({ ok: false, changes: [0, 0] });
    material('m7', 'review');
    job('j7', 'm7', { status: 'failed' });
    const r7 = await conditionalBatch(env.DB, reingestClaimStmts({ jobId: 'j7', materialId: 'm7', now: T }));
    expect(r7.changes[0]).toBe(0);
    expect(matRow('m7').work_status).toBe('review');
  });

  it('読みの後に job が変わり batch の job UPDATE が 0 行なら 409 not_reingestable（material も変えない）', async () => {
    material('m8', 'idle');
    job('j8', 'm8', { status: 'failed' });
    const inner = env.DB;
    // 事前チェックの後・batch の直前に、同時に押された 1 回目が取り込みを終えた状態を作る
    env = {
      DB: {
        prepare: (sql: string) => inner.prepare(sql),
        async batch(stmts: D1PreparedStatement[]) {
          db.prepare("UPDATE factory_jobs SET status = 'done', error = NULL WHERE id = 'j8'").run();
          return inner.batch(stmts);
        },
      },
    } as unknown as Env;
    expect(await claimReingest(env, 'j8')).toMatchObject({ status: 409, body: { error: 'not_reingestable' } });
    expect(jobRow('j8').status).toBe('done');
    expect(matRow('m8').work_status).toBe('idle');
  });

  it('job が無ければ 404', async () => {
    expect(await claimReingest(env, 'nope')).toMatchObject({ status: 404, body: { error: 'not_found' } });
  });
});
