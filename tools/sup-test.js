/* サポーターの純関数テスト（docs/plans/supporter-view/contract-AD.md §AD-16 / 18-11 / 18-13）。node tools/sup-test.js → 最後に SUP_TEST=PASS|FAIL（失敗があれば終了コード 1） */
'use strict';
var path = require('path');
var fs = require('fs');
var vm = require('vm');
var JS = path.join(__dirname, '../app-v3/js');
var C = require(path.join(JS, 'sup-core.js'));
var SD = require(path.join(JS, 'sup-data.js'));
var M = require(path.join(JS, 'make.js'));
var TR = require(path.join(JS, 'trail.js'));

var pass = 0, fail = 0;
function ok(cond, name) { if (cond) pass += 1; else { fail += 1; console.log('NG  ' + name); } }
function eq(a, b, name) { ok(JSON.stringify(a) === JSON.stringify(b), name + '  (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }
function clone(v) { return JSON.parse(JSON.stringify(v)); }
function freeze(v) { return JSON.stringify(v); }
function loadData() {
  var ctx = {}; ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(JS, 'data.js'), 'utf8'), ctx);
  return clone(ctx.DES.data);
}
var D = loadData(), TODAY = '11/2';
var NAMES = { sup: '田中さん', child: 'はると' };
var seq = 0;
function CTX(joined) {
  return { joined: joined, supId: 'tanaka', supName: '田中さん', child: 'はると', today: TODAY, now: '10:20', text: SD.text,
    tx: function (w) { return w && w.text != null ? w.text : (w && w.k) || ''; }, newId: function (p) { seq += 1; return p + seq; } };
}

// ---------- normalize（AD-2 / 18-13） ----------
var DEF = { v: 1, join: null, log: [], ideas: [], advice: [], notes: [], report: { edits: {}, off: {}, extra: '', state: 'draft', sentAt: null, body: null }, logFilter: 'all', helped: { odai: {} } };
eq(C.normalize(undefined), DEF, 'normalize 無し → 初期値');
eq(C.normalize('x'), DEF, 'normalize 文字列 → 初期値');
eq(C.normalize([]), DEF, 'normalize 配列 → 初期値');
var bad = C.normalize({ join: 'haruto', log: 'x', ideas: {}, advice: 3, notes: null, report: [], logFilter: 'nope', helped: [], extra: 1 });
eq(bad, DEF, 'normalize 欄ごとに形が違う → その欄だけ初期値・知らない欄は捨てる');
var good = C.normalize({
  join: { child: 'haruto', stance: 'voice', since: '10:20', x: 1 },
  log: [{ id: 'l1', day: '11/2', time: '10:20', scene: 'talk', how: 'proxy', text: 'a', ref: { msg: 'm1', zz: 'q' }, extra: 1 }, { id: 'l2', scene: 'bad' }],
  ideas: [{ id: 'i1', msgId: 'm1', text: 't', catalogId: null, state: 'planned', rowId: 'p9', day: '11/2', time: '10:20', foo: 1 }, { id: 'i2', text: 't', state: 'x' }],
  advice: [{ id: 'a1', aim: 'ねらい', state: 'new', stages: { view: 'v', trial: 3 } }],
  notes: [{ id: 'n1', axis: 'int', text: 'x', day: '11/2', time: '10:20' }, { id: 'n2', axis: 'zz', text: 'x' }],
  report: { edits: { a: 'x', b: 2 }, off: { a: true, b: 'y' }, extra: 'e', state: 'sent', sentAt: '11/2 10:20', body: [{ id: 'talk' }] },
  logFilter: 'make', helped: { odai: { 'od-a': true, 'od-b': 1 } }
});
eq(good.join, { child: 'haruto', stance: 'voice', since: '10:20' }, 'normalize join の知らない欄を捨てる');
eq(C.normalize({ join: { child: 'haruto', stance: 'zz' } }).join.stance, 'proxy', 'normalize 知らない stance → proxy');
eq(good.log, [{ id: 'l1', day: '11/2', time: '10:20', scene: 'talk', how: 'proxy', text: 'a', ref: { msg: 'm1' } }], 'normalize log: 壊れた行を捨てる・ref の知らない欄を捨てる');
eq(good.ideas, [{ id: 'i1', msgId: 'm1', text: 't', catalogId: null, state: 'planned', day: '11/2', time: '10:20', rowId: 'p9' }], 'normalize ideas');
eq(good.advice[0].stages, { view: 'v', trial: null, result: null, update: null }, 'normalize advice の段は 文 か null');
eq(good.notes.map(function (n) { return n.id; }), ['n1'], 'normalize notes の知らない軸を捨てる');
eq(good.report, { edits: { a: 'x' }, off: { a: true }, extra: 'e', state: 'sent', sentAt: '11/2 10:20', body: [{ id: 'talk' }] }, 'normalize report（body は配列か null）');
eq(C.normalize({ report: { body: 'x' } }).report.body, null, 'normalize report.body 形が違えば null');
eq(good.logFilter, 'make', 'normalize logFilter');
eq(good.helped, { odai: { 'od-a': true } }, 'normalize helped（true だけ）');
eq(C.normalize({ helped: { odai: [] } }).helped, { odai: {} }, 'normalize helped 形が違えば { odai: {} }');
// 記録 500 件の上限
var many = []; for (var i = 0; i < 520; i++) many.push({ id: 'l' + i, day: '11/2', time: '10:20', scene: 'talk', how: 'proxy', text: 'x' + i, ref: {} });
var nm = C.normalize({ log: many }).log;
eq([nm.length, nm[0].id, nm[499].id], [500, 'l20', 'l519'], 'log 500 件を超えたら古い方から落とす（normalize）');
var ap = C.appendLog(many.slice(0, 499), [{ id: 'n1' }, { id: 'n2' }]);
eq([ap.length, ap[0].id, ap[499].id], [500, 'l1', 'n2'], 'log 500 件の上限（appendLog）');

