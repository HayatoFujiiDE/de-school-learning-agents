// 純関数: 状態遷移の判定（契約 §C-2）。I/O を持たない。表に無い遷移は IllegalTransition。
// 実際の書き込みは SQL の CAS / 条件付き batch が守る。ここは「その遷移が表にあるか」の判定と事前チェックに使う。

export type WorkStatus = 'idle' | 'queued' | 'making' | 'review';
export type PublishStatus = 'none' | 'available' | 'stopped';
export type JobStatus =
  | 'queued'
  | 'creating'
  | 'running'
  | 'needs_answer'
  | 'budget_reached'
  | 'done'
  | 'failed'
  | 'cancelled';
export type VersionStatus = 'review' | 'approved' | 'rejected';

export class IllegalTransition extends Error {
  constructor(
    public readonly machine: string,
    public readonly from: string,
    public readonly event: string,
  ) {
    super(`illegal transition: ${machine} ${from} --${event}-->`);
    this.name = 'IllegalTransition';
  }
}

type Table<S extends string, E extends string> = ReadonlyArray<{ from: readonly S[]; event: E; to: S }>;

// materials.work_status
export type WorkEvent =
  | 'job_queued' // idle → queued（新規素材は queued で生まれる。改善 job も同じ）
  | 'job_creating' // queued → making（startJob が job を creating にした）
  | 'create_failed' // making → queued（sessions.create が応答ありで失敗）
  | 'queued_cancelled' // queued → idle（queued の job を cancel）
  | 'ingested' // making → review
  | 'job_ended' // making → idle（job failed / cancelled）
  | 'approved' // review → idle
  | 'rejected' // review → idle
  | 'returned' // review → queued
  | 'reingested'; // idle → making（error='invalid_outputs' の job の取り込み直し §B-4-e だけ）

export const WORK_TRANSITIONS: Table<WorkStatus, WorkEvent> = [
  { from: ['idle'], event: 'job_queued', to: 'queued' },
  { from: ['queued'], event: 'job_creating', to: 'making' },
  { from: ['making'], event: 'create_failed', to: 'queued' },
  { from: ['queued'], event: 'queued_cancelled', to: 'idle' },
  { from: ['making'], event: 'ingested', to: 'review' },
  { from: ['making'], event: 'job_ended', to: 'idle' },
  { from: ['review'], event: 'approved', to: 'idle' },
  { from: ['review'], event: 'rejected', to: 'idle' },
  { from: ['review'], event: 'returned', to: 'queued' },
  { from: ['idle'], event: 'reingested', to: 'making' },
];

// materials.publish_status（publishSwitch だけが変える。自動遷移は無い）
export type PublishEvent = 'approve' | 'rollback' | 'stop';
export const PUBLISH_TRANSITIONS: Table<PublishStatus, PublishEvent> = [
  { from: ['none', 'stopped', 'available'], event: 'approve', to: 'available' },
  { from: ['stopped', 'available'], event: 'rollback', to: 'available' },
  { from: ['available'], event: 'stop', to: 'stopped' },
];

// factory_jobs.status
export type JobEvent =
  | 'begin_create' // queued → creating
  | 'created' // creating → running（作成成功・復旧で採用）
  | 'create_failed' // creating → queued（応答ありの失敗・復旧で見つからない）
  | 'create_abandoned' // creating → failed（create_attempts >= 3）
  | 'questions_asked' // running → needs_answer
  | 'answered' // needs_answer → running
  | 'budget_reached' // running → budget_reached
  | 'resumed' // budget_reached → running
  | 'ingested' // running / budget_reached → done
  | 'fail' // running / needs_answer / budget_reached → failed
  | 'cancel' // queued / creating / running / needs_answer / budget_reached → cancelled
  | 'reingest'; // failed → running（error='invalid_outputs' の job の取り込み直し §B-4-e だけ。他の failed は戻らない）

