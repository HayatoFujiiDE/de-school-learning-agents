// 入口（収集部隊・会議）と振り返り係（§S-0）の費用の記録と上限判定（契約 §K-0）。
// 費用はすべて cost_ledger に追記する（日次上限 DAILY_CAP_CENTS の合計にも入る）。月は Asia/Tokyo の暦月（cost_ledger.day の先頭 7 文字）。

import { first, stmt, tokyoDay, type Stmt } from './db';
import { cfg, type Env } from './env';

export type IntakeKind = 'scout' | 'meeting' | 'topic' | 'retro';

/** Asia/Tokyo の YYYY-MM */
export const tokyoMonth = (d: Date = new Date()): string => tokyoDay(d).slice(0, 7);

export async function monthCostCents(db: D1Database, kind: IntakeKind, d: Date = new Date()): Promise<number> {
  const r = await first<{ c: number | null }>(db, stmt('SELECT SUM(cents) AS c FROM cost_ledger WHERE kind = ? AND substr(day, 1, 7) = ?', kind, tokyoMonth(d)));
  return Number(r?.c ?? 0);
}

export async function dayCostCents(db: D1Database, d: Date = new Date()): Promise<number> {
  const r = await first<{ c: number | null }>(db, stmt('SELECT SUM(cents) AS c FROM cost_ledger WHERE day = ?', tokyoDay(d)));
  return Number(r?.c ?? 0);
}

/** 起動してよいか（月次の上限と日次の上限。§R-24 のとおり「起動を止める目安」） */
export async function capCheck(env: Env, kind: IntakeKind, d: Date = new Date()): Promise<{ ok: true } | { ok: false; reason: 'monthly_cap' | 'daily_cap' }> {
  const c = cfg(env);
  const cap =
    kind === 'scout' ? c.scoutMonthlyCapCents : kind === 'topic' ? c.topicMonthlyCapCents : kind === 'retro' ? c.retroMonthlyCents : c.meetingMonthlyCapCents;
  if ((await monthCostCents(env.DB, kind, d)) >= cap) return { ok: false, reason: 'monthly_cap' };
  if ((await dayCostCents(env.DB, d)) >= c.dailyCapCents) return { ok: false, reason: 'daily_cap' };
  return { ok: true };
}

export const ledgerInsert = (kind: IntakeKind, refId: string, cents: number, now: string, d: Date = new Date()): Stmt =>
  stmt('INSERT INTO cost_ledger (id, day, kind, ref_id, cents, created_at) VALUES (?, ?, ?, ?, ?, ?)', crypto.randomUUID(), tokyoDay(d), kind, refId, cents, now);

/** micro-dollars（tokens × $/1M）→ セント（切り上げ） */
export const microToCents = (m: number): number => (m > 0 ? Math.ceil(m / 10_000) : 0);

interface UsageLike {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

// 定価（https://platform.claude.com/docs/en/about-claude/pricing 。2026-11-04 時点の claude-api skill の表と同じ値）
/** Haiku 5.5: 入力 $0.10 / 出力 $0.50 per 1M（プロンプト 100K tokens 超は $0.50 / $2.50） */
export function haikuMicroDollars(u: UsageLike | null | undefined): number {
  if (!u) return 0;
  const input = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
  const long = input > 100_000;
  return input * (long ? 0.5 : 0.1) + (u.output_tokens ?? 0) * (long ? 2.5 : 0.5);
}

/** Sonnet 5.5（Batch API は定価の 50%）: 入力 $2 / 出力 $10 per 1M の半分 */
export function sonnetBatchMicroDollars(u: UsageLike | null | undefined): number {
  if (!u) return 0;
  const input = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
  return (input * 2 + (u.output_tokens ?? 0) * 10) * 0.5;
}

/**
 * Sonnet 5.5（同期の定価。お題 contract-T T-6）: 入力 $2 / 5 分の cache write $2.50 / cache read $0.10 / 出力 $10 per 1M。
 * 値は https://platform.claude.com/docs/en/about-claude/pricing（2026-11-06 確認）。cache read は多めに数えて入力と同じ $2 にする
 */
export function sonnetMicroDollars(u: UsageLike | null | undefined): number {
  if (!u) return 0;
  return (u.input_tokens ?? 0) * 2 + (u.cache_creation_input_tokens ?? 0) * 2.5 + (u.cache_read_input_tokens ?? 0) * 2 + (u.output_tokens ?? 0) * 10;
}

/** web_search は 1 回 1 セント（$10 / 1,000 回。同じ pricing のページ） */
export const WEB_SEARCH_CENTS = 1;
