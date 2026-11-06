// お題の表の読み書きの部品（契約 contract-T T-2・T-6）。SQL は全部 bind。値を文字列の連結で SQL に入れない。
// ここで組み立てる SQL の断片（取り置きの述語・run の述語・検査の述語）は定数だけで、外から来た値は必ず ? で渡す。

import { all, first, stmt, type SqlValue, type Stmt } from '../db';
import { cfg, type Env } from '../env';
import { dailyReservedSql } from '../verify';
import { TOPIC_KINDS, type TopicKind } from './locale';
import { addDays, normalizeTitle, requiredSourceIds, sha256Hex, type TopicBody } from './schema';

// ---------------------------------------------------------------------------------------------
// 定数（T-4・T-5・T-8・T-9。var では変えない）

/** news の 1 run の最大本数 */
export const TOPIC_NEWS_PER_RUN = 2;
/** talk・philo・make の週 1 回の run の最大本数 */
export const TOPIC_WEEKLY_PER_RUN = 3;
/** 生成・派生の呼び出しの絶対の締め切りの上限（cron の締め切りと早い方） */
export const TOPIC_GEN_TIMEOUT_MS = 150_000;
/** 検査の呼び出しの絶対の締め切りの上限 */
export const TOPIC_CHECK_TIMEOUT_MS = 60_000;
export const TOPIC_CHECK_PER_TICK = 3;
export const TOPIC_REFRESH_DAYS = 180;
export const TOPIC_GEN_MAX_TOKENS = 8000;
export const TOPIC_CHECK_MAX_TOKENS = 2000;
export const TOPIC_WEB_SEARCH_MAX_USES = 5;
export const TOPIC_WEB_FETCH_MAX_USES = 8;
export const TOPIC_WEB_FETCH_MAX_CONTENT_TOKENS = 6000;
/** 1 日の枠（T-8） */
export const TOPIC_SLOTS: Record<TopicKind, number> = { news: 2, talk: 1, philo: 1, make: 3 };
/** run の lease（T-7: 15 分）・検査の lease（T-5: 10 分）・429 などの後の待ち（T-6: 6 時間） */
export const RUN_LEASE_MS = 15 * 60_000;
export const CHECK_LEASE_MS = 10 * 60_000;
export const CHECK_BACKOFF_MS = 6 * 3600_000;
/** 派生の深さの上限（depth < 5 の親だけ。子は最大 5） */
export const TOPIC_MAX_DEPTH = 5;
/** 見直し（T-8）: 1 tick の最大本数・開けない回数がこれに達したら held */
export const RECHECK_PER_TICK = 5;
export const RECHECK_FAIL_LIMIT = 4;

export const isTopicKind = (v: unknown): v is TopicKind => typeof v === 'string' && (TOPIC_KINDS as readonly string[]).includes(v);

// ---------------------------------------------------------------------------------------------
// 日付（Asia/Tokyo）

export const tokyoHour = (d: Date = new Date()): number => new Date(d.getTime() + 9 * 3600_000).getUTCHours();
export const tokyoWeekdayOf = (d: Date = new Date()): number => new Date(d.getTime() + 9 * 3600_000).getUTCDay();
/** その日（YYYY-MM-DD）を含む週の月曜（月曜始まり） */
export function mondayOf(day: string): string {
  const wd = new Date(`${day}T00:00:00Z`).getUTCDay();
  return addDays(day, -((wd + 6) % 7));
}
/** Asia/Tokyo の日付 day の 0 時の UTC の ISO */
export const tokyoDayStartIso = (day: string): string => new Date(Date.parse(`${day}T00:00:00Z`) - 9 * 3600_000).toISOString();

// ---------------------------------------------------------------------------------------------
// settings

export const TOPICS_ENABLED_KEY = 'topics_enabled';
export const TOPIC_OVER_RESERVE_KEY = 'topic_over_reserve';
export const TOPIC_RECHECK_WEEK_KEY = 'topic_recheck_week';

