// 権利の確認（契約 §AK-2。I/O）: 台帳（rights-providers.ts）の確かめ方で提供元の記録を取り、機械の検査を通ったものだけ verified の記録にする。
// - 取りに行く url は一覧の静的な値（page_url / embed_url / download_url / evidence_url）と台帳の定数だけ。リダイレクトは追わない（redirect: 'manual'）
// - 応答の HTML / JSON は untrusted。本文は上限（readCapped）を超えたら使わない。正規表現は固定長の文字クラスだけ（後方参照・入れ子の量指定子なし）。
//   コメントの除去とタグの除去は indexOf のループ。decodeURIComponent は使わない
// - 1 つの項目の確認（検査 + 取り込み）は同時に 1 本（行の claim と所有トークン）。結果の保存と rights_checks の追記は 1 つの batch（トークンが一致する時だけ）
// - ログの 1 行は {at, asset_key, kind, result, code} だけ（url・本文・応答の JSON・attribution を出さない）

import { conditionalBatch, isoPlus, nowIso, stmt, type Stmt } from './db';
import type { Env } from './env';
import type { Model3dEntry } from './generated/models3d-catalog';
import { readCapped } from './models3d-file';
import {
  assetKey,
  failClass,
  licenseCodeOfUrl,
  NASA_MEDIA_URL,
  nextStatus,
  normalizeLicenseUrl,
  rightsModes,
  sha256Hex,
  squash,
  subjectSha256,
  type EvidenceKind,
  type FailClass,
  type LicenseCode,
  type RightsRecord,
  type RightsStatus,
} from './rights';
import { evidenceKindOf, isSketchfabPageOf, NASA_HUB_URL, NASA_TERMS_URL, providerOf, SKETCHFAB_API_BASE, sketchfabUidOf } from './rights-providers';
import { rightsRecordOf } from './rights-store';
import { importModel3d, type ImportOutcome } from './routes/models3d';

const FETCH_TIMEOUT_MS = 20_000;
const API_MAX_BYTES = 256 * 1024;
const PAGE_MAX_BYTES = 1024 * 1024;
const CLAIM_TTL_MS = 10 * 60_000;
const DETAILS_MAX = 3000;

// ---------------------------------------------------------------------------
// untrusted な HTML から文を取り出す（純関数）

/** ASCII の英大文字だけを小文字にする（長さが変わらないので、元の文字列と同じ位置で探せる） */
const asciiLower = (s: string): string => s.replace(/[A-Z]/g, (c) => c.toLowerCase());

/** `<!-- … -->` を落とす（indexOf のループ。閉じていないコメントは残りを全部落とす = ブラウザと同じ） */
export function stripComments(html: string): string {
  let out = '';
  let at = 0;
  for (;;) {
    const s = html.indexOf('<!--', at);
    if (s < 0) return out + html.slice(at);
    out += html.slice(at, s);
    const e = html.indexOf('-->', s + 4);
    if (e < 0) return out;
    at = e + 3;
  }
}

/** <tag …> … </tag …> の区画を落とす（script / style。ASCII の大文字小文字を区別しない。閉じていなければ残りを全部落とす） */
function dropBlocks(html: string, tag: string): string {
  const low = asciiLower(html);
  let out = '';
  let at = 0;
  for (;;) {
    const s = low.indexOf(`<${tag}`, at);
    if (s < 0) return out + html.slice(at);
    const after = low.charCodeAt(s + tag.length + 1);
    // <scripts> のような別名のタグは区画にしない（次の文字が空白・> ・/ の時だけ）
    if (!(after === 0x3e || after === 0x2f || after === 0x20 || after === 0x09 || after === 0x0a || after === 0x0d || after === 0x0c)) {
      out += html.slice(at, s + 1);
      at = s + 1;
      continue;
    }
    out += html.slice(at, s) + ' ';
    const close = low.indexOf(`</${tag}`, s);
    if (close < 0) return out;
    const gt = html.indexOf('>', close);
    if (gt < 0) return out;
    at = gt + 1;
  }
}

