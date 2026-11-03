// /api/standards（契約 §B-3）。静的な編集基準 + standards_log（新しい順）
import { all, nowIso, prepare, stmt } from '../db';
import { EDITORIAL_STANDARDS } from '../generated/claude-assets';
import { isNonEmptyString, json, readBody, type RouteCtx } from '../http';

export async function getStandards(c: RouteCtx): Promise<Response> {
  const log = await all(
    c.env.DB,
    stmt('SELECT id, material_id, job_id, kind, question, answer, created_at FROM standards_log ORDER BY created_at DESC LIMIT 500'),
  );
  return json(200, { static_md: EDITORIAL_STANDARDS, log });
}

export async function addStandard(c: RouteCtx): Promise<Response> {
  const b = await readBody(c.request);
  if (!b || !isNonEmptyString(b.text, 4000)) return json(400, { error: 'text_required' });
  const id = crypto.randomUUID();
  await prepare(
    c.env.DB,
    stmt("INSERT INTO standards_log (id, material_id, job_id, kind, question, answer, created_at) VALUES (?, NULL, NULL, 'note', NULL, ?, ?)", id, b.text, nowIso()),
  ).run();
  return json(201, { id });
}
