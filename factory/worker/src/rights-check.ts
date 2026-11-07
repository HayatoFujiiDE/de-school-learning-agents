// 権利の確認（契約 §AK-2 v3.1。I/O）: 台帳（rights-providers.ts）の確かめ方で提供元の記録を取り、機械の検査を通ったものだけ verified の記録にする。
// - 取りに行く url は一覧の静的な値（page_url / embed_url / download_url / evidence_url）と台帳の定数だけ。リダイレクトは追わない（redirect: 'manual'）
// - 応答の HTML / JSON は untrusted。本文は上限（readCapped）を超えたら使わない。HTML は状態を区別する字句解析器（parseHtml）で読む
//   （text / tag の属性値の引用 / comment / script・style の生テキスト）。閉じていない構造は unparseable（fail-closed）。
//   正の判定（あること）は解析結果だけで、負の判定（無いこと・一意であること）は解析結果と生 HTML（実体を復号）の両方で見る（v3.1・B1）
// - 正規表現は固定長の文字クラスと単一の量指定子だけ（後方参照・入れ子の量指定子なし）。decodeURIComponent は使わない
// - 1 つの項目の確認（検査 + 取り込み）は同時に 1 本（行の claim と所有トークン）。結果の保存と rights_checks の追記は 1 つの batch（トークンが一致する時だけ）。
//   取り込みの有効化（models3d_files・rights_hosted・取り込みの履歴）も 1 つの batch で、claim を持ち止めていない時だけ（v3.1・B2・B3）
// - ログの 1 行は {at, asset_key, kind, result, code} だけ（url・本文・応答の JSON・attribution を出さない）

import { conditionalBatch, isoPlus, nowIso, stmt, type Stmt } from './db';
import type { Env } from './env';
import type { Model3dEntry } from './generated/models3d-catalog';
import { readCapped } from './models3d-file';
import {
  assetKey,
  failClass,
  licenseCodeOfUrl,
  NASA_MEDIA_URL,
  nextStatus,
  normalizeLicenseUrl,
  rightsModes,
  sha256Hex,
  squash,
  subjectSha256,
  type EvidenceKind,
  type FailClass,
  type LicenseCode,
  type RightsRecord,
  type RightsStatus,
} from './rights';
import { evidenceKindOf, isSketchfabPageOf, NASA_HUB_URL, NASA_TERMS_URL, providerOf, SKETCHFAB_API_BASE, sketchfabUidOf } from './rights-providers';
import { rightsRecordOf } from './rights-store';
import { importModel3d, type ImportOutcome } from './routes/models3d';

const FETCH_TIMEOUT_MS = 20_000;
const API_MAX_BYTES = 256 * 1024;
const PAGE_MAX_BYTES = 1024 * 1024;
const CLAIM_TTL_MS = 10 * 60_000;
const DETAILS_MAX = 3000;

// ---------------------------------------------------------------------------
// untrusted な HTML の字句解析（純関数。v3.1・B1）

/** ASCII の英大文字だけを小文字にする（長さが変わらないので、元の文字列と同じ位置で探せる） */
const asciiLower = (s: string): string => s.replace(/[A-Z]/g, (c) => c.toLowerCase());
const isAsciiAlpha = (c: number): boolean => (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
/** HTML の空白（TAB・LF・FF・CR・SPACE） */
const isHtmlWs = (c: number): boolean => c === 0x09 || c === 0x0a || c === 0x0c || c === 0x0d || c === 0x20;
/** 終了タグの名前の後ろに来てよい文字（空白・/・>） */
const isTagDelim = (c: number): boolean => isHtmlWs(c) || c === 0x2f || c === 0x3e;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  nbsp: '\u00a0',
  quot: '"',
  copy: '\u00a9',
  COPY: '\u00a9',
  lt: '<',
  gt: '>',
  apos: "'",
  colon: ':',
  sol: '/',
  period: '.',
  lpar: '(',
  rpar: ')',
};
// 数値（; なしも。桁数は制限しない = 先頭の 0 で隠せない）と、名前付き（amp・nbsp・quot・copy・COPY・lt・gt は ; なしの旧式も。
// apos・colon・sol・period・lpar・rpar は ; 付きだけ。v3.2 で COPY と記号を足した）
const ENTITY_RE = /&(?:#([0-9]+);?|#[xX]([0-9a-fA-F]+);?|(amp|nbsp|quot|copy|COPY|lt|gt)(;?)|(apos|colon|sol|period|lpar|rpar);)/g;

/**
 * 文字実体を 1 回だけ復号する。inAttr（属性値）では、; の無い名前付きの実体の直後が英数字か = の時は復号しない（HTML の決まり）。
 * 数値の範囲外・0・サロゲートは U+FFFD
 */
export function decodeEntities(s: string, inAttr = false): string {
  return s.replace(ENTITY_RE, (m: string, dec: string | undefined, hex: string | undefined, name: string | undefined, semi: string | undefined, sym: string | undefined, off: number) => {
    if (sym) return NAMED_ENTITIES[sym];
    if (name !== undefined) {
      if (!semi && inAttr && /[A-Za-z0-9=]/.test(s.charAt(off + m.length))) return m;
      return NAMED_ENTITIES[name];
    }
    // 先頭の 0 を落としてから桁数を見る（長すぎる数は範囲外 = U+FFFD）
    const digits = (dec ?? hex!).replace(/^0+/, '');
    if (digits.length > (dec !== undefined ? 8 : 7)) return '�';
    return codePointText(digits === '' ? 0 : parseInt(digits, dec !== undefined ? 10 : 16));
  });
}
const codePointText = (n: number): string => (!Number.isFinite(n) || n <= 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff) ? '�' : String.fromCodePoint(n));

