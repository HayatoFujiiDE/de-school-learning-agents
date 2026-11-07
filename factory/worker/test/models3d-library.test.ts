// §AJ-5・§AJ-6 7・§AK-4 3: GET /api/library/models3d（認証なし）。権利の門番を通った項目だけ（記録の無い項目は出ない）。
import { describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import { MODELS3D } from '../src/generated/models3d-catalog';
import worker from '../src/index';
import { SKETCHFAB_EMBED_RE, VOYAGER_EMBED_RE } from '../src/models3d';
import { licenseLabelOf } from '../src/rights';
import { d1, migratedDb } from './d1-shim';
import { goodRecord, insertRecord } from './rights-helpers';

// 一覧 API は D1（rights_records・rights_hosted・models3d_files）と R2 の head を読む
const envOf = (db = migratedDb()) => ({ DB: d1(db), R2: { head: async () => null } }) as unknown as Env;
const get = (path: string, env: Env = envOf(), method = 'GET') => worker.fetch(new Request(`http://localhost${path}`, { method }), env, {} as ExecutionContext);
const embeddable = MODELS3D.filter((e) => e.kind === 'sketchfab' || e.kind === 'voyager');

describe('§AJ-5・§AK-4 3 GET /api/library/models3d', () => {
  it('記録が 1 件も無い（deploy 直後）は 0 件。cache は 10 分', async () => {
    const res = await get('/api/library/models3d');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=600');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(await res.json()).toEqual({ models: [] });
  });

  it('記録のある埋め込みの件を一覧の順に返し、download（取り込み無し）と記録の無い項目は含まない。キーは 8 + license_code・license_url', async () => {
    const db = migratedDb();
    const recs = new Map<string, Awaited<ReturnType<typeof goodRecord>>>();
    // 先頭の 1 件だけ記録を入れない（行の無い項目は出ない）
    const skipped = embeddable[0].id;
    for (const e of MODELS3D) {
      if (e.id === skipped) continue;
      const r = await goodRecord(e);
      insertRecord(db, r);
      recs.set(e.id, r);
    }
    const res = await get('/api/library/models3d', envOf(db));
    const b = (await res.json()) as { models: Array<Record<string, unknown>> };
    const expected = embeddable.filter((e) => e.id !== skipped);
    expect(b.models.length).toBe(expected.length);
    expect(b.models.some((x) => x.id === skipped)).toBe(false);
    expect(b.models.some((x) => x.kind === 'download')).toBe(false);
    expect(b.models).toEqual(
      expected.map((e) => {
        const r = recs.get(e.id)!;
        return {
          id: e.id,
          title: e.title_ja,
          org: e.org,
          kind: e.kind,
          embed_url: e.embed_url,
          page_url: e.page_url,
          license: licenseLabelOf(r.license_code, r.license_url),
          attribution: e.attribution,
          license_code: r.license_code,
          license_url: r.license_url,
        };
      }),
    );
    for (const x of b.models) expect(Object.keys(x).sort()).toEqual(['attribution', 'embed_url', 'id', 'kind', 'license', 'license_code', 'license_url', 'org', 'page_url', 'title']);
    // license は機械が決めた code の名前（一覧の label ではない）。license_url は正規化した url
    const allo = b.models.find((x) => x.id === 'omnh-allosaurus')!;
    expect(allo).toMatchObject({ license: 'CC BY 4.0', license_code: 'cc-by', license_url: 'https://creativecommons.org/licenses/by/4.0/' });
    expect(skipped).toBe('si-triceratops');
    const mammoth = b.models.find((x) => x.id === 'si-woolly-mammoth')!;
    expect(mammoth).toMatchObject({ license: 'CC0 1.0', license_code: 'cc0', license_url: 'https://creativecommons.org/publicdomain/zero/1.0/' });
    // 一覧の埋め込みの url は、画面が確かめる 2 つの形のどちらかに合う
    for (const x of b.models) expect(SKETCHFAB_EMBED_RE.test(String(x.embed_url)) || VOYAGER_EMBED_RE.test(String(x.embed_url))).toBe(true);
  });

  it('GET 以外は 405（既存の /api/library/* と同じ）', async () => {
    expect((await get('/api/library/models3d', envOf(), 'POST')).status).toBe(405);
  });
});
