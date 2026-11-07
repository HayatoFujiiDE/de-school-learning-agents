// 作り直しの再投入の段（契約 V-13）。session の stop reason retries_exhausted（基盤側の再試行切れ）で failed になった作り直しの job を、
// 同じ brief で 1 回だけ queued に作り直す（起動は次の cron の「1. 起動」）。失敗した job は failed のまま（状態機械は変えない）。
// 有限化: 同じ親の版から作った作り直しが 2 回 retries_exhausted なら作らない。印 last_error = 'auto_retry:…' で二度拾わない。
import { all, cas, errorKind, getSetting, isoPlus, nowIso, stmt } from './db';
import type { Env } from './env';
import { queueJobForMaterial } from './jobs';

/** 印の頭（last_error）。'auto_retry:pending' → 'auto_retry:<新しい job_id>' / 'auto_retry:refused:<code>' */
export const AUTO_RETRY_MARK = 'auto_retry:';
/** これより古い失敗は拾わない */
const RETRY_WINDOW_MS = 24 * 60 * 60_000;
/** 1 回分（D1 の数文）に要る残り時間 */
const MIN_REMAINING_MS = 5_000;

export interface RetryStepResult {
  queued: Array<{ failed_job_id: string; job_id: string }>;
  skipped: Array<{ job_id: string; reason: string }>;
  paused?: true;
}

interface Candidate {
  id: string;
  material_id: string;
  parent_version_id: string;
  brief_md: string;
}

const mark = (env: Env, jobId: string, value: string) =>
  cas(env.DB, stmt(`UPDATE factory_jobs SET last_error = ?, updated_at = ? WHERE id = ? AND last_error = 'auto_retry:pending'`, value, nowIso(), jobId));

export async function retryFailedReworkStep(env: Env, o: { deadline: number }): Promise<RetryStepResult> {
  const db = env.DB;
  if ((await getSetting(db, 'paused')) === '1') return { queued: [], skipped: [], paused: true };
  const out: RetryStepResult = { queued: [], skipped: [] };
  if (o.deadline - Date.now() < MIN_REMAINING_MS) return out;
  const [c] = await all<Candidate>(
    db,
    stmt(
      `SELECT j.id, j.material_id, j.parent_version_id, j.brief_md FROM factory_jobs j
       WHERE j.status = 'failed' AND j.error = 'retries_exhausted' AND j.kind = 'rework' AND j.parent_version_id IS NOT NULL
         AND j.updated_at >= ?
         AND COALESCE(j.last_error, '') NOT LIKE 'auto_retry:%'
         AND NOT EXISTS (SELECT 1 FROM factory_jobs nj WHERE nj.material_id = j.material_id AND nj.created_at > j.created_at)
         AND EXISTS (SELECT 1 FROM materials m WHERE m.id = j.material_id AND m.work_status = 'idle')
         AND (SELECT count(*) FROM factory_jobs fj WHERE fj.parent_version_id = j.parent_version_id AND fj.kind = 'rework' AND fj.status = 'failed' AND fj.error = 'retries_exhausted') < 2
       ORDER BY j.updated_at ASC, j.id ASC LIMIT 1`,
      isoPlus(-RETRY_WINDOW_MS),
    ),
  );
  if (!c) return out;
  // (1) 印を先に付ける（同時に動いた別の tick と二重に作らない）
  const claimed = await cas(
    db,
    stmt(
      `UPDATE factory_jobs SET last_error = 'auto_retry:pending', updated_at = ? WHERE id = ? AND status = 'failed' AND COALESCE(last_error, '') NOT LIKE 'auto_retry:%'`,
      nowIso(),
      c.id,
    ),
  );
  if (!claimed) {
    out.skipped.push({ job_id: c.id, reason: 'raced' });
    return out;
  }
  try {
    // (2) 失敗した job の brief をそのまま（差し戻し理由と「## 追記」はこの中にある）
    const r = await queueJobForMaterial(env, { material_id: c.material_id, kind: 'rework', parent_version_id: c.parent_version_id, brief_md: c.brief_md });
    if (r.status === 201 && typeof r.body.job_id === 'string') {
      const newJobId = r.body.job_id;
      await mark(env, c.id, `${AUTO_RETRY_MARK}${newJobId}`);
      out.queued.push({ failed_job_id: c.id, job_id: newJobId });
      console.log(JSON.stringify({ at: 'auto_retry', job_id: c.id, new_job_id: newJobId }));
    } else {
      const code = typeof r.body.error === 'string' ? r.body.error : `status_${r.status}`;
      await mark(env, c.id, `${AUTO_RETRY_MARK}refused:${code}`);
      out.skipped.push({ job_id: c.id, reason: code });
      console.log(JSON.stringify({ at: 'auto_retry', job_id: c.id, result: code }));
    }
  } catch (e) {
    await mark(env, c.id, `${AUTO_RETRY_MARK}refused:error`).catch(() => undefined);
    out.skipped.push({ job_id: c.id, reason: 'error' });
    console.log(JSON.stringify({ at: 'auto_retry', job_id: c.id, result: 'error', error: errorKind(e) }));
  }
  return out;
}