/** タグを落とす（< の次が英字・/・!・? の時だけタグとみなし、次の > まで飛ばして空白 1 つに。閉じていなければ残りを落とす） */
function dropTags(html: string): string {
  let out = '';
  let at = 0;
  for (;;) {
    const s = html.indexOf('<', at);
    if (s < 0) return out + html.slice(at);
    const c = html.charCodeAt(s + 1);
    const isTag = (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c === 0x2f || c === 0x21 || c === 0x3f;
    if (!isTag) {
      out += html.slice(at, s + 1);
      at = s + 1;
      continue;
    }
    out += html.slice(at, s) + ' ';
    const gt = html.indexOf('>', s + 1);
    if (gt < 0) return out;
    at = gt + 1;
  }
}

const NAMED_ENTITIES: Record<string, string> = { amp: '&', nbsp: ' ', quot: '"', copy: '©', lt: '<', gt: '>' };
const ENTITY_RE = /&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|amp|nbsp|quot|copy|lt|gt);/g;

/** 文字実体を 1 回だけ復号する（&amp; &nbsp; &quot; &copy; &lt; &gt; と数値の &#NNN; &#xHH;。範囲外・サロゲートは U+FFFD） */
export function decodeEntities(s: string): string {
  return s.replace(ENTITY_RE, (_m, body: string) => {
    if (body[0] !== '#') return NAMED_ENTITIES[body] ?? '';
    const n = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    if (!Number.isFinite(n) || n <= 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return '�';
    return String.fromCodePoint(n);
  });
}

/** untrusted な HTML の文: コメントを落とす → script / style を落とす → タグを落とす → 文字実体を復号 → 空白を 1 つに */
export function textOfHtml(html: string): string {
  const noBlocks = dropBlocks(dropBlocks(stripComments(html), 'script'), 'style');
  return decodeEntities(dropTags(noBlocks)).replace(/\s+/g, ' ').trim();
}

/** コメント除去後の HTML の <h1> の文（全部）。<h1> と <h1 …> だけを数える（<h10> などは数えない） */
export function h1Texts(html: string): string[] {
  const low = asciiLower(html);
  const out: string[] = [];
  let at = 0;
  for (;;) {
    const s = low.indexOf('<h1', at);
    if (s < 0) return out;
    const c = low.charCodeAt(s + 3);
    if (!(c === 0x3e || c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d || c === 0x0c || c === 0x2f)) {
      at = s + 3;
      continue;
    }
    const gt = html.indexOf('>', s);
    if (gt < 0) return out;
    const close = low.indexOf('</h1', gt);
    const inner = html.slice(gt + 1, close < 0 ? html.length : close);
    out.push(textOfHtml(inner));
    if (close < 0) return out;
    at = close + 4;
  }
}

const cutCodePoints = (s: string, n: number): string => [...s].slice(0, n).join('');

// ---------------------------------------------------------------------------
// 取得（redirect: 'manual'・timeout 20 s・上限つき）

type Fetched = { ok: true; text: string } | { ok: false; code: string };

async function fetchCapped(fetchImpl: typeof fetch, url: string, accept: string, max: number): Promise<Fetched> {
  try {
    const res = await fetchImpl(url, { redirect: 'manual', headers: { accept }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (res.status !== 200) {
      await res.body?.cancel().catch(() => {});
      return { ok: false, code: `fetch_failed:${res.status}` };
    }
    const cl = res.headers.get('content-length');
    if (cl !== null && /^\d+$/.test(cl.trim()) && Number(cl.trim()) > max) {
      await res.body?.cancel().catch(() => {});
      return { ok: false, code: 'too_large' };
    }
    const got = await readCapped(res.body, max);
    if (got === 'too_large') return { ok: false, code: 'too_large' };
    return { ok: true, text: new TextDecoder('utf-8').decode(got) };
  } catch (e) {
    return { ok: false, code: e && typeof e === 'object' && (e as { name?: unknown }).name === 'TimeoutError' ? 'fetch_failed:timeout' : 'fetch_failed:network' };
  }
}

// ---------------------------------------------------------------------------
// 機械の検査（台帳の 3 種類）。結果は verified の記録の中身か fail_code

export interface EvidenceItem {
  url: string;
  sha256?: string;
  ok: boolean;
  note?: string;
}

export type CheckResult = { ok: true; license_code: LicenseCode; license_url: string; attribution: string; evidence: EvidenceItem[] } | { ok: false; fail_code: string };

const failed = (fail_code: string): CheckResult => ({ ok: false, fail_code });
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** sketchfab（api）: Data API v3 の応答を一覧と照らす（AK-2 の順序と fail_code のとおり） */
export async function checkSketchfab(e: Model3dEntry, fetchImpl: typeof fetch): Promise<CheckResult> {
  const uid = sketchfabUidOf(e.embed_url);
  if (uid === null) return failed('embed_mismatch');
  const apiUrl = SKETCHFAB_API_BASE + uid;
  const got = await fetchCapped(fetchImpl, apiUrl, 'application/json', API_MAX_BYTES);
  if (!got.ok) return failed(got.code);
  let j: unknown;
  try {
    j = JSON.parse(got.text);
  } catch {
    return failed('bad_response');
  }
  if (!isObj(j) || !isObj(j.user)) return failed('bad_response');
  if (j.uid !== uid) return failed('uid_mismatch');
  if (e.uploader === null) return failed('uploader_missing');
  if (j.user.username !== e.uploader) return failed('uploader_mismatch');
  if (j.embedUrl !== e.embed_url) return failed('embed_mismatch');
  if (!isSketchfabPageOf(j.viewerUrl, uid)) return failed('page_mismatch');
  const lic = isObj(j.license) ? j.license : null;
  if (!lic || typeof lic.url !== 'string') return failed('no_license_url');
  const displayName = j.user.displayName;
  if (typeof displayName !== 'string' || [...squash(displayName)].length < 3) return failed('bad_response');
  if (!squash(e.attribution).includes(squash(displayName))) return failed('attribution_mismatch');
  const shown = cutCodePoints(displayName, 200);
  const digest = await sha256Hex(
    JSON.stringify({
      uid,
      username: j.user.username,
      displayName: shown,
      embedUrl: j.embedUrl,
      viewerUrl: j.viewerUrl,
      license: { slug: typeof lic.slug === 'string' ? lic.slug : null, url: lic.url },
    }),
  );
  return {
    ok: true,
    license_code: licenseCodeOfUrl(lic.url),
    license_url: normalizeLicenseUrl(lic.url) ?? '',
    attribution: e.attribution,
    evidence: [{ url: apiUrl, sha256: digest, ok: true, note: 'creator=' + shown }],
  };
}

const NASA_MARKER_RE = /copyright|©|courtesy|all rights reserved|used with permission/i;
const DETAILS_SOURCE = ' Details Source ';
const DOWNLOADS = ' Downloads ';

/** nasa-3d（statement）: モデルのページ・3D Resources のトップ・利用の決まりの 3 つ（AK-2 の順序と fail_code のとおり） */
export async function checkNasa(e: Model3dEntry, fetchImpl: typeof fetch): Promise<CheckResult> {
  // (a) モデルのページ
  const page = await fetchCapped(fetchImpl, e.page_url, 'text/html', PAGE_MAX_BYTES);
  if (!page.ok) return failed(page.code);
  const html = stripComments(page.text);
  const h1 = h1Texts(html);
  if (h1.length !== 1) return failed('title_missing');
  if (h1[0] !== e.title_src) return failed('title_mismatch');
  if (!/^NASA(\/|$)/.test(e.attribution)) return failed('source_not_nasa');
  const text = textOfHtml(html);
  const at = text.indexOf(DETAILS_SOURCE);
  if (at < 0 || !text.slice(at + DETAILS_SOURCE.length).startsWith(e.attribution + ' ')) return failed('source_mismatch');
  const dl = text.indexOf(DOWNLOADS, at + 1);
  const end = Math.min(dl < 0 ? Number.POSITIVE_INFINITY : dl, at + DETAILS_MAX);
  if (NASA_MARKER_RE.test(text.slice(at, end))) return failed('third_party_marker');
  if (e.download_url === null || !html.includes(`href="${e.download_url}"`)) return failed('download_url_not_linked');
  // (b) 3D Resources のトップ
  const hub = await fetchCapped(fetchImpl, NASA_HUB_URL, 'text/html', PAGE_MAX_BYTES);
  if (!hub.ok) return failed(hub.code);
  const hubText = textOfHtml(hub.text);
  if (!hubText.includes('free to download and use')) return failed('statement_missing:hub');
  // (c) 利用の決まり（一覧の license.url が台帳の url と違えば取らない）
  if (normalizeLicenseUrl(e.license.url) !== NASA_MEDIA_URL) return failed('license_url_mismatch');
  const terms = await fetchCapped(fetchImpl, NASA_TERMS_URL, 'text/html', PAGE_MAX_BYTES);
  if (!terms.ok) return failed(terms.code);
  const termsText = textOfHtml(terms.text);
  if (!termsText.includes('not subject to copyright in the United States') || !termsText.includes('educational or informational purposes')) return failed('statement_missing:terms');
  return {
    ok: true,
    license_code: 'nasa-media',
    license_url: NASA_MEDIA_URL,
    attribution: e.attribution,
    evidence: [
      { url: e.page_url, sha256: await sha256Hex(text), ok: true },
      { url: NASA_HUB_URL, sha256: await sha256Hex(hubText), ok: true },
      { url: NASA_TERMS_URL, sha256: await sha256Hex(termsText), ok: true },
    ],
  };
}

const CC_URL_RE = /https?:\/\/creativecommons\.org\/[A-Za-z0-9./_-]+/g;

/** url の host と、path の先頭 2 区分（どちらも空でない時だけ）。https でなければ null */
function scopeOf(u: string): { host: string; head: string } | null {
  try {
    const x = new URL(u);
    if (x.protocol !== 'https:') return null;
    const segs = x.pathname.split('/');
    if (segs.length < 4 || !segs[1] || !segs[2]) return null;
    return { host: x.host, head: `/${segs[1]}/${segs[2]}/` };
  } catch {
    return null;
  }
}

/** dbcls（cc-url）: 根拠のページの CC の URL（embed だけの根拠。host には使わない） */
export async function checkCcUrl(e: Model3dEntry, fetchImpl: typeof fetch): Promise<CheckResult> {
  if (e.evidence_url === null) return failed('evidence_url_missing');
  const ev = scopeOf(e.evidence_url);
  const pg = scopeOf(e.page_url);
  if (!ev || !pg || ev.host !== pg.host || ev.head !== pg.head) return failed('evidence_scope_mismatch');
  const got = await fetchCapped(fetchImpl, e.evidence_url, 'text/html', PAGE_MAX_BYTES);
  if (!got.ok) return failed(got.code);
  const html = stripComments(got.text);
  const text = textOfHtml(html);
  if (!text.includes(e.title_src)) return failed('subject_mismatch');
  const found = new Set<string>();
  for (const m of html.matchAll(CC_URL_RE)) {
    const n = normalizeLicenseUrl(m[0]);
    if (n !== null) found.add(n);
  }
  if (found.size === 0) return failed('no_cc_url');
  if (found.size >= 2) return failed('ambiguous_cc_url');
  const url = [...found][0];
  return { ok: true, license_code: licenseCodeOfUrl(url), license_url: url, attribution: e.attribution, evidence: [{ url: e.evidence_url, sha256: await sha256Hex(text), ok: true }] };
}

/** smithsonian（human）: 一覧の値から人の記録の中身を作る（機械の検査はしない） */
export function humanRecordOf(e: Model3dEntry): { license_code: LicenseCode; license_url: string; attribution: string; evidence_json: string; checked_at: string } {
  return {
    license_code: licenseCodeOfUrl(e.license.url),
    license_url: normalizeLicenseUrl(e.license.url) ?? '',
    attribution: e.attribution,
    evidence_json: JSON.stringify([{ url: e.page_url, ok: true, note: `${e.checked_at} ${cutCodePoints(e.checked_how, 300)}` }]),
    checked_at: e.checked_at,
  };
}

// ---------------------------------------------------------------------------
// runRightsCheck（AK-2 の 1〜8）

export type RightsCheckOutcome =
  | { kind: 'skipped'; reason: 'unsupported' | 'busy' }
  | { kind: 'human'; result: 'human' | 'human_unchanged'; record: RightsRecord }
  | { kind: 'verified'; record: RightsRecord; import: ImportOutcome | null }
  | { kind: 'failed'; fail_code: string; fail_class: FailClass; status: RightsStatus }
  | { kind: 'lost_claim' };

const randomToken = (): string => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');

const logCheck = (key: string, kind: EvidenceKind, result: string, code: string | null) =>
  console.log(JSON.stringify({ at: 'rights_check', asset_key: key, kind, result, code }));

/** P = その行の claim をまだこのトークンが持っている（結果の保存・取り込みの記録はこれが成り立つ時だけ） */
const HELD = 'EXISTS (SELECT 1 FROM rights_records WHERE asset_key = ? AND claim_token = ?)';

const checkRow = (key: string, at: string, by: string, kind: EvidenceKind, result: string, code: LicenseCode | null, evidenceJson: string, token: string): Stmt =>
  stmt(
    `INSERT INTO rights_checks (asset_key, at, by, evidence_kind, result, license_code, evidence_json, check_token) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ${HELD}`,
    key,
    at,
    by,
    kind,
    result,
    code,
    evidenceJson,
    token,
    key,
    token,
  );

/**
 * 1 つの項目の権利を確かめる（AK-2）。by は 'cron' か運営の email。fetchImpl はテストが stub を渡す。
 * claim（行の所有トークン）を取れなければ busy。結果の保存・取り込みの記録はトークンが一致する時だけ（期限で回収された古い実行は lost_claim）
 */
export async function runRightsCheck(env: Pick<Env, 'DB' | 'R2'>, e: Model3dEntry, by: string, fetchImpl: typeof fetch = fetch): Promise<RightsCheckOutcome> {
  const db = env.DB;
  const provider = providerOf(e);
  // 1. 台帳に無い提供元は D1 に書かない
  if (provider.kind === 'unsupported') return { kind: 'skipped', reason: 'unsupported' };
  const key = assetKey('models3d', e.id);
  const kind = evidenceKindOf(provider);
  const subject = await subjectSha256(e);

  // 2. claim（新規は unverified の行を作る。claim 中で期限内なら changes 0 = busy）
  const token = randomToken();
  const now = nowIso();
  const claimed = await db
    .prepare(
      `INSERT INTO rights_records (asset_key, subject_sha256, license_code, license_url, attribution, evidence_kind, evidence_json, modified, status, blocked, fail_code, checked_at, last_attempt_at, checked_by, claim_at, claim_token) VALUES (?, ?, 'unknown', '', ?, ?, '[]', 0, 'unverified', 0, NULL, NULL, ?, ?, ?, ?) ON CONFLICT(asset_key) DO UPDATE SET claim_at = excluded.claim_at, claim_token = excluded.claim_token, last_attempt_at = excluded.last_attempt_at WHERE rights_records.claim_at IS NULL OR rights_records.claim_at < ?`,
    )
    .bind(key, subject, e.attribution, kind, now, by, now, token, isoPlus(-CLAIM_TTL_MS))
    .run();
  if (Number(claimed.meta?.changes ?? 0) === 0) {
    logCheck(key, kind, 'busy', null);
    return { kind: 'skipped', reason: 'busy' };
  }

  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    await db.prepare('UPDATE rights_records SET claim_at = NULL, claim_token = NULL WHERE asset_key = ? AND claim_token = ?').bind(key, token).run();
  };
  try {
    const curRow = await db.prepare('SELECT * FROM rights_records WHERE asset_key = ?').bind(key).first<Record<string, unknown>>();
    const cur = curRow ? rightsRecordOf(curRow) : 'invalid';
    const curStatus: RightsStatus | null = cur === 'invalid' ? null : cur.status;

    // 3. 人の記録（機械で確かめられない提供元）
    if (provider.kind === 'none') {
      const hr = humanRecordOf(e);
      const base = cur === 'invalid' ? null : cur;
      if (base && base.status === 'human' && base.subject_sha256 === subject) {
        // no-op: last_attempt_at と claim の解放だけ。rights_checks に足さない
        const r = await db
          .prepare('UPDATE rights_records SET last_attempt_at = ?, claim_at = NULL, claim_token = NULL WHERE asset_key = ? AND claim_token = ?')
          .bind(nowIso(), key, token)
          .run();
        released = true;
        if (Number(r.meta?.changes ?? 0) === 0) {
          logCheck(key, kind, 'lost_claim', null);
          return { kind: 'lost_claim' };
        }
        logCheck(key, kind, 'human_unchanged', base.license_code);
        return { kind: 'human', result: 'human_unchanged', record: base };
      }
      const at = nowIso();
      const b = await conditionalBatch(db, [
        checkRow(key, at, by, 'human', 'human', hr.license_code, hr.evidence_json, token),
        stmt(
          `UPDATE rights_records SET subject_sha256 = ?, license_code = ?, license_url = ?, attribution = ?, evidence_kind = 'human', evidence_json = ?, status = 'human', fail_code = NULL, checked_at = ?, last_attempt_at = ?, checked_by = ?, claim_at = NULL, claim_token = NULL WHERE asset_key = ? AND claim_token = ?`,
          subject,
          hr.license_code,
          hr.license_url,
          hr.attribution,
          hr.evidence_json,
          hr.checked_at,
          at,
          by,
          key,
          token,
        ),
      ]);
      released = true;
      if (!b.ok) {
        logCheck(key, kind, 'lost_claim', null);
        return { kind: 'lost_claim' };
      }
      const record: RightsRecord = {
        asset_key: key,
        subject_sha256: subject,
        license_code: hr.license_code,
        license_url: hr.license_url,
        attribution: hr.attribution,
        evidence_kind: 'human',
        evidence_json: hr.evidence_json,
        modified: base?.modified ?? false,
        status: 'human',
        blocked: base?.blocked ?? false,
        fail_code: null,
        checked_at: hr.checked_at,
        last_attempt_at: at,
        checked_by: by,
      };
      logCheck(key, kind, 'human', hr.license_code);
      return { kind: 'human', result: 'human', record };
    }

    // 4〜5. 機械の検査
    const res = provider.kind === 'api' ? await checkSketchfab(e, fetchImpl) : provider.kind === 'statement' ? await checkNasa(e, fetchImpl) : await checkCcUrl(e, fetchImpl);
    if (!res.ok) {
      const cls = failClass(res.fail_code);
      const status = nextStatus(curStatus, cls);
      const at = nowIso();
      const b = await conditionalBatch(db, [
        checkRow(key, at, by, kind, res.fail_code, null, '[]', token),
        stmt(
          `UPDATE rights_records SET status = ?, fail_code = ?, last_attempt_at = ?, checked_by = ?, claim_at = NULL, claim_token = NULL WHERE asset_key = ? AND claim_token = ?`,
          status,
          res.fail_code,
          at,
          by,
          key,
          token,
        ),
      ]);
      released = true;
      if (!b.ok) {
        logCheck(key, kind, 'lost_claim', null);
        return { kind: 'lost_claim' };
      }
      logCheck(key, kind, res.fail_code, null);
      return { kind: 'failed', fail_code: res.fail_code, fail_class: cls, status };
    }
    const evidenceJson = JSON.stringify(res.evidence);
    const at = nowIso();
    const b = await conditionalBatch(db, [
      checkRow(key, at, by, kind, 'verified', res.license_code, evidenceJson, token),
      stmt(
        `UPDATE rights_records SET subject_sha256 = ?, license_code = ?, license_url = ?, attribution = ?, evidence_kind = ?, evidence_json = ?, status = 'verified', fail_code = NULL, checked_at = ?, last_attempt_at = ?, checked_by = ? WHERE asset_key = ? AND claim_token = ?`,
        subject,
        res.license_code,
        res.license_url,
        res.attribution,
        kind,
        evidenceJson,
        at,
        at,
        by,
        key,
        token,
      ),
    ]);
    if (!b.ok) {
      released = true; // トークンはもう行に無い（回収された）
      logCheck(key, kind, 'lost_claim', null);
      return { kind: 'lost_claim' };
    }
    const base = cur === 'invalid' ? null : cur;
    const record: RightsRecord = {
      asset_key: key,
      subject_sha256: subject,
      license_code: res.license_code,
      license_url: res.license_url,
      attribution: res.attribution,
      evidence_kind: kind,
      evidence_json: evidenceJson,
      modified: base?.modified ?? false,
      status: 'verified',
      blocked: base?.blocked ?? false,
      fail_code: null,
      checked_at: at,
      last_attempt_at: at,
      checked_by: by,
    };
    logCheck(key, kind, 'verified', res.license_code);

    // 6. 取り込み（verified の直後だけ。claim を持ったまま）
    let imported: ImportOutcome | null = null;
    if (rightsModes(record, subject).host && e.kind === 'download' && e.download_url !== null) {
      try {
        imported = await importModel3d(env, e, by, fetchImpl);
      } catch {
        imported = { ok: false, error: 'internal_error', http: 500 };
      }
      if (imported.ok) {
        await db
          .prepare(`INSERT OR IGNORE INTO rights_hosted (asset_key, sha256, verified_at, check_token) SELECT ?, ?, ?, ? WHERE ${HELD}`)
          .bind(key, imported.sha256, nowIso(), token, key, token)
          .run();
      } else {
        const s = checkRow(key, nowIso(), by, kind, `import:${imported.error}`, null, '[]', token);
        await db.prepare(s.sql).bind(...s.params).run();
      }
    }
    return { kind: 'verified', record, import: imported };
  } catch (err) {
    logCheck(key, kind, 'error:' + (err instanceof Error ? err.name.replace(/[^A-Za-z0-9_]/g, '').slice(0, 40) : 'error'), null);
    throw err;
  } finally {
    // 7. 解放（失敗・人の記録・lost_claim の経路は上の UPDATE で済んでいる）
    if (!released) await release().catch(() => {});
  }
}
