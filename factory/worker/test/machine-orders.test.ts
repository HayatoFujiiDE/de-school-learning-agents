// 機械用の注文の入口（契約 §U-6）。index.fetch を通し、Access の JWT は test の鍵で署名する（JWKS は fetch の stub が返す）。
// DB は node:sqlite の実 DB（migrations 0001〜0007）。startJob は数えるだけの spy で包む（中身は本物。FACTORY_AGENT_ID が無いので session は作らない）。
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import type { Env } from '../src/env';
import { d1, migratedDb, one, rows } from './d1-shim';

const started = vi.hoisted(() => ({ jobIds: [] as string[] }));
vi.mock('../src/jobs', async (orig) => {
  const actual = await orig<typeof import('../src/jobs')>();
  return {
    ...actual,
    startJob: async (...args: Parameters<typeof actual.startJob>) => {
      started.jobIds.push(args[2]);
      return actual.startJob(...args);
    },
  };
});

const { default: worker } = await import('../src/index');
const { verifyAccessIdentity, verifyAccessJwt } = await import('../src/access');

const TEAM = 'https://team.example.cloudflareaccess.com';
const AUD = 'aud-test';
const ORIGIN = 'http://localhost';
const CLIENT = 'claude-order.access';
const exec = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
const b64u = (b: ArrayBuffer | Uint8Array | string) => Buffer.from(typeof b === 'string' ? b : b instanceof Uint8Array ? b : new Uint8Array(b)).toString('base64url');

let db: DatabaseSync;
let env: Env;
let sign: (payload: Record<string, unknown>) => Promise<string>;
let logs: string[];
const realFetch = globalThis.fetch;
const realCaches = (globalThis as unknown as { caches?: unknown }).caches;

async function setupJwks() {
  const kp = (await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const jwk = { ...(await crypto.subtle.exportKey('jwk', kp.publicKey)), kid: 'k1' };
  const store = new Map<string, Response>();
  (globalThis as unknown as { caches: unknown }).caches = {
    default: { match: async (r: Request) => store.get(r.url)?.clone(), put: async (r: Request, res: Response) => void store.set(r.url, res) },
  };
  (globalThis as unknown as { fetch: unknown }).fetch = async () => new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
  return async (payload: Record<string, unknown>) => {
    const h = b64u(JSON.stringify({ alg: 'RS256', kid: 'k1' }));
    const p = b64u(JSON.stringify({ iss: TEAM, aud: [AUD], exp: Math.floor(Date.now() / 1000) + 600, ...payload }));
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', kp.privateKey, new TextEncoder().encode(`${h}.${p}`));
    return `${h}.${p}.${b64u(sig)}`;
  };
}

const svc = (cn = CLIENT) => sign({ common_name: cn, sub: '' });
const human = (email = 'op@example.invalid') => sign({ email });

async function call(method: string, path: string, o: { token?: string; body?: unknown; origin?: string | null; raw?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (o.token) headers['Cf-Access-Jwt-Assertion'] = o.token;
  if (o.origin !== null) headers.origin = o.origin ?? ORIGIN;
  const body = o.raw !== undefined ? o.raw : o.body === undefined ? undefined : JSON.stringify(o.body);
  return worker.fetch(new Request(`${ORIGIN}${path}`, { method, headers, ...(body === undefined ? {} : { body }) }), env, exec);
}

let seq = 0;
const order = (over: Record<string, unknown> = {}) => {
  seq += 1;
  return {
    request_id: `req-${String(seq).padStart(4, '0')}-abcdef`,
    title: '影の長さと太陽の高さ',
    slug: `shadow-${seq}`,
    kinds: [3],
    brief_md: '影の長さが時間で変わる理由を、図で確かめられる教材にしてください。',
    no_personal_data: true,
    ...over,
  };
};
const postOrder = async (body: unknown, token?: string) => call('POST', '/api/orders', { token: token ?? (await svc()), body });

const count = (sql: string, ...p: Array<string | number | null>) => Number(one(db, sql, ...p).n);
const materialsN = () => count('SELECT COUNT(*) AS n FROM materials');
const jobsN = () => count('SELECT COUNT(*) AS n FROM factory_jobs');
const ordersN = () => count('SELECT COUNT(*) AS n FROM machine_orders');

beforeEach(async () => {
  db = migratedDb();
  env = { DB: d1(db), ANTHROPIC_FAKE: '1', ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ORDER_CLIENT_IDS: CLIENT } as unknown as Env;
  sign = await setupJwks();
  started.jobIds = [];
  logs = [];
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(' ')));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  (globalThis as unknown as { fetch: unknown }).fetch = realFetch;
  (globalThis as unknown as { caches: unknown }).caches = realCaches;
});

