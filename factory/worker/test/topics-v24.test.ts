// contract-T v2.4 の裁定（実装のレビュー Astra high ×2）の「直す」3・5・7・8・10 と、一覧の続きの組
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import { decideTopic, listTopics } from '../src/routes/topics';
import { checkTopic, cleanupLeases, writeJudgement } from '../src/topics/check';
import { fetchHeadlines, runTopicRun } from '../src/topics/gen';
import { judgeCheck, parseCheckOutput } from '../src/topics/judge';
import { SAVE_CHECK_SCHEMA } from '../src/topics/prompts';
import { TOPIC_BODY_JSON_SCHEMA } from '../src/topics/schema';
import { checkClaimStmt, checkReserveStmt, readTopic } from '../src/topics/store';
import {
  checkIn,
  count,
  enable,
  fetchStub,
  genMessage,
  ledger,
  migratedDb,
  philoBody,
  routeCtx,
  scriptedPort,
  seedTopic,
  supportPassed,
  talkBody,
  tokyoToday,
  tomorrow,
  topic,
  topicEnv,
} from './topics-helpers';

let db: DatabaseSync;
let env: Env;
const { fetchImpl } = fetchStub({});
const far = () => Date.now() + 10 * 60_000;

beforeEach(() => {
  db = migratedDb();
  enable(db);
  env = topicEnv(db);
});

type ListRes = { topics: Array<{ id: string }>; next_before: string | null };
const list = async (q: string): Promise<{ status: number; json: ListRes }> => {
  const r = await listTopics(routeCtx(env, 'GET', `/api/topics${q}`));
  return { status: r.status, json: (await r.json()) as ListRes };
};

describe('一覧の続きは「作成時刻と id の組」（T-10・裁定 3）', () => {
  it('同じ時刻のお題 3 本を limit 1 で読んでも、3 本とも 1 回ずつ出る', async () => {
    const at = '2026-11-06T09:50:00.000Z';
    for (const n of [1, 2, 3]) await seedTopic(db, { id: `tp_run_${n}`, body: talkBody(`題 ${'いろは'[n - 1]}`), createdAt: at });
    await seedTopic(db, { id: 'tp_old_1', body: talkBody('古い題'), createdAt: '2026-11-05T00:00:00.000Z' });
    const seen: string[] = [];
    let before: string | null = null;
    for (let i = 0; i < 10; i++) {
      const r = await list(`?limit=1${before ? `&before=${encodeURIComponent(before)}` : ''}`);
      expect(r.status).toBe(200);
      seen.push(...r.json.topics.map((t) => t.id));
      before = r.json.next_before;
      if (!before) break;
    }
    expect(seen).toEqual(['tp_run_3', 'tp_run_2', 'tp_run_1', 'tp_old_1']);
  });
  it('壊れた続きの文字列は 400 bad_query', async () => {
    for (const b of ['2026-11-06T09:50:00.000Z', 'x|y', '|tp_1', `2026-11-06T09:50:00.000Z|${'a'.repeat(200)}`]) {
      expect((await list(`?before=${encodeURIComponent(b)}`)).status).toBe(400);
    }
  });
});

