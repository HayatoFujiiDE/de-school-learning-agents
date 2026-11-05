/* 作品展示（#gallery 一覧 / #gallery/<itemId> 詳細）: contract-app §AF。§W-4 の「見せる」とは別の操作（見せるは変えない）。
   展示に並ぶもの = 他の人の作品の見本（gallery-data.js）+ 自分が出している作品。並びは新しい順だけ。反応の数・人気順・件数は出さない。
   呼び名・ひとことは利用者の入力なので、必ず DES.h の文字列子要素（textContent）で出す。DES.raw には固定の SVG だけを渡す。
   通知やバッジを他の画面に出さない（#gallery を開いた時だけ分かる）。返事と見本の声かけは #gallery を開いた時の決定論（G.settle）。
   純関数（G.initial / normalize / setName / items / put / take / react / guard / addNote / call / settle / answer / filter …）は DOM と DES.t に触れず、
   node からも読める（tools/gallery-test.js）。保存は des3.gallery（DES.store 経由・失敗したら save_fail + 画面の状態を戻す）。 */
(function (root) {
  'use strict';
  var DES = root.DES = root.DES || {};
  var GD = DES.galleryData || (typeof require === 'function' ? require('./gallery-data.js') : null);
  var G = DES.gallery = DES.gallery || {};
  var KINDS = ['like', 'how', 'try'], CALLS = ['together', 'teach', 'continue'];
  var NAME_MAX = 12, NOTE_MAX = 80, MY = 'my-';

  // ---------- 小道具 ----------
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function isStr(v) { return typeof v === 'string'; }
  function trim(v) { return String(v == null ? '' : v).replace(/^\s+|\s+$/g, ''); }
  function find(list, id) { for (var i = 0; i < (list || []).length; i++) if (list[i] && list[i].id === id) return list[i]; return null; }
  function idx(list, id) { for (var i = 0; i < (list || []).length; i++) if (list[i] && list[i].id === id) return i; return -1; }
  // 字数はコードポイントで数える（絵文字 1 つ = 1 字）
  function chars(s) { return Array.from ? Array.from(String(s)) : String(s).split(''); }
  function len(s) { return chars(s).length; }
  function cut(s, n) { return chars(s).slice(0, n).join(''); }
  // 'M/D H:MM' → 並べる数（年はまたがない見本）。読めない時は 0
  function timeKey(t) {
    var m = /^(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/.exec(String(t || ''));
    return m ? (+m[1]) * 1000000 + (+m[2]) * 10000 + (+(m[3] || 0)) * 100 + (+(m[4] || 0)) : 0;
  }
  // 時刻で並べる（同じ時刻は元の並びのまま）。dir = -1 新しい順 / 1 古い順
  function byTime(list, dir) {
    return list.map(function (x, i) { return { x: x, i: i, k: timeKey(x.time) }; })
      .sort(function (a, b) { return dir * (a.k - b.k) || a.i - b.i; }).map(function (o) { return o.x; });
  }
  function newestFirst(list) { return byTime(list, -1); }

  // ---------- 状態（§AF-6） ----------
  function initial() {
    return { v: 1, name: null, auto: false, mine: {}, reacts: {}, notes: [], calls: [], inbox: [], promises: [], seeded: false };
  }
  // 呼び名: 前後の空白を取って 1〜12 字なら その文字列、それ以外は null
  function okName(v) { var t = trim(v), n = len(t); return n >= 1 && n <= NAME_MAX ? t : null; }
  function okNote(n) {
    return isObj(n) && isStr(n.id) && isStr(n.itemId) && isStr(n.text) && len(trim(n.text)) >= 1 && len(n.text) <= NOTE_MAX &&
      (n.state === 'ok' || n.state === 'hold') && isStr(n.time);
  }
  function okCall(c) { return isObj(c) && isStr(c.id) && isStr(c.itemId) && CALLS.indexOf(c.kind) >= 0 && ['sent', 'ok', 'later'].indexOf(c.state) >= 0 && isStr(c.time); }
  function okInbox(c) { return isObj(c) && isStr(c.id) && isStr(c.workId) && isStr(c.from) && CALLS.indexOf(c.kind) >= 0 && ['new', 'ok', 'later'].indexOf(c.state) >= 0 && isStr(c.time); }
  // 空の id の約束は捨てる（「先に準備する」が id で探すため。レビューへの裁定）
  function okPromise(p) { return isObj(p) && isStr(p.id) && !!p.id && isStr(p.with) && isStr(p.title) && (p.actId === null || isStr(p.actId)) && isStr(p.time); }
  function pickList(raw, test, uniq) {
    var out = [], seen = {};
    if (!Array.isArray(raw)) return out;
    raw.forEach(function (x) {
      if (!test(x)) return;
      var k = uniq ? uniq(x) : x.id;
      if (seen[k]) return;
      seen[k] = true;
      out.push(clone(x));
    });
    return out;
  }
  // 読み込んだ値を整える。形が違う項目はその項目だけ初期値（他の項目は残す）
  function normalize(raw) {
    var d = initial();
    if (!isObj(raw)) return d;
    var out = initial();
    out.name = isStr(raw.name) ? okName(raw.name) : null;
    out.auto = raw.auto === true;
    if (isObj(raw.mine)) {
      Object.keys(raw.mine).forEach(function (k) {
        var m = raw.mine[k];
        if (isObj(m) && (m.state === 'in' || m.state === 'out') && isStr(m.time)) out.mine[k] = { state: m.state, time: m.time };
      });
    }
    if (isObj(raw.reacts)) {
      Object.keys(raw.reacts).forEach(function (k) {
        var v = raw.reacts[k];
        if (!Array.isArray(v)) return;
        var ks = KINDS.filter(function (x) { return v.indexOf(x) >= 0; });
        if (ks.length) out.reacts[k] = ks;
      });
    }
    out.notes = pickList(raw.notes, okNote);
    // 同じ作品への声かけは 1 つまで（先のものを残す）
    out.calls = pickList(raw.calls, okCall, function (c) { return c.itemId; });
    out.inbox = pickList(raw.inbox, okInbox);
    out.promises = pickList(raw.promises, okPromise);
    out.seeded = raw.seeded === true;
    return out;
  }
  function setName(state, text) {
    var v = okName(text);
    if (!v || v === state.name) return state;
    var S = clone(state);
    S.name = v;
    return S;
  }
  function setAuto(state, on) {
    if (!!state.auto === !!on) return state;
    var S = clone(state);
    S.auto = !!on;
    return S;
  }

  // ---------- 展示に並ぶもの（§AF-2 / AF-3） ----------
  function catalogCat(id) {
    var d = DES.data, hit = null;
    if (!id || !d || !Array.isArray(d.catalog)) return null;
    d.catalog.forEach(function (c) { (c.items || []).forEach(function (it) { if (it.id === id) hit = c.id; }); });
    return hit && GD.CATS.indexOf(hit) >= 0 ? hit : null;
  }
  // 提案から作った作品（§AD-4。theme 'project'）の種類: 提案のカテゴリ（作品の projectId → 無ければ acts の中の作品の actId の活動の projectId
  // → 無ければ写真のカテゴリ）。保存データは書き換えない。レビューへの裁定
  function projectCat(w, acts) {
    if (!w || w.theme !== 'project') return null;
    var a = !isStr(w.projectId) && isStr(w.actId) ? find(acts, w.actId) : null, pid = isStr(w.projectId) ? w.projectId : (a && isStr(a.projectId) ? a.projectId : null);
    var MD = DES.makeData, p = pid && MD && MD.project ? MD.project(pid) : null;
    var c = p ? p.cat : (isObj(w.art) && isObj(w.art.photo) ? w.art.photo.cat : null);
    return GD.CATS.indexOf(c) >= 0 ? c : null;
  }
  // 自分の作品の種類: 提案のカテゴリ → catalog の id → 題材 → ものづくり（acts = 活動の一覧。省略可）
  function catOf(w, acts) { return projectCat(w, acts) || catalogCat(w && w.catalogId) || GD.THEME_CAT[w && w.theme] || 'craft'; }
  // 出している = 1 つずつ出した（in）か、自動が入で完成の作品（外した out は出さない）。
  // 写真から入れた作品（from 'capture'）は自動では出さない（顔や名前が写っていないかを本人が見てから 1 つずつ。§AF-2）
  function isIn(state, w) {
    if (!w || !state) return false;
    var m = state.mine && state.mine[w.id];
    if (m && m.state === 'out') return false;
    if (m && m.state === 'in') return true;
    return state.auto === true && w.status === 'done' && w.from !== 'capture';
  }
  function inTime(state, w) {
    var m = state.mine && state.mine[w.id];
    if (m && m.state === 'in') return m.time;
    return w.date ? (w.date + (w.atTime ? ' ' + w.atTime : '')) : '';
  }
  function itemId(workId) { return MY + workId; }
  function ownItem(state, w, acts) {
    return { id: itemId(w.id), mine: true, workId: w.id, name: state.name, cat: catOf(w, acts), title: w.title, like: w.like || null, craft: w.craft || null,
      buddy: !!(w.roles && w.roles.ai > 0), photo: w.from === 'capture', art: clone(w.art || null), time: inTime(state, w), answers: null };
  }
  function seedItem(s) {
    return { id: s.id, mine: false, workId: null, name: s.name, cat: s.cat, title: s.title, like: s.like || null, craft: s.craft || null,
      buddy: false, photo: false, art: s.art, time: s.time, answers: s.answers || null };
  }
  function items(state, works, seed, acts) {
    var out = [];
    (works || []).forEach(function (w) { if (w && isStr(w.id) && isIn(state, w)) out.push(ownItem(state, w, acts)); });
    (seed || GD.items).forEach(function (s) { out.push(seedItem(s)); });
    return newestFirst(out);
  }
  function filter(list, cat) { return !cat || cat === 'all' ? list.slice() : list.filter(function (it) { return it.cat === cat; }); }
  // 並んでいる種類（チップ。GD.CATS の順）
  function cats(list) { return GD.CATS.filter(function (c) { return list.some(function (it) { return it.cat === c; }); }); }

  // ---------- 出す・外す（§AF-2） ----------
  function put(state, workId, time) {
    if (!isStr(workId) || !workId) return state;
    var m = state.mine[workId];
    if (m && m.state === 'in') return state;
    var S = clone(state);
    S.mine[workId] = { state: 'in', time: String(time || '') };
    return S;
  }
  // 外す（自動で並んでいる作品も out にする）+ 元に戻す（前の記録へ）
  function take(state, workId, time) {
    if (!isStr(workId) || !workId) return null;
    var m = state.mine[workId];
    if (m && m.state === 'out') return null;
    var S = clone(state);
    S.mine[workId] = { state: 'out', time: String(time || '') };
    return { state: S, undo: { workId: workId, prev: m ? clone(m) : null } };
  }
  function restoreTake(state, u) {
    if (!u || !isStr(u.workId)) return state;
    var S = clone(state);
    if (u.prev) S.mine[u.workId] = clone(u.prev); else delete S.mine[u.workId];
    return S;
  }

  // ---------- 反応（§AF-4。押すと入る・もう一度で外れる） ----------
  function react(state, id, kind) {
    if (KINDS.indexOf(kind) < 0 || !isStr(id) || !id) return state;
    var S = clone(state), cur = S.reacts[id] || [], i = cur.indexOf(kind);
    if (i >= 0) cur.splice(i, 1); else cur.push(kind);
    cur = KINDS.filter(function (k) { return cur.indexOf(k) >= 0; });
    if (cur.length) S.reacts[id] = cur; else delete S.reacts[id];
    return S;
  }
  // ボタンごとの押した人（見本 + 自分）。数にしない
  function reactors(state, id, seed) {
    var out = { like: [], how: [], try: [] };
    (seed || GD.reacts).forEach(function (r) { if (r.itemId === id && out[r.kind]) out[r.kind].push({ name: r.name, mine: false }); });
    ((state.reacts && state.reacts[id]) || []).forEach(function (k) { if (out[k]) out[k].push({ name: null, mine: true }); });
    return out;
  }

  // ---------- 番人（§AF-4。モックの決定論）: hold にするのは (a) 語の一覧 (b) 7 けた以上の数字 (c) http・@・住所・電話・LINE (d) 同じ文字 8 回以上 ----------
  function guard(text) {
    var raw = String(text == null ? '' : text), t = raw.normalize ? raw.normalize('NFKC') : raw, low = t.toLowerCase();
    if (GD.BAD_WORDS.some(function (w) { return t.indexOf(w) >= 0 || raw.indexOf(w) >= 0; })) return 'hold';
    if (/[0-9]{7,}/.test(t)) return 'hold';
    if (low.indexOf('http') >= 0 || t.indexOf('@') >= 0 || t.indexOf('住所') >= 0 || t.indexOf('電話') >= 0 || low.indexOf('line') >= 0) return 'hold';
    var cs = chars(t), run = 1;
    for (var i = 1; i < cs.length; i++) {
      run = cs[i] === cs[i - 1] ? run + 1 : 1;
      if (run >= 8) return 'hold';
    }
    return 'ok';
  }

  // ---------- ひとこと（§AF-4）: 80 字で切る・番人の結果を state に持つ ----------
  function addNote(state, o) {
    o = o || {};
    var text = cut(trim(o.text), NOTE_MAX);
    if (!text || !isStr(o.itemId) || !o.itemId || !isStr(o.id) || find(state.notes, o.id)) return state;
    var S = clone(state);
    S.notes.push({ id: o.id, itemId: o.itemId, text: text, state: guard(text), time: String(o.time || '') });
    return S;
  }
  // 「送る」を押せるか: 下書きがあり、どの作品のひとことも送信待ちでない時だけ（レビューへの裁定）
  function canSend(draft, sending) { return !!trim(draft) && !sending; }
  // 入力欄の値をコードポイントで 80 字までにする（入力欄も保存も同じ数え方。§AF-4）
  function fitNote(v) { return cut(String(v == null ? '' : v), NOTE_MAX); }
  function removeNote(state, noteId) {
    var i = idx(state.notes, noteId);
    if (i < 0) return null;
    var S = clone(state), n = S.notes.splice(i, 1)[0];
    return { state: S, undo: { note: clone(n), index: i } };
  }
  function restoreNote(state, u) {
    if (!u || !okNote(u.note) || find(state.notes, u.note.id)) return state;
    var S = clone(state);
    S.notes.splice(Math.max(0, Math.min(u.index | 0, S.notes.length)), 0, clone(u.note));
    return S;
  }
  // スレッド（届いたものだけ・古い順）: 見本 + 自分の ok
  function thread(state, id, seed) {
    var out = [];
    (seed || GD.notes).forEach(function (n) { if (n.itemId === id) out.push({ id: n.id, name: n.name, mine: false, text: n.text, time: n.time }); });
    (state.notes || []).forEach(function (n) { if (n.itemId === id && n.state === 'ok') out.push({ id: n.id, name: null, mine: true, text: n.text, time: n.time }); });
    return byTime(out, 1);
  }

  // ---------- 声かけ（§AF-5）。同じ作品には 1 つまで ----------
  function call(state, o) {
    o = o || {};
    if (CALLS.indexOf(o.kind) < 0 || !isStr(o.itemId) || !o.itemId || !isStr(o.id)) return state;
    if (state.calls.some(function (c) { return c.itemId === o.itemId; })) return state;
    var S = clone(state);
    S.calls.push({ id: o.id, itemId: o.itemId, kind: o.kind, state: 'sent', time: String(o.time || '') });
    return S;
  }
  // 取り消す（返事を待っている間だけ）+ 元に戻す
  function cancelCall(state, id) {
    var i = -1;
    state.calls.forEach(function (c, j) { if (c.itemId === id && c.state === 'sent') i = j; });
    if (i < 0) return null;
    var S = clone(state), c = S.calls.splice(i, 1)[0];
    return { state: S, undo: { call: clone(c), index: i } };
  }
  function restoreCall(state, u) {
    if (!u || !okCall(u.call) || state.calls.some(function (c) { return c.itemId === u.call.itemId; })) return state;
    var S = clone(state);
    S.calls.splice(Math.max(0, Math.min(u.index | 0, S.calls.length)), 0, clone(u.call));
    return S;
  }
  // 約束を足す。id が既にある別の約束と重なったら、重ならない id（末尾に -2、-3 …）で足す（確認レビューへの裁定）
  function addPromise(S, p) {
    var id = p.id, k = 1;
    while (find(S.promises, id)) { k += 1; id = p.id + '-' + k; }
    p.id = id;
    S.promises.unshift(p);
    return true;
  }
  // #gallery を開いた時の決定論（2 回呼んでも増えない）:
  // 送った声かけ → 見本の answers が ok なら OK（約束に入る）・later なら「今はやめておく」/ 初めて展示に出した後なら、見本の声かけが 1 件届く
  // o: { seed（見本の作品）, time（今の時刻） }
  function settle(state, works, o) {
    o = o || {};
    var seed = o.seed || GD.items, time = String(o.time || ''), S = clone(state), changed = false;
    S.calls.forEach(function (c) {
      if (c.state !== 'sent') return;
      var it = find(seed, c.itemId);
      if (!it) return;
      if (it.answers === 'ok') {
        c.state = 'ok';
        addPromise(S, { id: 'p-' + c.id, with: it.name, title: it.title, actId: null, time: time });
        changed = true;
      } else if (it.answers === 'later') { c.state = 'later'; changed = true; }
    });
    if (!S.seeded) {
      var own = newestFirst((works || []).filter(function (w) { return w && isStr(w.id) && isIn(S, w); }).map(function (w) { return { id: w.id, time: inTime(S, w) }; }));
      if (own.length) {
        if (!find(S.inbox, 'in-seed')) S.inbox.push({ id: 'in-seed', workId: own[0].id, from: GD.SEED_CALL.from, kind: GD.SEED_CALL.kind, state: 'new', time: time });
        S.seeded = true;
        changed = true;
      }
    }
    return changed ? S : state;
  }
  // 届いた声かけに返事（理由は聞かない）。OK なら約束に入る。o: { title（作品の題）, time }
  function answer(state, inboxId, ans, o) {
    o = o || {};
    var i = idx(state.inbox, inboxId);
    if (i < 0 || state.inbox[i].state !== 'new' || (ans !== 'ok' && ans !== 'later')) return state;
    var S = clone(state), c = S.inbox[i];
    c.state = ans;
    if (ans === 'ok') addPromise(S, { id: 'p-' + c.id, with: c.from, title: String(o.title || ''), actId: null, time: String(o.time || '') });
    return S;
  }
  function setPromiseAct(state, promiseId, actId) {
    var i = idx(state.promises, promiseId);
    if (i < 0 || !isStr(actId) || state.promises[i].actId === actId) return state;
    var S = clone(state);
    S.promises[i].actId = actId;
    return S;
  }
  // 約束の種類（先に準備する活動の題材）: 声かけからなら見本の作品、届いた声かけからなら自分の作品
  function promiseCat(state, p, works, seed, acts) {
    var rest = p && isStr(p.id) ? p.id.slice(2) : '', c = find(state.calls, rest), inb = find(state.inbox, rest);
    if (c) { var it = find(seed || GD.items, c.itemId); return it ? it.cat : null; }
    if (inb) { var w = find(works, inb.workId); return w ? catOf(w, acts) : null; }
    return null;
  }

  // ---------- 保存された作品の絵の形（レビューへの裁定）: 形が違う時は null（呼ぶ側が種類の線画に替える） ----------
  function okPair(v) { return isStr(v) || (Array.isArray(v) && v.length >= 1 && v.every(isStr)); }
  function okNum(v) { return typeof v === 'number' && isFinite(v); }
  function okStage(st) {
    var MD = DES.makeData;
    if (!isObj(st) || !MD || !Array.isArray(MD.THEMES) || MD.THEMES.indexOf(st.theme) < 0 || !isStr(st.variant) || !isObj(st.values)) return false;
    var th = MD.theme(st.theme);
    if (th.variants.indexOf(st.variant) < 0) return false;
    return th.params.every(function (p) { var x = st.values[p.key]; return okNum(x) && x >= p.min && x <= p.max; });
  }
  function safeArt(art) {
    if (!isObj(art)) return null;
    if ('note' in art) return isObj(art.note) && okPair(art.note.title) && Array.isArray(art.note.lines) && art.note.lines.every(okPair) ? art : null;
    if ('photo' in art) {
      var p = art.photo;
      return isObj(p) && isStr(p.theme) && (p.n == null || (okNum(p.n) && p.n >= 0)) && (p.cat == null || isStr(p.cat)) && (p.odai == null || isStr(p.odai)) ? art : null;
    }
    if ('stage' in art) return okStage(art.stage) ? art : null;
    return null;
  }

  var pure = {
    initial: initial, normalize: normalize, okName: okName, setName: setName, setAuto: setAuto, items: items, isIn: isIn, inTime: inTime, itemId: itemId,
    catOf: catOf, filter: filter, cats: cats, put: put, take: take, restoreTake: restoreTake, react: react, reactors: reactors, guard: guard,
    addNote: addNote, removeNote: removeNote, restoreNote: restoreNote, thread: thread, call: call, cancelCall: cancelCall, restoreCall: restoreCall,
    settle: settle, answer: answer, setPromiseAct: setPromiseAct, promiseCat: promiseCat, timeKey: timeKey,
    canSend: canSend, fitNote: fitNote, safeArt: safeArt,
    KINDS: KINDS, CALLS: CALLS, NAME_MAX: NAME_MAX, NOTE_MAX: NOTE_MAX
  };
  Object.keys(pure).forEach(function (k) { G[k] = pure[k]; });
  if (typeof module !== 'undefined' && module.exports) module.exports = pure;
  if (typeof document === 'undefined') return;

  // ======================================================================
  // ここから下はブラウザ専用
  // ======================================================================

  // ---------- 保存: 既存の DES.store に des3.gallery を足す（today.js と同じ包み方） ----------
  if (DES.store && !DES.store._gallery) {
    var load2 = DES.store.load, save2 = DES.store.save;
    DES.store._gallery = true;
    DES.store.load = function () {
      var s = load2.apply(DES.store, arguments), raw = null;
      try {
        var t = window.localStorage.getItem('des3.gallery');
        if (t != null) raw = JSON.parse(t);
      } catch (e) { s.saveFailed = true; }
      s.gallery = normalize(raw);
      return s;
    };
    DES.store.save = function (only) {
      var ok = save2.call(DES.store, only);
      if (!only && !save2.call(DES.store, 'gallery')) ok = false;
      return ok;
    };
  }
  // ダイアログ（呼び名 / 展示に出す）。app.js の bind より先に置く（閉じる・Esc・外側クリックの扱いを共通にする）
  if (document.body && !document.getElementById('gallery-dialog')) {
    var gdl = document.createElement('dialog');
    gdl.className = 'make-dialog gallery-dialog';
    gdl.id = 'gallery-dialog';
    document.body.appendChild(gdl);
  }

  function S() { return DES.state; }
  function T(k, v) { return DES.t(k, v); }
  function H() { return DES.h.apply(null, arguments); }
  function icon(n) { return DES.raw(DES.icon(n)); }
  function pick(pair) { return Array.isArray(pair) ? (DES.mode() === 'es' && pair[1] != null ? pair[1] : pair[0]) : pair; }
  function esc(v) { return window.CSS && CSS.escape ? CSS.escape(v) : String(v).replace(/"/g, '\\"'); }
  function ui() {
    var u = DES.ui;
    if (!u.gl) u.gl = { cat: 'all', draft: {}, pick: {}, sending: null, dlg: null, shownDetail: null, missing: null, entered: false, pendingFocus: null };
    return u.gl;
  }
  function dlgEl() { return document.getElementById('gallery-dialog'); }
  function work(id) { return find(S().works || [], id); }
  function act(id) { return find(S().activities || [], id); }
  function stamp() { var p = DES.data.today.split('-'); return (+p[1]) + '/' + (+p[2]) + ' ' + DES.data.now; }
  function newId(p) { return DES.plan.newId(p); }
  function refocus(sel) { var n = sel ? document.querySelector(sel) : null; if (n) n.focus(); }
  function allItems() { return items(S().gallery, S().works, GD.items, S().activities); }
  function btn(label, action, o) {
    o = o || {};
    var at = { class: 'btn small' + (o.kls ? ' ' + o.kls : ''), type: 'button', 'data-action': action };
    if (o.id) at['data-id'] = o.id;
    if (o.arg != null) at['data-arg'] = o.arg;
    if (o.disabled) at.disabled = true;
    if (o.attrs) Object.keys(o.attrs).forEach(function (k) { at[k] = o.attrs[k]; });
    var kids = [];
    if (o.icon) kids.push(icon(o.icon));
    kids.push(H('span', null, label));
    return H('button', at, kids);
  }
  // 呼び名（自分の分は今の呼び名。まだ決めていなければ「自分」）
  function nameOf(name, mine) { return mine ? (S().gallery.name || T('gl_me')) : name; }
  function catChip(cat) { return H('span', { class: 'chip k-glcat' }, T('gl_cat_' + cat)); }
  function mineChip() { return H('span', { class: 'chip k-glmine' }, T('gl_mine')); }
  function buddyChip() { return H('span', { class: 'chip src-ai', role: 'img', 'aria-label': T('ai_proposal') + ' ' + T('gl_buddy') }, [icon('spark'), H('span', null, T('gl_buddy'))]); }

  // ---------- 絵: 自分の作品 = 作品の絵 / 見本 = DES.thumbs の画像（AI の印つき）、無ければ種類の線画 ----------
  var SAFE_SRC = /^img\/[A-Za-z0-9_\/.-]+\.(webp|png|jpg|jpeg)$/;
  function thumbSrc(id) { var t = (DES.thumbs || {})[id]; return isStr(t) && SAFE_SRC.test(t) && t.indexOf('..') < 0 ? t : null; }
  // 保存された絵の形が違う時・絵を作る途中で例外が出た時は、種類の線画に替える（例外で止めない。レビューへの裁定）
  function workArt(raw, cat) {
    var MD = DES.makeData, art = safeArt(raw), svg = '';
    if (art && art.note) {
      return [H('div', { class: 'work-note gl-note-art' }, [H('p', { class: 'wn-title' }, pick(art.note.title)),
        H('ul', null, art.note.lines.map(function (l) { return H('li', null, pick(l)); }))])];
    }
    try { svg = art && art.photo && MD ? MD.photoArt(art.photo) : (art && art.stage && MD ? MD.art(art.stage) : ''); } catch (e) { svg = ''; }
    return [DES.raw(svg || GD.lineArt(cat))];
  }
  function artEl(it, cls) {
    var box = H('div', { class: 'gl-art' + (cls ? ' ' + cls : '') });
    if (it.mine) { workArt(it.art, it.cat).forEach(function (n) { box.appendChild(n); }); return box; }
    var src = (it.art === 'photo' || it.art === 'illust') ? thumbSrc(it.id) : null;
    if (!src) { box.appendChild(DES.raw(GD.lineArt(it.cat))); return box; }
    var img = H('img', { src: src, alt: it.title, decoding: 'async' });
    // 読み込めなかったら線画に替える
    img.addEventListener('error', function () {
      box.textContent = '';
      box.classList.remove('has-img');
      box.appendChild(DES.raw(GD.lineArt(it.cat)));
    });
    box.classList.add('has-img');
    box.appendChild(img);
    box.appendChild(H('span', { class: 'gl-ai-mark' }, T('gl_ai_image')));
    return box;
  }

  // ---------- 一覧（§AF-3） ----------
  function card(it) {
    return H('a', { class: 'gl-card' + (it.mine ? ' is-mine' : ''), href: '#gallery/' + it.id, 'data-fk': 'glc:' + it.id }, [
      artEl(it, 'gl-card-art'),
      H('div', { class: 'gl-card-info' }, [
        H('h3', null, it.title),
        H('p', { class: 'gl-who' }, nameOf(it.name, it.mine)),
        H('div', { class: 'gl-card-foot' }, [catChip(it.cat), it.mine ? mineChip() : null])
      ])
    ]);
  }
  function inboxSec() {
    var list = S().gallery.inbox.filter(function (c) { return c.state === 'new' && work(c.workId); });
    if (!list.length) return null;
    return H('section', { class: 'gl-sec gl-inbox', 'aria-labelledby': 'gl-inbox-h' }, [
      H('div', { class: 'section-head' }, [H('h2', { id: 'gl-inbox-h', tabindex: '-1', 'data-fk': 'gl-inbox-h' }, T('gl_inbox_h'))]),
      H('ul', { class: 'gl-rows' }, list.map(function (c) {
        var w = work(c.workId);
        return H('li', { class: 'gl-row' }, [
          H('p', null, T('gl_inbox_line', { from: c.from, work: w.title, kind: T('gl_c_' + c.kind) })),
          H('div', { class: 'gl-row-ops' }, [btn(T('gl_inbox_ok'), 'gl-answer', { id: c.id, arg: 'ok', kls: 'orange' }), btn(T('gl_inbox_later'), 'gl-answer', { id: c.id, arg: 'later' })])
        ]);
      }))
    ]);
  }
  function promiseSec() {
    var list = S().gallery.promises;
    if (!list.length) return null;
    return H('section', { class: 'gl-sec gl-promises', 'aria-labelledby': 'gl-promise-h' }, [
      H('div', { class: 'section-head' }, [H('h2', { id: 'gl-promise-h', tabindex: '-1', 'data-fk': 'gl-promise-h' }, T('gl_promise_h'))]),
      H('ul', { class: 'gl-rows' }, list.map(function (p) {
        return H('li', { class: 'gl-row' }, [
          H('div', { class: 'gl-row-text' }, [
            H('p', { class: 'gl-row-title' }, [H('strong', null, T('gl_promise_with', { name: p.with })), ' · ', H('span', null, p.title)]),
            H('p', { class: 'gl-row-state' }, T('gl_promise_state', { supporter: DES.data.supporter.name }))
          ]),
          H('div', { class: 'gl-row-ops' }, [btn(T('gl_prep'), 'gl-prep', { id: p.id, icon: 'make' })])
        ]);
      }))
    ]);
  }
  function renderList(main) {
    var u = ui(), st = S().gallery, list = allItems(), cs = cats(list);
    if (u.cat !== 'all' && cs.indexOf(u.cat) < 0) u.cat = 'all';
    var shown = filter(list, u.cat);
    main.textContent = '';
    var nameRow = st.name ? H('div', { class: 'gl-name' }, [H('span', { class: 'gl-name-k' }, T('gl_name_label')), H('strong', null, st.name),
      btn(T('gl_name_change'), 'gl-name', { kls: 'ghost', attrs: { 'aria-haspopup': 'dialog' } })]) : null;
    var kids = [
      H('div', { class: 'page-head gl-page-head' }, [
        H('div', null, [H('h1', { tabindex: '-1', 'data-fk': 'gl-h' }, T('gallery')), H('p', null, T('gl_sub')), H('p', { class: 'gl-sub2' }, T('gl_sub2'))]),
        nameRow
      ]),
      H('label', { class: 'gl-auto', for: 'gl-auto' }, [H('input', { type: 'checkbox', id: 'gl-auto', 'data-ui': 'gl-auto', checked: st.auto === true, 'aria-describedby': 'gl-auto-capture' }), H('span', null, T('gl_auto'))]),
      // 切替の下の 1 行（§AF-2）: 写真から入れた作品は自動では出さない
      H('p', { class: 'hint gl-auto-note', id: 'gl-auto-capture' }, T('gl_auto_capture'))
    ];
    var ib = inboxSec(), ps = promiseSec();
    if (ib) kids.push(ib);
    if (ps) kids.push(ps);
    if (!list.length) {
      kids.push(H('div', { class: 'gl-empty' }, [H('p', { class: 'empty-line' }, T('gl_empty')), H('a', { class: 'btn small', href: '#works' }, T('gl_to_works'))]));
    } else {
      kids.push(H('div', { class: 'gl-filter', role: 'group', 'aria-label': T('gl_filter') }, ['all'].concat(cs).map(function (c) {
        var on = u.cat === c;
        return H('button', { class: 'opt-chip', type: 'button', 'data-action': 'gl-filter', 'data-arg': c, 'aria-pressed': on ? 'true' : 'false' }, c === 'all' ? T('gl_all') : T('gl_cat_' + c));
      })));
      kids.push(H('div', { class: 'gl-grid' }, shown.map(card)));
    }
    main.appendChild(H('div', { class: 'gallery-page' }, kids));
  }

  // ---------- 詳細（§AF-4 / AF-5） ----------
  function textBlock(label, text) { return H('div', { class: 'gl-text' }, [H('p', { class: 'gl-text-k' }, label), H('p', { class: 'gl-text-v' }, text)]); }
  function reactSec(it) {
    var who = reactors(S().gallery, it.id, GD.reacts), kids;
    if (it.mine) {
      var got = KINDS.filter(function (k) { return who[k].length; });
      kids = got.length ? [H('ul', { class: 'gl-got' }, got.map(function (k) {
        return H('li', null, [H('span', { class: 'gl-got-k' }, T('gl_r_' + k)), namesEl(who[k], k)]);
      }))] : [H('p', { class: 'wb-empty' }, T('gl_react_none'))];
    } else {
      var mineK = (S().gallery.reacts[it.id] || []);
      kids = [H('div', { class: 'gl-reacts' }, KINDS.map(function (k) {
        var on = mineK.indexOf(k) >= 0;
        return H('div', { class: 'gl-react' }, [
          H('button', { class: 'gl-react-btn' + (on ? ' on' : ''), type: 'button', 'data-action': 'gl-react', 'data-id': it.id, 'data-arg': k, 'aria-pressed': on ? 'true' : 'false' },
            [on ? icon('check') : null, H('span', null, T('gl_r_' + k))]),
          namesEl(who[k], k)
        ]);
      }))];
    }
    return H('section', { class: 'gl-sec card gl-block', 'aria-labelledby': 'gl-react-h' }, [H('h2', { id: 'gl-react-h' }, T('gl_react_h'))].concat(kids));
  }
  function namesEl(list, k) {
    if (!list.length) return null;
    return H('ul', { class: 'gl-names', 'aria-label': T('gl_r_' + k) }, list.map(function (r) {
      return H('li', { class: 'chip k-glname' + (r.mine ? ' is-me' : '') }, nameOf(r.name, r.mine));
    }));
  }
  function notesSec(it) {
    var u = ui(), st = S().gallery, th = thread(st, it.id, GD.notes), sending = !!(u.sending && u.sending.itemId === it.id);
    var held = st.notes.filter(function (n) { return n.itemId === it.id && n.state === 'hold'; });
    // どの作品のひとことが送信待ちでも「送る」は押せない（ハンドラーも全部の送信待ちで止まるため）
    var draft = u.draft[it.id] || '', dis = !canSend(draft, u.sending);
    var kids = [H('h2', { id: 'gl-notes-h' }, T('gl_notes_h'))];
    kids.push(th.length ? H('ol', { class: 'gl-thread' }, th.map(function (n) {
      return H('li', { class: 'gl-msg' + (n.mine ? ' is-me' : '') }, [
        H('p', { class: 'gl-msg-head' }, [H('strong', null, nameOf(n.name, n.mine)), H('span', { class: 'gl-msg-time' }, n.time)]),
        H('p', { class: 'gl-msg-text' }, n.text),
        n.mine ? btn(T('gl_note_cancel'), 'gl-note-del', { id: n.id, kls: 'ghost', attrs: { 'aria-label': T('gl_note_cancel') + ': ' + n.text } }) : null
      ]);
    })) : H('p', { class: 'wb-empty' }, T('gl_notes_none')));
    if (held.length) {
      kids.push(H('div', { class: 'gl-held', tabindex: '-1', 'data-fk': 'gl-held' }, [
        H('p', { class: 'gl-held-k' }, T('gl_held_h')),
        H('ul', null, held.map(function (n) {
          return H('li', null, [H('p', { class: 'gl-msg-text' }, n.text), H('p', { class: 'gl-held-why' }, T('gl_held')),
            btn(T('gl_note_cancel'), 'gl-note-del', { id: n.id, kls: 'ghost', attrs: { 'aria-label': T('gl_note_cancel') + ': ' + n.text } })]);
        }))
      ]));
    }
    kids.push(H('div', { class: 'gl-note-form', 'data-fk': 'gl-note-form' }, [
      H('label', { for: 'gl-note' }, T('gl_note_label')),
      H('div', { class: 'gl-note-row' }, [
        // 字数はコードポイントで数える（UTF-16 で数える入力欄の上限の属性は使わず、入力のたびに fitNote で切る。§AF-4）
        H('input', { id: 'gl-note', type: 'text', 'data-ui': 'gl-note', 'data-id': it.id, value: draft, autocomplete: 'off',
          readonly: sending, 'aria-busy': sending ? 'true' : null, 'aria-describedby': 'gl-note-need' }),
        btn(T('gl_note_send'), 'gl-note-send', { id: it.id, kls: 'primary', icon: 'send', disabled: dis })
      ]),
      H('p', { class: 'hint', id: 'gl-note-need', hidden: !!trim(draft) || sending }, T('gl_note_need')),
      H('p', { class: 'gl-reading', role: 'status' }, sending ? T('gl_reading') : '')
    ]));
    return H('section', { class: 'gl-sec card gl-block', 'aria-labelledby': 'gl-notes-h' }, kids);
  }
  function callSec(it) {
    var st = S().gallery, c = null, u = ui();
    st.calls.forEach(function (x) { if (x.itemId === it.id) c = x; });
    var kids = [H('h2', { id: 'gl-call-h' }, T('gl_call_h'))];
    if (!c) {
      var pk = u.pick[it.id] || null;
      kids.push(H('fieldset', { class: 'gl-call-pick' }, [H('legend', { class: 'sr-only' }, T('gl_call_h')), H('div', { class: 'mode-options' }, CALLS.map(function (k) {
        return H('label', { class: 'radio-card' }, [H('input', { type: 'radio', name: 'gl-call-' + it.id, value: k, checked: pk === k, 'data-ui': 'gl-call-pick', 'data-id': it.id }),
          H('span', null, T('gl_c_' + k))]);
      }))]));
      kids.push(H('div', { class: 'actions' }, [btn(T('gl_call_send'), 'gl-call', { id: it.id, kls: 'orange', icon: 'send', disabled: !pk, attrs: { 'aria-describedby': 'gl-call-need' } })]));
      kids.push(H('p', { class: 'hint', id: 'gl-call-need', hidden: !!pk }, T('gl_call_need')));
    } else if (c.state === 'sent') {
      kids.push(H('p', { class: 'gl-call-state' }, [H('span', { class: 'pill' }, T('gl_c_' + c.kind)), ' ', T('gl_call_wait', { name: it.name })]));
      kids.push(H('div', { class: 'actions' }, [btn(T('gl_note_cancel'), 'gl-call-cancel', { id: it.id, kls: 'ghost' })]));
    } else {
      kids.push(H('p', { class: 'gl-call-state' }, [H('span', { class: 'pill' }, T('gl_c_' + c.kind)), ' ', T(c.state === 'ok' ? 'gl_call_ok' : 'gl_call_later')]));
    }
    return H('section', { class: 'gl-sec card gl-block', 'aria-labelledby': 'gl-call-h', 'data-fk': 'gl-call:' + it.id, tabindex: '-1' }, kids);
  }
  function renderDetail(main, it) {
    var u = ui();
    main.textContent = '';
    var meta = [H('span', { class: 'gl-who' }, nameOf(it.name, it.mine)), catChip(it.cat)];
    if (it.mine) meta.push(mineChip());
    if (it.buddy) meta.push(buddyChip());
    var info = [H('h1', { tabindex: '-1', 'data-fk': 'gld-h:' + it.id }, it.title), H('div', { class: 'gl-meta' }, meta)];
    if (it.like) info.push(textBlock(T('like_point'), it.like));
    if (it.craft) info.push(textBlock(T('craft_point'), it.craft));
    if (it.mine) {
      info.push(H('div', { class: 'gl-own-ops' }, [H('a', { class: 'btn small', href: '#works/' + it.workId }, T('gl_open_work')),
        btn(T('gl_take'), 'gl-take', { id: it.workId, arg: 'detail', kls: 'ghost' })]));
    }
    var cols = [reactSec(it), notesSec(it)];
    if (!it.mine) cols.push(callSec(it));
    main.appendChild(H('div', { class: 'gallery-page gl-detail', 'data-item': it.id }, [
      H('p', { class: 'gl-back' }, [H('a', { class: 'link-btn', href: '#gallery', 'data-action': 'gl-back', 'data-id': it.id, 'aria-label': T('gl_back') },
        [H('span', { 'aria-hidden': 'true' }, '←'), H('span', null, T('gallery'))])]),
      H('div', { class: 'gl-dhead' }, [H('figure', { class: 'gl-hero' }, [artEl(it, 'gl-hero-art')]), H('div', { class: 'gl-info' }, info)]),
      H('div', { class: 'gl-dcols' }, cols)
    ]));
    // 詳細を開いたら h1 へ
    if (u.shownDetail !== it.id) { u.shownDetail = it.id; var h = main.querySelector('h1'); if (h) h.focus(); }
  }

  // #gallery を開いた時だけ: 返事と見本の声かけ（G.settle）。変わった時だけ保存して 1 行で知らせる
  function settleOnOpen() {
    var st = S().gallery, next = settle(st, S().works, { seed: GD.items, time: stamp() });
    if (next === st) return;
    S().gallery = next;
    if (!DES.store.save('gallery')) { S().gallery = st; S().saveFailed = true; DES.app.renderSaveState(); return; }
    var newIn = next.inbox.length > st.inbox.length;
    var okN = next.calls.filter(function (c) { return c.state === 'ok'; }).length > st.calls.filter(function (c) { return c.state === 'ok'; }).length;
    DES.app.toast(T(newIn ? 'gl_inbox_toast' : (okN ? 'gl_call_ok' : 'gl_call_later')));
  }
  G.render = function (main, arg) {
    var u = ui();
    if (arg) {
      var it = find(allItems(), arg);
      if (it) renderDetail(main, it);
      else {
        // 無い id は一覧へ（履歴に残さない）+ トースト
        renderList(main);
        if (u.missing !== arg) { u.missing = arg; DES.app.toast(T('gl_not_found')); }
        window.location.replace('#gallery');
      }
    } else {
      if (!u.entered) { u.entered = true; settleOnOpen(); }
      renderList(main);
    }
    if (u.pendingFocus) { var n = main.querySelector('[data-fk="' + esc(u.pendingFocus) + '"]'); if (n) { u.pendingFocus = null; n.focus(); } }
  };
  // ルートが変わったら一時的な UI を閉じる（app.js の closeTransient から）。絞り込みと下書きは残す
  G.resetUi = function () { var u = ui(); u.shownDetail = null; u.missing = null; u.entered = false; u.pick = {}; };

  // ---------- 作品の詳細の節「作品展示」（works.js から。§AF-2 の 1 つずつ） ----------
  G.workBlock = function (w) {
    var st = S().gallery;
    if (isIn(st, w)) {
      return [H('p', { class: 'wb-text' }, T('gl_in', { time: inTime(st, w) })),
        H('div', { class: 'actions' }, [btn(T('gl_take'), 'gl-take', { id: w.id, kls: 'ghost' })])];
    }
    var needDlg = !st.name || w.from === 'capture';
    return [H('div', { class: 'actions' }, [btn(T('gl_put'), 'gl-put', { id: w.id, icon: 'plus', attrs: needDlg ? { 'aria-haspopup': 'dialog' } : null })])];
  };

  // ---------- 保存: 失敗したら save_fail + 画面の状態を戻す ----------
  function setGal(next, o) {
    o = o || {};
    var prev = S().gallery;
    if (next === prev) return true;
    S().gallery = next;
    if (!DES.store.save('gallery')) {
      S().gallery = prev;
      S().saveFailed = true;
      DES.app.renderSaveState();
      DES.app.render();
      refocus(o.sel);
      DES.app.toast(T('save_fail'));
      return false;
    }
    S().saveFailed = false;
    if (o.navigate) { o.navigate(); return true; }
    DES.app.commit(o);
    return true;
  }

  // ---------- ダイアログ（展示での呼び名 / 展示に出す） ----------
  function needName(d) { return d.kind === 'name' || d.kind === 'auto' || (d.kind === 'put' && d.needName); }
  function nameWhy(d) { var t = trim(d.text); return !t ? 'gl_name_empty' : (len(t) > NAME_MAX ? 'gl_name_long' : null); }
  function renderDlg() {
    var d = ui().dlg, dlg = dlgEl();
    if (!d) return;
    var putBack = DES.make.clearDialog(dlg), nn = needName(d), why = nn ? nameWhy(d) : null, w = d.workId ? work(d.workId) : null;
    dlg.setAttribute('aria-labelledby', 'gl-dlg-h');
    dlg.appendChild(H('div', { class: 'dialog-head' }, [H('h2', { id: 'gl-dlg-h' }, T(nn ? 'gl_name_h' : 'gl_put')),
      H('button', { class: 'icon-btn', type: 'button', 'data-action': 'dialog-close', 'aria-label': T('close') }, [icon('close')])]));
    var body = H('div', { class: 'dialog-body' });
    if (w) body.appendChild(H('p', { class: 'gl-dlg-work' }, [H('span', { class: 'gl-text-k' }, T('gl_put')), H('strong', null, w.title)]));
    if (nn) {
      body.appendChild(H('div', { class: 'field' }, [H('label', { for: 'gl-name-in' }, T('gl_name_label')),
        H('input', { id: 'gl-name-in', type: 'text', 'data-ui': 'gl-name', value: d.text, autocomplete: 'off', 'aria-describedby': 'gl-name-hint gl-name-why' })]));
      body.appendChild(H('p', { class: 'hint', id: 'gl-name-hint' }, T('gl_name_hint')));
      body.appendChild(H('p', { class: 'gl-name-why', id: 'gl-name-why', hidden: !why }, why ? T(why) : ''));
    }
    if (d.face) body.appendChild(H('p', { class: 'gl-face' }, T('gl_face')));
    if (d.failed) body.appendChild(H('p', { class: 'dlg-error', role: 'alert' }, T('save_fail')));
    dlg.appendChild(body);
    dlg.appendChild(H('div', { class: 'dialog-footer' }, [
      H('button', { class: 'btn primary', type: 'button', 'data-action': 'gl-dlg-ok', disabled: !!why }, T(d.kind === 'put' ? 'gl_put' : 'gl_name_ok')),
      H('button', { class: 'btn', type: 'button', 'data-action': 'dialog-close' }, T('cancel'))
    ]));
    putBack();
  }
  function openDlg(d, opener) {
    d.failed = false;
    ui().dlg = d;
    renderDlg();
    DES.app.openDialog(dlgEl(), opener);
    var f = dlgEl().querySelector('#gl-name-in') || dlgEl().querySelector('[data-action="gl-dlg-ok"]');
    if (f) { f.focus(); if (f.setSelectionRange && f.value) f.setSelectionRange(f.value.length, f.value.length); }
  }
  // 入力のたびに確定ボタンと理由の 1 行だけ差し替える（フォーカスを動かさない）
  function syncName() {
    var d = ui().dlg;
    if (!d) return;
    var why = nameWhy(d), ok = dlgEl().querySelector('[data-action="gl-dlg-ok"]'), p = document.getElementById('gl-name-why');
    if (ok) ok.disabled = !!why;
    if (p) { p.hidden = !why; p.textContent = why ? T(why) : ''; }
  }

  // ---------- 操作 ----------
  var A = DES.actions = DES.actions || {};
  A['gl-back'] = function (el) { ui().pendingFocus = 'glc:' + el.getAttribute('data-id'); window.location.hash = '#gallery'; };
  A['gl-filter'] = function (el) {
    var c = el.getAttribute('data-arg');
    ui().cat = c === 'all' || GD.CATS.indexOf(c) >= 0 ? c : 'all';
    DES.app.render();
    refocus('[data-action="gl-filter"][data-arg="' + esc(ui().cat) + '"]');
  };
  A['gl-name'] = function (el) { openDlg({ kind: 'name', text: S().gallery.name || '' }, el); };
  // 展示に出す: 呼び名がまだ・写真から入れた作品はダイアログで確かめる。それ以外はその場で出す
  A['gl-put'] = function (el) {
    var w = work(el.getAttribute('data-id')), st = S().gallery;
    if (!w) return;
    if (st.name && w.from !== 'capture') {
      if (setGal(put(st, w.id, stamp()), { sel: '[data-action="gl-take"][data-id="' + esc(w.id) + '"]' })) DES.app.toast(T('gl_put_toast'));
      return;
    }
    openDlg({ kind: 'put', workId: w.id, needName: !st.name, face: w.from === 'capture', text: '' }, el);
  };
  A['gl-dlg-ok'] = function () {
    var u = ui(), d = u.dlg;
    if (!d) return;
    var prev = S().gallery, next = prev;
    if (needName(d)) {
      if (!okName(d.text)) { syncName(); return; }
      next = setName(next, d.text);
    }
    if (d.kind === 'put') { if (!work(d.workId)) return; next = put(next, d.workId, stamp()); }
    if (d.kind === 'auto') next = setAuto(next, true);
    if (next !== prev) {
      S().gallery = next;
      if (!DES.store.save('gallery')) {
        S().gallery = prev;
        S().saveFailed = true;
        d.failed = true;
        DES.app.renderSaveState();
        renderDlg();
        refocus('#gallery-dialog [data-action="gl-dlg-ok"]');
        return;
      }
      S().saveFailed = false;
    }
    var kind = d.kind, wid = d.workId;
    u.dlg = null;
    if (kind === 'put') {
      // 開いた「展示に出す」は消えるので、出した後の「展示から外す」へ
      DES.app.closeDialog(dlgEl(), true);
      DES.app.commit({ sel: '[data-action="gl-take"][data-id="' + esc(wid) + '"]' });
      DES.app.toast(T('gl_put_toast'));
    } else {
      DES.app.closeDialog(dlgEl());
      DES.app.commit({ sel: kind === 'auto' ? '#gl-auto' : '[data-action="gl-name"]' });
      DES.app.toast(kind === 'auto' ? T('gl_auto_on') : T('gl_name_toast', { name: S().gallery.name }));
    }
  };
  // 展示から外す（作品の詳細 / 展示の自分の作品）: 確認は出さず 5 秒の「元に戻す」
  A['gl-take'] = function (el) {
    var wid = el.getAttribute('data-id'), fromDetail = el.getAttribute('data-arg') === 'detail', r = take(S().gallery, wid, stamp());
    if (!r) return;
    var ok = setGal(r.state, fromDetail
      ? { sel: '[data-action="gl-take"]', navigate: function () { ui().pendingFocus = 'gl-h'; window.location.replace('#gallery'); } }
      : { sel: '[data-action="gl-put"][data-id="' + esc(wid) + '"]' });
    if (!ok) return;
    DES.app.toast(T('gl_taken'), { label: T('undo_restore'), fn: function () {
      setGal(restoreTake(S().gallery, r.undo), { sel: fromDetail ? '[data-fk="glc:' + esc(itemId(wid)) + '"]' : '[data-action="gl-take"][data-id="' + esc(wid) + '"]' });
    } });
  };
  A['gl-react'] = function (el) {
    var id = el.getAttribute('data-id'), k = el.getAttribute('data-arg');
    setGal(react(S().gallery, id, k), { sel: '[data-action="gl-react"][data-id="' + esc(id) + '"][data-arg="' + esc(k) + '"]' });
  };
  // ひとことを送る: 「AI が先に読んでいるよ」（1 秒ほど。reduced-motion でも同じ）→ 番人の結果で 届く / サポーターが先に読む
  A['gl-note-send'] = function (el) {
    var id = el.getAttribute('data-id'), u = ui(), text = trim(u.draft[id] || '');
    if (!text || u.sending) return;
    u.sending = { itemId: id };
    DES.app.render();
    refocus('#gl-note');
    setTimeout(function () {
      var cur = ui();
      cur.sending = null;
      var prev = S().gallery, nid = newId('gn'), next = addNote(prev, { id: nid, itemId: id, text: text, time: stamp() });
      var here = DES.app.route() === 'gallery' && DES.app.routeArg() === id;
      if (next === prev) { DES.app.render(); return; }
      S().gallery = next;
      if (!DES.store.save('gallery')) {
        // 下書きは残す（送り直せる）
        S().gallery = prev;
        S().saveFailed = true;
        DES.app.renderSaveState();
        DES.app.render();
        if (here) refocus('#gl-note');
        DES.app.toast(T('save_fail'));
        return;
      }
      S().saveFailed = false;
      cur.draft[id] = '';
      var n = find(next.notes, nid);
      DES.app.commit(here ? { sel: n.state === 'ok' ? '#gl-note' : '[data-fk="gl-held"]' } : {});
      if (!here) return;
      if (n.state === 'ok') { refocus('#gl-note'); DES.app.toast(T('gl_sent')); }
      else refocus('[data-fk="gl-held"]');
    }, 1000);
  };
  A['gl-note-del'] = function (el) {
    var nid = el.getAttribute('data-id'), r = removeNote(S().gallery, nid);
    if (!r) return;
    if (!setGal(r.state, { sel: '#gl-note' })) return;
    refocus('#gl-note');
    DES.app.toast(T('gl_note_canceled'), { label: T('undo_restore'), fn: function () {
      setGal(restoreNote(S().gallery, r.undo), { sel: '[data-action="gl-note-del"][data-id="' + esc(nid) + '"]' });
    } });
  };
  A['gl-call'] = function (el) {
    var id = el.getAttribute('data-id'), k = ui().pick[id];
    if (CALLS.indexOf(k) < 0) return;
    if (setGal(call(S().gallery, { id: newId('gc'), itemId: id, kind: k, time: stamp() }), { sel: '[data-action="gl-call-cancel"][data-id="' + esc(id) + '"]' })) {
      delete ui().pick[id];
      DES.app.toast(T('gl_call_sent'));
    }
  };
  A['gl-call-cancel'] = function (el) {
    var id = el.getAttribute('data-id'), r = cancelCall(S().gallery, id);
    if (!r) return;
    if (!setGal(r.state, { sel: 'input[data-ui="gl-call-pick"][data-id="' + esc(id) + '"]' })) return;
    refocus('input[data-ui="gl-call-pick"][data-id="' + esc(id) + '"]');
    DES.app.toast(T('gl_call_canceled'), { label: T('undo_restore'), fn: function () {
      setGal(restoreCall(S().gallery, r.undo), { sel: '[data-action="gl-call-cancel"][data-id="' + esc(id) + '"]' });
    } });
  };
  A['gl-answer'] = function (el) {
    var id = el.getAttribute('data-id'), ans = el.getAttribute('data-arg'), st = S().gallery, c = find(st.inbox, id), w = c ? work(c.workId) : null;
    if (!c) return;
    var next = answer(st, id, ans, { title: w ? w.title : '', time: stamp() });
    if (setGal(next, { focusFn: function () { return S().gallery.promises.length ? 'gl-promise-h' : 'gl-h'; } })) DES.app.toast(T(ans === 'ok' ? 'gl_inbox_ok_toast' : 'gl_inbox_later_toast'));
  };
  // 先に準備する: 外で作る活動を作って作業台へ（2 回目は同じ活動）。予定表は変えない
  A['gl-prep'] = function (el) {
    var pid = el.getAttribute('data-id'), st = S().gallery, p = find(st.promises, pid), M = DES.make, MD = DES.makeData;
    if (!p) return;
    if (p.actId && act(p.actId)) { M.openAct(p.actId); return; }
    var cat = promiseCat(st, p, S().works, GD.items, S().activities), th = GD.CAT_THEME[cat];
    var r = M.fromPromise(p, { id: newId('a'), title: T('gl_prep_title', { title: p.title }), steps: GD.PREP_STEPS,
      theme: th && MD.THEMES.indexOf(th) >= 0 ? th : 'mc', now: DES.data.now, acts: S().activities });
    if (!r) return;
    var prevA = S().activities, prevG = st;
    if (r.created) S().activities = [r.act].concat(prevA);
    S().gallery = setPromiseAct(prevG, p.id, r.id);
    if (!((r.created ? DES.store.save('activities') : true) && DES.store.save('gallery'))) {
      S().activities = prevA;
      S().gallery = prevG;
      DES.store.save('activities');
      S().saveFailed = true;
      DES.app.renderSaveState();
      DES.app.render();
      refocus('[data-action="gl-prep"][data-id="' + esc(pid) + '"]');
      DES.app.toast(T('save_fail'));
      return;
    }
    S().saveFailed = false;
    if (r.created) window.location.hash = '#make/' + r.id;
    else M.openAct(r.id);
  };

  // ---------- 入力の受け口 ----------
  G.bind = function () {
    document.addEventListener('input', function (e) {
      var t = e.target, k = t && t.getAttribute ? t.getAttribute('data-ui') : null, u = ui();
      if (k === 'gl-note') {
        var fit = fitNote(t.value);
        if (fit !== t.value) t.value = fit;
        var id = t.getAttribute('data-id'), has = !!trim(t.value);
        u.draft[id] = t.value;
        var b = document.querySelector('[data-action="gl-note-send"][data-id="' + esc(id) + '"]'), need = document.getElementById('gl-note-need');
        if (b) b.disabled = !canSend(t.value, u.sending);
        if (need) need.hidden = has || !!u.sending;
      } else if (k === 'gl-name' && u.dlg) { u.dlg.text = t.value; syncName(); }
    });
    document.addEventListener('change', function (e) {
      var t = e.target, k = t && t.getAttribute ? t.getAttribute('data-ui') : null, st = S().gallery;
      if (k === 'gl-auto') {
        if (t.checked && !st.name) { t.checked = false; openDlg({ kind: 'auto', text: '' }, t); return; }
        if (setGal(setAuto(st, t.checked), { sel: '#gl-auto' })) DES.app.toast(T(t.checked ? 'gl_auto_on' : 'gl_auto_off'));
      } else if (k === 'gl-call-pick') {
        var id = t.getAttribute('data-id');
        ui().pick[id] = t.value;
        var b = document.querySelector('[data-action="gl-call"][data-id="' + esc(id) + '"]'), need = document.getElementById('gl-call-need');
        if (b) b.disabled = false;
        if (need) need.hidden = true;
      }
    });
    document.addEventListener('keydown', function (e) {
      var t = e.target, k = t && t.getAttribute ? t.getAttribute('data-ui') : null;
      if (e.key !== 'Enter' || e.isComposing) return;
      if (k === 'gl-note') { e.preventDefault(); var b = document.querySelector('[data-action="gl-note-send"][data-id="' + esc(t.getAttribute('data-id')) + '"]'); if (b && !b.disabled) A['gl-note-send'](b); }
      else if (k === 'gl-name') { e.preventDefault(); A['gl-dlg-ok'](); }
    });
    var dlg = dlgEl();
    if (dlg) dlg.addEventListener('close', function () {
      var tEl = document.getElementById('toast');
      if (tEl && tEl.parentNode === dlg) document.body.appendChild(tEl);
      ui().dlg = null;
      dlg.textContent = '';
    });
  };
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
