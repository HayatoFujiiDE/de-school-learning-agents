// 自動の処置（契約 §L-4）。cron の verify 段の直後に triageStep を呼ぶ。
// 確認待ち（review・検証 done）で未処置の版に triageVersion（§L-3）を当て、none / reverify / auto_return を行う。
// どの書き込みも GUARD(vid)（判定に使った verification が今も最新で done）を CAS 条件に入れる。人の reverify が先にコミットしていれば 0 行。
// auto_return は rework job を queued で残すだけで起動しない（次の cron の起動段が拾う）。standards_log には書かない。

import { all, cas, conditionalBatch, first, isUniqueViolation, nowIso, stmt } from './db';
import { JOB_MODEL, cfg, type Env } from './env';
import { parseJsonField } from './http';
import { buildReturn, buildReworkBrief } from './publish';
import { triageVersion, type TriageOutput, type TriageSource } from './checks/triage';

export const AUTO_TRIAGE_EMAIL = 'system:auto-triage';
/** 1 回の cron で処置する版の数（§L-4） */
export const TRIAGE_BATCH = 3;
/** 締め切りの手前で新しい版に手を付けない余白 */
const TRIAGE_DEADLINE_MARGIN_MS = 5_000;

/** triageVersion に要る版の列 */
export interface TriageVersionRow {
  id: string;
  material_id: string;
  version: number;
  job_id: string;
  claims_json: string;
  checks_json: string;
  material_json: string;
  auto_reverified: number;
}
export interface LatestVerification {
  id: string;
  result_json: string;
}

const GUARD = `status = 'review' AND verification_status = 'done'
  AND (SELECT vw.id FROM verifications vw WHERE vw.material_version_id = material_versions.id ORDER BY vw.attempt DESC LIMIT 1) = ?`;

export const latestVerificationOf = (db: D1Database, vid: string) =>
  first<LatestVerification>(db, stmt('SELECT id, result_json FROM verifications WHERE material_version_id = ? ORDER BY attempt DESC LIMIT 1', vid));

/** この版の job が自動差し戻しで作られた = job.parent_version_id の版に system:auto-triage の return がある */
export async function isAutoDerived(db: D1Database, jobId: string): Promise<boolean> {
  const r = await first(
    db,
    stmt(
      `SELECT 1 AS x FROM factory_jobs j JOIN review_decisions d ON d.material_version_id = j.parent_version_id
       WHERE j.id = ? AND j.parent_version_id IS NOT NULL AND d.decision = 'return' AND d.reviewer_email = ?`,
      jobId,
      AUTO_TRIAGE_EMAIL,
    ),
  );
  return !!r;
}

/** 版と最新 verification から仕分けを計算する（確認画面・一覧・承認・cron が同じものを使う） */
export async function computeTriage(db: D1Database, v: TriageVersionRow, latest: LatestVerification | null): Promise<TriageOutput> {
  const sources = await all<TriageSource>(
    db,
    stmt('SELECT source_id, url, license, url_was_fetched, quote_found FROM sources WHERE material_version_id = ? ORDER BY rowid', v.id),
  );
  return triageVersion({
    claims: parseJsonField<unknown>(v.claims_json, null),
    report: latest ? { id: latest.id, result: parseJsonField<unknown>(latest.result_json, null) } : null,
    sources: sources.map((s) => ({ ...s, url_was_fetched: Number(s.url_was_fetched), quote_found: Number(s.quote_found) })),
    checks: parseJsonField<unknown>(v.checks_json, null),
    material: parseJsonField<unknown>(v.material_json, null),
    autoReverified: Number(v.auto_reverified ?? 0),
    autoDerived: await isAutoDerived(db, v.job_id),
  });
}

export type TriageApplied = 'none' | 'reverify' | 'auto_return' | 'stale' | 'busy';

