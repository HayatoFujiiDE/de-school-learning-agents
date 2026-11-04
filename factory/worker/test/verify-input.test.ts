// 検証係の入力: 取り込んだ parts/**（R2 の一覧）の .md / .html / .svg を全部入れ、上限を超えたら切り詰めずに null、一覧の key が読めなければ part_missing（試行は failed）
import { describe, expect, it } from 'vitest';
import { VERIFY_INPUT_CHAR_LIMIT, VERIFY_PARTS_LIMIT, buildUserContent } from '../src/verify';

/** list（prefix・cursor・2 件ずつ）と get だけを持つ最小の R2。読んだ key を記録する */
function r2(files: Record<string, string>, pageSize = 2, unreadable: string[] = []) {
  const reads: string[] = [];
  const lists: Array<string | undefined> = [];
  const bucket = {
    get: async (key: string) => {
      reads.push(key);
      return key in files && !unreadable.includes(key) ? { text: async () => files[key] } : null;
    },
    list: async (o: { prefix?: string; cursor?: string }) => {
      lists.push(o.cursor);
      const keys = Object.keys(files)
        .filter((k) => k.startsWith(o.prefix ?? ''))
        .sort();
      const start = o.cursor ? Number(o.cursor) : 0;
      const end = start + pageSize;
      const objects = keys.slice(start, end).map((key) => ({ key }));
      return end < keys.length
        ? { objects, delimitedPrefixes: [], truncated: true, cursor: String(end) }
        : { objects, delimitedPrefixes: [], truncated: false };
    },
  } as unknown as R2Bucket;
  return { bucket, reads, lists };
}

const v = { id: 'v1', material_id: 'm1', r2_prefix: 'p/', claims_json: '{"claims":[{"id":"c1"}]}' };

describe('buildUserContent', () => {
  it('parts/** の md・html・svg をすべて入れ、claims.json / adapt-rules.md・他の拡張子は parts 本文に入れない', async () => {
    const { bucket } = r2({
      'p/sources.json': '{"sources":[]}',
      'p/parts/p1/elementary-short.md': 'MD本文',
      'p/parts/p1/figure-1.svg': '<svg>SVG本文</svg>',
      'p/parts/p2/app.html': '<p>HTML本文</p>',
      'p/parts/p2/data.json': 'JSON本文',
      'p/adapt-rules.md': 'ADAPT',
    });
    const out = await buildUserContent({ R2: bucket }, v);
    expect(out).not.toBeNull();
    expect(out).toContain('MD本文');
    expect(out).toContain('SVG本文');
    expect(out).toContain('HTML本文');
    expect(out).not.toContain('JSON本文');
    expect(out).not.toContain('ADAPT');
  });

  it('公開 manifest に載っていない parts/extra.md も R2 の一覧から入る（ページ送りの続きも読む）', async () => {
    // manifest（public_paths_json）に載るのは material.json が参照する parts だけ。extra.md はどこからも参照されない
    const manifest = ['claims.json', 'adapt-rules.md', 'parts/p1/a.md'];
    const { bucket, reads, lists } = r2({
      'p/sources.json': '{"sources":[]}',
      'p/parts/p1/a.md': '参照される本文',
      'p/parts/p1/b.svg': '<svg/>',
      'p/parts/extra.md': 'manifest に無い本文',
    });
    const out = await buildUserContent({ R2: bucket }, v);
    const extraPartRead = reads.includes('p/parts/extra.md');
    expect(manifest).not.toContain('parts/extra.md');
    expect(extraPartRead).toBe(true);
    expect(out).toContain('manifest に無い本文');
    expect(out).toContain('参照される本文');
    expect(lists.length).toBeGreaterThan(1); // 3 件を 2 件ずつ → cursor で 2 ページ目を取った
  });

  it(`合計が ${VERIFY_INPUT_CHAR_LIMIT} 文字を超えたら切り詰めずに null`, async () => {
    const big = 'あ'.repeat(VERIFY_INPUT_CHAR_LIMIT);
    const { bucket } = r2({ 'p/sources.json': '{}', 'p/parts/p1/a.md': 'x', 'p/parts/p1/b.md': big });
    expect(await buildUserContent({ R2: bucket }, v)).toBeNull();
  });

  it('一覧にあった part が読めなければ { error: part_missing }（黙って飛ばさない。上限超過の null と区別できる）', async () => {
    const { bucket, reads } = r2(
      { 'p/sources.json': '{}', 'p/parts/p1/a.md': 'A本文', 'p/parts/p1/b.md': 'B本文', 'p/parts/p1/c.md': 'C本文' },
      2,
      ['p/parts/p1/b.md'],
    );
    const out = await buildUserContent({ R2: bucket }, v);
    expect(out).toEqual({ error: 'part_missing' });
    expect(reads).toContain('p/parts/p1/b.md');
  });

  it(`parts のファイル数が ${VERIFY_PARTS_LIMIT} 件を超えたら null`, async () => {
    const files: Record<string, string> = { 'p/sources.json': '{}' };
    for (let i = 0; i <= VERIFY_PARTS_LIMIT; i++) files[`p/parts/p${i}/a.md`] = 'x';
    const { bucket } = r2(files, 100);
    expect(await buildUserContent({ R2: bucket }, v)).toBeNull();
  });
});
