// 会議（§K-5）: 出力の検査、起こす条件、回収（node:sqlite の実 DB + fixture）で §K-8 (r)(s) を確かめる。
import { beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import type { MessageBatchIndividualResponse } from '@anthropic-ai/sdk/resources/messages/batches';
import { PortError } from '../src/anthropic';
import type { Env } from '../src/env';
import { collectMeetings, meetingDueOn, parseMeetingOutput, startMeeting } from '../src/meeting';
import { d1, migratedDb, one, rows } from './d1-shim';
import { fixtureJson, intakePort } from './intake-port';

function resultFor(customId: string, mutate?: (o: Record<string, unknown>) => void, existingId?: string): MessageBatchIndividualResponse[] {
  const fx = fixtureJson<{ stop_reason: string; usage: Record<string, number>; output: { ranked: Array<Record<string, unknown>> } }>('meeting/results.json');
  const out = JSON.parse(JSON.stringify(fx.output)) as Record<string, unknown> & { ranked: Array<Record<string, unknown>> };
  for (const r of out.ranked) if (r.proposal_id === '{{FIRST_PROPOSED}}') r.proposal_id = existingId ?? 'missing-id';
  mutate?.(out);
  return [
    {
      custom_id: customId,
      result: {
        type: 'succeeded',
        message: {
          content: [
            { type: 'thinking', thinking: '', signature: 's' },
            { type: 'text', text: JSON.stringify(out) },
          ],
          stop_reason: fx.stop_reason,
          usage: fx.usage,
        },
      },
    } as unknown as MessageBatchIndividualResponse,
  ];
}

describe('parseMeetingOutput', () => {
  it('views 4 つ・ranked・standards_suggestions を読み、視点は 400 文字で切る', () => {
    const o = fixtureJson<{ output: Record<string, unknown> }>('meeting/results.json').output as { views: Record<string, string> };
    o.views.research = 'あ'.repeat(500);
    const r = parseMeetingOutput(JSON.stringify(o));
    expect(r?.views.research.length).toBe(400);
    expect(r?.ranked).toHaveLength(2);
    expect(r?.standards_suggestions).toEqual(['測定の素材には単位と測った条件を必ず書く']);
  });
  it('形が違えば null', () => {
    expect(parseMeetingOutput('x')).toBeNull();
    expect(parseMeetingOutput('{"views":{"research":"a"},"ranked":[],"standards_suggestions":[]}')).toBeNull();
    expect(parseMeetingOutput('{"views":{"research":"a","pedagogy":"b","expression":"c","verification":"d"},"ranked":{},"standards_suggestions":[]}')).toBeNull();
  });
});

describe('meetingDueOn', () => {
  it('Asia/Tokyo の日が MEETING_DAYS に含まれ、今日まだ起こしていない時だけ', () => {
    const d = new Date('2026-11-14T16:00:00.000Z'); // JST 11/15 01:00
    expect(meetingDueOn([1, 15], null, d)).toBe(true);
    expect(meetingDueOn([1, 15], '2026-11-15', d)).toBe(false);
    expect(meetingDueOn([1], null, d)).toBe(false);
    expect(meetingDueOn([], null, d)).toBe(false);
  });
});

describe('会議（node:sqlite の実 DB + fixture）', () => {
  let raw: DatabaseSync;
  let env: Env;
  const T = '2026-11-04T00:00:00.000Z';
  const deadline = () => Date.now() + 25_000;
  beforeEach(() => {
    raw = migratedDb();
    env = { DB: d1(raw), DAILY_CAP_CENTS: '1500', MEETING_MONTHLY_CAP_CENTS: '200' } as unknown as Env;
    raw.prepare(
      "INSERT INTO proposals (id, created_at, updated_at, source_kind, source_ref, title, body) VALUES ('p-old', ?, ?, 'child', 'staff@example.invalid', '影の長さ', '本文')",
    ).run(T, T);
  });

  it('(r) 起こす: Batch 1 件（sonnet・adaptive・json_schema）で submitted。submitted がある間は起こさない', async () => {
    const p = intakePort();
    const s = await startMeeting(env, p.port, { trigger: 'manual', deadline: deadline() });
    expect(s).toMatchObject({ status: 'submitted', batch_id: 'msgbatch_test_1' });
    const req = p.last.createBatch as { requests: Array<{ custom_id: string; params: Record<string, unknown> }> };
    expect(req.requests).toHaveLength(1);
    expect(req.requests[0].custom_id).toBe((s as { meeting_id: string }).meeting_id);
    expect(req.requests[0].params).toMatchObject({ model: 'claude-sonnet-5-5', max_tokens: 8192, thinking: { type: 'adaptive' } });
    expect((req.requests[0].params.output_config as { format: { type: string } }).format.type).toBe('json_schema');
    expect(String((req.requests[0].params.messages as Array<{ content: string }>)[0].content)).toContain('id=p-old');
    expect(String((req.requests[0].params.messages as Array<{ content: string }>)[0].content)).not.toContain('staff@example.invalid');
    expect(one(raw, 'SELECT status, batch_id FROM meeting_minutes')).toEqual({ status: 'submitted', batch_id: 'msgbatch_test_1' });

    expect(await startMeeting(env, p.port, { trigger: 'manual', deadline: deadline() })).toEqual({ status: 'already_submitted' });
    expect(p.calls.createBatch).toBe(1);
  });

  it('(r) 回収: ended → minutes_json・meeting の提案・既存提案の priority・費用（定価の 50%）', async () => {
    const s = (await startMeeting(env, intakePort().port, { trigger: 'manual', deadline: deadline() })) as { meeting_id: string };
    const p = intakePort({ batchResults: async () => resultFor(s.meeting_id, undefined, 'p-old') });
    expect(await collectMeetings(env, p.port, { deadline: deadline() })).toEqual([`${s.meeting_id}:ended`]);
    const m = one(raw, 'SELECT status, minutes_json, proposed, cents FROM meeting_minutes');
    expect(m.status).toBe('ended');
    expect(m.proposed).toBe(1);
    // (20,000×2 + 3,000×10) × 0.5 = 35,000 micro → 4 セント
    expect(m.cents).toBe(4);
    const minutes = JSON.parse(String(m.minutes_json));
    expect(Object.keys(minutes.views)).toEqual(['research', 'pedagogy', 'expression', 'verification']);
    expect(minutes.ranked.map((r: { action: string }) => r.action)).toEqual(['priority', 'inserted']);
    expect(minutes.standards_suggestions).toHaveLength(1);
    expect(one(raw, "SELECT priority, status FROM proposals WHERE id = 'p-old'")).toEqual({ priority: 5, status: 'proposed' });
    const added = rows(raw, "SELECT source_kind, source_ref, priority, title FROM proposals WHERE source_kind = 'meeting'");
    expect(added).toEqual([{ source_kind: 'meeting', source_ref: s.meeting_id, priority: 3, title: '影の長さで時刻を知る' }]);
    expect(rows(raw, "SELECT kind, cents FROM cost_ledger")).toEqual([{ kind: 'meeting', cents: 4 }]);
    // standards_log には書かない（§K-5-5）
    expect(one(raw, 'SELECT COUNT(*) AS c FROM standards_log').c).toBe(0);
    // 2 回目の回収は何もしない（二重に入れない）
    expect(await collectMeetings(env, p.port, { deadline: deadline() })).toEqual([]);
    expect(one(raw, 'SELECT COUNT(*) AS c FROM proposals').c).toBe(2);
  });

  it('schema 外の出力は failed（費用は記録する）', async () => {
    const s = (await startMeeting(env, intakePort().port, { trigger: 'manual', deadline: deadline() })) as { meeting_id: string };
    const p = intakePort({ batchResults: async () => resultFor(s.meeting_id, (o) => delete o.views) });
    await collectMeetings(env, p.port, { deadline: deadline() });
    expect(one(raw, 'SELECT status, last_error, cents FROM meeting_minutes')).toEqual({ status: 'failed', last_error: 'invalid_output', cents: 4 });
    expect(one(raw, "SELECT COUNT(*) AS c FROM proposals WHERE source_kind = 'meeting'").c).toBe(0);
  });

  it('errored の result は failed。ended でないまま 24 時間過ぎたら expired', async () => {
    const s = (await startMeeting(env, intakePort().port, { trigger: 'manual', deadline: deadline() })) as { meeting_id: string };
    const p = intakePort({ batchResults: async () => [{ custom_id: s.meeting_id, result: { type: 'errored', error: {} } } as unknown as MessageBatchIndividualResponse] });
    await collectMeetings(env, p.port, { deadline: deadline() });
    expect(one(raw, 'SELECT status, last_error FROM meeting_minutes')).toEqual({ status: 'failed', last_error: 'result_errored' });

    const s2 = (await startMeeting(env, intakePort().port, { trigger: 'manual', deadline: deadline() })) as { meeting_id: string };
    const p2 = intakePort({ retrieveBatch: async (id: string) => ({ id, processing_status: 'in_progress', created_at: T, expires_at: T }) });
    expect(await collectMeetings(env, p2.port, { deadline: deadline() })).toEqual([`${s2.meeting_id}:in_progress`]);
    const later = new Date(Date.now() + 25 * 3600_000);
    await collectMeetings(env, p2.port, { deadline: deadline(), now: later });
    expect(one(raw, 'SELECT status FROM meeting_minutes WHERE id = ?', s2.meeting_id).status).toBe('expired');
  });

  it('(s) 月次上限 0 なら起こさない（行も作らず Batch も呼ばない）。pause 中も起こさない', async () => {
    (env as unknown as Record<string, string>).MEETING_MONTHLY_CAP_CENTS = '0';
    const p = intakePort();
    expect(await startMeeting(env, p.port, { trigger: 'cron', deadline: deadline() })).toEqual({ status: 'skipped', reason: 'monthly_cap' });
    (env as unknown as Record<string, string>).MEETING_MONTHLY_CAP_CENTS = '200';
    raw.prepare("INSERT INTO settings VALUES ('paused', '1', 't')").run();
    expect(await startMeeting(env, p.port, { trigger: 'cron', deadline: deadline() })).toEqual({ status: 'paused' });
    expect(p.calls).toEqual({});
    expect(one(raw, 'SELECT COUNT(*) AS c FROM meeting_minutes').c).toBe(0);
  });

  it('Batch の作成が 429 なら failed で止まり、もう一度は起こさない（同じ日の meeting_last_day が入る）', async () => {
    const p = intakePort({
      createBatch: async () => {
        throw new PortError(true, 429, 'api_error');
      },
    });
    expect(await startMeeting(env, p.port, { trigger: 'cron', deadline: deadline() })).toMatchObject({ status: 'failed', error: 'batch_429' });
    expect(one(raw, "SELECT value FROM settings WHERE key = 'meeting_last_day'").value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(p.calls.createBatch).toBe(1);
  });
});
