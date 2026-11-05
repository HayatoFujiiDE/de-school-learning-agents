/* 学びマップの純関数テスト（CONTRACT-v3 §Y-9 / §AB-12）+ 中身（§Y-5 / §AB-8〜AB-10）+ 文言（§Y-7 / §AB-14）。
   node tools/map-test.js → 最後に MAP_TEST=PASS|FAIL */
'use strict';
var path = require('path');
var fs = require('fs');
var MD = require(path.join(__dirname, '../app-v3/js/make-data.js'));
var MPD = require(path.join(__dirname, '../app-v3/js/map-data.js'));
var MPL = require(path.join(__dirname, '../app-v3/js/map-layout.js'));
var MPC = require(path.join(__dirname, '../app-v3/js/map-canvas.js'));
var MP = require(path.join(__dirname, '../app-v3/js/map.js'));
var ST = require(path.join(__dirname, '../app-v3/js/store.js'));
var W = require(path.join(__dirname, '../app-v3/js/works.js'));

var pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass += 1; } else { fail += 1; console.log('NG  ' + name); }
}
function eq(a, b, name) { ok(JSON.stringify(a) === JSON.stringify(b), name + '  (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }
function near(a, b, eps) { return Math.abs(a - b) <= (eps || 1e-6); }
function cp(v) { return JSON.parse(JSON.stringify(v)); }
function pair(v) { return Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && v[0] && typeof v[1] === 'string' && v[1]; }
function dayNum(s) { var m = /^(\d{1,2})\/(\d{1,2})$/.exec(s); return m ? (+m[1]) * 100 + (+m[2]) : -1; }
function ids(list) { return list.map(function (n) { return n.id; }); }
var U = function (code) { return MPD.unit(code); };

// ---------- 算数の単元（§Y-5） ----------
eq(MPD.units.length, 14, 'Y-5 算数 4 年 14 単元');
var codes = MPD.units.map(function (u) { return u.code; });
eq(codes.filter(function (c, i) { return codes.indexOf(c) !== i; }), [], 'Y-5 code が重ならない');
ok(codes.every(function (c) { return /^M4-[A-D]-\d\d$/.test(c); }), 'Y-5 code は "M4-A-01" 形式の仮値');
eq(MPD.areas.map(function (a) { return a.name[0]; }), ['数と計算', '図形', '変化と関係', 'データの活用'], 'Y-3 4 領域（段の順）');
var byArea = {};
MPD.units.forEach(function (u) { (byArea[u.area] = byArea[u.area] || []).push(u.name[0]); });
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
  ok(u.material === true && u.grade === 4 && !!MPD.area(u.area) && u.sub === 'math', 'Y-5 ' + u.code + ' は material: true・4 年・領域あり');
});
ok(MPD.units.every(function (u) { return !/速さ/.test(u.name[0]); }), 'Y-5 速さ（5 年）の単元は無い');

// ---------- 算数以外の単元（§AB-8） ----------
var ext = MPD.extUnits, bySub = {};
ext.forEach(function (u) { (bySub[u.sub] = bySub[u.sub] || []).push(u); });
ok(bySub.sci.length >= 7 && bySub.sci.length <= 8, 'AB-8 理科 4 年 7〜8 個（' + bySub.sci.length + '）');
ok(bySub.jpn.length >= 5 && bySub.jpn.length <= 6, 'AB-8 国語 4 年 5〜6 個（' + bySub.jpn.length + '）');
ok(bySub.soc.length >= 5 && bySub.soc.length <= 6, 'AB-8 社会 4 年 5〜6 個（' + bySub.soc.length + '）');
eq(Object.keys(bySub).sort(), ['jpn', 'sci', 'soc'], 'AB-8 算数以外は 理科・国語・社会');
ok(ext.every(function (u) { return new RegExp('^' + { sci: 'S', jpn: 'J', soc: 'C' }[u.sub] + '4-[A-Z]-\\d\\d$').test(u.code); }), 'AB-8 code は S4- / J4- / C4- の仮値');
ok(ext.every(function (u) { return u.material === false && u.items === undefined && u.grade === 4 && pair(u.name) && pair(u.subject); }), 'AB-8 算数以外は material:false・項目なし・[中, 小]');
ok(ext.every(function (u) { return MPD.otherAreas.some(function (a) { return a.id === u.area && a.sub === u.sub; }); }), 'AB-8 各単元に領域（area）');
var allCodes = MPD.allUnits().map(function (u) { return u.code; });
eq(allCodes.filter(function (c, i) { return allCodes.indexOf(c) !== i; }), [], 'AB-8 全教科の code が重ならない');
eq(MPD.anyUnit('S4-A-01').name[0], '電流の働き', 'AB-8 理科 4 年 電流の働き（§Y-5 の code のまま）');
var isl = MPD.islands();
eq(isl.map(function (s) { return s.sub; }).filter(function (s, i, a) { return a.indexOf(s) === i; }), ['math', 'sci', 'jpn', 'soc'], 'AB-5 島は 教科の順');
eq(isl.reduce(function (n, s) { return n + s.units.length; }, 0), allCodes.length, 'AB-5 島に全単元が 1 回ずつ');
ok(isl.every(function (s) { return s.units.length > 0 && pair(s.name) && pair(s.subject); }), 'AB-5 島 = 教科 × 領域（名前 [中, 小]）');

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
['M4-A-06', 'M4-A-05', 'M4-B-02', 'M4-C-01', 'M4-C-02', 'M4-D-01'].forEach(function (c) {
  var r = MP.progress(U(c), P);
  eq([r.done, r.practiceOnly, r.explainOnly], [0, 0, 0], 'Y-5 ' + U(c).name[0] + ' は空');
});
var ov = MP.overall(MPD.units, P);
ok(ov.pct >= 30 && ov.pct <= 40, 'Y-5 全体でおよそ 3〜4 割（' + ov.pct + '%）');

// ---------- MP.progress / overall / isBlank / lastDate（§Y-3 / §Y-9） ----------
eq(MP.progress(area, P), { done: 1, practiceOnly: 1, explainOnly: 0, total: 5, pct: 20 }, 'progress 面積');
eq(MP.progress(U('M4-A-02'), P), { done: 0, practiceOnly: 1, explainOnly: 1, total: 3, pct: 0 }, 'progress がい数（問題だけ 1・説明だけ 1）');
eq(MP.progress(null, P), { done: 0, practiceOnly: 0, explainOnly: 0, total: 0, pct: 0 }, 'progress 単元なし');
var eight = { items: [1, 2, 3, 4, 5, 6, 7, 8].map(function (i) { return { id: 'x-' + i }; }) };
eq(MP.progress(eight, { 'x-1': { practice: '1/1', explain: '1/1' } }).pct, 13, 'progress 四捨五入（1/8 = 12.5 → 13）');
var tot = 0, dn = 0;
MPD.units.forEach(function (u) { tot += u.items.length; dn += MP.progress(u, P).done; });
eq(ov, { done: dn, total: tot, pct: Math.round(dn * 100 / tot) }, 'overall = 全項目の両方済み / 全項目数');
ok(MP.isBlank(MPD.units, {}) === true && MP.isBlank(MPD.units, P) === false, 'isBlank 記録が 1 つも無い時だけ');
eq([MP.lastDate(area, P), MP.lastDate(U('M4-A-03'), P), MP.lastDate(U('M4-A-06'), P)], ['11/1', '10/7', null], 'lastDate（月をまたいでも新しい日 / 記録なし = null）');

// ---------- 対応表（§Y-5 / §AB-10）: 場面は記録の原文だけ ----------
var acts = MD.seedActivities(), works = MD.seedWorks(acts);
function act(id) { return acts.filter(function (a) { return a.id === id; })[0]; }
function work(id) { return works.filter(function (w) { return w.id === id; })[0]; }
var L5 = {};
MPD.learned.forEach(function (l) { L5[l.id] = l; });
eq(MPD.learned.slice(0, 5).map(function (l) { return l.id; }), ['ln-area', 'ln-cuboid', 'ln-stars', 'ln-speed', 'ln-battery'], 'Y-5 今の活動の学んだこと 5 つ（そのまま）');
eq([L5['ln-area'].src, L5['ln-area'].units, L5['ln-area'].evidence], ['buddy', ['M4-B-03'], { changeId: 'act-build-c2', field: 'what', quote: '塔を 2 倍にした' }], 'Y-5 2 倍 → 面積（バディ）');
eq([L5['ln-battery'].src, L5['ln-battery'].units], ['own', ['S4-A-01']], 'Y-5 電池 → 理科 電流の働き（本人）');
eq([L5['ln-speed'].units], [['M4-C-01']], 'Y-5 速さ → 変わり方（速さの単元に結ばない）');
ok(MPD.learned.length >= 25 && MPD.learned.length <= 30, 'AB-10 学んだこと 25〜30（' + MPD.learned.length + '）');
var lids = MPD.learned.map(function (l) { return l.id; });
eq(lids.filter(function (x, i) { return lids.indexOf(x) !== i; }), [], 'AB-10 学んだことの id が重ならない');
MPD.learned.forEach(function (l) {
  ok(pair(l.text), 'Y-5 ' + l.id + ' の言葉は [中, 小]');
  ok(['own', 'person', 'buddy'].indexOf(l.src) >= 0, 'Y-5 ' + l.id + ' の出所');
  ok(l.units.length > 0 && l.units.every(function (c) { return !!MPD.anyUnit(c); }), 'Y-5 ' + l.id + ' の単元がある');
  var e = l.evidence, cur;
  if (l.actId) cur = e.changeId ? ((act(l.actId).changes.filter(function (c) { return c.id === e.changeId; })[0] || {}).what || {}).text : (work(e.workId) || {})[e.field];
  else { var p = MPD.pastDef(l.pastId); cur = p ? ((p.records.filter(function (r) { return r.id === e.recordId; })[0]) || {}).text : undefined; }
  ok(!!(l.actId ? act(l.actId) : MPD.pastDef(l.pastId)), 'AB-10 ' + l.id + ' の作ったものが見本にある');
  eq(e.quote, cur, 'AB-10 ' + l.id + ' の quote = 記録の原文');
});
ok(MPD.learned.some(function (l) { return l.units.length >= 2; }), 'AB-10 1 つの学んだことが複数の単元へ');
var unitMade = {};
MPD.learned.forEach(function (l) { l.units.forEach(function (c) { (unitMade[c] = unitMade[c] || {})[l.actId || l.pastId] = 1; }); });
ok(Object.keys(unitMade).some(function (c) { return Object.keys(unitMade[c]).length >= 2; }), 'AB-10 複数の作ったものが同じ単元へ');

