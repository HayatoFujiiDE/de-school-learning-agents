// triageVersion（契約 V-6。§L-3 を置き換え）の単体。V-11 u6 の各項目と、互換で残した groups（§L-7 (l1)）。
import { describe, expect, it } from 'vitest';
import {
  CAUSE_TEXT,
  CHECK_KEYS,
  RETURN_FIXED_TEXT,
  RETURN_NOTE_MAX,
  buildReturnNote,
  clampAutoReturnMax,
  triageVersion,
  type TriageInput,
  type TriageItem,
  type TriageSource,
} from '../src/checks/triage';
import { goodMaterial } from './helpers';

// 契約から一字ずつ写した文（§L-6 の表。groups の原因の文）
const CONTRACT_CAUSE_TEXT = {
  contradicted: '出典と食い違う',
  maker_url_not_fetched: '職人がこの URL を開けていない',
  quote_mismatch: '引用が出典の本文と一致しない',
  verifier_limit: '検証係が開ききれなかった（取得の上限）',
  not_confirmed: '出典で確かめられなかった',
  no_source: '出典が付いていない',
  source_not_listed: '出典一覧にない出典',
  license_unknown: '利用条件が分からない',
};
// 契約 V-6 g から一字ずつ写した文
const NOTE_SCOPE =
  '前の版から始めて、下の一覧の所と、それに合わせて直す必要がある所（claims・sources・変奏どうし・図や動かせるものの中の同じ記述）だけを直してください。関係のない所は変えないでください。';
const NOTE_CLAIMS =
  '確かめられなかった主張は、(1) 開ける別の出典で確かめ直す (2) それができなければ、本文を「〜と考えられています」「たしかめてみよう」のような推測・問いの書き方に直し、claims の status を hypothesis にする（hypothesis の claim が全体の 3 分の 1 を超えない時だけ）(3) それも合わなければ、その主張を本文と claims から外す、の順で直してください。';
const NOTE_LICENSE = '利用条件が分からない出典は、利用条件（ライセンス）が分かる別の出典に差し替えるか、その出典だけが支えている主張を外してください。';
const NOTE_TEXT =
  '子ども向けの本文には、ファイル名（app.html・figure-1.svg など）や作る側の言葉を書かないでください。動かせるものは「さわってみよう」、図は「図」と呼びます。直した所は、小学生・中学生・短い・長い・ゲーム版のすべてでそろえてください。';
const NOTE_MANY_HYP = (h: number, n: number) =>
  `仮説の主張が多すぎます（仮説 ${h} 件 / 全 ${n} 件）。仮説のうち、開ける出典で確かめられるものは確かめて confirmed にし、できないものは本文と claims から外して、仮説を全体の 3 分の 1 以内にしてください。新しい仮説を増やさないでください。`;

const GREEN_CHECKS = { schema: 'ok', forbidden: [], app_html: [], kakunin_zumi: [], missing_source_refs: [], missing_claim_refs: [], unreferenced_files: [], child_text: [] };
const YT = 'abcdefghijk';
const WATCH = `https://www.youtube.com/watch?v=${YT}`;
const CH = 'https://www.youtube.com/@official';

type V = 'confirmed' | 'hypothesis' | 'unverified' | 'contradicted' | '';
type PA = 'fact' | 'hedged' | 'analogy' | 'not_in_text' | null;
type Obj = Record<string, any>;

/** goodMaterial（図 parts/p1/figure-1.svg が 1 枚）に、動かせるもの・動画を足す */
function mat(o: { app?: boolean; video?: boolean } = {}): Obj {
  const m = goodMaterial() as Obj;
  if (o.app) m.parts[0].files.push({ path: 'parts/p1/app.html', role: 'app' });
  if (o.video)
    m.parts[0].videos = [
      { id: 'v1', youtube_id: YT, title: '動画', channel: '公式', start_sec: 10, end_sec: 70, why: '信号が進む様子', rights_note: '本人のアップ', source_id: 's9' },
    ];
  return m;
}

const okReading = (o: Obj = {}) => ({ findings: [], learning: { verdict: 'ok', reason: '' }, conditions: { verdict: 'ok', reason: '' }, summary: '', not_read: [], ...o });

interface Spec {
  /** claim ごとの [verdict, source_ids, presented_as] */
  claims: Array<[V, string[], PA?]>;
  /** 出典 id → 上書き（既定は url_was_fetched=1, quote_found=1, license 'CC BY-SA 3.0', is_primary 0）。無ければ s1 */
  sources?: Record<string, Partial<TriageSource>>;
  fetchErrors?: Record<string, number>;
  report?: false | 'broken';
  /** 新しい検証（meta.evidence_v = 2）。既定 true */
  isNew?: boolean;
  figures?: unknown;
  apps?: unknown;
  videos?: unknown;
  material?: unknown;
  checks?: unknown;
  reader?: TriageInput['reader'];
  videoMeta?: TriageInput['videoMeta'];
  trusted?: string[];
  autoRounds?: number;
  autoReturnMax?: unknown;
  autoReverified?: number;
  evidenceReverified?: number;
  verificationStatus?: string;
}

