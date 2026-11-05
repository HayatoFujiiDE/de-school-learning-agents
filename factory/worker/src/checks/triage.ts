// 確認の仕分け（契約 §L-3）。純関数 triageVersion(input)。
// 「怪しいところだけ人に出す」ため、claim × 出典の問題を (source_id, cause) ごとの group にまとめ、
// 6 項目のうち機械で決められる 3 項目（内容と根拠・利用条件・生成物の動作）の自動 OK と、自動の処置（none / auto_return / reverify）を決める。
// 入力（claims_json / result_json / material_json / 出典 id）は職人・検証係が書いた信頼できない値なので、キー照合は Map / Set で行う（継承プロパティを踏まない）。
// §Q-11 9: 動画の出典（版の動画の source_id が指す行で、url がその動画の watch URL と一致するもの）は、maker_url_not_fetched・quote_mismatch の原因と
// quote_mismatch_many の集計（分子・分母）から外す。動画でない出典の検査は変えない。

import { videoSourceIds } from './citations';
import { versionVideosOfMaterial } from '../videos';

export type Cause =
  | 'contradicted'
  | 'source_not_listed'
  | 'maker_url_not_fetched'
  | 'quote_mismatch'
  | 'verifier_limit'
  | 'not_confirmed'
  | 'no_source'
  | 'license_unknown';

export type Reason = 'contradicted' | 'few_confirmed' | 'quote_mismatch_many';
export type AutoItem = 'content_and_evidence' | 'terms_of_use' | 'artifact_behavior';
export const AUTO_ITEMS: readonly AutoItem[] = ['content_and_evidence', 'terms_of_use', 'artifact_behavior'];

/** 原因の文（§L-6 の表。verbatim） */
export const CAUSE_TEXT: Record<Cause, string> = {
  contradicted: '出典と食い違う',
  source_not_listed: '出典一覧にない出典',
  maker_url_not_fetched: '職人がこの URL を開けていない',
  quote_mismatch: '引用が出典の本文と一致しない',
  verifier_limit: '検証係が開ききれなかった（取得の上限）',
  not_confirmed: '出典で確かめられなかった',
  no_source: '出典が付いていない',
  license_unknown: '利用条件が分からない',
};

/** return_note の 2 行目（§L-3 の固定文。verbatim。§Q-11 9 で「開けなかったページは出典に使わない」の後に動画の出典の例外の一言を足した） */
export const RETURN_FIXED_TEXT =
  '出典の URL は web_fetch で本文が返った URL を一字も変えずに書く。引用は本文の一続きをそのまま写す。開けなかったページは出典に使わない。動画（YouTube）の出典の行は別で、開けなくても書いてよい。主張には必ず出典 id を付け、その id を sources.json に入れる。';

/** report.meta.fetch_errors のうち「検証係の取得上限」とみなすエラーコード */
const VERIFIER_LIMIT_ERRORS = ['max_uses_exceeded', 'too_many_requests', 'unavailable'];

/** reasons は claims がこの件数以上の時だけ数える（少ない時は割合で判定しない §R-49 (g)） */
export const MIN_CLAIMS_FOR_REASONS = 5;

export interface TriageClaim {
  id: string;
  source_ids?: unknown;
  [k: string]: unknown;
}
export interface TriageSource {
  source_id: string;
  url: string;
  license: string;
  url_was_fetched: number;
  quote_found: number;
}
export interface TriageReport {
  /** verifications.id */
  id: string;
  /** verifications.result_json を parse したもの（{verdicts, overall_note, meta?}） */
  result: unknown;
}
export interface TriageInput {
  claims: unknown;
  report: TriageReport | null;
  sources: TriageSource[];
  checks: unknown;
  material: unknown;
  autoReverified: boolean | number;
  autoDerived: boolean;
}

export interface TriageGroup {
  cause: Cause;
  source_id: string | null;
  url: string | null;
  verifier_opened_urls: string[];
  claim_ids: string[];
}

export interface TriageOutput {
  verification_id: string | null;
  auto: Record<AutoItem, 'ok' | 'review'>;
  groups: TriageGroup[];
  ok_counts: { claims: number; sources: number };
  needs_review: number;
  bad: boolean;
  reasons: Reason[];
  action: 'none' | 'auto_return' | 'reverify';
  return_note: string | null;
}

