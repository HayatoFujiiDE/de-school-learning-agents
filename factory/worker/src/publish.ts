// 公開切替の唯一の関数 publishSwitch（契約 §B-6）。materials.publish_status と current_version_id への UPDATE はこのファイルにしか書かない。
// あわせて確認の決定（return / reject）の batch もここで組み立てる（publish_status は触らない）。
// SQL の組み立て（build*）は純関数で、test/publish-sql.test.ts が node:sqlite の実 DB で実行して行数を確かめる。

import { ACTIVE_JOB_SQL, conditionalBatch, stmt, type Stmt } from './db';

export type PublishSwitchArgs =
  | {
      kind: 'approve';
      material_id: string;
      version_id: string;
      verification_id: string;
      reviewer_email: string;
      checklist_json: string;
      note: string | null;
    }
  | { kind: 'rollback'; material_id: string; version_id: string; reviewer_email: string; note: string | null }
  | { kind: 'stop'; material_id: string; reviewer_email: string; note: string | null };

export interface BuildCtx {
  decision_id: string;
  now: string;
}

// 述語 P（approve）: 版が review・検証 done・素材一致・渡された verification_id が最新 attempt で contradicted=0・active job なし
const P_APPROVE = `SELECT 1 FROM material_versions pv
  WHERE pv.id = ? AND pv.material_id = ? AND pv.status = 'review' AND pv.verification_status = 'done'
    AND EXISTS (SELECT 1 FROM verifications pw
      WHERE pw.id = ? AND pw.material_version_id = pv.id AND pw.contradicted = 0
        AND pw.attempt = (SELECT MAX(pw2.attempt) FROM verifications pw2 WHERE pw2.material_version_id = pv.id))
    AND NOT EXISTS (SELECT 1 FROM factory_jobs pj WHERE pj.material_id = pv.material_id AND pj.status IN ${ACTIVE_JOB_SQL})`;

// 述語 P（rollback）: 同素材の approved 版で、現在の版ではない、または配信停止中（stop 後に同じ版を再び配信できる。§R-29）
const P_ROLLBACK = `SELECT 1 FROM material_versions pv JOIN materials pm ON pm.id = pv.material_id
  WHERE pv.id = ? AND pv.material_id = ? AND pv.status = 'approved'
    AND (pm.current_version_id IS NULL OR pm.current_version_id <> pv.id OR pm.publish_status = 'stopped')`;

// 述語 P（stop）: 配信中
const P_STOP = `SELECT 1 FROM materials pm WHERE pm.id = ? AND pm.publish_status = 'available'`;

// 述語 P（return）: 版が review・素材一致（active job は部分 UNIQUE index が INSERT で弾く）
const P_RETURN = `SELECT 1 FROM material_versions pv WHERE pv.id = ? AND pv.material_id = ? AND pv.status = 'review'`;

// 述語 P（reject）: 版が review・素材一致・active job なし
const P_REJECT = `SELECT 1 FROM material_versions pv
  WHERE pv.id = ? AND pv.material_id = ? AND pv.status = 'review'
    AND NOT EXISTS (SELECT 1 FROM factory_jobs pj WHERE pj.material_id = pv.material_id AND pj.status IN ${ACTIVE_JOB_SQL})`;

export function buildPublishSwitch(a: PublishSwitchArgs, c: BuildCtx): Stmt[] {
  switch (a.kind) {
    case 'approve': {
      const p = [a.version_id, a.material_id, a.verification_id];
      return [
        stmt(
          `INSERT INTO review_decisions (id, material_version_id, material_id, decision, checklist_json, note, reviewer_email, content_sha256_at_decision, created_at)
           SELECT ?, ?, ?, 'approve', ?, ?, ?, (SELECT content_sha256 FROM material_versions WHERE id = ?), ?
           WHERE EXISTS (${P_APPROVE})`,
          c.decision_id, a.version_id, a.material_id, a.checklist_json, a.note, a.reviewer_email, a.version_id, c.now, ...p,
        ),
        stmt(
          `UPDATE materials SET current_version_id = ?, publish_status = 'available', work_status = 'idle', updated_at = ?
           WHERE id = ? AND EXISTS (${P_APPROVE})`,
          a.version_id, c.now, a.material_id, ...p,
        ),
        // 述語の列（version.status）を変えるのはこの最後の 1 文だけ
        stmt(`UPDATE material_versions SET status = 'approved' WHERE id = ? AND EXISTS (${P_APPROVE})`, a.version_id, ...p),
      ];
    }
    case 'rollback': {
      const p = [a.version_id, a.material_id];
      return [
        stmt(
          `INSERT INTO review_decisions (id, material_version_id, material_id, decision, checklist_json, note, reviewer_email, content_sha256_at_decision, created_at)
           SELECT ?, ?, ?, 'rollback', NULL, ?, ?, (SELECT content_sha256 FROM material_versions WHERE id = ?), ?
           WHERE EXISTS (${P_ROLLBACK})`,
          c.decision_id, a.version_id, a.material_id, a.note, a.reviewer_email, a.version_id, c.now, ...p,
        ),
        stmt(
          `UPDATE materials SET current_version_id = ?, publish_status = 'available', updated_at = ?
           WHERE id = ? AND EXISTS (${P_ROLLBACK})`,
          a.version_id, c.now, a.material_id, ...p,
        ),
      ];
    }
    case 'stop': {
      return [
        stmt(
          `INSERT INTO review_decisions (id, material_version_id, material_id, decision, checklist_json, note, reviewer_email, content_sha256_at_decision, created_at)
           SELECT ?, (SELECT current_version_id FROM materials WHERE id = ?), ?, 'stop', NULL, ?, ?,
                  (SELECT v.content_sha256 FROM material_versions v JOIN materials m ON v.id = m.current_version_id WHERE m.id = ?), ?
           WHERE EXISTS (${P_STOP})`,
          c.decision_id, a.material_id, a.material_id, a.note, a.reviewer_email, a.material_id, c.now, a.material_id,
        ),
        stmt(
          `UPDATE materials SET publish_status = 'stopped', updated_at = ? WHERE id = ? AND EXISTS (${P_STOP})`,
          c.now, a.material_id, a.material_id,
        ),
      ];
    }
  }
}

