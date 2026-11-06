// §S-8 作り直しは前の版から始める（契約 docs/plans/retro/contract-S8-rework-from-previous.md §S-8-5）。
// node:sqlite の実 DB + R2 の Map + 台本どおりの stub port。前の版のファイルを resources で付ける条件・最初の文の区画・
// 取り込みの引き継ぎ（条件 1〜5・14 日・世代をまたぐ captured_at）・新しい版の取得記録・前の job の画像・運営画面の表示を確かめる。
import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import vm from 'node:vm';
import type { SessionCreateParams } from '@anthropic-ai/sdk/resources/beta/sessions/sessions';
import { beforeEach, describe, expect, it } from 'vitest';
import { PortError, type FactoryPort, type FileMeta, type Page } from '../src/anthropic';
import { CARRY_MAX_AGE_MS, applyCarry, carryRecordFor, checkCitations, reopenFreeUrls, type CarryRecord, type CitationSourceInput } from '../src/checks/citations';
import type { Env } from '../src/env';
import { createFakePort } from '../src/fake/anthropic';
import { grayPng } from '../src/fake/openai';
import { buildPhase1Message, reconcileJob, startJob } from '../src/jobs';
import { PREV_FILES_MAX, PREV_FILE_MAX_BYTES, PREV_MOUNT_DIR, carryRecordsOf, prevResources, prevSectionLines } from '../src/rework';
import { SOURCE_CAPTURES_FILE, loadSourceCaptures, type SourceCapturesFile } from '../src/verify';
import { d1, migratedDb, one, rows } from './d1-shim';
import { goodFiles, goodMaterial } from './helpers';

const DAY = 86_400_000;
const URL_A = 'https://minecraft.wiki/w/Redstone_Dust';
const URL_B = 'https://minecraft.wiki/w/Repeater';
const YT = 'dQw4w9WgXcQ';
const WATCH = `https://www.youtube.com/watch?v=${YT}`;
const PARENT_PREFIX = 'materials/m1/jp/';
const no = () => {
  throw new Error('not used in this test');
};
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

let db: DatabaseSync;
let r2: Map<string, Uint8Array>;
let env: Env;
const enc = new TextEncoder();

function makeEnv(): Env {
  return {
    DB: d1(db),
    R2: {
      async put(k: string, v: Uint8Array | string) {
        r2.set(k, typeof v === 'string' ? enc.encode(v) : new Uint8Array(v));
      },
      async get(k: string) {
        const b = r2.get(k);
        return b ? { body: b.slice(), arrayBuffer: async () => b.slice().buffer, text: async () => new TextDecoder().decode(b) } : null;
      },
      async list(o: { prefix?: string }) {
        return { objects: [...r2.keys()].filter((k) => k.startsWith(o.prefix ?? '')).sort().map((key) => ({ key })), truncated: false };
      },
      async delete(keys: string | string[]) {
        for (const k of Array.isArray(keys) ? keys : [keys]) r2.delete(k);
      },
    },
    FACTORY_AGENT_ID: 'agent_test',
    FACTORY_ENV_ID: 'env_test',
    DAILY_CAP_CENTS: '100000',
  } as unknown as Env;
}

beforeEach(() => {
  db = migratedDb();
  r2 = new Map();
  env = makeEnv();
});

// ---------------------------------------------------------------------------------------------
// 種

const PARENT_FILES = [
  { file_id: 'file_mat', filename: 'material.json', size: 2000 },
  { file_id: 'file_claims', filename: 'claims.json', size: 300 },
  { file_id: 'file_src', filename: 'sources.json', size: 400 },
  { file_id: 'file_adapt', filename: 'adapt-rules.md', size: 100 },
  { file_id: 'file_self', filename: 'selfcheck.md', size: 100 },
  { file_id: 'file_es', filename: 'elementary-short.md', size: 100 },
  { file_id: 'file_fig', filename: 'figure-1.svg', size: 100 },
];
const PUBLIC_PATHS = ['parts/p1/elementary-short.md', 'parts/p1/figure-1.svg'];

function seedMaterial(id = 'm1') {
  db.prepare(
    "INSERT OR IGNORE INTO materials (id, slug, title, kinds_json, work_status, publish_status, brief_md, created_at, updated_at) VALUES (?, ?, 't', '[3]', 'queued', 'none', 'b', ?, ?)",
  ).run(id, `slug-${id}`, iso(30 * DAY), iso(30 * DAY));
}

/** 親の版 vp（job jp）。files = 親の job の reconcile_state_json.files */
function seedParent(o: { material?: string; files?: unknown; createdAgo?: number; publicPaths?: string[]; material_json?: string; id?: string; job?: string } = {}) {
  const mat = o.material ?? 'm1';
  const job = o.job ?? 'jp';
  seedMaterial(mat);
  const at = iso(o.createdAgo ?? DAY);
  db.prepare(
    `INSERT INTO factory_jobs (id, material_id, kind, model, phase, status, session_id, brief_md, reconcile_stage, reconcile_state_json, created_at, updated_at)
     VALUES (?, ?, 'draft', 'claude-sonnet-5-5', 'making', 'done', ?, 'b', 'versioned', ?, ?, ?)`,
  ).run(job, mat, `sesn_${job}`, JSON.stringify({ files: o.files ?? PARENT_FILES, done: [] }), iso((o.createdAgo ?? DAY) + 3600_000), at);
  db.prepare(
    `INSERT INTO material_versions (id, material_id, version, job_id, session_id, r2_prefix, content_sha256, material_json, claims_json, adapt_rules_md,
       checks_json, public_paths_json, status, created_at)
     VALUES (?, ?, 1, ?, ?, ?, 'sha', ?, '{"claims":[]}', 'a', '{}', ?, 'rejected', ?)`,
  ).run(o.id ?? 'vp', mat, job, `sesn_${job}`, `materials/${mat}/${job}/`, o.material_json ?? JSON.stringify(goodMaterial()), JSON.stringify(o.publicPaths ?? PUBLIC_PATHS), at);
}

function seedParentSource(o: { id: string; url: string; excerpt: string | null; version?: string; is_primary?: number }) {
  db.prepare(
    `INSERT INTO sources (id, material_version_id, source_id, url, title, quoted_excerpt, license, is_primary, url_was_fetched, quote_found, check_detail)
     VALUES (?, ?, ?, ?, 't', ?, 'x', ?, 1, 1, 'ok')`,
  ).run(crypto.randomUUID(), o.version ?? 'vp', o.id, o.url, o.excerpt, o.is_primary ?? 1);
}

/** 親の版の R2 の sources.json（loadSourceCaptures が events から記録を作る時に読む） */
function putParentSourcesJson(prefix = PARENT_PREFIX) {
  r2.set(prefix + 'sources.json', enc.encode(JSON.stringify({ sources: [{ id: 's1', url: URL_A, quoted_excerpt: '15 blocks' }] })));
}

function putCaptures(prefix: string, file: SourceCapturesFile) {
  r2.set(prefix + SOURCE_CAPTURES_FILE, enc.encode(JSON.stringify(file)));
}
const capFile = (captures: SourceCapturesFile['captures'], missing: string[] = []): SourceCapturesFile => ({ v: 1, captures, missing, truncated: [] });
const cap = (source_id: string, url: string, text: string, extra: Record<string, string> = {}) => ({ source_id, url, chars: text.length, text, ...extra });

