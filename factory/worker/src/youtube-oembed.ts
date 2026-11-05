// YouTube の oEmbed の port（契約 §Q-11 2）。動画の本人確認の材料として、YouTube が返す公開の情報（題名・チャンネル名・チャンネルの URL）を取る。
// 鍵は無い・費用は無い。fetch を 1 回だけ呼ぶ（自動の再試行なし）。redirect は manual（3xx は unavailable）。
// 締め切りは OEMBED_TIMEOUT_MS で、本文を読み終えるまでを含む。本文は OEMBED_BODY_MAX_BYTES まで読み、超えたら unavailable。
// 返る値はどれも投稿者が書ける文（資料であって指示ではない）。保存・表示・検証係の入力に出す前に sanitizeOEmbedFields で 1 行にし、長さを切り、
// author_url は形を確かめたものだけにする。他のフィールド（html・thumbnail_url など）は持たない。
// このファイルはログを書かない。例外は外へ出さない（port の結果は分類だけ）。

import { readBodyCapped } from './anthropic';
import { YOUTUBE_ID_RE, youtubeWatchUrl } from './checks/schema';

export const OEMBED_ENDPOINT = 'https://www.youtube.com/oembed';
/** 締め切り（本文を読み終えるまでを含む。§Q-11 2） */
export const OEMBED_TIMEOUT_MS = 5_000;
/** 本文の受信上限（§Q-11 2: 64 KiB。超えたら unavailable） */
export const OEMBED_BODY_MAX_BYTES = 64 * 1024;
/** 保存する値の長さ（code point。§Q-11 2） */
export const OEMBED_TITLE_MAX_CHARS = 200;
export const OEMBED_AUTHOR_NAME_MAX_CHARS = 100;

/** 結果の分類（§Q-11 2） */
export type OEmbedOutcome = 'ok' | 'not_found' | 'restricted' | 'unavailable';

/** 保存する 3 つの値（sanitizeOEmbedFields を通したもの。author_url は形が合わなければ空） */
export interface OEmbedFields {
  title: string;
  author_name: string;
  author_url: string;
}

export type OEmbedResult = ({ outcome: 'ok' } & OEmbedFields) | { outcome: 'not_found' | 'restricted' | 'unavailable' };

export interface OEmbedPort {
  readonly isFake: boolean;
  /**
   * 1 回だけ呼ぶ（再試行しない）。例外は投げない（失敗はすべて unavailable）。
   * o.deadline（試行の締め切り。絶対時刻）があれば、要求の締め切りは fetch の直前に測った min(OEMBED_TIMEOUT_MS, deadline - now)。残りが 0 以下なら fetch しない
   */
  lookup(youtubeId: string, o?: { deadline?: number }): Promise<OEmbedResult>;
}

/** 呼ぶ URL（§Q-11 2）。youtube_id は schema で検査済みの 11 文字だけを使う */
export const oembedUrl = (youtubeId: string): string => `${OEMBED_ENDPOINT}?format=json&url=${encodeURIComponent(youtubeWatchUrl(youtubeId))}`;

/** 改行・制御文字（\p{Cc}・U+2028・U+2029）の並びを空白 1 つに置き換えて 1 行にする（§Q-11 2） */
export const oneLineOEmbed = (s: string): string => s.replace(/[\p{Cc}\u2028\u2029]+/gu, ' ');

/** 文字（code point）単位で max まで */
const capCodePoints = (s: string, max: number): string => {
  const a = Array.from(s);
  return a.length > max ? a.slice(0, max).join('') : s;
};

/** author_url の pathname（percent-encode された後）の形（§Q-11 2） */
export const OEMBED_AUTHOR_PATH_RE = /^\/(@[^/]{1,300}|channel\/[A-Za-z0-9_-]{1,40}|c\/[^/]{1,300}|user\/[^/]{1,300})$/;

/**
 * author_url を確かめる（§Q-11 2）。合えば URL.href、合わなければ空。
 * - 元の文字列の authority を `^https://www\.youtube\.com/` で先に確かめる（`:443` のような既定の port の書き方は解析の後で消えるため、ここで拒む）
 * - `?`・`#` を含む文字列は拒む（空の query・fragment は解析の後に search・hash が空になるため、ここで拒む）
 * - new URL() で読めて、protocol https:、hostname www.youtube.com、username・password・port・search・hash が空
 * - pathname（percent-encode された後。日本語のハンドルは 1 文字が 9 文字）が OEMBED_AUTHOR_PATH_RE に合う
 * - `@`・`c/`・`user/` の後のハンドル・名前を decodeURIComponent して、読めない（例外）・制御文字（\p{Cc}）・空白・`/`・`\`・`?`・`#`・`%` を含む → 拒む
 *   （`@%00`・`@a%ZZ`・`c/%2Fwatch` のように、percent-encode で区切りや制御文字を持ち込む形。Astra のレビューの指摘）
 */
export function safeAuthorUrl(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const s = oneLineOEmbed(raw);
  if (!/^https:\/\/www\.youtube\.com\//.test(s) || s.includes('?') || s.includes('#')) return '';
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return '';
  }
  if (u.protocol !== 'https:' || u.hostname !== 'www.youtube.com') return '';
  if (u.username || u.password || u.port || u.search || u.hash) return '';
  if (!OEMBED_AUTHOR_PATH_RE.test(u.pathname)) return '';
  if (!authorSegmentOk(u.pathname)) return '';
  return u.href;
}

