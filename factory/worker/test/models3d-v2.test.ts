// §AJ2-5: 立体モデル v2（download を工場が自分で持って見せる）。fake で。実物の GLB は repo に入れず、最小の GLB をテストの中で合成する。
// 1 inspectGlb / 2 readCapped / 3 取り込み（POST /api/models3d/<id>/fetch）/ 4 配信 / 5 学習者側の一覧 / 8 review の models3d_meta・hostedModels3d /
// 9 admin.js の純関数と /admin の CSP・style の hash / 10 serve.mjs の CSP。6・7 は models3d-order・models3d-schema・rework-from-previous。
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import type { Env } from '../src/env';
import { MODELS3D } from '../src/generated/models3d-catalog';
import type { RouteCtx } from '../src/http';
import worker from '../src/index';
import { MODELS3D_BY_ID } from '../src/models3d';
import { fileUrlOf, hostedModels3d, inspectGlb, MAX_MODEL3D_BYTES, MODEL3D_FILE_URL_RE, R2_KEY, readCapped } from '../src/models3d-file';
import { fetchModel3d, listModels3d } from '../src/routes/models3d';
import { reviewDetail } from '../src/routes/review';
import { d1, migratedDb, one, rows } from './d1-shim';
import { ctx as reviewCtx, good, material, seed, world } from './review-auto-helpers';

type Obj = Record<string, any>;
const ROVER = 'nasa-perseverance-rover';
const ROVER_E = MODELS3D_BY_ID.get(ROVER)!;
const exec = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
const shaHex = (b: Uint8Array | ArrayBuffer) => createHash('sha256').update(b instanceof ArrayBuffer ? new Uint8Array(b) : b).digest('hex');

// ---------------------------------------------------------------------------------------------
// 最小の GLB を合成する（JSON chunk + BIN chunk。JSON は空白、BIN は 0 で 4 byte に詰める）

const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;
interface GlbOpts {
  json?: Obj;
  /** JSON chunk の本文を直接（parse できない文など） */
  jsonText?: string;
  /** BIN chunk の中身（詰め物の前）。null なら BIN chunk を置かない */
  bin?: Uint8Array | null;
  /** buffers[0].byteLength を上書き */
  byteLength?: unknown;
  magic?: string;
  version?: number;
  /** ヘッダの length に足す */
  lengthDelta?: number;
  /** 2 つ目の chunk の種別 */
  chunk1Type?: number;
  /** 3 つ目の chunk を足す */
  extraChunk?: boolean;
  /** JSON chunk の長さを 4 の倍数にしない（ヘッダの chunk 長だけ 1 減らし、最後に 1 byte 足す） */
  oddJsonLength?: boolean;
}
const pad4 = (n: number) => (4 - (n % 4)) % 4;
function glb(o: GlbOpts = {}): ArrayBuffer {
  const bin = o.bin === undefined ? new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) : o.bin;
  const doc: Obj = o.json ?? {
    asset: { version: '2.0', generator: 'test' },
    buffers: bin ? [{ byteLength: o.byteLength ?? bin.byteLength }] : undefined,
    bufferViews: bin ? [{ buffer: 0, byteOffset: 0, byteLength: bin.byteLength }] : undefined,
    images: bin ? [{ bufferView: 0, mimeType: 'image/png' }] : undefined,
    meshes: [{ primitives: [] }],
  };
  const jsonRaw = new TextEncoder().encode(o.jsonText ?? JSON.stringify(doc));
  const jsonBytes = new Uint8Array(jsonRaw.byteLength + pad4(jsonRaw.byteLength)).fill(0x20);
  jsonBytes.set(jsonRaw);
  const chunks: Array<{ type: number; data: Uint8Array; lenOverride?: number }> = [{ type: CHUNK_JSON, data: jsonBytes }];
  if (o.oddJsonLength) chunks[0] = { type: CHUNK_JSON, data: jsonBytes, lenOverride: jsonBytes.byteLength - 1 };
  if (bin) {
    const b = new Uint8Array(bin.byteLength + pad4(bin.byteLength));
    b.set(bin);
    chunks.push({ type: o.chunk1Type ?? CHUNK_BIN, data: b });
  }
  if (o.extraChunk) chunks.push({ type: CHUNK_BIN, data: new Uint8Array(4) });
  const total = 12 + chunks.reduce((n, c) => n + 8 + (c.lenOverride ?? c.data.byteLength), 0) + (o.oddJsonLength ? 1 : 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  out.set(new TextEncoder().encode(o.magic ?? 'glTF'), 0);
  dv.setUint32(4, o.version ?? 2, true);
  dv.setUint32(8, total + (o.lengthDelta ?? 0), true);
  let off = 12;
  for (const c of chunks) {
    const len = c.lenOverride ?? c.data.byteLength;
    dv.setUint32(off, len, true);
    dv.setUint32(off + 4, c.type, true);
    out.set(c.data.subarray(0, len), off + 8);
    off += 8 + len;
  }
  return out.buffer;
}
const withJson = (patch: Obj) => {
  const bin = new Uint8Array(8);
  return glb({ bin, json: { asset: { version: '2.0' }, buffers: [{ byteLength: 8 }], bufferViews: [{ buffer: 0, byteLength: 8 }], images: [{ bufferView: 0, mimeType: 'image/png' }], ...patch } });
};

