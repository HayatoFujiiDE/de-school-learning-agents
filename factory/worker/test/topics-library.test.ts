// contract-T T-14 b13: 配信 API に子どもを表す引数・項目が無い（読むのは day / kind / limit だけ。応答の項目は決まった集合だけ）
import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import { libraryTopicStock, libraryTopics } from '../src/routes/library';
import { planDay } from '../src/topics/schedule';
import { addDays } from '../src/topics/schema';
import { enable, makeBody, migratedDb, newsBody, philoBody, seedTopic, setSetting, talkBody, tokyoToday, topicEnv } from './topics-helpers';

let db: DatabaseSync;
let env: Env;
const today = tokyoToday();
const get = async (f: (e: Env, u: URL) => Promise<Response>, q: string) => {
  const r = await f(env, new URL(`http://x/api/library/topics${q}`));
  return { status: r.status, cache: r.headers.get('cache-control'), json: (await r.json()) as Record<string, unknown> };
};

beforeEach(async () => {
  db = migratedDb();
  enable(db);
  env = topicEnv(db);
  await seedTopic(db, { id: 'tp_n_1', body: newsBody(today), status: 'ready', slotDay: today, sensitivity: 'heavy' });
  await seedTopic(db, { id: 'tp_t_1', body: talkBody(), status: 'ready' });
  await seedTopic(db, { id: 'tp_p_1', body: philoBody(), status: 'ready' });
  await seedTopic(db, { id: 'tp_m_1', body: makeBody(), status: 'held', holdReason: 'heavy' });
  await planDay(env, today);
});

describe('GET /api/library/topics', () => {
  it('応答の項目は { day, topics[{ topic_id, kind, pos, needs_supporter, lineage_id, body }] } だけ・no-store・重い話題は needs_supporter', async () => {
    const r = await get(libraryTopics, '');
    expect(r.status).toBe(200);
    expect(r.cache).toBe('no-store');
    expect(Object.keys(r.json).sort()).toEqual(['day', 'topics']);
    const topics = r.json.topics as Array<Record<string, unknown>>;
    for (const t of topics) expect(Object.keys(t).sort()).toEqual(['body', 'kind', 'lineage_id', 'needs_supporter', 'pos', 'topic_id']);
    expect(topics.map((t) => [t.topic_id, t.needs_supporter])).toEqual([
      ['tp_n_1', true],
      ['tp_t_1', false],
      ['tp_p_1', false],
    ]);
  });
  it('子どもを表す引数を足しても応答は変わらない（読まない）', async () => {
    const a = await get(libraryTopics, '');
    const b = await get(libraryTopics, '?child_id=c1&student=s1&classroom=r1&grade=3&name=x');
    expect(b).toEqual(a);
  });
  it('実在しない日付・今日より後は 400 / 入・切が切なら空', async () => {
    expect((await get(libraryTopics, '?day=2026-02-30')).status).toBe(400);
    expect((await get(libraryTopics, `?day=${addDays(today, 1)}`)).status).toBe(400);
    setSetting(db, 'topics_enabled', '0');
    expect((await get(libraryTopics, '')).json).toEqual({ day: today, topics: [] });
  });
});

describe('GET /api/library/topics/stock', () => {
  it('evergreen の ready を新しい順に（news・held は入らない）。項目は決まった集合だけ', async () => {
    const r = await get(libraryTopicStock, '/stock?kind=talk');
    expect(r.json).toEqual({ kind: 'talk', topics: [{ topic_id: 'tp_t_1', kind: 'talk', needs_supporter: false, lineage_id: 'tp_t_1', body: talkBody() }] });
    expect((await get(libraryTopicStock, '/stock?kind=news')).json).toEqual({ kind: 'news', topics: [] });
    expect((await get(libraryTopicStock, '/stock?kind=make')).json).toEqual({ kind: 'make', topics: [] });
    expect((await get(libraryTopicStock, '/stock?kind=talk&child_id=c1')).json).toEqual(r.json);
  });
  it('kind は 4 種のどれか、limit は 1〜50（範囲外は 400）', async () => {
    for (const q of ['', '?kind=quiz', '?kind=talk&limit=0', '?kind=talk&limit=51', '?kind=talk&limit=x']) expect((await get(libraryTopicStock, `/stock${q}`)).status).toBe(400);
    expect((await get(libraryTopicStock, '/stock?kind=talk&limit=50')).status).toBe(200);
  });
});

describe('配信のコードが読む引数', () => {
  it('お題の配信の関数が読む searchParams は day / kind / limit だけ', () => {
    const src = readFileSync(new URL('../src/routes/library.ts', import.meta.url), 'utf8');
    const part = src.slice(src.indexOf('// お題の配信'));
    expect(part.length).toBeGreaterThan(100);
    const keys = [...part.matchAll(/searchParams\.get\('([^']+)'\)/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(0);
    expect([...new Set(keys)].sort()).toEqual(['day', 'kind', 'limit']);
  });
});
