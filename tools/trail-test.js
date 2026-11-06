/* あしあとの純関数テスト（CONTRACT-v3 §Z-14）+ 文言（§Z-11）。node tools/trail-test.js → 最後に TRAIL_TEST=PASS|FAIL */
'use strict';
var path = require('path');
var fs = require('fs');
var vm = require('vm');
var JS = path.join(__dirname, '../app-v3/js');
var MD = require(path.join(JS, 'make-data.js'));
var TDD = require(path.join(JS, 'today-data.js'));
var M = require(path.join(JS, 'make.js'));
var TR = require(path.join(JS, 'trail.js'));

var pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass += 1; } else { fail += 1; console.log('NG  ' + name); }
}
function eq(a, b, name) { ok(JSON.stringify(a) === JSON.stringify(b), name + '  (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }
function freeze(v) { return JSON.stringify(v); }
function clone(v) { return JSON.parse(JSON.stringify(v)); }
// data.js は window.DES に書く（ブラウザ用）ので、別の文脈で読んで正準データだけ取り出す
function loadData() {
  var ctx = {}; ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(JS, 'data.js'), 'utf8'), ctx);
  return clone(ctx.DES.data);
}
var D = loadData(), TODAY = '11/2';
function ids(list) { return list.map(function (e) { return e.id; }); }
function work(a, o) { o = o || {}; return { id: o.id || 'a-' + Math.random().toString(36).slice(2), title: o.title || 'x', state: o.state || 'working', changes: o.changes || [], thread: [], steps: [['一', 'いち'], ['二', 'に']], stepIdx: 0, next: o.next === undefined ? null : o.next, baseTime: o.baseTime || '10:20', origin: 'make', day: o.day }; }

// ---------- TR.normalize ----------
eq(TR.normalize(undefined), { filter: 'all' }, 'normalize 無し → all');
eq(TR.normalize(null), { filter: 'all' }, 'normalize null → all');
eq(TR.normalize('make'), { filter: 'all' }, 'normalize 文字列 → all');
eq(TR.normalize([]), { filter: 'all' }, 'normalize 配列 → all');
eq(TR.normalize({ filter: 'nope' }), { filter: 'all' }, 'normalize 知らない値 → all');
eq(TR.normalize({ filter: 'found', extra: 1 }), { filter: 'found' }, 'normalize 正しい値は残す（他の欄は捨てる）');
eq(TR.FILTERS, ['all', 'make', 'talk', 'found', 'plan', 'own'], 'Z-7 絞り込み 5 つ + AD-10 自分で');
TR.FILTERS.forEach(function (f) { eq(TR.normalize({ filter: f }).filter, f, 'normalize ' + f); });

