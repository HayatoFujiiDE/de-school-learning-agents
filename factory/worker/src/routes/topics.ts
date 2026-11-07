// お題の管理 API（契約 contract-T T-10。Access の保護と Origin の検査は既存の admin API と同じ = src/index.ts）。
// 項目名は docs/plans/topics-variety/api-notes.md。SQL は全部 bind。お題のコードは materials・material_versions・factory_jobs に書かない。

import { all, conditionalBatch, first, getSetting, nowIso, setSetting, stmt, tokyoDay, type SqlValue, type Stmt } from '../db';
import { cfg } from '../env';
import { json, readBody, type RouteCtx } from '../http';
import { monthCostCents } from '../ledger';
import { approvePred, retireParentOnApproveStmts, retireStmt, topicGate } from '../topics/gate';
import { type ReserveOutcome, type RunRequest } from '../topics/gen';
import { queueTopicRun } from '../topics/queue-run';
import {
  TOPIC_DECISION_LABELS,
  TOPIC_FETCH_RESULT_LABELS,
  TOPIC_FLAG_LABELS,
  TOPIC_HEAVY_REASON_LABELS,
  TOPIC_HOLD_REASON_LABELS,
  TOPIC_KIND_LABELS,
  TOPIC_KINDS,
  TOPIC_LOCALE,
  TOPIC_REASON_LABELS,
  TOPIC_STATUS_LABELS,
} from '../topics/locale';
import { scheduleSlots } from '../topics/schedule';
import { addDays, isRealDate, validateTopicBody, type TopicBody } from '../topics/schema';
import {
  insertTopicStmts,
  isTopicKind,
  readRun,
  toRunRow,
  toTopicRow,
  TOPIC_ROW_EXTRA_COLS,
  TOPIC_SLOTS,
  topicsSwitch,
  TRUE_PRED,
  type RunDbRow,
  type TopicDbRow,
} from '../topics/store';

const STATUSES = ['draft', 'checking', 'held', 'ready', 'rejected', 'retired'] as const;
const DECISIONS = ['approve', 'reject', 'retire', 'star', 'unstar', 'recheck'] as const;

const bad = (error: string, extra: Record<string, unknown> = {}) => json(400, { error, ...extra });

async function topicRowById(db: D1Database, id: string): Promise<(TopicDbRow & { latest_approvable: number | null; last_shown_day: string | null }) | null> {
  return first(db, stmt(`SELECT t.*, ${TOPIC_ROW_EXTRA_COLS} FROM topics t WHERE t.id = ?`, tokyoDay(), id));
}

// ---------------------------------------------------------------------------------------------
// GET /api/topics/meta

export async function topicsMeta(c: RouteCtx): Promise<Response> {
  return json(200, {
    enabled: await topicsSwitch(c.env.DB),
    locale: TOPIC_LOCALE,
    kinds: TOPIC_KINDS.map((k) => ({ kind: k, label: TOPIC_KIND_LABELS[k], slots: TOPIC_SLOTS[k] })),
    statuses: TOPIC_STATUS_LABELS,
    hold_reasons: TOPIC_HOLD_REASON_LABELS,
    reasons: TOPIC_REASON_LABELS,
    flags: TOPIC_FLAG_LABELS,
    heavy_reasons: TOPIC_HEAVY_REASON_LABELS,
    fetch_results: TOPIC_FETCH_RESULT_LABELS,
    decisions: TOPIC_DECISION_LABELS,
  });
}

// ---------------------------------------------------------------------------------------------
// GET /api/topics?status=&kind=&limit=&before=

/** 一覧の続き（T-10）: 「作成時刻|id」。並び（created_at の新しい順・同じ時刻は id の大きい順）の最後の行を表す */
export const listCursor = (r: { created_at: string; id: string }): string => `${r.created_at}|${r.id}`;

/** 続きの文字列を解く。形が違えば null（400 bad_query） */
export function parseListCursor(raw: string): { createdAt: string; id: string } | null {
  if (raw.length > 160) return null;
  const i = raw.indexOf('|');
  if (i <= 0) return null;
  const createdAt = raw.slice(0, i);
  const id = raw.slice(i + 1);
  if (Number.isNaN(Date.parse(createdAt)) || !/^tp_[A-Za-z0-9_-]{1,120}$/.test(id)) return null;
  return { createdAt, id };
}

