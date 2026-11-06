// 画像生成の運営の操作（契約 §O-5 e）。認証は §B-1 の admin と同じ（index.ts の requireAccess。GET 以外は Origin 検証）。
// 書き込みは「止める」（H1）と「再開する」（H2）だけ。金額・停止の理由・依頼の一覧は読み取り専用の表示。
// prompt・画像のバイト・鍵はログに出さない。監査のログは {at:'image_halt'|'image_unhalt'} だけ。
import { all, cas, first, getSetting, nowIso, stmt } from '../db';
import { intVar, type Env } from '../env';
import { json, type RouteCtx } from '../http';
import { tokyoMonth } from '../ledger';
import { OPENAI_BACKUP_LAST_USED_KEY, openAiBackupPresent } from '../openai';

/** settings の key（§O-1） */
export const IMAGE_HALT_KEY = 'image_gen_halted';
/** 職人に返す image_id = 依頼の id（§O-6 b） */
export const IMAGE_REQUEST_ID_RE = /^img_[0-9a-f]{32}$/;
/** 最近の依頼の件数（§O-5 e） */
export const IMAGE_RECENT_LIMIT = 20;

/** §M-3 の画像の CSP（routes/library.ts の IMAGE_CSP と同じ値） */
const IMAGE_CSP = "default-src 'none'; sandbox";
const IMAGE_MEDIA: Record<string, string> = { png: 'image/png', webp: 'image/webp' };

/** 画像の記帳の月の上限（var `IMAGE_MONTHLY_CAP_CENTS`、既定 3000。§O-4 a） */
export function imageMonthCapCents(env: Env): number {
  return intVar((env as Env & { IMAGE_MONTHLY_CAP_CENTS?: string }).IMAGE_MONTHLY_CAP_CENTS, 3000);
}

/** Asia/Tokyo の暦月の `kind = 'image'` の記帳の合計（取り置き ih: と確定 if: の両方。§O-0 G1） */
export async function imageMonthCents(db: D1Database, d: Date = new Date()): Promise<number> {
  const r = await first<{ c: number | null }>(db, stmt("SELECT SUM(cents) AS c FROM cost_ledger WHERE kind = 'image' AND substr(day, 1, 7) = ?", tokyoMonth(d)));
  return Number(r?.c ?? 0);
}

/** `GET /api/status` の `images`（§O-5 e）。§O-13 5: 予備の鍵は有無（boolean）と最後に使った時刻だけ（値は返さない） */
export async function imageStatusSummary(env: Env): Promise<{
  halted: string | null;
  month_cents: number;
  month_cap_cents: number;
  backup_configured: boolean;
  backup_last_used_at: string | null;
}> {
  return {
    halted: await getSetting(env.DB, IMAGE_HALT_KEY),
    month_cents: await imageMonthCents(env.DB),
    month_cap_cents: imageMonthCapCents(env),
    backup_configured: openAiBackupPresent(env),
    backup_last_used_at: await getSetting(env.DB, OPENAI_BACKUP_LAST_USED_KEY),
  };
}

interface RecentRow {
  request_id: string;
  job_id: string;
  state: string;
  error: string | null;
  model: string | null;
  size: string | null;
  quality: string | null;
  u_cents: number | null;
  actual_cents: number | null;
  created_at: string;
}

/** GET /api/images/status */
export async function getImagesStatus(c: RouteCtx): Promise<Response> {
  const db = c.env.DB;
  const counts = await first<{ holds_open: number; dispatched: number }>(
    db,
    stmt(
      `SELECT (SELECT COUNT(*) FROM cost_ledger WHERE kind = 'image' AND ref_id GLOB 'ih:*') AS holds_open,
              (SELECT COUNT(*) FROM image_requests WHERE state = 'dispatched') AS dispatched`,
    ),
  );
  // input_json（prompt・alt）はここでは返さない（一覧は状態と金額だけ）
  const recent = await all<RecentRow>(
    db,
    stmt(
      `SELECT id AS request_id, job_id, state, error, model, size, quality, u_cents, actual_cents, created_at
       FROM image_requests ORDER BY created_at DESC, id DESC LIMIT ?`,
      IMAGE_RECENT_LIMIT,
    ),
  );
  const s = await imageStatusSummary(c.env);
  return json(200, {
    halted: s.halted,
    month_cents: s.month_cents,
    month_cap_cents: s.month_cap_cents,
    backup_configured: s.backup_configured,
    backup_last_used_at: s.backup_last_used_at,
    holds_open: Number(counts?.holds_open ?? 0),
    dispatched: Number(counts?.dispatched ?? 0),
    recent,
  });
}

