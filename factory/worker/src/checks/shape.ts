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
