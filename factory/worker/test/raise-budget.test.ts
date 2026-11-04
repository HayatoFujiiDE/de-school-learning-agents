// POST /api/jobs/:id/raise-budget（契約 §B-4-f）。予算に当たった job を運営の許可で増額する。
// 公式（managed-agents/budgets）: 予算を上げる update が受理されると止まった作業は自動で再開し、予算で止まっている間の user.message は 400。
// だから events は送らない（send は 0 回）。job を running に戻すのは reconcile。
// node:sqlite の実 DB + stub の port で各分岐を、index.fetch + fake port（budget-reached / budget-raise-stays-idle）で route と reconcile を通しで確かめる。
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { PortError, type FactoryPort, type SessionView } from '../src/anthropic';
import { setSetting, tokyoDay } from '../src/db';
import type { Env } from '../src/env';
import { createFakePort } from '../src/fake/anthropic';
import worker from '../src/index';
import { newBudgetCents, raiseBudget } from '../src/raise-budget';
import { d1, migratedDb, one } from './d1-shim';

const T = '2026-11-05T00:00:00.000Z';
const no = () => {
  throw new Error('not used in this test');
};

let db: DatabaseSync;
let env: Env;

interface Stub {
  port: FactoryPort;
  updates: Array<{ id: string; cents: number }>;
  sent: unknown[][];
  retrieves: number;
}

/** sessionCost: retrieve が返す usage.list_cost（cents）。既定 1015 */
function stubPort(o: { sessionCost?: number | null; onUpdate?: (cents: number) => void; retrieveError?: Error } = {}): Stub {
  const s: Stub = { port: null as unknown as FactoryPort, updates: [], sent: [], retrieves: 0 };
  s.port = {
    isFake: true,
    createSession: no,
    async retrieveSession(id): Promise<SessionView> {
      s.retrieves++;
      if (o.retrieveError) throw o.retrieveError;
      return { id, status: 'idle', listCostCents: o.sessionCost === undefined ? 1015 : o.sessionCost, metadata: {}, created_at: T };
    },
    async updateSessionBudget(id, cents) {
      s.updates.push({ id, cents });
      o.onUpdate?.(cents);
    },
    listSessionsPage: no,
    listEventsPage: no,
    async sendEvents(_id, evs) {
      s.sent.push(evs as unknown[]);
    },
    archiveSession: no,
    listFilesPage: no,
    downloadFile: no,
    createMessage: no,
    createBatch: no,
    retrieveBatch: no,
    batchResults: no,
    listBatchesPage: no,
    xaiResponses: no,
  };
  return s;
}

function seed(o: { status?: string; session_id?: string | null; budget?: number; cost?: number } = {}) {
  db.prepare(
    "INSERT INTO materials (id, slug, title, kinds_json, work_status, publish_status, brief_md, created_at, updated_at) VALUES ('m1', 'm-1', 't', '[3]', 'making', 'none', 'b', ?, ?)",
  ).run(T, T);
  db.prepare(
    `INSERT INTO factory_jobs (id, material_id, kind, model, phase, status, session_id, brief_md, budget_cents, list_cost_cents, created_at, updated_at)
     VALUES ('j1', 'm1', 'draft', 'claude-sonnet-5-5', 'making', ?, ?, 'b', ?, ?, ?, ?)`,
  ).run(o.status ?? 'budget_reached', o.session_id === undefined ? 'sesn_1' : o.session_id, o.budget ?? 1000, o.cost ?? 1015, T, T);
}

const jobRow = () => one(db, "SELECT status, budget_cents, updated_at FROM factory_jobs WHERE id = 'j1'");
const ledger = (cents: number) =>
  db.prepare("INSERT INTO cost_ledger (id, day, kind, ref_id, cents, created_at) VALUES (?, ?, 'session', 'j1', ?, ?)").run(crypto.randomUUID(), tokyoDay(), cents, T);

beforeEach(() => {
  db = migratedDb();
  env = { DB: d1(db) } as unknown as Env;
});

