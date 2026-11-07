// 仕分けの絵の主張（契約 §O-13-4。受け入れ O13-7 4）。図の項目の detail（番号の行が先に残る）・return_note の図の行・機械検査の 4 項目。
import { describe, expect, it } from 'vitest';
import { ITEM_DETAIL_MAX, figureItemDetail, triageVersion, type TriageInput, type TriageItem } from '../src/checks/triage';
import { PRIMARY_HOSTS } from '../src/checks/hosts';
import { goodMaterial } from './helpers';

type Obj = Record<string, any>;
const IMG = 'img_' + 'e'.repeat(32);
const RBC = 'parts/p1/rbc.png';
const SVG = 'parts/p1/figure-1.svg';
const TEXTS = ['赤血球はまん中がへこんだ円盤で、核が無い', '静脈の血も赤い（青くない）。'.repeat(6), '毛細血管の中を赤血球が 1 列で通る'];
const GREEN_CHECKS = { schema: 'ok', forbidden: [], app_html: [], kakunin_zumi: [], missing_source_refs: [], missing_claim_refs: [], unreferenced_files: [], child_text: [] };

function material(): Obj {
  const m = goodMaterial() as Obj;
  m.parts[0].files.push({ path: RBC, role: 'figure', image_id: IMG, alt: '赤血球', shows: TEXTS.map((text) => ({ text, source_ids: ['s1'] })) });
  return m;
}
const okReading = { findings: [], learning: { verdict: 'ok', reason: '' }, conditions: { verdict: 'ok', reason: '' }, summary: '', not_read: [] };

function input(o: { figures?: unknown[]; checks?: Obj; autoRounds?: number } = {}): TriageInput {
  return {
    claims: { claims: [{ id: 'c1', text: '主張', status: 'confirmed', source_ids: ['s1'], used_in: ['p1'] }] },
    report: {
      id: 'w1',
      result: {
        verdicts: [{ claim_id: 'c1', verdict: 'confirmed', reason: 'r', opened_urls: [], presented_as: 'fact' }],
        overall_note: '',
        figures: o.figures ?? [
          { path: SVG, verdict: 'ok', verdict_raw: 'ok', reason: '', checks: [] },
          { path: RBC, verdict: 'ok', verdict_raw: 'ok', reason: '', checks: [] },
        ],
        analogy_gaps: [],
        videos: [],
        apps: [],
        meta: { mode: 'batch', turns: 1, fetch_errors: {}, fetched_ok: [], evidence_v: 2 },
      },
    },
    sources: [{ source_id: 's1', url: 'https://www.kahaku.go.jp/x', license: 'CC BY 4.0', url_was_fetched: 1, quote_found: 1, is_primary: 1 }],
    checks: { ...GREEN_CHECKS, ...(o.checks ?? {}) },
    material: material(),
    autoReverified: 0,
    reader: { status: 'done', token: 'rt1', result: okReading },
    videoMeta: [],
    trustedChannels: [],
    trustedGen: '1',
    autoRounds: o.autoRounds ?? 0,
    autoReturnMax: '2',
    verificationStatus: 'done',
    evidenceReverified: 0,
  };
}
const item = (t: { items: TriageItem[] }, id: string) => t.items.find((i) => i.id === id);
const rbcFig = (verdict: string, checks: unknown[], reason = '絵の主張 [2] が成り立たない: 静脈が青く塗られている') => [
  { path: SVG, verdict: 'ok', verdict_raw: 'ok', reason: '', checks: [] },
  { path: RBC, verdict, verdict_raw: 'ok', reason, checks },
];

