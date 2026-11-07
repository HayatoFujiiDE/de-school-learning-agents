// 確認画面の作り物のデータ 4 通り（契約 §V-9 f・§V-11 (u9)）。detail.json（見てほしい所がある版）を土台に、
// 全部通った版（gate clean）・機械の確認中の版（pending_on = verification）・読み手チェック待ちの版（pending_on = reader）を作る。serve.mjs と test/review-preview.test.ts が共通で使う。
// 実在の組織・人・ページではない。
import { readFileSync } from 'node:fs';

const BASE = JSON.parse(readFileSync(new URL('./detail.json', import.meta.url), 'utf8'));
const copy = (x) => JSON.parse(JSON.stringify(x));
const CHANNEL = 'https://www.youtube.com/@fixture-science';

/** 見てほしい所がある版（fix 4・ask 2・note 2） */
export function attention() {
  return copy(BASE);
}

/** 全部通った版: 出典・利用条件・動かせるもの・チャンネル・読み手係がすべて問題なし（note だけ残る） */
export function clean() {
  const d = copy(BASE);
  d.version.id = 'vclean-0001';
  d.version.version = 4;
  d.version.created_at = '2026-11-06T10:00:00.000Z';
  d.material.title = '赤血球のしごと（全部通った版）';
  d.version.checks.child_text = [];
  const src = Object.fromEntries(d.sources.map((s) => [s.source_id, s]));
  Object.assign(src.s2, { quote_found: 1, check_detail: 'ok' });
  Object.assign(src.s4, { license: 'CC BY 4.0' });
  Object.assign(src.s6, { url_was_fetched: 1, quote_found: 1, check_detail: 'ok' });
  const c6 = d.claims.find((c) => c.id === 'c6');
  Object.assign(c6, { source_ids: ['s1'], reason: 's1 に手首で脈を感じる記述がある', opened_urls: ['https://example.org/body/blood/red-cells'] });
  d.verification.apps = [{ path: 'parts/p2/p2-app.html', verdict: 'ok', reason: 'スライダーを動かすと赤い粒の速さが変わる。外部の読み込みは無い' }];
  d.verification_id = d.verification.id = 'verclean-0001';
  d.verification_history = [{ id: 'verclean-0001', attempt: 1, contradicted: 0, created_at: '2026-11-06T10:30:00.000Z' }];
  d.reader = { ...d.reader, gen: 'rd-clean-0001', findings: d.reader.findings.filter((f) => f.severity === 'note'), summary: '短い文で書かれていて、小学生でも自分で読み進められる。' };
  const notes = d.triage.items.filter((x) => x.severity === 'note');
  d.triage = {
    ...d.triage,
    verification_id: 'verclean-0001',
    reader_gen: 'rd-clean-0001',
    gate: 'clean',
    auto: { content_and_evidence: 'ok', explanation_and_expression: 'ok', relation_to_learning: 'ok', conditions_of_use: 'ok', artifact_behavior: 'ok', terms_of_use: 'ok' },
    items: [
      ...notes,
      { id: 'reader:p2es-structure-1', kind: 'reader', key: 'explanation_and_expression', severity: 'note', cause: 'structure', title: '流れが分かりにくい', detail: d.reader.findings[0].note, path: d.reader.findings[0].path, quote: d.reader.findings[0].quote, suggestion: d.reader.findings[0].suggestion },
    ],
    counts: { fix: 0, ask: 0, note: 3, claims_ok: 7, sources_ok: 6 },
    needs_review: 0,
    bad: false,
    reasons: [],
    action: 'none',
    auto_rounds: 0,
    trusted_keys: [CHANNEL],
    // §L-3 互換の出力（triageVersion と一致することを test/review-preview.test.ts が確かめる）
    groups: [{ cause: 'not_confirmed', source_id: 's6', url: 'https://example.org/stats/blood-cell-counts', verifier_opened_urls: [], claim_ids: ['c2'] }, { cause: 'not_confirmed', source_id: 's2', url: 'https://example.org/cells/nucleus-and-oxygen-capacity-of-mammalian-erythrocytes', verifier_opened_urls: ['https://example.org/cells/nucleus-overview'], claim_ids: ['c5'] }],
    ok_counts: { claims: 5, sources: 4 },
  };
  return d;
}

