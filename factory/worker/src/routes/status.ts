// /api/status（契約 §B-3, §B-5-0）
import { first, getSetting, nowIso, prepare, stmt } from '../db';
import { cfg } from '../env';
import { isNonEmptyString, json, readBody, type RouteCtx } from '../http';
import { todayCostCents } from '../jobs';
import { monthCostCents } from '../ledger';
import { scoutRunning } from '../scout';
import { imageStatusSummary } from './images';

export async function getStatus(c: RouteCtx): Promise<Response> {
  const db = c.env.DB;
  const counts = await first<{ running: number; queued: number }>(
    db,
    stmt(
      "SELECT SUM(CASE WHEN status IN ('creating','running') THEN 1 ELSE 0 END) AS running, SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued FROM factory_jobs",
    ),
  );
  const k = cfg(c.env);
  const lastScout = await first<{ started_at: string; status: string; last_error: string | null }>(
    db,
    stmt('SELECT started_at, status, last_error FROM scout_runs ORDER BY started_at DESC LIMIT 1'),
  );
  const lastMeeting = await first<{ created_at: string; status: string; last_error: string | null }>(
    db,
    stmt('SELECT created_at, status, last_error FROM meeting_minutes ORDER BY created_at DESC LIMIT 1'),
  );
  const pending = await first(db, stmt("SELECT 1 AS x FROM meeting_minutes WHERE status = 'submitted' LIMIT 1"));
  return json(200, {
    paused: (await getSetting(db, 'paused')) === '1',
    paused_note: await getSetting(db, 'paused_note'),
    running_jobs: Number(counts?.running ?? 0),
    queued_jobs: Number(counts?.queued ?? 0),
    today_cents: await todayCostCents(db),
    daily_cap_cents: k.dailyCapCents,
    max_concurrent: k.maxConcurrent,
    agent_configured: !!(c.env.FACTORY_AGENT_ID && c.env.FACTORY_ENV_ID),
    last_cron_at: await getSetting(db, 'last_cron_at'),
    // 入口（§K-3）
    scout: {
      last_run_at: lastScout?.started_at ?? null,
      last_status: lastScout?.status ?? null,
      last_error: lastScout?.last_error ?? null,
      month_cents: await monthCostCents(db, 'scout'),
      month_cap_cents: k.scoutMonthlyCapCents,
      running: await scoutRunning(db),
      x_search_configured: !!c.env.XAI_API_KEY,
    },
    meeting: {
      last_at: lastMeeting?.created_at ?? null,
      last_status: lastMeeting?.status ?? null,
      last_error: lastMeeting?.last_error ?? null,
      month_cents: await monthCostCents(db, 'meeting'),
      month_cap_cents: k.meetingMonthlyCapCents,
      pending_batch: !!pending,
    },
    // 画像生成（§O-5 e）。金額は U で数えた記帳（読み取り専用の表示）
    images: await imageStatusSummary(c.env),
  });
}

export async function setPause(c: RouteCtx): Promise<Response> {
  const b = await readBody(c.request);
  if (!b || typeof b.paused !== 'boolean') return json(400, { error: 'paused_required' });
  if (!isNonEmptyString(b.note, 2000)) return json(400, { error: 'note_required' });
  const now = nowIso();
  const upsert = 'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at';
  await c.env.DB.batch([
    prepare(c.env.DB, stmt(upsert, 'paused', b.paused ? '1' : '0', now)),
    prepare(c.env.DB, stmt(upsert, 'paused_note', b.note, now)),
  ]);
  console.log(JSON.stringify({ at: 'pause', paused: b.paused }));
  return json(200, { paused: b.paused });
}
