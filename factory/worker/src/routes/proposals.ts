// 提案箱と入口の手動起動（契約 §K-3）。認証は §B-1 と同じ（Access + Origin）。/api/intake だけ service token の common_name も受ける（index.ts）。
// publish_status と review_decisions には書かない（§B-6）。子ども由来の本文（intake）は応答・ログに出さない。

import { getFeedFetch } from '../anthropic';
import { composeChildBody, validateProposalInput, type ProposalCheck } from '../checks/intake';
import { all, cas, first, prepare, stmt } from '../db';
import { cfg } from '../env';
import { isNonEmptyString, json, parseJsonField, readBody, type RouteCtx } from '../http';
import { startMeeting } from '../meeting';
import { PROPOSAL_COLUMNS, PROPOSAL_STATUSES, insertProposalStmt, proposalView } from '../proposals';
import { runScout } from '../scout';
import { insertMaterial, parseNewMaterialBody, startAfterQueue } from './materials';

/** 手動起動の時間（§K-3: ctx.waitUntil でなく即時に行い 25 秒で打ち切る） */
const MANUAL_BUDGET_MS = 25_000;

function checkError(r: Extract<ProposalCheck, { ok: false }>): Response {
  if (r.error === 'forbidden_field') return json(400, { error: 'forbidden_field', field: r.field });
  if (r.error === 'supporter_check_required') return json(400, { error: 'supporter_check_required' });
  return json(400, { error: 'invalid_proposal', field: r.field, reason: r.error });
}

/** 最新の会議（ended）の ranked から proposal_id → 理由 */
async function meetingReasons(db: D1Database): Promise<Map<string, { reason: string; priority: number | null; meeting_id: string }>> {
  const m = await first<{ id: string; minutes_json: string | null }>(
    db,
    stmt("SELECT id, minutes_json FROM meeting_minutes WHERE status = 'ended' ORDER BY created_at DESC LIMIT 1"),
  );
  const out = new Map<string, { reason: string; priority: number | null; meeting_id: string }>();
  if (!m) return out;
  const minutes = parseJsonField<{ ranked?: Array<{ proposal_id?: string | null; reason?: string; priority?: number | null }> }>(m.minutes_json, {});
  for (const r of minutes.ranked ?? []) {
    if (r.proposal_id) out.set(r.proposal_id, { reason: String(r.reason ?? ''), priority: r.priority ?? null, meeting_id: m.id });
  }
  return out;
}

export async function listProposals(c: RouteCtx): Promise<Response> {
  const status = c.url.searchParams.get('status') ?? 'proposed';
  if (!(PROPOSAL_STATUSES as readonly string[]).includes(status)) return json(400, { error: 'invalid_status' });
  const rows = await all<Record<string, unknown>>(
    c.env.DB,
    stmt(`SELECT ${PROPOSAL_COLUMNS} FROM proposals WHERE status = ? ORDER BY created_at DESC LIMIT 200`, status),
  );
  const reasons = await meetingReasons(c.env.DB);
  return json(200, {
    proposals: rows.map((r) => {
      const m = reasons.get(r.id as string);
      return { ...proposalView(r), meeting_reason: m ? m.reason : null };
    }),
  });
}

/** POST /api/proposals（manual） */
export async function createProposal(c: RouteCtx): Promise<Response> {
  const b = await readBody(c.request, 64 * 1024);
  if (!b) return json(400, { error: 'invalid_json' });
  const r = validateProposalInput(b, { source: 'manual' });
  if (!r.ok) return checkError(r);
  const id = crypto.randomUUID();
  await prepare(c.env.DB, insertProposalStmt({ id, now: new Date().toISOString(), source_kind: 'manual', source_ref: c.email, value: r.value, body: r.value.body })).run();
  console.log(JSON.stringify({ at: 'proposal', id, source_kind: 'manual' }));
  return json(201, { id, status: 'proposed' });
}

/** POST /api/intake（バディ側の経路。画面からは呼ばない） */
export async function intake(c: RouteCtx): Promise<Response> {
  const b = await readBody(c.request, 16 * 1024);
  if (!b) return json(400, { error: 'invalid_json' });
  const r = validateProposalInput(b, { source: 'child' });
  if (!r.ok) return checkError(r);
  const body = composeChildBody(r.value);
  if (body === null) return json(400, { error: 'invalid_proposal', field: 'body', reason: 'too_long_with_missing' });
  const id = crypto.randomUUID();
  await prepare(
    c.env.DB,
    insertProposalStmt({ id, now: new Date().toISOString(), source_kind: 'child', source_ref: r.value.supporter_email ?? null, value: r.value, body, supporter_checked: true }),
  ).run();
  console.log(JSON.stringify({ at: 'proposal', id, source_kind: 'child' }));
  return json(201, { id, status: 'proposed' });
}

