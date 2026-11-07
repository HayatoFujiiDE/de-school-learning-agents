// /api/review（契約 §B-3, §B-6, §G-2）
import { all, cas, conditionalBatch, first, isUniqueViolation, nowIso, stmt, tokyoDay } from '../db';
import { JOB_MODEL, cfg, consoleUrl } from '../env';
import { isNonEmptyString, json, parseJsonField, readBody, type RouteCtx } from '../http';
import { getJob, startJob } from '../jobs';
import { buildReject, buildReturn, buildReworkBrief, CHECKLIST_KEYS, publishSwitch } from '../publish';
import { AUTO_ITEMS, type AutoItem } from '../checks/triage';
import { computeTriage, latestVerificationOf } from '../triage-step';
import { generatedImagesOf } from './images';
import { serveVersionFile } from './library';
import { readVersionVideoNotes, readVideoMetaViews, versionVideosOf, type VideoMetaView, type VideoNotesFile } from '../videos';

// 観点の一覧は publish.ts に置く（振り返り係 §S が同じ一覧で差し戻しの観点を数える。route を import しない）
export { CHECKLIST_KEYS };

interface VersionRow {
  id: string;
  material_id: string;
  version: number;
  job_id: string;
  session_id: string;
  r2_prefix: string;
  content_sha256: string;
  material_json: string;
  claims_json: string;
  adapt_rules_md: string;
  selfcheck_md: string | null;
  grader_result: string | null;
  grader_explanation: string | null;
  checks_json: string;
  public_paths_json: string;
  tech_dependencies_json: string;
  status: string;
  verification_status: string;
  verification_attempts: number;
  verification_started_at: string | null;
  list_cost_cents: number;
  auto_reverified: number;
  created_at: string;
}
interface VerificationRow {
  id: string;
  attempt: number;
  model: string;
  claims_total: number;
  confirmed: number;
  hypothesis: number;
  unverified: number;
  contradicted: number;
  result_json: string;
  cost_cents: number;
  created_at: string;
}

const getVersion = (db: D1Database, id: string) => first<VersionRow>(db, stmt('SELECT * FROM material_versions WHERE id = ?', id));
const latestVerification = (db: D1Database, vid: string) =>
  first<VerificationRow>(db, stmt('SELECT * FROM verifications WHERE material_version_id = ? ORDER BY attempt DESC LIMIT 1', vid));
const hasActiveJob = async (db: D1Database, mid: string) =>
  !!(await first(db, stmt("SELECT 1 AS x FROM factory_jobs WHERE material_id = ? AND status IN ('queued','creating','running','needs_answer','budget_reached')", mid)));

export async function listReview(c: RouteCtx): Promise<Response> {
  const db = c.env.DB;
  const rows = await all<Record<string, unknown> & { version_id: string; created_at: string }>(
    db,
    stmt(
      `SELECT v.id AS version_id, v.material_id, v.version, v.verification_status, v.created_at, m.title, m.slug, m.publish_status
       FROM material_versions v JOIN materials m ON m.id = v.material_id
       WHERE v.status = 'review' ORDER BY v.created_at ASC`,
    ),
  );
  // §L-5: 各行に needs_review / auto_ok を足し、needs_review の多い順 → 作成の古い順
  const out: Array<Record<string, unknown> & { needs_review: number; auto_ok: number; created_at: string; version_id: string }> = [];
  for (const r of rows) {
    const v = await getVersion(db, r.version_id);
    if (!v) continue;
    const t = await computeTriage(db, v, await latestVerificationOf(db, v.id));
    out.push({ ...r, needs_review: t.needs_review, auto_ok: AUTO_ITEMS.filter((k) => t.auto[k] === 'ok').length });
  }
  out.sort((a, b) => b.needs_review - a.needs_review || (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0) || (a.version_id < b.version_id ? -1 : a.version_id > b.version_id ? 1 : 0));
  return json(200, { versions: out });
}

