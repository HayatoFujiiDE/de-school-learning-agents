// /api/materials（契約 §B-3, §B-4-a, §B-6 stop / rollback）。createMaterial は外側（Request → Response）と内側 insertMaterial（§K-1）に分ける
import { all, conditionalBatch, first, isUniqueViolation, stmt, type Stmt } from '../db';
import { JOB_MODEL, cfg, consoleUrl } from '../env';
import { fromResult, isNonEmptyString, json, parseJsonField, readBody, type RouteCtx } from '../http';
import { SUPPORTED_KINDS, getMaterial, startJob, type ApiResult } from '../jobs';
import { machineOrderForMaterial } from '../machine-orders';
import { publishSwitch } from '../publish';

const WORK = ['idle', 'queued', 'making', 'review'];
const PUBLISH = ['none', 'available', 'stopped'];

export function validateKinds(v: unknown): number[] | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  const set = new Set<number>();
  for (const k of v) {
    if (!Number.isInteger(k) || !SUPPORTED_KINDS.includes(k as number)) return null;
    set.add(k as number);
  }
  return [...set].sort();
}

export interface MaterialInput {
  title: string;
  slug: string;
  catalog_item_id: string | null;
  kinds: number[];
  concept_codes: string[];
  brief_md: string;
}

/**
 * POST /api/materials と adopt の body を検査する（§B-4-a）。adopt は `brief` を `brief_md` の別名として受ける（§K-3）。
 * 失敗は 400 の Response を返す。brief_md は応答・ログに出さない。
 */
export function parseNewMaterialBody(b: Record<string, unknown> | null): { ok: true; input: MaterialInput } | { ok: false; response: Response } {
  const no = (error: string, message?: string) => ({ ok: false as const, response: json(400, message ? { error, message } : { error }) });
  if (!b) return no('invalid_json');
  if (b.no_personal_data !== true) return no('personal_data_confirmation_required');
  if (b.material_id) return no('use_post_jobs_for_existing_material');
  if (!isNonEmptyString(b.title, 200)) return no('invalid_title');
  if (typeof b.slug !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(b.slug)) return no('invalid_slug');
  const catalog = b.catalog_item_id ?? null;
  if (!(catalog === null || (typeof catalog === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/.test(catalog)))) return no('invalid_catalog_item_id');
  const kinds = validateKinds(b.kinds);
  if (!kinds) return no('invalid_kinds', `supported: ${SUPPORTED_KINDS.join(',')}`);
  const concepts = b.concept_codes ?? [];
  if (!Array.isArray(concepts) || concepts.length > 50 || !concepts.every((x) => typeof x === 'string' && x.length <= 80)) return no('invalid_concept_codes');
  if (b.kind !== undefined && b.kind !== 'draft') return no('new_material_must_be_draft');
  if (b.parent_version_id) return no('invalid_parent_version');
  const brief = b.brief_md ?? b.brief;
  if (!isNonEmptyString(brief, 20_000)) return no('invalid_brief');
  return {
    ok: true,
    input: { title: b.title.trim(), slug: b.slug, catalog_item_id: catalog as string | null, kinds, concept_codes: concepts as string[], brief_md: brief },
  };
}

/** insertMaterial の条件（adopt・機械用の注文 §U-3）。exists を INSERT 2 文の述語にし、last を最後の文に置く（§B-2） */
export interface MaterialGuard {
  exists: Stmt;
  last: (ids: { material_id: string; job_id: string; now: string }) => Stmt;
  /** last の changes が 0 の時の 409 の error */
  conflict: string;
  /** 素材に記録する提案の id（adopt の時だけ）。無ければ materials.proposal_id は NULL */
  proposal_id?: string;
}

/**
 * 内側: 検証済み入力 → materials + 下書き job（queued）の INSERT（§K-1）。createMaterial と adopt が呼ぶ。
 * by.guard があれば 1 batch の条件付き batch（INSERT 先・UPDATE 後）にし、最後の UPDATE の changes で成否を見る。
 */
