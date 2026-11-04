// 画像生成 段階 2（契約 §O-8）の受け入れ t1〜t16。node:sqlite の実 DB（migrations 0001〜0004）+ R2 の Map + fake / stub の port。
// 各 # の「FAIL しうる対照」も同じテストの中で確かめる。
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FactoryPort, FileMeta, Page } from '../src/anthropic';
import { contentDigestInput } from '../src/checks/schema';
import { isoPlus, nowIso, tokyoDay } from '../src/db';
import type { Env } from '../src/env';
import { bytesToBase64, createFakeImagePort, grayPng, readOpenAiCalls, TINY_WEBP_B64 } from '../src/fake/openai';
import {
  IMAGE_HOLD_CENTS,
  IMAGE_U_CENTS,
  IMAGE_U_MAX,
  classifyImageOutcome,
  decodeImage,
  dispatchStmt,
  finalizeHoldStmt,
  haltReasonFor,
  haltStmt,
  imageActualCents,
  imageCronStep,
  imageErrorText,
  keptImageInput,
  registerImage,
  runImage,
  uCentsFor,
  unhaltStmt,
  validateImageInput,
} from '../src/images';
import { reconcileJob } from '../src/jobs';
import { OpenAiError, openAiPort, parseImageUsage, type ImagePort, type ImageUsage } from '../src/openai';
import { buildUserContent, dailyReservedSql } from '../src/verify';
import { d1, migratedDb, one, rows } from './d1-shim';
import { goodFiles, goodMaterial } from './helpers';

const T = '2026-11-04T00:00:00.000Z';
const no = () => {
  throw new Error('not used in this test');
};
const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1);
const sha256 = async (b: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))].map((x) => x.toString(16).padStart(2, '0')).join('');
const TINY_PNG = grayPng(1, 1);
const NORMAL_USAGE: ImageUsage = { in_text: 43, in_image: 0, out_image: 1756, out_text: 0 };

// ---- 環境 ----
let db: DatabaseSync;
let r2: Map<string, Uint8Array>;
let r2Gets: string[];
let r2FailPut: boolean;
let queue: string[];
let env: Env;

function makeEnv(vars: Record<string, string | undefined> = {}): Env {
  return {
    DB: d1(db),
    R2: {
      async put(k: string, v: Uint8Array) {
        if (r2FailPut) throw new Error('r2_put_failed');
        r2.set(k, new Uint8Array(v));
      },
      async get(k: string) {
        r2Gets.push(k);
        const b = r2.get(k);
        return b ? { body: b.slice(), arrayBuffer: async () => b.slice().buffer, text: async () => new TextDecoder().decode(b) } : null;
      },
      async list(o: { prefix?: string }) {
        const keys = [...r2.keys()].filter((k) => k.startsWith(o.prefix ?? '')).sort();
        return { objects: keys.map((key) => ({ key })), truncated: false };
      },
      async delete(keys: string | string[]) {
        for (const k of Array.isArray(keys) ? keys : [keys]) r2.delete(k);
      },
    },
    IMAGE_GEN: {
      async send(b: { request_id: string }) {
        queue.push(b.request_id);
      },
    },
    DAILY_CAP_CENTS: '100000',
    VERIFY_TURN_RESERVE_CENTS: '150',
    OPENAI_API_KEY: 'sk-test-not-a-key',
    ...vars,
  } as unknown as Env;
}

beforeEach(() => {
  db = migratedDb();
  r2 = new Map();
  r2Gets = [];
  r2FailPut = false;
  queue = [];
  env = makeEnv();
});

