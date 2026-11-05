// 確かめる（検査。契約 contract-T T-5・T-3・T-7）と、lease 切れの片付け・ストックの見直し（T-8）。
// 検査 1 本: 取る（取り置き + draft → checking を 1 つの条件付き batch）→ 1 形と言葉（費用なし）→ 2 出典を開く（費用なし）
//           → 3 支えているか・重いか（呼び出し 1 回・ツールなし・再送なし・絶対の締め切り）→ 4 判定（judgeCheck）と書き込み（文の順番を固定した 1 つの batch）。
// lease を失った検査・遅れて届いた古い attempt の完了は、どの文も述語 P が偽になり 1 行も書かない。

import type { Message, MessageCreateParamsNonStreaming, Tool } from '@anthropic-ai/sdk/resources/messages/messages';
import type { CallOpts, FactoryPort } from '../anthropic';
import { all, cas, conditionalBatch, getSetting, isUniqueViolation, nowIso, prepare, stmt, tokyoDay, type Stmt } from '../db';
import { cfg, type Env } from '../env';
import { microToCents, sonnetMicroDollars } from '../ledger';
import { fetchSource } from './fetch-source';
import { retireParentOnAutoStmts, topicGate } from './gate';
import { classifyCallError } from './gen';
import { hasForbidden, judgeCheck, parseCheckOutput, type CheckOutput, type Judgement, type SourceFetch } from './judge';
import { checkSystem, checkUserBlocks, SAVE_CHECK_SCHEMA, SAVE_CHECK_TOOL_NAME } from './prompts';
import { requiredSourceIds, titleJaccard, validateTopicBody, type TopicBody } from './schema';
import {
  CHECK_BACKOFF_MS,
  CHECK_LEASE_MS,
  checkClaimStmt,
  checkLedgerRef,
  checkPred,
  checkReserveStmt,
  doneQ,
  ledgerSettleStmt,
  mondayOf,
  overReserveStmt,
  readTopic,
  RECHECK_FAIL_LIMIT,
  RECHECK_PER_TICK,
  TOPIC_CHECK_MAX_TOKENS,
  TOPIC_CHECK_TIMEOUT_MS,
  TOPIC_RECHECK_WEEK_KEY,
  tokyoDayStartIso,
  type TopicDbRow,
} from './store';

export interface CheckOptions {
  deadline: number;
  fetchImpl: typeof fetch;
  now?: Date;
}

export type CheckStatus = 'not_taken' | 'ready' | 'held' | 'rejected' | 'draft' | 'lost' | 'left';

export interface CheckResult {
  status: CheckStatus;
  /** 失敗の時の理由コード（rate_limited / server / unusable_output / timeout など） */
  error?: string;
  attempt?: number;
}

interface SourceRow {
  topic_id: string;
  source_id: string;
  url: string;
  name: string;
  quote: string;
  required: number;
  evidence: 'gen_fetch' | 'worker_fetch' | null;
  excerpt: string | null;
  fetch_result: SourceFetch;
  checked_at: string | null;
}

/** 取れる検査の対象（古い順。check_not_before を過ぎたもの） */
export async function dueCheckIds(env: Env, limit: number, now: string): Promise<string[]> {
  const rows = await all<{ id: string }>(
    env.DB,
    stmt(
      `SELECT id FROM topics WHERE status = 'draft' AND check_attempts - check_round_start < ? AND (check_not_before IS NULL OR check_not_before <= ?)
       ORDER BY created_at ASC, id ASC LIMIT ?`,
      cfg(env).topicCheckMaxAttempts,
      now,
      limit,
    ),
  );
  return rows.map((r) => r.id);
}

/** 検査の失敗・lease 切れの後の状態を 1 文で決める（T-3）。where は「どの行か」の条件（述語の列を含む） */
const FAIL_SET = `status = CASE WHEN check_attempts - check_round_start >= ? THEN 'held' ELSE 'draft' END,
  hold_reason = CASE WHEN check_attempts - check_round_start >= ? THEN 'check_failed' ELSE NULL END,
  check_token = NULL, check_lease_until = NULL`;

