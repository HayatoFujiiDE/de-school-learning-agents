// 画像生成の運営の操作（契約 §O-5 e）・GET /api/status の images・確認画面の generated_images（§O-7 6）。
// node:sqlite の実 DB（migrations 0001〜0004）+ R2 の Map。ルートの関数を直接呼ぶ（認証と Origin は index.ts の requireAccess が先に掛ける）。
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireAccess } from '../src/access';
import { tokyoDay } from '../src/db';
import type { Env } from '../src/env';
import type { RouteCtx } from '../src/http';
import { generatedImagesOf, getImagesStatus, haltImages, imageRequestFile, unhaltImages } from '../src/routes/images';
import { reviewDetail } from '../src/routes/review';
import { getStatus } from '../src/routes/status';
import { d1, migratedDb, one, rows } from './d1-shim';
import { goodMaterial } from './helpers';

const T = '2026-11-05T00:00:00.000Z';
const PROMPT = 'ひみつのプロンプト: 赤い石の回路を斜め上から';
const imgId = (n: number) => `img_${n.toString(16).padStart(32, '0')}`;

let db: DatabaseSync;
let env: Env;
let r2: Map<string, Uint8Array>;
let logs: string[];

function ctx(method = 'GET', path = '/api/images/status'): RouteCtx {
  const request = new Request(`http://localhost${path}`, { method });
  return {
    env,
    request,
    url: new URL(request.url),
    email: 'ops@example.invalid',
    exec: {} as ExecutionContext,
    port: async () => {
      throw new Error('port は使わない');
    },
  };
}

function seedJob(id: string, mid = `m-${id}`) {
  db.prepare(
    "INSERT INTO materials (id, slug, title, kinds_json, work_status, publish_status, brief_md, created_at, updated_at) VALUES (?, ?, 't', '[3]', 'making', 'none', 'b', ?, ?)",
  ).run(mid, `slug-${mid}`, T, T);
  db.prepare(
    `INSERT INTO factory_jobs (id, material_id, kind, model, phase, status, session_id, brief_md, budget_cents, created_at, updated_at)
     VALUES (?, ?, 'draft', 'claude-sonnet-5-5', 'making', 'running', ?, 'b', 300, ?, ?)`,
  ).run(id, mid, `sesn_${id}`, T, T);
}

