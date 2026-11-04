// GET /api/floor（契約 §N-1）。工場ビューの集約。読み取り専用・副作用なし。
// SQL: 制作キュー 1 文（素材 LEFT JOIN active / 最後の job、review / current の版）+ 持ち場の集計 1 文（stations.rework を含む）
// + 収集の lock（scoutRunning）+ 今日の費用。
// review の版だけ computeTriage（listReview と同じ: 版ごとに最新 verification・sources を読む）、queue の rework job だけ isAutoDerived を呼ぶ。
// 応答に brief_md・questions 本文・answers・token 類は含めない。
import { all, first, isoPlus, nowIso, stmt } from '../db';
import { cfg } from '../env';
import { floorRowMoving, floorSteps, type FloorAttention, type FloorResult } from '../floor';
import { json, parseJsonField, type RouteCtx } from '../http';
import { todayCostCents } from '../jobs';
import { AUTO_ITEMS } from '../checks/triage';
import { scoutRunning } from '../scout';
import { AUTO_TRIAGE_EMAIL, computeTriage, isAutoDerived, latestVerificationOf } from '../triage-step';

const DAY_MS = 24 * 60 * 60 * 1000;
const QUEUE_LIMIT = 100;
const ACTIVE = "('queued','creating','running','needs_answer','budget_reached')";

interface QueueRow {
  m_id: string;
  m_slug: string;
  m_title: string;
  m_kinds_json: string;
  m_work_status: string;
  m_publish_status: string;
  m_updated_at: string;
  j_id: string | null;
  j_status: string | null;
  j_phase: string | null;
  j_kind: string | null;
  j_error: string | null;
  j_last_error: string | null;
  j_reconcile_stage: string | null;
  j_has_questions: number | null;
  j_parent_version_id: string | null;
  j_parent_version: number | null;
  v_id: string | null;
  v_version: number | null;
  v_status: string | null;
  v_verification_status: string | null;
  v_verify_phase: string | null;
  v_verify_turn: number | null;
  v_job_id: string | null;
  v_claims_json: string | null;
  v_checks_json: string | null;
  v_material_json: string | null;
  v_auto_reverified: number | null;
  last_decision: string | null;
}

interface StationRow {
  paused: string | null;
  paused_note: string | null;
  proposed: number;
  last_scout_at: string | null;
  last_meeting_at: string | null;
  meeting_pending: number;
  j_queued: number;
  j_creating: number;
  j_running: number;
  j_needs_answer: number;
  j_budget_reached: number;
  j_ingesting: number;
  j_failed_invalid_outputs: number;
  v_pending: number;
  v_running: number;
  v_failed: number;
  v_done: number;
  lib_available: number;
  lib_stopped: number;
  rw_auto_active: number;
  rw_manual_active: number;
}

