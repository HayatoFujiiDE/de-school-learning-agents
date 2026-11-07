// テスト用（契約 §AK）: 権利の記録（rights_records）・取り込みの記録（rights_hosted）を node:sqlite の実 DB に入れる道具と、門番（RightsGate）の作り物。
import type { DatabaseSync } from 'node:sqlite';
import { MODELS3D, type Model3dEntry } from '../src/generated/models3d-catalog';
import { MODELS3D_BY_ID } from '../src/models3d';
import type { HostedModel3d } from '../src/models3d-file';
import { assetKey, licenseCodeOfUrl, normalizeLicenseUrl, subjectSha256, subjectShasOf, type EvidenceKind, type RightsGate, type RightsRecord } from '../src/rights';

export const AT = '2026-11-07T12:00:00.000Z';

/** 台帳どおりの根拠の種類（sketchfab = api・voyager = human・NASA = statement・DBCLS = cc-url） */
export const kindOf = (e: Model3dEntry): EvidenceKind =>
  e.kind === 'sketchfab' ? 'api' : e.kind === 'voyager' ? 'human' : e.page_url.startsWith('https://science.nasa.gov/') ? 'statement' : 'cc-url';

/** 確認が通った記録（今の指紋・台帳どおりの根拠・一覧の license.url から code）。over で上書き */
export async function goodRecord(e: Model3dEntry, over: Partial<RightsRecord> = {}): Promise<RightsRecord> {
  const kind = kindOf(e);
  return {
    asset_key: assetKey('models3d', e.id),
    subject_sha256: await subjectSha256(e),
    license_code: kind === 'statement' ? 'nasa-media' : licenseCodeOfUrl(e.license.url),
    license_url: normalizeLicenseUrl(e.license.url) ?? '',
    attribution: e.attribution,
    evidence_kind: kind,
    evidence_json: '[]',
    modified: false,
    status: kind === 'human' ? 'human' : 'verified',
    blocked: false,
    fail_code: null,
    checked_at: AT,
    last_attempt_at: AT,
    checked_by: 'cron',
    ...over,
  };
}

