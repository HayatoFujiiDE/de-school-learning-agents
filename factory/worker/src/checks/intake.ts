// 純関数: 提案箱に入る本文の形式検査（契約 §K-6）。I/O を持たない。
// 返りは {ok:true, value} か {ok:false, error, field}。値そのものは error に入れない（子ども由来の本文を応答・ログへ戻さない）。

import { FORBIDDEN_WORDS } from './forbidden';

export type ProposalSource = 'manual' | 'child' | 'scout' | 'meeting';
export type AgeBand = 'elementary' | 'secondary' | 'both';

export const AGE_BANDS: readonly AgeBand[] = ['elementary', 'secondary', 'both'];

/** source ごとの許可キー。これ以外のキーが 1 つでもあれば forbidden_field */
export const ALLOWED_KEYS: Record<ProposalSource, readonly string[]> = {
  manual: ['title', 'body', 'concept_codes', 'catalog_item_id', 'kinds', 'age_band', 'evidence'],
  child: ['title', 'body', 'concept_codes', 'age_band', 'missing', 'supporter_checked', 'supporter_email'],
  scout: ['title', 'body', 'concept_codes', 'catalog_item_id', 'kinds', 'age_band', 'evidence'],
  meeting: ['title', 'body', 'concept_codes', 'catalog_item_id', 'kinds', 'age_band', 'evidence'],
};

/** §K-3 が名指しする子どもに関するキー（intake で特に拒否する。応答の field にそのまま出してよい既知の名前） */
export const CHILD_FORBIDDEN_KEYS: readonly string[] = ['child_id', 'name', 'child_name', 'student', 'conversation', 'transcript', 'log', 'photo'];

export const LIMITS = {
  title: 120,
  body: 2000,
  missing: 500,
  conceptCodes: 20,
  kinds: 8,
  evidence: 10,
  evidenceTitle: 200,
  evidenceNote: 500,
  url: 2000,
  email: 254,
} as const;

const CONCEPT_RE = /^[A-Z0-9]{2,12}$/;
const CATALOG_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;
/** 応答に返してよいキー名の形（未知のキー名でも、この形なら名前だけ返す。それ以外は field を null にする） */
const SAFE_KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;

export interface EvidenceItem {
  url: string;
  title: string | null;
  note: string | null;
}

export interface ProposalValue {
  title: string;
  body: string;
  concept_codes: string[];
  catalog_item_id: string | null;
  kinds: number[];
  age_band: AgeBand | null;
  evidence: EvidenceItem[];
  /** child のみ */
  missing?: string;
  /** child のみ */
  supporter_email?: string;
}

export type ProposalError =
  | 'invalid_body'
  | 'forbidden_field'
  | 'supporter_check_required'
  | 'invalid_field'
  | 'forbidden_word';

export type ProposalCheck = { ok: true; value: ProposalValue } | { ok: false; error: ProposalError; field: string | null };

const bad = (error: ProposalError, field: string | null): ProposalCheck => ({ ok: false, error, field });

/** 禁止語（§F-2 の 13 語）を含めば true。どの語かは返さない */
export function hasForbiddenWord(s: string): boolean {
  return FORBIDDEN_WORDS.some((w) => s.includes(w));
}

function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (t.length < 1 || t.length > max) return null;
  return t;
}

function optStr(v: unknown, max: number): string | null | undefined {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  if (t.length === 0) return null;
  return t.length > max ? undefined : t;
}

/**
 * 提案の入力を検査する（§K-6）。
 * child は 1) 許可キー以外を値を読まずに拒否 → 2) supporter_checked === true → 3) 各 field、の順に見る。
 */
