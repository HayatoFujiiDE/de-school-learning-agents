// 自動の処置と公開（契約 V-7。§L-4 に足す）。cron の verify 段の直後に triageStep、その後に autoPublishStep を呼ぶ。
// 確認待ち（review・検証 done・読み手係 done / failed）で未処置の版に triageVersion（契約 V-6）を当て、none / reverify / auto_return を行う。
// どの書き込みも GUARD(vid)（判定に使った verification が今も最新で done）・GUARD_R（読み手係の世代が判定の時と同じ）・
// GUARD_T（確認済みチャンネルの世代 settings trusted_gen が判定の時と同じ）を CAS 条件に入れる。人の reverify・読み直し・チャンネルの追加や削除が
// 先にコミットしていれば 0 行で、次の cron が仕分け直す。gate が pending の版には何も書かない（印を付けると二度と仕分けされない）。
// auto_return は rework job を queued で残すだけで起動しない（次の cron の起動段が拾う）。standards_log には書かない。
// 自動公開は settings auto_publish が '1' で paused でない時だけ、clean の版を publishSwitch（承認の述語に V-7 c の条件を足したもの）で公開する。

import { all, cas, conditionalBatch, first, getSetting, isUniqueViolation, nowIso, stmt } from './db';
import { JOB_MODEL, cfg, type Env } from './env';
import { parseJsonField } from './http';
import { buildReturn, buildReworkBrief, publishSwitch, type ReaderGuard } from './publish';
import { CHECK_KEYS, autoReturnChecklistJson, triageVersion, type TriageOutput, type TriageSource, type TriageVideoMeta } from './checks/triage';
import { readVideoMetaViews, versionVideosOfMaterial } from './videos';

export const AUTO_TRIAGE_EMAIL = 'system:auto-triage';
export const AUTO_PUBLISH_EMAIL = 'system:auto-publish';
/**
 * 契約 V-12 a: 自動の差し戻しの brief に「## 追記」として付けるお願い（職人が質問で止まって人待ちにならないように）。
 * それでも質問が来た時は auto-answer.ts の autoAnswerStep が職人自身の default で答える。人の差し戻しの brief には付けない。
 * 前の brief の ## 追記 として後の作り直し（人の差し戻しを含む）にも残るので、約束の文は「機械の差し戻しの作り直しでは」に限定する
 */
export const AUTO_RETURN_APPEND =
  '（機械の仕分けからのお願い）この差し戻し理由は人ではなく機械の仕分けによるものです。質問（questions）は出さず、迷う点は注文票と差し戻し理由から最も妥当な方を自分で選んで作り、選んだことと理由を selfcheck.md に 1 行で書いてください。機械の差し戻しの作り直しで質問を出した時は、あなたの既定案（default）がそのまま回答として返ります。';
/** 1 回の cron で書き込みが成立する版の数（§L-4・契約 V-7 b） */
export const TRIAGE_BATCH = 3;
/** 1 回の cron で読む（computeTriage を当てる）版の数（契約 V-7 b。busy・stale・pending の版が先頭に居座っても後ろが進む） */
export const TRIAGE_SCAN = 10;
/** 1 回の cron で自動公開を試す版の数（契約 V-7 d） */
export const AUTO_PUBLISH_BATCH = 20;
/** 締め切りの手前で新しい版に手を付けない余白 */
const TRIAGE_DEADLINE_MARGIN_MS = 5_000;
/** 自動の差し戻しをたどる段の上限（契約 V-7 a。AUTO_RETURN_MAX は 5 まで） */
const AUTO_ROUNDS_DEPTH = 10;

/** 機械の承認の checklist（契約 V-7 d: 6 項目すべて {"result":"ok","note":"auto"}） */
export const AUTO_CHECKLIST_JSON = JSON.stringify(Object.fromEntries(CHECK_KEYS.map((k) => [k, { result: 'ok', note: 'auto' }])));

