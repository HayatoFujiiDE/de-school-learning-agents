#!/usr/bin/env node
// 実サイト app/ の開発・検証サーバー（contract-LS §LS-6）。Node 組込みだけ。127.0.0.1 だけで待つ。
// node tools/live-serve.mjs [--port 4180] [--integ <dir>] [--fake-buddy] [--factory-proxy]
//   /app/*   → <worktree>/app        /tools/* → <worktree>/tools        / → 302 /app/index.html#talk
//   --integ  → /app-live/* と /basic-learning/* をその dir から配信（読むだけ。無ければ 404）
//   --fake-buddy → /api/buddy/status と POST /api/buddy にテスト用の返事（実 Claude は呼ばない・key を読まない）。
//                  POST /__fake/mode {mode:'ok'|'503'|'429'|'timeout'|'invalid'|'notconfigured'} で以後の応答を切り替える
//   --factory-proxy → GET /api/library/* を工場（DES.factory.base と同じ host）へ同一 origin で中継する（読むだけ・2MB 上限。工場の CORS が付くまでの検証用。LS-18-26）
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Codex の worktree（.worktrees/basic-learning-integration）。この worktree が .worktrees の中ならその隣
const INTEG_DEFAULT = path.basename(path.dirname(ROOT)) === '.worktrees'
  ? path.join(path.dirname(ROOT), 'basic-learning-integration')
  : path.join(ROOT, '.worktrees', 'basic-learning-integration');
const types = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.mp3':'audio/mpeg','.mp4':'video/mp4','.vtt':'text/vtt; charset=utf-8','.pdf':'application/pdf','.txt':'text/plain; charset=utf-8' };
const MODES = ['ok', '503', '429', 'timeout', 'invalid', 'notconfigured'];
const FACTORY = 'https://de-school-factory.h-fujii.workers.dev';
const PROXY_MAX = 2 * 1024 * 1024;
// 工場の配信 API の読み取り中継（GET だけ。query はそのまま。応答は content-type と status を写す）
async function proxyFactory(req, res) {
  if (req.method !== 'GET') { res.writeHead(405, { Allow: 'GET' }).end(); return; }
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), 10000);
  try {
    const up = await fetch(FACTORY + req.url, { signal: ac.signal, redirect: 'error', headers: { accept: req.headers.accept || '*/*' } });
    const buf = Buffer.from(await up.arrayBuffer());
    if (buf.length > PROXY_MAX) { send(res, 502, 'Upstream too large'); return; }
    res.writeHead(up.status, { 'Content-Type': up.headers.get('content-type') || 'application/octet-stream', 'Content-Length': buf.length });
    res.end(buf);
  } catch { send(res, 502, 'Upstream unavailable'); }
  finally { clearTimeout(t); }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function parseArgs(argv) {
  const o = { port: 4180, integ: INTEG_DEFAULT, fake: false, factoryProxy: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') o.port = Number(argv[++i]);
    else if (a === '--integ') o.integ = path.resolve(String(argv[++i] || ''));
    else if (a === '--fake-buddy') o.fake = true;
    else if (a === '--factory-proxy') o.factoryProxy = true;
    else throw new Error('Usage: node tools/live-serve.mjs [--port 4180] [--integ <dir>] [--fake-buddy] [--factory-proxy]');
  }
  if (!Number.isInteger(o.port) || o.port < 1 || o.port > 65535) throw new Error('--port は 1〜65535');
  return o;
}

function send(res, status, body, type) {
  res.writeHead(status, { 'Content-Type': type || 'text/plain; charset=utf-8' });
  res.end(body);
}
function json(res, status, value) { send(res, status, JSON.stringify(value), types['.json']); }

