// §AK2 本文の丸写しの検査の取り込みの実経路（契約 docs/plans/rights/contract-AK2.md AK2-4 の 5・6・10）。
// test/rework-from-previous.test.ts の作り: node:sqlite の実 DB + R2 の Map + 台本どおりの stub port（events は next でページを分ける）。
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FactoryPort, FileMeta, Page } from '../src/anthropic';
import { normalizeForMatch } from '../src/checks/verbatim';
import type { Env } from '../src/env';
import { reconcileJob } from '../src/jobs';
import { SOURCE_CAPTURES_FILE } from '../src/verify';
import { d1, migratedDb, one, rows } from './d1-shim';
import { goodFiles } from './helpers';

const DAY = 86_400_000;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const no = () => {
  throw new Error('not used in this test');
};
const enc = new TextEncoder();
const URL_S1 = 'https://minecraft.wiki/w/Redstone_Dust';
/** sources.json に無い URL（職人が開いただけのページ） */
const URL_X = 'https://other.example/article/42';
const PARENT_PREFIX = 'materials/m1/jp/';
/** 丸写しされる文（120 字以上・md の記号を含まない） */
const COPY =
  'レッドストーンの信号は十五ブロック進むと弱くなって消えてしまうので長い回路ではリピーターを置いて信号の強さを元に戻す必要があるとされていますがこの性質を使うと信号を遅らせることもできるのでいろいろな仕掛けに使われています';
const PAGE = `ページの前置き。${COPY}ページの終わり。`;
const BODY_PATH = 'parts/p1/elementary-long.md';

let db: DatabaseSync;
let r2: Map<string, Uint8Array>;
let env: Env;

beforeEach(() => {
  db = migratedDb();
  r2 = new Map();
  env = {
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
      async head(k: string) {
        const b = r2.get(k);
        return b ? { key: k, size: b.byteLength } : null;
      },
    },
    FACTORY_AGENT_ID: 'agent_test',
    FACTORY_ENV_ID: 'env_test',
    DAILY_CAP_CENTS: '100000',
  } as unknown as Env;
});

const DONE_EVENTS = [
  { id: 'sevt_1', type: 'user.define_outcome' },
  { id: 'sevt_2', type: 'span.outcome_evaluation_end', result: 'satisfied', explanation: 'ok' },
  { id: 'sevt_3', type: 'session.status_idle', stop_reason: { type: 'end_turn' } },
];
const use = (id: string, url: string) => ({ id, type: 'agent.tool_use', name: 'web_fetch', input: { url } });
const result = (id: string, text: string, o: { is_error?: boolean } = {}) => ({ type: 'agent.tool_result', tool_use_id: id, content: [{ type: 'text', text }], ...o });

/**
 * 取り込みの port。pages = 古い順の events のページ（最後のページの後ろに DONE_EVENTS を足す）。
 * failOnce = そのページ番号の最初の取得だけ例外（取り込みが途中で止まり、次の呼び出しで保存済みの続きから再開する）
 */
