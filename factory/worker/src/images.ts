import { MAX_FILE_BYTES } from './checks/schema';
// 画像生成 段階 2（契約 §O。正本 docs/plans/image-generation/contract-O-draft.md v2.3）。
// U の表・入力検査（純関数）、遷移の SQL（I 登録 / D 呼ぶ権利 / R 結果 / C cron の回収 / F 取り置きの確定 / H 運営の操作。verbatim）、
// haltReasonFor（停止の理由の純関数）、consumer の手順 runImage、cron 段 3-c imageCronStep。
// 保証は §O-0 の G1〜G3 だけ。状態は image_requests.state の 5 つと settings.image_gen_halted、cost_ledger の ih: / if: の 1 行だけ。
// ログには id・状態名・固定コード・数値だけを出す（prompt・alt・本文・鍵は出さない）。

import type { BetaManagedAgentsEventParams } from '@anthropic-ai/sdk/resources/beta/sessions/events';
import type { FactoryPort } from './anthropic';
import { IMAGE_ALT_MAX_CHARS } from './checks/schema';
import { all, cas, conditionalBatch, first, getSetting, isoPlus, nowIso, stmt, tokyoDay, type Stmt } from './db';
import { cfg, type Env } from './env';
import { reconcileJob } from './jobs';
import { OpenAiError, openAiKeyPresent, type ImagePort, type ImageUsage } from './openai';
import { dailyReservedSql } from './verify';

// ---------------------------------------------------------------------------
// 定数（§O-4 a: var にしない）

export const IMAGE_TOOL_NAME = 'generate_image';
/** 1 job で受け付ける画像（state <> 'refused' の行）の累積の上限（G2） */
export const IMAGE_JOB_LIMIT = 8;
/** queued の再投入の上限（enqueue_count。登録の 1 回を含む） */
export const IMAGE_ENQUEUE_MAX = 3;
export const IMAGE_QUEUED_STALE_MS = 5 * 60_000;
export const IMAGE_DISPATCHED_STALE_MS = 10 * 60_000;
export const IMAGE_PROMPT_MAX_BYTES = 4000;
export { IMAGE_ALT_MAX_CHARS };
/** 生成 1 回の締め切り（runImage が images.generate に渡す） */
export const IMAGE_GEN_TIMEOUT_MS = 150_000;
/** cron 段 3-c の予算と、各項目の件数 */
export const IMAGE_CRON_BUDGET_MS = 60_000;
export const IMAGE_CRON_BATCH = 20;
/** reconcile の走査で input を保持する上限（JSON.stringify の文字数。超えたら {oversized:true}） */
export const IMAGE_INPUT_MAX_CHARS = 16_384;
/** 使える画像の大きさの上限（超えたら failed too_large）。取り込みの 1 ファイル上限（MAX_FILE_BYTES）と同じにする — 大きい画像を done にすると取り込みで素材全体が file_too_large で弾かれるため（司令塔の統合時の判断。応答本文の上限 4 MiB は openai.ts） */
export const IMAGE_MAX_BYTES = MAX_FILE_BYTES;
/** 掃除（§O-6 c）: job が更新されてからの日数 */
export const IMAGE_CLEAN_AFTER_MS = 30 * 86_400_000;
/** consumer の終わりの reconcile の締め切り（§O-4 c 5） */
const CONSUMER_RECONCILE_MS = 25_000;

// ---------------------------------------------------------------------------
// U の表（§O-5 a = 旧 §M-2-5 a。probe p1 の実測の最大 × 1.5 + 入力 4,000 token 上限、切り上げ）

const U_BY_SIZE_QUALITY: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  '1024x1024': { low: 10, medium: 10, high: 10, max: 35 },
  '1536x1024': { low: 10, medium: 10, high: 10, max: 35 },
};
/** model → size → quality → U（セント）。表に無い組み合わせは not_configured */
export const IMAGE_U_CENTS: Readonly<Record<string, Readonly<Record<string, Readonly<Record<string, number>>>>>> = {
  'gpt-image-2.5-flare': U_BY_SIZE_QUALITY,
  'gpt-image-2.5-sunburst': U_BY_SIZE_QUALITY,
};
/** U_max = 表の最大値（35） */
export const IMAGE_U_MAX = Math.max(...Object.values(IMAGE_U_CENTS).flatMap((bySize) => Object.values(bySize).flatMap((byQ) => Object.values(byQ))));
/** 取り置き = 8 × U_max（280） */
export const IMAGE_HOLD_CENTS = IMAGE_JOB_LIMIT * IMAGE_U_MAX;

const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

export function uCentsFor(model: string, size: string, quality: string): number | null {
  if (!own(IMAGE_U_CENTS, model)) return null;
  const bySize = IMAGE_U_CENTS[model];
  if (!own(bySize, size)) return null;
  const byQ = bySize[size];
  if (!own(byQ, quality)) return null;
  return byQ[quality];
}

/** §O-5 b: 実額（表示と停止の判定だけ。記帳には使わない） */
export function imageActualCents(u: ImageUsage): number {
  const micro = u.in_text * 5 + u.in_image * 8 + u.out_image * 30 + u.out_text * 30;
  return Math.ceil(micro / 10_000);
}

// ---------------------------------------------------------------------------
// 入力検査（§O-2 = 旧 §M-2-2 b。純関数）