describe('newBudgetCents', () => {
  it.each([
    ['使った額（session）+1 が最大', { budget_cents: 1000, list_cost_cents: 1015 }, 1015, 1000, 2016],
    ['session の使った額が D1 より新しい', { budget_cents: 1000, list_cost_cents: 1015 }, 1200, 1000, 2201],
    ['session の使った額が無い → D1 の 2 つだけ', { budget_cents: 1000, list_cost_cents: 1015 }, null, 1000, 2015],
    ['予算が最大', { budget_cents: 1000, list_cost_cents: 400 }, 400, 500, 1500],
  ])('%s', (_l, job, sessionCost, add, want) => {
    expect(newBudgetCents(job, sessionCost, add)).toBe(want);
  });
});

describe('raiseBudget（stub port）', () => {
  it('成功: budget 1000・cost 1015（D1・session とも）・add 1000 → update の直前に retrieve し、update は 2016、D1 も 2016、send は 0 回', async () => {
    seed();
    const s = stubPort({ sessionCost: 1015 });
    const r = await raiseBudget(env, s.port, 'j1', { add_cents: 1000, note: '続けてよい' });
    expect(r).toEqual({ status: 200, body: { job_id: 'j1', budget_cents: 2016, resumed: 'auto' } });
    expect(s.retrieves).toBe(1);
    expect(s.updates).toEqual([{ id: 'sesn_1', cents: 2016 }]);
    expect(jobRow()).toMatchObject({ status: 'budget_reached', budget_cents: 2016 }); // running に戻すのは reconcile
    expect(s.sent).toEqual([]);
  });

  it('session の usage.list_cost が無ければ D1 から数える（budget 1000・cost 1015・add 1000 → 2015）', async () => {
    seed();
    const s = stubPort({ sessionCost: null });
    const r = await raiseBudget(env, s.port, 'j1', { add_cents: 1000 });
    expect(r.body).toMatchObject({ budget_cents: 2015, resumed: 'auto' });
    expect(s.updates).toEqual([{ id: 'sesn_1', cents: 2015 }]);
  });

  it.each([
    ['status が running', { status: 'running' }],
    ['status が failed', { status: 'failed' }],
    ['session が無い', { session_id: null }],
  ])('409 not_budget_reached（%s）: Anthropic を呼ばない', async (_l, o) => {
    seed(o);
    const s = stubPort();
    const r = await raiseBudget(env, s.port, 'j1', { add_cents: 500 });
    expect(r).toEqual({ status: 409, body: { error: 'not_budget_reached' } });
    expect(s.updates).toEqual([]);
    expect(s.retrieves).toBe(0);
  });

  it('409 paused: Anthropic を呼ばず D1 も変えない', async () => {
    seed();
    await setSetting(env.DB, 'paused', '1');
    const s = stubPort();
    const before = jobRow();
    const r = await raiseBudget(env, s.port, 'j1', { add_cents: 500 });
    expect(r).toEqual({ status: 409, body: { error: 'paused' } });
    expect(s.retrieves).toBe(0);
    expect(s.updates).toEqual([]);
    expect(jobRow()).toEqual(before);
  });

  it('409 job_budget_cap は session の使った額 +1 を含めた新予算で判定する（3999+1+1000 は 5000 で通る / 4000+1+1000 は超える）', async () => {
    seed({ budget: 3000, cost: 3000 });
    env = { ...env, DAILY_CAP_CENTS: '100000' }; // この test は 1 job の上限だけを見る
    const over = stubPort({ sessionCost: 4000 }); // D1 より新しい使った額
    expect(await raiseBudget(env, over.port, 'j1', { add_cents: 1000 })).toEqual({ status: 409, body: { error: 'job_budget_cap' } });
    expect(over.updates).toEqual([]);
    expect(jobRow().budget_cents).toBe(3000);
    const ok = stubPort({ sessionCost: 3999 });
    expect((await raiseBudget(env, ok.port, 'j1', { add_cents: 1000 })).status).toBe(200);
    expect(ok.updates).toEqual([{ id: 'sesn_1', cents: 5000 }]);
  });

  it('409 daily_cap: 今日の費用 + 新予算で増える余地（新予算 − D1 の使った額）が日次上限（既定 1500）以上なら止める（startJob と同じ >=）。上限未満は通る', async () => {
    seed();
    db.prepare("INSERT INTO cost_ledger (id, day, kind, ref_id, cents, created_at) VALUES ('c0', '2000-01-01', 'session', 'jx', 9999, ?)").run(T); // 別の日は数えない
    ledger(999); // 余地は 2016 − 1015 = 1001 → 999 + 1001 = 2000 > 1500
    const s = stubPort();
    expect(await raiseBudget(env, s.port, 'j1', { add_cents: 1000 })).toEqual({ status: 409, body: { error: 'daily_cap' } });
    expect(s.updates).toEqual([]);
    expect(jobRow().budget_cents).toBe(1000);
    // add 500: 余地 1516 − 1015 = 501 → 999 + 501 = 1500（ちょうど上限）は startJob と同じく止める
    expect(await raiseBudget(env, s.port, 'j1', { add_cents: 500 })).toEqual({ status: 409, body: { error: 'daily_cap' } });
    // 上限未満（台帳 998 → 1499）は通る
    db.prepare('DELETE FROM cost_ledger').run();
    ledger(998);
    const r = await raiseBudget(env, s.port, 'j1', { add_cents: 500 });
    expect(r.status).toBe(200);
    expect(s.updates).toEqual([{ id: 'sesn_1', cents: 1516 }]);
  });

  it('409 daily_cap: 動いている他の job の予算も予約として数える（startJob と同じ）', async () => {
    seed();
    db.prepare("INSERT INTO materials (id, slug, title, kinds_json, work_status, publish_status, brief_md, created_at, updated_at) VALUES ('m2', 'm2', 't', '[3]', 'making', 'none', 'b', ?, ?)").run(T, T);
    db.prepare("INSERT INTO factory_jobs (id, material_id, kind, model, phase, status, session_id, brief_md, budget_cents, created_at, updated_at) VALUES ('j2', 'm2', 'draft', 'claude-sonnet-5-5', 'making', 'running', 'sesn_2', 'b', 800, ?, ?)").run(T, T);
    const s = stubPort(); // 余地 1001 + 他の予算 800 = 1801 >= 1500
    expect(await raiseBudget(env, s.port, 'j1', { add_cents: 1000 })).toEqual({ status: 409, body: { error: 'daily_cap' } });
    expect(s.updates).toEqual([]);
  });

  it('409 too_many_running: 同時に動く数が上限なら増額しない（再開すると running に戻るため）', async () => {
    seed();
    for (let i = 0; i < 3; i++) {
      db.prepare(`INSERT INTO materials (id, slug, title, kinds_json, work_status, publish_status, brief_md, created_at, updated_at) VALUES ('mr${i}', 'mr${i}', 't', '[3]', 'making', 'none', 'b', ?, ?)`).run(T, T);
      db.prepare(`INSERT INTO factory_jobs (id, material_id, kind, model, phase, status, session_id, brief_md, budget_cents, created_at, updated_at) VALUES ('r${i}', 'mr${i}', 'draft', 'claude-sonnet-5-5', 'making', 'running', 'sesn_r${i}', 'b', 0, ?, ?)`).run(T, T);
    }
    const s = stubPort();
    expect(await raiseBudget({ ...env, MAX_CONCURRENT_JOBS: '3' } as never, s.port, 'j1', { add_cents: 500 })).toEqual({ status: 409, body: { error: 'too_many_running' } });
    expect(s.updates).toEqual([]);
  });

  it('409 daily_cap: session の使った額が D1 より新しい分も余地に数える（台帳にまだ載っていない）', async () => {
    seed();
    ledger(900); // 余地は (1201 + 500) − 1015 = 686 → 900 + 686 = 1586 > 1500
    const s = stubPort({ sessionCost: 1200 });
    expect(await raiseBudget(env, s.port, 'j1', { add_cents: 500 })).toEqual({ status: 409, body: { error: 'daily_cap' } });
    expect(s.updates).toEqual([]);
  });

  it('409 conflict: Anthropic を上げた後に D1 の budget_cents が他の操作で変わっていたら CAS 0 行', async () => {
    seed();
    const s = stubPort({
      onUpdate: () => {
        db.prepare("UPDATE factory_jobs SET budget_cents = 1516 WHERE id = 'j1'").run(); // 同時に押した別の増額が先に D1 を書いた
      },
    });
    const r = await raiseBudget(env, s.port, 'j1', { add_cents: 1000 });
    expect(r).toEqual({ status: 409, body: { error: 'conflict' } });
    expect(s.updates).toEqual([{ id: 'sesn_1', cents: 2016 }]); // Anthropic 側は上げたまま
    expect(jobRow().budget_cents).toBe(1516);
    expect(s.sent).toEqual([]);
  });

  it('409 conflict: 途中で reconcile が running に戻していたら CAS 0 行', async () => {
    seed();
    const s = stubPort({ onUpdate: () => db.prepare("UPDATE factory_jobs SET status = 'running' WHERE id = 'j1'").run() });
    const r = await raiseBudget(env, s.port, 'j1', { add_cents: 500 });
    expect(r).toEqual({ status: 409, body: { error: 'conflict' } });
    expect(jobRow()).toMatchObject({ status: 'running', budget_cents: 1000 });
  });

  it.each([
    ['400（budget_not_raised 等）', new PortError(true, 400, 'api_error'), 'api_error:400'],
    ['409', new PortError(true, 409, 'api_error'), 'api_error:409'],
  ])('API の明示的な拒否 %s は 502 raise_failed（種別だけ）。D1 は変えない', async (_l, e, kind) => {
    seed();
    const s = stubPort({
      onUpdate: () => {
        throw e;
      },
    });
    const before = jobRow();
    const r = await raiseBudget(env, s.port, 'j1', { add_cents: 1000 });
    expect(r).toEqual({ status: 502, body: { error: 'raise_failed', message: kind } });
    expect(jobRow()).toEqual(before);
    expect(s.sent).toEqual([]);
  });

  it.each([
    ['timeout', new PortError(false, undefined, 'timeout'), 'timeout'],
    ['接続断', new PortError(false, undefined, 'connection'), 'connection'],
    ['5xx', new PortError(true, 503, 'api_error'), 'api_error:503'],
  ])('結果が分からない update（%s）は 502 raise_unknown。D1 は変えない', async (_l, e, kind) => {
    seed();
    const s = stubPort({
      onUpdate: () => {
        throw e;
      },
    });
    const before = jobRow();
    expect(await raiseBudget(env, s.port, 'j1', { add_cents: 500 })).toEqual({ status: 502, body: { error: 'raise_unknown', message: kind } });
    expect(jobRow()).toEqual(before);
  });

  it('update の直前の retrieve に失敗したら update を呼ばずに 502 raise_failed（何も変わっていない）', async () => {
    seed();
    const s = stubPort({ retrieveError: new PortError(false, undefined, 'connection') });
    const before = jobRow();
    expect(await raiseBudget(env, s.port, 'j1', { add_cents: 500 })).toEqual({ status: 502, body: { error: 'raise_failed', message: 'connection' } });
    expect(s.updates).toEqual([]);
    expect(jobRow()).toEqual(before);
  });

  it.each([
    ['add_cents が決まった額でない', { add_cents: 700 }, 'invalid_add_cents'],
    ['add_cents が文字列', { add_cents: '500' }, 'invalid_add_cents'],
    ['add_cents が無い', {}, 'invalid_add_cents'],
    ['note が 201 字', { add_cents: 500, note: 'あ'.repeat(201) }, 'invalid_note'],
    ['note が文字列でない', { add_cents: 500, note: 1 }, 'invalid_note'],
  ])('400（%s）: Anthropic を呼ばない', async (_l, body, error) => {
    seed();
    const s = stubPort();
    expect(await raiseBudget(env, s.port, 'j1', body)).toEqual({ status: 400, body: { error } });
    expect(s.retrieves).toBe(0);
    expect(s.updates).toEqual([]);
  });

  it('note がちょうど 200 字なら通る / job が無ければ 404', async () => {
    seed();
    const s = stubPort();
    expect((await raiseBudget(env, s.port, 'j1', { add_cents: 500, note: 'あ'.repeat(200) })).status).toBe(200);
    expect(await raiseBudget(env, s.port, 'nope', { add_cents: 500 })).toEqual({ status: 404, body: { error: 'not_found' } });
  });
});

