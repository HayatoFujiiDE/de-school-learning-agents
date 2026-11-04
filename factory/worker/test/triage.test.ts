// triageVersion（契約 §L-3）の単体。§L-7 (l1) の各項目を 1 テストずつ。
import { describe, expect, it } from 'vitest';
import { CAUSE_TEXT, RETURN_FIXED_TEXT, triageVersion, type TriageInput, type TriageSource } from '../src/checks/triage';
import { goodMaterial } from './helpers';

const GREEN_CHECKS = { schema: 'ok', forbidden: [], app_html: [], kakunin_zumi: [], missing_source_refs: [], missing_claim_refs: [], unreferenced_files: [] };

type V = 'confirmed' | 'hypothesis' | 'unverified' | 'contradicted';
interface Spec {
  /** claim ごとの [verdict, source_ids] */
  claims: Array<[V, string[]]>;
  /** 出典 id → 上書き（既定は url_was_fetched=1, quote_found=1, license 'CC BY-SA 3.0'） */
  sources: Record<string, Partial<TriageSource>>;
  fetchErrors?: Record<string, number>;
  report?: boolean;
  autoReverified?: number;
  autoDerived?: boolean;
  material?: unknown;
  checks?: unknown;
}

function build(s: Spec): TriageInput {
  const claims = s.claims.map(([, sids], i) => ({ id: `c${i + 1}`, text: `主張 ${i + 1}`, status: 'confirmed', source_ids: sids, used_in: ['p1'] }));
  const sources: TriageSource[] = Object.entries(s.sources).map(([id, o]) => ({
    source_id: id,
    url: `https://minecraft.wiki/w/${id}`,
    license: 'CC BY-SA 3.0',
    url_was_fetched: 1,
    quote_found: 1,
    ...o,
  }));
  const verdicts = s.claims.map(([verdict], i) => ({ claim_id: `c${i + 1}`, verdict, reason: 'r', opened_urls: [`https://verifier.example/${i + 1}`] }));
  return {
    claims: { claims },
    report:
      s.report === false
        ? null
        : { id: 'w1', result: { verdicts, overall_note: '', meta: { mode: 'batch', turns: 1, fetch_errors: s.fetchErrors ?? {}, fetched_ok: [] } } },
    sources,
    checks: s.checks ?? GREEN_CHECKS,
    material: s.material ?? goodMaterial(),
    autoReverified: s.autoReverified ?? 0,
    autoDerived: s.autoDerived ?? false,
  };
}

const srcIds = (n: number) => Array.from({ length: n }, (_, i) => `s${i + 1}`);
const keyOf = (g: { source_id: string | null; cause: string }) => `${g.source_id}|${g.cause}`;

/** 版 1 相当: 25 claims（confirmed は c1 だけ・他は unverified）、出典 8 件、claim i は出典 s((i-1)%8+1)、quote_found=1 は qOk の出典だけ */
function version1(qOk: string[]): Spec {
  const sources: Record<string, Partial<TriageSource>> = {};
  for (const id of srcIds(8)) sources[id] = { quote_found: qOk.includes(id) ? 1 : 0 };
  return {
    claims: Array.from({ length: 25 }, (_, i) => [i === 0 ? 'confirmed' : 'unverified', [`s${(i % 8) + 1}`]] as [V, string[]]),
    sources,
  };
}

