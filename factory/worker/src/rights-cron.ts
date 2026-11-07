// 権利の確認の自動（契約 §AK-6。cron の段 3-d）。一覧の項目を少しずつ確かめ直す: 1 回の cron で 5 件まで・1 件ずつ runRightsCheck。
// 対象の選び方は純関数 rightsCandidates（最後の試行の古い順 / 指紋違いは 1 時間・失敗は 1 日空ける / claim 中は飛ばす / 台帳に無い提供元は飛ばす）。

import { all, getSetting, stmt } from './db';
import type { Env } from './env';
import { MODELS3D, type Model3dEntry } from './generated/models3d-catalog';
import { assetKey, subjectShasOf, type RightsRecord } from './rights';
import { runRightsCheck } from './rights-check';
import { providerOf } from './rights-providers';
import { NEVER_ATTEMPTED, rightsRecordOf } from './rights-store';

const DAY_MS = 86_400_000;
const CLAIM_TTL_MS = 10 * 60_000;
const RECHECK_AFTER_MS = 30 * DAY_MS;
/** 指紋違い (b) の取り直しの間隔（v3.1・B4） */
const SUBJECT_RETRY_MS = 60 * 60_000;
export const RIGHTS_PER_CRON = 5;
/**
 * 1 件を始める前に、締め切りまでこれだけ残っていなければ残りは次回（v3.1: 1 件の最悪 150 s + 後続の会議・振り返りの 180 s）
 */
export const RIGHTS_ITEM_MARGIN_MS = 330_000;

export interface RightsCronRow {
  record: RightsRecord | 'invalid';
  claim_at: string | null;
  last_attempt_at: string | null;
}

/** 時刻の文字列が now − ms より前か（読めない時刻は「前」= 対象にする） */
const olderThan = (iso: string | null, now: Date, ms: number): boolean => {
  if (iso === null) return true;
  const t = Date.parse(iso);
  return !Number.isFinite(t) || t < now.getTime() - ms;
};

/**
 * 対象（AK-6 v3.2）: providerOf(e) が unsupported でないもので、(a) 行が無い / (u) last_attempt_at が未試行（1970。止める・戻すで作る）/
 * (b) 行の subject_sha256 が今の指紋と違い、かつ last_attempt_at が 1 時間より前 /
 * (c) status が verified / human で checked_at が 30 日より前 かつ last_attempt_at が 1 日より前 /
 * (d) status が stale / unverified / mismatch で last_attempt_at が 1 日より前。claim_at が 10 分以内なら対象外。blocked は飛ばさない。
 * 不正な行（'invalid'）は (d) と同じく last_attempt_at が 1 日より前の時だけ（判断: 毎回の取り直しで枠を占めない）。
 * 並び（v3.2・B4）: last_attempt_at の古い順の 1 本（行なしは最古。同じなら一覧の順）。(a)(b) を優先しない =
 * 失敗したばかりの項目は後ろに回る（指紋違いの行は門番が既に出口を閉じているので、確認が遅れても権利の穴にはならない）。
 * 件数は切らない（呼び出し側が 5 件まで）。指紋は失敗の時に更新しない（古い権利の記録を新しい対象に戻さないため）
 */
export function rightsCandidates(entries: readonly Model3dEntry[], rows: ReadonlyMap<string, RightsCronRow>, subjects: ReadonlyMap<string, string>, now: Date): Model3dEntry[] {
  const due: Array<{ e: Model3dEntry; at: number; i: number }> = [];
  entries.forEach((e, i) => {
    if (providerOf(e).kind === 'unsupported') return;
    const key = assetKey('models3d', e.id);
    const row = rows.get(key);
    if (!row) {
      due.push({ e, at: Number.NEGATIVE_INFINITY, i });
      return;
    }
    if (row.claim_at !== null && !olderThan(row.claim_at, now, CLAIM_TTL_MS)) return;
    const at = row.last_attempt_at === null ? Number.NEGATIVE_INFINITY : Date.parse(row.last_attempt_at);
    const item = { e, at: Number.isFinite(at) ? at : Number.NEGATIVE_INFINITY, i };
    if (row.last_attempt_at === NEVER_ATTEMPTED) {
      due.push(item);
      return;
    }
    const r = row.record;
    if (r === 'invalid') {
      if (olderThan(row.last_attempt_at, now, DAY_MS)) due.push(item);
      return;
    }
    if (r.subject_sha256 !== subjects.get(key)) {
      if (olderThan(r.last_attempt_at, now, SUBJECT_RETRY_MS)) due.push(item);
      return;
    }
    if (r.status === 'verified' || r.status === 'human') {
      if (olderThan(r.checked_at, now, RECHECK_AFTER_MS) && olderThan(r.last_attempt_at, now, DAY_MS)) due.push(item);
      return;
    }
    if (olderThan(r.last_attempt_at, now, DAY_MS)) due.push(item);
  });
  due.sort((a, b) => (a.at === b.at ? a.i - b.i : a.at < b.at ? -1 : 1));
  return due.map((x) => x.e);
}

/** rights_records の全行を cron 用に読む（記録・claim_at・last_attempt_at） */
export async function rightsCronRows(db: D1Database): Promise<Map<string, RightsCronRow>> {
  const rows = await all<Record<string, unknown>>(db, stmt('SELECT * FROM rights_records ORDER BY asset_key LIMIT 1000'));
  const out = new Map<string, RightsCronRow>();
  for (const r of rows) {
    if (typeof r.asset_key !== 'string') continue;
    out.set(r.asset_key, {
      record: rightsRecordOf(r),
      claim_at: typeof r.claim_at === 'string' ? r.claim_at : null,
      last_attempt_at: typeof r.last_attempt_at === 'string' ? r.last_attempt_at : null,
    });
  }
  return out;
}

export interface RightsStepResult {
  checked: number;
  verified: number;
  human: number;
  failed: number;
  skipped: number;
  lost: number;
  imported: number;
}

/**
 * cron の段（3-d）。paused なら 'paused'。対象を 5 件まで、1 件ずつ runRightsCheck(env, e, 'cron')。
 * 1 件を始める前に deadline − 330 s を過ぎていたら残りは次回（後続の段の時間を残す）。1 件の例外は failed に数えて次へ（ログは runRightsCheck が 1 行出す）
 */
export async function rightsStep(env: Pick<Env, 'DB' | 'R2'>, o: { deadline: number; fetchImpl?: typeof fetch; now?: Date; catalog?: readonly Model3dEntry[] }): Promise<RightsStepResult | 'paused'> {
  if ((await getSetting(env.DB, 'paused')) === '1') return 'paused';
  const catalog = o.catalog ?? MODELS3D;
  const out: RightsStepResult = { checked: 0, verified: 0, human: 0, failed: 0, skipped: 0, lost: 0, imported: 0 };
  const list = rightsCandidates(catalog, await rightsCronRows(env.DB), await subjectShasOf(catalog), o.now ?? new Date()).slice(0, RIGHTS_PER_CRON);
  for (const e of list) {
    if (Date.now() > o.deadline - RIGHTS_ITEM_MARGIN_MS) break;
    out.checked++;
    try {
      const r = await runRightsCheck(env, e, 'cron', o.fetchImpl ?? fetch);
      if (r.kind === 'verified') {
        out.verified++;
        if (r.import && r.import.ok) out.imported++;
      } else if (r.kind === 'human') out.human++;
      else if (r.kind === 'failed') out.failed++;
      else if (r.kind === 'skipped') out.skipped++;
      else out.lost++;
    } catch {
      out.failed++;
    }
  }
  return out;
}
