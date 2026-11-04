import { describe, expect, it } from 'vitest';
import { FORBIDDEN_WORDS, checkForbidden } from '../src/checks/forbidden';

const base = () => ({
  texts: new Map<string, string>([['parts/p1/elementary-short.md', 'みてみよう [c1]']]),
  summary_elementary: 'ふつうの文',
  summary_secondary: 'ふつうの文',
  claims: [{ id: 'c1', source_ids: ['s1'] }],
  sourceIds: ['s1'],
});

describe('checkForbidden', () => {
  it('問題なしなら ok', () => expect(checkForbidden(base()).ok).toBe(true));

  it('禁止語は 13 語', () => expect(FORBIDDEN_WORDS.length).toBe(13));

  it.each(FORBIDDEN_WORDS)('parts/** の禁止語「%s」を数える', (w) => {
    const i = base();
    i.texts.set('parts/p1/secondary-long.md', `前${w}中${w}後`);
    const r = checkForbidden(i);
    expect(r.forbidden).toContainEqual({ path: 'parts/p1/secondary-long.md', word: w, count: 2 });
    expect(r.ok).toBe(false);
  });

  it.each(FORBIDDEN_WORDS)('summary の禁止語「%s」も拾う', (w) => {
    const i = base();
    i.summary_secondary = `これは${w}です`;
    expect(checkForbidden(i).forbidden).toContainEqual({ path: 'material.json#summary_secondary', word: w, count: 1 });
  });

  it('parts 以外（selfcheck.md 等）は禁止語の対象外', () => {
    const i = base();
    i.texts.set('selfcheck.md', '評価');
    expect(checkForbidden(i).forbidden).toEqual([]);
  });

  it('型 4 の残り物（script src / link / fetch( / import）を app.html で拾う', () => {
    const i = base();
    i.texts.set(
      'parts/p2/app.html',
      '<SCRIPT type="module" src="x.js"></SCRIPT><link rel="stylesheet" href="a.css"><script>fetch("/x"); import("y");</script>',
    );
    const r = checkForbidden(i);
    expect(r.app_html.map((x) => x.pattern).sort()).toEqual(['<link ', '<script src', 'fetch(', 'import '].sort());
  });

  it('basename が app.html で終わるファイル（2 パーツ以上の p2-app.html）も型 4 の検査に入る', () => {
    const i = base();
    i.texts.set('parts/p2/p2-app.html', '<script src="https://cdn.example/x.js"></script>');
    expect(checkForbidden(i).app_html).toEqual([{ path: 'parts/p2/p2-app.html', pattern: '<script src', count: 1 }]);
    const j = base();
    j.texts.set('parts/p2/p2-figure.html', '<script src="x.js"></script>'); // app.html で終わらない .html は対象外
    j.texts.set('parts/p2/app.html.md', 'fetch(');
    expect(checkForbidden(j).app_html).toEqual([]);
  });

  it('app.html 以外の .md に fetch( があっても型 4 の検査には入らない', () => {
    const i = base();
    i.texts.set('parts/p1/elementary-long.md', 'fetch() という関数');
    expect(checkForbidden(i).app_html).toEqual([]);
  });

  it('自己完結した app.html は残り物なし', () => {
    const i = base();
    i.texts.set('parts/p2/app.html', '<style>body{max-width:100%}</style><input type="range"><script>document.body.dataset.important="1"</script>');
    expect(checkForbidden(i).app_html).toEqual([]);
  });

  it('claims の source_ids が sources.json に無ければ拾う', () => {
    const i = base();
    i.claims.push({ id: 'c2', source_ids: ['s1', 's9'] });
    expect(checkForbidden(i).missing_source_refs).toEqual([{ claim_id: 'c2', source_id: 's9' }]);
  });

  it('parts/** の [cN] が claims に無ければ拾う', () => {
    const i = base();
    i.texts.set('parts/p1/elementary-long.md', 'a [c1] b [c7] c [c7]');
    expect(checkForbidden(i).missing_claim_refs).toEqual([{ path: 'parts/p1/elementary-long.md', ref: 'c7' }]);
  });

  it('「確認済み」を parts/** で拾う', () => {
    const i = base();
    i.texts.set('parts/p1/game.md', 'これは確認済みです');
    expect(checkForbidden(i).kakunin_zumi).toEqual([{ path: 'parts/p1/game.md', count: 1 }]);
  });
});