// ---------- snap / diff（AD-3 の表・18-12） ----------
function baseState() {
  return {
    talk: [{ id: 'm1', who: 'child', text: 'a' }],
    plan: [{ id: 'r1', kind: 'proposed', title: 'R1', start: '13:30', end: '14:15' }, { id: 'r2', kind: 'mine', title: 'R2', start: '10:00', end: '10:50' }, { id: 'r3', kind: 'held', title: 'R3', start: '11:00', end: '11:10' }],
    activities: [{ id: 'a1', title: 'A1', changes: [{ id: 'c1', who: 'own', what: { text: 'w1' } }], thread: [{ id: 't1', who: 'child', text: 's1' }, { id: 't2', who: 'buddy', text: 'b' }] }],
    works: [{ id: 'w1', title: 'W1', shares: [] }],
    odai: { tried: { 'od-a': { found: [{ photo: 'p' }] } } },
    sup: C.normalize(null)
  };
}
var s0 = baseState(), sn0 = C.snap(s0);
eq(sn0, { talk: { m1: 'child' }, rows: { r1: { kind: 'proposed', gone: null, hidden: false }, r2: { kind: 'mine', gone: null, hidden: false }, r3: { kind: 'held', gone: null, hidden: false } },
  acts: { a1: { changes: ['c1'], says: ['t1'] } }, works: { w1: 0 }, found: { 'od-a': 1 } }, 'snap の形');
eq(C.diff(sn0, C.snap(s0)), [], 'diff 変わっていなければ空');
var s1 = baseState();
s1.talk.push({ id: 'm2', who: 'child', text: 'c' }, { id: 'm3', who: 'record', text: 'rec' }, { id: 'm4', who: 'buddy', text: 'b' }, { id: 'm5', who: 'supporter', text: 's' });
s1.plan[0].kind = 'mine';                                // proposed → mine
s1.plan[2].kind = 'mine';                                // held → mine
s1.plan[1].hidden = true;                                // hidden
s1.plan.push({ id: 'r4', kind: 'mine', title: 'R4', start: '14:00', end: '14:30' }, { id: 'r5', kind: 'proposed', title: 'R5', start: '15:00', end: '15:15' }, { id: 'r6', kind: 'held', title: 'R6', start: '9:00', end: '9:10' });
s1.activities[0].changes.push({ id: 'c2', who: 'own', what: { text: 'w2' } });
s1.activities[0].thread.push({ id: 't3', who: 'child', text: 's2' });
s1.activities.push({ id: 'a2', title: 'A2', changes: [{ id: 'c3', who: 'ai', what: { text: 'w3' } }], thread: [] });
s1.works.push({ id: 'w2', title: 'W2', shares: [] });
s1.works[0].shares = [{ id: 'sh' }];
s1.odai.tried['od-a'].found.push({ photo: 'q' });
s1.odai.tried['od-b'] = { found: [{ photo: 'x' }] };
var sn1 = C.snap(s1), sn0b = freeze(sn0), sn1b = freeze(sn1);
var ev = C.diff(sn0, sn1);
eq(ev, [
  { t: 'msg+', id: 'm2' }, { t: 'msg+', id: 'm3' }, { t: 'msg+', id: 'm4' }, { t: 'msg+', id: 'm5' },
  { t: 'rowMine', id: 'r1' }, { t: 'rowHidden', id: 'r2', hidden: true }, { t: 'rowMine', id: 'r3' }, { t: 'row+', id: 'r4' }, { t: 'row+', id: 'r6' },
  { t: 'act+', id: 'a2' }, { t: 'chg+', id: 'c2', act: 'a1' }, { t: 'chg+', id: 'c3', act: 'a2' }, { t: 'say+', id: 't3', act: 'a1' },
  { t: 'share+', id: 'w1' }, { t: 'work+', id: 'w2' }, { t: 'found+', id: 'od-a', odai: 'od-a' }, { t: 'found+', id: 'od-b', odai: 'od-b' }
], 'diff 表の全行（順序: 会話 → 行 → 活動 → 作品 → 見つけた。proposed の新しい行は出さない）');
eq([freeze(sn0), freeze(sn1)], [sn0b, sn1b], 'diff 引数を書き換えない');
// 消えたもの・取り消しは出来事にしない
var s2 = clone(s1);
s2.talk = []; s2.plan = s2.plan.filter(function (r) { return r.id !== 'r4'; }); s2.plan[0].gone = 'removed'; s2.activities = []; s2.works = []; s2.odai.tried = {};
eq(C.diff(sn1, C.snap(s2)), [], 'diff 消えた・外したものは出さない');
var s3 = clone(s1); s3.plan[1].hidden = false;
eq(C.diff(sn1, C.snap(s3)), [{ t: 'rowHidden', id: 'r2', hidden: false }], 'diff 表示に戻した');

