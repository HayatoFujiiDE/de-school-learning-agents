// 配信（一方向・認証なし）。契約 §B-7。子どもを表す列・パラメータはこの API に存在しない。
// 配信条件（available かつ current_version が approved）は SQL の JOIN / WHERE で表現する。
import { all, first, stmt, tokyoDay } from '../db';
import type { Env } from '../env';
import { json, parseJsonField } from '../http';
import { isRealDate } from '../topics/schema';
import { isTopicKind, topicsSwitch } from '../topics/store';
import { model3dViewOf, viewableModels3d } from '../models3d';
import { hostedModels3d, MODEL3D_CATALOG_ID_RE, R2_KEY, SHA256_HEX_RE } from '../models3d-file';

const HTML_CSP = "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:";
const SVG_CSP = "sandbox; default-src 'none'; style-src 'unsafe-inline'";
/** §M-3: png / webp（中身は取り込み時に先頭バイトで検査済み §M-2） */
const IMAGE_CSP = "default-src 'none'; sandbox";

/** URL の生 pathname から取り出した相対パスを検査する（`..`・`%`・先頭 `/`・空セグメントは不可） */
export function safeRequestPath(raw: string): string | null {
  if (!raw || raw.includes('%') || raw.includes('..') || raw.startsWith('/') || raw.includes('\\')) return null;
  const segs = raw.split('/');
  if (segs.some((s) => s.length === 0)) return null;
  return raw;
}

