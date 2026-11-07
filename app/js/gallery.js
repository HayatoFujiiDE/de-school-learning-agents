/* 作品展示（#gallery 一覧 / #gallery/<itemId> 詳細）: contract-LS §LS-13 / LS-18-15（データ）+ contract-app §AG（見た目・操作）。§W-4 の「見せる」とは別の操作。
   並ぶもの = この端末の自分の作品のうち「展示に出す」をした作品（gallery.mine[workId].state === 'in'）と、自動切替が入で完成にした作品。
   見本の他の人の作品・反応・ひとこと・声かけ・約束は使わない（架空のデータ）。自分の作品なので反応ボタン・声かけは出さない（既存の「自分の作品」の分岐）。
   呼び名・ひとことは利用者の入力なので、必ず DES.h の文字列子要素（textContent）で出す。DES.raw には固定の SVG と検査した写真の img だけを渡す。
   純関数（G.initial / normalize / setName / items / put / take / guard / addNote …）は DOM と DES.t に触れず、node からも読める（tools/live-gallery-test.js）。
   保存は DES.store.register('gallery')（des.live.gallery。失敗したら save_fail + 画面の状態を戻す）。 */
(function (root) {
  'use strict';
  var DES = root.DES = root.DES || {};
  var GD = DES.galleryData || (typeof require === 'function' ? require('./gallery-data.js') : null);
  var G = DES.gallery = DES.gallery || {};
  var KINDS = ['like', 'how', 'try'];
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
  // 全部に at（ISO）があれば at で、1 つでも無ければ 'M/D H:MM' で並べる（2 つの物差しを混ぜない）
  function byTime(list, dir) {
    var allAt = list.every(function (x) { return x && isStr(x.at) && !isNaN(Date.parse(x.at)); });
    return list.map(function (x, i) { return { x: x, i: i, k: allAt ? Date.parse(x.at) : timeKey(x.time) }; })
      .sort(function (a, b) { return dir * (a.k - b.k) || a.i - b.i; }).map(function (o) { return o.x; });
  }
  function newestFirst(list) { return byTime(list, -1); }

  // ---------- 状態（des.live.gallery）: { v, name, auto, mine: { workId: { state: 'in'|'out', at, time } }, notes: [...] } ----------
  function initial() {
    return { v: 2, name: null, auto: false, mine: {}, notes: [] };
  }
  // 呼び名: 前後の空白を取って 1〜12 字なら その文字列、それ以外は null
  function okName(v) { var t = trim(v), n = len(t); return n >= 1 && n <= NAME_MAX ? t : null; }
  function okAt(v) { return v == null || (isStr(v) && v.length <= 40 && !isNaN(Date.parse(v))); }
  function okNote(n) {
    return isObj(n) && isStr(n.id) && !!n.id && isStr(n.itemId) && isStr(n.text) && len(trim(n.text)) >= 1 && len(n.text) <= NOTE_MAX &&
      (n.state === 'ok' || n.state === 'hold') && isStr(n.time) && okAt(n.at);
  }
  function okKey(k) { return isStr(k) && /^[A-Za-z0-9_.:-]{1,80}$/.test(k) && k !== '__proto__' && k !== 'constructor' && k !== 'prototype'; }
  // 読み込んだ値を整える。形が違う項目はその項目だけ初期値（他の項目は残す）
  function normalize(raw) {
    var out = initial();
    if (!isObj(raw)) return out;
    out.name = isStr(raw.name) ? okName(raw.name) : null;
    out.auto = raw.auto === true;
    if (isObj(raw.mine)) {
      Object.keys(raw.mine).forEach(function (k) {
        var m = raw.mine[k];
        if (okKey(k) && isObj(m) && (m.state === 'in' || m.state === 'out') && isStr(m.time) && okAt(m.at)) out.mine[k] = { state: m.state, at: m.at || null, time: m.time };
      });
    }
    var seen = {};
    if (Array.isArray(raw.notes)) raw.notes.forEach(function (n) { if (okNote(n) && !Object.prototype.hasOwnProperty.call(seen, n.id)) { seen[n.id] = true; out.notes.push({ id: n.id, itemId: n.itemId, text: n.text, state: n.state, at: n.at || null, time: n.time }); } });
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

  // ---------- 展示に並ぶもの（§AG-2 / AG-3） ----------
  function catalogCat(id) {
    var d = DES.data, hit = null;
    if (!id || !d || !Array.isArray(d.catalog)) return null;
    d.catalog.forEach(function (c) { (c.items || []).forEach(function (it) { if (it.id === id) hit = c.id; }); });
    return hit && GD.CATS.indexOf(hit) >= 0 ? hit : null;
  }
  // 提案から作った作品（§AE-4。theme 'project'）の種類: 提案のカテゴリ（作品の projectId → 無ければ acts の中の作品の actId の活動の projectId
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
  // 写真から入れた作品（from 'capture'）は自動では出さない（顔や名前が写っていないかを本人が見てから 1 つずつ。§AG-2）
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
  function inAt(state, w) {
    var m = state.mine && state.mine[w.id];
    if (m && m.state === 'in') return m.at || null;
    return isStr(w.createdAt) ? w.createdAt : null;
  }
  // 作品の本物の写真（L2 が作品の images[] に保存する { data, w, h }）。最初の 1 枚。形が違えば null
  var PHOTO_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
  function photoOk(p) { return isObj(p) && isStr(p.data) && p.data.length <= 400 * 1024 && PHOTO_RE.test(p.data) && typeof p.w === 'number' && typeof p.h === 'number' && p.w > 0 && p.h > 0; }
  // 写真の形の検査: ブラウザでは DES.photo.valid（photo.js）、無ければ同じ規則の photoOk
  function validPhoto(p) { var P = DES.photo; return P && typeof P.valid === 'function' ? P.valid(p) && photoOk(p) : photoOk(p); }
  // 作品の images[0] → 無ければ「作品に残す」で残した作品の art.photo（本物の写真 { data, w, h }。theme は無い）
  function firstImage(w) {
    var l = w && Array.isArray(w.images) ? w.images : [];
    for (var i = 0; i < l.length; i++) {
      var p = isObj(l[i]) && isObj(l[i].photo) ? l[i].photo : l[i];
      if (validPhoto(p)) return { data: p.data, w: p.w, h: p.h };
    }
    var ap = w && isObj(w.art) && isObj(w.art.photo) ? w.art.photo : null;
    return ap && validPhoto(ap) ? { data: ap.data, w: ap.w, h: ap.h } : null;
  }
  function itemId(workId) { return MY + workId; }
  function ownItem(state, w, acts) {
    return { id: itemId(w.id), mine: true, workId: w.id, name: state.name, cat: catOf(w, acts), title: w.title, like: w.like || null, craft: w.craft || null,
      buddy: !!(w.roles && w.roles.ai > 0), photo: w.from === 'capture', art: clone(w.art || null), img: firstImage(w), time: inTime(state, w), at: inAt(state, w) };
  }
  // 並ぶもの: この端末の自分の作品のうち出しているものだけ（見本は無い）。新しい順
  function items(state, works, acts) {
    var out = [];
    (works || []).forEach(function (w) { if (w && isStr(w.id) && isIn(state, w)) out.push(ownItem(state, w, acts)); });
    return newestFirst(out);
  }
  function filter(list, cat) { return !cat || cat === 'all' ? list.slice() : list.filter(function (it) { return it.cat === cat; }); }
  // 並んでいる種類（チップ。GD.CATS の順）
  function cats(list) { return GD.CATS.filter(function (c) { return list.some(function (it) { return it.cat === c; }); }); }

  // ---------- 出す・外す（§AG-2） ----------
  function put(state, workId, time, at) {
    if (!okKey(workId)) return state;
    var m = state.mine[workId];
    if (m && m.state === 'in') return state;
    var S = clone(state);
    S.mine[workId] = { state: 'in', at: at || null, time: String(time || '') };
    return S;
  }
  // 外す（自動で並んでいる作品も out にする）+ 元に戻す（前の記録へ）
  function take(state, workId, time, at) {
    if (!okKey(workId)) return null;
    var m = state.mine[workId];
    if (m && m.state === 'out') return null;
    var S = clone(state);
    S.mine[workId] = { state: 'out', at: at || null, time: String(time || '') };
    return { state: S, undo: { workId: workId, prev: m ? clone(m) : null } };
  }
  function restoreTake(state, u) {
    if (!u || !isStr(u.workId)) return state;
    var S = clone(state);
    if (u.prev) S.mine[u.workId] = clone(u.prev); else delete S.mine[u.workId];
    return S;
  }

  // ---------- 番人（§AG-4。モックの決定論）: hold にするのは (a) 語の一覧 (b) 7 けた以上の数字 (c) http・@・住所・電話・LINE (d) 同じ文字 8 回以上 ----------
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

  // ---------- ひとこと（§AG-4）: 80 字で切る・番人の結果を state に持つ ----------
  function addNote(state, o) {
    o = o || {};
    var text = cut(trim(o.text), NOTE_MAX);
    if (!text || !isStr(o.itemId) || !o.itemId || !isStr(o.id) || find(state.notes, o.id)) return state;
    var S = clone(state);
    S.notes.push({ id: o.id, itemId: o.itemId, text: text, state: guard(text), at: o.at || null, time: String(o.time || '') });
    return S;
  }
  // 「送る」を押せるか: 下書きがあり、どの作品のひとことも送信待ちでない時だけ（レビューへの裁定）
  function canSend(draft, sending) { return !!trim(draft) && !sending; }
  // 入力欄の値をコードポイントで 80 字までにする（入力欄も保存も同じ数え方。§AG-4）
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
  // スレッド（自分の作品へのメモのうち ok のもの・古い順）
  function thread(state, id) {
    var out = [];
    (state.notes || []).forEach(function (n) { if (n.itemId === id && n.state === 'ok') out.push({ id: n.id, name: null, mine: true, text: n.text, at: n.at, time: n.time }); });
    return byTime(out, 1);
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
      // 本物の写真（theme が無く data がある）は img として扱う（形を検査してから）
      if (isObj(p) && !isStr(p.theme) && 'data' in p) return photoOk(p) ? art : null;
      return isObj(p) && isStr(p.theme) && (p.n == null || (okNum(p.n) && p.n >= 0)) && (p.cat == null || isStr(p.cat)) && (p.odai == null || isStr(p.odai)) ? art : null;
    }
    if ('stage' in art) return okStage(art.stage) ? art : null;
    return null;
  }

  var pure = {
    initial: initial, normalize: normalize, okName: okName, setName: setName, setAuto: setAuto, items: items, isIn: isIn, inTime: inTime, itemId: itemId,
    catOf: catOf, filter: filter, cats: cats, put: put, take: take, restoreTake: restoreTake, guard: guard, firstImage: firstImage,
    addNote: addNote, removeNote: removeNote, restoreNote: restoreNote, thread: thread, timeKey: timeKey,
    canSend: canSend, fitNote: fitNote, safeArt: safeArt,
    KINDS: KINDS, NAME_MAX: NAME_MAX, NOTE_MAX: NOTE_MAX
  };
  Object.keys(pure).forEach(function (k) { G[k] = pure[k]; });
  if (typeof module !== 'undefined' && module.exports) module.exports = pure;
  if (typeof document === 'undefined') return;

  // ======================================================================
  // ここから下はブラウザ専用
  // ======================================================================

  // ---------- 保存（LS-2）: des.live.gallery。形の検査で normalize した値に置き換える（部分の形違いはその項目だけ初期値） ----------
  if (DES.store && DES.store.register) {
    DES.store.register('gallery', function (v) {
      if (!isObj(v)) return false;
      var n = normalize(v);
      Object.keys(v).forEach(function (k) { delete v[k]; });
      Object.keys(n).forEach(function (k) { v[k] = n[k]; });
      return true;
    }, initial);
  }
  // ---------- 文言（LS-13 の verbatim） ----------
  if (DES.i18n && DES.i18n.add) {
    DES.i18n.add({
      gl_local_note: ['今はこの端末の作品だけが並ぶよ。教室のみんなの作品が並ぶ仕組みはこれから', 'いまはこの たんまつの作品だけがならぶよ。きょうしつのみんなの作品がならぶしくみはこれから']
    });
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
    if (!u.gl) u.gl = { cat: 'all', draft: {}, sending: null, dlg: null, shownDetail: null, missing: null, pendingFocus: null };
    return u.gl;
  }
  function dlgEl() { return document.getElementById('gallery-dialog'); }
  function work(id) { return find(S().works || [], id); }
  // 表示の時刻 'M/D H:MM'（DES.clock の今日と今から）/ 記録の時刻 at（ISO）
  function stamp() { var p = DES.clock.today().split('-'), t = DES.clock.now().split(':'); return (+p[1]) + '/' + (+p[2]) + ' ' + (+t[0]) + ':' + t[1]; }
  function iso() { return DES.clock.iso(); }
  function newId(p) { return DES.plan.newId(p); }
  function refocus(sel) { var n = sel ? document.querySelector(sel) : null; if (n) n.focus(); }
  function allItems() { return items(S().gallery, S().works, S().activities); }
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

  // ---------- 絵: 作品の本物の写真 → 作品の絵（メモ・写真の線画・題材の線画）→ 種類の線画 ----------
  // 保存された絵の形が違う時・絵を作る途中で例外が出た時は、種類の線画に替える（例外で止めない）
  function workArt(raw, cat) {
    var MD = DES.makeData, art = safeArt(raw), svg = '';
    if (art && art.note) {
      return [H('div', { class: 'work-note gl-note-art' }, [H('p', { class: 'wn-title' }, pick(art.note.title)),
        H('ul', null, art.note.lines.map(function (l) { return H('li', null, pick(l)); }))])];
    }
    if (art && art.photo && photoOk(art.photo)) return [H('img', { src: art.photo.data, alt: '', decoding: 'async' })];
    try { svg = art && art.photo && MD ? MD.photoArt(art.photo) : (art && art.stage && MD ? MD.art(art.stage) : ''); } catch (e) { svg = ''; }
    return [DES.raw(svg || GD.lineArt(cat))];
  }
  function artEl(it, cls) {
    var box = H('div', { class: 'gl-art' + (cls ? ' ' + cls : '') });
    if (it.img && photoOk(it.img)) {
      // data URL は検査済み（PHOTO_RE）。src は属性として入れる（文字列の HTML として組み立てない）
      box.classList.add('has-img');
      box.appendChild(H('img', { src: it.img.data, alt: it.title, decoding: 'async' }));
      return box;
    }
    workArt(it.art, it.cat).forEach(function (n) { box.appendChild(n); });
    return box;
  }

  // ---------- 一覧（§AG-3） ----------
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
  function renderList(main) {
    var u = ui(), st = S().gallery, list = allItems(), cs = cats(list);
    if (u.cat !== 'all' && cs.indexOf(u.cat) < 0) u.cat = 'all';
    var shown = filter(list, u.cat);
    main.textContent = '';
    var nameRow = st.name ? H('div', { class: 'gl-name' }, [H('span', { class: 'gl-name-k' }, T('gl_name_label')), H('strong', null, st.name),
      btn(T('gl_name_change'), 'gl-name', { kls: 'ghost', attrs: { 'aria-haspopup': 'dialog' } })]) : null;
    var kids = [
      H('div', { class: 'page-head gl-page-head' }, [
        H('div', null, [H('h1', { tabindex: '-1', 'data-fk': 'gl-h' }, T('gallery')), H('p', null, T('gl_sub')), H('p', { class: 'gl-sub2' }, T('gl_sub2')),
          H('p', { class: 'gl-sub2 gl-local-note' }, T('gl_local_note'))]),
        nameRow
      ]),
      H('label', { class: 'gl-auto', for: 'gl-auto' }, [H('input', { type: 'checkbox', id: 'gl-auto', 'data-ui': 'gl-auto', checked: st.auto === true, 'aria-describedby': 'gl-auto-capture' }), H('span', null, T('gl_auto'))]),
      // 切替の下の 1 行（§AG-2）: 写真から入れた作品は自動では出さない
      H('p', { class: 'hint gl-auto-note', id: 'gl-auto-capture' }, T('gl_auto_capture'))
    ];
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

  // ---------- 詳細（§AG-4 / AG-5） ----------
  function textBlock(label, text) { return H('div', { class: 'gl-text' }, [H('p', { class: 'gl-text-k' }, label), H('p', { class: 'gl-text-v' }, text)]); }
  // 反応: 自分の作品なのでボタンは出さない（既存の「自分の作品」の分岐）。届く仕組みが無いので、届いた反応の列も空
  function reactSec() {
    return H('section', { class: 'gl-sec card gl-block', 'aria-labelledby': 'gl-react-h' }, [H('h2', { id: 'gl-react-h' }, T('gl_react_h')), H('p', { class: 'wb-empty' }, T('gl_react_none'))]);
  }
  function notesSec(it) {
    var u = ui(), st = S().gallery, th = thread(st, it.id), sending = !!(u.sending && u.sending.itemId === it.id);
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
        // 字数はコードポイントで数える（UTF-16 で数える入力欄の上限の属性は使わず、入力のたびに fitNote で切る。§AG-4）
        H('input', { id: 'gl-note', type: 'text', 'data-ui': 'gl-note', 'data-id': it.id, value: draft, autocomplete: 'off',
          readonly: sending, 'aria-busy': sending ? 'true' : null, 'aria-describedby': 'gl-note-need' }),
        btn(T('gl_note_send'), 'gl-note-send', { id: it.id, kls: 'primary', icon: 'send', disabled: dis })
      ]),
      H('p', { class: 'hint', id: 'gl-note-need', hidden: !!trim(draft) || sending }, T('gl_note_need')),
      H('p', { class: 'gl-reading', role: 'status' }, sending ? T('gl_reading') : '')
    ]));
    return H('section', { class: 'gl-sec card gl-block', 'aria-labelledby': 'gl-notes-h' }, kids);
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
    info.push(H('div', { class: 'gl-own-ops' }, [H('a', { class: 'btn small', href: '#works/' + it.workId }, T('gl_open_work')),
      btn(T('gl_take'), 'gl-take', { id: it.workId, arg: 'detail', kls: 'ghost' })]));
    var cols = [reactSec(it), notesSec(it)];
    main.appendChild(H('div', { class: 'gallery-page gl-detail', 'data-item': it.id }, [
      H('p', { class: 'gl-back' }, [H('a', { class: 'link-btn', href: '#gallery', 'data-action': 'gl-back', 'data-id': it.id, 'aria-label': T('gl_back') },
        [H('span', { 'aria-hidden': 'true' }, '←'), H('span', null, T('gallery'))])]),
      H('div', { class: 'gl-dhead' }, [H('figure', { class: 'gl-hero' }, [artEl(it, 'gl-hero-art')]), H('div', { class: 'gl-info' }, info)]),
      H('div', { class: 'gl-dcols' }, cols)
    ]));
    // 詳細を開いたら h1 へ
    if (u.shownDetail !== it.id) { u.shownDetail = it.id; var h = main.querySelector('h1'); if (h) h.focus(); }
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
    } else renderList(main);
    if (u.pendingFocus) { var n = main.querySelector('[data-fk="' + esc(u.pendingFocus) + '"]'); if (n) { u.pendingFocus = null; n.focus(); } }
  };
  // ルートが変わったら一時的な UI を閉じる（app.js の closeTransient から）。絞り込みと下書きは残す
  G.resetUi = function () { var u = ui(); u.shownDetail = null; u.missing = null; };

  // ---------- 作品の詳細の節「作品展示」（works.js から。§AG-2 の 1 つずつ） ----------
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
      if (setGal(put(st, w.id, stamp(), iso()), { sel: '[data-action="gl-take"][data-id="' + esc(w.id) + '"]' })) DES.app.toast(T('gl_put_toast'));
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
    if (d.kind === 'put') { if (!work(d.workId)) return; next = put(next, d.workId, stamp(), iso()); }
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
    var wid = el.getAttribute('data-id'), fromDetail = el.getAttribute('data-arg') === 'detail', r = take(S().gallery, wid, stamp(), iso());
    if (!r) return;
    var ok = setGal(r.state, fromDetail
      ? { sel: '[data-action="gl-take"]', navigate: function () { ui().pendingFocus = 'gl-h'; window.location.replace('#gallery'); } }
      : { sel: '[data-action="gl-put"][data-id="' + esc(wid) + '"]' });
    if (!ok) return;
    DES.app.toast(T('gl_taken'), { label: T('undo_restore'), fn: function () {
      setGal(restoreTake(S().gallery, r.undo), { sel: fromDetail ? '[data-fk="glc:' + esc(itemId(wid)) + '"]' : '[data-action="gl-take"][data-id="' + esc(wid) + '"]' });
    } });
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
      var prev = S().gallery, nid = newId('gn'), next = addNote(prev, { id: nid, itemId: id, text: text, at: iso(), time: stamp() });
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
