#!/usr/bin/env bash
# factory/claude/ の rubric・編集基準・allowlist を src/generated/claude-assets.ts に文字列として書き出す（契約 §A）。
# 実行時に fetch で取りに行かないため、dev / deploy / typecheck の前に必ず走らせる。
# factory/scout/sources.json は src/generated/scout-sources.ts に書き出す（収集部隊の情報源。契約 §K-1。不正なら止まる）。
# factory/topics/sources.json は src/generated/topic-sources.ts に書き出す（お題の RSS。contract-T T-13。不正なら止まる）。
# あわせて fake 用 fixture（test/fixtures/）を src/fake/fixtures.generated.ts に書き出す（fake は src/anthropic.ts のガード内からだけ読み込まれる）。
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
node - "$HERE" <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const claude = path.resolve(root, '../claude');
const read = (p) => fs.readFileSync(path.join(claude, p), 'utf8');
const rubricsDir = path.join(claude, 'rubrics');
const kinds = {};
for (const f of fs.readdirSync(rubricsDir).sort()) {
  const m = /^kind-(\d+)\.md$/.exec(f);
  if (m) kinds[Number(m[1])] = fs.readFileSync(path.join(rubricsDir, f), 'utf8');
}
const allowlist = JSON.parse(read('allowlist.json'));
// §O-13-0: primary_hosts（一次とみなす発行主体）は domains の部分集合。外れていれば止まる
const primaryHosts = Array.isArray(allowlist.primary_hosts) ? allowlist.primary_hosts : [];
for (const h of primaryHosts) {
  if (typeof h !== 'string' || !allowlist.domains.includes(h)) { console.error(`allowlist: primary_hosts の ${h} が domains にない`); process.exit(1); }
}
const out = [
  '// 生成ファイル。手で編集しない（scripts/sync-claude-assets.sh が factory/claude/ から生成する）',
  `export const EDITORIAL_STANDARDS: string = ${JSON.stringify(read('editorial-standards.md'))};`,
  `export const RUBRIC_COMMON: string = ${JSON.stringify(read('rubrics/common.md'))};`,
  `export const RUBRIC_KINDS: Record<number, string> = ${JSON.stringify(kinds)};`,
  `export const ALLOWLIST: { domains: string[]; primary_hosts: string[]; hosts: string[] } = ${JSON.stringify({ domains: allowlist.domains, primary_hosts: primaryHosts, hosts: allowlist.hosts })};`,
  '',
].join('\n');
fs.mkdirSync(path.join(root, 'src/generated'), { recursive: true });
fs.writeFileSync(path.join(root, 'src/generated/claude-assets.ts'), out);

// 収集部隊の情報源（§K-1）。RSS/Atom は https で 10 件まで、X の handle は 20 件まで（@ なし）
const scoutPath = path.resolve(root, '../scout/sources.json');
const scout = JSON.parse(fs.readFileSync(scoutPath, 'utf8'));
const feeds = (scout.feeds ?? []).map((f) => f && f.url);
const handles = (scout.x_handles ?? []).map((h) => h && h.handle);
const bad = (msg) => { console.error(`scout sources: ${msg}`); process.exit(1); };
if (feeds.length > 10) bad('feeds は 10 件まで');
if (handles.length > 20) bad('x_handles は 20 件まで');
for (const u of feeds) { if (typeof u !== 'string' || !/^https:\/\/[^\s]+$/.test(u) || u.length > 500) bad('feeds[].url は https の URL'); }
for (const h of handles) { if (typeof h !== 'string' || !/^[A-Za-z0-9_]{1,15}$/.test(h)) bad('x_handles[].handle は @ なしの英数字と _（15 文字まで）'); }
fs.writeFileSync(
  path.join(root, 'src/generated/scout-sources.ts'),
  '// 生成ファイル。手で編集しない（scripts/sync-claude-assets.sh が factory/scout/sources.json から生成する）\n' +
    `export const SCOUT_FEEDS: string[] = ${JSON.stringify(feeds)};\n` +
    `export const SCOUT_X_HANDLES: string[] = ${JSON.stringify(handles)};\n`,
);

// お題の RSS（contract-T T-13）。https の URL で 8 件まで。違反なら止まる
const topicsPath = path.resolve(root, '../topics/sources.json');
const topicsSrc = JSON.parse(fs.readFileSync(topicsPath, 'utf8'));
const topicFeeds = (topicsSrc.feeds ?? []).map((f) => f && f.url);
if (topicFeeds.length > 8) { console.error('topic sources: feeds は 8 件まで'); process.exit(1); }
for (const u of topicFeeds) { if (typeof u !== 'string' || !/^https:\/\/[^\s]+$/.test(u) || u.length > 500) { console.error('topic sources: feeds[].url は https の URL'); process.exit(1); } }
fs.writeFileSync(
  path.join(root, 'src/generated/topic-sources.ts'),
  '// 生成ファイル。手で編集しない（scripts/sync-claude-assets.sh が factory/topics/sources.json から生成する）\n' +
    `export const TOPIC_FEEDS: string[] = ${JSON.stringify(topicFeeds)};\n`,
);

