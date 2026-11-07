// 管理画面の画像の表示（契約 §O-5 e の画面と UI acceptance criteria・§O-7 6 の確認画面の 1 行）。
// public/admin/admin.js を node:vm で起動せず読み（smoke の (l5) と同じ読み方）、描画の純関数が返す HTML の要素数を数える。
// 「止める → 状況帯に停止の文 → 再開する → 消える」は実ルート（node:sqlite の実 DB）の応答を描いて確かめる。
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/env';
import type { RouteCtx } from '../src/http';
import { getImagesStatus, haltImages, unhaltImages } from '../src/routes/images';
import { getStatus } from '../src/routes/status';
import { d1, migratedDb } from './d1-shim';
import { goodMaterial } from './helpers';

interface ImagesUi {
  HALT_TEXT: Record<string, string>;
  haltText(code: string | null): string;
  imagesBandHtml(im: unknown): string;
  imagesHtml(d: unknown): string;
  imagesLoadingHtml(): string;
  imagesErrorHtml(msg: string): string;
  genCaption(g: unknown): string;
}
interface ReviewUi {
  reviewHtml(d: unknown, st: unknown, ctx: unknown): string;
  newReviewState(): unknown;
}

const code = readFileSync(new URL('../public/admin/admin.js', import.meta.url), 'utf8');
const win: Record<string, unknown> = { __FACTORY_ADMIN_NO_BOOT__: true };
vm.runInNewContext(code, { window: win, console }, { timeout: 2000 });
const I = win.FactoryAdminImages as ImagesUi;
const R = win.FactoryAdminReview as ReviewUi;
const n = (html: string, re: RegExp) => (html.match(re) || []).length;
const T = '2026-11-05T00:00:00.000Z';
const imgId = (k: number) => `img_${k.toString(16).padStart(32, '0')}`;

describe('停止の理由の文（§O-5 d verbatim）', () => {
  it('理由コード（id 付きも）→ 画面の文。表に無いコードはそのまま', () => {
    expect(I.haltText('manual')).toBe('手で止めました');
    expect(I.haltText(`over_reserve:${imgId(1)}`)).toBe('1 枚の実額が予約額を超えました');
    expect(I.haltText(`usage_missing:${imgId(1)}`)).toBe('1 枚の費用が分かりませんでした');
    expect(I.haltText(`result_unknown:${imgId(1)}`)).toBe('結果が分からない生成があります');
    expect(I.haltText('quota')).toBe('OpenAI の残高か上限に達しました');
    expect(I.haltText('auth')).toBe('OpenAI の鍵が使えません');
    expect(I.haltText('something_new')).toBe('something_new');
  });
});

describe('状況帯の画像の行', () => {
  it('動いている時: 「画像 $N / $上限（概算）」（帯の中は $。¢ は出さない）と #/images へのリンク。停止の文は無い', () => {
    const h = I.imagesBandHtml({ halted: null, month_cents: 280, month_cap_cents: 3000 });
    expect(h).toContain('>画像 $2.80 / $30（概算）</a>');
    expect(h).not.toContain('¢');
    expect(h).not.toContain('U で数えた記帳');
    expect(n(h, /data-img-band="1"/g)).toBe(1);
    expect(n(h, /data-img-halted="1"/g)).toBe(0);
    expect(n(h, /href="#\/images"/g)).toBe(1);
  });
  it('停止中: 「画像の生成を止めています（<理由の文>）」', () => {
    const h = I.imagesBandHtml({ halted: `over_reserve:${imgId(2)}`, month_cents: 0, month_cap_cents: 3000 });
    expect(n(h, /data-img-halted="1"/g)).toBe(1);
    expect(h).toContain('画像の生成を止めています（1 枚の実額が予約額を超えました）');
  });
  it('images の無い応答では何も出さない', () => {
    expect(I.imagesBandHtml(undefined)).toBe('');
  });
});

