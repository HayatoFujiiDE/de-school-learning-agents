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
eq(topics.length, 9, 'X-3 プール 9 本');
['near', 'next', 'new'].forEach(function (f) { eq(TDD.pool(f).length, 3, 'X-3 fit ' + f + ' は 3 本'); });
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
eq(topics.filter(function (t) { return t.fit === 'near'; }).map(function (t) { return t.makeTheme; }).sort(), ['circuit', 'mc', 'py'], 'X-3 near の 3 本は作るの 3 題材');
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
for (var k = 0; k < 3; k++) { st = TD.swap(st, 0); seen.push(st.slots[0]); }
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
ok(!('works' in f2) && Object.keys(f2).sort().join() === 'kept,rot,slots,tried', 'addFound 作品には入れない（お題の記録だけ）');
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
eq(TD.normalize(bad1).slots, TD.swap(s0, 2).slots, 'normalize slots が壊れたら rot から作り直す');
eq(TD.normalize(bad1).kept, good.kept, 'normalize slots が壊れても他のキーは残す');
var bad2 = JSON.parse(freeze(good)); bad2.slots = 'x'; bad2.rot = { near: -1 };
eq(TD.normalize(bad2).slots, s0.slots, 'normalize slots も rot も壊れたら初期値');
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
var r6 = M.fromOdai(seed, { id: 'a-od6', acts: [], question: seed.title[0] });
eq([r6.act.title, r6.act.thread.length], [seed.title[0], 1], 'fromOdai 問いが元のままなら自分の案として扱わない');
eq(M.fromOdai(null, {}), null, 'fromOdai お題なしは null');
var other = M.fromSample('mc', { id: 'a-s', now: '10:20', mode: 'js' });
ok(M.fromOdai(seed, { id: 'a-od7', acts: [other] }).created, 'fromOdai お題から作っていない活動は使わない');
ok(M.migrate(r1.act, function () { return ''; }) === r1.act && M.migrate(r2.act, function () { return ''; }) === r2.act, 'fromOdai の活動は読み込み時の移行で変わらない');

// ---------- 画面の文言 key が i18n.js にある（console.warn を出さない） ----------
var i18n = fs.readFileSync(path.join(__dirname, '../app-v3/js/i18n.js'), 'utf8');
var src = fs.readFileSync(path.join(__dirname, '../app-v3/js/today.js'), 'utf8') + fs.readFileSync(path.join(__dirname, '../app-v3/js/make.js'), 'utf8');
var keys = {};
src.replace(/\bT\('([a-z_]+)'/g, function (all, k) { if (!/_$/.test(k)) keys[k] = true; return all; });
['td_first', 'td_need', 'td_kept_btn', 'td_keep', 'resume_make', 'td_e_make', 'td_d_resume', 'td_d_make', 'td_e_watch', 'td_e_find', 'td_e_play', 'td_d_watch', 'td_d_find', 'td_d_play'].forEach(function (k) { keys[k] = true; });
var missing = Object.keys(keys).filter(function (k) { return !new RegExp('\\n\\s+' + k + ": \\['[^']+', '[^']+'\\]").test(i18n); });
eq(missing, [], 'X-6 使う key が i18n.js に [中, 小] である');
var tdLines = i18n.split('\n').filter(function (l) { return /^\s+(td_|odai_rec)/.test(l); }).join('\n');
ok(tdLines.length > 0 && !/点数|ランキング|順位|評価|成績|レベル|集中力|得意|苦手|上手|成長|頑張|すごい|版/.test(tdLines), 'X-6 §X の文言に評価の語・「版」が無い');

console.log('today-test: ' + pass + ' passed, ' + fail + ' failed');
console.log('TODAY_TEST=' + (fail === 0 ? 'PASS' : 'FAIL'));
process.exitCode = fail === 0 ? 0 : 1;
