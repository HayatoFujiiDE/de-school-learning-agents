// 一時的なプローブ（画像生成 段階 2 の前提確認 p2〜p4。plan-v4 §本番 probe）。確認が終わったら route ごと外す。
// p2: custom tool を持つ agent を API で作れるか / p3: custom_tool_use の数分後に custom_tool_result を送って受け付けられるか /
// p4: 同じ custom_tool_use_id への 2 回目の result、archive 後の result への応答。
// Access の内側だけ（index.ts の ROUTES）。返すのは id・種別・状態コード・エラー種別だけ（本文・鍵は返さない）。
import { APIError } from '@anthropic-ai/sdk';
import { makeClient } from '../anthropic';
import { json, type RouteCtx } from '../http';

const TOOL = {
  type: 'custom' as const,
  name: 'generate_image',
  description: 'Generate one image from a prompt. Returns the image when ready.',
  input_schema: { type: 'object' as const, properties: { prompt: { type: 'string' } }, required: ['prompt'] },
};

function errView(e: unknown) {
  if (e instanceof APIError) {
    const body = (e.error ?? {}) as { error?: { type?: unknown; message?: unknown } };
    return { ok: false, status: e.status ?? null, type: String(body.error?.type ?? ''), message: String(body.error?.message ?? e.message ?? '').slice(0, 300) };
  }
  return { ok: false, status: null, type: e instanceof Error ? e.name : 'error', message: e instanceof Error ? e.message.slice(0, 300) : '' };
}

export async function probeImageTool(c: RouteCtx): Promise<Response> {
  const body = (await c.request.json().catch(() => ({}))) as Record<string, unknown>;
  const step = String(body.step ?? '');
  const client = makeClient(c.env, { timeoutMs: 60_000 });
  const sid = typeof body.session_id === 'string' ? body.session_id : '';
  try {
    if (step === 'create') {
      const agent = await client.beta.agents.create({
        name: 'probe-generate-image',
        model: 'claude-haiku-5-5',
        system: 'You are a probe. Call the generate_image tool exactly once with prompt "a red cube". After you receive its result, reply with the single word OK and stop.',
        tools: [TOOL],
        metadata: { probe: 'image-tool' },
      });
      const s = await client.beta.sessions.create({
        agent: agent.id,
        environment_id: c.env.FACTORY_ENV_ID,
        title: 'probe image tool',
        metadata: { probe: 'image-tool' },
        budget: { type: 'limit', max_list_cost: { amount: '50', currency: 'USD' } },
        initial_events: [{ type: 'user.message', content: [{ type: 'text', text: 'Start.' }] }],
      } as never);
      return json(200, { ok: true, agent_id: agent.id, agent_tools: (agent.tools ?? []).map((t) => (t as { type?: string; name?: string }).name ?? (t as { type?: string }).type), session_id: s.id });
    }
    if (!sid) return json(400, { error: 'session_id_required' });
    if (step === 'events') {
      const p = await client.beta.sessions.events.list(sid, { order: 'asc' } as never);
      const s = await client.beta.sessions.retrieve(sid);
      const events = (p.data as unknown as Array<Record<string, unknown>>).map((e) => ({
        type: e.type,
        id: e.id,
        at: e.processed_at ?? null,
        name: e.type === 'agent.custom_tool_use' ? e.name : undefined,
        stop: e.type === 'session.status_idle' ? (e.stop_reason as { type?: unknown; event_ids?: unknown } | undefined) : undefined,
        ref: e.type === 'user.custom_tool_result' ? e.custom_tool_use_id : undefined,
      }));
      return json(200, { ok: true, status: (s as { status?: unknown }).status, events });
    }
    if (step === 'result') {
      const id = String(body.tool_use_id ?? '');
      await client.beta.sessions.events.send(sid, {
        events: [{ type: 'user.custom_tool_result', custom_tool_use_id: id, content: [{ type: 'text', text: 'probe image result' }], is_error: false }],
      } as never);
      return json(200, { ok: true, sent: id });
    }
    if (step === 'archive') {
      const out: Record<string, unknown> = {};
      try { await client.beta.sessions.archive(sid); out.session = 'archived'; } catch (e) { out.session = errView(e); }
      const aid = typeof body.agent_id === 'string' ? body.agent_id : '';
      if (aid) { try { await client.beta.agents.archive(aid); out.agent = 'archived'; } catch (e) { out.agent = errView(e); } }
      return json(200, { ok: true, ...out });
    }
    return json(400, { error: 'unknown_step' });
  } catch (e) {
    return json(200, errView(e));
  }
}
