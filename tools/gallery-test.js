/* 作品展示の純関数テスト（contract-app §AG-7）+ 見本データ（§AG-6）。node tools/gallery-test.js → 最後に GALLERY_TEST=PASS|FAIL */
'use strict';
var path = require('path');
var fs = require('fs');
var GD = require(path.join(__dirname, '../app-v3/js/gallery-data.js'));
var G = require(path.join(__dirname, '../app-v3/js/gallery.js'));
var M = require(path.join(__dirname, '../app-v3/js/make.js'));

var pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass += 1; } else { fail += 1; console.log('NG  ' + name); }
}
function eq(a, b, name) { ok(JSON.stringify(a) === JSON.stringify(b), name + '  (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }
function freeze(v) { return JSON.stringify(v); }

// ---------- 見本データ（§AG-6） ----------
var ids = GD.items.map(function (x) { return x.id; });
eq(ids, ['g-clay-walk', 'g-ice-course', 'g-rain-novel', 'g-lamp', 'g-4koma', 'g-coaster', 'g-stamp', 'g-coin-game'], 'AG-6 見本 8 件の id');
var want = {
  'g-clay-walk': ['そらまめ', 'media', '粘土のカエルが歩く動画', 'とぶ前に、少ししゃがむところ', 'ok', 'photo'],
  'g-ice-course': ['ペンギン号', 'minecraft', '氷ですべるアスレチック', '最後の足場だけ、わざと小さくしたところ', null, 'photo'],
  'g-rain-novel': ['もくもく', 'writing', '雨の音が聞こえる小説の表紙', '題の字を雨つぶの形にしたところ', 'later', 'illust'],
  'g-lamp': ['あおい星', 'digital', '暗くなるとつく机のあかり', '手をかざすと消えるところ', null, 'photo'],
  'g-4koma': ['ねこパンチ', 'drawing', 'ねこが寝ぼうする 4 コマ', '4 コマ目で、ねこがまだ寝ているところ', null, 'illust'],
  'g-coaster': ['そらまめ', 'craft', '3 回曲がるビー玉コースター', '最後にベルが鳴るところ', null, 'photo'],
  'g-stamp': ['ねこパンチ', 'drawing', '「あとでね」のスタンプ', '手をふる向きを左右で変えたところ', null, 'illust'],
  'g-coin-game': ['ペンギン号', 'programming', 'コインを集めるゲーム', 'コインが 10 枚で色が変わるところ', null, 'line']
};
GD.items.forEach(function (x) {
  eq([x.name, x.cat, x.title, x.like, x.answers || null, x.art], want[x.id], 'AG-6 ' + x.id + ' の中身が契約どおり');
  ok(GD.CATS.indexOf(x.cat) >= 0, 'AG-6 ' + x.id + ' の種類が 7 種のどれか');
  ok(G.timeKey(x.time) > 0, 'AG-6 ' + x.id + ' に展示の時刻');
  ok(!('grade' in x) && !('realName' in x) && !('face' in x), 'AG-6 ' + x.id + ' は呼び名だけ（学年・本当の名前・顔を持たない）');
});
eq(GD.reacts.length, 6, 'AG-6 見本の反応 6 件');
eq(GD.notes.length, 4, 'AG-6 見本のひとこと 4 件');
ok(GD.reacts.some(function (r) { return r.itemId === 'g-clay-walk' && r.kind === 'how' && r.name === 'ペンギン号'; }), 'AG-6 g-clay-walk に「どうやったの？」= ペンギン号');
ok(GD.notes.some(function (n) { return n.itemId === 'g-clay-walk' && n.name === 'あおい星' && n.text === 'しゃがむ所、何コマ使ったの？'; }), 'AG-6 ひとこと「しゃがむ所、何コマ使ったの？」= あおい星');
ok(GD.notes.some(function (n) { return n.itemId === 'g-clay-walk' && n.name === 'そらまめ' && n.text === '3 コマだよ'; }), 'AG-6 作者の返事「3 コマだよ」= そらまめ');
GD.reacts.concat(GD.notes).forEach(function (r) { ok(ids.indexOf(r.itemId) >= 0, 'AG-6 見本の反応・ひとことは見本の作品を指す ' + r.itemId); });
GD.notes.forEach(function (n) { eq(G.guard(n.text), 'ok', 'AG-6 見本のひとことは番人を通る ' + n.id); });
ok(GD.BAD_WORDS.length >= 12 && GD.BAD_WORDS.length <= 24, 'AG-4 番人の語の一覧は 15 語ほど（' + GD.BAD_WORDS.length + '）');
GD.CATS.forEach(function (c) {
  var svg = GD.lineArt(c);
  ok(/^<svg [^>]*viewBox="0 0 240 150"/.test(svg) && /<\/svg>$/.test(svg), 'AG-6 種類の線画 ' + c);
  ok(/#ed922c/.test(svg), 'AG-6 種類の線画は強調に橙 ' + c);
});
eq(GD.PREP_STEPS.map(function (s) { return s[0]; }), ['何を一緒に作るか話す', '分けてやる所を決める', '合わせて見る'], 'AG-5 先に準備するの手順（verbatim）');

// ---------- 状態（§AG-6 の形）と normalize ----------
var s0 = G.initial();
eq(s0, { v: 1, name: null, auto: false, mine: {}, reacts: {}, notes: [], calls: [], inbox: [], promises: [], seeded: false }, 'G.initial の形');
eq(G.normalize(null), s0, 'normalize null → 初期値');
eq(G.normalize('x'), s0, 'normalize 文字列 → 初期値');
eq(G.normalize([1]), s0, 'normalize 配列 → 初期値');
var raw = {
  v: 1, name: '  ほし  ', auto: true,
  mine: { w1: { state: 'in', time: '11/2 10:20' }, w2: { state: 'bad', time: 'x' }, w3: 'x' },
  reacts: { 'g-lamp': ['like', 'zz', 'like', 'try'], 'g-4koma': 'like', 'g-coaster': [] },
  notes: [{ id: 'n1', itemId: 'g-lamp', text: 'いいね', state: 'ok', time: 't' }, { id: 'n2', itemId: 'g-lamp', text: '', state: 'ok', time: 't' }, { id: 'n1', itemId: 'g-lamp', text: '重なり', state: 'ok', time: 't' }],
  calls: [{ id: 'c1', itemId: 'g-lamp', kind: 'teach', state: 'sent', time: 't' }, { id: 'c2', itemId: 'g-lamp', kind: 'together', state: 'sent', time: 't' }, { id: 'c3', itemId: 'g-x', kind: 'nope', state: 'sent', time: 't' }],
  inbox: [{ id: 'i1', workId: 'w1', from: 'そらまめ', kind: 'together', state: 'new', time: 't' }, { id: 'i2' }],
  promises: [{ id: 'p1', with: 'そらまめ', title: 'x', actId: null, time: 't' }, { id: 'p2', with: 'a', title: 'b', actId: 3, time: 't' }],
  seeded: true
};
var n = G.normalize(raw);
eq(n.name, 'ほし', 'normalize 呼び名は前後の空白を取る');
eq(n.auto, true, 'normalize auto');
eq(n.mine, { w1: { state: 'in', time: '11/2 10:20' } }, 'normalize mine は形の合うものだけ');
eq(n.reacts, { 'g-lamp': ['like', 'try'] }, 'normalize reacts は知っている種類だけ・重なりなし・空は消す');
eq(n.notes.map(function (x) { return x.id; }), ['n1'], 'normalize notes は形の合うものだけ（空・重なりを捨てる）');
eq(n.calls.map(function (x) { return x.id; }), ['c1'], 'normalize calls は同じ作品に 1 つまで・知らない種類は捨てる');
eq(n.inbox.map(function (x) { return x.id; }), ['i1'], 'normalize inbox は形の合うものだけ');
eq(n.promises.map(function (x) { return x.id; }), ['p1'], 'normalize promises は形の合うものだけ');
eq(n.seeded, true, 'normalize seeded');
var n2 = G.normalize({ name: 'あいうえおかきくけこさしす', auto: 'yes', mine: [], notes: {}, seeded: 1, calls: [{ id: 'c1', itemId: 'g-lamp', kind: 'teach', state: 'sent', time: 't' }] });
eq([n2.name, n2.auto, n2.mine, n2.notes, n2.seeded, n2.calls.length], [null, false, {}, [], false, 1], 'normalize 形が違う項目だけ初期値（他は残す）');

// ---------- 呼び名（§AG-2） ----------
eq(G.setName(s0, '  ほし  ').name, 'ほし', 'setName 前後の空白を取る');
eq(G.setName(s0, ''), s0, 'setName 空は変えない');
eq(G.setName(s0, '   '), s0, 'setName 空白だけは変えない');
eq(G.setName(s0, 'あいうえおかきくけこさし').name, 'あいうえおかきくけこさし', 'setName 12 字は通る');
eq(G.setName(s0, 'あいうえおかきくけこさしす'), s0, 'setName 13 字は変えない');
eq(G.setName(s0, '🐸🐸🐸🐸🐸🐸🐸🐸🐸🐸🐸🐸').name, '🐸🐸🐸🐸🐸🐸🐸🐸🐸🐸🐸🐸', 'setName 絵文字は 1 字で数える');
var sn = G.setName(s0, 'ほし');
eq(G.setName(sn, 'ほし'), sn, 'setName 同じ呼び名は同じ state');
eq(freeze(s0), freeze(G.initial()), 'setName 元の state を変えない');

// ---------- 展示に並ぶもの（§AG-2 / AG-3） ----------
var works = [
  { id: 'wa', title: '完成の作品', status: 'done', theme: 'py', date: '11/1', atTime: '10:30', like: '好き', craft: null, roles: { own: 2, ai: 1 }, art: null, from: 'make' },
  { id: 'wb', title: '試作の作品', status: 'trial', theme: 'mc', date: '11/2', atTime: '10:00', like: null, craft: null, roles: { own: 1, ai: 0 }, art: null, from: 'make' },
  { id: 'wc', title: '写真の作品', status: 'done', theme: 'circuit', date: '10/30', like: null, craft: '工夫', roles: { own: 1, ai: 0 }, art: null, from: 'capture' }
];
var base = G.items(s0, works, GD.items);
eq(base.length, 8, 'items 何も出していない時は見本 8 件');
eq(base.map(function (x) { return x.id; }), ids, 'items 見本は新しい順');
eq(G.items(s0, [], GD.items).filter(function (x) { return x.mine; }).length, 0, 'items 自分の作品なし');
var sp = G.put(sn, 'wb', '11/2 10:20');
eq(sp.mine.wb, { state: 'in', time: '11/2 10:20' }, 'put 記録');
eq(G.put(sp, 'wb', '11/2 10:21'), sp, 'put もう出していれば同じ state');
eq(G.put(sp, '', 't'), sp, 'put 空の id は同じ state');
var ip = G.items(sp, works, GD.items);
eq(ip.length, 9, 'items 試作も 1 つずつなら出せる');
eq(ip[0].id, 'my-wb', 'items 新しい順（今出したものが先頭）');
ok(ip[0].mine && ip[0].workId === 'wb' && ip[0].name === 'ほし' && ip[0].cat === 'minecraft', 'items 自分の作品は呼び名・種類つき');
eq(G.items(sp, works.filter(function (w) { return w.id !== 'wb'; }), GD.items).length, 8, 'items 作品から外した作品は展示からも消える');
// 自動（§AG-2 まとめて）
var sa = G.setAuto(sn, true);
eq(G.setAuto(sa, true), sa, 'setAuto 同じなら同じ state');
var ia = G.items(sa, works, GD.items).filter(function (x) { return x.mine; }).map(function (x) { return x.workId; });
eq(ia.sort(), ['wa'], 'items 自動が入なら完成の作品だけ（試作・写真から入れた作品は自動では出さない。§AG-2 改訂）');
var tk = G.take(sa, 'wa', '11/2 10:25');
ok(tk && tk.state.mine.wa.state === 'out', 'take 自動で並んでいる作品も out にする');
eq(G.items(tk.state, works, GD.items).filter(function (x) { return x.mine; }).map(function (x) { return x.workId; }), [], 'items 外した作品は自動が入でも出さない');
eq(G.take(tk.state, 'wa', 't'), null, 'take もう外していれば null');
eq(G.restoreTake(tk.state, tk.undo).mine, {}, 'take の復元（前の記録が無ければ消す）');
var tk2 = G.take(sp, 'wb', '11/2 10:30');
eq(G.restoreTake(tk2.state, tk2.undo).mine.wb, { state: 'in', time: '11/2 10:20' }, 'take の復元（前の記録に戻る）');
eq(G.items(tk2.state, works, GD.items).length, 8, 'take → 一覧から消える');
var sp2 = G.put(tk.state, 'wa', '11/2 10:40');
eq(G.items(sp2, works, GD.items).filter(function (x) { return x.mine; }).map(function (x) { return x.workId; }).sort(), ['wa'], 'put 外した作品を 1 つずつ出し直せる');
var wcItem = G.items(G.put(sa, 'wc', '11/2 10:45'), works, GD.items).filter(function (x) { return x.workId === 'wc'; })[0];
ok(wcItem.photo === true && wcItem.cat === 'digital' && wcItem.craft === '工夫', 'items 写真から入れた作品の印・種類・工夫したところ');
var waItem = G.items(sa, works, GD.items).filter(function (x) { return x.workId === 'wa'; })[0];
ok(waItem.buddy === true && wcItem.buddy === false, 'items バディが関わった作品だけ「バディと作った」');
ok(!('roles' in waItem) && !('read' in waItem) && !('snap' in waItem), 'items 作ってきた流れ・バディの見立ては出さない');
eq(G.catOf({ theme: 'zz' }), 'craft', 'catOf 知らない題材はものづくり');
eq(G.isIn(s0, null), false, 'isIn 作品が無ければ false');

// ---------- 絞り込み ----------
eq(G.cats(base), ['minecraft', 'programming', 'craft', 'digital', 'media', 'drawing', 'writing'], 'cats 並んでいる種類（決まった順）');
eq(G.filter(base, 'all').length, 8, 'filter すべて');
eq(G.filter(base, 'drawing').map(function (x) { return x.id; }), ['g-4koma', 'g-stamp'], 'filter 絵だけ');
eq(G.filter(base, 'nope').length, 0, 'filter 無い種類は 0');
eq(G.filter(base, null).length, 8, 'filter null はすべて');

// ---------- 反応（入れる・外す） ----------
var r1 = G.react(s0, 'g-lamp', 'like');
eq(r1.reacts, { 'g-lamp': ['like'] }, 'react 入れる');
var r2 = G.react(r1, 'g-lamp', 'how');
eq(r2.reacts['g-lamp'], ['like', 'how'], 'react 別の種類も入る');
eq(G.react(r2, 'g-lamp', 'like').reacts['g-lamp'], ['how'], 'react もう一度で外れる');
eq(G.react(G.react(r1, 'g-lamp', 'like'), 'g-lamp', 'x').reacts, {}, 'react 全部外すと消える・知らない種類は変えない');
eq(G.react(s0, 'g-lamp', 'zz'), s0, 'react 知らない種類は同じ state');
var who = G.reactors(r1, 'g-clay-walk', GD.reacts);
eq(who.how, [{ name: 'ペンギン号', mine: false }], 'reactors 見本の押した人');
eq(G.reactors(r1, 'g-lamp', GD.reacts).like, [{ name: null, mine: true }], 'reactors 自分（呼び名は描く時に読む）');
ok(Object.keys(who).every(function (k) { return Array.isArray(who[k]); }), 'reactors 数でなく呼び名の並び');

// ---------- 番人（§AG-4 (a)〜(d)） ----------
eq(G.guard('しゃがむ所、何コマ使ったの？'), 'ok', 'guard ふつうのひとことは ok');
eq(G.guard('すてきな色だね'), 'ok', 'guard ok');
eq(G.guard('なんかバカみたい'), 'hold', 'guard (a) 語の一覧');
GD.BAD_WORDS.forEach(function (w) { eq(G.guard('ねえ' + w + 'だね'), 'hold', 'guard (a) ' + w); });
eq(G.guard('090123'), 'ok', 'guard (b) 6 けたは ok');
eq(G.guard('電話番号は 0901234567'.replace('電話番号は ', '')), 'hold', 'guard (b) 10 けた');
eq(G.guard('1234567'), 'hold', 'guard (b) 7 けた');
eq(G.guard('１２３４５６７'), 'hold', 'guard (b) 全角の 7 けた');
eq(G.guard('123 4567'), 'ok', 'guard (b) 続いていなければ ok');
eq(G.guard('見て http://example.com'), 'hold', 'guard (c) http');
eq(G.guard('HTTPS で'), 'hold', 'guard (c) 大文字の HTTP');
eq(G.guard('a@b'), 'hold', 'guard (c) @');
eq(G.guard('＠ここ'), 'hold', 'guard (c) 全角の ＠');
eq(G.guard('住所おしえて'), 'hold', 'guard (c) 住所');
eq(G.guard('電話して'), 'hold', 'guard (c) 電話');
eq(G.guard('LINE で話そう'), 'hold', 'guard (c) LINE');
eq(G.guard('ｌｉｎｅ'), 'hold', 'guard (c) 全角の line');
eq(G.guard('たの' + new Array(9).join('ー') + 'い'), 'hold', 'guard (d) 同じ文字 8 回以上');
eq(G.guard('わああああああ'), 'ok', 'guard (d) 7 回は ok');
eq(G.guard('🐸🐸🐸🐸🐸🐸🐸🐸'), 'hold', 'guard (d) 絵文字 8 回');
eq(G.guard(''), 'ok', 'guard 空は ok（送る前に止める）');

// ---------- ひとこと ----------
var a1 = G.addNote(s0, { id: 'n1', itemId: 'g-lamp', text: '  いい色だね  ', time: '11/2 10:20' });
eq(a1.notes, [{ id: 'n1', itemId: 'g-lamp', text: 'いい色だね', state: 'ok', time: '11/2 10:20' }], 'addNote 前後の空白を取る・ok');
var long = new Array(100).join('あ').replace(/あ/g, 'あい');
var a2 = G.addNote(a1, { id: 'n2', itemId: 'g-lamp', text: long, time: '11/2 10:21' });
eq(Array.from(a2.notes[1].text).length, 80, 'addNote 80 字で切る');
var a3 = G.addNote(a2, { id: 'n3', itemId: 'g-lamp', text: 'LINE 教えて', time: 't' });
eq(a3.notes[2].state, 'hold', 'addNote 番人の結果を state に持つ');
eq(G.addNote(a3, { id: 'n4', itemId: 'g-lamp', text: '   ', time: 't' }), a3, 'addNote 空は同じ state');
eq(G.addNote(a3, { id: 'n1', itemId: 'g-lamp', text: 'x', time: 't' }), a3, 'addNote 同じ id は同じ state');
eq(G.thread(a3, 'g-lamp', GD.notes).map(function (x) { return x.id; }), ['n1', 'n2'], 'thread 届いたものだけ（hold はスレッドに出ない）');
eq(G.thread(s0, 'g-clay-walk', GD.notes).map(function (x) { return x.text; }), ['しゃがむ所、何コマ使ったの？', '3 コマだよ'], 'thread 見本は古い順');
var a4 = G.addNote(G.addNote(s0, { id: 'x1', itemId: 'g-clay-walk', text: 'ひとつめ', time: '11/2 10:20' }), { id: 'x2', itemId: 'g-clay-walk', text: 'ふたつめ', time: '11/2 10:20' });
eq(G.thread(a4, 'g-clay-walk', GD.notes).map(function (x) { return x.id; }), ['gn-1', 'gn-2', 'x1', 'x2'], 'thread 自分の分は後ろ・同じ時刻は送った順');
var rm = G.removeNote(a3, 'n2');
eq(rm.state.notes.map(function (x) { return x.id; }), ['n1', 'n3'], 'removeNote 取り消す');
eq(G.restoreNote(rm.state, rm.undo).notes.map(function (x) { return x.id; }), ['n1', 'n2', 'n3'], 'removeNote の復元（元の位置へ）');
eq(G.restoreNote(a3, rm.undo), a3, 'restoreNote もうあれば同じ state');
eq(G.removeNote(a3, 'zz'), null, 'removeNote 無い id は null');

// ---------- 声かけ・返事（§AG-5） ----------
var c1 = G.call(sn, { id: 'gc1', itemId: 'g-clay-walk', kind: 'together', time: '11/2 10:20' });
eq(c1.calls, [{ id: 'gc1', itemId: 'g-clay-walk', kind: 'together', state: 'sent', time: '11/2 10:20' }], 'call 届ける');
eq(G.call(c1, { id: 'gc2', itemId: 'g-clay-walk', kind: 'teach', time: 't' }), c1, 'call 同じ作品には 1 つまで');
eq(G.call(sn, { id: 'gc3', itemId: 'g-lamp', kind: 'zz', time: 't' }), sn, 'call 知らない種類は同じ state');
var cc = G.cancelCall(c1, 'g-clay-walk');
eq(cc.state.calls, [], 'cancelCall 取り消す');
eq(G.restoreCall(cc.state, cc.undo).calls, c1.calls, 'cancelCall の復元');
eq(G.cancelCall(sn, 'g-clay-walk'), null, 'cancelCall 声かけが無ければ null');
var c2 = G.call(G.call(c1, { id: 'gc4', itemId: 'g-rain-novel', kind: 'teach', time: 't' }), { id: 'gc5', itemId: 'g-lamp', kind: 'continue', time: 't' });
var st1 = G.settle(c2, [], { seed: GD.items, time: '11/2 10:30' });
eq(st1.calls.map(function (c) { return c.state; }), ['ok', 'later', 'sent'], 'settle answers ok → OK / later → 今はやめておく / それ以外は待ち');
eq(st1.promises, [{ id: 'p-gc1', with: 'そらまめ', title: '粘土のカエルが歩く動画', actId: null, time: '11/2 10:30' }], 'settle OK → いっしょに作る約束に 1 件');
eq(G.settle(st1, [], { seed: GD.items, time: 't' }), st1, 'settle 2 回呼んでも増えない（同じ state）');
eq(G.cancelCall(st1, 'g-clay-walk'), null, 'cancelCall 返事が来た後は取り消せない');
eq(G.settle(sn, works, { seed: GD.items, time: 't' }), sn, 'settle 何も出していなければ声かけは届かない');
var sp3 = G.put(sn, 'wa', '11/2 10:20');
var st2 = G.settle(sp3, works, { seed: GD.items, time: '11/2 10:35' });
eq(st2.inbox, [{ id: 'in-seed', workId: 'wa', from: 'そらまめ', kind: 'together', state: 'new', time: '11/2 10:35' }], 'settle 初めて出した後に 1 件届く（そらまめ・いっしょに作りたい）');
eq(st2.seeded, true, 'settle 届けたら seeded');
eq(G.settle(st2, works, { seed: GD.items, time: 't' }), st2, 'settle 2 回目は増えない');
var tk3 = G.take(st2, 'wa', 't');
eq(G.settle(G.put(tk3.state, 'wb', 't'), works, { seed: GD.items, time: 't' }).inbox.length, 1, 'settle 外して出し直しても増えない');
eq(G.settle(G.setAuto(sn, true), works, { seed: GD.items, time: 't' }).inbox.length, 1, 'settle 自動で並んだ時も初めての 1 件');
var an = G.answer(st2, 'in-seed', 'ok', { title: '完成の作品', time: '11/2 10:40' });
eq(an.inbox[0].state, 'ok', 'answer OK する');
eq(an.promises, [{ id: 'p-in-seed', with: 'そらまめ', title: '完成の作品', actId: null, time: '11/2 10:40' }], 'answer OK → 約束に入る');
eq(G.answer(an, 'in-seed', 'later', {}), an, 'answer 返事した後は変えない');
var al = G.answer(st2, 'in-seed', 'later', {});
eq([al.inbox[0].state, al.promises.length], ['later', 0], 'answer 今はやめておく（約束に入らない）');
eq(G.answer(st2, 'in-seed', 'maybe', {}), st2, 'answer 知らない返事は同じ state');
eq(G.answer(st2, 'zz', 'ok', {}), st2, 'answer 無い id は同じ state');
var pa = G.setPromiseAct(an, 'p-in-seed', 'a1');
eq(pa.promises[0].actId, 'a1', 'setPromiseAct');
eq(G.setPromiseAct(pa, 'p-in-seed', 'a1'), pa, 'setPromiseAct 同じなら同じ state');
eq(G.promiseCat(st1, st1.promises[0], [], GD.items), 'media', 'promiseCat 声かけからは見本の作品の種類');
eq(G.promiseCat(an, an.promises[0], works, GD.items), 'programming', 'promiseCat 届いた声かけからは自分の作品の種類');
// 純関数は元の state を変えない
eq(freeze(c2), freeze(G.call(G.call(c1, { id: 'gc4', itemId: 'g-rain-novel', kind: 'teach', time: 't' }), { id: 'gc5', itemId: 'g-lamp', kind: 'continue', time: 't' })), 'settle 元の state を変えない');

// ---------- 先に準備する（make.js の M.fromPromise。fromOdai と同じ約束） ----------
var pr = { id: 'p-gc1', with: 'そらまめ', title: '粘土のカエルが歩く動画', actId: null, time: 't' };
var fp = M.fromPromise(pr, { id: 'a-1', title: '粘土のカエルが歩く動画 を いっしょに作る', steps: GD.PREP_STEPS, theme: 'zz', now: '10:20', acts: [] });
ok(fp && fp.created && fp.act.origin === 'gallery' && fp.act.promiseId === 'p-gc1' && fp.act.stepsKind === 'ext', 'fromPromise 外で作る活動（origin gallery・promiseId）');
eq(fp.act.steps.map(function (s) { return s[0]; }), ['何を一緒に作るか話す', '分けてやる所を決める', '合わせて見る'], 'fromPromise 手順は約束のもの');
eq(fp.act.title, '粘土のカエルが歩く動画 を いっしょに作る', 'fromPromise 題');
eq(fp.act.theme, 'mc', 'fromPromise 知らない題材は mc（既存の外で作る活動と同じ）');
var fp2 = M.fromPromise(pr, { id: 'a-2', title: 'x', steps: GD.PREP_STEPS, acts: [fp.act] });
ok(fp2 && !fp2.created && fp2.id === 'a-1', 'fromPromise 2 回目は同じ活動');
eq(M.fromPromise(null, { id: 'a', title: 'x' }), null, 'fromPromise 約束が無ければ null');

// ---------- 画面の文言 key が i18n.js にある / 子どもの入力を HTML に入れない ----------
var i18n = fs.readFileSync(path.join(__dirname, '../app-v3/js/i18n.js'), 'utf8');
var gsrc = fs.readFileSync(path.join(__dirname, '../app-v3/js/gallery.js'), 'utf8');
var wsrc = fs.readFileSync(path.join(__dirname, '../app-v3/js/works.js'), 'utf8');
var keys = {};
(gsrc + wsrc).replace(/\bT\('([a-z_]+)'/g, function (all, k) { if (!/_$/.test(k)) keys[k] = true; return all; });
GD.CATS.forEach(function (c) { keys['gl_cat_' + c] = true; });
G.KINDS.forEach(function (k) { keys['gl_r_' + k] = true; });
G.CALLS.forEach(function (k) { keys['gl_c_' + k] = true; });
['gl_name_empty', 'gl_name_long', 'gl_inbox_toast', 'gl_call_ok', 'gl_call_later', 'gl_auto_on', 'gl_auto_off', 'gl_inbox_ok_toast', 'gl_inbox_later_toast', 'origin_gallery'].forEach(function (k) { keys[k] = true; });
var missing = Object.keys(keys).filter(function (k) { return !new RegExp('\\n\\s+' + k + ": \\['[^']+', '[^']+'\\]").test(i18n); });
eq(missing, [], 'AG 使う key が i18n.js に [中, 小] である');
var block = i18n.split('// ---- §AG ----')[1] || '';
ok(block.length > 0, 'AG i18n は // ---- §AG ---- の塊');
var afLines = block.split('\n').filter(function (l) { return /^\s+(gl_|gallery|origin_gallery)/.test(l); });
ok(afLines.length > 50, 'AG i18n の行（' + afLines.length + '）');
ok(!/点数|ランキング|順位|評価|成績|レベル|集中力|得意|苦手|上手|成長|頑張|すごい|版|人気|いいね数/.test(afLines.join('\n')), 'AG の文言に評価の語・「版」・人気が無い');
eq(i18n.indexOf("gl_sub: ['教室のみんなが、見せてもいいよと出した作品。見られるのは、同じ教室の人とサポーターだけ'") > 0, true, 'AG-1 見出しの下の 1 文（verbatim）');
eq(i18n.indexOf("gl_sub2: ['サポーターは、展示のやりとりを全部見られるよ'") > 0, true, 'AG-1 小さく 1 行（verbatim）');
eq(i18n.indexOf("gl_held: ['このひとことは、サポーターが先に読むことになったよ'") > 0, true, 'AG-4 届けない時の 1 文（verbatim）');
eq(i18n.indexOf("gl_reading: ['AI が先に読んでいるよ'") > 0, true, 'AG-4 先に読んでいる（verbatim）');
var browser = gsrc.split('ここから下はブラウザ専用')[1] || '';
var raws = browser.match(/DES\.raw\(([^)]*)\)/g) || [];
ok(raws.length > 0 && raws.every(function (r) { return /^DES\.raw\((DES\.icon\(n|GD\.lineArt\(it\.cat|svg \|\| GD\.lineArt\(cat)\)$/.test(r); }), 'AG DES.raw に渡すのは固定の SVG・アイコンだけ（' + raws.join(' / ') + '）');
ok(!/innerHTML|insertAdjacentHTML|outerHTML/.test(gsrc), 'AG innerHTML を使わない');
ok(!/\bfetch\(|XMLHttpRequest/.test(gsrc + fs.readFileSync(path.join(__dirname, '../app-v3/js/gallery-data.js'), 'utf8')), 'AG fetch を使わない');
ok(/\(DES\.thumbs \|\| \{\}\)\[id\]/.test(gsrc), 'AG DES.thumbs が無くても落ちない');
ok(!/badge|count\b/i.test(browser.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), 'AG 件数のバッジを作らない');

// ---------- レビューへの裁定（contract-app 末尾「直す（実装）」/「契約の方を直した」）----------
function t(name, fn) { try { fn(); } catch (e) { fail += 1; console.log('NG  ' + name + '  (例外 ' + e.message + ')'); } }
var MD = require(path.join(__dirname, '../app-v3/js/make-data.js'));
function gHandler(name) { var i = gsrc.indexOf("A['" + name + "'] = function"); if (i < 0) return ''; var j = gsrc.indexOf("\n  A['", i + 10); return gsrc.slice(i, j < 0 ? i + 3000 : j); }
t('裁定 5 展示の種類: 提案から作った作品は提案のカテゴリ', function () {
  var a = M.fromProject(MD.project('pj-novel-3'), { id: 'a-g5', mode: 'js', now: '10:20', acts: [] }).act;
  var w = M.saveWork([], a, { id: 'w-g5', date: '11/6', status: 'done' }).work;
  eq([w.projectId, G.catOf(w)], ['pj-novel-3', 'writing'], '裁定 5 「3 場面の短い小説」の作品は「文章」');
  var st = G.put(G.initial(), 'w-g5', '11/6 10:30');
  eq(G.filter(G.items(st, [w], []), 'writing').map(function (it) { return it.id; }), ['my-w-g5'], '裁定 5 「文章」で絞ると出る');
  var mc = M.fromProject(MD.project('pj-mc-door'), { id: 'a-g5b', mode: 'js', now: '10:20', acts: [] }).act;
  eq(G.catOf(M.saveWork([], mc, { id: 'w-g5b' }).work), 'minecraft', '裁定 5 マイクラの提案はマイクラ');
  eq(G.catOf({ id: 'w-x', title: 'x', theme: 'mc' }), 'minecraft', '裁定 5 提案でない作品は今までどおり題材から');
});
t('裁定 6 約束の id: 空の id は読み込み時に捨てる', function () {
  var raw = G.initial();
  raw.promises = [{ id: '', with: 'fixture', title: 'fixture', actId: null, time: 't' }, { id: 'p-gc1', with: 'そらまめ', title: '粘土', actId: null, time: 't' }];
  eq(G.normalize(raw).promises.map(function (p) { return p.id; }), ['p-gc1'], '裁定 6 空の id の約束は捨てる');
});
t('裁定 7 ひとこと: 送信待ちの間は、どの作品の「送る」も disabled', function () {
  eq([G.canSend('こんにちは', null), G.canSend('こんにちは', { itemId: 'g-lamp' }), G.canSend('こんにちは', { itemId: 'g-clay-walk' }), G.canSend('  ', null)], [true, false, false, false], '裁定 7 送れるのは下書きがあって送信待ちでない時だけ');
  var ns = gsrc.slice(gsrc.indexOf('function notesSec'), gsrc.indexOf('function callSec'));
  ok(/dis = !canSend\(draft, u\.sending\)/.test(ns) && !/sending = !!\(u\.sending && u\.sending\.itemId === it\.id\)[^;]*;\s*\n[^\n]*dis = !trim\(draft\) \|\| sending/.test(ns), '裁定 7 送るの disabled は作品を問わず送信待ちを見る');
});
t('裁定 9 展示の絵: 保存された作品の絵の形が違う時は、種類の線画に替える', function () {
  var bad = [{ note: { title: 'x', lines: 'abc' } }, { note: 'x' }, { photo: 'x' }, { photo: { theme: 5 } }, { stage: { theme: 'nope', variant: 'x', values: {} } },
    { stage: { kind: 'sample', theme: 'stop', variant: 'walk', values: { frames: 99, fps: 1 } } }, { stage: { kind: 'sample', theme: 'mc', variant: 'cube', values: 'x' } }, 'x', [1], { other: 1 }];
  bad.forEach(function (b, i) { eq(G.safeArt(b), null, '裁定 9 壊れた絵 ' + i + ' は使わない（線画に替える）'); });
  var good = [{ note: { title: ['a', 'a'], lines: [['1', '1'], '2'] } }, { photo: { id: 'ph1', theme: 'project', n: 0, cat: 'craft', kind: 'photo' } },
    { stage: { kind: 'sample', theme: 'stop', variant: 'walk', values: { frames: 2, fps: 1 } } }];
  good.forEach(function (g, i) { eq(G.safeArt(g), g, '裁定 9 正しい絵 ' + i + ' はそのまま'); });
  var wa = gsrc.slice(gsrc.indexOf('function workArt'), gsrc.indexOf('function artEl'));
  ok(/safeArt\(/.test(wa) && /catch \(e\)/.test(wa), '裁定 9 workArt は形を確かめ、例外でも線画に替える');
});
t('契約 AG-2: 写真から入れた作品は自動では展示に出さない + 切替の下の 1 行', function () {
  var st = G.setAuto(G.initial(), true);
  var cap = { id: 'w-cap', title: '写真', status: 'done', from: 'capture', theme: 'mc' }, mk = { id: 'w-mk', title: '作った', status: 'done', from: 'make', theme: 'mc' };
  eq([G.isIn(st, cap), G.isIn(st, mk)], [false, true], 'AG-2 自動では写真から入れた作品を出さない');
  eq(G.isIn(G.put(st, 'w-cap', 't'), cap), true, 'AG-2 1 つずつなら出せる');
  eq(G.items(st, [cap, mk], []).map(function (it) { return it.id; }), ['my-w-mk'], 'AG-2 自動の並びに写真から入れた作品は無い');
  ok(i18n.indexOf("gl_auto_capture: ['写真から入れた作品は、1 つずつ出してね'") > 0, 'AG-2 切替の下の 1 行（verbatim）');
  var rl = gsrc.slice(gsrc.indexOf('function renderList'), gsrc.indexOf('// ---------- 詳細'));
  ok(rl.indexOf("T('gl_auto_capture')") > rl.indexOf("T('gl_auto')"), 'AG-2 1 行は切替の下');
});
t('契約 AG-4: ひとことの字数は入力欄も保存もコードポイント', function () {
  var e81 = Array(82).join('😀');
  eq([Array.from(G.fitNote(e81)).length, G.fitNote('abc')], [80, 'abc'], 'AG-4 入力欄の値はコードポイントで 80 字まで');
  var ns = gsrc.slice(gsrc.indexOf('function notesSec'), gsrc.indexOf('function callSec'));
  ok(!/maxlength/.test(ns) && /fitNote\(t\.value\)/.test(gsrc), 'AG-4 入力欄は UTF-16 の maxlength を使わず、入力のたびにコードポイントで切る');
});
t('確認レビュー 2 展示の種類: projectId の無い作品は actId の活動の projectId から', function () {
  var a = M.fromProject(MD.project('pj-novel-3'), { id: 'a-r2', mode: 'js', now: '10:20', acts: [] }).act;
  var w = JSON.parse(JSON.stringify(M.saveWork([], a, { id: 'w-r2', date: '11/6', status: 'done' }).work));
  delete w.projectId;
  var before = JSON.stringify(w);
  eq([w.actId, G.catOf(w, [a]), G.catOf(w)], ['a-r2', 'writing', 'craft'], '確認 2 活動があれば提案のカテゴリ・無ければ今までどおり');
  eq(G.catOf(w, [{ id: 'other', projectId: 'pj-novel-3' }]), 'craft', '確認 2 actId の違う活動は見ない');
  var st = G.put(G.initial(), 'w-r2', '11/6 10:30');
  eq(G.filter(G.items(st, [w], [], [a]), 'writing').map(function (it) { return it.id; }), ['my-w-r2'], '確認 2 「文章」で絞ると出る');
  eq(JSON.stringify(w), before, '確認 2 保存データは書き換えない');
});
t('確認レビュー 3 約束の id: 既にある別の約束と重なったら -2, -3 … で足す', function () {
  var s = G.initial();
  s.inbox = [{ id: 'in-seed', workId: 'wa', from: 'そらまめ', kind: 'together', state: 'new', time: 't' }];
  s.promises = [{ id: 'p-in-seed', with: 'fixture', title: '別の約束', actId: null, time: 't' }];
  var a1 = G.answer(s, 'in-seed', 'ok', { title: '新しい約束', time: 't2' });
  eq([a1.inbox[0].state, a1.promises.map(function (p) { return p.id + ':' + p.title; })], ['ok', ['p-in-seed-2:新しい約束', 'p-in-seed:別の約束']], '確認 3 重なったら -2 で足す');
  eq(G.answer(a1, 'in-seed', 'ok', { title: 'x', time: 't3' }), a1, '確認 3 同じ声かけを 2 回 OK にしても約束は 1 件のまま');
  s.promises.push({ id: 'p-in-seed-2', with: 'fixture', title: '別の約束 2', actId: null, time: 't' });
  eq(G.answer(s, 'in-seed', 'ok', { title: '新', time: 't2' }).promises[0].id, 'p-in-seed-3', '確認 3 -2 も重なったら -3');
});

console.log('gallery-test: ' + pass + ' passed, ' + fail + ' failed');
console.log('GALLERY_TEST=' + (fail === 0 ? 'PASS' : 'FAIL'));
process.exitCode = fail === 0 ? 0 : 1;