function seedRework(o: { id?: string; parent?: string | null; attempts?: number; status?: string; phase?: string; session?: string | null; createdAgo?: number } = {}) {
  seedMaterial('m1');
  const at = iso(o.createdAgo ?? 60_000);
  db.prepare(
    `INSERT INTO factory_jobs (id, material_id, kind, model, phase, status, session_id, parent_version_id, brief_md, create_attempts, created_at, updated_at)
     VALUES (?, 'm1', 'rework', 'claude-opus-5-5', ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    o.id ?? 'jr',
    o.phase ?? 'questions',
    o.status ?? 'queued',
    o.session === undefined ? null : o.session,
    o.parent === undefined ? 'vp' : o.parent,
    '# 注文\n本文\n\n## 差し戻し理由（v1）\n図を直す',
    o.attempts ?? 0,
    at,
    at,
  );
}

// ---------------------------------------------------------------------------------------------
// startJob の stub port（create の params を取る）

function startPort(o: { fail?: boolean; parentEvents?: unknown[] } = {}) {
  const calls: SessionCreateParams[] = [];
  const port = {
    isFake: true,
    async createSession(p: SessionCreateParams) {
      calls.push(p);
      if (o.fail) throw new PortError(true, 400, 'invalid_request');
      return { id: `sesn_new${calls.length}` };
    },
    retrieveSession: no,
    updateSessionBudget: no,
    listSessionsPage: no,
    async listEventsPage(): Promise<Page<unknown>> {
      if (!o.parentEvents) throw new Error('no events');
      return { data: o.parentEvents, next: null };
    },
    sendEvents: no,
    async archiveSession() {},
    listFilesPage: no,
    downloadFile: no,
    createMessage: no,
    createBatch: no,
    retrieveBatch: no,
    batchResults: no,
    listBatchesPage: no,
    xaiResponses: no,
  } as unknown as FactoryPort;
  return { port, calls };
}
const textOf = (p: SessionCreateParams) => ((p.initial_events?.[0] as { content: Array<{ text: string }> }).content[0].text);
const BRIEF = '# 注文\n本文\n\n## 差し戻し理由（v1）\n図を直す';

// ---------------------------------------------------------------------------------------------

describe('§S-8-1 付けるファイルの選び方（prevResources）', () => {
  it('最上位の 5 つと public_paths のファイル名だけ。画像・名前の形・大きさ・重複で落とす。最上位を先に', () => {
    const files = [
      { file_id: 'f_es', filename: 'elementary-short.md', size: 10 },
      { file_id: 'f_mat', filename: 'material.json', size: 10 },
      { file_id: 'f_other', filename: 'notes.md', size: 10 }, // public_paths に無い
      { file_id: 'f_png', filename: 'photo-1.png', size: 10 }, // 画像（public_paths にあっても渡さない）
      { file_id: 'f_webp', filename: 'photo-2.WEBP', size: 10 },
      { file_id: 'f_bad', filename: 'bad name.md', size: 10 }, // 名前の形
      { file_id: 'f_big', filename: 'claims.json', size: PREV_FILE_MAX_BYTES + 1 },
      { file_id: 'f_edge', filename: 'sources.json', size: PREV_FILE_MAX_BYTES }, // ちょうどは渡す
      { file_id: 'f_d1', filename: 'figure-1.svg', size: 10 },
      { file_id: 'f_d2', filename: 'figure-1.svg', size: 10 }, // 同じ名前が 2 つ → どちらも渡さない
      { file_id: 7, filename: 'selfcheck.md', size: 10 }, // file_id が文字列でない
      { file_id: 'f_nosize', filename: 'adapt-rules.md' }, // 大きさが分からない
    ];
    const pub = ['parts/p1/elementary-short.md', 'parts/p1/photo-1.png', 'parts/p1/photo-2.WEBP', 'parts/p1/bad name.md', 'parts/p1/figure-1.svg'];
    expect(prevResources(JSON.stringify({ files }), JSON.stringify(pub))).toEqual([
      { name: 'material.json', file_id: 'f_mat' },
      { name: 'sources.json', file_id: 'f_edge' },
      { name: 'elementary-short.md', file_id: 'f_es' },
    ]);
  });

  it('81 文字の名前は渡さない（80 文字は渡す）・最大 40 個', () => {
    const n80 = 'a'.repeat(77) + '.md';
    const n81 = 'a'.repeat(78) + '.md';
    expect(prevResources(JSON.stringify({ files: [{ file_id: 'x', filename: n80, size: 1 }, { file_id: 'y', filename: n81, size: 1 }] }), JSON.stringify([`p/${n80}`, `p/${n81}`]))).toEqual([
      { name: n80, file_id: 'x' },
    ]);
    const many = Array.from({ length: 50 }, (_, i) => ({ file_id: `f${i}`, filename: `x-${i}.md`, size: 1 }));
    const got = prevResources(JSON.stringify({ files: many }), JSON.stringify(many.map((f) => `parts/p1/${f.filename}`)));
    expect(got).toHaveLength(PREV_FILES_MAX);
    expect(got[0]).toEqual({ name: 'x-0.md', file_id: 'f0' });
  });

  it('files が無い・壊れた JSON・配列でない → 0 個', () => {
    expect(prevResources('{}', '[]')).toEqual([]);
    expect(prevResources('not json', '[]')).toEqual([]);
    expect(prevResources(JSON.stringify({ files: 'x' }), null)).toEqual([]);
    expect(prevResources(null, null)).toEqual([]);
  });
});

describe('§S-8-1 startJob: resources を付ける条件と最初の文の区画', () => {
  const expectPlain = async (p: SessionCreateParams, kinds = [3]) => {
    expect(p.resources).toBeUndefined();
    expect(textOf(p)).toBe(await buildPhase1Message(env.DB, BRIEF, kinds));
    expect(textOf(p).includes('# 前の版')).toBe(false);
  };

  it('rework・親あり・create_attempts=0 → 親の job の files を /mnt/session/uploads/prev/ に付け、最初の文に区画が入る（区画を除くと従来の文）', async () => {
    seedParent();
    seedParentSource({ id: 's1', url: URL_A, excerpt: '15 blocks' });
    putCaptures(PARENT_PREFIX, capFile([cap('s1', URL_A, 'signal travels 15 blocks along dust')]));
    seedRework();
    const s = startPort();
    expect((await startJob(env, s.port, 'jr')).status).toBe(201);
    expect(s.calls).toHaveLength(1);
    const p = s.calls[0];
    expect(p.resources).toEqual([
      { type: 'file', file_id: 'file_mat', mount_path: '/mnt/session/uploads/prev/material.json' },
      { type: 'file', file_id: 'file_claims', mount_path: '/mnt/session/uploads/prev/claims.json' },
      { type: 'file', file_id: 'file_src', mount_path: '/mnt/session/uploads/prev/sources.json' },
      { type: 'file', file_id: 'file_adapt', mount_path: '/mnt/session/uploads/prev/adapt-rules.md' },
      { type: 'file', file_id: 'file_self', mount_path: '/mnt/session/uploads/prev/selfcheck.md' },
      { type: 'file', file_id: 'file_es', mount_path: '/mnt/session/uploads/prev/elementary-short.md' },
      { type: 'file', file_id: 'file_fig', mount_path: '/mnt/session/uploads/prev/figure-1.svg' },
    ]);
    const text = textOf(p);
    const section = prevSectionLines(PARENT_FILES.map((f) => f.filename), [URL_A]);
    expect(section[0]).toBe('# 前の版（作り直しの出発点）');
    expect(text).toContain(`${BRIEF}\n\n# 前の版（作り直しの出発点）\n`);
    expect(text).toContain(PREV_MOUNT_DIR);
    expect(text).toContain('\n- material.json\n');
    expect(text).toContain(`## 開き直さなくてよい出典\n`);
    expect(text).toContain(`\n- ${URL_A}\n`);
    expect(text).toContain(section.join('\n') + '\n# 編集基準');
    expect(text.replace(section.join('\n') + '\n', '')).toBe(await buildPhase1Message(env.DB, BRIEF, [3]));
  });

  it('開き直さなくてよい出典が 0 件なら「ありません」（記録が R2 に無く親の events も読めない）', async () => {
    seedParent();
    seedParentSource({ id: 's1', url: URL_A, excerpt: '15 blocks' });
    seedRework();
    const s = startPort();
    await startJob(env, s.port, 'jr');
    expect(s.calls[0].resources).toHaveLength(7);
    expect(textOf(s.calls[0])).toContain('## 開き直さなくてよい出典\nurl と quoted_excerpt を前の版から一字も変えない時だけ');
    expect(textOf(s.calls[0])).toContain('\n- ありません\n');
  });

  it('R2 に記録が無ければ親の session の events から作り（R2 に書く）、一覧に入れる', async () => {
    seedParent();
    seedParentSource({ id: 's1', url: URL_A, excerpt: '15 blocks' });
    seedRework();
    putParentSourcesJson();
    const s = startPort({
      parentEvents: [
        { id: 'e1', type: 'agent.tool_use', name: 'web_fetch', input: { url: URL_A } },
        { id: 'e2', type: 'agent.tool_result', tool_use_id: 'e1', content: [{ type: 'text', text: 'signal travels 15 blocks' }] },
      ],
    });
    await startJob(env, s.port, 'jr');
    expect(textOf(s.calls[0])).toContain(`\n- ${URL_A}\n`);
    expect(r2.has(PARENT_PREFIX + SOURCE_CAPTURES_FILE)).toBe(true);
  });

  it.each([
    ['rework でない（draft）', () => (seedParent(), db.prepare("INSERT INTO factory_jobs (id, material_id, kind, model, phase, status, parent_version_id, brief_md, created_at, updated_at) VALUES ('jr', 'm1', 'draft', 'm', 'questions', 'queued', 'vp', ?, ?, ?)").run(BRIEF, iso(0), iso(0)))],
    ['親なし', () => seedRework({ parent: null })],
    ['create_attempts > 0', () => (seedParent(), seedRework({ attempts: 1 }))],
    ['親の job の files が 0 個', () => (seedParent({ files: [] }), seedRework())],
    ['親の job の files が読めない（壊れた JSON）', () => (seedParent(), db.prepare("UPDATE factory_jobs SET reconcile_state_json = '{oops' WHERE id = 'jp'").run(), seedRework())],
    ['付けられるファイルが無い（名前・大きさ・画像）', () => (seedParent({ files: [{ file_id: 'a', filename: 'x y.md', size: 1 }, { file_id: 'b', filename: 'material.json', size: PREV_FILE_MAX_BYTES + 1 }, { file_id: 'c', filename: 'p.png', size: 1 }], publicPaths: ['parts/p1/p.png'] }), seedRework())],
    ['親の版が別の素材', () => (seedParent({ material: 'm2', job: 'jq' }), seedRework())],
    ['親の版が無い', () => seedRework({ parent: 'v_none' })],
  ])('%s → resources なし・最初の文は従来のまま', async (_l, setup) => {
    setup();
    const s = startPort();
    expect((await startJob(env, s.port, 'jr')).status).toBe(201);
    await expectPlain(s.calls[0]);
  });

  it('最初の create が応答ありで失敗 → queued（create_attempts=1）。次の create は resources なし・区画なし', async () => {
    seedParent();
    seedRework();
    const bad = startPort({ fail: true });
    expect((await startJob(env, bad.port, 'jr')).status).toBe(502);
    expect(bad.calls[0].resources).toHaveLength(7);
    expect(one(db, "SELECT status, create_attempts FROM factory_jobs WHERE id = 'jr'")).toEqual({ status: 'queued', create_attempts: 1 });
    const good = startPort();
    expect((await startJob(env, good.port, 'jr')).status).toBe(201);
    await expectPlain(good.calls[0]);
  });

  it('fake の port は resources つきの create を受ける', async () => {
    const fake = createFakePort(env);
    const r = await fake.createSession({
      agent: 'agent_test',
      environment_id: 'env_test',
      metadata: { job_id: 'jx' },
      resources: [{ type: 'file', file_id: 'file_mat', mount_path: '/mnt/session/uploads/prev/material.json' }],
    } as SessionCreateParams);
    expect(r.id).toMatch(/^sesn_/);
  });
});