/** 計算済みの仕分けを処置する。0 行（判定後に世代が変わった）は 'stale'、active job の部分 UNIQUE に当たれば 'busy' */
export async function applyTriage(env: Env, v: TriageVersionRow, t: TriageOutput): Promise<TriageApplied> {
  const db = env.DB;
  const vid = t.verification_id;
  if (!vid) return 'stale';
  if (t.action === 'none') {
    const ok = await cas(db, stmt(`UPDATE material_versions SET triaged_verification_id = ? WHERE id = ? AND ${GUARD}`, vid, v.id, vid));
    return ok ? 'none' : 'stale';
  }
  if (t.action === 'reverify') {
    // max_uses は変えない（§R-49 (f)）
    const ok = await cas(
      db,
      stmt(
        `UPDATE material_versions SET verification_status = 'pending', verification_attempts = 0, verification_token = NULL,
           verify_phase = NULL, verify_phase_at = NULL, verify_batch_id = NULL, verify_turn = 0, verify_pauses = 0, verify_micro = 0,
           auto_reverified = 1, triaged_verification_id = NULL
         WHERE id = ? AND ${GUARD} AND auto_reverified = 0`,
        v.id,
        vid,
      ),
    );
    return ok ? 'reverify' : 'stale';
  }
  // auto_return
  const note = t.return_note ?? '';
  const orig = await first<{ brief_md: string }>(db, stmt('SELECT brief_md FROM factory_jobs WHERE id = ?', v.job_id));
  const newJobId = crypto.randomUUID();
  try {
    const r = await conditionalBatch(
      db,
      buildReturn(
        {
          material_id: v.material_id,
          version_id: v.id,
          reviewer_email: AUTO_TRIAGE_EMAIL,
          checklist_json: null,
          note,
          new_job_id: newJobId,
          rework_brief_md: buildReworkBrief(orig?.brief_md, v.version, note),
          rework_model: JOB_MODEL.rework,
          rework_budget_cents: cfg(env).budgetReworkCents,
        },
        { decision_id: crypto.randomUUID(), now: nowIso(), log_id: crypto.randomUUID() },
        { skipStandardsLog: true, guardVerificationId: vid },
      ),
    );
    return r.ok ? 'auto_return' : 'stale';
  } catch (e) {
    if (isUniqueViolation(e)) return 'busy';
    throw e;
  }
}

/** cron の §L-4。古い順に最大 3 件。戻り値は版ごとの結果（ログ用） */
export async function triageStep(env: Env, opts: { deadline: number }): Promise<string[]> {
  const db = env.DB;
  const rows = await all<TriageVersionRow & { lv_id: string; lv_result_json: string }>(
    db,
    stmt(
      `SELECT v.id, v.material_id, v.version, v.job_id, v.claims_json, v.checks_json, v.material_json, v.auto_reverified,
              lv.id AS lv_id, lv.result_json AS lv_result_json
       FROM material_versions v
       JOIN verifications lv ON lv.id = (SELECT w.id FROM verifications w WHERE w.material_version_id = v.id ORDER BY w.attempt DESC LIMIT 1)
       WHERE v.status = 'review' AND v.verification_status = 'done'
         AND NOT EXISTS (SELECT 1 FROM review_decisions d WHERE d.material_version_id = v.id)
         AND (v.triaged_verification_id IS NULL OR v.triaged_verification_id <> lv.id)
       ORDER BY v.created_at ASC, v.id ASC LIMIT ?`,
      TRIAGE_BATCH,
    ),
  );
  const out: string[] = [];
  for (const row of rows) {
    if (Date.now() > opts.deadline - TRIAGE_DEADLINE_MARGIN_MS) {
      out.push('skipped_time');
      break;
    }
    const t = await computeTriage(db, row, { id: row.lv_id, result_json: row.lv_result_json });
    const r = await applyTriage(env, row, t);
    console.log(JSON.stringify({ at: 'triage', version_id: row.id, action: t.action, result: r }));
    out.push(r);
  }
  return out;
}
