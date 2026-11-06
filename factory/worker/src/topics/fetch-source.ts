// 出典を開く（契約 contract-T T-5 の 2）。モデルが書いた URL は信頼できない入力。
// URL の規則 checkSourceUrl と本文の正規化 normalizeForQuote は純関数。fetchSource は fetch を差し替えて試せる（fake・テスト）。
// 名前が社内の宛先に解決されるかどうかは見ない（Workers の fetch は公開のインターネットに出る。約束しない範囲 T-5）。

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

/** 戻す名前つきの文字参照（契約 v2.4 の裁定 1 の一覧） */
const NAMED_REFS: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', copy: '©', reg: '®', trade: '™', hellip: '…',
  mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', yen: '¥', middot: '·', times: '×', deg: '°',
};

/** 文字参照を戻す（数値の参照と NAMED_REFS）。知らない名前・範囲外の数値はそのまま残す。量指定が有限なので入力の長さに比例する */
export function decodeCharRefs(s: string): string {
  return s.replace(/&(?:#[xX]([0-9a-fA-F]{1,6})|#([0-9]{1,7})|([a-zA-Z]{2,8}));/g, (m, hex: string | undefined, dec: string | undefined, name: string | undefined) => {
    if (name !== undefined) return Object.prototype.hasOwnProperty.call(NAMED_REFS, name) ? NAMED_REFS[name] : m;
    const n = hex !== undefined ? Number.parseInt(hex, 16) : Number.parseInt(dec as string, 10);
    if (!(n > 0 && n <= 0x10ffff) || (n >= 0xd800 && n <= 0xdfff)) return m;
    return String.fromCodePoint(n);
  });
}

const isAsciiLetter = (c: number): boolean => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
const isSpace = (c: number): boolean => c === 32 || c === 9 || c === 10 || c === 12 || c === 13;

/**
 * タグ（< の次の位置 i から）の終わりの > の次の位置。属性の値の引用符の中の > は終わりにしない。閉じていなければ -1。
 * 引用符を値の始まりと見るのは = の直後（空白を挟んでよい）だけ。引用符の終わりは indexOf で飛ぶ（後戻りしない）
 */
function tagEnd(h: string, i: number): number {
  const n = h.length;
  let afterEq = false;
  while (i < n) {
    const c = h.charCodeAt(i);
    if (c === 62 /* > */) return i + 1;
    if (afterEq && (c === 34 || c === 39) /* " ' */) {
      const j = h.indexOf(c === 34 ? '"' : "'", i + 1);
      if (j < 0) return -1;
      i = j + 1;
      afterEq = false;
      continue;
    }
    if (c === 61 /* = */) afterEq = true;
    else if (!isSpace(c)) afterEq = false;
    i++;
  }
  return -1;
}

/** i から後ろで、大文字小文字を区別しない "</name"（の後ろが空白・/・> か終わり）の位置。無ければ -1 */
function findEndTag(h: string, i: number, name: string): number {
  for (;;) {
    const j = h.indexOf('</', i);
    if (j < 0) return -1;
    const k = j + 2 + name.length;
    if (h.slice(j + 2, k).toLowerCase() === name) {
      const c = h.charCodeAt(k);
      if (k >= h.length || isSpace(c) || c === 47 || c === 62) return j;
    }
    i = j + 2;
  }
}

/**
 * HTML → 本文（契約 v2.4 の裁定 1）。先頭から 1 回で読む状態つきの走査で、時間は入力の長さに比例する（どの位置も後戻りして読み直さない）。
 * - `<` の次が英字・`/`・`!`・`?` の時だけマークアップの始まり。それ以外の `<` は文字のまま
 * - タグは属性の値の引用符の中の `>` で終わらない。コメントは `-->` まで。`<!…>`・`<?…>` は `>` まで
 * - `<script>`・`<style>` は中身ごと除く（終わりは `</script` / `</style` だけ）
 * - 閉じていないコメント・タグ・script・style は、そこから終わりまでを本文に入れない
 * - 除いた所は空白 1 つにし、最後に文字参照を戻す。空白の正規化は normalizeForQuote
 */
export function htmlToText(html: string): string {
  const h = String(html ?? '');
  const n = h.length;
  const out: string[] = [];
  let textStart = 0;
  let i = 0;
  const cut = (at: number) => {
    if (at > textStart) out.push(h.slice(textStart, at));
    out.push(' ');
  };
  while (i < n) {
    const lt = h.indexOf('<', i);
    if (lt < 0) break;
    const c = lt + 1 < n ? h.charCodeAt(lt + 1) : -1;
    const isEnd = c === 47; /* / */
    if (!(isAsciiLetter(c) || isEnd || c === 33 /* ! */ || c === 63) /* ? */) {
      i = lt + 1; // 文字の <
      continue;
    }
    cut(lt);
    let next: number;
    if (c === 33 && h.startsWith('<!--', lt)) {
      if (h.startsWith('<!-->', lt)) next = lt + 5;
      else if (h.startsWith('<!--->', lt)) next = lt + 6;
      else {
        const e = h.indexOf('-->', lt + 4);
        next = e < 0 ? -1 : e + 3;
      }
    } else if (c === 33 || c === 63) {
      const e = h.indexOf('>', lt + 2);
      next = e < 0 ? -1 : e + 1;
    } else {
      // 開始タグか終了タグ。名前を読む
      let k = lt + (isEnd ? 2 : 1);
      const nameStart = k;
      while (k < n && isAsciiLetter(h.charCodeAt(k))) k++;
      const name = h.slice(nameStart, k).toLowerCase();
      next = tagEnd(h, k);
      if (next >= 0 && !isEnd && (name === 'script' || name === 'style')) {
        const close = findEndTag(h, next, name);
        next = close < 0 ? -1 : tagEnd(h, close + 2 + name.length);
      }
    }
    if (next < 0) {
      textStart = n; // 閉じていない: ここから終わりまでを本文に入れない
      break;
    }
    i = textStart = next;
  }
  if (textStart < n) out.push(h.slice(textStart));
  return decodeCharRefs(out.join(''));
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

/** 照合する引用の最小の長さ（正規化した後。T-1 の quote 20 字） */
export const QUOTE_MIN_CHARS = 20;

/**
 * 取得した本文（HTML かテキスト）に引用があるか（T-5 の 2 の正規化）。Worker の fetch と、生成の応答の web_fetch の結果の照合が共に使う。
 * タグ・文字参照を除くのは本文の側だけ。引用には空白と全角半角の正規化だけを当て、正規化した後が 20 字未満なら探さずに not_found
 * （司令塔の裁定 2026-11-06: <b></b> や &amp; で水増しした引用が縮んで、どのページにも見つかることを防ぐ）
 */
export function quoteOutcome(raw: string, quote: string): SourceFetchOutcome {
  const q = normalizeForQuote(quote);
  if (Array.from(q).length < QUOTE_MIN_CHARS) return { result: 'not_found', excerpt: null };
  const text = normalizeForQuote(htmlToText(raw));
  const excerpt = excerptAround(text, q);
  return excerpt === null ? { result: 'not_found', excerpt: null } : { result: 'found', excerpt };
}
