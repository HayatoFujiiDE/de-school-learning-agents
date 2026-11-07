// 倉庫の「生成した画像」（契約 §N-8 C）: GET /api/images/gallery と画面の純関数（window.FactoryAdminGallery）。
// API は node:sqlite の実 DB（migrations）にルートの関数を直接呼ぶ（認証と Origin は index.ts の requireAccess が先に掛ける。image-routes.test.ts と同じ書き方）。
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import type { RouteCtx } from '../src/http';
import { GALLERY_LIMIT_DEFAULT, GALLERY_LIMIT_MAX, imageGallery } from '../src/routes/images';
import { d1, migratedDb } from './d1-shim';

const T = '2026-11-05T00:00:00.000Z';
const PROMPT = 'ひみつのプロンプト: 赤い石の回路を斜め上から';
const imgId = (n: number) => `img_${n.toString(16).padStart(32, '0')}`;
/** n 分後の時刻（新しい順の並びを作る） */
const at = (min: number) => new Date(Date.parse(T) + min * 60_000).toISOString();

let db: DatabaseSync;
let env: Env;

function ctx(query = ''): RouteCtx {
  const request = new Request(`http://localhost/api/images/gallery${query}`);
  return {
    env,
    request,
    url: new URL(request.url),
    email: 'ops@example.invalid',
    service: false,
    serviceName: null,
    exec: {} as ExecutionContext,
    port: async () => {
      throw new Error('port は使わない');
    },
  };
}
function seedMaterial(mid: string, title: string) {
  db.prepare(
    "INSERT INTO materials (id, slug, title, kinds_json, work_status, publish_status, brief_md, created_at, updated_at) VALUES (?, ?, ?, '[3]', 'making', 'none', 'b', ?, ?)",
  ).run(mid, `slug-${mid}`, title, T, T);
}
function seedJob(id: string, mid: string) {
  db.prepare(
    `INSERT INTO factory_jobs (id, material_id, kind, model, phase, status, session_id, brief_md, budget_cents, created_at, updated_at)
     VALUES (?, ?, 'draft', 'claude-sonnet-5-5', 'making', 'running', ?, 'b', 300, ?, ?)`,
  ).run(id, mid, `sesn_${id}`, T, T);
}
function seedReq(n: number, job: string, state: 'queued' | 'dispatched' | 'done' | 'refused' | 'failed', when: string, input: unknown = { prompt: PROMPT, alt: `図 ${n}`, accuracy: 'scientific' }) {
  const done = state === 'done';
  const disp = state === 'dispatched' || done;
  db.prepare(
    `INSERT INTO image_requests (id, custom_tool_use_id, job_id, session_id, model, size, quality, format, background, u_cents, input_json, state, error,
       enqueue_count, enqueued_at, dispatch_token, dispatched_at, actual_cents, r2_key, sha256, bytes, media_type, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'gpt-image-2.5-flare', '1024x1024', 'high', 'png', 'opaque', ?, ?, ?, NULL, 1, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
  ).run(
    imgId(n),
    `sevt_${n}`,
    job,
    `sesn_${job}`,
    state === 'refused' ? null : 10,
    typeof input === 'string' ? input : JSON.stringify(input),
    state,
    when,
    disp ? `tok-${n}` : null,
    disp ? when : null,
    done ? `img/${job}/${imgId(n)}.png` : null,
    done ? `sha-${n}` : null,
    done ? 4 : null,
    done ? 'image/png' : null,
    when,
    when,
  );
  return imgId(n);
}
async function get(query = '') {
  const res = await imageGallery(ctx(query));
  return { status: res.status, body: (await res.json()) as { items: Array<Record<string, unknown>>; next: { before: string; before_id: string } | null; error?: string } };
}

beforeEach(() => {
  db = migratedDb();
  env = { DB: d1(db) } as unknown as Env;
  seedMaterial('m-a', '赤血球のしごと');
  seedJob('job-a', 'm-a');
});

describe('GET /api/images/gallery（§N-8 C）', () => {
  it('空: items は [] で next は null', async () => {
    expect(await get()).toEqual({ status: 200, body: { items: [], next: null } });
  });

  it("state = 'done' だけ・新しい順（created_at DESC, id DESC）・prompt は返さず alt を input_json から取り出す・素材は job → material の JOIN", async () => {
    seedReq(1, 'job-a', 'done', at(1));
    seedReq(2, 'job-a', 'failed', at(2));
    seedReq(3, 'job-a', 'refused', at(3));
    seedReq(4, 'job-a', 'dispatched', at(4));
    seedReq(5, 'job-a', 'queued', at(5));
    seedReq(6, 'job-a', 'done', at(6));
    seedReq(7, 'job-a', 'done', at(6)); // 同じ時刻は id の大きい方が先
    const { status, body } = await get();
    expect(status).toBe(200);
    expect(body.items.map((x) => x.request_id)).toEqual([imgId(7), imgId(6), imgId(1)]);
    expect(body.items[0]).toEqual({
      request_id: imgId(7), job_id: 'job-a', material_id: 'm-a', material_title: '赤血球のしごと', created_at: at(6), model: 'gpt-image-2.5-flare', size: '1024x1024', alt: '図 7',
    });
    expect(JSON.stringify(body)).not.toContain('ひみつのプロンプト');
    expect(JSON.stringify(body)).not.toMatch(/prompt|input_json|accuracy|r2_key/);
    expect(body.next).toBeNull();
  });

  it('alt が無い・文字列でない・input_json が壊れている時は alt: null', async () => {
    seedReq(1, 'job-a', 'done', at(1), { prompt: PROMPT });
    seedReq(2, 'job-a', 'done', at(2), { prompt: PROMPT, alt: 42 });
    seedReq(3, 'job-a', 'done', at(3), '{not json');
    seedReq(4, 'job-a', 'done', at(4), ['alt']);
    const { body } = await get();
    expect(body.items.map((x) => [x.request_id, x.alt])).toEqual([[imgId(4), null], [imgId(3), null], [imgId(2), null], [imgId(1), null]]);
  });

  it('素材が引けない時（job の material_id の素材が無い）は material_id・material_title とも null', async () => {
    db.exec('PRAGMA foreign_keys = OFF');
    seedJob('job-orphan', 'm-gone');
    seedReq(1, 'job-orphan', 'done', at(1));
    const { body } = await get();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].material_id).toBeNull();
    expect(body.items[0].material_title).toBeNull();
    expect(body.items[0].job_id).toBe('job-orphan');
  });

  it('キー付きのページング: next の before / before_id で続きを取ると、重ならず・漏れずに全部たどれる（同じ時刻をまたいでも）', async () => {
    for (let i = 1; i <= 7; i++) seedReq(i, 'job-a', 'done', at(i <= 4 ? 1 : i)); // 1〜4 は同じ時刻
    const seen: string[] = [];
    let q = '?limit=3';
    let pages = 0;
    for (;;) {
      const { status, body } = await get(q);
      expect(status).toBe(200);
      expect(body.items.length).toBeLessThanOrEqual(3);
      seen.push(...body.items.map((x) => String(x.request_id)));
      pages++;
      if (!body.next) break;
      expect(body.next).toEqual({ before: body.items[body.items.length - 1].created_at, before_id: body.items[body.items.length - 1].request_id });
      q = `?limit=3&before=${encodeURIComponent(body.next.before)}&before_id=${body.next.before_id}`;
    }
    expect(pages).toBe(3);
    expect(seen).toEqual([imgId(7), imgId(6), imgId(5), imgId(4), imgId(3), imgId(2), imgId(1)]);
    // ちょうど limit 件で終わる時は next が null（もう 1 ページ空を取らせない）
    const exact = await get('?limit=7');
    expect(exact.body.items).toHaveLength(7);
    expect(exact.body.next).toBeNull();
  });

  it('limit: 既定 24・上限 48 に丸める・1 未満は 1・小数は切り捨て。数でなければ 400', async () => {
    expect(GALLERY_LIMIT_DEFAULT).toBe(24);
    expect(GALLERY_LIMIT_MAX).toBe(48);
    for (let i = 1; i <= 50; i++) seedReq(i, 'job-a', 'done', at(i));
    expect((await get()).body.items).toHaveLength(24);
    expect((await get('?limit=')).body.items).toHaveLength(24);
    expect((await get('?limit=200')).body.items).toHaveLength(48);
    expect((await get('?limit=48')).body.items).toHaveLength(48);
    expect((await get('?limit=0')).body.items).toHaveLength(1);
    expect((await get('?limit=-5')).body.items).toHaveLength(1);
    expect((await get('?limit=2.9')).body.items).toHaveLength(2);
    for (const bad of ['abc', 'NaN', 'Infinity']) expect([bad, (await get(`?limit=${bad}`)).status]).toEqual([bad, 400]);
    expect((await get('?limit=abc')).body).toEqual({ error: 'bad_query' });
  });

  it('before / before_id: 片方だけ・時刻でない・id の形が違うと 400', async () => {
    seedReq(1, 'job-a', 'done', at(1));
    const okId = imgId(1);
    for (const q of [`?before=${encodeURIComponent(at(1))}`, `?before_id=${okId}`, `?before=yesterday&before_id=${okId}`, `?before=${encodeURIComponent(at(1))}&before_id=img_xyz`, `?before=${'9'.repeat(41)}&before_id=${okId}`]) {
      const r = await get(q);
      expect([q, r.status, r.body.error]).toEqual([q, 400, 'bad_query']);
    }
    expect((await get(`?before=${encodeURIComponent(at(2))}&before_id=${okId}`)).body.items).toHaveLength(1);
  });

  it('index.ts のルート表にあり、admin の認証（requireAccess）の後ろに乗る', () => {
    const src = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
    expect(src).toContain("['GET', /^\\/api\\/images\\/gallery$/, imageGallery]");
    const routes = src.indexOf('const ROUTES');
    const access = src.indexOf('await requireAccess(request, env');
    const loop = src.indexOf('for (const [method, re, handler] of ROUTES)');
    expect(routes).toBeGreaterThan(0);
    expect(access).toBeGreaterThan(0);
    expect(loop).toBeGreaterThan(access); // ルート表はアクセスの確認の後でだけ引かれる
  });
});

// ---------------------------------------------------------------------------------------------
interface GalleryUi {
  GALLERY_LIMIT: number;
  galleryUrl(next: unknown): string;
  galleryItemsOf(d: unknown): Array<Record<string, unknown>>;
  galleryCardHtml(it: unknown): string;
  galleryMoreHtml(next: unknown, busy?: boolean, err?: string | null): string;
  galleryHtml(items: unknown[], next: unknown, busy?: boolean, err?: string | null): string;
  galleryLoadingHtml(): string;
  galleryErrorHtml(msg: string): string;
}
const code = readFileSync(new URL('../public/admin/admin.js', import.meta.url), 'utf8');
const win: Record<string, unknown> = { __FACTORY_ADMIN_NO_BOOT__: true };
vm.runInNewContext(code, { window: win, console }, { timeout: 2000 });
const G = win.FactoryAdminGallery as GalleryUi;
const F = win.FactoryAdminFloor as { stationPanelHtml(id: string, fl: unknown, st: unknown): string };
const n = (html: string, re: RegExp) => (html.match(re) || []).length;
const EVIL = '<img src=x onerror=alert(1)>';
const item = (k: number, o: Record<string, unknown> = {}) => ({
  request_id: imgId(k), job_id: 'job-a', material_id: 'm-a', material_title: '赤血球のしごと', created_at: T, model: 'gpt-image-2.5-flare', size: '1024x1024', alt: '赤い線の図', ...o,
});

describe('画面の純関数（#/library/images）', () => {
  it('カード: サムネは /api/images/requests/<id>/file を loading="lazy"・日時・教材の名前は #/material/<id> へのリンク・alt', () => {
    const h = G.galleryCardHtml(item(1));
    expect(h).toContain(`<img loading="lazy" src="/api/images/requests/${imgId(1)}/file" alt="赤い線の図">`);
    expect(h).toContain(`href="/api/images/requests/${imgId(1)}/file" target="_blank" rel="noopener noreferrer"`);
    expect(h).toContain('<a class="gl-mat" href="#/material/m-a">赤血球のしごと</a>');
    expect(h).toContain('<span class="gl-alt">赤い線の図</span>');
    expect(h).toMatch(/<span class="gl-time muted">[^<]+<\/span>/);
    expect(n(h, /data-gl-card="1"/g)).toBe(1);
    expect(h).not.toMatch(/\sstyle=/); // CSP（style 属性を使わない）
  });
  it('教材が無い・alt が無い時は リンクにせず「教材なし」「（説明の文なし）」', () => {
    const h = G.galleryCardHtml(item(2, { material_id: null, material_title: null, alt: null }));
    expect(h).not.toContain('#/material/');
    expect(h).toContain('<span class="gl-mat muted">教材なし</span>');
    expect(h).toContain('alt=""');
    expect(h).toContain('（説明の文なし）');
  });
  it('外の値（alt・教材の名前・id・時刻）は esc を通す', () => {
    const h = G.galleryCardHtml(item(3, { alt: EVIL, material_title: EVIL, material_id: '"><script>x</script>', created_at: EVIL }));
    expect(h).not.toContain('<img src=x');
    expect(h).not.toContain('<script>');
    expect(h).toContain('&lt;img src=x onerror=alert(1)&gt;');
    const odd = G.galleryCardHtml(item(4, { request_id: 'img_"onerror="x' }));
    expect(odd).not.toContain('"onerror="');
  });
  it('0 件は「まだありません」・カードもボタンも無い', () => {
    const h = G.galleryHtml([], null);
    expect(n(h, /data-gl-empty="1">まだありません</g)).toBe(1);
    expect(h).not.toContain('data-gl-card');
    expect(h).not.toContain('gl-more-btn');
    expect(h.startsWith('<h1>生成した画像</h1>')).toBe(true);
  });
  it('もっと見る: next がある時だけ。読み込み中は押せない・続きを読めなかった時は理由と「もう一度読み込む」', () => {
    const next = { before: T, before_id: imgId(1) };
    const items = [item(2), item(1)];
    const h = G.galleryHtml(items, next);
    expect(n(h, /data-gl-card="1"/g)).toBe(2);
    expect(h).toContain('<button type="button" class="btn" id="gl-more-btn">もっと見る</button>');
    expect(G.galleryHtml(items, null)).not.toContain('gl-more-btn');
    expect(G.galleryMoreHtml(next, true)).toContain('id="gl-more-btn" disabled>読み込み中…</button>');
    const err = G.galleryMoreHtml(next, false, EVIL);
    expect(err).toContain('続きを読み込めませんでした: &lt;img');
    expect(err).toContain('id="gl-more-btn">もう一度読み込む</button>');
  });
  it('続きの url: 1 ページ目は limit だけ・2 ページ目以降は before と before_id（encode する）', () => {
    expect(G.GALLERY_LIMIT).toBe(24);
    expect(G.galleryUrl(null)).toBe('/api/images/gallery?limit=24');
    expect(G.galleryUrl({ before: '2026-11-05T00:00:00.000Z', before_id: imgId(9) })).toBe(`/api/images/gallery?limit=24&before=2026-11-05T00%3A00%3A00.000Z&before_id=${imgId(9)}`);
  });
  it('応答の読み方: items の形が違う行は捨てる', () => {
    expect(G.galleryItemsOf({ items: [item(1), null, 'x', { request_id: 5 }, item(2)] }).map((x) => x.request_id)).toEqual([imgId(1), imgId(2)]);
    expect(G.galleryItemsOf(null)).toEqual([]);
  });
  it('読み込み中・取得失敗（もう一度読み込む）', () => {
    expect(n(G.galleryLoadingHtml(), /data-gl-loading="1"/g)).toBe(1);
    const e = G.galleryErrorHtml(EVIL);
    expect(n(e, /data-gl-error="1"/g)).toBe(1);
    expect(n(e, /id="gl-retry"/g)).toBe(1);
    expect(e).not.toContain('<img src=x');
  });
  it('入口: 倉庫のパネルは「生成した画像 › #/library/images」・#/images（道具）への入口は職人のパネルに残る・メニューの倉庫に「生成した画像」', () => {
    const lib = F.stationPanelHtml('library', { stations: { library: { available: 1, stopped: 0 } } }, {});
    expect(lib).toContain('<a class="sp-link" href="#/library/images">生成した画像 ›</a>');
    expect(lib).not.toContain('href="#/images"');
    const mk = F.stationPanelHtml('maker', { stations: { maker: {} } }, {});
    expect(mk).toContain('href="#/images"');
    const html = readFileSync(new URL('../public/admin/index.html', import.meta.url), 'utf8');
    expect(html).toContain('<span class="nav-grp-h">倉庫</span><a href="#/materials">素材</a><a href="#/models3d">立体モデル</a><a href="#/library/images">生成した画像</a></div>');
    expect(code).toContain("if (p[0] === 'library' && p[1] === 'images') return viewGallery(view);");
  });
});