function ingestPort(outputs: Map<string, Uint8Array>, pages: unknown[][] = [[]], o: { failOnce?: number } = {}) {
  const metas: FileMeta[] = [...outputs.keys()].map((p, i) => ({
    id: `file_${i}`,
    filename: p.slice(p.lastIndexOf('/') + 1),
    size_bytes: outputs.get(p)!.byteLength,
    created_at: new Date(Date.now() + 60_000 + i).toISOString(),
  }));
  const bodies = new Map(metas.map((m, i) => [m.id, [...outputs.values()][i]]));
  const all = pages.map((p, i) => (i === pages.length - 1 ? [...p, ...DONE_EVENTS] : p));
  const reads: number[] = [];
  let failed = false;
  const port = {
    isFake: true,
    createSession: no,
    async retrieveSession(id: string) {
      return { id, status: 'idle', listCostCents: null, metadata: {}, created_at: iso(0) };
    },
    updateSessionBudget: no,
    listSessionsPage: no,
    async listEventsPage(_id: string, q: { order: 'asc' | 'desc'; page?: string | null }): Promise<Page<unknown>> {
      if (q.order === 'desc') return { data: all.flat().reverse(), next: null };
      const idx = q.page ? Number(q.page.slice(1)) : 0;
      if (o.failOnce === idx && !failed) {
        failed = true;
        throw new Error('transient');
      }
      reads.push(idx);
      return { data: all[idx], next: idx + 1 < all.length ? `p${idx + 1}` : null };
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
  return { port, reads };
}

/** 本文の 1 本（elementary-long.md）に text を足した出力 */
function outputsWith(text: string) {
  const files = goodFiles();
  files.set(BODY_PATH, enc.encode(`見てみよう [c1]\n\n${text}\n`));
  return files;
}

function seedMaterial() {
  db.prepare(
    "INSERT OR IGNORE INTO materials (id, slug, title, kinds_json, work_status, publish_status, brief_md, created_at, updated_at) VALUES ('m1', 'slug-m1', 't', '[3]', 'making', 'none', 'b', ?, ?)",
  ).run(iso(30 * DAY), iso(30 * DAY));
}
function seedDraft(id = 'jd') {
  seedMaterial();
  db.prepare(
    `INSERT INTO factory_jobs (id, material_id, kind, model, phase, status, session_id, brief_md, created_at, updated_at)
     VALUES (?, 'm1', 'draft', 'claude-sonnet-5-5', 'making', 'running', ?, 'b', ?, ?)`,
  ).run(id, `sesn_${id}`, iso(60_000), iso(60_000));
}
/** 親の版 vp（job jp）。checks = 親の checks_json */
function seedParent(checks: unknown = {}) {
  seedMaterial();
  db.prepare(
    `INSERT INTO factory_jobs (id, material_id, kind, model, phase, status, session_id, brief_md, reconcile_stage, reconcile_state_json, created_at, updated_at)
     VALUES ('jp', 'm1', 'draft', 'claude-sonnet-5-5', 'making', 'done', 'sesn_jp', 'b', 'versioned', '{}', ?, ?)`,
  ).run(iso(DAY + 3600_000), iso(DAY));
  db.prepare(
    `INSERT INTO material_versions (id, material_id, version, job_id, session_id, r2_prefix, content_sha256, material_json, claims_json, adapt_rules_md,
       checks_json, public_paths_json, status, created_at)
     VALUES ('vp', 'm1', 1, 'jp', 'sesn_jp', ?, 'sha', '{}', '{"claims":[]}', 'a', ?, '[]', 'rejected', ?)`,
  ).run(PARENT_PREFIX, JSON.stringify(checks), iso(DAY));
}
function seedRework() {
  db.prepare(
    `INSERT INTO factory_jobs (id, material_id, kind, model, phase, status, session_id, parent_version_id, brief_md, created_at, updated_at)
     VALUES ('jr', 'm1', 'rework', 'claude-opus-5-5', 'making', 'running', 'sesn_jr', 'vp', 'b', ?, ?)`,
  ).run(iso(60_000), iso(60_000));
}
function putCaptures(file: unknown) {
  r2.set(PARENT_PREFIX + SOURCE_CAPTURES_FILE, enc.encode(JSON.stringify(file)));
}
const capOk = (captures: Array<{ url: string; text: unknown }>, o: { missing?: string[]; truncated?: string[]; v?: number } = {}) => ({
  v: o.v ?? 1,
  captures: captures.map((c, i) => ({ source_id: `s${i + 1}`, chars: typeof c.text === 'string' ? c.text.length : 0, ...c })),
  missing: o.missing ?? [],
  truncated: o.truncated ?? [],
});

const rec = (job: string, port: FactoryPort, deadlineMs = 25_000) => reconcileJob(env, port, job, { deadline: Date.now() + deadlineMs });
const checksOf = (job: string) => JSON.parse(String(one(db, 'SELECT checks_json FROM material_versions WHERE job_id = ?', job).checks_json)) as Record<string, any>;
const verb = (job: string) => {
  const c = checksOf(job);
  return { status: c.verbatim_status, total: c.verbatim_total, pages: c.verbatim_pages, n: c.verbatim_copy.length };
};
const srcRows = (job: string) =>
  rows(db, 'SELECT s.source_id, s.url_was_fetched, s.quote_found, s.check_detail FROM sources s JOIN material_versions v ON v.id = s.material_version_id WHERE v.job_id = ? ORDER BY s.source_id', job);

describe('AK2-4 5 取り込みの実経路', () => {
  it('use が 1 ページ目・result が 2 ページ目（間で保存 → JSON で復元 → 再開）でも 1 件見つかる。sources.json に無い URL も対象', async () => {
    seedDraft();
    const p = ingestPort(outputsWith(COPY), [[use('tu1', URL_X)], [result('tu1', PAGE)]], { failOnce: 1 });
    expect(await rec('jd', p.port)).toBe('error'); // 2 ページ目の取得で止まる（1 ページ目の集計は保存済み）
    const saved = JSON.parse(String(one(db, "SELECT reconcile_state_json FROM factory_jobs WHERE id = 'jd'").reconcile_state_json));
    expect(saved.ev.cursor).toBe('p1');
    expect(saved.ev.verb).toEqual({ v: 1, hits: [], total: 0, pages: 0, incomplete: false });
    expect(await rec('jd', p.port)).toBe('versioned');
    expect(p.reads).toEqual([0, 1]); // 再開は続きのページから（1 ページ目を読み直さない）
    const c = checksOf('jd');
    expect(verb('jd')).toEqual({ status: 'found', total: 1, pages: 1, n: 1 });
    expect(c.verbatim_copy[0]).toMatchObject({ path: BODY_PATH, url: 'https://other.example/article/42' });
    expect(c.verbatim_copy[0].text).toContain(normalizeForMatch(COPY));
  });

  it('offload らしい結果・エラーの結果は飛ばす（pages に数えない）', async () => {
    seedDraft();
    const p = ingestPort(outputsWith(COPY), [[use('tu1', URL_X), result('tu1', `${COPY} /mnt/session/out/page.txt`), use('tu2', URL_X), result('tu2', PAGE, { is_error: true })]]);
    expect(await rec('jd', p.port)).toBe('versioned');
    expect(verb('jd')).toEqual({ status: 'clean', total: 0, pages: 0, n: 0 });
  });

  it('二重に数えない（同じ result が 2 回来ても 1 回・別のページの同じ use も）', async () => {
    seedDraft();
    const p = ingestPort(outputsWith(COPY), [[use('tu1', URL_X), result('tu1', PAGE)], [result('tu1', PAGE)]]);
    expect(await rec('jd', p.port)).toBe('versioned');
    expect(verb('jd')).toEqual({ status: 'found', total: 1, pages: 1, n: 1 });
  });

  it('旧形式の ev（verb が無い）から集計し直す（cursor・acc・grader・complete も初期化）', async () => {
    seedDraft();
    const p = ingestPort(outputsWith(COPY), [[use('tu1', URL_X)], [result('tu1', PAGE)]], { failOnce: 1 });
    expect(await rec('jd', p.port)).toBe('error');
    const st = JSON.parse(String(one(db, "SELECT reconcile_state_json FROM factory_jobs WHERE id = 'jd'").reconcile_state_json));
    // 旧形式: verb なし・最後まで集計済みと書かれている
    st.ev = { cursor: null, acc: st.ev.acc, grader: null, complete: true };
    db.prepare("UPDATE factory_jobs SET reconcile_state_json = ? WHERE id = 'jd'").run(JSON.stringify(st));
    expect(await rec('jd', p.port)).toBe('versioned');
    expect(p.reads).toEqual([0, 0, 1]); // 先頭から読み直した
    expect(verb('jd')).toEqual({ status: 'found', total: 1, pages: 1, n: 1 });
  });

  it('checks_json.verbatim_status が 3 通り出る（found / clean / incomplete）', async () => {
    seedDraft('j1');
    expect(await rec('j1', ingestPort(outputsWith(COPY), [[use('tu1', URL_X), result('tu1', PAGE)]]).port)).toBe('versioned');
    expect(verb('j1').status).toBe('found');
    seedDraft('j2');
    expect(await rec('j2', ingestPort(outputsWith(COPY), [[use('tu1', URL_X), result('tu1', 'まったく別の内容のページです。'.repeat(20))]]).port)).toBe('versioned');
    expect(verb('j2')).toEqual({ status: 'clean', total: 0, pages: 1, n: 0 });
    seedDraft('j3');
    expect(await rec('j3', ingestPort(outputsWith(COPY), [[use('tu1', URL_X), result('tu1', 'ぬ'.repeat(200_001))]]).port)).toBe('versioned');
    expect(verb('j3')).toEqual({ status: 'incomplete', total: 0, pages: 1, n: 0 });
  });

  it('引用（同じ URL の出典の quoted_excerpt）に収まる一致は数えない・出典照合の結果は従来と同じ', async () => {
    seedDraft();
    const files = outputsWith(COPY);
    files.set(
      'sources.json',
      enc.encode(JSON.stringify({ sources: [{ id: 's1', url: URL_S1, title: 'R', accessed_at: '2026-11-04', quoted_excerpt: COPY, license: 'CC BY-NC-SA 3.0', is_primary: true }] })),
    );
    expect(await rec('jd', ingestPort(files, [[use('tu1', URL_S1)], [result('tu1', PAGE)]]).port)).toBe('versioned');
    expect(verb('jd')).toEqual({ status: 'clean', total: 0, pages: 1, n: 0 });
    expect(srcRows('jd')).toEqual([{ source_id: 's1', url_was_fetched: 1, quote_found: 1, check_detail: 'ok' }]);
    expect(checksOf('jd').citations).toEqual({ total: 1, fetched: 1, quoted: 1 });
  });
});

describe('AK2-4 6 作り直し', () => {
  const page = (txt = COPY) => `前置き ${txt} 終わり`;
  it('親の記録の文に一致 → 1 件（子の session では何も開いていない）', async () => {
    seedParent();
    seedRework();
    putCaptures(capOk([{ url: URL_S1, text: page() }]));
    expect(await rec('jr', ingestPort(outputsWith(COPY)).port)).toBe('versioned');
    expect(verb('jr')).toEqual({ status: 'found', total: 1, pages: 1, n: 1 });
    expect(checksOf('jr').verbatim_copy[0].url).toBe('https://minecraft.wiki/w/Redstone_Dust');
  });

  it.each([
    ['記録が無い', null],
    ['text: null の行がある', capOk([{ url: URL_S1, text: null }])],
    ['text が 30,000 字（切り詰めの疑い）', capOk([{ url: URL_S1, text: 'あ'.repeat(30_000) }])],
    ['truncated がある', capOk([{ url: URL_S1, text: 'ちがう文' }], { truncated: ['s1'] })],
    ['v が違う', capOk([{ url: URL_S1, text: 'ちがう文' }], { v: 2 })],
  ])('親の記録: %s → incomplete', async (_name, file) => {
    seedParent();
    seedRework();
    if (file) putCaptures(file);
    expect(await rec('jr', ingestPort(outputsWith(COPY)).port)).toBe('versioned');
    expect(verb('jr').status).toBe('incomplete');
  });

  it('親の記録が正しく 0 件一致なら clean（29,999 字は切り詰めの疑いにならない）', async () => {
    seedParent();
    seedRework();
    putCaptures(capOk([{ url: URL_S1, text: 'あ'.repeat(29_999) }]));
    expect(await rec('jr', ingestPort(outputsWith('自分で書いた文です。')).port)).toBe('versioned');
    expect(verb('jr')).toEqual({ status: 'clean', total: 0, pages: 1, n: 0 });
  });

  it('先送りを使い切った → 親の記録を読まずに incomplete', async () => {
    seedParent();
    seedRework();
    putCaptures(capOk([{ url: URL_S1, text: 'ちがう文' }]));
    const p = ingestPort(outputsWith('自分で書いた文です。'));
    for (let i = 1; i <= 3; i++) expect(await rec('jr', p.port, 12_000)).toBe('deferred');
    expect(await rec('jr', p.port, 12_000)).toBe('versioned');
    expect(verb('jr').status).toBe('incomplete');
  });

  it('v3.2: 親の記録の missing（開かなかった出典・YouTube）は未完了にしない', async () => {
    seedParent();
    seedRework();
    putCaptures(capOk([{ url: URL_S1, text: 'ちがう文' }], { missing: ['s2', 'yt1'] }));
    expect(await rec('jr', ingestPort(outputsWith('自分で書いた文です。')).port)).toBe('versioned');
    expect(verb('jr')).toEqual({ status: 'clean', total: 0, pages: 1, n: 0 });
  });

  it('v3.2: 親が走査済み（clean）なら、取得記録が無くても clean（記録は読まない）', async () => {
    seedParent({ verbatim_copy: [], verbatim_total: 0, verbatim_pages: 2, verbatim_status: 'clean' });
    seedRework();
    expect(await rec('jr', ingestPort(outputsWith('自分で書いた文です。')).port)).toBe('versioned');
    expect(verb('jr')).toEqual({ status: 'clean', total: 0, pages: 0, n: 0 });
    db.prepare("DELETE FROM sources").run();
    db.prepare("DELETE FROM material_versions WHERE job_id = 'jr'").run();
  });

  const parentHit = (o: Record<string, unknown> = {}) => ({
    path: BODY_PATH,
    start: 8,
    length: Array.from(normalizeForMatch(COPY)).length,
    url: URL_X,
    sample: Array.from(normalizeForMatch(COPY)).slice(0, 60).join(''),
    text: normalizeForMatch(COPY),
    ...o,
  });
  const foundChecks = (hits: unknown[]) => ({ verbatim_copy: hits, verbatim_total: hits.length, verbatim_pages: 1, verbatim_status: 'found' });

  it('親が found で、本文を変えずに作り直した子 → 引き継いだ hit で found（子の session では何も開かず、親の記録にもその URL が無い）', async () => {
    seedParent(foundChecks([parentHit()]));
    seedRework();
    putCaptures(capOk([{ url: URL_S1, text: '関係のない記録' }]));
    expect(await rec('jr', ingestPort(outputsWith(COPY)).port)).toBe('versioned');
    expect(verb('jr')).toMatchObject({ status: 'found', n: 1 });
    expect(checksOf('jr').verbatim_copy[0]).toMatchObject({ path: BODY_PATH, url: URL_X, carried: true, text: normalizeForMatch(COPY) });
  });

  it('子が丸写しを書き直した → 引き継ぐ hit が無く clean', async () => {
    seedParent(foundChecks([parentHit()]));
    seedRework();
    putCaptures(capOk([{ url: URL_S1, text: '関係のない記録' }]));
    expect(await rec('jr', ingestPort(outputsWith('信号は遠くまで行くと弱くなる。自分の言葉で書いた。')).port)).toBe('versioned');
    // v3.2: 親は走査済み（verbatim_status あり）なので取得記録は読まない（pages 0）
    expect(verb('jr')).toEqual({ status: 'clean', total: 0, pages: 0, n: 0 });
  });

  it('親が incomplete → 子も incomplete / 親の hit が text_cut → 子は incomplete', async () => {
    seedParent({ verbatim_copy: [], verbatim_total: 0, verbatim_pages: 0, verbatim_status: 'incomplete' });
    seedRework();
    putCaptures(capOk([{ url: URL_S1, text: '関係のない記録' }]));
    expect(await rec('jr', ingestPort(outputsWith('自分で書いた文です。')).port)).toBe('versioned');
    expect(verb('jr').status).toBe('incomplete');

    db.prepare("DELETE FROM sources").run();
    db.prepare("DELETE FROM material_versions WHERE job_id = 'jr'").run();
    db.prepare("DELETE FROM factory_jobs WHERE id = 'jr'").run();
    db.prepare("UPDATE material_versions SET checks_json = ? WHERE id = 'vp'").run(JSON.stringify(foundChecks([parentHit({ text_cut: true })])));
    seedRework();
    expect(await rec('jr', ingestPort(outputsWith('自分で書いた文です。')).port)).toBe('versioned');
    expect(verb('jr').status).toBe('incomplete');
  });
});

describe('AK2-4 10 ログに本文・URL・ページの文が無い', () => {
  const logs: string[] = [];
  beforeEach(() => {
    logs.length = 0;
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
      logs.push(a.map(String).join(' '));
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('取り込みのログは verbatim の状態と数だけ', async () => {
    seedDraft();
    expect(await rec('jd', ingestPort(outputsWith(COPY), [[use('tu1', URL_X)], [result('tu1', PAGE)]]).port)).toBe('versioned');
    const ingest = logs.map((l) => JSON.parse(l) as Record<string, unknown>).filter((l) => l.at === 'ingest' && 'verbatim' in l);
    expect(ingest.map((l) => [l.verbatim, l.verbatim_n, l.verbatim_pages])).toEqual([['found', 1, 1]]);
    const all = logs.join('\n');
    for (const bad of [URL_X, 'other.example', COPY.slice(0, 20), normalizeForMatch(COPY).slice(30, 50), 'ページの前置き']) expect(all.includes(bad)).toBe(false);
  });
});
