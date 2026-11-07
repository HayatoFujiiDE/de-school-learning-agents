// 自動回答の段（契約 V-12）。機械の仕分けが差し戻した作り直しの job で職人が質問した時（needs_answer）、
// 職人自身の既定案（default）で答える。回答の経路は人の回答と同じ answerJob（standards_log に残り、session に「運営からの回答」として届く）。
// 人の差し戻しの job には触らない。job ごとの試行は AUTO_ANSWER_MAX 回まで（reconcile_state_json.auto_answer.attempts）。
// 上限に達した job と default の欠ける job（auto_answer.skip = 'no_default'）は候補の SQL で外し、後ろの job を詰まらせない。
import type { FactoryPort } from './anthropic';
import { all, cas, errorKind, getSetting, nowIso, stmt } from './db';
import type { Env } from './env';
import { parseJsonField } from './http';
import { ANSWER_BUDGET_MS, answerJob, type Question } from './jobs';
import { AUTO_TRIAGE_EMAIL } from './triage-step';

/** 自動回答の頭に付ける印（管理画面の standards_log と、職人に届く「運営からの回答」の両方で自動と分かる） */
export const AUTO_ANSWER_PREFIX = '（自動回答・職人の既定案のとおり）';
/** 1 tick に見る job の数 */
export const AUTO_ANSWER_BATCH = 2;
/** job ごとの自動回答の試行の上限 */
export const AUTO_ANSWER_MAX = 3;
/** 1 つの回答の上限（answerJob の answer_too_long と同じ） */
const ANSWER_MAX_CHARS = 4000;

export type AutoAnswerSkip = 'no_default' | 'cap' | 'raced' | 'refused' | 'error';
/** job id と理由コードだけ（質問や回答の本文は入れない） */
export interface AutoAnswerResult {
  answered: string[];
  skipped: Array<{ job_id: string; reason: AutoAnswerSkip }>;
  paused?: true;
}

interface Candidate {
  id: string;
  questions_json: string | null;
  answer_state: string;
  reconcile_state_json: string | null;
}

/**
 * reconcile_state_json を JSON の object として読む式（'' ・壊れた JSON・object でない JSON は '{}'。壊れた行は 0 回として扱われ、
 * CAS で '{}' から書き直される = jobs.ts の BUMP_SAVE_FAILURES_SQL と同じ考え方）
 */
const stateOf = (col: string) => {
  const v = `COALESCE(NULLIF(${col},''),'{}')`;
  return `CASE WHEN json_valid(${v}) THEN CASE WHEN json_type(${v}) = 'object' THEN ${v} ELSE '{}' END ELSE '{}' END`;
};
const ATTEMPTS = (col: string) => `COALESCE(json_extract(${stateOf(col)},'$.auto_answer.attempts'),0)`;

const log = (jobId: string, result: string, extra: Record<string, string> = {}) => console.log(JSON.stringify({ at: 'auto_answer', job_id: jobId, result, ...extra }));

/** 全部の質問に default（trim 後に空でなく、接頭辞を含めて 4,000 字以内）がある時だけ回答を返す。1 つでも欠ければ null */
function defaultAnswers(questions: unknown): Array<{ question_id: string; answer: string }> | null {
  if (!Array.isArray(questions) || questions.length === 0) return null;
  const out: Array<{ question_id: string; answer: string }> = [];
  for (const q of questions as Array<Partial<Question> | null>) {
    if (!q || typeof q.id !== 'string' || typeof q.default !== 'string') return null;
    const d = q.default.trim();
    if (!d) return null;
    const answer = AUTO_ANSWER_PREFIX + d;
    if (answer.length > ANSWER_MAX_CHARS) return null;
    out.push({ question_id: q.id, answer });
  }
  return out;
}