// ---------- observe（18-2） ----------
// 入っていない: 記録も印も無し。新しい変化に day だけ付く
var o1s = baseState(), o1p = C.snap(o1s);
o1s.talk.push({ id: 'm2', who: 'child', text: 'x' });
o1s.activities[0].changes.push({ id: 'c2', who: 'own', what: { text: 'w' } });
var o1 = C.observe(o1s, o1p, null, CTX(false));
eq([o1.log.length, o1.touched, o1s.activities[0].changes[1].day, o1s.activities[0].changes[0].day], [0, ['activities'], TODAY, undefined], 'observe 入っていない: 記録なし・新しい変化に day（古い変化には付けない）');
eq(o1.snap, C.snap(o1s), 'observe 入っていない: 写しを更新する');
// 入っている・only 無し
var o2s = clone(s1); o2s.sup = C.normalize(null);
var o2 = C.observe(o2s, sn0, null, CTX(true));
eq(o2.log.map(function (l) { return [l.scene, l.how, l.text]; }), [
  ['talk', 'proxy', 'c'], ['plan', 'hands', 'rec'], ['plan', 'hands', '「R2」を非表示にした'], ['make', 'hands', '「A2」を作り始めた'],
  ['make', 'hands', '「A1」: w2'], ['make', 'hands', '「A2」: w3'], ['make', 'proxy', '「A1」で: s2'],
  ['works', 'hands', '「W1」を見せる設定にした'], ['works', 'hands', '「W2」を作品に残した'], ['today', 'hands', 'お題で見つけたものを残した'], ['today', 'hands', 'お題で見つけたものを残した']
], 'observe 入っている: 表の記録（バディ・サポーターの発言・行の追加は記録なし）');
eq(o2.log[0].ref, { msg: 'm2' }, 'observe 記録の ref');
eq([o2.log[0].day, o2.log[0].time], [TODAY, '10:20'], 'observe 記録の日と時刻');
eq(['r1', 'r3', 'r4', 'r6'].map(function (id) { return o2s.plan.filter(function (r) { return r.id === id; })[0].by; }), ['tanaka', 'tanaka', 'tanaka', 'tanaka'], 'observe row+ / rowMine に r.by');
eq([o2s.plan[1].by, o2s.plan.filter(function (r) { return r.id === 'r5'; })[0].by], [undefined, undefined], 'observe 既存の行・提案の行には付けない');
eq([o2s.activities[1].by, o2s.works[1].by, o2s.works[0].by], ['tanaka', 'tanaka', undefined], 'observe act+ / work+ に by（見せた数が増えただけの作品には付けない）');
ok(o2s.talk.every(function (m) { return m.by === undefined; }), 'observe 会話の by は付けない（TK.push が付ける）');
eq(o2s.sup.helped, { odai: { 'od-a': true, 'od-b': true } }, '18-13 found+ で helped を立てる');
eq(o2.touched.sort(), ['activities', 'plan', 'sup', 'works'], 'observe touched');
eq(o2.snap, C.snap(o2s), 'observe 写しを今の状態に更新する');
// 入っている・only あり: そのキーの部分だけ比べ、その部分だけ写しを更新
var o3s = clone(s1); o3s.sup = C.normalize(null);
var o3 = C.observe(o3s, sn0, 'plan', CTX(true));
eq(o3.log.map(function (l) { return l.scene; }), ['plan'], 'observe only=plan: 行の部分だけ（会話の記録行は会話の保存で）');
eq([o3.snap.rows, o3.snap.talk, o3.snap.acts], [C.snap(o3s).rows, sn0.talk, sn0.acts], 'observe only=plan: 行の写しだけ更新');
eq(o3.touched, ['plan'], 'observe only=plan の touched');
var o4 = C.observe(o3s, o3.snap, 'talk', CTX(true));
eq(o4.log.map(function (l) { return l.text; }), ['c', 'rec'], 'observe only=talk: 会話の部分');
var o5 = C.observe(o3s, o4.snap, 'draft', CTX(true));
eq([o5.log.length, o5.touched.length, o5.snap === o4.snap], [0, 0, true], 'observe 知らないキーは何もしない');
var o6 = C.observe(o3s, o4.snap, 'odai', CTX(true));
eq([o6.log.length, o6.snap.found], [2, C.snap(o3s).found], 'observe only=odai');
var o7 = C.observe(o3s, null, null, CTX(true));
eq([o7.log.length, o7.snap], [0, C.snap(o3s)], 'observe 写しが無ければ作って終わる');
// 二度目は増えない
eq(C.observe(o2s, o2.snap, null, CTX(true)).log.length, 0, 'observe 同じ状態で 2 回目は記録しない');
// say+ は記録だけ（活動内の発言に by を付けない・18-1）
ok(o2s.activities[0].thread.filter(function (m) { return m.id === 't3'; })[0].by === undefined, '18-1 say+ で活動内の発言に by を付けない');
// 入っていない × only あり: 新しい行・活動・作品に by が付かない・記録が増えない・c.day だけ付く
var o8s = baseState(), o8p = C.snap(o8s);
o8s.plan.push({ id: 'r9', kind: 'mine', title: 'R9', start: '14:00', end: '14:30' });
o8s.plan[0].kind = 'mine';
o8s.activities.push({ id: 'a9', title: 'A9', changes: [{ id: 'c9', who: 'own', what: { text: 'w9' } }], thread: [{ id: 't9', who: 'child', text: 's9' }] });
o8s.works.push({ id: 'w9', title: 'W9', shares: [] });
var o8 = [C.observe(o8s, o8p, 'plan', CTX(false)), null, null];
o8[1] = C.observe(o8s, o8[0].snap, 'activities', CTX(false));
o8[2] = C.observe(o8s, o8[1].snap, 'works', CTX(false));
eq(o8.map(function (r) { return r.log.length; }), [0, 0, 0], 'observe 入っていない × only: 記録が増えない');
eq([o8s.plan[0].by, o8s.plan[3].by, o8s.activities[1].by, o8s.works[1].by, o8s.activities[1].thread[0].by], [undefined, undefined, undefined, undefined, undefined], 'observe 入っていない × only: 新しい行・活動・作品・発言に by が付かない');
eq([o8s.activities[1].changes[0].day, o8[0].touched, o8[1].touched, o8[2].touched], [TODAY, [], ['activities'], []], 'observe 入っていない × only: c.day だけ付く（touched は activities だけ）');
eq(o8[2].snap, C.snap(o8s), 'observe 入っていない × only: 写しは 3 つの保存で今の状態になる');

