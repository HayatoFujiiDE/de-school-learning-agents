// 確認画面の見た目を手元で確かめるための小さなサーバー（本番・wrangler を使わない。作り物のデータだけを返す）。
// 使い方: node test/review-preview/serve.mjs [port]  →  http://127.0.0.1:<port>/admin/#/review/vfix-0001
// 版は 4 通り（fixtures.mjs）: vfix-0001 見てほしい所がある / vclean-0001 全部通った / vpend-0001 機械の確認中 / vrdr-0001 読み手チェック待ち。
// 一覧（#/review）・判断の数・自動公開のスイッチ・確認済みのチャンネル（#/videos）・立体モデル（#/models3d）も作り物を返す（POST はメモリの中だけ）。
// §AJ2: FACTORY_PREVIEW_GLB=<探査車の .glb のパス> を付けると #/review/vm3d-0001 の d3 が回せる（無ければ「読み込めませんでした」）。
// 上部の状況帯は ?status=alert で異常の作り物（statusFixture）。工場（#/）の /api/floor も作り物（floorFixture。src/routes/floor.ts の形）。
// 倉庫の「生成した画像」（#/library/images。§N-8 C）の /api/images/gallery と /api/images/requests/<id>/file も作り物（小さな png をその場で作る）。
// ?shot=<名前> を付けると driver.js が画面を操作してから document.title を "ready" にする（headless Chrome で撮るため）。
import { createServer } from 'node:http';
import { deflateSync } from 'node:zlib';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL, listRows, models3dAdmin, ROVER_BYTES, ROVER_FILE_URL, ROVER_ID, ROVER_SHA } from './fixtures.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ADMIN = join(HERE, '../../public/admin');
const FILES = join(HERE, 'files');
const PORT = Number(process.argv[2] || 8791);
const DETAILS = Object.fromEntries(Object.values(ALL).map((f) => { const d = f(); return [d.version.id, d]; }));
const VID = 'vfix-0001';
const state = { auto_publish: false, channels: [{ channel_key: 'https://www.youtube.com/@fixture-science', channel_name: '作り物の科学チャンネル', channel_url: 'https://www.youtube.com/@fixture-science', first_version_id: 'vclean-0001', approved_by: 'owner@example.invalid', created_at: '2026-11-05T09:00:00.000Z' }] };
const readBody = (req) => new Promise((resolve) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { try { resolve(b ? JSON.parse(b) : null); } catch { resolve(null); } }); });
// Worker の /admin と同じ CSP（src/index.ts。§AJ2-3 の model-viewer + Draco の分を含む。style の hash は src/index.ts の MODEL_VIEWER_STYLE_HASH）
const CSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'sha256-PXtZZkJMMyc18o/DN1ZEFOJ2qEGq95IQbVaJFMOXOb0='; img-src 'self' data:; connect-src 'self' blob:; worker-src blob:; frame-src 'self' https://www.youtube-nocookie.com https://sketchfab.com https://3d-api.si.edu; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.md': 'text/markdown; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm' };
// §AJ2-3: FACTORY_PREVIEW_GLB=<手元の .glb のパス> がある時だけ、作り物の版の探査車（vm3d-0001 の d3）の配信の url でそのファイルを返す（GLB は repo に入れない）
const PREVIEW_GLB = process.env.FACTORY_PREVIEW_GLB || '';

// 上部の状況帯（/api/status）の作り物は 2 通り: normal（通常）/ alert（停止中・今日の上限超え・定期処理 48 分前・収集の失敗と月の上限 85%・画像の停止・予備の鍵）。
// 選び方: ページの url の ?status=alert（fetch の Referer から読む）か、環境変数 FACTORY_PREVIEW_STATUS=alert。時刻は応答のたびに今から作る。
function statusVariant(req) {
  try {
    const v = new URL(req.headers.referer || '', 'http://127.0.0.1').searchParams.get('status');
    if (v === 'alert' || v === 'normal') return v;
  } catch { /* Referer が無い・読めない */ }
  return process.env.FACTORY_PREVIEW_STATUS === 'alert' ? 'alert' : 'normal';
}
function statusFixture(variant) {
  const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();
  const base = {
    paused: false, paused_note: null, running_jobs: 1, max_concurrent: 2, queued_jobs: 3, today_cents: 9555, daily_cap_cents: 20000, agent_configured: true, last_cron_at: ago(3),
    scout: { last_run_at: ago(300), last_status: 'done', last_error: null, month_cents: 0, month_cap_cents: 2000, running: false, x_search_configured: false },
    meeting: { last_at: ago(1500), last_status: 'ended', last_error: null, month_cents: 0, month_cap_cents: 1000, pending_batch: false },
    images: { halted: null, month_cents: 170, month_cap_cents: 10000, holds_open: 0, dispatched: 0, backup_configured: true, backup_last_used_at: null },
    videos: { enabled: true, configured: true, month_cents: 40, month_cap_cents: 1000, u_cents: 10, model: 'fixture' },
    // お題のストック（src/routes/topics.ts の topicStatusSummary の形）
    topics: { enabled: true, last_run: null, failed_24h: 0, needs_review: { heavy: 1, source: 2, other: 0 }, month_cents: 312, month_cap_cents: 3000, today: { empty: 0, stopped: 1 }, tomorrow: { empty: 2, stopped: 0 }, over_reserve: 0 },
  };
  if (variant !== 'alert') return base;
  return {
    ...base, paused: true, paused_note: '費用の確認のため止めています', today_cents: 21040, last_cron_at: ago(48),
    scout: { ...base.scout, last_status: 'failed', month_cents: 1700 },
    images: { ...base.images, halted: 'manual', month_cents: 8400, backup_last_used_at: ago(60 * 26) },
    topics: { ...base.topics, failed_24h: 1, last_run: { status: 'done', updated_at: ago(30) } },
  };
}

