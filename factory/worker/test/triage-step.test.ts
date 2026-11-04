// cron の triageStep（契約 §L-4・§L-7 (l3)）と、確認 API の変更（§L-5・§L-7 (l4)）を node:sqlite の実 DB で確かめる。
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import type { RouteCtx } from '../src/http';
import { decide, listReview, reverify, reviewDetail } from '../src/routes/review';
import { AUTO_TRIAGE_EMAIL, applyTriage, computeTriage, triageStep, type TriageVersionRow } from '../src/triage-step';
import { d1, migratedDb, one, rows } from './d1-shim';
import { goodMaterial } from './helpers';

const GREEN_CHECKS = { schema: 'ok', forbidden: [], app_html: [], kakunin_zumi: [], missing_source_refs: [], missing_claim_refs: [], unreferenced_files: [] };
const FAR = () => Date.now() + 10 * 60_000;

type V = 'confirmed' | 'hypothesis' | 'unverified' | 'contradicted';
let db: DatabaseSync;
let env: Env;
let seq = 0;

beforeEach(() => {
  db = migratedDb();
  env = { DB: d1(db) } as unknown as Env;
  seq = 0;
});

interface Seed {
  mid: string;
  vid: string;
  created_at?: string;
  claims: Array<[V, string[]]>;
  sources: Record<string, { quote_found?: number; url_was_fetched?: number; license?: string }>;
  fetchErrors?: Record<string, number>;
  /** 既存の素材・job を使う（rework の版） */
  jobId?: string;
  newMaterial?: boolean;
  version?: number;
}

