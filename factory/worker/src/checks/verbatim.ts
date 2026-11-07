// 純関数: 本文の丸写しの検査（契約 §AK2 docs/plans/rights/contract-AK2.md AK2-1）。I/O を持たない。LLM は使わない。
// 職人が session で開いたページの文（web_fetch の結果）と本文の見える文の間に、正規化後 100 字以上の連続した一致
// （同じ URL の出典の quoted_excerpt に収まるものを除く・字 \p{L} が 60 字以上）があれば hit にする。
// 字の単位はコードポイント（Array.from）。start / length もコードポイント。ページの本文は保存しない（hit の区間の文だけ）。
// ページの文・本文は信頼できない入力なので、ここでは比較にしか使わない（ログに出さない）。

import { textOfHtml } from '../rights-check';

/** 一致とみなす最短の長さ（字） */
export const VERBATIM_MIN_LEN = 100;
/** 一致の区間に含まれる字（\p{L}）の最少の数 */
export const VERBATIM_MIN_LETTERS = 60;
/** 針の窓の幅（字） */
export const VERBATIM_WINDOW = 40;
/** 本文の合計の上限（字。超えた分は見ず incomplete） */
export const VERBATIM_BODY_MAX = 300_000;
/** 1 ページの上限（字。超えた分は見ず incomplete） */
export const VERBATIM_PAGE_MAX = 200_000;
/** 同じ hash の候補の上限（超えた窓は 64 個までにし incomplete） */
export const VERBATIM_BUCKET_MAX = 64;
/** 1 ページの照合の回数の上限（候補の確かめ 1 回・前後に伸ばす 1 字を 1 回と数える。超えたら incomplete） */
export const VERBATIM_OPS_MAX = 2_000_000;
/** 1 版に保存する hit の上限 */
export const VERBATIM_HITS_MAX = 30;
/** hit の sample（text の先頭）の長さ */
export const VERBATIM_SAMPLE_CHARS = 60;
/** hit の text の上限（超えたら先頭だけと text_cut） */
export const VERBATIM_TEXT_MAX = 1000;
/** hit の url の上限 */
export const VERBATIM_URL_MAX = 300;

export type VerbatimStatus = 'found' | 'incomplete' | 'clean';

export interface VerbatimHit {
  path: string;
  start: number;
  length: number;
  url: string;
  /** text の先頭 60 字 */
  sample: string;
  /** 区間の全文（1,000 字まで） */
  text: string;
  /** text を 1,000 字で切った */
  text_cut?: true;
  /** 作り直しで親の版の検出を引き継いだ（url は親の値） */
  carried?: true;
}

const ZERO_WIDTH_RE = /[​-‍⁠﻿]/g;
const SPACE_RUN_RE = /\s+/gu;
const LETTER_RE = /\p{L}/u;

/** NFKC → ゼロ幅を除く → 小文字 → Unicode の空白の連続を 1 つの半角空白に → trim（この順） */
export function normalizeForMatch(s: string): string {
  return String(s ?? '')
    .normalize('NFKC')
    .replace(ZERO_WIDTH_RE, '')
    .toLowerCase()
    .replace(SPACE_RUN_RE, ' ')
    .trim();
}

const FENCE_RE = /^\s{0,3}```/;
// 量指定子は上限つき（長い行で後戻りが二乗にならないように）
const IMAGE_RE = /!\[([^\]\n]{0,1000})\]\([^)\n]{0,2000}\)/g;
const LINK_RE = /\[([^\]\n]{0,1000})\]\([^)\n]{0,2000}\)/g;
const CITE_MARK_RE = /\[c\d{1,6}\]/g;
const EMPHASIS_RE = /[*_~#>]/g;
const LINE_HEAD_RE = /^[ \t>#]*(?:[-+]|\d{1,9}\.)(?=[ \t]|$)/;

/** コードの外の 1 区間: 画像は alt・リンクは文・[cN] を除く・強調などの記号を除く */
function stripOutsideCode(s: string): string {
  return s.replace(IMAGE_RE, '$1').replace(LINK_RE, '$1').replace(CITE_MARK_RE, '').replace(EMPHASIS_RE, '');
}

/**
 * md の見える文。コードの区間（囲みコード = ``` の行から次の ``` の行まで・行内コード = 同じ行の対になった ` の間）を先に切り出し、
 * 中身は無加工で残す（区切りの ``` の行と ` だけ除く）。コードの外にだけ、リンク・画像・強調・見出し・引用・箇条書きの記号・[cN] の除去を掛ける。
 * 区間と行は元の順に空白でつなぐ。閉じていない囲みコードは残り全部をコードとして残す（見える文を落とさない側）
 */
