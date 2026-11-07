// §MC 版が決まっている題材（Minecraft）: MC-1 判定と宣言（src/checks/edition.ts）・MC-1 3 本文の版の 1 文（childtext の edition_text）・
// MC-2 仕分けの項目（edition_missing / edition_not_java / video_too_old / video_date_unknown / edition_text_missing）と差し戻し文。
// 反対側: 版が決まっていない題材では、同じ動画・同じ tools・同じ本文でも項目が出ない。
import { describe, expect, it } from 'vitest';
import { declaredEdition, isVersionBoundMaterial, isVideoTooOld, VERSION_BOUND_VIDEO_MAX_AGE_DAYS } from '../src/checks/edition';
import { checkChildText } from '../src/checks/childtext';
import { CAUSE_TEXT, triageVersion, type TriageInput, type TriageVideoMeta } from '../src/checks/triage';

type Obj = Record<string, any>;

const YT = 'abcdefghijk';
const WATCH = `https://www.youtube.com/watch?v=${YT}`;
const CH = 'https://www.youtube.com/@official';
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 7, 3, 0, 0);
const daysAgo = (n: number) => new Date(NOW - n * DAY).toISOString().slice(0, 10);

const V = (audience: string, length: string, game = false, path?: string) => ({ audience, length, interest: null, game, path: path ?? `parts/p1/${audience}-${length}.md` });
const PATHS = ['parts/p1/elementary-short.md', 'parts/p1/elementary-long.md', 'parts/p1/secondary-short.md', 'parts/p1/secondary-long.md', 'parts/p1/game.md'];

/** 素材（既定は版の決まっていない題材: 光の題材）。o で上書き */
function material(o: Obj = {}): Obj {
  return {
    schema_version: 1,
    slug: 'light-basics',
    title: '光のしくみ',
    kinds: [3],
    catalog_item_id: 'sci-light',
    concept_codes: [],
    summary_elementary: '光が進む',
    summary_secondary: '光の進み方',
    parts: [
      {
        id: 'p1',
        kind: 3,
        title: '光の道',
        entry_point: { type: 'look', text: '図をたどる' },
        variants: [V('elementary', 'short'), V('elementary', 'long'), V('secondary', 'short'), V('secondary', 'long'), V('elementary', 'short', true, 'parts/p1/game.md')],
        files: [{ path: 'parts/p1/figure-1.svg', role: 'figure' }],
        adjustable: ['例'],
        tech_dependencies: ['svg'],
        needs_supporter_check: false,
      },
    ],
    ...o,
  };
}
const mc = (tools?: unknown, o: Obj = {}) =>
  material({ slug: 'mc-redstone-basics', title: 'レッドストーン回路のしくみ', catalog_item_id: 'mc-redstone', ...(tools === undefined ? {} : { conditions: { tools } }), ...o });
const withVideo = (m: Obj): Obj => {
  m.parts[0].videos = [{ id: 'v1', youtube_id: YT, title: '動画', channel: '公式', start_sec: 10, end_sec: 70, why: '信号', rights_note: '本人', source_id: 's9' }];
  return m;
};

describe('MC-1 isVersionBoundMaterial', () => {
  it('mc- の catalog / 題名・slug のマイクラ / tools の Minecraft → true', () => {
    expect(isVersionBoundMaterial(material({ catalog_item_id: 'mc-redstone' }))).toBe(true);
    expect(isVersionBoundMaterial(material({ title: 'マイクラで学ぶ回路' }))).toBe(true);
    expect(isVersionBoundMaterial(material({ title: 'マインクラフトの村' }))).toBe(true);
    expect(isVersionBoundMaterial(material({ slug: 'minecraft-farm' }))).toBe(true);
    expect(isVersionBoundMaterial(material({ conditions: { tools: ['タブレット', 'Minecraft Education'] } }))).toBe(true);
  });
  it('どれにも当たらない・読めない → false（catalog の mc は先頭の mc- だけ）', () => {
    expect(isVersionBoundMaterial(material())).toBe(false);
    expect(isVersionBoundMaterial(material({ catalog_item_id: 'sci-mc-light' }))).toBe(false);
    expect(isVersionBoundMaterial(material({ catalog_item_id: null }))).toBe(false);
    expect(isVersionBoundMaterial(null)).toBe(false);
    expect(isVersionBoundMaterial('mc-x')).toBe(false);
    expect(isVersionBoundMaterial([])).toBe(false);
  });
});

