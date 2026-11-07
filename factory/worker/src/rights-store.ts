// 権利の記録の読み書き（契約 §AK-3）。現在値 rights_records・追記だけの rights_checks・rights_hosted。削除する SQL は書かない。
// 不正な行（知らない値・型の違い）は 'invalid' として読み、どの出口にも出さない（rightsModes が × × にする）。

import { all, conditionalBatch, first, nowIso, stmt } from './db';
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

/**
 * 止める / 戻す（§AK-3）。行が無ければ unverified の行（AK-2 の claim と同じ値・claim_at = NULL）を作ってから blocked を更新し、
 * rights_checks に blocked / unblocked の 1 行（1 つの batch）。「戻す」は記録を変えない（blocked だけ）。止めている間も確認は走る
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
      now,
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

/**
 * 最後の失敗（result が verified / human / blocked / unblocked でなく import: でも始まらない最後の行）と、
 * 最後の取り込みの失敗（import: で始まる最後の行のうち、rights_hosted の同じ項目の最新の verified_at より新しいもの。無ければ null）
 */
export async function lastRightsEvents(db: D1Database, key: string): Promise<{ last_fail: RightsEvent | null; last_import_fail: RightsEvent | null }> {
  const fail = await first<RightsEvent>(
    db,
    stmt(
      `SELECT at, result FROM rights_checks WHERE asset_key = ? AND result NOT IN ('verified', 'human', 'blocked', 'unblocked') AND substr(result, 1, 7) <> 'import:'
       ORDER BY id DESC LIMIT 1`,
      key,
    ),
  );
  const imp = await first<RightsEvent>(db, stmt(`SELECT at, result FROM rights_checks WHERE asset_key = ? AND substr(result, 1, 7) = 'import:' ORDER BY id DESC LIMIT 1`, key));
  let lastImportFail: RightsEvent | null = null;
  if (imp) {
    const h = await first<{ v: string | null }>(db, stmt('SELECT MAX(verified_at) AS v FROM rights_hosted WHERE asset_key = ?', key));
    if (!h || h.v === null || String(imp.at) > String(h.v)) lastImportFail = { at: String(imp.at), result: String(imp.result) };
  }
  return { last_fail: fail ? { at: String(fail.at), result: String(fail.result) } : null, last_import_fail: lastImportFail };
}
