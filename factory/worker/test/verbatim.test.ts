// §AK2 本文の丸写しの検査（契約 docs/plans/rights/contract-AK2.md AK2-4 の 1〜4・6-b・7〜9）。純関数と、仕分け・承認・公開・表示。
// 取り込みの実経路（AK2-4 の 5・6・10）は test/verbatim-ingest.test.ts。
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { beforeEach, describe, expect, it } from 'vitest';
import { accumulateCitations, finishCitations, newCitationAcc, type CitationSourceInput } from '../src/checks/citations';
import { ITEM_CAUSES, ITEM_TITLE } from '../src/checks/triage';
import {
  VERBATIM_HITS_MAX,
  buildNeedles,
  mergeHits,
  normalizeForMatch,
  prepareBodies,
  scanPage,
  verbatimBlockReason,
  visibleTextOfHtml,
  visibleTextOfMd,
  type VerbatimHit,
} from '../src/checks/verbatim';
import { conditionalBatch } from '../src/db';
import { buildPublishSwitch, publishSwitch } from '../src/publish';
import { rollbackMaterial } from '../src/routes/materials';
import { decide } from '../src/routes/review';
import { applyTriage, autoPublishStep, computeTriage, type TriageApplyRow } from '../src/triage-step';
import { one } from './d1-shim';
import { GREEN_CHECKS, ctx, good, seed, setSetting, world, type World } from './review-auto-helpers';

/** すべて異なる字（CJK 統合漢字の連番。どれも \p{L}）の n 字。base で範囲をずらす */
const uniq = (n: number, base = 0x4e00): string => Array.from({ length: n }, (_, k) => String.fromCodePoint(base + k)).join('');
const cpLen = (s: string) => Array.from(s).length;
/** 本文 1 つ（md）で走査する */
function scan(body: string, page: string, quotes: string[] = [], path = 'parts/p1/a.md') {
  const bodies = prepareBodies(new Map([[path, body]]));
  return scanPage(buildNeedles(bodies), bodies, page, 'https://example.org/p', quotes.map(normalizeForMatch));
}
const L = 'ゐ'; // 本文に無い字（ページ側の区切り）
const R = 'ゑ';

describe('AK2-4 1 normalizeForMatch', () => {
  it('全角英数は半角・大文字は小文字・空白の連続は 1 つ・前後の空白なし', () => {
    expect(normalizeForMatch('　ＡＢＣ１２３　　Ｄｅｆ\t\n x ')).toBe('abc123 def x');
  });
  it('ゼロ幅は除く（空白の間にあっても空白 1 つになる）', () => {
    expect(normalizeForMatch('a​‌‍b⁠c﻿d')).toBe('abcd');
    expect(normalizeForMatch('a ​ b')).toBe('a b');
  });
  it('補助面の字（絵文字）は 1 字・合成済みのある結合文字は NFKC で 1 字・合成済みの無い結合文字は 2 字', () => {
    expect(cpLen(normalizeForMatch('😀😀'))).toBe(2);
    expect(cpLen(normalizeForMatch('é'))).toBe(1);
    expect(cpLen(normalizeForMatch('q́'))).toBe(2);
  });
});

describe('AK2-4 2 visibleTextOfMd', () => {
  it('行内コードの中身が残る（_ や * も）', () => {
    expect(normalizeForMatch(visibleTextOfMd('前 `a_b*c` 後'))).toBe('前 a_b*c 後');
  });
  it('囲みコードの中身が残る（区切りの行は除く）', () => {
    expect(normalizeForMatch(visibleTextOfMd('上\n```js\nconst x_y = 1; // # > ~\n```\n下'))).toBe('上 const x_y = 1; // # > ~ 下');
  });
  it('**強調** の途中で分断されない・見出し・引用・箇条書きの記号と [cN] を除く', () => {
    expect(normalizeForMatch(visibleTextOfMd('前**強調**後'))).toBe('前強調後');
    expect(normalizeForMatch(visibleTextOfMd('## 見出し\n> 引用\n- 箇条 [c1]\n+ 足し\n12. 番号\n-5 度'))).toBe('見出し 引用 箇条 足し 番号 -5 度');
  });
  it('リンクの文・画像の alt が残り url は消える', () => {
    const t = normalizeForMatch(visibleTextOfMd('[リンクの文](https://a.example/x_y) と ![画像の説明](img/p_q.png)'));
    expect(t).toBe('リンクの文 と 画像の説明');
    expect(t.includes('example')).toBe(false);
  });
  it('html / svg は textOfHtml（script・style・コメントを落とす）。閉じていない構造は null', () => {
    expect(visibleTextOfHtml('<p>見える&amp;文</p><script>隠れる()</script><!-- c --><style>x{}</style>')).toBe('見える&文');
    expect(visibleTextOfHtml('<p>文<!-- 閉じていない')).toBeNull();
    const b = prepareBodies(new Map([['parts/p1/a.svg', '<svg><text>文<!-- </text></svg>']]));
    expect(b.incomplete).toBe(true);
  });
});

