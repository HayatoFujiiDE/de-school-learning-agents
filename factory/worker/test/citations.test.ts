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

describe('accumulateCitations（ページ分割で流し込んでも同じ結果）', () => {
  it('2 ページに分けても、result が use より先に来ても checkCitations と一致する', async () => {
    const { accumulateCitations, finishCitations, newCitationAcc } = await import('../src/checks/citations');
    const sources = [
      { id: 's1', url: 'https://minecraft.wiki/w/R', quoted_excerpt: '最大 15 ブロック', is_primary: true },
      { id: 's2', url: 'https://minecraft.wiki/w/T', quoted_excerpt: '無い文', is_primary: true },
    ];
    const events = [
      fetchUse('a', 'https://minecraft.wiki/w/R'),
      result('a', 'ページ本文: 最大 15 ブロック。'),
      fetchUse('b', 'https://minecraft.wiki/w/T'),
      result('b', '別の本文'),
    ];
    const whole = checkCitations(sources, events);
    const acc = newCitationAcc();
    accumulateCitations(acc, sources, [events[3], events[1]]);
    const restored = JSON.parse(JSON.stringify(acc));
    accumulateCitations(restored, sources, [events[0], events[2]]);
    expect(finishCitations(restored, sources)).toEqual(whole);
    expect(whole.sources.map((s) => s.check_detail)).toEqual(['ok', 'quote_not_found']);
  });
});

describe('accumulateCitations の集計は出典単位・URL 単位（tool_result 数 × 出典数で肥大しない）', () => {
  // 合成入力: 出典 200 件（引用 700 文字・URL は 10 種）、web_fetch 300 回の結果がどれも全出典の引用を含む。
  // さらに web_fetch 以外の tool（sources.json を表示した等）の結果 300 件も全出典の引用を含む。
  // 旧実装（tool_use_id ごとに一致した出典 id の配列を持つ）では 300 × 200 個の id を持ち、JSON が 1,000,000 文字を超える
  const N_SOURCES = 200;
  const N_RESULTS = 300;
  const sources = Array.from({ length: N_SOURCES }, (_, i) => {
    const id = `src-${String(i).padStart(3, '0')}-kkkkkkkkkk`;
    return { id, url: `https://example.com/page/${i % 10}`, quoted_excerpt: `[${id}] ${'あいうえおかきくけこ'.repeat(70)}`.slice(0, 700), is_primary: true };
  });
  const page = sources.map((s) => s.quoted_excerpt).join(' ');
  const events: unknown[] = [];
  for (let j = 0; j < N_RESULTS; j++) {
    events.push(fetchUse(`sevt_fetch_${j}`, `https://example.com/page/${j % 10}`), result(`sevt_fetch_${j}`, page));
    events.push({ type: 'agent.tool_use', id: `sevt_bash_${j}`, name: 'bash', input: { command: 'cat sources.json' } }, result(`sevt_bash_${j}`, page));
  }

  it('JSON にしても 1,000,000 文字未満で、判定は全出典 ok', async () => {
    const { accumulateCitations, finishCitations, newCitationAcc } = await import('../src/checks/citations');
    const acc = newCitationAcc();
    for (let k = 0; k < events.length; k += 20) accumulateCitations(acc, sources, events.slice(k, k + 20));
    expect(JSON.stringify(acc).length).toBeLessThan(1_000_000);
    const r = finishCitations(acc, sources);
    expect(r.summary).toEqual({ total: N_SOURCES, fetched: N_SOURCES, quoted: N_SOURCES });
    expect(new Set(r.sources.map((s) => s.check_detail))).toEqual(new Set(['ok']));
  });
});
