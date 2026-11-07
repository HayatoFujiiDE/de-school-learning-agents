#!/usr/bin/env node
// 予定（L1）の純関数テスト（contract-LS §LS-11 / §LS-18）。DOM 無し。最後に LIVE_PLAN_TEST=PASS|FAIL
// rows の導出・空き（done も占有）・重なり・入れ替えの 2 行更新（1 commit）・提案カードの状態表。
// Codex の state.mjs（des.buddy-live.v1 の検査と操作）は写さず、隣の作業場から読み取りで import する（LIVE_INTEG で変えられる）。
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const P = require('../app/js/plan.js');

const ROOT = path.resolve(__dirname, '..');
const INTEG = process.env.LIVE_INTEG || (path.basename(path.dirname(ROOT)) === '.worktrees'
  ? path.join(path.dirname(ROOT), 'basic-learning-integration') : path.join(ROOT, '.worktrees', 'basic-learning-integration'));
const C = { open: '10:00', close: '15:30', lunch: ['12:30', '13:30'], circle: { today: 'tbd', minutes: 20 }, exercise: ['11:30', '12:30'] };
const CATALOG = [{ id: 'mc', label: 'マイクラ', items: [{ id: 'mc-build', title: '建築' }] }, { id: 'pg', label: 'プログラミング', items: [{ id: 'prog-python', title: 'ゲーム作り: Python' }] }];
const ALIASES = { 'mc-build': ['建築'], 'prog-python': ['ゲーム作り: Python', 'Python', 'パイソン'] };
const TODAY = '2026-11-08', OTHER = '2026-11-09';
let pass = 0, fail = 0;
function ok(cond, name) { if (cond) pass++; else { fail++; console.log('FAIL ' + name); } }
function eq(a, b, name) { ok(JSON.stringify(a) === JSON.stringify(b), name + ' => ' + JSON.stringify(a)); }
let n = 0;
function uid() { n++; return '00000000-0000-4000-8000-' + String(n).padStart(12, '0'); }
function ev(o) { return Object.assign({ id: uid(), title: '建築', date: TODAY, start: '10:00', end: '10:30', done: false }, o); }
function free(rows) { return P.freeSlots(rows, C).map(s => s.start + '-' + s.end); }
function derive(state, local) { return P.deriveRows({ classroom: C, today: TODAY, events: state.events, messages: state.messages, local: local || {}, catalog: CATALOG, aliases: ALIASES }); }

