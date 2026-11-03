// smoke（契約 §H (a)〜(e),(g)〜(i),(k)〜(n)）。scripts/smoke.sh が wrangler dev（fake）を起動してから呼ぶ。
// 出力: 1 行ずつ `PASS <名前>` / `FAIL <名前> <理由>`。最後に SMOKE_RESULT=PASS|FAIL。応答本文は必要な field だけを見る。
import crypto from 'node:crypto';
import http from 'node:http';

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
    const msg = all.find((c) => c.op === 'messages.create');
    check(
      '(c) 検証係は tool_choice auto + report_verdicts strict + web_fetch_20260209',
      msg?.params?.tool_choice?.type === 'auto' &&
        msg?.params?.tools?.some((t) => t.name === 'report_verdicts' && t.strict === true) &&
        msg?.params?.tools?.some((t) => t.type === 'web_fetch_20260209'),
      `calls=${fakeMsgs} ${JSON.stringify(msg?.params?.tool_choice ?? null)}`,
    );
  }
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
    const md = await fetch(`${BASE}/api/library/files/${aVid}/parts/p1/elementary-short.md`);
    check('(k) manifest 内の md は 200 text/markdown', md.status === 200 && /text\/markdown/.test(md.headers.get('content-type') ?? ''), `status=${md.status}`);
    await md.text();
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
  check('(n) 2 回目の検証 done（attempt 2、verification_id が新しい）', v2D?.verification?.attempt === 2 && !!v2D?.verification_id && v2D.verification_id !== oldVid, `att=${v2D?.verification?.attempt}`);
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
    check('(l) GET 以外で Origin 不一致・無しは 403 bad_origin', badOrigin.status === 403 && noOrigin.status === 403 && badOrigin.json?.error === 'bad_origin', `${badOrigin.status}/${noOrigin.status}`);
    const adminLocal = await fetch(`${BASE}/admin/`);
    const adminHtml = await adminLocal.text();
    check('(l) localhost（dev bypass）では /admin が 200 で管理画面 + CSP', adminLocal.status === 200 && adminHtml.includes('コンテンツファクトリー') && /default-src 'self'/.test(adminLocal.headers.get('content-security-policy') ?? ''), `status=${adminLocal.status}`);
  }

  // ---- personal data 確認 ----
  {
    const r2 = await api('POST', '/api/materials', { title: 't', slug: `smoke-pii-${RUN}`, kinds: [3], brief_md: 'b', no_personal_data: false });
    check('no_personal_data !== true → 400', r2.status === 400 && r2.json?.error === 'personal_data_confirmation_required', `status=${r2.status}`);
  }

  console.log(`SMOKE_RESULT=${failed === 0 ? 'PASS' : 'FAIL'}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.log(`FAIL smoke_crashed ${e && e.name ? e.name : 'error'}: ${e && e.message ? String(e.message).slice(0, 200) : ''}`);
  console.log('SMOKE_RESULT=FAIL');
  process.exit(1);
});