describe('§S-8-2 引き継ぎの判定（純関数）', () => {
  const NOW = Date.parse('2026-11-06T00:00:00.000Z');
  const at = (days: number) => new Date(NOW - days * DAY).toISOString();
  const src = (o: Partial<CitationSourceInput> = {}): CitationSourceInput => ({ id: 's1', url: URL_A, quoted_excerpt: '15 blocks', is_primary: true, ...o });
  const rec = (o: Partial<CarryRecord> = {}): CarryRecord => ({ url: URL_A, text: 'signal travels 15   blocks', captured_at: at(1), ...o });
  const run = (sources: CitationSourceInput[], records: CarryRecord[], events: unknown[] = [], videos: Array<{ source_id: string; youtube_id: string }> = []) =>
    applyCarry(checkCitations(sources, events, videos), sources, videos, records, NOW);

  it('条件 1〜5 を満たす行 → 1・1・carried。summary の fetched・quoted はこの session の数のまま、carried に件数', () => {
    const r = run([src()], [rec()]);
    expect(r.sources).toEqual([{ source_id: 's1', url_was_fetched: 1, quote_found: 1, check_detail: 'carried' }]);
    expect(r.summary).toEqual({ total: 1, fetched: 0, quoted: 0, carried: 1 });
  });

  it('一次でない行は 1・1 だが表示は secondary（carried に数える）', () => {
    const r = run([src({ is_primary: false })], [rec()]);
    expect(r.sources).toEqual([{ source_id: 's1', url_was_fetched: 1, quote_found: 1, check_detail: 'secondary' }]);
    expect(r.summary.carried).toBe(1);
  });

  it('条件 1: この session で開いた行（quote_not_found でも）は今のまま', () => {
    const events = [
      { id: 'u1', type: 'agent.tool_use', name: 'web_fetch', input: { url: URL_A } },
      { id: 'r1', type: 'agent.tool_result', tool_use_id: 'u1', content: [{ type: 'text', text: '別の本文' }] },
    ];
    const r = run([src()], [rec()], events);
    expect(r.sources).toEqual([{ source_id: 's1', url_was_fetched: 1, quote_found: 0, check_detail: 'quote_not_found' }]);
    expect(r.summary.carried).toBe(0);
  });

  it('条件 2: 動画の出典は引き継がない（記録があっても）', () => {
    const r = run([src({ id: 's9', url: WATCH, quoted_excerpt: 'x' })], [rec({ url: WATCH, text: 'x' })], [], [{ source_id: 's9', youtube_id: YT }]);
    expect(r.sources[0]).toEqual({ source_id: 's9', url_was_fetched: 0, quote_found: 0, check_detail: 'no_excerpt' });
    expect(r.summary.carried).toBe(0);
  });

  it.each([
    ['条件 3: 記録が無い', [] as CarryRecord[]],
    ['条件 3: URL が違う（部分一致にしない）', [rec({ url: URL_A + '_extra' })]],
    ['条件 3: text が空（空白だけ）', [rec({ text: '   ' })]],
    ['条件 4: 最初に取った時刻から 14 日を過ぎた', [rec({ captured_at: new Date(NOW - CARRY_MAX_AGE_MS - 1).toISOString() })]],
    ['条件 4: 時刻が読めない', [rec({ captured_at: 'yesterday' })]],
    ['条件 4: 時刻が未来すぎる', [rec({ captured_at: new Date(NOW + DAY).toISOString() })]],
    ['条件 5: 引用が記録に無い', [rec({ text: 'signal travels 16 blocks' })]],
  ])('%s → not_fetched のまま', (_l, records) => {
    const r = run([src()], records);
    expect(r.sources).toEqual([{ source_id: 's1', url_was_fetched: 0, quote_found: 0, check_detail: 'not_fetched' }]);
    expect(r.summary.carried).toBe(0);
  });

  it('条件 5: 引用が空なら引き継がない', () => {
    const r = run([src({ quoted_excerpt: '' })], [rec()]);
    expect(r.sources[0]).toMatchObject({ url_was_fetched: 0, check_detail: 'not_fetched' });
  });

  it('14 日ちょうどは引き継ぐ。URL は normalizeUrl（http・末尾 /・#・host の大文字）で一致', () => {
    expect(run([src()], [rec({ captured_at: new Date(NOW - CARRY_MAX_AGE_MS).toISOString() })]).summary.carried).toBe(1);
    expect(run([src({ url: 'http://Minecraft.wiki/w/Redstone_Dust/#top' })], [rec()]).summary.carried).toBe(1);
  });

  it('世代をまたぐ captured_at: 記録に captured_at があればそれを使い（親の created_at ではない）、無ければ親の created_at', () => {
    const parentCreated = at(1);
    const file = capFile([cap('s1', URL_A, '15 blocks', { captured_at: at(15), carried_from: 'v_grand' }), cap('s2', URL_B, 'repeater delays')]);
    const records = carryRecordsOf(file, parentCreated);
    expect(records).toEqual([
      { url: URL_A, text: '15 blocks', captured_at: at(15) },
      { url: URL_B, text: 'repeater delays', captured_at: parentCreated },
    ]);
    // 祖父の版で 15 日前に取った記録は、親の版が昨日できていても引き継がない
    expect(carryRecordFor({ url: URL_A, quoted_excerpt: '15 blocks' }, records, NOW)).toBeNull();
    expect(carryRecordFor({ url: URL_B, quoted_excerpt: 'repeater' }, records, NOW)).not.toBeNull();
    // 13 日前なら引き継ぐ
    expect(carryRecordFor({ url: URL_A, quoted_excerpt: '15 blocks' }, carryRecordsOf(capFile([cap('s1', URL_A, '15 blocks', { captured_at: at(13) })]), parentCreated), NOW)).not.toBeNull();
  });

  it('開き直さなくてよい出典: 条件 2〜5 を満たす親の出典の URL（重複除く・30 件まで・http(s) だけ）', () => {
    const sources = [
      { id: 's1', url: URL_A, quoted_excerpt: '15 blocks' },
      { id: 's1b', url: URL_A + '/', quoted_excerpt: '15 blocks' }, // 重複（normalizeUrl で同じ）
      { id: 's2', url: URL_B, quoted_excerpt: 'delays' }, // 記録が古い
      { id: 's9', url: WATCH, quoted_excerpt: 'x' }, // 動画
      { id: 's3', url: 'javascript:alert(1)', quoted_excerpt: 'x' },
    ];
    const records = [rec(), rec({ url: URL_B, text: 'repeater delays', captured_at: at(20) }), rec({ url: WATCH, text: 'x' }), rec({ url: 'javascript:alert(1)', text: 'x' })];
    expect(reopenFreeUrls(sources, [{ source_id: 's9', youtube_id: YT }], records, NOW)).toEqual([URL_A]);
    const many = Array.from({ length: 40 }, (_, i) => ({ id: `s${i}`, url: `${URL_A}_${i}`, quoted_excerpt: 'q' }));
    expect(reopenFreeUrls(many, [], many.map((s) => rec({ url: s.url, text: 'q' })), NOW)).toHaveLength(30);
  });
});

