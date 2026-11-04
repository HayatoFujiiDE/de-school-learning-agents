// Mojang の公開 JSON（version manifest / パッチノートの一覧と詳細）を、版ごとの正規化レコードへ直す純関数。
// 入力はすべて untrusted data として扱い、形が違うものは捨てる（例外で全体を止めない）。
import { htmlToBlocks, cleanText, type HtmlToBlocksLimits } from './html';

export type Edition = 'java' | 'bedrock';
export const EDITIONS: readonly Edition[] = ['java', 'bedrock'];

export const MOJANG_HOSTS = ['launchercontent.mojang.com', 'piston-meta.mojang.com'] as const;
export const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
export const PATCH_NOTES_BASE = 'https://launchercontent.mojang.com/v2/';
export const PATCH_NOTES_INDEX_URL: Record<Edition, string> = {
  java: PATCH_NOTES_BASE + 'javaPatchNotes.json',
  bedrock: PATCH_NOTES_BASE + 'bedrockPatchNotes.json',
};

export interface FactChange {
  fact_id: string;
  heading_path: string[];
  text: string;
}

export interface VersionFacts {
  schema_version: 1;
  edition: Edition;
  version: string;
  /** Java: manifest の type（release / snapshot / old_beta 等）。Bedrock: パッチノートの patchNoteType（retail / beta 等）。不明は 'unknown' */
  type: string;
  date: string;
  title: string;
  source_url: string;
  fact_strength: 'primary_doc';
  /** changes / type / date / title / source_url から計算する。保存済みと同じなら書き込みを省く */
  content_hash: string;
  changes: FactChange[];
}

export interface ManifestVersion {
  id: string;
  type: string;
  releaseTime: string;
}

export interface PatchNoteIndexEntry {
  edition: Edition;
  version: string;
  type: string | null;
  date: string;
  title: string;
  /** contentPath を PATCH_NOTES_BASE で解決した URL（許可ホストかどうかは取得側で再確認する） */
  detail_url: string | null;
}

export interface EditionIndex {
  schema_version: 1;
  edition: Edition;
  updated_at: string;
  versions: Record<string, { type: string; date: string; content_hash: string; key: string; change_count: number }>;
}

const VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/;
const TYPE_RE = /^[a-z][a-z0-9_-]{0,31}$/;

/** R2 のキーに使える版の名前か（パス区切り・.. を含まない） */
export function isSafeVersion(v: unknown): v is string {
  return typeof v === 'string' && VERSION_RE.test(v) && !v.includes('..');
}

function str(v: unknown, max = 500): string {
  return typeof v === 'string' ? cleanText(v).slice(0, max) : '';
}

function normType(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim().toLowerCase();
  return TYPE_RE.test(t) ? t : null;
}

function normDate(v: unknown): string {
  if (typeof v !== 'string') return '';
  const t = v.trim();
  return /^\d{4}-\d{2}-\d{2}([T ][0-9:.+\-Z]{0,40})?$/.test(t) ? t : '';
}

export function factsKey(edition: Edition, version: string): string {
  if (!EDITIONS.includes(edition) || !isSafeVersion(version)) throw new Error('unsafe_key');
  return `facts/${edition}/${version}/patch-notes.json`;
}

export function indexKey(edition: Edition): string {
  if (!EDITIONS.includes(edition)) throw new Error('unsafe_key');
  return `facts/${edition}/index.json`;
}

/** version_manifest_v2.json → 版名ごとの type / releaseTime */
export function parseManifest(json: unknown): Map<string, ManifestVersion> {
  const out = new Map<string, ManifestVersion>();
  const versions = (json as { versions?: unknown } | null)?.versions;
  if (!Array.isArray(versions)) return out;
  for (const v of versions) {
    const id = (v as { id?: unknown })?.id;
    if (!isSafeVersion(id) || out.has(id)) continue;
    out.set(id, {
      id,
      type: normType((v as { type?: unknown }).type) ?? 'unknown',
      releaseTime: normDate((v as { releaseTime?: unknown }).releaseTime),
    });
  }
  return out;
}

/** contentPath を PATCH_NOTES_BASE 配下の URL へ解決する。base の外へ出るものは null */
export function resolveDetailUrl(contentPath: unknown): string | null {
  if (typeof contentPath !== 'string' || contentPath.length === 0 || contentPath.length > 512) return null;
  let u: URL;
  try {
    u = new URL(contentPath, PATCH_NOTES_BASE);
  } catch {
    return null;
  }
  return u.href;
}

