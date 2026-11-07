// §AJ-4・§AJ-6 6: 確認画面の立体モデル（子どもの画面の埋め込み・図の行の件数・利用条件・仕分けの項目）と、/admin の CSP。
// §AK-4 4・§AK-7 12: models3d_meta の license は記録の名前・attribution は記録の値・license_url / rights_kind / rights_status。門番で × の版は rights_blocked。
// admin.js の純関数を vm で読む（review-preview.test.ts と同じ形）。
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import worker from '../src/index';
import { MODELS3D_BY_ID } from '../src/models3d';
import { serveVersionFile } from '../src/routes/library';
import { reviewDetail } from '../src/routes/review';
import { ctx, good, material, seed, world } from './review-auto-helpers';
import { seedGood } from './rights-helpers';
// @ts-expect-error 素の JS の作り物のデータ（serve.mjs と共通）
import * as FX from './review-preview/fixtures.mjs';

type Obj = Record<string, any>;
const code = readFileSync(new URL('../public/admin/admin.js', import.meta.url), 'utf8');
const win: Obj = { __FACTORY_ADMIN_NO_BOOT__: true };
vm.runInNewContext(code, { window: win, console }, { timeout: 2000 });
const R = win.FactoryAdminReview as Obj;
const n = (h: string, re: RegExp) => (h.match(re) || []).length;
const BASE = '/api/review/vfix-0001/files/';

const ALLO = MODELS3D_BY_ID.get('omnh-allosaurus')!;
const TRI = MODELS3D_BY_ID.get('si-triceratops')!;
/** 記録が通った時の権利のキー（Sketchfab は api・Voyager は人の記録。src/routes/review.ts と同じ形） */
const RIGHTS: Record<string, Obj> = {
  sketchfab: { license: 'CC BY 4.0', license_url: 'https://creativecommons.org/licenses/by/4.0/', license_code: 'cc-by', rights_kind: 'api', rights_status: 'verified' },
  voyager: { license: 'CC0 1.0', license_url: 'https://creativecommons.org/publicdomain/zero/1.0/', license_code: 'cc0', rights_kind: 'human', rights_status: 'human' },
};
/** review API の models3d_meta の 1 件（src/routes/review.ts と同じ形・門番を通った版） */
const metaOf = (e: typeof ALLO, o: Obj = {}) => ({
  catalog_id: e.id,
  title: e.title_ja,
  org: e.org,
  kind: e.kind,
  embed_url: e.embed_url,
  page_url: e.page_url,
  attribution: e.attribution,
  ...RIGHTS[e.kind],
  ...o,
});
const model = (o: Obj = {}) => ({ id: 'd1', catalog_id: 'omnh-allosaurus', why: '骨盤と後ろあしを回して見る', source_id: 's9', ...o });
const partWith = (models3d: unknown[]) => ({ id: 'p1', kind: 3, title: '骨格', files: [], videos: [], variants: [], models3d });
const body = (models3d: unknown[], meta: Obj | null) => R.previewBodyHtml('最初の段落\n\n次の段落', partWith(models3d), { fileBase: BASE, marks: false, models3dMeta: meta });