export async function reviewDetail(c: RouteCtx, vid: string): Promise<Response> {
  const db = c.env.DB;
  const v = await getVersion(db, vid);
  if (!v) return json(404, { error: 'not_found' });
  const m = await first<Record<string, unknown>>(
    db,
    stmt('SELECT id, slug, title, kinds_json, work_status, publish_status, current_version_id FROM materials WHERE id = ?', v.material_id),
  );
  const job = await getJob(db, v.job_id);
  const sources = await all(
    db,
    stmt(
      'SELECT source_id, url, title, accessed_at, quoted_excerpt, license, is_primary, url_was_fetched, quote_found, check_detail FROM sources WHERE material_version_id = ? ORDER BY source_id',
      vid,
    ),
  );
  const ver = await latestVerification(db, vid);
  const report = ver
    ? parseJsonField<{
        verdicts?: Array<{ claim_id: string; verdict: string; reason: string; opened_urls: string[] }>;
        overall_note?: string;
        figures?: unknown;
        analogy_gaps?: unknown;
        videos?: unknown;
      }>(ver.result_json, {})
    : null;
  const claims = parseJsonField<{ claims?: Array<Record<string, unknown>> }>(v.claims_json, {}).claims ?? [];
  const history = await all<{ id: string; attempt: number; contradicted: number; created_at: string }>(
    db,
    stmt('SELECT id, attempt, contradicted, created_at FROM verifications WHERE material_version_id = ? ORDER BY attempt ASC', vid),
  );
  // 同期の記帳（ref_id = 版の id）と Batch のターンごとの記帳・見積り（ref_id = vb:{版の id}:…）の両方（§L-5）、
  // 動画の記録の取り置き（ref_id = vv:{版の id}:{動画 id}。§Q-9.7）
  const verifyCost = await first<{ c: number | null }>(
    db,
    stmt("SELECT SUM(cents) AS c FROM cost_ledger WHERE kind = 'verify' AND (ref_id = ? OR ref_id GLOB 'vb:' || ? || ':*' OR ref_id GLOB 'vv:' || ? || ':*')", vid, vid, vid),
  );
  const triage = await computeTriage(db, v, ver ? { id: ver.id, result_json: ver.result_json } : null);
  // 検証待ちの理由（§L-6 1.・§L-2 3-2）。読んだ時点の停止・飛行中・日次で決める表示用の値（判定は提出段の 1 文が正本）
  const phaseRow = await first<{ verify_phase: string | null }>(db, stmt('SELECT verify_phase FROM material_versions WHERE id = ?', vid));
  const verifyPhase = phaseRow?.verify_phase ?? null;
  let verifyWaitReason: 'paused' | 'daily_cap' | 'inflight' | null = null;
  if (v.verification_status === 'running' && verifyPhase === 'to_submit') {
    const cf = cfg(c.env);
    const w = await first<{ paused: string | null; inflight: number; today: number | null }>(
      db,
      stmt(
        `SELECT (SELECT value FROM settings WHERE key = 'paused') AS paused,
                (SELECT COUNT(*) FROM material_versions WHERE verify_phase IN ('submitting','submitted','collecting')) AS inflight,
                (SELECT SUM(cents) FROM cost_ledger WHERE day = ?) AS today`,
        tokyoDay(),
      ),
    );
    if (w?.paused === '1') verifyWaitReason = 'paused';
    else if ((w?.inflight ?? 0) >= cf.verifyInflight) verifyWaitReason = 'inflight';
    else if ((w?.today ?? 0) + cf.verifyTurnReserveCents * ((w?.inflight ?? 0) + 1) > cf.dailyCapCents) verifyWaitReason = 'daily_cap';
  }
  const material = parseJsonField<unknown>(v.material_json, null);
  // 生成した画像の情報（§O-7 6。prompt は認証済みの運営にだけ返す）
  const generatedImages = await generatedImagesOf(db, v.job_id, material);
  // §Q-5・§Q-10 9: 版の動画の記録（v1 の video-notes.json か、呼び出しの記録から組み立てたもの。何も無い・読めなければ null）
  const videoNotes = await readVideoNotes(c.env.R2, v.r2_prefix, v.material_json);
  // §Q-11 8: 版の動画ごとの公式の情報（記録を読むだけ。oEmbed を呼ばず、呼び出しの数も増やさない）。動画の無い版は []
  const videoMeta = await readVideoMeta(c.env.R2, v.r2_prefix, v.material_json);
  return json(200, {
    version: {
      id: v.id,
      material_id: v.material_id,
      version: v.version,
      job_id: v.job_id,
      session_id: v.session_id,
      status: v.status,
      verification_status: v.verification_status,
      verification_attempts: v.verification_attempts,
      verify_phase: verifyPhase,
      verify_wait_reason: verifyWaitReason,
      content_sha256: v.content_sha256,
      grader_result: v.grader_result,
      grader_explanation: v.grader_explanation,
      list_cost_cents: v.list_cost_cents,
      created_at: v.created_at,
      material,
      checks: parseJsonField(v.checks_json, null),
      public_paths: parseJsonField(v.public_paths_json, []),
      tech_dependencies: parseJsonField(v.tech_dependencies_json, []),
      adapt_rules_md: v.adapt_rules_md,
      selfcheck_md: v.selfcheck_md,
    },
    material: m ? { ...m, kinds: parseJsonField(m.kinds_json, []) } : null,
    job: job ? { id: job.id, kind: job.kind, model: job.model, list_cost_cents: job.list_cost_cents, console_url: consoleUrl(c.env, job.session_id) } : null,
    sources,
    claims: claims.map((cl) => {
      const verdict = report?.verdicts?.find((x) => x.claim_id === cl.id);
      return { ...cl, verdict: verdict?.verdict ?? null, reason: verdict?.reason ?? null, opened_urls: verdict?.opened_urls ?? [] };
    }),
    verification: ver
      ? {
          id: ver.id,
          attempt: ver.attempt,
          model: ver.model,
          claims_total: ver.claims_total,
          confirmed: ver.confirmed,
          hypothesis: ver.hypothesis,
          unverified: ver.unverified,
          contradicted: ver.contradicted,
          overall_note: report?.overall_note ?? null,
          // §O-12 d: 図ごとの判定（result_json に figures が無い古い検証は null）
          figures: figuresOf(report?.figures),
          // §P c 5: たとえのずれ（result_json に analogy_gaps が無い古い検証は null）
          analogy_gaps: analogyGapsOf(report?.analogy_gaps),
          // §Q-5: 動画ごとの判定（result_json に videos が無い古い検証は null）
          videos: videoVerdictsOf(report?.videos),
          cost_cents: ver.cost_cents,
          created_at: ver.created_at,
        }
      : null,
    verification_id: ver?.id ?? null,
    verification_history: history,
    verify_cost_cents: Number(verifyCost?.c ?? 0),
    triage,
    generated_images: generatedImages,
    video_notes: videoNotes,
    video_meta: videoMeta,
  });
}