export interface HtmlTagToken {
  type: 'start' | 'end';
  /** 小文字の要素名 */
  name: string;
  /** 小文字の属性名 → 実体を復号した値（同じ名前は最初のもの） */
  attrs: ReadonlyMap<string, string>;
  /** 生 HTML の中の位置 [start, end) */
  start: number;
  end: number;
}
export interface HtmlTextToken {
  type: 'text';
  /** 実体を復号した文（script・style・comment は入らない） */
  text: string;
  start: number;
  end: number;
}
export type HtmlToken = HtmlTagToken | HtmlTextToken;

/** 中身をタグとして読まない要素（生テキスト。可視テキストに入れない）。script は別に扱う（エスケープの状態がある） */
const RAW_TEXT = new Set(['style', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript']);
/** 中身をタグとして読まないが実体は復号する要素（title は可視テキストに入れない・textarea は入れる） */
const RCDATA = new Set(['title', 'textarea']);

/** i（'<' の位置）からタグを 1 つ読む。属性値の "…" '…' と引用なしを区別する。閉じていなければ null */
function readTag(html: string, i: number): { isEnd: boolean; name: string; attrs: Map<string, string>; end: number; selfClosing: boolean } | null {
  const n = html.length;
  let j = i + 1;
  const isEnd = html.charCodeAt(j) === 0x2f;
  if (isEnd) j++;
  const nameStart = j;
  while (j < n && !isTagDelim(html.charCodeAt(j))) j++;
  if (j >= n) return null;
  const name = asciiLower(html.slice(nameStart, j));
  const attrs = new Map<string, string>();
  for (;;) {
    const skipFrom = j;
    while (j < n && (isHtmlWs(html.charCodeAt(j)) || html.charCodeAt(j) === 0x2f)) j++;
    if (j >= n) return null;
    // 属性の外で読み飛ばした / の直後の > = 自己終了（引用なしの属性値の末尾の / は値に入るので数えない）
    if (html.charCodeAt(j) === 0x3e) return { isEnd, name, attrs, end: j + 1, selfClosing: j > skipFrom && html.charCodeAt(j - 1) === 0x2f };
    const an = j;
    j++; // 先頭の 1 字は = でも名前に入る（HTML の決まり）
    while (j < n && !isTagDelim(html.charCodeAt(j)) && html.charCodeAt(j) !== 0x3d) j++;
    if (j >= n) return null;
    const attrName = asciiLower(html.slice(an, j));
    while (j < n && isHtmlWs(html.charCodeAt(j))) j++;
    if (j >= n) return null;
    let value = '';
    if (html.charCodeAt(j) === 0x3d) {
      j++;
      while (j < n && isHtmlWs(html.charCodeAt(j))) j++;
      if (j >= n) return null;
      const q = html.charCodeAt(j);
      if (q === 0x22 || q === 0x27) {
        const close = html.indexOf(q === 0x22 ? '"' : "'", j + 1);
        if (close < 0) return null;
        value = html.slice(j + 1, close);
        j = close + 1;
      } else {
        const vs = j;
        while (j < n && !isHtmlWs(html.charCodeAt(j)) && html.charCodeAt(j) !== 0x3e) j++;
        if (j >= n) return null;
        value = html.slice(vs, j);
      }
    }
    if (!attrs.has(attrName)) attrs.set(attrName, decodeEntities(value, true));
  }
}

/** low（ASCII 小文字の写し）で from 以降の </name（直後が空白・/・>）の位置。無ければ -1 */
function rawTextEnd(low: string, from: number, name: string): number {
  const pat = '</' + name;
  let k = from;
  for (;;) {
    const p = low.indexOf(pat, k);
    if (p < 0) return -1;
    if (isTagDelim(low.charCodeAt(p + pat.length))) return p;
    k = p + 2;
  }
}

/**
 * script の生テキストの終わり（</script の位置）。HTML の決まりのエスケープの状態をたどる:
 * data で <!-- → escaped（</script で終わる・<script で double へ・--> で data へ）、double では </script で escaped へ・--> で data へ
 */
function scriptEnd(low: string, from: number): number {
  const n = low.length;
  const endAt = (p: number) => low.startsWith('</script', p) && isTagDelim(low.charCodeAt(p + 8));
  const startAt = (p: number) => low.startsWith('<script', p) && isTagDelim(low.charCodeAt(p + 7));
  let state: 'data' | 'escaped' | 'double' = 'data';
  let i = from;
  while (i < n) {
    if (state === 'data') {
      const p = low.indexOf('<', i);
      if (p < 0) return -1;
      if (low.startsWith('<!--', p)) {
        if (low.charCodeAt(p + 4) === 0x3e) i = p + 5; // <!--> はすぐ data に戻る
        else if (low.startsWith('->', p + 4)) i = p + 6; // <!---> も同じ
        else {
          state = 'escaped';
          i = p + 4;
        }
        continue;
      }
      if (endAt(p)) return p;
      i = p + 1;
      continue;
    }
    const dd = low.indexOf('-->', i);
    let p = low.indexOf('<', i);
    let moved = false;
    while (p >= 0 && (dd < 0 || p < dd)) {
      if (state === 'escaped' && endAt(p)) return p;
      if (state === 'escaped' && startAt(p)) {
        state = 'double';
        i = p + 7;
        moved = true;
        break;
      }
      if (state === 'double' && endAt(p)) {
        state = 'escaped';
        i = p + 8;
        moved = true;
        break;
      }
      p = low.indexOf('<', p + 1);
    }
    if (moved) continue;
    if (dd < 0) return -1;
    state = 'data';
    i = dd + 3;
  }
  return -1;
}

/**
 * untrusted な HTML の字句解析。状態: text / tag（属性値の引用を区別）/ comment / script・style 等の生テキスト。
 * 閉じていない comment・tag・属性の引用・script / style（生テキスト）・plaintext は null（= unparseable）
 */
export function parseHtml(html: string): HtmlToken[] | null {
  const n = html.length;
  const low = asciiLower(html);
  // v3.2: <![CDATA[ は HTML と SVG で意味が違い（SVG では ]]> まで文字）、正の判定を偽に満たせるので扱わない
  if (low.includes('<![cdata[')) return null;
  const tokens: HtmlToken[] = [];
  let textStart = 0;
  let i = 0;
  const flush = (end: number) => {
    if (end > textStart) tokens.push({ type: 'text', text: decodeEntities(html.slice(textStart, end)), start: textStart, end });
  };
  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt < 0) break;
    const c1 = html.charCodeAt(lt + 1);
    const c2 = html.charCodeAt(lt + 2);
    if (html.startsWith('<!--', lt)) {
      flush(lt);
      let end: number;
      if (html.startsWith('<!-->', lt)) end = lt + 5;
      else if (html.startsWith('<!--->', lt)) end = lt + 6;
      else {
        const a = html.indexOf('-->', lt + 4);
        const b = html.indexOf('--!>', lt + 4);
        if (a < 0 && b < 0) return null;
        end = b >= 0 && (a < 0 || b < a) ? b + 4 : a + 3;
      }
      i = textStart = end;
      continue;
    }
    if (isAsciiAlpha(c1) || (c1 === 0x2f && isAsciiAlpha(c2))) {
      flush(lt);
      const t = readTag(html, lt);
      if (!t) return null;
      if (!t.isEnd && t.name === 'plaintext') return null; // 残り全部が文字になる要素は扱わない
      // v3.2: 生テキスト要素（script・style 等）の開始タグの自己終了は HTML では自己終了にならない（続きが生テキストになる）。空要素として扱うと
      // 隠れた本文を本文とみなすので扱わない
      if (!t.isEnd && t.selfClosing && (t.name === 'script' || RAW_TEXT.has(t.name) || RCDATA.has(t.name))) return null;
      tokens.push({ type: t.isEnd ? 'end' : 'start', name: t.name, attrs: t.attrs, start: lt, end: t.end });
      i = textStart = t.end;
      if (!t.isEnd && (t.name === 'script' || RAW_TEXT.has(t.name) || RCDATA.has(t.name))) {
        const close = t.name === 'script' ? scriptEnd(low, i) : rawTextEnd(low, i, t.name);
        if (close < 0) return null;
        if (t.name === 'textarea') tokens.push({ type: 'text', text: decodeEntities(html.slice(i, close)), start: i, end: close });
        const et = readTag(html, close);
        if (!et) return null;
        tokens.push({ type: 'end', name: t.name, attrs: et.attrs, start: close, end: et.end });
        i = textStart = et.end;
      }
      continue;
    }
    if (c1 === 0x21 || c1 === 0x3f || c1 === 0x2f) {
      // <!DOCTYPE …>・<!…>・<?…>・</ の後ろが英字でないもの = 次の > まで（</> は何もしない）
      flush(lt);
      if (c1 === 0x2f && c2 === 0x3e) {
        i = textStart = lt + 3;
        continue;
      }
      const gt = html.indexOf('>', lt + 2);
      if (gt < 0) return null;
      i = textStart = gt + 1;
      continue;
    }
    i = lt + 1; // < の後ろが英字・/・!・? でなければ文字
  }
  flush(n);
  return tokens;
}