function failStmt(p: { id: string; attempt: number; token: string; now: string; max: number; notBefore: string | null }): Stmt {
  return stmt(
    `UPDATE topics SET ${FAIL_SET}, check_not_before = ?, updated_at = ?
     WHERE id = ? AND status = 'checking' AND check_attempts = ? AND check_token = ? AND check_lease_until > ?`,
    p.max,
    p.max,
    p.notBefore,
    p.now,
    p.id,
    p.attempt,
    p.token,
    p.now,
  );
}

/** lease 切れの片付け（T-3・T-7。残り時間に関係なく毎 tick 行う）。run は failed: abandoned（台帳は取り置き額のまま）、検査は T-3 の 1 文 */
export async function cleanupLeases(env: Env, now: string): Promise<{ runs: number; checks: number }> {
  const max = cfg(env).topicCheckMaxAttempts;
  const res = await env.DB.batch([
    prepare(
      env.DB,
      stmt(
        `UPDATE topic_runs SET status = 'failed', error = 'abandoned', cents = COALESCE((SELECT cents FROM cost_ledger WHERE kind = 'topic' AND ref_id = 'tp:' || topic_runs.id || ':gen'), 0), updated_at = ?
         WHERE status = 'calling' AND lease_until <= ?`,
        now,
        now,
      ),
    ),
    prepare(env.DB, stmt(`UPDATE topics SET ${FAIL_SET}, updated_at = ? WHERE status = 'checking' AND check_lease_until <= ?`, max, max, now, now)),
  ]);
  return { runs: Number(res[0]?.meta?.changes ?? 0), checks: Number(res[1]?.meta?.changes ?? 0) };
}

/** 重複（T-5 の 1）: 自分以外の、同じ種類の ready・held・checking と title_norm が一致、または 2-gram の Jaccard が 0.6 以上。派生の子は親を除く */
export async function findDuplicate(db: D1Database, row: Pick<TopicDbRow, 'id' | 'kind' | 'title_norm' | 'parent_topic_id'>): Promise<string | null> {
  const others = await all<{ id: string; title_norm: string }>(
    db,
    stmt(
      `SELECT id, title_norm FROM topics WHERE id <> ? AND kind = ? AND status IN ('ready','held','checking') AND (? IS NULL OR id <> ?) ORDER BY id`,
      row.id,
      row.kind,
      row.parent_topic_id,
      row.parent_topic_id,
    ),
  );
  for (const o of others) if (o.title_norm === row.title_norm || titleJaccard(o.title_norm, row.title_norm) >= 0.6) return o.id;
  return null;
}

