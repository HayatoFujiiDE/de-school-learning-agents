// 検証係の Batch 化（契約 §L-2 / §L-7 (l2)）。node:sqlite の実 DB + R2 の Map + stub の port（一部は fake と本物の port）。
// 各テストは §L-7 (l2) の 1 行、または §L-2 の「状態 × 止まった場所」の 1 行に対応する。
import type { DatabaseSync } from 'node:sqlite';
import type { Message } from '@anthropic-ai/sdk/resources/messages/messages';
import type { MessageBatchIndividualResponse } from '@anthropic-ai/sdk/resources/messages/batches';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PortError, realPort, type BatchResultsOpts, type FactoryPort } from '../src/anthropic';
import { tokyoDay } from '../src/db';
import type { Env } from '../src/env';
import { createFakePort } from '../src/fake/anthropic';
import type { RouteCtx } from '../src/http';
import { reverify } from '../src/routes/review';
import {
  SYNC_CALL_MAX_MS,
  claimSubmit,
  leaseBatch,
  runVerificationStep,
  sweepBatch,
  verifyConversationKey,
  verifyLedgerRefId,
  type BatchRow,
} from '../src/verify';
import { d1, migratedDb, one, rows } from './d1-shim';

const T0 = '2026-11-04T00:00:00.000Z';
const URL_OK = 'https://minecraft.wiki/w/Redstone_circuit';
const no = () => {
  throw new Error('not used in this test');
};
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const MIN = 60_000;
const HOUR = 3600_000;

let db: DatabaseSync;
let r2: Map<string, string>;
let env: Env;
/** R2.get の中で 1 回だけ走らせる処理（key を受け取り、true を返すとその key を読めなかったことにする） */
let r2GetHook: null | ((key: string) => boolean) = null;

function makeEnv(vars: Record<string, string> = {}): Env {
  return {
    DB: d1(db),
    R2: {
      async put(k: string, v: string) {
        r2.set(k, String(v));
      },
      async get(k: string) {
        if (r2GetHook) {
          const h = r2GetHook;
          if (h(k)) {
            r2GetHook = null;
            return null;
          }
        }
        const b = r2.get(k);
        return b === undefined ? null : { text: async () => b };
      },
      async list(o: { prefix?: string }) {
        const keys = [...r2.keys()].filter((k) => k.startsWith(o.prefix ?? '')).sort();
        return { objects: keys.map((key) => ({ key })), truncated: false };
      },
    },
    DAILY_CAP_CENTS: '100000',
    VERIFY_MAX_FETCHES: '25',
    VERIFY_MAX_ATTEMPTS: '3',
    ...vars,
  } as unknown as Env;
}

/** 版を n 件（v1..vn、作成の古い順） */
function seed(n = 1, claims: unknown = { claims: [{ id: 'c1', source_ids: ['s1'] }, { id: 'c2', source_ids: ['s1'] }] }) {
  db.prepare(
    "INSERT INTO materials (id, slug, title, kinds_json, work_status, publish_status, brief_md, created_at, updated_at) VALUES ('m1', 'm-1', 't', '[3]', 'review', 'none', 'b', ?, ?)",
  ).run(T0, T0);
  for (let i = 1; i <= n; i++) {
    db.prepare(
      `INSERT INTO factory_jobs (id, material_id, kind, model, phase, status, session_id, brief_md, created_at, updated_at)
       VALUES (?, 'm1', 'draft', 'claude-sonnet-5-5', 'making', 'done', ?, 'b', ?, ?)`,
    ).run(`j${i}`, `sesn_${i}`, T0, T0);
    const prefix = `materials/m1/j${i}/`;
    db.prepare(
      `INSERT INTO material_versions (id, material_id, version, job_id, session_id, r2_prefix, content_sha256, material_json, claims_json, adapt_rules_md, checks_json, public_paths_json, status, created_at)
       VALUES (?, 'm1', ?, ?, ?, ?, 'sha', '{}', ?, 'a', '{}', '[]', 'review', ?)`,
    ).run(`v${i}`, i, `j${i}`, `sesn_${i}`, prefix, JSON.stringify(claims), new Date(Date.parse(T0) + i * 1000).toISOString());
    r2.set(`${prefix}sources.json`, JSON.stringify({ sources: [{ id: 's1', url: URL_OK }] }));
    r2.set(`${prefix}parts/p1/elementary-short.md`, '# 本文\nレッドストーン [c1] [c2]');
  }
}

const ver = (id = 'v1') => one(db, 'SELECT * FROM material_versions WHERE id = ?', id);
const vbRows = () => rows(db, "SELECT ref_id, cents, kind FROM cost_ledger WHERE ref_id GLOB 'vb:*' ORDER BY created_at, ref_id");
const verifs = (id = 'v1') => rows(db, 'SELECT * FROM verifications WHERE material_version_id = ? ORDER BY attempt', id);
const batchRow = (id = 'v1') => ver(id) as unknown as BatchRow;
const setPhaseAt = (id: string, at: string) => db.prepare('UPDATE material_versions SET verify_phase_at = ? WHERE id = ?').run(at, id);

// ---- 応答の部品 ----
const fetchOk = (id: string) => [
  { type: 'server_tool_use', id, name: 'web_fetch', input: { url: URL_OK } },
  { type: 'web_fetch_tool_result', tool_use_id: id, content: { type: 'web_fetch_result', url: URL_OK, retrieved_at: null, content: { type: 'document', source: { type: 'text', media_type: 'text/plain', data: '本文' } } } },
];
const fetchErr = (id: string, code: string) => [
  { type: 'server_tool_use', id, name: 'web_fetch', input: { url: `${URL_OK}_x` } },
  { type: 'web_fetch_tool_result', tool_use_id: id, content: { type: 'web_fetch_tool_result_error', error_code: code } },
];
const USAGE = { input_tokens: 10_000, output_tokens: 1_000, cache_creation_input_tokens: 2_000, cache_read_input_tokens: 4_000 };