describe('MC-1 declaredEdition', () => {
  it('Java 版の 3 つの書き方 → java と版番号', () => {
    expect(declaredEdition(mc(['Minecraft Java 版 26.3']))).toEqual({ edition: 'java', version: '26.3' });
    expect(declaredEdition(mc(['Minecraft Java Edition 1.21.4']))).toEqual({ edition: 'java', version: '1.21.4' });
    expect(declaredEdition(mc(['Minecraft（Java 版）26.3']))).toEqual({ edition: 'java', version: '26.3' });
  });
  it('統合版・Bedrock → bedrock', () => {
    expect(declaredEdition(mc(['Minecraft 統合版 1.21']))).toEqual({ edition: 'bedrock', version: '1.21' });
    expect(declaredEdition(mc(['Minecraft Bedrock 1.21']))).toEqual({ edition: 'bedrock', version: '1.21' });
  });
  it('Minecraft だけ・版番号なし・edition なし・tools なし → null', () => {
    expect(declaredEdition(mc(['Minecraft']))).toBeNull();
    expect(declaredEdition(mc(['Minecraft Java 版']))).toBeNull();
    expect(declaredEdition(mc(['Minecraft 26.3']))).toBeNull();
    expect(declaredEdition(mc(['Java 26.3']))).toBeNull();
    expect(declaredEdition(mc())).toBeNull();
    expect(declaredEdition(mc('Minecraft Java 版 26.3'))).toBeNull();
    expect(declaredEdition(null)).toBeNull();
  });
  it('Astra R1: 版番号は edition の語（Java 版・Java Edition・Java・統合版・Bedrock Edition）の直後だけ。両方ある文字列は java が先', () => {
    const d = (t: string) => declaredEdition(mc([t]));
    expect(d('Minecraft Java 1.21')).toEqual({ edition: 'java', version: '1.21' });
    expect(d('Minecraft Bedrock Edition 1.21.50')).toEqual({ edition: 'bedrock', version: '1.21.50' });
    expect(d('Minecraft 統合版 1.21（Java 版ではない）')).toEqual({ edition: 'bedrock', version: '1.21' });
    expect(d('Minecraft Java 版 126.3.1')).toBeNull();
    expect(d('Minecraft 画面比 16.9 / Java 版 26.3')).toEqual({ edition: 'java', version: '26.3' });
    expect(d('Minecraft')).toBeNull();
    expect(d('JavaScript 1.2 と Minecraft')).toBeNull();
    expect(d('Minecraft Java 版 v26.3')).toEqual({ edition: 'java', version: '26.3' });
    expect(d('Minecraft Java Edition: 1.21.4')).toEqual({ edition: 'java', version: '1.21.4' });
  });
  it('文字列でない要素は飛ばし、宣言の文字列を探す', () => {
    expect(declaredEdition(mc([1, null, 'タブレット', 'Minecraft Java 版 26.3']))).toEqual({ edition: 'java', version: '26.3' });
  });
});

