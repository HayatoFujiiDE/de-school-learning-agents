// 権利の門番（契約 §AK-1）: 権利の記録と、見せ方（複製して配る host / 提供元の埋め込み embed）を決める純関数と固定の表。
// I/O を持たない（D1・R2・fetch は rights-store.ts / rights-check.ts）。subjectSha256 だけは crypto.subtle を使うので async。
// 純関数の境界: rightsModes / rightsReasonOf / offerable* は「今の一覧の対象の指紋」を引数（または RightsGate.subjects）で受け取る。
// 指紋の計算（async）は呼び出し側（loadRightsGate・配信・確認）が先に済ませる。
// 一覧の license.code・license.label は見せ方の判断に使わない（code は機械が license.url から導く。AK-0 2）。

import { MODELS3D, type Model3dEntry } from './generated/models3d-catalog';
import type { HostedModel3d } from './models3d-file';

export type LicenseCode = 'cc0' | 'pdm' | 'cc-by' | 'cc-by-sa' | 'cc-by-nd' | 'cc-by-nc' | 'cc-by-nc-sa' | 'cc-by-nc-nd' | 'nasa-media' | 'unknown';
export type EvidenceKind = 'api' | 'statement' | 'cc-url' | 'human';
export type RightsStatus = 'verified' | 'stale' | 'mismatch' | 'unverified' | 'human';

export const LICENSE_CODES: readonly LicenseCode[] = ['cc0', 'pdm', 'cc-by', 'cc-by-sa', 'cc-by-nd', 'cc-by-nc', 'cc-by-nc-sa', 'cc-by-nc-nd', 'nasa-media', 'unknown'];
export const EVIDENCE_KINDS: readonly EvidenceKind[] = ['api', 'statement', 'cc-url', 'human'];
export const RIGHTS_STATUSES: readonly RightsStatus[] = ['verified', 'stale', 'mismatch', 'unverified', 'human'];

export interface RightsRecord {
  /** `models3d:<catalog_id>` */
  asset_key: string;
  /** 一覧の対象の指紋（subjectSha256(e)）。unverified の行は claim の時の指紋 */
  subject_sha256: string;
  license_code: LicenseCode;
  /** 正規化した url。unverified の行は '' */
  license_url: string;
  /** 表示する出典の書き方（一覧の値。1〜200 字） */
  attribution: string;
  /** unverified の行は台帳の種類 */
  evidence_kind: EvidenceKind;
  /** JSON 配列 [{ url, sha256?, ok, note? }]（≤ 2000 字。本文は入れない） */
  evidence_json: string;
  /** 形式や中身を変えたか（v1 は常に false） */
  modified: boolean;
  status: RightsStatus;
  /** 運営が止めた */
  blocked: boolean;
  /** 最後の失敗の理由（stale / mismatch / unverified の時） */
  fail_code: string | null;
  /** 最後に成功した確認（ISO。人の記録は一覧の checked_at）。無ければ null */
  checked_at: string | null;
  /** 最後に試した時刻（成否を問わない） */
  last_attempt_at: string;
  /** 'cron' | email */
  checked_by: string;
}

export type RightsModes = { host: boolean; embed: boolean };

export interface RightsGate {
  records: ReadonlyMap<string, RightsRecord | 'invalid'>;
  /** §AJ2 の「取り込み済み」（D1 models3d_files + R2 の object）。key は catalog_id */
  hosted: ReadonlyMap<string, HostedModel3d>;
  /** rights_hosted（確認のもとで取り込んだ sha）。key は asset_key */
  hostedShas: ReadonlyMap<string, ReadonlySet<string>>;
  /** 今の一覧の対象の指紋。key は asset_key（loadRightsGate が一覧の全件を計算する） */
  subjects: ReadonlyMap<string, string>;
}

export const assetKey = (kind: 'models3d', id: string): string => `${kind}:${id}`;

const hex = (buf: ArrayBuffer): string => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** sha256（hex 64 字・小文字）。文字列は UTF-8 で数える */
export async function sha256Hex(data: string | ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data);
  return hex(await crypto.subtle.digest('SHA-256', bytes));
}

/** AK-1: 一覧の対象の指紋（この順の JSON 配列の sha256） */
export function subjectSha256(e: Model3dEntry): Promise<string> {
  return sha256Hex(
    JSON.stringify([e.kind, e.page_url, e.embed_url, e.download_url, e.uploader, e.evidence_url, e.license.url, e.attribution, e.title_src, e.checked_at, e.checked_how]),
  );
}

/** 一覧の全件の指紋（key は asset_key） */
export async function subjectShasOf(catalog: readonly Model3dEntry[] = MODELS3D): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const e of catalog) out.set(assetKey('models3d', e.id), await subjectSha256(e));
  return out;
}

// ---------------------------------------------------------------------------
// ライセンスの url（正規化と、実在する組み合わせの有限集合）

const DEED_RE = /^(deed|legalcode)(\.[a-z]{2})?$/;