// ---------- 前に作ったもの（§AB-9） ----------
var dataSrc0 = fs.readFileSync(path.join(__dirname, '../app-v3/js/data.js'), 'utf8');
ok(MPD.past.length >= 6 && MPD.past.length <= 7, 'AB-9 前に作ったもの 6〜7（' + MPD.past.length + '）');
MPD.past.forEach(function (p) {
  ok(pair(p.title) && dayNum(p.date) > 0 && dayNum(p.date) < 1102, 'AB-9 ' + p.id + ' は 題 [中, 小]・日付（今日より前）');
  ok(['gauge', 'poster', 'moon', 'box', 'maze', 'beads', 'leaf'].indexOf(p.art) >= 0, 'AB-9 ' + p.id + ' の絵の種類');
  ok(p.catalogId === null || dataSrc0.indexOf("id: '" + p.catalogId + "'") >= 0, 'AB-9 ' + p.id + ' の題材は「今まで取り組んできたこと」の名前（' + p.catalogId + '）か季節のもの');
  ok(p.records.length >= 1 && p.records.every(function (r) { return typeof r.text === 'string' && r.text && (r.with === null || r.with === '田中さん'); }), 'AB-9 ' + p.id + ' の記録（人名は見本の人だけ）');
});
ok(MPD.past.filter(function (p) { return p.catalogId; }).length >= 4, 'AB-9 予定ページの名前からの題材が 4 つ以上');

// ---------- 単元どうしのつながり・これから作れそう（§AB-10） ----------
var order = MPD.unitLinks.filter(function (k) { return k.kind === 'order'; }), cross = MPD.unitLinks.filter(function (k) { return k.kind === 'cross'; });
ok(order.length >= 8 && order.length <= 12, 'AB-10 学ぶ順 8〜12（' + order.length + '）');
eq(cross.length, 0, 'AD-1 教科をまたぐ（cross）は MPD.unitLinks から消した');
ok(MPD.unitLinks.every(function (k) { return MPD.anyUnit(k.from) && MPD.anyUnit(k.to) && k.from !== k.to; }), 'AB-10 つながりの単元がある');
ok(MPD.unitLinks.every(function (k) { return k.kind === 'order' && !('why' in k); }), 'AD-1 / AD-9 単元どうしのつながりは学ぶ順のデータだけ（詳細の 前 / 後 用に残す・why は概念へ移した）');
ok(MPD.next.length >= 4 && MPD.next.length <= 6, 'AB-10 これから作れそう 4〜6（' + MPD.next.length + '）');
ok(MPD.next.every(function (x) { return pair(x.title) && pair(x.line) && x.learned.length > 0 && x.learned.every(function (id) { return !!MPD.learnedDef(id); }) && x.units.every(function (c) { return !!MPD.anyUnit(c); }); }), 'AB-10 これから作れそう = 題・元の学んだこと / 単元・バディの 1 行');
ok(MPD.next.every(function (x) { return Object.keys(x).every(function (k) { return ['id', 'title', 'learned', 'units', 'line'].indexOf(k) >= 0; }); }), 'AB-6 これから作れそうに 数・おすすめ度を持たない');
ok(!('peer' in MPD) && MPD.unitLinks.every(function (k) { return k.kind !== 'peer'; }), 'AB-10 作ったものどうしの線はデータに持たない');

// ---------- MP.graph（§AB-12）: 4 種のつながり + past + next ----------
var OPT = { today: '11/2' };
var g = MP.graph(MPD.learned, acts, works, [], OPT);
eq(ids(g.nodes.made).slice(0, 3), ['act:act-build', 'act:act-cap', 'act:act-py'], 'graph 作ったもの = 新しい順（今の活動）');
eq(g.nodes.made.length, 3 + MPD.past.length, 'graph 作ったもの = 活動 3 + 前に作ったもの');
ok(g.nodes.made.every(function (m, i) { return i === 0 || dayNum(m.date) <= dayNum(g.nodes.made[i - 1].date); }), 'graph 作ったものは日付の新しい順');
eq(g.nodes.made[0].works.map(function (w) { return w.title; }), ['石の塔（2 倍）'], 'graph 作ったものに残した作品のタイトル');
eq(g.nodes.learned.length, MPD.learned.length, 'graph 学んだこと = 対応表すべて（記録がそろっている）');
eq(g.nodes.units.length, MPD.allUnits().length, 'graph 単元 = 全教科');
eq(g.nodes.next.length, MPD.next.length, 'graph これから作れそう');
var kinds = {};
g.edges.forEach(function (e) { kinds[e.kind] = (kinds[e.kind] || 0) + 1; });
ok(kinds.base > 0 && kinds.mu > 0 && kinds.peer > 0 && kinds.order === order.length && !kinds.cross && kinds.next > 0, 'graph 線の種類 base / mu / peer / order / next（cross なし）' + JSON.stringify(kinds));
ok(!MP.graph(MPD.learned, acts, works, [], { today: '11/2', links: [{ id: 'x1', kind: 'cross', from: 'M4-C-01', to: 'S4-A-01', why: ['a', 'b'] }] }).edges.some(function (e) { return e.kind === 'cross'; }), 'AD-1 graph は教科をまたぐ線を渡されても落とす');
var eids = g.edges.map(function (e) { return e.id; });
eq(eids.filter(function (x, i) { return eids.indexOf(x) !== i; }), [], 'graph 線の id が重ならない');
var all = ids(g.nodes.made.concat(g.nodes.learned, g.nodes.units, g.nodes.next));
eq(all.filter(function (id, i) { return all.indexOf(id) !== i; }), [], 'graph ノード id が重ならない');
ok(g.edges.every(function (e) { return MP.hasNode(g, e.from) && MP.hasNode(g, e.to); }), 'graph 線の両端は必ずノード');
var peer = g.edges.filter(function (e) { return e.kind === 'peer'; });
ok(peer.every(function (e) { var a = MP.nodeById(g, e.from), b = MP.nodeById(g, e.to); return e.units.length && e.units.every(function (c) { return a.units.indexOf(c) >= 0 && b.units.indexOf(c) >= 0; }); }), 'graph 作ったものどうし = 同じ単元につながる（共有する単元つき）');
eq(MP.nodeById(g, 'ln:ln-area').scene, { kind: 'change', ref: 'act-build-c2', field: 'what', date: '11/2', time: '10:14', text: '塔を 2 倍にした', with: '田中さん' }, 'graph 場面（11/2 10:14 塔を 2 倍にした・田中さんと）');
eq(MP.nodeById(g, 'ln:ln-poster-one').scene, { kind: 'record', ref: 'past-poster-r1', field: 'text', date: '9/3', time: '10:20', text: '「いちばん伝えたいことは？」と聞かれて、1 つにしぼった', with: '田中さん' }, 'graph 場面（前に作ったものの記録）');
eq(MP.nodeById(g, 'unit:M4-B-03').made, ['act:act-build', 'past:past-leaf', 'past:past-maze'], 'graph 面積は 3 つの作ったものから（橋）');
// 無い id を指す線は落とす
var gx = MP.graph(MPD.learned, acts, works, [], { today: '11/2', links: MPD.unitLinks.concat([{ id: 'bad', kind: 'cross', from: 'M4-C-01', to: 'ZZ-9', why: ['x', 'x'] }, { id: 'bad2', kind: 'order', from: 'NOPE', to: 'M4-A-01' }]),
  next: MPD.next.concat([{ id: 'nx-bad', title: ['x', 'x'], learned: ['ln-nope'], units: ['ZZ'], line: ['x', 'x'] }, { id: 'nx-half', title: ['y', 'y'], learned: ['ln-nope', 'ln-area'], units: ['ZZ', 'M4-B-03'], line: ['y', 'y'] }]) });
ok(!gx.edges.some(function (e) { return /bad|ZZ|NOPE/.test(e.id); }), 'graph 無い単元を指す つながり は線ごと落とす');
ok(!MP.hasNode(gx, 'next:nx-bad'), 'graph 元が 1 つも無い これから作れそう は落とす');
eq(gx.edges.filter(function (e) { return e.to === 'next:nx-half'; }).map(function (e) { return e.from; }).sort(), ['ln:ln-area', 'unit:M4-B-03'], 'graph これから作れそうの 無い元の線だけ落とす');
var lx = cp(MPD.learned);
lx[0].units = ['M4-B-03', 'ZZ-1'];
eq(MP.nodeById(MP.graph(lx, acts, works, [], OPT), 'ln:ln-area').units, ['M4-B-03'], 'graph 学んだことの 無い単元 は落とす');
var g1 = MP.graph(MPD.learned, acts, works, ['ln-area'], OPT);
ok(!MP.hasNode(g1, 'ln:ln-area') && !g1.edges.some(function (e) { return e.from === 'ln:ln-area' || e.to === 'ln:ln-area'; }), 'graph 外した（declined）学んだことと線が消える');
eq(MP.nodeById(g1, 'unit:M4-B-03').made, ['past:past-leaf', 'past:past-maze'], 'graph 外した見立ての単元は 他の作ったものからは残る');
ok(!MP.hasNode(MP.graph(MPD.learned, acts, works, [], { today: '11/2', declinedNext: ['nx-lamp'] }), 'next:nx-lamp'), 'graph 外した これから作れそう は出さない');
var noCap = acts.filter(function (a) { return a.id !== 'act-cap'; });
var g2 = MP.graph(MPD.learned, noCap, works, [], OPT);
ok(!MP.hasNode(g2, 'ln:ln-battery') && MP.nodeById(g2, 'unit:S4-A-01').made.length === 0 && MP.hasNode(g2, 'work:w-seed-circuit'), 'graph 活動が消えたら辺ごと落とす・活動の無い作品は作品のノード');
eq(MP.nodeById(g2, 'work:w-seed-circuit').learned, [], 'graph 作品のノードには学んだことが付かない');
// 記録を本人が直したら、その記録から引き出した学んだことは出さない。元の文に戻せばまた出る（§Y 裁定 1）
var we = W.edit(works, 'w-seed-py', 'like', '色の組み合わせを工夫したところ');
var ge = MP.graph(MPD.learned, acts, we, [], OPT);
ok(!MP.hasNode(ge, 'ln:ln-stars') && MP.hasNode(ge, 'ln:ln-speed'), 'quote 直した記録の学んだことは辺ごと出さない・直していない方は残る');
ok(MP.hasNode(MP.graph(MPD.learned, acts, W.edit(we, 'w-seed-py', 'like', work('w-seed-py').like), [], OPT), 'ln:ln-stars'), 'quote 元の文に戻すと また出る');
var px = cp(MPD.past);
px[0].records[0].text = '雨の量を 3 mm と書いた';
ok(!MP.hasNode(MP.graph(MPD.learned, acts, works, [], { today: '11/2', past: px }), 'ln:ln-rain-decimal'), 'quote 前に作ったものの記録が違えば出さない');
var fresh = { id: 'a-new', title: '新しい作業台', changes: [], shelf: [], thread: [], steps: [], stepIdx: 0, state: 'working' };
var g6 = MP.graph(MPD.learned, [fresh].concat(acts), works, [], OPT);
eq([g6.nodes.made[0].id, g6.nodes.made[0].learned], ['act:a-new', []], 'graph 対応表に無い今日の活動もノード（いちばん新しい・学んだことは 0）');
eq(MP.graph(MPD.learned, null, undefined, null).nodes.made.length, MPD.past.length, 'graph 壊れた入力でも落ちない');

