// contract-T T-14 b1: validateTopicBody（T-1 の表の各行に通る例と落ちる例）と、system 文が契約の verbatim であること
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CHECK_SYSTEM_TEMPLATE, DERIVE_RULES, GEN_SYSTEM_TEMPLATE, genSystem, KIND_RULES } from '../src/topics/prompts';
import { addDays, isRealDate, normalizeTitle, requiredSourceIds, titleJaccard, validateTopicBody } from '../src/topics/schema';
import { loc, makeBody, newsBody, philoBody, talkBody } from './topics-helpers';

const D = '2026-11-07';
const ok = (b: unknown, slotDay = D) => expect(validateTopicBody(b, { slotDay })).toEqual([]);
const bad = (b: unknown, code: string, slotDay = D) => expect(validateTopicBody(b, { slotDay })).toContain(code);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const SRC = (id: string) => ({ id, url: `https://src.example.org/${id}`, name: '出典', quote: 'これは出典のページに書いてある二十字以上の引用の文章です。' });

describe('validateTopicBody: 4 種類の通る例', () => {
  it('news / talk / philo / make の見本は通る', () => {
    ok(newsBody(D));
    ok(talkBody());
    ok(philoBody());
    ok(makeBody());
  });
});

describe('validateTopicBody: event_day', () => {
  it('news は必須・slotDay − 14 以上 slotDay 以下・実在する日付', () => {
    ok({ ...newsBody(D), event_day: addDays(D, -14) });
    bad({ ...newsBody(D), event_day: addDays(D, -15) }, 'event_day_range');
    bad({ ...newsBody(D), event_day: addDays(D, 1) }, 'event_day_range');
    bad({ ...newsBody(D), event_day: null }, 'event_day');
    bad({ ...newsBody(D), event_day: '2026-02-30' }, 'event_day');
    bad({ ...newsBody(D), event_day: '2026-13-01' }, 'event_day');
  });
  it('news 以外は null', () => {
    bad({ ...talkBody(), event_day: D }, 'event_day');
    bad({ ...philoBody(), event_day: D }, 'event_day');
    bad({ ...makeBody(), event_day: D }, 'event_day');
  });
});

describe('validateTopicBody: premises', () => {
  const p = { text: loc('場面', 'ばめん') };
  it('news 0 / talk 0〜3 / philo 0〜2 / make 0', () => {
    bad({ ...newsBody(D), premises: [p] }, 'premises_count');
    ok({ ...talkBody(), premises: [p, p, p] });
    bad({ ...talkBody(), premises: [p, p, p, p] }, 'premises_count');
    ok({ ...philoBody(), premises: [p, p] });
    bad({ ...philoBody(), premises: [p, p, p] }, 'premises_count');
    bad({ ...makeBody(), premises: [p] }, 'premises_count');
  });
});

describe('validateTopicBody: facts', () => {
  const f = (id: string) => ({ id, text: loc('事実', 'じじつ'), source_ids: ['s1'] });
  it('news 2〜4', () => {
    bad({ ...newsBody(D), facts: [f('f1')] }, 'facts_count');
    ok({ ...newsBody(D), facts: [f('f1'), f('f2'), f('f3'), f('f4')] });
    bad({ ...newsBody(D), facts: [f('f1'), f('f2'), f('f3'), f('f4'), f('f5')] }, 'facts_count');
  });
  it('talk 0〜3・philo 1〜4・make 0', () => {
    ok({ ...talkBody(), facts: [f('f1')], sources: [SRC('s1')] });
    bad({ ...talkBody(), facts: [f('f1'), f('f2'), f('f3'), f('f4')], sources: [SRC('s1')] }, 'facts_count');
    const p = philoBody();
    bad({ ...p, facts: [] }, 'facts_count');
    bad({ ...makeBody(), facts: [f('f1')], sources: [SRC('s1')] }, 'facts_count');
  });
  it('出典のない fact は落ちる（talk を含む全種類）', () => {
    bad({ ...talkBody(), facts: [{ id: 'f1', text: loc('事実', 'じじつ'), source_ids: [] }] }, 'fact_no_source');
    const n = newsBody(D);
    n.facts[0].source_ids = [];
    bad(n, 'fact_no_source');
  });
  it('fact の id の重複は落ちる', () => {
    bad({ ...newsBody(D), facts: [f('f1'), f('f1')] }, 'dup_fact_id');
  });
});