describe('POST /api/jobs/:id/raise-budget（index.fetch + fake port）', () => {
  const origin = 'http://localhost';
  const exec = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
  const call = (method: string, path: string, body?: unknown) =>
    worker.fetch(
      new Request(`${origin}${path}`, {
        method,
        headers: { origin, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      env,
      exec,
    );
  const fakeCalls = async (sid: string) =>
    ((await (await call('GET', `/__fake/calls?session_id=${sid}`)).json()) as { calls: Array<Record<string, unknown>> }).calls;

  async function fakeSession(scenario: string): Promise<string> {
    await setSetting(env.DB, 'fake_scenario', scenario);
    return (await createFakePort(env).createSession({ metadata: { job_id: 'j1' } } as never)).id;
  }

  beforeEach(() => {
    env = { DB: d1(db), ANTHROPIC_FAKE: '1', ACCESS_DEV_BYPASS_EMAIL: 'ops@example.invalid' } as unknown as Env;
  });

  it('budget-reached: 増額が受理されると session は自動で running（send は 0 回）→ reconcile で job も running。もう一度押すと 409', async () => {
    const sid = await fakeSession('budget-reached');
    seed({ session_id: sid, budget: 300, cost: 300 }); // fixture の list_cost は 300
    const res = await call('POST', '/api/jobs/j1/raise-budget', { add_cents: 500, note: 'ok' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ job_id: 'j1', budget_cents: 801, resumed: 'auto' }); // max(300, 300, 300+1) + 500
    expect(jobRow()).toMatchObject({ status: 'budget_reached', budget_cents: 801 });

    const calls = await fakeCalls(sid);
    expect(calls.filter((c) => c.op === 'sessions.update').map((c) => c.params)).toEqual([{ budget_cents: 801 }]);
    expect(calls.filter((c) => c.op === 'events.send')).toEqual([]);

    const rec = await call('POST', '/api/jobs/j1/reconcile');
    expect(await rec.json()).toMatchObject({ job_id: 'j1', result: 'resumed', status: 'running' });
    expect((await fakeCalls(sid)).filter((c) => c.op === 'events.send')).toEqual([]);

    const again = await call('POST', '/api/jobs/j1/raise-budget', { add_cents: 500 });
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: 'not_budget_reached' });
  });

  it('budget-raise-stays-idle: update の後も idle のままなら、reconcile は job を budget_reached のままにし何も送らない（次の押下でまた増やせる）', async () => {
    const sid = await fakeSession('budget-raise-stays-idle');
    seed({ session_id: sid, budget: 300, cost: 300 });
    const res = await call('POST', '/api/jobs/j1/raise-budget', { add_cents: 500 });
    expect(await res.json()).toEqual({ job_id: 'j1', budget_cents: 801, resumed: 'auto' });

    const rec = await call('POST', '/api/jobs/j1/reconcile');
    expect(await rec.json()).toMatchObject({ job_id: 'j1', result: 'budget_reached', status: 'budget_reached' });
    expect((await fakeCalls(sid)).filter((c) => c.op === 'events.send')).toEqual([]);

    const again = await call('POST', '/api/jobs/j1/raise-budget', { add_cents: 500 });
    expect(await again.json()).toEqual({ job_id: 'j1', budget_cents: 1301, resumed: 'auto' });
    expect((await fakeCalls(sid)).filter((c) => c.op === 'sessions.update').map((c) => c.params)).toEqual([{ budget_cents: 801 }, { budget_cents: 1301 }]);
  });

  it('fake の session: 使った額以下への変更は budget_not_raised で拒否し、受理したら running。終わった session は拒否', async () => {
    const sid = await fakeSession('budget-reached');
    const port = createFakePort(env);
    await expect(port.updateSessionBudget(sid, 300)).rejects.toMatchObject({ responded: true, status: 400, kind: 'budget_not_raised' });
    expect((await port.retrieveSession(sid)).status).toBe('idle');
    await port.updateSessionBudget(sid, 301);
    expect((await port.retrieveSession(sid)).status).toBe('running');
    await port.archiveSession(sid);
    await expect(port.updateSessionBudget(sid, 900)).rejects.toMatchObject({ kind: 'session_terminated' });
  });

  it('Origin が無い POST は 403（Access の外からは増額できない）', async () => {
    seed();
    const res = await worker.fetch(new Request(`${origin}/api/jobs/j1/raise-budget`, { method: 'POST', body: JSON.stringify({ add_cents: 500 }) }), env, exec);
    expect(res.status).toBe(403);
    expect(jobRow().budget_cents).toBe(1000);
  });
});