/** 版の動画の公式の情報（§Q-11 8）。記録の無い・読めない動画は outcome unknown */
async function readVideoMeta(r2: R2Bucket, prefix: string, materialJson: string): Promise<VideoMetaView[]> {
  const videos = versionVideosOf(materialJson);
  if (videos.length === 0) return [];
  try {
    return await readVideoMetaViews(r2, prefix, videos);
  } catch {
    return videos.map((x) => ({ video_id: x.id, outcome: 'unknown', title: null, author_name: null, author_url: null, channel_match: 'unknown' }));
  }
}

/** result_json の videos → API の形（{id, verdict, reason}[]）。配列でなければ null（§Q-5） */
function videoVerdictsOf(raw: unknown): Array<{ id: string; verdict: string; reason: string }> | null {
  if (!Array.isArray(raw)) return null;
  return (raw as Array<Record<string, unknown> | null>)
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && typeof x.id === 'string')
    .map((x) => ({ id: x.id as string, verdict: typeof x.verdict === 'string' ? x.verdict : '', reason: typeof x.reason === 'string' ? x.reason : '' }));
}

/** 版の動画の記録（§Q-10 9 の readVersionVideoNotes。検証係の入力と同じ関数）。記録が 1 つも無い・読めない・形が違えば null */
async function readVideoNotes(r2: R2Bucket, prefix: string, materialJson: string): Promise<VideoNotesFile | null> {
  try {
    return (await readVersionVideoNotes(r2, prefix, versionVideosOf(materialJson))).file;
  } catch {
    return null;
  }
}

/** result_json の figures → API の形（{path, verdict, reason}[]）。配列でなければ null（§O-12 d） */
function figuresOf(raw: unknown): Array<{ path: string; verdict: string; reason: string }> | null {
  if (!Array.isArray(raw)) return null;
  return (raw as Array<Record<string, unknown> | null>)
    .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object' && typeof f.path === 'string')
    .map((f) => ({ path: f.path as string, verdict: typeof f.verdict === 'string' ? f.verdict : '', reason: typeof f.reason === 'string' ? f.reason : '' }));
}