describe('validateTopicBody: views', () => {
  const v = (id: string, side: string, type = 'position', source_ids: string[] = []) => ({ id, who: { name: '考え', type }, side, stance: loc('立場', 'たちば'), source_ids });
  it('news 0〜3 / talk 2〜4・side 2 種以上 / philo 2〜4・side 2 種以上・person か org 1 つ以上 / make 0', () => {
    ok({ ...newsBody(D), views: [v('v1', 'a', 'org', ['s1'])] });
    bad({ ...newsBody(D), views: [v('v1', 'a'), v('v2', 'b'), v('v3', 'c'), v('v4', 'd')] }, 'views_count');
    bad({ ...talkBody(), views: [v('v1', 'a')] }, 'views_count');
    bad({ ...talkBody(), views: [v('v1', 'a'), v('v2', 'a')] }, 'views_sides');
    ok({ ...talkBody(), views: [v('v1', 'a'), v('v2', 'b'), v('v3', 'c'), v('v4', 'd')] });
    bad({ ...talkBody(), views: [v('v1', 'a'), v('v2', 'b'), v('v3', 'c'), v('v4', 'd'), v('v5', 'a')] }, 'views_count');
    const p = philoBody();
    bad({ ...p, views: [v('v1', 'a'), v('v2', 'b')], sources: [p.sources[0]] }, 'views_named');
    bad({ ...p, views: [v('v1', 'a', 'person', ['s2']), v('v2', 'a')] }, 'views_sides');
    bad({ ...makeBody(), views: [v('v1', 'a')] }, 'views_count');
  });
  it('person / org の view は出典が必須、position は空でよい', () => {
    bad({ ...talkBody(), views: [v('v1', 'a', 'person'), v('v2', 'b')] }, 'view_no_source');
    ok({ ...talkBody(), views: [v('v1', 'a', 'org', ['s1']), v('v2', 'b')], sources: [SRC('s1')] });
  });
});

describe('validateTopicBody: asks / stances / next / make', () => {
  it('asks はちょうど 3（check・self・open を 1 つずつ）、s と e が同じ文字列でない。make は 0', () => {
    const n = newsBody(D);
    bad({ ...n, asks: n.asks.slice(0, 2) }, 'asks_count');
    bad({ ...n, asks: [n.asks[0], n.asks[0], n.asks[2]] }, 'asks_levels');
    bad({ ...n, asks: [{ level: 'check', text: loc('同じ', '同じ') }, n.asks[1], n.asks[2]] }, 'ask_same');
    bad({ ...makeBody(), asks: n.asks }, 'asks_count');
  });
  it('stances は 2〜4（make は 0）', () => {
    const s = (id: string) => ({ id, label: loc('立場', 'たちば') });
    bad({ ...newsBody(D), stances: [s('a')] }, 'stances_count');
    bad({ ...talkBody(), stances: [s('a'), s('b'), s('c'), s('d'), s('e')] }, 'stances_count');
    bad({ ...philoBody(), stances: [s('a'), s('a')] }, 'dup_stance_id');
    bad({ ...makeBody(), stances: [s('a'), s('b')] }, 'stances_count');
  });
  it('next は news / talk / philo で必須（make_steps 3〜4）、make は null', () => {
    bad({ ...newsBody(D), next: null }, 'next');
    const t = talkBody();
    bad({ ...t, next: { ...t.next!, make_steps: t.next!.make_steps.slice(0, 2) } }, 'next');
    bad({ ...makeBody(), next: t.next }, 'next');
  });
  it('make は make だけ必須・steps 3〜4・category は tags.interests に含まれる', () => {
    const m = makeBody();
    bad({ ...newsBody(D), make: m.make }, 'make');
    bad({ ...m, make: null }, 'make');
    bad({ ...m, make: { ...m.make!, steps: m.make!.steps.slice(0, 2) } }, 'make_steps');
    bad({ ...m, make: { ...m.make!, category: 'drawing' } }, 'make_category');
    bad({ ...m, make: { ...m.make!, minutes: 5 } }, 'make');
    bad({ ...m, make: { ...m.make!, minutes: 121 } }, 'make');
  });
});

