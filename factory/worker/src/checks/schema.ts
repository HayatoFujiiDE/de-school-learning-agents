// 純関数: material.json / claims.json / sources.json の検証と公開 manifest の算出（契約 §E）。I/O を持たない。
// ここで失敗したものだけが invalid_outputs（必須キー欠落・参照先不在・parts 外参照・JSON 不正・サイズ超過・画像の先頭バイト不一致 §M-2・動画の形 §Q-1・絵の主張の形 §O-13-2 1・立体モデルの形 §AJ-1）。

import { urlHostMatches } from './hosts';
import { MODELS3D, type Model3dEntry } from '../generated/models3d-catalog';

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
/** §M-1: parts[].files[].path だけに許す画像（variants には許さない） */
const PART_IMAGE_EXTENSIONS = ['.png', '.webp'];

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
  /** §O-7（旧 §M-2-7 1）: 生成した画像の参照。取り込みは raw/ でなく image_requests と R2 から採る */
  image_id?: string;
  /** 絵の説明（120 字まで。型違い・長すぎは null。§R-46 と同じく安全側の既定） */
  alt?: string | null;
  /** §O-13-1 1: 絵の主張（image_id のある行だけ。2〜6 件） */
  shows?: FigureShow[];
  /** §O-13-1 3: 参照（https の URL。image_id のある行だけ） */
  reference_url?: string;
}

/** §O-13-1 1: 絵の主張の 1 文と、その出典 id（sources.json の id） */
export interface FigureShow {
  text: string;
  source_ids: string[];
}

/** image_requests.id の形（§O-6 b） */
export const IMAGE_ID_RE = /^img_[0-9a-f]{32}$/;
export const IMAGE_ALT_MAX_CHARS = 120;

export interface ImageRef {
  path: string;
  image_id: string;
  alt: string | null;
}

const isPlainObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * §O-7（旧 §M-2-7 1）: parts[].files[] の image_id の検査。image_id のキーがあれば、path の拡張子は .png / .webp、
 * image_id は /^img_[0-9a-f]{32}$/ の文字列。違えば bad_image_ref:<path>。alt は文字列 120 字（code point）までなら採り、それ以外は null
 */
export function checkImageRef(f: Record<string, unknown>): { ok: true; ref: ImageRef | null } | { ok: false; detail: string } {
  if (!('image_id' in f)) return { ok: true, ref: null };
  const path = typeof f.path === 'string' ? f.path : '';
  if (typeof f.image_id !== 'string' || !IMAGE_ID_RE.test(f.image_id) || !PART_IMAGE_EXTENSIONS.some((ext) => path.endsWith(ext)))
    return { ok: false, detail: `bad_image_ref:${path}` };
  const alt = typeof f.alt === 'string' && [...f.alt].length <= IMAGE_ALT_MAX_CHARS ? f.alt : null;
  return { ok: true, ref: { path, image_id: f.image_id, alt } };
}

/** §O-13-2 1: 絵の主張の形の上限 */
export const SHOWS_MIN = 2;
export const SHOWS_MAX = 6;
export const SHOW_TEXT_MAX = 200;
export const SHOW_SOURCE_IDS_MAX = 5;
export const SHOW_SOURCE_ID_MAX = 40;
/** 素材全体の絵の主張の合計の上限（検証係の入力の増分を抑える。§O-13-3 7） */
export const SHOWS_TOTAL_MAX = 48;
export const REFERENCE_URL_MAX = 2000;

const cpLen = (s: string) => [...s].length;

/**
 * §O-13-2 1: files[] の行の shows / reference_url の形の検査（純関数）。hasImageId = その行に image_id がある（checkImageRef が通った）。
 * image_id の無い行に shows か reference_url があれば、または形が違えば { ok: false }（呼び出し側が bad_image_shows:<path> にする）。
 * 無い時は { ok: true, shows: null, reference_url: null }
 */
