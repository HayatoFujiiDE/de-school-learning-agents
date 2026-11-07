// 作り直しの再投入の段（契約 V-13・V-11 u12）を node:sqlite の実 DB で確かめる。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { retryFailedReworkStep } from '../src/retry-step';
import { one, rows } from './d1-shim';
import { good, seed, setSetting, world, type World } from './review-auto-helpers';

const FAR = () => Date.now() + 10 * 60_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
let w: World;
let logs: Array<Record<string, unknown>>;

beforeEach(() => {
  w = world();
  logs = [];
  vi.spyOn(console, 'log').mockImplementation((s: unknown) => {
    try {
      logs.push(JSON.parse(String(s)));
    } catch {
      /* JSON でないログは見ない */
    }
  });
});
afterEach(() => vi.restoreAllMocks());

/** 素材（idle）+ 親の版（rejected）+ 失敗した作り直しの job */
function seedFailed(
  n: number,
  o: { kind?: string; error?: string; lastError?: string | null; updatedAt?: string; createdAt?: string; workStatus?: string; parent?: string; newMaterial?: boolean } = {},
): string {
  const mid = `m${n}`;
  const vid = o.parent ?? `v${n}`;
  if (o.newMaterial !== false) {
    seed(w, good(mid, vid));
    w.db.prepare("UPDATE factory_jobs SET created_at = '2026-01-01T00:00:00.000Z' WHERE material_id = ?").run(mid);
    w.db.prepare("UPDATE material_versions SET status = 'rejected' WHERE id = ?").run(vid);
  }
  w.db.prepare('UPDATE materials SET work_status = ? WHERE id = ?').run(o.workStatus ?? 'idle', mid);
  const jid = `j${n}${o.newMaterial === false ? `-${w.seq++}` : ''}`;
  const kind = o.kind ?? 'rework';
  w.db
    .prepare(
      `INSERT INTO factory_jobs (id, material_id, kind, model, phase, status, session_id, parent_version_id, brief_md, error, last_error, created_at, updated_at)
       VALUES (?, ?, ?, 'claude-opus-5-5', 'making', 'failed', ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(jid, mid, kind, `sesn-${jid}`, kind === 'rework' ? vid : null, `元の注文 ${n}\n\n## 差し戻し理由（v1）\n直して`, o.error ?? 'retries_exhausted', o.lastError ?? null, o.createdAt ?? ago(30 * 60_000), o.updatedAt ?? ago(20 * 60_000));
  return jid;
}

const jobsOf = (mid: string) => rows(w.db, "SELECT id, kind, status, parent_version_id, brief_md FROM factory_jobs WHERE material_id = ? AND status = 'queued'", mid);
const lastError = (jid: string) => one(w.db, 'SELECT last_error FROM factory_jobs WHERE id = ?', jid).last_error;
const workStatus = (mid: string) => one(w.db, 'SELECT work_status FROM materials WHERE id = ?', mid).work_status;
const retryLogs = () => logs.filter((l) => l.at === 'auto_retry');

describe('retryFailedReworkStep（契約 V-13・u12）', () => {
  it('failed・retries_exhausted・rework・素材 idle・新しい job なし → 同じ親・同じ brief の rework が queued、素材 queued、印 auto_retry:<id>、ログ', async () => {
    const jid = seedFailed(1);
    const brief = String(one(w.db, 'SELECT brief_md FROM factory_jobs WHERE id = ?', jid).brief_md);
    const r = await retryFailedReworkStep(w.env, { deadline: FAR() });
    const q = jobsOf('m1');
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ kind: 'rework', status: 'queued', parent_version_id: 'v1', brief_md: brief });
    expect(r).toEqual({ queued: [{ failed_job_id: jid, job_id: q[0].id }], skipped: [] });
    expect(workStatus('m1')).toBe('queued');
    expect(lastError(jid)).toBe(`auto_retry:${q[0].id}`);
    expect(one(w.db, 'SELECT status, error FROM factory_jobs WHERE id = ?', jid)).toEqual({ status: 'failed', error: 'retries_exhausted' });
    expect(retryLogs()).toEqual([{ at: 'auto_retry', job_id: jid, new_job_id: q[0].id }]);
    // 印つきなので次の tick では拾わない（素材を idle に戻しても）
    w.db.prepare("UPDATE factory_jobs SET status = 'cancelled' WHERE id = ?").run(q[0].id);
    w.db.prepare("UPDATE materials SET work_status = 'idle' WHERE id = 'm1'").run();
    expect(await retryFailedReworkStep(w.env, { deadline: FAR() })).toEqual({ queued: [], skipped: [] });
  });

  it('draft・refusal・新しい job あり・素材が idle でない・24 時間より前・印つき、はどれも 0 件', async () => {
    seedFailed(1, { kind: 'draft' });
    seedFailed(2, { error: 'refusal' });
    const j3 = seedFailed(3);
    w.db
      .prepare("INSERT INTO factory_jobs (id, material_id, kind, model, phase, status, brief_md, created_at, updated_at) VALUES ('newer', 'm3', 'draft', 'x', 'making', 'cancelled', 'b', ?, ?)")
      .run(ago(60_000), ago(60_000));
    seedFailed(4, { workStatus: 'review' });
    seedFailed(5, { updatedAt: ago(24 * 60 * 60_000 + 60_000), createdAt: ago(25 * 60 * 60_000) });
    seedFailed(6, { lastError: 'auto_retry:refused:material_busy' });
    expect(await retryFailedReworkStep(w.env, { deadline: FAR() })).toEqual({ queued: [], skipped: [] });
    expect(rows(w.db, "SELECT id FROM factory_jobs WHERE status = 'queued'")).toEqual([]);
    expect(lastError(j3)).toBeNull();
    expect(retryLogs()).toEqual([]);
  });

  it('同じ親の版で 2 回目の retries_exhausted は作らない（親の版ごとに 1 回）', async () => {
    const first = seedFailed(1, { createdAt: ago(60 * 60_000), updatedAt: ago(50 * 60_000), lastError: 'auto_retry:x' });
    const second = seedFailed(1, { newMaterial: false, parent: 'v1' });
    expect(first).not.toBe(second);
    expect(await retryFailedReworkStep(w.env, { deadline: FAR() })).toEqual({ queued: [], skipped: [] });
    expect(lastError(second)).toBeNull();
    expect(workStatus('m1')).toBe('idle');
  });

  it('paused なら何もしない。残り時間が 5 秒未満でも何もしない', async () => {
    const jid = seedFailed(1);
    setSetting(w, 'paused', '1');
    expect(await retryFailedReworkStep(w.env, { deadline: FAR() })).toEqual({ queued: [], skipped: [], paused: true });
    expect(lastError(jid)).toBeNull();
    setSetting(w, 'paused', '0');
    expect(await retryFailedReworkStep(w.env, { deadline: Date.now() + 4_000 })).toEqual({ queued: [], skipped: [] });
    expect(lastError(jid)).toBeNull();
    expect(jobsOf('m1')).toEqual([]);
  });

  it('1 tick 1 件（古い順）', async () => {
    const b = seedFailed(2, { updatedAt: ago(10 * 60_000) });
    const a = seedFailed(1, { updatedAt: ago(20 * 60_000) });
    expect((await retryFailedReworkStep(w.env, { deadline: FAR() })).queued.map((x) => x.failed_job_id)).toEqual([a]);
    expect(lastError(b)).toBeNull();
    expect((await retryFailedReworkStep(w.env, { deadline: FAR() })).queued.map((x) => x.failed_job_id)).toEqual([b]);
  });

  it('auto_retry:pending のまま 10 分以上止まった job は拾い直す。10 分未満は拾わない。新しい job があれば拾わない', async () => {
    const old = seedFailed(1, { lastError: 'auto_retry:pending', updatedAt: ago(11 * 60_000) });
    const fresh = seedFailed(2, { lastError: 'auto_retry:pending', updatedAt: ago(9 * 60_000) });
    const queuedAlready = seedFailed(3, { lastError: 'auto_retry:pending', updatedAt: ago(30 * 60_000) });
    // queue 済みで印だけ書けなかった job（同じ素材に新しい job がある）
    w.db
      .prepare("INSERT INTO factory_jobs (id, material_id, kind, model, phase, status, parent_version_id, brief_md, created_at, updated_at) VALUES ('n3', 'm3', 'rework', 'x', 'questions', 'queued', 'v3', 'b', ?, ?)")
      .run(ago(29 * 60_000), ago(29 * 60_000));
    w.db.prepare("UPDATE materials SET work_status = 'idle' WHERE id = 'm3'").run();
    const r = await retryFailedReworkStep(w.env, { deadline: FAR() });
    const q = jobsOf('m1');
    expect(q).toHaveLength(1);
    expect(r).toEqual({ queued: [{ failed_job_id: old, job_id: q[0].id }], skipped: [] });
    expect(lastError(old)).toBe(`auto_retry:${q[0].id}`);
    expect(await retryFailedReworkStep(w.env, { deadline: FAR() })).toEqual({ queued: [], skipped: [] });
    expect([lastError(fresh), lastError(queuedAlready)]).toEqual(['auto_retry:pending', 'auto_retry:pending']);
    expect(jobsOf('m2')).toEqual([]);
    expect(rows(w.db, "SELECT id FROM factory_jobs WHERE material_id = 'm3' AND status = 'queued'")).toEqual([{ id: 'n3' }]);
  });

  it('候補を読んだ後に同じ素材へ新しい job が入れば、印の CAS は 0 行で raced（印も queue もしない）', async () => {
    const jid = seedFailed(1);
    const real = w.env.DB;
    // 候補を読んだ後・印の CAS の前に、人が新しい job を作って取り消し、素材が idle に戻った状態を作る
    const DB = new Proxy(real, {
      get(t, k) {
        if (k === 'prepare')
          return (sql: string) => {
            if (sql.startsWith("UPDATE factory_jobs SET last_error = 'auto_retry:pending'"))
              w.db
                .prepare("INSERT INTO factory_jobs (id, material_id, kind, model, phase, status, brief_md, created_at, updated_at) VALUES ('human', 'm1', 'rework', 'x', 'making', 'cancelled', 'b', ?, ?)")
                .run(ago(1_000), ago(1_000));
            return t.prepare(sql);
          };
        const v = (t as unknown as Record<string | symbol, unknown>)[k];
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v;
      },
    });
    expect(await retryFailedReworkStep({ ...w.env, DB } as typeof w.env, { deadline: FAR() })).toEqual({ queued: [], skipped: [{ job_id: jid, reason: 'raced' }] });
    expect(lastError(jid)).toBeNull();
    expect(jobsOf('m1')).toEqual([]);
    expect(workStatus('m1')).toBe('idle');
  });

  it('queueJobForMaterial が 409 なら auto_retry:refused:material_busy で二度拾わない', async () => {
    const jid = seedFailed(1);
    // 素材は idle だが同じ素材に古い動いている job がある（作れない = 409 material_busy）
    w.db
      .prepare("INSERT INTO factory_jobs (id, material_id, kind, model, phase, status, brief_md, created_at, updated_at) VALUES ('older', 'm1', 'draft', 'x', 'making', 'running', 'b', '2026-01-02T00:00:00.000Z', ?)")
      .run(ago(60_000));
    expect(await retryFailedReworkStep(w.env, { deadline: FAR() })).toEqual({ queued: [], skipped: [{ job_id: jid, reason: 'material_busy' }] });
    expect(lastError(jid)).toBe('auto_retry:refused:material_busy');
    expect(retryLogs()).toEqual([{ at: 'auto_retry', job_id: jid, result: 'material_busy' }]);
    expect(await retryFailedReworkStep(w.env, { deadline: FAR() })).toEqual({ queued: [], skipped: [] });
  });
});