describe('AK2-4 3 scanPage', () => {
  it('99 字 → なし / 100 字 → 1 件', () => {
    const s99 = uniq(99);
    expect(scan(s99, L + s99 + R).hits).toEqual([]);
    const s100 = uniq(100);
    const r = scan(s100, L + s100 + R);
    expect(r.hits.length).toBe(1);
    expect(r.hits[0]).toMatchObject({ path: 'parts/p1/a.md', start: 0, length: 100, url: 'https://example.org/p', sample: s100.slice(0, 60), text: s100 });
    expect(r.incomplete).toBe(false);
  });
  it('字（\\p{L}）が 59 字 → なし / 60 字 → あり（数字・記号だけの並びは数えない）', () => {
    const digits = '0123456789012345678901234567890123456789'; // 40 字（字ではない）
    const r59 = digits + '0' + uniq(59); // 100 字のうち字 59
    expect(scan(r59, L + r59 + R).hits).toEqual([]);
    const r60 = digits + uniq(60); // 100 字のうち字 60
    expect(scan(r60, L + r60 + R).hits.length).toBe(1);
  });
  it('引用に収まる 120 字の一致が 10 区間あり、その後に引用外の 120 字 → 引用外の 1 件だけ見つかる', () => {
    const qs = Array.from({ length: 10 }, (_, k) => uniq(120, 0x4e00 + k * 200));
    const out = uniq(120, 0x6000);
    const body = [...qs, out].join('。');
    const page = [...qs, out].join('、');
    const r = scan(body, page, qs);
    expect(r.hits.map((h) => h.text)).toEqual([out]);
  });
  it('先頭 60 字だけ同じで末尾が違う 2 区間のうち、引用に収まる方だけ除かれる', () => {
    const h = uniq(60);
    const t1 = uniq(60, 0x5000);
    const t2 = uniq(60, 0x5100);
    const bodies = prepareBodies(
      new Map([
        ['parts/p1/a.md', h + t1],
        ['parts/p1/b.md', h + t2],
      ]),
    );
    const r = scanPage(buildNeedles(bodies), bodies, L + h + t1 + R + h + t2 + L, 'u', [normalizeForMatch(h + t1)]);
    expect(r.hits.map((x) => [x.path, x.text])).toEqual([['parts/p1/b.md', h + t2]]);
  });
  it('ページ 200,000 字超 → incomplete', () => {
    expect(scan(uniq(100), 'ぬ'.repeat(200_001)).incomplete).toBe(true);
    expect(scan(uniq(100), 'ぬ'.repeat(200_000)).incomplete).toBe(false);
  });
  it('本文 300,000 字超 → incomplete（超えた分は見ない）', () => {
    expect(prepareBodies(new Map([['parts/p1/a.md', 'ぬ'.repeat(300_001)]])).incomplete).toBe(true);
    const b = prepareBodies(new Map([['parts/p1/a.md', uniq(10)]]));
    expect(b.incomplete).toBe(false);
  });
  it('同じ hash の候補が 64 個を超えた窓（反復文字）→ incomplete', () => {
    expect(buildNeedles(prepareBodies(new Map([['parts/p1/a.md', 'ぬ'.repeat(103)]]))).incomplete).toBe(false); // 64 窓
    expect(buildNeedles(prepareBodies(new Map([['parts/p1/a.md', 'ぬ'.repeat(104)]]))).incomplete).toBe(true); // 65 窓
  });
  it('照合の回数が 2,000,000 回を超えた → incomplete（それまでの hit は返す）', () => {
    const b = uniq(1000);
    const texts = new Map<string, string>();
    for (let k = 0; k < 10; k++) texts.set(`parts/p1/b${k}.md`, b);
    const bodies = prepareBodies(texts);
    const needles = buildNeedles(bodies);
    expect(needles.incomplete).toBe(false);
    const r = scanPage(needles, bodies, b.repeat(200), 'u', []);
    expect(r.incomplete).toBe(true);
    expect(r.hits.length).toBeGreaterThan(0);
    // 上限を上げれば済む（回数が理由であることの確かめ）
    expect(scanPage(needles, bodies, b.repeat(200), 'u', [], 100_000_000).incomplete).toBe(false);
  });
  it('CJK と英語（大文字・全角・空白の違いは正規化で吸収）', () => {
    const en = 'the redstone signal travels fifteen blocks before it fades and a repeater can restore the full strength again for longer wires';
    const page = `Intro. ${en.toUpperCase().replace(/ /g, '   ')} Outro`;
    const r = scan(`本文 ${en} です`, page);
    expect(r.hits.map((h) => h.text.trim())).toEqual([en]); // 前後の空白も一致に入る
    const ja = 'レッドストーンの信号は十五ブロック進むと弱くなって消えてしまうので長い回路ではリピーターを置いて信号の強さを元に戻す必要があるとされていますがこの性質を使うと信号を遅らせることもできるのでいろいろな仕掛けに使われています';
    expect(cpLen(ja)).toBeGreaterThanOrEqual(100);
    expect(scan(`はじめに。${ja}おわり`, `ページ：${ja}以上`).hits.length).toBe(1);
  });
});

