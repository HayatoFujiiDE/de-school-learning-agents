// 確認の API（契約 V-7 e・f・V-8・V-11 u8）: 承認の追加の条件・チャンネルの信頼・読み直し・stats・自動公開のスイッチ・一覧と詳細の形。
import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import { deleteChannel, listChannels } from '../src/routes/channels';
import { decide, listReview, reread, reviewDetail, reviewStats, setAutoPublish } from '../src/routes/review';
import { computeTriage } from '../src/triage-step';
import { one, rows } from './d1-shim';
import { CH, WATCH, addVerification, ctx, fixable, good, material, okReading, seed, setSetting, world, type World } from './review-auto-helpers';

type Obj = Record<string, any>;
let w: World;
beforeEach(() => {
  w = world();
});

const OK = { result: 'ok', note: '' };
const ALL6 = Object.fromEntries(['content_and_evidence', 'explanation_and_expression', 'relation_to_learning', 'conditions_of_use', 'artifact_behavior', 'terms_of_use'].map((k) => [k, OK]));
const latest = (vid: string) => String(one(w.db, 'SELECT id FROM verifications WHERE material_version_id = ? ORDER BY attempt DESC LIMIT 1', vid).id);
const gen = (vid: string) => (one(w.db, 'SELECT reader_token FROM material_versions WHERE id = ?', vid).reader_token as string | null) ?? null;
const approve = (vid: string, o: Obj = {}, env?: Env) => {
  const c = ctx(w, 'POST', { decision: 'approve', verification_id: latest(vid), reader_gen: gen(vid), ...o });
  return decide(env ? { ...c, env } : c, vid);
};
const body = async (r: Response) => ({ status: r.status, json: (await r.json()) as Obj });
const vrow = (vid: string) => one(w.db, 'SELECT * FROM material_versions WHERE id = ?', vid) as Obj;
const videoSeed = (mid: string, vid: string, extra: Obj = {}) => good(mid, vid, { material: material({ video: true }), sources: { s1: {}, s9: { url: WATCH, url_was_fetched: 0, quote_found: 0 } }, ...extra });
/** 承認の batch を流す直前に mutate を当てる env（間にほかの処理がコミットした） */
const interleaved = (mutate: () => void): Env =>
  ({
    ...w.env,
    DB: {
      prepare: (s: string) => w.env.DB.prepare(s),
      async batch(st: unknown[]) {
        if (JSON.stringify(st).includes("'approve'")) mutate();
        return w.env.DB.batch(st as never);
      },
    },
  }) as unknown as Env;

