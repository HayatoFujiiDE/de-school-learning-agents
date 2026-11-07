// 絵の主張の取り込みの検査と取得先の一覧（契約 §O-13-0・§O-13-2。受け入れ O13-7 1・6）。純関数だけ（I/O なし）。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { hostMatches, urlHostMatches, PRIMARY_HOSTS } from '../src/checks/hosts';
import { checkFigureShows, validateOutputs, type Material } from '../src/checks/schema';
import { ALLOWLIST } from '../src/generated/claude-assets';
import { goodFiles, goodMaterial } from './helpers';

const IMG = 'img_' + 'c'.repeat(32);
const IMG2 = 'img_' + 'd'.repeat(32);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const RBC = 'parts/p1/rbc.png';
const KAHAKU = 'https://www.kahaku.go.jp/exhibitions/blood.html';
type Obj = Record<string, unknown>;
const show = (text: string, ids: string[] = ['s2']) => ({ text, source_ids: ids });
const SHOWS = [show('赤血球はまん中がへこんだ円盤で、核が無い'), show('毛細血管の中を赤血球が 1 列で通る')];

/** 画像の行（rows）を parts[0].files に足した成果物一式。sources に kahaku（s2）を足す */
function filesWith(rows: Obj[], sources: Obj[] = []): Map<string, Uint8Array> {
  const m = goodMaterial() as { parts: Array<{ files: Obj[] }> };
  m.parts[0].files = [...m.parts[0].files, ...rows];
  const files = goodFiles(m as Obj);
  for (const r of rows) if (typeof r.path === 'string' && r.path.endsWith('.png')) files.set(r.path, PNG);
  const src = JSON.parse(new TextDecoder().decode(files.get('sources.json')!)) as { sources: Obj[] };
  src.sources.push({ id: 's2', url: KAHAKU, title: '血液', quoted_excerpt: '赤血球', license: 'unknown', is_primary: false }, ...sources);
  files.set('sources.json', new TextEncoder().encode(JSON.stringify(src)));
  return files;
}
const imgRow = (o: Obj = {}): Obj => ({ path: RBC, role: 'figure', image_id: IMG, alt: '赤血球', shows: SHOWS, ...o });
const detailOf = (files: Map<string, Uint8Array>) => {
  const r = validateOutputs(files);
  return r.ok ? 'ok' : r.detail;
};