// ---------- MP.related（種類ごと）/ peers ----------
var rb = MP.related(g, 'act:act-build');
ok(['act:act-build>ln:ln-area', 'act:act-build>ln:ln-cuboid', 'ln:ln-area>unit:M4-B-03', 'ln:ln-cuboid>unit:M4-B-02'].every(function (x) { return rb.kinds.base.indexOf(x) >= 0; }), 'related 作ったもの → 学んだこと → 単元（base）');
// §AC-13: 作ったものどうしの線（peer）は related に入らない。同じ単元を通ってつながる作ったものは 基本の線（作ったもの → 学んだこと → 単元 ← 学んだこと ← 作ったもの）で濃くなる
ok(!('peer' in rb.kinds) && rb.edges.every(function (id) { return id.indexOf('peer:') !== 0; }), 'AC-13 related に作ったものどうしの線が無い');
ok(['past:past-leaf', 'past:past-maze', 'past:past-box'].every(function (id) { return rb.nodes.indexOf(id) >= 0; }), 'AC-13 related 同じ単元につながる作ったもの（落ち葉・迷路・貯金箱）も濃く');
ok(rb.kinds.base.indexOf('past:past-leaf>ln:ln-leaf-area') >= 0 && rb.kinds.base.indexOf('ln:ln-leaf-area>unit:M4-B-03') >= 0 && rb.kinds.base.indexOf('ln:ln-box-net>unit:M4-B-02') >= 0, 'AC-13 related 相手の作ったもの → 学んだこと → 共有する単元 の基本の線');
ok(rb.kinds.base.every(function (eid) { var e = g.edges.filter(function (x) { return x.id === eid; })[0], l = MP.nodeById(g, e.to.indexOf('ln:') === 0 ? e.to : e.from); return l.madeId === 'act:act-build' || l.units.some(function (c) { return MP.nodeById(g, 'act:act-build').units.indexOf(c) >= 0; }); }), 'AC-13 related 相手の学んだことは共有する単元へ行くものだけ');
var rbf = MP.related(g, 'act:act-build');
ok(rbf.kinds.mu.indexOf('past:past-maze>unit:M4-B-03') >= 0 && rbf.kinds.mu.indexOf('act:act-build>unit:M4-B-03') >= 0, 'AC-13 related 分野で見る（作ったもの → 単元 ← 作ったもの）');
ok(MP.related(g, 'act:act-cap').nodes.every(function (id) { return !/^(act|past|work):/.test(id); }), 'AC-13 related 同じ単元が無ければ 他の作ったものは濃くならない');
ok(rb.kinds.next.length > 0 && rb.nodes.indexOf('next:nx-tower-box') >= 0, 'related 作ったもの → これから作れそう');
ok(!('order' in rb.kinds) && !('cross' in rb.kinds) && rb.edges.every(function (id) { return id.indexOf('ul:') !== 0; }), 'AD-1 / AD-9 related に 学ぶ順・教科をまたぐ が無い');
ok(rb.nodes.indexOf('act:act-build') < 0, 'related 自分は含めない');
var ru = MP.related(g, 'unit:M4-C-01');
ok(ru.edges.every(function (id) { return id.indexOf('ul:') !== 0; }) && ru.nodes.indexOf('unit:M4-D-02') < 0 && ru.nodes.indexOf('unit:S4-A-01') < 0, 'AD-9 related 単元を選んでも 学ぶ順の前後・教科をまたぐ相手は濃くしない（線が無い）');
ok(ru.nodes.indexOf('act:act-py') >= 0 && ru.nodes.indexOf('ln:ln-stars') >= 0, 'related 単元 ← 学んだこと ← 作ったもの');
var rn = MP.related(g, 'next:nx-lamp');
eq(rn.kinds.next.sort(), ['ln:ln-battery>next:nx-lamp', 'ln:ln-stars>next:nx-lamp', 'unit:M4-C-01>next:nx-lamp', 'unit:S4-A-01>next:nx-lamp'].sort(), 'related これから作れそう ← 元（学んだこと・単元）');
eq(MP.related(g, 'nope'), { nodes: [], edges: [], kinds: { base: [], mu: [], next: [] } }, 'related 無い id');
eq(MP.peers(g, 'act:act-build'), [{ id: 'past:past-leaf', units: ['M4-B-03'] }, { id: 'past:past-maze', units: ['M4-B-03'] }, { id: 'past:past-box', units: ['M4-B-02'] }], 'peers 同じ単元につながる作ったもの + 共有単元（新しい順）');
eq(MP.peers(g, 'past:past-maze'), [{ id: 'act:act-build', units: ['M4-B-03'] }, { id: 'past:past-leaf', units: ['M4-B-03'] }, { id: 'past:past-box', units: ['M4-B-01', 'M4-B-04'] }], 'peers 共有単元が 2 つ');
eq(MP.peers(g, 'act:act-cap'), [], 'peers 同じ単元が無ければ空');
// 見方ごとのノード
var vm = MP.viewNodes(g, 'made'), vf = MP.viewNodes(g, 'fields');
ok(vm['ln:ln-area'] && !vm['unit:M4-C-02'] && vm['unit:M4-B-03'], 'viewNodes 作ったものから = 学んだこと + つながる単元だけ');
ok(!vf['ln:ln-area'] && vf['unit:M4-C-02'] && vf['unit:J4-C-02'], 'viewNodes 分野で見る = 学んだことなし・全単元');
ok(MP.edgesIn(g, 'fields').every(function (e) { return e.kind !== 'base'; }) && MP.edgesIn(g, 'made').every(function (e) { return e.kind !== 'mu'; }), 'edgesIn 分野で見るは 作ったもの → 単元 にまとめる');
ok(['made', 'flow', 'fields', 'concepts', 'list'].every(function (v) { return MP.edgesIn(g, v).every(function (e) { return e.kind !== 'order' && e.kind !== 'cross'; }); }) && g.edges.some(function (e) { return e.kind === 'order'; }), 'AD-1 / AD-9 学ぶ順・教科をまたぐ の線はどの見方にも描かない（学ぶ順はグラフに残す = 詳細の 前 / 後）');
ok(peer.length > 0 && ['made', 'flow', 'fields', 'list'].every(function (v) { return MP.edgesIn(g, v).every(function (e) { return e.kind !== 'peer'; }); }), 'AC-13 作ったものどうしの線はどの見方にも描かない（並びと peers のためグラフには残す）');
eq(MP.viewNodes(g, 'flow'), vm, 'AC-8 流れで見るのノード = 作ったものから と同じ');

// ---------- 流れで見る（§AC-8 / AC-9）: MP.flowCols / flowRel / flowOrder ----------
var fc = MP.flowCols(g);
eq(fc.made, ids(g.nodes.made), 'flowCols 左 = 作ったもの（新しい順）');
eq(fc.next, ids(g.nodes.next), 'flowCols これから作れそうは左の最後');
var fl = [];
g.nodes.made.forEach(function (m) { fl = fl.concat(m.learned); });
eq(fc.learned, fl, 'flowCols 中 = 学んだこと（作ったものの順）');
eq(fc.units.slice().sort(), Object.keys(vm).filter(function (id) { return id.indexOf('unit:') === 0; }).sort(), 'flowCols 右 = 作ったものとつながる単元すべて');
eq(fc.units[0], 'unit:' + MP.nodeById(g, fl[0]).units[0], 'flowCols 単元は上から最初に出てくる順');
eq(MP.flowOrder(g, null), fc, 'flowOrder 選択なし = 元の順');
eq(MP.flowOrder(g, 'zzz'), fc, 'flowOrder 無い選択 = 元の順');
var fo = MP.flowOrder(g, 'act:act-py'), fr = MP.flowRel(g, 'act:act-py');
function headSet(list, on) { var k = 0; while (k < list.length && on(list[k])) k += 1; return list.slice(k).every(function (id) { return !on(id); }); }
var onPy = function (id) { return id === 'act:act-py' || fr.nodes.indexOf(id) >= 0; };
ok(['made', 'next', 'learned', 'units'].every(function (k) { return headSet(fo[k], onPy) && fo[k].slice().sort().join() === fc[k].slice().sort().join(); }), 'flowOrder 選択あり = 選んだもの・つながる相手が各列の先頭（並べ替えるだけ）');
eq(fo.made[0], 'act:act-py', 'flowOrder 選んだ作ったものが左の先頭');
eq(fo.learned.slice(0, 2), ['ln:ln-stars', 'ln:ln-speed'], 'flowOrder その学んだことが中の先頭（元の順のまま）');
eq(fo.units[0], 'unit:M4-C-01', 'flowOrder つながる単元が右の先頭');
eq(fo.learned.filter(function (id) { return !onPy(id); }), fc.learned.filter(function (id) { return !onPy(id); }), 'flowOrder 残りは元の順');
eq(JSON.stringify(MP.flowOrder(g, 'act:act-py')), JSON.stringify(fo), 'flowOrder 決定論');
ok(fr.edges.every(function (eid) { return /^(act|past|work|ln):/.test(eid) && eid.indexOf('peer:') < 0 && eid.indexOf('ul:') < 0; }), 'flowRel 線は 作ったもの → 学んだこと → 単元 だけ');
var fru = MP.flowRel(g, 'unit:M4-C-01');
ok(fru.nodes.indexOf('unit:S4-A-01') < 0 && fru.nodes.indexOf('act:act-py') >= 0, 'flowRel 単元を選んでも 教科をまたぐ相手は濃くしない（この見方は線を出さない）');
eq(MP.flowRel(g, 'unit:M4-C-02'), null, 'flowRel 流れで見るに無いノード = null');