// ---------------------------------------------------------------------------------------------
// 取り込み（reconcileJob → ingest）

const DONE_EVENTS = [
  { id: 'sevt_1', type: 'user.define_outcome' },
  { id: 'sevt_2', type: 'span.outcome_evaluation_end', result: 'satisfied', explanation: 'ok' },
  { id: 'sevt_3', type: 'session.status_idle', stop_reason: { type: 'end_turn' } },
];

function ingestPort(outputs: Map<string, Uint8Array>, o: { events?: unknown[]; parentEvents?: unknown[] } = {}) {
  const metas: FileMeta[] = [...outputs.keys()].map((p, i) => ({
    id: `file_${i}`,
    filename: p.slice(p.lastIndexOf('/') + 1),
    size_bytes: outputs.get(p)!.byteLength,
    created_at: new Date(Date.now() - 1000 + i).toISOString(),
  }));
  const bodies = new Map(metas.map((m, i) => [m.id, [...outputs.values()][i]]));
  const parentReads: string[] = [];
  const port = {
    isFake: true,
    createSession: no,
    async retrieveSession(id: string) {
      return { id, status: 'idle', listCostCents: null, metadata: {}, created_at: iso(0) };
    },
    updateSessionBudget: no,
    listSessionsPage: no,
    async listEventsPage(id: string, q: { order: 'asc' | 'desc' }): Promise<Page<unknown>> {
      if (id === 'sesn_jp') {
        parentReads.push(id);
        if (!o.parentEvents) throw new Error('no parent events');
        return { data: o.parentEvents, next: null };
      }
      const evs = [...(o.events ?? []), ...DONE_EVENTS];
      return { data: q.order === 'desc' ? [...evs].reverse() : evs, next: null };
    },
    async sendEvents() {},
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
  return { port, parentReads };
}

const srcRows = (job = 'jr') =>
  rows(db, 'SELECT s.source_id, s.url_was_fetched, s.quote_found, s.check_detail FROM sources s JOIN material_versions v ON v.id = s.material_version_id WHERE v.job_id = ? ORDER BY s.source_id', job);
const citationsOf = (job = 'jr') => JSON.parse(String(one(db, 'SELECT checks_json FROM material_versions WHERE job_id = ?', job).checks_json)).citations;
const rec = (job = 'jr', deadlineMs = 25_000, port?: FactoryPort) => reconcileJob(env, port!, job, { deadline: Date.now() + deadlineMs });

/** sources.json を 2 行（s1 = URL_A '15 blocks'・s2 = URL_B 'delays'）に */
function outputs2(material: Record<string, unknown> = goodMaterial()) {
  const files = goodFiles(material);
  files.set(
    'sources.json',
    enc.encode(
      JSON.stringify({
        sources: [
          { id: 's1', url: URL_A, title: 'Redstone Dust', accessed_at: '2026-11-04', quoted_excerpt: '15 blocks', license: 'CC BY-NC-SA 3.0', is_primary: true },
          { id: 's2', url: URL_B, title: 'Repeater', accessed_at: '2026-11-04', quoted_excerpt: 'delays', license: 'CC BY-NC-SA 3.0', is_primary: false },
        ],
      }),
    ),
  );
  return files;
}

describe('§S-8-2 取り込みの引き継ぎ（jobs.ts → citations）', () => {
  const seedRunning = () => {
    seedParent();
    seedRework({ status: 'running', phase: 'making', session: 'sesn_jr' });
  };

  it('rework: この session で開いていない出典を親の記録で確かめたことにする（carried・secondary）。checks_json の citations に carried', async () => {
    seedRunning();
    putCaptures(PARENT_PREFIX, capFile([cap('s1', URL_A, 'signal travels 15 blocks'), cap('s2', URL_B, 'repeater delays signals')]));
    const p = ingestPort(outputs2());
    expect(await rec('jr', 25_000, p.port)).toBe('versioned');
    expect(srcRows()).toEqual([
      { source_id: 's1', url_was_fetched: 1, quote_found: 1, check_detail: 'carried' },
      { source_id: 's2', url_was_fetched: 1, quote_found: 1, check_detail: 'secondary' },
    ]);
    expect(citationsOf()).toEqual({ total: 2, fetched: 0, quoted: 0, carried: 2 });
    expect(p.parentReads).toEqual([]); // R2 に記録があれば親の events は読まない
  });

  it('draft（親なし）は従来どおり: not_fetched・citations に carried が無い', async () => {
    seedParent();
    db.prepare(
      `INSERT INTO factory_jobs (id, material_id, kind, model, phase, status, session_id, brief_md, created_at, updated_at)
       VALUES ('jd', 'm1', 'draft', 'claude-sonnet-5-5', 'making', 'running', 'sesn_jd', 'b', ?, ?)`,
    ).run(iso(0), iso(0));
    putCaptures(PARENT_PREFIX, capFile([cap('s1', URL_A, 'signal travels 15 blocks')]));
    expect(await rec('jd', 25_000, ingestPort(outputs2()).port)).toBe('versioned');
    expect(srcRows('jd')).toEqual([
      { source_id: 's1', url_was_fetched: 0, quote_found: 0, check_detail: 'not_fetched' },
      { source_id: 's2', url_was_fetched: 0, quote_found: 0, check_detail: 'secondary' },
    ]);
    expect(citationsOf('jd')).toEqual({ total: 2, fetched: 0, quoted: 0 });
  });

  it('引用を変えた行・14 日を過ぎた記録の行は引き継がない', async () => {
    seedRunning();
    putCaptures(PARENT_PREFIX, capFile([cap('s1', URL_A, 'signal travels 16 blocks'), cap('s2', URL_B, 'repeater delays', { captured_at: iso(15 * DAY) })]));
    expect(await rec('jr', 25_000, ingestPort(outputs2()).port)).toBe('versioned');
    expect(srcRows()).toEqual([
      { source_id: 's1', url_was_fetched: 0, quote_found: 0, check_detail: 'not_fetched' },
      { source_id: 's2', url_was_fetched: 0, quote_found: 0, check_detail: 'secondary' },
    ]);
    expect(citationsOf()).toEqual({ total: 2, fetched: 0, quoted: 0, carried: 0 });
  });

  it('記録に captured_at が無ければ親の版の created_at で 14 日を数える（親が 15 日前の版なら引き継がない）', async () => {
    seedParent({ createdAgo: 15 * DAY });
    seedRework({ status: 'running', phase: 'making', session: 'sesn_jr' });
    putCaptures(PARENT_PREFIX, capFile([cap('s1', URL_A, 'signal travels 15 blocks')]));
    expect(await rec('jr', 25_000, ingestPort(outputs2()).port)).toBe('versioned');
    expect(srcRows()[0]).toEqual({ source_id: 's1', url_was_fetched: 0, quote_found: 0, check_detail: 'not_fetched' });
  });

  it('親の版が別の素材のもの → 引き継がない（その版の記録を読まない）', async () => {
    seedParent({ material: 'm2', job: 'jq', id: 'vq' });
    seedRework({ status: 'running', phase: 'making', session: 'sesn_jr', parent: 'vq' });
    putCaptures('materials/m2/jq/', capFile([cap('s1', URL_A, 'signal travels 15 blocks')]));
    expect(await rec('jr', 25_000, ingestPort(outputs2()).port)).toBe('versioned');
    expect(srcRows()[0]).toMatchObject({ url_was_fetched: 0, check_detail: 'not_fetched' });
  });

  it('R2 に親の記録が無ければ引き継がない（取り込みは親の events を読まず、親の記録を書かない。citations に carried の項目も付けない）', async () => {
    seedRunning();
    const parentEvents = [
      { id: 'e1', type: 'agent.tool_use', name: 'web_fetch', input: { url: URL_A } },
      { id: 'e2', type: 'agent.tool_result', tool_use_id: 'e1', content: [{ type: 'text', text: 'signal travels 15 blocks' }] },
    ];
    putParentSourcesJson();
    const p = ingestPort(outputs2(), { parentEvents });
    expect(await rec('jr', 25_000, p.port)).toBe('versioned');
    expect(p.parentReads).toEqual([]);
    expect(srcRows()[0]).toEqual({ source_id: 's1', url_was_fetched: 0, quote_found: 0, check_detail: 'not_fetched' });
    expect(r2.has(PARENT_PREFIX + SOURCE_CAPTURES_FILE)).toBe(false);
    const checks = JSON.parse(String(one(db, "SELECT checks_json FROM material_versions WHERE job_id = 'jr'").checks_json));
    expect(checks.citations).toEqual({ total: 2, fetched: 0, quoted: 0 });
    expect('carried' in checks.citations).toBe(false);
  });

  it('親の記録が壊れている（形が違う）→ 引き継がず、carried の項目も付けない', async () => {
    seedRunning();
    r2.set(PARENT_PREFIX + SOURCE_CAPTURES_FILE, enc.encode('{"v":2}'));
    expect(await rec('jr', 25_000, ingestPort(outputs2()).port)).toBe('versioned');
    expect(srcRows()[0]).toMatchObject({ url_was_fetched: 0, check_detail: 'not_fetched' });
    expect(citationsOf()).toEqual({ total: 2, fetched: 0, quoted: 0 });
  });

  it('startJob が親の events から親の記録を作った後の取り込みでは引き継げる', async () => {
    seedParent();
    seedParentSource({ id: 's1', url: URL_A, excerpt: '15 blocks' });
    seedRework();
    putParentSourcesJson();
    const parentEvents = [
      { id: 'e1', type: 'agent.tool_use', name: 'web_fetch', input: { url: URL_A } },
      { id: 'e2', type: 'agent.tool_result', tool_use_id: 'e1', content: [{ type: 'text', text: 'signal travels 15 blocks' }] },
    ];
    const s = startPort({ parentEvents });
    expect((await startJob(env, s.port, 'jr')).status).toBe(201);
    expect(r2.has(PARENT_PREFIX + SOURCE_CAPTURES_FILE)).toBe(true);
    // session が動き出して制作まで進んだ形にする（作られた session id は sesn_new1）
    db.prepare("UPDATE factory_jobs SET phase = 'making', status = 'running' WHERE id = 'jr'").run();
    const p = ingestPort(outputs2());
    expect(await rec('jr', 25_000, p.port)).toBe('versioned');
    expect(p.parentReads).toEqual([]);
    expect(srcRows()[0]).toEqual({ source_id: 's1', url_was_fetched: 1, quote_found: 1, check_detail: 'carried' });
    expect(citationsOf()).toEqual({ total: 2, fetched: 0, quoted: 0, carried: 1 });
  });

  it('読み始める時間が残っていなければ版を書かずに次の reconcile へ回し、次で引き継ぐ', async () => {
    seedRunning();
    putCaptures(PARENT_PREFIX, capFile([cap('s1', URL_A, 'signal travels 15 blocks')]));
    const p = ingestPort(outputs2());
    expect(await rec('jr', 12_000, p.port)).toBe('deferred');
    expect(one(db, "SELECT COUNT(*) AS n FROM material_versions WHERE job_id = 'jr'").n).toBe(0);
    expect(await rec('jr', 25_000, p.port)).toBe('versioned');
    expect(srcRows()[0]).toMatchObject({ check_detail: 'carried' });
  });
});

describe('§S-8-2 新しい版の取得記録に carried の行を写す（loadSourceCaptures）', () => {
  it('この session の記録が無い出典を親の記録から写す（captured_at は元の値・無ければ親の created_at。carried_from = 親の版）。一次でない（secondary）行も写す（裁定 4）', async () => {
    seedParent();
    seedRework({ status: 'running', phase: 'making', session: 'sesn_jr' });
    const grand = iso(10 * DAY);
    putCaptures(PARENT_PREFIX, capFile([cap('s1', URL_A, 'signal travels 15 blocks', { captured_at: grand, carried_from: 'v_grand' }), cap('s2', URL_B, 'repeater delays')]));
    expect(await rec('jr', 25_000, ingestPort(outputs2()).port)).toBe('versioned');
    const v = one(db, "SELECT id, material_id, r2_prefix, claims_json FROM material_versions WHERE job_id = 'jr'") as { id: string; material_id: string; r2_prefix: string; claims_json: string };
    const file = await loadSourceCaptures(env, ingestPort(new Map()).port, v, { deadline: Date.now() + 20_000 });
    const parentCreated = String(one(db, "SELECT created_at FROM material_versions WHERE id = 'vp'").created_at);
    expect(file.captures).toEqual([
      { source_id: 's1', url: URL_A, chars: 24, text: 'signal travels 15 blocks', captured_at: grand, carried_from: 'vp' },
      { source_id: 's2', url: URL_B, chars: 15, text: 'repeater delays', captured_at: parentCreated, carried_from: 'vp' },
    ]);
    expect(file.missing).toEqual([]);
    // R2 に書いた記録を読み直しても captured_at・carried_from が残る（次の世代の 14 日の起点）
    const again = await loadSourceCaptures(env, ingestPort(new Map()).port, v, { deadline: Date.now() + 20_000 });
    expect(again.captures[0]).toMatchObject({ captured_at: grand, carried_from: 'vp' });
  });

  it('親の記録に captured_at が無い行は親の版の created_at を入れる', async () => {
    seedParent();
    seedRework({ status: 'running', phase: 'making', session: 'sesn_jr' });
    putCaptures(PARENT_PREFIX, capFile([cap('s1', URL_A, 'signal travels 15 blocks')]));
    expect(await rec('jr', 25_000, ingestPort(outputs2()).port)).toBe('versioned');
    const v = one(db, "SELECT id, material_id, r2_prefix, claims_json FROM material_versions WHERE job_id = 'jr'") as { id: string; material_id: string; r2_prefix: string; claims_json: string };
    const parentCreated = String(one(db, "SELECT created_at FROM material_versions WHERE id = 'vp'").created_at);
    const file = await loadSourceCaptures(env, ingestPort(new Map()).port, v, { deadline: Date.now() + 20_000 });
    expect(file.captures).toEqual([{ source_id: 's1', url: URL_A, chars: 24, text: 'signal travels 15 blocks', captured_at: parentCreated, carried_from: 'vp' }]);
  });
});

describe('§S-8-3 前の job の画像を使い続ける', () => {
  const IMG = `img_${'b'.repeat(32)}`;
  const PNG = grayPng(1, 1);
  const sha = async (b: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))].map((x) => x.toString(16).padStart(2, '0')).join('');
  async function seedImage(job: string) {
    const key = `img/${job}/${IMG}/tok.png`;
    r2.set(key, PNG);
    db.prepare(
      `INSERT INTO image_requests (id, custom_tool_use_id, job_id, session_id, model, size, quality, format, background, u_cents, input_json, state,
         enqueue_count, dispatched_at, r2_key, sha256, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'gpt-image-2.5-flare', '1024x1024', 'high', 'png', 'opaque', 10, '{}', 'done', 1, ?, ?, ?, ?, ?)`,
    ).run(IMG, `tu_${job}`, job, `sesn_${job}`, iso(DAY), key, await sha(PNG), iso(DAY), iso(DAY));
  }
  const withImage = () => {
    const m = goodMaterial();
    (m.parts as Array<Record<string, unknown>>)[0].files = [
      { path: 'parts/p1/figure-1.svg', role: 'figure' },
      { path: 'parts/p1/photo-1.png', role: 'figure', image_id: IMG, alt: '赤い粉' },
    ];
    return goodFiles(m);
  };

  it('同じ素材の前の job（親の版の job）が作った画像の image_id を受け付け、この版の R2 に写す', async () => {
    seedParent();
    seedRework({ status: 'running', phase: 'making', session: 'sesn_jr' });
    await seedImage('jp');
    expect(await rec('jr', 25_000, ingestPort(withImage()).port)).toBe('versioned');
    expect(r2.get('materials/m1/jr/parts/p1/photo-1.png')).toEqual(PNG);
    expect(JSON.parse(String(one(db, "SELECT public_paths_json FROM material_versions WHERE job_id = 'jr'").public_paths_json))).toContain('parts/p1/photo-1.png');
  });

  it('別の素材の job の画像は今までどおり拒む（bad_image_ref）', async () => {
    seedParent({ material: 'm2', job: 'jq', id: 'vq' });
    seedParent();
    seedRework({ status: 'running', phase: 'making', session: 'sesn_jr' });
    await seedImage('jq');
    expect(await rec('jr', 25_000, ingestPort(withImage()).port)).toBe('failed:invalid_outputs');
    expect(one(db, "SELECT last_error FROM factory_jobs WHERE id = 'jr'").last_error).toBe('bad_image_ref:parts/p1/photo-1.png');
  });

  it('同じ素材でも、この job より後の job の画像は拒む', async () => {
    seedParent();
    seedRework({ status: 'running', phase: 'making', session: 'sesn_jr', createdAgo: 2 * DAY });
    await seedImage('jp'); // jp は 1 日前 + 1 時間に作られた job（jr は 2 日前）
    expect(await rec('jr', 25_000, ingestPort(withImage()).port)).toBe('failed:invalid_outputs');
  });
});

