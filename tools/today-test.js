/* 今日のお題の純関数テスト（CONTRACT-v3 §X-8）+ 題材の中身（§X-3）。node tools/today-test.js → 最後に TODAY_TEST=PASS|FAIL */
'use strict';
var path = require('path');
var fs = require('fs');
var MD = require(path.join(__dirname, '../app-v3/js/make-data.js'));
var TDD = require(path.join(__dirname, '../app-v3/js/today-data.js'));
var TD = require(path.join(__dirname, '../app-v3/js/today.js'));
var M = require(path.join(__dirname, '../app-v3/js/make.js'));

var pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass += 1; } else { fail += 1; console.log('NG  ' + name); }
}
function eq(a, b, name) { ok(JSON.stringify(a) === JSON.stringify(b), name + '  (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }
function freeze(v) { return JSON.stringify(v); }
var SEED = 'od-seed', SIGN = 'od-sign';

// ---------- 題材（§X-3） ----------
var topics = TDD.topics;
// §AF-1 / AF-6: 作る・ためすは既存 9 + 新 3 = 12 本で fit ごとに 4 本（kind の無いお題 = make）
eq(topics.length, 12, 'AF-6 作る・ためすは 12 本');
['near', 'next', 'new'].forEach(function (f) { eq(TDD.pool(f).length, 4, 'AF-6 fit ' + f + ' は 4 本'); });
eq(topics.filter(function (t) { return TDD.kindOf(t) !== 'make'; }).length, 0, 'AF-1 kind の無い既存のお題は make');
eq(topics.slice(9).map(function (t) { return [t.id, t.fit, t.makeTheme, t.makeVariant]; }),
  [['od-ath-winter', 'near', 'ath', 'ice'], ['od-stop-leaf', 'next', 'stop', 'draw'], ['od-story-snow', 'new', 'story', 'short']], 'AF-3 作る・ためすに足す 3 本（題材・案・fit）');
var ids = topics.map(function (t) { return t.id; });
eq(ids.filter(function (id, i) { return ids.indexOf(id) !== i; }), [], 'X-3 id が重ならない');
var titles = topics.map(function (t) { return t.title[0]; });
ok(titles.indexOf('回りながら落ちる種。紙でも再現できる？') >= 0, 'X-3 v1.0 の例「回りながら落ちる種。紙でも再現できる？」');
ok(titles.indexOf('この街の案内板、初めて来た人にも伝わる？') >= 0, 'X-3 v1.0 の例「この街の案内板、初めて来た人にも伝わる？」');
var req = topics.filter(function (t) { return t.source === 'request'; });
eq(req.length, 1, 'X-3 外からの依頼は 1 本だけ');
ok(req[0] && Array.isArray(req[0].due) && /^\d{1,2}\/\d{1,2}/.test(req[0].due[0]), 'X-3 依頼には締切日');
eq(topics.filter(function (t) { return t.source !== 'request' && t.due != null; }).length, 0, 'X-3 締切は実際の依頼だけ');
eq(topics.filter(function (t) { return t.source !== 'request' && t.source !== 'buddy'; }).length, 0, 'X-3 出所は buddy / request');
eq(topics.filter(function (t) { return t.outdoor && !t.safety; }).map(function (t) { return t.id; }), [], 'X-3 屋外のお題は safety: true');
ok(TDD.get('od-bird').safety === true, 'X-3 生き物（冬鳥）のお題は safety: true');
ok(TDD.get('od-seed').safety === true, 'X-3 はさみを使うお題（種）は safety: true');
var season = topics.filter(function (t) { return /落ち葉|どんぐり|夕方|冬鳥|初雪/.test(t.title[0]); }).length;
ok(season >= 5, 'X-3 11 月の季節のお題が 5 本以上（' + season + '）');
var likes = topics.filter(function (t) { return /マイクラ|Python|回路|ゲーム|ブロック|建物|塔/.test(t.title[0] + t.reason[0]); }).length;
ok(likes >= 6, 'X-3 本人の好き（マイクラ・Python・回路）につながるお題（' + likes + '）');
eq(topics.filter(function (t) { return t.fit === 'near'; }).map(function (t) { return t.makeTheme; }).sort(), ['ath', 'circuit', 'mc', 'py'], 'X-3 near の 4 本は作るの題材（既存 3 + §AF の ath）');
topics.forEach(function (t) {
  ['title', 'firstStep', 'need', 'reason'].forEach(function (k) {
    ok(Array.isArray(t[k]) && t[k].length === 2 && t[k][0] && t[k][1], 'X-3 ' + t.id + ' の ' + k + ' は [中, 小]');
  });
  ok(TDD.FITS.indexOf(t.fit) >= 0, 'X-3 ' + t.id + ' の fit');
  ok(typeof t.safety === 'boolean', 'X-3 ' + t.id + ' の safety は boolean');
  ok(t.watch && Array.isArray(t.watch.src) && t.watch.points.length === 3 && t.watch.points.every(function (p) { return /^\d:\d\d$/.test(p.t) && p.text[0] && p.text[1]; }), 'X-3 ' + t.id + ' の見どころ 3 つ（「0:20 …」形式）');
  ok(t.find && t.find.hints.length === 3 && t.find.photos.length >= 1, 'X-3 ' + t.id + ' の手がかり 3 つ・ダミー写真');
  ok(t.play && t.play.sliders.length >= 1 && t.play.sliders.length <= 2 && typeof t.play.result === 'function', 'X-3 ' + t.id + ' のスライダー 1〜2 本 + 結果の関数');
  if (t.makeTheme) {
    // 題材（§AE の stop / ath / story を含む）は作るに必ずある（統合後。レビューへの裁定で必須に戻した）
    ok(MD.THEMES.indexOf(t.makeTheme) >= 0, 'AF-3 ' + t.id + ' の題材 ' + t.makeTheme + ' は MD.THEMES にある');
    ok(MD.THEMES.indexOf(t.makeTheme) >= 0 && MD.theme(t.makeTheme).variants.indexOf(t.makeVariant) >= 0, 'X-3 ' + t.id + ' の題材と案は作るにある');
  } else {
    ok(t.makeTheme === null && t.makeSteps.length >= 3 && t.makeSteps.length <= 4 && t.makeSteps.every(function (s) { return s[0] && s[1]; }), 'X-3 ' + t.id + ' は makeSteps 3〜4 個（[中, 小]）');
  }
  ok(/^<svg class="mk-art/.test(TDD.cardArt(t)), 'X-3 ' + t.id + ' の絵は線画 SVG');
  t.find.photos.forEach(function (p) { ok(/<svg[\s\S]*M8 22 V8 H22[\s\S]*<\/svg>$/.test(TDD.photoArt(t, p.id)), 'X-3 ' + t.id + ' のダミー写真 ' + p.id + ' は写真の印つき'); });
});
// 文言の禁止（§I の評価語 + 「成長」「頑張」「すごい」+「版」）・人名を足さない・実在の団体名を使わない
var allText = JSON.stringify(topics, function (k, v) { return typeof v === 'function' ? undefined : v; });
topics.forEach(function (t) { t.play.sliders.forEach(function () {}); allText += JSON.stringify(t.play.result(TDD.defaults(t))); });
ok(!/点数|ランキング|順位|評価|成績|レベル|集中力|得意|苦手|上手|成長|頑張|すごい|版|データがありません|学びのバディ/.test(allText), 'X-6 お題に評価の語・「版」が無い');
ok(!/さん|くん|ちゃん|はると|田中/.test(allText), 'X-3 人の名前を足さない');
ok(!/株式会社|協会|財団|NHK|ＮＨＫ|市立|区立|県立/.test(allText), 'X-3 実在の団体名を使わない（架空）');
ok(!/好きに近い|少し隣|意外/.test(allText), 'X-1 区分名を文言に出さない');

// ---------- TD.initial ----------
var s0 = TD.initial();
eq(s0.slots.length, 3, 'initial スロット 3');
eq(s0.slots.map(function (id) { return TDD.get(id).fit; }), ['near', 'next', 'new'], 'initial fit が 1 枚ずつ');
ok(s0.slots.indexOf(SEED) >= 0 && s0.slots.indexOf(SIGN) >= 0, 'initial 最初の 3 枚に v1.0 の例 2 本');
eq([s0.kept, s0.tried, s0.rot], [[], {}, { near: 0, next: 0, new: 0 }], 'initial 空の とっておく・記録・回転');
ok(TD.initial() !== s0 && freeze(TD.initial()) === freeze(s0), 'initial 毎回新しい値（決定論）');

// ---------- TD.swap ----------
var before = freeze(s0), s1 = TD.swap(s0, 1);
eq(freeze(s0), before, 'swap 元を変えない');
eq(TDD.get(s1.slots[1]).fit, 'next', 'swap 同じ fit の次へ');
ok(s1.slots[1] !== s0.slots[1], 'swap そのカードが変わる');
eq([s1.slots[0], s1.slots[2]], [s0.slots[0], s0.slots[2]], 'swap 他のカードは変わらない');
eq(s1.rot.next, 1, 'swap 回転の位置');
var seen = [s0.slots[0]], st = s0;
for (var k = 0; k < TDD.pool('near').length; k++) { st = TD.swap(st, 0); seen.push(st.slots[0]); }
eq(seen, TDD.pool('near').concat([TDD.pool('near')[0]]), 'swap 見送ったお題は後ろに回り、一巡で最初に戻る');
eq(st.rot.near, 0, 'swap 一巡で回転の位置も 0');
var all3 = TD.swap(TD.swap(TD.swap(s0, 2), 2), 1);
eq(all3.slots.filter(function (id, i) { return all3.slots.indexOf(id) !== i; }), [], 'swap スロット同士で重ならない');
eq(TD.swap(s0, 3), s0, 'swap 無いスロットは同じ state（境界）');
eq(TD.swap(s0, -1), s0, 'swap 負のスロットは同じ state（境界）');
// 他のスロットと重複しない（壊れた state でも重ならない方へ飛ばす）
var dup = JSON.parse(freeze(s0));
dup.slots[0] = TDD.pool('near')[1];
var sd = TD.swap(dup, 0);
ok(sd.slots[0] !== dup.slots[0] && TDD.get(sd.slots[0]).fit === 'near', 'swap 壊れた位置からでも同じ fit で進む');

// ---------- TD.keep / unkeep ----------
var kk = TD.keep(s0, SEED);
eq(kk.kept, [SEED], 'keep とっておく');
eq(s0.kept, [], 'keep 元を変えない');
eq(TD.keep(kk, SEED), kk, 'keep 2 回目は同じ state');
eq(TD.keep(kk, 'od-none'), kk, 'keep 無い id は同じ state');
var k2 = TD.keep(kk, SIGN);
eq(k2.kept, [SIGN, SEED], 'keep 新しいものが先頭');
var u1 = TD.unkeep(k2, SEED);
eq(u1.state.kept, [SIGN], 'unkeep 外す');
eq(u1.undo, { id: SEED, index: 1 }, 'unkeep 元に戻す情報（位置）');
eq(TD.keep(u1.state, u1.undo.id, u1.undo.index).kept, [SIGN, SEED], 'unkeep → keep(位置) で元の位置に戻る');
eq(TD.unkeep(s0, SEED), null, 'unkeep とっておいていないものは null');
eq(TD.isKept(k2, SEED), true, 'isKept');

// ---------- TD.markEntry / isStarted ----------
eq(TD.isStarted(s0, SEED), false, 'isStarted 何も開いていない');
var m1 = TD.markEntry(s0, SEED, 'watch');
eq(m1.tried[SEED].entries, { watch: true, find: false, play: false, make: false }, 'markEntry 開いた入口を記録');
eq(TD.isStarted(m1, SEED), true, 'isStarted 1 つ開いたら始めた');
eq(TD.markEntry(m1, SEED, 'watch'), m1, 'markEntry 2 回目は同じ state（回数は持たない）');
eq(TD.markEntry(s0, SEED, 'nope'), s0, 'markEntry 無い入口は同じ state');
eq(TD.markEntry(s0, 'od-none', 'watch'), s0, 'markEntry 無いお題は同じ state');
eq(freeze(s0.tried), '{}', 'markEntry 元を変えない');

// ---------- TD.addFound / toggleHint ----------
var f1 = TD.addFound(s0, SEED, { photo: 'p2', line: '  公園のカエデ  ', time: '11/2 10:20' });
eq(f1.tried[SEED].found, [{ photo: 'p2', line: '公園のカエデ', time: '11/2 10:20' }], 'addFound 写真と 1 行（前後の空白は取る）');
eq(f1.tried[SEED].entries.find, true, 'addFound 実物を探すを開いた記録');
var f2 = TD.addFound(f1, SEED, { photo: 'p1', line: '   ', time: '11/2 10:20' });
eq(f2.tried[SEED].found[1].line, null, 'addFound 1 行は任意（空なら null）');
eq(f2.tried[SEED].found.length, 2, 'addFound 足すだけ（消さない）');
eq(TD.addFound(s0, SEED, { photo: 'zz', line: 'x', time: '' }), s0, 'addFound そのお題の写真でなければ同じ state');
eq(TD.addFound(s0, 'od-none', { photo: 'p1' }), s0, 'addFound 無いお題は同じ state');
ok(!('works' in f2) && Object.keys(f2).sort().join() === 'circle,drot,dslots,kept,rot,slots,think,tried', 'addFound 作品には入れない（お題の記録だけ）');
eq(TD.addFound(s0, SEED, { photo: 'p1', line: new Array(200).join('あ'), time: '' }).tried[SEED].found[0].line.length, 120, 'addFound 1 行は 120 字まで');
var h1 = TD.toggleHint(s0, SEED, 2);
eq(h1.tried[SEED].checks, [2], 'toggleHint 付ける');
eq(TD.toggleHint(TD.toggleHint(h1, SEED, 0), SEED, 2).tried[SEED].checks, [0], 'toggleHint 外す');
eq(TD.toggleHint(s0, SEED, 3), s0, 'toggleHint 範囲外は同じ state');

// ---------- TD.play（決定論） ----------
topics.forEach(function (t) {
  var d = TD.play(t, null);
  eq(d.values, TDD.defaults(t), 'play ' + t.id + ' 値なしは既定値');
  eq(freeze(TD.play(t, d.values)), freeze(d), 'play ' + t.id + ' 同じ値なら同じ結果');
  ok(Array.isArray(d.result) && d.result[0] && d.result[1], 'play ' + t.id + ' 結果 1 行は [中, 小]');
  t.play.sliders.forEach(function (s) {
    var lo = {}, hi = {};
    lo[s.key] = s.min - 5; hi[s.key] = s.max + 5;
    eq(TD.play(t, lo).values[s.key], s.min, 'play ' + t.id + ' ' + s.key + ' 下限で止める');
    eq(TD.play(t, hi).values[s.key], s.max, 'play ' + t.id + ' ' + s.key + ' 上限で止める');
    // 隣り合う値で線画と結果が必ず変わる（スライダーで線画が変わる。§U-12 と同じ機械検査）
    var same = [];
    for (var x = s.min; x < s.max; x++) {
      var a = TDD.defaults(t), b = TDD.defaults(t);
      a[s.key] = x; b[s.key] = x + 1;
      var pa = TD.play(t, a), pb = TD.play(t, b);
      if (pa.art === pb.art || freeze(pa.result) === freeze(pb.result)) same.push(x);
    }
    eq(same, [], 'play ' + t.id + ' ' + s.key + ' 隣り合う値で線画と結果が変わる');
  });
});
eq(TD.play(null, {}), null, 'play お題なしは null');
eq(TD.play(TDD.get(SEED), { wing: 'x' }).values.wing, TDD.defaults(TDD.get(SEED)).wing, 'play 数でない値は既定値');

// ---------- TD.normalize（§X-4: 形が違えばそのキーだけ初期値） ----------
eq(freeze(TD.normalize(null)), freeze(s0), 'normalize null → 初期値');
eq(freeze(TD.normalize('x')), freeze(s0), 'normalize 文字列 → 初期値');
eq(freeze(TD.normalize([])), freeze(s0), 'normalize 配列 → 初期値');
var good = TD.addFound(TD.toggleHint(TD.markEntry(TD.keep(TD.swap(s0, 2), SEED), SEED, 'play'), SEED, 1), SEED, { photo: 'p3', line: 'x', time: 't' });
eq(freeze(TD.normalize(JSON.parse(freeze(good)))), freeze(good), 'normalize 正しい値はそのまま');
var bad1 = JSON.parse(freeze(good)); bad1.slots = ['od-seed', 'od-seed', 'od-seed'];
eq(TD.normalize(bad1).slots, s0.slots, 'normalize slots が壊れたら slots だけ初期値（rot から作り直さない）');
eq(TD.normalize(bad1).rot, good.rot, 'normalize slots が壊れても rot はそのまま');
var bad1b = JSON.parse(freeze(good)); bad1b.slots = 'broken'; bad1b.rot = { near: 1, next: 0, new: 0 };
eq([TD.normalize(bad1b).slots[0], TD.normalize(bad1b).rot.near], ['od-py-leaves', 1], 'normalize 壊れた slots は初期値の先頭（rot が正しくても使わない）');
eq(TD.normalize(bad1).kept, good.kept, 'normalize slots が壊れても他のキーは残す');
var bad2 = JSON.parse(freeze(good)); bad2.slots = 'x'; bad2.rot = { near: -1 };
eq([TD.normalize(bad2).slots, TD.normalize(bad2).rot], [s0.slots, s0.rot], 'normalize slots も rot も壊れたら両方初期値');
var bad2b = JSON.parse(freeze(good)); bad2b.rot = 'x';
eq([TD.normalize(bad2b).slots, TD.normalize(bad2b).rot], [good.slots, s0.rot], 'normalize rot だけ壊れたら rot だけ初期値');
var bad2c = JSON.parse(freeze(good)); bad2c.kept = 'x';
eq([TD.normalize(bad2c).kept, TD.normalize(bad2c).slots], [[], good.slots], 'normalize kept が壊れたら kept だけ初期値');
var bad3 = JSON.parse(freeze(good)); bad3.kept = ['od-none', SEED, SEED, 3];
eq(TD.normalize(bad3).kept, [SEED], 'normalize kept は知っているお題だけ・重複なし');
var bad4 = JSON.parse(freeze(good)); bad4.tried = { 'od-none': {}, 'od-seed': { entries: { watch: 'yes', play: true }, found: [{ photo: 'zz', time: 't' }, { photo: 'p1', line: 3, time: 't' }, { photo: 'p2', line: null, time: 't' }], checks: [9, 1, 1, 0] } };
eq(TD.normalize(bad4).tried, { 'od-seed': { entries: { watch: false, find: false, play: true, make: false }, found: [{ photo: 'p2', line: null, time: 't' }], checks: [0, 1] } }, 'normalize tried は形の合うものだけ');
var bad5 = JSON.parse(freeze(good)); bad5.tried = 'x';
eq(TD.normalize(bad5).tried, {}, 'normalize tried が壊れたらそのキーだけ初期値');
eq(TD.normalize(bad5).slots, good.slots, 'normalize tried が壊れても slots は残す');

// ---------- M.fromOdai（§X-2 / X-8） ----------
var seed = TDD.get(SEED), py = TDD.get('od-py-leaves'), roof = TDD.get('od-mc-roof');
var r1 = M.fromOdai(seed, { id: 'a-od1', mode: 'js', now: '10:20', acts: [], recText: '記録の 1 行' });
ok(r1 && r1.created && r1.id === 'a-od1' && r1.act.id === 'a-od1', 'fromOdai 新しい活動を作る');
eq([r1.act.origin, r1.act.odaiId, r1.act.title], ['today', SEED, seed.title[0]], 'fromOdai origin today・odaiId・問いがタイトル');
eq([r1.act.stepsKind, r1.act.steps, r1.act.stepIdx], ['ext', seed.makeSteps, 0], 'fromOdai 3 題材に無いお題は ext 活動・手順は makeSteps');
// 修正前に theme 'mc' で保存されたお題の ext 活動は、読み込み（migrate）で題材 'odai' に直る（Astra 再レビュー）
(function () {
  var old = JSON.parse(JSON.stringify(r1.act)); old.theme = 'mc'; old.v = 3;
  old.ext = old.ext || { link: null, photos: [], visible: [] };
  old.ext.photos.push({ id: 'ph-old', theme: 'mc', n: 0, kind: 'photo', time: '10:30' });
  var m = M.migrate(old);
  eq([m.theme, M.isOdaiExt(m), m.ext.photos.map(function (p) { return p.theme; })], ['odai', true, ['odai']], 'migrate 旧 theme mc のお題活動 → odai（写真も）');
  eq(M.remakeOptions ? M.remakeOptions(m) : ['osteps', 'oneed'], ['osteps', 'oneed'], 'migrate 後の任せる候補はお題のもの');
  var plain = JSON.parse(JSON.stringify(old)); delete plain.odaiId;
  eq(M.migrate(plain).theme, 'mc', 'migrate odaiId の無い外で作る活動は題材を変えない');
})();
eq([r1.act.theme, M.isOdaiExt(r1.act)], ['odai', true], 'fromOdai 3 題材に無いお題の題材は odai（マイクラにしない）');
ok(r1.act.ext && r1.act.ext.photos.length === 0 && r1.act.stage === null, 'fromOdai ext 活動は外の記録（写真 0 枚から）');
eq(M.stepNow(r1.act), seed.makeSteps[0], 'fromOdai 今の一歩 = makeSteps の 1 つ目');
eq([r1.act.thread.length, r1.act.thread[0].who, r1.act.thread[0].text], [1, 'record', '記録の 1 行'], 'fromOdai 記録の 1 行（作った時点の文字列）');
eq(r1.act.thread[0].v, { q: seed.title, step: seed.firstStep, need: seed.need }, 'fromOdai 記録に 問い・最初の一歩・必要な物');
eq(r1.act.v, 3, 'fromOdai 今の schema 版で作る（移行しない）');
var r2 = M.fromOdai(py, { id: 'a-od2', mode: 'es', now: '10:20', acts: [] });
eq([r2.act.stepsKind, r2.act.theme, r2.act.stage.theme, r2.act.stage.variant, r2.act.stage.kind], ['theme', 'py', 'py', 'catch', 'sample'], 'fromOdai 3 題材のお題は theme 活動（見本の作業対象から）');
eq(r2.act.title, py.title[1], 'fromOdai 小学生表示ならタイトルも小学生の文');
eq(r2.act.thread.map(function (m) { return m.who + ':' + (m.r || m.k); }), ['record:odai_rec', 'buddy:open'], 'fromOdai theme 活動は記録 + 見本を開いた時の返事');
eq(M.fromOdai(roof, { id: 'a-od3', acts: [] }).act.stage.variant, 'roof', 'fromOdai お題の案（makeVariant）で始める');
var acts = [r1.act], frozen = freeze(acts);
var r3 = M.fromOdai(seed, { id: 'a-new', acts: acts });
ok(r3 && !r3.created && !r3.changed && r3.id === 'a-od1' && r3.act === r1.act, 'fromOdai 同じお題の活動があれば作らずその id');
eq(freeze(acts), frozen, 'fromOdai 既存の一覧を変えない');
var r4 = M.fromOdai(seed, { id: 'a-od4', mode: 'js', acts: [], question: '  葉っぱでも回る？ ' });
eq([r4.act.title, r4.act.thread.map(function (m) { return m.who; }), r4.act.thread[1].text], ['葉っぱでも回る？', ['record', 'child'], '葉っぱでも回る？'], 'fromOdai 自分の案にした問い = タイトル + 本人の言葉');
eq(r4.act.odaiId, SEED, 'fromOdai 自分の案でも odaiId を持つ');
var r5 = M.fromOdai(seed, { id: 'a-x', acts: acts, question: 'もっと大きな羽で' });
ok(r5.id === 'a-od1' && !r5.created && r5.changed && r5.act.title === 'もっと大きな羽で' && r5.act !== r1.act, 'fromOdai 既存の活動でも問いを書き換えたら反映（同じ id）');
eq(r5.act.thread[r5.act.thread.length - 1], { who: 'child', text: 'もっと大きな羽で', id: 'a-od1-m' + r5.act.seq, time: r5.act.thread[r5.act.thread.length - 1].time }, 'fromOdai 書き換えた問いは本人の言葉として残る');
eq(freeze(acts), frozen, 'fromOdai 書き換えても元の活動は変えない');
// 書き換えた問いを元のお題の問いに戻す（指摘 2）: タイトルは元の問いへ・本人の言葉は足さない
var r5b = M.fromOdai(seed, { id: 'a-x', acts: [r5.act], question: seed.title[0] });
ok(r5b.id === 'a-od1' && r5b.changed && r5b.act.title === seed.title[0] && r5b.act.thread.length === r5.act.thread.length, 'fromOdai 元の問いに戻したらタイトルも戻る（本人の言葉は足さない）');
var r5c = M.fromOdai(seed, { id: 'a-x', acts: [r5b.act], question: seed.title[0] });
ok(!r5c.changed && r5c.act === r5b.act, 'fromOdai 今のタイトルと同じ問いなら何もしない');
var r6 = M.fromOdai(seed, { id: 'a-od6', acts: [], question: seed.title[0] });
eq([r6.act.title, r6.act.thread.length], [seed.title[0], 1], 'fromOdai 問いが元のままなら自分の案として扱わない');
eq(M.fromOdai(null, {}), null, 'fromOdai お題なしは null');
var other = M.fromSample('mc', { id: 'a-s', now: '10:20', mode: 'js' });
ok(M.fromOdai(seed, { id: 'a-od7', acts: [other] }).created, 'fromOdai お題から作っていない活動は使わない');
ok(M.migrate(r1.act, function () { return ''; }) === r1.act && M.migrate(r2.act, function () { return ''; }) === r2.act, 'fromOdai の活動は読み込み時の移行で変わらない');

// ---------- お題の作業台に 3 題材の中身を出さない（指摘 1）: 写真・任せる候補・作り直し・頼みごと・どこが違う ----------
var MC = /マイクラ|minecraft|屋根|ブロック|コマンド|寸法|塔|星|電球|Python/i;
var ex = r1.act, seedOd = TDD.get(SEED);
eq(M.leaveOptions(ex), ['osteps', 'oneed'], '指摘 1 任せる候補は 手順を整理して / 必要な物をまとめて（お題から）');
eq([global.DES.make.OPT_KEY.osteps, global.DES.make.OPT_KEY.oneed], [['leave_opts_odai', 0], ['leave_opts_odai', 1]], '指摘 1 候補の文言 key');
eq(M.requestOpt(ex), 'osteps', '指摘 1 言葉で頼む → 手順');
var lv = M.leave(ex, 'osteps');
eq(lv.ids.length, 1, '指摘 1 手順を整理して → メモ 1 枚');
var c1 = lv.act.shelf[0];
eq([c1.kind, c1.theme, c1.opt, c1.state], ['note', 'odai', 'osteps', 'making'], '指摘 1 メモはお題の題材');
eq(c1.lines, seedOd.makeSteps.map(function (s, i) { return [(i + 1) + '. ' + s[0], (i + 1) + '. ' + s[1]]; }), '指摘 1 手順のメモ = お題の makeSteps');
var settled = M.settle(lv.act, lv.ids), ad = M.adopt(settled, c1.id);
eq([ad.act.stage.kind, ad.act.theme, ad.change.who], ['note', 'odai', 'ai'], '指摘 1 これにする → 作業対象はメモ・題材は odai のまま');
var rm = M.remake(ad.act, c1.id, 'osteps');
eq([rm.act.shelf[0].alt, rm.act.shelf[0].lines[0]], [true, ['1. ' + seedOd.firstStep[0], '1. ' + seedOd.firstStep[1]]], '指摘 1 同じ種類で作り直す → もう一方の形（最初の一歩から）');
eq(M.remakeOptions(ex, c1), ['osteps', 'oneed'], '指摘 1 作り直しの候補もお題から');
var nd = M.leave(ex, 'oneed').act.shelf[0];
ok(nd.lines[0][0] === '用意する物: 紙・はさみ・クリップ' && nd.lines[1][0] === '場所: 少し高い場所' && nd.lines.length === 3, '指摘 1 必要な物のメモ = お題の必要な物・場所（safety なら確認の 1 行）');
eq(M.leave(ex, 'aspect', { aspect: 2 }).act.shelf[0].opt, 'oneed', '指摘 1 どこが違う？ 材料・色 → 必要な物');
eq(M.leave(ex, 'aspect', { aspect: 0 }).act.shelf[0].opt, 'osteps', '指摘 1 どこが違う？ 形 → 手順');
['calc', 'cmd', 'redo', 'one', 'fix', 'two', 'find'].forEach(function (o) { eq(M.leave(ex, o).ids, [], '指摘 1 3 題材の候補 ' + o + ' はお題の活動では作らない'); });
var p1 = M.addPhoto(ex, 'photo'), p2 = M.addPhoto(p1.act, 'shot'), p3 = M.addPhoto(p2.act, 'photo'), p4 = M.addPhoto(p3.act, 'photo');
eq([p1.photo.theme, p1.photo.odai, p1.photo.n, p2.photo.n, p3.photo.n, p4.photo.n], ['odai', SEED, 0, 1, 2, 0], '指摘 1 写真の題材は odai・お題の 3 枚を順に');
eq(MD.photoArt(p1.photo), TDD.photoArt(seedOd, 'p1'), '指摘 1 写真のダミー = お題の線画（探す写真と同じ）');
eq(MD.photoArt(p2.photo), TDD.photoArt(seedOd, 'p2'), '指摘 1 2 枚目は 2 つ目の線画');
ok(MD.photoArt({ theme: 'odai', odai: 'od-none' }) === TDDframe() && !/<rect/.test(TDDframe()), '指摘 1 知らないお題の写真は枠だけ（3 題材の絵を出さない）');
function TDDframe() { return TDD.frameOnly(); }
var all = [lv, ad, rm, M.leave(ex, 'oneed'), M.leave(M.leave(ex, 'oneed').act, 'oneed', { card: nd.id }), p4].map(function (r) { return r.act; });
eq(all.filter(function (x) { return MC.test(JSON.stringify(x)); }).length, 0, '指摘 1 お題の活動に 3 題材の語（マイクラ・屋根・コマンド等）が出ない');
topics.filter(function (t) { return !t.makeTheme; }).forEach(function (t) {
  var a = M.fromOdai(t, { id: 'a-' + t.id, acts: [] }).act, x = M.addPhoto(M.leave(M.leave(a, 'osteps').act, 'oneed').act, 'photo').act;
  ok(!MC.test(JSON.stringify(x).replace(new RegExp(JSON.stringify(t.title[0]).slice(1, -1) + '|' + JSON.stringify(t.title[1]).slice(1, -1), 'g'), '').replace(/"reason"[^\]]*\]/g, '')) || /マイクラ|ブロック/.test(t.title[0]), '指摘 1 ' + t.id + ' の作業台の中身に 3 題材の語が出ない');
  ok(/td-art/.test(MD.photoArt(x.ext.photos[0])) && !/mk-art is-photo/.test(MD.photoArt(x.ext.photos[0])), '指摘 1 ' + t.id + ' の写真はお題の線画');
});
var plain = M.fromExt('photo', { id: 'a-ext', now: '10:20', mode: 'js' });
eq([M.leaveOptions(plain), plain.ext.photos[0].theme], [['calc', 'steps', 'cmd'], 'mc'], '指摘 1 既存の外で作る活動（作るの入口から）は今までどおり');
eq(M.leaveOptions(M.fromOdai(TDD.get('od-py-leaves'), { id: 'a-pyl', acts: [] }).act), ['find', 'one'], '指摘 1 3 題材のお題は作るの候補のまま（見本）');

// ---------- 線画は 1 枚 2 色（指摘 4）: 墨 + 橙 か 墨 + オリーブ。none / 白は数えない。全お題 × 全スライダーの組 + ダミー写真 ----------
var INKc = TDD.COLORS.ink, ACC = [TDD.COLORS.orange, TDD.COLORS.olive];
function colorsOf(svg) {
  var set = {};
  svg.replace(/(?:stroke|fill)="([^"]+)"/g, function (all, c) { c = c.toLowerCase(); if (c !== 'none' && c !== '#fff' && c !== '#ffffff' && c !== 'white') set[c] = true; return all; });
  return Object.keys(set).sort();
}
function twoColor(svg) { var c = colorsOf(svg); return c.length <= 2 && c.indexOf(INKc) >= 0 && c.filter(function (x) { return x !== INKc; }).every(function (x) { return ACC.indexOf(x) >= 0; }) && c.length >= 1; }
var badColor = [];
topics.forEach(function (t) {
  var s1 = t.play.sliders[0], s2 = t.play.sliders[1] || { key: '_', min: 0, max: 0 }, accent = {};
  for (var x1 = s1.min; x1 <= s1.max; x1++) for (var x2 = s2.min; x2 <= s2.max; x2++) {
    var v = TDD.defaults(t); v[s1.key] = x1; if (t.play.sliders[1]) v[s2.key] = x2;
    var svg = TDD.drawArt(t.art, v);
    if (!twoColor(svg)) badColor.push(t.id + ' ' + JSON.stringify(v) + ' ' + colorsOf(svg).join(','));
    colorsOf(svg).forEach(function (c) { if (c !== INKc) accent[c] = true; });
  }
  t.find.photos.forEach(function (p) { var svg = TDD.photoArt(t, p.id); if (!twoColor(svg)) badColor.push(t.id + ' photo ' + p.id + ' ' + colorsOf(svg).join(',')); colorsOf(svg).forEach(function (c) { if (c !== INKc) accent[c] = true; }); });
  ok(Object.keys(accent).length === 1, '指摘 4 ' + t.id + ' の線画は 1 つのお題の中で同じ 2 色（' + Object.keys(accent).join(',') + '）');
});
eq(badColor.slice(0, 5), [], '指摘 4 全お題 × 全スライダーの組・ダミー写真が 2 色');
ok(twoColor(TDD.frameOnly()), '指摘 4 枠だけの写真も墨だけ');

