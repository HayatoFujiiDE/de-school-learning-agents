// §AJ-3・§AJ-6 4: 仕分け（triageVersion）の立体モデルの項目と、立体モデルの出典を「開けたか・引用」の検査から外すこと（model3dSourceIds）。
import { describe, expect, it } from 'vitest';
import { model3dSourceIds } from '../src/checks/citations';
import { ITEM_TITLE, triageVersion, type TriageInput, type TriageSource } from '../src/checks/triage';
import { MODELS3D_BY_ID } from '../src/models3d';
import { goodMaterial } from './helpers';

type Obj = Record<string, any>;
const GREEN_CHECKS = { schema: 'ok', forbidden: [], app_html: [], kakunin_zumi: [], missing_source_refs: [], missing_claim_refs: [], unreferenced_files: [], child_text: [] };
const ALLO = MODELS3D_BY_ID.get('omnh-allosaurus')!;
const TRI = MODELS3D_BY_ID.get('si-triceratops')!;
const d = (o: Obj = {}) => ({ id: 'd1', catalog_id: 'omnh-allosaurus', why: '骨格を回して見る', source_id: 's9', ...o });

function mat(models3d?: Obj[]): Obj {
  const m = goodMaterial() as Obj;
  if (models3d) m.parts[0].models3d = models3d;
  return m;
}

/** 全部通る版（c1 confirmed・s1 は開けて引用も一致・図 ok・読み手 ok）に、立体モデルと出典の行を足せる */
function input(o: { material?: Obj; claims?: Array<[string, string[]]>; sources?: Record<string, Partial<TriageSource>> } = {}): TriageInput {
  const cl = o.claims ?? [['confirmed', ['s1']]];
  const sources: TriageSource[] = Object.entries(o.sources ?? { s1: {} }).map(([id, x]) => ({
    source_id: id,
    url: `https://minecraft.wiki/w/${id}`,
    license: 'CC BY-SA 3.0',
    url_was_fetched: 1,
    quote_found: 1,
    is_primary: 1,
    ...x,
  }));
  return {
    claims: { claims: cl.map(([, sids], i) => ({ id: `c${i + 1}`, text: `主張 ${i + 1}`, status: 'confirmed', source_ids: sids, used_in: ['p1'] })) },
    report: {
      id: 'w1',
      result: {
        verdicts: cl.map(([verdict], i) => ({ claim_id: `c${i + 1}`, verdict, reason: '', opened_urls: [], presented_as: null })),
        overall_note: '',
        figures: [{ path: 'parts/p1/figure-1.svg', verdict: 'ok', reason: '' }],
        analogy_gaps: [],
        videos: [],
        apps: [],
        meta: { mode: 'batch', turns: 1, fetch_errors: {}, fetched_ok: [], evidence_v: 2 },
      },
    },
    sources,
    checks: GREEN_CHECKS,
    material: o.material ?? mat(),
    autoReverified: 0,
    reader: { status: 'done', token: 'rt1', result: { findings: [], learning: { verdict: 'ok', reason: '' }, conditions: { verdict: 'ok', reason: '' }, summary: '', not_read: [] } },
    videoMeta: [],
    trustedChannels: [],
    trustedGen: '1',
    autoRounds: 0,
    autoReturnMax: '2',
    verificationStatus: 'done',
    evidenceReverified: 0,
  };
}
/** 立体モデルの出典の行（開けていない・引用なし。一次でない） */
const m3row = (url: string): Partial<TriageSource> => ({ url, url_was_fetched: 0, quote_found: 0, is_primary: 0, license: 'CC BY 4.0' });

