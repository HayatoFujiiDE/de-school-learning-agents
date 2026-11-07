import { describe, expect, it } from 'vitest';
import { FORBIDDEN_WORDS, checkForbidden } from '../src/checks/forbidden';
import { childMetaTextsOf, questionsOf } from '../src/checks/shape';
import { goodMaterialV2, outputsFixture } from './helpers';

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

describe('§AL-2: schema 2 の要約 1 本（summary）', () => {
  it('summary に禁止語 → material.json#summary の 1 件。summary_elementary / summary_secondary の行は見ない', () => {
    const i = { ...base(), summary_elementary: '', summary_secondary: '', summary: '成績が上がる遊び' };
    const r = checkForbidden(i);
    expect(r.forbidden).toEqual([{ path: 'material.json#summary', word: '成績', count: 1 }]);
    expect(r.ok).toBe(false);
    // 渡されたら summary だけ（schema 1 の 2 行は走査しない）
    expect(checkForbidden({ ...base(), summary_elementary: '点数', summary: 'ふつうの文' }).forbidden).toEqual([]);
  });
});

describe('§AL-6: 問いの種・関心別の入口（buddy_texts）', () => {
  const Q = 'material.json#parts[0].questions_for_kids[1].text';
  it('buddy_texts の文に禁止語 → その path の 1 件（確認済み・[cN] は見ない）', () => {
    const r = checkForbidden({
      ...base(),
      buddy_texts: [
        { path: 'material.json#parts[0].questions_for_kids[0].text', text: '確認済み [c9] どう光る？' },
        { path: Q, text: 'ランキングで一番になれる？' },
      ],
    });
    expect(r.forbidden).toEqual([{ path: Q, word: 'ランキング', count: 1 }]);
    expect(r.kakunin_zumi).toEqual([]);
    expect(r.missing_claim_refs).toEqual([]);
    expect(r.ok).toBe(false);
  });

  it('渡さなければ従来の結果', () => {
    expect(checkForbidden(base())).toEqual(checkForbidden({ ...base(), buddy_texts: [] }));
    expect(checkForbidden(base()).ok).toBe(true);
  });
});

describe('§AL-3: schema 2 の子ども向けの material.json の文（title・entry_point・videos.why）', () => {
  it('entry_point.text / videos[].why / title の禁止語が path 付きで出る（childMetaTextsOf の path）', () => {
    const m = goodMaterialV2() as Record<string, any>;
    m.parts[0].entry_point.text = '成績を上げよう';
    m.parts[0].videos = [{ id: 'v1', why: 'ランキングの動画' }];
    m.parts[0].title = 'レベルの道';
    const r = checkForbidden({ ...base(), buddy_texts: childMetaTextsOf(m) });
    expect(r.forbidden).toEqual([
      { path: 'material.json#parts[0].title', word: 'レベル', count: 1 },
      { path: 'material.json#parts[0].entry_point.text', word: '成績', count: 1 },
      { path: 'material.json#parts[0].videos[0].why', word: 'ランキング', count: 1 },
    ]);
    expect(r.ok).toBe(false);
  });
});

describe('§AL-1: 問いの種の claim_ids の不在 id → missing_claim_refs（拒否しない）', () => {
  it('問いの claim_ids に無い id → 1 件（path は material.json#questions.q1、ref は c9）。同じ問いの同じ id は 1 件', () => {
    const r = checkForbidden({ ...base(), questions: [{ id: 'q1', claim_ids: ['c9', 'c1', 'c9'] }] });
    expect(r.missing_claim_refs).toEqual([{ path: 'material.json#questions.q1', ref: 'c9' }]);
    expect(r.ok).toBe(false);
  });
  it('実在 id だけ → 0 件。渡さなければ従来の結果', () => {
    expect(checkForbidden({ ...base(), questions: [{ id: 'q1', claim_ids: ['c1'] }, { id: 'q2', claim_ids: [] }] }).missing_claim_refs).toEqual([]);
    expect(checkForbidden(base())).toEqual(checkForbidden({ ...base(), questions: [] }));
  });
  it('bad fixture（q1 → c9）: questionsOf を渡すと 1 件', () => {
    const m = JSON.parse(new TextDecoder().decode(outputsFixture('_shared-v2-bad').get('material.json')!));
    const r = checkForbidden({ ...base(), questions: questionsOf(m) });
    expect(r.missing_claim_refs).toEqual([{ path: 'material.json#questions.q1', ref: 'c9' }]);
  });
});
