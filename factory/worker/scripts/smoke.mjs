// smoke（契約 §H (a)〜(e),(g)〜(i),(k)〜(n)、§K-8 (o)〜(s)、§L-7 (l5)、§N-5 (n2)(n3)）。scripts/smoke.sh が wrangler dev（fake）を起動してから呼ぶ。
// 出力: 1 行ずつ `PASS <名前>` / `FAIL <名前> <理由>`。最後に SMOKE_RESULT=PASS|FAIL。応答本文は必要な field だけを見る。
import crypto from 'node:crypto';
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
      fl.status === 200 && !!fl.json?.stations && keys.every((k) => typeof fl.json.stations[k] === 'object') && Object.keys(fl.json.stations).length === 6 && Array.isArray(fl.json?.queue),
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
  let aD = await cronUntil(aVid, (d) => d.version?.verification_status === 'done');
  check('(c) cron で検証 done', aD?.version?.verification_status === 'done' && !!aD?.verification_id, `vs=${aD?.version?.verification_status}`);
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
  let r = await api('POST', `/api/review/${aVid}/decision`, { decision: 'approve', checklist: ALL_OK, note: 'smoke', verification_id: aD?.verification_id });
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
  let v2D = await cronUntil(v2?.id, (d) => d.version?.verification_status === 'done');
  const oldVid = v2D?.verification_id;
  check('(n) v2 の検証 attempt 1 done', v2D?.version?.verification_status === 'done' && v2D?.verification?.attempt === 1, `vs=${v2D?.version?.verification_status} att=${v2D?.verification?.attempt}`);

  // ---- (n) reverify ----
  r = await api('POST', `/api/review/${v2?.id}/reverify`);
  check('(n) reverify → 200 pending', r.status === 200 && r.json?.verification_status === 'pending', `status=${r.status} err=${r.json?.error}`);
  v2D = await cronUntil(v2?.id, (d) => d.version?.verification_status === 'done');
  {
    const hist = v2D?.verification_history ?? [];
    check(
      '(n) 2 回目の検証 done・履歴 2 行（attempt 1, 2）・verification_id が新しい',
      v2D?.version?.verification_status === 'done' &&
        hist.length === 2 &&
        hist[0].attempt === 1 &&
        hist[1].attempt === 2 &&
        hist[0].id === oldVid &&
        hist[1].id === v2D?.verification_id &&
        v2D.verification_id !== oldVid,
      `vs=${v2D?.version?.verification_status} hist=${JSON.stringify(hist.map((h) => h.attempt))}`,
    );
  }
  r = await api('POST', `/api/review/${v2?.id}/decision`, { decision: 'approve', checklist: ALL_OK, note: '', verification_id: oldVid });
  check('(n) 古い verification_id の approve → 409', r.status === 409, `status=${r.status} err=${r.json?.error}`);
  r = await api('POST', `/api/review/${v2?.id}/decision`, { decision: 'approve', checklist: ALL_OK, note: '', verification_id: v2D?.verification_id });
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
  const ic = await makeVersion('done-contradicted', 'i');
  const icD = await cronUntil(ic.versionId, (d) => d.version?.verification_status === 'done');
  r = await api('POST', `/api/review/${ic.versionId}/decision`, { decision: 'approve', checklist: ALL_OK, note: '', verification_id: icD?.verification_id });
  check('(i) contradicted を含む版の approve → 400 has_contradicted_claims', r.status === 400 && r.json?.error === 'has_contradicted_claims', `status=${r.status} err=${r.json?.error} vs=${icD?.version?.verification_status}`);
  // 差し戻し → rework job が queued/running で作られる
  r = await api('POST', `/api/review/${ic.versionId}/decision`, { decision: 'return', checklist: ALL_OK, note: 'c2 の根拠を見直してください', brief_append: '' });
  const icMat = (await api('GET', `/api/materials/${ic.materialId}`)).json;
  check('(i) 差し戻し → 版 rejected + rework job + review_decisions(return)', r.status === 200 && icMat?.versions?.[0]?.status === 'rejected' && icMat?.jobs?.some((x) => x.kind === 'rework') && icMat?.review_decisions?.some((d) => d.decision === 'return'), `status=${r.status} err=${r.json?.error}`);

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

  // ---- personal data 確認 ----
  {
    const r2 = await api('POST', '/api/materials', { title: 't', slug: `smoke-pii-${RUN}`, kinds: [3], brief_md: 'b', no_personal_data: false });
    check('no_personal_data !== true → 400', r2.status === 400 && r2.json?.error === 'personal_data_confirmation_required', `status=${r2.status}`);
  }

  // ---- 入口（§K-8）----
  await intakeSmoke();

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

main().catch((e) => {
  console.log(`FAIL smoke_crashed ${e && e.name ? e.name : 'error'}: ${e && e.message ? String(e.message).slice(0, 200) : ''}`);
  console.log('SMOKE_RESULT=FAIL');
  process.exit(1);
});