function contentHeaders(path: string): Record<string, string> | null {
  const base = { 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' };
  if (path.endsWith('.md')) return { ...base, 'content-type': 'text/markdown; charset=utf-8' };
  if (path.endsWith('.json')) return { ...base, 'content-type': 'application/json' };
  if (path.endsWith('.html')) return { ...base, 'content-type': 'text/html; charset=utf-8', 'content-security-policy': HTML_CSP };
  if (path.endsWith('.svg')) return { ...base, 'content-type': 'image/svg+xml', 'content-security-policy': SVG_CSP };
  if (path.endsWith('.png')) return { ...base, 'content-type': 'image/png', 'content-security-policy': IMAGE_CSP };
  if (path.endsWith('.webp')) return { ...base, 'content-type': 'image/webp', 'content-security-policy': IMAGE_CSP };
  return null;
}

const notFound = () => json(404, { error: 'not_found' });

/** manifest（public_paths_json）に完全一致するパスだけ R2 から返す。確認画面の files も同じ関数を使う */
export async function serveVersionFile(env: Env, row: { r2_prefix: string; public_paths_json: string } | null, rawPath: string): Promise<Response> {
  if (!row) return notFound();
  const path = safeRequestPath(rawPath);
  if (!path) return notFound();
  const manifest = parseJsonField<string[]>(row.public_paths_json, []);
  if (!manifest.includes(path)) return notFound();
  const headers = contentHeaders(path);
  if (!headers) return notFound();
  const obj = await env.R2.get(row.r2_prefix + path);
  if (!obj) return notFound();
  return new Response(obj.body, { status: 200, headers });
}

export async function libraryFile(env: Env, versionId: string, rawPath: string): Promise<Response> {
  const row = await first<{ r2_prefix: string; public_paths_json: string }>(
    env.DB,
    stmt(
      `SELECT v.r2_prefix, v.public_paths_json
       FROM materials m JOIN material_versions v ON v.id = m.current_version_id AND v.status = 'approved'
       WHERE m.publish_status = 'available' AND v.id = ?`,
      versionId,
    ),
  );
  return serveVersionFile(env, row, rawPath);
}

export async function libraryAvailable(env: Env): Promise<Response> {
  const rows = await all<Record<string, unknown>>(
    env.DB,
    stmt(
      `SELECT m.id AS material_id, m.slug, m.title, m.kinds_json, m.catalog_item_id, m.concept_codes_json,
              v.id AS version_id, v.version, v.material_json,
              (SELECT MAX(d.created_at) FROM review_decisions d WHERE d.material_version_id = v.id AND d.decision IN ('approve','rollback')) AS approved_at
       FROM materials m JOIN material_versions v ON v.id = m.current_version_id AND v.status = 'approved'
       WHERE m.publish_status = 'available'
       ORDER BY m.updated_at DESC`,
    ),
  );
  const materials = rows.map((r) => {
    const vid = r.version_id as string;
    const url = (p: string) => `/api/library/files/${vid}/${p}`;
    const mj = parseJsonField<Record<string, unknown>>(r.material_json, {});
    const parts = Array.isArray(mj.parts) ? (mj.parts as Array<Record<string, unknown>>) : [];
    return {
      material_id: r.material_id,
      slug: r.slug,
      title: r.title,
      version: r.version,
      version_id: vid,
      kinds: parseJsonField(r.kinds_json, []),
      catalog_item_id: r.catalog_item_id,
      concept_codes: parseJsonField(r.concept_codes_json, []),
      summary_elementary: mj.summary_elementary ?? null,
      summary_secondary: mj.summary_secondary ?? null,
      parts: parts.map((p) => ({
        id: p.id,
        kind: p.kind,
        title: p.title,
        entry_point: p.entry_point ?? null,
        variants: (Array.isArray(p.variants) ? (p.variants as Array<Record<string, unknown>>) : []).map((v) => ({
          audience: v.audience,
          length: v.length,
          interest: v.interest ?? null,
          game: v.game === true,
          url: url(String(v.path)),
        })),
        files: (Array.isArray(p.files) ? (p.files as Array<Record<string, unknown>>) : []).map((f) => ({ role: f.role ?? 'file', url: url(String(f.path)) })),
        adjustable: Array.isArray(p.adjustable) ? p.adjustable : [],
        needs_supporter_check: p.needs_supporter_check === true,
      })),
      claims_url: url('claims.json'),
      adapt_rules_url: url('adapt-rules.md'),
      conditions: mj.conditions ?? null,
      license_summary: mj.license_summary ?? null,
      approved_at: r.approved_at ?? null,
    };
  });
  return json(200, { materials });
}

// ---------------------------------------------------------------------------------------------
// お題の配信（contract-T T-8。認証なし・no-store。子どもを表す引数・項目なし。読むのは day / kind / limit だけ）

const TOPIC_KIND_ORDER = `CASE s.kind WHEN 'news' THEN 1 WHEN 'talk' THEN 2 WHEN 'philo' THEN 3 WHEN 'make' THEN 4 ELSE 5 END`;

async function topicsOn(env: Env): Promise<boolean> {
  return (await topicsSwitch(env.DB)) === true;
}

/** GET /api/library/topics?day=YYYY-MM-DD（省略は今日。実在しない日付・今日より後は 400）。予定の行のうち、読む時点で ready のものだけ */
export async function libraryTopics(env: Env, url: URL): Promise<Response> {
  const today = tokyoDay();
  const day = url.searchParams.get('day') || today;
  if (!isRealDate(day) || day > today) return json(400, { error: 'bad_day' });
  if (!(await topicsOn(env))) return json(200, { day, topics: [] });
  const rows = await all<{ topic_id: string; kind: string; pos: number; lineage_id: string; sensitivity: string; body_json: string }>(
    env.DB,
    stmt(
      `SELECT t.id AS topic_id, s.kind, s.pos, s.lineage_id, t.sensitivity, t.body_json
       FROM topic_schedule s JOIN topics t ON t.id = s.topic_id
       WHERE s.day = ? AND t.status = 'ready'
       ORDER BY ${TOPIC_KIND_ORDER}, s.pos`,
      day,
    ),
  );
  return json(200, {
    day,
    topics: rows.map((r) => ({ topic_id: r.topic_id, kind: r.kind, pos: Number(r.pos), needs_supporter: r.sensitivity === 'heavy', lineage_id: r.lineage_id, body: parseJsonField(r.body_json, null) })),
  });
}

/** GET /api/library/topics/stock?kind=&limit=（kind は 4 種のどれか。limit 1〜50、既定 20。範囲外は 400）→ evergreen = 1 の ready を新しい順に */
export async function libraryTopicStock(env: Env, url: URL): Promise<Response> {
  const kind = url.searchParams.get('kind');
  const raw = url.searchParams.get('limit');
  const limit = raw === null || raw === '' ? 20 : Number(raw);
  if (!isTopicKind(kind) || !Number.isInteger(limit) || limit < 1 || limit > 50) return json(400, { error: 'bad_query' });
  if (!(await topicsOn(env))) return json(200, { kind, topics: [] });
  const rows = await all<{ topic_id: string; kind: string; lineage_id: string; sensitivity: string; body_json: string }>(
    env.DB,
    stmt(
      `SELECT id AS topic_id, kind, lineage_id, sensitivity, body_json FROM topics WHERE kind = ? AND evergreen = 1 AND status = 'ready' ORDER BY created_at DESC, id DESC LIMIT ?`,
      kind,
      limit,
    ),
  );
  return json(200, {
    kind,
    topics: rows.map((r) => ({ topic_id: r.topic_id, kind: r.kind, needs_supporter: r.sensitivity === 'heavy', lineage_id: r.lineage_id, body: parseJsonField(r.body_json, null) })),
  });
}

/**
 * §AJ-5・§AJ2-0: GET /api/library/models3d（認証なし）。一覧のうち埋め込めるもの（sketchfab / voyager）と取り込み済みの download を一覧の順に。
 * download の件は v1 の 8 キーに file_url（絶対 url = origin + 配信パス。学習者のアプリは別オリジン）・bytes・sha256 を足した 11 キー。
 * 埋め込みの件は v1 のまま 8 キー。子ども向けアプリは material.json の catalog_id をこれで引いて描く
 */
export async function libraryModels3d(env: Env, origin: string): Promise<Response> {
  const hosted = await hostedModels3d(env);
  const models = viewableModels3d(new Set(hosted.keys())).map((e) => {
    const v = model3dViewOf(e, hosted.get(e.id));
    return v.file_url === undefined ? v : { ...v, file_url: origin + v.file_url };
  });
  return json(200, { models }, { 'cache-control': 'public, max-age=3600', 'access-control-allow-origin': '*' });
}

/**
 * §AJ2-0: GET /api/library/models3d/files/<catalog_id>/<sha256>.glb（認証なし）。D1 は見ない: 形が合えば key を組み立てて R2 から get し、無ければ 404。
 * 取り直しの後も古い sha の object は残るので、cache された一覧の url が取り直しの直後に死なない
 */
export async function libraryModel3dFile(env: Env, catalogId: string, sha: string): Promise<Response> {
  if (!MODEL3D_CATALOG_ID_RE.test(catalogId) || !SHA256_HEX_RE.test(sha)) return notFound();
  const obj = await env.R2.get(R2_KEY(catalogId, sha));
  if (!obj) return notFound();
  return new Response(obj.body, {
    status: 200,
    headers: {
      'content-type': 'model/gltf-binary',
      'content-length': String(obj.size),
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
      'access-control-allow-origin': '*',
    },
  });
}
