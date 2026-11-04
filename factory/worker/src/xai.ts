// xAI Responses API の薄い client（契約 §K-1, §K-4-3）。SDK は足さず fetch 直。
// 一次情報（2026-11-04 確認）:
//   https://docs.x.ai/developers/tools/x-search  — tools:[{type:'x_search', allowed_x_handles(20 件まで), from_date, to_date(YYYY-MM-DD。to_date は含まない)}], max_turns,
//                                                  usage.server_side_tool_usage_details.{x_search_calls, x_posts_fetched, x_users_fetched}
//   https://docs.x.ai/developers/rest-api-reference/inference/responses — 応答 {id, status, output[], usage{input_tokens, input_tokens_details.cached_tokens,
//                                                  output_tokens, output_tokens_details.reasoning_tokens, cost_in_usd_ticks}}。output の message.content[].type='output_text' の text
//   https://docs.x.ai/developers/pricing        — grok-4.3 入力 $1.25 / cached $0.20 / 出力 $2.50 per 1M、X 検索は取得 1 件ごと（投稿 $5/1k、プロフィール $10/1k）
// 本文・API key・投稿を log / 例外 message に載せない。例外は種別と HTTP status だけ持つ。

export const XAI_RESPONSES_URL = 'https://api.x.ai/v1/responses';
export const XAI_TIMEOUT_MS = 60_000;
/** 応答本文の上限（これを超えたら読み捨てて失敗にする） */
export const XAI_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

/** 定価表（$ per 1M tokens）。ここに無いモデルは費用を計算できないので呼ばない（収集部隊は X 検索を飛ばす） */
export const XAI_TOKEN_PRICES: Record<string, { input: number; cachedInput: number; output: number }> = {
  'grok-4.3': { input: 1.25, cachedInput: 0.2, output: 2.5 },
};
/** X 検索の取得 1 件の単価（micro-dollars）: 投稿 $5/1k = $0.005、プロフィール $10/1k = $0.01 */
export const XAI_POST_MICRO = 5_000;
export const XAI_PROFILE_MICRO = 10_000;

export interface XaiRequest {
  model: string;
  input: string;
  tools: Array<{ type: 'x_search'; allowed_x_handles: string[]; from_date: string; to_date: string }>;
  max_turns: number;
  /** 30 日の保存をさせない */
  store: false;
}

export interface XaiUsage {
  input_tokens: number;
  cached_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  x_posts_fetched: number;
  x_users_fetched: number;
  /** 1e10 ticks = $1。無ければ null */
  cost_in_usd_ticks: number | null;
}

export interface XaiResult {
  status: string;
  text: string;
  /** annotations の url と本文中の https URL（重複なし） */
  urls: string[];
  usage: XaiUsage;
}

export class XaiError extends Error {
  constructor(
    public readonly responded: boolean,
    public readonly status: number | undefined,
    public readonly kind: string,
  ) {
    super(`xai_${kind}${status ? `_${status}` : ''}`);
    this.name = 'XaiError';
  }
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);

