// Gemini の動画の port（契約 §Q-3 1・§Q-9.1・§Q-9.2）。GEMINI_API_KEY を読むのはここと src/env.ts だけ。
// 公式 docs（2026-11-05 確認）:
//  - https://aistudio.google.com/docs/video-understanding … YouTube URL は input の {"type":"video","uri":"https://www.youtube.com/watch?v=..."}、
//    clip は video part の "processing": {"type":"static","start_offset":"…s","end_offset":"…s"}（docs の clip 例はアップロードしたファイル。YouTube に効くかは §Q-6 の probe で確かめる）
//  - https://aistudio.google.com/docs/interactions-breaking-changes-may-2026 … ヘッダ Api-Revision: 2026-05-20（2026-06-08 以降は無視される）、
//    応答は steps[]（type "model_output" の content[] の {type:"text", text}）、usage の total_input_tokens / total_output_tokens / total_tokens
//  - https://aistudio.google.com/api-reference/interactions-api … generation_config.max_output_tokens、status（completed / incomplete / failed …）、
//    usage の total_thought_tokens など
// 応答の形は probe（§Q-6 (b)(c)）で確かめるまで未確認として、読み方は寛容にする（形が違えば bad_response / no_text の固定コード）。
// 例外は port の境界で必ず GeminiError にしてから外へ出す（本文・headers・cause・message を持たない）。鍵の値・応答本文はログに出さない（このファイルはログを書かない）。
// SDK は使わず fetch を 1 回だけ呼ぶ（自動の再試行なし。§Q-9.1）。

import { readBodyCapped } from './anthropic';
import { YOUTUBE_ID_RE, youtubeWatchUrl } from './checks/schema';
import { cfg, type Env } from './env';

export const GEMINI_INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
export const GEMINI_API_REVISION = '2026-05-20';
/** 応答本文の受信上限。超えたら bad_response */
export const GEMINI_BODY_MAX_BYTES = 1024 * 1024;
/** 記録に残す本文の上限（§Q-3 1: 8,000 文字で切る） */
export const GEMINI_TEXT_MAX_CHARS = 8000;
/** generation_config.max_output_tokens（§Q-9.2: 公式の API reference で確認できた出力の上限。thinking を含む数として扱う） */
export const GEMINI_MAX_OUTPUT_TOKENS = 8192;

export type GeminiErrorKind =
  | 'no_key'
  | 'bad_input'
  | 'timeout'
  | 'connection'
  | 'rate_limited'
  | 'auth'
  | 'not_found'
  | 'bad_request'
  | 'server'
  | 'bad_response'
  | 'not_completed'
  | 'no_text';

export class GeminiError extends Error {
  constructor(
    /** API が応答した（status あり） */
    readonly responded: boolean,
    readonly status: number | undefined,
    readonly kind: GeminiErrorKind,
    /** 応答に usage（数値のフィールド）があった */
    readonly usagePresent: boolean,
    /** 応答の error（Google の {error:{status,message}}）。status は大文字と _ だけ、message は先頭 200 字・鍵らしい文字列は伏せる。probe の診断だけに使う */
    readonly apiError?: { status: string; message: string },
  ) {
    super(`gemini_${kind}${status ? `_${status}` : ''}`);
    this.name = 'GeminiError';
  }
}

/** usage の数値だけ（無いフィールドは持たない） */
export interface GeminiUsage {
  total_input_tokens?: number;
  total_output_tokens?: number;
  total_thought_tokens?: number;
  total_tokens?: number;
}

export interface GeminiWatchRequest {
  youtubeId: string;
  startSec: number;
  endSec: number;
  prompt: string;
  /** false の時だけ区間（processing）を付けない。probe の診断用（通常の経路は常に付ける） */
  clip?: boolean;
}

export interface GeminiWatchResult {
  /** 応答の本文（GEMINI_TEXT_MAX_CHARS で切る。空なら no_text で失敗にする） */
  text: string;
  usage?: GeminiUsage;
  /** HTTP の status（probe の観測値） */
  httpStatus: number;
}

export interface GeminiPort {
  readonly isFake: boolean;
  /** 呼べる（本物は鍵がある。fake は常に true）。false の時は呼ばず、取り置きもしない（§Q-4） */
  readonly configured: boolean;
  /** 記録の model（GEMINI_VIDEO_MODEL） */
  readonly model: string;
  /** 1 回だけ呼ぶ（再試行しない）。失敗はすべて GeminiError */
  watch(req: GeminiWatchRequest, o: { deadline: number }): Promise<GeminiWatchResult>;
}

