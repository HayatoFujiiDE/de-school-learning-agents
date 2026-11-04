// 純関数: material.json / claims.json / sources.json の検証と公開 manifest の算出（契約 §E）。I/O を持たない。
// ここで失敗したものだけが invalid_outputs（必須キー欠落・参照先不在・parts 外参照・JSON 不正・サイズ超過）。

export const REQUIRED_FILES = ['material.json', 'claims.json', 'sources.json', 'adapt-rules.md', 'selfcheck.md'] as const;
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_FILES = 40;
export const MATERIAL_REQUIRED_KEYS = [
  'schema_version',
  'slug',
  'title',
  'kinds',
  'catalog_item_id',
  'concept_codes',
  'summary_elementary',
  'summary_secondary',
  'parts',
] as const;

export const AUDIENCES = ['elementary', 'secondary'] as const;
export const LENGTHS = ['short', 'long'] as const;
export const ENTRY_TYPES = ['look', 'touch', 'try', 'make'] as const;
export const CLAIM_STATUSES = ['confirmed', 'hypothesis', 'unverified'] as const;
const PART_FILE_EXTENSIONS = ['.md', '.svg', '.html'];

export interface Variant {
  audience: (typeof AUDIENCES)[number];
  length: (typeof LENGTHS)[number];
  interest: string | null;
  game: boolean;
  path: string;
}
export interface PartFile {
  path: string;
  role: string;
}
export interface Part {
  id: string;
  kind: number;
  title: string;
  entry_point: { type: (typeof ENTRY_TYPES)[number]; text: string };
  variants: Variant[];
  files: PartFile[];
  adjustable: string[];
  tech_dependencies: string[];
  runtime_check: unknown;
  needs_supporter_check: boolean;
}
export interface Material {
  schema_version: number;
  slug: string;
  title: string;
  kinds: number[];
  catalog_item_id: string | null;
  concept_codes: string[];
  summary_elementary: string;
  summary_secondary: string;
  conditions: unknown;
  license_summary: string | null;
  parts: Part[];
}
export interface Claim {
  id: string;
  text: string;
  status: (typeof CLAIM_STATUSES)[number];
  source_ids: string[];
  used_in: string[];
}
export interface Source {
  id: string;
  url: string;
  title: string | null;
  accessed_at: string | null;
  quoted_excerpt: string | null;
  license: string;
  is_primary: boolean;
}

export type SchemaResult =
  | {
      ok: true;
      material: Material;
      claims: Claim[];
      sources: Source[];
      adaptRulesMd: string;
      selfcheckMd: string;
      publicPaths: string[];
      techDependencies: string[];
    }
  | { ok: false; reason: 'invalid_outputs'; detail: string };

/** outputs 相対パスとして安全か（`..`・`%`・先頭 `/`・空セグメント・`\`・制御文字を拒否） */
export function isSafeRelativePath(p: string): boolean {
  if (typeof p !== 'string' || p.length === 0 || p.length > 200) return false;
  if (p.startsWith('/') || p.includes('%') || p.includes('\\')) return false;
  if (!/^[A-Za-z0-9._\-/]+$/.test(p)) return false;
  const segs = p.split('/');
  return segs.every((s) => s.length > 0 && s !== '.' && s !== '..');
}

/** Files API の filename を outputs 相対パスにする。安全でなければ null */
export function normalizeOutputPath(filename: string): string | null {
  let p = String(filename ?? '');
  for (const prefix of ['/mnt/session/outputs/', 'mnt/session/outputs/', 'outputs/']) {
    if (p.startsWith(prefix)) {
      p = p.slice(prefix.length);
      break;
    }
  }
  return isSafeRelativePath(p) ? p : null;
}

/** §E-1: kinds と parts[].kind は 1〜8 の整数 */
export const isKind = (k: unknown): k is number => Number.isInteger(k) && (k as number) >= 1 && (k as number) <= 8;

const fail = (detail: string): SchemaResult => ({ ok: false, reason: 'invalid_outputs', detail });
const isStr = (v: unknown): v is string => typeof v === 'string';
const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/** パーツ配下の参照パスか（parts/<part_id>/ 配下で .md/.svg/.html） */
export function isPartPath(p: string, partId: string): boolean {
  if (!isSafeRelativePath(p)) return false;
  if (!p.startsWith(`parts/${partId}/`)) return false;
  const rest = p.slice(`parts/${partId}/`.length);
  if (rest.length === 0) return false;
  return PART_FILE_EXTENSIONS.some((ext) => p.endsWith(ext));
}