/** 検査 1 本（cron の段 (3) と、テストが呼ぶ） */
export async function checkTopic(env: Env, port: FactoryPort, topicId: string, opts: CheckOptions): Promise<CheckResult> {
  const db = env.DB;
  const c = cfg(env);
  const nowD = opts.now ?? new Date();
  const t0 = nowIso(nowD);
  const token = crypto.randomUUID();
  let taken = false;
  try {
    taken = (
      await conditionalBatch(db, [
        checkReserveStmt({ env, ledgerId: crypto.randomUUID(), day: tokyoDay(nowD), cents: c.topicCheckReserveCents, now: t0, topicId }),
        checkClaimStmt({ topicId, token, leaseUntil: new Date(nowD.getTime() + CHECK_LEASE_MS).toISOString(), now: t0 }),
      ])
    ).ok;
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    taken = false;
  }
  if (!taken) return { status: 'not_taken' };

  const row = await readTopic(db, topicId);
  if (!row || row.check_token !== token) return { status: 'lost' };
  const A = Number(row.check_attempts);
  const ref = checkLedgerRef(topicId, A);
  const body = JSON.parse(row.body_json) as TopicBody;
  const sources = await all<SourceRow>(db, stmt('SELECT * FROM topic_sources WHERE topic_id = ? ORDER BY source_id', topicId));
  const log = (status: string, extra: Record<string, unknown> = {}) => console.log(JSON.stringify({ at: 'topic_check', topic_id: topicId, attempt: A, status, ...extra }));

  // 1. 形と言葉（費用なし）
  const dup = await findDuplicate(db, row);
  if (dup) {
    const out = await writeDuplicate(env, row, token, dup);
    log(out.status);
    return { ...out, attempt: A };
  }
  const schemaBad = validateTopicBody(body, { slotDay: row.slot_day }).length > 0 || hasForbidden(body);
  if (schemaBad) {
    const j = judgeCheck(body, sources, null, row.sensitivity, { slotDay: row.slot_day });
    const out = await writeJudgement(env, row, token, j, sources, null, null);
    log(out.status, { reasons: j.reasons.length });
    return { ...out, attempt: A };
  }

  // 2. 出典を開く（費用なし。pending だけ。1 本のお題の出典を並行で）
  const fetchDeadline = Math.min(opts.deadline, Date.now() + 20_000);
  const updated: SourceRow[] = await Promise.all(
    sources.map(async (s) => {
      if (s.fetch_result !== 'pending') return s;
      const r = await fetchSource(s.url, s.quote, { fetchImpl: opts.fetchImpl, deadline: fetchDeadline });
      return { ...s, fetch_result: r.result, evidence: r.result === 'found' ? 'worker_fetch' : null, excerpt: r.excerpt, checked_at: nowIso() };
    }),
  );

  // 3. 支えているか・重いか（呼び出し 1 回）
  const found = updated.filter((s) => s.fetch_result === 'found' && s.excerpt);
  const passedIds = found.map((s) => s.source_id);
  const params: MessageCreateParamsNonStreaming = {
    model: c.topicCheckModel,
    max_tokens: TOPIC_CHECK_MAX_TOKENS,
    system: checkSystem(),
    messages: [{ role: 'user', content: checkUserBlocks(body, found.map((s) => ({ source_id: s.source_id, excerpt: s.excerpt as string }))) }],
    tools: [
      {
        name: SAVE_CHECK_TOOL_NAME,
        description:
          '確かめた結果を保存します。最後に 1 回だけ呼びます。sources には、渡された抜き書きの出典だけを 1 回ずつ入れます（抜き書きの無い出典は入れません）。',
        input_schema: SAVE_CHECK_SCHEMA as unknown as Tool['input_schema'],
        strict: true,
      },
    ],
    // 強制呼び出し（tool_choice tool）は Sonnet 5.5 で 400 になるので auto + strict（CONTRACT-factory §T 末尾）。save_check が無ければ「応答が使えない」
    tool_choice: { type: 'auto' },
  };
  const callOpts: CallOpts = { deadline: Math.min(opts.deadline, Date.now() + TOPIC_CHECK_TIMEOUT_MS), maxTimeoutMs: TOPIC_CHECK_TIMEOUT_MS, maxRetries: 0 };
  let msg: Message;
  try {
    msg = await port.createMessage(params, callOpts);
  } catch (e) {
    const k = classifyCallError(e);
    if (!k.responded) {
      // 時間切れ・接続断: 結果が分からないので何も書かない。lease 切れ（10 分）で T-3 の 1 文（台帳は取り置き額のまま。T-7）
      log('left', { error: k.code });
      return { status: 'left', error: k.code, attempt: A };
    }
    // 429・quota・4xx は台帳 0、5xx・overloaded は取り置き額のまま。どちらも T-3 の 1 文 + check_not_before（T-6・T-7）
    const t = nowIso();
    const P = checkPred(topicId, A, token, t);
    const stmts: Stmt[] = [];
    if (k.noCharge) stmts.push(ledgerSettleStmt(ref, 0, P));
    stmts.push(failStmt({ id: topicId, attempt: A, token, now: t, max: c.topicCheckMaxAttempts, notBefore: new Date(Date.now() + CHECK_BACKOFF_MS).toISOString() }));
    const r = await conditionalBatch(db, stmts);
    const after = await readTopic(db, topicId);
    log(r.ok ? String(after?.status) : 'lost', { error: k.code });
    return { status: r.ok ? ((after?.status as CheckStatus) ?? 'draft') : 'lost', error: k.code, attempt: A };
  }
  const actual = microToCents(sonnetMicroDollars(msg.usage));
  const toolUse = msg.content.find((b) => b.type === 'tool_use' && b.name === SAVE_CHECK_TOOL_NAME) as { input?: unknown } | undefined;
  const out = toolUse ? parseCheckOutput(toolUse.input, passedIds) : null;
  if (!out) {
    // 応答が使えない（save_check が無い・形が違う・id の過不足）: 台帳は確定額、T-3 の 1 文（check_not_before なし）
    const t = nowIso();
    const P = checkPred(topicId, A, token, t);
    const r = await conditionalBatch(db, [
      overReserveStmt(ref, actual, t, P),
      ledgerSettleStmt(ref, actual, P),
      failStmt({ id: topicId, attempt: A, token, now: t, max: c.topicCheckMaxAttempts, notBefore: null }),
    ]);
    const after = await readTopic(db, topicId);
    log(r.ok ? String(after?.status) : 'lost', { error: 'unusable_output' });
    return { status: r.ok ? ((after?.status as CheckStatus) ?? 'draft') : 'lost', error: 'unusable_output', attempt: A };
  }

  // 4. 判定と書き込み
  const j = judgeCheck(body, updated, out, row.sensitivity, { slotDay: row.slot_day });
  const res = await writeJudgement(env, row, token, j, updated, out, actual);
  log(res.status, { verdict: j.verdict, reasons: j.reasons.length });
  return { ...res, attempt: A };
}

