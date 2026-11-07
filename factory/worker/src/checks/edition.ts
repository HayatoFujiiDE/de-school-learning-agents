// 版が決まっている題材（今は Minecraft）の判定と宣言（契約 §MC-1。docs/plans/minecraft-facts/contract-MC.md）。純関数。I/O を持たない。
// material は職人が書いた信頼できない値なので unknown で受けて自分で形を見る（形が違えば「版が決まっていない」「宣言なし」）。例外を投げない。

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** 題材が Minecraft か（題名・slug・tools の文字列。§MC-1 1） */
export const MINECRAFT_RE = /minecraft|マイクラ|マインクラフト/i;
/**
 * 宣言（§MC-1 2・Astra R1）: 版番号は edition の語（Java 版・Java Edition・Java / 統合版・Bedrock・Bedrock Edition）の直後だけ
 * （空白・`)`・`）`・`:`・`：` と `v` を挟んでよい）。後ろに数字や「.」が続く数（126.3.1 の 26.3.1 など）は版番号にしない
 */
const JAVA_DECL_RE = /java(?!script)\s*(?:版|edition)?[\s)）:：]*v?(\d{1,2}\.\d{1,2}(?:\.\d{1,2})?)(?![\d.])/i;
const BEDROCK_DECL_RE = /(?:bedrock(?:\s*edition)?|統合版)[\s)）:：]*v?(\d{1,2}\.\d{1,2}(?:\.\d{1,2})?)(?![\d.])/i;

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
 * 素材が宣言する版（§MC-1 2・Astra R1）: conditions.tools[] の文字列のうち MINECRAFT_RE に合うものを順に見て、
 * まず JAVA_DECL_RE、次に BEDROCK_DECL_RE を試し、最初に当たったもの（両方当たる文字列は java。後ろの説明文を拾わない）。
 * JavaScript には当てない。どれも決まらない・tools が無い → null
 */
export function declaredEdition(material: unknown): DeclaredEdition | null {
  if (!isObj(material)) return null;
  for (const t of toolsOf(material)) {
    if (!MINECRAFT_RE.test(t)) continue;
    const j = JAVA_DECL_RE.exec(t);
    if (j) return { edition: 'java', version: j[1] };
    const b = BEDROCK_DECL_RE.exec(t);
    if (b) return { edition: 'bedrock', version: b[1] };
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