/** triageVersion に要る版の列。reader_* などが無い時は computeTriage が版の行から読む（工場ビューの呼び出し） */
export interface TriageVersionRow {
  id: string;
  material_id: string;
  version: number;
  job_id: string;
  claims_json: string;
  checks_json: string;
  material_json: string;
  auto_reverified: number;
  r2_prefix?: string;
  verification_status?: string;
  evidence_reverified?: number;
  reader_status?: string;
  reader_token?: string | null;
  reader_json?: string | null;
}
/** 処置を書く版の行（判定で読んだ読み手係の世代を持つ） */
export type TriageApplyRow = TriageVersionRow & { reader_status: string; reader_token: string | null };

export interface LatestVerification {
  id: string;
  result_json: string;
}

const GUARD = `status = 'review' AND verification_status = 'done'
  AND (SELECT vw.id FROM verifications vw WHERE vw.material_version_id = material_versions.id ORDER BY vw.attempt DESC LIMIT 1) = ?`;
/** 契約 V-7 b: 読み手係の世代（判定で読んだ reader_status と reader_token） */
const GUARD_R = `reader_status = ? AND COALESCE(reader_token, '') = ?`;
/** 契約 V-7 b: 確認済みチャンネルの世代（判定で読んだ settings trusted_gen） */
const GUARD_T = `COALESCE((SELECT value FROM settings WHERE key = 'trusted_gen'), '0') = ?`;

export const latestVerificationOf = (db: D1Database, vid: string) =>
  first<LatestVerification>(db, stmt('SELECT id, result_json FROM verifications WHERE material_version_id = ? ORDER BY attempt DESC LIMIT 1', vid));

/** この版の job が自動差し戻しで作られた = job.parent_version_id の版に system:auto-triage の return がある（工場ビューが使う） */
export async function isAutoDerived(db: D1Database, jobId: string): Promise<boolean> {
  const r = await first(
    db,
    stmt(
      `SELECT 1 AS x FROM factory_jobs j JOIN review_decisions d ON d.material_version_id = j.parent_version_id
       WHERE j.id = ? AND j.parent_version_id IS NOT NULL AND d.decision = 'return' AND d.reviewer_email = ?`,
      jobId,
      AUTO_TRIAGE_EMAIL,
    ),
  );
  return !!r;
}

/**
 * 続けて行った自動の差し戻しの数（契約 V-7 a）: 版の job から parent_version_id をたどり、親の版に system:auto-triage の return があれば 1 増やして
 * その親の版の job へ進む。親が無い・親の差し戻しが人のもの、で止まる。10 段まで
 */
export async function autoRoundsOf(db: D1Database, jobId: string): Promise<number> {
  let n = 0;
  let job = jobId;
  for (let i = 0; i < AUTO_ROUNDS_DEPTH; i++) {
    const r = await first<{ parent: string | null; auto: number; parent_job: string | null }>(
      db,
      stmt(
        `SELECT j.parent_version_id AS parent,
                EXISTS (SELECT 1 FROM review_decisions d WHERE d.material_version_id = j.parent_version_id AND d.decision = 'return' AND d.reviewer_email = ?) AS auto,
                (SELECT pv.job_id FROM material_versions pv WHERE pv.id = j.parent_version_id) AS parent_job
         FROM factory_jobs j WHERE j.id = ?`,
        AUTO_TRIAGE_EMAIL,
        job,
      ),
    );
    if (!r || !r.parent || !Number(r.auto) || !r.parent_job) break;
    n++;
    job = r.parent_job;
  }
  return n;
}

export interface TriageContext {
  /** 呼び出し側が読んだ版の動画の公式の情報（確認画面は同じリクエストで 1 回だけ読む。契約 V-8） */
  videoMeta?: TriageVideoMeta[];
}