describe('v4 回帰（Astra high REVISE の BLOCKING 2・NON-BLOCKING の引用の空白）: 書式で見える文を分断しない', () => {
  const P = uniq(150);
  const [a, b, c] = [P.slice(0, 50), P.slice(50, 100), P.slice(100)];
  it.each([
    ['md: 先頭 50 字 + `中央 50 字` + 末尾 50 字', 'parts/p1/a.md', `${a}\`${b}\`${c}`],
    ['md: **強調** をまたぐ（従来どおり）', 'parts/p1/a.md', `${a}**${b}**${c}`],
    ['html: 50 字ずつ隣り合う span', 'parts/p1/app.html', `<p><span>${a}</span><span>${b}</span><span>${c}</span></p>`],
    ['svg: 50 字ずつ隣り合う tspan', 'parts/p1/figure-1.svg', `<svg xmlns="http://www.w3.org/2000/svg"><text><tspan>${a}</tspan><tspan>${b}</tspan><tspan>${c}</tspan></text></svg>`],
    ['html: <xmp>', 'parts/p1/app.html', `<xmp>${P}</xmp>`],
    ['html: <noscript>', 'parts/p1/app.html', `<noscript>${P}</noscript>`],
    ['html: <textarea>', 'parts/p1/app.html', `<textarea>${P}</textarea>`],
    ['html: <title>', 'parts/p1/app.html', `<html><head><title>${P}</title></head><body></body></html>`],
  ])('%s → 1 件', (_name, path, body) => {
    const bodies = prepareBodies(new Map([[path, body]]));
    const r = scanPage(buildNeedles(bodies), bodies, `${L}${P}${R}`, 'u', []);
    expect(r.hits.length).toBe(1);
    expect(r.hits[0].text.trim()).toBe(P);
  });
  it.each([
    ['template を挟む（Astra 2 回目 BLOCKING の再現）', `<span>${a}</span><template>X</template><span>${b}</span><template>Y</template><span>${c}</span>`],
    ['hidden 属性の要素を挟む', `<span>${a}</span><span hidden>X</span><span>${b}</span><div hidden="">Y<div>Z</div></div><span>${c}</span>`],
    ['style の display:none（空白・大小文字は無視）を挟む', `<span>${a}</span><span style="color:red; Display : NONE">X</span><span>${b}</span><i style="DISPLAY:none">Y</i><span>${c}</span>`],
    ['style の visibility:hidden を挟む', `<span>${a}</span><b style="visibility: Hidden">X</b><span>${b}</span><b style="visibility:hidden">Y</b><span>${c}</span>`],
    ['svg の tspan の間に display:none の tspan', `<svg xmlns="http://www.w3.org/2000/svg"><text><tspan>${a}</tspan><tspan style="display:none">X</tspan><tspan>${b}</tspan><rect style="display:none"/><tspan>${c}</tspan></text></svg>`],
  ])('v4.1 読み方 B は見えない中身を除いてつなぐ: %s → 1 件', (_name, body) => {
    const path = body.startsWith('<svg') ? 'parts/p1/figure-1.svg' : 'parts/p1/app.html';
    const bodies = prepareBodies(new Map([[path, body]]));
    expect(bodies.incomplete).toBe(false);
    const r = scanPage(buildNeedles(bodies), bodies, `${L}${P}${R}`, 'u', []);
    // v4.2: joined_all（見えない中身も入れる）でも当たることがある。見えない中身を除く joined で必ず当たる
    expect(r.hits.map((h) => [h.view, h.text.trim()])).toContainEqual(['joined', P]);
  });
  it('v4.2 template の中だけの丸写しも joined_all で見つける（見えない中身の除き方の判定違いで一致を失わないため、安全側の誤検出として許す）', () => {
    const bodies = prepareBodies(new Map([['parts/p1/app.html', `<template>${P}</template>`]]));
    expect(scanPage(buildNeedles(bodies), bodies, P, 'u', []).hits.map((h) => h.view)).toEqual(['joined_all']);
  });
  it('v4.1 hidden・display:none の中だけの文は、読み方 A（§AK と共有の textOfHtml。変えない）では見えるので 1 件のまま', () => {
    for (const body of [`<p hidden>${P}</p>`, `<div style="display:none">${P}</div>`]) {
      const bodies = prepareBodies(new Map([['parts/p1/app.html', body]]));
      expect(scanPage(buildNeedles(bodies), bodies, P, 'u', []).hits.map((h) => h.view)).toContain('spaced');
    }
  });
  it('v4.2 見えない要素が閉じていない → joined は落とすが、spaced / joined_all が中身ごと見るので incomplete にせず見つける', () => {
    const bodies = prepareBodies(new Map([['parts/p1/app.html', `<div hidden>${P}`]]));
    expect(bodies.incomplete).toBe(false);
    expect(scanPage(buildNeedles(bodies), bodies, P, 'u', []).hits.length).toBeGreaterThanOrEqual(1);
  });
  it('v4.2 見えない判定の誤り（後の宣言で display:block に戻す・子で visibility:visible に戻す）でも、joined_all が見える文ごと見つける', () => {
    for (const body of [
      `<span>${a}</span><span style="display:none;display:block">${b}</span><span>${c}</span>`,
      `<span>${a}</span><b style="visibility:hidden"><i style="visibility:visible">${b}</i></b><span>${c}</span>`,
    ]) {
      const bodies = prepareBodies(new Map([['parts/p1/app.html', body]]));
      const r = scanPage(buildNeedles(bodies), bodies, `${L}${P}${R}`, 'u', []);
      expect(r.hits.map((h) => [h.view, h.text.trim()])).toContainEqual(['joined_all', P]);
    }
  });
  it('script と style の中身は入れない・comment も入れない', () => {
    for (const body of [`<script>var s = "${P}";</script>`, `<style>/* ${P} */</style>`, `<!-- ${P} -->`]) {
      const bodies = prepareBodies(new Map([['parts/p1/app.html', body]]));
      expect(scanPage(buildNeedles(bodies), bodies, P, 'u', []).hits).toEqual([]);
    }
  });
  it('引用の前後の空白だけの違いでは丸写しにしない（区間の前後の空白を取ってから引用と比べる）', () => {
    expect(scan(`あ ${P} い`, `う ${P} え`, [P]).hits).toEqual([]);
    expect(scan(`あ ${P} い`, `う ${P} え`, []).hits.length).toBe(1);
  });
});

