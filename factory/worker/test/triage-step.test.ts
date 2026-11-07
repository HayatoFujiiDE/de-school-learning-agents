// cron の triageStep・autoPublishStep（契約 V-7・V-11 u7）と人の reverify を node:sqlite の実 DB で確かめる。
import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import { reverify } from '../src/routes/review';
import { AUTO_PUBLISH_EMAIL, AUTO_TRIAGE_EMAIL, applyTriage, autoPublishStep, autoRoundsOf, computeTriage, triageStep, type TriageApplyRow } from '../src/triage-step';
import { one, rows } from './d1-shim';
import { CH, WATCH, addVerification, ctx, fixable, good, material, seed, setSetting, world, type V, type World } from './review-auto-helpers';

const FAR = () => Date.now() + 10 * 60_000;
let w: World;
let env: Env;

beforeEach(() => {
  w = world();
  env = w.env;
});

const versionRow = (vid: string) => one(w.db, 'SELECT * FROM material_versions WHERE id = ?', vid) as unknown as TriageApplyRow & Record<string, unknown>;
const latestOf = (vid: string) => one(w.db, 'SELECT id, result_json FROM verifications WHERE material_version_id = ? ORDER BY attempt DESC LIMIT 1', vid) as { id: string; result_json: string };
const count = (sql: string, ...p: Array<string | number>) => Number(one(w.db, sql, ...p).n);
const vcol = (vid: string, cols: string) => one(w.db, `SELECT ${cols} FROM material_versions WHERE id = ?`, vid);
/** 版 vid の rework job（差し戻しで作られた）を done にし、その job の版を作る */
function reworkVersion(parentVid: string, s: Parameters<typeof seed>[1]) {
  const job = one(w.db, "SELECT id FROM factory_jobs WHERE kind = 'rework' AND parent_version_id = ?", parentVid).id as string;
  w.db.prepare("UPDATE factory_jobs SET status = 'done', session_id = ? WHERE id = ?").run(`sesn-${s.vid}`, job);
  return seed(w, { ...s, jobId: job, newMaterial: false });
}

