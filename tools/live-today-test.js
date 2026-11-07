/* 実サイト app/ の今日のお題の純関数テスト（contract-LS §LS-13 / LS-18-16・17・26・28）。
   変換（配信の形 → 画面の形・[cN] 除去・禁止語）・読み込み（day → stock・一部失敗・全部失敗）・お題の解決（'fx-' id / lineage / 写し）・
   記録のキー（lineage）と写し。通信しない（取得は差し替え）。node tools/live-today-test.js → 最後に LIVE_TODAY_TEST=PASS|FAIL */
'use strict';
var path = require('path');
var fs = require('fs');
var APP = path.join(__dirname, '..', 'app', 'js');
var TDD = require(path.join(APP, 'today-data.js'));
var TD = require(path.join(APP, 'today.js'));

var pass = 0, fail = 0;
function ok(cond, name) { if (cond) pass += 1; else { fail += 1; console.log('NG  ' + name); } }
function eq(a, b, name) { ok(JSON.stringify(a) === JSON.stringify(b), name + '  (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }
function L(s, e) { return { s: s, e: e || s }; }
function clone(v) { return JSON.parse(JSON.stringify(v)); }

// ---------- 配信の形の見本（factory/worker/src/topics/schema.ts の TopicBody と同じ鍵） ----------
function talkItem(n, o) {
  o = o || {};
  return {
    topic_id: 'tp_talk_' + n, kind: 'talk', needs_supporter: !!o.heavy, lineage_id: o.lineage || ('ln_talk_' + n),
    body: {
      schema_version: 1, kind: 'talk', locale: 'ja-JP', title: L(o.title || ('話し合いのお題 ' + n + ' [c1]'), 'はなしあいのおだい ' + n),
      lead: L('前提の文 [c1, c2]です'), event_day: null,
      premises: [{ text: L('前提 1') }], facts: [{ id: 'f1', text: L('事実 1 [c3]'), source_ids: ['s1'] }],
      views: [{ id: 'v1', who: { name: '考え A', type: 'position' }, side: 'a', stance: L('A の考え'), source_ids: ['s1'] },
        { id: 'v2', who: { name: '考え B', type: 'position' }, side: 'b', stance: L('B の考え'), source_ids: [] }],
      asks: [{ level: 'check', text: L('確かめる問い') }, { level: 'self', text: L('自分の問い') }, { level: 'open', text: L('ひらいた問い') }],
      stances: [{ id: 'a', label: L('賛成') }, { id: 'b', label: L('反対') }],
      next: { talk: L('話したい'), make_title: L('作る題'), make_steps: [L('手順 1'), L('手順 2'), L('手順 3')] },
      make: null,
      sources: [{ id: 's1', url: o.url || 'https://example.org/a', name: '出典 1', quote: '引用', for_learner: true, checked: o.checked }],
      tags: { interests: [], concept_codes: [] }
    }
  };
}
function newsItem(n) {
  var t = talkItem(n);
  t.topic_id = 'tp_news_' + n; t.kind = 'news'; t.lineage_id = 'ln_news_' + n;
  t.body.kind = 'news'; t.body.event_day = '2026-11-04'; t.body.premises = [];
  return t;
}
function makeItem(n, o) {
  o = o || {};
  return {
    topic_id: 'tp_make_' + n, kind: 'make', needs_supporter: false, lineage_id: o.lineage || ('ln_make_' + n),
    body: {
      schema_version: 1, kind: 'make', locale: 'ja-JP', title: L(o.title || ('作るお題 ' + n + ' [c2]')), lead: L('作るリード'), event_day: null,
      premises: [], facts: [], views: [], asks: [], stances: [], next: null,
      make: { category: o.category || 'minecraft', line: L('ひとこと'), first_step: L('最初の一歩 [c1]'), need: L('パソコン · 教室の中'), minutes: 30,
        steps: o.steps || [L('手順 1'), L('手順 2'), L('手順 3')], safety: !!o.safety, thumb_prompt: null, hints: o.hints },
      sources: [], tags: { interests: ['minecraft'], concept_codes: [] }
    }
  };
}

// ---------- 変換（対話） ----------
var d1 = TDD.convertTopic(talkItem(1, { checked: '2026-11-07' }));
eq(d1.id, 'fx-tp_talk_1', '変換 id は fx- + topic_id');
eq(d1.lineage, 'ln_talk_1', '変換 lineage は lineage_id');
eq(d1.title, ['話し合いのお題 1', 'はなしあいのおだい 1'], '変換 [c1] を取り除く（前の空白ごと）');
eq(d1.lead[0], '前提の文です', '変換 [c1, c2] を取り除く');
eq(d1.facts.map(function (f) { return f.text[0]; }), ['前提 1', '事実 1'], '変換 前提は facts の前・[c3] を取り除く');
eq(d1.reason, null, '変換 reason は null（なぜ出したか を出さない）');
eq(d1.source, 'factory', '変換 出所は factory');
eq(d1.sources[0].checked, '2026-11-07', '変換 checked は出典の checked');
eq(TDD.convertTopic(talkItem(2)).sources[0].checked, null, '変換 checked が無ければ null（取り込み日で代用しない）');
eq(TDD.convertTopic(newsItem(1)).date, ['11 月 4 日', '11 月 4 日'], '変換 news の日付');
eq(TDD.validateDialog(d1), [], '検査 対話は合格');
ok(TDD.kidTexts(d1).every(function (s) { return !/\[c\d+/.test(s); }), '変換 子どもが読む文に [cN] が無い');
eq(TDD.validateDialog(TDD.convertTopic(talkItem(3, { title: 'クラスの順位を考える' })))[0], 'forbidden', '検査 禁止語のお題は捨てる');
eq(TDD.validateDialog(TDD.convertTopic(talkItem(4, { url: 'http://example.org/' }))), ['url'], '検査 出典の url は https:// だけ');
eq(TDD.validateDialog(TDD.convertTopic(talkItem(5, { url: 'https://example.org/"><x' }))), ['url'], '検査 url に属性を壊す文字は通さない');
eq(TDD.FORBIDDEN, ['点数', 'ランキング', '順位', '評価', '成績', 'レベル'], '禁止語の配列（check.sh / pull-topics.mjs と同じ）');
eq(TDD.stripClaims('a [c1][c2] b [c10、c11]'), 'a b', 'stripClaims 続いた印・読点の区切り');
eq(TDD.convertTopic({ topic_id: 'x', kind: 'zzz', body: {} }), null, '変換 知らない kind は null');
eq(TDD.convertTopic({ kind: 'talk', body: {} }), null, '変換 topic_id が無ければ null');

// ---------- 変換（作る・ためす。LS-18-16） ----------
var m1 = TDD.convertTopic(makeItem(1, { safety: true }));
eq([m1.id, m1.lineage, m1.kind, m1.category], ['fx-tp_make_1', 'ln_make_1', 'make', 'minecraft'], '変換 make の id / lineage / kind / category');
eq(m1.title[0], '作るお題 1', '変換 make の題の [c2] を取り除く');
eq(m1.firstStep[0], '最初の一歩', '変換 make の最初の一歩の [c1] を取り除く');
eq(m1.need[0], 'パソコン · 教室の中', '変換 make の必要な物');
eq(m1.makeSteps.length, 3, '変換 make の手順');
eq([m1.safety, m1.reason, m1.makeTheme, m1.find], [true, null, null, null], '変換 make: safety / reason null / 題材 null / 手がかり無し → find null（実物を探すを出さない）');
eq(TDD.validateMake(m1), [], '検査 make は合格');
var m2 = TDD.convertTopic(makeItem(2, { hints: [L('窓の外の木'), L('落ち葉')] }));
eq(m2.find, { hints: [['窓の外の木', '窓の外の木'], ['落ち葉', '落ち葉']] }, '変換 make: hints があれば find（実物を探す）');
eq(TDD.validateMake(TDD.convertTopic(makeItem(3, { steps: [L('1'), L('2')] }))), ['steps'], '検査 make の手順は 3〜4');
eq(TDD.validateMake(TDD.convertTopic(makeItem(4, { title: 'レベルを上げる' }))), ['forbidden'], '検査 make の禁止語');
ok(/^<svg class="mk-art td-art"/.test(TDD.cardArt(m1)), 'cardArt make は種類の線画（td-art）');
ok(/^<svg class="mk-art td-art"/.test(TDD.cardArt(d1)), 'cardArt 対話は kind の線画');

// ---------- 応答の束（同じ lineage は 1 本: 日付の新しい方） ----------
var b = TDD.buildTopics([
  { kind: 'talk', topics: [talkItem(10, { lineage: 'L-same', title: 'ストックの版' })] },
  { day: '2026-11-08', topics: [talkItem(11, { lineage: 'L-same', title: '今日の版' }), makeItem(1), { topic_id: 'bad', kind: 'talk', body: null }] }
]);
eq(b.topics.map(function (t) { return t.id; }), ['fx-tp_talk_11', 'fx-tp_make_1'], 'buildTopics 日付のある版が勝つ・形の違うものは捨てる');
eq([b.stat.topics, b.stat.kept, b.stat.dropped], [4, 2, 2], 'buildTopics 件数');

// ---------- 読み込み（day → stock。LS-13 / LS-18-28） ----------
function fakeGet(table) {
  var calls = [];
  var get = function (url) {
    calls.push(url);
    var k = Object.keys(table).filter(function (x) { return url.indexOf(x) >= 0; })[0];
    var v = k ? table[k] : { ok: false };
    return Promise.resolve(typeof v === 'function' ? v() : v);
  };
  get.calls = calls;
  return get;
}
var BASE = 'https://factory.example';
function run(table, o) {
  var g = fakeGet(table);
  return TDD.load(Object.assign({ day: '2026-11-08', base: BASE, get: g, force: true }, o || {})).then(function (st) { return { st: st, calls: g.calls, topics: TDD.loaded() }; });
}
var steps = [];
// 1) day に 4 件（対話 1 + make 3）→ stock は読まない
steps.push(function () {
  return run({ '/api/library/topics?day=': { ok: true, json: { day: '2026-11-08', topics: [talkItem(1), makeItem(1), makeItem(2), makeItem(3)] } } }).then(function (r) {
    eq(r.calls, [BASE + '/api/library/topics?day=2026-11-08'], '読み込み day が 1 件以上なら HTTP は 1 回');
    eq([r.st.phase, r.st.source, r.topics.length], ['done', 'day', 4], '読み込み day の 4 件');
    eq(TDD.kindPool('talk').length + TDD.pool().length, 4, '読み込み プールの合計 = 4（画面のカード 1 + 3）');
  });
});
// 2) day が 0 件 → stock 4 回（news / talk / philo / make, limit=3）
steps.push(function () {
  return run({
    'topics?day=': { ok: true, json: { day: '2026-11-08', topics: [] } },
    'kind=news': { ok: true, json: { kind: 'news', topics: [newsItem(1)] } },
    'kind=talk': { ok: true, json: { kind: 'talk', topics: [talkItem(1), talkItem(2)] } },
    'kind=philo': { ok: true, json: { kind: 'philo', topics: [] } },
    'kind=make': { ok: true, json: { kind: 'make', topics: [makeItem(1)] } }
  }).then(function (r) {
    eq(r.calls.length, 5, '読み込み day 0 件 → stock 4 回（合計 5 回）');
    ok(r.calls.slice(1).every(function (u) { return /\/api\/library\/topics\/stock\?kind=(news|talk|philo|make)&limit=3$/.test(u); }), '読み込み stock の url（limit=3）');
    eq([r.st.phase, r.st.source, r.st.fail, r.topics.length], ['done', 'stock', { talk: false, make: false }, 4], '読み込み stock の件数');
  });
});
// 3) stock の一部だけ失敗 → 取れた分を出し、その節に失敗の印
steps.push(function () {
  return run({
    'topics?day=': { ok: true, json: { day: '2026-11-08', topics: [] } },
    'kind=talk': { ok: true, json: { kind: 'talk', topics: [talkItem(1)] } },
    'kind=news': { ok: true, json: { kind: 'news', topics: [] } },
    'kind=philo': { ok: true, json: { kind: 'philo', topics: [] } }
  }).then(function (r) {
    eq([r.st.phase, r.st.fail, r.topics.length], ['done', { talk: false, make: true }, 1], '読み込み make だけ失敗 → make の節に td_fetch_fail');
  });
});
// 4) day が取れない → 全体が失敗（stock を読まない）
steps.push(function () {
  return run({}).then(function (r) {
    eq([r.st.phase, r.calls.length, r.topics.length], ['fail', 1, 0], '読み込み day の失敗 → fail（td_fetch_fail）・HTTP は 1 回');
  });
});
// 5) stock が全部取れない → fail
steps.push(function () {
  return run({ 'topics?day=': { ok: true, json: { day: '2026-11-08', topics: [] } } }).then(function (r) {
    eq([r.st.phase, r.calls.length], ['fail', 5], '読み込み stock 全部失敗 → fail');
  });
});
// 6) 両方 0 件 → done・0 件（td_empty）
steps.push(function () {
  var empty = function (k) { return { ok: true, json: { kind: k, topics: [] } }; };
  return run({ 'topics?day=': { ok: true, json: { day: '2026-11-08', topics: [] } }, 'kind=news': empty('news'), 'kind=talk': empty('talk'), 'kind=philo': empty('philo'), 'kind=make': empty('make') }).then(function (r) {
    eq([r.st.phase, r.topics.length, r.st.fail], ['done', 0, { talk: false, make: false }], '読み込み 両方 0 件 → done 0 件（td_empty）');
  });
});
// 7) 取得が例外を投げても落ちない
steps.push(function () {
  return TDD.load({ day: '2026-11-08', base: BASE, force: true, get: function () { throw new Error('boom'); } }).then(function (st) {
    eq(st.phase, 'fail', '読み込み 取得の例外は fail');
  });
});
// 8) 配信の根: window.DES_FACTORY_BASE（'' = 同じ origin）が DES.factory.base より優先
steps.push(function () {
  global.DES.factory = { base: 'https://de-school-factory.h-fujii.workers.dev/', timeoutMs: 8000 };
  eq(TDD.base(), 'https://de-school-factory.h-fujii.workers.dev', 'base 既定は DES.factory.base（末尾の / を落とす）');
  global.DES_FACTORY_BASE = '';
  eq(TDD.base(), '', 'base DES_FACTORY_BASE があればそれ（同一 origin の中継）');
  delete global.DES_FACTORY_BASE;
  return Promise.resolve();
});

// ---------- お題の解決・記録のキー（lineage）・写し ----------
steps.push(function () {
  TDD._setLoaded(TDD.buildTopics([{ day: '2026-11-08', topics: [talkItem(1), talkItem(2), talkItem(3), newsItem(1), makeItem(1), makeItem(2, { hints: [L('木')] }), makeItem(3), makeItem(4)] }]).topics);
  var S0 = TD.initial();
  eq(TDD.resolve('fx-tp_talk_1', null, 'dialog').lineage, 'ln_talk_1', '解決 fx- id で引ける');
  eq(TDD.resolve('ln_talk_1', null, 'dialog').id, 'fx-tp_talk_1', '解決 lineage で引ける');
  eq(TDD.resolve('ln_talk_1', null, 'make'), null, '解決 get は make だけ・getDialog は対話だけ');
  eq(TDD.resolve('fx-tp_make_1', null, 'make').kind, 'make', '解決 make');

  // とっておく → kept は lineage、写しが添わる
  var k1 = TD.keep(S0, 'fx-tp_talk_1');
  eq(k1.kept, ['ln_talk_1'], '記録 kept のキーは lineage');
  ok(k1.copies.ln_talk_1 && k1.copies.ln_talk_1.body.id === 'fx-tp_talk_1' && k1.copies.ln_talk_1.kind === 'talk', '記録 写し { lineage, title, kind, body } を添える');
  eq(k1.copies.ln_talk_1.title, ['話し合いのお題 1', 'はなしあいのおだい 1'], '記録 写しの title は [js, es]');
  ok(TD.isKept(k1, 'fx-tp_talk_1') && TD.isKept(k1, 'ln_talk_1'), '記録 isKept は fx- id でも lineage でも');
  eq(TD.keep(k1, 'ln_talk_1'), k1, '記録 2 回とっておかない');
  eq(TD.unkeep(k1, 'fx-tp_talk_1').state.kept, [], '記録 外す');
  // 考えを置く・問いを選ぶ・サークル
  var t1 = TD.putMark(TD.pickAsk(k1, 'fx-tp_talk_2', 'self'), 'fx-tp_talk_2', { stance: 'a', line: ' 一行 ', at: '2026-11-08T01:05:00.000Z', time: '11/8 10:05' });
  eq(Object.keys(t1.think), ['ln_talk_2'], '記録 think のキーは lineage');
  eq(t1.think.ln_talk_2.marks[0], { id: 'mk1', stance: 'a', line: '一行', at: '2026-11-08T01:05:00.000Z', time: '11/8 10:05' }, '記録 考えのあしあと（at + M/D H:MM）');
  eq(t1.think.ln_talk_2.ask, 'self', '記録 問いを選ぶ');
  var c1 = TD.toCircle(t1, 'fx-tp_talk_2', { ask: 'self', at: '2026-11-08T01:06:00.000Z', time: '11/8 10:06' });
  eq(c1.circle, [{ id: 'ln_talk_2', ask: 'self', at: '2026-11-08T01:06:00.000Z', time: '11/8 10:06' }], '記録 サークル（id = lineage）');
  ok(TD.inCircle(c1, 'fx-tp_talk_2'), '記録 inCircle は fx- id でも');
  // 見つけた写真（本物の写真の dataURL だけ・1 お題 6 枚）
  var photo = { data: 'data:image/jpeg;base64,' + 'QUJD'.repeat(8), w: 640, h: 480 };
  var f1 = TD.addFound(c1, 'fx-tp_make_2', { photo: photo, line: '見つけた', at: '2026-11-08T01:07:00.000Z', time: '11/8 10:07' });
  eq(f1.tried.ln_make_2.found[0], { photo: photo, line: '見つけた', at: '2026-11-08T01:07:00.000Z', time: '11/8 10:07' }, '記録 found[].photo = { data, w, h }');
  eq(f1.tried.ln_make_2.entries.find, true, '記録 写真を残すと 実物を探す の記録');
  eq(TD.addFound(c1, 'fx-tp_make_2', { photo: { data: 'javascript:x', w: 1, h: 1 }, time: 't' }), c1, '記録 dataURL でない写真は残さない');
  var f6 = f1;
  for (var i = 0; i < 6; i++) f6 = TD.addFound(f6, 'fx-tp_make_2', { photo: photo, time: 't' });
  eq(f6.tried.ln_make_2.found.length, 6, '記録 見つけた写真は 1 お題 6 枚まで（LS-18-11）');
  eq(TD.toggleHint(f1, 'fx-tp_make_2', 0).tried.ln_make_2.checks, [0], '記録 手がかりのチェック');
  eq(TD.toggleHint(f1, 'fx-tp_make_1', 0), f1, '記録 手がかりの無いお題はチェックしない');
  ok(TDD.photo(TDD.resolve('ln_make_2', null, 'make'), photo).label, 'photo trail が読む形（label）');
  ok(/^<img class="td-photo" src="data:image\/jpeg;base64,/.test(TDD.photoArt(null, photo)), 'photoArt 本物の写真は img');
  ok(/is-photo/.test(TDD.photoArt(null, { data: 'x' })), 'photoArt 写真が無い時は枠だけ');
  var me = TD.markEntry(f1, 'fx-tp_make_1', 'make');
  ok(me.tried.ln_make_1.entries.make === true && me.copies.ln_make_1, '記録 作ってみる の記録（写しつき）');
  eq(TD.markEntry(f1, 'fx-tp_make_1', 'watch'), f1, '記録 動画・試して遊ぶ の入口は無い');

  // 保存 → 読み直し（normalize）→ 配信から消えても写しから引ける
  var saved = JSON.parse(JSON.stringify(me));
  TDD._setLoaded([], { phase: 'done', source: 'day', fail: { talk: false, make: false } });
  var back = TD.normalize(saved);
  eq(back.kept, ['ln_talk_1'], 'normalize 配信から消えても kept が残る（写しがある）');
  eq(Object.keys(back.think), ['ln_talk_2'], 'normalize think が残る');
  eq(back.circle.length, 1, 'normalize circle が残る');
  eq(back.tried.ln_make_2.found.length, 1, 'normalize found が残る');
  eq(TDD.resolve('fx-tp_talk_1', back.copies, 'dialog').title[0], '話し合いのお題 1', '解決 配信から消えたお題を写しから fx- id で引ける');
  eq(TDD.resolve('ln_make_2', back.copies, 'make').find.hints.length, 1, '解決 写しから lineage で引ける');
  global.DES.state = { odai: back };
  ok(TDD.get('fx-tp_make_2') && TDD.getDialog('ln_talk_2'), 'get / getDialog は DES.state.odai.copies の写しまで見る（trail / make が引ける）');
  ok(!TDD.get('fx-tp_talk_1') && !TDD.getDialog('fx-tp_make_2'), 'get は make だけ・getDialog は対話だけ（写しでも）');
  delete global.DES.state;
  var noCopy = clone(saved);
  delete noCopy.copies.ln_talk_1;
  eq(TD.normalize(noCopy).kept, [], 'normalize 写しの無い記録は捨てる');
  var extra = clone(saved);
  extra.copies.ln_zz = clone(saved.copies.ln_talk_1);
  extra.copies.ln_zz.lineage = 'ln_zz'; extra.copies.ln_zz.body.lineage = 'ln_zz';
  ok(!('ln_zz' in TD.normalize(extra).copies), 'normalize どの記録にも指されない写しは捨てる');
  var bad = clone(saved);
  bad.copies.ln_talk_1.body.title = ['点数を上げる', 'x'];
  eq(TD.normalize(bad).kept, [], 'normalize 検査を通らない写し（禁止語）は捨てる');
  var poison = JSON.parse('{"kept":["__proto__"],"copies":{"__proto__":{"lineage":"__proto__"}},"tried":{"__proto__":{}}}');
  var pn = TD.normalize(poison);
  eq([pn.kept, Object.keys(pn.copies), Object.keys(pn.tried)], [[], [], []], 'normalize __proto__ の鍵は捨てる');
  ok(({}).lineage === undefined, 'normalize で Object の prototype を汚さない');
  eq(TD.normalize(null), TD.initial(), 'normalize null → 初期値');
  var cut = clone(saved);
  cut.tried.ln_make_2.found[0].photo.data = 'data:text/html;base64,AAAA';
  eq(TD.normalize(cut).tried.ln_make_2.found, [], 'normalize 形の違う写真は捨てる');
  return Promise.resolve();
});

// ---------- 一覧に出すお題（3 枚まで・別のお題を見る） ----------
steps.push(function () {
  var pool = ['a', 'b', 'c', 'd'], S0 = TD.initial();
  eq(TD.shownSlots(S0, pool), ['a', 'b', 'c'], 'shownSlots プールの先頭 3 つ');
  eq(TD.shownSlots(S0, ['a']), ['a'], 'shownSlots 1 件なら 1 枚');
  var s1 = TD.swap(S0, 1, pool);
  eq(TD.shownSlots(s1, pool), ['a', 'd', 'c'], 'swap 他のスロットに出ているものは飛ばす');
  var s2 = TD.swap(s1, 1, pool);
  eq(TD.shownSlots(s2, pool), ['a', 'b', 'c'], 'swap 一巡して戻る');
  eq(TD.swap(S0, 0, ['a', 'b', 'c']), S0, 'swap 替えられない時は同じ state');
  eq(TD.shownSlots({ slots: ['zz', 'c'] }, pool), ['a', 'c', 'b'], 'shownSlots 今は無いお題の位置はプールから埋める');
  eq(TD.shownKind(S0, 'talk', ['x', 'y']), 'x', 'shownKind 先頭');
  eq(TD.shownKind(TD.swapKind(S0, 'talk', ['x', 'y']), 'talk', ['x', 'y']), 'y', 'swapKind 次へ');
  eq(TD.swapKind(S0, 'talk', ['x']), S0, 'swapKind 1 件なら替えない');
  eq(TD.stampOf('2026-11-08', '09:05'), '11/8 9:05', 'stampOf M/D H:MM');
  eq(TD.stampOf('2026-11-08', '15:30'), '11/8 15:30', 'stampOf 午後');
  return Promise.resolve();
});

// ---------- ソースの約束 ----------
steps.push(function () {
  var src = fs.readFileSync(path.join(APP, 'today.js'), 'utf8'), dsrc = fs.readFileSync(path.join(APP, 'today-data.js'), 'utf8');
  var code = function (s) { return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''); };
  ok(!/innerHTML/.test(code(src)), 'today.js は innerHTML を使わない');
  ok(!/des3\./.test(src) && /DES\.store\.register\('odai'/.test(src), 'today.js は des.live（register）で保存する');
  ok(!/DES\.data\.(today|now)/.test(src), 'today.js は時刻を DES.clock から');
  ok(!/topicsLive|TDD\.topics\b|DIALOGS/.test(src + dsrc), '固定のお題・焼いた写しを読まない');
  ok(!/od-news-|od-py-|おうちの人|田中/.test(dsrc), 'today-data.js に見本のお題の中身が無い');
  ok(/td_empty: \['今日のお題は、まだ届いていないよ。届いたら、ここに出る', 'きょうのお題は、まだとどいていないよ。とどいたら、ここに出る'\]/.test(src), 'td_empty の文（verbatim）');
  ok(/td_fetch_fail: \['今はお題を取ってこられないよ。少したってから開いてね'/.test(src), 'td_fetch_fail の文（verbatim）');
  ok(/photo_full: \['写真がいっぱいだよ。いらない写真を外してから足してね'/.test(src), 'photo_full の文（verbatim）');
  ok(!/td_src_buddy|td_src_request|td_due|td-watch|td_e_watch|td_e_play|td-change-here/.test(code(src)), '出所「バディが作った」「外からの依頼」「締切」・動画・試して遊ぶ・ここだけ変える を出さない');
  var BAN = /点数|ランキング|順位|評価|成績|レベル|データがありません|学びのバディ|モック|架空/;
  var strs = (code(src).match(/'[^'\n]*'/g) || []).filter(function (s) { return BAN.test(s); });
  eq(strs, [], 'today.js の文字列に禁止語が無い');
  // topics-live.js（焼いた写し）は app/ に無く、index.html も読まない（LS-13。司令塔が削除）
  ok(!fs.existsSync(path.join(APP, 'topics-live.js')), 'topics-live.js は無い');
  ok(!/topics-live/.test(fs.readFileSync(path.join(APP, '..', 'index.html'), 'utf8')), 'index.html は topics-live.js を読まない');
  return Promise.resolve();
});

global.DES = global.DES || {};
steps.reduce(function (p, f) { return p.then(f); }, Promise.resolve()).then(function () {
  console.log('pass=' + pass + ' fail=' + fail);
  console.log('LIVE_TODAY_TEST=' + (fail === 0 ? 'PASS' : 'FAIL'));
  process.exit(fail === 0 ? 0 : 1);
}, function (e) {
  console.log('ERROR ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e));
  console.log('LIVE_TODAY_TEST=FAIL');
  process.exit(1);
});