const ACCURACIES = ['standard', 'scientific'] as const;
const SIZES = ['1024x1024', '1536x1024'] as const;
const QUALITIES = ['low', 'medium', 'high', 'max'] as const;
const FORMATS = ['png', 'webp'] as const;
const BACKGROUNDS = ['opaque', 'transparent'] as const;

export interface ImageInput {
  prompt: string;
  accuracy: (typeof ACCURACIES)[number];
  size: (typeof SIZES)[number];
  quality: (typeof QUALITIES)[number];
  format: (typeof FORMATS)[number];
  background: (typeof BACKGROUNDS)[number];
  alt: string;
}

const isPlainObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);

/** 走査で保持する input（16,384 文字超は {oversized:true}。§O-3 b 1） */
export function keptImageInput(input: unknown): unknown {
  let s: string | undefined;
  try {
    s = JSON.stringify(input);
  } catch {
    return { oversized: true };
  }
  if (s === undefined) return null;
  return s.length > IMAGE_INPUT_MAX_CHARS ? { oversized: true } : input;
}

export function validateImageInput(input: unknown): { ok: true; value: ImageInput } | { ok: false; field: string } {
  if (!isPlainObj(input)) return { ok: false, field: 'input' };
  // 走査で 16,384 文字を超えたものは {oversized:true} に置き換えてある
  if (input.oversized === true && Object.keys(input).length === 1) return { ok: false, field: 'input' };
  const p = input.prompt;
  if (typeof p !== 'string' || !/\S/.test(p) || new TextEncoder().encode(p).length > IMAGE_PROMPT_MAX_BYTES) return { ok: false, field: 'prompt' };
  if (!oneOf(ACCURACIES, input.accuracy)) return { ok: false, field: 'accuracy' };
  if (!oneOf(SIZES, input.size)) return { ok: false, field: 'size' };
  if (!oneOf(QUALITIES, input.quality)) return { ok: false, field: 'quality' };
  if (!oneOf(FORMATS, input.format)) return { ok: false, field: 'format' };
  if (!oneOf(BACKGROUNDS, input.background)) return { ok: false, field: 'background' };
  const alt = input.alt;
  if (typeof alt !== 'string') return { ok: false, field: 'alt' };
  const n = [...alt].length;
  if (n < 1 || n > IMAGE_ALT_MAX_CHARS) return { ok: false, field: 'alt' };
  // 余分なキーは無視する（保存しない）
  return { ok: true, value: { prompt: p, accuracy: input.accuracy, size: input.size, quality: input.quality, format: input.format, background: input.background, alt } };
}

/** accuracy から model（vars）。standard → IMAGE_MODEL_STANDARD、scientific → IMAGE_MODEL_SCIENTIFIC */
export function imageModelFor(env: Env, accuracy: ImageInput['accuracy']): string {
  const c = cfg(env);
  return accuracy === 'scientific' ? c.imageModelScientific : c.imageModelStandard;
}

// ---------------------------------------------------------------------------
// 行

export type ImageState = 'queued' | 'dispatched' | 'done' | 'refused' | 'failed';

export interface ImageRow {
  id: string;
  custom_tool_use_id: string;
  job_id: string;
  session_id: string;
  model: string | null;
  size: string | null;
  quality: string | null;
  format: 'png' | 'webp' | null;
  background: string | null;
  u_cents: number | null;
  input_json: string;
  state: ImageState;
  error: string | null;
  enqueue_count: number;
  enqueued_at: string | null;
  dispatch_token: string | null;
  dispatched_at: string | null;
  usage_json: string | null;
  actual_cents: number | null;
  r2_key: string | null;
  sha256: string | null;
  bytes: number | null;
  media_type: string | null;
  file_id: string | null;
  cleaned_at: string | null;
  created_at: string;
  updated_at: string;
}

export const isTerminalImage = (s: string): boolean => s === 'done' || s === 'refused' || s === 'failed';
export const newImageId = (): string => `img_${crypto.randomUUID().replace(/-/g, '')}`;

export const getImage = (db: D1Database, id: string) => first<ImageRow>(db, stmt('SELECT * FROM image_requests WHERE id = ?', id));
export const getImageByToolUse = (db: D1Database, toolUseId: string) =>
  first<ImageRow>(db, stmt('SELECT * FROM image_requests WHERE custom_tool_use_id = ?', toolUseId));

/** §O-3 b: 上限の判定に使う deny 数 = job.deny_count + imageDenies */
export async function imageDenies(db: D1Database, jobId: string): Promise<number> {
  const r = await first<{ n: number }>(db, stmt("SELECT COUNT(*) AS n FROM image_requests WHERE job_id = ? AND state IN ('refused','failed')", jobId));
  return Number(r?.n ?? 0);
}

/** 8 枚に数える行（state <> 'refused'）の数 */
export async function acceptedImageCount(db: D1Database, jobId: string): Promise<number> {
  const r = await first<{ n: number }>(db, stmt("SELECT COUNT(*) AS n FROM image_requests WHERE job_id = ? AND state <> 'refused'", jobId));
  return Number(r?.n ?? 0);
}