/** POST /api/proposals/:id/adopt — materials INSERT と proposals proposed→adopted を 1 batch（§B-2） */
export async function adoptProposal(c: RouteCtx, id: string): Promise<Response> {
  const p = await first<{ status: string }>(c.env.DB, stmt('SELECT status FROM proposals WHERE id = ?', id));
  if (!p) return json(404, { error: 'not_found' });
  if (p.status !== 'proposed') return json(409, { error: 'not_proposed' });
  const parsed = parseNewMaterialBody(await readBody(c.request));
  if (!parsed.ok) return parsed.response;
  const q = await insertMaterial(c.env.DB, parsed.input, {
    budget_cents: cfg(c.env).budgetDraftCents,
    guard: {
      proposal_id: id,
      exists: stmt("SELECT 1 FROM proposals gp WHERE gp.id = ? AND gp.status = 'proposed'", id),
      last: (ids) =>
        stmt(
          "UPDATE proposals SET status = 'adopted', decided_by = ?, decided_at = ?, material_id = ?, updated_at = ? WHERE id = ? AND status = 'proposed'",
          c.email,
          ids.now,
          ids.material_id,
          ids.now,
          id,
        ),
      conflict: 'not_proposed',
    },
  });
  if (q.status === 201) console.log(JSON.stringify({ at: 'adopt', proposal_id: id, material_id: q.body.material_id }));
  return startAfterQueue(c, q);
}

/** POST /api/proposals/:id/dismiss — proposed → dismissed（理由必須） */
export async function dismissProposal(c: RouteCtx, id: string): Promise<Response> {
  const b = await readBody(c.request);
  if (!b || !isNonEmptyString(b.note, 2000)) return json(400, { error: 'note_required' });
  const now = new Date().toISOString();
  const okCas = await cas(
    c.env.DB,
    stmt(
      "UPDATE proposals SET status = 'dismissed', decided_by = ?, decided_at = ?, decision_note = ?, updated_at = ? WHERE id = ? AND status = 'proposed'",
      c.email,
      now,
      b.note.trim(),
      now,
      id,
    ),
  );
  if (!okCas) {
    const p = await first(c.env.DB, stmt('SELECT 1 AS x FROM proposals WHERE id = ?', id));
    return p ? json(409, { error: 'not_proposed' }) : json(404, { error: 'not_found' });
  }
  console.log(JSON.stringify({ at: 'dismiss', proposal_id: id }));
  return json(200, { id, status: 'dismissed' });
}

/** POST /api/scout/run — 手動起動（25 秒で打ち切り。残りは次の定期） */
export async function runScoutRoute(c: RouteCtx): Promise<Response> {
  const fetchImpl = await getFeedFetch(c.env, { hostname: c.url.hostname });
  const r = await runScout(c.env, await c.port(), { trigger: 'manual', deadline: Date.now() + MANUAL_BUDGET_MS, fetchImpl });
  if (r.status === 'paused') return json(409, { error: 'paused' });
  if (r.status === 'already_running') return json(409, { error: 'already_running' });
  if (r.status === 'skipped') return json(200, { skipped: 'cap', reason: r.reason, run_id: r.run_id });
  return json(200, r);
}

/** POST /api/meeting/run — 手動起動 */
export async function runMeetingRoute(c: RouteCtx): Promise<Response> {
  const r = await startMeeting(c.env, await c.port(), { trigger: 'manual', deadline: Date.now() + MANUAL_BUDGET_MS });
  if (r.status === 'paused') return json(409, { error: 'paused' });
  if (r.status === 'already_submitted') return json(409, { error: 'already_submitted' });
  if (r.status === 'skipped') return json(200, { skipped: 'cap', reason: r.reason });
  if (r.status === 'failed') return json(502, { error: 'anthropic_error', message: r.error, meeting_id: r.meeting_id });
  return json(201, r);
}

/** GET /api/meeting/latest — 最新の会議（4 視点・ranked・standards_suggestions）。画面に出すだけ（§K-5-5） */
export async function latestMeeting(c: RouteCtx): Promise<Response> {
  const m = await first<Record<string, unknown>>(
    c.env.DB,
    stmt("SELECT id, created_at, updated_at, status, minutes_json, proposed, cents FROM meeting_minutes WHERE status = 'ended' ORDER BY created_at DESC LIMIT 1"),
  );
  if (!m) return json(200, { meeting: null });
  return json(200, {
    meeting: { id: m.id, created_at: m.created_at, ended_at: m.updated_at, proposed: m.proposed, cents: m.cents, minutes: parseJsonField(m.minutes_json, null) },
  });
}
