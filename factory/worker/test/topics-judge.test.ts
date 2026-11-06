// contract-T T-14 b3: judgeCheck（純関数）と、検査の出力の id の過不足（parseCheckOutput）
import { describe, expect, it } from 'vitest';
import { judgeCheck, parseCheckOutput, type CheckOutput, type JudgeSourceRow } from '../src/topics/judge';
import { checkIn, makeBody, newsBody, philoBody } from './topics-helpers';

const D = '2026-11-07';
const out = (o: Partial<CheckOutput> & { ids?: string[] } = {}): CheckOutput => ({ ...(checkIn(o.ids ?? []) as CheckOutput), ...o });
const rows = (r: Record<string, JudgeSourceRow['fetch_result']>): JudgeSourceRow[] => Object.entries(r).map(([source_id, fetch_result]) => ({ source_id, fetch_result }));

describe('judgeCheck', () => {
  it('必須の出典 0 個 + flags あり → 赤（flagged）・sourcesOk は true・承認できる', () => {
    const j = judgeCheck(makeBody(), [], out({ flags: ['one_sided'] }), 'normal', { slotDay: D });
    expect(j.verdict).toBe('red');
    expect(j.sourcesOk).toBe(true);
    expect(j.reasons).toEqual(['flagged:one_sided']);
    expect(j.approvable).toBe(true);
    expect(j.holdReason).toBe('flagged');
  });

  it.each([
    ['not_found', 'source_not_found'],
    ['fetch_failed', 'source_unreachable'],
    ['blocked', 'source_unreachable'],
    ['pending', 'source_unreachable'],
  ] as const)('必須が %s → 赤・sourcesOk = false（%s）・承認できない', (fr, reason) => {
    const j = judgeCheck(newsBody(D), rows({ s1: fr }), out({ ids: [] }), 'normal', { slotDay: D });
    expect(j.verdict).toBe('red');
    expect(j.sourcesOk).toBe(false);
    expect(j.reasons).toContain(reason);
    expect(j.approvable).toBe(false);
    expect(j.holdReason).toBe(reason);
  });

  it.each(['unsupported', 'unclear'] as const)('必須が found でも support = %s → 赤・source_unsupported・sourcesOk = false', (support) => {
    const j = judgeCheck(newsBody(D), rows({ s1: 'found' }), out({ sources: [{ source_id: 's1', support }] }), 'normal', { slotDay: D });
    expect(j.verdict).toBe('red');
    expect(j.sourcesOk).toBe(false);
    expect(j.reasons).toEqual(['source_unsupported']);
    expect(j.approvable).toBe(false);
  });

  it('全部そろって緑（重くない → holdReason なし = 自動 ready へ）', () => {
    const j = judgeCheck(philoBody(), rows({ s1: 'found', s2: 'found' }), out({ ids: ['s1', 's2'] }), 'normal', { slotDay: D });
    expect(j).toEqual({ verdict: 'green', sourcesOk: true, approvable: true, holdReason: null, sensitivity: 'normal', reasons: [] });
  });

  it('緑でもモデルが heavy → held: heavy。保存済みが heavy なら今回 normal でも heavy のまま', () => {
    expect(judgeCheck(newsBody(D), rows({ s1: 'found' }), out({ ids: ['s1'], sensitivity: 'heavy' }), 'normal', { slotDay: D })).toMatchObject({ verdict: 'green', holdReason: 'heavy', sensitivity: 'heavy' });
    expect(judgeCheck(newsBody(D), rows({ s1: 'found' }), out({ ids: ['s1'] }), 'heavy', { slotDay: D })).toMatchObject({ verdict: 'green', holdReason: 'heavy', sensitivity: 'heavy' });
  });

  it('形・禁止語の赤は承認できない（禁止語と flags の両方でも承認できない）', () => {
    const forb = makeBody();
    forb.lead = { s: 'みんなの点数を比べる', e: 'てんすう' };
    const j = judgeCheck(forb, [], null, 'normal', { slotDay: D });
    expect(j.reasons).toEqual(['forbidden']);
    expect(j.approvable).toBe(false);
    expect(j.holdReason).toBe('forbidden');
    const j2 = judgeCheck(forb, [], out({ flags: ['one_sided'] }), 'normal', { slotDay: D });
    expect(j2.reasons).toEqual(['forbidden', 'flagged:one_sided']);
    expect(j2.approvable).toBe(false);
    const sch = judgeCheck({ ...newsBody(D), facts: [] }, rows({ s1: 'found' }), null, 'normal', { slotDay: D });
    expect(sch.holdReason).toBe('schema');
    expect(sch.approvable).toBe(false);
  });

  it('holdReason の順: schema > forbidden > source_not_found > source_unreachable > source_unsupported > flagged > heavy', () => {
    const p = philoBody();
    const j = judgeCheck(p, rows({ s1: 'not_found', s2: 'fetch_failed' }), out({ ids: [], flags: ['scary_wording'] }), 'heavy', { slotDay: D });
    expect(j.holdReason).toBe('source_not_found');
    expect(j.reasons).toEqual(['source_not_found', 'source_unreachable', 'flagged:scary_wording']);
  });
});

describe('parseCheckOutput: 渡した抜き書きの id と過不足なく対応しなければ無効', () => {
  const base = { sensitivity: 'normal', heavy_reasons: [], flags: [], note: 'n' };
  it('ちょうど対応すれば有効', () => {
    expect(parseCheckOutput({ ...base, sources: [{ source_id: 's1', support: 'supported' }] }, ['s1'])).not.toBeNull();
    expect(parseCheckOutput({ ...base, sources: [] }, [])).not.toBeNull();
  });
  it('足りない・余分・重複・形違いは null', () => {
    expect(parseCheckOutput({ ...base, sources: [] }, ['s1'])).toBeNull();
    expect(parseCheckOutput({ ...base, sources: [{ source_id: 's1', support: 'supported' }, { source_id: 's2', support: 'supported' }] }, ['s1'])).toBeNull();
    expect(parseCheckOutput({ ...base, sources: [{ source_id: 's1', support: 'supported' }, { source_id: 's1', support: 'supported' }] }, ['s1'])).toBeNull();
    expect(parseCheckOutput({ ...base, sources: [{ source_id: 's1', support: 'maybe' }] }, ['s1'])).toBeNull();
    expect(parseCheckOutput({ ...base, sensitivity: 'mild', sources: [] }, [])).toBeNull();
    expect(parseCheckOutput({ ...base, flags: ['unknown_flag'], sources: [] }, [])).toBeNull();
    expect(parseCheckOutput({ sources: [] }, [])).toBeNull();
    expect(parseCheckOutput(null, [])).toBeNull();
  });
});