/** 記録を 1 行入れる（claim は既定で無し） */
export function insertRecord(db: DatabaseSync, r: RightsRecord, claim: { at?: string | null; token?: string | null } = {}): void {
  db.prepare(
    `INSERT INTO rights_records (asset_key, subject_sha256, license_code, license_url, attribution, evidence_kind, evidence_json, modified, status, blocked, fail_code, checked_at, last_attempt_at, checked_by, claim_at, claim_token)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    r.asset_key,
    r.subject_sha256,
    r.license_code,
    r.license_url,
    r.attribution,
    r.evidence_kind,
    r.evidence_json,
    r.modified ? 1 : 0,
    r.status,
    r.blocked ? 1 : 0,
    r.fail_code,
    r.checked_at,
    r.last_attempt_at,
    r.checked_by,
    claim.at ?? null,
    claim.token ?? null,
  );
}

/** 一覧の id の項目に、確認が通った記録を入れる */
export async function seedGood(db: DatabaseSync, id: string, over: Partial<RightsRecord> = {}): Promise<RightsRecord> {
  const e = MODELS3D_BY_ID.get(id);
  if (!e) throw new Error(`no catalog entry ${id}`);
  const r = await goodRecord(e, over);
  insertRecord(db, r);
  return r;
}

/** 一覧の全件に確認が通った記録を入れる（download の取り込みは入れない） */
export async function seedAllGood(db: DatabaseSync): Promise<void> {
  for (const e of MODELS3D) await seedGood(db, e.id);
}

/** rights_hosted（確認のもとで取り込んだ sha）を 1 行入れる */
export function seedHostedSha(db: DatabaseSync, id: string, sha: string, token = 'tok-test', at = AT): void {
  db.prepare('INSERT INTO rights_hosted (asset_key, sha256, verified_at, check_token) VALUES (?, ?, ?, ?)').run(assetKey('models3d', id), sha, at, token);
}

/** 門番の作り物（D1 を使わない純関数のテスト用）。records は catalog の id → 記録 */
export async function gateOf(
  o: { records?: Array<RightsRecord | ['invalid', string]>; hosted?: Array<[string, HostedModel3d]>; hostedShas?: Array<[string, string]>; catalog?: readonly Model3dEntry[] } = {},
): Promise<RightsGate> {
  const records = new Map<string, RightsRecord | 'invalid'>();
  for (const r of o.records ?? []) {
    if (Array.isArray(r)) records.set(assetKey('models3d', r[1]), 'invalid');
    else records.set(r.asset_key, r);
  }
  const hostedShas = new Map<string, Set<string>>();
  for (const [id, sha] of o.hostedShas ?? []) {
    const k = assetKey('models3d', id);
    hostedShas.set(k, (hostedShas.get(k) ?? new Set()).add(sha));
  }
  return { records, hosted: new Map(o.hosted ?? []), hostedShas, subjects: await subjectShasOf(o.catalog ?? MODELS3D) };
}

/** 一覧の全件に通った記録がある門番（download は取り込みが無いので出ない） */
export async function fullGate(o: { hosted?: Array<[string, HostedModel3d]>; hostedShas?: Array<[string, string]> } = {}): Promise<RightsGate> {
  const records: RightsRecord[] = [];
  for (const e of MODELS3D) records.push(await goodRecord(e));
  return gateOf({ records, ...o });
}

export const hostedRow = (sha: string, bytes = 10): HostedModel3d => ({ sha256: sha, bytes, draco: true, fetched_at: AT });

// ---------------------------------------------------------------------------------------------
// 提供元の作り物（fetch の stub・最小の GLB・NASA / DBCLS のページ）。§AK v3.1 の回帰テストが使う

export type Route = (init?: RequestInit) => Response | Promise<Response>;
export type Stub = typeof fetch & { calls: string[] };
/** url ごとの応答（無い url は 404）。呼ばれた url を順に記録する */
export function stubBy(routes: Record<string, Route>): Stub {
  const calls: string[] = [];
  const f = (async (u: RequestInfo | URL, init?: RequestInit) => {
    const url = String(u);
    calls.push(url);
    const r = routes[url];
    return r ? r(init) : new Response('not found', { status: 404 });
  }) as Stub;
  f.calls = calls;
  return f;
}
export const htmlRes = (s: string): Route => () => new Response(s, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
export const statusRes = (status: number, headers: Record<string, string> = {}): Route => () => new Response(status === 302 ? null : 'x', { status, headers });

/** JSON chunk だけの最小の GLB（inspectGlb が通る。tag で中身 = sha を変える） */
export function tinyGlb(tag = 'a'): ArrayBuffer {
  const json = new TextEncoder().encode(JSON.stringify({ asset: { version: '2.0', generator: tag }, meshes: [] }));
  const jl = json.length + ((4 - (json.length % 4)) % 4);
  const total = 20 + jl;
  const out = new Uint8Array(total).fill(0x20, 20);
  const dv = new DataView(out.buffer);
  out.set(new TextEncoder().encode('glTF'), 0);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jl, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.set(json, 20);
  return out.buffer;
}
export const glbRes = (b: ArrayBuffer): Route => () => new Response(b, { status: 200, headers: { 'content-type': 'model/gltf-binary' } });

export const NASA_HUB = 'https://science.nasa.gov/3d-resources/';
export const NASA_TERMS = 'https://www.nasa.gov/nasa-brand-center/images-and-media/';
export const HUB_HTML = '<html><body><h1>3D Resources</h1><p>All of these assets are free to download and use.</p></body></html>';
export const TERMS_HTML =
  '<html><body><h1>Images and Media</h1><p>NASA content - images, audio, video, and computer files used in the rendition of 3-dimensional models - generally are not subject to copyright in the United States. You may use this material for educational or informational purposes.</p></body></html>';

/** NASA のモデルのページ（実測の形）。head・h1 の区画・Details の後ろ・Downloads の中身・末尾を差し替えられる */
export interface NasaPageParts {
  head?: string;
  h1Block?: string;
  details?: string;
  downloads?: string;
  after?: string;
}
export const nasaPageOf = (e: Model3dEntry, o: NasaPageParts = {}) => `<!doctype html><html><head><title>NASA Science</title>${o.head ?? ''}</head><body>
<header><a href="/">NASA Science</a></header>
${o.h1Block ?? `<h1 class="page-title">${e.title_src}</h1>`}
<section><h2>Details</h2><dl><dt>Source</dt><dd>${e.attribution}</dd><dt>Mission</dt><dd>Mars 2020</dd></dl>${o.details ?? ''}</section>
<section><h2>Downloads</h2>${o.downloads ?? `<a href="${e.download_url}" download>GLB</a>`}</section>${o.after ?? ''}
</body></html>`;
/** NASA の 3 ページ（モデル・トップ・利用の決まり）と、extra の url の応答 */
export const nasaRoutesOf = (e: Model3dEntry, o: NasaPageParts = {}, extra: Record<string, Route> = {}): Record<string, Route> => ({
  [e.page_url]: htmlRes(nasaPageOf(e, o)),
  [NASA_HUB]: htmlRes(HUB_HTML),
  [NASA_TERMS]: htmlRes(TERMS_HTML),
  ...extra,
});
/** DBCLS の根拠のページ（body の中身をそのまま） */
export const dbclsPageOf = (body: string, title = 'BodyParts3D') => `<html><head><title>lic</title></head><body><h1>${title} のライセンス</h1><p>${title} はクリエイティブ・コモンズのライセンスで提供します。</p>${body}</body></html>`;

/** 1 回だけ待たせる門（stub の中で enter → 外から release） */
export function deferred() {
  let release!: () => void;
  let enter!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const entered = new Promise<void>((r) => (enter = r));
  return { gate, entered, release: () => release(), enter: () => enter() };
}
