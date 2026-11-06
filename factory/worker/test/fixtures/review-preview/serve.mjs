// 確認画面の見た目を手元で確かめるための小さなサーバー（本番・wrangler を使わない。作り物のデータだけを返す）。
// 使い方: node test/fixtures/review-preview/serve.mjs [port]  →  http://127.0.0.1:<port>/admin/#/review/vfix-0001
// ?shot=<名前> を付けると driver.js が画面を操作してから document.title を "ready" にする（headless Chrome で撮るため）。
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ADMIN = join(HERE, '../../../public/admin');
const FILES = join(HERE, 'files');
const PORT = Number(process.argv[2] || 8791);
const detail = JSON.parse(readFileSync(join(HERE, 'detail.json'), 'utf8'));
const VID = detail.version.id;
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
    return send(res, 200, html, TYPES['.html'], { 'content-security-policy': CSP });
  }
  if (path === '/__fixture/driver.js') return send(res, 200, readFileSync(join(HERE, 'driver.js')), TYPES['.js']);
  if (path.startsWith('/admin/')) {
    const f = inside(ADMIN, path.slice('/admin/'.length));
    return f ? send(res, 200, readFileSync(f), TYPES[extname(f)] || 'application/octet-stream') : send(res, 404, 'not found', 'text/plain');
  }
  if (path === '/api/status') {
    return json(res, 200, { paused: false, running_jobs: 0, max_concurrent: 2, queued_jobs: 0, today_cents: 120, daily_cap_cents: 3000, agent_configured: true, last_cron_at: '2026-11-06T09:40:00.000Z', scout: {}, meeting: {}, images: null, videos: null });
  }
  if (path === '/api/review') return json(res, 200, { versions: [{ version_id: VID, material_id: detail.version.material_id, version: detail.version.version, verification_status: 'done', created_at: detail.version.created_at, title: detail.material.title, needs_review: detail.triage.needs_review, auto_ok: 0 }] });
  if (path === `/api/review/${VID}`) return json(res, 200, detail);
  if (path.startsWith(`/api/review/${VID}/files/`)) {
    const f = inside(FILES, path.slice(`/api/review/${VID}/files/`.length));
    if (!f) return send(res, 404, 'not found', 'text/plain');
    // 版のファイルは Worker と同じく app.html に sandbox の CSP を付ける
    const extra = extname(f) === '.html' ? { 'content-security-policy': "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:" } : {};
    return send(res, 200, readFileSync(f), TYPES[extname(f)] || 'application/octet-stream', extra);
  }
  if (path.startsWith('/api/')) return json(res, 404, { error: 'not_found' });
  send(res, 404, 'not found', 'text/plain');
}).listen(PORT, '127.0.0.1', () => console.log(`review fixture: http://127.0.0.1:${PORT}/admin/#/review/${VID}`));
