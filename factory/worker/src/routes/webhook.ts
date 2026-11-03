// POST /webhook（契約 §B-1, §B-4-d）。Anthropic 署名のみ。署名 NG は 400、それ以外は常に 2xx（3xx を返さない）
import { getPort, unwrapWebhook } from '../anthropic';
import { first, nowIso, prepare, stmt } from '../db';
import type { Env } from '../env';
import { json } from '../http';
import { markWebhookProcessed, reconcileJob } from '../jobs';

const HANDLED = new Set(['session.status_idled', 'session.status_terminated', 'session.outcome_evaluation_ended', 'session.status_run_started']);
const WAIT_UNTIL_BUDGET_MS = 25_000; // waitUntil の合計 30 秒に収める

export async function handleWebhook(request: Request, env: Env, exec: ExecutionContext): Promise<Response> {
  const rawBody = await request.text();
  let ev: { id: string; data: { id?: string; type?: string } };
  try {
    ev = unwrapWebhook(env, rawBody, request.headers);
  } catch {
    return json(400, { error: 'bad_signature' });
  }
  try {
    const eventId = typeof ev?.id === 'string' ? ev.id : '';
    const type = typeof ev?.data?.type === 'string' ? ev.data.type : '';
    const resourceId = typeof ev?.data?.id === 'string' ? ev.data.id : '';
    if (!eventId) return new Response(null, { status: 204 });

    const ins = await prepare(
      env.DB,
      stmt(
        'INSERT OR IGNORE INTO webhook_events (event_id, data_type, resource_id, received_at, processed_at) VALUES (?, ?, ?, ?, NULL)',
        eventId,
        type.slice(0, 100),
        resourceId.slice(0, 200),
        nowIso(),
      ),
    ).run();
    if (Number(ins.meta?.changes ?? 0) === 0) return new Response(null, { status: 204 }); // 重複

    if (!HANDLED.has(type)) {
      await markWebhookProcessed(env.DB, eventId);
      return new Response(null, { status: 204 });
    }
    const job = await first<{ id: string }>(env.DB, stmt('SELECT id FROM factory_jobs WHERE session_id = ?', resourceId));
    if (!job) {
      await markWebhookProcessed(env.DB, eventId);
      return new Response(null, { status: 204 });
    }
    const hostname = new URL(request.url).hostname;
    exec.waitUntil(
      (async () => {
        const port = await getPort(env, { hostname });
        await reconcileJob(env, port, job.id, { deadline: Date.now() + WAIT_UNTIL_BUDGET_MS });
      })()
        .catch(() => undefined)
        .finally(() => markWebhookProcessed(env.DB, eventId).catch(() => undefined)),
    );
    console.log(JSON.stringify({ at: 'webhook', event_type: type, job_id: job.id }));
    return new Response(null, { status: 204 });
  } catch {
    // 署名 OK なら 2xx。取りこぼしは cron（processed_at IS NULL）が拾う
    return new Response(null, { status: 202 });
  }
}
