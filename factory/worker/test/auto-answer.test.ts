// 自動回答の段（契約 V-12・V-11 u11）を node:sqlite の実 DB と作り物の port で確かめる。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FactoryPort } from '../src/anthropic';
import { AUTO_ANSWER_PREFIX, autoAnswerStep } from '../src/auto-answer';
import { AUTO_TRIAGE_EMAIL } from '../src/triage-step';
import { one, rows } from './d1-shim';
import { good, seed, setSetting, world, type World } from './review-auto-helpers';

const FAR = () => Date.now() + 10 * 60_000;
let w: World;
let logs: Array<Record<string, unknown>>;

beforeEach(() => {
  w = world();
  logs = [];
  vi.spyOn(console, 'log').mockImplementation((s: unknown) => {
    try {
      logs.push(JSON.parse(String(s)));
    } catch {
      /* JSON でないログは見ない */
    }
  });
});
afterEach(() => vi.restoreAllMocks());

const QS = [
  { id: 'q1', question: '対象の学年は？', why: '難しさ', default: '小学 4 年' },
  { id: 'q2', question: '図は何枚？', why: '量', default: ' 2 枚 ' },
];

/** 素材 + 親の版 + 親の版の return（who）+ 質問待ちの rework job */
function seedJob(n: number, o: { who?: string; questions?: unknown; answerState?: string; answers?: unknown; state?: unknown; updatedAt?: string } = {}): string {
  const mid = `m${n}`;
  const vid = `v${n}`;
  const jid = `j${n}`;
  seed(w, good(mid, vid));
  w.db.prepare("UPDATE material_versions SET status = 'rejected' WHERE id = ?").run(vid);
  w.db
    .prepare("INSERT INTO review_decisions (id, material_version_id, material_id, decision, reviewer_email, created_at) VALUES (?, ?, ?, 'return', ?, '2026-11-07T00:00:00.000Z')")
    .run(`d${n}`, vid, mid, o.who ?? AUTO_TRIAGE_EMAIL);
  const at = o.updatedAt ?? `2026-11-07T00:0${n}:00.000Z`;
  w.db
    .prepare(
      `INSERT INTO factory_jobs (id, material_id, kind, model, phase, status, session_id, parent_version_id, brief_md, questions_json, answers_json, answer_state, reconcile_state_json, created_at, updated_at)
       VALUES (?, ?, 'rework', 'claude-opus-5-5', 'questions', 'needs_answer', ?, ?, '注文', ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      jid,
      mid,
      `sesn-${jid}`,
      vid,
      JSON.stringify(o.questions ?? QS),
      o.answers === undefined ? null : JSON.stringify(o.answers),
      o.answerState ?? 'none',
      JSON.stringify(o.state ?? {}),
      at,
      at,
    );
  return jid;
}

/** answerJob が使う 2 つだけを持つ port。fail なら sendEvents が失敗する */
function fakePort(o: { fail?: boolean } = {}): { port: FactoryPort; sent: unknown[] } {
  const sent: unknown[] = [];
  const port = {
    isFake: false,
    async listEventsPage() {
      return { data: [], next: null };
    },
    async sendEvents(_id: string, evs: unknown[]) {
      if (o.fail) throw new Error('send_failed');
      sent.push(...evs);
    },
  } as unknown as FactoryPort;
  return { port, sent };
}

const job = (jid: string) => one(w.db, 'SELECT status, phase, answer_state, reconcile_state_json FROM factory_jobs WHERE id = ?', jid);
const attempts = (jid: string) => (JSON.parse(String(job(jid).reconcile_state_json)) as { auto_answer?: { attempts?: number } }).auto_answer?.attempts;
const autoLogs = () => logs.filter((l) => l.at === 'auto_answer');
const sentText = (sent: unknown[]) => JSON.stringify(sent);

describe('autoAnswerStep（契約 V-12・u11）', () => {
  it('自動の差し戻しの job で全質問に default → answerJob が呼ばれ running / making・standards_log に接頭辞つき・attempts 1・ログ sent', async () => {
    const jid = seedJob(1);
    const { port, sent } = fakePort();
    expect(await autoAnswerStep(w.env, port, { deadline: FAR() })).toEqual({ answered: [jid], skipped: [] });
    expect(job(jid)).toMatchObject({ status: 'running', phase: 'making', answer_state: 'sent' });
    expect(attempts(jid)).toBe(1);
    // answerJob の走査の保存（scan.answer）で auto_answer の key が消えていない
    expect(Object.keys(JSON.parse(String(job(jid).reconcile_state_json))).sort()).toEqual(['auto_answer', 'scan']);
    expect(rows(w.db, "SELECT kind, question, answer FROM standards_log WHERE job_id = ? ORDER BY question", jid)).toEqual([
      { kind: 'question', question: '図は何枚？', answer: `${AUTO_ANSWER_PREFIX}2 枚` },
      { kind: 'question', question: '対象の学年は？', answer: `${AUTO_ANSWER_PREFIX}小学 4 年` },
    ]);
    expect(sentText(sent)).toContain('# 運営からの回答');
    expect(sentText(sent)).toContain(`${AUTO_ANSWER_PREFIX}小学 4 年`);
    expect(autoLogs()).toEqual([{ at: 'auto_answer', job_id: jid, result: 'sent' }]);
    expect(AUTO_ANSWER_PREFIX).toBe('（自動回答・職人の既定案のとおり）');
  });

  it('人の差し戻しの job には触らない', async () => {
    const jid = seedJob(1, { who: 'ops@example.invalid' });
    const { port, sent } = fakePort();
    expect(await autoAnswerStep(w.env, port, { deadline: FAR() })).toEqual({ answered: [], skipped: [] });
    expect(job(jid)).toMatchObject({ status: 'needs_answer', answer_state: 'none' });
    expect(attempts(jid)).toBeUndefined();
    expect(sent).toEqual([]);
  });

  it('default の無い質問が 1 つでもあれば no_default で触らない（attempts 不変）。接頭辞を含めて 4,000 字を超える default も同じ', async () => {
    const a = seedJob(1, { questions: [QS[0], { ...QS[1], default: '  ' }] });
    const b = seedJob(2, { questions: [{ id: 'q1', question: 'x', why: '', default: 'あ'.repeat(4000 - AUTO_ANSWER_PREFIX.length + 1) }] });
    const c = seedJob(3, { questions: [{ id: 'q1', question: 'x', why: '' }] });
    const { port, sent } = fakePort();
    const r = await autoAnswerStep(w.env, port, { deadline: FAR() });
    expect(r).toEqual({ answered: [], skipped: [{ job_id: a, reason: 'no_default' }, { job_id: b, reason: 'no_default' }] });
    expect(await autoAnswerStep(w.env, port, { deadline: FAR() })).toEqual({
      answered: [],
      skipped: [{ job_id: a, reason: 'no_default' }, { job_id: b, reason: 'no_default' }],
    });
    for (const j of [a, b, c]) {
      expect(job(j)).toMatchObject({ status: 'needs_answer', answer_state: 'none' });
      expect(attempts(j)).toBeUndefined();
    }
    expect(sent).toEqual([]);
    expect(autoLogs()[0]).toEqual({ at: 'auto_answer', job_id: a, result: 'no_default' });
    // ちょうど 4,000 字なら答える
    const w2 = world();
    w = w2;
    const d = seedJob(1, { questions: [{ id: 'q1', question: 'x', why: '', default: 'あ'.repeat(4000 - AUTO_ANSWER_PREFIX.length) }] });
    expect((await autoAnswerStep(w.env, fakePort().port, { deadline: FAR() })).answered).toEqual([d]);
  });

  it('paused なら何もしない（attempts 不変）', async () => {
    const jid = seedJob(1);
    setSetting(w, 'paused', '1');
    const { port, sent } = fakePort();
    expect(await autoAnswerStep(w.env, port, { deadline: FAR() })).toEqual({ answered: [], skipped: [], paused: true });
    expect(job(jid)).toMatchObject({ status: 'needs_answer', answer_state: 'none' });
    expect(attempts(jid)).toBeUndefined();
    expect(sent).toEqual([]);
  });

  it('attempts 3 で cap（answerJob を呼ばない）', async () => {
    const jid = seedJob(1, { state: { auto_answer: { attempts: 3 } } });
    const { port, sent } = fakePort();
    expect(await autoAnswerStep(w.env, port, { deadline: FAR() })).toEqual({ answered: [], skipped: [{ job_id: jid, reason: 'cap' }] });
    expect(job(jid)).toMatchObject({ status: 'needs_answer', answer_state: 'none' });
    expect(attempts(jid)).toBe(3);
    expect(sent).toEqual([]);
    expect(autoLogs()).toEqual([{ at: 'auto_answer', job_id: jid, result: 'cap' }]);
  });

  it('送信の失敗で saved に戻り、次の tick で送り直す。失敗が続けば 3 回で止まる', async () => {
    const jid = seedJob(1);
    const bad = fakePort({ fail: true });
    expect(await autoAnswerStep(w.env, bad.port, { deadline: FAR() })).toEqual({ answered: [], skipped: [{ job_id: jid, reason: 'refused' }] });
    expect(job(jid)).toMatchObject({ status: 'needs_answer', answer_state: 'saved' });
    expect(attempts(jid)).toBe(1);
    expect(autoLogs()).toEqual([{ at: 'auto_answer', job_id: jid, result: 'anthropic_error' }]);
    // 保存済みの回答（接頭辞つき）をそのまま送り直す
    const okp = fakePort();
    expect(await autoAnswerStep(w.env, okp.port, { deadline: FAR() })).toEqual({ answered: [jid], skipped: [] });
    expect(job(jid)).toMatchObject({ status: 'running', phase: 'making', answer_state: 'sent' });
    expect(attempts(jid)).toBe(2);
    expect(sentText(okp.sent)).toContain(`${AUTO_ANSWER_PREFIX}小学 4 年`);
    expect(Number(one(w.db, 'SELECT COUNT(*) AS n FROM standards_log WHERE job_id = ?', jid).n)).toBe(2);

    // 失敗が続く job: 3 回試して cap
    const k = seedJob(2);
    for (let i = 1; i <= 3; i++) {
      expect((await autoAnswerStep(w.env, bad.port, { deadline: FAR() })).skipped).toEqual([{ job_id: k, reason: 'refused' }]);
      expect(attempts(k)).toBe(i);
    }
    expect((await autoAnswerStep(w.env, okp.port, { deadline: FAR() })).skipped).toEqual([{ job_id: k, reason: 'cap' }]);
    expect(job(k)).toMatchObject({ status: 'needs_answer', answer_state: 'saved' });
    expect(attempts(k)).toBe(3);
  });

  it('人が保存した回答が saved で止まっている自動の差し戻しの job は、その回答をそのまま送る', async () => {
    const jid = seedJob(1, {
      answerState: 'saved',
      answers: [
        { question_id: 'q1', answer: '人の回答 1' },
        { question_id: 'q2', answer: '人の回答 2' },
      ],
    });
    const { port, sent } = fakePort();
    expect(await autoAnswerStep(w.env, port, { deadline: FAR() })).toEqual({ answered: [jid], skipped: [] });
    expect(sentText(sent)).toContain('人の回答 1');
    expect(sentText(sent)).not.toContain(AUTO_ANSWER_PREFIX);
  });

  it('残り時間が 30 秒未満なら始めない（attempts 不変）', async () => {
    const jid = seedJob(1);
    const { port, sent } = fakePort();
    expect(await autoAnswerStep(w.env, port, { deadline: Date.now() + 29_000 })).toEqual({ answered: [], skipped: [] });
    expect(job(jid)).toMatchObject({ status: 'needs_answer', answer_state: 'none' });
    expect(attempts(jid)).toBeUndefined();
    expect(sent).toEqual([]);
  });

  it('1 tick 2 件（古い順）。残りは次の tick', async () => {
    const c = seedJob(3, { updatedAt: '2026-11-07T00:00:03.000Z' });
    const a = seedJob(1, { updatedAt: '2026-11-07T00:00:01.000Z' });
    const b = seedJob(2, { updatedAt: '2026-11-07T00:00:02.000Z' });
    const { port } = fakePort();
    expect((await autoAnswerStep(w.env, port, { deadline: FAR() })).answered).toEqual([a, b]);
    expect(job(c)).toMatchObject({ status: 'needs_answer', answer_state: 'none' });
    expect((await autoAnswerStep(w.env, port, { deadline: FAR() })).answered).toEqual([c]);
  });
});