// ---------- 作ったものだけ（§AC-14）: MP.visible ----------
var vAll = MP.visible(g, { only: false, view: 'made' });
eq([vAll.nodes.slice().sort().join(), vAll.edges.slice().sort().join()], [Object.keys(vm).sort().join(), MP.edgesIn(g, 'made').map(function (e) { return e.id; }).sort().join()], 'visible off = その見方のノードと線すべて');
var vOn = MP.visible(g, { only: true, view: 'made' });
eq([vOn.nodes, vOn.edges], [ids(g.nodes.made), []], 'visible on = 作ったものだけ・線なし');
var vSel = MP.visible(g, { only: true, selId: 'act:act-py', view: 'made' }), rpy = MP.related(g, 'act:act-py');
ok(ids(g.nodes.made).every(function (id) { return vSel.nodes.indexOf(id) >= 0; }), 'visible on + 選択 = 作ったものは全部出たまま');
eq(vSel.nodes.filter(function (id) { return !/^(act|past|work):/.test(id); }), ['ln:ln-stars', 'ln:ln-speed', 'unit:M4-C-01', 'next:nx-lamp'], 'visible on + 選択 = その 1 つの 学んだこと → 単元・これから だけ（同じ単元を通る他の作ったものの学んだことは足さない）');
ok(vSel.edges.every(function (id) { return !/^past:|^ln:ln-bead|^ln:ln-moon/.test(id); }), 'visible on + 選択 = 他の作ったものからの線は出さない');
ok(vSel.nodes.indexOf('ln:ln-area') < 0 && vSel.nodes.indexOf('unit:M4-B-03') < 0, 'visible on + 選択 = 他の作ったものの学んだこと・単元は出さない');
ok(vSel.edges.length > 0 && vSel.edges.every(function (id) { return rpy.edges.indexOf(id) >= 0; }) && vSel.edges.indexOf('act:act-py>ln:ln-stars') >= 0, 'visible on + 選択 = その 1 つのつながりの線だけ');
var vF = MP.visible(g, { only: true, selId: 'act:act-py', view: 'fields' }), vf2 = MP.viewNodes(g, 'fields');
ok(vF.nodes.every(function (id) { return vf2[id]; }) && vF.edges.every(function (id) { return /^(act|past|work):.*>unit:|^unit:.*>next:/.test(id); }), 'visible 分野で見る（学んだことは出さない・作ったもの → 単元）');
eq(MP.visible(g, { only: true, selId: 'ln:ln-area', view: 'fields' }).nodes, ids(g.nodes.made), 'visible その見方に無い選択は作ったものだけ');
eq(MP.visible(null, { only: true }), { nodes: [], edges: [] }, 'visible グラフが無い');

// ---------- 表示設定の nav（§AC-7 / AC-9） ----------
eq([ST.normalizeUi(null), ST.normalizeUi({ nav: 'rail' }), ST.normalizeUi({ nav: 'open' }), ST.normalizeUi({ nav: 'x' }), ST.normalizeUi('rail'), ST.normalizeUi([1])],
  [{ nav: 'open' }, { nav: 'rail' }, { nav: 'open' }, { nav: 'open' }, { nav: 'open' }, { nav: 'open' }], 'AC-7 表示設定の nav: rail のときだけ閉じる・形が違えば open');

// ---------- MPL.layout（§AB-12）: 決定論・全ノードに位置・重ならない・fields は島の中 ----------
function layoutChecks(gg, label) {
  ['made', 'fields'].forEach(function (mode) {
    var La = MPL.layout(gg, mode), Lb = MPL.layout(gg, mode), vn = MP.viewNodes(gg, mode);
    eq(JSON.stringify(La) === JSON.stringify(Lb), true, 'layout ' + label + ' ' + mode + ' 決定論（同じ入力で同じ出力）');
    var miss = Object.keys(vn).filter(function (id) { var b = La.nodes[id]; return !b || ![b.x, b.y, b.w, b.h].every(isFinite) || b.w <= 0 || b.h <= 0; });
    eq(miss, [], 'layout ' + label + ' ' + mode + ' 全ノードに位置');
    eq(Object.keys(La.nodes).filter(function (id) { return !vn[id]; }), [], 'layout ' + label + ' ' + mode + ' その見方のノードだけ');
    eq(MPL.overlaps(La, 12).slice(0, 3), [], 'layout ' + label + ' ' + mode + ' 箱どうしが重ならない（すき間 12px 以上）');
    ok(Object.keys(La.nodes).every(function (id) { return MPL.inside(La.nodes[id], La.bounds); }), 'layout ' + label + ' ' + mode + ' bounds の中');
    if (mode === 'fields') {
      ok(La.islands.length === gg.islands.length && La.islands.every(function (s) { return s.units.every(function (id) { return MPL.inside(La.nodes[id], s); }); }), 'layout ' + label + ' fields 単元はその島の箱の中');
      ok(gg.islands.every(function (s) { var b = La.islands.filter(function (x) { return x.id === s.id; })[0]; return b && s.units.every(function (id) { return b.units.indexOf(id) >= 0; }); }), 'layout ' + label + ' fields 島 = 教科 × 領域の単元すべて');
      var bad = Object.keys(La.nodes).filter(function (id) { return !/^unit:/.test(id) && La.islands.some(function (s) { var b = La.nodes[id]; return b.x < s.x + s.w && s.x < b.x + b.w && b.y < s.y + s.h && s.y < b.y + b.h; }); });
      eq(bad, [], 'layout ' + label + ' fields 作ったもの・これからは島の外（島と島の間）');
      var islOv = [];
      La.islands.forEach(function (a, i) { La.islands.forEach(function (b, j) { if (i < j && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) islOv.push(a.id + '|' + b.id); }); });
      eq(islOv, [], 'layout ' + label + ' fields 島どうしが重ならない');
    }
  });
}
layoutChecks(g, '見本');
layoutChecks(g1, '外した後');
layoutChecks(g2, '活動なし');
layoutChecks(g6, '新しい活動');
layoutChecks(MP.graph(MPD.learned, [], [], MPD.learned.map(function (l) { return l.id; }), { today: '11/2', past: [] }), '作ったもの 0');
var big = [];
for (var bi = 0; bi < 6; bi++) big.push({ id: 'a-x' + bi, title: '新しい作業台 ' + bi, changes: [], shelf: [], thread: [], steps: [], stepIdx: 0, state: 'working' });
layoutChecks(MP.graph(MPD.learned, big.concat(acts), works, [], OPT), '活動が多い');
var Lm = MPL.layout(g, 'made'), Lf = MPL.layout(g, 'fields');
// 開いた時は全体が入る倍率（1440 の枠 ≒ 1100×470 に、倍率の下限 0.3 で入る大きさ）
ok(Lm.bounds.w * 0.3 <= 1100 && Lm.bounds.h * 0.3 <= 470, 'layout 作ったものから は 1440 の枠に倍率 0.3 以上で全体が入る（' + Lm.bounds.w + '×' + Lm.bounds.h + '）');
ok(Lf.bounds.w * 0.3 <= 1100 && Lf.bounds.h * 0.3 <= 470, 'layout 分野で見る は 1440 の枠に倍率 0.3 以上で全体が入る（' + Lf.bounds.w + '×' + Lf.bounds.h + '）');
// far で逆に拡大した題の札（倍率 0.3 で画面 150px 幅）が、となりの作ったものに重ならない間合い
['made', 'fields'].forEach(function (mode) {
  var LL = mode === 'made' ? Lm : Lf, ms = g.nodes.made.map(function (m) { return LL.nodes[m.id]; }), bad = [];
  ms.forEach(function (a, i) { ms.forEach(function (b, j) {
    if (i < j && Math.abs((a.x + a.w / 2) - (b.x + b.w / 2)) < 150 / 0.3 + 8 && Math.abs(a.y - b.y) < 110 + (2 * 12.5 * 1.3) / 0.3) bad.push(g.nodes.made[i].id + '|' + g.nodes.made[j].id);
  }); });
  eq(bad, [], 'layout ' + mode + ' far の題の札どうしが重ならない間合い');
});
// 作ったものから: 橋になる単元は、その作ったものたちの間（作ったものの真ん中に近い）
var bridge = MP.nodeById(g, 'unit:M4-C-01'), bc = { x: 0, y: 0 };
bridge.made.forEach(function (id) { bc.x += (Lm.nodes[id].x + Lm.nodes[id].w / 2) / bridge.made.length; bc.y += (Lm.nodes[id].y + Lm.nodes[id].h / 2) / bridge.made.length; });
var bu = Lm.nodes['unit:M4-C-01'];
ok(Math.hypot(bu.x + bu.w / 2 - bc.x, bu.y + bu.h / 2 - bc.y) < 700, 'layout 橋になる単元（変わり方）は 3 つの作ったものの間');
// MPL.size: 文字数から箱の大きさ（長いほど高い）
ok(MPL.size({ kind: 'learned', text: ['あ', 'あ'], scene: { text: 'い' } }, 'made').h < MPL.size({ kind: 'learned', text: [new Array(60).join('あ'), 'あ'], scene: { text: 'い' } }, 'made').h, 'size 長い言葉ほど箱が高い');
eq(MPL.lineCount('', 13, 100), 0, 'lineCount 空は 0 行');