interface Req {
  n: number;
  job: string;
  state: 'queued' | 'dispatched' | 'done' | 'refused' | 'failed';
  error?: string | null;
  at?: string;
  u?: number | null;
  actual?: number | null;
  format?: 'png' | 'webp';
  input?: Record<string, unknown>;
}
function seedReq(r: Req) {
  const id = imgId(r.n);
  const at = r.at ?? T;
  const done = r.state === 'done';
  const disp = r.state === 'dispatched' || done;
  db.prepare(
    `INSERT INTO image_requests (id, custom_tool_use_id, job_id, session_id, model, size, quality, format, background, u_cents, input_json, state, error,
       enqueue_count, enqueued_at, dispatch_token, dispatched_at, actual_cents, r2_key, sha256, bytes, media_type, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'gpt-image-2.5-flare', '1024x1024', 'high', ?, 'opaque', ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    `sevt_${r.n}`,
    r.job,
    `sesn_${r.job}`,
    r.format ?? 'png',
    r.state === 'refused' ? null : r.u === undefined ? 10 : r.u,
    JSON.stringify(r.input ?? { prompt: PROMPT, alt: '赤い線の図', accuracy: 'scientific' }),
    r.state,
    r.error ?? null,
    at,
    disp ? `tok-${r.n}` : null,
    disp ? at : null,
    r.actual ?? null,
    done ? `img/${r.job}/${id}/tok-${r.n}.${r.format ?? 'png'}` : null,
    done ? `sha-${r.n}` : null,
    done ? 4 : null,
    done ? `image/${r.format ?? 'png'}` : null,
    at,
    at,
  );
  return id;
}
const ledger = (ref: string, cents: number, day = tokyoDay(), kind = 'image') =>
  db.prepare('INSERT INTO cost_ledger (id, day, kind, ref_id, cents, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(crypto.randomUUID(), day, kind, ref, cents, T);
const halted = () => (one(db, "SELECT value FROM settings WHERE key = 'image_gen_halted'").value as string | undefined) ?? null;
const setHalt = (v: string) => db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('image_gen_halted', ?, ?)").run(v, T);

beforeEach(() => {
  db = migratedDb();
  r2 = new Map();
  env = {
    DB: d1(db),
    R2: {
      async get(k: string) {
        const b = r2.get(k);
        return b ? { body: b } : null;
      },
    },
  } as unknown as Env;
  logs = [];
  vi.spyOn(console, 'log').mockImplementation((s: unknown) => {
    logs.push(String(s));
  });
});
afterEach(() => vi.restoreAllMocks());

describe('GET /api/images/status（§O-5 e）', () => {
  it('何も無い時: 停止なし・今月 0・上限 3000（既定）・一覧は空', async () => {
    const res = await getImagesStatus(ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ halted: null, month_cents: 0, month_cap_cents: 3000, holds_open: 0, dispatched: 0, recent: [] });
  });

  it('上限は IMAGE_MONTHLY_CAP_CENTS を読む', async () => {
    (env as unknown as Record<string, string>).IMAGE_MONTHLY_CAP_CENTS = '2500';
    expect((await (await getImagesStatus(ctx())).json()).month_cap_cents).toBe(2500);
  });

  it('今月の記帳は kind=image の ih: と if: の合計（先月・他の kind は入れない）・取り置き中の数・dispatched の数', async () => {
    seedJob('j1');
    seedJob('j2');
    ledger('ih:j1', 280);
    ledger('if:j2', 30);
    ledger('if:j0', 100, '2020-01-31'); // 別の月
    ledger('j1', 999, tokyoDay(), 'session'); // 画像ではない
    seedReq({ n: 1, job: 'j1', state: 'dispatched' });
    seedReq({ n: 2, job: 'j1', state: 'queued' });
    seedReq({ n: 3, job: 'j2', state: 'done', actual: 12 });
    setHalt('over_reserve:' + imgId(3));
    const b = await (await getImagesStatus(ctx())).json();
    expect(b).toMatchObject({ halted: 'over_reserve:' + imgId(3), month_cents: 310, month_cap_cents: 3000, holds_open: 1, dispatched: 1 });
    expect(b.recent).toHaveLength(3);
  });

  it('最近の一覧は新しい順 20 件・列は契約どおり・prompt / alt を含まない', async () => {
    seedJob('j1');
    for (let i = 1; i <= 22; i++) seedReq({ n: i, job: 'j1', state: i % 2 ? 'failed' : 'refused', error: i % 2 ? 'server' : 'job_image_limit', at: `2026-11-05T00:00:${String(i).padStart(2, '0')}.000Z` });
    const res = await getImagesStatus(ctx());
    const text = await res.text();
    const b = JSON.parse(text);
    expect(b.recent).toHaveLength(20);
    expect(b.recent[0].request_id).toBe(imgId(22));
    expect(b.recent[19].request_id).toBe(imgId(3));
    expect(Object.keys(b.recent[0]).sort()).toEqual(['actual_cents', 'created_at', 'error', 'job_id', 'model', 'quality', 'request_id', 'size', 'state', 'u_cents'].sort());
    expect(b.recent[0]).toMatchObject({ state: 'refused', error: 'job_image_limit', u_cents: null });
    expect(text).not.toContain(PROMPT);
    expect(text).not.toContain('赤い線の図');
  });
});

describe('POST /api/images/halt・unhalt（H1・H2）', () => {
  it('止める → 200 manual。監査ログは {at:image_halt} だけ', async () => {
    const res = await haltImages(ctx('POST', '/api/images/halt'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ halted: 'manual' });
    expect(halted()).toBe('manual');
    expect(logs).toEqual([JSON.stringify({ at: 'image_halt' })]);
  });

  it('既に止まっている時の「止める」は最初の理由を残す（ON CONFLICT DO NOTHING）', async () => {
    setHalt('quota');
    const res = await haltImages(ctx('POST', '/api/images/halt'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ halted: 'quota' });
    expect(halted()).toBe('quota');
  });

  it('止まっていない時の「再開する」は 409 not_halted', async () => {
    const res = await unhaltImages(ctx('POST', '/api/images/unhalt'));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'not_halted' });
    expect(logs).toEqual([]);
  });

  it('dispatched が残る間は 409 dispatched_remain で停止のまま。無くなれば 200 で消え、監査ログは {at:image_unhalt} だけ', async () => {
    seedJob('j1');
    seedReq({ n: 1, job: 'j1', state: 'dispatched' });
    seedReq({ n: 2, job: 'j1', state: 'queued' }); // queued は再開を妨げない
    setHalt('result_unknown:' + imgId(9));
    let res = await unhaltImages(ctx('POST', '/api/images/unhalt'));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'dispatched_remain' });
    expect(halted()).toBe('result_unknown:' + imgId(9));
    db.prepare("UPDATE image_requests SET state = 'failed', error = 'result_unknown' WHERE id = ?").run(imgId(1));
    res = await unhaltImages(ctx('POST', '/api/images/unhalt'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ halted: null });
    expect(halted()).toBeNull();
    expect(logs).toEqual([JSON.stringify({ at: 'image_unhalt' })]);
  });

  it('止める → 再開する → 止める の往復（GET /api/status の images にも反映）', async () => {
    const st = async () => (await (await getStatus(ctx('GET', '/api/status'))).json()).images;
    expect(await st()).toEqual({ halted: null, month_cents: 0, month_cap_cents: 3000 });
    await haltImages(ctx('POST'));
    expect((await st()).halted).toBe('manual');
    expect((await unhaltImages(ctx('POST'))).status).toBe(200);
    expect((await st()).halted).toBeNull();
    await haltImages(ctx('POST'));
    expect((await st()).halted).toBe('manual');
  });

  it('GET 以外は Origin が無いと 403 bad_origin（§B-1。index.ts がルートの前に掛ける requireAccess）', async () => {
    const e = { ACCESS_DEV_BYPASS_EMAIL: 'ops@example.invalid' } as unknown as Env;
    for (const p of ['/api/images/halt', '/api/images/unhalt']) {
      const no = await requireAccess(new Request(`http://localhost${p}`, { method: 'POST' }), e);
      expect(no.ok).toBe(false);
      if (!no.ok) expect(no.response.status).toBe(403);
      const other = await requireAccess(new Request(`http://localhost${p}`, { method: 'POST', headers: { Origin: 'http://evil.example' } }), e);
      expect(other.ok).toBe(false);
      const same = await requireAccess(new Request(`http://localhost${p}`, { method: 'POST', headers: { Origin: 'http://localhost' } }), e);
      expect(same.ok).toBe(true);
    }
  });
});