export interface VisibleText {
  /** 可視テキスト（空白を 1 つに・前後の空白なし。タグの境目は空白 1 つ） */
  text: string;
  /** 可視テキストの位置 v から始まる文の、生 HTML の中の位置 raw（文のかたまりごと） */
  marks: Array<{ v: number; raw: number }>;
}

/** 解析結果の可視テキスト（template の中は入れない） */
export function visibleTextOf(tokens: readonly HtmlToken[]): VisibleText {
  let text = '';
  const marks: Array<{ v: number; raw: number }> = [];
  let pending = false;
  let template = 0;
  for (const t of tokens) {
    if (t.type !== 'text') {
      if (t.name === 'template') template = t.type === 'start' ? template + 1 : Math.max(0, template - 1);
      pending = true;
      continue;
    }
    if (template > 0) continue;
    const norm = t.text.replace(/\s+/g, ' ');
    if (norm === '') continue;
    const lead = norm.charCodeAt(0) === 0x20;
    const trail = norm.charCodeAt(norm.length - 1) === 0x20;
    const core = norm.slice(lead ? 1 : 0, trail ? norm.length - 1 : norm.length);
    if (core === '') {
      pending = true;
      continue;
    }
    if ((pending || lead) && text.length > 0) text += ' ';
    marks.push({ v: text.length, raw: t.start });
    text += core;
    pending = trail;
  }
  return { text, marks };
}