// ---------- make.js setWith（18-1） ----------
var act0 = M.fromSample('mc', { id: 'a-w', now: '10:20', mode: 'js' });
M.setWith('田中さん');
var cw = M.commitChange(act0, { who: 'own', kind: 'test', what: { text: 'x' } }).change;
var cwAi = M.commitChange(act0, { who: 'ai', kind: 'adopt', what: { text: 'x' } }).change;
M.setWith(null);
var cwOff = M.commitChange(act0, { who: 'own', kind: 'test', what: { text: 'x' } }).change;
eq([cw.with, cwAi.with, cwOff.with], ['田中さん', undefined, undefined], '18-1 setWith 中は本人の変化に with・バディの変化には入れない・外すと入らない');

// ---------- fade（AD-9 / 18-6） ----------
function fadeOf(state, messages) { return C.fade({ weeks: SD.weeks, thisWeek: SD.thisWeek, scenes: SD.scenes, state: state, messages: messages, today: TODAY }); }
var f0 = fadeOf({ plan: D.plan, activities: [] }, D.talk);
eq(f0.map(function (f) { return f.scene; }), ['plan', 'talk', 'make'], 'fade 場面 3 つ');
eq(f0.map(function (f) { return f.weeks.slice(0, 4).map(function (w) { return [w.key, w.own, w.cue, w.by, w.live]; }); }),
  SD.scenes.map(function (sc) { return SD.weeks.map(function (w) { var v = w.scenes[sc.id]; return [w.key, v.own, v.cue, v.by, false]; }); }), 'fade 過去 4 週は seed と同じ');
eq(f0.map(function (f) { var w = f.weeks[4]; return [w.key, w.label, w.own, w.cue, w.by, w.live]; }),
  [['11/2', '今週', 2, 0, 0, true], ['11/2', '今週', 3, 0, 0, true], ['11/2', '今週', 0, 0, 0, true]], 'fade 今週（何もしていない: 予定 2・話す 3・作る 0）');
var fplan = [
  { id: 'a', kind: 'mine' }, { id: 'b', kind: 'mine', by: 'tanaka' }, { id: 'c', kind: 'mine', idea: 'i1' }, { id: 'd', kind: 'mine', idea: 'i1', by: 'tanaka' },
  { id: 'e', kind: 'mine', gone: 'finished' }, { id: 'f', kind: 'mine', gone: 'removed' }, { id: 'g', kind: 'proposed' }, { id: 'h', kind: 'held' }
];
var fmsg = [
  { who: 'child', text: '1' }, { who: 'child', by: 'tanaka', text: '2' }, { who: 'supporter', text: 's' }, { who: 'child', text: '3' },
  { who: 'buddy', ideaReply: 'i1', text: 'r' }, { who: 'child', text: '4' }, { who: 'buddy', text: 'r2' }, { who: 'child', text: '5' }
];
var facts = [
  { id: 'x', changes: [{ who: 'own', day: TODAY }, { who: 'own', day: TODAY, with: '田中さん' }, { who: 'ai', day: TODAY }, { who: 'own' }, { who: 'own', day: '10/30' }] },
  { id: 'y', idea: 'i1', changes: [{ who: 'own', day: TODAY }, { who: 'own', day: TODAY, with: '田中さん' }] }
];
var f1 = fadeOf({ plan: fplan, activities: facts }, fmsg);
eq(f1.map(function (f) { var w = f.weeks[4]; return [f.scene, w.own, w.cue, w.by]; }), [['plan', 2, 1, 2], ['talk', 2, 2, 1], ['make', 1, 1, 2]],
  'fade 今週の境目（予定: by / idea だけ → きっかけ / 外した・提案は数えない。話す: 直前が サポーター・アイデアの返事 → きっかけ。作る: day が今日の本人の変化だけ）');