describe('MC-1 4 isVideoTooOld', () => {
  it('上限は 1095 日', () => expect(VERSION_BOUND_VIDEO_MAX_AGE_DAYS).toBe(1095));
  it('1095 日ちょうどは false、1096 日は true、新しい動画は false', () => {
    expect(isVideoTooOld(daysAgo(1095), NOW)).toBe(false);
    expect(isVideoTooOld(daysAgo(1096), NOW)).toBe(true);
    expect(isVideoTooOld(daysAgo(30), NOW)).toBe(false);
    expect(isVideoTooOld('2019-05-21', NOW)).toBe(true);
  });
  it('形が違えば false（「不明」は別に扱う）', () => {
    for (const bad of ['', '2019-5-21', '2019-05-21T00:00:00Z', '2019-02-30', 'abcd-ef-gh', null, undefined, 20190521])
      expect(isVideoTooOld(bad as unknown as string, NOW)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------

describe('MC-1 3 childtext の edition_text（本文の版の 1 文）', () => {
  const LINE = 'この説明は Java 版 26.3 のものです。';
  const bodies = (over: Record<string, string> = {}) => new Map(PATHS.map((p) => [p, over[p] ?? `${LINE}\n信号は進む`]));
  const edition = (m: Obj, t: Map<string, string>) => checkChildText(m, t).filter((h) => h.kind === 'edition_text');

  it('java 宣言ありで 1 つの変奏に「Java 版」が無い → その path の 1 件（sample は空）', () => {
    expect(edition(mc(['Minecraft Java 版 26.3']), bodies({ [PATHS[1]]: 'この説明は 26.3 のものです。' }))).toEqual([{ path: PATHS[1], kind: 'edition_text', sample: '' }]);
  });
  it('版番号が無い・別の版番号（26.31 は 26.3 ではない）→ その path', () => {
    expect(edition(mc(['Minecraft Java 版 26.3']), bodies({ [PATHS[0]]: 'この説明は Java 版のものです。', [PATHS[4]]: 'Java 版 26.31 で遊ぼう' })).map((h) => h.path)).toEqual([PATHS[0], PATHS[4]]);
  });
  it('Astra R1: 「Java 版 <版>」の並びだけを数える（離れた所の数字・別の版番号は数えない）', () => {
    const m = mc(['Minecraft Java 版 26.3']);
    expect(edition(m, bodies({ [PATHS[0]]: 'この説明は Java 版 26.3 のものです。' }))).toEqual([]);
    expect(edition(m, bodies({ [PATHS[0]]: 'Java 版の話。温度は26.3度。' })).map((h) => h.path)).toEqual([PATHS[0]]);
    expect(edition(m, bodies({ [PATHS[0]]: 'Java 版 26.30 の説明' })).map((h) => h.path)).toEqual([PATHS[0]]);
  });
  it('全部にある → 0 件（「Java版」の続け書きも通す）', () => {
    expect(edition(mc(['Minecraft Java 版 26.3']), bodies())).toEqual([]);
    expect(edition(mc(['Minecraft Java 版 26.3']), bodies({ [PATHS[2]]: 'Java版26.3 の話' }))).toEqual([]);
  });
  it('宣言なし・bedrock・版が決まっていない題材 → 0 件（本文を見ない）', () => {
    const none = new Map(PATHS.map((p) => [p, '信号は進む']));
    expect(edition(mc(), none)).toEqual([]);
    expect(edition(mc(['Minecraft']), none)).toEqual([]);
    expect(edition(mc(['Minecraft 統合版 1.21']), none)).toEqual([]);
    // 反対側: 版が決まっていない題材は tools に Java の文があっても見ない
    expect(edition(material({ conditions: { tools: ['Java 26.3'] } }), none)).toEqual([]);
    expect(checkChildText(material(), none)).toEqual([]);
  });
  it('20 件の上限は既存のまま（edition_text も数える）', () => {
    const m = mc(['Minecraft Java 版 26.3']);
    const many = Array.from({ length: 30 }, (_, i) => V('elementary', 'short', false, `parts/p1/x${i}.md`));
    m.parts[0].variants = many;
    const t = new Map(many.map((v) => [v.path, '信号は進む']));
    const hits = checkChildText(m, t);
    expect(hits).toHaveLength(20);
    expect(hits.every((h) => h.kind === 'edition_text')).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------

const GREEN_CHECKS = { schema: 'ok', forbidden: [], app_html: [], kakunin_zumi: [], missing_source_refs: [], missing_claim_refs: [], unreferenced_files: [], child_text: [] };
const okReading = () => ({ findings: [], learning: { verdict: 'ok', reason: '' }, conditions: { verdict: 'ok', reason: '' }, summary: '', not_read: [] });

function input(m: Obj, o: { videoMeta?: TriageVideoMeta[]; checks?: unknown; videos?: unknown; report?: boolean; autoRounds?: number } = {}): TriageInput {
  const hasVideo = Array.isArray(m.parts?.[0]?.videos) && m.parts[0].videos.length > 0;
  return {
    claims: { claims: [{ id: 'c1', text: '主張', status: 'confirmed', source_ids: ['s1'], used_in: ['p1'] }] },
    report:
      o.report === false
        ? null
        : {
            id: 'w1',
            result: {
              verdicts: [{ claim_id: 'c1', verdict: 'confirmed', reason: '', opened_urls: [], presented_as: null }],
              overall_note: '',
              figures: [{ path: 'parts/p1/figure-1.svg', verdict: 'ok', reason: '' }],
              analogy_gaps: [],
              videos: o.videos ?? (hasVideo ? [{ id: 'v1', verdict: 'ok', reason: '' }] : []),
              apps: [],
              meta: { mode: 'batch', turns: 1, fetch_errors: {}, fetched_ok: [], evidence_v: 2 },
            },
          },
    sources: [
      { source_id: 's1', url: 'https://example.org/a', license: 'CC BY-SA 3.0', url_was_fetched: 1, quote_found: 1, is_primary: 0 },
      ...(hasVideo ? [{ source_id: 's9', url: WATCH, license: 'YouTube', url_was_fetched: 0, quote_found: 0, is_primary: 0 }] : []),
    ],
    checks: o.checks ?? GREEN_CHECKS,
    material: m,
    autoReverified: 0,
    reader: { status: 'done', token: 'rt1', result: okReading() },
    videoMeta: o.videoMeta ?? [],
    trustedChannels: [CH],
    trustedGen: '1',
    autoRounds: o.autoRounds ?? 0,
    autoReturnMax: '2',
    verificationStatus: 'done',
    evidenceReverified: 0,
    now: NOW,
  };
}
const meta = (published: string | null | undefined): TriageVideoMeta[] => [
  { video_id: 'v1', outcome: 'ok', author_name: '公式', author_url: CH, channel_match: 'match', ...(published === undefined ? {} : { published }) } as TriageVideoMeta,
];
const mcItems = (t: ReturnType<typeof triageVersion>) =>
  t.items.filter((i) => i.id.startsWith('edition:') || i.id.endsWith(':age') || i.id.startsWith('text:edition_text:')).map((i) => [i.id, i.key, i.severity, i.cause]);

describe('MC-2 仕分け: 版の宣言', () => {
  it('version-bound で宣言なし → fix edition_missing（conditions_of_use）・auto_return・差し戻し文に『Minecraft Java 版』の文', () => {
    const t = triageVersion(input(mc()));
    expect(mcItems(t)).toEqual([['edition:missing', 'conditions_of_use', 'fix', 'edition_missing']]);
    const it0 = t.items.find((i) => i.id === 'edition:missing')!;
    expect(it0.title).toBe('使う条件に Minecraft の版（Java 版 ○○）が書かれていない');
    expect(t.action).toBe('auto_return');
    expect(t.auto.conditions_of_use).toBe('review');
    expect(t.return_note).toContain(
      '- 〔使う条件〕使う条件に Minecraft の版（Java 版 ○○）が書かれていない。conditions.tools に『Minecraft Java 版 <版>』の形で書く（最新の正式版は version manifest の latest.release）',
    );
  });
  it('report が無くても material から決まる（gate は pending のまま・項目は出る）', () => {
    const t = triageVersion(input(mc(), { report: false }));
    expect(mcItems(t)).toEqual([['edition:missing', 'conditions_of_use', 'fix', 'edition_missing']]);
    expect([t.gate, t.action]).toEqual(['pending', 'none']);
  });
  it('bedrock → fix edition_not_java', () => {
    const t = triageVersion(input(mc(['Minecraft 統合版 1.21'])));
    expect(mcItems(t)).toEqual([['edition:not_java', 'conditions_of_use', 'fix', 'edition_not_java']]);
    expect(t.items.find((i) => i.id === 'edition:not_java')!.title).toBe('Java 版でない版（統合版）を宣言している');
  });
  it('java 宣言・動画なし・本文の検査が緑 → 項目なし・gate clean', () => {
    const t = triageVersion(input(mc(['Minecraft Java 版 26.3'])));
    expect(mcItems(t)).toEqual([]);
    expect(t.gate).toBe('clean');
  });
});

describe('MC-2 仕分け: 動画の公開日', () => {
  const java = () => withVideo(mc(['Minecraft Java 版 26.3']));
  it('published が 4 年前 → fix video_too_old（terms_of_use）。差し戻し文に公開日の detail', () => {
    const pub = daysAgo(4 * 365);
    const t = triageVersion(input(java(), { videoMeta: meta(pub) }));
    expect(mcItems(t)).toEqual([['video:v1:age', 'terms_of_use', 'fix', 'video_too_old']]);
    const item = t.items.find((i) => i.id === 'video:v1:age')!;
    expect(item).toMatchObject({ kind: 'video', video_id: 'v1', title: '動画の公開日が 3 年より前（古い情報）' });
    expect(t.action).toBe('auto_return');
    expect(t.return_note).toContain(`- 〔利用条件〕動画の公開日が 3 年より前（古い情報）。公開日 ${pub} の動画。3 年以内の Java 版の動画に替えるか、動画なしにする`);
  });
  it('published 無し（null・key なし）→ ask video_date_unknown（自動では差し戻さない）', () => {
    for (const p of [null, undefined]) {
      const t = triageVersion(input(java(), { videoMeta: meta(p) }));
      expect(mcItems(t)).toEqual([['video:v1:age', 'terms_of_use', 'ask', 'video_date_unknown']]);
      expect(t.items.find((i) => i.id === 'video:v1:age')!.title).toBe('動画の公開日が取れていない');
      expect(t.action).toBe('none');
      expect(t.gate).toBe('attention');
    }
  });
  it('2 年前 → 項目なし。公式の情報が ok でない動画は公開日の項目を作らない（video_meta_unknown のまま）', () => {
    expect(mcItems(triageVersion(input(java(), { videoMeta: meta(daysAgo(2 * 365)) })))).toEqual([]);
    const t = triageVersion(input(java(), { videoMeta: [{ video_id: 'v1', outcome: 'not_found', author_name: null, author_url: null, channel_match: 'unknown', published: null }] }));
    expect(mcItems(t)).toEqual([]);
    expect(t.items.map((i) => i.cause)).toContain('video_meta_unknown');
  });
  it('反対側: 版が決まっていない題材では、同じ動画（4 年前・公開日なし）・同じ tools でも項目が出ない', () => {
    const plain = () => withVideo(material({ conditions: { tools: ['Java 26.3'] } }));
    for (const p of [daysAgo(4 * 365), null, undefined]) {
      const t = triageVersion(input(plain(), { videoMeta: meta(p) }));
      expect(mcItems(t)).toEqual([]);
      expect(t.gate).toBe('clean');
    }
    // 宣言の無い tools も（edition_missing は version-bound の時だけ）
    expect(mcItems(triageVersion(input(material())))).toEqual([]);
  });
});

describe('MC-2 仕分け: 本文の版の 1 文（edition_text_missing）', () => {
  const checks = (rows: unknown[]) => ({ ...GREEN_CHECKS, child_text: rows });
  it('child_text の edition_text → fix edition_text_missing（path つき）・差し戻し文に path と 1 文', () => {
    const t = triageVersion(input(mc(['Minecraft Java 版 26.3']), { checks: checks([{ path: PATHS[1], kind: 'edition_text', sample: '' }]) }));
    expect(mcItems(t)).toEqual([[`text:edition_text:${PATHS[1]}`, 'explanation_and_expression', 'fix', 'edition_text_missing']]);
    expect(t.items.find((i) => i.cause === 'edition_text_missing')).toMatchObject({ kind: 'text', path: PATHS[1], title: '本文に版（Java 版 ○○）の 1 文が無い' });
    expect(t.action).toBe('auto_return');
    expect(t.return_note).toContain(`本文に版（Java 版 ○○）の 1 文が無い — ${PATHS[1]}。${PATHS[1]} に『この説明は Java 版 26.3 のものです。』の 1 文を入れる`);
  });
  it('Astra R1 反対側: 版が決まっていない題材では child_text に edition_text があっても項目を作らない', () => {
    const t = triageVersion(input(material(), { checks: checks([{ path: PATHS[1], kind: 'edition_text', sample: '' }]) }));
    expect(mcItems(t)).toEqual([]);
    expect(t.gate).toBe('clean');
  });
  it('既存の file_name・raw_markup はそのまま。古い版（child_text 無し）は項目を作らない', () => {
    const t = triageVersion(input(mc(['Minecraft Java 版 26.3']), { checks: checks([{ path: PATHS[0], kind: 'file_name', sample: 'app.html' }]) }));
    expect(t.items.map((i) => [i.id, i.cause])).toEqual([['check:file_name:1', 'file_name']]);
    const { child_text: _c, ...old } = GREEN_CHECKS;
    expect(mcItems(triageVersion(input(mc(['Minecraft Java 版 26.3']), { checks: old })))).toEqual([]);
  });
});

describe('MC-2 CAUSE_TEXT（契約の文。verbatim）', () => {
  it('5 つの cause の文', () => {
    expect(CAUSE_TEXT).toMatchObject({
      edition_missing: '使う条件に Minecraft の版（Java 版 ○○）が書かれていない',
      edition_not_java: 'Java 版でない版（統合版）を宣言している',
      video_too_old: '動画の公開日が 3 年より前（古い情報）',
      video_date_unknown: '動画の公開日が取れていない',
      edition_text_missing: '本文に版（Java 版 ○○）の 1 文が無い',
    });
  });
});