function build(s: Spec): TriageInput {
  const claims = s.claims.map(([, sids], i) => ({ id: `c${i + 1}`, text: `主張 ${i + 1}`, status: 'confirmed', source_ids: sids, used_in: ['p1'] }));
  const sources: TriageSource[] = Object.entries(s.sources ?? { s1: {} }).map(([id, o]) => ({
    source_id: id,
    url: `https://minecraft.wiki/w/${id}`,
    license: 'CC BY-SA 3.0',
    url_was_fetched: 1,
    quote_found: 1,
    is_primary: 0,
    ...o,
  }));
  const verdicts = s.claims
    .map(([verdict, , pa], i) => (verdict === '' ? null : { claim_id: `c${i + 1}`, verdict, reason: `理由 ${i + 1}`, opened_urls: [], presented_as: pa ?? null }))
    .filter(Boolean);
  const material = s.material ?? mat();
  const result = {
    verdicts,
    overall_note: '',
    figures: 'figures' in s ? s.figures : [{ path: 'parts/p1/figure-1.svg', verdict: 'ok', reason: '' }],
    analogy_gaps: [],
    videos: s.videos ?? [],
    apps: s.apps === undefined ? [] : s.apps,
    meta: { mode: 'batch', turns: 1, fetch_errors: s.fetchErrors ?? {}, fetched_ok: [], ...(s.isNew === false ? {} : { evidence_v: 2 }) },
  };
  return {
    claims: { claims },
    report: s.report === false ? null : { id: 'w1', result: s.report === 'broken' ? null : result },
    sources,
    checks: 'checks' in s ? s.checks : GREEN_CHECKS,
    material,
    autoReverified: s.autoReverified ?? 0,
    reader: s.reader === undefined ? { status: 'done', token: 'rt1', result: okReading() } : s.reader,
    videoMeta: s.videoMeta ?? [],
    trustedChannels: s.trusted ?? [],
    trustedGen: '3',
    autoRounds: s.autoRounds ?? 0,
    autoReturnMax: s.autoReturnMax ?? '2',
    verificationStatus: s.verificationStatus ?? 'done',
    evidenceReverified: s.evidenceReverified ?? 0,
  };
}

const claimItem = (t: { items: TriageItem[] }, id = 'c1') => t.items.find((i) => i.claim_id === id && i.kind === 'claim');
const causes = (t: { items: TriageItem[] }) => t.items.map((i) => [i.id, i.severity, i.cause]);

describe('主張の項目の表（契約 V-6 c。上から順に最初に当たったもの）', () => {
  const one = (verdict: V, sids: string[], src: Record<string, Partial<TriageSource>>, o: Partial<Spec> = {}, pa: PA = null) =>
    claimItem(triageVersion(build({ claims: [[verdict, sids, pa]], sources: src, ...o })));
  it('contradicted は fix・blocking（一覧に無い id・未取得・取得上限があっても）', () => {
    expect(one('contradicted', ['s9'], { s1: { url_was_fetched: 0 } }, { fetchErrors: { max_uses_exceeded: 1 } })).toMatchObject({
      id: 'claim:c1',
      kind: 'claim',
      key: 'content_and_evidence',
      severity: 'fix',
      cause: 'contradicted',
      title: '出典と食い違う',
      blocking: true,
      detail: '理由 1',
      source_ids: ['s9'],
    });
  });
  it('source_ids が空 → no_source（fix）/ sources に無い id → source_not_listed（fix）', () => {
    expect(one('unverified', [], { s1: {} })).toMatchObject({ severity: 'fix', cause: 'no_source', title: '出典が付いていない' });
    expect(one('confirmed', ['s1', 's8'], { s1: {} })).toMatchObject({ severity: 'fix', cause: 'source_not_listed', title: '出典一覧にない出典' });
  });
  it('confirmed で一次資料の出典に url_was_fetched=0 → primary_source_unfetched（fix・blocking）。動画の出典は除く', () => {
    expect(one('confirmed', ['s1'], { s1: { is_primary: 1, url_was_fetched: 0 } })).toMatchObject({
      severity: 'fix',
      cause: 'primary_source_unfetched',
      title: '確かとした主張の一次資料を、職人が開けていない',
      blocking: true,
    });
    // 動画の出典（版の動画の source_id で url が watch URL と一致）は記録で確かめる（§Q-9.11）
    expect(one('confirmed', ['s9'], { s9: { url: WATCH, is_primary: 1, url_was_fetched: 0, quote_found: 0 } }, { material: mat({ video: true }) })).toBeUndefined();
    // 一次資料でなければ項目なし
    expect(one('confirmed', ['s1'], { s1: { is_primary: 0, url_was_fetched: 0 } })).toBeUndefined();
  });
  it('confirmed → 項目なし', () => {
    expect(one('confirmed', ['s1'], { s1: {} })).toBeUndefined();
  });
  it('unverified: 動画でない出典の全部が url_was_fetched=0 → maker_url_not_fetched / 全部が quote_found=0 → quote_mismatch', () => {
    expect(one('unverified', ['s1'], { s1: { url_was_fetched: 0, quote_found: 0 } })).toMatchObject({ severity: 'fix', cause: 'maker_url_not_fetched', title: '職人がこの URL を開けていない' });
    expect(one('unverified', ['s1'], { s1: { quote_found: 0 } })).toMatchObject({ severity: 'fix', cause: 'quote_mismatch', title: '引用が出典の本文と一致しない' });
    // 一部だけ未取得なら当たらない（次の行へ）
    expect(one('unverified', ['s1', 's2'], { s1: { url_was_fetched: 0 }, s2: {} })).toMatchObject({ cause: 'not_confirmed' });
  });
  it('unverified + fetch_errors の取得上限 → verifier_limit（ask）。それ以外 → not_confirmed（fix）。verdict が無い時も unverified と同じ', () => {
    for (const k of ['max_uses_exceeded', 'too_many_requests', 'unavailable'])
      expect(one('unverified', ['s1'], { s1: {} }, { fetchErrors: { [k]: 1 } })).toMatchObject({ severity: 'ask', cause: 'verifier_limit', title: '検証係が開ききれなかった（取得の上限）' });
    expect(one('unverified', ['s1'], { s1: {} }, { fetchErrors: { url_not_accessible: 3 } })).toMatchObject({ severity: 'fix', cause: 'not_confirmed', title: '出典で確かめられなかった' });
    expect(one('', ['s1'], { s1: {} })).toMatchObject({ severity: 'fix', cause: 'not_confirmed', detail: '' });
  });
  it.each([
    ['fact', 'fix', 'stated_as_fact', '言い切れない内容を、本文が事実として書いている'],
    ['hedged', 'note', 'hypothesis_hedged', '仮説として書いてある'],
    ['analogy', 'note', 'analogy', 'たとえとして書いてある'],
    ['not_in_text', 'note', 'hypothesis_unused', '本文に出てこない仮説'],
    [null, 'ask', 'hypothesis_unjudged', '仮説の主張（本文の書き方を機械が見ていない）'],
  ] as Array<[PA, string, string, string]>)('hypothesis + presented_as %s → %s %s', (pa, severity, cause, title) => {
    expect(one('hypothesis', ['s1'], { s1: {} }, {}, pa)).toMatchObject({ severity, cause, title });
  });
  it('主張 0 件（report あり）→ check:no_claims（ask）。出典 0 件 → check:no_sources（ask）', () => {
    const t = triageVersion(build({ claims: [], sources: {} }));
    expect(causes(t)).toEqual([
      ['check:no_claims', 'ask', 'no_claims'],
      ['check:no_sources', 'ask', 'no_sources'],
    ]);
    expect(t.items[0]).toMatchObject({ kind: 'check', key: 'content_and_evidence', title: '主張が 1 件もない（事実を述べる所が無いかを見てください）' });
    expect(t.items[1]).toMatchObject({ kind: 'check', key: 'terms_of_use', title: '出典が 1 件もない' });
  });
  it('新しい検証で主張 3 件・confirmed 0 → check:none_confirmed（fix。主張の数に関係なく）。古い検証では作らない', () => {
    const spec: Spec = { claims: [['hypothesis', ['s1'], 'hedged'], ['hypothesis', ['s1'], 'hedged'], ['hypothesis', ['s1'], 'hedged']] };
    const t = triageVersion(build(spec));
    expect(t.items.find((i) => i.id === 'check:none_confirmed')).toMatchObject({ kind: 'check', key: 'content_and_evidence', severity: 'fix', title: '確かめられた主張が 1 件もない', detail: '確か 0 件 / 全 3 件' });
    expect(t.reasons).toEqual(['needs_fix']);
    expect(triageVersion(build({ ...spec, isNew: false, evidenceReverified: 1 })).items.some((i) => i.id === 'check:none_confirmed')).toBe(false);
  });
});

