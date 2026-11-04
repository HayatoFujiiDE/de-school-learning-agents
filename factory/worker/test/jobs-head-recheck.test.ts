// needs_answer へ遷移する直前の先頭 event 再確認（§R-40 (a)）: files 集計の文脈 head と、遷移直前に取り直した events の先頭 id が違えば
// 遷移せず（deferred_head_changed）、次の呼び出しで idle・files とも先頭から走査し直してから遷移する。node:sqlite の実 DB + stub の port。
import { beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import type { FactoryPort, FileMeta, Page } from '../src/anthropic';
import type { Env } from '../src/env';
import { reconcileJob } from '../src/jobs';
import { d1, migratedDb, one } from './d1-shim';

const T = '2026-11-04T00:00:00.000Z';
const no = () => {
  throw new Error('not used in this test');
};

function port(heads: string[]) {
  const calls: Record<string, number> = {};
  const count = (k: string) => (calls[k] = (calls[k] ?? 0) + 1);
  let i = 0;
  const p: FactoryPort = {
    isFake: true,
    createSession: no,
    async retrieveSession(id) {
      count('retrieveSession');
      return { id, status: 'idle', listCostCents: null, metadata: {}, created_at: T };
    },
    listSessionsPage: no,
    async listEventsPage(): Promise<Page<unknown>> {
      count('listEventsPage');
      // 呼ばれるたびに heads の次の値を先頭 event にする（最後の値で止まる）
      const head = heads[Math.min(i++, heads.length - 1)];
      return { data: [{ id: head, type: 'session.status_idle', stop_reason: { type: 'end_turn' } }], next: null };
    },
    sendEvents: no,
    archiveSession: no,
    async listFilesPage(): Promise<Page<FileMeta>> {
      count('listFilesPage');
      return { data: [{ id: 'file_q', filename: '/mnt/session/outputs/questions.json', size_bytes: 80, created_at: T }], next: null };
    },
    async downloadFile() {
      count('downloadFile');
      return new TextEncoder().encode(JSON.stringify({ questions: [{ id: 'q1', question: '対象の学年は？' }] }));
    },
    createMessage: no,
    createBatch: no,
    retrieveBatch: no,
    batchResults: no,
    listBatchesPage: no,
    xaiResponses: no,
  };
  return { port: p, calls };
}

describe('needs_answer 遷移直前の先頭確認（§R-40 (a)）', () => {
  let raw: DatabaseSync;
  let env: Env;
  beforeEach(() => {
    raw = migratedDb();
    env = { DB: d1(raw) } as unknown as Env;
    raw.prepare(
      "INSERT INTO materials (id, slug, title, kinds_json, work_status, brief_md, created_at, updated_at) VALUES ('m1', 'm-1', 't', '[3]', 'making', 'b', ?, ?)",
    ).run(T, T);
    raw.prepare(
      "INSERT INTO factory_jobs (id, material_id, kind, model, phase, status, session_id, brief_md, created_at, updated_at) VALUES ('j1', 'm1', 'draft', 'x', 'questions', 'running', 'sesn_1', 'b', ?, ?)",
    ).run(T, T);
  });

  it('遷移直前に先頭が変わっていたら needs_answer にしない（files の途中集計は捨てる）。次の呼び出しは走査し直してから遷移する', async () => {
    // 1 回目: idle 走査の先頭 = sevt_1、遷移直前の取り直し = sevt_2（新しい event が増えた）
    const a = port(['sevt_1', 'sevt_2']);
    expect(await reconcileJob(env, a.port, 'j1', { deadline: Date.now() + 25_000 })).toBe('deferred_head_changed');
    const j = one(raw, 'SELECT status, phase, questions_json, reconcile_state_json FROM factory_jobs');
    expect(j).toMatchObject({ status: 'running', phase: 'questions', questions_json: null });
    const st = JSON.parse(String(j.reconcile_state_json)) as { scan?: Record<string, unknown> };
    expect(st.scan?.files).toBeUndefined();
    expect(a.calls).toMatchObject({ listEventsPage: 2, listFilesPage: 1 });

    // 2 回目: 先頭は sevt_2 のまま → idle も files も先頭から走査し直し、遷移直前の確認も一致して needs_answer
    const b = port(['sevt_2']);
    expect(await reconcileJob(env, b.port, 'j1', { deadline: Date.now() + 25_000 })).toBe('needs_answer');
    expect(b.calls).toMatchObject({ listEventsPage: 2, listFilesPage: 1, downloadFile: 1 });
    const j2 = one(raw, 'SELECT status, questions_json FROM factory_jobs');
    expect(j2.status).toBe('needs_answer');
    expect(JSON.parse(String(j2.questions_json))).toHaveLength(1);
  });

  it('先頭が変わっていなければ 1 回で needs_answer', async () => {
    const a = port(['sevt_1']);
    expect(await reconcileJob(env, a.port, 'j1', { deadline: Date.now() + 25_000 })).toBe('needs_answer');
    expect(a.calls).toMatchObject({ listEventsPage: 2, listFilesPage: 1 });
  });
});