function seedJob(id = 'j1', o: { status?: string; phase?: string; deny?: number; updated_at?: string; error?: string | null } = {}) {
  db.prepare(
    "INSERT OR IGNORE INTO materials (id, slug, title, kinds_json, work_status, publish_status, brief_md, created_at, updated_at) VALUES (?, ?, 't', '[3]', 'making', 'none', 'b', ?, ?)",
  ).run(`m_${id}`, `m-${id}`, T, T);
  db.prepare(
    `INSERT INTO factory_jobs (id, material_id, kind, model, phase, status, session_id, brief_md, deny_count, error, created_at, updated_at)
     VALUES (?, ?, 'draft', 'claude-sonnet-5-5', ?, ?, ?, 'b', ?, ?, ?, ?)`,
  ).run(id, `m_${id}`, o.phase ?? 'making', o.status ?? 'running', `sesn_${id}`, o.deny ?? 0, o.error ?? null, T, o.updated_at ?? T);
}
const jobArg = (id = 'j1', phase = 'making') => ({ id, phase, session_id: `sesn_${id}` });
const good = (over: Record<string, unknown> = {}) => ({
  prompt: 'a red cube on a white background',
  accuracy: 'standard',
  size: '1024x1024',
  quality: 'high',
  format: 'png',
  background: 'opaque',
  alt: '白地に赤い立方体',
  ...over,
});
const realLike = { isFake: false };
const register = (jobId: string, tu: string, input: unknown = good(), port = realLike) => registerImage(env, port, jobArg(jobId), tu, input);
const imageRow = (tu: string) => one(db, 'SELECT * FROM image_requests WHERE custom_tool_use_id = ?', tu);
const ledger = (o: { kind: string; ref: string; cents: number; day?: string }) =>
  db
    .prepare('INSERT INTO cost_ledger (id, day, kind, ref_id, cents, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(crypto.randomUUID(), o.day ?? tokyoDay(), o.kind, o.ref, o.cents, nowIso());
const halted = () => (db.prepare("SELECT value FROM settings WHERE key = 'image_gen_halted'").get() as { value: string } | undefined)?.value ?? null;

function insertImage(o: {
  id?: string;
  tu: string;
  job?: string;
  state: string;
  error?: string | null;
  u?: number | null;
  format?: string;
  r2_key?: string | null;
  sha?: string | null;
  dispatched_at?: string | null;
  enqueue_count?: number;
  enqueued_at?: string | null;
  input?: Record<string, unknown>;
}): string {
  const id = o.id ?? `img_${crypto.randomUUID().replace(/-/g, '')}`;
  db.prepare(
    `INSERT INTO image_requests (id, custom_tool_use_id, job_id, session_id, model, size, quality, format, background, u_cents, input_json, state, error,
       enqueue_count, enqueued_at, dispatch_token, dispatched_at, r2_key, sha256, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'gpt-image-2.5-flare', '1024x1024', 'high', ?, 'opaque', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    o.tu,
    o.job ?? 'j1',
    `sesn_${o.job ?? 'j1'}`,
    o.format ?? 'png',
    o.u === undefined ? 10 : o.u,
    JSON.stringify(o.input ?? { prompt: 'p', alt: 'a', accuracy: 'standard' }),
    o.state,
    o.error ?? null,
    o.enqueue_count ?? 1,
    o.enqueued_at ?? T,
    o.dispatched_at ? 'tok' : null,
    o.dispatched_at ?? null,
    o.r2_key ?? null,
    o.sha ?? null,
    T,
    T,
  );
  return id;
}

/** reconcile 用の stub port（events は呼び出しのたびに読み直す。sendEvents は sent に積むだけ） */
function stubPort(o: { events: unknown[]; sent: unknown[]; status?: string; outputs?: Map<string, Uint8Array> }): FactoryPort {
  const outputs = o.outputs ?? new Map<string, Uint8Array>();
  const metas: FileMeta[] = [...outputs.keys()].map((p, i) => ({
    id: `file_${i}`,
    filename: basename(p),
    size_bytes: outputs.get(p)!.byteLength,
    created_at: new Date(Date.parse(T) + i).toISOString(),
  }));
  const bodies = new Map(metas.map((m, i) => [m.id, [...outputs.values()][i]]));
  return {
    isFake: false,
    createSession: no,
    async retrieveSession(id: string) {
      return { id, status: o.status ?? 'idle', listCostCents: null, metadata: {}, created_at: T };
    },
    updateSessionBudget: no,
    listSessionsPage: no,
    async listEventsPage(_id: string, q: { order: 'asc' | 'desc' }): Promise<Page<unknown>> {
      return { data: q.order === 'desc' ? [...o.events].reverse() : [...o.events], next: null };
    },
    async sendEvents(_id: string, evs: unknown[]) {
      for (const e of evs) o.sent.push(e);
    },
    async archiveSession() {},
    async listFilesPage(): Promise<Page<FileMeta>> {
      return { data: metas, next: null };
    },
    async downloadFile(fileId: string) {
      const b = bodies.get(fileId);
      if (!b) throw new Error('no file');
      return b;
    },
    createMessage: no,
    createBatch: no,
    retrieveBatch: no,
    batchResults: no,
    listBatchesPage: no,
    xaiResponses: no,
  } as unknown as FactoryPort;
}
const rec = (port: FactoryPort, jobId = 'j1') => reconcileJob(env, port, jobId, { deadline: Date.now() + 25_000 });
const expireLease = (jobId = 'j1') => db.prepare('UPDATE factory_jobs SET reconcile_token = NULL, reconcile_until = NULL WHERE id = ?').run(jobId);

/** 呼ばれた回数を数える ImagePort（既定は正しい PNG + 通常の usage） */
function countingPort(gen?: ImagePort['generate']): ImagePort & { calls: number } {
  const p = {
    isFake: true,
    calls: 0,
    async generate(params: Parameters<ImagePort['generate']>[0], opts: Parameters<ImagePort['generate']>[1]) {
      p.calls++;
      return gen ? gen(params, opts) : { b64: bytesToBase64(TINY_PNG), usage: { ...NORMAL_USAGE } };
    },
  };
  return p;
}

const consumer = (images: ImagePort, id: string, port: FactoryPort = stubPort({ events: [], sent: [] })) =>
  runImage(env, port, images, id, { deadline: Date.now() + 60_000 });

// ---------------------------------------------------------------------------

describe('§O-8 t1 / t2 月の上限（I1）', () => {
  it('t1: 月の記帳 2721¢ で新しい job → I1 0 行・refused monthly_cap。2720¢ なら通る（2720 + 280 = 3000）', async () => {
    seedJob('j1');
    ledger({ kind: 'image', ref: 'if:old_job', cents: 2721 });
    expect(await register('j1', 'tu_1')).toBe('refused:monthly_cap');
    expect(imageRow('tu_1')).toMatchObject({ state: 'refused', error: 'monthly_cap' });
    expect(one(db, "SELECT COUNT(*) AS n FROM cost_ledger WHERE ref_id = 'ih:j1'").n).toBe(0);

    // 対照: 境界の 1¢
    db = migratedDb();
    env = makeEnv();
    seedJob('j1');
    ledger({ kind: 'image', ref: 'if:old_job', cents: 2720 });
    expect(await register('j1', 'tu_1')).toBe('queued');
    expect(one(db, "SELECT cents FROM cost_ledger WHERE ref_id = 'ih:j1'").cents).toBe(IMAGE_HOLD_CENTS);
    expect(IMAGE_HOLD_CENTS).toBe(280);
    expect(one(db, "SELECT SUM(cents) AS c FROM cost_ledger WHERE kind = 'image'").c).toBe(3000);
  });

  it('t2: 取り置きのある job は月が 3000 に達しても 8 枚目まで queued。取り置きの無い 2 つ目の job は monthly_cap', async () => {
    seedJob('j1');
    seedJob('j2');
    ledger({ kind: 'image', ref: 'if:old_job', cents: 2720 });
    for (let i = 1; i <= 8; i++) expect(await register('j1', `tu_${i}`)).toBe('queued');
    expect(one(db, "SELECT SUM(cents) AS c FROM cost_ledger WHERE kind = 'image'").c).toBe(3000);
    // 対照
    expect(await register('j2', 'tu_j2')).toBe('refused:monthly_cap');
  });
});

describe('§O-8 t3 1 job 累積 8 枚（I2 / C2）', () => {
  it('9 枚目 → refused job_image_limit。refused の行は数えない（refused 3 + 受付 8 まで通る）', async () => {
    seedJob('j1');
    for (let i = 1; i <= 3; i++) expect(await register('j1', `bad_${i}`, { prompt: '' })).toBe('refused:bad_input:prompt');
    for (let i = 1; i <= 8; i++) expect(await register('j1', `tu_${i}`)).toBe('queued');
    expect(await register('j1', 'tu_9')).toBe('refused:job_image_limit');
    expect(one(db, "SELECT COUNT(*) AS n FROM image_requests WHERE job_id = 'j1' AND state <> 'refused'").n).toBe(8);
  });

  it('受付 1 → 停止 → C2 → 再開 → さらに受付 で累積 8 を超えない（旧 M1 の再現）。対照: C2 が refused にしたら 9 枚目が通る', async () => {
    seedJob('j1');
    expect(await register('j1', 'tu_1')).toBe('queued');
    expect(await env.DB.prepare(haltStmt(nowIso()).sql).bind(...haltStmt(nowIso()).params).run()).toBeTruthy();
    expect(halted()).toBe('manual');
    db.prepare("UPDATE image_requests SET enqueued_at = ? WHERE custom_tool_use_id = 'tu_1'").run(isoPlus(-6 * 60_000));
    await imageCronStep(env, { deadline: Date.now() + 60_000 });
    expect(imageRow('tu_1')).toMatchObject({ state: 'failed', error: 'halted' });
    // 停止中の登録は halted で断る
    expect(await register('j1', 'tu_h')).toBe('refused:halted');
    const u = unhaltStmt();
    expect(Number((await env.DB.prepare(u.sql).bind(...u.params).run()).meta.changes)).toBe(1);
    for (let i = 2; i <= 8; i++) expect(await register('j1', `tu_${i}`)).toBe('queued');
    expect(await register('j1', 'tu_9')).toBe('refused:job_image_limit');
    expect(one(db, "SELECT COUNT(*) AS n FROM image_requests WHERE job_id = 'j1' AND state <> 'refused'").n).toBe(8);

    // 対照: もし C2 が refused にしていたら（数えない行になる）累積 9 になる
    db.prepare("UPDATE image_requests SET state = 'refused' WHERE custom_tool_use_id = 'tu_1'").run();
    expect(await register('j1', 'tu_9b')).toBe('queued');
  });
});

describe('§O-8 t4 日次（I1 = claimSubmit と同じ式）', () => {
  function seedVerifyInFlight(phase: string | null) {
    seedJob('jv', { status: 'done' });
    db.prepare(
      `INSERT INTO material_versions (id, material_id, version, job_id, session_id, r2_prefix, content_sha256, material_json, claims_json, adapt_rules_md,
         checks_json, public_paths_json, status, verify_phase, created_at)
       VALUES ('v1', 'm_jv', 1, 'jv', 'sesn_jv', 'p/', 'x', '{}', '{}', '', '{}', '[]', 'review', ?, ?)`,
    ).run(phase, T);
  }

  it('記帳 1000 + 検証の飛行中 1 × 予約 300 + 280 > 1500 → daily_cap。対照: 検証の飛行中が無ければ通る', async () => {
    env = makeEnv({ DAILY_CAP_CENTS: '1500', VERIFY_TURN_RESERVE_CENTS: '300' });
    seedJob('j1');
    seedVerifyInFlight('submitted');
    ledger({ kind: 'session', ref: 'jx', cents: 1000 });
    expect(await register('j1', 'tu_1')).toBe('refused:daily_cap');
    // 対照
    db.prepare("UPDATE material_versions SET verify_phase = NULL WHERE id = 'v1'").run();
    expect(await register('j1', 'tu_2')).toBe('queued');
  });

  it('旧 M1 の数（記帳 1235・検証予約 300・上限 1500）で 0 行', async () => {
    env = makeEnv({ DAILY_CAP_CENTS: '1500', VERIFY_TURN_RESERVE_CENTS: '300' });
    seedJob('j1');
    seedVerifyInFlight('collecting');
    ledger({ kind: 'session', ref: 'jx', cents: 1235 });
    expect(await register('j1', 'tu_1')).toBe('refused:daily_cap');
    expect(one(db, "SELECT COUNT(*) AS n FROM cost_ledger WHERE kind = 'image'").n).toBe(0);
  });

  it('dailyReservedSql は 記帳の日次合計 + 予約 × 飛行中 を返す（claimSubmit と I1 の共通の式）', async () => {
    seedVerifyInFlight('submitting');
    ledger({ kind: 'session', ref: 'jx', cents: 40 });
    const d = dailyReservedSql(tokyoDay(), 7);
    expect(one(db, `SELECT ${d.sql} AS c`, ...d.params).c).toBe(47);
  });
});

describe('§O-8 t5 D の競合', () => {
  it('2 つの consumer が同じ依頼で D → 1 つだけ changes = 1、OpenAI は 1 回', async () => {
    seedJob('j1');
    await register('j1', 'tu_1');
    const id = String(imageRow('tu_1').id);
    const images = countingPort();
    const [a, b] = await Promise.all([consumer(images, id), consumer(images, id)]);
    expect([a, b].sort()).toEqual(['done', 'not_dispatched']);
    expect(images.calls).toBe(1);
    expect(imageRow('tu_1').state).toBe('done');
  });
});

describe('§O-8 t6 R の表（fake のシナリオ）', () => {
  const cases: Array<[string, string, string | null, number | null, string | null, 'json' | 'missing' | null, string?]> = [
    // scenario, state, error, actual_cents, halt（接頭辞）, usage_json の形, format
    ['ok', 'done', null, 6, null, 'json'],
    ['ok_webp', 'done', null, 6, null, 'json', 'webp'],
    ['over_reserve', 'done', null, 61, 'over_reserve:', 'json'],
    ['no_usage', 'done', null, null, 'usage_missing:', 'missing'],
    ['bad_bytes', 'failed', 'bad_response', 6, null, 'json'],
    ['bad_bytes_with_usage', 'failed', 'bad_response', 61, 'over_reserve:', 'json'],
    ['rate_limited', 'failed', 'rate_limited', null, null, null],
    ['server', 'failed', 'server', null, null, null],
    ['moderation', 'failed', 'moderation', null, null, null],
    ['quota', 'failed', 'quota', null, 'quota', null],
    ['timeout', 'failed', 'result_unknown', null, 'result_unknown:', null],
  ];
  for (const [scenario, state, error, actual, halt, usage, format] of cases)
    it(`${scenario} → ${state} / ${error} / actual ${actual} / 停止 ${halt}`, async () => {
      seedJob('j1');
      db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('fake_openai_scenario', ?, ?)").run(scenario, T);
      await register('j1', 'tu_1', good(format ? { format } : {}));
      const id = String(imageRow('tu_1').id);
      expect(await consumer(createFakeImagePort(env), id)).toBe(state);
      const r = imageRow('tu_1');
      expect([r.state, r.error, r.actual_cents]).toEqual([state, error, actual]);
      if (usage === 'missing') expect(r.usage_json).toBe('{"missing":true}');
      else if (usage === 'json') expect(JSON.parse(String(r.usage_json))).toMatchObject({ out_image: expect.any(Number) });
      else expect(r.usage_json).toBeNull();
      expect(halted()).toBe(halt === null ? null : halt.endsWith(':') ? `${halt}${id}` : halt);
      if (state === 'done') {
        expect(r.r2_key).toBe(`img/j1/${id}/${r.dispatch_token}.${format ?? 'png'}`);
        expect(r.sha256).toBe(await sha256(r2.get(String(r.r2_key))!));
      } else expect(r.r2_key).toBeNull();
      expect((await readOpenAiCalls(env.DB)).length).toBe(1);
    });

  it('R2 put の失敗は「使えない画像」と同じ扱い（failed bad_response、usage はそのまま、実額 ≤ U なら停止しない）', async () => {
    seedJob('j1');
    await register('j1', 'tu_1');
    r2FailPut = true;
    expect(await consumer(countingPort(), String(imageRow('tu_1').id))).toBe('failed');
    expect(imageRow('tu_1')).toMatchObject({ state: 'failed', error: 'bad_response', actual_cents: 6 });
    expect(halted()).toBeNull();
  });

  it('401 / 403 → failed auth + 停止 auth（本物の port、fetch を差し替え）・2xx で画像も usage も無い → bad_response + usage_missing', async () => {
    seedJob('j1');
    await register('j1', 'tu_1');
    const auth = openAiPort(env, { fetchImpl: async () => new Response(JSON.stringify({ error: { code: 'invalid_api_key' } }), { status: 401 }) });
    expect(await consumer(auth, String(imageRow('tu_1').id))).toBe('failed');
    expect(imageRow('tu_1')).toMatchObject({ state: 'failed', error: 'auth', usage_json: null });
    expect(halted()).toBe('auth');

    db = migratedDb();
    env = makeEnv();
    seedJob('j1');
    await register('j1', 'tu_1');
    const empty = openAiPort(env, { fetchImpl: async () => new Response(JSON.stringify({ data: [] }), { status: 200 }) });
    const id = String(imageRow('tu_1').id);
    await consumer(empty, id);
    expect(imageRow('tu_1')).toMatchObject({ state: 'failed', error: 'bad_response', usage_json: '{"missing":true}', actual_cents: null });
    expect(halted()).toBe(`usage_missing:${id}`);
  });

  it('too_large（4 MiB 超）と分類・停止の純関数', () => {
    const big = new Uint8Array(4 * 1024 * 1024 + 1);
    big.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(decodeImage(bytesToBase64(big), 'png')).toEqual({ ok: false, error: 'too_large' });
    expect(decodeImage(bytesToBase64(TINY_PNG), 'webp')).toEqual({ ok: false, error: 'bad_response' });
    expect(decodeImage('%%%', 'png')).toEqual({ ok: false, error: 'bad_response' });
    const tl = classifyImageOutcome({ kind: 'image', usable: false, error: 'too_large', usage: null });
    expect(tl).toEqual({ state: 'failed', error: 'too_large', usage_json: '{"missing":true}', actual_cents: null });
    expect(haltReasonFor({ requestId: 'img_x', u: 10, result: tl })).toBe('usage_missing:img_x');
    // 応答不明・port の外の例外は result_unknown
    expect(classifyImageOutcome({ kind: 'error', error: new Error('boom') }).error).toBe('result_unknown');
    expect(classifyImageOutcome({ kind: 'error', error: new OpenAiError(false, undefined, 'connection', null) }).error).toBe('result_unknown');
    // HTTP の失敗で usage があり実額 ≤ U なら停止しない
    const small = classifyImageOutcome({ kind: 'error', error: new OpenAiError(true, 429, 'rate_limited', { ...NORMAL_USAGE }) });
    expect(haltReasonFor({ requestId: 'img_x', u: 10, result: small })).toBeNull();
  });
});

describe('§O-8 t7 C3 の後に遅れた R1', () => {
  it('R1 は 0 行、停止は 1 回だけ（理由は result_unknown）', async () => {
    seedJob('j1');
    await register('j1', 'tu_1');
    const id = String(imageRow('tu_1').id);
    let release!: (v: { b64: string; usage: ImageUsage | null }) => void;
    let called!: () => void;
    const calledP = new Promise<void>((r) => (called = r));
    const images: ImagePort = {
      isFake: true,
      generate: () =>
        new Promise((r) => {
          release = r;
          called();
        }),
    };
    const running = consumer(images, id);
    await calledP;
    expect(imageRow('tu_1').state).toBe('dispatched');
    db.prepare('UPDATE image_requests SET dispatched_at = ? WHERE id = ?').run(isoPlus(-11 * 60_000), id);
    const out = await imageCronStep(env, { deadline: Date.now() + 60_000 });
    expect(out.c3).toBe(1);
    expect(imageRow('tu_1')).toMatchObject({ state: 'failed', error: 'result_unknown' });
    expect(halted()).toBe(`result_unknown:${id}`);
    release({ b64: bytesToBase64(TINY_PNG), usage: { ...NORMAL_USAGE, out_image: 20_000 } }); // 遅れた結果は実額 > U でも書かない
    expect(await running).toBe('result_discarded');
    expect(imageRow('tu_1')).toMatchObject({ state: 'failed', error: 'result_unknown', usage_json: null });
    expect(rows(db, "SELECT value FROM settings WHERE key = 'image_gen_halted'")).toEqual([{ value: `result_unknown:${id}` }]);
    // 2 回目の C3 は 0 行
    expect((await imageCronStep(env, { deadline: Date.now() + 60_000 })).c3).toBe(0);
  });
});

describe('§O-8 t8 queued の打ち切り（C2）と再投入（C1）', () => {
  const old = () => isoPlus(-6 * 60_000);
  it('停止 / job cancel / 3 回 → failed、理由は 停止 > job > 回数 の順。それ以外は C1 で再投入し send。D は 0 行', async () => {
    seedJob('j1');
    seedJob('j2', { status: 'cancelled' });
    seedJob('j3');
    seedJob('j4');
    const a = insertImage({ tu: 'a', job: 'j2', state: 'queued', enqueue_count: 3, enqueued_at: old() }); // 停止 + cancel + 3 回
    const b = insertImage({ tu: 'b', job: 'j2', state: 'queued', enqueue_count: 3, enqueued_at: old() }); // cancel + 3 回
    const c = insertImage({ tu: 'c', job: 'j3', state: 'queued', enqueue_count: 3, enqueued_at: old() }); // 3 回
    const d = insertImage({ tu: 'd', job: 'j4', state: 'queued', enqueue_count: 1, enqueued_at: old() }); // 再投入
    const fresh = insertImage({ tu: 'e', job: 'j4', state: 'queued', enqueue_count: 1, enqueued_at: nowIso() }); // 5 分未満
    // D: cancel 済みの job は 0 行
    const ds = dispatchStmt({ id: b, token: 't', now: nowIso() });
    expect(Number((await env.DB.prepare(ds.sql).bind(...ds.params).run()).meta.changes)).toBe(0);

    // 停止中は a だけを halted にする（読んだ順に判定するので、1 回目は停止なし → 2 回目に停止）
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('image_gen_halted', 'manual', ?)").run(T);
    const images = countingPort();
    expect(await consumer(images, d)).toBe('not_dispatched'); // 停止中の D は 0 行、OpenAI 0 回
    expect(images.calls).toBe(0);
    // a だけ停止の理由を確かめる
    db.prepare("UPDATE image_requests SET enqueued_at = ? WHERE id IN (?, ?, ?)").run(nowIso(), b, c, d);
    await imageCronStep(env, { deadline: Date.now() + 60_000 });
    expect(one(db, 'SELECT state, error FROM image_requests WHERE id = ?', a)).toEqual({ state: 'failed', error: 'halted' });
    db.prepare("DELETE FROM settings WHERE key = 'image_gen_halted'").run();
    db.prepare("UPDATE image_requests SET enqueued_at = ? WHERE id IN (?, ?, ?)").run(old(), b, c, d);
    const out = await imageCronStep(env, { deadline: Date.now() + 60_000 });
    expect(one(db, 'SELECT state, error FROM image_requests WHERE id = ?', b)).toEqual({ state: 'failed', error: 'job_ended' });
    expect(one(db, 'SELECT state, error FROM image_requests WHERE id = ?', c)).toEqual({ state: 'failed', error: 'enqueue_exhausted' });
    expect(one(db, 'SELECT state, enqueue_count FROM image_requests WHERE id = ?', d)).toEqual({ state: 'queued', enqueue_count: 2 });
    expect(one(db, 'SELECT state, enqueue_count FROM image_requests WHERE id = ?', fresh)).toEqual({ state: 'queued', enqueue_count: 1 });
    expect(out).toMatchObject({ c2: 2, c1: 1, sent: 1 });
    expect(queue).toEqual([d]);
  });
});

describe('§O-8 t9 F 取り置きの確定', () => {
  it('job 終端・queued / dispatched 無し → 1 回だけ if:、額 = 呼んだ分の U の合計。dispatched が残る間は 0 行。2 回目は 0 行', async () => {
    seedJob('j1');
    ledger({ kind: 'image', ref: 'ih:j1', cents: 280 });
    insertImage({ tu: 'a', state: 'done', u: 10, r2_key: 'k', sha: 's', dispatched_at: T });
    insertImage({ tu: 'b', state: 'failed', error: 'server', u: 35, dispatched_at: T });
    insertImage({ tu: 'c', state: 'refused', error: 'bad_input:prompt', u: null });
    insertImage({ tu: 'd', state: 'failed', error: 'job_ended', u: 35 }); // 呼んでいない（dispatched_at NULL）
    const disp = insertImage({ tu: 'e', state: 'dispatched', u: 10, dispatched_at: nowIso() });
    const f = finalizeHoldStmt('j1');
    const run = async () => Number((await env.DB.prepare(f.sql).bind(...f.params).run()).meta.changes);
    expect(await run()).toBe(0); // job がまだ running
    db.prepare("UPDATE factory_jobs SET status = 'cancelled' WHERE id = 'j1'").run();
    expect(await run()).toBe(0); // dispatched が残る
    expect((await imageCronStep(env, { deadline: Date.now() + 60_000 })).finalized).toBe(0);
    db.prepare("UPDATE image_requests SET state = 'done', r2_key = 'k2', sha256 = 's2' WHERE id = ?").run(disp);
    expect((await imageCronStep(env, { deadline: Date.now() + 60_000 })).finalized).toBe(1);
    expect(rows(db, "SELECT ref_id, cents FROM cost_ledger WHERE kind = 'image'")).toEqual([{ ref_id: 'if:j1', cents: 10 + 35 + 10 }]);
    expect(await run()).toBe(0);
    expect((await imageCronStep(env, { deadline: Date.now() + 60_000 })).finalized).toBe(0);
  });

  it('H2 再開は dispatched が残る間は 0 行・H1 は最初の理由を上書きしない', async () => {
    seedJob('j1');
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('image_gen_halted', 'quota', ?)").run(T);
    const h1 = haltStmt(nowIso());
    await env.DB.prepare(h1.sql).bind(...h1.params).run();
    expect(halted()).toBe('quota');
    insertImage({ tu: 'x', state: 'dispatched', dispatched_at: nowIso() });
    const h2 = unhaltStmt();
    expect(Number((await env.DB.prepare(h2.sql).bind(...h2.params).run()).meta.changes)).toBe(0);
    db.prepare("UPDATE image_requests SET state = 'failed', error = 'server'").run();
    expect(Number((await env.DB.prepare(h2.sql).bind(...h2.params).run()).meta.changes)).toBe(1);
    expect(halted()).toBeNull();
  });
});

describe('§O-8 t10 reconcile の requires_action', () => {
  const gi = (id: string, input: unknown = good()) => ({ id, type: 'agent.custom_tool_use', name: 'generate_image', input });
  const idle = (ids: string[], id = 'sevt_idle') => ({ id, type: 'session.status_idle', stop_reason: { type: 'requires_action', event_ids: ids } });

  it('generate_image → I と send 1 回・待ちは awaiting_image:1 → 終端で result 1 回 → answered なら送らない（対照: answered が無ければ送る）', async () => {
    seedJob('j1');
    const events: unknown[] = [{ id: 'sevt_1', type: 'user.define_outcome' }, gi('tu_g'), idle(['tu_g'])];
    const sent: unknown[] = [];
    const port = stubPort({ events, sent });
    expect(await rec(port)).toBe('awaiting_image:1');
    const row = imageRow('tu_g');
    expect(row.state).toBe('queued');
    expect(queue).toEqual([row.id]);
    expect(sent).toEqual([]);
    // queued のまま → 送らず待つ（登録し直さない・send もしない）
    expect(await rec(port)).toBe('awaiting_image:1');
    expect(queue).toHaveLength(1);
    expect(one(db, 'SELECT COUNT(*) AS n FROM image_requests').n).toBe(1);

    // 終端（done）→ result を 1 回
    const id = String(row.id);
    r2.set(`img/j1/${id}/tok.png`, TINY_PNG);
    db.prepare("UPDATE image_requests SET state = 'done', r2_key = ?, sha256 = ? WHERE id = ?").run(`img/j1/${id}/tok.png`, await sha256(TINY_PNG), id);
    expect(await rec(port)).toBe('image_results:1');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: 'user.custom_tool_result', custom_tool_use_id: 'tu_g', is_error: false });
    // 対照: answered が無いので次もまた送る（p4a で無害）
    expect(await rec(port)).toBe('image_results:1');
    expect(sent).toHaveLength(2);
    // answered（idle より新しい result）があれば送らない。deny にも数えない
    events.push({ id: 'sevt_res', type: 'user.custom_tool_result', custom_tool_use_id: 'tu_g', is_error: false });
    expect(await rec(port)).toBe('already_denied');
    expect(sent).toHaveLength(2);
    expect(one(db, "SELECT deny_count FROM factory_jobs WHERE id = 'j1'").deny_count).toBe(0);
  });

  it('tool_confirmation との混在: deny は tool_confirmation だけ（画像は登録して待つ）', async () => {
    seedJob('j1');
    const events: unknown[] = [
      { id: 'sevt_1', type: 'user.define_outcome' },
      gi('tu_g'),
      { id: 'tu_b', type: 'agent.tool_use', name: 'bash', input: {}, evaluated_permission: 'ask' },
      idle(['tu_g', 'tu_b']),
    ];
    const sent: unknown[] = [];
    expect(await rec(stubPort({ events, sent }))).toBe('denied:1');
    expect(sent).toEqual([{ type: 'user.tool_confirmation', tool_use_id: 'tu_b', result: 'deny', deny_message: expect.any(String) }]);
    expect(one(db, "SELECT deny_count, denied_event_ids_json FROM factory_jobs WHERE id = 'j1'")).toEqual({ deny_count: 1, denied_event_ids_json: '["tu_b"]' });
    expect(imageRow('tu_g').state).toBe('queued');
  });

  it('断った依頼（questions の段階）は同じ reconcile で is_error の結果を返す', async () => {
    seedJob('j1', { phase: 'questions' });
    const sent: unknown[] = [];
    expect(await rec(stubPort({ events: [gi('tu_g'), idle(['tu_g'])], sent }))).toBe('image_results:1');
    expect(sent).toEqual([
      { type: 'user.custom_tool_result', custom_tool_use_id: 'tu_g', is_error: true, content: [{ type: 'text', text: '画像は制作の指示が来てから使ってください。' }] },
    ]);
    expect(queue).toEqual([]);
  });
});

describe('§O-8 t11 deny 数の派生を 3 か所で使う', () => {
  const refusedRows = (n: number) => {
    for (let i = 0; i < n; i++) insertImage({ tu: `r_${i}`, state: i % 2 ? 'refused' : 'failed', error: i % 2 ? 'bad_input:prompt' : 'server', u: i % 2 ? null : 10 });
  };
  const tu = { id: 'tu_b', type: 'agent.tool_use', name: 'bash', input: {}, evaluated_permission: 'ask' };
  const idleB = { id: 'sevt_idle', type: 'session.status_idle', stop_reason: { type: 'requires_action', event_ids: ['tu_b'] } };

  for (const [n, expected] of [
    [9, 'failed:too_many_denies'],
    [8, 'no_idle_event'],
  ] as const)
    it(`入口: refused / failed ${n} 件 → ${expected}`, async () => {
      seedJob('j1');
      refusedRows(n);
      const sent: unknown[] = [];
      expect(await rec(stubPort({ events: [], sent }))).toBe(expected);
    });

  for (const [n, expected] of [
    [8, 'failed:too_many_denies'],
    [7, 'already_answered:1'],
  ] as const)
    it(`answered を回収した後: 回収 1 + 画像 ${n} → ${expected}`, async () => {
      seedJob('j1');
      refusedRows(n);
      const events = [tu, idleB, { id: 'sevt_ans', type: 'user.tool_confirmation', tool_use_id: 'tu_b', result: 'deny' }];
      expect(await rec(stubPort({ events, sent: [] }))).toBe(expected);
    });

  for (const [n, expected] of [
    [8, 'failed:too_many_denies'],
    [7, 'denied:1'],
  ] as const)
    it(`通常の deny を保存した後: deny 1 + 画像 ${n} → ${expected}`, async () => {
      seedJob('j1');
      refusedRows(n);
      expect(await rec(stubPort({ events: [tu, idleB], sent: [] }))).toBe(expected);
    });
});

describe('§O-8 t15 deny の数え方（B1 の順序）', () => {
  async function seedAB() {
    seedJob('j1', { deny: 7 });
    const aKey = 'img/j1/a/tok.png';
    r2.set(aKey, TINY_PNG);
    insertImage({ tu: 'tu_A', state: 'done', r2_key: aKey, sha: await sha256(TINY_PNG), dispatched_at: T });
    insertImage({ tu: 'tu_B', state: 'failed', error: 'result_unknown', dispatched_at: T });
  }
  const A = { id: 'tu_A', type: 'agent.custom_tool_use', name: 'generate_image', input: good() };
  const B = { id: 'tu_B', type: 'agent.custom_tool_use', name: 'generate_image', input: good() };
  const idle = { id: 'sevt_idle', type: 'session.status_idle', stop_reason: { type: 'requires_action', event_ids: ['tu_A', 'tu_B'] } };
  const resA = { id: 'sevt_resA', type: 'user.custom_tool_result', custom_tool_use_id: 'tu_A', is_error: false };
  const resB = { id: 'sevt_resB', type: 'user.custom_tool_result', custom_tool_use_id: 'tu_B', is_error: true };

  // events は古い順。desc で読むと 前者 = result(A) → idle → tool_use(B) → tool_use(A)、後者 = result(A) → idle → tool_use(A) → tool_use(B)
  for (const [label, asc, aRead] of [
    ['result(A) → idle → tool_use(B) → tool_use(A)（走査が A の tool_use を読まずに終わる）', [A, B, idle, resA], false],
    ['result(A) → idle → tool_use(A) → tool_use(B)', [B, A, idle, resA], true],
  ] as const)
    it(`${label}: deny 合計 8 で too_many_denies にならず、A・B は recovered に入らない`, async () => {
      await seedAB();
      const events: unknown[] = [...asc];
      const sent: unknown[] = [];
      const port = stubPort({ events, sent });
      expect(await rec(port)).toBe('image_results:1');
      expect(sent).toEqual([
        { type: 'user.custom_tool_result', custom_tool_use_id: 'tu_B', is_error: true, content: [{ type: 'text', text: imageErrorText('result_unknown') }] },
      ]);
      const blocked = JSON.parse(String(one(db, "SELECT reconcile_state_json FROM factory_jobs WHERE id = 'j1'").reconcile_state_json)).scan.idle.agg.blocked;
      // 対照の前提: 前者の順では走査の blocked に A が無い（blocked だけで除くと A が recovered に入り 7 + 1 + 1 = 9）
      expect('tu_A' in blocked).toBe(aRead);
      expect(one(db, "SELECT status, deny_count, denied_event_ids_json FROM factory_jobs WHERE id = 'j1'")).toEqual({
        status: 'running',
        deny_count: 7,
        denied_event_ids_json: '[]',
      });
      // B を返すと answered に出るが recovered に入らない（二重に数えない）
      events.push(resB);
      expect(await rec(port)).toBe('already_denied');
      expect(one(db, "SELECT status, deny_count FROM factory_jobs WHERE id = 'j1'")).toEqual({ status: 'running', deny_count: 7 });
    });
});

describe('§O-8 t16 OpenAiError の usage', () => {
  const body400 = JSON.stringify({
    error: { code: 'invalid_value', type: 'invalid_request_error' },
    usage: { input_tokens: 43, input_tokens_details: { text_tokens: 43, image_tokens: 0 }, output_tokens: 20000, output_tokens_details: { image_tokens: 20000, text_tokens: 0 } },
  });
  it('400 + out_image 20,000 → failed bad_request + 停止 over_reserve。対照: usage を持たない旧 port なら停止しない', async () => {
    seedJob('j1');
    await register('j1', 'tu_1');
    const id = String(imageRow('tu_1').id);
    const port = openAiPort(env, { fetchImpl: async () => new Response(body400, { status: 400 }) });
    await consumer(port, id);
    expect(imageRow('tu_1')).toMatchObject({ state: 'failed', error: 'bad_request', actual_cents: 61 });
    expect(halted()).toBe(`over_reserve:${id}`);

    // 対照
    db = migratedDb();
    env = makeEnv();
    seedJob('j1');
    await register('j1', 'tu_1');
    const inner = openAiPort(env, { fetchImpl: async () => new Response(body400, { status: 400 }) });
    const oldPort: ImagePort = {
      isFake: false,
      async generate(p, o) {
        try {
          return await inner.generate(p, o);
        } catch (e) {
          if (e instanceof OpenAiError) throw new OpenAiError(e.responded, e.status, e.kind, null);
          throw e;
        }
      },
    };
    await consumer(oldPort, String(imageRow('tu_1').id));
    expect(imageRow('tu_1')).toMatchObject({ state: 'failed', error: 'bad_request', actual_cents: null, usage_json: null });
    expect(halted()).toBeNull();
  });
});

describe('§O-8 t12 入力検査・U の表・取り込みの image_id・鍵の印・検証係の入力', () => {
  it('入力検査（旧 t17）: 4001 バイト（4000 字未満）/ enum の外 / alt 欠落・121 字 / 16,384 文字超 / object 以外', async () => {
    const p4001 = 'あ'.repeat(1333) + 'ab';
    expect(new TextEncoder().encode(p4001).length).toBe(4001);
    expect(p4001.length).toBeLessThan(4000);
    expect(validateImageInput(good({ prompt: p4001 }))).toEqual({ ok: false, field: 'prompt' });
    expect(validateImageInput(good({ prompt: 'あ'.repeat(1333) + 'a' })).ok).toBe(true);
    expect(validateImageInput(good({ prompt: ' \n\t ' }))).toEqual({ ok: false, field: 'prompt' });
    expect(validateImageInput(good({ accuracy: 'precise' }))).toEqual({ ok: false, field: 'accuracy' });
    expect(validateImageInput(good({ size: '1024x1536' }))).toEqual({ ok: false, field: 'size' });
    expect(validateImageInput(good({ quality: 'xhigh' }))).toEqual({ ok: false, field: 'quality' });
    expect(validateImageInput(good({ format: 'jpeg' }))).toEqual({ ok: false, field: 'format' });
    expect(validateImageInput(good({ background: 'auto' }))).toEqual({ ok: false, field: 'background' });
    const { alt: _a, ...noAlt } = good();
    expect(validateImageInput(noAlt)).toEqual({ ok: false, field: 'alt' });
    expect(validateImageInput(good({ alt: 'a'.repeat(121) }))).toEqual({ ok: false, field: 'alt' });
    expect(validateImageInput(good({ alt: '😀'.repeat(120) })).ok).toBe(true); // code point で数える
    expect(validateImageInput(null)).toEqual({ ok: false, field: 'input' });
    expect(validateImageInput([good()])).toEqual({ ok: false, field: 'input' });
    const huge = good({ pad: 'x'.repeat(16_384) });
    expect(keptImageInput(huge)).toEqual({ oversized: true });
    expect(keptImageInput(good())).toEqual(good());
    expect(validateImageInput(keptImageInput(huge))).toEqual({ ok: false, field: 'input' });
    // 余分なキーは保存しない
    seedJob('j1');
    expect(await register('j1', 'tu_1', good({ secret_note: 'x' }))).toBe('queued');
    expect(JSON.parse(String(imageRow('tu_1').input_json))).toEqual({ prompt: good().prompt, alt: good().alt, accuracy: 'standard' });
    expect(await register('j1', 'tu_2', keptImageInput(huge))).toBe('refused:bad_input:input');
  });

  it('U の表（旧 t18）: 全行・表に無い組み合わせ・実額の切り上げ・details 欠落は保守側・鍵が無い / questions は断る', async () => {
    for (const m of ['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'])
      for (const s of ['1024x1024', '1536x1024'])
        for (const q of ['low', 'medium', 'high', 'max']) expect(uCentsFor(m, s, q)).toBe(q === 'max' ? 35 : 10);
    expect(IMAGE_U_MAX).toBe(35);
    expect(Object.keys(IMAGE_U_CENTS).sort()).toEqual(['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst']);
    for (const [m, s, q] of [
      ['gpt-image-2', '1024x1024', 'high'],
      ['gpt-image-2.5-flare', '1024x1536', 'high'],
      ['gpt-image-2.5-flare', '1024x1024', 'xhigh'],
      ['__proto__', '1024x1024', 'high'],
      ['gpt-image-2.5-flare', 'constructor', 'high'],
      ['gpt-image-2.5-flare', '1024x1024', 'toString'],
    ])
      expect(uCentsFor(m, s, q)).toBeNull();
    expect(imageActualCents(NORMAL_USAGE)).toBe(6); // (43×5 + 1756×30) / 10,000 = 5.29 → 6
    expect(imageActualCents({ in_text: 0, in_image: 0, out_image: 0, out_text: 3334 })).toBe(11); // 100,020 micro → 10.002 → 11
    expect(imageActualCents({ in_text: 0, in_image: 0, out_image: 0, out_text: 0 })).toBe(0);
    expect(parseImageUsage({ input_tokens: 100, output_tokens: 200 })).toEqual({ in_text: 0, in_image: 100, out_image: 200, out_text: 0 });
    expect(
      parseImageUsage({ input_tokens: 100, input_tokens_details: { text_tokens: 40 }, output_tokens: 300, output_tokens_details: { text_tokens: 10, image_tokens: 200 } }),
    ).toEqual({ in_text: 40, in_image: 60, out_image: 290, out_text: 10 });
    expect(parseImageUsage(null)).toBeNull();
    expect(parseImageUsage({ input_tokens: 5 })).toBeNull(); // 出力の側が無い → 読めなかった（missing 扱い）
    // 表に無い model（var の変更）・鍵が無い・questions の段階は断る。fake の port は鍵を見ない
    seedJob('j1');
    env = makeEnv({ IMAGE_MODEL_STANDARD: 'gpt-image-2' });
    expect(await register('j1', 'tu_1')).toBe('refused:not_configured');
    env = makeEnv({ OPENAI_API_KEY: undefined });
    expect(await register('j1', 'tu_2')).toBe('refused:not_configured');
    expect(await register('j1', 'tu_3', good(), { isFake: true })).toBe('queued');
    expect(await registerImage(env, { isFake: true }, jobArg('j1', 'questions'), 'tu_4', good())).toBe('refused:questions_phase');
    env = makeEnv({ IMAGE_MODEL_SCIENTIFIC: 'gpt-image-2.5-sunburst' });
    expect(await register('j1', 'tu_5', good({ accuracy: 'scientific', quality: 'max' }))).toBe('queued');
    expect(imageRow('tu_5')).toMatchObject({ model: 'gpt-image-2.5-sunburst', u_cents: 35 });
  });

  // ---- 取り込み（旧 t19 の uploaded を done に）----
  const DONE_EVENTS = [
    { id: 'sevt_1', type: 'user.define_outcome' },
    { id: 'sevt_2', type: 'span.outcome_evaluation_end', result: 'satisfied', explanation: 'ok' },
    { id: 'sevt_3', type: 'session.status_idle', stop_reason: { type: 'end_turn' } },
  ];
  const IMG = `img_${'a'.repeat(32)}`;
  function imageMaterial(files: Array<Record<string, unknown>>) {
    const m = goodMaterial();
    (m.parts as Array<Record<string, unknown>>)[0].files = [{ path: 'parts/p1/figure-1.svg', role: 'figure' }, ...files];
    return m;
  }
  async function seedImage(o: { id?: string; job?: string; state?: string; format?: string; sha?: string; bytes?: Uint8Array } = {}) {
    const bytes = o.bytes ?? TINY_PNG;
    const key = `img/${o.job ?? 'j1'}/${o.id ?? IMG}/tok.${o.format ?? 'png'}`;
    r2.set(key, bytes);
    insertImage({ id: o.id ?? IMG, tu: `tu_${o.id ?? IMG}`, job: o.job ?? 'j1', state: o.state ?? 'done', error: o.state === 'failed' ? 'server' : null, format: o.format ?? 'png', r2_key: key, sha: o.sha ?? (await sha256(bytes)), dispatched_at: T });
    return key;
  }
  const ingest = (outputs: Map<string, Uint8Array>) => rec(stubPort({ events: DONE_EVENTS, sent: [], outputs }));
  const lastError = () => one(db, "SELECT status, error, last_error FROM factory_jobs WHERE id = 'j1'");

  it('取り込みの image_id: 正常 → 版に png・content_sha256 と public_paths_json に入る（R2 の論理キーへ写す）', async () => {
    seedJob('j1');
    await seedImage();
    const m = imageMaterial([{ path: 'parts/p1/photo-1.png', role: 'figure', image_id: IMG, alt: '赤い立方体' }]);
    const outputs = goodFiles(m);
    expect(await ingest(outputs)).toBe('versioned');
    const v = one(db, "SELECT content_sha256, public_paths_json FROM material_versions WHERE job_id = 'j1'");
    expect(JSON.parse(String(v.public_paths_json))).toContain('parts/p1/photo-1.png');
    const all = new Map(outputs);
    all.set('parts/p1/photo-1.png', TINY_PNG);
    expect(v.content_sha256).toBe(await sha256(contentDigestInput(all)));
    expect(r2.get('materials/m_j1/j1/parts/p1/photo-1.png')).toEqual(TINY_PNG);
  });

  const negatives: Array<[string, () => Promise<void>, Array<Record<string, unknown>>, string, Map<string, Uint8Array> | null]> = [
    ['別 job の画像', async () => (seedJob('j2'), void (await seedImage({ job: 'j2' }))), [{ path: 'parts/p1/photo-1.png', image_id: IMG }], 'bad_image_ref:parts/p1/photo-1.png', null],
    ['done でない', async () => void (await seedImage({ state: 'failed' })), [{ path: 'parts/p1/photo-1.png', image_id: IMG }], 'bad_image_ref:parts/p1/photo-1.png', null],
    ['sha 不一致', async () => void (await seedImage({ sha: 'f'.repeat(64) })), [{ path: 'parts/p1/photo-1.png', image_id: IMG }], 'bad_image_ref:parts/p1/photo-1.png', null],
    ['拡張子不一致', async () => void (await seedImage({ format: 'webp', bytes: Uint8Array.from(atob(TINY_WEBP_B64), (c) => c.charCodeAt(0)) })), [{ path: 'parts/p1/photo-1.png', image_id: IMG }], 'bad_image_ref:parts/p1/photo-1.png', null],
    ['image_id の形が違う', async () => void (await seedImage()), [{ path: 'parts/p1/photo-1.png', image_id: 'img_xyz' }], 'bad_image_ref:parts/p1/photo-1.png', null],
    ['image_id が svg を指す', async () => void (await seedImage()), [{ path: 'parts/p1/photo-1.svg', image_id: IMG }], 'bad_image_ref:parts/p1/photo-1.svg', null],
    ['raw に同じ basename', async () => void (await seedImage()), [{ path: 'parts/p1/photo-1.png', image_id: IMG }], 'duplicate_basename:photo-1.png', new Map([['parts/p1/photo-1.png', TINY_PNG]])],
  ];
  for (const [label, setup, files, detail, extraRaw] of negatives)
    it(`取り込みの image_id: ${label} → invalid_outputs（${detail.split(':')[0]}）`, async () => {
      seedJob('j1');
      await setup();
      const outputs = goodFiles(imageMaterial(files));
      for (const [p, b] of extraRaw ?? []) outputs.set(p, b);
      expect(await ingest(outputs)).toBe('failed:invalid_outputs');
      expect(lastError()).toEqual({ status: 'failed', error: 'invalid_outputs', last_error: detail });
    });

  it('取り込みの R2 読みの上限（セキュリティレビュー指摘）: 同じ image_id を 100 件参照しても R2 の get は 1 回、異なる image_id 9 件・path 数の超過は R2 を読まずに invalid_outputs', async () => {
    // 100 件（20 の path × 5 回）・同じ image_id → 取り込める、画像の get は 1 回
    seedJob('j1');
    const key = await seedImage();
    const files = Array.from({ length: 100 }, (_, i) => ({ path: `parts/p1/img-${i % 20}.png`, role: 'figure', image_id: IMG }));
    expect(await ingest(goodFiles(imageMaterial(files)))).toBe('versioned');
    expect(r2Gets.filter((k) => k === key)).toHaveLength(1);
    expect(JSON.parse(String(one(db, "SELECT public_paths_json FROM material_versions WHERE job_id = 'j1'").public_paths_json)).filter((p: string) => p.startsWith('parts/p1/img-'))).toHaveLength(20);

    // 異なる path が 100（raw 11 + 100 > 40）→ too_many_files、画像を読まない
    db = migratedDb();
    r2 = new Map();
    r2Gets = [];
    env = makeEnv();
    seedJob('j1');
    await seedImage();
    const many = Array.from({ length: 100 }, (_, i) => ({ path: `parts/p1/img-${i}.png`, image_id: IMG }));
    expect(await ingest(goodFiles(imageMaterial(many)))).toBe('failed:invalid_outputs');
    expect(String(lastError().last_error)).toMatch(/^too_many_files:/);
    expect(r2Gets.filter((k) => k.startsWith('img/'))).toEqual([]);

    // 異なる image_id 9 件 → bad_image_ref、画像を読まない
    db = migratedDb();
    r2 = new Map();
    r2Gets = [];
    env = makeEnv();
    seedJob('j1');
    const nine = Array.from({ length: 9 }, (_, i) => ({ path: `parts/p1/n-${i}.png`, image_id: `img_${String(i).repeat(32)}` }));
    for (const f of nine) await seedImage({ id: f.image_id });
    expect(await ingest(goodFiles(imageMaterial(nine)))).toBe('failed:invalid_outputs');
    expect(lastError().last_error).toBe('bad_image_ref:parts/p1/n-8.png');
    expect(r2Gets.filter((k) => k.startsWith('img/'))).toEqual([]);
  });

  it('鍵の印（旧 t20）: fetch の例外・応答 headers・本文・本文受信中の例外に印を入れても、ログ・D1・R2・custom_tool_result に出ない', async () => {
    const MARK = 'MARK7f3a9c';
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(' ')));
    try {
      const fetches: Array<typeof fetch> = [
        async () => {
          const e = new Error(`boom ${MARK}`, { cause: new Error(MARK) });
          e.name = `Err${MARK}`;
          throw e;
        },
        async () => new Response(JSON.stringify({ error: { message: MARK, code: MARK, type: MARK } }), { status: 500, headers: { 'x-mark': MARK } }),
        async () =>
          new Response(
            new ReadableStream({
              start(c) {
                c.enqueue(new TextEncoder().encode('{"data":[{"b64_json":"'));
                c.error(new Error(MARK));
              },
            }),
            { status: 200, headers: { 'x-mark': MARK } },
          ),
        async () => new Response(JSON.stringify({ data: [{ b64_json: btoa(MARK) }], usage: { note: MARK } }), { status: 200 }),
      ];
      for (const [i, f] of fetches.entries()) {
        db = migratedDb();
        r2 = new Map();
        env = makeEnv({ OPENAI_API_KEY: `sk-${MARK}` });
        seedJob('j1');
        const events: unknown[] = [
          { id: 'tu_g', type: 'agent.custom_tool_use', name: 'generate_image', input: good() },
          { id: 'sevt_idle', type: 'session.status_idle', stop_reason: { type: 'requires_action', event_ids: ['tu_g'] } },
        ];
        const sent: unknown[] = [];
        const port = stubPort({ events, sent });
        expect(await rec(port)).toBe('awaiting_image:1');
        expireLease();
        await runImage(env, port, openAiPort(env, { fetchImpl: f }), String(imageRow('tu_g').id), { deadline: Date.now() + 60_000 });
        expireLease();
        db.prepare("UPDATE image_requests SET dispatched_at = ?, enqueued_at = ?").run(isoPlus(-11 * 60_000), isoPlus(-6 * 60_000));
        await imageCronStep(env, { deadline: Date.now() + 60_000 });
        expect(sent.length, `fetch ${i}`).toBe(1); // 失敗の result が 1 回返る
        const dump = rows(db, "SELECT name FROM sqlite_master WHERE type = 'table'")
          .map((t) => JSON.stringify(rows(db, `SELECT * FROM ${String(t.name)}`)))
          .join('\n');
        const r2Dump = [...r2.entries()].map(([k, v]) => k + new TextDecoder().decode(v)).join('\n');
        for (const surface of [dump, r2Dump, JSON.stringify(sent), logs.join('\n')]) expect(surface.includes(MARK), `fetch ${i}`).toBe(false);
      }
    } finally {
      spy.mockRestore();
    }
  });

  it('検証係の入力（§M-2-7 5）: image_id の files ごとに 正確さ・prompt・alt の行を足す。依頼の行が無ければ part_missing', async () => {
    seedJob('j1');
    insertImage({ id: IMG, tu: 'tu_x', state: 'done', r2_key: 'k', sha: 's', input: { prompt: 'a red\ncube', alt: '赤い立方体', accuracy: 'scientific' } });
    const files: Record<string, string> = {
      'p/sources.json': '{"sources":[]}',
      'p/parts/p1/a.md': '本文',
      'p/material.json': JSON.stringify(imageMaterial([{ path: 'parts/p1/photo-1.png', role: 'figure', image_id: IMG }])),
    };
    const bucket = {
      get: async (k: string) => (k in files ? { text: async () => files[k] } : null),
      list: async (o: { prefix?: string }) => ({ objects: Object.keys(files).filter((k) => k.startsWith(o.prefix ?? '')).sort().map((key) => ({ key })), truncated: false }),
    } as unknown as R2Bucket;
    const v = { id: 'v1', material_id: 'm1', r2_prefix: 'p/', claims_json: '{"claims":[]}' };
    const out = String(await buildUserContent({ R2: bucket, DB: env.DB }, v));
    expect(out).toContain('# 画像（生成した絵。画像そのものは渡さない）\n- parts/p1/photo-1.png: 正確さ=scientific、prompt=a red cube、alt=赤い立方体');
    // 画像の無い版は変わらない（DB を読まない）
    files['p/material.json'] = JSON.stringify(goodMaterial());
    expect(String(await buildUserContent({ R2: bucket }, v))).not.toContain('# 画像');
    // 参照した依頼の行が無い
    files['p/material.json'] = JSON.stringify(imageMaterial([{ path: 'parts/p1/photo-1.png', image_id: `img_${'b'.repeat(32)}` }]));
    expect(await buildUserContent({ R2: bucket, DB: env.DB }, v)).toEqual({ error: 'part_missing' });
  });
});

describe('§O-8 t13 migration 0004', () => {
  it('既存の台帳と idx_cost_ledger_vb が残る・image は job ごとに 1 行（ih と if で 2 行にならない）', () => {
    const raw = new DatabaseSync(':memory:');
    const sql = (f: string) => readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8');
    for (const f of ['0001_init.sql', '0002_intake.sql', '0003_review_triage.sql']) raw.exec(sql(f));
    const ins = (id: string, kind: string, ref: string) =>
      raw.prepare('INSERT INTO cost_ledger (id, day, kind, ref_id, cents, created_at) VALUES (?, ?, ?, ?, 5, ?)').run(id, '2026-11-05', kind, ref, T);
    ins('l1', 'session', 'j1');
    ins('l2', 'verify', 'vb:v1:t:t0');
    ins('l3', 'scout', 's1');
    expect(() => ins('l9', 'image', 'ih:j1')).toThrow(/CHECK/);
    raw.exec(sql('0004_image_gen.sql'));
    expect(rows(raw, 'SELECT id, kind, ref_id FROM cost_ledger ORDER BY id')).toEqual([
      { id: 'l1', kind: 'session', ref_id: 'j1' },
      { id: 'l2', kind: 'verify', ref_id: 'vb:v1:t:t0' },
      { id: 'l3', kind: 'scout', ref_id: 's1' },
    ]);
    const idx = rows(raw, "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'cost_ledger' ORDER BY name").map((r) => r.name);
    expect(idx).toEqual(expect.arrayContaining(['idx_cost_day', 'idx_cost_ledger_image_job', 'idx_cost_ledger_vb']));
    expect(() => ins('l4', 'verify', 'vb:v1:t:t0')).toThrow(/UNIQUE/);
    ins('l5', 'image', 'ih:j9');
    expect(() => ins('l6', 'image', 'if:j9')).toThrow(/UNIQUE/);
    ins('l7', 'image', 'ih:j8');
    ins('l8', 'session', 'ih:j9'); // image 以外は対象外
    expect(() => raw.prepare("INSERT INTO image_requests (id, custom_tool_use_id, job_id, session_id, state, created_at, updated_at) VALUES ('i1', 't', 'j', 's', 'done', ?, ?)").run(T, T)).toThrow(/CHECK/);
  });
});

describe('§O-8 t14 結果の形（形 A: base64 直）', () => {
  it('1.5 MB の PNG（base64 で約 2 MB）を reconcile が R2 から読んで image block + 成功の文で返す。本文の大きさを記録する', async () => {
    seedJob('j1');
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('fake_openai_scenario', 'ok_large', ?)").run(T);
    const events: unknown[] = [
      { id: 'tu_g', type: 'agent.custom_tool_use', name: 'generate_image', input: good({ quality: 'max', size: '1536x1024' }) },
      { id: 'sevt_idle', type: 'session.status_idle', stop_reason: { type: 'requires_action', event_ids: ['tu_g'] } },
    ];
    const sent: unknown[] = [];
    const port = stubPort({ events, sent });
    expect(await rec(port)).toBe('awaiting_image:1');
    expireLease();
    const row0 = imageRow('tu_g');
    expect(await runImage(env, port, createFakeImagePort(env), String(row0.id), { deadline: Date.now() + 60_000 })).toBe('done');
    const row = imageRow('tu_g');
    const bytes = r2.get(String(row.r2_key))!;
    expect(bytes.byteLength).toBeGreaterThan(1_400_000);
    expect(bytes.byteLength).toBeLessThan(2 * 1024 * 1024); // 取り込みの 1 ファイル上限に収まる
    expect(sent).toHaveLength(1);
    const ev = sent[0] as { type: string; custom_tool_use_id: string; is_error: boolean; content: Array<Record<string, unknown>> };
    const body = JSON.stringify({ events: [ev] });
    console.log(JSON.stringify({ at: 't14', image_bytes: bytes.byteLength, event_body_bytes: new TextEncoder().encode(body).length }));
    expect(body.length).toBeGreaterThan(1_900_000);
    expect(ev).toMatchObject({ type: 'user.custom_tool_result', custom_tool_use_id: 'tu_g', is_error: false });
    const src = ev.content[0].source as { type: string; media_type: string; data: string };
    expect([ev.content[0].type, src.type, src.media_type]).toEqual(['image', 'base64', 'image/png']);
    expect(await sha256(Uint8Array.from(atob(src.data), (c) => c.charCodeAt(0)))).toBe(row.sha256);
    expect(ev.content[1]).toEqual({
      type: 'text',
      text:
        `画像を作りました（image_id: ${row.id}、standard・1536x1024・max・png）。上の画像を見て、注文票と事実に合っているか確かめてください。` +
        `直したい時は prompt を直してもう一度呼んでください（この注文で作れる残りは 7 枚）。` +
        `使う時は material.json の parts[].files[] に {"path": "parts/<part_id>/<ファイル名>.png", "role": "figure", "image_id": "${row.id}", "alt": "<絵の説明>"} を書いてください。` +
        `画像ファイルを outputs に置かないでください。`,
    });
    expect(row.u_cents).toBe(35);
  });

  it('断り・失敗の文の表（§O-6 a）', () => {
    const unavailable = '今は画像を作れません。図は SVG で描いてください。';
    const failed = '画像を作れませんでした。もう一度試すか、図は SVG で描いてください。';
    expect(imageErrorText('questions_phase')).toBe('画像は制作の指示が来てから使ってください。');
    expect(imageErrorText('bad_input:prompt')).toBe('入力が正しくありません（prompt）。prompt は 4000 バイト以内、alt は 120 字以内、他の項目は決められた値から選んでください。');
    expect(imageErrorText('job_image_limit')).toBe('この注文で作れる画像（8 枚）を使い切りました。図は SVG で描いてください。');
    for (const e of ['halted', 'not_configured', 'daily_cap', 'monthly_cap', 'reserve_conflict', 'paused']) expect(imageErrorText(e)).toBe(unavailable);
    expect(imageErrorText('moderation')).toBe('この内容の画像は作れませんでした（安全上の制限）。描く内容を変えるか、図は SVG で描いてください。');
    for (const e of ['rate_limited', 'quota', 'auth', 'bad_request', 'server', 'bad_response', 'too_large', 'result_unknown', 'enqueue_exhausted', 'job_ended'])
      expect(imageErrorText(e)).toBe(failed);
  });
});

afterEach(() => {
  vi.useRealTimers();
});