// 倉庫の「生成した画像」の作り物: 30 枚（24 枚 + もっと見る で 6 枚）。新しい順。教材の無い行・説明の文の無い行・長い説明の行も混ぜる
const GALLERY_TITLES = ['赤血球のしごと', '月の満ち欠け', '火山のしくみ', null, '季節と太陽の高さ'];
const GALLERY_ALTS = ['赤血球が血管の中を流れる様子の図', '月の形が 8 つ並んだ図（新月から満月まで）', null, '火山の断面図。マグマだまりから火口までの道すじ', '太陽の高さが季節で変わることを示す図。夏至・春分・冬至の 3 本の線と、それぞれの日の正午の影の長さを並べています'];
const galleryId = (n) => 'img_' + n.toString(16).padStart(32, '0');
const GALLERY = Array.from({ length: 30 }, (_, i) => {
  const k = i % 5;
  return { request_id: galleryId(30 - i), job_id: 'job-g' + k, material_id: GALLERY_TITLES[k] ? 'fx-g' + k : null, material_title: GALLERY_TITLES[k], created_at: new Date(Date.parse('2026-11-07T09:00:00.000Z') - i * 47 * 60_000).toISOString(), model: 'gpt-image-2.5-flare', size: '1024x1024', alt: GALLERY_ALTS[k] };
});
function galleryFixture(url) {
  const limit = Math.min(48, Math.max(1, Math.floor(Number(url.searchParams.get('limit') || 24))));
  const before = url.searchParams.get('before'), beforeId = url.searchParams.get('before_id');
  const rest = before ? GALLERY.filter((x) => x.created_at < before || (x.created_at === before && x.request_id < beforeId)) : GALLERY;
  const page = rest.slice(0, limit), last = page[page.length - 1];
  return { items: page, next: rest.length > limit ? { before: last.created_at, before_id: last.request_id } : null };
}
// 小さな png（96 × 96。斜めの縞と円）を色ごとに作る（外のファイル・依存を足さない）
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function fixturePng(seed) {
  const W = 96, H = 96, hue = [[231, 112, 85], [86, 140, 200], [240, 180, 70], [90, 160, 120], [150, 110, 190]][seed % 5];
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 3 + 1)] = 0;
    for (let x = 0; x < W; x++) {
      const inCircle = (x - 48) ** 2 + (y - 48) ** 2 < (20 + (seed % 3) * 6) ** 2;
      const stripe = ((x + y + seed * 7) >> 3) % 2 === 0;
      const f = inCircle ? 0.55 : stripe ? 1 : 0.85;
      const o = y * (W * 3 + 1) + 1 + x * 3;
      raw[o] = Math.round(hue[0] * f + (1 - f) * 255 * 0.3); raw[o + 1] = Math.round(hue[1] * f + (1 - f) * 255 * 0.3); raw[o + 2] = Math.round(hue[2] * f + (1 - f) * 255 * 0.3);
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}