/** POST /api/images/halt（H1。既に止まっていれば最初の理由を残す） */
export async function haltImages(c: RouteCtx): Promise<Response> {
  const db = c.env.DB;
  await cas(db, stmt("INSERT INTO settings (key, value, updated_at) VALUES ('image_gen_halted', 'manual', ?) ON CONFLICT(key) DO NOTHING", nowIso()));
  console.log(JSON.stringify({ at: 'image_halt' }));
  return json(200, { halted: await getSetting(db, IMAGE_HALT_KEY) });
}

/** POST /api/images/unhalt（H2。dispatched が 1 つも無い時だけ消す） */
export async function unhaltImages(c: RouteCtx): Promise<Response> {
  const db = c.env.DB;
  const ok = await cas(
    db,
    stmt("DELETE FROM settings WHERE key = 'image_gen_halted' AND NOT EXISTS (SELECT 1 FROM image_requests WHERE state = 'dispatched')"),
  );
  if (ok) {
    console.log(JSON.stringify({ at: 'image_unhalt' }));
    return json(200, { halted: null });
  }
  // 0 行の理由は読み直して決める（決定は H2 の 1 文で済んでいる）
  if ((await getSetting(db, IMAGE_HALT_KEY)) === null) return json(409, { error: 'not_halted' });
  return json(409, { error: 'dispatched_remain' });
}

/** GET /api/images/requests/:id/file（state = 'done' の時だけ R2 の r2_key を §M-3 のヘッダで返す。他は 404） */
export async function imageRequestFile(c: RouteCtx, id: string): Promise<Response> {
  const notFound = () => json(404, { error: 'not_found' });
  if (!IMAGE_REQUEST_ID_RE.test(id)) return notFound();
  const row = await first<{ state: string; r2_key: string | null; format: string | null }>(
    c.env.DB,
    stmt('SELECT state, r2_key, format FROM image_requests WHERE id = ?', id),
  );
  if (!row || row.state !== 'done' || !row.r2_key || !row.format) return notFound();
  const type = Object.prototype.hasOwnProperty.call(IMAGE_MEDIA, row.format) ? IMAGE_MEDIA[row.format] : null;
  if (!type) return notFound();
  const obj = await c.env.R2.get(row.r2_key);
  if (!obj) return notFound();
  return new Response(obj.body, {
    status: 200,
    headers: { 'content-type': type, 'x-content-type-options': 'nosniff', 'cache-control': 'no-store', 'content-security-policy': IMAGE_CSP },
  });
}

/**
 * 確認画面の generated_images（§O-7 6）。版の material.json の parts[].files[].image_id を、同じ job の image_requests の input_json に結ぶ。
 * prompt を返すのは認証済みの運営（GET /api/review/:version_id）だけ。
 */
export async function generatedImagesOf(
  db: D1Database,
  jobId: string,
  material: unknown,
): Promise<Array<{ path: string; accuracy: string | null; prompt: string | null; alt: string | null }>> {
  const want: Array<{ path: string; image_id: string }> = [];
  const parts = material && typeof material === 'object' && Array.isArray((material as { parts?: unknown }).parts) ? ((material as { parts: unknown[] }).parts) : [];
  for (const p of parts) {
    const files = p && typeof p === 'object' && Array.isArray((p as { files?: unknown }).files) ? ((p as { files: unknown[] }).files) : [];
    for (const f of files) {
      if (!f || typeof f !== 'object') continue;
      const ff = f as { path?: unknown; image_id?: unknown };
      if (typeof ff.path !== 'string' || typeof ff.image_id !== 'string' || !IMAGE_REQUEST_ID_RE.test(ff.image_id)) continue;
      want.push({ path: ff.path, image_id: ff.image_id });
    }
  }
  if (want.length === 0) return [];
  const ids = [...new Set(want.map((w) => w.image_id))].slice(0, 100);
  const rows = await all<{ id: string; input_json: string }>(
    db,
    stmt(`SELECT id, input_json FROM image_requests WHERE job_id = ? AND id IN (${ids.map(() => '?').join(',')})`, jobId, ...ids),
  );
  const byId = new Map(rows.map((r) => [r.id, r.input_json]));
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  const out: Array<{ path: string; accuracy: string | null; prompt: string | null; alt: string | null }> = [];
  for (const w of want) {
    const raw = byId.get(w.image_id);
    if (raw === undefined) continue;
    let input: Record<string, unknown> = {};
    try {
      const v = JSON.parse(raw);
      if (v && typeof v === 'object' && !Array.isArray(v)) input = v as Record<string, unknown>;
    } catch {
      input = {};
    }
    out.push({ path: w.path, accuracy: str(input.accuracy), prompt: str(input.prompt), alt: str(input.alt) });
  }
  return out;
}
