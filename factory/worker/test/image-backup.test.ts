// OpenAI の予備の鍵 OPENAI_API_KEY_BACKUP（契約 §O-13）の受け入れ 8。
// node:sqlite の実 DB（migrations）+ R2 の Map + 本物の openAiPort に fetchImpl の台本を渡す。鍵はテスト用の値（本物の鍵ではない）。
// 変更前のコードでも読めるよう、src から新しい名前は import しない（settings の key は文字列で書く）。
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FactoryPort, FileMeta, Page } from '../src/anthropic';
import type { Env } from '../src/env';
import type { RouteCtx } from '../src/http';
import { bytesToBase64, createFakeImagePort, grayPng } from '../src/fake/openai';
import { runImage } from '../src/images';
import { OpenAiError, openAiPort, type ImageGenParams, type ImagePort } from '../src/openai';
import { getImagesStatus } from '../src/routes/images';
import { getStatus } from '../src/routes/status';
import { d1, migratedDb, one, rows } from './d1-shim';

const T = '2026-11-06T00:00:00.000Z';
const PRIMARY = 'sk-test-primary-not-a-key-7f3a';
const BACKUP = 'sk-test-backup-not-a-key-c91e';
const BACKUP_KEY_SETTING = 'openai_backup_last_used_at';
const no = () => {
  throw new Error('not used in this test');
};

// ---- 環境 ----
let db: DatabaseSync;
let r2: Map<string, Uint8Array>;
let logs: string[];