/** 入・切が入 かつ 一時停止でない（SQL の述語。T-4・T-6） */
export const ENABLED_SQL = `COALESCE((SELECT value FROM settings WHERE key = 'topics_enabled'), '0') = '1'
  AND COALESCE((SELECT value FROM settings WHERE key = 'paused'), '0') <> '1'`;

export async function topicsEnabled(db: D1Database): Promise<boolean> {
  const r = await first<{ flag: number }>(db, stmt(`SELECT CASE WHEN ${ENABLED_SQL} THEN 1 ELSE 0 END AS flag`));
  return Number(r?.flag ?? 0) === 1;
}

/** 入・切の値だけ（一時停止は見ない） */
export async function topicsSwitch(db: D1Database): Promise<boolean> {
  const r = await first<{ value: string }>(db, stmt("SELECT value FROM settings WHERE key = 'topics_enabled'"));
  return r?.value === '1';
}

// ---------------------------------------------------------------------------------------------
// 台帳（T-6）

export const genLedgerRef = (runId: string): string => `tp:${runId}:gen`;

/**
 * 取り置きの INSERT の前半（T-6 の述語）。refExpr は ref_id を作る SQL 式（? を含んでよい。refParams で渡す）。
 * 後ろに extra の述語（AND で続く）を足して 1 文にする。満たさなければ 0 行。
 */
function reserveSql(refExpr: string, extra: string): string {
  return `INSERT INTO cost_ledger (id, day, kind, ref_id, cents, created_at)
SELECT ?, ?, 'topic', ${refExpr}, ?, ?
WHERE NOT EXISTS (SELECT 1 FROM cost_ledger WHERE kind = 'topic' AND ref_id = ${refExpr})
  AND (SELECT COALESCE(SUM(cents), 0) FROM cost_ledger WHERE kind = 'topic' AND substr(day, 1, 7) = ?) + ? <= ?
  AND (SELECT COALESCE(SUM(cents), 0) FROM cost_ledger WHERE kind = 'topic' AND day = ?) + ? <= ?
  AND (DAILY_RESERVED) + ? <= ?
  AND ${ENABLED_SQL}
  AND ${extra}`;
}

interface ReserveArgs {
  env: Env;
  ledgerId: string;
  /** Asia/Tokyo の日付（台帳の day・日と月の合計に使う） */
  day: string;
  cents: number;
  now: string;
}

function reserveParams(a: ReserveArgs, refParams: SqlValue[]): { pre: SqlValue[]; daily: { sql: string; params: SqlValue[] } } {
  const c = cfg(a.env);
  const daily = dailyReservedSql(a.day, c.verifyTurnReserveCents);
  return {
    pre: [a.ledgerId, a.day, ...refParams, a.cents, a.now, ...refParams, a.day.slice(0, 7), a.cents, c.topicMonthlyCapCents, a.day, a.cents, c.topicDailyCapCents],
    daily,
  };
}

function finishReserve(sql: string, a: ReserveArgs, refParams: SqlValue[], extraParams: SqlValue[]): Stmt {
  const c = cfg(a.env);
  const { pre, daily } = reserveParams(a, refParams);
  return { sql: sql.replace('DAILY_RESERVED', daily.sql), params: [...pre, ...daily.params, a.cents, c.dailyCapCents, ...extraParams] };
}

const GEN_EXTRA = `NOT EXISTS (SELECT 1 FROM topic_runs WHERE purpose = 'gen' AND kind = ? AND status = 'calling')
  AND (? = 'manual' OR NOT EXISTS (SELECT 1 FROM topic_runs WHERE purpose = 'gen' AND trigger = 'cron' AND kind = ? AND slot_day = ?))`;

/** 生成の run を取る 1 文目（T-4）: 取り置き + 同じ用途・種類の calling が無い + cron は同じ一意キーの run が無い */
export function genReserveStmt(a: ReserveArgs & { runId: string; kind: TopicKind; trigger: 'cron' | 'manual'; slotDay: string }): Stmt {
  return finishReserve(reserveSql('?', GEN_EXTRA), a, [genLedgerRef(a.runId)], [a.kind, a.trigger, a.kind, a.slotDay]);
}