/** 機械の確認中の版（pending_on = verification）: 検証係が動いている。検証の結果が無いので、主張・動かせるもの・動画の項目はまだ作られない */
export function pending() {
  const d = clean();
  d.version.id = 'vpend-0001';
  d.version.version = 5;
  d.version.created_at = '2026-11-06T11:00:00.000Z';
  d.version.verification_status = 'running';
  d.version.verify_phase = 'submitted';
  d.material.title = '赤血球のしごと（確認中の版）';
  d.verification = null;
  d.verification_id = null;
  d.verification_history = [];
  d.claims = d.claims.map((c) => ({ ...c, verdict: null, reason: null, opened_urls: [], presented_as: null }));
  d.reader = { ...d.reader, gen: 'rd-pend-0001' };
  d.triage = {
    ...d.triage,
    verification_id: null,
    reader_gen: 'rd-pend-0001',
    gate: 'pending',
    pending_on: ['verification'],
    auto: { content_and_evidence: 'review', explanation_and_expression: 'review', relation_to_learning: 'ok', conditions_of_use: 'ok', artifact_behavior: 'review', terms_of_use: 'review' },
    items: [],
    counts: { fix: 0, ask: 0, note: 0, claims_ok: 7, sources_ok: 6 },
    groups: [],
    ok_counts: { claims: 7, sources: 6 },
  };
  return d;
}

/** 読み手チェック待ちの版（pending_on = reader）: 検証は済んだが読み手係が動いている。見てほしい所 0 件・読み手係の 3 項目は review のまま（§V-6 e: 人は公開できる） */
export function readerWait() {
  const d = clean();
  d.version.id = 'vrdr-0001';
  d.version.version = 6;
  d.version.created_at = '2026-11-06T12:00:00.000Z';
  d.material.title = '赤血球のしごと（読み手チェック待ちの版）';
  d.reader = { status: 'running', gen: 'rd-wait-0001', findings: null, learning: null, conditions: null, summary: null, not_read: null, cost_cents: 0 };
  d.triage = {
    ...d.triage,
    reader_gen: 'rd-wait-0001',
    gate: 'pending',
    pending_on: ['reader'],
    auto: { ...d.triage.auto, explanation_and_expression: 'review', relation_to_learning: 'review', conditions_of_use: 'review' },
    items: d.triage.items.filter((x) => x.kind === 'claim'),
    counts: { fix: 0, ask: 0, note: 2, claims_ok: 7, sources_ok: 6 },
  };
  return d;
}

/**
 * 絵の主張（§O-13-5）のある版: p1 に生成画像 1 枚（絵の主張 3 件・参照つき）。検証係は [1] ok・[2] wrong・[3] unclear（最終の判定は problem）。
 * 4 通りの版とは別に serve.mjs だけが出す（#/review/vfig-0001。撮影 shot=fig-claims）。参照の URL は作り物
 */
export function figureClaims() {
  const d = attention();
  d.version.id = 'vfig-0001';
  d.version.version = 7;
  d.version.created_at = '2026-11-07T09:00:00.000Z';
  d.material.title = '赤血球のしごと（絵の主張のある版）';
  const path = 'parts/p1/p1-rbc.png';
  const shows = [
    { text: '赤血球はまん中がへこんだ円盤で、核が無い', source_ids: ['s1'] },
    { text: '静脈の血も赤い（青くない）', source_ids: ['s1', 's2'] },
    { text: '毛細血管の中を赤血球が 1 列で通る', source_ids: ['s1'] },
  ];
  const ref = 'https://example.org/body/blood/red-cells/photo';
  d.version.material.parts[0].files.push({ path, role: 'figure', image_id: 'img_' + '0'.repeat(32), alt: '血管の中を流れる赤血球', shows, reference_url: ref });
  d.generated_images = [{ path, accuracy: 'scientific', prompt: 'Red blood cells flowing in a capillary, oblique view, soft light', alt: '血管の中を流れる赤血球' }];
  d.figures_meta = { [path]: { shows, reference_url: ref } };
  const checks = [
    { n: 1, result: 'ok', note: '絵も出典も合う' },
    { n: 2, result: 'wrong', note: '絵の奥の静脈が青く塗られている' },
    { n: 3, result: 'unclear', note: '参照のページを開けなかった' },
  ];
  const reason = '絵の主張 [2] が成り立たない: 奥の血管が青い';
  d.verification.figures = [...d.verification.figures.map((f) => ({ ...f, verdict_raw: f.verdict, checks: [] })), { path, verdict: 'problem', verdict_raw: 'ok', reason, checks }];
  const detail = [
    '絵の主張 [2] に問題、[3] は確かめきれない',
    '・[2] 静脈の血も赤い（青くない）: 問題（絵の奥の静脈が青く塗られている）',
    '・[3] 毛細血管の中を赤血球が 1 列で通る: 確かめきれない（参照のページを開けなかった）',
    reason,
  ].join('\n');
  d.triage.items = [{ id: 'figure:' + path, kind: 'figure', key: 'explanation_and_expression', severity: 'fix', cause: 'figure_problem', title: '図に問題がある', detail, path }, ...d.triage.items];
  d.triage.counts = { ...d.triage.counts, fix: d.triage.counts.fix + 1 };
  return d;
}

