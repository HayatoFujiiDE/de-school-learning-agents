// 運用の依頼箱（契約 §W。docs/plans/ops-requests/contract-W.md）。
// Claude（司令塔）が `wrangler d1 execute` で ops_requests に 1 行書き、cron が 1 tick に 1 件だけ拾う。
// できるのはお題の run と、invalid_outputs で failed になった job の取り込み直し（§W-2。route の POST /api/jobs/:id/reingest と同じ claimReingest。session は作らない・費用なし）と、
// review の版の検証し直し（§W-3。route の POST /api/review/:version_id/reverify と同じ claimReverify。検証を pending に戻すだけ）。
// 自動で入った工夫をやめる（§W-4。理由コードだけを受け、人が入れた工夫は止めない）。
// 作り直し（§W-5・§MC-4）: review の版を route の reject と同じ buildReject で却下し（system:ops-redo）、新しい注文票で draft を 1 件 queue する
// （queueJobForMaterial。queued の job は次の tick の起動段が拾う）。brief はログ・result に出さない。
// お題は手動の route と同じ queueTopicRun を通す（台帳・上限・run_in_progress・trigger 'manual' が同じ）。
// payload は信用しない（形を確かめ、合わなければ failed: bad_payload）。ログに payload の中身（note）は出さない。

import { all, cas, conditionalBatch, first, isoPlus, nowIso, stmt, tokyoDay } from './db';
import { claimReingest, queueJobForMaterial } from './jobs';
import { buildReject } from './publish';
import { computeTriage, latestVerificationOf, type TriageVersionRow } from './triage-step';
import { claimReverify } from './reverify';
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

/** version_reverify の payload: { version_id }（uuid の形だけ。§W-3）。合わなければ null */
export function parseReverifyPayload(raw: string): string | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const p = v as Record<string, unknown>;
  if (Object.keys(p).some((k) => k !== 'version_id')) return null;
  return typeof p.version_id === 'string' && JOB_ID_RE.test(p.version_id) ? p.version_id : null;
}

/** material_redo の brief_md の長さの上限（§MC-4 1。文字 = code point。道具 scripts/ops-request.sh と同じ数え方） */
export const REDO_BRIEF_MAX_CHARS = 32768;
/** material_redo の却下の reviewer_email と note（§MC-4 2。verbatim） */
export const REDO_REVIEWER_EMAIL = 'system:ops-redo';
export const REDO_REJECT_NOTE = 'オーナー指示: Java 版の最新を前提に作り直すため、この版を却下';

/** material_redo の payload: { material_id, brief_md }（key はこの 2 つだけ。uuid の形・brief は 1〜32768 文字）。合わなければ null */
export function parseRedoPayload(raw: string): { materialId: string; briefMd: string } | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const p = v as Record<string, unknown>;
  if (Object.keys(p).some((k) => k !== 'material_id' && k !== 'brief_md')) return null;
  if (typeof p.material_id !== 'string' || !JOB_ID_RE.test(p.material_id)) return null;
  if (typeof p.brief_md !== 'string') return null;
  const n = Array.from(p.brief_md).length;
  if (n < 1 || n > REDO_BRIEF_MAX_CHARS) return null;
  return { materialId: p.material_id, briefMd: p.brief_md };
}

/**
 * 作り直し（§MC-4 2）。review なら最新の review の版を却下（CAS が通らなければ failed conflict）→ idle なら draft を queue。
 * queued / making は却下せず refused material_busy（done）。queue が断られたら refused（done。却下は済んでいるので出し直すと queue だけ走る）
 */
async function redoMaterial(env: Env, materialId: string, briefMd: string): Promise<{ status: 'done' | 'failed'; result: Record<string, unknown> }> {
  const db = env.DB;
  const m = await first<{ work_status: string }>(db, stmt('SELECT work_status FROM materials WHERE id = ?', materialId));
  if (!m) return { status: 'failed', result: { refused: 'not_found' } };
  let rejectedVersionId: string | null = null;
  if (m.work_status === 'review') {
    const v = await first<TriageVersionRow>(db, stmt("SELECT * FROM material_versions WHERE material_id = ? AND status = 'review' ORDER BY version DESC LIMIT 1", materialId));
    if (!v) return { status: 'failed', result: { refused: 'conflict' } };
    // route の reject と同じ組: 判断した時の仕分けの gate を machine_gate に入れる（契約 V-8）
    const machineGate = (await computeTriage(env, v, await latestVerificationOf(db, v.id))).gate;
    const r = await conditionalBatch(
      db,
      buildReject(
        { material_id: materialId, version_id: v.id, reviewer_email: REDO_REVIEWER_EMAIL, checklist_json: '{}', note: REDO_REJECT_NOTE, machine_gate: machineGate },
        { decision_id: crypto.randomUUID(), now: nowIso(), log_id: crypto.randomUUID() },
      ),
    );
    if (!r.ok) return { status: 'failed', result: { refused: 'conflict' } };
    rejectedVersionId = v.id;
  } else if (m.work_status !== 'idle') {
    return { status: 'done', result: { refused: 'material_busy' } };
  }
  const q = await queueJobForMaterial(env, { material_id: materialId, kind: 'draft', parent_version_id: null, brief_md: briefMd });
  const jobId = q.body.job_id;
  if (q.status !== 201 || typeof jobId !== 'string') return { status: 'done', result: { refused: typeof q.body.error === 'string' ? q.body.error : 'refused' } };
  console.log(JSON.stringify({ at: 'material_redo', material_id: materialId, job_id: jobId, rejected_version_id: rejectedVersionId }));
  return { status: 'done', result: { material_id: materialId, job_id: jobId, rejected_version_id: rejectedVersionId } };
}