/** 鍵が設定されているか（値は返さない） */
export const geminiKeyPresent = (env: Pick<Env, 'GEMINI_API_KEY'>): boolean => typeof env.GEMINI_API_KEY === 'string' && env.GEMINI_API_KEY.length > 0;

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);

/** 区間の指定（整数の秒）が送れる形か */
export function validWatchRequest(req: GeminiWatchRequest): boolean {
  const { youtubeId, startSec, endSec } = req;
  return (
    typeof youtubeId === 'string' &&
    YOUTUBE_ID_RE.test(youtubeId) &&
    Number.isInteger(startSec) &&
    Number.isInteger(endSec) &&
    startSec >= 0 &&
    startSec < endSec &&
    typeof req.prompt === 'string' &&
    req.prompt.length > 0
  );
}

/** 送る本文（公式 docs の YouTube の例 + clip の processing + 出力の上限） */
export function geminiRequestBody(model: string, req: GeminiWatchRequest): Record<string, unknown> {
  return {
    model,
    input: [
      {
        type: 'video',
        uri: youtubeWatchUrl(req.youtubeId),
        ...(req.clip === false ? {} : { processing: { type: 'static', start_offset: `${req.startSec}s`, end_offset: `${req.endSec}s` } }),
      },
      { type: 'text', text: req.prompt },
    ],
    generation_config: { max_output_tokens: GEMINI_MAX_OUTPUT_TOKENS },
  };
}

/**
 * usage を数値だけにする。docs の usage（total_input_tokens・total_output_tokens・total_thought_tokens・total_tokens）を読み、
 * 無ければ generateContent の usageMetadata（promptTokenCount・candidatesTokenCount・thoughtsTokenCount・totalTokenCount）を読む。
 * 数値が 1 つも無ければ undefined
 */
export function parseGeminiUsage(body: unknown): GeminiUsage | undefined {
  const o = obj(body);
  if (!o) return undefined;
  const out: GeminiUsage = {};
  const u = obj(o.usage);
  const m = obj(o.usageMetadata);
  const pick = (k: keyof GeminiUsage, a: unknown, b: unknown) => {
    const v = num(a) ?? num(b);
    if (v !== null) out[k] = v;
  };
  pick('total_input_tokens', u?.total_input_tokens, m?.promptTokenCount);
  pick('total_output_tokens', u?.total_output_tokens, m?.candidatesTokenCount);
  pick('total_thought_tokens', u?.total_thought_tokens, m?.thoughtsTokenCount);
  pick('total_tokens', u?.total_tokens, m?.totalTokenCount);
  return Object.keys(out).length ? out : undefined;
}

/**
 * content / parts の text を集める。thought: true（思考の要約）は入れない。requireType = true の時は type "text" のものだけ
 * （Interactions の content と旧 outputs。generateContent の parts は type を持たないので false）
 */
const textsOf = (content: unknown, requireType: boolean): string[] =>
  Array.isArray(content)
    ? (content as unknown[])
        .map(obj)
        .filter((c): c is Record<string, unknown> => !!c && (requireType ? c.type === 'text' : c.type === undefined || c.type === 'text') && c.thought !== true && typeof c.text === 'string')
        .map((c) => c.text as string)
    : [];

/**
 * 応答から本文を取り出す（寛容に。見つからなければ null）。status があって completed でなければ null。順に:
 * 1. steps[] の type "model_output" の step の content[] の type "text"（docs の形。user_input・type の無い step は読まない）
 * 2. output_text（SDK の便利フィールド。REST にあれば）
 * 3. outputs[] の type "text"（2026-05 の前の形）
 * 4. candidates[0].content.parts[].text（generateContent の形。finishReason があって STOP でなければ null）
 * どれも thought: true の部分は読まない
 */
