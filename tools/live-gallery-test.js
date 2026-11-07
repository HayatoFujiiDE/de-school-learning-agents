/* 実サイト app/ の作品展示の純関数テスト（contract-LS §LS-13 / LS-18-15）。tools/gallery-test.js から見本に依存しない検査を移植 + 実サイトの約束。
   node tools/live-gallery-test.js → 最後に LIVE_GALLERY_TEST=PASS|FAIL */
'use strict';
var path = require('path');
var fs = require('fs');
var APP = path.join(__dirname, '..', 'app', 'js');
var GD = require(path.join(APP, 'gallery-data.js'));
var G = require(path.join(APP, 'gallery.js'));

var pass = 0, fail = 0;
function ok(cond, name) { if (cond) pass += 1; else { fail += 1; console.log('NG  ' + name); } }
function eq(a, b, name) { ok(JSON.stringify(a) === JSON.stringify(b), name + '  (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }
function freeze(v) { return JSON.stringify(v); }

// ---------- 見本のデータを持たない（LS-13） ----------
['items', 'reacts', 'notes', 'SEED_CALL', 'PREP_STEPS'].forEach(function (k) { ok(!(k in GD), 'GD に見本の ' + k + ' が無い'); });
['settle', 'call', 'answer', 'react', 'reactors', 'cancelCall', 'promiseCat', 'setPromiseAct'].forEach(function (k) { ok(!(k in G), 'G に見本・声かけ・約束の ' + k + ' が無い'); });
ok(GD.BAD_WORDS.length >= 12 && GD.BAD_WORDS.length <= 24, '番人の語の一覧は残す（' + GD.BAD_WORDS.length + '）');
GD.CATS.forEach(function (c) {
  var svg = GD.lineArt(c);
  ok(/^<svg [^>]*viewBox="0 0 240 150"/.test(svg) && /<\/svg>$/.test(svg), '種類の線画 ' + c);
});

// ---------- 状態と normalize ----------
var s0 = G.initial();
eq(Object.keys(s0).sort(), ['auto', 'mine', 'name', 'notes', 'v'], 'initial の形（反応・声かけ・届いた声かけ・約束・seeded を持たない）');
eq(G.normalize(null), s0, 'normalize null → 初期値');
eq(G.normalize('x'), s0, 'normalize 文字列 → 初期値');
eq(G.normalize([1]), s0, 'normalize 配列 → 初期値');
var raw = {
  v: 1, name: '  ほし  ', auto: true,
  mine: { w1: { state: 'in', at: '2026-11-08T01:20:00.000Z', time: '11/8 10:20' }, w2: { state: 'bad', time: 'x' }, w3: 'x', __proto__x: { state: 'in', time: 't' }, w4: { state: 'in', at: 'nope', time: 't' } },
  notes: [{ id: 'n1', itemId: 'my-w1', text: 'いいね', state: 'ok', time: 't' }, { id: 'n2', itemId: 'my-w1', text: '', state: 'ok', time: 't' }, { id: 'n1', itemId: 'my-w1', text: '重なり', state: 'ok', time: 't' }],
  reacts: { 'g-lamp': ['like'] }, calls: [{ id: 'c' }], inbox: [{ id: 'in-seed' }], promises: [{ id: 'p' }], seeded: true
};
var n = G.normalize(raw);
eq(n.name, 'ほし', 'normalize 呼び名は前後の空白を取る');
eq(n.auto, true, 'normalize auto');
eq(Object.keys(n.mine).sort(), ['__proto__x', 'w1'], 'normalize mine は形の合うものだけ（at が日時でないものは捨てる）');
eq(n.mine.w1, { state: 'in', at: '2026-11-08T01:20:00.000Z', time: '11/8 10:20' }, 'normalize mine の at を残す');
eq(n.notes.map(function (x) { return x.id; }), ['n1'], 'normalize notes は形の合うものだけ（空・重なりを捨てる）');
ok(!('reacts' in n) && !('calls' in n) && !('inbox' in n) && !('promises' in n) && !('seeded' in n), 'normalize 見本由来の項目を捨てる');
var poisoned = G.normalize(JSON.parse('{"mine":{"__proto__":{"state":"in","time":"t"}}}'));
eq(Object.keys(poisoned.mine), [], 'normalize __proto__ の鍵は捨てる');
ok(({}).state === undefined, 'normalize で Object の prototype を汚さない');

// ---------- 呼び名 ----------
eq(G.setName(s0, '  ほし  ').name, 'ほし', 'setName 前後の空白を取る');
eq(G.setName(s0, ''), s0, 'setName 空は変えない');
eq(G.setName(s0, 'あいうえおかきくけこさし').name, 'あいうえおかきくけこさし', 'setName 12 字は通る');
eq(G.setName(s0, 'あいうえおかきくけこさしす'), s0, 'setName 13 字は変えない');
eq(G.setName(s0, '🐸🐸🐸🐸🐸🐸🐸🐸🐸🐸🐸🐸').name, '🐸🐸🐸🐸🐸🐸🐸🐸🐸🐸🐸🐸', 'setName 絵文字は 1 字で数える');
var sn = G.setName(s0, 'ほし');
eq(freeze(s0), freeze(G.initial()), 'setName 元の state を変えない');

// ---------- 展示に並ぶもの（この端末の作品だけ。LS-18-15 = 「展示に出す」と自動切替） ----------
var PNG = 'data:image/jpeg;base64,' + 'QUJD'.repeat(10);
var works = [
  { id: 'wa', title: '完成の作品', status: 'done', theme: 'py', date: '11/1', atTime: '10:30', like: '好き', craft: null, roles: { own: 2, ai: 1 }, art: null, from: 'make' },
  { id: 'wb', title: '試作の作品', status: 'trial', theme: 'mc', date: '11/2', atTime: '10:00', like: null, craft: null, roles: { own: 1, ai: 0 }, art: null, from: 'make', shares: [{ to: 'class', time: 't' }] },
  { id: 'wc', title: '写真の作品', status: 'done', theme: 'circuit', date: '10/30', like: null, craft: '工夫', roles: { own: 1, ai: 0 }, art: null, from: 'capture', images: [{ data: PNG, w: 640, h: 480 }] }
];
eq(G.items(s0, works).length, 0, 'items 何も出していない時は 0 件（見本を足さない → 空状態）');
eq(G.items(s0, []).length, 0, 'items 作品が無ければ 0 件');
eq(G.items(s0, [works[1]]).length, 0, 'items 「見せる」（shares）だけでは並ばない（展示に出すとは別の操作。LS-18-15）');
var sp = G.put(sn, 'wb', '11/8 10:20', '2026-11-08T01:20:00.000Z');
eq(sp.mine.wb, { state: 'in', at: '2026-11-08T01:20:00.000Z', time: '11/8 10:20' }, 'put 記録（at + 表示の時刻）');
eq(G.put(sp, 'wb', 't'), sp, 'put もう出していれば同じ state');
eq(G.put(sp, '', 't'), sp, 'put 空の id は同じ state');
var ip = G.items(sp, works);
eq(ip.map(function (x) { return x.id; }), ['my-wb'], 'items 出した作品だけが 1 件並ぶ');
ok(ip[0].mine && ip[0].workId === 'wb' && ip[0].name === 'ほし' && ip[0].cat === 'minecraft', 'items 自分の作品は呼び名・種類つき');
eq(G.items(sp, works.filter(function (w) { return w.id !== 'wb'; })).length, 0, 'items 作品から消した作品は展示からも消える');
var sa = G.setAuto(sn, true);
eq(G.setAuto(sa, true), sa, 'setAuto 同じなら同じ state');
eq(G.items(sa, works).map(function (x) { return x.workId; }), ['wa'], 'items 自動が入なら完成の作品だけ（試作・写真から入れた作品は自動では出さない）');
var tk = G.take(sa, 'wa', 't', '2026-11-08T01:25:00.000Z');
ok(tk && tk.state.mine.wa.state === 'out', 'take 自動で並んでいる作品も out にする');
eq(G.items(tk.state, works).length, 0, 'items 外した作品は自動が入でも出さない');
eq(G.take(tk.state, 'wa', 't'), null, 'take もう外していれば null');
eq(G.restoreTake(tk.state, tk.undo).mine, {}, 'take の復元（前の記録が無ければ消す）');
var tk2 = G.take(sp, 'wb', 't');
eq(G.restoreTake(tk2.state, tk2.undo).mine.wb, sp.mine.wb, 'take の復元（前の記録に戻る）');
var both = G.put(G.put(sn, 'wa', '11/7 9:00', '2026-11-07T00:00:00.000Z'), 'wc', '11/8 9:00', '2026-11-08T00:00:00.000Z');
eq(G.items(both, works).map(function (x) { return x.workId; }), ['wc', 'wa'], 'items 新しい順（at で並べる）');
var wcItem = G.items(both, works).filter(function (x) { return x.workId === 'wc'; })[0];
ok(wcItem.photo === true && wcItem.cat === 'digital' && wcItem.craft === '工夫', 'items 写真から入れた作品の印・種類・工夫したところ');
eq(wcItem.img, { data: PNG, w: 640, h: 480 }, 'items 作品の本物の写真（images の 1 枚目）を絵に使う');
eq(G.firstImage({ images: [{ data: 'javascript:alert(1)', w: 1, h: 1 }] }), null, 'firstImage data:image の base64 以外は使わない');
eq(G.firstImage({ images: [{ data: 'data:image/jpeg;base64,AA"><script>', w: 1, h: 1 }] }), null, 'firstImage 属性を壊す文字は通さない');
ok(!('roles' in wcItem) && !('read' in wcItem), 'items 作ってきた流れ・見立ては出さない');
eq(G.catOf({ theme: 'zz' }), 'craft', 'catOf 知らない題材はものづくり');

// ---------- 絞り込み ----------
var list = G.items(both, works);
eq(G.cats(list), ['programming', 'digital'], 'cats 並んでいる種類（決まった順）');
eq(G.filter(list, 'digital').map(function (x) { return x.workId; }), ['wc'], 'filter 種類');
eq(G.filter(list, null).length, 2, 'filter null はすべて');

// ---------- 番人（§AG-4。そのまま） ----------
eq(G.guard('すてきな色だね'), 'ok', 'guard ふつうは ok');
eq(G.guard('なんかバカみたい'), 'hold', 'guard (a) 語の一覧');
eq(G.guard('1234567'), 'hold', 'guard (b) 7 けた');
eq(G.guard('見て http://example.com'), 'hold', 'guard (c) http');
eq(G.guard('LINE で話そう'), 'hold', 'guard (c) LINE');
eq(G.guard('🐸🐸🐸🐸🐸🐸🐸🐸'), 'hold', 'guard (d) 同じ文字 8 回');

// ---------- ひとこと（自分の作品へのメモ） ----------
var a1 = G.addNote(s0, { id: 'n1', itemId: 'my-wa', text: '  いい色だね  ', at: '2026-11-08T01:20:00.000Z', time: '11/8 10:20' });
eq(a1.notes, [{ id: 'n1', itemId: 'my-wa', text: 'いい色だね', state: 'ok', at: '2026-11-08T01:20:00.000Z', time: '11/8 10:20' }], 'addNote 前後の空白を取る・ok・at');
var long = new Array(100).join('あい');
var a2 = G.addNote(a1, { id: 'n2', itemId: 'my-wa', text: long, at: '2026-11-08T01:21:00.000Z', time: '11/8 10:21' });
eq(Array.from(a2.notes[1].text).length, 80, 'addNote 80 字で切る');
var a3 = G.addNote(a2, { id: 'n3', itemId: 'my-wa', text: 'LINE 教えて', at: '2026-11-08T01:22:00.000Z', time: '11/8 10:22' });
eq(a3.notes[2].state, 'hold', 'addNote 番人の結果を state に持つ');
eq(G.addNote(a3, { id: 'n4', itemId: 'my-wa', text: '   ', time: 't' }), a3, 'addNote 空は同じ state');
eq(G.thread(a3, 'my-wa').map(function (x) { return x.id; }), ['n1', 'n2'], 'thread 自分の ok だけ（hold はスレッドに出ない・見本は無い）');
var rm = G.removeNote(a3, 'n2');
eq(G.restoreNote(rm.state, rm.undo).notes.map(function (x) { return x.id; }), ['n1', 'n2', 'n3'], 'removeNote の復元（元の位置へ）');
eq(G.removeNote(a3, 'zz'), null, 'removeNote 無い id は null');
eq(G.canSend('a', null), true, 'canSend 下書きあり');
eq(G.canSend('a', { itemId: 'x' }), false, 'canSend 送信待ちの間は送れない');
eq(Array.from(G.fitNote(long)).length, 80, 'fitNote 80 字');

// ---------- ソースの約束 ----------
var src = fs.readFileSync(path.join(APP, 'gallery.js'), 'utf8');
ok(!/innerHTML/.test(src), 'gallery.js は innerHTML を使わない');
ok(!/GD\.(items|reacts|notes|SEED_CALL|PREP_STEPS)/.test(src), 'gallery.js は見本のデータを読まない');
ok(!/des3\./.test(src) && /DES\.store\.register\('gallery'/.test(src), 'gallery.js は des.live（register）で保存する（des3 を使わない）');
ok(!/DES\.data\.(today|now|supporter)/.test(src), 'gallery.js は時刻を DES.clock から（DES.data の固定値・サポーターの名前を使わない）');
ok(/gl_local_note: \['今はこの端末の作品だけが並ぶよ。教室のみんなの作品が並ぶ仕組みはこれから', 'いまはこの たんまつの作品だけがならぶよ。きょうしつのみんなの作品がならぶしくみはこれから'\]/.test(src), 'gl_local_note の文（verbatim）');
var i18n = fs.readFileSync(path.join(APP, 'i18n.js'), 'utf8');
var keys = (src.match(/T\('(gl_[a-z_]+|gallery|cancel|close|save_fail|undo_restore|like_point|craft_point|ai_proposal)'/g) || []).map(function (m) { return m.slice(3, -1); });
keys.filter(function (k, i) { return keys.indexOf(k) === i && !/_$/.test(k); }).forEach(function (k) { ok(i18n.indexOf(k + ':') >= 0 || src.indexOf(k + ':') >= 0, '文言 key がある ' + k); });
var BAN = /点数|ランキング|順位|評価|成績|レベル|データがありません|学びのバディ|モック|架空/;
ok(!BAN.test(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), 'gallery.js の画面の文字に禁止語が無い');

console.log('pass=' + pass + ' fail=' + fail);
console.log('LIVE_GALLERY_TEST=' + (fail === 0 ? 'PASS' : 'FAIL'));
process.exit(fail === 0 ? 0 : 1);
