// smoke（契約 §H (a)〜(e),(g)〜(i),(k)〜(n)、§K-8 (o)〜(s)、§L-7 (l5)、§N-5 (n2)(n3)、§N-6-7 (n6c)、§O-8 (i1)〜(i12)）。scripts/smoke.sh が wrangler dev（fake）を起動してから呼ぶ。
// 出力: 1 行ずつ `PASS <名前>` / `FAIL <名前> <理由>`。最後に SMOKE_RESULT=PASS|FAIL。応答本文は必要な field だけを見る。
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import vm from 'node:vm';

const BASE = process.env.SMOKE_BASE ?? 'http://localhost:8787';
const KEY = process.env.SMOKE_WEBHOOK_KEY ?? '';
const RUN = crypto.randomBytes(3).toString('hex');
let failed = 0;
const pass = (name) => console.log(`PASS ${name}`);
const fail = (name, why) => {
  failed++;
  console.log(`FAIL ${name} ${why}`);
};
const check = (name, cond, why = '') => (cond ? pass(name) : fail(name, why));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, body, opts = {}) {
  const headers = { accept: 'application/json', ...(opts.headers ?? {}) };
  if (method !== 'GET' && opts.origin !== false) headers.origin = opts.origin ?? BASE;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text, headers: res.headers };
}

function sign(id, body) {
  const ts = Math.floor(Date.now() / 1000);
  const secret = Buffer.from(KEY.replace(/^whsec_/, ''), 'base64');
  const sig = crypto.createHmac('sha256', secret).update(`${id}.${ts}.${body}`).digest('base64');
  return { 'webhook-id': id, 'webhook-timestamp': String(ts), 'webhook-signature': `v1,${sig}` };
}

const webhookBody = (eventId, sessionId, type = 'session.status_idled') =>
  JSON.stringify({ type: 'event', id: eventId, created_at: new Date().toISOString(), data: { type, id: sessionId, organization_id: 'org_fake', workspace_id: 'wrkspc_fake' } });

async function webhook(eventId, sessionId, bodyOverride) {
  const body = bodyOverride ?? webhookBody(eventId, sessionId);
  const res = await fetch(BASE + '/webhook', { method: 'POST', headers: { 'content-type': 'application/json', ...sign(`msg_${eventId}`, body) }, body });
  return { status: res.status, body };
}

async function waitJob(jobId, pred, timeoutMs = 25_000) {
  const until = Date.now() + timeoutMs;
  let j = null;
  while (Date.now() < until) {
    j = (await api('GET', `/api/jobs/${jobId}`)).json?.job ?? null;
    if (j && pred(j)) return j;
    await sleep(300);
  }
  return j;
}

async function setScenario(s) {
  const r = await api('POST', '/__fake/settings', { scenario: s });
  if (r.status !== 200) throw new Error(`setScenario ${s} -> ${r.status}`);
}

async function create(scenario, tag) {
  await setScenario(scenario);
  return api('POST', '/api/materials', {
    title: `smoke ${tag}`,
    slug: `smoke-${tag}-${RUN}`,
    catalog_item_id: 'mc-redstone',
    kinds: [3, 4],
    concept_codes: [],
    kind: 'draft',
    parent_version_id: null,
    brief_md: 'smoke 用の注文票（個人情報なし）',
    no_personal_data: true,
  });
}

async function calls(sessionId) {
  return (await api('GET', `/__fake/calls?session_id=${encodeURIComponent(sessionId)}`)).json?.calls ?? [];
}

async function cron() {
  const r = await fetch(`${BASE}/__scheduled?cron=*/10+*+*+*+*`);
  await r.text();
  return r.status;
}

async function cronUntil(versionId, pred, max = 15) {
  let d = null;
  for (let i = 0; i < max; i++) {
    await cron();
    d = (await api('GET', `/api/review/${versionId}`)).json;
    if (d && pred(d)) return d;
  }
  return d;
}

/**
 * 契約 V-7: 機械の確認が落ち着いた（検証 done・読み手係も済んで gate が pending でない・自動の処置（再検証・差し戻し）が決まっていない）か、
 * もう確認待ちでない（自動の差し戻しで rejected 等）。cron の読み手係 → 検証 → 仕分けの段を回して待つ時の条件
 */
const settled = (d) =>
  (!!d?.version && d.version.status !== 'review') ||
  (d?.version?.verification_status === 'done' && !!d?.triage && d.triage.gate !== 'pending' && d.triage.action === 'none');

/** 承認の body（契約 V-7 e: 画面が読んだ読み手係の世代 reader_gen と、初めてのチャンネルを確認済みにする trust_channels を添える） */
const approveBody = (d, extra = {}) => ({
  decision: 'approve',
  checklist: ALL_OK,
  note: '',
  verification_id: d?.verification_id,
  reader_gen: d?.reader?.gen ?? null,
  trust_channels: (d?.triage?.items ?? []).filter((i) => i.cause === 'video_channel_new' && i.channel_key).map((i) => i.channel_key),
  ...extra,
});

const ALL_OK = Object.fromEntries(
  ['content_and_evidence', 'explanation_and_expression', 'relation_to_learning', 'conditions_of_use', 'artifact_behavior', 'terms_of_use'].map((k) => [k, { result: 'ok', note: '' }]),
);

/** 素材を作り、webhook 2 発で版まで進める */
async function makeVersion(scenario, tag) {
  const c = await create(scenario, tag);
  const jobId = c.json?.job_id;
  const sid = c.json?.session_id;
  if (c.status !== 201 || !sid) return { c };
  await webhook(`wevt_${tag}_1_${RUN}`, sid);
  await waitJob(jobId, (j) => j.phase === 'making' && !j.reconcile_token);
  await webhook(`wevt_${tag}_2_${RUN}`, sid);
  const j = await waitJob(jobId, (x) => x.status === 'done' || x.status === 'failed');
  const mat = (await api('GET', `/api/materials/${c.json.material_id}`)).json;
  return { c, jobId, sid, job: j, materialId: c.json.material_id, versionId: mat?.versions?.[0]?.id, mat };
}