/** 重複: rejected: duplicate（取り置きは 0。検査の記録は red・理由 duplicate） */
async function writeDuplicate(env: Env, row: TopicDbRow, token: string, dupOf: string): Promise<{ status: CheckStatus }> {
  const t = nowIso();
  const A = Number(row.check_attempts);
  const P = checkPred(row.id, A, token, t);
  const r = await conditionalBatch(env.DB, [
    {
      sql: `INSERT INTO topic_checks (topic_id, attempt, content_sha256, verdict, sources_ok, approvable, done_token, sensitivity, reasons_json, detail_json, created_at)
SELECT ?, ?, ?, 'red', 0, 0, ?, ?, ?, ?, ? WHERE ${P.sql}`,
      params: [row.id, A, row.content_sha256, token, row.sensitivity, JSON.stringify(['duplicate']), JSON.stringify({ duplicate_of: dupOf }), t, ...P.params],
    },
    ledgerSettleStmt(checkLedgerRef(row.id, A), 0, P),
    stmt(
      `UPDATE topics SET status = 'rejected', hold_reason = 'duplicate', check_token = NULL, check_lease_until = NULL, updated_at = ?
       WHERE id = ? AND status = 'checking' AND check_attempts = ? AND check_token = ? AND check_lease_until > ?`,
      t,
      row.id,
      A,
      token,
      t,
    ),
  ]);
  return { status: r.ok ? 'rejected' : 'lost' };
}

/**
 * 判定の書き込み（T-5 の 4。文の順番を固定する）。actual = null は呼び出しをしなかった（形・禁止語で赤。台帳は 0）。
 * 1. P を条件に: 検査の記録 / 出典の更新 / 重ければ heavy / 台帳の確定（と取り置き超過の数）/ 必須の出典が全部 found なら last_checked_at
 * 2. 状態の文（緑で重くなければ topicGate.auto、それ以外は held）
 * 3. 2 が gate の時だけ受け皿（held: duplicate_race）
 * 4. 決定の記録（Q）
 * 5. 見直しの子が ready になった時の親の引退（Q）
 */