/**
 * 前後の空白を除く → URL で parse（できなければ null）→ http: を https: に → host と path を小文字に → query と fragment を落とす →
 * path の末尾の区分が deed / deed.<2 字> / legalcode / legalcode.<2 字> なら落とす → 末尾に / を 1 つ → https://<host><path>。
 * http / https 以外・利用者名やパスワード付きは null（判断: 権利の根拠になる url としては受けない）
 */
export function normalizeLicenseUrl(url: string): string | null {
  if (typeof url !== 'string') return null;
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username !== '' || u.password !== '') return null;
  const host = u.host.toLowerCase();
  if (!host) return null;
  const segs = u.pathname.toLowerCase().split('/');
  while (segs.length > 1 && segs[segs.length - 1] === '') segs.pop();
  if (segs.length > 1 && DEED_RE.test(segs[segs.length - 1])) segs.pop();
  return `https://${host}${segs.join('/')}/`;
}

const CC_ELEMENTS = ['by', 'by-sa', 'by-nd', 'by-nc', 'by-nc-sa', 'by-nc-nd'] as const;
const CC_VERSIONS = ['1.0', '2.0', '2.5', '3.0', '4.0'];
const CC_JP_VERSIONS = ['2.0', '2.1'];
export const NASA_MEDIA_URL = 'https://www.nasa.gov/nasa-brand-center/images-and-media/';

/** 正規化した url → code（実在する組み合わせだけ。新しい組み合わせは PR で足す） */
const LICENSE_URL_CODES: ReadonlyMap<string, LicenseCode> = (() => {
  const m = new Map<string, LicenseCode>();
  m.set('https://creativecommons.org/publicdomain/zero/1.0/', 'cc0');
  m.set('https://creativecommons.org/publicdomain/mark/1.0/', 'pdm');
  for (const el of CC_ELEMENTS) {
    const code = `cc-${el}` as LicenseCode;
    for (const v of CC_VERSIONS) m.set(`https://creativecommons.org/licenses/${el}/${v}/`, code);
    for (const v of CC_JP_VERSIONS) m.set(`https://creativecommons.org/licenses/${el}/${v}/jp/`, code);
  }
  m.set(NASA_MEDIA_URL, 'nasa-media');
  return m;
})();

/** 正規化した url に対して、実在する組み合わせの有限集合で code を引く。合わなければ unknown */
export function licenseCodeOfUrl(url: string): LicenseCode {
  const n = normalizeLicenseUrl(url);
  return (n !== null && LICENSE_URL_CODES.get(n)) || 'unknown';
}

/** 表示の名前（一覧の license.label は使わない）。版は url の [0-9].[0-9]、日本の移植は末尾に JP */
export function licenseLabelOf(code: LicenseCode, licenseUrl: string): string {
  const n = normalizeLicenseUrl(licenseUrl) ?? '';
  const ver = /[0-9]\.[0-9]/.exec(n)?.[0] ?? '';
  const v = ver ? ` ${ver}${n.endsWith('/jp/') ? ' JP' : ''}` : '';
  switch (code) {
    case 'cc0':
      return 'CC0 1.0';
    case 'pdm':
      return 'パブリックドメイン（PDM 1.0）';
    case 'cc-by':
      return `CC BY${v}`;
    case 'cc-by-sa':
      return `CC BY-SA${v}`;
    case 'cc-by-nd':
      return `CC BY-ND${v}`;
    case 'cc-by-nc':
      return `CC BY-NC${v}`;
    case 'cc-by-nc-sa':
      return `CC BY-NC-SA${v}`;
    case 'cc-by-nc-nd':
      return `CC BY-NC-ND${v}`;
    case 'nasa-media':
      return 'NASA の利用の決まり';
    default:
      return '不明';
  }
}

/** Unicode の空白（全角を含む）と括弧 ()（）[]［］ を全部除き、小文字にする（attribution と displayName の照合） */
export const squash = (s: string): string => s.replace(/[\s()（）[\]［］]/gu, '').toLowerCase();

// ---------------------------------------------------------------------------
// AK-1 の表（上から順に最初に当たった行）

const NO: RightsModes = { host: false, embed: false };
const NOT_OFFERED: ReadonlySet<LicenseCode> = new Set(['cc-by-nc', 'cc-by-nc-sa', 'cc-by-nc-nd', 'unknown']);
/** human / cc-url の embed を許す code */
const EMBED_OK: ReadonlySet<LicenseCode> = new Set(['cc0', 'pdm', 'cc-by', 'cc-by-sa', 'cc-by-nd']);

