// 版が決まっている題材（今は Minecraft）の判定と宣言（契約 §MC-1。docs/plans/minecraft-facts/contract-MC.md）。純関数。I/O を持たない。
// material は職人が書いた信頼できない値なので unknown で受けて自分で形を見る（形が違えば「版が決まっていない」「宣言なし」）。例外を投げない。

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** 題材が Minecraft か（題名・slug・tools の文字列。§MC-1 1） */
export const MINECRAFT_RE = /minecraft|マイクラ|マインクラフト/i;
/** 版番号（§MC-1 2） */
const VERSION_RE = /\b(\d{1,2}\.\d{1,2}(?:\.\d{1,2})?)\b/;
const JAVA_RE = /java(?!script)/i;
const BEDROCK_RE = /bedrock|統合版|\bbe\b/i;

/** 版が決まっている題材の動画の公開日の上限（§MC-0・§MC-1 4。3 年） */
export const VERSION_BOUND_VIDEO_MAX_AGE_DAYS = 1095;

export type Edition = 'java' | 'bedrock';
export interface DeclaredEdition {
  edition: Edition;
  version: string;
}

/** material.conditions.tools の文字列（配列でなければ空。文字列でない要素は飛ばす） */
function toolsOf(material: Record<string, unknown>): string[] {
  const c = material.conditions;
  const tools = isObj(c) ? c.tools : null;
  return Array.isArray(tools) ? tools.filter((t): t is string => typeof t === 'string') : [];
}

/**
 * 版が決まっている題材か（§MC-1 1）: catalog_item_id が `mc-` で始まる、または title・slug・conditions.tools[] のどれかが MINECRAFT_RE に合う。
 * material が読めない時は false
 */
export function isVersionBoundMaterial(material: unknown): boolean {
  if (!isObj(material)) return false;
  if (str(material.catalog_item_id).startsWith('mc-')) return true;
  if (MINECRAFT_RE.test(str(material.title)) || MINECRAFT_RE.test(str(material.slug))) return true;
  return toolsOf(material).some((t) => MINECRAFT_RE.test(t));
}

/**
 * 素材が宣言する版（§MC-1 2）: conditions.tools[] の文字列のうち、MINECRAFT_RE に合い版番号を含むものを順に見て、
 * /java(?!script)/i なら java、/bedrock|統合版|\bbe\b/i なら bedrock（最初に決まったもの。JavaScript・maybe の be には当てない）。どれも決まらない・tools が無い → null
 */
export function declaredEdition(material: unknown): DeclaredEdition | null {
  if (!isObj(material)) return null;
  for (const t of toolsOf(material)) {
    if (!MINECRAFT_RE.test(t)) continue;
    const m = VERSION_RE.exec(t);
    if (!m) continue;
    if (JAVA_RE.test(t)) return { edition: 'java', version: m[1] };
    if (BEDROCK_RE.test(t)) return { edition: 'bedrock', version: m[1] };
  }
  return null;
}

/** `YYYY-MM-DD`（実在の日付）→ その日の UTC 0 時の ms。形が違えば null */
export function parsePublishedDay(published: unknown): number | null {
  if (typeof published !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(published);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return t;
}

/**
 * 動画が古いか（§MC-1 4）: published が `YYYY-MM-DD` で、now の日（UTC）− published の日 > 1095 日 → true。
 * 形が違えば false（公開日が分からない動画は呼び出し側が別に扱う）
 */
export function isVideoTooOld(published: string, now: number | Date = Date.now()): boolean {
  const p = parsePublishedDay(published);
  if (p === null) return false;
  const n = new Date(typeof now === 'number' ? now : now.getTime());
  const today = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
  return (today - p) / 86_400_000 > VERSION_BOUND_VIDEO_MAX_AGE_DAYS;
}