describe('#/images の画面（4 状態とボタン）', () => {
  const row = (k: number, o: Record<string, unknown> = {}) => ({
    request_id: imgId(k), job_id: 'j1', state: 'done', error: null, model: 'gpt-image-2.5-flare', size: '1024x1024', quality: 'high', u_cents: 10, actual_cents: 8, created_at: T, ...o,
  });
  it('読み込み中・取得失敗（再読み込みボタン付き）', () => {
    expect(n(I.imagesLoadingHtml(), /data-img-loading="1"/g)).toBe(1);
    const e = I.imagesErrorHtml('<b>x</b>');
    expect(n(e, /data-img-error="1"/g)).toBe(1);
    expect(n(e, /id="img-retry"/g)).toBe(1);
    expect(e).not.toContain('<b>x</b>'); // エスケープ
  });
  it('0 件・動いている: 「まだありません」・止めるが有効・再開するは無効', () => {
    const h = I.imagesHtml({ halted: null, month_cents: 0, month_cap_cents: 3000, holds_open: 0, dispatched: 0, recent: [] });
    expect(n(h, /data-img-empty="1"/g)).toBe(1);
    expect(h).toContain('まだありません');
    expect(n(h, /data-img-row="1"/g)).toBe(0);
    expect(n(h, /id="img-halt-btn">/g)).toBe(1);
    expect(n(h, /id="img-unhalt-btn" disabled>/g)).toBe(1);
    expect(n(h, /data-img-state="running"/g)).toBe(1);
  });
  it('停止中・dispatched 1・実額 > U の行: 理由の文・再開が有効・止めるが無効・超過の強調は 1 行・「見る」は done だけ', () => {
    const recent = [row(1, { actual_cents: 12 }), row(2), row(3, { state: 'failed', error: 'server', actual_cents: null }), row(4, { state: 'refused', error: 'halted', u_cents: null, actual_cents: null })];
    const h = I.imagesHtml({ halted: 'quota', month_cents: 280, month_cap_cents: 3000, holds_open: 1, dispatched: 1, recent });
    expect(n(h, /data-img-state="halted"/g)).toBe(1);
    expect(h).toContain('<b data-img-reason="1">OpenAI の残高か上限に達しました</b>');
    expect(n(h, /data-img-disp="1"/g)).toBe(1);
    expect(n(h, /id="img-halt-btn" disabled>/g)).toBe(1);
    expect(n(h, /id="img-unhalt-btn">/g)).toBe(1);
    expect(n(h, /data-img-row="1"/g)).toBe(4);
    expect(n(h, /data-img-over="1"/g)).toBe(1);
    expect(n(h, /class="img-over"/g)).toBe(1);
    expect(n(h, /\/api\/images\/requests\/img_[0-9a-f]{32}\/file"/g)).toBe(2);
    expect(h).toContain('<b>280¢</b> / 3000¢');
  });
});

describe('確認画面のサムネイルの下の「生成: 正確さ・prompt の先頭 80 字」（§O-7 6）', () => {
  it('80 字（コードポイント）で切って … を付ける。短い prompt は切らない', () => {
    const long = '🟥'.repeat(10) + 'あ'.repeat(90);
    const c = I.genCaption({ accuracy: 'scientific', prompt: long });
    expect(c).toBe('生成: scientific・' + '🟥'.repeat(10) + 'あ'.repeat(70) + '…');
    expect(I.genCaption({ accuracy: 'standard', prompt: '青い三角' })).toBe('生成: standard・青い三角');
  });
  it('reviewHtml: generated_images のある画像だけ 1 行が付く（svg と生成でない png には付かない）', () => {
    const mat = goodMaterial() as { parts: Array<{ files: Array<Record<string, unknown>> }> };
    mat.parts[0].files = [
      { path: 'parts/p1/figure-1.svg', role: 'figure' },
      { path: 'parts/p1/gen-a.png', role: 'figure', image_id: imgId(1) },
      { path: 'parts/p1/plain.png', role: 'figure' },
    ];
    const d = {
      version: { id: 'v1', material_id: 'm1', version: 1, status: 'review', verification_status: 'done', material: mat, checks: {}, public_paths: [] },
      material: { id: 'm1', title: 't' },
      job: null, sources: [], claims: [], verification: null, verification_id: null, verification_history: [],
      generated_images: [{ path: 'parts/p1/gen-a.png', accuracy: 'scientific', prompt: '<script>x</script>' + 'あ'.repeat(100), alt: 'a' }],
    };
    const h = R.reviewHtml(d, R.newReviewState(), {});
    expect(n(h, /data-gen="1"/g)).toBe(1);
    expect(n(h, /class="thumb"/g)).toBe(3);
    expect(h).toContain('<p class="thumb-cap">生成: scientific・&lt;script&gt;x&lt;/script&gt;' + 'あ'.repeat(62) + '…</p>');
    expect(h).not.toContain('<script>x</script>');
    const none = R.reviewHtml({ ...d, generated_images: undefined }, R.newReviewState(), {});
    expect(n(none, /data-gen="1"/g)).toBe(0);
    expect(n(none, /class="thumb"/g)).toBe(3);
  });
});

describe('止める → 状況帯に停止の文 → 再開する → 消える（実ルートの応答を描く）', () => {
  let env: Env;
  const ctx = (method: string): RouteCtx => {
    const request = new Request('http://localhost/api/images/status', { method });
    return { env, request, url: new URL(request.url), email: 'ops@example.invalid', exec: {} as ExecutionContext, port: async () => { throw new Error('no'); } };
  };
  const band = async () => I.imagesBandHtml((await (await getStatus(ctx('GET'))).json()).images);
  const screen = async () => I.imagesHtml(await (await getImagesStatus(ctx('GET'))).json());
  beforeEach(() => {
    env = { DB: d1(migratedDb()) } as unknown as Env;
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  it('帯の停止の文の数が 0 → 1 → 0、画面のボタンの有効・無効が入れ替わる', async () => {
    expect(n(await band(), /data-img-halted="1"/g)).toBe(0);
    expect(n(await screen(), /id="img-unhalt-btn" disabled>/g)).toBe(1);
    expect((await haltImages(ctx('POST'))).status).toBe(200);
    const b1 = await band();
    expect(n(b1, /data-img-halted="1"/g)).toBe(1);
    expect(b1).toContain('画像の生成を止めています（手で止めました）');
    const s1 = await screen();
    expect(n(s1, /id="img-halt-btn" disabled>/g)).toBe(1);
    expect(n(s1, /id="img-unhalt-btn">/g)).toBe(1);
    expect((await unhaltImages(ctx('POST'))).status).toBe(200);
    expect(n(await band(), /data-img-halted="1"/g)).toBe(0);
    expect(n(await screen(), /data-img-state="running"/g)).toBe(1);
  });
});
