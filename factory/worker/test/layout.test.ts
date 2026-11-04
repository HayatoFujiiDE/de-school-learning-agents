// resolveOutputLayout（契約 §E-0、§B-4-d `versioned`、§R-41）: Files API の basename から論理パスを復元する純関数
import { describe, expect, it } from 'vitest';
import { resolveOutputLayout } from '../src/checks/layout';
import { validateOutputs } from '../src/checks/schema';
import { goodFiles, goodMaterial } from './helpers';

const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1);
/** 論理パスの一式を「本物の files.list が返す形」（basename だけ）にする */
const rawOf = (files: Map<string, Uint8Array>) => {
  const raw = new Map<string, Uint8Array>();
  for (const [p, b] of files) raw.set(basename(p), b);
  return raw;
};
const dec = new TextDecoder();
const enc = new TextEncoder();

function twoParts(): Record<string, unknown> {
  const m = goodMaterial();
  const p1 = (m.parts as Array<Record<string, unknown>>)[0];
  const v = (a: string, l: string, game = false, path?: string) => ({ audience: a, length: l, interest: null, game, path: path ?? `parts/p2/p2-${a}-${l}.md` });
  const p2 = {
    ...p1,
    id: 'p2',
    kind: 4,
    title: '動かしてみる',
    variants: [v('elementary', 'short'), v('elementary', 'long'), v('secondary', 'short'), v('secondary', 'long'), v('elementary', 'short', true, 'parts/p2/p2-game.md')],
    files: [{ path: 'parts/p2/app.html', role: 'app' }],
    tech_dependencies: ['html'],
  };
  return { ...m, kinds: [3, 4], parts: [p1, p2] };
}