export const ACTIVE_JOB_STATUSES: readonly JobStatus[] = ['queued', 'creating', 'running', 'needs_answer', 'budget_reached'];
export const TERMINAL_JOB_STATUSES: readonly JobStatus[] = ['done', 'failed', 'cancelled'];

export const JOB_TRANSITIONS: Table<JobStatus, JobEvent> = [
  { from: ['queued'], event: 'begin_create', to: 'creating' },
  { from: ['creating'], event: 'created', to: 'running' },
  { from: ['creating'], event: 'create_failed', to: 'queued' },
  { from: ['creating'], event: 'create_abandoned', to: 'failed' },
  { from: ['running'], event: 'questions_asked', to: 'needs_answer' },
  { from: ['needs_answer'], event: 'answered', to: 'running' },
  { from: ['running'], event: 'budget_reached', to: 'budget_reached' },
  { from: ['budget_reached'], event: 'resumed', to: 'running' },
  { from: ['running', 'budget_reached'], event: 'ingested', to: 'done' },
  { from: ['running', 'needs_answer', 'budget_reached'], event: 'fail', to: 'failed' },
  { from: ['queued', 'creating', 'running', 'needs_answer', 'budget_reached'], event: 'cancel', to: 'cancelled' },
  { from: ['failed'], event: 'reingest', to: 'running' },
];

/**
 * reingest（§B-4-e 1）の述語。failed → running の辺はこの述語が真の job にだけ使う
 * （`terminated_*` / `too_many_denies` / `create_unconfirmed` 等の failed、session の無い job は対象外 §R-43）
 */
export function isReingestable(job: { status: string; error: string | null; session_id: string | null }): boolean {
  return job.status === 'failed' && job.error === 'invalid_outputs' && typeof job.session_id === 'string' && job.session_id.length > 0;
}

// material_versions.status
export type VersionEvent = 'approve' | 'reject' | 'return';
export const VERSION_TRANSITIONS: Table<VersionStatus, VersionEvent> = [
  { from: ['review'], event: 'approve', to: 'approved' },
  { from: ['review'], event: 'reject', to: 'rejected' },
  { from: ['review'], event: 'return', to: 'rejected' },
];

function next<S extends string, E extends string>(machine: string, table: Table<S, E>, from: S, event: E): S {
  for (const row of table) {
    if (row.event === event && (row.from as readonly string[]).includes(from)) return row.to;
  }
  throw new IllegalTransition(machine, from, event);
}

function can<S extends string, E extends string>(table: Table<S, E>, from: S, event: E): boolean {
  return table.some((row) => row.event === event && (row.from as readonly string[]).includes(from));
}

export const nextWorkStatus = (from: WorkStatus, event: WorkEvent): WorkStatus => next('work_status', WORK_TRANSITIONS, from, event);
export const nextPublishStatus = (from: PublishStatus, event: PublishEvent): PublishStatus =>
  next('publish_status', PUBLISH_TRANSITIONS, from, event);
export const nextJobStatus = (from: JobStatus, event: JobEvent): JobStatus => next('job', JOB_TRANSITIONS, from, event);
export const nextVersionStatus = (from: VersionStatus, event: VersionEvent): VersionStatus =>
  next('version', VERSION_TRANSITIONS, from, event);

export const canWork = (from: WorkStatus, event: WorkEvent): boolean => can(WORK_TRANSITIONS, from, event);
export const canPublish = (from: PublishStatus, event: PublishEvent): boolean => can(PUBLISH_TRANSITIONS, from, event);
export const canJob = (from: JobStatus, event: JobEvent): boolean => can(JOB_TRANSITIONS, from, event);
export const canVersion = (from: VersionStatus, event: VersionEvent): boolean => can(VERSION_TRANSITIONS, from, event);

export const isActiveJob = (s: string): boolean => (ACTIVE_JOB_STATUSES as readonly string[]).includes(s);
export const isTerminalJob = (s: string): boolean => (TERMINAL_JOB_STATUSES as readonly string[]).includes(s);
