// 立体モデル v2 の取り込みと、管理のページ用の一覧（契約 §AJ2-2・§AK-4 5・§AK-5。Access の中）。
// §AK-4 5: 取り込みの route（POST /api/models3d/<id>/fetch）は廃止。取り込みは権利の確認（src/rights-check.ts の runRightsCheck）が
// 通った直後に、その確認の claim を持ったまま importModel3d を呼ぶ経路だけ。
// 取り込み元の url は一覧（factory/models3d/catalog.json）の download_url だけ（画面や API から url を受け取らない）。
// ログは 1 行の JSON（at: 'model3d_fetch', catalog_id, status, bytes）。url や本文はログに出さない。
import { first, nowIso, stmt } from '../db';
import type { Env } from '../env';
import { MODELS3D, type Model3dEntry } from '../generated/models3d-catalog';
import { json, type RouteCtx } from '../http';
import { isEmbeddableModel3d } from '../models3d';
import { inspectGlb, MAX_MODEL3D_BYTES, models3dFileRows, R2_KEY, readCapped } from '../models3d-file';
import { assetKey, licenseLabelOf, rightsModes, rightsReasonOf, subjectShasOf } from '../rights';
import { providerOf } from '../rights-providers';
import { lastRightsEvents, rightsRecordRows } from '../rights-store';

const FETCH_TIMEOUT_MS = 60_000;

const logFetch = (catalogId: string, status: string, bytes: number | null) =>
  console.log(JSON.stringify({ at: 'model3d_fetch', catalog_id: catalogId, status, bytes }));

const hex = (buf: ArrayBuffer): string => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** 例外の分類（AbortSignal.timeout は TimeoutError） */
const fetchErrorCode = (e: unknown): string => (e && typeof e === 'object' && (e as { name?: unknown }).name === 'TimeoutError' ? 'fetch_failed:timeout' : 'fetch_failed:network');

export type ImportOutcome =
  | { ok: true; status: 'fetched' | 'unchanged'; sha256: string; bytes: number; draco?: boolean }
  | { ok: false; error: string; http: number };

/**
 * §AJ2-2 の 2〜6（§AK-2 6 で関数に切り出し）。一覧の download_url から取り、形を検査して R2 に置き、D1 models3d_files に記録する。
 * fetched_by = by。2〜4 で落ちた時は D1 も R2 も書かない。put → upsert の順。古い sha の object は消さない。
 * 呼び出し側（runRightsCheck）は権利の確認が verified で host を許す時だけ、その確認の claim を持ったまま呼ぶ
 */
