// §Q-10 混雑時のやり直しと予備のモデル（受け入れ §Q-10 13）。
// node:sqlite の実 DB + R2 の Map（条件つき put: onlyIf.etagDoesNotMatch '*' = まだ無い時だけ。書けなければ null）+ fake の GeminiPort + fake の待ち（sleep）。
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import type { DatabaseSync } from 'node:sqlite';
import type { Message } from '@anthropic-ai/sdk/resources/messages/messages';
import type { MessageBatchIndividualResponse } from '@anthropic-ai/sdk/resources/messages/batches';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FactoryPort } from '../src/anthropic';
import { tokyoDay } from '../src/db';
import { cfg, type Env } from '../src/env';
import { GeminiError, geminiPort, type GeminiErrorKind, type GeminiPort, type GeminiWatchRequest } from '../src/gemini';
import type { RouteCtx } from '../src/http';
import { reviewDetail } from '../src/routes/review';
import { enableVideos, probeVideo, videoStatusSummary } from '../src/routes/videos';
import { VIDEO_CALL_MIN_MS, VIDEO_RETRY_WAIT_MS, loadVideoNotes, runVerificationStep, verifyPlanKey, type VersionForVerify } from '../src/verify';
import { VIDEO_MAX_CALLS, readVersionVideoNotes, versionVideosOf, videoCallDecision, type VersionVideo, type VideoCallRecord } from '../src/videos';
import { d1, migratedDb, one, rows } from './d1-shim';
import { goodMaterial } from './helpers';

const T0 = '2026-11-05T00:00:00.000Z';
const PREFIX = 'materials/m1/j1/';
const NOTES_KEY = `${PREFIX}video-notes.json`;
const YT1 = 'dQw4w9WgXcQ';
const YT2 = 'abcdefghij_';
const URL_A = 'https://minecraft.wiki/w/Redstone_Dust';
const watchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;
const USED = '（Gemini が区間を見て書いた記録。職人が書いたものではない）';
const NONE = '（記録なし。判定に含めない）';
const PRIMARY = 'gemini-3.6-flash';
const FALLBACK = 'gemini-3.8-flash';
const no = () => {
  throw new Error('not used in this test');
};

type Obj = Record<string, unknown>;
const video = (o: Obj = {}): Obj => ({
  id: 'v1',
  youtube_id: YT1,
  title: 'レッドストーンの基本',
  channel: '公式チャンネル',
  start_sec: 80,
  end_sec: 185,
  why: '粉の上を信号が進む様子が見える',
  rights_note: 'チャンネルの概要欄に本人の制作とある',
  source_id: 's9',
  ...o,
});
const V2 = () => video({ id: 'v2', youtube_id: YT2, source_id: 's10', start_sec: 0, end_sec: 60, title: '回路の例' });

let db: DatabaseSync;
let r2: Map<string, string>;
let puts: string[];
let gets: string[];
let failPut: Set<string>;
let nullPut: Set<string>;
/** §Q-9.1 の 1 文（取り置き）を試みた回数と、入った回数 */
let reserveTries: number;
let reserveWins: number;

const callKey = (vid: string, n: number) => `${PREFIX}video-calls/${vid}/${n}.json`;
const callKeys = () => [...r2.keys()].filter((k) => k.includes('/video-calls/')).sort();
const callRecord = (vid: string, n: number) => JSON.parse(String(r2.get(callKey(vid, n)))) as Obj;

function makeEnv(vars: Record<string, string> = {}): Env {
  const base = d1(db);
  const DB = {
    prepare(sql: string) {
      const st = base.prepare(sql);
      if (!sql.startsWith('INSERT INTO cost_ledger (id, day, kind, ref_id, cents, created_at)\nSELECT')) return st;
      const wrap = (s: D1PreparedStatement): D1PreparedStatement =>
        ({
          bind: (...p: unknown[]) => wrap(s.bind(...p)),
          run: async () => {
            reserveTries++;
            const r = await s.run();
            if (Number(r.meta?.changes ?? 0) > 0) reserveWins++;
            return r;
          },
        }) as unknown as D1PreparedStatement;
      return wrap(st);
    },
    batch: base.batch.bind(base),
  } as unknown as D1Database;
  return {
    DB,
    R2: {
      // Cloudflare の R2 の put: onlyIf の条件が成り立たなければ保存せず null を返す
      async put(k: string, v: string, o?: { onlyIf?: { etagDoesNotMatch?: string } }) {
        if (failPut.has(k)) throw new Error('r2_down');
        if (nullPut.has(k)) return null;
        if (o?.onlyIf?.etagDoesNotMatch === '*' && r2.has(k)) return null;
        puts.push(k);
        r2.set(k, String(v));
        return { key: k };
      },
      async get(k: string) {
        gets.push(k);
        const b = r2.get(k);
        return b === undefined ? null : { size: b.length, text: async () => b };
      },
      async list(o: { prefix?: string }) {
        const keys = [...r2.keys()].filter((k) => k.startsWith(o.prefix ?? '')).sort();
        return { objects: keys.map((key) => ({ key })), truncated: false };
      },
    },
    DAILY_CAP_CENTS: '100000',
    VERIFY_MAX_FETCHES: '25',
    VERIFY_MAX_ATTEMPTS: '9',
    ...vars,
  } as unknown as Env;
}

const SOURCES = [
  { id: 's1', url: URL_A },
  { id: 's9', url: watchUrl(YT1) },
  { id: 's10', url: watchUrl(YT2) },
];

