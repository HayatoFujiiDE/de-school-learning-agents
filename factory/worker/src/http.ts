// ルートで共通に使う小さな道具（JSON 応答・本文の読み取り・ルート文脈）
import { getPort, type FactoryPort } from './anthropic';
import type { Env } from './env';

export interface RouteCtx {
  env: Env;
  request: Request;
  url: URL;
  /** Access で確かめた運営のメール（Access 不要のルートでは空） */
  email: string;
  /** service token（common_name）で通った時だけ true（§U-1 の 2）。service の判定はこれで行い、email の文字列で判定しない */
  service: boolean;
  /** service token の common_name（人の時は null） */
  serviceName: string | null;
  exec: ExecutionContext;
  port(): Promise<FactoryPort>;
}

export function makeCtx(
  env: Env,
  request: Request,
  exec: ExecutionContext,
  email: string,
  who: { service: boolean; serviceName: string | null } = { service: false, serviceName: null },
): RouteCtx {
  const url = new URL(request.url);
  let cached: Promise<FactoryPort> | null = null;
  return {
    env,
    request,
    url,
    email,
    service: who.service === true,
    serviceName: who.service === true ? who.serviceName : null,
    exec,
    port: () => (cached ??= getPort(env, { hostname: url.hostname })),
  };
}

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

export const fromResult = (r: { status: number; body: Record<string, unknown> }): Response => json(r.status, r.body);

export async function readBody(request: Request, maxBytes = 256 * 1024): Promise<Record<string, unknown> | null> {
  const text = await request.text();
  if (text.length > maxBytes) return null;
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function parseJsonField<T>(s: unknown, fallback: T): T {
  if (typeof s !== 'string') return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

export const isNonEmptyString = (v: unknown, max = 20_000): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
