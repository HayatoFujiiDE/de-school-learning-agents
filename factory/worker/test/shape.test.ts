// shape.ts（契約 §AL-1）: material.json の形（schema_version 1 / 2）の分岐。純関数・例外を投げない
import { describe, expect, it } from 'vitest';
import { bodiesOf, buddyTextsOf, childMetaTextsOf, questionsOf, schemaVersionOf, summariesOf } from '../src/checks/shape';
import { goodMaterial, goodMaterialV2 } from './helpers';

describe('schemaVersionOf', () => {
  it('数値の 2 の時だけ 2、それ以外は 1', () => {
    expect(schemaVersionOf(goodMaterialV2())).toBe(2);
    expect(schemaVersionOf(goodMaterial())).toBe(1);
    for (const v of [1, '2', 3, 2.5, null, undefined]) expect(schemaVersionOf({ schema_version: v }), String(v)).toBe(1);
    for (const m of [{}, null, undefined, 'x', 2, [{ schema_version: 2 }]]) expect(schemaVersionOf(m), JSON.stringify(m)).toBe(1);
  });
});

describe('bodiesOf', () => {
  it('schema 1: variants の .md を出現順に、読み手係と同じ表示名で', () => {
    expect(bodiesOf(goodMaterial())).toEqual([
      { path: 'parts/p1/elementary-short.md', label: '小学生・短い', role: 'variant', partId: 'p1', audience: 'elementary', length: 'short', game: false },
      { path: 'parts/p1/elementary-long.md', label: '小学生・長い', role: 'variant', partId: 'p1', audience: 'elementary', length: 'long', game: false },
      { path: 'parts/p1/secondary-short.md', label: '中学生・短い', role: 'variant', partId: 'p1', audience: 'secondary', length: 'short', game: false },
      { path: 'parts/p1/secondary-long.md', label: '中学生・長い', role: 'variant', partId: 'p1', audience: 'secondary', length: 'long', game: false },
      { path: 'parts/p1/game.md', label: 'ゲーム版', role: 'variant', partId: 'p1', audience: 'elementary', length: 'short', game: true },
    ]);
  });

  it('schema 1: .md 以外の変奏・同じ path の 2 件目は出さない。schema 1 の part の body / play は読まない', () => {
    const m = goodMaterial();
    const part = (m.parts as Array<Record<string, unknown>>)[0];
    part.variants = [
      { audience: 'elementary', length: 'short', path: 'parts/p1/a.svg' },
      { audience: 'secondary', length: 'long', path: 'parts/p1/b.MD' },
      { audience: 'elementary', length: 'long', path: 'parts/p1/b.MD' },
    ];
    part.body = 'parts/p1/body.md';
    part.play = 'parts/p1/play.md';
    expect(bodiesOf(m)).toEqual([
      { path: 'parts/p1/b.MD', label: '中学生・長い', role: 'variant', partId: 'p1', audience: 'secondary', length: 'long', game: false },
    ]);
  });

  it('schema 2: body（本文）→ play（遊びの形）。variants は読まない', () => {
    expect(bodiesOf(goodMaterialV2())).toEqual([
      { path: 'parts/p1/body.md', label: '本文', role: 'body', partId: 'p1' },
      { path: 'parts/p1/play.md', label: '遊びの形', role: 'play', partId: 'p1' },
    ]);
    const m = goodMaterialV2();
    const part = (m.parts as Array<Record<string, unknown>>)[0];
    delete part.play;
    part.variants = [{ audience: 'elementary', length: 'short', path: 'parts/p1/x.md' }];
    expect(bodiesOf(m)).toEqual([{ path: 'parts/p1/body.md', label: '本文', role: 'body', partId: 'p1' }]);
  });

  it('壊れた入力（parts が配列でない・path が文字列でない・part が object でない）でも例外を投げず飛ばす', () => {
    for (const m of [null, undefined, 'x', 1, [], {}, { parts: 'p' }, { parts: { p1: {} } }, { schema_version: 2, parts: null }]) {
      expect(() => bodiesOf(m), JSON.stringify(m)).not.toThrow();
      expect(bodiesOf(m), JSON.stringify(m)).toEqual([]);
    }
    const v1 = { schema_version: 1, parts: [null, 'p', 3, { id: 5, variants: 'x' }, { id: 'p1', variants: [null, { path: 3 }, { path: ['a.md'] }, { path: 'parts/p1/ok.md' }] }] };
    expect(bodiesOf(v1)).toEqual([{ path: 'parts/p1/ok.md', label: '・', role: 'variant', partId: 'p1', game: false }]);
    const v2 = { schema_version: 2, parts: [null, { id: 1, body: 3, play: null }, { body: 'parts/p2/body.md', play: ['x'] }] };
    expect(bodiesOf(v2)).toEqual([{ path: 'parts/p2/body.md', label: '本文', role: 'body', partId: null }]);
  });
});

describe('summariesOf', () => {
  it('schema 1 は summary_elementary → summary_secondary、schema 2 は summary の 1 行', () => {
    expect(summariesOf(goodMaterial())).toEqual([
      { key: 'summary_elementary', text: 'レッドストーンで信号を運ぶ' },
      { key: 'summary_secondary', text: '信号の伝わり方を図で見る' },
    ]);
    const v2 = goodMaterialV2();
    expect(summariesOf(v2)).toEqual([{ key: 'summary', text: v2.summary }]);
  });

  it('文字列でないものは飛ばし、例外を投げない（schema 1 の summary・schema 2 の summary_elementary は見ない）', () => {
    expect(summariesOf({ schema_version: 1, summary_elementary: 3, summary_secondary: 'b', summary: 'x' })).toEqual([{ key: 'summary_secondary', text: 'b' }]);
    expect(summariesOf({ schema_version: 2, summary: null, summary_elementary: 'a' })).toEqual([]);
    for (const m of [null, undefined, 'x', 1, []]) expect(summariesOf(m)).toEqual([]);
  });
});