export async function listTopics(c: RouteCtx): Promise<Response> {
  const q = c.url.searchParams;
  const status = q.get('status') || null;
  const kind = q.get('kind') || null;
  const beforeRaw = q.get('before') || null;
  const limitRaw = q.get('limit');
  const limit = limitRaw === null || limitRaw === '' ? 50 : Number(limitRaw);
  if (status !== null && !(STATUSES as readonly string[]).includes(status)) return bad('bad_query');
  if (kind !== null && !isTopicKind(kind)) return bad('bad_query');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return bad('bad_query');
  const before = beforeRaw === null ? null : parseListCursor(beforeRaw);
  if (beforeRaw !== null && !before) return bad('bad_query');
  const rows = await all<TopicDbRow & { latest_approvable: number | null; last_shown_day: string | null }>(
    c.env.DB,
    stmt(
      `SELECT t.*, ${TOPIC_ROW_EXTRA_COLS} FROM topics t
       WHERE (? IS NULL OR t.status = ?) AND (? IS NULL OR t.kind = ?)
         AND (? IS NULL OR t.created_at < ? OR (t.created_at = ? AND t.id < ?))
       ORDER BY t.created_at DESC, t.id DESC LIMIT ?`,
      tokyoDay(),
      status,
      status,
      kind,
      kind,
      before?.createdAt ?? null,
      before?.createdAt ?? null,
      before?.createdAt ?? null,
      before?.id ?? null,
      limit + 1,
    ),
  );
  const page = rows.slice(0, limit);
  return json(200, { topics: page.map(toTopicRow), next_before: rows.length > limit ? listCursor(page[page.length - 1]) : null });
}

// ---------------------------------------------------------------------------------------------
// GET /api/topics/:id

const parse = <T>(s: unknown, fb: T): T => {
  try {
    return typeof s === 'string' ? (JSON.parse(s) as T) : fb;
  } catch {
    return fb;
  }
};

export async function getTopic(c: RouteCtx, id: string): Promise<Response> {
  const db = c.env.DB;
  const r = await topicRowById(db, id);
  if (!r) return json(404, { error: 'not_found' });
  const sources = await all<Record<string, unknown>>(db, stmt('SELECT * FROM topic_sources WHERE topic_id = ? ORDER BY source_id', id));
  const checks = await all<Record<string, unknown>>(db, stmt('SELECT * FROM topic_checks WHERE topic_id = ? ORDER BY attempt DESC', id));
  const decisions = await all<Record<string, unknown>>(db, stmt('SELECT * FROM topic_decisions WHERE topic_id = ? ORDER BY created_at DESC, id DESC', id));
  const lineage = await all<Record<string, unknown>>(
    db,
    stmt('SELECT id, kind, status, depth, title, derive_kind, parent_topic_id, created_at FROM topics WHERE lineage_id = ? ORDER BY depth ASC, created_at ASC, id ASC', r.lineage_id),
  );
  return json(200, {
    topic: {
      ...toTopicRow(r),
      body: parse(r.body_json, null),
      check_round_start: Number(r.check_round_start),
      check_not_before: r.check_not_before,
      recheck_tried_at: r.recheck_tried_at,
      recheck_fail_count: Number(r.recheck_fail_count),
    },
    sources: sources.map((s) => ({
      source_id: s.source_id,
      url: s.url,
      name: s.name,
      quote: s.quote,
      required: Number(s.required) === 1,
      evidence: s.evidence,
      excerpt: s.excerpt,
      fetch_result: s.fetch_result,
      checked_at: s.checked_at,
    })),
    checks: checks.map((k) => ({
      attempt: Number(k.attempt),
      content_sha256: k.content_sha256,
      verdict: k.verdict,
      sources_ok: Number(k.sources_ok) === 1,
      approvable: Number(k.approvable) === 1,
      sensitivity: k.sensitivity,
      reasons: parse(k.reasons_json, []),
      detail: parse(k.detail_json, null),
      created_at: k.created_at,
    })),
    decisions: decisions.map((d) => ({
      id: d.id,
      decision: d.decision,
      by: d.by,
      read_all: Number(d.read_all) === 1,
      content_sha256: d.content_sha256,
      note: d.note,
      created_at: d.created_at,
    })),
    lineage: lineage.map((l) => ({ ...l, depth: Number(l.depth) })),
  });
}

