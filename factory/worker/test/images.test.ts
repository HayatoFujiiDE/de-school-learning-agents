// 画像の読み取り対応（契約 §M 段階 1）の受け入れ (m1)〜(m6)。
// 取り込み・配信は node:sqlite の実 DB + R2 の Map + stub の port（files.list は本物と同じく basename だけを返す §E-0）。
// fixture のバイナリは最小の正しい png / webp をテスト内で作る（§M-6）。
import type { DatabaseSync } from 'node:sqlite';
import { deflateSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FactoryPort, FileMeta, Page } from '../src/anthropic';
import { validateOutputs } from '../src/checks/schema';
import type { Env } from '../src/env';
import { BLOCKED_RECOUNT_MS, BLOCKED_UNRESOLVED_MAX, CUSTOM_TOOL_UNAVAILABLE_MESSAGE, MAX_PAGES, reconcileJob } from '../src/jobs';
import { libraryFile, serveVersionFile } from '../src/routes/library';
import { SCAN_MAX_STALLS } from '../src/scan';
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

function makePort(o: {
  outputs?: Map<string, Uint8Array>;
  events: unknown[];
  sent?: unknown[];
  pageSize?: number;
  /** session の status（既定 idle。テストの途中で書き換えられる） */
  status?: { value: string };
  /** events.list が呼ばれるたびに呼ぶ（呼ばれた回数を渡す） */
  onEventsPage?: (n: number) => void;
}): FactoryPort {
  let eventCalls = 0;
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
      return { id, status: o.status?.value ?? 'idle', listCostCents: null, metadata: {}, created_at: T };
    },
    listSessionsPage: no,
    async listEventsPage(_id, q): Promise<Page<unknown>> {
      o.onEventsPage?.(++eventCalls);
      const all = q.order === 'desc' ? [...o.events].reverse() : o.events;
      if (!o.pageSize) return { data: all, next: null };
      const off = q.page ? Number(q.page) : 0;
      const end = off + o.pageSize;
      return { data: all.slice(off, end), next: end < all.length ? String(end) : null };
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
      ['parts/p1/photo-2.webp', (() => { const b = tinyWebp(); b[3] = 0x58; return b; })()], // WEBP は正しいが先頭が RIFX
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

    // 承認・現行・配信中の 3 条件を 1 つずつ外すと 404（配信の可否の条件は変えない §M-3）
    const setState = (approved: boolean, current: boolean, available: boolean) => {
      db.prepare('UPDATE material_versions SET status = ? WHERE id = ?').run(approved ? 'approved' : 'review', 'v1');
      db.prepare('UPDATE materials SET current_version_id = ?, publish_status = ?, work_status = ? WHERE id = ?').run(
        current ? 'v1' : null,
        available ? 'available' : 'stopped',
        'idle',
        'm1',
      );
    };
    for (const [approved, current, available] of [
      [false, true, true],
      [true, false, true],
      [true, true, false],
    ] as const) {
      setState(approved, current, available);
      for (const p of ['parts/p1/photo-1.png', 'parts/p1/photo-2.webp'])
        expect((await libraryFile(env, 'v1', p)).status, `approved=${approved} current=${current} available=${available} ${p}`).toBe(404);
    }

    // 3 条件がそろえば同じヘッダで返る
    setState(true, true, true);
    const okPng = await libraryFile(env, 'v1', 'parts/p1/photo-1.png');
    expect(okPng.status).toBe(200);
    expect(okPng.headers.get('content-type')).toBe('image/png');
    expect(okPng.headers.get('x-content-type-options')).toBe('nosniff');
    expect(okPng.headers.get('cache-control')).toBe('no-store');
    expect(okPng.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
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

  it('(m5) svg variant の本文検査（禁止語・主張 id 参照）は今までどおり走り、png のバイト列は文字として検査しない', async () => {
    const enc = new TextEncoder();
    const m = goodMaterial();
    const part = (m.parts as Array<Record<string, unknown>>)[0];
    (part.variants as Array<Record<string, unknown>>).push({ audience: 'secondary', length: 'long', interest: null, game: false, path: 'parts/p1/figure-2.svg' });
    part.files = [
      { path: 'parts/p1/figure-1.svg', role: 'figure' },
      { path: 'parts/p1/photo-1.png', role: 'figure' },
    ];
    const files = goodFiles(m);
    files.set('parts/p1/figure-2.svg', enc.encode('<svg xmlns="http://www.w3.org/2000/svg"><text>点数 [c99]</text></svg>'));
    // 正しい png の後ろに、同じ禁止語（UTF-8）と ASCII の参照 "[c99]" をバイトとして持たせる
    const tail = enc.encode('点数 [c99]');
    const png = new Uint8Array(tinyPng().length + tail.length);
    png.set(tinyPng());
    png.set(tail, tinyPng().length);
    files.set('parts/p1/photo-1.png', png);

    seedRunningJob();
    expect(await reconcileJob(env, makePort({ outputs: files, events: DONE_EVENTS }), 'j1', { deadline: Date.now() + 25_000 })).toBe('versioned');
    const checks = JSON.parse(String(one(db, "SELECT checks_json FROM material_versions WHERE job_id = 'j1'").checks_json)) as {
      forbidden: Array<{ path: string; word: string }>;
      missing_claim_refs: Array<{ path: string; ref: string }>;
    };
    expect(checks.forbidden).toContainEqual(expect.objectContaining({ path: 'parts/p1/figure-2.svg', word: '点数' }));
    expect(checks.missing_claim_refs).toContainEqual({ path: 'parts/p1/figure-2.svg', ref: 'c99' });
    expect(checks.forbidden.filter((f) => f.path.endsWith('.png'))).toEqual([]);
    expect(checks.missing_claim_refs.filter((f) => f.path.endsWith('.png'))).toEqual([]);
  });

  // §O-8 t12（旧 t23）: (m6) の置き換え。generate_image 以外の custom tool は従来どおり is_error 1 回、generate_image は §O の登録へ
  it('(m6→t12) generate_image 以外の custom tool に is_error の結果が 1 回だけ返り deny 数に数える。generate_image は登録される（is_error を返さない）', async () => {
    seedRunningJob();
    const events = [
      { id: 'sevt_1', type: 'user.define_outcome' },
      { id: 'sevt_ct_1', type: 'agent.custom_tool_use', name: 'draw_chart', input: { prompt: 'redstone' } },
      { id: 'sevt_gi_1', type: 'agent.custom_tool_use', name: 'generate_image', input: { prompt: 'redstone' } },
      { id: 'sevt_tu_1', type: 'agent.tool_use', name: 'bash', input: { command: 'curl https://example.com' }, evaluated_permission: 'ask' },
      { id: 'sevt_idle', type: 'session.status_idle', stop_reason: { type: 'requires_action', event_ids: ['sevt_ct_1', 'sevt_gi_1', 'sevt_tu_1'] } },
    ];
    const sent: unknown[] = [];
    const port = makePort({ events, sent });
    // generate_image は入力が不正（alt 等が無い）なので refused bad_input → 同じ reconcile で is_error の結果を 1 回返す（deny_count には数えない）
    expect(await reconcileJob(env, port, 'j1', { deadline: Date.now() + 25_000 })).toBe('denied:2');
    // 2 回目の reconcile では送り直さない（generate_image の結果は fake の一覧に載らないので、行が終端のまま → 返し直す。p4a で無害）
    const before = sent.length;
    await reconcileJob(env, port, 'j1', { deadline: Date.now() + 25_000 });
    expect(sent.slice(before).filter((e) => (e as { type: string }).type === 'user.tool_confirmation')).toEqual([]);

    const customResults = sent.filter((e) => (e as { type: string }).type === 'user.custom_tool_result') as Array<{ custom_tool_use_id: string; is_error: boolean; content: unknown }>;
    expect(customResults.filter((e) => e.custom_tool_use_id === 'sevt_ct_1')).toEqual([
      { type: 'user.custom_tool_result', custom_tool_use_id: 'sevt_ct_1', content: [{ type: 'text', text: CUSTOM_TOOL_UNAVAILABLE_MESSAGE }], is_error: true },
    ]);
    expect(CUSTOM_TOOL_UNAVAILABLE_MESSAGE).toBe('画像生成はまだ使えません。図は SVG で描いてください。');
    // generate_image は CUSTOM_TOOL_UNAVAILABLE_MESSAGE を受けず、登録の結果（ここでは bad_input の断り）
    const gi = customResults.filter((e) => e.custom_tool_use_id === 'sevt_gi_1');
    expect(gi.length).toBeGreaterThanOrEqual(1);
    expect(gi[0].content).not.toEqual([{ type: 'text', text: CUSTOM_TOOL_UNAVAILABLE_MESSAGE }]);
    expect(one(db, "SELECT state, error FROM image_requests WHERE custom_tool_use_id = 'sevt_gi_1'")).toEqual({ state: 'refused', error: 'bad_input:accuracy' });
    // 通常の tool_use は従来どおり tool_confirmation の deny（custom tool に tool_confirmation は送らない）
    const confirmations = sent.filter((e) => (e as { type: string }).type === 'user.tool_confirmation') as Array<{ tool_use_id: string; result: string }>;
    expect(confirmations.map((c) => [c.tool_use_id, c.result])).toEqual([['sevt_tu_1', 'deny']]);
    const j = one(db, "SELECT status, deny_count, denied_event_ids_json FROM factory_jobs WHERE id = 'j1'");
    expect(j.status).toBe('running');
    expect(j.deny_count).toBe(2);
    expect(JSON.parse(String(j.denied_event_ids_json)).sort()).toEqual(['sevt_ct_1', 'sevt_tu_1']);
  });

  /** custom_tool_use と idle の間に filler 件の event を挟む */
  const blockedEvents = (filler: number, blockedIds = ['sevt_ct_1'], idleId = 'sevt_idle') => [
    { id: 'sevt_1', type: 'user.define_outcome' },
    { id: 'sevt_ct_1', type: 'agent.custom_tool_use', name: 'draw_chart', input: { prompt: 'x' } },
    ...Array.from({ length: filler }, (_, i) => ({ id: `sevt_f_${i}`, type: 'agent.message' })),
    { id: idleId, type: 'session.status_idle', stop_reason: { type: 'requires_action', event_ids: blockedIds } },
  ];

  for (const filler of [199, 200, 250])
    it(`(m6) idle から ${filler + 1} 件前の custom_tool_use でも custom_tool_result を返す（件数で打ち切って tool_confirmation に落とさない。ページをまたぐ）`, async () => {
      seedRunningJob();
      const sent: unknown[] = [];
      expect(await reconcileJob(env, makePort({ events: blockedEvents(filler), sent, pageSize: 100 }), 'j1', { deadline: Date.now() + 25_000 })).toBe('denied:1');
      expect(sent).toEqual([
        { type: 'user.custom_tool_result', custom_tool_use_id: 'sevt_ct_1', content: [{ type: 'text', text: CUSTOM_TOOL_UNAVAILABLE_MESSAGE }], is_error: true },
      ]);
      expect(one(db, "SELECT deny_count FROM factory_jobs WHERE id = 'j1'").deny_count).toBe(1);
    });

  describe('§M-5b 種別が分からない待ち', () => {
    const T0 = Date.parse('2026-11-04T09:00:00.000Z');
    const MIN = 60_000;
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(T0);
    });
    afterEach(() => {
      vi.useRealTimers();
    });
    const at = (ms: number) => vi.setSystemTime(T0 + ms);
    const rec = (port: FactoryPort) => reconcileJob(env, port, 'j1', { deadline: Date.now() + 25_000 });
    const waitState = () => JSON.parse(String(one(db, "SELECT reconcile_state_json FROM factory_jobs WHERE id = 'j1'").reconcile_state_json)).blocked_unresolved;

    it('何も送らず deny に数えない。同じ idle event で 5 分未満の連続 reconcile は数えず、5 分以上の間隔で 3 回目に failed', async () => {
      seedRunningJob();
      const sent: unknown[] = [];
      const port = makePort({ events: blockedEvents(3, ['sevt_missing']), sent, pageSize: 2 });
      // 同じ cron の中で何度呼ばれても 1 回目のまま
      for (let k = 0; k < 5; k++) expect(await rec(port)).toBe('blocked_unresolved:1');
      expect(waitState()).toEqual({ idle_event_id: 'sevt_idle', first_seen_at: new Date(T0).toISOString(), count: 1, next_at: new Date(T0 + BLOCKED_RECOUNT_MS).toISOString() });
      expect(one(db, "SELECT status, deny_count, last_error FROM factory_jobs WHERE id = 'j1'")).toEqual({ status: 'running', deny_count: 0, last_error: 'blocked_event_unresolved' });
      at(5 * MIN - 1);
      expect(await rec(port)).toBe('blocked_unresolved:1');
      at(5 * MIN);
      expect(await rec(port)).toBe('blocked_unresolved:2');
      at(9 * MIN);
      expect(await rec(port)).toBe('blocked_unresolved:2');
      expect(waitState()).toMatchObject({ count: 2, first_seen_at: new Date(T0).toISOString(), next_at: new Date(T0 + 10 * MIN).toISOString() });
      at(10 * MIN);
      expect(BLOCKED_UNRESOLVED_MAX).toBe(3);
      expect(await rec(port)).toBe('failed:blocked_event_unresolved');
      expect(sent).toEqual([]);
      expect(one(db, "SELECT status, error, deny_count FROM factory_jobs WHERE id = 'j1'")).toEqual({ status: 'failed', error: 'blocked_event_unresolved', deny_count: 0 });
      expect(one(db, "SELECT work_status FROM materials WHERE id = 'm1'").work_status).toBe('idle');
    });

    it('2 回数えた後に session が進んだら消え、新しい idle event の一時的に分からない id は 0 から（idle event が直接変わっても 0 から）', async () => {
      seedRunningJob();
      const sent: unknown[] = [];
      const status = { value: 'idle' };
      const events: unknown[] = blockedEvents(1, ['sevt_missing_a'], 'sevt_idle_a');
      const port = makePort({ events, sent, status });
      expect(await rec(port)).toBe('blocked_unresolved:1');
      at(5 * MIN);
      expect(await rec(port)).toBe('blocked_unresolved:2');
      // 進行（session running）で待ちの状態は消える
      status.value = 'running';
      at(6 * MIN);
      expect(await rec(port)).toBe('running');
      expect(waitState()).toBeUndefined();
      // 次の待ち（別の idle event）。前の待ちの回数を引き継がない
      status.value = 'idle';
      events.splice(0, events.length, ...blockedEvents(2, ['sevt_missing_b'], 'sevt_idle_b'));
      at(7 * MIN);
      expect(await rec(port)).toBe('blocked_unresolved:1');
      expect(waitState()).toMatchObject({ idle_event_id: 'sevt_idle_b', count: 1, first_seen_at: new Date(T0 + 7 * MIN).toISOString() });
      at(12 * MIN);
      expect(await rec(port)).toBe('blocked_unresolved:2');
      // 進行を挟まずに idle event が変わっても 0 から
      events.splice(0, events.length, ...blockedEvents(3, ['sevt_missing_c'], 'sevt_idle_c'));
      at(17 * MIN);
      expect(await rec(port)).toBe('blocked_unresolved:1');
      expect(waitState()).toMatchObject({ idle_event_id: 'sevt_idle_c', count: 1 });
      expect(one(db, "SELECT status, deny_count FROM factory_jobs WHERE id = 'j1'")).toEqual({ status: 'running', deny_count: 0 });
      expect(sent).toEqual([]);
    });

    it('end_turn 等の別の止まり方に進んだら待ちの状態は消える', async () => {
      seedRunningJob('questions');
      const events: unknown[] = blockedEvents(1, ['sevt_missing'], 'sevt_idle_a');
      const port = makePort({ events, sent: [] });
      expect(await rec(port)).toBe('blocked_unresolved:1');
      events.push({ id: 'sevt_q', type: 'user.define_outcome' }, { id: 'sevt_idle_end', type: 'session.status_idle', stop_reason: { type: 'end_turn' } });
      at(1 * MIN);
      await rec(port);
      expect(waitState()).toBeUndefined();
    });

    it('走査が時間切れで途中になっても、次の reconcile は保存した続き位置から読み、custom_tool_result を返す', async () => {
      seedRunningJob();
      const sent: unknown[] = [];
      let run = 1;
      const calls: Record<number, number> = { 1: 0, 2: 0 };
      // desc で 1 ページ 1 件: idle, filler×4, custom_tool_use → 6 ページ。1 回目は 3 ページ目を返した直後に締め切りを過ぎる
      const port = makePort({
        events: blockedEvents(4),
        sent,
        pageSize: 1,
        onEventsPage: () => {
          calls[run] += 1;
          if (run === 1 && calls[1] === 3) at(21_000);
        },
      });
      expect(await rec(port)).toBe('deferred');
      expect(sent).toEqual([]);
      const saved = JSON.parse(String(one(db, "SELECT reconcile_state_json FROM factory_jobs WHERE id = 'j1'").reconcile_state_json)).scan.idle;
      expect(saved).toMatchObject({ pages: 3, done: false, cursor: '3' });
      run = 2;
      at(60_000);
      expect(await rec(port)).toBe('denied:1');
      // 先頭の確認 1 ページ + 続きの 3 ページ（先頭から読み直すなら 6 ページ）
      expect(calls[2]).toBe(4);
      expect(sent).toEqual([
        { type: 'user.custom_tool_result', custom_tool_use_id: 'sevt_ct_1', content: [{ type: 'text', text: CUSTOM_TOOL_UNAVAILABLE_MESSAGE }], is_error: true },
      ]);
    });
  });

  it('(m6) 走査のページ上限の境目: MAX_PAGES ページ目で見つかれば返し、その先なら scan_too_many_pages で failed（誤った種別は送らない）', async () => {
    expect(MAX_PAGES).toBe(500);
    // desc で 1 ページ 1 件。idle が 1 ページ目、custom_tool_use は filler + 2 ページ目
    seedRunningJob();
    const sent: unknown[] = [];
    expect(await reconcileJob(env, makePort({ events: blockedEvents(MAX_PAGES - 2), sent, pageSize: 1 }), 'j1', { deadline: Date.now() + 60_000 })).toBe('denied:1');
    expect(sent).toEqual([
      { type: 'user.custom_tool_result', custom_tool_use_id: 'sevt_ct_1', content: [{ type: 'text', text: CUSTOM_TOOL_UNAVAILABLE_MESSAGE }], is_error: true },
    ]);

    db = migratedDb();
    env = { ...env, DB: d1(db) } as Env;
    seedRunningJob();
    const sent2: unknown[] = [];
    expect(await reconcileJob(env, makePort({ events: blockedEvents(MAX_PAGES - 1), sent: sent2, pageSize: 1 }), 'j1', { deadline: Date.now() + 60_000 })).toBe('failed:scan_too_many_pages');
    expect(sent2).toEqual([]);
  }, 60_000);

  it('(m6) 分かった id だけ返し、分からなかった id は次の reconcile で先頭から探し直す（見えたら custom_tool_result）', async () => {
    seedRunningJob();
    const sent: unknown[] = [];
    const events: unknown[] = [
      { id: 'sevt_1', type: 'user.define_outcome' },
      { id: 'sevt_tu_1', type: 'agent.tool_use', name: 'bash', input: {}, evaluated_permission: 'ask' },
      { id: 'sevt_idle', type: 'session.status_idle', stop_reason: { type: 'requires_action', event_ids: ['sevt_ct_1', 'sevt_tu_1'] } },
    ];
    const port = makePort({ events, sent });
    expect(await reconcileJob(env, port, 'j1', { deadline: Date.now() + 25_000 })).toBe('denied:1');
    expect(sent).toEqual([{ type: 'user.tool_confirmation', tool_use_id: 'sevt_tu_1', result: 'deny', deny_message: expect.any(String) }]);
    expect(one(db, "SELECT deny_count FROM factory_jobs WHERE id = 'j1'").deny_count).toBe(1);

    // 先頭 event（idle）は同じまま、custom_tool_use が一覧に現れる → 保存済み集計を再利用せず探し直して返す
    events.splice(1, 0, { id: 'sevt_ct_1', type: 'agent.custom_tool_use', name: 'draw_chart', input: {} });
    expect(await reconcileJob(env, port, 'j1', { deadline: Date.now() + 25_000 })).toBe('denied:1');
    expect(sent.slice(1)).toEqual([
      { type: 'user.custom_tool_result', custom_tool_use_id: 'sevt_ct_1', content: [{ type: 'text', text: CUSTOM_TOOL_UNAVAILABLE_MESSAGE }], is_error: true },
    ]);
    const j = one(db, "SELECT deny_count, reconcile_state_json FROM factory_jobs WHERE id = 'j1'");
    expect(j.deny_count).toBe(2);
    expect(JSON.parse(String(j.reconcile_state_json)).blocked_unresolved).toBeUndefined();
    expect(await reconcileJob(env, port, 'j1', { deadline: Date.now() + 25_000 })).toBe('already_denied');
    expect(sent).toHaveLength(2);
  });
});