const DERIVE_EXTRA = `NOT EXISTS (SELECT 1 FROM topic_runs WHERE purpose = 'derive' AND kind = ? AND status = 'calling')
  AND (? = 'manual' OR NOT EXISTS (SELECT 1 FROM topic_runs WHERE purpose = 'derive' AND trigger = 'cron' AND parent_topic_id = ? AND kind = ? AND slot_day = ?))
  AND (? = 'manual' OR (SELECT COUNT(*) FROM topic_runs WHERE purpose = 'derive' AND trigger = 'cron' AND week = ?) < ?)
  AND EXISTS (SELECT 1 FROM topics p WHERE p.id = ? AND p.depth < 5 AND (
        (? = 'refresh' AND (p.status = 'ready' OR (p.status = 'held' AND p.hold_reason IN ('source_lost','source_unreachable')))
           AND NOT EXISTS (SELECT 1 FROM topics c WHERE c.parent_topic_id = p.id AND c.derive_kind = 'refresh' AND c.status IN ('draft','checking','held','ready')))
     OR (? = 'extend' AND p.status = 'ready' AND (SELECT COUNT(*) FROM topics c WHERE c.parent_topic_id = p.id AND c.derive_kind = 'extend') < 2)))`;

/** 派生の run を取る 1 文目（T-4・T-9）: 取り置き + 親の条件・子の数・週の上限 + calling の排他 + cron の一意 */
export function deriveReserveStmt(
  a: ReserveArgs & { runId: string; kind: 'refresh' | 'extend'; trigger: 'cron' | 'manual'; slotDay: string; week: string; parentId: string },
): Stmt {
  const perWeek = cfg(a.env).topicDerivePerWeek;
  return finishReserve(reserveSql('?', DERIVE_EXTRA), a, [genLedgerRef(a.runId)], [
    a.kind,
    a.trigger,
    a.parentId,
    a.kind,
    a.slotDay,
    a.trigger,
    a.week,
    perWeek,
    a.parentId,
    a.kind,
    a.kind,
  ]);
}

const CHECK_REF_EXPR = `('tp:' || ? || ':chk:' || (SELECT check_attempts + 1 FROM topics WHERE id = ?))`;
const CHECK_EXTRA = `EXISTS (SELECT 1 FROM topics WHERE id = ? AND status = 'draft' AND check_attempts - check_round_start < ? AND (check_not_before IS NULL OR check_not_before <= ?))`;

/** 検査を取る 1 文目（T-5「取る」の 1）。ref_id = 'tp:<topic_id>:chk:<check_attempts + 1>' を SQL の中で作る */
export function checkReserveStmt(a: ReserveArgs & { topicId: string }): Stmt {
  return finishReserve(reserveSql(CHECK_REF_EXPR, CHECK_EXTRA), a, [a.topicId, a.topicId], [a.topicId, cfg(a.env).topicCheckMaxAttempts, a.now]);
}

/** 検査を取る 2 文目（T-5「取る」の 2）: draft → checking。1 文目の行（加算する前の check_attempts + 1 のキー）がある時だけ */
export function checkClaimStmt(p: { topicId: string; token: string; leaseUntil: string; now: string }): Stmt {
  return stmt(
    `UPDATE topics SET status = 'checking', check_attempts = check_attempts + 1, check_token = ?, check_lease_until = ?, updated_at = ?
     WHERE id = ? AND status = 'draft'
       AND EXISTS (SELECT 1 FROM cost_ledger WHERE kind = 'topic' AND ref_id = 'tp:' || topics.id || ':chk:' || (topics.check_attempts + 1))`,
    p.token,
    p.leaseUntil,
    p.now,
    p.topicId,
  );
}

export const checkLedgerRef = (topicId: string, attempt: number): string => `tp:${topicId}:chk:${attempt}`;

// ---------------------------------------------------------------------------------------------
// 述語

/** run の述語（T-4 の保存の batch: 全部の文がこれを持つ） */
export function runPred(runId: string, token: string, now: string): { sql: string; params: SqlValue[] } {
  return { sql: `EXISTS (SELECT 1 FROM topic_runs WHERE id = ? AND status = 'calling' AND token = ? AND lease_until > ?)`, params: [runId, token, now] };
}