describe('§S-8-3 裁定 1・2: 画像の枚数と、掃除された画像', () => {
  const PNG = grayPng(1, 1);
  const sha = async (b: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))].map((x) => x.toString(16).padStart(2, '0')).join('');
  const imgId = (job: string, i: number) => `img_${(job === 'jp' ? 'a' : job === 'jr' ? 'c' : 'e').repeat(28)}${String(i).padStart(4, '0')}`;
  async function seedImg(job: string, i: number, o: { inR2?: boolean } = {}) {
    const id = imgId(job, i);
    const key = `img/${job}/${id}/tok.png`;
    if (o.inR2 !== false) r2.set(key, PNG);
    db.prepare(
      `INSERT INTO image_requests (id, custom_tool_use_id, job_id, session_id, model, size, quality, format, background, u_cents, input_json, state,
         enqueue_count, dispatched_at, r2_key, sha256, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'gpt-image-2.5-flare', '1024x1024', 'high', 'png', 'opaque', 10, '{}', 'done', 1, ?, ?, ?, ?, ?)`,
    ).run(id, `tu_${id}`, job, `sesn_${job}`, iso(DAY), key, await sha(PNG), iso(DAY), iso(DAY));
    return id;
  }
  const materialWith = (refs: Array<{ path: string; image_id: string }>) => {
    const m = goodMaterial();
    (m.parts as Array<Record<string, unknown>>)[0].files = [{ path: 'parts/p1/figure-1.svg', role: 'figure' }, ...refs.map((r) => ({ ...r, role: 'figure', alt: '絵' }))];
    return m;
  };
  const lastError = (job = 'jr') => one(db, 'SELECT last_error FROM factory_jobs WHERE id = ?', job).last_error;
  const seedRunning = () => {
    seedParent();
    seedRework({ status: 'running', phase: 'making', session: 'sesn_jr' });
  };

  it('この job の画像の 9 枚目は弾く（8 枚までは通る）', async () => {
    seedRunning();
    const refs = [];
    for (let i = 0; i < 9; i++) refs.push({ path: `parts/p1/own-${i}.png`, image_id: await seedImg('jr', i) });
    expect(await rec('jr', 25_000, ingestPort(goodFiles(materialWith(refs))).port)).toBe('failed:invalid_outputs');
    expect(lastError()).toBe('bad_image_ref:parts/p1/own-8.png');
  });

  it('前の job の 8 枚 + この job の 3 枚は通る', async () => {
    seedRunning();
    const refs = [];
    for (let i = 0; i < 8; i++) refs.push({ path: `parts/p1/prev-${i}.png`, image_id: await seedImg('jp', i) });
    for (let i = 0; i < 3; i++) refs.push({ path: `parts/p1/own-${i}.png`, image_id: await seedImg('jr', i) });
    expect(await rec('jr', 25_000, ingestPort(goodFiles(materialWith(refs))).port)).toBe('versioned');
    expect(r2.get('materials/m1/jr/parts/p1/prev-7.png')).toEqual(PNG);
    expect(r2.get('materials/m1/jr/parts/p1/own-2.png')).toEqual(PNG);
  });

  it('前の job の 9 枚 + この job の 8 枚（合計 17）は弾く。R2 の画像を読まない', async () => {
    seedRunning();
    const refs = [];
    for (let i = 0; i < 9; i++) refs.push({ path: `parts/p1/prev-${i}.png`, image_id: await seedImg('jp', i) });
    for (let i = 0; i < 8; i++) refs.push({ path: `parts/p1/own-${i}.png`, image_id: await seedImg('jr', i) });
    for (const k of [...r2.keys()]) if (k.startsWith('img/')) r2.delete(k);
    expect(await rec('jr', 25_000, ingestPort(goodFiles(materialWith(refs))).port)).toBe('failed:invalid_outputs');
    expect(lastError()).toBe('bad_image_ref:parts/p1/own-7.png');
  });

  it('draft（前の job の画像なし）は従来どおり: 異なる image_id の 9 枚目で弾く', async () => {
    seedParent();
    db.prepare(
      `INSERT INTO factory_jobs (id, material_id, kind, model, phase, status, session_id, brief_md, created_at, updated_at)
       VALUES ('jd', 'm1', 'draft', 'claude-sonnet-5-5', 'making', 'running', 'sesn_jd', 'b', ?, ?)`,
    ).run(iso(0), iso(0));
    const refs = [];
    for (let i = 0; i < 9; i++) refs.push({ path: `parts/p1/own-${i}.png`, image_id: await seedImg('jd', i) });
    expect(await rec('jd', 25_000, ingestPort(goodFiles(materialWith(refs))).port)).toBe('failed:invalid_outputs');
    expect(lastError('jd')).toBe('bad_image_ref:parts/p1/own-8.png');
  });

  it('draft は同じ素材の前の job の画像があっても弾く（前の job の画像を受け付けるのは作り直しだけ）', async () => {
    seedParent();
    db.prepare(
      `INSERT INTO factory_jobs (id, material_id, kind, model, phase, status, session_id, parent_version_id, brief_md, created_at, updated_at)
       VALUES ('jd', 'm1', 'draft', 'claude-sonnet-5-5', 'making', 'running', 'sesn_jd', 'vp', 'b', ?, ?)`,
    ).run(iso(0), iso(0));
    const id = await seedImg('jp', 0);
    expect(await rec('jd', 25_000, ingestPort(goodFiles(materialWith([{ path: 'parts/p1/photo-1.png', image_id: id }]))).port)).toBe('failed:invalid_outputs');
    expect(lastError('jd')).toBe('bad_image_ref:parts/p1/photo-1.png');
    expect(r2.has('materials/m1/jd/parts/p1/photo-1.png')).toBe(false);
  });

  /** 親の版 vp の material.json と R2 に、前の job（jp）の画像の行とファイルを置く */
  function seedParentWithImage(o: { pathImageId?: string; material?: string; job?: string; id?: string; put?: boolean } = {}) {
    const id = imgId('jp', 0);
    const m = materialWith([{ path: 'parts/p1/photo-1.png', image_id: o.pathImageId ?? id }]);
    seedParent({ material_json: JSON.stringify(m), material: o.material, job: o.job, id: o.id });
    if (o.put !== false) r2.set(`materials/${o.material ?? 'm1'}/${o.job ?? 'jp'}/parts/p1/photo-1.png`, PNG);
    return id;
  }

  it('元の画像が掃除されていても、親の版の R2 の同じ path にあり、親の行が同じ image_id を指せば、親の版から写す', async () => {
    const id = seedParentWithImage();
    seedRework({ status: 'running', phase: 'making', session: 'sesn_jr' });
    await seedImg('jp', 0, { inR2: false });
    expect(await rec('jr', 25_000, ingestPort(goodFiles(materialWith([{ path: 'parts/p1/photo-1.png', image_id: id }]))).port)).toBe('versioned');
    expect(r2.get('materials/m1/jr/parts/p1/photo-1.png')).toEqual(PNG);
  });

  it('親の版の行が別の image_id を指す → bad_image_ref', async () => {
    seedParentWithImage({ pathImageId: imgId('jp', 5) });
    seedRework({ status: 'running', phase: 'making', session: 'sesn_jr' });
    const id = await seedImg('jp', 0, { inR2: false });
    expect(await rec('jr', 25_000, ingestPort(goodFiles(materialWith([{ path: 'parts/p1/photo-1.png', image_id: id }]))).port)).toBe('failed:invalid_outputs');
    expect(lastError()).toBe('bad_image_ref:parts/p1/photo-1.png');
  });

  it('親の版の R2 に同じ path が無い → bad_image_ref', async () => {
    const id = seedParentWithImage({ put: false });
    seedRework({ status: 'running', phase: 'making', session: 'sesn_jr' });
    await seedImg('jp', 0, { inR2: false });
    expect(await rec('jr', 25_000, ingestPort(goodFiles(materialWith([{ path: 'parts/p1/photo-1.png', image_id: id }]))).port)).toBe('failed:invalid_outputs');
  });

  it('親の版が別の素材のもの → 読まずに bad_image_ref', async () => {
    seedParent(); // jp（m1）が画像を作った job
    const id = imgId('jp', 0);
    seedParentWithImage({ material: 'm2', job: 'jq', id: 'vq' });
    seedRework({ status: 'running', phase: 'making', session: 'sesn_jr', parent: 'vq' });
    await seedImg('jp', 0, { inR2: false });
    expect(await rec('jr', 25_000, ingestPort(goodFiles(materialWith([{ path: 'parts/p1/photo-1.png', image_id: id }]))).port)).toBe('failed:invalid_outputs');
    expect(lastError()).toBe('bad_image_ref:parts/p1/photo-1.png');
    expect(r2.has('materials/m1/jr/parts/p1/photo-1.png')).toBe(false);
  });
});