describe('承認（契約 V-7 e）', () => {
  it('6 項目とも auto ok なら checklist を空で承認できる（machine_gate clean・6 項目 auto）', async () => {
    seed(w, good('m1', 'v1'));
    expect((await body(await approve('v1', { checklist: {} }))).status).toBe(200);
    const d = one(w.db, "SELECT machine_gate, checklist_json FROM review_decisions WHERE decision = 'approve'");
    expect(d.machine_gate).toBe('clean');
    expect(Object.values(JSON.parse(String(d.checklist_json)))).toEqual(Array(6).fill({ result: 'ok', note: 'auto' }));
    // checklist を送らなくても同じ
    seed(w, good('m2', 'v2'));
    expect((await approve('v2')).status).toBe(200);
  });

  it('auto が review の項目を省略すると 400 checklist_incomplete', async () => {
    // license_unknown は fix なので、回数を使い切った後（AUTO_RETURN_MAX 0）に人が見る
    w = world({ AUTO_RETURN_MAX: '0' });
    seed(w, good('m1', 'v1', { sources: { s1: { license: 'unknown' } } }));
    expect(await body(await approve('v1', { checklist: {} }))).toEqual({ status: 400, json: { error: 'checklist_incomplete' } });
    expect((await approve('v1', { checklist: { terms_of_use: OK } })).status).toBe(200);
  });

  it('video_channel_new があるのに trust_channels が足りないと 400。足りていれば trusted_channels に 1 行・trusted_gen が進み・ほかの確認待ちの版が仕分け直され・その動画の項目が消える', async () => {
    seed(w, videoSeed('m1', 'v1'));
    seed(w, videoSeed('m2', 'v2'));
    w.db.prepare("UPDATE material_versions SET triaged_verification_id = 'w-x', triage_v = 2, triage_gate = 'attention' WHERE id = 'v2'").run();
    expect(await body(await approve('v1', { checklist: { terms_of_use: OK } }))).toEqual({ status: 400, json: { error: 'channel_trust_required' } });
    const r = await approve('v1', { checklist: { terms_of_use: OK }, trust_channels: [CH, 'https://www.youtube.com/@extra'] });
    expect(r.status).toBe(200);
    expect(rows(w.db, 'SELECT channel_key, channel_name, channel_url, first_version_id, approved_by FROM trusted_channels')).toEqual([
      { channel_key: CH, channel_name: '公式チャンネル', channel_url: CH, first_version_id: 'v1', approved_by: 'ops@example.invalid' },
    ]);
    expect(one(w.db, "SELECT value FROM settings WHERE key = 'trusted_gen'").value).toBe('1');
    expect(vrow('v2').triaged_verification_id).toBeNull();
    const t2 = await computeTriage(w.env, vrow('v2') as never, { id: latest('v2'), result_json: String(one(w.db, 'SELECT result_json FROM verifications WHERE id = ?', latest('v2')).result_json) });
    expect(t2.items.some((i) => i.cause === 'video_channel_new')).toBe(false);
    expect([t2.gate, t2.trusted_keys, t2.trusted_gen]).toEqual(['clean', [CH], '1']);
  });

  it('承認が 0 行の時はチャンネルも足されず trusted_gen も進まない（409 conflict）', async () => {
    seed(w, videoSeed('m1', 'v1'));
    const env = interleaved(() => w.db.prepare("UPDATE material_versions SET reader_token = 'other' WHERE id = 'v1'").run());
    expect(await body(await approve('v1', { checklist: { terms_of_use: OK }, trust_channels: [CH] }, env))).toEqual({ status: 409, json: { error: 'conflict' } });
    expect(rows(w.db, 'SELECT * FROM trusted_channels')).toEqual([]);
    expect(rows(w.db, "SELECT * FROM settings WHERE key = 'trusted_gen'")).toEqual([]);
    expect(vrow('v1').status).toBe('review');
  });

  it('reader_gen が違えば 409 stale_reader', async () => {
    seed(w, good('m1', 'v1'));
    expect(await body(await approve('v1', { reader_gen: 'old' }))).toEqual({ status: 409, json: { error: 'stale_reader' } });
    expect(await body(await approve('v1', { reader_gen: null }))).toEqual({ status: 409, json: { error: 'stale_reader' } });
  });

  it('読み手係が pending（一時停止中）の版は承認でき、machine_gate pending が残る（読み手係の 3 項目は人が答える）', async () => {
    seed(w, good('m1', 'v1', { reader: 'pending' }));
    setSetting(w, 'paused', '1');
    expect(await body(await approve('v1', { checklist: {} }))).toEqual({ status: 400, json: { error: 'checklist_incomplete' } });
    const r = await approve('v1', { checklist: { explanation_and_expression: OK, relation_to_learning: OK, conditions_of_use: OK } });
    expect(r.status).toBe(200);
    expect(one(w.db, "SELECT machine_gate FROM review_decisions WHERE decision = 'approve'").machine_gate).toBe('pending');
  });

  it('承認の間に読み手係が済んでいれば 409 conflict（画面が読み直して項目を出す）', async () => {
    seed(w, good('m1', 'v1', { reader: 'pending' }));
    const env = interleaved(() => w.db.prepare("UPDATE material_versions SET reader_status = 'done', reader_token = 'rt-new', reader_json = ? WHERE id = 'v1'").run(JSON.stringify(okReading())));
    expect(await body(await approve('v1', { checklist: ALL6 }, env))).toEqual({ status: 409, json: { error: 'conflict' } });
    expect(vrow('v1').status).toBe('review');
  });

  it('検証は done なのに結果が読めない → 400 checks_pending / 検証が done でない → 400 verification_pending', async () => {
    seed(w, good('m1', 'v1'));
    w.db.prepare("UPDATE verifications SET result_json = 'x' WHERE material_version_id = 'v1'").run();
    expect(await body(await approve('v1', { checklist: ALL6 }))).toEqual({ status: 400, json: { error: 'checks_pending' } });
    w.db.prepare("UPDATE material_versions SET verification_status = 'running' WHERE id = 'v1'").run();
    expect(await body(await approve('v1', { checklist: ALL6 }))).toEqual({ status: 400, json: { error: 'verification_pending' } });
  });

  it('自動の処置が決まっている版は今の 409 auto_triage_pending（6 項目を全部回答していても）', async () => {
    seed(w, fixable('m1', 'v1'));
    expect(await body(await approve('v1', { checklist: ALL6 }))).toEqual({ status: 409, json: { error: 'auto_triage_pending', action: 'auto_return' } });
  });

  it('blocking の項目がある版は 400（contradicted・一次資料の未取得。動画の出典は除く）', async () => {
    w = world({ AUTO_RETURN_MAX: '0' });
    seed(w, { mid: 'm1', vid: 'v1', claims: [['contradicted', ['s1']]] });
    expect(await body(await approve('v1', { checklist: ALL6 }))).toEqual({ status: 400, json: { error: 'has_contradicted_claims' } });
    seed(w, { mid: 'm2', vid: 'v2', claims: [['confirmed', ['s1']]], sources: { s1: { is_primary: 1, url_was_fetched: 0 } } });
    expect(await body(await approve('v2', { checklist: ALL6 }))).toEqual({ status: 400, json: { error: 'primary_source_unfetched', message: 'c1:s1' } });
    // 動画の出典（一次・未取得）は止めない
    seed(w, videoSeed('m3', 'v3', { claims: [['confirmed', ['s9']]], sources: { s9: { url: WATCH, is_primary: 1, url_was_fetched: 0, quote_found: 0 } } }));
    expect((await approve('v3', { checklist: ALL6, trust_channels: [CH] })).status).toBe(200);
  });

  it('差し戻し・却下も machine_gate を記録する', async () => {
    seed(w, good('m1', 'v1'));
    expect((await decide(ctx(w, 'POST', { decision: 'reject', note: 'いらない' }), 'v1')).status).toBe(200);
    expect(one(w.db, "SELECT decision, machine_gate FROM review_decisions WHERE material_version_id = 'v1'")).toEqual({ decision: 'reject', machine_gate: 'clean' });
  });
});

