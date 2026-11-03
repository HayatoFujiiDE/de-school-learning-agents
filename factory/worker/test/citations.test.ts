import { describe, expect, it } from 'vitest';
import { checkCitations, normalizeSpace, normalizeUrl } from '../src/checks/citations';

const fetchUse = (id: string, url: string) => ({ type: 'agent.tool_use', id, name: 'web_fetch', input: { url } });
const result = (tool_use_id: string, text: string) => ({ type: 'agent.tool_result', id: `r_${tool_use_id}`, tool_use_id, content: [{ type: 'text', text }] });

describe('normalizeUrl', () => {
  it('小文字 host・fragment 除去・末尾 / 除去・http→https', () => {
    expect(normalizeUrl('http://Minecraft.Wiki/w/Redstone/#top')).toBe('https://minecraft.wiki/w/Redstone');
    expect(normalizeUrl('https://minecraft.wiki/')).toBe('https://minecraft.wiki');
    expect(normalizeUrl('https://minecraft.wiki/w/A?x=1#f')).toBe('https://minecraft.wiki/w/A?x=1');
  });
  it('path の大文字小文字は区別する', () => {
    expect(normalizeUrl('https://a.example/W/X')).not.toBe(normalizeUrl('https://a.example/w/x'));
  });
});

describe('checkCitations', () => {
  const excerpt = 'レッドストーンダストは  信号を\n運ぶ';
  const page = 'ページ本文: レッドストーンダストは 信号を 運ぶ。最大 15 ブロック。';

  it('正規化した URL で一致し、空白正規化した引用が部分一致すれば ok', () => {
    const r = checkCitations(
      [{ id: 's1', url: 'http://minecraft.wiki/w/Redstone_Dust/', quoted_excerpt: excerpt, is_primary: true }],
      [fetchUse('sevt_1', 'https://MINECRAFT.wiki/w/Redstone_Dust#x'), result('sevt_1', page)],
    );
    expect(r.sources[0]).toEqual({ source_id: 's1', url_was_fetched: 1, quote_found: 1, check_detail: 'ok' });
    expect(r.summary).toEqual({ total: 1, fetched: 1, quoted: 1 });
  });

  it('fetch していない URL は url_was_fetched=0', () => {
    const r = checkCitations([{ id: 's2', url: 'https://minecraft.wiki/w/Other', quoted_excerpt: 'x', is_primary: true }], [
      fetchUse('sevt_1', 'https://minecraft.wiki/w/Redstone_Dust'),
      result('sevt_1', page),
    ]);
    expect(r.sources[0]).toMatchObject({ url_was_fetched: 0, quote_found: 0, check_detail: 'not_fetched' });
  });

  it('本文に無い引用は quote_found=0（quote_not_found）', () => {
    const r = checkCitations([{ id: 's1', url: 'https://minecraft.wiki/w/Redstone_Dust', quoted_excerpt: '本文に無い文', is_primary: true }], [
      fetchUse('sevt_1', 'https://minecraft.wiki/w/Redstone_Dust'),
      result('sevt_1', page),
    ]);
    expect(r.sources[0]).toMatchObject({ url_was_fetched: 1, quote_found: 0, check_detail: 'quote_not_found' });
  });

  it('tool_result が無い時は result_unavailable', () => {
    const r = checkCitations([{ id: 's1', url: 'https://minecraft.wiki/w/Redstone_Dust', quoted_excerpt: 'x', is_primary: true }], [
      fetchUse('sevt_1', 'https://minecraft.wiki/w/Redstone_Dust'),
    ]);
    expect(r.sources[0]).toMatchObject({ url_was_fetched: 1, quote_found: 0, check_detail: 'result_unavailable' });
  });

  it('本文が offload された（ファイルパスだけ）時は result_unavailable', () => {
    const r = checkCitations([{ id: 's1', url: 'https://minecraft.wiki/w/Redstone_Dust', quoted_excerpt: '信号を運ぶ', is_primary: true }], [
      fetchUse('sevt_1', 'https://minecraft.wiki/w/Redstone_Dust'),
      result('sevt_1', 'Output too large. Saved to /mnt/session/tool-output/abc.txt'),
    ]);
    expect(r.sources[0]).toMatchObject({ quote_found: 0, check_detail: 'result_unavailable' });
  });

  it('is_primary=0 は secondary（値は計算するが赤にしない）', () => {
    const r = checkCitations([{ id: 's9', url: 'https://example.com/a', quoted_excerpt: 'x', is_primary: false }], []);
    expect(r.sources[0]).toMatchObject({ url_was_fetched: 0, check_detail: 'secondary' });
  });

  it('同じ URL を複数回 fetch した時はどれかの結果に引用があれば ok', () => {
    const r = checkCitations([{ id: 's1', url: 'https://minecraft.wiki/w/R', quoted_excerpt: '最大 15 ブロック', is_primary: true }], [
      fetchUse('a', 'https://minecraft.wiki/w/R'),
      result('a', 'エラー'),
      fetchUse('b', 'https://minecraft.wiki/w/R'),
      result('b', page),
    ]);
    expect(r.sources[0].quote_found).toBe(1);
  });

  it('web_fetch 以外の tool_use は数えない', () => {
    const r = checkCitations([{ id: 's1', url: 'https://minecraft.wiki/w/R', quoted_excerpt: 'x', is_primary: true }], [
      { type: 'agent.tool_use', id: 'z', name: 'web_search', input: { url: 'https://minecraft.wiki/w/R' } },
    ]);
    expect(r.sources[0].url_was_fetched).toBe(0);
  });

  it('normalizeSpace', () => expect(normalizeSpace(' a \n\t b ')).toBe('a b'));
});
