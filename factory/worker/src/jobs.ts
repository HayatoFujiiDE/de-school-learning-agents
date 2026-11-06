// job の起動（startJob）・回答（answerJob）・取消（cancelJob）・回収（reconcileJob）。契約 §B-4。
// すべての書き込みは CAS か §B-2 の条件付き batch。reconcile の書き込みには必ず reconcile_token を付ける。
// ログには id と状態名だけを出す（brief・回答・ページ本文・秘密は出さない）。

import type { BetaManagedAgentsEventParams } from '@anthropic-ai/sdk/resources/beta/sessions/events';
import type { SessionCreateParams } from '@anthropic-ai/sdk/resources/beta/sessions/sessions';
import { PortError, type CallOpts, type FactoryPort, type FileMeta } from './anthropic';
import { accumulateCitations, finishCitations, isCitationAcc, newCitationAcc, type CitationAcc } from './checks/citations';
import { versionVideosOf } from './videos';
import { checkForbidden } from './checks/forbidden';
import { basenameOf, duplicateBasename, resolveOutputLayout } from './checks/layout';
import {
  MAX_FILE_BYTES,
  MAX_FILES,
  REQUIRED_FILES,
  contentDigestInput,
  imageRefsOf,
  isSafeRelativePath,
  normalizeOutputPath,
  validateOutputs,
} from './checks/schema';
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
import {
  IMAGE_JOB_LIMIT,
  IMAGE_TOOL_NAME,
  enqueueImage,
  getImage,
  getImageByToolUse,
  imageDenies,
  imageResultEvent,
  imageToolUseIdsIn,
  isTerminalImage,
  keptImageInput,
  registerImage,
} from './images';
import { activeMakerNotes, makerNoteLines } from './retro';
import { OutOfTime, SAVE_FAILURES_MAX, ScanLimit, ScanStalled, runScan, stateJsonForSave, type ScanIO, type ScanState } from './scan';
import { isActiveJob, isReingestable, isTerminalJob } from './state';
import {
  YOUTUBE_INFO_PER_RECONCILE,
  YOUTUBE_INFO_TOOL_NAME,
  keptYoutubeInfoInput,
  youtubeInfoIdOf,
  youtubeInfoResult,
  ytInfoCallClaimStmt,
  ytInfoSentClaimStmt,
  ytInfoSentKey,
  ytInfoSentOver,
  type OEmbedPort,
  type OEmbedResult,
} from './youtube-oembed';

export { OutOfTime } from './scan';

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
/** §M-5: 職人定義に無い custom tool への custom_tool_result の本文（generate_image は §O の画像生成で扱う） */
export const CUSTOM_TOOL_UNAVAILABLE_MESSAGE = '画像生成はまだ使えません。図は SVG で描いてください。';
/** 職人（factory/claude/agents/material-maker.md）が定義する custom tool の名前（§O-2 = 旧 §M-2-2 b・§Q-13 5 の youtube_info） */
// 文字列で持つ（images.ts からの import は index → cron → images → jobs の循環で初期化前に評価され undefined になる）
export const MAKER_CUSTOM_TOOLS: readonly string[] = ['generate_image', 'youtube_info'];
/** §M-5: この custom tool 呼び出しは is_error の結果で返すか（generate_image・youtube_info 以外の custom tool は従来どおり is_error） */
export const rejectsCustomTool = (name: string): boolean => !MAKER_CUSTOM_TOOLS.includes(name);
/**
 * §M-5b: requires_action の event_ids のうち、events を最後のページまで辿っても種別が分からないものには何も送らない
 * （custom tool に tool_confirmation を送ると API が 400 を返し回復できない）。同じ idle event について BLOCKED_RECOUNT_MS 以上の間隔で
 * 数え、BLOCKED_UNRESOLVED_MAX 回（約 10 分以上）になったら job を failed（error='blocked_event_unresolved'）。idle event が変わったら 0 から
 */