describe('AK2-4 6-b 走査はページの全部の位置を調べる', () => {
  const P = uniq(200);
  it('本文 a = P[0:120]（引用に収まる）と b = P[20:140]（収まらない）→ b の 1 件', () => {
    const bodies = prepareBodies(
      new Map([
        ['parts/p1/a.md', P.slice(0, 120)],
        ['parts/p1/b.md', P.slice(20, 140)],
      ]),
    );
    const r = scanPage(buildNeedles(bodies), bodies, P, 'u', [normalizeForMatch(P.slice(0, 120))]);
    expect(r.hits.map((h) => [h.path, h.start, h.length])).toEqual([['parts/p1/b.md', 0, 120]]);
  });
  it('最初の一致が 90 字で、その内側から始まる 100 字の一致 → 見つかる', () => {
    const bodies = prepareBodies(
      new Map([
        ['parts/p1/a.md', P.slice(0, 90)],
        ['parts/p1/b.md', P.slice(20, 120)],
      ]),
    );
    const r = scanPage(buildNeedles(bodies), bodies, P, 'u', []);
    expect(r.hits.map((h) => [h.path, h.length])).toEqual([['parts/p1/b.md', 100]]);
  });
  it('md の行内コードの中の _ 入りの 123 字がページと一致 → 見つかる', () => {
    const code = Array.from({ length: 41 }, (_, k) => `${String.fromCodePoint(0x61 + (k % 26))}${String.fromCodePoint(0x4e00 + k)}_`).join(''); // 123 字・_ が 41 個
    expect(cpLen(code)).toBe(123);
    const r = scan(`前の文 \`${code}\` 後の文`, `ページ ${code} 終わり`);
    expect(r.hits.map((h) => h.text.trim())).toEqual([code]); // 前後の空白も一致に入る
  });
});