describe('§O-13-4 1・2 図の項目（severity は最終の verdict・detail は番号の行が先）', () => {
  it('problem の図: fix。detail の 1 行目に wrong と unclear の番号、続けて wrong・unclear ごとの「・[n]」の行、最後に reason', () => {
    const t = triageVersion(
      input({
        figures: rbcFig('problem', [
          { n: 1, result: 'ok', note: '' },
          { n: 2, result: 'wrong', note: '絵の静脈の血が青い。出典では赤い' },
          { n: 3, result: 'unclear', note: '参照が開けなかった' },
        ]),
      }),
    );
    const it = item(t, `figure:${RBC}`)!;
    expect(it).toMatchObject({ kind: 'figure', key: 'explanation_and_expression', severity: 'fix', cause: 'figure_problem', path: RBC });
    const lines = it.detail.split('\n');
    expect(lines[0]).toBe('絵の主張 [2] に問題、[3] は確かめきれない');
    expect(lines[1]).toBe(`・[2] ${[...TEXTS[1]].slice(0, 60).join('')}: 問題（絵の静脈の血が青い。出典では赤い）`);
    expect(lines[2]).toBe(`・[3] ${TEXTS[2]}: 確かめきれない（参照が開けなかった）`);
    expect(lines[3]).toBe('絵の主張 [2] が成り立たない: 静脈が青く塗られている');
    expect(lines).toHaveLength(4);
    for (const l of lines.slice(1, 3)) expect([...l].length).toBeLessThanOrEqual(120);
  });

  it('600 字に入らない分は後ろ（reason）から切る。1 行目と番号の行が残る', () => {
    const many = TEXTS.map((_, k) => ({ n: k + 1, result: 'wrong', note: 'の'.repeat(80) }));
    const t = triageVersion(input({ figures: rbcFig('problem', many, 'x'.repeat(3000)) }));
    const d = item(t, `figure:${RBC}`)!.detail;
    expect(d).toHaveLength(ITEM_DETAIL_MAX);
    const lines = d.split('\n');
    expect(lines[0]).toBe('絵の主張 [1][2][3] に問題');
    expect(lines.slice(1, 4).map((l) => l.slice(0, 5))).toEqual(['・[1] ', '・[2] ', '・[3] ']);
    expect(lines[4]).toMatch(/^x+$/);
  });

  it('unclear だけの図は ask・1 行目は「確かめきれない」だけ。checks の無い旧い結果の図は reason だけ', () => {
    const t = triageVersion(input({ figures: rbcFig('unclear', [{ n: 1, result: 'unclear', note: '' }, { n: 2, result: 'ok', note: '' }, { n: 3, result: 'ok', note: '' }], 'r') }));
    expect(item(t, `figure:${RBC}`)).toMatchObject({ severity: 'ask', cause: 'figure_unclear', detail: `絵の主張 [1] は確かめきれない\n・[1] ${TEXTS[0]}: 確かめきれない\nr` });
    const old = triageVersion(input({ figures: [{ path: SVG, verdict: 'ok', reason: '' }, { path: RBC, verdict: 'problem', reason: '古い指摘' }] }));
    expect(item(old, `figure:${RBC}`)).toMatchObject({ severity: 'fix', detail: '古い指摘' });
    expect(figureItemDetail([], new Map(), 'だけ')).toBe('だけ');
  });

  it('return_note の図の行は「- 図 <part_id> <path>: 検証係の指摘 — 」+ detail（1 行に）。fix は autoRounds < autoReturnMax で auto_return', () => {
    const figs = rbcFig('problem', [{ n: 1, result: 'ok', note: '' }, { n: 2, result: 'wrong', note: '青い' }, { n: 3, result: 'ok', note: '' }]);
    const t = triageVersion(input({ figures: figs }));
    expect(t.action).toBe('auto_return');
    const line = t.return_note!.split('\n').find((l) => l.startsWith('- 図 '))!;
    expect(line.startsWith(`- 図 p1 ${RBC}: 検証係の指摘 — 絵の主張 [2] に問題 ・[2] `)).toBe(true);
    expect(line).toContain(': 問題（青い）');
    expect(triageVersion(input({ figures: figs, autoRounds: 2 })).action).toBe('none');
  });
});

describe('§O-13-4 4 絵の主張の機械検査の項目', () => {
  const checks = {
    figure_shows_missing: ['parts/p1/vein.png'],
    figure_shows_refs: [{ path: RBC, n: 2, source_ids: ['s8', 's9'] }],
    figure_shows_no_primary: [{ path: RBC, n: 1 }],
    figure_shows_removed: [{ path: RBC, texts: ['核が無い', '1 列で通る'] }],
  };

  it('4 項目の id・severity・title・cause・detail', () => {
    const t = triageVersion(input({ checks }));
    const base = { kind: 'check', key: 'explanation_and_expression' };
    expect(item(t, 'check:figure_shows_missing:parts/p1/vein.png')).toMatchObject({ ...base, severity: 'note', path: 'parts/p1/vein.png', title: 'scientific の画像に絵の主張（shows）が無い' });
    expect(item(t, `check:figure_shows_ref:${RBC}:2`)).toMatchObject({ ...base, severity: 'fix', cause: 'figure_shows_ref', title: '絵の主張の出典 id が出典一覧に無い', detail: 's8、s9' });
    expect(item(t, `check:figure_shows_no_primary:${RBC}:1`)).toMatchObject({
      ...base,
      severity: 'fix',
      cause: 'figure_shows_no_primary',
      title: '絵の主張に一次の出典が無い',
      detail: `一次とみなす発行主体: ${PRIMARY_HOSTS.slice(0, 8).join('、')}…`,
    });
    expect(item(t, `check:figure_shows_removed:${RBC}`)).toMatchObject({ ...base, severity: 'fix', title: '作り直しで絵の主張が減った（同じ画像）', detail: '核が無い / 1 列で通る' });
  });

  it('fix の 3 つは autoRounds < autoReturnMax で auto_return。return_note の行は「- 図 <part_id> <path>: <title>（[n] <text>）」', () => {
    const t = triageVersion(input({ checks }));
    expect(t.action).toBe('auto_return');
    const lines = t.return_note!.split('\n').filter((l) => l.startsWith('- 図 '));
    expect(lines).toEqual([
      `- 図 p1 ${RBC}: 絵の主張の出典 id が出典一覧に無い（[2] ${TEXTS[1]}）`,
      `- 図 p1 ${RBC}: 絵の主張に一次の出典が無い（[1] ${TEXTS[0]}）`,
      `- 図 p1 ${RBC}: 作り直しで絵の主張が減った（同じ画像）（核が無い / 1 列で通る）`,
    ]);
    expect(triageVersion(input({ checks, autoRounds: 2 })).action).toBe('none');
  });

  it.each(['figure_shows_refs', 'figure_shows_no_primary', 'figure_shows_removed'] as const)('%s だけでも fix で auto_return', (k) => {
    const t = triageVersion(input({ checks: { [k]: (checks as Obj)[k] } }));
    expect(t.counts.fix).toBe(1);
    expect(t.action).toBe('auto_return');
  });

  it('figure_shows_missing だけは note（差し戻さない・自動 OK を止めない）。キーの無い古い checks_json は項目を作らない', () => {
    const t = triageVersion(input({ checks: { figure_shows_missing: [RBC] } }));
    expect(t.counts).toMatchObject({ fix: 0, ask: 0, note: 1 });
    expect(t.action).toBe('none');
    expect(t.auto.explanation_and_expression).toBe('ok');
    const old = triageVersion(input());
    expect(old.items.filter((i) => i.id.startsWith('check:figure_shows'))).toEqual([]);
  });
});
