// 一時的なプローブ（画像生成 段階 2 の前提確認 p2〜p4。plan-v4 §本番 probe）。確認が終わったら route ごと外す。
// p2: custom tool を持つ agent を API で作れるか / p3: custom_tool_use の数分後に custom_tool_result を送って受け付けられるか /
// p4: 同じ custom_tool_use_id への 2 回目の result、archive 後の result への応答。
// Access の内側だけ（index.ts の ROUTES）。返すのは id・種別・状態コード・エラー種別だけ（本文・鍵は返さない）。
import { APIError } from '@anthropic-ai/sdk';
import { makeClient } from '../anthropic';
import { getSetting, setSetting } from '../db';
import { todayCostCents } from '../jobs';
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
  // 触ってよいのは、create で作って settings に記録した 1 組（session と agent）だけ。本番の職人（FACTORY_AGENT_ID）は決して触らない
  const saved = JSON.parse((await getSetting(c.env.DB, 'probe_image_tool')) ?? 'null') as { session_id: string; agent_id: string; done?: boolean } | null;
  try {
    if (step === 'create') {
      if ((await getSetting(c.env.DB, 'paused')) === '1') return json(409, { error: 'paused' });
      if (saved && !saved.done) return json(409, { error: 'probe_in_progress', session_id: saved.session_id });
      const dailyCap = Number(c.env.DAILY_CAP_CENTS ?? '0');
      if (!(dailyCap > 0) || (await todayCostCents(c.env.DB)) + 50 > dailyCap) return json(409, { error: 'daily_cap' });
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
      await setSetting(c.env.DB, 'probe_image_tool', JSON.stringify({ session_id: s.id, agent_id: agent.id }));
      return json(200, { ok: true, agent_id: agent.id, agent_tools: (agent.tools ?? []).map((t) => (t as { type?: string; name?: string }).name ?? (t as { type?: string }).type), session_id: s.id });
    }
    // p1: OpenAI の画像 1 枚の所要時間と usage（画像本文は返さない）。累計の見積りが $3 を超えたら止める
    if (step === 'image') {
      if ((await getSetting(c.env.DB, 'paused')) === '1') return json(409, { error: 'paused' });
      const MODELS = ['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'];
      const QUALITIES = ['low', 'medium', 'high', 'xhigh', 'max'];
      const SIZES = ['1024x1024', '1536x1024', '1024x1536'];
      const model = String(body.model ?? ''), quality = String(body.quality ?? ''), size = String(body.size ?? '');
      if (!MODELS.includes(model) || !QUALITIES.includes(quality) || !SIZES.includes(size)) return json(400, { error: 'bad_params' });
      const spent = Number((await getSetting(c.env.DB, 'probe_p1_spent_cents')) ?? '0');
      if (spent >= 300) return json(409, { error: 'probe_budget_used', spent_cents: spent });
      const key = (c.env as unknown as { OPENAI_API_KEY?: string }).OPENAI_API_KEY;
      if (!key) return json(409, { error: 'no_openai_key' });
      const t0 = Date.now();
      const r = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model, prompt: 'A clear educational diagram of a Minecraft-style redstone circuit: a lever, redstone dust, a repeater and a lamp on a grid, labeled in simple shapes, flat colors.', size, quality, n: 1, output_format: 'png' }),
        signal: AbortSignal.timeout(180_000),
      });
      const ms = Date.now() - t0;
      const j = (await r.json().catch(() => ({}))) as { data?: Array<{ b64_json?: string }>; usage?: Record<string, unknown>; error?: { type?: unknown; code?: unknown; message?: unknown } };
      const u = (j.usage ?? {}) as { input_tokens?: number; output_tokens?: number; input_tokens_details?: unknown; output_tokens_details?: unknown };
      // 見積り: text 入力 $5 / 画像出力 $30 per 1M tokens（context.md の公式料金）。切り上げ
      const cents = Math.ceil(((u.input_tokens ?? 0) * 5 + (u.output_tokens ?? 0) * 30) / 10_000);
      await setSetting(c.env.DB, 'probe_p1_spent_cents', String(spent + (r.ok ? Math.max(cents, 1) : 0)));
      const b64 = j.data?.[0]?.b64_json ?? '';
      return json(200, {
        ok: r.ok, http: r.status, ms, model, quality, size,
        usage: { input_tokens: u.input_tokens ?? null, output_tokens: u.output_tokens ?? null, input_details: u.input_tokens_details ?? null, output_details: u.output_tokens_details ?? null },
        est_cents: cents, spent_cents_after: spent + (r.ok ? Math.max(cents, 1) : 0), image_bytes: Math.floor((b64.length * 3) / 4),
        error: r.ok ? null : { type: String(j.error?.type ?? ''), code: String(j.error?.code ?? ''), message: String(j.error?.message ?? '').replace(/sk-[A-Za-z0-9_*.-]+/g, '<redacted>').slice(0, 300) },
      });
    }
    if (!saved || !sid || sid !== saved.session_id) return json(403, { error: 'not_the_probe_session' });
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
      const aid = saved.agent_id;
      if (aid && aid !== c.env.FACTORY_AGENT_ID) { try { await client.beta.agents.archive(aid); out.agent = 'archived'; } catch (e) { out.agent = errView(e); } }
      await setSetting(c.env.DB, 'probe_image_tool', JSON.stringify({ ...saved, done: true }));
      return json(200, { ok: true, ...out });
    }
    return json(400, { error: 'unknown_step' });
  } catch (e) {
    return json(200, errView(e));
  }
}