/** §O-3 b 2: event_ids のうち、この job の image_requests に行がある custom_tool_use_id（D1 の上限 100 を避けて 90 件ずつ） */
export async function imageToolUseIdsIn(db: D1Database, jobId: string, ids: readonly string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < ids.length; i += 90) {
    const part = ids.slice(i, i + 90);
    const rows = await all<{ custom_tool_use_id: string }>(
      db,
      stmt(`SELECT custom_tool_use_id FROM image_requests WHERE job_id = ? AND custom_tool_use_id IN (${part.map(() => '?').join(',')})`, jobId, ...part),
    );
    for (const r of rows) out.add(r.custom_tool_use_id);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 遷移の SQL（§O-3 c。verbatim。?name は位置の ? に置き換えた）

const HALTED_IS_NULL = `(SELECT value FROM settings WHERE key = 'image_gen_halted') IS NULL`;
const NOT_PAUSED = `COALESCE((SELECT value FROM settings WHERE key = 'paused'), '0') <> '1'`;

/** I1 取り置き（job の最初の依頼だけ。月と日次の判定はここだけ） */
export function holdStmt(p: {
  ledgerId: string;
  day: string;
  job: string;
  hold: number;
  now: string;
  monthCap: number;
  verifyReserve: number;
  dailyCap: number;
}): Stmt {
  const daily = dailyReservedSql(p.day, p.verifyReserve);
  return stmt(
    `INSERT INTO cost_ledger (id, day, kind, ref_id, cents, created_at)
SELECT ?, ?, 'image', 'ih:' || ?, ?, ?
WHERE NOT EXISTS (SELECT 1 FROM cost_ledger WHERE kind = 'image' AND substr(ref_id, 4) = ?)
  AND ${HALTED_IS_NULL}
  AND ${NOT_PAUSED}
  AND (SELECT COALESCE(SUM(cents), 0) FROM cost_ledger WHERE kind = 'image' AND substr(day, 1, 7) = ?) + ? <= ?
  AND ${daily.sql}
      + ? <= ?`,
    p.ledgerId,
    p.day,
    p.job,
    p.hold,
    p.now,
    p.job,
    p.day.slice(0, 7),
    p.hold,
    p.monthCap,
    ...daily.params,
    p.hold,
    p.dailyCap,
  );
}

/** I2 依頼（取り置きがあり、8 枚未満で、停止・一時停止でない時だけ queued） */
export function requestStmt(p: {
  id: string;
  toolUseId: string;
  job: string;
  session: string;
  model: string;
  size: string;
  quality: string;
  format: string;
  background: string;
  u: number;
  inputJson: string;
  now: string;
}): Stmt {
  return stmt(
    `INSERT INTO image_requests (id, custom_tool_use_id, job_id, session_id, model, size, quality, format, background, u_cents, input_json,
                            state, enqueue_count, enqueued_at, created_at, updated_at)
SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
       'queued', 1, ?, ?, ?
WHERE EXISTS (SELECT 1 FROM cost_ledger WHERE kind = 'image' AND ref_id = 'ih:' || ?)
  AND ${HALTED_IS_NULL}
  AND ${NOT_PAUSED}
  AND (SELECT COUNT(*) FROM image_requests WHERE job_id = ? AND state <> 'refused') < ${IMAGE_JOB_LIMIT}
  AND NOT EXISTS (SELECT 1 FROM image_requests WHERE custom_tool_use_id = ?)`,
    p.id,
    p.toolUseId,
    p.job,
    p.session,
    p.model,
    p.size,
    p.quality,
    p.format,
    p.background,
    p.u,
    p.inputJson,
    p.now,
    p.now,
    p.now,
    p.job,
    p.job,
    p.toolUseId,
  );
}

/** I3 断り（同じ custom_tool_use_id の行が無い時だけ） */
export function refuseStmt(p: { id: string; toolUseId: string; job: string; session: string; error: string; now: string }): Stmt {
  return stmt(
    `INSERT INTO image_requests (id, custom_tool_use_id, job_id, session_id, input_json, state, error, created_at, updated_at)
SELECT ?, ?, ?, ?, '{}', 'refused', ?, ?, ?
WHERE NOT EXISTS (SELECT 1 FROM image_requests WHERE custom_tool_use_id = ?)`,
    p.id,
    p.toolUseId,
    p.job,
    p.session,
    p.error,
    p.now,
    p.now,
    p.toolUseId,
  );
}

/** D 呼ぶ権利（consumer。1 文。0 行なら OpenAI を呼ばない）。一時停止（paused）は掛けない */
export function dispatchStmt(p: { id: string; token: string; now: string }): Stmt {
  return stmt(
    `UPDATE image_requests SET state = 'dispatched', dispatch_token = ?, dispatched_at = ?, updated_at = ?
WHERE id = ? AND state = 'queued'
  AND ${HALTED_IS_NULL}
  AND EXISTS (SELECT 1 FROM factory_jobs j WHERE j.id = image_requests.job_id
              AND j.status IN ('running','budget_reached') AND j.phase = 'making')`,
    p.token,
    p.now,
    p.now,
    p.id,
  );
}

export interface ImageResult {
  state: 'done' | 'failed';
  error: string | null;
  usage_json: string | null;
  actual_cents: number | null;
}

/** R1 終端へ（同じ token の dispatched の時だけ）+ R2 停止（?halt が NULL でない時だけ。最初の理由を残す）。batch。成否は R1 の changes */
export function resultStmts(p: {
  id: string;
  token: string;
  now: string;
  result: ImageResult;
  r2Key: string | null;
  sha256: string | null;
  bytes: number | null;
  mediaType: string | null;
  halt: string | null;
}): Stmt[] {
  return [
    stmt(
      `UPDATE image_requests
SET state = ?,
    error = ?,
    usage_json = ?, actual_cents = ?,
    r2_key = ?, sha256 = ?, bytes = ?, media_type = ?,
    updated_at = ?
WHERE id = ? AND state = 'dispatched' AND dispatch_token = ?`,
      p.result.state,
      p.result.error,
      p.result.usage_json,
      p.result.actual_cents,
      p.r2Key,
      p.sha256,
      p.bytes,
      p.mediaType,
      p.now,
      p.id,
      p.token,
    ),
    stmt(
      `INSERT INTO settings (key, value, updated_at) SELECT 'image_gen_halted', ?, ?
WHERE ? IS NOT NULL
  AND EXISTS (SELECT 1 FROM image_requests WHERE id = ? AND state = ? AND dispatch_token = ? AND updated_at = ?)
ON CONFLICT(key) DO NOTHING`,
      p.halt,
      p.now,
      p.halt,
      p.id,
      p.result.state,
      p.token,
      p.now,
    ),
  ];
}

/** C1 queued の再投入（5 分超・3 回未満）。changes = 1 なら send */
export function requeueStmt(p: { id: string; now: string; cutoff: string }): Stmt {
  return stmt(
    `UPDATE image_requests SET enqueue_count = enqueue_count + 1, enqueued_at = ?, updated_at = ?
WHERE id = ? AND state = 'queued' AND enqueued_at < ? AND enqueue_count < ${IMAGE_ENQUEUE_MAX}
  AND ${HALTED_IS_NULL}
  AND EXISTS (SELECT 1 FROM factory_jobs j WHERE j.id = image_requests.job_id AND j.status IN ('running','budget_reached') AND j.phase = 'making')`,
    p.now,
    p.now,
    p.id,
    p.cutoff,
  );
}

/** C2 queued の打ち切り（halted / job_ended / enqueue_exhausted）。state はいつも 'failed' */
export function abandonQueuedStmt(p: { id: string; error: 'halted' | 'job_ended' | 'enqueue_exhausted'; now: string }): Stmt {
  return stmt(`UPDATE image_requests SET state = 'failed', error = ?, updated_at = ?
WHERE id = ? AND state = 'queued'`, p.error, p.now, p.id);
}

/** C3 dispatched の打ち切り（10 分超）+ 停止（batch。成否は C3a） */
export function staleDispatchedStmts(p: { id: string; now: string; cutoff: string }): Stmt[] {
  return [
    stmt(
      `UPDATE image_requests SET state = 'failed', error = 'result_unknown', updated_at = ?
WHERE id = ? AND state = 'dispatched' AND dispatched_at < ?`,
      p.now,
      p.id,
      p.cutoff,
    ),
    stmt(
      `INSERT INTO settings (key, value, updated_at) SELECT 'image_gen_halted', 'result_unknown:' || ?, ?
WHERE EXISTS (SELECT 1 FROM image_requests WHERE id = ? AND state = 'failed' AND error = 'result_unknown' AND updated_at = ?)
ON CONFLICT(key) DO NOTHING`,
      p.id,
      p.now,
      p.id,
      p.now,
    ),
  ];
}

/** F 取り置きの確定（cron。job ごとに 1 文。1 回だけ）。額 = その job の OpenAI を呼んだ依頼の U の合計 */
export function finalizeHoldStmt(job: string): Stmt {
  return stmt(
    `UPDATE cost_ledger
SET ref_id = 'if:' || ?,
    cents = (SELECT COALESCE(SUM(u_cents), 0) FROM image_requests WHERE job_id = ? AND dispatched_at IS NOT NULL)
WHERE kind = 'image' AND ref_id = 'ih:' || ?
  AND EXISTS (SELECT 1 FROM factory_jobs WHERE id = ? AND status IN ('done','failed','cancelled'))
  AND NOT EXISTS (SELECT 1 FROM image_requests WHERE job_id = ? AND state IN ('queued','dispatched'))`,
    job,
    job,
    job,
    job,
    job,
  );
}

/** H1 止める（運営の操作。§O-5 e） */
export const haltStmt = (now: string): Stmt =>
  stmt(`INSERT INTO settings (key, value, updated_at) VALUES ('image_gen_halted', 'manual', ?) ON CONFLICT(key) DO NOTHING`, now);
/** H2 再開する（dispatched が 1 つも無い時だけ） */
export const unhaltStmt = (): Stmt =>
  stmt(`DELETE FROM settings WHERE key = 'image_gen_halted'
  AND NOT EXISTS (SELECT 1 FROM image_requests WHERE state = 'dispatched')`);

// ---------------------------------------------------------------------------
// I 登録（reconcile から。lease を持つ間だけ呼ぶ）

/** I2 が 0 行だった時の理由（I2 の後に読み直して決める。決定は I2 の 1 文で済んでいる） */
async function refusalReason(env: Env, jobId: string, day: string): Promise<string> {
  const db = env.DB;
  const c = cfg(env);
  if ((await getSetting(db, 'image_gen_halted')) !== null) return 'halted';
  if ((await getSetting(db, 'paused')) === '1') return 'paused';
  if ((await acceptedImageCount(db, jobId)) >= IMAGE_JOB_LIMIT) return 'job_image_limit';
  const hold = await first<{ n: number }>(db, stmt("SELECT COUNT(*) AS n FROM cost_ledger WHERE kind = 'image' AND ref_id = 'ih:' || ?", jobId));
  if (Number(hold?.n ?? 0) === 0) {
    const month = await first<{ c: number }>(
      db,
      stmt("SELECT COALESCE(SUM(cents), 0) AS c FROM cost_ledger WHERE kind = 'image' AND substr(day, 1, 7) = ?", day.slice(0, 7)),
    );
    if (Number(month?.c ?? 0) + IMAGE_HOLD_CENTS > c.imageMonthlyCapCents) return 'monthly_cap';
    const daily = dailyReservedSql(day, c.verifyTurnReserveCents);
    const d = await first<{ c: number }>(db, { sql: `SELECT ${daily.sql} AS c`, params: daily.params });
    if (Number(d?.c ?? 0) + IMAGE_HOLD_CENTS > c.dailyCapCents) return 'daily_cap';
  }
  return 'reserve_conflict';
}

/**
 * §O-3 c の I: 依頼を 1 行入れる（queued か refused）。入力が不正・表に無い・questions の段階・鍵が無い時は I1 を飛ばして I3。
 * 鍵の判定: fake の port（smoke・テスト）では fake の OpenAI を使うので鍵を見ない。戻り値はログ用（'queued' / 'refused:<理由>'）
 */
export async function registerImage(
  env: Env,
  port: Pick<FactoryPort, 'isFake'>,
  job: { id: string; phase: string; session_id: string | null },
  toolUseId: string,
  input: unknown,
): Promise<string> {
  const db = env.DB;
  const c = cfg(env);
  const now = nowIso();
  const day = tokyoDay();
  const id = newImageId();
  const session = job.session_id ?? '';
  const v = validateImageInput(input);
  let refuse: string | null = null;
  let model = '';
  let u: number | null = null;
  if (!v.ok) refuse = `bad_input:${v.field}`;
  else {
    model = imageModelFor(env, v.value.accuracy);
    u = uCentsFor(model, v.value.size, v.value.quality);
    if (u === null) refuse = 'not_configured';
  }
  if (refuse === null && job.phase === 'questions') refuse = 'questions_phase';
  if (refuse === null && !port.isFake && !openAiKeyPresent(env)) refuse = 'not_configured';
  if (refuse !== null || !v.ok || u === null) {
    await cas(db, refuseStmt({ id, toolUseId, job: job.id, session, error: refuse ?? 'not_configured', now }));
    return `refused:${refuse}`;
  }
  const r = await conditionalBatch(db, [
    holdStmt({
      ledgerId: crypto.randomUUID(),
      day,
      job: job.id,
      hold: IMAGE_HOLD_CENTS,
      now,
      monthCap: c.imageMonthlyCapCents,
      verifyReserve: c.verifyTurnReserveCents,
      dailyCap: c.dailyCapCents,
    }),
    requestStmt({
      id,
      toolUseId,
      job: job.id,
      session,
      model,
      size: v.value.size,
      quality: v.value.quality,
      format: v.value.format,
      background: v.value.background,
      u,
      inputJson: JSON.stringify({ prompt: v.value.prompt, alt: v.value.alt, accuracy: v.value.accuracy }),
      now,
    }),
  ]);
  if (r.ok) return 'queued';
  const reason = await refusalReason(env, job.id, day);
  await cas(db, refuseStmt({ id, toolUseId, job: job.id, session, error: reason, now }));
  return `refused:${reason}`;
}

// ---------------------------------------------------------------------------
// 職人へ返す event（§O-6 a。形 A = base64 直）

const SUCCESS_TEXT = (a: { imageId: string; accuracy: string; size: string; quality: string; format: string; remaining: number }) =>
  `画像を作りました（image_id: ${a.imageId}、${a.accuracy}・${a.size}・${a.quality}・${a.format}）。上の画像を見て、注文票と事実に合っているか確かめてください。` +
  `直したい時は prompt を直してもう一度呼んでください（この注文で作れる残りは ${a.remaining} 枚）。` +
  `使う時は material.json の parts[].files[] に {"path": "parts/<part_id>/<ファイル名>.${a.format}", "role": "figure", "image_id": "${a.imageId}", "alt": "<絵の説明>"} を書いてください。` +
  `画像ファイルを outputs に置かないでください。`;

const UNAVAILABLE_ERRORS = ['halted', 'not_configured', 'daily_cap', 'monthly_cap', 'reserve_conflict', 'paused'];

/** §O-6 a の断り・失敗の文（旧 §M-2-6 a の表に §O-6 の差し替えを当てたもの） */
export function imageErrorText(error: string | null): string {
  const e = error ?? '';
  if (e === 'questions_phase') return '画像は制作の指示が来てから使ってください。';
  if (e.startsWith('bad_input:'))
    return `入力が正しくありません（${e.slice('bad_input:'.length)}）。prompt は 4000 バイト以内、alt は 120 字以内、他の項目は決められた値から選んでください。`;
  if (e === 'job_image_limit') return 'この注文で作れる画像（8 枚）を使い切りました。図は SVG で描いてください。';
  if (UNAVAILABLE_ERRORS.includes(e)) return '今は画像を作れません。図は SVG で描いてください。';
  if (e === 'moderation') return 'この内容の画像は作れませんでした（安全上の制限）。描く内容を変えるか、図は SVG で描いてください。';
  return '画像を作れませんでした。もう一度試すか、図は SVG で描いてください。';
}

export function bytesToBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

/** R2 に r2_key の物体が無い（done の行なのに）。送信の失敗と同じ扱いで reconcile は抜ける（次の reconcile でもう一度） */
export class ImageObjectMissing extends Error {
  constructor() {
    super('image_object_missing');
    this.name = 'ImageObjectMissing';
  }
}

/** 終端の依頼を職人へ返す event。done は R2 から読んだ画像の base64 + 成功の文、refused / failed は is_error の文 */
export async function imageResultEvent(env: Env, row: ImageRow): Promise<BetaManagedAgentsEventParams> {
  if (row.state === 'done' && row.r2_key) {
    const obj = await env.R2.get(row.r2_key);
    if (!obj) throw new ImageObjectMissing();
    const bytes = new Uint8Array(await obj.arrayBuffer());
    let accuracy = '';
    try {
      accuracy = String((JSON.parse(row.input_json) as { accuracy?: unknown }).accuracy ?? '');
    } catch {
      accuracy = '';
    }
    const remaining = Math.max(0, IMAGE_JOB_LIMIT - (await acceptedImageCount(env.DB, row.job_id)));
    const mediaType = row.format === 'webp' ? 'image/webp' : 'image/png';
    return {
      type: 'user.custom_tool_result',
      custom_tool_use_id: row.custom_tool_use_id,
      is_error: false,
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: bytesToBase64(bytes) } },
        {
          type: 'text',
          text: SUCCESS_TEXT({ imageId: row.id, accuracy, size: row.size ?? '', quality: row.quality ?? '', format: row.format ?? '', remaining }),
        },
      ],
    } as BetaManagedAgentsEventParams;
  }
  return {
    type: 'user.custom_tool_result',
    custom_tool_use_id: row.custom_tool_use_id,
    is_error: true,
    content: [{ type: 'text', text: imageErrorText(row.error) }],
  } as BetaManagedAgentsEventParams;
}

