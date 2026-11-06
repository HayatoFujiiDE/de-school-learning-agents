// 検査の判定（契約 contract-T T-5 の 4）。純関数。DB と時刻に触れない。
// 「緑」の中身（形・禁止語・出典・flags）はここだけが決め、結果を topic_checks.verdict に 1 回だけ書く。gate は verdict を読むだけ。

import { FORBIDDEN_WORDS } from '../checks/forbidden';
import { CHECK_FLAGS, HEAVY_REASONS } from './prompts';
import { requiredSourceIds, topicTexts, validateTopicBody, type TopicBody } from './schema';

export type Support = 'supported' | 'unsupported' | 'unclear';
export type Sensitivity = 'normal' | 'heavy';
export type SourceFetch = 'pending' | 'found' | 'not_found' | 'fetch_failed' | 'blocked';

export interface CheckOutput {
  sources: Array<{ source_id: string; support: Support }>;
  sensitivity: Sensitivity;
  heavy_reasons: string[];
  flags: string[];
  note: string;
}

export interface JudgeSourceRow {
  source_id: string;
  fetch_result: SourceFetch;
}

export type HoldReason = 'schema' | 'forbidden' | 'source_not_found' | 'source_unreachable' | 'source_unsupported' | 'flagged' | 'heavy';