// ---------- TR.resumeCards（§Z-2） ----------
var seed = MD.seedActivities(), seedBefore = freeze(seed);
var rc = TR.resumeCards(seed, null, TODAY);
eq(ids(rc), ['act-build'], 'Z-2 見本データ: 作業中は 建築 だけ（一区切りの 2 件は出さない）');
eq(freeze(seed), seedBefore, 'resumeCards 元を変えない');
var c0 = rc[0];
eq([c0.title, c0.origin, c0.catalogId, c0.wanted, c0.next], ['建築（大きく）', 'plan', 'mc-build', null, null], 'Z-2 建築: タイトル・出所・取り組み / 前にしたかったこと無し / 次の候補無し（最後の一歩）');
eq(c0.stop, { what: { text: '塔を 2 倍にした' }, time: '10:14', who: 'own', with: '田中さん' }, 'Z-2 止まった場所 = 最後の変化・時刻・誰が（本人 + 人名）');
// 状態: working / paused だけ
var sts = ['working', 'paused', 'closed', 'stopped'].map(function (s, i) { return work(null, { id: 's' + i, state: s }); });
eq(ids(TR.resumeCards(sts, null, TODAY)), ['s0', 's1'], 'Z-2 working と paused だけ');
// 最大 3 枚・並び（lastStop 先頭 → 最後の変化の新しい順 → 変化が無ければ baseTime）
var many = [
  work(null, { id: 'm1', changes: [{ id: 'c', time: '10:30', who: 'own', what: { text: 'a' } }] }),
  work(null, { id: 'm2', changes: [{ id: 'c', time: '11:00', who: 'own', what: { text: 'b' } }] }),
  work(null, { id: 'm3', baseTime: '10:45' }),
  work(null, { id: 'm4', state: 'paused', changes: [{ id: 'c', time: '9:10', who: 'ai', what: { text: 'c' } }] }),
  work(null, { id: 'm5', changes: [{ id: 'c', time: '12:00', who: 'own', what: { text: 'd' } }], day: '10/30' })
];
eq(ids(TR.resumeCards(many, null, TODAY)), ['m2', 'm3', 'm1'], 'Z-2 最大 3 枚・最後の変化（無ければ baseTime）の新しい順・前の日は後ろ');
eq(ids(TR.resumeCards(many, 'make:m4', TODAY)), ['m4', 'm2', 'm3'], 'Z-2 lastStop の活動が先頭');
eq(ids(TR.resumeCards(many, 'talk', TODAY)), ['m2', 'm3', 'm1'], 'Z-2 lastStop が会話なら並びはそのまま');
eq(TR.resumeCards(many, null, TODAY).length, 3, 'Z-2 ≤ 3');
var z = TR.resumeCards([work(null, { id: 'z', baseTime: '10:20' })], null, TODAY)[0];
eq(z.stop, { what: { k: 'opened_stage' }, time: '10:20', who: null, with: null }, 'Z-2 変化 0 なら opened_stage + baseTime');
eq(TR.resumeCards([work(null, { id: 'w1', state: 'paused', next: '屋根を置く' })], null, TODAY)[0].next, null, 'Z-2 次の候補が「前にしたかったこと」と同文なら出さない');
eq(TR.resumeCards([work(null, { id: 'w1', state: 'paused', next: '屋根を置く' })], null, TODAY)[0].wanted, '屋根を置く', 'Z-2 前にしたかったこと = a.next');
eq(TR.resumeCards([work(null, { id: 'w2', next: '' })], null, TODAY)[0].wanted, null, 'Z-2 空文字の next は出さない（§U-11 指摘 7）');
eq(TR.resumeCards([work(null, { id: 'w2', next: '' })], null, TODAY)[0].next, null, 'Z-2 空にした next の後に手順の次を出さない');
eq(TR.resumeCards([work(null, { id: 'w3' })], null, TODAY)[0].next, ['二', 'に'], 'Z-2 次の候補 = stepNext（手順の次の一歩）');
var pausedNext = work(null, { id: 'w4', next: '二' });
eq([TR.resumeCards([pausedNext], null, TODAY)[0].wanted, TR.resumeCards([pausedNext], null, TODAY)[0].next], ['二', null], 'Z-2 next と手順の次が同じ文なら次の候補は出さない');
eq(TR.resumeCards([], null, TODAY), [], 'Z-2 0 件');
eq(TR.resumeCards(null, null, TODAY), [], 'Z-2 null');

// ---------- TR.talkTopics（§Z-4 話した） ----------
var tp = TR.talkTopics(D.talk);
eq(tp.map(function (t) { return t.msgId; }), ['talk-0', 'talk-2', 'talk-4'], 'Z-4 本人の発言 1 つで 1 件（3 件）');
eq(tp[2].text, 'Python のゲーム作りやってみたい', 'Z-4 本人の文はそのまま');
eq(tp[2].reply, 'いいね。14:15 から 15:15 で「ゲーム作り: Python」を入れておく？ 最初は見本を動かすところから', 'Z-4 直後のバディの返事');
eq(tp[0].replyId, 'talk-1', 'Z-4 返事の id');
var mixed = [
  { id: 'b0', who: 'buddy', time: '9:00', text: '前置き' },
  { id: 'c1', who: 'child', time: '9:01', text: 'やあ' },
  { id: 'r1', who: 'record', time: '9:01', text: '記録' },
  { id: 'b1', who: 'buddy', time: '9:02', text: 'あとの返事' },
  { id: 'c2', who: 'child', time: '9:03', text: 'ねえ' },
  { id: 'b2', who: 'buddy', time: '9:03', text: '1 行目\n2 行目' },
  { id: 'c3', who: 'child', time: '9:04', text: 'さいご' }
];
var mt = TR.talkTopics(mixed);
eq(mt.map(function (t) { return [t.msgId, t.reply]; }), [['c1', null], ['c2', '1 行目'], ['c3', null]], 'Z-4 直後がバディでなければ返事なし・返事は 1 行目・前置きのバディだけは件にしない');
eq(TR.talkTopics(null), [], 'talkTopics null');