export async function getFloor(c: RouteCtx): Promise<Response> {
  const db = c.env.DB;
  const now = new Date();
  const since = isoPlus(-DAY_MS, now);

  // 制作キュー: 動いている素材（work_status != idle）を先に、次に 24 時間以内に更新された素材
  const rows = await all<QueueRow>(
    db,
    stmt(
      `SELECT m.id AS m_id, m.slug AS m_slug, m.title AS m_title, m.kinds_json AS m_kinds_json, m.work_status AS m_work_status,
              m.publish_status AS m_publish_status, m.updated_at AS m_updated_at,
              j.id AS j_id, j.status AS j_status, j.phase AS j_phase, j.kind AS j_kind, j.error AS j_error, j.last_error AS j_last_error,
              j.reconcile_stage AS j_reconcile_stage, (j.questions_json IS NOT NULL) AS j_has_questions, j.parent_version_id AS j_parent_version_id,
              (SELECT pv.version FROM material_versions pv WHERE pv.id = j.parent_version_id) AS j_parent_version,
              v.id AS v_id, v.version AS v_version, v.status AS v_status, v.verification_status AS v_verification_status,
              v.verify_phase AS v_verify_phase, v.verify_turn AS v_verify_turn, v.job_id AS v_job_id,
              CASE WHEN v.status = 'review' THEN v.claims_json END AS v_claims_json,
              CASE WHEN v.status = 'review' THEN v.checks_json END AS v_checks_json,
              CASE WHEN v.status = 'review' THEN v.material_json END AS v_material_json,
              v.auto_reverified AS v_auto_reverified,
              (SELECT d.decision FROM review_decisions d WHERE d.material_id = m.id AND d.decision IN ('approve','reject','return')
                 ORDER BY d.created_at DESC LIMIT 1) AS last_decision
       FROM materials m
       LEFT JOIN factory_jobs j ON j.id = COALESCE(
         (SELECT a.id FROM factory_jobs a WHERE a.material_id = m.id AND a.status IN ${ACTIVE} LIMIT 1),
         (SELECT b.id FROM factory_jobs b WHERE b.material_id = m.id AND b.updated_at >= ?
            AND b.id = (SELECT x.id FROM factory_jobs x WHERE x.material_id = m.id ORDER BY x.created_at DESC, x.id DESC LIMIT 1)))
       LEFT JOIN material_versions v ON v.id = COALESCE(
         (SELECT r.id FROM material_versions r WHERE r.material_id = m.id AND r.status = 'review' ORDER BY r.version DESC LIMIT 1),
         m.current_version_id)
       WHERE m.work_status <> 'idle' OR m.updated_at >= ?
       ORDER BY (m.work_status <> 'idle') DESC, m.updated_at DESC, m.id ASC
       LIMIT ${QUEUE_LIMIT}`,
      since,
      since,
    ),
  );

  let needsReviewTotal = 0;
  const built: Array<{ row: Record<string, unknown>; r: FloorResult; group: number; updated_at: string }> = [];
  for (const q of rows) {
    // review の版だけ仕分けを計算する（listReview と同じ computeTriage）
    let needsReview: number | null = null;
    let autoOk: number | null = null;
    if (q.v_id && q.v_status === 'review') {
      const t = await computeTriage(
        db,
        {
          id: q.v_id,
          material_id: q.m_id,
          version: Number(q.v_version ?? 0),
          job_id: q.v_job_id ?? '',
          claims_json: q.v_claims_json ?? '',
          checks_json: q.v_checks_json ?? '',
          material_json: q.v_material_json ?? '',
          auto_reverified: Number(q.v_auto_reverified ?? 0),
        },
        await latestVerificationOf(db, q.v_id),
      );
      needsReview = t.needs_review;
      autoOk = AUTO_ITEMS.filter((k) => t.auto[k] === 'ok').length;
      if (q.v_verification_status === 'done') needsReviewTotal += t.needs_review;
    }
    // 自動差し戻し由来か（draft は parent_version_id を持たないので false）
    const autoRework = !!q.j_id && q.j_kind === 'rework' && !!q.j_parent_version_id ? await isAutoDerived(db, q.j_id) : false;
    const lastDecision = q.last_decision === 'approve' || q.last_decision === 'reject' || q.last_decision === 'return' ? q.last_decision : null;
    const r = floorSteps({
      material: { work_status: q.m_work_status, publish_status: q.m_publish_status },
      job: q.j_id
        ? {
            status: q.j_status ?? '',
            phase: q.j_phase ?? '',
            kind: q.j_kind ?? '',
            error: q.j_error,
            reconcile_stage: q.j_reconcile_stage ?? 'none',
            has_questions: Number(q.j_has_questions ?? 0) === 1,
            auto_rework: autoRework,
          }
        : null,
      version: q.v_id
        ? {
            status: q.v_status ?? '',
            verification_status: q.v_verification_status ?? '',
            verify_phase: q.v_verify_phase,
            verify_turn: Number(q.v_verify_turn ?? 0),
            needs_review: needsReview,
          }
        : null,
      last_decision: lastDecision,
    });
    const jobActive = !!q.j_status && ['queued', 'creating', 'running', 'needs_answer', 'budget_reached'].includes(q.j_status);
    const group = r.attention ? 0 : floorRowMoving(r, jobActive) ? 1 : 2;
    built.push({
      group,
      updated_at: q.m_updated_at,
      r,
      row: {
        material: {
          id: q.m_id,
          slug: q.m_slug,
          title: q.m_title,
          kinds: parseJsonField(q.m_kinds_json, []),
          work_status: q.m_work_status,
          publish_status: q.m_publish_status,
          updated_at: q.m_updated_at,
        },
        job: q.j_id
          ? {
              id: q.j_id,
              status: q.j_status,
              phase: q.j_phase,
              kind: q.j_kind,
              error: q.j_error,
              last_error: q.j_last_error,
              auto_rework: autoRework,
              parent_version: q.j_parent_version === null || q.j_parent_version === undefined ? null : Number(q.j_parent_version),
            }
          : null,
        version: q.v_id
          ? {
              id: q.v_id,
              version: q.v_version,
              status: q.v_status,
              verification_status: q.v_verification_status,
              verify_phase: q.v_verify_phase,
              verify_turn: Number(q.v_verify_turn ?? 0),
              needs_review: needsReview,
              auto_ok: autoOk,
            }
          : null,
        steps: r.steps,
        progress_pct: r.progress_pct,
        attention: r.attention,
      },
    });
  }
  // 並び: attention あり → 動いている → 最近終わった。群の中は更新の新しい順
  built.sort((a, b) => a.group - b.group || (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0));
  const attention = { answer: 0, review: 0, failed: 0, budget: 0 };
  for (const b of built) {
    const a: FloorAttention = b.r.attention;
    if (a) attention[a] += 1;
  }

  // 持ち場の集計（job は factory_jobs、版は material_versions の review だけ、提案は proposals.status='proposed'）
  const s = await first<StationRow>(
    db,
    stmt(
      `SELECT (SELECT value FROM settings WHERE key = 'paused') AS paused,
              (SELECT value FROM settings WHERE key = 'paused_note') AS paused_note,
              (SELECT COUNT(*) FROM proposals WHERE status = 'proposed') AS proposed,
              (SELECT started_at FROM scout_runs ORDER BY started_at DESC LIMIT 1) AS last_scout_at,
              (SELECT created_at FROM meeting_minutes ORDER BY created_at DESC LIMIT 1) AS last_meeting_at,
              (SELECT COUNT(*) FROM meeting_minutes WHERE status = 'submitted') AS meeting_pending,
              (SELECT COUNT(*) FROM factory_jobs WHERE status = 'queued') AS j_queued,
              (SELECT COUNT(*) FROM factory_jobs WHERE status = 'creating') AS j_creating,
              (SELECT COUNT(*) FROM factory_jobs WHERE status = 'running') AS j_running,
              (SELECT COUNT(*) FROM factory_jobs WHERE status = 'needs_answer') AS j_needs_answer,
              (SELECT COUNT(*) FROM factory_jobs WHERE status = 'budget_reached') AS j_budget_reached,
              (SELECT COUNT(*) FROM factory_jobs WHERE status = 'running' AND reconcile_stage <> 'none') AS j_ingesting,
              (SELECT COUNT(*) FROM factory_jobs f WHERE f.status = 'failed' AND f.error = 'invalid_outputs'
                 AND NOT EXISTS (SELECT 1 FROM factory_jobs n WHERE n.material_id = f.material_id AND n.created_at > f.created_at)) AS j_failed_invalid_outputs,
              (SELECT COUNT(*) FROM material_versions WHERE status = 'review' AND verification_status = 'pending') AS v_pending,
              (SELECT COUNT(*) FROM material_versions WHERE status = 'review' AND verification_status = 'running') AS v_running,
              (SELECT COUNT(*) FROM material_versions WHERE status = 'review' AND verification_status = 'failed') AS v_failed,
              (SELECT COUNT(*) FROM material_versions WHERE status = 'review' AND verification_status = 'done') AS v_done,
              (SELECT COUNT(*) FROM materials WHERE publish_status = 'available') AS lib_available,
              (SELECT COUNT(*) FROM materials WHERE publish_status = 'stopped') AS lib_stopped,
              -- §N-6-6 stations.rework: active な rework job を、isAutoDerived と同じ条件（親の版に自動仕分けの return がある）で分ける
              (SELECT COUNT(*) FROM factory_jobs r WHERE r.kind = 'rework' AND r.status IN ${ACTIVE}
                 AND EXISTS (SELECT 1 FROM review_decisions d WHERE d.material_version_id = r.parent_version_id
                               AND d.decision = 'return' AND d.reviewer_email = ?)) AS rw_auto_active,
              (SELECT COUNT(*) FROM factory_jobs r WHERE r.kind = 'rework' AND r.status IN ${ACTIVE}
                 AND NOT EXISTS (SELECT 1 FROM review_decisions d WHERE d.material_version_id = r.parent_version_id
                                   AND d.decision = 'return' AND d.reviewer_email = ?)) AS rw_manual_active`,
      AUTO_TRIAGE_EMAIL,
      AUTO_TRIAGE_EMAIL,
    ),
  );
  const k = cfg(c.env);
  const n = (x: unknown) => Number(x ?? 0);
  return json(200, {
    now: nowIso(now),
    paused: s?.paused === '1',
    paused_note: s?.paused_note ?? null,
    cost: { today_cents: await todayCostCents(db), daily_cap_cents: k.dailyCapCents },
    attention,
    stations: {
      intake: {
        proposed: n(s?.proposed),
        scout_running: await scoutRunning(db, now),
        meeting_pending: n(s?.meeting_pending) > 0,
        last_scout_at: s?.last_scout_at ?? null,
        last_meeting_at: s?.last_meeting_at ?? null,
      },
      maker: {
        queued: n(s?.j_queued),
        creating: n(s?.j_creating),
        running: n(s?.j_running),
        needs_answer: n(s?.j_needs_answer),
        budget_reached: n(s?.j_budget_reached),
        max_concurrent: k.maxConcurrent,
      },
      clerk: { ingesting: n(s?.j_ingesting), failed_invalid_outputs: n(s?.j_failed_invalid_outputs) },
      verifier: { pending: n(s?.v_pending), running: n(s?.v_running), failed: n(s?.v_failed) },
      reviewer: { waiting: n(s?.v_done), needs_review_total: needsReviewTotal },
      library: { available: n(s?.lib_available), stopped: n(s?.lib_stopped) },
      rework: { auto_active: n(s?.rw_auto_active), manual_active: n(s?.rw_manual_active) },
    },
    queue: built.map((b) => b.row),
  });
}
