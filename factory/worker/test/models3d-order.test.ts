// §AJ-2・§AJ-6 3・8: 注文票の「使ってよい立体モデル（一覧）」の節（buildPhase1Message）と、職人の定義・rubric の文。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RUBRIC_COMMON, RUBRIC_KINDS } from '../src/generated/claude-assets';
import { MODELS3D } from '../src/generated/models3d-catalog';
import { buildPhase1Message } from '../src/jobs';
import { embeddableModels3d, MODELS3D_SECTION_HEAD, models3dSectionLines } from '../src/models3d';
import { d1, migratedDb } from './d1-shim';

const HEAD = '# 使ってよい立体モデル（一覧）';

describe('§AJ-2 a 注文票の一覧の節', () => {
  it('節があり、一覧の行の数は埋め込める件数と同じ（download は出ない）。編集基準の前・注文票の後', async () => {
    const db = d1(migratedDb());
    const msg = await buildPhase1Message(db, 'brief', [3]);
    expect(MODELS3D_SECTION_HEAD).toBe(HEAD);
    expect(msg).toContain(`\n${HEAD}\n題材に合うものがあれば、material.json の parts[].models3d[] に catalog_id で書く（1 素材 3 件まで。無ければ使わない）。\n`);
    const embeddable = MODELS3D.filter((e) => e.kind === 'sketchfab' || e.kind === 'voyager');
    expect(embeddable.length).toBeGreaterThan(0);
    expect(embeddable.length).toBeLessThan(MODELS3D.length);
    const start = msg.indexOf(HEAD);
    const end = msg.indexOf('# 編集基準');
    expect(start).toBeGreaterThan(msg.indexOf('# 注文票'));
    expect(start).toBeLessThan(end);
    const section = msg.slice(start, end);
    const rows = section.split('\n').filter((l) => l.startsWith('- '));
    expect(rows.length).toBe(embeddable.length);
    // 1 行 1 件・一覧の順・値は一覧のまま
    expect(rows).toEqual(embeddable.map((e) => `- ${e.id}: ${e.title_ja}（${e.org}・${e.license.label}）— 札: ${e.topics.join('・')} — 出典の url: ${e.page_url}`));
    for (const e of MODELS3D.filter((x) => x.kind === 'download')) expect(msg.includes(e.id)).toBe(false);
    // 節の後は空行 1 つで編集基準
    expect(section.endsWith('\n\n')).toBe(true);
  });

  it('一覧が空（差し替え）の時は節が無く、従来の文（節を除いた文）と 1 文字も変わらない', async () => {
    const db = d1(migratedDb());
    const withSection = await buildPhase1Message(db, 'brief', [3, 4]);
    const empty = await buildPhase1Message(db, 'brief', [3, 4], null, null, []);
    expect(empty.includes(HEAD)).toBe(false);
    // 変更前の形を固定した対照（Astra MINOR）: 一覧が空なら注文票の直後が編集基準（builder 同士の比較に頼らない）
    expect(empty).toContain('# 注文票\nbrief\n\n# 編集基準');
    expect(withSection.replace(models3dSectionLines().join('\n') + '\n', '')).toBe(empty);
    // download だけの一覧も節を出さない
    const onlyDownload = MODELS3D.filter((e) => e.kind === 'download');
    expect(await buildPhase1Message(db, 'brief', [3, 4], null, null, onlyDownload)).toBe(empty);
    expect(models3dSectionLines([])).toEqual([]);
    expect(embeddableModels3d(onlyDownload)).toEqual([]);
  });

  it('作り直しの区画（prev）がある時も、区画の後・編集基準の前に同じ節が付く', async () => {
    const db = d1(migratedDb());
    const msg = await buildPhase1Message(db, 'brief', [3], { names: ['material.json'], reopenFree: [] });
    const prevAt = msg.indexOf('# 前の版（作り直しの出発点）');
    expect(prevAt).toBeGreaterThan(0);
    expect(msg.indexOf(HEAD)).toBeGreaterThan(prevAt);
    expect(msg).toContain(models3dSectionLines().join('\n') + '\n# 編集基準');
  });
});

describe('§AJ-2 b・c 職人の定義と rubric', () => {
  const maker = readFileSync(new URL('../../claude/agents/material-maker.md', import.meta.url), 'utf8');

  it('material-maker.md に「# 立体モデル（一覧から）」の節が、動画の節の直後・作り直しの節の前にある（契約の文のまま）', () => {
    const SECTION = [
      '# 立体モデル（一覧から）',
      '',
      '- 注文票の「使ってよい立体モデル（一覧）」に載っているものだけを素材に組み合わせてよい（1 素材 3 件まで）。一覧に無いものを探さない・一覧に無い url を書かない。題材に合うものが無ければ使わない',
      '- 使うのは、実物の形・大きさの比べ方・骨格や体のつくりなど「回して見ると分かること」がある時。飾りに使わない。本文のどこにつながるかがはっきりした場面に置く',
      '- 使う立体モデルは material.json の parts[].models3d[] に {"id": "d1", "catalog_id": "<一覧の id>", "why": "<何をどう見るとどう分かるか>", "source_id": "<sources.json の id>"} と書く。id は素材全体で d1・d2・d3',
      '- sources.json には、その立体モデルの行を {"url": "<一覧の『出典の url』を一字も変えずに>", "title": "<題名>（<提供元>）", "license": "<一覧のライセンスの文字列（CC0 / CC BY 4.0 など）>", "is_primary": false, "quoted_excerpt": "", "accessed_at": "<今日>"} の形で書く。立体モデルのページは開けないので、開こうとしない（断られても立体モデルをあきらめる理由にしない）',
      '- 本文では「立体モデルを回して、〜を見てみよう。〜に注目」のように見方を書く。立体モデルを事実の出典にしない（claims の source_ids に立体モデルの出典 id を入れない。形や数の主張は、これまでどおり一次の出典で支える）',
      '- 質問を書く最初の段階では選ばなくてよい',
      '',
      '# 作り直し（前の版がある時）',
    ].join('\n');
    expect(maker).toContain(SECTION);
    expect(maker.indexOf('# 立体モデル（一覧から）')).toBeGreaterThan(maker.indexOf('# 動画（YouTube）'));
    const headings = maker.split('\n').filter((l) => l.startsWith('# '));
    expect(headings[headings.indexOf('# 動画（YouTube）') + 1]).toBe('# 立体モデル（一覧から）');
  });

  it('成果物の構成の例に "videos": [], の次の行として "models3d": [], がある', () => {
    expect(maker).toContain('    "videos": [],\n    "models3d": [],\n');
  });

  it('rubric: common.md の 16 と kind-3.md の 1 行（生成ファイルに反映済み）', () => {
    expect(RUBRIC_COMMON).toContain(
      '16. material.json の parts[].models3d があれば、各件に catalog_id と why（見方）があり、source_id の出典の行の url が一覧の出典の url と同じ（形式だけ。モデルの中身は人が見る）\n',
    );
    expect(RUBRIC_KINDS[3]).toContain(
      '- 実物の形・骨格・大きさの比べ方が大事な題材で、一覧に合う立体モデルがあれば、回して見られる立体モデルを 1 つ添えている（無ければ generate_image の立体の絵でよい）\n',
    );
  });
});