// ---------- TR.entries（§Z-4） ----------
var works = MD.seedWorks(seed);
var plan = clone(D.plan).concat([
  { id: 'pf', start: '9:00', end: '9:30', title: '終わった行', kind: 'mine', activity: 'mc-build', gone: 'finished' },
  { id: 'pr', start: '9:00', end: '9:30', title: '外した行', kind: 'mine', activity: 'mc-build', gone: 'removed' },
  { id: 'pd', start: '9:00', end: '9:30', title: '見送った行', kind: 'proposed', activity: 'mc-build', gone: 'declined' },
  { id: 'ph', start: '9:00', end: '9:30', title: '隠した行', kind: 'mine', activity: 'mc-build', hidden: true },
  { id: 'pfh', start: '9:00', end: '9:30', title: '隠したまま終わった行', kind: 'mine', activity: 'mc-build', gone: 'finished', hidden: true }
]);
// 記録行のテンプレートは i18n.js の DES.text（会話の記録行は種類を持たないので、テンプレートで見分ける）
var I18N_SRC = fs.readFileSync(path.join(JS, 'i18n.js'), 'utf8');
function tpl(k) { var m = new RegExp('\\n\\s+' + k + ": '([^']*)'").exec(I18N_SRC); return m ? m[1] : null; }
var FIN = tpl('rec_finish'), HIDE = ['rec_decline', 'rec_remove', 'rec_skip'].map(tpl);
eq([FIN, HIDE], ['「{title}」が終わった（{start}〜{end}）', ['「{title}」の提案は見送った', '「{title}」を予定から外した', '運動は今日は見送ることにした']], 'テンプレートを i18n.js から読む');
var msgs = D.talk.concat([
  { id: 'rec-1', who: 'record', time: '10:20', text: '15:15 に「建築」を入れた' },
  { id: 'rec-fin', who: 'record', time: '10:20', text: '「終わった行」が終わった（9:00〜9:30）' },
  { id: 'rec-fin2', who: 'record', time: '10:21', text: '「終わった行」が終わった（9:00〜9:30）' },
  { id: 'rec-dec', who: 'record', time: '10:20', text: '「ゲーム作り: Python」の提案は見送った' },
  { id: 'rec-rem', who: 'record', time: '10:20', text: '「建築」を予定から外した' },
  { id: 'rec-skip', who: 'record', time: '10:20', text: '運動は今日は見送ることにした' },
  { id: 'rec-undo', who: 'record', time: '10:20', text: '「建築」を戻した' },
  { id: 'rec-old', who: 'record', time: '10:19', text: '「戻した行」が終わった（9:00〜9:30）' }
]);
var odai = { slots: [], kept: ['od-seed'], rot: {}, tried: {
  'od-seed': { entries: { watch: true, find: true, play: true, make: false }, checks: [0], found: [{ photo: TDD.get('od-seed').find.photos[0].id, line: '公園で見つけた', time: '11/1 15:40' }, { photo: TDD.get('od-seed').find.photos[1].id, line: null, time: '11/2 10:20' }] },
  'od-sign': { entries: { watch: true, find: false, play: false, make: false }, checks: [], found: [] }
} };
var stopped = M.stop(M.fromSample('mc', { id: 'a-stop', now: '10:20', mode: 'js' }), {}).act;
var stoppedCh = M.test(M.setParam(stopped, 'size', 6)).act;
stoppedCh.state = 'stopped';
var empty = M.fromSample('py', { id: 'a-empty', now: '10:20', mode: 'js' });
var acts = [empty, stoppedCh].concat(seed);
var input = { acts: acts, works: works, messages: msgs, plan: plan, odai: odai, today: TODAY, finishTpl: FIN, hideRec: HIDE }, inBefore = freeze(input);
var es = TR.entries(input);
eq(freeze(input), inBefore, 'entries 元を変えない');
var eids = ids(es);
eq(eids.filter(function (id, i) { return eids.indexOf(id) !== i; }), [], 'Z-14 id 重複なし');
// 並び: day 降順 → time 降順
function dk(d) { var p = String(d).split('/'); return (+p[0]) * 100 + (+p[1]); }
function tm(t) { var p = String(t).split(':'); return p.length === 2 ? (+p[0]) * 60 + (+p[1]) : -1; }
var sorted = es.every(function (e, i) { if (!i) return true; var p = es[i - 1]; return dk(p.day) > dk(e.day) || (dk(p.day) === dk(e.day) && tm(p.time) >= tm(e.time)); });
ok(sorted, 'Z-14 day 降順 → time 降順');
eq(es.map(function (e) { return e.day; }).filter(function (d, i, a) { return a.indexOf(d) === i; }), ['11/2', '11/1', '10/30'], 'Z-4 日は新しい順（今日 → 11/1 → 10/30）');
// 種類ごと
function of(kind) { return es.filter(function (e) { return e.kind === kind; }); }
eq(of('make').map(function (e) { return e.id; }).sort(), ['make:a-stop', 'make:act-build', 'make:act-cap', 'make:act-py'], 'Z-4 作った: 変化のある活動だけ（変化 0 は出さない）');
var mpy = es.filter(function (e) { return e.id === 'make:act-py'; })[0];
eq([mpy.day, mpy.time, mpy.more, mpy.state, mpy.who, mpy.with], ['10/30', '10:31', 4, 'closed', 'own', '田中さん'], 'Z-4 作った: 活動 × 日で 1 件・最後の変化・ほか n 件・一区切り（Z-12 a の day）');
eq(mpy.what, seed[1].changes[4].what, 'Z-4 作った: 最後の変化の what');
eq(es.filter(function (e) { return e.id === 'make:act-cap'; })[0].day, '11/1', 'Z-12 a act-cap は 11/1');
eq(es.filter(function (e) { return e.id === 'make:act-build'; })[0].day, TODAY, 'Z-12 a day が無い活動は今日');
var mst = es.filter(function (e) { return e.id === 'make:a-stop'; })[0];
eq([mst.state, mst.stopRec], ['stopped', { k: 'stopped_rec' }], 'Z-4 作った: やめた活動は既存の記録行を添える');
eq(of('work').length, 4, 'Z-4 作品に残した: 4 件');
var wpy = es.filter(function (e) { return e.id === 'work:w-seed-py'; })[0];
eq([wpy.day, wpy.time, wpy.status, wpy.like, !!wpy.art], ['10/30', '10:31', 'done', '星が 6 つになると、どれを取りに行くか迷うところ', true], 'Z-4 作品: 日・時刻・状態・気に入っているところ・絵');
eq(es.filter(function (e) { return e.id === 'work:w-seed-build'; })[0].status, 'trial', 'Z-4 作品: 試作');
eq(of('talk').map(function (e) { return e.msgId; }), ['talk-4', 'talk-2', 'talk-0'], 'Z-4 話した: 新しい順');
var pl = of('plan');
eq(pl.map(function (e) { return e.id; }), ['rec:rec-undo', 'rec:rec-1', 'rec:rec-old', 'plan:pf'], 'Z-4 予定の記録: 終わった行 + 会話の記録行（見送り・外した・非表示の行とその記録行は出さない）');
eq(pl[3].recId, 'rec-fin', 'Z-4 終わった行と同じ終わりの記録行は 1 回だけ（行にまとめ、記録行の id を持つ）');
ok(!es.some(function (e) { return /^rec:rec-(fin|fin2|dec|rem|skip)$/.test(e.id); }), 'Z-4 見送った・外した・運動を見送った・終わった行と重なる 記録行は出さない');
var raw = ids(TR.entries({ messages: msgs, plan: plan, today: TODAY }).filter(function (e) { return e.kind === 'plan'; }));
eq(raw.length, 9, 'entries テンプレートを渡さなければ記録行はすべて出る（8 + 終わった行 1）');
eq([pl[3].sub, pl[3].title, pl[3].start, pl[3].end, pl[3].catalogId], ['finished', '終わった行', '9:00', '9:30', 'mc-build'], 'Z-4 終わった行: タイトル・時間・取り組み');
eq([pl[1].sub, pl[1].text], ['record', '15:15 に「建築」を入れた'], 'Z-4 記録行の文はそのまま');
var fd = of('found');
eq(fd.map(function (e) { return [e.id, e.day, e.time, e.line]; }), [['found:od-seed:1', '11/2', '10:20', null], ['found:od-seed:0', '11/1', '15:40', '公園で見つけた']], 'Z-4 見つけた: odai.tried[id].found[]・日と時刻・本人の 1 行');
ok(!es.some(function (e) { return e.odaiId === 'od-sign'; }), 'Z-4 入口を開いただけ・とっておいたは出さない');
ok(!es.some(function (e) { return /declined|pauseCount|offered/.test(JSON.stringify(e)); }), 'Z-4 断った回数・背中押しは出さない');
eq(TR.entries({}), [], 'entries 空');
eq(TR.entries({ messages: [{ id: 'r', who: 'record', time: '1:00', text: '「a.b*c」の提案は見送った' }], hideRec: HIDE, today: TODAY }), [], 'hideRec はテンプレートの記号をそのまま文字として扱う');
eq(ids(TR.entries({ messages: [{ id: 'r', who: 'record', time: '1:00', text: '前に「a」の提案は見送った' }], hideRec: HIDE, today: TODAY })), ['rec:r'], 'hideRec は行全体が一致する時だけ');
eq(TR.entries({ acts: [empty], today: TODAY }), [], 'entries 変化 0 の活動だけなら 0 件');
// 同じ時刻は新しく足されたものが先
var same = TR.entries({ messages: [{ id: 'x1', who: 'record', time: '10:20', text: 'a' }, { id: 'x2', who: 'record', time: '10:20', text: 'b' }], today: TODAY });
eq(ids(same), ['rec:x2', 'rec:x1'], 'Z-14 同じ時刻は新しく足されたものが先');

