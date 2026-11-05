// 出す（毎日の予定。契約 contract-T T-8）。費用なし。入・切が入の時だけ確定する。
// 確定は 1 日に 1 回だけ: topic_plans の INSERT と、その日の topic_schedule の INSERT 全部を 1 つの D1 batch で行う（主キーに当たれば全部書かれない）。
// 選び方は決定論の純関数 pickForDay。

import { all, nowIso, prepare, stmt, tokyoDay, isUniqueViolation, type Stmt } from '../db';
import type { Env } from '../env';
import { TOPIC_KINDS, type TopicKind } from './locale';
import { addDays } from './schema';
import { tokyoHour, topicsEnabled, TOPIC_SLOTS } from './store';

export interface PickCandidate {
  id: string;
  kind: TopicKind;
  status: string;
  lineage_id: string;
  depth: number;
  created_at: string;
  slot_day: string;
  starred: number | boolean;
  evergreen: number | boolean;
  fresh_until: string | null;
}

export interface PickHistory {
  lineage_id: string;
  day: string;
}

export interface PickedSlot {
  day: string;
  kind: TopicKind;
  pos: number;
  topic_id: string;
  lineage_id: string;
}

const truthy = (v: number | boolean): boolean => v === true || v === 1;

/**
 * 日 D の予定を選ぶ（T-8。決定論）。種類ごとに: 候補 = その種類の ready で evergreen = 1 か fresh_until >= D。
 * 同じ系譜が D − 30 〜 D − 1 の予定にあるものを除く。系譜ごとに 1 本（depth が大きい方、同じなら新しい方）。
 * 並び (1) slot_day = D (2) まだ一度も出していない (3) 最後に出した日が古い (4) starred (5) id。上から枠の数だけ（足りなければ足りないまま）。
 * 種類をまたいで同じ系譜が重なった時は、後の種類の候補から外す（UNIQUE (day, lineage_id) に当てない）。
 */