describe('triageStep（契約 V-7 b）', () => {
  it('auto_return: rework job が queued・版 rejected・standards_log は増えない・review_decisions は system:auto-triage（machine_gate attention）', async () => {
    seed(w, fixable('m1', 'v1'));
    expect(await triageStep(env, { deadline: FAR() })).toEqual(['auto_return']);
    expect(vcol('v1', 'status, verification_status')).toEqual({ status: 'rejected', verification_status: 'done' });
    const jobs = rows(w.db, "SELECT kind, model, status, session_id, parent_version_id, budget_cents, brief_md FROM factory_jobs WHERE material_id = 'm1' AND kind = 'rework'");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ model: 'claude-opus-5-5', status: 'queued', session_id: null, parent_version_id: 'v1', budget_cents: 1000 });
    expect(String(jobs[0].brief_md)).toContain('## 差し戻し理由（v1）\n自動の差し戻し（1 回目。機械の確認で、直す所が見つかりました）。');
    expect(one(w.db, "SELECT work_status FROM materials WHERE id = 'm1'").work_status).toBe('queued');
    expect(count('SELECT COUNT(*) AS n FROM standards_log')).toBe(0);
    expect(rows(w.db, "SELECT decision, reviewer_email, checklist_json, machine_gate FROM review_decisions WHERE material_version_id = 'v1'")).toEqual([
      { decision: 'return', reviewer_email: AUTO_TRIAGE_EMAIL, checklist_json: null, machine_gate: 'attention' },
    ]);
  });

  it('続けて 2 回（AUTO_RETURN_MAX 既定 2）自動で差し戻した後の版は none で人に出る（triage_v 2・triage_gate attention）', async () => {
    seed(w, fixable('m1', 'v1'));
    expect(await triageStep(env, { deadline: FAR() })).toEqual(['auto_return']);
    reworkVersion('v1', fixable('m1', 'v2', { version: 2, created_at: '2026-11-07T01:00:00.000Z' }));
    expect(await triageStep(env, { deadline: FAR() })).toEqual(['auto_return']);
    const { wid } = reworkVersion('v2', fixable('m1', 'v3', { version: 3, created_at: '2026-11-07T02:00:00.000Z' }));
    expect(await triageStep(env, { deadline: FAR() })).toEqual(['none']);
    expect(vcol('v3', 'status, triaged_verification_id, triage_v, triage_gate')).toEqual({ status: 'review', triaged_verification_id: wid, triage_v: 2, triage_gate: 'attention' });
    expect(await triageStep(env, { deadline: FAR() })).toEqual([]); // 処置なしの記録で次から対象外
    // AUTO_RETURN_MAX = 0 なら最初から人に出る
    const w0 = world({ AUTO_RETURN_MAX: '0' });
    seed(w0, fixable('m9', 'v9'));
    expect(await triageStep(w0.env, { deadline: FAR() })).toEqual(['none']);
  });

  it('autoRounds: 自動 → 自動 → 人 → 自動 の後の版は 1。親なしは 0。自動で差し戻した版を親にした人の注文は数え直さない', async () => {
    const t = '2026-11-07T00:00:00.000Z';
    const job = (id: string, parent: string | null) =>
      w.db.prepare("INSERT INTO factory_jobs (id, material_id, kind, model, phase, status, parent_version_id, brief_md, created_at, updated_at) VALUES (?, 'm', ?, 'x', 'making', 'done', ?, 'b', ?, ?)").run(id, parent ? 'rework' : 'draft', parent, t, t);
    const ver = (id: string, jobId: string, n: number) =>
      w.db
        .prepare("INSERT INTO material_versions (id, material_id, version, job_id, session_id, r2_prefix, content_sha256, material_json, claims_json, adapt_rules_md, checks_json, public_paths_json, status, created_at) VALUES (?, 'm', ?, ?, 's', 'p/', 'h', '{}', '{}', 'a', '{}', '[]', 'rejected', ?)")
        .run(id, n, jobId, t);
    const ret = (vid: string, who: string) => w.db.prepare("INSERT INTO review_decisions (id, material_version_id, material_id, decision, reviewer_email, created_at) VALUES (?, ?, 'm', 'return', ?, ?)").run(`d-${vid}`, vid, who, t);
    w.db.prepare("INSERT INTO materials (id, slug, title, kinds_json, work_status, brief_md, created_at, updated_at) VALUES ('m', 's', 't', '[3]', 'review', 'b', ?, ?)").run(t, t);
    job('j1', null);
    ver('a1', 'j1', 1);
    ret('a1', AUTO_TRIAGE_EMAIL);
    job('j2', 'a1');
    ver('a2', 'j2', 2);
    ret('a2', AUTO_TRIAGE_EMAIL);
    job('j3', 'a2');
    ver('a3', 'j3', 3);
    ret('a3', 'ops@example.invalid');
    job('j4', 'a3');
    ver('a4', 'j4', 4);
    ret('a4', AUTO_TRIAGE_EMAIL);
    job('j5', 'a4');
    expect([await autoRoundsOf(env.DB, 'j1'), await autoRoundsOf(env.DB, 'j3'), await autoRoundsOf(env.DB, 'j4'), await autoRoundsOf(env.DB, 'j5')]).toEqual([0, 2, 0, 1]);
    // 人の注文（parent は自動で差し戻した版）は数え直さない
    job('jh', 'a2');
    expect(await autoRoundsOf(env.DB, 'jh')).toBe(2);
  });

  it('書き込みが成立した版が 3 件になったら止める（処置なしの 3 件の後の 4 件目は次の cron）', async () => {
    for (let i = 1; i <= 3; i++) seed(w, good(`m${i}`, `v${i}`, { created_at: `2026-11-07T00:0${i}:00.000Z` }));
    seed(w, fixable('m4', 'v4', { created_at: '2026-11-07T00:09:00.000Z' }));
    expect(await triageStep(env, { deadline: FAR() })).toEqual(['none', 'none', 'none']);
    expect(vcol('v4', 'status, triaged_verification_id')).toEqual({ status: 'review', triaged_verification_id: null });
    expect(await triageStep(env, { deadline: FAR() })).toEqual(['auto_return']);
  });

  it('active な job がある素材の版（busy）が先頭に 3 件あっても、4 件目以降の版が処置される（10 件まで読む）', async () => {
    for (let i = 1; i <= 3; i++) {
      seed(w, fixable(`m${i}`, `v${i}`, { created_at: `2026-11-07T00:0${i}:00.000Z` }));
      w.db.prepare("INSERT INTO factory_jobs (id, material_id, kind, model, phase, status, brief_md, created_at, updated_at) VALUES (?, ?, 'rework', 'x', 'questions', 'queued', 'b', 't', 't')").run(`busy-${i}`, `m${i}`);
    }
    seed(w, good('m4', 'v4', { created_at: '2026-11-07T00:05:00.000Z' }));
    seed(w, fixable('m5', 'v5', { created_at: '2026-11-07T00:06:00.000Z' }));
    expect(await triageStep(env, { deadline: FAR() })).toEqual(['busy', 'busy', 'busy', 'none', 'auto_return']);
    expect(count("SELECT COUNT(*) AS n FROM review_decisions WHERE material_version_id IN ('v1','v2','v3')")).toBe(0);
  });

  it('gate が pending（検証の結果が読めない）の版には何も書かず、次の cron でまた見る', async () => {
    const { vid } = seed(w, good('m1', 'v1'));
    w.db.prepare("UPDATE verifications SET result_json = 'not json' WHERE material_version_id = ?").run(vid);
    expect(await triageStep(env, { deadline: FAR() })).toEqual(['pending']);
    expect(vcol('v1', 'triaged_verification_id, triage_v, triage_gate')).toEqual({ triaged_verification_id: null, triage_v: 0, triage_gate: null });
    expect(await triageStep(env, { deadline: FAR() })).toEqual(['pending']);
  });

  it('読み手係が pending / running の版は対象にしない。failed の版は対象', async () => {
    seed(w, good('m1', 'v1', { reader: 'pending' }));
    seed(w, good('m2', 'v2', { reader: 'failed' }));
    expect(await triageStep(env, { deadline: FAR() })).toEqual(['none']);
    expect(vcol('v2', 'triage_gate')).toEqual({ triage_gate: 'attention' });
  });

  it('triage_v < 2 の版は仕分け直される（古い Worker が triaged_verification_id を書いた後でも）', async () => {
    const { wid } = seed(w, good('m1', 'v1'));
    w.db.prepare('UPDATE material_versions SET triaged_verification_id = ? WHERE id = ?').run(wid, 'v1');
    expect(await triageStep(env, { deadline: FAR() })).toEqual(['none']);
    expect(vcol('v1', 'triage_v, triage_gate')).toEqual({ triage_v: 2, triage_gate: 'clean' });
  });

  it('締め切りを過ぎていれば処置しない', async () => {
    seed(w, fixable('m1', 'v1'));
    expect(await triageStep(env, { deadline: Date.now() })).toEqual(['skipped_time']);
    expect(vcol('v1', 'status')).toEqual({ status: 'review' });
  });

  it('reverify（limit）: 取得上限 → 1 回だけ自動で再検証し、再び同じなら ask のまま人に出る', async () => {
    const lim: Parameters<typeof seed>[1] = { mid: 'm1', vid: 'v1', claims: [['confirmed', ['s1']], ['unverified', ['s1']]], fetchErrors: { max_uses_exceeded: 2 } };
    seed(w, lim);
    expect(await triageStep(env, { deadline: FAR() })).toEqual(['reverify']);
    expect(vcol('v1', 'verification_status, verification_attempts, auto_reverified, evidence_reverified, triaged_verification_id')).toEqual({
      verification_status: 'pending',
      verification_attempts: 0,
      auto_reverified: 1,
      evidence_reverified: 0,
      triaged_verification_id: null,
    });
    expect(await triageStep(env, { deadline: FAR() })).toEqual([]); // pending の間は対象外
    addVerification(w, 'v1', [['confirmed', ['s1']], ['unverified', ['s1']]], { fetchErrors: { max_uses_exceeded: 2 } });
    w.db.prepare("UPDATE material_versions SET verification_status = 'done', verification_attempts = 1 WHERE id = 'v1'").run();
    expect(await triageStep(env, { deadline: FAR() })).toEqual(['none']);
    expect(vcol('v1', 'triage_gate')).toEqual({ triage_gate: 'attention' });
  });

  it('reverify（evidence）: 古い入力の検証で hypothesis がある → 1 回だけ（evidence_reverified）。再び古い検証なら hypothesis_unjudged の ask だけで人に出る', async () => {
    seed(w, { mid: 'm1', vid: 'v1', claims: [['confirmed', ['s1']], ['hypothesis', ['s1'], null]], old: true });
    expect(await triageStep(env, { deadline: FAR() })).toEqual(['reverify']);
    expect(vcol('v1', 'verification_status, auto_reverified, evidence_reverified')).toEqual({ verification_status: 'pending', auto_reverified: 0, evidence_reverified: 1 });
    addVerification(w, 'v1', [['confirmed', ['s1']], ['hypothesis', ['s1'], null]], { old: true });
    w.db.prepare("UPDATE material_versions SET verification_status = 'done' WHERE id = 'v1'").run();
    expect(await triageStep(env, { deadline: FAR() })).toEqual(['none']);
  });

  describe('判定の後に世代が変わった → どの処置も 0 行（stale）', () => {
    it('新しい verification（status は done のまま）: none・reverify・auto_return', async () => {
      seed(w, good('m1', 'v1'));
      seed(w, { mid: 'm2', vid: 'v2', claims: [['confirmed', ['s1']], ['unverified', ['s1']]], fetchErrors: { max_uses_exceeded: 1 } });
      seed(w, fixable('m3', 'v3'));
      const ts = ['v1', 'v2', 'v3'].map(async (vid) => [vid, await computeTriage(env, versionRow(vid), latestOf(vid))] as const);
      const done = await Promise.all(ts);
      expect(done.map(([, t]) => t.action)).toEqual(['none', 'reverify', 'auto_return']);
      for (const [vid] of done) addVerification(w, vid, ['confirmed', 'confirmed']);
      for (const [vid, t] of done) expect(await applyTriage(env, versionRow(vid), t)).toBe('stale');
      expect(vcol('v1', 'triaged_verification_id')).toEqual({ triaged_verification_id: null });
      expect(vcol('v2', 'verification_status, auto_reverified')).toEqual({ verification_status: 'done', auto_reverified: 0 });
      expect(count('SELECT COUNT(*) AS n FROM review_decisions')).toBe(0);
      expect(count("SELECT COUNT(*) AS n FROM factory_jobs WHERE kind = 'rework'")).toBe(0);
    });

    it('読み直し（reader_status pending・token NULL）: none・reverify・auto_return のどれも 0 行', async () => {
      seed(w, good('m1', 'v1'));
      seed(w, { mid: 'm2', vid: 'v2', claims: [['confirmed', ['s1']], ['unverified', ['s1']]], fetchErrors: { max_uses_exceeded: 1 } });
      seed(w, fixable('m3', 'v3'));
      const done = await Promise.all(['v1', 'v2', 'v3'].map(async (vid) => [vid, versionRow(vid), await computeTriage(env, versionRow(vid), latestOf(vid))] as const));
      w.db.prepare("UPDATE material_versions SET reader_status = 'pending', reader_attempts = 0, reader_token = NULL, triaged_verification_id = NULL").run();
      for (const [, row, t] of done) expect(await applyTriage(env, row, t)).toBe('stale');
      expect(count('SELECT COUNT(*) AS n FROM review_decisions')).toBe(0);
      expect(rows(w.db, 'SELECT verification_status, triage_v FROM material_versions ORDER BY id')).toEqual([
        { verification_status: 'done', triage_v: 0 },
        { verification_status: 'done', triage_v: 0 },
        { verification_status: 'done', triage_v: 0 },
      ]);
    });

    it('人の reverify: auto_return は 0 行（reverify は verify_* と triaged_verification_id をすべて戻す）', async () => {
      seed(w, fixable('m1', 'v1'));
      w.db.prepare("UPDATE material_versions SET verification_token = 'tok-old', verify_batch_id = 'b', verify_turn = 3, triaged_verification_id = 'w-old' WHERE id = 'v1'").run();
      const t = await computeTriage(env, versionRow('v1'), latestOf('v1'));
      expect(t.action).toBe('auto_return');
      expect((await reverify(ctx(w, 'POST'), 'v1')).status).toBe(200);
      expect(vcol('v1', 'verification_status, verification_token, verify_batch_id, verify_turn, triaged_verification_id')).toEqual({
        verification_status: 'pending',
        verification_token: null,
        verify_batch_id: null,
        verify_turn: 0,
        triaged_verification_id: null,
      });
      expect(await applyTriage(env, versionRow('v1'), t)).toBe('stale');
      expect(count('SELECT COUNT(*) AS n FROM review_decisions')).toBe(0);
    });

    it('チャンネルが足された（trusted_gen が進んだ）→ none は 0 行で、次の cron で clean と書かれる', async () => {
      seed(w, good('m1', 'v1', { material: material({ video: true }), sources: { s1: {}, s9: { url: WATCH, url_was_fetched: 0, quote_found: 0 } } }));
      const t = await computeTriage(env, versionRow('v1'), latestOf('v1'));
      expect([t.gate, t.action, t.trusted_gen, t.items.map((i) => i.cause)]).toEqual(['attention', 'none', '0', ['video_channel_new']]);
      w.db.prepare("INSERT INTO trusted_channels (channel_key, channel_name, channel_url, approved_by, created_at) VALUES (?, '公式', ?, 'ops', 't')").run(CH, CH);
      setSetting(w, 'trusted_gen', '1');
      expect(await applyTriage(env, versionRow('v1'), t)).toBe('stale');
      expect(await triageStep(env, { deadline: FAR() })).toEqual(['none']);
      expect(vcol('v1', 'triage_gate')).toEqual({ triage_gate: 'clean' });
    });
  });

  it('人の reverify は failed の版でも verify_* と triaged_verification_id をすべて戻す', async () => {
    seed(w, good('m1', 'v1'));
    w.db.prepare("UPDATE material_versions SET verification_status = 'failed', verification_token = 'x', triaged_verification_id = 'w' WHERE id = 'v1'").run();
    expect((await reverify(ctx(w, 'POST'), 'v1')).status).toBe(200);
    expect(vcol('v1', 'verification_status, verification_token, triaged_verification_id')).toEqual({ verification_status: 'pending', verification_token: null, triaged_verification_id: null });
  });
});