// ---------------------------------------------------------------------------------------------
// POST /api/topics/:id/decide

type Pred = { sql: string; params: SqlValue[] };

function decisionStmt(p: { id: string; decision: string; by: string; readAll: boolean; note: string | null; now: string; pred: Pred }): Stmt {
  return {
    sql: `INSERT INTO topic_decisions (id, topic_id, decision, by, read_all, content_sha256, note, created_at)
SELECT ?, t.id, ?, ?, ?, t.content_sha256, ?, ? FROM topics t WHERE t.id = ? AND ${p.pred.sql}`,
    params: [crypto.randomUUID(), p.decision, p.by, p.readAll ? 1 : 0, p.note, p.now, p.id, ...p.pred.params],
  };
}

export async function decideTopic(c: RouteCtx, id: string): Promise<Response> {
  const db = c.env.DB;
  const b = await readBody(c.request);
  if (!b || !(DECISIONS as readonly unknown[]).includes(b.decision) || typeof b.content_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(b.content_sha256)) return bad('bad_request');
  if (b.note !== undefined && b.note !== null && (typeof b.note !== 'string' || Array.from(b.note).length > 200)) return bad('bad_request', { message: 'note は 200 字まで' });
  if (b.read_all !== undefined && typeof b.read_all !== 'boolean') return bad('bad_request');
  const decision = b.decision as (typeof DECISIONS)[number];
  const sha = b.content_sha256;
  const note = typeof b.note === 'string' && b.note.trim() ? b.note : null;
  const readAll = b.read_all === true;
  const row = await topicRowById(db, id);
  if (!row) return json(404, { error: 'not_found' });
  if (row.content_sha256 !== sha) return json(409, { error: 'sha_mismatch' });
  const now = nowIso();
  const by = c.email || 'unknown';
  let stmts: Stmt[];
  const shaPred = (extra: string): Pred => ({ sql: `t.content_sha256 = ? AND ${extra}`, params: [sha] });

  if (decision === 'approve') {
    if (row.status !== 'held') return json(409, { error: 'state_conflict' });
    if (row.hold_reason !== 'heavy' && row.hold_reason !== 'flagged') return bad('not_approvable');
    if (Number(row.latest_approvable ?? 0) !== 1) return bad('not_approvable');
    if (row.sensitivity === 'heavy' && !readAll) return bad('read_all_required');
    const pred = approvePred({ id, sha, readAll });
    stmts = [
      decisionStmt({ id, decision, by, readAll, note, now, pred }),
      ...retireParentOnApproveStmts({ childId: id, sha, readAll, now, pred }),
      topicGate.approve({ id, sha, readAll, now }),
    ];
  } else if (decision === 'reject') {
    if (row.status !== 'held') return json(409, { error: 'state_conflict' });
    stmts = [
      decisionStmt({ id, decision, by, readAll: false, note, now, pred: shaPred("t.status = 'held'") }),
      stmt(`UPDATE topics SET status = 'rejected', updated_at = ? WHERE id = ? AND status = 'held' AND content_sha256 = ?`, now, id, sha),
    ];
  } else if (decision === 'retire') {
    if (row.status !== 'ready') return json(409, { error: 'state_conflict' });
    stmts = [decisionStmt({ id, decision, by, readAll: false, note, now, pred: shaPred("t.status = 'ready'") }), retireStmt({ id, sha, now })];
  } else if (decision === 'star' || decision === 'unstar') {
    stmts = [
      decisionStmt({ id, decision, by, readAll: false, note, now, pred: shaPred('1 = 1') }),
      stmt(`UPDATE topics SET starred = ?, updated_at = ? WHERE id = ? AND content_sha256 = ?`, decision === 'star' ? 1 : 0, now, id, sha),
    ];
  } else {
    // recheck: held → draft（巡の始まりを今の累計に。出典を全部 pending に戻して開き直す。T-3）
    if (row.status !== 'held') return json(409, { error: 'state_conflict' });
    stmts = [
      {
        sql: `UPDATE topic_sources SET fetch_result = 'pending', evidence = NULL, excerpt = NULL
              WHERE topic_id = ? AND EXISTS (SELECT 1 FROM topics t WHERE t.id = ? AND t.status = 'held' AND t.content_sha256 = ?)`,
        params: [id, id, sha],
      },
      decisionStmt({ id, decision, by, readAll: false, note, now, pred: shaPred("t.status = 'held'") }),
      stmt(
        `UPDATE topics SET status = 'draft', check_round_start = check_attempts, hold_reason = NULL, check_not_before = NULL, updated_at = ?
         WHERE id = ? AND status = 'held' AND content_sha256 = ?`,
        now,
        id,
        sha,
      ),
    ];
  }
  const r = await conditionalBatch(db, stmts);
  if (!r.ok) return json(409, { error: 'state_conflict' });
  console.log(JSON.stringify({ at: 'topic_decide', topic_id: id, decision }));
  const after = await topicRowById(db, id);
  return json(200, { topic: after ? toTopicRow(after) : null });
}

