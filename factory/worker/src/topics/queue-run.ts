// 手動のお題の run を取って queue へ送る（contract-T v2.6）。管理画面の route（src/routes/topics.ts）と
// 運用の依頼箱（src/ops.ts。契約 §W）が同じこの関数を使う（台帳・上限・run_in_progress の扱いを同じにする）。

import { conditionalBatch } from '../db';
import type { Env } from '../env';
import { reserveTopicRun, type ReserveOutcome, type RunRequest } from './gen';
import { runCancelStmts } from './store';

/** 手動の run の締め切り（queue の受け手が走らせる時と同じ。取る時の「残り時間」の判定にも使う。v2.6） */
export const MANUAL_RUN_MS = 5 * 60_000;

export type QueueRunOutcome =
  | { status: 'queued'; runId: string }
  | Extract<ReserveOutcome, { status: 'not_taken' }>
  | { status: 'queue_unavailable' };

/**
 * 取る（取れない時は理由）→ queue へ { t: 'topic_run', run_id, token, req } を送る。
 * 送れない時（IMAGE_GEN が無い・send が投げる）は run の行と取り置きを取り消して queue_unavailable
 */
export async function queueTopicRun(env: Env, req: RunRequest): Promise<QueueRunOutcome> {
  const r = await reserveTopicRun(env, req, { deadline: Date.now() + MANUAL_RUN_MS });
  if (r.status === 'not_taken') return r;
  const { runId, token } = r.taken;
  let sent = false;
  if (env.IMAGE_GEN) {
    try {
      await env.IMAGE_GEN.send({ t: 'topic_run', run_id: runId, token, req });
      sent = true;
    } catch {
      sent = false;
    }
  }
  if (!sent) {
    const x = await conditionalBatch(env.DB, runCancelStmts(runId, token));
    console.log(JSON.stringify({ at: 'topic_run', run_id: runId, status: x.ok ? 'cancelled' : 'lost', reason: 'queue_unavailable' }));
    return { status: 'queue_unavailable' };
  }
  console.log(JSON.stringify({ at: 'topic_run', run_id: runId, status: 'queued' }));
  return { status: 'queued', runId };
}
