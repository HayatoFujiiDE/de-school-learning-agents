// 確認画面を「教材として見る」形にする・出典カード・付箋（§L-8）。admin.js の純関数を vm で読む（DOM は使わない）。
// 作り物のデータ test/fixtures/review-preview/detail.json は、見た目の確認（serve.mjs + headless Chrome）と共通。
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { triageVersion } from '../src/checks/triage';

type Obj = Record<string, any>;
const code = readFileSync(new URL('../public/admin/admin.js', import.meta.url), 'utf8');
const win: Obj = { __FACTORY_ADMIN_NO_BOOT__: true };
vm.runInNewContext(code, { window: win, console }, { timeout: 2000 });
const R = win.FactoryAdminReview as Obj;
const FIX = JSON.parse(readFileSync(new URL('./fixtures/review-preview/detail.json', import.meta.url), 'utf8')) as Obj;
const fixture = (): Obj => JSON.parse(JSON.stringify(FIX));
const n = (h: string, re: RegExp) => (h.match(re) || []).length;

describe('作り物のデータ（fixture）', () => {
  it('triage は triageVersion の結果と同じ（autoDerived = 自動の処置なし）', () => {
    const d = fixture();
    const t = triageVersion({
      claims: { claims: d.claims.map((c: Obj) => ({ id: c.id, text: c.text, status: c.status, source_ids: c.source_ids, used_in: c.used_in })) },
      report: { id: d.verification.id, result: { verdicts: d.claims.map((c: Obj) => ({ claim_id: c.id, verdict: c.verdict, reason: c.reason, opened_urls: c.opened_urls })) } },
      sources: d.sources,
      checks: d.version.checks,
      material: d.version.material,
      autoReverified: 0,
      autoDerived: true,
    });
    expect(d.triage).toEqual(JSON.parse(JSON.stringify(t)));
  });
});

describe('出典カード: 並び順・主張の逆引き・状態文', () => {
  it('問題のある順（食い違い → 開けていない → 利用条件不明 → 問題なし → 二次）。同じ順位は出典一覧の順', () => {
    const m = R.sourceCardsOf(fixture());
    expect(m.cards.map((c: Obj) => c.source.source_id)).toEqual(['s2', 's6', 's4', 's1', 's5', 's3']);
    expect(m.cards.map((c: Obj) => c.head.text)).toEqual([
      '出典と食い違う主張があります',
      '職人がこのページを開けていません',
      '利用条件が分かりません',
      '問題なし',
      '問題なし',
      '補助の出典（一次ではない）',
    ]);
    expect(m.total).toBe(6);
    expect(m.problems).toBe(3);
  });

  it('2 つ目以降の問題も残す（s2 = 食い違い + 引用不一致）。開けていないページの引用不一致は見出しを「開けていない」にまとめる', () => {
    const m = R.sourceCardsOf(fixture());
    const by = (sid: string) => m.cards.find((c: Obj) => c.source.source_id === sid);
    expect(by('s2').issues).toEqual(['contradicted', 'quote_mismatch']);
    expect(by('s6').issues).toEqual(['maker_url_not_fetched']);
    // 動画の出典（watch URL が版の動画と一致）は開けた・引用の検査をしない
    expect(by('s5').video).toBe(true);
    expect(by('s5').issues).toEqual([]);
    // 検証係が開いた URL（職人の URL と違う）
    expect(by('s2').opened).toEqual(['https://example.org/cells/nucleus-overview']);
  });

  it('主張の逆引き: 出典 id → 参照している主張（複数の出典を持つ主張は両方に出る）', () => {
    const by = R.claimsBySource(fixture().claims);
    expect(by.s1.map((c: Obj) => c.id)).toEqual(['c1', 'c3']);
    expect(by.s3.map((c: Obj) => c.id)).toEqual(['c3']);
    expect(by.s9.map((c: Obj) => c.id)).toEqual(['c7']);
    expect('s5' in by).toBe(false);
    // 形の違う値は飛ばす
    expect(Object.keys(R.claimsBySource([null, { id: 'x', source_ids: 's1' }, { id: 'y', source_ids: [1, 's2'] }]))).toEqual(['s2']);
  });

  it('出典の無い主張・一覧に無い出典を参照する主張は orphans', () => {
    const m = R.sourceCardsOf(fixture());
    expect(m.orphans.map((o: Obj) => [o.claim.id, o.why, o.missing])).toEqual([
      ['c6', 'no_source', []],
      ['c7', 'source_not_listed', ['s9']],
    ]);
  });

  it('仕分けが無い時は出典の列と主張の判定から（同じ順）', () => {
    const d = fixture();
    delete d.triage;
    const m = R.sourceCardsOf(d);
    expect(m.cards.map((c: Obj) => c.source.source_id)).toEqual(['s2', 's6', 's4', 's1', 's5', 's3']);
  });

  it('取得日と短い URL', () => {
    expect(R.accessedText('2026-11-04')).toBe('11/4 に取得');
    expect(R.accessedText('2026-11-04T10:00:00Z')).toBe('11/4 に取得');
    expect(R.accessedText('きのう')).toBe('きのう に取得');
    expect(R.accessedText(null)).toBe('');
    expect(R.shortUrl('https://www.example.org/')).toBe('example.org');
    expect(R.shortUrl('https://example.org/cells/nucleus-and-oxygen-capacity-of-mammalian-erythrocytes')).toBe('example.org/cells/nucleus-and-oxygen-capacity-of-ma…');
  });
});

