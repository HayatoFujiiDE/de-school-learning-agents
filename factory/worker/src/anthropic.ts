// Anthropic client の生成と薄い wrapper（本物）。契約 §D-4, §I。
// Worker の他の部分はこの FactoryPort だけを使う。fake（src/fake/anthropic.ts）は下の fakeAllowed() が true の時だけ読み込む。
// ログ・例外には本文・トークンを載せない（PortError は種別と HTTP status だけ持つ）。

import Anthropic from '@anthropic-ai/sdk';
import type { Message, MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/messages/messages';
import type { SessionCreateParams } from '@anthropic-ai/sdk/resources/beta/sessions/sessions';
import type { BetaManagedAgentsEventParams } from '@anthropic-ai/sdk/resources/beta/sessions/events';
import type { BatchCreateParams, MessageBatchIndividualResponse } from '@anthropic-ai/sdk/resources/messages/batches';
import { isLocalHostname, type Env } from './env';
import { XaiError, xaiResponses, type XaiRequest, type XaiResult } from './xai';

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

/** 外部呼び出しのオプション。deadline があれば timeout = min(残り時間, 60 秒)、再試行 0（reconcile 用） */
export interface CallOpts {
  deadline?: number;
}

export interface Page<T> {
  data: T[];
  /** 次のページの cursor。null なら最後のページ */
  next: string | null;
}

/** messages.batches の必要な field だけ */
export interface BatchView {
  id: string;
  processing_status: 'in_progress' | 'canceling' | 'ended';
  created_at: string;
  expires_at: string;
}

/** batches.results から読む行数の上限（会議は 1 件しか送らない） */
export const BATCH_RESULTS_MAX = 10;

export interface FactoryPort {
  readonly isFake: boolean;
  createSession(params: SessionCreateParams, o?: CallOpts): Promise<{ id: string }>;
  retrieveSession(sessionId: string, o?: CallOpts): Promise<SessionView>;
  listSessionsPage(page: string | null, o?: CallOpts): Promise<Page<SessionView>>;
  /** events.list の 1 ページ。order='desc' は新しい順。page は前のページの next */
  listEventsPage(sessionId: string, q: { order: 'asc' | 'desc'; page: string | null }, o?: CallOpts): Promise<Page<unknown>>;
  sendEvents(sessionId: string, events: BetaManagedAgentsEventParams[], o?: CallOpts): Promise<void>;
  archiveSession(sessionId: string, o?: CallOpts): Promise<void>;
  /** files.list（scope_id = session）の 1 ページ */
  listFilesPage(sessionId: string, page: string | null, o?: CallOpts): Promise<Page<FileMeta>>;
  downloadFile(fileId: string, o?: CallOpts): Promise<Uint8Array>;
  createMessage(params: MessageCreateParamsNonStreaming, o?: CallOpts): Promise<Message>;
  /** 入口（§K-5）: Message Batches */
  createBatch(params: BatchCreateParams, o?: CallOpts): Promise<BatchView>;
  retrieveBatch(batchId: string, o?: CallOpts): Promise<BatchView>;
  batchResults(batchId: string, o?: CallOpts): Promise<MessageBatchIndividualResponse[]>;
  /** 入口（§K-4-3）: xAI Responses API（x_search）。XAI_API_KEY が無ければ XaiError('no_key')。失敗は XaiError */
  xaiResponses(req: XaiRequest, o?: CallOpts): Promise<XaiResult>;
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

const CALL_TIMEOUT_MAX_MS = 60_000;

/** deadline から SDK の RequestOptions を作る（reconcile では再試行しない） */
export function requestOptions(o?: CallOpts): { timeout?: number; maxRetries?: number } {
  if (!o?.deadline) return {};
  const remaining = o.deadline - Date.now();
  return { timeout: Math.max(1_000, Math.min(remaining, CALL_TIMEOUT_MAX_MS)), maxRetries: 0 };
}

function realPort(env: Env): FactoryPort {
  const client = makeClient(env);
  const longClient = makeClient(env, { timeoutMs: 300_000 });
  return {
    isFake: false,
    createSession: (params, o) => call(async () => ({ id: (await client.beta.sessions.create(params, requestOptions(o))).id })),
    retrieveSession: (id, o) => call(async () => toView(await client.beta.sessions.retrieve(id, {}, requestOptions(o)))),
    listSessionsPage: (page, o) =>
      call(async () => {
        const p = await client.beta.sessions.list({ order: 'desc', ...(page ? { page } : {}) }, requestOptions(o));
        return { data: p.data.map(toView), next: p.next_page ?? null };
      }),
    listEventsPage: (id, { order, page }, o) =>
      call(async () => {
        const p = await client.beta.sessions.events.list(id, { order, ...(page ? { page } : {}) }, requestOptions(o));
        return { data: p.data as unknown[], next: p.next_page ?? null };
      }),
    sendEvents: (id, events, o) =>
      call(async () => {
        await client.beta.sessions.events.send(id, { events }, requestOptions(o));
      }),
    archiveSession: (id, o) =>
      call(async () => {
        await client.beta.sessions.archive(id, {}, requestOptions(o));
      }),
    listFilesPage: (sessionId, page, o) =>
      call(async () => {
        const p = await client.beta.files.list({ scope_id: sessionId, betas: [MANAGED_AGENTS_BETA], ...(page ? { page } : {}) }, requestOptions(o));
        return {
          data: p.data.map((f) => ({ id: f.id, filename: f.filename, size_bytes: f.size_bytes, created_at: f.created_at })),
          next: p.next_page ?? null,
        };
      }),
    downloadFile: (fileId, o) =>
      call(async () => {
        const res = await client.beta.files.download(fileId, {}, requestOptions(o));
        return new Uint8Array(await res.arrayBuffer());
      }),
    createMessage: (params, o) => call(() => longClient.messages.create(params, requestOptions(o))),
    createBatch: (params, o) => call(async () => toBatchView(await client.messages.batches.create(params, requestOptions(o)))),
    retrieveBatch: (id, o) => call(async () => toBatchView(await client.messages.batches.retrieve(id, {}, requestOptions(o)))),
    batchResults: (id, o) =>
      call(async () => {
        const out: MessageBatchIndividualResponse[] = [];
        for await (const r of await client.messages.batches.results(id, {}, requestOptions(o))) {
          out.push(r);
          if (out.length >= BATCH_RESULTS_MAX) break;
        }
        return out;
      }),
    xaiResponses: async (req, o) => {
      if (!env.XAI_API_KEY) throw new XaiError(false, undefined, 'no_key');
      const remaining = o?.deadline ? o.deadline - Date.now() : undefined;
      return xaiResponses(env.XAI_API_KEY, req, { timeoutMs: remaining });
    },
  };
}

function toBatchView(b: { id: string; processing_status: BatchView['processing_status']; created_at: string; expires_at: string }): BatchView {
  return { id: b.id, processing_status: b.processing_status, created_at: b.created_at, expires_at: b.expires_at };
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

/** 収集部隊の RSS 取得に使う fetch（§K-8: FactoryPort でなく fetch を差し替える）。fake が許可される時だけ fixture を返す fetch */
export async function getFeedFetch(env: Env, ctx: PortContext): Promise<typeof fetch> {
  const fake = await loadFake(env, ctx);
  return fake ? fake.feedFetch : (input, init) => fetch(input, init);
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