describe('チャンネル（契約 V-7 f・V-8）', () => {
  const add = (key: string, at: string) => w.db.prepare("INSERT INTO trusted_channels (channel_key, channel_name, channel_url, first_version_id, approved_by, created_at) VALUES (?, 'n', ?, 'v', 'ops', ?)").run(key, key, at);
  it('一覧は新しい順', async () => {
    add('https://www.youtube.com/@a', '2026-11-01T00:00:00.000Z');
    add('https://www.youtube.com/@b', '2026-11-02T00:00:00.000Z');
    const b = await body(await listChannels(ctx(w, 'GET', undefined, 'http://localhost/api/channels')));
    expect(b.json.channels.map((c: Obj) => c.channel_key)).toEqual(['https://www.youtube.com/@b', 'https://www.youtube.com/@a']);
    expect(Object.keys(b.json.channels[0]).sort()).toEqual(['approved_by', 'channel_key', 'channel_name', 'channel_url', 'created_at', 'first_version_id']);
  });

  it('外す: 1 つの batch で、行を消し・確認待ちの版を仕分け直し・trusted_gen を進める。無い key は {deleted:false} で何も変わらない', async () => {
    add(CH, '2026-11-01T00:00:00.000Z');
    seed(w, good('m1', 'v1'));
    seed(w, good('m2', 'v2'));
    w.db.prepare("UPDATE material_versions SET triaged_verification_id = 'w', status = CASE id WHEN 'v2' THEN 'approved' ELSE status END").run();
    const del = (key: string) => deleteChannel(ctx(w, 'DELETE', undefined, `http://localhost/api/channels?key=${encodeURIComponent(key)}`));
    expect(await body(await del('https://www.youtube.com/@none'))).toEqual({ status: 200, json: { deleted: false } });
    expect([vrow('v1').triaged_verification_id, rows(w.db, "SELECT * FROM settings WHERE key = 'trusted_gen'")]).toEqual(['w', []]);
    expect(await body(await del(CH))).toEqual({ status: 200, json: { deleted: true } });
    expect(rows(w.db, 'SELECT * FROM trusted_channels')).toEqual([]);
    expect([vrow('v1').triaged_verification_id, vrow('v2').triaged_verification_id]).toEqual([null, 'w']);
    expect(one(w.db, "SELECT value FROM settings WHERE key = 'trusted_gen'").value).toBe('1');
    expect((await deleteChannel(ctx(w, 'DELETE', undefined, 'http://localhost/api/channels'))).status).toBe(400);
  });
});