describe('出典カードの HTML（reviewHtml の中）', () => {
  const h = R.reviewHtml(fixture(), R.newReviewState(), {});
  const panel = h.slice(h.indexOf('id="rv-sources"'), h.indexOf('id="rv-check"'));

  it('「出典 M 件のうち 問題 K 件」・カードは出典の数 + 出典のない主張の 1 枚', () => {
    expect(panel).toContain('出典 6 件のうち 問題 3 件');
    expect(n(panel, /data-src-card="/g)).toBe(6);
    expect(n(panel, /data-src-orphan="2"/g)).toBe(1);
    expect(panel).toContain('出典のない主張が 2 件あります');
    expect(panel).toContain('出典一覧にない出典: s9');
  });

  it('「問題なし」の中には問題の無い出典だけ（問題のある出典・主張を入れない）', () => {
    const ok = panel.slice(panel.indexOf('id="rv-src-ok"'));
    expect(ok).toContain('問題なし（出典 3 件。うち補助の出典 1 件）');
    expect(n(ok, /data-src-card="/g)).toBe(3);
    for (const bad of ['出典と食い違う主張があります', '職人がこのページを開けていません', '利用条件が分かりません', '出典のない主張']) expect(ok).not.toContain(bad);
    // 旧い「問題なし（主張 N 件・出典 M 件）」の見出しは使わない（中身が全件だったため）
    expect(h).not.toContain('<h2>問題なし（主張');
    expect(h).toContain('主張と出典の一覧（全件・照合の記録。主張 7 件・出典 6 件）');
  });

  it('引用の本文・引用不一致の赤枠・取得日・一次/二次・利用条件「分からない」', () => {
    expect(panel).toContain('<blockquote class="sc-quote is-bad">哺乳類の赤血球は核を持たないため、酸素の運搬量が増える。</blockquote>');
    expect(panel).toContain('職人が開いたページの本文に、この引用は見つかりませんでした');
    expect(panel).toContain('職人がこのページを開けていないため、引用を照らし合わせられていません');
    expect(panel).toContain('<blockquote class="sc-quote">赤血球は肺で受け取った酸素を全身へ運ぶ。</blockquote>');
    expect(panel).toContain('動画の出典のため、引用はありません');
    expect(panel).toContain('11/4 に取得');
    expect(n(panel, /<span class="sc-tag">二次<\/span>/g)).toBe(1);
    expect(panel).toContain('<span class="sc-lic-bad">分からない</span>');
    expect(panel).toContain('検証係が開いた URL（職人の URL と違います）');
  });

  it('生の英語コード（check_detail）は「照合の記録」の中だけ', () => {
    const head = panel.replace(/<details class="sc-log">[\s\S]*?<\/details>/g, '');
    for (const codeName of ['quote_not_found', 'not_fetched', 'no_excerpt', 'secondary']) expect(head).not.toContain(codeName);
    expect(panel).toContain('<code>quote_not_found</code>');
  });

  it('文字はすべてエスケープ・リンクは http(s) だけ', () => {
    const d = fixture();
    d.sources[0].title = '<b>x</b>';
    d.sources[0].quoted_excerpt = '<script>alert(1)</script>';
    d.sources[1].url = 'javascript:alert(1)';
    d.claims[0].text = '<img src=x onerror=alert(1)>';
    const p = R.reviewHtml(d, R.newReviewState(), {});
    expect(p).not.toContain('<b>x</b>');
    expect(p).not.toContain('<script>alert(1)</script>');
    expect(p).not.toContain('<img src=x');
    expect(p).not.toContain('href="javascript:');
  });

  it('既存の数える DOM（group・項目・サムネイル）は変わらない', () => {
    expect(n(h, /data-rv-group="/g)).toBe(FIX.triage.groups.length);
    expect(n(h, /data-ck="/g)).toBe(6);
    expect(n(h, /class="thumb"/g)).toBe(1);
    expect(n(h, /data-fig-verdict="/g)).toBe(1);
    expect(n(h, /data-videos="1"/g)).toBe(1);
  });
});

const md = (p: string) => readFileSync(new URL(`./fixtures/review-preview/files/${p}`, import.meta.url), 'utf8');
const BASE = '/api/review/vfix-0001/files/';

describe('教材プレビュー: [cN] は教材として見る時は出さない（inlineMd の中で外す）', () => {
  it('opts.cites を渡すと参照を外して id を集める。渡さなければ今までどおり', () => {
    const cites: string[] = [];
    expect(R.inlineMd('さんそを はこぶ。[c1, c3] つぶ [c2]', { cites, known: {} })).toBe('さんそを はこぶ。 つぶ');
    expect(cites).toEqual(['c1', 'c3', 'c2']);
    expect(R.inlineMd('はこぶ [c1]')).toBe('はこぶ [c1]');
  });

  it('リンクの記法・コードの中・主張 id でない括弧は残す。known にある id（c 以外の形）も外す', () => {
    const cites: string[] = [];
    expect(R.inlineMd('[c1](https://example.org/a) と `[c2]` と [注] と [claim-a]', { cites, known: { 'claim-a': 0 } })).toBe(
      '<a href="https://example.org/a" rel="noopener noreferrer" target="_blank">c1</a> と <code>[c2]</code> と [注] と',
    );
    expect(cites).toEqual(['claim-a']);
  });

  it('エスケープした後に外す（参照の中の記号でタグを作れない）', () => {
    const cites: string[] = [];
    const h = R.inlineMd('<b>x</b> [c1]', { cites, known: {} });
    expect(h).toBe('&lt;b&gt;x&lt;/b&gt;');
  });
});

describe('教材プレビュー: 本文（previewBodyHtml）', () => {
  const d = fixture();
  const p1 = d.version.material.parts[0];
  const p2 = d.version.material.parts[1];
  const model = R.sourceCardsOf(d);
  const o = (x: Obj = {}) => ({
    fileBase: BASE,
    marks: true,
    chips: true,
    stick: true,
    markIds: { c2: true, c5: true },
    claimIdx: Object.fromEntries(d.claims.map((c: Obj, i: number) => [c.id, i])),
    claimRef: R.claimRefsOf(d, model),
    frame: 0,
    pi: 0,
    ...x,
  });

  it('本文に [c1] 等が出ない（印 OFF でも ON でも）', () => {
    for (const marks of [false, true]) {
      const h = R.previewBodyHtml(md('parts/p1/p1-elementary-short.md'), p1, o({ marks }));
      expect(h).not.toMatch(/\[c\d/);
    }
  });

  it('図と動画は先頭の段落の直後（2 つ目の段落より前）', () => {
    const h = R.previewBodyHtml(md('parts/p1/p1-elementary-short.md'), p1, o());
    const fig = h.indexOf('<figure class="mp-fig"><img alt="図" src="/api/review/vfix-0001/files/parts/p1/p1-figure-1.svg"></figure>');
    const first = h.indexOf('data-para="0"');
    const second = h.indexOf('data-para="1"');
    expect(fig).toBeGreaterThan(first);
    expect(fig).toBeLessThan(second);
    const vid = h.indexOf('<div class="mp-video"><iframe src="https://www.youtube-nocookie.com/embed/abcdefghijk?start=30&amp;end=95&amp;rel=0"');
    expect(vid).toBeGreaterThan(fig);
    expect(vid).toBeLessThan(second);
    expect(h).toContain('見どころ</span>細い血管の中を');
    // youtube.com/embed は使わない
    expect(h).not.toContain('youtube.com/embed');
  });

  it('型 4 の app.html は本文の上（sandbox="allow-scripts" だけ）', () => {
    const h = R.previewBodyHtml(md('parts/p2/p2-elementary-short.md'), p2, o({ pi: 1 }));
    const app = h.indexOf('<div class="mp-app"><iframe class="mp-app-frame" sandbox="allow-scripts" title="動かせるもの" src="/api/review/vfix-0001/files/parts/p2/p2-app.html"></iframe></div>');
    expect(app).toBeGreaterThan(-1);
    expect(app).toBeLessThan(h.indexOf('data-para="0"'));
    expect(h).not.toContain('allow-same-origin');
  });

  it('型 4 以外の app.html は図と同じ位置。図の無い md（段落なし）でも図を出す', () => {
    const part = { ...p1, kind: 3, files: [{ path: 'parts/p1/x-app.html' }, { path: 'parts/p1/a.png', alt: '<図>' }], videos: [] };
    const h = R.previewBodyHtml('## 見出しだけ', part, o());
    expect(h).toContain('alt="&lt;図&gt;"');
    expect(h.indexOf('mp-app')).toBeGreaterThan(h.indexOf('見出しだけ'));
    expect(R.previewBodyHtml('', part, o())).toContain('mp-fig');
  });

  it('段落・箇条に data-para（0 始まり）・data-head（先頭 20 字）・data-cl（主張の番号）', () => {
    const h = R.previewBodyHtml(md('parts/p1/p1-elementary-short.md'), p1, o());
    expect(n(h, /data-para="/g)).toBe(7);
    expect(h).toContain('data-para="1" data-head="赤血球（せっけっきゅう）は、からだじゅう…" data-cl="0 2"');
    expect(h).toContain('id="mp-p-0-0-4" data-para="4"');
  });

  it('動画の id が正しくない時は埋め込まない', () => {
    const part = { ...p1, files: [], videos: [{ id: 'v1', youtube_id: 'bad"id', start_sec: 1, end_sec: 2 }] };
    const h = R.previewBodyHtml('a', part, o());
    expect(h).not.toContain('<iframe');
    expect(h).toContain('埋め込みません');
  });
});

describe('教材プレビュー: 枠（型の名前・最初にやること・要約・変奏の選び方）', () => {
  it('型の名前は日本語（数字でない）・最初にやること（種類つき）・子ども向けの要約', () => {
    const h = R.previewFrameHtml(fixture(), R.defaultPv(), 0);
    expect(h).toContain('<span class="mp-kind">説明と図解</span>');
    expect(h).toContain('<span class="mp-kind">動かせるもの</span>');
    expect(h).not.toContain('型 3');
    expect(h).toContain('最初にやること（見る）</span><p>図の 赤い 丸を 数えてみよう</p>');
    expect(h).toContain('最初にやること（さわる）');
    expect(h).toContain('<p class="mp-summary">赤血球が からだじゅうに');
    expect(h).toContain('data-mode="es"');
    expect(h).toContain('いま表示: <b>小学生・短い</b>');
    const js = R.previewFrameHtml(fixture(), { aud: 'secondary', len: 'long', game: false }, 1);
    expect(js).toContain('data-mode="js"');
    expect(js).toContain('<p class="mp-summary">赤血球が酸素を全身へ運ぶ仕組みを');
    expect(js).toContain('id="mp-body-1-0"');
    expect(R.kindName(9)).toBe('型 9');
  });

  it('既定は「小学生・短い」1 枠。変奏は学年 × 長さ、ゲーム版は同じ学年を先に。無ければ null', () => {
    const p1 = fixture().version.material.parts[0];
    const p2 = fixture().version.material.parts[1];
    expect(R.defaultPv()).toMatchObject({ aud: 'elementary', len: 'short', game: false, compare: false });
    expect(R.pickVariant(p1, { aud: 'elementary', len: 'short', game: false }).path).toBe('parts/p1/p1-elementary-short.md');
    expect(R.pickVariant(p1, { aud: 'secondary', len: 'long', game: false }).path).toBe('parts/p1/p1-secondary-long.md');
    expect(R.pickVariant(p1, { aud: 'secondary', len: 'short', game: true }).path).toBe('parts/p1/p1-game.md');
    expect(R.pickVariant(p2, { aud: 'elementary', len: 'short', game: true })).toBe(null);
    expect(R.newReviewState().pv).toEqual(R.defaultPv());
  });

  it('reviewHtml には本文の骨組みだけ（iframe・図は本文を読んでから入れる。既存の数える DOM は変えない）', () => {
    const h = R.reviewHtml(fixture(), R.newReviewState(), {});
    expect(h).toContain('id="mp-frames"');
    expect(n(h, /class="mat-preview"/g)).toBe(1);
    expect(n(h, /<iframe /g)).toBe(1); // 「説明と表現」の動画だけ
    expect(h).not.toContain('class="mp-fig"');
    expect(h).toContain('aria-pressed="true">小学生</button>');
  });
});
