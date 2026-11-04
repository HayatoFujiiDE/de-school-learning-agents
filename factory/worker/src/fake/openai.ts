// fake の OpenAI Images（契約 §O-4 e = 旧下書き §M-2-4 e + bad_bytes_with_usage）。src/fake/anthropic.ts が re-export し、
// 読み込みは src/anthropic.ts の loadFake（FAKE_GUARD の動的 import 1 箇所）からだけ。本番ではこのモジュールに到達しない。
// シナリオは settings.fake_openai_scenario（既定 ok）。呼び出しは settings.fake_openai_calls_json に {model,size,quality,output_format,background} を追記する
// （smoke が「OpenAI 0 回」を数える）。prompt は記録しない。

import { getSetting, nowIso, setSetting } from '../db';
import type { Env } from '../env';
import { OpenAiError, type ImageGenParams, type ImagePort, type ImageUsage } from '../openai';

export const FAKE_OPENAI_SCENARIOS = [
  'ok',
  'ok_webp',
  /** 1.5 MB 級の正しい PNG（base64 で約 2 MB。§O-8 t14） */
  'ok_large',
  'rate_limited',
  'quota',
  'moderation',
  'server',
  'timeout',
  'no_usage',
  /** out_image 20,000（実額 61¢ > U） */
  'over_reserve',
  'bad_bytes',
  /** 不正な画像 + out_image 20,000（§O-4 e） */
  'bad_bytes_with_usage',
] as const;
export type FakeOpenAiScenario = (typeof FAKE_OPENAI_SCENARIOS)[number];

/** p1 の flare high 1024 と同じ桁（input 43・image 1,756 → 6¢） */
const NORMAL_USAGE: ImageUsage = { in_text: 43, in_image: 0, out_image: 1756, out_text: 0 };
const OVER_USAGE: ImageUsage = { in_text: 43, in_image: 0, out_image: 20_000, out_text: 0 };

// ---- 正しい PNG（stored deflate）/ WebP をその場で作る ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(parts: Uint8Array[]): number {
  let c = 0xffffffff;
  for (const b of parts) for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0);
  return b;
}
function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const t = new TextEncoder().encode(type);
  return concat([u32(data.length), t, data, u32(crc32([t, data]))]);
}
/** zlib の stored ブロック（圧縮なし）で包む。どの PNG デコーダでも読める */
function zlibStored(raw: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [new Uint8Array([0x78, 0x01])];
  for (let off = 0; off < raw.length || off === 0; off += 65535) {
    const len = Math.min(65535, raw.length - off);
    const last = off + len >= raw.length ? 1 : 0;
    parts.push(new Uint8Array([last, len & 0xff, len >>> 8, ~len & 0xff, (~len >>> 8) & 0xff]), raw.subarray(off, off + len));
    if (raw.length === 0) break;
  }
  let a = 1;
  let b = 0;
  for (let i = 0; i < raw.length; i++) {
    a = (a + raw[i]) % 65521;
    b = (b + a) % 65521;
  }
  parts.push(u32(((b << 16) | a) >>> 0));
  return concat(parts);
}
/** グレースケール 8bit の PNG。seed があれば画素は擬似乱数（圧縮が効かない大きな画像用）、無ければ 0 */
export function grayPng(width: number, height: number, seed?: number): Uint8Array {
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 0;
  const raw = new Uint8Array((width + 1) * height);
  let x = (seed ?? 0) >>> 0;
  for (let r = 0; r < height; r++) {
    raw[r * (width + 1)] = 0; // filter none
    if (seed === undefined) continue;
    for (let c = 1; c <= width; c++) {
      x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
      raw[r * (width + 1) + c] = x >>> 24;
    }
  }
  return concat([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlibStored(raw)), chunk('IEND', new Uint8Array())]);
}
/** 1x1 の可逆 WebP（RIFF / WEBP / VP8L。34 バイト） */
export const TINY_WEBP_B64 = 'UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==';

export function bytesToBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