describe('読み直し（契約 V-4 h）', () => {
  it('done / failed → pending・attempts 0・token NULL・triaged_verification_id NULL。running は 409 reader_running、確認待ちでなければ 409 not_in_review', async () => {
    seed(w, good('m1', 'v1'));
    w.db.prepare("UPDATE material_versions SET reader_attempts = 2, triaged_verification_id = 'w' WHERE id = 'v1'").run();
    expect(await body(await reread(ctx(w, 'POST'), 'v1'))).toEqual({ status: 200, json: { version_id: 'v1', reader_status: 'pending' } });
    expect(one(w.db, "SELECT reader_status, reader_attempts, reader_token, triaged_verification_id FROM material_versions WHERE id = 'v1'")).toEqual({
      reader_status: 'pending',
      reader_attempts: 0,
      reader_token: null,
      triaged_verification_id: null,
    });
    expect(await body(await reread(ctx(w, 'POST'), 'v1'))).toEqual({ status: 409, json: { error: 'reader_running' } });
    w.db.prepare("UPDATE material_versions SET reader_status = 'failed', status = 'approved' WHERE id = 'v1'").run();
    expect(await body(await reread(ctx(w, 'POST'), 'v1'))).toEqual({ status: 409, json: { error: 'not_in_review' } });
    expect((await reread(ctx(w, 'POST'), 'nope')).status).toBe(404);
  });
});

describe('stats と自動公開のスイッチ（契約 V-8）', () => {
  it('clean の人の判断の数・新しい順に approve が続いた数・自動で公開した数', async () => {
    const d = (id: string, decision: string, gate: string | null, who: string, at: string) =>
      w.db.prepare("INSERT INTO review_decisions (id, material_version_id, material_id, decision, reviewer_email, machine_gate, created_at) VALUES (?, NULL, 'm', ?, ?, ?, ?)").run(id, decision, who, gate, at);
    d('d1', 'approve', 'clean', 'ops@x', '2026-11-01T00:00:00.000Z');
    d('d2', 'return', 'clean', 'ops@x', '2026-11-02T00:00:00.000Z');
    d('d3', 'approve', 'clean', 'ops@x', '2026-11-03T00:00:00.000Z');
    d('d4', 'approve', 'clean', 'ops@x', '2026-11-04T00:00:00.000Z');
    d('d5', 'reject', 'attention', 'ops@x', '2026-11-05T00:00:00.000Z');
    d('d6', 'approve', 'clean', 'system:auto-publish', '2026-11-06T00:00:00.000Z');
    d('d7', 'return', 'attention', 'system:auto-triage', '2026-11-06T00:00:00.000Z');
    expect(await body(await reviewStats(ctx(w, 'GET')))).toEqual({ status: 200, json: { auto_publish: false, clean: { approve: 3, return: 1, reject: 0 }, streak: 2, auto_published: 1 } });
  });

  it('POST /api/review/auto-publish {on} → settings auto_publish を 1 / 0。on が真偽値でなければ 400', async () => {
    expect(await body(await setAutoPublish(ctx(w, 'POST', { on: true })))).toEqual({ status: 200, json: { auto_publish: true } });
    expect(one(w.db, "SELECT value FROM settings WHERE key = 'auto_publish'").value).toBe('1');
    expect((await body(await reviewStats(ctx(w, 'GET')))).json.auto_publish).toBe(true);
    expect(await body(await setAutoPublish(ctx(w, 'POST', { on: false })))).toEqual({ status: 200, json: { auto_publish: false } });
    expect(one(w.db, "SELECT value FROM settings WHERE key = 'auto_publish'").value).toBe('0');
    expect((await setAutoPublish(ctx(w, 'POST', { on: 'yes' }))).status).toBe(400);
  });
});