function makeEnv(vars: Record<string, string | undefined> = {}): Env {
  return {
    DB: d1(db),
    R2: {
      async put(k: string, v: Uint8Array) {
        r2.set(k, new Uint8Array(v));
      },
      async get(k: string) {
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
    IMAGE_GEN: { async send() {} },
    DAILY_CAP_CENTS: '100000',
    VERIFY_TURN_RESERVE_CENTS: '150',
    OPENAI_API_KEY: PRIMARY,
    OPENAI_API_KEY_BACKUP: BACKUP,
    ...vars,
  } as unknown as Env;
}

/** 締め切りの signal を外から abort できるようにする（timeout の分類 = signal.aborted を、締め切りの前に起こす） */
let controllers: Map<AbortSignal, AbortController>;

beforeEach(() => {
  db = migratedDb();
  r2 = new Map();
  logs = [];
  controllers = new Map();
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
    logs.push(a.map(String).join(' '));
  });
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
    const c = new AbortController();
    controllers.set(c.signal, c);
    return c.signal;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

function seedJob(id = 'j1') {
  db.prepare(
    "INSERT OR IGNORE INTO materials (id, slug, title, kinds_json, work_status, publish_status, brief_md, created_at, updated_at) VALUES (?, ?, 't', '[3]', 'making', 'none', 'b', ?, ?)",
  ).run(`m_${id}`, `m-${id}`, T, T);
  db.prepare(
    `INSERT INTO factory_jobs (id, material_id, kind, model, phase, status, session_id, brief_md, deny_count, error, created_at, updated_at)
     VALUES (?, ?, 'draft', 'claude-sonnet-5-5', 'making', 'running', ?, 'b', 0, NULL, ?, ?)`,
  ).run(id, `m_${id}`, `sesn_${id}`, T, T);
}
function insertQueued(tu = 'tu_g', job = 'j1'): string {
  const id = `img_${crypto.randomUUID().replace(/-/g, '')}`;
  db.prepare(
    `INSERT INTO image_requests (id, custom_tool_use_id, job_id, session_id, model, size, quality, format, background, u_cents, input_json, state,
       enqueue_count, enqueued_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'gpt-image-2.5-flare', '1024x1024', 'high', 'png', 'opaque', 10, ?, 'queued', 1, ?, ?, ?)`,
  ).run(id, tu, job, `sesn_${job}`, JSON.stringify({ prompt: 'a red cube', alt: '赤い立方体', accuracy: 'standard' }), T, T, T);
  return id;
}

/** reconcile 用の stub port（events は空。runImage の 5 の reconcile が何もしないで返る） */
function stubPort(): FactoryPort {
  return {
    isFake: false,
    createSession: no,
    async retrieveSession(id: string) {
      return { id, status: 'idle', listCostCents: null, metadata: {}, created_at: T };
    },
    updateSessionBudget: no,
    listSessionsPage: no,
    async listEventsPage(): Promise<Page<unknown>> {
      return { data: [], next: null };
    },
    async sendEvents() {},
    async archiveSession() {},
    async listFilesPage(): Promise<Page<FileMeta>> {
      return { data: [], next: null };
    },
    downloadFile: no,
    createMessage: no,
    createBatch: no,
    retrieveBatch: no,
    batchResults: no,
    listBatchesPage: no,
    xaiResponses: no,
  } as unknown as FactoryPort;
}

// ---- fetchImpl の台本 ----
type Step = (init: RequestInit) => Promise<Response> | Response;
const jsonRes = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const USAGE = { input_tokens: 43, input_tokens_details: { text_tokens: 43, image_tokens: 0 }, output_tokens: 1756, output_tokens_details: { image_tokens: 1756, text_tokens: 0 } };
const S: Record<string, Step> = {
  ok: () => jsonRes(200, { data: [{ b64_json: bytesToBase64(grayPng(1, 1)) }], usage: USAGE }),
  quota: () => jsonRes(429, { error: { code: 'insufficient_quota' } }),
  auth: () => jsonRes(401, { error: { code: 'invalid_api_key' } }),
  rate_limited: () => jsonRes(429, { error: { code: 'rate_limit_exceeded' } }),
  server: () => jsonRes(500, { error: { code: 'server_error' } }),
  moderation: () => jsonRes(400, { error: { code: 'moderation_blocked' } }),
  bad_request: () => jsonRes(400, { error: { code: 'invalid_value' } }),
  bad_response: () => jsonRes(200, { data: [] }),
  connection: () => {
    throw new TypeError('network');
  },
  timeout: (init) => {
    // 締め切りが来た（signal が abort された）時の fetch の失敗
    controllers.get(init.signal as AbortSignal)!.abort();
    throw new DOMException('aborted', 'AbortError');
  },
};

/** 呼ばれた順に steps を返す fetchImpl。authorization だけを記録する（本文・prompt は記録しない） */
function script(...steps: Step[]) {
  const auths: string[] = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    auths.push(String((init.headers as Record<string, string>).authorization));
    const step = steps[auths.length - 1];
    if (!step) throw new Error('unexpected fetch');
    return step(init);
  }) as unknown as typeof fetch;
  return { fetchImpl, auths };
}

const P: ImageGenParams = { model: 'gpt-image-2.5-flare', prompt: 'a red cube', size: '1024x1024', quality: 'high', output_format: 'png', background: 'opaque', n: 1 };

/** 本物の port の戻り値の key を見るための包み（runImage にはそのまま渡す） */
function recording(inner: ImagePort): ImagePort & { keys: Array<string | undefined> } {
  const p = {
    isFake: inner.isFake,
    keys: [] as Array<string | undefined>,
    async generate(params: ImageGenParams, o: { deadline: number }) {
      try {
        const r = await inner.generate(params, o);
        p.keys.push((r as { key?: string }).key);
        return r;
      } catch (e) {
        p.keys.push(e instanceof OpenAiError ? `error:${(e as { key?: string }).key ?? 'primary'}` : 'error:other');
        throw e;
      }
    },
  };
  return p;
}

