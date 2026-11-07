// 純関数: 本文の丸写しの検査（契約 §AK2 docs/plans/rights/contract-AK2.md AK2-1）。I/O を持たない。LLM は使わない。
// 職人が session で開いたページの文（web_fetch の結果）と本文の見える文の間に、正規化後 100 字以上の連続した一致
// （同じ URL の出典の quoted_excerpt に収まるものを除く・字 \p{L} が 60 字以上）があれば hit にする。
// 字の単位はコードポイント（Array.from）。start / length もコードポイント。
// 本文は 2 つの読み方（v4 裁定 2）で見る: spaced（区切りに空白を入れる）と joined（区切りに何も入れない = 描画のつながりと合わせる）。
// ページの文は D1 の state と checks には保存しない。R2 の版の場所の verbatim-pages.json（作り直しで照らし直すためだけ）に置く（v4 裁定 1）。
// ページの文・本文は信頼できない入力なので、ここでは比較にしか使わない（ログに出さない）。

import { decodeEntities, parseHtml, textOfHtml } from '../rights-check';

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
/** 版の R2 の場所に置く、走査したページの文の記録（作り直しが照らし直す。学習者・画面・API には出さない） */
export const VERBATIM_PAGES_FILE = 'verbatim-pages.json';
/** 取り込みの途中で events のページごとに置く記録（最後に VERBATIM_PAGES_FILE にまとめる） */
export const VERBATIM_PAGES_PARTS_DIR = 'verbatim-pages.parts/';
/** VERBATIM_PAGES_FILE の文の合計の上限（字。超えた分は入れずに truncated） */
export const VERBATIM_PAGES_MAX_CHARS = 3_000_000;

/** 本文の読み方: spaced = 区間・タグの境目に空白を入れる / joined = 何も入れずにつなぐ */
export type VerbatimView = 'spaced' | 'joined';

export type VerbatimStatus = 'found' | 'incomplete' | 'clean';

export interface VerbatimHit {
  path: string;
  /** 当たった読み方（start / length はその読み方の文での位置） */
  view: VerbatimView;
  start: number;
  length: number;
  url: string;
  /** text の先頭 60 字 */
  sample: string;
  /** 区間の全文（1,000 字まで） */
  text: string;
  /** text を 1,000 字で切った */
  text_cut?: true;
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
 * view = 'spaced'（既定）: 区間と行は元の順に空白でつなぐ。'joined': 同じ行の中の区間は空白なしでつなぎ（描画は行内コードの前後に空白を入れない）、
 * 行と行の間だけ空白にする。閉じていない囲みコードは残り全部をコードとして残す（見える文を落とさない側）
 */
export function visibleTextOfMd(md: string, view: VerbatimView = 'spaced'): string {
  const lines: string[] = [];
  let inFence = false;
  for (const line of String(md ?? '').split(/\r\n|\r|\n/)) {
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      lines.push(line);
      continue;
    }
    const out: string[] = [];
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
    lines.push(out.join(view === 'joined' ? '' : ' '));
  }
  return lines.join(' ');
}

/** joined の読み方で中身を入れる生テキスト要素（script・style 以外。textarea は parseHtml が text の token にする） */
const JOINED_RAW = new Set(['xmp', 'iframe', 'noembed', 'noframes', 'noscript', 'title']);

/**
 * html / svg の見える文。閉じていない構造は null（fail-closed）。
 * view = 'spaced'（既定）: §AK の textOfHtml（script・style・コメント・タグを落とし、タグの境目は空白 1 つ・template の中は入れない）。
 * 'joined': text の token を区切りなしでつなぐ（隣り合う span / tspan が描画でつながるのと合わせる）。生テキスト要素は script と style 以外を
 * 中身ごと入れる（xmp・noscript・iframe・noembed・noframes・title。title は実体を復号）。comment は入れない
 */
export function visibleTextOfHtml(s: string, view: VerbatimView = 'spaced'): string | null {
  const html = String(s ?? '');
  if (view === 'spaced') return textOfHtml(html);
  const tokens = parseHtml(html);
  if (!tokens) return null;
  let out = '';
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.type === 'text') {
      out += t.text;
      continue;
    }
    if (t.type === 'start' && JOINED_RAW.has(t.name)) {
      const end = tokens[k + 1];
      if (end && end.type === 'end' && end.name === t.name) {
        const raw = html.slice(t.end, end.start);
        out += t.name === 'title' ? decodeEntities(raw) : raw;
        k++;
      }
    }
  }
  return out;
}

