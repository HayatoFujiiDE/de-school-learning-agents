// 確認画面を「教材として見る」形にする・出典カード・付箋（§L-8）。admin.js の純関数を vm で読む（DOM は使わない）。
// 作り物のデータ test/review-preview/detail.json は、見た目の確認（serve.mjs + headless Chrome）と共通。
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { triageVersion } from '../src/checks/triage';

type Obj = Record<string, any>;
const code = readFileSync(new URL('../public/admin/admin.js', import.meta.url), 'utf8');
const win: Obj = { __FACTORY_ADMIN_NO_BOOT__: true };
vm.runInNewContext(code, { window: win, console }, { timeout: 2000 });
const R = win.FactoryAdminReview as Obj;
const FIX = JSON.parse(readFileSync(new URL('./review-preview/detail.json', import.meta.url), 'utf8')) as Obj;
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

const md = (p: string) => readFileSync(new URL(`./review-preview/files/${p}`, import.meta.url), 'utf8');
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

describe('確認の印（ON / OFF）と、段落の印 ⇄ 出典カードの行き来', () => {
  const d = fixture();
  const model = R.sourceCardsOf(d);
  const o = (marks: boolean) => ({
    fileBase: BASE, marks, chips: true, stick: true, markIds: { c2: true, c5: true },
    claimIdx: Object.fromEntries(d.claims.map((c: Obj, i: number) => [c.id, i])), claimRef: R.claimRefsOf(d, model), frame: 0, pi: 0,
  });

  it('既定 ON（localStorage が無い環境でも落ちない）。ctx.marks = false なら OFF の表示', () => {
    expect(R.reviewHtml(fixture(), R.newReviewState(), {})).toContain('data-mp-marks="1" aria-pressed="true"');
    const off = R.reviewHtml(fixture(), R.newReviewState(), { marks: false });
    expect(off).toContain('data-mp-marks="1" aria-pressed="false"');
    expect(off).toContain('<span class="mp-marks-state">OFF</span>');
  });

  it('ON: 要確認の段落は黄色・段落末に「c5 → s2」の印（押すと出典カードへ）・付箋のボタン。OFF: 子どもが見るのと同じ（印・黄色・ボタンなし）', () => {
    const src = md('parts/p1/p1-elementary-short.md');
    const on = R.previewBodyHtml(src, d.version.material.parts[0], o(true));
    const s2 = model.cardOf.s2;
    expect(on).toContain(`<button type="button" class="mp-cite is-flag" data-goto="${s2}" title="c5 の出典カードへ">c5 → s2</button>`);
    expect(on).toContain('class="mp-para is-flag" id="mp-p-0-0-3"');
    expect(on).toContain('data-goto="rv-src-orphan" title="c6 の出典カードへ">c6 → 出典なし</button>');
    expect(n(on, /data-stick-open="/g)).toBe(7);
    const off = R.previewBodyHtml(src, d.version.material.parts[0], o(false));
    expect(off).not.toContain('mp-cite');
    expect(off).not.toContain('is-flag');
    expect(off).not.toContain('data-stick-open');
    // 本文の段落は同じ数（data-cl で出典カードから段落へ戻れる）
    expect(n(off, /data-para="/g)).toBe(7);
    expect(off).toContain('data-cl="4"');
  });

  it('一覧に無い主張 id の参照は赤い印（行き先なし）', () => {
    const h = R.previewBodyHtml('ふしぎ [c99]', d.version.material.parts[0], { ...o(true), claimIdx: {} });
    expect(h).toContain('<span class="mp-cite is-missing">c99（一覧にない主張）</span>');
  });

  it('出典カードの主張 id は本文の段落へ（data-goto-claim = 主張の番号）・要確認のカードから出典カードへ', () => {
    const h = R.reviewHtml(fixture(), R.newReviewState(), {});
    expect(h).toContain('<button type="button" class="linkish sc-cid" data-goto-claim="4" title="本文のこの主張の段落へ">c5</button>');
    expect(h).toContain(`data-goto="${model.cardOf.s2}">出典カードで見る →</button>`);
    expect(h).toContain('data-goto="rv-src-orphan">出典のない主張のカードで見る →</button>');
    // 出典カードは 2 列の右（教材プレビューと同じ rv-study の中）
    expect(h.indexOf('id="rv-src-col"')).toBeGreaterThan(h.indexOf('id="mp-frames"'));
    expect(h.indexOf('id="rv-src-col"')).toBeLessThan(h.indexOf('id="rv-check"'));
  });
});

describe('付箋 → 差し戻しの理由の文', () => {
  const st1 = { id: 1, part_id: 'p1', part_title: '赤血球のしごと', part_index: 0, variant_path: 'parts/p1/p1-elementary-short.md', variant_label: '小学生・短い', para_index: 2, head: '赤血球は 血の中で いちばん 数が 多い…', kind: 'hard', text: '「いちばん」の根拠', flowed: false };
  const st2 = { ...st1, id: 2, para_index: 0, head: '図の', kind: 'other', text: '' };

  it('1 件 = 1 行（場所・段落の番号・先頭 20 字・分類・一言）', () => {
    expect(R.stickyLine(st1)).toBe('- parts/p1/p1-elementary-short.md 3 段落目「赤血球は 血の中で いちばん 数が 多い…」: 言葉が難しい — 「いちばん」の根拠');
    expect(R.stickyLine(st2)).toBe('- parts/p1/p1-elementary-short.md 1 段落目「図の」: その他');
    expect(R.STICK_KINDS.map((k: string[]) => k[1])).toEqual(['言葉が難しい', '長い', '図と合わない', '事実が心配', 'その他']);
  });

  it('既に書いてある理由は消さず、その後ろに箇条書きで足す（空なら付箋の行だけ）', () => {
    expect(R.stickyNoteText('出典を直してください\n', [st1, st2])).toEqual({
      note: '出典を直してください\n' + R.stickyLine(st1) + '\n' + R.stickyLine(st2),
      added: 2,
      lines: [R.stickyLine(st1), R.stickyLine(st2)],
    });
    expect(R.stickyNoteText('', [st1]).note).toBe(R.stickyLine(st1));
  });

  it('理由の上限 4000 字を超える行は足さない（added で何件入れたかを返す）', () => {
    const r = R.stickyNoteText('あ'.repeat(3950), [st1, st2]);
    expect(r.added).toBe(0);
    expect(r.note.length).toBe(3950);
    const r2 = R.stickyNoteText('あ'.repeat(3900), [st2, st1]);
    expect(r2.added).toBe(1);
    expect(r2.note.length).toBeLessThanOrEqual(4000);
  });

  it('一覧: 空の時の文・件数・まだ入れていない数・入れた印・1 件ずつの「消す」。文字はエスケープ', () => {
    expect(R.stickyListHtml([])).toContain('付箋はまだありません');
    const h = R.stickyListHtml([{ ...st1, text: '<b>x</b>' }, { ...st2, flowed: true }]);
    expect(h).toContain('<b>付箋 2 件</b>');
    expect(h).toContain('まだ入れていない 1 件を理由欄に箇条書きで足します');
    expect(n(h, /data-stick-del="/g)).toBe(2);
    expect(h).toContain('理由欄に入れました');
    expect(h).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(h).not.toContain('<b>x</b>');
    expect(R.stickyListHtml([{ ...st1, flowed: true }])).toContain('すべて理由欄に入れました');
  });

  it('付箋のある段落には「付箋 N」の印。付箋は reviewStates の版ごとの状態に持つ', () => {
    const d = fixture();
    const h = R.previewBodyHtml(md('parts/p1/p1-elementary-short.md'), d.version.material.parts[0], { fileBase: BASE, marks: true, stickies: [st1, { ...st1, id: 3 }] });
    expect(h).toContain('class="mp-para has-stick" id="mp-p-0-0-2"');
    expect(h).toContain('<span class="mp-stuck" title="この段落の付箋">付箋 2</span>');
    expect(R.newReviewState()).toMatchObject({ stickies: [], stickySeq: 0 });
    const withList = R.reviewHtml(d, { ...R.newReviewState(), stickies: [st1] }, {});
    expect(withList).toContain('id="mp-stickies"');
    expect(withList).toContain('<b>付箋 1 件</b>');
  });
});

describe('見比べ（左右 2 枠）', () => {
  it('pv.compare で枠が 2 つ・右の枠に自分の切り替え・出典の欄は下へ（2 列をやめる）', () => {
    const st = R.newReviewState();
    expect(R.reviewHtml(fixture(), st, {})).toContain('data-pv="compare" data-val="1" data-pvf="0" aria-pressed="false">見比べ</button>');
    st.pv.compare = true;
    const h = R.reviewHtml(fixture(), st, {});
    expect(n(h, /class="mat-preview"/g)).toBe(2);
    expect(h).toContain('class="rv-study is-compare"');
    expect(h).toContain('class="mp-frames is-compare"');
    expect(h).toContain('data-pv="aud" data-val="secondary" data-pvf="1" aria-pressed="true">中学生</button>');
    expect(h).toContain('見比べの間は、出典と主張の欄を下に移しています。');
    expect(h).toContain('data-pv="compare" data-val="1" data-pvf="0" aria-pressed="true">見比べ</button>');
    // 右の枠には見比べのボタンを出さない
    expect(n(h, /data-pv="compare"/g)).toBe(1);
  });
});

describe('レビューの指摘への対応（2026-11-07）', () => {
  const st1 = { id: 1, part_id: 'p1', part_title: 't', part_index: 0, variant_path: 'parts/p1/p1-elementary-short.md', variant_label: '小学生・短い', para_index: 2, head: '赤血球は', kind: 'hard', text: '難しい', flowed: false };
  const st2 = { ...st1, id: 2, para_index: 3, kind: 'fact', text: '' };

  it('1. 印 OFF の時は付箋の目印（has-stick・「付箋 N」）も出さない（付箋の一覧には残る）', () => {
    const d = fixture();
    const src = md('parts/p1/p1-elementary-short.md');
    const off = R.previewBodyHtml(src, d.version.material.parts[0], { fileBase: BASE, marks: false, stickies: [st1] });
    expect(off).not.toContain('has-stick');
    expect(off).not.toContain('mp-stuck');
    const on = R.previewBodyHtml(src, d.version.material.parts[0], { fileBase: BASE, marks: true, stickies: [st1] });
    expect(on).toContain('class="mp-para has-stick" id="mp-p-0-0-2"');
    expect(on).toContain('付箋 1</span>');
    expect(R.reviewHtml(d, { ...R.newReviewState(), stickies: [st1] }, { marks: false })).toContain('<b>付箋 1 件</b>');
  });

  it('2. 却下で送る理由には流し込んだ付箋の行を入れない（差し戻しは入れる・理由欄はそのまま）。外して空なら空', () => {
    const r = R.stickyNoteText('出典を直して', [st1, st2]);
    const st = { ...R.newReviewState(), note: r.note, flowedLines: r.lines };
    expect(R.decisionNote(st, 'reject')).toBe('出典を直して');
    expect(R.decisionNote(st, 'return')).toBe(r.note);
    expect(st.note).toBe(r.note);
    const only = R.stickyNoteText('', [st1]);
    expect(R.decisionNote({ note: only.note, flowedLines: only.lines }, 'reject').trim()).toBe('');
    // 同じ文の行をオーナーが自分でも書いていたら、流し込んだ数だけ外す
    const dup = R.stickyLine(st1);
    expect(R.noteWithoutStickyLines(`${dup}\n${dup}`, [dup])).toBe(dup);
    expect(R.decisionNote({ note: 'a', flowedLines: undefined }, 'reject')).toBe('a');
  });

  it('3. オーナーの理由の末尾の空白・改行は削らない（区切りの改行だけ足す）。1 件も足せない時は元のまま', () => {
    expect(R.stickyNoteText('理由  ', [st1]).note).toBe('理由  \n' + R.stickyLine(st1));
    expect(R.stickyNoteText('理由\n\n', [st1]).note).toBe('理由\n\n' + R.stickyLine(st1));
    expect(R.stickyNoteText('理由\n', [st1]).note).toBe('理由\n' + R.stickyLine(st1));
    const full = 'あ'.repeat(3999) + ' ';
    const r = R.stickyNoteText(full, [st1]);
    expect(r).toEqual({ note: full, added: 0, lines: [] });
  });

  it('4. 段落の先頭 20 字はコードポイントで切る（サロゲートペアを割らない）', () => {
    const d = fixture();
    const raw = '𠮷'.repeat(25) + ' [c1]';
    const h = R.previewBodyHtml(raw, d.version.material.parts[0], { fileBase: BASE, marks: false });
    expect(h).toContain(`data-head="${'𠮷'.repeat(20)}…"`);
    const h2 = R.previewBodyHtml('😀'.repeat(20), d.version.material.parts[0], { fileBase: BASE, marks: false });
    expect(h2).toContain(`data-head="${'😀'.repeat(20)}"`);
  });

  it('5. 主張 id を外す処理は長い空白の行で 2 乗にならない（16 万個の空白で 100ms 以内）', () => {
    const spaces = ' '.repeat(160000);
    for (const line of [spaces + 'x', spaces + '[注', spaces + '[c1', 'a' + spaces + '[c1]', spaces]) {
      const t0 = performance.now();
      R.stripCites(line, {}, []);
      expect(performance.now() - t0).toBeLessThan(100);
    }
    const t1 = performance.now();
    R.inlineMd(spaces + 'x', { cites: [], known: {} });
    expect(performance.now() - t1).toBeLessThan(100);
    // 直前の空白（半角・タブ・全角）も外す
    const out: string[] = [];
    expect(R.stripCites('a \t　[c1]。b', {}, out)).toBe('a。b');
    expect(out).toEqual(['c1']);
  });

  it('7. 付箋の一言欄の Enter は IME の変換中（isComposing・keyCode 229）は付けない', () => {
    expect(R.stickyKeyAction({ key: 'Enter' }, true)).toBe('add');
    expect(R.stickyKeyAction({ key: 'Enter' }, false)).toBe('need_kind');
    expect(R.stickyKeyAction({ key: 'Enter', isComposing: true }, true)).toBe(null);
    expect(R.stickyKeyAction({ key: 'Enter', keyCode: 229 }, true)).toBe(null);
    expect(R.stickyKeyAction({ key: 'Process', keyCode: 229 }, true)).toBe(null);
    expect(R.stickyKeyAction({ key: 'Escape' }, true)).toBe('cancel');
    expect(R.stickyKeyAction({ key: 'a' }, true)).toBe(null);
  });

  it('8. 付箋の入力の枠の中（種類ボタン・付ける/やめる）にフォーカスがある時は「入力中」= キー操作が効かない。見比べの時は右の枠も探す', () => {
    const el = (tagName: string, inForm: boolean) => ({ tagName, closest: (q: string) => (q === '[data-stick-form]' && inForm ? {} : null) });
    expect(R.inInputOf(el('BUTTON', true))).toBe(true);
    expect(R.inInputOf(el('BUTTON', false))).toBe(false);
    expect(R.inInputOf(el('INPUT', false))).toBe(true);
    expect(R.inInputOf(el('TEXTAREA', false))).toBe(true);
    expect(R.inInputOf({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(R.inInputOf(null)).toBe(false);
    const env = { inInput: R.inInputOf(el('BUTTON', true)), dialogOpen: false, busy: false, draft: false };
    for (const k of ['1', 'a', 'r', 'x', 'j', 'k']) expect(R.keyCommand({ key: k, code: /\d/.test(k) ? `Digit${k}` : `Key${k.toUpperCase()}` }, env)).toBe(null);
    expect(R.keyCommand({ key: 'a', code: 'KeyA' }, { ...env, inInput: R.inInputOf(el('BUTTON', false)) })).toEqual({ cmd: 'approve' });
    expect(R.claimParaSelectors(4, false)).toEqual(['.mat-preview[data-frame="0"] [data-cl~="4"]']);
    expect(R.claimParaSelectors('4"]x', true)).toEqual(['.mat-preview[data-frame="0"] [data-cl~="4"]', '.mat-preview[data-frame="1"] [data-cl~="4"]']);
  });
});
