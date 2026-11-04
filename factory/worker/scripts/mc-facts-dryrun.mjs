// mc-facts 段階 A の試運転: Mojang の公開 JSON から Java の release を最新 3 件まで取り、
// パーサーを通して、指定したディレクトリ（R2 と同じキー配置）へだけ書く。標準出力には件数だけを出す（本文は出さない）。
// 使い方（factory/worker で）: node scripts/mc-facts-dryrun.mjs [出力ディレクトリ]
// 出力ディレクトリを省略すると OS の一時ディレクトリの下に新しく作る。server.jar 等のゲーム本体は一切取らない。
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, '..', 'src', 'mc-facts', 'index.ts');

// TypeScript の mc-facts をその場で 1 ファイルにまとめて読み込む（ディスクへは書かない）
const bundled = await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'neutral', write: false, logLevel: 'silent' });
const mod = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));

const outDir = path.resolve(process.argv[2] ?? (await mkdtemp(path.join(os.tmpdir(), 'mc-facts-dryrun-'))));
await mkdir(outDir, { recursive: true });

const inside = (key) => {
  const p = path.resolve(outDir, key);
  if (!p.startsWith(outDir + path.sep)) throw new Error('key_outside_out_dir');
  return p;
};
const put = async (key, body) => {
  const p = inside(key);
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, body);
};
const get = async (key) => {
  try {
    return await readFile(inside(key), 'utf8');
  } catch {
    return null;
  }
};

const result = await mod.collectPatchNotes(globalThis.fetch, put, {
  editions: ['java'],
  types: ['release'],
  limit: 3,
  deadline: Date.now() + 60_000,
  get,
});

console.log(`out_dir=${outDir}`);
console.log(`versions=${result.versions.length} written=${result.versions.filter((v) => v.status === 'written').length} unchanged=${result.versions.filter((v) => v.status === 'unchanged').length} errors=${result.errors.length}`);
for (const v of result.versions) console.log(`  ${v.edition} ${v.version} status=${v.status} changes=${v.change_count ?? 0}${v.reason ? ' reason=' + v.reason : ''}`);
for (const e of result.errors.filter((x) => !x.version)) console.log(`  error ${e.edition ?? '-'} ${e.reason}`);
console.log(`stopped_by_deadline=${result.stopped_by_deadline} stopped_by_limit=${result.stopped_by_limit}`);
process.exitCode = result.errors.length ? 1 : 0;
