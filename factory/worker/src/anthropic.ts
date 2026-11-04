// Anthropic client の生成と薄い wrapper（本物）。契約 §D-4, §I。
// Worker の他の部分はこの FactoryPort だけを使う。fake（src/fake/anthropic.ts）は下の fakeAllowed() が true の時だけ読み込む。
// ログ・例外には本文・トークンを載せない（PortError は種別と HTTP status だけ持つ）。

import Anthropic from '@anthropic-ai/sdk';
import type { Message, MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/messages/messages';
import type { SessionCreateParams } from '@anthropic-ai/sdk/resources/beta/sessions/sessions';
import type { BetaManagedAgentsEventParams } from '@anthropic-ai/sdk/resources/beta/sessions/events';
import type { BatchCreateParams, MessageBatchIndividualResponse } from '@anthropic-ai/sdk/resources/messages/batches';
import { MAX_FILE_BYTES } from './checks/schema';
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
  /** deadline がある時の 1 呼び出しの timeout の上限（既定 60 秒）。同期の検証係（§F-3）は長い呼び出しなので大きくする */
  maxTimeoutMs?: number;
}

/** batches.results のオプション。maxBytes を省略すると BATCH_RESULTS_MAX_BYTES（会議の 1 MiB） */
export interface BatchResultsOpts extends CallOpts {
  maxBytes?: number;
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
  /** request_counts の合計（list / retrieve の応答にある時だけ） */
  request_total?: number;
}

/** batches.results から読む行数の上限（会議は 1 件しか送らない） */
export const BATCH_RESULTS_MAX = 10;
/** batches.results の本文を読む量の上限（これを超えた分は読まずに切る。切れた行は使わない） */
export const BATCH_RESULTS_MAX_BYTES = 1024 * 1024;
/** 検証係（§L-2）の batches.results の本文の上限。会議は BATCH_RESULTS_MAX_BYTES のまま */
export const VERIFY_RESULTS_MAX_BYTES = 16 * 1024 * 1024;
/** files.download の本文を読む量の上限（成果物 1 ファイルの上限と同じ。超えたら MAX_FILE_BYTES + 1 bytes で切って返し、呼び出し側の大きさ検査で落とす） */
export const DOWNLOAD_MAX_BYTES = MAX_FILE_BYTES;
/** batches.list で読む件数（1 ページだけ） */
export const BATCH_LIST_LIMIT = 20;

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
  /** 本文は o.maxBytes（既定 BATCH_RESULTS_MAX_BYTES）まで読む。超えた時は改行で閉じた行だけを返す（切れた行は使わない） */
  batchResults(batchId: string, o?: BatchResultsOpts): Promise<MessageBatchIndividualResponse[]>;
  /** messages.batches.list の 1 ページ目だけ（新しい順に BATCH_LIST_LIMIT 件）。応答不明だった batches.create の復旧（§R-40）に使う */
  listBatchesPage(o?: CallOpts): Promise<BatchView[]>;
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
export function makeClient(env: Env, opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}): Anthropic {
  return new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY ?? null,
    webhookKey: env.ANTHROPIC_WEBHOOK_SIGNING_KEY ?? null,
    maxRetries: 1,
    timeout: opts.timeoutMs ?? 60_000,
    ...(opts.fetchImpl ? { fetch: opts.fetchImpl } : {}),
  });
}

const CALL_TIMEOUT_MAX_MS = 60_000;

/** deadline から SDK の RequestOptions を作る（reconcile では再試行しない） */
export function requestOptions(o?: CallOpts): { timeout?: number; maxRetries?: number } {
  if (!o?.deadline) return {};
  const remaining = o.deadline - Date.now();
  return { timeout: Math.max(1_000, Math.min(remaining, o.maxTimeoutMs ?? CALL_TIMEOUT_MAX_MS)), maxRetries: 0 };
}

