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

/** 差し戻しの rework job の brief（人の差し戻しと自動の差し戻しで同じ形） */
export function buildReworkBrief(origBrief: string | null | undefined, version: number, note: string, append = ''): string {
  return [origBrief ?? '', '', `## 差し戻し理由（v${version}）`, note, ...(append.trim() ? ['', '## 追記', append] : [])].join('\n');
}

export interface ReturnOptions {
  /** standards_log に書かない（自動の差し戻し。職人に渡す「これまでの差し戻し理由」を人の言葉で保つ §L-4・§R-49 (g)） */
  skipStandardsLog?: boolean;
  /**
   * P_RETURN に GUARD(vid) を足す: 版が verification_status='done' で、最新 attempt の verification の id が vid（§L-4）。
   * 判定の後に人の reverify や新しい検証がコミットされていれば 0 行で何もしない
   */
  guardVerificationId?: string;
}

/** 差し戻し: review_decisions + standards_log（skipStandardsLog なら無し）+ rework job queued + material queued + version rejected（最後） */
export function buildReturn(a: ReturnArgs, c: BuildCtx & { log_id: string }, o: ReturnOptions = {}): Stmt[] {
  const guarded = typeof o.guardVerificationId === 'string';
  const P = guarded
    ? `${P_RETURN} AND pv.verification_status = 'done'
    AND (SELECT pw.id FROM verifications pw WHERE pw.material_version_id = pv.id ORDER BY pw.attempt DESC LIMIT 1) = ?`
    : P_RETURN;
  const p = guarded ? [a.version_id, a.material_id, o.guardVerificationId as string] : [a.version_id, a.material_id];
  const out: Stmt[] = [
    stmt(
      `INSERT INTO review_decisions (id, material_version_id, material_id, decision, checklist_json, note, reviewer_email, content_sha256_at_decision, created_at)
       SELECT ?, ?, ?, 'return', ?, ?, ?, (SELECT content_sha256 FROM material_versions WHERE id = ?), ?
       WHERE EXISTS (${P})`,
      c.decision_id, a.version_id, a.material_id, a.checklist_json, a.note, a.reviewer_email, a.version_id, c.now, ...p,
    ),
  ];
  if (!o.skipStandardsLog) {
    out.push(
      stmt(
        `INSERT INTO standards_log (id, material_id, job_id, kind, question, answer, created_at)
         SELECT ?, ?, (SELECT job_id FROM material_versions WHERE id = ?), 'return_reason', NULL, ?, ?
         WHERE EXISTS (${P})`,
        c.log_id, a.material_id, a.version_id, a.note, c.now, ...p,
      ),
    );
  }
  out.push(
    stmt(
      `INSERT INTO factory_jobs (id, material_id, kind, model, phase, status, parent_version_id, brief_md, budget_cents, created_at, updated_at)
       SELECT ?, ?, 'rework', ?, 'questions', 'queued', ?, ?, ?, ?, ?
       WHERE EXISTS (${P})`,
      a.new_job_id, a.material_id, a.rework_model, a.version_id, a.rework_brief_md, a.rework_budget_cents, c.now, c.now, ...p,
    ),
    stmt(`UPDATE materials SET work_status = 'queued', updated_at = ? WHERE id = ? AND EXISTS (${P})`, c.now, a.material_id, ...p),
    stmt(`UPDATE material_versions SET status = 'rejected' WHERE id = ? AND EXISTS (${P})`, a.version_id, ...p),
  );
  return out;
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
