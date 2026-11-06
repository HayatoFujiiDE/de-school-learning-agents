// smoke（contract-T T-14 c。お題のストック）。scripts/smoke.sh が smoke.mjs の後に呼ぶ（wrangler dev・fake・同じローカル状態）。
// 順番: 手動の生成 → 検査 → 自動 ready / 重いお題は要確認に出る → 承認（read_all）→ 予定の確定 → GET /api/library/topics に両方出る（重い方は needs_supporter）
//       → 出典が通らないお題は承認が 400 → 見直し → 親の引退 → 発展 → 止める → 配信から消える → status の値 / #/topics を直接開いて画面が出る。
// fake の生成は src/fake/topics.ts（news は 普通 + 重い の 2 本、talk は 普通 + 出典が開けても引用の無い 1 本）。外部へは出ない。
// 出力: 1 行ずつ `PASS (t…) …` / `FAIL (t…) … <理由>`。最後に SMOKE_TOPICS_RESULT=PASS|FAIL。応答本文は必要な field だけを見る。
const BASE = process.env.SMOKE_BASE ?? 'http://localhost:8787';
let failed = 0;
const pass = (name) => console.log(`PASS ${name}`);
const fail = (name, why) => {
  failed++;
  console.log(`FAIL ${name} ${why}`);
};
const check = (name, cond, why = '') => (cond ? pass(name) : fail(name, why));