describe('Issue #1 requires_action: 送信後・保存前に落ちても送り直さない', () => {
  const rec = (port: FactoryPort) => reconcileJob(env, port, 'j1', { deadline: Date.now() + 25_000 });
  /** 落ちた reconcile の lease が切れた状態にする（次の reconcile が lease を取れるように） */
  const expireLease = () => db.prepare("UPDATE factory_jobs SET reconcile_token = NULL, reconcile_until = NULL WHERE id = 'j1'").run();

  /**
   * sendEvents は成功し（API は返答 event を一覧に記録する）、その直後に lease を奪われて denied_event_ids_json の CAS が失敗する port。
   * record: 送った event から一覧に載る返答 event を作る
   */
  function stealAfterSendPort(events: unknown[], sent: unknown[], record: (e: Record<string, unknown>, i: number) => unknown) {
    const port = makePort({ events, sent });
    let stealNext = true;
    const send = port.sendEvents.bind(port);
    port.sendEvents = async (id, evs, call) => {
      await send(id, evs, call);
      (evs as unknown as Array<Record<string, unknown>>).forEach((e, i) => events.push(record(e, i)));
      if (stealNext) {
        stealNext = false;
        db.prepare("UPDATE factory_jobs SET reconcile_token = 'other' WHERE id = 'j1'").run();
      }
    };
    return port;
  }

  it('(t1) tool_confirmation の deny を送った後に保存の CAS が失敗 → 次の reconcile は送らずに denied に入れ、deny 数に数える', async () => {
    seedRunningJob();
    const events: unknown[] = [
      { id: 'sevt_1', type: 'user.define_outcome' },
      { id: 'sevt_tu_1', type: 'agent.tool_use', name: 'bash', input: {}, evaluated_permission: 'ask' },
      { id: 'sevt_idle', type: 'session.status_idle', stop_reason: { type: 'requires_action', event_ids: ['sevt_tu_1'] } },
    ];
    const sent: unknown[] = [];
    const port = stealAfterSendPort(events, sent, (e, i) => ({ id: `sevt_ans_${i}`, type: e.type, tool_use_id: e.tool_use_id, result: e.result }));
    expect(await rec(port)).toBe('lost_lease');
    expect(sent).toEqual([{ type: 'user.tool_confirmation', tool_use_id: 'sevt_tu_1', result: 'deny', deny_message: expect.any(String) }]);
    expect(one(db, "SELECT deny_count, denied_event_ids_json FROM factory_jobs WHERE id = 'j1'")).toEqual({ deny_count: 0, denied_event_ids_json: '[]' });

    expireLease();
    expect(await rec(port)).toBe('already_answered:1');
    expect(sent).toHaveLength(1);
    const j = one(db, "SELECT status, deny_count, denied_event_ids_json FROM factory_jobs WHERE id = 'j1'");
    expect(j).toEqual({ status: 'running', deny_count: 1, denied_event_ids_json: JSON.stringify(['sevt_tu_1']) });
    // 以降は従来どおり already_denied（数え直さない）
    expect(await rec(port)).toBe('already_denied');
    expect(sent).toHaveLength(1);
    expect(one(db, "SELECT deny_count FROM factory_jobs WHERE id = 'j1'").deny_count).toBe(1);
  });

  it('(t2) custom_tool_result の is_error を送った後に保存の CAS が失敗 → 次の reconcile は送らずに denied に入れ、deny 数に数える', async () => {
    seedRunningJob();
    const events: unknown[] = [
      { id: 'sevt_1', type: 'user.define_outcome' },
      { id: 'sevt_ct_1', type: 'agent.custom_tool_use', name: 'draw_chart', input: {} },
      { id: 'sevt_idle', type: 'session.status_idle', stop_reason: { type: 'requires_action', event_ids: ['sevt_ct_1'] } },
    ];
    const sent: unknown[] = [];
    const port = stealAfterSendPort(events, sent, (e, i) => ({ id: `sevt_ans_${i}`, type: e.type, custom_tool_use_id: e.custom_tool_use_id, is_error: e.is_error }));
    expect(await rec(port)).toBe('lost_lease');
    expect(sent).toEqual([
      { type: 'user.custom_tool_result', custom_tool_use_id: 'sevt_ct_1', content: [{ type: 'text', text: CUSTOM_TOOL_UNAVAILABLE_MESSAGE }], is_error: true },
    ]);
    expect(one(db, "SELECT deny_count FROM factory_jobs WHERE id = 'j1'").deny_count).toBe(0);

    expireLease();
    expect(await rec(port)).toBe('already_answered:1');
    expect(sent).toHaveLength(1);
    expect(one(db, "SELECT deny_count, denied_event_ids_json FROM factory_jobs WHERE id = 'j1'")).toEqual({
      deny_count: 1,
      denied_event_ids_json: JSON.stringify(['sevt_ct_1']),
    });
  });

  it('(t2b) 2 件の待ちで 1 件だけ返答が記録済みなら、残りの 1 件だけ送り、両方を denied に入れて 2 と数える', async () => {
    seedRunningJob();
    const events: unknown[] = [
      { id: 'sevt_1', type: 'user.define_outcome' },
      { id: 'sevt_ct_1', type: 'agent.custom_tool_use', name: 'draw_chart', input: {} },
      { id: 'sevt_tu_1', type: 'agent.tool_use', name: 'bash', input: {}, evaluated_permission: 'ask' },
      { id: 'sevt_idle', type: 'session.status_idle', stop_reason: { type: 'requires_action', event_ids: ['sevt_ct_1', 'sevt_tu_1'] } },
      { id: 'sevt_ans_0', type: 'user.custom_tool_result', custom_tool_use_id: 'sevt_ct_1', is_error: true },
    ];
    const sent: unknown[] = [];
    expect(await rec(makePort({ events, sent }))).toBe('denied:1');
    expect(sent).toEqual([{ type: 'user.tool_confirmation', tool_use_id: 'sevt_tu_1', result: 'deny', deny_message: expect.any(String) }]);
    const j = one(db, "SELECT deny_count, denied_event_ids_json FROM factory_jobs WHERE id = 'j1'");
    expect(j.deny_count).toBe(2);
    expect(JSON.parse(String(j.denied_event_ids_json)).sort()).toEqual(['sevt_ct_1', 'sevt_tu_1']);
  });

  it('(t3) idle より古い返答（前の待ちへの返答）は数えない: 新しい待ちには通常どおり送る', async () => {
    seedRunningJob();
    const events: unknown[] = [
      { id: 'sevt_1', type: 'user.define_outcome' },
      { id: 'sevt_tu_old', type: 'agent.tool_use', name: 'bash', input: {}, evaluated_permission: 'ask' },
      { id: 'sevt_idle_old', type: 'session.status_idle', stop_reason: { type: 'requires_action', event_ids: ['sevt_tu_old'] } },
      { id: 'sevt_ans_old', type: 'user.tool_confirmation', tool_use_id: 'sevt_tu_old', result: 'deny' },
      { id: 'sevt_run', type: 'session.status_running' },
      { id: 'sevt_tu_new', type: 'agent.tool_use', name: 'bash', input: {}, evaluated_permission: 'ask' },
      { id: 'sevt_idle_new', type: 'session.status_idle', stop_reason: { type: 'requires_action', event_ids: ['sevt_tu_new'] } },
    ];
    const sent: unknown[] = [];
    expect(await rec(makePort({ events, sent }))).toBe('denied:1');
    expect(sent).toEqual([{ type: 'user.tool_confirmation', tool_use_id: 'sevt_tu_new', result: 'deny', deny_message: expect.any(String) }]);
    expect(one(db, "SELECT deny_count, denied_event_ids_json FROM factory_jobs WHERE id = 'j1'")).toEqual({
      deny_count: 1,
      denied_event_ids_json: JSON.stringify(['sevt_tu_new']),
    });
  });

  it('(t3b) idle より古い返答が新しい待ちと同じ id を指していても（人工的な境界）、古い返答では潰さず送る', async () => {
    seedRunningJob();
    const events: unknown[] = [
      { id: 'sevt_1', type: 'user.define_outcome' },
      { id: 'sevt_tu_1', type: 'agent.tool_use', name: 'bash', input: {}, evaluated_permission: 'ask' },
      { id: 'sevt_ans_old', type: 'user.tool_confirmation', tool_use_id: 'sevt_tu_1', result: 'deny' },
      { id: 'sevt_idle', type: 'session.status_idle', stop_reason: { type: 'requires_action', event_ids: ['sevt_tu_1'] } },
    ];
    const sent: unknown[] = [];
    expect(await rec(makePort({ events, sent }))).toBe('denied:1');
    expect(sent).toEqual([{ type: 'user.tool_confirmation', tool_use_id: 'sevt_tu_1', result: 'deny', deny_message: expect.any(String) }]);
  });
});