export function validateProposalInput(body: unknown, opts: { source: ProposalSource }): ProposalCheck {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return bad('invalid_body', null);
  const b = body as Record<string, unknown>;
  const allowed = ALLOWED_KEYS[opts.source];

  // 1. 許可キー以外（値は読まない）
  for (const k of Object.keys(b)) {
    if (!allowed.includes(k)) {
      const field = CHILD_FORBIDDEN_KEYS.includes(k) || SAFE_KEY_RE.test(k) ? k : null;
      return bad('forbidden_field', field);
    }
  }

  // 2. 支援者の確認（child のみ）
  if (opts.source === 'child' && b.supporter_checked !== true) return bad('supporter_check_required', 'supporter_checked');

  // 3. 各 field
  const title = str(b.title, LIMITS.title);
  if (title === null) return bad('invalid_field', 'title');
  const text = str(b.body, LIMITS.body);
  if (text === null) return bad('invalid_field', 'body');

  let concept_codes: string[] = [];
  if (b.concept_codes !== undefined && b.concept_codes !== null) {
    if (!Array.isArray(b.concept_codes) || b.concept_codes.length > LIMITS.conceptCodes) return bad('invalid_field', 'concept_codes');
    if (!b.concept_codes.every((c) => typeof c === 'string' && CONCEPT_RE.test(c))) return bad('invalid_field', 'concept_codes');
    concept_codes = [...new Set(b.concept_codes as string[])];
  }

  let catalog_item_id: string | null = null;
  if (allowed.includes('catalog_item_id') && b.catalog_item_id !== undefined && b.catalog_item_id !== null && b.catalog_item_id !== '') {
    if (typeof b.catalog_item_id !== 'string' || !CATALOG_RE.test(b.catalog_item_id)) return bad('invalid_field', 'catalog_item_id');
    catalog_item_id = b.catalog_item_id;
  }

  let kinds: number[] = [];
  if (allowed.includes('kinds') && b.kinds !== undefined && b.kinds !== null) {
    if (!Array.isArray(b.kinds) || b.kinds.length > LIMITS.kinds) return bad('invalid_field', 'kinds');
    if (!b.kinds.every((k) => Number.isInteger(k) && (k as number) >= 1 && (k as number) <= 8)) return bad('invalid_field', 'kinds');
    kinds = [...new Set(b.kinds as number[])].sort((x, y) => x - y);
  }

  let age_band: AgeBand | null = null;
  if (b.age_band !== undefined && b.age_band !== null) {
    if (typeof b.age_band !== 'string' || !AGE_BANDS.includes(b.age_band as AgeBand)) return bad('invalid_field', 'age_band');
    age_band = b.age_band as AgeBand;
  }
  if (opts.source === 'child' && age_band === null) return bad('invalid_field', 'age_band');

  const evidence: EvidenceItem[] = [];
  if (allowed.includes('evidence') && b.evidence !== undefined && b.evidence !== null) {
    if (!Array.isArray(b.evidence) || b.evidence.length > LIMITS.evidence) return bad('invalid_field', 'evidence');
    for (const e of b.evidence) {
      if (!e || typeof e !== 'object' || Array.isArray(e)) return bad('invalid_field', 'evidence');
      const o = e as Record<string, unknown>;
      if (Object.keys(o).some((k) => !['url', 'title', 'note'].includes(k))) return bad('invalid_field', 'evidence');
      if (typeof o.url !== 'string' || o.url.length > LIMITS.url || !isHttpsUrl(o.url)) return bad('invalid_field', 'evidence');
      const et = optStr(o.title, LIMITS.evidenceTitle);
      const en = optStr(o.note, LIMITS.evidenceNote);
      if (et === undefined || en === undefined) return bad('invalid_field', 'evidence');
      evidence.push({ url: o.url, title: et, note: en });
    }
  }

  const value: ProposalValue = { title, body: text, concept_codes, catalog_item_id, kinds, age_band, evidence };

  if (opts.source === 'child') {
    const missing = str(b.missing, LIMITS.missing);
    if (missing === null) return bad('invalid_field', 'missing');
    const email = b.supporter_email;
    if (typeof email !== 'string' || !email.includes('@') || email.length > LIMITS.email || /\s/.test(email)) return bad('invalid_field', 'supporter_email');
    value.missing = missing;
    value.supporter_email = email;
    if (hasForbiddenWord(missing)) return bad('forbidden_word', 'missing');
  }

  // 禁止語（§F-2 の 13 語）は title / body にあれば拒否
  if (hasForbiddenWord(title)) return bad('forbidden_word', 'title');
  if (hasForbiddenWord(text)) return bad('forbidden_word', 'body');

  return { ok: true, value };
}

export function isHttpsUrl(s: string): boolean {
  if (!/^https:\/\/[^\s]+$/.test(s)) return false;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' && !!u.hostname && !u.username && !u.password;
  } catch {
    return false;
  }
}

/** child の body は「本文 + 足りなかったこと」を 1 つの提案文にまとめて保存する（合計 2000 文字まで） */
export function composeChildBody(v: ProposalValue): string | null {
  const s = `${v.body}\n\n足りなかったこと: ${v.missing ?? ''}`;
  return s.length <= LIMITS.body ? s : null;
}

/**
 * LLM（収集部隊・会議）の出力 1 件を提案の入力に整えてから検査する。
 * 長すぎる title/body は切り、形の合わない concept_codes・kinds・非 https の根拠 URL は落とす。禁止語を含めば null（入れない）。
 */
export function sanitizeLlmProposal(raw: Record<string, unknown>, source: 'scout' | 'meeting'): ProposalValue | null {
  const s = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const concepts = Array.isArray(raw.concept_codes) ? raw.concept_codes.filter((c): c is string => typeof c === 'string' && CONCEPT_RE.test(c)).slice(0, LIMITS.conceptCodes) : [];
  const kinds = Array.isArray(raw.kinds) ? raw.kinds.filter((k): k is number => Number.isInteger(k) && (k as number) >= 1 && (k as number) <= 8).slice(0, LIMITS.kinds) : [];
  const evidence = Array.isArray(raw.evidence)
    ? raw.evidence
        .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object' && typeof (e as { url?: unknown }).url === 'string' && isHttpsUrl((e as { url: string }).url) && (e as { url: string }).url.length <= LIMITS.url)
        .slice(0, LIMITS.evidence)
        .map((e) => ({ url: e.url as string, title: s(e.title, LIMITS.evidenceTitle) || null, note: s(e.note, LIMITS.evidenceNote) || null }))
    : [];
  const age = typeof raw.age_band === 'string' && AGE_BANDS.includes(raw.age_band as AgeBand) ? raw.age_band : null;
  const r = validateProposalInput(
    { title: s(raw.title, LIMITS.title), body: s(raw.body, LIMITS.body), concept_codes: concepts, kinds, age_band: age, evidence },
    { source },
  );
  return r.ok ? r.value : null;
}