/** untrusted な HTML の可視テキスト（閉じていない構造なら null） */
export function textOfHtml(html: string): string | null {
  const tokens = parseHtml(html);
  return tokens ? visibleTextOf(tokens).text : null;
}

/** template の外の、name の開始タグから次の終了タグまでの可視テキスト（全部）。終了タグが無ければ null */
function elementTexts(tokens: readonly HtmlToken[], name: string): string[] | null {
  const out: string[] = [];
  let template = 0;
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.type !== 'text' && t.name === 'template') template = t.type === 'start' ? template + 1 : Math.max(0, template - 1);
    if (template > 0 || t.type !== 'start' || t.name !== name) continue;
    let e = k + 1;
    while (e < tokens.length && !(tokens[e].type === 'end' && (tokens[e] as HtmlTagToken).name === name)) e++;
    if (e >= tokens.length) return null;
    out.push(visibleTextOf(tokens.slice(k + 1, e)).text);
    k = e;
  }
  return out;
}

/** template の外の、name の開始タグの attr の値（復号済み）全部 */
function attrValues(tokens: readonly HtmlToken[], name: string, attr: string): string[] {
  const out: string[] = [];
  let template = 0;
  for (const t of tokens) {
    if (t.type === 'text') continue;
    if (t.name === 'template') template = t.type === 'start' ? template + 1 : Math.max(0, template - 1);
    if (template === 0 && t.type === 'start' && t.name === name) {
      const v = t.attrs.get(attr);
      if (v !== undefined) out.push(v);
    }
  }
  return out;
}