function pauseMsg(usage: Record<string, number> = USAGE): Message {
  return { type: 'message', role: 'assistant', content: [...fetchErr('srvtoolu_1', 'url_not_accessible')], stop_reason: 'pause_turn', usage } as unknown as Message;
}
function reportMsg(usage: Record<string, number> = USAGE, ids = ['c1', 'c2']): Message {
  return {
    type: 'message',
    role: 'assistant',
    content: [
      ...fetchOk('srvtoolu_2'),
      ...fetchErr('srvtoolu_3', 'max_uses_exceeded'),
      {
        type: 'tool_use',
        id: 'toolu_1',
        name: 'report_verdicts',
        input: { verdicts: ids.map((claim_id) => ({ claim_id, verdict: 'confirmed', reason: 'ok', opened_urls: [URL_OK] })), overall_note: 'n' },
      },
    ],
    stop_reason: 'tool_use',
    usage,
  } as unknown as Message;
}
const ok = (m: Message) => ({ type: 'succeeded', message: m });

// ---- stub の port ----
interface Stub {
  port: FactoryPort;
  created: Array<{ id: string; custom_id: string; params: Record<string, unknown> }>;
  status: 'in_progress' | 'ended';
  /** custom_id の turn ごとの結果（result の中身） */
  reply: (turn: number) => unknown;
  createError: Error | null;
  /** createBatch の中で（応答の前に）1 回だけ走らせる処理 */
  createHook: null | (() => Promise<void>);
  retrieveError: Error | null;
  /** batchResults が投げる例外（resultsHook の後） */
  resultsError: Error | null;
  /** batchResults の行の custom_id を差し替える（「結果に t{turn} の行が無い」） */
  resultsCustomId: string | null;
  /** n 件の retrieve が揃うまで待たせる（2 つの cron が同じ ended batch を見る） */
  retrieveBarrier: number;
  /** batchResults の中で 1 回だけ走らせる処理（回収中に他の cron が動く） */
  resultsHook: null | (() => Promise<void>);
  calls: { retrieve: number; results: number };
}

function makeStub(): Stub {
  let waiters: Array<() => void> = [];
  const s: Stub = {
    created: [],
    status: 'ended',
    reply: (turn) => (turn === 0 ? ok(reportMsg()) : ok(reportMsg())),
    createError: null,
    createHook: null,
    retrieveError: null,
    resultsError: null,
    resultsCustomId: null,
    retrieveBarrier: 0,
    resultsHook: null,
    calls: { retrieve: 0, results: 0 },
    port: undefined as unknown as FactoryPort,
  };
  s.port = {
    isFake: true,
    createSession: no,
    retrieveSession: no,
    listSessionsPage: no,
    listEventsPage: no,
    sendEvents: no,
    archiveSession: no,
    listFilesPage: no,
    downloadFile: no,
    createMessage: no,
    listBatchesPage: no,
    xaiResponses: no,
    async createBatch(params) {
      if (s.createHook) {
        const h = s.createHook;
        s.createHook = null;
        await h();
      }
      if (s.createError) throw s.createError;
      const id = `msgbatch_${s.created.length + 1}`;
      s.created.push({ id, custom_id: params.requests[0].custom_id, params: params.requests[0].params as unknown as Record<string, unknown> });
      return { id, processing_status: 'in_progress', created_at: new Date().toISOString(), expires_at: new Date().toISOString() };
    },
    async retrieveBatch(id) {
      s.calls.retrieve++;
      if (s.retrieveBarrier > 0) {
        await new Promise<void>((resolve) => {
          waiters.push(resolve);
          if (waiters.length >= s.retrieveBarrier) {
            const w = waiters;
            waiters = [];
            s.retrieveBarrier = 0;
            for (const f of w) f();
          }
        });
      }
      if (s.retrieveError) throw s.retrieveError;
      return { id, processing_status: s.status, created_at: new Date().toISOString(), expires_at: new Date().toISOString() };
    },
    async batchResults(id: string, _o?: BatchResultsOpts): Promise<MessageBatchIndividualResponse[]> {
      s.calls.results++;
      const b = s.created.find((x) => x.id === id);
      if (s.resultsHook) {
        const h = s.resultsHook;
        s.resultsHook = null;
        await h();
      }
      if (s.resultsError) throw s.resultsError;
      const custom = b?.custom_id ?? 't0';
      return [{ custom_id: s.resultsCustomId ?? custom, result: s.reply(Number(custom.slice(1))) } as unknown as MessageBatchIndividualResponse];
    },
  };
  return s;
}

const step = (port: FactoryPort, e: Env = env) => runVerificationStep(e, port, { deadline: Date.now() + 60_000 });

function routeCtx(): RouteCtx {
  const request = new Request('http://localhost/api/review/v1/reverify', { method: 'POST' });
  return { env, request, url: new URL(request.url), email: 'ops@example.invalid', exec: {} as ExecutionContext, port: async () => makeStub().port };
}