// 工場（GET /api/floor）の作り物。src/routes/floor.ts の応答の形（stations 8 キー + queue）。行は 回答待ち・確認待ち・制作中・検証中・利用できる の 5 本
const STEP_LABEL = { order: '注文', questions: '質問', making: '制作', ingest: '取り込み', verify: '検証', review: '確認', publish: '公開' };
const STEP_KEYS = Object.keys(STEP_LABEL);
const steps = (states) => states.split(',').map((state, i) => ({ key: STEP_KEYS[i], label: STEP_LABEL[STEP_KEYS[i]], state, detail: null }));
function floorRow(id, title, kinds, states, pct, o = {}) {
  return {
    material: { id, slug: id, title, kinds, work_status: o.work || 'making', publish_status: o.publish || 'none', updated_at: new Date().toISOString() },
    job: o.job === undefined ? { id: 'job-' + id, status: 'running', phase: 'making', kind: 'draft', error: null, last_error: null, auto_rework: false, parent_version: null } : o.job,
    version: o.version || null,
    steps: steps(states),
    progress_pct: pct,
    attention: o.attention || null,
  };
}
function floorFixture() {
  const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();
  return {
    now: new Date().toISOString(),
    paused: false,
    paused_note: null,
    cost: { today_cents: 9555, daily_cap_cents: 20000 },
    attention: { answer: 1, review: 1, failed: 0, budget: 0 },
    stations: {
      intake: { proposed: 4, scout_running: false, meeting_pending: false, last_scout_at: ago(300), last_meeting_at: ago(1500) },
      maker: { queued: 1, creating: 0, running: 1, needs_answer: 1, budget_reached: 0, max_concurrent: 2 },
      clerk: { ingesting: 0, failed_invalid_outputs: 0 },
      verifier: { pending: 0, running: 1, failed: 0 },
      reviewer: { waiting: 1, needs_review_total: 3 },
      library: { available: 12, stopped: 1 },
      rework: { auto_active: 0, manual_active: 0 },
      retro: { pending: 0, last_retro_at: ago(600), last_tips_activated: 1, active_maker_notes: 2 },
    },
    queue: [
      floorRow('fx-redstone', 'レッドストーン回路のきほん', [3, 4], 'done,waiting,pending,pending,pending,pending,pending', 14, { attention: 'answer', job: { id: 'job-fx-redstone', status: 'needs_answer', phase: 'questions', kind: 'draft', error: null, last_error: null, auto_rework: false, parent_version: null } }),
      floorRow('fx-blood', '赤血球のしごと', [3], 'done,done,done,done,done,waiting,pending', 86, { work: 'review', attention: 'review', job: null, version: { id: VID, version: 3, status: 'review', verification_status: 'done', verify_phase: null, verify_turn: 0, needs_review: 3, auto_ok: 3 } }),
      floorRow('fx-moon', '月の満ち欠け', [3, 4], 'done,skipped,active,pending,pending,pending,pending', 42),
      floorRow('fx-volcano', '火山のしくみ', [3], 'done,done,done,done,active,pending,pending', 77, { work: 'review', job: null, version: { id: 'vfx-volcano', version: 2, status: 'review', verification_status: 'running', verify_phase: 'collecting', verify_turn: 2, needs_review: null, auto_ok: null } }),
      floorRow('fx-seasons', '季節と太陽の高さ', [3], 'done,done,done,done,done,done,done', 100, { work: 'idle', publish: 'available', job: null, version: { id: 'vfx-seasons', version: 1, status: 'current', verification_status: 'done', verify_phase: null, verify_turn: 0, needs_review: null, auto_ok: null } }),
    ],
  };
}

/** base の下のファイルだけを返す（.. で外へ出ない） */
function inside(base, rel) {
  const p = normalize(join(base, rel));
  return p.startsWith(base + '/') && existsSync(p) && statSync(p).isFile() ? p : null;
}
function send(res, status, body, type, extra = {}) {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...extra });
  res.end(body);
}
const json = (res, status, obj) => send(res, status, JSON.stringify(obj), 'application/json');

createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const path = decodeURIComponent(url.pathname);
  if (path === '/admin' || path === '/admin/' || path === '/admin/index.html') {
    const html = readFileSync(join(ADMIN, 'index.html'), 'utf8').replace('</body>', '  <script src="/__fixture/driver.js"></script>\n</body>');
    // ?frame=1: 幅 390 の確かめで、下の /__fixture/narrow の iframe の中に入れて撮る（headless Chrome の窓は 500px より狭くできないため）
    return send(res, 200, html, TYPES['.html'], { 'content-security-policy': url.searchParams.get('frame') === '1' ? CSP.replace("frame-ancestors 'none'", "frame-ancestors 'self'") : CSP });
  }
  if (path === '/__fixture/narrow') {
    const w = Math.min(Math.max(Number(url.searchParams.get('w')) || 390, 320), 1440);
    const h = Math.min(Math.max(Number(url.searchParams.get('h')) || 2400, 400), 6000);
    const src = '/admin/?frame=1&shot=' + encodeURIComponent(url.searchParams.get('shot') || 'top') + '#' + (url.searchParams.get('hash') || '/review/' + VID).replace(/[^\w\/-]/g, '');
    return send(res, 200, `<!doctype html><meta charset="utf-8"><title>narrow</title><body style="margin:0;background:#888"><iframe src="${src}" style="display:block;border:0;width:${w}px;height:${h}px;background:#fff"></iframe>`, TYPES['.html']);
  }
  if (path === '/__fixture/driver.js') return send(res, 200, readFileSync(join(HERE, 'driver.js')), TYPES['.js']);
  if (path.startsWith('/admin/')) {
    const f = inside(ADMIN, path.slice('/admin/'.length));
    return f ? send(res, 200, readFileSync(f), TYPES[extname(f)] || 'application/octet-stream') : send(res, 404, 'not found', 'text/plain');
  }
  if (path === '/api/status') return json(res, 200, statusFixture(statusVariant(req)));
  if (path === '/api/floor') return json(res, 200, floorFixture());
  if (path === '/api/review') return json(res, 200, { versions: listRows() });
  if (path === '/api/images/gallery') return json(res, 200, galleryFixture(url));
  const gf = /^\/api\/images\/requests\/(img_[0-9a-f]{32})\/file$/.exec(path);
  if (gf) {
    const n = parseInt(gf[1].slice(4), 16);
    // 5 枚に 1 枚は確認画面の作り物の赤血球の png（本物に近い絵）、ほかはその場で作る
    const body = n % 5 === 0 ? readFileSync(join(FILES, 'parts/p1/p1-rbc.png')) : fixturePng(n);
    return send(res, 200, body, 'image/png', { 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox" });
  }
  if (path === '/api/review/stats') return json(res, 200, { auto_publish: state.auto_publish, clean: { approve: 12, return: 1, reject: 0 }, streak: 9, auto_published: state.auto_publish ? 3 : 0 });
  if (path === '/api/review/auto-publish' && req.method === 'POST') return readBody(req).then((b) => { state.auto_publish = !!(b && b.on); json(res, 200, { auto_publish: state.auto_publish }); });
  if (path === '/api/channels' && req.method === 'DELETE') {
    const key = url.searchParams.get('key');
    const before = state.channels.length;
    state.channels = state.channels.filter((c) => c.channel_key !== key);
    return json(res, 200, { deleted: state.channels.length < before });
  }
  if (path === '/api/channels') return json(res, 200, { channels: state.channels });
  // §AJ2: 立体モデルのページ（#/models3d）と取り込んだ GLB の配信の作り物。POST はメモリにも書かない（探査車は unchanged・ISS は too_large）
  if (path === '/api/models3d' && req.method === 'GET') return json(res, 200, models3dAdmin());
  const mf = /^\/api\/models3d\/([a-z0-9-]{3,40})\/fetch$/.exec(path);
  if (mf && req.method === 'POST') {
    if (mf[1] === ROVER_ID) return json(res, 200, { status: 'unchanged', catalog_id: ROVER_ID, sha256: ROVER_SHA, bytes: ROVER_BYTES });
    if (mf[1] === 'nasa-iss') return json(res, 413, { error: 'too_large' });
    return json(res, 400, { error: 'not_download' });
  }
  if (path === ROVER_FILE_URL) {
    if (!PREVIEW_GLB || !existsSync(PREVIEW_GLB) || !statSync(PREVIEW_GLB).isFile()) return json(res, 404, { error: 'not_found' });
    const glb = readFileSync(PREVIEW_GLB);
    return send(res, 200, glb, 'model/gltf-binary', { 'content-length': String(glb.byteLength), 'x-content-type-options': 'nosniff', 'access-control-allow-origin': '*' });
  }
  if (path === '/api/videos/status') return json(res, 200, { enabled: true, configured: true, month_cents: 40, month_cap_cents: 1000, u_cents: 10, model: 'fixture' });
  const m = /^\/api\/review\/([\w-]+)(\/.*)?$/.exec(path);
  const d = m && DETAILS[m[1]];
  if (d && !m[2]) return json(res, 200, d);
  if (d && (m[2] === '/decision' || m[2] === '/reread' || m[2] === '/reverify') && req.method === 'POST') return json(res, 200, {});
  if (d && m[2] && m[2].startsWith('/files/')) {
    const f = inside(FILES, m[2].slice('/files/'.length));
    if (!f) return send(res, 404, 'not found', 'text/plain');
    // 版のファイルは Worker と同じく app.html に sandbox の CSP を付ける
    const extra = extname(f) === '.html' ? { 'content-security-policy': "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:" } : {};
    return send(res, 200, readFileSync(f), TYPES[extname(f)] || 'application/octet-stream', extra);
  }
  if (path.startsWith('/api/')) return json(res, 404, { error: 'not_found' });
  send(res, 404, 'not found', 'text/plain');
}).listen(PORT, '127.0.0.1', () => console.log(`review fixture: http://127.0.0.1:${PORT}/admin/#/review/${VID}`));