export const BLOCKED_UNRESOLVED_MAX = 3;
export const BLOCKED_RECOUNT_MS = 5 * 60_000;
/** §M-5b の状態（reconcile_state_json.blocked_unresolved） */
export interface BlockedWait {
  idle_event_id: string | null;
  first_seen_at: string;
  count: number;
  next_at: string;
}
const isBlockedWait = (x: unknown): x is BlockedWait => {
  const w = x as BlockedWait | null;
  return (
    !!w &&
    typeof w === 'object' &&
    (w.idle_event_id === null || typeof w.idle_event_id === 'string') &&
    typeof w.first_seen_at === 'string' &&
    Number.isInteger(w.count) &&
    typeof w.next_at === 'string' &&
    Number.isFinite(Date.parse(w.next_at))
  );
};
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
  // §S-5 2: 振り返り係の active の maker_note（古い順 8 件まで）。1 件も無ければ見出しごと出さない（従来の文と 1 文字も変わらない）。
  // 作り直し（rework）の job も startJob からこの文で始まる。読めない時（migration 0006 の前など）は入れずに進める
  let notes: string[] = [];
  try {
    notes = await activeMakerNotes(db);
  } catch (e) {
    console.log(JSON.stringify({ at: 'phase1', retro_notes: 'unavailable', kind: errorKind(e) }));
  }
  return [
    '# 注文票',
    briefMd,
    '',
    '# 編集基準',
    EDITORIAL_STANDARDS.trim(),
    '## これまでの回答と差し戻し理由（全素材・新しい順・最大 40 件）',
    ...(lines.length ? lines : ['- （まだありません）']),
    '',
    ...makerNoteLines(notes),
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
// 共通: events / files をページで辿る（§B-4-d「最後のページまで」）。続き位置と途中集計は src/scan.ts の runScan が
// reconcile_state_json.scan.<目的> に保存し、時間切れの後は続きから再開する

export const MAX_PAGES = 500; // ページ数の上限（runScan の走査は呼び出しをまたいだ合計、ingest の古い順の読みは 1 回の呼び出しごと。1 ページ 20 件でも 1 万件）

/** event の id（SDK の BetaManagedAgents*Event は全 type が id: string を持つ） */
const eventId = (e: unknown): string | null => {
  const id = (e as { id?: unknown } | null)?.id;
  return typeof id === 'string' ? id : null;
};

/** reconcile_state_json の保存が終端の失敗になった（大きすぎる / 保存の例外が続いた） */
class StateWriteStop extends Error {
  constructor(public readonly code: 'state_too_large' | 'save_failed') {
    super(code);
    this.name = 'StateWriteStop';
  }
}

/** 保存の例外の回数だけを、保存済みの JSON に足す（大きな本体は書き直さない） */
const BUMP_SAVE_FAILURES_SQL = `json_set(CASE WHEN json_valid(reconcile_state_json) THEN reconcile_state_json ELSE '{}' END, '$.save_failures', ?)`;

/**
 * reconcile_state_json を書く直前のガード（§R-32 の段階保存の共通部分）:
 * - JSON が STATE_MAX_BYTES を超えたら書かずに StateWriteStop('state_too_large')（D1 の行上限に当てない）
 * - write が例外なら回数を bump で残し、SAVE_FAILURES_MAX 回目で StateWriteStop('save_failed')。それ未満は例外をそのまま投げる
 * 戻り値: write の CAS 結果（false = 所有権を失った）と、保存した state（save_failures は成功で 0 に戻るので持たない）
 */
async function guardedStateWrite(
  state: ReconcileState,
  write: (json: string) => Promise<boolean>,
  bump: (n: number) => Promise<unknown>,
): Promise<{ ok: boolean; state: ReconcileState }> {
  const json = stateJsonForSave(state as Record<string, unknown>);
  if (json === null) throw new StateWriteStop('state_too_large');
  let ok: boolean;
  try {
    ok = await write(json);
  } catch (e) {
    const n = (Number.isInteger(state.save_failures) ? state.save_failures! : 0) + 1;
    await bump(n).catch(() => undefined);
    if (n >= SAVE_FAILURES_MAX) throw new StateWriteStop('save_failed');
    throw e;
  }
  const { save_failures: _drop, ...rest } = state;
  return { ok, state: rest };
}

const deadlineGuard = (deadline: number) => async () => {
  if (Date.now() > deadline - 5_000) throw new OutOfTime();
};

/**
 * answer 側の走査保存（reconcile_state_json.scan.answer）。述語 = needs_answer かつ sending かつ answer_token 一致。
 * needs_answer の間に書けるのはこの文だけ（reconcile 側の writeState は status IN ('running','budget_reached') が述語なので書けない）
 */
export function answerScanSaveStmt(p: { json: string; lastError: string | null; now: string; jobId: string; token: string }): Stmt {
  return stmt(
    `UPDATE factory_jobs SET reconcile_state_json = ?, last_error = COALESCE(?, last_error), updated_at = ?
     WHERE id = ? AND status = 'needs_answer' AND answer_state = 'sending' AND answer_token = ?`,
    p.json,
    p.lastError,
    p.now,
    p.jobId,
    p.token,
  );
}

/** reconcile 側の reconcile_state_json 保存（stage=null なら reconcile_stage は変えない）。述語 = status IN ('running','budget_reached') かつ reconcile_token 一致 */
export function reconcileStateWriteStmt(p: {
  stage: string | null;
  json: string;
  lastError: string | null;
  now: string;
  jobId: string;
  token: string;
}): Stmt {
  const set =
    p.stage === null
      ? 'reconcile_state_json = ?, last_error = COALESCE(?, last_error)'
      : 'reconcile_stage = ?, reconcile_state_json = ?, last_error = COALESCE(?, last_error)';
  const setParams = p.stage === null ? [p.json, p.lastError] : [p.stage, p.json, p.lastError];
  return stmt(
    `UPDATE factory_jobs SET ${set}, updated_at = ? WHERE (status IN ('running','budget_reached')) AND id = ? AND reconcile_token = ?`,
    ...setParams,
    p.now,
    p.jobId,
    p.token,
  );
}

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
// reingest（§B-4-e）: 取り込みで失敗した job を、session を作らずに取り込み直す。failed → running の唯一の経路（§C-2、§R-43）

/** 述語（§B-4-e 1）。CAS の WHERE にもそのまま入れる */
export const REINGEST_PREDICATE_SQL = "status = 'failed' AND error = 'invalid_outputs' AND session_id IS NOT NULL";

/** 同じ素材に、この job（別名 self）より created_at が新しい job が無い（§B-4-e 1。後の注文を古い成果物で上書きしない） */
const NO_NEWER_JOB_SQL = (self: string) =>
  `NOT EXISTS (SELECT 1 FROM factory_jobs nj WHERE nj.material_id = ${self}.material_id AND nj.created_at > ${self}.created_at)`;

/**
 * §B-4-e 2 の batch（§B-2 のパターン: 述語の列を変える job の UPDATE を最後に 1 文）。
 * 先に material を making（WHERE work_status='idle' AND EXISTS(job の述語)）、最後に job を running へ。
 * job の述語 = §B-4-e 1 + 「この job より新しい job が無い」（materials の列には依存しない）。
 * 同じ素材に active な job があれば最後の UPDATE が idx_jobs_one_active_per_material に当たり、batch 全体が巻き戻る
 */
export function reingestClaimStmts(p: { jobId: string; materialId: string; now: string }): Stmt[] {
  const P = `SELECT 1 FROM factory_jobs pj WHERE pj.id = ? AND pj.material_id = ? AND pj.status = 'failed' AND pj.error = 'invalid_outputs'
    AND pj.session_id IS NOT NULL AND ${NO_NEWER_JOB_SQL('pj')}`;
  return [
    stmt(
      `UPDATE materials SET work_status = 'making', updated_at = ? WHERE id = ? AND work_status = 'idle' AND EXISTS (${P})`,
      p.now,
      p.materialId,
      p.jobId,
      p.materialId,
    ),
    stmt(
      `UPDATE factory_jobs SET status = 'running', reconcile_stage = 'none', reconcile_state_json = '{}', error = NULL, last_error = NULL,
         last_checked_at = NULL, reconcile_token = NULL, reconcile_until = NULL, updated_at = ?
       WHERE id = ? AND material_id = ? AND ${REINGEST_PREDICATE_SQL} AND ${NO_NEWER_JOB_SQL('factory_jobs')}`,
      p.now,
      p.jobId,
      p.materialId,
    ),
  ];
}

/** §B-4-e 1〜2。成功（running にした）なら null、そうでなければ返すべき応答 */
export async function claimReingest(env: Env, jobId: string): Promise<ApiResult | null> {
  const db = env.DB;
  const job = await getJob(db, jobId);
  if (!job) return err(404, 'not_found');
  if (!isReingestable(job)) return err(409, 'not_reingestable');
  const material = await getMaterial(db, job.material_id);
  if (!material) return err(404, 'material_not_found');
  // 素材が待機（idle）で、この job が同じ素材の最新の job であること（確認待ちの版や後の注文を古い成果物で上書きしない）
  if (material.work_status !== 'idle') return err(409, 'material_busy');
  const newer = await first<{ n: number }>(
    db,
    stmt('SELECT COUNT(*) AS n FROM factory_jobs WHERE material_id = ? AND created_at > ?', job.material_id, job.created_at),
  );
  if (Number(newer?.n ?? 0) > 0) return err(409, 'material_busy');
  let r;
  try {
    r = await conditionalBatch(db, reingestClaimStmts({ jobId, materialId: job.material_id, now: nowIso() }));
  } catch (e) {
    if (isUniqueViolation(e)) return err(409, 'material_busy');
    throw e;
  }
  // job の UPDATE が 0 行（同時に 2 回押した後の方など）。material の UPDATE も同じ述語で 0 行
  if (!r.ok) return err(409, 'not_reingestable');
  console.log(JSON.stringify({ at: 'reingest', job_id: jobId }));
  return null;
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

/** answer の排他（answer_token）を他の呼び出しに取られた */
class LostAnswerClaim extends Error {
  constructor() {
    super('lost_answer_claim');
    this.name = 'LostAnswerClaim';
  }
}

/** 回答送信中（answer_token を持つ）に終端の失敗が起きた時: job failed + material idle（§B-2 の条件付き batch、述語 = needs_answer かつ answer_token 一致） */
async function failAnswering(db: D1Database, job: JobRow, token: string, error: string): Promise<boolean> {
  const now = nowIso();
  const P = `SELECT 1 FROM factory_jobs pj WHERE pj.id = ? AND pj.status = 'needs_answer' AND pj.answer_token = ?`;
  const r = await conditionalBatch(db, [
    stmt(`UPDATE materials SET work_status = 'idle', updated_at = ? WHERE id = ? AND work_status = 'making' AND EXISTS (${P})`, now, job.material_id, job.id, token),
    stmt(
      `UPDATE factory_jobs SET status = 'failed', error = ?, last_error = ?, answer_state = 'saved', answer_token = NULL, updated_at = ?
       WHERE id = ? AND status = 'needs_answer' AND answer_token = ?`,
      error,
      error,
      now,
      job.id,
      token,
    ),
  ]);
  return r.ok;
}

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
  // 走査の続き位置は reconcile_state_json.scan.answer。書くのは answer_token を持つこの呼び出しだけ
  // （needs_answer の間 reconcile は reconcile_state_json を書かない: 書き込みの述語が status IN ('running','budget_reached')）
  let state = parseJson<ReconcileState>((await getJob(db, jobId))?.reconcile_state_json, {});
  const saveScan = async (s: ScanState<{ found: boolean }>, lastError?: string): Promise<void> => {
    const r = await guardedStateWrite(
      { ...state, scan: { ...state.scan, answer: s } },
      (json) => cas(db, answerScanSaveStmt({ json, lastError: lastError ?? null, now: nowIso(), jobId, token })),
      (n) => cas(db, stmt(`UPDATE factory_jobs SET reconcile_state_json = ${BUMP_SAVE_FAILURES_SQL} WHERE id = ? AND answer_token = ?`, n, jobId, token)),
    );
    if (!r.ok) throw new LostAnswerClaim();
    state = r.state;
  };
  try {
    // 4. 送信（define_outcome が既にあれば送らない。全ページを見て確定する。時間切れなら続き位置を残して、次の送信で続きから）
    const found = await runScan<unknown, { found: boolean }>({
      saved: state.scan?.answer,
      base: { purpose: 'answer', job_status: 'needs_answer', job_phase: job.phase, session_status: null },
      init: () => ({ found: false }),
      fetch: (cursor) => port.listEventsPage(job!.session_id!, { order: 'desc', page: cursor }, { deadline }),
      idOf: eventId,
      fold: (agg, items) => {
        if (items.some((e) => (e as { type?: unknown } | null)?.type === 'user.define_outcome')) agg.found = true;
        return agg.found;
      },
      before: deadlineGuard(deadline),
      save: saveScan,
      maxPages: MAX_PAGES,
    });
    if (!found.agg.found) {
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
    // 終端: 走査が進まない / 上限 / state を保存できない → job を failed にして止める（無限に再試行しない）
    const terminal =
      e instanceof ScanStalled ? 'scan_stalled' : e instanceof ScanLimit ? e.code : e instanceof StateWriteStop ? e.code : null;
    if (terminal) {
      const failed = await failAnswering(db, job, token, terminal);
      console.log(JSON.stringify({ at: 'answer', job_id: jobId, result: failed ? `failed:${terminal}` : 'state_changed' }));
      return err(409, 'not_waiting', terminal);
    }
    if (e instanceof LostAnswerClaim) return err(409, 'answer_in_flight');
    // 6. 失敗 → saved に戻す
    await cas(
      db,
      stmt(
        `UPDATE factory_jobs SET answer_state = 'saved', answer_token = NULL, last_error = ? WHERE id = ? AND answer_token = ? AND answer_state = 'sending'`,
        e instanceof OutOfTime ? (e.noProgress ? 'scan_no_progress' : 'events_scan_incomplete') : errorKind(e),
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
/**
 * 保存済みの走査から集計（agg / 続き位置）だけを捨て、連続時間切れの回数（stalls・ctx）は残す。
 * pages=0 の state は decideResume が必ず restart にし、carriedStalls は stalls を引き継ぐ（scan.ts の契約）
 */
function restartScanKeepingStalls<A>(saved: unknown, agg: A): unknown {
  if (!saved || typeof saved !== 'object') return saved;
  return { ...(saved as Record<string, unknown>), cursor: null, pages: 0, seen: 0, done: false, agg };
}
/** deny（tool_confirmation の deny / custom tool の is_error）の数がこれを超えたら too_many_denies で止める */
const DENY_MAX = 8;
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
  /** 走査の途中経過（src/scan.ts の ScanState。目的ごと）。本文は持たない */
  scan?: { answer?: unknown; idle?: unknown; files?: unknown };
  /** 保存（D1 書き込み）の例外が続いた回数。成功した保存で消える */
  save_failures?: number;
  /** requires_action で種別の分からない event_id が残っている待ち（§M-5b。idle event ごと。別の待ち・進行で消える） */
  blocked_unresolved?: BlockedWait;
  /** inspected: files.list の途中経過（ページの続き位置）。complete になってから必須ファイルを判定する */
  list?: { cursor: string | null; items: ListedFile[]; round: number; complete: boolean };
  /** listed / ingested: 取り込むファイルと、R2 に置き終えた file_id */
  files?: Array<{ file_id: string; filename: string; size: number }>;
  done?: string[];
  /** ingested（versioned の途中）: 論理 Map の全ファイルを論理キーへ置き終えた。再入時は置き直さない（raw/ を取り直す時は消える） */
  /** 論理キーへの配置と parts/ の古いキーの掃除が両方済んだ印（§R-47。旧名 placed は掃除を含まないので読まない） */
  placed_clean?: boolean;
  /** ingested: events（古い順）の途中経過。本文は持たず、出典照合の集計と採点結果だけ */
  ev?: { cursor: string | null; acc: CitationAcc; grader: { result: string; explanation: string } | null; complete: boolean };
  /**
   * §Q-13 5・裁定 a: 「この id は youtube_info」という種別の記録（返したかどうかの記録ではない）。送る前に保存する。
   * 値は毎回 (前の info_event_ids ∩ 今の idle の event_ids) ∪ 今回処理する id（今の待ちの分だけ。件数の上限は置かない）
   */
  info_event_ids?: string[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * deadline: waitUntil 経由は開始から 25 秒、cron 経由は 10 分。外部呼び出しは min(残り時間, 60 秒)・再試行 0。
 * opts.oembed: 職人の道具 youtube_info（§Q-13）が使う oEmbed の port。渡されなければ oEmbed を呼ばず unavailable の結果を返す（fail-soft）
 */
export async function reconcileJob(env: Env, port: FactoryPort, jobId: string, opts: { deadline: number; oembed?: OEmbedPort }): Promise<string> {
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
  const r = new Reconciler(env, port, jobId, token, opts.deadline, opts.oembed);
  let result = 'error';
  try {
    result = await r.run();
  } catch (e) {
    if (e instanceof LostLease) result = 'lost_lease';
    else if (e instanceof OutOfTime && e.noProgress) result = 'deferred_no_progress';
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

/** 終端へ落とした（または落とそうとして状態が変わっていた）。result はログ用の状態名 */
class Stopped extends Error {
  constructor(public readonly result: string) {
    super(result);
    this.name = 'Stopped';
  }
}

class Reconciler {
  private db: D1Database;
  /** reconcile_state_json の今の中身（この lease で書いた最新）。書くのは writeState だけ */
  private state: ReconcileState = {};
  constructor(
    private env: Env,
    private port: FactoryPort,
    private jobId: string,
    private token: string,
    private deadline: number,
    private oembed?: OEmbedPort,
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
    try {
      return await this.runInner();
    } catch (e) {
      if (e instanceof Stopped) return e.result;
      throw e;
    }
  }

  private async runInner(): Promise<string> {
    let job = await this.load();
    this.state = parseJson<ReconcileState>(job.reconcile_state_json, {});
    if (isTerminalJob(job.status) || job.status === 'queued' || job.status === 'creating') return 'noop';
    if (!job.session_id) return 'no_session';

    // 2. retrieve + 費用
    await this.extend();
    const session = await this.port.retrieveSession(job.session_id, this.call);
    job = await this.recordCost(job, session.listCostCents);

    // 0-a. deny 数の上限超え（件数は保存したが interrupt / archive / failed の前に落ちた）は、session の状態に関わらずここで止める。
    // 数 = deny_count + 画像の断り・失敗（§O-3 b の imageDenies）
    const overLimit = await this.stopIfTooManyDenies(job, job.deny_count + (await imageDenies(this.db, job.id)));
    if (overLimit !== null) return overLimit;
    // 0-a'. youtube_info の結果の数が上限を超えた印（値 41。裁定 i）があれば、session の状態に関わらずここで止める
    // （interrupt・archive の後、failed の保存の前に落ちた形をやり直す。行が無い job = 道具を使っていない job は止まらない）
    if (ytInfoSentOver(await getSetting(this.db, ytInfoSentKey(job.id)))) return this.tooManyDenies(job, 'too_many_youtube_info');

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
        await this.clearBlockedWait(job); // 待ちから進んだ（§M-5b）
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
        return this.onIdle(job, session.status);
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
  private async fail(job: JobRow, error: string, alsoLastError = false): Promise<string> {
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
        `UPDATE factory_jobs SET status = 'failed', error = ?, last_error = COALESCE(?, last_error), updated_at = ?
         WHERE id = ? AND reconcile_token = ? AND status = ? AND phase = ? AND status IN ('running','needs_answer','budget_reached')`,
        error,
        alsoLastError ? error : null,
        now,
        job.id,
        this.token,
        job.status,
        job.phase,
      ),
    ]);
    return r.ok ? `failed:${error}` : 'state_changed';
  }

  /**
   * 走査（idle / files）を reconcile_state_json.scan.<key> に所有権付きで保存しながら進め、時間切れの後は続きから再開する。
   * 終端の失敗（連続時間切れ / ページ・件数の上限 / state を保存できない）は job を failed にして Stopped を投げる
   */
  private async scan<T, A>(
    job: JobRow,
    key: 'idle' | 'files',
    opts: Omit<ScanIO<T, A>, 'saved' | 'before' | 'save' | 'maxPages'> & {
      /** false を返した保存済み途中集計は再利用も再開もせず、先頭から走査し直す（古い保存形式の集計に足りない項目がある時） */
      keepSaved?: (saved: unknown) => boolean;
    },
  ): Promise<{ agg: A; head: string | null }> {
    const { keepSaved, ...io } = opts;
    const saved = this.state.scan?.[key];
    try {
      return await runScan<T, A>({
        ...io,
        saved: saved !== undefined && keepSaved && !keepSaved(saved) ? restartScanKeepingStalls(saved, io.init()) : saved,
        before: this.extend,
        save: (st, lastError) => this.writeState(job, null, { ...this.state, scan: { ...this.state.scan, [key]: st } }, lastError),
        maxPages: MAX_PAGES,
      });
    } catch (e) {
      if (e instanceof ScanStalled) throw new Stopped(await this.fail(job, 'scan_stalled', true));
      if (e instanceof ScanLimit) throw new Stopped(await this.fail(job, e.code, true));
      throw e;
    }
  }

  /**
   * deny 数の上限判定の唯一の場所。count（保存済みの deny_count）が上限を超えていたら止めて片付け、failed にした結果を返す。超えていなければ null。
   * reconcile の入口（保存済みの値）と、requires_action で件数を保存した直後に呼ぶ
   */
  private async stopIfTooManyDenies(job: JobRow, count: number): Promise<string | null> {
    return count > DENY_MAX ? this.tooManyDenies(job) : null;
  }

  /** deny 数が上限を超えた（error = too_many_denies）/ youtube_info の結果の数が上限を超えた（too_many_youtube_info。裁定 b・i）: 止めて片付け、failed にする */
  private async tooManyDenies(job: JobRow, error: 'too_many_denies' | 'too_many_youtube_info' = 'too_many_denies'): Promise<string> {
    await this.extend();
    await this.port.sendEvents(job.session_id!, [{ type: 'user.interrupt' }], this.call).catch(() => undefined);
    await this.port.archiveSession(job.session_id!, this.call).catch(() => undefined);
    return this.fail(job, error);
  }

  private async onIdle(job: JobRow, sessionStatus: string): Promise<string> {
    // 新しい順に辿り、最新の status_idle・最新の outcome_evaluation_end・define_outcome の有無を集める。
    // end_turn の時は define_outcome が見つかるまで（無ければ最後のページまで）辿ってから「既送なし」を確定する。
    // 途中集計（id と種別だけ。本文は持たない）は scan.idle に保存し、時間切れの後は続きから（先頭 event が変わっていたら先頭から）
    // requires_action の時は、まだ返していない event_ids の event 種別（custom_tool_use なら name も。generate_image だけは input も §O-3 b 1）を
    // 全部見つかるか最後のページに達するまで探す（§M-5。件数で打ち切らない。時間切れは保存した続き位置から、ページ数の上限は scan_too_many_pages）
    type Blocked = { type: string; name?: string; input?: unknown };
    type IdleAgg = {
      /** id は §M-5b の待ちの識別（古い保存形式には無い → null） */
      idle: { id?: string | null; type: string; event_ids: string[] } | null;
      evalEnd: { result: string } | null;
      hasOutcome: boolean;
      blocked?: Record<string, Blocked>;
      /**
       * 最新の status_idle より新しい user.tool_confirmation / user.custom_tool_result が返した id（重複なし）。
       * 送信は成功したが denied_event_ids_json の保存前に落ちた分を、次の reconcile で送り直さないために使う（古い保存形式には無い → []）
       */
      answered?: string[];
    };
    const alreadyDenied = new Set(parseJson<string[]>(job.denied_event_ids_json, []));
    const { agg: seen, head } = await this.scan<unknown, IdleAgg>(job, 'idle', {
      base: { purpose: 'idle', job_status: job.status, job_phase: job.phase, session_status: sessionStatus },
      init: () => ({ idle: null, evalEnd: null, hasOutcome: false, blocked: {}, answered: [] }),
      // answered を持たない古い保存形式の集計は、idle より新しい返答を集めていない。続きから使うと返答を見落として送り直すので捨てる。
      // generate_image・youtube_info なのに input を持たない項目（§O・§Q-13 の前の保存形式）がある集計も捨てる（§O-3 b 1・§Q-13 5）
      keepSaved: (saved) => {
        const agg = (saved as { agg?: unknown } | null)?.agg;
        if (!(agg && typeof agg === 'object')) return true;
        if (!Array.isArray((agg as { answered?: unknown }).answered)) return false;
        const blocked = (agg as { blocked?: unknown }).blocked;
        if (!blocked || typeof blocked !== 'object') return true;
        return Object.values(blocked as Record<string, Blocked>).every(
          (b) => !(b && b.type === 'agent.custom_tool_use' && (b.name === IMAGE_TOOL_NAME || b.name === YOUTUBE_INFO_TOOL_NAME) && !('input' in b)),
        );
      },
      fetch: (cursor) => this.port.listEventsPage(job.session_id!, { order: 'desc', page: cursor }, this.call),
      idOf: eventId,
      fold: (agg, items) => {
        for (const raw of items) {
          const e = (raw ?? {}) as {
            id?: unknown;
            type?: unknown;
            name?: unknown;
            input?: unknown;
            result?: unknown;
            tool_use_id?: unknown;
            custom_tool_use_id?: unknown;
            stop_reason?: { type?: unknown; event_ids?: unknown };
          };
          // desc なので idle より先に来る = idle より新しい返答。idle を見つけた後の（前の待ちへの）返答は集めない
          if (!agg.idle && (e.type === 'user.tool_confirmation' || e.type === 'user.custom_tool_result')) {
            const id = e.type === 'user.tool_confirmation' ? e.tool_use_id : e.custom_tool_use_id;
            const answered = (agg.answered ??= []);
            if (typeof id === 'string' && !answered.includes(id)) answered.push(id);
          }
          if (!agg.idle && e.type === 'session.status_idle') {
            const ids = e.stop_reason?.event_ids;
            agg.idle = {
              id: typeof e.id === 'string' ? e.id : null,
              type: String(e.stop_reason?.type ?? ''),
              event_ids: Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : [],
            };
            if (agg.idle.type === 'requires_action') continue;
          }
          if (!agg.evalEnd && e.type === 'span.outcome_evaluation_end') agg.evalEnd = { result: String(e.result ?? '') };
          if (e.type === 'user.define_outcome') agg.hasOutcome = true;
          if (!agg.idle) continue;
          if (agg.idle.type === 'requires_action') {
            const blocked = (agg.blocked ??= {});
            if (typeof e.id === 'string' && agg.idle.event_ids.includes(e.id) && !blocked[e.id]) {
              const name = String(e.name ?? '');
              blocked[e.id] =
                e.type === 'agent.custom_tool_use'
                  ? name === IMAGE_TOOL_NAME
                    ? { type: String(e.type), name, input: keptImageInput(e.input) }
                    : name === YOUTUBE_INFO_TOOL_NAME
                      ? { type: String(e.type), name, input: keptYoutubeInfoInput(e.input) } // §Q-13 2: url の先頭 200 文字だけ
                      : { type: String(e.type), name }
                  : { type: String(e.type ?? '') };
            }
            if (agg.idle.event_ids.every((id) => alreadyDenied.has(id) || blocked[id] || agg.answered?.includes(id))) return true;
            continue;
          }
          if (agg.idle.type !== 'end_turn') return true;
          if (agg.hasOutcome) return true;
        }
        if (agg.idle?.type === 'requires_action' && agg.idle.event_ids.every((id) => alreadyDenied.has(id) || agg.blocked?.[id] || agg.answered?.includes(id)))
          return true;
        return false;
      },
    });
    const idleEv = seen.idle;
    const hasOutcome = seen.hasOutcome;
    if (!idleEv) return 'no_idle_event';
    const stop = idleEv.type;
    if (stop !== 'requires_action') await this.clearBlockedWait(job); // 別の待ち・終わりに進んだ（§M-5b）

    if (stop === 'requires_action') {
      const denied = new Set(alreadyDenied);
      // idle より新しい返答が既にある id は送らない。denied に無ければ（前回送ったが保存できなかった分）送らずに denied へ足し deny 数にも数える
      const answered = new Set(seen.answered ?? []);
      // §O-3 b 2: 画像の id（走査で見つけた generate_image ∪ D1 に行がある id）は recovered にも pending の deny にも入れない。
      // 走査は answered にあれば元の tool_use を読まずに終わることがあるので、返し済みの画像は D1 で引く（返すのは登録済みの行だけ）
      const imageIds = await imageToolUseIdsIn(this.db, job.id, idleEv.event_ids);
      for (const id of idleEv.event_ids) {
        const b = seen.blocked?.[id];
        if (b && b.type === 'agent.custom_tool_use' && b.name === IMAGE_TOOL_NAME) imageIds.add(id);
      }
      // §Q-13 5・裁定 d: info の id（state の info_event_ids にある ∪ 走査で youtube_info と分かった）は、どの場合も recovered にも pending の deny にも入れない。
      // answered にある info の id は何もしない。走査が answered を先に見て元の tool_use を読まずに終わっても、送る前に保存した state で分かる
      const prevInfo = Array.isArray(this.state.info_event_ids) ? this.state.info_event_ids.filter((x): x is string => typeof x === 'string') : [];
      const infoIds = new Set(idleEv.event_ids.filter((id) => prevInfo.includes(id)));
      for (const id of idleEv.event_ids) {
        const b = seen.blocked?.[id];
        if (b && b.type === 'agent.custom_tool_use' && b.name === YOUTUBE_INFO_TOOL_NAME) infoIds.add(id);
      }
      const recovered = idleEv.event_ids.filter((id) => !infoIds.has(id) && !imageIds.has(id) && !denied.has(id) && answered.has(id));
      const pending = idleEv.event_ids.filter((id) => !infoIds.has(id) && !imageIds.has(id) && !denied.has(id) && !answered.has(id));
      const imagePending = idleEv.event_ids.filter((id) => !infoIds.has(id) && imageIds.has(id) && !denied.has(id) && !answered.has(id));
      // 処理するのは blocked[id]（youtube_info の input つき）がある id だけ。種別だけ分かり入力が無い id には何も送らず §M-5b の数え方（裁定 d）
      const infoPending = idleEv.event_ids.filter((id) => infoIds.has(id) && !denied.has(id) && !answered.has(id));
      const infoReady = (id: string) => {
        const b = seen.blocked?.[id];
        return !!b && b.type === 'agent.custom_tool_use' && b.name === YOUTUBE_INFO_TOOL_NAME && 'input' in b;
      };
      const infoTodo = infoPending.filter(infoReady);
      const infoUnresolved = infoPending.length - infoTodo.length;
      // 送るものがあってもなくても（§M-5b の早期 return より前に）先に保存し、上限も判定する（入口の判定は保存済みの件数だけを見る）
      let count = job.deny_count;
      if (recovered.length > 0) {
        recovered.forEach((id) => denied.add(id));
        count += recovered.length;
        const saved = await this.casJob('denied_event_ids_json = ?, deny_count = ?', '', JSON.stringify([...denied]), count);
        if (!saved) throw new LostLease();
        const over = await this.stopIfTooManyDenies(job, count + (await imageDenies(this.db, job.id)));
        if (over !== null) return over;
      }
      // §Q-13 5: youtube_info を先に処理する（最大 4 件。残りは次の reconcile）。結果の数の上限を超えたら何も送らずに止める（裁定 b・i）
      let infoSent = 0;
      const infoRest = Math.max(0, infoTodo.length - YOUTUBE_INFO_PER_RECONCILE);
      if (infoTodo.length > 0) {
        const r = await this.advanceYoutubeInfo(job, infoTodo.slice(0, YOUTUBE_INFO_PER_RECONCILE), seen.blocked ?? {}, idleEv.event_ids, prevInfo);
        if (typeof r === 'string') return r;
        infoSent = r.sent;
      }
      // §O-3 b 3: 画像の依頼（無ければ登録 → queued なら queue へ / 終端なら 1 件ずつ返す / queued・dispatched なら待つ）
      const img = imagePending.length > 0 ? await this.advanceImages(job, imagePending, seen.blocked ?? {}) : { sent: 0, waiting: 0 };
      if (pending.length === 0 && infoUnresolved === 0) {
        await this.clearBlockedWait(job);
        if (img.sent > 0) return `image_results:${img.sent}`;
        // §O-3 b 5: 送るものが無く、待っている generate_image だけ（§M-5b の「種別が分からない待ち」には数えない）
        if (img.waiting > 0) return `awaiting_image:${img.waiting}`;
        // §Q-13 5: 画像のものを優先し、その次に youtube_info
        if (infoSent > 0) return `youtube_info:${infoSent}`;
        if (infoRest > 0) return `youtube_info_pending:${infoRest}`;
        return recovered.length > 0 ? `already_answered:${recovered.length}` : 'already_denied';
      }
      // §M-5b: 最後のページまで辿っても種別の分からない id には何も送らず、deny にも数えない（誤った種別の応答は API が 400 で拒み、回復を塞ぐ）。
      // 次の reconcile で先頭から探し直す（scan.idle を捨てる）。同じ idle event について 5 分以上の間隔でだけ数え、3 回で failed。
      // 裁定 d: youtube_info と分かるが入力の無い id（走査が元の tool_use に届かなかった）も同じに数える
      const ids = pending.filter((id) => seen.blocked?.[id]);
      const unresolved = pending.length - ids.length + infoUnresolved;
      if (unresolved > 0) {
        const now = Date.now();
        const idleId = idleEv.id ?? null;
        const prev = isBlockedWait(this.state.blocked_unresolved) ? this.state.blocked_unresolved : null;
        const iso = (ms: number) => new Date(ms).toISOString();
        let wait: BlockedWait;
        if (!prev || prev.idle_event_id !== idleId) wait = { idle_event_id: idleId, first_seen_at: iso(now), count: 1, next_at: iso(now + BLOCKED_RECOUNT_MS) };
        else if (now >= Date.parse(prev.next_at)) wait = { ...prev, count: prev.count + 1, next_at: iso(now + BLOCKED_RECOUNT_MS) };
        else wait = prev;
        if (wait.count >= BLOCKED_UNRESOLVED_MAX) return this.fail(job, 'blocked_event_unresolved');
        const { idle: _drop, ...scanRest } = this.state.scan ?? {};
        await this.writeState(job, null, { ...this.state, scan: scanRest, blocked_unresolved: wait }, 'blocked_event_unresolved');
        if (ids.length === 0) return `blocked_unresolved:${wait.count}`;
      } else {
        await this.clearBlockedWait(job);
      }
      await this.extend();
      // custom tool（generate_image 等。§M-5）は tool_confirmation ではなく is_error の custom_tool_result で返す。どちらも deny 数に数える
      await this.port.sendEvents(
        job.session_id!,
        ids.map((id) => {
          const b = seen.blocked?.[id];
          if (b && b.type === 'agent.custom_tool_use' && rejectsCustomTool(b.name ?? ''))
            return {
              type: 'user.custom_tool_result',
              custom_tool_use_id: id,
              content: [{ type: 'text', text: CUSTOM_TOOL_UNAVAILABLE_MESSAGE }],
              is_error: true,
            } as BetaManagedAgentsEventParams;
          return { type: 'user.tool_confirmation', tool_use_id: id, result: 'deny', deny_message: DENY_MESSAGE } as BetaManagedAgentsEventParams;
        }),
        this.call,
      );
      ids.forEach((id) => denied.add(id));
      const newCount = count + ids.length;
      const saved = await this.casJob('denied_event_ids_json = ?, deny_count = ?', '', JSON.stringify([...denied]), newCount);
      if (!saved) throw new LostLease();
      const over = await this.stopIfTooManyDenies(job, newCount + (await imageDenies(this.db, job.id)));
      if (over !== null) return over;
      return `denied:${ids.length}`;
    }

    if (stop === 'budget_reached') {
      if (job.status === 'running') await this.casJob("status = 'budget_reached'", "status = 'running'");
      return 'budget_reached';
    }

    if (stop === 'end_turn') {
      if (job.phase === 'questions') return this.onQuestionsEnd(job, hasOutcome, sessionStatus, head);
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

  /** §B-4-b */
  private async onQuestionsEnd(job: JobRow, hasOutcome: boolean, sessionStatus: string, head: string | null): Promise<string> {
    if (job.status !== 'running') return 'noop';
    // files.list を最後のページまで。集計は最新の questions.json 1 件だけ。続き位置は scan.files（文脈の head は直前の idle 走査の先頭 event）
    type QAgg = { q: { file_id: string; size: number; created_at: string } | null };
    const { agg } = await this.scan<FileMeta, QAgg>(job, 'files', {
      base: { purpose: 'files', job_status: job.status, job_phase: job.phase, session_status: sessionStatus },
      head,
      init: () => ({ q: null }),
      fetch: (cursor) => this.port.listFilesPage(job.session_id!, cursor, this.call),
      fold: (acc, items) => {
        for (const f of items) {
          if (normalizeOutputPath(f.filename) !== 'questions.json') continue;
          if (!acc.q || acc.q.created_at < f.created_at) acc.q = { file_id: f.id, size: f.size_bytes, created_at: f.created_at };
        }
        return false;
      },
      maxItems: LIST_ITEMS_MAX,
    });
    const qf = agg.q;
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
    // §R-40 (a): needs_answer へ進むと以後この job の head は再確認されない（needs_answer の間 reconcile は走査しない）。
    // files 集計（再利用を含む）の文脈 head は直前の idle 走査の先頭 event なので、遷移の直前に events を desc で 1 ページ取り直し、
    // 先頭 id が違えば遷移せず、files の途中集計を捨てて次の呼び出しに回す（次の呼び出しは idle・files とも先頭から走査し直す）
    await this.extend();
    const top = await this.port.listEventsPage(job.session_id!, { order: 'desc', page: null }, this.call);
    const headNow = top.data.length > 0 ? eventId(top.data[0]) : null;
    if (headNow !== head) {
      const { files: _stale, ...scanRest } = this.state.scan ?? {};
      await this.writeState(job, null, { ...this.state, scan: scanRest });
      return 'deferred_head_changed';
    }
    const asked = await this.casJob("status = 'needs_answer', questions_json = ?", "status = 'running' AND phase = 'questions'", JSON.stringify(questions));
    if (!asked) throw new LostLease();
    return 'needs_answer';
  }

  /**
   * §O-3 b 3: requires_action の generate_image（answered にも denied にも無い id）を進める。
   * 行が無い → 登録（I。lease を延長してから）→ 読み直して queued なら IMAGE_GEN.send（失敗は無視。cron が C1 で拾う）、refused なら下で返す。
   * 行が終端 → 職人へ返す（1 件ずつ sendEvents。送信の例外は従来の送信失敗と同じ扱い: 次の reconcile でもう一度。二重は p4a で無害）。
   * queued / dispatched → 何も送らない（待つ）。deny 数には数えない（画像の deny は imageDenies だけ）
   */
  private async advanceImages(job: JobRow, ids: string[], blocked: Record<string, { type: string; name?: string; input?: unknown }>): Promise<{ sent: number; waiting: number }> {
    let sent = 0;
    let waiting = 0;
    for (const id of ids) {
      let row = await getImageByToolUse(this.db, id);
      if (!row) {
        const b = blocked[id];
        if (!b || !('input' in b)) continue; // 走査で input を持たない（D1 に行も無い）: 画像の id ではない
        await this.extend();
        const r = await registerImage(this.env, this.port, job, id, b.input);
        row = await getImageByToolUse(this.db, id);
        console.log(JSON.stringify({ at: 'image_register', job_id: job.id, request_id: row?.id ?? null, result: r.split(':')[0], error: row?.error ?? null }));
        if (!row) continue;
        if (row.state === 'queued') await enqueueImage(this.env, row.id);
      }
      if (isTerminalImage(row.state)) {
        const ev = await imageResultEvent(this.env, row);
        await this.extend();
        await this.port.sendEvents(job.session_id!, [ev], this.call);
        sent++;
      } else waiting++;
    }
    return { sent, waiting };
  }

  /**
   * §Q-13 5・裁定 a〜c・i: requires_action の youtube_info（answered にも denied にも無く、blocked[id] に入力がある id。最大 4 件）を処理する。
   * id 1 件ごとに: 結果の数の 1 文（値が 40 を超えたら何も送らず止める）→ 入力の検査（無効ならその結果）→ oEmbed の GET の 1 文（取れなければ上限の結果）
   * → extend → oEmbed（reconcile の締め切りを渡す）→ 結果。全件の後に info_event_ids を保存 → extend → 1 回の sendEvents。
   * 止めた時は結果（failed:too_many_youtube_info 等）の文字列を返す。時間切れ（OutOfTime）は送らずに抜ける（数は使ったまま）
   */
  private async advanceYoutubeInfo(
    job: JobRow,
    ids: string[],
    blocked: Record<string, { type: string; name?: string; input?: unknown }>,
    idleEventIds: string[],
    prevInfo: string[],
  ): Promise<{ sent: number } | string> {
    const events: BetaManagedAgentsEventParams[] = [];
    for (const id of ids) {
      await cas(this.db, ytInfoSentClaimStmt(job.id, nowIso()));
      if (ytInfoSentOver(await getSetting(this.db, ytInfoSentKey(job.id)))) return this.tooManyDenies(job, 'too_many_youtube_info');
      const youtubeId = youtubeInfoIdOf(blocked[id]?.input);
      let r: OEmbedResult | { outcome: 'invalid_url' | 'limit_reached' };
      if (youtubeId === null) r = { outcome: 'invalid_url' }; // 数（oEmbed の GET）を使わない
      else if (!this.oembed) r = { outcome: 'unavailable' }; // port が届いていない呼び出し元（fail-soft。GET しないので数も使わない）
      else if (!(await cas(this.db, ytInfoCallClaimStmt(job.id, nowIso())))) r = { outcome: 'limit_reached' };
      else {
        await this.extend();
        r = await this.oembed.lookup(youtubeId, { deadline: this.deadline }).catch((): OEmbedResult => ({ outcome: 'unavailable' }));
      }
      const res = youtubeInfoResult(r);
      events.push({
        type: 'user.custom_tool_result',
        custom_tool_use_id: id,
        content: [{ type: 'text', text: res.text }],
        is_error: res.is_error,
      } as BetaManagedAgentsEventParams);
      console.log(JSON.stringify({ at: 'youtube_info', job_id: job.id, outcome: r.outcome }));
    }
    // 送る前に種別を保存する（裁定 a: 今の待ちの分だけ。writeState でメモリの state と揃える）
    const keep = prevInfo.filter((x) => idleEventIds.includes(x));
    const info_event_ids = [...keep, ...ids.filter((x) => !keep.includes(x))];
    await this.writeState(job, null, { ...this.state, info_event_ids });
    await this.extend();
    await this.port.sendEvents(job.session_id!, events, this.call);
    return { sent: events.length };
  }

  /** §M-5b の待ちの状態があれば消す（無ければ書かない） */
  private async clearBlockedWait(job: JobRow): Promise<void> {
    if (this.state.blocked_unresolved === undefined) return;
    const { blocked_unresolved: _reset, ...rest } = this.state;
    await this.writeState(job, null, rest);
  }

  /**
   * reconcile_state_json を書く（stage=null なら reconcile_stage は変えない）。lease（reconcile_token）と status の CAS 付き。
   * 大きすぎる / 保存の例外が続いた時は job を failed にして Stopped（同じページで永久に再失敗しない）
   */
  private async writeState(job: JobRow, stage: string | null, state: ReconcileState, lastError?: string): Promise<void> {
    let r: { ok: boolean; state: ReconcileState };
    try {
      r = await guardedStateWrite(
        { ...state, save_failures: this.state.save_failures },
        (json) =>
          cas(this.db, reconcileStateWriteStmt({ stage, json, lastError: lastError ?? null, now: nowIso(), jobId: this.jobId, token: this.token })),
        (n) => cas(this.db, stmt(`UPDATE factory_jobs SET reconcile_state_json = ${BUMP_SAVE_FAILURES_SQL} WHERE id = ? AND reconcile_token = ?`, n, this.jobId, this.token)),
      );
    } catch (e) {
      if (e instanceof StateWriteStop) throw new Stopped(await this.fail(job, e.code, true));
      throw e;
    }
    if (!r.ok) throw new LostLease();
    this.state = r.state;
  }

  /**
   * §O-7（旧 §M-2-7 2）: image_id の画像を D1 と R2 から採る。条件（すべて）: 依頼の job_id がこの job・state = 'done'・
   * R2 の r2_key の物体があり SHA-256 が sha256 と一致・大きさ ≤ MAX_FILE_BYTES。違えば null（bad_image_ref）。
   * format が拡張子と同じかは呼び出し側が path ごとに見る。先頭バイトの検査は従来どおり validateOutputs が掛ける
   */
  private async generatedImage(job: JobRow, imageId: string): Promise<{ format: string; bytes: Uint8Array } | null> {
    const row = await getImage(this.db, imageId);
    if (!row || row.job_id !== job.id || row.state !== 'done' || !row.r2_key || !row.sha256 || !row.format) return null;
    const obj = await this.env.R2.get(row.r2_key);
    if (!obj) return null;
    const bytes = new Uint8Array(await obj.arrayBuffer());
    if (bytes.byteLength > MAX_FILE_BYTES) return null;
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const sha = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    return sha === row.sha256 ? { format: row.format, bytes } : null;
  }

  /** §B-4-d 手順 6: inspected → listed → ingested → versioned。各段階の途中経過は reconcile_state_json に置き、ページ / ファイル単位で再開する */
  private async ingest(job: JobRow, missingError: string): Promise<string> {
    let stage = job.reconcile_stage;
    let state: ReconcileState = this.state;
    const sid = job.session_id!;
    if (stage === 'none') {
      state = {};
      await this.writeState(job, 'inspected', state);
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
          await this.writeState(job, 'inspected', state);
        }
        // 同じ場所への書き直しは files.list 上で 1 件に置き換わる（実測 §R-45 (a)）。同じ basename が 2 件あれば別の場所の同名ファイル
        // なので、新しい方に寄せずに invalid_outputs（§B-4-d listed、§E-0）。basename で数えるのは raw/{basename} のキーと揃えるため
        const dup = duplicateBasename(list.items.map((f) => f.filename));
        if (dup !== null) {
          await this.casJob('last_error = ?', '', `duplicate_basename:${dup}`.slice(0, 200));
          return this.fail(job, 'invalid_outputs');
        }
        byPath = new Map(list.items.map((f) => [f.filename, f]));
        const missing = REQUIRED_FILES.filter((r) => !byPath.has(r));
        if (missing.length === 0) break;
        // 最後のページまで見ても必須ファイルが欠けている → 3 秒待って 2 回まで取り直す
        if (list.round >= 2) return this.fail(job, missingError);
        list = { cursor: null, items: [], round: list.round + 1, complete: false };
        state = { ...state, list };
        await this.writeState(job, 'inspected', state);
        if (Date.now() > this.deadline - 9_000) throw new OutOfTime();
        await sleep(3_000);
      }
      const files = [...byPath.values()];
      if (files.length > MAX_FILES || files.some((f) => f.size > MAX_FILE_BYTES)) return this.fail(job, 'invalid_outputs');
      state = { files: files.map(({ file_id, filename, size }) => ({ file_id, filename, size })), done: [] };
      await this.writeState(job, 'listed', state);
      stage = 'listed';
    }

    const prefix = `materials/${job.material_id}/${job.id}/`;
    // Files API の filename は basename だけ（§E-0 / §R-41）。取り込みはまず raw/{basename} に置き、versioned で論理パスへ復元する
    const rawKey = (filename: string) => `${prefix}raw/${basenameOf(filename)}`;
    if (stage === 'listed') {
      const done = new Set(state.done ?? []);
      for (const f of state.files ?? []) {
        if (done.has(f.file_id)) continue;
        await this.extend();
        const bytes = await this.port.downloadFile(f.file_id, this.call);
        if (bytes.byteLength > MAX_FILE_BYTES) return this.fail(job, 'invalid_outputs');
        await this.extend(); // R2 に書く直前にも所有権を確かめる
        await this.env.R2.put(rawKey(f.filename), bytes);
        done.add(f.file_id);
        state = { ...state, done: [...done] };
        await this.writeState(job, 'listed', state);
      }
      await this.writeState(job, 'ingested', state);
      stage = 'ingested';
    }

    if (stage !== 'ingested') return 'noop';

    // versioned: R2 の raw/ を読み、論理パスへ復元してから検証する（§B-4-d `versioned`、§E-0）
    const rawNames = (state.files ?? []).map((f) => basenameOf(f.filename));
    const raw = new Map<string, Uint8Array>();
    for (const name of new Set(rawNames)) {
      const obj = await this.env.R2.get(`${prefix}raw/${name}`);
      if (!obj) {
        await this.writeState(job, 'listed', { files: state.files, done: [] }); // raw/ に無い → 取り直す
        return 'refetch';
      }
      raw.set(name, new Uint8Array(await obj.arrayBuffer()));
    }
    const dec = new TextDecoder();
    const materialRaw = raw.get('material.json');
    const materialText = materialRaw ? dec.decode(materialRaw) : '';
    // §O-7（旧 §M-2-7 1〜3）: image_id を持つ files は raw/ でなく image_requests と R2 から採る。論理パスは basename の一意の判定に入れる
    const imageRefs = imageRefsOf(materialText);
    if (!imageRefs.ok) {
      await this.casJob('last_error = ?', '', imageRefs.detail.slice(0, 200));
      return this.fail(job, 'invalid_outputs');
    }
    const refs = imageRefs.refs.filter((r) => isSafeRelativePath(r.path)); // 安全でない path は R2 のキーにしない（§E の path_outside_part に落ちる）
    // R2 を読む前に数で落とす（material.json が image_id の files を大量に並べても、読む回数は 1 job の上限 8 回まで）:
    // raw のファイル数 + 異なる参照 path の数 > MAX_FILES は too_many_files、異なる image_id が 8 を超えたら bad_image_ref
    const refPaths = new Set(refs.map((r) => r.path));
    const rawCount = new Set(rawNames).size;
    if (rawCount + refPaths.size > MAX_FILES) {
      await this.casJob('last_error = ?', '', `too_many_files:${rawCount + refPaths.size}`);
      return this.fail(job, 'invalid_outputs');
    }
    const imageIdsSeen = new Set<string>();
    for (const ref of refs) {
      imageIdsSeen.add(ref.image_id);
      if (imageIdsSeen.size > IMAGE_JOB_LIMIT) {
        await this.casJob('last_error = ?', '', `bad_image_ref:${ref.path}`.slice(0, 200));
        return this.fail(job, 'invalid_outputs');
      }
    }
    const layout = resolveOutputLayout(rawNames, materialText, [...refPaths]);
    if (!layout.ok) {
      await this.casJob('last_error = ?', '', layout.detail.slice(0, 200));
      return this.fail(job, 'invalid_outputs');
    }
    const files = new Map<string, Uint8Array>();
    for (const [logical, base] of layout.files) files.set(logical, raw.get(base)!);
    // 同じ image_id は 1 回だけ読む（契約は 2 つの path からの参照を禁じていないので許し、同じバイト列を両方の path に置く）
    const loaded = new Map<string, { format: string; bytes: Uint8Array } | null>();
    const pathImage = new Map<string, string>();
    for (const ref of refs) {
      // 同じ path の重複した参照: 同じ image_id なら 1 回だけ置く。別の image_id なら後の参照を検査せずに通さない（取り違え・別 job の画像の混入を防ぐ）
      const prev = pathImage.get(ref.path);
      if (prev !== undefined) {
        if (prev === ref.image_id) continue;
        await this.casJob('last_error = ?', '', `bad_image_ref:${ref.path}`.slice(0, 200));
        return this.fail(job, 'invalid_outputs');
      }
      pathImage.set(ref.path, ref.image_id);
      if (!loaded.has(ref.image_id)) loaded.set(ref.image_id, await this.generatedImage(job, ref.image_id));
      const img = loaded.get(ref.image_id) ?? null;
      const ext = ref.path.endsWith('.webp') ? 'webp' : ref.path.endsWith('.png') ? 'png' : null;
      if (!img || ext === null || img.format !== ext) {
        await this.casJob('last_error = ?', '', `bad_image_ref:${ref.path}`.slice(0, 200));
        return this.fail(job, 'invalid_outputs');
      }
      files.set(ref.path, img.bytes);
    }
    const schema = validateOutputs(files);
    if (!schema.ok) {
      await this.casJob('last_error = ?', '', schema.detail.slice(0, 200));
      return this.fail(job, 'invalid_outputs');
    }
    // 論理 Map の全ファイルを論理キーへ（検証係・配信・確認画面はこのキーだけを読む。raw/ は読まない）
    if (!state.placed_clean) {
      // 論理 Map に無い parts/ の古いキー（旧形式の取り込み・前回の取り込みの残り）を先に消す。
      // 検証係（§F-3）は R2 の parts/ を列挙するので、残すと参照されないファイルが検証に混ざる（§R-47）
      const partsPrefix = prefix + 'parts/';
      const stale: string[] = [];
      let cursor: string | undefined;
      for (let i = 0; ; i++) {
        if (i >= MAX_PAGES) throw new Error('too_many_pages');
        await this.extend();
        const page = await this.env.R2.list({ prefix: partsPrefix, ...(cursor ? { cursor } : {}) });
        for (const o of page.objects) if (!files.has(o.key.slice(prefix.length))) stale.push(o.key);
        if (!page.truncated) break;
        cursor = page.cursor;
      }
      for (let i = 0; i < stale.length; i += 1000) {
        await this.extend();
        await this.env.R2.delete(stale.slice(i, i + 1000));
      }
      for (const [logical, bytes] of files) {
        await this.extend(); // R2 に書く直前に所有権を確かめる
        await this.env.R2.put(prefix + logical, bytes);
      }
      state = { ...state, placed_clean: true };
      await this.writeState(job, 'ingested', state);
    }
    const citeSources = schema.sources.map((s) => ({ id: s.id, url: s.url, quoted_excerpt: s.quoted_excerpt, is_primary: s.is_primary }));

    // events を古い順に最後のページまで。ページごとに集計と続き位置を保存する
    // 旧形式の集計（tool_result ごとの配列 / 順序逆転の仮集計 pend を持つ形 / キーが名前空間化されていない形）が残っていたら先頭から集計し直す
    let ev = state.ev && isCitationAcc(state.ev.acc) ? state.ev : { cursor: null, acc: newCitationAcc(), grader: null, complete: false };
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
      await this.writeState(job, 'ingested', state);
    }
    // §Q-11 9: 版の動画（versionVideosOf と同じ読み方）を渡す。動画に紐づく行（動画の出典）だけを、開けたか・引用の検査から外す
    const cit = finishCitations(ev.acc, citeSources, versionVideosOf(dec.decode(files.get('material.json')!)));
    const grader = ev.grader;

    const texts = new Map<string, string>();
    // 画像（png / webp）はバイナリなので禁止語・参照の検査に入れない（§M）。検査するのは本文として読む md / svg / html だけ
    for (const [p, b] of files) if (p.startsWith('parts/') && /\.(md|svg|html)$/.test(p)) texts.set(p, dec.decode(b));
    const forb = checkForbidden({
      texts,
      summary_elementary: schema.material.summary_elementary,
      summary_secondary: schema.material.summary_secondary,
      claims: schema.claims,
      sourceIds: schema.sources.map((s) => s.id),
    });
    const digest = await crypto.subtle.digest('SHA-256', contentDigestInput(files));
    const sha = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    const checks = { schema: 'ok', citations: cit.summary, ...forb, unreferenced_files: layout.unreferenced };

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
