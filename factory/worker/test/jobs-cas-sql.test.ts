// reconcile_state_json を書く 2 つの CAS（answer 側の scan.answer 保存 / reconcile 側の writeState）の述語を
// node:sqlite（Node 24 同梱）の実 DB で確かめる（契約 §B-2: 所有権の token と status を述語に含める）。
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Stmt } from '../src/db';
import { answerScanSaveStmt, reconcileStateWriteStmt } from '../src/jobs';

const SCHEMA = readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8');
const T = '2026-11-04T00:00:00.000Z';
const T2 = '2026-11-04T00:01:00.000Z';
let db: DatabaseSync;

const run = (s: Stmt): number => Number(db.prepare(s.sql).run(...s.params).changes);
const row = (jid: string) =>
  db.prepare('SELECT status, reconcile_stage, reconcile_state_json, last_error, updated_at FROM factory_jobs WHERE id = ?').get(jid) as Record<
    string,
    unknown
  >;

function job(
  jid: string,
  o: { status: string; answer_state?: string; answer_token?: string | null; reconcile_token?: string | null; state?: string },
) {
  db.prepare(
    `INSERT INTO materials (id, slug, title, kinds_json, work_status, publish_status, brief_md, created_at, updated_at)
     VALUES (?, ?, 't', '[3]', 'making', 'none', 'brief', ?, ?)`,
  ).run(`m-${jid}`, `slug-${jid}`, T, T);
  db.prepare(
    `INSERT INTO factory_jobs (id, material_id, kind, model, phase, status, brief_md, answer_state, answer_token, reconcile_token, reconcile_state_json, created_at, updated_at)
     VALUES (?, ?, 'draft', 'claude-sonnet-5-5', 'questions', ?, 'brief', ?, ?, ?, ?, ?, ?)`,
  ).run(jid, `m-${jid}`, o.status, o.answer_state ?? 'none', o.answer_token ?? null, o.reconcile_token ?? null, o.state ?? '{}', T, T);
}

const ANSWER_STATE = JSON.stringify({ scan: { answer: { cursor: 'c3', pages: 1, stalls: 1 } } });

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
});

describe('needs_answer 中の reconcile 側 write は scan.answer を上書きしない', () => {
  it('lease（reconcile_token）を持っていても status が needs_answer なら writeState の文は 0 行（stage あり / なし とも）', () => {
    job('j1', { status: 'needs_answer', answer_state: 'sending', answer_token: 'tA', reconcile_token: 'tR', state: ANSWER_STATE });
    const json = JSON.stringify({ scan: { idle: { cursor: null } } });
    expect(run(reconcileStateWriteStmt({ stage: null, json, lastError: 'x', now: T2, jobId: 'j1', token: 'tR' }))).toBe(0);
    expect(run(reconcileStateWriteStmt({ stage: 'inspected', json, lastError: null, now: T2, jobId: 'j1', token: 'tR' }))).toBe(0);
    expect(row('j1')).toEqual({ status: 'needs_answer', reconcile_stage: 'none', reconcile_state_json: ANSWER_STATE, last_error: null, updated_at: T });
    // answer_token を持つ answer 側だけが書ける
    const next = JSON.stringify({ scan: { answer: { cursor: 'c6', pages: 2, stalls: 1 } } });
    expect(run(answerScanSaveStmt({ json: next, lastError: null, now: T2, jobId: 'j1', token: 'tA' }))).toBe(1);
    expect(row('j1').reconcile_state_json).toBe(next);
  });
});

describe('token が違う write は changes=0', () => {
  it('answer 側: answer_token が違う（または sending でない）なら 0 行、一致すれば 1 行で last_error は COALESCE', () => {
    job('j2', { status: 'needs_answer', answer_state: 'sending', answer_token: 'tA', state: ANSWER_STATE });
    expect(run(answerScanSaveStmt({ json: '{}', lastError: 'scan_no_progress', now: T2, jobId: 'j2', token: 'other' }))).toBe(0);
    expect(row('j2').reconcile_state_json).toBe(ANSWER_STATE);
    job('j3', { status: 'needs_answer', answer_state: 'saved', answer_token: 'tA', state: ANSWER_STATE });
    expect(run(answerScanSaveStmt({ json: '{}', lastError: null, now: T2, jobId: 'j3', token: 'tA' }))).toBe(0);
    expect(run(answerScanSaveStmt({ json: '{"a":1}', lastError: 'scan_no_progress', now: T2, jobId: 'j2', token: 'tA' }))).toBe(1);
    expect(run(answerScanSaveStmt({ json: '{"a":2}', lastError: null, now: T2, jobId: 'j2', token: 'tA' }))).toBe(1);
    expect(row('j2')).toMatchObject({ reconcile_state_json: '{"a":2}', last_error: 'scan_no_progress', updated_at: T2 });
  });

  it('reconcile 側: reconcile_token が違えば 0 行、一致すれば running / budget_reached で 1 行（stage は指定時だけ変わる）', () => {
    job('j4', { status: 'running', reconcile_token: 'tR' });
    expect(run(reconcileStateWriteStmt({ stage: 'inspected', json: '{"a":1}', lastError: null, now: T2, jobId: 'j4', token: 'other' }))).toBe(0);
    expect(row('j4')).toMatchObject({ reconcile_stage: 'none', reconcile_state_json: '{}' });
    expect(run(reconcileStateWriteStmt({ stage: 'inspected', json: '{"a":1}', lastError: null, now: T2, jobId: 'j4', token: 'tR' }))).toBe(1);
    expect(run(reconcileStateWriteStmt({ stage: null, json: '{"a":2}', lastError: 'scan_no_progress', now: T2, jobId: 'j4', token: 'tR' }))).toBe(1);
    expect(row('j4')).toMatchObject({ reconcile_stage: 'inspected', reconcile_state_json: '{"a":2}', last_error: 'scan_no_progress' });
    job('j5', { status: 'budget_reached', reconcile_token: 'tR' });
    expect(run(reconcileStateWriteStmt({ stage: null, json: '{"b":1}', lastError: null, now: T2, jobId: 'j5', token: 'tR' }))).toBe(1);
    job('j6', { status: 'done', reconcile_token: 'tR' });
    expect(run(reconcileStateWriteStmt({ stage: null, json: '{"b":1}', lastError: null, now: T2, jobId: 'j6', token: 'tR' }))).toBe(0);
  });
});