export function checkImageShows(
  f: Record<string, unknown>,
  hasImageId: boolean,
): { ok: true; shows: FigureShow[] | null; reference_url: string | null } | { ok: false } {
  const hasShows = 'shows' in f;
  const hasRef = 'reference_url' in f;
  if (!hasShows && !hasRef) return { ok: true, shows: null, reference_url: null };
  if (!hasImageId) return { ok: false };
  let shows: FigureShow[] | null = null;
  if (hasShows) {
    const raw = f.shows;
    if (!Array.isArray(raw) || raw.length < SHOWS_MIN || raw.length > SHOWS_MAX) return { ok: false };
    shows = [];
    for (const x of raw) {
      if (!isPlainObj(x)) return { ok: false };
      const t = x.text;
      if (typeof t !== 'string' || t.trim() === '' || cpLen(t) > SHOW_TEXT_MAX) return { ok: false };
      const ids = x.source_ids;
      if (!Array.isArray(ids) || ids.length < 1 || ids.length > SHOW_SOURCE_IDS_MAX) return { ok: false };
      if (!ids.every((id) => typeof id === 'string' && cpLen(id) >= 1 && cpLen(id) <= SHOW_SOURCE_ID_MAX)) return { ok: false };
      if (new Set(ids).size !== ids.length) return { ok: false };
      shows.push({ text: t, source_ids: [...(ids as string[])] });
    }
  }
  let ref: string | null = null;
  if (hasRef) {
    const u = f.reference_url;
    // 文字どおり `https://` で始まる（前後の空白・`https:host` の形は弾く。確認画面のリンクの条件と同じ）
    if (typeof u !== 'string' || u !== u.trim() || !u.startsWith('https://') || cpLen(u) > REFERENCE_URL_MAX) return { ok: false };
    let parsed: URL;
    try {
      parsed = new URL(u);
    } catch {
      return { ok: false };
    }
    if (parsed.protocol !== 'https:' || !parsed.hostname) return { ok: false };
    ref = u;
  }
  return { ok: true, shows, reference_url: ref };
}

/** §O-13-3 1・§O-13-5: 図の絵の主張と参照（版の material.json の image_id のある行から） */
export interface FigureShowsMeta {
  shows: FigureShow[];
  reference_url: string | null;
}

/**
 * 版の material.json（parse 済み・信頼できない値）の files[] のうち、image_id があり shows か reference_url がある行の path → 絵の主張と参照。
 * 検証係の図の一覧と確認画面が使う（I/O なし）。形は取り込みが確かめた（checkImageShows）が、ここでも同じ検査を通らない行は飛ばす。path は最初の行だけ
 */
export function figureShowsMetaOf(material: unknown): Map<string, FigureShowsMeta> {
  const out = new Map<string, FigureShowsMeta>();
  if (!isPlainObj(material) || !Array.isArray(material.parts)) return out;
  const seen = new Set<string>();
  for (const part of material.parts) {
    if (!isPlainObj(part) || !Array.isArray(part.files)) continue;
    for (const f of part.files) {
      if (!isPlainObj(f) || typeof f.path !== 'string' || typeof f.image_id !== 'string' || seen.has(f.path)) continue;
      seen.add(f.path);
      const r = checkImageShows(f, true);
      if (!r.ok || (!r.shows && r.reference_url === null)) continue;
      out.set(f.path, { shows: r.shows ?? [], reference_url: r.reference_url });
    }
  }
  return out;
}

/** §O-13-2 2〜5: checks_json に入れる絵の主張の検査の結果（取り込みは止めない） */
export interface FigureShowsChecks {
  figure_shows_missing: string[];
  figure_shows_refs: Array<{ path: string; n: number; source_ids: string[] }>;
  figure_shows_no_primary: Array<{ path: string; n: number }>;
  figure_shows_removed: Array<{ path: string; texts: string[] }>;
}

/** 親の版の material.json（信頼できない値）から、image_id のある行の path → {image_id, texts}（最初の行だけ）。読めなければ null */
function parentShowsOf(materialJsonText: string): Map<string, { image_id: string; texts: string[] }> | null {
  let m: unknown;
  try {
    m = JSON.parse(materialJsonText);
  } catch {
    return null;
  }
  if (!isPlainObj(m)) return null;
  const out = new Map<string, { image_id: string; texts: string[] }>();
  for (const part of Array.isArray(m.parts) ? m.parts : []) {
    if (!isPlainObj(part) || !Array.isArray(part.files)) continue;
    for (const f of part.files) {
      if (!isPlainObj(f) || typeof f.path !== 'string' || typeof f.image_id !== 'string' || out.has(f.path)) continue;
      const texts = Array.isArray(f.shows)
        ? (f.shows as unknown[]).flatMap((x) => (isPlainObj(x) && typeof x.text === 'string' && x.text.trim() !== '' ? [x.text.trim()] : []))
        : [];
      out.set(f.path, { image_id: f.image_id, texts });
    }
  }
  return out;
}

