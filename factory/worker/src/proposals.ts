// 提案箱（proposals）の行を作る SQL と、一覧の行の形（契約 §K-2, §K-3）。ルート・収集部隊・会議が共通に使う。

import { stmt, type SqlValue, type Stmt } from './db';
import type { ProposalValue } from './checks/intake';
import { parseJsonField } from './http';

export type SourceKind = 'child' | 'scout' | 'meeting' | 'manual';

export interface NewProposal {
  id: string;
  now: string;
  source_kind: SourceKind;
  source_ref: string | null;
  value: ProposalValue;
  /** 保存する本文（child は「足りなかったこと」をまとめた後の文） */
  body: string;
  priority?: number;
  supporter_checked?: boolean;
  /** 根拠 URL の取得時刻（無ければ now） */
  fetched_at?: string;
}

/**
 * proposals の INSERT。similar_count は挿入時に concept_codes か catalog_item_id が重なる既存提案の数（LLM なし）。
 * guard を渡すと `WHERE EXISTS (guard)` で条件付ける（§B-2 の条件付き batch の先頭に置く）。
 */
export function insertProposalStmt(p: NewProposal, guard?: Stmt): Stmt {
  const evidence = p.value.evidence.map((e) => ({ url: e.url, title: e.title, fetched_at: p.fetched_at ?? p.now, note: e.note }));
  const concepts = JSON.stringify(p.value.concept_codes);
  const params: SqlValue[] = [
    p.id,
    p.now,
    p.now,
    p.source_kind,
    p.source_ref,
    p.value.title,
    p.body,
    JSON.stringify(evidence),
    concepts,
    p.value.catalog_item_id,
    JSON.stringify(p.value.kinds),
    p.value.age_band,
    p.priority ?? 0,
    // similar_count
    p.value.catalog_item_id,
    p.value.catalog_item_id,
    concepts,
    p.supporter_checked ? 1 : 0,
  ];
  let sql = `INSERT INTO proposals (id, created_at, updated_at, source_kind, source_ref, title, body, evidence_json, concept_codes_json,
       catalog_item_id, kinds_json, age_band, priority, similar_count, status, supporter_checked)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
       (SELECT COUNT(*) FROM proposals sp WHERE (? IS NOT NULL AND sp.catalog_item_id = ?)
          OR EXISTS (SELECT 1 FROM json_each(sp.concept_codes_json) a WHERE a.value IN (SELECT value FROM json_each(?)))),
       'proposed', ?`;
  if (guard) {
    sql += ` WHERE EXISTS (${guard.sql})`;
    params.push(...guard.params);
  }
  return stmt(sql, ...params);
}

export const PROPOSAL_STATUSES = ['proposed', 'adopted', 'dismissed'] as const;

export const PROPOSAL_COLUMNS =
  'id, created_at, source_kind, title, body, evidence_json, concept_codes_json, catalog_item_id, kinds_json, age_band, priority, similar_count, status, supporter_checked, material_id, decided_at, decision_note';

/** 一覧の 1 行（§K-3 の出力の形）。source_ref は出さない（intake の supporter_email を画面に戻さない） */
export function proposalView(r: Record<string, unknown>): Record<string, unknown> {
  return {
    id: r.id,
    created_at: r.created_at,
    source_kind: r.source_kind,
    title: r.title,
    body: r.body,
    evidence: parseJsonField(r.evidence_json, []),
    concept_codes: parseJsonField(r.concept_codes_json, []),
    catalog_item_id: r.catalog_item_id ?? null,
    kinds: parseJsonField(r.kinds_json, []),
    age_band: r.age_band ?? null,
    priority: Number(r.priority ?? 0),
    similar_count: Number(r.similar_count ?? 0),
    status: r.status,
    supporter_checked: Number(r.supporter_checked ?? 0) === 1,
    material_id: r.material_id ?? null,
    decided_at: r.decided_at ?? null,
    decision_note: r.decision_note ?? null,
  };
}