function seed(videos: unknown[]) {
  const m = goodMaterial();
  (m.parts as Obj[])[0].videos = videos;
  db.prepare(
    "INSERT INTO materials (id, slug, title, kinds_json, work_status, publish_status, brief_md, created_at, updated_at) VALUES ('m1', 'm-1', 't', '[3]', 'review', 'none', 'b', ?, ?)",
  ).run(T0, T0);
  db.prepare(
    `INSERT INTO factory_jobs (id, material_id, kind, model, phase, status, session_id, brief_md, created_at, updated_at)
     VALUES ('j1', 'm1', 'draft', 'claude-sonnet-5-5', 'making', 'done', 'sesn_1', 'b', ?, ?)`,
  ).run(T0, T0);
  const claims = [
    { id: 'c1', source_ids: ['s1'] },
    { id: 'c2', source_ids: ['s9'] },
  ];
  db.prepare(
    `INSERT INTO material_versions (id, material_id, version, job_id, session_id, r2_prefix, content_sha256, material_json, claims_json, adapt_rules_md, checks_json, public_paths_json, status, created_at)
     VALUES ('v1', 'm1', 1, 'j1', 'sesn_1', ?, 'sha', ?, ?, 'a', '{}', '[]', 'review', ?)`,
  ).run(PREFIX, JSON.stringify(m), JSON.stringify({ claims }), T0);
  r2.set(`${PREFIX}sources.json`, JSON.stringify({ sources: SOURCES.map((s) => ({ ...s, is_primary: true })) }));
  r2.set(`${PREFIX}parts/p1/elementary-short.md`, '# 本文\nレッドストーン [c1] [c2]');
}

const setSetting = (key: string, value = '1') => db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)').run(key, value, T0);
const enable = () => setSetting('video_gen_enabled');
const enableFallback = () => setSetting('video_fallback_enabled');
const vvRows = () => rows(db, "SELECT ref_id FROM cost_ledger WHERE ref_id GLOB 'vv:*' ORDER BY ref_id").map((r) => String(r.ref_id));
const addRow = (ref: string, cents = 10) =>
  db.prepare("INSERT INTO cost_ledger (id, day, kind, ref_id, cents, created_at) VALUES (?, ?, 'verify', ?, ?, ?)").run(crypto.randomUUID(), tokyoDay(), ref, cents, T0);
const putRecord = (vid: string, n: number, o: Partial<VideoCallRecord> = {}) =>
  r2.set(
    callKey(vid, n),
    JSON.stringify({ v: 1, video_id: vid, n, model: PRIMARY, model_role: 'primary', outcome: 'retryable', error: 'server', at: T0, ...o }),
  );

type Step = 'ok' | 'hang' | 'empty' | GeminiErrorKind;
const STATUS: Partial<Record<GeminiErrorKind, number>> = { server: 503, rate_limited: 429, auth: 403, not_found: 404, bad_request: 400 };
/** 台本どおりに答える fake の GeminiPort（呼び出しの順に steps を使う。足りなければ最後の step） */
function scripted(steps: Step[], o: { configured?: boolean; text?: (n: number) => string } = {}) {
  const calls: GeminiWatchRequest[] = [];
  const port: GeminiPort = {
    isFake: true,
    configured: o.configured ?? true,
    model: PRIMARY,
    async watch(req) {
      calls.push(req);
      const s = steps[Math.min(calls.length - 1, steps.length - 1)];
      if (s === 'hang') return new Promise<never>(() => {});
      if (s === 'empty') return { text: '  ', httpStatus: 200 };
      if (s === 'ok') return { text: o.text?.(calls.length) ?? `- 1:20 ${req.youtubeId} 呼び出し ${calls.length}`, usage: { total_input_tokens: 1000 }, httpStatus: 200 };
      throw new GeminiError(STATUS[s] !== undefined, STATUS[s], s, false);
    },
  };
  return { port, calls };
}

const V: VersionForVerify = { id: 'v1', material_id: 'm1', r2_prefix: PREFIX, claims_json: '{"claims":[]}' };
const vids = (): VersionVideo[] => versionVideosOf(String(one(db, "SELECT material_json FROM material_versions WHERE id = 'v1'").material_json));
let sleeps: number[];
const fakeSleep = async (ms: number) => {
  sleeps.push(ms);
};
/** 1 回の試行の動画の記録（verify.ts の loadVideoNotes を直接） */
const attempt = (env: Env, g: GeminiPort | undefined, ms = 60_000) => loadVideoNotes(env, g, V, vids(), { deadline: Date.now() + ms, sleep: fakeSleep });

// 検証係（同期・Batch）の stub
type Block = { type: string; text?: string };
type Params = { messages: Array<{ content: Block[] }> };
function reportMsg(videos: unknown[]): Message {
  return {
    type: 'message',
    role: 'assistant',
    content: [
      {
        type: 'tool_use',
        id: 'toolu_1',
        name: 'report_verdicts',
        input: {
          verdicts: [
            { claim_id: 'c1', verdict: 'confirmed', reason: 'r', opened_urls: [URL_A] },
            { claim_id: 'c2', verdict: 'unverified', reason: 'r', opened_urls: [] },
          ],
          overall_note: 'n',
          figures: [],
          analogy_gaps: [],
          videos,
        },
      },
    ],
    stop_reason: 'tool_use',
    usage: { input_tokens: 10, output_tokens: 1 },
  } as unknown as Message;
}
function syncPort(replies: Message[]) {
  const seen: Params[] = [];
  const port = {
    isFake: true,
    listEventsPage: async () => ({ data: [], next: null }),
    createMessage: async (p: unknown) => {
      seen.push(p as Params);
      return replies[Math.min(seen.length - 1, replies.length - 1)];
    },
  } as unknown as FactoryPort;
  return { port, seen };
}
function batchPort(reply: Message) {
  const created: Array<{ id: string; custom_id: string }> = [];
  const s = { status: 'in_progress' as 'in_progress' | 'ended' };
  const port = {
    isFake: true,
    createSession: no,
    createMessage: no,
    listEventsPage: async () => ({ data: [], next: null }),
    async createBatch(params: { requests: Array<{ custom_id: string }> }) {
      const id = `msgbatch_${created.length + 1}`;
      created.push({ id, custom_id: params.requests[0].custom_id });
      return { id, processing_status: 'in_progress', created_at: T0, expires_at: T0 };
    },
    async retrieveBatch(id: string) {
      return { id, processing_status: s.status, created_at: T0, expires_at: T0 };
    },
    async batchResults(id: string): Promise<MessageBatchIndividualResponse[]> {
      const b = created.find((x) => x.id === id);
      return [{ custom_id: b?.custom_id ?? 't0', result: { type: 'succeeded', message: reply } } as unknown as MessageBatchIndividualResponse];
    },
  } as unknown as FactoryPort;
  return { port, created, s };
}
const SYNC = { VERIFY_MODE: 'sync' };
const texts = (p: Params) => p.messages[0].content.filter((b) => b.type === 'text').map((b) => String(b.text));
const saved = (i = 0) =>
  JSON.parse(String(rows(db, "SELECT result_json FROM verifications WHERE material_version_id = 'v1' ORDER BY attempt")[i].result_json)) as { videos: unknown };
