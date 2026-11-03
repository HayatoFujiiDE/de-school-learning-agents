// Env 型（契約 §B-0）。vars は文字列で受け取り、数値は intVar で読む。

export interface Env {
  DB: D1Database;
  R2: R2Bucket;
  ASSETS: Fetcher;

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

  // secrets
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_WEBHOOK_SIGNING_KEY?: string;

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
  budgetReworkCents: intVar(env.SESSION_BUDGET_REWORK_CENTS, 500),
  verifyMaxFetches: intVar(env.VERIFY_MAX_FETCHES, 25),
  verifyMaxAttempts: intVar(env.VERIFY_MAX_ATTEMPTS, 3),
  workspace: env.ANTHROPIC_WORKSPACE || 'default',
});

export function isLocalHostname(hostname: string | null | undefined): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

export function consoleUrl(env: Env, sessionId: string | null): string | null {
  if (!sessionId) return null;
  return `https://platform.claude.com/workspaces/${encodeURIComponent(cfg(env).workspace)}/sessions/${encodeURIComponent(sessionId)}`;
}

export const JOB_MODEL = { draft: 'claude-sonnet-5-5', rework: 'claude-opus-5-5' } as const;
