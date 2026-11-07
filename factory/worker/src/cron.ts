// 10 分ごとの照合・起動・検証（契約 §B-5）。scheduled handler は最長 15 分。
// 順（契約 V-7 g）: 起動 → 取り込み → 自動回答（V-12） → 作り直しの再投入（V-13） → 読み手係 → 検証 → 仕分け → 自動公開 → 画像 → 入口 → …

import { getFeedFetch, getGeminiPort, getOEmbedPort, getPort, getTopicFetch } from './anthropic';
import { all, getSetting, isoPlus, nowIso, setSetting, stmt, tokyoDay } from './db';
import { cfg, type Env } from './env';
import { IMAGE_CRON_BUDGET_MS, imageCronStep } from './images';
import { meetingTick } from './meeting';
import { retroTick } from './retro';
import { runScout, scoutDueOn } from './scout';
import { getJob, markWebhookProcessed, reconcileJob, recoverCreating, startJob, type JobRow } from './jobs';
import { runVerificationStep } from './verify';
import { autoPublishStep, triageStep } from './triage-step';
import { autoAnswerStep } from './auto-answer';
import { retryFailedReworkStep } from './retry-step';
import { readerStep } from './reader';
import { topicsTick } from './topics/tick';
import { opsTick } from './ops';

// cron 経由の reconcile は開始から 10 分を締め切りにする（scheduled handler は最長 15 分。検証の時間を残す）
const CRON_RECONCILE_BUDGET_MS = 10 * 60_000;
/** scheduled handler の上限（15 分）。入口は残りが 3 分未満なら飛ばす（§K-4）。外部呼び出しは終了 1 分前までに収める */
const CRON_LIMIT_MS = 15 * 60_000;
const INTAKE_MIN_REMAINING_MS = 3 * 60_000;
const INTAKE_END_MARGIN_MS = 60_000;