/** §AJ2: 取り込み済みの作り物の探査車（sha と bytes は実測の GLB。GLB 自体は repo に入れない。serve.mjs は FACTORY_PREVIEW_GLB がある時だけ返す） */
export const ROVER_ID = 'nasa-perseverance-rover';
export const ROVER_SHA = '10db7c03a5e63a5a3b3e7baa6243aa4918ba045fa8ff0a731d0217491adc727f';
export const ROVER_BYTES = 4987176;
export const ROVER_FILE_URL = `/api/library/models3d/files/${ROVER_ID}/${ROVER_SHA}.glb`;
const readCatalog = () => JSON.parse(readFileSync(new URL('../../../models3d/catalog.json', import.meta.url), 'utf8')).models;

/**
 * 立体モデル（§AJ）のある版: p1 に一覧の 3 件（Sketchfab の 1 件・Smithsonian Voyager の 1 件・§AJ2 の取り込み済みの探査車 1 件）。仕分けは 1 件ごとに「人が回して見る」（ask）。
 * 4 通りの版とは別に serve.mjs だけが出す（#/review/vm3d-0001）。見方と出典の並びは作り物だが、埋め込みの url は一覧（factory/models3d/catalog.json）の実物
 */
export function models3d() {
  const d = attention();
  d.version.id = 'vm3d-0001';
  d.version.version = 8;
  d.version.created_at = '2026-11-07T11:00:00.000Z';
  d.material.title = '赤血球のしごと（立体モデルのある版）';
  const catalog = readCatalog();
  const entryOf = (id) => catalog.find((m) => m.id === id);
  const picks = [
    { id: 'd1', catalog_id: 'omnh-allosaurus', source_id: 's9', why: '骨盤と 後ろあしを 回して 見る（作り物の見方）' },
    { id: 'd2', catalog_id: 'si-triceratops', source_id: 's10', why: '頭の 後ろの えりかざりを 横から 見る（作り物の見方）' },
    { id: 'd3', catalog_id: ROVER_ID, source_id: 's11', why: '車輪の 数と 腕の 先の 道具を 回して 見る（作り物の見方）' },
  ];
  d.version.material.parts[0].models3d = picks.map(({ id, catalog_id, why, source_id }) => ({ id, catalog_id, why, source_id }));
  d.models3d_meta = {};
  for (const p of picks) {
    const e = entryOf(p.catalog_id);
    d.sources.push({ source_id: p.source_id, url: e.page_url, title: e.title_ja, accessed_at: '2026-11-07', quoted_excerpt: '', license: e.license.label, is_primary: 0, url_was_fetched: 0, quote_found: 0, check_detail: 'model3d' });
    // §AK-4 4: license は記録の code と url からの名前・attribution は記録の値・license_url / license_code / rights_kind / rights_status（作り物の記録は rightsOfFixture）
    const r = rightsOfFixture(e);
    d.models3d_meta[p.id] = {
      catalog_id: e.id, title: e.title_ja, org: e.org, kind: e.kind, embed_url: e.embed_url, page_url: e.page_url, license: r.label, attribution: r.attribution,
      license_url: r.license_url, license_code: r.code, rights_kind: r.evidence_kind, rights_status: r.status,
    };
    // §AJ2-3: 取り込み済みの download だけ file_url（相対）・bytes
    if (e.id === ROVER_ID) Object.assign(d.models3d_meta[p.id], { file_url: ROVER_FILE_URL, bytes: ROVER_BYTES });
  }
  const items = picks.map((p) => ({ id: 'model3d:' + p.id, kind: 'model3d', key: 'explanation_and_expression', severity: 'ask', cause: 'model3d_human', model3d_id: p.id, catalog_id: p.catalog_id, title: entryOf(p.catalog_id).title_ja, detail: '立体モデル（人が回して見てください）' }));
  d.triage.items = [...items, ...d.triage.items];
  d.triage.counts = { ...d.triage.counts, ask: d.triage.counts.ask + items.length };
  return d;
}

