// OpenAI Images の port（契約 §O-4 e = 旧下書き §M-2-4 e + OpenAiError.usage）。
// OPENAI_API_KEY・OPENAI_API_KEY_BACKUP と https://api.openai.com を読むのはここと src/env.ts だけ（§O-8 の検証コマンドの grep。§O-13 1）。
// 他のファイルは鍵を読まず、generate の戻り値の key と OpenAiError.key、openAiBackupPresent の boolean で判定する。
// 例外は port の境界で必ず OpenAiError にしてから外へ出す（本文・headers・cause・message を持たない。kind / status / usage の数値だけ）。
// 失敗の分類に読むのは HTTP status と error.code だけ（error.message は読まない・保存しない・転送しない）。

import { readBodyCapped } from './anthropic';
import type { Env } from './env';

export type OpenAiErrorKind = 'no_key' | 'timeout' | 'connection' | 'rate_limited' | 'quota' | 'moderation' | 'auth' | 'bad_request' | 'server' | 'bad_response';

export class OpenAiError extends Error {
  constructor(
    readonly responded: boolean,
    readonly status: number | undefined,
    readonly kind: OpenAiErrorKind,
    /** §O-4 e: 応答の本文に usage があれば数値だけ。無ければ null。応答不明の時は常に null */
    readonly usage: ImageUsage | null,
    /** §O-13 3: 予備の鍵で呼んだ失敗の印（主の鍵の失敗・呼んでいない失敗は undefined）。鍵の値は持たない */
    readonly key?: 'backup',
  ) {
    super(`openai_${kind}${status ? `_${status}` : ''}`);
    this.name = 'OpenAiError';
  }
}

export interface ImageUsage {
  in_text: number;
  in_image: number;
  out_image: number;
  out_text: number;
}

export interface ImageGenParams {
  model: string;
  prompt: string;
  size: string;
  quality: string;
  output_format: 'png' | 'webp';
  background: 'opaque' | 'transparent';
  n: 1;
}

/** どちらの鍵で呼んだ結果か（§O-13 3。値ではなく印だけ） */
export type OpenAiKeySlot = 'primary' | 'backup';

export interface ImagePort {
  readonly isFake: boolean;
  /** 成功: b64 と usage（読めなければ null）と key（どちらの鍵で呼んだか）。失敗はすべて OpenAiError（本文・headers・cause を持たない） */
  generate(p: ImageGenParams, o: { deadline: number }): Promise<{ b64: string; usage: ImageUsage | null; key: OpenAiKeySlot }>;
}

const IMAGES_URL = 'https://api.openai.com/v1/images/generations';
/** 応答本文の受信上限（§M-2-4 e）。超えたら bad_response */
export const OPENAI_BODY_MAX_BYTES = 4 * 1024 * 1024;

const keyValue = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

/** 鍵が設定されているか（値は返さない）。登録（§O-3 c の I）の not_configured の判定に使う */
export const openAiKeyPresent = (env: Pick<Env, 'OPENAI_API_KEY'>): boolean => keyValue(env.OPENAI_API_KEY) !== null;

/** 予備の鍵が設定されているか（値は返さない）。§O-13 5 の backup_configured */
export const openAiBackupPresent = (env: Pick<Env, 'OPENAI_API_KEY_BACKUP'>): boolean => keyValue(env.OPENAI_API_KEY_BACKUP) !== null;

/** 予備の鍵を最後に使った時刻（ISO）を置く settings の key（§O-13 4） */
export const OPENAI_BACKUP_LAST_USED_KEY = 'openai_backup_last_used_at';

/** 予備で呼び直すのに要る締め切りまでの残り（§O-13 2。これ未満なら呼ばず主の失敗を投げる） */
export const OPENAI_BACKUP_MIN_REMAINING_MS = 1_000;

/**
 * 主の鍵の失敗のうち、予備の鍵で呼び直してよいもの（§O-13 2）: 応答があり、kind が quota か auth。
 * timeout・connection・bad_response・rate_limited・server・bad_request・moderation は呼び直さない（応答不明の二重課金と、同じ結果の繰り返しを避ける）
 */
const retriesWithBackup = (e: unknown): e is OpenAiError => e instanceof OpenAiError && e.responded && (e.kind === 'quota' || e.kind === 'auth');

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/**
 * usage（input_tokens_details.{text_tokens,image_tokens}・output_tokens_details.{image_tokens,text_tokens}）を数値だけにする。
 * details が無く合計だけあれば、入力の合計を in_image（高い単価）、出力の合計を out_image に入れる。
 * details の和が合計より小さければ、差を高い単価の側（in_image / out_image）に足す（保守側）。
 * 入力・出力のどちらかの側に合計も details も無ければ、usage 全体を読めなかった（null）とする
 */
export function parseImageUsage(u: unknown): ImageUsage | null {
  const o = obj(u);
  if (!o) return null;
  const side = (totalRaw: unknown, detailsRaw: unknown): { text: number; image: number } | null => {
    const total = num(totalRaw);
    const d = obj(detailsRaw);
    const text = d ? num(d.text_tokens) : null;
    const image = d ? num(d.image_tokens) : null;
    if (total === null && text === null && image === null) return null;
    if (text === null && image === null) return { text: 0, image: total ?? 0 };
    const t = text ?? 0;
    const i = image ?? 0;
    return { text: t, image: i + (total !== null && total > t + i ? total - (t + i) : 0) };
  };
  const input = side(o.input_tokens, o.input_tokens_details);
  const output = side(o.output_tokens, o.output_tokens_details);
  if (!input || !output) return null;
  return { in_text: input.text, in_image: input.image, out_image: output.image, out_text: output.text };
}