describe('§O-13-2 1 shows・reference_url の形（取り込みで弾く bad_image_shows）', () => {
  it('正しい shows（2 件・6 件）と https の reference_url は通り、正規化した files に残る', () => {
    const r = validateOutputs(filesWith([imgRow({ reference_url: KAHAKU })]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.material.parts[0].files[1]).toMatchObject({ path: RBC, image_id: IMG, shows: SHOWS, reference_url: KAHAKU });
    expect(detailOf(filesWith([imgRow({ shows: Array.from({ length: 6 }, (_, i) => show(`文 ${i}`)) })]))).toBe('ok');
    expect(detailOf(filesWith([imgRow({ shows: [show('x'.repeat(200)), show('二つ目', ['a'.repeat(40), 'b', 'c', 'd', 'e'])] })]))).toBe('ok');
  });

  it.each<[string, Obj]>([
    ['1 件', { shows: [show('一つだけ')] }],
    ['7 件', { shows: Array.from({ length: 7 }, (_, i) => show(`文 ${i}`)) }],
    ['配列でない', { shows: { text: 'x' } }],
    ['null', { shows: null }],
    ['空白だけの text', { shows: [show(' 　\n'), show('二つ目')] }],
    ['201 字の text', { shows: [show('x'.repeat(201)), show('二つ目')] }],
    ['text が文字列でない', { shows: [{ text: 1, source_ids: ['s2'] }, show('二つ目')] }],
    ['source_ids 0 件', { shows: [show('一', []), show('二')] }],
    ['source_ids 6 件', { shows: [show('一', ['a', 'b', 'c', 'd', 'e', 'f']), show('二')] }],
    ['source_ids の重複', { shows: [show('一', ['s2', 's2']), show('二')] }],
    ['source_id が 41 字', { shows: [show('一', ['a'.repeat(41)]), show('二')] }],
    ['source_id が空', { shows: [show('一', ['']), show('二')] }],
    ['要素がオブジェクトでない', { shows: ['一', show('二')] }],
    ['http:// の参照', { reference_url: 'http://www.kahaku.go.jp/x' }],
    ['host の無い参照', { reference_url: 'https://' }],
    ['host の無い参照（ポートだけ）', { reference_url: 'https://:443/x' }],
    ['解析できない参照', { reference_url: 'not a url' }],
    ['2001 字の参照', { reference_url: 'https://www.kahaku.go.jp/' + 'a'.repeat(2001 - 'https://www.kahaku.go.jp/'.length) }],
    ['参照が文字列でない', { reference_url: 1 }],
    ['先頭に空白のある参照', { reference_url: ' ' + KAHAKU }],
    ['末尾に改行のある参照', { reference_url: KAHAKU + '\n' }],
    ['https: の後に // が無い参照', { reference_url: 'https:www.kahaku.go.jp/x' }],
  ])('%s → bad_image_shows:<path>', (_n, o) => {
    expect(detailOf(filesWith([imgRow(o)]))).toBe(`bad_image_shows:${RBC}`);
  });

  it('同じ path の行が 2 つ: 絵の主張と参照が 1 行目と同じなら通り（合計は 1 回だけ数える）、違えば bad_image_shows（2 行目の主張が検査から漏れない）', () => {
    const six = Array.from({ length: 6 }, (_, i) => show(`文 ${i}`));
    expect(detailOf(filesWith([imgRow({ reference_url: KAHAKU }), imgRow({ reference_url: KAHAKU })]))).toBe('ok');
    // 6 件 × 9 行 = 54 だが同じ path は 1 回だけ数えるので 6 件 → 通る
    expect(detailOf(filesWith(Array.from({ length: 9 }, () => imgRow({ shows: six }))))).toBe('ok');
    expect(detailOf(filesWith([imgRow(), imgRow({ shows: [show('別の文', ['zz']), show('もう 1 つ')] })]))).toBe(`bad_image_shows:${RBC}`);
    expect(detailOf(filesWith([imgRow({ shows: [show('別の文', ['zz']), show('もう 1 つ')] }), imgRow()]))).toBe(`bad_image_shows:${RBC}`);
    expect(detailOf(filesWith([imgRow({ reference_url: KAHAKU }), imgRow()]))).toBe(`bad_image_shows:${RBC}`);
    expect(detailOf(filesWith([imgRow(), { path: RBC, role: 'figure', image_id: IMG, alt: '赤血球' }]))).toBe(`bad_image_shows:${RBC}`);
  });

  it('image_id の無い行（SVG）に shows / reference_url があれば bad_image_shows', () => {
    const m = goodMaterial() as { parts: Array<{ files: Obj[] }> };
    m.parts[0].files = [{ path: 'parts/p1/figure-1.svg', role: 'figure', shows: SHOWS }];
    expect(detailOf(goodFiles(m as Obj))).toBe('bad_image_shows:parts/p1/figure-1.svg');
    m.parts[0].files = [{ path: 'parts/p1/figure-1.svg', role: 'figure', reference_url: KAHAKU }];
    expect(detailOf(goodFiles(m as Obj))).toBe('bad_image_shows:parts/p1/figure-1.svg');
  });

  it('2000 字ちょうどの参照は通る', () => {
    const u = 'https://www.kahaku.go.jp/' + 'a'.repeat(2000 - 'https://www.kahaku.go.jp/'.length);
    expect(detailOf(filesWith([imgRow({ reference_url: u })]))).toBe('ok');
  });

  it('素材全体で 48 件まで。49 件目を含む行（最初に超えた path）で素材が弾かれる', () => {
    const six = Array.from({ length: 6 }, (_, i) => show(`文 ${i}`));
    const rows = Array.from({ length: 8 }, (_, i) => imgRow({ path: `parts/p1/img-${i}.png`, image_id: 'img_' + String(i).repeat(32), shows: six }));
    expect(detailOf(filesWith(rows))).toBe('ok'); // 48 件
    const over = [...rows, imgRow({ path: 'parts/p1/img-9.png', image_id: 'img_' + '9'.repeat(32), shows: [show('一'), show('二')] })];
    expect(detailOf(filesWith(over))).toBe('bad_image_shows:parts/p1/img-9.png');
  });
});

describe('§O-13-2 2〜5 checkFigureShows（checks_json。取り込みは止めない）', () => {
  const sources = [
    { id: 's1', url: 'https://minecraft.wiki/w/Redstone_Dust' },
    { id: 's2', url: KAHAKU },
    { id: 's3', url: 'https://notkahaku.go.jp/x' },
    { id: 's4', url: 'not a url' },
  ];
  const mat = (files: Obj[]): Pick<Material, 'parts'> => ({ parts: [{ id: 'p1', files } as unknown as Material['parts'][number]] });
  const sci = new Map([
    [IMG, 'scientific'],
    [IMG2, 'standard'],
  ]);
  const run = (files: Obj[], parentMaterialJson?: string | null) => checkFigureShows(mat(files), sources, { accuracyByImageId: sci, primaryHosts: PRIMARY_HOSTS, parentMaterialJson });

  it('対象画像（scientific）で shows 無し → figure_shows_missing。standard・SVG は入れない', () => {
    const r = run([{ path: RBC, image_id: IMG }, { path: 'parts/p1/b.png', image_id: IMG2 }, { path: 'parts/p1/f.svg' }]);
    expect(r.checks).toEqual({ figure_shows_missing: [RBC], figure_shows_refs: [], figure_shows_no_primary: [], figure_shows_removed: [] });
    expect(r.parentUnreadable).toBe(false);
  });

  it('sources に無い id → figure_shows_refs に {path, n, source_ids: 無い id を全部}（文ごとに 1 件）', () => {
    const r = run([{ path: RBC, image_id: IMG, shows: [show('一', ['s2', 'x9', 'x8']), show('二', ['s2'])] }]);
    expect(r.checks.figure_shows_refs).toEqual([{ path: RBC, n: 1, source_ids: ['x9', 'x8'] }]);
    expect(r.checks.figure_shows_no_primary).toEqual([]);
  });

  it('一次の host が無い → figure_shows_no_primary に {path, n}（is_primary の自己申告・notkahaku.go.jp・解析できない url は一次にならない）', () => {
    const r = run([{ path: RBC, image_id: IMG, shows: [show('一', ['s1']), show('二', ['s3', 's4']), show('三', ['s1', 's2']), show('四', ['zz'])] }]);
    expect(r.checks.figure_shows_no_primary).toEqual([
      { path: RBC, n: 1 },
      { path: RBC, n: 2 },
      { path: RBC, n: 4 },
    ]);
  });

  it('作り直しで親の text を 1 つ落とす → figure_shows_removed（同じ path・同じ image_id だけ。前後の空白は無視）', () => {
    const parent = JSON.stringify({ parts: [{ id: 'p1', files: [{ path: RBC, image_id: IMG, shows: [show(' 一 '), show('二')] }, { path: 'parts/p1/b.png', image_id: IMG2, shows: [show('A'), show('B')] }] }] });
    const r = run([{ path: RBC, image_id: IMG, shows: [show('一'), show('三')] }, { path: 'parts/p1/b.png', image_id: IMG, shows: [show('C'), show('D')] }], parent);
    expect(r.checks.figure_shows_removed).toEqual([{ path: RBC, texts: ['二'] }]);
    // 文を足すだけ・全部残すのはよい
    expect(run([{ path: RBC, image_id: IMG, shows: [show('一'), show('二'), show('三')] }], parent).checks.figure_shows_removed).toEqual([]);
    // 同じ画像で shows を消した → 親の文が全部減った
    expect(run([{ path: RBC, image_id: IMG }], parent).checks.figure_shows_removed).toEqual([{ path: RBC, texts: ['一', '二'] }]);
  });

  it('親無し（draft）では比べない。親が読めない（JSON でない）時は比べず parentUnreadable', () => {
    const files = [{ path: RBC, image_id: IMG, shows: [show('一', ['s2']), show('三', ['s2'])] }];
    expect(run(files, null).checks.figure_shows_removed).toEqual([]);
    expect(run(files, undefined).parentUnreadable).toBe(false);
    const bad = run(files, '');
    expect(bad.parentUnreadable).toBe(true);
    expect(bad.checks.figure_shows_removed).toEqual([]);
  });
});

describe('§O-13-0 取得先の一覧と hostMatches', () => {
  const root = fileURLToPath(new URL('../../claude/', import.meta.url));
  const raw = JSON.parse(readFileSync(root + 'allowlist.json', 'utf8')) as { domains: string[]; primary_hosts: string[]; hosts: string[] };

  it('primary_hosts ⊆ domains ⊆ hosts（bare）。足した取得先と、一次から除くものが契約どおり', () => {
    for (const h of raw.primary_hosts) expect(raw.domains, h).toContain(h);
    for (const d of raw.domains) expect(raw.hosts, d).toContain(d);
    expect(ALLOWLIST.primary_hosts).toEqual(raw.primary_hosts);
    const added = ['kahaku.go.jp', 'jaxa.jp', 'nao.ac.jp', 'jamstec.go.jp', 'riken.jp', 'aist.go.jp', 'jma.go.jp', 'gsi.go.jp', 'env.go.jp', 'mhlw.go.jp', 'jst.go.jp', 'nih.gov', 'medlineplus.gov', 'nasa.gov', 'esa.int', 'noaa.gov', 'usgs.gov', 'britannica.com', 'kotobank.jp', 'tokyo-shoseki.co.jp', 'kyoiku-shuppan.co.jp', 'dainippon-tosho.co.jp', 'keirinkan.com', 'shinko-keirin.co.jp', 'gakko-tosho.co.jp', 'teikokushoin.co.jp', 'en.wikipedia.org', 'kidshealth.org'];
    for (const d of added) expect(raw.domains, d).toContain(d);
    const notPrimary = ['en.wikipedia.org', 'kidshealth.org', 'ja.wikipedia.org', 'minecraft.wiki', 'docs.python.org', 'scratch.mit.edu', 'developer.mozilla.org', 'youtube.com'];
    expect([...raw.primary_hosts].sort()).toEqual([...added.filter((d) => !notPrimary.includes(d)), 'mext.go.jp', 'nier.go.jp'].sort());
    expect(raw.primary_hosts.some((h) => h === 'go.jp')).toBe(false);
  });

  it('material-maker.md の allowed_domains（web_search・web_fetch の 2 か所）と cloud.yaml の allowed_hosts が allowlist.json と一致する', () => {
    const md = readFileSync(root + 'agents/material-maker.md', 'utf8');
    const lists = [...md.matchAll(/allowed_domains: \[([^\]]*)\]/g)].map((m) => m[1].split(',').map((x) => x.trim()));
    expect(lists).toHaveLength(2);
    for (const l of lists) expect(l).toEqual(raw.domains);
    const lines = readFileSync(root + 'environments/cloud.yaml', 'utf8').split('\n');
    const i = lines.findIndex((l) => l.trim() === 'allowed_hosts:');
    const yaml: string[] = [];
    for (const l of lines.slice(i + 1)) {
      const m = /^\s+-\s+"?([^"]+)"?\s*$/.exec(l);
      if (!m) break;
      yaml.push(m[1]);
    }
    expect(yaml).toEqual(raw.hosts);
    // 職人の「一次の出典」の行に primary_hosts が全部ある（手書きなので突き合わせる）
    const line = md.split('\n').find((l) => l.startsWith('- **一次の出典**')) ?? '';
    expect(line.match(/発行主体（サブドメインを含む）: ([^。]+)。/)?.[1].split('・')).toEqual(raw.primary_hosts);
  });

  it('hostMatches: 小文字化・末尾の . ・サブドメインは一致、notkahaku.go.jp は kahaku.go.jp に一致しない（go.jp には一致）', () => {
    expect(hostMatches('kahaku.go.jp', ['kahaku.go.jp'])).toBe(true);
    expect(hostMatches('www.kahaku.go.jp', ['kahaku.go.jp'])).toBe(true);
    expect(hostMatches('WWW.Kahaku.GO.jp.', ['kahaku.go.jp'])).toBe(true);
    expect(hostMatches('notkahaku.go.jp', ['kahaku.go.jp'])).toBe(false);
    expect(hostMatches('notkahaku.go.jp', ['go.jp'])).toBe(true);
    expect(hostMatches('kahaku.go.jp.evil.com', ['kahaku.go.jp'])).toBe(false);
    expect(hostMatches('', ['kahaku.go.jp'])).toBe(false);
    // ポートは見ない（URL の hostname にポートは入らない）
    expect(urlHostMatches('https://www.kahaku.go.jp:8443/x', ['kahaku.go.jp'])).toBe(true);
    expect(urlHostMatches('https://www.kahaku.go.jp./x', ['kahaku.go.jp'])).toBe(true);
    expect(urlHostMatches('not a url', ['kahaku.go.jp'])).toBe(false);
    expect(urlHostMatches(undefined, ['kahaku.go.jp'])).toBe(false);
  });
});
