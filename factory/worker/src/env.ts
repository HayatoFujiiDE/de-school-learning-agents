// Env 型（契約 §B-0）。vars は文字列で受け取り、数値は intVar で読む。

export interface Env {
  DB: D1Database;
  R2: R2Bucket;
  ASSETS: Fetcher;
  /** 画像生成の queue（§O-4 a）。consumer は src/index.ts の queue handler */
  IMAGE_GEN?: Queue<{ request_id: string }>;

  FACTORY_AGENT_ID: string;
  FACTORY_ENV_ID: string;
  ANTHROPIC_WORKSPACE: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  MAX_CONCURRENT_JOBS: string;
  DAILY_CAP_CENTS: string;
  SESSION_BUDGET_DRAFT_CENTS: string;
  SESSION_BUDGET_REWORK_CENTS: string;
  VERIFY_MAX_FETCHES: string;
  VERIFY_MAX_ATTEMPTS: string;
  // §L-2（検証係の Batch 化）。wrangler.jsonc に既定値がある
  VERIFY_MODE?: string;
  VERIFY_MAX_CONTENT_TOKENS?: string;
  VERIFY_INFLIGHT?: string;
  VERIFY_TURN_RESERVE_CENTS?: string;
  VERIFY_ATTEMPT_CAP_CENTS?: string;
  // 入口（§K-0）。wrangler.jsonc に既定値がある。無い時は cfg() の既定を使う
  SCOUT_XAI_MODEL?: string;
  SCOUT_MAX_TURNS?: string;
  SCOUT_MONTHLY_CAP_CENTS?: string;
  MEETING_MONTHLY_CAP_CENTS?: string;
  SCOUT_DAY?: string;
  MEETING_DAYS?: string;
  /** 結果不明（timeout・接続断・本文が読めない）の xAI 呼び出し 1 回を台帳に載せる保守的見積り（セント） */
  SCOUT_XAI_UNCONFIRMED_CENTS?: string;
  /** 応答不明の batches.create 1 回を台帳に載せる保守的見積り（セント） */
  MEETING_UNCONFIRMED_CENTS?: string;
  // 画像生成（§O-4 a）。wrangler.jsonc に既定値がある。無い時は cfg() の既定を使う
  IMAGE_MODEL_STANDARD?: string;
  IMAGE_MODEL_SCIENTIFIC?: string;
  IMAGE_MONTHLY_CAP_CENTS?: string;
  // 動画の確認（§Q-4）。wrangler.jsonc に既定値がある。無い時は cfg() の既定を使う
  GEMINI_VIDEO_MODEL?: string;
  /** 1 動画の Gemini の呼び出し 1 回を取り置く額（セント。上界の見積り。精算しない） */
  VIDEO_U_CENTS?: string;
  /** 動画（ref_id vv:*）の月の記帳の上限（セント） */
  VIDEO_MONTHLY_CAP_CENTS?: string;
  /** 予備のモデル（§Q-10 10）。settings video_fallback_enabled が '1' の時だけ、n ≥ 2 の呼び出しに使う。空なら予備なし */
  GEMINI_VIDEO_FALLBACK_MODEL?: string;
  // お題のストック（contract-T T-6）。wrangler.jsonc に既定値がある。無い時は cfg() の既定を使う
  TOPIC_MONTHLY_CAP_CENTS?: string;
  TOPIC_DAILY_CAP_CENTS?: string;
  TOPIC_GEN_RESERVE_CENTS?: string;
  TOPIC_CHECK_RESERVE_CENTS?: string;
  TOPIC_CHECK_MAX_ATTEMPTS?: string;
  /** 0=日〜6=土（Asia/Tokyo）。talk・philo・make の週 1 回の生成の日 */
  TOPIC_WEEKLY_DAY?: string;
  TOPIC_DERIVE_PER_WEEK?: string;
  /** 生成のモデル（T-4。既定は会議と同じ Sonnet 5.5）。検査のモデル（T-5 の 3。既定は生成と同じ） */
  TOPIC_GEN_MODEL?: string;
  TOPIC_CHECK_MODEL?: string;

  // secrets
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_WEBHOOK_SIGNING_KEY?: string;
  /** 収集部隊の X 検索のみ（§K-0）。無ければ X 検索を飛ばす */
  XAI_API_KEY?: string;
  /** 画像生成（§O-0）。読むのは src/openai.ts だけ。D1・R2・ログ・作業場・custom_tool_result に出さない */
  OPENAI_API_KEY?: string;
  /** 動画の確認（§Q-3 1）。読むのは src/gemini.ts だけ。D1・R2・ログに出さない。無ければ呼ばない（取り置きもしない） */
  GEMINI_API_KEY?: string;

  // .dev.vars のみ（hostname が localhost / 127.0.0.1 の時だけ効く）
  ACCESS_DEV_BYPASS_EMAIL?: string;
  ANTHROPIC_FAKE?: string;
}

export function intVar(v: string | undefined, def: number): number {
  const n = Number.parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) && n >= 0 ? n : def;
}