describe('GET /api/images/requests/:id/file（done だけ・§M-3 のヘッダ）', () => {
  it('done → R2 の r2_key の中身を §M-3 のヘッダで返す（png / webp）', async () => {
    seedJob('j1');
    const a = seedReq({ n: 1, job: 'j1', state: 'done' });
    const b = seedReq({ n: 2, job: 'j1', state: 'done', format: 'webp' });
    r2.set(`img/j1/${a}/tok-1.png`, new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    r2.set(`img/j1/${b}/tok-2.webp`, new Uint8Array([0x52, 0x49, 0x46, 0x46]));
    const res = await imageRequestFile(ctx('GET'), a);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    const w = await imageRequestFile(ctx('GET'), b);
    expect(w.status).toBe(200);
    expect(w.headers.get('content-type')).toBe('image/webp');
  });

  it('done 以外・R2 に物体が無い・形の違う id・存在しない id は 404', async () => {
    seedJob('j1');
    const ids = [
      seedReq({ n: 1, job: 'j1', state: 'queued' }),
      seedReq({ n: 2, job: 'j1', state: 'dispatched' }),
      seedReq({ n: 3, job: 'j1', state: 'failed', error: 'server' }),
      seedReq({ n: 4, job: 'j1', state: 'refused', error: 'halted' }),
      seedReq({ n: 5, job: 'j1', state: 'done' }), // R2 に無い（掃除済み）
    ];
    for (const n of [1, 2, 3, 4]) r2.set(`img/j1/${imgId(n)}/tok-${n}.png`, new Uint8Array([1]));
    for (const id of [...ids, imgId(99), 'img_XYZ', '../etc']) {
      const res = await imageRequestFile(ctx('GET'), id);
      expect(res.status, id).toBe(404);
      expect(await res.json()).toEqual({ error: 'not_found' });
    }
  });
});

describe('確認画面の generated_images（§O-7 6）', () => {
  const withImages = () => {
    const m = goodMaterial() as { parts: Array<{ files: Array<Record<string, unknown>> }> };
    m.parts[0].files = [
      { path: 'parts/p1/figure-1.svg', role: 'figure' },
      { path: 'parts/p1/gen-a.png', role: 'figure', image_id: imgId(1), alt: 'files 側の alt' },
      { path: 'parts/p1/gen-b.webp', role: 'figure', image_id: imgId(2) },
      { path: 'parts/p1/gen-c.png', role: 'figure', image_id: imgId(3) }, // 別 job の依頼
      { path: 'parts/p1/gen-d.png', role: 'figure', image_id: 'img_bad' },
    ];
    return m;
  };

  it('files[].image_id を同じ job の依頼の input_json に結ぶ（別 job・形の違う id・行の無い id は出さない）', async () => {
    seedJob('j1');
    seedJob('j2');
    seedReq({ n: 1, job: 'j1', state: 'done' });
    seedReq({ n: 2, job: 'j1', state: 'done', format: 'webp', input: { prompt: '青い三角', alt: '三角', accuracy: 'standard' } });
    seedReq({ n: 3, job: 'j2', state: 'done' });
    const out = await generatedImagesOf(env.DB, 'j1', withImages());
    expect(out).toEqual([
      { path: 'parts/p1/gen-a.png', accuracy: 'scientific', prompt: PROMPT, alt: '赤い線の図' },
      { path: 'parts/p1/gen-b.webp', accuracy: 'standard', prompt: '青い三角', alt: '三角' },
    ]);
    expect(await generatedImagesOf(env.DB, 'j1', goodMaterial())).toEqual([]);
    expect(await generatedImagesOf(env.DB, 'j1', null)).toEqual([]);
    expect(await generatedImagesOf(env.DB, 'j1', { parts: [{ files: 'x' }, null] })).toEqual([]);
  });

  it('GET /api/review/:version_id が generated_images を返す（画像の無い版は []）', async () => {
    seedJob('j1', 'm1');
    seedJob('j2', 'm2');
    seedReq({ n: 1, job: 'j1', state: 'done' });
    seedReq({ n: 2, job: 'j1', state: 'done', format: 'webp' });
    const ins = (vid: string, mid: string, jid: string, mat: unknown) =>
      db.prepare(
        `INSERT INTO material_versions (id, material_id, version, job_id, session_id, r2_prefix, content_sha256, material_json, claims_json, adapt_rules_md,
           checks_json, public_paths_json, status, created_at)
         VALUES (?, ?, 1, ?, 's', 'p/', 'sha', ?, '{"claims":[]}', 'a', '{}', '[]', 'review', ?)`,
      ).run(vid, mid, jid, JSON.stringify(mat), T);
    ins('v1', 'm1', 'j1', withImages());
    ins('v2', 'm2', 'j2', goodMaterial());
    const b1 = await (await reviewDetail(ctx('GET', '/api/review/v1'), 'v1')).json();
    expect(b1.generated_images.map((g: { path: string }) => g.path)).toEqual(['parts/p1/gen-a.png', 'parts/p1/gen-b.webp']);
    expect(b1.generated_images[0]).toEqual({ path: 'parts/p1/gen-a.png', accuracy: 'scientific', prompt: PROMPT, alt: '赤い線の図' });
    expect(b1.version.material.parts[0].files).toHaveLength(5); // material は今までどおり
    const b2 = await (await reviewDetail(ctx('GET', '/api/review/v2'), 'v2')).json();
    expect(b2.generated_images).toEqual([]);
    expect(logs.join('\n')).not.toContain(PROMPT);
  });
});

it('image_requests は rows で読める（shim の 0004 の確認）', () => {
  expect(rows(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'image_requests'")).toHaveLength(1);
});
