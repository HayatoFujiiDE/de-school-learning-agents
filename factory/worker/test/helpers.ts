// テスト用: 正しい成果物一式を作る
export function goodMaterial(): Record<string, unknown> {
  const v = (audience: string, length: string, game = false, path?: string) => ({
    audience,
    length,
    interest: null,
    game,
    path: path ?? `parts/p1/${audience}-${length}.md`,
  });
  return {
    schema_version: 1,
    slug: 'mc-redstone-basics',
    title: 'レッドストーン回路のしくみ',
    kinds: [3],
    catalog_item_id: 'mc-redstone',
    concept_codes: [],
    summary_elementary: 'レッドストーンで信号を運ぶ',
    summary_secondary: '信号の伝わり方を図で見る',
    parts: [
      {
        id: 'p1',
        kind: 3,
        title: '信号の道',
        entry_point: { type: 'look', text: '図の赤い線を指でたどる' },
        variants: [v('elementary', 'short'), v('elementary', 'long'), v('secondary', 'short'), v('secondary', 'long'), v('elementary', 'short', true, 'parts/p1/game.md')],
        files: [{ path: 'parts/p1/figure-1.svg', role: 'figure' }],
        adjustable: ['例'],
        tech_dependencies: ['svg'],
        needs_supporter_check: false,
      },
    ],
  };
}

export function goodFiles(material: Record<string, unknown> = goodMaterial()): Map<string, Uint8Array> {
  const enc = new TextEncoder();
  const m = new Map<string, Uint8Array>();
  const put = (p: string, s: string) => m.set(p, enc.encode(s));
  put('material.json', JSON.stringify(material));
  put('claims.json', JSON.stringify({ claims: [{ id: 'c1', text: '信号は 15 ブロック進む', status: 'confirmed', source_ids: ['s1'], used_in: ['p1'] }] }));
  put('sources.json', JSON.stringify({ sources: [{ id: 's1', url: 'https://minecraft.wiki/w/Redstone_Dust', title: 'Redstone Dust', accessed_at: '2026-11-04', quoted_excerpt: '15 blocks', license: 'CC BY-NC-SA 3.0', is_primary: true }] }));
  put('adapt-rules.md', '# 変えてよいこと\n- 例\n# 変えてはいけないこと\n- 事実\n');
  put('selfcheck.md', '確か / 仮説 / 未確認\n');
  for (const a of ['elementary', 'secondary']) for (const l of ['short', 'long']) put(`parts/p1/${a}-${l}.md`, `見てみよう [c1]`);
  put('parts/p1/game.md', 'クイズ');
  put('parts/p1/figure-1.svg', '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  return m;
}