/**
 * HTTP status と error.code だけで分類する（https://developers.openai.com/api/docs/guides/error-codes 2026-11-05 確認:
 * 429 の credit_balance_exhausted / organization_spend_limit_exceeded / project_spend_limit_exceeded / organization_usage_limit_exceeded は残高・上限。
 * insufficient_quota は旧来の code。moderation_blocked は画像の安全上の拒否として報告されている code（公式の表には無い）、content_policy_violation は旧 DALL·E の code）
 */
const QUOTA_CODES = new Set([
  'insufficient_quota',
  'credit_balance_exhausted',
  'organization_spend_limit_exceeded',
  'project_spend_limit_exceeded',
  'organization_usage_limit_exceeded',
  'billing_hard_limit_reached',
]);
const MODERATION_CODES = new Set(['moderation_blocked', 'content_policy_violation']);

export function classifyOpenAiStatus(status: number, code: string | null): OpenAiErrorKind {
  if (code !== null && QUOTA_CODES.has(code)) return 'quota';
  if (code !== null && MODERATION_CODES.has(code)) return 'moderation';
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server';
  return 'bad_request';
}

/**
 * 1 つの鍵で 1 回呼ぶ。失敗は OpenAiError（予備の鍵で呼んだ時は key: 'backup' の印を付ける）。
 * 締め切り: fetch と本文の受信の両方に効かせる（readBodyCapped と同じ形）
 */
async function callImagesOnce(
  f: typeof fetch,
  key: string,
  slot: OpenAiKeySlot,
  p: ImageGenParams,
  deadline: number,
): Promise<{ b64: string; usage: ImageUsage | null }> {
  const mark = slot === 'backup' ? ('backup' as const) : undefined;
  const fail = (responded: boolean, status: number | undefined, kind: OpenAiErrorKind, usage: ImageUsage | null) =>
    new OpenAiError(responded, status, kind, usage, mark);
  const signal = AbortSignal.timeout(Math.max(1_000, deadline - Date.now()));
  let res: Response;
  try {
    res = await f(IMAGES_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: p.model,
        prompt: p.prompt,
        size: p.size,
        quality: p.quality,
        output_format: p.output_format,
        background: p.background,
        n: p.n,
      }),
      signal,
    });
  } catch {
    throw fail(false, undefined, signal.aborted ? 'timeout' : 'connection', null);
  }
  let body: { bytes: Uint8Array; truncated: boolean };
  try {
    body = await readBodyCapped(res, OPENAI_BODY_MAX_BYTES, signal);
  } catch {
    // 本文の途中の中断（応答不明）
    throw fail(false, undefined, signal.aborted ? 'timeout' : 'connection', null);
  }
  // 本文が上限で切れたら、status に依らず bad_response（usage は読めない → R の表で usage_missing の停止）。§M-2-4 e
  if (body.truncated) throw fail(true, res.status, 'bad_response', null);
  let parsed: Record<string, unknown> | null = null;
  {
    try {
      parsed = obj(JSON.parse(new TextDecoder().decode(body.bytes)));
    } catch {
      parsed = null;
    }
  }
  const usage = parsed ? parseImageUsage(parsed.usage) : null;
  if (!res.ok) {
    const errObj = parsed ? obj(parsed.error) : null;
    const code = errObj && typeof errObj.code === 'string' ? errObj.code : null;
    throw fail(true, res.status, classifyOpenAiStatus(res.status, code), usage);
  }
  const data = parsed && Array.isArray(parsed.data) ? obj(parsed.data[0]) : null;
  const b64 = data && typeof data.b64_json === 'string' ? data.b64_json : '';
  if (!b64) throw fail(true, res.status, 'bad_response', usage);
  return { b64, usage };
}

/**
 * 本物の port。fetchImpl はテストで応答を模擬する時だけ渡す。
 * §O-13 2: 主の鍵で 1 回。応答があり quota / auth で、予備の鍵があり主と値が異なり、締め切りまで 1 秒以上ある時だけ、同じ入力で予備の鍵で 1 回。
 * 主の鍵が無く予備だけある時は予備で 1 回だけ。両方無い時は no_key。予備でも失敗したら予備の OpenAiError を投げる（主の失敗は捨てる）
 */
export function openAiPort(env: Env, opts: { fetchImpl?: typeof fetch } = {}): ImagePort {
  return {
    isFake: false,
    async generate(p, o) {
      const primary = keyValue(env.OPENAI_API_KEY);
      const backup = keyValue(env.OPENAI_API_KEY_BACKUP);
      const f = opts.fetchImpl ?? fetch;
      if (primary === null) {
        if (backup === null) throw new OpenAiError(false, undefined, 'no_key', null);
        return { ...(await callImagesOnce(f, backup, 'backup', p, o.deadline)), key: 'backup' };
      }
      try {
        return { ...(await callImagesOnce(f, primary, 'primary', p, o.deadline)), key: 'primary' };
      } catch (e) {
        if (!retriesWithBackup(e) || backup === null || backup === primary || o.deadline - Date.now() < OPENAI_BACKUP_MIN_REMAINING_MS) throw e;
      }
      return { ...(await callImagesOnce(f, backup, 'backup', p, o.deadline)), key: 'backup' };
    },
  };
}
