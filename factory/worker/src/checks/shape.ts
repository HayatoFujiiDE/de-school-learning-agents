// 純関数: material.json の形（schema_version 1 / 2）の分岐をここに閉じる（契約 §AL-1）。I/O を持たない。
// material は職人の書いた信頼できない値なので、形が違う所は黙って飛ばし、例外を投げない（形の検査は validateOutputs）。
// - schema 1: 本文 = parts[].variants[] のうち path が .md のもの（label は読み手係の変奏の表示名と同じ文字列）
// - schema 2: 本文 = parts[].body（label「本文」）と、あれば parts[].play（label「遊びの形」）
// 同じ path は最初の 1 件だけ（読み手係・子ども向けの文の検査が従来から最初の 1 件だけを見ているのと同じ）。

export type SchemaVersion = 1 | 2;

export interface BodyRef {
  path: string;
  label: string;
  role: 'variant' | 'body' | 'play';
  partId: string | null;
  audience?: 'elementary' | 'secondary';
  length?: 'short' | 'long';
  game?: boolean;
}

export interface SummaryRef {
  key: 'summary_elementary' | 'summary_secondary' | 'summary';
  text: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const oneLine = (v: unknown): string => str(v).replace(/\s+/g, ' ').trim();

/** `schema_version === 2`（数値）の時だけ 2。それ以外（1・無い・object でない・文字列 "2" 等）は 1 */
export function schemaVersionOf(m: unknown): SchemaVersion {
  return isObj(m) && m.schema_version === 2 ? 2 : 1;
}

/** schema 1 の変奏の表示名（読み手係 reader.ts の variantLabel と同じ文字列。一字も変えない） */
export function variantLabel(v: Record<string, unknown>): string {
  if (v.game === true) return 'ゲーム版';
  const a = v.audience === 'elementary' ? '小学生' : v.audience === 'secondary' ? '中学生' : oneLine(v.audience);
  const l = v.length === 'short' ? '短い' : v.length === 'long' ? '長い' : oneLine(v.length);
  return `${a}・${l}`;
}

export const BODY_LABEL = '本文';
export const PLAY_LABEL = '遊びの形';

/** 本文の .md を出現順に（part の順 → schema 1 は variants の順 / schema 2 は body → play）。同じ path は最初の 1 件だけ */
export function bodiesOf(m: unknown): BodyRef[] {
  if (!isObj(m) || !Array.isArray(m.parts)) return [];
  const version = schemaVersionOf(m);
  const out: BodyRef[] = [];
  const seen = new Set<string>();
  const push = (b: BodyRef) => {
    if (seen.has(b.path)) return;
    seen.add(b.path);
    out.push(b);
  };
  for (const part of m.parts) {
    if (!isObj(part)) continue;
    const partId = typeof part.id === 'string' ? part.id : null;
    if (version === 1) {
      if (!Array.isArray(part.variants)) continue;
      for (const v of part.variants) {
        if (!isObj(v) || typeof v.path !== 'string' || !v.path.toLowerCase().endsWith('.md')) continue;
        push({
          path: v.path,
          label: variantLabel(v),
          role: 'variant',
          partId,
          ...(v.audience === 'elementary' || v.audience === 'secondary' ? { audience: v.audience } : {}),
          ...(v.length === 'short' || v.length === 'long' ? { length: v.length } : {}),
          game: v.game === true,
        });
      }
      continue;
    }
    if (typeof part.body === 'string') push({ path: part.body, label: BODY_LABEL, role: 'body', partId });
    if (typeof part.play === 'string') push({ path: part.play, label: PLAY_LABEL, role: 'play', partId });
  }
  return out;
}

/** 子どもに見える要約（schema 1 は summary_elementary → summary_secondary、schema 2 は summary）。文字列の時だけ */
export function summariesOf(m: unknown): SummaryRef[] {
  if (!isObj(m)) return [];
  const keys: SummaryRef['key'][] = schemaVersionOf(m) === 2 ? ['summary'] : ['summary_elementary', 'summary_secondary'];
  const out: SummaryRef[] = [];
  for (const key of keys) {
    const t = m[key];
    if (typeof t === 'string') out.push({ key, text: t });
  }
  return out;
}

export interface BuddyTextRef {
  path: string;
  partId: string | null;
  kind: 'question' | 'entry';
  id: string | null;
  text: string;
}

/**
 * schema 2 の、バディに渡り子どもに届きうる文（§AL-1〜AL-3・AL-6: 問いの種と関心別の入口。spark は子どもに見せないので入れない）。
 * parts の出現順に questions_for_kids[j]（id = q.id）→ interest_entries[j]（id = interest、null 可）。text が文字列のものだけ。schema 1 は []
 */
export function buddyTextsOf(m: unknown): BuddyTextRef[] {
  if (!isObj(m) || !Array.isArray(m.parts) || schemaVersionOf(m) !== 2) return [];
  const out: BuddyTextRef[] = [];
  m.parts.forEach((part, i) => {
    if (!isObj(part)) return;
    const partId = typeof part.id === 'string' ? part.id : null;
    if (Array.isArray(part.questions_for_kids)) {
      part.questions_for_kids.forEach((q, j) => {
        if (!isObj(q) || typeof q.text !== 'string') return;
        out.push({
          path: `material.json#parts[${i}].questions_for_kids[${j}].text`,
          partId,
          kind: 'question',
          id: typeof q.id === 'string' ? q.id : null,
          text: q.text,
        });
      });
    }
    if (Array.isArray(part.interest_entries)) {
      part.interest_entries.forEach((e, j) => {
        if (!isObj(e) || typeof e.text !== 'string') return;
        out.push({
          path: `material.json#parts[${i}].interest_entries[${j}].text`,
          partId,
          kind: 'entry',
          id: typeof e.interest === 'string' ? e.interest : null,
          text: e.text,
        });
      });
    }
  });
  return out;
}

/**
 * schema 2 の子ども向けの material.json の文（契約 §AL-3 の goal_word と同じ列挙。禁止語の検査に通す）:
 * 各 part の title・entry_point.text・videos[j].why（parts の出現順）の後に buddyTextsOf（問いの種・関心別の入口）。
 * summary は別に渡す（summariesOf）。spark は子どもに見せないので入れない。text が文字列のものだけ。schema 1 は []。例外を投げない
 */
export function childMetaTextsOf(m: unknown): Array<{ path: string; text: string }> {
  if (!isObj(m) || !Array.isArray(m.parts) || schemaVersionOf(m) !== 2) return [];
  const out: Array<{ path: string; text: string }> = [];
  m.parts.forEach((part, i) => {
    if (!isObj(part)) return;
    if (typeof part.title === 'string') out.push({ path: `material.json#parts[${i}].title`, text: part.title });
    if (isObj(part.entry_point) && typeof part.entry_point.text === 'string') out.push({ path: `material.json#parts[${i}].entry_point.text`, text: part.entry_point.text });
    if (Array.isArray(part.videos))
      part.videos.forEach((v, j) => {
        if (isObj(v) && typeof v.why === 'string') out.push({ path: `material.json#parts[${i}].videos[${j}].why`, text: v.why });
      });
  });
  for (const b of buddyTextsOf(m)) out.push({ path: b.path, text: b.text });
  return out;
}

/** schema 2 の問いの種の参照（契約 §AL-1: claim_ids の実在の検査用）。id が文字列で claim_ids が配列の問いだけ（claim_ids は文字列だけ残す）。schema 1 は []。例外を投げない */
export function questionsOf(m: unknown): Array<{ partId: string | null; id: string; claim_ids: string[] }> {
  if (!isObj(m) || !Array.isArray(m.parts) || schemaVersionOf(m) !== 2) return [];
  const out: Array<{ partId: string | null; id: string; claim_ids: string[] }> = [];
  for (const part of m.parts) {
    if (!isObj(part) || !Array.isArray(part.questions_for_kids)) continue;
    const partId = typeof part.id === 'string' ? part.id : null;
    for (const q of part.questions_for_kids) {
      if (!isObj(q) || typeof q.id !== 'string' || !Array.isArray(q.claim_ids)) continue;
      out.push({ partId, id: q.id, claim_ids: q.claim_ids.filter((c): c is string => typeof c === 'string') });
    }
  }
  return out;
}