/**
 * 本文を読む呼び出し（batches.results / files.download）の RequestOptions。
 * SDK（@anthropic-ai/sdk 1.3.0 client.js fetchWithTimeout）の timeout は fetch がヘッダを返した時点で clearTimeout され、本文の受信には効かない。
 * RequestOptions.signal（internal/request-options.d.ts: `signal?: AbortSignal`）は呼び出し側の signal に abort listener を付け、
 * 本文が読み終わるまで外さない（internal/request-signal.ts の説明どおり）ので、絶対期限の AbortSignal.timeout を渡して本文の受信まで縛る。
 * 期限は deadline があれば min(残り時間, 60 秒)、無ければ 60 秒。
 */
export function bodyRequestOptions(o?: CallOpts): { timeout: number; maxRetries: number; signal: AbortSignal } {
  const ms = o?.deadline ? Math.max(1_000, Math.min(o.deadline - Date.now(), CALL_TIMEOUT_MAX_MS)) : CALL_TIMEOUT_MAX_MS;
  return { timeout: ms, maxRetries: o?.deadline ? 0 : 1, signal: AbortSignal.timeout(ms) };
}

/** signal が abort されたら reject する Promise（本文の read と競わせる。fetch 実装が signal で本文を止めなくても期限で抜ける） */
function abortRace(signal: AbortSignal): { promise: Promise<never>; dispose: () => void } {
  let onAbort = () => {};
  const promise = new Promise<never>((_, reject) => {
    onAbort = () => reject(new PortError(false, undefined, 'timeout'));
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
  promise.catch(() => undefined);
  return { promise, dispose: () => signal.removeEventListener('abort', onAbort) };
}

/**
 * 本文を maxBytes + 1 bytes まで読む（それより先は読まずに reader.cancel）。truncated = maxBytes を超えた。
 * 期限（signal）で中断したら PortError(timeout)。read は signal とも競わせる（fetch 実装が signal で本文を止めなくても期限で抜ける）
 */
export async function readBodyCapped(res: Response, maxBytes: number, signal: AbortSignal): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (!res.body) return { bytes: new Uint8Array(0), truncated: false };
  const reader = res.body.getReader();
  const race = abortRace(signal);
  const keep = maxBytes + 1;
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < keep) {
      const { done, value } = await Promise.race([reader.read(), race.promise]);
      if (done) break;
      const part = value.byteLength > keep - total ? value.subarray(0, keep - total) : value;
      chunks.push(part);
      total += part.byteLength;
    }
  } catch (e) {
    reader.cancel().catch(() => undefined);
    if (signal.aborted) throw new PortError(false, undefined, 'timeout');
    throw e;
  } finally {
    race.dispose();
  }
  const truncated = total > maxBytes;
  if (truncated) reader.cancel().catch(() => undefined);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return { bytes: out, truncated };
}

/**
 * batches.results の JSONL を読む（BATCH_RESULTS_MAX 行 / maxBytes（既定 BATCH_RESULTS_MAX_BYTES）まで）。
 * 上限で切った時は、最後まで改行で閉じた行だけを使う（切れた行は捨てる）。
 */
export function parseResultsJsonl(bytes: Uint8Array, truncated: boolean, maxBytes: number = BATCH_RESULTS_MAX_BYTES): MessageBatchIndividualResponse[] {
  let text = new TextDecoder().decode(truncated ? bytes.subarray(0, maxBytes) : bytes);
  if (truncated) {
    const nl = text.lastIndexOf('\n');
    text = nl < 0 ? '' : text.slice(0, nl);
  }
  const out: MessageBatchIndividualResponse[] = [];
  for (const line of text.split('\n')) {
    if (out.length >= BATCH_RESULTS_MAX) break;
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t) as MessageBatchIndividualResponse);
    } catch {
      throw new PortError(true, undefined, 'invalid_results');
    }
  }
  return out;
}

