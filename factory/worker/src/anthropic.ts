// Anthropic client の生成と薄い wrapper（本物）。契約 §D-4, §I。
// Worker の他の部分はこの FactoryPort だけを使う。fake（src/fake/anthropic.ts）は下の fakeAllowed() が true の時だけ読み込む。
// ログ・例外には本文・トークンを載せない（PortError は種別と HTTP status だけ持つ）。

import Anthropic from '@anthropic-ai/sdk';
import type { Message, MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/messages/messages';
import type { SessionCreateParams } from '@anthropic-ai/sdk/resources/beta/sessions/sessions';
import type { BetaManagedAgentsEventParams } from '@anthropic-ai/sdk/resources/beta/sessions/events';
import { isLocalHostname, type Env } from './env';

export const MANAGED_AGENTS_BETA = 'managed-agents-2026-04-01';

export interface SessionView {
  id: string;
  status: string;
  /** usage.list_cost.amount（セント）。無ければ null */
  listCostCents: number | null;
  metadata: Record<string, string>;
  created_at: string;
}

export interface FileMeta {
  id: string;
  filename: string;
  size_bytes: number;
  created_at: string;
}

export interface FactoryPort {
  readonly isFake: boolean;
  createSession(params: SessionCreateParams): Promise<{ id: string }>;
  retrieveSession(sessionId: string): Promise<SessionView>;
  listSessionsPage(page: string | null): Promise<{ data: SessionView[]; next: string | null }>;
  /** events を最大 max 件。order='desc' は新しい順 */
  listEvents(sessionId: string, opts: { order: 'asc' | 'desc'; max: number }): Promise<unknown[]>;
  sendEvents(sessionId: string, events: BetaManagedAgentsEventParams[]): Promise<void>;
  archiveSession(sessionId: string): Promise<void>;
  /** files.list を最後のページまで（最大 max 件） */
  listFiles(sessionId: string, max: number): Promise<FileMeta[]>;
  downloadFile(fileId: string): Promise<Uint8Array>;
  createMessage(params: MessageCreateParamsNonStreaming): Promise<Message>;
}

/** 外部呼び出しの失敗。responded=true は API が応答した（status あり）。false は応答不明（接続断・タイムアウト等） */
export class PortError extends Error {
  constructor(
    public readonly responded: boolean,
    public readonly status: number | undefined,
    public readonly kind: string,
  ) {
    super(`anthropic_${kind}${status ? `_${status}` : ''}`);
    this.name = 'PortError';
  }
}

function toPortError(e: unknown): PortError {
  if (e instanceof PortError) return e;
  if (e instanceof Anthropic.APIError && typeof e.status === 'number') return new PortError(true, e.status, 'api_error');
  if (e instanceof Anthropic.APIConnectionTimeoutError) return new PortError(false, undefined, 'timeout');
  if (e instanceof Anthropic.APIConnectionError) return new PortError(false, undefined, 'connection');
  return new PortError(false, undefined, 'unknown');
}

async function call<T>(f: () => Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (e) {
    throw toPortError(e);
  }
}

function parseCents(amount: unknown): number | null {
  if (typeof amount !== 'string' || !/^\d+$/.test(amount)) return null;
  return Number.parseInt(amount, 10);
}

function toView(s: { id: string; status: string; usage?: { list_cost?: { amount: string } | null }; metadata?: Record<string, string>; created_at: string }): SessionView {
  return {
    id: s.id,
    status: s.status,
    listCostCents: parseCents(s.usage?.list_cost?.amount),
    metadata: s.metadata ?? {},
    created_at: s.created_at,
  };
}

/** §D-4: client はリクエストごとに生成する */
export function makeClient(env: Env, opts: { timeoutMs?: number } = {}): Anthropic {
  return new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY ?? null,
    webhookKey: env.ANTHROPIC_WEBHOOK_SIGNING_KEY ?? null,
    maxRetries: 1,
    timeout: opts.timeoutMs ?? 60_000,
  });
}

