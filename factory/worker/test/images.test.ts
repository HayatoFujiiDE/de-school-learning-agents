// 画像の読み取り対応（契約 §M 段階 1）の受け入れ (m1)〜(m6)。
// 取り込み・配信は node:sqlite の実 DB + R2 の Map + stub の port（files.list は本物と同じく basename だけを返す §E-0）。
// fixture のバイナリは最小の正しい png / webp をテスト内で作る（§M-6）。
import type { DatabaseSync } from 'node:sqlite';
import { deflateSync } from 'node:zlib';
import { beforeEach, describe, expect, it } from 'vitest';
import type { FactoryPort, FileMeta, Page } from '../src/anthropic';
import { validateOutputs } from '../src/checks/schema';
import type { Env } from '../src/env';
import { CUSTOM_TOOL_UNAVAILABLE_MESSAGE, reconcileJob } from '../src/jobs';
import { libraryFile, serveVersionFile } from '../src/routes/library';
import { d1, migratedDb, one } from './d1-shim';
import { goodFiles, goodMaterial } from './helpers';

const T = '2026-11-04T00:00:00.000Z';
const no = () => {
  throw new Error('not used in this test');
};
const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1);

// ---- 最小の正しい画像 ----
function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (const x of b) {
    c ^= x;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
/** 1x1 のグレースケール PNG（シグネチャ + IHDR + IDAT + IEND。数十バイト） */
function tinyPng(): Uint8Array {
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, 1);
  dv.setUint32(4, 1);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
  const idat = new Uint8Array(deflateSync(Buffer.from([0, 0]))); // filter 0 + 1 画素
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', new Uint8Array())];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}
/** 1x1 の可逆 WebP（RIFF / WEBP / VP8L。34 バイト） */
const tinyWebp = (): Uint8Array => new Uint8Array(Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64'));

/** files に png / webp を足した成果物 */
function imageOutputs(): Map<string, Uint8Array> {
  const m = goodMaterial();
  const part = (m.parts as Array<Record<string, unknown>>)[0];
  part.files = [
    { path: 'parts/p1/figure-1.svg', role: 'figure' },
    { path: 'parts/p1/photo-1.png', role: 'figure' },
    { path: 'parts/p1/photo-2.webp', role: 'figure' },
  ];
  const files = goodFiles(m);
  files.set('parts/p1/photo-1.png', tinyPng());
  files.set('parts/p1/photo-2.webp', tinyWebp());
  return files;
}

// ---- DB / R2 / port ----
let db: DatabaseSync;
let r2: Map<string, Uint8Array>;
let env: Env;

beforeEach(() => {
  db = migratedDb();
  r2 = new Map();
  env = {
    DB: d1(db),
    R2: {
      async put(k: string, v: Uint8Array) {
        r2.set(k, new Uint8Array(v));
      },
      async get(k: string) {
        const b = r2.get(k);
        return b ? { body: b.slice(), arrayBuffer: async () => b.slice().buffer, text: async () => new TextDecoder().decode(b) } : null;
      },
      async list(o: { prefix?: string }) {
        const keys = [...r2.keys()].filter((k) => k.startsWith(o.prefix ?? '')).sort();
        return { objects: keys.map((key) => ({ key })), truncated: false };
      },
      async delete(keys: string | string[]) {
        for (const k of Array.isArray(keys) ? keys : [keys]) r2.delete(k);
      },
    },
  } as unknown as Env;
});

function seedRunningJob(phase: 'making' | 'questions' = 'making') {
  db.prepare(
    "INSERT INTO materials (id, slug, title, kinds_json, work_status, publish_status, brief_md, created_at, updated_at) VALUES ('m1', 'm-1', 't', '[3]', 'making', 'none', 'b', ?, ?)",
  ).run(T, T);
  db.prepare(
    `INSERT INTO factory_jobs (id, material_id, kind, model, phase, status, session_id, brief_md, created_at, updated_at)
     VALUES ('j1', 'm1', 'draft', 'claude-sonnet-5-5', ?, 'running', 'sesn_1', 'b', ?, ?)`,
  ).run(phase, T, T);
}

function makePort(o: { outputs?: Map<string, Uint8Array>; events: unknown[]; sent?: unknown[] }): FactoryPort {
  const outputs = o.outputs ?? new Map<string, Uint8Array>();
  const metas: FileMeta[] = [...outputs.keys()].map((p, i) => ({
    id: `file_${i}`,
    filename: basename(p),
    size_bytes: outputs.get(p)!.byteLength,
    created_at: new Date(Date.parse(T) + i).toISOString(),
  }));
  const bodies = new Map(metas.map((m, i) => [m.id, [...outputs.values()][i]]));
  return {
    isFake: true,
    createSession: no,
    async retrieveSession(id) {
      return { id, status: 'idle', listCostCents: null, metadata: {}, created_at: T };
    },
    listSessionsPage: no,
    async listEventsPage(_id, q): Promise<Page<unknown>> {
      return { data: q.order === 'desc' ? [...o.events].reverse() : o.events, next: null };
    },
    async sendEvents(_id, evs) {
      for (const e of evs) o.sent?.push(e);
    },
    async archiveSession() {},
    async listFilesPage(): Promise<Page<FileMeta>> {
      return { data: metas, next: null };
    },
    async downloadFile(fileId) {
      const b = bodies.get(fileId);
      if (!b) throw new Error('no file');
      return b;
    },
    createMessage: no,
    createBatch: no,
    retrieveBatch: no,
    batchResults: no,
    listBatchesPage: no,
    xaiResponses: no,
  };
}

const DONE_EVENTS = [
  { id: 'sevt_1', type: 'user.define_outcome' },
  { id: 'sevt_2', type: 'span.outcome_evaluation_end', result: 'satisfied', explanation: 'ok' },
  { id: 'sevt_3', type: 'session.status_idle', stop_reason: { type: 'end_turn' } },
];

describe('§M 画像の読み取り対応（段階 1）', () => {
  it('(m1) files の png / webp が通り、版に入り、public_paths に入る', async () => {
    const pure = validateOutputs(imageOutputs());
    expect(pure.ok).toBe(true);
    if (pure.ok) expect(pure.publicPaths).toEqual(expect.arrayContaining(['parts/p1/photo-1.png', 'parts/p1/photo-2.webp']));

    seedRunningJob();
    const result = await reconcileJob(env, makePort({ outputs: imageOutputs(), events: DONE_EVENTS }), 'j1', { deadline: Date.now() + 25_000 });
    expect(result).toBe('versioned');
    const v = one(db, "SELECT status, public_paths_json FROM material_versions WHERE job_id = 'j1'");
    expect(v.status).toBe('review');
    expect(JSON.parse(String(v.public_paths_json))).toEqual(expect.arrayContaining(['parts/p1/photo-1.png', 'parts/p1/photo-2.webp', 'parts/p1/figure-1.svg']));
    expect(r2.get('materials/m1/j1/parts/p1/photo-1.png')).toEqual(tinyPng());
    expect(r2.get('materials/m1/j1/parts/p1/photo-2.webp')).toEqual(tinyWebp());
  });

  it('(m2) variants の png / webp は path_outside_part で落ちる（variants は広げない）', () => {
    for (const [ext, bytes] of [
      ['png', tinyPng()],
      ['webp', tinyWebp()],
    ] as const) {
      const m = goodMaterial();
      const part = (m.parts as Array<Record<string, unknown>>)[0];
      const vars = part.variants as Array<Record<string, unknown>>;
      vars[0].path = `parts/p1/elementary-short.${ext}`;
      const files = goodFiles(m);
      files.set(`parts/p1/elementary-short.${ext}`, bytes);
      expect(validateOutputs(files)).toEqual({ ok: false, reason: 'invalid_outputs', detail: `path_outside_part:parts/p1/elementary-short.${ext}` });
    }
  });

  it('(m3) 拡張子と先頭バイトが合わない png / webp は bad_image', () => {
    const cases: Array<[string, Uint8Array]> = [
      ['parts/p1/photo-1.png', tinyWebp()], // webp の中身に .png
      ['parts/p1/photo-2.webp', tinyPng()], // png の中身に .webp
      ['parts/p1/photo-1.png', new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')],
      ['parts/p1/photo-2.webp', new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49, 0x20])], // RIFF だが AVI
      ['parts/p1/photo-1.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47])], // シグネチャの途中で切れている
    ];
    for (const [path, bytes] of cases) {
      const files = imageOutputs();
      files.set(path, bytes);
      expect(validateOutputs(files)).toEqual({ ok: false, reason: 'invalid_outputs', detail: `bad_image:${path}` });
    }
  });

  it('(m4) 配信のヘッダが §M-3 どおり（library と確認画面の共通関数）・承認前は 404', async () => {
    const prefix = 'materials/m1/j1/';
    r2.set(prefix + 'parts/p1/photo-1.png', tinyPng());
    r2.set(prefix + 'parts/p1/photo-2.webp', tinyWebp());
    const paths = JSON.stringify(['claims.json', 'parts/p1/photo-1.png', 'parts/p1/photo-2.webp']);
    db.prepare(
      "INSERT INTO materials (id, slug, title, kinds_json, work_status, publish_status, brief_md, created_at, updated_at) VALUES ('m1', 'm-1', 't', '[3]', 'review', 'none', 'b', ?, ?)",
    ).run(T, T);
    db.prepare(
      "INSERT INTO factory_jobs (id, material_id, kind, model, phase, status, session_id, brief_md, created_at, updated_at) VALUES ('j1', 'm1', 'draft', 'x', 'making', 'done', 'sesn_1', 'b', ?, ?)",
    ).run(T, T);
    db.prepare(
      `INSERT INTO material_versions (id, material_id, version, job_id, session_id, r2_prefix, content_sha256, material_json, claims_json, adapt_rules_md,
         checks_json, public_paths_json, status, created_at)
       VALUES ('v1', 'm1', 1, 'j1', 'sesn_1', ?, 'x', '{}', '{}', '', '{}', ?, 'review', ?)`,
    ).run(prefix, paths, T);

    // 確認画面の配信（serveVersionFile をそのまま使う）
    const row = { r2_prefix: prefix, public_paths_json: paths };
    for (const [p, type] of [
      ['parts/p1/photo-1.png', 'image/png'],
      ['parts/p1/photo-2.webp', 'image/webp'],
    ] as const) {
      const res = await serveVersionFile(env, row, p);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe(type);
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
    }

    // 承認前（review 版・配信なし）は library から 404
    expect((await libraryFile(env, 'v1', 'parts/p1/photo-1.png')).status).toBe(404);
    expect((await libraryFile(env, 'v1', 'parts/p1/photo-2.webp')).status).toBe(404);

    // 承認・現行・配信中になれば同じヘッダで返る
    db.prepare("UPDATE material_versions SET status = 'approved' WHERE id = 'v1'").run();
    db.prepare("UPDATE materials SET publish_status = 'available', current_version_id = 'v1', work_status = 'idle' WHERE id = 'm1'").run();
    const ok = await libraryFile(env, 'v1', 'parts/p1/photo-2.webp');
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('image/webp');
    expect(ok.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
    expect(new Uint8Array(await ok.arrayBuffer())).toEqual(tinyWebp());
    // manifest に無いパスは配信中でも 404（条件は変えない）
    r2.set(prefix + 'parts/p1/hidden.png', tinyPng());
    expect((await libraryFile(env, 'v1', 'parts/p1/hidden.png')).status).toBe(404);
  });

  it('(m5) 既存の svg / html を variants に持つ成果物は今までどおり通る', () => {
    expect(validateOutputs(goodFiles()).ok).toBe(true);
    const m = goodMaterial();
    const part = (m.parts as Array<Record<string, unknown>>)[0];
    const vars = part.variants as Array<Record<string, unknown>>;
    vars.push({ audience: 'elementary', length: 'short', interest: null, game: true, path: 'parts/p1/app.html' });
    vars.push({ audience: 'secondary', length: 'long', interest: null, game: false, path: 'parts/p1/figure-2.svg' });
    part.files = [
      { path: 'parts/p1/figure-1.svg', role: 'figure' },
      { path: 'parts/p1/app.html', role: 'app' },
    ];
    const files = goodFiles(m);
    files.set('parts/p1/app.html', new TextEncoder().encode('<!doctype html><p>app</p>'));
    files.set('parts/p1/figure-2.svg', new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'));
    const r = validateOutputs(files);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.publicPaths).toEqual(expect.arrayContaining(['parts/p1/app.html', 'parts/p1/figure-2.svg', 'parts/p1/figure-1.svg']));
  });

  it('(m6) generate_image の custom_tool_use に is_error の結果が 1 回だけ返り、deny 数に数える', async () => {
    seedRunningJob();
    const events = [
      { id: 'sevt_1', type: 'user.define_outcome' },
      { id: 'sevt_ct_1', type: 'agent.custom_tool_use', name: 'generate_image', input: { prompt: 'redstone' } },
      { id: 'sevt_tu_1', type: 'agent.tool_use', name: 'bash', input: { command: 'curl https://example.com' }, evaluated_permission: 'ask' },
      { id: 'sevt_idle', type: 'session.status_idle', stop_reason: { type: 'requires_action', event_ids: ['sevt_ct_1', 'sevt_tu_1'] } },
    ];
    const sent: unknown[] = [];
    const port = makePort({ events, sent });
    expect(await reconcileJob(env, port, 'j1', { deadline: Date.now() + 25_000 })).toBe('denied:2');
    // 2 回目の reconcile では送り直さない
    expect(await reconcileJob(env, port, 'j1', { deadline: Date.now() + 25_000 })).toBe('already_denied');

    const customResults = sent.filter((e) => (e as { type: string }).type === 'user.custom_tool_result');
    expect(customResults).toEqual([
      { type: 'user.custom_tool_result', custom_tool_use_id: 'sevt_ct_1', content: [{ type: 'text', text: CUSTOM_TOOL_UNAVAILABLE_MESSAGE }], is_error: true },
    ]);
    expect(CUSTOM_TOOL_UNAVAILABLE_MESSAGE).toBe('画像生成はまだ使えません。図は SVG で描いてください。');
    // 通常の tool_use は従来どおり tool_confirmation の deny（custom tool に tool_confirmation は送らない）
    const confirmations = sent.filter((e) => (e as { type: string }).type === 'user.tool_confirmation') as Array<{ tool_use_id: string; result: string }>;
    expect(confirmations.map((c) => [c.tool_use_id, c.result])).toEqual([['sevt_tu_1', 'deny']]);
    expect(sent).toHaveLength(2);
    const j = one(db, "SELECT status, deny_count, denied_event_ids_json FROM factory_jobs WHERE id = 'j1'");
    expect(j.status).toBe('running');
    expect(j.deny_count).toBe(2);
    expect(JSON.parse(String(j.denied_event_ids_json)).sort()).toEqual(['sevt_ct_1', 'sevt_tu_1']);
  });
});