// ---------- MPC（§AB-2 / AB-3-1）: 倍率・基点不動・全体・LOD ----------
eq([MPC.clampZoom(0.1), MPC.clampZoom(5), MPC.clampZoom(1.3), MPC.clampZoom(NaN), MPC.clampZoom('x')], [0.3, 2, 1.3, 1, 1], 'clampZoom ふだんは 0.3〜2.0（壊れた値は 1）');
eq([MPC.clampZoom(0.05, 0.12), MPC.clampZoom(0.2, 0.12), MPC.clampZoom(0.01, 0.01), MPC.clampZoom(0.2, 0.9)], [0.12, 0.2, 0.1, 0.3], 'clampZoom 枠ごとの下限（床 0.1・0.3 より上にはしない）');
// 倍率の下限 = min(0.3, 全体が入る倍率)（床 0.1）
eq([MPC.minZoom({ x: 0, y: 0, w: 1000, h: 500 }, 1040, 540, 20), MPC.minZoom({ x: 0, y: 0, w: 3000, h: 1500 }, 640, 340, 20), MPC.minZoom({ x: 0, y: 0, w: 30000, h: 100 }, 340, 340, 20)], [0.3, 0.2, 0.1], 'minZoom = min(0.3, 全体が入る倍率)・床 0.1');
function worldAt(v, px, py) { return { x: (px - v.x) / v.z, y: (py - v.y) / v.z }; }
[[{ x: 10, y: -20, z: 0.5 }, 1.6, 300, 200], [{ x: -400, y: 30, z: 1.2 }, 0.7, 50, 420], [{ x: 0, y: 0, z: 1 }, 100, 640, 360], [{ x: 5, y: 5, z: 0.4 }, 0.01, 10, 10]].forEach(function (c, i) {
  var v = c[0], nv = MPC.zoomAt(v, c[1], c[2], c[3]), a = worldAt(v, c[2], c[3]), b = worldAt(nv, c[2], c[3]);
  ok(near(a.x, b.x, 1e-9) && near(a.y, b.y, 1e-9) && nv.z >= 0.3 && nv.z <= 2, 'zoomAt 基点が動かない（' + i + ': z ' + v.z + ' → ' + nv.z + '）');
});
eq(MPC.zoomAt({ x: 0, y: 0, z: 2 }, 1.5, 100, 100), { x: 0, y: 0, z: 2 }, 'zoomAt 上限では動かない');
var zl = MPC.zoomAt({ x: 10, y: 20, z: 0.3 }, 0.5, 200, 100, 0.18), zw0 = worldAt({ x: 10, y: 20, z: 0.3 }, 200, 100), zw1 = worldAt(zl, 200, 100);
ok(zl.z === 0.18 && near(zw0.x, zw1.x, 1e-9) && near(zw0.y, zw1.y, 1e-9), 'zoomAt 枠の下限まで（0.3 より下も基点不動）');
var bd = { x: 0, y: 0, w: 2000, h: 1000 }, fv = MPC.fit(bd, 1000, 600, 20);
ok(near(fv.z, 0.48) && near(fv.x, 20) && near(fv.y, 60), 'fit 全体が入る倍率で真ん中（' + JSON.stringify(fv) + '）');
var fs1 = MPC.fit({ x: 0, y: 0, w: 3600, h: 3000 }, 400, 400, 20);
ok(near(fs1.z, 0.1) && fs1.x >= 20 - 1e-9 && fs1.y >= 20 - 1e-9 && near(fs1.x + 3600 * fs1.z / 2, 200) && near(fs1.y + 3000 * fs1.z / 2, 200), 'fit 狭い枠でも全体が入る（0.3 より下げる）・真ん中（' + JSON.stringify(fs1) + '）');
var fs2 = MPC.fit({ x: 0, y: 0, w: 40000, h: 3000 }, 400, 400, 20);
ok(fs2.z === 0.1 && near(fs2.x + 40000 * 0.1 / 2, 200), 'fit 床 0.1 でも入らない時だけ はみ出して真ん中');
eq(MPC.fit({ x: 0, y: 0, w: 100, h: 50 }, 1000, 600, 20).z, 2, 'fit 小さい地図は 2.0 まで');
eq([MPC.lod(0.3), MPC.lod(0.5999), MPC.lod(0.6), MPC.lod(1.0999), MPC.lod(1.1), MPC.lod(2)], ['far', 'far', 'mid', 'mid', 'near', 'near'], 'lod の境界（far < 0.6 ≦ mid < 1.1 ≦ near）');
var cv = MPC.clampView({ x: 5000, y: -9000, z: 1 }, bd, 800, 600, 80);
ok(cv.x === 800 - 80 && cv.y === 80 - 1000, 'clampView 地図を枠から全部はみ出させない');
var rv = MPC.reveal({ x: 0, y: 0, z: 1 }, { x: 900, y: 100, w: 100, h: 50 }, 800, 600, { l: 16, t: 16, r: 16, b: 16 });
ok(rv.x === 800 - 16 - 1000 && rv.y === 0, 'reveal はみ出したノードを枠の中へ（少しだけ動かす）');
eq(MPC.reveal({ x: 0, y: 0, z: 1 }, { x: 100, y: 100, w: 50, h: 50 }, 800, 600), { x: 0, y: 0, z: 1 }, 'reveal 見えていれば動かさない');
var cn = MPC.center({ x: 0, y: 0, z: 0.5 }, { x: 1000, y: 400, w: 200, h: 100 }, 1100, 500, { r: 360 });
ok(near((1100 + 200 * 0.5) * 0, 0) && near(cn.x + 1100 * 0.5, (1100 - 360) / 2) && near(cn.y + 450 * 0.5, 250) && cn.z === 0.5, 'center パネルを除いた見える範囲の真ん中へ（倍率は変えない）（' + JSON.stringify(cn) + '）');
// 逆に拡大した題の間引き（決定論・先に並べたもの = 新しいものを残す）
var TH = [{ id: 'a', ax: 100, ay: 100, w: 120, h: 20, align: 'center' }, { id: 'b', ax: 300, ay: 100, w: 120, h: 20, align: 'center' }, { id: 'c', ax: 1000, ay: 100, w: 120, h: 20, align: 'center' }, { id: 'isl', ax: 0, ay: 400, w: 100, h: 18, align: 'left' }];
eq(MPC.thin(TH, 1), [], 'thin 重ならなければ間引かない');
eq(MPC.thin(TH, 0.7), [], 'thin 倍率 0.7 でも離れていれば残す');
eq(MPC.thin(TH, 0.25), ['b'], 'thin 重なったら後ろ（古い方）を間引く');
eq(JSON.stringify(MPC.thin(TH, 0.12)) === JSON.stringify(MPC.thin(TH, 0.12)), true, 'thin 決定論');
eq(MPC.thin(TH, 0.12).indexOf('a'), -1, 'thin いちばん先（新しいもの）は必ず残る');
var LT = MPL.layout(g, 'made'), titles = g.nodes.made.map(function (m) { var b = LT.nodes[m.id]; return { id: m.id, ax: b.x + b.w / 2, ay: b.y + 110, w: 150, h: 2 * 13 * 1.3 + 2, align: 'center' }; });
eq(MPC.thin(titles, 0.3), [], 'thin 見本の作ったものから: 倍率 0.3 では題を間引かない（並びの間合い）');
ok(MPC.thin(titles, 0.1).length > 0 && MPC.thin(titles, 0.1).indexOf(g.nodes.made[0].id) < 0, 'thin 見本: 倍率 0.1 では古い題を間引き、いちばん新しい題は残す');

// ---------- MP.normalizeUi（§AB-13）/ select / decline ----------
var D = MP.defaultUi();
eq(D, { view: 'made', sel: { made: null, flow: null, fields: null, concepts: null, list: null }, chips: { next: false }, declined: [], declinedNext: [], pos: { made: null, fields: null }, big: false, only: false, concept: null, moved: { made: {}, fields: {} } }, 'normalizeUi 初期値（AD-9: チップは これから作れそう 1 つで off・大きく見る / 作ったものだけ は off・考え方なし・動かした分なし）');
eq(MP.normalizeUi(null, g), D, 'normalizeUi 無い = 初期値（選択なし = 静かな初期表示）');
[5, 'x', [1, 2], { view: 3, sel: 'a', chips: [], declined: 'x', declinedNext: {}, pos: 7, big: 'yes', only: 1, concept: 3, moved: 'x' }, { concept: 'c-zz', moved: { made: [1], fields: 'a' } }].forEach(function (raw, i) {
  eq(MP.normalizeUi(raw, g), D, 'normalizeUi 壊れた値は初期値（' + i + '）');
});
var good = { view: 'fields', sel: { made: 'ln:ln-area', flow: 'unit:M4-C-01', fields: 'unit:J4-C-02', concepts: 'unit:S4-A-01', list: 'next:nx-lamp' }, chips: { next: true }, declined: ['ln-cuboid'], declinedNext: ['nx-moon-haiku'], pos: { made: { x: 10, y: 20, z: 0.5 }, fields: { x: -5, y: 0, z: 1.25 } }, big: true, only: true,
  concept: 'c-change', moved: { made: { 'past:past-box': { dx: 120, dy: -48 } }, fields: { 'act:act-py': { dx: -24, dy: 0 } } } };