/** 検査の述語 P（T-5 の 4: お題が checking AND check_attempts = A AND check_token = K AND check_lease_until > 今） */
export function checkPred(topicId: string, attempt: number, token: string, now: string): { sql: string; params: SqlValue[] } {
  return {
    sql: `EXISTS (SELECT 1 FROM topics WHERE id = ? AND status = 'checking' AND check_attempts = ? AND check_token = ? AND check_lease_until > ?)`,
    params: [topicId, attempt, token, now],
  };
}

/** Q（T-5 の 4: この batch の topic_checks が書けた印） */
export function doneQ(topicId: string, attempt: number, token: string): { sql: string; params: SqlValue[] } {
  return { sql: `EXISTS (SELECT 1 FROM topic_checks WHERE topic_id = ? AND attempt = ? AND done_token = ?)`, params: [topicId, attempt, token] };
}

/**
 * 取った run の取り消し（v2.4 の裁定 7。取った後、外部を 1 回も呼ぶ前に時間が足りなくなった時）。
 * 取り置きの台帳の行と run の行を同じ batch で削除する（述語は run の calling と token）。最後の文の changes で成否。その日の枠を消費しない
 */
export function runCancelStmts(runId: string, token: string): Stmt[] {
  return [
    {
      sql: `DELETE FROM cost_ledger WHERE kind = 'topic' AND ref_id = ? AND EXISTS (SELECT 1 FROM topic_runs WHERE id = ? AND status = 'calling' AND token = ?)`,
      params: [genLedgerRef(runId), runId, token],
    },
    { sql: `DELETE FROM topic_runs WHERE id = ? AND status = 'calling' AND token = ?`, params: [runId, token] },
  ];
}

/**
 * 取った検査の取り消し（v2.4 の裁定 7。出典を開いた後、外部を呼ぶ前に時間が足りなくなった時）。
 * 取り置きの台帳の行を削除し、お題を draft に戻して check_attempts を 1 減らす（巡の回数を消費しない）。同じ batch・述語は checking と token
 */
export function checkCancelStmts(topicId: string, attempt: number, token: string, now: string): Stmt[] {
  return [
    {
      sql: `DELETE FROM cost_ledger WHERE kind = 'topic' AND ref_id = ? AND EXISTS (SELECT 1 FROM topics WHERE id = ? AND status = 'checking' AND check_token = ?)`,
      params: [checkLedgerRef(topicId, attempt), topicId, token],
    },
    {
      sql: `UPDATE topics SET status = 'draft', check_attempts = check_attempts - 1, check_token = NULL, check_lease_until = NULL, updated_at = ? WHERE id = ? AND status = 'checking' AND check_token = ?`,
      params: [now, topicId, token],
    },
  ];
}

/** 確定（T-6）: 実額と取り置き額の小さい方。述語が偽なら 0 行（取り置き額のまま） */
export function ledgerSettleStmt(ref: string, actualCents: number, pred: { sql: string; params: SqlValue[] }): Stmt {
  return { sql: `UPDATE cost_ledger SET cents = MIN(?, cents) WHERE kind = 'topic' AND ref_id = ? AND ${pred.sql}`, params: [Math.max(0, Math.ceil(actualCents)), ref, ...pred.params] };
}

/** 実額が取り置き額を超えた時だけ settings.topic_over_reserve を 1 増やす（確定の文より前に置く） */
export function overReserveStmt(ref: string, actualCents: number, now: string, pred: { sql: string; params: SqlValue[] }): Stmt {
  return {
    sql: `INSERT INTO settings (key, value, updated_at)
SELECT 'topic_over_reserve', '1', ? WHERE ${pred.sql} AND ? > (SELECT cents FROM cost_ledger WHERE kind = 'topic' AND ref_id = ?)
ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(settings.value AS INTEGER) + 1 AS TEXT), updated_at = excluded.updated_at`,
    params: [now, ...pred.params, Math.max(0, Math.ceil(actualCents)), ref],
  };
}

// ---------------------------------------------------------------------------------------------
// お題の INSERT（T-3「（なし）→ draft」: お題と topic_sources の全行を同じ batch で）