export function visibleTextOfMd(md: string): string {
  const out: string[] = [];
  let inFence = false;
  for (const line of String(md ?? '').split(/\r\n|\r|\n/)) {
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }
    const body = line.replace(LINE_HEAD_RE, '');
    const parts = body.split('`');
    // 対になった ` の間（奇数番目）がコード。最後の ` が対にならなければ、その ` から後ろはコードの外（` は残す）
    const pairedEnd = parts.length % 2 === 1 ? parts.length : parts.length - 1;
    for (let k = 0; k < parts.length; k++) {
      if (k >= pairedEnd) {
        out.push(stripOutsideCode('`' + parts[k]));
      } else if (k % 2 === 1) {
        out.push(parts[k]);
      } else {
        out.push(stripOutsideCode(parts[k]));
      }
    }
  }
  return out.join(' ');
}

/** html / svg の見える文（§AK の textOfHtml: script・style・コメント・タグを落とし、文字実体を復号）。閉じていない構造は null */
export function visibleTextOfHtml(s: string): string | null {
  return textOfHtml(String(s ?? ''));
}

/** 正規化した本文（path ごとのコードポイントの列） */
export interface VerbatimBodies {
  /** 辞書順の path */
  paths: string[];
  /** path → 正規化した見える文のコードポイント（1 字ずつの文字列） */
  chars: Map<string, string[]>;
  /** path → 同じ列のコードポイントの値 */
  cps: Map<string, number[]>;
  /** path → 正規化した見える文（chars を join したもの） */
  text: Map<string, string>;
  /** 本文の合計の上限を超えた / 見える文を取り出せなかった本文がある */
  incomplete: boolean;
}