describe('AK2-4 4 mergeHits', () => {
  const hit = (path: string, start: number, length: number, url = 'u1'): VerbatimHit => {
    const text = uniq(length, 0x4e00 + start);
    return { path, view: 'spaced', start, length, url, sample: text.slice(0, 60), text };
  };
  it('同じ path の重なる区間は和をとって 1 件（url は先に見つけた方）・text は和の全文', () => {
    const m = mergeHits([hit('p/a.md', 0, 120, 'first')], [hit('p/a.md', 100, 120, 'second')]);
    expect(m).toEqual([{ path: 'p/a.md', view: 'spaced', start: 0, length: 220, url: 'first', sample: uniq(60), text: uniq(220) }]);
    // 同じ path でも読み方が違えば併合しない（v4 裁定 2）
    expect(mergeHits([hit('p/a.md', 0, 120)], [{ ...hit('p/a.md', 50, 120), view: 'joined' }]).map((h) => h.view)).toEqual(['spaced', 'joined']);
    // 先に見つけた方が後ろの区間でも url はその方
    expect(mergeHits([hit('p/a.md', 100, 120, 'first')], [hit('p/a.md', 0, 120, 'second')])[0].url).toBe('first');
    // 隣り合うだけ（重ならない）は別
    expect(mergeHits([hit('p/a.md', 0, 100)], [hit('p/a.md', 100, 100)]).length).toBe(2);
  });
  it('順は path の辞書順 → start の昇順。text が 1,000 字を超える和は先頭 1,000 字と text_cut', () => {
    const m = mergeHits([hit('p/b.md', 500, 100), hit('p/a.md', 300, 100)], [hit('p/a.md', 0, 100)]);
    expect(m.map((h) => [h.path, h.start])).toEqual([
      ['p/a.md', 0],
      ['p/a.md', 300],
      ['p/b.md', 500],
    ]);
    const big = mergeHits([hit('p/a.md', 0, 700)], [hit('p/a.md', 600, 700)])[0];
    expect([big.length, cpLen(big.text), big.text_cut]).toEqual([1300, 1000, true]);
    expect(big.text).toBe(uniq(1000));
  });
  it('30 件で切っても、取り込みが数える total は全件数（切っても状態は found）', () => {
    let acc: VerbatimHit[] = [];
    let total = 0;
    for (let k = 0; k < 35; k++) {
      const more = [hit('p/a.md', k * 200, 100)];
      acc = mergeHits(acc, more);
      total += more.length;
    }
    expect([acc.length, total, VERBATIM_HITS_MAX]).toEqual([30, 35, 30]);
  });
});

