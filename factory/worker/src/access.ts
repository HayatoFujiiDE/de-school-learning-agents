// Cloudflare Access JWT 検証 + Origin 検証（契約 §B-1）。
// 失敗は 401 access_denied、GET 以外（HEAD を含む）で Origin 不一致は 403 bad_origin。

import { isLocalHostname, type Env } from './env';

/**
 * Access で確かめた呼び出し元。service は service token（common_name）で通った時だけ true（§U-1 の 2）。
 * service の判定は必ずこのフィールドで行い、email の文字列（`service:` の接頭辞）で判定しない
 */
export interface AccessIdentity {
  /** 人なら JWT の email。service token なら従来どおり `service:<common_name>`（/api/intake の動作を変えないため。判定には使わない） */
  email: string;
  service: boolean;
  /** service token の common_name（人の時は null） */
  commonName: string | null;
}

export type AccessResult = ({ ok: true } & AccessIdentity) | { ok: false; response: Response };

const JWKS_TTL_SECONDS = 600;

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlJson(s: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export const jsonError = (status: number, error: string, message?: string): Response =>
  new Response(JSON.stringify(message ? { error, message } : { error }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

const denied = (): AccessResult => ({ ok: false, response: jsonError(401, 'access_denied') });

async function getJwks(teamDomain: string): Promise<Array<Record<string, unknown>>> {
  const url = `${teamDomain}/cdn-cgi/access/certs`;
  const cache = (caches as unknown as { default: Cache }).default;
  const key = new Request(url, { method: 'GET' });
  let res = await cache.match(key);
  if (!res) {
    const fresh = await fetch(url, { headers: { accept: 'application/json' } });
    if (!fresh.ok) throw new Error('jwks_fetch_failed');
    const body = await fresh.text();
    res = new Response(body, {
      headers: { 'content-type': 'application/json', 'cache-control': `max-age=${JWKS_TTL_SECONDS}` },
    });
    await cache.put(key, res.clone());
  }
  const data = (await res.json()) as { keys?: Array<Record<string, unknown>> };
  return Array.isArray(data.keys) ? data.keys : [];
}

/** opts.allowCommonName: email が無い時に service token の common_name を受ける（/api/intake と /api/orders だけ。§K-3・§U-1） */
export async function verifyAccessIdentity(
  token: string,
  env: Env,
  nowSec = Math.floor(Date.now() / 1000),
  opts: { allowCommonName?: boolean } = {},
): Promise<AccessIdentity | null> {
  const team = (env.ACCESS_TEAM_DOMAIN || '').replace(/\/+$/, '');
  const aud = env.ACCESS_AUD || '';
  if (!team || !aud) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const header = b64urlJson(parts[0]);
  const payload = b64urlJson(parts[1]);
  if (!header || !payload) return null;
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') return null;

  const keys = await getJwks(team);
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey('jwk', jwk as unknown as JsonWebKey, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) return null;

  if (payload.iss !== team) return null;
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(aud)) return null;
  if (typeof payload.exp !== 'number' || payload.exp <= nowSec) return null;
  if (typeof payload.nbf === 'number' && payload.nbf > nowSec + 60) return null;
  if (typeof payload.email === 'string' && payload.email.length > 0) return { email: payload.email, service: false, commonName: null };
  if (opts.allowCommonName && typeof payload.common_name === 'string' && payload.common_name.length > 0) {
    return { email: `service:${payload.common_name}`, service: true, commonName: payload.common_name };
  }
  return null;
}

/** 従来の形（email の文字列）。中身は verifyAccessIdentity と同じ検証 */
export async function verifyAccessJwt(
  token: string,
  env: Env,
  nowSec = Math.floor(Date.now() / 1000),
  opts: { allowCommonName?: boolean } = {},
): Promise<string | null> {
  const id = await verifyAccessIdentity(token, env, nowSec, opts);
  return id ? id.email : null;
}

/** Access の検証。GET 以外は Origin も検証する。opts.allowCommonName は /api/intake と /api/orders だけが付ける（他ルートは email 必須のまま） */
export async function requireAccess(request: Request, env: Env, opts: { allowCommonName?: boolean } = {}): Promise<AccessResult> {
  const url = new URL(request.url);
  let id: AccessIdentity | null = null;
  if (env.ACCESS_DEV_BYPASS_EMAIL && isLocalHostname(url.hostname)) {
    id = { email: env.ACCESS_DEV_BYPASS_EMAIL, service: false, commonName: null };
  } else {
    const token = request.headers.get('Cf-Access-Jwt-Assertion');
    if (!token) return denied();
    try {
      id = await verifyAccessIdentity(token, env, undefined, { allowCommonName: opts.allowCommonName === true });
    } catch {
      id = null;
    }
    if (!id) return denied();
  }
  // §B-1「GET 以外」: HEAD も検証する
  if (request.method !== 'GET') {
    const origin = request.headers.get('Origin');
    if (!origin || origin !== url.origin) return { ok: false, response: jsonError(403, 'bad_origin') };
  }
  return { ok: true, ...id };
}
