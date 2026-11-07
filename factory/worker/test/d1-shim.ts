// テスト用: node:sqlite（Node 24 同梱）の実 DB を D1Database の形で包む（prepare/bind/first/all/run/batch だけ）。
// batch は D1 と同じく 1 トランザクションで逐次実行し、例外なら ROLLBACK する。
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

type V = string | number | null;

export function migratedDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  for (const f of ['0001_init.sql', '0002_intake.sql', '0003_review_triage.sql', '0004_image_gen.sql', '0005_topics.sql', '0006_retro.sql', '0007_machine_orders.sql', '0008_topic_run_diag.sql', '0009_review_auto.sql', '0010_ops_requests.sql']) db.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8'));
  return db;
}

class Stmt {
  constructor(
    private readonly db: DatabaseSync,
    readonly sql: string,
    readonly params: V[] = [],
  ) {}
  bind(...p: V[]) {
    return new Stmt(this.db, this.sql, p);
  }
  async first<T>() {
    const r = this.db.prepare(this.sql).get(...this.params) as T | undefined;
    return r ? ({ ...r } as T) : null;
  }
  async all<T>() {
    return { results: (this.db.prepare(this.sql).all(...this.params) as T[]).map((r) => ({ ...r }) as T) };
  }
  async run() {
    return { meta: { changes: Number(this.db.prepare(this.sql).run(...this.params).changes) } };
  }
  runSync() {
    return { meta: { changes: Number(this.db.prepare(this.sql).run(...this.params).changes) } };
  }
}

export function d1(db: DatabaseSync): D1Database {
  return {
    prepare: (sql: string) => new Stmt(db, sql),
    async batch(stmts: Stmt[]) {
      db.exec('BEGIN');
      try {
        const out = stmts.map((s) => s.runSync());
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  } as unknown as D1Database;
}

export const one = (db: DatabaseSync, sql: string, ...p: V[]) => ({ ...(db.prepare(sql).get(...p) as Record<string, unknown>) });
export const rows = (db: DatabaseSync, sql: string, ...p: V[]) => (db.prepare(sql).all(...p) as Array<Record<string, unknown>>).map((r) => ({ ...r }));