// URL の path を root 配下の実ファイルへ。.. と encode された . は拒否（null）、実パスが root の外なら拒否
function resolveFile(root, rel) {
  let base;
  try { base = fs.realpathSync(root); } catch { return undefined; }
  if (!rel || rel.endsWith('/')) rel += 'index.html';
  const file = path.join(base, rel);
  let real;
  try { real = fs.realpathSync(file); } catch { return undefined; }
  if (real !== base && !real.startsWith(base + path.sep)) return null;
  try { if (!fs.statSync(real).isFile()) return undefined; } catch { return undefined; }
  return real;
}
function serveFile(req, res, root, rel) {
  const file = resolveFile(root, rel);
  if (file === null) { send(res, 403, 'Forbidden'); return; }
  if (!file) { send(res, 404, 'Not found'); return; }
  const size = fs.statSync(file).size;
  res.writeHead(200, { 'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': size });
  if (req.method === 'HEAD' || !size) { res.end(); return; }
  fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > limit) { reject(Object.assign(new Error('large'), { large: true })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// ---------- テスト用のバディ（plan-buddy-live.md の HTTP 契約の形だけ真似る） ----------
const toMin = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const toTime = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
// 同じ日の予定と重ならない最初の 30 分（10:00 から 15 分刻み）。excludeId の予定は無視する
function firstFree(schedule, date, excludeId, skipStart) {
  const busy = schedule.filter(e => e && e.date === date && e.id !== excludeId);
  for (let m = 10 * 60; m + 30 <= 24 * 60 - 1; m += 15) {
    const start = toTime(m), end = toTime(m + 30);
    if (start === skipStart) continue;
    if (!busy.some(e => e.start < end && start < e.end)) return { start, end };
  }
  return null;
}
function validRequest(v) {
  return v && typeof v === 'object' && typeof v.requestId === 'string' && UUID.test(v.requestId) && typeof v.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.date) &&
    Array.isArray(v.messages) && v.messages.length > 0 && v.messages.every(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string') &&
    v.messages[v.messages.length - 1].role === 'user' && Array.isArray(v.schedule);
}
function fakeReply(body) {
  const text = body.messages[body.messages.length - 1].content, schedule = body.schedule, proposals = [];
  if (['入れ', 'やりたい', '予定'].some(w => text.includes(w))) {
    const slot = firstFree(schedule, body.date, null, null);
    if (slot) proposals.push({ id: randomUUID(), op: 'add', targetId: null, title: 'テスト用の予定', date: body.date, start: slot.start, end: slot.end, original: null });
  }
  const first = schedule[0];
  if (first && text.includes('変え')) {
    const slot = firstFree(schedule, first.date, first.id, first.start) || { start: first.start, end: first.end };
    proposals.push({ id: randomUUID(), op: 'update', targetId: first.id, title: first.title, date: first.date, start: slot.start, end: slot.end, original: first });
  }
  if (first && text.includes('外し')) {
    proposals.push({ id: randomUUID(), op: 'remove', targetId: first.id, title: first.title, date: first.date, start: first.start, end: first.end, original: first });
  }
  const list = proposals.slice(0, 3);
  const reply = '（テスト用の返事）' + (list.length ? '候補を ' + list.length + ' つ出したよ。入れるかどうかは、内容を見て選んでね' : '聞いたよ');
  return { requestId: body.requestId, reply, proposals: list };
}

function createServer(opt) {
  let mode = 'ok';
  const status = () => mode === 'notconfigured' ? { configured: false, available: false, remaining: 100 }
    : mode === '429' ? { configured: true, available: false, remaining: 0 }
    : { configured: true, available: true, remaining: 100 };
  async function api(req, res, name) {
    if (name === '/api/buddy/status') {
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }).end(); return; }
      json(res, 200, status()); return;
    }
    if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }).end(); return; }
    let raw;
    try { raw = await readBody(req, 32768); }
    catch (e) { if (e.large) json(res, 413, { error: 'PAYLOAD_TOO_LARGE', message: '送る内容が大きすぎます。' }); else res.destroy(); return; }
    if (name === '/__fake/mode') {
      let v = null;
      try { v = JSON.parse(raw); } catch {}
      if (!v || !MODES.includes(v.mode)) { json(res, 400, { error: 'INVALID_MODE', message: 'mode は ' + MODES.join(' / ') }); return; }
      mode = v.mode; json(res, 200, { mode }); return;
    }
    if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) { json(res, 415, { error: 'UNSUPPORTED_MEDIA_TYPE', message: '送信形式を確認できませんでした。' }); return; }
    let body = null;
    try { body = JSON.parse(raw); } catch {}
    if (!validRequest(body)) { json(res, 400, { error: 'INVALID_REQUEST', message: '送る内容を確認できませんでした。' }); return; }
    if (mode === 'notconfigured') { json(res, 503, { error: 'NOT_CONFIGURED', message: 'バディは準備中です。' }); return; }
    if (mode === '429') { json(res, 429, { error: 'LIMIT_REACHED', message: '試用の利用回数に達しました。' }); return; }
    if (mode === '503') { json(res, 503, { error: 'BUDGET_UNAVAILABLE', message: '今はバディに接続できません。' }); return; }
    if (mode === 'invalid') { json(res, 200, { requestId: body.requestId, reply: '', proposals: 'x' }); return; }
    if (mode === 'timeout') {
      // 画面側は 50 秒で打ち切る。こちらは 60 秒後に 504 を返して接続を閉じる
      const timer = setTimeout(() => { if (!res.writableEnded) json(res, 504, { error: 'TIMEOUT', message: '返事を待つ時間が過ぎました。' }); }, 60000);
      res.on('close', () => clearTimeout(timer));
      return;
    }
    json(res, 200, fakeReply(body));
  }
  return http.createServer(async (req, res) => {
    try {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('X-Robots-Tag', 'noindex');
      res.setHeader('Cache-Control', 'no-cache');
      const rawPath = String(req.url || '').split('?')[0].split('#')[0];
      // パストラバーサル: 生の path に .. / encode された . / \ / NUL があれば拒否（URL の正規化より先に見る）
      if (rawPath.includes('..') || /%2e/i.test(rawPath) || /%5c|\\|%00/i.test(rawPath)) { send(res, 400, 'Bad request'); return; }
      let name;
      try { name = decodeURIComponent(rawPath); } catch { send(res, 400, 'Bad request'); return; }
      if (name === '/') { res.writeHead(302, { Location: '/app/index.html#talk' }).end(); return; }
      if (opt.fake && (name === '/api/buddy' || name === '/api/buddy/status' || name === '/__fake/mode')) { await api(req, res, name); return; }
      if (opt.factoryProxy && name.startsWith('/api/library/')) { await proxyFactory(req, res); return; }
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }).end(); return; }
      const mounts = [['/app/', path.join(ROOT, 'app')], ['/tools/', path.join(ROOT, 'tools')], ['/app-live/', path.join(opt.integ, 'app-live')], ['/basic-learning/', path.join(opt.integ, 'basic-learning')]];
      for (const [prefix, root] of mounts) {
        if (name.startsWith(prefix)) { serveFile(req, res, root, name.slice(prefix.length)); return; }
      }
      send(res, 404, 'Not found');
    } catch {
      if (res.headersSent) res.destroy();
      else send(res, 500, 'Server error');
    }
  });
}

const opt = parseArgs(process.argv.slice(2));
const server = createServer(opt);
server.on('error', error => { console.error('LIVE_SERVE=FAIL code=' + (error.code || 'UNKNOWN')); process.exitCode = 1; });
server.listen(opt.port, '127.0.0.1', () => {
  const integ = fs.existsSync(path.join(opt.integ, 'app-live', 'state.mjs')) ? 'found' : 'missing';
  console.log('LIVE_SERVE=http://127.0.0.1:' + opt.port + '/app/index.html#talk integ=' + integ + ' fake_buddy=' + (opt.fake ? 'on' : 'off') + ' factory_proxy=' + (opt.factoryProxy ? 'on' : 'off'));
});