/** 版と最新 verification から仕分けを計算する（確認画面・一覧・承認・cron・工場ビューが同じものを使う。契約 V-7 b） */
export async function computeTriage(env: Env, v: TriageVersionRow, latest: LatestVerification | null, ctx: TriageContext = {}): Promise<TriageOutput> {
  const db = env.DB;
  // 確認済みチャンネルの世代を先に読む（後から足された・外されたチャンネルを古い世代で書かない。GUARD_T）
  const trustedGen = (await getSetting(db, 'trusted_gen')) ?? '0';
  const needRow =
    v.reader_status === undefined || v.reader_token === undefined || v.reader_json === undefined || v.verification_status === undefined || v.evidence_reverified === undefined || v.r2_prefix === undefined;
  const extra = needRow
    ? await first<{ r2_prefix: string; verification_status: string; evidence_reverified: number; reader_status: string; reader_token: string | null; reader_json: string | null }>(
        db,
        stmt('SELECT r2_prefix, verification_status, evidence_reverified, reader_status, reader_token, reader_json FROM material_versions WHERE id = ?', v.id),
      )
    : null;
  const row = {
    r2_prefix: v.r2_prefix ?? extra?.r2_prefix ?? '',
    verification_status: v.verification_status ?? extra?.verification_status ?? 'pending',
    evidence_reverified: v.evidence_reverified ?? extra?.evidence_reverified ?? 0,
    reader_status: v.reader_status ?? extra?.reader_status ?? 'pending',
    reader_token: v.reader_token !== undefined ? v.reader_token : (extra?.reader_token ?? null),
    reader_json: v.reader_json !== undefined ? v.reader_json : (extra?.reader_json ?? null),
  };
  const sources = await all<TriageSource>(
    db,
    stmt('SELECT source_id, url, license, is_primary, url_was_fetched, quote_found FROM sources WHERE material_version_id = ? ORDER BY rowid', v.id),
  );
  const material = parseJsonField<unknown>(v.material_json, null);
  // R2（動画の公式の情報）と trusted_channels を読むのは動画のある版だけ（契約 V-8）
  const videos = versionVideosOfMaterial(material);
  let videoMeta: TriageVideoMeta[] = [];
  let trusted: string[] = [];
  if (videos.length > 0) {
    if (ctx.videoMeta) videoMeta = ctx.videoMeta;
    else {
      try {
        videoMeta = await readVideoMetaViews(env.R2, row.r2_prefix, videos);
      } catch {
        videoMeta = [];
      }
    }
    trusted = (await all<{ channel_key: string }>(db, stmt('SELECT channel_key FROM trusted_channels'))).map((r) => r.channel_key);
  }
  return triageVersion({
    claims: parseJsonField<unknown>(v.claims_json, null),
    report: latest ? { id: latest.id, result: parseJsonField<unknown>(latest.result_json, null) } : null,
    sources: sources.map((s) => ({ ...s, url_was_fetched: Number(s.url_was_fetched), quote_found: Number(s.quote_found), is_primary: Number(s.is_primary ?? 0) })),
    checks: parseJsonField<unknown>(v.checks_json, null),
    material,
    autoReverified: Number(v.auto_reverified ?? 0),
    reader: { status: row.reader_status, token: row.reader_token, result: row.reader_json ? parseJsonField<unknown>(row.reader_json, null) : null },
    videoMeta,
    trustedChannels: trusted,
    trustedGen,
    autoRounds: await autoRoundsOf(db, v.job_id),
    autoReturnMax: env.AUTO_RETURN_MAX,
    verificationStatus: row.verification_status,
    evidenceReverified: Number(row.evidence_reverified ?? 0),
  });
}

export type TriageApplied = 'none' | 'reverify' | 'auto_return' | 'stale' | 'busy' | 'pending';

/**
 * 計算済みの仕分けを処置する（契約 V-7 b）。gate が pending なら何も書かない（'pending'）。
 * 0 行（判定後に世代が変わった）は 'stale'、active job の部分 UNIQUE に当たれば 'busy'
 */
