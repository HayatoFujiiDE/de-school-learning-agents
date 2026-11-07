// 確認画面の見た目を手元で確かめるための小さなサーバー（本番・wrangler を使わない。作り物のデータだけを返す）。
// 使い方: node test/review-preview/serve.mjs [port]  →  http://127.0.0.1:<port>/admin/#/review/vfix-0001
// 版は 4 通り（fixtures.mjs）: vfix-0001 見てほしい所がある / vclean-0001 全部通った / vpend-0001 機械の確認中 / vrdr-0001 読み手チェック待ち。
// 一覧（#/review）・判断の数・自動公開のスイッチ・確認済みのチャンネル（#/videos）も作り物を返す（POST はメモリの中だけ）。
// ?shot=<名前> を付けると driver.js が画面を操作してから document.title を "ready" にする（headless Chrome で撮るため）。
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL, listRows } from './fixtures.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ADMIN = join(HERE, '../../public/admin');
const FILES = join(HERE, 'files');
const PORT = Number(process.argv[2] || 8791);
const DETAILS = Object.fromEntries(Object.values(ALL).map((f) => { const d = f(); return [d.version.id, d]; }));
const VID = 'vfix-0001';
const state = { auto_publish: false, channels: [{ channel_key: 'https://www.youtube.com/@fixture-science', channel_name: '作り物の科学チャンネル', channel_url: 'https://www.youtube.com/@fixture-science', first_version_id: 'vclean-0001', approved_by: 'owner@example.invalid', created_at: '2026-11-05T09:00:00.000Z' }] };
const readBody = (req) => new Promise((resolve) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { try { resolve(b ? JSON.parse(b) : null); } catch { resolve(null); } }); });
// Worker の /admin と同じ CSP（src/index.ts）
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src 'self' https://www.youtube-nocookie.com; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.md': 'text/markdown; charset=utf-8', '.json': 'application/json' };

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
  if (path === '/api/status') {
    return json(res, 200, { paused: false, running_jobs: 0, max_concurrent: 2, queued_jobs: 0, today_cents: 120, daily_cap_cents: 3000, agent_configured: true, last_cron_at: '2026-11-06T09:40:00.000Z', scout: {}, meeting: {}, images: null, videos: null });
  }
  if (path === '/api/review') return json(res, 200, { versions: listRows() });
  if (path === '/api/review/stats') return json(res, 200, { auto_publish: state.auto_publish, clean: { approve: 12, return: 1, reject: 0 }, streak: 9, auto_published: state.auto_publish ? 3 : 0 });
  if (path === '/api/review/auto-publish' && req.method === 'POST') return readBody(req).then((b) => { state.auto_publish = !!(b && b.on); json(res, 200, { auto_publish: state.auto_publish }); });
  if (path === '/api/channels' && req.method === 'DELETE') {
    const key = url.searchParams.get('key');
    const before = state.channels.length;
    state.channels = state.channels.filter((c) => c.channel_key !== key);
    return json(res, 200, { deleted: state.channels.length < before });
  }
  if (path === '/api/channels') return json(res, 200, { channels: state.channels });
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