describe('resolveOutputLayout', () => {
  it('通常: 最上位は同名、parts の参照は basename で引かれ、validateOutputs を通る', () => {
    const logical = goodFiles();
    logical.set('questions.json', enc.encode('{"questions":[]}'));
    const raw = rawOf(logical);
    const r = resolveOutputLayout([...raw.keys()], dec.decode(raw.get('material.json')!));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect([...r.files.keys()].sort()).toEqual([...logical.keys()].sort());
    expect(r.files.get('parts/p1/elementary-short.md')).toBe('elementary-short.md');
    expect(r.files.get('questions.json')).toBe('questions.json');
    expect(r.unreferenced).toEqual([]);
    const rebuilt = new Map([...r.files].map(([l, b]) => [l, raw.get(b)!]));
    expect(validateOutputs(rebuilt).ok).toBe(true);
  });

  it('2 パーツで basename が素材全体で一意なら、それぞれのパーツの論理パスへ戻る', () => {
    const logical = goodFiles(twoParts());
    for (const a of ['elementary', 'secondary']) for (const l of ['short', 'long']) logical.set(`parts/p2/p2-${a}-${l}.md`, enc.encode('p2 [c1]'));
    logical.set('parts/p2/p2-game.md', enc.encode('p2 game'));
    logical.set('parts/p2/app.html', enc.encode('<html></html>'));
    const raw = rawOf(logical);
    const r = resolveOutputLayout([...raw.keys()], dec.decode(raw.get('material.json')!));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.files.get('parts/p2/p2-elementary-short.md')).toBe('p2-elementary-short.md');
    expect(r.files.get('parts/p2/app.html')).toBe('app.html');
    expect(r.files.get('parts/p1/elementary-short.md')).toBe('elementary-short.md');
    expect(r.files.size).toBe(logical.size);
    expect(validateOutputs(new Map([...r.files].map(([l, b]) => [l, raw.get(b)!]))).ok).toBe(true);
  });

  it('raw に同じ basename が 2 つ以上あれば duplicate_basename', () => {
    const names = [...rawOf(goodFiles()).keys(), 'figure-1.svg'];
    expect(resolveOutputLayout(names, JSON.stringify(goodMaterial()))).toEqual({ ok: false, detail: 'duplicate_basename:figure-1.svg' });
  });

  it('別々のパーツが同じ basename を参照したら duplicate_basename（同じ raw を 2 つの論理パスに配れない）', () => {
    const m = twoParts();
    const p2 = (m.parts as Array<Record<string, unknown>>)[1];
    p2.files = [{ path: 'parts/p2/figure-1.svg', role: 'figure' }]; // p1 の figure-1.svg と同名
    const names = [...rawOf(goodFiles(m)).keys()];
    expect(resolveOutputLayout(names, JSON.stringify(m))).toEqual({ ok: false, detail: 'duplicate_basename:figure-1.svg' });
    // 最上位のファイル名をパーツ側で使っても同じ
    const m2 = goodMaterial();
    ((m2.parts as Array<Record<string, unknown>>)[0].files as unknown[]).push({ path: 'parts/p1/selfcheck.md', role: 'note' });
    expect(resolveOutputLayout([...rawOf(goodFiles(m2)).keys()], JSON.stringify(m2))).toEqual({ ok: false, detail: 'duplicate_basename:selfcheck.md' });
  });

  it('どこからも参照されない raw は Map に入れず unreferenced に昇順で残す', () => {
    const raw = rawOf(goodFiles());
    const names = [...raw.keys(), 'zz-notes.md', 'draft.svg', 'app.html'];
    const r = resolveOutputLayout(names, dec.decode(raw.get('material.json')!));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.unreferenced).toEqual(['app.html', 'draft.svg', 'zz-notes.md']);
    for (const n of r.unreferenced) expect([...r.files.values()]).not.toContain(n);
  });

  it('参照先が raw に無い path は Map に入れない（validateOutputs の missing_ref に落ちる）', () => {
    const raw = rawOf(goodFiles());
    raw.delete('figure-1.svg');
    const r = resolveOutputLayout([...raw.keys()], dec.decode(raw.get('material.json')!));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.files.has('parts/p1/figure-1.svg')).toBe(false);
    expect(validateOutputs(new Map([...r.files].map(([l, b]) => [l, raw.get(b)!])))).toMatchObject({ ok: false, detail: 'missing_ref:parts/p1/figure-1.svg' });
  });

  it('material.json が JSON として読めなければ json_invalid:material.json', () => {
    const names = [...rawOf(goodFiles()).keys()];
    expect(resolveOutputLayout(names, '{"schema_version": 1,')).toEqual({ ok: false, detail: 'json_invalid:material.json' });
  });

  it('parts が配列でない等の形の違いは最上位だけの Map で返し、validateOutputs に落とさせる', () => {
    const m = { ...goodMaterial(), parts: { p1: 'parts/p1/elementary-short.md' } };
    const logical = goodFiles(m);
    const raw = rawOf(logical);
    const r = resolveOutputLayout([...raw.keys()], JSON.stringify(m));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect([...r.files.keys()].sort()).toEqual(['adapt-rules.md', 'claims.json', 'material.json', 'selfcheck.md', 'sources.json']);
    expect(r.unreferenced).toContain('elementary-short.md');
    expect(validateOutputs(new Map([...r.files].map(([l, b]) => [l, raw.get(b)!])))).toMatchObject({ ok: false, detail: 'bad_type:material.parts' });
    // variants が文字列の配列（§R-42 の実例）も読み飛ばして §E へ
    const m2 = goodMaterial();
    (m2.parts as Array<Record<string, unknown>>)[0].variants = ['parts/p1/elementary-short.md'];
    const r2 = resolveOutputLayout([...rawOf(goodFiles(m2)).keys()], JSON.stringify(m2));
    expect(r2.ok).toBe(true);
  });

  it('安全でない path（`..` 等）は論理キーにしない', () => {
    const m = goodMaterial();
    ((m.parts as Array<Record<string, unknown>>)[0].files as unknown[]).push({ path: 'parts/p1/../x.svg', role: 'figure' });
    const names = [...rawOf(goodFiles(m)).keys(), 'x.svg'];
    const r = resolveOutputLayout(names, JSON.stringify(m));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect([...r.files.keys()].some((k) => k.includes('..'))).toBe(false);
    expect(r.unreferenced).toEqual(['x.svg']);
  });

  it('material.json が raw に無ければ最上位だけ（validateOutputs の missing_required に落ちる）', () => {
    const raw = rawOf(goodFiles());
    raw.delete('material.json');
    const r = resolveOutputLayout([...raw.keys()], '');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.files.has('material.json')).toBe(false);
    expect(validateOutputs(new Map([...r.files].map(([l, b]) => [l, raw.get(b)!])))).toMatchObject({ ok: false, detail: 'missing_required:material.json' });
  });
});
