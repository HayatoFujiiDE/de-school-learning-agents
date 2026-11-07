// 純関数: 子ども向け本文の機械検査（契約 V-5）。I/O を持たない。取り込み（src/jobs.ts）が checks_json.child_text に入れる（20 件で切る。取り込みは止めない）。
// 見る文: (1) parts の variants の .md の本文（path はその path）。(2) summary_elementary / summary_secondary・各 part の title・entry_point.text・各動画の why（path は material.json）。
// file_name: この版のファイル名（variants / files の path の最後の / より後ろ）か最上位のファイル名が文に出ている。
// raw_markup（.md だけ）: 教材の記法 v1（見出し #〜#### / 段落 / - / 1. / **…** / コード / リンク）で整形されない記号が行に残っている。
// edition_text（.md だけ。§MC-1 3）: 版が決まっている題材で Java 版を宣言した版の変奏の本文に、「Java 版 <宣言した版番号>」の並びが無い（path ごとに 1 件・sample は空）。
// §AL-3（schema 2 の版だけ）: 本文は bodiesOf の .md（body と、あれば play）、要約は summariesOf（summary 1 本）。次の kind を足す（schema 1 の版には出さない）:
//   goal_word（子ども向けの文に目標語）/ body_too_long（本文の散文 > BODY_MAX_CHARS）/ body_too_short（印を除いた生の本文 < BODY_MIN_CHARS）/
//   questions_missing（問いの種が 2 件未満か claim_ids が空の問い）/ first_paragraph_not_action（本文の最初の段落に動作の語尾が無い）
// material・本文は職人が書いた信頼できない値なので、形が違う所は黙って飛ばす（例外を投げない）。

import { declaredEdition, isVersionBoundMaterial } from './edition';
import { GOAL_WORDS } from './goalwords';
import { bodiesOf, buddyTextsOf, schemaVersionOf, summariesOf } from './shape';

/** 子ども向けの文の検査の kind（契約 §AL-3。仕分けの網羅テストの材料） */
export const CHILD_TEXT_KINDS = [
  'file_name',
  'raw_markup',
  'edition_text',
  'goal_word',
  'body_too_long',
  'body_too_short',
  'questions_missing',
  'first_paragraph_not_action',
] as const;
export type ChildTextKind = (typeof CHILD_TEXT_KINDS)[number];
export interface ChildTextHit {
  path: string;
  kind: ChildTextKind;
  sample: string;
}

/** checks_json.child_text の件数の上限 */
export const CHILD_TEXT_MAX = 20;
/** sample の長さの上限（当たった所の前後を含む） */
export const CHILD_TEXT_SAMPLE_CHARS = 40;
/** 最上位のファイル名（この版の名前に加えて当てる） */
export const TOP_LEVEL_FILE_NAMES = ['material.json', 'claims.json', 'sources.json', 'adapt-rules.md', 'selfcheck.md', 'questions.json'] as const;

/** §AL-3: 本文（parts[].body）の散文（stripMarkdownForCheck 後）の code point 数の上限（職人には 1000 字以内と言う。10% の余裕） */
export const BODY_MAX_CHARS = 1100;
/** §AL-3: 本文（parts[].body）の生の本文（claim 印 [cN] だけ除く。コードを含む）の code point 数の下限 */
export const BODY_MIN_CHARS = 150;
/** §AL-3: 最初の段落に 1 つは欲しい動作の語尾 */
export const FIRST_ACTION_RE = /(て|で)(みよう|みて|みましょう|ごらん)|しよう|しましょう|やってみ|さわって|開いて|置いて|押して|動かして|作って|数えて|見つけて|たどって|見て/;

const FILE_NAME_RE = /[A-Za-z0-9][A-Za-z0-9_-]*\.(?:html|svg|png|webp|md|json)/gi;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

/** 空白の連続を 1 つにした文（一致の探索と sample の切り出しは、どちらもこの文で行う。位置がずれて sample が空にならないように） */
const oneSpace = (t: string): string => t.replace(/\s+/g, ' ');