eq(MP.normalizeUi(good, g), good, 'normalizeUi 正しい値は保つ');
eq(MP.normalizeUi({ sel: { made: 'unit:J4-C-02', flow: 'unit:J4-C-02', fields: 'ln:ln-area', list: 'zzz' } }, g).sel, { made: null, flow: null, fields: null, concepts: null, list: null }, 'normalizeUi その見方に無いノードの選択は null');
eq(MP.normalizeUi({ sel: 'act:act-py' }, g).sel, { made: 'act:act-py', flow: null, fields: null, concepts: null, list: null }, 'normalizeUi §Y の形（文字列）は 作ったものから の選択');
eq(MP.normalizeUi({ chips: { peer: 'yes', next: 1, zzz: true } }, g).chips, { next: false }, 'normalizeUi チップは真偽値だけ（その欄だけ初期値）');
eq(MP.normalizeUi({ chips: { peer: true, cross: true, order: true, next: true } }, g).chips, { next: true }, 'AC-13 / AD-1 / AD-9 保存済みの chips.peer・cross・order は読み捨てる');
eq([MP.normalizeUi({ view: 'flow', sel: { flow: 'ln:ln-area' } }, g).view, MP.normalizeUi({ view: 'flow', sel: { flow: 'ln:ln-area' } }, g).sel.flow], ['flow', 'ln:ln-area'], 'AC-9 normalizeUi は view:flow・sel.flow を受ける');
eq([MP.normalizeUi({ big: true, only: true }, g).big, MP.normalizeUi({ big: true, only: true }, g).only, MP.normalizeUi({ big: 'true', only: 'x' }, g).big, MP.normalizeUi({ big: 'true', only: 'x' }, g).only], [true, true, false, false], 'AC-9 / AC-14 normalizeUi big・only は真偽値だけ（形が違えば false）');
eq(MP.select(D, g, 'flow', 'unit:M4-C-01').sel.flow, 'unit:M4-C-01', 'select 流れで見るの選択は sel.flow');
eq(MP.normalizeUi({ declined: ['ln-area', 'zz', 'ln-area', 3, 'ln-stars', 'ln-maze-wall'] }, null).declined, ['ln-area', 'ln-maze-wall'], 'normalizeUi declined はバディの見立てだけ・重なりなし');
eq(MP.normalizeUi({ declinedNext: ['nx-lamp', 'nx-zz', 'nx-lamp'] }, null).declinedNext, ['nx-lamp'], 'normalizeUi declinedNext は見本にあるものだけ');
eq(MP.normalizeUi({ pos: { made: { x: 1, y: 2, z: 9 }, fields: { x: 'a', y: 0, z: 1 } } }, null).pos, { made: null, fields: null }, 'normalizeUi 表示位置は 倍率 0.1〜2.0・数だけ');
eq(MP.normalizeUi({ pos: { made: { x: 1, y: 2, z: 0.15 }, fields: { x: 0, y: 0, z: 0.05 } } }, null).pos, { made: { x: 1, y: 2, z: 0.15 }, fields: null }, 'normalizeUi 狭い枠で保存した 0.3 未満の倍率も保つ（床 0.1）');
eq(MP.normalizeUi({ declined: ['p1'] }, null, { learned: [{ id: 'p1', src: 'person' }] }).declined, [], 'normalizeUi 人の言葉も外さない');
// 表示位置の帳簿（再レビュー 2）: 作ったもので動かす → 200ms 以内に分野でも動かして保存に成功 → 作ったもので動かして保存に失敗 → 最後に保存できた位置（分野と一緒に書かれた位置）へ戻る
var P0 = { made: { x: -100, y: -50, z: 0.6 }, fields: null };
var led = MP.posSettle(null, P0, true).ok;
eq(led, P0, 'posSettle 始まり = いまの保存値');
var cur1 = { made: { x: -400, y: -120, z: 0.8 }, fields: { x: -30, y: -20, z: 0.5 } };
var s1p = MP.posSettle(led, cur1, true);
eq(s1p.ok, cur1, 'posSettle 保存に成功 → 全部の見方のいまの位置が「保存できた位置」（別の見方の保存で一緒に書かれた位置も）');
var cur2 = { made: { x: -900, y: -300, z: 1.2 }, fields: { x: -30, y: -20, z: 0.5 } };
var f1 = MP.posSettle(s1p.ok, cur2, false);
eq([f1.cur.made, f1.cur.fields, f1.ok], [{ x: -400, y: -120, z: 0.8 }, { x: -30, y: -20, z: 0.5 }, s1p.ok], 'posSettle 保存に失敗 → 最後に保存できた位置へ戻す（古い位置へは戻らない）');
eq(MP.posSettle({ made: 'x', fields: 3 }, null, false), { ok: { made: null, fields: null }, cur: { made: null, fields: null } }, 'posSettle 壊れた値は null');
ok(MP.posSettle(led, cur1, true).ok.made !== cur1.made, 'posSettle 写しを返す（いまの位置を後で書き換えても帳簿は変わらない）');
// いま効いている選択: グラフに無い id（保存値が古い）は選択なし（全部を薄くしない）
eq([MP.selIn({ sel: { made: 'act:missing' } }, g, 'made'), MP.selIn({ sel: { made: 'act:act-py' } }, g, 'made'), MP.selIn({ sel: { fields: 'ln:ln-area' } }, g, 'fields'), MP.selIn(null, g, 'made')],
  [null, 'act:act-py', null, null], 'selIn グラフに無い・その見方に無い選択は「選択なし」');
var s1 = MP.select(D, g, 'made', 'act:act-py');
eq(s1.sel.made, 'act:act-py', 'select 選ぶ');
eq(MP.select(s1, g, 'made', 'act:act-py').sel.made, null, 'select 同じノードをもう一度 = 外す');
eq(MP.select(s1, g, 'fields', 'unit:M4-C-02').sel, { made: 'act:act-py', flow: null, fields: 'unit:M4-C-02', concepts: null, list: null }, 'select 見方ごとの選択');
eq(MP.select(s1, g, 'fields', 'ln:ln-area').sel.fields, null, 'select その見方に無いノードは選ばない');
eq(MP.deselect(s1, g, 'made').sel.made, null, 'deselect 外す');
var d1 = MP.decline({ sel: { made: 'ln:ln-area' } }, g, 'made', 'ln:ln-area');
eq([d1.declined, d1.sel.made], [['ln-area'], 'act:act-build'], 'decline バディの見立てを外す → 選択はその作ったもの');
eq(MP.decline({}, g, 'made', 'ln:ln-stars'), null, 'decline 本人の言葉は外さない');
eq(MP.decline({}, g, 'made', 'ln:ln-poster-one'), null, 'decline 人の言葉は外さない');
eq(MP.decline({}, g, 'made', 'unit:M4-B-03'), null, 'decline 単元は外さない');
var u1 = MP.undecline(d1, 'made', 'ln-area', 'act:act-build');
eq([u1.declined, u1.sel.made], [[], 'act:act-build'], 'undecline 元に戻す（選択は外す前に）');
var dn1 = MP.declineNext({ sel: { made: 'next:nx-lamp' } }, g, 'made', 'next:nx-lamp');
eq([dn1.declinedNext, dn1.sel.made], [['nx-lamp'], null], 'declineNext 地図から外す');
eq(MP.declineNext({}, g, 'made', 'act:act-py'), null, 'declineNext これから作れそう以外は外さない');
eq(MP.undeclineNext(dn1, 'made', 'nx-lamp', 'next:nx-lamp').declinedNext, [], 'undeclineNext 元に戻す');

// ---------- 概念で見る（§AD-2〜AD-4）: MPD.concepts / MP.conceptView / conceptNodes / conceptLines ----------
var CC = MPD.concepts;
ok(CC.length >= 5 && CC.length <= 7, 'AD-3 考え方 5〜7（' + CC.length + '）');
var ccIds = CC.map(function (c) { return c.id; });
eq(ccIds.filter(function (x, i) { return ccIds.indexOf(x) !== i; }), [], 'AD-3 考え方の id が重ならない');
CC.forEach(function (c) {
  ok(pair(c.name) && pair(c.line), 'AD-3 ' + c.id + ' の名前・1 行は [中, 小]');
  ok(Object.keys(c).every(function (k) { return ['id', 'name', 'line', 'learned', 'units'].indexOf(k) >= 0; }), 'AD-3 ' + c.id + ' は { id, name, line, learned, units }（数・割合・達成を持たない）');
  ok(c.learned.every(function (id) { return !!MPD.learnedDef(id); }), 'AD-3 ' + c.id + ' の学んだことは見本にある');
  ok(c.units.length >= 2 && c.units.every(function (u) { return !!MPD.anyUnit(u.id) && pair(u.why) && (u.via === undefined || (!!MPD.anyUnit(u.via) && c.units.some(function (x) { return x.id === u.via; }))); }), 'AD-3 ' + c.id + ' の単元は見本にあり「なぜ同じ考え方か」[中, 小]（via は同じ考え方の単元）');
  ok(c.learned.every(function (id) { return MPD.learnedDef(id).units.some(function (code) { return c.units.some(function (u) { return u.id === code; }); }); }), 'AD-3 ' + c.id + ' の学んだことは、その考え方の単元につながる（実際に当てはまる）');
  ok(!/概念/.test(strings([c.name, c.line, c.units], []).join('')), 'AD-3 ' + c.id + ' のカード・説明では「概念」と言わない');
});
// 旧「教科をまたぐ」10 本の文は概念のデータへそのまま移した（二重に持たない）
var OLD_CROSS = ['電池の数と明るさも、2 つの量の変わり方', '気温の変わり方は、折れ線グラフにすると見やすい', '表に分けて整理すると、比べやすくなる', '地図の上の広さも、面積で比べられる', '町で使う水の量は、大きな数で表す',
  '雨の量は 2.5 mm のように小数で表す', '月の高さは、角度で表せる', '季節の生き物は、俳句の季語にもなる', '大雨の水の流れ方を知ると、災害にそなえられる', '調べた地域のよさを、話して伝える'];
