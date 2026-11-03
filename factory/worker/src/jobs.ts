// job の起動（startJob）・回答（answerJob）・取消（cancelJob）・回収（reconcileJob）。契約 §B-4。
// すべての書き込みは CAS か §B-2 の条件付き batch。reconcile の書き込みには必ず reconcile_token を付ける。
// ログには id と状態名だけを出す（brief・回答・ページ本文・秘密は出さない）。

import type { BetaManagedAgentsEventParams } from '@anthropic-ai/sdk/resources/beta/sessions/events';
import type { SessionCreateParams } from '@anthropic-ai/sdk/resources/beta/sessions/sessions';
import { PortError, type CallOpts, type FactoryPort } from './anthropic';
import { accumulateCitations, finishCitations, newCitationAcc, type CitationAcc } from './checks/citations';
import { checkForbidden } from './checks/forbidden';
import { MAX_FILE_BYTES, MAX_FILES, REQUIRED_FILES, contentDigestInput, normalizeOutputPath, validateOutputs } from './checks/schema';
import {
  ACTIVE_JOB_SQL,
  all,
  cas,
  conditionalBatch,
  errorKind,
  first,
  getSetting,
  isUniqueViolation,
  isoPlus,
  nowIso,
  stmt,
  tokyoDay,
  type Stmt,
} from './db';
import { JOB_MODEL, cfg, consoleUrl, type Env } from './env';
import { EDITORIAL_STANDARDS, RUBRIC_COMMON, RUBRIC_KINDS } from './generated/claude-assets';
import { isActiveJob, isTerminalJob } from './state';