async function api(method, path, body) {
  const headers = { accept: 'application/json' };
  if (method !== 'GET') headers.origin = BASE;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

async function cron() {
  const r = await fetch(`${BASE}/__scheduled?cron=*/10+*+*+*+*`);
  await r.text();
  return r.status;
}

const tokyoToday = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const topic = async (id) => (await api('GET', `/api/topics/${id}`)).json;
const decide = (id, sha, decision, extra = {}) => api('POST', `/api/topics/${id}/decide`, { decision, content_sha256: sha, ...extra });

/** cron を最大 max 回流し、pred(お題) が真になるまで待つ */
async function cronUntil(id, pred, max = 6) {
  let d = null;
  for (let i = 0; i < max; i++) {
    await cron();
    d = await topic(id);
    if (d && pred(d.topic)) return d;
  }
  return d;
}

async function main() {
  const today = tokyoToday();
  // scheduled handler で fake を使う（settings.fake_enabled = '1'。job の scenario はどれでもよい）
  const fs = await api('POST', '/__fake/settings', { scenario: 'questions-empty-then-done' });
  if (fs.status !== 200) throw new Error(`fake settings -> ${fs.status}`);

  // ---- 入・切 ----
  const on = await api('POST', '/api/topics/settings', { enabled: true });
  const meta = (await api('GET', '/api/topics/meta')).json;
  check('(t1) 入にできる・meta に 4 種類と枠', on.status === 200 && meta?.enabled === true && meta?.kinds?.length === 4 && meta.kinds.map((k) => k.slots).join(',') === '2,1,1,3', `status=${on.status} meta=${JSON.stringify(meta?.kinds ?? null).slice(0, 80)}`);

  // ---- 手動の生成（news）----
  const gen = await api('POST', '/api/topics/runs', { kind: 'news' });
  const runId = gen.json?.run?.id;
  check('(t2) 手動の生成 news → run done・2 本', gen.status === 200 && gen.json?.run?.status === 'done' && gen.json?.run?.made === 2, `status=${gen.status} run=${JSON.stringify(gen.json?.run ?? gen.json).slice(0, 120)}`);
  const A = `tp_${runId}_1`;
  const B = `tp_${runId}_2`;
  const a0 = await topic(A);
  check('(t2b) 生成の応答の web_fetch の結果で 1 本目の出典が gen_fetch で found', a0?.sources?.[0]?.fetch_result === 'found' && a0?.sources?.[0]?.evidence === 'gen_fetch', JSON.stringify(a0?.sources?.[0] ?? null).slice(0, 120));

  // ---- 検査 → 自動 ready / 重いお題は要確認 ----
  const a1 = await cronUntil(A, (t) => t.status === 'ready');
  check('(t3) 検査 → 普通のお題は自動で ready（決定の記録 auto_ready）', a1?.topic?.status === 'ready' && a1?.decisions?.some((d) => d.decision === 'auto_ready'), `status=${a1?.topic?.status}`);
  // 今日の予定は、出せるお題がある最初の tick で確定する（v2.3）。B を今日の予定に入れるため、
  // A が ready になった後は B の承認まで cron を流さない（検査は 1 tick に 3 本まで: A と同じ tick で B も held になる）
  let b1 = await topic(B);
  if (b1?.topic?.status !== 'held') b1 = await cronUntil(B, (t) => t.status === 'held');
  const held = (await api('GET', '/api/topics?status=held')).json?.topics ?? [];
  const hb = held.find((t) => t.id === B);
  check('(t4) 重いお題は要確認（held・hold_group heavy・承認できる・read_all が要る）', b1?.topic?.hold_reason === 'heavy' && hb?.hold_group === 'heavy' && hb?.approvable === true && hb?.needs_read_all === true, JSON.stringify(hb ?? null).slice(0, 160));

  // ---- 承認（read_all）----
  const shaB = b1?.topic?.content_sha256;
  const noRead = await decide(B, shaB, 'approve');
  const ok = await decide(B, shaB, 'approve', { read_all: true, note: 'smoke: 全文を読んだ' });
  check('(t5) 重い話題は read_all なしで 400 → read_all つきで承認 → ready', noRead.status === 400 && noRead.json?.error === 'read_all_required' && ok.status === 200 && ok.json?.topic?.status === 'ready', `no_read=${noRead.status}/${noRead.json?.error} ok=${ok.status}/${ok.json?.topic?.status}`);

  // ---- 予定の確定 → 配信 ----
  // 今日の予定はまだ確定していない（出せるお題の無い tick では確定しない）。A・B が ready の次の tick で確定する。
  // 並びを決まったものにするため A・B に星を付ける（予定の後で外す）
  await decide(A, a1.topic.content_sha256, 'star');
  await decide(B, shaB, 'star');
  const before = (await api('GET', `/api/topics/schedule?day=${today}`)).json;
  await cron();
  const lib = await api('GET', '/api/library/topics');
  const ids = (lib.json?.topics ?? []).map((t) => t.topic_id);
  const lb = (lib.json?.topics ?? []).find((t) => t.topic_id === B);
  const la = (lib.json?.topics ?? []).find((t) => t.topic_id === A);
  check(
    '(t6) 出せるお題の無い間は今日の予定が未確定 → 確定 → GET /api/library/topics に両方出る（重い方は needs_supporter・no-store・子どもの項目なし）',
    before?.planned === false && lib.status === 200 && ids.includes(A) && ids.includes(B) && lb?.needs_supporter === true && la?.needs_supporter === false && Object.keys(lb ?? {}).sort().join(',') === 'body,kind,lineage_id,needs_supporter,pos,topic_id',
    `planned_before=${before?.planned} lib=${lib.status} ids=${ids.length} b_sup=${lb?.needs_supporter}`,
  );
  await decide(A, a1.topic.content_sha256, 'unstar');
  await decide(B, shaB, 'unstar');

  // ---- 出典が通らないお題は承認が 400 ----
  const talk = await api('POST', '/api/topics/runs', { kind: 'talk' });
  const tRun = talk.json?.run?.id;
  const T2 = `tp_${tRun}_2`;
  const t2 = await cronUntil(T2, (t) => t.status === 'held');
  const t2a = await decide(T2, t2?.topic?.content_sha256, 'approve', { read_all: true });
  check(
    '(t7) 出典の引用が見つからないお題は held（source_not_found）で、承認は 400 not_approvable',
    talk.status === 200 && t2?.topic?.hold_reason === 'source_not_found' && t2?.topic?.hold_group === 'source' && t2a.status === 400 && t2a.json?.error === 'not_approvable',
    `talk=${talk.status} hold=${t2?.topic?.hold_reason} approve=${t2a.status}/${t2a.json?.error}`,
  );

  // ---- 見直し → 親の引退 ----
  const rf = await api('POST', `/api/topics/${A}/derive`, { kind: 'refresh', note: 'smoke: 今日の時点に合わせる' });
  const A2 = `tp_${rf.json?.run?.id}_1`;
  const a2 = await cronUntil(A2, (t) => t.status === 'ready');
  const aAfter = await topic(A);
  check(
    '(t8) 見直し → 子が自動で ready（親と同じ題）→ 親は引退（auto_retire）・系譜に親子',
    rf.status === 200 &&
      rf.json?.run?.status === 'done' &&
      a2?.topic?.status === 'ready' &&
      a2?.topic?.title === a1?.topic?.title &&
      aAfter?.topic?.status === 'retired' &&
      aAfter?.decisions?.some((d) => d.decision === 'auto_retire') &&
      // 系譜は親が先頭で子を含む（予定のために星を付けた間に、cron の発展が A の子を作ることがある）
      a2?.lineage?.[0]?.id === A &&
      a2?.lineage?.some((l) => l.id === A2 && l.depth === 1 && l.derive_kind === 'refresh'),
    `derive=${rf.status}/${rf.json?.run?.status ?? rf.json?.error} child=${a2?.topic?.status} parent=${aAfter?.topic?.status} same_title=${a2?.topic?.title === a1?.topic?.title} auto_retire=${!!aAfter?.decisions?.some((d) => d.decision === 'auto_retire')} lineage=${(a2?.lineage ?? []).map((l) => `${l.depth}:${l.derive_kind ?? '-'}:${l.status}`).join('|')}`,
  );

  // ---- 発展 ----
  const ex = await api('POST', `/api/topics/${A2}/derive`, { kind: 'extend', note: 'smoke: 答えのない問いへ' });
  const A3 = `tp_${ex.json?.run?.id}_1`;
  const a3 = await cronUntil(A3, (t) => t.status === 'ready');
  const a2After = await topic(A2);
  check(
    '(t9) 発展 → 子（philo・depth 2）が ready・親は残る',
    ex.status === 200 && a3?.topic?.status === 'ready' && a3?.topic?.kind === 'philo' && a3?.topic?.depth === 2 && a2After?.topic?.status === 'ready',
    `derive=${ex.status}/${ex.json?.run?.status ?? ex.json?.error} child=${a3?.topic?.status}/${a3?.topic?.kind} parent=${a2After?.topic?.status}`,
  );

  // ---- 止める → 配信から消える ----
  const bNow = await topic(B);
  const rt = await decide(B, bNow?.topic?.content_sha256, 'retire', { note: 'smoke: 止める' });
  const lib2 = await api('GET', '/api/library/topics');
  const ids2 = (lib2.json?.topics ?? []).map((t) => t.topic_id);
  const sched = (await api('GET', `/api/topics/schedule?day=${today}`)).json;
  const stopped = (sched?.slots ?? []).filter((s) => s.state === 'stopped').map((s) => s.topic?.id);
  check(
    '(t10) 止める → 配信から消える（引退した親も）・schedule は stopped',
    rt.status === 200 && rt.json?.topic?.status === 'retired' && !ids2.includes(B) && !ids2.includes(A) && stopped.includes(B) && stopped.includes(A),
    `retire=${rt.status} lib=${ids2.length} stopped=${stopped.length}`,
  );

  // ---- status ----
  const st = (await api('GET', '/api/status')).json?.topics;
  check(
    '(t11) /api/status の topics（enabled・今月の額・要確認・今日の stopped・最後の run）',
    st?.enabled === true && st.month_cents > 0 && st.month_cap_cents === 2000 && st.needs_review?.source >= 1 && st.today?.stopped >= 2 && typeof st.last_run?.id === 'string' && st.over_reserve === 0 && typeof st.failed_24h === 'number',
    JSON.stringify(st ?? null).slice(0, 200),
  );

  // ---- 呼び出しの引数（再送なし・締め切り）----
  const calls = ((await api('GET', '/__fake/calls')).json?.calls ?? []).filter((c) => c.params?.kind === 'topic_gen' || c.params?.kind === 'topic_check');
  check(
    '(t12) お題の呼び出しは全部 maxRetries 0・締め切りつき（生成 150 秒・検査 60 秒が上限）',
    calls.length >= 6 && calls.every((c) => c.opts?.max_retries === 0 && c.opts?.has_deadline === true) && calls.filter((c) => c.params.kind === 'topic_gen').every((c) => c.opts.max_timeout_ms === 150000) && calls.filter((c) => c.params.kind === 'topic_check').every((c) => c.opts.max_timeout_ms === 60000),
    `calls=${calls.length}`,
  );

  // ---- #/topics を直接開いて画面が出る（HTML に topics.js が admin.js より前）----
  const html = await fetch(`${BASE}/admin/`).then(async (r) => ({ status: r.status, text: await r.text() }));
  const iT = html.text.indexOf('src="/admin/topics.js"');
  const iA = html.text.indexOf('src="/admin/admin.js"');
  const js = await fetch(`${BASE}/admin/topics.js`).then((r) => r.status);
  check('(t13) /admin/（#/topics）の HTML に topics.js が admin.js より前にあり、topics.js を配信する', html.status === 200 && iT >= 0 && iA > iT && js === 200, `html=${html.status} topics_at=${iT} admin_at=${iA} js=${js}`);

  console.log(`SMOKE_TOPICS_RESULT=${failed === 0 ? 'PASS' : 'FAIL'}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.log(`FAIL smoke_topics_crashed ${e && e.name ? e.name : 'error'}: ${e && e.message ? String(e.message).slice(0, 200) : ''}`);
  console.log('SMOKE_TOPICS_RESULT=FAIL');
  process.exit(1);
});