/** publish_status / current_version_id を変える唯一の関数。ok=false は述語不成立（409） */
export async function publishSwitch(db: D1Database, a: PublishSwitchArgs, c: BuildCtx): Promise<{ ok: boolean }> {
  const r = await conditionalBatch(db, buildPublishSwitch(a, c));
  return { ok: r.ok };
}

export interface ReturnArgs {
  material_id: string;
  version_id: string;
  reviewer_email: string;
  checklist_json: string | null;
  note: string;
  new_job_id: string;
  rework_brief_md: string;
  rework_model: string;
  rework_budget_cents: number;
}

/** 差し戻し: review_decisions + standards_log + rework job queued + material queued + version rejected（最後） */
export function buildReturn(a: ReturnArgs, c: BuildCtx & { log_id: string }): Stmt[] {
  const p = [a.version_id, a.material_id];
  return [
    stmt(
      `INSERT INTO review_decisions (id, material_version_id, material_id, decision, checklist_json, note, reviewer_email, content_sha256_at_decision, created_at)
       SELECT ?, ?, ?, 'return', ?, ?, ?, (SELECT content_sha256 FROM material_versions WHERE id = ?), ?
       WHERE EXISTS (${P_RETURN})`,
      c.decision_id, a.version_id, a.material_id, a.checklist_json, a.note, a.reviewer_email, a.version_id, c.now, ...p,
    ),
    stmt(
      `INSERT INTO standards_log (id, material_id, job_id, kind, question, answer, created_at)
       SELECT ?, ?, (SELECT job_id FROM material_versions WHERE id = ?), 'return_reason', NULL, ?, ?
       WHERE EXISTS (${P_RETURN})`,
      c.log_id, a.material_id, a.version_id, a.note, c.now, ...p,
    ),
    stmt(
      `INSERT INTO factory_jobs (id, material_id, kind, model, phase, status, parent_version_id, brief_md, budget_cents, created_at, updated_at)
       SELECT ?, ?, 'rework', ?, 'questions', 'queued', ?, ?, ?, ?, ?
       WHERE EXISTS (${P_RETURN})`,
      a.new_job_id, a.material_id, a.rework_model, a.version_id, a.rework_brief_md, a.rework_budget_cents, c.now, c.now, ...p,
    ),
    stmt(`UPDATE materials SET work_status = 'queued', updated_at = ? WHERE id = ? AND EXISTS (${P_RETURN})`, c.now, a.material_id, ...p),
    stmt(`UPDATE material_versions SET status = 'rejected' WHERE id = ? AND EXISTS (${P_RETURN})`, a.version_id, ...p),
  ];
}

export interface RejectArgs {
  material_id: string;
  version_id: string;
  reviewer_email: string;
  checklist_json: string | null;
  note: string;
}

/** 却下: review_decisions + standards_log + material idle + version rejected（最後）。publish_status は変えない */
export function buildReject(a: RejectArgs, c: BuildCtx & { log_id: string }): Stmt[] {
  const p = [a.version_id, a.material_id];
  return [
    stmt(
      `INSERT INTO review_decisions (id, material_version_id, material_id, decision, checklist_json, note, reviewer_email, content_sha256_at_decision, created_at)
       SELECT ?, ?, ?, 'reject', ?, ?, ?, (SELECT content_sha256 FROM material_versions WHERE id = ?), ?
       WHERE EXISTS (${P_REJECT})`,
      c.decision_id, a.version_id, a.material_id, a.checklist_json, a.note, a.reviewer_email, a.version_id, c.now, ...p,
    ),
    stmt(
      `INSERT INTO standards_log (id, material_id, job_id, kind, question, answer, created_at)
       SELECT ?, ?, (SELECT job_id FROM material_versions WHERE id = ?), 'return_reason', NULL, ?, ?
       WHERE EXISTS (${P_REJECT})`,
      c.log_id, a.material_id, a.version_id, a.note, c.now, ...p,
    ),
    stmt(`UPDATE materials SET work_status = 'idle', updated_at = ? WHERE id = ? AND EXISTS (${P_REJECT})`, c.now, a.material_id, ...p),
    stmt(`UPDATE material_versions SET status = 'rejected' WHERE id = ? AND EXISTS (${P_REJECT})`, a.version_id, ...p),
  ];
}
