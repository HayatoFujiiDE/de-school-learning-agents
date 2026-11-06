// 振り返り係（改善係）の運営 API（契約 §S-5 4・5）。認可は他の運営 API と同じ（Access + Origin。src/index.ts）。
// LLM が書いた文（summary・evidence・text・reason）は検査済みの値だけを返す。画面は esc() して出す。

import { all, cas, first, getSetting, nowIso, stmt } from '../db';
import { cfg } from '../env';
import { json, parseJsonField, readBody, type RouteCtx } from '../http';
import { monthCostCents } from '../ledger';
import { autoAdoptBlocked, compareRecent, jobsFinishedSince, RETRO_LIMITS, type RetroOutput, type TipRow } from '../retro';

const TIP_STATUSES = ['active', 'proposed', 'retired', 'rejected'] as const;
/** 一覧に出す件数 */
const LIST_LIMIT = { retros: 20, tipsPerStatus: 50, events: 100, reviewScan: 50 } as const;

interface RetroListRow {
  job_id: string;
  material_id: string;
  status: string;
  cents: number;
  last_error: string | null;
  result_json: string | null;
  created_at: string;
  updated_at: string;
  title: string | null;
  list_cost_cents: number | null;
  job_kind: string | null;
}

type TipView = TipRow & {
  material_title: string | null;
  jobs_since?: number;
  retire_suggested?: { reason: string; job_id: string; at: string } | null;
  /** 自動で入れる前の機械的な検査（autoAdoptBlocked）に当たったか。画面に「自動では入れませんでした」と出す */
  auto_blocked?: boolean;
};

const resultOf = (s: string | null): (RetroOutput & { applied?: Array<{ tip_id: string; status: string; target: string }>; retired?: string[] }) | null =>
  parseJsonField(s, null);

export async function getRetro(c: RouteCtx): Promise<Response> {
  const db = c.env.DB;
  const rows = await all<RetroListRow>(
    db,
    stmt(
      `SELECT r.job_id, r.material_id, r.status, r.cents, r.last_error, r.result_json, r.created_at, r.updated_at,
              m.title AS title, j.list_cost_cents AS list_cost_cents, j.kind AS job_kind
       FROM job_retros r LEFT JOIN materials m ON m.id = r.material_id LEFT JOIN factory_jobs j ON j.id = r.job_id
       ORDER BY r.created_at DESC LIMIT ?`,
      LIST_LIMIT.retros,
    ),
  );
  const retros = rows.map((r) => {
    const out = resultOf(r.result_json);
    return {
      job_id: r.job_id,
      material_id: r.material_id,
      material_title: r.title,
      job_kind: r.job_kind,
      list_cost_cents: Number(r.list_cost_cents ?? 0),
      status: r.status,
      cents: Number(r.cents ?? 0),
      last_error: r.last_error,
      summary: out?.summary ?? null,
      wastes: out?.wastes ?? [],
      tips_added: (out?.applied ?? []).length,
      created_at: r.created_at,
      updated_at: r.updated_at,
    };
  });

  // 人が入れた工夫への「やめる提案」（直近の振り返りの tip_reviews の retire）
  const reviewed = await all<{ job_id: string; result_json: string | null; updated_at: string }>(
    db,
    stmt("SELECT job_id, result_json, updated_at FROM job_retros WHERE status = 'ended' ORDER BY updated_at DESC LIMIT ?", LIST_LIMIT.reviewScan),
  );
  const retireSuggested = new Map<string, { reason: string; job_id: string; at: string }>();
  for (const r of reviewed) {
    for (const tr of resultOf(r.result_json)?.tip_reviews ?? []) {
      if (tr.verdict === 'retire' && !retireSuggested.has(tr.tip_id)) retireSuggested.set(tr.tip_id, { reason: tr.reason, job_id: r.job_id, at: r.updated_at });
    }
  }

  const tips: Record<string, TipView[]> = {};
  for (const s of TIP_STATUSES) {
    const order = s === 'active' ? 'activated_at ASC, t.created_at ASC' : s === 'retired' ? 'retired_at DESC' : 't.created_at DESC';
    const list = await all<TipView>(
      db,
      stmt(
        `SELECT t.*, m.title AS material_title FROM retro_tips t LEFT JOIN factory_jobs j ON j.id = t.job_id LEFT JOIN materials m ON m.id = j.material_id
         WHERE t.status = ? ORDER BY ${order} LIMIT ?`,
        s,
        LIST_LIMIT.tipsPerStatus,
      ),
    );
    for (const t of list) t.auto_blocked = autoAdoptBlocked(t.text);
    if (s === 'active') {
      for (const t of list) {
        t.jobs_since = t.activated_at ? await jobsFinishedSince(db, t.activated_at) : 0;
        t.retire_suggested = retireSuggested.get(t.id) ?? null;
      }
    }
    tips[s] = list;
  }

  // できごとの記録（新しい順）: 工夫を入れた / やめた / 提案 / 見送った / 各注文の振り返り
  const tipLog = await all<TipView>(
    db,
    stmt(
      `SELECT t.*, m.title AS material_title FROM retro_tips t LEFT JOIN factory_jobs j ON j.id = t.job_id LEFT JOIN materials m ON m.id = j.material_id
       ORDER BY t.updated_at DESC LIMIT ?`,
      LIST_LIMIT.events,
    ),
  );
  const events: Array<Record<string, unknown>> = [];
  for (const t of tipLog) {
    const base = { tip_id: t.id, auto_blocked: autoAdoptBlocked(t.text), target: t.target, text: t.text, reason: t.reason, expected_saving_cents: t.expected_saving_cents, quality_risk: t.quality_risk, job_id: t.job_id, material_title: t.material_title, status: t.status, decided_by: t.decided_by };
    if (t.activated_at) events.push({ type: 'activated', at: t.activated_at, ...base });
    if (t.retired_at) events.push({ type: 'retired', at: t.retired_at, retire_reason: t.retire_reason, ...base });
    if (t.status === 'rejected') events.push({ type: 'rejected', at: t.updated_at, ...base });
    if (t.decided_by !== 'auto') events.push({ type: 'proposed', at: t.created_at, ...base });
  }
  for (const r of retros) {
    if (r.status === 'ended') events.push({ type: 'retro', at: r.updated_at, job_id: r.job_id, material_title: r.material_title, list_cost_cents: r.list_cost_cents, cents: r.cents, summary: r.summary, wastes: r.wastes, tips_added: r.tips_added });
  }
  events.sort((a, b) => (String(a.at) < String(b.at) ? 1 : String(a.at) > String(b.at) ? -1 : 0));

  return json(200, {
    settings: {
      enabled: (await getSetting(db, 'retro_enabled')) !== '0',
      auto_adopt: (await getSetting(db, 'retro_auto_adopt')) !== '0',
      month_cents: await monthCostCents(db, 'retro'),
      month_cap_cents: cfg(c.env).retroMonthlyCents,
      day_limit: RETRO_LIMITS.dayCount,
      active_maker_note_limit: RETRO_LIMITS.activeMakerNotes,
    },
    compare: { ...(await compareRecent(db)), window: 10 },
    retros,
    tips,
    events: events.slice(0, LIST_LIMIT.events),
  });
}

