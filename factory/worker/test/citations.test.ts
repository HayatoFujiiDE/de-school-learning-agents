import { describe, expect, it } from 'vitest';
import {
  accumulateCitations,
  checkCitations,
  finishCitations,
  isCitationAcc,
  newCitationAcc,
  normalizeSpace,
  normalizeUrl,
  type CitationAcc,
} from '../src/checks/citations';

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

  it('試みた fetch が全部エラー（url_not_accessible）なら開いていない（§R-48）。1 回でも開けていれば開いた', () => {
    const err = (id: string) => ({ type: 'agent.tool_result', id: `r_${id}`, tool_use_id: id, is_error: true, content: [{ type: 'text', text: 'Web fetch error: url_not_accessible' }] });
    const src = [{ id: 's1', url: 'https://minecraft.wiki/w/Redstone_Dust', quoted_excerpt: '信号を運ぶ', is_primary: true }];
    const failed = checkCitations(src, [fetchUse('a', src[0].url), err('a'), fetchUse('b', src[0].url), err('b')]);
    expect(failed.sources[0]).toMatchObject({ url_was_fetched: 0, quote_found: 0, check_detail: 'not_fetched' });
    expect(failed.summary.fetched).toBe(0);
    const okLater = checkCitations(src, [fetchUse('a', src[0].url), err('a'), fetchUse('b', src[0].url), result('b', 'ダストは信号を運ぶ。')]);
    expect(okLater.sources[0]).toMatchObject({ url_was_fetched: 1, quote_found: 1, check_detail: 'ok' });
    const errOnlyThenPending = checkCitations(src, [fetchUse('a', src[0].url), err('a'), fetchUse('b', src[0].url)]);
    expect(errOnlyThenPending.sources[0]).toMatchObject({ url_was_fetched: 1, check_detail: 'result_unavailable' });
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

describe('accumulateCitations（古い順にページ分割で流し込んでも同じ結果）', () => {
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

  it('古い順に 2 ページへ分け、間で JSON にして戻しても checkCitations と一致する', () => {
    const whole = checkCitations(sources, events);
    const acc = newCitationAcc();
    accumulateCitations(acc, sources, events.slice(0, 1)); // use だけ来た所でページが切れる
    const restored = JSON.parse(JSON.stringify(acc));
    expect(isCitationAcc(restored)).toBe(true);
    accumulateCitations(restored, sources, events.slice(1));
    expect(finishCitations(restored, sources)).toEqual(whole);
    expect(whole.sources.map((s) => s.check_detail)).toEqual(['ok', 'quote_not_found']);
  });

  it('use より先に来た result は無視される（古い順の契約 §B-4-d。仮集計は持たない）', () => {
    const acc = newCitationAcc();
    accumulateCitations(acc, sources, [events[1], events[3]]); // result だけ先
    accumulateCitations(acc, sources, [events[0], events[2]]);
    const r = finishCitations(acc, sources);
    // fetch した URL ではあるが、対応する本文を照合していない
    expect(r.sources.map((x) => [x.url_was_fetched, x.check_detail])).toEqual([
      [1, 'result_unavailable'],
      [1, 'result_unavailable'],
    ]);
    expect(Object.keys(acc)).not.toContain('pend');
  });

  it('result を処理し終えた fetch の id は fetches から消える（未完了の fetch だけ残る）。判定は変わらない', () => {
    const acc = newCitationAcc();
    accumulateCitations(acc, sources, [events[0], events[1], events[2]]);
    expect(Object.keys(acc.fetches)).toEqual(['k:b']); // a は処理済み、b は result 待ち
    accumulateCitations(acc, sources, [events[3]]);
    expect(Object.keys(acc.fetches)).toEqual([]);
    expect(finishCitations(acc, sources)).toEqual(checkCitations(sources, events));
  });

  it('url 無し / web_fetch 以外として先に来た id が後で web_fetch として来たら web_fetch として扱う（nf から消す）', () => {
    const acc = newCitationAcc();
    accumulateCitations(acc, sources, [
      { type: 'agent.tool_use', id: 'x', name: 'web_fetch', input: {} },
      { type: 'agent.tool_use', id: 'y', name: 'bash', input: { command: 'ls' } },
    ]);
    expect(Object.keys(acc.nf).sort()).toEqual(['k:x', 'k:y']);
    accumulateCitations(acc, sources, [fetchUse('x', 'https://minecraft.wiki/w/R'), result('x', '最大 15 ブロック')]);
    expect(Object.keys(acc.nf)).toEqual(['k:y']);
    expect(finishCitations(acc, sources).sources[0]).toMatchObject({ url_was_fetched: 1, quote_found: 1, check_detail: 'ok' });
  });

  it('旧形式（pend を持つ / 版の無い形）は isCitationAcc=false（呼び出し側が先頭から集計し直す）', () => {
    expect(isCitationAcc({ fetches: {}, urls: {}, q: {}, nf: {}, pend: {} })).toBe(false);
    expect(isCitationAcc({ fetches: {}, results: {} })).toBe(false);
    expect(isCitationAcc({ v: 2, fetches: {}, urls: {}, q: {}, nf: {} })).toBe(false); // v2 は試みた fetch も数えていた（§R-48）
    expect(isCitationAcc({ v: 2, fetches: [], urls: {}, q: {}, nf: {} })).toBe(false);
    expect(isCitationAcc(newCitationAcc())).toBe(true);
  });
});

describe('出典 id / tool_use id が継承プロパティ名でも正しく判定する（職人の出力は信頼できない入力）', () => {
  const NAMES = ['constructor', '__proto__', 'toString', 'hasOwnProperty'];
  const url = 'https://minecraft.wiki/w/R';
  const quoteOf = (n: string) => `引用 ${n} の本文`;

  it('4 件とも本文に引用があれば ok（JSON に戻した後も同じ）', () => {
    const sources = NAMES.map((id) => ({ id, url, quoted_excerpt: quoteOf(id), is_primary: true }));
    // tool_use id にも同じ名前を使う。result だけ来る id（hasOwnProperty）・web_fetch 以外の id（constructor の bash）も混ぜる
    const events = [
      { type: 'agent.tool_use', id: 'constructor', name: 'bash', input: { command: 'cat sources.json' } },
      result('constructor', NAMES.map(quoteOf).join(' ')),
      result('hasOwnProperty', NAMES.map(quoteOf).join(' ')),
      fetchUse('__proto__', url),
      fetchUse('toString', 'https://minecraft.wiki/w/Other'),
    ];
    const acc = newCitationAcc();
    accumulateCitations(acc, sources, events);
    const restored = JSON.parse(JSON.stringify(acc));
    expect(isCitationAcc(restored)).toBe(true);
    accumulateCitations(restored, sources, [result('__proto__', `ページ: ${NAMES.map(quoteOf).join(' / ')}`), result('toString', '別の本文')]);
    const r = finishCitations(restored, sources);
    expect(r.sources.map((x) => [x.source_id, x.url_was_fetched, x.quote_found, x.check_detail])).toEqual(NAMES.map((n) => [n, 1, 1, 'ok']));
    expect(r.summary).toEqual({ total: 4, fetched: 4, quoted: 4 });
    expect(Object.getPrototypeOf(restored.q)).toBe(Object.prototype); // __proto__ を書き換えていない
    expect(({} as Record<string, unknown>).k).toBeUndefined();
  });

  it('引用が本文に無い 4 件は quote_not_found（継承プロパティを「見つかった」と読まない）', () => {
    const sources = NAMES.map((id) => ({ id, url, quoted_excerpt: quoteOf(id), is_primary: true }));
    const r = checkCitations(sources, [fetchUse('toString', url), result('toString', '関係ない本文')]);
    expect(r.sources.map((x) => x.check_detail)).toEqual(NAMES.map(() => 'quote_not_found'));
  });

  it('result_unavailable も同じ（use だけで result が無い fetch の id が継承プロパティ名）', () => {
    const sources = NAMES.map((id) => ({ id, url, quoted_excerpt: quoteOf(id), is_primary: true }));
    const r = checkCitations(sources, [fetchUse('constructor', url)]);
    expect(r.sources.map((x) => x.check_detail)).toEqual(NAMES.map(() => 'result_unavailable'));
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
  const utf8 = (s: string) => new TextEncoder().encode(s).byteLength;

  it('古い順に 3 ページへ分けて JSON で保存し直しても、途中も最後も UTF-8 で 200,000 bytes 未満。判定は全出典 ok', () => {
    const per = Math.ceil(events.length / 3);
    let acc: CitationAcc = newCitationAcc();
    const sizes: number[] = [];
    for (let k = 0; k < events.length; k += per) {
      accumulateCitations(acc, sources, events.slice(k, k + per));
      const json = JSON.stringify(acc);
      sizes.push(utf8(json));
      acc = JSON.parse(json);
    }
    expect(sizes.length).toBe(3);
    for (const b of sizes) expect(b).toBeLessThan(200_000);
    expect(Object.keys(acc.fetches)).toEqual([]); // 処理済み fetch の id は残らない
    const r = finishCitations(acc, sources);
    expect(r.summary).toEqual({ total: N_SOURCES, fetched: N_SOURCES, quoted: N_SOURCES });
    expect(new Set(r.sources.map((s) => s.check_detail))).toEqual(new Set(['ok']));
  });
});