/** result_json の analogy_gaps → API の形（{claim_id, where, analogy, same, differs}[]）。配列でなければ null（§P c 5） */
function analogyGapsOf(raw: unknown): Array<{ claim_id: string; where: string; analogy: string; same: string; differs: string }> | null {
  if (!Array.isArray(raw)) return null;
  const str = (x: unknown) => (typeof x === 'string' ? x : '');
  return (raw as unknown[])
    .filter((g): g is Record<string, unknown> => !!g && typeof g === 'object')
    .map((g) => ({ claim_id: str(g.claim_id), where: str(g.where), analogy: str(g.analogy), same: str(g.same), differs: str(g.differs) }));
}

export async function reviewFile(c: RouteCtx, vid: string, rawPath: string): Promise<Response> {
  const row = await first<{ r2_prefix: string; public_paths_json: string }>(
    c.env.DB,
    stmt('SELECT r2_prefix, public_paths_json FROM material_versions WHERE id = ?', vid),
  );
  return serveVersionFile(c.env, row, rawPath);
}

/** autoOk の項目は省略可（省略時は {"result":"ok","note":"auto"} を記録する §L-5）。それ以外は必須 */
function checkChecklist(raw: unknown, autoOk: ReadonlySet<string> = new Set()): { ok: true; json: string; hasNg: boolean } | { ok: false } {
  const o = raw as Record<string, unknown> | null;
  if (!o || typeof o !== 'object') return { ok: false };
  const out: Record<string, { result: string; note: string }> = {};
  let hasNg = false;
  for (const k of CHECKLIST_KEYS) {
    const item = Object.prototype.hasOwnProperty.call(o, k) ? (o[k] as Record<string, unknown> | undefined) : undefined;
    if (item === undefined && autoOk.has(k)) {
      out[k] = { result: 'ok', note: 'auto' };
      continue;
    }
    if (!item || !['ok', 'ng', 'na'].includes(item.result as string)) return { ok: false };
    if (item.result === 'ng') hasNg = true;
    out[k] = { result: item.result as string, note: typeof item.note === 'string' ? item.note.slice(0, 2000) : '' };
  }
  return { ok: true, json: JSON.stringify(out), hasNg };
}