describe('出典・図・動かせるもの・機械検査・動画の項目（契約 V-6 c）', () => {
  it('license unknown の出典ごとに source:{id}:license（fix）。引用の不一致だけでは出典の項目を作らない', () => {
    const t = triageVersion(build({ claims: [['confirmed', ['s1']]], sources: { s1: { license: 'unknown' }, s2: { quote_found: 0 } } }));
    expect(t.items.filter((i) => i.kind === 'source')).toEqual([
      expect.objectContaining({ id: 'source:s1:license', key: 'terms_of_use', severity: 'fix', cause: 'license_unknown', title: '利用条件が分からない', source_ids: ['s1'] }),
    ]);
  });
  it('図: problem → fix / unclear・not_seen → ask / report に行が無い material の図 → not_seen', () => {
    const row = (verdict: string) => [{ path: 'parts/p1/figure-1.svg', verdict, reason: 'r' }];
    const fig = (figures: unknown) => triageVersion(build({ claims: [['confirmed', ['s1']]], figures })).items.filter((i) => i.kind === 'figure').map((i) => [i.id, i.severity, i.cause, i.path]);
    expect(fig(row('problem'))).toEqual([['figure:parts/p1/figure-1.svg', 'fix', 'figure_problem', 'parts/p1/figure-1.svg']]);
    expect(fig(row('unclear'))).toEqual([['figure:parts/p1/figure-1.svg', 'ask', 'figure_unclear', 'parts/p1/figure-1.svg']]);
    expect(fig(row('not_seen'))).toEqual([['figure:parts/p1/figure-1.svg', 'ask', 'figure_not_seen', 'parts/p1/figure-1.svg']]);
    expect(fig([])).toEqual([['figure:parts/p1/figure-1.svg', 'ask', 'figure_not_seen', 'parts/p1/figure-1.svg']]);
    expect(fig(null)).toEqual([['figure:parts/p1/figure-1.svg', 'ask', 'figure_not_seen', 'parts/p1/figure-1.svg']]);
    expect(fig(row('ok'))).toEqual([]);
  });
  it('動かせるもの: problem → fix / unclear → ask / 行が無い・apps が null（古い検証）→ app_not_judged（ask）', () => {
    const app = (apps: unknown) =>
      triageVersion(build({ claims: [['confirmed', ['s1']]], material: mat({ app: true }), apps })).items.filter((i) => i.kind === 'app').map((i) => [i.id, i.severity, i.cause, i.key]);
    const row = (verdict: string) => [{ path: 'parts/p1/app.html', verdict, reason: 'r' }];
    expect(app(row('problem'))).toEqual([['app:parts/p1/app.html', 'fix', 'app_problem', 'artifact_behavior']]);
    expect(app(row('unclear'))).toEqual([['app:parts/p1/app.html', 'ask', 'app_unclear', 'artifact_behavior']]);
    expect(app([])).toEqual([['app:parts/p1/app.html', 'ask', 'app_not_judged', 'artifact_behavior']]);
    expect(app(null)).toEqual([['app:parts/p1/app.html', 'ask', 'app_not_judged', 'artifact_behavior']]);
    expect(app(row('ok'))).toEqual([]);
  });
  it('機械検査: 5 つの古い配列と child_text の行 → fix（連番の id）。古い配列が無い → checks_missing（ask）', () => {
    const checks = {
      ...GREEN_CHECKS,
      forbidden: [{ path: 'parts/p1/elementary-short.md', word: '評価', count: 1 }, { path: 'material.json#summary_elementary', word: '点数', count: 1 }],
      kakunin_zumi: [{ path: 'parts/p1/elementary-long.md', count: 1 }],
      app_html: [{ path: 'parts/p2/p2-app.html', pattern: 'fetch(', count: 1 }],
      missing_source_refs: [{ claim_id: 'c1', source_id: 's7' }],
      missing_claim_refs: [{ path: 'parts/p1/game.md', ref: 'c9' }],
      child_text: [{ path: 'parts/p1/elementary-short.md', kind: 'file_name', sample: 'app.html をひらく' }, { path: 'parts/p1/elementary-short.md', kind: 'raw_markup', sample: '**太字' }],
    };
    const t = triageVersion(build({ claims: [['confirmed', ['s1']]], checks }));
    expect(t.items.filter((i) => i.id.startsWith('check:')).map((i) => [i.id, i.kind, i.key, i.severity, i.title, i.path ?? null, i.quote ?? null])).toEqual([
      ['check:forbidden_word:1', 'check', 'explanation_and_expression', 'fix', '使わない言葉が入っている', 'parts/p1/elementary-short.md', '評価'],
      ['check:forbidden_word:2', 'check', 'explanation_and_expression', 'fix', '使わない言葉が入っている', 'material.json', '点数'],
      ['check:kakunin_zumi:1', 'check', 'explanation_and_expression', 'fix', '『確認済み』と書いてある', 'parts/p1/elementary-long.md', '確認済み'],
      ['check:app_external:1', 'check', 'artifact_behavior', 'fix', '動かせるものが外部を読み込んでいる', 'parts/p2/p2-app.html', null],
      ['check:missing_ref:1', 'check', 'content_and_evidence', 'fix', '本文と主張・出典の番号が合わない', null, null],
      ['check:missing_ref:2', 'check', 'content_and_evidence', 'fix', '本文と主張・出典の番号が合わない', 'parts/p1/game.md', null],
      ['check:file_name:1', 'text', 'explanation_and_expression', 'fix', '本文にファイル名が出ている', 'parts/p1/elementary-short.md', 'app.html をひらく'],
      ['check:raw_markup:1', 'text', 'explanation_and_expression', 'fix', '記法の記号がそのまま見える', 'parts/p1/elementary-short.md', '**太字'],
    ]);
    const { forbidden: _f, ...noForbidden } = GREEN_CHECKS;
    const m = triageVersion(build({ claims: [['confirmed', ['s1']]], checks: noForbidden }));
    expect(m.items.find((i) => i.id === 'check:checks_missing')).toMatchObject({ kind: 'check', key: 'artifact_behavior', severity: 'ask', title: '機械検査の結果が読めない' });
    expect(triageVersion(build({ claims: [['confirmed', ['s1']]], checks: null })).items.map((i) => i.id)).toEqual(['check:checks_missing']);
  });
  it('動画: 判定（problem・unclear・not_seen・行なし）・公式の情報（取れていない・名前が違う）・チャンネル（確認済み・初めて・author_url が空）', () => {
    const meta = (o: Obj = {}) => [{ video_id: 'v1', outcome: 'ok', author_name: '公式', author_url: CH, channel_match: 'match', ...o }];
    const vid = (s: Partial<Spec>) =>
      triageVersion(build({ claims: [['confirmed', ['s1']]], sources: { s1: {}, s9: { url: WATCH } }, material: mat({ video: true }), ...s })).items
        .filter((i) => i.kind === 'video')
        .map((i) => [i.id, i.severity, i.cause, i.key, i.channel_key ?? null]);
    const ok = [{ id: 'v1', verdict: 'ok', reason: '' }];
    expect(vid({ videos: [{ id: 'v1', verdict: 'problem', reason: 'r' }], videoMeta: meta(), trusted: [CH] })).toEqual([['video:v1:content', 'fix', 'video_problem', 'explanation_and_expression', null]]);
    expect(vid({ videos: [{ id: 'v1', verdict: 'unclear', reason: 'r' }], videoMeta: meta(), trusted: [CH] })).toEqual([['video:v1:content', 'ask', 'video_unclear', 'explanation_and_expression', null]]);
    expect(vid({ videos: [], videoMeta: meta(), trusted: [CH] })).toEqual([['video:v1:content', 'ask', 'video_not_seen', 'explanation_and_expression', null]]);
    expect(vid({ videos: ok, videoMeta: [] })).toEqual([['video:v1:meta', 'ask', 'video_meta_unknown', 'terms_of_use', null]]);
    expect(vid({ videos: ok, videoMeta: meta({ channel_match: 'mismatch' }), trusted: [CH] })).toEqual([['video:v1:meta', 'fix', 'video_channel_mismatch', 'terms_of_use', null]]);
    expect(vid({ videos: ok, videoMeta: meta({ channel_match: 'partial' }), trusted: [CH] })).toEqual([]);
    expect(vid({ videos: ok, videoMeta: meta() })).toEqual([['video:v1:channel', 'ask', 'video_channel_new', 'terms_of_use', CH]]);
    expect(vid({ videos: ok, videoMeta: meta({ author_url: '' }), trusted: [CH] })).toEqual([['video:v1:channel', 'ask', 'video_channel_new', 'terms_of_use', null]]);
  });
});