/** subjectSha は今の一覧の対象の指紋（subjectSha256(e)）。無ければ（undefined）指紋違いとして × × */
export function rightsModes(r: RightsRecord | 'invalid' | undefined, subjectSha: string | undefined): RightsModes {
  if (r === undefined || r === 'invalid') return NO;
  if (subjectSha === undefined || r.subject_sha256 !== subjectSha) return NO;
  if (r.blocked) return NO;
  if (r.status === 'unverified' || r.status === 'mismatch') return NO;
  if (NOT_OFFERED.has(r.license_code)) return NO;
  if (r.status === 'human') {
    if (r.evidence_kind !== 'human') return NO;
    return { host: false, embed: EMBED_OK.has(r.license_code) };
  }
  if (r.status === 'verified' || r.status === 'stale') {
    if (r.evidence_kind === 'cc-url') return { host: false, embed: EMBED_OK.has(r.license_code) };
    if (r.evidence_kind === 'api' || r.evidence_kind === 'statement') {
      if (r.license_code === 'pdm') return { host: false, embed: true };
      if (r.license_code === 'nasa-media') return { host: true, embed: false };
      if (r.license_code === 'cc0' || r.license_code === 'cc-by') return { host: true, embed: true };
      if (r.license_code === 'cc-by-sa' || r.license_code === 'cc-by-nd') return { host: !r.modified, embed: true };
    }
  }
  return NO;
}

export type RightsReason = 'ok' | 'no_record' | 'invalid' | 'subject_changed' | 'blocked' | 'unverified' | 'mismatch' | 'license';

/**
 * 確認画面と管理のページの理由（表の行に対応）。項目の kind で「その見せ方」が許されるかを見る（sketchfab / voyager は embed、download は host）。
 * status と evidence_kind の組み合わせが表に無い行は invalid。取り込み済みかどうか（hosted）は見ない
 */
export function rightsReasonOf(r: RightsRecord | 'invalid' | undefined, e: Model3dEntry, subjectSha: string | undefined): RightsReason {
  if (r === undefined) return 'no_record';
  if (r === 'invalid') return 'invalid';
  if (subjectSha === undefined || r.subject_sha256 !== subjectSha) return 'subject_changed';
  if (r.blocked) return 'blocked';
  if (r.status === 'unverified') return 'unverified';
  if (r.status === 'mismatch') return 'mismatch';
  if (NOT_OFFERED.has(r.license_code)) return 'license';
  const comboOk = (r.status === 'human' && r.evidence_kind === 'human') || ((r.status === 'verified' || r.status === 'stale') && r.evidence_kind !== 'human');
  if (!comboOk) return 'invalid';
  const m = rightsModes(r, subjectSha);
  return (e.kind === 'download' ? m.host : m.embed) ? 'ok' : 'license';
}

export interface OfferableModel3d {
  entry: Model3dEntry;
  record: RightsRecord;
  hosted: HostedModel3d | null;
}

/**
 * 門番を通った項目（一覧の順）。sketchfab / voyager は embed の時だけ。download は host かつ取り込み済み（gate.hosted）かつ
 * その sha が rights_hosted（gate.hostedShas）にある時だけ
 */
export function offerableModels3d(gate: RightsGate, catalog: readonly Model3dEntry[] = MODELS3D): OfferableModel3d[] {
  const out: OfferableModel3d[] = [];
  for (const e of catalog) {
    const key = assetKey('models3d', e.id);
    const record = gate.records.get(key);
    const modes = rightsModes(record, gate.subjects.get(key));
    if (record === undefined || record === 'invalid') continue;
    if (e.kind === 'sketchfab' || e.kind === 'voyager') {
      if (modes.embed) out.push({ entry: e, record, hosted: null });
      continue;
    }
    if (e.kind !== 'download' || !modes.host) continue;
    const h = gate.hosted.get(e.id);
    if (h && gate.hostedShas.get(key)?.has(h.sha256)) out.push({ entry: e, record, hosted: h });
  }
  return out;
}

/** offerableModels3d の entry を id で引く Map（checkModels3d に渡す） */
export function offerableCatalogMap(gate: RightsGate, catalog: readonly Model3dEntry[] = MODELS3D): ReadonlyMap<string, Model3dEntry> {
  return new Map(offerableModels3d(gate, catalog).map((o) => [o.entry.id, o.entry]));
}

// ---------------------------------------------------------------------------
// AK-2: 失敗の分類と遷移表

export type FailClass = 'transient' | 'mismatch';

/** 通信の失敗（transient）= fetch_failed:* / too_large / bad_response。それ以外は全部 対象の不一致（mismatch） */
export function failClass(failCode: string): FailClass {
  if (failCode.startsWith('fetch_failed:') || failCode === 'too_large' || failCode === 'bad_response') return 'transient';
  return 'mismatch';
}

export type CheckOutcomeClass = 'success' | FailClass;

/**
 * 遷移表（今の status × 結果 → 次の status）。行が無い（null）は claim で unverified を作った後と同じ。
 * human は機械の検査の対象外だが、台帳が変わって機械の検査を受けた時は「行が無い」と同じに扱う（判断）
 */
export function nextStatus(current: RightsStatus | null, outcome: CheckOutcomeClass): RightsStatus {
  if (outcome === 'success') return 'verified';
  switch (current) {
    case 'verified':
    case 'stale':
      return outcome === 'transient' ? 'stale' : 'mismatch';
    case 'mismatch':
      return 'mismatch';
    default:
      return 'unverified';
  }
}
