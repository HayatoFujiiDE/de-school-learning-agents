import { describe, expect, it } from 'vitest';
import {
  IllegalTransition,
  JOB_TRANSITIONS,
  PUBLISH_TRANSITIONS,
  VERSION_TRANSITIONS,
  WORK_TRANSITIONS,
  isReingestable,
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
  ['idle', 'reingested', 'making'],
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
  ['failed', 'reingest', 'running'],
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

describe('work_status の reingest', () => {
  it('idle → making は reingested の辺だけ（queued を経ずに making へ入る経路は他に無い）', () => {
    expect(nextWorkStatus('idle', 'reingested')).toBe('making');
    for (const from of WORK.filter((s) => s !== 'idle')) expect(() => nextWorkStatus(from, 'reingested')).toThrow(IllegalTransition);
    for (const ev of events(WORK_TRANSITIONS).filter((e) => e !== 'reingested'))
      if (ev !== 'job_queued') expect(() => nextWorkStatus('idle', ev)).toThrow(IllegalTransition);
    expect(WORK_TRANSITIONS.filter((r) => r.to === 'making' && r.from.includes('idle')).map((r) => r.event)).toEqual(['reingested']);
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
  it('表に無い遷移はすべて IllegalTransition（終端からは動かない。failed は reingest の辺だけ）', () => {
    for (const from of JOB)
      for (const ev of events(JOB_TRANSITIONS)) {
        if (JOB_EXPECTED.some(([f, e]) => f === from && e === ev)) continue;
        expect(() => nextJobStatus(from, ev)).toThrow(IllegalTransition);
      }
    for (const t of ['done', 'cancelled'] as JobStatus[])
      for (const ev of events(JOB_TRANSITIONS)) expect(() => nextJobStatus(t, ev)).toThrow(IllegalTransition);
  });
  it('failed → running は reingest の辺だけ（他の文脈では IllegalTransition）', () => {
    expect(nextJobStatus('failed', 'reingest')).toBe('running');
    for (const ev of events(JOB_TRANSITIONS).filter((e) => e !== 'reingest')) expect(() => nextJobStatus('failed', ev)).toThrow(IllegalTransition);
    // reingest は failed 以外からは使えない（done / cancelled / 進行中から running へ戻す経路にならない）
    for (const from of JOB.filter((s) => s !== 'failed')) expect(() => nextJobStatus(from, 'reingest')).toThrow(IllegalTransition);
  });
  it('reingest の述語は failed + invalid_outputs + session あり だけ（§B-4-e 1・§R-43）', () => {
    expect(isReingestable({ status: 'failed', error: 'invalid_outputs', session_id: 'sesn_1' })).toBe(true);
    for (const error of ['terminated_without_outputs', 'terminated_waiting_answer', 'too_many_denies', 'create_unconfirmed', 'retries_exhausted', null])
      expect(isReingestable({ status: 'failed', error, session_id: 'sesn_1' }), String(error)).toBe(false);
    expect(isReingestable({ status: 'failed', error: 'invalid_outputs', session_id: null })).toBe(false);
    expect(isReingestable({ status: 'failed', error: 'invalid_outputs', session_id: '' })).toBe(false);
    for (const status of JOB.filter((s) => s !== 'failed')) expect(isReingestable({ status, error: 'invalid_outputs', session_id: 'sesn_1' })).toBe(false);
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
  it('work 10 / publish 3 行 / job 12 行 / version 3', () => {
    expect(WORK_TRANSITIONS.length).toBe(10);
    expect(PUBLISH_TRANSITIONS.length).toBe(3);
    expect(JOB_TRANSITIONS.length).toBe(12);
    expect(VERSION_TRANSITIONS.length).toBe(3);
  });
});
