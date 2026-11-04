import { describe, expect, it } from 'vitest';
import { MATERIAL_REQUIRED_KEYS, computePublicPaths, contentDigestInput, isSafeRelativePath, normalizeOutputPath, validateOutputs } from '../src/checks/schema';
import { goodFiles, goodMaterial } from './helpers';

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
    ['2', 2],
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
