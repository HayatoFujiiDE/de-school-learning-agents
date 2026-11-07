import { describe, expect, it } from 'vitest';
import { MODELS3D } from '../src/generated/models3d-catalog';

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