export async function decide(c: RouteCtx, vid: string): Promise<Response> {
  const db = c.env.DB;
  const b = await readBody(c.request);
  if (!b) return json(400, { error: 'invalid_json' });
  const decision = b.decision;
  if (decision !== 'approve' && decision !== 'return' && decision !== 'reject') return json(400, { error: 'invalid_decision' });
  const v = await getVersion(db, vid);
  if (!v) return json(404, { error: 'not_found' });
  if (v.status !== 'review') return json(409, { error: 'not_in_review' });
  if (await hasActiveJob(db, v.material_id)) return json(409, { error: 'material_busy' });
  const note = typeof b.note === 'string' ? b.note.slice(0, 4000) : '';
  const now = nowIso();

  if (decision === 'approve') {
    // 省略できる項目は最新 verification の仕分けで決まるので、検証の世代を先に確かめてから checklist を見る
    if (v.verification_status !== 'done') return json(400, { error: 'verification_pending' });
    if (typeof b.verification_id !== 'string' || !b.verification_id) return json(400, { error: 'verification_id_required' });
    const latest = await latestVerification(db, vid);
    if (!latest || latest.id !== b.verification_id) return json(409, { error: 'stale_verification' });
    const triage = await computeTriage(db, v, { id: latest.id, result_json: latest.result_json });
    const autoOk = new Set<string>(AUTO_ITEMS.filter((k: AutoItem) => triage.auto[k] === 'ok'));
    const cl = checkChecklist(b.checklist, autoOk);
    if (!cl.ok) return json(400, { error: 'checklist_incomplete' });
    if (cl.hasNg) return json(400, { error: 'checklist_has_ng' });
    // 自動の処置（差し戻し・再検証）が決まっている版は人が承認しない（§L-4）
    if (triage.action !== 'none') return json(409, { error: 'auto_triage_pending', action: triage.action });
    if (latest.contradicted > 0) return json(400, { error: 'has_contradicted_claims' });
    // 検証係が confirmed とした claim の一次出典に url_was_fetched=0 が無い
    const report = parseJsonField<{ verdicts?: Array<{ claim_id: string; verdict: string }> }>(latest.result_json, {});
    const confirmedIds = new Set((report.verdicts ?? []).filter((x) => x.verdict === 'confirmed').map((x) => x.claim_id));
    const claims = parseJsonField<{ claims?: Array<{ id: string; source_ids?: string[] }> }>(v.claims_json, {}).claims ?? [];
    const srcRows = await all<{ source_id: string; is_primary: number; url_was_fetched: number }>(
      db,
      stmt('SELECT source_id, is_primary, url_was_fetched FROM sources WHERE material_version_id = ?', vid),
    );
    for (const claim of claims) {
      if (!confirmedIds.has(claim.id)) continue;
      for (const sid of claim.source_ids ?? []) {
        const s = srcRows.find((r) => r.source_id === sid);
        if (s && s.is_primary === 1 && s.url_was_fetched === 0) return json(400, { error: 'primary_source_unfetched', message: `${claim.id}:${sid}` });
      }
    }
    const r = await publishSwitch(
      db,
      { kind: 'approve', material_id: v.material_id, version_id: vid, verification_id: latest.id, reviewer_email: c.email, checklist_json: cl.json, note: note || null },
      { decision_id: crypto.randomUUID(), now },
    );
    if (!r.ok) return json(409, { error: 'conflict' });
    console.log(JSON.stringify({ at: 'approve', version_id: vid }));
    return json(200, { version_id: vid, status: 'approved', publish_status: 'available' });
  }

  if (!isNonEmptyString(note, 4000)) return json(400, { error: 'note_required' });
  const clRaw = b.checklist ? checkChecklist(b.checklist) : null;
  const checklistJson = clRaw && clRaw.ok ? clRaw.json : b.checklist ? JSON.stringify(b.checklist).slice(0, 8000) : null;

  if (decision === 'reject') {
    const r = await conditionalBatch(
      db,
      buildReject({ material_id: v.material_id, version_id: vid, reviewer_email: c.email, checklist_json: checklistJson, note }, { decision_id: crypto.randomUUID(), now, log_id: crypto.randomUUID() }),
    );
    if (!r.ok) return json(409, { error: 'conflict' });
    console.log(JSON.stringify({ at: 'reject', version_id: vid }));
    return json(200, { version_id: vid, status: 'rejected' });
  }

  // return
  const origJob = await getJob(db, v.job_id);
  const append = typeof b.brief_append === 'string' ? b.brief_append.slice(0, 8000) : '';
  const brief = buildReworkBrief(origJob?.brief_md, v.version, note, append);
  const newJobId = crypto.randomUUID();
  try {
    const r = await conditionalBatch(
      db,
      buildReturn(
        {
          material_id: v.material_id,
          version_id: vid,
          reviewer_email: c.email,
          checklist_json: checklistJson,
          note,
          new_job_id: newJobId,
          rework_brief_md: brief,
          rework_model: JOB_MODEL.rework,
          rework_budget_cents: cfg(c.env).budgetReworkCents,
        },
        { decision_id: crypto.randomUUID(), now, log_id: crypto.randomUUID() },
      ),
    );
    if (!r.ok) return json(409, { error: 'conflict' });
  } catch (e) {
    if (isUniqueViolation(e)) return json(409, { error: 'material_busy' });
    throw e;
  }
  console.log(JSON.stringify({ at: 'return', version_id: vid, job_id: newJobId }));
  const s = await startJob(c.env, await c.port(), newJobId);
  return json(200, { version_id: vid, status: 'rejected', job_id: newJobId, session_id: s.body.session_id ?? null, start_error: s.status === 201 ? null : s.body.error });
}

export async function reverify(c: RouteCtx, vid: string): Promise<Response> {
  const db = c.env.DB;
  const v = await getVersion(db, vid);
  if (!v) return json(404, { error: 'not_found' });
  if (v.status !== 'review') return json(409, { error: 'not_in_review' });
  if (v.verification_status === 'running') return json(409, { error: 'verification_running' });
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
    const now2 = await getVersion(db, vid);
    if (now2?.verification_status === 'pending') return json(200, { version_id: vid, verification_status: 'pending' });
    return json(409, { error: now2?.verification_status === 'running' ? 'verification_running' : 'conflict' });
  }
  return json(200, { version_id: vid, verification_status: 'pending' });
}