describe('読み手係の項目（契約 V-6 c）', () => {
  it('findings 1 件ずつ（id は path・quote・kind から。同じ内容は連番）・learning / conditions の problem は fix・unclear は ask', () => {
    const f = (o: Obj = {}) => ({ path: 'parts/p1/elementary-short.md', quote: '信号は進む', kind: 'word', severity: 'fix', note: '小3 が読めない', suggestion: '言いかえる', ...o });
    const reader = { status: 'done', token: 'rt1', result: okReading({ findings: [f(), f(), f({ kind: 'tone', severity: 'note', path: '' })], learning: { verdict: 'problem', reason: '遊ぶだけ' }, conditions: { verdict: 'unclear', reason: '分からない' } }) };
    const t = triageVersion(build({ claims: [['confirmed', ['s1']]], reader }));
    const r = t.items.filter((i) => ['reader', 'learning', 'conditions'].includes(i.kind));
    expect(r[0].id).toMatch(/^reader:[0-9a-f]{8}$/);
    expect(r[1].id).toBe(`${r[0].id}-2`);
    expect(r[0]).toMatchObject({ kind: 'reader', key: 'explanation_and_expression', severity: 'fix', cause: 'word', title: '言葉がむずかしい', path: 'parts/p1/elementary-short.md', quote: '信号は進む', suggestion: '言いかえる', detail: '小3 が読めない' });
    expect(r[2]).toMatchObject({ severity: 'note', cause: 'tone', title: '言い方が気になる' });
    expect('path' in r[2]).toBe(false);
    expect(r.slice(3).map((i) => [i.id, i.kind, i.key, i.severity, i.cause, i.title, i.detail])).toEqual([
      ['learning', 'learning', 'relation_to_learning', 'fix', 'learning_problem', '学習とのつながりが弱い', '遊ぶだけ'],
      ['conditions', 'conditions', 'conditions_of_use', 'ask', 'conditions_unclear', '使う条件を機械では決められなかった', '分からない'],
    ]);
    // 同じ入力なら同じ id
    expect(triageVersion(build({ claims: [['confirmed', ['s1']]], reader })).items.map((i) => i.id)).toEqual(t.items.map((i) => i.id));
  });
  it('読み手 failed → 3 項目それぞれに ask（reader_failed の文）', () => {
    const t = triageVersion(build({ claims: [['confirmed', ['s1']]], reader: { status: 'failed', token: 'rt1', result: null } }));
    expect(t.items.map((i) => [i.id, i.kind, i.key, i.severity, i.title])).toEqual([
      ['reader:reader_failed:explanation_and_expression', 'reader', 'explanation_and_expression', 'ask', '読み手チェックができなかった: 説明と表現（子どもの画面を見て決めてください）'],
      ['reader:reader_failed:relation_to_learning', 'learning', 'relation_to_learning', 'ask', '読み手チェックができなかった: 学習との関係'],
      ['reader:reader_failed:conditions_of_use', 'conditions', 'conditions_of_use', 'ask', '読み手チェックができなかった: 使う条件'],
    ]);
    expect(t.gate).toBe('attention');
  });
  it('not_read あり → 3 項目それぞれに ask（reader_partial の文）。learning が problem ならその fix も作る', () => {
    const t = triageVersion(build({ claims: [['confirmed', ['s1']]], reader: { status: 'done', token: 'rt1', result: okReading({ not_read: ['parts/p1/elementary-long.md'], learning: { verdict: 'problem', reason: 'r' } }) } }));
    expect(t.items.map((i) => [i.id, i.severity, i.title])).toEqual([
      ['learning', 'fix', '学習とのつながりが弱い'],
      ['reader:reader_partial:explanation_and_expression', 'ask', '読み手チェックが全部を読めていない: 説明と表現（子どもの画面を見て決めてください）'],
      ['reader:reader_partial:relation_to_learning', 'ask', '読み手チェックが全部を読めていない: 学習との関係'],
      ['reader:reader_partial:conditions_of_use', 'ask', '読み手チェックが全部を読めていない: 使う条件'],
    ]);
  });
  it('<material> の節を切った版（not_read が [material.json]）→ reader_partial の ask 3 件で gate attention・読み手係の auto 3 項目は review（自動公開は通らない）', () => {
    const t = triageVersion(build({ claims: [['confirmed', ['s1']]], reader: { status: 'done', token: 'rt1', result: okReading({ not_read: ['material.json'] }) } }));
    expect(t.items.map((i) => [i.id, i.severity, i.cause, i.detail])).toEqual([
      ['reader:reader_partial:explanation_and_expression', 'ask', 'reader_partial', 'material.json'],
      ['reader:reader_partial:relation_to_learning', 'ask', 'reader_partial', 'material.json'],
      ['reader:reader_partial:conditions_of_use', 'ask', 'reader_partial', 'material.json'],
    ]);
    expect(t.gate).toBe('attention');
    expect([t.auto.explanation_and_expression, t.auto.relation_to_learning, t.auto.conditions_of_use]).toEqual(['review', 'review', 'review']);
    expect(t.action).toBe('none');
  });

  it('reader_json が壊れている（done なのに読めない）版は failed と同じ 3 項目の ask。例外を投げない', () => {
    for (const result of [null, 'x', { findings: 'x' }, { findings: [{ kind: 'bad' }], learning: { verdict: 'ok' }, conditions: { verdict: 'ok' } }]) {
      const t = triageVersion(build({ claims: [['confirmed', ['s1']]], reader: { status: 'done', token: 'rt1', result } }));
      expect(t.items.map((i) => i.cause)).toEqual(['reader_failed', 'reader_failed', 'reader_failed']);
      expect(t.auto.relation_to_learning).toBe('review');
    }
  });
});

