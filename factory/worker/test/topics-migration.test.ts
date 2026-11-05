// contract-T T-14 b12: 0004 までの状態に行を入れてから 0005 を当て、cost_ledger の行数と中身・索引 3 つの定義が同じ
// （既存の image・video の取り置きのテストは test/d1-shim.ts が 0005 まで当てた DB で走る: image-gen.test.ts・video-q*.test.ts など）
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

const sql = (f: string) => readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8');
const INDEXES = ['idx_cost_day', 'idx_cost_ledger_vb', 'idx_cost_ledger_image_job'];
const indexSql = (db: DatabaseSync) =>
  Object.fromEntries(INDEXES.map((n) => [n, (db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?").get(n) as { sql: string } | undefined)?.sql ?? null]));

describe('migration 0005', () => {
  it('cost_ledger の行数と中身・索引 3 つの定義が 0004 と同じで、kind = topic と topic の一意の索引が足される', () => {
    const db = new DatabaseSync(':memory:');
    for (const f of ['0001_init.sql', '0002_intake.sql', '0003_review_triage.sql', '0004_image_gen.sql']) db.exec(sql(f));
    const ins = db.prepare('INSERT INTO cost_ledger (id, day, kind, ref_id, cents, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    const rows: Array<[string, string, string, string, number, string]> = [
      ['l1', '2026-11-01', 'session', 'job_1', 300, '2026-11-01T00:00:00.000Z'],
      ['l2', '2026-11-02', 'verify', 'vb:v1:1', 150, '2026-11-02T00:00:00.000Z'],
      ['l3', '2026-11-03', 'verify', 'vv:v1:vid1', 10, '2026-11-03T00:00:00.000Z'],
      ['l4', '2026-11-04', 'scout', 'run_1', 5, '2026-11-04T00:00:00.000Z'],
      ['l5', '2026-11-05', 'meeting', 'mm_1', 2, '2026-11-05T00:00:00.000Z'],
      ['l6', '2026-11-06', 'image', 'ih:job_9', 40, '2026-11-06T00:00:00.000Z'],
    ];
    for (const r of rows) ins.run(...r);
    const before = db.prepare('SELECT * FROM cost_ledger ORDER BY id').all();
    const idxBefore = indexSql(db);
    expect(Object.values(idxBefore).every((v) => typeof v === 'string')).toBe(true);

    db.exec(sql('0005_topics.sql'));

    expect(db.prepare('SELECT * FROM cost_ledger ORDER BY id').all()).toEqual(before);
    expect(indexSql(db)).toEqual(idxBefore);
    expect((db.prepare("SELECT sql FROM sqlite_master WHERE name = 'idx_cost_ledger_topic'").get() as { sql: string }).sql).toBe(
      "CREATE UNIQUE INDEX idx_cost_ledger_topic ON cost_ledger(ref_id) WHERE kind = 'topic'",
    );
    // topic が入り、同じ ref は 2 行目が入らない
    ins.run('t1', '2026-11-06', 'topic', 'tp:r1:gen', 60, '2026-11-06T00:00:00.000Z');
    expect(() => ins.run('t2', '2026-11-06', 'topic', 'tp:r1:gen', 60, '2026-11-06T00:00:00.000Z')).toThrow(/UNIQUE/);
    // 既存の一意の索引も効いたまま（画像は job ごとに 1 行・vb: は 1 回）
    expect(() => ins.run('l7', '2026-11-06', 'image', 'if:job_9', 40, '2026-11-06T00:00:00.000Z')).toThrow(/UNIQUE/);
    expect(() => ins.run('l8', '2026-11-06', 'verify', 'vb:v1:1', 1, '2026-11-06T00:00:00.000Z')).toThrow(/UNIQUE/);
    // 知らない kind は入らない
    expect(() => ins.run('l9', '2026-11-06', 'other', 'x', 1, '2026-11-06T00:00:00.000Z')).toThrow(/CHECK/);
  });
});