// ---------- 残した写真を消す / 元に戻す（指摘 7） ----------
var fx = TD.addFound(TD.addFound(TD.addFound(s0, SEED, { photo: 'p1', line: 'a', time: 't' }), SEED, { photo: 'p2', line: 'b', time: 't' }), SEED, { photo: 'p3', line: 'c', time: 't' });
var rf = TD.removeFound(fx, SEED, 1);
eq(rf.state.tried[SEED].found.map(function (f) { return f.line; }), ['a', 'c'], 'removeFound 消す');
eq(fx.tried[SEED].found.length, 3, 'removeFound 元を変えない');
eq(rf.undo, { id: SEED, index: 1, item: { photo: 'p2', line: 'b', time: 't' } }, 'removeFound 元に戻す情報（位置と中身）');
eq(TD.restoreFound(rf.state, rf.undo).tried[SEED].found.map(function (f) { return f.line; }), ['a', 'b', 'c'], 'restoreFound 元の位置に戻る');
eq(TD.removeFound(fx, SEED, 3), null, 'removeFound 範囲外は null');
eq(TD.removeFound(s0, SEED, 0), null, 'removeFound 記録が無いお題は null');
eq(TD.restoreFound(s0, { id: SEED, index: 0, item: { photo: 'zz', time: 't' } }), s0, 'restoreFound 知らない写真は同じ state');
eq(TD.restoreFound(rf.state, { id: SEED, index: 9, item: { photo: 'p2', line: 'b', time: 't' } }).tried[SEED].found.map(function (f) { return f.line; }), ['a', 'c', 'b'], 'restoreFound 位置が範囲外なら末尾');

