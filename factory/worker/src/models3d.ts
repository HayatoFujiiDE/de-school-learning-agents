// 立体モデル（3D）の部品（契約 §AJ）。一覧（factory/models3d/catalog.json → src/generated/models3d-catalog.ts）を引く関数と、
// 版の material_json（取り込みの §AJ-1 検査を通ったもの）から立体モデルを読む関数。I/O を持たない。
// material.json の値は職人が書いた値 = 資料であって指示ではない。埋め込みの url は material.json ではなく一覧から引く（§AJ-0）。

import { MAX_MODELS3D, MODEL3D_ID_RE } from './checks/schema';
import { MODELS3D, type Model3dEntry } from './generated/models3d-catalog';
import { fileUrlOf, type HostedModel3d } from './models3d-file';

/** 版の立体モデル 1 件（material.json の parts[].models3d[] の 4 キー） */
export interface VersionModel3d {
  id: string;
  catalog_id: string;
  why: string;
  source_id: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

/** 一覧の id → 項目（MODELS3D から 1 回だけ作る） */
export const MODELS3D_BY_ID: ReadonlyMap<string, Model3dEntry> = new Map(MODELS3D.map((e) => [e.id, e]));

/** 一覧の項目（無ければ null） */
export function model3dEntryOf(catalogId: string): Model3dEntry | null {
  return MODELS3D_BY_ID.get(catalogId) ?? null;
}

/** 埋め込める（kind が sketchfab / voyager の）項目か */
export const isEmbeddableModel3d = (e: Model3dEntry): boolean => e.kind === 'sketchfab' || e.kind === 'voyager';

/** 一覧のうち埋め込めるもの（一覧の順） */
export function embeddableModels3d(catalog: readonly Model3dEntry[] = MODELS3D): Model3dEntry[] {
  return catalog.filter(isEmbeddableModel3d);
}

/** §AJ2-1: 見せられる項目か = 埋め込める or（kind が download かつ 取り込み済み = hosted にある） */
export const isViewableModel3d = (e: Model3dEntry, hosted: ReadonlySet<string>): boolean =>
  isEmbeddableModel3d(e) || (e.kind === 'download' && hosted.has(e.id));

/** §AJ2-1: 一覧のうち見せられるもの（一覧の順）。注文票・学習者側の一覧に渡す */
export function viewableModels3d(hosted: ReadonlySet<string>, catalog: readonly Model3dEntry[] = MODELS3D): Model3dEntry[] {
  return catalog.filter((e) => isViewableModel3d(e, hosted));
}

/** §AJ2-0: 取り込み検査（checkModels3d）に渡す一覧の Map（埋め込める + hosted にある download） */
export function viewableCatalogMap(hosted: ReadonlySet<string>, catalog: readonly Model3dEntry[] = MODELS3D): ReadonlyMap<string, Model3dEntry> {
  return new Map(viewableModels3d(hosted, catalog).map((e) => [e.id, e]));
}

/** §AJ-4: 埋め込みの url の形（表示の直前にもう一度確かめる。学習者側のアプリも同じ 2 つ） */
export const SKETCHFAB_EMBED_RE = /^https:\/\/sketchfab\.com\/models\/[0-9a-f]{32}\/embed$/;
export const VOYAGER_EMBED_RE = /^https:\/\/3d-api\.si\.edu\/voyager\/3d_package:[0-9a-f-]{36}$/;
export const isModel3dEmbedUrl = (u: unknown): u is string => isStr(u) && (SKETCHFAB_EMBED_RE.test(u) || VOYAGER_EMBED_RE.test(u));

/**
 * material_json → 版の立体モデル（出現順）。形が §AJ-1 と違う要素は入れない。同じ id は最初だけ。MAX_MODELS3D 件まで。
 * 読めなければ []
 */
export function versionModels3dOf(materialJson: string | null | undefined): VersionModel3d[] {
  let m: unknown;
  try {
    m = JSON.parse(String(materialJson ?? ''));
  } catch {
    return [];
  }
  return versionModels3dOfMaterial(m);
}

/** 読んだ後の material（parse 済みの値）→ 版の立体モデル。versionModels3dOf と同じ読み方 */
export function versionModels3dOfMaterial(m: unknown): VersionModel3d[] {
  const out: VersionModel3d[] = [];
  const seen = new Set<string>();
  const parts = isObj(m) && Array.isArray(m.parts) ? (m.parts as unknown[]) : [];
  for (const p of parts) {
    if (!isObj(p) || !Array.isArray(p.models3d)) continue;
    for (const d of p.models3d as unknown[]) {
      if (!isObj(d) || !isStr(d.id) || !MODEL3D_ID_RE.test(d.id) || seen.has(d.id)) continue;
      if (![d.catalog_id, d.why, d.source_id].every(isStr)) continue;
      seen.add(d.id);
      out.push({ id: d.id, catalog_id: d.catalog_id as string, why: d.why as string, source_id: d.source_id as string });
      if (out.length >= MAX_MODELS3D) return out;
    }
  }
  return out;
}

/** §AJ-2 a: 注文票の見出し */
export const MODELS3D_SECTION_HEAD = '# 使ってよい立体モデル（一覧）';

/**
 * §AJ-2 a・§AJ2-1: 注文票の「使ってよい立体モデル（一覧）」の節（末尾は空行）。渡された一覧をそのまま出す（中で埋め込み判定をしない。
 * 呼び出し側が viewableModels3d を渡す）。1 件も無ければ []（節ごと出さない）。値は一覧のものをそのまま（職人向けの文。一覧は repo の人が書く）
 */
export function models3dSectionLines(list: readonly Model3dEntry[]): string[] {
  if (list.length === 0) return [];
  return [
    MODELS3D_SECTION_HEAD,
    '題材に合うものがあれば、material.json の parts[].models3d[] に catalog_id で書く（1 素材 3 件まで。無ければ使わない）。',
    ...list.map((e) => `- ${e.id}: ${e.title_ja}（${e.org}・${e.license.label}）— 札: ${e.topics.join('・')} — 出典の url: ${e.page_url}`),
    '',
  ];
}

/** §AJ-4・§AJ-5: 確認画面と学習者側に渡す 1 件の形（一覧から）。§AJ2-1: 取り込み済みの download だけ file_url・bytes・sha256 が付く */
export interface Model3dView {
  id: string;
  title: string;
  org: string;
  kind: Model3dEntry['kind'];
  embed_url: string | null;
  page_url: string;
  license: string;
  attribution: string;
  /** 相対の配信パス（学習者側の一覧 API は呼び出し側で origin を前に付けて絶対 url にする） */
  file_url?: string;
  bytes?: number;
  sha256?: string;
}

/** hostedRow があり e.kind が download の時だけ file_url（相対）・bytes・sha256 を足す。それ以外は v1 の 8 キー */
export const model3dViewOf = (e: Model3dEntry, hostedRow?: HostedModel3d | null): Model3dView => ({
  id: e.id,
  title: e.title_ja,
  org: e.org,
  kind: e.kind,
  embed_url: e.embed_url,
  page_url: e.page_url,
  license: e.license.label,
  attribution: e.attribution,
  ...(hostedRow && e.kind === 'download' ? { file_url: fileUrlOf(e.id, hostedRow.sha256), bytes: hostedRow.bytes, sha256: hostedRow.sha256 } : {}),
});