/** 素材 + done の job + review/done の版 + sources + verification attempt 1 */
function seed(s: Seed): { vid: string; wid: string; jid: string } {
  const at = s.created_at ?? '2026-11-04T00:00:00.000Z';
  if (s.newMaterial !== false) {
    db.prepare(
      "INSERT INTO materials (id, slug, title, kinds_json, work_status, publish_status, brief_md, created_at, updated_at) VALUES (?, ?, 't', '[3]', 'review', 'none', 'b', ?, ?)",
    ).run(s.mid, `slug-${s.mid}`, at, at);
  }
  const jid = s.jobId ?? `job-${s.vid}`;
  if (!s.jobId) {
    db.prepare(
      "INSERT INTO factory_jobs (id, material_id, kind, model, phase, status, session_id, brief_md, created_at, updated_at) VALUES (?, ?, 'draft', 'claude-sonnet-5-5', 'making', 'done', ?, '元の注文', ?, ?)",
    ).run(jid, s.mid, `sesn-${s.vid}`, at, at);
  }
  const claims = s.claims.map(([, sids], i) => ({ id: `c${i + 1}`, text: `主張 ${i + 1}`, status: 'confirmed', source_ids: sids, used_in: ['p1'] }));
  db.prepare(
    `INSERT INTO material_versions (id, material_id, version, job_id, session_id, r2_prefix, content_sha256, material_json, claims_json, adapt_rules_md,
       checks_json, public_paths_json, status, verification_status, verification_attempts, created_at)
     VALUES (?, ?, ?, ?, ?, 'p/', ?, ?, ?, 'a', ?, '[]', 'review', 'done', 1, ?)`,
  ).run(s.vid, s.mid, s.version ?? 1, jid, `sesn-${s.vid}`, `sha-${s.vid}`, JSON.stringify(goodMaterial()), JSON.stringify({ claims }), JSON.stringify(GREEN_CHECKS), at);
  for (const [sid, o] of Object.entries(s.sources)) {
    db.prepare(
      `INSERT INTO sources (id, material_version_id, source_id, url, license, is_primary, url_was_fetched, quote_found) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
    ).run(`src-${++seq}`, s.vid, sid, `https://minecraft.wiki/w/${sid}`, o.license ?? 'CC BY-SA 3.0', o.url_was_fetched ?? 1, o.quote_found ?? 1);
  }
  const wid = addVerification(s.vid, s.claims.map(([v]) => v), s.fetchErrors);
  return { vid: s.vid, wid, jid };
}

function addVerification(vid: string, vs: V[], fetchErrors: Record<string, number> = {}): string {
  const wid = `w-${vid}-${++seq}`;
  const verdicts = vs.map((verdict, i) => ({ claim_id: `c${i + 1}`, verdict, reason: 'r', opened_urls: [] }));
  const n = (k: V) => vs.filter((x) => x === k).length;
  db.prepare(
    `INSERT INTO verifications (id, material_version_id, attempt, model, claims_total, confirmed, hypothesis, unverified, contradicted, result_json, created_at)
     VALUES (?, ?, (SELECT COALESCE(MAX(attempt), 0) + 1 FROM verifications WHERE material_version_id = ?), 'claude-opus-5-5', ?, ?, ?, ?, ?, ?, '2026-11-04T00:00:00.000Z')`,
  ).run(wid, vid, vid, vs.length, n('confirmed'), n('hypothesis'), n('unverified'), n('contradicted'), JSON.stringify({ verdicts, overall_note: '', meta: { mode: 'batch', turns: 1, fetch_errors: fetchErrors, fetched_ok: [] } }));
  return wid;
}

/** 版 1 相当（25 中 confirmed 1、出典 8 中 quote_found=1 が 2 件、fetch_errors なし） */
const bad = (mid: string, vid: string, extra: Partial<Seed> = {}): Seed => {
  const sources: Seed['sources'] = {};
  for (let i = 1; i <= 8; i++) sources[`s${i}`] = { quote_found: i <= 2 ? 1 : 0 };
  return { mid, vid, claims: Array.from({ length: 25 }, (_, i) => [i === 0 ? 'confirmed' : 'unverified', [`s${(i % 8) + 1}`]] as [V, string[]]), sources, ...extra };
};
const good = (mid: string, vid: string, extra: Partial<Seed> = {}): Seed => ({ mid, vid, claims: [['confirmed', ['s1']], ['confirmed', ['s1']]], sources: { s1: {} }, ...extra });
/** few_confirmed だけ + verifier_limit（4/10 confirmed、残りは取得上限） */
const limited = (mid: string, vid: string): Seed => ({
  mid,
  vid,
  claims: [...Array.from({ length: 4 }, () => ['confirmed', ['s1']] as [V, string[]]), ...Array.from({ length: 6 }, () => ['unverified', ['s2']] as [V, string[]])],
  sources: { s1: {}, s2: {} },
  fetchErrors: { max_uses_exceeded: 2 },
});

/** done / failed の版に置ける既定でない値（verify_phase は running の間だけなので NULL のまま） */
function dirtyVerifyColumns(vid: string) {
  db.prepare(
    `UPDATE material_versions SET verification_token = 'tok-old', verification_attempts = 3, verify_phase_at = '2026-11-04T00:05:00.000Z',
       verify_batch_id = 'msgbatch_old', verify_turn = 3, verify_pauses = 2, verify_micro = 999, triaged_verification_id = 'w-old' WHERE id = ?`,
  ).run(vid);
}
const VERIFY_COLS =
  'verification_status, verification_token, verification_attempts, verify_phase, verify_phase_at, verify_batch_id, verify_turn, verify_pauses, verify_micro, triaged_verification_id';
const RESET = {
  verification_status: 'pending',
  verification_token: null,
  verification_attempts: 0,
  verify_phase: null,
  verify_phase_at: null,
  verify_batch_id: null,
  verify_turn: 0,
  verify_pauses: 0,
  verify_micro: 0,
  triaged_verification_id: null,
};
const latestOf = (vid: string) => one(db, 'SELECT id, result_json FROM verifications WHERE material_version_id = ? ORDER BY attempt DESC LIMIT 1', vid) as { id: string; result_json: string };

const versionRow = (vid: string) => one(db, 'SELECT * FROM material_versions WHERE id = ?', vid) as unknown as TriageVersionRow & Record<string, unknown>;
const count = (sql: string, ...p: Array<string | number>) => Number(one(db, sql, ...p).n);

function ctx(method: string, body?: unknown): RouteCtx {
  const request = new Request('http://localhost/api/review/x', { method, body: body === undefined ? undefined : JSON.stringify(body) });
  return {
    env,
    request,
    url: new URL(request.url),
    email: 'ops@example.invalid',
    exec: {} as ExecutionContext,
    port: async () => {
      throw new Error('port not used');
    },
  };
}

describe('triageStep (§L-7 l3)', () => {
  it('auto_return: rework job が queued・版 rejected・standards_log は増えない・review_decisions は system:auto-triage', async () => {
    seed(bad('m1', 'v1'));
    expect(await triageStep(env, { deadline: FAR() })).toEqual(['auto_return']);
    expect(one(db, "SELECT status, verification_status FROM material_versions WHERE id = 'v1'")).toEqual({ status: 'rejected', verification_status: 'done' });
    const jobs = rows(db, "SELECT kind, model, status, session_id, parent_version_id, budget_cents, brief_md FROM factory_jobs WHERE material_id = 'm1' AND kind = 'rework'");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ kind: 'rework', model: 'claude-opus-5-5', status: 'queued', session_id: null, parent_version_id: 'v1', budget_cents: 1000 });
    expect(String(jobs[0].brief_md)).toContain('元の注文');
    expect(String(jobs[0].brief_md)).toContain('## 差し戻し理由（v1）\n自動の差し戻し（検証の結果: ');
    expect(one(db, "SELECT work_status FROM materials WHERE id = 'm1'").work_status).toBe('queued');
    expect(count('SELECT COUNT(*) AS n FROM standards_log')).toBe(0);
    const d = rows(db, "SELECT decision, reviewer_email, checklist_json, note FROM review_decisions WHERE material_version_id = 'v1'");
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ decision: 'return', reviewer_email: AUTO_TRIAGE_EMAIL, checklist_json: null });
    expect(String(d[0].note).startsWith('自動の差し戻し（検証の結果: 確かめられた主張が 25 件中 1 件で')).toBe(true);
  });

  it('rework の版は再び bad でも（verifier_limit なしなら）none で人に出る', async () => {
    seed(bad('m1', 'v1'));
    expect(await triageStep(env, { deadline: FAR() })).toEqual(['auto_return']);
    const rework = one(db, "SELECT id FROM factory_jobs WHERE kind = 'rework' AND parent_version_id = 'v1'").id as string;
    db.prepare("UPDATE factory_jobs SET status = 'done', session_id = 'sesn-rework' WHERE id = ?").run(rework);
    const { wid } = seed({ ...bad('m1', 'v2'), jobId: rework, newMaterial: false, version: 2, created_at: '2026-11-04T01:00:00.000Z' });
    expect(await triageStep(env, { deadline: FAR() })).toEqual(['none']);
    expect(one(db, "SELECT status, triaged_verification_id FROM material_versions WHERE id = 'v2'")).toEqual({ status: 'review', triaged_verification_id: wid });
    expect(count("SELECT COUNT(*) AS n FROM review_decisions WHERE material_version_id = 'v2'")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM factory_jobs WHERE status = 'queued'")).toBe(0);
    expect(await triageStep(env, { deadline: FAR() })).toEqual([]); // 処置なしの記録で次から対象外
  });

  it('処置なしの版が 3 件先にあっても 4 件目が処置される（triaged_verification_id）', async () => {
    for (let i = 1; i <= 3; i++) seed(good(`m${i}`, `v${i}`, { created_at: `2026-11-04T00:0${i}:00.000Z` }));
    seed(bad('m4', 'v4', { created_at: '2026-11-04T00:09:00.000Z' }));
    expect(await triageStep(env, { deadline: FAR() })).toEqual(['none', 'none', 'none']);
    expect(one(db, "SELECT status, triaged_verification_id FROM material_versions WHERE id = 'v4'")).toEqual({ status: 'review', triaged_verification_id: null });
    expect(await triageStep(env, { deadline: FAR() })).toEqual(['auto_return']);
    expect(one(db, "SELECT status FROM material_versions WHERE id = 'v4'").status).toBe('rejected');
  });

  it('判定後に人の reverify がコミットされた版には auto_return が 0 行（reverify は verify_* と triaged_verification_id をすべて戻す）', async () => {
    seed(bad('m1', 'v1'));
    dirtyVerifyColumns('v1');
    const t = await computeTriage(env.DB, versionRow('v1'), latestOf('v1'));
    expect(t.action).toBe('auto_return');
    const res = await reverify(ctx('POST'), 'v1');
    expect(res.status).toBe(200);
    expect(one(db, `SELECT ${VERIFY_COLS} FROM material_versions WHERE id = 'v1'`)).toEqual(RESET);
    expect(await applyTriage(env, versionRow('v1'), t)).toBe('stale');
    expect(one(db, "SELECT status FROM material_versions WHERE id = 'v1'").status).toBe('review');
    expect(count('SELECT COUNT(*) AS n FROM review_decisions')).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM factory_jobs WHERE kind = 'rework'")).toBe(0);
    expect(one(db, "SELECT work_status FROM materials WHERE id = 'm1'").work_status).toBe('review');
  });

  it('人の reverify は failed の版でも verify_* と triaged_verification_id をすべて戻す', async () => {
    seed(good('m1', 'v1'));
    dirtyVerifyColumns('v1');
    db.prepare("UPDATE material_versions SET verification_status = 'failed' WHERE id = 'v1'").run();
    expect((await reverify(ctx('POST'), 'v1')).status).toBe(200);
    expect(one(db, `SELECT ${VERIFY_COLS} FROM material_versions WHERE id = 'v1'`)).toEqual(RESET);
  });

  describe('判定後に新しい verification がコミットされた（status は done のまま）→ どの処置も 0 行', () => {
    const NEWER: V[] = ['confirmed', 'confirmed'];
    it('none: triaged_verification_id を書かない', async () => {
      seed(good('m1', 'v1'));
      const t = await computeTriage(env.DB, versionRow('v1'), latestOf('v1'));
      expect(t.action).toBe('none');
      addVerification('v1', NEWER);
      expect(await applyTriage(env, versionRow('v1'), t)).toBe('stale');
      expect(one(db, "SELECT status, verification_status, triaged_verification_id FROM material_versions WHERE id = 'v1'")).toEqual({
        status: 'review',
        verification_status: 'done',
        triaged_verification_id: null,
      });
    });
    it('reverify: pending に戻さず auto_reverified も 0 のまま', async () => {
      seed(limited('m1', 'v1'));
      const t = await computeTriage(env.DB, versionRow('v1'), latestOf('v1'));
      expect(t.action).toBe('reverify');
      addVerification('v1', [...Array(10).fill('confirmed')] as V[]);
      expect(await applyTriage(env, versionRow('v1'), t)).toBe('stale');
      expect(one(db, "SELECT status, verification_status, verification_attempts, auto_reverified FROM material_versions WHERE id = 'v1'")).toEqual({
        status: 'review',
        verification_status: 'done',
        verification_attempts: 1,
        auto_reverified: 0,
      });
    });
    it('auto_return: 版は review のまま・決定も rework job も作らない', async () => {
      seed(bad('m1', 'v1'));
      const t = await computeTriage(env.DB, versionRow('v1'), latestOf('v1'));
      expect(t.action).toBe('auto_return');
      addVerification('v1', [...Array(25).fill('confirmed')] as V[]);
      expect(await applyTriage(env, versionRow('v1'), t)).toBe('stale');
      expect(one(db, "SELECT status, verification_status FROM material_versions WHERE id = 'v1'")).toEqual({ status: 'review', verification_status: 'done' });
      expect(count('SELECT COUNT(*) AS n FROM review_decisions')).toBe(0);
      expect(count("SELECT COUNT(*) AS n FROM factory_jobs WHERE kind = 'rework'")).toBe(0);
      expect(one(db, "SELECT work_status FROM materials WHERE id = 'm1'").work_status).toBe('review');
    });
  });

  it('reverify: few_confirmed だけ + 取得上限 → 1 回だけ自動で再検証し、再び同じなら auto_return', async () => {
    seed(limited('m1', 'v1'));
    dirtyVerifyColumns('v1');
    expect(await triageStep(env, { deadline: FAR() })).toEqual(['reverify']);
    expect(one(db, `SELECT ${VERIFY_COLS}, auto_reverified FROM material_versions WHERE id = 'v1'`)).toEqual({ ...RESET, auto_reverified: 1 });
    expect(await triageStep(env, { deadline: FAR() })).toEqual([]); // pending の間は対象外
    // 検証係がもう一度同じ結果を出した
    addVerification('v1', [...Array(4).fill('confirmed'), ...Array(6).fill('unverified')] as V[], { max_uses_exceeded: 2 });
    db.prepare("UPDATE material_versions SET verification_status = 'done', verification_attempts = 1 WHERE id = 'v1'").run();
    expect(await triageStep(env, { deadline: FAR() })).toEqual(['auto_return']);
  });

  it('締め切りを過ぎていれば処置しない', async () => {
    seed(bad('m1', 'v1'));
    expect(await triageStep(env, { deadline: Date.now() })).toEqual(['skipped_time']);
    expect(one(db, "SELECT status FROM material_versions WHERE id = 'v1'").status).toBe('review');
  });
});