describe('buddyTextsOf（§AL-6）', () => {
  it('schema 2: parts の順に問いの種 → 関心別の入口。path は material.json#parts[i].….text', () => {
    const v2 = goodMaterialV2() as Record<string, any>;
    const p = v2.parts[0];
    expect(buddyTextsOf(v2)).toEqual([
      { path: 'material.json#parts[0].questions_for_kids[0].text', partId: p.id, kind: 'question', id: p.questions_for_kids[0].id, text: p.questions_for_kids[0].text },
      { path: 'material.json#parts[0].questions_for_kids[1].text', partId: p.id, kind: 'question', id: p.questions_for_kids[1].id, text: p.questions_for_kids[1].text },
      { path: 'material.json#parts[0].interest_entries[0].text', partId: p.id, kind: 'entry', id: p.interest_entries[0].interest, text: p.interest_entries[0].text },
      { path: 'material.json#parts[0].interest_entries[1].text', partId: p.id, kind: 'entry', id: p.interest_entries[1].interest, text: p.interest_entries[1].text },
    ]);
  });

  it('schema 1 は []', () => {
    expect(buddyTextsOf(goodMaterial())).toEqual([]);
    expect(buddyTextsOf({ parts: [{ id: 'p1', questions_for_kids: [{ id: 'q1', text: 'x' }] }] })).toEqual([]);
  });

  it('壊れた入力でも例外を投げず、text が文字列のものだけ（interest が無い入口は id null）', () => {
    for (const m of [null, undefined, 'x', 1, [], { schema_version: 2 }, { schema_version: 2, parts: 'x' }]) expect(buddyTextsOf(m)).toEqual([]);
    const m = {
      schema_version: 2,
      parts: [null, { id: 3, questions_for_kids: [null, { id: 'q1', text: 1 }, { text: 'とい' }], interest_entries: 'x' }, { id: 'p2', questions_for_kids: {}, interest_entries: [{ text: '入口' }, 'y'] }],
    };
    expect(buddyTextsOf(m)).toEqual([
      { path: 'material.json#parts[1].questions_for_kids[2].text', partId: null, kind: 'question', id: null, text: 'とい' },
      { path: 'material.json#parts[2].interest_entries[0].text', partId: 'p2', kind: 'entry', id: null, text: '入口' },
    ]);
  });
});

describe('childMetaTextsOf（§AL-3・§AL-6）', () => {
  it('schema 2: part の title → entry_point.text → videos[].why（parts の順）の後に問いの種・入口（buddyTextsOf）', () => {
    const v2 = goodMaterialV2() as Record<string, any>;
    v2.parts[0].videos = [{ id: 'v1', why: '光る様子' }, { id: 'v2' }];
    const p = v2.parts[0];
    expect(childMetaTextsOf(v2)).toEqual([
      { path: 'material.json#parts[0].title', text: p.title },
      { path: 'material.json#parts[0].entry_point.text', text: p.entry_point.text },
      { path: 'material.json#parts[0].videos[0].why', text: '光る様子' },
      ...buddyTextsOf(v2).map(({ path, text }) => ({ path, text })),
    ]);
    expect(childMetaTextsOf(v2)).toHaveLength(7);
  });

  it('schema 1 は []', () => {
    expect(childMetaTextsOf(goodMaterial())).toEqual([]);
  });

  it('壊れた入力でも例外を投げず、文字列だけ', () => {
    for (const m of [null, undefined, 'x', 1, [], { schema_version: 2 }, { schema_version: 2, parts: 'x' }]) expect(childMetaTextsOf(m)).toEqual([]);
    const m = { schema_version: 2, parts: [null, { title: 1, entry_point: 'x', videos: [null, { why: 2 }] }, { title: 'だい', entry_point: { text: 'はじめ' }, videos: 'x' }] };
    expect(childMetaTextsOf(m)).toEqual([
      { path: 'material.json#parts[2].title', text: 'だい' },
      { path: 'material.json#parts[2].entry_point.text', text: 'はじめ' },
    ]);
  });
});

describe('questionsOf（§AL-1）', () => {
  it('schema 2: 問いの id と claim_ids（文字列だけ）。schema 1・壊れた入力は []', () => {
    expect(questionsOf(goodMaterialV2())).toEqual([
      { partId: 'p1', id: 'q1', claim_ids: ['c1'] },
      { partId: 'p1', id: 'q2', claim_ids: ['c2'] },
    ]);
    expect(questionsOf(goodMaterial())).toEqual([]);
    for (const m of [null, 'x', { schema_version: 2 }, { schema_version: 2, parts: [null, { questions_for_kids: 'x' }] }]) expect(questionsOf(m)).toEqual([]);
    expect(questionsOf({ schema_version: 2, parts: [{ questions_for_kids: [null, { id: 1, claim_ids: [] }, { id: 'q3' }, { id: 'q4', claim_ids: ['c1', 2] }] }] })).toEqual([{ partId: null, id: 'q4', claim_ids: ['c1'] }]);
  });
});