describe('AK2-4 5（純関数側）accumulateCitations の callback', () => {
  const sources: CitationSourceInput[] = [{ id: 's1', url: 'https://a.example/x', quoted_excerpt: '15 blocks', is_primary: true }];
  const events = [
    { id: 'tu1', type: 'agent.tool_use', name: 'web_fetch', input: { url: 'https://a.example/x' } },
    { id: 'tu2', type: 'agent.tool_use', name: 'web_fetch', input: { url: 'https://b.example/y' } },
    { id: 'tu3', type: 'agent.tool_use', name: 'web_fetch', input: { url: 'https://c.example/z' } },
    { id: 'tu4', type: 'agent.tool_use', name: 'web_fetch', input: { url: 'https://d.example/w' } },
    { type: 'agent.tool_result', tool_use_id: 'tu1', content: [{ type: 'text', text: 'signal travels 15 blocks' }] },
    { type: 'agent.tool_result', tool_use_id: 'tu2', is_error: true, content: [{ type: 'text', text: 'url_not_accessible' }] },
    { type: 'agent.tool_result', tool_use_id: 'tu3', content: [{ type: 'text', text: 'saved to /mnt/session/out.txt' }] },
    { type: 'agent.tool_result', tool_use_id: 'tu4', content: [{ type: 'image', source: {} }] },
    { type: 'agent.tool_result', tool_use_id: 'tu1', content: [{ type: 'text', text: 'again' }] },
  ];
  it('本文のある result だけ・1 回だけ呼ぶ（エラー・offload・非テキスト・処理済みは呼ばない）。出典照合の結果は callback の有無で変わらない', () => {
    const seen: Array<[string, string]> = [];
    const withCb = accumulateCitations(newCitationAcc(), sources, events, (u, t) => seen.push([u, t]));
    const without = accumulateCitations(newCitationAcc(), sources, events);
    expect(seen).toEqual([['https://a.example/x', 'signal travels 15 blocks']]);
    expect(withCb).toEqual(without);
    expect(finishCitations(withCb, sources)).toEqual(finishCitations(without, sources));
  });
  it('use が 1 ページ目・result が 2 ページ目（JSON で復元）でも呼ぶ', () => {
    const seen: string[] = [];
    const acc = accumulateCitations(newCitationAcc(), sources, events.slice(0, 1), (u) => seen.push(u));
    const restored = JSON.parse(JSON.stringify(acc));
    accumulateCitations(restored, sources, events.slice(4, 5), (u) => seen.push(u));
    expect(seen).toEqual(['https://a.example/x']);
  });
});

// ---------------------------------------------------------------------------------------------
// 仕分け・承認・公開（AK2-4 7・8）

let w: World;
beforeEach(() => {
  w = world();
});
const FOUND = {
  ...GREEN_CHECKS,
  verbatim_copy: [{ path: 'parts/p1/elementary-long.md', start: 3, length: 120, url: 'https://a.example/x', sample: 'あ'.repeat(60), text: 'あ'.repeat(120) }],
  verbatim_total: 1,
  verbatim_pages: 2,
  verbatim_status: 'found',
};
const INCOMPLETE = { ...GREEN_CHECKS, verbatim_copy: [], verbatim_total: 0, verbatim_pages: 0, verbatim_status: 'incomplete' };
const CLEAN = { ...GREEN_CHECKS, verbatim_copy: [], verbatim_total: 0, verbatim_pages: 3, verbatim_status: 'clean' };
const setChecks = (vid: string, c: unknown) => w.db.prepare('UPDATE material_versions SET checks_json = ? WHERE id = ?').run(JSON.stringify(c), vid);
const vrow = (vid: string) => one(w.db, 'SELECT * FROM material_versions WHERE id = ?', vid) as unknown as TriageApplyRow & Record<string, unknown>;
const latestOf = (vid: string) => one(w.db, 'SELECT id, result_json FROM verifications WHERE material_version_id = ? ORDER BY attempt DESC LIMIT 1', vid) as { id: string; result_json: string };
const approve = (vid: string) =>
  decide(ctx(w, 'POST', { decision: 'approve', verification_id: latestOf(vid).id, reader_gen: vrow(vid).reader_token ?? null }), vid);