export function validateOutputs(files: Map<string, Uint8Array>): SchemaResult {
  if (files.size > MAX_FILES) return fail(`too_many_files:${files.size}`);
  for (const [p, bytes] of files) {
    if (bytes.byteLength > MAX_FILE_BYTES) return fail(`file_too_large:${p}`);
  }
  for (const r of REQUIRED_FILES) if (!files.has(r)) return fail(`missing_required:${r}`);

  const dec = new TextDecoder('utf-8');
  const text = (p: string) => dec.decode(files.get(p)!);

  // material.json
  const mj = parseJson(text('material.json'));
  if (!mj.ok) return fail('json_invalid:material.json');
  const m = mj.value as Record<string, unknown>;
  if (!m || typeof m !== 'object' || Array.isArray(m)) return fail('json_invalid:material.json');
  for (const k of MATERIAL_REQUIRED_KEYS) if (!(k in m)) return fail(`missing_key:material.${k}`);
  if (m.schema_version !== 1) return fail('bad_type:material.schema_version');
  if (!isStr(m.slug) || !isStr(m.title)) return fail('bad_type:material.slug_or_title');
  if (!Array.isArray(m.kinds) || !m.kinds.every(isKind)) return fail('bad_type:material.kinds');
  if (!(m.catalog_item_id === null || isStr(m.catalog_item_id))) return fail('bad_type:material.catalog_item_id');
  if (!isStrArr(m.concept_codes)) return fail('bad_type:material.concept_codes');
  if (!isStr(m.summary_elementary) || !isStr(m.summary_secondary)) return fail('bad_type:material.summary');
  if (!Array.isArray(m.parts) || m.parts.length === 0) return fail('bad_type:material.parts');

  const parts: Part[] = [];
  const seenPartIds = new Set<string>();
  const techDeps = new Set<string>();
  for (const [i, raw] of (m.parts as unknown[]).entries()) {
    const p = raw as Record<string, unknown>;
    if (!p || typeof p !== 'object') return fail(`bad_type:parts[${i}]`);
    if (!isStr(p.id) || !/^[A-Za-z0-9_-]{1,40}$/.test(p.id)) return fail(`bad_type:parts[${i}].id`);
    if (seenPartIds.has(p.id)) return fail(`duplicate_part:${p.id}`);
    seenPartIds.add(p.id);
    if (!isKind(p.kind)) return fail(`bad_type:parts[${i}].kind`);
    if (!isStr(p.title)) return fail(`bad_type:parts[${i}].title`);
    // 安全の印は黙って false に落とさない（文字列 "true" 等は取り込みを止める。§E-1 の型・§R-46）
    if (p.needs_supporter_check !== undefined && typeof p.needs_supporter_check !== 'boolean')
      return fail(`bad_type:parts[${i}].needs_supporter_check`);
    const ep = p.entry_point as Record<string, unknown> | undefined;
    if (!ep || !(ENTRY_TYPES as readonly unknown[]).includes(ep.type) || !isStr(ep.text))
      return fail(`bad_type:parts[${i}].entry_point`);
    if (!Array.isArray(p.variants)) return fail(`bad_type:parts[${i}].variants`);
    const variants: Variant[] = [];
    for (const [j, vr] of (p.variants as unknown[]).entries()) {
      const v = vr as Record<string, unknown>;
      if (!v || typeof v !== 'object') return fail(`bad_type:parts[${i}].variants[${j}]`);
      if (!(AUDIENCES as readonly unknown[]).includes(v.audience)) return fail(`bad_type:parts[${i}].variants[${j}].audience`);
      if (!(LENGTHS as readonly unknown[]).includes(v.length)) return fail(`bad_type:parts[${i}].variants[${j}].length`);
      if (!(v.interest === null || v.interest === undefined || isStr(v.interest)))
        return fail(`bad_type:parts[${i}].variants[${j}].interest`);
      if (!isStr(v.path)) return fail(`bad_type:parts[${i}].variants[${j}].path`);
      if (!isPartPath(v.path, p.id)) return fail(`path_outside_part:${v.path}`);
      if (!files.has(v.path)) return fail(`missing_ref:${v.path}`);
      variants.push({
        audience: v.audience as Variant['audience'],
        length: v.length as Variant['length'],
        interest: isStr(v.interest) ? v.interest : null,
        game: v.game === true,
        path: v.path,
      });
    }
    for (const a of AUDIENCES)
      for (const l of LENGTHS)
        if (!variants.some((v) => !v.game && v.audience === a && v.length === l))
          return fail(`missing_variant:${p.id}:${a}-${l}`);
    const pfiles: PartFile[] = [];
    if (p.files !== undefined) {
      if (!Array.isArray(p.files)) return fail(`bad_type:parts[${i}].files`);
      for (const [j, fr] of (p.files as unknown[]).entries()) {
        const f = fr as Record<string, unknown>;
        if (!f || !isStr(f.path)) return fail(`bad_type:parts[${i}].files[${j}]`);
        if (!isPartPath(f.path, p.id)) return fail(`path_outside_part:${f.path}`);
        if (!files.has(f.path)) return fail(`missing_ref:${f.path}`);
        pfiles.push({ path: f.path, role: isStr(f.role) ? f.role : 'file' });
      }
    }
    const td = isStrArr(p.tech_dependencies) ? p.tech_dependencies : [];
    td.forEach((t) => techDeps.add(t));
    parts.push({
      id: p.id,
      kind: p.kind as number,
      title: p.title,
      entry_point: { type: ep.type as Part['entry_point']['type'], text: ep.text as string },
      variants,
      files: pfiles,
      adjustable: isStrArr(p.adjustable) ? p.adjustable : [],
      tech_dependencies: td,
      // 型違い（オブジェクト以外）は null に落とす（§R-46）
      runtime_check: p.runtime_check && typeof p.runtime_check === 'object' && !Array.isArray(p.runtime_check) ? p.runtime_check : null,
      needs_supporter_check: p.needs_supporter_check === true,
    });
  }

  // claims.json
  const cj = parseJson(text('claims.json'));
  if (!cj.ok) return fail('json_invalid:claims.json');
  const cRaw = (cj.value as Record<string, unknown> | null)?.claims;
  if (!Array.isArray(cRaw)) return fail('missing_key:claims.claims');
  const claims: Claim[] = [];
  const claimIds = new Set<string>();
  for (const [i, raw] of cRaw.entries()) {
    const c = raw as Record<string, unknown>;
    if (!c || !isStr(c.id) || !isStr(c.text)) return fail(`bad_type:claims[${i}]`);
    if (!(CLAIM_STATUSES as readonly unknown[]).includes(c.status)) return fail(`bad_type:claims[${i}].status`);
    if (!isStrArr(c.source_ids)) return fail(`bad_type:claims[${i}].source_ids`);
    if (claimIds.has(c.id)) return fail(`duplicate_claim:${c.id}`);
    claimIds.add(c.id);
    claims.push({
      id: c.id,
      text: c.text,
      status: c.status as Claim['status'],
      source_ids: c.source_ids,
      used_in: isStrArr(c.used_in) ? c.used_in : [],
    });
  }

  // sources.json
  const sj = parseJson(text('sources.json'));
  if (!sj.ok) return fail('json_invalid:sources.json');
  const sRaw = (sj.value as Record<string, unknown> | null)?.sources;
  if (!Array.isArray(sRaw)) return fail('missing_key:sources.sources');
  const sources: Source[] = [];
  const sourceIds = new Set<string>();
  for (const [i, raw] of sRaw.entries()) {
    const s = raw as Record<string, unknown>;
    if (!s || !isStr(s.id) || !isStr(s.url)) return fail(`bad_type:sources[${i}]`);
    let proto = '';
    try {
      proto = new URL(s.url).protocol;
    } catch {
      return fail(`bad_url:sources[${i}]`);
    }
    if (proto !== 'https:' && proto !== 'http:') return fail(`bad_url:sources[${i}]`);
    if (sourceIds.has(s.id)) return fail(`duplicate_source:${s.id}`);
    sourceIds.add(s.id);
    sources.push({
      id: s.id,
      url: s.url,
      title: isStr(s.title) ? s.title : null,
      accessed_at: isStr(s.accessed_at) ? s.accessed_at : null,
      quoted_excerpt: isStr(s.quoted_excerpt) ? s.quoted_excerpt : null,
      license: isStr(s.license) && s.license.length > 0 ? s.license : 'unknown',
      is_primary: s.is_primary === true,
    });
  }

  const material: Material = {
    schema_version: m.schema_version as number,
    slug: m.slug as string,
    title: m.title as string,
    kinds: m.kinds as number[],
    catalog_item_id: (m.catalog_item_id as string | null) ?? null,
    concept_codes: m.concept_codes as string[],
    summary_elementary: m.summary_elementary as string,
    summary_secondary: m.summary_secondary as string,
    conditions: m.conditions ?? null,
    license_summary: isStr(m.license_summary) ? m.license_summary : null,
    parts,
  };

  return {
    ok: true,
    material,
    claims,
    sources,
    adaptRulesMd: text('adapt-rules.md'),
    selfcheckMd: text('selfcheck.md'),
    publicPaths: computePublicPaths(material),
    techDependencies: [...techDeps].sort(),
  };
}

/** §E-4: claims.json, adapt-rules.md, variants[].path, files[].path（重複除去・昇順） */
export function computePublicPaths(material: Pick<Material, 'parts'>): string[] {
  const set = new Set<string>(['claims.json', 'adapt-rules.md']);
  for (const p of material.parts) {
    for (const v of p.variants) set.add(v.path);
    for (const f of p.files) set.add(f.path);
  }
  return [...set].sort();
}

/** §E-3: path 昇順に path + "\n" + bytes を連結した列（SHA-256 の入力） */
export function contentDigestInput(files: Map<string, Uint8Array>): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  for (const p of [...files.keys()].sort()) {
    chunks.push(enc.encode(p + '\n'));
    chunks.push(files.get(p)!);
  }
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}
