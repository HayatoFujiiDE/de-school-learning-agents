// 権利の記録の読み書き（契約 §AK-3）。現在値 rights_records・追記だけの rights_checks・rights_hosted。削除する SQL は書かない。
// 不正な行（知らない値・型の違い）は 'invalid' として読み、どの出口にも出さない（rightsModes が × × にする）。

import { all, conditionalBatch, nowIso, stmt } from './db';
import type { Env } from './env';
import { MODELS3D, type Model3dEntry } from './generated/models3d-catalog';
import { hostedModels3d } from './models3d-file';
import {
  assetKey,
  EVIDENCE_KINDS,
  LICENSE_CODES,
  RIGHTS_STATUSES,
  subjectSha256,
  subjectShasOf,
  type EvidenceKind,
  type LicenseCode,
  type RightsGate,
  type RightsRecord,
  type RightsStatus,
} from './rights';
import { evidenceKindOf, providerOf } from './rights-providers';

const SHA_RE = /^[0-9a-f]{64}$/;
const isStr = (v: unknown): v is string => typeof v === 'string';
const strOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string';
const bit = (v: unknown): 0 | 1 | null => (v === 0 || v === 1 ? v : null);

/** D1 の 1 行 → 記録（規則に合わなければ 'invalid'）。余分な列（claim_at・JOIN の列）は見ない */
export function rightsRecordOf(row: Record<string, unknown>): RightsRecord | 'invalid' {
  const blocked = bit(row.blocked);
  const modified = bit(row.modified);
  if (!isStr(row.asset_key) || row.asset_key === '') return 'invalid';
  if (!isStr(row.subject_sha256) || !SHA_RE.test(row.subject_sha256)) return 'invalid';
  if (!LICENSE_CODES.includes(row.license_code as LicenseCode)) return 'invalid';
  if (!EVIDENCE_KINDS.includes(row.evidence_kind as EvidenceKind)) return 'invalid';
  if (!RIGHTS_STATUSES.includes(row.status as RightsStatus)) return 'invalid';
  if (blocked === null || modified === null) return 'invalid';
  if (!isStr(row.attribution) || row.attribution === '') return 'invalid';
  if (!isStr(row.license_url) || !isStr(row.last_attempt_at) || !isStr(row.checked_by)) return 'invalid';
  if (!strOrNull(row.fail_code) || !strOrNull(row.checked_at)) return 'invalid';
  if (!isStr(row.evidence_json)) return 'invalid';
  try {
    if (!Array.isArray(JSON.parse(row.evidence_json))) return 'invalid';
  } catch {
    return 'invalid';
  }
  return {
    asset_key: row.asset_key,
    subject_sha256: row.subject_sha256,
    license_code: row.license_code as LicenseCode,
    license_url: row.license_url,
    attribution: row.attribution,
    evidence_kind: row.evidence_kind as EvidenceKind,
    evidence_json: row.evidence_json,
    modified: modified === 1,
    status: row.status as RightsStatus,
    blocked: blocked === 1,
    fail_code: row.fail_code,
    checked_at: row.checked_at,
    last_attempt_at: row.last_attempt_at,
    checked_by: row.checked_by,
  };
}

/** rights_records の全行（≤ 200 の見込み。上限を超えた行は読まない = 記録が無いのと同じで出ない） */
export async function rightsRecordRows(db: D1Database): Promise<Map<string, RightsRecord | 'invalid'>> {
  const rows = await all<Record<string, unknown>>(db, stmt('SELECT * FROM rights_records ORDER BY asset_key LIMIT 1000'));
  const out = new Map<string, RightsRecord | 'invalid'>();
  for (const r of rows) if (isStr(r.asset_key)) out.set(r.asset_key, rightsRecordOf(r));
  return out;
}

/** rights_hosted の全行（≤ 1000）→ asset_key → 確認のもとで取り込んだ sha の集合 */
export async function hostedShas(db: D1Database): Promise<Map<string, Set<string>>> {
  const rows = await all<{ asset_key: unknown; sha256: unknown }>(db, stmt('SELECT asset_key, sha256 FROM rights_hosted ORDER BY asset_key, sha256 LIMIT 1000'));
  const out = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!isStr(r.asset_key) || !isStr(r.sha256) || !SHA_RE.test(r.sha256)) continue;
    const s = out.get(r.asset_key) ?? new Set<string>();
    s.add(r.sha256);
    out.set(r.asset_key, s);
  }
  return out;
}

/** 門番の入力: rights_records・rights_hosted・§AJ2 の取り込み済み（D1 + R2 head）を 1 回ずつ読み、一覧の全件の指紋を計算する */
export async function loadRightsGate(env: Pick<Env, 'DB' | 'R2'>, catalog: readonly Model3dEntry[] = MODELS3D): Promise<RightsGate> {
  const records = await rightsRecordRows(env.DB);
  const shas = await hostedShas(env.DB);
  const hosted = await hostedModels3d(env);
  const subjects = await subjectShasOf(catalog);
  return { records, hostedShas: shas, hosted, subjects };
}

/** 中身の無い門番（行も取り込みも無い = どの項目も出ない） */
export const EMPTY_RIGHTS_GATE: RightsGate = { records: new Map(), hosted: new Map(), hostedShas: new Map(), subjects: new Map() };