describe('AK2-4 7 仕分け', () => {
  it('verbatim_copy の各件と verbatim_incomplete が terms_of_use の fix 項目になり、自動の直しの返し文に原因が出る', async () => {
    seed(w, good('m1', 'v1'));
    setChecks('v1', { ...FOUND, verbatim_status: 'found' });
    const t = await computeTriage(w.env, vrow('v1'), latestOf('v1'));
    const it1 = t.items.find((i) => i.cause === 'verbatim_copy')!;
    expect(it1).toMatchObject({ kind: 'check', key: 'terms_of_use', severity: 'fix', path: 'parts/p1/elementary-long.md', quote: 'あ'.repeat(60), title: ITEM_TITLE.verbatim_copy });
    expect(t.auto.terms_of_use).toBe('review');
    expect(t.action).toBe('auto_return');
    expect(t.return_note).toContain('本文にページの文の丸写し（100 字以上）がある');
    expect(ITEM_CAUSES).toContain('verbatim_copy');
    expect(ITEM_CAUSES).toContain('verbatim_incomplete');

    seed(w, good('m2', 'v2'));
    setChecks('v2', INCOMPLETE);
    const t2 = await computeTriage(w.env, vrow('v2'), latestOf('v2'));
    expect(t2.items.filter((i) => i.cause === 'verbatim_incomplete')).toMatchObject([{ key: 'terms_of_use', severity: 'fix', title: '丸写しの検査が最後まで済んでいない' }]);
    expect(t2.return_note).toContain('丸写しの検査が最後まで済んでいない');

    seed(w, good('m3', 'v3'));
    setChecks('v3', CLEAN);
    const t3 = await computeTriage(w.env, vrow('v3'), latestOf('v3'));
    expect(t3.items.some((i) => i.cause.startsWith('verbatim'))).toBe(false);
    expect(t3.gate).toBe('clean');
  });
});

describe('AK2-4 8 公開の止め', () => {
  it('承認: found → 409 verbatim_copy_present / incomplete → 409 verbatim_incomplete（版は review のまま）', async () => {
    w = world({ AUTO_RETURN_MAX: '0' });
    seed(w, good('m1', 'v1'));
    setChecks('v1', FOUND);
    const r = await approve('v1');
    expect([r.status, ((await r.json()) as { error: string }).error]).toEqual([409, 'verbatim_copy_present']);
    seed(w, good('m2', 'v2'));
    setChecks('v2', INCOMPLETE);
    const r2 = await approve('v2');
    expect([r2.status, ((await r2.json()) as { error: string }).error]).toEqual([409, 'verbatim_incomplete']);
    expect([vrow('v1').status, vrow('v2').status]).toEqual(['review', 'review']);
  });
  it('verbatim_status の無い古い版は通る / clean は通る', async () => {
    seed(w, good('m1', 'v1'));
    expect((await approve('v1')).status).toBe(200);
    seed(w, good('m2', 'v2'));
    setChecks('v2', CLEAN);
    expect((await approve('v2')).status).toBe(200);
    expect(vrow('v2').status).toBe('approved');
  });
  it('自動公開: 仕分けが clean と記録した後に found になった版は公開しない。publishSwitch も述語も止める', async () => {
    seed(w, good('m1', 'v1'));
    const t = await computeTriage(w.env, vrow('v1'), latestOf('v1'));
    expect(await applyTriage(w.env, vrow('v1'), t)).toBe('none');
    setSetting(w, 'auto_publish', '1');
    setChecks('v1', FOUND);
    expect(await autoPublishStep(w.env, { deadline: Date.now() + 600_000 })).not.toContain('published');
    expect(vrow('v1').status).toBe('review');
    const args = {
      kind: 'approve' as const,
      material_id: 'm1',
      version_id: 'v1',
      verification_id: latestOf('v1').id,
      reviewer_email: 'system:auto-publish',
      checklist_json: '{}',
      note: null,
      require_auto_publish: true,
    };
    const c = { decision_id: 'd1', now: '2026-11-08T00:00:00.000Z' };
    expect(await publishSwitch(w.env.DB, args, c)).toEqual({ ok: false, reason: 'verbatim_copy_present' });
    // 先の読みを通り抜けても、同じ batch の述語が止める
    expect((await conditionalBatch(w.env.DB, buildPublishSwitch(args, c))).ok).toBe(false);
    expect(vrow('v1').status).toBe('review');
    // clean に戻せば同じ引数で通る
    setChecks('v1', CLEAN);
    expect(await publishSwitch(w.env.DB, args, { ...c, decision_id: 'd2' })).toEqual({ ok: true });
  });
  it('戻し（rollback）も止まる。古い版・clean は戻せる', async () => {
    seed(w, good('m1', 'v1'));
    seed(w, good('m1', 'v2', { newMaterial: false, version: 2 }));
    w.db.prepare("UPDATE material_versions SET status = 'approved' WHERE id IN ('v1','v2')").run();
    w.db.prepare("UPDATE materials SET current_version_id = 'v2', publish_status = 'available' WHERE id = 'm1'").run();
    setChecks('v1', INCOMPLETE);
    const rb = () => rollbackMaterial(ctx(w, 'POST', { version_id: 'v1', note: '戻す' }), 'm1');
    const refused = await rb();
    expect([refused.status, ((await refused.json()) as { error: string }).error]).toEqual([409, 'verbatim_incomplete']); // v4 裁定 4: 理由を捨てない
    expect(one(w.db, "SELECT current_version_id FROM materials WHERE id = 'm1'").current_version_id).toBe('v2');
    expect(await publishSwitch(w.env.DB, { kind: 'rollback', material_id: 'm1', version_id: 'v1', reviewer_email: 'x', note: null }, { decision_id: 'd', now: 'n' })).toEqual({
      ok: false,
      reason: 'verbatim_incomplete',
    });
    setChecks('v1', CLEAN);
    expect((await rb()).status).toBe(200);
    expect(one(w.db, "SELECT current_version_id FROM materials WHERE id = 'm1'").current_version_id).toBe('v1');
    // verbatim_status の無い古い版（v2）も戻せる
    const back = await rollbackMaterial(ctx(w, 'POST', { version_id: 'v2', note: '戻す' }), 'm1');
    expect(back.status).toBe(200);
  });
  it('verbatimBlockReason: 無い・読めない → null / clean → null / found / incomplete / 知らない値 → 止める', () => {
    expect(verbatimBlockReason('{}')).toBeNull();
    expect(verbatimBlockReason('not json')).toBeNull();
    expect(verbatimBlockReason(null)).toBeNull();
    expect(verbatimBlockReason(JSON.stringify(CLEAN))).toBeNull();
    expect(verbatimBlockReason(JSON.stringify(FOUND))).toBe('verbatim_copy_present');
    expect(verbatimBlockReason(JSON.stringify(INCOMPLETE))).toBe('verbatim_incomplete');
    expect(verbatimBlockReason('{"verbatim_status":null}')).toBe('verbatim_incomplete');
  });
});

