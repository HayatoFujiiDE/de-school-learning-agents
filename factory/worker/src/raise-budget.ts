// 予算に当たった job の増額（契約 §B-4-f。2026-11-05 オーナー指示）。運営の明示操作（管理画面のボタン）だけが呼ぶ。
// cron・webhook・職人からは増額しない。外部の費用を増やす操作なので、上限（1 job・日次・paused）を全部通してから Anthropic を呼ぶ。
// 順序: 検査 → sessions.retrieve（使った額）→ 上限の判定 → sessions.update（Anthropic 側を先に上げる）→ D1 の CAS。
// 公式（platform.claude.com/docs/en/managed-agents/budgets）: 予算を上げる update が受理されると止まった作業は自動で再開し、
// 予算で止まっている間の user.message は 400 で拒否される。だから続きを頼む message は送らない（job を running に戻すのは reconcile）。
// D1 の CAS に負けた時も Anthropic 側は上げたままにする（上げすぎの方が安全。次の押下はその時の使った額から数え直す）。
// ログには id と金額と結果の種別だけを出す（メモ本文・運営のメールは出さない）。

import { PortError, type FactoryPort } from './anthropic';
import { cas, errorKind, first, getSetting, nowIso, stmt } from './db';
import { cfg, type Env } from './env';
import { getJob, todayCostCents, type ApiResult } from './jobs';

/** 1 回で増やせる額（セント）。管理画面の「$5 / $10 / $20 増やして続ける」 */
export const RAISE_STEPS_CENTS: readonly number[] = [500, 1000, 2000];
/** 1 job の予算の上限（$50） */
export const JOB_BUDGET_CAP_CENTS = 5000;
/** メモ欄の上限（文字数） */
export const RAISE_NOTE_MAX = 200;
/** session の usage.list_cost は丸めた値なので、新しい予算の基準は 1 セント上乗せする（使った額以下は API が拒否する） */
export const LIST_COST_MARGIN_CENTS = 1;
/** 外部呼び出し全体の期限（reconcile の waitUntil と同じ 25 秒。再試行 0） */
const RAISE_DEADLINE_MS = 25_000;

const fail = (status: number, error: string, extra: Record<string, unknown> = {}): ApiResult => ({ status, body: { error, ...extra } });

/** 応答に返すエラーの種別（PortError は kind と HTTP status だけ。本文は返さない） */
function portErrorKind(e: unknown): string {
  if (e instanceof PortError) return `${e.kind}${e.status ? `:${e.status}` : ''}`;
  return errorKind(e);
}

/** API が明示的に拒否した（4xx の応答）。それ以外（timeout・接続断・5xx・不明）は反映されたか分からない */
const isExplicitRefusal = (e: unknown): boolean => e instanceof PortError && e.responded && typeof e.status === 'number' && e.status >= 400 && e.status < 500;

/**
 * 新しい予算 = max(budget_cents, list_cost_cents（D1）, usage.list_cost + 1) + add_cents。
 * usage.list_cost が無い（費用の集計がまだ無い）時は D1 の 2 つだけで数える
 */
export function newBudgetCents(job: { budget_cents: number; list_cost_cents: number }, sessionListCostCents: number | null, add: number): number {
  const base = Math.max(job.budget_cents, job.list_cost_cents, sessionListCostCents === null ? 0 : sessionListCostCents + LIST_COST_MARGIN_CENTS);
  return base + add;
}

export async function raiseBudget(env: Env, port: FactoryPort, jobId: string, body: Record<string, unknown> | null): Promise<ApiResult> {
  if (!body) return fail(400, 'invalid_json');
  const add = body.add_cents;
  if (typeof add !== 'number' || !RAISE_STEPS_CENTS.includes(add)) return fail(400, 'invalid_add_cents');
  const note = body.note;
  if (note !== undefined && note !== null && (typeof note !== 'string' || note.length > RAISE_NOTE_MAX)) return fail(400, 'invalid_note');

  const db = env.DB;
  const job = await getJob(db, jobId);
  if (!job) return fail(404, 'not_found');
  // 1. 予算で止まっている job だけ
  if (job.status !== 'budget_reached' || !job.session_id) return fail(409, 'not_budget_reached');
  const sessionId = job.session_id;
  // 2. 止めている間は増やさない
  if ((await getSetting(db, 'paused')) === '1') return fail(409, 'paused');

  // 3. update の直前に session の使った額（usage.list_cost。SessionView.listCostCents）を読む。読めなければ何も変えずに 502
  const deadline = Date.now() + RAISE_DEADLINE_MS;
  let sessionCost: number | null;
  try {
    sessionCost = (await port.retrieveSession(sessionId, { deadline })).listCostCents;
  } catch (e) {
    const kind = portErrorKind(e);
    console.log(JSON.stringify({ at: 'raise_budget', job_id: jobId, result: 'retrieve_failed', kind }));
    return fail(502, 'raise_failed', { message: kind });
  }

  // 4. 新しい予算と 1 job の上限
  const from = job.budget_cents;
  const to = newBudgetCents(job, sessionCost, add);
  if (to > JOB_BUDGET_CAP_CENTS) return fail(409, 'job_budget_cap');
  // 5. 日次上限: 新しい予算で増える支出の余地（新予算 − 台帳に載っている使った額）を今日の費用に足して判定する
  // startJob（§B-4-a）と同じ守り: 再開すると running に戻るので、同時に動く数と、動いている job の予算の予約も数える
  const run = await first<{ n: number; b: number | null }>(
    db,
    stmt("SELECT COUNT(*) AS n, SUM(budget_cents) AS b FROM factory_jobs WHERE status IN ('creating','running') AND id <> ?", jobId),
  );
  if (Number(run?.n ?? 0) >= cfg(env).maxConcurrent) return fail(409, 'too_many_running');
  const headroom = to - job.list_cost_cents;
  if ((await todayCostCents(db)) + Math.max(0, Number(run?.b ?? 0)) + headroom >= cfg(env).dailyCapCents) return fail(409, 'daily_cap');

  // 6. Anthropic 側の予算を先に上げる。D1 はどちらの失敗でも変えない
  try {
    await port.updateSessionBudget(sessionId, to, { deadline });
  } catch (e) {
    const kind = portErrorKind(e);
    const error = isExplicitRefusal(e) ? 'raise_failed' : 'raise_unknown'; // raise_unknown: 反映された可能性がある
    console.log(JSON.stringify({ at: 'raise_budget', job_id: jobId, from, to, result: error, kind }));
    return fail(502, error, { message: kind });
  }

  // 7. D1 の CAS（同時に 2 回押した後の方・途中で reconcile が状態を進めた時は 0 行）
  const updated = await cas(
    db,
    stmt(
      `UPDATE factory_jobs SET budget_cents = ?, updated_at = ? WHERE id = ? AND status = 'budget_reached' AND budget_cents = ?`,
      to,
      nowIso(),
      jobId,
      from,
    ),
  );
  if (!updated) {
    console.log(JSON.stringify({ at: 'raise_budget', job_id: jobId, from, to, result: 'conflict' }));
    return fail(409, 'conflict');
  }
  // 8. 監査（追記専用の job 監査表は無いので console.log。by は Access を通った運営の操作であることだけを示し、メールは書かない）
  console.log(JSON.stringify({ at: 'raise_budget', job_id: jobId, from, to, by: 'access' }));
  // 9. update が受理された = session は自動で再開する。job を running に戻すのは reconcile
  return { status: 200, body: { job_id: jobId, budget_cents: to, resumed: 'auto' } };
}
