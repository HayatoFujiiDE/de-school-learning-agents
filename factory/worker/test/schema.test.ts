import { describe, expect, it } from 'vitest';
import { MATERIAL_REQUIRED_KEYS, computePublicPaths, contentDigestInput, isSafeRelativePath, normalizeOutputPath, validateOutputs } from '../src/checks/schema';
import { goodFiles, goodMaterial } from './helpers';
import { MATERIAL_REQUIRED_KEYS_V2 } from '../src/checks/schema';
import { goodFilesV2, goodMaterialV2, outputsFixture } from './helpers';

const enc = new TextEncoder();

describe('validateOutputs', () => {
  it('正しい一式は ok で、manifest は claims.json + adapt-rules.md + variants + files（昇順・重複なし）', () => {
    const r = validateOutputs(goodFiles());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.publicPaths).toEqual([
      'adapt-rules.md',
      'claims.json',
      'parts/p1/elementary-long.md',
      'parts/p1/elementary-short.md',
      'parts/p1/figure-1.svg',
      'parts/p1/game.md',
      'parts/p1/secondary-long.md',
      'parts/p1/secondary-short.md',
    ]);
    expect(r.publicPaths).not.toContain('sources.json');
    expect(r.publicPaths).not.toContain('selfcheck.md');
    expect(r.techDependencies).toEqual(['svg']);
  });

  it.each(MATERIAL_REQUIRED_KEYS)('material.json の必須キー %s が欠けたら invalid_outputs', (k) => {
    const m = goodMaterial();
    delete m[k];
    const r = validateOutputs(goodFiles(m));
    expect(r).toMatchObject({ ok: false, reason: 'invalid_outputs' });
    if (!r.ok) expect(r.detail).toBe(`missing_key:material.${k}`);
  });

  it.each(['material.json', 'claims.json', 'sources.json', 'adapt-rules.md', 'selfcheck.md'])('必須ファイル %s が無ければ invalid_outputs', (f) => {
    const files = goodFiles();
    files.delete(f);
    expect(validateOutputs(files)).toMatchObject({ ok: false, detail: `missing_required:${f}` });
  });

  it('参照先ファイルが実在しなければ invalid_outputs', () => {
    const files = goodFiles();
    files.delete('parts/p1/figure-1.svg');
    expect(validateOutputs(files)).toMatchObject({ ok: false, detail: 'missing_ref:parts/p1/figure-1.svg' });
    const files2 = goodFiles();
    files2.delete('parts/p1/game.md');
    expect(validateOutputs(files2)).toMatchObject({ ok: false, detail: 'missing_ref:parts/p1/game.md' });
  });

  it('parts/<id>/ 外への参照（sources.json 等）は invalid_outputs', () => {
    for (const bad of ['sources.json', 'selfcheck.md', 'parts/p2/elementary-short.md', 'parts/p1/../sources.json', 'parts/p1/data.json', 'parts/p1/x.js']) {
      const m = goodMaterial();
      const part = (m.parts as Array<Record<string, unknown>>)[0];
      (part.files as Array<Record<string, unknown>>).push({ path: bad, role: 'figure' });
      const files = goodFiles(m);
      files.set(bad, enc.encode('x'));
      const r = validateOutputs(files);
      expect(r.ok, bad).toBe(false);
    }
  });

  it('4 変奏（小・中 × 短・長）が揃わなければ invalid_outputs', () => {
    const m = goodMaterial();
    const part = (m.parts as Array<Record<string, unknown>>)[0];
    part.variants = (part.variants as Array<Record<string, unknown>>).filter((v) => !(v.audience === 'secondary' && v.length === 'long'));
    expect(validateOutputs(goodFiles(m))).toMatchObject({ ok: false, detail: 'missing_variant:p1:secondary-long' });
  });

  it.each([
    ['"1.0"', '1.0'],
    ['"1"', '1'],
    ['3', 3],
    ['0', 0],
    ['1.5', 1.5],
  ])('schema_version が %s なら invalid_outputs（=== 1 だけ通る）', (_label, v) => {
    const m = goodMaterial();
    m.schema_version = v;
    expect(validateOutputs(goodFiles(m))).toMatchObject({ ok: false, detail: 'bad_type:material.schema_version' });
  });

  it.each([[[0]], [[9]], [[3, 9]], [[-1]], [[3.5]], [['explain_figure']], [['3']]])('kinds が %j なら invalid_outputs（1〜8 の整数）', (kinds) => {
    const m = goodMaterial();
    m.kinds = kinds;
    expect(validateOutputs(goodFiles(m))).toMatchObject({ ok: false, detail: 'bad_type:material.kinds' });
  });

  it.each([0, 9, 2.5, '3', 'interactive', null])('parts[].kind が %j なら invalid_outputs（1〜8 の整数）', (kind) => {
    const m = goodMaterial();
    (m.parts as Array<Record<string, unknown>>)[0].kind = kind;
    expect(validateOutputs(goodFiles(m))).toMatchObject({ ok: false, detail: 'bad_type:parts[0].kind' });
  });

  it('kinds / parts[].kind は 1 と 8 を含む（境界）', () => {
    for (const k of [1, 8]) {
      const m = goodMaterial();
      m.kinds = [k];
      (m.parts as Array<Record<string, unknown>>)[0].kind = k;
      expect(validateOutputs(goodFiles(m)).ok, String(k)).toBe(true);
    }
  });

  it('needs_supporter_check は真偽値だけ（文字列は false に落とさず invalid_outputs）', () => {
    for (const v of ['true', 1, null]) {
      const m = goodMaterial();
      (m.parts as Array<Record<string, unknown>>)[0].needs_supporter_check = v;
      const r = validateOutputs(goodFiles(m));
      expect(r.ok, String(v)).toBe(false);
    }
    for (const v of [true, false]) {
      const m = goodMaterial();
      (m.parts as Array<Record<string, unknown>>)[0].needs_supporter_check = v;
      expect(validateOutputs(goodFiles(m)).ok, String(v)).toBe(true);
    }
  });

  it('JSON 不正は invalid_outputs', () => {
    const files = goodFiles();
    files.set('claims.json', enc.encode('{not json'));
    expect(validateOutputs(files)).toMatchObject({ ok: false, detail: 'json_invalid:claims.json' });
  });

  it('claims の status が不正なら invalid_outputs', () => {
    const files = goodFiles();
    files.set('claims.json', enc.encode(JSON.stringify({ claims: [{ id: 'c1', text: 't', status: 'verified', source_ids: [] }] })));
    expect(validateOutputs(files).ok).toBe(false);
  });

  it('サイズ超過・ファイル数超過は invalid_outputs', () => {
    const files = goodFiles();
    files.set('parts/p1/big.md', new Uint8Array(2 * 1024 * 1024 + 1));
    expect(validateOutputs(files)).toMatchObject({ ok: false, detail: 'file_too_large:parts/p1/big.md' });
    const many = goodFiles();
    for (let i = 0; i < 40; i++) many.set(`parts/p1/extra-${i}.md`, enc.encode('x'));
    expect(validateOutputs(many)).toMatchObject({ ok: false, detail: expect.stringMatching(/^too_many_files/) });
  });

  it('license が無ければ unknown', () => {
    const files = goodFiles();
    files.set('sources.json', enc.encode(JSON.stringify({ sources: [{ id: 's1', url: 'https://a.example/x' }] })));
    const r = validateOutputs(files);
    expect(r.ok && r.sources[0].license).toBe('unknown');
  });
});