describe('§AJ2-5 1 inspectGlb', () => {
  it('合成した最小 GLB（JSON + BIN・asset 2.0・buffers 1 件・images は bufferView 付き）は ok。meshes・images の数と draco', () => {
    expect(inspectGlb(glb())).toEqual({ ok: true, meshes: 1, images: 1, draco: false });
    // BIN chunk が無く buffers も images も無い GLB も ok
    expect(inspectGlb(glb({ bin: null }))).toEqual({ ok: true, meshes: 1, images: 0, draco: false });
  });

  it('draco は extensionsUsed だけにあっても true。required にあっても true', () => {
    expect(inspectGlb(withJson({ extensionsUsed: ['KHR_draco_mesh_compression'] }))).toMatchObject({ ok: true, draco: true });
    expect(inspectGlb(withJson({ extensionsRequired: ['KHR_draco_mesh_compression'], extensionsUsed: ['KHR_draco_mesh_compression', 'KHR_materials_clearcoat', 'EXT_texture_webp'] }))).toMatchObject({ ok: true, draco: true });
  });

  it.each<[string, () => ArrayBuffer, string]>([
    ['20 byte 未満', () => new Uint8Array(19).buffer, 'magic'],
    ['先頭が glTF でない', () => glb({ magic: 'glTX' }), 'magic'],
    ['version が 1', () => glb({ version: 1 }), 'version'],
    ['ヘッダの length が全長と違う', () => glb({ lengthDelta: 4 }), 'length'],
    ['3 つ目の chunk', () => glb({ extraChunk: true }), 'chunk'],
    ['2 つ目が BIN でない', () => glb({ chunk1Type: CHUNK_JSON }), 'chunk'],
    ['chunk0 が JSON でない', () => { const b = new Uint8Array(glb({ bin: null })); new DataView(b.buffer).setUint32(16, CHUNK_BIN, true); return b.buffer; }, 'chunk'],
    ['chunk の長さが 4 の倍数でない', () => glb({ bin: null, oddJsonLength: true }), 'chunk'],
    ['chunk の長さがファイルの外に出る', () => { const b = new Uint8Array(glb()); new DataView(b.buffer).setUint32(12, 4096, true); return b.buffer; }, 'chunk'],
    ['JSON が parse できない', () => glb({ jsonText: '{"asset":', bin: null }), 'json'],
    ['JSON が object でない', () => glb({ jsonText: '[1,2]', bin: null }), 'json'],
    ['extensionsUsed が配列でない', () => withJson({ extensionsUsed: 'KHR_draco_mesh_compression' }), 'json'],
    ['buffers の要素が object でない', () => withJson({ buffers: [8] }), 'json'],
    ['extensionsRequired の要素が string でない', () => withJson({ extensionsRequired: [1] }), 'json'],
    ['asset.version が "1.0"', () => withJson({ asset: { version: '1.0' } }), 'asset'],
    ['asset が無い', () => withJson({ asset: undefined }), 'asset'],
    ['buffers[].uri がある', () => withJson({ buffers: [{ byteLength: 8, uri: 'data.bin' }] }), 'external'],
    ['images[].uri がある', () => withJson({ images: [{ uri: 'tex.png', mimeType: 'image/png', bufferView: 0 }] }), 'external'],
    ['images[] に bufferView が無い', () => withJson({ images: [{ mimeType: 'image/png' }] }), 'external'],
    ['images[].mimeType が gif', () => withJson({ images: [{ bufferView: 0, mimeType: 'image/gif' }] }), 'external'],
    ['BIN chunk が無いのに buffers がある', () => glb({ bin: null, json: { asset: { version: '2.0' }, buffers: [{ byteLength: 8 }] } }), 'buffer'],
    ['byteLength が BIN chunk を超える', () => glb({ bin: new Uint8Array(8), byteLength: 9 }), 'buffer'],
    ['BIN chunk − byteLength が 4 以上', () => glb({ bin: new Uint8Array(8), byteLength: 4 }), 'buffer'],
    ['byteLength が整数でない', () => glb({ bin: new Uint8Array(8), byteLength: 7.5 }), 'buffer'],
    ['byteLength が無い', () => withJson({ buffers: [{}] }), 'buffer'],
    ['buffers が 2 件', () => withJson({ buffers: [{ byteLength: 8 }, { byteLength: 8 }] }), 'buffer'],
    ['BIN chunk があるのに buffers が無い', () => withJson({ buffers: undefined }), 'buffer'],
    ['required に KHR_texture_basisu', () => withJson({ extensionsRequired: ['KHR_texture_basisu'], extensionsUsed: ['KHR_texture_basisu'] }), 'extension'],
    ['used だけに KHR_texture_basisu', () => withJson({ extensionsUsed: ['KHR_texture_basisu'] }), 'extension'],
    ['used だけに EXT_meshopt_compression', () => withJson({ extensionsUsed: ['EXT_meshopt_compression'] }), 'extension'],
    ['required に未知の拡張', () => withJson({ extensionsRequired: ['KHR_materials_variants'] }), 'extension'],
  ])('%s → %s', (_n, make, reason) => {
    expect(inspectGlb(make())).toEqual({ ok: false, reason });
  });

  it('詰め物は 0〜3 byte まで通る（BIN の長さ 12・byteLength 9〜12）', () => {
    for (const bl of [9, 10, 11, 12]) expect(inspectGlb(glb({ bin: new Uint8Array(12), byteLength: bl })).ok, String(bl)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------

/** 1 回の pull で size byte ずつ、合わせて total byte を流す stream（cancel を数える） */
function chunkedStream(total: number, size = 1024 * 1024) {
  const st = { cancelled: 0, sent: 0 };
  const stream = new ReadableStream<Uint8Array>({
    pull(c) {
      if (st.sent >= total) return c.close();
      const n = Math.min(size, total - st.sent);
      st.sent += n;
      c.enqueue(new Uint8Array(n));
    },
    cancel() {
      st.cancelled++;
    },
  });
  return { stream, st };
}

describe('§AJ2-5 2 readCapped', () => {
  it('上限ちょうど → 通る（全部を 1 つの ArrayBuffer に）', async () => {
    const { stream, st } = chunkedStream(10, 3);
    const r = await readCapped(stream, 10);
    expect(r).toBeInstanceOf(ArrayBuffer);
    expect((r as ArrayBuffer).byteLength).toBe(10);
    expect(st.cancelled).toBe(0);
  });

  it('上限 + 1 byte（content-length 無しの stream）→ too_large で cancel が呼ばれ、その先は読まない', async () => {
    const { stream, st } = chunkedStream(MAX_MODEL3D_BYTES + 1 + 4 * 1024 * 1024);
    expect(await readCapped(stream, MAX_MODEL3D_BYTES)).toBe('too_large');
    expect(st.cancelled).toBe(1);
    expect(st.sent).toBeLessThan(MAX_MODEL3D_BYTES + 3 * 1024 * 1024);
    const small = chunkedStream(11, 4);
    expect(await readCapped(small.stream, 10)).toBe('too_large');
    expect(small.st.cancelled).toBe(1);
  });

  it('本文が null なら空', async () => {
    expect(((await readCapped(null, 10)) as ArrayBuffer).byteLength).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// 取り込み（POST /api/models3d/<id>/fetch）

function r2Fake() {
  const store = new Map<string, Uint8Array>();
  const puts: Array<{ key: string; opts: unknown }> = [];
  const heads: string[] = [];
  const R2 = {
    async put(k: string, v: ArrayBuffer | Uint8Array, opts?: unknown) {
      puts.push({ key: k, opts });
      store.set(k, new Uint8Array(v instanceof ArrayBuffer ? v.slice(0) : v.slice()));
      return { key: k };
    },
    async head(k: string) {
      heads.push(k);
      const b = store.get(k);
      return b ? { key: k, size: b.byteLength } : null;
    },
    async get(k: string) {
      const b = store.get(k);
      return b ? { key: k, size: b.byteLength, body: b.slice() } : null;
    },
  };
  return { store, puts, heads, R2 };
}

let db: DatabaseSync;
let r2: ReturnType<typeof r2Fake>;
let env: Env;
let logs: string[];
beforeEach(() => {
  db = migratedDb();
  r2 = r2Fake();
  env = { DB: d1(db), R2: r2.R2 } as unknown as Env;
  logs = [];
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(' ')));
});
afterEach(() => {
  vi.restoreAllMocks();
});

const routeCtx = (o: { service?: boolean } = {}): RouteCtx => {
  const request = new Request('http://localhost/api/models3d/x/fetch', { method: 'POST' });
  return {
    env,
    request,
    url: new URL(request.url),
    email: 'ops@example.invalid',
    service: o.service === true,
    serviceName: o.service ? 'svc.access' : null,
    exec,
    port: async () => {
      throw new Error('port not used');
    },
  };
};
type Stub = typeof fetch & { calls: Array<[string, RequestInit | undefined]> };
const stubFetch = (make: () => Response | Promise<Response>): Stub => {
  const calls: Array<[string, RequestInit | undefined]> = [];
  const f = (async (u: RequestInfo | URL, init?: RequestInit) => {
    calls.push([String(u), init]);
    return make();
  }) as Stub;
  f.calls = calls;
  return f;
};
const glbRes = (b: ArrayBuffer, headers: Record<string, string> = {}) => new Response(b, { status: 200, headers: { 'content-type': 'model/gltf-binary', ...headers } });
const call = async (id: string, f: typeof fetch, o: { service?: boolean } = {}) => {
  const res = await fetchModel3d(routeCtx(o), id, f);
  return { status: res.status, body: (await res.json()) as Obj };
};
const fileRows = () => rows(db, 'SELECT * FROM models3d_files');

describe('§AJ2-5 3 POST /api/models3d/<id>/fetch（fetchModel3d）', () => {
  it('一覧に無い id → 404 not_found（取得しない）', async () => {
    const f = stubFetch(() => glbRes(glb()));
    expect(await call('no-such-model', f)).toEqual({ status: 404, body: { error: 'not_found' } });
    expect(f.calls).toHaveLength(0);
  });

  it('voyager の id・download_url 無しの id → 400 not_download（取得しない・何も書かない）', async () => {
    const f = stubFetch(() => glbRes(glb()));
    expect(await call('si-triceratops', f)).toEqual({ status: 400, body: { error: 'not_download' } });
    expect(MODELS3D_BY_ID.get('dbcls-bodyparts3d')!.download_url).toBeNull();
    expect(await call('dbcls-bodyparts3d', f)).toEqual({ status: 400, body: { error: 'not_download' } });
    expect(f.calls).toHaveLength(0);
    expect(fileRows()).toEqual([]);
    expect(r2.store.size).toBe(0);
  });

  it('取得は一覧の download_url だけ。redirect manual・accept・signal を付ける', async () => {
    const f = stubFetch(() => glbRes(glb()));
    expect((await call(ROVER, f)).status).toBe(200);
    expect(f.calls).toHaveLength(1);
    const [u, init] = f.calls[0];
    expect(u).toBe(ROVER_E.download_url);
    expect(init?.redirect).toBe('manual');
    expect((init?.headers as Record<string, string>).accept).toBe('model/gltf-binary, */*');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('too_large: content-length が上限超え（本文を読まない）/ content-length 無しの本文が上限超え（cancel）。何も書かない', async () => {
    let pulled = 0;
    const lazy = new ReadableStream<Uint8Array>({ pull: (c) => { pulled++; c.enqueue(new Uint8Array(4)); }, cancel() {} }, { highWaterMark: 0 });
    const f1 = stubFetch(() => new Response(lazy, { status: 200, headers: { 'content-length': String(MAX_MODEL3D_BYTES + 1) } }));
    expect(await call(ROVER, f1)).toEqual({ status: 413, body: { error: 'too_large' } });
    expect(pulled).toBe(0);
    // 上限 + 4 MiB を流す source（上限を超えた所で cancel され、残りは流れない）
    const total = MAX_MODEL3D_BYTES + 4 * 1024 * 1024;
    const big = chunkedStream(total);
    const f2 = stubFetch(() => new Response(big.stream, { status: 200 }));
    expect(await call(ROVER, f2)).toEqual({ status: 413, body: { error: 'too_large' } });
    expect(big.st.cancelled).toBe(1);
    expect(big.st.sent).toBeLessThan(total);
    expect(fileRows()).toEqual([]);
    expect(r2.store.size).toBe(0);
    expect(r2.puts).toHaveLength(0);
  });

  it('fetch_failed: status 500・302（追わない）・例外・timeout・本文の途中で切れる', async () => {
    expect(await call(ROVER, stubFetch(() => new Response('x', { status: 500 })))).toEqual({ status: 502, body: { error: 'fetch_failed:500' } });
    const f302 = stubFetch(() => new Response(null, { status: 302, headers: { location: 'https://evil.example/x.glb' } }));
    expect(await call(ROVER, f302)).toEqual({ status: 502, body: { error: 'fetch_failed:302' } });
    expect(f302.calls).toHaveLength(1);
    expect(await call(ROVER, stubFetch(() => { throw new TypeError('network'); }))).toEqual({ status: 502, body: { error: 'fetch_failed:network' } });
    expect(await call(ROVER, stubFetch(() => { throw new DOMException('timed out', 'TimeoutError'); }))).toEqual({ status: 502, body: { error: 'fetch_failed:timeout' } });
    let n = 0;
    const broken = new ReadableStream<Uint8Array>({ pull: (c) => (n++ === 0 ? c.enqueue(new Uint8Array(8)) : c.error(new TypeError('reset'))) });
    expect(await call(ROVER, stubFetch(() => new Response(broken, { status: 200 })))).toEqual({ status: 502, body: { error: 'fetch_failed:network' } });
    const slow = new ReadableStream<Uint8Array>({ pull: (c) => c.error(new DOMException('timed out', 'TimeoutError')) });
    expect(await call(ROVER, stubFetch(() => new Response(slow, { status: 200 })))).toEqual({ status: 502, body: { error: 'fetch_failed:timeout' } });
    expect(fileRows()).toEqual([]);
    expect(r2.store.size).toBe(0);
  });

  it('bad_glb: 形の検査で落ちたら 422 bad_glb:<reason>。何も書かない', async () => {
    expect(await call(ROVER, stubFetch(() => glbRes(new TextEncoder().encode('<html>not a model</html>').buffer)))).toEqual({ status: 422, body: { error: 'bad_glb:magic' } });
    expect(await call(ROVER, stubFetch(() => glbRes(withJson({ extensionsUsed: ['KHR_texture_basisu'] }))))).toEqual({ status: 422, body: { error: 'bad_glb:extension' } });
    expect(fileRows()).toEqual([]);
    expect(r2.store.size).toBe(0);
  });

  it('fetched: R2 に key が入り D1 に行が入る。応答の sha は本文の sha256。ログに url と本文を出さない', async () => {
    const body = withJson({ extensionsRequired: ['KHR_draco_mesh_compression'] });
    const sha = shaHex(body);
    const r = await call(ROVER, stubFetch(() => glbRes(body, { 'content-length': String(body.byteLength) })));
    expect(r).toEqual({ status: 200, body: { status: 'fetched', catalog_id: ROVER, sha256: sha, bytes: body.byteLength, draco: true } });
    expect([...r2.store.keys()]).toEqual([`models3d/${ROVER}/${sha}.glb`]);
    expect(r2.puts[0].opts).toEqual({ httpMetadata: { contentType: 'model/gltf-binary' }, sha256: sha });
    expect(shaHex(r2.store.get(R2_KEY(ROVER, sha))!)).toBe(sha);
    expect(fileRows()).toEqual([
      { catalog_id: ROVER, sha256: sha, bytes: body.byteLength, r2_key: `models3d/${ROVER}/${sha}.glb`, draco: 1, fetched_at: expect.any(String), fetched_by: 'ops@example.invalid' },
    ]);
    const line = logs.find((l) => l.includes('model3d_fetch'))!;
    expect(JSON.parse(line)).toEqual({ at: 'model3d_fetch', catalog_id: ROVER, status: 'fetched', bytes: body.byteLength });
    for (const l of logs) {
      expect(l).not.toContain('assets.science.nasa.gov');
      expect(l).not.toContain('ops@example.invalid');
    }
  });

  it('unchanged: 同じ本文の 2 回目は put を呼ばない', async () => {
    const body = glb();
    await call(ROVER, stubFetch(() => glbRes(body)));
    expect(r2.puts).toHaveLength(1);
    const r = await call(ROVER, stubFetch(() => glbRes(body)));
    expect(r).toEqual({ status: 200, body: { status: 'unchanged', catalog_id: ROVER, sha256: shaHex(body), bytes: body.byteLength } });
    expect(r2.puts).toHaveLength(1);
  });

  it('欠けた object の修復: D1 に行・R2 に無し → 2 回目で put が呼ばれ fetched', async () => {
    const body = glb();
    await call(ROVER, stubFetch(() => glbRes(body)));
    r2.store.clear();
    const r = await call(ROVER, stubFetch(() => glbRes(body)));
    expect(r.body.status).toBe('fetched');
    expect(r2.puts).toHaveLength(2);
    expect(r2.store.has(R2_KEY(ROVER, shaHex(body)))).toBe(true);
  });

  it('取り直し: sha が変わっても古い key は残り、D1 の行は新しい sha を指す', async () => {
    const a = glb();
    const b = glb({ bin: new Uint8Array([9, 9, 9, 9]) });
    await call(ROVER, stubFetch(() => glbRes(a)));
    const r = await call(ROVER, stubFetch(() => glbRes(b)));
    expect(r.body).toMatchObject({ status: 'fetched', sha256: shaHex(b) });
    expect(r2.store.has(R2_KEY(ROVER, shaHex(a)))).toBe(true);
    expect(r2.store.has(R2_KEY(ROVER, shaHex(b)))).toBe(true);
    expect(one(db, 'SELECT sha256 FROM models3d_files WHERE catalog_id = ?', ROVER).sha256).toBe(shaHex(b));
    expect(fileRows()).toHaveLength(1);
  });

  it('handler 単体で c.service は 403 human_only（取得しない）', async () => {
    const f = stubFetch(() => glbRes(glb()));
    expect(await call(ROVER, f, { service: true })).toEqual({ status: 403, body: { error: 'human_only' } });
    expect(f.calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------------------------
// route: Access の層（service token の common_name は 401）・人は handler に届く

describe('§AJ2-5 3 route（Access の層）', () => {
  const TEAM = 'https://team.example.cloudflareaccess.com';
  const AUD = 'aud-test';
  const b64u = (b: ArrayBuffer | Uint8Array | string) => Buffer.from(typeof b === 'string' ? b : b instanceof Uint8Array ? b : new Uint8Array(b)).toString('base64url');
  const realFetch = globalThis.fetch;
  const realCaches = (globalThis as unknown as { caches?: unknown }).caches;
  let sign: (p: Obj) => Promise<string>;

  beforeEach(async () => {
    const kp = (await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const jwk = { ...(await crypto.subtle.exportKey('jwk', kp.publicKey)), kid: 'k1' };
    const store = new Map<string, Response>();
    (globalThis as unknown as { caches: unknown }).caches = {
      default: { match: async (r: Request) => store.get(r.url)?.clone(), put: async (r: Request, res: Response) => void store.set(r.url, res) },
    };
    // JWKS の取得。取り込みの handler に届いた時の取得もこれが返す（GLB でないので bad_glb:magic = handler に届いた印）
    (globalThis as unknown as { fetch: unknown }).fetch = async () => new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
    sign = async (payload) => {
      const h = b64u(JSON.stringify({ alg: 'RS256', kid: 'k1' }));
      const p = b64u(JSON.stringify({ iss: TEAM, aud: [AUD], exp: Math.floor(Date.now() / 1000) + 600, ...payload }));
      const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', kp.privateKey, new TextEncoder().encode(`${h}.${p}`));
      return `${h}.${p}.${b64u(sig)}`;
    };
    env = { DB: d1(db), R2: r2.R2, ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD } as unknown as Env;
  });
  afterEach(() => {
    (globalThis as unknown as { fetch: unknown }).fetch = realFetch;
    (globalThis as unknown as { caches: unknown }).caches = realCaches;
  });
  const post = async (token: string) =>
    worker.fetch(new Request(`http://localhost/api/models3d/${ROVER}/fetch`, { method: 'POST', headers: { 'Cf-Access-Jwt-Assertion': token, origin: 'http://localhost' } }), env, exec);

  it('service token（common_name）の request は Access の層で 401（handler に届かない）', async () => {
    const res = await post(await sign({ common_name: 'claude-order.access', sub: '' }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'access_denied' });
    expect(fileRows()).toEqual([]);
  });

  it('人（email）の request は handler に届く（取得先の stub が GLB でない → 422 bad_glb:magic）', async () => {
    const res = await post(await sign({ email: 'op@example.invalid' }));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'bad_glb:magic' });
  });
});

// ---------------------------------------------------------------------------------------------
// GET /api/models3d（管理のページ用）

describe('§AJ2-2 GET /api/models3d（listModels3d）', () => {
  it('一覧の全件を一覧の順に。state は embed / hosted / hosted_missing / not_hosted / unavailable。hosted 系は object_ok', async () => {
    const sha = 'b'.repeat(64);
    const ins = (id: string, s: string) =>
      db.prepare('INSERT INTO models3d_files (catalog_id, sha256, bytes, r2_key, draco, fetched_at, fetched_by) VALUES (?, ?, 5000000, ?, 1, ?, ?)').run(id, s, 'anything/else', '2026-11-07T12:00:00.000Z', 'ops@example.invalid');
    ins(ROVER, sha);
    ins('nasa-iss', 'c'.repeat(64));
    r2.store.set(R2_KEY(ROVER, sha), new Uint8Array(3));
    const res = await listModels3d(routeCtx());
    const b = (await res.json()) as { models: Obj[] };
    expect(b.models.map((m) => m.id)).toEqual(MODELS3D.map((e) => e.id));
    const by = Object.fromEntries(b.models.map((m) => [m.id, m]));
    expect(by['omnh-allosaurus']).toEqual({ id: 'omnh-allosaurus', title: MODELS3D_BY_ID.get('omnh-allosaurus')!.title_ja, org: '大阪市立自然史博物館', kind: 'sketchfab', license: 'CC BY 4.0', page_url: MODELS3D_BY_ID.get('omnh-allosaurus')!.page_url, has_download_url: false, state: 'embed' });
    expect(by[ROVER]).toMatchObject({ state: 'hosted', bytes: 5000000, sha256: sha, fetched_at: '2026-11-07T12:00:00.000Z', object_ok: true, has_download_url: true, kind: 'download' });
    expect(by['nasa-iss']).toMatchObject({ state: 'hosted_missing', object_ok: false });
    expect(by['dbcls-bodyparts3d']).toMatchObject({ state: 'unavailable', has_download_url: false });
    expect(by['dbcls-bodyparts3d'].object_ok).toBeUndefined();
    // key は id と sha から組む（DB の r2_key は見ない）
    expect(r2.heads.every((k) => /^models3d\/[a-z0-9-]+\/[0-9a-f]{64}\.glb$/.test(k))).toBe(true);
    db.prepare('DELETE FROM models3d_files WHERE catalog_id = ?').run('nasa-iss');
    const b2 = (await (await listModels3d(routeCtx())).json()) as { models: Obj[] };
    expect(b2.models.find((m) => m.id === 'nasa-iss')).toMatchObject({ state: 'not_hosted' });
  });
});

// ---------------------------------------------------------------------------------------------
// 配信・学習者側の一覧（認証なし）

const libGet = (path: string, e: Env = env, method = 'GET') => worker.fetch(new Request(`http://localhost${path}`, { method }), e, exec);

describe('§AJ2-5 4 GET /api/library/models3d/files/<id>/<sha>.glb', () => {
  const sha = 'd'.repeat(64);
  const path = `/api/library/models3d/files/${ROVER}/${sha}.glb`;

  it('object があれば 200 と 5 つの headers（content-length は object の size）・本文は R2 の bytes。D1 は見ない', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7]);
    r2.store.set(R2_KEY(ROVER, sha), bytes);
    const res = await libGet(path, { R2: r2.R2 } as unknown as Env);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('model/gltf-binary');
    expect(res.headers.get('content-length')).toBe('7');
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
  });

  it('D1 の行が別の sha を指していても、object があれば 200（取り直し前の古い url が生きる）', async () => {
    db.prepare('INSERT INTO models3d_files (catalog_id, sha256, bytes, r2_key, draco, fetched_at, fetched_by) VALUES (?, ?, 1, ?, 0, ?, ?)').run(ROVER, 'e'.repeat(64), 'x', '2026-11-07T00:00:00.000Z', 'ops@example.invalid');
    r2.store.set(R2_KEY(ROVER, sha), new Uint8Array([1]));
    expect((await libGet(path)).status).toBe(200);
  });

  it('形が違う（sha が 63 桁・大文字・id に .）・object 無し → 404。POST は 405', async () => {
    r2.store.set(R2_KEY(ROVER, sha), new Uint8Array([1]));
    for (const p of [
      `/api/library/models3d/files/${ROVER}/${sha.slice(1)}.glb`,
      `/api/library/models3d/files/${ROVER}/${sha.toUpperCase()}.glb`,
      `/api/library/models3d/files/nasa.rover/${sha}.glb`,
      `/api/library/models3d/files/${ROVER}/${sha}.gltf`,
      `/api/library/models3d/files/../${ROVER}/${sha}.glb`,
      `/api/library/models3d/files/${ROVER}/${'f'.repeat(64)}.glb`,
    ]) {
      expect((await libGet(p)).status, p).toBe(404);
    }
    expect((await libGet(path, env, 'POST')).status).toBe(405);
  });
});

describe('§AJ2-5 5 GET /api/library/models3d（取り込み済みの download）', () => {
  it('取り込み済みの download は一覧の順で入り 11 キー・file_url は絶対 url。埋め込みは 8 キー。object が欠けた行は出さない。CORS', async () => {
    const sha = '1'.repeat(64);
    db.prepare('INSERT INTO models3d_files (catalog_id, sha256, bytes, r2_key, draco, fetched_at, fetched_by) VALUES (?, ?, 4987176, ?, 1, ?, ?)').run(ROVER, sha, 'x', '2026-11-07T00:00:00.000Z', 'ops@example.invalid');
    db.prepare('INSERT INTO models3d_files (catalog_id, sha256, bytes, r2_key, draco, fetched_at, fetched_by) VALUES (?, ?, 9, ?, 0, ?, ?)').run('nasa-iss', '2'.repeat(64), 'x', '2026-11-07T00:00:00.000Z', 'ops@example.invalid');
    r2.store.set(R2_KEY(ROVER, sha), new Uint8Array(1));
    const res = await libGet('/api/library/models3d');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const b = (await res.json()) as { models: Obj[] };
    expect(b.models.map((m) => m.id)).toEqual(MODELS3D.filter((e) => e.kind !== 'download' || e.id === ROVER).map((e) => e.id));
    const rover = b.models.find((m) => m.id === ROVER)!;
    expect(rover).toEqual({
      id: ROVER,
      title: ROVER_E.title_ja,
      org: 'NASA',
      kind: 'download',
      embed_url: null,
      page_url: ROVER_E.page_url,
      license: ROVER_E.license.label,
      attribution: ROVER_E.attribution,
      file_url: `http://localhost/api/library/models3d/files/${ROVER}/${sha}.glb`,
      bytes: 4987176,
      sha256: sha,
    });
    expect(Object.keys(rover)).toHaveLength(11);
    for (const m of b.models.filter((x) => x.kind !== 'download')) expect(Object.keys(m).sort()).toEqual(['attribution', 'embed_url', 'id', 'kind', 'license', 'org', 'page_url', 'title']);
    // 一覧の file_url は配信の route に当たる（同じ形）
    expect(MODEL3D_FILE_URL_RE.test(new URL(rover.file_url).pathname)).toBe(true);
    expect((await libGet(new URL(rover.file_url).pathname)).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------------------------
// review の models3d_meta と hostedModels3d

describe('§AJ2-5 8 hostedModels3d と GET /api/review/:id の models3d_meta', () => {
  it('hostedModels3d: 行 2 件のうち object が 1 件しか無い時に 1 件だけ返る（key は id と sha から組む）', async () => {
    db.prepare('INSERT INTO models3d_files (catalog_id, sha256, bytes, r2_key, draco, fetched_at, fetched_by) VALUES (?, ?, 10, ?, 1, ?, ?)').run(ROVER, '3'.repeat(64), 'models3d/other/key.glb', '2026-11-07T01:00:00.000Z', 'ops@example.invalid');
    db.prepare('INSERT INTO models3d_files (catalog_id, sha256, bytes, r2_key, draco, fetched_at, fetched_by) VALUES (?, ?, 20, ?, 0, ?, ?)').run('nasa-iss', '4'.repeat(64), 'x', '2026-11-07T02:00:00.000Z', 'ops@example.invalid');
    r2.store.set(R2_KEY(ROVER, '3'.repeat(64)), new Uint8Array(1));
    r2.store.set('models3d/other/key.glb', new Uint8Array(1));
    const h = await hostedModels3d(env);
    expect([...h.entries()]).toEqual([[ROVER, { sha256: '3'.repeat(64), bytes: 10, draco: true, fetched_at: '2026-11-07T01:00:00.000Z' }]]);
  });

  const reviewWith = async (withObject: boolean) => {
    const w = world();
    const sha = '5'.repeat(64);
    w.db.prepare('INSERT INTO models3d_files (catalog_id, sha256, bytes, r2_key, draco, fetched_at, fetched_by) VALUES (?, ?, 4987176, ?, 1, ?, ?)').run(ROVER, sha, 'x', '2026-11-07T00:00:00.000Z', 'ops@example.invalid');
    (w.env.R2 as unknown as Obj).head = async (k: string) => (withObject && k === R2_KEY(ROVER, sha) ? { key: k, size: 4987176 } : null);
    const m = material();
    m.parts[0].models3d = [
      { id: 'd1', catalog_id: ROVER, why: '車輪を回して見る', source_id: 's9' },
      { id: 'd2', catalog_id: 'omnh-allosaurus', why: '骨盤を見る', source_id: 's10' },
    ];
    seed(w, good('m1', 'v1', { material: m, sources: { s1: {}, s9: { url: ROVER_E.page_url, url_was_fetched: 0, quote_found: 0 } } }));
    const b = (await (await reviewDetail(reviewCtx(w, 'GET'), 'v1')).json()) as Obj;
    return { b, sha };
  };

  it('取り込み済み download の models3d_meta に相対の file_url・bytes。埋め込みの件は v1 のまま', async () => {
    const { b, sha } = await reviewWith(true);
    expect(b.models3d_meta.d1).toEqual({
      catalog_id: ROVER,
      title: ROVER_E.title_ja,
      org: 'NASA',
      kind: 'download',
      embed_url: null,
      page_url: ROVER_E.page_url,
      license: ROVER_E.license.label,
      attribution: ROVER_E.attribution,
      file_url: fileUrlOf(ROVER, sha),
      bytes: 4987176,
    });
    expect(b.models3d_meta.d1.file_url).toBe(`/api/library/models3d/files/${ROVER}/${sha}.glb`);
    expect(Object.keys(b.models3d_meta.d2).sort()).toEqual(['attribution', 'catalog_id', 'embed_url', 'kind', 'license', 'org', 'page_url', 'title']);
  });

  it('D1 に行があっても object が無ければ file_url・bytes は付かない', async () => {
    const { b } = await reviewWith(false);
    expect(b.models3d_meta.d1.file_url).toBeUndefined();
    expect(b.models3d_meta.d1.bytes).toBeUndefined();
    expect(b.models3d_meta.d1.kind).toBe('download');
  });
});

// ---------------------------------------------------------------------------------------------
// admin.js の純関数（vm で読む）

const code = readFileSync(new URL('../public/admin/admin.js', import.meta.url), 'utf8');
const win: Obj = { __FACTORY_ADMIN_NO_BOOT__: true };
vm.runInNewContext(code, { window: win, console }, { timeout: 2000 });
const R = win.FactoryAdminReview as Obj;
const M = win.FactoryAdminModels3d as Obj;
const n = (h: string, re: RegExp) => (h.match(re) || []).length;

describe('§AJ2-5 9 admin.js: 子どもの画面の自前の表示', () => {
  const SHA = '6'.repeat(64);
  const FILE = `/api/library/models3d/files/${ROVER}/${SHA}.glb`;
  const meta = (o: Obj = {}) => ({ catalog_id: ROVER, title: ROVER_E.title_ja, org: 'NASA', kind: 'download', embed_url: null, page_url: ROVER_E.page_url, license: 'NASA', attribution: 'NASA', file_url: FILE, bytes: 10, ...o });
  const part = (models3d: unknown[]) => ({ id: 'p1', kind: 3, title: 't', files: [], videos: [], variants: [], models3d });
  const body = (x: Obj, m: Obj | null) => R.previewBodyHtml('a\n\nb', part([x]), { fileBase: '/api/review/v/files/', marks: false, models3dMeta: m ? { d1: m } : {} });
  const x = (o: Obj = {}) => ({ id: 'd1', catalog_id: ROVER, why: '車輪を見る', source_id: 's9', ...o });

  it('先頭で window.ModelViewerElement に自前の Draco の置き場を入れる', () => {
    expect(win.ModelViewerElement).toEqual({ dracoDecoderLocation: '/admin/vendor/draco/' });
    expect(code.indexOf("window.ModelViewerElement = { dracoDecoderLocation: '/admin/vendor/draco/' };")).toBeLessThan(code.indexOf('var WORK_LABEL'));
  });

  it('download + 正しい file_url → <model-viewer src=…> が 1 つ（src は meta の値）・caption・見方', () => {
    const h = body(x({ file_url: '/api/library/models3d/files/evil/x.glb' }), meta());
    expect(n(h, /<model-viewer /g)).toBe(1);
    expect(h).toContain(`<model-viewer src="${FILE}" alt="${ROVER_E.title_ja}" camera-controls touch-action="pan-y" loading="eager"></model-viewer>`);
    expect(h).not.toContain('evil');
    expect(h).not.toContain('<iframe');
    expect(h).toContain('<p class="mp-model3d-cap">');
    expect(h).toContain('提供元で開く');
    expect(h).toContain('<p class="mp-model3d-why"><span class="mp-k">見方</span>車輪を見る</p>');
    expect(h).toMatch(/<div class="mp-model3d" data-media="model3d" data-media-key="d1">/);
  });

  it('値はエスケープする（alt）', () => {
    const h = body(x(), meta({ title: '"><script>x</script>' }));
    expect(h).toContain('alt="&quot;&gt;&lt;script&gt;x&lt;/script&gt;"');
    expect(h).not.toContain('<script>');
  });

  it.each([
    ['絶対 url', `https://factory.example${FILE}`],
    ['..', `/api/library/models3d/files/${ROVER}/../${SHA}.glb`],
    ['sha が短い', `/api/library/models3d/files/${ROVER}/${SHA.slice(2)}.glb`],
    ['javascript', 'javascript:alert(1)'],
    ['クエリつき', `${FILE}?x=1`],
    ['引用符', `${FILE}" onerror="x`],
  ])('file_url の形が違う（%s）→「まだ取り込まれていません」で model-viewer なし', (_n, u) => {
    const h = body(x(), meta({ file_url: u }));
    expect(n(h, /<model-viewer/g)).toBe(0);
    expect(h).toContain('<p class="mp-missing">立体モデル d1 はまだ取り込まれていません（<a href="#/models3d">立体モデル</a> のページで取り込んでください）</p>');
    expect(h).not.toContain('onerror');
  });

  it('file_url が無い download（未取り込み）も「まだ取り込まれていません」。埋め込みの件は v1 のまま iframe', () => {
    const m = meta();
    delete (m as Obj).file_url;
    expect(body(x(), m)).toContain('はまだ取り込まれていません');
    const allo = MODELS3D_BY_ID.get('omnh-allosaurus')!;
    const emb = body(x({ catalog_id: allo.id }), { catalog_id: allo.id, title: allo.title_ja, org: allo.org, kind: 'sketchfab', embed_url: allo.embed_url, page_url: allo.page_url, license: 'CC BY 4.0', attribution: allo.attribution, file_url: FILE });
    expect(n(emb, /<iframe /g)).toBe(1);
    expect(emb).not.toContain('model-viewer');
  });

  it('admin.js の MODEL3D_FILE_URL_RE は src/models3d-file.ts と同じ', () => {
    expect(String(M.MODEL3D_FILE_URL_RE)).toBe(String(MODEL3D_FILE_URL_RE));
  });
});

describe('§AJ2-5 9 admin.js: #/models3d の表', () => {
  const list = () => ({
    models: [
      { id: 'omnh-allosaurus', title: 'アロ', org: '大阪', kind: 'sketchfab', license: 'CC BY 4.0', page_url: 'https://sketchfab.com/3d-models/a', has_download_url: false, state: 'embed' },
      { id: ROVER, title: '探査車', org: 'NASA', kind: 'download', license: 'NASA', page_url: 'https://science.nasa.gov/x/', has_download_url: true, state: 'hosted', bytes: 4987176, sha256: 'a'.repeat(64), fetched_at: '2026-11-07T12:00:00.000Z', object_ok: true },
      { id: 'nasa-x', title: '別', org: 'NASA', kind: 'download', license: 'NASA', page_url: 'https://science.nasa.gov/y/', has_download_url: true, state: 'hosted_missing', bytes: 10, sha256: 'b'.repeat(64), fetched_at: '2026-11-06T00:00:00.000Z', object_ok: false },
      { id: 'nasa-iss', title: 'ISS', org: 'NASA', kind: 'download', license: 'NASA', page_url: 'https://science.nasa.gov/z/', has_download_url: true, state: 'not_hosted' },
      { id: 'dbcls-bodyparts3d', title: '体', org: 'DBCLS', kind: 'download', license: 'CC BY 4.0', page_url: 'javascript:alert(1)', has_download_url: false, state: 'unavailable' },
    ],
  });
  const rowOf = (h: string, id: string) => {
    const m = new RegExp(`<tr data-m3d-id="${id}"[\\s\\S]*?</tr>`).exec(h);
    return m ? m[0] : '';
  };

  it('状態の文言（5 状態）とボタンの有無（not_hosted は取り込む・hosted と object_ok: false の hosted_missing は取り直す）', () => {
    const h = M.models3dPageHtml(list());
    expect(h).toContain('<th>題名</th><th>提供元</th><th>ライセンス</th><th>種類</th><th>状態</th><th>操作</th>');
    expect(rowOf(h, 'omnh-allosaurus')).toContain('<td>埋め込み</td>');
    expect(rowOf(h, 'omnh-allosaurus')).not.toContain('<button');
    expect(rowOf(h, ROVER)).toContain('<td>取り込み済み（4.8 MiB・2026/11/7）</td>');
    expect(rowOf(h, ROVER)).toMatch(/<button[^>]*data-m3d-fetch="1"[^>]*>取り直す<\/button>/);
    expect(rowOf(h, 'nasa-x')).toContain('<td>取り込み済みだがファイルが無い（取り直してください）</td>');
    expect(rowOf(h, 'nasa-x')).toMatch(/>取り直す<\/button>/);
    expect(rowOf(h, 'nasa-iss')).toContain('<td>未取り込み</td>');
    expect(rowOf(h, 'nasa-iss')).toMatch(/>取り込む<\/button>/);
    expect(rowOf(h, 'dbcls-bodyparts3d')).toContain('<td>取り込めない（配布の url が無い）</td>');
    expect(rowOf(h, 'dbcls-bodyparts3d')).not.toContain('<button');
    // 題名は page_url（https:// の時だけ）へのリンク
    expect(rowOf(h, ROVER)).toContain('<a href="https://science.nasa.gov/x/" target="_blank" rel="noopener noreferrer">探査車</a>');
    expect(rowOf(h, 'dbcls-bodyparts3d')).not.toContain('javascript:');
    expect(n(h, /<button/g)).toBe(3);
  });

  it('読み込み中・失敗（再試行ボタン）の 2 状態', () => {
    expect(M.models3dLoadingHtml()).toContain('読み込み中…');
    const e = M.models3dErrorHtml('<b>x</b>');
    expect(e).toContain('読み込めませんでした: &lt;b&gt;x&lt;/b&gt;');
    expect(e).toContain('id="m3d-retry"');
  });

  it('toast の文: fetched は「取り込みました（MiB）」・unchanged は「変わっていません」。失敗は日本語', () => {
    expect(M.model3dFetchToast({ status: 'fetched', bytes: 4987176 })).toBe('取り込みました（4.8 MiB）');
    expect(M.model3dFetchToast({ status: 'unchanged', bytes: 4987176 })).toBe('変わっていません');
    expect(M.model3dFetchErrorText({ error: 'too_large' }, 'x')).toBe('24 MiB を超えています');
    expect(M.model3dFetchErrorText({ error: 'bad_glb:extension' }, 'x')).toBe('GLB の形が合いません（extension）');
    expect(M.model3dFetchErrorText({ error: 'fetch_failed:500' }, 'x')).toBe('提供元から取れませんでした（500）');
    expect(M.model3dFetchErrorText({ error: 'not_download' }, '応答の文')).toBe('応答の文');
  });
});

// ---------------------------------------------------------------------------------------------
// /admin の CSP・style の hash・.wasm の content-type・serve.mjs の CSP

const adminEnv = () =>
  ({
    ACCESS_DEV_BYPASS_EMAIL: 'ops@example.invalid',
    ASSETS: { fetch: async () => new Response('x', { status: 200, headers: { 'content-type': 'application/octet-stream' } }) },
  }) as unknown as Env;
const adminCsp = async (path = '/admin/') => {
  const res = await worker.fetch(new Request(`http://localhost${path}`), adminEnv(), exec);
  return { res, csp: res.headers.get('content-security-policy') ?? '' };
};
const directive = (csp: string, name: string) => csp.split(';').map((x) => x.trim()).find((x) => x.split(/\s+/)[0] === name) ?? '';

describe('§AJ2-5 9・10 /admin の CSP', () => {
  it("script-src 'wasm-unsafe-eval'・worker-src blob:・connect-src 'self' blob:・style-src の hash。img-src・frame-src は v1 のまま", async () => {
    const { csp } = await adminCsp();
    expect(directive(csp, 'script-src')).toBe("script-src 'self' 'wasm-unsafe-eval'");
    expect(directive(csp, 'worker-src')).toBe('worker-src blob:');
    expect(directive(csp, 'connect-src')).toBe("connect-src 'self' blob:");
    expect(directive(csp, 'style-src')).toMatch(/^style-src 'self' 'sha256-[A-Za-z0-9+/]{43}='$/);
    expect(directive(csp, 'img-src')).toBe("img-src 'self' data:");
    expect(directive(csp, 'frame-src')).toBe("frame-src 'self' https://www.youtube-nocookie.com https://sketchfab.com https://3d-api.si.edu");
    expect(directive(csp, 'default-src')).toBe("default-src 'self'");
    expect(csp).not.toContain('unsafe-inline');
  });

  it('MODEL_VIEWER_STYLE_HASH が vendor の bundle の <style> 本文の sha256（base64）と一致する', async () => {
    const s = readFileSync(new URL('../public/admin/vendor/model-viewer.min.js', import.meta.url), 'utf8');
    const i = s.indexOf('<style>');
    const j = s.indexOf('</style>', i);
    expect(i).toBeGreaterThan(0);
    expect(j).toBeGreaterThan(i);
    const hash = 'sha256-' + createHash('sha256').update(s.slice(i + 7, j), 'utf8').digest('base64');
    const { csp } = await adminCsp();
    expect(directive(csp, 'style-src')).toBe(`style-src 'self' '${hash}'`);
    const index = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
    expect(index).toContain(`const MODEL_VIEWER_STYLE_HASH = '${hash}';`);
  });

  it('.wasm は application/wasm（ASSETS の content-type を上書き）。他は ASSETS のまま', async () => {
    expect((await adminCsp('/admin/vendor/draco/draco_decoder.wasm')).res.headers.get('content-type')).toBe('application/wasm');
    expect((await adminCsp('/admin/vendor/model-viewer.min.js')).res.headers.get('content-type')).toBe('application/octet-stream');
  });

  it('serve.mjs の CSP 文字列が Worker と同じ。TYPES に .wasm', async () => {
    const serve = readFileSync(new URL('./review-preview/serve.mjs', import.meta.url), 'utf8');
    const m = /^const CSP = "([^"]+)";$/m.exec(serve);
    expect(m).not.toBeNull();
    const { csp } = await adminCsp();
    expect(m![1]).toBe(csp);
    expect(serve).toContain("'.wasm': 'application/wasm'");
  });

  it('index.html: nav に「立体モデル」（お題の棚の後）と、admin.js の後に model-viewer の module', () => {
    const html = readFileSync(new URL('../public/admin/index.html', import.meta.url), 'utf8');
    expect(html).toContain('<a href="#/topics">お題の棚</a>\n      <a href="#/models3d">立体モデル</a>');
    expect(html.indexOf('<script type="module" src="/admin/vendor/model-viewer.min.js"></script>')).toBeGreaterThan(html.indexOf('<script src="/admin/admin.js"></script>'));
  });
});
