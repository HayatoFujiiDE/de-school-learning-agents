// 子ども向け本文の機械検査（契約 V-5・V-11 u5）。checkChildText は純関数。
import { describe, expect, it } from 'vitest';
import { BODY_MAX_CHARS, BODY_MIN_CHARS, bodyChars, checkChildText, CHILD_TEXT_KINDS, CHILD_TEXT_MAX, FIRST_ACTION_RE, rawMarkupHit, stripMarkdownForCheck } from '../src/checks/childtext';
import { goodMaterial, goodMaterialV2, outputsFixture } from './helpers';

type M = ReturnType<typeof goodMaterial> & { parts: Array<Record<string, any>> };
const mat = (): M => goodMaterial() as M;
const texts = (o: Record<string, string>) => new Map(Object.entries(o));
const ES = 'parts/p1/elementary-short.md';

describe('file_name（契約 V-5）', () => {
  it('この版のファイル名（app.html・figure-1.svg）が本文・entry_point にあると当たる', () => {
    const m = mat();
    m.parts[0].files.push({ path: 'parts/p1/app.html', role: 'app' });
    m.parts[0].entry_point.text = 'figure-1.svg を見て、赤い線をたどろう';
    const hits = checkChildText(m, texts({ [ES]: 'app.html をひらいて、ボタンを押してみよう' }));
    expect(hits).toEqual([
      { path: ES, kind: 'file_name', sample: expect.stringContaining('app.html') },
      { path: 'material.json', kind: 'file_name', sample: expect.stringContaining('figure-1.svg') },
    ]);
  });

  it('版に無い名前（index.html を教える素材）は当たらない。最上位のファイル名（claims.json）は当たる', () => {
    const hits = checkChildText(mat(), texts({ [ES]: 'HTML のはじめのファイルは index.html と名前をつけます。\n作る側の claims.json は見ません。' }));
    expect(hits.map((h) => [h.kind, h.sample.includes('claims.json')])).toEqual([['file_name', true]]);
  });

  it('コード（囲み・行内）とリンクの URL の中は見ない。リンクの文は見る', () => {
    const md = ['```', 'app.html', '```', '`figure-1.svg` を使う', '[ここ](https://example.org/figure-1.svg) を見る', '[figure-1.svg の説明](https://example.org/x)'].join('\n');
    const hits = checkChildText(mat(), texts({ [ES]: md }));
    expect(hits).toEqual([{ path: ES, kind: 'file_name', sample: expect.stringContaining('figure-1.svg の説明') }]);
  });

  it('主張の印 [c3] は取り除いてから見る（印の数字やかっこは raw_markup にならない）', () => {
    expect(stripMarkdownForCheck('信号は進みます [c3]。')).toBe('信号は進みます 。');
    expect(checkChildText(mat(), texts({ [ES]: '信号は進みます [c3]。' }))).toEqual([]);
  });
});

