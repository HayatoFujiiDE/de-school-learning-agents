// 見直す（refresh）・発展させる（extend）（契約 contract-T T-9）。どちらも「親を入力にして子を 1 本作る run」（purpose = 'derive'）。
// run を取る・呼ぶ・保存するのは gen.ts の runTopicRun と同じ（親の条件・子の数・週の上限は取り置きの INSERT の WHERE）。ここは自動の候補を選ぶだけ。

import type { FactoryPort } from '../anthropic';
import { all, stmt, tokyoDay } from '../db';
import { cfg, type Env } from '../env';
import { runTopicRun, type RunOptions, type RunOutcome } from './gen';
import { addDays } from './schema';
import { mondayOf, TOPIC_REFRESH_DAYS } from './store';

export interface DeriveCandidate {
  parentId: string;
  kind: 'refresh' | 'extend';
}

/**
 * 自動の派生の候補（T-9）。週の上限に達していれば空。
 * 見直し: hold_reason が source_lost・source_unreachable の held（先）/ evergreen = 1 の ready で created_at から TOPIC_REFRESH_DAYS 日を過ぎたもの。どちらも終わっていない見直しの子（draft・checking・held・ready）が無いもの（held の子も次を塞ぐ。v2.4）。
 * 発展: starred = 1 の ready、または news の ready で fresh_until が今日 + 2 日以内のもの。発展の子（状態を問わない）を 2 つ持つ親は外す。
 * どちらも、同じ親・同じ種類・同じ日の cron の派生がまだ無いもの（失敗しても、その日はもう試さない）
 */
export async function deriveCandidates(env: Env, now: Date = new Date()): Promise<DeriveCandidate[]> {
  const db = env.DB;
  const today = tokyoDay(now);
  const week = mondayOf(today);
  const used = await all<{ n: number }>(db, stmt("SELECT COUNT(*) AS n FROM topic_runs WHERE purpose = 'derive' AND trigger = 'cron' AND week = ?", week));
  if (Number(used[0]?.n ?? 0) >= cfg(env).topicDerivePerWeek) return [];
  const old = new Date(now.getTime() - TOPIC_REFRESH_DAYS * 86_400_000).toISOString();
  const refresh = await all<{ id: string }>(
    db,
    stmt(
      `SELECT p.id FROM topics p
       WHERE p.depth < 5
         AND ((p.status = 'held' AND p.hold_reason IN ('source_lost','source_unreachable')) OR (p.evergreen = 1 AND p.status = 'ready' AND p.created_at <= ?))
         AND NOT EXISTS (SELECT 1 FROM topics c WHERE c.parent_topic_id = p.id AND c.derive_kind = 'refresh' AND c.status IN ('draft','checking','held','ready'))
         AND NOT EXISTS (SELECT 1 FROM topic_runs r WHERE r.purpose = 'derive' AND r.trigger = 'cron' AND r.parent_topic_id = p.id AND r.kind = 'refresh' AND r.slot_day = ?)
       ORDER BY (p.status = 'held') DESC, p.created_at ASC, p.id ASC LIMIT 5`,
      old,
      today,
    ),
  );
  const extend = await all<{ id: string }>(
    db,
    stmt(
      `SELECT p.id FROM topics p
       WHERE p.status = 'ready' AND p.depth < 5
         AND (p.starred = 1 OR (p.kind = 'news' AND p.fresh_until <= ?))
         AND (SELECT COUNT(*) FROM topics c WHERE c.parent_topic_id = p.id AND c.derive_kind = 'extend') < 2
         AND NOT EXISTS (SELECT 1 FROM topic_runs r WHERE r.purpose = 'derive' AND r.trigger = 'cron' AND r.parent_topic_id = p.id AND r.kind = 'extend' AND r.slot_day = ?)
       ORDER BY p.created_at ASC, p.id ASC LIMIT 5`,
      addDays(today, 2),
      today,
    ),
  );
  return [...refresh.map((r) => ({ parentId: r.id, kind: 'refresh' as const })), ...extend.map((r) => ({ parentId: r.id, kind: 'extend' as const }))];
}

/** 派生の run（手動: POST /api/topics/:id/derive。cron: tick の段 (4)） */
export function runDerive(
  env: Env,
  port: FactoryPort,
  p: { parentId: string; kind: 'refresh' | 'extend'; trigger: 'cron' | 'manual'; note?: string | null },
  opts: RunOptions,
): Promise<RunOutcome> {
  return runTopicRun(env, port, { purpose: 'derive', kind: p.kind, trigger: p.trigger, parentId: p.parentId, note: p.note ?? null }, opts);
}
