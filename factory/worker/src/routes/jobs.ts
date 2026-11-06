// /api/jobs（契約 §B-3, §B-4）
import { getOEmbedPort } from '../anthropic';
import { first, stmt } from '../db';
import { consoleUrl } from '../env';
import { fromResult, isNonEmptyString, json, parseJsonField, readBody, type RouteCtx } from '../http';
import { answerJob, cancelJob, claimReingest, getJob, getMaterial, queueJobForMaterial, reconcileJob, startJob } from '../jobs';
import { raiseBudget } from '../raise-budget';

export async function createJob(c: RouteCtx): Promise<Response> {
  const b = await readBody(c.request);
  if (!b) return json(400, { error: 'invalid_json' });
  if (b.no_personal_data !== true) return json(400, { error: 'personal_data_confirmation_required' });
  if (typeof b.material_id !== 'string') return json(400, { error: 'material_id_required' });
  if (b.kind !== 'draft' && b.kind !== 'rework') return json(400, { error: 'invalid_kind' });
  const m = await getMaterial(c.env.DB, b.material_id);
  if (!m) return json(404, { error: 'material_not_found' });
  let parent: string | null = null;
  if (b.parent_version_id !== undefined && b.parent_version_id !== null) {
    if (typeof b.parent_version_id !== 'string') return json(400, { error: 'invalid_parent_version' });
    const v = await first<{ material_id: string }>(c.env.DB, stmt('SELECT material_id FROM material_versions WHERE id = ?', b.parent_version_id));
    if (!v || v.material_id !== m.id) return json(400, { error: 'invalid_parent_version' });
    parent = b.parent_version_id;
  }
  const brief = b.brief_md === undefined || b.brief_md === null || b.brief_md === '' ? m.brief_md : b.brief_md;
  if (!isNonEmptyString(brief, 20_000)) return json(400, { error: 'invalid_brief' });
  // 既存素材の title/slug/catalog_item_id/kinds/concept_codes は無視（更新しない）
  const q = await queueJobForMaterial(c.env, { material_id: m.id, kind: b.kind, parent_version_id: parent, brief_md: brief });
  if (q.status !== 201) return fromResult(q);
  const s = await startJob(c.env, await c.port(), q.body.job_id as string);
  if (s.status === 201) return json(201, s.body);
  return json(201, { ...q.body, session_id: null, console_url: null, start_error: s.body.error, start_status: s.status });
}

export async function getJobDetail(c: RouteCtx, id: string): Promise<Response> {
  const j = await getJob(c.env.DB, id);
  if (!j) return json(404, { error: 'not_found' });
  const { reconcile_token: _t, answer_token: _a, brief_md, ...rest } = j;
  return json(200, {
    job: {
      ...rest,
      brief_md,
      questions: parseJsonField(j.questions_json, null),
      answers: parseJsonField(j.answers_json, null),
      denied_event_ids: parseJsonField(j.denied_event_ids_json, []),
      reconcile_state: parseJsonField(j.reconcile_state_json, {}),
      console_url: consoleUrl(c.env, j.session_id),
    },
  });
}

export const startJobRoute = async (c: RouteCtx, id: string) => fromResult(await startJob(c.env, await c.port(), id));

export async function answerJobRoute(c: RouteCtx, id: string): Promise<Response> {
  const b = await readBody(c.request);
  return fromResult(await answerJob(c.env, await c.port(), id, b ?? {}));
}

export const cancelJobRoute = async (c: RouteCtx, id: string) => fromResult(await cancelJob(c.env, await c.port(), id));

/** POST /api/jobs/:id/reconcile と reingest の続きで共通（同じ deadline・同じ応答の形） */
async function reconcileAndReport(c: RouteCtx, id: string): Promise<Response> {
  // §Q-13: 職人の道具 youtube_info の oEmbed の port（port と同じ hostname で fake を判定する）
  const oembed = await getOEmbedPort(c.env, { hostname: c.url.hostname });
  const result = await reconcileJob(c.env, await c.port(), id, { deadline: Date.now() + 25_000, oembed });
  const after = await getJob(c.env.DB, id);
  return json(200, { job_id: id, result, status: after?.status, phase: after?.phase, reconcile_stage: after?.reconcile_stage });
}

export async function reconcileJobRoute(c: RouteCtx, id: string): Promise<Response> {
  const j = await getJob(c.env.DB, id);
  if (!j) return json(404, { error: 'not_found' });
  return reconcileAndReport(c, id);
}

/** §B-4-e: 述語の CAS で failed → running に戻し、続けて reconcile（session は作らない） */
export async function reingestJobRoute(c: RouteCtx, id: string): Promise<Response> {
  const refused = await claimReingest(c.env, id);
  if (refused) return fromResult(refused);
  return reconcileAndReport(c, id);
}

/** §B-4-f: 予算に当たった job を運営の許可で増額する（受理されると session は自動で再開する。job を running に戻すのは reconcile） */
export async function raiseBudgetRoute(c: RouteCtx, id: string): Promise<Response> {
  const b = await readBody(c.request);
  return fromResult(await raiseBudget(c.env, await c.port(), id, b));
}