// ---------- TR.groupByDay / TR.filter ----------
var g = TR.groupByDay(es, TODAY);
eq(g.map(function (x) { return [x.day, x.isToday]; }), [['11/2', true], ['11/1', false], ['10/30', false]], 'groupByDay 日ごと・今日の印');
eq(g.reduce(function (n, x) { return n + x.items.length; }, 0), es.length, 'groupByDay 件数を変えない');
eq([].concat.apply([], g.map(function (x) { return ids(x.items); })), eids, 'groupByDay 並びを変えない');
eq(TR.groupByDay([], TODAY), [], 'groupByDay 空');
eq(ids(TR.filter(es, 'all')), eids, 'filter all = すべて');
eq(TR.filter(es, 'make').map(function (e) { return e.kind; }).filter(function (k, i, a) { return a.indexOf(k) === i; }).sort(), ['make', 'work'], 'filter 作った = 作った + 作品に残した');
eq(TR.filter(es, 'talk').every(function (e) { return e.kind === 'talk'; }) && TR.filter(es, 'talk').length, 3, 'filter 話した');
eq(TR.filter(es, 'found').length, 2, 'filter 見つけた');
eq(TR.filter(es, 'plan').length, 4, 'filter 予定');
eq(TR.filter(es, 'zzz').length, es.length, 'filter 知らない値 = すべて');
eq(TR.filter(TR.entries({ messages: D.talk, today: TODAY }), 'found'), [], 'filter 0 件');
// AD-10 / 18-7 自分で: 手伝いの印が無いものだけ
eq(ids(TR.filter(es, 'own')), ['make:a-stop', 'found:od-seed:1', 'rec:rec-undo', 'rec:rec-1', 'rec:rec-old', 'work:w-seed-build', 'talk:talk-4', 'talk:talk-2', 'talk:talk-0', 'plan:pf', 'found:od-seed:0', 'make:act-cap', 'work:w-seed-circuit', 'work:w-seed-py', 'work:w-seed-py-trial'],
  'own 印の無い見本データ: 人名の付いた作った（make:act-build・make:act-py）だけ外れる（固定の期待値）');