async function consume(env: Env, s: ReturnType<typeof script>) {
  seedJob('j1');
  const id = insertQueued();
  const port = recording(openAiPort(env, { fetchImpl: s.fetchImpl }));
  const result = await runImage(env, stubPort(), port, id, { deadline: Date.now() + 60_000 });
  const row = one(db, 'SELECT state, error FROM image_requests WHERE id = ?', id);
  return { id, result, row, keys: port.keys };
}
const halted = () => (db.prepare("SELECT value FROM settings WHERE key = 'image_gen_halted'").get() as { value: string } | undefined)?.value ?? null;
const backupUsedAt = () => (db.prepare('SELECT value FROM settings WHERE key = ?').get(BACKUP_KEY_SETTING) as { value: string } | undefined)?.value ?? null;
const backupLogs = () => logs.map((l) => JSON.parse(l) as Record<string, unknown>).filter((l) => l.at === 'openai_backup');
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// ---------------------------------------------------------------------------

describe('§O-13 2・3・4 予備の鍵で 1 回（consumer runImage + 本物の openAiPort）', () => {
  it('主 quota → 予備 ok: done・key backup・settings が書かれる・ログ 1 行。fetch 2 回で 2 回目の authorization が予備の値', async () => {
    const s = script(S.quota, S.ok);
    const r = await consume(makeEnv(), s);
    expect(r.result).toBe('done');
    expect(r.row).toEqual({ state: 'done', error: null });
    expect(r.keys).toEqual(['backup']);
    expect(s.auths).toEqual([`Bearer ${PRIMARY}`, `Bearer ${BACKUP}`]);
    expect(halted()).toBeNull();
    expect(backupUsedAt()).toMatch(ISO);
    expect(backupLogs()).toEqual([{ at: 'openai_backup', request_id: r.id, ok: true }]);
  });

  it('主 quota → 予備 quota: failed / quota・停止 quota・settings が書かれる（ログは ok: false）', async () => {
    const s = script(S.quota, S.quota);
    const r = await consume(makeEnv(), s);
    expect(r.result).toBe('failed');
    expect(r.row).toEqual({ state: 'failed', error: 'quota' });
    expect(r.keys).toEqual(['error:backup']);
    expect(s.auths).toEqual([`Bearer ${PRIMARY}`, `Bearer ${BACKUP}`]);
    expect(halted()).toBe('quota');
    expect(backupUsedAt()).toMatch(ISO);
    expect(backupLogs()).toEqual([{ at: 'openai_backup', request_id: r.id, ok: false }]);
  });

  it('停止の理由の表は変えない（§O-13 3）: 主 quota・予備 auth → auth、主 quota・予備 timeout → result_unknown（予備の失敗を投げ、主の失敗は捨てる）', async () => {
    const a = await consume(makeEnv(), script(S.quota, S.auth));
    expect(a.row).toEqual({ state: 'failed', error: 'auth' });
    expect(halted()).toBe('auth');
    expect(backupUsedAt()).toMatch(ISO);

    db = migratedDb();
    const t = await consume(makeEnv(), script(S.quota, S.timeout));
    expect(t.row).toEqual({ state: 'failed', error: 'result_unknown' });
    expect(halted()).toBe(`result_unknown:${t.id}`);
    expect(t.keys).toEqual(['error:backup']);
    expect(backupUsedAt()).toMatch(ISO);
  });

  it('主 auth → 予備 ok: done', async () => {
    const s = script(S.auth, S.ok);
    const r = await consume(makeEnv(), s);
    expect(r.row).toEqual({ state: 'done', error: null });
    expect(r.keys).toEqual(['backup']);
    expect(s.auths).toEqual([`Bearer ${PRIMARY}`, `Bearer ${BACKUP}`]);
    expect(halted()).toBeNull();
    expect(backupUsedAt()).toMatch(ISO);
  });

  it('主 timeout / connection / rate_limited / server / moderation / bad_request / bad_response: fetch 1 回（予備を呼ばない）・settings は書かれない。対照: 主 quota なら fetch 2 回', async () => {
    const expected: Record<string, string> = {
      timeout: 'result_unknown',
      connection: 'result_unknown',
      rate_limited: 'rate_limited',
      server: 'server',
      moderation: 'moderation',
      bad_request: 'bad_request',
      bad_response: 'bad_response',
    };
    for (const [kind, error] of Object.entries(expected)) {
      db = migratedDb();
      logs = [];
      const s = script(S[kind], S.ok);
      const r = await consume(makeEnv(), s);
      expect(s.auths, kind).toEqual([`Bearer ${PRIMARY}`]);
      expect(r.row, kind).toEqual({ state: 'failed', error });
      expect(r.keys, kind).toEqual(['error:primary']);
      expect(backupUsedAt(), kind).toBeNull();
      expect(backupLogs(), kind).toEqual([]);
    }
    // 対照（同じ台本の形で、主が quota の時だけ予備を呼ぶ）
    db = migratedDb();
    const c = script(S.quota, S.ok);
    expect((await consume(makeEnv(), c)).row).toEqual({ state: 'done', error: null });
    expect(c.auths.length).toBe(2);
  });

  it('主 ok: fetch 1 回・key primary・settings は書かれない', async () => {
    const s = script(S.ok, S.ok);
    const r = await consume(makeEnv(), s);
    expect(r.row).toEqual({ state: 'done', error: null });
    expect(r.keys).toEqual(['primary']);
    expect(s.auths).toEqual([`Bearer ${PRIMARY}`]);
    expect(backupUsedAt()).toBeNull();
    expect(backupLogs()).toEqual([]);
  });

  it('予備なし: 従来どおり（主 quota → quota 停止、fetch 1 回、settings なし）。対照: 予備ありなら fetch 2 回で done', async () => {
    for (const none of [undefined, '']) {
      db = migratedDb();
      logs = [];
      const s = script(S.quota, S.ok);
      const r = await consume(makeEnv({ OPENAI_API_KEY_BACKUP: none }), s);
      expect(r.row).toEqual({ state: 'failed', error: 'quota' });
      expect(halted()).toBe('quota');
      expect(s.auths).toEqual([`Bearer ${PRIMARY}`]);
      expect(backupUsedAt()).toBeNull();
      expect(backupLogs()).toEqual([]);
    }
    db = migratedDb();
    const c = script(S.quota, S.ok);
    expect((await consume(makeEnv(), c)).row).toEqual({ state: 'done', error: null });
    expect(c.auths.length).toBe(2);
  });

  it('主なし・予備あり: fetch 1 回（予備）・key backup・settings が書かれる。主と予備が同じ値: fetch 1 回。両方無し: no_key で fetch 0 回', async () => {
    for (const none of [undefined, '']) {
      db = migratedDb();
      logs = [];
      const s = script(S.ok, S.ok);
      const r = await consume(makeEnv({ OPENAI_API_KEY: none }), s);
      expect(r.row).toEqual({ state: 'done', error: null });
      expect(r.keys).toEqual(['backup']);
      expect(s.auths).toEqual([`Bearer ${BACKUP}`]);
      expect(backupUsedAt()).toMatch(ISO);
      expect(backupLogs().length).toBe(1);
    }
    // 主なし・予備で失敗: 予備の失敗の印を持つ（no_key にしない）
    const f = script(S.quota);
    const e = await openAiPort(makeEnv({ OPENAI_API_KEY: undefined }), { fetchImpl: f.fetchImpl }).generate(P, { deadline: Date.now() + 60_000 }).catch((x: unknown) => x);
    expect([(e as OpenAiError).kind, (e as OpenAiError).key]).toEqual(['quota', 'backup']);
    expect(f.auths).toEqual([`Bearer ${BACKUP}`]);

    db = migratedDb();
    const same = script(S.quota, S.ok);
    const r2same = await consume(makeEnv({ OPENAI_API_KEY_BACKUP: PRIMARY }), same);
    expect(same.auths).toEqual([`Bearer ${PRIMARY}`]);
    expect(r2same.row).toEqual({ state: 'failed', error: 'quota' });
    expect(backupUsedAt()).toBeNull();

    const neither = script(S.ok);
    const e2 = await openAiPort(makeEnv({ OPENAI_API_KEY: undefined, OPENAI_API_KEY_BACKUP: undefined }), { fetchImpl: neither.fetchImpl })
      .generate(P, { deadline: Date.now() + 60_000 })
      .catch((x: unknown) => x);
    expect((e2 as OpenAiError).kind).toBe('no_key');
    expect(neither.auths).toEqual([]);
  });

  it('締め切りまで残り 1 秒未満: 予備を呼ばず主の失敗（key の印なし）。対照: 残りが十分なら予備で ok', async () => {
    const s = script(S.quota, S.ok);
    const e = await openAiPort(makeEnv(), { fetchImpl: s.fetchImpl }).generate(P, { deadline: Date.now() + 500 }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(OpenAiError);
    expect([(e as OpenAiError).kind, (e as OpenAiError).key]).toEqual(['quota', undefined]);
    expect(s.auths).toEqual([`Bearer ${PRIMARY}`]);

    const c = script(S.quota, S.ok);
    const ok = await openAiPort(makeEnv(), { fetchImpl: c.fetchImpl }).generate(P, { deadline: Date.now() + 60_000 });
    expect((ok as { key?: string }).key).toBe('backup');
    expect(c.auths.length).toBe(2);
  });

  it('fake の port の成功は key: primary', async () => {
    const r = await createFakeImagePort(makeEnv()).generate(P, { deadline: Date.now() + 60_000 });
    expect((r as { key?: string }).key).toBe('primary');
  });

  it('鍵の値は D1・R2・ログ・例外（message・JSON）に出ない', async () => {
    const surfaces: string[] = [];
    for (const steps of [[S.quota, S.ok], [S.quota, S.quota], [S.auth, S.timeout], [S.quota, S.connection]]) {
      db = migratedDb();
      r2 = new Map();
      const s = script(...steps);
      await consume(makeEnv(), s);
      surfaces.push(
        rows(db, "SELECT name FROM sqlite_master WHERE type = 'table'")
          .map((t) => JSON.stringify(rows(db, `SELECT * FROM ${String(t.name)}`)))
          .join('\n'),
        [...r2.entries()].map(([k, v]) => k + new TextDecoder().decode(v)).join('\n'),
      );
      const e = await openAiPort(makeEnv(), { fetchImpl: script(...steps.map((st) => (st === S.ok ? S.quota : st))).fetchImpl })
        .generate(P, { deadline: Date.now() + 60_000 })
        .catch((x: unknown) => x);
      surfaces.push(String(e), JSON.stringify(e), (e as Error).message, (e as Error).stack ?? '');
    }
    surfaces.push(logs.join('\n'));
    for (const surface of surfaces) {
      expect(surface.includes(PRIMARY)).toBe(false);
      expect(surface.includes(BACKUP)).toBe(false);
    }
    expect(backupLogs().length).toBeGreaterThan(0); // ログの面を実際に見ている
  });
});

// ---------------------------------------------------------------------------
// §O-13 5 画面

interface ImagesUi {
  imagesBandHtml(im: unknown, nowMs?: number): string;
  imagesHtml(d: unknown): string;
}
const code = readFileSync(new URL('../public/admin/admin.js', import.meta.url), 'utf8');
const win: Record<string, unknown> = { __FACTORY_ADMIN_NO_BOOT__: true };
vm.runInNewContext(code, { window: win, console }, { timeout: 2000 });
const I = win.FactoryAdminImages as ImagesUi;
const n = (html: string, re: RegExp) => (html.match(re) || []).length;

describe('§O-13 5 GET /api/status の images と GET /api/images/status の 2 項目', () => {
  const ctx = (env: Env): RouteCtx => {
    const request = new Request('http://localhost/api/images/status');
    return { env, request, url: new URL(request.url), email: 'ops@example.invalid', exec: {} as ExecutionContext, port: async () => no() } as RouteCtx;
  };
  it('予備あり・使った後: backup_configured true・backup_last_used_at は settings の値。予備なし・未使用: false・null。鍵の値は返さない', async () => {
    const env = makeEnv();
    const a = await (await getImagesStatus(ctx(env))).text();
    const b = await (await getStatus(ctx(env))).text();
    expect(JSON.parse(a)).toMatchObject({ backup_configured: true, backup_last_used_at: null });
    expect(JSON.parse(b).images).toMatchObject({ backup_configured: true, backup_last_used_at: null });

    db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)').run(BACKUP_KEY_SETTING, T, T);
    const a2 = await (await getImagesStatus(ctx(env))).text();
    const b2 = await (await getStatus(ctx(env))).text();
    expect(JSON.parse(a2)).toMatchObject({ backup_configured: true, backup_last_used_at: T });
    expect(JSON.parse(b2).images).toMatchObject({ backup_configured: true, backup_last_used_at: T });
    for (const body of [a, b, a2, b2]) {
      expect(body.includes(BACKUP)).toBe(false);
      expect(body.includes(PRIMARY)).toBe(false);
    }

    db = migratedDb();
    const none = makeEnv({ OPENAI_API_KEY_BACKUP: undefined });
    expect(JSON.parse(await (await getImagesStatus(ctx(none))).text())).toMatchObject({ backup_configured: false, backup_last_used_at: null });
    expect(JSON.parse(await (await getStatus(ctx(none))).text()).images).toMatchObject({ backup_configured: false, backup_last_used_at: null });
  });
});