// ---------- fadeLines（3 分岐） ----------
var fl = C.fadeLines([
  { scene: 'plan', label: '予定を決める', weeks: [{ label: '10/5 の週', own: 1, cue: 1, by: 4 }, { label: '今週', own: 3, cue: 0, by: 1 }] },
  { scene: 'talk', label: 'バディに話す', weeks: [{ label: '10/5 の週', own: 0, cue: 0, by: 0 }, { label: '10/12 の週', own: 2, cue: 0, by: 0 }, { label: '今週', own: 1, cue: 0, by: 1 }] },
  { scene: 'make', label: '作る', weeks: [{ label: '10/5 の週', own: 1, cue: 1, by: 3 }, { label: '今週', own: 0, cue: 0, by: 0 }] }
], SD.text, NAMES);
eq(fl.map(function (l) { return l.kind; }), ['up', 'flat', 'none'], 'fadeLines 上がった / 同じか下がった / 今週 0');
eq(fl[0].line, '予定を決める: 10/5 の週は 6 回のうち自分で 1 回。今週は 4 回のうち 3 回。自分で進める割合が上がっている', 'fadeLines up の文');
eq(fl[1].line, 'バディに話す: 10/12 の週は 2 回のうち自分で 2 回。今週は 2 回のうち 1 回。田中さんと一緒に進めている', 'fadeLines flat の文（最初の回数 > 0 の週と比べる）');
eq(fl[2].line, '作る: 今週の記録はこれから', 'fadeLines none の文');

// ---------- howCounts ----------
eq(C.howCounts([{ day: '11/2', how: 'proxy' }, { day: '11/2', how: 'proxy' }, { day: '11/2', how: 'voice' }, { day: '11/2', how: 'in' }, { day: '10/30', how: 'hands' }, { day: '11/4', how: 'idea' }], ['11/2', '11/4', '11/6']),
  { proxy: 2, hands: 0, voice: 1, idea: 1 }, 'howCounts 今週の日だけ・4 種（0 も出す）');

// ---------- reportDraft（AD-11 / 18-10） ----------
var rf = fadeOf({ plan: D.plan, activities: [] }, D.talk);
var rd = C.reportDraft({ report: SD.report, fade: rf, lines: C.fadeLines(rf, SD.text, NAMES), plan: D.plan, text: SD.text, names: NAMES, edits: { 'r-t1': '直した文' }, off: { 'r-d1': true } });
eq(rd.map(function (s) { return s.head; }), ['話していたこと', '実際に取り組んだこと', '学びの手がかり', '関心や変化', '自分で進めたこと', '次につながること（これから）'], 'reportDraft 6 節（この順）');
var own = rd[4];
eq(own.items.map(function (x) { return [x.id, x.src]; }), [['own:plan', 'calc'], ['own:talk', 'calc']], 'reportDraft 自分で: 今週 0 回の場面（作る）は出さない');
eq(own.items[0].text, '予定を決めるでは、自分で進める割合が上がってきました（10/5 の週: 6 回のうち 1 回 → 今週: 2 回のうち 2 回）', 'reportDraft 自分で: 上がった の文');
var rdFlat = C.reportDraft({ report: SD.report, fade: [{ scene: 'make', label: '作る', weeks: [{ label: '10/5 の週', own: 3, cue: 0, by: 0 }, { label: '今週', own: 1, cue: 0, by: 1 }] }], plan: [], text: SD.text, names: NAMES });
eq(rdFlat[4].items[0].text, '作るは、田中さんと一緒に進めています（今週: 2 回のうち自分で 1 回）', 'reportDraft 自分で: それ以外 の文');
eq(own.note, '画面に残ったことだけを数えています。声かけや見守りは入っていません', 'reportDraft 自分で の末尾の 1 文');
eq(rd[5].items.map(function (x) { return [x.id, x.text]; }), [['r-n1', 'アクセサリー作りは、次に色とひもの長さを決めます'], ['next:p6', '13:30〜 アクセサリー作り（続き）（提案中）'], ['next:p7', '14:15〜 ゲーム作り: Python（提案中）']], 'reportDraft 提案中の行が「これから」に入る');
eq(rd[0].items[0], { id: 'r-t1', text: '直した文', orig: SD.report.items[0].text, src: 'own', edited: true, off: false }, 'reportDraft 直した文');
eq(rd[1].items[0].off, true, 'reportDraft 載せない');
ok(rd[2].items[1].text.indexOf('{sup}') < 0 && rd[2].items[1].text.indexOf('田中さん') >= 0, 'reportDraft 項目の {sup} を埋める');
var rd2 = C.reportDraft({ report: SD.report, fade: rf, plan: D.plan.map(function (r) { return r.kind === 'proposed' ? Object.assign({}, r, { gone: 'declined' }) : r; }), text: SD.text, names: NAMES });
eq(rd2[5].items.length, 1, 'reportDraft 見送った提案は入れない');

