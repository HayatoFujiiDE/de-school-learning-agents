// 機械用の注文の入口 POST /api/orders（契約 §U）。新しい素材の draft の注文 1 種類だけ。
// 認証: service token（common_name）で通り、かつ common_name が ORDER_CLIENT_IDS のどれかと完全一致する時だけ（§U-1）。
// 上限（1 日の件数）と止める設定は、materials / factory_jobs / machine_orders の INSERT と同じ batch の SQL の述語で判定する（§U-3）。
// 注文票の本文・題名は応答・ログに出さない。
import { first, getSetting, stmt, tokyoDay } from '../db';
import { cfg, type Env } from '../env';
import { json, type RouteCtx } from '../http';
import { insertMaterial, parseNewMaterialBody, startAfterQueue } from './materials';

/** §U-2: 本文の上限（バイト） */
export const ORDER_BODY_MAX_BYTES = 64 * 1024;
const REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
/** insertMaterial の述語が成り立たなかった時の内部の印（応答には出さない。理由は後で読み直して 403 / 429 に分ける） */
const REFUSED = 'machine_order_refused';

/** ORDER_CLIENT_IDS（カンマ区切り・前後の空白は除く・空の要素は捨てる） */
export function orderClientIds(e: Env): string[] {
  return String(e.ORDER_CLIENT_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** common_name が ORDER_CLIENT_IDS のどれかと完全一致する時だけ true（部分一致・接頭辞一致はしない） */
export function isOrderClient(e: Env, name: string | null): boolean {
  if (typeof name !== 'string' || name.length === 0) return false;
  return orderClientIds(e).some((id) => id === name);
}

async function readOrderBody(request: Request): Promise<Record<string, unknown> | null> {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > ORDER_BODY_MAX_BYTES) return null;
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

interface OrderRow {
  client: string;
  material_id: string;
  job_id: string;
}

const findOrder = (db: D1Database, requestId: string) =>
  first<OrderRow>(db, stmt('SELECT client, material_id, job_id FROM machine_orders WHERE request_id = ?', requestId));

/** 同じ request_id の行がある時: 同じ client なら 200 replay（startJob は呼ばない）、違えば 409 */
function replayOrConflict(row: OrderRow, client: string): Response {
  if (row.client !== client) return json(409, { error: 'request_id_conflict' });
  return json(200, { material_id: row.material_id, job_id: row.job_id, replay: true });
}

/** 述語 P: 止める設定が '0' でなく（行が無ければ有効）、その日の machine_orders が上限未満（上限 0 以下なら常に偽） */
const ORDER_PREDICATE =
  "SELECT 1 WHERE COALESCE((SELECT value FROM settings WHERE key = 'machine_orders_enabled'), '1') <> '0' AND (SELECT COUNT(*) FROM machine_orders WHERE day = ?) < ?";

export async function createOrder(c: RouteCtx): Promise<Response> {
  // §U-1 の 3・4（service かどうかは明示のフィールドで見る）
  if (c.service !== true) return json(403, { error: 'service_only' });
  const client = c.serviceName;
  if (!client || !isOrderClient(c.env, client)) return json(403, { error: 'orders_disabled' });

  // §U-2
  const b = await readOrderBody(c.request);
  if (!b) return json(400, { error: 'invalid_json' });
  const requestId = b.request_id;
  if (typeof requestId !== 'string' || !REQUEST_ID_RE.test(requestId)) return json(400, { error: 'invalid_request_id' });
  const p = parseNewMaterialBody(b);
  if (!p.ok) return p.response;

  const db = c.env.DB;
  // §U-3 の 3: 既にあれば新しく作らない
  const prior = await findOrder(db, requestId);
  if (prior) return replayOrConflict(prior, client);

  const conf = cfg(c.env);
  const day = tokyoDay();
  const max = conf.orderDailyMax;
  const q = await insertMaterial(db, p.input, {
    budget_cents: conf.budgetDraftCents,
    guard: {
      exists: stmt(ORDER_PREDICATE, day, max),
      last: (ids) =>
        stmt(
          `INSERT INTO machine_orders (request_id, client, material_id, job_id, day, created_at)
           SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (${ORDER_PREDICATE})`,
          requestId,
          client,
          ids.material_id,
          ids.job_id,
          day,
          ids.now,
          day,
          max,
        ),
      conflict: REFUSED,
    },
  });

  if (q.status === 409 && q.body.error === REFUSED) {
    // 述語が成り立たなかった（3 文とも 0 行）。同時に来た同じ request_id が最後の枠を取った時は replay を返す（§U-3 の 3）
    const taken = await findOrder(db, requestId);
    if (taken) return replayOrConflict(taken, client);
    // 理由を読み直して分ける（判定そのものは上の述語で済んでいる）
    if ((await getSetting(db, 'machine_orders_enabled')) === '0') return json(403, { error: 'orders_disabled' });
    return json(429, { error: 'daily_order_limit' });
  }
  if (q.status === 409 && q.body.error === 'slug_taken') {
    // UNIQUE 違反は batch ごと戻る。同時に来た同じ request_id に負けた時は再読して replay を返す
    const won = await findOrder(db, requestId);
    if (won) return replayOrConflict(won, client);
  }
  if (q.status === 201) console.log(JSON.stringify({ at: 'machine_order', client, material_id: q.body.material_id, job_id: q.body.job_id }));
  return startAfterQueue(c, q);
}
