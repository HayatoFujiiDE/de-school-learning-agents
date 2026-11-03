import { describe, expect, it } from 'vitest';
import {
  IllegalTransition,
  JOB_TRANSITIONS,
  PUBLISH_TRANSITIONS,
  VERSION_TRANSITIONS,
  WORK_TRANSITIONS,
  nextJobStatus,
  nextPublishStatus,
  nextVersionStatus,
  nextWorkStatus,
  type JobEvent,
  type JobStatus,
  type PublishEvent,
  type PublishStatus,
  type VersionEvent,
  type VersionStatus,
  type WorkEvent,
  type WorkStatus,
} from '../src/state';

const WORK: WorkStatus[] = ['idle', 'queued', 'making', 'review'];
const PUBLISH: PublishStatus[] = ['none', 'available', 'stopped'];
const JOB: JobStatus[] = ['queued', 'creating', 'running', 'needs_answer', 'budget_reached', 'done', 'failed', 'cancelled'];
const VERSION: VersionStatus[] = ['review', 'approved', 'rejected'];

// 契約 §C-2 の表をそのまま期待値として書く（実装の表を写さない）
const WORK_EXPECTED: Array<[WorkStatus, WorkEvent, WorkStatus]> = [
  ['idle', 'job_queued', 'queued'],
  ['queued', 'job_creating', 'making'],
  ['making', 'create_failed', 'queued'],
  ['queued', 'queued_cancelled', 'idle'],
  ['making', 'ingested', 'review'],
  ['making', 'job_ended', 'idle'],
  ['review', 'approved', 'idle'],
  ['review', 'rejected', 'idle'],
  ['review', 'returned', 'queued'],
];
const PUBLISH_EXPECTED: Array<[PublishStatus, PublishEvent, PublishStatus]> = [
  ['none', 'approve', 'available'],
  ['stopped', 'approve', 'available'],
  ['available', 'approve', 'available'],
  ['stopped', 'rollback', 'available'],
  ['available', 'rollback', 'available'],
  ['available', 'stop', 'stopped'],
];
const JOB_EXPECTED: Array<[JobStatus, JobEvent, JobStatus]> = [
  ['queued', 'begin_create', 'creating'],
  ['creating', 'created', 'running'],
  ['creating', 'create_failed', 'queued'],
  ['creating', 'create_abandoned', 'failed'],
  ['running', 'questions_asked', 'needs_answer'],
  ['needs_answer', 'answered', 'running'],
  ['running', 'budget_reached', 'budget_reached'],
  ['budget_reached', 'resumed', 'running'],
  ['running', 'ingested', 'done'],
  ['budget_reached', 'ingested', 'done'],
  ['running', 'fail', 'failed'],
  ['needs_answer', 'fail', 'failed'],
  ['budget_reached', 'fail', 'failed'],
  ['queued', 'cancel', 'cancelled'],
  ['creating', 'cancel', 'cancelled'],
  ['running', 'cancel', 'cancelled'],
  ['needs_answer', 'cancel', 'cancelled'],
  ['budget_reached', 'cancel', 'cancelled'],
];
const VERSION_EXPECTED: Array<[VersionStatus, VersionEvent, VersionStatus]> = [
  ['review', 'approve', 'approved'],
  ['review', 'reject', 'rejected'],
  ['review', 'return', 'rejected'],
];

function events<E extends string>(t: ReadonlyArray<{ event: E }>): E[] {
  return [...new Set(t.map((r) => r.event))];
}

describe('work_status', () => {
  it.each(WORK_EXPECTED)('%s --%s--> %s', (from, ev, to) => expect(nextWorkStatus(from, ev)).toBe(to));
  it('表に無い遷移はすべて IllegalTransition', () => {
    let n = 0;
    for (const from of WORK)
      for (const ev of events(WORK_TRANSITIONS)) {
        if (WORK_EXPECTED.some(([f, e]) => f === from && e === ev)) continue;
        expect(() => nextWorkStatus(from, ev)).toThrow(IllegalTransition);
        n++;
      }
    expect(n).toBe(WORK.length * events(WORK_TRANSITIONS).length - WORK_EXPECTED.length);
  });
});

describe('publish_status', () => {
  it.each(PUBLISH_EXPECTED)('%s --%s--> %s', (from, ev, to) => expect(nextPublishStatus(from, ev)).toBe(to));
  it('表に無い遷移はすべて IllegalTransition（none からの rollback / stop を含む）', () => {
    for (const from of PUBLISH)
      for (const ev of events(PUBLISH_TRANSITIONS)) {
        if (PUBLISH_EXPECTED.some(([f, e]) => f === from && e === ev)) continue;
        expect(() => nextPublishStatus(from, ev)).toThrow(IllegalTransition);
      }
    expect(() => nextPublishStatus('none', 'rollback')).toThrow(IllegalTransition);
    expect(() => nextPublishStatus('stopped', 'stop')).toThrow(IllegalTransition);
  });
});

describe('factory_jobs.status', () => {
  it.each(JOB_EXPECTED)('%s --%s--> %s', (from, ev, to) => expect(nextJobStatus(from, ev)).toBe(to));
  it('表に無い遷移はすべて IllegalTransition（終端からは動かない）', () => {
    for (const from of JOB)
      for (const ev of events(JOB_TRANSITIONS)) {
        if (JOB_EXPECTED.some(([f, e]) => f === from && e === ev)) continue;
        expect(() => nextJobStatus(from, ev)).toThrow(IllegalTransition);
      }
    for (const t of ['done', 'failed', 'cancelled'] as JobStatus[])
      for (const ev of events(JOB_TRANSITIONS)) expect(() => nextJobStatus(t, ev)).toThrow(IllegalTransition);
  });
  it('queued から running へ直接は行けない（creating を経る）', () => {
    expect(() => nextJobStatus('queued', 'created')).toThrow(IllegalTransition);
  });
});

describe('material_versions.status', () => {
  it.each(VERSION_EXPECTED)('%s --%s--> %s', (from, ev, to) => expect(nextVersionStatus(from, ev)).toBe(to));
  it('approved / rejected は終端', () => {
    for (const from of VERSION)
      for (const ev of events(VERSION_TRANSITIONS)) {
        if (VERSION_EXPECTED.some(([f, e]) => f === from && e === ev)) continue;
        expect(() => nextVersionStatus(from, ev)).toThrow(IllegalTransition);
      }
  });
});

describe('表の件数が契約と一致', () => {
  it('work 9 / publish 3 行 / job 11 行 / version 3', () => {
    expect(WORK_TRANSITIONS.length).toBe(9);
    expect(PUBLISH_TRANSITIONS.length).toBe(3);
    expect(JOB_TRANSITIONS.length).toBe(11);
    expect(VERSION_TRANSITIONS.length).toBe(3);
  });
});
