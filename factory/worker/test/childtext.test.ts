// 子ども向け本文の機械検査（契約 V-5・V-11 u5）。checkChildText は純関数。
import { describe, expect, it } from 'vitest';
import { checkChildText, CHILD_TEXT_MAX, rawMarkupHit, stripMarkdownForCheck } from '../src/checks/childtext';
import { goodMaterial } from './helpers';

type M = ReturnType<typeof goodMaterial> & { parts: Array<Record<string, any>> };
const mat = (): M => goodMaterial() as M;
const texts = (o: Record<string, string>) => new Map(Object.entries(o));
const ES = 'parts/p1/elementary-short.md';

describe('file_name（契約 V-5）', () => {
  it('この版のファイル名（app.html・figure-1.svg）が本文・entry_point にあると当たる', () => {
    const m = mat();
    m.parts[0].files.push({ path: 'parts/p1/app.html', role: 'app' });
    m.parts[0].entry_point.text = 'figure-1.svg を見て、赤い線をたどろう';
    const hits = checkChildText(m, texts({ [ES]: 'app.html をひらいて、ボタンを押してみよう' }));
    expect(hits).toEqual([
      { path: ES, kind: 'file_name', sample: expect.stringContaining('app.html') },
      { path: 'material.json', kind: 'file_name', sample: expect.stringContaining('figure-1.svg') },
    ]);
  });

  it('版に無い名前（index.html を教える素材）は当たらない。最上位のファイル名（claims.json）は当たる', () => {
    const hits = checkChildText(mat(), texts({ [ES]: 'HTML のはじめのファイルは index.html と名前をつけます。\n作る側の claims.json は見ません。' }));
    expect(hits.map((h) => [h.kind, h.sample.includes('claims.json')])).toEqual([['file_name', true]]);
  });

  it('コード（囲み・行内）とリンクの URL の中は見ない。リンクの文は見る', () => {
    const md = ['```', 'app.html', '```', '`figure-1.svg` を使う', '[ここ](https://example.org/figure-1.svg) を見る', '[figure-1.svg の説明](https://example.org/x)'].join('\n');
    const hits = checkChildText(mat(), texts({ [ES]: md }));
    expect(hits).toEqual([{ path: ES, kind: 'file_name', sample: expect.stringContaining('figure-1.svg の説明') }]);
  });

  it('主張の印 [c3] は取り除いてから見る（印の数字やかっこは raw_markup にならない）', () => {
    expect(stripMarkdownForCheck('信号は進みます [c3]。')).toBe('信号は進みます 。');
    expect(checkChildText(mat(), texts({ [ES]: '信号は進みます [c3]。' }))).toEqual([]);
  });
});

describe('raw_markup（契約 V-5 (a)〜(h)。.md だけ）', () => {
  const one = (line: string) => checkChildText(mat(), texts({ [ES]: line })).filter((h) => h.kind === 'raw_markup');
  it.each([
    ['(a) ** が奇数個', 'ここは **太字 のつもり'],
    ['(b) __', 'これは __強調__ です'],
    ['(c) < の直後が英字', 'ここで <b>太字</b> にする'],
    ['(c) < の直後が /', 'とじる </span> だけ'],
    ['(d) 行頭（空白を除く）が |', '  | 列1 | 列2 |'],
    ['(e) ![', '![図](figure-1.png)'],
    ['(f) 行頭が >', '> 引用です'],
    ['(g) 行頭が # 5 個以上', '##### 小さすぎる見出し'],
    ['(h) * 1 個で囲んだ強調', 'これは *斜体* です'],
  ])('%s → 当たる', (_n, line) => {
    expect(one(line)).toHaveLength(1);
  });

  it.each([
    ['対になった **太字**', 'これは **太字** と **もう一つ** です'],
    ['見出し #〜####', '#### ふつうの見出し'],
    ['箇条書きの * ', '* 一つめ'],
    ['番号つき', '1. はじめに'],
    ['< の直後が数字・空白', '3 < 5 と 2 <= 4'],
    ['リンク（画像の埋め込みではない）', '[もっと知る](https://example.org/a_b__c)'],
  ])('%s → 当たらない', (_n, line) => {
    expect(one(line)).toEqual([]);
  });

  it('箇条書きの * の後ろに * 1 個の強調があれば当たる', () => {
    expect(rawMarkupHit('* これは *斜体* です')).not.toBeNull();
  });

  it('material.json の文は raw_markup を見ない（.md だけ）', () => {
    const m = mat();
    m.summary_elementary = 'これは **太字 のつもり';
    expect(checkChildText(m, texts({}))).toEqual([]);
  });

  it('空白 100 個の後にファイル名がある行でも sample は空でなくファイル名を含む（探索と切り出しを同じ文で行う）', () => {
    const [h] = checkChildText(mat(), texts({ [ES]: `${' '.repeat(100)}claims.json を開く` }));
    expect(h).toMatchObject({ path: ES, kind: 'file_name' });
    expect(h.sample).toContain('claims.json');
    expect(h.sample.length).toBeLessThanOrEqual(40);
    const m = mat();
    m.summary_elementary = `${' '.repeat(100)}\n\n figure-1.svg を見る`;
    const [s] = checkChildText(m, texts({}));
    expect(s).toMatchObject({ path: 'material.json', kind: 'file_name' });
    expect(s.sample).toContain('figure-1.svg');
  });

  it('sample は当たった所の前後を含む 40 字以内', () => {
    const line = `${'あ'.repeat(50)}<b>${'い'.repeat(50)}`;
    const [h] = one(line);
    expect(h.sample.length).toBeLessThanOrEqual(40);
    expect(h.sample).toContain('<b>');
  });
});

describe('件数と形', () => {
  it('20 件で切る', () => {
    const md = Array.from({ length: 30 }, (_, i) => `行 ${i} は <b>太字</b>`).join('\n');
    const hits = checkChildText(mat(), texts({ [ES]: md }));
    expect(hits).toHaveLength(CHILD_TEXT_MAX);
  });

  it('material の形が違っても例外を投げない', () => {
    expect(checkChildText(null, texts({}))).toEqual([]);
    expect(checkChildText({ parts: 'x' }, texts({}))).toEqual([]);
    expect(checkChildText({ parts: [null, { variants: [{ path: 3 }] }] }, texts({}))).toEqual([]);
  });
});