describe('割合の項目（契約 V-6 c。report があり主張が 5 件以上の時だけ）', () => {
  const hyp = (h: number, n: number): Array<[V, string[], PA]> => Array.from({ length: n }, (_, i) => [i < h ? 'hypothesis' : 'confirmed', ['s1'], 'hedged']);
  it('hypothesis 6/16（全部 hedged）→ check:many_hypotheses の fix で auto_return。回数を使い切った後も gate は attention', () => {
    const t = triageVersion(build({ claims: hyp(6, 16) }));
    expect(t.items.find((i) => i.id === 'check:many_hypotheses')).toMatchObject({ kind: 'check', key: 'content_and_evidence', severity: 'fix', title: '仮説の主張が 3 分の 1 を超えている', detail: '仮説 6 件 / 全 16 件' });
    expect(t.reasons).toEqual(['many_hypotheses', 'needs_fix']);
    expect(t.action).toBe('auto_return');
    const used = triageVersion(build({ claims: hyp(6, 16), autoRounds: 2 }));
    expect([used.action, used.gate]).toEqual(['none', 'attention']);
  });
  it('hypothesis がちょうど 1/3（5/15）→ 項目なし。主張 4 件で hypothesis 2 件 → 割合の項目なし', () => {
    expect(triageVersion(build({ claims: hyp(5, 15) })).items.filter((i) => i.kind === 'check')).toEqual([]);
    expect(triageVersion(build({ claims: hyp(2, 4) })).items.filter((i) => i.kind === 'check')).toEqual([]);
  });
  it('confirmed が半分に届かない（新しい検証）→ check:few_confirmed / ちょうど半分 → 項目なし', () => {
    const mix = (n: number, m: number): Array<[V, string[], PA]> => Array.from({ length: n }, (_, i) => [i < m ? 'confirmed' : 'hypothesis', ['s1'], 'hedged']);
    expect(triageVersion(build({ claims: mix(10, 4) })).items.find((i) => i.id === 'check:few_confirmed')).toMatchObject({ detail: '確か 4 件 / 全 10 件', title: '確かめられた主張が半分に届かない' });
    expect(triageVersion(build({ claims: mix(10, 5) })).items.some((i) => i.id === 'check:few_confirmed')).toBe(false);
  });
  it('引用の不一致が過半（動画でない出典）→ check:quote_mismatch_many の fix（検証の新旧に関係なく）。ちょうど半分 → 項目なし', () => {
    const sources: Record<string, Partial<TriageSource>> = {};
    for (let i = 1; i <= 4; i++) sources[`s${i}`] = { quote_found: i <= 3 ? 0 : 1 };
    const claims: Array<[V, string[], PA]> = Array.from({ length: 5 }, () => ['confirmed', ['s4'], null]);
    for (const isNew of [true, false]) {
      const t = triageVersion(build({ claims, sources, isNew, evidenceReverified: 1 }));
      expect(t.items.find((i) => i.id === 'check:quote_mismatch_many')).toMatchObject({ severity: 'fix', title: '引用が本文と一致しない出典が多い', detail: '3 件 / 全 4 件' });
    }
    sources.s3 = { quote_found: 1 };
    expect(triageVersion(build({ claims, sources })).items.some((i) => i.id === 'check:quote_mismatch_many')).toBe(false);
  });
});