// ---------- childRow（18-12） ----------
var cr = C.childRow({ plan: D.plan, messages: D.talk, ideas: [], joined: false, now: '10:20', child: D.child, mode: 'js', text: SD.text });
eq(cr, { id: 'haruto', name: 'はると', mode: 'js', now: '建築（大きく） 10:00〜10:50', next: 'サークル対話 10:50〜', consult: 'Python のゲーム作りやってみたい', checks: ['提案中の予定がある'] }, 'childRow はると（今・次・相談・確認）');
var cr2 = C.childRow({ plan: [{ id: 'z', kind: 'mine', start: '13:30', end: '14:00', title: 'Z', gone: 'removed' }], messages: [], ideas: [{ id: 'i', state: 'open' }], joined: true, now: '10:20', child: D.child, mode: 'es', text: SD.text });
eq([cr2.now, cr2.next, cr2.consult, cr2.checks, cr2.mode], ['予定の合間', '今日の予定はここまで', null, ['アイデアに返事待ち', 'いま入っている'], 'es'], 'childRow 行が無い・相談なし・アイデア待ち・入っている');
var hp = clone(D.plan); hp[0].hidden = true;
var cr3 = C.childRow({ plan: hp, messages: D.talk, ideas: [{ id: 'i', state: 'open' }], joined: true, now: '10:20', child: D.child, mode: 'js', text: SD.text });
eq([cr3.now, cr3.checks], ['建築（大きく） 10:00〜10:50', ['提案中の予定がある', 'アイデアに返事待ち', 'いま入っている']], 'childRow 非表示の mine 行も「今」に数える・確認は契約の順に 3 つまで');
eq(C.childRow({ plan: D.plan, messages: [], ideas: [], now: '10:20', child: D.child, text: { range_fmt: '{start}-{end}' } }).now, '建築（大きく） 10:00-10:50', 'childRow 時間帯は text.range_fmt で作る（記号を直書きしない）');
// アイデアの 取り下げる / 元に戻す の記録は talk / desk（アイデアの件数に入れない）
var supJs = fs.readFileSync(path.join(JS, 'sup.js'), 'utf8');
eq([(supJs.match(/addLog\('talk', 'desk', SUP\.t\('log_idea_(withdraw|back)'/g) || []).length, /addLog\('talk', 'idea', SUP\.t\('log_idea_/.test(supJs)], [2, false], '4 アイデアの 取り下げる / 元に戻す の記録は how = desk');
eq(C.howCounts([{ day: '11/2', how: 'desk' }, { day: '11/2', how: 'idea' }], ['11/2']).idea, 1, '4 howCounts: desk はアイデアの件数に入らない');

// ---------- W2: サポーター画面の決まりを支える純関数 ----------
// 記録（AD-9 の 3）: 絞り込み・日の新しい順 → 時刻の新しい順（同じ時刻は後から足したものが先）・日ごとにまとめる
var LG = [
  { id: 's1', day: '10/28', time: '10:08', scene: 'join', how: 'in', text: '' }, { id: 's2', day: '10/30', time: '10:05', scene: 'talk', how: 'voice', text: '' },
  { id: 'a', day: '11/2', time: '10:20', scene: 'talk', how: 'proxy', text: '' }, { id: 'b', day: '11/2', time: '10:20', scene: 'plan', how: 'hands', text: '' },
  { id: 'c', day: '11/2', time: '9:40', scene: 'note', how: 'desk', text: '' }, { id: 'd', day: '11/2', time: '10:20', scene: 'report', how: 'desk', text: '' }
];
var LGb = freeze(LG);
var lv = C.logView(LG, 'all');
eq(lv.map(function (g) { return [g.day, g.items.map(function (e) { return e.id; })]; }), [['11/2', ['d', 'b', 'a', 'c']], ['10/30', ['s2']], ['10/28', ['s1']]], 'logView ぜんぶ: 日 → 時刻の新しい順・同じ時刻は後から足したものが先・日ごと');
eq(C.logView(LG, 'talk').map(function (g) { return g.items.map(function (e) { return e.id; }); }), [['a'], ['s2']], 'logView 話す');
eq(C.logView(LG, 'other').map(function (g) { return g.items.map(function (e) { return e.id; }); }), [['d', 'c'], ['s1']], 'logView そのほか = 作品・お題・一緒に入る・助言・観察・レポート');
eq(C.logView(LG, 'make'), [], 'logView 0 件は空（画面は lg_empty）');
eq(C.logView(SD.log.concat([]), 'all')[0].items[0].id, 'sl-6', 'logView seed の並び（10/30 10:15 が先頭）');
eq(freeze(LG), LGb, 'logView 引数を書き換えない');
// 助言の一覧（AD-8）: 同じ id は state 側が勝つ・新しい順・同じ時刻は state の先頭が先
var adMine = [{ id: 'n2', day: '11/2', time: '10:20', aim: 'B' }, { id: 'n1', day: '11/2', time: '10:20', aim: 'A' }, { id: 'ad-1', day: '10/28', time: '11:20', aim: '直した' }];
var adl = C.adviceList(SD.advice, adMine);
eq(adl.map(function (x) { return x.id; }), ['n2', 'n1', 'ad-2', 'ad-1'], 'adviceList 新しい順（足した分が seed より先・同じ時刻は state の先頭が先）');
eq(adl[3].aim, '直した', 'adviceList 同じ id は state 側が勝つ');
eq(C.adviceList(SD.advice, []).map(function (x) { return x.id; }), ['ad-2', 'ad-1'], 'adviceList seed だけ');
// 四角（AD-9）: 自分で → きっかけ → 代わりに・最大 10 個・超えた分
eq(C.squares({ own: 1, cue: 1, by: 4 }), { n: 6, cells: ['own', 'cue', 'by', 'by', 'by', 'by'], more: 0 }, 'squares 6 回');
eq(C.squares({ own: 8, cue: 2, by: 3 }), { n: 13, cells: ['own', 'own', 'own', 'own', 'own', 'own', 'own', 'own', 'cue', 'cue'], more: 3 }, 'squares 10 を超えたら ほか');
eq(C.squares({ own: 0, cue: 0, by: 0 }), { n: 0, cells: [], more: 0 }, 'squares 0 回（画面は 記録なし）');
// バディの提案（AD-7 の今日 3）
var pp = clone(D.plan); pp.push({ id: 'x1', start: '9:00', end: '9:15', title: 'X', kind: 'proposed', from: 'talk-5', gone: 'declined' }, { id: 'x2', start: '15:15', end: '15:30', title: 'Y', kind: 'mine', from: 'nope' });
pp[5].kind = 'mine';
var props = C.proposals(pp, D.talk);
eq(props.map(function (p) { return [p.row.id, p.status]; }), [['x1', 'declined'], ['p6', 'chosen'], ['p7', 'proposed']], 'proposals 会話から生まれた行（断った行も）を時刻順・状態');
eq(props[1].line, 'アクセサリー作りの続きは 13:30 から 45 分くらい？ 新しいことは、今まで取り組んできたことから選んでもいいし、やったことがないものでもいいよ', 'proposals 元の発言の 1 行目');
eq(C.proposals([{ id: 'r', start: '9:00', end: '9:10', from: 'talk-5', kind: 'held' }, { id: 'q', start: '9:00', end: '9:10', from: 'talk-5', kind: 'mine', gone: 'removed' }, { id: 'f', start: '9:20', end: '9:30', from: 'talk-5', kind: 'mine', gone: 'finished' }], D.talk).map(function (p) { return p.status; }), ['held', 'removed', 'finished'], 'proposals 保留・外した・終わった');
// レポート（18-13）: 確かめた時点の写し・今の中身との比べ・載せる項目 0・届く形
var rdOff = C.reportDraft({ report: SD.report, fade: rf, plan: D.plan, text: SD.text, names: NAMES, edits: {}, off: {} });
var body = C.reportFreeze(rdOff, '補足の文');
eq([body.length, body[body.length - 1]], [7, { id: 'extra', text: '補足の文' }], 'reportFreeze 6 節 + 補足');
var th = C.reportThaw(clone(body));
eq([th.sections.length, th.extra, th.sections[4].note, th.sections[0].items[0].id], [6, '補足の文', SD.text.rp_own_note, 'r-t1'], 'reportThaw 節と補足に戻す');
eq(C.reportThaw('x'), null, 'reportThaw 形が違えば null');
ok(C.reportSame(body, rdOff, '補足の文'), 'reportSame 同じ中身');
ok(!C.reportSame(body, rdOff, '別の補足'), 'reportSame 補足が変わった → 違う');
var rdMoved = C.reportDraft({ report: SD.report, fade: rf, plan: D.plan.filter(function (r) { return r.id !== 'p7'; }), text: SD.text, names: NAMES, edits: {}, off: {} });
ok(!C.reportSame(body, rdMoved, '補足の文'), 'reportSame 元の記録（提案中の行）が変わった → 違う（rp_stale）');
var rdOff2 = C.reportDraft({ report: SD.report, fade: rf, plan: D.plan, text: SD.text, names: NAMES, edits: {}, off: { 'r-t1': true } });
ok(!C.reportSame(body, rdOff2, '補足の文'), 'reportSame 載せない が変わった → 違う');
ok(!C.reportSame(null, rdOff, ''), 'reportSame body が無ければ違う');
var nItems = rdOff.reduce(function (n, s) { return n + s.items.length; }, 0);
eq(C.reportOnCount(rdOff), nItems, 'reportOnCount 全部載せる');
var allOff = {}; rdOff.forEach(function (s) { s.items.forEach(function (it) { allOff[it.id] = true; }); });
var rdNone = C.reportDraft({ report: SD.report, fade: rf, plan: D.plan, text: SD.text, names: NAMES, edits: {}, off: allOff });
eq(C.reportOnCount(rdNone), 0, 'reportOnCount 載せる項目 0（「確かめた」を押せない）');
var out = C.reportOut(rdOff2);
eq([out.length, out[0].items.length, out[0].items.indexOf(rdOff[0].items[0].text)], [6, rdOff[0].items.length - 1, -1], 'reportOut 載せない項目は届く形に出ない');
eq(C.reportOut(rdNone), [], 'reportOut 全部載せない → 節も出ない');
eq(out[4].note, SD.text.rp_own_note, 'reportOut 自分で進めたこと の末尾の 1 文');

// ---------- あしあと（18-5 / 18-7） ----------
eq(TR.talkTopics([{ id: 'c', who: 'child', text: 'a', by: 'tanaka' }, { id: 'b', who: 'buddy', text: 'r', ideaReply: 'i1' }]).map(function (t) { return [t.reply, t.by]; }), [[null, 'tanaka']], '18-5 talkTopics は ideaReply を返事にしない・m.by を渡す');
var tre = TR.entries({ today: TODAY, finishTpl: '「{title}」が終わった（{start}〜{end}）',
  messages: [{ id: 'm1', who: 'child', time: '10:00', text: 'a', by: 'tanaka' }, { id: 'm2', who: 'child', time: '10:01', text: 'b' }, { id: 'm3', who: 'record', time: '10:02', text: 'r', by: 'tanaka' },
    { id: 'm4', who: 'record', time: '10:03', text: '「Q」が終わった（9:00〜9:10）', by: 'tanaka' }],
  plan: [{ id: 'p', title: 'P', start: '9:20', end: '9:30', kind: 'mine', gone: 'finished', by: 'tanaka' }, { id: 'q', title: 'Q', start: '9:00', end: '9:10', kind: 'mine', gone: 'finished' }],
  works: [{ id: 'w1', title: 'w', by: 'tanaka', date: '11/2' }], acts: [{ id: 'a', title: 'A', changes: [{ id: 'c', who: 'own', with: '田中さん', time: '10:00', what: { text: 'x' } }] }],
  odai: { tried: { 'od-a': { found: [{ photo: 'p', time: '11/2 10:00' }] }, 'od-b': { found: [{ photo: 'p', time: '11/2 10:00' }] } } }, helped: { odai: { 'od-a': true } } });
eq(TR.filter(tre, 'own').map(function (e) { return e.id; }).sort(), ['found:od-b:0', 'talk:m2'], '18-7 own: by 付きの 話した・記録・終わった予定（行だけ / 記録だけ）・作品・人名の作った・helped の見つけた が出ない');

// ---------- 文言（AD-12）: i18n に [中, 小] で在る（verbatim） ----------
var I18N = fs.readFileSync(path.join(JS, 'i18n.js'), 'utf8');
var AD12 = {
  sup: ['サポーター', 'サポーター'], by_typed: ['{sup}が代わりに入力', '{sup}が かわりに入力'], by_with: ['{sup}と', '{sup}と'], by_row: ['{sup}と入れた', '{sup}と入れた'],
  idea_row: ['{sup}のアイデアから', '{sup}のアイデアから'], idea_label: ['{sup}のアイデア', '{sup}のアイデア'], idea_make: ['作るで試す', 'つくるでためす'], idea_plan: ['予定に入れる', '予定に入れる'],
  idea_later: ['あとで', 'あとにする'], idea_later_st: ['あとで考える', 'あとでかんがえる'], idea_made_st: ['作るで試している', 'つくるでためしている'], idea_withdrawn: ['{sup}が取り下げた', '{sup}がとりさげた'],
  idea_later_toast: ['あとで考えることにした', 'あとでかんがえることにした'],
  idea_rep_match: ['{sup}のアイデアだね。「{title}」、まず少しだけ試してみる？ 作るで小さく始めてもいいし、予定に入れてもいい。やらない、でもいいよ', '{sup}のアイデアだね。「{title}」、まず少しだけためしてみる？ つくるで小さくはじめてもいいし、予定に入れてもいい。やらない、でもいいよ'],
  idea_rep_free: ['{sup}のアイデアだね。作るで小さく試してみる？ 気になるところを話すだけでもいい。やらない、でもいいよ', '{sup}のアイデアだね。つくるで小さくためしてみる？ 気になるところを話すだけでもいい。やらない、でもいいよ'],
  tr_f_own: ['自分で', 'じぶんで']
};
Object.keys(AD12).forEach(function (k) {
  var line = '    ' + k + ": ['" + AD12[k][0] + "', '" + AD12[k][1] + "']";
  ok(I18N.indexOf(line) >= 0, 'AD-12 ' + k + ' が [中, 小] で在る');
});
var adBlock = I18N.slice(I18N.indexOf('// ---- §AD サポーター'));
ok(I18N.indexOf('// ---- §AD サポーター') > I18N.indexOf('// ---- §Z あしあと') && I18N.indexOf("tr_f_own:") < I18N.indexOf('// ---- §AD サポーター'), 'AD-12 §AD の塊は末尾・tr_f_own は §Z の塊の末尾');
ok(adBlock.indexOf('};') > 0, 'AD-12 §AD の塊は文言の表の中');

// ---------- 禁止語（18-11）・sup.js に日本語の直書きが無い ----------
// 禁止語の一覧は契約 AD-16 の grep の行から読む（このファイルに禁止語を書かないため）
var CONTRACT = fs.readFileSync(path.join(__dirname, '../docs/plans/supporter-view/contract-AD.md'), 'utf8');
var BADSRC = (/grep -rnE '([^']+)' app-v3\//.exec(CONTRACT) || [])[1];
ok(!!BADSRC && BADSRC.split('|').length === 13, '18-11 禁止語の一覧（13 語）を契約から読めた');
var BAD = new RegExp(BADSRC || 'x^');
['sup-data.js', 'sup-core.js', 'sup.js', 'sup-view.js'].forEach(function (f) { ok(!BAD.test(fs.readFileSync(path.join(JS, f), 'utf8')), '18-11 ' + f + ' に禁止語が無い'); });
ok(!BAD.test(fs.readFileSync(path.join(__dirname, '../app-v3/css/sup.css'), 'utf8')), '18-11 sup.css に禁止語が無い');
['sup.js', 'sup-view.js', 'sup-core.js'].forEach(function (f) {
  var src = fs.readFileSync(path.join(JS, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
  var jp = src.match(/[\u3040-\u30ff\u3400-\u9fff\uff01-\uff60]/g);
  ok(!jp, 'AD-16 ' + f + ' に日本語の文字列の直書きが無い（コメントを除く）' + (jp ? ' ' + jp.slice(0, 5).join('') : ''));
});
// W2 の画面が引く文言 key が DES.supData.text に在る（sup-view.js の t('…') を拾う）
var viewSrc = fs.readFileSync(path.join(JS, 'sup-view.js'), 'utf8');
var keys = {}, km, KRE = /(?:^|[^.\w])t\('([a-z0-9_]+)'\s*[,)]/g;
while ((km = KRE.exec(viewSrc))) keys[km[1]] = true;
var missing = Object.keys(keys).filter(function (k) { return SD.text[k] == null; });
ok(Object.keys(keys).length > 50 && !missing.length, 'W2 sup-view.js の文言 key が supData.text に在る' + (missing.length ? ' 無い: ' + missing.join(',') : ''));

console.log('sup-test: ' + pass + ' pass, ' + fail + ' fail');
console.log('SUP_TEST=' + (fail ? 'FAIL' : 'PASS'));
process.exitCode = fail ? 1 : 0;