describe('autoPublishStep（契約 V-7 d）', () => {
  /** 仕分けが clean と記録した版 */
  async function cleanVersion(mid: string, vid: string, created = '2026-11-07T00:00:00.000Z') {
    seed(w, good(mid, vid, { created_at: created }));
    const t = await computeTriage(env, versionRow(vid), latestOf(vid));
    expect(t.gate).toBe('clean');
    expect(await applyTriage(env, versionRow(vid), t)).toBe('none');
  }

  it('settings auto_publish が 1 でなければ何もしない。一時停止中も何もしない', async () => {
    await cleanVersion('m1', 'v1');
    expect(await autoPublishStep(env, { deadline: FAR() })).toEqual([]);
    setSetting(w, 'auto_publish', '1');
    setSetting(w, 'paused', '1');
    expect(await autoPublishStep(env, { deadline: FAR() })).toEqual(['paused']);
    expect(vcol('v1', 'status')).toEqual({ status: 'review' });
  });

  it('1 なら clean の版を公開する（system:auto-publish・machine_gate clean・checklist 6 項目 auto）', async () => {
    await cleanVersion('m1', 'v1');
    setSetting(w, 'auto_publish', '1');
    expect(await autoPublishStep(env, { deadline: FAR() })).toEqual(['published']);
    expect(vcol('v1', 'status')).toEqual({ status: 'approved' });
    expect(one(w.db, "SELECT publish_status, current_version_id FROM materials WHERE id = 'm1'")).toEqual({ publish_status: 'available', current_version_id: 'v1' });
    const d = one(w.db, "SELECT decision, reviewer_email, machine_gate, checklist_json FROM review_decisions WHERE material_version_id = 'v1'");
    expect(d).toMatchObject({ decision: 'approve', reviewer_email: AUTO_PUBLISH_EMAIL, machine_gate: 'clean' });
    expect(Object.values(JSON.parse(String(d.checklist_json)))).toEqual(Array(6).fill({ result: 'ok', note: 'auto' }));
  });

  it('先頭に attention の版が 20 件以上あっても clean の版が公開される', async () => {
    for (let i = 0; i < 21; i++) {
      seed(w, fixable(`a${i}`, `va${i}`, { created_at: `2026-11-06T00:${String(i).padStart(2, '0')}:00.000Z` }));
      w.db.prepare("UPDATE material_versions SET triage_v = 2, triage_gate = 'attention', triaged_verification_id = (SELECT id FROM verifications WHERE material_version_id = material_versions.id) WHERE id = ?").run(`va${i}`);
    }
    await cleanVersion('m1', 'v1');
    setSetting(w, 'auto_publish', '1');
    expect(await autoPublishStep(env, { deadline: FAR() })).toEqual(['published']);
  });

  /** approve の batch を流す直前に mutate を当てる env（間に人やほかの cron がコミットした） */
  const interleaved = (mutate: () => void): Env =>
    ({
      ...env,
      DB: {
        prepare: (s: string) => env.DB.prepare(s),
        async batch(st: unknown[]) {
          if (JSON.stringify(st).includes(AUTO_PUBLISH_EMAIL)) mutate();
          return env.DB.batch(st as never);
        },
      },
    }) as unknown as Env;

  it.each([
    ['スイッチが切られた', () => setSetting(w, 'auto_publish', '0')],
    ['読み直された', () => w.db.prepare("UPDATE material_versions SET reader_status = 'pending', reader_token = NULL WHERE id = 'v1'").run()],
  ])('公開の直前に%s → 0 行（何もしない）', async (_n, mutate) => {
    await cleanVersion('m1', 'v1');
    setSetting(w, 'auto_publish', '1');
    expect(await autoPublishStep(interleaved(mutate), { deadline: FAR() })).toEqual(['skipped']);
    expect(vcol('v1', 'status')).toEqual({ status: 'review' });
    expect(count('SELECT COUNT(*) AS n FROM review_decisions')).toBe(0);
  });

  it('公開の直前にチャンネルが外された → 0 行', async () => {
    seed(w, good('m1', 'v1', { material: material({ video: true }), sources: { s1: {}, s9: { url: WATCH } } }));
    w.db.prepare("INSERT INTO trusted_channels (channel_key, channel_name, channel_url, approved_by, created_at) VALUES (?, '公式', ?, 'ops', 't')").run(CH, CH);
    expect(await triageStep(env, { deadline: FAR() })).toEqual(['none']);
    expect(vcol('v1', 'triage_gate')).toEqual({ triage_gate: 'clean' });
    setSetting(w, 'auto_publish', '1');
    expect(await autoPublishStep(interleaved(() => w.db.prepare('DELETE FROM trusted_channels').run()), { deadline: FAR() })).toEqual(['skipped']);
    expect(vcol('v1', 'status')).toEqual({ status: 'review' });
  });

  it('active な job がある素材は 0 行で、次の cron でまた見る（job が終われば公開）', async () => {
    await cleanVersion('m1', 'v1');
    setSetting(w, 'auto_publish', '1');
    w.db.prepare("INSERT INTO factory_jobs (id, material_id, kind, model, phase, status, brief_md, created_at, updated_at) VALUES ('busy', 'm1', 'rework', 'x', 'making', 'running', 'b', 't', 't')").run();
    expect(await autoPublishStep(env, { deadline: FAR() })).toEqual(['skipped']);
    w.db.prepare("UPDATE factory_jobs SET status = 'done' WHERE id = 'busy'").run();
    expect(await autoPublishStep(env, { deadline: FAR() })).toEqual(['published']);
  });

  it('やり直した gate が clean でなかった版は triage_gate を書き直す（GUARD つき）', async () => {
    await cleanVersion('m1', 'v1');
    setSetting(w, 'auto_publish', '1');
    // 読み手係の結果が（記録の後で）壊れた → 読み手チェックができなかった扱い → attention
    w.db.prepare("UPDATE material_versions SET reader_json = 'x' WHERE id = 'v1'").run();
    expect(await autoPublishStep(env, { deadline: FAR() })).toEqual(['regated']);
    expect(vcol('v1', 'status, triage_gate')).toEqual({ status: 'review', triage_gate: 'attention' });
  });
});
