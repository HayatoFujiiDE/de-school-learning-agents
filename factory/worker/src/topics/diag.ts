// お題の run の観測（契約 contract-T v2.8）。run を閉じる時に topic_runs.diag_json へ書く JSON を組み立てる。
// 入れるのは数と列挙値だけ（本文・URL・検索語・ホスト名は入れない）。文字列は既知の列挙値か ^[a-z_]{1,40}$ だけ、ほかは 'other'。
// 組み立ては投げない（失敗したら null = 列は NULL）。run の閉じ方（台帳・CAS・状態）は diag で変わらない。

import { EMPTY_REASONS } from './prompts';

export const DIAG_VERSION = 1;
/** diag_json の全体の上限（字） */
export const DIAG_MAX_CHARS = 4000;
/** calls の上限（最初の呼び出しを入れて最大 4 回 = TOPIC_GEN_MAX_CONTINUES + 1 と同じ） */
export const DIAG_MAX_CALLS = 4;
/** 数の map（fetch_errors・dropped_reasons）の鍵の上限。超えた分は 'other' に足す */
export const DIAG_MAX_KEYS = 20;

const CODE_RE = /^[a-z_]{1,40}$/;

/** 既知の列挙値か ^[a-z_]{1,40}$ ならそのまま、ほかは 'other' */
export function diagCode(v: unknown, known?: readonly string[]): string {
  if (typeof v !== 'string') return 'other';
  if (known) return known.includes(v) ? v : 'other';
  return CODE_RE.test(v) ? v : 'other';
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(Math.round(v), 1e12) : 0);

function countMap(m: unknown): Record<string, number> {
  // 鍵は外から来うる（fetch のエラーコード）ので prototype の無い object に数える（constructor などの名前でも数がずれない）
  const out = Object.create(null) as Record<string, number>;
  if (!m || typeof m !== 'object') return out;
  for (const [k, v] of Object.entries(m as Record<string, unknown>)) {
    let key = diagCode(k);
    if (!Object.hasOwn(out, key) && Object.keys(out).length >= DIAG_MAX_KEYS) key = 'other';
    out[key] = (Object.hasOwn(out, key) ? out[key] : 0) + num(v);
  }
  return out;
}

/** 1 回の呼び出しの数（gen.ts の topicCallStats の値 + turn・ms） */
export interface DiagCall {
  turn: number;
  stop_reason: unknown;
  in: unknown;
  out: unknown;
  cache_w: unknown;
  cache_r: unknown;
  searches: unknown;
  fetches: unknown;
  fetch_errors: unknown;
  pending_server_tool: unknown;
  ms: unknown;
}

export interface RunDiagInput {
  /** 応答のあった呼び出しの回数 */
  turns: number;
  nudged: boolean;
  calls: readonly DiagCall[];
  /** save_topics が無いまま止めた理由 / max_tokens（gen.ts の stopWhy）。無ければ null */
  stop: string | null;
  /** save_topics の tool_use が応答にあったか */
  saveCalled: boolean;
  /** save_topics の topics の本数 */
  offered: number;
  /** 捨てた本の理由コードの数 */
  droppedReasons: Record<string, number>;
  /** topics が空の時の save_topics の empty_reason（空でない時・呼んでいない時・書いていない時は undefined / null → null） */
  emptyReason?: unknown;
}

/** diag_json の文字列（4000 字まで）。組み立てに失敗したら null */
export function buildRunDiag(d: RunDiagInput): string | null {
  try {
    const calls = d.calls.slice(0, DIAG_MAX_CALLS).map((c) => ({
      turn: num(c.turn),
      stop_reason: diagCode(c.stop_reason),
      in: num(c.in),
      out: num(c.out),
      cache_w: num(c.cache_w),
      cache_r: num(c.cache_r),
      searches: num(c.searches),
      fetches: num(c.fetches),
      fetch_errors: countMap(c.fetch_errors),
      pending_server_tool: c.pending_server_tool === true,
      ms: num(c.ms),
    }));
    const o = {
      v: DIAG_VERSION,
      turns: num(d.turns),
      nudged: d.nudged === true,
      calls,
      stop: d.stop === null ? null : diagCode(d.stop),
      save_called: d.saveCalled === true,
      offered: num(d.offered),
      dropped_reasons: countMap(d.droppedReasons),
      empty_reason: d.emptyReason === undefined || d.emptyReason === null ? null : diagCode(d.emptyReason, EMPTY_REASONS),
    };
    let s = JSON.stringify(o);
    if (s.length > DIAG_MAX_CHARS) {
      // 数の map を畳む（鍵の数で長くなる所だけ）。それでも超えたら calls も外す
      s = JSON.stringify({ ...o, calls: calls.map((c) => ({ ...c, fetch_errors: {} })), dropped_reasons: {}, trimmed: true });
      if (s.length > DIAG_MAX_CHARS) s = JSON.stringify({ v: DIAG_VERSION, turns: o.turns, nudged: o.nudged, stop: o.stop, save_called: o.save_called, offered: o.offered, empty_reason: o.empty_reason, trimmed: true });
    }
    return s.length <= DIAG_MAX_CHARS ? s : null;
  } catch {
    return null;
  }
}
