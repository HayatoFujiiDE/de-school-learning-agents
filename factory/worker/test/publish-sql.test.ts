// publishSwitch と確認の決定（return / reject）の batch を node:sqlite（Node 24 同梱）の実 DB で順に実行し、
// 述語成立時は全文が行を変え、非成立時は全文 0 行（片方だけ commit されない）ことを確かめる（契約 §B-2, §H (j)）。
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildPublishSwitch, buildReject, buildReturn } from '../src/publish';
import type { Stmt } from '../src/db';
import { migratedDb } from './d1-shim';

const T = '2026-11-04T00:00:00.000Z';
let db: DatabaseSync;
let seq = 0;
const id = (p: string) => `${p}-${++seq}`;

/** D1 の batch と同じく 1 トランザクションで逐次実行する。例外なら ROLLBACK して投げ直す */
function runBatch(stmts: Stmt[]): number[] {
  db.exec('BEGIN');
  try {
    const out = stmts.map((s) => Number(db.prepare(s.sql).run(...s.params).changes));
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
const one = (sql: string, ...p: Array<string | number | null>) => db.prepare(sql).get(...p) as Record<string, unknown>;
const count = (table: string) => Number(one(`SELECT COUNT(*) AS c FROM ${table}`).c);

function material(mid: string, work = 'review', publish = 'none', current: string | null = null) {
  db.prepare(
    `INSERT INTO materials (id, slug, title, kinds_json, work_status, publish_status, current_version_id, brief_md, created_at, updated_at)
     VALUES (?, ?, 't', '[3]', ?, ?, ?, 'brief', ?, ?)`,
  ).run(mid, `slug-${mid}`, work, publish, current, T, T);
}
function job(jid: string, mid: string, status = 'done') {
  db.prepare(
    `INSERT INTO factory_jobs (id, material_id, kind, model, phase, status, brief_md, created_at, updated_at)
     VALUES (?, ?, 'draft', 'claude-sonnet-5-5', 'making', ?, 'brief', ?, ?)`,
  ).run(jid, mid, status, T, T);
}
function version(vid: string, mid: string, n: number, status = 'review', vstatus = 'done') {
  const jid = id('job');
  job(jid, mid, 'done');
  db.prepare(
    `INSERT INTO material_versions (id, material_id, version, job_id, session_id, r2_prefix, content_sha256, material_json, claims_json, adapt_rules_md,
       checks_json, public_paths_json, status, verification_status, created_at)
     VALUES (?, ?, ?, ?, 'sesn_x', 'p/', ?, '{}', '{}', 'a', '{}', '[]', ?, ?, ?)`,
  ).run(vid, mid, n, jid, `sha-${vid}`, status, vstatus, T);
}
function verification(wid: string, vid: string, attempt: number, contradicted = 0) {
  db.prepare(
    `INSERT INTO verifications (id, material_version_id, attempt, model, claims_total, confirmed, hypothesis, unverified, contradicted, result_json, created_at)
     VALUES (?, ?, ?, 'claude-opus-5-5', 1, 1, 0, 0, ?, '{}', ?)`,
  ).run(wid, vid, attempt, contradicted, T);
}
const ctx = () => ({ decision_id: id('dec'), now: T, log_id: id('log') });
const approve = (mid: string, vid: string, wid: string) =>
  buildPublishSwitch(
    { kind: 'approve', material_id: mid, version_id: vid, verification_id: wid, reviewer_email: 'r@example.invalid', checklist_json: '{}', note: null },
    ctx(),
  );

beforeEach(() => {
  // 契約 V-1: review_decisions.machine_gate など 0009 までの列を使うので、全部の migration を当てた DB で確かめる
  db = migratedDb();
});

describe('approve', () => {
  it('述語成立: review_decisions 1 行 + material available/idle/current + version approved', () => {
    material('m1');
    version('v1', 'm1', 1);
    verification('w1', 'v1', 1);
    expect(runBatch(approve('m1', 'v1', 'w1'))).toEqual([1, 1, 1]);
    expect(one('SELECT publish_status, work_status, current_version_id FROM materials WHERE id=?', 'm1')).toEqual({
      publish_status: 'available',
      work_status: 'idle',
      current_version_id: 'v1',
    });
    expect(one('SELECT status FROM material_versions WHERE id=?', 'v1').status).toBe('approved');
    expect(one("SELECT decision, content_sha256_at_decision FROM review_decisions").content_sha256_at_decision).toBe('sha-v1');
  });

  const cases: Array<[string, () => [string, string, string]]> = [
    ['検証が done でない', () => (material('m1'), version('v1', 'm1', 1, 'review', 'pending'), verification('w1', 'v1', 1), ['m1', 'v1', 'w1'])],
    ['contradicted がある', () => (material('m1'), version('v1', 'm1', 1), verification('w1', 'v1', 1, 2), ['m1', 'v1', 'w1'])],
    [
      '古い verification_id（attempt 2 がある）',
      () => (material('m1'), version('v1', 'm1', 1), verification('w1', 'v1', 1), verification('w2', 'v1', 2), ['m1', 'v1', 'w1']),
    ],
    ['別の版の verification_id', () => (material('m1'), version('v1', 'm1', 1), version('v2', 'm1', 2), verification('w2', 'v2', 1), ['m1', 'v1', 'w2'])],
    ['active job がある', () => (material('m1'), version('v1', 'm1', 1), verification('w1', 'v1', 1), job('jA', 'm1', 'running'), ['m1', 'v1', 'w1'])],
    ['素材が一致しない', () => (material('m1'), material('m2'), version('v1', 'm1', 1), verification('w1', 'v1', 1), ['m2', 'v1', 'w1'])],
    ['版が review でない（承認済み）', () => (material('m1'), version('v1', 'm1', 1, 'approved'), verification('w1', 'v1', 1), ['m1', 'v1', 'w1'])],
  ];
  it.each(cases)('述語不成立（%s）: 全文 0 行で何も変わらない', (_n, setup) => {
    const [mid, vid, wid] = setup();
    const before = JSON.stringify(db.prepare('SELECT * FROM materials ORDER BY id').all()) + JSON.stringify(db.prepare('SELECT id, status FROM material_versions ORDER BY id').all());
    expect(runBatch(approve(mid, vid, wid))).toEqual([0, 0, 0]);
    expect(count('review_decisions')).toBe(0);
    const after = JSON.stringify(db.prepare('SELECT * FROM materials ORDER BY id').all()) + JSON.stringify(db.prepare('SELECT id, status FROM material_versions ORDER BY id').all());
    expect(after).toBe(before);
  });

  it('同じ approve を 2 回流すと 2 回目は 0 行（競合）', () => {
    material('m1');
    version('v1', 'm1', 1);
    verification('w1', 'v1', 1);
    expect(runBatch(approve('m1', 'v1', 'w1'))).toEqual([1, 1, 1]);
    expect(runBatch(approve('m1', 'v1', 'w1'))).toEqual([0, 0, 0]);
    expect(count('review_decisions')).toBe(1);
  });
});

describe('rollback', () => {
  const rb = (mid: string, vid: string) =>
    buildPublishSwitch({ kind: 'rollback', material_id: mid, version_id: vid, reviewer_email: 'r@example.invalid', note: 'n' }, ctx());
  it('述語成立: 別の approved 版へ付け替えて available', () => {
    material('m1', 'idle', 'stopped', 'v2');
    version('v1', 'm1', 1, 'approved');
    version('v2', 'm1', 2, 'approved');
    expect(runBatch(rb('m1', 'v1'))).toEqual([1, 1]);
    expect(one('SELECT publish_status, current_version_id FROM materials WHERE id=?', 'm1')).toEqual({ publish_status: 'available', current_version_id: 'v1' });
    expect(one("SELECT decision FROM review_decisions").decision).toBe('rollback');
  });
  it('stopped なら現在と同じ版へ rollback できる（1 行ずつ）', () => {
    material('m1', 'idle', 'stopped', 'v1');
    version('v1', 'm1', 1, 'approved');
    expect(runBatch(rb('m1', 'v1'))).toEqual([1, 1]);
    expect(one('SELECT publish_status, current_version_id FROM materials WHERE id=?', 'm1')).toEqual({ publish_status: 'available', current_version_id: 'v1' });
    // 戻った後（available・同じ版）にもう一度流すと 0 行
    expect(runBatch(rb('m1', 'v1'))).toEqual([0, 0]);
    expect(count('review_decisions')).toBe(1);
  });
  it.each([
    ['available で現在の版を指定', () => (material('m1', 'idle', 'available', 'v1'), version('v1', 'm1', 1, 'approved'), ['m1', 'v1'])],
    ['stopped でも rejected 版は不可', () => (material('m1', 'idle', 'stopped', 'v1'), version('v1', 'm1', 1, 'rejected'), ['m1', 'v1'])],
    ['rejected 版', () => (material('m1', 'idle', 'available', 'v2'), version('v1', 'm1', 1, 'rejected'), version('v2', 'm1', 2, 'approved'), ['m1', 'v1'])],
    ['review 版', () => (material('m1', 'review', 'available', 'v2'), version('v1', 'm1', 1, 'review'), version('v2', 'm1', 2, 'approved'), ['m1', 'v1'])],
    ['他素材の版', () => (material('m1', 'idle', 'stopped', null), material('m2', 'idle', 'none'), version('v9', 'm2', 1, 'approved'), ['m1', 'v9'])],
  ] as Array<[string, () => [string, string]]>)('述語不成立（%s）: 0 行', (_n, setup) => {
    const [mid, vid] = setup();
    expect(runBatch(rb(mid, vid))).toEqual([0, 0]);
    expect(count('review_decisions')).toBe(0);
  });
});

describe('stop', () => {
  const st = (mid: string) => buildPublishSwitch({ kind: 'stop', material_id: mid, reviewer_email: 'r@example.invalid', note: 'n' }, ctx());
  it('述語成立: review_decisions(stop, 現在の版) + stopped', () => {
    material('m1', 'idle', 'available', 'v1');
    version('v1', 'm1', 1, 'approved');
    expect(runBatch(st('m1'))).toEqual([1, 1]);
    expect(one('SELECT publish_status FROM materials WHERE id=?', 'm1').publish_status).toBe('stopped');
    expect(one('SELECT decision, material_version_id FROM review_decisions')).toEqual({ decision: 'stop', material_version_id: 'v1' });
  });
  it('配信中でなければ 0 行（2 回目の stop を含む）', () => {
    material('m1', 'idle', 'available', 'v1');
    version('v1', 'm1', 1, 'approved');
    runBatch(st('m1'));
    expect(runBatch(st('m1'))).toEqual([0, 0]);
    material('m2', 'idle', 'none');
    expect(runBatch(st('m2'))).toEqual([0, 0]);
    expect(count('review_decisions')).toBe(1);
  });
});

describe('return', () => {
  const ret = (mid: string, vid: string, jid: string) =>
    buildReturn(
      {
        material_id: mid,
        version_id: vid,
        reviewer_email: 'r@example.invalid',
        checklist_json: '{}',
        note: '理由',
        new_job_id: jid,
        rework_brief_md: 'brief + 理由',
        rework_model: 'claude-opus-5-5',
        rework_budget_cents: 500,
      },
      ctx(),
    );
  it('述語成立: decision + standards_log + rework job queued + material queued + version rejected', () => {
    material('m1');
    version('v1', 'm1', 1);
    expect(runBatch(ret('m1', 'v1', 'jR'))).toEqual([1, 1, 1, 1, 1]);
    expect(one('SELECT kind, status, parent_version_id, budget_cents FROM factory_jobs WHERE id=?', 'jR')).toEqual({
      kind: 'rework',
      status: 'queued',
      parent_version_id: 'v1',
      budget_cents: 500,
    });
    expect(one('SELECT work_status FROM materials WHERE id=?', 'm1').work_status).toBe('queued');
    expect(one('SELECT status FROM material_versions WHERE id=?', 'v1').status).toBe('rejected');
    expect(one("SELECT kind FROM standards_log").kind).toBe('return_reason');
    expect(one("SELECT decision FROM review_decisions").decision).toBe('return');
  });
  it('版が review でなければ全文 0 行', () => {
    material('m1', 'idle');
    version('v1', 'm1', 1, 'approved');
    expect(runBatch(ret('m1', 'v1', 'jR'))).toEqual([0, 0, 0, 0, 0]);
    expect(count('standards_log') + count('review_decisions')).toBe(0);
    expect(one('SELECT COUNT(*) c FROM factory_jobs WHERE id=?', 'jR').c).toBe(0);
  });
  it('active job があれば部分 UNIQUE index で失敗し、batch 全体が戻る', () => {
    material('m1');
    version('v1', 'm1', 1);
    job('jA', 'm1', 'running');
    expect(() => runBatch(ret('m1', 'v1', 'jR'))).toThrow(/UNIQUE/);
    expect(count('standards_log') + count('review_decisions')).toBe(0);
    expect(one('SELECT status FROM material_versions WHERE id=?', 'v1').status).toBe('review');
  });
});

describe('reject', () => {
  const rej = (mid: string, vid: string) =>
    buildReject({ material_id: mid, version_id: vid, reviewer_email: 'r@example.invalid', checklist_json: null, note: '理由' }, ctx());
  it('述語成立: decision + standards_log + material idle + version rejected。publish_status は変えない', () => {
    material('m1', 'review', 'available', 'v0');
    version('v0', 'm1', 1, 'approved');
    version('v1', 'm1', 2);
    expect(runBatch(rej('m1', 'v1'))).toEqual([1, 1, 1, 1]);
    expect(one('SELECT work_status, publish_status, current_version_id FROM materials WHERE id=?', 'm1')).toEqual({
      work_status: 'idle',
      publish_status: 'available',
      current_version_id: 'v0',
    });
  });
  it('active job があれば全文 0 行', () => {
    material('m1');
    version('v1', 'm1', 1);
    job('jA', 'm1', 'running');
    expect(runBatch(rej('m1', 'v1'))).toEqual([0, 0, 0, 0]);
  });
});