export async function autoAnswerStep(env: Env, port: FactoryPort, o: { deadline: number }): Promise<AutoAnswerResult> {
  const db = env.DB;
  if ((await getSetting(db, 'paused')) === '1') return { answered: [], skipped: [], paused: true };
  const out: AutoAnswerResult = { answered: [], skipped: [] };
  const candidates = await all<Candidate>(
    db,
    stmt(
      `SELECT j.id, j.questions_json, j.answer_state, j.reconcile_state_json FROM factory_jobs j
       WHERE j.status = 'needs_answer' AND j.answer_state IN ('none','saved') AND j.kind = 'rework' AND j.parent_version_id IS NOT NULL
         AND EXISTS (SELECT 1 FROM review_decisions d WHERE d.material_version_id = j.parent_version_id AND d.decision = 'return' AND d.reviewer_email = ?)
         AND ${ATTEMPTS('j.reconcile_state_json')} < ?
         AND COALESCE(json_extract(${stateOf('j.reconcile_state_json')},'$.auto_answer.skip'),'') = ''
       ORDER BY j.updated_at ASC, j.id ASC LIMIT ?`,
      AUTO_TRIAGE_EMAIL,
      AUTO_ANSWER_MAX,
      AUTO_ANSWER_BATCH,
    ),
  );
  for (const c of candidates) {
    // answerJob 1 回分（ANSWER_BUDGET_MS）+ 5 秒が残っていなければ以降は見ない
    if (o.deadline - Date.now() < ANSWER_BUDGET_MS + 5_000) break;
    try {
      // SQL の stateOf と同じく、読めない・object でない state は 0 回
      const state = parseJsonField<{ auto_answer?: { attempts?: unknown } } | null>(c.reconcile_state_json, {});
      const raw = state?.auto_answer?.attempts;
      const attempts = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
      if (attempts >= AUTO_ANSWER_MAX) {
        // 候補の SQL で先に外れる（読んだ後に別の呼び出しが数を進めた時だけここに来る）
        out.skipped.push({ job_id: c.id, reason: 'cap' });
        log(c.id, 'cap');
        continue;
      }
      // saved（送信に失敗して戻った回答・保存済みの回答）は answerJob が body を見ないので default を確かめない
      let answers: Array<{ question_id: string; answer: string }> = [];
      if (c.answer_state === 'none') {
        const a = defaultAnswers(parseJsonField<unknown>(c.questions_json, null));
        if (!a) {
          // 印を 1 回だけ書いて以後の候補から外す（人が管理画面で答える。answerJob はこの key を見ない）。管理画面の last_error にも印（既にあれば残す）
          await cas(
            db,
            stmt(
              `UPDATE factory_jobs SET reconcile_state_json = json_set(${stateOf('reconcile_state_json')}, '$.auto_answer.skip', 'no_default'),
                 last_error = COALESCE(last_error, 'auto_answer:no_default')
               WHERE id = ? AND status = 'needs_answer' AND answer_state = 'none'`,
              c.id,
            ),
          );
          out.skipped.push({ job_id: c.id, reason: 'no_default' });
          log(c.id, 'no_default');
          continue;
        }
        answers = a;
      }
      // 試行の数を先に CAS で +1（読んだ attempts を述語に。answerJob は reconcile_state_json を { ...state, scan } で書くのでこの key は残る）
      const claimed = await cas(
        db,
        stmt(
          `UPDATE factory_jobs SET reconcile_state_json = json_set(${stateOf('reconcile_state_json')}, '$.auto_answer.attempts', ${ATTEMPTS('reconcile_state_json')} + 1), updated_at = ?
           WHERE id = ? AND status = 'needs_answer' AND answer_state IN ('none','saved') AND ${ATTEMPTS('reconcile_state_json')} = ?`,
          nowIso(),
          c.id,
          attempts,
        ),
      );
      if (!claimed) {
        // 読んだ後に別の呼び出しが数を進めた・状態が変わった
        out.skipped.push({ job_id: c.id, reason: 'raced' });
        log(c.id, 'raced');
        continue;
      }
      const r = await answerJob(env, port, c.id, { answers });
      if (r.status === 200) {
        out.answered.push(c.id);
        log(c.id, 'sent');
      } else {
        out.skipped.push({ job_id: c.id, reason: 'refused' });
        log(c.id, typeof r.body.error === 'string' ? r.body.error : `status_${r.status}`);
      }
    } catch (e) {
      out.skipped.push({ job_id: c.id, reason: 'error' });
      log(c.id, 'error', { error: errorKind(e) });
    }
  }
  return out;
}
