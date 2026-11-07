/* 自己理解（#self）の純関数テスト（contract-LS §LS-15 / 18-18 / 18-23・24・27）。
   app/js/self-data.js と app/js/self.js を node の vm で読み、DOM なしで reduce / validate / deriveRecords / records() を確かめる。
   fixture（固定の見立て・記録・場面）は注入しない。データは全部このファイルの合成データ。
   node tools/live-self-test.js → 最後に LIVE_SELF_TEST=PASS|FAIL */
'use strict';
var path = require('path');
var fs = require('fs');
var vm = require('vm');

var pass = 0, fail = 0;
function ok(cond, name) { if (cond) pass += 1; else { fail += 1; console.log('NG  ' + name); } }
function eq(a, b, name) { ok(JSON.stringify(a) === JSON.stringify(b), name + '  (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }

// 読み込み: window = context。store / i18n は呼ばれた引数を記録するだけの stub
function load(opts) {
  opts = opts || {};
  var ctx = { console: console, Date: Date, JSON: JSON, Math: Math, Object: Object, Array: Array, String: String, Number: Number, RegExp: RegExp, isNaN: isNaN };
  ctx.window = ctx;
  var reg = {}, added = {};
  ctx.DES = {
    store: { register: function (k, v, d) { reg[k] = { validate: v, defaults: d }; } },
    i18n: { add: function (t) { Object.keys(t).forEach(function (k) { added[k] = t[k]; }); } },
    t: function (k) { return added[k] ? added[k][0] : (k === 'kept_tomorrow' ? '明日にとっておいた' : k); }
  };
  if (opts.state) ctx.DES.state = opts.state;
  if (opts.plan) ctx.DES.plan = opts.plan;
  if (opts.data) ctx.DES.data = opts.data;
  if (opts.ls) ctx.localStorage = opts.ls;
  if (opts.BL) ctx.BL = opts.BL;
  vm.createContext(ctx);
  ['self-data.js', 'self.js'].forEach(function (f) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../app/js', f), 'utf8'), ctx, { filename: f });
  });
  return { ctx: ctx, S: ctx.DES.self, SD: ctx.DES.selfData, reg: reg, added: added };
}
function lsOf(map) { return { getItem: function (k) { return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null; } }; }

var L = load(), S = L.S, SD = L.SD;
var ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

// ---------- fixture を持たない（LS-15） ----------
ok(SD && !('items' in SD), 'selfData に固定の項目（items）が無い');
ok(!('scenes' in SD.kufu) && !('new_scene_buddy' in SD.kufu), 'selfData に固定の場面（kufu.scenes）と場面への固定返事が無い');
ok(!('comment' in SD) && !('asOf' in SD) && !('span' in SD), 'selfData に固定の話しかけ・日付が無い');
ok(!('initialLetter' in SD.avatar), 'selfData に固定の頭文字が無い');
var dataText = fs.readFileSync(path.join(__dirname, '../app/js/self-data.js'), 'utf8');
ok(!/はると|田中|11\/2|10\/19|11-02/.test(dataText), 'self-data.js に架空の人名・日付が残っていない');
eq(SD.text.as_of, { js: '{md} 時点', es: '{md} のじてん' }, '「時点」は今日の M/D を差し込む');
eq(SD.text.avatar_alt.js, '{name}のアバター', 'avatar_alt = 「{name}のアバター」');
eq(SD.text.avatar_alt_none.js, 'アバター', '名前が無い時の avatar_alt = 「アバター」');
eq(SD.axes.map(function (a) { return a.id; }), ['int', 'ori', 'exp', 'psy', 'mas'], '5 観点はそのまま');

// ---------- 保存の鍵と文言（register / i18n.add） ----------
ok(!!L.reg.self, 'DES.store.register("self", …) を呼ぶ');
if (L.reg.self) {
  var d0 = L.reg.self.defaults();
  eq(d0, { v: 1, rx: {}, notes: [], door: {}, kufu: { scenes: [], ideas: {}, own: [] }, log: [], draft: null }, '既定は空（avatar を持たない）');
  ok(L.reg.self.validate(d0) === true, 'register の validate は既定を通す');
  ok(L.reg.self.validate({}) === false && L.reg.self.validate(null) === false && L.reg.self.validate([]) === false, 'register の validate は形の違う値を落とす');
  ok(L.reg.self.defaults() !== d0, 'defaults は毎回新しい値');
}
eq(L.added.sx_empty_comment, ['まだ見立てはおいていないよ。作る・基礎学習・自分の言葉を書くと、ここに手がかりがたまっていく', 'まだ見立てはおいていないよ。つくる・きそ学習・自分のことばを書くと、ここに手がかりがたまっていく'], '18-24 sx_empty_comment');
eq(L.added.sx_share && L.added.sx_share[0], 'サポーターも見られる', 'LS-15 sx_share（サポーター名を入れない）');
eq(L.added.sx_name_label && L.added.sx_name_label[0], '呼んでほしい名前', 'LS-15 名前の入力のラベル');

// ---------- validate ----------
var e = S.validate(null);
eq(e, L.reg.self.defaults(), 'validate(null) は空');
eq(S.validate('{壊れた'), e, '壊れた JSON は空');
ok(!('avatar' in S.validate({ v: 1, avatar: { hair: 'h2', color: 'c3' } })), '古い保存値の avatar は読まない（18-23）');
eq(S.validate({ notes: [{ id: 'a"b', axis: 'int', group: null, on: null, vers: [{ text: 'x', at: '2026-11-08T01:00:00.000Z' }], cur: 0, gone: false }] }).notes, [], '形の違う id の言葉は落とす');
eq(S.validate({ notes: [{ id: 'n1', axis: 'zzz', group: null, on: null, vers: [{ text: 'x', at: 'a' }], cur: 0, gone: false }] }).notes, [], '知らない観点の言葉は落とす');

// ---------- reduce: 本人の言葉（書く → 直す → 消す → 戻す） ----------
var AT1 = '2026-11-08T01:00:00.000Z', AT2 = '2026-11-08T02:00:00.000Z';
var s0 = S.validate(null);
var s1 = S.reduce(s0, { type: 'noteAdd', nid: 'n1', axis: 'int', group: null, on: null, text: '  電車の模型  ', at: AT1 });
eq(s1.notes, [{ id: 'n1', axis: 'int', group: null, on: null, vers: [{ text: '電車の模型', at: AT1 }], cur: 0, gone: false }], 'noteAdd は前後の空白を落として残す（at は ISO のまま）');
ok(s0.notes.length === 0, 'reduce は元の状態を変えない');
eq(S.reduce(s0, { type: 'noteAdd', nid: 'n9', axis: 'int', text: '   ', at: AT1 }), s0, '空の言葉は残さない（同じ状態を返す）');
eq(S.reduce(s0, { type: 'noteAdd', nid: 'n9', axis: 'nope', text: 'x', at: AT1 }), s0, '知らない観点には残さない');
var long = new Array(260).join('あ');
eq(S.reduce(s0, { type: 'noteAdd', nid: 'n8', axis: 'int', text: long, at: AT1 }).notes[0].vers[0].text.length, 200, '200 字で切る');
var s2 = S.reduce(s1, { type: 'noteEdit', id: 'n1', text: '電車の模型と路線図', at: AT2 });
eq(s2.notes[0].vers.map(function (v) { return v.text; }), ['電車の模型', '電車の模型と路線図'], 'noteEdit は版を足す（履歴）');
eq(s2.notes[0].cur, 1, 'noteEdit 後は新しい版が今');
eq(S.reduce(s2, { type: 'noteEdit', id: 'n1', text: '電車の模型と路線図', at: AT2 }), s2, '同じ文への直しは変化なし');
var s3 = S.reduce(s2, { type: 'noteDel', id: 'n1', at: AT2 });
ok(s3.notes[0].gone === true, 'noteDel は gone にする（戻せるよう中身は持つ）');
var s4 = S.reduce(s3, { type: 'undo', prev: s2 });
eq(s4, s2, 'undo は操作前へ丸ごと戻す');
eq(S.reduce(s3, { type: 'noteEdit', id: 'n1', text: 'z', at: AT2 }), s3, '消した言葉は直せない');
var sOn = S.reduce(s0, { type: 'noteAdd', nid: 'n2', axis: 'exp', group: null, on: 'r-w-w1', text: 'もう少し大きくしたかった', at: AT1 });
eq(sOn.notes[0].on, 'r-w-w1', '記録への注記は on に記録の id を持つ');

// ---------- reduce: 見立ての返事は見立てが無いので効かない（ai は空） ----------
['agree', 'away', 'toAi', 'back'].forEach(function (t) { eq(S.reduce(s1, { type: t, id: 'int-a1', at: AT1 }), s1, t + ' は見立てが無い間は変化なし'); });
eq(S.reduce(s1, { type: 'fix', id: 'int-a1', text: 'ちがう', at: AT1 }), s1, 'fix は見立てが無い間は変化なし');
eq(S.reduce(s1, { type: 'door', id: 'int-d1', val: 'added', at: AT1 }), s1, 'door は見立てが無い間は変化なし');
eq(S.reduce(s1, { type: 'avatar', hair: 'h2', color: 'c2', at: AT1 }), s1, 'avatar は self の保存に無い（profile が正本）');

// ---------- reduce: 工夫の帯（場面 → 自分の工夫 → 試す → 結果 / 少し変える / 今はいい / もどす） ----------
eq(S.reduce(s0, { type: 'try', id: 'k1-ai', at: AT1 }), s0, '固定の工夫（k1-ai）は無い → 試せない');
var k1 = S.reduce(s0, { type: 'sceneAdd', nid: 'sc1', text: '人の話を聞くだけだと ぼーっとする', at: AT1 });
eq(k1.kufu.scenes, [{ id: 'sc1', text: '人の話を聞くだけだと ぼーっとする', at: AT1, gone: false }], 'sceneAdd');
var k2 = S.reduce(k1, { type: 'ownAdd', nid: 'o1', scene: 'sc1', text: '手もとで図にする', at: AT1 });
eq(k2.kufu.own.length, 1, 'ownAdd は場面に工夫を足す');
eq(S.reduce(k1, { type: 'ownAdd', nid: 'o2', scene: 'nope', text: 'x', at: AT1 }), k1, '知らない場面には足さない');
var k3 = S.reduce(k2, { type: 'try', id: 'o1', at: AT2 });
eq(k3.kufu.ideas.o1, { status: 'trying', result: null, note: '', at: AT2, text: null }, 'try → 試し中');
eq(S.reduce(k3, { type: 'try', id: 'o1', at: AT2 }), k3, '試し中にもう一度 try は変化なし');
var k3n = S.reduce(k3, { type: 'ideaNote', id: 'o1', note: '少し楽だった' });
eq(k3n.kufu.ideas.o1.note, '少し楽だった', 'ideaNote は試し中のひとことを残す');
var k4 = S.reduce(k3n, { type: 'result', id: 'o1', result: 'fit', note: '楽だった', at: AT2 });
eq([k4.kufu.ideas.o1.status, k4.kufu.ideas.o1.result, k4.kufu.ideas.o1.note], ['result', 'fit', '楽だった'], 'result fit');
eq(S.reduce(k3, { type: 'result', id: 'o1', result: 'great', at: AT2 }), k3, '知らない結果は変化なし');
var k5 = S.reduce(k3, { type: 'adjust', id: 'o1', text: '手もとで図と言葉にする', at: AT2 });
eq([k5.kufu.ideas.o1.status, k5.kufu.ideas.o1.result, k5.kufu.ideas.o1.text], ['trying', 'adjust', '手もとで図と言葉にする'], 'adjust は試し中のまま文を変える');
eq(S.reduce(k3, { type: 'adjust', id: 'o1', text: '手もとで図にする', at: AT2 }), k3, '同じ文の adjust は変化なし');
var k6 = S.reduce(k4, { type: 'ideaAway', id: 'o1', at: AT2 });
eq([k6.kufu.ideas.o1.status, k6.kufu.ideas.o1.prev], ['away', 'result'], 'ideaAway は外す前の状態を prev に持つ');
var k7 = S.reduce(k6, { type: 'ideaBack', id: 'o1', at: AT2 });
eq([k7.kufu.ideas.o1.status, k7.kufu.ideas.o1.result], ['result', 'fit'], 'ideaBack は結果へ戻す');
var k8 = S.reduce(k2, { type: 'ideaAway', id: 'o1', at: AT2 });
ok(!S.reduce(k8, { type: 'ideaBack', id: 'o1', at: AT2 }).kufu.ideas.o1, 'idle から外した工夫は もどすで idle（記録なし）');
var k9 = S.reduce(k2, { type: 'ownEdit', id: 'o1', text: '図にして隣に見せる', at: AT2 });
eq(k9.kufu.own[0].text, '図にして隣に見せる', 'ownEdit');
ok(S.reduce(k9, { type: 'ownDel', id: 'o1', at: AT2 }).kufu.own[0].gone === true, 'ownDel');
eq(S.reduce(k1, { type: 'sceneEdit', id: 'sc1', text: '話を聞くだけの時間がつらい', at: AT2 }).kufu.scenes[0].text, '話を聞くだけの時間がつらい', 'sceneEdit');
ok(S.reduce(k1, { type: 'sceneDel', id: 'sc1', at: AT2 }).kufu.scenes[0].gone === true, 'sceneDel');
var kd = S.reduce(k1, { type: 'sceneDel', id: 'sc1', at: AT2 });
eq(S.reduce(kd, { type: 'ownAdd', nid: 'o3', scene: 'sc1', text: 'x', at: AT2 }), kd, '消した場面には工夫を足さない');

// ---------- reduce: 下書き ----------
var dr = S.reduce(s0, { type: 'draft', draft: { target: 'add:int', mode: 'add', text: '書きかけ' } });
eq(dr.draft, { target: 'add:int', mode: 'add', text: '書きかけ' }, 'draft を残す');
eq(S.reduce(dr, { type: 'draft', draft: null }).draft, null, 'draft を消す');
eq(S.reduce(s0, { type: 'draft', draft: { target: 'bad target', mode: 'x', text: 'y' } }), s0, '形の違う下書きは残さない');
eq(S.reduce(s0, { type: 'nope' }), s0, '知らない action は変化なし');

// ---------- deriveRecords（純関数。合成データ） ----------
eq(S.deriveRecords({}), [], '何も無ければ記録は無い');
eq(S.deriveRecords(null), [], 'src が null でも落ちない');
var works = [
  { id: 'w1', actId: 'a1', title: '駅の屋根', createdAt: '2026-11-03T03:00:00.000Z' },
  { id: 'w2', actId: 'a2', title: 'ビーズの腕輪', date: '2026-11-05' },
  { id: 'w3', actId: 'a3', title: '  ' }
];
var acts = [
  { id: 'a1', title: '駅の屋根', changes: [{ id: 'c1', at: '2026-11-02T01:00:00.000Z' }] },
  { id: 'a4', title: 'コマ撮りの試し', changes: [{ id: 'c1', at: '2026-11-07T16:30:00.000Z' }] },
  { id: 'a5', title: '開いただけ', changes: [] }
];
var rec = S.deriveRecords({ works: works, activities: acts });
eq(rec.map(function (r) { return [r.id, r.axis, r.text]; }), [
  ['r-a-a4', 'exp', 'コマ撮りの試し を作った（11/8）'],
  ['r-w-w2', 'exp', 'ビーズの腕輪 を作った（11/5）'],
  ['r-w-w1', 'exp', '駅の屋根 を作った（11/3）']
], '体験 ← 作品と活動（新しい順・JST の日付・作品にした活動は作品の行だけ・変化の無い活動と題の無い作品は出さない）');
eq(S.deriveRecords({ works: [{ id: 'w9', title: '日付なし' }] })[0].text, '日付なし を作った', '日付の分からない作品は日付を付けない');
ok(rec.every(function (r) { return ID_RE.test(r.id); }), '記録の id は data-* に入れられる形');
eq(S.deriveRecords({ works: [{ id: 'w"x <y>', title: 't', date: '2026-11-01' }] })[0].id, 'r-w-w_x__y_', '変わった文字を含む id は置き換える');
var goals = [{ id: 'g1', label: '今後やってみたいこと', text: 'Python のゲーム' }, { id: 'g2', label: 'できるようになりたいこと', text: null }, { id: 'g3', label: '目標', text: '  ' }];
var marks = { 'dig-3dprint': { tomorrow: true }, 'mc-build': { tomorrow: false }, bad: 'x' };
var rint = S.deriveRecords({ goals: goals, marks: marks, titleOf: function (id) { return id === 'dig-3dprint' ? '3D プリンター/モデリング' : null; } });
eq(rint.map(function (r) { return [r.axis, r.text, r.at]; }), [
  ['int', '今後やってみたいこと · Python のゲーム', null],
  ['int', '3D プリンター/モデリング · 明日にとっておいた', null]
], '関心 ← 目標 3 枠の text と「明日にとっておいた」取り組み（空の目標・tomorrow:false は出さない）');
// 基礎学習（18-18: progress のキーは ref。touched = answers 1 つ以上）
var basic = { version: '18', progress: {
  '8250243110000000': { answers: { q1: { value: '1', correct: true } }, buddy: {} },
  '8250243120000000': { answers: { q1: { value: '2', correct: false }, q2: { value: '3', correct: true } }, buddy: {} },
  '8250243150000000': { answers: {}, buddy: {} },
  'jp5/82102D3111000000': { answers: { q1: { value: 'a', correct: true } }, buddy: {} },
  '8350213111100000': { answers: { q1: { value: 'x', correct: true } } },
  '8361213000000000': { answers: { q1: { value: 'x', correct: true } } },
  '82102C3111000000': { answers: { q1: { value: 'x', correct: true } } },
  'zzz': { answers: { q1: {} } },
  '8250253120000000': 'broken'
} };
var rmas = S.deriveRecords({ basic: basic });
eq(rmas.map(function (r) { return r.text; }), ['算数 4 年 の単元に 2 こふれた', '数学 中 1 の単元に 1 こふれた', '国語 4 年 の単元に 1 こふれた', '国語 5 年 の単元に 1 こふれた', '理科 中 1 の単元に 1 こふれた'], '習熟 ← コースごとにふれた単元の数（答えの無い単元・知らない ref・壊れた行は数えない）');
ok(rmas.every(function (r) { return r.axis === 'mas' && r.at === null; }), '習熟の記録は mas・日付なし');
eq(S.deriveRecords({ basic: { progress: 'x' } }), [], '形の違う基礎学習の記録は「記録なし」');
eq(S.deriveRecords({ basic: { progress: { 'XYZ123': { answers: { q: {} } } } }, registry: { XYZ123: 'science5' } })[0].text, '理科 5 年 の単元に 1 こふれた', 'registry があれば codes でコースを引く');

// ---------- records()（DES.state と des.basic-learning.v1 から。書かない） ----------
var store = {}; store['des.basic-learning.v1'] = JSON.stringify({ version: '18', progress: { '8250243110000000': { answers: { q1: { value: '1' } } }, '8250263111100000': { answers: { q1: { value: '1' } } } } });
var L2 = load({
  state: { works: [{ id: 'w1', actId: 'a1', title: '駅の屋根', createdAt: '2026-11-03T03:00:00.000Z' }], activities: [], goals: goals, catalogMarks: { 'mc-build': { tomorrow: true } } },
  data: { catalog: [{ id: 'minecraft', items: [{ id: 'mc-build', title: '建築' }] }] },
  ls: lsOf(store)
});
var r2 = L2.S.records();
eq(r2.map(function (r) { return [r.axis, r.text]; }), [
  ['int', '今後やってみたいこと · Python のゲーム'], ['int', '建築 · 明日にとっておいた'],
  ['exp', '駅の屋根 を作った（11/3）'],
  ['mas', '算数 4 年 の単元に 1 こふれた'], ['mas', '算数 6 年 の単元に 1 こふれた']
], 'records() = 関心・体験・習熟（基礎学習 2 コース分で習熟が 2 行）');
ok(r2.every(function (r) { return Object.keys(r).join(',') === 'id,axis,text,at'; }), 'records() の行は { id, axis, text, at }');
var L3 = load({ state: {}, ls: { getItem: function () { throw new Error('denied'); } } });
eq(L3.S.records(), [], '保存が読めない・state が空でも records() は落ちない');
var L4 = load({ ls: lsOf({ 'des.basic-learning.v1': '{壊れた' }) });
eq(L4.S.records(), [], '壊れた基礎学習の記録は「記録なし」（DES.state が無くても落ちない）');
var L5 = load({ state: { works: [] }, plan: { item: function (id) { return id === 'x1' ? { title: '予定の取り組み' } : null; } } });
L5.ctx.DES.state.catalogMarks = { x1: { tomorrow: true } };
eq(L5.S.records().map(function (r) { return r.text; }), ['予定の取り組み · 明日にとっておいた'], '取り組みの名前は DES.plan.item から引く');

console.log('pass ' + pass + ' / fail ' + fail);
console.log('LIVE_SELF_TEST=' + (fail === 0 ? 'PASS' : 'FAIL'));
process.exit(fail === 0 ? 0 : 1);