/** 本文: path を辞書順に並べ、各 path の見える文を normalizeForMatch。合計が 300,000 字を超えたら超えた分は見ず incomplete */
export function prepareBodies(texts: ReadonlyMap<string, string>, maxChars = VERBATIM_BODY_MAX): VerbatimBodies {
  const paths = [...texts.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const out: VerbatimBodies = { paths: [], chars: new Map(), cps: new Map(), text: new Map(), incomplete: false };
  let total = 0;
  for (const p of paths) {
    const raw = texts.get(p) ?? '';
    const visible = /\.md$/i.test(p) ? visibleTextOfMd(raw) : visibleTextOfHtml(raw);
    if (visible === null) {
      // 閉じていない構造の html / svg: 見える文が決まらない = 検査が済まない（fail-closed）
      out.incomplete = true;
      continue;
    }
    let chars = Array.from(normalizeForMatch(visible));
    if (total + chars.length > maxChars) {
      chars = chars.slice(0, Math.max(0, maxChars - total));
      out.incomplete = true;
    }
    total += chars.length;
    out.paths.push(p);
    out.chars.set(p, chars);
    out.cps.set(p, chars.map((c) => c.codePointAt(0)!));
    out.text.set(p, chars.join(''));
  }
  return out;
}

/** コードポイントの列 cps の [from, from + w) の FNV-1a 32 bit（各コードポイントを UTF-32 の 4 byte として大きい桁から順に混ぜる） */
export function windowHash(cps: readonly number[], from: number, w = VERBATIM_WINDOW): number {
  let h = 0x811c9dc5;
  for (let k = from; k < from + w; k++) {
    const c = cps[k];
    h = Math.imul(h ^ ((c >>> 24) & 0xff), 0x01000193);
    h = Math.imul(h ^ ((c >>> 16) & 0xff), 0x01000193);
    h = Math.imul(h ^ ((c >>> 8) & 0xff), 0x01000193);
    h = Math.imul(h ^ (c & 0xff), 0x01000193);
  }
  return h >>> 0;
}

export interface VerbatimNeedles {
  /** 窓の hash → 候補（path の辞書順 → pos の昇順。64 個まで） */
  map: Map<number, Array<{ path: string; pos: number }>>;
  /** 候補が 64 個を超えた窓がある */
  incomplete: boolean;
}

/** 各本文の位置 i の 40 字の窓の hash → 候補。同じ hash の候補が 64 個を超えた窓は 64 個までにし incomplete */
export function buildNeedles(bodies: VerbatimBodies): VerbatimNeedles {
  const map = new Map<number, Array<{ path: string; pos: number }>>();
  let incomplete = false;
  for (const path of bodies.paths) {
    const cps = bodies.cps.get(path)!;
    for (let i = 0; i + VERBATIM_WINDOW <= cps.length; i++) {
      const h = windowHash(cps, i);
      let arr = map.get(h);
      if (!arr) {
        arr = [];
        map.set(h, arr);
      }
      if (arr.length >= VERBATIM_BUCKET_MAX) {
        incomplete = true;
        continue;
      }
      arr.push({ path, pos: i });
    }
  }
  return { map, incomplete };
}

function countLetters(chars: readonly string[], from: number, to: number): number {
  let n = 0;
  for (let k = from; k < to; k++) if (LETTER_RE.test(chars[k])) n++;
  return n;
}

/** 区間の文 → hit（text は 1,000 字まで・sample は先頭 60 字・url は 300 字まで） */
function makeHit(path: string, start: number, chars: readonly string[], url: string, extra: { carried?: true } = {}): VerbatimHit {
  const cut = chars.length > VERBATIM_TEXT_MAX;
  const kept = cut ? chars.slice(0, VERBATIM_TEXT_MAX) : chars;
  return {
    path,
    start,
    length: chars.length,
    url: Array.from(String(url ?? '')).slice(0, VERBATIM_URL_MAX).join(''),
    sample: kept.slice(0, VERBATIM_SAMPLE_CHARS).join(''),
    text: kept.join(''),
    ...(cut ? { text_cut: true as const } : {}),
    ...extra,
  };
}

/**
 * 1 ページの走査。ページを normalizeForMatch（200,000 字まで。超えたら incomplete）。i = 0 から、窓の hash の候補を pos の昇順に、
 * 字の列が本当に一致するか確かめ、一致なら前後に伸ばして最長の区間を取る。区間が 100 字以上・字 60 字以上で、quotes（同じ URL の出典の
 * quoted_excerpt を normalizeForMatch した列）のどれにも区間の全文が収まらなければ hit。ページの位置は一致の有無にかかわらず i + 1 へ進む。
 * 同じ本文の同じ対角（pos − i）で既に伸ばした区間の内側の候補は、伸ばすと同じ区間になるので、伸ばし直さない（結果は同じ。照合 1 回と数える）。
 * 照合の回数が 2,000,000 回を超えたら走査をやめて incomplete。返す hit は同じページの中で重なりを併合したもの（30 件で切らない）
 */
export function scanPage(
  needles: VerbatimNeedles,
  bodies: VerbatimBodies,
  pageText: string,
  url: string,
  quotes: readonly string[],
  maxOps = VERBATIM_OPS_MAX,
): { hits: VerbatimHit[]; incomplete: boolean } {
  let incomplete = false;
  let page = Array.from(normalizeForMatch(pageText));
  if (page.length > VERBATIM_PAGE_MAX) {
    page = page.slice(0, VERBATIM_PAGE_MAX);
    incomplete = true;
  }
  const pcps = page.map((c) => c.codePointAt(0)!);
  const P = page.length;
  const W = VERBATIM_WINDOW;
  const hits: VerbatimHit[] = [];
  // 本文 path ごとの対角 d = pos − i → その対角で伸ばした区間のページ側の終わり
  const done = new Map<string, Map<number, number>>();
  let ops = 0;
  scan: for (let i = 0; i + W <= P; i++) {
    const cands = needles.map.get(windowHash(pcps, i));
    if (!cands) continue;
    for (const { path, pos } of cands) {
      if (++ops > maxOps) {
        incomplete = true;
        break scan;
      }
      const body = bodies.chars.get(path);
      if (!body) continue;
      const d = pos - i;
      let diag = done.get(path);
      if (!diag) {
        diag = new Map();
        done.set(path, diag);
      }
      const pend = diag.get(d);
      if (pend !== undefined && i < pend) continue; // 伸ばし済みの区間の内側（伸ばすと同じ区間になる）
      let same = true;
      for (let k = 0; k < W; k++) {
        if (page[i + k] !== body[pos + k]) {
          same = false;
          break;
        }
      }
      if (!same) continue;
      let a = i - 1;
      let b = pos - 1;
      while (a >= 0 && b >= 0 && page[a] === body[b]) {
        if (++ops > maxOps) {
          incomplete = true;
          break scan;
        }
        a--;
        b--;
      }
      let c = i + W;
      let e = pos + W;
      while (c < P && e < body.length && page[c] === body[e]) {
        if (++ops > maxOps) {
          incomplete = true;
          break scan;
        }
        c++;
        e++;
      }
      diag.set(d, c);
      const start = b + 1;
      const length = e - start;
      if (length < VERBATIM_MIN_LEN || countLetters(body, start, e) < VERBATIM_MIN_LETTERS) continue;
      const chars = body.slice(start, e);
      const text = chars.join('');
      if (quotes.some((q) => q.length > 0 && q.includes(text))) continue;
      hits.push(makeHit(path, start, chars, url));
    }
  }
  return { hits: mergeAll(hits), incomplete };
}

/** 2 つの重なる hit の和（url と carried は先に見つけた方 a。text は和の先頭 1,000 字） */
function unionHit(a: VerbatimHit, b: VerbatimHit): VerbatimHit {
  const [e, l] = a.start <= b.start ? [a, b] : [b, a];
  const start = e.start;
  const end = Math.max(e.start + e.length, l.start + l.length);
  const length = end - start;
  const ec = Array.from(e.text);
  let chars: string[];
  if (e.text_cut || l.start + l.length <= e.start + e.length) {
    chars = ec;
  } else {
    const lc = Array.from(l.text);
    chars = ec.concat(lc.slice(e.start + e.length - l.start));
  }
  const kept = chars.slice(0, Math.min(length, VERBATIM_TEXT_MAX));
  return {
    path: a.path,
    start,
    length,
    url: a.url,
    sample: kept.slice(0, VERBATIM_SAMPLE_CHARS).join(''),
    text: kept.join(''),
    ...(length > VERBATIM_TEXT_MAX ? { text_cut: true as const } : {}),
    ...(a.carried ? { carried: true as const } : {}),
  };
}

/** 併合（件数で切らない）。同じ path で区間が重なる hit は範囲の和をとって 1 件（url は先に見つけた方）。順は path の辞書順 → start の昇順 */
function mergeAll(list: readonly VerbatimHit[]): VerbatimHit[] {
  const seq = list.map((h, k) => ({ h, k }));
  seq.sort((x, y) => (x.h.path < y.h.path ? -1 : x.h.path > y.h.path ? 1 : x.h.start - y.h.start || x.k - y.k));
  const out: Array<{ h: VerbatimHit; k: number }> = [];
  for (const cur of seq) {
    const last = out[out.length - 1];
    if (last && last.h.path === cur.h.path && cur.h.start < last.h.start + last.h.length) {
      // 先に見つけた方（並びの番号 k が小さい方）の url を残す
      const first = last.k <= cur.k ? last : cur;
      const second = first === last ? cur : last;
      out[out.length - 1] = { h: unionHit(first.h, second.h), k: first.k };
      continue;
    }
    out.push(cur);
  }
  return out.map((x) => x.h);
}

/** acc（先に見つけたもの）と more を併合し、30 件で切る（数え上げは引用の除外の後なので、切っても状態は found のまま） */
export function mergeHits(acc: readonly VerbatimHit[], more: readonly VerbatimHit[]): VerbatimHit[] {
  return mergeAll([...acc, ...more]).slice(0, VERBATIM_HITS_MAX);
}

/** 状態: 1 件以上 = found（未完了でも）/ 0 件で未完了 = incomplete / 0 件で済んだ = clean */
export function verbatimStatusOf(hitCount: number, incomplete: boolean): VerbatimStatus {
  return hitCount > 0 ? 'found' : incomplete ? 'incomplete' : 'clean';
}

/**
 * 作り直しの親の検出の引き継ぎ（AK2-2）: 親の checks（checks_json を読んだ値）→ 子の hit と未完了。
 * 親の verbatim_status が無い（本契約の前の版）→ 何も引き継がない。'clean' → 何も。'incomplete' → 子も incomplete。
 * 'found' → 親の各 hit について、text_cut なら子は incomplete、そうでなければ text が子の正規化した本文（どれかの path）に含まれれば、
 * 最初に見つかった位置で hit（url は親の値・carried）。形が読めない値は incomplete（fail-closed）
 */
export function inheritParentHits(parentChecks: unknown, bodies: VerbatimBodies): { hits: VerbatimHit[]; incomplete: boolean } {
  if (!parentChecks || typeof parentChecks !== 'object' || Array.isArray(parentChecks)) return { hits: [], incomplete: true };
  const c = parentChecks as Record<string, unknown>;
  if (!Object.hasOwn(c, 'verbatim_status')) return { hits: [], incomplete: false };
  const st = c.verbatim_status;
  if (st === 'clean') return { hits: [], incomplete: false };
  if (st !== 'found') return { hits: [], incomplete: true };
  const list = Array.isArray(c.verbatim_copy) ? (c.verbatim_copy as unknown[]) : null;
  if (!list) return { hits: [], incomplete: true };
  const hits: VerbatimHit[] = [];
  let incomplete = false;
  for (const raw of list) {
    const h = raw as Record<string, unknown> | null;
    if (!h || typeof h !== 'object' || typeof h.text !== 'string' || typeof h.url !== 'string') {
      incomplete = true;
      continue;
    }
    if (h.text_cut === true) {
      incomplete = true;
      continue;
    }
    const want = h.text;
    if (want.length === 0) continue;
    for (const path of bodies.paths) {
      const t = bodies.text.get(path)!;
      const at = t.indexOf(want);
      if (at < 0) continue;
      const start = Array.from(t.slice(0, at)).length;
      hits.push(makeHit(path, start, Array.from(want), h.url, { carried: true }));
      break;
    }
  }
  return { hits: mergeAll(hits), incomplete };
}

/** 取り込みの events の走査の途中経過（reconcile_state_json.ev.verb。ページごとの writeState に含まれる） */
export interface VerbState {
  v: 1;
  hits: VerbatimHit[];
  /** 見つけた hit の数（30 件で切る前の数） */
  total: number;
  /** 走査したページ（web_fetch の結果）の数 */
  pages: number;
  incomplete: boolean;
}

export const newVerbState = (): VerbState => ({ v: 1, hits: [], total: 0, pages: 0, incomplete: false });

const isCount = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0;

/** 保存済みの値が今の形か（無い・版が違う → false = 呼び出し側が events を先頭から集計し直す） */
export function isVerbState(x: unknown): x is VerbState {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
  const o = x as Record<string, unknown>;
  if (o.v !== 1 || !Array.isArray(o.hits) || !isCount(o.total) || !isCount(o.pages) || typeof o.incomplete !== 'boolean') return false;
  return (o.hits as unknown[]).every((h) => {
    const r = h as Record<string, unknown> | null;
    return !!r && typeof r === 'object' && typeof r.path === 'string' && isCount(r.start) && isCount(r.length) && typeof r.url === 'string' && typeof r.text === 'string' && typeof r.sample === 'string';
  });
}

/**
 * 承認と公開の止め（AK2-3）: 版の checks_json の verbatim_status が 'clean' でなければ止める理由。
 * verbatim_status が無い版（本契約の前に取り込んだ版・読めない checks_json）は null（従来どおり通す）
 */
export function verbatimBlockReason(checksJson: string | null | undefined): 'verbatim_copy_present' | 'verbatim_incomplete' | null {
  let o: unknown = null;
  try {
    o = checksJson ? JSON.parse(checksJson) : null;
  } catch {
    return null;
  }
  if (!o || typeof o !== 'object' || Array.isArray(o) || !Object.hasOwn(o, 'verbatim_status')) return null;
  const st = (o as Record<string, unknown>).verbatim_status;
  if (st === 'clean') return null;
  return st === 'found' ? 'verbatim_copy_present' : 'verbatim_incomplete';
}