/**
 * §O-13-2 2〜5（純関数。I/O は呼び出し側）: 取り込んだ素材の絵の主張を検査する。
 * - accuracyByImageId: image_requests の accuracy（scientific の画像が「対象画像」）
 * - primaryHosts: 一次とみなす発行主体（allowlist.json の primary_hosts）。sources.json の url の hostname を hostMatches で照らす（is_primary は使わない）
 * - parentMaterialJson: 作り直しの親の版の material_json（undefined / null = 比べない）。JSON として読めなければ比べず parentUnreadable
 * path は最初の行だけを見る（同じ path の重複した参照は、同じ image_id で絵の主張・参照も同じであることを validateOutputs が確かめている）
 */
export function checkFigureShows(
  material: Pick<Material, 'parts'>,
  sources: ReadonlyArray<Pick<Source, 'id' | 'url'>>,
  o: { accuracyByImageId: ReadonlyMap<string, string>; primaryHosts: readonly string[]; parentMaterialJson?: string | null },
): { checks: FigureShowsChecks; parentUnreadable: boolean } {
  const checks: FigureShowsChecks = { figure_shows_missing: [], figure_shows_refs: [], figure_shows_no_primary: [], figure_shows_removed: [] };
  const urlById = new Map<string, string>();
  for (const s of sources) if (!urlById.has(s.id)) urlById.set(s.id, s.url);
  const parent = typeof o.parentMaterialJson === 'string' ? parentShowsOf(o.parentMaterialJson) : null;
  const parentUnreadable = typeof o.parentMaterialJson === 'string' && parent === null;
  const seen = new Set<string>();
  for (const part of material.parts) {
    for (const f of part.files) {
      if (!f.image_id || seen.has(f.path)) continue;
      seen.add(f.path);
      const shows = f.shows ?? null;
      if (!shows && o.accuracyByImageId.get(f.image_id) === 'scientific') checks.figure_shows_missing.push(f.path);
      for (const [i, sh] of (shows ?? []).entries()) {
        const n = i + 1;
        const missing = sh.source_ids.filter((id) => !urlById.has(id));
        if (missing.length) checks.figure_shows_refs.push({ path: f.path, n, source_ids: missing });
        if (!sh.source_ids.some((id) => urlHostMatches(urlById.get(id), o.primaryHosts))) checks.figure_shows_no_primary.push({ path: f.path, n });
      }
      const prev = parent?.get(f.path);
      if (prev && prev.image_id === f.image_id) {
        const now = new Set((shows ?? []).map((x) => x.text.trim()));
        const removed = [...new Set(prev.texts)].filter((t) => !now.has(t));
        if (removed.length) checks.figure_shows_removed.push({ path: f.path, texts: removed });
      }
    }
  }
  return { checks, parentUnreadable };
}

/**
 * material.json の本文から image_id を持つ files[] を出現順に集める（取り込み・検証係の入力が使う。I/O なし）。
 * JSON が読めない・parts の形が違うものは黙って飛ばし（validateOutputs に落とさせる）、image_id の形が違えば bad_image_ref
 */
export function imageRefsOf(materialJsonText: string): { ok: true; refs: ImageRef[] } | { ok: false; detail: string } {
  let m: unknown;
  try {
    m = JSON.parse(materialJsonText);
  } catch {
    return { ok: true, refs: [] };
  }
  if (!isPlainObj(m) || !Array.isArray(m.parts)) return { ok: true, refs: [] };
  const refs: ImageRef[] = [];
  for (const part of m.parts) {
    if (!isPlainObj(part) || !Array.isArray(part.files)) continue;
    for (const f of part.files) {
      if (!isPlainObj(f) || typeof f.path !== 'string') continue;
      const r = checkImageRef(f);
      if (!r.ok) return r;
      if (r.ref) refs.push(r.ref);
    }
  }
  return { ok: true, refs };
}
/** §Q-1: parts[].videos[] の 1 本（YouTube の埋め込みで見る区間） */
export interface Video {
  id: string;
  youtube_id: string;
  title: string;
  channel: string;
  start_sec: number;
  end_sec: number;
  why: string;
  rights_note: string;
  source_id: string;
}