// ---------------------------------------------------------------------------------------------
// run（手動の生成・派生）

function notTakenResponse(o: Extract<ReserveOutcome, { status: 'not_taken' }>): Response {
  const map: Record<string, string> = { disabled: 'disabled', run_in_progress: 'run_in_progress', exists: 'run_in_progress', parent_not_eligible: 'parent_not_eligible', week_cap: 'cap', cap: 'cap' };
  return json(409, { error: map[o.reason] ?? o.reason });
}

/**
 * 手動の run（v2.6）: 同じ要求の中で取り（取れない時は今までどおり 409）、queue へ送って 202 { status: 'queued', run }。
 * 生成と保存は queue の受け手（src/index.ts）が走らせる（ブラウザの接続の寿命に縛られない）。
 * 送れない時（IMAGE_GEN が無い・send が投げる）は run の行と取り置きを取り消して 503 queue_unavailable。
 * 取る・送る・取り消すは src/topics/queue-run.ts の queueTopicRun（運用の依頼箱 §W と共有）
 */
async function queueManualRun(c: RouteCtx, req: RunRequest): Promise<Response> {
  const r = await queueTopicRun(c.env, req);
  if (r.status === 'not_taken') return notTakenResponse(r);
  if (r.status === 'queue_unavailable') return json(503, { error: 'queue_unavailable' });
  const run = await readRun(c.env.DB, r.runId);
  return json(202, { status: 'queued', run: run ? toRunRow(run) : null });
}

export async function deriveTopicRoute(c: RouteCtx, id: string): Promise<Response> {
  const b = await readBody(c.request);
  if (!b || (b.kind !== 'refresh' && b.kind !== 'extend')) return bad('bad_request');
  if (b.note !== undefined && b.note !== null && (typeof b.note !== 'string' || Array.from(b.note).length > 200)) return bad('bad_request', { message: 'note は 200 字まで' });
  const exists = await first(c.env.DB, stmt('SELECT 1 AS x FROM topics WHERE id = ?', id));
  if (!exists) return json(404, { error: 'not_found' });
  const note = typeof b.note === 'string' && b.note.trim() ? b.note : null;
  return queueManualRun(c, { purpose: 'derive', kind: b.kind, trigger: 'manual', parentId: id, note });
}

export async function runTopicsRoute(c: RouteCtx): Promise<Response> {
  const b = await readBody(c.request);
  if (!b || !isTopicKind(b.kind)) return bad('bad_request');
  return queueManualRun(c, { purpose: 'gen', kind: b.kind, trigger: 'manual', slotDay: addDays(tokyoDay(), 1) });
}

export async function listTopicRuns(c: RouteCtx): Promise<Response> {
  const raw = c.url.searchParams.get('limit');
  const limit = raw === null || raw === '' ? 20 : Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return bad('bad_query');
  const rows = await all<RunDbRow>(c.env.DB, stmt('SELECT * FROM topic_runs ORDER BY created_at DESC, id DESC LIMIT ?', limit));
  return json(200, { runs: rows.map(toRunRow) });
}

// ---------------------------------------------------------------------------------------------
// POST /api/topics（手で足す）

