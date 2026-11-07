import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MODELS3D } from '../src/generated/models3d-catalog';
import { licenseCodeOfUrl } from '../src/rights';

// 立体モデルの一覧（factory/models3d/catalog.json → src/generated/models3d-catalog.ts）の形。
// 生成側（scripts/sync-claude-assets.sh）も同じ決まりで止まるが、生成ファイルが古いままでも気づけるようにここでも見る

const HTTPS = /^https:\/\/[^\s]+$/;
const SKETCHFAB_EMBED = /^https:\/\/sketchfab\.com\/models\/([0-9a-f]{32})\/embed$/;
const VOYAGER_EMBED = /^https:\/\/3d-api\.si\.edu\/voyager\/3d_package:([0-9a-f-]{36})$/;

describe('立体モデルの一覧（models3d）', () => {
  it('人が確かめた一覧が 1 件以上あり、埋め込みの 2 種類（sketchfab / voyager）がそれぞれ 1 件以上ある', () => {
    expect(MODELS3D.length).toBeGreaterThanOrEqual(20);
    expect(MODELS3D.filter((m) => m.kind === 'sketchfab').length).toBeGreaterThanOrEqual(1);
    expect(MODELS3D.filter((m) => m.kind === 'voyager').length).toBeGreaterThanOrEqual(1);
  });

  it('id は [a-z0-9-] で一意', () => {
    const ids = MODELS3D.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]{3,40}$/);
  });

  it('ライセンスは CC0 / CC BY / NASA の利用の決まりだけ（非営利限定は載せない）', () => {
    for (const m of MODELS3D) {
      expect(['cc0', 'cc-by', 'nasa-media']).toContain(m.license.code);
      expect(m.license.label).not.toMatch(/NC|NonCommercial|非営利/);
      expect(m.license.url).toMatch(HTTPS);
    }
  });

  it('埋め込みの url は提供元の公式の形で、ページの url と同じモデルを指す', () => {
    for (const m of MODELS3D) {
      expect(m.page_url).toMatch(HTTPS);
      if (m.kind === 'sketchfab') {
        const uid = SKETCHFAB_EMBED.exec(m.embed_url ?? '')?.[1];
        expect(uid, m.id).toBeTruthy();
        expect(m.page_url.endsWith(uid!), m.id).toBe(true);
        expect(m.download_url).toBeNull();
      } else if (m.kind === 'voyager') {
        const id = VOYAGER_EMBED.exec(m.embed_url ?? '')?.[1];
        expect(id, m.id).toBeTruthy();
        expect(m.page_url.endsWith(id!), m.id).toBe(true);
        expect(m.download_url).toBeNull();
      } else {
        expect(m.kind).toBe('download');
        expect(m.embed_url).toBeNull();
        if (m.download_url !== null) expect(m.download_url).toMatch(HTTPS);
      }
    }
  });

  it('題名・提供元・出典の書き方・題材の札・確かめた日がある', () => {
    for (const m of MODELS3D) {
      for (const s of [m.title_ja, m.title_src, m.org, m.attribution]) {
        expect(s.length).toBeGreaterThan(0);
        expect(s).toBe(s.trim());
      }
      expect(m.topics.length).toBeGreaterThanOrEqual(1);
      expect(m.topics.length).toBeLessThanOrEqual(8);
      expect(m.checked_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

// §AK-7 17: 権利の門番が使う一覧の値（uploader・evidence_url・license.url の実在する組み合わせ）と生成ファイルの checked_how
describe('§AK-7 17 一覧の検査（門番が使う値）', () => {
  const pageOk = (m: (typeof MODELS3D)[number]) => {
    const uid = SKETCHFAB_EMBED.exec(m.embed_url ?? '')?.[1] ?? '';
    const pre = 'https://sketchfab.com/3d-models/';
    return m.page_url.startsWith(pre) && m.page_url.endsWith(uid) && /^[A-Za-z0-9-]*$/.test(m.page_url.slice(pre.length, m.page_url.length - uid.length));
  };

  it('sketchfab は uploader（英数字と _ . -・60 字まで）があり、page_url が https://sketchfab.com/3d-models/[A-Za-z0-9-]*<uid>。他の uploader は null', () => {
    for (const m of MODELS3D) {
      if (m.kind === 'sketchfab') {
        expect(m.uploader, m.id).toMatch(/^[A-Za-z0-9_.-]{1,60}$/);
        expect(pageOk(m), m.id).toBe(true);
      } else expect(m.uploader, m.id).toBeNull();
    }
    expect(MODELS3D.filter((m) => m.uploader !== null)).toHaveLength(17);
    expect(new Set(MODELS3D.filter((m) => m.id.startsWith('omnh-')).map((m) => m.uploader))).toEqual(new Set(['OMNH']));
    expect(new Set(MODELS3D.filter((m) => m.id.startsWith('kyu-')).map((m) => m.uploader))).toEqual(new Set(['ffishAsia-and-floraZia']));
  });

  it('download 以外の evidence_url は null。dbarchive.biosciencedbc.jp の download は evidence_url（https）が要る', () => {
    for (const m of MODELS3D) {
      if (m.kind !== 'download') expect(m.evidence_url, m.id).toBeNull();
      if (m.kind === 'download' && m.page_url.startsWith('https://dbarchive.biosciencedbc.jp/')) expect(m.evidence_url, m.id).toMatch(HTTPS);
    }
    expect(MODELS3D.find((m) => m.id === 'dbcls-bodyparts3d')!.evidence_url).toBe('https://dbarchive.biosciencedbc.jp/jp/bodyparts3d/lic.html');
    expect(MODELS3D.filter((m) => m.evidence_url !== null)).toHaveLength(1);
  });

  it('license.url は全件が実在する組み合わせ（licenseCodeOfUrl が unknown にならない）', () => {
    for (const m of MODELS3D) expect(licenseCodeOfUrl(m.license.url), m.id).not.toBe('unknown');
  });

  it('生成ファイルに uploader・evidence_url・checked_how が出る', () => {
    const src = readFileSync(new URL('../src/generated/models3d-catalog.ts', import.meta.url), 'utf8');
    expect(src).toContain('  uploader: string | null;\n  evidence_url: string | null;\n');
    expect(src).toContain('  checked_how: string;\n');
    for (const m of MODELS3D) {
      expect(Object.keys(m), m.id).toEqual(expect.arrayContaining(['uploader', 'evidence_url', 'checked_how']));
      expect(m.checked_how.length, m.id).toBeGreaterThan(0);
    }
  });

  // 生成側（scripts/sync-claude-assets.sh）が止まること: 一時のディレクトリに script と一覧の写しを置き、壊した一覧で走らせる
  const WORKER = fileURLToPath(new URL('..', import.meta.url));
  const FACTORY = join(WORKER, '..');
  const runSync = (mutate: (models: Array<Record<string, any>>) => void) => {
    const root = mkdtempSync(join(tmpdir(), 'models3d-catalog-test-'));
    try {
      mkdirSync(join(root, 'worker/scripts'), { recursive: true });
      mkdirSync(join(root, 'worker/src/fake'), { recursive: true });
      cpSync(join(WORKER, 'scripts/sync-claude-assets.sh'), join(root, 'worker/scripts/sync-claude-assets.sh'));
      for (const d of ['claude', 'scout', 'topics']) symlinkSync(join(FACTORY, d), join(root, d));
      mkdirSync(join(root, 'models3d'));
      const cat = JSON.parse(readFileSync(join(FACTORY, 'models3d/catalog.json'), 'utf8'));
      mutate(cat.models);
      writeFileSync(join(root, 'models3d/catalog.json'), JSON.stringify(cat));
      const r = spawnSync('bash', [join(root, 'worker/scripts/sync-claude-assets.sh')], { encoding: 'utf8' });
      return { status: r.status, stderr: r.stderr, generated: existsSync(join(root, 'worker/src/generated/models3d-catalog.ts')) };
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };
  const find = (models: Array<Record<string, any>>, id: string) => models.find((m) => m.id === id)!;

  it('script: 今の一覧なら通る（対照）', () => {
    const r = runSync(() => {});
    expect(r.status, r.stderr).toBe(0);
    expect(r.generated).toBe(true);
  });

  it.each<[string, (models: Array<Record<string, any>>) => void, string]>([
    ['sketchfab の uploader が無い', (ms) => { find(ms, 'omnh-allosaurus').uploader = null; }, 'sketchfab は uploader が要る'],
    ['uploader の形', (ms) => { find(ms, 'omnh-allosaurus').uploader = 'OMNH museum'; }, 'uploader は英数字'],
    ['sketchfab の page_url の形', (ms) => { find(ms, 'omnh-allosaurus').page_url = 'https://sketchfab.com/models/allosaurus-900868a0aa0b47e58571f5f5ae20094c'; }, 'sketchfab の page_url は'],
    ['download 以外の evidence_url', (ms) => { find(ms, 'si-triceratops').evidence_url = 'https://3d.si.edu/cc0'; }, 'download 以外の evidence_url は null'],
    ['dbarchive の download に evidence_url が無い', (ms) => { find(ms, 'dbcls-bodyparts3d').evidence_url = null; }, 'evidence_url が要る'],
    ['license.url が実在しない組み合わせ', (ms) => { find(ms, 'omnh-allosaurus').license.url = 'https://creativecommons.org/licenses/by/4.0/jp/'; }, 'license.url が実在する組み合わせ'],
    ['sketchfab 以外の uploader', (ms) => { find(ms, 'si-triceratops').uploader = 'Smithsonian'; }, 'sketchfab 以外の uploader は null'],
  ])('script が止まる: %s', (_n, mutate, msg) => {
    const r = runSync(mutate);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(msg);
    expect(r.generated).toBe(false);
  });
});