describe('§S-8-2 裁定 4: 取得記録を写す条件（check_detail に関係なく・14 日・世代をまたぐ）', () => {
  type V = { id: string; material_id: string; r2_prefix: string; claims_json: string };
  const versionOf = (job: string) => one(db, 'SELECT id, material_id, r2_prefix, claims_json FROM material_versions WHERE job_id = ?', job) as V;
  const loadCaps = (v: V) => loadSourceCaptures(env, ingestPort(new Map()).port, v, { deadline: Date.now() + 20_000 });

  it('一次でない出典が 2 世代先まで引き継げる（captured_at は最初の版の時刻のまま・carried_from は直前の版）', async () => {
    seedParent();
    seedRework({ status: 'running', phase: 'making', session: 'sesn_jr', createdAgo: 120_000 });
    putCaptures(PARENT_PREFIX, capFile([cap('s2', URL_B, 'repeater delays signals')]));
    expect(await rec('jr', 25_000, ingestPort(outputs2()).port)).toBe('versioned');
    expect(srcRows('jr')[1]).toEqual({ source_id: 's2', url_was_fetched: 1, quote_found: 1, check_detail: 'secondary' });
    const v1 = versionOf('jr');
    const parentCreated = String(one(db, "SELECT created_at FROM material_versions WHERE id = 'vp'").created_at);
    const f1 = await loadCaps(v1); // 世代 1 の記録を作って R2 に書く（検証係の取得記録と同じ）
    expect(f1.captures.find((c) => c.source_id === 's2')).toMatchObject({ captured_at: parentCreated, carried_from: 'vp' });
    // 世代 2: 世代 1 の版から作り直す
    seedRework({ id: 'jr2', status: 'running', phase: 'making', session: 'sesn_jr2', parent: v1.id, createdAgo: 30_000 });
    expect(await rec('jr2', 25_000, ingestPort(outputs2()).port)).toBe('versioned');
    expect(srcRows('jr2')[1]).toEqual({ source_id: 's2', url_was_fetched: 1, quote_found: 1, check_detail: 'secondary' });
    const f2 = await loadCaps(versionOf('jr2'));
    expect(f2.captures.find((c) => c.source_id === 's2')).toEqual({ source_id: 's2', url: URL_B, chars: 23, text: 'repeater delays signals', captured_at: parentCreated, carried_from: v1.id });
  });

  it('最初に取った時刻から 15 日目の記録は写さない（14 日以内は写す）', async () => {
    seedParent();
    seedRework({ status: 'running', phase: 'making', session: 'sesn_jr' });
    putCaptures(PARENT_PREFIX, capFile([cap('s1', URL_A, 'signal travels 15 blocks', { captured_at: iso(13 * DAY) }), cap('s2', URL_B, 'repeater delays', { captured_at: iso(15 * DAY) })]));
    expect(await rec('jr', 25_000, ingestPort(outputs2()).port)).toBe('versioned');
    const f = await loadCaps(versionOf('jr'));
    expect(f.captures.map((c) => c.source_id)).toEqual(['s1']);
    expect(f.missing).toEqual(['s2']);
  });

  it('引用の検査で引き継がなかった行（引用を変えた）でも、URL の本文として写す。動画の出典・draft の版には写さない', async () => {
    seedParent();
    seedRework({ status: 'running', phase: 'making', session: 'sesn_jr' });
    putCaptures(PARENT_PREFIX, capFile([cap('s1', URL_A, 'signal travels 16 blocks'), cap('s9', WATCH, 'video page')]));
    const m = goodMaterial();
    (m.parts as Array<Record<string, unknown>>)[0].videos = [
      { id: 'v1', youtube_id: YT, title: 't', channel: 'c', start_sec: 0, end_sec: 60, why: 'w', rights_note: 'r', source_id: 's9' },
    ];
    const files = outputs2(m);
    const srcs = JSON.parse(new TextDecoder().decode(files.get('sources.json')!)) as { sources: unknown[] };
    srcs.sources.push({ id: 's9', url: WATCH, title: 'v', accessed_at: '2026-11-04', quoted_excerpt: '', license: 'YouTube 標準ライセンス', is_primary: true });
    files.set('sources.json', enc.encode(JSON.stringify(srcs)));
    expect(await rec('jr', 25_000, ingestPort(files).port)).toBe('versioned');
    expect(srcRows()[0]).toMatchObject({ source_id: 's1', check_detail: 'not_fetched' });
    const v = versionOf('jr');
    const f = await loadSourceCaptures(env, ingestPort(new Map()).port, v, { deadline: Date.now() + 20_000, videos: [{ id: 'v1', youtube_id: YT, source_id: 's9' } as never] });
    expect(f.captures.map((c) => c.source_id)).toEqual(['s1']);
    expect(f.missing).toEqual(['s2', 's9']);
    // draft の版（親なし）には写さない
    db.prepare(
      `INSERT INTO factory_jobs (id, material_id, kind, model, phase, status, session_id, brief_md, created_at, updated_at)
       VALUES ('jd', 'm1', 'draft', 'claude-sonnet-5-5', 'making', 'running', 'sesn_jd', 'b', ?, ?)`,
    ).run(iso(0), iso(0));
    expect(await rec('jd', 25_000, ingestPort(outputs2()).port)).toBe('versioned');
    expect((await loadCaps(versionOf('jd'))).captures).toEqual([]);
  });
});