describe('§U-6 1 service token + 一致する client', () => {
  it('201。素材・job・machine_orders が 1 行ずつ。startJob は 1 回。ログに題名・注文票は出ない', async () => {
    const body = order();
    const res = await postOrder(body);
    expect(res.status).toBe(201);
    const r = (await res.json()) as Record<string, unknown>;
    // FACTORY_AGENT_ID が無いので起動は失敗し、人の入口と同じく start_error を添えて 201（job は queued で残る）
    expect(r).toMatchObject({ start_error: 'factory_not_configured' });
    expect([materialsN(), jobsN(), ordersN()]).toEqual([1, 1, 1]);
    const m = one(db, 'SELECT id, slug, title, proposal_id, work_status FROM materials');
    const j = one(db, 'SELECT id, material_id, kind, status, budget_cents FROM factory_jobs');
    const mo = one(db, 'SELECT * FROM machine_orders');
    expect(r).toMatchObject({ material_id: m.id, job_id: j.id });
    expect(m).toMatchObject({ slug: body.slug, proposal_id: null, work_status: 'queued' });
    expect(j).toMatchObject({ material_id: m.id, kind: 'draft', status: 'queued', budget_cents: 300 });
    const tokyo = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
    expect(mo).toMatchObject({ request_id: body.request_id, client: CLIENT, material_id: m.id, job_id: j.id, day: tokyo });
    expect(started.jobIds).toEqual([j.id]);
    const line = logs.map((l) => { try { return JSON.parse(l) as Record<string, unknown>; } catch { return null; } }).find((x) => x?.at === 'machine_order');
    expect(line).toEqual({ at: 'machine_order', client: CLIENT, material_id: m.id, job_id: j.id });
    expect(logs.join('\n')).not.toContain(body.title);
    expect(logs.join('\n')).not.toContain(body.brief_md);
  });

  it('ORDER_CLIENT_IDS はカンマ区切り・前後の空白を除いて完全一致で比べる', async () => {
    env = { ...env, ORDER_CLIENT_IDS: ` other.access ,  ${CLIENT} ,` } as Env;
    expect((await postOrder(order())).status).toBe(201);
  });

  it('本文が 64 KiB を超えると 400 invalid_json（何も入らない）', async () => {
    const res = await postOrder(order({ pad: 'あ'.repeat(22_000) })); // 3 バイト × 22,000 > 64 KiB（文字数は 64K 未満）
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_json' });
    expect(materialsN()).toBe(0);
  });

  it('request_id が無い・形が違う → 400 invalid_request_id（何も入らない）', async () => {
    for (const rid of [undefined, 'short', 'a'.repeat(65), 'has space__', 'semi;colon1', 12345678]) {
      const b = order({ request_id: rid });
      if (rid === undefined) delete (b as Record<string, unknown>).request_id;
      const res = await postOrder(b);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'invalid_request_id' });
    }
    expect([materialsN(), ordersN()]).toEqual([0, 0]);
    expect(started.jobIds).toEqual([]);
  });
});