function realPort(env: Env): FactoryPort {
  const client = makeClient(env);
  const longClient = makeClient(env, { timeoutMs: 300_000 });
  return {
    isFake: false,
    createSession: (params) => call(async () => ({ id: (await client.beta.sessions.create(params)).id })),
    retrieveSession: (id) => call(async () => toView(await client.beta.sessions.retrieve(id))),
    listSessionsPage: (page) =>
      call(async () => {
        const p = await client.beta.sessions.list({ order: 'desc', ...(page ? { page } : {}) });
        return { data: p.data.map(toView), next: p.next_page ?? null };
      }),
    listEvents: (id, { order, max }) =>
      call(async () => {
        const out: unknown[] = [];
        for await (const ev of client.beta.sessions.events.list(id, { order })) {
          out.push(ev);
          if (out.length >= max) break;
        }
        return out;
      }),
    sendEvents: (id, events) =>
      call(async () => {
        await client.beta.sessions.events.send(id, { events });
      }),
    archiveSession: (id) =>
      call(async () => {
        await client.beta.sessions.archive(id);
      }),
    listFiles: (sessionId, max) =>
      call(async () => {
        const out: FileMeta[] = [];
        for await (const f of client.beta.files.list({ scope_id: sessionId, betas: [MANAGED_AGENTS_BETA] })) {
          out.push({ id: f.id, filename: f.filename, size_bytes: f.size_bytes, created_at: f.created_at });
          if (out.length >= max) break;
        }
        return out;
      }),
    downloadFile: (fileId) =>
      call(async () => {
        const res = await client.beta.files.download(fileId);
        return new Uint8Array(await res.arrayBuffer());
      }),
    createMessage: (params) => call(() => longClient.messages.create(params)),
  };
}

export interface PortContext {
  /** fetch 由来ならリクエスト URL の hostname。scheduled なら null */
  hostname: string | null;
  /** scheduled の時だけ参照する settings.fake_enabled の値 */
  fakeEnabledSetting?: string | null;
}

/** §B-0: ANTHROPIC_FAKE='1' かつ（hostname が localhost/127.0.0.1、または scheduled で settings.fake_enabled='1'） */
export function fakeAllowed(env: Env, ctx: PortContext): boolean {
  if (env.ANTHROPIC_FAKE !== '1') return false;
  if (ctx.hostname !== null) return isLocalHostname(ctx.hostname);
  return ctx.fakeEnabledSetting === '1';
}

async function loadFake(env: Env, ctx: PortContext) {
  if (!fakeAllowed(env, ctx)) return null; // FAKE_GUARD
  return import('./fake/anthropic');
}

export async function getPort(env: Env, ctx: PortContext): Promise<FactoryPort> {
  const fake = await loadFake(env, ctx);
  return fake ? fake.createFakePort(env) : realPort(env);
}

/** /__fake/* の制御（scenario 切替・呼び出し記録の読み出し）。fake が許可されない時は null（呼び出し側が 404） */
export async function handleFakeControl(request: Request, env: Env): Promise<Response | null> {
  const fake = await loadFake(env, { hostname: new URL(request.url).hostname });
  return fake ? fake.handleFakeControl(request, env) : null;
}

/** §B-1: 署名検証は常に本物の SDK（ローカル検証のみでネットワークを使わない） */
export function unwrapWebhook(env: Env, rawBody: string, headers: Headers): { id: string; data: { id?: string; type?: string } } {
  const client = makeClient(env);
  const h: Record<string, string> = {};
  headers.forEach((v, k) => {
    h[k] = v;
  });
  const ev = client.beta.webhooks.unwrap(rawBody, { headers: h, key: env.ANTHROPIC_WEBHOOK_SIGNING_KEY });
  return ev as unknown as { id: string; data: { id?: string; type?: string } };
}