describe('validateTopicBody: sources', () => {
  it('news 1〜6 / talk 0〜6 / philo 1〜6 / make 0〜2（make は facts・views を持たないので出典を置くと指されない出典で落ちる）', () => {
    const n = newsBody(D);
    bad({ ...n, sources: [] }, 'sources_count');
    const seven = ['s1', 's2', 's3', 's4', 's5', 's6', 's7'].map(SRC);
    bad({ ...n, sources: seven }, 'sources_count');
    bad({ ...philoBody(), sources: [] }, 'sources_count');
    ok({ ...talkBody(), sources: [] });
    bad({ ...makeBody(), sources: [SRC('s1')] }, 'unreferenced_source');
    bad({ ...makeBody(), sources: ['s1', 's2', 's3'].map(SRC) }, 'sources_count');
  });
  it('重複した source id・指されていない出典・source_ids が無い id を指すと落ちる', () => {
    const n = newsBody(D);
    bad({ ...n, sources: [SRC('s1'), SRC('s1')] }, 'dup_source_id');
    bad({ ...n, sources: [SRC('s1'), SRC('s2')] }, 'unreferenced_source');
    const n2 = clone(n);
    n2.facts[1].source_ids = ['s9'];
    bad(n2, 'unknown_source_ref');
  });
  it('URL は T-5 の規則、quote は 20〜200 字', () => {
    const n = newsBody(D);
    bad({ ...n, sources: [{ ...n.sources[0], url: 'http://src.example.org/a' }] }, 'source_url');
    bad({ ...n, sources: [{ ...n.sources[0], url: 'https://127.0.0.1/a' }] }, 'source_url');
    bad({ ...n, sources: [{ ...n.sources[0], quote: '短い' }] }, 'source_quote');
    bad({ ...n, sources: [{ ...n.sources[0], quote: 'あ'.repeat(201) }] }, 'source_quote');
    ok({ ...n, sources: [{ ...n.sources[0], quote: 'あ'.repeat(200) }] });
  });
});

describe('validateTopicBody: 型と未知のキー', () => {
  it('未知のキー（子どもの名前などの欄）・未知の kind・型違いは落ちる', () => {
    bad({ ...newsBody(D), child_name: 'たろう' }, 'unknown_key');
    bad({ ...newsBody(D), kind: 'quiz' }, 'kind');
    bad({ ...newsBody(D), schema_version: 2 }, 'schema_version');
    bad({ ...newsBody(D), title: 'ただの文字列' }, 'title');
    bad({ ...newsBody(D), title: { s: 'a', e: 'b', x: 'c' } }, 'title');
    bad({ ...newsBody(D), locale: 'en-US' }, 'locale');
    const n = clone(newsBody(D)) as unknown as Record<string, unknown>;
    delete n.premises;
    bad(n, 'missing_key');
    const v = clone(talkBody());
    (v.views[0] as unknown as Record<string, unknown>).grade = 3;
    bad(v, 'view');
    bad(null, 'not_object');
  });
  it('文字数の上限（題 80 / lead 120 / ラベル 20）', () => {
    bad({ ...newsBody(D), title: loc('あ'.repeat(81), 'い') }, 'title');
    ok({ ...newsBody(D), title: loc('あ'.repeat(80), 'い') });
    bad({ ...newsBody(D), lead: loc('あ'.repeat(121), 'い') }, 'lead');
    const n = newsBody(D);
    bad({ ...n, stances: [{ id: 'a', label: loc('あ'.repeat(21), 'い') }, n.stances[1]] }, 'stance');
  });
});

describe('補助の純関数', () => {
  it('isRealDate / requiredSourceIds / normalizeTitle / titleJaccard', () => {
    expect(isRealDate('2028-02-29')).toBe(true);
    expect(isRealDate('2027-02-29')).toBe(false);
    expect([...requiredSourceIds(philoBody())].sort()).toEqual(['s1', 's2']);
    expect(requiredSourceIds(talkBody()).size).toBe(0);
    expect(normalizeTitle('ＡＩ と 学校！')).toBe('aiと学校');
    expect(titleJaccard('abcd', 'abcd')).toBe(1);
    expect(titleJaccard('学校でaiを使う', '公園で遊ぶ')).toBeLessThan(0.6);
  });
});

describe('system 文は契約 contract-T の verbatim', () => {
  const contract = readFileSync(new URL('../../../docs/plans/topics-variety/contract-T.md', import.meta.url), 'utf8');
  it('生成・検査の system 文と kind_rules・派生の文が契約の本文にそのまま含まれる', () => {
    expect(contract.includes(GEN_SYSTEM_TEMPLATE)).toBe(true);
    expect(contract.includes(CHECK_SYSTEM_TEMPLATE)).toBe(true);
    for (const r of Object.values(KIND_RULES)) expect(contract.includes(r)).toBe(true);
    for (const r of Object.values(DERIVE_RULES)) expect(contract.includes(r)).toBe(true);
  });
  it('system 文には定数と種類と本数だけが入る（外から来た文は入らない）', () => {
    const s = genSystem({ kind: 'news' }, 2);
    expect(s).toContain('日本語 で書きます。対象の国は 日本 です。');
    expect(s).toContain('作る種類: ニュースから。本数: 最大 2 本。');
    expect(s).not.toMatch(/\{(language|country|kind_label|count|kind_rules)\}/);
  });
});