describe('§U-6 2〜4 認証', () => {
  it('2. 人（email）→ 403 service_only。email が `service:` で始まっても service 扱いしない', async () => {
    for (const email of ['op@example.invalid', `service:${CLIENT}`]) {
      const res = await postOrder(order(), await human(email));
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'service_only' });
    }
    expect(materialsN()).toBe(0);
  });

  it('2. dev bypass の人も 403 service_only', async () => {
    env = { ...env, ACCESS_DEV_BYPASS_EMAIL: 'dev@example.invalid' } as Env;
    const res = await call('POST', '/api/orders', { body: order() });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'service_only' });
  });

  it('3. 不一致の client（接頭辞・部分一致を含む）・未設定・空 → 403 orders_disabled', async () => {
    for (const cn of ['other.access', `${CLIENT}x`, CLIENT.slice(0, -1), `x${CLIENT}`, CLIENT.toUpperCase()]) {
      const res = await postOrder(order(), await svc(cn));
      expect(res.status, cn).toBe(403);
      expect(await res.json()).toEqual({ error: 'orders_disabled' });
    }
    for (const ids of [undefined, '', ' , ']) {
      env = { ...env, ORDER_CLIENT_IDS: ids } as Env;
      const res = await postOrder(order());
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'orders_disabled' });
    }
    expect([materialsN(), ordersN()]).toEqual([0, 0]);
  });

  it('4. Origin なし・違う Origin → 403 bad_origin', async () => {
    for (const origin of [null, 'http://evil.example']) {
      const res = await call('POST', '/api/orders', { token: await svc(), body: order(), origin });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'bad_origin' });
    }
    expect(materialsN()).toBe(0);
  });

  it('service token は明示のフィールドで運ぶ（verifyAccessIdentity）。従来の verifyAccessJwt の文字列は変えない', async () => {
    const cfgVars = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD } as unknown as Env;
    const t = await svc();
    expect(await verifyAccessIdentity(t, cfgVars, undefined, { allowCommonName: true })).toEqual({ email: `service:${CLIENT}`, service: true, commonName: CLIENT });
    expect(await verifyAccessIdentity(t, cfgVars)).toBeNull();
    expect(await verifyAccessJwt(t, cfgVars, undefined, { allowCommonName: true })).toBe(`service:${CLIENT}`);
    expect(await verifyAccessIdentity(await human(`service:${CLIENT}`), cfgVars, undefined, { allowCommonName: true })).toEqual({
      email: `service:${CLIENT}`,
      service: false,
      commonName: null,
    });
  });
});

describe('§U-6 5 他のルートは service token を今までどおり受けない', () => {
  it('POST /api/materials・GET /api/floor 等に service token → 401 access_denied（Access の段で止まる。今までと同じ）', async () => {
    const t = await svc();
    for (const [method, path, body] of [
      ['POST', '/api/materials', order()],
      ['GET', '/api/floor', undefined],
      ['GET', '/api/materials', undefined],
      ['POST', '/api/proposals', { title: 't', body: 'b' }],
      ['POST', '/api/orders/x', order()],
    ] as Array<[string, string, unknown]>) {
      const res = await call(method, path, { token: t, body });
      expect(res.status, `${method} ${path}`).toBe(401);
      expect(await res.json()).toEqual({ error: 'access_denied' });
    }
    expect(materialsN()).toBe(0);
  });

  it('/api/intake は今までどおり service token で入る', async () => {
    const res = await call('POST', '/api/intake', {
      token: await svc('buddy.access'),
      body: {
        title: '影の長さを測りたかった',
        body: '外で棒の影を見ていて、時間で長さが変わる理由を知りたくなった',
        concept_codes: ['SCI02'],
        age_band: 'elementary',
        missing: '影の長さと太陽の高さの関係を示す図',
        supporter_checked: true,
        supporter_email: 'staff@example.invalid',
      },
    });
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(201);
    expect(count("SELECT COUNT(*) AS n FROM proposals WHERE source_kind = 'child'")).toBe(1);
  });

  it('人は POST /api/materials に今までどおり入れる（machine_orders には何も入らない）', async () => {
    const b = order();
    delete (b as Record<string, unknown>).request_id;
    const res = await call('POST', '/api/materials', { token: await human(), body: b });
    expect(res.status).toBe(201);
    expect([materialsN(), ordersN()]).toEqual([1, 0]);
  });
});