describe('締め切りまでの残りが 5 秒未満なら呼ばない（取り置きもしない。裁定 7）', () => {
  it('生成・派生: run の行も台帳も呼び出しも 0（no_time）', async () => {
    const p = scriptedPort([genMessage([talkBody()])]);
    const o = await runTopicRun(env, p.port, { purpose: 'gen', kind: 'talk', trigger: 'cron', slotDay: tomorrow() }, { deadline: Date.now() + 4_000, fetchImpl });
    expect(o).toMatchObject({ status: 'not_taken', reason: 'no_time' });
    await seedTopic(db, { id: 'tp_p_1', body: philoBody(), status: 'ready', starred: 1 });
    const o2 = await runTopicRun(env, p.port, { purpose: 'derive', kind: 'extend', trigger: 'cron', parentId: 'tp_p_1' }, { deadline: Date.now() + 4_000, fetchImpl });
    expect(o2).toMatchObject({ status: 'not_taken', reason: 'no_time' });
    expect([count(db, 'SELECT COUNT(*) AS n FROM topic_runs'), ledger(db).length, p.calls.length]).toEqual([0, 0, 0]);
  });
  it('検査: 取らない（draft・attempts 0 のまま、台帳も呼び出しも 0）', async () => {
    await seedTopic(db, { id: 'tp_c_1', body: talkBody() });
    const p = scriptedPort([supportPassed()]);
    const r = await checkTopic(env, p.port, 'tp_c_1', { deadline: Date.now() + 4_000, fetchImpl });
    expect(r).toMatchObject({ status: 'not_taken', error: 'no_time' });
    expect(topic(db, 'tp_c_1')).toMatchObject({ status: 'draft', check_attempts: 0 });
    expect([ledger(db).length, p.calls.length]).toEqual([0, 0]);
  });
  it('残りが 5 秒以上なら今までどおり呼ぶ', async () => {
    const p = scriptedPort([genMessage([talkBody()])]);
    expect((await runTopicRun(env, p.port, { purpose: 'gen', kind: 'talk', trigger: 'manual', slotDay: tomorrow() }, { deadline: Date.now() + 30_000, fetchImpl })).status).toBe('done');
    expect(p.calls.length).toBe(1);
  });
});