export interface NewTopic {
  id: string;
  body: TopicBody;
  origin: 'gen' | 'derive' | 'manual';
  runId: string | null;
  slotDay: string;
  lineageId: string;
  parentId: string | null;
  deriveKind: 'refresh' | 'extend' | null;
  depth: number;
  /** 生成の応答の web_fetch の結果で見つかった出典（T-4）。source_id → 抜き書き */
  genFound?: Map<string, string>;
}

/** お題 1 本の INSERT 群（お題 → 出典の順）。pred は全部の文に付ける述語（手で足す時は TRUE） */
export async function insertTopicStmts(t: NewTopic, now: string, pred: { sql: string; params: SqlValue[] }): Promise<Stmt[]> {
  const bodyJson = JSON.stringify(t.body);
  const sha = await sha256Hex(bodyJson);
  const news = t.body.kind === 'news';
  const out: Stmt[] = [
    {
      sql: `INSERT INTO topics (id, kind, status, sensitivity, origin, run_id, slot_day, lineage_id, parent_topic_id, derive_kind, depth, title, title_norm, body_json, content_sha256, evergreen, fresh_until, starred, check_attempts, check_round_start, created_at, updated_at)
SELECT ?, ?, 'draft', 'normal', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ? WHERE ${pred.sql}`,
      params: [
        t.id,
        t.body.kind,
        t.origin,
        t.runId,
        t.slotDay,
        t.lineageId,
        t.parentId,
        t.deriveKind,
        t.depth,
        t.body.title.s,
        normalizeTitle(t.body.title.s),
        bodyJson,
        sha,
        news ? 0 : 1,
        news ? addDays(t.slotDay, 6) : null,
        now,
        now,
        ...pred.params,
      ],
    },
  ];
  const required = requiredSourceIds(t.body);
  for (const s of t.body.sources) {
    const ex = t.genFound?.get(s.id) ?? null;
    out.push({
      sql: `INSERT INTO topic_sources (topic_id, source_id, url, name, quote, required, evidence, excerpt, fetch_result, checked_at)
SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${pred.sql}`,
      params: [t.id, s.id, s.url, s.name, s.quote, required.has(s.id) ? 1 : 0, ex ? 'gen_fetch' : null, ex, ex ? 'found' : 'pending', ex ? now : null, ...pred.params],
    });
  }
  return out;
}

export const TRUE_PRED = { sql: '1 = 1', params: [] as SqlValue[] };

// ---------------------------------------------------------------------------------------------
// 行の読み出しと API の形（api-notes.md の TopicRow / RunRow）

export interface TopicDbRow {
  id: string;
  kind: TopicKind;
  status: string;
  sensitivity: 'normal' | 'heavy';
  origin: string;
  run_id: string | null;
  slot_day: string;
  lineage_id: string;
  parent_topic_id: string | null;
  derive_kind: 'refresh' | 'extend' | null;
  depth: number;
  title: string;
  title_norm: string;
  body_json: string;
  content_sha256: string;
  evergreen: number;
  fresh_until: string | null;
  starred: number;
  check_attempts: number;
  check_round_start: number;
  check_token: string | null;
  check_lease_until: string | null;
  check_not_before: string | null;
  hold_reason: string | null;
  last_checked_at: string | null;
  recheck_tried_at: string | null;
  recheck_fail_count: number;
  created_at: string;
  updated_at: string;
}

export async function readTopic(db: D1Database, id: string): Promise<TopicDbRow | null> {
  return first<TopicDbRow>(db, stmt('SELECT * FROM topics WHERE id = ?', id));
}

export const HOLD_GROUP: Record<string, 'heavy' | 'flagged' | 'source' | 'other'> = {
  heavy: 'heavy',
  flagged: 'flagged',
  source_not_found: 'source',
  source_unreachable: 'source',
  source_unsupported: 'source',
  source_lost: 'source',
  schema: 'other',
  forbidden: 'other',
  check_failed: 'other',
  duplicate_race: 'other',
};