/** 本文の 1 つの読み方（正規化した見える文） */
export interface VerbatimUnit {
  path: string;
  view: VerbatimView;
  /** 正規化した見える文のコードポイント（1 字ずつの文字列） */
  chars: string[];
  /** 同じ列のコードポイントの値 */
  cps: number[];
}

/** 正規化した本文（path の辞書順 → spaced → joined の順の読み方の列） */
export interface VerbatimBodies {
  units: VerbatimUnit[];
  /** 本文の合計の上限を超えた / 見える文を取り出せなかった本文がある */
  incomplete: boolean;
}

/**
 * 本文: path を辞書順に並べ、各 path の見える文を 2 つの読み方（spaced・joined）で normalizeForMatch。joined が spaced と一字も違わなければ
 * spaced だけ（同じ文の針を 2 回作らない）。合計（2 つの読み方の合計）が 300,000 字を超えたら超えた分は見ず incomplete。
 * 閉じていない構造の html / svg は見える文が決まらないので incomplete（その path は照合に入れない）
 */
export function prepareBodies(texts: ReadonlyMap<string, string>, maxChars = VERBATIM_BODY_MAX): VerbatimBodies {
  const paths = [...texts.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const out: VerbatimBodies = { units: [], incomplete: false };
  let total = 0;
  for (const p of paths) {
    const raw = texts.get(p) ?? '';
    const md = /\.md$/i.test(p);
    const spaced = md ? visibleTextOfMd(raw, 'spaced') : visibleTextOfHtml(raw, 'spaced');
    const joined = md ? visibleTextOfMd(raw, 'joined') : visibleTextOfHtml(raw, 'joined');
    if (spaced === null || joined === null) {
      out.incomplete = true;
      continue;
    }
    const ns = normalizeForMatch(spaced);
    const nj = normalizeForMatch(joined);
    const views: Array<[VerbatimView, string]> = nj === ns ? [['spaced', ns]] : [['spaced', ns], ['joined', nj]];
    for (const [view, text] of views) {
      let chars = Array.from(text);
      if (total + chars.length > maxChars) {
        chars = chars.slice(0, Math.max(0, maxChars - total));
        out.incomplete = true;
      }
      total += chars.length;
      out.units.push({ path: p, view, chars, cps: chars.map((c) => c.codePointAt(0)!) });
    }
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
  /** 窓の hash → 候補（unit = bodies.units の番号。読み方の並び → pos の昇順。64 個まで） */
  map: Map<number, Array<{ unit: number; pos: number }>>;
  /** 候補が 64 個を超えた窓がある */
  incomplete: boolean;
}

/** 各本文の位置 i の 40 字の窓の hash → 候補。同じ hash の候補が 64 個を超えた窓は 64 個までにし incomplete */
export function buildNeedles(bodies: VerbatimBodies): VerbatimNeedles {
  const map = new Map<number, Array<{ unit: number; pos: number }>>();
  let incomplete = false;
  for (let unit = 0; unit < bodies.units.length; unit++) {
    const cps = bodies.units[unit].cps;
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
      arr.push({ unit, pos: i });
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
function makeHit(path: string, view: VerbatimView, start: number, chars: readonly string[], url: string): VerbatimHit {
  const cut = chars.length > VERBATIM_TEXT_MAX;
  const kept = cut ? chars.slice(0, VERBATIM_TEXT_MAX) : chars;
  return {
    path,
    view,
    start,
    length: chars.length,
    url: Array.from(String(url ?? '')).slice(0, VERBATIM_URL_MAX).join(''),
    sample: kept.slice(0, VERBATIM_SAMPLE_CHARS).join(''),
    text: kept.join(''),
    ...(cut ? { text_cut: true as const } : {}),
  };
}

/**
 * 1 ページの走査。ページを normalizeForMatch（200,000 字まで。超えたら incomplete）。i = 0 から、窓の hash の候補を pos の昇順に、
 * 字の列が本当に一致するか確かめ、一致なら前後に伸ばして最長の区間を取る。区間が 100 字以上・字 60 字以上で、quotes（同じ URL の出典の
 * quoted_excerpt を normalizeForMatch した列）のどれにも区間の全文（前後の空白を取ったもの。v4 裁定 3）が収まらなければ hit。
 * 本文は読み方（bodies.units）ごとに照らす。ページの位置は一致の有無にかかわらず i + 1 へ進む。
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
  // 本文の読み方（unit）ごとの対角 d = pos − i → その対角で伸ばした区間のページ側の終わり
  const done = new Map<number, Map<number, number>>();
  let ops = 0;
  scan: for (let i = 0; i + W <= P; i++) {
    const cands = needles.map.get(windowHash(pcps, i));
    if (!cands) continue;
    for (const { unit, pos } of cands) {
      if (++ops > maxOps) {
        incomplete = true;
        break scan;
      }
      const u = bodies.units[unit];
      if (!u) continue;
      const body = u.chars;
      const d = pos - i;
      let diag = done.get(unit);
      if (!diag) {
        diag = new Map();
        done.set(unit, diag);
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
      const core = chars.join('').trim();
      if (quotes.some((q) => q.length > 0 && q.includes(core))) continue;
      hits.push(makeHit(u.path, u.view, start, chars, url));
    }
  }
  return { hits: mergeAll(hits), incomplete };
}

/** 2 つの重なる hit の和（url は先に見つけた方 a。text は和の先頭 1,000 字） */
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
    view: a.view,
    start,
    length,
    url: a.url,
    sample: kept.slice(0, VERBATIM_SAMPLE_CHARS).join(''),
    text: kept.join(''),
    ...(length > VERBATIM_TEXT_MAX ? { text_cut: true as const } : {}),
  };
}

const viewOf = (h: VerbatimHit): VerbatimView => (h.view === 'joined' ? 'joined' : 'spaced');
const VIEW_RANK: Record<VerbatimView, number> = { spaced: 0, joined: 1 };

/**
 * 併合（件数で切らない）。同じ path・同じ読み方で区間が重なる hit は範囲の和をとって 1 件（url は先に見つけた方）。
 * 順は path の辞書順 → 読み方（spaced → joined）→ start の昇順
 */
function mergeAll(list: readonly VerbatimHit[]): VerbatimHit[] {
  const seq = list.map((h, k) => ({ h, k }));
  seq.sort((x, y) =>
    x.h.path < y.h.path ? -1 : x.h.path > y.h.path ? 1 : VIEW_RANK[viewOf(x.h)] - VIEW_RANK[viewOf(y.h)] || x.h.start - y.h.start || x.k - y.k,
  );
  const out: Array<{ h: VerbatimHit; k: number }> = [];
  for (const cur of seq) {
    const last = out[out.length - 1];
    if (last && last.h.path === cur.h.path && viewOf(last.h) === viewOf(cur.h) && cur.h.start < last.h.start + last.h.length) {
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
 * 取り込みの events の走査の途中経過（reconcile_state_json.ev.verb。ページごとの writeState に含まれる）。ページの文は持たない
 * （R2 の {prefix}verbatim-pages.parts/<n>.json に置き、parts がその数）
 */
export interface VerbState {
  v: 2;
  hits: VerbatimHit[];
  /** 見つけた hit の数（30 件で切る前の数） */
  total: number;
  /** 走査したページ（web_fetch の結果）の数 */
  pages: number;
  incomplete: boolean;
  /** R2 に置き終えたページの記録の数（verbatim-pages.parts/0.json 〜 parts-1） */
  parts: number;
  /** 記録に入れられなかったページの文がある（ページの上限で切った・R2 に置けなかった）→ この版の記録は truncated */
  lost: boolean;
}

export const newVerbState = (): VerbState => ({ v: 2, hits: [], total: 0, pages: 0, incomplete: false, parts: 0, lost: false });

const isCount = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0;

/** 保存済みの値が今の形か（無い・版が違う → false = 呼び出し側が events を先頭から集計し直す） */
export function isVerbState(x: unknown): x is VerbState {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
  const o = x as Record<string, unknown>;
  if (o.v !== 2 || !Array.isArray(o.hits) || !isCount(o.total) || !isCount(o.pages) || typeof o.incomplete !== 'boolean') return false;
  if (!isCount(o.parts) || typeof o.lost !== 'boolean') return false;
  return (o.hits as unknown[]).every((h) => {
    const r = h as Record<string, unknown> | null;
    return (
      !!r &&
      typeof r === 'object' &&
      typeof r.path === 'string' &&
      (r.view === 'spaced' || r.view === 'joined') &&
      isCount(r.start) &&
      isCount(r.length) &&
      typeof r.url === 'string' &&
      typeof r.text === 'string' &&
      typeof r.sample === 'string'
    );
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

// ---------------------------------------------------------------------------------------------
// v4 裁定 1: 走査したページの文の記録（R2 の {prefix}verbatim-pages.json。作り直しが子の本文と子の引用で照らし直す）
// ---------------------------------------------------------------------------------------------

export interface VerbatimPage {
  url: string;
  /** normalizeForMatch 後の文 */
  text: string;
}
export interface VerbatimPagesFile {
  v: 1;
  pages: VerbatimPage[];
  /** 入れられなかった文がある（合計の上限・ページの上限・祖先の記録を読めなかった・R2 に置けなかった）→ 読む側は incomplete */
  truncated: boolean;
}

/** 記録に入れるページ（正規化して 200,000 字まで。cut = それより長く、後ろを入れていない） */
export function pageRecordOf(url: string, rawText: string): { page: VerbatimPage; cut: boolean } {
  const chars = Array.from(normalizeForMatch(rawText));
  const cut = chars.length > VERBATIM_PAGE_MAX;
  return { page: { url: String(url ?? ''), text: (cut ? chars.slice(0, VERBATIM_PAGE_MAX) : chars).join('') }, cut };
}

const cpCount = (s: string): number => {
  let n = 0;
  for (let k = 0; k < s.length; k++) {
    const c = s.charCodeAt(k);
    if (c < 0xdc00 || c > 0xdfff || k === 0 || s.charCodeAt(k - 1) < 0xd800 || s.charCodeAt(k - 1) > 0xdbff) n++;
  }
  return n;
};

/** 記録をまとめる: 同じ url で同じ text のものは 1 つ。合計が 3,000,000 字を超えるページは入れずに truncated。truncated の初期値は lost */
export function assemblePagesFile(pages: readonly VerbatimPage[], lost: boolean, maxChars = VERBATIM_PAGES_MAX_CHARS): VerbatimPagesFile {
  const out: VerbatimPagesFile = { v: 1, pages: [], truncated: lost };
  const seen = new Set<string>();
  let total = 0;
  for (const p of pages) {
    const key = p.url + '\u0000' + p.text;
    if (seen.has(key)) continue;
    seen.add(key);
    const n = cpCount(p.text);
    if (total + n > maxChars) {
      out.truncated = true;
      continue;
    }
    total += n;
    out.pages.push({ url: p.url, text: p.text });
  }
  return out;
}

/** 記録（まとめたもの / 途中のページごとのもの）を厳密に読む。v === 1・pages が配列・各行の url と text が文字列・truncated が真偽値（途中の記録は無くてよい）。外れたら null */
export function parsePagesFile(text: string, requireTruncated = true): VerbatimPagesFile | null {
  try {
    const o = JSON.parse(text) as Record<string, unknown> | null;
    if (!o || typeof o !== 'object' || Array.isArray(o) || o.v !== 1 || !Array.isArray(o.pages)) return null;
    if (requireTruncated ? typeof o.truncated !== 'boolean' : o.truncated !== undefined && typeof o.truncated !== 'boolean') return null;
    const pages: VerbatimPage[] = [];
    for (const raw of o.pages as unknown[]) {
      const r = raw as Record<string, unknown> | null;
      if (!r || typeof r !== 'object' || typeof r.url !== 'string' || typeof r.text !== 'string') return null;
      pages.push({ url: r.url, text: r.text });
    }
    return { v: 1, pages, truncated: o.truncated === true };
  } catch {
    return null;
  }
}