// 立体モデルの一覧（factory/models3d/catalog.json）。人が確かめたものだけ。形が崩れていれば止まる（README の決まり）
const models3dPath = path.resolve(root, '../models3d/catalog.json');
const models3dSrc = JSON.parse(fs.readFileSync(models3dPath, 'utf8'));
const m3bad = (msg) => { console.error(`models3d catalog: ${msg}`); process.exit(1); };
const m3models = Array.isArray(models3dSrc.models) ? models3dSrc.models : m3bad('models は配列');
if (m3models.length > 200) m3bad('models は 200 件まで');
const m3ids = new Set();
const m3str = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max && v === v.trim();
const m3https = (v) => typeof v === 'string' && /^https:\/\/[^\s]+$/.test(v) && v.length <= 500;
for (const m of m3models) {
  if (!m || typeof m !== 'object') m3bad('models[] はオブジェクト');
  if (!/^[a-z0-9-]{3,40}$/.test(String(m.id))) m3bad(`id の形: ${m.id}`);
  if (m3ids.has(m.id)) m3bad(`id が重複: ${m.id}`);
  m3ids.add(m.id);
  if (!m3str(m.title_ja, 80) || !m3str(m.title_src, 120) || !m3str(m.org, 80) || !m3str(m.attribution, 200)) m3bad(`${m.id}: title_ja / title_src / org / attribution は 1 文字以上の文字列（前後の空白なし）`);
  if (!m3https(m.page_url)) m3bad(`${m.id}: page_url は https の URL`);
  if (m.kind === 'sketchfab') {
    if (!/^https:\/\/sketchfab\.com\/models\/[0-9a-f]{32}\/embed$/.test(String(m.embed_url))) m3bad(`${m.id}: sketchfab の embed_url の形`);
    if (!m.page_url.endsWith(m.embed_url.slice('https://sketchfab.com/models/'.length, -'/embed'.length))) m3bad(`${m.id}: page_url の uid が embed_url と違う`);
  } else if (m.kind === 'voyager') {
    if (!/^https:\/\/3d-api\.si\.edu\/voyager\/3d_package:[0-9a-f-]{36}$/.test(String(m.embed_url))) m3bad(`${m.id}: voyager の embed_url の形`);
    if (!m.page_url.endsWith(m.embed_url.slice(m.embed_url.lastIndexOf(':') + 1))) m3bad(`${m.id}: page_url の id が embed_url と違う`);
  } else if (m.kind === 'download') {
    if (m.embed_url !== null) m3bad(`${m.id}: download の embed_url は null`);
    if (m.download_url !== null && !m3https(m.download_url)) m3bad(`${m.id}: download_url は https の URL か null`);
  } else m3bad(`${m.id}: kind は sketchfab / voyager / download`);
  if (m.kind !== 'download' && m.download_url !== null) m3bad(`${m.id}: 埋め込みのものの download_url は null`);
  const lic = m.license;
  if (!lic || !['cc0', 'cc-by', 'nasa-media'].includes(lic.code) || !m3str(lic.label, 120) || !m3https(lic.url)) m3bad(`${m.id}: license は {code: cc0 / cc-by / nasa-media, label, url}`);
  if (!Array.isArray(m.topics) || m.topics.length < 1 || m.topics.length > 8 || !m.topics.every((t) => m3str(t, 20))) m3bad(`${m.id}: topics は 1〜8 個の短い語`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(m.checked_at)) || !m3str(m.checked_how, 300)) m3bad(`${m.id}: checked_at（YYYY-MM-DD）と checked_how`);
}
const m3out = m3models.map((m) => ({
  id: m.id, title_ja: m.title_ja, title_src: m.title_src, org: m.org, kind: m.kind, page_url: m.page_url, embed_url: m.embed_url, download_url: m.download_url,
  license: { code: m.license.code, label: m.license.label, url: m.license.url }, attribution: m.attribution, topics: [...m.topics], checked_at: m.checked_at,
}));
fs.writeFileSync(
  path.join(root, 'src/generated/models3d-catalog.ts'),
  '// 生成ファイル。手で編集しない（scripts/sync-claude-assets.sh が factory/models3d/catalog.json から生成する）\n' +
    'export interface Model3dEntry {\n  id: string;\n  title_ja: string;\n  title_src: string;\n  org: string;\n  kind: \'sketchfab\' | \'voyager\' | \'download\';\n  page_url: string;\n  embed_url: string | null;\n  download_url: string | null;\n  license: { code: \'cc0\' | \'cc-by\' | \'nasa-media\'; label: string; url: string };\n  attribution: string;\n  topics: string[];\n  checked_at: string;\n}\n' +
    `export const MODELS3D: readonly Model3dEntry[] = ${JSON.stringify(m3out)};\n`,
);

const fixturesDir = path.join(root, 'test/fixtures');
const files = {};
const walk = (dir) => {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else files[path.relative(fixturesDir, p).split(path.sep).join('/')] = fs.readFileSync(p, 'utf8');
  }
};
walk(fixturesDir);
const sorted = Object.fromEntries(Object.keys(files).sort().map((k) => [k, files[k]]));
fs.writeFileSync(
  path.join(root, 'src/fake/fixtures.generated.ts'),
  '// 生成ファイル。手で編集しない（scripts/sync-claude-assets.sh が test/fixtures/ から生成する）。fake 専用\n' +
    `export const FIXTURE_FILES: Record<string, string> = ${JSON.stringify(sorted, null, 0)};\n`,
);
console.log(`claude-assets: kinds=${Object.keys(kinds).join(',')} fixtures=${Object.keys(sorted).length} scout_feeds=${feeds.length} x_handles=${handles.length} topic_feeds=${topicFeeds.length} models3d=${m3out.length}`);
NODE