export async function writeJudgement(
  env: Env,
  row: TopicDbRow,
  token: string,
  j: Judgement,
  sources: readonly SourceRow[],
  out: CheckOutput | null,
  actual: number | null,
  nowOverride?: string,
): Promise<{ status: CheckStatus }> {
  const t = nowOverride ?? nowIso();
  const A = Number(row.check_attempts);
  const id = row.id;
  const P = checkPred(id, A, token, t);
  const Q = doneQ(id, A, token);
  const ref = checkLedgerRef(id, A);
  const rowWhere = `WHERE id = ? AND status = 'checking' AND check_attempts = ? AND check_token = ? AND check_lease_until > ?`;
  const rowParams = [id, A, token, t];
  const detail = {
    sources: sources.map((s) => ({ source_id: s.source_id, required: Number(s.required) === 1, fetch_result: s.fetch_result, evidence: s.evidence })),
    model: out,
    hold_reason: j.holdReason,
  };
  const stmts: Stmt[] = [
    {
      sql: `INSERT INTO topic_checks (topic_id, attempt, content_sha256, verdict, sources_ok, approvable, done_token, sensitivity, reasons_json, detail_json, created_at)
SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${P.sql}`,
      params: [id, A, row.content_sha256, j.verdict, j.sourcesOk ? 1 : 0, j.approvable ? 1 : 0, token, j.sensitivity, JSON.stringify(j.reasons), JSON.stringify(detail), t, ...P.params],
    },
  ];
  for (const s of sources) {
    stmts.push({
      sql: `UPDATE topic_sources SET fetch_result = ?, evidence = ?, excerpt = ?, checked_at = ? WHERE topic_id = ? AND source_id = ? AND ${P.sql}`,
      params: [s.fetch_result, s.evidence, s.excerpt, s.checked_at, id, s.source_id, ...P.params],
    });
  }
  if (j.sensitivity === 'heavy' && row.sensitivity !== 'heavy') stmts.push({ sql: `UPDATE topics SET sensitivity = 'heavy', updated_at = ? ${rowWhere}`, params: [t, ...rowParams] });
  if (actual === null) stmts.push(ledgerSettleStmt(ref, 0, P));
  else stmts.push(overReserveStmt(ref, actual, t, P), ledgerSettleStmt(ref, actual, P));
  const required = requiredSourceIds(JSON.parse(row.body_json) as TopicBody);
  const allFound = [...required].every((rid) => sources.some((s) => s.source_id === rid && s.fetch_result === 'found'));
  if (allFound && required.size > 0) stmts.push({ sql: `UPDATE topics SET last_checked_at = ? ${rowWhere}`, params: [t, ...rowParams] });

  const gate = j.verdict === 'green' && j.sensitivity === 'normal';
  if (gate) {
    stmts.push(topicGate.auto({ id, token, now: t }));
    stmts.push({ sql: `UPDATE topics SET status = 'held', hold_reason = 'duplicate_race', check_token = NULL, check_lease_until = NULL, updated_at = ? ${rowWhere}`, params: [t, ...rowParams] });
  } else {
    stmts.push({ sql: `UPDATE topics SET status = 'held', hold_reason = ?, check_token = NULL, check_lease_until = NULL, updated_at = ? ${rowWhere}`, params: [j.holdReason ?? 'check_failed', t, ...rowParams] });
  }
  stmts.push({
    sql: `INSERT OR IGNORE INTO topic_decisions (id, topic_id, decision, by, read_all, content_sha256, note, created_at)
SELECT 'td:' || t.id || ':' || ?, t.id, CASE WHEN t.status = 'ready' THEN 'auto_ready' ELSE 'auto_hold' END, 'machine', 0, t.content_sha256, NULL, ?
FROM topics t WHERE t.id = ? AND t.check_attempts = ? AND t.status IN ('ready','held') AND ${Q.sql}`,
    params: [A, t, id, A, ...Q.params],
  });
  stmts.push(...retireParentOnAutoStmts({ childId: id, attempt: A, now: t, q: Q }));
  const res = await env.DB.batch(stmts.map((s) => prepare(env.DB, s)));
  if (Number(res[0]?.meta?.changes ?? 0) === 0) return { status: 'lost' };
  const after = await readTopic(env.DB, id);
  return { status: (after?.status as CheckStatus) ?? 'lost' };
}

// ---------------------------------------------------------------------------------------------
// ストックの見直し（T-8。費用なし・呼び出しなし）

