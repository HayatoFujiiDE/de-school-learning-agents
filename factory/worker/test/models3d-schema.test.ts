// §AJ-1・§AJ-6 1〜2: material.json の parts[].models3d[] の検査（取り込みの validateOutputs と純関数 checkModels3d）と、
// 版の material_json から立体モデルを読む関数（src/models3d.ts）。
import { describe, expect, it } from 'vitest';
import { checkModels3d, MAX_MODELS3D, MODEL3D_ID_RE, validateOutputs } from '../src/checks/schema';
import type { Model3dEntry } from '../src/generated/models3d-catalog';
import { MODELS3D_BY_ID, model3dEntryOf, versionModels3dOf, versionModels3dOfMaterial } from '../src/models3d';
import { goodFiles, goodMaterial } from './helpers';

type Obj = Record<string, unknown>;
const page = (id: string) => MODELS3D_BY_ID.get(id)!.page_url;

const model = (o: Obj = {}): Obj => ({ id: 'd1', catalog_id: 'omnh-allosaurus', why: '骨盤と後ろあしのつながりを回して見ると、立ち方が分かる', source_id: 's9', ...o });

/** 立体モデルの出典の行（quoted_excerpt は ""。職人はページを開けない） */
const m3Source = (catalogId: string, sid: string): Obj => ({
  id: sid,
  url: page(catalogId),
  title: `${MODELS3D_BY_ID.get(catalogId)!.title_ja}（${MODELS3D_BY_ID.get(catalogId)!.org}）`,
  accessed_at: '2026-11-07',
  quoted_excerpt: '',
  license: MODELS3D_BY_ID.get(catalogId)!.license.label,
  is_primary: false,
});

const DEFAULT_SOURCES = [
  m3Source('omnh-allosaurus', 's9'),
  m3Source('si-triceratops', 's10'),
  m3Source('kyu-lotus', 's11'),
  m3Source('kyu-rhinoceros-beetle', 's12'),
];