/** §Q-1 の形 */
export const VIDEO_ID_RE = /^v[0-9]{1,2}$/;
export const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;
/** 1 素材の動画の上限（4 本以上は too_many） */
export const MAX_VIDEOS = 3;
/** 区間の長さの上限（秒） */
export const VIDEO_MAX_RANGE_SEC = 600;
/** 出典の行の url はこの形と完全一致（クエリは v だけ） */
export const youtubeWatchUrl = (youtubeId: string): string => `https://www.youtube.com/watch?v=${youtubeId}`;

/** §AJ-1: parts[].models3d[] の 1 件（一覧 factory/models3d/catalog.json から選んだ立体モデル） */
export interface Model3d {
  id: string;
  catalog_id: string;
  why: string;
  source_id: string;
}

/** §AJ-1 の形 */
export const MODEL3D_ID_RE = /^d[0-9]{1,2}$/;
/** 1 素材の立体モデルの上限（4 件以上は too_many） */
export const MAX_MODELS3D = 3;

export interface Part {
  id: string;
  kind: number;
  title: string;
  entry_point: { type: (typeof ENTRY_TYPES)[number]; text: string };
  variants: Variant[];
  files: PartFile[];
  /** §Q-1: 任意。material.json の part に videos がある時だけ付く（無い素材は従来どおり） */
  videos?: Video[];
  /** §AJ-1: 任意。material.json の part に models3d がある時だけ付く（無い素材は従来どおり） */
  models3d?: Model3d[];
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

const textLenOk = (v: unknown, max: number): v is string => isStr(v) && [...v].length >= 1 && [...v].length <= max;
const isNonNegInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

/**
 * §Q-1: parts[].videos[] の検査（純関数）。parts は part id と videos の配列（無い part は null）を出現順に渡す。
 * sourceUrlById は sources.json の id → url。失敗は bad_video:{part_id}:{index}:{理由}（理由は
 * id / youtube_id / range / text / source / dup / too_many）。素材全体で 4 本以上なら 4 本目で too_many
 */
export function checkVideos(
  parts: Array<{ id: string; videos: unknown[] | null }>,
  sourceUrlById: ReadonlyMap<string, string>,
): { ok: true; byPart: Map<string, Video[]> } | { ok: false; detail: string } {
  const bad = (partId: string, index: number, reason: string) => ({ ok: false as const, detail: `bad_video:${partId}:${index}:${reason}` });
  const byPart = new Map<string, Video[]>();
  const seenIds = new Set<string>();
  const seenRanges = new Set<string>();
  let total = 0;
  for (const part of parts) {
    if (part.videos === null) continue;
    const out: Video[] = [];
    for (const [index, raw] of part.videos.entries()) {
      total++;
      if (total > MAX_VIDEOS) return bad(part.id, index, 'too_many');
      if (!isPlainObj(raw)) return bad(part.id, index, 'id');
      const v = raw;
      if (!isStr(v.id) || !VIDEO_ID_RE.test(v.id)) return bad(part.id, index, 'id');
      if (!isStr(v.youtube_id) || !YOUTUBE_ID_RE.test(v.youtube_id)) return bad(part.id, index, 'youtube_id');
      if (!textLenOk(v.title, 200) || !textLenOk(v.channel, 200) || !textLenOk(v.why, 300) || !textLenOk(v.rights_note, 300))
        return bad(part.id, index, 'text');
      if (!isNonNegInt(v.start_sec) || !isNonNegInt(v.end_sec) || v.start_sec >= v.end_sec || v.end_sec - v.start_sec > VIDEO_MAX_RANGE_SEC)
        return bad(part.id, index, 'range');
      const rangeKey = JSON.stringify([v.youtube_id, v.start_sec, v.end_sec]);
      if (seenIds.has(v.id) || seenRanges.has(rangeKey)) return bad(part.id, index, 'dup');
      seenIds.add(v.id);
      seenRanges.add(rangeKey);
      if (!isStr(v.source_id) || sourceUrlById.get(v.source_id) !== youtubeWatchUrl(v.youtube_id)) return bad(part.id, index, 'source');
      out.push({
        id: v.id,
        youtube_id: v.youtube_id,
        title: v.title,
        channel: v.channel,
        start_sec: v.start_sec,
        end_sec: v.end_sec,
        why: v.why,
        rights_note: v.rights_note,
        source_id: v.source_id,
      });
    }
    byPart.set(part.id, out);
  }
  return { ok: true, byPart };
}

/**
 * §AJ-1: parts[].models3d[] の検査（純関数。checkVideos と同じ形）。parts は part id と models3d の配列（無い part は null）を出現順に渡す。
 * sourceUrlById は sources.json の id → url。catalog は一覧の id → 項目（呼び出し側が MODELS3D から作る。テストでは小さな一覧を渡せる）。
 * 失敗は bad_model3d:{part_id}:{index}:{理由}（理由は id / catalog / text / source / dup / too_many）。素材全体で 4 件以上なら 4 件目で too_many
 */
export function checkModels3d(
  parts: Array<{ id: string; models3d: unknown[] | null }>,
  sourceUrlById: ReadonlyMap<string, string>,
  catalog: ReadonlyMap<string, Model3dEntry>,
): { ok: true; byPart: Map<string, Model3d[]> } | { ok: false; detail: string } {
  const bad = (partId: string, index: number, reason: string) => ({ ok: false as const, detail: `bad_model3d:${partId}:${index}:${reason}` });
  const byPart = new Map<string, Model3d[]>();
  const seenIds = new Set<string>();
  const seenCatalog = new Set<string>();
  let total = 0;
  for (const part of parts) {
    if (part.models3d === null) continue;
    const out: Model3d[] = [];
    for (const [index, raw] of part.models3d.entries()) {
      total++;
      if (total > MAX_MODELS3D) return bad(part.id, index, 'too_many');
      if (!isPlainObj(raw)) return bad(part.id, index, 'id');
      const d = raw;
      if (!isStr(d.id) || !MODEL3D_ID_RE.test(d.id)) return bad(part.id, index, 'id');
      // 一覧に無い id・kind が download（埋め込めない）の id は catalog（継承プロパティを踏まないよう Map で引く）
      const entry = isStr(d.catalog_id) ? catalog.get(d.catalog_id) : undefined;
      if (!entry || (entry.kind !== 'sketchfab' && entry.kind !== 'voyager')) return bad(part.id, index, 'catalog');
      if (!textLenOk(d.why, 300)) return bad(part.id, index, 'text');
      if (seenIds.has(d.id) || seenCatalog.has(entry.id)) return bad(part.id, index, 'dup');
      seenIds.add(d.id);
      seenCatalog.add(entry.id);
      if (!isStr(d.source_id) || sourceUrlById.get(d.source_id) !== entry.page_url) return bad(part.id, index, 'source');
      out.push({ id: d.id, catalog_id: entry.id, why: d.why, source_id: d.source_id });
    }
    byPart.set(part.id, out);
  }
  return { ok: true, byPart };
}

/** §AJ-1: validateOutputs が使う一覧（MODELS3D から 1 回だけ作る） */
let models3dCatalogMap: ReadonlyMap<string, Model3dEntry> | null = null;
const models3dCatalog = (): ReadonlyMap<string, Model3dEntry> => (models3dCatalogMap ??= new Map(MODELS3D.map((e) => [e.id, e])));

/** パーツ配下の参照パスか（parts/<part_id>/ 配下で .md/.svg/.html）。variants はこれだけ（§M-1） */
export function isPartPath(p: string, partId: string): boolean {
  if (!isSafeRelativePath(p)) return false;
  if (!p.startsWith(`parts/${partId}/`)) return false;
  const rest = p.slice(`parts/${partId}/`.length);
  if (rest.length === 0) return false;
  return PART_FILE_EXTENSIONS.some((ext) => p.endsWith(ext));
}

/** §M-1: parts[].files[].path 用。isPartPath に加えて .png / .webp を許す（variants は isPartPath のまま） */
export function isPartFilePath(p: string, partId: string): boolean {
  if (isPartPath(p, partId)) return true;
  if (!isSafeRelativePath(p) || !p.startsWith(`parts/${partId}/`)) return false;
  if (p.length === `parts/${partId}/`.length) return false;
  return PART_IMAGE_EXTENSIONS.some((ext) => p.endsWith(ext));
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const startsWithBytes = (b: Uint8Array, sig: number[], at = 0) => b.byteLength >= at + sig.length && sig.every((x, i) => b[at + i] === x);

/**
 * §M-2: 拡張子が .png / .webp のファイルは、実際の先頭バイトが形式と一致するか（拡張子だけを信用しない）。
 * .png = 89 50 4E 47 0D 0A 1A 0A、.webp = 先頭 4 バイト "RIFF" かつ 8〜11 バイト目 "WEBP"。それ以外の拡張子は対象外（true）
 */
export function imageBytesMatch(path: string, bytes: Uint8Array): boolean {
  if (path.endsWith('.png')) return startsWithBytes(bytes, PNG_MAGIC);
  if (path.endsWith('.webp')) return startsWithBytes(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWithBytes(bytes, [0x57, 0x45, 0x42, 0x50], 8);
  return true;
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
  /** §Q-1: videos は sources.json を読んだ後に検査する（出典の行との一致を見るため） */
  const rawVideos: Array<{ id: string; videos: unknown[] | null }> = [];
  /** §AJ-1: models3d も sources.json を読んだ後に検査する（出典の行の url と一覧の page_url を照らすため） */
  const rawModels3d: Array<{ id: string; models3d: unknown[] | null }> = [];
  /** §O-13-2 1: 素材全体の絵の主張の合計（同じ path は 1 回だけ数える） */
  let showsTotal = 0;
  /** §O-13-2 1: path → 1 行目の絵の主張・参照（JSON）。同じ path の 2 行目以降は 1 行目と同じでなければ弾く（後の行の主張が検査から漏れないように） */
  const showsByPath = new Map<string, string>();
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
        if (!isPartFilePath(f.path, p.id)) return fail(`path_outside_part:${f.path}`);
        const ref = checkImageRef(f);
        if (!ref.ok) return fail(ref.detail);
        // §O-13-2 1: 絵の主張・参照の形（bad_image_ref と同じく取り込みで弾く）。素材全体の合計は SHOWS_TOTAL_MAX まで
        const sh = checkImageShows(f, ref.ref !== null);
        if (!sh.ok) return fail(`bad_image_shows:${f.path}`);
        const shKey = JSON.stringify([sh.shows, sh.reference_url]);
        const prevSh = showsByPath.get(f.path);
        if (prevSh === undefined) {
          showsByPath.set(f.path, shKey);
          showsTotal += sh.shows?.length ?? 0;
          if (showsTotal > SHOWS_TOTAL_MAX) return fail(`bad_image_shows:${f.path}`);
        } else if (prevSh !== shKey) return fail(`bad_image_shows:${f.path}`);
        if (!files.has(f.path)) return fail(`missing_ref:${f.path}`);
        if (!imageBytesMatch(f.path, files.get(f.path)!)) return fail(`bad_image:${f.path}`);
        pfiles.push({
          path: f.path,
          role: isStr(f.role) ? f.role : 'file',
          ...(ref.ref ? { image_id: ref.ref.image_id, alt: ref.ref.alt } : {}),
          ...(sh.shows ? { shows: sh.shows } : {}),
          ...(sh.reference_url !== null ? { reference_url: sh.reference_url } : {}),
        });
      }
    }
    if (p.videos !== undefined && !Array.isArray(p.videos)) return fail(`bad_type:parts[${i}].videos`);
    rawVideos.push({ id: p.id, videos: Array.isArray(p.videos) ? (p.videos as unknown[]) : null });
    if (p.models3d !== undefined && !Array.isArray(p.models3d)) return fail(`bad_type:parts[${i}].models3d`);
    rawModels3d.push({ id: p.id, models3d: Array.isArray(p.models3d) ? (p.models3d as unknown[]) : null });
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

  // §Q-1: parts[].videos[]（出典の行の url と照らす）。videos のある part にだけ付ける
  const vc = checkVideos(rawVideos, new Map(sources.map((s) => [s.id, s.url])));
  if (!vc.ok) return fail(vc.detail);
  for (const part of parts) {
    const vs = vc.byPart.get(part.id);
    if (vs) part.videos = vs;
  }
  // §AJ-1: parts[].models3d[]（一覧の id と、出典の行の url = 一覧の page_url）。models3d のある part にだけ付ける
  const dc = checkModels3d(rawModels3d, new Map(sources.map((s) => [s.id, s.url])), models3dCatalog());
  if (!dc.ok) return fail(dc.detail);
  for (const part of parts) {
    const ds = dc.byPart.get(part.id);
    if (ds) part.models3d = ds;
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
