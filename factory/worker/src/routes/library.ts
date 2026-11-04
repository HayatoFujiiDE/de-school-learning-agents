// 配信（一方向・認証なし）。契約 §B-7。子どもを表す列・パラメータはこの API に存在しない。
// 配信条件（available かつ current_version が approved）は SQL の JOIN / WHERE で表現する。
import { all, first, stmt } from '../db';
import type { Env } from '../env';
import { json, parseJsonField } from '../http';

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
