#!/usr/bin/env node
// 話す（L1）の純関数テスト（contract-LS §LS-11 / §LS-18）。DOM 無し。最後に LIVE_TALK_TEST=PASS|FAIL
// 会話の結合（Codex の messages + talkLocal）と並び・日付区切り・talkLocal の形と上限・送れる条件。
'use strict';
const TK = require('../app/js/talk.js');
let pass = 0, fail = 0;
function ok(cond, name) { if (cond) pass++; else { fail++; console.log('FAIL ' + name); } }
function eq(a, b, name) { ok(JSON.stringify(a) === JSON.stringify(b), name + ' => ' + JSON.stringify(a)); }
let n = 0;
function uid() { n++; return '00000000-0000-4000-8000-' + String(n).padStart(12, '0'); }

// ---------- JST の日付・時刻 ----------
eq(TK.jst('2026-11-07T15:30:00.000Z'), { date: '2026-11-08', time: '00:30' }, 'jst: UTC 15:30 は JST の翌日 00:30');
eq(TK.jst('2026-11-08T01:05:00.000Z'), { date: '2026-11-08', time: '10:05' }, 'jst: 10:05');
eq(TK.jst('bad'), { date: '', time: '' }, 'jst: 読めない日時は空');

// ---------- Codex の message の投影（at = createdAt を写す。保存には足さない）----------
const u1 = { id: uid(), requestId: uid(), role: 'user', content: 'こんにちは', createdAt: '2026-11-07T14:00:00.000Z', delivery: 'answered' };
const b1 = { id: uid(), requestId: u1.requestId, role: 'assistant', content: '（テスト用の返事）', createdAt: '2026-11-07T14:00:02.000Z', proposals: [] };
const u2 = { id: uid(), requestId: uid(), role: 'user', content: '予定に入れたい', createdAt: '2026-11-08T01:00:00.000Z', delivery: 'failed', error: '今はバディに接続できません。' };
const v1 = TK.project(u1), v2 = TK.project(b1), v3 = TK.project(u2);
eq([v1.who, v1.at, v1.date, v1.time, v1.text, v1.by, v1.delivery], ['child', u1.createdAt, '2026-11-07', '23:00', 'こんにちは', null, 'answered'], 'project: user → child・at・JST の日付と時刻');
ok(v2.who === 'buddy' && Array.isArray(v2.proposals) && v2.delivery === undefined, 'project: assistant → buddy + proposals');
ok(v3.delivery === 'failed' && v3.error === '今はバディに接続できません。', 'project: failed と error');
ok(!('at' in u1) && Object.keys(u1).length === 6, 'project: Codex の message に項目を足さない');

// ---------- talkLocal の形（LS-18 18-1）と上限 ----------
const rec = TK.normalizeLocal({ who: 'record', text: '10:00 に「建築」を入れた', kind: 'rec_add', refs: { eventId: 'e1', activity: 'mc-build', proposalId: null } }, '2026-11-08T01:00:01.000Z', 'r1');
eq(rec, { id: 'r1', at: '2026-11-08T01:00:01.000Z', date: '2026-11-08', time: '10:00', who: 'record', kind: 'rec_add', refs: { eventId: 'e1', activity: 'mc-build' }, text: '10:00 に「建築」を入れた', by: null, idea: null }, 'normalizeLocal: 記録行の形（null の refs は落とす）');
const sup = TK.normalizeLocal({ who: 'supporter', text: 'いいね', by: 'たなか' }, '2026-11-08T01:00:03.000Z', 's1');
ok(sup.kind === 'voice' && sup.by === 'たなか' && sup.who === 'supporter', 'normalizeLocal: サポーターの発言は kind voice・by はその時の表示名');
ok(TK.normalizeLocal({ who: 'supporter', text: 'アイデア', idea: { id: 'i1' } }, '2026-11-08T01:00:04.000Z', 's2').kind === 'idea', 'normalizeLocal: idea 付きは kind idea');
ok(TK.normalizeLocal({ who: 'child', text: 'x' }, '2026-11-08T01:00:00.000Z', 'z').who === 'record', 'normalizeLocal: who は record / supporter だけ');
let list = [];
for (let i = 0; i < 405; i++) list = TK.pushLocalList(list, { id: 'k' + i, at: '2026-11-08T01:00:00.000Z', who: 'record', text: String(i) }, 400);
ok(list.length === 400 && list[0].id === 'k5' && list[399].id === 'k404', 'pushLocalList: 最大 400 件・古いものから落とす');

// ---------- 結合と並び・日付区切り ----------
const local = [
  rec,
  sup,
  { id: 'old', at: '2026-11-07T13:59:00.000Z', date: '2026-11-07', time: '22:59', who: 'record', text: '前の日の記録', kind: 'rec_goal', refs: {} },
  { id: 'same', at: '2026-11-08T01:00:00.000Z', who: 'record', text: '同じ時刻', kind: 'rec_hold', refs: {} },
  { id: 'broken', who: 'record', text: 'at が無い' }
];
const merged = TK.merge([u1, b1, u2], local);
eq(merged.map(m => m.id), ['old', u1.id, b1.id, u2.id, 'same', 'r1', 's1'], 'merge: 日時順・同じ時刻は Codex が先・at の無い要素は出さない');
ok(merged.every(m => typeof m.at === 'string' && m.who && typeof m.time === 'string' && typeof m.date === 'string' && 'by' in m), 'merge: 各要素に id / at / date / time / who / text / by（LS-18 18-27）');
const withDays = TK.withDays(merged);
eq(withDays.map(x => x.sep || x.msg.id), ['2026-11-07', 'old', u1.id, b1.id, '2026-11-08', u2.id, 'same', 'r1', 's1'], 'withDays: 最初と日付が変わる所に区切り');
eq(TK.withDays([]), [], 'withDays: 空は空');
eq(TK.merge([], []), [], 'merge: 空は空');

// ---------- 最後の本人発言・送れる条件 ----------
eq(TK.lastOwn([u1, b1, u2]), '予定に入れたい', 'lastOwn: 最後の role user');
eq(TK.lastOwn([b1]), null, 'lastOwn: 無ければ null');
const okState = { available: true, issue: null, pending: null, sending: null, api: { available: true }, count: 0, limit: 200 };
ok(TK.canSendState(okState) === true, 'canSend: 条件を満たす');
[['available', false], ['issue', 'storage'], ['pending', { requestId: 'x' }], ['sending', 'x'], ['api', { available: false }], ['count', 199]].forEach(([k, v]) => {
  ok(TK.canSendState(Object.assign({}, okState, { [k]: v })) === false, 'canSend: ' + k + ' があれば送れない');
});
ok(TK.canSendState(Object.assign({}, okState, { count: 198 })) === true, 'canSend: messages.length <= LIMITS.messages - 2 まで');

console.log('pass=' + pass + ' fail=' + fail);
console.log('LIVE_TALK_TEST=' + (fail === 0 ? 'PASS' : 'FAIL'));
process.exit(fail === 0 ? 0 : 1);