export interface Judgement {
  verdict: 'green' | 'red';
  sourcesOk: boolean;
  approvable: boolean;
  /** held にする時に書く 1 つ。緑で重くない時は null（gate の自動 ready へ） */
  holdReason: HoldReason | null;
  sensitivity: Sensitivity;
  reasons: string[];
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * save_check の入力を検査する（T-5 の 3・4）。渡した抜き書きの出典の id と過不足なく対応しない（足りない・余分・重複）・形が違う時は null
 * （出力そのものを無効とし、検査の失敗として扱う。T-7 の「応答が使えない」）
 */
export function parseCheckOutput(input: unknown, passedIds: readonly string[]): CheckOutput | null {
  if (!isObj(input)) return null;
  const keys = Object.keys(input);
  const want = ['sources', 'sensitivity', 'heavy_reasons', 'flags', 'note'];
  if (keys.length !== want.length || !want.every((k) => Object.hasOwn(input, k))) return null;
  if (!Array.isArray(input.sources) || !Array.isArray(input.heavy_reasons) || !Array.isArray(input.flags) || typeof input.note !== 'string') return null;
  if (input.sensitivity !== 'normal' && input.sensitivity !== 'heavy') return null;
  const passed = new Set(passedIds);
  const seen = new Set<string>();
  const sources: CheckOutput['sources'] = [];
  for (const s of input.sources as unknown[]) {
    if (!isObj(s) || Object.keys(s).length !== 2 || typeof s.source_id !== 'string' || !['supported', 'unsupported', 'unclear'].includes(s.support as string)) return null;
    if (!passed.has(s.source_id) || seen.has(s.source_id)) return null; // 余分・重複
    seen.add(s.source_id);
    sources.push({ source_id: s.source_id, support: s.support as Support });
  }
  if (seen.size !== passed.size) return null; // 足りない
  const heavy = input.heavy_reasons as unknown[];
  const flags = input.flags as unknown[];
  if (heavy.some((x) => !(HEAVY_REASONS as readonly unknown[]).includes(x))) return null;
  if (flags.some((x) => !(CHECK_FLAGS as readonly unknown[]).includes(x))) return null;
  return {
    sources,
    sensitivity: input.sensitivity,
    heavy_reasons: [...new Set(heavy as string[])],
    flags: [...new Set(flags as string[])],
    note: (input.note as string).slice(0, 2000),
  };
}

/** 禁止語が子どもの読む文にあるか（既存 checks/forbidden.ts の語。正規化なしの部分一致 §F-2） */
export function hasForbidden(body: TopicBody): boolean {
  return topicTexts(body).some((t) => FORBIDDEN_WORDS.some((w) => t.includes(w)));
}

/**
 * 英語の小文字の混入（司令塔の裁定 2026-11-06・v2.5）: 子どもが読む文のどれかが「日本語の文字を含み、かつ ASCII の小文字が 3 文字以上続く所がある」。
 * 例: 「両方を use わける」は当たる。「JAXA の MMX」「AI」「H3 ロケット」「Ver.2.0」は当たらない（大文字・数字・2 文字以下の小文字は対象外）。
 * 「Scratch で作る」も当たるが、人が読めば出せるので held（気になる点）にして人へ回す。出典の引用・名前・URL と thumb_prompt は topicTexts に入らない
 */
const JA_CHAR = /[\u3040-\u30ff\u3400-\u9fff\uff66-\uff9f]/;
const LATIN_RUN = /[a-z]{3,}/;
export function hasLatinMix(body: TopicBody): boolean {
  return topicTexts(body).some((t) => JA_CHAR.test(t) && LATIN_RUN.test(t));
}

/**
 * 判定（T-5 の 4）。checkOutput が null なのは、形・禁止語で赤になり 3 の呼び出しをしなかった時だけ。
 * opts.slotDay は形の再検査（validateTopicBody）に渡す、お題の slot_day。
 */
export function judgeCheck(
  body: unknown,
  sourceRows: readonly JudgeSourceRow[],
  checkOutput: CheckOutput | null,
  storedSensitivity: Sensitivity,
  opts: { slotDay: string },
): Judgement {
  const reasons: string[] = [];
  const push = (r: string) => {
    if (!reasons.includes(r)) reasons.push(r);
  };
  const schema = validateTopicBody(body, { slotDay: opts.slotDay });
  for (const code of schema) push(`schema:${code}`);
  const b = body as TopicBody;
  if (isObj(body) && hasForbidden(b)) push('forbidden');
  if (isObj(body) && hasLatinMix(b)) push('latin_mix');

  const required = isObj(body) ? requiredSourceIds(b) : new Set<string>();
  const fetchById = new Map(sourceRows.map((s) => [s.source_id, s.fetch_result]));
  const supportById = new Map<string, Support[]>();
  for (const s of checkOutput?.sources ?? []) supportById.set(s.source_id, [...(supportById.get(s.source_id) ?? []), s.support]);

  let sourcesOk = true;
  for (const id of required) {
    const fr = fetchById.get(id) ?? 'pending';
    const sup = supportById.get(id) ?? [];
    const okOne = fr === 'found' && sup.length === 1 && sup[0] === 'supported';
    if (!okOne) sourcesOk = false;
    if (fr === 'not_found') push('source_not_found');
    else if (fr !== 'found') push('source_unreachable');
    else if (!okOne) push('source_unsupported');
  }
  // 必須でない出典でも、渡した抜き書きが支えていないと答えたものは赤（unsupported・unclear）
  for (const s of checkOutput?.sources ?? []) if (s.support !== 'supported') push('source_unsupported');
  for (const f of checkOutput?.flags ?? []) push(`flagged:${f}`);

  const sensitivity: Sensitivity = storedSensitivity === 'heavy' || checkOutput?.sensitivity === 'heavy' ? 'heavy' : 'normal';
  const verdict = reasons.length === 0 ? 'green' : 'red';
  // latin_mix は人が読めば出せる（flags と同じく承認できる）
  const approvable = reasons.every((r) => r.startsWith('flagged:') || r === 'latin_mix');
  let holdReason: HoldReason | null = null;
  if (reasons.some((r) => r.startsWith('schema:'))) holdReason = 'schema';
  else if (reasons.includes('forbidden')) holdReason = 'forbidden';
  else if (reasons.includes('source_not_found')) holdReason = 'source_not_found';
  else if (reasons.includes('source_unreachable')) holdReason = 'source_unreachable';
  else if (reasons.includes('source_unsupported')) holdReason = 'source_unsupported';
  else if (reasons.some((r) => r.startsWith('flagged:') || r === 'latin_mix')) holdReason = 'flagged'; // latin_mix は「気になる点」として人が読む
  else if (sensitivity === 'heavy') holdReason = 'heavy';
  // 必須の出典が 0 個なら sourcesOk は true のまま（T-5 の 4）
  return { verdict, sourcesOk, approvable, holdReason, sensitivity, reasons };
}