describe('gate・自動 OK・action（契約 V-6 d・e・f）', () => {
  /** v6 相当: confirmed 13・hypothesis 3（hedged 2・analogy 1）・読み手 ok・app ok・動画のチャンネルが確認済み */
  const v6 = (o: Partial<Spec> = {}): Spec => ({
    claims: [
      ...Array.from({ length: 13 }, () => ['confirmed', ['s1'], 'fact'] as [V, string[], PA]),
      ['hypothesis', ['s1'], 'hedged'],
      ['hypothesis', ['s1'], 'hedged'],
      ['hypothesis', ['s1'], 'analogy'],
    ],
    sources: { s1: {}, s9: { url: WATCH, url_was_fetched: 0, quote_found: 0 } },
    material: mat({ app: true, video: true }),
    apps: [{ path: 'parts/p1/app.html', verdict: 'ok', reason: '' }],
    videos: [{ id: 'v1', verdict: 'ok', reason: '' }],
    videoMeta: [{ video_id: 'v1', outcome: 'ok', author_name: '公式', author_url: CH, channel_match: 'match' }],
    trusted: [CH],
    ...o,
  });
  it('v6 相当 → gate clean・項目は note 3 件・trusted_keys にその key・6 項目とも ok', () => {
    const t = triageVersion(build(v6()));
    expect(t.gate).toBe('clean');
    expect(t.items.map((i) => [i.severity, i.cause])).toEqual([
      ['note', 'hypothesis_hedged'],
      ['note', 'hypothesis_hedged'],
      ['note', 'analogy'],
    ]);
    expect(t.trusted_keys).toEqual([CH]);
    expect(CHECK_KEYS.every((k) => t.auto[k] === 'ok')).toBe(true);
    expect(t.counts).toEqual({ fix: 0, ask: 0, note: 3, claims_ok: 16, sources_ok: 2 });
    expect([t.action, t.reasons, t.pending_on, t.reader_gen, t.trusted_gen]).toEqual(['none', [], [], 'rt1', '3']);
  });
  it('同じでチャンネルが初めて → attention・ask 1 件・auto_return しない', () => {
    const t = triageVersion(build(v6({ trusted: [] })));
    expect(t.gate).toBe('attention');
    expect(t.items.filter((i) => i.severity === 'ask').map((i) => [i.cause, i.channel_key, i.channel_name])).toEqual([['video_channel_new', CH, '公式']]);
    expect(t.action).toBe('none');
    expect(t.auto.terms_of_use).toBe('review');
  });
  it('unverified 1 件・autoRounds 0 → auto_return（return_note の固定文）/ autoRounds 2 → none・gate attention', () => {
    const spec = v6();
    spec.claims[0] = ['unverified', ['s1'], null];
    const t = triageVersion(build(spec));
    expect(t.action).toBe('auto_return');
    expect(t.return_note!.split('\n')).toEqual([
      '自動の差し戻し（1 回目。機械の確認で、直す所が見つかりました）。',
      NOTE_SCOPE,
      NOTE_CLAIMS,
      RETURN_FIXED_TEXT,
      '- 〔内容と根拠〕出典で確かめられなかった（主張 c1）。理由 1',
    ]);
    const used = triageVersion(build({ ...spec, autoRounds: 2 }));
    expect([used.action, used.gate, used.return_note]).toEqual(['none', 'attention', null]);
    expect([used.auto_rounds, used.auto_return_max]).toEqual([2, 2]);
  });
  it('読み手 pending → gate pending・pending_on [reader]・action none（fix があっても）/ report が読めない → pending_on に verification', () => {
    const p = triageVersion(build({ claims: [['contradicted', ['s1']]], reader: { status: 'pending', token: null, result: null } }));
    expect([p.gate, p.pending_on, p.action]).toEqual(['pending', ['reader'], 'none']);
    const r = triageVersion(build({ claims: [['confirmed', ['s1']]], reader: { status: 'running', token: 't', result: null }, report: 'broken' }));
    expect([r.gate, r.pending_on]).toEqual(['pending', ['verification', 'reader']]);
    expect(triageVersion(build({ claims: [['confirmed', ['s1']]], report: false })).pending_on).toEqual(['verification']);
    expect(triageVersion(build({ claims: [['confirmed', ['s1']]], verificationStatus: 'running' })).pending_on).toEqual(['verification']);
  });
  it('古い検証で hypothesis あり・evidenceReverified 0 → reverify（evidence）/ 1 → ask（hypothesis_unjudged）だけで差し戻さない', () => {
    const spec: Spec = { claims: [['confirmed', ['s1']], ['hypothesis', ['s1']]], isNew: false };
    const a = triageVersion(build(spec));
    expect([a.action, a.reverify_kind]).toEqual(['reverify', 'evidence']);
    const b = triageVersion(build({ ...spec, evidenceReverified: 1 }));
    expect([b.action, b.reverify_kind, b.items.map((i) => [i.severity, i.cause])]).toEqual(['none', null, [['ask', 'hypothesis_unjudged']]]);
    // 動かせるものがある古い検証も evidence（全部 confirmed でも）
    expect(triageVersion(build({ claims: [['confirmed', ['s1']]], isNew: false, material: mat({ app: true }), apps: null })).reverify_kind).toBe('evidence');
  });
  it('verifier_limit → reverify（limit）。使用済みなら ask のまま差し戻さない。evidence と両方当たる時は evidence', () => {
    const spec: Spec = { claims: [['confirmed', ['s1']], ['unverified', ['s1']]], fetchErrors: { max_uses_exceeded: 2 } };
    expect(triageVersion(build(spec)).reverify_kind).toBe('limit');
    const used = triageVersion(build({ ...spec, autoReverified: 1 }));
    expect([used.action, used.items.map((i) => i.cause)]).toEqual(['none', ['verifier_limit']]);
    expect(triageVersion(build({ ...spec, isNew: false })).reverify_kind).toBe('evidence');
  });
  it('AUTO_RETURN_MAX の丸め（0・2・5・11・数でない）', () => {
    expect([0, '0', '2', 5, '11', 11, -3, '2.7', 'x', '', undefined, null].map(clampAutoReturnMax)).toEqual([0, 0, 2, 5, 5, 5, 0, 2, 2, 2, 2, 2]);
    const spec: Spec = { claims: [['unverified', ['s1']]], autoReturnMax: '0' };
    expect(triageVersion(build(spec)).action).toBe('none');
  });
  it('blocking の項目（contradicted）も回数が残っていれば auto_return', () => {
    expect(triageVersion(build({ claims: [['contradicted', ['s1']]] })).action).toBe('auto_return');
  });
});

