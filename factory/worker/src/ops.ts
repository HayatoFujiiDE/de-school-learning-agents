// 運用の依頼箱（契約 §W。docs/plans/ops-requests/contract-W.md）。
// Claude（司令塔）が `wrangler d1 execute` で ops_requests に 1 行書き、cron が 1 tick に 1 件だけ拾う。
// できるのはお題の run と、invalid_outputs で failed になった job の取り込み直し（§W-2。route の POST /api/jobs/:id/reingest と同じ claimReingest。session は作らない・費用なし）。
// お題は手動の route と同じ queueTopicRun を通す（台帳・上限・run_in_progress・trigger 'manual' が同じ）。
// payload は信用しない（形を確かめ、合わなければ failed: bad_payload）。ログに payload の中身（note）は出さない。

import { all, cas, first, isoPlus, nowIso, stmt, tokyoDay } from './db';
import { claimReingest } from './jobs';
import type { Env } from './env';
import { PARENT_ID_RE, type RunRequest } from './topics/gen';
import { queueTopicRun } from './topics/queue-run';
import { addDays } from './topics/schema';
import { isTopicKind } from './topics/store';

const JOB_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** job_reingest の payload: { job_id }（uuid の形だけ）。合わなければ null */
export function parseReingestPayload(raw: string): string | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const p = v as Record<string, unknown>;
  if (Object.keys(p).some((k) => k !== 'job_id')) return null;
  return typeof p.job_id === 'string' && JOB_ID_RE.test(p.job_id) ? p.job_id : null;
}

/** 依頼の寿命。作られてこれを超えた pending は expired */
export const OPS_REQUEST_TTL_MS = 60 * 60_000;
/** derive の note の字数の上限（route の POST /api/topics/:id/derive と同じ） */
const NOTE_MAX = 200;

export type OpsTickResult = {
  expired: number;
  request: { id: string; kind: string; status: 'done' | 'failed'; run_id?: string } | 'none' | 'lost';
};

type OpsRow = { id: string; kind: string; payload_json: string };

const hasOnly = (o: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(o).every((k) => keys.includes(k));

/** payload を確かめて RunRequest にする。合わなければ null（bad_payload）。derive の親は topics に在ること */
export async function parseOpsPayload(db: D1Database, kind: string, raw: string): Promise<RunRequest | null> {
  if (kind !== 'topic_run') return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const p = v as Record<string, unknown>;
  if (p.purpose === 'gen') {
    if (!hasOnly(p, ['purpose', 'kind']) || !isTopicKind(p.kind)) return null;
    return { purpose: 'gen', kind: p.kind, trigger: 'manual', slotDay: addDays(tokyoDay(), 1) };
  }
  if (p.purpose === 'derive') {
    if (!hasOnly(p, ['purpose', 'kind', 'parent_id', 'note'])) return null;
    if (p.kind !== 'refresh' && p.kind !== 'extend') return null;
    if (typeof p.parent_id !== 'string' || !PARENT_ID_RE.test(p.parent_id)) return null;
    if (p.note !== undefined && p.note !== null && (typeof p.note !== 'string' || Array.from(p.note).length > NOTE_MAX)) return null;
    const exists = await first(db, stmt('SELECT 1 AS x FROM topics WHERE id = ?', p.parent_id));
    if (!exists) return null;
    const note = typeof p.note === 'string' && p.note.trim() ? p.note : null;
    return { purpose: 'derive', kind: p.kind, trigger: 'manual', parentId: p.parent_id, note };
  }
  return null;
}

/** taken → done / failed（CAS）。result は id・状態・理由コードだけ（payload の中身は書かない） */
async function finish(db: D1Database, id: string, status: 'done' | 'failed', result: Record<string, unknown>): Promise<boolean> {
  return cas(db, stmt("UPDATE ops_requests SET status = ?, result_json = ?, updated_at = ? WHERE id = ? AND status = 'taken'", status, JSON.stringify(result), nowIso(), id));
}

/**
 * cron から 1 回（お題の段の直前）。(1) 60 分を超えた pending を expired（CAS）(2) pending を古い順に 1 件だけ CAS で取り、
 * 形を確かめて queueTopicRun へ渡し、結果を書いて done / failed にする
 */
export async function opsTick(env: Env, opts: { now?: Date } = {}): Promise<OpsTickResult> {
  const db = env.DB;
  const now = opts.now ?? new Date();
  const t = nowIso(now);
  const exp = await db
    .prepare("UPDATE ops_requests SET status = 'expired', updated_at = ? WHERE status = 'pending' AND created_at < ?")
    .bind(t, isoPlus(-OPS_REQUEST_TTL_MS, now))
    .run();
  const expired = Number(exp.meta?.changes ?? 0);
  if (expired > 0) console.log(JSON.stringify({ at: 'ops_request', status: 'expired', count: expired }));

  const rows = await all<OpsRow>(db, stmt("SELECT id, kind, payload_json FROM ops_requests WHERE status = 'pending' ORDER BY created_at ASC, id ASC LIMIT 1"));
  const row = rows[0];
  if (!row) return { expired, request: 'none' };
  if (!(await cas(db, stmt("UPDATE ops_requests SET status = 'taken', updated_at = ? WHERE id = ? AND status = 'pending'", t, row.id)))) return { expired, request: 'lost' };

  let status: 'done' | 'failed';
  let result: Record<string, unknown>;
  let runId: string | undefined;
  try {
    if (row.kind === 'job_reingest') {
      const jobId = parseReingestPayload(row.payload_json);
      if (!jobId) {
        status = 'failed';
        result = { error: 'bad_payload' };
      } else {
        // failed → running に戻すだけ（次の cron の reconcile が取り込む。route と同じ述語・同じ断り方）
        const refused = await claimReingest(env, jobId);
        if (refused) {
          status = 'failed';
          result = { refused: typeof refused.body.error === 'string' ? refused.body.error : 'refused' };
        } else {
          status = 'done';
          result = { job_id: jobId, status: 'running' };
        }
      }
      await finish(db, row.id, status, result);
      console.log(JSON.stringify({ at: 'ops_request', id: row.id, kind: row.kind, status }));
      return { expired, request: { id: row.id, kind: row.kind, status } };
    }
    const req = await parseOpsPayload(db, row.kind, row.payload_json);
    if (!req) {
      status = 'failed';
      result = { error: 'bad_payload' };
    } else {
      const o = await queueTopicRun(env, req);
      if (o.status === 'queued') {
        runId = o.runId;
        status = 'done';
        result = { run_id: o.runId, status: 'queued' };
      } else if (o.status === 'not_taken') {
        status = 'failed';
        result = { not_taken: o.reason };
      } else {
        status = 'failed';
        result = { error: 'queue_unavailable' };
      }
    }
  } catch (e) {
    status = 'failed';
    result = { error: e instanceof Error ? e.name : 'error' };
  }
  await finish(db, row.id, status, result);
  console.log(JSON.stringify({ at: 'ops_request', id: row.id, kind: row.kind, status, ...(runId ? { run_id: runId } : {}) }));
  return { expired, request: { id: row.id, kind: row.kind, status, ...(runId ? { run_id: runId } : {}) } };
}