/** 応答 JSON から必要な field だけを取り出す（純関数） */
export function parseXaiResponse(j: unknown): XaiResult {
  if (!j || typeof j !== 'object') throw new XaiError(true, 200, 'invalid_response');
  const o = j as Record<string, unknown>;
  const texts: string[] = [];
  const urls = new Set<string>();
  for (const item of Array.isArray(o.output) ? o.output : []) {
    if (!item || typeof item !== 'object') continue;
    const it = item as Record<string, unknown>;
    if (it.type !== 'message' || !Array.isArray(it.content)) continue;
    for (const c of it.content as Array<Record<string, unknown>>) {
      if (!c || c.type !== 'output_text' || typeof c.text !== 'string') continue;
      texts.push(c.text);
      for (const a of Array.isArray(c.annotations) ? (c.annotations as Array<Record<string, unknown>>) : []) {
        if (a && typeof a.url === 'string' && /^https:\/\//.test(a.url)) urls.add(a.url);
      }
    }
  }
  const text = texts.join('\n');
  for (const m of text.matchAll(/https:\/\/[^\s)\]>"']+/g)) urls.add(m[0].replace(/[.,;:、。]+$/, ''));
  const u = (o.usage && typeof o.usage === 'object' ? o.usage : {}) as Record<string, unknown>;
  const inDet = (u.input_tokens_details && typeof u.input_tokens_details === 'object' ? u.input_tokens_details : {}) as Record<string, unknown>;
  const outDet = (u.output_tokens_details && typeof u.output_tokens_details === 'object' ? u.output_tokens_details : {}) as Record<string, unknown>;
  const tool = (u.server_side_tool_usage_details && typeof u.server_side_tool_usage_details === 'object' ? u.server_side_tool_usage_details : {}) as Record<string, unknown>;
  return {
    status: typeof o.status === 'string' ? o.status : 'unknown',
    text,
    urls: [...urls].slice(0, 100),
    usage: {
      input_tokens: num(u.input_tokens),
      cached_tokens: num(inDet.cached_tokens),
      output_tokens: num(u.output_tokens),
      reasoning_tokens: num(outDet.reasoning_tokens),
      x_posts_fetched: num(tool.x_posts_fetched),
      x_users_fetched: num(tool.x_users_fetched),
      cost_in_usd_ticks: typeof u.cost_in_usd_ticks === 'number' && Number.isFinite(u.cost_in_usd_ticks) ? u.cost_in_usd_ticks : null,
    },
  };
}

/**
 * 定価で計算した費用（micro-dollars）。モデルが表に無ければ null。
 * xAI が cost_in_usd_ticks を返したら、定価計算と比べて大きいほうを使う（上限判定を甘くしない）。
 */
export function xaiMicroDollars(model: string, u: XaiUsage): number | null {
  const p = XAI_TOKEN_PRICES[model];
  if (!p) return null;
  const cached = Math.min(u.cached_tokens, u.input_tokens);
  const listed =
    (u.input_tokens - cached) * p.input + cached * p.cachedInput + u.output_tokens * p.output + u.x_posts_fetched * XAI_POST_MICRO + u.x_users_fetched * XAI_PROFILE_MICRO;
  const billed = u.cost_in_usd_ticks !== null ? u.cost_in_usd_ticks / 10_000 : 0; // 1e10 ticks = $1 = 1e6 micro
  return Math.max(listed, billed);
}

export const xaiPriceKnown = (model: string): boolean => Object.prototype.hasOwnProperty.call(XAI_TOKEN_PRICES, model);

/** POST /v1/responses を 1 回だけ呼ぶ（再試行しない）。timeoutMs は呼び出し側が残り時間から決める */
export async function xaiResponses(apiKey: string, req: XaiRequest, opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}): Promise<XaiResult> {
  const f = opts.fetchImpl ?? fetch;
  const timeoutMs = Math.max(1_000, Math.min(opts.timeoutMs ?? XAI_TIMEOUT_MS, XAI_TIMEOUT_MS));
  let res: Response;
  try {
    res = await f(XAI_RESPONSES_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(req),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const name = e instanceof Error ? e.name : '';
    throw new XaiError(false, undefined, name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'connection');
  }
  if (!res.ok) {
    try {
      await res.body?.cancel();
    } catch {
      /* 読み捨て */
    }
    throw new XaiError(true, res.status, 'api_error');
  }
  const text = await readCapped(res, XAI_MAX_RESPONSE_BYTES);
  if (text === null) throw new XaiError(true, res.status, 'response_too_large');
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    throw new XaiError(true, res.status, 'invalid_json');
  }
  return parseXaiResponse(j);
}

/** 応答本文を maxBytes まで読む。超えたら null（残りは読み捨てる） */
export async function readCapped(res: Response, maxBytes: number): Promise<string | null> {
  const len = Number(res.headers.get('content-length') ?? '');
  if (Number.isFinite(len) && len > maxBytes) {
    try {
      await res.body?.cancel();
    } catch {
      /* 読み捨て */
    }
    return null;
  }
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        /* 読み捨て */
      }
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    all.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder().decode(all);
}
