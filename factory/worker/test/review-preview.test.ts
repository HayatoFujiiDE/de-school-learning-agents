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