describe('§U-6 6 1 日の件数の上限', () => {
  it('5 件目まで 201、6 件目 429（素材は増えない）。日が変われば入る', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-07T05:00:00.000Z')); // JST 11/07 14:00
    for (let i = 0; i < 5; i++) expect((await postOrder(order())).status).toBe(201);
    const res = await postOrder(order());
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'daily_order_limit' });
    expect([materialsN(), jobsN(), ordersN()]).toEqual([5, 5, 5]);
    expect(started.jobIds).toHaveLength(5);

    vi.setSystemTime(new Date('2026-11-07T15:00:00.000Z')); // JST 11/08 00:00（cost_ledger の日と同じ区切り）
    expect((await postOrder(order())).status).toBe(201);
    expect(rows(db, 'SELECT day, COUNT(*) AS n FROM machine_orders GROUP BY day ORDER BY day')).toEqual([
      { day: '2026-11-07', n: 5 },
      { day: '2026-11-08', n: 1 },
    ]);
  });

  it('ORDER_DAILY_MAX=0・負の値 → 全部 429。ORDER_DAILY_MAX=2 → 3 件目が 429', async () => {
    for (const v of ['0', '-1']) {
      env = { ...env, ORDER_DAILY_MAX: v } as Env;
      const res = await postOrder(order());
      expect(res.status, v).toBe(429);
      expect(await res.json()).toEqual({ error: 'daily_order_limit' });
    }
    expect([materialsN(), jobsN(), ordersN()]).toEqual([0, 0, 0]);
    env = { ...env, ORDER_DAILY_MAX: '2' } as Env;
    expect((await postOrder(order())).status).toBe(201);
    expect((await postOrder(order())).status).toBe(201);
    expect((await postOrder(order())).status).toBe(429);
    expect(materialsN()).toBe(2);
  });

  it('上限の判定は INSERT と同じ batch の述語にある（batch の中で数え直す: 先に数えた後に行が増えても入らない）', async () => {
    env = { ...env, ORDER_DAILY_MAX: '1' } as Env;
    // 事前の読み取り（machine_orders の request_id の照会）の直後に、別の注文が先に入ったことにする
    const base = d1(db);
    let injected = false;
    env = {
      ...env,
      DB: {
        prepare: (sql: string) => {
          const s = base.prepare(sql);
          if (!injected && sql.startsWith('SELECT client, material_id, job_id FROM machine_orders')) {
            injected = true;
            const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
            db.prepare("INSERT INTO machine_orders VALUES ('other-req-0001', ?, 'm-x', 'j-x', ?, 't')").run(CLIENT, today);
          }
          return s;
        },
        batch: base.batch.bind(base),
      } as unknown as D1Database,
    } as Env;
    const res = await postOrder(order());
    expect(res.status).toBe(429);
    expect([materialsN(), jobsN(), ordersN()]).toEqual([0, 0, 1]);
  });
});

describe('§U-6 7 止める設定', () => {
  it("machine_orders_enabled='0' → 403 orders_disabled、素材は増えない。'1' や行なしなら入る", async () => {
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('machine_orders_enabled', '0', 't')").run();
    const res = await postOrder(order());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'orders_disabled' });
    expect([materialsN(), jobsN(), ordersN()]).toEqual([0, 0, 0]);
    expect(started.jobIds).toEqual([]);
    db.prepare("UPDATE settings SET value = '1' WHERE key = 'machine_orders_enabled'").run();
    expect((await postOrder(order())).status).toBe(201);
  });

  it('判定と INSERT の間に止めても入らない（述語は batch の中で読む）', async () => {
    const base = d1(db);
    let injected = false;
    env = {
      ...env,
      DB: {
        prepare: (sql: string) => {
          if (!injected && sql.startsWith('SELECT client, material_id, job_id FROM machine_orders')) {
            injected = true;
            db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('machine_orders_enabled', '0', 't')").run();
          }
          return base.prepare(sql);
        },
        batch: base.batch.bind(base),
      } as unknown as D1Database,
    } as Env;
    const res = await postOrder(order());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'orders_disabled' });
    expect([materialsN(), jobsN(), ordersN()]).toEqual([0, 0, 0]);
  });
});

