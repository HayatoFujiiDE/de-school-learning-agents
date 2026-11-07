// §AJ-2・§AJ-6 3・8: 注文票の「使ってよい立体モデル（一覧）」の節（buildPhase1Message）と、職人の定義・rubric の文。
// §AK-4 1: 一覧は呼び出し側が offerableModels3d(門番) で渡す（記録の無い項目・取り込みの無い download は出ない。ライセンスの名前は記録から）。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RUBRIC_COMMON, RUBRIC_KINDS } from '../src/generated/claude-assets';
import { MODELS3D } from '../src/generated/models3d-catalog';
import { buildPhase1Message } from '../src/jobs';
import { MODELS3D_SECTION_HEAD, models3dSectionLines } from '../src/models3d';
import { licenseLabelOf, offerableModels3d, type RightsRecord } from '../src/rights';
import { EMPTY_RIGHTS_GATE } from '../src/rights-store';
import { d1, migratedDb } from './d1-shim';
import { fullGate, goodRecord, hostedRow } from './rights-helpers';

const HEAD = '# 使ってよい立体モデル（一覧）';
const ROVER = 'nasa-perseverance-rover';
const SHA = 'a'.repeat(64);
const row = (e: (typeof MODELS3D)[number], r: RightsRecord) =>
  `- ${e.id}: ${e.title_ja}（${e.org}・${licenseLabelOf(r.license_code, r.license_url)}）— 札: ${e.topics.join('・')} — 出典の url: ${e.page_url}`;
/** 一覧の全件に通った記録がある時の注文票の一覧（取り込み無し = 埋め込みの件だけ） */
const allOffered = async () => offerableModels3d(await fullGate());