/** signal の期限切れ（SDK の APIUserAbortError や本文 read の AbortError を含む）は応答不明の timeout にする */
async function callWithSignal<T>(signal: AbortSignal, f: () => Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (e) {
    if (signal.aborted && !(e instanceof PortError)) throw new PortError(false, undefined, 'timeout');
    throw toPortError(e);
  }
}

/** 本物の port。fetchImpl はテストで本文の受信を模擬する時だけ渡す（SDK の ClientOptions.fetch） */
export function realPort(env: Env, opts: { fetchImpl?: typeof fetch } = {}): FactoryPort {
  const client = makeClient(env, { fetchImpl: opts.fetchImpl });
  const longClient = makeClient(env, { timeoutMs: 300_000, fetchImpl: opts.fetchImpl });
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
    downloadFile: (fileId, o) => {
      // 本文の受信まで絶対期限で縛り、DOWNLOAD_MAX_BYTES + 1 bytes より先は読まない（超えた分は呼び出し側の大きさ検査で落ちる）
      const ro = bodyRequestOptions(o);
      return callWithSignal(ro.signal, async () => {
        const res = await client.beta.files.download(fileId, {}, ro);
        return (await readBodyCapped(res, DOWNLOAD_MAX_BYTES, ro.signal)).bytes;
      });
    },
    createMessage: (params, o) => call(() => longClient.messages.create(params, requestOptions(o))),
    // §L-2 / §R-40: batches.create は常に再試行しない（応答不明の再送で迷子の batch を増やさない）。deadline があれば timeout も縛る
    createBatch: (params, o) => call(async () => toBatchView(await client.messages.batches.create(params, { ...requestOptions(o), maxRetries: 0 }))),
    retrieveBatch: (id, o) => call(async () => toBatchView(await client.messages.batches.retrieve(id, {}, requestOptions(o)))),
    batchResults: (id, o) => {
      // SDK の batches.results()（resources/messages/batches.js）は retrieve → results_url を GET して JSONLDecoder を返すだけで、
      // 本文の量を数える口が無い。同じ 2 つの request を SDK の client で行い、本文は asResponse() の Response から上限付きで読む
      const ro = bodyRequestOptions(o);
      return callWithSignal(ro.signal, async () => {
        const batch = await client.messages.batches.retrieve(id, {}, ro);
        if (!batch.results_url) throw new PortError(true, undefined, 'no_results_url');
        const res = await client.get<unknown>(batch.results_url, { ...ro, headers: { Accept: 'application/binary' } }).asResponse();
        const maxBytes = o?.maxBytes ?? BATCH_RESULTS_MAX_BYTES;
        const body = await readBodyCapped(res, maxBytes, ro.signal);
        return parseResultsJsonl(body.bytes, body.truncated, maxBytes);
      });
    },
    listBatchesPage: (o) =>
      call(async () => {
        // list() は PagePromise。await で 1 ページ目だけを受け取り、次のページは取らない（core/pagination: Page.data）
        const p = await client.messages.batches.list({ limit: BATCH_LIST_LIMIT }, requestOptions(o));
        return p.data.slice(0, BATCH_LIST_LIMIT).map(toBatchView);
      }),
    xaiResponses: async (req, o) => {
      if (!env.XAI_API_KEY) throw new XaiError(false, undefined, 'no_key');
      const remaining = o?.deadline ? o.deadline - Date.now() : undefined;
      return xaiResponses(env.XAI_API_KEY, req, { timeoutMs: remaining });
    },
  };
}

function toBatchView(b: {
  id: string;
  processing_status: BatchView['processing_status'];
  created_at: string;
  expires_at: string;
  request_counts?: { processing: number; succeeded: number; errored: number; canceled: number; expired: number } | null;
}): BatchView {
  const c = b.request_counts;
  return {
    id: b.id,
    processing_status: b.processing_status,
    created_at: b.created_at,
    expires_at: b.expires_at,
    ...(c ? { request_total: c.processing + c.succeeded + c.errored + c.canceled + c.expired } : {}),
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
