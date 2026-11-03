#!/usr/bin/env bash
# factory/claude/ の rubric・編集基準・allowlist を src/generated/claude-assets.ts に文字列として書き出す（契約 §A）。
# 実行時に fetch で取りに行かないため、dev / deploy / typecheck の前に必ず走らせる。
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
const out = [
  '// 生成ファイル。手で編集しない（scripts/sync-claude-assets.sh が factory/claude/ から生成する）',
  `export const EDITORIAL_STANDARDS: string = ${JSON.stringify(read('editorial-standards.md'))};`,
  `export const RUBRIC_COMMON: string = ${JSON.stringify(read('rubrics/common.md'))};`,
  `export const RUBRIC_KINDS: Record<number, string> = ${JSON.stringify(kinds)};`,
  `export const ALLOWLIST: { domains: string[]; hosts: string[] } = ${JSON.stringify({ domains: allowlist.domains, hosts: allowlist.hosts })};`,
  '',
].join('\n');
fs.mkdirSync(path.join(root, 'src/generated'), { recursive: true });
fs.writeFileSync(path.join(root, 'src/generated/claude-assets.ts'), out);

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
console.log(`claude-assets: kinds=${Object.keys(kinds).join(',')} fixtures=${Object.keys(sorted).length}`);
NODE