function rawGet(path) {
  return new Promise((resolve) => {
    const u = new URL(BASE);
    const req = http.request({ host: u.hostname, port: u.port, path, method: 'GET' }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', () => resolve(-1));
    req.end();
  });
}

async function main() {
  // ---- (a) 注文 → running ----
  await setScenario('questions-empty-then-done');
  const a = await create('questions-empty-then-done', 'a');
  check('(a) POST /api/materials 201 + job_id + session_id', a.status === 201 && !!a.json?.job_id && !!a.json?.session_id, `status=${a.status} err=${a.json?.error ?? ''} start=${a.json?.start_error ?? ''}`);
  const aJob = a.json?.job_id;
  const aSid = a.json?.session_id;
  const aMid = a.json?.material_id;
  {
    const j = (await api('GET', `/api/jobs/${aJob}`)).json?.job;
    const m = (await api('GET', `/api/materials/${aMid}`)).json?.material;
    check('(a) job running + session_id', j?.status === 'running' && j?.session_id === aSid, `job=${j?.status}`);
    check('(a) material work_status=making', m?.work_status === 'making', `work=${m?.work_status}`);
  }

  // ---- (b) webhook 2 発 ----
  const w1 = await webhook(`wevt_a1_${RUN}`, aSid);
  check('(b) webhook 1 → 204', w1.status === 204, `status=${w1.status}`);
  let j = await waitJob(aJob, (x) => x.phase === 'making' && !x.reconcile_token);
  const aCalls1 = await calls(aSid);
  const outcomeSends = aCalls1.filter((c) => c.op === 'events.send' && (c.events ?? []).some((e) => e.type === 'user.define_outcome'));
  check('(b) 1 発目で user.define_outcome が送られ phase=making', j?.phase === 'making' && outcomeSends.length === 1, `phase=${j?.phase} sends=${outcomeSends.length}`);
  const w2 = await webhook(`wevt_a2_${RUN}`, aSid);
  check('(b) webhook 2 → 204', w2.status === 204, `status=${w2.status}`);
  j = await waitJob(aJob, (x) => x.status === 'done' || x.status === 'failed');
  check('(b) 2 発目で job done', j?.status === 'done', `status=${j?.status} error=${j?.error ?? ''} last=${j?.last_error ?? ''}`);
  const review = (await api('GET', '/api/review')).json?.versions ?? [];
  const aVer = review.find((v) => v.material_id === aMid);
  check('(b) 版が review で /api/review に出る', !!aVer, `n=${review.length}`);
  const aVid = aVer?.version_id;
  const claimsFile = await api('GET', `/api/review/${aVid}/files/claims.json`);
  check('(b) outputs が R2 に入っている（確認用 files で claims.json 200）', claimsFile.status === 200 && Array.isArray(claimsFile.json?.claims), `status=${claimsFile.status}`);
  {
    const m = (await api('GET', `/api/materials/${aMid}`)).json?.material;
    check('(b) material work_status=review, publish_status=none', m?.work_status === 'review' && m?.publish_status === 'none', `${m?.work_status}/${m?.publish_status}`);
  }

  // ---- (n2) 工場ビュー（§N-1 / §N-2）: ingest 後の版（検証前）の行が verify active か review waiting ----
  {
    const fl = await api('GET', '/api/floor');
    const keys = ['intake', 'maker', 'clerk', 'verifier', 'reviewer', 'library'];
    check(
      '(n2) GET /api/floor 200・stations 6 キー・queue が配列',
      fl.status === 200 && !!fl.json?.stations && keys.every((k) => typeof fl.json.stations[k] === 'object') && Object.keys(fl.json.stations).every((k) => keys.includes(k) || k === 'rework') && Array.isArray(fl.json?.queue), // §N-6-6 で rework が増えた（それ以外のキーは増やさない）
      `status=${fl.status} stations=${Object.keys(fl.json?.stations ?? {}).join(',')}`,
    );
    const row = (fl.json?.queue ?? []).find((q) => q.material?.id === aMid);
    const st = (k) => row?.steps?.find((x) => x.key === k)?.state;
    check(
      '(n2) smoke の素材の行: 工程 7 個・verify active（または review waiting）・版が review',
      row?.steps?.length === 7 && (st('verify') === 'active' || st('review') === 'waiting') && row?.version?.id === aVid && row?.version?.status === 'review',
      `steps=${(row?.steps ?? []).map((x) => x.state).join(',')} progress=${row?.progress_pct} att=${row?.attention}`,
    );
    const leak = /brief_md|questions_json|answers_json|answer_token|reconcile_token|verification_token/.test(fl.text);
    check('(n2) /api/floor に brief・questions・answers・token 類が載らない', !leak, 'leak');
  }

  // ---- (d) 同じ webhook を 2 回 ----
  const dup = await webhook(`wevt_a2_${RUN}`, aSid, w2.body);
  const dup1 = await webhook(`wevt_a1_${RUN}`, aSid, w1.body);
  await sleep(1500);
  const aMat = (await api('GET', `/api/materials/${aMid}`)).json;
  check('(d) 同じ webhook の再送は 2xx で版は 1 つ', dup.status === 204 && dup1.status === 204 && aMat?.versions?.length === 1, `dup=${dup.status} versions=${aMat?.versions?.length}`);

  // ---- (e) done-bad-source ----
  const e = await makeVersion('done-bad-source', 'e');
  const eDetail = e.versionId ? (await api('GET', `/api/review/${e.versionId}`)).json : null;
  const s1 = eDetail?.sources?.find((s) => s.source_id === 's1');
  const s3 = eDetail?.sources?.find((s) => s.source_id === 's3');
  check('(e) 本文に無い引用は quote_found=0', s1?.url_was_fetched === 1 && s1?.quote_found === 0 && s1?.check_detail === 'quote_not_found', JSON.stringify(s1 ?? null));
  check('(e) fetch していない URL は url_was_fetched=0', s3?.url_was_fetched === 0 && s3?.check_detail === 'not_fetched', JSON.stringify(s3 ?? null));

  // ---- (i-1) 検証前の approve は 400 verification_pending ----
  {
    const r = await api('POST', `/api/review/${e.versionId}/decision`, { decision: 'approve', checklist: ALL_OK, note: '', verification_id: 'none' });
    check('(i) 検証 done 前の approve → 400 verification_pending', r.status === 400 && r.json?.error === 'verification_pending', `status=${r.status} err=${r.json?.error}`);
  }

  // ---- (c) cron で検証 → 承認 → 配信 → stop → rollback ----
  let aD = await cronUntil(aVid, settled);
  check('(c) cron で検証 done', aD?.version?.verification_status === 'done' && !!aD?.verification_id, `vs=${aD?.version?.verification_status}`);
  // ---- 契約 V-4: 読み手係（fake は既定で「問題なし」）が cron で済み、確認画面の API に結果と世代が出る ----
  {
    const all = (await api('GET', '/__fake/calls')).json?.calls ?? [];
    const rc = all.filter((c) => c.op === 'messages.create' && c.params?.kind === 'reader');
    check(
      '(V-4) 読み手係が cron で 1 回呼ばれ（Opus・report_reading strict・tool_choice auto・再送なし）、版の reader が done・gen あり・findings 空',
      rc.length >= 1 &&
        rc[0].params?.tools?.some((t) => t.name === 'report_reading' && t.strict === true) &&
        rc[0].params?.tool_choice?.type === 'auto' &&
        rc[0].opts?.max_retries === 0 &&
        aD?.reader?.status === 'done' &&
        typeof aD?.reader?.gen === 'string' &&
        Array.isArray(aD?.reader?.findings) &&
        aD.reader.findings.length === 0,
      `calls=${rc.length} reader=${aD?.reader?.status}/${aD?.reader?.gen ? 'gen' : 'none'}`,
    );
    const t = aD?.triage;
    check(
      '(V-6) triage v2: gate・pending_on・items・6 項目の auto・counts・trusted_gen が載り、gate は pending でない・処置なし',
      !!t && ['clean', 'attention'].includes(t.gate) && Array.isArray(t.pending_on) && t.pending_on.length === 0 && Array.isArray(t.items) && Object.keys(t.auto ?? {}).length === 6 && typeof t.counts?.fix === 'number' && typeof t.trusted_gen === 'string' && t.action === 'none',
      `gate=${t?.gate} action=${t?.action} items=${(t?.items ?? []).map((i) => i.cause).join(',')}`,
    );
    const st = await api('GET', '/api/review/stats');
    check('(V-8) GET /api/review/stats 200・自動公開は既定で切', st.status === 200 && st.json?.auto_publish === false && typeof st.json?.streak === 'number', `status=${st.status}`);
  }
  {
    const fakeMsgs = (await calls('')).length; // 呼び出し記録が読めること
    const all = (await api('GET', '/__fake/calls')).json?.calls ?? [];
    const msg = all.find((c) => c.op === 'batches.create' && c.params?.kind === 'verify');
    check(
      '(c) 検証係は Batch（§L-2）: tool_choice auto + report_verdicts strict + web_fetch_20250910 + top-level cache_control',
      msg?.params?.tool_choice?.type === 'auto' &&
        msg?.params?.tools?.some((t) => t.name === 'report_verdicts' && t.strict === true) &&
        msg?.params?.tools?.some((t) => t.type === 'web_fetch_20250910') &&
        msg?.params?.cache_control === 'ephemeral' &&
        !all.some((c) => c.op === 'messages.create' && c.params?.tools?.some?.((t) => t.name === 'report_verdicts')),
      `calls=${fakeMsgs} ${JSON.stringify(msg?.params ?? null).slice(0, 200)}`,
    );
  }
  await reviewScreenSmoke(aD);
  let r = await api('POST', `/api/review/${aVid}/decision`, approveBody(aD, { reader_gen: 'stale-gen' }));
  check('(V-7 e) 読み手係の世代が違う承認 → 409 stale_reader', r.status === 409 && r.json?.error === 'stale_reader', `status=${r.status} err=${r.json?.error}`);
  r = await api('POST', `/api/review/${aVid}/decision`, approveBody(aD, { note: 'smoke' }));
  check('(c) 6 項目を埋めて承認 → 200', r.status === 200, `status=${r.status} err=${r.json?.error} msg=${r.json?.message ?? ''}`);
  let lib = await api('GET', '/api/library/available');
  check('(c) /api/library/available に出る + no-store', lib.status === 200 && lib.json?.materials?.some((m) => m.material_id === aMid && m.version_id === aVid) && /no-store/.test(lib.headers.get('cache-control') ?? ''), `status=${lib.status}`);

  // ---- (k) 配信ファイル ----
  {
    const libItem = lib.json?.materials?.find((m) => m.material_id === aMid);
    const appUrl = libItem?.parts?.flatMap((p) => p.files ?? []).find((f) => /app\.html$/.test(f.url))?.url;
    const app = appUrl ? await fetch(BASE + appUrl) : null;
    const csp = app?.headers.get('content-security-policy') ?? '';
    check('(k) app.html に CSP sandbox allow-scripts + nosniff', app?.status === 200 && csp.startsWith('sandbox allow-scripts') && !/allow-same-origin/.test(csp) && app?.headers.get('x-content-type-options') === 'nosniff', `status=${app?.status} csp=${csp}`);
    const srcRes = await api('GET', `/api/library/files/${aVid}/sources.json`);
    const selfRes = await api('GET', `/api/library/files/${aVid}/selfcheck.md`);
    check('(k) sources.json / selfcheck.md は 404（manifest 外）', srcRes.status === 404 && selfRes.status === 404, `${srcRes.status}/${selfRes.status}`);
    const dot = await rawGet(`/api/library/files/${aVid}/parts/p1/../../sources.json`);
    const enc = await rawGet(`/api/library/files/${aVid}/parts/p1/%2e%2e/%2e%2e/sources.json`);
    const dbl = await rawGet(`/api/library/files/${aVid}//claims.json`);
    check('(k) `../`・`%`・空セグメントを含むパスは 404', dot === 404 && enc === 404 && dbl === 404, `dot=${dot} enc=${enc} dbl=${dbl}`);
    const md = await fetch(`${BASE}/api/library/files/${aVid}/parts/p1/p1-elementary-short.md`);
    check('(k) manifest 内の md は 200 text/markdown', md.status === 200 && /text\/markdown/.test(md.headers.get('content-type') ?? ''), `status=${md.status}`);
    await md.text();
  }

  // ---- (j-layout) 論理パスの復元（§E-0 / §B-4-d）: fake も本物と同じく files.list の filename は basename だけ ----
  {
    const head = async (key) => (await api('GET', `/__fake/r2-head?key=${encodeURIComponent(key)}`)).json;
    const base = `materials/${aMid}/${aJob}/`;
    const logical = await head(`${base}parts/p1/p1-elementary-short.md`);
    const raw = await head(`${base}raw/p1-elementary-short.md`);
    const p2 = await head(`${base}parts/p2/p2-elementary-short.md`);
    check('(j-layout) R2 に論理キー parts/p1/p1-elementary-short.md と raw/p1-elementary-short.md の両方がある', logical?.exists === true && raw?.exists === true && p2?.exists === true, `logical=${logical?.exists} raw=${raw?.exists} p2=${p2?.exists}`);
    const md = await fetch(`${BASE}/api/library/files/${aVid}/parts/p1/p1-elementary-short.md`);
    const rawRes = await fetch(`${BASE}/api/library/files/${aVid}/raw/p1-elementary-short.md`);
    check('(j-layout) GET /api/library/files/<version>/parts/p1/p1-elementary-short.md → 200、raw/ は配信しない（404）', md.status === 200 && rawRes.status === 404, `md=${md.status} raw=${rawRes.status}`);
    await md.text();
    await rawRes.text();
    const det = (await api('GET', `/api/review/${aVid}`)).json;
    const unref = det?.version?.checks?.unreferenced_files;
    check('(j-layout) checks_json.unreferenced_files が載る（この fixture では空配列）', Array.isArray(unref) && unref.length === 0, JSON.stringify(unref ?? null));
  }

  // 2 つ目の承認版を作る（改善 job → v2）。rollback は「現在の版でない approved 版」が対象のため
  await setScenario('questions-empty-then-done');
  const imp = await api('POST', '/api/jobs', { material_id: aMid, kind: 'rework', no_personal_data: true });
  check('(c) 承認後の素材に改善 job を注文 → 201', imp.status === 201 && !!imp.json?.session_id, `status=${imp.status} err=${imp.json?.error ?? imp.json?.start_error ?? ''}`);
  {
    const createCall = (await calls(imp.json?.session_id)).find((c) => c.op === 'sessions.create');
    check('(c) rework の session metadata.kind=rework', createCall?.metadata?.kind === 'rework' && createCall?.metadata?.job_id === imp.json?.job_id, JSON.stringify(createCall?.metadata ?? null));
  }
  // (m) 同素材に 2 本目の job
  {
    const busy = await api('POST', '/api/jobs', { material_id: aMid, kind: 'rework', no_personal_data: true });
    check('(m) 同素材に 2 本目の job → 409 material_busy', busy.status === 409 && busy.json?.error === 'material_busy', `status=${busy.status} err=${busy.json?.error}`);
  }
  await webhook(`wevt_a3_${RUN}`, imp.json?.session_id);
  await waitJob(imp.json?.job_id, (x) => x.phase === 'making' && !x.reconcile_token);
  await webhook(`wevt_a4_${RUN}`, imp.json?.session_id);
  await waitJob(imp.json?.job_id, (x) => x.status === 'done' || x.status === 'failed');
  const aMat2 = (await api('GET', `/api/materials/${aMid}`)).json;
  const v2 = aMat2?.versions?.find((v) => v.version === 2);
  check('(c) 改善 job の版 v2 が review、配信中の v1 は配信のまま', v2?.status === 'review' && aMat2?.material?.publish_status === 'available' && aMat2?.material?.current_version_id === aVid, `v2=${v2?.status} pub=${aMat2?.material?.publish_status}`);
  let v2D = await cronUntil(v2?.id, settled);
  const oldVid = v2D?.verification_id;
  // 古い入力の検証（evidence_v なし）で動かせるものがある版は、機械が 1 回だけ再検証する（契約 V-6 f）ので attempt は 1 か 2
  const prevHist = v2D?.verification_history ?? [];
  check('(n) v2 の検証 done', v2D?.version?.verification_status === 'done' && v2D?.verification?.attempt >= 1 && prevHist.length === v2D?.verification?.attempt, `vs=${v2D?.version?.verification_status} att=${v2D?.verification?.attempt}`);

  // ---- (n) reverify ----
  r = await api('POST', `/api/review/${v2?.id}/reverify`);
  check('(n) reverify → 200 pending', r.status === 200 && r.json?.verification_status === 'pending', `status=${r.status} err=${r.json?.error}`);
  v2D = await cronUntil(v2?.id, settled);
  {
    const hist = v2D?.verification_history ?? [];
    const n = prevHist.length;
    check(
      '(n) もう 1 回の検証 done・履歴が 1 行増える・verification_id が新しい',
      v2D?.version?.verification_status === 'done' &&
        hist.length === n + 1 &&
        hist.every((h, i) => h.attempt === i + 1) &&
        hist[n - 1]?.id === oldVid &&
        hist[n]?.id === v2D?.verification_id &&
        v2D.verification_id !== oldVid,
      `vs=${v2D?.version?.verification_status} hist=${JSON.stringify(hist.map((h) => h.attempt))}`,
    );
  }
  r = await api('POST', `/api/review/${v2?.id}/decision`, approveBody(v2D, { verification_id: oldVid }));
  check('(n) 古い verification_id の approve → 409', r.status === 409, `status=${r.status} err=${r.json?.error}`);
  r = await api('POST', `/api/review/${v2?.id}/decision`, approveBody(v2D));
  check('(c) v2 を承認 → 200', r.status === 200, `status=${r.status} err=${r.json?.error}`);
  lib = await api('GET', '/api/library/available');
  check('(c) 配信は v2 に切り替わる', lib.json?.materials?.find((m) => m.material_id === aMid)?.version_id === v2?.id, '');

  r = await api('POST', `/api/materials/${aMid}/stop`, { note: 'smoke 停止' });
  lib = await api('GET', '/api/library/available');
  const v2File = await api('GET', `/api/library/files/${v2?.id}/claims.json`);
  check('(c) stop → 200 で配信から消える（files も 404、no-store）', r.status === 200 && !lib.json?.materials?.some((m) => m.material_id === aMid) && v2File.status === 404 && /no-store/.test(lib.headers.get('cache-control') ?? ''), `stop=${r.status} file=${v2File.status}`);
  // stop → 同じ版（v2）へ rollback → available に戻る（§R-29）
  r = await api('POST', `/api/materials/${aMid}/rollback`, { version_id: v2?.id, note: 'smoke 同じ版で再開' });
  lib = await api('GET', '/api/library/available');
  check('(c) stop 後に同じ版（v2）へ rollback → 200 で配信に戻る', r.status === 200 && lib.json?.materials?.find((m) => m.material_id === aMid)?.version_id === v2?.id, `status=${r.status} err=${r.json?.error}`);
  r = await api('POST', `/api/materials/${aMid}/rollback`, { version_id: v2?.id, note: 'smoke 二重' });
  check('(c) 配信中に現在と同じ版へ rollback → 409', r.status === 409, `status=${r.status}`);
  r = await api('POST', `/api/materials/${aMid}/stop`, { note: 'smoke 停止 2' });
  check('(c) 再度 stop → 200', r.status === 200, `status=${r.status}`);
  r = await api('POST', `/api/materials/${aMid}/rollback`, { version_id: aVid, note: 'smoke 戻す' });
  lib = await api('GET', '/api/library/available');
  check('(c) rollback（v1）→ 200 で配信に戻る', r.status === 200 && lib.json?.materials?.find((m) => m.material_id === aMid)?.version_id === aVid, `status=${r.status} err=${r.json?.error}`);

  // ---- (i-2) done-contradicted ----
  // 契約 V-6・V-7: contradicted は機械が直させる所（fix・blocking）。回数（AUTO_RETURN_MAX 既定 2）が残っているので、cron が人に出す前に自動で差し戻す
  const ic = await makeVersion('done-contradicted', 'i');
  const icD = await cronUntil(ic.versionId, (d) => d.version?.status !== 'review');
  {
    const icMat = (await api('GET', `/api/materials/${ic.materialId}`)).json;
    const auto = icMat?.review_decisions?.find((d) => d.decision === 'return' && d.reviewer_email === 'system:auto-triage');
    check(
      '(i) contradicted を含む版は cron が自動で差し戻す（版 rejected・rework job・review_decisions(return, system:auto-triage, machine_gate attention)）',
      icD?.version?.status === 'rejected' && icMat?.jobs?.some((x) => x.kind === 'rework') && !!auto && auto.machine_gate === 'attention' && String(auto.note ?? '').startsWith('自動の差し戻し（1 回目。'),
      `status=${icD?.version?.status} auto=${!!auto} gate=${auto?.machine_gate}`,
    );
    r = await api('POST', `/api/review/${ic.versionId}/decision`, approveBody(icD));
    check('(i) 自動で差し戻した版の approve → 409 not_in_review', r.status === 409 && r.json?.error === 'not_in_review', `status=${r.status} err=${r.json?.error}`);
  }
  // 人の差し戻し → rework job が queued/running で作られる（検証の前でも差し戻せる）
  {
    await setScenario('questions-empty-then-done');
    const ih = await makeVersion('questions-empty-then-done', 'ih');
    r = await api('POST', `/api/review/${ih.versionId}/decision`, { decision: 'return', checklist: ALL_OK, note: 'c2 の根拠を見直してください', brief_append: '' });
    const ihMat = (await api('GET', `/api/materials/${ih.materialId}`)).json;
    const ret = ihMat?.review_decisions?.find((d) => d.decision === 'return');
    check(
      '(i) 差し戻し → 版 rejected + rework job + review_decisions(return。machine_gate pending)',
      r.status === 200 && ihMat?.versions?.[0]?.status === 'rejected' && ihMat?.jobs?.some((x) => x.kind === 'rework') && ret?.reviewer_email !== 'system:auto-triage' && ret?.machine_gate === 'pending',
      `status=${r.status} err=${r.json?.error} gate=${ret?.machine_gate}`,
    );
  }

  // ---- 検証係の pause_turn 継続（container を引き継ぐ）----
  {
    const pt = await makeVersion('done-pause-turn', 'pt');
    const ptD = await cronUntil(pt.versionId, (d) => d.version?.verification_status === 'done');
    const vb = ((await api('GET', '/__fake/calls')).json?.calls ?? []).filter((c) => c.op === 'batches.create' && c.params?.kind === 'verify');
    const cont = vb.filter((c) => (c.params?.messages ?? 0) > 1);
    check(
      '(F-3/§L-2) pause_turn の後は次のターンを別の batch で出し（会話を引き継ぐ）、検証 done',
      ptD?.version?.verification_status === 'done' && cont.length >= 1 && cont.every((c) => c.custom_id && c.custom_id !== 't0'),
      `vs=${ptD?.version?.verification_status} cont=${cont.length} ids=${cont.map((c) => c.custom_id).join(',')}`,
    );
  }

  // ---- (g) questions-nonempty ----
  const g = await create('questions-nonempty', 'g');
  await webhook(`wevt_g1_${RUN}`, g.json?.session_id);
  const gj = await waitJob(g.json?.job_id, (x) => x.status === 'needs_answer');
  check('(g) job needs_answer + 質問 2 件', gj?.status === 'needs_answer' && gj?.questions?.length === 2, `status=${gj?.status}`);
  const before = ((await api('GET', '/api/standards')).json?.log ?? []).filter((l) => l.kind === 'question').length;
  r = await api('POST', `/api/jobs/${g.json?.job_id}/answer`, {
    answers: (gj?.questions ?? []).map((q) => ({ question_id: q.id, answer: q.default })),
  });
  const after = ((await api('GET', '/api/standards')).json?.log ?? []).filter((l) => l.kind === 'question').length;
  check('(g) answer → 200 で standards_log が 2 行増える', r.status === 200 && after - before === 2, `status=${r.status} err=${r.json?.error} delta=${after - before}`);
  {
    const sends = (await calls(g.json?.session_id)).filter((c) => c.op === 'events.send');
    const types = sends.map((s) => (s.events ?? []).map((e) => e.type).join('+'));
    check('(g) fake 記録に user.message + user.define_outcome の 1 リクエスト', types.length === 1 && types[0] === 'user.message+user.define_outcome', JSON.stringify(types));
    const j2 = (await api('GET', `/api/jobs/${g.json?.job_id}`)).json?.job;
    check('(g) job running / phase making / answer_state sent', j2?.status === 'running' && j2?.phase === 'making' && j2?.answer_state === 'sent', `${j2?.status}/${j2?.phase}/${j2?.answer_state}`);
    const again = await api('POST', `/api/jobs/${g.json?.job_id}/answer`, { answers: [] });
    check('(g) 2 回目の answer → 409 not_waiting', again.status === 409 && again.json?.error === 'not_waiting', `status=${again.status}`);
  }

  // ---- (h) requires-action ----
  const h = await create('requires-action', 'h');
  await webhook(`wevt_h1_${RUN}`, h.json?.session_id);
  const hj = await waitJob(h.json?.job_id, (x) => x.deny_count >= 1 && !x.reconcile_token);
  const denies = () =>
    calls(h.json?.session_id).then((cs) =>
      cs.flatMap((c) => (c.op === 'events.send' ? c.events ?? [] : [])).filter((e) => e.type === 'user.tool_confirmation'),
    );
  let d1 = await denies();
  check('(h) user.tool_confirmation deny が sevt_ id に送られ deny_count=1', hj?.deny_count === 1 && d1.length === 1 && d1[0].tool_use_id === 'sevt_ra_tool_1' && d1[0].result === 'deny' && /^sevt_/.test(d1[0].tool_use_id), `deny=${hj?.deny_count} sent=${d1.length}`);
  r = await api('POST', `/api/jobs/${h.json?.job_id}/reconcile`);
  const hj2 = (await api('GET', `/api/jobs/${h.json?.job_id}`)).json?.job;
  d1 = await denies();
  check('(h) 再 reconcile で二重送信しない', r.status === 200 && hj2?.deny_count === 1 && d1.length === 1, `deny=${hj2?.deny_count} sent=${d1.length} result=${r.json?.result}`);
  {
    const busy = await api('POST', '/api/jobs', { material_id: h.json?.material_id, kind: 'draft', no_personal_data: true });
    check('(m) running の素材に 2 本目 → 409 material_busy', busy.status === 409 && busy.json?.error === 'material_busy', `status=${busy.status}`);
    const cancel = await api('POST', `/api/jobs/${h.json?.job_id}/cancel`);
    const hm = (await api('GET', `/api/materials/${h.json?.material_id}`)).json?.material;
    const archived = (await calls(h.json?.session_id)).some((c) => c.op === 'sessions.archive');
    check('(h) cancel → cancelled + material idle + archive', cancel.status === 200 && hm?.work_status === 'idle' && archived, `status=${cancel.status} work=${hm?.work_status}`);
  }

  // ---- 失敗系の scenario ----
  for (const [scn, tag, want] of [
    ['budget-reached', 'bud', (x) => x.status === 'budget_reached'],
    ['terminated-no-outputs', 'term', (x) => x.status === 'failed' && x.error === 'terminated_without_outputs'],
    ['retries-exhausted', 'ret', (x) => x.status === 'failed' && x.error === 'retries_exhausted'],
  ]) {
    const c = await create(scn, tag);
    await webhook(`wevt_${tag}_${RUN}`, c.json?.session_id);
    const x = await waitJob(c.json?.job_id, (y) => want(y) && !y.reconcile_token);
    const m = (await api('GET', `/api/materials/${c.json?.material_id}`)).json?.material;
    const wantWork = scn === 'budget-reached' ? 'making' : 'idle';
    check(`(scenario ${scn}) job ${x?.status}/${x?.error ?? '-'}、material ${wantWork}`, !!x && want(x) && m?.work_status === wantWork, `status=${x?.status} error=${x?.error} work=${m?.work_status}`);
    if (scn === 'terminated-no-outputs') {
      // (k-reingest) の否定側: invalid_outputs 以外の failed は取り込み直せない（成功側は vitest test/reingest-route.test.ts）
      const r = await api('POST', `/api/jobs/${c.json?.job_id}/reingest`);
      const after = (await api('GET', `/api/jobs/${c.json?.job_id}`)).json?.job;
      check('(k-reingest) terminated_without_outputs の job は reingest → 409 not_reingestable で failed のまま', r.status === 409 && r.json?.error === 'not_reingestable' && after?.status === 'failed', `status=${r.status} err=${r.json?.error} job=${after?.status}`);
    }
  }

  // ---- (l) Access なし（非 localhost host）----
  {
    const host = { headers: { host: 'factory.example.com' } };
    const raw = (path, method = 'GET', body) =>
      new Promise((resolve) => {
        const u = new URL(BASE);
        const req = http.request({ host: u.hostname, port: u.port, path, method, headers: { host: 'factory.example.com', 'content-type': 'application/json' } }, (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode));
        });
        req.on('error', () => resolve(-1));
        if (body) req.write(body);
        req.end();
      });
    void host;
    const adm = await raw('/admin/');
    const mats = await raw('/api/materials');
    const libS = await raw('/api/library/available');
    const wh = await raw('/webhook', 'POST', '{"type":"event"}');
    check('(l) 非 localhost で /admin と /api/materials は 401', adm === 401 && mats === 401, `admin=${adm} materials=${mats}`);
    check('(l) /api/library/available は認証なしで 200、/webhook 署名 NG は 400', libS === 200 && wh === 400, `library=${libS} webhook=${wh}`);
    const fakeCtl = await raw('/__fake/calls');
    check('(l) 非 localhost では fake の制御口に届かない（401）', fakeCtl === 401, `fake=${fakeCtl}`);
    const badOrigin = await api('POST', '/api/standards', { text: 'x' }, { origin: 'https://evil.example' });
    const noOrigin = await api('POST', '/api/standards', { text: 'x' }, { origin: false });
    const head = await fetch(`${BASE}/api/materials`, { method: 'HEAD' });
    check('(l) HEAD も Origin 無しは 403', head.status === 403, `status=${head.status}`);
    check('(l) GET 以外で Origin 不一致・無しは 403 bad_origin', badOrigin.status === 403 && noOrigin.status === 403 && badOrigin.json?.error === 'bad_origin', `${badOrigin.status}/${noOrigin.status}`);
    const adminLocal = await fetch(`${BASE}/admin/`);
    const adminHtml = await adminLocal.text();
    check('(l) localhost（dev bypass）では /admin が 200 で管理画面 + CSP', adminLocal.status === 200 && adminHtml.includes('コンテンツファクトリー') && /default-src 'self'/.test(adminLocal.headers.get('content-security-policy') ?? ''), `status=${adminLocal.status}`);
  }

  // ---- (n3) 工場ビューの入口（§N-3）: /admin/ に #/materials のリンク、admin.js を起動せず読んで例外なし ----
  {
    const html = await (await fetch(`${BASE}/admin/`)).text();
    check('(n3) /admin/ の HTML に #/materials のリンク', html.includes('href="#/materials"') && html.includes('href="#/"'), 'no link');
    const code = await (await fetch(`${BASE}/admin/admin.js`)).text();
    const win = { __FACTORY_ADMIN_NO_BOOT__: true };
    let err = null;
    try {
      vm.runInNewContext(code, { window: win, console }, { timeout: 2000 });
    } catch (e) {
      err = String(e && e.message).slice(0, 120);
    }
    const F = win.FactoryAdminFloor;
    check('(n3) admin.js を __FACTORY_ADMIN_NO_BOOT__ で読んでも例外なし・工場の描画関数がある', !err && !!F && typeof F.floorQueueHtml === 'function', err ?? 'no FactoryAdminFloor');
    if (F) {
      const fl = (await api('GET', '/api/floor')).json;
      const q = fl?.queue ?? [];
      const out = F.floorQueueHtml(q);
      const rows = (out.match(/data-floor-row="/g) || []).length;
      const chips = (out.match(/class="floor-chip /g) || []).length;
      check('(n3) 実 API の queue を描画: 行数が一致・チップは 7 × 行数', rows === q.length && chips === 7 * q.length, `rows=${rows}/${q.length} chips=${chips}`);
    }
  }

  // ---- (n6c) 工場の場面（§N-6-6・§N-6-7）: stations.rework の 2 キー、背景画像 200、キャラ 11 体が 200 ----
  {
    const fl = await api('GET', '/api/floor');
    const rw = fl.json?.stations?.rework;
    check(
      '(n6c) /api/floor の stations.rework に auto_active・manual_active（数値）',
      fl.status === 200 && !!rw && Number.isInteger(rw.auto_active) && Number.isInteger(rw.manual_active),
      `status=${fl.status} rework=${JSON.stringify(rw ?? null)}`,
    );
    const bg = await fetch(`${BASE}/admin/img/scene-bg.webp`);
    await bg.arrayBuffer();
    check('(n6c) /admin/img/scene-bg.webp が 200', bg.status === 200, `status=${bg.status}`);
    // キャラの拡張子は floor-scene.js の CHAR_EXT（配信中のファイルを node:vm で読む。取得・評価に失敗したら FAIL）
    let ext = null;
    let why = '';
    try {
      const res = await fetch(`${BASE}/admin/floor-scene.js`);
      const code = await res.text();
      if (res.status !== 200) throw new Error(`status=${res.status}`);
      const sandbox = { module: { exports: {} } };
      vm.runInNewContext(code, sandbox, { timeout: 2000 });
      const e = sandbox.module.exports?.CHAR_EXT;
      if (e !== 'svg' && e !== 'png') throw new Error(`CHAR_EXT=${String(e)}`);
      ext = e;
    } catch (e) {
      why = String(e && e.message).slice(0, 120);
    }
    check('(n6c) /admin/floor-scene.js を node:vm で読める（CHAR_EXT が svg / png）', ext !== null, why);
    const ids = ['scout', 'sprout', 'star', 'beret', 'robot', 'glasses', 'chick', 'sun', 'cat', 'sprout-b', 'ghost'];
    const codes = [];
    for (const id of ids) {
      const r = await fetch(`${BASE}/admin/img/chars/char-${id}.${ext ?? 'svg'}`);
      await r.arrayBuffer();
      codes.push(r.status);
    }
    check(
      `(n6c) キャラ 11 体（char-<id>.${ext ?? 'svg'}）が 200`,
      codes.every((c) => c === 200),
      ids.map((id, i) => `${id}=${codes[i]}`).filter((x) => !x.endsWith('=200')).join(' '),
    );
  }

  // ---- personal data 確認 ----
  {
    const r2 = await api('POST', '/api/materials', { title: 't', slug: `smoke-pii-${RUN}`, kinds: [3], brief_md: 'b', no_personal_data: false });
    check('no_personal_data !== true → 400', r2.status === 400 && r2.json?.error === 'personal_data_confirmation_required', `status=${r2.status}`);
  }

  // ---- 入口（§K-8）----
  await intakeSmoke();

  // ---- 画像生成（§O-8 (i1)〜(i12)。(i13) = 上の既存の全件）----
  await imageSmoke();

  console.log(`SMOKE_RESULT=${failed === 0 ? 'PASS' : 'FAIL'}`);
  process.exit(failed === 0 ? 0 : 1);
}

/**
 * (l5) 確認画面（§L-6）: 配信中の /admin/admin.js を node:vm で読み（起動はしない）、描画の純関数が返す HTML の要素数を数える。
 * 実 API の応答（triage 付き）を土台に、要確認 0 件 / N 件の triage を差し替えて描く。キー操作は keyCommand → applyCommand で状態を変えて描き直す。
 */
async function reviewScreenSmoke(detail) {
  const res = await fetch(`${BASE}/admin/admin.js`);
  const code = await res.text();
  const win = { __FACTORY_ADMIN_NO_BOOT__: true };
  try {
    vm.runInNewContext(code, { window: win, console }, { timeout: 2000 });
  } catch (e) {
    fail('(l5) admin.js を読める', String(e && e.message).slice(0, 120));
    return;
  }
  const R = win.FactoryAdminReview;
  check('(l5) admin.js が確認画面の関数を持つ', res.status === 200 && !!R && typeof R.reviewHtml === 'function', `status=${res.status}`);
  if (!R || !detail?.version) return;
  const n = (html, re) => (html.match(re) || []).length;
  const GROUP = /data-rv-group="/g;
  const ITEM = /data-ck="/g;
  const approveOn = (html) => /id="approve-btn">/.test(html);
  const t = detail.triage;
  check(
    '(l5) GET /api/review/:id が triage を返す（§L-5）',
    !!t && Array.isArray(t.groups) && typeof t.needs_review === 'number' && !!t.auto && ['content_and_evidence', 'terms_of_use', 'artifact_behavior'].every((k) => ['ok', 'review'].includes(t.auto[k])),
    `triage=${t ? Object.keys(t).join(',') : 'none'}`,
  );
  {
    const html = R.reviewHtml(detail, R.newReviewState(), { queue: [detail.version.id] });
    const expectGroups = Array.isArray(t?.groups) ? t.groups.length : 0;
    check('(l5) 実 API の版を描画: 判定帯 1・group 数が triage と一致・フッター 1', n(html, /data-rv-band="1"/g) === 1 && n(html, GROUP) === expectGroups && n(html, /id="rv-foot"/g) === 1, `band=${n(html, /data-rv-band="1"/g)} groups=${n(html, GROUP)}/${expectGroups}`);
  }
  const base = JSON.parse(JSON.stringify(detail));
  base.version.status = 'review';
  base.version.verification_status = 'done';
  base.verification_id = base.verification_id || 'ver_smoke';
  base.verification = { ...(base.verification || {}), contradicted: 0 };
  const firstClaim = base.claims?.[0]?.id ?? 'c1';
  const zero = { ...base, triage: { verification_id: base.verification_id, auto: { content_and_evidence: 'ok', terms_of_use: 'ok', artifact_behavior: 'ok' }, groups: [], ok_counts: { claims: base.claims?.length ?? 0, sources: base.sources?.length ?? 0 }, needs_review: 0, bad: false, reasons: [], action: 'none', return_note: null } };
  const many = {
    ...base,
    triage: {
      ...zero.triage,
      auto: { content_and_evidence: 'review', terms_of_use: 'review', artifact_behavior: 'ok' },
      groups: [
        { cause: 'contradicted', source_id: 's1', url: 'https://example.com/a', verifier_opened_urls: ['https://example.com/b'], claim_ids: [firstClaim] },
        { cause: 'source_not_listed', source_id: 's9', url: null, verifier_opened_urls: [], claim_ids: [firstClaim] },
        { cause: 'license_unknown', source_id: 's1', url: 'https://example.com/a', verifier_opened_urls: [], claim_ids: [] },
      ],
      needs_review: 5,
    },
  };
  {
    const html = R.reviewHtml(zero, R.newReviewState(), {});
    check('(l5) 要確認 0 件: group 0・「要確認なし」・項目は人の 3 つ・承認は無効（未回答）', n(html, GROUP) === 0 && html.includes('要確認なし') && n(html, ITEM) === 3 && !approveOn(html), `groups=${n(html, GROUP)} items=${n(html, ITEM)} approve=${approveOn(html)}`);
  }
  {
    const html = R.reviewHtml(many, R.newReviewState(), {});
    const causes = ['出典と食い違う', '出典一覧にない出典', '利用条件が分からない'].every((x) => html.includes(`<h3>${x}</h3>`));
    check('(l5) 要確認 N 件: group 3・原因の文・項目は 3 + review の 2・「要確認 5 件」', n(html, GROUP) === 3 && causes && n(html, ITEM) === 5 && html.includes('要確認 5 件'), `groups=${n(html, GROUP)} items=${n(html, ITEM)} causes=${causes}`);
  }
  const env = { inInput: false, dialogOpen: false, busy: false, draft: false };
  const key = (k, extra = {}) => ({ key: k, code: /^[1-3]$/.test(k) ? `Digit${k}` : `Key${k.toUpperCase()}`, ...extra });
  {
    const st = R.newReviewState();
    for (const k of ['1', '2', '3']) R.applyCommand(st, R.keyCommand(key(k), env));
    let html = R.reviewHtml(zero, st, {});
    const okOn = n(html, /data-val="ok" aria-pressed="true"/g);
    const ready = approveOn(html);
    R.applyCommand(st, R.keyCommand({ key: '!', code: 'Digit1', shiftKey: true }, env));
    html = R.reviewHtml(zero, st, {});
    const ngOn = n(html, /data-val="ng" aria-pressed="true"/g);
    check('(l5) キー 1/2/3 で 3 項目が OK → 承認が有効、Shift+1 で NG → 承認が無効', okOn === 3 && ready && ngOn === 1 && !approveOn(html), `ok=${okOn} ready=${ready} ng=${ngOn} after=${approveOn(html)}`);
    const payload = R.checklistPayload(zero, { ...st, ck: { ...st.ck, explanation_and_expression: { result: 'ok', note: '' } } }, true);
    check('(l5) 承認の checklist は auto が ok の 3 項目を省く', Object.keys(payload).length === 3 && !('content_and_evidence' in payload), Object.keys(payload).join(','));
  }
  {
    const blocked = [
      ['ダイアログ表示中', R.keyCommand(key('1'), { ...env, dialogOpen: true })],
      ['送信中', R.keyCommand(key('a'), { ...env, busy: true })],
      ['キーリピート', R.keyCommand(key('1', { repeat: true }), env)],
      ['入力欄', R.keyCommand(key('r'), { ...env, inInput: true })],
      ['Ctrl', R.keyCommand(key('a', { ctrlKey: true }), env)],
      ['Meta', R.keyCommand(key('x', { metaKey: true }), env)],
      ['Alt', R.keyCommand(key('j', { altKey: true }), env)],
      ['Shift+A', R.keyCommand(key('A', { shiftKey: true }), env)],
    ].filter(([, cmd]) => cmd !== null);
    const allowed = R.keyCommand(key('a'), env)?.cmd === 'approve' && R.keyCommand({ key: '?', code: 'Slash', shiftKey: true }, env)?.cmd === 'help';
    check('(l5) ダイアログ表示中・送信中・キーリピート・入力欄・修飾キーではキーが効かない', blocked.length === 0 && allowed, `効いた=${blocked.map((b) => b[0]).join(',')} allowed=${allowed}`);
  }
  {
    const st = R.newReviewState();
    st.mode = 'return';
    st.note = '書きかけ';
    const cmd = R.keyCommand(key('j'), { ...env, draft: true });
    R.applyCommand(st, cmd);
    const html = R.reviewHtml(zero, st, {});
    const visible = /<span id="rv-draft" class="err">理由を書きかけです<\/span>/.test(html);
    const free = R.keyCommand(key('k'), env);
    check('(l5) 理由の書きかけがあると J/K は動かず「理由を書きかけです」を出す', cmd?.cmd === 'draft_block' && visible && free?.cmd === 'nav' && free.dir === -1, `cmd=${cmd?.cmd} visible=${visible}`);
  }
  {
    const st = R.newReviewState();
    for (const k of ['explanation_and_expression', 'relation_to_learning', 'conditions_of_use']) st.ck[k] = { result: 'ok', note: '' };
    const cases = [
      ['全部 OK・検証 done・処置なし', zero, true],
      ['検証中', { ...zero, version: { ...zero.version, verification_status: 'running' } }, false],
      ['食い違いあり', { ...zero, verification: { ...zero.verification, contradicted: 1 } }, false],
      ['自動の差し戻し待ち', { ...zero, triage: { ...zero.triage, action: 'auto_return' } }, false],
      ['review の項目が未回答', many, false],
    ];
    const wrong = cases.filter(([, d, want]) => approveOn(R.reviewHtml(d, st, {})) !== want).map((c) => c[0]);
    const busy = approveOn(R.reviewHtml(zero, st, { busy: true }));
    check('(l5) 固定フッターの承認ボタンは条件どおりに有効化（送信中は無効）', wrong.length === 0 && !busy, `違う=${wrong.join(',')} busy=${busy}`);
  }
}

async function status() {
  return (await api('GET', '/api/status')).json ?? {};
}

async function intakeSmoke() {
  // (o) 手で足す → 一覧に出る → adopt で materials に行 → 2 回目は 409
  {
    const bad = await api('POST', '/api/proposals', { title: '順位をつける', body: 'b' });
    check('(o) 禁止語を含む提案は 400 invalid_proposal', bad.status === 400 && bad.json?.error === 'invalid_proposal' && bad.json?.field === 'title', `status=${bad.status} error=${bad.json?.error}`);
    const c = await api('POST', '/api/proposals', {
      title: `smoke 提案 ${RUN}`,
      body: '温度を測ってグラフにする',
      concept_codes: ['SCI01'],
      kinds: [3],
      age_band: 'both',
      evidence: [{ url: 'https://example.org/a', title: 'a' }],
    });
    check('(o) POST /api/proposals → 201', c.status === 201 && !!c.json?.id, `status=${c.status}`);
    const pid = c.json?.id;
    const list = await api('GET', '/api/proposals');
    const row = (list.json?.proposals ?? []).find((x) => x.id === pid);
    check('(o) 一覧（提案中）に出る（source_kind=manual・evidence・concept_codes）', !!row && row.source_kind === 'manual' && row.concept_codes?.[0] === 'SCI01' && row.evidence?.[0]?.url === 'https://example.org/a', `found=${!!row}`);
    await setScenario('questions-empty-then-done');
    const body = { title: `smoke 採択 ${RUN}`, slug: `smoke-adopt-${RUN}`, kinds: [3], catalog_item_id: null, brief_md: '提案から作る注文票（個人情報なし）', no_personal_data: true };
    const a1 = await api('POST', `/api/proposals/${pid}/adopt`, body);
    check('(o) adopt → 201（POST /api/materials と同じ応答: material_id・job_id）', a1.status === 201 && !!a1.json?.material_id && !!a1.json?.job_id, `status=${a1.status} error=${a1.json?.error}`);
    const m = await api('GET', `/api/materials/${a1.json?.material_id}`);
    check('(o) materials に行ができ proposal_id が付く', m.status === 200 && m.json?.material?.proposal_id === pid, `status=${m.status}`);
    const a2 = await api('POST', `/api/proposals/${pid}/adopt`, { ...body, slug: `smoke-adopt2-${RUN}` });
    check('(o) 同じ提案の 2 回目の adopt は 409 not_proposed', a2.status === 409 && a2.json?.error === 'not_proposed', `status=${a2.status}`);
    const adopted = await api('GET', '/api/proposals?status=adopted');
    check('(o) 採択済みの一覧に material_id 付きで出る', (adopted.json?.proposals ?? []).some((x) => x.id === pid && x.material_id === a1.json?.material_id), 'not found');
    const d = await api('POST', '/api/proposals', { title: `smoke 見送り ${RUN}`, body: '見送る提案' });
    const dn = await api('POST', `/api/proposals/${d.json?.id}/dismiss`, {});
    const d1 = await api('POST', `/api/proposals/${d.json?.id}/dismiss`, { note: '今は作らない' });
    const d2 = await api('POST', `/api/proposals/${d.json?.id}/dismiss`, { note: 'もう一度' });
    check('(o) dismiss: 理由なし 400 → 200 → 2 回目 409', dn.status === 400 && d1.status === 200 && d2.status === 409, `${dn.status}/${d1.status}/${d2.status}`);
  }

  // (p) intake
  {
    const okBody = {
      title: `smoke 子ども由来 ${RUN}`,
      body: '棒の影の長さが時間で変わる理由を知りたかった',
      concept_codes: ['SCI02'],
      age_band: 'elementary',
      missing: '影と太陽の高さの図',
      supporter_checked: true,
      supporter_email: 'staff@example.invalid',
    };
    const noCheck = { ...okBody };
    delete noCheck.supporter_checked;
    const r1 = await api('POST', '/api/intake', noCheck);
    check('(p) supporter_checked 無しで 400 supporter_check_required', r1.status === 400 && r1.json?.error === 'supporter_check_required', `status=${r1.status} error=${r1.json?.error}`);
    const marker = `VALUE-${RUN}`;
    const r2 = await api('POST', '/api/intake', { ...okBody, child_name: marker });
    check('(p) child_name キー付きで 400 forbidden_field（キー名だけ返し値は返さない）', r2.status === 400 && r2.json?.error === 'forbidden_field' && r2.json?.field === 'child_name' && !r2.text.includes(marker), `status=${r2.status} error=${r2.json?.error}`);
    const r3 = await api('POST', '/api/intake', okBody);
    check('(p) 正しい body で 201', r3.status === 201 && !!r3.json?.id, `status=${r3.status} error=${r3.json?.error}`);
    const list = await api('GET', '/api/proposals');
    const row = (list.json?.proposals ?? []).find((x) => x.id === r3.json?.id);
    check('(p) 一覧に source_kind=child・supporter_checked で出て、supporter_email は一覧に出ない', !!row && row.source_kind === 'child' && row.supporter_checked === true && !list.text.includes('staff@example.invalid'), `found=${!!row}`);
    const u = new URL(BASE);
    const nonLocal = await new Promise((resolve) => {
      const req = http.request({ host: u.hostname, port: u.port, path: '/api/intake', method: 'POST', headers: { host: 'factory.example.com', 'content-type': 'application/json' } }, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      });
      req.on('error', () => resolve(-1));
      req.write(JSON.stringify(okBody));
      req.end();
    });
    check('(p) 非 localhost・JWT なしの /api/intake は 401', nonLocal === 401, `status=${nonLocal}`);
  }

  // (q) 収集（fake: RSS 2 本 + xAI + Haiku）
  {
    const r = await api('POST', '/api/scout/run');
    check('(q) POST /api/scout/run → done・提案 2 件', r.status === 200 && r.json?.status === 'done' && r.json?.proposed === 2 && r.json?.rss_items === 3 && r.json?.x_posts === 12, `status=${r.status} run=${r.json?.status} proposed=${r.json?.proposed} error=${r.json?.error}`);
    const list = await api('GET', '/api/proposals');
    const scoutRows = (list.json?.proposals ?? []).filter((x) => x.source_kind === 'scout');
    check('(q) proposals に source_kind=scout が入る', scoutRows.length >= 2, `scout=${scoutRows.length}`);
    const st = await status();
    check('(q) scout_runs は done、cost_ledger(scout) の当月合計 > 0', st.scout?.last_status === 'done' && st.scout?.month_cents > 0 && st.scout?.running === false, `last=${st.scout?.last_status} cents=${st.scout?.month_cents}`);
    const allCalls = (await api('GET', '/__fake/calls')).json?.calls ?? [];
    const x = allCalls.filter((c) => c.op === 'xai.responses');
    const h = allCalls.filter((c) => c.op === 'messages.create' && c.params?.model === 'claude-haiku-5-5');
    check('(q) xAI 1 回（x_search・store=false）・Haiku 1 回（json_schema）', x.length === 1 && x[0].params?.store === false && h.length === 1 && h[0].params?.output_format === 'json_schema', `xai=${x.length} haiku=${h.length}`);
  }

  // (r) 会議（fake: Batch 1 件 → 次の tick で ended）
  {
    const r = await api('POST', '/api/meeting/run');
    check('(r) POST /api/meeting/run → 201 submitted', r.status === 201 && r.json?.status === 'submitted' && !!r.json?.batch_id, `status=${r.status} error=${r.json?.error}`);
    const again = await api('POST', '/api/meeting/run');
    check('(r) submitted が残っていれば 409 already_submitted', again.status === 409 && again.json?.error === 'already_submitted', `status=${again.status}`);
    const st1 = await status();
    check('(r) status: meeting.pending_batch=true・submitted', st1.meeting?.pending_batch === true && st1.meeting?.last_status === 'submitted', `pending=${st1.meeting?.pending_batch}`);
    const code = await cron();
    const st2 = await status();
    check('(r) 次の tick で ended・費用行あり・pending なし', code === 200 && st2.meeting?.last_status === 'ended' && st2.meeting?.pending_batch === false && st2.meeting?.month_cents > 0, `cron=${code} last=${st2.meeting?.last_status} cents=${st2.meeting?.month_cents}`);
    const latest = await api('GET', '/api/meeting/latest');
    const mins = latest.json?.meeting?.minutes;
    check('(r) meeting_minutes.minutes_json に views 4 つと ranked', !!mins && ['research', 'pedagogy', 'expression', 'verification'].every((k) => typeof mins.views?.[k] === 'string') && Array.isArray(mins.ranked), 'minutes missing');
    const list = await api('GET', '/api/proposals');
    const meetRows = (list.json?.proposals ?? []).filter((x) => x.source_kind === 'meeting');
    const prioritized = (list.json?.proposals ?? []).filter((x) => x.source_kind !== 'meeting' && x.priority === 5 && x.meeting_reason);
    check('(r) source_kind=meeting の提案が入り、既存提案に優先度と会議の理由が付く', meetRows.length >= 1 && meetRows[0].priority === 3 && prioritized.length === 1, `meeting=${meetRows.length} prioritized=${prioritized.length}`);
    const calls = (await api('GET', '/__fake/calls')).json?.calls ?? [];
    const bc = calls.filter((c) => c.op === 'batches.create' && c.params?.kind !== 'verify'); // 検証係の Batch（§L-2）は会議の数に入れない
    check('(r) Batch は 1 件（sonnet・adaptive・json_schema）', bc.length === 1 && bc[0].params?.requests === 1 && bc[0].params?.model === 'claude-sonnet-5-5' && bc[0].params?.thinking?.type === 'adaptive' && bc[0].params?.output_format === 'json_schema', `create=${bc.length}`);
  }

  // (s) 月次上限（smoke の上限は 1 セント。上の (q)(r) の費用で当月合計が上限以上になっている）
  {
    const sc = await api('POST', '/api/scout/run');
    const st = await status();
    check('(s) 当月合計が上限以上なら scout は skipped（200 {skipped:"cap"}）', sc.status === 200 && sc.json?.skipped === 'cap' && st.scout?.last_status === 'skipped', `status=${sc.status} last=${st.scout?.last_status}`);
    const before = ((await api('GET', '/__fake/calls')).json?.calls ?? []).filter((c) => c.op === 'batches.create').length;
    const mt = await api('POST', '/api/meeting/run');
    const after = ((await api('GET', '/__fake/calls')).json?.calls ?? []).filter((c) => c.op === 'batches.create').length;
    const st2 = await status();
    check('(s) 当月合計が上限以上なら会議は起きない（Batch を呼ばない）', mt.status === 200 && mt.json?.skipped === 'cap' && after === before && st2.meeting?.last_status === 'ended', `status=${mt.status} batches=${before}->${after}`);
  }
}

// ===========================================================================
// §O-8 smoke (i1)〜(i12): 画像生成。fake の Anthropic（/__fake/session-append で職人の agent.custom_tool_use・評価・ファイルを足す）+
// fake の OpenAI（/__fake/openai のシナリオ、/__fake/openai-gate で応答待ちを作る）+ ローカルの queue。
// wrangler dev の queue（miniflare の broker）は message を 1 件ずつ到着順に配る（前の consumer が終わるまで次を配らない）。
// 時間の経過（queued 5 分）は /__fake/image-age で enqueued_at を前にずらして代える。
const IMG_TOOL = 'generate_image';
const SHARED_MATERIAL = fs.readFileSync(new URL('../test/fixtures/_shared/outputs/material.json', import.meta.url), 'utf8');
const UNAVAILABLE_TEXT = '今は画像を作れません。図は SVG で描いてください。';
let wevtN = 0;
const nudge = (sid, tag) => webhook(`wevt_img_${tag}_${++wevtN}_${RUN}`, sid);
const sha256Hex = (buf) => crypto.createHash('sha256').update(Buffer.from(buf)).digest('hex');
const imgInput = (prompt, over = {}) => ({ prompt, accuracy: 'standard', size: '1024x1024', quality: 'high', format: 'png', background: 'opaque', alt: 'smoke の図', ...over });

async function fakeOpenAi(scenario) {
  const r = await api('POST', '/__fake/openai', { scenario });
  if (r.status !== 200) throw new Error(`fakeOpenAi ${scenario} -> ${r.status}`);
}
async function gate(closed) {
  const r = await api('POST', '/__fake/openai-gate', { closed });
  if (r.status !== 200) throw new Error(`gate -> ${r.status}`);
}
async function openAiCount() {
  return ((await api('GET', '/__fake/openai-calls')).json?.calls ?? []).length;
}
async function imageRows(jobId) {
  return (await api('GET', `/__fake/image-requests?job_id=${encodeURIComponent(jobId)}`)).json?.requests ?? [];
}
async function imagesStatus() {
  return (await api('GET', '/api/images/status')).json ?? {};
}
async function waitRows(jobId, pred, timeoutMs = 20_000) {
  const until = Date.now() + timeoutMs;
  let rows = [];
  while (Date.now() < until) {
    rows = await imageRows(jobId);
    if (pred(rows)) return rows;
    await sleep(250);
  }
  return rows;
}
const TERMINAL = ['done', 'refused', 'failed'];
const allTerminal = (n) => (rows) => rows.length === n && rows.every((r) => TERMINAL.includes(r.state));

async function appendSession(sid, body) {
  const r = await api('POST', '/__fake/session-append', { session_id: sid, ...body });
  if (r.status !== 200) throw new Error(`session-append -> ${r.status}`);
}

/** 注文 → webhook 1 発で phase=making（questions-empty-then-done。define_outcome を送った後の職人に、ここから event を足す） */
async function imageJob(tag) {
  const c = await create('questions-empty-then-done', tag);
  const jobId = c.json?.job_id;
  const sid = c.json?.session_id;
  if (c.status !== 201 || !sid) throw new Error(`imageJob ${tag}: create ${c.status}`);
  await nudge(sid, tag);
  const j = await waitJob(jobId, (x) => x.phase === 'making' && !x.reconcile_token);
  if (j?.phase !== 'making') throw new Error(`imageJob ${tag}: phase=${j?.phase}`);
  return { tag, jobId, sid, materialId: c.json.material_id, turns: 0 };
}

/** 職人が 1 turn で generate_image を inputs の数だけ呼んで止まる（requires_action）→ webhook。custom_tool_use の id を返す */
async function askImages(job, inputs) {
  const t = ++job.turns;
  const ids = inputs.map((_, i) => `sevt_img_${job.tag}_${t}_${i}_${RUN}`);
  await appendSession(job.sid, {
    events: [
      { type: 'session.status_running' },
      ...ids.map((id, i) => ({ type: 'agent.custom_tool_use', id, name: IMG_TOOL, input: inputs[i] })),
      { type: 'session.status_idle', stop_reason: { type: 'requires_action', event_ids: ids }, stop_details: null },
    ],
  });
  await nudge(job.sid, job.tag);
  return ids;
}

async function toolResults(sid) {
  return (await calls(sid)).flatMap((c) => (c.op === 'events.send' ? c.events ?? [] : [])).filter((e) => e.type === 'user.custom_tool_result');
}
const resultsFor = (rs, id) => rs.filter((e) => e.custom_tool_use_id === id);

/**
 * ids のすべてに result が 1 件以上届くまで待つ。consumer の終わりの reconcile が lease の競合で返せなかった時のために、
 * 4 秒届かなければ webhook（次の reconcile）を 1 発送る。nudges = 送った webhook の数（PASS 行に出す）
 */
async function waitResults(job, ids, timeoutMs = 30_000) {
  const until = Date.now() + timeoutMs;
  let nudges = 0;
  let last = Date.now();
  let rs = [];
  while (Date.now() < until) {
    rs = await toolResults(job.sid);
    if (ids.every((id) => resultsFor(rs, id).length > 0)) break;
    if (Date.now() - last > 4000) {
      await nudge(job.sid, job.tag);
      nudges++;
      last = Date.now();
    }
    await sleep(300);
  }
  return { rs, nudges };
}

/** 職人が採用して終える: material.json の parts[0].files に image_id の図を足し、評価 satisfied + end_turn → webhook → job の終端を待つ */
async function finishWithImages(job, refs) {
  const mat = JSON.parse(SHARED_MATERIAL);
  for (const r of refs) mat.parts[0].files.push({ path: r.path, role: 'figure', image_id: r.image_id, alt: 'smoke の図' });
  await appendSession(job.sid, {
    events: [
      { type: 'session.status_running' },
      { type: 'span.outcome_evaluation_start', id: `sevt_es_${job.tag}_${RUN}`, outcome_id: 'outc_fake', iteration: 1 },
      {
        type: 'span.outcome_evaluation_end',
        id: `sevt_ee_${job.tag}_${RUN}`,
        outcome_evaluation_start_id: `sevt_es_${job.tag}_${RUN}`,
        outcome_id: 'outc_fake',
        iteration: 1,
        result: 'satisfied',
        explanation: 'smoke',
        usage: { input_tokens: 10, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
      { type: 'session.status_idle', stop_reason: { type: 'end_turn' }, stop_details: null },
    ],
    files: [{ filename: 'material.json', content: JSON.stringify(mat, null, 2) }],
  });
  await nudge(job.sid, job.tag);
  return waitJob(job.jobId, (x) => x.status === 'done' || x.status === 'failed');
}

/** 終わった job の取り置き（ih:）を F で確定させる: 動いている job を取り消し、cron を 1 回 */
async function closeJobs(jobs) {
  for (const j of jobs) {
    const s = (await api('GET', `/api/jobs/${j.jobId}`)).json?.job?.status;
    if (['queued', 'running', 'needs_answer', 'budget_reached'].includes(s)) await api('POST', `/api/jobs/${j.jobId}/cancel`);
  }
  await cron();
}

/** 掃き出し: 専用 job に 1 枚頼み done まで待つ。broker は到着順に 1 件ずつ配るので、これが done なら前に積んだ message は処理済み */
async function drainQueue(sentinel) {
  const before = (await imageRows(sentinel.jobId)).length;
  await askImages(sentinel, [imgInput('掃き出し', { quality: 'low' })]);
  const rows = await waitRows(sentinel.jobId, (rs) => rs.length === before + 1 && TERMINAL.includes(rs[before].state), 30_000);
  return rows[before]?.state === 'done';
}

async function imageSmoke() {
  await fakeOpenAi('ok');
  await gate(false);
  const opened = [];
  try {
    await imageCases(opened);
  } catch (e) {
    fail('(i) image smoke crashed', `${e && e.name}: ${String(e && e.message).slice(0, 200)}`);
  } finally {
    await gate(false).catch(() => undefined);
    await fakeOpenAi('ok').catch(() => undefined);
  }
}

async function imageCases(opened) {
  const sentinel = await imageJob('isen');
  opened.push(sentinel);

  // ---- (i1) 注文 → generate_image → consumer → fake OpenAI 1 回 → reconcile が result 1 回 → 版に png → 確認画面 → 承認 → 配信の SHA-256 = sha256 ----
  const A = await imageJob('i1');
  opened.push(A);
  let aImageId = null;
  let aSha = null;
  let aVid = null;
  {
    const n0 = await openAiCount();
    const [tid] = await askImages(A, [imgInput('赤い線が 15 ブロックで止まるレッドストーンの図')]);
    const rows = await waitRows(A.jobId, allTerminal(1));
    const { rs, nudges } = await waitResults(A, [tid]);
    const n1 = await openAiCount();
    const row = rows[0];
    aImageId = row?.id ?? null;
    aSha = row?.sha256 ?? null;
    const res = resultsFor(rs, tid);
    const img = res[0]?.content?.[0];
    const text = res[0]?.content?.[1]?.text ?? '';
    check(
      '(i1) generate_image → queue の consumer が done・fake OpenAI 1 回・result 1 回',
      row?.state === 'done' && row?.dispatched === 1 && n1 - n0 === 1 && res.length === 1,
      `state=${row?.state} openai=${n1 - n0} results=${res.length} nudges=${nudges}`,
    );
    check(
      '(i1) result は形 A（image の base64 block + 成功の文）: data の SHA-256 = image_requests.sha256・文に image_id と残り 7 枚',
      res[0]?.is_error === false && img?.type === 'image' && img?.source?.type === 'base64' && img?.source?.media_type === 'image/png' && !!aSha && img?.source?.data_sha256 === aSha && text.includes(aImageId) && text.includes('残りは 7 枚'),
      `is_error=${res[0]?.is_error} type=${img?.type}/${img?.source?.type} sha_eq=${img?.source?.data_sha256 === aSha} id_in_text=${text.includes(String(aImageId))}`,
    );
    const j = await finishWithImages(A, [{ path: 'parts/p1/p1-gen-1.png', image_id: aImageId }]);
    const mat = (await api('GET', `/api/materials/${A.materialId}`)).json;
    aVid = mat?.versions?.[0]?.id ?? null;
    check('(i1) 採用 → 取り込みで版が review', j?.status === 'done' && mat?.versions?.[0]?.status === 'review', `job=${j?.status}/${j?.error ?? '-'} last=${j?.last_error ?? '-'} version=${mat?.versions?.[0]?.status}`);
    const rf = await fetch(`${BASE}/api/review/${aVid}/files/parts/p1/p1-gen-1.png`);
    const rfBuf = await rf.arrayBuffer();
    check('(i1) 確認用 files の png は 200 image/png・SHA-256 = sha256', rf.status === 200 && /image\/png/.test(rf.headers.get('content-type') ?? '') && sha256Hex(rfBuf) === aSha, `status=${rf.status} type=${rf.headers.get('content-type')}`);
    // 確認画面（admin.js を node:vm で読み、実 API の詳細を描く）: サムネイルの下に「生成: standard・<prompt>」が 1 つ
    const detail = (await api('GET', `/api/review/${aVid}`)).json;
    const gi = detail?.generated_images ?? [];
    check(
      '(i1) GET /api/review/:id の generated_images に 1 件（path・accuracy・prompt・alt）',
      gi.length === 1 && gi[0].path === 'parts/p1/p1-gen-1.png' && gi[0].accuracy === 'standard' && /レッドストーン/.test(gi[0].prompt ?? '') && gi[0].alt === 'smoke の図',
      JSON.stringify(gi.map((g) => ({ path: g.path, accuracy: g.accuracy }))),
    );
    {
      const code = await (await fetch(`${BASE}/admin/admin.js`)).text();
      const win = { __FACTORY_ADMIN_NO_BOOT__: true };
      vm.runInNewContext(code, { window: win, console }, { timeout: 2000 });
      const R = win.FactoryAdminReview;
      const html = detail?.version ? R.reviewHtml(detail, R.newReviewState(), {}) : '';
      const genN = (html.match(/data-gen="1"/g) || []).length;
      const thumbs = (html.match(/class="thumb"/g) || []).length;
      check(
        '(i1) 確認画面: サムネイル 2（svg + 生成 png）・生成の情報 1 つ（「生成: standard・…」）',
        genN === 1 && thumbs === 2 && html.includes('生成: standard・赤い線が 15 ブロック'),
        `gen=${genN} thumbs=${thumbs}`,
      );
    }
    // (i2) 承認前は配信しない
    const pre = await fetch(`${BASE}/api/library/files/${aVid}/parts/p1/p1-gen-1.png`);
    await pre.arrayBuffer();
    const d = await cronUntil(aVid, settled);
    const ap = await api('POST', `/api/review/${aVid}/decision`, approveBody(d, { note: 'smoke image' }));
    const lib = await fetch(`${BASE}/api/library/files/${aVid}/parts/p1/p1-gen-1.png`);
    const libBuf = await lib.arrayBuffer();
    check(
      '(i1) 承認 → 配信の png は 200・SHA-256 = image_requests.sha256',
      ap.status === 200 && lib.status === 200 && sha256Hex(libBuf) === aSha,
      `approve=${ap.status}/${ap.json?.error ?? '-'} lib=${lib.status} sha_eq=${sha256Hex(libBuf) === aSha}`,
    );
    // ---- (i2) 承認前・停止後は 404（対照: 承認後は 200）----
    const st = await api('POST', `/api/materials/${A.materialId}/stop`, { note: 'smoke 画像の停止' });
    const post = await fetch(`${BASE}/api/library/files/${aVid}/parts/p1/p1-gen-1.png`);
    await post.arrayBuffer();
    check('(i2) 配信の png: 承認前 404・承認後 200・停止後 404', pre.status === 404 && lib.status === 200 && st.status === 200 && post.status === 404, `pre=${pre.status} approved=${lib.status} stop=${st.status} stopped=${post.status}`);
  }

  // ---- (i2) 別 job の image_id・sha256 不一致は invalid_outputs（bad_image_ref）。対照: (i1) は同じ手順で done ----
  {
    const B = await imageJob('i2b');
    opened.push(B);
    const jb = await finishWithImages(B, [{ path: 'parts/p1/p1-gen-1.png', image_id: aImageId }]);
    check('(i2) 別 job の image_id を参照 → failed invalid_outputs・bad_image_ref', jb?.status === 'failed' && jb?.error === 'invalid_outputs' && jb?.last_error === 'bad_image_ref:parts/p1/p1-gen-1.png', `job=${jb?.status}/${jb?.error} last=${jb?.last_error}`);
    const C = await imageJob('i2c');
    opened.push(C);
    const [tid] = await askImages(C, [imgInput('sha 不一致の図')]);
    const rows = await waitRows(C.jobId, allTerminal(1));
    await waitResults(C, [tid]);
    const cor = await api('POST', '/__fake/image-corrupt', { request_id: rows[0]?.id });
    const jc = await finishWithImages(C, [{ path: 'parts/p1/p1-gen-1.png', image_id: rows[0]?.id }]);
    check('(i2) R2 の物体が sha256 と違う → failed invalid_outputs・bad_image_ref', rows[0]?.state === 'done' && cor.status === 200 && jc?.status === 'failed' && jc?.error === 'invalid_outputs' && jc?.last_error === 'bad_image_ref:parts/p1/p1-gen-1.png', `row=${rows[0]?.state} corrupt=${cor.status} job=${jc?.status}/${jc?.error} last=${jc?.last_error}`);
  }
  await closeJobs(opened.splice(1));

  // ---- (i3) enqueue の後に cancel → fake OpenAI 0 回・failed job_ended ----
  {
    await gate(true);
    const X = await imageJob('i3x');
    const Y = await imageJob('i3y');
    opened.push(X, Y);
    await askImages(X, [imgInput('門で待つ図')]);
    const xRows = await waitRows(X.jobId, (rs) => rs[0]?.state === 'dispatched');
    const n0 = await openAiCount(); // X の呼び出しは記録済み（門の前で記録する）
    await askImages(Y, [imgInput('取り消される図')]);
    const yQueued = await waitRows(Y.jobId, (rs) => rs[0]?.state === 'queued');
    const cancel = await api('POST', `/api/jobs/${Y.jobId}/cancel`);
    await gate(false);
    await waitRows(X.jobId, allTerminal(1));
    const drained = await drainQueue(sentinel); // Y の message の consumer が走った後
    const n1 = await openAiCount();
    const yAfter = (await imageRows(Y.jobId))[0];
    const age = await api('POST', '/__fake/image-age', { request_id: yAfter?.id, minutes: 6 });
    await cron();
    const yEnd = (await imageRows(Y.jobId))[0];
    check(
      '(i3) queued の間に cancel → consumer は D で 0 行（queued のまま・呼ばない）→ cron の C2 で failed job_ended、OpenAI は掃き出しの 1 回だけ',
      xRows[0]?.state === 'dispatched' && yQueued[0]?.state === 'queued' && cancel.status === 200 && drained && yAfter?.state === 'queued' && yAfter?.dispatched === 0 && age.json?.changed === 1 && yEnd?.state === 'failed' && yEnd?.error === 'job_ended' && n1 - n0 === 1,
      `x=${xRows[0]?.state} y=${yQueued[0]?.state}->${yAfter?.state}->${yEnd?.state}/${yEnd?.error} cancel=${cancel.status} drained=${drained} openai_delta=${n1 - n0}（掃き出し 1 を含む）`,
    );
  }

  // ---- (i5) 同じ turn で generate_image を 3 つ → 3 件とも result、生成 3 回 ----
  {
    const J = await imageJob('i5');
    opened.push(J);
    const n0 = await openAiCount();
    const ids = await askImages(J, [imgInput('図 1'), imgInput('図 2'), imgInput('図 3')]);
    const rows = await waitRows(J.jobId, allTerminal(3));
    const { rs, nudges } = await waitResults(J, ids);
    const n1 = await openAiCount();
    const per = ids.map((id) => resultsFor(rs, id).length);
    check('(i5) 同じ turn の 3 つ → 3 件とも done・result は各 1 件・生成 3 回', rows.every((r) => r.state === 'done') && per.every((x) => x === 1) && n1 - n0 === 3, `states=${rows.map((r) => r.state).join(',')} results=${per.join(',')} openai=${n1 - n0} nudges=${nudges}`);
  }

  // ---- (i6) 同じ message を 3 回 send → 生成 1 回・result 1 回 ----
  {
    const J = await imageJob('i6');
    opened.push(J);
    await gate(true);
    const n0 = await openAiCount();
    const [tid] = await askImages(J, [imgInput('重複配送の図')]); // send 1 回目（reconcile）
    const r0 = await waitRows(J.jobId, (rs) => rs[0]?.state === 'dispatched');
    const extra = await api('POST', '/__fake/image-send', { request_id: r0[0]?.id, times: 2 }); // 2・3 回目
    await gate(false);
    await waitRows(J.jobId, allTerminal(1));
    const drained = await drainQueue(sentinel);
    const { nudges } = await waitResults(J, [tid]);
    await nudge(J.sid, J.tag);
    await nudge(J.sid, J.tag);
    await sleep(1500);
    const rs = await toolResults(J.sid);
    const n1 = await openAiCount();
    check(
      '(i6) 同じ依頼の message 3 回 → 生成 1 回（+ 掃き出し 1）・result 1 件（webhook を 2 発足しても増えない）',
      extra.json?.sent === 2 && drained && n1 - n0 === 2 && resultsFor(rs, tid).length === 1,
      `sent=${extra.json?.sent} drained=${drained} openai_delta=${n1 - n0} results=${resultsFor(rs, tid).length} nudges=${nudges}`,
    );
  }

  // ---- (i4) 9 回目 → OpenAI は 8 回のまま ----
  {
    const J = await imageJob('i4');
    opened.push(J);
    const n0 = await openAiCount();
    const ids = await askImages(J, Array.from({ length: 9 }, (_, i) => imgInput(`9 枚の ${i + 1}`)));
    const rows = await waitRows(J.jobId, allTerminal(9), 40_000);
    const { rs, nudges } = await waitResults(J, ids, 40_000);
    const n1 = await openAiCount();
    const done = rows.filter((r) => r.state === 'done').length;
    const refused = rows.filter((r) => r.state === 'refused');
    const ninth = resultsFor(rs, refused[0]?.custom_tool_use_id ?? '-')[0];
    check(
      '(i4) 1 job に 9 回 → done 8・refused job_image_limit 1・OpenAI 8 回・result 9 件（9 件目は is_error）',
      done === 8 && refused.length === 1 && refused[0].error === 'job_image_limit' && n1 - n0 === 8 && ids.every((id) => resultsFor(rs, id).length === 1) && ninth?.is_error === true,
      `done=${done} refused=${refused.map((r) => r.error).join(',')} openai=${n1 - n0} results=${ids.map((id) => resultsFor(rs, id).length).join('')} nudges=${nudges}`,
    );
  }
  await closeJobs(opened.splice(1));

  // ---- (i7) 止める → queued は failed halted、dispatched は done で返る。再開する → 次の依頼が通る ----
  {
    const J = await imageJob('i7');
    opened.push(J);
    await gate(true);
    const ids = await askImages(J, [imgInput('止める前の 1'), imgInput('止める前の 2'), imgInput('止める前の 3')]);
    const r0 = await waitRows(J.jobId, (rs) => rs.length === 3 && rs.filter((r) => r.state === 'dispatched').length === 1 && rs.filter((r) => r.state === 'queued').length === 2);
    const n0 = await openAiCount();
    const halt = await api('POST', '/api/images/halt');
    await gate(false);
    await waitRows(J.jobId, (rs) => rs.some((r) => r.state === 'done'));
    await sleep(3000); // 残り 2 件の message の consumer（D は停止中で 0 行）
    const mid = await imageRows(J.jobId);
    const queued = mid.filter((r) => r.state === 'queued');
    const ages = [];
    for (const r of queued) ages.push((await api('POST', '/__fake/image-age', { request_id: r.id, minutes: 6 })).json?.changed);
    await cron();
    const end = await waitRows(J.jobId, allTerminal(3));
    const { rs, nudges } = await waitResults(J, ids);
    const n1 = await openAiCount();
    const doneRow = end.find((r) => r.state === 'done');
    const haltedRows = end.filter((r) => r.state === 'failed' && r.error === 'halted');
    const doneRes = resultsFor(rs, doneRow?.custom_tool_use_id ?? '-')[0];
    const haltedRes = haltedRows.map((r) => resultsFor(rs, r.custom_tool_use_id)[0]);
    check(
      '(i7) 止める: dispatched の 1 件は done で返り（画像 block）、queued の 2 件は queued のまま → C2 で failed halted（is_error「今は画像を作れません」）・停止後の OpenAI 0 回',
      r0.length === 3 && halt.status === 200 && halt.json?.halted === 'manual' && mid.filter((r) => r.state === 'done').length === 1 && queued.length === 2 && ages.every((c) => c === 1) &&
        !!doneRow && doneRes?.is_error === false && doneRes?.content?.[0]?.type === 'image' && haltedRows.length === 2 &&
        haltedRes.every((x) => x?.is_error === true && x?.content?.[0]?.text === UNAVAILABLE_TEXT) && n1 - n0 === 0,
      `states=${end.map((r) => `${r.state}/${r.error ?? '-'}`).join(',')} halt=${halt.status}/${halt.json?.halted} openai_after_halt=${n1 - n0} nudges=${nudges}`,
    );
    // 停止中の新しい依頼は refused halted（対照）→ 再開 → 次の依頼が done
    const [t2] = await askImages(J, [imgInput('停止中の依頼')]);
    const r2 = await waitRows(J.jobId, allTerminal(4));
    await waitResults(J, [t2]);
    const un = await api('POST', '/api/images/unhalt');
    const st = await imagesStatus();
    const [t3] = await askImages(J, [imgInput('再開後の依頼')]);
    const r3 = await waitRows(J.jobId, allTerminal(5));
    const { rs: rs3 } = await waitResults(J, [t3]);
    check(
      '(i7) 停止中の新しい依頼は refused halted → 再開する（200・halted null）→ 次の依頼は done で返る',
      r2[3]?.state === 'refused' && r2[3]?.error === 'halted' && un.status === 200 && st.halted === null && r3[4]?.state === 'done' && resultsFor(rs3, t3)[0]?.is_error === false,
      `stopped=${r2[3]?.state}/${r2[3]?.error} unhalt=${un.status} halted=${st.halted} next=${r3[4]?.state}`,
    );
  }

  // ---- (i8) quota → 停止、次の cron でも停止のまま ----
  {
    const J = await imageJob('i8');
    opened.push(J);
    const before = (await imagesStatus()).halted;
    await fakeOpenAi('quota');
    const [tid] = await askImages(J, [imgInput('残高切れの図')]);
    const rows = await waitRows(J.jobId, allTerminal(1));
    const { rs } = await waitResults(J, [tid]);
    const h1 = (await imagesStatus()).halted;
    await cron();
    const h2 = (await imagesStatus()).halted;
    await fakeOpenAi('ok');
    check(
      '(i8) quota → failed quota・停止 quota（前は null）・次の cron の後も quota・result は is_error',
      before === null && rows[0]?.state === 'failed' && rows[0]?.error === 'quota' && h1 === 'quota' && h2 === 'quota' && resultsFor(rs, tid)[0]?.is_error === true,
      `before=${before} row=${rows[0]?.state}/${rows[0]?.error} halted=${h1}->${h2}`,
    );
    const un = await api('POST', '/api/images/unhalt');
    if (un.status !== 200) fail('(i8) 後始末の再開', `status=${un.status}`);
  }

  // ---- (i9) ok（対照）/ no_usage / over_reserve / bad_bytes_with_usage、+ 1.5 MB の PNG（base64 で約 2 MB）----
  {
    const J = await imageJob('i9');
    opened.push(J);
    const runOne = async (scenario, n) => {
      await fakeOpenAi(scenario);
      const [tid] = await askImages(J, [imgInput(`i9 ${scenario}`)]);
      const rows = await waitRows(J.jobId, allTerminal(n));
      const { rs } = await waitResults(J, [tid]);
      const halted = (await imagesStatus()).halted;
      const un = halted ? await api('POST', '/api/images/unhalt') : null;
      return { row: rows[n - 1], res: resultsFor(rs, tid), halted, unhalt: un?.status ?? null };
    };
    const ok = await runOne('ok', 1);
    check('(i9) 対照: ok（実額 6¢ ≤ U 10¢）→ done・停止しない', ok.row?.state === 'done' && ok.row?.actual_cents === 6 && ok.halted === null, `row=${ok.row?.state} actual=${ok.row?.actual_cents} halted=${ok.halted}`);
    const nu = await runOne('no_usage', 2);
    check(
      '(i9) no_usage → done（usage missing・実額 NULL）+ 停止 usage_missing:<id>・result は成功の文',
      nu.row?.state === 'done' && nu.row?.usage_missing === 1 && nu.row?.actual_cents === null && nu.halted === `usage_missing:${nu.row?.id}` && nu.res[0]?.is_error === false && nu.unhalt === 200,
      `row=${nu.row?.state} missing=${nu.row?.usage_missing} halted=${nu.halted} unhalt=${nu.unhalt}`,
    );
    const ov = await runOne('over_reserve', 3);
    check(
      '(i9) over_reserve → done（実額 61¢ > U 10¢）+ 停止 over_reserve:<id>',
      ov.row?.state === 'done' && ov.row?.actual_cents === 61 && ov.row?.u_cents === 10 && ov.halted === `over_reserve:${ov.row?.id}` && ov.unhalt === 200,
      `row=${ov.row?.state} actual=${ov.row?.actual_cents} halted=${ov.halted}`,
    );
    const bb = await runOne('bad_bytes_with_usage', 4);
    check(
      '(i9) bad_bytes_with_usage → failed bad_response（実額 61¢）+ 停止 over_reserve:<id>・result は is_error',
      bb.row?.state === 'failed' && bb.row?.error === 'bad_response' && bb.row?.actual_cents === 61 && bb.halted === `over_reserve:${bb.row?.id}` && bb.res[0]?.is_error === true && bb.unhalt === 200,
      `row=${bb.row?.state}/${bb.row?.error} actual=${bb.row?.actual_cents} halted=${bb.halted}`,
    );
    const lg = await runOne('ok_large', 5);
    const blk = lg.res[0]?.content?.[0]?.source;
    const file = await fetch(`${BASE}/api/images/requests/${lg.row?.id}/file`);
    const fileBuf = await file.arrayBuffer();
    check(
      '(i9/t14) 1.5 MB 級の PNG → done・custom_tool_result の base64 block（約 2 MB）が送られ、復号の SHA-256 = sha256 = 運営の画像ファイル',
      lg.row?.state === 'done' && lg.row?.bytes > 1_400_000 && blk?.type === 'base64' && blk?.data_length > 1_900_000 && blk?.data_sha256 === lg.row?.sha256 && file.status === 200 && sha256Hex(fileBuf) === lg.row?.sha256 && lg.halted === null,
      `row=${lg.row?.state} bytes=${lg.row?.bytes} b64_len=${blk?.data_length} sha_eq=${blk?.data_sha256 === lg.row?.sha256} file=${file.status} halted=${lg.halted}`,
    );
    await fakeOpenAi('ok');
  }

  // ---- (i11) 返す送信を fake で 1 回失敗 → 次の reconcile が送る、result は 1 件 ----
  {
    const J = await imageJob('i11');
    opened.push(J);
    const arm = await api('POST', '/__fake/fail-sends', { session_id: J.sid, type: 'user.custom_tool_result', count: 1 });
    const [tid] = await askImages(J, [imgInput('送信失敗の図')]);
    await waitRows(J.jobId, allTerminal(1));
    const { rs, nudges } = await waitResults(J, [tid]);
    await nudge(J.sid, J.tag);
    await sleep(1500);
    const cs = await calls(J.sid);
    const failedSends = cs.filter((c) => c.op === 'events.send_failed' && (c.events ?? []).some((e) => e.custom_tool_use_id === tid)).length;
    const final = resultsFor(await toolResults(J.sid), tid);
    check(
      '(i11) 返す送信が 1 回失敗 → 次の reconcile が送る・result は 1 件（その後の webhook でも増えない）',
      arm.status === 200 && failedSends === 1 && resultsFor(rs, tid).length === 1 && final.length === 1 && final[0].is_error === false && nudges >= 1,
      `failed_sends=${failedSends} results=${final.length} nudges=${nudges}`,
    );
  }
  await closeJobs(opened.splice(1));

  // ---- (i12) 運営の操作の画面（admin.js を node:vm で起動し、DOM の要素数とトースト）----
  {
    const J = await imageJob('i12');
    opened.push(J);
    await adminImagesSmoke(J);
  }
  await closeJobs(opened.splice(1));

  // ---- (i10) 月の記帳 2721 で新しい job → monthly_cap、取り置きのある job は続く ----
  {
    const H = await imageJob('i10h');
    opened.push(H);
    await askImages(H, [imgInput('取り置きを作る図')]);
    await waitRows(H.jobId, allTerminal(1));
    const m0 = (await imagesStatus()).month_cents;
    const seed = await api('POST', '/__fake/image-ledger', { cents: 2721 - m0 });
    const m1 = (await imagesStatus()).month_cents;
    const N = await imageJob('i10n');
    opened.push(N);
    const n0 = await openAiCount();
    const [tn] = await askImages(N, [imgInput('月の上限の図')]);
    const nRows = await waitRows(N.jobId, allTerminal(1));
    const { rs: nRs } = await waitResults(N, [tn]);
    const n1 = await openAiCount();
    const [th] = await askImages(H, [imgInput('取り置きのある job の 2 枚目')]);
    const hRows = await waitRows(H.jobId, allTerminal(2));
    const n2 = await openAiCount();
    const m2 = (await imagesStatus()).month_cents;
    check(
      '(i10) 月の記帳 2721¢ → 新しい job は refused monthly_cap（OpenAI 0 回・is_error）、取り置きのある job の 2 枚目は done（OpenAI 1 回）・記帳は増えない',
      m0 < 2721 && seed.status === 200 && m1 === 2721 && nRows[0]?.state === 'refused' && nRows[0]?.error === 'monthly_cap' && n1 - n0 === 0 && resultsFor(nRs, tn)[0]?.is_error === true &&
        hRows[1]?.state === 'done' && n2 - n1 === 1 && m2 === 2721,
      `month=${m0}->${m1}->${m2} new=${nRows[0]?.state}/${nRows[0]?.error} openai=${n1 - n0},${n2 - n1} held=${hRows[1]?.state} th=${!!th}`,
    );
  }
  await closeJobs(opened);
}

/** 最小の DOM（id を持つ要素だけ）。innerHTML を入れると、その中の id="…" の要素を作り直す（本物の DOM の再描画と同じく古い要素は外れる） */
function makeDom(indexHtml) {
  const els = new Map();
  const mk = (id) => {
    const listeners = {};
    const cls = new Set();
    let html = '';
    const el = {
      id,
      textContent: '',
      value: '',
      disabled: false,
      open: false,
      tagName: 'DIV',
      listeners,
      classList: {
        add: (c) => cls.add(c),
        remove: (c) => cls.delete(c),
        toggle: (c, on) => ((on === undefined ? !cls.has(c) : on) ? cls.add(c) : cls.delete(c)),
        contains: (c) => cls.has(c),
      },
      className: '',
      addEventListener: (t, f) => (listeners[t] ??= []).push(f),
      removeEventListener: (t, f) => {
        listeners[t] = (listeners[t] ?? []).filter((x) => x !== f);
      },
      focus() {},
      showModal() {
        el.open = true;
      },
      close() {
        el.open = false;
      },
      querySelector: (sel) => doc.querySelector(sel),
      querySelectorAll: () => [],
      setAttribute() {},
      removeAttribute() {},
      getAttribute: () => null,
    };
    Object.defineProperty(el, 'innerHTML', {
      get: () => html,
      set: (v) => {
        html = String(v);
        register(html);
      },
    });
    return el;
  };
  const register = (html) => {
    for (const m of html.matchAll(/\bid="([^"]+)"/g)) els.set(m[1], mk(m[1]));
  };
  const doc = {
    body: mk('body'),
    hidden: false,
    activeElement: null,
    querySelector: (sel) => {
      const m = /^#([\w-]+)$/.exec(sel);
      return m ? els.get(m[1]) ?? null : null;
    },
    querySelectorAll: () => [],
    addEventListener() {},
    createElement: () => mk(''),
  };
  register(indexHtml);
  return { doc, el: (id) => els.get(id) ?? null };
}

const click = (el) => (el?.listeners?.click ?? []).slice().forEach((f) => f({ preventDefault() {}, target: el }));
async function waitFor(pred, ms = 8000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (pred()) return true;
    await sleep(50);
  }
  return pred();
}

/** (i12): #/images を起動して 止める → 状況帯に停止の文 → 再開する（dispatched が残る間は 409 のトースト）→ 再開 → 消える */
async function adminImagesSmoke(J) {
  const html = await (await fetch(`${BASE}/admin/`)).text();
  const code = await (await fetch(`${BASE}/admin/admin.js`)).text();
  const n = (s, re) => (String(s).match(re) || []).length;
  // 純関数: 読み込み中 / 取得失敗 / 0 件
  {
    const win = { __FACTORY_ADMIN_NO_BOOT__: true };
    vm.runInNewContext(code, { window: win, console }, { timeout: 2000 });
    const I = win.FactoryAdminImages;
    const empty = I.imagesHtml({ halted: null, month_cents: 0, month_cap_cents: 3000, holds_open: 0, dispatched: 0, recent: [] });
    check(
      '(i12) 純関数: 読み込み中 1・取得失敗 1（もう一度読み込む）・0 件で「まだありません」1・行 0',
      n(I.imagesLoadingHtml(), /data-img-loading="1"/g) === 1 && n(I.imagesErrorHtml('x'), /data-img-error="1"/g) === 1 && I.imagesErrorHtml('x').includes('id="img-retry"') && n(empty, /data-img-empty="1"/g) === 1 && n(empty, /data-img-row="1"/g) === 0,
      'pure',
    );
  }
  // 生成中（dispatched）を 1 つ作っておく（門を閉じる）
  await gate(true);
  await askImages(J, [imgInput('画面の操作中に生成中の図')]);
  const disp = await waitRows(J.jobId, (rs) => rs[0]?.state === 'dispatched');

  const dom = makeDom(html);
  const busySeen = [];
  const ctx = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    addEventListener() {},
    location: { hash: '#/images', pathname: '/admin/' },
    document: dom.doc,
    fetch: (path, opt = {}) => {
      const method = opt.method ?? 'GET';
      if (method !== 'GET') {
        const b = dom.el(path.endsWith('/unhalt') ? 'img-unhalt-btn' : 'img-halt-btn');
        busySeen.push({ path, disabled: b?.disabled, text: b?.textContent });
      }
      const headers = { ...(opt.headers ?? {}) };
      if (method !== 'GET') headers.origin = BASE;
      return fetch(BASE + path, { method, headers, body: opt.body });
    },
  };
  ctx.window = ctx;
  let bootErr = null;
  try {
    vm.runInNewContext(code, ctx, { timeout: 5000 });
  } catch (e) {
    bootErr = String(e && e.message).slice(0, 120);
  }
  const view = () => dom.el('view')?.innerHTML ?? '';
  const band = () => dom.el('status')?.innerHTML ?? '';
  const toast = () => ({ text: dom.el('toast')?.textContent ?? '', cls: dom.el('toast')?.className ?? '' });
  await waitFor(() => view().includes('data-img-state=') && band().includes('data-img-band="1"'));
  const st0 = await imagesStatus();
  check(
    '(i12) 起動: 状況帯に「画像: 今月」1・停止の文 0・#/images は running・行数 = 最近の件数・止める有効 / 再開する無効',
    !bootErr && n(band(), /data-img-band="1"/g) === 1 && n(band(), /data-img-halted="1"/g) === 0 && view().includes('data-img-state="running"') &&
      n(view(), /data-img-row="1"/g) === Math.min(20, (st0.recent ?? []).length) && (st0.recent ?? []).length > 0 &&
      /id="img-halt-btn">/.test(view()) && /id="img-unhalt-btn" disabled>/.test(view()) && disp[0]?.state === 'dispatched',
    `boot=${bootErr ?? 'ok'} band=${n(band(), /data-img-band="1"/g)} rows=${n(view(), /data-img-row="1"/g)}/${(st0.recent ?? []).length} disp=${disp[0]?.state}`,
  );
  // 止める: 予告（ダイアログ）→ 実行（処理中・無効）→ トースト → 状況帯に停止の文
  click(dom.el('img-halt-btn'));
  const dlg1 = dom.el('dlg')?.open === true && dom.el('dlg-title')?.textContent === '新しい画像の生成を止めます';
  click(dom.el('dlg-ok'));
  await waitFor(() => view().includes('data-img-state="halted"') && band().includes('data-img-halted="1"'));
  const t1 = toast();
  const b1 = busySeen.find((x) => x.path === '/api/images/halt');
  check(
    '(i12) 止める: ダイアログ → 送信中は無効・「処理中…」→ トースト「画像の生成を止めました」→ #/images は halted・状況帯に停止の文 1',
    dlg1 && b1?.disabled === true && b1?.text === '処理中…' && t1.text === '画像の生成を止めました' && !t1.cls.includes('error') &&
      n(band(), /data-img-halted="1"/g) === 1 && band().includes('手で止めました') && /id="img-unhalt-btn">/.test(view()),
    `dlg=${dlg1} busy=${JSON.stringify(b1 ?? null)} toast=${t1.text}/${t1.cls} halted_band=${n(band(), /data-img-halted="1"/g)}`,
  );
  // 再開する（生成中が残る）→ 409 dispatched_remain のトースト・停止のまま
  click(dom.el('img-unhalt-btn'));
  const dlg2 = dom.el('dlg-body')?.textContent === 'OpenAI の利用画面で実額を確かめてから押してください';
  click(dom.el('dlg-ok'));
  await waitFor(() => toast().cls.includes('error'));
  await waitFor(() => view().includes('data-img-disp="1"'));
  const t2 = toast();
  check(
    '(i12) 生成中が残る間の再開 → エラーのトースト（dispatched_remain の文）・停止のまま・「生成中の画像が 1 枚」',
    dlg2 && t2.cls.includes('error') && t2.text.startsWith('生成中の画像が残っているため') && view().includes('data-img-state="halted"') && n(band(), /data-img-halted="1"/g) === 1,
    `dlg=${dlg2} toast=${t2.text.slice(0, 30)}/${t2.cls} state=${/data-img-state="halted"/.test(view())}`,
  );
  // 生成を終わらせて再開 → 成功のトースト → 状況帯から停止の文が消える
  await gate(false);
  await waitRows(J.jobId, allTerminal(1));
  dom.el('toast').className = 'toast hidden';
  dom.el('toast').textContent = '';
  // 409 の後の再描画（opts.fail → route()）で作り直されたボタンを押す
  click(dom.el('img-unhalt-btn'));
  click(dom.el('dlg-ok'));
  await waitFor(() => toast().text !== '' && view().includes('data-img-state="running"') && !band().includes('data-img-halted="1"'));
  const t3 = toast();
  check(
    '(i12) 生成が終わった後の再開 → トースト「画像の生成を再開しました」→ #/images は running・状況帯の停止の文 0',
    t3.text === '画像の生成を再開しました' && !t3.cls.includes('error') && view().includes('data-img-state="running"') && n(band(), /data-img-halted="1"/g) === 0 && (await imagesStatus()).halted === null,
    `toast=${t3.text}/${t3.cls} running=${view().includes('data-img-state="running"')} halted_band=${n(band(), /data-img-halted="1"/g)}`,
  );
}

main().catch((e) => {
  console.log(`FAIL smoke_crashed ${e && e.name ? e.name : 'error'}: ${e && e.message ? String(e.message).slice(0, 200) : ''}`);
  console.log('SMOKE_RESULT=FAIL');
  process.exit(1);
});
