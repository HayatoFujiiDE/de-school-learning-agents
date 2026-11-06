// contract-T v2.5（司令塔の裁定 2026-11-06）: 子どもが読む文に英語の小文字が混ざったお題は held（気になる点）にして人へ回す（理由コード latin_mix）
import { describe, expect, it } from 'vitest';
import { hasLatinMix, judgeCheck, type CheckOutput, type JudgeSourceRow } from '../src/topics/judge';
import { TOPIC_REASON_LABELS } from '../src/topics/locale';
import { topicTexts } from '../src/topics/schema';
import { checkIn, makeBody, philoBody } from './topics-helpers';

const D = '2026-11-07';
const out = (o: Partial<CheckOutput> & { ids?: string[] } = {}): CheckOutput => ({ ...(checkIn(o.ids ?? []) as CheckOutput), ...o });
const rows = (r: Record<string, JudgeSourceRow['fetch_result']>): JudgeSourceRow[] => Object.entries(r).map(([source_id, fetch_result]) => ({ source_id, fetch_result }));
const greenPhilo = () => judgeCheck(philoBody(), rows({ s1: 'found', s2: 'found' }), out({ ids: ['s1', 's2'] }), 'normal', { slotDay: D });

describe('latin_mix', () => {
  it('前提: 手本のお題は緑（下の比較の基準）', () => {
    expect(greenPhilo()).toMatchObject({ verdict: 'green', holdReason: null, reasons: [] });
  });

  it.each([
    ['両方を use わける', true],
    ['Scratch で作る', true],
    ['JAXA の MMX', false],
    ['AI と一緒に作る', false],
    ['H3 ロケットで打ち上げた', false],
    ['ガイドライン（Ver.2.0）を公表した', false],
    ['10 g 以上の砂', false],
    ['use both', false], // 日本語の文字が無い文は対象外
  ] as const)('「%s」→ %s', (text, hit) => {
    const b = philoBody();
    b.stances[0].label = { s: '同じ船', e: text };
    expect(hasLatinMix(b)).toBe(hit);
  });

  it('当たったお題: 赤・held は flagged（気になる点）・人が承認できる・理由コード latin_mix', () => {
    const b = philoBody();
    b.stances[1].label = { s: '両方を組み合わせる', e: '両方を use わける' };
    const j = judgeCheck(b, rows({ s1: 'found', s2: 'found' }), out({ ids: ['s1', 's2'] }), 'normal', { slotDay: D });
    expect(j).toMatchObject({ verdict: 'red', sourcesOk: true, approvable: true, holdReason: 'flagged', reasons: ['latin_mix'] });
  });

  it('禁止語と一緒なら承認できない（forbidden が先）/ 出典の問題が先', () => {
    const b = makeBody();
    b.lead = { s: 'みんなの点数を比べる', e: 'みんなで use する' };
    const j = judgeCheck(b, [], null, 'normal', { slotDay: D });
    expect(j.reasons).toEqual(['forbidden', 'latin_mix']);
    expect(j).toMatchObject({ approvable: false, holdReason: 'forbidden' });
  });

  it('子どもが読む文のどこでも当たる（title / lead / premises / facts / views / asks / stances / next / make）', () => {
    const cases: Array<(b: ReturnType<typeof philoBody>) => void> = [
      (b) => { b.title = { s: b.title.s, e: 'ふねの name' }; },
      (b) => { b.lead = { s: 'リードに word がある', e: b.lead.e }; },
      (b) => { b.facts[0].text = { s: b.facts[0].text.s, e: 'じじつの text' }; },
      (b) => { b.views[0].who = { name: 'ある book の人', type: b.views[0].who.type }; },
      (b) => { b.views[0].stance = { s: b.views[0].stance.s, e: 'かんがえ the' }; },
      (b) => { b.asks[0].text = { s: b.asks[0].text.s, e: 'といの ask' }; },
      (b) => { b.next = { ...b.next!, make_steps: [b.next!.make_steps[0], { s: '二歩目', e: 'step にほめ' }, ...b.next!.make_steps.slice(2)] }; },
    ];
    for (const f of cases) {
      const b = philoBody();
      f(b);
      expect(hasLatinMix(b)).toBe(true);
    }
    const m = makeBody();
    m.make = { ...m.make!, need: { s: m.make!.need.s, e: 'けしごむと paper' } };
    expect(hasLatinMix(m)).toBe(true);
  });

  it('出典の name・quote・url と thumb_prompt は対象外（topicTexts に入らない）', () => {
    const b = philoBody();
    b.sources[0].name = '出典の name';
    b.sources[0].quote = 'この引用には english の語が入っているが、子どもが読む文ではない。';
    b.sources[0].url = 'https://example.org/path/word';
    expect(topicTexts(b).some((t) => t.includes('english') || t.includes('出典の name') || t.includes('example'))).toBe(false);
    expect(hasLatinMix(b)).toBe(false);
    const m = makeBody();
    m.make = { ...m.make!, thumb_prompt: '消しゴムの写真 with soft light' };
    expect(hasLatinMix(m)).toBe(false);
  });

  it('管理画面の理由の名前（meta の reasons）に latin_mix がある', () => {
    expect(TOPIC_REASON_LABELS.latin_mix).toBeTruthy();
  });
});