const reverifyNow = () => db.prepare("UPDATE material_versions SET verification_status = 'pending', verify_phase = NULL, verification_token = NULL WHERE id = 'v1'").run();

const reviewCtx = (env: Env): RouteCtx => {
  const request = new Request('http://localhost/api/review/v1', { method: 'GET' });
  return { env, request, url: new URL(request.url), email: 'ops@example.invalid', exec: {} as ExecutionContext, port: async () => no() };
};
const reviewNotes = async (env: Env) => ((await (await reviewDetail(reviewCtx(env), 'v1')).json()) as { video_notes: unknown }).video_notes;

beforeEach(() => {
  db = migratedDb();
  r2 = new Map();
  puts = [];
  gets = [];
  failPut = new Set();
  nullPut = new Set();
  reserveTries = 0;
  reserveWins = 0;
  sleeps = [];
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------------------------
describe('§Q-10 13 やり直し（試行の中・試行をまたぐ）', () => {
  it('503 → 20 秒待ち → 2 回目で成功: note になり、行が 2 つ（vv:… と …:r2）、記録が 2 つ。ログは call と model_role（数とラベルだけ）', async () => {
    seed([video()]);
    enable();
    const g = scripted(['server', 'ok'], { text: () => '- 1:20 本文（ログに出ない）' });
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((s: unknown) => void logs.push(String(s)));
    const { port, seen } = syncPort([reportMsg([{ id: 'v1', verdict: 'ok', reason: 'x' }])]);
    expect(await runVerificationStep(makeEnv(SYNC), port, { gemini: g.port, videoSleep: fakeSleep })).toBe('done');
    expect(g.calls).toHaveLength(2);
    expect(sleeps).toEqual([VIDEO_RETRY_WAIT_MS]);
    expect(VIDEO_RETRY_WAIT_MS).toBe(20_000);
    expect(vvRows()).toEqual(['vv:v1:v1', 'vv:v1:v1:r2']);
    expect(callKeys()).toEqual([callKey('v1', 1), callKey('v1', 2)]);
    expect(callRecord('v1', 1)).toMatchObject({ v: 1, video_id: 'v1', n: 1, model: PRIMARY, model_role: 'primary', outcome: 'retryable', error: 'server' });
    expect(callRecord('v1', 1)).not.toHaveProperty('text');
    expect(callRecord('v1', 2)).toMatchObject({ n: 2, outcome: 'ok', error: null, text: '- 1:20 本文（ログに出ない）' });
    expect(r2.has(NOTES_KEY)).toBe(false);
    expect(texts(seen[0])).toContain(`## 動画 v1 ${watchUrl(YT1)} 80〜185 秒${USED}`);
    expect(saved().videos).toEqual([{ id: 'v1', verdict: 'ok', reason: 'x' }]);
    const vlogs = logs.filter((l) => l.includes('"at":"video_notes"')).map((l) => JSON.parse(l) as Obj);
    expect(vlogs).toEqual([
      { at: 'video_notes', version_id: 'v1', video_id: 'v1', call: 1, model_role: 'primary', result: 'error:server' },
      { at: 'video_notes', version_id: 'v1', video_id: 'v1', call: 2, model_role: 'primary', result: 'ok' },
    ]);
    expect(logs.join('\n')).not.toContain('本文');
  });

  it('503 が 2 回 → 次の試行で 3 回目を呼ぶ。3 回目も 503 なら、その後の試行では呼ばない（r3 があれば R2 の状態に関係なく取り置きはゼロ）', async () => {
    seed([video()]);
    enable();
    const env = makeEnv();
    const g = scripted(['server']);
    expect((await attempt(env, g.port)).missing).toEqual(['v1']);
    expect(g.calls).toHaveLength(2);
    expect(vvRows()).toEqual(['vv:v1:v1', 'vv:v1:v1:r2']);
    expect(callRecord('v1', 2).outcome).toBe('retryable');
    await attempt(env, g.port);
    expect(g.calls).toHaveLength(3);
    expect(vvRows()).toEqual(['vv:v1:v1', 'vv:v1:v1:r2', 'vv:v1:v1:r3']);
    expect(callRecord('v1', 3)).toMatchObject({ n: 3, outcome: 'retryable' });
    expect(VIDEO_MAX_CALLS).toBe(3);
    // 試行の中でも上限で止まる（3 回目の後に待たない）
    expect(sleeps).toHaveLength(1);
    reserveTries = 0;
    await attempt(env, g.port);
    // r3 の記録を消しても・ok を偽っても上限は変わらない（取り置きを試みない）
    r2.delete(callKey('v1', 3));
    await attempt(env, g.port);
    putRecord('v1', 3, { outcome: 'retryable' });
    await attempt(env, g.port);
    expect(g.calls).toHaveLength(3);
    expect(reserveTries).toBe(0);
    expect(vvRows()).toHaveLength(3);
  });

  it.each<[Step, string]>([
    ['auth', 'auth'],
    ['no_text', 'no_text'],
    ['empty', 'no_text'],
    ['bad_request', 'bad_request'],
    ['not_found', 'not_found'],
  ])('%s は 1 回で final（待たない・次の試行でも呼ばない）', async (step, error) => {
    seed([video()]);
    enable();
    const env = makeEnv();
    const g = scripted([step, 'ok']);
    await attempt(env, g.port);
    expect(g.calls).toHaveLength(1);
    expect(sleeps).toEqual([]);
    expect(callRecord('v1', 1)).toMatchObject({ outcome: 'final', error });
    await attempt(env, g.port);
    expect(g.calls).toHaveLength(1);
    expect(vvRows()).toEqual(['vv:v1:v1']);
  });

  it.each<GeminiErrorKind>(['rate_limited', 'timeout', 'connection'])('%s は retryable（試行の中で 2 回目を呼ぶ）', async (kind) => {
    seed([video()]);
    enable();
    const g = scripted([kind, 'ok']);
    const f = await attempt(makeEnv(), g.port);
    expect(g.calls).toHaveLength(2);
    expect(callRecord('v1', 1)).toMatchObject({ outcome: 'retryable', error: kind });
    expect(f.notes.map((n) => n.video_id)).toEqual(['v1']);
  });

  it('外側の締め切り（beforeDeadline）で待ちきれなかった → retryable。残りが無いので試行の中ではやり直さず、後の試行で n=2 を呼べる', async () => {
    seed([video()]);
    enable();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const env = makeEnv();
    const g = scripted(['hang', 'ok']);
    const p = attempt(env, g.port, 40_000);
    await vi.advanceTimersByTimeAsync(41_000);
    expect((await p).missing).toEqual(['v1']);
    expect(g.calls).toHaveLength(1);
    expect(callRecord('v1', 1)).toMatchObject({ outcome: 'retryable', error: 'deadline' });
    vi.useRealTimers();
    const f = await attempt(env, g.port);
    expect(g.calls).toHaveLength(2);
    expect(vvRows()).toEqual(['vv:v1:v1', 'vv:v1:v1:r2']);
    expect(f.notes).toHaveLength(1);
  });

  it('締め切りが足りない（残り < 20 秒 + VIDEO_CALL_MIN_MS）時は待たずに 1 回で終わり、後の試行で呼べる', async () => {
    seed([video()]);
    enable();
    const env = makeEnv();
    const g = scripted(['server', 'ok']);
    await attempt(env, g.port, VIDEO_RETRY_WAIT_MS + VIDEO_CALL_MIN_MS - 5_000);
    expect(g.calls).toHaveLength(1);
    expect(sleeps).toEqual([]);
    expect(vvRows()).toEqual(['vv:v1:v1']);
    const f = await attempt(env, g.port);
    expect(g.calls).toHaveLength(2);
    expect(vvRows()).toEqual(['vv:v1:v1', 'vv:v1:v1:r2']);
    expect(f.notes.map((n) => n.text)).toEqual([`- 1:20 ${YT1} 呼び出し 2`]);
  });

  it('同じ n を 2 つの試行が同時に取りに行くと、片方だけが呼ぶ。負けた側は記録を書かず、勝った側の ok が残る', async () => {
    seed([video()]);
    enable();
    const env = makeEnv();
    const g = scripted(['ok']);
    const [a, b] = await Promise.all([attempt(env, g.port), attempt(env, g.port)]);
    expect(reserveTries).toBe(2); // 両方が n = 1 を取りに行った
    expect(reserveWins).toBe(1);
    expect(g.calls).toHaveLength(1);
    expect(vvRows()).toEqual(['vv:v1:v1']);
    expect(puts.filter((k) => k.includes('/video-calls/'))).toEqual([callKey('v1', 1)]);
    expect([a.notes.length, b.notes.length].sort()).toEqual([0, 1]);
    const next = await attempt(env, g.port);
    expect(g.calls).toHaveLength(1);
    expect(next.notes.map((n) => n.text)).toEqual([`- 1:20 ${YT1} 呼び出し 1`]);
  });
});

// ---------------------------------------------------------------------------------------------
describe('§Q-10 13 記録が無い行は時間で格上げしない', () => {
  it('n=1 が auth で put に失敗 → 何分たっても n=2 を取り置かない。欠損を読んだ後に retryable の記録が届く → 次の試行で呼べる', async () => {
    seed([video()]);
    enable();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-05T03:00:00.000Z'));
    const env = makeEnv();
    failPut.add(callKey('v1', 1));
    const g = scripted(['auth', 'ok']);
    await attempt(env, g.port);
    expect(g.calls).toHaveLength(1);
    expect(callKeys()).toEqual([]);
    failPut.clear();
    reserveTries = 0;
    for (const h of [1, 6, 48]) {
      vi.setSystemTime(new Date(Date.parse('2026-11-05T03:00:00.000Z') + h * 3_600_000));
      expect((await attempt(env, g.port)).missing).toEqual(['v1']);
    }
    expect(reserveTries).toBe(0);
    expect(g.calls).toHaveLength(1);
    // 後から retryable の記録が届く（例: 別の経路で遅れて書けた）→ 次の試行で n=2
    putRecord('v1', 1, { outcome: 'retryable', error: 'server' });
    const f = await attempt(env, g.port);
    expect(g.calls).toHaveLength(2);
    expect(vvRows()).toEqual(['vv:v1:v1', 'vv:v1:v1:r2']);
    expect(f.notes).toHaveLength(1);
  });

  it('記録の無い行の後に final の記録が届く → 以後は呼ばない', async () => {
    seed([video()]);
    enable();
    const env = makeEnv();
    addRow('vv:v1:v1');
    const g = scripted(['ok']);
    await attempt(env, g.port);
    putRecord('v1', 1, { outcome: 'final', error: 'auth' });
    await attempt(env, g.port);
    expect(g.calls).toHaveLength(0);
    expect(reserveTries).toBe(0);
  });

  it('過去の retryable に引きずられない: n=1 が retryable、n=2 は行だけ（記録なし）→ 何分たっても n=3 を取り置かない', async () => {
    seed([video()]);
    enable();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-05T03:00:00.000Z'));
    const env = makeEnv();
    addRow('vv:v1:v1');
    addRow('vv:v1:v1:r2');
    putRecord('v1', 1, { outcome: 'retryable' });
    const g = scripted(['ok']);
    for (const h of [0, 2, 30]) {
      vi.setSystemTime(new Date(Date.parse('2026-11-05T03:00:00.000Z') + h * 3_600_000));
      await attempt(env, g.port);
    }
    expect(g.calls).toHaveLength(0);
    expect(reserveTries).toBe(0);
    expect(vvRows()).toEqual(['vv:v1:v1', 'vv:v1:v1:r2']);
  });

  it('videoCallDecision（純関数）: 行と記録の組み合わせ', () => {
    const rec = (n: number, outcome: VideoCallRecord['outcome']): [number, VideoCallRecord] => [
      n,
      { v: 1, video_id: 'v1', n, model: PRIMARY, model_role: 'primary', outcome, error: null, at: T0, ...(outcome === 'ok' ? { text: 't' } : {}) },
    ];
    expect(videoCallDecision([], new Map())).toEqual({ kind: 'call', n: 1 });
    expect(videoCallDecision([1], new Map())).toEqual({ kind: 'none' });
    expect(videoCallDecision([1], new Map([rec(1, 'retryable')]))).toEqual({ kind: 'call', n: 2 });
    expect(videoCallDecision([1, 2], new Map([rec(1, 'retryable')]))).toEqual({ kind: 'none' });
    expect(videoCallDecision([1, 2], new Map([rec(1, 'retryable'), rec(2, 'retryable')]))).toEqual({ kind: 'call', n: 3 });
    expect(videoCallDecision([1, 2, 3], new Map([rec(1, 'retryable'), rec(2, 'retryable'), rec(3, 'retryable')]))).toEqual({ kind: 'none' });
    expect(videoCallDecision([1], new Map([rec(1, 'final')]))).toEqual({ kind: 'none' });
    // final の記録があれば、いちばん大きい n の記録が retryable でも呼ばない（§Q-10 4 の 2 つ目）
    expect(videoCallDecision([1, 2], new Map([rec(1, 'final'), rec(2, 'retryable')]))).toEqual({ kind: 'none' });
    expect(videoCallDecision([1, 2], new Map([rec(1, 'ok'), rec(2, 'ok')]))).toMatchObject({ kind: 'note', record: { n: 1 } });
  });
});

// ---------------------------------------------------------------------------------------------
describe('§Q-10 13 記録の読み方（検証係の入力と review API は同じ関数）', () => {
  it('複数の ok（n=1 と n=2）がある時は n=1 だけを note にし、入力にも 1 回だけ出す', async () => {
    seed([video()]);
    enable();
    addRow('vv:v1:v1');
    addRow('vv:v1:v1:r2');
    putRecord('v1', 1, { outcome: 'ok', error: null, text: '- 記録 A' });
    putRecord('v1', 2, { outcome: 'ok', error: null, text: '- 記録 B', model: FALLBACK, model_role: 'fallback' });
    const env = makeEnv(SYNC);
    const g = scripted(['ok']);
    const { port, seen } = syncPort([reportMsg([{ id: 'v1', verdict: 'ok', reason: 'x' }])]);
    expect(await runVerificationStep(env, port, { gemini: g.port, videoSleep: fakeSleep })).toBe('done');
    expect(g.calls).toHaveLength(0);
    const t = texts(seen[0]);
    expect(t.filter((x) => x.startsWith('## 動画 v1 '))).toHaveLength(1);
    expect(t).toContain('- 記録 A');
    expect(t.join('\n')).not.toContain('- 記録 B');
    expect(await reviewNotes(env)).toEqual({ v: 1, notes: [{ video_id: 'v1', youtube_id: YT1, start_sec: 80, end_sec: 185, model: PRIMARY, text: '- 記録 A' }], missing: [] });
  });

  it('遅れて届く ok: 欠損として扱った後に ok の記録が届く → 次の試行では呼ばず、検証係の入力と review API の両方に同じ note が出る', async () => {
    seed([video()]);
    enable();
    const env = makeEnv(SYNC);
    nullPut.add(callKey('v1', 1));
    const g = scripted(['ok'], { text: () => '- 1:20 遅れて届いた記録' });
    const { port, seen } = syncPort([reportMsg([]), reportMsg([{ id: 'v1', verdict: 'ok', reason: 'x' }])]);
    expect(await runVerificationStep(env, port, { gemini: g.port, videoSleep: fakeSleep })).toBe('done');
    expect(texts(seen[0])).toContain(`## 動画 v1 ${watchUrl(YT1)} 80〜185 秒${NONE}`);
    expect(saved(0).videos).toEqual([{ id: 'v1', verdict: 'not_seen', reason: '' }]);
    expect(await reviewNotes(env)).toBeNull();
    // 記録が届く（呼んだ側の put が実は保存されていた等）
    putRecord('v1', 1, { outcome: 'ok', error: null, text: '- 1:20 遅れて届いた記録', usage: { total_input_tokens: 1000 } });
    reverifyNow();
    expect(await runVerificationStep(env, port, { gemini: g.port, videoSleep: fakeSleep })).toBe('done');
    expect(g.calls).toHaveLength(1);
    const t = texts(seen[1]);
    expect(t).toContain(`## 動画 v1 ${watchUrl(YT1)} 80〜185 秒${USED}`);
    expect(t).toContain('- 1:20 遅れて届いた記録');
    const note = { video_id: 'v1', youtube_id: YT1, start_sec: 80, end_sec: 185, model: PRIMARY, text: '- 1:20 遅れて届いた記録', usage: { total_input_tokens: 1000 } };
    expect(await reviewNotes(env)).toEqual({ v: 1, notes: [note], missing: [] });
    expect((await attempt(env, g.port)).notes).toEqual([note]);
  });

  it('readVersionVideoNotes の形: 記録が 1 つも無い版は null（確認画面は「まだありません」）。記録がある版は v:1 と動画ごとの id・区間などを含む完全な形', async () => {
    seed([video(), V2()]);
    const env = makeEnv();
    expect((await readVersionVideoNotes(env.R2, PREFIX, vids())).file).toBeNull();
    expect(await reviewNotes(env)).toBeNull();
    putRecord('v2', 1, { outcome: 'ok', error: null, text: '- 0:10 回路', usage: { total_input_tokens: 5, total_output_tokens: 2 } });
    putRecord('v1', 1, { outcome: 'final', error: 'auth' });
    const want = {
      v: 1,
      notes: [{ video_id: 'v2', youtube_id: YT2, start_sec: 0, end_sec: 60, model: PRIMARY, text: '- 0:10 回路', usage: { total_input_tokens: 5, total_output_tokens: 2 } }],
      missing: ['v1'],
    };
    expect((await readVersionVideoNotes(env.R2, PREFIX, vids())).file).toEqual(want);
    expect(await reviewNotes(env)).toEqual(want);
  });

  it('呼び出しの記録だけがある版で、review API の video_notes が note を返し、確認画面に出る。v1 の版も従来どおり', async () => {
    seed([video(), V2()]);
    const env = makeEnv();
    putRecord('v1', 2, { outcome: 'ok', error: null, text: '- 1:20 <b>信号</b>', model: FALLBACK, model_role: 'fallback' });
    const notes = await reviewNotes(env);
    expect(notes).toEqual({ v: 1, notes: [{ video_id: 'v1', youtube_id: YT1, start_sec: 80, end_sec: 185, model: FALLBACK, text: '- 1:20 <b>信号</b>' }], missing: ['v2'] });
    const code = readFileSync(new URL('../public/admin/admin.js', import.meta.url), 'utf8');
    const win: Record<string, unknown> = { __FACTORY_ADMIN_NO_BOOT__: true };
    vm.runInNewContext(code, { window: win, console }, { timeout: 2000 });
    const R = win.FactoryAdminReview as { reviewHtml(d: unknown, st: unknown, ctx: unknown): string; newReviewState(): unknown };
    const m = goodMaterial();
    (m.parts as Obj[])[0].videos = [video(), V2()];
    const detail = (vn: unknown) => ({
      version: { id: 'v1', material_id: 'm1', version: 1, status: 'review', verification_status: 'done', material: m, checks: {}, public_paths: [] },
      material: { id: 'm1', title: 't' },
      job: null,
      sources: [],
      claims: [],
      verification: null,
      verification_id: null,
      verification_history: [],
      video_notes: vn,
      triage: { auto: {}, groups: [], ok_counts: { claims: 0, sources: 0 }, needs_review: 1, action: 'none', reasons: [] },
    });
    const h = R.reviewHtml(detail(notes), R.newReviewState(), {});
    expect(h).toContain('<div class="rv-video-note" data-video-note="1">- 1:20 &lt;b&gt;信号&lt;/b&gt;</div>');
    expect(h).toContain(FALLBACK);
    // v1 の版（video-notes.json）は従来どおりそのファイル
    const legacy = { v: 1, notes: [{ video_id: 'v2', youtube_id: YT2, start_sec: 0, end_sec: 60, model: PRIMARY, text: '- 旧' }], missing: ['v1'] };
    r2.set(NOTES_KEY, JSON.stringify(legacy));
    expect(await reviewNotes(env)).toEqual(legacy);
    expect(R.reviewHtml(detail(legacy), R.newReviewState(), {})).toContain('data-video-note="1">- 旧</div>');
  });

  it('v1 の video-notes.json がある版は呼ばない（呼び出しの記録・D1 の行も見ない。既存の missing は救わない）', async () => {
    seed([video(), V2()]);
    enable();
    r2.set(NOTES_KEY, JSON.stringify({ v: 1, notes: [], missing: ['v1', 'v2'] }));
    const g = scripted(['ok']);
    const f = await attempt(makeEnv(), g.port);
    expect(f).toEqual({ v: 1, notes: [], missing: ['v1', 'v2'] });
    expect(g.calls).toHaveLength(0);
    expect(reserveTries).toBe(0);
    expect(gets.filter((k) => k.includes('/video-calls/'))).toEqual([]);
  });

  it('条件つき put が null を返す時と例外の時は、その試行では not_seen（呼び出しは記帳済み・試行の中でやり直さない）', async () => {
    seed([video(), V2()]);
    enable();
    nullPut.add(callKey('v1', 1));
    failPut.add(callKey('v2', 1));
    const g = scripted(['ok']);
    const f = await attempt(makeEnv(), g.port);
    expect(f).toEqual({ v: 1, notes: [], missing: ['v1', 'v2'] });
    expect(g.calls).toHaveLength(2);
    expect(vvRows()).toEqual(['vv:v1:v1', 'vv:v1:v2']);
    expect(callKeys()).toEqual([]);
    expect(sleeps).toEqual([]);
  });

  it('既にある記録（同じ key）は上書きしない（onlyIf etagDoesNotMatch "*" で null → not_seen）', async () => {
    seed([video()]);
    enable();
    // 形の違う記録（記録が無い扱い）が置いてある key に、n=1 の取り置きに勝った側が書こうとする
    r2.set(callKey('v1', 1), 'not json');
    const g = scripted(['ok']);
    const f = await attempt(makeEnv(), g.port);
    expect(g.calls).toHaveLength(1);
    expect(f.missing).toEqual(['v1']);
    expect(r2.get(callKey('v1', 1))).toBe('not json');
  });
});

// ---------------------------------------------------------------------------------------------
describe('§Q-10 13 上限・無効・回収', () => {
  it('月の上限で n = 1 の取り置きが入らない時は呼ばず（行は増えない）、上限が空いた後の試行で呼べる', async () => {
    seed([video()]);
    enable();
    const env = makeEnv();
    db.prepare("INSERT INTO cost_ledger (id, day, kind, ref_id, cents, created_at) VALUES ('cap', ?, 'verify', 'vv:other:v1', 995, ?)").run(tokyoDay(), T0);
    const g = scripted(['ok']);
    await attempt(env, g.port);
    expect(g.calls).toHaveLength(0);
    expect(vvRows()).toEqual(['vv:other:v1']);
    db.prepare("DELETE FROM cost_ledger WHERE id = 'cap'").run();
    expect((await attempt(env, g.port)).notes).toHaveLength(1);
    expect(vvRows()).toEqual(['vv:v1:v1']);
  });

  it('月の上限で n = 2 の取り置きが入らない時は呼ばず（行は増えない）、上限が空いた後の試行で n = 2 を呼べる', async () => {
    seed([video()]);
    enable();
    const env = makeEnv();
    // 今月 985¢ + n=1 の 10¢ = 995¢。n=2 は 1005¢ > 1000¢
    db.prepare("INSERT INTO cost_ledger (id, day, kind, ref_id, cents, created_at) VALUES ('cap', ?, 'verify', 'vv:other:v1', 985, ?)").run(tokyoDay(), T0);
    const g = scripted(['server', 'ok']);
    await attempt(env, g.port);
    expect(g.calls).toHaveLength(1);
    expect(vvRows()).toEqual(['vv:other:v1', 'vv:v1:v1']);
    db.prepare("DELETE FROM cost_ledger WHERE id = 'cap'").run();
    expect((await attempt(env, g.port)).notes).toHaveLength(1);
    expect(g.calls).toHaveLength(2);
    expect(vvRows()).toEqual(['vv:v1:v1', 'vv:v1:v1:r2']);
  });

  it('日の上限で n = 1 の取り置きが入らない時は呼ばず、上限が空いた後の試行で呼べる', async () => {
    seed([video()]);
    enable();
    const g = scripted(['ok']);
    await attempt(makeEnv({ DAILY_CAP_CENTS: '5' }), g.port);
    expect(g.calls).toHaveLength(0);
    expect(vvRows()).toEqual([]);
    await attempt(makeEnv(), g.port);
    expect(g.calls).toHaveLength(1);
  });

  it('動画の確認が無効の時は呼び出しゼロ（行も記録も無し）。鍵が無い時も同じ', async () => {
    seed([video()]);
    const g = scripted(['ok']);
    await attempt(makeEnv(), g.port);
    enable();
    const nokey = scripted(['ok'], { configured: false });
    await attempt(makeEnv(), nokey.port);
    expect(g.calls).toHaveLength(0);
    expect(nokey.calls).toHaveLength(0);
    expect(reserveTries).toBe(0);
    expect(vvRows()).toEqual([]);
    expect(callKeys()).toEqual([]);
  });

  it('回収（collect）は Gemini を呼ばず、R2 の記録も読まない。提出後に記録が増えても、回収は plan.json のまま', async () => {
    seed([video(), V2()]);
    enable();
    const g = scripted(['ok', 'auth']);
    const { port, s } = batchPort(reportMsg([{ id: 'v1', verdict: 'ok', reason: 'x' }]));
    const env = makeEnv();
    expect(await runVerificationStep(env, port, { deadline: Date.now() + 120_000, gemini: g.port, videoSleep: fakeSleep })).toContain('submit=submitted');
    const plan = JSON.parse(String(r2.get(verifyPlanKey('v1', String(one(db, "SELECT verification_token FROM material_versions WHERE id = 'v1'").verification_token))))) as Obj;
    expect(plan.videos).toEqual({ shown: ['v1'], not_seen: ['v2'] });
    expect(g.calls).toHaveLength(2);
    // 提出の後に v2 の ok の記録が増える
    putRecord('v2', 2, { outcome: 'ok', error: null, text: '- 後から' });
    gets = [];
    s.status = 'ended';
    expect(await runVerificationStep(env, port, { deadline: Date.now() + 120_000, gemini: g.port, videoSleep: fakeSleep })).toContain('collect=done');
    expect(g.calls).toHaveLength(2);
    expect(gets.filter((k) => k.includes('/video-calls/') || k.endsWith('video-notes.json'))).toEqual([]);
    expect(saved().videos).toEqual([
      { id: 'v1', verdict: 'ok', reason: 'x' },
      { id: 'v2', verdict: 'not_seen', reason: '' },
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
describe('§Q-10 7・10 予備のモデル', () => {
  const FB = { GEMINI_VIDEO_FALLBACK_MODEL: FALLBACK };

  it('無効なら n ≥ 2 も主のモデル（予備の名前は送らない）。有効なら n ≥ 2 は予備の名前で呼び、note の model もそれになる', async () => {
    seed([video()]);
    enable();
    const off = scripted(['server', 'ok']);
    const f0 = await attempt(makeEnv(FB), off.port);
    expect(off.calls.map((c) => c.model)).toEqual([undefined, undefined]);
    expect(f0.notes[0].model).toBe(PRIMARY);
    expect(callRecord('v1', 2)).toMatchObject({ model: PRIMARY, model_role: 'primary' });

    db = migratedDb();
    r2 = new Map();
    seed([video()]);
    enable();
    enableFallback();
    const on = scripted(['server', 'ok']);
    const f1 = await attempt(makeEnv(FB), on.port);
    expect(on.calls.map((c) => c.model)).toEqual([undefined, FALLBACK]);
    expect(f1.notes[0].model).toBe(FALLBACK);
    expect(callRecord('v1', 1)).toMatchObject({ model: PRIMARY, model_role: 'primary' });
    expect(callRecord('v1', 2)).toMatchObject({ model: FALLBACK, model_role: 'fallback' });
    expect(await reviewNotes(makeEnv(FB))).toMatchObject({ notes: [{ model: FALLBACK }] });

    // settings が '1' でも予備のモデルが未設定なら主のモデル
    db = migratedDb();
    r2 = new Map();
    seed([video()]);
    enable();
    enableFallback();
    const unset = scripted(['server', 'ok']);
    expect((await attempt(makeEnv(), unset.port)).notes[0].model).toBe(PRIMARY);
    expect(unset.calls.map((c) => c.model)).toEqual([undefined, undefined]);
  });

  it('予備のモデルが有効な時、n ≥ 2 の送信 body の model が予備のモデル（本物の port。後の試行の n=2 も同じ）', async () => {
    seed([video()]);
    enable();
    enableFallback();
    const bodies: Obj[] = [];
    const replies = [
      () => new Response(JSON.stringify({ error: { code: 503, status: 'UNAVAILABLE', message: 'high demand' } }), { status: 503 }),
      () => new Response(JSON.stringify({ status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: '- 1:20 信号' }] }] }), { status: 200 }),
    ];
    const f = (async (_u: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)) as Obj);
      return replies[Math.min(bodies.length - 1, replies.length - 1)]();
    }) as unknown as typeof fetch;
    const env = makeEnv({ ...FB, GEMINI_API_KEY: 'test-placeholder-key' });
    // 試行の中: n=1 は主、n=2 は予備
    const out = await attempt(env, geminiPort(env, { fetchImpl: f }));
    expect(bodies.map((b) => b.model)).toEqual([PRIMARY, FALLBACK]);
    expect(out.notes[0].model).toBe(FALLBACK);
    // 後の試行の n=2: 締め切りが足りず試行の中でやり直さなかった版
    db = migratedDb();
    r2 = new Map();
    bodies.length = 0;
    seed([video()]);
    enable();
    enableFallback();
    const env2 = makeEnv({ ...FB, GEMINI_API_KEY: 'test-placeholder-key' });
    await attempt(env2, geminiPort(env2, { fetchImpl: f }), VIDEO_CALL_MIN_MS + 1_000);
    expect(bodies.map((b) => b.model)).toEqual([PRIMARY]);
    await attempt(env2, geminiPort(env2, { fetchImpl: f }));
    expect(bodies.map((b) => b.model)).toEqual([PRIMARY, FALLBACK]);
    // 形の違うモデル名は送らない（bad_input）
    await expect(geminiPort(env2, { fetchImpl: f }).watch({ youtubeId: YT1, startSec: 1, endSec: 2, prompt: 'p', model: 'x y/../z' }, { deadline: Date.now() + 5_000 })).rejects.toMatchObject({
      kind: 'bad_input',
    });
    expect(bodies).toHaveLength(2);
  });

  it('probe: 入力 model の primary/fallback × clip/noclip の 4 組で取り置きの ref が別。fallback は予備のモデルで呼ぶ。予備が未設定なら 409', async () => {
    const reqs: GeminiWatchRequest[] = [];
    const g: GeminiPort = {
      isFake: true,
      configured: true,
      model: PRIMARY,
      async watch(req) {
        reqs.push(req);
        return { text: 't', httpStatus: 200 };
      },
    };
    const call = async (env: Env, body: Obj) => {
      const request = new Request('http://localhost/api/probe/video', { method: 'POST', body: JSON.stringify(body) });
      const res = await probeVideo({ env, request, url: new URL(request.url), email: 'x', exec: {} as ExecutionContext, port: async () => no() }, g);
      return { status: res.status, body: (await res.json()) as Obj };
    };
    const env = makeEnv(FB);
    const B = { youtube_id: YT1, start_sec: 80, end_sec: 185 };
    for (const body of [B, { ...B, clip: false }, { ...B, model: 'fallback' }, { ...B, model: 'fallback', clip: false }, { ...B, model: 'primary' }]) {
      const r = await call(env, body);
      // 応答の形は Q-9.12 のまま（model の入力を足すだけ）
      if (r.status === 200) expect(Object.keys(r.body).sort()).toEqual(['api_error', 'clip', 'clip_accepted', 'error_code', 'status', 'text_head', 'usage_present']);
    }
    expect(vvRows()).toEqual([`vv:probe:${YT1}:80:185`, `vv:probe:${YT1}:80:185:fb`, `vv:probe:${YT1}:80:185:noclip`, `vv:probe:${YT1}:80:185:noclip:fb`]);
    expect(reqs.map((r) => [r.model ?? 'primary', r.clip])).toEqual([
      ['primary', true],
      ['primary', false],
      [FALLBACK, true],
      [FALLBACK, false],
    ]);
    // 同じ組の再 POST は同じ ref なので 409（上の 5 つ目の model: 'primary' も B と同じ ref で 409 だった）
    expect(await call(env, { ...B, model: 'fallback' })).toEqual({ status: 409, body: { error: 'already_probed' } });
    expect(await call(makeEnv(), { ...B, start_sec: 1, model: 'fallback' })).toEqual({ status: 409, body: { error: 'fallback_not_configured' } });
    expect(await call(env, { ...B, start_sec: 1, model: 'other' })).toEqual({ status: 400, body: { error: 'invalid_input' } });
    expect(vvRows()).toHaveLength(4);
  });

  it('enable {"fallback": true}: 予備のモデルが未設定なら 409（立てない）。設定済みなら settings video_fallback_enabled = 1。status は有効か・名前だけ', async () => {
    const call = async (env: Env, body: unknown) => {
      const request = new Request('http://localhost/api/videos/enable', { method: 'POST', body: JSON.stringify(body) });
      const res = await enableVideos({ env, request, url: new URL(request.url), email: 'x', exec: {} as ExecutionContext, port: async () => no() }, scripted(['ok']).port);
      return { status: res.status, body: (await res.json()) as Obj };
    };
    const fbSetting = () => rows(db, "SELECT value FROM settings WHERE key = 'video_fallback_enabled'");
    expect(await call(makeEnv(), { fallback: true })).toEqual({ status: 409, body: { error: 'fallback_not_configured' } });
    expect(await call(makeEnv({ GEMINI_VIDEO_FALLBACK_MODEL: '  ' }), { fallback: true })).toEqual({ status: 409, body: { error: 'fallback_not_configured' } });
    expect(fbSetting()).toHaveLength(0);
    expect(rows(db, "SELECT value FROM settings WHERE key = 'video_gen_enabled'")).toHaveLength(0);
    expect((await videoStatusSummary(makeEnv(FB), { configured: true })).fallback_enabled).toBe(false);
    expect(await call(makeEnv(FB), { fallback: true })).toEqual({ status: 200, body: { fallback_enabled: true } });
    expect(fbSetting()).toEqual([{ value: '1' }]);
    // 予備の有効化は動画の確認そのものは立てない（従来の enable は別）
    expect(rows(db, "SELECT value FROM settings WHERE key = 'video_gen_enabled'")).toHaveLength(0);
    expect(await videoStatusSummary(makeEnv(FB), { configured: true })).toMatchObject({ fallback_enabled: true, fallback_model: FALLBACK });
    expect(await call(makeEnv(FB), {})).toEqual({ status: 200, body: { enabled: true } });
  });

  it('env と wrangler.jsonc: GEMINI_VIDEO_FALLBACK_MODEL は gemini-3.8-flash。env に無ければ予備なし（空）', () => {
    expect(cfg({} as Env).videoFallbackModel).toBe('');
    expect(cfg({ GEMINI_VIDEO_FALLBACK_MODEL: ' gemini-3.8-flash ' } as Env).videoFallbackModel).toBe(FALLBACK);
    const w = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
    expect(w).toContain('"GEMINI_VIDEO_FALLBACK_MODEL": "gemini-3.8-flash"');
  });
});
