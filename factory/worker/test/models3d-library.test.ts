// §AJ-5・§AJ-6 7: GET /api/library/models3d（認証なし）。一覧のうち埋め込めるもの（sketchfab / voyager）だけ。
import { describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import { MODELS3D } from '../src/generated/models3d-catalog';
import worker from '../src/index';
import { SKETCHFAB_EMBED_RE, VOYAGER_EMBED_RE } from '../src/models3d';

const get = (path: string, method = 'GET') => worker.fetch(new Request(`http://localhost${path}`, { method }), {} as unknown as Env, {} as ExecutionContext);

describe('§AJ-5 GET /api/library/models3d', () => {
  it('埋め込める件数を一覧の順に返し、download を含まない。形は { models: [{ id, title, org, kind, embed_url, page_url, license, attribution }] }', async () => {
    const res = await get('/api/library/models3d');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600');
    const b = (await res.json()) as { models: Array<Record<string, unknown>> };
    const embeddable = MODELS3D.filter((e) => e.kind === 'sketchfab' || e.kind === 'voyager');
    expect(b.models.length).toBe(embeddable.length);
    expect(b.models.length).toBeGreaterThan(0);
    expect(b.models.some((x) => x.kind === 'download')).toBe(false);
    for (const e of MODELS3D.filter((x) => x.kind === 'download')) expect(b.models.some((x) => x.id === e.id)).toBe(false);
    expect(b.models).toEqual(
      embeddable.map((e) => ({ id: e.id, title: e.title_ja, org: e.org, kind: e.kind, embed_url: e.embed_url, page_url: e.page_url, license: e.license.label, attribution: e.attribution })),
    );
    for (const x of b.models) expect(Object.keys(x).sort()).toEqual(['attribution', 'embed_url', 'id', 'kind', 'license', 'org', 'page_url', 'title']);
    // 一覧の埋め込みの url は、画面が確かめる 2 つの形のどちらかに合う
    for (const x of b.models) expect(SKETCHFAB_EMBED_RE.test(String(x.embed_url)) || VOYAGER_EMBED_RE.test(String(x.embed_url))).toBe(true);
  });

  it('GET 以外は 405（既存の /api/library/* と同じ）', async () => {
    expect((await get('/api/library/models3d', 'POST')).status).toBe(405);
  });
});
