// 検証係の入力: parts/** の .md / .html / .svg を全部入れ、上限を超えたら切り詰めずに null（試行は failed）
import { describe, expect, it } from 'vitest';
import { VERIFY_INPUT_CHAR_LIMIT, buildUserContent } from '../src/verify';

function r2(files: Record<string, string>) {
  return {
    get: async (key: string) => (key in files ? { text: async () => files[key] } : null),
  } as unknown as R2Bucket;
}
const v = (paths: string[]) => ({
  id: 'v1',
  material_id: 'm1',
  r2_prefix: 'p/',
  claims_json: '{"claims":[{"id":"c1"}]}',
  public_paths_json: JSON.stringify(paths),
});

describe('buildUserContent', () => {
  it('parts/** の md・html・svg をすべて入れ、claims.json / adapt-rules.md は parts 本文に入れない', async () => {
    const files = {
      'p/sources.json': '{"sources":[]}',
      'p/parts/p1/elementary-short.md': 'MD本文',
      'p/parts/p1/figure-1.svg': '<svg>SVG本文</svg>',
      'p/parts/p2/app.html': '<p>HTML本文</p>',
      'p/adapt-rules.md': 'ADAPT',
    };
    const out = await buildUserContent({ R2: r2(files) }, v(['adapt-rules.md', 'claims.json', 'parts/p1/elementary-short.md', 'parts/p1/figure-1.svg', 'parts/p2/app.html']));
    expect(out).not.toBeNull();
    expect(out).toContain('MD本文');
    expect(out).toContain('SVG本文');
    expect(out).toContain('HTML本文');
    expect(out).not.toContain('ADAPT');
  });
  it(`合計が ${VERIFY_INPUT_CHAR_LIMIT} 文字を超えたら切り詰めずに null`, async () => {
    const big = 'あ'.repeat(VERIFY_INPUT_CHAR_LIMIT);
    const out = await buildUserContent({ R2: r2({ 'p/sources.json': '{}', 'p/parts/p1/a.md': 'x', 'p/parts/p1/b.md': big }) }, v(['parts/p1/a.md', 'parts/p1/b.md']));
    expect(out).toBeNull();
  });
});