/** 一度も試していない行の last_attempt_at（止める操作で作った行。cron がすぐ確かめる。§AK-3 v3.1） */
export const NEVER_ATTEMPTED = '1970-01-01T00:00:00.000Z';

/**
 * 止める / 戻す（§AK-3）。行が無ければ unverified の行（AK-2 の claim と同じ値・claim_at = NULL・last_attempt_at は未試行 NEVER_ATTEMPTED）を
 * 作ってから blocked を更新し、rights_checks に blocked / unblocked の 1 行（1 つの batch）。「戻す」は記録を変えない（blocked だけ）。止めている間も確認は走る
 */
export async function setRightsBlocked(env: Pick<Env, 'DB'>, e: Model3dEntry, blocked: boolean, by: string): Promise<{ blocked: boolean }> {
  const key = assetKey('models3d', e.id);
  const kind = evidenceKindOf(providerOf(e));
  const now = nowIso();
  await conditionalBatch(env.DB, [
    stmt(
      `INSERT OR IGNORE INTO rights_records (asset_key, subject_sha256, license_code, license_url, attribution, evidence_kind, evidence_json, modified, status, blocked, fail_code, checked_at, last_attempt_at, checked_by, claim_at, claim_token)
       VALUES (?, ?, 'unknown', '', ?, ?, '[]', 0, 'unverified', 0, NULL, NULL, ?, ?, NULL, NULL)`,
      key,
      await subjectSha256(e),
      e.attribution,
      kind,
      NEVER_ATTEMPTED,
      by,
    ),
    stmt('UPDATE rights_records SET blocked = ? WHERE asset_key = ?', blocked ? 1 : 0, key),
    stmt(
      `INSERT INTO rights_checks (asset_key, at, by, evidence_kind, result, license_code, evidence_json, check_token) VALUES (?, ?, ?, ?, ?, NULL, '[]', NULL)`,
      key,
      now,
      by,
      kind,
      blocked ? 'blocked' : 'unblocked',
    ),
  ]);
  return { blocked };
}

export interface RightsEvent {
  at: string;
  result: string;
}
export type RightsEvents = { last_fail: RightsEvent | null; last_import_fail: RightsEvent | null };

/** 取り込みの成功の履歴（有効化の batch が書く）。最後の失敗・取り込みの失敗には数えない */
const IMPORT_OK = "('import:fetched', 'import:unchanged')";
const FAIL_WHERE = `result NOT IN ('verified', 'human', 'blocked', 'unblocked') AND substr(result, 1, 7) <> 'import:'`;
const IMPORT_FAIL_WHERE = `substr(result, 1, 7) = 'import:' AND result NOT IN ${IMPORT_OK}`;

/**
 * 最後の失敗（result が verified / human / blocked / unblocked でなく import: でも始まらない最後の行）と、
 * 最後の取り込みの失敗（import: で始まる失敗の最後の行のうち、rights_hosted の同じ項目の最新の verified_at より新しいもの。無ければ null）。
 * rights_hosted の verified_at は取り込みが成功するたびに更新される（同じ sha でも。§AK-2 6 v3.1）
 */
export async function lastRightsEvents(db: D1Database, key: string): Promise<RightsEvents> {
  return (await lastRightsEventsAll(db, key)).get(key) ?? { last_fail: null, last_import_fail: null };
}

/** lastRightsEvents の全件版（asset_key → 結果。3 クエリ）。only を渡すとその 1 件だけ */
export async function lastRightsEventsAll(db: D1Database, only?: string): Promise<Map<string, RightsEvents>> {
  const w = only === undefined ? '' : ' AND asset_key = ?';
  const p = only === undefined ? [] : [only];
  const lastOf = (where: string) =>
    all<{ asset_key: string; at: string; result: string }>(
      db,
      stmt(`SELECT c.asset_key, c.at, c.result FROM rights_checks c JOIN (SELECT asset_key, MAX(id) AS mid FROM rights_checks WHERE ${where}${w} GROUP BY asset_key) m ON m.mid = c.id`, ...p),
    );
  const fails = await lastOf(FAIL_WHERE);
  const imports = await lastOf(IMPORT_FAIL_WHERE);
  const hosted = await all<{ asset_key: string; v: string | null }>(db, stmt(`SELECT asset_key, MAX(verified_at) AS v FROM rights_hosted WHERE 1 = 1${w} GROUP BY asset_key`, ...p));
  const hostedAt = new Map(hosted.map((h) => [String(h.asset_key), h.v === null ? null : String(h.v)]));
  const out = new Map<string, RightsEvents>();
  const slot = (k: string) => out.get(k) ?? (out.set(k, { last_fail: null, last_import_fail: null }), out.get(k)!);
  for (const f of fails) slot(String(f.asset_key)).last_fail = { at: String(f.at), result: String(f.result) };
  for (const i of imports) {
    const k = String(i.asset_key);
    const v = hostedAt.get(k) ?? null;
    if (v === null || String(i.at) > v) slot(k).last_import_fail = { at: String(i.at), result: String(i.result) };
  }
  return out;
}
