// 版の検証し直し（review の版の verification_status を pending に戻す）。route の POST /api/review/:version_id/reverify と
// 運用の依頼箱の version_reverify（契約 §W-3）が同じ述語・同じ断り方で使う。

import { cas, first, stmt } from './db';

export type ReverifyRefusal = { ok: false; status: 404 | 409; error: 'not_found' | 'not_in_review' | 'verification_running' | 'conflict' };

/**
 * review の版で検証が done / failed なら pending に戻す（attempts 0、verify_* と triaged_verification_id を初期化）。
 * CAS が外れた時は読み直し、pending なら ok（先に誰かが戻した）・running なら verification_running・それ以外は conflict
 */
export async function claimReverify(db: D1Database, vid: string): Promise<{ ok: true } | ReverifyRefusal> {
  const get = () => first<{ status: string; verification_status: string }>(db, stmt('SELECT status, verification_status FROM material_versions WHERE id = ?', vid));
  const v = await get();
  if (!v) return { ok: false, status: 404, error: 'not_found' };
  if (v.status !== 'review') return { ok: false, status: 409, error: 'not_in_review' };
  if (v.verification_status === 'running') return { ok: false, status: 409, error: 'verification_running' };
  const okReset = await cas(
    db,
    stmt(
      `UPDATE material_versions SET verification_status = 'pending', verification_token = NULL, verification_attempts = 0,
         verify_phase = NULL, verify_phase_at = NULL, verify_batch_id = NULL, verify_turn = 0, verify_pauses = 0, verify_micro = 0, verify_collect_errors = 0,
         triaged_verification_id = NULL
       WHERE id = ? AND status = 'review' AND verification_status IN ('done','failed')`,
      vid,
    ),
  );
  if (!okReset) {
    const now2 = await get();
    if (now2?.verification_status === 'pending') return { ok: true };
    return { ok: false, status: 409, error: now2?.verification_status === 'running' ? 'verification_running' : 'conflict' };
  }
  return { ok: true };
}