export async function createTopic(c: RouteCtx): Promise<Response> {
  const b = await readBody(c.request);
  if (!b || !('body' in b)) return bad('bad_request');
  const slotDay = addDays(tokyoDay(), 1);
  const reasons = validateTopicBody(b.body, { slotDay });
  if (reasons.length) return bad('invalid_body', { reasons });
  const id = `tp_m_${crypto.randomUUID()}`;
  const stmts = await insertTopicStmts(
    { id, body: b.body as TopicBody, origin: 'manual', runId: null, slotDay, lineageId: id, parentId: null, deriveKind: null, depth: 0 },
    nowIso(),
    TRUE_PRED,
  );
  await conditionalBatch(c.env.DB, stmts);
  const row = await topicRowById(c.env.DB, id);
  return json(201, { topic: row ? toTopicRow(row) : null });
}

// ---------------------------------------------------------------------------------------------
// GET /api/topics/schedule?day=

export async function topicSchedule(c: RouteCtx): Promise<Response> {
  const day = c.url.searchParams.get('day') || tokyoDay();
  if (!isRealDate(day)) return bad('bad_day');
  const s = await scheduleSlots(c.env.DB, day);
  const ids = s.slots.map((x) => x.topic_id).filter((x): x is string => !!x);
  const rows = ids.length
    ? await all<TopicDbRow & { latest_approvable: number | null; last_shown_day: string | null }>(
        c.env.DB,
        stmt(`SELECT t.*, ${TOPIC_ROW_EXTRA_COLS} FROM topics t WHERE t.id IN (SELECT value FROM json_each(?))`, tokyoDay(), JSON.stringify(ids)),
      )
    : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  return json(200, {
    day,
    planned: s.planned,
    slots: s.slots.map((x) => ({ kind: x.kind, pos: x.pos, state: x.state, topic: x.topic_id && byId.get(x.topic_id) ? toTopicRow(byId.get(x.topic_id)!) : null })),
  });
}

// ---------------------------------------------------------------------------------------------
// POST /api/topics/settings

export async function topicSettings(c: RouteCtx): Promise<Response> {
  const b = await readBody(c.request);
  if (!b || typeof b.enabled !== 'boolean') return bad('bad_request');
  await setSetting(c.env.DB, 'topics_enabled', b.enabled ? '1' : '0');
  console.log(JSON.stringify({ at: 'topics_settings', enabled: b.enabled }));
  return json(200, { enabled: b.enabled });
}

// ---------------------------------------------------------------------------------------------
// /api/status の topics（T-10）

export async function topicStatusSummary(env: RouteCtx['env']): Promise<Record<string, unknown>> {
  const db = env.DB;
  const last = await first<RunDbRow>(db, stmt("SELECT * FROM topic_runs WHERE status <> 'skipped' ORDER BY created_at DESC, id DESC LIMIT 1"));
  const failed = await first<{ n: number }>(db, stmt("SELECT COUNT(*) AS n FROM topic_runs WHERE status = 'failed' AND updated_at >= ?", new Date(Date.now() - 86_400_000).toISOString()));
  const held = await all<{ hold_reason: string | null; n: number }>(db, stmt("SELECT hold_reason, COUNT(*) AS n FROM topics WHERE status = 'held' GROUP BY hold_reason"));
  const review = { heavy: 0, source: 0, other: 0 };
  for (const h of held) {
    const g = h.hold_reason === 'heavy' ? 'heavy' : h.hold_reason && h.hold_reason.startsWith('source_') ? 'source' : 'other';
    review[g] += Number(h.n);
  }
  const today = tokyoDay();
  const count = async (d: string) => {
    const s = await scheduleSlots(db, d);
    return { empty: s.slots.filter((x) => x.state === 'empty').length, stopped: s.slots.filter((x) => x.state === 'stopped').length };
  };
  return {
    enabled: await topicsSwitch(db),
    last_run: last ? toRunRow(last) : null,
    failed_24h: Number(failed?.n ?? 0),
    needs_review: review,
    month_cents: await monthCostCents(db, 'topic'),
    month_cap_cents: cfg(env).topicMonthlyCapCents,
    today: await count(today),
    tomorrow: await count(addDays(today, 1)),
    over_reserve: Number((await getSetting(db, 'topic_over_reserve')) ?? 0) || 0,
  };
}

