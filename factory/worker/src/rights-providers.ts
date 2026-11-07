// 権利の確かめ方の台帳（契約 §AK-2。コード定数）。一覧の項目から providerOf(e) で 1 件を選ぶ（page_url の host と path と kind で判定）。
// 当たらなければ unsupported（機械の検査も人の記録もしない = 記録が無いので、どの出口にも出ない）。新しい提供元は PR でここに足す。
// 外へ取りに行く url は一覧の静的な値（page_url / embed_url / download_url / evidence_url）とここの定数だけ。

import type { Model3dEntry } from './generated/models3d-catalog';
import type { EvidenceKind } from './rights';

export type CheckKind = 'api' | 'statement' | 'cc-url' | 'none';
export type ProviderId = 'sketchfab' | 'nasa-3d' | 'dbcls' | 'smithsonian';

export interface RightsProvider {
  id: ProviderId;
  /** 根拠の種類（none = 機械で確かめられない提供元。人の記録） */
  kind: CheckKind;
  match(e: Model3dEntry): boolean;
  note: string;
}

export interface UnsupportedProvider {
  id: 'unsupported';
  kind: 'unsupported';
  note: string;
}

const SKETCHFAB_EMBED_UID_RE = /^https:\/\/sketchfab\.com\/models\/([0-9a-f]{32})\/embed$/;
const SKETCHFAB_PAGE_PREFIX = 'https://sketchfab.com/3d-models/';
const SLUG_RE = /^[A-Za-z0-9-]*$/;

/** embed_url（https://sketchfab.com/models/<uid>/embed）の uid（32 桁）。形が違えば null */
export const sketchfabUidOf = (embedUrl: string | null): string | null => (embedUrl ? (SKETCHFAB_EMBED_UID_RE.exec(embedUrl)?.[1] ?? null) : null);

/** url が `^https://sketchfab\.com/3d-models/[A-Za-z0-9-]*<uid>$` の形か（正規表現を組み立てずに前後と間の文字クラスで見る） */
export function isSketchfabPageOf(url: unknown, uid: string): boolean {
  if (typeof url !== 'string' || !url.startsWith(SKETCHFAB_PAGE_PREFIX) || !url.endsWith(uid)) return false;
  const mid = url.slice(SKETCHFAB_PAGE_PREFIX.length, url.length - uid.length);
  return url.length >= SKETCHFAB_PAGE_PREFIX.length + uid.length && SLUG_RE.test(mid);
}

const parse = (u: string | null): URL | null => {
  if (!u) return null;
  try {
    const x = new URL(u);
    return x.protocol === 'https:' ? x : null;
  } catch {
    return null;
  }
};

/** 3D Resources のトップ（statement の hub）と利用の決まり（terms） */
export const NASA_HUB_URL = 'https://science.nasa.gov/3d-resources/';
export const NASA_TERMS_URL = 'https://www.nasa.gov/nasa-brand-center/images-and-media/';
export const SKETCHFAB_API_BASE = 'https://api.sketchfab.com/v3/models/';

export const RIGHTS_PROVIDERS: readonly RightsProvider[] = [
  {
    id: 'sketchfab',
    kind: 'api',
    match: (e) => {
      if (e.kind !== 'sketchfab') return false;
      const uid = sketchfabUidOf(e.embed_url);
      return uid !== null && isSketchfabPageOf(e.page_url, uid);
    },
    note: 'Sketchfab Data API v3 の license.url・投稿者・埋め込みの url を一覧と照らす',
  },
  {
    id: 'nasa-3d',
    kind: 'statement',
    match: (e) => {
      const u = parse(e.page_url);
      return !!u && u.host === 'science.nasa.gov' && u.pathname.startsWith('/3d-resources/') && e.kind === 'download' && e.download_url !== null;
    },
    note: 'NASA 3D Resources のページ（題名・Source の行・ファイルのリンク）と、トップと利用の決まりの文を照らす',
  },
  {
    id: 'dbcls',
    kind: 'cc-url',
    match: (e) => parse(e.page_url)?.host === 'dbarchive.biosciencedbc.jp',
    note: 'ページの CC の URL は、そのページが対象のファイルに掛かることを機械で確かめられないので、複製の根拠にはしない',
  },
  {
    id: 'smithsonian',
    kind: 'none',
    match: (e) => parse(e.page_url)?.host === '3d.si.edu' && e.kind === 'voyager',
    note: '提供元が自動取得を拒む（403）。記録のページの表示（CC0 の札）を人が確かめる',
  },
];

export const UNSUPPORTED_PROVIDER: UnsupportedProvider = { id: 'unsupported', kind: 'unsupported', note: '確かめ方が未登録（台帳に足す）' };

export function providerOf(e: Model3dEntry): RightsProvider | UnsupportedProvider {
  return RIGHTS_PROVIDERS.find((p) => p.match(e)) ?? UNSUPPORTED_PROVIDER;
}

/** 台帳の種類 → 記録の根拠の種類（none は human。unsupported は記録を作らないが、止める操作で行を作る時は human） */
export const evidenceKindOf = (p: RightsProvider | UnsupportedProvider): EvidenceKind =>
  p.kind === 'api' ? 'api' : p.kind === 'statement' ? 'statement' : p.kind === 'cc-url' ? 'cc-url' : 'human';
