// OpenAI Images の port（契約 §O-4 e = 旧下書き §M-2-4 e + OpenAiError.usage）。
// OPENAI_API_KEY と https://api.openai.com を読むのはここと src/env.ts だけ（§O-8 の検証コマンドの grep）。
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

export interface ImagePort {
  readonly isFake: boolean;
  /** 成功: b64 と usage（読めなければ null）。失敗はすべて OpenAiError（本文・headers・cause を持たない） */
  generate(p: ImageGenParams, o: { deadline: number }): Promise<{ b64: string; usage: ImageUsage | null }>;
}

const IMAGES_URL = 'https://api.openai.com/v1/images/generations';
/** 応答本文の受信上限（§M-2-4 e）。超えたら bad_response */
export const OPENAI_BODY_MAX_BYTES = 4 * 1024 * 1024;

/** 鍵が設定されているか（値は返さない）。登録（§O-3 c の I）の not_configured の判定に使う */
export const openAiKeyPresent = (env: Pick<Env, 'OPENAI_API_KEY'>): boolean => typeof env.OPENAI_API_KEY === 'string' && env.OPENAI_API_KEY.length > 0;

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

/** 本物の port。fetchImpl はテストで応答を模擬する時だけ渡す */
export function openAiPort(env: Env, opts: { fetchImpl?: typeof fetch } = {}): ImagePort {
  return {
    isFake: false,
    async generate(p, o) {
      const key = env.OPENAI_API_KEY;
      if (!openAiKeyPresent(env) || !key) throw new OpenAiError(false, undefined, 'no_key', null);
      // 締め切り: fetch と本文の受信の両方に効かせる（readBodyCapped と同じ形）
      const signal = AbortSignal.timeout(Math.max(1_000, o.deadline - Date.now()));
      const f = opts.fetchImpl ?? fetch;
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
        throw new OpenAiError(false, undefined, signal.aborted ? 'timeout' : 'connection', null);
      }
      let body: { bytes: Uint8Array; truncated: boolean };
      try {
        body = await readBodyCapped(res, OPENAI_BODY_MAX_BYTES, signal);
      } catch {
        // 本文の途中の中断（応答不明）
        throw new OpenAiError(false, undefined, signal.aborted ? 'timeout' : 'connection', null);
      }
      let parsed: Record<string, unknown> | null = null;
      if (!body.truncated) {
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
        throw new OpenAiError(true, res.status, classifyOpenAiStatus(res.status, code), usage);
      }
      const data = parsed && Array.isArray(parsed.data) ? obj(parsed.data[0]) : null;
      const b64 = data && typeof data.b64_json === 'string' ? data.b64_json : '';
      if (!b64) throw new OpenAiError(true, res.status, 'bad_response', usage);
      return { b64, usage };
    },
  };
}