ok(!TR.filter(es, 'own').some(function (e) { return e.id === 'make:act-py' || e.id === 'make:act-build'; }), 'own 最後の変化に人名がある作ったは出さない');
var helpedMsgs = [
  { id: 'h1', who: 'child', time: '10:30', text: 'by あり', by: 'tanaka' }, { id: 'h2', who: 'buddy', time: '10:30', text: '返事' },
  { id: 'h3', who: 'child', time: '10:31', text: 'by なし' },
  { id: 'h4', who: 'record', time: '10:32', text: '10:00 に「x」を入れた', by: 'tanaka' },
  { id: 'h5', who: 'record', time: '10:33', text: '「行 by」が終わった（9:00〜9:30）' },
  { id: 'h6', who: 'record', time: '10:34', text: '「記録 by」が終わった（9:40〜9:50）', by: 'tanaka' },
  { id: 'h7', who: 'record', time: '10:35', text: '「どちらも無し」が終わった（9:55〜10:00）' }
];
var helpedPlan = [
  { id: 'f1', start: '9:00', end: '9:30', title: '行 by', kind: 'mine', gone: 'finished', by: 'tanaka' },
  { id: 'f2', start: '9:40', end: '9:50', title: '記録 by', kind: 'mine', gone: 'finished' },
  { id: 'f3', start: '9:55', end: '10:00', title: 'どちらも無し', kind: 'mine', gone: 'finished' }
];
var hw = [{ id: 'w-by', title: 't', by: 'tanaka', date: '11/2' }, { id: 'w-own', title: 'u', date: '11/2' }];
var hodai = { tried: { 'od-a': { found: [{ photo: 'p', time: '11/2 10:00' }] }, 'od-b': { found: [{ photo: 'p', time: '11/2 10:01' }] } } };
var he = TR.entries({ messages: helpedMsgs, plan: helpedPlan, works: hw, odai: hodai, today: TODAY, finishTpl: FIN, helped: { odai: { 'od-a': true } } });
eq(ids(TR.filter(he, 'own')).sort(), ['found:od-b:0', 'plan:f3', 'talk:h3', 'work:w-own'], 'own 話した・記録・終わった予定（行だけ by / 記録だけ by）・作品・helped の見つけた を外す');
eq(he.filter(function (e) { return e.id === 'talk:h1'; })[0].by, 'tanaka', 'AD-10 m.by が話したの entry に渡る');
eq(he.filter(function (e) { return e.id === 'plan:f2'; })[0].by, 'tanaka', '18-7 まとめた終わりの記録行の by が終わった行に渡る');
eq(TR.talkTopics([{ id: 'c', who: 'child', text: 'a' }, { id: 'b', who: 'buddy', text: 'r', ideaReply: 'i1' }])[0].reply, null, '18-5 ideaReply は本人の発言の返事にしない');