describe('§U-6 8 同じ request_id の再送', () => {
  it('200 replay、素材は 1 つ、startJob は 1 回。止める設定・上限に当たっていても replay は返る', async () => {
    const body = order();
    const first = (await (await postOrder(body)).json()) as Record<string, unknown>;
    const res = await postOrder(body);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ material_id: first.material_id, job_id: first.job_id, replay: true });
    expect([materialsN(), jobsN(), ordersN()]).toEqual([1, 1, 1]);
    expect(started.jobIds).toHaveLength(1);

    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('machine_orders_enabled', '0', 't')").run();
    env = { ...env, ORDER_DAILY_MAX: '0' } as Env;
    const again = await postOrder({ ...body, slug: 'different-slug' });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ material_id: first.material_id, job_id: first.job_id, replay: true });
    expect(started.jobIds).toHaveLength(1);
  });

  it('別 client の同じ request_id → 409 request_id_conflict', async () => {
    env = { ...env, ORDER_CLIENT_IDS: `${CLIENT},second.access` } as Env;
    const body = order();
    expect((await postOrder(body)).status).toBe(201);
    const res = await postOrder({ ...body, slug: 'other-slug' }, await svc('second.access'));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'request_id_conflict' });
    expect([materialsN(), ordersN()]).toEqual([1, 1]);
    expect(started.jobIds).toHaveLength(1);
  });

  it('同時に 2 通（事前の照会を両方すり抜けた）→ 素材は 1 つ。負けた方は PRIMARY KEY で batch ごと戻り、再読して replay', async () => {
    const body = order();
    const won = (await (await postOrder(body)).json()) as Record<string, unknown>;
    // 2 通目の事前の照会だけ「まだ無い」と答える（同時に来て、先の方の commit の前に読んだのと同じ）
    const base = d1(db);
    let hidden = false;
    env = {
      ...env,
      DB: {
        prepare: (sql: string) => {
          const s = base.prepare(sql);
          if (!hidden && sql.startsWith('SELECT client, material_id, job_id FROM machine_orders')) {
            hidden = true;
            return { bind: () => ({ first: async () => null }) };
          }
          return s;
        },
        batch: base.batch.bind(base),
      } as unknown as D1Database,
    } as Env;
    const res = await postOrder({ ...body, slug: 'race-loser-slug' }); // slug を変えても machine_orders の PRIMARY KEY で止まる
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ material_id: won.material_id, job_id: won.job_id, replay: true });
    expect([materialsN(), jobsN(), ordersN()]).toEqual([1, 1, 1]);
    expect(count("SELECT COUNT(*) AS n FROM materials WHERE slug = 'race-loser-slug'")).toBe(0);
    expect(started.jobIds).toHaveLength(1);
  });

  it('Promise.all で同時に 2 通 → 素材は 1 つ（201 と 200 replay）', async () => {
    const body = order();
    const [a, b] = await Promise.all([postOrder(body), postOrder(body)]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect([materialsN(), jobsN(), ordersN()]).toEqual([1, 1, 1]);
    expect(started.jobIds).toHaveLength(1);
  });
  it('最後の枠で同時に 2 通（ORDER_DAILY_MAX=1）→ 負けた方は 429 でなく 200 replay', async () => {
    env = { ...env, ORDER_DAILY_MAX: '1' } as Env;
    const body = order();
    const [a, b] = await Promise.all([postOrder(body), postOrder(body)]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect([materialsN(), jobsN(), ordersN()]).toEqual([1, 1, 1]);
    expect(started.jobIds).toHaveLength(1);
  });
});

describe('§U-6 9 人の入口と同じ error。machine_orders に行が残らない', () => {
  it.each([
    ['no_personal_data なし', { no_personal_data: undefined }, 400, 'personal_data_confirmation_required'],
    ['no_personal_data が文字列', { no_personal_data: 'true' }, 400, 'personal_data_confirmation_required'],
    ['不正な kinds', { kinds: [99] }, 400, 'invalid_kinds'],
    ['kinds が空', { kinds: [] }, 400, 'invalid_kinds'],
    ['不正な slug', { slug: 'Bad Slug' }, 400, 'invalid_slug'],
    ['material_id を付けた', { material_id: 'm1' }, 400, 'use_post_jobs_for_existing_material'],
    ['kind が rework', { kind: 'rework' }, 400, 'new_material_must_be_draft'],
    ['parent_version_id を付けた', { parent_version_id: 'v1' }, 400, 'invalid_parent_version'],
    ['brief_md なし', { brief_md: undefined }, 400, 'invalid_brief'],
  ])('%s → %i %s', async (_l, over, status, error) => {
    const b = order(over);
    for (const [k, v] of Object.entries(over)) if (v === undefined) delete (b as Record<string, unknown>)[k];
    const res = await postOrder(b);
    expect(res.status).toBe(status);
    const r = (await res.json()) as Record<string, unknown>;
    expect(r.error).toBe(error);
    // 人の入口も同じ error
    const hb = { ...b };
    delete (hb as Record<string, unknown>).request_id;
    const hr = (await (await call('POST', '/api/materials', { token: await human(), body: hb })).json()) as Record<string, unknown>;
    expect(hr.error).toBe(error);
    expect([materialsN(), ordersN()]).toEqual([0, 0]);
    expect(started.jobIds).toEqual([]);
  });

  it('slug の重複 → 409 slug_taken（人の入口と同じ）。machine_orders の行は残らない', async () => {
    const hb = order();
    delete (hb as Record<string, unknown>).request_id;
    expect((await call('POST', '/api/materials', { token: await human(), body: hb })).status).toBe(201);
    const res = await postOrder(order({ slug: hb.slug }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'slug_taken' });
    expect([materialsN(), jobsN(), ordersN()]).toEqual([1, 1, 0]);
    expect(started.jobIds).toHaveLength(1); // 人の注文の 1 回だけ
  });
});