export function pickForDay(candidates: readonly PickCandidate[], history: readonly PickHistory[], D: string, slots: Record<TopicKind, number> = TOPIC_SLOTS): PickedSlot[] {
  const from = addDays(D, -30);
  const to = addDays(D, -1);
  const recent = new Set(history.filter((h) => h.day >= from && h.day <= to).map((h) => h.lineage_id));
  const lastShown = new Map<string, string>();
  for (const h of history) if (h.day < D && (lastShown.get(h.lineage_id) ?? '') < h.day) lastShown.set(h.lineage_id, h.day);
  const used = new Set<string>();
  const out: PickedSlot[] = [];
  for (const kind of TOPIC_KINDS) {
    const pool = candidates.filter(
      (c) => c.kind === kind && c.status === 'ready' && (truthy(c.evergreen) || (c.fresh_until !== null && c.fresh_until >= D)) && !recent.has(c.lineage_id) && !used.has(c.lineage_id),
    );
    // 系譜ごとに 1 本
    const byLineage = new Map<string, PickCandidate>();
    for (const c of pool) {
      const cur = byLineage.get(c.lineage_id);
      if (!cur || c.depth > cur.depth || (c.depth === cur.depth && (c.created_at > cur.created_at || (c.created_at === cur.created_at && c.id > cur.id)))) byLineage.set(c.lineage_id, c);
    }
    const sorted = [...byLineage.values()].sort((a, b) => {
      const sa = a.slot_day === D ? 0 : 1;
      const sb = b.slot_day === D ? 0 : 1;
      if (sa !== sb) return sa - sb;
      const la = lastShown.get(a.lineage_id);
      const lb = lastShown.get(b.lineage_id);
      if ((la === undefined) !== (lb === undefined)) return la === undefined ? -1 : 1;
      if (la !== undefined && lb !== undefined && la !== lb) return la < lb ? -1 : 1;
      const st = (truthy(b.starred) ? 1 : 0) - (truthy(a.starred) ? 1 : 0);
      if (st !== 0) return st;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    const n = slots[kind] ?? 0;
    for (const c of sorted.slice(0, n)) {
      used.add(c.lineage_id);
      out.push({ day: D, kind, pos: out.filter((x) => x.kind === kind).length + 1, topic_id: c.id, lineage_id: c.lineage_id });
    }
  }
  return out;
}

/** 日 D の確定の batch（topic_plans → topic_schedule の順） */
export function planStmts(D: string, picked: readonly PickedSlot[], now: string): Stmt[] {
  return [
    stmt('INSERT INTO topic_plans (day, made, created_at) VALUES (?, ?, ?)', D, picked.length, now),
    ...picked.map((p) => stmt('INSERT INTO topic_schedule (day, kind, pos, topic_id, lineage_id) VALUES (?, ?, ?, ?, ?)', p.day, p.kind, p.pos, p.topic_id, p.lineage_id)),
  ];
}

export type PlanResult = 'made' | 'exists' | 'disabled' | 'no_ready';

/**
 * 日 D の予定を確定する。確定済み（topic_plans に行がある）なら何もしない（'exists'）。入・切が切なら 'disabled'。
 * requireReady（当日の分）: 出せるお題（ready で evergreen = 1 か fresh_until >= D）が 1 本も無ければ確定せず 'no_ready'（行を作らない。次の tick がまた見る）
 */
export async function planDay(env: Env, D: string, o: { requireReady?: boolean } = {}): Promise<PlanResult> {
  const db = env.DB;
  if (!(await topicsEnabled(db))) return 'disabled';
  const has = await all(db, stmt('SELECT 1 FROM topic_plans WHERE day = ?', D));
  if (has.length) return 'exists';
  const candidates = await all<PickCandidate>(
    db,
    stmt(`SELECT id, kind, status, lineage_id, depth, created_at, slot_day, starred, evergreen, fresh_until FROM topics WHERE status = 'ready' AND (evergreen = 1 OR fresh_until >= ?)`, D),
  );
  if (o.requireReady && candidates.length === 0) return 'no_ready';
  const history = await all<PickHistory>(db, stmt('SELECT lineage_id, day FROM topic_schedule WHERE day < ?', D));
  const picked = pickForDay(candidates, history, D);
  try {
    await db.batch(planStmts(D, picked, nowIso()).map((s) => prepare(db, s)));
  } catch (e) {
    if (isUniqueViolation(e)) return 'exists'; // 別の tick が先に確定した（topic_plans の主キー）。batch は全部巻き戻る
    throw e;
  }
  return 'made';
}

/** 段 (1): 当日の分（時刻に関係なく。出せるお題が 1 本以上ある時だけ）→ 翌日の分（Asia/Tokyo の 18:00 以降。0 本でも確定）を順に */
export async function planStep(env: Env, now: Date = new Date()): Promise<{ today: PlanResult; tomorrow: PlanResult | null }> {
  const today = tokyoDay(now);
  const t = await planDay(env, today, { requireReady: true });
  const tomorrow = tokyoHour(now) >= 18 ? await planDay(env, addDays(today, 1)) : null;
  return { today: t, tomorrow };
}

/** その日の枠ごとの状態（GET /api/topics/schedule と /api/status）: ready / stopped（予定にあるが今は ready でない）/ empty */
export async function scheduleSlots(db: D1Database, D: string): Promise<{ planned: boolean; slots: Array<{ kind: TopicKind; pos: number; state: 'ready' | 'stopped' | 'empty'; topic_id: string | null }> }> {
  const planned = (await all(db, stmt('SELECT 1 FROM topic_plans WHERE day = ?', D))).length > 0;
  const rows = await all<{ kind: TopicKind; pos: number; topic_id: string; status: string }>(
    db,
    stmt('SELECT s.kind, s.pos, s.topic_id, t.status FROM topic_schedule s JOIN topics t ON t.id = s.topic_id WHERE s.day = ?', D),
  );
  const slots: Array<{ kind: TopicKind; pos: number; state: 'ready' | 'stopped' | 'empty'; topic_id: string | null }> = [];
  for (const kind of TOPIC_KINDS) {
    for (let pos = 1; pos <= TOPIC_SLOTS[kind]; pos++) {
      const r = rows.find((x) => x.kind === kind && Number(x.pos) === pos);
      slots.push({ kind, pos, state: r ? (r.status === 'ready' ? 'ready' : 'stopped') : 'empty', topic_id: r ? r.topic_id : null });
    }
  }
  return { planned, slots };
}