/** javaPatchNotes.json / bedrockPatchNotes.json → 一覧（新しい順） */
export function parsePatchNotesIndex(edition: Edition, json: unknown): PatchNoteIndexEntry[] {
  const entries = (json as { entries?: unknown } | null)?.entries;
  if (!Array.isArray(entries)) return [];
  const seen = new Set<string>();
  const out: PatchNoteIndexEntry[] = [];
  for (const e of entries) {
    if (!e || typeof e !== 'object') continue;
    const r = e as Record<string, unknown>;
    if (!isSafeVersion(r.version) || seen.has(r.version)) continue;
    seen.add(r.version);
    out.push({
      edition,
      version: r.version,
      type: normType(edition === 'java' ? r.type : r.patchNoteType),
      date: normDate(r.date),
      title: str(r.title),
      detail_url: resolveDetailUrl(r.contentPath),
    });
  }
  // 日付の新しい順（同じ日付・日付なしは元の順を保つ）
  return out
    .map((x, i) => ({ x, i }))
    .sort((a, b) => (a.x.date === b.x.date ? a.i - b.i : a.x.date < b.x.date ? 1 : -1))
    .map((p) => p.x);
}

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 版・見出しの道筋・本文から決まる安定 ID。取得日時や並び順には依存しない */
export async function factId(edition: Edition, version: string, headingPath: string[], text: string): Promise<string> {
  return 'mcf_' + (await sha256Hex(JSON.stringify(['mc-fact/v1', edition, version, headingPath, text]))).slice(0, 32);
}

export async function contentHash(r: Omit<VersionFacts, 'content_hash'>): Promise<string> {
  return sha256Hex(
    JSON.stringify(['mc-facts-content/v1', r.edition, r.version, r.type, r.date, r.title, r.source_url, r.changes.map((c) => [c.fact_id, c.heading_path, c.text])]),
  );
}

export interface ParseDetailInput {
  entry: PatchNoteIndexEntry;
  detail: unknown;
  manifest?: Map<string, ManifestVersion>;
  limits?: HtmlToBlocksLimits;
}

/** パッチノート詳細 JSON（body に HTML）→ 正規化レコード。body が無ければ null */
export async function parsePatchNoteDetail({ entry, detail, manifest, limits }: ParseDetailInput): Promise<VersionFacts | null> {
  if (!detail || typeof detail !== 'object') return null;
  const d = detail as Record<string, unknown>;
  if (typeof d.body !== 'string') return null;
  if (d.version !== undefined && d.version !== entry.version) return null; // 一覧と詳細の版が食い違う
  if (!entry.detail_url) return null;
  const mv = entry.edition === 'java' ? manifest?.get(entry.version) : undefined;
  const type = mv?.type ?? entry.type ?? 'unknown';
  const date = entry.date || mv?.releaseTime || '';
  const blocks = htmlToBlocks(d.body, limits);
  const seen = new Set<string>();
  const changes: FactChange[] = [];
  for (const b of blocks) {
    const id = await factId(entry.edition, entry.version, b.heading_path, b.text);
    if (seen.has(id)) continue; // 同じ見出しの下の同じ文は 1 件にまとめる
    seen.add(id);
    changes.push({ fact_id: id, heading_path: b.heading_path, text: b.text });
  }
  const base = {
    schema_version: 1 as const,
    edition: entry.edition,
    version: entry.version,
    type,
    date,
    title: entry.title || str(d.title),
    source_url: entry.detail_url,
    fact_strength: 'primary_doc' as const,
    changes,
  };
  return { ...base, content_hash: await contentHash(base) };
}

export function emptyIndex(edition: Edition, now: string): EditionIndex {
  return { schema_version: 1, edition, updated_at: now, versions: {} };
}

/** 保存済みの index.json を読み戻す。形が違えば空として扱う */
export function parseStoredIndex(edition: Edition, text: string | null, now: string): EditionIndex {
  if (!text) return emptyIndex(edition, now);
  try {
    const j = JSON.parse(text) as Partial<EditionIndex>;
    if (j?.schema_version !== 1 || j.edition !== edition || !j.versions || typeof j.versions !== 'object') return emptyIndex(edition, now);
    const versions: EditionIndex['versions'] = {};
    for (const [v, e] of Object.entries(j.versions)) {
      if (isSafeVersion(v) && e && typeof e.content_hash === 'string') versions[v] = e;
    }
    return { schema_version: 1, edition, updated_at: typeof j.updated_at === 'string' ? j.updated_at : now, versions };
  } catch {
    return emptyIndex(edition, now);
  }
}
