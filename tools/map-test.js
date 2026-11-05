/* 学びマップの純関数テスト（CONTRACT-v3 §Y-9）+ 中身（§Y-5）+ 文言（§Y-7）。node tools/map-test.js → 最後に MAP_TEST=PASS|FAIL */
'use strict';
var path = require('path');
var fs = require('fs');
var MD = require(path.join(__dirname, '../app-v3/js/make-data.js'));
var MPD = require(path.join(__dirname, '../app-v3/js/map-data.js'));
var MP = require(path.join(__dirname, '../app-v3/js/map.js'));
var W = require(path.join(__dirname, '../app-v3/js/works.js'));

var pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass += 1; } else { fail += 1; console.log('NG  ' + name); }
}
function eq(a, b, name) { ok(JSON.stringify(a) === JSON.stringify(b), name + '  (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }
function cp(v) { return JSON.parse(JSON.stringify(v)); }
function pair(v) { return Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && v[0] && typeof v[1] === 'string' && v[1]; }
function dayNum(s) { var m = /^(\d{1,2})\/(\d{1,2})$/.exec(s); return m ? (+m[1]) * 100 + (+m[2]) : -1; }
var U = function (code) { return MPD.unit(code); };

// ---------- 単元（§Y-5） ----------
eq(MPD.units.length, 14, 'Y-5 算数 4 年 14 単元');
var codes = MPD.units.map(function (u) { return u.code; });
eq(codes.filter(function (c, i) { return codes.indexOf(c) !== i; }), [], 'Y-5 code が重ならない');
ok(codes.every(function (c) { return /^M4-[A-D]-\d\d$/.test(c); }), 'Y-5 code は "M4-A-01" 形式の仮値');
eq(MPD.areas.map(function (a) { return a.name[0]; }), ['数と計算', '図形', '変化と関係', 'データの活用'], 'Y-3 4 領域（段の順）');
var byArea = {};
MPD.units.forEach(function (u) { (byArea[u.area] = byArea[u.area] || []).push(u.name[0]); });
// 学習指導要領（第 4 学年の内容）の項目の順で固定（司令塔裁定 2026-11-05）
eq(byArea.A, ['大きな数', 'がい数', 'わり算の筆算', '小数', '分数', '計算のきまり'], 'Y-3 数と計算は学習指導要領の順');
eq(byArea.B, ['垂直・平行と四角形', '直方体と立方体', '面積', '角の大きさ'], 'Y-3 図形は学習指導要領の順');
eq(byArea.C, ['変わり方', '簡単な割合'], 'Y-3 変化と関係は学習指導要領の順');
eq(byArea.D, ['整理のしかた', '折れ線グラフ'], 'Y-3 データの活用は学習指導要領の順');
eq(codes, codes.slice().sort(), 'Y-5 仮の code の番号も表示の順');
ok(U('M4-A-06').items.some(function (it) { return /□/.test(it.name[0]); }), 'Y-5 計算のきまりは □を使った式を含む');
ok(U('M4-B-02').items.some(function (it) { return /位置/.test(it.name[0]); }), 'Y-5 直方体と立方体は ものの位置を含む');
MPD.units.forEach(function (u) {
  ok(pair(u.name), 'Y-5 ' + u.code + ' の名前は [中, 小]');
  ok(u.items.length >= 3 && u.items.length <= 6, 'Y-5 ' + u.code + ' は 3〜6 項目（' + u.items.length + '）');
  ok(u.items.every(function (it) { return pair(it.name) && it.id.indexOf(u.code + '-') === 0; }), 'Y-5 ' + u.code + ' の項目は [中, 小] と id');
  ok(u.material === true && u.grade === 4 && !!MPD.area(u.area), 'Y-5 ' + u.code + ' は material: true・4 年・領域あり');
});
ok(MPD.units.every(function (u) { return !/速さ/.test(u.name[0]); }), 'Y-5 速さ（5 年）の単元は無い');
eq(MPD.extUnits.map(function (u) { return [u.code, u.subject[0], u.name[0], u.material, u.items === undefined]; }), [['S4-A-01', '理科', '電流の働き', false, true]], 'Y-5 extUnits = 理科 4 年 電流の働き（material:false・項目なし）');

// ---------- 進み具合の見本（§Y-5 の物語） ----------
var P = MPD.progress;
Object.keys(P).forEach(function (k) {
  var v = P[k];
  ok(codes.indexOf(k.replace(/-\d+$/, '')) >= 0, 'Y-5 進み具合の項目 ' + k + ' は単元にある');
  [v.practice, v.explain].forEach(function (d) { ok(d === null || (dayNum(d) > 0 && dayNum(d) <= 1102), 'Y-5 ' + k + ' の日付は M/D で 11/2 まで'); });
});
['M4-A-01', 'M4-D-02', 'M4-A-03', 'M4-B-04', 'M4-B-01'].forEach(function (c) {
  var r = MP.progress(U(c), P);
  ok(r.done / r.total >= 0.6, 'Y-5 前半の ' + U(c).name[0] + ' はおおむね両方済み（' + r.done + '/' + r.total + '）');
});
['M4-A-04', 'M4-A-02'].forEach(function (c) {
  var r = MP.progress(U(c), P);
  ok(r.done < r.total && r.done + r.practiceOnly + r.explainOnly > 0, 'Y-5 ' + U(c).name[0] + ' は途中');
});
var area = U('M4-B-03'), ap = area.items.filter(function (it) { return MPD.itemProgress(P, it.id).practice; }).length, ae = area.items.filter(function (it) { return MPD.itemProgress(P, it.id).explain; }).length;
eq([ap, ae], [2, 1], 'Y-5 面積は 問題 2 項目・説明 1 項目');
ok(MP.progress(area, P).practiceOnly >= 1, 'Y-5 面積は片方だけのマスが見える');
['M4-A-06', 'M4-A-05', 'M4-B-02', 'M4-C-01', 'M4-C-02', 'M4-D-01'].forEach(function (c) {
  var r = MP.progress(U(c), P);
  eq([r.done, r.practiceOnly, r.explainOnly], [0, 0, 0], 'Y-5 ' + U(c).name[0] + ' は空');
});
var ov = MP.overall(MPD.units, P);
ok(ov.pct >= 30 && ov.pct <= 40, 'Y-5 全体でおよそ 3〜4 割（' + ov.pct + '%）');

// ---------- MP.progress / overall / isBlank / lastDate（§Y-3 / §Y-9） ----------
eq(MP.progress(area, P), { done: 1, practiceOnly: 1, explainOnly: 0, total: 5, pct: 20 }, 'progress 面積');
eq(MP.progress(U('M4-A-02'), P), { done: 0, practiceOnly: 1, explainOnly: 1, total: 3, pct: 0 }, 'progress がい数（問題だけ 1・説明だけ 1）');
eq(MP.progress(U('M4-C-01'), {}), { done: 0, practiceOnly: 0, explainOnly: 0, total: 3, pct: 0 }, 'progress 記録なし = 0%');
eq(MP.progress(null, P), { done: 0, practiceOnly: 0, explainOnly: 0, total: 0, pct: 0 }, 'progress 単元なし');
var eight = { items: [1, 2, 3, 4, 5, 6, 7, 8].map(function (i) { return { id: 'x-' + i }; }) };
eq(MP.progress(eight, { 'x-1': { practice: '1/1', explain: '1/1' } }).pct, 13, 'progress 四捨五入（1/8 = 12.5 → 13）');
eq(MP.progress(eight, { 'x-1': { practice: '1/1', explain: null }, 'x-2': { practice: null, explain: '1/2' } }).pct, 0, 'progress 片方だけは数えない');
var tot = 0, dn = 0;
MPD.units.forEach(function (u) { tot += u.items.length; MPD.units.length; dn += MP.progress(u, P).done; });
eq(ov, { done: dn, total: tot, pct: Math.round(dn * 100 / tot) }, 'overall = 全項目の両方済み / 全項目数');
var avg = Math.round(MPD.units.reduce(function (s, u) { return s + MP.progress(u, P).pct; }, 0) / MPD.units.length);
ok(ov.pct !== avg, 'overall は単元 % の平均ではない（' + ov.pct + ' vs ' + avg + '）');
eq(MP.overall([], P), { done: 0, total: 0, pct: 0 }, 'overall 単元なし');
ok(MP.isBlank(MPD.units, {}) === true && MP.isBlank(MPD.units, P) === false, 'isBlank 記録が 1 つも無い時だけ');
eq(MP.lastDate(area, P), '11/1', 'lastDate 面積 = 11/1');
eq(MP.lastDate(U('M4-A-03'), P), '10/7', 'lastDate 月をまたいでも新しい日（9/29 < 10/7）');
eq(MP.lastDate(U('M4-A-06'), P), null, 'lastDate 記録なし = null');

// ---------- 対応表（§Y-5）: 場面は既存の見本記録の原文だけ ----------
var acts = MD.seedActivities(), works = MD.seedWorks(acts);
function act(id) { return acts.filter(function (a) { return a.id === id; })[0]; }
function work(id) { return works.filter(function (w) { return w.id === id; })[0]; }
eq(MPD.learned.map(function (l) { return l.id; }), ['ln-area', 'ln-cuboid', 'ln-stars', 'ln-speed', 'ln-battery'], 'Y-5 学んだことは 5 つ');
MPD.learned.forEach(function (l) {
  ok(pair(l.text), 'Y-5 ' + l.id + ' の言葉は [中, 小]');
  ok(['own', 'person', 'buddy'].indexOf(l.src) >= 0, 'Y-5 ' + l.id + ' の出所');
  ok(!!act(l.actId), 'Y-5 ' + l.id + ' の活動 ' + l.actId + ' が見本にある');
  ok(l.units.length > 0 && l.units.every(function (c) { return !!MPD.anyUnit(c); }), 'Y-5 ' + l.id + ' の単元がある');
});
var quote = {
  'ln-area': (act('act-build').changes.filter(function (c) { return c.id === 'act-build-c2'; })[0] || {}).what,
  'ln-cuboid': (act('act-build').changes.filter(function (c) { return c.id === 'act-build-c1'; })[0] || {}).what
};
eq(quote['ln-area'], { text: '塔を 2 倍にした' }, 'Y-5 act-build-c2 の原文「塔を 2 倍にした」');
eq(quote['ln-cuboid'], { text: '石で塔を建てた' }, 'Y-5 act-build-c1 の原文「石で塔を建てた」');
eq(work('w-seed-py').like, '星が 6 つになると、どれを取りに行くか迷うところ', 'Y-5 w-seed-py の like の原文');
eq(work('w-seed-py').craft, '速さを 4 にしたら追いつけなかったので、3 に戻した', 'Y-5 w-seed-py の craft の原文');
eq(work('w-seed-circuit').like, '電池を 2 個にしたら、電球がはっきりついたところ', 'Y-5 w-seed-circuit の like の原文');
var L = {};
MPD.learned.forEach(function (l) { L[l.id] = l; });
eq([L['ln-area'].src, L['ln-area'].units, L['ln-area'].evidence], ['buddy', ['M4-B-03'], { changeId: 'act-build-c2', field: 'what', quote: '塔を 2 倍にした' }], 'Y-5 2 倍 → 面積（バディ）');
eq([L['ln-cuboid'].src, L['ln-cuboid'].units, L['ln-cuboid'].evidence], ['buddy', ['M4-B-02'], { changeId: 'act-build-c1', field: 'what', quote: '石で塔を建てた' }], 'Y-5 塔 → 直方体と立方体（バディ）');
eq([L['ln-stars'].src, L['ln-stars'].units, L['ln-stars'].evidence], ['own', ['M4-C-01'], { workId: 'w-seed-py', field: 'like', quote: work('w-seed-py').like }], 'Y-5 星 → 変わり方（本人）');
eq([L['ln-speed'].src, L['ln-speed'].units, L['ln-speed'].evidence], ['own', ['M4-C-01'], { workId: 'w-seed-py', field: 'craft', quote: work('w-seed-py').craft }], 'Y-5 速さ → 変わり方（本人。速さの単元に結ばない）');
eq([L['ln-battery'].src, L['ln-battery'].units, L['ln-battery'].evidence], ['own', ['S4-A-01'], { workId: 'w-seed-circuit', field: 'like', quote: work('w-seed-circuit').like }], 'Y-5 電池 → 理科 電流の働き（本人）');
// 引き出した時の原文（quote）は、見本の記録の今の文と同じ
MPD.learned.forEach(function (l) {
  var e = l.evidence, cur = e.changeId ? ((act(l.actId).changes.filter(function (c) { return c.id === e.changeId; })[0] || {}).what || {}).text : (work(e.workId) || {})[e.field];
  eq(e.quote, cur, 'Y-5 ' + l.id + ' の quote = 見本の記録の原文');
});

// ---------- MP.graph（§Y-9）: 活動 1 つ = ノード 1 つ・記録が消えたら辺ごと落とす ----------
var OPT = { today: '11/2' };
var g = MP.graph(MPD.learned, acts, works, [], OPT);
eq(g.nodes.acts.map(function (n) { return n.id; }), ['act:act-build', 'act:act-py', 'act:act-cap'], 'graph 作ってきたもの = 活動の並び（活動 1 つ = 1 ノード）');
eq(g.nodes.acts.map(function (n) { return n.works.map(function (w) { return w.title; }); }), [['石の塔（2 倍）'], ['星がたくさん落ちるゲーム', '星 5 つのゲーム'], ['電球がつく回路']], 'graph 作ったものに残した作品のタイトル');
eq(g.nodes.learned.map(function (n) { return n.id; }), ['ln:ln-area', 'ln:ln-cuboid', 'ln:ln-stars', 'ln:ln-speed', 'ln:ln-battery'], 'graph 学んだこと 5');
eq(g.nodes.units.map(function (n) { return [n.id, n.material]; }), [['unit:M4-B-03', true], ['unit:M4-B-02', true], ['unit:M4-C-01', true], ['unit:S4-A-01', false]], 'graph つながる単元（重なりなし・理科は material:false）');
eq(g.edges.length, 10, 'graph 辺 10（作ったもの→学んだこと 5 + 学んだこと→単元 5）');
var all = g.nodes.acts.concat(g.nodes.learned, g.nodes.units).map(function (n) { return n.id; });
eq(all.filter(function (id, i) { return all.indexOf(id) !== i; }), [], 'graph ノード id が重ならない');
eq(MP.nodeById(g, 'ln:ln-area').scene, { kind: 'change', ref: 'act-build-c2', field: 'what', date: '11/2', time: '10:14', text: '塔を 2 倍にした', with: '田中さん' }, 'graph 場面（11/2 10:14 塔を 2 倍にした・田中さんと）');
eq(MP.nodeById(g, 'ln:ln-stars').scene, { kind: 'work', ref: 'w-seed-py', field: 'like', date: '10/30', time: '10:31', text: '星が 6 つになると、どれを取りに行くか迷うところ', with: null }, 'graph 場面（作品の本人の言葉）');
var g1 = MP.graph(MPD.learned, acts, works, ['ln-area'], OPT);
ok(!MP.hasNode(g1, 'ln:ln-area') && !MP.hasNode(g1, 'unit:M4-B-03') && g1.edges.length === 8, 'graph 外した（declined）学んだことと辺が消える・その先の単元も');
var noCap = acts.filter(function (a) { return a.id !== 'act-cap'; });
var g2 = MP.graph(MPD.learned, noCap, works, [], OPT);
ok(!MP.hasNode(g2, 'ln:ln-battery') && !MP.hasNode(g2, 'unit:S4-A-01'), 'graph 活動が消えたら辺ごと落とす');
eq(g2.nodes.acts.map(function (n) { return n.id; }), ['act:act-build', 'act:act-py', 'work:w-seed-circuit'], 'graph 活動の無い作品だけ作品をノードに');
eq(MP.nodeById(g2, 'work:w-seed-circuit').learned, [], 'graph 作品のノードには学んだことが付かない（活動が無い）');
var g3 = MP.graph(MPD.learned, acts, works.filter(function (w) { return w.id !== 'w-seed-py'; }), [], OPT);
ok(!MP.hasNode(g3, 'ln:ln-stars') && !MP.hasNode(g3, 'ln:ln-speed') && !MP.hasNode(g3, 'unit:M4-C-01'), 'graph 作品が消えたら（作品から外した）その言葉の学んだことを落とす');
var w4 = cp(works);
w4.forEach(function (w) { if (w.id === 'w-seed-py') w.like = null; });
var g4 = MP.graph(MPD.learned, acts, w4, [], OPT);
ok(!MP.hasNode(g4, 'ln:ln-stars') && MP.hasNode(g4, 'ln:ln-speed'), 'graph 記録の欄が空になったら、その学んだことだけ落とす');
// 記録を本人が直したら（作品の詳細の W.edit）、その記録から引き出した学んだことは出さない。元の文に戻せばまた出る（裁定 1）
var we = W.edit(works, 'w-seed-py', 'like', '色の組み合わせを工夫したところ');
eq(we.filter(function (w) { return w.id === 'w-seed-py'; })[0].like, '色の組み合わせを工夫したところ', 'quote 前提: W.edit で気に入っているところが変わる');
var ge = MP.graph(MPD.learned, acts, we, [], OPT);
ok(!MP.hasNode(ge, 'ln:ln-stars') && !MP.hasNode(ge, 'act:act-py>ln:ln-stars') && ge.edges.every(function (e) { return e.from !== 'ln:ln-stars' && e.to !== 'ln:ln-stars'; }), 'quote 直した記録の学んだことは辺ごと出さない（本人由来で残さない）');
ok(MP.hasNode(ge, 'ln:ln-speed') && MP.hasNode(ge, 'unit:M4-C-01'), 'quote 直していない記録（工夫したところ）の学んだことは残る');
var wb = W.edit(we, 'w-seed-py', 'like', work('w-seed-py').like);
ok(MP.hasNode(MP.graph(MPD.learned, acts, wb, [], OPT), 'ln:ln-stars'), 'quote 元の文に戻すと また出る');
var ws = cp(works);
ws.forEach(function (w) { if (w.id === 'w-seed-py') w.like = '  ' + w.like + ' '; });
ok(MP.hasNode(MP.graph(MPD.learned, acts, ws, [], OPT), 'ln:ln-stars'), 'quote 前後の空白だけの違いは同じ文');
var ac = cp(acts);
ac[0].changes.forEach(function (c) { if (c.id === 'act-build-c2') c.what = { text: '塔を 3 倍にした' }; });
ok(!MP.hasNode(MP.graph(MPD.learned, ac, works, [], OPT), 'ln:ln-area') && MP.hasNode(MP.graph(MPD.learned, ac, works, [], OPT), 'ln:ln-cuboid'), 'quote 変化の文が変わったら、その学んだことだけ出さない');
var noQ = cp(MPD.learned);
delete noQ[2].evidence.quote;
ok(!MP.hasNode(MP.graph(noQ, acts, works, [], OPT), 'ln:ln-stars'), 'quote 原文を持たない対応は出さない');
var a5 = cp(acts);
a5[0].changes = a5[0].changes.filter(function (c) { return c.id !== 'act-build-c2'; });
ok(!MP.hasNode(MP.graph(MPD.learned, a5, works, [], OPT), 'ln:ln-area'), 'graph 変化が無くなったら（戻した）その学んだことを落とす');
var fresh = { id: 'a-new', title: '新しい作業台', changes: [], shelf: [], thread: [], steps: [], stepIdx: 0, state: 'working' };
var g6 = MP.graph(MPD.learned, [fresh].concat(acts), works, [], OPT);
eq([g6.nodes.acts[0].id, g6.nodes.acts[0].learned], ['act:a-new', []], 'graph 対応表に無い活動もノード（学んだことは 0。本番の推定はしない）');
eq(MP.defaultSel(g6), 'act:a-new', 'defaultSel いちばん新しい作ったもの（先頭）');
var g0 = MP.graph(MPD.learned, [], [], [], OPT);
eq([g0.nodes.acts.length, g0.edges.length, MP.defaultSel(g0)], [0, 0, null], 'graph 作ったもの 0 = 空・既定の選択なし');
eq(MP.graph(MPD.learned, null, undefined, null).nodes.acts.length, 0, 'graph 壊れた入力でも落ちない');

// ---------- MP.related（2 ホップ）/ defaultSel ----------
eq(MP.defaultSel(g), 'act:act-build', 'defaultSel 見本 = 建築（大きく）');
eq(MP.related(g, 'act:act-build'), { nodes: ['ln:ln-area', 'ln:ln-cuboid', 'unit:M4-B-03', 'unit:M4-B-02'],
  edges: ['act:act-build>ln:ln-area', 'ln:ln-area>unit:M4-B-03', 'act:act-build>ln:ln-cuboid', 'ln:ln-cuboid>unit:M4-B-02'] }, 'related 作ったもの → 学んだこと → 単元');
eq(MP.related(g, 'ln:ln-stars').nodes, ['act:act-py', 'unit:M4-C-01'], 'related 学んだこと → 作ったもの と 単元（となりの学んだことは含めない）');
eq(MP.related(g, 'unit:M4-C-01'), { nodes: ['act:act-py', 'ln:ln-stars', 'ln:ln-speed'],
  edges: ['ln:ln-stars>unit:M4-C-01', 'act:act-py>ln:ln-stars', 'ln:ln-speed>unit:M4-C-01', 'act:act-py>ln:ln-speed'] }, 'related 単元 ← 学んだこと ← 作ったもの');
eq(MP.related(g, 'unit:S4-A-01').nodes, ['act:act-cap', 'ln:ln-battery'], 'related 理科の単元も同じに');
eq(MP.related(g, 'nope'), { nodes: [], edges: [] }, 'related 無い id');
eq(MP.related(g2, 'work:w-seed-circuit'), { nodes: [], edges: [] }, 'related 作品のノードは つながり 0');

// ---------- MP.normalizeUi / select / decline / undecline（§Y-6） ----------
eq(MP.normalizeUi(null, null), { declined: [] }, 'normalizeUi 無い = 初期値（選択は既定）');
eq(MP.normalizeUi(null, g), { sel: 'act:act-build', declined: [] }, 'normalizeUi graph があれば既定の選択');
eq(MP.normalizeUi({ sel: 'act:zzz', declined: [] }, g).sel, 'act:act-build', 'normalizeUi 無効な id は既定に戻す');
eq(MP.normalizeUi({ sel: null, declined: [] }, g).sel, null, 'normalizeUi 外した（null）は保つ');
eq(MP.normalizeUi({ sel: 'unit:M4-C-01' }, g), { sel: 'unit:M4-C-01', declined: [] }, 'normalizeUi 有効な id は保つ');
eq(MP.normalizeUi({ sel: 5, declined: ['ln-area'] }, null), { declined: [] }, 'normalizeUi 形が違えば初期値（sel が数）');
eq(MP.normalizeUi({ sel: 'x', declined: 'ln-area' }, null), { declined: [] }, 'normalizeUi 形が違えば初期値（declined が配列でない）');
eq(MP.normalizeUi([1, 2], null), { declined: [] }, 'normalizeUi 配列は初期値');
eq(MP.normalizeUi({ declined: ['ln-area', 'zz', 'ln-area', 3, 'ln-cuboid'] }, null).declined, ['ln-area', 'ln-cuboid'], 'normalizeUi declined は対応表にあるものだけ・重なりなし');
eq(MP.normalizeUi({ sel: null, declined: ['ln-stars', 'ln-speed', 'ln-battery'] }, null).declined, [], 'normalizeUi 保存値に本人の言葉の id があっても落とす（裁定 2）');
eq(MP.normalizeUi({ declined: ['ln-stars', 'ln-cuboid', 'ln-battery'] }, null).declined, ['ln-cuboid'], 'normalizeUi declined はバディの見立てだけ残す');
var gp = MP.graph(MPD.learned, acts, works, MP.normalizeUi({ declined: ['ln-stars', 'ln-speed', 'ln-battery'] }, null).declined, OPT);
eq(gp.nodes.learned.filter(function (n) { return n.src === 'own'; }).length, 3, 'normalizeUi → graph 本人由来の学んだこと 3 件は保存値で消えない');
eq(MP.normalizeUi({ declined: ['p1'] }, null, [{ id: 'p1', src: 'person' }, { id: 'b1', src: 'buddy' }]).declined, [], 'normalizeUi 人の言葉も外さない');
eq(MP.normalizeUi({ sel: 'ln:ln-area', declined: ['ln-area'] }, g1).sel, 'act:act-build', 'normalizeUi 外した学んだことの選択は既定へ');
eq(MP.select({}, g, 'act:act-build'), { sel: null, declined: [] }, 'select 既定で選ばれているノードをもう一度 = 外す');
eq(MP.select({}, g, 'ln:ln-stars'), { sel: 'ln:ln-stars', declined: [] }, 'select 別のノード');
eq(MP.select({ sel: 'ln:ln-stars' }, g, 'ln:ln-stars'), { sel: null, declined: [] }, 'select 同じノードをもう一度 = 外す');
eq(MP.select({ sel: null }, g, 'ln:ln-stars').sel, 'ln:ln-stars', 'select 外した後にまた選ぶ');
eq(MP.select({ sel: 'ln:ln-stars' }, g, 'nope').sel, 'ln:ln-stars', 'select 無いノードは変えない');
eq(MP.decline({ sel: 'ln:ln-area' }, g, 'ln:ln-area'), { sel: 'act:act-build', declined: ['ln-area'] }, 'decline バディの見立てを外す → 選択はその作ったもの');
eq(MP.decline({}, g, 'ln:ln-stars'), null, 'decline 本人の言葉は外さない');
eq(MP.decline({}, g, 'unit:M4-B-03'), null, 'decline 単元は外さない');
eq(MP.decline({ declined: ['ln-area'] }, g1, 'ln:ln-area'), null, 'decline 外したものはもう無い');
eq(MP.undecline({ sel: 'act:act-build', declined: ['ln-area', 'ln-cuboid'] }, 'ln-area'), { sel: 'ln:ln-area', declined: ['ln-cuboid'] }, 'undecline 元に戻す → その学んだことを選ぶ');

// ---------- MP.unitLinks（単元の詳細） ----------
eq(MP.unitLinks(g, 'M4-C-01').map(function (x) { return [x.learned.id, x.act.id]; }), [['ln:ln-stars', 'act:act-py'], ['ln:ln-speed', 'act:act-py']], 'unitLinks 変わり方 ← 星・速さ ← Python');
eq(MP.unitLinks(g, 'M4-A-05'), [], 'unitLinks つながりの無い単元 = []');
eq(MP.unitLinks(g1, 'M4-B-03'), [], 'unitLinks 外した学んだことは出さない');

// ---------- 文言（§Y-7）: key が i18n.js に [中, 小] である・禁止語なし ----------
var i18n = fs.readFileSync(path.join(__dirname, '../app-v3/js/i18n.js'), 'utf8');
var mapSrc = fs.readFileSync(path.join(__dirname, '../app-v3/js/map.js'), 'utf8');
var dataSrc = fs.readFileSync(path.join(__dirname, '../app-v3/js/map-data.js'), 'utf8');
var cssSrc = fs.readFileSync(path.join(__dirname, '../app-v3/css/map.css'), 'utf8');
var keys = { mp_in_map: true, mp_kind_act: true, mp_kind_work: true, mp_kind_learned: true, mp_kind_unit: true, mp_tab_links: true, mp_tab_basics: true };
mapSrc.replace(/\bT\('([a-z_]+)'/g, function (all, k) { keys[k] = true; return all; });
var missing = Object.keys(keys).filter(function (k) { return !new RegExp('\\n\\s+' + k + ": \\['[^']+', '[^']+'\\]").test(i18n); });
eq(missing, [], 'Y-7 使う key が i18n.js に [中, 小] である');
ok(/mp_in_map/.test(fs.readFileSync(path.join(__dirname, '../app-v3/js/works.js'), 'utf8')), 'Y-8 作品の詳細に「学びマップで見る」');
var mpLines = i18n.split('\n').filter(function (l) { return /^\s+mp_/.test(l); });
ok(mpLines.length >= 30, 'Y-7 学びマップの key（' + mpLines.length + '）');
var lastKey = i18n.split('\n').filter(function (l) { return /^\s+[a-z_]+: \[/.test(l); }).slice(-mpLines.length);
ok(lastKey.every(function (l) { return /^\s+mp_/.test(l); }), 'Y-8 学びマップの key は辞書の末尾にまとまっている');
var BAD = /点数|ランキング|順位|評価|成績|レベル|集中力|得意|苦手|上手|成長|頑張|すごい|まだ|未|理解した|身についた|版/;
var bad = mpLines.filter(function (l) { return BAD.test(l); });
eq(bad, [], 'Y-7 学びマップの文言に禁止語・「まだ」「未」「版」が無い');
function strings(v, out) {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach(function (x) { strings(x, out); });
  else if (v && typeof v === 'object') Object.keys(v).forEach(function (k) { strings(v[k], out); });
  return out;
}
eq(strings([MPD.units, MPD.extUnits, MPD.areas, MPD.learned], []).filter(function (s) { return BAD.test(s); }), [], 'Y-7 単元・項目・学んだことに禁止語が無い');
eq([mapSrc, dataSrc, cssSrc].filter(function (s) { return /まだ|理解した|身についた/.test(s); }).length, 0, 'Y-11 map*.js / map.css に「まだ」「理解した」「身についた」が無い');
ok(/aria-live/.test(mapSrc) && /pointer-events:none/.test(cssSrc) && /minmax\(0,1fr\)\)/.test(cssSrc), 'Y-2 見出し aria-live・線は pointer-events:none・列は minmax(0,1fr)');
ok(!/#ed922c|--orange/.test(cssSrc.split('\n').filter(function (l) { return /mp-edge|mp-sq/.test(l); }).join('\n')), 'Y-2 / Y-3 線とマスに橙を使わない');

console.log('map-test: ' + pass + ' passed, ' + fail + ' failed');
console.log('MAP_TEST=' + (fail === 0 ? 'PASS' : 'FAIL'));
process.exitCode = fail === 0 ? 0 : 1;