export interface JobRow {
  id: string;
  material_id: string;
  kind: 'draft' | 'rework';
  model: string;
  phase: 'questions' | 'making';
  status: string;
  session_id: string | null;
  session_created_at: string | null;
  parent_version_id: string | null;
  brief_md: string;
  questions_json: string | null;
  answers_json: string | null;
  answer_state: 'none' | 'saved' | 'sending' | 'sent';
  answered_at: string | null;
  answer_token: string | null;
  create_attempts: number;
  budget_cents: number;
  deny_count: number;
  denied_event_ids_json: string;
  list_cost_cents: number;
  reconcile_stage: string;
  reconcile_state_json: string;
  reconcile_token: string | null;
  reconcile_until: string | null;
  last_checked_at: string | null;
  last_error: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface MaterialRow {
  id: string;
  slug: string;
  title: string;
  catalog_item_id: string | null;
  concept_codes_json: string;
  kinds_json: string;
  work_status: string;
  publish_status: string;
  current_version_id: string | null;
  brief_md: string;
  created_at: string;
  updated_at: string;
}

export interface ApiResult {
  status: number;
  body: Record<string, unknown>;
}
const ok = (status: number, body: Record<string, unknown>): ApiResult => ({ status, body });
const err = (status: number, error: string, message?: string): ApiResult => ({ status, body: message ? { error, message } : { error } });

export const DENY_MESSAGE = '無人運用のためこの操作は許可できません。別の方法で進めてください。';
export const OUTCOME_DESCRIPTION = '注文票の素材を /mnt/session/outputs/ に §E の構成で作る。調査→構成→制作→自分で動作確認→selfcheck の順';
const KIND_LABEL: Record<number, string> = { 3: '説明と図解', 4: '動かせるもの' };
export const SUPPORTED_KINDS = [3, 4];

export const getJob = (db: D1Database, id: string) => first<JobRow>(db, stmt('SELECT * FROM factory_jobs WHERE id = ?', id));
export const getMaterial = (db: D1Database, id: string) => first<MaterialRow>(db, stmt('SELECT * FROM materials WHERE id = ?', id));

function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

const oneLine = (s: string) => String(s ?? '').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------
// メッセージの組み立て（§D-5, §D-6）

export function rubricFor(kinds: number[]): string {
  const parts = [RUBRIC_COMMON];
  for (const k of kinds) if (RUBRIC_KINDS[k]) parts.push(RUBRIC_KINDS[k]);
  return parts.join('\n\n');
}

export function defineOutcomeEvent(kinds: number[]): BetaManagedAgentsEventParams {
  return {
    type: 'user.define_outcome',
    description: OUTCOME_DESCRIPTION,
    rubric: { type: 'text', content: rubricFor(kinds) },
    max_iterations: 3,
  };
}

export async function buildPhase1Message(db: D1Database, briefMd: string, kinds: number[]): Promise<string> {
  const logs = await all<{ kind: string; question: string | null; answer: string }>(
    db,
    stmt(
      "SELECT kind, question, answer FROM standards_log WHERE kind IN ('question','return_reason','note') ORDER BY created_at DESC LIMIT 40",
    ),
  );
  const lines = logs.map((l) =>
    l.kind === 'question'
      ? `- Q: ${oneLine(l.question ?? '')} / A: ${oneLine(l.answer)}`
      : l.kind === 'return_reason'
        ? `- 差し戻し: ${oneLine(l.answer)}`
        : `- 追記: ${oneLine(l.answer)}`,
  );
  const kindLines = kinds.map((k) => `- 型 ${k}（${KIND_LABEL[k] ?? '不明'}）`);
  const kindRubrics = kinds.map((k) => RUBRIC_KINDS[k]).filter(Boolean);
  return [
    '# 注文票',
    briefMd,
    '',
    '# 編集基準',
    EDITORIAL_STANDARDS.trim(),
    '## これまでの回答と差し戻し理由（全素材・新しい順・最大 40 件）',
    ...(lines.length ? lines : ['- （まだありません）']),
    '',
    '# 今回の型',
    ...kindLines,
    '',
    ...kindRubrics.map((r) => r.trim() + '\n'),
    '# 最初にやること',
    '注文票と編集基準を読み、作る前に運営に確認したいことがあれば /mnt/session/outputs/questions.json に',
    '{"questions":[{"id":"q1","question":"…","why":"…","default":"…"}]} の形で 3 件以内で書いて止まってください。',
    '編集基準で答えが決まるものは質問にしないでください。確認したいことが無ければ {"questions":[]} を書いて止まってください。',
    'この段階では調査も制作も始めないでください。',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// queue（§B-4-a）

export interface NewMaterialInput {
  title: string;
  slug: string;
  catalog_item_id: string | null;
  kinds: number[];
  concept_codes: string[];
  brief_md: string;
}

export async function queueNewMaterial(env: Env, input: NewMaterialInput): Promise<ApiResult> {
  const now = nowIso();
  const materialId = crypto.randomUUID();
  const jobId = crypto.randomUUID();
  const budget = cfg(env).budgetDraftCents;
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO materials (id, slug, title, catalog_item_id, concept_codes_json, kinds_json, work_status, publish_status, brief_md, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'queued', 'none', ?, ?, ?)`,
      ).bind(materialId, input.slug, input.title, input.catalog_item_id, JSON.stringify(input.concept_codes), JSON.stringify(input.kinds), input.brief_md, now, now),
      env.DB.prepare(
        `INSERT INTO factory_jobs (id, material_id, kind, model, phase, status, parent_version_id, brief_md, budget_cents, created_at, updated_at)
         VALUES (?, ?, 'draft', ?, 'questions', 'queued', NULL, ?, ?, ?, ?)`,
      ).bind(jobId, materialId, JOB_MODEL.draft, input.brief_md, budget, now, now),
    ]);
  } catch (e) {
    if (isUniqueViolation(e)) return err(409, 'slug_taken');
    throw e;
  }
  console.log(JSON.stringify({ at: 'queue', material_id: materialId, job_id: jobId }));
  return ok(201, { material_id: materialId, job_id: jobId });
}

export async function queueJobForMaterial(
  env: Env,
  a: { material_id: string; kind: 'draft' | 'rework'; parent_version_id: string | null; brief_md: string },
): Promise<ApiResult> {
  const now = nowIso();
  const jobId = crypto.randomUUID();
  const budget = a.kind === 'rework' ? cfg(env).budgetReworkCents : cfg(env).budgetDraftCents;
  const P = `SELECT 1 FROM materials pm WHERE pm.id = ? AND pm.work_status = 'idle'`;
  const stmts: Stmt[] = [
    stmt(
      `INSERT INTO factory_jobs (id, material_id, kind, model, phase, status, parent_version_id, brief_md, budget_cents, created_at, updated_at)
       SELECT ?, ?, ?, ?, 'questions', 'queued', ?, ?, ?, ?, ? WHERE EXISTS (${P})`,
      jobId, a.material_id, a.kind, JOB_MODEL[a.kind], a.parent_version_id, a.brief_md, budget, now, now, a.material_id,
    ),
    stmt(`UPDATE materials SET work_status = 'queued', updated_at = ? WHERE id = ? AND EXISTS (${P})`, now, a.material_id, a.material_id),
  ];
  try {
    const r = await conditionalBatch(env.DB, stmts);
    if (!r.ok) return err(409, 'material_busy');
  } catch (e) {
    if (isUniqueViolation(e)) return err(409, 'material_busy');
    throw e;
  }
  console.log(JSON.stringify({ at: 'queue', material_id: a.material_id, job_id: jobId }));
  return ok(201, { material_id: a.material_id, job_id: jobId });
}

// ---------------------------------------------------------------------------
// startJob（§B-4-a）

export async function todayCostCents(db: D1Database): Promise<number> {
  const r = await first<{ c: number | null }>(db, stmt('SELECT SUM(cents) AS c FROM cost_ledger WHERE day = ?', tokyoDay()));
  return Number(r?.c ?? 0);
}

export async function startJob(env: Env, port: FactoryPort, jobId: string): Promise<ApiResult> {
  const db = env.DB;
  const job = await getJob(db, jobId);
  if (!job) return err(404, 'not_found');
  if (job.status !== 'queued') return err(409, 'not_queued');

  // 1. ガード（目安。厳密な上限は session budget と Console の支出上限）
  if ((await getSetting(db, 'paused')) === '1') return err(409, 'paused');
  const c = cfg(env);
  const run = await first<{ n: number; b: number | null }>(
    db,
    stmt("SELECT COUNT(*) AS n, SUM(budget_cents) AS b FROM factory_jobs WHERE status IN ('creating','running')"),
  );
  if (Number(run?.n ?? 0) >= c.maxConcurrent) return err(409, 'too_many_running');
  if ((await todayCostCents(db)) + Number(run?.b ?? 0) >= c.dailyCapCents) return err(409, 'daily_cap_reached');
  if (!env.FACTORY_AGENT_ID || !env.FACTORY_ENV_ID) return err(503, 'factory_not_configured');

  const material = await getMaterial(db, job.material_id);
  if (!material) return err(404, 'material_not_found');

  // 2. CAS: queued → creating（同 batch で material making）
  const now = nowIso();
  const P = `SELECT 1 FROM factory_jobs pj WHERE pj.id = ? AND pj.status = 'queued'`;
  const claimed = await conditionalBatch(db, [
    stmt(`UPDATE materials SET work_status = 'making', updated_at = ? WHERE id = ? AND EXISTS (${P})`, now, job.material_id, jobId),
    stmt(
      `UPDATE factory_jobs SET status = 'creating', create_attempts = create_attempts + 1, updated_at = ? WHERE id = ? AND status = 'queued'`,
      now,
      jobId,
    ),
  ]);
  if (!claimed.ok) return err(409, 'not_queued');

  // 3. sessions.create（§D-4）
  const kinds = parseJson<number[]>(material.kinds_json, []);
  const budgetCents = job.budget_cents > 0 ? job.budget_cents : job.kind === 'rework' ? c.budgetReworkCents : c.budgetDraftCents;
  const phase1Message = await buildPhase1Message(db, job.brief_md, kinds);
  const params: SessionCreateParams = {
    agent:
      job.kind === 'rework'
        ? { type: 'agent_with_overrides', id: env.FACTORY_AGENT_ID, model: { id: 'claude-opus-5-5', effort: 'high' } }
        : env.FACTORY_AGENT_ID,
    environment_id: env.FACTORY_ENV_ID,
    title: `${material.slug} ${job.kind} ${jobId.slice(0, 8)}`,
    metadata: { job_id: jobId, material_id: material.id, kind: job.kind },
    budget: { type: 'limit', max_list_cost: { amount: String(budgetCents), currency: 'USD' } },
    initial_events: [{ type: 'user.message', content: [{ type: 'text', text: phase1Message }] }],
  };

  let sessionId: string;
  try {
    sessionId = (await port.createSession(params)).id;
  } catch (e) {
    const t = nowIso();
    if (e instanceof PortError && e.responded) {
      // 5a. 応答ありの失敗 → queued に戻す（cron が再起動）
      const PC = `SELECT 1 FROM factory_jobs pj WHERE pj.id = ? AND pj.status = 'creating'`;
      await conditionalBatch(db, [
        stmt(`UPDATE materials SET work_status = 'queued', updated_at = ? WHERE id = ? AND work_status = 'making' AND EXISTS (${PC})`, t, job.material_id, jobId),
        stmt(`UPDATE factory_jobs SET status = 'queued', last_error = ?, updated_at = ? WHERE id = ? AND status = 'creating'`, errorKind(e), t, jobId),
      ]);
      console.log(JSON.stringify({ at: 'start', job_id: jobId, result: 'create_failed' }));
      return err(502, 'anthropic_error');
    }
    // 5b. 応答不明 → creating のまま（cron §B-4-a-6 が sessions.list で採用 or 戻す）
    await cas(db, stmt(`UPDATE factory_jobs SET last_error = 'create_unconfirmed' WHERE id = ? AND status = 'creating'`, jobId));
    console.log(JSON.stringify({ at: 'start', job_id: jobId, result: 'create_unconfirmed' }));
    return err(502, 'anthropic_error', 'create_unconfirmed');
  }

  // 4. 成功
  const t = nowIso();
  const adopted = await cas(
    db,
    stmt(
      `UPDATE factory_jobs SET status = 'running', session_id = ?, session_created_at = ?, last_error = NULL, updated_at = ? WHERE id = ? AND status = 'creating'`,
      sessionId,
      t,
      t,
      jobId,
    ),
  );
  if (!adopted) {
    // 作成中に cancel された。作った session は止める
    await port.archiveSession(sessionId).catch(() => undefined);
    return err(409, 'cancelled_during_create');
  }
  console.log(JSON.stringify({ at: 'start', job_id: jobId, session_id: sessionId, result: 'running' }));
  return ok(201, { job_id: jobId, material_id: job.material_id, session_id: sessionId, console_url: consoleUrl(env, sessionId) });
}

/** §B-4-a-6: creating のまま 10 分超の job を sessions.list で採用するか戻す */
export async function recoverCreating(env: Env, port: FactoryPort, job: JobRow): Promise<string> {
  const db = env.DB;
  const cutoff = Date.parse(job.updated_at) - 3600_000;
  const matches: Array<{ id: string; created_at: string }> = [];
  let page: string | null = null;
  for (let i = 0; i < 10; i++) {
    const p = await port.listSessionsPage(page);
    let reachedCutoff = false;
    for (const s of p.data) {
      if (Date.parse(s.created_at) < cutoff) {
        reachedCutoff = true;
        break;
      }
      if (s.metadata?.job_id === job.id) matches.push({ id: s.id, created_at: s.created_at });
    }
    if (reachedCutoff || !p.next) break;
    page = p.next;
  }
  const now = nowIso();
  const PC = `SELECT 1 FROM factory_jobs pj WHERE pj.id = ? AND pj.status = 'creating'`;
  if (matches.length > 0) {
    matches.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    const [adopt, ...rest] = matches;
    const okAdopt = await cas(
      db,
      stmt(
        `UPDATE factory_jobs SET status = 'running', session_id = ?, session_created_at = ?, last_error = NULL, updated_at = ? WHERE id = ? AND status = 'creating'`,
        adopt.id,
        adopt.created_at,
        now,
        job.id,
      ),
    );
    if (okAdopt) for (const r of rest) await port.archiveSession(r.id).catch(() => undefined);
    return okAdopt ? 'adopted' : 'conflict';
  }
  if (job.create_attempts >= 3) {
    await conditionalBatch(db, [
      stmt(`UPDATE materials SET work_status = 'idle', updated_at = ? WHERE id = ? AND work_status = 'making' AND EXISTS (${PC})`, now, job.material_id, job.id),
      stmt(`UPDATE factory_jobs SET status = 'failed', error = 'create_unconfirmed', updated_at = ? WHERE id = ? AND status = 'creating'`, now, job.id),
    ]);
    return 'failed';
  }
  await conditionalBatch(db, [
    stmt(`UPDATE materials SET work_status = 'queued', updated_at = ? WHERE id = ? AND work_status = 'making' AND EXISTS (${PC})`, now, job.material_id, job.id),
    stmt(`UPDATE factory_jobs SET status = 'queued', updated_at = ? WHERE id = ? AND status = 'creating'`, now, job.id),
  ]);
  return 'requeued';
}

// ---------------------------------------------------------------------------
// 共通: events をページで辿る（§B-4-d「最後のページまで」）

const MAX_PAGES = 500; // 有限ループの上限（1 ページ 20 件でも 1 万件）

export class OutOfTime extends Error {
  constructor() {
    super('out_of_time');
    this.name = 'OutOfTime';
  }
}

/**
 * events を order 順にページで辿り、visit が true を返したらそこで止める。
 * 各ページの取得前に before()（lease 延長と残時間の確認）を呼ぶ。最後のページまで辿れたら complete=true。
 * 途中で時間切れなら OutOfTime を投げる（呼び出し側は「見つからなかった」と確定しない）。
 */
async function scanEvents(
  port: FactoryPort,
  sessionId: string,
  order: 'asc' | 'desc',
  visit: (ev: Record<string, unknown>) => boolean,
  o: { before: () => Promise<void>; call: CallOpts },
): Promise<{ stopped: boolean }> {
  let page: string | null = null;
  for (let i = 0; i < MAX_PAGES; i++) {
    await o.before();
    const p = await port.listEventsPage(sessionId, { order, page }, o.call);
    for (const ev of p.data) if (visit((ev ?? {}) as Record<string, unknown>)) return { stopped: true };
    if (!p.next) return { stopped: false };
    page = p.next;
  }
  throw new Error('too_many_pages');
}

const deadlineGuard = (deadline: number) => async () => {
  if (Date.now() > deadline - 5_000) throw new OutOfTime();
};

// ---------------------------------------------------------------------------
// cancel（§B-3, §B-4-a-7）

export async function cancelJob(env: Env, port: FactoryPort, jobId: string): Promise<ApiResult> {
  const db = env.DB;
  const job = await getJob(db, jobId);
  if (!job) return err(404, 'not_found');
  if (!isActiveJob(job.status)) return err(409, 'not_cancellable');
  const now = nowIso();
  const P = `SELECT 1 FROM factory_jobs pj WHERE pj.id = ? AND pj.status IN ${ACTIVE_JOB_SQL}`;
  const r = await conditionalBatch(db, [
    stmt(
      `UPDATE materials SET work_status = 'idle', updated_at = ? WHERE id = ? AND work_status IN ('queued','making') AND EXISTS (${P})`,
      now,
      job.material_id,
      jobId,
    ),
    stmt(`UPDATE factory_jobs SET status = 'cancelled', updated_at = ? WHERE id = ? AND status IN ${ACTIVE_JOB_SQL}`, now, jobId),
  ]);
  if (!r.ok) return err(409, 'not_cancellable');
  // cancelled への CAS が成功した後に読み直す（creating 中に session が確定していた場合も止める）
  const after = await getJob(db, jobId);
  const sid = after?.session_id ?? null;
  if (sid) {
    try {
      await port.sendEvents(sid, [{ type: 'user.interrupt' }]);
    } catch (e) {
      await cas(db, stmt('UPDATE factory_jobs SET last_error = ? WHERE id = ?', `interrupt:${errorKind(e)}`, jobId));
    }
    try {
      await port.archiveSession(sid);
    } catch (e) {
      await cas(db, stmt('UPDATE factory_jobs SET last_error = ? WHERE id = ?', `archive:${errorKind(e)}`, jobId));
    }
  }
  console.log(JSON.stringify({ at: 'cancel', job_id: jobId, archived: !!sid }));
  return ok(200, { job_id: jobId, status: 'cancelled' });
}

// ---------------------------------------------------------------------------
// answer（§B-4-c）

export interface Question {
  id: string;
  question: string;
  why: string;
  default: string;
}

export function sanitizeQuestions(raw: unknown): Question[] {
  const arr = (raw as { questions?: unknown } | null)?.questions;
  if (!Array.isArray(arr)) return [];
  const out: Question[] = [];
  for (const q of arr.slice(0, 10)) {
    const o = q as Record<string, unknown>;
    if (!o || typeof o.question !== 'string' || !o.question.trim()) continue;
    const id = typeof o.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(o.id) ? o.id : `q${out.length + 1}`;
    out.push({
      id,
      question: o.question.slice(0, 2000),
      why: typeof o.why === 'string' ? o.why.slice(0, 2000) : '',
      default: typeof o.default === 'string' ? o.default.slice(0, 2000) : '',
    });
  }
  return out;
}

const ANSWER_BUDGET_MS = 25_000;

export async function answerJob(env: Env, port: FactoryPort, jobId: string, body: unknown): Promise<ApiResult> {
  const db = env.DB;
  let job = await getJob(db, jobId);
  if (!job) return err(404, 'not_found');
  if (job.status !== 'needs_answer') return err(409, 'not_waiting');
  const questions = parseJson<Question[]>(job.questions_json, []);

  // 2. 保存（none の時だけ）
  if (job.answer_state === 'none') {
    const answersRaw = (body as { answers?: unknown } | null)?.answers;
    if (!Array.isArray(answersRaw)) return err(400, 'answers_required');
    const answers: Array<{ question_id: string; answer: string }> = [];
    for (const q of questions) {
      const a = answersRaw.find((x) => (x as { question_id?: unknown })?.question_id === q.id) as { answer?: unknown } | undefined;
      if (!a || typeof a.answer !== 'string' || !a.answer.trim()) return err(400, 'answer_missing', q.id);
      if (a.answer.length > 4000) return err(400, 'answer_too_long', q.id);
      answers.push({ question_id: q.id, answer: a.answer });
    }
    const now = nowIso();
    const P = `SELECT 1 FROM factory_jobs pj WHERE pj.id = ? AND pj.status = 'needs_answer' AND pj.answer_state = 'none'`;
    const stmts: Stmt[] = answers.map((a) =>
      stmt(
        `INSERT INTO standards_log (id, material_id, job_id, kind, question, answer, created_at)
         SELECT ?, ?, ?, 'question', ?, ?, ? WHERE EXISTS (${P})`,
        crypto.randomUUID(),
        job!.material_id,
        jobId,
        questions.find((q) => q.id === a.question_id)?.question ?? '',
        a.answer,
        now,
        jobId,
      ),
    );
    stmts.push(
      stmt(
        `UPDATE factory_jobs SET answers_json = ?, answer_state = 'saved', updated_at = ? WHERE id = ? AND status = 'needs_answer' AND answer_state = 'none'`,
        JSON.stringify(answers),
        now,
        jobId,
      ),
    );
    await conditionalBatch(db, stmts);
    job = (await getJob(db, jobId))!;
    if (job.status !== 'needs_answer') return err(409, 'not_waiting');
  }

  if ((await getSetting(db, 'paused')) === '1') return err(409, 'paused');

  // 3. 排他（saved、または 5 分超の sending）
  const token = crypto.randomUUID();
  const now = nowIso();
  const claimed = await cas(
    db,
    stmt(
      `UPDATE factory_jobs SET answer_state = 'sending', answer_token = ?, updated_at = ?
       WHERE id = ? AND status = 'needs_answer' AND (answer_state = 'saved' OR (answer_state = 'sending' AND updated_at < ?))`,
      token,
      now,
      jobId,
      isoPlus(-5 * 60_000),
    ),
  );
  if (!claimed) return err(409, 'answer_in_flight');

  const material = await getMaterial(db, job.material_id);
  const kinds = parseJson<number[]>(material?.kinds_json, []);
  const answers = parseJson<Array<{ question_id: string; answer: string }>>(job.answers_json, []);
  const deadline = Date.now() + ANSWER_BUDGET_MS;
  try {
    // 4. 送信（define_outcome が既にあれば送らない。全ページを見て確定する）
    const found = await scanEvents(port, job.session_id!, 'desc', (e) => e.type === 'user.define_outcome', {
      before: deadlineGuard(deadline),
      call: { deadline },
    });
    if (!found.stopped) {
      const text = [
        '# 運営からの回答',
        ...answers.map((a) => {
          const q = questions.find((x) => x.id === a.question_id);
          return `- ${a.question_id}: ${q ? oneLine(q.question) : ''}\n  回答: ${a.answer}`;
        }),
      ].join('\n');
      await deadlineGuard(deadline)();
      await port.sendEvents(job.session_id!, [{ type: 'user.message', content: [{ type: 'text', text }] }, defineOutcomeEvent(kinds)], { deadline });
    }
  } catch (e) {
    // 6. 失敗 → saved に戻す
    await cas(
      db,
      stmt(
        `UPDATE factory_jobs SET answer_state = 'saved', answer_token = NULL, last_error = ? WHERE id = ? AND answer_token = ? AND answer_state = 'sending'`,
        e instanceof OutOfTime ? 'events_scan_incomplete' : errorKind(e),
        jobId,
        token,
      ),
    );
    return err(502, 'anthropic_error');
  }
  // 5. 成功
  const t = nowIso();
  const done = await cas(
    db,
    stmt(
      `UPDATE factory_jobs SET status = 'running', phase = 'making', answer_state = 'sent', answered_at = ?, last_error = NULL, updated_at = ?
       WHERE id = ? AND status = 'needs_answer' AND answer_token = ?`,
      t,
      t,
      jobId,
      token,
    ),
  );
  if (!done) return err(409, 'not_waiting');
  console.log(JSON.stringify({ at: 'answer', job_id: jobId, result: 'sent' }));
  return ok(200, { job_id: jobId, status: 'running', phase: 'making' });
}

// ---------------------------------------------------------------------------
// reconcile（§B-4-d）

const LEASE_MS = 120_000;
const MIN_REMAINING_MS = 5_000;
const LIST_ITEMS_MAX = 1_000;

class LostLease extends Error {
  constructor() {
    super('lost_lease');
    this.name = 'LostLease';
  }
}

interface ListedFile {
  file_id: string;
  filename: string;
  size: number;
  created_at: string;
}

interface ReconcileState {
  /** inspected: files.list の途中経過（ページの続き位置）。complete になってから必須ファイルを判定する */
  list?: { cursor: string | null; items: ListedFile[]; round: number; complete: boolean };
  /** listed / ingested: 取り込むファイルと、R2 に置き終えた file_id */
  files?: Array<{ file_id: string; filename: string; size: number }>;
  done?: string[];
  /** ingested: events（古い順）の途中経過。本文は持たず、出典照合の集計と採点結果だけ */
  ev?: { cursor: string | null; acc: CitationAcc; grader: { result: string; explanation: string } | null; complete: boolean };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** deadline: waitUntil 経由は開始から 25 秒、cron 経由は 10 分。外部呼び出しは min(残り時間, 60 秒)・再試行 0 */
export async function reconcileJob(env: Env, port: FactoryPort, jobId: string, opts: { deadline: number }): Promise<string> {
  const db = env.DB;
  const token = crypto.randomUUID();
  const now = nowIso();
  const leased = await cas(
    db,
    stmt(
      'UPDATE factory_jobs SET reconcile_token = ?, reconcile_until = ? WHERE id = ? AND (reconcile_until IS NULL OR reconcile_until < ?)',
      token,
      isoPlus(LEASE_MS),
      jobId,
      now,
    ),
  );
  if (!leased) return 'leased';
  const r = new Reconciler(env, port, jobId, token, opts.deadline);
  let result = 'error';
  try {
    result = await r.run();
  } catch (e) {
    if (e instanceof LostLease) result = 'lost_lease';
    else if (e instanceof OutOfTime) result = 'deferred';
    else {
      result = 'error';
      await cas(db, stmt('UPDATE factory_jobs SET last_error = ? WHERE id = ? AND reconcile_token = ?', errorKind(e), jobId, token)).catch(() => false);
    }
  } finally {
    await cas(
      db,
      stmt(
        'UPDATE factory_jobs SET reconcile_token = NULL, reconcile_until = NULL, last_checked_at = ? WHERE id = ? AND reconcile_token = ?',
        nowIso(),
        jobId,
        token,
      ),
    ).catch(() => false);
  }
  console.log(JSON.stringify({ at: 'reconcile', job_id: jobId, result }));
  return result;
}

class Reconciler {
  private db: D1Database;
  constructor(
    private env: Env,
    private port: FactoryPort,
    private jobId: string,
    private token: string,
    private deadline: number,
  ) {
    this.db = env.DB;
  }

  private get call(): CallOpts {
    return { deadline: this.deadline };
  }

  private async load(): Promise<JobRow> {
    const j = await getJob(this.db, this.jobId);
    if (!j || j.reconcile_token !== this.token) throw new LostLease();
    return j;
  }

  /** 外部呼び出しの前に毎回: 残り時間が 5 秒未満なら呼ばずに抜ける。lease を延長し、失敗したら所有権を失ったとして抜ける */
  private extend = async (): Promise<void> => {
    if (Date.now() > this.deadline - MIN_REMAINING_MS) throw new OutOfTime();
    const okExt = await cas(
      this.db,
      stmt('UPDATE factory_jobs SET reconcile_until = ? WHERE id = ? AND reconcile_token = ?', isoPlus(LEASE_MS), this.jobId, this.token),
    );
    if (!okExt) throw new LostLease();
  };

  /** token 付きの CAS。setParams は SET の ? だけに対応する（whereExtra には ? を書かない） */
  private async casJob(setSql: string, whereExtra: string, ...setParams: Array<string | number | null>): Promise<boolean> {
    if (whereExtra.includes('?')) throw new Error('whereExtra must not have placeholders');
    const sql = `UPDATE factory_jobs SET ${setSql}, updated_at = ? WHERE ${whereExtra ? `(${whereExtra}) AND ` : ''}id = ? AND reconcile_token = ?`;
    return cas(this.db, { sql, params: [...setParams, nowIso(), this.jobId, this.token] });
  }

  async run(): Promise<string> {
    let job = await this.load();
    if (isTerminalJob(job.status) || job.status === 'queued' || job.status === 'creating') return 'noop';
    if (!job.session_id) return 'no_session';

    // 2. retrieve + 費用
    await this.extend();
    const session = await this.port.retrieveSession(job.session_id, this.call);
    job = await this.recordCost(job, session.listCostCents);

    // 0-b. needs_answer は terminated 判定だけ（fail は読んだ status/phase を述語に含めるので、途中で answer が進んでいれば何もしない）
    if (job.status === 'needs_answer') {
      if (session.status === 'terminated') return this.fail(job, 'terminated_waiting_answer');
      return 'waiting_answer';
    }

    // 段階からの再開
    if (['inspected', 'listed', 'ingested'].includes(job.reconcile_stage) && (job.status === 'running' || job.status === 'budget_reached')) {
      return this.ingest(job, session.status === 'terminated' ? 'terminated_without_outputs' : 'invalid_outputs');
    }

    // 3. session status
    switch (session.status) {
      case 'running':
      case 'rescheduling':
        if (job.status === 'budget_reached') {
          await this.casJob("status = 'running'", "status = 'budget_reached'");
          return 'resumed';
        }
        return 'running';
      case 'terminated':
        if (job.phase === 'making' && (job.status === 'running' || job.status === 'budget_reached')) {
          return this.ingest(job, 'terminated_without_outputs');
        }
        return this.fail(job, 'terminated_without_outputs');
      case 'idle':
        return this.onIdle(job);
      default:
        return 'unknown_session_status';
    }
  }

  private async recordCost(job: JobRow, cents: number | null): Promise<JobRow> {
    if (cents === null || cents <= job.list_cost_cents) return job;
    const delta = cents - job.list_cost_cents;
    const now = nowIso();
    const P = `SELECT 1 FROM factory_jobs pj WHERE pj.id = ? AND pj.reconcile_token = ? AND pj.list_cost_cents = ?`;
    const r = await conditionalBatch(this.db, [
      stmt(
        `INSERT INTO cost_ledger (id, day, kind, ref_id, cents, created_at) SELECT ?, ?, 'session', ?, ?, ? WHERE EXISTS (${P})`,
        crypto.randomUUID(),
        tokyoDay(),
        job.id,
        delta,
        now,
        job.id,
        this.token,
        job.list_cost_cents,
      ),
      stmt(
        'UPDATE factory_jobs SET list_cost_cents = ? WHERE id = ? AND reconcile_token = ? AND list_cost_cents = ?',
        cents,
        job.id,
        this.token,
        job.list_cost_cents,
      ),
    ]);
    if (!r.ok) throw new LostLease();
    return { ...job, list_cost_cents: cents };
  }

  /** 終端（failed）へ落とす。述語に「読んだ時点の status と phase」を含め、途中で状態が進んでいたら何もしない */
  private async fail(job: JobRow, error: string): Promise<string> {
    const now = nowIso();
    const P = `SELECT 1 FROM factory_jobs pj WHERE pj.id = ? AND pj.reconcile_token = ? AND pj.status = ? AND pj.phase = ?`;
    const r = await conditionalBatch(this.db, [
      stmt(
        `UPDATE materials SET work_status = 'idle', updated_at = ? WHERE id = ? AND work_status = 'making' AND EXISTS (${P})`,
        now,
        job.material_id,
        job.id,
        this.token,
        job.status,
        job.phase,
      ),
      stmt(
        `UPDATE factory_jobs SET status = 'failed', error = ?, updated_at = ?
         WHERE id = ? AND reconcile_token = ? AND status = ? AND phase = ? AND status IN ('running','needs_answer','budget_reached')`,
        error,
        now,
        job.id,
        this.token,
        job.status,
        job.phase,
      ),
    ]);
    return r.ok ? `failed:${error}` : 'state_changed';
  }

  private async onIdle(job: JobRow): Promise<string> {
    // 新しい順に辿り、最新の status_idle・最新の outcome_evaluation_end・define_outcome の有無を集める。
    // end_turn の時は define_outcome が見つかるまで（無ければ最後のページまで）辿ってから「既送なし」を確定する
    type IdleEv = { stop_reason?: { type?: string; event_ids?: string[] } };
    const seen: { idle: IdleEv | null; evalEnd: { result?: string } | null; hasOutcome: boolean } = { idle: null, evalEnd: null, hasOutcome: false };
    await scanEvents(
      this.port,
      job.session_id!,
      'desc',
      (e) => {
        if (!seen.idle && e.type === 'session.status_idle') seen.idle = e as IdleEv;
        if (!seen.evalEnd && e.type === 'span.outcome_evaluation_end') seen.evalEnd = e as { result?: string };
        if (e.type === 'user.define_outcome') seen.hasOutcome = true;
        if (!seen.idle) return false;
        if (seen.idle.stop_reason?.type !== 'end_turn') return true;
        return seen.hasOutcome;
      },
      { before: this.extend, call: this.call },
    );
    const idleEv = seen.idle;
    const hasOutcome = seen.hasOutcome;
    if (!idleEv) return 'no_idle_event';
    const stop = idleEv.stop_reason?.type ?? '';

    if (stop === 'requires_action') {
      const denied = new Set(parseJson<string[]>(job.denied_event_ids_json, []));
      const ids = (idleEv.stop_reason?.event_ids ?? []).filter((id) => typeof id === 'string' && !denied.has(id));
      if (ids.length === 0) return 'already_denied';
      await this.extend();
      await this.port.sendEvents(
        job.session_id!,
        ids.map((id) => ({ type: 'user.tool_confirmation', tool_use_id: id, result: 'deny', deny_message: DENY_MESSAGE }) as BetaManagedAgentsEventParams),
        this.call,
      );
      ids.forEach((id) => denied.add(id));
      const newCount = job.deny_count + ids.length;
      const saved = await this.casJob('denied_event_ids_json = ?, deny_count = ?', '', JSON.stringify([...denied]), newCount);
      if (!saved) throw new LostLease();
      if (newCount > 8) {
        await this.extend();
        await this.port.sendEvents(job.session_id!, [{ type: 'user.interrupt' }], this.call).catch(() => undefined);
        await this.port.archiveSession(job.session_id!, this.call).catch(() => undefined);
        return this.fail(job, 'too_many_denies');
      }
      return `denied:${ids.length}`;
    }

    if (stop === 'budget_reached') {
      if (job.status === 'running') await this.casJob("status = 'budget_reached'", "status = 'running'");
      return 'budget_reached';
    }

    if (stop === 'end_turn') {
      if (job.phase === 'questions') return this.onQuestionsEnd(job, hasOutcome);
      const ev = seen.evalEnd;
      if (!ev) {
        if (!hasOutcome) {
          await this.sendOutcome(job);
          return 'outcome_resent';
        }
        return 'waiting_outcome';
      }
      const result = String(ev.result ?? '');
      if (['satisfied', 'max_iterations_reached', 'failed'].includes(result)) return this.ingest(job, 'invalid_outputs');
      if (['pending', 'running', 'evaluating', 'needs_revision'].includes(result)) return 'evaluating';
      return this.fail(job, `outcome_${result.replace(/[^a-z_]/g, '').slice(0, 30) || 'unknown'}`);
    }

    if (stop === 'retries_exhausted' || stop === 'refusal') return this.fail(job, stop);
    return this.fail(job, 'unknown_stop_reason');
  }

  private async sendOutcome(job: JobRow): Promise<void> {
    const material = await getMaterial(this.db, job.material_id);
    await this.extend();
    await this.port.sendEvents(job.session_id!, [defineOutcomeEvent(parseJson<number[]>(material?.kinds_json, []))], this.call);
  }

  /** files.list を最後のページまで（保存しない。質問フェーズ用） */
  private async listAllFiles(sessionId: string): Promise<ListedFile[]> {
    const out: ListedFile[] = [];
    let page: string | null = null;
    for (let i = 0; i < MAX_PAGES; i++) {
      await this.extend();
      const p = await this.port.listFilesPage(sessionId, page, this.call);
      for (const f of p.data) out.push({ file_id: f.id, filename: f.filename, size: f.size_bytes, created_at: f.created_at });
      if (out.length > LIST_ITEMS_MAX) throw new Error('too_many_files');
      if (!p.next) return out;
      page = p.next;
    }
    throw new Error('too_many_pages');
  }

  /** §B-4-b */
  private async onQuestionsEnd(job: JobRow, hasOutcome: boolean): Promise<string> {
    if (job.status !== 'running') return 'noop';
    const files = await this.listAllFiles(job.session_id!);
    const qf = files
      .filter((f) => normalizeOutputPath(f.filename) === 'questions.json')
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
    let questions: Question[] = [];
    if (qf && qf.size <= MAX_FILE_BYTES) {
      await this.extend();
      const bytes = await this.port.downloadFile(qf.file_id, this.call);
      questions = sanitizeQuestions(parseJson<unknown>(new TextDecoder().decode(bytes), null)).slice(0, 3);
    }
    if (questions.length === 0) {
      if (!hasOutcome) await this.sendOutcome(job);
      const moved = await this.casJob("phase = 'making', last_error = NULL", "status = 'running' AND phase = 'questions'");
      if (!moved) throw new LostLease();
      return 'outcome_sent';
    }
    const asked = await this.casJob("status = 'needs_answer', questions_json = ?", "status = 'running' AND phase = 'questions'", JSON.stringify(questions));
    if (!asked) throw new LostLease();
    return 'needs_answer';
  }

  private async saveStage(stage: string, state: ReconcileState): Promise<void> {
    const saved = await this.casJob(
      'reconcile_stage = ?, reconcile_state_json = ?',
      "status IN ('running','budget_reached')",
      stage,
      JSON.stringify(state),
    );
    if (!saved) throw new LostLease();
  }

  /** §B-4-d 手順 6: inspected → listed → ingested → versioned。各段階の途中経過は reconcile_state_json に置き、ページ / ファイル単位で再開する */
  private async ingest(job: JobRow, missingError: string): Promise<string> {
    let stage = job.reconcile_stage;
    let state = parseJson<ReconcileState>(job.reconcile_state_json, {});
    const sid = job.session_id!;
    if (stage === 'none') {
      state = {};
      await this.saveStage('inspected', state);
      stage = 'inspected';
    }

    if (stage === 'inspected') {
      let list = state.list ?? { cursor: null, items: [], round: 0, complete: false };
      let byPath = new Map<string, ListedFile>();
      for (;;) {
        while (!list.complete) {
          await this.extend();
          const p = await this.port.listFilesPage(sid, list.cursor, this.call);
          for (const f of p.data) {
            const path = normalizeOutputPath(f.filename);
            if (path) list.items.push({ file_id: f.id, filename: path, size: f.size_bytes, created_at: f.created_at });
          }
          if (list.items.length > LIST_ITEMS_MAX) return this.fail(job, 'invalid_outputs');
          list = { ...list, cursor: p.next, complete: !p.next };
          state = { ...state, list };
          await this.saveStage('inspected', state);
        }
        byPath = new Map();
        for (const f of list.items) {
          const prev = byPath.get(f.filename);
          if (!prev || prev.created_at < f.created_at) byPath.set(f.filename, f);
        }
        const missing = REQUIRED_FILES.filter((r) => !byPath.has(r));
        if (missing.length === 0) break;
        // 最後のページまで見ても必須ファイルが欠けている → 3 秒待って 2 回まで取り直す
        if (list.round >= 2) return this.fail(job, missingError);
        list = { cursor: null, items: [], round: list.round + 1, complete: false };
        state = { ...state, list };
        await this.saveStage('inspected', state);
        if (Date.now() > this.deadline - 9_000) throw new OutOfTime();
        await sleep(3_000);
      }
      const files = [...byPath.values()];
      if (files.length > MAX_FILES || files.some((f) => f.size > MAX_FILE_BYTES)) return this.fail(job, 'invalid_outputs');
      state = { files: files.map(({ file_id, filename, size }) => ({ file_id, filename, size })), done: [] };
      await this.saveStage('listed', state);
      stage = 'listed';
    }

    const prefix = `materials/${job.material_id}/${job.id}/`;
    if (stage === 'listed') {
      const done = new Set(state.done ?? []);
      for (const f of state.files ?? []) {
        if (done.has(f.file_id)) continue;
        await this.extend();
        const bytes = await this.port.downloadFile(f.file_id, this.call);
        if (bytes.byteLength > MAX_FILE_BYTES) return this.fail(job, 'invalid_outputs');
        await this.extend(); // R2 に書く直前にも所有権を確かめる
        await this.env.R2.put(prefix + f.filename, bytes);
        done.add(f.file_id);
        state = { ...state, done: [...done] };
        await this.saveStage('listed', state);
      }
      await this.saveStage('ingested', state);
      stage = 'ingested';
    }

    if (stage !== 'ingested') return 'noop';

    // versioned: R2 の本文で検証
    const files = new Map<string, Uint8Array>();
    for (const f of state.files ?? []) {
      const obj = await this.env.R2.get(prefix + f.filename);
      if (!obj) {
        await this.saveStage('listed', { files: state.files, done: [] }); // R2 に無い → 取り直す
        return 'refetch';
      }
      files.set(f.filename, new Uint8Array(await obj.arrayBuffer()));
    }
    const schema = validateOutputs(files);
    if (!schema.ok) {
      await this.casJob('last_error = ?', '', schema.detail.slice(0, 200));
      return this.fail(job, 'invalid_outputs');
    }
    const citeSources = schema.sources.map((s) => ({ id: s.id, url: s.url, quoted_excerpt: s.quoted_excerpt, is_primary: s.is_primary }));

    // events を古い順に最後のページまで。ページごとに集計と続き位置を保存する
    let ev = state.ev ?? { cursor: null, acc: newCitationAcc(), grader: null, complete: false };
    for (let i = 0; !ev.complete; i++) {
      if (i >= MAX_PAGES) throw new Error('too_many_pages');
      await this.extend();
      const p = await this.port.listEventsPage(sid, { order: 'asc', page: ev.cursor }, this.call);
      accumulateCitations(ev.acc, citeSources, p.data);
      let grader = ev.grader;
      for (const e of p.data) {
        const x = e as { type?: unknown; result?: unknown; explanation?: unknown };
        if (x.type === 'span.outcome_evaluation_end') grader = { result: String(x.result ?? ''), explanation: String(x.explanation ?? '') };
      }
      ev = { cursor: p.next, acc: ev.acc, grader, complete: !p.next };
      state = { ...state, ev };
      await this.saveStage('ingested', state);
    }
    const cit = finishCitations(ev.acc, citeSources);
    const grader = ev.grader;

    const dec = new TextDecoder();
    const texts = new Map<string, string>();
    for (const [p, b] of files) if (p.startsWith('parts/')) texts.set(p, dec.decode(b));
    const forb = checkForbidden({
      texts,
      summary_elementary: schema.material.summary_elementary,
      summary_secondary: schema.material.summary_secondary,
      claims: schema.claims,
      sourceIds: schema.sources.map((s) => s.id),
    });
    const digest = await crypto.subtle.digest('SHA-256', contentDigestInput(files));
    const sha = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    const checks = { schema: 'ok', citations: cit.summary, ...forb };

    const now = nowIso();
    const versionId = crypto.randomUUID();
    const P = `SELECT 1 FROM factory_jobs pj WHERE pj.id = ? AND pj.status IN ('running','budget_reached') AND pj.reconcile_token = ?`;
    const pp = [job.id, this.token];
    const stmts: Stmt[] = [
      stmt(
        `INSERT INTO material_versions (id, material_id, version, job_id, session_id, r2_prefix, content_sha256, material_json, claims_json, adapt_rules_md,
           selfcheck_md, grader_result, grader_explanation, checks_json, public_paths_json, tech_dependencies_json, status, verification_status,
           verification_attempts, list_cost_cents, created_at)
         SELECT ?, ?, (SELECT COALESCE(MAX(version), 0) + 1 FROM material_versions WHERE material_id = ?), ?, ?, ?, ?, ?, ?, ?,
           ?, ?, ?, ?, ?, ?, 'review', 'pending', 0, ?, ?
         WHERE EXISTS (${P})`,
        versionId,
        job.material_id,
        job.material_id,
        job.id,
        job.session_id,
        prefix,
        sha,
        dec.decode(files.get('material.json')!),
        dec.decode(files.get('claims.json')!),
        schema.adaptRulesMd,
        schema.selfcheckMd,
        grader?.result ?? null,
        grader?.explanation ?? null,
        JSON.stringify(checks),
        JSON.stringify(schema.publicPaths),
        JSON.stringify(schema.techDependencies),
        job.list_cost_cents,
        now,
        ...pp,
      ),
    ];
    for (const s of schema.sources) {
      const c = cit.sources.find((x) => x.source_id === s.id)!;
      stmts.push(
        stmt(
          `INSERT INTO sources (id, material_version_id, source_id, url, title, accessed_at, quoted_excerpt, license, is_primary, url_was_fetched, quote_found, check_detail)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (${P})`,
          crypto.randomUUID(),
          versionId,
          s.id,
          s.url,
          s.title,
          s.accessed_at,
          s.quoted_excerpt,
          s.license,
          s.is_primary ? 1 : 0,
          c.url_was_fetched,
          c.quote_found,
          c.check_detail,
          ...pp,
        ),
      );
    }
    stmts.push(
      stmt(`UPDATE materials SET work_status = 'review', updated_at = ? WHERE id = ? AND EXISTS (${P})`, now, job.material_id, ...pp),
      stmt(
        `UPDATE factory_jobs SET status = 'done', reconcile_stage = 'versioned', updated_at = ? WHERE id = ? AND status IN ('running','budget_reached') AND reconcile_token = ?`,
        now,
        ...pp,
      ),
    );
    const r = await conditionalBatch(this.db, stmts);
    if (!r.ok) return 'discarded';
    console.log(JSON.stringify({ at: 'ingest', job_id: job.id, version_id: versionId }));
    return 'versioned';
  }
}

export async function markWebhookProcessed(db: D1Database, eventId: string): Promise<void> {
  await cas(db, stmt('UPDATE webhook_events SET processed_at = ? WHERE event_id = ? AND processed_at IS NULL', nowIso(), eventId));
}