/** tip_retire の理由コード（§W-4）。自由文は受けない。retire_reason には 'ops:<code>' で書く */
export const TIP_RETIRE_REASONS = ['factory_fault'] as const;
export type TipRetireReason = (typeof TIP_RETIRE_REASONS)[number];

/** tip_retire の payload: { tip_id, reason }（uuid の形と理由コードだけ）。合わなければ null */
export function parseTipRetirePayload(raw: string): { tipId: string; reason: TipRetireReason } | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const p = v as Record<string, unknown>;
  if (Object.keys(p).some((k) => k !== 'tip_id' && k !== 'reason')) return null;
  if (typeof p.tip_id !== 'string' || !JOB_ID_RE.test(p.tip_id)) return null;
  if (typeof p.reason !== 'string' || !(TIP_RETIRE_REASONS as readonly string[]).includes(p.reason)) return null;
  return { tipId: p.tip_id, reason: p.reason as TipRetireReason };
}

/**
 * 自動で入った（decided_by = 'auto'）active の工夫だけを retired にする（CAS）。人が入れた工夫は AI からは止めない（管理画面の「やめる」だけ）
 */
async function retireAutoTip(db: D1Database, tipId: string, reason: TipRetireReason): Promise<{ ok: true } | { ok: false; error: string }> {
  const t = nowIso();
  const ok = await cas(
    db,
    stmt("UPDATE retro_tips SET status = 'retired', retired_at = ?, retire_reason = ?, updated_at = ? WHERE id = ? AND status = 'active' AND decided_by = 'auto'", t, `ops:${reason}`, t, tipId),
  );
  if (ok) return { ok: true };
  const row = await first<{ status: string; decided_by: string | null }>(db, stmt('SELECT status, decided_by FROM retro_tips WHERE id = ?', tipId));
  if (!row) return { ok: false, error: 'not_found' };
  if (row.status !== 'active') return { ok: false, error: 'not_active' };
  return { ok: false, error: 'not_auto' };
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
    if (row.kind === 'version_reverify') {
      const versionId = parseReverifyPayload(row.payload_json);
      if (!versionId) {
        status = 'failed';
        result = { error: 'bad_payload' };
      } else {
        // 検証を pending に戻すだけ（次の cron の検証の段が走る。route の reverify と同じ述語・同じ断り方。§W-3）
        const r = await claimReverify(db, versionId);
        if (!r.ok) {
          status = 'failed';
          result = { refused: r.error };
        } else {
          status = 'done';
          result = { version_id: versionId, verification_status: 'pending' };
        }
      }
      await finish(db, row.id, status, result);
      console.log(JSON.stringify({ at: 'ops_request', id: row.id, kind: row.kind, status }));
      return { expired, request: { id: row.id, kind: row.kind, status } };
    }
    if (row.kind === 'tip_retire') {
      const p = parseTipRetirePayload(row.payload_json);
      if (!p) {
        status = 'failed';
        result = { error: 'bad_payload' };
      } else {
        const r = await retireAutoTip(db, p.tipId, p.reason);
        if (!r.ok) {
          status = 'failed';
          result = { refused: r.error };
        } else {
          status = 'done';
          result = { tip_id: p.tipId, status: 'retired' };
        }
      }
      await finish(db, row.id, status, result);
      console.log(JSON.stringify({ at: 'ops_request', id: row.id, kind: row.kind, status }));
      return { expired, request: { id: row.id, kind: row.kind, status } };
    }
    if (row.kind === 'material_redo') {
      const p = parseRedoPayload(row.payload_json);
      if (!p) {
        status = 'failed';
        result = { error: 'bad_payload' };
      } else {
        ({ status, result } = await redoMaterial(env, p.materialId, p.briefMd));
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