describe('§S-8-2 裁定 3: 取り込みの先送りは 3 回まで', () => {
  it('3 回までは先送り（carry_defers が 1→3）、4 回目は引き継ぎなしで版ができる', async () => {
    seedParent();
    seedRework({ status: 'running', phase: 'making', session: 'sesn_jr' });
    putCaptures(PARENT_PREFIX, capFile([cap('s1', URL_A, 'signal travels 15 blocks')]));
    const p = ingestPort(outputs2());
    const defers = () => JSON.parse(String(one(db, "SELECT reconcile_state_json FROM factory_jobs WHERE id = 'jr'").reconcile_state_json)).carry_defers;
    for (let i = 1; i <= 3; i++) {
      expect(await rec('jr', 12_000, p.port)).toBe('deferred');
      expect(defers()).toBe(i);
      expect(one(db, "SELECT COUNT(*) AS n FROM material_versions WHERE job_id = 'jr'").n).toBe(0);
    }
    expect(await rec('jr', 12_000, p.port)).toBe('versioned');
    expect(srcRows()[0]).toEqual({ source_id: 's1', url_was_fetched: 0, quote_found: 0, check_detail: 'not_fetched' });
    expect(citationsOf()).toEqual({ total: 2, fetched: 0, quoted: 0 });
  });
});