// ---------- TR.buddyLine（§Z-3 / Z-8） ----------
eq(TR.buddyLine([], true), { kind: 'neutral' }, 'Z-3 上段が無い時は中立の 1 文');
eq(TR.buddyLine([], false), { kind: 'empty' }, 'Z-8 どれも無い時は空状態の 1 文');
eq(TR.buddyLine([{ id: 'a', wanted: '屋根を置く', next: ['二', 'に'] }]), { kind: 'resume', step: { text: '屋根を置く' }, actId: 'a' }, 'Z-3 {step} = 前にしたかったこと');
eq(TR.buddyLine([{ id: 'a', wanted: null, next: ['二', 'に'] }]), { kind: 'resume', step: ['二', 'に'], actId: 'a' }, 'Z-3 無ければ 次の候補');
eq(TR.buddyLine([{ id: 'a', wanted: null, next: null }]), null, 'Z-3 どちらも無ければ出さない');
eq(TR.buddyLine(rc), null, 'Z-3 見本データ（建築は次の一歩が無い）は出さない');

// ---------- M.fromTrail（§Z-5） ----------
var py = seed.filter(function (a) { return a.id === 'act-py'; })[0], pyBefore = freeze(py);
var n1 = M.fromTrail(py, { id: 'a-new', now: '10:20', mode: 'js' });
eq(freeze(py), pyBefore, 'fromTrail 元の活動を変えない');
eq([n1.id, n1.origin, n1.fromActId, n1.catalogId, n1.sampleId, n1.state, n1.changes.length, n1.theme], ['a-new', 'trail', 'act-py', 'prog-python', 'py', 'working', 0, 'py'], 'Z-5 見本から: 新しい活動・あしあとから・元の id・取り組みを引き継ぐ・変化 0');
eq(n1.stage, { kind: 'sample', theme: 'py', variant: MD.theme('py').sample, values: MD.variantValues('py', MD.theme('py').sample) }, 'Z-5 見本の始まりから（元の今の値ではない）');
ok(n1.stage.values.count !== py.stage.values.count || n1.stage.values.speed !== py.stage.values.speed, 'Z-5 元の変化は持ち込まない');
ok(n1.day === undefined, 'Z-5 新しい活動は今日（day を持たない）');
var tx = M.fromText('マイクラで塔を建てたい', { id: 'a-q', now: '10:20', mode: 'js', origin: 'talk' });
var n2 = M.fromTrail(tx, { id: 'a-q2', now: '10:20', mode: 'js' });
eq([n2.quote, n2.theme, n2.origin, n2.fromActId, n2.shelf.length, n2.candidate], [{ text: 'マイクラで塔を建てたい', removed: false }, 'mc', 'trail', 'a-q', 3, true], 'Z-5 言葉から: 同じ引用・仮の案 3 つ');
var build = seed[0], bBefore = freeze(build), n3 = M.fromTrail(build, { id: 'a-b2', now: '10:20', mode: 'js' });
eq(freeze(build), bBefore, 'fromTrail 建築を変えない');
eq([n3.stepsKind, n3.steps, n3.ext.photos, n3.ext.visible, n3.ext.link, n3.changes.length, n3.catalogId, n3.stepIdx], ['build', build.steps, [], [], build.ext.link, 0, 'mc-build', 0], 'Z-5 build: 同じ手順の空の活動');
ok(n3.steps !== build.steps, 'Z-5 手順は写し（同じ配列を共有しない）');
var cap = seed[2], n4 = M.fromTrail(cap, { id: 'a-c2', now: '10:20', mode: 'js' });
eq([n4.stepsKind, n4.theme, n4.steps, n4.ext.photos.length, n4.title], ['ext', 'circuit', cap.steps, 0, cap.title], 'Z-5 ext: 同じ手順の空の ext 活動');
// お題から: 既存の再利用をしない（同じお題の活動があっても新しく）
var odSeed = TDD.get('od-seed'), oa = M.fromOdai(odSeed, { id: 'a-od', mode: 'js', now: '10:20', acts: [] }).act;
var n5 = M.fromTrail(oa, { id: 'a-od2', now: '10:20', mode: 'js', recText: 'rec' });
eq([n5.id, n5.odaiId, n5.origin, n5.fromActId, n5.stepsKind], ['a-od2', 'od-seed', 'trail', 'a-od', oa.stepsKind], 'Z-5 お題から: 同じお題の新しい活動（再利用しない）');
ok(n5.thread.some(function (m) { return m.who === 'record' && m.k === 'odai_rec' && m.text === 'rec'; }), 'Z-5 お題の記録 1 行を持つ');
var themed = TDD.topics.filter(function (t) { return t.makeTheme; })[0], ta = M.fromOdai(themed, { id: 'a-ot', mode: 'js', now: '10:20', acts: [] }).act;
var n6 = M.fromTrail(ta, { id: 'a-ot2', now: '10:20', mode: 'js', odai: themed });
eq([n6.odaiId, n6.theme, n6.stage && n6.stage.kind], [themed.id, ta.theme, 'sample'], 'Z-5 お題（3 題材）から: 同じ題材の見本から');
// 始めの作業対象だけを持つ活動 / 何も無い活動
var bare = clone(M.fromSample('circuit', { id: 'a-bare', now: '10:20', mode: 'js' }));
bare.sampleId = null;
var n7 = M.fromTrail(bare, { id: 'a-bare2', now: '10:20', mode: 'js' });
eq([n7.stage, n7.base, n7.theme], [bare.base, bare.base, 'circuit'], 'Z-5 始めの作業対象から');
ok(n7.stage !== bare.base, 'Z-5 作業対象は写し');
var none = clone(bare); none.base = null; none.stage = null;
var n8 = M.fromTrail(none, { id: 'a-none2', now: '10:20', mode: 'js' });
eq([n8.theme, n8.candidate, n8.shelf.length, n8.origin], ['circuit', true, 3, 'trail'], 'Z-5 始まりが分からない時は同じ題材の仮の案');
// 自己理解の工夫から（題材 tool・selfLink）: 同じ紐づけ・同じ言葉（出所つき）から
var sa = M.fromSelf({ id: 'a-self', linkId: 'k-1', text: '話す前にメモを見る', src: 'buddy', variant: 'memo', mode: 'js', now: '10:20' }), saBefore = freeze(sa);
var n9 = M.fromTrail(sa, { id: 'a-self2', now: '10:20', mode: 'js' });
eq(freeze(sa), saBefore, 'fromTrail 自己理解の活動を変えない');
eq([n9.theme, n9.selfLink, n9.quote, n9.origin, n9.fromActId, n9.stage && n9.stage.variant, n9.changes.length], ['tool', 'k-1', sa.quote, 'trail', 'a-self', sa.base.variant, 0], 'Z-5 自己理解から: 同じ紐づけ・同じ言葉（出所つき）・同じ案から');
eq(M.fromTrail(null, { id: 'x' }), null, 'fromTrail 活動なし → null');
eq(M.fromTrail(py, {}), null, 'fromTrail id なし → null');