export async function applyTriage(env: Env, v: TriageApplyRow, t: TriageOutput): Promise<TriageApplied> {
  const db = env.DB;
  const vid = t.verification_id;
  if (t.gate === 'pending') return 'pending';
  if (!vid) return 'stale';
  const g: ReaderGuard = { status: v.reader_status, token: v.reader_token ?? null };
  const guards = [vid, g.status, g.token ?? '', t.trusted_gen];
  if (t.action === 'none') {
    const ok = await cas(
      db,
      stmt(
        `UPDATE material_versions SET triaged_verification_id = ?, triage_v = 2, triage_gate = ? WHERE id = ? AND ${GUARD} AND ${GUARD_R} AND ${GUARD_T}`,
        vid,
        t.gate,
        v.id,
        ...guards,
      ),
    );
    return ok ? 'none' : 'stale';
  }
  if (t.action === 'reverify') {
    // max_uses は変えない（§R-49 (f)）。limit は auto_reverified、evidence（古い入力の検証）は evidence_reverified を立てる（どちらも版ごとに 1 回）
    const flag = t.reverify_kind === 'evidence' ? 'evidence_reverified' : 'auto_reverified';
    const ok = await cas(
      db,
      stmt(
        `UPDATE material_versions SET verification_status = 'pending', verification_attempts = 0, verification_token = NULL,
           verify_phase = NULL, verify_phase_at = NULL, verify_batch_id = NULL, verify_turn = 0, verify_pauses = 0, verify_micro = 0, verify_collect_errors = 0,
           ${flag} = 1, triaged_verification_id = NULL
         WHERE id = ? AND ${GUARD} AND ${flag} = 0 AND ${GUARD_R} AND ${GUARD_T}`,
        v.id,
        ...guards,
      ),
    );
    return ok ? 'reverify' : 'stale';
  }
  // auto_return
  const note = t.return_note ?? '';
  const orig = await first<{ brief_md: string }>(db, stmt('SELECT brief_md FROM factory_jobs WHERE id = ?', v.job_id));
  const newJobId = crypto.randomUUID();
  try {
    const r = await conditionalBatch(
      db,
      buildReturn(
        {
          material_id: v.material_id,
          version_id: v.id,
          reviewer_email: AUTO_TRIAGE_EMAIL,
          checklist_json: autoReturnChecklistJson(t.items), // §S v2 B 7: 改善係へ観点と原因の列挙だけを渡す
          note,
          new_job_id: newJobId,
          // お願い文は前の brief の ## 追記 として引き継がれるので、まだ無い時だけ足す（自動の差し戻しが続いても 1 回だけ）
          rework_brief_md: buildReworkBrief(orig?.brief_md, v.version, note, orig?.brief_md?.includes(AUTO_RETURN_APPEND) ? '' : AUTO_RETURN_APPEND),
          rework_model: JOB_MODEL.rework,
          rework_budget_cents: cfg(env).budgetReworkCents,
          machine_gate: t.gate,
        },
        { decision_id: crypto.randomUUID(), now: nowIso(), log_id: crypto.randomUUID() },
        { skipStandardsLog: true, guardVerificationId: vid, guardReader: g, guardTrustedGen: t.trusted_gen },
      ),
    );
    return r.ok ? 'auto_return' : 'stale';
  } catch (e) {
    if (isUniqueViolation(e)) return 'busy';
    throw e;
  }
}

const ROW_COLS = `v.id, v.material_id, v.version, v.job_id, v.claims_json, v.checks_json, v.material_json, v.auto_reverified, v.r2_prefix,
  v.verification_status, v.evidence_reverified, v.reader_status, v.reader_token, v.reader_json,
  lv.id AS lv_id, lv.result_json AS lv_result_json`;
const LATEST_JOIN = `JOIN verifications lv ON lv.id = (SELECT w.id FROM verifications w WHERE w.material_version_id = v.id ORDER BY w.attempt DESC LIMIT 1)`;