describe('raw_markup（契約 V-5 (a)〜(h)。.md だけ）', () => {
  const one = (line: string) => checkChildText(mat(), texts({ [ES]: line })).filter((h) => h.kind === 'raw_markup');
  it.each([
    ['(a) ** が奇数個', 'ここは **太字 のつもり'],
    ['(b) __', 'これは __強調__ です'],
    ['(c) < の直後が英字', 'ここで <b>太字</b> にする'],
    ['(c) < の直後が /', 'とじる </span> だけ'],
    ['(d) 行頭（空白を除く）が |', '  | 列1 | 列2 |'],
    ['(e) ![', '![図](figure-1.png)'],
    ['(f) 行頭が >', '> 引用です'],
    ['(g) 行頭が # 5 個以上', '##### 小さすぎる見出し'],
    ['(h) * 1 個で囲んだ強調', 'これは *斜体* です'],
  ])('%s → 当たる', (_n, line) => {
    expect(one(line)).toHaveLength(1);
  });

  it.each([
    ['対になった **太字**', 'これは **太字** と **もう一つ** です'],
    ['見出し #〜####', '#### ふつうの見出し'],
    ['箇条書きの * ', '* 一つめ'],
    ['番号つき', '1. はじめに'],
    ['< の直後が数字・空白', '3 < 5 と 2 <= 4'],
    ['リンク（画像の埋め込みではない）', '[もっと知る](https://example.org/a_b__c)'],
  ])('%s → 当たらない', (_n, line) => {
    expect(one(line)).toEqual([]);
  });

  it('箇条書きの * の後ろに * 1 個の強調があれば当たる', () => {
    expect(rawMarkupHit('* これは *斜体* です')).not.toBeNull();
  });

  it('material.json の文は raw_markup を見ない（.md だけ）', () => {
    const m = mat();
    m.summary_elementary = 'これは **太字 のつもり';
    expect(checkChildText(m, texts({}))).toEqual([]);
  });

  it('空白 100 個の後にファイル名がある行でも sample は空でなくファイル名を含む（探索と切り出しを同じ文で行う）', () => {
    const [h] = checkChildText(mat(), texts({ [ES]: `${' '.repeat(100)}claims.json を開く` }));
    expect(h).toMatchObject({ path: ES, kind: 'file_name' });
    expect(h.sample).toContain('claims.json');
    expect(h.sample.length).toBeLessThanOrEqual(40);
    const m = mat();
    m.summary_elementary = `${' '.repeat(100)}\n\n figure-1.svg を見る`;
    const [s] = checkChildText(m, texts({}));
    expect(s).toMatchObject({ path: 'material.json', kind: 'file_name' });
    expect(s.sample).toContain('figure-1.svg');
  });

  it('sample は当たった所の前後を含む 40 字以内', () => {
    const line = `${'あ'.repeat(50)}<b>${'い'.repeat(50)}`;
    const [h] = one(line);
    expect(h.sample.length).toBeLessThanOrEqual(40);
    expect(h.sample).toContain('<b>');
  });
});