export async function insertMaterial(db: D1Database, input: MaterialInput, by: { budget_cents: number; guard?: MaterialGuard }): Promise<ApiResult> {
  const now = new Date().toISOString();
  const materialId = crypto.randomUUID();
  const jobId = crypto.randomUUID();
  const g = by.guard;
  const where = g ? ` WHERE EXISTS (${g.exists.sql})` : '';
  const gp = g ? g.exists.params : [];
  const stmts: Stmt[] = [
    stmt(
      `INSERT INTO materials (id, slug, title, catalog_item_id, concept_codes_json, kinds_json, work_status, publish_status, proposal_id, brief_md, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, ?, 'queued', 'none', ?, ?, ?, ?${where}`,
      materialId, input.slug, input.title, input.catalog_item_id, JSON.stringify(input.concept_codes), JSON.stringify(input.kinds), g?.proposal_id ?? null, input.brief_md, now, now, ...gp,
    ),
    stmt(
      `INSERT INTO factory_jobs (id, material_id, kind, model, phase, status, parent_version_id, brief_md, budget_cents, created_at, updated_at)
       SELECT ?, ?, 'draft', ?, 'questions', 'queued', NULL, ?, ?, ?, ?${where}`,
      jobId, materialId, JOB_MODEL.draft, input.brief_md, by.budget_cents, now, now, ...gp,
    ),
  ];
  if (g) stmts.push(g.last({ material_id: materialId, job_id: jobId, now }));
  try {
    const r = await conditionalBatch(db, stmts);
    if (!r.ok) return { status: 409, body: { error: g ? g.conflict : 'conflict' } };
  } catch (e) {
    if (isUniqueViolation(e)) return { status: 409, body: { error: 'slug_taken' } };
    throw e;
  }
  console.log(JSON.stringify({ at: 'queue', material_id: materialId, job_id: jobId, ...(g?.proposal_id ? { proposal_id: g.proposal_id } : {}) }));
  return { status: 201, body: { material_id: materialId, job_id: jobId } };
}

/** queue の後に即 start する（POST /api/materials と adopt で同じ応答） */
export async function startAfterQueue(c: RouteCtx, q: ApiResult): Promise<Response> {
  if (q.status !== 201) return fromResult(q);
  const s = await startJob(c.env, await c.port(), q.body.job_id as string);
  if (s.status === 201) return json(201, s.body);
  // 作成と queue は成功している。起動できなかった理由を添えて返す（job は queued で残り cron が拾う）
  return json(201, { ...q.body, session_id: null, console_url: null, start_error: s.body.error, start_status: s.status });
}

export async function createMaterial(c: RouteCtx): Promise<Response> {
  const p = parseNewMaterialBody(await readBody(c.request));
  if (!p.ok) return p.response;
  const q = await insertMaterial(c.env.DB, p.input, { budget_cents: cfg(c.env).budgetDraftCents });
  return startAfterQueue(c, q);
}

export async function listMaterials(c: RouteCtx): Promise<Response> {
  const work = c.url.searchParams.get('work');
  const publish = c.url.searchParams.get('publish');
  if (work && !WORK.includes(work)) return json(400, { error: 'invalid_work' });
  if (publish && !PUBLISH.includes(publish)) return json(400, { error: 'invalid_publish' });
  const rows = await all<Record<string, unknown>>(
    c.env.DB,
    stmt(
      `SELECT m.id, m.slug, m.title, m.catalog_item_id, m.kinds_json, m.work_status, m.publish_status, m.current_version_id, m.updated_at,
              cv.version AS current_version, cv.status AS current_version_status,
              aj.id AS active_job_id, aj.status AS active_job_status, aj.phase AS active_job_phase, aj.kind AS active_job_kind
       FROM materials m
       LEFT JOIN material_versions cv ON cv.id = m.current_version_id
       LEFT JOIN factory_jobs aj ON aj.material_id = m.id AND aj.status IN ('queued','creating','running','needs_answer','budget_reached')
       WHERE (? IS NULL OR m.work_status = ?) AND (? IS NULL OR m.publish_status = ?)
       ORDER BY m.updated_at DESC LIMIT 200`,
      work,
      work,
      publish,
      publish,
    ),
  );
  return json(200, {
    materials: rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      catalog_item_id: r.catalog_item_id,
      kinds: parseJsonField(r.kinds_json, []),
      work_status: r.work_status,
      publish_status: r.publish_status,
      updated_at: r.updated_at,
      current_version: r.current_version_id ? { id: r.current_version_id, version: r.current_version, status: r.current_version_status } : null,
      active_job: r.active_job_id ? { id: r.active_job_id, status: r.active_job_status, phase: r.active_job_phase, kind: r.active_job_kind } : null,
    })),
  });
}