describe('Issue #1 requires_action: 返答済みの保存と deny 上限（レビュー指摘）', () => {
  const T0 = Date.parse('2026-11-04T09:00:00.000Z');
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  const at = (ms: number) => vi.setSystemTime(T0 + ms);
  const rec = (port: FactoryPort) => reconcileJob(env, port, 'j1', { deadline: Date.now() + 25_000 });
  const setDenyCount = (n: number) => db.prepare("UPDATE factory_jobs SET deny_count = ? WHERE id = 'j1'").run(n);
  const row = () => one(db, "SELECT status, error, deny_count, denied_event_ids_json, reconcile_state_json FROM factory_jobs WHERE id = 'j1'");
  /** A（tool_use）は idle より新しい返答が記録済み・B は一覧に見つからない（種別不明） */
  const mixedEvents = () => [
    { id: 'sevt_1', type: 'user.define_outcome' },
    { id: 'sevt_tu_a', type: 'agent.tool_use', name: 'bash', input: {}, evaluated_permission: 'ask' },
    { id: 'sevt_idle', type: 'session.status_idle', stop_reason: { type: 'requires_action', event_ids: ['sevt_tu_a', 'sevt_missing_b'] } },
    { id: 'sevt_ans_a', type: 'user.tool_confirmation', tool_use_id: 'sevt_tu_a', result: 'deny' },
  ];

  it('(r1) 混在: A は返答済み・B は種別不明で deny_count 8 → A を送らずに 9 と保存し too_many_denies', async () => {
    seedRunningJob();
    setDenyCount(8);
    const sent: unknown[] = [];
    expect(await rec(makePort({ events: mixedEvents(), sent }))).toBe('failed:too_many_denies');
    expect(sent).toEqual([{ type: 'user.interrupt' }]);
    const j = row();
    expect([j.status, j.error, j.deny_count, j.denied_event_ids_json]).toEqual(['failed', 'too_many_denies', 9, JSON.stringify(['sevt_tu_a'])]);
  });

  it('(r1) 混在で上限未満: A は保存して数え、B は §M-5b の待ちのまま（何も送らない）', async () => {
    seedRunningJob();
    const sent: unknown[] = [];
    expect(await rec(makePort({ events: mixedEvents(), sent }))).toBe('blocked_unresolved:1');
    expect(sent).toEqual([]);
    const j = row();
    expect([j.status, j.deny_count, j.denied_event_ids_json]).toEqual(['running', 1, JSON.stringify(['sevt_tu_a'])]);
    expect(JSON.parse(String(j.reconcile_state_json)).blocked_unresolved).toMatchObject({ idle_event_id: 'sevt_idle', count: 1 });
  });

  it('(r2) answered を持たない古い形式の scan.idle からは再開せず、先頭から走査し直して返答を見つける（送り直さない）', async () => {
    seedRunningJob();
    const events = [
      { id: 'sevt_1', type: 'user.define_outcome' },
      { id: 'sevt_tu_1', type: 'agent.tool_use', name: 'bash', input: {}, evaluated_permission: 'ask' },
      { id: 'sevt_idle', type: 'session.status_idle', stop_reason: { type: 'requires_action', event_ids: ['sevt_tu_1'] } },
      { id: 'sevt_ans_1', type: 'user.tool_confirmation', tool_use_id: 'sevt_tu_1', result: 'deny' },
    ];
    const sent: unknown[] = [];
    let run = 1;
    // desc で 1 ページ 1 件。1 回目は 1 ページ目（返答）を読んだ直後に締め切りを過ぎる
    const port = makePort({
      events,
      sent,
      pageSize: 1,
      onEventsPage: (n) => {
        if (run === 1 && n === 1) at(21_000);
      },
    });
    expect(await rec(port)).toBe('deferred');
    // 古い形式（answered を持たない集計）に書き換える
    const state = JSON.parse(String(row().reconcile_state_json));
    expect(state.scan.idle).toMatchObject({ pages: 1, done: false, cursor: '1', agg: { idle: null, answered: ['sevt_tu_1'] } });
    delete state.scan.idle.agg.answered;
    db.prepare("UPDATE factory_jobs SET reconcile_state_json = ? WHERE id = 'j1'").run(JSON.stringify(state));

    run = 2;
    at(60_000);
    expect(await rec(port)).toBe('already_answered:1');
    expect(sent).toEqual([]);
    const j = row();
    expect([j.deny_count, j.denied_event_ids_json]).toEqual([1, JSON.stringify(['sevt_tu_1'])]);
  });

  it('(r3) deny_count 9 を保存した直後に落ちても、次の reconcile で interrupt / archive / failed を行う（already_denied で戻らない）', async () => {
    seedRunningJob();
    setDenyCount(8);
    const events: unknown[] = [
      { id: 'sevt_1', type: 'user.define_outcome' },
      { id: 'sevt_tu_1', type: 'agent.tool_use', name: 'bash', input: {}, evaluated_permission: 'ask' },
      { id: 'sevt_idle', type: 'session.status_idle', stop_reason: { type: 'requires_action', event_ids: ['sevt_tu_1'] } },
    ];
    const sent: unknown[] = [];
    let archived = 0;
    const port = makePort({ events, sent });
    const send = port.sendEvents.bind(port);
    let first = true;
    port.sendEvents = async (id, evs, call) => {
      await send(id, evs, call);
      if (!first) return;
      first = false;
      events.push({ id: 'sevt_ans_1', type: 'user.tool_confirmation', tool_use_id: 'sevt_tu_1', result: 'deny' });
      // deny の送信後に締め切りを過ぎる: 件数 9 の保存（時間を見ない CAS）は通り、上限処理の extend で時間切れになる
      at(21_000);
    };
    port.archiveSession = async () => {
      archived += 1;
    };
    expect(await rec(port)).toBe('deferred');
    expect(sent).toEqual([{ type: 'user.tool_confirmation', tool_use_id: 'sevt_tu_1', result: 'deny', deny_message: expect.any(String) }]);
    expect([row().status, row().deny_count]).toEqual(['running', 9]);

    at(60_000);
    expect(await rec(port)).toBe('failed:too_many_denies');
    expect(sent.slice(1)).toEqual([{ type: 'user.interrupt' }]);
    expect(archived).toBe(1);
    const j = row();
    expect([j.status, j.error, j.deny_count]).toEqual(['failed', 'too_many_denies', 9]);
  });
});

