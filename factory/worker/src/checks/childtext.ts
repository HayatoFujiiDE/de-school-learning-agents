// 純関数: 子ども向け本文の機械検査（契約 V-5）。I/O を持たない。取り込み（src/jobs.ts）が checks_json.child_text に入れる（20 件で切る。取り込みは止めない）。
// 見る文: (1) parts の variants の .md の本文（path はその path）。(2) summary_elementary / summary_secondary・各 part の title・entry_point.text・各動画の why（path は material.json）。
// file_name: この版のファイル名（variants / files の path の最後の / より後ろ）か最上位のファイル名が文に出ている。
// raw_markup（.md だけ）: 教材の記法 v1（見出し #〜#### / 段落 / - / 1. / **…** / コード / リンク）で整形されない記号が行に残っている。
// edition_text（.md だけ。§MC-1 3）: 版が決まっている題材で Java 版を宣言した版の変奏の本文に、「Java 版」と宣言した版番号の両方が無い（path ごとに 1 件・sample は空）。
// material・本文は職人が書いた信頼できない値なので、形が違う所は黙って飛ばす（例外を投げない）。

import { declaredEdition, isVersionBoundMaterial } from './edition';

export type ChildTextKind = 'file_name' | 'raw_markup' | 'edition_text';
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
  return names;
}

/** 本文の「Java 版」（§MC-1 3。続け書きの「Java版」も通す） */
const JAVA_EDITION_TEXT_RE = /Java\s*版/;

/** 本文に版番号 version がそのまま書かれているか（前後に数字・「.数字」が続く別の版番号は数えない: 26.31 は 26.3 ではない） */
function hasVersionText(text: string, version: string): boolean {
  const esc = version.replace(/\./g, '\\.');
  return new RegExp(`(?<![\\d.])${esc}(?![\\d]|\\.\\d)`).test(text);
}

export function checkChildText(material: unknown, texts: ReadonlyMap<string, string>): ChildTextHit[] {
  const out: ChildTextHit[] = [];
  const names = versionFileNames(material);
  // §MC-1 3: 版が決まっている題材で Java 版を宣言した時だけ本文の版の 1 文を見る（宣言が無い・統合版・版が決まっていない題材は見ない）
  const declared = isVersionBoundMaterial(material) ? declaredEdition(material) : null;
  const javaVersion = declared?.edition === 'java' ? declared.version : null;
  const full = () => out.length >= CHILD_TEXT_MAX;
  const seenName = new Set<string>();

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

  const parts = isObj(material) && Array.isArray(material.parts) ? material.parts : [];
  // (1) 変奏の .md（part の順 → variants の順）
  const seenPath = new Set<string>();
  for (const p of parts) {
    if (!isObj(p) || !Array.isArray(p.variants)) continue;
    for (const v of p.variants) {
      const path = isObj(v) ? v.path : null;
      if (!isStr(path) || !path.toLowerCase().endsWith('.md') || seenPath.has(path)) continue;
      seenPath.add(path);
      const body = texts.get(path);
      if (!isStr(body)) continue;
      const stripped = stripMarkdownForCheck(body);
      if (javaVersion !== null) {
        if (full()) return out;
        const one = oneSpace(stripped);
        if (!JAVA_EDITION_TEXT_RE.test(one) || !hasVersionText(one, javaVersion)) out.push({ path, kind: 'edition_text', sample: '' });
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
  }
  // (2) material.json の子ども向けの文
  const m = isObj(material) ? material : {};
  const meta: string[] = [];
  if (isStr(m.summary_elementary)) meta.push(m.summary_elementary);
  if (isStr(m.summary_secondary)) meta.push(m.summary_secondary);
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
  return out.slice(0, CHILD_TEXT_MAX);
}