describe('§U-6 10 画面用の応答の machine_order', () => {
  it('機械の注文: GET /api/jobs/:id と /api/materials/:id に { client, created_at }。人の注文では null', async () => {
    const r = (await (await postOrder(order())).json()) as { material_id: string; job_id: string };
    const hb = order();
    delete (hb as Record<string, unknown>).request_id;
    const h = (await (await call('POST', '/api/materials', { token: await human(), body: hb })).json()) as { material_id: string; job_id: string };
    const t = await human();
    const mo = one(db, 'SELECT client, created_at FROM machine_orders');
    const jd = (await (await call('GET', `/api/jobs/${r.job_id}`, { token: t })).json()) as Record<string, unknown>;
    const md = (await (await call('GET', `/api/materials/${r.material_id}`, { token: t })).json()) as Record<string, unknown>;
    expect(jd.machine_order).toEqual({ client: CLIENT, created_at: mo.created_at });
    expect(md.machine_order).toEqual({ client: CLIENT, created_at: mo.created_at });
    expect((jd.job as Record<string, unknown>).id).toBe(r.job_id);
    const hj = (await (await call('GET', `/api/jobs/${h.job_id}`, { token: t })).json()) as Record<string, unknown>;
    const hm = (await (await call('GET', `/api/materials/${h.material_id}`, { token: t })).json()) as Record<string, unknown>;
    expect(hj.machine_order).toBeNull();
    expect(hm.machine_order).toBeNull();
  });

  it('素材は最初の注文の行を返す', async () => {
    const now = '2026-11-07T00:00:00.000Z';
    db.prepare("INSERT INTO materials (id, slug, title, kinds_json, work_status, publish_status, brief_md, created_at, updated_at) VALUES ('m1', 's1', 't', '[3]', 'idle', 'none', 'b', ?, ?)").run(now, now);
    db.prepare("INSERT INTO machine_orders VALUES ('req-later-0001', 'b.access', 'm1', 'j2', '2026-11-08', '2026-11-08T00:00:00.000Z')").run();
    db.prepare("INSERT INTO machine_orders VALUES ('req-first-0001', 'a.access', 'm1', 'j1', '2026-11-07', '2026-11-07T00:00:00.000Z')").run();
    const md = (await (await call('GET', '/api/materials/m1', { token: await human() })).json()) as Record<string, unknown>;
    expect(md.machine_order).toEqual({ client: 'a.access', created_at: '2026-11-07T00:00:00.000Z' });
  });

  it('画面: 行がある時だけ「注文した人: Claude（機械の入口）」。client の文字列は出さない', () => {
    const code = readFileSync(new URL('../public/admin/admin.js', import.meta.url), 'utf8');
    const win: Record<string, unknown> = { __FACTORY_ADMIN_NO_BOOT__: true };
    vm.runInNewContext(code, { window: win, console }, { timeout: 2000 });
    const O = win.FactoryAdminOrders as { machineOrderFactHtml: (mo: unknown) => string; jobHtml: (j: unknown, mode: string, draft: unknown, mo?: unknown) => string };
    const mo = { client: '<b>claude-order.access</b>', created_at: '2026-11-07T00:00:00.000Z' };
    expect(O.machineOrderFactHtml(mo)).toContain('注文した人: Claude（機械の入口）');
    expect(O.machineOrderFactHtml(null)).toBe('');
    const j = { id: 'j1', material_id: 'm1', kind: 'draft', status: 'queued', phase: 'questions', model: 'x', questions: [], brief_md: 'b', deny_count: 0 };
    const withMo = O.jobHtml(j, 'none', {}, mo);
    expect(withMo).toContain('<h1>注文の状況</h1>');
    expect(withMo).toContain('注文した人: Claude（機械の入口）');
    expect(withMo).not.toContain('claude-order');
    expect(O.jobHtml(j, 'none', {}, null)).not.toContain('注文した人');
    // 素材の画面も同じ helper を通す
    expect(code).toContain("machineOrderFactHtml(d.machine_order) + '</div>'");
  });
});