const ACTIONS = ['activate', 'retire', 'reject'] as const;

/** POST /api/retro/tips/:id {action}（§S-5 4）。proposed → active（human）/ rejected、active → retired。CAS */
export async function decideRetroTip(c: RouteCtx, id: string): Promise<Response> {
  const db = c.env.DB;
  const b = await readBody(c.request, 4 * 1024);
  if (!b || !(ACTIONS as readonly unknown[]).includes(b.action)) return json(400, { error: 'bad_request' });
  const action = b.action as (typeof ACTIONS)[number];
  const row = await first<TipRow>(db, stmt('SELECT * FROM retro_tips WHERE id = ?', id));
  if (!row) return json(404, { error: 'not_found' });
  const t = nowIso();
  let ok = false;
  if (action === 'activate') {
    if (row.status !== 'proposed') return json(409, { error: 'state_conflict' });
    // maker_note は active が 8 件の時は入れない（数えるのも同じ文の中）。maker_note 以外の active は「人が対応した」の印（職人へは渡らない）
    ok = await cas(
      db,
      stmt(
        `UPDATE retro_tips SET status = 'active', decided_by = 'human', activated_at = ?, updated_at = ?
         WHERE id = ? AND status = 'proposed'
           AND (target <> 'maker_note' OR (SELECT COUNT(*) FROM retro_tips a WHERE a.status = 'active' AND a.target = 'maker_note') < ?)`,
        t,
        t,
        id,
        RETRO_LIMITS.activeMakerNotes,
      ),
    );
    if (!ok) {
      const now = await first<{ status: string }>(db, stmt('SELECT status FROM retro_tips WHERE id = ?', id));
      if (now?.status === 'proposed' && row.target === 'maker_note') return json(409, { error: 'too_many_active' });
      return json(409, { error: 'state_conflict' });
    }
  } else if (action === 'reject') {
    if (row.status !== 'proposed') return json(409, { error: 'state_conflict' });
    ok = await cas(db, stmt("UPDATE retro_tips SET status = 'rejected', decided_by = 'human', updated_at = ? WHERE id = ? AND status = 'proposed'", t, id));
  } else {
    if (row.status !== 'active') return json(409, { error: 'state_conflict' });
    ok = await cas(
      db,
      stmt("UPDATE retro_tips SET status = 'retired', retired_at = ?, retire_reason = 'human', updated_at = ? WHERE id = ? AND status = 'active'", t, t, id),
    );
  }
  if (!ok) return json(409, { error: 'state_conflict' });
  const tip = await first<TipRow>(db, stmt('SELECT * FROM retro_tips WHERE id = ?', id));
  console.log(JSON.stringify({ at: 'retro_tip', tip_id: id, action, status: tip?.status }));
  return json(200, { tip });
}