describe('Issue #1 requires_action: 上限超えは入口で止める・旧形式の集計を捨てても stalls は残す', () => {
  const T0 = Date.parse('2026-11-04T09:00:00.000Z');
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  const at = (ms: number) => vi.setSystemTime(T0 + ms);
  const rec = (port: FactoryPort) => reconcileJob(env, port, 'j1', { deadline: Date.now() + 25_000 });
  const row = () => one(db, "SELECT status, error, deny_count, denied_event_ids_json, reconcile_state_json FROM factory_jobs WHERE id = 'j1'");

  it('(s1) 返答済み A + 種別不明 B で 8 → 9 を保存した直後に落ちる → 次の回（pending=[B]）は入口で too_many_denies', async () => {
    seedRunningJob();
    db.prepare("UPDATE factory_jobs SET deny_count = 8 WHERE id = 'j1'").run();
    const events = [
      { id: 'sevt_1', type: 'user.define_outcome' },
      { id: 'sevt_tu_a', type: 'agent.tool_use', name: 'bash', input: {}, evaluated_permission: 'ask' },
      { id: 'sevt_idle', type: 'session.status_idle', stop_reason: { type: 'requires_action', event_ids: ['sevt_tu_a', 'sevt_missing_b'] } },
      { id: 'sevt_ans_a', type: 'user.tool_confirmation', tool_use_id: 'sevt_tu_a', result: 'deny' },
    ];
    const sent: unknown[] = [];
    let run = 1;
    let archived = 0;
    // 1 回目: 走査（1 ページ）を読んだ直後に締め切りを過ぎる → 件数 9 の保存（時間を見ない CAS）は通り、上限処理の extend で時間切れ
    const port = makePort({
      events,
      sent,
      onEventsPage: () => {
        if (run === 1) at(21_000);
      },
    });
    port.archiveSession = async () => {
      archived += 1;
    };
    expect(await rec(port)).toBe('deferred');
    expect(sent).toEqual([]);
    expect([row().status, row().deny_count, row().denied_event_ids_json]).toEqual(['running', 9, JSON.stringify(['sevt_tu_a'])]);

    run = 2;
    at(60_000);
    expect(await rec(port)).toBe('failed:too_many_denies');
    expect(sent).toEqual([{ type: 'user.interrupt' }]);
    expect(archived).toBe(1);
    expect([row().status, row().error, row().deny_count]).toEqual(['failed', 'too_many_denies', 9]);
  });

  it('(s2) 件数 9 を保存した後に session が running に進んでいても、入口で too_many_denies（running で戻らない）', async () => {
    seedRunningJob();
    db.prepare("UPDATE factory_jobs SET deny_count = 8 WHERE id = 'j1'").run();
    const status = { value: 'idle' };
    const events: unknown[] = [
      { id: 'sevt_1', type: 'user.define_outcome' },
      { id: 'sevt_tu_1', type: 'agent.tool_use', name: 'bash', input: {}, evaluated_permission: 'ask' },
      { id: 'sevt_idle', type: 'session.status_idle', stop_reason: { type: 'requires_action', event_ids: ['sevt_tu_1'] } },
    ];
    const sent: unknown[] = [];
    const port = makePort({ events, sent, status });
    const send = port.sendEvents.bind(port);
    let first = true;
    port.sendEvents = async (id, evs, call) => {
      await send(id, evs, call);
      if (!first) return;
      first = false;
      // deny の送信後に締め切りを過ぎる: 件数 9 の保存は通り、上限処理の extend で時間切れ。session は deny を受けて running に進む
      events.push({ id: 'sevt_ans_1', type: 'user.tool_confirmation', tool_use_id: 'sevt_tu_1', result: 'deny' });
      status.value = 'running';
      at(21_000);
    };
    expect(await rec(port)).toBe('deferred');
    expect([row().status, row().deny_count]).toEqual(['running', 9]);

    at(60_000);
    expect(await rec(port)).toBe('failed:too_many_denies');
    expect(sent.slice(1)).toEqual([{ type: 'user.interrupt' }]);
    expect([row().status, row().error]).toEqual(['failed', 'too_many_denies']);
  });

  it('(s3) answered を持たない旧形式の scan.idle（stalls=7）を捨てても stalls は引き継ぎ、取得に失敗すると 8 回目で scan_stalled', async () => {
    expect(SCAN_MAX_STALLS).toBe(8);
    seedRunningJob();
    const legacy = {
      ctx: { purpose: 'idle', job_status: 'running', job_phase: 'making', session_status: 'idle', head: 'sevt_ans_1' },
      cursor: '1',
      pages: 1,
      seen: 1,
      agg: { idle: null, evalEnd: null, hasOutcome: false, blocked: {} },
      done: false,
      stalls: 7,
    };
    db.prepare("UPDATE factory_jobs SET reconcile_state_json = ? WHERE id = 'j1'").run(JSON.stringify({ scan: { idle: legacy } }));
    const port = makePort({ events: [], sent: [] });
    port.listEventsPage = async () => {
      throw new Error('events_unavailable');
    };
    expect(await rec(port)).toBe('failed:scan_stalled');
    expect([row().status, row().error]).toEqual(['failed', 'scan_stalled']);
  });

  it('(s3) 旧形式を捨てて先頭から読み直す時も、時間切れの回数は保存値 + 1 で残り、集計は新しい形式になる', async () => {
    seedRunningJob();
    const events = [
      { id: 'sevt_1', type: 'user.define_outcome' },
      { id: 'sevt_tu_1', type: 'agent.tool_use', name: 'bash', input: {}, evaluated_permission: 'ask' },
      { id: 'sevt_idle', type: 'session.status_idle', stop_reason: { type: 'requires_action', event_ids: ['sevt_tu_1'] } },
      { id: 'sevt_ans_1', type: 'user.tool_confirmation', tool_use_id: 'sevt_tu_1', result: 'deny' },
    ];
    const legacy = {
      ctx: { purpose: 'idle', job_status: 'running', job_phase: 'making', session_status: 'idle', head: 'sevt_ans_1' },
      cursor: '1',
      pages: 1,
      seen: 1,
      agg: { idle: null, evalEnd: null, hasOutcome: false, blocked: {} },
      done: false,
      stalls: 3,
    };
    db.prepare("UPDATE factory_jobs SET reconcile_state_json = ? WHERE id = 'j1'").run(JSON.stringify({ scan: { idle: legacy } }));
    const sent: unknown[] = [];
    let run = 1;
    const port = makePort({
      events,
      sent,
      pageSize: 1,
      onEventsPage: (n) => {
        if (run === 1 && n === 1) at(21_000);
      },
    });
    expect(await rec(port)).toBe('deferred');
    const saved = JSON.parse(String(row().reconcile_state_json)).scan.idle;
    expect(saved).toMatchObject({ stalls: 4, pages: 1, cursor: '1', agg: { idle: null, answered: ['sevt_tu_1'] } });
    run = 2;
    at(60_000);
    expect(await rec(port)).toBe('already_answered:1');
    expect(sent).toEqual([]);
  });
});