export async function runCron(env: Env): Promise<Record<string, unknown>> {
  const db = env.DB;
  const cronStart = Date.now();
  const portCtx = { hostname: null, fakeEnabledSetting: await getSetting(db, 'fake_enabled') };
  const port = await getPort(env, portCtx);
  // §Q-11 2・§Q-13: YouTube の oEmbed の port（検証の公式の情報と、回収の reconcile が処理する職人の道具 youtube_info の両方に渡す）
  const oembed = await getOEmbedPort(env, portCtx);
  const out: Record<string, unknown> = {};
  const reconcileDeadline = Date.now() + CRON_RECONCILE_BUDGET_MS;

  // 1. 起動: queued（1 分超）を古い順に 1 件。creating 10 分超は復旧
  try {
    const q = await all<{ id: string }>(
      db,
      stmt("SELECT id FROM factory_jobs WHERE status = 'queued' AND updated_at < ? ORDER BY created_at ASC LIMIT 1", isoPlus(-60_000)),
    );
    if (q[0]) out.start = (await startJob(env, port, q[0].id)).status;
    const stale = await all<JobRow>(db, stmt("SELECT * FROM factory_jobs WHERE status = 'creating' AND updated_at < ? LIMIT 5", isoPlus(-10 * 60_000)));
    out.recovered = [];
    for (const j of stale) (out.recovered as string[]).push(await recoverCreating(env, port, j));
  } catch (e) {
    out.start_error = e instanceof Error ? e.name : 'error';
  }

  // 2. 回収
  try {
    const due = await all<{ id: string }>(
      db,
      stmt(
        "SELECT id FROM factory_jobs WHERE status IN ('running','needs_answer','budget_reached') AND (last_checked_at IS NULL OR last_checked_at < ?) ORDER BY last_checked_at ASC LIMIT 5",
        isoPlus(-10 * 60_000),
      ),
    );
    const results: string[] = [];
    for (const j of due) if (Date.now() < reconcileDeadline - 5_000) results.push(await reconcileJob(env, port, j.id, { deadline: reconcileDeadline, oembed }));
    const pending = await all<{ event_id: string; resource_id: string }>(
      db,
      stmt('SELECT event_id, resource_id FROM webhook_events WHERE processed_at IS NULL AND received_at < ? ORDER BY received_at ASC LIMIT 10', isoPlus(-2 * 60_000)),
    );
    for (const w of pending) {
      const job = await all<{ id: string }>(db, stmt('SELECT id FROM factory_jobs WHERE session_id = ?', w.resource_id));
      if (job[0] && (await getJob(db, job[0].id))) results.push(await reconcileJob(env, port, job[0].id, { deadline: reconcileDeadline, oembed }));
      await markWebhookProcessed(db, w.event_id);
    }
    out.reconciled = results;
  } catch (e) {
    out.reconcile_error = e instanceof Error ? e.name : 'error';
  }

  // 2-a. 自動回答（契約 V-12。自動の差し戻しの作り直しで職人が質問した時、既定案で答える）
  try {
    out.auto_answer = await autoAnswerStep(env, port, { deadline: cronStart + CRON_LIMIT_MS - INTAKE_END_MARGIN_MS });
  } catch (e) {
    out.auto_answer_error = e instanceof Error ? e.name : 'error';
  }

  // 2-c. 作り直しの再投入（契約 V-13。基盤の都合で failed になった作り直しを 1 回だけ作り直す。queued は次の tick の起動段が拾う）
  try {
    out.auto_retry = await retryFailedReworkStep(env, { deadline: cronStart + CRON_LIMIT_MS - INTAKE_END_MARGIN_MS });
  } catch (e) {
    out.auto_retry_error = e instanceof Error ? e.name : 'error';
  }

  // 2-b. 読み手係（契約 V-4 a・V-7 g。取り込みの段の直後・検証の段の前。取る前の条件（一時停止・残り 270 秒）は readerStep が見る）
  try {
    out.reader = await readerStep(env, port, { deadline: cronStart + CRON_LIMIT_MS - INTAKE_END_MARGIN_MS });
  } catch (e) {
    out.reader_error = e instanceof Error ? e.name : 'error';
  }

  // 3. 検証（1 件）
  try {
    // §Q-3 1: 動画の記録の port（鍵が無ければ呼ばない。settings video_gen_enabled が '1' の時だけ呼ぶ §Q-9.5）
    // §Q-11 2: 動画の公式の情報（YouTube の oEmbed）の port（video_gen_enabled に関係なく呼ぶ）
    out.verify = await runVerificationStep(env, port, {
      deadline: cronStart + CRON_LIMIT_MS - INTAKE_END_MARGIN_MS,
      gemini: await getGeminiPort(env, portCtx),
      oembed,
    });
  } catch (e) {
    out.verify_error = e instanceof Error ? e.name : 'error';
  }

  // 3-b. 仕分けと自動の処置（§L-4。verify 段の直後。rework job は queued で残し、次の cron の起動段が拾う）
  try {
    out.triage = await triageStep(env, { deadline: cronStart + CRON_LIMIT_MS - INTAKE_END_MARGIN_MS });
  } catch (e) {
    out.triage_error = e instanceof Error ? e.name : 'error';
  }

  // 3-b2. 自動公開（契約 V-7 d・g。仕分けの後。settings auto_publish が '1' で一時停止でない時だけ動く）
  try {
    out.auto_publish = await autoPublishStep(env, { deadline: cronStart + CRON_LIMIT_MS - INTAKE_END_MARGIN_MS });
  } catch (e) {
    out.auto_publish_error = e instanceof Error ? e.name : 'error';
  }

  // 3-c. 画像の回収（§O-4 d。3-b の直後。締め切り = min(開始 + 60 秒, cron の締め切り)。停止中・一時停止中も行う。生成はしない）
  try {
    out.images = await imageCronStep(env, { deadline: Math.min(Date.now() + IMAGE_CRON_BUDGET_MS, cronStart + CRON_LIMIT_MS - INTAKE_END_MARGIN_MS) });
  } catch (e) {
    out.images_error = e instanceof Error ? e.name : 'error';
  }

  // 入口（§K-4, §K-5）。pause 中は新しい外部呼び出しをしない（収集は runScout が、会議の起動は startMeeting が見る。会議の回収は行う）
  const intakeDeadline = cronStart + CRON_LIMIT_MS - INTAKE_END_MARGIN_MS;
  const enough = () => cronStart + CRON_LIMIT_MS - Date.now() >= INTAKE_MIN_REMAINING_MS;
  try {
    if (!enough()) out.meeting = 'skipped_time';
    else out.meeting = await meetingTick(env, port, { deadline: intakeDeadline });
  } catch (e) {
    out.meeting_error = e instanceof Error ? e.name : 'error';
  }
  // 振り返り係（§S-2）。会議の後に 1 回。回収（費用なし）は止めている間も行い、送信は pause 中と retro_enabled='0' の時はしない（retroTick が見る）
  try {
    if (!enough()) out.retro = 'skipped_time';
    else out.retro = await retroTick(env, port, { deadline: intakeDeadline });
  } catch (e) {
    out.retro_error = e instanceof Error ? e.name : 'error';
  }
  try {
    const now = new Date();
    const paused = (await getSetting(db, 'paused')) === '1';
    if (!paused && scoutDueOn(cfg(env).scoutDay, await getSetting(db, 'scout_last_day'), now)) {
      if (!enough()) out.scout = 'skipped_time';
      else {
        // 週 1 回: runScout が lock を取った後に scout_last_day を CAS で今日へ進め、取れた時だけ走る（lock → 日付の順。
        // 走行中で lock を取れなければ日付を消費しない）。取れた後は結果（失敗を含む）に関係なく今日の分は使ったことにする
        const r = await runScout(env, port, { trigger: 'cron', deadline: intakeDeadline, fetchImpl: await getFeedFetch(env, portCtx), now, claimDay: tokyoDay(now) });
        out.scout = r.status;
      }
    }
  } catch (e) {
    out.scout_error = e instanceof Error ? e.name : 'error';
  }

  // 運用の依頼箱（契約 §W）。お題の段の直前に 1 回・1 件だけ（手動と同じ経路で取って queue へ送るだけ。外部は呼ばない）
  try {
    out.ops = await opsTick(env);
  } catch (e) {
    out.ops_error = e instanceof Error ? e.name : 'error';
  }

  // お題のストック（contract-T T-13）。入口の段の後に 1 回。各段の残り時間は topicsTick が見る（(1) 予定の確定と (2) 片付けは常に行う）
  try {
    out.topics = await topicsTick(env, port, { deadline: intakeDeadline, fetchImpl: await getTopicFetch(env, portCtx) });
  } catch (e) {
    out.topics_error = e instanceof Error ? e.name : 'error';
  }

  // 4.
  await setSetting(db, 'last_cron_at', nowIso());
  console.log(JSON.stringify({ at: 'cron', ...out }));
  return out;
}