// ---------------------------------------------------------------------------
// R の表（§O-3 c）と停止の理由

export const USAGE_MISSING_JSON = '{"missing":true}';

/** 生成の結果。image: 応答の画像（使えるか・使えない理由）。error: generate の例外 */
export type GenOutcome =
  | { kind: 'image'; usable: true; usage: ImageUsage | null }
  | { kind: 'image'; usable: false; error: 'bad_response' | 'too_large'; usage: ImageUsage | null }
  | { kind: 'error'; error: unknown };

const usageCols = (u: ImageUsage | null, missing: 'missing' | 'null') =>
  u
    ? { usage_json: JSON.stringify({ in_text: u.in_text, in_image: u.in_image, out_image: u.out_image, out_text: u.out_text }), actual_cents: imageActualCents(u) }
    : { usage_json: missing === 'missing' ? USAGE_MISSING_JSON : null, actual_cents: null };

/** R の表の 1 行に分類する（state / error / usage_json / actual_cents）。停止の理由は haltReasonFor */
export function classifyImageOutcome(o: GenOutcome): ImageResult {
  if (o.kind === 'image') {
    if (o.usable) return { state: 'done', error: null, ...usageCols(o.usage, 'missing') };
    return { state: 'failed', error: o.error, ...usageCols(o.usage, 'missing') };
  }
  const e = o.error;
  // port の境界を越えた OpenAiError 以外の例外は、課金されたか分からない（応答不明）として扱う
  if (!(e instanceof OpenAiError)) return { state: 'failed', error: 'result_unknown', usage_json: null, actual_cents: null };
  switch (e.kind) {
    case 'timeout':
    case 'connection':
      return { state: 'failed', error: 'result_unknown', usage_json: null, actual_cents: null };
    case 'no_key':
      // 登録の後で鍵が消えた（呼んでいない）。鍵が使えない（auth）として停止する
      return { state: 'failed', error: 'auth', usage_json: null, actual_cents: null };
    case 'bad_response':
      // 応答あり・画像が使えない（本文が不正・2 MiB 超）: 読めた usage、無ければ missing
      return { state: 'failed', error: 'bad_response', ...usageCols(e.usage, 'missing') };
    default:
      // 応答あり・HTTP の失敗: 読めれば usage、無ければ NULL（課金なしとみなす）
      return { state: 'failed', error: e.kind, ...usageCols(e.usage, 'null') };
  }
}