export async function importModel3d(env: Pick<Env, 'DB' | 'R2'>, e: Model3dEntry, by: string, fetchImpl: typeof fetch = fetch): Promise<ImportOutcome> {
  const fail = (http: number, error: string, bytes: number | null = null): ImportOutcome => {
    logFetch(e.id, error, bytes);
    return { ok: false, error, http };
  };
  if (e.kind !== 'download' || e.download_url === null) return fail(400, 'not_download');

  // 2〜3. 取得（リダイレクトは追わない）と上限つきの読み取り。本文の読み取り中の例外も同じ分類
  let buf: ArrayBuffer;
  try {
    const res = await fetchImpl(e.download_url, {
      redirect: 'manual',
      headers: { accept: 'model/gltf-binary, */*' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return fail(502, `fetch_failed:${res.status}`);
    }
    const cl = res.headers.get('content-length');
    if (cl !== null && /^\d+$/.test(cl.trim()) && Number(cl.trim()) > MAX_MODEL3D_BYTES) {
      await res.body?.cancel().catch(() => {});
      return fail(413, 'too_large');
    }
    const got = await readCapped(res.body, MAX_MODEL3D_BYTES);
    if (got === 'too_large') return fail(413, 'too_large');
    buf = got;
  } catch (err) {
    return fail(502, fetchErrorCode(err));
  }

  // 4. 形の検査
  const ins = inspectGlb(buf);
  if (!ins.ok) return fail(422, `bad_glb:${ins.reason}`, buf.byteLength);

  // 5. sha256。既存行と同じ sha で object もあれば書かない（無ければ欠けた object の修復として 6 へ）
  const sha = hex(await crypto.subtle.digest('SHA-256', buf));
  const key = R2_KEY(e.id, sha);
  const bytes = buf.byteLength;
  const cur = await first<{ sha256: string }>(env.DB, stmt('SELECT sha256 FROM models3d_files WHERE catalog_id = ?', e.id));
  if (cur?.sha256 === sha && (await env.R2.head(key))) {
    logFetch(e.id, 'unchanged', bytes);
    return { ok: true, status: 'unchanged', sha256: sha, bytes };
  }

  // 6. put → upsert（古い sha の object は消さない）
  await env.R2.put(key, buf, { httpMetadata: { contentType: 'model/gltf-binary' }, sha256: sha });
  await env.DB.prepare(
    `INSERT INTO models3d_files (catalog_id, sha256, bytes, r2_key, draco, fetched_at, fetched_by) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(catalog_id) DO UPDATE SET sha256 = excluded.sha256, bytes = excluded.bytes, r2_key = excluded.r2_key, draco = excluded.draco,
       fetched_at = excluded.fetched_at, fetched_by = excluded.fetched_by`,
  )
    .bind(e.id, sha, bytes, key, ins.draco ? 1 : 0, nowIso(), by)
    .run();
  logFetch(e.id, 'fetched', bytes);
  return { ok: true, status: 'fetched', sha256: sha, bytes, draco: ins.draco };
}

type Model3dState = 'embed' | 'hosted' | 'hosted_missing' | 'not_hosted' | 'unavailable';

/**
 * GET /api/models3d（§AJ2-2・§AK-5。Access の中・管理のページ用）。一覧の全件を一覧の順に、状態（state。§AJ2 のまま）と権利（rights）つきで。
 * hosted / hosted_missing の件は env.R2.head(key) の結果 object_ok を付ける（行は数件なので head は数回）。
 * rights は行が無い項目で code: 'unknown'・status: null・record: 'none'（不正な行は record: 'invalid'）
 */
export async function listModels3d(c: RouteCtx): Promise<Response> {
  const rows = new Map((await models3dFileRows(c.env.DB)).map((r) => [r.catalog_id, r]));
  const records = await rightsRecordRows(c.env.DB);
  const subjects = await subjectShasOf(MODELS3D);
  const models: Array<Record<string, unknown>> = [];
  for (const e of MODELS3D) {
    const key = assetKey('models3d', e.id);
    const record = records.get(key);
    const subject = subjects.get(key);
    const ev = await lastRightsEvents(c.env.DB, key);
    const ok = record !== undefined && record !== 'invalid' ? record : null;
    const rights = {
      code: ok ? ok.license_code : 'unknown',
      label: ok ? licenseLabelOf(ok.license_code, ok.license_url) : licenseLabelOf('unknown', ''),
      license_url: ok ? ok.license_url : null,
      attribution: ok ? ok.attribution : null,
      evidence_kind: ok ? ok.evidence_kind : null,
      status: ok ? ok.status : null,
      blocked: ok ? ok.blocked : false,
      checked_at: ok ? ok.checked_at : null,
      last_attempt_at: ok ? ok.last_attempt_at : null,
      fail_code: ok ? ok.fail_code : null,
      check: providerOf(e).kind,
      modes: rightsModes(record, subject),
      record: record === undefined ? 'none' : record === 'invalid' ? 'invalid' : 'ok',
      reason: rightsReasonOf(record, e, subject),
      last_fail: ev.last_fail,
      last_import_fail: ev.last_import_fail,
    };
    const base = { id: e.id, title: e.title_ja, org: e.org, kind: e.kind, license: e.license.label, page_url: e.page_url, has_download_url: e.download_url !== null };
    if (isEmbeddableModel3d(e)) {
      models.push({ ...base, state: 'embed' satisfies Model3dState, rights });
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
        rights,
      });
      continue;
    }
    models.push({ ...base, state: (e.download_url !== null ? 'not_hosted' : 'unavailable') satisfies Model3dState, rights });
  }
  return json(200, { models });
}