(async () => {
  let S = null;
  const mod = path.join(INTEG, 'app-live', 'state.mjs');
  if (fs.existsSync(mod)) S = await import(pathToFileURL(mod).href);
  ok(!!S, 'state.mjs を import できる（' + mod + '）');
  if (!S) { console.log('LIVE_PLAN_TEST=FAIL'); process.exit(1); }

  // ---------- 1. 空の状態: 教室の設定だけ ----------
  let st = S.emptyState();
  let rows = derive(st);
  eq(rows.map(r => r.id + ':' + r.kind), ['circle:event', 'exercise:optional', 'lunch:fixed'], '空: 行は サークル / 運動 / お昼 だけ');
  const circle = P.live(rows, C).find(r => r.id === 'circle');
  ok(circle.tbd === true && circle.start === '10:50' && circle.end === '11:10', '空: サークル tbd は 10:50〜11:10 で確認中');
  eq(free(rows), ['10:00-10:50', '11:10-11:30', '13:30-15:30'], '空: 空き = 10:00〜10:50 / 11:10〜11:30 / 13:30〜15:30');
  eq(P.deriveRows({ classroom: Object.assign({}, C, { circle: { today: 'none' } }), today: TODAY, events: [], messages: [], local: {} }).filter(r => P.live([r], Object.assign({}, C, { circle: { today: 'none' } })).length).map(r => r.id), ['exercise', 'lunch'], 'サークル none は出さない');

  // ---------- 2. 運動の 4 値（planLocal.optional[今日]）----------
  rows = derive(st, { optional: { [TODAY]: 'skip' } });
  eq(rows.find(r => r.id === 'exercise').choice, 'skip', '運動 skip を planLocal から');
  eq(free(rows), ['10:00-10:50', '11:10-12:30', '13:30-15:30'], '運動 skip で 11:30〜12:30 が空き');
  rows = derive(st, { optional: { [OTHER]: 'join', [TODAY]: 'bogus' } });
  eq(rows.find(r => r.id === 'exercise').choice, 'undecided', '他の日の選択・知らない値は undecided');

  // ---------- 3. mine / done / 他の日 / hidden / edited / deferred / activity ----------
  st = S.emptyState();
  const a = ev({ title: '建築', start: '10:00', end: '10:30' });
  const b = ev({ title: 'ゲーム作り: Python', start: '10:30', end: '10:50' });
  const d = ev({ title: '終わったこと', start: '13:30', end: '14:00', done: true });
  const o = ev({ title: '明日のこと', date: OTHER, start: '10:00', end: '11:00' });
  [a, b, d, o].forEach(e => S.addEvent(st, e));
  rows = derive(st, { hidden: [b.id], meta: { [a.id]: { edited: true, activity: 'mc-build' } }, deferred: [a.id] });
  const ra = rows.find(r => r.id === a.id), rb = rows.find(r => r.id === b.id), rd = rows.find(r => r.id === d.id);
  ok(!rows.find(r => r.id === o.id), '他の日の event は行にしない');
  ok(ra.kind === 'mine' && ra.edited && ra.overlapLater && ra.activity === 'mc-build' && ra.ev === st.events[0], 'mine: edited / deferred / activity / ev');
  ok(rb.hidden === true && rb.activity === 'prog-python', 'mine: hidden と 題名の別名照合で activity');
  ok(rd.done === true, 'done の event は done:true で残る');
  eq(free(rows), ['11:10-11:30', '14:00-15:30'], 'done の event も占有（LS-18 18-3）: 13:30〜14:00 は空きにならない');
  ok(P.occupies(rd), 'done の行は占有する');

  // ---------- 4. 入れ替えの相手（done・hidden は動かせない）----------
  st = S.emptyState();
  const p1 = ev({ title: '建築', start: '13:30', end: '14:00' });
  const p2 = ev({ title: 'レゴ', start: '14:00', end: '14:45' });
  const p3 = ev({ title: '終わった', start: '14:45', end: '15:00', done: true });
  const p4 = ev({ title: 'ポスター作り', start: '15:00', end: '15:30' });
  [p1, p2, p3, p4].forEach(e => S.addEvent(st, e));
  rows = derive(st);
  eq(P.partner(rows, C, p1.id, 'down'), p2.id, '相手: 隣の mine');
  eq(P.partner(rows, C, p2.id, 'down'), null, '相手: 間に done があれば動かせない');
  eq(P.partner(rows, C, p4.id, 'up'), null, '相手: done の行とは入れ替えない');
  eq(P.partner(rows, C, p3.id, 'up'), null, 'done の行そのものは動かせない');
  eq(P.canMove(rows, C, p1.id, 'down'), { partner: p2.id, fits: true }, 'canMove 下へ');

  // ---------- 5. 入れ替えの 2 行更新（1 commit・sameEvent・最終の重なり）----------
  const res = P.swap(rows, C, p1.id, p2.id);
  const r1 = res.rows.find(r => r.id === p1.id), r2 = res.rows.find(r => r.id === p2.id);
  eq([r2.start, r2.end, r1.start, r1.end], ['13:30', '14:15', '14:15', '14:45'], 'swap: 後ろの行が先頭から・長さ維持');
  const na = Object.assign({}, p1, { start: P.hh(r1.start), end: P.hh(r1.end) }), nb = Object.assign({}, p2, { start: P.hh(r2.start), end: P.hh(r2.end) });
  // updateEvent を 2 回呼ぶと間の状態で overlap になる（この方式が要る理由）
  let mid = JSON.parse(JSON.stringify(st)), midErr = null;
  try { S.updateEvent(mid, p1, na); } catch (e) { midErr = e.code; }
  eq(midErr, 'overlap', 'updateEvent 2 回だと 1 回目で overlap');
  let next = JSON.parse(JSON.stringify(st));
  P.applySwap(next, p1, p2, na, nb, S);
  ok(S.validState(Object.assign({}, next, { revision: next.revision + 1 })), 'applySwap 後の state は validState');
  eq([next.events[0].start, next.events[0].end, next.events[1].start, next.events[1].end], ['14:15', '14:45', '13:30', '14:15'], 'applySwap: 2 行を直接書く');
  // sameEvent が合わない（別の操作で変わった）→ conflict
  next = JSON.parse(JSON.stringify(st)); next.events[1].title = '別の操作';
  let err = null;
  try { P.applySwap(next, p1, p2, na, nb, S); } catch (e) { err = e.code; }
  eq(err, 'conflict', 'applySwap: 元と違えば conflict');
  // 最終の events に重なり（done の event と）→ overlap
  next = JSON.parse(JSON.stringify(st));
  err = null;
  try { P.applySwap(next, p1, p2, Object.assign({}, na, { start: '14:30', end: '14:50' }), nb, S); } catch (e) { err = e.code; }
  eq(err, 'overlap', 'applySwap: 最終の events が done と重なれば overlap');
  ok(P.noOverlap([{ date: TODAY, start: '10:00', end: '12:00' }, { date: TODAY, start: '10:30', end: '10:45' }, { date: TODAY, start: '11:00', end: '11:30' }], TODAY) === false, 'noOverlap: 包含も重なり');
  ok(P.noOverlap([{ date: TODAY, start: '10:00', end: '10:30' }, { date: TODAY, start: '10:30', end: '11:00' }, { date: OTHER, start: '10:00', end: '11:00' }], TODAY) === true, 'noOverlap: 接するだけ・別の日は重ならない');

  // ---------- 6. 時刻を直す・Codex の時刻の形 ----------
  eq(P.hh('9:05'), '09:05', 'hh: 2 桁にする');
  const st9 = S.emptyState(), e9 = ev({ start: '09:00', end: '09:30' });
  S.addEvent(st9, e9);
  const rows9 = derive(st9);
  eq(P.setTime(rows9, C, e9.id, '09:00', 30).changed, false, 'setTime: 09:00 と 9:00 は同じ（変更なし）');
  ok(P.startOptions(rows9.find(r => r.id === e9.id), C).indexOf('09:00') >= 0, 'startOptions: 今の値が刻みに無ければ足す');

  // ---------- 7. 提案（proposed / held / 他の日 / update・remove は行にしない）----------
  st = S.emptyState();
  const base = ev({ title: 'レゴ', start: '13:30', end: '14:00' });
  S.addEvent(st, base);
  const req = uid();
  S.beginSend(st, { requestId: req, messageId: uid(), date: TODAY, content: '予定に入れたい', now: Date.parse('2026-11-08T01:00:00Z') });
  const pa = { id: uid(), op: 'add', targetId: null, title: '建築', date: TODAY, start: '10:00', end: '10:30', original: null };
  const ph = { id: uid(), op: 'add', targetId: null, title: 'ゲーム作り: Python', date: TODAY, start: '14:00', end: '14:30', original: null };
  const po = { id: uid(), op: 'add', targetId: null, title: '明日の建築', date: OTHER, start: '10:00', end: '10:30', original: null };
  S.finishSend(st, { requestId: req, reply: 'テスト', proposals: [pa, ph, po] }, uid(), Date.parse('2026-11-08T01:00:01Z'));
  const req2 = uid();
  S.beginSend(st, { requestId: req2, messageId: uid(), date: TODAY, content: '変えて', now: Date.parse('2026-11-08T01:01:00Z') });
  const pu = { id: uid(), op: 'update', targetId: base.id, title: 'レゴ', date: TODAY, start: '14:30', end: '15:00', original: base };
  const pr = { id: uid(), op: 'remove', targetId: base.id, title: 'レゴ', date: TODAY, start: '13:30', end: '14:00', original: base };
  S.finishSend(st, { requestId: req2, reply: 'テスト 2', proposals: [pu, pr] }, uid(), Date.parse('2026-11-08T01:01:01Z'));
  rows = derive(st, { held: [ph.id] });
  const rpa = rows.find(r => r.id === pa.id), rph = rows.find(r => r.id === ph.id);
  ok(rpa && rpa.kind === 'proposed' && rpa.from === st.messages[1].id && rpa.activity === 'mc-build', 'add の pending → proposed 行（from = message id）');
  ok(rph && rph.kind === 'held', 'planLocal.held にあれば held');
  ok(!rows.find(r => r.id === po.id), '他の日の候補は行にしない');
  ok(!rows.find(r => r.id === pu.id) && !rows.find(r => r.id === pr.id), 'update / remove の候補は行にしない');
  eq(free(rows), ['10:30-10:50', '11:10-11:30', '14:00-15:30'], 'proposed は占有・held は占有しない');
  // 予定に入れる → 同じ id の mine
  const st2 = JSON.parse(JSON.stringify(st));
  S.decideProposal(st2, st2.messages[1].id, pa.id, true);
  const rows2 = derive(st2);
  ok(rows2.find(r => r.id === pa.id).kind === 'mine', '予定に入れる: 提案の id がそのまま event の id（行の id が続く）');

  // ---------- 8. カードの状態表 ----------
  const ctx = (events, held) => ({ events, held: held || [], today: TODAY });
  const P_ = (p, status) => Object.assign({}, p, { status });
  let cs = P.cardState(P_(pa, 'pending'), ctx(st.events));
  eq(cs.acts.map(x => x.label + ':' + x.action + (x.orange ? '!' : '')), ['add_to_plan:accept!', 'later:hold', 'decline:decline'], 'pending add: 予定に入れる / あとで / 違う');
  ok(cs.range === '10:00〜10:30' && cs.status === null && cs.date === null, 'pending add: 本文に時間帯・今日は日付なし');
  cs = P.cardState(P_(ph, 'pending'), ctx(st.events, [ph.id]));
  eq([cs.status, cs.acts.map(x => x.action)], [{ key: 'kind_held' }, ['accept', 'decline']], 'held: 保留 + 予定に入れる + 違う');
  cs = P.cardState(P_(pu, 'pending'), ctx(st.events));
  ok(cs.acts[0].label === 'pc_update' && cs.orig && cs.orig.range === '13:30〜14:00', 'pending update: この内容に変える + 元の予定');
  cs = P.cardState(P_(pr, 'pending'), ctx(st.events));
  ok(cs.acts[0].label === 'pc_remove', 'pending remove: 予定から外す');
  cs = P.cardState(P_(po, 'pending'), ctx(st.events));
  eq(cs.date, OTHER, '今日以外の候補はカードに日付');
  const moved = Object.assign({}, pa, { start: '10:15', end: '10:45', done: false, date: TODAY });
  const evA = { id: pa.id, title: pa.title, date: TODAY, start: '10:15', end: '10:45', done: false };
  cs = P.cardState(P_(pa, 'accepted'), ctx([evA]));
  eq([cs.status, cs.range], [{ key: 'in_plan', range: '10:15〜10:45' }, null], 'accepted add: 予定に入っている（event の今の時刻に追従）');
  cs = P.cardState(P_(pa, 'accepted'), ctx([Object.assign({}, evA, { done: true })]));
  eq(cs.status, { key: 'finished' }, 'accepted add + done: 終わった');
  cs = P.cardState(P_(pa, 'accepted'), ctx([]));
  eq(cs.status, { key: 'card_removed' }, 'accepted add + event 無し: 予定から外した');
  eq(P.cardState(P_(pu, 'accepted'), ctx([])).status, { key: 'pc_updated' }, 'accepted update: この内容にした');
  eq(P.cardState(P_(pr, 'accepted'), ctx([])).status, { key: 'card_removed' }, 'accepted remove: 予定から外した');
  eq(P.cardState(P_(pa, 'declined'), ctx([])), { date: null, range: '10:00〜10:30', status: { key: 'declined' }, acts: [], orig: null }, 'declined: 見送った・ボタンなし');
  ok(moved.start === '10:15', 'fixture');

  // ---------- 9. 重なり（done の行には帯を出さない・提案は文だけの対象）----------
  const ovRows = [
    { id: 'lunch', kind: 'fixed', title: 'お昼', start: '12:30', end: '13:30' },
    { id: 'x', kind: 'mine', title: '建築', start: '12:00', end: '12:45' },
    { id: 'y', kind: 'mine', title: '終わった', start: '12:45', end: '13:00', done: true },
    { id: 'z', kind: 'proposed', title: '候補', start: '13:15', end: '13:45' }
  ];
  const ov = P.overlaps(ovRows, C, null);
  ok(ov.some(x => x.id === 'x' && x.other === 'lunch' && x.canShorten), '重なり: mine × お昼 は mine に帯（短くする可）');
  ok(!ov.some(x => x.id === 'y'), '重なり: done の行には帯を出さない');
  ok(ov.some(x => x.id === 'z' && x.other === 'lunch'), '重なり: 提案 × お昼 は提案の行に（文だけ）');
  // 空きの最初の 1 つ（グリッドの入れる）・空き行の位置
  rows = derive(S.emptyState());
  const add = P.addMine(rows, C, { id: 'mc-build', title: '建築' }, { id: 'n1' });
  eq([add.row.start, add.row.end], ['10:00', '10:50'], 'addMine: 最初の空き・長さ min(空き,60)');
  const at = P.addMine(rows, C, { id: 'mc-build', title: '建築' }, { id: 'n2', at: '13:30' });
  eq([at.row.start, at.row.end], ['13:30', '14:30'], 'addMine: 空き行の位置');
  eq(P.keepTomorrow({ a: { tomorrow: false } }, 'b'), { a: { tomorrow: false }, b: { tomorrow: true } }, 'keepTomorrow: { tomorrow:true }');
  eq(P.weekdayOf('2026-11-08'), '日', 'weekdayOf');

  console.log('pass=' + pass + ' fail=' + fail);
  console.log('LIVE_PLAN_TEST=' + (fail === 0 ? 'PASS' : 'FAIL'));
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.log('ERROR ' + (e && e.stack || e)); console.log('LIVE_PLAN_TEST=FAIL'); process.exit(1); });
