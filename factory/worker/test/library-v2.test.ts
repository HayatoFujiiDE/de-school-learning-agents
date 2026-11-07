// §AL-6: GET /api/library/available の schema 1 / 2 の応答の形。schema 1 の既存の項目は従来どおり（新しい項目は null / []）
import { describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import worker from '../src/index';
import { d1, migratedDb } from './d1-shim';
import { goodMaterial, goodMaterialV2 } from './helpers';

const T0 = '2026-11-08T00:00:00.000Z';

function seed(db: ReturnType<typeof migratedDb>, id: string, material: Record<string, unknown>, updatedAt: string) {
  db.prepare(
    `INSERT INTO materials (id, slug, title, kinds_json, catalog_item_id, concept_codes_json, work_status, publish_status, brief_md, created_at, updated_at)
     VALUES (?, ?, ?, '[3]', ?, '[]', 'review', 'available', 'b', ?, ?)`,
  ).run(id, `slug-${id}`, `title-${id}`, String(material.catalog_item_id ?? ''), T0, updatedAt);
  db.prepare(
    `INSERT INTO factory_jobs (id, material_id, kind, model, phase, status, session_id, brief_md, created_at, updated_at)
     VALUES (?, ?, 'draft', 'claude-sonnet-5-5', 'making', 'done', ?, 'b', ?, ?)`,
  ).run(`j-${id}`, id, `sesn_${id}`, T0, T0);
  db.prepare(
    `INSERT INTO material_versions (id, material_id, version, job_id, session_id, r2_prefix, content_sha256, material_json, claims_json, adapt_rules_md, checks_json, public_paths_json, status, created_at)
     VALUES (?, ?, 1, ?, ?, ?, 'sha', ?, '{}', 'a', '{}', '[]', 'approved', ?)`,
  ).run(`v-${id}`, id, `j-${id}`, `sesn_${id}`, `materials/${id}/`, JSON.stringify(material), T0);
  db.prepare('UPDATE materials SET current_version_id = ? WHERE id = ?').run(`v-${id}`, id);
}

async function available(db: ReturnType<typeof migratedDb>) {
  const env = { DB: d1(db) } as unknown as Env;
  const res = await worker.fetch(new Request('http://localhost/api/library/available'), env, {} as ExecutionContext);
  expect(res.status).toBe(200);
  return (await res.json()) as { materials: Array<Record<string, unknown>> };
}

describe('§AL-6 GET /api/library/available（schema 1 / 2）', () => {
  it('schema 1: 従来の項目は不変。schema_version 1・summary / spark は null・part の body_url / play_url は null・questions_for_kids / interest_entries は []', async () => {
    const db = migratedDb();
    seed(db, 'm1', goodMaterial(), T0);
    const { materials } = await available(db);
    expect(materials).toHaveLength(1);
    const u = (p: string) => `/api/library/files/v-m1/${p}`;
    const variant = (audience: string, length: string, game = false, path = `parts/p1/${audience}-${length}.md`) => ({ audience, length, interest: null, game, url: u(path) });
    expect(materials[0]).toStrictEqual({
      material_id: 'm1',
      slug: 'slug-m1',
      title: 'title-m1',
      version: 1,
      version_id: 'v-m1',
      kinds: [3],
      catalog_item_id: 'redstone',
      concept_codes: [],
      schema_version: 1,
      summary_elementary: 'レッドストーンで信号を運ぶ',
      summary_secondary: '信号の伝わり方を図で見る',
      summary: null,
      spark: null,
      parts: [
        {
          id: 'p1',
          kind: 3,
          title: '信号の道',
          entry_point: { type: 'look', text: '図の赤い線を指でたどる' },
          variants: [
            variant('elementary', 'short'),
            variant('elementary', 'long'),
            variant('secondary', 'short'),
            variant('secondary', 'long'),
            variant('elementary', 'short', true, 'parts/p1/game.md'),
          ],
          files: [{ role: 'figure', url: u('parts/p1/figure-1.svg') }],
          body_url: null,
          play_url: null,
          questions_for_kids: [],
          interest_entries: [],
          adjustable: ['例'],
          needs_supporter_check: false,
        },
      ],
      claims_url: u('claims.json'),
      adapt_rules_url: u('adapt-rules.md'),
      conditions: null,
      license_summary: null,
      approved_at: null,
    });
  });

  it('schema 1: schema_version が無い material.json も 1。summary / body 等の項目が紛れ込んでいても出さない', async () => {
    const db = migratedDb();
    const m = goodMaterial();
    delete m.schema_version;
    m.summary = 'x';
    m.spark = 'y';
    (m.parts as Array<Record<string, unknown>>)[0].body = 'parts/p1/body.md';
    (m.parts as Array<Record<string, unknown>>)[0].questions_for_kids = [{ id: 'q1', text: 't', claim_ids: ['c1'] }];
    seed(db, 'm1', m, T0);
    const [x] = (await available(db)).materials;
    expect(x).toMatchObject({ schema_version: 1, summary: null, spark: null });
    const p = (x.parts as Array<Record<string, unknown>>)[0];
    expect(p).toMatchObject({ body_url: null, play_url: null, questions_for_kids: [], interest_entries: [] });
    expect((p.variants as unknown[]).length).toBe(5);
  });

  it('schema 2: schema_version 2・summary / spark・body_url / play_url・問いの種 2 件（そのまま）・入口 2 件。variants は []・summary_elementary / summary_secondary は null', async () => {
    const db = migratedDb();
    const mv2 = goodMaterialV2();
    seed(db, 'm2', mv2, T0);
    const [x] = (await available(db)).materials;
    const u = (p: string) => `/api/library/files/v-m2/${p}`;
    expect(x).toMatchObject({
      schema_version: 2,
      summary: mv2.summary,
      spark: mv2.spark,
      summary_elementary: null,
      summary_secondary: null,
      claims_url: u('claims.json'),
    });
    const parts = x.parts as Array<Record<string, unknown>>;
    expect(parts).toHaveLength(1);
    const src = (mv2.parts as Array<Record<string, unknown>>)[0];
    expect(parts[0]).toStrictEqual({
      id: 'p1',
      kind: 3,
      title: '信号の道',
      entry_point: src.entry_point,
      variants: [],
      files: [
        { role: 'figure', url: u('parts/p1/figure-1.svg') },
        { role: 'app', url: u('parts/p1/app.html') },
      ],
      body_url: u('parts/p1/body.md'),
      play_url: u('parts/p1/play.md'),
      questions_for_kids: src.questions_for_kids,
      interest_entries: src.interest_entries,
      adjustable: src.adjustable,
      needs_supporter_check: false,
    });
    expect(parts[0].questions_for_kids).toEqual([
      { id: 'q1', text: '粉は何個目まで光るかな？', claim_ids: ['c1'] },
      { id: 'q2', text: 'たいまつを入れると、光り方はどう変わる？', claim_ids: ['c2'] },
    ]);
    expect((parts[0].interest_entries as unknown[]).length).toBe(2);
  });

  it('schema 2: play が無い part は play_url null・問いの種 / 入口が無ければ []・variants が紛れ込んでいても []', async () => {
    const db = migratedDb();
    const mv2 = goodMaterialV2();
    const p = (mv2.parts as Array<Record<string, unknown>>)[0];
    delete p.play;
    delete p.questions_for_kids;
    delete p.interest_entries;
    p.variants = [{ audience: 'elementary', length: 'short', interest: null, game: false, path: 'parts/p1/x.md' }];
    delete mv2.spark;
    seed(db, 'm2', mv2, T0);
    const [x] = (await available(db)).materials;
    expect(x).toMatchObject({ schema_version: 2, spark: null });
    expect((x.parts as Array<Record<string, unknown>>)[0]).toMatchObject({
      body_url: '/api/library/files/v-m2/parts/p1/body.md',
      play_url: null,
      questions_for_kids: [],
      interest_entries: [],
      variants: [],
    });
  });

  it('schema 1 と 2 が並んでも各素材は自分の形（更新の新しい順）', async () => {
    const db = migratedDb();
    seed(db, 'm1', goodMaterial(), T0);
    seed(db, 'm2', goodMaterialV2(), '2026-11-08T01:00:00.000Z');
    const { materials } = await available(db);
    expect(materials.map((m) => [m.material_id, m.schema_version])).toEqual([
      ['m2', 2],
      ['m1', 1],
    ]);
  });
});