describe('件数と形', () => {
  it('20 件で切る', () => {
    const md = Array.from({ length: 30 }, (_, i) => `行 ${i} は <b>太字</b>`).join('\n');
    const hits = checkChildText(mat(), texts({ [ES]: md }));
    expect(hits).toHaveLength(CHILD_TEXT_MAX);
  });

  it('material の形が違っても例外を投げない', () => {
    expect(checkChildText(null, texts({}))).toEqual([]);
    expect(checkChildText({ parts: 'x' }, texts({}))).toEqual([]);
    expect(checkChildText({ parts: [null, { variants: [{ path: 3 }] }] }, texts({}))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// §AL-3: schema 2 の版だけの新しい kind（goal_word / body_too_long / body_too_short / questions_missing / first_paragraph_not_action）と body_chars

const NEW_KINDS = ['goal_word', 'body_too_long', 'body_too_short', 'questions_missing', 'first_paragraph_not_action'];
const BODY = 'parts/p1/body.md';
const PLAY = 'parts/p1/play.md';
const dec = new TextDecoder();
/** fixture の material.json と本文（取り込みと同じ: parts/ の md / svg / html） */
function fixture(name: string): { m: Record<string, any>; t: Map<string, string> } {
  const files = outputsFixture(name);
  const m = JSON.parse(dec.decode(files.get('material.json')!)) as Record<string, any>;
  const t = new Map<string, string>();
  for (const [p, b] of files) if (p.startsWith('parts/') && /\.(md|svg|html)$/.test(p)) t.set(p, dec.decode(b));
  return { m, t };
}
const v2 = (): Record<string, any> => goodMaterialV2() as Record<string, any>;
const kindsOf = (hits: Array<{ kind: string }>) => hits.map((h) => h.kind).sort();
/** 動作の文で始まり、版の 1 文を含む 150 字以上の本文 */
const GOOD_BODY = `粉をならべて置いてみよう。${'信号はとちゅうで弱くなる。'.repeat(12)}\n\nこの説明は Java 版 26.3 のものです。`;
const GOOD_PLAY = '当ててみよう。この説明は Java 版 26.3 のものです。';

describe('§AL-3 定数と kind の一覧', () => {
  it('CHILD_TEXT_KINDS は契約の 8 件（この順）・上限と下限・動作の語尾', () => {
    expect([...CHILD_TEXT_KINDS]).toEqual(['file_name', 'raw_markup', 'edition_text', ...NEW_KINDS]);
    expect([BODY_MAX_CHARS, BODY_MIN_CHARS]).toEqual([1100, 150]);
    expect(FIRST_ACTION_RE.source).toBe('(て|で)(みよう|みて|みましょう|ごらん)|しよう|しましょう|やってみ|さわって|開いて|置いて|押して|動かして|作って|数えて|見つけて|たどって|見て');
  });
});

describe('§AL-3 fixture（good / bad / schema 1）', () => {
  it('bad fixture → 正確に {goal_word ×2（body と summary）, body_too_long, questions_missing, first_paragraph_not_action}', () => {
    const { m, t } = fixture('_shared-v2-bad');
    const hits = checkChildText(m, t);
    expect(kindsOf(hits)).toEqual(['body_too_long', 'first_paragraph_not_action', 'goal_word', 'goal_word', 'questions_missing']);
    const goal = hits.filter((h) => h.kind === 'goal_word');
    expect(goal.map((h) => h.path)).toEqual([BODY, 'material.json']);
    expect(goal.find((h) => h.path === BODY)!.sample).toContain('学ぼう');
    expect(goal.find((h) => h.path === 'material.json')!.sample).toContain('学習目標');
    for (const h of goal) expect([...h.sample].length).toBeLessThanOrEqual(40);
    expect(hits.find((h) => h.kind === 'questions_missing')).toEqual({ path: 'material.json', kind: 'questions_missing', sample: '' });
    expect(hits.find((h) => h.kind === 'body_too_long')).toEqual({ path: BODY, kind: 'body_too_long', sample: '' });
    const first = hits.find((h) => h.kind === 'first_paragraph_not_action')!;
    expect(first.path).toBe(BODY);
    expect(first.sample).toBe([...t.get(BODY)!.split('\n')[0]].slice(0, 40).join(''));
  });

  it('good fixture → 0 件', () => {
    const { m, t } = fixture('_shared-v2');
    expect(checkChildText(m, t)).toEqual([]);
  });

  it('schema 1 の既存 fixture → 新しい kind は 0 件', () => {
    const { m, t } = fixture('_shared');
    expect(checkChildText(m, t).filter((h) => NEW_KINDS.includes(h.kind))).toEqual([]);
  });

  it('schema 1 は目標語・短い本文・問いなしでも新しい kind を出さない（版で分ける）', () => {
    const m = mat();
    m.summary_elementary = '信号について学ぼう';
    m.parts[0].title = '学習目標: 信号';
    expect(checkChildText(m, texts({ [ES]: '今日は学ぼう' }))).toEqual([]);
  });
});

describe('§AL-3 schema 2 の body / play にも既存の kind', () => {
  it('file_name（本文）・raw_markup（遊びの形）・edition_text（版の 1 文が無い play が 1 件）', () => {
    const m = v2();
    const hits = checkChildText(m, texts({ [BODY]: GOOD_BODY.replace('粉をならべて', 'app.html を開いて、粉をならべて'), [PLAY]: '当ててみよう。ここは <b>太字</b> です。' }));
    expect(hits.map((h) => [h.path, h.kind])).toEqual([
      [BODY, 'file_name'],
      [PLAY, 'edition_text'],
      [PLAY, 'raw_markup'],
    ]);
    expect(hits[0].sample).toContain('app.html');
  });

  it('本文のファイル名（body.md）も当てる', () => {
    expect(checkChildText(v2(), texts({ [BODY]: `${GOOD_BODY}\n\nbody.md を読む`, [PLAY]: GOOD_PLAY })).map((h) => h.kind)).toEqual(['file_name']);
  });
});

describe('§AL-3 本文の長さ', () => {
  const only = (body: string, kind: string) => checkChildText(v2(), texts({ [BODY]: body, [PLAY]: GOOD_PLAY })).filter((h) => h.kind === kind);
  it('body_too_long: 記法を除いた散文が 1100 字まで → 出ない、1101 字 → 出る（囲みコードは数えない）', () => {
    const fence = ['```', 'x'.repeat(2000), '```'].join('\n');
    // 囲みコードの 3 行は空行（改行 3 つ）になる: 3 + 1097 = 1100
    expect([...stripMarkdownForCheck(`${fence}\n${'あ'.repeat(1097)}`)].length).toBe(1100);
    expect(only(`${fence}\n${'あ'.repeat(1097)}`, 'body_too_long')).toEqual([]);
    expect(only(`${fence}\n${'あ'.repeat(1098)}`, 'body_too_long')).toEqual([{ path: BODY, kind: 'body_too_long', sample: '' }]);
  });
  it('body_too_short: 印 [cN] を除いた生の本文が 150 字未満 → 出る。150 字 → 出ない', () => {
    expect(only(`${'あ'.repeat(149)}[c1]`, 'body_too_short')).toEqual([{ path: BODY, kind: 'body_too_short', sample: '' }]);
    expect(only('あ'.repeat(150), 'body_too_short')).toEqual([]);
    expect(only('', 'body_too_short')).toHaveLength(1);
  });
  it('コード主体の本文（囲みコード 400 字 + 散文 100 字）は body_too_short にならない', () => {
    const code = ['```', 'a'.repeat(400), '```'].join('\n');
    const body = `${code}\n\n${'い'.repeat(100)}`;
    expect(only(body, 'body_too_short')).toEqual([]);
    expect(bodyChars(v2(), texts({ [BODY]: body }))).toEqual([{ path: BODY, chars: [...stripMarkdownForCheck(body)].length }]);
  });
  it('遊びの形（play）には長さを当てない', () => {
    expect(checkChildText(v2(), texts({ [BODY]: GOOD_BODY, [PLAY]: `当ててみよう。この説明は Java 版 26.3 のものです。${'う'.repeat(1200)}` }))).toEqual([]);
    expect(checkChildText(v2(), texts({ [BODY]: GOOD_BODY, [PLAY]: 'この説明は Java 版 26.3 のものです。' }))).toEqual([]);
  });
});

describe('§AL-3 問いの種', () => {
  const q = (id: string, claim_ids: string[]) => ({ id, text: `${id} は何？`, claim_ids });
  const run = (qs: unknown) => {
    const m = v2();
    if (qs === undefined) delete m.parts[0].questions_for_kids;
    else m.parts[0].questions_for_kids = qs;
    return checkChildText(m, texts({ [BODY]: GOOD_BODY, [PLAY]: GOOD_PLAY })).filter((h) => h.kind === 'questions_missing');
  };
  it('無い・空・1 件 → 1 件（sample は空）', () => {
    const one = [{ path: 'material.json', kind: 'questions_missing', sample: '' }];
    expect(run(undefined)).toEqual(one);
    expect(run([])).toEqual(one);
    expect(run([q('q1', ['c1'])])).toEqual(one);
    expect(run('x')).toEqual(one);
  });
  it('claim_ids が空の問いがある → sample はその問いの id。2 件以上で全部に claim_ids → 0 件', () => {
    expect(run([q('q1', ['c1']), q('q2', [])])).toEqual([{ path: 'material.json', kind: 'questions_missing', sample: 'q2' }]);
    expect(run([q('q1', ['c1']), q('q2', ['c2'])])).toEqual([]);
  });
});

describe('§AL-3 最初の段落', () => {
  const run = (body: string) => checkChildText(v2(), texts({ [BODY]: `${body}\n\n${'信号はとちゅうで弱くなる。'.repeat(12)}この説明は Java 版 26.3 のものです。`, [PLAY]: GOOD_PLAY })).filter((h) => h.kind === 'first_paragraph_not_action');
  it('見出し・箇条書き・囲みコードを飛ばした最初の段落に動作の語尾があれば出ない', () => {
    expect(run(['# 見出し', '', '- 箇条書き', '1. 番号', '', '```', 'code', '```', '', 'レバーを押して、光を見よう。'].join('\n'))).toEqual([]);
  });
  it('最初の段落が説明だけ → note の kind（sample は段落の先頭 40 字）。後ろの段落の動作は数えない', () => {
    const first = `レッドストーンは${'赤い粉の鉱石で、'.repeat(8)}信号を運ぶ。`;
    const hits = run(`${first}\n\nさわってみよう。`);
    expect(hits).toEqual([{ path: BODY, kind: 'first_paragraph_not_action', sample: [...first].slice(0, 40).join('') }]);
  });
});

describe('§AL-3 目標語', () => {
  const run = (f: (m: Record<string, any>) => void, body = GOOD_BODY) => {
    const m = v2();
    f(m);
    return checkChildText(m, texts({ [BODY]: body, [PLAY]: GOOD_PLAY })).filter((h) => h.kind === 'goal_word');
  };
  it.each([
    ['summary', (m: Record<string, any>) => (m.summary = '信号のしくみを理解しよう')],
    ['title', (m: Record<string, any>) => (m.parts[0].title = 'この単元の道')],
    ['entry_point.text', (m: Record<string, any>) => (m.parts[0].entry_point.text = 'めあて: 粉を置く')],
    ['questions_for_kids[].text', (m: Record<string, any>) => (m.parts[0].questions_for_kids[0].text = '覚えよう、何個目？')],
    ['interest_entries[].text', (m: Record<string, any>) => (m.parts[0].interest_entries[0].text = 'マスターしよう')],
    ['videos[].why', (m: Record<string, any>) => (m.parts[0].videos = [{ id: 'v1', why: '本時の動画' }])],
  ])('%s の目標語 → material.json で 1 件', (_n, f) => {
    const hits = run(f);
    expect(hits.map((h) => h.path)).toEqual(['material.json']);
  });
  it('spark には当てない', () => {
    expect(run((m) => (m.spark = '学習目標は信号を学ぼう'))).toEqual([]);
  });
  it('本文（囲みコードの中は見ない）と遊びの形', () => {
    expect(run(() => {}, `${GOOD_BODY}\n\n\`\`\`\n学ぼう\n\`\`\``)).toEqual([]);
    const m = v2();
    const hits = checkChildText(m, texts({ [BODY]: `${GOOD_BODY}\n\n目標は 15 ブロック。`, [PLAY]: `${GOOD_PLAY}\nねらい: 当てる` })).filter((h) => h.kind === 'goal_word');
    expect(hits.map((h) => [h.path, h.sample.includes('目標は') || h.sample.includes('ねらい:')])).toEqual([
      [BODY, true],
      [PLAY, true],
    ]);
  });
});

describe('§AL-2 body_chars', () => {
  it('schema 2 は part ごとの本文の散文の code point 数。schema 1 は空', () => {
    const { m, t } = fixture('_shared-v2');
    expect(bodyChars(m, t)).toEqual([{ path: BODY, chars: [...stripMarkdownForCheck(t.get(BODY)!)].length }]);
    expect(bodyChars(mat(), texts({ [ES]: 'あいう' }))).toEqual([]);
    expect(bodyChars(null, texts({}))).toEqual([]);
  });
});

describe('§AL-6 問いの種・関心別の入口の file_name', () => {
  it('schema 2 で問いの種の文にファイル名 → file_name が 1 件（path は material.json）', () => {
    const m = v2();
    m.parts[0].questions_for_kids[0].text = 'app.html を開いて、何個目まで光るかな？';
    const hits = checkChildText(m, texts({ [BODY]: GOOD_BODY, [PLAY]: GOOD_PLAY }));
    expect(hits).toEqual([{ path: 'material.json', kind: 'file_name', sample: expect.stringContaining('app.html') }]);
  });

  it('関心別の入口の文も見る', () => {
    const m = v2();
    m.parts[0].interest_entries[1].text = 'body.md を読んでから作ってみよう';
    const hits = checkChildText(m, texts({ [BODY]: GOOD_BODY, [PLAY]: GOOD_PLAY }));
    expect(hits).toEqual([{ path: 'material.json', kind: 'file_name', sample: expect.stringContaining('body.md') }]);
  });
});