/** 一覧・詳細の行に付ける「承認できるか」（最新の検査が同じ sha で approvable = 1）と「最後に出した日」を読む SQL の列 */
export const TOPIC_ROW_EXTRA_COLS = `(SELECT c.approvable FROM topic_checks c WHERE c.topic_id = t.id AND c.attempt = t.check_attempts AND c.content_sha256 = t.content_sha256) AS latest_approvable,
  (SELECT MAX(s.day) FROM topic_schedule s WHERE s.topic_id = t.id AND s.day <= ?) AS last_shown_day,
  (SELECT c.id FROM topics c WHERE c.parent_topic_id = t.id AND c.derive_kind = 'refresh' AND c.status IN ('draft','checking','held','ready')) AS refresh_child_id,
  (SELECT c.status FROM topics c WHERE c.parent_topic_id = t.id AND c.derive_kind = 'refresh' AND c.status IN ('draft','checking','held','ready')) AS refresh_child_status`;

export function toTopicRow(
  r: TopicDbRow & { latest_approvable?: number | null; last_shown_day?: string | null; refresh_child_id?: string | null; refresh_child_status?: string | null },
): Record<string, unknown> {
  const held = r.status === 'held';
  const approvable = held && (r.hold_reason === 'heavy' || r.hold_reason === 'flagged') && Number(r.latest_approvable ?? 0) === 1;
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    sensitivity: r.sensitivity,
    origin: r.origin,
    hold_reason: held ? r.hold_reason : null,
    hold_group: held && r.hold_reason ? (HOLD_GROUP[r.hold_reason] ?? 'other') : null,
    approvable,
    needs_read_all: r.sensitivity === 'heavy',
    title: r.title,
    slot_day: r.slot_day,
    lineage_id: r.lineage_id,
    parent_topic_id: r.parent_topic_id,
    derive_kind: r.derive_kind,
    depth: Number(r.depth),
    starred: Number(r.starred) === 1,
    evergreen: Number(r.evergreen) === 1,
    fresh_until: r.fresh_until,
    check_attempts: Number(r.check_attempts),
    last_checked_at: r.last_checked_at,
    last_shown_day: r.last_shown_day ?? null,
    // 終わっていない見直しの子（1 つの親に 1 つまで。索引 uq_topics_live_refresh）。あれば次の見直しは作れない（T-9）
    refresh_child: r.refresh_child_id ? { id: r.refresh_child_id, status: r.refresh_child_status ?? null } : null,
    content_sha256: r.content_sha256,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export interface RunDbRow {
  id: string;
  purpose: 'gen' | 'derive';
  kind: string;
  slot_day: string;
  week: string | null;
  parent_topic_id: string | null;
  trigger: 'cron' | 'manual';
  status: 'calling' | 'done' | 'failed' | 'skipped';
  error: string | null;
  dropped: number;
  made: number;
  cents: number;
  token: string;
  lease_until: string;
  created_at: string;
  updated_at: string;
}

export function toRunRow(r: RunDbRow): Record<string, unknown> {
  return {
    id: r.id,
    purpose: r.purpose,
    kind: r.kind,
    slot_day: r.slot_day,
    week: r.week,
    parent_topic_id: r.parent_topic_id,
    trigger: r.trigger,
    status: r.status,
    error: r.error,
    dropped: Number(r.dropped),
    made: Number(r.made),
    cents: Number(r.cents),
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export async function readRun(db: D1Database, id: string): Promise<RunDbRow | null> {
  return first<RunDbRow>(db, stmt('SELECT * FROM topic_runs WHERE id = ?', id));
}

/** 同じ種類（複数可）の ready・held・checking・draft の題を新しい順に最大 n 件（T-4 の入力） */
export async function existingTitles(db: D1Database, kinds: readonly TopicKind[], n = 60): Promise<string[]> {
  const rows = await all<{ title: string }>(
    db,
    stmt(
      `SELECT title FROM topics WHERE status IN ('ready','held','checking','draft') AND kind IN (SELECT value FROM json_each(?)) ORDER BY created_at DESC LIMIT ?`,
      JSON.stringify(kinds),
      n,
    ),
  );
  return rows.map((r) => r.title);
}
