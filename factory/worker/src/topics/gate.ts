// お題を「出せる」（status = 'ready'）にする SQL と、「引退」（status = 'retired'）にする SQL は、このファイルにだけ置く（契約 contract-T T-0・T-3）。
// 'ready' を書くのは topicGate.auto と topicGate.approve の 2 つだけ。gate は topic_checks.verdict / approvable を読むだけで、緑の条件を別に持たない。

import type { SqlValue, Stmt } from '../db';

type Pred = { sql: string; params: SqlValue[] };

/** 人の承認の述語（T-3）。EXISTS の形（承認の batch の前の文に付ける）と、最後の UPDATE の WHERE の形は同じ条件 */
function approvePredSql(alias: string): string {
  return `${alias}.status = 'held' AND ${alias}.hold_reason IN ('heavy','flagged') AND ${alias}.content_sha256 = ?
    AND EXISTS (SELECT 1 FROM topic_checks c WHERE c.topic_id = ${alias}.id AND c.attempt = ${alias}.check_attempts AND c.content_sha256 = ${alias}.content_sha256 AND c.approvable = 1)
    AND (${alias}.sensitivity <> 'heavy' OR ? = 1)`;
}

export function approvePred(p: { id: string; sha: string; readAll: boolean }): Pred {
  return { sql: `EXISTS (SELECT 1 FROM topics a WHERE a.id = ? AND ${approvePredSql('a')})`, params: [p.id, p.sha, p.readAll ? 1 : 0] };
}

export const topicGate = {
  /**
   * 自動で出す（T-3 の述語を 1 つの UPDATE の WHERE に全部）。検査の完了の batch の 2 文目。
   * 見直しの子は、自分の親とだけは題が同じでよい
   */
  auto(p: { id: string; token: string; now: string }): Stmt {
    return {
      sql: `UPDATE topics SET status = 'ready', hold_reason = NULL, check_token = NULL, check_lease_until = NULL, updated_at = ?
WHERE id = ? AND status = 'checking' AND check_token = ? AND check_lease_until > ? AND sensitivity = 'normal'
  AND EXISTS (SELECT 1 FROM topic_checks c WHERE c.topic_id = topics.id AND c.attempt = topics.check_attempts AND c.content_sha256 = topics.content_sha256 AND c.verdict = 'green' AND c.sensitivity = 'normal')
  AND NOT EXISTS (SELECT 1 FROM topics o WHERE o.id <> topics.id AND (topics.derive_kind IS NOT 'refresh' OR o.id <> topics.parent_topic_id) AND o.kind = topics.kind AND o.title_norm = topics.title_norm AND o.status = 'ready')`,
      params: [p.now, p.id, p.token, p.now],
    };
  },

  /**
   * 人が承認する（T-3）: held で hold_reason が heavy / flagged、画面の sha と同じ、最新の検査が同じ sha で approvable = 1、重い話題は read_all。
   * 承認の batch の最後の文（changes = 0 なら競合）
   */
  approve(p: { id: string; sha: string; readAll: boolean; now: string }): Stmt {
    return {
      sql: `UPDATE topics SET status = 'ready', hold_reason = NULL, updated_at = ?
WHERE id = ? AND ${approvePredSql('topics')}`,
      params: [p.now, p.id, p.sha, p.readAll ? 1 : 0],
    };
  },
};

/** 人の retire（T-3: ready → retired）。sha は画面の値 */
export function retireStmt(p: { id: string; sha: string; now: string }): Stmt {
  return { sql: `UPDATE topics SET status = 'retired', updated_at = ? WHERE id = ? AND status = 'ready' AND content_sha256 = ?`, params: [p.now, p.id, p.sha] };
}

/**
 * 見直しの子が ready になった時の親の引退（T-5 の 4 の 5・T-9）。検査の完了の batch の最後の 2 文。
 * 条件は Q（この batch の topic_checks が書けた印）AND 子が ready AND 子の check_attempts = A。
 * 親が既に retired・rejected なら何も変わらない（記録も書かない）。記録の id は決まっているので 2 回流しても増えない
 */
export function retireParentOnAutoStmts(p: { childId: string; attempt: number; now: string; q: Pred }): Stmt[] {
  return [
    {
      sql: `INSERT OR IGNORE INTO topic_decisions (id, topic_id, decision, by, read_all, content_sha256, note, created_at)
SELECT 'td:' || par.id || ':retire:' || ch.id, par.id, 'auto_retire', 'machine', 0, par.content_sha256, NULL, ?
FROM topics ch JOIN topics par ON par.id = ch.parent_topic_id
WHERE ch.id = ? AND ch.derive_kind = 'refresh' AND ch.status = 'ready' AND ch.check_attempts = ? AND par.status IN ('ready','held') AND ${p.q.sql}`,
      params: [p.now, p.childId, p.attempt, ...p.q.params],
    },
    {
      sql: `UPDATE topics SET status = 'retired', updated_at = ?
WHERE id = (SELECT ch.parent_topic_id FROM topics ch WHERE ch.id = ? AND ch.derive_kind = 'refresh' AND ch.status = 'ready' AND ch.check_attempts = ?)
  AND status IN ('ready','held') AND ${p.q.sql}`,
      params: [p.now, p.childId, p.attempt, ...p.q.params],
    },
  ];
}

/** 人の承認で見直しの子が ready になる時の親の引退（T-9「子が ready になった時、同じ batch で親を引退させる」）。承認の述語を条件に、承認の UPDATE より前に置く */
export function retireParentOnApproveStmts(p: { childId: string; now: string; pred: Pred }): Stmt[] {
  return [
    {
      sql: `INSERT OR IGNORE INTO topic_decisions (id, topic_id, decision, by, read_all, content_sha256, note, created_at)
SELECT 'td:' || par.id || ':retire:' || ch.id, par.id, 'auto_retire', 'machine', 0, par.content_sha256, NULL, ?
FROM topics ch JOIN topics par ON par.id = ch.parent_topic_id
WHERE ch.id = ? AND ch.derive_kind = 'refresh' AND par.status IN ('ready','held') AND ${p.pred.sql}`,
      params: [p.now, p.childId, ...p.pred.params],
    },
    {
      sql: `UPDATE topics SET status = 'retired', updated_at = ?
WHERE id = (SELECT ch.parent_topic_id FROM topics ch WHERE ch.id = ? AND ch.derive_kind = 'refresh')
  AND status IN ('ready','held') AND ${p.pred.sql}`,
      params: [p.now, p.childId, ...p.pred.params],
    },
  ];
}