/** cron の契約 V-7 b。古い順に最大 10 件を読み、書き込みが成立した版が 3 件になったら止める。戻り値は版ごとの結果（ログ用） */
export async function triageStep(env: Env, opts: { deadline: number }): Promise<string[]> {
  const db = env.DB;
  const rows = await all<TriageApplyRow & { lv_id: string; lv_result_json: string }>(
    db,
    stmt(
      `SELECT ${ROW_COLS}
       FROM material_versions v
       ${LATEST_JOIN}
       WHERE v.status = 'review' AND v.verification_status = 'done' AND v.reader_status IN ('done','failed')
         AND NOT EXISTS (SELECT 1 FROM review_decisions d WHERE d.material_version_id = v.id)
         AND (v.triaged_verification_id IS NULL OR v.triaged_verification_id <> lv.id OR v.triage_v < 2)
       ORDER BY v.created_at ASC, v.id ASC LIMIT ?`,
      TRIAGE_SCAN,
    ),
  );
  const out: string[] = [];
  let written = 0;
  for (const row of rows) {
    if (Date.now() > opts.deadline - TRIAGE_DEADLINE_MARGIN_MS) {
      out.push('skipped_time');
      break;
    }
    const t = await computeTriage(env, row, { id: row.lv_id, result_json: row.lv_result_json });
    const r = await applyTriage(env, row, t);
    console.log(JSON.stringify(r === 'pending' ? { at: 'triage', version_id: row.id, result: 'pending', pending_on: t.pending_on } : { at: 'triage', version_id: row.id, action: t.action, gate: t.gate, result: r }));
    out.push(r);
    if (r === 'none' || r === 'reverify' || r === 'auto_return') {
      written++;
      if (written >= TRIAGE_BATCH) break;
    }
  }
  return out;
}

/** 自動公開（契約 V-7 d）。settings auto_publish が '1' で paused が '1' でない時だけ。戻り値は版ごとの結果（ログ用） */
export async function autoPublishStep(env: Env, opts: { deadline: number }): Promise<string[]> {
  const db = env.DB;
  if ((await getSetting(db, 'auto_publish')) !== '1') return [];
  if ((await getSetting(db, 'paused')) === '1') return ['paused'];
  const rows = await all<TriageApplyRow & { lv_id: string; lv_result_json: string }>(
    db,
    stmt(
      `SELECT ${ROW_COLS}
       FROM material_versions v
       ${LATEST_JOIN}
       WHERE v.status = 'review' AND v.verification_status = 'done' AND v.reader_status = 'done' AND v.triage_v = 2 AND v.triage_gate = 'clean'
         AND v.triaged_verification_id = lv.id
         AND NOT EXISTS (SELECT 1 FROM review_decisions d WHERE d.material_version_id = v.id)
       ORDER BY v.created_at ASC, v.id ASC LIMIT ?`,
      AUTO_PUBLISH_BATCH,
    ),
  );
  const out: string[] = [];
  for (const row of rows) {
    if (Date.now() > opts.deadline - TRIAGE_DEADLINE_MARGIN_MS) {
      out.push('skipped_time');
      break;
    }
    const t = await computeTriage(env, row, { id: row.lv_id, result_json: row.lv_result_json });
    let result: string;
    if (t.gate === 'clean' && t.action === 'none') {
      const r = await publishSwitch(
        db,
        {
          kind: 'approve',
          material_id: row.material_id,
          version_id: row.id,
          verification_id: row.lv_id,
          reviewer_email: AUTO_PUBLISH_EMAIL,
          checklist_json: AUTO_CHECKLIST_JSON,
          note: null,
          machine_gate: 'clean',
          reader_guard: { status: row.reader_status, token: row.reader_token ?? null },
          trusted_keys: t.trusted_keys,
          require_auto_publish: true,
        },
        { decision_id: crypto.randomUUID(), now: nowIso() },
      );
      // 0 行（世代が変わった・素材に active な job がある・スイッチが切られた・チャンネルが外された）は何もしない。次の cron でまた見る
      result = r.ok ? 'published' : 'skipped';
    } else if (t.gate === 'pending') {
      result = 'pending';
    } else if (t.gate !== 'clean') {
      const ok = await cas(
        db,
        stmt(
          `UPDATE material_versions SET triage_gate = ? WHERE id = ? AND ${GUARD} AND ${GUARD_R} AND ${GUARD_T}`,
          t.gate,
          row.id,
          row.lv_id,
          row.reader_status,
          row.reader_token ?? '',
          t.trusted_gen,
        ),
      );
      result = ok ? 'regated' : 'stale';
    } else {
      result = 'not_ready';
    }
    console.log(JSON.stringify({ at: 'auto_publish', version_id: row.id, result }));
    out.push(result);
  }
  return out;
}