/** 見直しの週を今週の月曜へ進める（古い日付へは戻さない: 今の値より大きい時だけ進める） */
export async function advanceRecheckWeek(db: D1Database, monday: string): Promise<boolean> {
  return cas(
    db,
    stmt(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at WHERE settings.value < excluded.value`,
      TOPIC_RECHECK_WEEK_KEY,
      monday,
      nowIso(),
    ),
  );
}

export interface RecheckResult {
  tried: number;
  ok: number;
  lost: number;
  failed: number;
  unreachable: number;
}

/** 見直し 1 tick（最大 5 本。1 本 30 秒の残りが無ければやめる） */
export async function stockRecheckStep(env: Env, opts: { deadline: number; fetchImpl: typeof fetch; now?: Date }): Promise<RecheckResult> {
  const db = env.DB;
  const nowD = opts.now ?? new Date();
  const monday = mondayOf(tokyoDay(nowD));
  await advanceRecheckWeek(db, monday);
  const out: RecheckResult = { tried: 0, ok: 0, lost: 0, failed: 0, unreachable: 0 };
  if ((await getSetting(db, TOPIC_RECHECK_WEEK_KEY)) !== monday) return out;
  const targets = await all<TopicDbRow>(
    db,
    stmt(
      `SELECT * FROM topics WHERE evergreen = 1 AND status = 'ready' AND (recheck_tried_at IS NULL OR recheck_tried_at < ?)
       ORDER BY (recheck_tried_at IS NOT NULL), recheck_tried_at ASC, id ASC LIMIT ?`,
      tokyoDayStartIso(monday),
      RECHECK_PER_TICK,
    ),
  );
  for (const t of targets) {
    if (opts.deadline - Date.now() < 30_000) break;
    out.tried++;
    const req = await all<{ source_id: string; url: string; quote: string }>(db, stmt('SELECT source_id, url, quote FROM topic_sources WHERE topic_id = ? AND required = 1 ORDER BY source_id', t.id));
    const fetchDeadline = Math.min(opts.deadline, Date.now() + 20_000);
    const results = await Promise.all(req.map(async (s) => ({ s, r: await fetchSource(s.url, s.quote, { fetchImpl: opts.fetchImpl, deadline: fetchDeadline }) })));
    const now = nowIso();
    const lostOnes = results.filter((x) => x.r.result === 'not_found');
    const failedOnes = results.filter((x) => x.r.result === 'fetch_failed' || x.r.result === 'blocked');
    const readyPred = `EXISTS (SELECT 1 FROM topics WHERE id = ? AND status = 'ready')`;
    if (lostOnes.length > 0) {
      // ready → held（source_lost）。人が承認済みの重い話題でも同じ（承認の記録は残るが、配信は止まる）
      const stmts: Stmt[] = lostOnes.map((x) => ({
        sql: `UPDATE topic_sources SET fetch_result = 'not_found', evidence = NULL, excerpt = NULL, checked_at = ? WHERE topic_id = ? AND source_id = ? AND ${readyPred}`,
        params: [now, t.id, x.s.source_id, t.id],
      }));
      stmts.push({
        sql: `INSERT INTO topic_decisions (id, topic_id, decision, by, read_all, content_sha256, note, created_at)
SELECT ?, id, 'auto_hold', 'machine', 0, content_sha256, 'source_lost', ? FROM topics WHERE id = ? AND status = 'ready'`,
        params: [crypto.randomUUID(), now, t.id],
      });
      stmts.push(stmt(`UPDATE topics SET status = 'held', hold_reason = 'source_lost', recheck_tried_at = ?, updated_at = ? WHERE id = ? AND status = 'ready'`, now, now, t.id));
      if ((await conditionalBatch(db, stmts)).ok) out.lost++;
    } else if (failedOnes.length > 0) {
      const n = Number(t.recheck_fail_count) + 1;
      if (n >= RECHECK_FAIL_LIMIT) {
        const r = await conditionalBatch(db, [
          {
            sql: `INSERT INTO topic_decisions (id, topic_id, decision, by, read_all, content_sha256, note, created_at)
SELECT ?, id, 'auto_hold', 'machine', 0, content_sha256, 'source_unreachable', ? FROM topics WHERE id = ? AND status = 'ready' AND recheck_fail_count = ?`,
            params: [crypto.randomUUID(), now, t.id, Number(t.recheck_fail_count)],
          },
          stmt(
            `UPDATE topics SET status = 'held', hold_reason = 'source_unreachable', recheck_tried_at = ?, recheck_fail_count = ?, updated_at = ? WHERE id = ? AND status = 'ready' AND recheck_fail_count = ?`,
            now,
            n,
            now,
            t.id,
            Number(t.recheck_fail_count),
          ),
        ]);
        if (r.ok) out.unreachable++;
      } else {
        await cas(db, stmt('UPDATE topics SET recheck_tried_at = ?, recheck_fail_count = ?, updated_at = ? WHERE id = ? AND status = ? AND recheck_fail_count = ?', now, n, now, t.id, 'ready', Number(t.recheck_fail_count)));
        out.failed++;
      }
    } else {
      const stmts: Stmt[] = results.map((x) => ({
        sql: `UPDATE topic_sources SET checked_at = ? WHERE topic_id = ? AND source_id = ? AND ${readyPred}`,
        params: [now, t.id, x.s.source_id, t.id],
      }));
      stmts.push(stmt(`UPDATE topics SET last_checked_at = ?, recheck_tried_at = ?, recheck_fail_count = 0, updated_at = ? WHERE id = ? AND status = 'ready'`, now, now, now, t.id));
      if ((await conditionalBatch(db, stmts)).ok) out.ok++;
    }
  }
  return out;
}
