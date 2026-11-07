// テスト用: 正しい成果物一式を作る
import { readFileSync, readdirSync } from 'node:fs';

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
    // §MC: 既存のテストは版が決まっていない題材の仕分け（mc- の catalog は版が決まっている題材になる。版の項目は test/mc-edition.test.ts）
    catalog_item_id: 'redstone',
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

/** §AL-1: test/fixtures/<name>/outputs/ の一式（論理パス → bytes）。fixture を正本にして、コードと中身がずれないようにする */
export function outputsFixture(name: string): Map<string, Uint8Array> {
  const root = new URL(`./fixtures/${name}/outputs/`, import.meta.url);
  const m = new Map<string, Uint8Array>();
  const walk = (rel: string) => {
    for (const e of readdirSync(new URL(rel, root), { withFileTypes: true })) {
      const p = rel + e.name;
      if (e.isDirectory()) walk(`${p}/`);
      else m.set(p, new Uint8Array(readFileSync(new URL(p, root))));
    }
  };
  walk('');
  return m;
}

/** §AL-1: schema_version 2 の正しい material.json（test/fixtures/_shared-v2/outputs/material.json と同じ内容） */
export function goodMaterialV2(): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(outputsFixture('_shared-v2').get('material.json')!)) as Record<string, unknown>;
}

/** §AL-1: schema_version 2 の正しい成果物一式（test/fixtures/_shared-v2/outputs/ と同じ内容。material.json だけ引数で差し替える） */
export function goodFilesV2(material: Record<string, unknown> = goodMaterialV2()): Map<string, Uint8Array> {
  const m = outputsFixture('_shared-v2');
  m.set('material.json', new TextEncoder().encode(JSON.stringify(material)));
  return m;
}
