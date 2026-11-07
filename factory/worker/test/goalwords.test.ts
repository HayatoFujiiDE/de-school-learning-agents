// 目標語の一覧の lock test（契約 §AL-3）。正本 GOAL_WORDS と、4 文書（契約・採点表・職人定義・編集基準）のマーカー行の集合が一致すること。
// 文書のどれかで語を足し引きしたら、このテストが落ちる（4 文書と GOAL_WORDS を一緒に直す）。4 文書とも原本を fs で読む（生成物は使わない）。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GOAL_WORDS, GOAL_WORDS_MARKER } from '../src/checks/goalwords';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

/** `目標語（正本）: ` で始まる行（先頭の空白を除く）の後ろを ` / ` で分けた語の並び（行ごと） */
function markerLines(doc: string): string[][] {
  return doc
    .split('\n')
    .map((l) => l.trimStart())
    .filter((l) => l.startsWith(GOAL_WORDS_MARKER))
    .map((l) => l.slice(GOAL_WORDS_MARKER.length).split(' / '));
}

const DOCS: Array<[string, () => string]> = [
  ['契約 contract-AL.md', () => read('../../../docs/plans/material-v2/contract-AL.md')],
  ['採点表 rubrics/common.md', () => read('../../claude/rubrics/common.md')],
  ['職人定義 material-maker.md', () => read('../../claude/agents/material-maker.md')],
  ['編集基準 editorial-standards.md', () => read('../../claude/editorial-standards.md')],
];

describe('目標語の一覧（§AL-3 lock）', () => {
  it('マーカーは「目標語（正本）: 」・22 語・重複なし', () => {
    expect(GOAL_WORDS_MARKER).toBe('目標語（正本）: ');
    expect(GOAL_WORDS).toHaveLength(22);
    expect(new Set(GOAL_WORDS).size).toBe(GOAL_WORDS.length);
  });

  it.each(DOCS)('%s のマーカー行の語の集合 = GOAL_WORDS', (_n, doc) => {
    const lines = markerLines(doc());
    expect(lines.length).toBeGreaterThan(0);
    for (const words of lines) expect([...new Set(words)].sort()).toEqual([...GOAL_WORDS].sort());
  });

  it('GOAL_WORDS は契約のマーカー行の順どおり', () => {
    expect(markerLines(DOCS[0][1]())).toEqual([[...GOAL_WORDS]]);
  });
});