export function extractInteractionText(body: unknown): string | null {
  const o = obj(body);
  if (!o) return null;
  if (o.status !== undefined && o.status !== 'completed') return null;
  const join = (xs: string[]) => {
    const t = xs.join('\n').trim();
    return t ? t : null;
  };
  if (Array.isArray(o.steps)) {
    const xs: string[] = [];
    for (const s of o.steps as unknown[]) {
      const step = obj(s);
      if (!step || step.type !== 'model_output') continue;
      xs.push(...textsOf(step.content, true));
    }
    const t = join(xs);
    if (t) return t;
  }
  if (typeof o.output_text === 'string') {
    const t = join([o.output_text]);
    if (t) return t;
  }
  if (Array.isArray(o.outputs)) {
    const t = join(textsOf(o.outputs, true));
    if (t) return t;
  }
  const cand = Array.isArray(o.candidates) ? obj((o.candidates as unknown[])[0]) : null;
  if (!cand || (cand.finishReason !== undefined && cand.finishReason !== 'STOP')) return null;
  return join(textsOf(obj(cand.content)?.parts, false));
}

/** Google の error 応答から診断用の値だけを取り出す（status は [A-Z_] 40 字まで、message は 200 字・鍵らしい文字列を伏せる） */
export function apiErrorOf(body: unknown): { status: string; message: string } | undefined {
  const e = obj(obj(body)?.error);
  if (!e) return undefined;
  const st = typeof e.status === 'string' && /^[A-Z_]{1,40}$/.test(e.status) ? e.status : '';
  const msg = typeof e.message === 'string' ? capChars(e.message.replace(/AIza[0-9A-Za-z_-]{10,}/g, '[REDACTED]').replace(/\s+/g, ' '), 200) : '';
  return st || msg ? { status: st, message: msg } : undefined;
}

/** 文字（code point）単位で max まで */
export const capChars = (s: string, max: number): string => {
  const a = Array.from(s);
  return a.length > max ? a.slice(0, max).join('') : s;
};

export function classifyGeminiStatus(status: number): GeminiErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server';
  return 'bad_request';
}

/** 本物の port。fetchImpl はテストで応答を模擬する時だけ渡す */
export function geminiPort(env: Env, opts: { fetchImpl?: typeof fetch } = {}): GeminiPort {
  const model = cfg(env).videoModel;
  return {
    isFake: false,
    configured: geminiKeyPresent(env),
    model,
    async watch(req, o) {
      const key = env.GEMINI_API_KEY;
      if (!geminiKeyPresent(env) || !key) throw new GeminiError(false, undefined, 'no_key', false);
      if (!validWatchRequest(req)) throw new GeminiError(false, undefined, 'bad_input', false);
      // 締め切り: fetch と本文の受信の両方に効かせる（openai.ts と同じ形）
      const signal = AbortSignal.timeout(Math.max(1_000, o.deadline - Date.now()));
      const f = opts.fetchImpl ?? fetch;
      let res: Response;
      try {
        res = await f(GEMINI_INTERACTIONS_URL, {
          method: 'POST',
          headers: { 'x-goog-api-key': key, 'content-type': 'application/json', 'api-revision': GEMINI_API_REVISION },
          body: JSON.stringify(geminiRequestBody(model, req)),
          signal,
        });
      } catch {
        throw new GeminiError(false, undefined, signal.aborted ? 'timeout' : 'connection', false);
      }
      let body: { bytes: Uint8Array; truncated: boolean };
      try {
        body = await readBodyCapped(res, GEMINI_BODY_MAX_BYTES, signal);
      } catch {
        throw new GeminiError(false, undefined, signal.aborted ? 'timeout' : 'connection', false);
      }
      let parsed: unknown = null;
      if (!body.truncated) {
        try {
          parsed = JSON.parse(new TextDecoder().decode(body.bytes));
        } catch {
          parsed = null;
        }
      }
      const usage = parseGeminiUsage(parsed);
      if (!res.ok) throw new GeminiError(true, res.status, classifyGeminiStatus(res.status), !!usage, apiErrorOf(parsed));
      if (body.truncated || !obj(parsed)) throw new GeminiError(true, res.status, 'bad_response', !!usage);
      const p = obj(parsed)!;
      // status があって completed でなければ失敗（incomplete = 出力の上限で切れた等。途中の本文は使わない）
      if (typeof p.status === 'string' && p.status !== 'completed') throw new GeminiError(true, res.status, 'not_completed', !!usage);
      const text = extractInteractionText(p);
      if (!text) throw new GeminiError(true, res.status, 'no_text', !!usage);
      return { text: capChars(text, GEMINI_TEXT_MAX_CHARS), ...(usage ? { usage } : {}), httpStatus: res.status };
    },
  };
}