describe('RSS の見出し: 今より 1 日を超えて先の日付は捨てる（裁定 8）', () => {
  it('当日の記事 1 件と 2099 年の記事 40 件 → 当日の記事が残り、未来の記事は 0 件', async () => {
    const now = new Date();
    const item = (title: string, d: Date) => `<item><title>${title}</title><link>https://news.example.org/${encodeURIComponent(title)}</link><pubDate>${d.toUTCString()}</pubDate></item>`;
    const future = Array.from({ length: 40 }, (_, i) => item(`未来の記事 ${i}`, new Date(Date.UTC(2099, 0, 1 + i))));
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>f</title>${future.join('')}${item('今日の記事', new Date(now.getTime() - 3600_000))}${item('明日の記事（時計のずれの範囲）', new Date(now.getTime() + 20 * 3600_000))}</channel></rss>`;
    const f = fetchStub({ 'https://feeds.example.org/rss': { type: 'application/rss+xml', body: xml } });
    const items = await fetchHeadlines(f.fetchImpl, Date.now() + 30_000, now, ['https://feeds.example.org/rss']);
    expect(items.map((x) => x.title)).toEqual(['明日の記事（時計のずれの範囲）', '今日の記事']);
  });
});

describe('検査を取った直後・呼ぶ前に落ちた（T-7・裁定 10）', () => {
  it('台帳 1 行（取り置き額 15）・外部の呼び出し 0 回。lease 切れの片付けで draft に戻り、台帳は取り置き額のまま', async () => {
    await seedTopic(db, { id: 'tp_c_1', body: talkBody() });
    // 取る batch の後の最初の読み出しで落ちる DB（Worker が止まったのと同じ: その後は 1 行も書かない）
    let crashed = false;
    const real = env.DB;
    const crashing = new Proxy(real, {
      get(t, k) {
        if (k === 'batch') return async (...a: Parameters<D1Database['batch']>) => {
          const r = await t.batch(...a);
          crashed = true;
          return r;
        };
        if (k === 'prepare' && crashed) return () => {
          throw new Error('worker crashed');
        };
        const v = Reflect.get(t, k);
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
    const p = scriptedPort([supportPassed()]);
    await expect(checkTopic({ ...env, DB: crashing } as Env, p.port, 'tp_c_1', { deadline: far(), fetchImpl })).rejects.toThrow('worker crashed');
    expect(p.calls.length).toBe(0);
    expect(ledger(db)).toEqual([{ ref_id: 'tp:tp_c_1:chk:1', cents: 15 }]);
    expect(topic(db, 'tp_c_1')).toMatchObject({ status: 'checking', check_attempts: 1 });
    db.prepare('UPDATE topics SET check_lease_until = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), 'tp_c_1');
    await cleanupLeases(env, new Date().toISOString());
    expect(topic(db, 'tp_c_1')).toMatchObject({ status: 'draft', check_token: null, check_attempts: 1 });
    expect(ledger(db)).toEqual([{ ref_id: 'tp:tp_c_1:chk:1', cents: 15 }]);
  });
});

describe('全体の日次（dailyReservedSql）に検証の飛行中の取り置きを入れる（T-6・裁定 10）', () => {
  // 検証の取り置き 150 × 飛行中 2 本 = 300。台帳 40 + 300 + 取り置き 60 = 400
  const inflight = () => {
    db.exec('PRAGMA foreign_keys = OFF');
    for (const [i, phase] of [[1, 'submitting'], [2, 'collecting'], [3, null]] as const) {
      db.prepare(
        `INSERT INTO material_versions (id, material_id, version, job_id, session_id, r2_prefix, content_sha256, material_json, claims_json, adapt_rules_md, checks_json, public_paths_json, status, created_at, verify_phase)
         VALUES (?, 'm1', ?, ?, 's', 'p/', 'sha', '{}', '[]', 'a', '{}', '[]', 'review', ?, ?)`,
      ).run(`v${i}`, i, `j${i}`, new Date().toISOString(), phase);
    }
    db.prepare("INSERT INTO cost_ledger (id, day, kind, ref_id, cents, created_at) VALUES ('x', ?, 'session', 'pre:1', 40, ?)").run(tokyoToday(), new Date().toISOString());
  };
  it.each([
    ['ちょうど（400）は取れる', '400', 'done', 1],
    ['1 セント超え（上限 399）は台帳も run も呼び出しも 0', '399', 'not_taken', 0],
  ] as const)('%s', async (_n, cap, status, calls) => {
    inflight();
    const e = topicEnv(db, { DAILY_CAP_CENTS: cap, VERIFY_TURN_RESERVE_CENTS: '150', TOPIC_DAILY_CAP_CENTS: '100000', TOPIC_MONTHLY_CAP_CENTS: '100000' });
    const p = scriptedPort([genMessage([talkBody()])]);
    const o = await runTopicRun(e, p.port, { purpose: 'gen', kind: 'talk', trigger: 'manual', slotDay: tomorrow() }, { deadline: far(), fetchImpl });
    expect(o.status).toBe(status);
    expect(p.calls.length).toBe(calls);
    expect(ledger(db).filter((r) => r.ref_id.startsWith('tp:')).length).toBe(calls);
    expect(count(db, 'SELECT COUNT(*) AS n FROM topic_runs')).toBe(calls);
  });
});

describe('禁止語と flags の両方がある held の承認は 400（T-14 b6・裁定 10）', () => {
  it('judgeCheck に禁止語のある本文と flags つきの出力を渡して書いた held は、承認 API で 400 not_approvable', async () => {
    const b = philoBody('作品の順位を決める問い');
    b.lead = { s: '一番上手な人を決める', e: 'じょうず' };
    await seedTopic(db, { id: 'tp_f_1', body: b, found: true });
    // 取る（本物の取り置き + 取る文）
    const token = 'tok-1';
    const now = new Date();
    await env.DB.batch([checkReserveStmt({ env, ledgerId: 'l1', day: tokyoToday(now), cents: 15, now: now.toISOString(), topicId: 'tp_f_1' }), checkClaimStmt({ topicId: 'tp_f_1', token, leaseUntil: new Date(now.getTime() + 600_000).toISOString(), now: now.toISOString() })].map((s) => env.DB.prepare(s.sql).bind(...s.params)));
    const row = (await readTopic(env.DB, 'tp_f_1'))!;
    expect(row.status).toBe('checking');
    const sources = db.prepare('SELECT * FROM topic_sources WHERE topic_id = ?').all('tp_f_1') as never[];
    const out = parseCheckOutput(checkIn(['s1', 's2'], { flags: ['one_sided'] }), ['s1', 's2'])!;
    expect(out).not.toBeNull();
    const j = judgeCheck(b, sources, out, 'normal', { slotDay: row.slot_day });
    expect(j.reasons).toEqual(expect.arrayContaining(['forbidden', 'flagged:one_sided']));
    expect(j.approvable).toBe(false);
    await writeJudgement(env, row, token, j, sources, out, 3);
    expect(topic(db, 'tp_f_1')).toMatchObject({ status: 'held', hold_reason: 'forbidden' });
    const sha = String(topic(db, 'tp_f_1').content_sha256);
    const res = await decideTopic(routeCtx(env, 'POST', '/api/topics/tp_f_1/decide', { decision: 'approve', content_sha256: sha, read_all: true }), 'tp_f_1');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'not_approvable' });
    expect(topic(db, 'tp_f_1').status).toBe('held');
  });
});

describe('生成の save_topics は strict なし（v2.5 の裁定: 文法が大きすぎて 400）と、strict で使える schema の形', () => {
  it('生成の呼び出しの save_topics に strict を付けない（schema は渡す）', async () => {
    const p = scriptedPort([genMessage([talkBody()])]);
    await runTopicRun(env, p.port, { purpose: 'gen', kind: 'talk', trigger: 'manual', slotDay: tomorrow() }, { deadline: far(), fetchImpl });
    const t = (p.calls[0].params.tools ?? []).find((x) => (x as { name?: string }).name === 'save_topics') as { strict?: boolean; input_schema?: unknown };
    expect('strict' in t).toBe(false);
    expect(t.input_schema).toBeTruthy();
  });
  it('形が合わない本は捨てる（strict なしの受け皿）: 余分な項目のある本 1 + 正しい本 1 → 1 本だけ入る', async () => {
    const p = scriptedPort([genMessage([{ ...talkBody('給食の残りをどう減らすか'), extra: 1 }, talkBody()])]);
    const r = await runTopicRun(env, p.port, { purpose: 'gen', kind: 'talk', trigger: 'manual', slotDay: tomorrow() }, { deadline: far(), fetchImpl });
    expect(r.status).toBe('done');
    expect(count(db, 'SELECT COUNT(*) AS n FROM topics')).toBe(1);
  });
  it('save_topics と save_check の schema は公式の strict の制限の中（object は additionalProperties: false・数と長さの制約なし・union 16 以下・任意の項目 24 以下）', () => {
    let unions = 0;
    let optional = 0;
    const bad: string[] = [];
    const walk = (s: Record<string, unknown>, at: string) => {
      for (const k of ['minLength', 'maxLength', 'minimum', 'maximum', 'multipleOf', 'maxItems', 'pattern', 'oneOf', 'not', 'if']) if (k in s) bad.push(`${at}.${k}`);
      if ('minItems' in s && ![0, 1].includes(s.minItems as number)) bad.push(`${at}.minItems`);
      if (Array.isArray(s.type) || Array.isArray(s.anyOf)) unions++;
      if (s.type === 'object') {
        if (s.additionalProperties !== false) bad.push(`${at}.additionalProperties`);
        const props = (s.properties ?? {}) as Record<string, Record<string, unknown>>;
        const req = new Set((s.required ?? []) as string[]);
        for (const [k, v] of Object.entries(props)) {
          if (!req.has(k)) optional++;
          walk(v, `${at}.${k}`);
        }
      }
      if (s.items) walk(s.items as Record<string, unknown>, `${at}[]`);
      for (const a of (s.anyOf ?? []) as Array<Record<string, unknown>>) walk(a, `${at}|`);
    };
    walk({ type: 'object', additionalProperties: false, required: ['topics'], properties: { topics: { type: 'array', items: TOPIC_BODY_JSON_SCHEMA } } }, 'save_topics');
    walk(SAVE_CHECK_SCHEMA as unknown as Record<string, unknown>, 'save_check');
    expect(bad).toEqual([]);
    expect(unions).toBeLessThanOrEqual(16);
    expect(optional).toBeLessThanOrEqual(24);
  });
});
