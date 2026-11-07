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
const skipMark = (jid: string) => (JSON.parse(String(job(jid).reconcile_state_json)) as { auto_answer?: { skip?: string } }).auto_answer?.skip;
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
    // 一度 no_default になった job は印（auto_answer.skip）で以後の候補から外れる
    expect(await autoAnswerStep(w.env, port, { deadline: FAR() })).toEqual({ answered: [], skipped: [{ job_id: c, reason: 'no_default' }] });
    expect(await autoAnswerStep(w.env, port, { deadline: FAR() })).toEqual({ answered: [], skipped: [] });
    for (const j of [a, b, c]) {
      expect(job(j)).toMatchObject({ status: 'needs_answer', answer_state: 'none' });
      expect(attempts(j)).toBeUndefined();
      expect(skipMark(j)).toBe('no_default');
    }
    expect(sent).toEqual([]);
    expect(autoLogs()).toEqual([a, b, c].map((j) => ({ at: 'auto_answer', job_id: j, result: 'no_default' })));
    // 見える化: 管理画面の last_error にも印（既にあれば上書きしない）
    for (const j of [a, b, c]) expect(one(w.db, 'SELECT last_error FROM factory_jobs WHERE id = ?', j).last_error).toBe('auto_answer:no_default');
    // ちょうど 4,000 字なら答える
    const w2 = world();
    w = w2;
    const d = seedJob(1, { questions: [{ id: 'q1', question: 'x', why: '', default: 'あ'.repeat(4000 - AUTO_ANSWER_PREFIX.length) }] });
    expect((await autoAnswerStep(w.env, fakePort().port, { deadline: FAR() })).answered).toEqual([d]);
  });

  it('質問 id が重複・空なら no_default で答えない（2 つ目の質問に 1 つ目の default を送らない）', async () => {
    const dup = seedJob(1, { questions: [QS[0], { ...QS[1], id: 'q1' }] });
    const empty = seedJob(2, { questions: [QS[0], { ...QS[1], id: '' }] });
    const { port, sent } = fakePort();
    expect(await autoAnswerStep(w.env, port, { deadline: FAR() })).toEqual({ answered: [], skipped: [{ job_id: dup, reason: 'no_default' }, { job_id: empty, reason: 'no_default' }] });
    for (const j of [dup, empty]) {
      expect(job(j)).toMatchObject({ status: 'needs_answer', answer_state: 'none' });
      expect(attempts(j)).toBeUndefined();
      expect(skipMark(j)).toBe('no_default');
      expect(one(w.db, 'SELECT last_error FROM factory_jobs WHERE id = ?', j).last_error).toBe('auto_answer:no_default');
    }
    expect(sent).toEqual([]);
    expect(autoLogs()).toEqual([dup, empty].map((j) => ({ at: 'auto_answer', job_id: j, result: 'no_default' })));
  });

  it('no_default の job が先頭に居ても後ろの自動の差し戻しの job は詰まらない（次の tick で自動回答される）', async () => {
    const noDef = [{ id: 'q1', question: 'x', why: '', default: '' }];
    const a = seedJob(1, { questions: noDef });
    const b = seedJob(2, { questions: noDef });
    const c = seedJob(3);
    const { port } = fakePort();
    expect(await autoAnswerStep(w.env, port, { deadline: FAR() })).toEqual({ answered: [], skipped: [{ job_id: a, reason: 'no_default' }, { job_id: b, reason: 'no_default' }] });
    expect(await autoAnswerStep(w.env, port, { deadline: FAR() })).toEqual({ answered: [c], skipped: [] });
    expect(job(c)).toMatchObject({ status: 'running', phase: 'making', answer_state: 'sent' });
    // 人が管理画面で答える経路は変わらない（印は無視される）
    expect(job(a)).toMatchObject({ status: 'needs_answer', answer_state: 'none' });
  });

  it('no_default の印は last_error が既にあれば上書きしない', async () => {
    const a = seedJob(1, { questions: [{ id: 'q1', question: 'x', why: '', default: '' }] });
    w.db.prepare("UPDATE factory_jobs SET last_error = 'scan_no_progress' WHERE id = ?").run(a);
    expect((await autoAnswerStep(w.env, fakePort().port, { deadline: FAR() })).skipped).toEqual([{ job_id: a, reason: 'no_default' }]);
    expect(one(w.db, 'SELECT last_error FROM factory_jobs WHERE id = ?', a).last_error).toBe('scan_no_progress');
    expect(skipMark(a)).toBe('no_default');
  });

  it('attempts の CAS に負けた時は raced（ログも出す）で answerJob を呼ばない', async () => {
    const jid = seedJob(1);
    const real = w.env.DB;
    // 候補を読んだ後・CAS の前に、別の呼び出しが試行の数を進めた状態を作る
    const DB = new Proxy(real, {
      get(t, k) {
        if (k === 'prepare')
          return (sql: string) => {
            if (sql.startsWith('UPDATE factory_jobs SET reconcile_state_json') && sql.includes('$.auto_answer.attempts'))
              w.db.prepare(`UPDATE factory_jobs SET reconcile_state_json = '{"auto_answer":{"attempts":1}}' WHERE id = ?`).run(jid);
            return t.prepare(sql);
          };
        const v = (t as unknown as Record<string | symbol, unknown>)[k];
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v;
      },
    });
    const { port, sent } = fakePort();
    expect(await autoAnswerStep({ ...w.env, DB } as typeof w.env, port, { deadline: FAR() })).toEqual({ answered: [], skipped: [{ job_id: jid, reason: 'raced' }] });
    expect(autoLogs()).toEqual([{ at: 'auto_answer', job_id: jid, result: 'raced' }]);
    expect(job(jid)).toMatchObject({ status: 'needs_answer', answer_state: 'none' });
    expect(sent).toEqual([]);
  });

  it("reconcile_state_json が '' や壊れた JSON の行があっても段は止まらない（0 回として扱い、'{}' から書き直して答える）", async () => {
    const a = seedJob(1);
    const b = seedJob(2);
    w.db.prepare("UPDATE factory_jobs SET reconcile_state_json = '{broken' WHERE id = ?").run(a);
    w.db.prepare("UPDATE factory_jobs SET reconcile_state_json = '' WHERE id = ?").run(b);
    expect(await autoAnswerStep(w.env, fakePort().port, { deadline: FAR() })).toEqual({ answered: [a, b], skipped: [] });
    expect([attempts(a), attempts(b)]).toEqual([1, 1]);
    // default の欠ける壊れた行も印を書いて外れる
    const c = seedJob(3, { questions: [{ id: 'q1', question: 'x', why: '', default: '' }] });
    w.db.prepare("UPDATE factory_jobs SET reconcile_state_json = '[1' WHERE id = ?").run(c);
    expect((await autoAnswerStep(w.env, fakePort().port, { deadline: FAR() })).skipped).toEqual([{ job_id: c, reason: 'no_default' }]);
    expect(skipMark(c)).toBe('no_default');
    expect(await autoAnswerStep(w.env, fakePort().port, { deadline: FAR() })).toEqual({ answered: [], skipped: [] });
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

  it('attempts 3 の job は候補に出ない（answerJob を呼ばず、cap のログも出ない）。先頭に 2 件あっても後ろの job は同じ tick で答える', async () => {
    const jid = seedJob(1, { state: { auto_answer: { attempts: 3 } } });
    const j2 = seedJob(2, { state: { auto_answer: { attempts: 3 } } });
    const c = seedJob(3);
    const { port, sent } = fakePort();
    expect(await autoAnswerStep(w.env, port, { deadline: FAR() })).toEqual({ answered: [c], skipped: [] });
    for (const j of [jid, j2]) {
      expect(job(j)).toMatchObject({ status: 'needs_answer', answer_state: 'none' });
      expect(attempts(j)).toBe(3);
    }
    expect(sent).toHaveLength(2); // c の 1 回分（回答 + define_outcome）だけ
    expect(autoLogs()).toEqual([{ at: 'auto_answer', job_id: c, result: 'sent' }]);
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

    // 失敗が続く job: 3 回試して止まる（以後は候補に出ない）
    const k = seedJob(2);
    for (let i = 1; i <= 3; i++) {
      expect((await autoAnswerStep(w.env, bad.port, { deadline: FAR() })).skipped).toEqual([{ job_id: k, reason: 'refused' }]);
      expect(attempts(k)).toBe(i);
    }
    expect(await autoAnswerStep(w.env, okp.port, { deadline: FAR() })).toEqual({ answered: [], skipped: [] });
    expect(job(k)).toMatchObject({ status: 'needs_answer', answer_state: 'saved' });
    expect(attempts(k)).toBe(3);
  });

  it('auto_answer が null や配列の行でも attempts が数えられ、送信の失敗が続けば 3 回で止まる', async () => {
    for (const [n, inner] of [
      [1, null],
      [2, []],
    ] as const) {
      w = world();
      const jid = seedJob(n, { state: { auto_answer: inner } });
      let calls = 0;
      const bad = fakePort({ fail: true });
      const counting = {
        ...bad.port,
        async sendEvents(id: string, evs: unknown[]) {
          calls++;
          return bad.port.sendEvents(id, evs as never);
        },
      } as unknown as FactoryPort;
      for (let i = 0; i < 5; i++) await autoAnswerStep(w.env, counting, { deadline: FAR() });
      expect(calls).toBe(3);
      expect(attempts(jid)).toBe(3);
      expect(job(jid)).toMatchObject({ status: 'needs_answer', answer_state: 'saved' });
    }
  });

  it('auto_answer が null の行で default が欠ければ skip の印を書いて以後の候補から外れる', async () => {
    const jid = seedJob(1, { questions: [{ id: 'q1', question: 'x', why: '', default: '' }], state: { auto_answer: null } });
    expect((await autoAnswerStep(w.env, fakePort().port, { deadline: FAR() })).skipped).toEqual([{ job_id: jid, reason: 'no_default' }]);
    expect(skipMark(jid)).toBe('no_default');
    expect(await autoAnswerStep(w.env, fakePort().port, { deadline: FAR() })).toEqual({ answered: [], skipped: [] });
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