describe('§AJ-4 子どもの画面の立体モデル（previewMedia）', () => {
  it('meta があり embed_url の形が合えば、一覧どおりの src の iframe が 1 つ・提供元で開く・見方', () => {
    const h = body([model()], { d1: metaOf(ALLO) });
    expect(n(h, /class="mp-model3d"/g)).toBe(1);
    expect(h).toContain('data-media="model3d" data-media-key="d1"');
    expect(n(h, /<iframe /g)).toBe(1);
    expect(h).toContain(
      `<iframe src="${ALLO.embed_url}" title="${ALLO.title_ja}" allow="fullscreen; xr-spatial-tracking" referrerpolicy="strict-origin-when-cross-origin" loading="lazy"></iframe>`,
    );
    // §AK-5: caption は「ライセンス: <label>（<license_url>）。出典の書き方: <attribution>。根拠: <根拠の日本語>」
    expect(h).toContain(
      `<p class="mp-model3d-cap">${ALLO.title_ja}（${ALLO.org}）ライセンス: CC BY 4.0（https://creativecommons.org/licenses/by/4.0/）。出典の書き方: ${ALLO.attribution}。根拠: 機械: 提供元の API<a href="${ALLO.page_url}" target="_blank" rel="noopener noreferrer">提供元で開く</a></p>`,
    );
    expect(h).toContain('<p class="mp-model3d-why"><span class="mp-k">見方</span>骨盤と後ろあしを回して見る</p>');
    // 先頭の段落の直後（2 つ目の段落より前）
    expect(h.indexOf('mp-model3d')).toBeGreaterThan(h.indexOf('data-para="0"'));
    expect(h.indexOf('mp-model3d')).toBeLessThan(h.indexOf('data-para="1"'));
  });

  it('Voyager の埋め込みも同じ形で出る', () => {
    const h = body([model({ catalog_id: 'si-triceratops' })], { d1: metaOf(TRI) });
    expect(h).toContain(`<iframe src="${TRI.embed_url}" title="${TRI.title_ja}"`);
  });

  it('material.json の値（catalog_id や余分なキー）は src にしない。src は models3d_meta の embed_url だけ', () => {
    const h = body([model({ embed_url: 'https://evil.example/x', catalog_id: 'https://evil.example/y' })], { d1: metaOf(ALLO) });
    expect(h).not.toContain('evil.example');
    expect(h).toContain(`<iframe src="${ALLO.embed_url}"`);
  });

  it('meta が無い id は「一覧に無い」で iframe なし。models3d_meta が null（古い Worker）も同じ', () => {
    const h = body([model({ id: 'd2' })], { d1: metaOf(ALLO) });
    expect(h).toContain('<p class="mp-missing">立体モデル d2 は一覧に無いため、埋め込みません</p>');
    expect(h).not.toContain('<iframe');
    const old = body([model()], null);
    expect(old).toContain('立体モデル d1 は一覧に無いため、埋め込みません');
    expect(old).not.toContain('<iframe');
  });

  it.each([
    ['別のホスト', 'https://evil.example/models/900868a0aa0b47e58571f5f5ae20094c/embed'],
    ['sketchfab の uid が 31 桁', 'https://sketchfab.com/models/900868a0aa0b47e58571f5f5ae20094/embed'],
    ['sketchfab の大文字', 'https://sketchfab.com/models/900868A0AA0B47E58571F5F5AE20094C/embed'],
    ['クエリつき', 'https://sketchfab.com/models/900868a0aa0b47e58571f5f5ae20094c/embed?autostart=1'],
    ['http', 'http://sketchfab.com/models/900868a0aa0b47e58571f5f5ae20094c/embed'],
    ['javascript', 'javascript:alert(1)'],
    ['voyager の id が短い', 'https://3d-api.si.edu/voyager/3d_package:d8c623be-4ebc-11ea-b77f-2e728ce8812'],
    ['voyager の後ろに文字', 'https://3d-api.si.edu/voyager/3d_package:d8c623be-4ebc-11ea-b77f-2e728ce88125"><script>'],
    ['null', null],
  ])('embed_url の形が違う meta（%s）は「埋め込みません」で iframe なし', (_n, url) => {
    const h = body([model()], { d1: metaOf(ALLO, { embed_url: url }) });
    expect(h).toContain('<p class="mp-missing">立体モデルの埋め込みの形が正しくないため、埋め込みません</p>');
    expect(h).not.toContain('<iframe');
    expect(h).not.toContain('<script>');
  });

  it('値はすべてエスケープする。page_url が https:// で始まらなければリンクにしない', () => {
    const h = body([model({ why: '<b>見て</b>' })], { d1: metaOf(ALLO, { title: '<i>題</i>', org: 'A&B', license: '"CC"', page_url: 'javascript:alert(1)' }) });
    expect(h).toContain('&lt;b&gt;見て&lt;/b&gt;');
    expect(h).toContain('title="&lt;i&gt;題&lt;/i&gt;"');
    expect(h).toContain('&lt;i&gt;題&lt;/i&gt;（A&amp;B）ライセンス: &quot;CC&quot;（');
    expect(h).not.toContain('javascript:');
    expect(h).not.toContain('提供元で開く');
  });

  it('動画の直後に立体モデル（動画と立体モデルが両方ある part）', () => {
    const part = { ...partWith([model()]), videos: [{ id: 'v1', youtube_id: 'abcdefghijk', title: 't', start_sec: 1, end_sec: 9, why: 'w' }] };
    const h = R.previewBodyHtml('a\n\nb', part, { fileBase: BASE, marks: false, models3dMeta: { d1: metaOf(ALLO) } });
    expect(h.indexOf('mp-model3d')).toBeGreaterThan(h.indexOf('mp-video'));
  });
});