export const cfg = (env: Env) => ({
  maxConcurrent: intVar(env.MAX_CONCURRENT_JOBS, 2),
  dailyCapCents: intVar(env.DAILY_CAP_CENTS, 1500),
  budgetDraftCents: intVar(env.SESSION_BUDGET_DRAFT_CENTS, 300),
  budgetReworkCents: intVar(env.SESSION_BUDGET_REWORK_CENTS, 1000),
  verifyMaxFetches: intVar(env.VERIFY_MAX_FETCHES, 25),
  verifyMaxAttempts: intVar(env.VERIFY_MAX_ATTEMPTS, 3),
  // §L-2
  verifyMode: (env.VERIFY_MODE === 'sync' ? 'sync' : 'batch') as 'sync' | 'batch',
  verifyMaxContentTokens: intVar(env.VERIFY_MAX_CONTENT_TOKENS, 20000),
  verifyInflight: intVar(env.VERIFY_INFLIGHT, 2),
  verifyTurnReserveCents: intVar(env.VERIFY_TURN_RESERVE_CENTS, 150),
  verifyAttemptCapCents: intVar(env.VERIFY_ATTEMPT_CAP_CENTS, 400),
  workspace: env.ANTHROPIC_WORKSPACE || 'default',
  // §K-0
  scoutModel: (env.SCOUT_XAI_MODEL || 'grok-4.3').trim(),
  /** xAI の max_turns。費用の天井としてコード側でも 1..SCOUT_MAX_TURNS_CEILING に収める */
  scoutMaxTurns: Math.min(Math.max(intVar(env.SCOUT_MAX_TURNS, 2), 1), SCOUT_MAX_TURNS_CEILING),
  scoutMonthlyCapCents: intVar(env.SCOUT_MONTHLY_CAP_CENTS, 500),
  meetingMonthlyCapCents: intVar(env.MEETING_MONTHLY_CAP_CENTS, 200),
  /** 0=日〜6=土（Asia/Tokyo）。範囲外なら週次の自動実行はしない */
  scoutDay: intVar(env.SCOUT_DAY, 1),
  meetingDays: parseDays(env.MEETING_DAYS ?? '1,15'),
  scoutXaiUnconfirmedCents: intVar(env.SCOUT_XAI_UNCONFIRMED_CENTS, 100),
  meetingUnconfirmedCents: intVar(env.MEETING_UNCONFIRMED_CENTS, 20),
  // §O-4 a / §M-2-2 b
  imageModelStandard: (env.IMAGE_MODEL_STANDARD || 'gpt-image-2.5-flare').trim(),
  imageModelScientific: (env.IMAGE_MODEL_SCIENTIFIC || 'gpt-image-2.5-sunburst').trim(),
  imageMonthlyCapCents: intVar(env.IMAGE_MONTHLY_CAP_CENTS, 3000),
  // §Q-4（U_video は 0 にしない: 0 だと月・日の上限が効かない）
  videoModel: (env.GEMINI_VIDEO_MODEL || 'gemini-3.6-flash').trim(),
  videoUCents: Math.max(1, intVar(env.VIDEO_U_CENTS, 10)),
  videoMonthlyCapCents: intVar(env.VIDEO_MONTHLY_CAP_CENTS, 1000),
  // §Q-10 10（既定は無し = 予備を使わない。wrangler.jsonc の値は gemini-3.8-flash）
  videoFallbackModel: (env.GEMINI_VIDEO_FALLBACK_MODEL ?? '').trim(),
  // contract-T T-6（取り置き額は 0 にしない: 0 だと月・日の上限が効かない）
  topicMonthlyCapCents: intVar(env.TOPIC_MONTHLY_CAP_CENTS, 2000),
  topicDailyCapCents: intVar(env.TOPIC_DAILY_CAP_CENTS, 200),
  topicGenReserveCents: Math.max(1, intVar(env.TOPIC_GEN_RESERVE_CENTS, 60)),
  topicCheckReserveCents: Math.max(1, intVar(env.TOPIC_CHECK_RESERVE_CENTS, 15)),
  topicCheckMaxAttempts: Math.max(1, intVar(env.TOPIC_CHECK_MAX_ATTEMPTS, 2)),
  /** 範囲外（7 以上）なら週 1 回の生成はしない */
  topicWeeklyDay: intVar(env.TOPIC_WEEKLY_DAY, 0),
  topicDerivePerWeek: intVar(env.TOPIC_DERIVE_PER_WEEK, 3),
  topicGenModel: (env.TOPIC_GEN_MODEL || TOPIC_DEFAULT_MODEL).trim(),
  topicCheckModel: (env.TOPIC_CHECK_MODEL || env.TOPIC_GEN_MODEL || TOPIC_DEFAULT_MODEL).trim(),
});

/** お題の生成・検査の既定のモデル（contract-T T-4: 会議 MEETING_MODEL と同じ Sonnet 5.5 の id） */
export const TOPIC_DEFAULT_MODEL = 'claude-sonnet-5-5';

/** SCOUT_MAX_TURNS を var で大きくしても 1 run の X 検索がこれ以上の turn を使わない（外部コストの有限化） */
export const SCOUT_MAX_TURNS_CEILING = 4;

/** "1,15" → [1, 15]（1..31 の整数だけ。空や不正は除く） */
export function parseDays(v: string): number[] {
  const out = new Set<number>();
  for (const part of String(v).split(',')) {
    const t = part.trim();
    if (!/^\d{1,2}$/.test(t)) continue;
    const n = Number(t);
    if (n >= 1 && n <= 31) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

export function isLocalHostname(hostname: string | null | undefined): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

export function consoleUrl(env: Env, sessionId: string | null): string | null {
  if (!sessionId) return null;
  return `https://platform.claude.com/workspaces/${encodeURIComponent(cfg(env).workspace)}/sessions/${encodeURIComponent(sessionId)}`;
}

export const JOB_MODEL = { draft: 'claude-sonnet-5-5', rework: 'claude-opus-5-5' } as const;