describe('§AJ-3 仕分けの立体モデルの項目', () => {
  it('対照: 立体モデルの無い版は全部通る（clean・6 項目 ok・項目なし）', () => {
    const t = triageVersion(input());
    expect([t.gate, t.items.length, t.auto.explanation_and_expression]).toEqual(['clean', 0, 'ok']);
  });

  it('models3d のある版は件数分の model3d_human の ask が出て、explanation_and_expression が review・gate attention・自動の処置なし', () => {
    const t = triageVersion(
      input({
        material: mat([d(), d({ id: 'd2', catalog_id: 'si-triceratops', source_id: 's10' })]),
        sources: { s1: {}, s9: m3row(ALLO.page_url), s10: m3row(TRI.page_url) },
      }),
    );
    const m3 = t.items.filter((i) => i.kind === 'model3d');
    expect(m3).toEqual([
      { id: 'model3d:d1', kind: 'model3d', key: 'explanation_and_expression', severity: 'ask', cause: 'model3d_human', model3d_id: 'd1', catalog_id: 'omnh-allosaurus', title: ALLO.title_ja, detail: '立体モデル（人が回して見てください）' },
      { id: 'model3d:d2', kind: 'model3d', key: 'explanation_and_expression', severity: 'ask', cause: 'model3d_human', model3d_id: 'd2', catalog_id: 'si-triceratops', title: TRI.title_ja, detail: '立体モデル（人が回して見てください）' },
    ]);
    // 立体モデルの出典が開けていなくても、ほかの項目は出ない
    expect(t.items.length).toBe(2);
    expect(t.auto.explanation_and_expression).toBe('review');
    expect(t.auto.content_and_evidence).toBe('ok');
    expect(t.auto.terms_of_use).toBe('ok');
    expect([t.gate, t.action, t.counts.ask, t.counts.fix]).toEqual(['attention', 'none', 2, 0]);
  });

  it('検証の結果がまだ無い版でも、立体モデルの ask は出る（人が回して見る）', () => {
    const i = input({ material: mat([d()]), sources: { s1: {}, s9: m3row(ALLO.page_url) } });
    i.report = null;
    i.verificationStatus = 'pending';
    const t = triageVersion(i);
    expect(t.items.filter((x) => x.cause === 'model3d_human').map((x) => x.id)).toEqual(['model3d:d1']);
  });

  it('一覧に無い catalog_id（取り込み後に一覧から消えた）は model3d_missing の fix（title は catalog_id）。自動の差し戻しの文に載る', () => {
    const t = triageVersion(input({ material: mat([d({ catalog_id: 'gone-model' })]), sources: { s1: {}, s9: m3row('https://sketchfab.com/3d-models/gone') } }));
    const it = t.items.find((x) => x.kind === 'model3d');
    expect(it).toMatchObject({ id: 'model3d:d1', severity: 'fix', cause: 'model3d_missing', model3d_id: 'd1', catalog_id: 'gone-model', title: 'gone-model' });
    expect(it?.detail).toBe('立体モデルが一覧に無い（一覧を直すか、素材を作り直す）');
    expect(t.action).toBe('auto_return');
    expect(t.return_note).toContain('〔説明と表現〕gone-model。立体モデルが一覧に無い（一覧を直すか、素材を作り直す）');
  });

  it('CAUSE の文（ITEM_TITLE）', () => {
    expect(ITEM_TITLE.model3d_human).toBe('立体モデル（人が回して見てください）');
    expect(ITEM_TITLE.model3d_missing).toBe('立体モデルが一覧に無い（一覧を直すか、素材を作り直す）');
  });
});

describe('§AJ-3 立体モデルの出典は「開けたか・引用」の検査から外す', () => {
  it('立体モデルの出典だけを持つ主張は、出典が未取得でも maker_url_not_fetched を出さない（対照: 同じ形の普通の出典は出す）', () => {
    const withModel = triageVersion(input({ material: mat([d()]), claims: [['unverified', ['s9']]], sources: { s1: {}, s9: m3row(ALLO.page_url) } }));
    const claim = withModel.items.find((x) => x.kind === 'claim');
    expect(claim?.cause).not.toBe('maker_url_not_fetched');
    expect(claim?.cause).not.toBe('quote_mismatch');
    expect(withModel.groups.some((g) => g.cause === 'maker_url_not_fetched' || g.cause === 'quote_mismatch')).toBe(false);
    // 対照: material に models3d が無い（= 立体モデルの出典ではない）と、同じ行は maker_url_not_fetched
    const plain = triageVersion(input({ claims: [['unverified', ['s9']]], sources: { s1: {}, s9: m3row(ALLO.page_url) } }));
    expect(plain.items.find((x) => x.kind === 'claim')?.cause).toBe('maker_url_not_fetched');
    expect(plain.groups.some((g) => g.cause === 'quote_mismatch' && g.source_id === 's9')).toBe(true);
  });

  it('url が一覧の page_url と違う行は除外しない（形だけ合わせた別の url は検査する）', () => {
    const t = triageVersion(input({ material: mat([d()]), claims: [['unverified', ['s9']]], sources: { s1: {}, s9: m3row(ALLO.page_url + '/') } }));
    expect(t.items.find((x) => x.kind === 'claim')?.cause).toBe('maker_url_not_fetched');
  });

  it('引用の不一致の割合（quote_mismatch_many）の分子・分母からも外す', () => {
    const claims: Array<[string, string[]]> = Array.from({ length: 5 }, () => ['confirmed', ['s1']]);
    const sources = { s1: {}, s9: m3row(ALLO.page_url), s10: m3row(TRI.page_url) };
    const t = triageVersion(input({ material: mat([d(), d({ id: 'd2', catalog_id: 'si-triceratops', source_id: 's10' })]), claims, sources }));
    expect(t.items.some((x) => x.id === 'check:quote_mismatch_many')).toBe(false);
    // 対照: 立体モデルでなければ 2/3 が不一致で出る
    expect(triageVersion(input({ claims, sources })).items.some((x) => x.id === 'check:quote_mismatch_many')).toBe(true);
  });

  it('model3dSourceIds: source_id の行で url が一覧の page_url と完全一致するものだけ。一覧に無い catalog_id は入れない', () => {
    const srcs = [
      { id: 's9', url: ALLO.page_url },
      { id: 's10', url: 'https://example.org/other' },
      { id: 's11', url: TRI.page_url },
    ];
    expect([
      ...model3dSourceIds(
        srcs,
        [
          { source_id: 's9', catalog_id: 'omnh-allosaurus' },
          { source_id: 's10', catalog_id: 'si-triceratops' },
          { source_id: 's11', catalog_id: 'no-such' },
        ],
        MODELS3D_BY_ID,
      ),
    ]).toEqual(['s9']);
    expect(model3dSourceIds(srcs, [], MODELS3D_BY_ID).size).toBe(0);
  });
});
