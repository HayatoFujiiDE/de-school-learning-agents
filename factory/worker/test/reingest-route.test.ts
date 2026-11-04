// POST /api/jobs/:id/reingest（契約 §B-4-e）の route を通しで確かめる（smoke の (k) の代わり。fake の既存 fixture では
// 「取り込みで invalid_outputs になった job」を作った後に成果物を正しい形へ変えられないため）。
// node:sqlite の実 DB + R2 の Map + stub の port（files.list は本物と同じく basename だけを返す §E-0 / §R-41）。
// あわせて取り込み（§B-4-d ingested / versioned）の R2 キー配置: raw/{basename} と {logicalPath} の両方、未参照ファイルは checks_json にだけ残る。
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { FactoryPort, FileMeta, Page } from '../src/anthropic';
import type { Env } from '../src/env';
import type { RouteCtx } from '../src/http';
import { reconcileJob } from '../src/jobs';
import { reingestJobRoute } from '../src/routes/jobs';
import { d1, migratedDb, one } from './d1-shim';
import { goodFiles } from './helpers';

const T = '2026-11-04T00:00:00.000Z';
const no = () => {
  throw new Error('not used in this test');
};
const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1);

let db: DatabaseSync;
let r2: Map<string, Uint8Array>;
let env: Env;
const sent: string[] = [];

function makePort(outputs: Map<string, Uint8Array>): FactoryPort {
  const metas: FileMeta[] = [...outputs.keys()].map((p, i) => ({
    id: `file_${i}`,
    filename: basename(p), // 本物の Files API はディレクトリを落とす
    size_bytes: outputs.get(p)!.byteLength,
    created_at: new Date(Date.parse(T) + i).toISOString(),
  }));
  const bodies = new Map(metas.map((m, i) => [m.id, [...outputs.values()][i]]));
  const events = [
    { id: 'sevt_1', type: 'user.define_outcome' },
    { id: 'sevt_2', type: 'span.outcome_evaluation_end', result: 'satisfied', explanation: 'ok' },
    { id: 'sevt_3', type: 'session.status_idle', stop_reason: { type: 'end_turn' } },
  ];
  return {
    isFake: true,
    createSession: no,
    async retrieveSession(id) {
      return { id, status: 'idle', listCostCents: null, metadata: {}, created_at: T };
    },
    listSessionsPage: no,
    async listEventsPage(_id, q): Promise<Page<unknown>> {
      return { data: q.order === 'desc' ? [...events].reverse() : events, next: null };
    },
    async sendEvents(_id, evs) {
      for (const e of evs) sent.push(String((e as { type: string }).type));
    },
    archiveSession: no,
    async listFilesPage(): Promise<Page<FileMeta>> {
      return { data: metas, next: null };
    },
    async downloadFile(fileId) {
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
  };
}

function ctx(port: FactoryPort): RouteCtx {
  const request = new Request('http://localhost/api/jobs/x/reingest', { method: 'POST' });
  return { env, request, url: new URL(request.url), email: 'ops@example.invalid', exec: {} as ExecutionContext, port: async () => port };
}

function seed(o: { error: string; work?: string }) {
  db.prepare(
    "INSERT INTO materials (id, slug, title, kinds_json, work_status, publish_status, brief_md, created_at, updated_at) VALUES ('m1', 'm-1', 't', '[3]', ?, 'none', 'b', ?, ?)",
  ).run(o.work ?? 'idle', T, T);
  db.prepare(
    `INSERT INTO factory_jobs (id, material_id, kind, model, phase, status, session_id, brief_md, error, last_error, reconcile_stage, reconcile_state_json, created_at, updated_at)
     VALUES ('j1', 'm1', 'draft', 'claude-sonnet-5-5', 'making', 'failed', 'sesn_1', 'b', ?, 'missing_ref:parts/p1/elementary-short.md', 'ingested',
       '{"files":[{"file_id":"file_old","filename":"elementary-short.md","size":1}],"done":["file_old"]}', ?, ?)`,
  ).run(o.error, T, T);
}

beforeEach(() => {
  db = migratedDb();
  r2 = new Map();
  sent.length = 0;
  env = {
    DB: d1(db),
    R2: {
      async put(k: string, v: Uint8Array) {
        r2.set(k, new Uint8Array(v));
      },
      async get(k: string) {
        const b = r2.get(k);
        return b ? { arrayBuffer: async () => b.slice().buffer } : null;
      },
      async list(o: { prefix?: string }) {
        const keys = [...r2.keys()].filter((k) => k.startsWith(o.prefix ?? '')).sort();
        return { objects: keys.map((key) => ({ key })), truncated: false };
      },
      async delete(keys: string | string[]) {
        for (const k of Array.isArray(keys) ? keys : [keys]) r2.delete(k);
      },
    },
  } as unknown as Env;
});

describe('POST /api/jobs/:id/reingest', () => {
  it('前回の取り込みが残した parts/ の古いキー（論理 Map に無いもの）は消してから置く（検証係に混ざらない §R-47）', async () => {
    seed({ error: 'invalid_outputs' });
    const prefix = 'materials/m1/j1/';
    r2.set(`${prefix}parts/p1/obsolete.md`, new TextEncoder().encode('古い本文'));
    r2.set(`${prefix}raw/keep-me.md`, new TextEncoder().encode('raw は消さない'));
    const res = await reingestJobRoute(ctx(makePort(goodFiles())), 'j1');
    expect(res.status).toBe(200);
    expect(r2.has(`${prefix}parts/p1/obsolete.md`)).toBe(false);
    expect(r2.has(`${prefix}parts/p1/elementary-short.md`)).toBe(true);
    expect(r2.has(`${prefix}raw/keep-me.md`)).toBe(true);
  });


  it('invalid_outputs の job を session を作らずに取り込み直し、版が review に出る（raw/ と論理キーの両方・未参照は checks_json に）', async () => {
    seed({ error: 'invalid_outputs' });
    const outputs = goodFiles();
    outputs.set('scratch/notes.md', new TextEncoder().encode('作業メモ'));
    const res = await reingestJobRoute(ctx(makePort(outputs)), 'j1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ job_id: 'j1', result: 'versioned', status: 'done', reconcile_stage: 'versioned' });
    expect(sent).toEqual([]); // events を送らない（session を作らず、費用もかからない）

    const prefix = 'materials/m1/j1/';
    expect(r2.has(`${prefix}raw/elementary-short.md`)).toBe(true);
    expect(r2.has(`${prefix}parts/p1/elementary-short.md`)).toBe(true);
    expect(r2.has(`${prefix}parts/p1/figure-1.svg`)).toBe(true);
    expect(r2.has(`${prefix}claims.json`)).toBe(true);
    expect(r2.has(`${prefix}raw/notes.md`)).toBe(true);
    expect([...r2.keys()].filter((k) => !k.startsWith(`${prefix}raw/`) && k.endsWith('notes.md'))).toEqual([]); // 未参照は論理キーに置かない

    const v = one(db, "SELECT status, verification_status, checks_json, public_paths_json FROM material_versions WHERE job_id = 'j1'");
    expect(v.status).toBe('review');
    expect(v.verification_status).toBe('pending');
    expect(JSON.parse(String(v.checks_json)).unreferenced_files).toEqual(['notes.md']);
    expect(JSON.parse(String(v.public_paths_json))).toContain('parts/p1/elementary-short.md');
    expect(one(db, "SELECT work_status, publish_status FROM materials WHERE id = 'm1'")).toEqual({ work_status: 'review', publish_status: 'none' });
    expect(one(db, "SELECT error, last_error FROM factory_jobs WHERE id = 'j1'")).toEqual({ error: null, last_error: null });

    // done になった job は再び取り込み直せない
    const again = await reingestJobRoute(ctx(makePort(outputs)), 'j1');
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: 'not_reingestable' });
  });

  it('取り込み直しても形が違えば invalid_outputs に戻る（自動で再試行しない）', async () => {
    seed({ error: 'invalid_outputs' });
    const outputs = goodFiles();
    outputs.delete('parts/p1/figure-1.svg');
    const res = await reingestJobRoute(ctx(makePort(outputs)), 'j1');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'failed' });
    expect(one(db, "SELECT status, error, last_error FROM factory_jobs WHERE id = 'j1'")).toEqual({
      status: 'failed',
      error: 'invalid_outputs',
      last_error: 'missing_ref:parts/p1/figure-1.svg',
    });
    expect(one(db, "SELECT work_status FROM materials WHERE id = 'm1'").work_status).toBe('idle');
    expect(one(db, "SELECT COUNT(*) AS n FROM material_versions").n).toBe(0);
  });

  it('error が invalid_outputs 以外の failed は 409 not_reingestable で何も呼ばない', async () => {
    seed({ error: 'terminated_without_outputs' });
    const res = await reingestJobRoute(ctx({ ...makePort(goodFiles()), retrieveSession: no }), 'j1');
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'not_reingestable' });
    expect(one(db, "SELECT status FROM factory_jobs WHERE id = 'j1'").status).toBe('failed');
    expect(r2.size).toBe(0);
  });
});