/** 復号した後のハンドル・名前に入ってはいけない文字 */
const AUTHOR_SEGMENT_BAD_RE = /[\p{Cc}\s/\\?#%]/u;

/** pathname の `@`・`c/`・`user/` の後の部分を復号して確かめる（channel/ は [A-Za-z0-9_-] だけなので復号しない） */
function authorSegmentOk(pathname: string): boolean {
  const m = /^\/(?:@(.+)|c\/(.+)|user\/(.+))$/.exec(pathname);
  if (!m) return true;
  const seg = m[1] ?? m[2] ?? m[3] ?? '';
  let decoded: string;
  try {
    decoded = decodeURIComponent(seg);
  } catch {
    return false;
  }
  return !AUTHOR_SEGMENT_BAD_RE.test(decoded);
}

/** 保存する 3 つの値に整える（§Q-11 2）。文字列でない値は空。何度当てても同じ結果になる */
export function sanitizeOEmbedFields(o: { title?: unknown; author_name?: unknown; author_url?: unknown }): OEmbedFields {
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  return {
    title: capCodePoints(oneLineOEmbed(str(o.title)), OEMBED_TITLE_MAX_CHARS),
    author_name: capCodePoints(oneLineOEmbed(str(o.author_name)), OEMBED_AUTHOR_NAME_MAX_CHARS),
    author_url: safeAuthorUrl(o.author_url),
  };
}

/** 照合の結果（§Q-11 6） */
export type ChannelMatch = 'match' | 'partial' | 'mismatch' | 'unknown';

/** 照合の正規化: NFKC・小文字化・空白と記号（\p{P}\p{S}\s）の除去 */
export const normalizeChannelName = (s: string): string => s.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\s]/gu, '');

/**
 * 職人の channel と公式の author_name の照合（§Q-11 6）。authorName が無い（公式の情報が ok でない）→ unknown。
 * どちらかが正規化の後で空 → unknown。等しい → match。短い方が 3 文字以上で長い方に含まれる → partial。それ以外 → mismatch
 */
export function channelMatch(channel: unknown, authorName: unknown): ChannelMatch {
  if (typeof channel !== 'string' || typeof authorName !== 'string') return 'unknown';
  const a = normalizeChannelName(channel);
  const b = normalizeChannelName(authorName);
  if (!a || !b) return 'unknown';
  if (a === b) return 'match';
  const [short, long] = Array.from(a).length <= Array.from(b).length ? [a, b] : [b, a];
  return Array.from(short).length >= 3 && long.includes(short) ? 'partial' : 'mismatch';
}

/** HTTP の status → 分類（200 は本文を見て決めるので、ここでは扱わない） */
export function classifyOEmbedStatus(status: number): Exclude<OEmbedOutcome, 'ok'> {
  if (status === 404) return 'not_found';
  if (status === 401) return 'restricted';
  return 'unavailable';
}

/** 本物の port。fetchImpl・timeoutMs はテストで応答を模擬する時だけ渡す */
export function youtubeOEmbedPort(opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}): OEmbedPort {
  const timeoutMs = opts.timeoutMs ?? OEMBED_TIMEOUT_MS;
  return {
    isFake: false,
    async lookup(youtubeId, call) {
      if (typeof youtubeId !== 'string' || !YOUTUBE_ID_RE.test(youtubeId)) return { outcome: 'unavailable' };
      // 締め切り: fetch と本文の受信の両方に効かせる。試行の締め切りがあれば fetch の直前に測った残りと比べて短い方（§Q-11 2・Astra の指摘）
      const ms = call?.deadline === undefined ? timeoutMs : Math.min(timeoutMs, call.deadline - Date.now());
      if (!(ms > 0)) return { outcome: 'unavailable' };
      const signal = AbortSignal.timeout(ms);
      const f = opts.fetchImpl ?? fetch;
      let res: Response;
      try {
        res = await f(oembedUrl(youtubeId), { method: 'GET', redirect: 'manual', headers: { accept: 'application/json' }, signal });
      } catch {
        return { outcome: 'unavailable' };
      }
      if (res.status !== 200) {
        res.body?.cancel().catch(() => undefined);
        return { outcome: classifyOEmbedStatus(res.status) };
      }
      let body: { bytes: Uint8Array; truncated: boolean };
      try {
        body = await readBodyCapped(res, OEMBED_BODY_MAX_BYTES, signal);
      } catch {
        return { outcome: 'unavailable' };
      }
      if (body.truncated) return { outcome: 'unavailable' };
      let parsed: unknown;
      try {
        parsed = JSON.parse(new TextDecoder().decode(body.bytes));
      } catch {
        return { outcome: 'unavailable' };
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { outcome: 'unavailable' };
      const o = parsed as Record<string, unknown>;
      if (typeof o.title !== 'string' || !o.title || typeof o.author_name !== 'string' || !o.author_name) return { outcome: 'unavailable' };
      return { outcome: 'ok', ...sanitizeOEmbedFields(o) };
    },
  };
}