export async function getMaterialDetail(c: RouteCtx, id: string): Promise<Response> {
  const db = c.env.DB;
  const m = await getMaterial(db, id);
  if (!m) return json(404, { error: 'not_found' });
  const versions = await all<Record<string, unknown>>(
    db,
    stmt(
      `SELECT id, version, job_id, status, verification_status, verification_attempts, content_sha256, list_cost_cents, grader_result, created_at
       FROM material_versions WHERE material_id = ? ORDER BY version DESC`,
      id,
    ),
  );
  const jobs = await all<Record<string, unknown>>(
    db,
    stmt(
      `SELECT id, kind, model, phase, status, session_id, parent_version_id, answer_state, deny_count, list_cost_cents, reconcile_stage,
              last_checked_at, last_error, error, created_at, updated_at
       FROM factory_jobs WHERE material_id = ? ORDER BY created_at DESC`,
      id,
    ),
  );
  const decisions = await all<Record<string, unknown>>(
    db,
    stmt(
      // 契約 V-8: 判断した時の仕分けの gate（machine_gate）も返す
      'SELECT id, material_version_id, decision, checklist_json, note, reviewer_email, content_sha256_at_decision, created_at, machine_gate FROM review_decisions WHERE material_id = ? ORDER BY created_at DESC',
      id,
    ),
  );
  const notes = await all(db, stmt('SELECT id, source, note, created_at FROM improvement_notes WHERE material_id = ? ORDER BY created_at DESC', id));
  return json(200, {
    material: {
      ...m,
      kinds: parseJsonField(m.kinds_json, []),
      concept_codes: parseJsonField(m.concept_codes_json, []),
    },
    versions,
    jobs: jobs.map((j) => ({ ...j, console_url: consoleUrl(c.env, (j.session_id as string) ?? null) })),
    review_decisions: decisions.map((d) => ({ ...d, checklist: parseJsonField(d.checklist_json, null) })),
    improvement_notes: notes,
    machine_order: await machineOrderForMaterial(db, id), // §U-4（最初の注文の行）
  });
}

export async function stopMaterial(c: RouteCtx, id: string): Promise<Response> {
  const b = await readBody(c.request);
  if (!b || !isNonEmptyString(b.note, 2000)) return json(400, { error: 'note_required' });
  const m = await getMaterial(c.env.DB, id);
  if (!m) return json(404, { error: 'not_found' });
  if (m.publish_status !== 'available') return json(409, { error: 'not_available' });
  const r = await publishSwitch(
    c.env.DB,
    { kind: 'stop', material_id: id, reviewer_email: c.email, note: b.note },
    { decision_id: crypto.randomUUID(), now: new Date().toISOString() },
  );
  if (!r.ok) return json(409, { error: 'conflict' });
  console.log(JSON.stringify({ at: 'stop', material_id: id }));
  return json(200, { material_id: id, publish_status: 'stopped' });
}

export async function rollbackMaterial(c: RouteCtx, id: string): Promise<Response> {
  const b = await readBody(c.request);
  if (!b || typeof b.version_id !== 'string') return json(400, { error: 'version_id_required' });
  if (!isNonEmptyString(b.note, 2000)) return json(400, { error: 'note_required' });
  const v = await first<{ id: string; material_id: string; status: string }>(
    c.env.DB,
    stmt('SELECT id, material_id, status FROM material_versions WHERE id = ?', b.version_id),
  );
  if (!v || v.material_id !== id) return json(400, { error: 'invalid_version' });
  if (v.status !== 'approved') return json(409, { error: 'not_approved_version' });
  const r = await publishSwitch(
    c.env.DB,
    { kind: 'rollback', material_id: id, version_id: v.id, reviewer_email: c.email, note: b.note },
    { decision_id: crypto.randomUUID(), now: new Date().toISOString() },
  );
  if (!r.ok) return json(409, { error: 'conflict', message: 'already_current_or_changed' });
  console.log(JSON.stringify({ at: 'rollback', material_id: id, version_id: v.id }));
  return json(200, { material_id: id, current_version_id: v.id, publish_status: 'available' });
}
