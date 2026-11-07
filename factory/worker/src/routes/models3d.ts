// 立体モデル v2 の運営の操作（契約 §AJ2-2。Access の中）: 一覧の download を提供元から取り込み（GLB を R2 に置き D1 に記録）、
// 管理のページ用に一覧の状態を返す。取り込み元の url は一覧（factory/models3d/catalog.json）の download_url だけ（画面や API から url を受け取らない）。
// ログは 1 行の JSON（at: 'model3d_fetch', catalog_id, status, bytes）。url や本文はログに出さない。
import { first, nowIso, stmt } from '../db';
import { MODELS3D } from '../generated/models3d-catalog';
import { json, type RouteCtx } from '../http';
import { isEmbeddableModel3d, model3dEntryOf } from '../models3d';
import { inspectGlb, MAX_MODEL3D_BYTES, models3dFileRows, R2_KEY, readCapped } from '../models3d-file';

const FETCH_TIMEOUT_MS = 60_000;

const logFetch = (catalogId: string, status: string, bytes: number | null) =>
  console.log(JSON.stringify({ at: 'model3d_fetch', catalog_id: catalogId, status, bytes }));

const fail = (catalogId: string, status: number, error: string, bytes: number | null = null): Response => {
  logFetch(catalogId, error, bytes);
  return json(status, { error });
};

const hex = (buf: ArrayBuffer): string => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** 例外の分類（AbortSignal.timeout は TimeoutError） */
const fetchErrorCode = (e: unknown): string => (e && typeof e === 'object' && (e as { name?: unknown }).name === 'TimeoutError' ? 'fetch_failed:timeout' : 'fetch_failed:network');

/**
 * POST /api/models3d/<catalog_id>/fetch（§AJ2-2）。fetchImpl はテストが stub を渡す。
 * 1〜4 で落ちた時は D1 も R2 も書かない。put → upsert の順（D1 に行があるのに object が無い状態を工場の操作だけでは作らない）。古い sha の object は消さない
 */
export async function fetchModel3d(c: RouteCtx, catalogId: string, fetchImpl: typeof fetch = fetch): Promise<Response> {
  // 二重の守り: service token はこの route では Access の層で 401（allowCommonName に入れない）。handler でも人だけ
  if (c.service) return fail(catalogId, 403, 'human_only');
  // 1. 一覧の download だけ
  const entry = model3dEntryOf(catalogId);
  if (!entry) return fail(catalogId, 404, 'not_found');
  if (entry.kind !== 'download' || entry.download_url === null) return fail(catalogId, 400, 'not_download');

  // 2〜3. 取得（リダイレクトは追わない）と上限つきの読み取り。本文の読み取り中の例外も同じ分類
  let buf: ArrayBuffer;
  try {
    const res = await fetchImpl(entry.download_url, {
      redirect: 'manual',
      headers: { accept: 'model/gltf-binary, */*' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return fail(catalogId, 502, `fetch_failed:${res.status}`);
    }
    const cl = res.headers.get('content-length');
    if (cl !== null && /^\d+$/.test(cl.trim()) && Number(cl.trim()) > MAX_MODEL3D_BYTES) {
      await res.body?.cancel().catch(() => {});
      return fail(catalogId, 413, 'too_large');
    }
    const got = await readCapped(res.body, MAX_MODEL3D_BYTES);
    if (got === 'too_large') return fail(catalogId, 413, 'too_large');
    buf = got;
  } catch (e) {
    return fail(catalogId, 502, fetchErrorCode(e));
  }

  // 4. 形の検査
  const ins = inspectGlb(buf);
  if (!ins.ok) return fail(catalogId, 422, `bad_glb:${ins.reason}`, buf.byteLength);

  // 5. sha256。既存行と同じ sha で object もあれば書かない（無ければ欠けた object の修復として 6 へ）
  const sha = hex(await crypto.subtle.digest('SHA-256', buf));
  const key = R2_KEY(entry.id, sha);
  const bytes = buf.byteLength;
  const cur = await first<{ sha256: string }>(c.env.DB, stmt('SELECT sha256 FROM models3d_files WHERE catalog_id = ?', entry.id));
  if (cur?.sha256 === sha && (await c.env.R2.head(key))) {
    logFetch(entry.id, 'unchanged', bytes);
    return json(200, { status: 'unchanged', catalog_id: entry.id, sha256: sha, bytes });
  }

  // 6. put → upsert（古い sha の object は消さない）
  await c.env.R2.put(key, buf, { httpMetadata: { contentType: 'model/gltf-binary' }, sha256: sha });
  await c.env.DB.prepare(
    `INSERT INTO models3d_files (catalog_id, sha256, bytes, r2_key, draco, fetched_at, fetched_by) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(catalog_id) DO UPDATE SET sha256 = excluded.sha256, bytes = excluded.bytes, r2_key = excluded.r2_key, draco = excluded.draco,
       fetched_at = excluded.fetched_at, fetched_by = excluded.fetched_by`,
  )
    .bind(entry.id, sha, bytes, key, ins.draco ? 1 : 0, nowIso(), c.email)
    .run();
  logFetch(entry.id, 'fetched', bytes);
  return json(200, { status: 'fetched', catalog_id: entry.id, sha256: sha, bytes, draco: ins.draco });
}

type Model3dState = 'embed' | 'hosted' | 'hosted_missing' | 'not_hosted' | 'unavailable';

/**
 * GET /api/models3d（§AJ2-2。Access の中・管理のページ用）。一覧の全件を一覧の順に、状態つきで。
 * hosted / hosted_missing の件は env.R2.head(key) の結果 object_ok を付ける（行は数件なので head は数回）
 */
export async function listModels3d(c: RouteCtx): Promise<Response> {
  const rows = new Map((await models3dFileRows(c.env.DB)).map((r) => [r.catalog_id, r]));
  const models: Array<Record<string, unknown>> = [];
  for (const e of MODELS3D) {
    const base = { id: e.id, title: e.title_ja, org: e.org, kind: e.kind, license: e.license.label, page_url: e.page_url, has_download_url: e.download_url !== null };
    if (isEmbeddableModel3d(e)) {
      models.push({ ...base, state: 'embed' satisfies Model3dState });
      continue;
    }
    const row = e.kind === 'download' ? rows.get(e.id) : undefined;
    if (row) {
      const objectOk = !!(await c.env.R2.head(R2_KEY(e.id, row.sha256)));
      models.push({
        ...base,
        state: (objectOk ? 'hosted' : 'hosted_missing') satisfies Model3dState,
        bytes: Number(row.bytes),
        sha256: row.sha256,
        fetched_at: String(row.fetched_at),
        object_ok: objectOk,
      });
      continue;
    }
    models.push({ ...base, state: (e.download_url !== null ? 'not_hosted' : 'unavailable') satisfies Model3dState });
  }
  return json(200, { models });
}