/** 当たった所（one の i から len 字）の前後を含む 40 字以内。one は oneSpace を通した文 */
function sampleAt(one: string, i: number, len: number): string {
  const n = Math.min(len, CHILD_TEXT_SAMPLE_CHARS);
  const start = Math.max(0, i - Math.floor((CHILD_TEXT_SAMPLE_CHARS - n) / 2));
  return one.slice(start, start + CHILD_TEXT_SAMPLE_CHARS);
}

/**
 * .md の本文から、囲みコード（```）・行内コード（`…`）・リンク `[文](http…)` の URL・主張の印 `[c3]` を取り除く（契約 V-5）。
 * リンクは文を残して URL を除く（画像の埋め込み `![…](…)` はリンクとみなさず残す: raw_markup (e) が拾う）。行の数は変えない
 */
export function stripMarkdownForCheck(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let inFence = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      out.push('');
      continue;
    }
    if (inFence) {
      out.push('');
      continue;
    }
    out.push(
      line
        .replace(/`[^`]*`/g, '')
        .replace(/(^|[^!])\[([^\]]*)\]\(https?:[^)]*\)/gi, '$1$2')
        .replace(/\[c\d+\]/g, ''),
    );
  }
  return out.join('\n');
}

/** 行の raw_markup の当たり（無ければ null）。(a)〜(h) の最初の当たりの位置と長さ */
export function rawMarkupHit(line: string): { i: number; len: number } | null {
  const at = (re: RegExp, s: string = line, offset = 0): { i: number; len: number } | null => {
    const m = re.exec(s);
    return m ? { i: m.index + offset, len: Math.max(1, m[0].length) } : null;
  };
  // (a) ** が奇数個
  const stars = [...line.matchAll(/\*\*/g)];
  if (stars.length % 2 === 1) return { i: stars[stars.length - 1].index ?? 0, len: 2 };
  // (b) __
  const b = at(/__/);
  if (b) return b;
  // (c) < の直後が英字か /
  const c = at(/<[A-Za-z/]/);
  if (c) return c;
  // (d) 行頭（空白を除く）が |
  const d = at(/^\s*\|/);
  if (d) return d;
  // (e) ![
  const e = at(/!\[/);
  if (e) return e;
  // (f) 行頭が >
  if (line.startsWith('>')) return { i: 0, len: 1 };
  // (g) 行頭が # 5 個以上
  const g = at(/^#{5,}/);
  if (g) return g;
  // (h) * 1 個で囲んだ強調（行頭の箇条書きの `* ` は除く）
  const bullet = /^\s*\* /.exec(line);
  const rest = bullet ? line.slice(bullet[0].length) : line;
  const h = at(/(^|[^*])\*[^*\s][^*]*\*([^*]|$)/, rest, bullet ? bullet[0].length : 0);
  if (h) return h;
  return null;
}

/** この版のファイル名（小文字）: variants / files の path の最後の / より後ろ + 最上位のファイル名 */
function versionFileNames(material: unknown): Set<string> {
  const names = new Set<string>(TOP_LEVEL_FILE_NAMES);
  const parts = isObj(material) && Array.isArray(material.parts) ? material.parts : [];
  for (const p of parts) {
    if (!isObj(p)) continue;
    for (const key of ['variants', 'files']) {
      const list = p[key];
      if (!Array.isArray(list)) continue;
      for (const it of list) {
        const path = isObj(it) ? it.path : null;
        if (isStr(path)) names.add(path.slice(path.lastIndexOf('/') + 1).toLowerCase());
      }
    }
  }
  // §AL-3: 本文の .md（schema 2 の body / play）もこの版のファイル名（schema 1 の変奏は上の variants で入っている）
  for (const b of bodiesOf(material)) names.add(b.path.slice(b.path.lastIndexOf('/') + 1).toLowerCase());
  return names;
}

/** code point 数 */
const cpLen = (t: string): number => [...t].length;
/** 先頭 n code point */
const cpHead = (t: string, n: number): string => [...t].slice(0, n).join('');

/**
 * 本文（stripMarkdownForCheck 後）の最初の段落（見出し行・箇条書き・囲みコード（空行になっている）を飛ばした、最初の空行でない行の連なり）。
 * 空白の連続は 1 つにする。段落が無ければ ''
 */
function firstParagraph(stripped: string): string {
  const out: string[] = [];
  for (const line of stripped.split('\n')) {
    const blank = line.trim() === '';
    const skip = /^\s*#/.test(line) || /^\s*(?:[-*+]|\d+[.)])\s/.test(line);
    if (out.length > 0 && (blank || skip)) break;
    if (blank || skip) continue;
    out.push(line);
  }
  return oneSpace(out.join(' ')).trim();
}

/** 本文の .md（schema 2 の parts[].body）の散文の code point 数（契約 §AL-2 checks_json.body_chars。観測用）。schema 1 は空 */
export function bodyChars(material: unknown, texts: ReadonlyMap<string, string>): Array<{ path: string; chars: number }> {
  if (schemaVersionOf(material) !== 2) return [];
  const out: Array<{ path: string; chars: number }> = [];
  for (const b of bodiesOf(material)) {
    if (b.role !== 'body' || !b.path.toLowerCase().endsWith('.md')) continue;
    const body = texts.get(b.path);
    if (isStr(body)) out.push({ path: b.path, chars: cpLen(stripMarkdownForCheck(body)) });
  }
  return out;
}

/**
 * 本文に「Java 版 <version>」の並びがあるか（§MC-1 3・Astra R1。続け書きの「Java版26.3」と v つきも通す）。
 * 離れた所の数字（「Java 版の話。温度は26.3度。」）・後ろに数字や「.」が続く別の版番号（26.30・26.3.1）は数えない
 */
function hasJavaVersionText(text: string, version: string): boolean {
  const esc = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`Java\\s*版\\s*v?${esc}(?!\\d|\\.\\d)`).test(text);
}

export function checkChildText(material: unknown, texts: ReadonlyMap<string, string>): ChildTextHit[] {
  const out: ChildTextHit[] = [];
  const names = versionFileNames(material);
  // §AL-3: 新しい kind は schema 2 の版だけ
  const v2 = schemaVersionOf(material) === 2;
  // §MC-1 3: 版が決まっている題材で Java 版を宣言した時だけ本文の版の 1 文を見る（宣言が無い・統合版・版が決まっていない題材は見ない）
  const declared = isVersionBoundMaterial(material) ? declaredEdition(material) : null;
  const javaVersion = declared?.edition === 'java' ? declared.version : null;
  const full = () => out.length >= CHILD_TEXT_MAX;
  const seenName = new Set<string>();
  const seenGoal = new Set<string>();

  // text は oneSpace を通した文（探索と切り出しを同じ文で行う）
  const fileNames = (path: string, text: string) => {
    for (const m of text.matchAll(FILE_NAME_RE)) {
      if (full()) return;
      const w = m[0].toLowerCase();
      if (!names.has(w)) continue;
      const key = JSON.stringify([path, w]);
      if (seenName.has(key)) continue;
      seenName.add(key);
      out.push({ path, kind: 'file_name', sample: sampleAt(text, m.index ?? 0, m[0].length) });
    }
  };
  // §AL-3 goal_word: 目標語の部分一致（path と語の組で 1 件）。text は oneSpace を通した文
  const goalWords = (path: string, text: string) => {
    for (const w of GOAL_WORDS) {
      if (full()) return;
      const i = text.indexOf(w);
      if (i === -1) continue;
      const key = JSON.stringify([path, w]);
      if (seenGoal.has(key)) continue;
      seenGoal.add(key);
      out.push({ path, kind: 'goal_word', sample: sampleAt(text, i, w.length) });
    }
  };

  const parts = isObj(material) && Array.isArray(material.parts) ? material.parts : [];
  // (1) 本文の .md（part の順 → schema 1 は variants の順 / schema 2 は body → play）
  for (const b of bodiesOf(material)) {
    const path = b.path;
    if (!path.toLowerCase().endsWith('.md')) continue;
    const body = texts.get(path);
    if (!isStr(body)) continue;
    const stripped = stripMarkdownForCheck(body);
    if (javaVersion !== null) {
      if (full()) return out;
      const one = oneSpace(stripped);
      if (!hasJavaVersionText(one, javaVersion)) out.push({ path, kind: 'edition_text', sample: '' });
    }
    if (v2) {
      if (b.role === 'body') {
        if (full()) return out;
        if (cpLen(stripped) > BODY_MAX_CHARS) out.push({ path, kind: 'body_too_long', sample: '' });
        if (full()) return out;
        if (cpLen(body.replace(/\[c\d+\]/g, '')) < BODY_MIN_CHARS) out.push({ path, kind: 'body_too_short', sample: '' });
        if (full()) return out;
        const first = firstParagraph(stripped);
        if (!FIRST_ACTION_RE.test(first)) out.push({ path, kind: 'first_paragraph_not_action', sample: cpHead(first, CHILD_TEXT_SAMPLE_CHARS) });
      }
      goalWords(path, oneSpace(stripped));
      if (full()) return out;
    }
    for (const raw of stripped.split('\n')) {
      if (full()) return out;
      const line = oneSpace(raw);
      fileNames(path, line);
      if (full()) return out;
      const hit = rawMarkupHit(line);
      if (hit) out.push({ path, kind: 'raw_markup', sample: sampleAt(line, hit.i, hit.len) });
    }
  }
  // (2) material.json の子ども向けの文
  const meta: string[] = summariesOf(material).map((s) => s.text);
  for (const p of parts) {
    if (!isObj(p)) continue;
    if (isStr(p.title)) meta.push(p.title);
    if (isObj(p.entry_point) && isStr(p.entry_point.text)) meta.push(p.entry_point.text);
    if (Array.isArray(p.videos)) for (const v of p.videos) if (isObj(v) && isStr(v.why)) meta.push(v.why);
  }
  for (const t of meta) {
    if (full()) return out;
    fileNames('material.json', oneSpace(t));
  }
  // §AL-6: schema 2 の問いの種・関心別の入口もバディ経由で子どもに届く文（goal_word の列挙は下の (3) のまま。meta には足さない）
  for (const b of buddyTextsOf(material)) {
    if (full()) return out;
    fileNames('material.json', oneSpace(b.text));
  }
  if (!v2) return out.slice(0, CHILD_TEXT_MAX);

  // (3) §AL-3: schema 2 の material.json の文の目標語（spark には当てない）と、問いの種
  const goalTexts = [...meta];
  for (const p of parts) {
    if (!isObj(p)) continue;
    for (const key of ['questions_for_kids', 'interest_entries']) {
      const list = p[key];
      if (Array.isArray(list)) for (const it of list) if (isObj(it) && isStr(it.text)) goalTexts.push(it.text);
    }
  }
  for (const t of goalTexts) {
    if (full()) return out;
    goalWords('material.json', oneSpace(t));
  }
  for (const p of parts) {
    if (full()) return out;
    if (!isObj(p)) continue;
    const qs = Array.isArray(p.questions_for_kids) ? p.questions_for_kids : [];
    const empty = qs.find((q) => isObj(q) && Array.isArray(q.claim_ids) && q.claim_ids.length === 0);
    if (qs.length < 2 || empty !== undefined) out.push({ path: 'material.json', kind: 'questions_missing', sample: isObj(empty) && isStr(empty.id) ? empty.id : '' });
  }
  return out.slice(0, CHILD_TEXT_MAX);
}