describe('paths', () => {
  it('isSafeRelativePath', () => {
    expect(isSafeRelativePath('parts/p1/a.md')).toBe(true);
    for (const bad of ['', '/a', 'a//b', '../a', 'a/../b', 'a/%2e%2e/b', 'a\\b', 'a/./b', 'a b']) expect(isSafeRelativePath(bad), bad).toBe(false);
  });
  it('normalizeOutputPath は outputs prefix を外す', () => {
    expect(normalizeOutputPath('/mnt/session/outputs/parts/p1/a.md')).toBe('parts/p1/a.md');
    expect(normalizeOutputPath('material.json')).toBe('material.json');
    expect(normalizeOutputPath('/etc/passwd')).toBe(null);
  });
  it('computePublicPaths は重複除去', () => {
    expect(computePublicPaths({ parts: [{ variants: [{ path: 'parts/p1/a.md' }, { path: 'parts/p1/a.md' }], files: [] }] } as never)).toEqual([
      'adapt-rules.md',
      'claims.json',
      'parts/p1/a.md',
    ]);
  });
  it('contentDigestInput は path 昇順に path + "\\n" + bytes', () => {
    const m = new Map([
      ['b', enc.encode('2')],
      ['a', enc.encode('1')],
    ]);
    expect(new TextDecoder().decode(contentDigestInput(m))).toBe('a\n1b\n2');
  });
});