describe('一覧と詳細の形（契約 V-8）', () => {
  it('一覧の各行に gate・pending_on・fix・ask・note・needs_review（fix + ask）・auto_ok（0〜6）。needs_review の多い順 → 作成の古い順', async () => {
    seed(w, good('m1', 'v1', { created_at: '2026-11-07T00:01:00.000Z' }));
    seed(w, fixable('m2', 'v2', { created_at: '2026-11-07T00:02:00.000Z' }));
    seed(w, good('m3', 'v3', { created_at: '2026-11-07T00:00:00.000Z', reader: 'pending' }));
    const b = await body(await listReview(ctx(w, 'GET')));
    expect(b.json.versions.map((r: Obj) => [r.version_id, r.gate, r.pending_on, r.fix, r.ask, r.note, r.needs_review, r.auto_ok])).toEqual([
      ['v2', 'attention', [], 1, 0, 0, 1, 5],
      ['v3', 'pending', ['reader'], 0, 0, 0, 0, 3],
      ['v1', 'clean', [], 0, 0, 0, 0, 6],
    ]);
  });

  it('詳細に triage（pending_on を含む）・reader・verification.apps・claims[].presented_as・auto_publish', async () => {
    seed(w, {
      mid: 'm1',
      vid: 'v1',
      claims: [['confirmed', ['s1'], 'fact'], ['hypothesis', ['s1'], 'hedged'], ['confirmed', ['s1'], 'bogus']],
      material: material({ app: true }),
      apps: [{ path: 'parts/p1/app.html', verdict: 'ok', reason: '動く' }],
      readerJson: okReading({ summary: '読める', findings: [{ path: '', quote: 'q', kind: 'other', severity: 'note', note: 'n', suggestion: 's' }] }),
    });
    w.db.prepare("UPDATE material_versions SET reader_cost_cents = 7 WHERE id = 'v1'").run();
    const b = (await body(await reviewDetail(ctx(w, 'GET'), 'v1'))).json;
    expect(b.triage).toMatchObject({ gate: 'clean', pending_on: [], reader_gen: 'rt-v1', trusted_gen: '0' });
    expect(b.reader).toEqual({
      status: 'done',
      gen: 'rt-v1',
      findings: [{ path: '', quote: 'q', kind: 'other', severity: 'note', note: 'n', suggestion: 's' }],
      learning: { verdict: 'ok', reason: '' },
      conditions: { verdict: 'ok', reason: '' },
      summary: '読める',
      not_read: [],
      cost_cents: 7,
    });
    expect(b.verification.apps).toEqual([{ path: 'parts/p1/app.html', verdict: 'ok', reason: '動く' }]);
    expect(b.claims.map((c: Obj) => c.presented_as)).toEqual(['fact', 'hedged', null]);
    expect(b.auto_publish).toBe(false);
    // 古い検証（apps が無い）は null。読み手係が done でなければ findings 等は null
    addVerification(w, 'v1', ['confirmed'], { apps: null });
    w.db.prepare("UPDATE material_versions SET reader_status = 'running' WHERE id = 'v1'").run();
    const b2 = (await body(await reviewDetail(ctx(w, 'GET'), 'v1'))).json;
    expect(b2.verification.apps).toBeNull();
    expect(b2.reader).toMatchObject({ status: 'running', findings: null, learning: null, summary: null, not_read: null });
    expect(b2.triage.pending_on).toEqual(['reader']);
  });
});