beforeEach(() => {
  db = migratedDb();
  r2 = new Map();
  r2GetHook = null;
  env = makeEnv();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('§L-7 (l2) Batch 検証の状態遷移', () => {
  it('提出 → processing → ended(pause_turn) → 次ターン提出 → ended(report) → done', async () => {
    seed();
    const s = makeStub();
    s.status = 'in_progress';
    s.reply = (turn) => (turn === 0 ? ok(pauseMsg()) : ok(reportMsg()));

    await step(s.port); // lease → 提出 t0 → 回収は processing
    let v = ver();
    expect(v).toMatchObject({ verification_status: 'running', verify_phase: 'submitted', verify_turn: 0, verify_batch_id: 'msgbatch_1' });
    const token = String(v.verification_token);
    expect(s.created).toHaveLength(1);
    const p = s.created[0].params as { tools: Array<Record<string, unknown>>; cache_control: unknown; tool_choice: unknown; model: string; messages: unknown[] };
    expect(s.created[0].custom_id).toBe('t0');
    expect(p.model).toBe('claude-opus-5-5');
    expect(p.cache_control).toEqual({ type: 'ephemeral' });
    expect(p.tool_choice).toEqual({ type: 'auto' });
    expect(p.tools[0]).toMatchObject({ type: 'web_fetch_20250910', name: 'web_fetch', max_uses: 25, max_content_tokens: 20000 });
    expect(p.tools[1]).toMatchObject({ name: 'report_verdicts', strict: true });
    expect(r2.has(verifyConversationKey('v1', token, 0))).toBe(true);

    await step(s.port); // まだ processing
    expect(ver().verify_phase).toBe('submitted');
    expect(vbRows()).toHaveLength(0);

    s.status = 'ended';
    await step(s.port); // 回収: pause_turn → to_submit（turn 1）。提出段は回収段より前なので t1 は次の cron
    v = ver();
    expect(v).toMatchObject({ verification_status: 'running', verify_phase: 'to_submit', verify_turn: 1, verify_pauses: 1, verify_batch_id: null });
    // Batch: 0.5 × (10,000 × $4 + 2,000 × $4 × 1.25 + 4,000 × $4 × 0.1 + 1,000 × $20) / 1M = 0.5 × 71,600 = 35,800 μUSD → 4 ¢
    expect(v.verify_micro).toBe(35_800);
    expect(vbRows()).toEqual([{ ref_id: verifyLedgerRefId('v1', token, 0), cents: 4, kind: 'verify' }]);
    const t1 = JSON.parse(r2.get(verifyConversationKey('v1', token, 1))!) as Array<{ role: string }>;
    expect(t1.map((m) => m.role)).toEqual(['user', 'assistant']);

    await step(s.port); // 提出 t1 → 回収 report → done
    expect(s.created).toHaveLength(2);
    expect(s.created[1].custom_id).toBe('t1');
    expect((s.created[1].params as { messages: unknown[] }).messages).toHaveLength(2);
    v = ver();
    expect(v).toMatchObject({ verification_status: 'done', verification_token: null, verify_phase: null, verify_batch_id: null });
    expect(vbRows().map((r) => r.ref_id)).toEqual([verifyLedgerRefId('v1', token, 0), verifyLedgerRefId('v1', token, 1)]);
    const vs = verifs();
    expect(vs).toHaveLength(1);
    expect(vs[0]).toMatchObject({ attempt: 1, claims_total: 2, confirmed: 2, cost_cents: 8 });  // 35,800 × 2 = 71,600 μUSD → 8 ¢
    const result = JSON.parse(String(vs[0].result_json)) as { meta: Record<string, unknown>; verdicts: unknown[] };
    expect(result.meta).toEqual({ mode: 'batch', turns: 2, fetch_errors: { url_not_accessible: 1, max_uses_exceeded: 1 }, fetched_ok: [URL_OK] });
  });

  it('2 回続けて回収段を回しても記帳は 1 行・batch は 1 件（2 つの cron が同じ ended batch を見ても片方だけ collecting を取る）', async () => {
    seed();
    const s = makeStub();
    s.status = 'in_progress';
    await step(s.port);
    expect(ver().verify_phase).toBe('submitted');
    s.status = 'ended';
    s.retrieveBarrier = 2; // 両方の cron が retrieve を終えてから CAS に進む
    await Promise.all([step(s.port), step(s.port)]);
    expect(s.calls.results).toBe(1); // collecting の CAS を取った側だけが結果を読む
    await step(s.port);
    expect(s.created).toHaveLength(1);
    expect(vbRows()).toHaveLength(1);
    expect(verifs()).toHaveLength(1);
    expect(ver().verification_status).toBe('done');
  });

  it('submitting のまま 30 分 → 試行失敗 + 見積り 1 行', async () => {
    seed();
    expect(await leaseBatch(env)).toBe('leased:v1');
    expect(await claimSubmit(env, batchRow())).toBe(true); // submitting にした後で止まった
    const token = String(ver().verification_token);
    setPhaseAt('v1', ago(31 * MIN));
    await sweepBatch(env);
    expect(ver()).toMatchObject({ verification_status: 'pending', verification_token: null, verify_phase: null, verify_batch_id: null, verification_attempts: 1 });
    expect(vbRows()).toEqual([{ ref_id: verifyLedgerRefId('v1', token, 0), cents: 150, kind: 'verify' }]);
    await sweepBatch(env); // 2 回目の掃除で増えない
    expect(vbRows()).toHaveLength(1);
  });

  it('submitting のまま 30 分未満なら掃除しない', async () => {
    seed();
    await leaseBatch(env);
    await claimSubmit(env, batchRow());
    setPhaseAt('v1', ago(29 * MIN));
    await sweepBatch(env);
    expect(ver().verify_phase).toBe('submitting');
    expect(vbRows()).toHaveLength(0);
  });

  it('collecting のまま 30 分 → submitted に戻り、次の回収で記帳 1 行', async () => {
    seed();
    const s = makeStub();
    s.status = 'in_progress';
    await step(s.port);
    // 回収の処理権を取った cron が結果の処理中に止まった
    db.prepare("UPDATE material_versions SET verify_phase = 'collecting', verify_phase_at = ? WHERE id = 'v1'").run(ago(31 * MIN));
    expect(await sweepBatch(env)).toContain('collecting:resubmitted');
    expect(ver().verify_phase).toBe('submitted');
    s.status = 'ended';
    await step(s.port);
    expect(ver().verification_status).toBe('done');
    expect(vbRows()).toHaveLength(1);
    await step(s.port);
    expect(vbRows()).toHaveLength(1);
  });

  it('日次上限で to_submit のまま待ち、上限が戻ると提出', async () => {
    env = makeEnv({ DAILY_CAP_CENTS: '1000' });
    seed();
    db.prepare("INSERT INTO cost_ledger (id, day, kind, ref_id, cents, created_at) VALUES ('l1', ?, 'session', 'sesn_x', 900, ?)").run(tokyoDay(), T0);
    const s = makeStub();
    s.status = 'in_progress';
    const out = await step(s.port);
    expect(out).toContain('submit=wait');
    expect(ver()).toMatchObject({ verification_status: 'running', verify_phase: 'to_submit' });
    expect(s.created).toHaveLength(0);
    db.prepare("DELETE FROM cost_ledger WHERE id = 'l1'").run();
    await step(s.port);
    expect(ver().verify_phase).toBe('submitted');
    expect(s.created).toHaveLength(1);
  });

  it('停止中は to_submit のまま待ち、再開で提出', async () => {
    seed();
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('paused', '1', ?)").run(T0);
    const s = makeStub();
    s.status = 'in_progress';
    await step(s.port);
    expect(ver().verify_phase).toBe('to_submit');
    expect(s.created).toHaveLength(0);
    db.prepare("UPDATE settings SET value = '0' WHERE key = 'paused'").run();
    await step(s.port);
    expect(ver().verify_phase).toBe('submitted');
  });

  it('飛行中 2 件で 3 件目は提出しない', async () => {
    seed(3);
    const s = makeStub();
    s.status = 'in_progress';
    await step(s.port);
    await step(s.port);
    await step(s.port);
    expect([ver('v1').verify_phase, ver('v2').verify_phase, ver('v3').verify_phase]).toEqual(['submitted', 'submitted', 'to_submit']);
    expect(s.created).toHaveLength(2);
  });

  it('飛行中 1 件・to_submit 2 件を別々の処理権で同時に取りにいくと 1 件だけ成功（飛行中の上限）', async () => {
    seed(3);
    const s = makeStub();
    s.status = 'in_progress';
    await step(s.port); // v1 が飛行中
    await leaseBatch(env);
    await leaseBatch(env);
    const [a, b] = await Promise.all([claimSubmit(env, batchRow('v2')), claimSubmit(env, batchRow('v3'))]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(rows(db, "SELECT id FROM material_versions WHERE verify_phase IN ('submitting','submitted','collecting')")).toHaveLength(2);
  });

  it('飛行中 1 件・to_submit 2 件を同時に取りにいくと 1 件だけ成功（日次の予約）', async () => {
    // 飛行中の上限は効かない値にし、日次: 0 + 150 × (1 + 1) = 300 ≤ 400 < 0 + 150 × (2 + 1) = 450
    env = makeEnv({ VERIFY_INFLIGHT: '10', DAILY_CAP_CENTS: '400' });
    seed(3);
    const s = makeStub();
    s.status = 'in_progress';
    await step(s.port);
    expect(ver('v1').verify_phase).toBe('submitted');
    await leaseBatch(env);
    await leaseBatch(env);
    const [a, b] = await Promise.all([claimSubmit(env, batchRow('v2')), claimSubmit(env, batchRow('v3'))]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });

  it('verify_phase IS NULL の running が 30 分で pending（attempts は増やさない）', async () => {
    seed(2);
    db.prepare("UPDATE material_versions SET verification_status = 'running', verification_token = 'tok', verification_attempts = 1, verification_started_at = ? WHERE id = 'v1'").run(ago(31 * MIN));
    db.prepare("UPDATE material_versions SET verification_status = 'running', verification_token = 'tok2', verification_attempts = 1, verification_started_at = ? WHERE id = 'v2'").run(ago(10 * MIN));
    await sweepBatch(env);
    expect(ver('v1')).toMatchObject({ verification_status: 'pending', verification_token: null, verification_attempts: 1, verify_phase: null });
    expect(ver('v2')).toMatchObject({ verification_status: 'running', verification_token: 'tok2' });
  });

  it('retrieve 成功なら 48 時間を過ぎていても回収する（見積りを付けない）', async () => {
    seed();
    const s = makeStub();
    s.status = 'in_progress';
    await step(s.port);
    setPhaseAt('v1', ago(49 * HOUR));
    s.status = 'ended';
    await step(s.port);
    expect(ver().verification_status).toBe('done');
    expect(vbRows().map((r) => r.cents)).toEqual([4]); // 35,800 μUSD の実費だけ（見積り 150 ではない）
  });

  it('retrieve が失敗し、submitted から 48 時間超なら試行失敗 + 見積り（48 時間未満なら待つ）', async () => {
    seed();
    const s = makeStub();
    s.status = 'in_progress';
    await step(s.port);
    s.retrieveError = new PortError(false, undefined, 'connection');
    setPhaseAt('v1', ago(47 * HOUR));
    await step(s.port);
    expect(ver().verify_phase).toBe('submitted');
    const token = String(ver().verification_token);
    setPhaseAt('v1', ago(49 * HOUR));
    await step(s.port);
    expect(vbRows()).toEqual([{ ref_id: verifyLedgerRefId('v1', token, 0), cents: 150, kind: 'verify' }]);
    expect(ver().verification_token).not.toBe(token); // 試行失敗 → pending（同じ cron では lease が先なので次の cron で取り直す）
  });

  it('試行累計が上限 → failed（attempts に関係なく）', async () => {
    seed();
    const s = makeStub();
    // t0 の実費: 0.5 × (1.3M × $4 + 30k × $20) / 1M = $2.90 → 290 + 150 > 400
    const big = { input_tokens: 1_300_000, output_tokens: 30_000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
    s.reply = (turn) => (turn === 0 ? ok(pauseMsg(big)) : ok(reportMsg()));
    await step(s.port); // t0 提出・回収（ended）→ to_submit turn 1
    expect(ver()).toMatchObject({ verify_phase: 'to_submit', verify_turn: 1 });
    await step(s.port); // 3-1 で上限
    expect(ver()).toMatchObject({ verification_status: 'failed', verification_attempts: 1, verify_phase: null, verification_token: null });
    expect(s.created).toHaveLength(1);
    const notes = rows(db, "SELECT note FROM improvement_notes WHERE source = 'verification'");
    expect(notes).toHaveLength(1);
    expect(String(notes[0].note)).toContain('verify_cost_cap');
  });

  it('結果が 16 MiB 超 → 試行失敗 + 見積り（本物の port に偽の fetch。16 MiB 以下なら同じ経路で回収できる）', async () => {
    const pad = (n: number) => 'x'.repeat(n);
    const run = async (padBytes: number) => {
      const message = { ...reportMsg(), id: 'msg_1', model: 'claude-opus-5-5', stop_sequence: null, pad: pad(padBytes) };
      const line = `${JSON.stringify({ custom_id: 't0', result: { type: 'succeeded', message } })}\n`;
      const batch = (status: string) =>
        JSON.stringify({
          id: 'msgbatch_big',
          type: 'message_batch',
          processing_status: status,
          created_at: T0,
          expires_at: T0,
          ended_at: null,
          archived_at: null,
          cancel_initiated_at: null,
          request_counts: { processing: 0, succeeded: 1, errored: 0, canceled: 0, expired: 0 },
          results_url: status === 'ended' ? 'https://api.anthropic.com/v1/messages/batches/msgbatch_big/results' : null,
        });
      const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input instanceof Request ? input.url : input);
        const method = (input instanceof Request ? input.method : init?.method) ?? 'GET';
        if (/\/v1\/messages\/batches(\?|$)/.test(url) && method === 'POST') return new Response(batch('in_progress'), { headers: { 'content-type': 'application/json' } });
        if (/\/v1\/messages\/batches\/msgbatch_big(\?|$)/.test(url)) return new Response(batch('ended'), { headers: { 'content-type': 'application/json' } });
        if (/\/results(\?|$)/.test(url)) return new Response(line, { headers: { 'content-type': 'application/binary' } });
        return new Response('{}', { status: 404 });
      }) as typeof fetch;
      const port = realPort({ ...env, ANTHROPIC_API_KEY: 'test-not-a-key' } as Env, { fetchImpl });
      return step(port);
    };
    seed();
    await run(17 * 1024 * 1024);
    const failed = ver();
    expect(failed).toMatchObject({ verification_status: 'pending', verify_phase: null, verification_attempts: 1 });
    expect(vbRows()).toHaveLength(1);
    expect(vbRows()[0].cents).toBe(150);
    expect(verifs()).toHaveLength(0);
    // 対照: 同じ経路で 16 MiB 以下なら done（次の cron で lease → 提出 → 回収）
    await run(1024);
    expect(ver().verification_status).toBe('done');
    expect(verifs()).toHaveLength(1);
  }, 30_000);

  it('続きは verify_turn+1 < 8 の間だけ（t0..t7 の合計 8 ターンで打ち切り = 試行失敗 turn_limit）', async () => {
    seed();
    const s = makeStub();
    const endTurn = { type: 'message', role: 'assistant', content: [{ type: 'text', text: '確認しました' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 1 } } as unknown as Message;
    s.reply = () => ok(endTurn);
    let out = '';
    for (let i = 0; i < 20 && !out.includes('turn_limit'); i++) out = await step(s.port);
    expect(out).toContain('collect=retry:turn_limit');
    expect(s.created.map((c) => c.custom_id)).toEqual(['t0', 't1', 't2', 't3', 't4', 't5', 't6', 't7']);
    const t7 = JSON.parse(r2.get(verifyConversationKey('v1', String(rows(db, 'SELECT ref_id FROM cost_ledger')[0].ref_id).split(':')[2], 7))!) as Array<{ role: string; content: unknown }>;
    expect(t7).toHaveLength(15); // user + (assistant + 「report_verdicts を呼んでください」) × 7
    expect(t7[2]).toEqual({ role: 'user', content: 'report_verdicts を呼んでください' });
    expect(vbRows()).toHaveLength(8); // 各ターンの実費（t7 も失敗の batch で記帳）
    expect(ver()).toMatchObject({ verification_status: 'pending', verify_phase: null });
  });

  it('expired → 試行失敗（見積りを付けない）', async () => {
    seed();
    const s = makeStub();
    s.reply = () => ({ type: 'expired' });
    await step(s.port);
    expect(ver()).toMatchObject({ verification_status: 'pending', verify_phase: null, verification_token: null, verification_attempts: 1 });
    expect(vbRows()).toHaveLength(0);
    expect(verifs()).toHaveLength(0);
  });

  it('createBatch の失敗・応答不明 → 試行失敗 + 見積り（回収しない）', async () => {
    seed();
    const s = makeStub();
    s.createError = new PortError(false, undefined, 'timeout');
    const out = await step(s.port);
    expect(out).toContain('submit=retry:create:PortError');
    expect(ver()).toMatchObject({ verification_status: 'pending', verify_phase: null });
    expect(vbRows()).toHaveLength(1);
    expect(vbRows()[0].cents).toBe(150);
  });

  it('提出待ち中に reverify は 409', async () => {
    seed();
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('paused', '1', ?)").run(T0);
    const s = makeStub();
    await step(s.port);
    expect(ver().verify_phase).toBe('to_submit');
    const res = await reverify(routeCtx(), 'v1');
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe('verification_running');
  });

  it('done 後の reverify で古い token の回収は 0 行（記帳も verifications も増えない）', async () => {
    seed();
    const s = makeStub();
    s.status = 'in_progress';
    await step(s.port);
    const oldToken = String(ver().verification_token);
    s.status = 'ended';
    const inner = makeStub();
    // cron X が collecting を取って結果を読んでいる間に: 30 分経過 → 別の cron が回収し直して done → 人の reverify → 新しい試行の lease
    s.resultsHook = async () => {
      setPhaseAt('v1', ago(31 * MIN));
      await step(inner.port);
      expect(ver().verification_status).toBe('done');
      expect((await reverify(routeCtx(), 'v1')).status).toBe(200);
      expect(ver().verification_status).toBe('pending');
      inner.status = 'in_progress';
      await step(inner.port);
      expect(ver().verification_token).not.toBe(oldToken);
    };
    const out = await step(s.port);
    expect(out).toContain('collect=discarded');
    expect(vbRows().filter((r) => String(r.ref_id).includes(oldToken))).toHaveLength(1); // 回収し直した側の 1 行だけ
    expect(verifs()).toHaveLength(1);
    expect(ver()).toMatchObject({ verification_status: 'running', verify_phase: 'submitted' });
  });
});

describe('§L-2 fake の Batch（smoke と同じ経路）と同期モード', () => {
  it('fake: fake_batch_in_progress と fake_pause_turns で processing → pause_turn → report → done', async () => {
    seed(1, { fake_pause_turns: 1, fake_batch_in_progress: 1, claims: [{ id: 'c1', source_ids: ['s1'] }] });
    const port = createFakePort(env);
    for (let i = 0; i < 6 && ver().verification_status !== 'done'; i++) await step(port);
    expect(ver().verification_status).toBe('done');
    const calls = JSON.parse(String(one(db, "SELECT value FROM settings WHERE key = 'fake_calls_json'").value)) as Array<{ op: string; custom_id?: string; params?: Record<string, unknown> }>;
    const creates = calls.filter((c) => c.op === 'batches.create');
    expect(creates.map((c) => c.custom_id)).toEqual(['t0', 't1']);
    expect(creates[0].params).toMatchObject({ kind: 'verify', cache_control: 'ephemeral', tool_choice: { type: 'auto' } });
    expect((creates[0].params!.tools as Array<Record<string, unknown>>)[0]).toMatchObject({ type: 'web_fetch_20250910', max_content_tokens: 20000 });
    expect(JSON.parse(String(verifs()[0].result_json)).meta).toMatchObject({ mode: 'batch', turns: 2 });
  });

  it('fake: fake_batch_result=errored → 試行失敗', async () => {
    seed(1, { fake_batch_result: 'errored', claims: [{ id: 'c1', source_ids: ['s1'] }] });
    await step(createFakePort(env));
    expect(ver()).toMatchObject({ verification_status: 'pending', verify_phase: null });
  });

  it('VERIFY_MODE=sync は同期ループのまま tool を web_fetch_20250910 + max_content_tokens にそろえ、meta.mode=sync', async () => {
    env = makeEnv({ VERIFY_MODE: 'sync' });
    seed();
    const seen: Array<Record<string, unknown>> = [];
    const port = { ...makeStub().port, createMessage: async (p: unknown) => (seen.push(p as Record<string, unknown>), reportMsg()) } as FactoryPort;
    expect(await runVerificationStep(env, port)).toBe('done');
    // 定価: 10,000 × $4 + 2,000 × $4 × 1.25 + 4,000 × $4 × 0.1 + 1,000 × $20 = 71,600 μUSD → 8 ¢
    expect(rows(db, "SELECT cents FROM cost_ledger WHERE kind = 'verify'").map((r) => r.cents)).toEqual([8]);
    expect(verifs()[0].cost_cents).toBe(8);
    expect((seen[0].tools as Array<Record<string, unknown>>)[0]).toMatchObject({ type: 'web_fetch_20250910', max_content_tokens: 20000 });
    expect(seen[0].cache_control).toBeUndefined();
    expect(JSON.parse(String(verifs()[0].result_json)).meta).toMatchObject({ mode: 'sync', turns: 1, fetched_ok: [URL_OK] });
    expect(ver().verify_phase).toBeNull();
  });
});

describe('§L-2 回収の失敗の分類（Astra xhigh #1）', () => {
  const submitted = async () => {
    seed();
    const s = makeStub();
    s.status = 'in_progress';
    await step(s.port);
    expect(ver().verify_phase).toBe('submitted');
    s.status = 'ended';
    return s;
  };

  it.each([
    ['results_url が無い', new PortError(true, undefined, 'no_results_url'), 'results_no_results_url'],
    ['404', new PortError(true, 404, 'api_error'), 'results_gone_404'],
    ['410', new PortError(true, 410, 'api_error'), 'results_gone_410'],
    ['本文が JSONL でない', new PortError(true, undefined, 'invalid_results'), 'results_invalid'],
  ])('結果が二度と読めない（%s）→ 試行失敗 + 見積り（collecting ↔ submitted を回り続けない）', async (_n, err, reason) => {
    const s = await submitted();
    const token = String(ver().verification_token);
    s.resultsError = err;
    const out = await step(s.port);
    expect(out).toContain(`collect=retry:${reason}`);
    expect(ver()).toMatchObject({ verification_status: 'pending', verify_phase: null, verify_batch_id: null, verification_attempts: 1 });
    expect(vbRows()).toEqual([{ ref_id: verifyLedgerRefId('v1', token, 0), cents: 150, kind: 'verify' }]);
    expect(verifs()).toHaveLength(0);
  });

  it.each([
    ['timeout', new PortError(false, undefined, 'timeout')],
    ['接続断', new PortError(false, undefined, 'connection')],
    ['500', new PortError(true, 500, 'api_error')],
    ['429', new PortError(true, 429, 'api_error')],
  ])('一時的な失敗（%s）は collecting のまま → 30 分後に submitted へ戻して回収し直す（見積りなし）', async (_n, err) => {
    const s = await submitted();
    s.resultsError = err;
    const out = await step(s.port);
    expect(out).toContain('collect=results_error');
    expect(ver()).toMatchObject({ verification_status: 'running', verify_phase: 'collecting' });
    expect(vbRows()).toHaveLength(0);
    s.resultsError = null;
    await step(s.port); // 30 分未満: 何もしない
    expect(ver().verify_phase).toBe('collecting');
    setPhaseAt('v1', ago(31 * MIN));
    await step(s.port); // 掃除 → submitted → 回収
    expect(ver().verification_status).toBe('done');
    expect(vbRows().map((r) => r.cents)).toEqual([4]);
  });

  it.each([
    [410, { verification_status: 'pending', verify_phase: null }, 1],
    [500, { verification_status: 'running', verify_phase: 'collecting' }, 0],
  ])('fake: fake_results_error=%s', async (code, want, ledger) => {
    seed(1, { fake_results_error: code, claims: [{ id: 'c1', source_ids: ['s1'] }] });
    await step(createFakePort(env));
    expect(ver()).toMatchObject(want);
    expect(vbRows()).toHaveLength(ledger);
  });
});

describe('§L-2 CAS の条件を 1 つだけ変えると 0 行（まだ記帳されていない ref でも EXISTS が記帳を止める。Astra xhigh #4）', () => {
  /** 処理権を取った後、外部呼び出しの間に 1 つの条件だけが変わる */
  const mutations: Array<[string, string]> = [
    ['token', "UPDATE material_versions SET verification_token = 'tok_other' WHERE id = 'v1'"],
    ['turn', "UPDATE material_versions SET verify_turn = verify_turn + 1 WHERE id = 'v1'"],
    ['batch_id', "UPDATE material_versions SET verify_batch_id = 'msgbatch_other' WHERE id = 'v1'"],
    ['phase', "UPDATE material_versions SET verify_phase = 'submitted' WHERE id = 'v1'"],
    ['status', "UPDATE material_versions SET verification_status = 'done' WHERE id = 'v1'"],
  ];
  const kinds = ['続き（pause_turn）', 'report', '結果の行が無い（見積り）'] as const;
  const cases = mutations.flatMap(([name, sql]) => kinds.map((k) => [name, sql, k] as const));

  it.each(cases)('回収の最後の batch: %s だけ違う × %s → 記帳・verifications・遷移すべて 0', async (name, sql, kind) => {
    seed();
    const s = makeStub();
    s.status = 'in_progress';
    await step(s.port);
    s.status = 'ended';
    if (kind === '続き（pause_turn）') s.reply = () => ok(pauseMsg());
    if (kind === '結果の行が無い（見積り）') s.resultsCustomId = 't9';
    s.resultsHook = async () => {
      db.prepare(sql).run();
    };
    const before = ver();
    await step(s.port);
    expect(vbRows()).toHaveLength(0);
    expect(verifs()).toHaveLength(0);
    const after = ver();
    // 変えた列以外は collecting を取った時のまま（最後の batch の UPDATE が当たっていない）
    expect(after.verify_micro).toBe(0);
    expect(after.verify_pauses).toBe(0);
    expect(after.verify_turn).toBe(name === 'turn' ? Number(before.verify_turn) + 1 : before.verify_turn);
    expect(after.verify_phase).toBe(name === 'phase' ? 'submitted' : 'collecting');
    expect(after.verification_status).toBe(name === 'status' ? 'done' : 'running');
  });

  const submitMutations = mutations.filter(([n]) => n !== 'batch_id').map(([n, sql]) => [n, n === 'phase' ? sql.replace("'submitted'", "'to_submit'") : sql] as const);
  it.each(submitMutations.flatMap(([n, sql]) => (['成功', '失敗（見積り）'] as const).map((k) => [n, sql, k] as const)))(
    '提出: createBatch の間に %s だけ違う × %s → submitted にならず見積りも 0',
    async (name, sql, kind) => {
      seed();
      const s = makeStub();
      s.status = 'in_progress';
      s.createHook = async () => {
        db.prepare(sql).run();
      };
      if (kind === '失敗（見積り）') s.createError = new PortError(false, undefined, 'timeout');
      await step(s.port);
      const v = ver();
      expect(vbRows()).toHaveLength(0);
      expect(v.verify_batch_id).toBeNull();
      expect(v.verify_phase).toBe(name === 'phase' ? 'to_submit' : 'submitting');
    },
  );

  it('終端の失敗（part_missing）の improvement_notes も同じ述語: 読む間に token が変わったら 0 行（対照: 変わらなければ failed + 1 行）', async () => {
    seed();
    r2GetHook = (k) => k.endsWith('parts/p1/elementary-short.md');
    await step(makeStub().port);
    expect(ver()).toMatchObject({ verification_status: 'failed', verify_phase: null });
    expect(rows(db, 'SELECT id FROM improvement_notes')).toHaveLength(1);

    db.prepare("DELETE FROM improvement_notes").run();
    db.prepare("UPDATE material_versions SET verification_status = 'pending', verification_attempts = 0 WHERE id = 'v1'").run();
    r2GetHook = (k) => {
      if (!k.endsWith('parts/p1/elementary-short.md')) return false;
      db.prepare("UPDATE material_versions SET verification_token = 'tok_other' WHERE id = 'v1'").run();
      return true;
    };
    await step(makeStub().port);
    expect(ver()).toMatchObject({ verification_status: 'running', verification_token: 'tok_other', verify_phase: 'submitting' });
    expect(rows(db, 'SELECT id FROM improvement_notes')).toHaveLength(0);
  });
});

describe('§L-2 pause_turn の上限（5 回まで続け、6 回目で失敗）', () => {
  it('pause_turn が 5 回までは次のターンを出し、6 回目で試行失敗 too_many_pauses', async () => {
    seed();
    const s = makeStub();
    s.reply = () => ok(pauseMsg());
    const seenPauses: number[] = [];
    let out = '';
    for (let i = 0; i < 20 && !out.includes('too_many_pauses'); i++) {
      out = await step(s.port);
      const v = ver();
      if (v.verify_phase === 'to_submit') seenPauses.push(Number(v.verify_pauses));
    }
    expect(out).toContain('collect=retry:too_many_pauses');
    expect(Math.max(...seenPauses)).toBe(5);
    expect(s.created.map((c) => c.custom_id)).toEqual(['t0', 't1', 't2', 't3', 't4', 't5']);
    expect(vbRows()).toHaveLength(6); // 6 回目のターンの実費も失敗の batch で記帳
    expect(ver()).toMatchObject({ verification_status: 'pending', verify_phase: null });
  });
});

describe('§L-2 同期モード（Astra xhigh #2 #3）', () => {
  it('sync に切り替えても phase を持つ行（submitted）は Batch の段で回収・記帳され、新しい lease は同期ループ', async () => {
    seed(2);
    const s = makeStub();
    s.status = 'in_progress';
    await step(s.port); // batch モードで v1 を提出
    expect(ver('v1').verify_phase).toBe('submitted');
    const token = String(ver('v1').verification_token);
    env = makeEnv({ VERIFY_MODE: 'sync' });
    s.status = 'ended';
    let messages = 0;
    const port = { ...s.port, createMessage: async () => (messages++, reportMsg()) } as FactoryPort;
    // 30 分を過ぎても sync の掃除は phase のある行を pending に戻さない
    db.prepare("UPDATE material_versions SET verification_started_at = ? WHERE id = 'v1'").run(ago(31 * MIN));
    const out = await runVerificationStep(env, port, { deadline: Date.now() + 10 * MIN });
    expect(out).toContain('drain:');
    expect(ver('v1').verification_status).toBe('done');
    expect(vbRows()).toEqual([{ ref_id: verifyLedgerRefId('v1', token, 0), cents: 4, kind: 'verify' }]);
    expect(ver('v2')).toMatchObject({ verification_status: 'done', verify_phase: null }); // 同期で 1 件
    expect(messages).toBe(1);
    expect(s.created).toHaveLength(1); // 新しい batch は作らない
  });

  it('sync でも to_submit の続きのターンは Batch で提出する（lease はしない）', async () => {
    seed();
    const s = makeStub();
    s.reply = (turn) => (turn === 0 ? ok(pauseMsg()) : ok(reportMsg()));
    await step(s.port); // t0 → to_submit t1
    expect(ver()).toMatchObject({ verify_phase: 'to_submit', verify_turn: 1 });
    env = makeEnv({ VERIFY_MODE: 'sync' });
    await runVerificationStep(env, { ...s.port, createMessage: no } as FactoryPort, { deadline: Date.now() + 10 * MIN });
    expect(ver().verification_status).toBe('done');
    expect(s.created.map((c) => c.custom_id)).toEqual(['t0', 't1']);
  });

  it('期限切れの deadline では lease も createMessage もしない', async () => {
    env = makeEnv({ VERIFY_MODE: 'sync' });
    seed();
    let calls = 0;
    const port = { ...makeStub().port, createMessage: async () => (calls++, reportMsg()) } as FactoryPort;
    expect(await runVerificationStep(env, port, { deadline: Date.now() - 1 })).toBe('no_time');
    expect(calls).toBe(0);
    expect(ver()).toMatchObject({ verification_status: 'pending', verification_attempts: 0 });
  });

  it('deadline を全呼び出しに渡し、timeout の上限は同期用（SYNC_CALL_MAX_MS）', async () => {
    env = makeEnv({ VERIFY_MODE: 'sync' });
    seed();
    const opts: unknown[] = [];
    const deadline = Date.now() + 14 * MIN;
    const port = { ...makeStub().port, createMessage: async (_p: unknown, o: unknown) => (opts.push(o), reportMsg()) } as FactoryPort;
    expect(await runVerificationStep(env, port, { deadline })).toBe('done');
    expect(opts).toEqual([{ deadline, maxTimeoutMs: SYNC_CALL_MAX_MS }]);
    expect(SYNC_CALL_MAX_MS).toBe(600_000);
  });

  it('途中のターンで残り時間が足りなければ次のターンを始めない（かかった分だけ記帳し、試行は 30 分の掃除が pending に戻す）', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-04T03:00:00.000Z'));
    env = makeEnv({ VERIFY_MODE: 'sync' });
    seed();
    let calls = 0;
    const port = {
      ...makeStub().port,
      createMessage: async () => {
        calls++;
        vi.setSystemTime(new Date(Date.now() + 10 * MIN)); // 1 ターン目に 10 分かかった
        return pauseMsg();
      },
    } as FactoryPort;
    expect(await runVerificationStep(env, port, { deadline: Date.now() + 5 * MIN })).toBe('deadline');
    expect(calls).toBe(1);
    expect(ver()).toMatchObject({ verification_status: 'running', verify_phase: null, verification_attempts: 1 });
    expect(rows(db, "SELECT cents FROM cost_ledger WHERE kind = 'verify'").map((r) => r.cents)).toEqual([8]); // 71,600 μUSD
    vi.setSystemTime(new Date(Date.now() + 31 * MIN));
    await sweepBatch(env);
    expect(ver()).toMatchObject({ verification_status: 'pending', verification_token: null, verification_attempts: 1 });
  });
});
