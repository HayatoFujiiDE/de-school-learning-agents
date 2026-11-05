// 出典を開く（契約 contract-T T-5 の 2）。モデルが書いた URL は信頼できない入力。
// URL の規則 checkSourceUrl と本文の正規化 normalizeForQuote は純関数。fetchSource は fetch を差し替えて試せる（fake・テスト）。
// 名前が社内の宛先に解決されるかどうかは見ない（Workers の fetch は公開のインターネットに出る。約束しない範囲 T-5）。

import { decodeEntities } from '../scout';

/** URL の規則（T-5 の 2）。満たせば URL、満たさなければ null */
export function checkSourceUrl(raw: unknown): URL | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2000) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  if (u.username !== '' || u.password !== '') return null;
  if (u.port !== '') return null;
  // URL が正規化した後のホスト名（IPv4 の 0x7f.1 や 2130706433 は 127.0.0.1 に、IPv6 は [..] になる）を小文字にして末尾の . を除く
  const host = u.hostname.toLowerCase().replace(/\.+$/, '');
  if (!host.includes('.')) return null;
  if (host.startsWith('[') || host.includes(':')) return null; // IPv6
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null; // IPv4
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host === 'home.arpa' || host.endsWith('.home.arpa')) return null;
  if (host === 'local' || host === 'internal') return null;
  return u;
}

const FULLWIDTH_ALNUM = /[０-９Ａ-Ｚａ-ｚ]/g;

/** 全角の英数字を半角に寄せる（T-5 の 2「全角・半角の英数を寄せる」） */
export function foldWidth(s: string): string {
  return s.replace(FULLWIDTH_ALNUM, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/　/g, ' ');
}

/** HTML → 本文（<script>・<style>・コメントを除き、タグを除き、文字参照を戻す）。空白の正規化は normalizeForQuote */
export function htmlToText(html: string): string {
  let t = html.replace(/<!--[\s\S]*?-->/g, ' ');
  t = t.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  t = t.replace(/<(script|style)\b[\s\S]*$/gi, ' '); // 閉じていない script / style の後ろは本文に入れない
  t = t.replace(/<[^>]*>/g, ' ');
  return decodeEntities(t);
}

/** 引用の照合に使う正規化（空白の連続を 1 つ・全角半角の英数を寄せる）。本文と quote に同じものを当てる */
export function normalizeForQuote(s: string): string {
  return foldWidth(String(s ?? ''))
    .replace(/\s+/g, ' ')
    .trim();
}

/** 抜き書き: 正規化した本文の、引用の前 600 字 + 引用 + 後 600 字（最大 1400 字）。引用が無ければ null */
export function excerptAround(normText: string, normQuote: string): string | null {
  if (!normQuote) return null;
  const i = normText.indexOf(normQuote);
  if (i < 0) return null;
  const start = Math.max(0, i - 600);
  const end = Math.min(normText.length, i + normQuote.length + 600);
  return normText.slice(start, end).slice(0, 1400);
}

export type FetchResult = 'found' | 'not_found' | 'fetch_failed' | 'blocked';

export interface SourceFetchOutcome {
  result: FetchResult;
  /** found の時だけ */
  excerpt: string | null;
}

export const SOURCE_FETCH_LIMITS = {
  maxRedirects: 3,
  maxBytes: 2 * 1024 * 1024,
  timeoutMs: 8_000,
} as const;

const TEXT_TYPES = new Set(['text/html', 'text/plain', 'application/xhtml+xml']);

/** 応答の種類（content-type の ; より前）が本文として読めるもの */
export function acceptableSourceType(contentType: string | null): boolean {
  return TEXT_TYPES.has((contentType ?? '').split(';')[0].trim().toLowerCase());
}

/** 本文を maxBytes まで流しながら読む。超えたら null（打ち切り） */
async function readTextCapped(res: Response, maxBytes: number, signal: AbortSignal): Promise<string | null> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const onAbort = () => reader.cancel().catch(() => undefined);
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder().decode(buf);
}

const discard = async (res: Response) => {
  try {
    await res.body?.cancel();
  } catch {
    /* 読み捨て */
  }
};

export interface FetchSourceOptions {
  fetchImpl: typeof fetch;
  /** 絶対の締め切り（epoch ms）。1 本の上限 8 秒とどちらか早い方で切る */
  deadline?: number;
}

/**
 * 出典を開いて引用を探す（T-5 の 2）。redirect は manual で最大 3 回まで自分で追い、毎回 URL の規則を当てる。
 * 2xx の時だけ本文を読む。種類違い・規則違反は blocked、2xx 以外・時間切れ・接続の失敗・2 MiB 超は fetch_failed。
 */
export async function fetchSource(url: string, quote: string, o: FetchSourceOptions): Promise<SourceFetchOutcome> {
  let target = checkSourceUrl(url);
  if (!target) return { result: 'blocked', excerpt: null };
  const ms = Math.max(0, Math.min(SOURCE_FETCH_LIMITS.timeoutMs, o.deadline !== undefined ? o.deadline - Date.now() : SOURCE_FETCH_LIMITS.timeoutMs));
  if (ms < 500) return { result: 'fetch_failed', excerpt: null };
  const signal = AbortSignal.timeout(ms);
  try {
    for (let hop = 0; ; hop++) {
      const res = await o.fetchImpl(target.toString(), {
        redirect: 'manual',
        signal,
        headers: { accept: 'text/html, application/xhtml+xml, text/plain;q=0.9' },
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        await discard(res);
        if (hop >= SOURCE_FETCH_LIMITS.maxRedirects || !loc) return { result: hop >= SOURCE_FETCH_LIMITS.maxRedirects ? 'blocked' : 'fetch_failed', excerpt: null };
        let next: URL | null;
        try {
          next = checkSourceUrl(new URL(loc, target).toString());
        } catch {
          next = null;
        }
        if (!next) return { result: 'blocked', excerpt: null };
        target = next;
        continue;
      }
      if (res.status < 200 || res.status >= 300) {
        await discard(res);
        return { result: 'fetch_failed', excerpt: null };
      }
      if (!acceptableSourceType(res.headers.get('content-type'))) {
        await discard(res);
        return { result: 'blocked', excerpt: null };
      }
      const raw = await readTextCapped(res, SOURCE_FETCH_LIMITS.maxBytes, signal);
      if (raw === null) return { result: 'fetch_failed', excerpt: null };
      return quoteOutcome(raw, quote);
    }
  } catch {
    return { result: 'fetch_failed', excerpt: null };
  }
}

/** 取得した本文（HTML かテキスト）に引用があるか（T-5 の 2 の正規化） */
export function quoteOutcome(raw: string, quote: string): SourceFetchOutcome {
  const text = normalizeForQuote(htmlToText(raw));
  const q = normalizeForQuote(htmlToText(quote));
  const excerpt = excerptAround(text, q);
  return excerpt === null ? { result: 'not_found', excerpt: null } : { result: 'found', excerpt };
}