describe('§AJ-2 a・§AK-4 1 注文票の一覧の節', () => {
  it('節があり、一覧の行の数は門番を通った埋め込みの件数と同じ（取り込みの無い download は出ない）。ライセンスは記録の名前。編集基準の前・注文票の後', async () => {
    const db = d1(migratedDb());
    const list = await allOffered();
    const msg = await buildPhase1Message(db, 'brief', [3], null, null, list);
    expect(MODELS3D_SECTION_HEAD).toBe(HEAD);
    expect(msg).toContain(`\n${HEAD}\n題材に合うものがあれば、material.json の parts[].models3d[] に catalog_id で書く（1 素材 3 件まで。無ければ使わない）。\n`);
    const embeddable = MODELS3D.filter((e) => e.kind === 'sketchfab' || e.kind === 'voyager');
    expect(list.map((o) => o.entry.id)).toEqual(embeddable.map((e) => e.id));
    const start = msg.indexOf(HEAD);
    const end = msg.indexOf('# 編集基準');
    expect(start).toBeGreaterThan(msg.indexOf('# 注文票'));
    expect(start).toBeLessThan(end);
    const section = msg.slice(start, end);
    const rows = section.split('\n').filter((l) => l.startsWith('- '));
    // 1 行 1 件・一覧の順・ライセンスは記録の code と url から（一覧の label ではない）
    expect(rows).toEqual(list.map((o) => row(o.entry, o.record)));
    expect(rows.find((l) => l.startsWith('- omnh-allosaurus:'))).toContain('（大阪市立自然史博物館・CC BY 4.0）');
    expect(rows.find((l) => l.startsWith('- si-triceratops:'))).toContain('・CC0 1.0）');
    for (const e of MODELS3D.filter((x) => x.kind === 'download')) expect(msg.includes(e.id)).toBe(false);
    // 節の後は空行 1 つで編集基準
    expect(section.endsWith('\n\n')).toBe(true);
  });

  it('門番を通るものが無い（記録が 1 件も無い = deploy 直後）時は節が無く、従来の文（節を除いた文）と 1 文字も変わらない', async () => {
    const db = d1(migratedDb());
    const list = await allOffered();
    const withSection = await buildPhase1Message(db, 'brief', [3, 4], null, null, list);
    expect(offerableModels3d(EMPTY_RIGHTS_GATE)).toEqual([]);
    const empty = await buildPhase1Message(db, 'brief', [3, 4], null, null, offerableModels3d(EMPTY_RIGHTS_GATE));
    expect(empty.includes(HEAD)).toBe(false);
    // 変更前の形を固定した対照（Astra MINOR）: 一覧が空なら注文票の直後が編集基準（builder 同士の比較に頼らない）
    expect(empty).toContain('# 注文票\nbrief\n\n# 編集基準');
    expect(withSection.replace(models3dSectionLines(list).join('\n') + '\n', '')).toBe(empty);
    expect(models3dSectionLines([])).toEqual([]);
  });

  it('§AK-4 1: host の記録があっても取り込み（hosted + rights_hosted）の無い download は門番を通らない（→ download だけの一覧では節は空）', async () => {
    const db = d1(migratedDb());
    const onlyDownload = MODELS3D.filter((e) => e.kind === 'download');
    expect(onlyDownload.length).toBeGreaterThan(0);
    const gate = await fullGate();
    expect(offerableModels3d(gate, onlyDownload)).toEqual([]);
    // hosted だけ（rights_hosted に無い sha）も出ない
    expect(offerableModels3d(await fullGate({ hosted: [[ROVER, hostedRow(SHA)]] }), onlyDownload)).toEqual([]);
    const empty = await buildPhase1Message(db, 'brief', [3, 4], null, null, []);
    expect(await buildPhase1Message(db, 'brief', [3, 4], null, null, offerableModels3d(gate, onlyDownload))).toBe(empty);
  });

  it('渡した一覧はそのまま出る（models3dSectionLines は中で判定をしない）', async () => {
    const onlyDownload = MODELS3D.filter((e) => e.kind === 'download');
    const list = await Promise.all(onlyDownload.map(async (entry) => ({ entry, record: await goodRecord(entry) })));
    const lines = models3dSectionLines(list);
    expect(lines[0]).toBe(HEAD);
    expect(lines.filter((l) => l.startsWith('- '))).toEqual(list.map((o) => row(o.entry, o.record)));
  });

  it('§AK-4 1: 取り込み済みで rights_hosted にその sha がある download の行が一覧の順で出る・他の download は出ない・埋め込みの行は同じ並び', async () => {
    const db = d1(migratedDb());
    const hosted = offerableModels3d(await fullGate({ hosted: [[ROVER, hostedRow(SHA)]], hostedShas: [[ROVER, SHA]] }));
    const none = await allOffered();
    const msg = await buildPhase1Message(db, 'brief', [3], null, null, hosted);
    const section = msg.slice(msg.indexOf(HEAD), msg.indexOf('# 編集基準'));
    const rows = section.split('\n').filter((l) => l.startsWith('- '));
    expect(rows.map((l) => l.slice(2, l.indexOf(':')))).toEqual(MODELS3D.filter((e) => e.kind !== 'download' || e.id === ROVER).map((e) => e.id));
    expect(rows.filter((l) => !l.startsWith(`- ${ROVER}:`))).toEqual(none.map((o) => row(o.entry, o.record)));
    expect(rows.find((l) => l.startsWith(`- ${ROVER}:`))).toContain('（NASA・NASA の利用の決まり）');
    for (const id of ['nasa-iss', 'dbcls-bodyparts3d']) expect(msg.includes(id)).toBe(false);
    // 行の形は v1 と同じ（kind は書かない）
    expect(rows.find((l) => l.startsWith(`- ${ROVER}:`))).not.toContain('download');
  });

  it('作り直しの区画（prev）がある時も、区画の後・編集基準の前に同じ節が付く', async () => {
    const db = d1(migratedDb());
    const list = await allOffered();
    const msg = await buildPhase1Message(db, 'brief', [3], { names: ['material.json'], reopenFree: [] }, null, list);
    const prevAt = msg.indexOf('# 前の版（作り直しの出発点）');
    expect(prevAt).toBeGreaterThan(0);
    expect(msg.indexOf(HEAD)).toBeGreaterThan(prevAt);
    expect(msg).toContain(models3dSectionLines(list).join('\n') + '\n# 編集基準');
  });
});

describe('§AJ-2 b・c 職人の定義と rubric', () => {
  const maker = readFileSync(new URL('../../claude/agents/material-maker.md', import.meta.url), 'utf8');

  it('material-maker.md に「# 立体モデル（一覧から）」の節が、動画の節より後・作り直しの節の前にある（契約の文のまま。§MC の節が間に入ってよい）', () => {
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
    // 見出しの順: 動画 … 立体モデル … 作り直し（§MC の「版が決まっている題材」が動画と立体モデルの間に入る）
    const at = (h: string) => headings.indexOf(h);
    expect(at('# 動画（YouTube）')).toBeLessThan(at('# 立体モデル（一覧から）'));
    expect(at('# 立体モデル（一覧から）') + 1).toBe(at('# 作り直し（前の版がある時）'));
  });

  it('成果物の構成の例に "videos": [], の次の行として "models3d": [], がある', () => {
    expect(maker).toContain('    "videos": [],\n    "models3d": [],\n');
  });

  it('rubric: common.md の 23 と kind-3.md の 1 行（生成ファイルに反映済み）', () => {
    expect(RUBRIC_COMMON).toContain(
      '23. material.json の parts[].models3d があれば、各件に catalog_id と why（見方）があり、source_id の出典の行の url が一覧の出典の url と同じ（形式だけ。モデルの中身は人が見る）\n',
    );
    expect(RUBRIC_KINDS[3]).toContain(
      '- 実物の形・骨格・大きさの比べ方が大事な題材で、一覧に合う立体モデルがあれば、回して見られる立体モデルを 1 つ添えている（無ければ generate_image の立体の絵でよい）\n',
    );
  });
});
