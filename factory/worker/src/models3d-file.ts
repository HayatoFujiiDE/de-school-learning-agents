// 立体モデル v2（契約 §AJ2）: 運営が取り込んだ GLB の部品。形の検査（inspectGlb）・上限つきの読み取り（readCapped）・
// R2 の key と配信の url の形・取り込み済みの一覧（hostedModels3d。D1 の行 + R2 の object の存在）。
// R2 の key は検査済みの id と sha から固定の形で組む（DB の r2_key は信用しない）。ログに url や本文は出さない。

import { all, stmt } from './db';
import type { Env } from './env';

/** §AJ2-0: 1 件の上限（24 MiB）。超えるものは取り込めない */
export const MAX_MODEL3D_BYTES = 24 * 1024 * 1024;

/** 一覧の id の形（配信の url・route と同じ） */
export const MODEL3D_CATALOG_ID_RE = /^[a-z0-9-]{3,40}$/;
/** sha256（16 進 64 桁・小文字） */
export const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
/** §AJ2-1: 配信の url（相対。先頭 /）の形。確認画面（admin.js）にも同じ正規表現を書く */
export const MODEL3D_FILE_URL_RE = /^\/api\/library\/models3d\/files\/[a-z0-9-]{3,40}\/[0-9a-f]{64}\.glb$/;

/** §AJ2-1: R2 の key（models3d/<catalog_id>/<sha256>.glb） */
export const R2_KEY = (catalogId: string, sha: string): string => `models3d/${catalogId}/${sha}.glb`;
/** §AJ2-1: 配信の url（相対） */
export const fileUrlOf = (catalogId: string, sha: string): string => `/api/library/models3d/files/${catalogId}/${sha}.glb`;

// ---------------------------------------------------------------------------
// §AJ2-0: GLB の形の検査（純関数。glTF 2.0 の GLB の仕様どおりに読む）

export type GlbReason = 'magic' | 'version' | 'length' | 'chunk' | 'json' | 'asset' | 'external' | 'buffer' | 'extension';
export type GlbInspection = { ok: true; meshes: number; images: number; draco: boolean } | { ok: false; reason: GlbReason };

const GLB_MAGIC = 0x46546c67; // 'glTF'（little endian）
const CHUNK_JSON = 0x4e4f534a; // 'JSON'
const CHUNK_BIN = 0x004e4942; // 'BIN\0'
const ALLOWED_REQUIRED = new Set(['KHR_draco_mesh_compression', 'KHR_mesh_quantization', 'KHR_texture_transform', 'EXT_texture_webp']);
/** 復号器が要る拡張（optional でも model-viewer が KTX2 側を選ぶ経路がある） */
const NEEDS_DECODER = new Set(['KHR_texture_basisu', 'EXT_meshopt_compression']);
const IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);

const isPlainObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const has = (o: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** 返り値は最初に当たった理由 1 つ（magic → version → length → chunk → json → asset → external → buffer → extension の順） */
export function inspectGlb(bytes: ArrayBuffer): GlbInspection {
  const ng = (reason: GlbReason): GlbInspection => ({ ok: false, reason });
  const total = bytes.byteLength;
  if (total < 20) return ng('magic');
  const dv = new DataView(bytes);
  if (dv.getUint32(0, true) !== GLB_MAGIC) return ng('magic');
  if (dv.getUint32(4, true) !== 2) return ng('version');
  if (dv.getUint32(8, true) !== total) return ng('length');

  // chunk: 0 番目は JSON、1 番目（あれば）は BIN、3 つ以上は不可。長さは 4 の倍数でファイルの中に収まる
  const chunks: Array<{ type: number; start: number; length: number }> = [];
  let off = 12;
  while (off < total) {
    if (chunks.length >= 2) return ng('chunk');
    if (off + 8 > total) return ng('chunk');
    const length = dv.getUint32(off, true);
    const type = dv.getUint32(off + 4, true);
    const start = off + 8;
    if (start + length > total) return ng('chunk');
    if (length % 4 !== 0) return ng('chunk');
    if (chunks.length === 0 && type !== CHUNK_JSON) return ng('chunk');
    if (chunks.length === 1 && type !== CHUNK_BIN) return ng('chunk');
    chunks.push({ type, start, length });
    off = start + length;
  }
  if (chunks.length === 0) return ng('chunk');

  // json
  let doc: unknown;
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(new Uint8Array(bytes, chunks[0].start, chunks[0].length));
    doc = JSON.parse(text);
  } catch {
    return ng('json');
  }
  if (!isPlainObj(doc)) return ng('json');
  const d = doc;
  const arrayOf = (k: string): unknown[] | null | 'bad' => (!has(d, k) ? null : Array.isArray(d[k]) ? (d[k] as unknown[]) : 'bad');
  const buffers = arrayOf('buffers');
  const images = arrayOf('images');
  const required = arrayOf('extensionsRequired');
  const used = arrayOf('extensionsUsed');
  if (buffers === 'bad' || images === 'bad' || required === 'bad' || used === 'bad') return ng('json');
  if (buffers && !buffers.every(isPlainObj)) return ng('json');
  if (images && !images.every(isPlainObj)) return ng('json');
  if (required && !required.every((x) => typeof x === 'string')) return ng('json');
  if (used && !used.every((x) => typeof x === 'string')) return ng('json');

  // asset
  if (!isPlainObj(doc.asset) || doc.asset.version !== '2.0') return ng('asset');

  // external（自己完結でない・画像の形が違う）
  const bufs = (buffers ?? []) as Array<Record<string, unknown>>;
  const imgs = (images ?? []) as Array<Record<string, unknown>>;
  if (bufs.some((b) => has(b, 'uri'))) return ng('external');
  for (const im of imgs) {
    if (has(im, 'uri')) return ng('external');
    if (!has(im, 'bufferView') || im.bufferView === undefined) return ng('external');
    if (typeof im.mimeType !== 'string' || !IMAGE_MIME.has(im.mimeType)) return ng('external');
  }

  // buffer（埋め込みの 1 件と BIN chunk の整合。詰め物は 0〜3 byte）
  const bin = chunks.length === 2 ? chunks[1] : null;
  if (bufs.length >= 2) return ng('buffer');
  if (bufs.length === 1) {
    if (!bin) return ng('buffer');
    const bl = bufs[0].byteLength;
    if (typeof bl !== 'number' || !Number.isSafeInteger(bl) || bl < 0) return ng('buffer');
    const pad = bin.length - bl;
    if (pad < 0 || pad > 3) return ng('buffer');
  } else if (bin) return ng('buffer');

  // extension
  const req = (required ?? []) as string[];
  const all = [...req, ...((used ?? []) as string[])];
  if (req.some((x) => !ALLOWED_REQUIRED.has(x))) return ng('extension');
  if (all.some((x) => NEEDS_DECODER.has(x))) return ng('extension');

  return { ok: true, meshes: Array.isArray(doc.meshes) ? doc.meshes.length : 0, images: imgs.length, draco: all.includes('KHR_draco_mesh_compression') };
}

// ---------------------------------------------------------------------------
// §AJ2-2 3: 本文を stream で読みながら累計を数え、上限を超えた時点で cancel する（arrayBuffer() で全量を先に読まない）

export async function readCapped(body: ReadableStream<Uint8Array> | null, max: number): Promise<ArrayBuffer | 'too_large'> {
  if (!body) return new ArrayBuffer(0);
  const reader = body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return 'too_large';
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out.buffer;
}

// ---------------------------------------------------------------------------
// §AJ2-0・§AJ2-1: 取り込み済み = D1 models3d_files に行があり、かつ その行の sha の object が R2 にある

export interface HostedModel3d {
  sha256: string;
  bytes: number;
  draco: boolean;
  fetched_at: string;
}

interface FileRow {
  catalog_id: string;
  sha256: string;
  bytes: number;
  draco: number;
  fetched_at: string;
}

/** D1 の全行（形の違う行は除く。key は id と sha から組み立てる） */
export async function models3dFileRows(db: D1Database): Promise<FileRow[]> {
  const rows = await all<FileRow>(db, stmt('SELECT catalog_id, sha256, bytes, draco, fetched_at FROM models3d_files ORDER BY catalog_id'));
  return rows.filter((r) => typeof r.catalog_id === 'string' && MODEL3D_CATALOG_ID_RE.test(r.catalog_id) && typeof r.sha256 === 'string' && SHA256_HEX_RE.test(r.sha256));
}

/** D1 の行ごとに env.R2.head(key) で object を確かめ、ある行だけを返す（行は数件なので head は数回） */
export async function hostedModels3d(env: Pick<Env, 'DB' | 'R2'>): Promise<Map<string, HostedModel3d>> {
  const out = new Map<string, HostedModel3d>();
  for (const r of await models3dFileRows(env.DB)) {
    const obj = await env.R2.head(R2_KEY(r.catalog_id, r.sha256));
    if (!obj) continue;
    out.set(r.catalog_id, { sha256: r.sha256, bytes: Number(r.bytes), draco: Number(r.draco) === 1, fetched_at: String(r.fetched_at) });
  }
  return out;
}

/** 取り込み済みの id の集合（注文票・取り込み検査に渡す） */
export async function hostedModel3dIds(env: Pick<Env, 'DB' | 'R2'>): Promise<Set<string>> {
  return new Set((await hostedModels3d(env)).keys());
}