interface Verdict {
  verdict: string;
  opened_urls: string[];
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const uniq = (xs: string[]): string[] => [...new Set(xs)];

function readClaims(raw: unknown): Array<{ id: string; source_ids: string[] }> {
  const list = Array.isArray(raw) ? raw : isObj(raw) && Array.isArray(raw.claims) ? raw.claims : [];
  const out: Array<{ id: string; source_ids: string[] }> = [];
  for (const c of list) {
    if (!isObj(c) || typeof c.id !== 'string') continue;
    out.push({ id: c.id, source_ids: uniq(strList(c.source_ids)) });
  }
  return out;
}

function readVerdicts(result: unknown): Map<string, Verdict> {
  const m = new Map<string, Verdict>();
  const list = isObj(result) && Array.isArray(result.verdicts) ? result.verdicts : [];
  for (const v of list) {
    if (!isObj(v) || typeof v.claim_id !== 'string' || m.has(v.claim_id)) continue;
    m.set(v.claim_id, { verdict: typeof v.verdict === 'string' ? v.verdict : '', opened_urls: strList(v.opened_urls) });
  }
  return m;
}

function hasVerifierLimit(result: unknown): boolean {
  const meta = isObj(result) ? result.meta : null;
  const fe = isObj(meta) ? meta.fetch_errors : null;
  if (!isObj(fe)) return false;
  return VERIFIER_LIMIT_ERRORS.some((k) => Object.prototype.hasOwnProperty.call(fe, k) && Number(fe[k]) >= 1);
}

/** checks_json の 5 つの配列がすべて空（欠けている・配列でない時は空とみなさない） */
function checksClean(checks: unknown): boolean {
  if (!isObj(checks)) return false;
  return ['forbidden', 'app_html', 'kakunin_zumi', 'missing_source_refs', 'missing_claim_refs'].every((k) => {
    const v = checks[k];
    return Array.isArray(v) && v.length === 0;
  });
}

/** parts の variants / files に .html が無い（parts が読めない時は「ある」側に倒す） */
function noHtmlParts(material: unknown): boolean {
  if (!isObj(material) || !Array.isArray(material.parts)) return false;
  for (const p of material.parts) {
    if (!isObj(p)) return false;
    for (const key of ['variants', 'files']) {
      const list = p[key];
      if (list === undefined) continue;
      if (!Array.isArray(list)) return false;
      for (const it of list) {
        const path = isObj(it) ? it.path : null;
        if (typeof path !== 'string') return false;
        if (path.toLowerCase().endsWith('.html')) return false;
      }
    }
  }
  return true;
}

/**
 * §Q-9.6: parts のどれかに動画がある（videos が空でない配列、または配列でない値）。
 * 動画の本人性と区間は人が確認画面で見るので、動画のある版の「利用条件」は自動 OK にしない。
 * material が読めない時は従来どおり（取り込みの schema 検査を通った material_json だけが版になる）
 */
export function hasVideos(material: unknown): boolean {
  if (!isObj(material) || !Array.isArray(material.parts)) return false;
  return material.parts.some((p) => isObj(p) && p.videos !== undefined && (!Array.isArray(p.videos) || p.videos.length > 0));
}

const REASON_TEXT = (r: Reason, n: { claims: number; confirmed: number; sources: number; quoteBad: number }): string => {
  switch (r) {
    case 'contradicted':
      return '出典と食い違う主張がありました';
    case 'few_confirmed':
      return `確かめられた主張が ${n.claims} 件中 ${n.confirmed} 件で、半分に届きませんでした`;
    case 'quote_mismatch_many':
      return `引用が本文と一致しない出典が ${n.sources} 件中 ${n.quoteBad} 件ありました`;
  }
};

export function triageVersion(input: TriageInput): TriageOutput {
  const claims = readClaims(input.claims);
  // 出典は id の重複なし（同じ id が 2 行あれば最初の行）
  const sources = new Map<string, TriageSource>();
  for (const s of input.sources) if (!sources.has(s.source_id)) sources.set(s.source_id, s);
  const report = input.report;
  const verdicts = report ? readVerdicts(report.result) : new Map<string, Verdict>();
  const verifierLimit = report ? hasVerifierLimit(report.result) : false;
  // §Q-11 9: 動画の出典（material が読めなければ無し = 従来どおり全部検査する）
  const videoIds = videoSourceIds(
    [...sources.values()].map((s) => ({ id: s.source_id, url: s.url })),
    versionVideosOfMaterial(input.material),
  );

  const groups: TriageGroup[] = [];
  const byKey = new Map<string, TriageGroup>();
  const groupFor = (sourceId: string | null, cause: Cause): TriageGroup => {
    const key = JSON.stringify([sourceId, cause]);
    let g = byKey.get(key);
    if (!g) {
      const url = sourceId === null || cause === 'source_not_listed' ? null : (sources.get(sourceId)?.url ?? null);
      g = { cause, source_id: sourceId, url, verifier_opened_urls: [], claim_ids: [] };
      byKey.set(key, g);
      groups.push(g);
    }
    return g;
  };
  const addClaim = (g: TriageGroup, claimId: string) => {
    if (!g.claim_ids.includes(claimId)) g.claim_ids.push(claimId);
    for (const u of verdicts.get(claimId)?.opened_urls ?? []) if (!g.verifier_opened_urls.includes(u)) g.verifier_opened_urls.push(u);
  };

  if (report) {
    for (const c of claims) {
      const verdict = verdicts.get(c.id)?.verdict ?? '';
      if (verdict === 'confirmed') {
        // confirmed でも、出典 id が無い・一覧に無いものは構造の問題として出す（§L-7 (l1)）
        if (c.source_ids.length === 0) addClaim(groupFor(null, 'no_source'), c.id);
        for (const sid of c.source_ids) if (!sources.has(sid)) addClaim(groupFor(sid, 'source_not_listed'), c.id);
        continue;
      }
      if (c.source_ids.length === 0) {
        addClaim(groupFor(null, 'no_source'), c.id);
        continue;
      }
      for (const sid of c.source_ids) {
        const s = sources.get(sid);
        let cause: Cause;
        if (verdict === 'contradicted') cause = 'contradicted';
        else if (!s) cause = 'source_not_listed';
        else if (s.url_was_fetched === 0 && !videoIds.has(sid)) cause = 'maker_url_not_fetched';
        else if (s.quote_found === 0 && !videoIds.has(sid)) cause = 'quote_mismatch';
        else if (verifierLimit) cause = 'verifier_limit';
        else cause = 'not_confirmed';
        addClaim(groupFor(sid, cause), c.id);
      }
    }
  }
  // 出典だけの問題（report の有無に関係なく出す）
  for (const [sid, s] of sources) {
    if (s.quote_found === 0 && !videoIds.has(sid)) groupFor(sid, 'quote_mismatch');
    if (s.license === 'unknown') groupFor(sid, 'license_unknown');
  }

  // 自動 OK の 3 項目
  const allConfirmed = claims.length >= 1 && claims.every((c) => verdicts.get(c.id)?.verdict === 'confirmed');
  const refsGreen = claims.every(
    (c) => c.source_ids.length >= 1 && c.source_ids.every((sid) => {
      const s = sources.get(sid);
      return !!s && s.url_was_fetched === 1 && s.quote_found === 1;
    }),
  );
  const auto: TriageOutput['auto'] = {
    content_and_evidence: report && allConfirmed && refsGreen ? 'ok' : 'review',
    // §Q-9.6: 動画のある版は人が見る（本人のアップか・区間が再生できて内容が合うか）
    terms_of_use:
      sources.size >= 1 && [...sources.values()].every((s) => s.license !== 'unknown') && !hasVideos(input.material) ? 'ok' : 'review',
    artifact_behavior: checksClean(input.checks) && noHtmlParts(input.material) ? 'ok' : 'review',
  };

  // reasons（report あり かつ claims ≥ 5）
  const confirmed = claims.filter((c) => verdicts.get(c.id)?.verdict === 'confirmed').length;
  const contradicted = claims.filter((c) => verdicts.get(c.id)?.verdict === 'contradicted').length;
  // §Q-11 9: 分子（quoteBad）と分母（出典の数）から動画の出典を外す
  const quoteSources = [...sources.values()].filter((s) => !videoIds.has(s.source_id));
  const quoteBad = quoteSources.filter((s) => s.quote_found === 0).length;
  const reasons: Reason[] = [];
  if (report && claims.length >= MIN_CLAIMS_FOR_REASONS) {
    if (contradicted >= 1) reasons.push('contradicted');
    if (confirmed * 2 < claims.length) reasons.push('few_confirmed');
    if (quoteBad * 2 > quoteSources.length) reasons.push('quote_mismatch_many');
  }
  const bad = reasons.length > 0;

  let action: TriageOutput['action'] = 'none';
  if (bad) {
    const onlyFew = reasons.length === 1 && reasons[0] === 'few_confirmed';
    const hasLimitGroup = groups.some((g) => g.cause === 'verifier_limit');
    if (onlyFew && hasLimitGroup && !Number(input.autoReverified)) action = 'reverify';
    else if (!input.autoDerived) action = 'auto_return';
  }

  let returnNote: string | null = null;
  if (action === 'auto_return') {
    const n = { claims: claims.length, confirmed, sources: quoteSources.length, quoteBad };
    const lines = [
      `自動の差し戻し（検証の結果: ${reasons.map((r) => REASON_TEXT(r, n)).join('。')}）。`,
      RETURN_FIXED_TEXT,
      ...groups.map(
        (g) =>
          `- 出典 ${g.source_id ?? 'なし'}${g.url ? `（${g.url}）` : ''}: ${CAUSE_TEXT[g.cause]}。主張 ${g.claim_ids.length ? g.claim_ids.join('、') : 'なし'}。検証係が開いた URL: ${
            g.verifier_opened_urls.length ? g.verifier_opened_urls.join(' ') : 'なし'
          }`,
      ),
    ];
    returnNote = lines.join('\n');
  }

  const inGroupClaims = new Set(groups.flatMap((g) => g.claim_ids));
  const inGroupSources = new Set(groups.map((g) => g.source_id).filter((x): x is string => x !== null));
  const autoReview = AUTO_ITEMS.filter((k) => auto[k] === 'review').length;
  return {
    verification_id: report?.id ?? null,
    auto,
    groups,
    ok_counts: {
      claims: claims.filter((c) => !inGroupClaims.has(c.id)).length,
      sources: [...sources.keys()].filter((sid) => !inGroupSources.has(sid)).length,
    },
    needs_review: groups.length + autoReview,
    bad,
    reasons,
    action,
    return_note: returnNote,
  };
}
