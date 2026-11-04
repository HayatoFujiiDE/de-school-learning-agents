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

console.log('make-test: ' + pass + ' passed, ' + fail + ' failed');
console.log('MAKE_TEST=' + (fail === 0 ? 'PASS' : 'FAIL'));
process.exitCode = fail === 0 ? 0 : 1;