/** models3d を part ごとに付けた一式。sources.json に立体モデルの行を足す（extraSources で上書き） */
function filesWith(byPart: Array<unknown | undefined>, extraSources?: Obj[]) {
  const m = goodMaterial();
  const base = (m.parts as Obj[])[0];
  m.parts = byPart.map((ds, i) => {
    const id = `p${i + 1}`;
    const p: Obj = {
      ...base,
      id,
      variants: (base.variants as Obj[]).map((v) => ({ ...v, path: String(v.path).replace('parts/p1/', `parts/${id}/`) })),
      files: (base.files as Obj[]).map((f) => ({ ...f, path: String(f.path).replace('parts/p1/', `parts/${id}/`) })),
    };
    if (ds !== undefined) p.models3d = ds;
    return p;
  });
  const files = goodFiles(m);
  const enc = new TextEncoder();
  for (let i = 2; i <= byPart.length; i++) {
    for (const a of ['elementary', 'secondary']) for (const l of ['short', 'long']) files.set(`parts/p${i}/${a}-${l}.md`, enc.encode('見てみよう [c1]'));
    files.set(`parts/p${i}/game.md`, enc.encode('クイズ'));
    files.set(`parts/p${i}/figure-1.svg`, enc.encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'));
  }
  const srcs = JSON.parse(new TextDecoder().decode(files.get('sources.json')!)) as { sources: Obj[] };
  srcs.sources.push(...(extraSources ?? DEFAULT_SOURCES));
  files.set('sources.json', enc.encode(JSON.stringify(srcs)));
  return files;
}
const detailOf = (files: Map<string, Uint8Array>) => {
  const r = validateOutputs(files);
  return r.ok ? 'ok' : r.detail;
};

describe('§AJ-1 schema: parts[].models3d[]', () => {
  it('定数', () => {
    expect(MAX_MODELS3D).toBe(3);
    expect(MODEL3D_ID_RE.test('d1') && MODEL3D_ID_RE.test('d99')).toBe(true);
    expect(MODEL3D_ID_RE.test('d100') || MODEL3D_ID_RE.test('v1') || MODEL3D_ID_RE.test('d')).toBe(false);
  });

  it('正しい models3d は通り、part に 4 キーだけが付く（余分なキーは落とす・他の part は models3d キーを持たない）', () => {
    const r = validateOutputs(filesWith([[model({ extra: 'x', embed_url: 'https://evil.example/' }), model({ id: 'd2', catalog_id: 'si-triceratops', source_id: 's10' })], undefined]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.material.parts[0].models3d).toEqual([model(), model({ id: 'd2', catalog_id: 'si-triceratops', source_id: 's10' })]);
    for (const d of r.material.parts[0].models3d ?? []) expect(Object.keys(d).sort()).toEqual(['catalog_id', 'id', 'source_id', 'why']);
    expect('models3d' in r.material.parts[1]).toBe(false);
    // 立体モデルは公開 manifest に入らない（ファイルではない）
    expect(r.publicPaths.some((p) => p.includes('sketchfab') || p.includes('si.edu'))).toBe(false);
  });

  it('models3d が無い素材は従来どおり通り、part に models3d キーは付かない。空の配列も通る', () => {
    const r = validateOutputs(goodFiles());
    expect(r.ok).toBe(true);
    if (r.ok) expect('models3d' in r.material.parts[0]).toBe(false);
    expect(detailOf(filesWith([[]]))).toBe('ok');
  });

  it('models3d が配列でなければ bad_type:parts[i].models3d', () => {
    expect(detailOf(filesWith([{}]))).toBe('bad_type:parts[0].models3d');
    expect(detailOf(filesWith([[], 'd1']))).toBe('bad_type:parts[1].models3d');
  });

  it.each<[string, unknown, string]>([
    ['要素がオブジェクトでない', 'd1', 'id'],
    ['id の形（d + 1〜2 桁）', model({ id: 'model1' }), 'id'],
    ['id が 3 桁', model({ id: 'd100' }), 'id'],
    ['id が無い', model({ id: undefined }), 'id'],
    ['一覧に無い id', model({ catalog_id: 'no-such-model' }), 'catalog'],
    ['catalog_id が無い', model({ catalog_id: undefined }), 'catalog'],
    ['継承プロパティの名前', model({ catalog_id: 'constructor' }), 'catalog'],
    ['kind が download の id', model({ catalog_id: 'nasa-iss' }), 'catalog'],
    ['why が空', model({ why: '' }), 'text'],
    ['why が 301 字', model({ why: 'あ'.repeat(301) }), 'text'],
    ['why が文字列でない', model({ why: 3 }), 'text'],
    ['出典 id が sources.json に無い', model({ source_id: 's404' }), 'source'],
    ['出典の url が別の立体モデル', model({ source_id: 's10' }), 'source'],
    ['出典の url が minecraft.wiki', model({ source_id: 's1' }), 'source'],
    ['source_id が無い', model({ source_id: undefined }), 'source'],
  ])('%s → bad_model3d:p1:0:%s', (_n, d, reason) => {
    expect(detailOf(filesWith([[d]]))).toBe(`bad_model3d:p1:0:${reason}`);
  });

  it('why は code point で数える（300 字の 𠮷 は通る）', () => {
    expect(detailOf(filesWith([[model({ why: '𠮷'.repeat(300) })]]))).toBe('ok');
  });

  it.each([
    [page('omnh-allosaurus') + '/', '末尾の /'],
    [page('omnh-allosaurus').replace('https:', 'http:'), 'http'],
    [page('omnh-allosaurus') + '#x', 'fragment'],
    ['https://sketchfab.com/models/900868a0aa0b47e58571f5f5ae20094c/embed', '埋め込みの url'],
  ])('出典の url が一覧の page_url と完全一致でない（%s・%s）→ source', (url) => {
    const s = { ...m3Source('omnh-allosaurus', 's9'), url };
    expect(detailOf(filesWith([[model()]], [s]))).toBe('bad_model3d:p1:0:source');
  });

  it('同じ id が 2 回・同じ catalog_id が 2 回（part をまたいでも）→ dup', () => {
    expect(detailOf(filesWith([[model(), model({ catalog_id: 'si-triceratops', source_id: 's10' })]]))).toBe('bad_model3d:p1:1:dup');
    expect(detailOf(filesWith([[model()], [model({ catalog_id: 'si-triceratops', source_id: 's10' })]]))).toBe('bad_model3d:p2:0:dup');
    expect(detailOf(filesWith([[model(), model({ id: 'd2' })]]))).toBe('bad_model3d:p1:1:dup');
    expect(detailOf(filesWith([[model()], [model({ id: 'd2' })]]))).toBe('bad_model3d:p2:0:dup');
  });

  it('素材全体で 3 件は通り、4 件目で too_many（part をまたいでも）', () => {
    const three = [model(), model({ id: 'd2', catalog_id: 'si-triceratops', source_id: 's10' }), model({ id: 'd3', catalog_id: 'kyu-lotus', source_id: 's11' })];
    expect(detailOf(filesWith([three]))).toBe('ok');
    const four = [...three, model({ id: 'd4', catalog_id: 'kyu-rhinoceros-beetle', source_id: 's12' })];
    expect(detailOf(filesWith([four]))).toBe('bad_model3d:p1:3:too_many');
    expect(detailOf(filesWith([three.slice(0, 2), [three[2], four[3]]]))).toBe('bad_model3d:p2:1:too_many');
  });

  it('§AJ-6 2: 立体モデルの出典の行が quoted_excerpt: "" でも取り込みを通り、出典の行はそのまま残る', () => {
    const r = validateOutputs(filesWith([[model()]], [m3Source('omnh-allosaurus', 's9')]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sources.find((s) => s.id === 's9')).toMatchObject({ url: page('omnh-allosaurus'), quoted_excerpt: '', license: 'CC BY 4.0', is_primary: false });
  });

  it('license が空の立体モデルの出典の行は既存どおり unknown（検査では一致を求めない）', () => {
    const r = validateOutputs(filesWith([[model()]], [{ ...m3Source('omnh-allosaurus', 's9'), license: '' }]));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.sources.find((s) => s.id === 's9')?.license).toBe('unknown');
  });
});

describe('§AJ-1 checkModels3d（純関数・小さな一覧を渡す）', () => {
  const entry = (o: Partial<Model3dEntry>): Model3dEntry => ({
    id: 'x-one',
    title_ja: '題名',
    title_src: 'Title',
    org: '博物館',
    kind: 'sketchfab',
    page_url: 'https://example.org/one',
    embed_url: 'https://sketchfab.com/models/0123456789abcdef0123456789abcdef/embed',
    download_url: null,
    license: { code: 'cc0', label: 'CC0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' },
    attribution: '博物館',
    topics: ['t'],
    checked_at: '2026-11-07',
    ...o,
  });
  const catalog = new Map([
    ['x-one', entry({})],
    ['x-dl', entry({ id: 'x-dl', kind: 'download', page_url: 'https://example.org/dl', embed_url: null })],
    ['x-voy', entry({ id: 'x-voy', kind: 'voyager', page_url: 'https://example.org/voy' })],
  ]);
  const urls = new Map([
    ['s1', 'https://example.org/one'],
    ['s2', 'https://example.org/dl'],
    ['s3', 'https://example.org/voy'],
  ]);

  it('一覧にある sketchfab / voyager は通り、download は catalog', () => {
    const ok = checkModels3d([{ id: 'p1', models3d: [{ id: 'd1', catalog_id: 'x-one', why: 'a', source_id: 's1' }, { id: 'd2', catalog_id: 'x-voy', why: 'b', source_id: 's3' }] }], urls, catalog);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.byPart.get('p1')?.map((d) => d.catalog_id)).toEqual(['x-one', 'x-voy']);
    expect(checkModels3d([{ id: 'p1', models3d: [{ id: 'd1', catalog_id: 'x-dl', why: 'a', source_id: 's2' }] }], urls, catalog)).toEqual({ ok: false, detail: 'bad_model3d:p1:0:catalog' });
  });

  it('models3d が null の part は byPart に入らない', () => {
    const r = checkModels3d([{ id: 'p1', models3d: null }], urls, catalog);
    expect(r.ok && r.byPart.has('p1')).toBe(false);
  });

  it('本物の一覧（MODELS3D）でも、validateOutputs と同じく実在の id が引ける', () => {
    expect(model3dEntryOf('omnh-allosaurus')?.kind).toBe('sketchfab');
    expect(model3dEntryOf('no-such')).toBeNull();
  });
});

describe('§AJ-1 versionModels3dOf / versionModels3dOfMaterial（src/models3d.ts）', () => {
  it('{id, catalog_id, why, source_id} の配列を出現順に（形の違う要素は入れない・同じ id は最初だけ・3 件まで）', () => {
    const m = {
      parts: [
        { id: 'p1', models3d: [model({ extra: 1 }), 'x', model({ id: 'bad' }), model({ catalog_id: 3 }), model()] },
        { id: 'p2', models3d: [model({ id: 'd2' }), model({ id: 'd3' }), model({ id: 'd4' })] },
      ],
    };
    expect(versionModels3dOfMaterial(m)).toEqual([model(), model({ id: 'd2' }), model({ id: 'd3' })]);
    expect(versionModels3dOf(JSON.stringify(m))).toEqual(versionModels3dOfMaterial(m));
  });

  it('読めなければ []', () => {
    expect(versionModels3dOf('{')).toEqual([]);
    expect(versionModels3dOf(null)).toEqual([]);
    expect(versionModels3dOfMaterial({ parts: [{ id: 'p1', models3d: {} }] })).toEqual([]);
    expect(versionModels3dOfMaterial(null)).toEqual([]);
  });
});