/** §AK: 作り物の権利の記録の名前（licenseLabelOf と同じ。一覧の 3 種類だけ） */
const LABEL_OF = { cc0: 'CC0 1.0', 'cc-by': 'CC BY 4.0', 'nasa-media': 'NASA の利用の決まり' };
const AT = '2026-11-07T12:00:00.000Z';

/**
 * §AK-5: 作り物の rights（GET /api/models3d の 1 件の rights）。探査車 = verified / statement（取り込み済み）・ISS = verified / statement だが取り込みの失敗 import:too_large・
 * Sketchfab = verified / api・Voyager = 人の記録・BodyParts3D = verified / cc-url（埋め込みだけ = download なので出ない）。blocked の id は止めている
 */
export function rightsOfFixture(e, blocked = false) {
  const kind = e.kind === 'sketchfab' ? 'api' : e.kind === 'voyager' ? 'human' : e.id.startsWith('nasa-') ? 'statement' : 'cc-url';
  const code = e.license.code;
  const modes = blocked
    ? { host: false, embed: false }
    : kind === 'human' || kind === 'cc-url' ? { host: false, embed: true } : code === 'nasa-media' ? { host: true, embed: false } : { host: true, embed: true };
  const offered = e.kind === 'download' ? modes.host : modes.embed;
  return {
    code,
    label: LABEL_OF[code] || '不明',
    license_url: e.license.url,
    attribution: e.attribution,
    evidence_kind: kind,
    status: kind === 'human' ? 'human' : 'verified',
    blocked,
    checked_at: kind === 'human' ? e.checked_at : AT,
    last_attempt_at: AT,
    fail_code: null,
    check: kind === 'human' ? 'none' : kind,
    modes,
    record: 'ok',
    reason: blocked ? 'blocked' : offered ? 'ok' : 'license',
    last_fail: null,
    last_import_fail: e.id === 'nasa-iss' ? { at: AT, result: 'import:too_large' } : null,
  };
}

/** §AJ2-2・§AK-5: GET /api/models3d の作り物（一覧の全件。探査車だけ取り込み済み・ISS は未取り込み・BodyParts3D は url 無し）。blocked = 止めている id の集合 */
export function models3dAdmin(blocked = new Set()) {
  return {
    models: readCatalog().map((e) => {
      const base = { id: e.id, title: e.title_ja, org: e.org, kind: e.kind, license: e.license.label, page_url: e.page_url, has_download_url: e.download_url !== null, rights: rightsOfFixture(e, blocked.has(e.id)) };
      if (e.kind !== 'download') return { ...base, state: 'embed' };
      if (e.id === ROVER_ID) return { ...base, state: 'hosted', bytes: ROVER_BYTES, sha256: ROVER_SHA, fetched_at: AT, object_ok: true };
      return { ...base, state: e.download_url !== null ? 'not_hosted' : 'unavailable' };
    }),
  };
}

/** §AK-5: POST /api/rights/models3d/<id>/check の作り物の応答（null = 一覧に無い id） */
export function rightsCheckFixture(id, blocked = false) {
  const e = readCatalog().find((m) => m.id === id);
  if (!e) return null;
  const r = rightsOfFixture(e, blocked);
  if (r.evidence_kind === 'human') return { status: 'human_unchanged', code: r.code, label: r.label, modes: r.modes };
  const out = { status: 'verified', code: r.code, label: r.label, modes: r.modes };
  if (!blocked && e.id === ROVER_ID) out.import = { status: 'unchanged', bytes: ROVER_BYTES };
  if (!blocked && e.id === 'nasa-iss') out.import = { status: 'failed', error: 'too_large' };
  return out;
}

export const ALL = { attention, clean, pending, readerWait, figureClaims, models3d };

/** 一覧（GET /api/review）の行。並びはサーバーと同じ（needs_review の多い順 → 古い順） */
export function listRows() {
  return [attention(), clean(), readerWait(), pending()].map((d) => {
    const auto = d.triage.auto;
    return {
      version_id: d.version.id,
      material_id: d.version.material_id,
      version: d.version.version,
      verification_status: d.version.verification_status,
      created_at: d.version.created_at,
      title: d.material.title,
      gate: d.triage.gate,
      pending_on: d.triage.pending_on,
      fix: d.triage.counts.fix,
      ask: d.triage.counts.ask,
      note: d.triage.counts.note,
      needs_review: d.triage.counts.fix + d.triage.counts.ask,
      auto_ok: Object.keys(auto).filter((k) => auto[k] === 'ok').length,
    };
  });
}
