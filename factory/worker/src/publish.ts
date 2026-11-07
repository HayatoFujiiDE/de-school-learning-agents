// 公開切替の唯一の関数 publishSwitch（契約 §B-6）。materials.publish_status と current_version_id への UPDATE はこのファイルにしか書かない。
// あわせて確認の決定（return / reject）の batch もここで組み立てる（publish_status は触らない）。
// SQL の組み立て（build*）は純関数で、test/publish-sql.test.ts が node:sqlite の実 DB で実行して行数を確かめる。

import { ACTIVE_JOB_SQL, conditionalBatch, stmt, type SqlValue, type Stmt } from './db';

/** 読み手係の世代（判定で読んだ reader_status と reader_token。契約 V-7 b・c） */
export interface ReaderGuard {
  status: string;
  token: string | null;
}

export type PublishSwitchArgs =
  | {
      kind: 'approve';
      material_id: string;
      version_id: string;
      verification_id: string;
      reviewer_email: string;
      checklist_json: string;
      note: string | null;
      /** 判断した時の仕分けの gate（契約 V-7 b。review_decisions.machine_gate） */
      machine_gate?: string | null;
      /** 契約 V-7 c: 判定で読んだ読み手係の世代が今も同じ（人の承認・機械の承認の両方に付ける） */
      reader_guard?: ReaderGuard;
      /** 契約 V-7 c: 判定で「確認済み」として頼ったチャンネルが今も trusted_channels にある */
      trusted_keys?: readonly string[];
      /** 契約 V-7 c: 機械の承認だけ。settings auto_publish が '1' で、paused が '1' でない（人の承認には付けない） */
      require_auto_publish?: boolean;
      /** 契約 V-7 e: 人の承認で確認済みにするチャンネル（仕分けの video_channel_new の項目の key だけ） */
      trust_channels?: ReadonlyArray<{ channel_key: string; channel_name: string }>;
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

/** settings trusted_gen を 1 増やす文（契約 V-7 e・f。行が無ければ '1'）。cond は WHERE の条件（SQL の INSERT … SELECT … ON CONFLICT は WHERE が要る） */
export function trustedGenBumpStmt(cond: string, condParams: SqlValue[], now: string): Stmt {
  return {
    sql: `INSERT INTO settings (key, value, updated_at) SELECT 'trusted_gen', '1', ? WHERE ${cond}
ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(settings.value AS INTEGER) + 1 AS TEXT), updated_at = excluded.updated_at`,
    params: [now, ...condParams],
  };
}

export function buildPublishSwitch(a: PublishSwitchArgs, c: BuildCtx): Stmt[] {
  switch (a.kind) {
    case 'approve': {
      // §B-6 の述語 P_APPROVE はそのまま残し、契約 V-7 c の条件を AND で足す（同じ batch の全文に同じ条件）
      const extra: string[] = [];
      const extraParams: SqlValue[] = [];
      if (a.reader_guard) {
        extra.push(`EXISTS (SELECT 1 FROM material_versions rg WHERE rg.id = ? AND rg.reader_status = ? AND COALESCE(rg.reader_token, '') = ?)`);
        extraParams.push(a.version_id, a.reader_guard.status, a.reader_guard.token ?? '');
      }
      for (const k of a.trusted_keys ?? []) {
        extra.push(`EXISTS (SELECT 1 FROM trusted_channels tc WHERE tc.channel_key = ?)`);
        extraParams.push(k);
      }
      if (a.require_auto_publish) {
        extra.push(`(SELECT value FROM settings WHERE key = 'auto_publish') = '1'`);
        // 入口の後に一時停止されても、コミットの時点で一時停止中なら機械は承認しない（契約 V-7 c・d）
        extra.push(`COALESCE((SELECT value FROM settings WHERE key = 'paused'), '0') <> '1'`);
      }
      const P = `EXISTS (${P_APPROVE})${extra.map((e) => ` AND ${e}`).join('')}`;
      const p = [a.version_id, a.material_id, a.verification_id, ...extraParams];
      const out: Stmt[] = [
        stmt(
          `INSERT INTO review_decisions (id, material_version_id, material_id, decision, checklist_json, note, reviewer_email, content_sha256_at_decision, created_at, machine_gate)
           SELECT ?, ?, ?, 'approve', ?, ?, ?, (SELECT content_sha256 FROM material_versions WHERE id = ?), ?, ?
           WHERE ${P}`,
          c.decision_id, a.version_id, a.material_id, a.checklist_json, a.note, a.reviewer_email, a.version_id, c.now, a.machine_gate ?? null, ...p,
        ),
      ];
      // 契約 V-7 e: 確認済みにするチャンネル（承認が 0 行ならチャンネルも足されない: 同じ条件）
      const trust = a.trust_channels ?? [];
      for (const ch of trust) {
        out.push(
          stmt(
            `INSERT OR IGNORE INTO trusted_channels (channel_key, channel_name, channel_url, first_version_id, approved_by, created_at)
             SELECT ?, ?, ?, ?, ?, ? WHERE ${P}`,
            ch.channel_key, ch.channel_name, ch.channel_key, a.version_id, a.reviewer_email, c.now, ...p,
          ),
        );
      }
      if (trust.length > 0) {
        // ほかの確認待ちの版を仕分け直す + 確認済みチャンネルの世代を進める（判定の後に足されたら triageStep の書き込みは GUARD_T で 0 行）
        out.push(stmt(`UPDATE material_versions SET triaged_verification_id = NULL WHERE status = 'review' AND ${P}`, ...p));
        out.push(trustedGenBumpStmt(P, p, c.now));
      }
      out.push(
        stmt(
          `UPDATE materials SET current_version_id = ?, publish_status = 'available', work_status = 'idle', updated_at = ?
           WHERE id = ? AND ${P}`,
          a.version_id, c.now, a.material_id, ...p,
        ),
        // 述語の列（version.status）を変えるのはこの最後の 1 文だけ
        stmt(`UPDATE material_versions SET status = 'approved' WHERE id = ? AND ${P}`, a.version_id, ...p),
      );
      return out;
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
  /** 判断した時の仕分けの gate（契約 V-7 b。review_decisions.machine_gate） */
  machine_gate?: string | null;
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
  /** 契約 V-7 b の GUARD_R: 判定で読んだ読み手係の世代（reader_status と reader_token）が今も同じ */
  guardReader?: ReaderGuard;
  /** 契約 V-7 b の GUARD_T: 判定で読んだ settings trusted_gen が今も同じ */
  guardTrustedGen?: string;
}

/** 差し戻し: review_decisions + standards_log（skipStandardsLog なら無し）+ rework job queued + material queued + version rejected（最後） */
export function buildReturn(a: ReturnArgs, c: BuildCtx & { log_id: string }, o: ReturnOptions = {}): Stmt[] {
  const guarded = typeof o.guardVerificationId === 'string';
  let P = guarded
    ? `${P_RETURN} AND pv.verification_status = 'done'
    AND (SELECT pw.id FROM verifications pw WHERE pw.material_version_id = pv.id ORDER BY pw.attempt DESC LIMIT 1) = ?`
    : P_RETURN;
  const p: SqlValue[] = guarded ? [a.version_id, a.material_id, o.guardVerificationId as string] : [a.version_id, a.material_id];
  if (o.guardReader) {
    P += ` AND pv.reader_status = ? AND COALESCE(pv.reader_token, '') = ?`;
    p.push(o.guardReader.status, o.guardReader.token ?? '');
  }
  if (typeof o.guardTrustedGen === 'string') {
    P += ` AND COALESCE((SELECT value FROM settings WHERE key = 'trusted_gen'), '0') = ?`;
    p.push(o.guardTrustedGen);
  }
  const out: Stmt[] = [
    stmt(
      `INSERT INTO review_decisions (id, material_version_id, material_id, decision, checklist_json, note, reviewer_email, content_sha256_at_decision, created_at, machine_gate)
       SELECT ?, ?, ?, 'return', ?, ?, ?, (SELECT content_sha256 FROM material_versions WHERE id = ?), ?, ?
       WHERE EXISTS (${P})`,
      c.decision_id, a.version_id, a.material_id, a.checklist_json, a.note, a.reviewer_email, a.version_id, c.now, a.machine_gate ?? null, ...p,
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
  /** 判断した時の仕分けの gate（契約 V-7 b。review_decisions.machine_gate） */
  machine_gate?: string | null;
}

/** 却下: review_decisions + standards_log + material idle + version rejected（最後）。publish_status は変えない */
export function buildReject(a: RejectArgs, c: BuildCtx & { log_id: string }): Stmt[] {
  const p = [a.version_id, a.material_id];
  return [
    stmt(
      `INSERT INTO review_decisions (id, material_version_id, material_id, decision, checklist_json, note, reviewer_email, content_sha256_at_decision, created_at, machine_gate)
       SELECT ?, ?, ?, 'reject', ?, ?, ?, (SELECT content_sha256 FROM material_versions WHERE id = ?), ?, ?
       WHERE EXISTS (${P_REJECT})`,
      c.decision_id, a.version_id, a.material_id, a.checklist_json, a.note, a.reviewer_email, a.version_id, c.now, a.machine_gate ?? null, ...p,
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