describe('return_note（契約 V-6 g）', () => {
  it('many_hypotheses の時に仮説を増やさない文が入り、「hypothesis にする」の文に 3 分の 1 の条件が付く', () => {
    const claims: Array<[V, string[], PA]> = Array.from({ length: 9 }, (_, i) => [i < 4 ? 'hypothesis' : 'confirmed', ['s1'], 'hedged']);
    const lines = triageVersion(build({ claims })).return_note!.split('\n');
    expect(lines.slice(0, 5)).toEqual(['自動の差し戻し（1 回目。機械の確認で、直す所が見つかりました）。', NOTE_SCOPE, NOTE_CLAIMS, NOTE_MANY_HYP(4, 9), RETURN_FIXED_TEXT]);
    expect(lines[2]).toContain('（hypothesis の claim が全体の 3 分の 1 を超えない時だけ）');
  });
  it('license_unknown だけの時は主張の文が入らず、利用条件の文だけ', () => {
    const lines = triageVersion(build({ claims: [['confirmed', ['s1']]], sources: { s1: { license: 'unknown' } } })).return_note!.split('\n');
    expect(lines).toEqual(['自動の差し戻し（1 回目。機械の確認で、直す所が見つかりました）。', NOTE_SCOPE, NOTE_LICENSE, '- 〔利用条件〕利用条件が分からない']);
  });
  it('本文・読み手係の項目がある時は子ども向けの本文の文。項目の行は 場所・引用・直し方の案 つき。同じ文を 2 回入れない', () => {
    const reader = {
      status: 'done',
      token: 'rt1',
      result: okReading({ findings: [{ path: 'parts/p1/elementary-short.md', quote: 'レッドストーン', kind: 'word', severity: 'fix', note: '読めない', suggestion: 'ひらがなに' }] }),
    };
    const checks = { ...GREEN_CHECKS, child_text: [{ path: 'parts/p1/elementary-short.md', kind: 'file_name', sample: 'app.html を開く' }] };
    const lines = triageVersion(build({ claims: [['confirmed', ['s1']]], reader, checks })).return_note!.split('\n');
    expect(lines).toEqual([
      '自動の差し戻し（1 回目。機械の確認で、直す所が見つかりました）。',
      NOTE_SCOPE,
      NOTE_TEXT,
      '- 〔説明と表現〕本文にファイル名が出ている — parts/p1/elementary-short.md「app.html を開く」',
      '- 〔説明と表現〕言葉がむずかしい — parts/p1/elementary-short.md「レッドストーン」。読めない 直し方の案: ひらがなに',
    ]);
  });
  it('2 回目の差し戻しは「2 回目」。4,000 字で切れて「（ほか k 件）」', () => {
    const items: TriageItem[] = Array.from({ length: 50 }, (_, i) => ({
      id: `claim:c${i}`,
      kind: 'claim',
      key: 'content_and_evidence',
      severity: 'fix',
      cause: 'not_confirmed',
      title: '出典で確かめられなかった',
      detail: 'あ'.repeat(200),
      claim_id: `c${i}`,
    }));
    const note = buildReturnNote(items, 1, { h: 0, n: 50 });
    expect(note.length).toBeLessThanOrEqual(RETURN_NOTE_MAX);
    const lines = note.split('\n');
    expect(lines[0]).toBe('自動の差し戻し（2 回目。機械の確認で、直す所が見つかりました）。');
    const shown = lines.filter((l) => l.startsWith('- 〔')).length;
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(50);
    expect(lines[lines.length - 1]).toBe(`（ほか ${50 - shown} 件）`);
  });
});