describe('AK2-4 9 表示 verbatimHtml', () => {
  const code = readFileSync(new URL('../public/admin/admin.js', import.meta.url), 'utf8');
  const win: Record<string, unknown> = { __FACTORY_ADMIN_NO_BOOT__: true };
  vm.runInNewContext(code, { window: win, console }, { timeout: 2000 });
  const verbatimHtml = (win.FactoryAdminReview as { verbatimHtml(c: unknown): string }).verbatimHtml;
  it('3 通り（なし・件数と一覧・済んでいない）。キーの無い古い版は何も出さない', () => {
    expect(verbatimHtml(CLEAN)).toContain('丸写し: なし（検査済み）');
    expect(verbatimHtml(INCOMPLETE)).toContain('丸写しの検査: 最後まで済んでいません');
    const f = verbatimHtml(FOUND);
    expect(f).toContain('丸写し: 1 件');
    expect(f).toContain('parts/p1/elementary-long.md');
    expect(f).toContain('a.example');
    expect(f.includes('https://a.example/x')).toBe(false); // host だけ
    expect(verbatimHtml(GREEN_CHECKS)).toBe('');
    // v4 裁定 4: found かつ未完了
    expect(verbatimHtml({ ...FOUND, verbatim_incomplete: true })).toContain('丸写し: 1 件（検査は最後まで済んでいません）');
    expect(verbatimHtml({ ...FOUND, verbatim_incomplete: false })).not.toContain('済んでいません');
    expect(verbatimHtml(null)).toBe('');
  });
  it('path・sample・host は esc する', () => {
    const h = verbatimHtml({
      verbatim_status: 'found',
      verbatim_total: 1,
      verbatim_copy: [{ path: '<b>p</b>', sample: '<img src=x onerror=alert(1)>', url: 'https://ev"il<x>.example/a' }],
    });
    expect(h).not.toContain('<img');
    expect(h).not.toContain('<b>p');
    expect(h).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(h).toContain('&lt;b&gt;p&lt;/b&gt;');
    expect(h).not.toContain('ev"il');
  });
});