// §AL-1: schema_version 2（本文 1 本 + バディ向けの構造化データ）
describe('validateOutputs（schema_version 2）', () => {
  const part0 = (m: Record<string, unknown>) => (m.parts as Array<Record<string, unknown>>)[0];

  it('正しい一式は ok。public_paths は claims.json + adapt-rules.md + body + play + files（variants 由来の path は無い）', () => {
    const r = validateOutputs(goodFilesV2());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.publicPaths).toEqual([
      'adapt-rules.md',
      'claims.json',
      'parts/p1/app.html',
      'parts/p1/body.md',
      'parts/p1/figure-1.svg',
      'parts/p1/play.md',
    ]);
    expect(r.publicPaths.some((p) => /elementary|secondary|game/.test(p))).toBe(false);
    expect(r.material.schema_version).toBe(2);
    expect(r.material.summary).toBe(goodMaterialV2().summary);
    expect(r.material.spark).toBe(goodMaterialV2().spark);
    expect(r.material.summary_elementary).toBe('');
    expect(r.material.summary_secondary).toBe('');
    const p = r.material.parts[0];
    expect(p.variants).toEqual([]);
    expect(p.body).toBe('parts/p1/body.md');
    expect(p.play).toBe('parts/p1/play.md');
    expect(p.questions_for_kids).toEqual([
      { id: 'q1', text: '粉は何個目まで光るかな？', claim_ids: ['c1'] },
      { id: 'q2', text: 'たいまつを入れると、光り方はどう変わる？', claim_ids: ['c2'] },
    ]);
    expect(p.interest_entries?.map((e) => e.interest)).toEqual(['minecraft', 'craft']);
    expect(r.techDependencies).toEqual(['html', 'svg']);
  });

  it('play は任意（無ければ public_paths にも出ない）', () => {
    const m = goodMaterialV2();
    delete part0(m).play;
    const files = goodFilesV2(m);
    files.delete('parts/p1/play.md');
    const r = validateOutputs(files);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.material.parts[0].play).toBeUndefined();
    expect(r.publicPaths).not.toContain('parts/p1/play.md');
  });

  it.each(MATERIAL_REQUIRED_KEYS_V2)('material.json の必須キー %s が欠けたら missing_key', (k) => {
    const m = goodMaterialV2();
    delete m[k];
    expect(validateOutputs(goodFilesV2(m))).toMatchObject({ ok: false, reason: 'invalid_outputs', detail: `missing_key:material.${k}` });
  });

  it('schema 2 は summary_elementary / summary_secondary を要らない（あっても読まない）', () => {
    const m = goodMaterialV2();
    expect('summary_elementary' in m).toBe(false);
    m.summary_elementary = 3;
    const r = validateOutputs(goodFilesV2(m));
    expect(r.ok && r.material.summary_elementary).toBe('');
  });

  it('parts[].body が無ければ missing_key:parts[0].body', () => {
    const m = goodMaterialV2();
    delete part0(m).body;
    expect(validateOutputs(goodFilesV2(m))).toMatchObject({ ok: false, detail: 'missing_key:parts[0].body' });
  });

  it('summary / spark が文字列でなければ bad_type', () => {
    for (const [k, v] of [['summary', null], ['summary', 3], ['spark', null], ['spark', ['x']]] as const) {
      const m = goodMaterialV2();
      m[k] = v;
      expect(validateOutputs(goodFilesV2(m)), `${k}=${JSON.stringify(v)}`).toMatchObject({ ok: false, detail: `bad_type:material.${k}` });
    }
  });

  it('body / play の参照先ファイルが無ければ missing_ref', () => {
    const files = goodFilesV2();
    files.delete('parts/p1/body.md');
    expect(validateOutputs(files)).toMatchObject({ ok: false, detail: 'missing_ref:parts/p1/body.md' });
    const files2 = goodFilesV2();
    files2.delete('parts/p1/play.md');
    expect(validateOutputs(files2)).toMatchObject({ ok: false, detail: 'missing_ref:parts/p1/play.md' });
  });

  it('body / play は parts/<id>/ 配下の .md だけ（.svg / .html・別の part・外は path_outside_part）', () => {
    for (const key of ['body', 'play']) {
      for (const bad of ['parts/p1/figure-1.svg', 'parts/p1/app.html', 'parts/p2/body.md', 'body.md', 'parts/p1/../body.md']) {
        const m = goodMaterialV2();
        part0(m)[key] = bad;
        const files = goodFilesV2(m);
        files.set(bad, enc.encode('x'));
        expect(validateOutputs(files), `${key}=${bad}`).toMatchObject({ ok: false, detail: `path_outside_part:${bad}` });
      }
    }
  });

  it('body / play が文字列でなければ bad_type（play: null も不可）', () => {
    for (const [key, v] of [['body', null], ['body', 3], ['body', ['parts/p1/body.md']], ['play', null], ['play', 1], ['play', {}]] as const) {
      const m = goodMaterialV2();
      part0(m)[key] = v;
      expect(validateOutputs(goodFilesV2(m)), `${key}=${JSON.stringify(v)}`).toMatchObject({ ok: false, detail: `bad_type:parts[0].${key}` });
    }
  });

  it('schema 2 の part に variants があれば bad_type:parts[0].variants（空配列でも混ぜない）', () => {
    for (const v of [[], [{ audience: 'elementary', length: 'short', interest: null, game: false, path: 'parts/p1/body.md' }], null]) {
      const m = goodMaterialV2();
      part0(m).variants = v;
      expect(validateOutputs(goodFilesV2(m)), JSON.stringify(v)).toMatchObject({ ok: false, detail: 'bad_type:parts[0].variants' });
    }
  });

  it('questions_for_kids は省略・空配列・claim_ids 空を通し、存在する値の型違反だけ拒否する', () => {
    for (const set of [(p: Record<string, unknown>) => delete p.questions_for_kids, (p: Record<string, unknown>) => (p.questions_for_kids = [])]) {
      const m = goodMaterialV2();
      set(part0(m));
      expect(validateOutputs(goodFilesV2(m)).ok).toBe(true);
    }
    const empty = goodMaterialV2();
    part0(empty).questions_for_kids = [{ id: 'q1', text: '？', claim_ids: [] }];
    expect(validateOutputs(goodFilesV2(empty)).ok).toBe(true);
    const cases: Array<[unknown, string]> = [
      [null, 'bad_type:parts[0].questions_for_kids'],
      [{ id: 'q1' }, 'bad_type:parts[0].questions_for_kids'],
      ['q1', 'bad_type:parts[0].questions_for_kids'],
      [['q1'], 'bad_type:parts[0].questions_for_kids[0]'],
      [[null], 'bad_type:parts[0].questions_for_kids[0]'],
      [[{ id: 1, text: '？', claim_ids: ['c1'] }], 'bad_type:parts[0].questions_for_kids[0].id'],
      [[{ id: 'q1', text: null, claim_ids: ['c1'] }], 'bad_type:parts[0].questions_for_kids[0].text'],
      [[{ id: 'q1', text: '？' }], 'bad_type:parts[0].questions_for_kids[0].claim_ids'],
      [[{ id: 'q1', text: '？', claim_ids: 'c1' }], 'bad_type:parts[0].questions_for_kids[0].claim_ids'],
      [[{ id: 'q1', text: '？', claim_ids: ['c1'] }, { id: 'q2', text: '？', claim_ids: [2] }], 'bad_type:parts[0].questions_for_kids[1].claim_ids'],
    ];
    for (const [v, detail] of cases) {
      const m = goodMaterialV2();
      part0(m).questions_for_kids = v;
      expect(validateOutputs(goodFilesV2(m)), JSON.stringify(v)).toMatchObject({ ok: false, detail });
    }
  });

  it('questions_for_kids の claim_ids が claims.json に無くても拒否しない（赤印は取り込み側）', () => {
    const m = goodMaterialV2();
    part0(m).questions_for_kids = [{ id: 'q1', text: '？', claim_ids: ['c9'] }];
    const r = validateOutputs(goodFilesV2(m));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.material.parts[0].questions_for_kids).toEqual([{ id: 'q1', text: '？', claim_ids: ['c9'] }]);
  });

  it('interest_entries は {interest: string | null, text: string} の配列（省略は通す）', () => {
    const none = goodMaterialV2();
    delete part0(none).interest_entries;
    expect(validateOutputs(goodFilesV2(none)).ok).toBe(true);
    const nul = goodMaterialV2();
    part0(nul).interest_entries = [{ interest: null, text: 'だれでも' }];
    const r = validateOutputs(goodFilesV2(nul));
    expect(r.ok && r.material.parts[0].interest_entries).toEqual([{ interest: null, text: 'だれでも' }]);
    const cases: Array<[unknown, string]> = [
      [null, 'bad_type:parts[0].interest_entries'],
      [{}, 'bad_type:parts[0].interest_entries'],
      [['x'], 'bad_type:parts[0].interest_entries[0]'],
      [[{ interest: 3, text: 'x' }], 'bad_type:parts[0].interest_entries[0].interest'],
      [[{ interest: 'minecraft' }], 'bad_type:parts[0].interest_entries[0].text'],
    ];
    for (const [v, detail] of cases) {
      const m = goodMaterialV2();
      part0(m).interest_entries = v;
      expect(validateOutputs(goodFilesV2(m)), JSON.stringify(v)).toMatchObject({ ok: false, detail });
    }
  });

  it('files / needs_supporter_check / entry_point は schema 1 と同じ検査', () => {
    const files = goodFilesV2();
    files.delete('parts/p1/figure-1.svg');
    expect(validateOutputs(files)).toMatchObject({ ok: false, detail: 'missing_ref:parts/p1/figure-1.svg' });
    const m = goodMaterialV2();
    part0(m).needs_supporter_check = 'true';
    expect(validateOutputs(goodFilesV2(m))).toMatchObject({ ok: false, detail: 'bad_type:parts[0].needs_supporter_check' });
    const m2 = goodMaterialV2();
    part0(m2).entry_point = { type: 'read', text: 'x' };
    expect(validateOutputs(goodFilesV2(m2))).toMatchObject({ ok: false, detail: 'bad_type:parts[0].entry_point' });
  });

  it.each([
    ['3', 3],
    ['"2"', '2'],
    ['2.5', 2.5],
    ['null', null],
  ])('schema_version が %s なら bad_type:material.schema_version（schema 2 の形でも）', (_label, v) => {
    const m = goodMaterialV2();
    m.schema_version = v;
    expect(validateOutputs(goodFilesV2(m))).toMatchObject({ ok: false, detail: 'bad_type:material.schema_version' });
    const m1 = goodMaterial();
    m1.schema_version = v;
    expect(validateOutputs(goodFiles(m1))).toMatchObject({ ok: false, detail: 'bad_type:material.schema_version' });
  });

  it('claims.json の text_elementary は任意の文字列として受け、検査しない', () => {
    const files = goodFilesV2();
    expect(new TextDecoder().decode(files.get('claims.json')!)).toContain('text_elementary');
    expect(validateOutputs(files).ok).toBe(true);
  });

  it('わざと崩した v2 fixture（_shared-v2-bad）も validator は通す（質の赤印は取り込みの機械検査）', () => {
    const files = outputsFixture('_shared-v2-bad');
    const r = validateOutputs(files);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const body = new TextDecoder().decode(files.get('parts/p1/body.md')!);
    expect([...body.replace(/\[c\d+\]/g, '')].length).toBeGreaterThanOrEqual(150);
    expect(r.material.parts[0].questions_for_kids).toEqual([{ id: 'q1', text: '粉は何個目まで光るかな？', claim_ids: ['c9'] }]);
  });

  it('good な v2 fixture のファイルは goodFilesV2 と同じ一式', () => {
    const fx = outputsFixture('_shared-v2');
    const g = goodFilesV2();
    expect([...g.keys()].sort()).toEqual([...fx.keys()].sort());
    expect(JSON.parse(new TextDecoder().decode(g.get('material.json')!))).toEqual(JSON.parse(new TextDecoder().decode(fx.get('material.json')!)));
  });
});
