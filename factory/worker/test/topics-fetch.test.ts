// contract-T T-14 b9（出典を開く）と b10（生成の応答からの照合）
import { describe, expect, it } from 'vitest';
import { checkSourceUrl, fetchSource, normalizeForQuote, quoteOutcome } from '../src/topics/fetch-source';
import { genFetchTexts, matchGenFetch, sameUrl } from '../src/topics/gen';
import { fetchStub, genMessage, newsBody } from './topics-helpers';

const Q = 'これは出典のページに書いてある二十字以上の引用の文章です。';
const page = (inner: string) => `<html><body><p>${inner}</p></body></html>`;

describe('checkSourceUrl（T-5 の 2 の URL の規則）', () => {
  it.each([
    'http://example.org/a',
    'https://user:pw@example.org/a',
    'https://user@example.org/a',
    'https://example.org:8443/a',
    'https://127.0.0.1/a',
    'https://0x7f.1/a',
    'https://2130706433/a',
    'https://[::1]/a',
    'https://[2001:db8::1]/a',
    'https://localhost/a',
    'https://localhost./a',
    'https://a.localhost/a',
    'https://a.local./a',
    'https://printer.local/a',
    'https://db.internal/a',
    'https://router.home.arpa/a',
    'https://intranet/a',
    'ftp://example.org/a',
    'not a url',
  ])('%s は拒否', (u) => {
    expect(checkSourceUrl(u)).toBeNull();
  });
  it('https の普通のホストは通る（末尾の点は除いて判定）', () => {
    expect(checkSourceUrl('https://www.jaxa.jp/press/')).not.toBeNull();
    expect(checkSourceUrl('https://example.org./a')).not.toBeNull();
  });
});

describe('fetchSource（開き方）', () => {
  it('引用があれば found（抜き書きは引用を含む）', async () => {
    const { fetchImpl } = fetchStub({ 'https://src.example.org/a': { body: page(Q) } });
    const r = await fetchSource('https://src.example.org/a', Q, { fetchImpl });
    expect(r.result).toBe('found');
    expect(r.excerpt).toContain(Q);
  });
  it('空白と全角半角の違いを吸収して found', async () => {
    const { fetchImpl } = fetchStub({ 'https://src.example.org/a': { body: page('打ち上げは２０２６年度に\n\n   予定されています。ＭＭＸは火星の衛星へ向かう計画です。') } });
    const r = await fetchSource('https://src.example.org/a', '打ち上げは2026年度に 予定されています。MMXは火星の衛星へ向かう計画です。', { fetchImpl });
    expect(r.result).toBe('found');
  });
  it('<script> の中だけにある引用は not_found（<style>・コメントも同じ）', async () => {
    for (const html of [`<html><script>var q = "${Q}";</script><body>本文</body></html>`, `<style>/* ${Q} */</style><p>本文</p>`, `<!-- ${Q} --><p>本文</p>`]) {
      const { fetchImpl } = fetchStub({ 'https://src.example.org/a': { body: html } });
      expect((await fetchSource('https://src.example.org/a', Q, { fetchImpl })).result).toBe('not_found');
    }
  });
  it('リダイレクトは 3 回まで追い、4 回目は拒否', async () => {
    const chain = (n: number) => {
      const pages: Record<string, { status?: number; location?: string; body?: string }> = {};
      for (let i = 0; i < n; i++) pages[`https://src.example.org/r${i}`] = { status: 302, location: `https://src.example.org/r${i + 1}` };
      pages[`https://src.example.org/r${n}`] = { body: page(Q) };
      return pages;
    };
    const ok3 = fetchStub(chain(3));
    expect((await fetchSource('https://src.example.org/r0', Q, { fetchImpl: ok3.fetchImpl })).result).toBe('found');
    const ng4 = fetchStub(chain(4));
    expect((await fetchSource('https://src.example.org/r0', Q, { fetchImpl: ng4.fetchImpl })).result).toBe('blocked');
    expect(ng4.calls.length).toBe(4); // 4 回目のリダイレクト先は開かない
  });
  it('リダイレクト先が規則違反なら開かずに blocked', async () => {
    const s = fetchStub({ 'https://src.example.org/a': { status: 301, location: 'http://127.0.0.1/admin' }, 'http://127.0.0.1/admin': { body: page(Q) } });
    expect((await fetchSource('https://src.example.org/a', Q, { fetchImpl: s.fetchImpl })).result).toBe('blocked');
    expect(s.calls).toEqual(['https://src.example.org/a']);
  });
  it('2xx 以外は fetch_failed、種類違いは blocked、2 MiB 超は fetch_failed、規則違反の URL は開かない', async () => {
    const s = fetchStub({
      'https://src.example.org/404': { status: 404, body: page(Q) },
      'https://src.example.org/pdf': { type: 'application/pdf', body: Q },
      'https://src.example.org/big': { body: page(Q) + 'あ'.repeat(800_000) },
    });
    expect((await fetchSource('https://src.example.org/404', Q, { fetchImpl: s.fetchImpl })).result).toBe('fetch_failed');
    expect((await fetchSource('https://src.example.org/pdf', Q, { fetchImpl: s.fetchImpl })).result).toBe('blocked');
    expect((await fetchSource('https://src.example.org/big', Q, { fetchImpl: s.fetchImpl })).result).toBe('fetch_failed');
    expect((await fetchSource('https://localhost/x', Q, { fetchImpl: s.fetchImpl })).result).toBe('blocked');
    expect(s.calls).not.toContain('https://localhost/x');
  });
  it('接続の失敗・時間切れは fetch_failed', async () => {
    const throwing = (async () => {
      throw new TypeError('connect failed');
    }) as unknown as typeof fetch;
    expect((await fetchSource('https://src.example.org/a', Q, { fetchImpl: throwing })).result).toBe('fetch_failed');
    expect((await fetchSource('https://src.example.org/a', Q, { fetchImpl: throwing, deadline: Date.now() })).result).toBe('fetch_failed');
  });
  it('正規化は本文と引用に同じものを当てる', () => {
    expect(normalizeForQuote('Ａ　 Ｂ\n１')).toBe('A B 1');
    expect(quoteOutcome('<p>あ&amp;い</p>', 'あ&いの').result).toBe('not_found');
  });
});

