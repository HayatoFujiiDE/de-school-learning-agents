// §AK 権利の門番（docs/plans/rights/contract-AK.md の AK-7）。fake・vitest。実物の提供元には繋がない（fetch は全部 stub）。
// 1 url の正規化と code / 2 指紋 / 3 rightsModes の全組み合わせ / 4 offerable・理由 / 5 sketchfab / 6 NASA / 7 DBCLS / 8 Smithsonian /
// 9 claim / 10 取り込み / 11 配信の出口 / 14 cron / 15 運営の API / 16 migration と不正な行 / AK-5 管理のページの rights。
// 12・13 は models3d-review-preview・models3d-schema・rework-from-previous、17 は models3d-catalog、18 は既存の models3d-* の更新。
import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/env';
import { MODELS3D, type Model3dEntry } from '../src/generated/models3d-catalog';
import type { RouteCtx } from '../src/http';
import worker from '../src/index';
import { MODELS3D_BY_ID } from '../src/models3d';
import { R2_KEY } from '../src/models3d-file';
import {
  assetKey,
  failClass,
  licenseCodeOfUrl,
  licenseLabelOf,
  nextStatus,
  normalizeLicenseUrl,
  offerableCatalogMap,
  offerableModels3d,
  rightsModes,
  rightsReasonOf,
  squash,
  subjectSha256,
  type EvidenceKind,
  type LicenseCode,
  type RightsModes,
  type RightsRecord,
  type RightsStatus,
} from '../src/rights';
import { checkCcUrl, checkNasa, checkSketchfab, runRightsCheck, stripComments, textOfHtml, type RightsCheckOutcome } from '../src/rights-check';
import { rightsCandidates, rightsStep, type RightsCronRow } from '../src/rights-cron';
import { providerOf, RIGHTS_PROVIDERS } from '../src/rights-providers';
import { lastRightsEvents, loadRightsGate, rightsRecordRows, setRightsBlocked } from '../src/rights-store';
import { listModels3d } from '../src/routes/models3d';
import { blockRights, checkRights } from '../src/routes/rights';
import { d1, migratedDb, one, rows } from './d1-shim';
import { AT, gateOf, goodRecord, hostedRow, insertRecord, seedGood, seedHostedSha } from './rights-helpers';

type Obj = Record<string, any>;
const exec = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
const shaHex = (b: ArrayBuffer | Uint8Array | string) => createHash('sha256').update(typeof b === 'string' ? b : b instanceof ArrayBuffer ? new Uint8Array(b) : b).digest('hex');

const ALLO = MODELS3D_BY_ID.get('omnh-allosaurus')!;
const KYU = MODELS3D_BY_ID.get('kyu-lotus')!;
const TRI = MODELS3D_BY_ID.get('si-triceratops')!;
const ROVER = MODELS3D_BY_ID.get('nasa-perseverance-rover')!;
const ISS = MODELS3D_BY_ID.get('nasa-iss')!;
const DBCLS = MODELS3D_BY_ID.get('dbcls-bodyparts3d')!;
const ALLO_UID = '900868a0aa0b47e58571f5f5ae20094c';
const ALLO_API = `https://api.sketchfab.com/v3/models/${ALLO_UID}`;
const NASA_HUB = 'https://science.nasa.gov/3d-resources/';
const NASA_TERMS = 'https://www.nasa.gov/nasa-brand-center/images-and-media/';
const OMNH_DISPLAY = '大阪市立自然史博物館　Osaka Museum of Natural History';

// ---------------------------------------------------------------------------------------------
// 道具: D1・R2 の作り物・url ごとの fetch の stub・最小の GLB

let db: DatabaseSync;
let r2: ReturnType<typeof r2Fake>;
let env: Env;
let logs: string[];

function r2Fake() {
  const store = new Map<string, Uint8Array>();
  const R2 = {
    async put(k: string, v: ArrayBuffer | Uint8Array) {
      store.set(k, new Uint8Array(v instanceof ArrayBuffer ? v.slice(0) : v.slice()));
      return { key: k };
    },
    async head(k: string) {
      const b = store.get(k);
      return b ? { key: k, size: b.byteLength } : null;
    },
    async get(k: string) {
      const b = store.get(k);
      return b ? { key: k, size: b.byteLength, body: b.slice() } : null;
    },
  };
  return { store, R2 };
}

beforeEach(() => {
  db = migratedDb();
  r2 = r2Fake();
  env = { DB: d1(db), R2: r2.R2 } as unknown as Env;
  logs = [];
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(' ')));
});
afterEach(() => {
  vi.restoreAllMocks();
});