/** 可視テキストの位置 v を含む文のかたまりの、生 HTML の始まり */
function rawStartAt(marks: VisibleText['marks'], v: number): number {
  let lo = 0;
  let hi = marks.length - 1;
  let best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (marks[mid].v <= v) {
      best = marks[mid].raw;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best;
}
/** 可視テキストの位置 v 以降で始まる最初の文のかたまりの、生 HTML の始まり（無ければ末尾） */
function rawEndAt(marks: VisibleText['marks'], v: number, total: number): number {
  for (const m of marks) if (m.v >= v) return m.raw;
  return total;
}

const cutCodePoints = (s: string, n: number): string => [...s].slice(0, n).join('');

// ---------------------------------------------------------------------------
// 取得（redirect: 'manual'・timeout 20 s・上限つき）

type Fetched = { ok: true; text: string } | { ok: false; code: string };

async function fetchCapped(fetchImpl: typeof fetch, url: string, accept: string, max: number): Promise<Fetched> {
  try {
    const res = await fetchImpl(url, { redirect: 'manual', headers: { accept }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (res.status !== 200) {
      await res.body?.cancel().catch(() => {});
      return { ok: false, code: `fetch_failed:${res.status}` };
    }
    const cl = res.headers.get('content-length');
    if (cl !== null && /^\d+$/.test(cl.trim()) && Number(cl.trim()) > max) {
      await res.body?.cancel().catch(() => {});
      return { ok: false, code: 'too_large' };
    }
    const got = await readCapped(res.body, max);
    if (got === 'too_large') return { ok: false, code: 'too_large' };
    return { ok: true, text: new TextDecoder('utf-8').decode(got) };
  } catch (e) {
    return { ok: false, code: e && typeof e === 'object' && (e as { name?: unknown }).name === 'TimeoutError' ? 'fetch_failed:timeout' : 'fetch_failed:network' };
  }
}

// ---------------------------------------------------------------------------
// 機械の検査（台帳の 3 種類）。結果は verified の記録の中身か fail_code

export interface EvidenceItem {
  url: string;
  sha256?: string;
  ok: boolean;
  note?: string;
}

export type CheckResult = { ok: true; license_code: LicenseCode; license_url: string; attribution: string; evidence: EvidenceItem[] } | { ok: false; fail_code: string };

const failed = (fail_code: string): CheckResult => ({ ok: false, fail_code });
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** sketchfab（api）: Data API v3 の応答を一覧と照らす（AK-2 の順序と fail_code のとおり） */
export async function checkSketchfab(e: Model3dEntry, fetchImpl: typeof fetch): Promise<CheckResult> {
  const uid = sketchfabUidOf(e.embed_url);
  if (uid === null) return failed('embed_mismatch');
  const apiUrl = SKETCHFAB_API_BASE + uid;
  const got = await fetchCapped(fetchImpl, apiUrl, 'application/json', API_MAX_BYTES);
  if (!got.ok) return failed(got.code);
  let j: unknown;
  try {
    j = JSON.parse(got.text);
  } catch {
    return failed('bad_response');
  }
  if (!isObj(j) || !isObj(j.user)) return failed('bad_response');
  if (j.uid !== uid) return failed('uid_mismatch');
  if (e.uploader === null) return failed('uploader_missing');
  if (j.user.username !== e.uploader) return failed('uploader_mismatch');
  if (j.embedUrl !== e.embed_url) return failed('embed_mismatch');
  if (!isSketchfabPageOf(j.viewerUrl, uid)) return failed('page_mismatch');
  const lic = isObj(j.license) ? j.license : null;
  if (!lic || typeof lic.url !== 'string') return failed('no_license_url');
  const displayName = j.user.displayName;
  if (typeof displayName !== 'string' || [...squash(displayName)].length < 3) return failed('bad_response');
  if (!squash(e.attribution).includes(squash(displayName))) return failed('attribution_mismatch');
  const shown = cutCodePoints(displayName, 200);
  const digest = await sha256Hex(
    JSON.stringify({
      uid,
      username: j.user.username,
      displayName: shown,
      embedUrl: j.embedUrl,
      viewerUrl: j.viewerUrl,
      license: { slug: typeof lic.slug === 'string' ? lic.slug : null, url: lic.url },
    }),
  );
  return {
    ok: true,
    license_code: licenseCodeOfUrl(lic.url),
    license_url: normalizeLicenseUrl(lic.url) ?? '',
    attribution: e.attribution,
    evidence: [{ url: apiUrl, sha256: digest, ok: true, note: 'creator=' + shown }],
  };
}

const NASA_MARKER_RE = /copyright|\u00a9|&copy|courtesy|all\s+rights\s+reserved|used\s+with\s+permission/i;
const DETAILS_SOURCE = ' Details Source ';
const DOWNLOADS = ' Downloads ';

/**
 * nasa-3d（statement）: モデルのページ・3D Resources のトップ・利用の決まりの 3 つ（AK-2 v3.1 の順序と fail_code のとおり）。
 * 正の判定（h1・Source の行・ファイルのリンク・決まりの文）は解析結果だけ。第三者の印は Details の区画の可視テキストと、同じ区画の生 HTML（実体を復号。
 * comment・属性・script を含め除去しない）の両方で見る
 */
export async function checkNasa(e: Model3dEntry, fetchImpl: typeof fetch): Promise<CheckResult> {
  // (a) モデルのページ
  const page = await fetchCapped(fetchImpl, e.page_url, 'text/html', PAGE_MAX_BYTES);
  if (!page.ok) return failed(page.code);
  const tokens = parseHtml(page.text);
  if (!tokens) return failed('unparseable');
  const h1 = elementTexts(tokens, 'h1');
  if (h1 === null || h1.length !== 1) return failed('title_missing');
  if (h1[0] !== e.title_src) return failed('title_mismatch');
  if (!/^NASA(\/|$)/.test(e.attribution)) return failed('source_not_nasa');
  const vis = visibleTextOf(tokens);
  const text = vis.text;
  const at = text.indexOf(DETAILS_SOURCE);
  if (at < 0 || !text.slice(at + DETAILS_SOURCE.length).startsWith(e.attribution + ' ')) return failed('source_mismatch');
  const dl = text.indexOf(DOWNLOADS, at + 1);
  const end = Math.min(dl < 0 ? Number.POSITIVE_INFINITY : dl, at + DETAILS_MAX);
  const rawSection = page.text.slice(rawStartAt(vis.marks, at), rawEndAt(vis.marks, end, page.text.length));
  // 区画は広めに取る（負の判定だけ。区画の前後の文のかたまりが入りうる = 安全側）
  if (NASA_MARKER_RE.test(text.slice(at, end)) || NASA_MARKER_RE.test(rawSection) || NASA_MARKER_RE.test(decodeEntities(rawSection))) return failed('third_party_marker');
  if (e.download_url === null || !attrValues(tokens, 'a', 'href').includes(e.download_url)) return failed('download_url_not_linked');
  // (b) 3D Resources のトップ
  const hub = await fetchCapped(fetchImpl, NASA_HUB_URL, 'text/html', PAGE_MAX_BYTES);
  if (!hub.ok) return failed(hub.code);
  const hubText = textOfHtml(hub.text);
  if (hubText === null) return failed('unparseable');
  if (!hubText.includes('free to download and use')) return failed('statement_missing:hub');
  // (c) 利用の決まり（一覧の license.url が台帳の url と違えば取らない）
  if (normalizeLicenseUrl(e.license.url) !== NASA_MEDIA_URL) return failed('license_url_mismatch');
  const terms = await fetchCapped(fetchImpl, NASA_TERMS_URL, 'text/html', PAGE_MAX_BYTES);
  if (!terms.ok) return failed(terms.code);
  const termsText = textOfHtml(terms.text);
  if (termsText === null) return failed('unparseable');
  if (!termsText.includes('not subject to copyright in the United States') || !termsText.includes('educational or informational purposes')) return failed('statement_missing:terms');
  return {
    ok: true,
    license_code: 'nasa-media',
    license_url: NASA_MEDIA_URL,
    attribution: e.attribution,
    evidence: [
      { url: e.page_url, sha256: await sha256Hex(text), ok: true },
      { url: NASA_HUB_URL, sha256: await sha256Hex(hubText), ok: true },
      { url: NASA_TERMS_URL, sha256: await sha256Hex(termsText), ok: true },
    ],
  };
}

const CC_URL_RE = /https?:\/\/creativecommons\.org\/[A-Za-z0-9./_-]+/g;
const ccUrlsIn = (s: string): string[] => [...s.matchAll(CC_URL_RE)].map((m) => m[0]);
/** v3.2: scheme の書き方（https&colon;// など）に依存しない CC の URL の拾い方（一意の検査の側だけ）。https:// を付けて正規化する */
const CC_PATH_RE = /creativecommons\.org\/(?:licenses|publicdomain)\/[A-Za-z0-9./_-]*/gi;
const ccPathsIn = (s: string): string[] => [...s.matchAll(CC_PATH_RE)].map((m) => 'https://' + m[0]);

/** url の host と、path の先頭 2 区分（どちらも空でない時だけ）。https でなければ null */
function scopeOf(u: string): { host: string; head: string } | null {
  try {
    const x = new URL(u);
    if (x.protocol !== 'https:') return null;
    const segs = x.pathname.split('/');
    if (segs.length < 4 || !segs[1] || !segs[2]) return null;
    return { host: x.host, head: `/${segs[1]}/${segs[2]}/` };
  } catch {
    return null;
  }
}

/**
 * dbcls（cc-url）: 根拠のページの CC の URL（embed だけの根拠。host には使わない）。
 * 「ある」は解析結果（可視テキストと <a> の href）だけで見る。「一意」は生 HTML の全文（実体を復号）・可視テキスト・href の和集合で見る:
 * 正規化した URL が 1 つで code が 1 種類でなければ ambiguous_cc_url
 */
export async function checkCcUrl(e: Model3dEntry, fetchImpl: typeof fetch): Promise<CheckResult> {
  if (e.evidence_url === null) return failed('evidence_url_missing');
  const ev = scopeOf(e.evidence_url);
  const pg = scopeOf(e.page_url);
  if (!ev || !pg || ev.host !== pg.host || ev.head !== pg.head) return failed('evidence_scope_mismatch');
  const got = await fetchCapped(fetchImpl, e.evidence_url, 'text/html', PAGE_MAX_BYTES);
  if (!got.ok) return failed(got.code);
  const tokens = parseHtml(got.text);
  if (!tokens) return failed('unparseable');
  const text = visibleTextOf(tokens).text;
  if (!text.includes(e.title_src)) return failed('subject_mismatch');
  const norm = (list: string[]) => new Set(list.map(normalizeLicenseUrl).filter((u): u is string => u !== null));
  const shown = norm([...ccUrlsIn(text), ...attrValues(tokens, 'a', 'href').flatMap(ccUrlsIn)]);
  if (shown.size === 0) return failed('no_cc_url');
  const all = new Set([...shown, ...norm(ccUrlsIn(decodeEntities(got.text))), ...norm(ccPathsIn(decodeEntities(got.text)))]);
  const codes = new Set([...all].map(licenseCodeOfUrl));
  if (all.size !== 1 || codes.size !== 1) return failed('ambiguous_cc_url');
  const url = [...all][0];
  return { ok: true, license_code: licenseCodeOfUrl(url), license_url: url, attribution: e.attribution, evidence: [{ url: e.evidence_url, sha256: await sha256Hex(text), ok: true }] };
}

/** smithsonian（human）: 一覧の値から人の記録の中身を作る（機械の検査はしない） */
export function humanRecordOf(e: Model3dEntry): { license_code: LicenseCode; license_url: string; attribution: string; evidence_json: string; checked_at: string } {
  return {
    license_code: licenseCodeOfUrl(e.license.url),
    license_url: normalizeLicenseUrl(e.license.url) ?? '',
    attribution: e.attribution,
    evidence_json: JSON.stringify([{ url: e.page_url, ok: true, note: `${e.checked_at} ${cutCodePoints(e.checked_how, 300)}` }]),
    checked_at: e.checked_at,
  };
}

// ---------------------------------------------------------------------------
// runRightsCheck（AK-2 の 1〜8）

/** 取り込みの結果（止めていたので取り込まなかった時は error: 'blocked'） */
export type RightsImport = ImportOutcome | { ok: false; error: 'blocked'; http: 409 };

export type RightsCheckOutcome =
  | { kind: 'skipped'; reason: 'unsupported' | 'busy' }
  | { kind: 'human'; result: 'human' | 'human_unchanged'; record: RightsRecord }
  | { kind: 'verified'; record: RightsRecord; blocked: boolean; import: RightsImport | null }
  | { kind: 'failed'; fail_code: string; fail_class: FailClass; status: RightsStatus }
  | { kind: 'lost_claim' };

const randomToken = (): string => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');

const logCheck = (key: string, kind: EvidenceKind, result: string, code: string | null) =>
  console.log(JSON.stringify({ at: 'rights_check', asset_key: key, kind, result, code }));

/** P = その行の claim をまだこのトークンが持っている（結果の保存・取り込みの失敗の記録はこれが成り立つ時だけ） */
const HELD = 'EXISTS (SELECT 1 FROM rights_records WHERE asset_key = ? AND claim_token = ?)';

const checkRow = (key: string, at: string, by: string, kind: EvidenceKind, result: string, code: LicenseCode | null, evidenceJson: string, token: string): Stmt =>
  stmt(
    `INSERT INTO rights_checks (asset_key, at, by, evidence_kind, result, license_code, evidence_json, check_token) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ${HELD}`,
    key,
    at,
    by,
    kind,
    result,
    code,
    evidenceJson,
    token,
    key,
    token,
  );

/** 行の今の blocked と claim_token（取り込みの前と、有効化が 0 行だった後に読み直す） */
async function claimState(db: D1Database, key: string): Promise<{ blocked: boolean; claim_token: string | null } | null> {
  const r = await db.prepare('SELECT blocked, claim_token FROM rights_records WHERE asset_key = ?').bind(key).first<{ blocked: number; claim_token: string | null }>();
  return r ? { blocked: Number(r.blocked) !== 0, claim_token: r.claim_token ?? null } : null;
}

/**
 * 1 つの項目の権利を確かめる（AK-2）。by は 'cron' か運営の email。fetchImpl はテストが stub を渡す。
 * claim（行の所有トークン）を取れなければ busy。結果の保存・取り込みの有効化はトークンが一致する時だけ（期限で回収された古い実行は lost_claim）
 */
export async function runRightsCheck(env: Pick<Env, 'DB' | 'R2'>, e: Model3dEntry, by: string, fetchImpl: typeof fetch = fetch): Promise<RightsCheckOutcome> {
  const db = env.DB;
  const provider = providerOf(e);
  // 1. 台帳に無い提供元は D1 に書かない
  if (provider.kind === 'unsupported') return { kind: 'skipped', reason: 'unsupported' };
  const key = assetKey('models3d', e.id);
  const kind = evidenceKindOf(provider);
  const subject = await subjectSha256(e);

  // 2. claim（新規は unverified の行を作る。claim 中で期限内なら changes 0 = busy）
  const token = randomToken();
  const now = nowIso();
  const claimed = await db
    .prepare(
      `INSERT INTO rights_records (asset_key, subject_sha256, license_code, license_url, attribution, evidence_kind, evidence_json, modified, status, blocked, fail_code, checked_at, last_attempt_at, checked_by, claim_at, claim_token) VALUES (?, ?, 'unknown', '', ?, ?, '[]', 0, 'unverified', 0, NULL, NULL, ?, ?, ?, ?) ON CONFLICT(asset_key) DO UPDATE SET claim_at = excluded.claim_at, claim_token = excluded.claim_token, last_attempt_at = excluded.last_attempt_at WHERE rights_records.claim_at IS NULL OR rights_records.claim_at < ?`,
    )
    .bind(key, subject, e.attribution, kind, now, by, now, token, isoPlus(-CLAIM_TTL_MS))
    .run();
  if (Number(claimed.meta?.changes ?? 0) === 0) {
    logCheck(key, kind, 'busy', null);
    return { kind: 'skipped', reason: 'busy' };
  }

  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    await db.prepare('UPDATE rights_records SET claim_at = NULL, claim_token = NULL WHERE asset_key = ? AND claim_token = ?').bind(key, token).run();
  };
  const lost = (): RightsCheckOutcome => {
    released = true; // トークンはもう行に無い（回収された）
    logCheck(key, kind, 'lost_claim', null);
    return { kind: 'lost_claim' };
  };
  try {
    const curRow = await db.prepare('SELECT * FROM rights_records WHERE asset_key = ?').bind(key).first<Record<string, unknown>>();
    const cur = curRow ? rightsRecordOf(curRow) : 'invalid';
    const curStatus: RightsStatus | null = cur === 'invalid' ? null : cur.status;

    // 3. 人の記録（機械で確かめられない提供元）
    if (provider.kind === 'none') {
      const hr = humanRecordOf(e);
      const base = cur === 'invalid' ? null : cur;
      if (base && base.status === 'human' && base.subject_sha256 === subject) {
        // no-op: last_attempt_at と claim の解放だけ。rights_checks に足さない
        const r = await db
          .prepare('UPDATE rights_records SET last_attempt_at = ?, claim_at = NULL, claim_token = NULL WHERE asset_key = ? AND claim_token = ?')
          .bind(nowIso(), key, token)
          .run();
        released = true;
        if (Number(r.meta?.changes ?? 0) === 0) return lost();
        logCheck(key, kind, 'human_unchanged', base.license_code);
        return { kind: 'human', result: 'human_unchanged', record: base };
      }
      const at = nowIso();
      const b = await conditionalBatch(db, [
        checkRow(key, at, by, 'human', 'human', hr.license_code, hr.evidence_json, token),
        stmt(
          `UPDATE rights_records SET subject_sha256 = ?, license_code = ?, license_url = ?, attribution = ?, evidence_kind = 'human', evidence_json = ?, status = 'human', fail_code = NULL, checked_at = ?, last_attempt_at = ?, checked_by = ?, claim_at = NULL, claim_token = NULL WHERE asset_key = ? AND claim_token = ?`,
          subject,
          hr.license_code,
          hr.license_url,
          hr.attribution,
          hr.evidence_json,
          hr.checked_at,
          at,
          by,
          key,
          token,
        ),
      ]);
      released = true;
      if (!b.ok) return lost();
      const record: RightsRecord = {
        asset_key: key,
        subject_sha256: subject,
        license_code: hr.license_code,
        license_url: hr.license_url,
        attribution: hr.attribution,
        evidence_kind: 'human',
        evidence_json: hr.evidence_json,
        modified: base?.modified ?? false,
        status: 'human',
        blocked: base?.blocked ?? false,
        fail_code: null,
        checked_at: hr.checked_at,
        last_attempt_at: at,
        checked_by: by,
      };
      logCheck(key, kind, 'human', hr.license_code);
      return { kind: 'human', result: 'human', record };
    }

    // 4〜5. 機械の検査
    const res = provider.kind === 'api' ? await checkSketchfab(e, fetchImpl) : provider.kind === 'statement' ? await checkNasa(e, fetchImpl) : await checkCcUrl(e, fetchImpl);
    if (!res.ok) {
      const cls = failClass(res.fail_code);
      const status = nextStatus(curStatus, cls);
      const at = nowIso();
      const b = await conditionalBatch(db, [
        checkRow(key, at, by, kind, res.fail_code, null, '[]', token),
        stmt(
          `UPDATE rights_records SET status = ?, fail_code = ?, last_attempt_at = ?, checked_by = ?, claim_at = NULL, claim_token = NULL WHERE asset_key = ? AND claim_token = ?`,
          status,
          res.fail_code,
          at,
          by,
          key,
          token,
        ),
      ]);
      released = true;
      if (!b.ok) return lost();
      logCheck(key, kind, res.fail_code, null);
      return { kind: 'failed', fail_code: res.fail_code, fail_class: cls, status };
    }
    // 成功の保存（blocked・modified の列は書かない = 確認の途中に止めても上書きしない）
    const evidenceJson = JSON.stringify(res.evidence);
    const at = nowIso();
    const b = await conditionalBatch(db, [
      checkRow(key, at, by, kind, 'verified', res.license_code, evidenceJson, token),
      stmt(
        `UPDATE rights_records SET subject_sha256 = ?, license_code = ?, license_url = ?, attribution = ?, evidence_kind = ?, evidence_json = ?, status = 'verified', fail_code = NULL, checked_at = ?, last_attempt_at = ?, checked_by = ? WHERE asset_key = ? AND claim_token = ?`,
        subject,
        res.license_code,
        res.license_url,
        res.attribution,
        kind,
        evidenceJson,
        at,
        at,
        by,
        key,
        token,
      ),
    ]);
    if (!b.ok) return lost();
    const base = cur === 'invalid' ? null : cur;
    // 6. 取り込みの前に行を読み直す（確かめている途中に止めた・claim を失った、を見る。outcome の blocked は読み直した値）
    const fresh = await claimState(db, key);
    const blocked = fresh ? fresh.blocked : (base?.blocked ?? false);
    const record: RightsRecord = {
      asset_key: key,
      subject_sha256: subject,
      license_code: res.license_code,
      license_url: res.license_url,
      attribution: res.attribution,
      evidence_kind: kind,
      evidence_json: evidenceJson,
      modified: base?.modified ?? false,
      status: 'verified',
      blocked,
      fail_code: null,
      checked_at: at,
      last_attempt_at: at,
      checked_by: by,
    };
    let imported: RightsImport | null = null;
    const wantsHost = e.kind === 'download' && e.download_url !== null && rightsModes({ ...record, blocked: false }, subject).host;
    if (wantsHost) {
      if (!fresh || fresh.claim_token !== token) return lost();
      if (blocked) imported = { ok: false, error: 'blocked', http: 409 };
      else {
        try {
          imported = await importModel3d(env, e, by, fetchImpl, token);
        } catch {
          imported = { ok: false, error: 'internal_error', http: 500 };
        }
        if (!imported.ok && imported.error === 'not_activated') {
          // 有効化の batch が 0 行 = claim を失ったか、止められた
          const again = await claimState(db, key);
          if (!again || again.claim_token !== token) return lost();
          record.blocked = again.blocked;
          imported = again.blocked ? { ok: false, error: 'blocked', http: 409 } : imported;
        } else if (!imported.ok) {
          const s = checkRow(key, nowIso(), by, kind, `import:${imported.error}`, null, '[]', token);
          await db.prepare(s.sql).bind(...s.params).run();
        }
      }
    }
    logCheck(key, kind, 'verified', res.license_code);
    return { kind: 'verified', record, blocked: record.blocked, import: imported };
  } catch (err) {
    logCheck(key, kind, 'error:' + (err instanceof Error ? err.name.replace(/[^A-Za-z0-9_]/g, '').slice(0, 40) : 'error'), null);
    throw err;
  } finally {
    // 7. 解放（失敗・人の記録・lost_claim の経路は上の UPDATE で済んでいる）
    if (!released) await release().catch(() => {});
  }
}