// ======================================================================
// §AF 今日のお題の種類（対話のお題 9 本・作る・ためすの 3 本・純関数）
// ======================================================================
var DL = TDD.dialogs, PAIR = function (p) { return Array.isArray(p) && p.length === 2 && typeof p[0] === 'string' && typeof p[1] === 'string' && !!p[0] && !!p[1]; };
eq(DL.length, 9, 'AF-1 対話のお題 9 本');
eq(TDD.KINDS, ['news', 'talk', 'philo'], 'AF-1 種類');
TDD.KINDS.forEach(function (k) { eq(TDD.kindPool(k).length, 3, 'AF-1 ' + k + ' は 3 本'); });
var dids = DL.map(function (d) { return d.id; });
eq(dids.filter(function (id, i) { return dids.indexOf(id) !== i || TDD.get(id); }), [], 'AF-3 対話のお題の id は重ならない（作る・ためすとも）');
eq(DL.filter(function (d) { return d.heavy; }).map(function (d) { return d.id; }), ['od-news-election'], 'AF-6 heavy は od-news-election だけ');
DL.forEach(function (d) {
  var nm = 'AF-3 ' + d.id;
  ok(TDD.KINDS.indexOf(d.kind) >= 0 && typeof d.heavy === 'boolean' && d.source === 'buddy', nm + ' の kind / heavy / source');
  ok(d.kind === 'news' ? PAIR(d.date) : d.date === null, nm + ' の date（news だけ [中, 小]）');
  ['title', 'lead', 'reason'].forEach(function (k) { ok(PAIR(d[k]), nm + ' の ' + k + ' は [中, 小]'); });
  ok(d.facts.length >= 1 && d.facts.length <= 3 && d.facts.every(function (f) { return PAIR(f.text); }), nm + ' の前提（1〜3・[中, 小]）');
  var vr = d.kind === 'news' ? [0, 3] : [2, 3];
  ok(d.views.length >= vr[0] && d.views.length <= vr[1] && d.views.every(function (v) { return PAIR(v.who) && PAIR(v.stance); }), nm + ' の考え（' + vr.join('〜') + '）');
  eq(d.asks.map(function (a) { return a.level; }), ['check', 'self', 'open'], nm + ' の問いはちょうど 3 つで段が 3 種');
  ok(d.asks.every(function (a) { return PAIR(a.text) && a.text[0] !== a.text[1]; }), nm + ' の問いは中と小が別の文');
  ok(d.stances.length >= 2 && d.stances.length <= 4 && d.stances.every(function (s) { return typeof s.id === 'string' && s.id !== 'none' && PAIR(s.label); }), nm + ' の立場（2〜4）');
  ok(d.sources.every(function (s) { return typeof s.id === 'string' && s.name && /^https:\/\//.test(s.url) && s.checked === '2026-11-06'; }), nm + ' の出典（https・確かめた日）');
  var sids = d.sources.map(function (s) { return s.id; }), refs = [];
  d.facts.concat(d.views).forEach(function (x) { refs = refs.concat(TDD.srcIds(x.src)); });
  eq(refs.filter(function (r) { return sids.indexOf(r) < 0; }), [], nm + ' の src は sources の id を指す');
  if (d.kind === 'philo') eq(d.views.filter(function (v) { return !TDD.srcIds(v.src).length; }).length, 0, nm + ' の答えのない問いの考えは出典つき');
  ok(PAIR(d.next.talk) && PAIR(d.next.makeTitle) && d.next.makeSteps.length >= 3 && d.next.makeSteps.length <= 4 && d.next.makeSteps.every(PAIR), nm + ' の次の一歩（話す・作る題・手順 3〜4）');
  ok(twoColor(TDD.cardArt(d)) && /^<svg class="mk-art/.test(TDD.cardArt(d)), nm + ' の絵は 2 色の線画');
});
ok(TDD.cardArt(DL[0]) !== TDD.cardArt(DL[1]), 'AF-2 絵はお題ごとに 1 つ');
// 文言の禁止: 評価語 + 「版」
var dText = JSON.stringify(DL);
ok(!/点数|ランキング|順位|評価|成績|レベル|集中力|得意|苦手|上手|成長|頑張|すごい|版|データがありません|学びのバディ/.test(dText), 'AF 対話のお題に評価の語・「版」が無い');
// 作る・ためすの 3 本: 作るに題材が無い間（§AE の着地前）も結果 1 行が決定論で出て、NaN / undefined を含まない
['od-ath-winter', 'od-stop-leaf', 'od-story-snow'].forEach(function (id) {
  var t = TDD.get(id), s1 = t.play.sliders[0], s2 = t.play.sliders[1], bad = [];
  for (var a = s1.min; a <= s1.max; a++) for (var b = s2.min; b <= s2.max; b++) {
    var v = {}; v[s1.key] = a; v[s2.key] = b;
    var r = TD.play(t, v).result;
    if (/NaN|undefined|null/.test(r.join('|'))) bad.push(JSON.stringify(v));
  }
  eq(bad, [], 'AF-3 ' + id + ' の結果 1 行に NaN / undefined が出ない');
});
eq(TD.play(TDD.get('od-stop-leaf'), { frames: 2, fps: 2 }).result[0].indexOf('12 コマ ÷ 1 秒に 8 コマ = 1.5 秒') >= 0, true, 'AF-3 コマ撮りの結果 = §AE の計算（12 ÷ 8 = 1.5 秒）');

// ---------- §AF-6 純関数 ----------
var d0 = TD.initial();
eq(d0.dslots, { news: 'od-news-mmx', talk: 'od-talk-rule', philo: 'od-philo-ai' }, 'AF-6 initial dslots は種類ごとに 1 本');
eq([d0.drot, d0.think, d0.circle], [{ news: 0, talk: 0, philo: 0 }, {}, []], 'AF-6 initial drot / think / circle');
eq(d0.slots, s0.slots, 'AF-6 initial 作る・ためすの 3 枚は既存どおり');
// swapKind
var w1 = TD.swapKind(d0, 'news');
eq([w1.dslots.news, w1.drot.news, w1.dslots.talk, w1.dslots.philo], ['od-news-bosai', 1, d0.dslots.talk, d0.dslots.philo], 'AF-6 swapKind 同じ種類の次へ・他の種類は変えない');
eq(w1.slots, d0.slots, 'AF-6 swapKind 作る・ためすは変えない');
eq(d0.dslots.news, 'od-news-mmx', 'AF-6 swapKind 元を変えない');
var w3 = TD.swapKind(TD.swapKind(w1, 'news'), 'news');
eq([w3.dslots.news, w3.drot.news], ['od-news-mmx', 0], 'AF-6 swapKind 一巡で最初に戻る');
eq(TD.swapKind(d0, 'make'), d0, 'AF-6 swapKind 無い種類は同じ state');
var wb = JSON.parse(freeze(d0)); wb.dslots.philo = 'od-none'; wb.drot.philo = 2;
eq(TD.swapKind(wb, 'philo').dslots.philo, 'od-philo-ship', 'AF-6 swapKind 知らないお題が出ていたら回転の位置のお題へ（既存の swap と同じ）');
// keep は種類を問わない
eq(TD.keep(d0, 'od-philo-ship').kept, ['od-philo-ship'], 'AF-2 対話のお題もとっておける');
// markOpen / isOpened
var PH = 'od-philo-ai', mo = TD.markOpen(d0, PH, 'facts');
eq([TD.isOpened(d0, PH), TD.isOpened(mo, PH), mo.think[PH].opened], [false, true, { facts: true, views: false, asks: false, mine: false }], 'AF-6 markOpen 開いた入口を記録');
eq(TD.markOpen(mo, PH, 'facts'), mo, 'AF-6 markOpen 2 回目は同じ state');
eq([TD.markOpen(d0, PH, 'watch'), TD.markOpen(d0, 'od-seed', 'facts')], [d0, d0], 'AF-6 markOpen 無い入口・作るのお題は同じ state');
// pickAsk
var pa = TD.pickAsk(d0, PH, 'self');
eq([pa.think[PH].ask, pa.think[PH].opened.asks], ['self', true], 'AF-6 pickAsk 選んだ問いを記録');
eq(TD.pickAsk(pa, PH, 'open').think[PH].ask, 'open', 'AF-6 pickAsk 選び直せる');
eq([TD.pickAsk(d0, PH, 'x'), TD.pickAsk(d0, 'od-none', 'check')], [d0, d0], 'AF-6 pickAsk 無い段・お題は同じ state');
// putMark: 前のものを残す・新しいものが上・line は 80 字・立場は stances か none
var pm1 = TD.putMark(d0, PH, { stance: 's1', line: '  考える力が大事  ', time: '11/6 10:20' });
eq(pm1.think[PH].marks, [{ id: 'mk1', stance: 's1', line: '考える力が大事', time: '11/6 10:20' }], 'AF-6 putMark 1 件');
var pm2 = TD.putMark(pm1, PH, { stance: 'none', line: '', time: '11/6 10:30' });
eq(pm2.think[PH].marks.map(function (m) { return [m.id, m.stance, m.line]; }), [['mk2', 'none', null], ['mk1', 's1', '考える力が大事']], 'AF-6 putMark 置き直すと前のものも残り、新しいものが上（まだ決めない・1 行は任意）');
eq(pm2.think[PH].opened.mine, true, 'AF-6 putMark 自分の考えを開いた記録');
eq(TD.putMark(d0, PH, { stance: 's1', line: new Array(120).join('あ'), time: 't' }).think[PH].marks[0].line.length, 80, 'AF-6 putMark line は 80 字で切る');
eq([TD.putMark(d0, PH, { stance: 's9', time: 't' }), TD.putMark(d0, PH, { line: 'x', time: 't' }), TD.putMark(d0, 'od-seed', { stance: 's1' })], [d0, d0, d0], 'AF-6 putMark 立場が無い・違う・作るのお題は同じ state');
eq(freeze(pm1.think[PH].marks.length), '1', 'AF-6 putMark 元を変えない');
// removeMark / restoreMark
var rm1 = TD.removeMark(pm2, PH, 'mk1');
eq([rm1.state.think[PH].marks.map(function (m) { return m.id; }), rm1.undo.index, rm1.undo.item.id], [['mk2'], 1, 'mk1'], 'AF-6 removeMark 外す（元に戻す情報）');
eq(TD.restoreMark(rm1.state, rm1.undo).think[PH].marks.map(function (m) { return m.id; }), ['mk2', 'mk1'], 'AF-6 restoreMark 元の位置に戻る');
eq(TD.removeMark(pm2, PH, 'mk9'), null, 'AF-6 removeMark 無い id は null');
var rmA = TD.removeMark(pm2, PH, 'mk2'), afterPut = TD.putMark(rmA.state, PH, { stance: 's2', time: 't' });
// mk2 を外す → 新しく置く（mk2 がまた使われる）→ 元に戻す: 戻した方は新しい id になり、重ならない
var ids3 = TD.restoreMark(afterPut, rmA.undo).think[PH].marks.map(function (m) { return m.id; });
eq([ids3.length, ids3.filter(function (x, i) { return ids3.indexOf(x) !== i; })], [3, []], 'AF-6 restoreMark id が重なったら新しい id（3 件・重ならない）');
// toCircle / fromCircle
var c1 = TD.toCircle(d0, PH, { ask: 'open', time: '11/6 10:40' });
eq(c1.circle, [{ id: PH, ask: 'open', time: '11/6 10:40' }], 'AF-6 toCircle 問いと選んだ問い');
eq(TD.toCircle(c1, PH, { ask: 'open', time: 'x' }), c1, 'AF-6 toCircle 同じなら同じ state');
eq(TD.toCircle(c1, PH, { ask: null, time: 'x' }).circle, [{ id: PH, ask: null, time: '11/6 10:40' }], 'AF-6 toCircle 入っていれば選んだ問いだけ替える');
var c2 = TD.toCircle(c1, 'od-talk-ai', { time: 't' });
eq(c2.circle.map(function (c) { return c.id; }), ['od-talk-ai', PH], 'AF-6 toCircle 新しいものが先頭');
var fc = TD.fromCircle(c2, PH);
eq([fc.state.circle.length, fc.undo.index], [1, 1], 'AF-6 fromCircle 外す');
eq(TD.toCircle(fc.state, fc.undo.item.id, fc.undo.item, fc.undo.index).circle, c2.circle, 'AF-6 fromCircle → toCircle(位置) で元に戻る');
eq([TD.fromCircle(d0, PH), TD.toCircle(d0, 'od-seed', {})], [null, d0], 'AF-6 fromCircle 無い・toCircle 作るのお題は同じ');
eq(TD.inCircle(c1, PH), true, 'AF-6 inCircle');
// normalize（AF-5: 無い時・形が違う時は、その項目だけ初期値）
var old = { slots: s0.slots, kept: [SEED], tried: {}, rot: { near: 0, next: 0, new: 0 } };
var no = TD.normalize(old);
eq([no.kept, no.dslots, no.drot, no.think, no.circle], [[SEED], d0.dslots, d0.drot, {}, []], 'AF-5 前の保存データ（dslots なし）→ 既存はそのまま・足した項目は初期値');
var full = TD.toCircle(TD.putMark(TD.pickAsk(TD.swapKind(TD.keep(d0, PH), 'talk'), PH, 'check'), PH, { stance: 's2', line: 'x', time: 't' }), PH, { ask: 'check', time: 't' });
eq(freeze(TD.normalize(JSON.parse(freeze(full)))), freeze(full), 'AF-5 normalize 正しい値はそのまま');
var nb1 = JSON.parse(freeze(full)); nb1.dslots = { news: 'od-talk-ai', talk: 'od-talk-ai', philo: PH };
eq([TD.normalize(nb1).dslots, TD.normalize(nb1).drot, TD.normalize(nb1).think[PH].ask], [d0.dslots, full.drot, 'check'], 'AF-5 dslots の種類が合わなければ dslots だけ初期値');
var nb2 = JSON.parse(freeze(full)); nb2.drot = { news: -1 };
eq([TD.normalize(nb2).drot, TD.normalize(nb2).dslots], [d0.drot, full.dslots], 'AF-5 drot が壊れたら drot だけ初期値');
var nb3 = JSON.parse(freeze(full)); nb3.think = { 'od-none': {}, 'od-philo-ai': { opened: { facts: 'yes', mine: true }, ask: 'zz', marks: [{ id: 'mk1', stance: 's9', line: 'a', time: 't' }, { id: 'mk2', stance: 's1', line: 3, time: 't' }, { id: 'mk3', stance: 'none', line: null, time: 't' }, { id: 'mk3', stance: 's1', line: 'dup', time: 't' }] } };
eq(TD.normalize(nb3).think, { 'od-philo-ai': { opened: { facts: false, views: false, asks: false, mine: true }, ask: null, marks: [{ id: 'mk3', stance: 'none', line: null, time: 't' }] } }, 'AF-5 think は形の合うものだけ');
var nb4 = JSON.parse(freeze(full)); nb4.think = 'x'; nb4.circle = [{ id: 'od-none', time: 't' }, { id: PH, ask: 'zz', time: 't' }, { id: PH, ask: null, time: 't' }, { id: PH, ask: 'self', time: 't' }, 3];
eq([TD.normalize(nb4).think, TD.normalize(nb4).circle, TD.normalize(nb4).kept], [{}, [{ id: PH, ask: null, time: 't' }], full.kept], 'AF-5 think が壊れたら think だけ初期値・circle は知っているお題だけ（重なりなし）');
var nb5 = JSON.parse(freeze(full)); nb5.circle = 'x'; nb5.kept = [PH, 'od-none', SEED];
eq([TD.normalize(nb5).circle, TD.normalize(nb5).kept], [[], [PH, SEED]], 'AF-5 circle が壊れたら circle だけ初期値・kept は種類を問わず知っているお題');
// 作ってみる（AF-4 の 5）: 外で作る活動（題 = next.makeTitle・手順 = next.makeSteps）。2 回目は同じ活動
var dmk = TDD.makeOdaiOf(TDD.getDialog(PH)), ra = M.fromOdai(dmk, { id: 'a-d1', mode: 'js', now: '10:20', acts: [], recText: 'r' });
eq([ra.act.title, ra.act.stepsKind, ra.act.theme, ra.act.steps, ra.act.odaiId], [TDD.getDialog(PH).next.makeTitle[0], 'ext', 'odai', TDD.getDialog(PH).next.makeSteps, PH], 'AF-4 作ってみる → 外で作る活動（題・手順は次の一歩のもの）');
var rb = M.fromOdai(dmk, { id: 'a-d2', acts: [ra.act] });
ok(!rb.created && rb.id === 'a-d1', 'AF-4 作ってみる 2 回目は同じ活動');
eq(M.fromOdai(TDD.makeOdaiOf(TDD.getDialog('od-talk-rule')), { id: 'a-d3', mode: 'es', acts: [] }).act.title, TDD.getDialog('od-talk-rule').next.makeTitle[1], 'AF-4 作ってみる 小学生表示なら小の題');

// ---------- 画面の文言 key が i18n.js にある（console.warn を出さない） ----------
var i18n = fs.readFileSync(path.join(__dirname, '../app-v3/js/i18n.js'), 'utf8');
var src = fs.readFileSync(path.join(__dirname, '../app-v3/js/today.js'), 'utf8') + fs.readFileSync(path.join(__dirname, '../app-v3/js/make.js'), 'utf8');
var keys = {};
src.replace(/\bT\('([a-z_]+)'/g, function (all, k) { if (!/_$/.test(k)) keys[k] = true; return all; });
['td_first', 'td_need', 'td_kept_btn', 'td_keep', 'resume_make', 'td_e_make', 'td_d_resume', 'td_d_make', 'td_e_watch', 'td_e_find', 'td_e_play', 'td_d_watch', 'td_d_find', 'td_d_play',
  'td_kind_news', 'td_kind_talk', 'td_kind_philo', 'td_e_facts', 'td_e_views', 'td_e_asks', 'td_e_mine', 'td_d_facts', 'td_d_views', 'td_d_asks', 'td_d_mine',
  'td_next_circle', 'td_next_circle_on', 'td_think', 'td_try'].forEach(function (k) { keys[k] = true; });
var missing = Object.keys(keys).filter(function (k) { return !new RegExp('\\n\\s+' + k + ": \\['[^']+', '[^']+'\\]").test(i18n); });
eq(missing, [], 'X-6 使う key が i18n.js に [中, 小] である');
var tdLines = i18n.split('\n').filter(function (l) { return /^\s+(td_|odai_rec)/.test(l); }).join('\n');
ok(tdLines.length > 0 && !/点数|ランキング|順位|評価|成績|レベル|集中力|得意|苦手|上手|成長|頑張|すごい|版/.test(tdLines), 'X-6 §X の文言に評価の語・「版」が無い');

// ---------- レビューへの裁定（contract-app 末尾「直す（実装）」）----------
function t(name, fn) { try { fn(); } catch (e) { fail += 1; console.log('NG  ' + name + '  (例外 ' + e.message + ')'); } }
function fakeStore(st, failKey) {
  var s = { log: [], disk: {} };
  s.save = function (k) { s.log.push(k); if (k === failKey) return false; s.disk[k] = JSON.stringify(st[k]); return true; };
  return s;
}
var TDSRC = fs.readFileSync(path.join(__dirname, '../app-v3/js/today.js'), 'utf8');
function handlerSrc(name) { var i = TDSRC.indexOf("A['" + name + "'] = function"); if (i < 0) return ''; var j = TDSRC.indexOf("\n  A['", i + 10); var k = TDSRC.indexOf('\n  function ', i + 10); var e = [j, k].filter(function (x) { return x > 0; }); return TDSRC.slice(i, e.length ? Math.min.apply(null, e) : i + 3000); }
t('裁定 12 §AE の題材（stop / ath / story）は MD.THEMES に必ずある', function () {
  ['stop', 'ath', 'story'].forEach(function (th) { ok(MD.THEMES.indexOf(th) >= 0, '裁定 12 ' + th + ' は MD.THEMES にある'); });
});
t('裁定 1 対話のお題の「作ってみる」: 保存できなければ活動を足さず、作業台へ移らない', function () {
  var o = TDD.getDialog('od-philo-ai'), st = { activities: [], saveFailed: false };
  var r = TD.dialogMake(st, o, { id: 'a-dm1', mode: 'js', now: '10:20', recText: 'x' }, fakeStore(st, 'activities').save);
  eq([r.ok, r.created, st.activities.length, st.saveFailed], [false, true, 0, true], '裁定 1 保存の失敗 → 活動は足さない');
  var r2 = TD.dialogMake(st, o, { id: 'a-dm2', mode: 'js', now: '10:20', recText: 'x' }, fakeStore(st, null).save);
  eq([r2.ok, r2.created, st.activities.length, st.activities[0].odaiId], [true, true, 1, 'od-philo-ai'], '裁定 1 保存できたら足す');
  var r3 = TD.dialogMake(st, o, { id: 'a-dm3', mode: 'js', now: '10:20', recText: 'x' }, fakeStore(st, 'activities').save);
  eq([r3.created, r3.id], [false, 'a-dm2'], '裁定 1 2 回目は同じ活動（保存しない）');
  var h = handlerSrc('td-dmake');
  ok(h.indexOf('dialogMake(') > 0 && h.indexOf('dialogMake(') < h.indexOf('window.location.hash') && /if \(!r\.ok\)/.test(h) && h.indexOf('DES.app.change') < 0, '裁定 1 td-dmake は保存の結果を見てから移動');
});
t('裁定 1 対話のお題の「バディと話す」: 保存できなければ下書きを変えず、#talk へ移らない', function () {
  var st = { draft: { text: '前の下書き', scroll: 5 }, saveFailed: false };
  eq([TD.addTalk(st, '話したい', fakeStore(st, 'draft').save), st.draft, st.saveFailed], [false, { text: '前の下書き', scroll: 5 }, true], '裁定 1 保存の失敗 → 下書きはそのまま');
  eq([TD.addTalk(st, '話したい', fakeStore(st, null).save), st.draft], [true, { text: '前の下書き\n話したい', scroll: 5 }], '裁定 1 保存できたら改行して足す');
  var st2 = { draft: { text: '', scroll: 0 } };
  TD.addTalk(st2, '話したい', fakeStore(st2, null).save);
  eq(st2.draft.text, '話したい', '裁定 1 下書きが空ならそのまま入れる');
  var h = handlerSrc('td-dtalk'), ia = h.indexOf('if (!addTalk(');
  ok(ia > 0 && ia < h.indexOf("T('prefilled')") && ia < h.indexOf("'#talk'") && h.indexOf('DES.app.change') < 0, '裁定 1 td-dtalk は保存の結果を見てからトースト・移動');
});
t('裁定 1 「とっておく」: 保存できなければとっておかず、トーストを出さない', function () {
  var st = { odai: TD.initial(), saveFailed: false }, id = st.odai.dslots.news;
  eq([TD.saveOdai(st, TD.keep(st.odai, id), fakeStore(st, 'odai').save), st.odai.kept, st.saveFailed], [false, [], true], '裁定 1 保存の失敗 → kept は前のまま');
  eq([TD.saveOdai(st, TD.keep(st.odai, id), fakeStore(st, null).save), st.odai.kept], [true, [id]], '裁定 1 保存できたら入る');
  var h = handlerSrc('td-keep');
  ok(/if \(!putOdai\(next[^)]*\)\) return;/.test(h) && h.indexOf('setOdai(') < 0, '裁定 1 td-keep は保存の結果を見てからトースト');
});
t('裁定 1 入口を開いた記録: 保存できなければ入口を開かず（記録も戻す）、「次の一歩」も出ない', function () {
  var st = { odai: TD.initial(), saveFailed: false }, open = {}, id = 'od-news-mmx';
  var r = TD.openDEntry(st, open, id, 'facts', fakeStore(st, 'odai').save);
  eq([r.saved, open[id] || null, TD.isOpened(st.odai, id), st.saveFailed], [false, null, false, true], '裁定 1 保存の失敗 → パネルは閉じたまま・記録なし');
  open[id] = 'views';
  var r1 = TD.openDEntry(st, open, id, 'facts', fakeStore(st, 'odai').save);
  eq([r1.saved, open[id]], [false, 'views'], '裁定 1 別の入口が開いていた時は、その入口のまま');
  var r2 = TD.openDEntry(st, open, id, 'facts', fakeStore(st, null).save);
  eq([r2.saved, open[id], TD.isOpened(st.odai, id)], [true, 'facts', true], '裁定 1 保存できたら開いて記録');
  var r3 = TD.openDEntry(st, open, id, 'facts', fakeStore(st, 'odai').save);
  eq([r3.saved, open[id] || null], [null, null], '裁定 1 もう一度押すと閉じる（保存なし）');
  var r4 = TD.openDEntry(st, open, id, 'facts', fakeStore(st, 'odai').save);
  eq([r4.saved, open[id]], [null, 'facts'], '裁定 1 開いた記録が既にある入口は保存なしで開く');
  ok(handlerSrc('td-dentry').indexOf('openDEntry(') > 0, '裁定 1 td-dentry は openDEntry を使う');
});
t('裁定 4 対話のお題から作った活動: 「必要な物をまとめて」を出さない / 写真のダミーはお題の絵', function () {
  var o = TDD.getDialog('od-philo-ai'), a = M.fromOdai(TDD.makeOdaiOf(o), { id: 'a-d4', mode: 'js', now: '10:20', acts: [] }).act;
  eq([M.leaveOptions(a), M.remakeOptions(a, null)], [['osteps'], ['osteps']], '裁定 4 任せる候補・作り直しの候補は「手順を整理して」だけ');
  eq(M.leave(a, 'oneed').ids.length, 0, '裁定 4 必要な物のメモは作らない');
  var asp = M.leave(a, 'aspect', { aspect: 2 });
  eq([asp.ids.length, asp.opt], [1, 'osteps'], '裁定 4 「材料・色」を選んでも手順のメモ（無反応にしない）');
  var ph = M.addPhoto(a, 'photo').photo, art = MD.photoArt(ph);
  ok(art.indexOf('is-photo') > 0 && art !== TDD.frameOnly() && art.indexOf(TDD.cardArt(o).replace(/<\/svg>$/, '').slice(40, 200)) > 0, '裁定 4 写真のダミーはお題の絵（空の枠にしない）');
  var plain = M.fromOdai(TDD.get('od-seed'), { id: 'a-d4b', acts: [] }).act;
  eq(M.leaveOptions(plain), ['osteps', 'oneed'], '裁定 4 作る・ためすのお題の活動は今までどおり 2 つ');
});
t('裁定 6 考えの id: 既にある id と重ならない採番 / 空の id は読み込み時に捨てる', function () {
  var id = 'od-talk-ai', st = TD.initial();
  st.think[id] = { opened: { facts: false, views: false, asks: false, mine: true }, ask: null, marks: [{ id: 'mk9007199254740992', stance: 's1', line: null, time: '11/6 10:20' }] };
  st = TD.normalize(st);
  var s1 = TD.putMark(st, id, { stance: 's2', line: 'a', time: 't' }), s2 = TD.putMark(s1, id, { stance: 's3', line: 'b', time: 't' });
  var ids = s2.think[id].marks.map(function (m) { return m.id; });
  eq(ids.filter(function (x, i) { return ids.indexOf(x) !== i; }), [], '裁定 6 id が重ならない（' + ids.join(',') + '）');
  eq(TD.normalize(JSON.parse(JSON.stringify(s2))).think[id].marks.length, 3, '裁定 6 読み込み直しても 3 件残る');
  var r = TD.removeMark(s2, id, ids[0]), back = TD.restoreMark(r.state, r.undo), bids = back.think[id].marks.map(function (m) { return m.id; });
  eq([bids.length, bids.filter(function (x, i) { return bids.indexOf(x) !== i; }).length], [3, 0], '裁定 6 元に戻しても重ならない');
  var raw = TD.initial();
  raw.think[id] = { opened: {}, ask: null, marks: [{ id: '', stance: 's1', line: null, time: 't' }, { id: 'mk2', stance: 's1', line: null, time: 't' }] };
  eq(TD.normalize(raw).think[id].marks.map(function (m) { return m.id; }), ['mk2'], '裁定 6 空の id は捨てる');
});
t('裁定 8 フォーカス: 考えの保存の失敗の後 / 古い考えを外して元に戻した後', function () {
  var id = 'od-talk-ai', st = TD.initial();
  st = TD.putMark(st, id, { stance: 's1', line: '古い', time: 't1' });
  st = TD.putMark(st, id, { stance: 's2', line: '新しい', time: 't2' });
  var old = st.think[id].marks[1].id, r = TD.removeMark(st, id, old), back = TD.restoreMark(r.state, r.undo);
  eq(TD.restoredMarkId(back, r.undo), old, '裁定 8 元に戻した考え（古い方）の id');
  var h = handlerSrc('td-mark-del');
  ok(/restoredMarkId\(/.test(h) && /data-arg="' \+ esc\(/.test(h.slice(h.indexOf('undo_restore'))), '裁定 8 元に戻した後は、戻した考えの「外す」へ');
  var p = handlerSrc('td-mark-put');
  ok(p.indexOf('DES.app.render()') < 0 && /putOdai\(next, \{[^}]*ok:/.test(p), '裁定 8 置くの保存の失敗の後は描き直しを 1 回（フォーカスを消さない）');
});

console.log('today-test: ' + pass + ' passed, ' + fail + ' failed');
console.log('TODAY_TEST=' + (fail === 0 ? 'PASS' : 'FAIL'));
process.exitCode = fail === 0 ? 0 : 1;