var whys = [];
CC.forEach(function (c) { c.units.forEach(function (u) { whys.push(u.why[0]); }); });
eq(OLD_CROSS.filter(function (w) { return whys.indexOf(w) < 0; }), [], 'AD-1 旧 教科をまたぐ の文 10 本は すべて概念のデータにある');
eq(OLD_CROSS.filter(function (w) { return whys.filter(function (x) { return x === w; }).length !== 1; }), [], 'AD-1 旧 教科をまたぐ の文は 1 回ずつ（二重に持たない）');
ok(dataSrc0.indexOf('教科をまたぐ') < 0 || !/kind: 'cross'/.test(fs.readFileSync(path.join(__dirname, '../app-v3/js/map-data.js'), 'utf8')), 'AD-1 map-data.js に kind:cross のデータが無い');
eq(CC.filter(function (c) { return !c.learned.length; }).length >= 1, true, 'AD-2 やったことの無い考え方の見本がある');
// conceptView: やったことの教科で 近い / 遠い を分ける
var cvc = MP.conceptView(g, CC, 'c-change');
eq(cvc.did, ['ln:ln-stars', 'ln:ln-speed', 'ln:ln-battery', 'ln:ln-rain-graph', 'ln:ln-bead-repeat', 'ln:ln-moon-frames'].filter(function (id) { return cvc.did.indexOf(id) >= 0; }).length === 6 ? cvc.did : null, 'conceptView ともなって変わる: やったこと 6');
eq(cvc.did, g.nodes.learned.map(function (l) { return l.id; }).filter(function (id) { return cvc.did.indexOf(id) >= 0; }), 'conceptView やったことはグラフの順（作ったものの新しい順）');
eq([cvc.near, cvc.far, cvc.mixed], [['unit:M4-C-01', 'unit:M4-D-02', 'unit:S4-A-01', 'unit:S4-B-04', 'unit:S4-A-03'], ['unit:J4-C-02', 'unit:C4-B-02'], false], 'conceptView 近い = やったことの教科（算数・理科）/ 遠い = 別の教科（国語・社会）');
var cvm = MP.conceptView(g, CC, 'c-measure');
eq([cvm.near, cvm.far], [['unit:M4-B-03', 'unit:M4-A-04', 'unit:M4-A-01', 'unit:M4-A-02', 'unit:M4-B-04'], ['unit:C4-A-01', 'unit:C4-B-01', 'unit:S4-B-04', 'unit:S4-B-05']], 'conceptView はかって数で表す: やったことが算数だけ → 理科・社会は遠い');
CC.forEach(function (c) {
  var v = MP.conceptView(g, CC, c.id), all = v.near.concat(v.far);
  eq(all.slice().sort(), c.units.map(function (u) { return 'unit:' + u.id; }).sort(), 'conceptView ' + c.id + ' 近い + 遠い = その考え方の単元すべて（1 回ずつ）');
  var subs = {};
  v.did.forEach(function (lid) { MP.nodeById(g, lid).units.forEach(function (code) { subs[MPD.anyUnit(code).sub] = 1; }); });
  ok(v.near.every(function (id) { return v.mixed || subs[MPD.anyUnit(id.slice(5)).sub]; }) && v.far.every(function (id) { return !subs[MPD.anyUnit(id.slice(5)).sub]; }), 'conceptView ' + c.id + ' 近い・遠いは教科で分ける');
  eq(JSON.stringify(MP.conceptView(g, CC, c.id)), JSON.stringify(v), 'conceptView ' + c.id + ' 決定論');
});
var cvw = MP.conceptView(g, CC, 'c-whole');
eq([cvw.did, cvw.far, cvw.mixed, cvw.near.length], [[], [], true, 5], 'conceptView やったことの無い考え方 = mixed（中にまとめる・遠いは空）');
// 見立てを外すと、やったことから外れる
var gd = MP.graph(MPD.learned, acts, works, ['ln-box-right', 'ln-maze-wall'], OPT), cvd = MP.conceptView(gd, CC, 'c-shape');
eq(cvd.did, ['ln:ln-cuboid', 'ln:ln-maze-turn', 'ln:ln-box-net'].filter(function (id) { return cvd.did.indexOf(id) >= 0; }).length === 3 ? cvd.did : null, 'conceptView 外した見立ては やったことに入らない');
var gx2 = MP.graph(MPD.learned, acts, works, [], { today: '11/2', next: [{ id: 'nx-q', title: ['q', 'q'], learned: ['ln-area'], units: ['M4-A-05'], line: ['q', 'q'] }] });
eq(MP.conceptView(gx2, CC, 'c-whole').next, ['next:nx-q'], 'conceptView やったことの無い考え方は、その単元につながる これから作れそう を出す');
eq(MP.conceptView(g, CC, 'c-change').next, [], 'conceptView やったことがある時は これから作れそう を出さない');
eq(MP.conceptView(g, CC, 'nope'), { did: [], near: [], far: [], mixed: false, next: [] }, 'conceptView 無い考え方');
eq(MP.conceptView(null, CC, 'c-change').did, [], 'conceptView グラフが無い');
eq(MP.conceptView(g, [{ id: 'cz', name: ['z', 'z'], line: ['z', 'z'], learned: ['ln-nope', 'ln-area'], units: [{ id: 'ZZ-1', why: ['z', 'z'] }, { id: 'M4-B-03', why: ['z', 'z'] }, { id: 'M4-B-03', why: ['z', 'z'] }] }], 'cz'),
  { did: ['ln:ln-area'], near: ['unit:M4-B-03'], far: [], mixed: false, next: [] }, 'conceptView 存在しない id は落とす・重なりは 1 つに');
// conceptNodes / conceptLines
var cn = MP.conceptNodes(g, CC, 'c-change');
ok(cn['ln:ln-stars'] && cn['act:act-py'] && cn['unit:J4-C-02'] && !cn['ln:ln-area'] && !cn['unit:M4-B-03'], 'conceptNodes = やったこと・その作ったもの・近い・遠い だけ');
var cl = MP.conceptLines(g, CC, 'c-change'), clIds = cl.map(function (e) { return e.from + '>' + e.to; });
ok(clIds.indexOf('ln:ln-stars>unit:M4-C-01') >= 0 && clIds.indexOf('ln:ln-battery>unit:S4-A-01') >= 0 && clIds.indexOf('unit:M4-C-01>unit:J4-C-02') >= 0 && clIds.indexOf('unit:M4-C-01>unit:C4-B-02') >= 0, 'conceptLines やったこと → 単元 / 近い → 遠い（via）');
ok(cl.every(function (e) { return cn[e.from] && cn[e.to] && e.from !== e.to; }) && clIds.filter(function (x, i) { return clIds.indexOf(x) !== i; }).length === 0, 'conceptLines 両端は帯に出ているもの・重ならない');
ok(cl.every(function (e) { var a = cvc.near.indexOf(e.from) >= 0, b = cvc.far.indexOf(e.to) >= 0; return /^ln:/.test(e.from) ? (cvc.near.indexOf(e.to) >= 0 || cvc.far.indexOf(e.to) >= 0) : (a && b); }), 'conceptLines 左 → 右だけ（同じ列の中の線は無い）');
CC.forEach(function (c) { var v = MP.conceptView(g, CC, c.id); ok(v.mixed || v.far.every(function (id) { return MP.conceptLines(g, CC, c.id).some(function (e) { return e.to === id; }); }), 'conceptLines ' + c.id + ' 遠いところの単元にはどれも線が届く'); });
eq(MP.conceptLines(g, CC, 'c-whole'), [], 'conceptLines やったことの無い考え方（これからも無い）は線なし');
eq(MP.conceptLines(gx2, CC, 'c-whole').map(function (e) { return e.from + '>' + e.to; }), ['next:nx-q>unit:M4-A-05'], 'conceptLines やったことが無い時は これから → 単元');
// normalizeUi（AD-4）
eq(MP.viewNodes(g, 'concepts')['unit:M4-C-02'] && MP.viewNodes(g, 'concepts')['ln:ln-area'], true, 'viewNodes 概念で見る = 全単元・学んだこと');
eq([MP.normalizeUi({ view: 'concepts' }, g).view, MP.normalizeUi({ concept: 'c-sort' }, g).concept, MP.normalizeUi({ concept: 'c-zz' }, g).concept, MP.normalizeUi({ concept: 7 }, g).concept], ['concepts', 'c-sort', null, null], 'AD-4 normalizeUi は view:concepts・concept（見本にある考え方だけ）を受ける');
eq(MP.normalizeUi({ concept: 'c-change', sel: { concepts: 'unit:J4-C-02' } }, g).sel.concepts, 'unit:J4-C-02', 'AD-4 normalizeUi は sel.concepts を受ける');
eq([MP.normalizeUi({ concept: 'c-change', sel: { concepts: 'unit:M4-B-03' } }, g).sel.concepts, MP.normalizeUi({ sel: { concepts: 'unit:J4-C-02' } }, g).sel.concepts], [null, null], 'AD-4 sel.concepts は選んでいる考え方の帯に出ているものだけ（考え方なし = 選択なし）');
eq(MP.normalizeUi({ concept: 'c-change', sel: { concepts: 'unit:M4-B-03' } }, null).sel.concepts, 'unit:M4-B-03', 'AD-4 グラフなしでは形だけ見る（読み込み時）');
eq(MP.select(MP.normalizeUi({ concept: 'c-change' }, g), g, 'concepts', 'unit:S4-A-01').sel.concepts, 'unit:S4-A-01', 'select 概念で見るの選択は sel.concepts');

// ---------- 作ったものを自分で並べる（§AD-5）: MP.normalizeMoved / moveTargets / applyMoved ----------
eq(MP.normalizeMoved({ 'act:act-py': { dx: 10.04, dy: -5 }, 'ln:ln-area': { dx: 1, dy: 1 }, 'past:past-box': { dx: 'a', dy: 1 }, 'past:past-maze': { dx: 9999, dy: -9999 }, 'past:past-moon': { dx: 0, dy: 0 }, 'act:zz': { dx: 1, dy: 2 } }, null),
  { 'act:act-py': { dx: 10, dy: -5 }, 'past:past-maze': { dx: 4000, dy: -4000 }, 'act:zz': { dx: 1, dy: 2 } }, 'AD-5 normalizeMoved 作ったものの id・数だけ・±4000・動いていないものは捨てる');