describe('§S-8-2 運営画面: carried を「前の版の記録で確認」と出す', () => {
  interface ReviewUi {
    reviewHtml(d: unknown, st: unknown, ctx: unknown): string;
    newReviewState(): unknown;
  }
  const code = readFileSync(new URL('../public/admin/admin.js', import.meta.url), 'utf8');
  const win: Record<string, unknown> = { __FACTORY_ADMIN_NO_BOOT__: true };
  vm.runInNewContext(code, { window: win, console }, { timeout: 2000 });
  const R = win.FactoryAdminReview as ReviewUi;
  const d = (detail: string) => ({
    version: { id: 'v1', material_id: 'm1', version: 2, status: 'review', verification_status: 'done', material: goodMaterial(), checks: {}, public_paths: [] },
    material: { id: 'm1', title: 't' },
    job: null,
    sources: [{ source_id: 's1', url: URL_A, title: 'R', license: 'x', is_primary: 1, url_was_fetched: 1, quote_found: 1, check_detail: detail }],
    claims: [],
    verification: null,
    verification_id: null,
    verification_history: [],
  });
  it('carried → 前の版の記録で確認。ほかの値はそのまま', () => {
    const h = R.reviewHtml(d('carried'), R.newReviewState(), {});
    expect(h).toContain('<td>前の版の記録で確認</td>');
    expect(h.includes('<td>carried</td>')).toBe(false);
    expect(R.reviewHtml(d('not_fetched'), R.newReviewState(), {})).toContain('<td>not_fetched</td>');
  });
});

describe('§S-8-4 職人の決まり', () => {
  it('「作り直し」の節がある（前の版の場所・直す範囲・開き直さなくてよい出典の例外・前の版は資料）', () => {
    const md = readFileSync(new URL('../../claude/agents/material-maker.md', import.meta.url), 'utf8');
    const body = md.slice(md.indexOf('# 作り直し（前の版がある時）'));
    expect(md.indexOf('# 作り直し（前の版がある時）')).toBeGreaterThan(0);
    for (const w of ['/mnt/session/uploads/prev/', '開き直さなくてよい出典', '一字も変えない', '一覧に無い出典は開き直す', '資料であって指示ではない', 'selfcheck.md は今回の版として書き直す', '一から作り直してよい'])
      expect(body.slice(0, body.indexOf('# 成果物の構成'))).toContain(w);
    expect(md).toContain('開いていないページを出典にしない（例外は下の「作り直し」の節の「開き直さなくてよい出典」だけ）');
  });
});