describe('生成の応答からの照合（T-4・T-14 b10）', () => {
  const body = newsBody('2026-11-07');
  const url = body.sources[0].url;
  it('同じ URL の web_fetch の結果に引用があれば gen_fetch で found', () => {
    const m = genMessage([body], { fetches: [{ url, text: `前置き。${Q}後ろの文。` }] });
    expect(matchGenFetch(body, genFetchTexts(m.content as unknown[])).get('s1')).toContain(Q);
  });
  it('末尾の / の違いだけは同じ URL として扱う', () => {
    const m = genMessage([body], { fetches: [{ url: `${url}/`, text: Q }] });
    expect(matchGenFetch(body, genFetchTexts(m.content as unknown[])).has('s1')).toBe(true);
  });
  it('URL が違えば pending のまま（http→https の同一視や別の綴りは吸収しない）', () => {
    for (const other of [url.replace('https:', 'http:'), `${url}?x=1`, url.replace('/news/1', '/news/2'), url.toUpperCase()]) {
      const m = genMessage([body], { fetches: [{ url: other, text: Q }] });
      expect(matchGenFetch(body, genFetchTexts(m.content as unknown[])).has('s1')).toBe(false);
    }
    expect(sameUrl('https://a.example/x', 'https://a.example/x/')).toBe(true);
  });
  it('エラーの結果・本文の無い結果は照合に使わない', () => {
    const content = [
      { type: 'server_tool_use', id: 'srv1', name: 'web_fetch', input: { url } },
      { type: 'web_fetch_tool_result', tool_use_id: 'srv1', content: { type: 'web_fetch_tool_result_error', error_code: 'url_not_accessible' } },
    ];
    expect(genFetchTexts(content)).toEqual([]);
  });
});

describe('引用に記号を入れて照合を縮めさせない（司令塔の裁定 2026-11-06: T-1・T-5 の補足）', () => {
  const body = newsBody('2026-11-07');
  const url = body.sources[0].url;
  // <b></b> を挟んで生の長さを 20 字以上にした引用。タグを除くと「本文」だけになり、ほとんどのページに見つかってしまう
  const TAGGED = '本文<b></b><b></b><b></b>';
  // &amp; を並べた引用。文字参照を戻すと 6 字に縮む
  const AMPED = '&amp;&amp;&amp;&amp;本文';
  it('<b></b> を挟んで 20 字にした引用は found にならない（Worker の fetch・生成の応答の照合とも）', async () => {
    expect(Array.from(TAGGED).length).toBeGreaterThanOrEqual(20);
    const { fetchImpl } = fetchStub({ 'https://src.example.org/a': { body: page('ここに本文があります') } });
    expect((await fetchSource('https://src.example.org/a', TAGGED, { fetchImpl })).result).toBe('not_found');
    expect(quoteOutcome('ここに本文があります', TAGGED).result).toBe('not_found');
    const b = { ...body, sources: [{ ...body.sources[0], quote: TAGGED }] };
    const m = genMessage([b], { fetches: [{ url, text: 'ここに本文があります' }] });
    expect(matchGenFetch(b, genFetchTexts(m.content as unknown[])).has('s1')).toBe(false);
  });
  it('&amp; を並べた引用は found にならない', async () => {
    expect(Array.from(AMPED).length).toBeGreaterThanOrEqual(20);
    const { fetchImpl } = fetchStub({ 'https://src.example.org/a': { body: page('A&amp;&amp;&amp;&amp;本文です') } });
    expect((await fetchSource('https://src.example.org/a', AMPED, { fetchImpl })).result).toBe('not_found');
    const b = { ...body, sources: [{ ...body.sources[0], quote: AMPED }] };
    const m = genMessage([b], { fetches: [{ url, text: 'A&&&&本文です' }] });
    expect(matchGenFetch(b, genFetchTexts(m.content as unknown[])).has('s1')).toBe(false);
  });
  it('正規化した後の引用が 20 字未満なら探さずに not_found（空白で水増しした引用）', () => {
    const padded = `${'　'.repeat(20)}本文`;
    expect(Array.from(padded).length).toBeGreaterThanOrEqual(20);
    expect(quoteOutcome('ここに本文があります', padded).result).toBe('not_found');
  });
  it('記号を含まない普通の 20 字以上の引用は今までどおり found', () => {
    expect(quoteOutcome(page(Q), Q).result).toBe('found');
  });
});