/** §O-3 c: ?halt はどの結果でも同じ純関数で決める（画像が使えるか・応答があったかで分けない） */
export function haltReasonFor(o: { requestId: string; u: number; result: ImageResult }): string | null {
  const r = o.result;
  if (r.error === 'result_unknown') return `result_unknown:${o.requestId}`;
  if (r.error === 'quota') return 'quota';
  if (r.error === 'auth') return 'auth';
  if (r.actual_cents !== null && r.actual_cents > o.u) return `over_reserve:${o.requestId}`;
  if (r.usage_json === USAGE_MISSING_JSON) return `usage_missing:${o.requestId}`;
  return null;
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const startsWith = (b: Uint8Array, sig: number[], at = 0) => b.byteLength >= at + sig.length && sig.every((x, i) => b[at + i] === x);

/** b64 を画像として読めるか（base64・2 MiB・先頭バイトが format と一致） */
export function decodeImage(b64: string, format: string): { ok: true; bytes: Uint8Array } | { ok: false; error: 'bad_response' | 'too_large' } {
  let bin: string;
  try {
    bin = atob(b64);
  } catch {
    return { ok: false, error: 'bad_response' };
  }
  if (bin.length > IMAGE_MAX_BYTES) return { ok: false, error: 'too_large' };
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  const match =
    format === 'png'
      ? startsWith(bytes, PNG_MAGIC)
      : format === 'webp'
        ? startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
        : false;
  return match ? { ok: true, bytes } : { ok: false, error: 'bad_response' };
}

async function sha256Hex(b: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export const imageR2Key = (jobId: string, requestId: string, token: string, format: string) => `img/${jobId}/${requestId}/${token}.${format}`;

// ---------------------------------------------------------------------------
// consumer（§O-4 c）

/**
 * 依頼 1 件: 1 読む → 2 D（新しい token。0 行なら 5）→ 3 生成 → 分類 → 画像が使えれば R2 に put → 4 R（R1, R2）→ 5 reconcile。
 * D1 の例外は投げ直して Queue の再試行に任せる（再試行の consumer は 1 から。D の後なら 2 が 0 行で呼ばない）。
 * 戻り値はログ・テスト用
 */
export async function runImage(env: Env, port: FactoryPort, images: ImagePort, requestId: string, o: { deadline: number }): Promise<string> {
  const db = env.DB;
  const row = await getImage(db, requestId);
  if (!row) return 'not_found';
  let result = `skipped:${row.state}`;
  if (row.state === 'queued') {
    const token = crypto.randomUUID();
    const claimed = await cas(db, dispatchStmt({ id: row.id, token, now: nowIso() }));
    if (!claimed) result = 'not_dispatched';
    else {
      let input: { prompt?: unknown } = {};
      try {
        input = JSON.parse(row.input_json) as { prompt?: unknown };
      } catch {
        input = {};
      }
      const format = row.format === 'webp' ? 'webp' : 'png';
      let outcome: GenOutcome;
      let put: { key: string; sha: string; bytes: number; mediaType: string } | null = null;
      try {
        const g = await images.generate(
          {
            model: row.model ?? '',
            prompt: String(input.prompt ?? ''),
            size: row.size ?? '',
            quality: row.quality ?? '',
            output_format: format,
            background: row.background === 'transparent' ? 'transparent' : 'opaque',
            n: 1,
          },
          { deadline: Math.min(o.deadline, Date.now() + IMAGE_GEN_TIMEOUT_MS) },
        );
        const img = decodeImage(g.b64, format);
        if (!img.ok) outcome = { kind: 'image', usable: false, error: img.error, usage: g.usage };
        else {
          const key = imageR2Key(row.job_id, row.id, token, format);
          try {
            await env.R2.put(key, img.bytes);
            put = { key, sha: await sha256Hex(img.bytes), bytes: img.bytes.byteLength, mediaType: format === 'webp' ? 'image/webp' : 'image/png' };
            outcome = { kind: 'image', usable: true, usage: g.usage };
          } catch {
            // put の失敗は「使えない画像」と同じ扱い
            outcome = { kind: 'image', usable: false, error: 'bad_response', usage: g.usage };
          }
        }
      } catch (e) {
        outcome = { kind: 'error', error: e };
      }
      const r = classifyImageOutcome(outcome);
      const halt = haltReasonFor({ requestId: row.id, u: row.u_cents ?? 0, result: r });
      const done = r.state === 'done' && put !== null;
      const b = await conditionalBatch(
        db,
        resultStmts({
          id: row.id,
          token,
          now: nowIso(),
          result: r,
          r2Key: done ? put!.key : null,
          sha256: done ? put!.sha : null,
          bytes: done ? put!.bytes : null,
          mediaType: done ? put!.mediaType : null,
          halt,
        }),
      );
      const wrote = b.changes[0] > 0;
      result = wrote ? r.state : 'result_discarded';
      console.log(
        JSON.stringify({
          at: 'image_result',
          request_id: row.id,
          job_id: row.job_id,
          state: wrote ? r.state : 'discarded',
          error: r.error,
          actual_cents: r.actual_cents,
          halt: wrote && halt ? halt.split(':')[0] : null,
        }),
      );
    }
  }
  // 5. 職人へ返すのは reconcile だけ（job が終端・lease 競合なら何もしない。失敗は無視。cron が拾う）
  try {
    await reconcileJob(env, port, row.job_id, { deadline: Math.min(o.deadline, Date.now() + CONSUMER_RECONCILE_MS) });
  } catch {
    // 無視
  }
  return result;
}

// ---------------------------------------------------------------------------
// cron 段 3-c「画像の回収」（§O-4 d）。停止中・一時停止中も行う。生成はしない（D を呼ばない）

async function sendToQueue(env: Env, requestId: string): Promise<boolean> {
  if (!env.IMAGE_GEN) return false;
  try {
    await env.IMAGE_GEN.send({ request_id: requestId });
    return true;
  } catch {
    return false;
  }
}
export { sendToQueue as enqueueImage };

export async function imageCronStep(env: Env, o: { deadline: number }): Promise<Record<string, number | string | null>> {
  const db = env.DB;
  const left = () => Date.now() < o.deadline;
  const out = { c3: 0, c2: 0, c1: 0, sent: 0, finalized: 0, cleaned: 0 };

  // 1. C3: dispatched の 10 分超
  {
    const d = new Date();
    const cutoff = isoPlus(-IMAGE_DISPATCHED_STALE_MS, d);
    const rows = await all<{ id: string }>(
      db,
      stmt(`SELECT id FROM image_requests WHERE state = 'dispatched' AND dispatched_at < ? ORDER BY dispatched_at ASC LIMIT ${IMAGE_CRON_BATCH}`, cutoff),
    );
    for (const r of rows) {
      if (!left()) break;
      const b = await conditionalBatch(db, staleDispatchedStmts({ id: r.id, now: nowIso(), cutoff }));
      if (b.changes[0] > 0) out.c3++;
    }
  }

  // 2. C2 → C1: queued の 5 分超（停止中 → halted / job が有効でない → job_ended / 3 回 → enqueue_exhausted、それ以外は再投入）
  if (left()) {
    const d = new Date();
    const cutoff = isoPlus(-IMAGE_QUEUED_STALE_MS, d);
    const rows = await all<{ id: string; enqueue_count: number; status: string | null; phase: string | null }>(
      db,
      stmt(
        `SELECT r.id, r.enqueue_count, j.status, j.phase FROM image_requests r LEFT JOIN factory_jobs j ON j.id = r.job_id
         WHERE r.state = 'queued' AND r.enqueued_at < ? ORDER BY r.enqueued_at ASC LIMIT ${IMAGE_CRON_BATCH}`,
        cutoff,
      ),
    );
    const halted = (await getSetting(db, 'image_gen_halted')) !== null;
    for (const r of rows) {
      if (!left()) break;
      const jobLive = (r.status === 'running' || r.status === 'budget_reached') && r.phase === 'making';
      const error = halted ? 'halted' : !jobLive ? 'job_ended' : Number(r.enqueue_count) >= IMAGE_ENQUEUE_MAX ? 'enqueue_exhausted' : null;
      if (error) {
        if (await cas(db, abandonQueuedStmt({ id: r.id, error, now: nowIso() }))) out.c2++;
      } else if (await cas(db, requeueStmt({ id: r.id, now: nowIso(), cutoff }))) {
        out.c1++;
        if (await sendToQueue(env, r.id)) out.sent++;
      }
    }
  }

  // 3. F: 取り置き（ih:）の確定。終端の job だけを選ぶ（F 自身も述語で確かめる）
  if (left()) {
    const rows = await all<{ job_id: string }>(
      db,
      stmt(
        `SELECT substr(c.ref_id, 4) AS job_id FROM cost_ledger c
         WHERE c.kind = 'image' AND c.ref_id GLOB 'ih:*'
           AND EXISTS (SELECT 1 FROM factory_jobs j WHERE j.id = substr(c.ref_id, 4) AND j.status IN ('done','failed','cancelled'))
         ORDER BY c.created_at ASC LIMIT ${IMAGE_CRON_BATCH}`,
      ),
    );
    for (const r of rows) {
      if (!left()) break;
      if (await cas(db, finalizeHoldStmt(r.job_id))) out.finalized++;
    }
  }

  // 4. 掃除（§O-6 c）: job が 30 日より前に更新され done / cancelled、または failed かつ invalid_outputs 以外（取り込み直しできる job の画像は消さない）
  if (left()) {
    const rows = await all<{ id: string; job_id: string }>(
      db,
      stmt(
        `SELECT r.id, r.job_id FROM image_requests r JOIN factory_jobs j ON j.id = r.job_id
         WHERE r.cleaned_at IS NULL AND r.state IN ('done','refused','failed') AND j.updated_at < ?
           AND (j.status IN ('done','cancelled') OR (j.status = 'failed' AND j.error <> 'invalid_outputs'))
         ORDER BY r.updated_at ASC LIMIT ${IMAGE_CRON_BATCH}`,
        isoPlus(-IMAGE_CLEAN_AFTER_MS),
      ),
    );
    for (const r of rows) {
      if (!left()) break;
      // R2 の img/{job_id}/{request_id}/ 配下（孤立した物体も含む）を消す。版の論理キーは消さない
      const prefix = `img/${r.job_id}/${r.id}/`;
      let cursor: string | undefined;
      for (let i = 0; i < 50; i++) {
        const page = await env.R2.list({ prefix, ...(cursor ? { cursor } : {}) });
        const keys = page.objects.map((x) => x.key);
        if (keys.length > 0) await env.R2.delete(keys);
        if (!page.truncated) break;
        cursor = page.cursor;
      }
      if (await cas(db, stmt('UPDATE image_requests SET cleaned_at = ? WHERE id = ? AND cleaned_at IS NULL', nowIso(), r.id))) out.cleaned++;
    }
  }

  // 5. ログ（数値と固定コードだけ）
  const counts = await first<{ queued: number; dispatched: number }>(
    db,
    stmt("SELECT SUM(CASE WHEN state = 'queued' THEN 1 ELSE 0 END) AS queued, SUM(CASE WHEN state = 'dispatched' THEN 1 ELSE 0 END) AS dispatched FROM image_requests"),
  );
  const month = await first<{ c: number }>(
    db,
    stmt("SELECT COALESCE(SUM(cents), 0) AS c FROM cost_ledger WHERE kind = 'image' AND substr(day, 1, 7) = ?", tokyoDay().slice(0, 7)),
  );
  const holds = await first<{ n: number }>(db, stmt("SELECT COUNT(*) AS n FROM cost_ledger WHERE kind = 'image' AND ref_id GLOB 'ih:*'"));
  const halted = await getSetting(db, 'image_gen_halted');
  const log = {
    queued: Number(counts?.queued ?? 0),
    dispatched: Number(counts?.dispatched ?? 0),
    halted: halted === null ? null : halted.split(':')[0],
    month_cents: Number(month?.c ?? 0),
    holds_open: Number(holds?.n ?? 0),
  };
  console.log(JSON.stringify({ at: 'image_cron', ...log }));
  return { ...out, ...log };
}