let largePngB64: string | null = null;
/** 1224 x 1224 の擬似乱数 PNG（約 1.5 MB、base64 で約 2 MB） */
export function largePngBase64(): string {
  largePngB64 ??= bytesToBase64(grayPng(1224, 1224, 7));
  return largePngB64;
}

async function appendOpenAiCall(db: D1Database, p: ImageGenParams, scenario: string): Promise<void> {
  const v = JSON.stringify({ at: nowIso(), scenario, model: p.model, size: p.size, quality: p.quality, output_format: p.output_format, background: p.background });
  await db
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES ('fake_openai_calls_json', json_array(json(?)), ?)
       ON CONFLICT(key) DO UPDATE SET value = json_insert(value, '$[#]', json(?)), updated_at = excluded.updated_at`,
    )
    .bind(v, nowIso(), v)
    .run();
}

export async function readOpenAiCalls(db: D1Database): Promise<Array<Record<string, unknown>>> {
  const v = await getSetting(db, 'fake_openai_calls_json');
  if (!v) return [];
  try {
    return JSON.parse(v) as Array<Record<string, unknown>>;
  } catch {
    return [];
  }
}

export function createFakeImagePort(env: Env): ImagePort {
  return {
    isFake: true,
    async generate(p) {
      const s = (await getSetting(env.DB, 'fake_openai_scenario')) ?? 'ok';
      const scenario: FakeOpenAiScenario = (FAKE_OPENAI_SCENARIOS as readonly string[]).includes(s) ? (s as FakeOpenAiScenario) : 'ok';
      await appendOpenAiCall(env.DB, p, scenario);
      const image = () => (p.output_format === 'webp' ? TINY_WEBP_B64 : bytesToBase64(grayPng(1, 1)));
      switch (scenario) {
        case 'ok':
          return { b64: image(), usage: { ...NORMAL_USAGE } };
        case 'ok_webp':
          return { b64: TINY_WEBP_B64, usage: { ...NORMAL_USAGE } };
        case 'ok_large':
          return { b64: largePngBase64(), usage: { ...NORMAL_USAGE } };
        case 'rate_limited':
          throw new OpenAiError(true, 429, 'rate_limited', null);
        case 'quota':
          throw new OpenAiError(true, 429, 'quota', null);
        case 'moderation':
          throw new OpenAiError(true, 400, 'moderation', null);
        case 'server':
          throw new OpenAiError(true, 500, 'server', null);
        case 'timeout':
          throw new OpenAiError(false, undefined, 'timeout', null);
        case 'no_usage':
          return { b64: image(), usage: null };
        case 'over_reserve':
          return { b64: image(), usage: { ...OVER_USAGE } };
        case 'bad_bytes':
          return { b64: btoa('not an image'), usage: { ...NORMAL_USAGE } };
        case 'bad_bytes_with_usage':
          return { b64: btoa('not an image'), usage: { ...OVER_USAGE } };
      }
    },
  };
}

/** /__fake/openai（POST {scenario}）と /__fake/openai-calls（GET）。呼び出し元で Access と fake の許可を通過済み。該当しなければ null */
export async function handleFakeOpenAiControl(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const j = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  if (url.pathname === '/__fake/openai' && request.method === 'POST') {
    let b: { scenario?: unknown } = {};
    try {
      b = (await request.json()) as { scenario?: unknown };
    } catch {
      return j(400, { error: 'invalid_json' });
    }
    if (typeof b.scenario !== 'string' || !(FAKE_OPENAI_SCENARIOS as readonly string[]).includes(b.scenario))
      return j(400, { error: 'unknown_scenario', scenarios: FAKE_OPENAI_SCENARIOS });
    await setSetting(env.DB, 'fake_openai_scenario', b.scenario);
    return j(200, { scenario: b.scenario });
  }
  if (url.pathname === '/__fake/openai-calls' && request.method === 'GET') return j(200, { calls: await readOpenAiCalls(env.DB) });
  return null;
}
