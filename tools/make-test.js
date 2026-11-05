/* 作る の純関数テスト（CONTRACT-v3 §U-4）。node tools/make-test.js → 最後に MAKE_TEST=PASS|FAIL */
'use strict';
var path = require('path');
var MD = require(path.join(__dirname, '../app-v3/js/make-data.js'));
var M = require(path.join(__dirname, '../app-v3/js/make.js'));

var pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass += 1; } else { fail += 1; console.log('NG  ' + name); }
}
function eq(a, b, name) { ok(JSON.stringify(a) === JSON.stringify(b), name + '  (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }
function sample(id) { return M.fromSample(id || 'mc', { id: 'a1', now: '10:20', mode: 'js' }); }
function lastCh(a) { return a.changes[a.changes.length - 1]; }

// ---------- 題材の決め方（U-2） ----------
eq(M.pickTheme('Python のゲーム作りやってみたい'), 'py', 'pickTheme Python');
eq(M.pickTheme('マイクラで家'), 'mc', 'pickTheme マイクラ');
eq(M.pickTheme('建築の続き'), 'mc', 'pickTheme 建築');
eq(M.pickTheme('LED を光らせたい'), 'circuit', 'pickTheme LED（大文字小文字）');
eq(M.pickTheme('電池で動かす'), 'circuit', 'pickTheme 電池');
eq(M.pickTheme('プログラムを書く'), 'py', 'pickTheme プログラム');
eq(M.pickTheme(''), 'mc', 'pickTheme 空 → マイクラ');
eq(M.pickTheme('絵を描きたい'), 'mc', 'pickTheme どれも無し → マイクラ');
eq(M.pickTheme('コマンドで Python'), 'mc', 'pickTheme 両方 → 先の規則（マイクラ）');

// ---------- 見本から ----------
var a = sample('mc');
eq(a.stage.kind, 'sample', 'fromSample stage.kind');
eq(a.stage.values, { size: 4, block: 0 }, 'fromSample 既定値');
eq(a.thread.length, 1, 'fromSample 返事 1 つ');
eq(a.thread[0].r, 'open', 'fromSample 見本を開いた直後の返事');
eq(a.steps.length, 3, 'fromSample 一歩 3 つ');
eq(M.isDirty(a), false, 'fromSample 直後は試していない値なし');
eq(M.canRevert(a), false, 'fromSample 直後は前に戻せない');

// ---------- setParam（範囲で止める） ----------
var b = M.setParam(a, 'size', 99);
eq(b.stage.values.size, 8, 'setParam 上限');
b = M.setParam(a, 'size', -3);
eq(b.stage.values.size, 2, 'setParam 下限');
eq(a.stage.values.size, 4, 'setParam は元を変えない');
eq(M.setParam(a, 'nokey', 3), a, 'setParam 無い key は同じものを返す');
b = M.setParam(a, 'size', 6);
eq(M.isDirty(b), true, 'setParam 後は「まだ試していない」');

// ---------- 試す / commitChange ----------
var r = M.test(b);
ok(r && r.change, 'test 変化が積まれる');
eq(r.change.who, 'own', 'test 本人');
eq(r.change.kind, 'test', 'test kind');
eq(r.change.what, { k: 'changed_one', v: { label: ['大きさ', '大きさ'], value: ['6', '6'] } }, 'test 何を変えた（1 つ）');
eq(r.change.time, '10:22', 'test 時刻（モックの時計 +2 分）');
eq(r.act.stepIdx, 1, 'test 変えて試すと一歩進む');
eq(M.isDirty(r.act), false, 'test 後は確かめ済み');
eq(r.param, ['大きさ', '大きさ'], 'test 変えた所の名前');
var r2 = M.test(r.act);
eq(r2.same, true, 'test 変えずに 2 回目は積まない');
eq(r2.act.changes.length, 1, 'test 変えずに 2 回目は変化数そのまま');
var r0 = M.test(a);
eq(r0.change.what, { k: 'test_same' }, 'test 初回は変えなくても「そのまま試した」');
eq(r0.act.stepIdx, 0, 'test 変えずに試しても一歩は進まない');
var two = M.test(M.setParam(M.setParam(a, 'size', 5), 'block', 2));
eq(two.change.what.k, 'changed_two', 'test 2 か所変えた');
eq(two.change.what.v.bv, ['オークの板', 'オークのいた'], 'test 名前のある値は名前で');
var cc = M.commitChange(Object.assign({}, a, { state: 'paused', resumeNote: { k: 'x' } }), { who: 'own', kind: 'test', what: { k: 'test_same' } });
eq(cc.act.state, 'working', 'commitChange 止まっていた活動は作業中へ');
eq(cc.act.resumeNote, null, 'commitChange 続きの一言を消す');
ok(cc.change.id && cc.change.id.indexOf('a1-c') === 0, 'commitChange id');
eq(MD.result(r.act.stage, 'js'), '石で 6×6×6 の箱 · ブロック 152 個', 'result マイクラ（6^3-4^3）');
eq(MD.mcCount('tower', 4), 9 * 8 - 6, 'mcCount 塔');
eq(MD.circuitNums('single', { volt: 1, ohm: 2 }), { V: 3, R: 330, I: 9.1, B: 30 }, 'circuitNums 3V/330Ω');
eq(MD.circuitNums('series', { volt: 1, ohm: 2 }).V, 6, 'circuitNums 直列は 2 倍');

// ---------- 戻す / 取り消し ----------
var t1 = M.test(M.setParam(a, 'size', 6)).act;
var t2 = M.test(M.setParam(t1, 'size', 8)).act;
var rv = M.revert(t2, null);
ok(rv, 'revert 前に戻す');
eq(rv.act.stage.values.size, 6, 'revert 直前の 1 つ前の状態へ');
eq(rv.change.kind, 'revert', 'revert 変化として積む');
eq(rv.change.what, { k: 'reverted_rec', v: { time: t1.changes[0].time } }, 'revert 「{time} のところに戻した」');
eq(rv.act.changes.length, 3, 'revert 履歴は消えない');
var un = M.undoRevert(rv.act, rv.undo);
eq(un.changes.length, 2, 'undoRevert 取り消すと積まれなかったことに');
eq(un.stage.values.size, 8, 'undoRevert 元の値');
eq(M.undoRevert(M.test(M.setParam(rv.act, 'size', 3)).act, rv.undo).changes.length, 4, 'undoRevert 後に変化があれば何もしない');
var dirty = M.setParam(t2, 'size', 2);
var rvd = M.revert(dirty, null);
eq(rvd.act.stage.values.size, 8, 'revert 試していない値は最後に確かめたところへ');
var rvTo = M.revert(t2, t2.changes[0].id);
eq(rvTo.act.stage.values.size, 6, 'revert ここに戻す');
eq(M.revert(t2, t2.changes[1].id), null, 'revert 今と同じところへは戻さない');
eq(M.revert(t2, 'nope'), null, 'revert 無い id');
var rvBase = M.revert(t2, '@base');
eq(rvBase.act.stage.values, { size: 4, block: 0 }, 'revert 始めの状態へ');
var one = M.test(M.setParam(a, 'size', 7)).act;
eq(M.revert(one, null).act.stage.values.size, 4, 'revert 変化 1 つなら始めの状態へ');

// ---------- 任せる / 棚 ----------
eq(M.leaveOptions(a), ['find', 'one'], 'leaveOptions 見本');
var lv = M.leave(a, 'find');
eq(lv.ids.length, 1, 'leave find 1 枚');
eq(lv.act.shelf[0].state, 'making', 'leave 作っている');
eq(lv.act.shelf[0].kind, 'value', 'leave 見本の値はカード（value）');
eq(lv.act.shelf[0].values, { size: 6, block: 1 }, 'leave find の値');
var lvSame = M.leave(M.setParam(M.setParam(a, 'size', 6), 'block', 1), 'find');
eq(lvSame.act.shelf[0].values, { size: 5, block: 2 }, 'leave find 今と同じなら別の値');
var st = M.settle(lv.act, lv.ids);
eq(st.shelf[0].state, 'new', 'settle 新しいカード');
eq(M.adopt(lv.act, lv.ids[0]), null, 'adopt 作っている間は選べない');
var ad = M.adopt(st, lv.ids[0]);
eq(ad.act.stage.values, { size: 6, block: 1 }, 'adopt 作業対象に取り込む');
eq(ad.act.stage.kind, 'sample', 'adopt 値のカードは見本のまま');
eq(ad.change.who, 'ai', 'adopt 変化 +1 バディ');
eq(ad.change.what.k, 'left_rec', 'adopt 「バディが {what}」');
eq(ad.act.shelf[0].state, 'adopted', 'adopt 採用の印');
var one2 = M.leave(a, 'one');
eq(one2.act.shelf[0].values.size, 5, 'leave 1 か所変えて（大きさ +1）');
var max = M.leave(M.setParam(a, 'size', 8), 'one');
eq(max.act.shelf[0].values.size, 2, 'leave 上限を越えたら最小へ');
// 試作（draft）
var cand = M.fromText('Python のゲーム作りやってみたい', { id: 'c1', now: '10:20', mode: 'js' });
eq(cand.theme, 'py', 'fromText 題材');
eq(cand.quote, { text: 'Python のゲーム作りやってみたい', removed: false }, 'fromText 引用枠');
eq(cand.shelf.map(function (c) { return c.variant; }), ['dodge', 'coin', 'maze'], 'fromText 仮の案 3 つ（固定）');
eq(cand.shelf.every(function (c) { return c.state === 'new'; }), true, 'fromText 案は選べる状態');
eq(cand.stage, null, 'fromText 作業対象は空');
eq(cand.thread[0].r, 'land', 'fromText 意図つき着地の返事');
eq(cand.steps[0], MD.CANDIDATE_STEP, 'fromText 最初の一歩 = 案を選ぶ');
var ca = M.adopt(cand, cand.shelf[1].id);
eq(ca.act.stage, { kind: 'draft', theme: 'py', variant: 'coin', values: { speed: 2, count: 5 } }, 'adopt 試作を取り込む');
eq(ca.act.shelf.map(function (c) { return c.state; }), ['passed', 'adopted', 'passed'], 'adopt 他の案は見送った案へ');
eq(ca.change.what, { k: 'adopt_rec', v: { what: ['コインを集めるゲーム', 'コインをあつめるゲーム'] } }, 'adopt 「バディが{what}を作った」');
eq(ca.act.stepIdx, 1, 'adopt 一歩進む');
var re = M.adopt(ca.act, ca.act.shelf[0].id);
eq(re.act.shelf[1].state, 'adopted', 'adopt 見送った案から「やっぱりこれにする」でも他は変えない');
eq(M.leaveOptions(ca.act), ['redo', 'two', 'fix'], 'leaveOptions 試作');
var tw = M.leave(ca.act, 'two');
eq(tw.ids.length, 2, 'leave 別の案を 2 つ');
eq(tw.act.shelf.slice(0, 2).map(function (c) { return c.variant; }), ['dodge', 'maze'], 'leave 2 つは今の案以外');
var rd = M.leave(ca.act, 'redo');
eq(rd.act.shelf[0].variant, 'maze', 'leave 作り直して = 次の案');
var fx = M.leave(ca.act, 'fix');
eq(fx.act.shelf[0].values, { speed: 2, count: 6 }, 'leave ここだけ直して = 2 つ目の値');
var asp = M.leave(ca.act, 'aspect', { aspect: 1 });
eq(asp.opt, 'one', 'leave 「どこが違う？」大きさ → 1 か所変える');
var rm = M.remake(cand, cand.shelf[0].id, 'redo');
eq(rm.act.shelf[0].variant, 'coin', 'remake カードを土台に作り直す');
eq(M.remake(cand, 'nope', 'redo').ids, [], 'remake 無いカード');
var cm = M.cancelMaking(tw.act, tw.ids[0]);
eq(cm.shelf.length, tw.act.shelf.length - 1, 'cancelMaking 作っているカードをやめる');
eq(M.cancelMaking(cand, cand.shelf[0].id).shelf.length, 3, 'cancelMaking 出来上がったカードは消さない');
// 違う
var dc = M.decline(cand, cand.shelf[0].id);
eq(dc.act.shelf[0].state, 'passed', 'decline 見送った案へ');
eq(M.decline(dc.act, cand.shelf[0].id), null, 'decline 見送った案はもう一度は畳まない');
eq(M.undoDecline(dc.act, dc.undo).shelf[0].state, 'new', 'undoDecline 戻す');
eq(M.decline(tw.act, tw.ids[0]), null, 'decline 作っている間はできない');
// 外の記録の任せる（計算・手順・コマンド）
var ext = M.fromExt('link', { id: 'e1', now: '10:20', mode: 'js' });
eq(ext.ext.photos.length, 0, 'fromExt リンクは写真なし');
eq(M.leaveOptions(ext), ['calc', 'steps', 'cmd'], 'leaveOptions 外の記録');
var nt = M.settle(M.leave(ext, 'calc').act);
eq(nt.shelf[0].kind, 'note', 'leave 寸法を計算して = メモ');
var adn = M.adopt(nt, nt.shelf[0].id);
eq(adn.act.stage.kind, 'note', 'adopt メモを作業対象へ');
var cmd = M.settle(M.leave(ext, 'cmd').act);
eq([cmd.shelf[0].kind, cmd.shelf[0].variant], ['draft', 'roof'], 'leave コマンドを作って = 試作（屋根）');

// ---------- 写真・スクショ ----------
var ph = M.fromExt('photo', { id: 'p1', now: '10:20', mode: 'js' });
eq(ph.ext.photos.length, 1, 'fromExt 写真 1 枚');
eq(ph.changes.length, 1, 'fromExt 写真 = 変化 1 つ');
var ap = M.addPhoto(ph, 'shot');
eq(ap.act.ext.photos.length, 2, 'addPhoto 1 枚足す');
eq(ap.photo.n, 1, 'addPhoto 線画は順に');
eq(ap.change.kind, 'shot', 'addPhoto スクショ');
eq(ap.change.what, { k: 'added_shot' }, 'addPhoto 何を変えた（未回答）');
var cyc = ph;
for (var i = 0; i < 4; i++) cyc = M.addPhoto(cyc, 'photo').act;
eq(cyc.ext.photos[4].n, 0, 'addPhoto 線画は 4 枚で一巡');
var dirtyPh = M.addPhoto(M.setParam(a, 'size', 7), 'photo');
eq(dirtyPh.change.snap.values.size, 4, 'addPhoto 試していない値は写真の変化に入れない');
var dp = M.describePhoto(ap.act, ap.change.id, 1, '  塔を 2 倍にした ');
eq(dp.what, { text: '塔を 2 倍にした' }, 'describePhoto 1 行は本人の言葉');
eq(lastCh(dp.act).aspect, 1, 'describePhoto 候補も持つ');
var dp2 = M.describePhoto(ap.act, ap.change.id, 0, '');
eq(dp2.what, { k: 'changed_aspect', v: { what: ['形', '形'] } }, 'describePhoto 候補だけ');
var dp3 = M.describePhoto(ap.act, ap.change.id, 4, '');
eq(dp3.what, null, 'describePhoto 「それ以外」だけなら何も変えない');
eq(M.describePhoto(ap.act, 'nope', 0, '').what, null, 'describePhoto 無い変化');

// ---------- 背中押し（§6-8 の 3 ケース） ----------
var full = M.test(M.setParam(M.test(M.setParam(a, 'size', 6)).act, 'block', 1)).act;
eq(full.stepIdx, 2, '一歩が残り 1 つ');
var p1 = M.pause(full);
eq(p1.kind, 'step', 'pause (1) 一歩を 1 つ');
eq(p1.vars, { step: MD.theme('mc').steps[2], min: 5 }, 'pause (1) 一歩と分');
var noTest = M.pause(M.addPhoto(full, 'photo').act);
eq(noTest.kind, 'accept', 'pause 直前が「試す」でなければ受け止め');
var tired = JSON.parse(JSON.stringify(full));
tired.thread.push({ id: 'x', who: 'child', text: 'ちょっと疲れた' });
var p2 = M.pause(tired);
eq(p2.kind, 'next', 'pause (2) 疲れた → 次回へ');
eq(p2.key, 'push_next_msg', 'pause (2) 文');
eq(p2.vars.step, { k: 'tokoro', v: { what: MD.theme('mc').steps[2] } }, 'pause (2) 「{step}ところから」');
var tired2 = JSON.parse(JSON.stringify(full));
tired2.thread.push({ id: 'x', who: 'child', text: 'めんどくさい' });
eq(M.pause(tired2).kind, 'next', 'pause (2) めんどくさい');
var bored = JSON.parse(JSON.stringify(full));
bored.thread.push({ id: 'x', who: 'child', text: 'もう飽きた' });
eq(M.pause(bored).kind, 'accept', 'pause (3) 休みたい旨 → 受け止めるだけ');
var second = M.confirmPause(full, { next: '', closed: false, push: null });
eq(M.pause(M.resume(second)).kind, 'accept', 'pause (3) 今日 2 回目 → 受け止めるだけ');
var decl = M.confirmPause(full, { next: '', closed: false, push: p1 });
eq(decl.declined, 1, 'confirmPause 一歩を出して区切った = 断った（内部値）');
eq(M.pause(M.resume(decl)).kind, 'accept', 'pause (3) 断った後 → 受け止めるだけ');
var pa = M.pause(a);
eq(pa, { kind: 'accept', key: 'accept_msg', vars: { last: { k: 'tokoro', v: { what: { k: 'opened_stage' } } } }, step: null }, 'pause 変化なし → 受け止め（作業台を開いたところ）');
var cp = M.confirmPause(full, { next: ' 窓を増やす ', closed: true, push: p1 });
eq(cp.state, 'closed', 'confirmPause 一区切り');
eq(cp.next, '窓を増やす', 'confirmPause 次にすること');
eq(cp.resumeNote, { k: 'resume_push', v: { step: { k: 'tokoro', v: { what: { text: '窓を増やす' } } } } }, 'confirmPause 続きの一言');
eq(cp.pauseCount, 1, 'confirmPause 区切った回数');
eq(M.confirmPause(full, { next: '', closed: false }).resumeNote, null, 'confirmPause 次が空なら一言なし');
var ts = M.takeStep(cp, true);
eq([ts.state, ts.declined, ts.pauseCount], ['working', 0, 1], 'takeStep #paused から押すと断った数を戻す（区切った回数は残す）');
eq(M.pause(ts).kind, 'accept', 'pause 一歩をやった後の 2 回目は受け止めるだけ');
eq(M.takeStep(cp, false).declined, 1, 'takeStep ダイアログから（区切る前）は数を変えない');
var sp = M.stop(full);
eq(sp.act.state, 'stopped', 'stop やめた');
eq(lastCh(sp.act), lastCh(full), 'stop 変化は積まない');
eq(sp.act.thread[sp.act.thread.length - 1].k, 'stopped_rec', 'stop 記録 1 行');
var us = M.undoStop(sp.act, sp.undo);
eq([us.state, us.thread.length], ['working', full.thread.length], 'undoStop 戻す');

// ---------- 相談列の返事 ----------
eq(M.replyKind(a, '疲れた', false), 'accept', 'replyKind 疲れ → 受け止め');
eq(M.replyKind(a, '屋根を作って', false), 'request', 'replyKind 頼みごと');
eq(M.replyKind(a, 'こんにちは', true), 'request', 'replyKind 言葉で頼む の後');
eq(M.replyKind(a, 'こんにちは', false), 'unknown', 'replyKind それ以外');
eq(M.requestOpt(a), 'one', 'requestOpt 見本');
eq(M.requestOpt(ext), 'cmd', 'requestOpt 外の記録');

// ---------- 引用枠 ----------
var eqd = M.editQuote(cand, '回路で LED をつけたい', []);
eq(eqd.changed, true, 'editQuote 直す');
eq(eqd.act.theme, 'circuit', 'editQuote 題材を決め直す');
eq(eqd.act.shelf.slice(0, 3).map(function (c) { return c.variant; }), ['series', 'bulbs', 'switch'], 'editQuote 案を作り直す');
eq(eqd.act.shelf.slice(3).every(function (c) { return c.state === 'passed'; }), true, 'editQuote 前の案は見送った案へ（消さない）');
eq(M.editQuote(cand, cand.quote.text, []).changed, false, 'editQuote 同じ文なら何もしない');
eq(M.editQuote(cand, '   ', []).changed, false, 'editQuote 空は直さない');
var rq = M.removeQuote(cand);
eq(rq.act.quote.removed, true, 'removeQuote 外す');
eq(rq.act.shelf.every(function (c) { return c.state === 'passed'; }), true, 'removeQuote 案は見送った案へ');
eq(M.removeQuote(rq.act), null, 'removeQuote 2 回目は無し');
var uq = M.undoRemoveQuote(rq.act, rq.undo);
eq([uq.quote.removed, uq.shelf[0].state], [false, 'new'], 'undoRemoveQuote 戻す');
var ps = M.pickSample(rq.act, 'circuit', 'js');
eq([ps.stage.kind, ps.theme, ps.steps.length], ['sample', 'circuit', 3], 'pickSample 見本を置く');

// ---------- 作品 ----------
var rl = M.roles(ca.act);
eq([rl.own, rl.ai], [0, 1], 'roles 数える');
var wf = JSON.parse(JSON.stringify(M.fromExt('photo', { id: 'w1', now: '10:20' })));
wf.changes[0].with = '田中さん';
eq(M.roles(wf).people, [{ name: '田中さん', n: 1 }], 'roles 人の手伝い');
var rlUp = M.roles(full, full.changes[0].id);
eq(rlUp.own, 1, 'roles 残すところまで');
var sw = M.saveWork([], full, { id: 'w1', title: '  ', like: ' 箱の形 ', date: '11/2' });
eq(sw.works.length, 1, 'saveWork 作品 +1');
eq(sw.work.title, full.title, 'saveWork タイトル既定は活動名');
eq(sw.work.like, '箱の形', 'saveWork 気に入っているところ（任意・本人）');
eq(sw.work.at, lastCh(full).id, 'saveWork 残すところ = 今');
eq(sw.work.roles.own, 2, 'saveWork 誰が何をした（自動）');
var swAt = M.saveWork(sw.works, full, { id: 'w2', at: full.changes[0].id, title: '最初の箱' });
eq(swAt.works[0].id, 'w2', 'saveWork 新しいものが先');
eq(swAt.work.art.stage.values.size, 6, 'saveWork 選び直した時点の形');
eq(swAt.work.roles.own, 1, 'saveWork 選んだ時点までの分担');
eq(M.saveWork([], a, { id: 'w3' }).work.like, null, 'saveWork 気に入っているところは空でよい');
var capIn = { workId: 'w9', actId: 'a9', images: ['cap-mc', 'cap-py'], title: '', made: 0, madeLine: '', catalogId: 'mc-build',
  read: { text: '石とガラスの塔。屋根はまだ無い', edited: false, declined: false }, now: '10:20', date: '11/2', mode: 'js' };
var ac = M.addCapture([a], [], capIn);
eq(ac.works.length, 1, 'addCapture 作品 +1');
eq(ac.activities.length, 2, 'addCapture 活動 +1（自動）');
eq(ac.act.origin, 'works', 'addCapture きっかけ = 作品から');
eq(ac.act.ext.photos.length, 2, 'addCapture 写真 2 枚が外の記録に');
eq(ac.act.changes.length, 2, 'addCapture 写真 2 枚 = 変化 2 つ（本人。§U-11 指摘 15）');
eq(ac.act.changes[0].who, 'own', 'addCapture 本人');
eq(ac.work.title, '塔のある建物', 'addCapture タイトル既定はバディの読み取りから');
eq(ac.act.thread[0].text, '石とガラスの塔。屋根はまだ無い', 'addCapture 見立ては相談列に（バディ）');
eq(ac.act.catalogId, 'mc-build', 'addCapture どの取り組み');
var acNo = M.addCapture([], [], Object.assign({}, capIn, { read: { text: 'x', edited: true, declined: true } }));
eq(acNo.act.thread.length, 0, 'addCapture 違うと言った見立ては使わない');
eq(M.addCapture([], [], Object.assign({}, capIn, { images: ['nope'] })), null, 'addCapture 画像なしは残さない');
eq(M.addCapture([], [], Object.assign({}, capIn, { images: ['cap-mc', 'cap-py', 'cap-circuit', 'cap-mc'] })).act.ext.photos.length, 3, 'addCapture 画像は 3 枚まで');
// 次の提案への反映（出所 1 行）
var hooked = M.fromText('マイクラで家', { id: 'h1', now: '10:20', works: ac.works });
var roof = hooked.shelf.filter(function (c) { return c.variant === 'roof'; })[0];
eq([roof.srcCapture, roof.srcTitle], ['w9', '塔のある建物'], 'fromText 作品のスクショから（出所 1 行）');
eq(hooked.shelf.filter(function (c) { return c.srcCapture; }).length, 1, 'fromText 出所は 1 枚だけ');
var excl = JSON.parse(JSON.stringify(ac.works));
excl[0].read.excluded = true;
eq(M.fromText('マイクラで家', { id: 'h2', now: '10:20', works: excl }).shelf.filter(function (c) { return c.srcCapture; }).length, 0, 'fromText 違うと言われた読み取りは材料から外す');
eq(M.fromText('Python', { id: 'h3', now: '10:20', works: ac.works }).shelf.filter(function (c) { return c.srcCapture; }).length, 0, 'fromText 題材が違えば出所は付けない');

// ---------- デモ（決定論） ----------
eq(JSON.stringify(M.demo('demo-full')), JSON.stringify(M.demo('demo-full')), 'demo 同じ id は同じ中身');
eq(M.demo('demo-mc').stage.kind, 'sample', 'demo-mc 見本から');
eq(M.demo('demo-cand').shelf.length, 3, 'demo-cand 候補状態');
eq(M.demo('nope'), null, 'demo 無い id');
var df = M.demo('demo-full');
eq([df.changes.length, df.shelf.filter(function (c) { return c.state === 'new'; }).length], [3, 1], 'demo-full 変化 3 つ + 新しい案 1 枚');
eq(MD.seedActivities()[0].id, 'act-build', 'seed 制作中 1 件');

// ======================================================================
// §U-11 の再現テスト（Astra 指摘番号 / 実機確認 (a)〜(d)）
// ======================================================================
function t(name, fn) { try { fn(); } catch (e) { fail += 1; console.log('NG  ' + name + '  (例外 ' + e.message + ')'); } }
function settled(a, opt) { var r = M.leave(a, opt); return { act: M.settle(r.act, r.ids), ids: r.ids }; }
t('U11-2 採用した案は「試す」で必ず変化 +1', function () {
  var x = M.test(M.setParam(sample('mc'), 'size', 6)).act;
  var l = settled(x, 'one'), ad = M.adopt(l.act, l.ids[0]).act;
  var r = M.test(ad);
  ok(r && r.change && r.change.kind === 'test', 'U11-2 試すで変化が積まれる');
  eq(r.act.changes.length, ad.changes.length + 1, 'U11-2 変化数 +1');
  eq(M.test(r.act).same, true, 'U11-2 続けて試すと積まない');
});
t('U11-3 写真・スクショの変化へ戻れる', function () {
  var e = M.addPhoto(M.fromExt('photo', { id: 'e3', now: '10:20' }), 'shot').act;
  eq(e.ext.visible.length, 2, 'U11-3 見えている写真 2 枚');
  eq(M.canRevert(e), true, 'U11-3 前に戻すが押せる');
  var rv = M.revert(e, null);
  eq(rv.act.ext.visible.length, 1, 'U11-3 前に戻す → 写真 1 枚の状態');
  eq(rv.act.ext.photos.length, 2, 'U11-3 写真の記録は消えない');
  var e3 = M.addPhoto(e, 'photo').act;
  var to = M.revert(e3, e3.changes[0].id);
  eq(to.act.ext.visible, [e3.ext.photos[0].id], 'U11-3 ここに戻す → その時の写真');
  eq(M.undoRevert(rv.act, rv.undo).ext.visible.length, 2, 'U11-3 戻すの取り消しで写真も元へ');
});
t('U11-5 作品の「続きを作る」は残した時点を新しい変化として開く', function () {
  var x = M.test(M.setParam(sample('mc'), 'size', 6)).act;
  var w = M.saveWork([], x, { id: 'w5' }).work;
  var y = M.test(M.setParam(x, 'size', 8)).act;
  var r = M.reopenAt(y, w.at);
  eq(r.act.stage.values.size, 6, 'U11-5 残した時点の値');
  eq(r.change.kind, 'revert', 'U11-5 新しい変化として積む');
  eq(M.reopenAt(r.act, w.at).change, null, 'U11-5 もう同じ時点なら積まない');
});
t('U11-6 やめた活動を再開したら作業中', function () {
  var st = M.stop(sample('mc')).act;
  eq(M.resume(st).state, 'working', 'U11-6 resume で作業中');
  eq(M.reopenAt(st, null).act.state, 'working', 'U11-6 作品から開いても作業中');
});
t('U11-7 空にした「次」は空のまま', function () {
  var x = M.setNext(sample('mc'), '');
  eq(M.stepNext(x), null, 'U11-7 setNext 空 → 次は無し');
  var full = M.test(M.setParam(sample('mc'), 'size', 6)).act;
  var cp = M.confirmPause(full, { next: '', closed: false });
  eq(M.stepNext(M.resume(cp)), null, 'U11-7 区切りで空にしたら再開後も空');
  eq(M.stepNext(M.setNext(x, '窓')), { text: '窓' }, 'U11-7 書けば本人の言葉');
});
t('U11-8 引用を直して題材が変わったら手順も新題材', function () {
  var c = M.fromText('マイクラで家', { id: 'q8', now: '10:20' });
  var e = M.editQuote(c, 'Python のゲーム', [], 'js').act;
  eq(e.steps[1], MD.stepsFor('py', 'dodge')[0], 'U11-8 手順が Python に');
  var ad = M.adopt(e, e.shelf[0].id).act;
  eq(M.stepNow(ad), MD.stepsFor('py', 'dodge')[0], 'U11-8 採用後の今の一歩も Python');
});
t('U11-9 相談の返事の「違う」が対象の変更を戻す（対象の判定）', function () {
  var x = M.test(M.setParam(sample('mc'), 'size', 6)).act;
  var l = settled(x, 'one'), ad = M.adopt(l.act, l.ids[0]);
  var tg = M.replyTarget(ad.act, { change: ad.change.id });
  eq(tg.revertTo, x.changes[0].id, 'U11-9 採用の前の変化へ戻す');
  var l2 = settled(ad.act, 'find');
  eq(M.replyTarget(l2.act, { cards: l2.ids }).cards, l2.ids, 'U11-9 カードの返事は新しいカードを見送る');
  eq(M.replyTarget(sample('mc'), {}).revertTo, null, 'U11-9 何も紐づかない返事は戻さない');
});
t('U11-11 「作っている」のまま読み込んだら完了させる', function () {
  var l = M.leave(sample('mc'), 'find');
  var f = M.finishMaking(l.act, '棚に置いた');
  eq(f.shelf.filter(function (c) { return c.state === 'making'; }).length, 0, 'U11-11 作っているが残らない');
  eq(f.thread[f.thread.length - 1].text, '棚に置いた', 'U11-11 相談列に 1 行');
  eq(M.finishMaking(sample('mc'), 'x').thread.length, 1, 'U11-11 作っていなければ何もしない');
});
t('U11-13 メモのカードも作り直せる', function () {
  var ext = M.fromExt('link', { id: 'n13', now: '10:20' });
  var nt = settled(ext, 'calc').act;
  var rm = M.remake(nt, nt.shelf[0].id, 'calc');
  ok(rm.ids.length === 1, 'U11-13 作り直しのカード');
  var made = M.settle(rm.act, rm.ids).shelf[0];
  ok(JSON.stringify(made.lines) !== JSON.stringify(nt.shelf[0].lines), 'U11-13 作り直すと中身が変わる');
});
t('U11-14 メモを作品に残すと本文を持つ', function () {
  var ext = M.fromExt('link', { id: 'n14', now: '10:20' });
  var nt = settled(ext, 'calc').act, ad = M.adopt(nt, nt.shelf[0].id).act;
  var w = M.saveWork([], ad, { id: 'w14' }).work;
  eq(w.art && w.art.note && w.art.note.lines.length, 3, 'U11-14 作品にメモ 3 行');
});
t('U11-15 写真 1 枚 = 変化 1', function () {
  var ac = M.addCapture([], [], { workId: 'w15', actId: 'a15', images: ['cap-mc', 'cap-py'], title: '', made: 0, madeLine: '', read: { text: 'x', edited: false, declined: false }, now: '10:20', mode: 'js' });
  eq(ac.act.changes.length, 2, 'U11-15 写真 2 枚 = 変化 2');
  eq(ac.work.roles.own, 2, 'U11-15 本人 2 回');
});
t('U11-16 返事は作った時点の文字列で持つ', function () {
  var es = M.fromSample('mc', { id: 's16', now: '10:20', mode: 'es' });
  eq(es.thread[0].text, MD.replies.open[1], 'U11-16 es で作った返事は es の文のまま');
  var js = M.fromText('Python', { id: 's16b', now: '10:20', mode: 'js' });
  eq(js.thread[0].text, MD.replies.land[0], 'U11-16 js で作った返事は js の文のまま');
});
t('U11-a 名詞は今の作業対象から（岩をよけるゲームに「星」を出さない）', function () {
  var c = M.fromText('Python のゲーム', { id: 'ta', now: '10:20', mode: 'js' });
  var ad = M.adopt(c, c.shelf[0].id).act;
  eq(ad.stage.variant, 'dodge', 'U11-a 岩をよけるゲーム');
  var all = JSON.stringify(ad.steps);
  ok(all.indexOf('岩') >= 0 && all.indexOf('星') < 0, 'U11-a 手順は岩', ad.steps);
  var rep = MD.testReply(ad.stage, 'count', 5, 'js') + MD.testReply(ad.stage, 'count', 5, 'es') + MD.testReply(ad.stage, 'speed', 1, 'js');
  ok(rep.indexOf('岩') >= 0 && rep.indexOf('星') < 0, 'U11-a 返事も岩', rep);
});
t('U11-21 返事の型は §7 の語順（題材の語だけ差し替え）', function () {
  var st = { kind: 'sample', theme: 'py', variant: 'catch', values: { speed: 3, count: 3 } };
  eq(MD.testReply(st, 'speed', 2, 'js'), '選んだ速さに変えて、星の動きに違いが出たね。狙っていた動きに近い？', 'U11-21 js');
  eq(MD.testReply(st, 'speed', 2, 'es'), 'はやさをかえたら、さっきよりはやく動いたね。変えたところが動きに出たね', 'U11-21 es（羽を広げたら…の語順）');
});
t('U11-b 3 題材 × 2 つの値: 線画が変わる', function () {
  [['mc', 'cube', { size: 4, block: 0 }, 'size', 6], ['mc', 'cube', { size: 4, block: 0 }, 'block', 1],
    ['py', 'catch', { speed: 2, count: 3 }, 'speed', 5], ['py', 'catch', { speed: 2, count: 3 }, 'count', 5],
    ['circuit', 'single', { volt: 1, ohm: 2 }, 'volt', 3], ['circuit', 'single', { volt: 1, ohm: 2 }, 'ohm', 0]].forEach(function (c) {
    var a = { kind: 'sample', theme: c[0], variant: c[1], values: c[2] }, v2 = JSON.parse(JSON.stringify(c[2]));
    v2[c[3]] = c[4];
    var b = { kind: 'sample', theme: c[0], variant: c[1], values: v2 };
    ok(MD.art(a) !== MD.art(b), 'U11-b ' + c[0] + '.' + c[3] + ' で線画が変わる');
    ok(MD.artMarks(b) !== MD.artMarks(a), 'U11-b ' + c[0] + '.' + c[3] + ' の量が図の印の数か長さに出る');
  });
});
t('U11-d 棚のカード名が同名で並ばない', function () {
  var df = M.demo('demo-full');
  var names = M.cardNames(df.shelf, 'js');
  var list = df.shelf.map(function (c) { return names[c.id]; });
  eq(list.length, new Set(list).size, 'U11-d demo-full のカード名は別々', list);
});

// ======================================================================
// §U-12 の再現テスト（再レビューの回帰 1〜3・残り 4/5/7/9/12/22/b/d・移行 6・実機 (e)(f)）
// ======================================================================
t('U12-1 作品に残す写真は今見えている写真', function () {
  var e = M.addPhoto(M.fromExt('photo', { id: 'u1', now: '10:20' }), 'shot').act;
  var rv = M.revert(e, null).act;
  var w = M.saveWork([], rv, { id: 'w1' }).work;
  eq(w.art && w.art.photo && w.art.photo.id, rv.ext.visible[rv.ext.visible.length - 1], 'U12-1 戻した後の 1 枚目を作品に');
});
t('U12-b 3 題材 × 2 値: 隣り合う全値で線画（SVG 文字列）が変わる', function () {
  var same = [], total = 0;
  MD.THEMES.forEach(function (th) {
    var T0 = MD.theme(th), ps = T0.params;
    T0.variants.forEach(function (va) {
      ps.forEach(function (p, pi) {
        var q = ps[1 - pi];
        for (var qv = q.min; qv <= q.max; qv++) {
          for (var v = p.min; v < p.max; v++) {
            var a = {}, b = {};
            a[p.key] = v; a[q.key] = qv; b[p.key] = v + 1; b[q.key] = qv;
            total += 1;
            if (MD.art({ kind: 'sample', theme: th, variant: va, values: a }) === MD.art({ kind: 'sample', theme: th, variant: va, values: b })) same.push(th + '.' + va + ' ' + p.key + ' ' + v + '→' + (v + 1) + ' (' + q.key + '=' + qv + ')');
          }
        }
      });
    });
  });
  ok(total > 100, 'U12-b 組み合わせを全部見ている', total);
  eq(same.length, 0, 'U12-b 線画が同じになる組み合わせは 0 件', same.slice(0, 8));
});
t('U12-3 返事の「違う」を戻すと、その返事の「違う」も戻る', function () {
  var x = M.test(M.setParam(sample('mc'), 'size', 6));
  var a = x.act;
  M.pushMsg(a, { who: 'buddy', r: 'test', text: 'x', change: x.change.id });
  var mid = a.thread[a.thread.length - 1].id;
  var d = M.declineReply(a, mid);
  eq(d.act.stage.values.size, 4, 'U12-3 違う → 試す前の値');
  eq(M.findMsg(d.act, mid).declined, true, 'U12-3 違う → 返事は使った印');
  var u = M.undoDeclineReply(d.act, d.undo);
  eq(u.stage.values.size, 6, 'U12-3 戻す → 値が戻る');
  eq(!!M.findMsg(u, mid).declined, false, 'U12-3 戻す → 返事の「違う」も戻る');
});
t('U12-4 保存時点を持たない作品も、残した時点で再開して変化を積む', function () {
  var a = sample('mc');
  var w = M.saveWork([], a, { id: 'w4' }).work;
  ok(w.snap && w.snap.stage && w.snap.stage.values.size === 4, 'U12-4 作品に残した時点の状態');
  var y = M.test(M.setParam(a, 'size', 8)).act;
  var r = M.reopenAt(y, w.at, w.snap);
  eq(r.act.stage.values.size, 4, 'U12-4 未試行で残した作品 → その時の値で開く');
  ok(r.change && r.change.kind === 'revert', 'U12-4 変化として積む');
  var ac = M.addCapture([], [], { workId: 'w4c', actId: 'a4c', images: ['cap-mc'], title: '', made: 0, madeLine: '', read: { text: 'x', edited: false, declined: false }, now: '10:20', mode: 'js' });
  ok(!!ac.work.at && !!ac.work.snap, 'U12-4 キャプチャーの作品も時点を持つ');
  var more = M.addPhoto(ac.act, 'photo').act;
  var rc = M.reopenAt(more, ac.work.at, ac.work.snap);
  eq(rc.act.ext.visible, ac.act.ext.visible, 'U12-4 キャプチャーの作品 → 入れた時の写真で開く');
});
t('U12-5 写真だけの履歴にも「ここに戻す」', function () {
  var e = M.addPhoto(M.fromExt('photo', { id: 'u5', now: '10:20' }), 'shot').act;
  eq(M.canRevertTo(e, e.changes[0].id), true, 'U12-5 1 枚目へ戻れる');
  eq(M.canRevertTo(e, e.changes[1].id), false, 'U12-5 今と同じ所へは出さない');
});
t('U12-6 前の版の活動を読み込むと不足欄を補う', function () {
  // 前版（§U-11 以前）の形: stepsKind・ext.visible・changes[].vis・返事の text が無い。引用はマイクラ → Python に直した後で手順は古いまま
  var old = {
    id: 'old1', title: 'マイクラの建物', origin: 'make', theme: 'py', catalogId: null, sampleId: null, quote: { text: 'Python', removed: false },
    stage: null, base: null, baseTime: '10:20', ext: null,
    steps: [['案を選ぶ', '案をえらぶ'], ['大きさを変える', '大きさをかえる'], ['ブロックを選ぶ', 'ブロックをえらぶ'], ['入口をあける', '入り口をあける']], stepIdx: 0, next: null,
    changes: [], shelf: [{ id: 'old1-k2', batch: 'old1-b1', kind: 'draft', theme: 'py', variant: 'dodge', values: { speed: 3, count: 4 }, time: '10:20', state: 'new' }],
    thread: [{ id: 'old1-m1', who: 'buddy', time: '10:20', r: 'land' }, { id: 'old1-m2', who: 'buddy', time: '10:21', k: 'leave_ask', ask: true, opts: [{ a: 'mk-leave-opt', arg: 'redo', label: { k: 'leave_opts_draft', i: 0 } }] }],
    state: 'working', pauseCount: 0, declined: 0, offered: false, resumeNote: null, clock: 620, seq: 3, draft: ''
  };
  var oldExt = {
    id: 'old2', title: '写真から', origin: 'make', theme: 'mc', stage: null, base: null, baseTime: '10:20', quote: null,
    ext: { link: null, photos: [{ id: 'old2-ph1', theme: 'mc', n: 0, kind: 'photo', time: '10:22' }, { id: 'old2-ph2', theme: 'mc', n: 1, kind: 'shot', time: '10:24' }] },
    steps: [['写真を入れる', '写真を入れる'], ['屋根を置く', 'やねをおく']], stepIdx: 1, next: null,
    changes: [{ id: 'old2-c1', who: 'own', kind: 'photo', time: '10:22', what: { k: 'added_photo' }, snap: null, photoId: 'old2-ph1' },
      { id: 'old2-c2', who: 'own', kind: 'shot', time: '10:24', what: { k: 'added_shot' }, snap: null, photoId: 'old2-ph2' }],
    shelf: [], thread: [], state: 'working', pauseCount: 0, declined: 0, offered: false, resumeNote: null, clock: 624, seq: 5, draft: ''
  };
  function res(m) { return m.r ? MD.pick(MD.replies[m.r], 'js') : (m.k ? '[' + m.k + (m.i != null ? ':' + m.i : '') + ']' : ''); }
  var m1 = M.migrate(old, res), m2 = M.migrate(oldExt, res);
  eq(m1.v, 3, 'U12-6 版 v:3');
  eq(m1.stepsKind, 'theme', 'U12-6 stepsKind を補う');
  eq(m1.candidate, true, 'U12-6 候補状態の印を補う');
  ok(JSON.stringify(m1.steps).indexOf('ブロック') < 0 && JSON.stringify(m1.steps).indexOf('速さ') >= 0, 'U12-6 手順を今の題材（Python）に', m1.steps);
  eq(m1.thread[0].text, MD.replies.land[0], 'U12-6 返事の text を補う');
  eq(m1.thread[1].opts[0].label, '[leave_opts_draft:0]', 'U12-6 返事のボタン名も文字列に');
  eq(m2.stepsKind, 'ext', 'U12-6 外の記録は ext');
  eq(m2.ext.visible, ['old2-ph1', 'old2-ph2'], 'U12-6 見えている写真を補う');
  eq(m2.baseVis, [], 'U12-6 始めの写真を補う');
  eq(m2.changes.map(function (c) { return c.vis; }), [['old2-ph1'], ['old2-ph1', 'old2-ph2']], 'U12-6 変化ごとの写真を補う');
  eq(M.canRevert(m2), true, 'U12-6 移行後は前に戻せる');
  eq(M.migrate(m2, res), m2, 'U12-6 v:3 はそのまま');
  eq(M.fromSample('mc', { id: 'n6', now: '10:20' }).v, 3, 'U12-6 新しい活動は v:3');
  eq(MD.seedActivities()[0].v, 3, 'U12-6 最初からある活動も v:3');
  (function () {
    var old = M.fromSample('py', { id: 'n7', now: '10:20' });
    old.v = 2; old.stepsKind = 'ext'; old.ext = { photos: [], visible: [] };
    var mm = M.migrate(old, res);
    eq(mm.stepsKind, 'theme', 'U12-6b 98f0a71 で v:2・ext に移行済みの見本活動も theme に直る');
    eq(mm.v, 3, 'U12-6b 版 v:3');
  })();
});
t('U12-e 次は今と違う一歩か、無ければ空', function () {
  var full = M.test(M.setParam(M.test(M.setParam(sample('mc'), 'size', 6)).act, 'block', 1)).act;
  eq(M.stepNext(full), null, 'U12-e 最後の一歩なら次は無し');
  var now = MD.pick(M.stepNow(full), 'js');
  var cp = M.resume(M.confirmPause(full, { next: now, closed: false }));
  eq(M.stepNext(cp), null, 'U12-e 次に今と同じ文を書いても次には出さない');
  var es = M.resume(M.confirmPause(full, { next: MD.pick(M.stepNow(full), 'es'), closed: false }));
  eq(M.stepNext(es), null, 'U12-e es の同じ文でも出さない');
  eq(M.stepNext(M.setNext(full, '窓を増やす')), { text: '窓を増やす' }, 'U12-e 違う文なら出す');
});
t('U12-d 見送った案を含め同名カードが並ばない', function () {
  var c = M.fromText('Python ゲームA', { id: 'd12', now: '10:20' });
  var e = M.editQuote(c, 'Python ゲームB', [], 'js').act;
  var names = M.cardNames(e.shelf, 'js'), list = e.shelf.map(function (x) { return names[x.id]; });
  eq(list.length, new Set(list).size, 'U12-d 名前は全部ちがう', list);
});

// ======================================================================
// §U-12 補足（3 回目の再レビュー 1〜5 / 司令塔の裁定 1〜5）
// ======================================================================
t('U12x-1 写真の無い保存時点に戻したら、後から足した写真は見えなくする', function () {
  var a = sample('mc');
  var w = M.saveWork([], a, { id: 'x1' }).work;
  var y = M.addPhoto(M.test(M.setParam(a, 'size', 8)).act, 'photo').act;
  eq(y.ext.visible.length, 1, 'U12x-1 前提: 写真 1 枚を足した');
  var r = M.reopenAt(y, w.at, w.snap, w.snapTime);
  eq(r.act.stage.values.size, 4, 'U12x-1 値は残した時点');
  eq(r.act.ext.visible, [], 'U12x-1 写真は見えない（vis=null は写真なし）');
  eq(r.act.ext.photos.length, 1, 'U12x-1 写真の記録は残る');
});
t('U12x-2 旧作品の at / snap を移行で補う', function () {
  // 前版のキャプチャー: 画像 2 枚で変化 1 つ、作品に at / snap が無い。その後に写真を 1 枚足した活動
  var act = {
    id: 'oc', title: '塔のある建物', origin: 'works', theme: 'mc', stage: null, base: null, baseTime: '10:20', quote: null,
    ext: { link: null, photos: [{ id: 'oc-ph1', theme: 'mc', n: 1, kind: 'photo', time: '10:20' }, { id: 'oc-ph2', theme: 'py', n: 0, kind: 'photo', time: '10:20' }, { id: 'oc-ph4', theme: 'mc', n: 2, kind: 'photo', time: '10:24' }] },
    steps: [['写真を入れる', '写真を入れる'], ['屋根を置く', 'やねをおく']], stepIdx: 1, next: null,
    changes: [{ id: 'oc-c3', who: 'own', kind: 'photo', time: '10:22', what: { k: 'added_photo' }, snap: null, photoId: 'oc-ph1' },
      { id: 'oc-c5', who: 'own', kind: 'photo', time: '10:24', what: { k: 'added_photo' }, snap: null, photoId: 'oc-ph4' }],
    shelf: [], thread: [], state: 'working', pauseCount: 0, declined: 0, offered: false, resumeNote: null, clock: 624, seq: 5, draft: ''
  };
  var work = { id: 'ow', actId: 'oc', from: 'capture', title: '塔のある建物', images: ['cap-mc', 'cap-py'], read: { text: 'x', edited: false, declined: false },
    made: 0, madeLine: null, catalogId: 'mc-build', theme: 'mc', art: { photo: { id: 'oc-ph1', theme: 'mc', n: 1, kind: 'photo', time: '10:20' } }, roles: { own: 1, ai: 0, people: [], lines: [] }, date: '11/2', like: null };
  var ma = M.migrate(act, function () { return ''; });
  eq(ma.changes[0].vis, ['oc-ph1', 'oc-ph2'], 'U12x-2 前提: 移行した活動の写真の順（写真の並び順）');
  var mw = M.migrateWork(work, [ma]);
  eq(mw.at, 'oc-c3', 'U12x-2 保存時刻以前で最後の変化を at に');
  eq(mw.snap && mw.snap.vis, ['oc-ph1', 'oc-ph2'], 'U12x-2 その変化の状態を snap に');
  var r = M.reopenAt(ma, mw.at, mw.snap, mw.atTime);
  eq(r.act.ext.visible, ['oc-ph1', 'oc-ph2'], 'U12x-2 旧作品から再開 → 入れた時の写真');
  var mk = { id: 'om', actId: 'oc2', from: 'make', title: 'x', at: null, atTime: null, art: null, roles: null };
  var a2 = JSON.parse(JSON.stringify(M.test(M.setParam(sample('mc'), 'size', 8)).act)); a2.id = 'oc2';
  var mw2 = M.migrateWork(mk, [a2]);
  eq(mw2.snap && mw2.snap.stage && mw2.snap.stage.values.size, 4, 'U12x-2 該当する変化が無ければ活動の最初の状態');
  eq(M.migrateWork(mw, [ma]), mw, 'U12x-2 補った後はそのまま');
});
t('U12x-3 移行の stepsKind は作業対象の主の種類で決める', function () {
  var old = {
    id: 'o3', title: 'Python のゲーム', origin: 'talk', theme: 'py', stage: { kind: 'draft', theme: 'py', variant: 'dodge', values: { speed: 3, count: 4 } }, base: null, baseTime: '10:20',
    quote: { text: 'Python', removed: false },
    ext: { link: null, photos: [{ id: 'o3-ph1', theme: 'py', n: 0, kind: 'photo', time: '10:24' }] },
    steps: [['案を選ぶ', '案をえらぶ'], ['速さを変える', 'はやさをかえる'], ['星の数を変える', '星の数をかえる'], ['キャラの色を決める', 'キャラの色をきめる']], stepIdx: 1, next: null,
    changes: [{ id: 'o3-c1', who: 'ai', kind: 'adopt', time: '10:22', what: { k: 'adopt_rec' }, snap: { kind: 'draft', theme: 'py', variant: 'dodge', values: { speed: 3, count: 4 } } },
      { id: 'o3-c2', who: 'own', kind: 'photo', time: '10:24', what: { k: 'added_photo' }, snap: { kind: 'draft', theme: 'py', variant: 'dodge', values: { speed: 3, count: 4 } }, photoId: 'o3-ph1' }],
    shelf: [], thread: [], state: 'working', pauseCount: 0, declined: 0, offered: false, resumeNote: null, clock: 624, seq: 5, draft: ''
  };
  var m = M.migrate(old, function () { return ''; });
  eq(m.stepsKind, 'theme', 'U12x-3 見本・試作が主なら theme（写真があっても）');
  ok(JSON.stringify(m.steps).indexOf('岩の数') >= 0 && JSON.stringify(m.steps).indexOf('星') < 0, 'U12x-3 手順が今の案（岩）に', m.steps);
  var extOnly = JSON.parse(JSON.stringify(old)); extOnly.stage = null; extOnly.changes = [extOnly.changes[1]]; extOnly.changes[0].snap = null;
  extOnly.steps = [['写真を入れる', '写真を入れる'], ['屋根を置く', 'やねをおく']];
  eq(M.migrate(extOnly, function () { return ''; }).stepsKind, 'ext', 'U12x-3 外の記録だけなら ext');
});
t('U12x-4 「作品に残す」の「今」は見えている値（未試行の変更を含む）', function () {
  var a = M.setParam(M.test(M.setParam(sample('mc'), 'size', 5)).act, 'size', 8);
  var r = M.saveWork([], a, { id: 'x4' });
  eq(r.work.snap.stage.values.size, 8, 'U12x-4 作品は見えている大きさ 8');
  ok(r.act && r.act.changes.length === a.changes.length + 1, 'U12x-4 保存の前に変化を積む');
  var c = r.act.changes[r.act.changes.length - 1];
  eq([c.who, c.kind, !!c.res], ['own', 'set', false], 'U12x-4 誰が = 本人、結果 = まだ確かめていない');
  eq(r.work.at, c.id, 'U12x-4 作品の時点はその変化');
  eq(M.isDirty(r.act), false, 'U12x-4 積んだ後は「まだ試していない」ではない');
  var clean = M.test(M.setParam(sample('mc'), 'size', 5)).act;
  eq(M.saveWork([], clean, { id: 'x4b' }).act.changes.length, clean.changes.length, 'U12x-4 変更が無ければ積まない');
});

// ======================================================================
// §W 作品（一覧・詳細・見せる）の純関数
// ======================================================================
var W = require(path.join(__dirname, '../app-v3/js/works.js'));
function cl(v) { return JSON.parse(JSON.stringify(v)); }
t('W-1 完成 / 試作の既定と 2 択', function () {
  var fresh = sample('mc');
  var full = M.test(M.setParam(M.test(M.setParam(sample('mc'), 'size', 6)).act, 'block', 1)).act;
  eq(M.defaultStatus(fresh), 'trial', 'W-1 手順が途中なら試作');
  eq(M.defaultStatus(full), 'done', 'W-1 手順が最後まで進んでいれば完成');
  eq(M.defaultStatus({ steps: [], stepIdx: 0 }), 'trial', 'W-1 手順が無ければ試作（境界）');
  eq(M.saveWork([], fresh, { id: 'ws1' }).work.status, 'trial', 'W-1 saveWork の既定（途中）');
  eq(M.saveWork([], full, { id: 'ws2' }).work.status, 'done', 'W-1 saveWork の既定（最後まで）');
  eq(M.saveWork([], fresh, { id: 'ws3', status: 'done' }).work.status, 'done', 'W-1 saveWork 選んだ方');
  eq(M.saveWork([], full, { id: 'ws4', status: 'nope' }).work.status, 'done', 'W-1 saveWork 知らない値は既定へ');
  var sw = M.saveWork([], fresh, { id: 'ws5' }).work;
  eq([sw.craft, sw.shares], [null, []], 'W-1 saveWork は工夫 null・見せた記録 [] で始まる（残しただけでは誰にも見せない）');
  var cap = { workId: 'wc1', actId: 'ac1', images: ['cap-mc'], title: '', made: 0, madeLine: '', read: { text: 'x', edited: false, declined: false }, now: '10:20', mode: 'js' };
  eq(M.addCapture([], [], cap).work.status, 'done', 'W-1 写真から入れる作品の既定は完成');
  eq(M.addCapture([], [], Object.assign({}, cap, { status: 'trial' })).work.status, 'trial', 'W-1 写真から入れる作品も試作を選べる');
  eq(M.addCapture([], [], cap).work.shares, [], 'W-1 addCapture も見せた記録 []');
});
t('W-5 読み込み時に欄を補う（消さない）', function () {
  var old = [{ id: 'o1', title: 'a' }, { id: 'o2', title: 'b', status: 'trial', craft: '工夫', shares: [{ id: 's', to: ['family'], scope: 'work', time: 'x' }] },
    { id: 'o3', title: 'c', status: 'weird', craft: 5, shares: 'x' }];
  var n = W.normalize(old);
  eq(n.length, 3, 'W-5 件数はそのまま');
  eq([n[0].status, n[0].craft, n[0].shares], ['done', null, []], 'W-5 status 無し → done / craft 無し → null / shares 無し → []');
  eq(n[1], old[1], 'W-5 そろっている作品はそのまま');
  ok(n[1] === old[1], 'W-5 そろっている作品は同じものを返す');
  eq([n[2].status, n[2].craft, n[2].shares], ['done', '5', []], 'W-5 おかしな値も補う（境界）');
  eq(old[0].status, undefined, 'W-5 元の配列は変えない');
  eq(W.normalize(n), n, 'W-5 2 回目は何も変えない');
  eq(W.normalize(null), [], 'W-5 null は空');
  ok(W.normalize === M.normalizeWorks, 'W-5 W.normalize は make.js の移行と同じ関数');
});
t('W-2 一覧の 2 段（新しい順 = 保存の並び）', function () {
  var ws = [{ id: 'a', status: 'trial' }, { id: 'b', status: 'done' }, { id: 'c' }, { id: 'd', status: 'trial' }, { id: 'e', status: 'done' }];
  var g = W.group(ws);
  eq(g.done.map(function (w) { return w.id; }), ['b', 'c', 'e'], 'W-2 完成（status 無しも完成）');
  eq(g.trial.map(function (w) { return w.id; }), ['a', 'd'], 'W-2 試作');
  eq(W.group([]), { done: [], trial: [] }, 'W-2 空');
  var s1 = M.saveWork([], sample('mc'), { id: 'old' }), s2 = M.saveWork(s1.works, sample('py'), { id: 'new' });
  eq(W.group(s2.works).trial.map(function (w) { return w.id; }), ['new', 'old'], 'W-2 後から残したものが先');
  eq(W.isShown({ shares: [] }), false, 'W-2 見せていなければ印なし');
  eq(W.isShown({ shares: [{ id: 's' }] }), true, 'W-2 見せていれば「見せている」');
});
t('W-3 変わってきたところ（はじめ + 残した時点まで）', function () {
  var x = M.test(M.setParam(sample('mc'), 'size', 6)).act;
  var y = M.test(M.setParam(x, 'size', 8)).act;
  var w = M.saveWork([], y, { id: 'wf', at: y.changes[0].id }).work;
  var z = M.test(M.setParam(y, 'size', 3)).act;
  var fr = W.storyFrames(z, w);
  eq(fr.map(function (f) { return f.id; }), ['@base', y.changes[0].id], 'W-3 残した時点より後の変化は入らない');
  eq([fr[0].kind, fr[0].time], ['base', z.baseTime], 'W-3 先頭は「はじめ」');
  eq(fr.map(function (f) { return f.last; }), [false, true], 'W-3 最後のコマ = この作品');
  eq(fr[1].art.stage.values.size, 6, 'W-3 コマの絵はその時点の状態');
  eq([fr[1].who, fr[1].what.k], ['own', 'changed_one'], 'W-3 誰が・何を変えた');
  var all = W.storyFrames(z, M.saveWork([], z, { id: 'wf2' }).work);
  eq(all.length, 4, 'W-3 今で残せば全部の変化');
  var none = W.storyFrames(sample('mc'), M.saveWork([], sample('mc'), { id: 'wf3' }).work);
  eq([none.length, none[0].id, none[0].last, none[0].art.stage.values.size], [1, '@work', true, 4], 'W-3 変化 0 個 = 残した状態の 1 コマ（境界）');
  eq(W.storyFrames(null, w), [], 'W-3 活動が無ければコマ無し');
  // 絵の無いコマ（写真を全部隠した時点）は前の絵を薄く
  var e = M.addPhoto(M.fromExt('photo', { id: 'wf4', now: '10:20' }), 'shot').act;
  var rb = M.revert(e, '@base').act;
  var fw = W.storyFrames(rb, M.saveWork([], rb, { id: 'wf5' }).work);
  eq(fw[0].art, null, 'W-3 はじめに絵が無ければ空（前の絵も無い）');
  var lastF = fw[fw.length - 1];
  eq([lastF.inherited, lastF.art && lastF.art.photo && lastF.art.photo.id], [true, e.ext.photos[1].id], 'W-3 絵の無いコマは前の絵（inherited）');
  // 残した時点の変化が活動に無い時は、作品が持つ状態の 1 コマだけ（活動の今の base は使わない。Astra 指摘 1）
  var lost = cl(w); lost.at = 'gone';
  var fl = W.storyFrames(z, lost);
  eq([fl.length, fl[0].id, fl[0].last, fl[0].art.stage.values.size], [1, '@work', true, 6], 'W-3 時点が見つからなければ作品の状態 1 コマ（境界）');
});
t('W-3 変化の前に残した作品は、後で活動が変わっても残した状態を見せる（Astra 指摘 1 の再現）', function () {
  // 思いつきから → 案を選ばずに残す → 同じ活動で見本を置く → 作品の詳細
  var c = M.fromText('マイクラ', { id: 'r1', now: '10:20', mode: 'js' });
  var w = M.saveWork([], c, { id: 'wr1' }).work;
  eq([w.at, w.art, w.snap.stage], [null, null, null], 'W-3 前提: 時点なし・絵なしで残った');
  var p = M.pickSample(c, 'mc', 'js');
  eq([p.base && p.base.kind, p.changes.length], ['sample', 0], 'W-3 前提: 活動の base は後から見本に変わった');
  var fr = W.storyFrames(p, w);
  eq([fr.length, fr[0].id, fr[0].art, fr[0].last], [1, '@work', null, true], 'W-3 詳細は残した状態（見本の絵を出さない）');
  var sh = W.shareItems(w, p, 'story');
  eq(sh[3].v.n, 1, 'W-3 見せる側のコマ数も残した状態から');
  // 見本を残した後に、同じ活動の値を変えた（変化はまだ無い）場合も、残した値のまま
  var s = sample('mc'), ws = M.saveWork([], s, { id: 'wr2' }).work;
  var moved = M.setParam(s, 'size', 8);
  eq(W.storyFrames(moved, ws)[0].art.stage.values.size, 4, 'W-3 未試行の今の値も作品のコマに入れない');
  // 古い作品で snap も無ければ作品の絵
  var bare = { id: 'wr3', actId: 'r1', at: null, art: { stage: { kind: 'sample', theme: 'mc', variant: 'cube', values: { size: 3, block: 0 } } } };
  eq(W.storyFrames(p, bare)[0].art.stage.values.size, 3, 'W-3 snap が無ければ作品の絵（境界）');
});
t('W-3 直す・状態・外す（純関数は元を変えない）', function () {
  var ws = [{ id: 'a', title: '塔', like: null, craft: null, status: 'trial', from: 'make' }, { id: 'b', title: '回路', status: 'done', from: 'capture', read: { text: 'x', edited: false, declined: false } }];
  var snap = cl(ws);
  var st = W.setStatus(ws, 'a', 'done');
  eq(st[0].status, 'done', 'W-3 試作 → 完成');
  eq(W.setStatus(st, 'a', 'trial')[0].status, 'trial', 'W-3 完成 → 試作');
  ok(W.setStatus(ws, 'a', 'trial') === ws, 'W-3 同じ状態なら同じ配列');
  ok(W.setStatus(ws, 'a', 'x') === ws, 'W-3 知らない状態は無視');
  ok(W.setStatus(ws, 'nope', 'done') === ws, 'W-3 無い id は無視');
  eq(W.edit(ws, 'a', 'title', '  石の塔 ')[0].title, '石の塔', 'W-3 タイトルを直す（前後の空白は取る）');
  ok(W.edit(ws, 'a', 'title', '   ') === ws, 'W-3 空のタイトルは元のまま');
  ok(W.edit(ws, 'a', 'title', '塔') === ws, 'W-3 同じタイトルは変化なし');
  var lk = W.edit(ws, 'a', 'like', '形');
  eq(lk[0].like, '形', 'W-3 気に入っているところ');
  eq(W.edit(lk, 'a', 'like', ' ')[0].like, null, 'W-3 気に入っているところは空にできる');
  eq(W.edit(ws, 'a', 'craft', '先に高さを決めた')[0].craft, '先に高さを決めた', 'W-3 工夫したところ');
  ok(W.edit(ws, 'a', 'status', 'done') === ws, 'W-3 直せる欄は title / like / craft だけ');
  eq(W.setRead(ws, 'b', { text: 'y', edited: true, declined: false })[1].read.text, 'y', 'W-3 見立てを直す');
  eq(W.setRead(ws, 'b', { text: 'x', edited: true, declined: true })[1].read.declined, true, 'W-3 見立ての「違う」');
  ok(W.setRead(ws, 'a', { text: 'y' }) === ws, 'W-3 見立ては写真から作った作品だけ');
  var rm = W.remove(ws, 'a');
  eq([rm.works.length, rm.works[0].id, rm.undo.index], [1, 'b', 0], 'W-3 作品から外す');
  eq(W.restore(rm.works, rm.undo).map(function (w) { return w.id; }), ['a', 'b'], 'W-3 元に戻す = 元の位置');
  eq(W.restore([], { work: { id: 'z' }, index: 9 }).map(function (w) { return w.id; }), ['z'], 'W-3 戻す位置は範囲に収める（境界）');
  ok(W.restore(ws, rm.undo) === ws, 'W-3 もうある作品は戻さない');
  eq(W.remove(ws, 'nope'), null, 'W-3 無い作品は外せない');
  eq(ws, snap, 'W-3 どの操作も元の配列を変えない');
  var sb = W.siblings([{ id: 'a', actId: 'x' }, { id: 'b', actId: 'x' }, { id: 'c', actId: 'y' }], { id: 'a', actId: 'x' });
  eq(sb.map(function (w) { return w.id; }), ['b'], 'W-3 同じ活動から残したほかの作品');
});
t('W-4 見せる・見せるのをやめる', function () {
  var ws = [{ id: 'a', title: '塔', shares: [] }, { id: 'b', title: '回路' }];
  var r = W.share(ws, 'a', { to: ['friends', 'nope', 'family', 'family'], scope: 'story', time: '11/2 10:20' });
  eq(r.share.to, ['family', 'friends'], 'W-4 相手は決まった 3 つから・並びはそろえる・重ならない');
  eq([r.share.scope, r.share.time, r.works[0].shares.length], ['story', '11/2 10:20', 1], 'W-4 1 件足す');
  eq(W.share(ws, 'a', { to: [], scope: 'work' }), null, 'W-4 相手 0 人は見せられない');
  eq(W.share(ws, 'a', { to: ['nope'] }), null, 'W-4 知らない相手だけも 0 人');
  eq(W.share(ws, 'b', { to: ['supporter'], scope: '??' }).share.scope, 'work', 'W-4 範囲の既定は作品だけ（shares 無しの作品にも足せる）');
  eq(W.share(ws, 'zz', { to: ['family'] }), null, 'W-4 無い作品');
  var r2 = W.share(r.works, 'a', { to: ['supporter'], scope: 'work', time: 't' });
  var un = W.unshare(r2.works, 'a', r.share.id);
  eq(un.works[0].shares.map(function (s) { return s.id; }), [r2.share.id], 'W-4 1 件ずつやめる');
  var r3 = W.share(un.works, 'a', { to: ['family'], time: 't' });
  ok(r3.share.id !== r2.share.id, 'W-4 やめた後に見せても id は重ならない');
  eq(W.undoUnshare(un.works, un.undo)[0].shares.map(function (s) { return s.id; }), [r.share.id, r2.share.id], 'W-4 元に戻す = 元の位置');
  ok(W.undoUnshare(r2.works, un.undo) === r2.works, 'W-4 もう戻っていれば何もしない');
  eq(W.unshare(r2.works, 'a', 'nope'), null, 'W-4 無い記録');
  eq(ws[0].shares, [], 'W-4 元の配列は変えない');
});
t('W-4 相手に見える内容（作品だけ / 流れも）', function () {
  var acts = MD.seedActivities(), sw = MD.seedWorks(acts);
  function byId(id) { return sw.filter(function (w) { return w.id === id; })[0]; }
  function actOf(w) { return acts.filter(function (a) { return a.id === w.actId; })[0]; }
  var cap = byId('w-seed-circuit');
  var only = W.shareItems(cap, actOf(cap), 'work');
  eq(only.map(function (i) { return i.k; }), ['pv_title', 'pv_like', 'pv_craft_none'], 'W-4 作品だけ = 絵とタイトル・本人の言葉');
  ok(JSON.stringify(only).indexOf(cap.read.text) < 0, 'W-4 作品だけにはバディの見立てを入れない');
  var story = W.shareItems(cap, actOf(cap), 'story');
  eq(story.length, 5, 'W-4 流れも = 5 行');
  eq([story[3].k, story[3].v.n], ['pv_story', 2], 'W-4 変わってきたところのコマ数');
  eq([story[4].k, story[4].read], ['pv_roles', cap.read.text], 'W-4 見立ては関わりの行に出所つきで');
  var dec = cl(cap); dec.read.declined = true;
  eq(W.shareItems(dec, actOf(cap), 'story')[4].read, null, 'W-4 違うと言った見立ては見せない');
  eq(W.shareItems(cap, null, 'story')[3].k, 'pv_story_lost', 'W-4 活動が無ければ記録は無いと書く');
  eq(only.filter(function (i) { return i.src === 'own'; }).length, 1, 'W-4 本人の言葉は本人の出所');
  // 相手に見えるものに個人名を入れない（Astra 指摘 2）: 手伝った人は「いっしょに作った人」の回数だけ
  var py = byId('w-seed-py'), pyStory = W.shareItems(py, actOf(py), 'story');
  eq(py.roles.people, [{ name: '田中さん', n: 1 }], 'W-4 前提: 作品の関わりには田中さん（本人の詳細では名前のまま）');
  eq(pyStory[4].roles, { own: 4, ai: 1, with: 1 }, 'W-4 流れもの関わり = 本人・バディ・いっしょに作った人の回数');
  ok(JSON.stringify(pyStory).indexOf('田中') < 0 && JSON.stringify(W.shareItems(py, actOf(py), 'work')).indexOf('田中') < 0, 'W-4 プレビューに個人名が無い');
  var two = cl(py); two.roles.people = [{ name: 'A', n: 2 }, { name: 'B', n: 1 }];
  eq(W.shareItems(two, actOf(py), 'story')[4].roles.with, 3, 'W-4 複数の人もまとめて回数だけ（境界）');
  eq(W.shareItems(Object.assign(cl(py), { roles: null }), actOf(py), 'story')[4].roles, null, 'W-4 関わりが無ければ null（境界）');
});
t('W-6 見本の作品', function () {
  var acts = MD.seedActivities(), sw = MD.seedWorks(acts), g = W.group(sw);
  eq([g.done.length, g.trial.length], [2, 2], 'W-6 完成 2 + 試作 2');
  var big = g.done.filter(function (w) { return w.from === 'make'; })[0], cap = g.done.filter(function (w) { return w.from === 'capture'; })[0];
  function actOf(w) { return acts.filter(function (a) { return a.id === w.actId; })[0]; }
  ok(big && W.storyFrames(actOf(big), big).length - 1 >= 4, 'W-6 完成の 1 つは変化 4 つ以上');
  ok(cap && cap.read && cap.read.text && !cap.read.declined, 'W-6 完成の 1 つは写真から・バディの見立てあり');
  eq(cap.shares.length === 1 && cap.shares[0].to, ['family'], 'W-6 その作品はおうちの人に見せている 1 件');
  eq(g.trial.concat(big).every(function (w) { return !W.isShown(w); }), true, 'W-6 ほかは誰にも見せていない');
  var themes = {};
  sw.forEach(function (w) { themes[w.theme] = true; });
  eq(Object.keys(themes).sort(), ['circuit', 'mc', 'py'], 'W-6 題材は §U-1 の 3 つだけ');
  sw.forEach(function (w) {
    var a = actOf(w), ch = a.changes.filter(function (c) { return c.id === w.at; })[0];
    eq(w.roles, M.roles(a, w.at), 'W-6 ' + w.id + ' の関わりは make.js の roles と同じ');
    eq(w.snap, M.chState(a, ch), 'W-6 ' + w.id + ' の残した時点の状態は chState と同じ');
    if (w.from === 'make') eq(w.art, M.saveWork([], a, { id: 'x', at: w.at }).work.art, 'W-6 ' + w.id + ' の絵は saveWork と同じ');
    eq(M.migrateWork(w, acts), w, 'W-6 ' + w.id + ' は移行で変わらない');
  });
  eq(W.normalize(sw), sw, 'W-6 見本は補う欄が無い');
  var people = {};
  acts.forEach(function (a) { a.changes.forEach(function (c) { if (c.with) people[c.with] = true; }); });
  eq(Object.keys(people), ['田中さん'], 'W-6 人の名前は既存の田中さんだけ');
  eq(acts.filter(function (a) { return a.state === 'working' || a.state === 'paused'; }).map(function (a) { return a.id; }), ['act-build'], 'W-6 作るの制作中は今までどおり 1 件');
  eq(acts.map(function (a) { return M.migrate(a, function () { return ''; }) === a; }), [true, true, true], 'W-6 見本の活動は v:3 のまま');
  eq(MD.seedWorks([acts[0]]).map(function (w) { return w.id; }), ['w-seed-build'], 'W-6 結び付く活動が無い作品は作らない（境界）');
  eq(MD.seedWorks([]), [], 'W-6 活動 0 件なら作品 0 件');
  var text = JSON.stringify(sw) + JSON.stringify(acts);
  ok(!/版|点数|ランキング|順位|評価|成績|レベル|集中力|得意|苦手|上手|成長|頑張|すごい/.test(text), 'W-7 見本に「版」と評価の語が無い');
});

// ======================================================================
// contract-Y: 4 つ目の題材「自分を助ける道具」（tool）と自己理解からの入口
// ======================================================================
t('Y-3 pickTheme: 論点 / 道具 / 整理 / 合図 は既存の判定より前に tool', function () {
  eq(M.pickTheme('論点を整理する道具'), 'tool', 'Y-3 論点を整理する道具 → tool');
  eq(M.pickTheme('マイクラの道具'), 'tool', 'Y-8-9 マイクラの道具 → tool（複合入力は tool 優先）');
  eq(M.pickTheme('マイクラの家'), 'mc', 'Y-3 マイクラの家 → mc のまま');
  eq(M.pickTheme('合図を出したい'), 'tool', 'Y-3 合図 → tool');
  eq(M.pickTheme('メモを整理'), 'tool', 'Y-3 整理 → tool');
  eq(M.pickTheme('Python のゲーム'), 'py', 'Y-3 Python は py のまま');
  eq(M.pickTheme('絵を描きたい'), 'mc', 'Y-3 どれも無ければマイクラのまま');
  var c = M.fromText('論点を整理する道具', { id: 'yt1', now: '10:20', mode: 'js' });
  eq([c.theme, c.title, c.shelf.map(function (k) { return k.theme + '.' + k.variant; })], ['tool', '自分を助ける道具', ['tool.nudge', 'tool.oneby', 'tool.board']], 'Y-3 思いつきから tool の仮の案 3 つ');
});
t('Y-0 入口の見本・写真に tool を出さない（枚数は §AD-3 で 6 枚に置き換え）', function () {
  eq(MD.THEMES, ['mc', 'py', 'circuit', 'tool', 'stop', 'ath', 'story'], 'Y-1 / AD-1 MD.THEMES に tool と 3 題材');
  eq(MD.samples.map(function (x) { return x.theme; }), ['stop', 'ath', 'story', 'mc', 'py', 'circuit'], 'AD-3 見本は 6 枚（tool は入れない）');
  eq(MD.captures.map(function (x) { return x.theme; }), ['mc', 'py', 'circuit'], 'Y-0 作品の写真は 3 つのまま');
});
function tst(va, count, every) { return { kind: 'sample', theme: 'tool', variant: va, values: { count: count, every: every } }; }
t('Y-2 結果の 1 行・コード・説明（verbatim）', function () {
  eq(MD.result(tst('memo', 3, 2), 'js'), '5 分ごとに、話を 3 つの論点カードにまとめる', 'Y-2 memo js');
  eq(MD.result(tst('memo', 3, 2), 'es'), '5 分ごとに、話を 3 つのカードにまとめる', 'Y-2 memo es');
  eq(MD.result(tst('nudge', 2, 4), 'js'), '話が終わったら、「いまの話を 2 行で」と手もとに出す', 'Y-2 nudge 話が終わったら');
  eq(MD.result(tst('nudge', 2, 4), 'es'), '話がおわったら、「いまの話を 2 行で」と手もとに出す', 'Y-2 nudge es');
  eq(MD.result(tst('oneby', 1, 4), 'js'), '決めることを 1 つずつ出して、話が終わったら次を出す', 'Y-2 oneby 話が終わったら（読点を重ねない）');
  eq(MD.result(tst('oneby', 2, 3), 'es'), 'きめることを 2 つずつ出して、10 分ごとにつぎを出す', 'Y-2 oneby es');
  eq(MD.result(tst('board', 4, 0), 'js'), '1 分ごとに、話を 4 本の枝の図に書き足す', 'Y-2 board js');
  eq(MD.result(tst('board', 4, 0), 'es'), '1 分ごとに、話を 4 本のえだの図に書きたす', 'Y-2 board es');
  eq(MD.code(tst('memo', 3, 2)), 'メモ → AI → 論点 × 3（5 分ごと）', 'Y-2 code memo');
  eq(MD.code(tst('nudge', 1, 4)), '時計 → 合図「いまの話を 1 行で」（話の終わり）', 'Y-2 code nudge');
  eq(MD.code(tst('oneby', 2, 1)), 'リスト → 2 件ずつ表示（3 分ごと）', 'Y-2 code oneby');
  eq(MD.code(tst('board', 5, 3)), 'メモ → AI → 枝 × 5（10 分ごと）', 'Y-2 code board');
  eq(MD.desc(tst('memo', 3, 2), 'js'), '論点 3 · 5 分ごと', 'Y-8-2 desc memo');
  eq(MD.desc(tst('nudge', 1, 4), 'es'), '1 行 · 話の終わり', 'Y-8-2 desc nudge（モード共通）');
  eq(MD.desc(tst('oneby', 2, 0), 'js'), '2 件ずつ · 1 分ごと', 'Y-8-2 desc oneby');
  eq(MD.desc(tst('board', 4, 2), 'js'), '枝 4 · 5 分ごと', 'Y-8-2 desc board');
  eq(MD.valueLabel('tool', 'every', 4, 'es'), '話がおわったら', 'Y-2 間かくの名前 es');
});
t('Y-4 tool がどの値でも別の題材の文・NaN に落ちない', function () {
  var bad = [];
  MD.theme('tool').variants.forEach(function (va) {
    for (var c = 1; c <= 5; c++) for (var e = 0; e <= 4; e++) {
      var st = tst(va, c, e), svg = MD.art(st), txt = [MD.result(st, 'js'), MD.result(st, 'es'), MD.code(st), MD.desc(st, 'js'), MD.desc(st, 'es'), svg.replace(/<[^>]*>/g, ' ')].join(' | ');
      if (/NaN|undefined|null|\bV\b|Ω|mA|ブロック|星|電|マイクラ|minecraft|speed/.test(txt)) bad.push(va + ' ' + c + ' ' + e + ': ' + txt.slice(0, 80));
      // SVG の属性（座標・半径など）に NaN / undefined / Infinity が入っていないか（タグを取り除く前の文字列で見る。レビュー MINOR 2）
      if (/NaN|undefined|Infinity/.test(svg)) bad.push(va + ' ' + c + ' ' + e + ' svg: ' + (svg.match(/[^"]*(NaN|undefined|Infinity)[^"]*/) || [''])[0]);
    }
  });
  eq(bad, [], 'Y-4 別の題材の語が 0 件');
  // 手順は Y-2 の stepBase（まとめる数 / 間かく / 3 つ目）と各 variant の step3 の verbatim と一致（レビュー MINOR 3）
  var BASE = [['まとめる数を変える', 'まとめる数をかえる'], ['間かくを決める', 'あいだをきめる']];
  var STEP3 = { memo: ['サークル対話で使ってみる', 'サークル対話でつかってみる'], nudge: ['合図の言葉を決める', 'あいずのことばをきめる'],
    oneby: ['次を出す合図を決める', 'つぎを出すあいずをきめる'], board: ['真ん中に書くことを決める', 'まん中に書くことをきめる'] };
  ['memo', 'nudge', 'oneby', 'board'].forEach(function (va) {
    eq(MD.stepsFor('tool', va), BASE.concat([STEP3[va]]), 'Y-2 stepsFor tool.' + va + ' は契約の文言');
    ok(/^<svg/.test(MD.art(tst(va, 3, 2))), 'Y-4 MD.art tool.' + va + ' は線画');
    ok(MD.art(tst(va, 3, 2)) !== MD.art({ kind: 'sample', theme: 'mc', variant: 'cube', values: { size: 4, block: 0 } }), 'Y-4 tool.' + va + ' はマイクラの図に落ちない');
  });
  eq(JSON.parse(MD.artMarks(tst('board', 4, 3))), { items: 4, every: 10 }, 'Y-2 artMarks tool');
  ok(MD.photoArt({ theme: 'tool', n: 1 }).indexOf('is-photo') >= 0 && MD.photoArt({ theme: 'tool', n: 1 }) !== MD.photoArt({ theme: 'mc', n: 1 }), 'Y-4 photoArt tool はマイクラの写真に落ちない');
});
t('Y-2 tool × 2 値: 線画と印が変わる（U11-b と同じ型）', function () {
  [['memo', { count: 3, every: 2 }, 'count', 4], ['memo', { count: 3, every: 2 }, 'every', 3], ['board', { count: 4, every: 2 }, 'count', 2], ['nudge', { count: 1, every: 1 }, 'every', 4]].forEach(function (c) {
    var a = tst(c[0], c[1].count, c[1].every), b = JSON.parse(JSON.stringify(a));
    b.values[c[2]] = c[3];
    ok(MD.art(a) !== MD.art(b), 'Y-2 tool.' + c[0] + '.' + c[2] + ' で線画が変わる');
    ok(MD.artMarks(a) !== MD.artMarks(b), 'Y-2 tool.' + c[0] + '.' + c[2] + ' の量が図の印に出る');
  });
});
t('Y-2 試した時の返事（題材の語だけ差し替え）', function () {
  eq(MD.testReply(tst('memo', 4, 2), 'count', 3, 'js'), '選んだまとめる数に変えて、まとめる数に違いが出たね。狙っていた数に近い？', 'Y-2 count js');
  eq(MD.testReply(tst('memo', 4, 2), 'count', 3, 'es'), 'まとめる数をかえたら、さっきよりカードがふえたね。変えたところが数に出たね', 'Y-2 count 増えた memo');
  eq(MD.testReply(tst('board', 2, 2), 'count', 3, 'es'), 'まとめる数をかえたら、さっきより枝がへったね。変えたところが数に出たね', 'Y-2 count 減った board');
  eq(MD.testReply(tst('nudge', 2, 1), 'count', 1, 'es'), 'まとめる数をかえたら、さっきより行がふえたね。変えたところが数に出たね', 'Y-2 count nudge');
  eq(MD.testReply(tst('memo', 3, 3), 'every', 2, 'js'), '選んだ間かくに変えて、出る間かくに違いが出たね。狙っていた間かくに近い？', 'Y-2 every js');
  eq(MD.testReply(tst('memo', 3, 1), 'every', 2, 'es'), 'あいだをかえたら、さっきよりよく出るようになったね。変えたところが間かくに出たね', 'Y-2 every 小さく');
  eq(MD.testReply(tst('memo', 3, 3), 'every', 2, 'es'), 'あいだをかえたら、さっきより出るのがゆっくりになったね。変えたところが間かくに出たね', 'Y-2 every 大きく');
  eq(MD.testReply(tst('memo', 3, 4), 'every', 3, 'es'), 'あいだをかえたら、さっきより出るのがゆっくりになったね。変えたところが間かくに出たね', 'Y-2 every 話の終わりは最も長い');
  eq(MD.testReply(tst('memo', 3, 3), 'every', 4, 'es'), 'あいだをかえたら、さっきよりよく出るようになったね。変えたところが間かくに出たね', 'Y-2 every 話の終わり → 10 分（境界）');
});
function fself(o) { return M.fromSelf(Object.assign({ id: 'ys1', linkId: 'k1-tool', text: '自分のメモを入れると、AI が論点ごとに分けて整理してくれる道具を作る', variant: 'memo', src: 'buddy', mode: 'js', now: '10:20' }, o || {})); }
t('Y-4 fromSelf: tool / 論点メモの作業台', function () {
  var a = fself();
  eq([a.theme, a.origin, a.title, a.selfLink], ['tool', 'self', '論点メモ', 'k1-tool'], 'Y-4 題材・出所・題名・紐づけ');
  eq(a.stage, { kind: 'sample', theme: 'tool', variant: 'memo', values: { count: 3, every: 2 } }, 'Y-4 作業対象は tool.memo（sample）');
  eq(a.quote, { text: '自分のメモを入れると、AI が論点ごとに分けて整理してくれる道具を作る', removed: false, src: 'buddy' }, 'Y-8-5 引用に工夫の文と出所');
  eq(a.shelf.map(function (c) { return [c.kind, c.variant, c.state]; }), [['draft', 'nudge', 'new'], ['draft', 'oneby', 'new'], ['draft', 'board', 'new']], 'Y-8-3 仮の案 3 つ');
  eq(a.shelf.map(function (c) { return MD.pick(M.cardTitle(c), 'js'); }), ['ひとこと合図', 'ひとつずつリスト', '話の地図'], 'Y-8-3 仮の案の名前');
  eq(a.thread.map(function (m) { return m.r; }), ['open'], 'Y-4 返事は open');
  eq(a.steps.map(function (x) { return x[0]; }), ['まとめる数を変える', '間かくを決める', 'サークル対話で使ってみる'], 'Y-4 手順は tool の stepBase');
  eq(M.leaveOptions(a), ['find', 'one'], 'Y-8-3 任せるは見本と同じ操作の組');
  eq(fself({ mode: 'es' }).title, 'ろんてんメモ', 'Y-4 題名 es');
  eq(fself({ variant: 'nope' }).stage.variant, 'memo', 'Y-4 知らない variant は memo（境界）');
  eq(fself({ variant: 'board' }).title, '話の地図', 'Y-4 variant を渡せる');
  eq(fself({ src: 'own' }).quote.src, 'own', 'Y-8-5 own');
  eq(fself({ src: 'x' }).quote.src, 'own', 'Y-8-5 知らない src は own（境界）');
  eq(fself({ linkId: 'bad id"' }), null, 'Y-4 linkId の形が違えば作らない（境界）');
  eq(fself({ linkId: 'scene:n1-2' }).selfLink, 'scene:n1-2', 'Y-4 場面の紐づけ');
  var acts = [{ id: 'x1' }, fself(), fself({ id: 'ys2' })];
  eq(M.findSelfLink(acts, 'k1-tool').id, 'ys1', 'Y-4 同じ紐づけの最初の活動');
  eq(M.findSelfLink(acts, 'k1-ai'), null, 'Y-4 紐づけが無ければ null');
});
t('Y-6 作業台の操作が tool の文で動く（試す / 任せる / これにする / 比べる / 作り直す / 違う / 前に戻す）', function () {
  var a = fself(), r = M.test(M.setParam(a, 'count', 5));
  eq(r.change.what, { k: 'changed_one', v: { label: ['まとめる数', 'まとめる数'], value: ['5', '5'] } }, 'Y-6 試すの記録');
  eq(MD.testReply(r.act.stage, r.key, r.from, 'es'), 'まとめる数をかえたら、さっきよりカードがふえたね。変えたところが数に出たね', 'Y-6 試した返事');
  var r2 = M.test(M.setParam(r.act, 'every', 4));
  eq(r2.change.what.v.value, ['話が終わったら', '話がおわったら'], 'Y-6 間かくの名前で記録');
  var l = settled(r2.act, 'find'), card = l.act.shelf[0];
  eq([card.kind, card.theme, card.values], ['value', 'tool', { count: 2, every: 1 }], 'Y-6 任せる（find）は tool の値');
  var one = settled(r2.act, 'one');
  eq(one.act.shelf[0].values, { count: 1, every: 4 }, 'Y-6 1 か所変えて（count の上限で回る）');
  var ad = M.adopt(l.act, card.id);
  eq([ad.act.stage.theme, ad.act.theme, ad.change.who], ['tool', 'tool', 'ai'], 'Y-6 これにする');
  var rd = settled(M.adopt(a, a.shelf[0].id).act, 'redo');
  eq(rd.act.shelf[0].variant, 'oneby', 'Y-6 作り直す（次の案）');
  var tw = settled(M.adopt(a, a.shelf[0].id).act, 'two');
  eq(tw.act.shelf.slice(0, 2).map(function (c) { return c.variant; }), ['oneby', 'board'], 'Y-6 別の案を 2 つ（今の案以外の仮の案）');
  var dc = M.decline(a, a.shelf[1].id);
  eq(dc.act.shelf[1].state, 'passed', 'Y-6 違う');
  eq(M.undoDecline(dc.act, dc.undo).shelf[1].state, 'new', 'Y-6 違うを戻す');
  var rv = M.revert(r2.act, null);
  eq(rv.act.stage.values, { count: 5, every: 2 }, 'Y-6 前に戻す');
  var names = M.cardNames(l.act.shelf, 'js');
  eq(Object.keys(names).length, new Set(Object.keys(names).map(function (k) { return names[k]; })).size, 'Y-6 棚の名前は別々');
});
t('Y-8-3 extCards.tool は外の記録の場面で使う', function () {
  var x = fself(); x.stage = null; x.ext = { link: null, photos: [], visible: [] };
  eq(M.leaveOptions(x), ['calc', 'steps', 'cmd'], 'Y-8-3 外の記録の候補');
  var c = settled(x, 'calc').act.shelf[0], s2 = settled(x, 'steps').act.shelf[0], cm = settled(x, 'cmd').act.shelf[0];
  eq([c.kind, MD.pick(c.title, 'js')], ['note', '使う時間'], 'Y-8-3 calc');
  eq(MD.pick(s2.title, 'js'), '論点メモの使い方', 'Y-8-3 steps');
  eq([cm.variant, cm.values], ['board', { count: 4, every: 2 }], 'Y-8-3 cmd');
  var again = M.remake(settled(x, 'calc').act, c.id, 'calc');
  eq(MD.pick(again.act.shelf[0].title, 'js'), '使う時間（10 分ごと）', 'Y-8-3 calc の作り直しは alt');
});
t('Y-8-4 紐づく活動は引用を直しても題材を選び直さない', function () {
  var a = fself(), e = M.editQuote(a, 'マイクラで家を建てたい', [], 'js');
  eq([e.changed, e.act.theme, e.act.selfLink], [true, 'tool', 'k1-tool'], 'Y-8-4 題材 tool・紐づけはそのまま');
  eq(e.act.quote.src === undefined || e.act.quote.src === 'own', true, 'Y-8-5 直した引用は本人の言葉');
  eq(e.act.shelf.filter(function (c) { return c.state === 'new'; }).map(function (c) { return c.theme; }), ['tool', 'tool', 'tool'], 'Y-8-4 足す案も tool');
  var c = M.fromText('論点を整理したい', { id: 'yq', now: '10:20' }), e2 = M.editQuote(c, 'マイクラで家', [], 'js');
  eq(e2.act.theme, 'mc', 'Y-8-4 紐づけの無い活動は今までどおり選び直す');
});
t('Y-8-12 移行: selfLink と quote.src の形を検査（版によらず）', function () {
  var a = fself();
  eq(M.migrate(a, null) === a, true, 'Y-8-12 正しい形はそのまま（同じもの）');
  var b = JSON.parse(JSON.stringify(a)); b.selfLink = 'bad link<'; b.quote.src = 'x';
  var mb = M.migrate(b, null);
  eq([mb.selfLink === undefined, mb.quote.src === undefined, mb.quote.text], [true, true, a.quote.text], 'Y-8-12 形の違う値は捨てる（v:3 でも）');
  var c = JSON.parse(JSON.stringify(a)); c.selfLink = 12;
  eq(M.migrate(c, null).selfLink, undefined, 'Y-8-12 文字列でない selfLink は捨てる');
  var d = JSON.parse(JSON.stringify(a)); d.v = 1; d.selfLink = 'x'.repeat(65);
  var md = M.migrate(d, function () { return ''; });
  eq([md.selfLink, md.v, md.theme], [undefined, 3, 'tool'], 'Y-8-12 古い版でも捨てる（65 字は長すぎ）');
  var e = JSON.parse(JSON.stringify(a)); e.v = 2;
  eq(M.migrate(e, function () { return ''; }).selfLink, 'k1-tool', 'Y-8-12 古い版でも正しい紐づけは保つ');
});
t('Y-6 作品に残す: tool の絵と題材', function () {
  var a = M.test(M.setParam(fself(), 'count', 4)).act, sw = M.saveWork([], a, { id: 'wy' });
  eq([sw.work.theme, sw.work.actId, sw.work.art.stage.theme], ['tool', 'ys1', 'tool'], 'Y-6 作品は tool');
  ok(/^<svg/.test(MD.art(sw.work.art.stage)), 'Y-6 作品の絵は tool の線画');
});

t('Y-9 写真の「何を変えた？」: tool は選択肢と同じ語（change_opts_tool）で残す', function () {
  var x = fself(); x.stage = null;
  var p = M.addPhoto(x, 'photo'), d = M.describePhoto(p.act, p.change.id, 1, '');
  eq(d.what, { k: 'changed_aspect', v: { what: { k: 'change_opts_tool', i: 1 } } }, 'Y-9 tool の写真: 間かく（i18n の 1 番目）');
  eq(M.describePhoto(p.act, p.change.id, 4, '').what, null, 'Y-9 それ以外は候補を残さない（今までどおり）');
  var e = M.addPhoto(M.fromExt('photo', { id: 'dpm', now: '10:20' }), 'shot');
  eq(M.describePhoto(e.act, e.change.id, 1, '').what, { k: 'changed_aspect', v: { what: ['大きさ', '大きさ'] } }, 'Y-9 マイクラは今までどおり');
});
t('Y-9 tool の「どこが違う？」: 選択肢の key と任せる操作の対応', function () {
  eq(M.TOOL_ASPECT, ['one', 'fix', 'redo', 'redo', 'redo'], 'Y-9 TOOL_ASPECT');
  var a = fself();
  eq(M.changeOptsKey(a), 'change_opts_tool', 'Y-9 tool は change_opts_tool');
  eq(M.changeOptsKey(sample('mc')), 'change_opts', 'Y-9 マイクラは change_opts のまま');
  eq(M.changeOptsKey({ theme: 'odai' }), 'change_opts', 'Y-9 odai は change_opts のまま');
  // 作業対象 = 見本（sample）: one = まとめる数 +1 / fix = 間かく +1 / redo = 次の案
  var want = [['value', { count: 4, every: 2 }], ['value', { count: 3, every: 3 }], ['draft', 'nudge'], ['draft', 'nudge'], ['draft', 'nudge']];
  [0, 1, 2, 3, 4].forEach(function (i) {
    var r = M.leave(a, 'aspect', { aspect: i }), c = r.act.shelf[0];
    eq([r.opt, c.kind, c.kind === 'value' ? c.values : c.variant], [M.TOOL_ASPECT[i], want[i][0], want[i][1]], 'Y-9 aspect ' + i + ' → ' + M.TOOL_ASPECT[i]);
  });
  eq(M.leave(sample('mc'), 'aspect', { aspect: 0 }).opt, 'redo', 'Y-9 マイクラの aspect は ASPECT_OPT のまま（形 → redo）');
  eq(M.leave(sample('mc'), 'aspect', { aspect: 3 }).opt, 'one', 'Y-9 マイクラの aspect は ASPECT_OPT のまま（動き → one）');
  eq(M.leave(a, 'aspect', { aspect: 99 }).opt, 'redo', 'Y-9 範囲外は 4（それ以外）に丸める（境界）');
});

// ======================================================================
// contract-app §AD: 作るを広げる（コマ撮り / アスレチック / 物語・入口の組・こんなのも作れる・作品の見本）
// ======================================================================
var fs = require('fs'), vm = require('vm'), ORANGE_HEX = '#ed922c';
function adSt(theme, variant, values) { return { kind: 'sample', theme: theme, variant: variant, values: values }; }
t('AD-2 pickTheme の新しい期待値', function () {
  eq(M.pickTheme('マイクラのアスレチック作りたい'), 'ath', 'AD-2 マイクラのアスレチック → ath（マイクラより前）');
  eq(M.pickTheme('パルクールのコース'), 'ath', 'AD-2 パルクール → ath');
  eq(M.pickTheme('ギミックを足したい'), 'ath', 'AD-2 ギミック → ath');
  eq(M.pickTheme('コマ撮りやってみたい'), 'stop', 'AD-2 コマ撮り → stop');
  eq(M.pickTheme('コマどり'), 'stop', 'AD-2 コマどり → stop');
  eq(M.pickTheme('コマドリ'), 'stop', 'AD-2 コマドリ → stop');
  eq(M.pickTheme('ストップモーション'), 'stop', 'AD-2 ストップモーション → stop');
  eq(M.pickTheme('マイクラの動画'), 'stop', 'AD-2 動画 → stop（マイクラより前）');
  eq(M.pickTheme('小説を書く'), 'story', 'AD-2 小説 → story');
  eq(M.pickTheme('お話を作る'), 'story', 'AD-2 お話 → story');
  eq(M.pickTheme('ものがたり'), 'story', 'AD-2 ものがたり → story');
  eq(M.pickTheme('アスレチックの動画'), 'ath', 'AD-2 上から順（アスレチック → 動画）');
  eq(M.pickTheme('物語の動画'), 'stop', 'AD-2 上から順（動画 → 物語）');
  eq(M.pickTheme('道具の動画'), 'tool', 'AD-2 tool が最初（既存）');
  eq(M.pickTheme('Python のゲーム'), 'py', 'AD-2 既存の順はそのまま');
  eq(M.pickTheme('絵を描きたい'), 'mc', 'AD-2 どれも無ければマイクラ');
  var c = M.fromText('マイクラのアスレチック作りたい', { id: 'ad1', now: '10:20', mode: 'js' });
  eq([c.theme, c.title, c.shelf.map(function (k) { return k.theme + '.' + k.variant; })], ['ath', 'マイクラのアスレチック', ['ath.slime', 'ath.piston', 'ath.ice']], 'AD-8 思いつきから アスレチックの案 3 つ');
});
t('AD-1 結果・コード・説明（verbatim）', function () {
  eq(MD.result(adSt('stop', 'walk', { frames: 2, fps: 1 }), 'js'), '人形が歩く動画 · 12 コマ ÷ 1 秒に 6 コマ = 2 秒', 'AD-1 stop result');
  eq(MD.result(adSt('stop', 'brick', { frames: 3, fps: 2 }), 'js'), 'ブロックの車が走る動画 · 18 コマ ÷ 1 秒に 8 コマ = 2.3 秒', 'AD-1 stop result（小数 1 けた）');
  eq(MD.result(adSt('stop', 'walk', { frames: 2, fps: 1 }), 'es'), '人形があるく動画 · 12 コマ ÷ 1 びょうに 6 コマ = 2 びょう', 'AD-1 stop result 小');
  eq(MD.code(adSt('stop', 'clay', { frames: 0, fps: 3 })), '6 コマ ÷ 12 コマ/秒 = 0.5 秒', 'AD-1 stop code');
  eq(MD.desc(adSt('stop', 'draw', { frames: 1, fps: 1 }), 'js'), '8 コマ · 1 秒に 6 コマ', 'AD-1 stop desc');
  eq(MD.result(adSt('ath', 'jump', { gap: 2, count: 5 }), 'js'), '足場 5 個 · あいだ 2 ブロック · ふつう', 'AD-1 ath result jump');
  eq(MD.result(adSt('ath', 'slime', { gap: 3, count: 5 }), 'js'), '足場 5 個（跳ねる足場 2 個）· あいだ 3 ブロック · むずかしい', 'AD-1 ath result slime');
  eq(MD.result(adSt('ath', 'ice', { gap: 1, count: 7 }), 'js'), '足場 7 個（すべる足場 3 個）· あいだ 1 ブロック · かんたん', 'AD-1 ath result ice');
  eq(MD.result(adSt('ath', 'piston', { gap: 4, count: 8 }), 'es'), '足場 8 こ（うごく足場 4 こ）· あいだ 4 ブロック · とてもむずかしい', 'AD-1 ath result 小');
  eq(MD.code(adSt('ath', 'slime', { gap: 3, count: 5 })), '/setblock ~0 ~ ~ minecraft:stone\n/setblock ~4 ~ ~ minecraft:slime_block\n/setblock ~8 ~ ~ minecraft:stone\n…', 'AD-1 ath code（先頭 3 行 + …）');
  eq(MD.code(adSt('ath', 'jump', { gap: 1, count: 3 })), '/setblock ~0 ~ ~ minecraft:stone\n/setblock ~2 ~ ~ minecraft:stone\n/setblock ~4 ~ ~ minecraft:stone', 'AD-1 ath code 3 個なら … なし');
  eq(MD.desc(adSt('ath', 'piston', { gap: 2, count: 6 }), 'js'), '足場 6 · あいだ 2', 'AD-1 ath desc');
  eq(MD.result(adSt('story', 'short', { scenes: 4, voice: 0 }), 'js'), '4 場面の物語 · 「わたし」が語る · 山場は 3 場面目', 'AD-1 story result');
  eq(MD.code(adSt('story', 'letter', { scenes: 3, voice: 2 })), 'はじまり → できごと × 1 → おわり（手紙で語る）', 'AD-1 story code');
  eq(MD.desc(adSt('story', 'mystery', { scenes: 5, voice: 1 }), 'js'), '5 場面 · 外から語る', 'AD-1 story desc');
  eq(MD.result(adSt('story', 'future', { scenes: 7, voice: 1 }), 'es'), '7 場めんのものがたり · 外からかたる · 山場は 6 場めん目', 'AD-1 story result 小');
  eq(JSON.parse(MD.artMarks(adSt('stop', 'walk', { frames: 4, fps: 0 }))), { frames: 24, secs: 6 }, 'AD-1 artMarks stop');
  eq(JSON.parse(MD.artMarks(adSt('ath', 'slime', { gap: 3, count: 7 }))), { count: 7, gap: 3, gimmick: 3 }, 'AD-1 artMarks ath');
  eq(JSON.parse(MD.artMarks(adSt('ath', 'jump', { gap: 3, count: 7 }))), { count: 7, gap: 3, gimmick: 0 }, 'AD-1 artMarks ath jump はギミック 0');
  eq(JSON.parse(MD.artMarks(adSt('story', 'short', { scenes: 6, voice: 2 }))), { scenes: 6, voice: 2, peak: 5 }, 'AD-1 artMarks story');
});
t('AD-1 3 題材の全案 × 全値で NaN・undefined・別題材の語が出ない', function () {
  var bad = [], WRONG = {
    stop: /NaN|undefined|null|Infinity|足場|場面|場めん|ブロック 1|Ω|mA|星|論点|minecraft/,
    ath: /NaN|undefined|null|Infinity|コマ|秒|びょう|場面|場めん|Ω|mA|星|論点/,
    story: /NaN|undefined|null|Infinity|コマ|秒|びょう|足場|ブロック|Ω|mA|星|論点|minecraft/
  };
  ['stop', 'ath', 'story'].forEach(function (th) {
    var T0 = MD.theme(th), p = T0.params[0], q = T0.params[1];
    T0.variants.forEach(function (va) {
      for (var a = p.min; a <= p.max; a++) for (var b = q.min; b <= q.max; b++) {
        var v = {}; v[p.key] = a; v[q.key] = b;
        var st = adSt(th, va, v), svg = MD.art(st);
        var txt = [MD.result(st, 'js'), MD.result(st, 'es'), MD.code(st), MD.desc(st, 'js'), MD.desc(st, 'es'), svg.replace(/<[^>]*>/g, ' ')].join(' | ');
        if (WRONG[th].test(txt)) bad.push(th + '.' + va + ' ' + JSON.stringify(v) + ': ' + txt.slice(0, 100));
        if (/NaN|undefined|Infinity/.test(svg)) bad.push(th + '.' + va + ' ' + JSON.stringify(v) + ' svg');
        if (!/^<svg/.test(svg)) bad.push(th + '.' + va + ' 線画が無い');
        [p.key, q.key].forEach(function (k) {
          var from = v[k] > MD.param(th, k).min ? v[k] - 1 : v[k] + 1, r = [MD.testReply(st, k, from, 'js'), MD.testReply(st, k, from, 'es')].join(' | ');
          if (/NaN|undefined|\{|\}|電球|星の|ブロックが/.test(r)) bad.push(th + ' reply ' + k + ': ' + r);
        });
      }
    });
  });
  eq(bad, [], 'AD-1 別の題材の語・NaN が 0 件');
  ok(MD.art(adSt('stop', 'walk', { frames: 2, fps: 1 })) !== MD.art({ kind: 'sample', theme: 'mc', variant: 'cube', values: { size: 4, block: 0 } }), 'AD-1 stop はマイクラの図に落ちない');
});
t('AD-1 試した時の返事（verbatim の語だけ差し替え）', function () {
  eq(MD.testReply(adSt('stop', 'walk', { frames: 3, fps: 1 }), 'frames', 2, 'es'), 'コマの数をかえたら、さっきより動画が長くなったね。変えたところが長さに出たね', 'AD-1 stop frames 増');
  eq(MD.testReply(adSt('stop', 'walk', { frames: 1, fps: 1 }), 'frames', 2, 'js'), '選んだコマの数に変えて、動画の長さに違いが出たね。狙っていた長さに近い？', 'AD-1 stop frames js');
  eq(MD.testReply(adSt('stop', 'walk', { frames: 2, fps: 0 }), 'fps', 1, 'es'), '1 びょうのコマ数をかえたら、さっきよりカクカク動いたね。変えたところがなめらかさに出たね', 'AD-1 stop fps 減');
  eq(MD.testReply(adSt('stop', 'walk', { frames: 2, fps: 2 }), 'fps', 1, 'es'), '1 びょうのコマ数をかえたら、さっきよりなめらかに動いたね。変えたところがなめらかさに出たね', 'AD-1 stop fps 増');
  eq(MD.testReply(adSt('ath', 'jump', { gap: 3, count: 5 }), 'gap', 2, 'es'), '足場のあいだをかえたら、さっきより足場がはなれたね。変えたところが距離に出たね', 'AD-1 ath gap 増');
  eq(MD.testReply(adSt('ath', 'jump', { gap: 2, count: 4 }), 'count', 5, 'es'), '足場の数をかえたら、さっきよりコースがみじかくなったね。変えたところが長さに出たね', 'AD-1 ath count 減');
  eq(MD.testReply(adSt('ath', 'jump', { gap: 1, count: 5 }), 'gap', 2, 'js'), '選んだ足場のあいだに変えて、とぶ距離に違いが出たね。狙っていた距離に近い？', 'AD-1 ath gap js');
  eq(MD.testReply(adSt('story', 'short', { scenes: 5, voice: 0 }), 'scenes', 4, 'es'), '場めんの数をかえたら、さっきより場面がふえたね。変えたところが長さに出たね', 'AD-1 story scenes 増');
  eq(MD.testReply(adSt('story', 'short', { scenes: 4, voice: 1 }), 'voice', 0, 'es'), 'かたり手をかえたら、さっきより外から見わたせるようになったね。変えたところが語り方に出たね', 'AD-1 story voice → 外から');
  eq(MD.testReply(adSt('story', 'short', { scenes: 4, voice: 0 }), 'voice', 2, 'es'), 'かたり手をかえたら、さっきより「わたし」の気持ちが近くなったね。変えたところが語り方に出たね', 'AD-1 story voice → わたし');
  eq(MD.testReply(adSt('story', 'short', { scenes: 4, voice: 2 }), 'voice', 0, 'es'), 'かたり手をかえたら、さっきより手紙を読んでいる感じになったね。変えたところが語り方に出たね', 'AD-1 story voice → 手紙');
});
t('AD-1 3 題材の作業台の操作（見本から・試す・任せる・外の記録・写真）', function () {
  ['stop', 'ath', 'story'].forEach(function (th) {
    var a = M.fromSample(th, { id: 'ads-' + th, now: '10:20', mode: 'js' }), T0 = MD.theme(th);
    eq([a.theme, a.stage.variant, a.title], [th, T0.sample, MD.pick(MD.variant(th, T0.sample).title, 'js')], 'AD-1 ' + th + ' 見本から');
    eq(a.steps, MD.stepsFor(th, T0.sample), 'AD-1 ' + th + ' 手順は stepBase');
    var p = T0.params[0], to = a.stage.values[p.key] + 1 > p.max ? p.min : a.stage.values[p.key] + 1;
    var r = M.test(M.setParam(a, p.key, to));
    eq(r.change.what.v.value, [MD.valueLabel(th, p.key, to, 'js'), MD.valueLabel(th, p.key, to, 'es')], 'AD-1 ' + th + ' 試すの記録は値の名前');
    var l = settled(r.act, 'find');
    eq([l.act.shelf[0].kind, l.act.shelf[0].theme], ['value', th], 'AD-1 ' + th + ' 任せる（find）');
    var x = M.fromSample(th, { id: 'adx-' + th, now: '10:20' }); x.stage = null; x.ext = { link: null, photos: [], visible: [] };
    eq(M.leaveOptions(x), ['calc', 'steps', 'cmd'], 'AD-1 ' + th + ' 外の記録の候補');
    var c = settled(x, 'calc').act.shelf[0], s2 = settled(x, 'steps').act.shelf[0], cm = settled(x, 'cmd').act.shelf[0];
    eq([c.kind, c.lines.length, s2.lines.length, cm.theme, cm.variant], ['note', 3, 3, th, MD.extCards[th].cmd.variant], 'AD-1 ' + th + ' extCards');
    eq(MD.pick(M.remake(settled(x, 'calc').act, c.id, 'calc').act.shelf[0].title, 'js'), MD.pick(MD.extCards[th].calc.alt.title, 'js'), 'AD-1 ' + th + ' calc の作り直しは alt');
    var ph = MD.photoArt({ theme: th, n: 1 });
    ok(ph.indexOf('is-photo') >= 0 && ph !== MD.photoArt({ theme: 'mc', n: 1 }), 'AD-1 ' + th + ' photoArt はマイクラの写真に落ちない');
  });
  eq(MD.extCards.stop.calc.lines[0][0], '12 コマ ÷ 1 秒に 6 コマ = 2 秒', 'AD-1 extCards.stop verbatim');
  eq(MD.extCards.ath.steps.alt.lines[1][0], '2. 2 個目ごとにスライムブロックを置く', 'AD-1 extCards.ath verbatim');
  eq(MD.extCards.story.calc.alt.lines[1][0], '1 場面 200 字なら、全部で 1200 字', 'AD-1 extCards.story verbatim');
});
t('AD-3 M.samplePage（3 枚ずつ・一巡で最初・予定表の題材を先頭に）', function () {
  function ids(list) { return list.map(function (s) { return s.id; }); }
  eq(ids(M.samplePage(MD.samples, 0, null)), ['stop', 'ath', 'story'], 'AD-3 1 組目');
  eq(ids(M.samplePage(MD.samples, 1, null)), ['mc', 'py', 'circuit'], 'AD-3 2 組目');
  eq(ids(M.samplePage(MD.samples, 2, null)), ['stop', 'ath', 'story'], 'AD-3 最後の次は最初');
  eq(ids(M.samplePage(MD.samples, -1, null)), ['mc', 'py', 'circuit'], 'AD-3 負の位置も組に収める（境界）');
  eq(ids(M.samplePage(MD.samples, 'x', null)), ['stop', 'ath', 'story'], 'AD-3 形の違う位置は 1 組目（境界）');
  eq(ids(M.samplePage(MD.samples, 0, 'py')), ['py', 'mc', 'circuit'], 'AD-3 予定表の題材（py）の組・先頭');
  eq(ids(M.samplePage(MD.samples, 1, 'stop')), ['stop', 'ath', 'story'], 'AD-3 予定表の題材（stop）の組');
  eq(ids(M.samplePage(MD.samples, 0, 'circuit')), ['circuit', 'mc', 'py'], 'AD-3 予定表の題材（circuit）が先頭');
  eq(ids(M.samplePage(MD.samples, 1, 'tool')), ['mc', 'py', 'circuit'], 'AD-3 見本に無い題材なら今の組（境界）');
  eq(M.samplePage([], 0, null), [], 'AD-3 見本 0 件（境界）');
});
t('AD-4 M.projectPage / 提案 12 件の必須項目', function () {
  eq(MD.projects.length, 12, 'AD-4 提案 12 件');
  eq(M.projectPage(MD.projects, 0).map(function (p) { return p.id; }), ['pj-stop-moon', 'pj-mc-ath', 'pj-novel-3', 'pj-trailer'], 'AD-4 1 組目');
  eq(M.projectPage(MD.projects, 2).map(function (p) { return p.id; }), ['pj-stamp', 'pj-manga', 'pj-sugoroku', 'pj-tokusatsu'], 'AD-4 3 組目');
  eq(M.projectPage(MD.projects, 3), M.projectPage(MD.projects, 0), 'AD-4 一巡で最初へ');
  var ctx = { window: {} }; vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app-v3/js/data.js'), 'utf8').replace(/^window\.DES = /m, 'var DES = window.DES = '), ctx);
  var cats = {}, items = {};
  ctx.window.DES.data.catalog.forEach(function (c) { cats[c.id] = true; c.items.forEach(function (it) { items[it.id] = c.id; }); });
  var bad = [], seen = {};
  function pair(v) { return Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && v[0] && typeof v[1] === 'string' && v[1]; }
  MD.projects.forEach(function (p) {
    var e = [];
    if (!/^pj-[a-z0-9-]+$/.test(p.id) || seen[p.id]) e.push('id'); seen[p.id] = true;
    if (!(cats[p.cat] || p.cat === 'writing') || MD.CATS.indexOf(p.cat) < 0) e.push('cat');
    if (['line', 'photo', 'illust'].indexOf(p.style) < 0) e.push('style');
    if (typeof p.safety !== 'boolean') e.push('safety');
    ['title', 'what', 'first', 'need'].forEach(function (k) { if (!pair(p[k])) e.push(k); });
    if (typeof p.min !== 'number' || p.min <= 0) e.push('min');
    if (!Array.isArray(p.steps) || p.steps.length !== 4 || !p.steps.every(pair)) e.push('steps');
    if (p.catalogId !== null && items[p.catalogId] !== p.cat) e.push('catalogId');
    if (e.length) bad.push(p.id + ': ' + e.join(','));
  });
  eq(bad, [], 'AD-4 必須項目がそろっている（catalogId は同じカテゴリの catalog の項目か null）');
  eq(MD.projects.filter(function (p) { return p.style !== 'line'; }).length, 10, 'AD-5 photo・illust は 10 枚');
  eq(MD.projects.filter(function (p) { return p.safety; }).map(function (p) { return p.id; }), ['pj-stop-moon', 'pj-marble'], 'AD-4 safety は 2 件');
  eq(MD.pick(MD.projects[0].title, 'js'), '月の満ち欠けをコマ撮りで 10 秒に', 'AD-4 題 verbatim');
  eq(MD.pick(MD.projects[6].need, 'js'), 'ダンボール · テープ · ビー玉 · カッター', 'AD-4 必要な物 verbatim');
  var txt = JSON.stringify(MD.projects);
  ok(!/版|点数|ランキング|順位|評価|成績|レベル|成長|頑張|すごい/.test(txt), 'AD-4 評価語・「版」が無い');
  MD.CATS.forEach(function (c) { ok(/^<svg/.test(MD.catArt(c)) && MD.catArt(c).indexOf(ORANGE_HEX) >= 0, 'AD-5 カテゴリの線画 ' + c + '（強調の橙あり）'); });
  eq(new Set(MD.CATS.map(MD.catArt)).size, 7, 'AD-5 7 種は別々の絵');
});
t('AD-4 M.fromProject（外で作る活動・2 回目は同じ id・任せる・写真）', function () {
  var p = MD.project('pj-marble'), r = M.fromProject(p, { id: 'pj1', mode: 'js', now: '10:20', acts: [] }), a = r.act;
  eq([r.created, a.id, a.origin, a.projectId, a.theme, a.stepsKind, a.title, a.catalogId], [true, 'pj1', 'project', 'pj-marble', 'project', 'ext', 'ダンボールのビー玉コースター', 'craft-cardboard'], 'AD-4 活動の形');
  eq(a.steps, p.steps, 'AD-4 手順は提案の steps');
  eq(a.stage, null, 'AD-4 作業対象は外の記録（見本を出さない）');
  var r2 = M.fromProject(p, { id: 'pj2', mode: 'js', now: '10:20', acts: [{ id: 'x' }, a] });
  eq([r2.created, r2.id], [false, 'pj1'], 'AD-4 同じ提案の 2 回目は同じ活動');
  eq(M.fromProject(MD.project('pj-manga'), { id: 'pj3', acts: [a] }).created, true, 'AD-4 別の提案は別の活動');
  eq(M.fromProject(null, {}), null, 'AD-4 提案が無ければ null（境界）');
  eq(M.fromProject(p, { id: 'pj4', mode: 'es', acts: [] }).act.title, 'ダンボールのビーだまコースター', 'AD-4 題 小');
  eq(M.leaveOptions(a), ['osteps', 'oneed'], 'AD-4 任せる候補（手順 / 必要な物）');
  var n1 = settled(a, 'osteps').act.shelf[0], n2 = settled(a, 'oneed').act.shelf[0];
  eq([n1.kind, n1.theme, n1.lines.map(function (l) { return l[0]; })], ['note', 'project', ['1. 坂を 1 本作る', '2. 曲がり角を足す', '3. 落ちないようにへりを付ける', '4. 最後まで転がるか試す']], 'AD-4 手順のメモは提案の手順');
  eq(n2.lines.map(function (l) { return l[0]; }), ['ダンボール', 'テープ', 'ビー玉', 'カッター', '目安 60 分くらい'], 'AD-4 必要な物のメモ');
  eq(MD.pick(M.remake(settled(a, 'osteps').act, n1.id, 'osteps').act.shelf[0].title, 'js'), '作り方の手順（最初の一歩から）', 'AD-4 作り直しはもう一方の形');
  eq(M.requestOpt(a), 'osteps', 'AD-4 言葉で頼む → 手順');
  var ph = M.addPhoto(a, 'photo');
  eq([ph.photo.theme, ph.photo.cat], ['project', 'craft'], 'AD-4 写真はカテゴリを持つ');
  var art = MD.photoArt(ph.photo);
  ok(art.indexOf('is-photo') >= 0 && art !== MD.photoArt({ theme: 'mc', n: 0 }) && art.indexOf(MD.catArt('craft').replace(/<\/svg>$/, '').slice(-40)) >= 0, 'AD-4 写真のダミーは提案のカテゴリの線画（マイクラに落とさない）');
  var sw = M.saveWork([], ph.act, { id: 'wpj' });
  eq([sw.work.theme, sw.work.art.photo.cat], ['project', 'craft'], 'AD-4 作品に残すと写真の絵');
  eq(M.migrate(a, function () { return ''; }) === a, true, 'AD-4 提案の活動は移行で変わらない');
});
t('AD-6 作品の見本 7 件（完成 4 + 試作 3）と、古い保存データへの 1 回だけの追加', function () {
  var acts = MD.seedActivities(), works = MD.seedWorks(acts);
  eq(acts.length, 3, 'AD-6 回 1 の見本の活動は変えない');
  eq(works.length, 4, 'AD-6 回 1 の見本の作品は変えない');
  var r = MD.addSeeds(acts, works, 0), W2 = W.group(r.works);
  eq([r.changed, r.works.length, W2.done.length, W2.trial.length], [true, 7, 4, 3], 'AD-6 見本の作品 7 件（完成 4 + 試作 3）');
  eq(r.activities.map(function (a) { return a.id; }), ['act-build', 'act-py', 'act-cap', 'act-stop', 'act-story', 'act-ath'], 'AD-6 活動は末尾に 3 件');
  eq(r.works.map(function (w) { return w.id; }), ['w-seed-ath', 'w-seed-stop', 'w-seed-story', 'w-seed-build', 'w-seed-circuit', 'w-seed-py', 'w-seed-py-trial'], 'AD-6 作品は回 1 の見本の前（日付の新しい順）');
  eq([acts.length, works.length], [3, 4], 'AD-6 元の配列は変えない');
  function byId(list, id) { return list.filter(function (x) { return x.id === id; })[0]; }
  var ws = byId(r.works, 'w-seed-stop'), wt = byId(r.works, 'w-seed-story'), wa = byId(r.works, 'w-seed-ath');
  eq([ws.title, ws.status, ws.date, ws.like, ws.craft], ['人形が歩く 18 コマの動画', 'done', '11/4', 'コマを 18 にしたら、歩き方がなめらかになったところ', '1 秒に 8 コマだと速すぎたので、6 コマに戻した'], 'AD-6 w-seed-stop');
  eq([wt.title, wt.status, wt.date, wt.like, wt.craft], ['雨の日の図書室（4 場面）', 'done', '11/3', '3 場面目で、なくした本が見つかるところ', '「わたし」が語る形にしたら、気持ちを書きやすくなった'], 'AD-6 w-seed-story');
  eq([wa.title, wa.status, wa.date, wa.like, wa.craft], ['スライムで跳ねるコース（足場 6 個）', 'trial', '11/5', null, null], 'AD-6 w-seed-ath');
  var as = byId(r.activities, 'act-stop'), at = byId(r.activities, 'act-story'), aa = byId(r.activities, 'act-ath');
  eq(as.changes.map(function (c) { return c.what.v.value[0]; }), ['18 コマ', '1 秒に 8 コマ', '1 秒に 6 コマ'], 'AD-6 act-stop 変化 3 つ（12→18 / 6→8 / 6 に戻す）');
  eq(at.changes.map(function (c) { return c.what.v.value[0]; }), ['外から語る', '「わたし」が語る'], 'AD-6 act-story 変化 2 つ');
  eq([aa.changes.length, aa.base.variant, aa.changes[0].what.v.value[0]], [1, 'slime', '6'], 'AD-6 act-ath（ath.slime。足場の数 5→6）');
  eq(r.activities.slice(3).map(function (a) { return [a.origin, a.state, a.sampleId]; }), [['sample', 'closed', 'stop'], ['sample', 'closed', 'story'], ['sample', 'closed', 'ath']], 'AD-6 見本から始めた活動・ここで一区切り');
  var people = {};
  r.activities.forEach(function (a) { a.changes.forEach(function (c) { if (c.with) people[c.with] = true; }); });
  eq(Object.keys(people), ['田中さん'], 'AD-6 人名は既存の田中さんだけ');
  r.works.slice(0, 3).forEach(function (w) {
    var a = byId(r.activities, w.actId), ch = a.changes.filter(function (c) { return c.id === w.at; })[0];
    eq(w.roles, M.roles(a, w.at), 'AD-6 ' + w.id + ' の関わりは roles と同じ');
    eq(w.snap, M.chState(a, ch), 'AD-6 ' + w.id + ' の状態は chState と同じ');
    eq(w.art, M.saveWork([], a, { id: 'x', at: w.at }).work.art, 'AD-6 ' + w.id + ' の絵は saveWork と同じ');
    eq(M.migrateWork(w, r.activities), w, 'AD-6 ' + w.id + ' は移行で変わらない');
  });
  eq(r.activities.map(function (a) { return M.migrate(a, function () { return ''; }) === a; }).every(Boolean), true, 'AD-6 見本の活動は v:3 のまま');
  eq(W.normalize(r.works), r.works, 'AD-6 見本は補う欄が無い');
  ok(W.storyFrames(as, ws).length - 1 === 3, 'AD-6 act-stop の作品は変化 3 つが見える');
  // 1 回だけ: 番号が新しければ足さない / 本人が外した見本はまた足さない / 既にある見本は二重に足さない
  var again = MD.addSeeds(r.activities, r.works, MD.SEED_V);
  eq([again.changed, again.works.length], [false, 7], 'AD-6 番号が新しければ足さない');
  var removed = r.works.filter(function (w) { return w.id !== 'w-seed-stop'; });
  eq(MD.addSeeds(r.activities, removed, MD.SEED_V).works.map(function (w) { return w.id; }).indexOf('w-seed-stop'), -1, 'AD-6 外した見本はまた足さない');
  var dup = MD.addSeeds(r.activities, r.works, 1);
  eq([dup.changed, dup.activities.length, dup.works.length], [false, 6, 7], 'AD-6 古い番号でも、ある見本は二重に足さない（境界）');
  var mine = [{ id: 'w-own', title: '自分の作品' }];
  eq(MD.addSeeds(acts, mine, 0).works.map(function (w) { return w.id; }), ['w-own', 'w-seed-ath', 'w-seed-stop', 'w-seed-story'], 'AD-6 回 1 の見本が無ければ末尾に足す（既存の作品はそのまま）');
  var t2 = JSON.stringify(r.activities.slice(3)) + JSON.stringify(r.works.slice(0, 3));
  ok(!/版|点数|ランキング|順位|評価|成績|レベル|集中力|得意|苦手|上手|成長|頑張|すごい/.test(t2), 'AD-6 見本に「版」と評価の語が無い');
});
t('AD-3 i18n: only_samples は消して参照も残さない / §AD の文言は [中, 小]', function () {
  var i18n = fs.readFileSync(path.join(__dirname, '../app-v3/js/i18n.js'), 'utf8'), src = fs.readFileSync(path.join(__dirname, '../app-v3/js/make.js'), 'utf8');
  ok(i18n.indexOf('only_samples') < 0 && src.indexOf('only_samples') < 0, 'AD-3 only_samples が無い');
  ok(/\/\/ ---- §AD ----/.test(i18n), 'AD i18n は §AD の塊');
  var need = ['origin_project', 'samples_swapped', 'pj_h', 'pj_sub', 'pj_more', 'pj_swapped', 'pj_first', 'pj_need', 'pj_safety', 'pj_start', 'pj_placed', 'pj_ai_image']
    .concat(MD.CATS.map(function (c) { return 'pj_cat_' + c; }));
  var miss = need.filter(function (k) { return !new RegExp('\\n\\s*' + k + ": \\['[^']+', '[^']+'\\]").test(i18n); });
  eq(miss, [], 'AD i18n の key がそろっている（[中, 小]）');
  ok(/pj_h: \['こんなのも作れる'/.test(i18n) && /pj_sub: \['いろいろな作り方の例。気になったら始めてみよう'/.test(i18n) && /pj_cat_writing: \['文章'/.test(i18n), 'AD-4 見出し・1 文・文章のチップは verbatim');
  ok(/pj_safety: \['サポーターと確認'/.test(i18n) && /pj_placed: \['作業台に置いたよ'/.test(i18n) && /samples_swapped: \['見本を入れ替えたよ'/.test(i18n), 'AD-3 / AD-4 文言 verbatim');
});

// ---------- レビューへの裁定（contract-app 末尾「直す（実装）」）----------
// 偽物の保存: failKey のキーだけ偽を返す。log に呼ばれた順、disk に保存できた値（JSON）を残す
function fakeStore(st, failKey) {
  var s = { log: [], disk: {} };
  s.save = function (k) { s.log.push(k); if (k === failKey || failKey === '*') return false; s.disk[k] = JSON.stringify(st[k]); return true; };
  return s;
}
function freeze(v) { return JSON.stringify(v); }
var MKSRC = fs.readFileSync(path.join(__dirname, '../app-v3/js/make.js'), 'utf8');
function handlerSrc(src, name) { var i = src.indexOf("A['" + name + "'] = function"); if (i < 0) return ''; var j = src.indexOf("\n  A['", i + 10); return src.slice(i, j < 0 ? i + 3000 : j); }
t('裁定 1 共通 M.trySave: 1 つでも保存できなければ全部のキーを前に戻し、保存できたキーは前の値で保存し直す', function () {
  var st = { activities: [{ id: 'x' }], works: [{ id: 'w' }], saveFailed: false }, fs1 = fakeStore(st, 'works');
  var r = M.trySave(st, ['activities', 'works'], function (s) { s.activities = [{ id: 'y' }].concat(s.activities); s.works = []; }, fs1.save);
  eq([r, st.activities.map(function (a) { return a.id; }), st.works.length, st.saveFailed], [false, ['x'], 1, true], '裁定 1 失敗したら前の状態・saveFailed');
  eq([fs1.log, JSON.parse(fs1.disk.activities).map(function (a) { return a.id; })], [['activities', 'works', 'activities'], ['x']], '裁定 1 先に保存できたキーは前の値で保存し直す');
  var st2 = { makeSide: { samplePage: 0 }, saveFailed: true }, fs2 = fakeStore(st2, null);
  eq([M.trySave(st2, ['makeSide'], function (s) { s.makeSide.samplePage = 1; }, fs2.save), st2.makeSide.samplePage, st2.saveFailed], [true, 1, true], '裁定 1 全部保存できたら書き換えたまま（saveFailed は呼ぶ側が決める）');
});
t('裁定 1 提案の「これで始める」: 保存できなければ活動を足さず、移動・トーストより前に止まる', function () {
  var p = MD.project('pj-marble'), st = { activities: MD.seedActivities(), saveFailed: false }, before = freeze(st.activities);
  var r = M.fromProject(p, { id: 'a-pj1', mode: 'js', now: '10:20', acts: st.activities });
  eq([M.addAct(st, r.act, fakeStore(st, 'activities').save), freeze(st.activities) === before, st.saveFailed], [false, true, true], '裁定 1 保存の失敗 → 活動は足さない');
  ok(M.addAct(st, r.act, fakeStore(st, null).save) && st.activities[0].id === 'a-pj1', '裁定 1 保存できたら先頭に足す');
  var h = handlerSrc(MKSRC, 'mk-project'), ia = h.indexOf('if (!addAct('), ig = h.indexOf("go('#make/"), it = h.indexOf("T('pj_placed')"), ifl = h.indexOf('saveFailUi(');
  ok(ia > 0 && ia < ifl && ifl < ig && ifl < it && h.indexOf('S().activities = [r.act]') < 0, '裁定 1 mk-project は保存の結果を見てから移動・トースト');
});
t('裁定 1 見本・提案の入れ替え: 保存できなければ組の位置を変えない（入れ替えない）', function () {
  var st = { makeSide: { samplePage: 1, projectPage: 2 }, saveFailed: false };
  eq([M.swapPage(st, 'samples', 1, fakeStore(st, 'makeSide').save), st.makeSide.samplePage, st.saveFailed], [false, 1, true], '裁定 1 見本: 失敗 → 前の組');
  eq([M.swapPage(st, 'projects', 2, fakeStore(st, 'makeSide').save), st.makeSide.projectPage], [false, 2], '裁定 1 提案: 失敗 → 前の組');
  eq([M.swapPage(st, 'samples', 1, fakeStore(st, null).save), st.makeSide.samplePage], [true, 0], '裁定 1 見本: 最後の組の次は最初');
  eq([M.swapPage(st, 'projects', 2, fakeStore(st, null).save), st.makeSide.projectPage], [true, 0], '裁定 1 提案: 12 件 = 3 組の次は最初');
  var src = MKSRC.slice(MKSRC.indexOf('function swapGroup'), MKSRC.indexOf("A['mk-more-samples']"));
  ok(src.indexOf('swapPage(') > 0 && src.indexOf('swapPage(') < src.indexOf("classList.add('is-fading')") && src.indexOf("DES.store.save('makeSide')") < 0, '裁定 1 swapGroup は先に保存し、失敗なら消える前に止まる');
});
t('裁定 2 見本の作品の追加（AD-6）: 活動・作品・番号の保存が全部できた時だけ番号を進める', function () {
  function old() { var acts = MD.seedActivities(); return { activities: acts, works: MD.seedWorks(acts), makeSide: { seedV: 0 }, saveFailed: false }; }
  var s1 = old(), f1 = fakeStore(s1, 'works');
  eq([M.applySeeds(s1, f1.save), s1.makeSide.seedV, s1.works.length, s1.activities.length, s1.saveFailed], [false, 0, 4, 3, true], '裁定 2 作品の保存の失敗 → 番号は 0 のまま・足した見本も戻す');
  ok(f1.log.indexOf('makeSide') < 0 && JSON.parse(f1.disk.activities).length === 3, '裁定 2 番号は保存しない・先に保存した活動は前の値で保存し直す');
  var s2 = old(), f2 = fakeStore(s2, 'makeSide');
  eq([M.applySeeds(s2, f2.save), s2.makeSide.seedV, s2.works.length, JSON.parse(f2.disk.works).length], [false, 0, 4, 4], '裁定 2 番号の保存の失敗 → 活動・作品も前の値に');
  var s3 = old(), f3 = fakeStore(s3, null);
  eq([M.applySeeds(s3, f3.save), s3.makeSide.seedV, s3.works.length, f3.log], [true, MD.SEED_V, 7, ['activities', 'works', 'makeSide']], '裁定 2 全部できたら番号を進める（番号は最後に保存）');
  var s4 = { activities: s3.activities, works: s3.works, makeSide: { seedV: 1 }, saveFailed: false }, f4 = fakeStore(s4, null);
  eq([M.applySeeds(s4, f4.save), s4.makeSide.seedV, f4.log], [true, MD.SEED_V, ['makeSide']], '裁定 2 足す物が無い時は番号だけ');
  ok(/applySeeds\(s,/.test(MKSRC) && !/s\.makeSide\.seedV = MD\.SEED_V;\s*\n\s*\(add\.changed/.test(MKSRC), '裁定 2 読み込みは applySeeds を使う');
});
t('裁定 3 あしあとの「もう一度試す」: 提案から作った活動の projectId と写真のカテゴリを引き継ぐ', function () {
  var p = MD.project('pj-marble'), a = M.fromProject(p, { id: 'a-pjt', mode: 'js', now: '10:20', acts: [] }).act;
  a = M.addPhoto(a, 'photo').act;
  var n = M.fromTrail(a, { id: 'a-pjt2', now: '10:40', mode: 'js', works: [] });
  eq([n.projectId, n.theme, n.origin, n.fromActId], ['pj-marble', 'project', 'trail', 'a-pjt'], '裁定 3 projectId・題材を引き継ぐ（新しい活動）');
  eq(M.addPhoto(n, 'photo').photo.cat, 'craft', '裁定 3 やり直した活動の写真は提案のカテゴリ');
  var lv = M.leave(n, 'oneed');
  eq(lv.ids.length, 1, '裁定 3 やり直した活動でも「必要な物をまとめて」が 1 枚作る');
});
t('裁定 10 3 題材の計算: 値が欠けている・範囲の外の時は題材の既定値（NaN・undefined・{F} を出さない）', function () {
  var bad = [{}, { frames: 99, fps: -1, gap: 0, count: 99, scenes: 1, voice: 9 }, { frames: 'x', fps: null, gap: 2.5, count: NaN, scenes: '4', voice: {} }];
  ['stop', 'ath', 'story'].forEach(function (th) {
    MD.theme(th).variants.forEach(function (vk) {
      var def = {}; MD.theme(th).params.forEach(function (p) { def[p.key] = p.def; });
      var good = { kind: 'sample', theme: th, variant: vk, values: def };
      bad.forEach(function (b, bi) {
        var st = { kind: 'sample', theme: th, variant: vk, values: b };
        var out = [MD.result(st, 'js'), MD.result(st, 'es'), MD.code(st), MD.desc(st, 'js'), MD.desc(st, 'es'), MD.art(st), MD.artMarks(st)];
        ok(!out.some(function (s) { return /NaN|undefined|\{[A-Za-z]+\}|Infinity/.test(String(s)); }), '裁定 10 ' + th + '.' + vk + ' 壊れた値 ' + bi + ' で NaN・undefined・{…} が出ない');
        eq([MD.result(st, 'js'), MD.code(st), MD.desc(st, 'js'), MD.artMarks(st)], [MD.result(good, 'js'), MD.code(good), MD.desc(good, 'js'), MD.artMarks(good)], '裁定 10 ' + th + '.' + vk + ' 壊れた値 ' + bi + ' は既定値で計算');
      });
    });
  });
});
t('裁定 11 gen-thumbs.mjs: エラーの時に出すのは決まった分類の文だけ', function () {
  var g = fs.readFileSync(path.join(__dirname, 'gen-thumbs.mjs'), 'utf8');
  var whys = g.match(/why:\s*[^,}]+/g) || [];
  ok(whys.length >= 3 && whys.every(function (w) { return /^why:\s*(WHY\.[a-z_]+|whyOf\(res\.status|timedOut \? WHY\.[a-z_]+ : WHY\.[a-z_]+)\s*$/.test(w); }), '裁定 11 why は決まった分類だけ（' + whys.join(' / ') + '）');
  var code = g.replace(/\/\/.*$/gm, '');
  ok(!/\+\s*\(?\s*e\s*&&\s*e\.name|\+\s*e\.name|\.message/.test(code) && /\(\) => \{ console\.error\('止まった: ' \+ WHY\.crashed\)/.test(code), '裁定 11 例外の名前・本文を出さない');
  ok(/const WHY = \{[^}]*\}/.test(code) && !/WHY = \{[^}]*\+/.test(code), '裁定 11 分類の文は定数だけ');
  ok(!/'status ' \+ res\.status \+ \(code/.test(g) && !/\+ code\b/.test(g), '裁定 11 API が返した code の文字列をそのまま出さない');
});

console.log('make-test: ' + pass + ' passed, ' + fail + ' failed');
console.log('MAKE_TEST=' + (fail === 0 ? 'PASS' : 'FAIL'));
process.exitCode = fail === 0 ? 0 : 1;