eq(Object.keys(MP.normalizeMoved({ 'act:act-py': { dx: 1, dy: 2 }, 'act:zz': { dx: 1, dy: 2 } }, g)), ['act:act-py'], 'AD-5 normalizeMoved グラフに無い id は捨てる');
eq(MP.normalizeUi({ moved: { made: { 'past:past-box': { dx: 5, dy: 6 } }, fields: 3, list: { 'act:act-py': { dx: 1, dy: 1 } } } }, g).moved, { made: { 'past:past-box': { dx: 5, dy: 6 } }, fields: {} }, 'AD-5 normalizeUi moved は 作ったものから / 分野で見る だけ（壊れた見方は空）');
var LM = MPL.layout(g, 'made'), LF = MPL.layout(g, 'fields');
eq(MP.moveTargets(g, 'past:past-box', LM), ['past:past-box', 'ln:ln-box-net', 'ln:ln-box-right', 'ln:ln-box-coins'], 'AD-5 moveTargets 作ったものから = その作ったもの + その学んだこと');
eq(MP.moveTargets(g, 'past:past-box', LF), ['past:past-box'], 'AD-5 moveTargets 分野で見る = 作ったものだけ');
eq([MP.moveTargets(g, 'unit:M4-B-03', LM), MP.moveTargets(g, 'ln:ln-area', LM), MP.moveTargets(g, 'next:nx-lamp', LM)], [[], [], []], 'AD-5 moveTargets 単元・学んだこと・これからは つかめない');
var LMm = MP.applyMoved(LM, { 'past:past-box': { dx: 100, dy: -40 } }, g), movedIds = Object.keys(LM.nodes).filter(function (id) { return LM.nodes[id].x !== LMm.nodes[id].x || LM.nodes[id].y !== LMm.nodes[id].y; });
eq(movedIds.sort(), ['ln:ln-box-coins', 'ln:ln-box-net', 'ln:ln-box-right', 'past:past-box'], 'AD-5 applyMoved 作ったものと その学んだことだけが動く（単元・橋・これからは動かない）');
ok(movedIds.every(function (id) { return LMm.nodes[id].x === LM.nodes[id].x + 100 && LMm.nodes[id].y === LM.nodes[id].y - 40; }), 'AD-5 applyMoved 同じ分だけ動く');
eq(JSON.stringify(MPL.layout(g, 'made')), JSON.stringify(LM), 'AD-5 applyMoved は並びの計算（MPL.layout）を変えない');
var far1 = MP.applyMoved(LM, { 'past:past-box': { dx: -4000, dy: 4000 } }, g), fb = far1.bounds, bx = far1.nodes['past:past-box'];
ok(fb.x <= bx.x - 60 && fb.y + fb.h >= bx.y + bx.h + 60 && fb.x + fb.w >= LM.bounds.w && Object.keys(far1.nodes).every(function (id) { return MPL.inside(far1.nodes[id], fb); }), 'AD-5 applyMoved 全体の範囲は動かした後のノードまで広がる（全体を見る用）');
eq(MP.applyMoved(LM, {}, g).bounds, LM.bounds, 'AD-5 applyMoved 動かしていなければ範囲は同じ');
eq(MP.applyMoved(LM, { 'unit:M4-B-03': { dx: 5, dy: 5 }, 'act:zz': { dx: 5, dy: 5 } }, g).nodes, LM.nodes, 'AD-5 applyMoved 作ったもの以外・無い id は動かさない');
var FFm = MP.applyMoved(LF, { 'act:act-py': { dx: -24, dy: 48 } }, g);
ok(FFm.nodes['act:act-py'].x === LF.nodes['act:act-py'].x - 24 && FFm.nodes['unit:M4-C-01'].x === LF.nodes['unit:M4-C-01'].x && JSON.stringify(FFm.islands) === JSON.stringify(LF.islands), 'AD-5 applyMoved 分野で見る = 作ったものだけ（島・単元は動かない）');
eq(JSON.stringify(MP.applyMoved(LM, { 'past:past-box': { dx: 100, dy: -40 } }, g)), JSON.stringify(LMm), 'AD-5 applyMoved 決定論');
eq(MPC.MOVE_STEP, 24, 'AD-5 Shift + 矢印は地図の座標で 24px');

// ---------- MP.unitLinks（単元の詳細） ----------
eq(MP.unitLinks(g, 'M4-C-01').map(function (x) { return [x.learned.id, x.made.id]; }), [['ln:ln-stars', 'act:act-py'], ['ln:ln-speed', 'act:act-py'], ['ln:ln-bead-repeat', 'past:past-beads'], ['ln:ln-moon-frames', 'past:past-moon']], 'unitLinks 変わり方 ← 学んだこと ← 作ったもの');
eq(MP.unitLinks(g, 'M4-A-05'), [], 'unitLinks つながりの無い単元 = []');

// ---------- 文言（§Y-7 / §AB-14）: key が i18n.js に [中, 小] である・禁止語なし ----------
var i18n = fs.readFileSync(path.join(__dirname, '../app-v3/js/i18n.js'), 'utf8');
var mapSrc = fs.readFileSync(path.join(__dirname, '../app-v3/js/map.js'), 'utf8');
var dataSrc = fs.readFileSync(path.join(__dirname, '../app-v3/js/map-data.js'), 'utf8');
var layoutSrc = fs.readFileSync(path.join(__dirname, '../app-v3/js/map-layout.js'), 'utf8');
var canvasSrc = fs.readFileSync(path.join(__dirname, '../app-v3/js/map-canvas.js'), 'utf8');
var cssSrc = fs.readFileSync(path.join(__dirname, '../app-v3/css/map.css'), 'utf8');
var keys = { mp_in_map: true, mp_kind_act: true, mp_kind_work: true, mp_kind_learned: true, mp_kind_unit: true, mp_kind_next: true, mp_tab_links: true, mp_tab_basics: true,
  mp_view_made: true, mp_view_flow: true, mp_view_fields: true, mp_view_concepts: true, mp_view_list: true, mp_k_order: true, mp_k_next: true, mp_big: true, mp_big_off: true, mp_only: true };
mapSrc.replace(/\bT\('([a-z_]+)'/g, function (all, k) { if (!/_$/.test(k)) keys[k] = true; return all; });
var missing = Object.keys(keys).filter(function (k) { return !new RegExp('\\n\\s+' + k + ": \\['[^']+', '[^']+'\\]").test(i18n); });
eq(missing, [], 'AB-14 使う key が i18n.js に [中, 小] である');
ok(/mp_in_map/.test(fs.readFileSync(path.join(__dirname, '../app-v3/js/works.js'), 'utf8')), 'Y-8 作品の詳細に「学びマップで見る」');
var mpLines = i18n.split('\n').filter(function (l) { return /^\s+mp_/.test(l); });
var allKeys = i18n.split('\n').filter(function (l) { return /^\s+[a-z_]+: \[/.test(l); });
var firstMp = -1; allKeys.forEach(function (l, i) { if (firstMp < 0 && /^\s+mp_/.test(l)) firstMp = i; });
var mpRun = firstMp < 0 ? [] : allKeys.slice(firstMp, firstMp + mpLines.length);
ok(mpRun.length === mpLines.length && mpRun.every(function (l) { return /^\s+mp_/.test(l); }), 'Y-8 学びマップの key は辞書の 1 か所にまとまっている');
var BAD = /点数|ランキング|順位|評価|成績|レベル|集中力|得意|苦手|上手|成長|頑張|すごい|まだ|未|理解した|身についた|版|おすすめ|達成/;
eq(mpLines.filter(function (l) { return BAD.test(l); }), [], 'AB-14 学びマップの文言に禁止語・「まだ」「未」「版」・おすすめ・達成が無い');
function strings(v, out) {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach(function (x) { strings(x, out); });
  else if (v && typeof v === 'object') Object.keys(v).forEach(function (k) { strings(v[k], out); });
  return out;
}
eq(strings([MPD.units, MPD.extUnits, MPD.areas, MPD.otherAreas, MPD.subjects, MPD.learned, MPD.past, MPD.unitLinks, MPD.next], []).filter(function (s) { return BAD.test(s); }), [], 'AB-14 単元・前に作ったもの・学んだこと・つながり・これからに禁止語が無い');
eq([mapSrc, dataSrc, layoutSrc, canvasSrc, cssSrc].filter(function (s) { return /まだ|理解した|身についた/.test(s); }).length, 0, 'Y-11 map*.js / map.css に「まだ」「理解した」「身についた」が無い');
ok(!/Math\.random|Date\.now|new Date|performance\.now/.test(layoutSrc + canvasSrc + dataSrc), 'AB-12 並び・動かし方・中身に乱数と時刻を使わない');
ok(/touch-action:none/.test(cssSrc) && /aria-live/.test(mapSrc) && /pointer-events:none/.test(cssSrc), 'AB-2 枠は touch-action:none・詳細の見出しは aria-live・線は pointer-events:none');
ok(!/k-peer|'peer'/.test(mapSrc.split('ここから下はブラウザ専用')[1] || "'peer'") && !/k-peer/.test(cssSrc), 'AC-13 画面の作り（チップ・凡例・線）に 作ったものどうし が無い');
var shellI18n = ['nav_rail_close', 'nav_rail_open'].filter(function (k) { return !new RegExp('\\n\\s+' + k + ": \\['[^']+', '[^']+'\\]").test(i18n); });
eq(shellI18n, [], 'AC-10 メニューを閉じる / 開く の key が [中, 小]');
ok(/mp_big: \['大きく見る', '大きく 見る'\]/.test(i18n) && /mp_big_off: \['もとの大きさ', 'もとの 大きさ'\]/.test(i18n) && /mp_view_flow: \['流れで見る', 'ながれで 見る'\]/.test(i18n) && /nav_rail_close: \['メニューを閉じる', 'メニューを とじる'\]/.test(i18n) && /nav_rail_open: \['メニューを開く', 'メニューを ひらく'\]/.test(i18n) && /mp_only: \['作ったものだけ', '作ったものだけ'\]/.test(i18n), 'AC-10 / AC-14 文言は契約どおり');
ok(/stroke-dasharray:7 5/.test(cssSrc) && !/k-cross|k-order/.test(cssSrc) && !/k-cross|k-order|mp_k_cross/.test(mapSrc), 'AB-3 / AD-1 / AD-9 線の形は 基本 = 実線・これから = 破線（教科をまたぐ・学ぶ順の線・見本は無い）');
ok(!/mp_k_cross/.test(i18n) && !/教科をまたぐ/.test(i18n), 'AD-1 文言から「教科をまたぐ」を消した');
ok(!/#ed922c|--orange/.test(cssSrc.split('\n').filter(function (l) { return /mp-e\b|mp-e\.|mp-sw|mp-sq/.test(l); }).join('\n')), 'AB-3 / Y-3 線とマスに橙を使わない');

console.log('map-test: ' + pass + ' passed, ' + fail + ' failed');
console.log('MAP_TEST=' + (fail === 0 ? 'PASS' : 'FAIL'));
process.exitCode = fail === 0 ? 0 : 1;