const humanOk = { explanation_and_expression: { result: 'ok', note: '' }, relation_to_learning: { result: 'ok', note: '' }, conditions_of_use: { result: 'na', note: '' } };
const fullOk = { ...humanOk, content_and_evidence: { result: 'ok', note: '' }, artifact_behavior: { result: 'ok', note: '' }, terms_of_use: { result: 'ok', note: '' } };

describe('approve (§L-7 l4)', () => {
  it('auto が ok の 3 項目を省略して承認できる（サーバーが {"result":"ok","note":"auto"} を記録）', async () => {
    const { wid } = seed(good('m1', 'v1'));
    const res = await decide(ctx('POST', { decision: 'approve', checklist: humanOk, verification_id: wid }), 'v1');
    expect(res.status).toBe(200);
    expect(one(db, "SELECT status FROM material_versions WHERE id = 'v1'").status).toBe('approved');
    const cl = JSON.parse(String(one(db, "SELECT checklist_json FROM review_decisions WHERE decision = 'approve'").checklist_json));
    for (const k of ['content_and_evidence', 'artifact_behavior', 'terms_of_use']) expect(cl[k]).toEqual({ result: 'ok', note: 'auto' });
    expect(cl.conditions_of_use).toEqual({ result: 'na', note: '' });
  });

  it('auto が review の項目（license unknown → terms_of_use）を省略すると 400 checklist_incomplete', async () => {
    const { wid } = seed(good('m1', 'v1', { sources: { s1: { license: 'unknown' } } }));
    const res = await decide(ctx('POST', { decision: 'approve', checklist: humanOk, verification_id: wid }), 'v1');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'checklist_incomplete' });
    // 人の 3 項目のどれかを省略しても 400
    const { conditions_of_use: _drop, ...two } = humanOk;
    const res2 = await decide(ctx('POST', { decision: 'approve', checklist: { ...two, terms_of_use: { result: 'ok', note: '' } }, verification_id: wid }), 'v1');
    expect(res2.status).toBe(400);
    // review の項目を回答すれば承認できる
    const res3 = await decide(ctx('POST', { decision: 'approve', checklist: { ...humanOk, terms_of_use: { result: 'ok', note: '見た' } }, verification_id: wid }), 'v1');
    expect(res3.status).toBe(200);
  });

  it('古い verification_id は checklist の省略より先に 409 stale_verification（省略できる項目は最新の仕分けで決まる）', async () => {
    const { wid } = seed(good('m1', 'v1'));
    // 新しい試行では c2 が unverified → 最新の仕分けでは content_and_evidence が review（古い画面は省略して送ってくる）
    addVerification('v1', ['confirmed', 'unverified']);
    const res = await decide(ctx('POST', { decision: 'approve', checklist: humanOk, verification_id: wid }), 'v1');
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'stale_verification' });
  });

  it('action が none 以外なら 409 auto_triage_pending（6 項目を全部回答していても）', async () => {
    const { wid } = seed(bad('m1', 'v1'));
    const res = await decide(ctx('POST', { decision: 'approve', checklist: fullOk, verification_id: wid }), 'v1');
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'auto_triage_pending' });
    expect(one(db, "SELECT status FROM material_versions WHERE id = 'v1'").status).toBe('review');
  });
});

