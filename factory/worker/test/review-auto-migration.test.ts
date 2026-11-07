// 契約 V-1・V-11 u10: 0006 までの状態に行を入れてから 0008 を当て、cost_ledger の行・索引 4 つの定義が同じで、kind = reader と新しい列・表が入る
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

const sql = (f: string) => readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8');
const T = '2026-11-07T00:00:00.000Z';

describe('migration 0008', () => {
  it('cost_ledger の行と 4 つの索引の定義をそのままにして kind = reader を足す。既存の版は reader_status pending・triage_v 0', () => {
    const db = new DatabaseSync(':memory:');
    for (const f of ['0001_init.sql', '0002_intake.sql', '0003_review_triage.sql', '0004_image_gen.sql', '0005_topics.sql', '0006_retro.sql']) db.exec(sql(f));
    const ins = db.prepare('INSERT INTO cost_ledger (id, day, kind, ref_id, cents, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    ins.run('l1', '2026-11-01', 'session', 'job_1', 300, T);
    ins.run('l2', '2026-11-02', 'verify', 'vb:v1:1', 150, T);
    ins.run('l3', '2026-11-03', 'image', 'ih:job_9', 40, T);
    ins.run('l4', '2026-11-04', 'topic', 'tp:r1:gen', 60, T);
    ins.run('l5', '2026-11-05', 'retro', 'j1', 1, T);
    expect(() => ins.run('l6', '2026-11-05', 'reader', 'rd:v1:t', 80, T)).toThrow(/CHECK/);
    db.exec("INSERT INTO materials (id, slug, title, kinds_json, work_status, brief_md, created_at, updated_at) VALUES ('m1', 's', 't', '[3]', 'review', 'b', '" + T + "', '" + T + "')");
    db.exec("INSERT INTO factory_jobs (id, material_id, kind, model, phase, status, brief_md, created_at, updated_at) VALUES ('j1', 'm1', 'draft', 'x', 'making', 'done', 'b', '" + T + "', '" + T + "')");
    db.exec(
      "INSERT INTO material_versions (id, material_id, version, job_id, session_id, r2_prefix, content_sha256, material_json, claims_json, adapt_rules_md, checks_json, public_paths_json, status, triaged_verification_id, created_at) VALUES ('v1', 'm1', 1, 'j1', 's', 'p/', 'sha', '{}', '{}', 'a', '{}', '[]', 'review', 'w-old', '" +
        T +
        "')",
    );
    db.exec("INSERT INTO review_decisions (id, material_version_id, material_id, decision, reviewer_email, created_at) VALUES ('d1', 'v1', 'm1', 'stop', 'x', '" + T + "')");
    const idx = () => db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'cost_ledger' AND sql IS NOT NULL ORDER BY name").all();
    const before = db.prepare('SELECT * FROM cost_ledger ORDER BY id').all();
    const idxBefore = idx();
    expect(idxBefore).toHaveLength(4);
    const versionBefore = db.prepare('SELECT * FROM material_versions').all();

    db.exec(sql('0008_review_auto.sql'));

    expect(db.prepare('SELECT * FROM cost_ledger ORDER BY id').all()).toEqual(before);
    expect(idx()).toEqual(idxBefore);
    ins.run('l6', '2026-11-07', 'reader', 'rd:v1:t', 80, T);
    expect(() => ins.run('l7', '2026-11-07', 'image', 'if:job_9', 40, T)).toThrow(/UNIQUE/);
    expect(() => ins.run('l8', '2026-11-07', 'other', 'x', 1, T)).toThrow(/CHECK/);
    // 既存の版の列は書き換えない（新しい列は既定値）
    const v = db.prepare('SELECT * FROM material_versions').get() as Record<string, unknown>;
    for (const [k, val] of Object.entries(versionBefore[0] as Record<string, unknown>)) expect([k, v[k]]).toEqual([k, val]);
    expect(v).toMatchObject({ reader_status: 'pending', reader_attempts: 0, reader_started_at: null, reader_token: null, reader_json: null, reader_cost_cents: 0, triage_v: 0, triage_gate: null, evidence_reverified: 0, triaged_verification_id: 'w-old' });
    expect(() => db.exec("UPDATE material_versions SET reader_status = 'bad'")).toThrow(/CHECK/);
    expect(db.prepare('SELECT machine_gate FROM review_decisions').get()).toEqual({ machine_gate: null });
    db.exec("INSERT INTO trusted_channels (channel_key, channel_name, channel_url, first_version_id, approved_by, created_at) VALUES ('https://www.youtube.com/@a', 'A', 'https://www.youtube.com/@a', 'v1', 'x', '" + T + "')");
    expect(() => db.exec("INSERT INTO trusted_channels (channel_key, channel_name, channel_url, approved_by, created_at) VALUES ('https://www.youtube.com/@a', 'B', 'u', 'x', 't')")).toThrow(/UNIQUE|PRIMARY/);
  });
});
