// cron の中のお題の段（契約 contract-T T-13）。入口の段の後に 1 回呼ぶ。
// 順番: (1) 予定の確定 (2) lease 切れの片付け（run と検査）(3) 検査を最大 3 本 (4) 生成か派生の run を 1 つ (5) ストックの見直し。
// 各段は始める前に残り時間を見て、足りなければその段を飛ばす（検査 1 本 90 秒 / run 200 秒 / 見直し 1 本 30 秒。(1)(2) は残り時間に関係なく行う）。
// 1 つの段が例外で落ちても、ほかの段の結果は残す。

import type { FactoryPort } from '../anthropic';
import { all, nowIso, stmt, tokyoDay } from '../db';
import { cfg, type Env } from '../env';
import { checkTopic, cleanupLeases, dueCheckIds, stockRecheckStep } from './check';
import { deriveCandidates, runDerive } from './derive';
import { runTopicRun, type RunOutcome } from './gen';
import type { TopicKind } from './locale';
import { planStep } from './schedule';
import { addDays } from './schema';
import { TOPIC_CHECK_PER_TICK, tokyoWeekdayOf, topicsEnabled } from './store';

export const TICK_NEED_MS = { check: 90_000, run: 200_000, recheck: 30_000 } as const;

const errName = (e: unknown): string => (e instanceof Error ? e.name : 'error');

/** cron の生成で、今日まだ取っていない種類（news は毎日、talk・philo・make は TOPIC_WEEKLY_DAY の日。どちらも翌日用） */
export async function dueGenKinds(env: Env, now: Date): Promise<TopicKind[]> {
  const tomorrow = addDays(tokyoDay(now), 1);
  const kinds: TopicKind[] = ['news'];
  if (tokyoWeekdayOf(now) === cfg(env).topicWeeklyDay) kinds.push('talk', 'philo', 'make');
  const done = new Set(
    (await all<{ kind: string }>(env.DB, stmt("SELECT kind FROM topic_runs WHERE purpose = 'gen' AND trigger = 'cron' AND slot_day = ?", tomorrow))).map((r) => r.kind),
  );
  return kinds.filter((k) => !done.has(k));
}

export interface TickOptions {
  deadline: number;
  fetchImpl: typeof fetch;
  now?: Date;
}

export async function topicsTick(env: Env, port: FactoryPort, o: TickOptions): Promise<Record<string, unknown>> {
  const now = o.now ?? new Date();
  const out: Record<string, unknown> = {};
  const left = () => o.deadline - Date.now();

  // (1) 予定の確定（入・切が入の時だけ。planDay が見る）
  try {
    out.plan = await planStep(env, now);
  } catch (e) {
    out.plan_error = errName(e);
  }
  // (2) lease 切れの片付け
  try {
    out.cleanup = await cleanupLeases(env, nowIso());
  } catch (e) {
    out.cleanup_error = errName(e);
  }
  try {
    if (!(await topicsEnabled(env.DB))) {
      out.skipped = 'disabled';
      return out;
    }
  } catch (e) {
    out.enabled_error = errName(e);
    return out;
  }
  // (3) 検査（最大 3 本）
  try {
    const checks: string[] = [];
    for (const id of await dueCheckIds(env, TOPIC_CHECK_PER_TICK, nowIso())) {
      if (left() < TICK_NEED_MS.check) {
        checks.push('skipped_time');
        break;
      }
      checks.push((await checkTopic(env, port, id, { deadline: o.deadline, fetchImpl: o.fetchImpl })).status);
    }
    out.checks = checks;
  } catch (e) {
    out.checks_error = errName(e);
  }
  // (4) 生成か派生の run を 1 つ
  try {
    if (left() < TICK_NEED_MS.run) out.run = 'skipped_time';
    else {
      let outcome: RunOutcome | null = null;
      const tomorrow = addDays(tokyoDay(now), 1);
      for (const kind of await dueGenKinds(env, now)) {
        outcome = await runTopicRun(env, port, { purpose: 'gen', kind, trigger: 'cron', slotDay: tomorrow }, { deadline: o.deadline, fetchImpl: o.fetchImpl, now });
        if (outcome.status !== 'not_taken' || outcome.reason === 'cap' || outcome.reason === 'disabled') break;
      }
      if (!outcome || (outcome.status === 'not_taken' && outcome.reason !== 'cap' && outcome.reason !== 'disabled')) {
        for (const cand of await deriveCandidates(env, now)) {
          outcome = await runDerive(env, port, { parentId: cand.parentId, kind: cand.kind, trigger: 'cron' }, { deadline: o.deadline, fetchImpl: o.fetchImpl, now });
          if (outcome.status !== 'not_taken' || outcome.reason === 'cap' || outcome.reason === 'disabled' || outcome.reason === 'week_cap') break;
        }
      }
      out.run = outcome ? (outcome.status === 'not_taken' ? `not_taken:${outcome.reason}` : outcome.run.status) : 'none';
    }
  } catch (e) {
    out.run_error = errName(e);
  }
  // (5) ストックの見直し
  try {
    if (left() < TICK_NEED_MS.recheck) out.recheck = 'skipped_time';
    else out.recheck = await stockRecheckStep(env, { deadline: o.deadline, fetchImpl: o.fetchImpl, now });
  } catch (e) {
    out.recheck_error = errName(e);
  }
  return out;
}