describe('GET /api/review (§L-5)', () => {
  it('詳細に triage を含め、費用は ref_id = 版 id と vb:{版 id}:… の両方を数える（他の版の vb: は数えない）', async () => {
    const { wid } = seed(bad('m1', 'v1'));
    const led = db.prepare("INSERT INTO cost_ledger (id, day, kind, ref_id, cents, created_at) VALUES (?, '2026-11-04', 'verify', ?, ?, '2026-11-04T00:00:00.000Z')");
    led.run('l1', 'v1', 10);
    led.run('l2', 'vb:v1:tok:t0', 150);
    led.run('l3', 'vb:v1:tok:t1', 7);
    led.run('l4', 'vb:v10:tok:t0', 1000);
    led.run('l5', 'v10', 1000);
    const res = await reviewDetail(ctx('GET'), 'v1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { verify_cost_cents: number; triage: Record<string, unknown> };
    expect(body.verify_cost_cents).toBe(167);
    expect(body.triage).toMatchObject({ verification_id: wid, action: 'auto_return', bad: true, reasons: ['few_confirmed', 'quote_mismatch_many'] });
    expect(Object.keys(body.triage).sort()).toEqual(['action', 'auto', 'bad', 'groups', 'needs_review', 'ok_counts', 'reasons', 'return_note', 'verification_id']);
  });

  it('一覧は needs_review / auto_ok を足し、needs_review の多い順 → 作成の古い順', async () => {
    seed(good('m1', 'v1', { created_at: '2026-11-04T00:01:00.000Z' }));
    seed(good('m2', 'v2', { created_at: '2026-11-04T00:02:00.000Z', sources: { s1: { license: 'unknown' } } }));
    seed(good('m3', 'v3', { created_at: '2026-11-04T00:03:00.000Z' }));
    seed(good('m4', 'v4', { created_at: '2026-11-04T00:00:00.000Z', sources: { s1: { license: 'unknown' } } }));
    const res = await listReview(ctx('GET'));
    const body = (await res.json()) as { versions: Array<{ version_id: string; needs_review: number; auto_ok: number }> };
    expect(body.versions.map((r) => [r.version_id, r.needs_review, r.auto_ok])).toEqual([
      ['v4', 2, 2],
      ['v2', 2, 2],
      ['v1', 0, 3],
      ['v3', 0, 3],
    ]);
  });
});