describe('triageVersion (§L-7 l1)', () => {
  it('版 1 相当（25 中 confirmed 1、出典 8 中 quote_found=1 が 2 件、fetch_errors なし）→ few_confirmed を含み auto_return、group は (出典, 原因) ごと', () => {
    const t = triageVersion(build(version1(['s1', 's2'])));
    expect(t.reasons).toContain('few_confirmed');
    // 出典 8 中 6 件が quote_found=0 なので §L-3 の規則どおり quote_mismatch_many も立つ
    expect(t.reasons).toEqual(['few_confirmed', 'quote_mismatch_many']);
    expect(t.bad).toBe(true);
    expect(t.action).toBe('auto_return');
    // (出典, 原因) ごとに 1 group・キーの重複なし
    const keys = t.groups.map(keyOf);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.sort()).toEqual(['s1|not_confirmed', 's2|not_confirmed', 's3|quote_mismatch', 's4|quote_mismatch', 's5|quote_mismatch', 's6|quote_mismatch', 's7|quote_mismatch', 's8|quote_mismatch']);
    // c1（confirmed, s1）は入らない。s1 の not_confirmed は c9, c17, c25
    expect(t.groups.find((g) => keyOf(g) === 's1|not_confirmed')!.claim_ids).toEqual(['c9', 'c17', 'c25']);
    expect(t.groups.find((g) => keyOf(g) === 's3|quote_mismatch')!.claim_ids).toEqual(['c3', 'c11', 'c19']);
    expect(t.auto.content_and_evidence).toBe('review');
    expect(t.return_note!.split('\n')[0]).toBe(
      '自動の差し戻し（検証の結果: 確かめられた主張が 25 件中 1 件で、半分に届きませんでした。引用が本文と一致しない出典が 8 件中 6 件ありました）。',
    );
  });

  it('版 1 相当で quote_found=0 が 2 件だけ（「quote 2」を不一致 2 件と読む場合）→ reasons は few_confirmed だけで auto_return', () => {
    const t = triageVersion(build(version1(['s1', 's2', 's3', 's4', 's5', 's6'])));
    expect(t.reasons).toEqual(['few_confirmed']);
    expect(t.action).toBe('auto_return');
  });

  it('claims 4 件 → 全部 unverified でも bad にならない', () => {
    const t = triageVersion(build({ claims: [['unverified', ['s1']], ['unverified', ['s1']], ['unverified', ['s1']], ['contradicted', ['s1']]], sources: { s1: {} } }));
    expect(t.bad).toBe(false);
    expect(t.reasons).toEqual([]);
    expect(t.action).toBe('none');
    expect(t.return_note).toBeNull();
  });

  const limitSpec = (extra: Partial<Spec> = {}): Spec => ({
    claims: [
      ...Array.from({ length: 4 }, () => ['confirmed', ['s1']] as [V, string[]]),
      ...Array.from({ length: 6 }, () => ['unverified', ['s2']] as [V, string[]]),
    ],
    sources: { s1: {}, s2: {} },
    fetchErrors: { max_uses_exceeded: 3 },
    ...extra,
  });

  it('reasons が few_confirmed だけ・verifier_limit あり・autoReverified=0 → reverify', () => {
    const t = triageVersion(build(limitSpec()));
    expect(t.reasons).toEqual(['few_confirmed']);
    expect(t.groups.map(keyOf)).toEqual(['s2|verifier_limit']);
    expect(t.action).toBe('reverify');
    expect(t.return_note).toBeNull();
  });

  it('同じ条件で autoDerived でも reverify', () => {
    expect(triageVersion(build(limitSpec({ autoDerived: true }))).action).toBe('reverify');
  });

  it('autoReverified=1 なら reverify せず auto_return', () => {
    expect(triageVersion(build(limitSpec({ autoReverified: 1 }))).action).toBe('auto_return');
  });

  it('同じ条件に contradicted を 1 件足す → auto_return（reverify しない）', () => {
    const s = limitSpec();
    s.claims[9] = ['contradicted', ['s2']];
    const t = triageVersion(build(s));
    expect(t.reasons).toEqual(['contradicted', 'few_confirmed']);
    expect(t.action).toBe('auto_return');
  });

  it('autoDerived かつ verifier_limit なし → bad でも none（人に出る）', () => {
    const t = triageVersion(build({ ...version1(['s1', 's2']), autoDerived: true }));
    expect(t.bad).toBe(true);
    expect(t.action).toBe('none');
    expect(t.return_note).toBeNull();
  });

  it('全緑 → auto 3 項目 ok・needs_review 0・group なし', () => {
    const t = triageVersion(build({ claims: [['confirmed', ['s1']], ['confirmed', ['s1', 's2']]], sources: { s1: {}, s2: {} } }));
    expect(t.auto).toEqual({ content_and_evidence: 'ok', terms_of_use: 'ok', artifact_behavior: 'ok' });
    expect(t.groups).toEqual([]);
    expect(t.needs_review).toBe(0);
    expect(t.ok_counts).toEqual({ claims: 2, sources: 2 });
    expect(t.verification_id).toBe('w1');
    expect(t.action).toBe('none');
  });

  it('全 claim confirmed でも source_ids=[] が 1 件 → content_and_evidence は review（no_source の group、source_id/url は null）', () => {
    const t = triageVersion(build({ claims: [['confirmed', ['s1']], ['confirmed', []]], sources: { s1: {} } }));
    expect(t.auto.content_and_evidence).toBe('review');
    expect(t.groups).toEqual([{ cause: 'no_source', source_id: null, url: null, verifier_opened_urls: ['https://verifier.example/2'], claim_ids: ['c2'] }]);
    expect(t.needs_review).toBe(2);
  });

  it('全 claim confirmed でも sources に無い id が 1 件 → content_and_evidence は review（source_not_listed の group、url は null）', () => {
    const t = triageVersion(build({ claims: [['confirmed', ['s1']], ['confirmed', ['s9']]], sources: { s1: {} } }));
    expect(t.auto.content_and_evidence).toBe('review');
    expect(t.groups).toEqual([{ cause: 'source_not_listed', source_id: 's9', url: null, verifier_opened_urls: ['https://verifier.example/2'], claim_ids: ['c2'] }]);
  });

  it('同じ出典で contradicted と not_confirmed → 2 group', () => {
    const t = triageVersion(build({ claims: [['contradicted', ['s1']], ['hypothesis', ['s1']], ['unverified', ['s1']]], sources: { s1: {} } }));
    expect(t.groups.map((g) => [keyOf(g), g.claim_ids])).toEqual([
      ['s1|contradicted', ['c1']],
      ['s1|not_confirmed', ['c2', 'c3']],
    ]);
    expect(t.groups[0].url).toBe('https://minecraft.wiki/w/s1');
  });

  it('report null → claim の group なし・bad false・content_and_evidence review・action none（出典だけの group は出す）', () => {
    const t = triageVersion(build({ ...version1(['s1', 's2']), report: false }));
    expect(t.verification_id).toBeNull();
    expect(t.bad).toBe(false);
    expect(t.action).toBe('none');
    expect(t.auto.content_and_evidence).toBe('review');
    expect(t.groups.every((g) => g.claim_ids.length === 0)).toBe(true);
    expect(t.groups.map(keyOf)).toEqual(['s3|quote_mismatch', 's4|quote_mismatch', 's5|quote_mismatch', 's6|quote_mismatch', 's7|quote_mismatch', 's8|quote_mismatch']);
  });

  it('confirmed 4/5 + contradicted 1 → return_note の 1 行目は「出典と食い違う主張がありました」だけ、2 行目は固定文、group ごとに 1 行', () => {
    const t = triageVersion(build({ claims: [...Array.from({ length: 4 }, () => ['confirmed', ['s1']] as [V, string[]]), ['contradicted', ['s2']]], sources: { s1: {}, s2: {} } }));
    expect(t.reasons).toEqual(['contradicted']);
    expect(t.action).toBe('auto_return');
    const lines = t.return_note!.split('\n');
    expect(lines[0]).toBe('自動の差し戻し（検証の結果: 出典と食い違う主張がありました）。');
    expect(lines[1]).toBe(RETURN_FIXED_TEXT);
    expect(lines.slice(2)).toEqual([`- 出典 s2（https://minecraft.wiki/w/s2）: ${CAUSE_TEXT.contradicted}。主張 c5。検証係が開いた URL: https://verifier.example/5`]);
  });

  it('license unknown → terms_of_use review + license_unknown の group / .html を含む parts → artifact_behavior review', () => {
    const material = goodMaterial() as { parts: Array<{ files: Array<{ path: string; role: string }> }> };
    material.parts[0].files.push({ path: 'parts/p1/app.html', role: 'app' });
    const t = triageVersion(build({ claims: [['confirmed', ['s1']]], sources: { s1: { license: 'unknown' } }, material }));
    expect(t.auto).toEqual({ content_and_evidence: 'ok', terms_of_use: 'review', artifact_behavior: 'review' });
    expect(t.groups.map(keyOf)).toEqual(['s1|license_unknown']);
    expect(t.needs_review).toBe(3);
    expect(triageVersion(build({ claims: [['confirmed', ['s1']]], sources: { s1: {} }, checks: { ...GREEN_CHECKS, forbidden: [{ path: 'p', word: 'w', count: 1 }] } })).auto.artifact_behavior).toBe('review');
  });
});