type Route = (init?: RequestInit) => Response | Promise<Response>;
type Stub = typeof fetch & { calls: string[] };
/** url ごとの応答（無い url は 404）。呼ばれた url を順に記録する */
function stubBy(routes: Record<string, Route>): Stub {
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
const jsonRes = (o: unknown, status = 200): Route => () => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const htmlRes = (s: string): Route => () => new Response(s, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
const statusRes = (status: number, headers: Record<string, string> = {}): Route => () => new Response(status === 302 ? null : 'x', { status, headers });

/** JSON chunk だけの最小の GLB（inspectGlb が通る） */
function tinyGlb(tag = 'a'): ArrayBuffer {
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
const glbRes = (b: ArrayBuffer): Route => () => new Response(b, { status: 200, headers: { 'content-type': 'model/gltf-binary' } });

const routeCtx = (o: { service?: boolean } = {}): RouteCtx => {
  const request = new Request('http://localhost/api/rights/models3d/x/check', { method: 'POST' });
  return {
    env,
    request,
    url: new URL(request.url),
    email: 'ops@example.invalid',
    service: o.service === true,
    serviceName: o.service ? 'svc.access' : null,
    exec,
    port: async () => {
      throw new Error('port not used');
    },
  };
};
const recordRow = (e: Model3dEntry) => one(db, 'SELECT * FROM rights_records WHERE asset_key = ?', assetKey('models3d', e.id));
const checksOf = (e: Model3dEntry) => rows(db, 'SELECT * FROM rights_checks WHERE asset_key = ? ORDER BY id', assetKey('models3d', e.id));

// Sketchfab の API の応答（実測の形。license.url は http）
const sketchfabApi = (o: Obj = {}) => ({
  uid: ALLO_UID,
  user: o.user === null ? null : { username: 'OMNH', displayName: OMNH_DISPLAY, ...(o.user ?? {}) },
  embedUrl: ALLO.embed_url,
  viewerUrl: ALLO.page_url,
  license: { uri: 'https://api.sketchfab.com/v3/licenses/x', label: 'CC Attribution', fullName: 'Creative Commons Attribution', requirements: 'Author must be credited', url: 'http://creativecommons.org/licenses/by/4.0/', slug: 'cc-by' },
  ...Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'user')),
});

// NASA のページ（実測の形: h1 が 1 つ・本文の Details Source の直後が出典・download_url の href がそのまま）
type NasaOpts = { h1?: string; extraH1?: boolean; source?: string | null; details?: string; href?: 'yes' | 'no' | 'text' | 'comment'; after?: string };
const nasaPage = (e: Model3dEntry = ROVER, o: NasaOpts = {}) => {
  const href =
    o.href === 'no' ? '<a href="/other.glb">GLB</a>' : o.href === 'text' ? `<p>${e.download_url}</p>` : o.href === 'comment' ? `<!-- <a href="${e.download_url}">GLB</a> -->` : `<a href="${e.download_url}" download>GLB</a>`;
  return `<!doctype html><html><head><title>NASA Science</title><style>h2 { color: red }</style><script>window.dataLayer = [];</script></head><body>
<header><a href="/">NASA Science</a></header>
<h1 class="page-title">${o.h1 ?? e.title_src}</h1>${o.extraH1 ? '<h1>Another title</h1>' : ''}
<section>${o.source === null ? '<h2>Info</h2>' : '<h2>Details</h2>'}<dl><dt>Source</dt><dd>${o.source ?? e.attribution}</dd><dt>Mission</dt><dd>Mars 2020</dd></dl>${o.details ?? ''}</section>
<section><h2>Downloads</h2>${href}</section>${o.after ?? ''}
</body></html>`;
};
const HUB_HTML = '<html><body><h1>3D Resources</h1><p>All of these assets are free to download and use.</p></body></html>';
const TERMS_HTML =
  '<html><body><h1>Images and Media</h1><p>NASA content - images, audio, video, and computer files used in the rendition of 3-dimensional models - generally are not subject to copyright in the United States. You may use this material for educational or informational purposes.</p></body></html>';
const nasaRoutes = (e: Model3dEntry = ROVER, o: NasaOpts = {}, extra: Record<string, Route> = {}) => ({ [e.page_url]: htmlRes(nasaPage(e, o)), [NASA_HUB]: htmlRes(HUB_HTML), [NASA_TERMS]: htmlRes(TERMS_HTML), ...extra });

// DBCLS の根拠のページ（実測: CC の URL が deed.ja と legalcode.ja の 2 つ）
const dbclsPage = (links: string[], title = 'BodyParts3D') =>
  `<html><body><h1>${title} のライセンス</h1><p>${title} はクリエイティブ・コモンズ 表示4.0 国際 ライセンスで提供します。</p>${links.map((u) => `<a href="${u}">${u}</a>`).join(' ')}</body></html>`;
const DBCLS_LINKS = ['https://creativecommons.org/licenses/by/4.0/deed.ja', 'https://creativecommons.org/licenses/by/4.0/legalcode.ja'];

// ---------------------------------------------------------------------------------------------

describe('AK-7 1 normalizeLicenseUrl / licenseCodeOfUrl / licenseLabelOf', () => {
  const BY4 = 'https://creativecommons.org/licenses/by/4.0/';
  it.each<[string, string | null, LicenseCode]>([
    ['http://creativecommons.org/licenses/by/4.0/', BY4, 'cc-by'],
    ['https://creativecommons.org/licenses/by/4.0/deed.ja', BY4, 'cc-by'],
    ['https://creativecommons.org/licenses/by/4.0/legalcode.ja', BY4, 'cc-by'],
    ['https://creativecommons.org/licenses/by/4.0/legalcode', BY4, 'cc-by'],
    ['https://creativecommons.org/licenses/by/4.0', BY4, 'cc-by'],
    ['HTTPS://CreativeCommons.org/Licenses/BY/4.0/', BY4, 'cc-by'],
    ['https://creativecommons.org/licenses/by/4.0/?ref=chooser#x', BY4, 'cc-by'],
    ['  https://creativecommons.org/licenses/by-sa/3.0/deed.en  ', 'https://creativecommons.org/licenses/by-sa/3.0/', 'cc-by-sa'],
    ['https://creativecommons.org/licenses/by/2.1/jp/', 'https://creativecommons.org/licenses/by/2.1/jp/', 'cc-by'],
    ['https://creativecommons.org/licenses/by/2.0/jp/deed.ja', 'https://creativecommons.org/licenses/by/2.0/jp/', 'cc-by'],
    ['https://creativecommons.org/licenses/by-nc-nd/2.1/jp/', 'https://creativecommons.org/licenses/by-nc-nd/2.1/jp/', 'cc-by-nc-nd'],
    ['https://creativecommons.org/licenses/by/2.1/', 'https://creativecommons.org/licenses/by/2.1/', 'unknown'],
    ['https://creativecommons.org/licenses/by/4.0/jp/', 'https://creativecommons.org/licenses/by/4.0/jp/', 'unknown'],
    ['https://creativecommons.org/licenses/by/1.0/zz/', 'https://creativecommons.org/licenses/by/1.0/zz/', 'unknown'],
    ['https://creativecommons.org/licenses/by/9.9/', 'https://creativecommons.org/licenses/by/9.9/', 'unknown'],
    ['https://creativecommons.org/licenses/by-nc/4.0/', 'https://creativecommons.org/licenses/by-nc/4.0/', 'cc-by-nc'],
    ['https://creativecommons.org/licenses/by-nc-sa/2.5/', 'https://creativecommons.org/licenses/by-nc-sa/2.5/', 'cc-by-nc-sa'],
    ['https://creativecommons.org/licenses/by-nd/1.0/', 'https://creativecommons.org/licenses/by-nd/1.0/', 'cc-by-nd'],
    ['http://creativecommons.org/publicdomain/zero/1.0/', 'https://creativecommons.org/publicdomain/zero/1.0/', 'cc0'],
    ['https://creativecommons.org/publicdomain/zero/1.0/legalcode', 'https://creativecommons.org/publicdomain/zero/1.0/', 'cc0'],
    ['https://creativecommons.org/publicdomain/mark/1.0/', 'https://creativecommons.org/publicdomain/mark/1.0/', 'pdm'],
    ['https://www.nasa.gov/nasa-brand-center/images-and-media/', NASA_TERMS, 'nasa-media'],
    ['https://www.nasa.gov/nasa-brand-center/images-and-media', NASA_TERMS, 'nasa-media'],
    ['https://example.org/license/', 'https://example.org/license/', 'unknown'],
    ['https://creativecommons.org:8443/licenses/by/4.0/', 'https://creativecommons.org:8443/licenses/by/4.0/', 'unknown'],
    ['not a url', null, 'unknown'],
    ['', null, 'unknown'],
    ['ftp://creativecommons.org/licenses/by/4.0/', null, 'unknown'],
    ['https://user:pw@creativecommons.org/licenses/by/4.0/', null, 'unknown'],
  ])('%s → %s・%s', (url, norm, code) => {
    expect(normalizeLicenseUrl(url)).toBe(norm);
    expect(licenseCodeOfUrl(url)).toBe(code);
  });

  it('licenseLabelOf: 版は url から・日本の移植は JP・一覧の label は使わない', () => {
    expect(licenseLabelOf('cc0', 'https://creativecommons.org/publicdomain/zero/1.0/')).toBe('CC0 1.0');
    expect(licenseLabelOf('pdm', 'https://creativecommons.org/publicdomain/mark/1.0/')).toBe('パブリックドメイン（PDM 1.0）');
    expect(licenseLabelOf('cc-by', BY4)).toBe('CC BY 4.0');
    expect(licenseLabelOf('cc-by', 'https://creativecommons.org/licenses/by/2.1/jp/')).toBe('CC BY 2.1 JP');
    expect(licenseLabelOf('cc-by-sa', 'https://creativecommons.org/licenses/by-sa/3.0/')).toBe('CC BY-SA 3.0');
    expect(licenseLabelOf('cc-by-nd', 'https://creativecommons.org/licenses/by-nd/4.0/')).toBe('CC BY-ND 4.0');
    expect(licenseLabelOf('cc-by-nc', 'https://creativecommons.org/licenses/by-nc/4.0/')).toBe('CC BY-NC 4.0');
    expect(licenseLabelOf('cc-by-nc-sa', 'https://creativecommons.org/licenses/by-nc-sa/2.0/jp/')).toBe('CC BY-NC-SA 2.0 JP');
    expect(licenseLabelOf('cc-by-nc-nd', 'https://creativecommons.org/licenses/by-nc-nd/4.0/')).toBe('CC BY-NC-ND 4.0');
    expect(licenseLabelOf('nasa-media', NASA_TERMS)).toBe('NASA の利用の決まり');
    expect(licenseLabelOf('unknown', '')).toBe('不明');
    expect(licenseLabelOf('cc-by', '')).toBe('CC BY');
  });

  it('squash: Unicode の空白（全角を含む）と括弧を除いて小文字に（OMNH の実測の組は「含む」で一致）', () => {
    expect(squash(' A（B）[c]［D］(e)　f\tG ')).toBe('abcdefg');
    expect(squash(ALLO.attribution).includes(squash(OMNH_DISPLAY))).toBe(true);
    expect(squash(KYU.attribution).includes(squash('ffish.asia / floraZia.com'))).toBe(true);
  });
});

describe('AK-7 2 subjectSha256（一覧の対象の指紋）', () => {
  const FIXED = {
    id: 'fixed-model',
    title_ja: '固定',
    title_src: 'Fixed Model',
    org: '固定の博物館',
    kind: 'sketchfab',
    page_url: 'https://sketchfab.com/3d-models/fixed-0123456789abcdef0123456789abcdef',
    embed_url: 'https://sketchfab.com/models/0123456789abcdef0123456789abcdef/embed',
    download_url: null,
    uploader: 'FixedUser',
    evidence_url: null,
    license: { code: 'cc-by', label: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' },
    attribution: '固定の博物館（Fixed Museum）',
    topics: ['固定'],
    checked_at: '2026-11-07',
    checked_how: '固定の確かめ方',
  } as Model3dEntry;

  it('固定の項目で固定の hex と一致する（この順の JSON 配列の sha256）', async () => {
    expect(await subjectSha256(FIXED)).toBe('af2ad470b8082cca8d69f177f3ed3fb62c67447cf9caa13d7bb6edc6c67028f1');
    const j = JSON.stringify([FIXED.kind, FIXED.page_url, FIXED.embed_url, FIXED.download_url, FIXED.uploader, FIXED.evidence_url, FIXED.license.url, FIXED.attribution, FIXED.title_src, FIXED.checked_at, FIXED.checked_how]);
    expect(await subjectSha256(FIXED)).toBe(shaHex(j));
  });

  it('page_url を 1 字・checked_how を変えると変わる。topics・title_ja・license.code / label を変えても変わらない', async () => {
    const base = await subjectSha256(FIXED);
    expect(await subjectSha256({ ...FIXED, page_url: FIXED.page_url.slice(0, -1) + 'e' })).not.toBe(base);
    expect(await subjectSha256({ ...FIXED, checked_how: '別の確かめ方' })).not.toBe(base);
    expect(await subjectSha256({ ...FIXED, uploader: 'Other' })).not.toBe(base);
    expect(await subjectSha256({ ...FIXED, topics: ['別'] })).toBe(base);
    expect(await subjectSha256({ ...FIXED, title_ja: '別の題' })).toBe(base);
    expect(await subjectSha256({ ...FIXED, license: { ...FIXED.license, code: 'cc0', label: 'x' } })).toBe(base);
  });
});

// ---------------------------------------------------------------------------------------------
// AK-7 3: rightsModes の全組み合わせ。期待値はテストの中に写した AK-1 の表（上から順・最初に当たった行）から作る

const CODES: LicenseCode[] = ['cc0', 'pdm', 'cc-by', 'cc-by-sa', 'cc-by-nd', 'cc-by-nc', 'cc-by-nc-sa', 'cc-by-nc-nd', 'nasa-media', 'unknown'];
const KINDS: EvidenceKind[] = ['api', 'statement', 'cc-url', 'human'];
const STATUSES: RightsStatus[] = ['verified', 'stale', 'mismatch', 'unverified', 'human'];
const NO: RightsModes = { host: false, embed: false };
const EMBED_CODES = ['cc0', 'pdm', 'cc-by', 'cc-by-sa', 'cc-by-nd'];

type Row = { when: (r: RightsRecord | 'invalid' | undefined, match: boolean) => boolean; then: (r: RightsRecord) => RightsModes };
const asRec = (r: RightsRecord | 'invalid' | undefined) => r as RightsRecord;
/** AK-1 の表（行の順のまま） */
const TABLE: Row[] = [
  { when: (r) => r === undefined || r === 'invalid', then: () => NO },
  { when: (_r, match) => !match, then: () => NO },
  { when: (r) => asRec(r).blocked, then: () => NO },
  { when: (r) => ['unverified', 'mismatch'].includes(asRec(r).status), then: () => NO },
  { when: (r) => ['cc-by-nc', 'cc-by-nc-sa', 'cc-by-nc-nd', 'unknown'].includes(asRec(r).license_code), then: () => NO },
  { when: (r) => asRec(r).status === 'human', then: (r) => (r.evidence_kind !== 'human' ? NO : { host: false, embed: EMBED_CODES.includes(r.license_code) }) },
  { when: (r) => ['verified', 'stale'].includes(asRec(r).status) && asRec(r).evidence_kind === 'cc-url', then: (r) => ({ host: false, embed: EMBED_CODES.includes(r.license_code) }) },
  { when: (r) => ['verified', 'stale'].includes(asRec(r).status) && ['api', 'statement'].includes(asRec(r).evidence_kind) && asRec(r).license_code === 'pdm', then: () => ({ host: false, embed: true }) },
  { when: (r) => ['verified', 'stale'].includes(asRec(r).status) && ['api', 'statement'].includes(asRec(r).evidence_kind) && asRec(r).license_code === 'nasa-media', then: () => ({ host: true, embed: false }) },
  { when: (r) => ['verified', 'stale'].includes(asRec(r).status) && ['api', 'statement'].includes(asRec(r).evidence_kind) && ['cc0', 'cc-by'].includes(asRec(r).license_code), then: () => ({ host: true, embed: true }) },
  {
    when: (r) => ['verified', 'stale'].includes(asRec(r).status) && ['api', 'statement'].includes(asRec(r).evidence_kind) && ['cc-by-sa', 'cc-by-nd'].includes(asRec(r).license_code),
    then: (r) => ({ host: !r.modified, embed: true }),
  },
  { when: () => true, then: () => NO },
];
const expectedModes = (r: RightsRecord | 'invalid' | undefined, match: boolean): RightsModes => {
  for (const row of TABLE) if (row.when(r, match)) return row.then(asRec(r));
  return NO;
};

describe('AK-7 3 rightsModes（固定の表）', () => {
  const SUBJ = 'a'.repeat(64);
  const rec = (o: Partial<RightsRecord>): RightsRecord => ({
    asset_key: 'models3d:x', subject_sha256: SUBJ, license_code: 'cc-by', license_url: '', attribution: 'x', evidence_kind: 'api', evidence_json: '[]', modified: false,
    status: 'verified', blocked: false, fail_code: null, checked_at: AT, last_attempt_at: AT, checked_by: 'cron', ...o,
  });

  it('全組み合わせ（undefined / invalid + 指紋の一致 2 × code 10 × 根拠 4 × status 5 × blocked 2 × modified 2 = 1602 通り）が表どおり', () => {
    let n = 0;
    for (const r of [undefined, 'invalid' as const]) {
      expect(rightsModes(r, SUBJ)).toEqual(expectedModes(r, true));
      n++;
    }
    for (const match of [true, false])
      for (const license_code of CODES)
        for (const evidence_kind of KINDS)
          for (const status of STATUSES)
            for (const blocked of [false, true])
              for (const modified of [false, true]) {
                const r = rec({ license_code, evidence_kind, status, blocked, modified });
                const got = rightsModes(r, match ? SUBJ : 'b'.repeat(64));
                expect(got, JSON.stringify({ match, license_code, evidence_kind, status, blocked, modified })).toEqual(expectedModes(r, match));
                n++;
              }
    expect(n).toBe(1602);
  });

  it.each<[string, Partial<RightsRecord>, RightsModes]>([
    ['human × nasa-media は × ×', { status: 'human', evidence_kind: 'human', license_code: 'nasa-media' }, NO],
    ['human × cc0 は embed だけ', { status: 'human', evidence_kind: 'human', license_code: 'cc0' }, { host: false, embed: true }],
    ['status human でも根拠が api なら × ×', { status: 'human', evidence_kind: 'api', license_code: 'cc0' }, NO],
    ['cc-url × cc-by は embed だけ', { evidence_kind: 'cc-url', license_code: 'cc-by' }, { host: false, embed: true }],
    ['cc-url × nasa-media は × ×', { evidence_kind: 'cc-url', license_code: 'nasa-media' }, NO],
    ['api × pdm は host ×', { license_code: 'pdm' }, { host: false, embed: true }],
    ['statement × nasa-media は host だけ', { evidence_kind: 'statement', license_code: 'nasa-media' }, { host: true, embed: false }],
    ['api × cc-by は両方', { license_code: 'cc-by' }, { host: true, embed: true }],
    ['modified の BY-SA は host ×', { license_code: 'cc-by-sa', modified: true }, { host: false, embed: true }],
    ['stale の cc0 は両方（見せ方を下げない）', { status: 'stale', license_code: 'cc0' }, { host: true, embed: true }],
    ['verified でも根拠が human なら × ×', { status: 'verified', evidence_kind: 'human', license_code: 'cc0' }, NO],
    ['NC は embed も ×', { license_code: 'cc-by-nc' }, NO],
  ])('%s', (_n, o, want) => {
    expect(rightsModes(rec(o), SUBJ)).toEqual(want);
  });

  it('指紋違いは全部 × ×（指紋が無い = undefined も）', () => {
    for (const license_code of CODES) for (const status of STATUSES) expect(rightsModes(rec({ license_code, status }), 'c'.repeat(64))).toEqual(NO);
    expect(rightsModes(rec({}), undefined)).toEqual(NO);
  });
});

describe('AK-7 4 offerableModels3d / offerableCatalogMap / rightsReasonOf', () => {
  const SHA = '7'.repeat(64);
  const ids = (list: Array<{ entry: Model3dEntry }>) => list.map((o) => o.entry.id);

  it('行が無い項目は kind を問わず出ない（no_record）', async () => {
    const g = await gateOf();
    expect(offerableModels3d(g)).toEqual([]);
    for (const e of [ALLO, TRI, ROVER]) expect(rightsReasonOf(undefined, e, g.subjects.get(assetKey('models3d', e.id)))).toBe('no_record');
  });

  it('invalid は出ない・指紋違いは出ない（subject_changed）', async () => {
    const g = await gateOf({ records: [['invalid', ALLO.id], await goodRecord(KYU, { subject_sha256: '0'.repeat(64) })] });
    expect(offerableModels3d(g)).toEqual([]);
    expect(rightsReasonOf('invalid', ALLO, g.subjects.get(assetKey('models3d', ALLO.id)))).toBe('invalid');
    expect(rightsReasonOf(g.records.get(assetKey('models3d', KYU.id)), KYU, g.subjects.get(assetKey('models3d', KYU.id)))).toBe('subject_changed');
  });

  it('sketchfab の verified（api・cc-by）と human（cc0）の voyager は出る。理由は ok', async () => {
    const g = await gateOf({ records: [await goodRecord(ALLO), await goodRecord(TRI)] });
    expect(ids(offerableModels3d(g))).toEqual([TRI.id, ALLO.id]);
    expect([...offerableCatalogMap(g).keys()]).toEqual([TRI.id, ALLO.id]);
    expect(rightsReasonOf(await goodRecord(ALLO), ALLO, g.subjects.get(assetKey('models3d', ALLO.id)))).toBe('ok');
  });

  it('human の download・cc-url の download は出ない（理由は license）', async () => {
    const human = await goodRecord(ROVER, { status: 'human', evidence_kind: 'human', license_code: 'cc0' });
    const ccurl = await goodRecord(DBCLS);
    expect(ccurl.evidence_kind).toBe('cc-url');
    const g = await gateOf({ records: [human, ccurl], hosted: [[ROVER.id, hostedRow(SHA)], [DBCLS.id, hostedRow(SHA)]], hostedShas: [[ROVER.id, SHA], [DBCLS.id, SHA]] });
    expect(offerableModels3d(g)).toEqual([]);
    expect(rightsReasonOf(human, ROVER, g.subjects.get(assetKey('models3d', ROVER.id)))).toBe('license');
    expect(rightsReasonOf(ccurl, DBCLS, g.subjects.get(assetKey('models3d', DBCLS.id)))).toBe('license');
  });

  it('NC の行（license）・blocked・unverified・mismatch は出ない', async () => {
    const cases: Array<[Partial<RightsRecord>, string]> = [
      [{ license_code: 'cc-by-nc', license_url: 'https://creativecommons.org/licenses/by-nc/4.0/' }, 'license'],
      [{ blocked: true }, 'blocked'],
      [{ status: 'unverified', license_code: 'unknown' }, 'unverified'],
      [{ status: 'mismatch', fail_code: 'uid_mismatch' }, 'mismatch'],
    ];
    for (const [o, reason] of cases) {
      const r = await goodRecord(ALLO, o);
      const g = await gateOf({ records: [r] });
      expect(offerableModels3d(g), reason).toEqual([]);
      expect(rightsReasonOf(r, ALLO, g.subjects.get(assetKey('models3d', ALLO.id)))).toBe(reason);
    }
  });

  it('download は verified でも hosted に無ければ出ない・hosted でも rights_hosted にその sha が無ければ出ない・stale でも hosted + rights_hosted なら出る', async () => {
    const r = await goodRecord(ROVER);
    expect(ids(offerableModels3d(await gateOf({ records: [r] })))).toEqual([]);
    expect(ids(offerableModels3d(await gateOf({ records: [r], hosted: [[ROVER.id, hostedRow(SHA)]], hostedShas: [[ROVER.id, '8'.repeat(64)]] })))).toEqual([]);
    const ok = offerableModels3d(await gateOf({ records: [r], hosted: [[ROVER.id, hostedRow(SHA)]], hostedShas: [[ROVER.id, SHA]] }));
    expect(ids(ok)).toEqual([ROVER.id]);
    expect(ok[0].hosted).toEqual(hostedRow(SHA));
    const stale = offerableModels3d(await gateOf({ records: [await goodRecord(ROVER, { status: 'stale', fail_code: 'fetch_failed:503' })], hosted: [[ROVER.id, hostedRow(SHA)]], hostedShas: [[ROVER.id, SHA]] }));
    expect(ids(stale)).toEqual([ROVER.id]);
  });

  it('failClass と nextStatus（遷移表）', () => {
    for (const c of ['fetch_failed:404', 'fetch_failed:network', 'fetch_failed:timeout', 'too_large', 'bad_response']) expect(failClass(c), c).toBe('transient');
    for (const c of ['uid_mismatch', 'uploader_missing', 'uploader_mismatch', 'embed_mismatch', 'page_mismatch', 'no_license_url', 'attribution_mismatch', 'title_missing', 'title_mismatch', 'source_not_nasa', 'source_mismatch', 'third_party_marker', 'download_url_not_linked', 'statement_missing:hub', 'statement_missing:terms', 'license_url_mismatch', 'evidence_url_missing', 'evidence_scope_mismatch', 'subject_mismatch', 'no_cc_url', 'ambiguous_cc_url'])
      expect(failClass(c), c).toBe('mismatch');
    const T: Array<[RightsStatus | null, RightsStatus, RightsStatus, RightsStatus]> = [
      [null, 'verified', 'unverified', 'unverified'],
      ['unverified', 'verified', 'unverified', 'unverified'],
      ['verified', 'verified', 'stale', 'mismatch'],
      ['stale', 'verified', 'stale', 'mismatch'],
      ['mismatch', 'verified', 'mismatch', 'mismatch'],
    ];
    for (const [cur, s, t, m] of T) {
      expect(nextStatus(cur, 'success')).toBe(s);
      expect(nextStatus(cur, 'transient')).toBe(t);
      expect(nextStatus(cur, 'mismatch')).toBe(m);
    }
  });

  it('台帳: 一覧の項目は sketchfab / nasa-3d / dbcls / smithsonian のどれかに当たり、知らない host は unsupported', () => {
    expect(RIGHTS_PROVIDERS.map((p) => [p.id, p.kind])).toEqual([['sketchfab', 'api'], ['nasa-3d', 'statement'], ['dbcls', 'cc-url'], ['smithsonian', 'none']]);
    const by = (e: Model3dEntry) => providerOf(e).id;
    expect(MODELS3D.filter((e) => e.kind === 'sketchfab').every((e) => by(e) === 'sketchfab')).toBe(true);
    expect(MODELS3D.filter((e) => e.kind === 'voyager').every((e) => by(e) === 'smithsonian')).toBe(true);
    expect([by(ROVER), by(ISS), by(DBCLS)]).toEqual(['nasa-3d', 'nasa-3d', 'dbcls']);
    expect(by({ ...ALLO, page_url: 'https://example.org/3d-models/x' })).toBe('unsupported');
    expect(by({ ...ROVER, download_url: null })).toBe('unsupported');
    expect(by({ ...TRI, kind: 'sketchfab' })).toBe('unsupported');
  });
});

// ---------------------------------------------------------------------------------------------

describe('AK-7 5 sketchfab（api）', () => {
  const run = (f: typeof fetch, e: Model3dEntry = ALLO) => runRightsCheck(env, e, 'ops@example.invalid', f);

  it('通る: code・license_url（正規化）・attribution = 一覧の値・evidence_json の sha が固定の JSON の sha256・subject_sha256 が今の指紋', async () => {
    const f = stubBy({ [ALLO_API]: jsonRes(sketchfabApi()) });
    const o = await run(f);
    expect(o).toMatchObject({ kind: 'verified', import: null });
    expect(f.calls).toEqual([ALLO_API]);
    const r = recordRow(ALLO);
    expect(r).toMatchObject({ license_code: 'cc-by', license_url: 'https://creativecommons.org/licenses/by/4.0/', attribution: ALLO.attribution, evidence_kind: 'api', status: 'verified', fail_code: null, blocked: 0, modified: 0, claim_at: null, claim_token: null, checked_by: 'ops@example.invalid' });
    expect(r.subject_sha256).toBe(await subjectSha256(ALLO));
    const ev = JSON.parse(String(r.evidence_json));
    const fixed = JSON.stringify({ uid: ALLO_UID, username: 'OMNH', displayName: OMNH_DISPLAY, embedUrl: ALLO.embed_url, viewerUrl: ALLO.page_url, license: { slug: 'cc-by', url: 'http://creativecommons.org/licenses/by/4.0/' } });
    expect(ev).toEqual([{ url: ALLO_API, sha256: shaHex(fixed), ok: true, note: 'creator=' + OMNH_DISPLAY }]);
    expect(checksOf(ALLO).map((c) => [c.result, c.license_code, c.check_token === null])).toEqual([['verified', 'cc-by', false]]);
    // 取得は redirect manual・accept application/json・timeout の signal 付き
    const seen: Array<RequestInit | undefined> = [];
    const req = await checkSketchfab(ALLO, stubBy({ [ALLO_API]: (init) => (seen.push(init), jsonRes(sketchfabApi())()) }));
    expect(req.ok).toBe(true);
    expect(seen[0]?.redirect).toBe('manual');
    expect((seen[0]?.headers as Obj).accept).toBe('application/json');
    expect(seen[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('license.url が NC → verified だが modes は × ×（記録は NC の code）', async () => {
    await run(stubBy({ [ALLO_API]: jsonRes(sketchfabApi({ license: { url: 'http://creativecommons.org/licenses/by-nc/4.0/', slug: 'cc-by-nc' } })) }));
    const r = (await rightsRecordRows(env.DB)).get(assetKey('models3d', ALLO.id)) as RightsRecord;
    expect(r).toMatchObject({ status: 'verified', license_code: 'cc-by-nc' });
    expect(rightsModes(r, await subjectSha256(ALLO))).toEqual(NO);
  });

  it.each<[string, Route, string, Partial<Model3dEntry>?]>([
    ['404', statusRes(404), 'fetch_failed:404'],
    ['非 JSON', htmlRes('<html>not json</html>'), 'bad_response'],
    ['user が null', jsonRes(sketchfabApi({ user: null })), 'bad_response'],
    ['uid が違う', jsonRes(sketchfabApi({ uid: 'f'.repeat(32) })), 'uid_mismatch'],
    ['一覧の uploader が null', jsonRes(sketchfabApi()), 'uploader_missing', { uploader: null }],
    ['投稿者が違う（大文字小文字そのまま）', jsonRes(sketchfabApi({ user: { username: 'omnh' } })), 'uploader_mismatch'],
    ['embedUrl が違う', jsonRes(sketchfabApi({ embedUrl: 'https://sketchfab.com/models/' + 'f'.repeat(32) + '/embed' })), 'embed_mismatch'],
    ['viewerUrl の host が違う', jsonRes(sketchfabApi({ viewerUrl: `https://evil.example/3d-models/allosaurus-${ALLO_UID}` })), 'page_mismatch'],
    ['license.url が無い', jsonRes(sketchfabApi({ license: { slug: 'cc-by' } })), 'no_license_url'],
    ['displayName が 2 字', jsonRes(sketchfabApi({ user: { displayName: 'ab' } })), 'bad_response'],
    ['attribution が displayName を含まない', jsonRes(sketchfabApi({ user: { displayName: 'Natural History Museum' } })), 'attribution_mismatch', { attribution: 'Natural Asset Studio' }],
    ['256 KiB 超', () => new Response(new Uint8Array(256 * 1024 + 1), { status: 200 }), 'too_large'],
    ['302 は追わない', statusRes(302, { location: 'https://evil.example/' }), 'fetch_failed:302'],
  ])('%s → %s', async (_n, route, code, over) => {
    const f = stubBy({ [ALLO_API]: route });
    expect(await checkSketchfab({ ...ALLO, ...(over ?? {}) }, f)).toEqual({ ok: false, fail_code: code });
    expect(f.calls).toEqual([ALLO_API]);
  });

  it('通信の例外は fetch_failed:network / fetch_failed:timeout', async () => {
    const thrower = (e: Error) => (async () => { throw e; }) as unknown as typeof fetch;
    expect(await checkSketchfab(ALLO, thrower(new TypeError('net')))).toEqual({ ok: false, fail_code: 'fetch_failed:network' });
    expect(await checkSketchfab(ALLO, thrower(new DOMException('t', 'TimeoutError')))).toEqual({ ok: false, fail_code: 'fetch_failed:timeout' });
  });

  it('九州大学の実測（viewerUrl は題名の slug 付き・一覧の page_url は slug 無し）でも通る', async () => {
    const uid = KYU.embed_url!.slice('https://sketchfab.com/models/'.length, -'/embed'.length);
    const api = sketchfabApi({ uid, user: { username: 'ffishAsia-and-floraZia', displayName: 'ffish.asia / floraZia.com' }, embedUrl: KYU.embed_url, viewerUrl: `https://sketchfab.com/3d-models/cc0-indian-lotus-nelumbo-nucifera-${uid}`, license: { url: 'http://creativecommons.org/publicdomain/zero/1.0/', slug: 'cc0' } });
    const r = await checkSketchfab(KYU, stubBy({ [`https://api.sketchfab.com/v3/models/${uid}`]: jsonRes(api) }));
    expect(r).toMatchObject({ ok: true, license_code: 'cc0', license_url: 'https://creativecommons.org/publicdomain/zero/1.0/', attribution: KYU.attribution });
  });

  it('遷移表の全セル（行なし・unverified・verified・stale・mismatch × 成功・transient・mismatch）。code / url / evidence は成功の時だけ更新', async () => {
    const outcomes: Array<[string, Route]> = [
      ['success', jsonRes(sketchfabApi())],
      ['transient', statusRes(503)],
      ['mismatch', jsonRes(sketchfabApi({ uid: 'e'.repeat(32) }))],
    ];
    const T: Record<string, Record<string, RightsStatus>> = {
      none: { success: 'verified', transient: 'unverified', mismatch: 'unverified' },
      unverified: { success: 'verified', transient: 'unverified', mismatch: 'unverified' },
      verified: { success: 'verified', transient: 'stale', mismatch: 'mismatch' },
      stale: { success: 'verified', transient: 'stale', mismatch: 'mismatch' },
      mismatch: { success: 'verified', transient: 'mismatch', mismatch: 'mismatch' },
    };
    for (const start of Object.keys(T)) {
      for (const [out, route] of outcomes) {
        db = migratedDb();
        env = { DB: d1(db), R2: r2.R2 } as unknown as Env;
        if (start !== 'none') insertRecord(db, await goodRecord(ALLO, { status: start as RightsStatus, license_code: 'cc0', license_url: 'https://creativecommons.org/publicdomain/zero/1.0/', evidence_json: '[{"url":"x","ok":true}]' }));
        const o = await run(stubBy({ [ALLO_API]: route }));
        const r = recordRow(ALLO);
        expect(r.status, `${start} × ${out}`).toBe(T[start][out]);
        expect(r.claim_token, `${start} × ${out}`).toBeNull();
        if (out === 'success') expect(r).toMatchObject({ license_code: 'cc-by', fail_code: null });
        else {
          expect(o).toMatchObject({ kind: 'failed', status: T[start][out], fail_class: out });
          expect(r.fail_code).toBe(out === 'transient' ? 'fetch_failed:503' : 'uid_mismatch');
          if (start !== 'none') expect(r).toMatchObject({ license_code: 'cc0', evidence_json: '[{"url":"x","ok":true}]' });
          else expect(r).toMatchObject({ license_code: 'unknown', license_url: '', evidence_json: '[]' });
        }
      }
    }
  });
});

describe('AK-7 6 nasa-3d（statement）', () => {
  const run = (f: typeof fetch, e: Model3dEntry = ROVER) => runRightsCheck(env, e, 'cron', f);
  const check = (o: NasaOpts = {}, extra: Record<string, Route> = {}, e: Model3dEntry = ROVER) => checkNasa(e, stubBy(nasaRoutes(e, o, extra)));

  it('通る（実測の文の形）: verified nasa-media・evidence_json は 3 件の url と文の sha。探査車は取り込みまで走る', async () => {
    const glb = tinyGlb();
    const f = stubBy(nasaRoutes(ROVER, {}, { [ROVER.download_url!]: glbRes(glb) }));
    const o = await run(f);
    expect(o).toMatchObject({ kind: 'verified', import: { ok: true, status: 'fetched', sha256: shaHex(glb) } });
    expect(f.calls).toEqual([ROVER.page_url, NASA_HUB, NASA_TERMS, ROVER.download_url]);
    const r = recordRow(ROVER);
    expect(r).toMatchObject({ license_code: 'nasa-media', license_url: NASA_TERMS, attribution: ROVER.attribution, evidence_kind: 'statement', status: 'verified' });
    const ev = JSON.parse(String(r.evidence_json)) as Obj[];
    expect(ev.map((x) => [x.url, x.ok])).toEqual([[ROVER.page_url, true], [NASA_HUB, true], [NASA_TERMS, true]]);
    expect(ev[0].sha256).toBe(shaHex(textOfHtml(nasaPage())));
    expect(ev[1].sha256).toBe(shaHex(textOfHtml(HUB_HTML)));
    // ISS も同じ形（Source の行が NASA/JSC/…）
    expect(await checkNasa(ISS, stubBy(nasaRoutes(ISS)))).toMatchObject({ ok: true, license_code: 'nasa-media', attribution: ISS.attribution });
  });

  it.each<[string, NasaOpts, string]>([
    ['h1 が 2 つ', { extraH1: true }, 'title_missing'],
    ['h1 が違う', { h1: 'Mars 2020 Rover' }, 'title_mismatch'],
    ['Source の直後が違う', { source: 'NASA/Ames Research Center' }, 'source_mismatch'],
    ['Details Source が無い', { source: null }, 'source_mismatch'],
    ['Details の区画の 610 字目に Courtesy of', { details: `<p>${'a'.repeat(600)} Courtesy of Someone Else</p>` }, 'third_party_marker'],
    ['&#169; の形', { details: '<p>&#169; 2020 Someone</p>' }, 'third_party_marker'],
    ['All Rights Reserved（大文字小文字を問わない）', { details: '<p>All Rights Reserved</p>' }, 'third_party_marker'],
    ['href が無い', { href: 'no' }, 'download_url_not_linked'],
    ['url がテキストにだけある', { href: 'text' }, 'download_url_not_linked'],
    ['<!-- href="…" --> の中だけ', { href: 'comment' }, 'download_url_not_linked'],
  ])('%s → %s', async (_n, o, code) => {
    expect(await check(o)).toEqual({ ok: false, fail_code: code });
  });

  it('コメントの中の印・Downloads の後の印は見ない（通る）', async () => {
    expect((await check({ details: '<!-- Courtesy of Someone, all rights reserved -->' })).ok).toBe(true);
    expect((await check({ after: '<footer>Courtesy of the footer</footer>' })).ok).toBe(true);
  });

  it('一覧の attribution が NASA で始まらない → source_not_nasa', async () => {
    const e = { ...ROVER, attribution: 'Jet Propulsion Laboratory' };
    expect(await checkNasa(e, stubBy(nasaRoutes(e)))).toEqual({ ok: false, fail_code: 'source_not_nasa' });
  });

  it('statement_missing:hub / statement_missing:terms（片方の文だけでは足りない）', async () => {
    expect(await check({}, { [NASA_HUB]: htmlRes('<p>3D models</p>') })).toEqual({ ok: false, fail_code: 'statement_missing:hub' });
    expect(await check({}, { [NASA_TERMS]: htmlRes('<p>not subject to copyright in the United States.</p>') })).toEqual({ ok: false, fail_code: 'statement_missing:terms' });
  });

  it('license_url_mismatch: 一覧の license.url が台帳の url でなければ利用の決まりのページを取らない', async () => {
    const e = { ...ROVER, license: { ...ROVER.license, url: 'https://www.nasa.gov/other/' } };
    const f = stubBy(nasaRoutes(e));
    expect(await checkNasa(e, f)).toEqual({ ok: false, fail_code: 'license_url_mismatch' });
    expect(f.calls).toEqual([ROVER.page_url, NASA_HUB]);
  });

  it('1 MiB 超 = too_large（切り捨てた本文は使わない）・302 = fetch_failed:302（追わない）', async () => {
    expect(await check({}, { [ROVER.page_url]: () => new Response(new Uint8Array(1024 * 1024 + 1), { status: 200 }) })).toEqual({ ok: false, fail_code: 'too_large' });
    expect(await check({}, { [ROVER.page_url]: statusRes(200, { 'content-length': String(2 * 1024 * 1024) }) })).toEqual({ ok: false, fail_code: 'too_large' });
    const f = stubBy(nasaRoutes(ROVER, {}, { [ROVER.page_url]: statusRes(302, { location: 'https://evil.example/' }) }));
    expect(await checkNasa(ROVER, f)).toEqual({ ok: false, fail_code: 'fetch_failed:302' });
    expect(f.calls).toEqual([ROVER.page_url]);
  });
});

describe('AK-7 6 untrusted な HTML の読み方（stripComments / textOfHtml）', () => {
  it('コメントは indexOf のループで落とす（閉じていなければ残りを全部）', () => {
    expect(stripComments('a<!-- x -->b<!--y-->c')).toBe('abc');
    expect(stripComments('a<!-- open')).toBe('a');
    expect(stripComments('a-->b')).toBe('a-->b');
  });
  it('script / style を落とし、タグを空白に、文字実体を 1 回だけ復号し、空白を 1 つに', () => {
    expect(textOfHtml('<p>A&amp;B&nbsp;C</p><script>var s = "<p>x</p>";</script><STYLE>p{}</STYLE><p>&quot;q&quot; &#169; &#xA9; &copy; &amp;#169;</p>')).toBe('A&B C "q" © © © &#169;');
    expect(textOfHtml('a < b and c<d')).toBe('a < b and c');
    expect(textOfHtml('x&#0;y&#x110000;z')).toBe('x�y�z');
    // 大きな入力でも線形（閉じない < や <!-- が並んでも 2 乗にならない）
    const t0 = Date.now();
    textOfHtml('<a'.repeat(200_000));
    textOfHtml('<!--'.repeat(200_000));
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

describe('AK-7 7 dbcls（cc-url）', () => {
  const run = (f: typeof fetch, e: Model3dEntry = DBCLS) => runRightsCheck(env, e, 'cron', f);
  const ev = DBCLS.evidence_url!;

  it('deed.ja と legalcode.ja の 2 つ → 1 件に正規化されて verified cc-by。modes は embed だけ（download なので出ない）', async () => {
    const f = stubBy({ [ev]: htmlRes(dbclsPage(DBCLS_LINKS)) });
    expect(await run(f)).toMatchObject({ kind: 'verified', import: null });
    expect(f.calls).toEqual([ev]);
    const rec = (await rightsRecordRows(env.DB)).get(assetKey('models3d', DBCLS.id)) as RightsRecord;
    expect(rec).toMatchObject({ status: 'verified', evidence_kind: 'cc-url', license_code: 'cc-by', license_url: 'https://creativecommons.org/licenses/by/4.0/' });
    expect(JSON.parse(rec.evidence_json)).toEqual([{ url: ev, sha256: shaHex(textOfHtml(dbclsPage(DBCLS_LINKS))), ok: true }]);
    expect(rightsModes(rec, await subjectSha256(DBCLS))).toEqual({ host: false, embed: true });
    expect(offerableModels3d(await loadRightsGate(env)).some((o) => o.entry.id === DBCLS.id)).toBe(false);
  });

  it.each<[string, string, string, Partial<Model3dEntry>?]>([
    ['CC の URL が 0 件', dbclsPage([]), 'no_cc_url'],
    ['by/4.0 と by-sa/4.0', dbclsPage(['https://creativecommons.org/licenses/by/4.0/', 'https://creativecommons.org/licenses/by-sa/4.0/']), 'ambiguous_cc_url'],
    ['title_src が本文に無い', dbclsPage(DBCLS_LINKS, 'OtherDB'), 'subject_mismatch'],
    ['コメントの中だけの CC の URL は数えない', dbclsPage([]).replace('</body>', `<!-- ${DBCLS_LINKS[0]} --></body>`), 'no_cc_url'],
  ])('%s → %s', async (_n, html, code) => {
    expect(await checkCcUrl(DBCLS, stubBy({ [ev]: htmlRes(html) }))).toEqual({ ok: false, fail_code: code });
  });

  it('evidence_url が null → evidence_url_missing。host 違い・path の先頭 2 区分違い → evidence_scope_mismatch（取らない）', async () => {
    const f = stubBy({});
    expect(await checkCcUrl({ ...DBCLS, evidence_url: null }, f)).toEqual({ ok: false, fail_code: 'evidence_url_missing' });
    expect(await checkCcUrl({ ...DBCLS, evidence_url: 'https://evil.example/jp/bodyparts3d/lic.html' }, f)).toEqual({ ok: false, fail_code: 'evidence_scope_mismatch' });
    expect(await checkCcUrl({ ...DBCLS, evidence_url: 'https://dbarchive.biosciencedbc.jp/jp/other/lic.html' }, f)).toEqual({ ok: false, fail_code: 'evidence_scope_mismatch' });
    expect(f.calls).toEqual([]);
  });
});

describe('AK-7 8 smithsonian（人の記録）', () => {
  it('人の記録の行を書き、同じ一覧の 2 回目は human_unchanged（rights_checks が増えない・last_attempt_at は進む）', async () => {
    const f = stubBy({});
    const o1 = await runRightsCheck(env, TRI, 'cron', f);
    expect(o1).toMatchObject({ kind: 'human', result: 'human' });
    expect(f.calls).toEqual([]);
    const r1 = recordRow(TRI);
    expect(r1).toMatchObject({ status: 'human', evidence_kind: 'human', license_code: 'cc0', license_url: 'https://creativecommons.org/publicdomain/zero/1.0/', attribution: TRI.attribution, checked_at: TRI.checked_at, claim_token: null });
    expect(JSON.parse(String(r1.evidence_json))).toEqual([{ url: TRI.page_url, ok: true, note: `${TRI.checked_at} ${TRI.checked_how}` }]);
    expect(checksOf(TRI).map((c) => c.result)).toEqual(['human']);
    db.prepare('UPDATE rights_records SET last_attempt_at = ? WHERE asset_key = ?').run('2026-01-01T00:00:00.000Z', assetKey('models3d', TRI.id));
    const o2 = await runRightsCheck(env, TRI, 'cron', f);
    expect(o2).toMatchObject({ kind: 'human', result: 'human_unchanged' });
    expect(checksOf(TRI).map((c) => c.result)).toEqual(['human']);
    expect(String(recordRow(TRI).last_attempt_at) > '2026-01-01T00:00:00.000Z').toBe(true);
    expect(recordRow(TRI).claim_token).toBeNull();
  });

  it('一覧の license.url を NC に変えた 2 回目は行が書き換わり modes × ×。attribution だけ変えた 2 回目も書き換わる', async () => {
    await runRightsCheck(env, TRI, 'cron', stubBy({}));
    const nc = { ...TRI, license: { ...TRI.license, url: 'https://creativecommons.org/licenses/by-nc/4.0/' } };
    expect(await runRightsCheck(env, nc, 'cron', stubBy({}))).toMatchObject({ kind: 'human', result: 'human' });
    const r = (await rightsRecordRows(env.DB)).get(assetKey('models3d', TRI.id)) as RightsRecord;
    expect(r.license_code).toBe('cc-by-nc');
    expect(rightsModes(r, await subjectSha256(nc))).toEqual(NO);
    const at = { ...TRI, attribution: 'Smithsonian Institution' };
    expect(await runRightsCheck(env, at, 'cron', stubBy({}))).toMatchObject({ kind: 'human', result: 'human' });
    expect(recordRow(TRI).attribution).toBe('Smithsonian Institution');
    expect(checksOf(TRI).map((c) => c.result)).toEqual(['human', 'human', 'human']);
  });

  it('台帳に無い host: skipped（unsupported）で D1 に書かない', async () => {
    const e = { ...TRI, id: 'x-unknown', page_url: 'https://example.org/object/3d/x' };
    expect(await runRightsCheck(env, e, 'cron', stubBy({}))).toEqual({ kind: 'skipped', reason: 'unsupported' });
    expect(rows(db, 'SELECT asset_key FROM rights_records')).toEqual([]);
    expect(rows(db, 'SELECT id FROM rights_checks')).toEqual([]);
  });
});

describe('AK-7 9 claim（同時に 1 本・期限・lost claim・取り込みの間も保持）', () => {
  const deferred = () => {
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const entry = new Promise<void>((r) => (entered = r));
    return { gate, entry, release: () => release(), enter: () => entered() };
  };

  it('2 本を同じ項目で同時に走らせると 1 本だけ検査し、もう 1 本は busy', async () => {
    const d = deferred();
    const f = stubBy({ [ALLO_API]: async () => { d.enter(); await d.gate; return jsonRes(sketchfabApi())(); } });
    const pA = runRightsCheck(env, ALLO, 'a', f);
    await d.entry;
    expect(await runRightsCheck(env, ALLO, 'b', f)).toEqual({ kind: 'skipped', reason: 'busy' });
    d.release();
    expect((await pA).kind).toBe('verified');
    expect(f.calls).toEqual([ALLO_API]);
    expect(logs.some((l) => JSON.parse(l).result === 'busy')).toBe(true);
  });

  it('claim_at が 10 分より古い行は取れる', async () => {
    insertRecord(db, await goodRecord(ALLO), { at: new Date(Date.now() - 11 * 60_000).toISOString(), token: 'old-token' });
    expect((await runRightsCheck(env, ALLO, 'cron', stubBy({ [ALLO_API]: jsonRes(sketchfabApi()) }))).kind).toBe('verified');
    insertRecord(db, await goodRecord(KYU), { at: new Date(Date.now() - 9 * 60_000).toISOString(), token: 'fresh-token' });
    expect(await runRightsCheck(env, KYU, 'cron', stubBy({}))).toEqual({ kind: 'skipped', reason: 'busy' });
  });

  it('lost claim: A が claim → B が 10 分後に回収して mismatch を保存 → A の成功は changes 0 で lost_claim（行は mismatch のまま・A の rights_checks は無い）', async () => {
    await seedGood(db, ALLO.id);
    const d = deferred();
    const fA = stubBy({ [ALLO_API]: async () => { d.enter(); await d.gate; return jsonRes(sketchfabApi())(); } });
    const pA = runRightsCheck(env, ALLO, 'opA', fA);
    await d.entry;
    db.prepare('UPDATE rights_records SET claim_at = ? WHERE asset_key = ?').run(new Date(Date.now() - 11 * 60_000).toISOString(), assetKey('models3d', ALLO.id));
    const b = await runRightsCheck(env, ALLO, 'opB', stubBy({ [ALLO_API]: jsonRes(sketchfabApi({ uid: 'e'.repeat(32) })) }));
    expect(b).toMatchObject({ kind: 'failed', fail_code: 'uid_mismatch', status: 'mismatch' });
    d.release();
    expect(await pA).toEqual({ kind: 'lost_claim' });
    expect(recordRow(ALLO)).toMatchObject({ status: 'mismatch', fail_code: 'uid_mismatch', checked_by: 'opB', claim_token: null });
    expect(checksOf(ALLO).map((c) => [c.by, c.result])).toEqual([['opB', 'uid_mismatch']]);
    expect(logs.some((l) => JSON.parse(l).result === 'lost_claim')).toBe(true);
  });

  it('取り込みの間も claim が保持され（取り込みの stub の中で別の check は busy）、終わってから解放される', async () => {
    const inner: RightsCheckOutcome[] = [];
    const held: unknown[] = [];
    const f: Stub = stubBy(
      nasaRoutes(ROVER, {}, {
        [ROVER.download_url!]: async () => {
          held.push(recordRow(ROVER).claim_token);
          inner.push(await runRightsCheck(env, ROVER, 'other', f));
          return glbRes(tinyGlb())();
        },
      }),
    );
    const o = await runRightsCheck(env, ROVER, 'cron', f);
    expect(inner).toEqual([{ kind: 'skipped', reason: 'busy' }]);
    expect(held[0]).toMatch(/^[0-9a-f]{32}$/);
    expect(o).toMatchObject({ kind: 'verified', import: { ok: true, status: 'fetched' } });
    expect(recordRow(ROVER)).toMatchObject({ claim_at: null, claim_token: null });
  });
});

describe('AK-7 10 取り込み（verified の直後だけ）', () => {
  it('成功で rights_hosted に (asset_key, sha, check_token = その確認のトークン)', async () => {
    const glb = tinyGlb('x');
    await runRightsCheck(env, ROVER, 'cron', stubBy(nasaRoutes(ROVER, {}, { [ROVER.download_url!]: glbRes(glb) })));
    const token = checksOf(ROVER).find((c) => c.result === 'verified')!.check_token;
    expect(rows(db, 'SELECT asset_key, sha256, check_token FROM rights_hosted')).toEqual([{ asset_key: assetKey('models3d', ROVER.id), sha256: shaHex(glb), check_token: token }]);
    expect(one(db, 'SELECT sha256, fetched_by FROM models3d_files WHERE catalog_id = ?', ROVER.id)).toEqual({ sha256: shaHex(glb), fetched_by: 'cron' });
    expect(r2.store.has(R2_KEY(ROVER.id, shaHex(glb)))).toBe(true);
  });

  it('stale の確認（通信の失敗）では取り込まない（rights_hosted が増えない）', async () => {
    await seedGood(db, ROVER.id);
    const f = stubBy(nasaRoutes(ROVER, {}, { [NASA_HUB]: statusRes(503), [ROVER.download_url!]: glbRes(tinyGlb()) }));
    expect(await runRightsCheck(env, ROVER, 'cron', f)).toMatchObject({ kind: 'failed', status: 'stale', fail_code: 'fetch_failed:503' });
    expect(f.calls).not.toContain(ROVER.download_url);
    expect(rows(db, 'SELECT sha256 FROM rights_hosted')).toEqual([]);
  });

  it('止めている記録・NC などで host が許されない時も取り込まない', async () => {
    await seedGood(db, ROVER.id, { blocked: true });
    const f = stubBy(nasaRoutes(ROVER, {}, { [ROVER.download_url!]: glbRes(tinyGlb()) }));
    expect(await runRightsCheck(env, ROVER, 'cron', f)).toMatchObject({ kind: 'verified', import: null });
    expect(f.calls).not.toContain(ROVER.download_url);
    expect(recordRow(ROVER).blocked).toBe(1);
  });

  it('失敗は rights_checks に import: の行・記録は verified のまま。後の取り込みが成功すると last_import_fail は null', async () => {
    const big = statusRes(200, { 'content-length': String(64 * 1024 * 1024) });
    const o = await runRightsCheck(env, ISS, 'cron', stubBy(nasaRoutes(ISS, {}, { [ISS.download_url!]: big })));
    expect(o).toMatchObject({ kind: 'verified', import: { ok: false, error: 'too_large' } });
    expect(recordRow(ISS)).toMatchObject({ status: 'verified', claim_token: null });
    expect(checksOf(ISS).map((c) => c.result)).toEqual(['verified', 'import:too_large']);
    expect((await lastRightsEvents(env.DB, assetKey('models3d', ISS.id))).last_import_fail).toMatchObject({ result: 'import:too_large' });
    expect((await lastRightsEvents(env.DB, assetKey('models3d', ISS.id))).last_fail).toBeNull();
    await new Promise((r) => setTimeout(r, 5));
    await runRightsCheck(env, ISS, 'cron', stubBy(nasaRoutes(ISS, {}, { [ISS.download_url!]: glbRes(tinyGlb('iss')) })));
    expect((await lastRightsEvents(env.DB, assetKey('models3d', ISS.id))).last_import_fail).toBeNull();
  });
});

describe('AK-7 11 配信の出口（GET /api/library/models3d/files/<id>/<sha>.glb）', () => {
  const SHA = 'c'.repeat(64);
  const get = () => worker.fetch(new Request(`http://localhost/api/library/models3d/files/${ROVER.id}/${SHA}.glb`), env, exec);
  beforeEach(() => r2.store.set(R2_KEY(ROVER.id, SHA), new Uint8Array([1, 2, 3])));

  it('行が無い → 404。verified + rights_hosted にある sha → 200（cache 1 日）', async () => {
    expect((await get()).status).toBe(404);
    await seedGood(db, ROVER.id);
    seedHostedSha(db, ROVER.id, SHA);
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=86400');
  });

  it.each<[string, Partial<RightsRecord> | 'invalid' | 'no_hosted']>([
    ['ある sha でも blocked', { blocked: true }],
    ['mismatch', { status: 'mismatch' }],
    ['指紋違い', { subject_sha256: '0'.repeat(64) }],
    ['rights_hosted に無い sha', 'no_hosted'],
    ['不正な行（blocked = 2）', 'invalid'],
    ['人の記録（embed だけ）', { status: 'human', evidence_kind: 'human', license_code: 'cc0' }],
  ])('%s → 404', async (_n, o) => {
    await seedGood(db, ROVER.id, typeof o === 'object' ? o : {});
    if (o === 'invalid') db.prepare('UPDATE rights_records SET blocked = 2').run();
    if (o !== 'no_hosted') seedHostedSha(db, ROVER.id, SHA);
    expect((await get()).status).toBe(404);
  });
});

describe('AK-7 14 cron の段（rightsCandidates / rightsStep）', () => {
  const NOW = new Date('2026-12-20T00:00:00.000Z');
  const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
  const DAY = 86_400_000;
  const S = MODELS3D.filter((e) => e.kind === 'sketchfab');

  it('rightsCandidates: 行なし・指紋違いが先（一覧の順）/ 30 日 + 1 日 / 1 日 / claim 10 分 / unsupported を飛ばす / blocked は飛ばさない / last_attempt_at の古い順', async () => {
    const [A, B, C, D, E, F, G, H, I, J] = S;
    const U = { ...ALLO, id: 'x-unsupported', page_url: 'https://example.org/3d-models/x' };
    const entries = [A, B, C, D, E, F, G, H, I, J, TRI, U];
    const subjects = new Map<string, string>();
    for (const e of entries) subjects.set(assetKey('models3d', e.id), await subjectSha256(e));
    const row = async (e: Model3dEntry, o: Partial<RightsRecord>, claim: string | null = null): Promise<[string, RightsCronRow]> => {
      const r = await goodRecord(e, o);
      return [r.asset_key, { record: r, claim_at: claim, last_attempt_at: r.last_attempt_at }];
    };
    const rowsMap = new Map<string, RightsCronRow>([
      await row(B, { subject_sha256: '0'.repeat(64), last_attempt_at: ago(60_000) }),
      await row(C, { checked_at: ago(31 * DAY), last_attempt_at: ago(2 * DAY + 3600_000) }),
      await row(D, { checked_at: ago(31 * DAY), last_attempt_at: ago(12 * 3600_000) }),
      await row(E, { checked_at: ago(10 * DAY), last_attempt_at: ago(2 * DAY) }),
      await row(F, { status: 'stale', last_attempt_at: ago(2 * DAY) }),
      await row(G, { status: 'mismatch', last_attempt_at: ago(3 * DAY) }),
      await row(H, { status: 'unverified', last_attempt_at: ago(3600_000) }),
      await row(I, { subject_sha256: '0'.repeat(64) }, ago(5 * 60_000)),
      await row(J, { blocked: true, checked_at: ago(31 * DAY), last_attempt_at: ago(4 * DAY) }),
      await row(TRI, { checked_at: '2026-11-07', last_attempt_at: ago(2 * DAY + 7200_000) }),
    ]);
    const got = rightsCandidates(entries, rowsMap, subjects, NOW).map((e) => e.id);
    expect(got).toEqual([A.id, B.id, J.id, G.id, TRI.id, C.id, F.id]);
    // claim が 10 分より古ければ対象に戻る
    rowsMap.set(assetKey('models3d', I.id), { ...rowsMap.get(assetKey('models3d', I.id))!, claim_at: ago(11 * 60_000) });
    expect(rightsCandidates(entries, rowsMap, subjects, NOW).map((e) => e.id).slice(0, 3)).toEqual([A.id, B.id, I.id]);
  });

  it('rightsStep: 5 件で止まり、先頭 5 件が毎回失敗しても次の cron で別の 5 件に進む。paused は paused。deadline を過ぎたら残す', async () => {
    const fail = stubBy({});
    const r1 = await rightsStep(env, { deadline: Date.now() + 10 * 60_000, fetchImpl: fail, catalog: S });
    expect(r1).toEqual({ checked: 5, verified: 0, human: 0, failed: 5, skipped: 0, lost: 0, imported: 0 });
    const first = rows(db, 'SELECT asset_key FROM rights_records ORDER BY asset_key').map((r) => r.asset_key);
    expect(first).toHaveLength(5);
    const r2s = await rightsStep(env, { deadline: Date.now() + 10 * 60_000, fetchImpl: fail, catalog: S });
    expect(r2s).toMatchObject({ checked: 5, failed: 5 });
    const all = rows(db, 'SELECT asset_key FROM rights_records').map((r) => r.asset_key);
    expect(new Set(all).size).toBe(10);
    expect(await rightsStep(env, { deadline: Date.now() + 100_000, fetchImpl: fail, catalog: S })).toMatchObject({ checked: 0 });
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('paused', '1', ?)").run(AT);
    expect(await rightsStep(env, { deadline: Date.now() + 10 * 60_000, fetchImpl: fail, catalog: S })).toBe('paused');
  });

  it('rightsStep の結果の数え方（verified・human・imported）', async () => {
    const f = stubBy({ ...nasaRoutes(ROVER, {}, { [ROVER.download_url!]: glbRes(tinyGlb()) }), [ALLO_API]: jsonRes(sketchfabApi()) });
    const r = await rightsStep(env, { deadline: Date.now() + 10 * 60_000, fetchImpl: f, catalog: [ALLO, TRI, ROVER] });
    expect(r).toEqual({ checked: 3, verified: 2, human: 1, failed: 0, skipped: 0, lost: 0, imported: 1 });
  });

  it('ログの 1 行に url も attribution も無い（cron・手動の確認・例外・取り込みの失敗の行も同じ）', async () => {
    // cron（失敗・成功・人の記録・取り込みの失敗）
    const big = statusRes(200, { 'content-length': String(64 * 1024 * 1024) });
    await rightsStep(env, { deadline: Date.now() + 10 * 60_000, fetchImpl: stubBy({ ...nasaRoutes(ISS, {}, { [ISS.download_url!]: big }), [ALLO_API]: jsonRes(sketchfabApi()) }), catalog: [ALLO, TRI, ISS, KYU] });
    // 手動の確認（route）
    await checkRights(routeCtx(), DBCLS.id, stubBy({ [DBCLS.evidence_url!]: htmlRes(dbclsPage(DBCLS_LINKS)) }));
    // 例外（D1 の batch が投げる）
    const raw = d1(db) as unknown as Obj;
    const broken = { DB: { prepare: raw.prepare, batch: async () => { throw new Error('boom https://evil.example/'); } }, R2: r2.R2 } as unknown as Env;
    await expect(runRightsCheck(broken, MODELS3D_BY_ID.get('kyu-giant-hornet')!, 'cron', stubBy({ [`https://api.sketchfab.com/v3/models/f9c1f7e3f373491fbf01adf94ec8169e`]: statusRes(503) }))).rejects.toThrow('boom');
    const rc = logs.map((l) => JSON.parse(l)).filter((o) => o.at === 'rights_check');
    expect(rc.map((o) => o.result)).toEqual(expect.arrayContaining(['verified', 'human', 'error:Error']));
    for (const o of rc) expect(Object.keys(o).sort()).toEqual(['asset_key', 'at', 'code', 'kind', 'result']);
    for (const l of logs) {
      expect(l).not.toMatch(/https?:\/\//);
      for (const e of [ALLO, TRI, ISS, KYU, DBCLS]) expect(l).not.toContain(e.attribution);
      expect(l).not.toContain(OMNH_DISPLAY);
      expect(l).not.toContain('ops@example.invalid');
    }
    expect(logs.some((l) => l.includes('"at":"model3d_fetch"') && l.includes('too_large'))).toBe(true);
  });
});

describe('AK-7 15 運営の API（check / block / unblock）', () => {
  it('handler: service は 403 human_only（3 本とも）。知らない id は 404', async () => {
    for (const res of [await checkRights(routeCtx({ service: true }), ALLO.id, stubBy({})), await blockRights(routeCtx({ service: true }), ALLO.id, true), await blockRights(routeCtx({ service: true }), ALLO.id, false)]) {
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'human_only' });
    }
    for (const res of [await checkRights(routeCtx(), 'no-such-model', stubBy({})), await blockRights(routeCtx(), 'no-such-model', true)]) {
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'not_found' });
    }
    expect(rows(db, 'SELECT asset_key FROM rights_records')).toEqual([]);
  });

  it('block → blocked: true と rights_checks の 1 行。行が無ければ unverified の行ができる（claim なし）。unblock → false（記録は変えない）', async () => {
    const res = await blockRights(routeCtx(), ALLO.id, true);
    expect(await res.json()).toEqual({ blocked: true });
    expect(recordRow(ALLO)).toMatchObject({ status: 'unverified', license_code: 'unknown', license_url: '', blocked: 1, claim_at: null, claim_token: null, evidence_kind: 'api', checked_by: 'ops@example.invalid' });
    expect(recordRow(ALLO).subject_sha256).toBe(await subjectSha256(ALLO));
    expect(checksOf(ALLO).map((c) => c.result)).toEqual(['blocked']);
    const before = recordRow(ALLO);
    expect(await (await blockRights(routeCtx(), ALLO.id, false)).json()).toEqual({ blocked: false });
    expect(recordRow(ALLO)).toEqual({ ...before, blocked: 0 });
    expect(checksOf(ALLO).map((c) => c.result)).toEqual(['blocked', 'unblocked']);
    // 既にある記録は変えずに blocked だけ
    const r = await seedGood(db, KYU.id);
    await setRightsBlocked(env, KYU, true, 'ops@example.invalid');
    expect(recordRow(KYU)).toMatchObject({ status: 'verified', license_code: r.license_code, blocked: 1 });
  });

  it('止めている間の check も記録を更新し、modes は × × のまま（応答の modes）', async () => {
    await seedGood(db, ALLO.id, { blocked: true, checked_at: '2026-01-01T00:00:00.000Z' });
    const res = await checkRights(routeCtx(), ALLO.id, stubBy({ [ALLO_API]: jsonRes(sketchfabApi()) }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'verified', code: 'cc-by', label: 'CC BY 4.0', modes: NO });
    expect(recordRow(ALLO)).toMatchObject({ status: 'verified', blocked: 1 });
    expect(String(recordRow(ALLO).checked_at) > '2026-01-01T00:00:00.000Z').toBe(true);
  });

  it('check の応答: human / human_unchanged / failed / skipped（busy）/ 取り込みつき', async () => {
    const j = async (r: Response) => (await r.json()) as Obj;
    expect(await j(await checkRights(routeCtx(), TRI.id, stubBy({})))).toEqual({ status: 'human', code: 'cc0', label: 'CC0 1.0', modes: { host: false, embed: true } });
    expect(await j(await checkRights(routeCtx(), TRI.id, stubBy({})))).toEqual({ status: 'human_unchanged', code: 'cc0', label: 'CC0 1.0', modes: { host: false, embed: true } });
    expect(await j(await checkRights(routeCtx(), KYU.id, stubBy({})))).toEqual({ status: 'failed', fail_code: 'fetch_failed:404', fail_class: 'transient', modes: NO });
    insertRecord(db, await goodRecord(ALLO), { at: new Date().toISOString(), token: 't' });
    expect(await j(await checkRights(routeCtx(), ALLO.id, stubBy({})))).toEqual({ status: 'skipped', reason: 'busy', modes: { host: true, embed: true } });
    const glb = tinyGlb();
    expect(await j(await checkRights(routeCtx(), ROVER.id, stubBy(nasaRoutes(ROVER, {}, { [ROVER.download_url!]: glbRes(glb) }))))).toEqual({
      status: 'verified',
      code: 'nasa-media',
      label: 'NASA の利用の決まり',
      modes: { host: true, embed: false },
      import: { status: 'fetched', bytes: glb.byteLength },
    });
    expect(await j(await checkRights(routeCtx(), ISS.id, stubBy(nasaRoutes(ISS, {}, { [ISS.download_url!]: statusRes(500) }))))).toMatchObject({ status: 'verified', import: { status: 'failed', error: 'fetch_failed:500' } });
  });
});

describe('AK-7 16 migration 0017 と不正な行', () => {
  it('空の DB と models3d_files に行がある DB の両方で loadRightsGate が読める', async () => {
    const g = await loadRightsGate(env);
    expect([g.records.size, g.hosted.size, g.hostedShas.size, g.subjects.size]).toEqual([0, 0, 0, MODELS3D.length]);
    const sha = '3'.repeat(64);
    db.prepare('INSERT INTO models3d_files (catalog_id, sha256, bytes, r2_key, draco, fetched_at, fetched_by) VALUES (?, ?, 10, ?, 1, ?, ?)').run(ROVER.id, sha, 'x', AT, 'ops@example.invalid');
    r2.store.set(R2_KEY(ROVER.id, sha), new Uint8Array(1));
    seedHostedSha(db, ROVER.id, sha);
    const g2 = await loadRightsGate(env);
    expect([...g2.hosted.keys()]).toEqual([ROVER.id]);
    expect([...(g2.hostedShas.get(assetKey('models3d', ROVER.id)) ?? [])]).toEqual([sha]);
  });

  it('rightsRecordRows: 知らない status・blocked = 2・空の attribution・壊れた evidence_json・配列でない evidence_json・63 桁の指紋・知らない code / 根拠は invalid', async () => {
    const bad: Array<[string, string, unknown]> = [
      ['a', 'status', 'ok'],
      ['b', 'blocked', 2],
      ['c', 'attribution', ''],
      ['d', 'evidence_json', '{"broken"'],
      ['e', 'evidence_json', '{}'],
      ['f', 'subject_sha256', 'a'.repeat(63)],
      ['g', 'license_code', 'cc-by-4'],
      ['h', 'evidence_kind', 'llm'],
      ['i', 'modified', -1],
    ];
    for (const [id, col, v] of bad) {
      const r = await goodRecord({ ...ALLO, id: `x-${id}` });
      insertRecord(db, r);
      db.prepare(`UPDATE rights_records SET ${col} = ? WHERE asset_key = ?`).run(v as string | number, r.asset_key);
    }
    await seedGood(db, ALLO.id);
    const m = await rightsRecordRows(env.DB);
    for (const [id] of bad) expect(m.get(`models3d:x-${id}`), id).toBe('invalid');
    expect(m.get(assetKey('models3d', ALLO.id))).toMatchObject({ status: 'verified', blocked: false, modified: false });
  });
});

describe('AK-5 GET /api/models3d の rights', () => {
  const list = async () => ((await (await listModels3d(routeCtx())).json()) as { models: Obj[] }).models;

  it('行が無い項目は code: unknown・status: null・record: none（check は台帳の種類）', async () => {
    const m = await list();
    expect(m.find((x) => x.id === ALLO.id)!.rights).toEqual({
      code: 'unknown', label: '不明', license_url: null, attribution: null, evidence_kind: null, status: null, blocked: false, checked_at: null, last_attempt_at: null, fail_code: null,
      check: 'api', modes: NO, record: 'none', reason: 'no_record', last_fail: null, last_import_fail: null,
    });
    expect(m.find((x) => x.id === TRI.id)!.rights.check).toBe('none');
    expect(m.find((x) => x.id === ROVER.id)!.rights.check).toBe('statement');
    expect(m.find((x) => x.id === DBCLS.id)!.rights.check).toBe('cc-url');
  });

  it('記録・失敗・取り込みの失敗・不正な行が rights に出る', async () => {
    await runRightsCheck(env, ALLO, 'cron', stubBy({ [ALLO_API]: jsonRes(sketchfabApi()) }));
    await runRightsCheck(env, ROVER, 'cron', stubBy(nasaRoutes(ROVER, { h1: 'x' })));
    await runRightsCheck(env, ISS, 'cron', stubBy(nasaRoutes(ISS, {}, { [ISS.download_url!]: statusRes(200, { 'content-length': String(64 * 1024 * 1024) }) })));
    insertRecord(db, await goodRecord(KYU));
    db.prepare('UPDATE rights_records SET status = ? WHERE asset_key = ?').run('weird', assetKey('models3d', KYU.id));
    const m = await list();
    expect(m.find((x) => x.id === ALLO.id)!.rights).toMatchObject({ code: 'cc-by', label: 'CC BY 4.0', license_url: 'https://creativecommons.org/licenses/by/4.0/', attribution: ALLO.attribution, evidence_kind: 'api', status: 'verified', record: 'ok', reason: 'ok', modes: { host: true, embed: true } });
    expect(m.find((x) => x.id === ROVER.id)!.rights).toMatchObject({ status: 'unverified', fail_code: 'title_mismatch', reason: 'unverified', last_fail: { result: 'title_mismatch', at: expect.any(String) } });
    expect(m.find((x) => x.id === ISS.id)!.rights).toMatchObject({ status: 'verified', reason: 'ok', last_import_fail: { result: 'import:too_large', at: expect.any(String) } });
    expect(m.find((x) => x.id === KYU.id)!.rights).toMatchObject({ record: 'invalid', reason: 'invalid', status: null, code: 'unknown' });
  });
});
