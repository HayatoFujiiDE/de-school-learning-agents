// D1 の batch ヘルパ（契約 §B-2 の条件付き batch パターン）。
//
// パターン: 1 つの batch（逐次実行の 1 トランザクション）の全文を同じ述語 P で条件付ける。
//   1. INSERT INTO ... SELECT ... WHERE EXISTS (SELECT 1 FROM ... WHERE P) を先に全部
//   2. P の列を変えない UPDATE（WHERE ... AND EXISTS (P)）
//   3. P の列を変える UPDATE を最後に 1 文だけ（WHERE P）
// batch 後、最後の UPDATE の meta.changes === 0 なら P が成り立たなかった＝競合（呼び出し側が 409）。
// このとき前の文もすべて同じ P で 0 行なので、SQL 失敗以外で片方だけ commit されることがない。

export type SqlValue = string | number | null;
export interface Stmt {
  sql: string;
  params: SqlValue[];
}

export const stmt = (sql: string, ...params: SqlValue[]): Stmt => ({ sql, params });

export function nowIso(d: Date = new Date()): string {
  return d.toISOString();
}

export function isoPlus(ms: number, d: Date = new Date()): string {
  return new Date(d.getTime() + ms).toISOString();
}

/** Asia/Tokyo の日付（YYYY-MM-DD）。日次集計だけこの日付を使う（§R-3） */
export function tokyoDay(d: Date = new Date()): string {
  return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

export function prepare(db: D1Database, s: Stmt): D1PreparedStatement {
  return db.prepare(s.sql).bind(...s.params);
}

export interface BatchOutcome {
  /** 最後の文の meta.changes > 0 */
  ok: boolean;
  changes: number[];
}

/** 条件付き batch を実行する。最後の文の changes で成否を返す（例外は呼び出し側へ） */
export async function conditionalBatch(db: D1Database, stmts: Stmt[]): Promise<BatchOutcome> {
  if (stmts.length === 0) throw new Error('empty batch');
  const res = await db.batch(stmts.map((s) => prepare(db, s)));
  const changes = res.map((r) => Number(r.meta?.changes ?? 0));
  return { ok: changes[changes.length - 1] > 0, changes };
}

/** 単文の CAS。changes > 0 なら true */
export async function cas(db: D1Database, s: Stmt): Promise<boolean> {
  const r = await prepare(db, s).run();
  return Number(r.meta?.changes ?? 0) > 0;
}

export async function first<T = Record<string, unknown>>(db: D1Database, s: Stmt): Promise<T | null> {
  return (await prepare(db, s).first<T>()) ?? null;
}

export async function all<T = Record<string, unknown>>(db: D1Database, s: Stmt): Promise<T[]> {
  const r = await prepare(db, s).all<T>();
  return r.results ?? [];
}

export function isUniqueViolation(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return /UNIQUE constraint failed/i.test(m);
}

/** 例外から「種別」だけを取り出す（本文・トークン・URL を残さない） */
export function errorKind(e: unknown): string {
  if (e && typeof e === 'object') {
    const anyE = e as { name?: unknown; status?: unknown; kind?: unknown };
    const name = typeof anyE.name === 'string' ? anyE.name.replace(/[^A-Za-z0-9_]/g, '').slice(0, 40) : 'Error';
    const status = typeof anyE.status === 'number' ? `:${anyE.status}` : '';
    return `${name}${status}`;
  }
  return 'unknown_error';
}

export async function getSetting(db: D1Database, key: string): Promise<string | null> {
  const r = await first<{ value: string }>(db, stmt('SELECT value FROM settings WHERE key = ?', key));
  return r ? r.value : null;
}

export async function setSetting(db: D1Database, key: string, value: string): Promise<void> {
  await prepare(
    db,
    stmt(
      'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
      key,
      value,
      nowIso(),
    ),
  ).run();
}

/**
 * settings の CAS で「この値の実行権」を取る（定期実行日 scout_last_day / meeting_last_day）。
 * 行が無ければ INSERT、あれば値が違う時だけ UPDATE。changes が 1 の呼び出しだけが true（同じ日に 2 本来ても 1 本だけ進む）
 */
export async function claimSetting(db: D1Database, key: string, value: string): Promise<boolean> {
  return cas(
    db,
    stmt(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at WHERE settings.value <> excluded.value`,
      key,
      value,
      nowIso(),
    ),
  );
}

export const ACTIVE_JOB_SQL = "('queued','creating','running','needs_answer','budget_reached')";