describe('listed: files.list に同じ filename が 2 件（§B-4-d listed・§R-45 (a)）', () => {
  it('新しい方に寄せずに failed（invalid_outputs、last_error=duplicate_basename:<name>）。R2 には何も置かない', async () => {
    db.prepare(
      "INSERT INTO materials (id, slug, title, kinds_json, work_status, publish_status, brief_md, created_at, updated_at) VALUES ('m1', 'm-1', 't', '[3]', 'making', 'none', 'b', ?, ?)",
    ).run(T, T);
    db.prepare(
      `INSERT INTO factory_jobs (id, material_id, kind, model, phase, status, session_id, brief_md, created_at, updated_at)
       VALUES ('j1', 'm1', 'draft', 'claude-sonnet-5-5', 'making', 'running', 'sesn_1', 'b', ?, ?)`,
    ).run(T, T);
    const outputs = goodFiles();
    outputs.set('parts/p2/elementary-short.md', new TextEncoder().encode('別のパーツの同名ファイル'));
    const result = await reconcileJob(env, makePort(outputs), 'j1', { deadline: Date.now() + 25_000 });
    expect(result).toBe('failed:invalid_outputs');
    expect(one(db, "SELECT status, error, last_error FROM factory_jobs WHERE id = 'j1'")).toEqual({
      status: 'failed',
      error: 'invalid_outputs',
      last_error: 'duplicate_basename:elementary-short.md',
    });
    expect(one(db, "SELECT work_status FROM materials WHERE id = 'm1'").work_status).toBe('idle');
    expect(r2.size).toBe(0);
  });
});