describe('§AJ-4 確認画面の補足と仕分けの項目', () => {
  /** 作り物の版（attention）に立体モデル 2 件と、その仕分けの項目を足す */
  const withModels = (): Obj => {
    const d = FX.attention();
    d.version.material.parts[0].models3d = [model(), model({ id: 'd2', catalog_id: 'si-triceratops', source_id: 's10' })];
    d.models3d_meta = { d1: metaOf(ALLO), d2: metaOf(TRI) };
    const item = (id: string, e: typeof ALLO) => ({ id: `model3d:${id}`, kind: 'model3d', key: 'explanation_and_expression', severity: 'ask', cause: 'model3d_human', model3d_id: id, catalog_id: e.id, title: e.title_ja, detail: '立体モデル（人が回して見てください）' });
    d.triage.items.push(item('d1', ALLO), item('d2', TRI));
    return d;
  };

  it('「図・画像 N 枚・動画 M 本」の行に「・立体モデル K 件」（0 件なら出さない）', () => {
    expect(R.figsBlockHtml(withModels())).toMatch(/図・画像 \d+ 枚(・動画 \d+ 本)?・立体モデル 2 件/);
    expect(R.figsBlockHtml(FX.attention())).not.toContain('立体モデル');
  });

  it('利用条件: 立体モデルごとの rv-term（題名・提供元・ライセンス・出典の書き方・提供元で開く）。一覧に無い id は出さない', () => {
    const d = withModels();
    const h = R.reviewHtml(d, R.newReviewState(), {});
    expect(n(h, /data-model3d-term="/g)).toBe(2);
    expect(h).toContain(
      `<div class="rv-term" data-model3d-term="d1"><p><b>立体モデル d1</b> ${ALLO.title_ja}（${ALLO.org}）</p><p>ライセンス: CC BY 4.0（https://creativecommons.org/licenses/by/4.0/）。出典の書き方: ${ALLO.attribution}。根拠: 機械: 提供元の API</p><p><a href="${ALLO.page_url}" target="_blank" rel="noopener noreferrer">提供元で開く</a></p></div>`,
    );
    delete d.models3d_meta.d2;
    expect(n(R.models3dTermsHtml(d), /data-model3d-term="/g)).toBe(1);
    expect(R.models3dTermsHtml(FX.attention())).toBe('');
  });

  it('仕分けの項目（kind model3d）は「立体モデル <id> <title>」で、場所は .mp-model3d[data-media-key]', () => {
    const d = withModels();
    const h = R.itemsHtml(d, R.newReviewState(), {});
    expect(h).toContain(`<b class="rv-it-title">立体モデル d1 ${ALLO.title_ja}</b>`);
    expect(h).toContain(`<b class="rv-it-title">立体モデル d2 ${TRI.title_ja}</b>`);
    expect(h).toContain('立体モデル（人が回して見てください）');
    const it1 = R.triageOf(d).shown.find((x: Obj) => x.id === 'model3d:d1');
    expect(R.itemTarget(it1, d)).toEqual({ t: 'media', media: 'model3d', key: 'd1', pi: 0 });
    expect(R.locateItem(it1, d, {}, [R.defaultPv()])).toMatchObject({ t: 'media', media: 'model3d', key: 'd1', label: '立体モデル' });
    // 子どもの画面に印が付く（場所を見るの先）
    const pins = R.pinsOf(d, R.newReviewState());
    const part = d.version.material.parts[0];
    const ph = R.previewBodyHtml('a', part, { fileBase: BASE, marks: true, pins, models3dMeta: d.models3d_meta });
    expect(ph).toMatch(/<div class="mp-model3d has-pin[^"]*" data-media="model3d" data-media-key="d1"/);
    // 一覧に無い id の項目は場所なし
    expect(R.itemTarget({ ...it1, model3d_id: 'd9' }, d)).toBeNull();
  });
});

describe('§AJ-4 CSP: 立体モデルのホストは /admin の frame-src だけ', () => {
  it('/admin の HTML の CSP の frame-src に https://sketchfab.com と https://3d-api.si.edu がある（他は変えない）', async () => {
    const env = {
      ACCESS_DEV_BYPASS_EMAIL: 'ops@example.invalid',
      ASSETS: { fetch: async () => new Response('<!doctype html><title>x</title>', { status: 200, headers: { 'content-type': 'text/html' } }) },
    } as unknown as Env;
    const res = await worker.fetch(new Request('http://localhost/admin/'), env, {} as ExecutionContext);
    expect(res.status).toBe(200);
    const csp = res.headers.get('content-security-policy') ?? '';
    const frame = csp.split(';').map((x) => x.trim()).find((x) => x.startsWith('frame-src')) ?? '';
    expect(frame.split(/\s+/)).toEqual(['frame-src', "'self'", 'https://www.youtube-nocookie.com', 'https://sketchfab.com', 'https://3d-api.si.edu']);
  });

  it('生成物の配信（library と確認画面の共通関数）の CSP には 2 つのホストが無い', async () => {
    const r2 = new Map<string, Uint8Array>();
    const prefix = 'materials/m1/j1/';
    const paths = ['parts/p1/app.html', 'parts/p1/figure-1.svg', 'parts/p1/a.png', 'parts/p1/b.webp'];
    for (const p of paths) r2.set(prefix + p, new Uint8Array([1]));
    const env = { R2: { get: async (k: string) => (r2.has(k) ? { body: r2.get(k) } : null) } } as unknown as Env;
    const row = { r2_prefix: prefix, public_paths_json: JSON.stringify(paths) };
    for (const p of paths) {
      const res = await serveVersionFile(env, row, p);
      expect(res.status, p).toBe(200);
      const csp = res.headers.get('content-security-policy') ?? '';
      expect(csp.length, p).toBeGreaterThan(0);
      expect(csp, p).not.toContain('sketchfab');
      expect(csp, p).not.toContain('si.edu');
    }
  });
});

describe('§AJ-4 review API（GET /api/review/<version>）の models3d_meta', () => {
  it('version.material の models3d はそのまま返し、models3d_meta は一覧と権利の記録から（一覧に無い id は入れない）。仕分けに立体モデルの項目', async () => {
    const w = world();
    await seedGood(w.db, ALLO.id);
    const m = material();
    m.parts[0].models3d = [model(), model({ id: 'd2', catalog_id: 'gone-model', source_id: 's10' })];
    seed(w, good('m1', 'v1', { material: m, sources: { s1: {}, s9: { url: ALLO.page_url, url_was_fetched: 0, quote_found: 0 } } }));
    const b = (await (await reviewDetail(ctx(w, 'GET'), 'v1')).json()) as Obj;
    expect(b.version.material.parts[0].models3d).toEqual(m.parts[0].models3d);
    expect(b.models3d_meta).toEqual({ d1: metaOf(ALLO) });
    expect(b.triage.items.filter((x: Obj) => x.kind === 'model3d').map((x: Obj) => [x.id, x.severity, x.cause])).toEqual([
      ['model3d:d1', 'ask', 'model3d_human'],
      ['model3d:d2', 'fix', 'model3d_missing'],
    ]);
    // 立体モデルの出典（s9）は開けていなくても maker_url_not_fetched / quote_mismatch にならない
    expect(b.triage.items.some((x: Obj) => (x.source_ids ?? []).includes('s9'))).toBe(false);
  });

  it('立体モデルの無い版の models3d_meta は {}', async () => {
    const w = world();
    seed(w, good('m1', 'v1'));
    const b = (await (await reviewDetail(ctx(w, 'GET'), 'v1')).json()) as Obj;
    expect(b.models3d_meta).toEqual({});
  });
});

describe('§AK-4 4・§AK-7 12 権利の門番で止まった版（rights_blocked）', () => {
  const M = win.FactoryAdminModels3d as Obj;
  const pa = { cls: '', attr: '', btns: '' };

  it('review API: 記録の無い項目は rights_blocked: true・rights_reason no_record（embed_url は null・license は「不明」）', async () => {
    const w = world();
    const m = material();
    m.parts[0].models3d = [model()];
    seed(w, good('m1', 'v1', { material: m, sources: { s1: {}, s9: { url: ALLO.page_url, url_was_fetched: 0, quote_found: 0 } } }));
    const b = (await (await reviewDetail(ctx(w, 'GET'), 'v1')).json()) as Obj;
    expect(b.models3d_meta.d1).toEqual({
      catalog_id: ALLO.id,
      title: ALLO.title_ja,
      org: ALLO.org,
      kind: 'sketchfab',
      embed_url: null,
      page_url: ALLO.page_url,
      license: '不明',
      attribution: '',
      license_url: '',
      license_code: 'unknown',
      rights_kind: null,
      rights_status: null,
      rights_blocked: true,
      rights_reason: 'no_record',
    });
  });

  it('review API: NC の記録は license・止めた記録は blocked・指紋違いは subject_changed（license_url・rights_kind・rights_status は記録の値）', async () => {
    const cases: Array<[Obj, string]> = [
      [{ license_code: 'cc-by-nc', license_url: 'https://creativecommons.org/licenses/by-nc/4.0/' }, 'license'],
      [{ blocked: true }, 'blocked'],
      [{ subject_sha256: '0'.repeat(64) }, 'subject_changed'],
      [{ status: 'mismatch', fail_code: 'uid_mismatch' }, 'mismatch'],
    ];
    for (const [over, reason] of cases) {
      const w = world();
      await seedGood(w.db, ALLO.id, over);
      const m = material();
      m.parts[0].models3d = [model()];
      seed(w, good('m1', 'v1', { material: m, sources: { s1: {}, s9: { url: ALLO.page_url, url_was_fetched: 0, quote_found: 0 } } }));
      const b = (await (await reviewDetail(ctx(w, 'GET'), 'v1')).json()) as Obj;
      expect(b.models3d_meta.d1, reason).toMatchObject({ rights_blocked: true, rights_reason: reason, embed_url: null, rights_kind: 'api' });
      if (reason === 'license') expect(b.models3d_meta.d1).toMatchObject({ license: 'CC BY-NC 4.0', license_code: 'cc-by-nc', license_url: 'https://creativecommons.org/licenses/by-nc/4.0/' });
    }
  });

  it.each(['no_record', 'invalid', 'subject_changed', 'blocked', 'unverified', 'mismatch', 'license'])(
    'admin.js の model3dPreviewHtml（window.FactoryAdminModels3d）: rights_blocked（%s）は <iframe> も <model-viewer> も出さず理由の文',
    (reason) => {
      // embed_url・file_url が残っていても（古い応答・作り物）描かない
      const meta = { d1: metaOf(ALLO, { rights_blocked: true, rights_reason: reason, file_url: '/api/library/models3d/files/omnh-allosaurus/' + 'a'.repeat(64) + '.glb' }) };
      const h = M.model3dPreviewHtml(model(), meta, pa);
      expect(h).not.toContain('<iframe');
      expect(h).not.toContain('<model-viewer');
      expect(h).toContain(`権利の確認で止まっています（${M.rightsReasonText(reason)}）`);
      expect(h).toContain('data-rights-blocked="1"');
      // 見方は残す（material.json の文。エスケープ済み）
      expect(h).toContain('<span class="mp-k">見方</span>');
      const dl = M.model3dPreviewHtml(model({ catalog_id: 'nasa-perseverance-rover' }), { d1: { ...meta.d1, kind: 'download' } }, pa);
      expect(dl).not.toContain('<model-viewer');
    },
  );

  it('理由の日本語: no_record は「未確認」（deploy 直後の既存の版の文）・license・subject_changed', () => {
    expect(M.model3dBlockedText({ rights_reason: 'no_record' })).toBe('権利の確認で止まっています（未確認）');
    expect(M.rightsReasonText('license')).toBe('ライセンスの決まりで出せません');
    expect(M.rightsReasonText('subject_changed')).toBe('一覧が変わりました（確かめ直し待ち）');
    expect(M.rightsReasonText('<b>')).toBe('<b>');
    const h = M.model3dPreviewHtml(model(), { d1: metaOf(ALLO, { rights_blocked: true, rights_reason: '<b>x</b>' }) }, pa);
    expect(h).toContain('&lt;b&gt;x&lt;/b&gt;');
  });

  it('利用条件（models3dTermsHtml）: rights_blocked の版は理由の文だけ（ライセンスの行・提供元で開くは出さない）', () => {
    const d = FX.attention();
    d.version.material.parts[0].models3d = [model()];
    d.models3d_meta = { d1: metaOf(ALLO, { rights_blocked: true, rights_reason: 'no_record' }) };
    const h = R.models3dTermsHtml(d);
    expect(h).toContain('権利の確認で止まっています（未確認）');
    expect(h).not.toContain('ライセンス:');
    expect(h).not.toContain('提供元で開く');
  });
});