describe('§O-13 5 管理画面', () => {
  const base = { halted: null, month_cents: 0, month_cap_cents: 3000, holds_open: 0, dispatched: 0, recent: [] };
  it('#/images の「停止の状態」のカード: 予備の鍵 あり / なし と 最後に使った <日時> / まだ無い（escape して出す）', () => {
    const yes = I.imagesHtml({ ...base, backup_configured: true, backup_last_used_at: T });
    expect(yes).toContain('<p data-img-backup="yes">予備の鍵: あり</p>');
    expect(n(yes, /data-img-backup-used="1">予備の鍵を最後に使った: (?!まだ無い)/g)).toBe(1);
    expect(yes.indexOf('data-img-backup="yes"')).toBeGreaterThan(yes.indexOf('<h2>停止の状態</h2>'));
    expect(yes.indexOf('data-img-backup="yes"')).toBeLessThan(yes.indexOf('<h2>今月の画像の記帳</h2>'));

    const no_ = I.imagesHtml({ ...base, backup_configured: false, backup_last_used_at: null });
    expect(no_).toContain('<p data-img-backup="no">予備の鍵: なし</p>');
    expect(no_).toContain('<p data-img-backup-used="1">予備の鍵を最後に使った: まだ無い</p>');

    const evil = I.imagesHtml({ ...base, backup_configured: true, backup_last_used_at: '<img src=x onerror=alert(1)>' });
    expect(evil).not.toContain('<img src=x');
  });
  it('状況帯: 予備の鍵を 7 日以内に使った時だけ「画像: 予備の鍵を使いました（<日時>）」の印（#/images へのリンク）', () => {
    const now = Date.parse(T);
    const im = (t: string | null) => ({ halted: null, month_cents: 0, month_cap_cents: 3000, backup_configured: true, backup_last_used_at: t });
    const recent = I.imagesBandHtml(im(new Date(now - 6 * 86_400_000).toISOString()), now);
    expect(n(recent, /<a class="item" href="#\/images" data-img-backup-band="1">/g)).toBe(1);
    expect(n(recent, /画像: 予備の鍵を使いました（[^）<]+）/g)).toBe(1);
    expect(n(recent, /href="#\/images"/g)).toBe(2);
    expect(n(I.imagesBandHtml(im(new Date(now - 8 * 86_400_000).toISOString()), now), /data-img-backup-band="1"/g)).toBe(0);
    expect(n(I.imagesBandHtml(im(null), now), /data-img-backup-band="1"/g)).toBe(0);
    expect(n(I.imagesBandHtml(im('not a date'), now), /data-img-backup-band="1"/g)).toBe(0);
  });
});
