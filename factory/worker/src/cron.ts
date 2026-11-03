// 10 分ごとの照合・起動・検証（契約 §B-5）。scheduled handler は最長 15 分。

import { getPort } from './anthropic';
import { all, getSetting, isoPlus, nowIso, setSetting, stmt } from './db';
import type { Env } from './env';
import { getJob, markWebhookProcessed, reconcileJob, recoverCreating, startJob, type JobRow } from './jobs';
import { runVerificationStep } from './verify';

// cron 経由の reconcile は開始から 10 分を締め切りにする（scheduled handler は最長 15 分。検証の時間を残す）
const CRON_RECONCILE_BUDGET_MS = 10 * 60_000;

export async function runCron(env: Env): Promise<Record<string, unknown>> {
  const db = env.DB;
  const port = await getPort(env, { hostname: null, fakeEnabledSetting: await getSetting(db, 'fake_enabled') });
  const out: Record<string, unknown> = {};
  const reconcileDeadline = Date.now() + CRON_RECONCILE_BUDGET_MS;

  // 1. 起動: queued（1 分超）を古い順に 1 件。creating 10 分超は復旧
  try {
    const q = await all<{ id: string }>(
      db,
      stmt("SELECT id FROM factory_jobs WHERE status = 'queued' AND updated_at < ? ORDER BY created_at ASC LIMIT 1", isoPlus(-60_000)),
    );
    if (q[0]) out.start = (await startJob(env, port, q[0].id)).status;
    const stale = await all<JobRow>(db, stmt("SELECT * FROM factory_jobs WHERE status = 'creating' AND updated_at < ? LIMIT 5", isoPlus(-10 * 60_000)));
    out.recovered = [];
    for (const j of stale) (out.recovered as string[]).push(await recoverCreating(env, port, j));
  } catch (e) {
    out.start_error = e instanceof Error ? e.name : 'error';
  }

  // 2. 回収
  try {
    const due = await all<{ id: string }>(
      db,
      stmt(
        "SELECT id FROM factory_jobs WHERE status IN ('running','needs_answer','budget_reached') AND (last_checked_at IS NULL OR last_checked_at < ?) ORDER BY last_checked_at ASC LIMIT 5",
        isoPlus(-10 * 60_000),
      ),
    );
    const results: string[] = [];
    for (const j of due) if (Date.now() < reconcileDeadline - 5_000) results.push(await reconcileJob(env, port, j.id, { deadline: reconcileDeadline }));
    const pending = await all<{ event_id: string; resource_id: string }>(
      db,
      stmt('SELECT event_id, resource_id FROM webhook_events WHERE processed_at IS NULL AND received_at < ? ORDER BY received_at ASC LIMIT 10', isoPlus(-2 * 60_000)),
    );
    for (const w of pending) {
      const job = await all<{ id: string }>(db, stmt('SELECT id FROM factory_jobs WHERE session_id = ?', w.resource_id));
      if (job[0] && (await getJob(db, job[0].id))) results.push(await reconcileJob(env, port, job[0].id, { deadline: reconcileDeadline }));
      await markWebhookProcessed(db, w.event_id);
    }
    out.reconciled = results;
  } catch (e) {
    out.reconcile_error = e instanceof Error ? e.name : 'error';
  }

  // 3. 検証（1 件）
  try {
    out.verify = await runVerificationStep(env, port);
  } catch (e) {
    out.verify_error = e instanceof Error ? e.name : 'error';
  }

  // 4.
  await setSetting(db, 'last_cron_at', nowIso());
  console.log(JSON.stringify({ at: 'cron', ...out }));
  return out;
}