// ---------- 文言（§Z-11）: 新 key は [中, 小]・禁止語なし ----------
var i18n = fs.readFileSync(path.join(JS, 'i18n.js'), 'utf8');
var block = i18n.slice(i18n.indexOf('// ---- §Z あしあと'));
block = block.slice(0, block.indexOf('};'));
var keys = [];
block.replace(/^\s+((?:tr_\w+)|origin_trail): \[('[^']*'), ('[^']*')\],?$/gm, function (all, k, a, b) { keys.push([k, a.slice(1, -1), b.slice(1, -1)]); return all; });
ok(keys.length >= 25, 'Z-11 あしあとの key（' + keys.length + '）が末尾の 1 か所にある');
keys.forEach(function (k) { ok(/^tr_|^origin_trail$/.test(k[0]) && k[1] && k[2], 'Z-11 ' + k[0] + ' は [中, 小]'); });
var BAD = /点数|ランキング|順位|評価|成績|レベル|集中力|得意|苦手|上手|成長|頑張|すごい|版|未完了|やりかけ|できなかった|残り|まだ|データがありません|学びのバディ/;
keys.forEach(function (k) { ok(!BAD.test(k[1] + k[2]), 'Z-11 ' + k[0] + ' に禁止語が無い'); });
eq(keys.filter(function (k) { return k[0] === 'origin_trail'; }).map(function (k) { return [k[1], k[2]]; }), [['あしあとから', 'あしあとから']], 'Z-11 origin_trail');
function val(k) { var hit = keys.filter(function (x) { return x[0] === k; })[0]; return hit ? [hit[1], hit[2]] : null; }
eq(val('tr_intro'), ['前にしたこと・話したこと・見つけたものが、ここに残るよ', 'まえにしたこと・はなしたこと・見つけたものが、ここにのこるよ'], 'Z-3 中立の 1 文（verbatim）');
eq(val('tr_empty'), ['話す か 作る から始めると、ここにあしあとが残るよ', 'はなす か つくる からはじめると、ここにあしあとがのこるよ'], 'Z-8 空状態の 1 文（verbatim）');
eq(val('tr_resume_h'), ['前はここまで', 'まえはここまで'], 'Z-2 上段の見出し（verbatim）');
eq(['all', 'make', 'talk', 'found', 'plan'].map(function (f) { return val('tr_f_' + f); }), [['すべて', 'すべて'], ['作った', 'つくった'], ['話した', 'はなした'], ['見つけた', '見つけた'], ['予定', '予定']], 'Z-7 絞り込みの名前（verbatim）');
eq(val('tr_filter_empty')[0], '{filter}のあしあとは、ここに出るよ', 'Z-7 0 件の 1 文（verbatim）');
eq(val('tr_retry_toast')[0], 'もう一度、{title}を始めたよ', 'Z-5 トースト（verbatim）');
eq(val('tr_more')[0], 'ほか {n} 件の変化', 'Z-4 ほか {n} 件の変化（verbatim）');
// 既存 key は書き換えていない（resume_push / closed / stopped_rec）
ok(i18n.indexOf("resume_push: ['前はここまで。{step}から始める？', '前はここまで。{step}からはじめる？']") >= 0, 'Z-3 既存 resume_push をそのまま使う');
// あしあとの画面のコードにも禁止語を書かない
ok(!BAD.test(fs.readFileSync(path.join(JS, 'trail.js'), 'utf8')), 'Z-11 trail.js に禁止語が無い');

console.log('trail-test: ' + pass + ' pass, ' + fail + ' fail');
console.log('TRAIL_TEST=' + (fail ? 'FAIL' : 'PASS'));
process.exitCode = fail ? 1 : 0;