describe('性質と例外を投げないこと', () => {
  it('作った入力の組すべてで「gate が clean なら fix・ask が 0 件で reasons が空」「bad なら fix が 1 件以上」', () => {
    const verdicts: V[] = ['confirmed', 'hypothesis', 'unverified', 'contradicted', ''];
    const pas: PA[] = ['fact', 'hedged', 'analogy', 'not_in_text', null];
    const readers: Array<TriageInput['reader']> = [
      { status: 'done', token: 'a', result: okReading() },
      { status: 'done', token: 'a', result: okReading({ findings: [{ path: '', quote: 'q', kind: 'other', severity: 'note', note: '', suggestion: '' }] }) },
      { status: 'done', token: 'a', result: okReading({ learning: { verdict: 'unclear', reason: '' } }) },
      { status: 'failed', token: 'a', result: null },
      { status: 'pending', token: null, result: null },
    ];
    let n = 0;
    for (const v1 of verdicts)
      for (const pa of pas)
        for (const reader of readers)
          for (const isNew of [true, false])
            for (const license of ['CC BY', 'unknown']) {
              const t = triageVersion(build({ claims: [[v1, ['s1'], pa], ['confirmed', ['s1'], null]], sources: { s1: { license } }, reader, isNew, material: mat({ app: n % 2 === 0 }), apps: n % 3 === 0 ? null : [{ path: 'parts/p1/app.html', verdict: 'ok', reason: '' }] }));
              n++;
              if (t.gate === 'clean') {
                expect(t.items.filter((i) => i.severity !== 'note')).toEqual([]);
                expect(t.reasons).toEqual([]);
              }
              if (t.bad) expect(t.counts.fix).toBeGreaterThan(0);
              expect(t.needs_review).toBe(t.counts.fix + t.counts.ask);
            }
    expect(n).toBe(500);
  });
  it('checks_json.child_text が無い・reader_json が壊れている・apps が無い入力で例外を投げない', () => {
    const { child_text: _c, ...oldChecks } = GREEN_CHECKS;
    expect(() => triageVersion(build({ claims: [['confirmed', ['s1']]], checks: oldChecks, reader: { status: 'done', token: 'x', result: '壊れた' }, apps: null, material: mat({ app: true }) }))).not.toThrow();
    expect(() => triageVersion({ claims: 'x', report: { id: 'w', result: { verdicts: 'x', figures: 3, apps: {}, videos: 'x', meta: 1 } }, sources: [], checks: 1, material: 'x', autoReverified: 0 })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------------------------
// 互換で残した groups・ok_counts（§L-3 のまま。§L-7 (l1)）

describe('groups（§L-3 のまま）', () => {
  const keyOf = (g: { source_id: string | null; cause: string }) => `${g.source_id}|${g.cause}`;
  /** 版 1 相当: 25 claims（confirmed は c1 だけ・他は unverified）、出典 8 件、claim i は出典 s((i-1)%8+1)、quote_found=1 は qOk の出典だけ */
  const version1 = (qOk: string[]): Spec => {
    const sources: Record<string, Partial<TriageSource>> = {};
    for (let i = 1; i <= 8; i++) sources[`s${i}`] = { quote_found: qOk.includes(`s${i}`) ? 1 : 0 };
    return { claims: Array.from({ length: 25 }, (_, i) => [i === 0 ? 'confirmed' : 'unverified', [`s${(i % 8) + 1}`]] as [V, string[]]), sources };
  };
  it('版 1 相当 → group は (出典, 原因) ごと、claim は出典ごとに入る', () => {
    const t = triageVersion(build(version1(['s1', 's2'])));
    const keys = t.groups.map(keyOf);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.sort()).toEqual(['s1|not_confirmed', 's2|not_confirmed', 's3|quote_mismatch', 's4|quote_mismatch', 's5|quote_mismatch', 's6|quote_mismatch', 's7|quote_mismatch', 's8|quote_mismatch']);
    expect(t.groups.find((g) => keyOf(g) === 's1|not_confirmed')!.claim_ids).toEqual(['c9', 'c17', 'c25']);
    expect(t.groups.find((g) => keyOf(g) === 's3|quote_mismatch')!.claim_ids).toEqual(['c3', 'c11', 'c19']);
    // v2 の項目と reasons
    expect(t.reasons).toEqual(['few_confirmed', 'quote_mismatch_many', 'needs_fix']);
    expect(t.action).toBe('auto_return');
  });
  it('全緑 → group なし・ok_counts は全部', () => {
    const t = triageVersion(build({ claims: [['confirmed', ['s1']], ['confirmed', ['s1', 's2']]], sources: { s1: {}, s2: {} } }));
    expect(t.groups).toEqual([]);
    expect(t.ok_counts).toEqual({ claims: 2, sources: 2 });
    expect(t.verification_id).toBe('w1');
  });
  it('confirmed でも source_ids=[] → no_source の group（source_id / url は null）', () => {
    const t = triageVersion(build({ claims: [['confirmed', ['s1']], ['confirmed', []]], sources: { s1: {} } }));
    expect(t.groups).toEqual([{ cause: 'no_source', source_id: null, url: null, verifier_opened_urls: [], claim_ids: ['c2'] }]);
  });
  it('原因の優先順（contradicted → source_not_listed → maker_url_not_fetched → quote_mismatch → verifier_limit → not_confirmed）', () => {
    const g = (verdict: V, sid: string, src: Record<string, Partial<TriageSource>>, fe: Record<string, number> = { too_many_requests: 1 }) =>
      triageVersion(build({ claims: [[verdict, [sid]]], sources: src, fetchErrors: fe })).groups.filter((x) => x.claim_ids.includes('c1')).map(keyOf);
    expect(g('contradicted', 's1', { s1: { url_was_fetched: 0, quote_found: 0, license: 'unknown' } })).toEqual(['s1|contradicted']);
    expect(g('unverified', 's9', { other: {} })).toEqual(['s9|source_not_listed']);
    expect(g('unverified', 's1', { s1: { url_was_fetched: 0, quote_found: 0 } })).toEqual(['s1|maker_url_not_fetched']);
    expect(g('hypothesis', 's1', { s1: { quote_found: 0 } })).toEqual(['s1|quote_mismatch']);
    expect(g('unverified', 's1', { s1: {} })).toEqual(['s1|verifier_limit']);
    expect(g('unverified', 's1', { s1: {} }, {})).toEqual(['s1|not_confirmed']);
  });
  it('report null → claim の group なし（出典だけの group は出す）', () => {
    const t = triageVersion(build({ ...version1(['s1', 's2']), report: false }));
    expect(t.verification_id).toBeNull();
    expect(t.groups.every((x) => x.claim_ids.length === 0)).toBe(true);
    expect(t.groups.map(keyOf)).toEqual(['s3|quote_mismatch', 's4|quote_mismatch', 's5|quote_mismatch', 's6|quote_mismatch', 's7|quote_mismatch', 's8|quote_mismatch']);
  });
  it('原因の文は §L-6 の表と一字も違わない', () => {
    expect(CAUSE_TEXT).toEqual(CONTRACT_CAUSE_TEXT);
  });
});
