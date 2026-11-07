/* 自己理解（#self）— docs/plans/self-page/contract-V.md。
   文言とデータは DES.selfData（self-data.js）だけから引く。本人の文・データ文は textContent で描く。
   状態: localStorage 'des3.self'（try/catch。失敗時はメモリで続ける）。
   純関数 DES.self.reduce(state, action) / DES.self.validate(raw) は DOM に触らない（node の vm で読める）。 */
window.DES = window.DES || {};
(function () {
  'use strict';
  var KEY = 'des3.self';
  var SELF = window.DES.self = {};
  var HAIRS = ['h1', 'h2', 'h3', 'none'], COLORS = ['c1', 'c2', 'c3', 'c4'];
  var RX = ['pending', 'agreed', 'edited', 'away'];
  var IDEA_ST = ['trying', 'result', 'away'], IDEA_RES = ['fit', 'meh', 'adjust'], IDEA_PREV = ['idle', 'trying', 'result'];
  var MAXLEN = 200;

  function DS() { return window.DES; }
  function SD() { return DS().selfData; }
  function curMode() { var D = DS(); return D.mode ? D.mode() : 'js'; }
  function fmt(s, vars) {
    return String(s).replace(/\{(\w+)\}/g, function (all, k) { return vars && vars[k] != null ? String(vars[k]) : all; });
  }
  // 文言（js / es）を表示モードで引く。文字列はそのまま（本人の言葉・記録は 1 通り）
  function ST(o, vars) {
    if (o == null) return '';
    var v = typeof o === 'string' ? o : (o[curMode()] != null ? o[curMode()] : o.js);
    return vars ? fmt(v, vars) : String(v);
  }
  function TX(k, vars) { return ST(SD().text[k], vars); }
  function KX(k, vars) { return ST(SD().kufu[k], vars); }

  // ---------- 純粋な部分（データの参照・形の検査・状態遷移） ----------
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function isStr(v) { return typeof v === 'string'; }
  function isInt(v) { return typeof v === 'number' && Math.floor(v) === v; }
  function isVer(v) { return isObj(v) && isStr(v.text) && isStr(v.at); }
  // 保存値から来る id は data-* と selector に入るため、形を絞る（改行・引用符などを通さない）
  var ID_RE = /^[A-Za-z0-9_-]{1,64}$/, KEY_RE = /^[a-z]+:[A-Za-z0-9_-]{1,64}$/;
  function isId(v) { return isStr(v) && ID_RE.test(v); }
  function cpVer(v) { return { text: v.text, at: v.at }; }
  function clean(t) { return String(t == null ? '' : t).replace(/^\s+|\s+$/g, '').slice(0, MAXLEN); }
  function today() {
    var d = DS().data, t = d && d.today;
    return isStr(t) && t.length >= 10 ? t.slice(5, 10) : (SD() && SD().asOf) || '01-01';
  }
  // 新しい id は dispatch 側で作って action に入れる（reduce は時刻・連番を読まない。V-10 の 3）
  var seq = 0;
  function newId() { seq += 1; return 'n' + Date.now().toString(36) + '-' + seq; }
  SELF.newId = newId;

  function items() { return (SD() && SD().items) || []; }
  function itemById(id) { var a = items(); for (var i = 0; i < a.length; i++) if (a[i].id === id) return a[i]; return null; }
  function isAi(id) { var it = itemById(id); return !!(it && it.src === 'ai' && it.kind !== 'door'); }
  function isDoor(id) { var it = itemById(id); return !!(it && it.kind === 'door'); }
  function bothTexts(t) { return isStr(t) ? [t] : [t.js, t.es]; }
  function axisById(id) { var a = (SD() && SD().axes) || []; for (var i = 0; i < a.length; i++) if (a[i].id === id) return a[i]; return null; }
  function dataScenes() { return (SD() && SD().kufu && SD().kufu.scenes) || []; }
  function dataScene(id) { var a = dataScenes(); for (var i = 0; i < a.length; i++) if (a[i].id === id) return a[i]; return null; }
  function dataIdea(id) {
    var a = dataScenes();
    for (var i = 0; i < a.length; i++) for (var j = 0; j < a[i].ideas.length; j++) if (a[i].ideas[j].id === id) return { idea: a[i].ideas[j], scene: a[i] };
    return null;
  }
  function findBy(arr, id) { for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i]; return null; }

  function defaults() {
    var a = (SD() && SD().avatar && SD().avatar.initial) || { hair: 'h1', color: 'c1' };
    return { v: 1, avatar: { hair: a.hair, color: a.color }, rx: {}, notes: [], door: {}, kufu: { scenes: [], ideas: {}, own: [] }, log: [], draft: null };
  }

  // 形の違うキーは捨てて既定に戻す（壊れた JSON でも画面が出る）
  SELF.validate = function (raw) {
    var s = defaults(), v = raw;
    if (isStr(v)) { try { v = JSON.parse(v); } catch (e) { return s; } }
    if (!isObj(v)) return s;
    if (isObj(v.avatar) && HAIRS.indexOf(v.avatar.hair) >= 0 && COLORS.indexOf(v.avatar.color) >= 0) s.avatar = { hair: v.avatar.hair, color: v.avatar.color };
    if (isObj(v.rx)) Object.keys(v.rx).forEach(function (k) {
      var r = v.rx[k];
      if (!isId(k) || !isObj(r) || RX.indexOf(r.state) < 0 || !Array.isArray(r.vers) || !r.vers.every(isVer)) return;
      if (!isInt(r.cur) || r.cur < -1 || r.cur >= r.vers.length) return;
      if (r.state === 'edited' && r.cur < 0) return;
      s.rx[k] = { state: r.state, vers: r.vers.map(cpVer), cur: r.cur };
    });
    if (Array.isArray(v.notes)) v.notes.forEach(function (n) {
      if (!isObj(n) || !isId(n.id) || !axisById(n.axis)) return;
      if (!(n.group == null || isId(n.group)) || !(n.on == null || isId(n.on))) return;
      if (!Array.isArray(n.vers) || !n.vers.length || !n.vers.every(isVer)) return;
      if (!isInt(n.cur) || n.cur < 0 || n.cur >= n.vers.length || typeof n.gone !== 'boolean') return;
      s.notes.push({ id: n.id, axis: n.axis, group: n.group == null ? null : n.group, on: n.on == null ? null : n.on, vers: n.vers.map(cpVer), cur: n.cur, gone: n.gone });
    });
    if (isObj(v.door)) Object.keys(v.door).forEach(function (k) { if (isId(k) && (v.door[k] === 'added' || v.door[k] === 'not_now')) s.door[k] = v.door[k]; });
    if (isObj(v.kufu)) {
      var k = v.kufu;
      if (Array.isArray(k.scenes)) k.scenes.forEach(function (x) {
        if (isObj(x) && isId(x.id) && isStr(x.text) && isStr(x.at) && typeof x.gone === 'boolean') s.kufu.scenes.push({ id: x.id, text: x.text, at: x.at, gone: x.gone });
      });
      if (isObj(k.ideas)) Object.keys(k.ideas).forEach(function (id) {
        var e = k.ideas[id];
        if (!isId(id) || !isObj(e) || IDEA_ST.indexOf(e.status) < 0 || !(e.result === null || IDEA_RES.indexOf(e.result) >= 0) || !isStr(e.note) || !isStr(e.at)) return;
        if (!(e.text == null || isStr(e.text))) return;
        if (!(e.prev == null || IDEA_PREV.indexOf(e.prev) >= 0)) return;
        s.kufu.ideas[id] = { status: e.status, result: e.result, note: e.note, at: e.at, text: e.text == null ? null : e.text };
        if (e.status === 'away' && e.prev) s.kufu.ideas[id].prev = e.prev;
      });
      if (Array.isArray(k.own)) k.own.forEach(function (x) {
        if (isObj(x) && isId(x.id) && isId(x.scene) && isStr(x.text) && isStr(x.at) && typeof x.gone === 'boolean') s.kufu.own.push({ id: x.id, scene: x.scene, text: x.text, at: x.at, gone: x.gone });
      });
    }
    if (Array.isArray(v.log)) v.log.forEach(function (l) {
      if (isObj(l) && isId(l.id) && isId(l.item) && isStr(l.act) && isStr(l.text) && isStr(l.at)) s.log.push({ id: l.id, item: l.item, act: l.act, text: l.text, at: l.at });
    });
    if (isObj(v.draft) && isStr(v.draft.target) && KEY_RE.test(v.draft.target) && isStr(v.draft.mode) && isStr(v.draft.text)) s.draft = { target: v.draft.target, mode: v.draft.mode, text: v.draft.text.slice(0, MAXLEN) };
    return s;
  };

  function rxGet(s, id) { return s.rx[id] || { state: 'pending', vers: [], cur: -1 }; }
  var curLid = null;
  function logPush(s, item, act, text, at) {
    s.log.push({ id: curLid || ('l' + s.log.length + '-' + item), item: item, act: act, text: text || '', at: at });
    if (s.log.length > 300) s.log.splice(0, s.log.length - 300);
  }
  // 工夫の状態: 保存した値 > データの seed > idle（null）
  function ideaCur(s, id) {
    var e = s.kufu.ideas[id];
    if (e) return e;
    var d = dataIdea(id);
    if (d && d.idea.seed) return { status: d.idea.seed.status, result: d.idea.seed.result, note: '', at: d.idea.seed.at, text: null, seeded: true };
    return null;
  }
  function ideaKnown(s, id) { var o = findBy(s.kufu.own, id); return !!dataIdea(id) || !!(o && !o.gone); }
  function ideaBase(s, id) {
    var e = s.kufu.ideas[id];
    if (e && e.text) return [e.text];
    var o = findBy(s.kufu.own, id);
    if (o) return [o.text];
    var d = dataIdea(id);
    return d ? bothTexts(d.idea.text) : [];
  }
  function sceneKnown(s, id) { var o = findBy(s.kufu.scenes, id); return !!dataScene(id) || !!(o && !o.gone); }

  // 1 つの遷移を s（複製）に当てる。変化が無ければ false
  function step(s, a, at) {
    var r, t, n, e, x, vers;
    switch (a.type) {
      case 'agree':
        if (!isAi(a.id)) return false;
        r = rxGet(s, a.id);
        if (r.state !== 'pending' && r.state !== 'edited') return false;
        s.rx[a.id] = { state: 'agreed', vers: r.vers, cur: -1 };
        logPush(s, a.id, 'agree', '', at);
        return true;
      case 'fix':
        if (!isAi(a.id)) return false;
        r = rxGet(s, a.id);
        if (r.state === 'away') return false;
        t = clean(a.text);
        if (!t) return false;
        if ((r.state === 'edited' ? [r.vers[r.cur].text] : bothTexts(itemById(a.id).text)).indexOf(t) >= 0) return false;
        vers = r.vers.concat([{ text: t, at: at }]);
        s.rx[a.id] = { state: 'edited', vers: vers, cur: vers.length - 1 };
        logPush(s, a.id, 'fix', t, at);
        return true;
      case 'away':
        if (!isAi(a.id)) return false;
        r = rxGet(s, a.id);
        if (r.state === 'away') return false;
        s.rx[a.id] = { state: 'away', vers: r.vers, cur: r.cur };
        logPush(s, a.id, 'away', '', at);
        return true;
      case 'back':
        r = s.rx[a.id];
        if (!r || r.state !== 'away') return false;
        s.rx[a.id] = { state: 'pending', vers: r.vers, cur: -1 };
        logPush(s, a.id, 'back', '', at);
        return true;
      case 'toAi':
        r = s.rx[a.id];
        if (!r || (r.state !== 'agreed' && r.state !== 'edited')) return false;
        s.rx[a.id] = { state: 'pending', vers: r.vers, cur: -1 };
        logPush(s, a.id, 'toAi', '', at);
        return true;
      case 'use':
        r = s.rx[a.id];
        if (!r || !isInt(a.cur) || a.cur < -1 || a.cur >= r.vers.length) return false;
        if (a.cur === -1) {
          if (r.state === 'pending') return false;
          s.rx[a.id] = { state: 'pending', vers: r.vers, cur: -1 };
          logPush(s, a.id, 'toAi', '', at);
        } else {
          if (r.state === 'edited' && r.cur === a.cur) return false;
          s.rx[a.id] = { state: 'edited', vers: r.vers, cur: a.cur };
          logPush(s, a.id, 'use', r.vers[a.cur].text, at);
        }
        return true;
      case 'noteAdd':
        t = clean(a.text);
        if (!t || !axisById(a.axis)) return false;
        s.notes.push({ id: isId(a.nid) ? a.nid : 'note' + s.notes.length, axis: a.axis, group: isStr(a.group) ? a.group : null, on: isStr(a.on) ? a.on : null, vers: [{ text: t, at: at }], cur: 0, gone: false });
        return true;
      case 'noteEdit':
        n = findBy(s.notes, a.id);
        t = clean(a.text);
        if (!n || n.gone || !t || t === n.vers[n.cur].text) return false;
        n.vers.push({ text: t, at: at });
        n.cur = n.vers.length - 1;
        return true;
      case 'noteDel':
        n = findBy(s.notes, a.id);
        if (!n || n.gone) return false;
        n.gone = true;
        return true;
      case 'door':
        if (!isDoor(a.id) || (a.val !== 'added' && a.val !== 'not_now') || s.door[a.id] === a.val) return false;
        s.door[a.id] = a.val;
        logPush(s, a.id, 'door_' + a.val, '', at);
        return true;
      case 'doorBack':
        if (!s.door[a.id]) return false;
        delete s.door[a.id];
        logPush(s, a.id, 'back', '', at);
        return true;
      case 'try':
        if (!ideaKnown(s, a.id)) return false;
        e = ideaCur(s, a.id);
        if (e && (e.status === 'trying' || e.status === 'away')) return false;
        s.kufu.ideas[a.id] = { status: 'trying', result: null, note: '', at: at, text: (e && e.text) || null };
        return true;
      case 'result':
        e = ideaCur(s, a.id);
        if (!e || e.status !== 'trying' || (a.result !== 'fit' && a.result !== 'meh')) return false;
        s.kufu.ideas[a.id] = { status: 'result', result: a.result, note: a.note != null ? clean(a.note) : (e.note || ''), at: at, text: e.text || null };
        return true;
      case 'adjust':
        e = ideaCur(s, a.id);
        t = clean(a.text);
        if (!e || e.status !== 'trying' || !t || ideaBase(s, a.id).indexOf(t) >= 0) return false;
        s.kufu.ideas[a.id] = { status: 'trying', result: 'adjust', note: a.note != null ? clean(a.note) : (e.note || ''), at: at, text: t };
        return true;
      case 'ideaNote':
        // 結果のひとことを入力中に保存する（試し中だけ。少し変える の編集欄に移っても残る）
        e = s.kufu.ideas[a.id];
        if (!e || e.status !== 'trying') return false;
        t = clean(a.note);
        if (t === e.note) return false;
        e.note = t;
        return true;
      case 'ideaAway':
        if (!ideaKnown(s, a.id)) return false;
        e = ideaCur(s, a.id);
        if (e && e.status === 'away') return false;
        // 今はいい: 結果・ひとこと・直した文は持ったまま外す（もどすで戻せるように）
        s.kufu.ideas[a.id] = { status: 'away', result: e ? e.result : null, note: (e && e.note) || '', at: at, text: (e && e.text) || null, prev: e ? e.status : 'idle' };
        return true;
      case 'ideaBack':
        // もどす: 結果があれば結果へ、直した文・ひとことがあれば試し中へ、何も無ければ idle へ
        e = s.kufu.ideas[a.id];
        if (!e || e.status !== 'away') return false;
        // 外す前の状態（prev）があればそこへ戻す。古い保存値で prev が無いときは中身から決める
        if (e.prev === 'idle') delete s.kufu.ideas[a.id];
        else if (e.prev === 'result' && (e.result === 'fit' || e.result === 'meh')) s.kufu.ideas[a.id] = { status: 'result', result: e.result, note: e.note, at: e.at, text: e.text };
        else if (e.prev === 'trying') s.kufu.ideas[a.id] = { status: 'trying', result: e.result === 'adjust' ? 'adjust' : null, note: e.note, at: e.at, text: e.text };
        else if (e.result === 'fit' || e.result === 'meh') s.kufu.ideas[a.id] = { status: 'result', result: e.result, note: e.note, at: e.at, text: e.text };
        else if (e.result === 'adjust' || e.text || e.note) s.kufu.ideas[a.id] = { status: 'trying', result: e.result, note: e.note, at: e.at, text: e.text };
        else delete s.kufu.ideas[a.id];
        return true;
      case 'sceneAdd':
        t = clean(a.text);
        if (!t) return false;
        s.kufu.scenes.push({ id: isId(a.nid) ? a.nid : 'scene' + s.kufu.scenes.length, text: t, at: at, gone: false });
        return true;
      case 'sceneEdit':
        x = findBy(s.kufu.scenes, a.id);
        t = clean(a.text);
        if (!x || x.gone || !t || t === x.text) return false;
        x.text = t;
        return true;
      case 'sceneDel':
        x = findBy(s.kufu.scenes, a.id);
        if (!x || x.gone) return false;
        x.gone = true;
        return true;
      case 'ownAdd':
        t = clean(a.text);
        if (!t || !sceneKnown(s, a.scene)) return false;
        s.kufu.own.push({ id: isId(a.nid) ? a.nid : 'own' + s.kufu.own.length, scene: a.scene, text: t, at: at, gone: false });
        return true;
      case 'ownEdit':
        x = findBy(s.kufu.own, a.id);
        t = clean(a.text);
        if (!x || x.gone || !t || t === x.text) return false;
        x.text = t;
        if (s.kufu.ideas[a.id]) s.kufu.ideas[a.id].text = null;
        return true;
      case 'ownDel':
        x = findBy(s.kufu.own, a.id);
        if (!x || x.gone) return false;
        x.gone = true;
        return true;
      case 'avatar':
        if (HAIRS.indexOf(a.hair) < 0 || COLORS.indexOf(a.color) < 0) return false;
        if (s.avatar.hair === a.hair && s.avatar.color === a.color) return false;
        s.avatar = { hair: a.hair, color: a.color };
        return true;
      case 'draft':
        if (a.draft === null) { if (s.draft === null) return false; s.draft = null; return true; }
        if (!isObj(a.draft) || !isStr(a.draft.target) || !KEY_RE.test(a.draft.target) || !isStr(a.draft.mode) || !isStr(a.draft.text)) return false;
        s.draft = { target: a.draft.target, mode: a.draft.mode, text: a.draft.text.slice(0, MAXLEN) };
        return true;
    }
    return false;
  }

  // 戻す（undo）は操作前の状態へ丸ごと戻す（その履歴行も消える）
  SELF.reduce = function (state, a) {
    if (!isObj(a) || !isStr(a.type)) return state;
    if (a.type === 'undo') return SELF.validate(a.prev);
    var s = SELF.validate(state);
    curLid = isId(a.lid) ? a.lid : null;
    // 日付は action から（dispatch が必ず入れる）。無い action には日付を付けない
    var changed = step(s, a, isStr(a.at) ? a.at : '');
    curLid = null;
    return changed ? s : state;
  };

  // ---------- 表示の部品 ----------
  if (typeof document === 'undefined') return;

  var st = null;
  var ui = { open: null, edit: null, fold: {}, awayOpen: {}, hist: null, reply: null, flash: null, kmenu: null, howwas: null, rnote: {}, kfold: {}, focus: null, restore: true, pick: null, failed: {} };
  SELF.ui = ui;
  SELF.state = function () { return st; };

  function H() { return DS().h.apply(null, arguments); }
  function raw(s) { return DS().raw(s); }
  function icon(n) { return raw(DS().icon(n)); }
  // 本ページだけで使うアイコン（24 viewBox・線画。contract-V §V-4）
  var LOCAL_ICONS = { pin: 'M12 21s7-6 7-11a7 7 0 1 0-14 0c0 5 7 11 7 11z M12 10h.01', pen: 'M4 20h4L19 9l-4-4L4 16v4z' };
  function licon(n) { return raw('<svg class="ico" aria-hidden="true" viewBox="0 0 24 24"><path d="' + LOCAL_ICONS[n] + '"/></svg>'); }
  var KIND_ICON = { ai: function () { return icon('spark'); }, env: function () { return licon('pin'); }, tool: function () { return icon('make'); }, self: function () { return licon('pen'); } };
  function bud(size, mood) { return raw(DS().buddy(size, mood)); }
  // 引用符つき属性値の selector 用（改行・引用符・\ をエスケープ）
  function q(v) { return window.CSS && CSS.escape ? CSS.escape(String(v)) : String(v).replace(/[\\"]/g, '\\$&').replace(/[\n\r\f]/g, ' '); }
  function md(d, time) {
    if (!isStr(d)) return '';
    var p = d.split('-'), s = (+p[0]) + '/' + (+p[1]);
    return time ? s + ' ' + time : s;
  }
  function onSelf() { var A = DS().app; return !!(A && A.route && A.route() === 'self'); }

  function load() {
    var r = null, failed = false;
    try { r = window.localStorage.getItem(KEY); } catch (e) { failed = true; }
    st = SELF.validate(r);
    if (failed) markFail();
  }
  function markFail() {
    var D = DS();
    if (D.state) D.state.saveFailed = true;
    if (D.app && D.app.renderSaveState) D.app.renderSaveState();
  }
  function persist() {
    try { window.localStorage.setItem(KEY, JSON.stringify(st)); return true; } catch (e) { markFail(); return false; }
  }
  function rerender() { if (onSelf()) DS().app.render(); }
  function setDraft(d) { var n = SELF.reduce(st, { type: 'draft', draft: d }); if (n !== st) { st = n; persist(); } }

  // 状態を変える唯一の経路: reduce → 保存 → 再描画 → トースト（戻す 5 秒）
  function dispatch(action, o) {
    o = o || {};
    if (!isStr(action.at)) action.at = today();
    if (!isStr(action.lid)) action.lid = newId();
    var prev = st, next = SELF.reduce(st, action);
    if (next === st) return false;
    // 残した編集欄の下書きは同じ変更で消す。戻すは下書きごと操作前へ戻す
    if (o.clearDraft && next.draft && next.draft.target === o.clearDraft) next = SELF.reduce(next, { type: 'draft', draft: null });
    st = next;
    persist();
    ui.reply = o.reply || null;
    ui.flash = o.flash || null;
    if (o.focus) ui.focus = o.focus;
    rerender();
    if (o.toast) {
      var undo = o.noUndo ? null : {
        label: TX('undo'),
        fn: function () {
          st = SELF.reduce(st, { type: 'undo', prev: prev });
          persist();
          ui.reply = null; ui.open = null; ui.edit = null; ui.hist = null; ui.kmenu = null; ui.howwas = null;
          ui.restore = true;
          ui.flash = o.flash || null;
          ui.focus = o.clearDraft && prev.draft && prev.draft.target === o.clearDraft && o.clearDraft.indexOf('rnote:') !== 0 ? 'ta:' + o.clearDraft : (o.undoFocus || o.focus || null);
          rerender();
        }
      };
      DS().app.toast(o.toast, undo);
    }
    return true;
  }

  // ---------- 読み取り ----------
  function rxOf(id) { return st.rx[id] || { state: 'pending', vers: [], cur: -1 }; }
  function aiText(it) { var r = rxOf(it.id); return r.state === 'edited' ? r.vers[r.cur].text : ST(it.text); }
  function itemText(it) { return it.src === 'ai' ? aiText(it) : ST(it.text); }
  function isAwayItem(it) { return it.src === 'ai' && (it.kind === 'door' ? st.door[it.id] === 'not_now' : rxOf(it.id).state === 'away'); }
  function notesOn(on) { return st.notes.filter(function (n) { return !n.gone && n.on === on; }); }
  function notesGroup(axis, group) { return st.notes.filter(function (n) { return !n.gone && n.on === null && n.axis === axis && n.group === group; }); }
  function noteText(n) { return n.vers[n.cur].text; }
  function lastLog(id, act) { for (var i = st.log.length - 1; i >= 0; i--) if (st.log[i].item === id && st.log[i].act === act) return st.log[i]; return null; }
  function ownScene(id) { return findBy(st.kufu.scenes, id); }
  function sceneText(id) { var d = dataScene(id); if (d) return d.text; var o = ownScene(id); return o ? o.text : ''; }
  // 「自分に合う工夫」の場面名: 場面の文の最初の「、」まで（末尾の「で」を落とす）
  function sceneName(id) { var t = sceneText(id), i = t.indexOf('、'); if (i > 0) t = t.slice(0, i); return t.replace(/で$/, ''); }
  function ideaState(id) { return ideaCur(st, id) || { status: 'idle', result: null, note: '', at: '', text: null }; }
  function ideaText(id) {
    var e = st.kufu.ideas[id];
    if (e && e.text) return e.text;
    var o = findBy(st.kufu.own, id);
    if (o) return o.text;
    var d = dataIdea(id);
    return d ? ST(d.idea.text) : '';
  }
  function ideasOfScene(sid) {
    var out = [], d = dataScene(sid);
    if (d) d.ideas.forEach(function (x) { out.push({ id: x.id, kind: x.kind, own: false, data: x }); });
    st.kufu.own.forEach(function (o) { if (!o.gone && o.scene === sid) out.push({ id: o.id, kind: 'self', own: true, data: o }); });
    return out;
  }
  function allScenes() {
    var out = dataScenes().map(function (s) { return { id: s.id, own: false, data: s }; });
    st.kufu.scenes.forEach(function (s) { if (!s.gone) out.push({ id: s.id, own: true, data: s }); });
    return out;
  }
  // 作るの「自分を助ける道具」との紐づけ（contract-Y §Y-5 / Y-8）: DES.state の活動・作品を読むだけ（ここから書き込まない）。
  // linkId = 工夫の id か 'scene:' + 場面 id。label: 作品あり → saved_work / 作業中 → making / それ以外 → made_tool
  function makeLink(linkId) {
    var S = DS().state || {}, acts = S.activities || [], works = S.works || [], a = null, w = null, i;
    for (i = 0; i < acts.length; i++) if (acts[i] && acts[i].selfLink === linkId) { a = acts[i]; break; }
    if (!a) return null;
    for (i = 0; i < works.length; i++) if (works[i] && works[i].actId === a.id) { w = works[i]; break; }
    return { act: a, work: w, label: w ? 'saved_work' : (a.state === 'working' ? 'making' : 'made_tool') };
  }
  // 紐づけの対象はデータの kind 'tool' の工夫だけ（本人が足した工夫は対象外）
  function isMakeIdea(x) { return !!x && !x.own && x.kind === 'tool'; }

  // 編集欄のキー → 持ち主の行・元の文・閉じたあとのフォーカス先
  function editorInfo(key) {
    if (!isStr(key)) return null;
    var i = key.indexOf(':'), kind = key.slice(0, i), id = key.slice(i + 1), it, ax, n, x;
    switch (kind) {
      case 'fix':
        it = itemById(id);
        if (!isAi(id) || rxOf(id).state === 'away') return null;
        return { owner: id, base: aiText(it), ret: 'row:' + id, label: TX('fix_label'), fold: it.fold ? it.axis : null };
      case 'on':
        it = itemById(id);
        if (!it || (it.src !== 'record' && it.src !== 'gap' && it.src !== 'own')) return null;
        ax = axisById(it.axis);
        return { owner: id, base: '', ret: 'row:' + id, label: TX('write_label'), ph: ST(ax.ph), fold: it.fold ? it.axis : null };
      case 'add':
        ax = axisById(id);
        if (!ax) return null;
        return { owner: key, base: '', ret: 'addbtn:' + id, label: TX('write_label'), ph: ST(ax.ph) };
      case 'note':
        n = findBy(st.notes, id);
        if (!n || n.gone) return null;
        it = n.on ? itemById(n.on) : null;
        return { owner: 'note:' + id, base: noteText(n), ret: 'row:note:' + id, label: TX('fix_label'), fold: it && it.fold ? it.axis : null };
      case 'scene':
        if (id === 'new') return { owner: key, base: '', ret: 'addscene', label: TX('write_label'), ph: KX('scene_ph') };
        x = ownScene(id);
        if (!x || x.gone) return null;
        return { owner: key, base: x.text, ret: 'sedit:' + id, label: TX('fix_label') };
      case 'idea':
        if (!sceneKnown(st, id)) return null;
        return { owner: key, base: '', ret: 'addidea:' + id, label: TX('write_label'), ph: KX('idea_ph') };
      case 'oidea':
        x = findBy(st.kufu.own, id);
        if (!x || x.gone) return null;
        return { owner: key, base: x.text, ret: isFit(id) ? 'fedit:' + id : 'kmore:' + id, label: TX('fix_label') };
      case 'adjust':
        if (!ideaKnown(st, id) || ideaState(id).status !== 'trying') return null;
        return { owner: key, base: ideaText(id), ret: 'howwas:' + id, label: TX('fix_label') };
    }
    return null;
  }
  function isFit(id) { var e = ideaState(id); return e.status === 'result' && e.result === 'fit'; }
  // 結果のひとこと: 入力中の値 > 下書き（rnote:<id>）> 保存済み
  function rnoteVal(id) {
    if (ui.rnote[id] != null) return ui.rnote[id];
    if (st.draft && st.draft.target === 'rnote:' + id) return st.draft.text;
    return ideaState(id).note || '';
  }
  function draftText(key, base) { return st.draft && st.draft.target === key ? st.draft.text : base; }

  // ---------- 描画 ----------
  function srcChip(src) {
    var m = { own: ['src-own', 'quote', 'legend_own'], record: ['src-record', 'record', 'legend_record'], ai: ['src-ai', 'spark', 'legend_ai'], gap: ['src-gap', null, 'legend_gap'] }[src];
    var label = TX(m[2]);
    return H('span', { class: 'chip ' + m[0], 'aria-label': label }, [m[1] ? icon(m[1]) : null, H('span', null, label)]);
  }
  function dateEl(d, t) { return d ? H('span', { class: 'sx-date' }, md(d, t)) : null; }
  function seeLinks(b) {
    var out = [];
    if (b.from) out.push(H('a', { class: 'link-btn sx-see', href: '#talk', 'data-fk': 'see:' + b.from + ':' + (b.text || '').length }, TX('see_talk') + ' →'));
    if (b.to === 'plan') out.push(H('a', { class: 'link-btn sx-see', href: '#plan' }, TX('see_plan') + ' →'));
    return out;
  }
  function btn(label, action, id, o) {
    o = o || {};
    return H('button', {
      type: 'button', class: 'btn small' + (o.kls ? ' ' + o.kls : ''), 'data-action': action, 'data-id': id, 'data-arg': o.arg || null,
      'data-fk': o.fk || (action + ':' + id + (o.arg ? ':' + o.arg : '')), disabled: !!o.disabled, 'aria-label': o.aria || null,
      'aria-expanded': o.expanded == null ? null : (o.expanded ? 'true' : 'false')
    }, o.icon ? [o.icon, H('span', null, label)] : label);
  }
  function linkBtn(label, action, id, o) {
    o = o || {};
    return H('button', { type: 'button', class: 'link-btn', 'data-action': action, 'data-id': id, 'data-arg': o.arg || null, 'data-fk': o.fk || (action + ':' + id), 'aria-expanded': o.expanded == null ? null : (o.expanded ? 'true' : 'false') }, label);
  }
  function replyLine(key) {
    return H('p', { class: 'sx-reply sx-enter', role: 'status' }, [bud(18, 'neutral'), H('span', null, TX(key))]);
  }

  function editorEl(key) {
    var info = editorInfo(key);
    if (!info) return null;
    var text = draftText(key, info.base), tid = 'sx-ta-' + key.replace(/[^a-zA-Z0-9_-]/g, '_');
    var empty = !clean(text), same = !!info.base && clean(text) === clean(info.base);
    return H('div', { class: 'sx-edit sx-enter', 'data-key': key }, [
      H('label', { for: tid }, info.label),
      H('textarea', { id: tid, rows: '3', maxlength: String(MAXLEN), placeholder: info.ph || null, 'data-fk': 'ta:' + key, 'data-sx-input': key, value: text }),
      H('p', { class: 'hint sx-same', hidden: !same }, TX('same_text_hint')),
      H('div', { class: 'sx-edit-ops' }, [
        btn(TX('save'), 'sx-save', key, { kls: 'primary', disabled: empty || same, fk: 'save:' + key }),
        btn(TX('cancel'), 'sx-cancel', key, { fk: 'cancel:' + key })
      ])
    ]);
  }

  function basisBlock(head, list) {
    if (!list || !list.length) return null;
    return H('div', { class: 'sx-basis-block' }, [
      H('p', { class: 'sx-sub-h' }, head),
      H('ul', { class: 'sx-basis' }, list.map(function (b) {
        return H('li', { class: 'sx-basis-i' }, [srcChip(b.src), dateEl(b.date, b.time), H('span', { class: 'sx-btext' }, b.text)].concat(seeLinks(b)));
      }))
    ]);
  }

  function historyEl(it) {
    var r = rxOf(it.id), logs = st.log.filter(function (l) { return l.item === it.id; }).reverse();
    var kids = [H('p', { class: 'sx-sub-h' }, TX('history'))];
    if (!r.vers.length && !logs.length) {
      kids.push(H('p', { class: 'hint' }, TX('history_empty')));
    } else {
      var cur = r.state === 'edited' ? r.cur : -1, list = [];
      for (var i = r.vers.length - 1; i >= 0; i--) list.push({ cur: i, src: 'own', text: r.vers[i].text, at: r.vers[i].at });
      list.push({ cur: -1, src: 'ai', text: ST(it.text), at: it.date });
      kids.push(H('ul', { class: 'sx-hist' }, list.map(function (v) {
        return H('li', { class: 'sx-hist-i' + (v.cur === cur ? ' is-cur' : ''), 'aria-current': v.cur === cur ? 'true' : null }, [
          H('span', { class: 'sx-hist-meta' }, [srcChip(v.src), dateEl(v.at)]),
          H('span', { class: 'sx-btext' }, v.text),
          v.cur === cur || r.state === 'away' ? null : btn(TX('use_this'), 'sx-use', it.id, { arg: String(v.cur), kls: 'ghost' })
        ]);
      })));
      var LOG = { agree: 't_agree', fix: 't_fixed', use: 't_fixed', away: 't_not_now', back: 't_back', toAi: 't_back' };
      var lines = logs.filter(function (l) { return LOG[l.act]; });
      if (lines.length) kids.push(H('ul', { class: 'sx-log' }, lines.map(function (l) { return H('li', null, [dateEl(l.at), H('span', null, TX(LOG[l.act]))]); })));
    }
    return H('div', { class: 'sx-history sx-enter' }, kids);
  }

  // 体験カードは左の日付列に日付を出すため、行の中には出さない（noDate）
  function rowMeta(it, noDate) {
    var r = rxOf(it.id), kids = [];
    if (it.src === 'ai' && r.state !== 'edited') {
      kids.push(bud(18, 'think'), srcChip('ai'));
      if (it.axis === 'exp' && it.date) kids.push(H('span', { class: 'sr-only' }, md(it.date)));
      if (r.state === 'agreed') {
        var l = lastLog(it.id, 'agree');
        kids.push(H('span', { class: 'chip src-own sx-agreed', 'aria-label': TX('agreed_chip') }, [icon('check'), H('span', null, TX('agreed_chip'))]), l ? dateEl(l.at) : null);
      }
      if (it.kind === 'door' && st.door[it.id] === 'added') kids.push(H('span', { class: 'chip k-mine' }, DS().t('in_plan')));
    } else if (it.src === 'ai') {
      kids.push(srcChip('own'), dateEl(r.vers[r.cur].at));
    } else {
      kids.push(srcChip(it.src), noDate ? H('span', { class: 'sr-only' }, md(it.date, it.time)) : dateEl(it.date, it.time));
    }
    if (it.cond) kids.push(H('span', { class: 'chip sx-cond' }, TX('cond_' + it.cond)));
    return H('span', { class: 'srow-meta' }, kids);
  }

  function openPanel(it) {
    var r = rxOf(it.id), kids = [], ek = ui.edit && ui.edit.key;
    if (it.src === 'ai' && it.kind === 'door') {
      var added = st.door[it.id] === 'added';
      kids.push(H('div', { class: 'sx-react' }, added ? [H('a', { class: 'link-btn', href: '#plan' }, TX('see_plan') + ' →')] : [
        H('button', { type: 'button', class: 'btn small', 'data-action': 'grid-add', 'data-id': it.activity, 'data-door': it.id, 'data-fk': 'dooradd:' + it.id }, DS().t('add_to_plan')),
        H('button', { type: 'button', class: 'btn small', 'data-action': 'grid-ask', 'data-id': it.activity, 'data-fk': 'doorask:' + it.id }, DS().t('ask_short')),
        btn(KX('not_now'), 'sx-doornot', it.id)
      ]));
      return H('div', { class: 'srow-open' }, kids);
    }
    if (it.src === 'ai') {
      if (r.state === 'edited') kids.push(H('div', { class: 'sx-basis-block' }, [H('p', { class: 'sx-sub-h' }, TX('from_ai')), H('p', { class: 'sx-orig' }, ST(it.text))]));
      kids.push(basisBlock(TX('basis'), it.basis), basisBlock(TX('counter'), it.counter));
      if (ek === 'fix:' + it.id) { kids.push(editorEl(ek)); return H('div', { class: 'srow-open' }, kids); }
      var ops;
      if (r.state === 'agreed') ops = [btn(TX('react_fix'), 'sx-fixopen', it.id), btn(TX('react_not_now'), 'sx-away', it.id), btn(TX('back_to_ai'), 'sx-toai', it.id)];
      else if (r.state === 'edited') ops = [btn(TX('react_agree'), 'sx-agree', it.id), btn(TX('edit'), 'sx-fixopen', it.id), btn(TX('react_not_now'), 'sx-away', it.id), btn(TX('back_to_ai'), 'sx-toai', it.id)];
      else ops = [btn(TX('react_agree'), 'sx-agree', it.id), btn(TX('react_fix'), 'sx-fixopen', it.id), btn(TX('react_not_now'), 'sx-away', it.id)];
      var links = [linkBtn(TX('history'), 'sx-hist', it.id, { expanded: ui.hist === it.id }), linkBtn(TX('react_talk'), 'sx-talk', it.id)];
      kids.push(H('div', { class: 'sx-react' }, ops.concat(links)));
      if (r.state === 'pending') kids.push(H('p', { class: 'hint' }, TX('react_hint')));
      return H('div', { class: 'srow-open' }, kids);
    }
    // own（会話の引用）/ record / gap: 本文は直さず、本人の言葉を足す
    kids.push(H('div', { class: 'sx-react' }, seeLinks(it)));
    if (ek === 'on:' + it.id) kids.push(editorEl(ek));
    else if (it.src === 'own') kids.push(H('div', { class: 'sx-react' }, [btn(TX('add_now_words'), 'sx-edit', 'on:' + it.id, { icon: icon('plus') })]));
    else if (it.src === 'record') kids.push(H('div', { class: 'sx-react' }, [btn(TX('note_on_record'), 'sx-edit', 'on:' + it.id, { icon: icon('plus') })]));
    else kids.push(H('div', { class: 'sx-react' }, [btn(TX('write_label'), 'sx-edit', 'on:' + it.id, { icon: icon('plus') })]));
    return H('div', { class: 'srow-open' }, kids);
  }

  function itemRow(it) {
    var r = rxOf(it.id), open = ui.open === it.id;
    var form = it.src === 'ai' ? (r.state === 'edited' ? 'own' : 'ai') : it.src;
    var kids = [H('button', {
      type: 'button', class: 'srow-main', 'aria-expanded': open ? 'true' : 'false', 'data-action': 'sx-open', 'data-id': it.id, 'data-fk': 'row:' + it.id
    }, [rowMeta(it, it.axis === 'exp'), H('span', { class: 'srow-text' }, itemText(it))])];
    if (it.src === 'ai' && r.state === 'edited') {
      kids.push(H('p', { class: 'sx-sublinks' }, [
        linkBtn(TX('from_ai'), 'sx-open', it.id, { fk: 'fromai:' + it.id }), H('span', { 'aria-hidden': 'true' }, '·'),
        linkBtn(TX('history'), 'sx-hist', it.id, { fk: 'histlink:' + it.id, expanded: ui.hist === it.id })
      ]));
    }
    if (open) kids.push(openPanel(it));
    if (ui.hist === it.id) kids.push(historyEl(it));
    if (ui.reply && ui.reply.id === it.id && ui.reply.key !== 'reply_not_now') kids.push(replyLine(ui.reply.key));
    return H('div', { class: 'srow f-' + form + (open ? ' open' : '') + (ui.flash === it.id ? ' sx-enter' : ''), 'data-item': it.id }, kids);
  }

  function noteRow(n) {
    var key = 'note:' + n.id, open = ui.open === key, ek = ui.edit && ui.edit.key, kids = [
      H('button', { type: 'button', class: 'srow-main', 'aria-expanded': open ? 'true' : 'false', 'data-action': 'sx-open', 'data-id': key, 'data-fk': 'row:' + key }, [
        H('span', { class: 'srow-meta' }, [srcChip('own'), dateEl(n.vers[n.cur].at)]),
        H('span', { class: 'srow-text' }, noteText(n))
      ])
    ];
    if (open) {
      kids.push(H('div', { class: 'srow-open' }, ek === key ? [editorEl(key)] : [
        H('div', { class: 'sx-react' }, [btn(TX('edit'), 'sx-edit', key, { fk: 'nedit:' + n.id }), btn(TX('remove'), 'sx-ndel', n.id)])
      ]));
    }
    return H('div', { class: 'srow f-own sx-note' + (open ? ' open' : '') + (ui.flash === key ? ' sx-enter' : ''), 'data-item': key }, kids);
  }

  function lineWrap(ax, it, el) {
    if (ax.id !== 'exp') return el;
    return H('div', { class: 'exp-line' }, [H('span', { class: 'exp-date', 'aria-hidden': it ? 'true' : null }, it && it.date ? md(it.date) : ''), el]);
  }

  function cardEl(ax) {
    var its = items().filter(function (i) { return i.axis === ax.id; });
    var foldOpen = !!ui.fold[ax.id], foldN = 0, ek = ui.edit && ui.edit.key;
    var addKey = 'add:' + ax.id, addGroup = ax.id === 'psy' ? 'now' : null;
    function rowsOf(list) {
      var out = [];
      list.forEach(function (it) {
        if (isAwayItem(it)) return;
        if (it.fold && !foldOpen) { foldN += 1; return; }
        out.push(lineWrap(ax, it, itemRow(it)));
        notesOn(it.id).forEach(function (n) { out.push(lineWrap(ax, null, noteRow(n))); });
      });
      return out;
    }
    function groupTail(g) {
      var out = notesGroup(ax.id, g).map(function (n) { return lineWrap(ax, null, noteRow(n)); });
      if (ek === addKey && g === addGroup) out.push(editorEl(addKey));
      return out;
    }
    var body = [];
    if (ax.groups) {
      ax.groups.forEach(function (g) {
        var rows = rowsOf(its.filter(function (i) { return i.group === g.id; })).concat(groupTail(g.id));
        body.push(H('div', { class: 'sx-group' }, [H('h3', { class: 'sx-group-h' }, ST(g.head)), H('div', { class: 'sx-list' }, rows)]));
      });
      var tail = groupTail(null);
      if (tail.length) body.push(H('div', { class: 'sx-list sx-tail' }, tail));
    } else {
      body.push(H('div', { class: 'sx-list' }, rowsOf(its).concat(groupTail(null))));
    }
    var foldAll = its.filter(function (i) { return i.fold && !isAwayItem(i); }).length;
    if (foldAll) {
      body.push(H('p', { class: 'sx-fold' }, [linkBtn(foldOpen ? TX('less') : TX('more', { n: foldN }), 'sx-fold', ax.id, { fk: 'fold:' + ax.id, expanded: foldOpen })]));
    }
    var away = its.filter(isAwayItem);
    if (ui.reply && ui.reply.key === 'reply_not_now' && ui.reply.axis === ax.id) body.push(replyLine('reply_not_now'));
    if (away.length) {
      var aOpen = !!ui.awayOpen[ax.id];
      body.push(H('div', { class: 'sx-away' }, [
        linkBtn(TX('put_away', { n: away.length }), 'sx-awayfold', ax.id, { fk: 'awaybtn:' + ax.id, expanded: aOpen }),
        aOpen ? H('ul', { class: 'sx-away-list' }, away.map(function (it) {
          return H('li', { class: 'sx-away-i' }, [
            H('div', { class: 'sx-away-row' }, [
              H('span', { class: 'sx-btext' }, itemText(it)),
              H('span', { class: 'sx-away-ops' }, [
                it.kind === 'door' ? null : linkBtn(TX('history'), 'sx-hist', it.id, { fk: 'awayhist:' + it.id, expanded: ui.hist === it.id }),
                btn(TX('put_back'), it.kind === 'door' ? 'sx-doorback' : 'sx-back', it.id, { kls: 'ghost' })
              ])
            ]),
            ui.hist === it.id ? historyEl(it) : null
          ]);
        })) : null
      ]));
    }
    var adding = ek === addKey;
    return H('section', { class: 'axis-card ax-' + ax.id, 'aria-labelledby': 'ax-h-' + ax.id }, [
      H('div', { class: 'axis-head' }, [
        H('h2', { id: 'ax-h-' + ax.id }, ST(ax.head)),
        H('button', { type: 'button', class: 'btn ghost small', 'data-action': 'sx-edit', 'data-id': addKey, 'data-fk': 'addbtn:' + ax.id, 'aria-expanded': adding ? 'true' : 'false', 'aria-label': TX('add') + ': ' + ST(ax.head) }, [icon('plus'), H('span', null, TX('add'))])
      ])
    ].concat(body));
  }

  // 真ん中のバディの話しかけ（V-5）
  function commentInfo() {
    var c = SD().comment, first = null, replied = 0;
    c.ask.forEach(function (id) { if (rxOf(id).state === 'pending') { if (!first) first = id; } else replied += 1; });
    if (first) {
      if (!replied && first === c.ask[0]) return { text: ST(c.first), link: ST(c.link), action: 'sx-goto', id: first };
      return { text: ST(c.next, { text: aiText(itemById(first)).slice(0, 20) }), link: ST(c.link), action: 'sx-goto', id: first };
    }
    var k1 = ideasOfScene('k1').some(function (x) { var s = ideaState(x.id).status; return s === 'trying' || s === 'result'; });
    if (!k1) return { text: ST(c.kufu), link: ST(c.link_kufu), action: 'sx-goto-kufu', id: 'k1' };
    return { text: ST(c.done) };
  }
  function budEl() {
    var c = commentInfo();
    return H('div', { class: 'self-bud' }, [
      H('div', { class: 'sx-bubble' }, [
        bud(44, 'neutral'),
        H('p', null, c.text),
        c.link ? H('button', { type: 'button', class: 'link-btn', 'data-action': c.action, 'data-id': c.id, 'data-fk': 'budlink' }, c.link) : null
      ])
    ]);
  }

  function avatarEl(av, kls, alt) {
    var wrap = H('span', { class: 'sx-av ' + kls }, [H('span', { class: 'sx-av-letter', 'aria-hidden': 'true' }, SD().avatar.initialLetter)]);
    if (av.hair === 'none') {
      if (alt) { wrap.setAttribute('role', 'img'); wrap.setAttribute('aria-label', alt); }
      return wrap;
    }
    var src = 'img/self/avatar-' + av.hair + '-' + av.color + '.jpg', failed = !!ui.failed[src];
    var img = H('img', { src: src, alt: alt || '', hidden: failed, decoding: 'async' });
    function fallback() { ui.failed[src] = true; img.hidden = true; if (alt) { wrap.setAttribute('role', 'img'); wrap.setAttribute('aria-label', alt); } }
    if (failed) fallback(); else img.addEventListener('error', fallback);
    wrap.appendChild(img);
    return wrap;
  }
  function hubEl() {
    return H('div', { class: 'self-hub' }, [H('div', { class: 'self-hub-inner' }, [
      avatarEl(st.avatar, 'main', TX('avatar_alt')),
      H('p', { class: 'sx-name' }, DS().data.child.name),
      H('button', { type: 'button', class: 'btn ghost small', 'data-action': 'sx-avatar', 'data-fk': 'avatar-change', 'aria-haspopup': 'dialog', 'aria-label': TX('avatar_h') }, TX('avatar_change'))
    ])]);
  }

  // ---------- 工夫の帯 ----------
  function kindChip(kind) { return H('span', { class: 'chip sx-kind' }, [KIND_ICON[kind](), H('span', null, ST(SD().kufu.kinds[kind]))]); }
  function ideaRow(x, scene) {
    var s = ideaState(x.id), open = ui.howwas === x.id, menu = ui.kmenu === x.id, ek = ui.edit && ui.edit.key;
    var adjusted = !!(st.kufu.ideas[x.id] && st.kufu.ideas[x.id].text);
    var head = [kindChip(x.kind)];
    if (s.status === 'trying') {
      head.push(H('span', { class: 'chip k-trying' }, KX('trying')));
      if (scene.data.when) head.push(H('span', { class: 'sx-date' }, ST(scene.data.when)));
    }
    if (adjusted || x.own) head.push(srcChip('own'));
    var kids = [H('div', { class: 'kidea-head' }, head), H('p', { class: 'kidea-text' }, ideaText(x.id))];
    var link = isMakeIdea(x) ? makeLink(x.id) : null;
    if (link) kids.push(makeLinkRow(link, x.id));
    if (s.status === 'trying' && s.note && !open) kids.push(H('p', { class: 'kidea-res' }, [srcChip('own'), H('span', { class: 'sx-btext' }, s.note)]));
    if (s.status === 'result' && s.result === 'meh') {
      kids.push(H('p', { class: 'kidea-res' }, [H('span', { class: 'chip' }, KX('r_meh')), s.note ? H('span', { class: 'sx-btext' }, s.note) : null]));
    }
    if (ek === 'adjust:' + x.id) { kids.push(editorEl(ek)); }
    else if (ek === 'oidea:' + x.id) { kids.push(editorEl(ek)); }
    else {
      var main = s.status === 'trying'
        ? btn(KX('how_was'), 'sx-howwas', x.id, { fk: 'howwas:' + x.id, expanded: open })
        : btn(KX('try_btn'), 'sx-try', x.id, { fk: 'ktry:' + x.id });
      var title = ideaText(x.id);
      // 作るで作る（紐づく活動が無い時だけ）/ 作品があり idle の時は「試してみる」の隣に hint（Y-8 の 7）
      var hint = link && link.work && s.status === 'idle' ? H('span', { class: 'kidea-hint' }, KX('saved_hint')) : null;
      var makeB = isMakeIdea(x) && !link ? btn(KX('make_btn'), 'sx-kmake', x.id, { kls: 'ghost', fk: 'kmake:' + x.id, icon: icon('make') }) : null;
      kids.push(H('div', { class: 'kidea-ops' }, [
        main,
        hint,
        makeB,
        H('button', { type: 'button', class: 'icon-btn sx-more', 'data-action': 'sx-kmenu', 'data-id': x.id, 'data-fk': 'kmore:' + x.id, 'aria-expanded': menu ? 'true' : 'false', 'aria-label': DS().t('row_ops', { title: title.slice(0, 20) }) }, [icon('more')])
      ]));
      if (open) {
        kids.push(H('div', { class: 'kidea-how sx-enter' }, [
          H('div', { class: 'sx-react' }, [
            btn(KX('r_fit'), 'sx-result', x.id, { arg: 'fit', fk: 'rfit:' + x.id }),
            btn(KX('r_meh'), 'sx-result', x.id, { arg: 'meh' }),
            btn(KX('r_adjust'), 'sx-adjust', x.id)
          ]),
          H('input', { type: 'text', class: 'sx-rnote', maxlength: String(MAXLEN), placeholder: KX('r_note_ph'), 'aria-label': KX('r_note_ph'), 'data-sx-rnote': x.id, 'data-fk': 'rnote:' + x.id, value: rnoteVal(x.id) })
        ]));
      }
      if (menu) {
        var m = [btn(KX('not_now'), 'sx-kaway', x.id, { kls: 'ghost' })];
        if (x.kind === 'tool') m.push(btn(KX('talk_btn'), 'sx-ktalk', x.id, { kls: 'ghost', icon: icon('chat') }));
        if (x.own) m.push(btn(TX('edit'), 'sx-edit', 'oidea:' + x.id, { kls: 'ghost', fk: 'koedit:' + x.id }), btn(TX('remove'), 'sx-kdel', x.id, { kls: 'ghost' }));
        kids.push(H('div', { class: 'kmenu sx-enter' }, m));
      }
    }
    return H('li', { class: 'kidea' + (x.own || adjusted ? ' f-own' : '') + (ui.flash === 'idea:' + x.id ? ' sx-enter' : ''), 'data-idea': x.id }, kids);
  }

  // 紐づけの表示: --record の小チップ + 作業台を開く（DES.make.openAct）
  function makeLinkRow(link, key) {
    return H('div', { class: 'kidea-link' }, [
      // 出所名の aria-label（srcChip と同じ考え方。文言は making / made_tool / saved_work）
      H('span', { class: 'chip src-record sx-make-chip', 'aria-label': KX(link.label) }, [icon('make'), H('span', null, KX(link.label))]),
      linkBtn(KX('open_bench'), 'sx-kbench', link.act.id, { fk: 'kbench:' + key })
    ]);
  }

  function sceneEl(sc) {
    var ek = ui.edit && ui.edit.key, d = sc.data, left = [], right = [];
    var sKey = 'scene:' + sc.id;
    if (ek === sKey) {
      left.push(editorEl(sKey));
    } else {
      var src = sc.own ? 'own' : d.src;
      left.push(H('div', { class: 'srow f-' + src + ' ks-scene' }, [
        H('div', { class: 'srow-main is-static' }, [H('span', { class: 'srow-meta' }, [srcChip(src), dateEl(d.date || d.at)]), H('span', { class: 'srow-text' }, d.text)]),
        sc.own ? H('div', { class: 'sx-react ks-ops' }, [btn(TX('edit'), 'sx-edit', sKey, { kls: 'ghost', fk: 'sedit:' + sc.id }), btn(TX('remove'), 'sx-sdel', sc.id, { kls: 'ghost' })]) : null
      ]));
    }
    if (d.basis) left.push(basisBlock(TX('basis'), d.basis));
    right.push(H('p', { class: 'ks-buddy' }, [bud(18, 'neutral'), H('span', null, sc.own ? KX('new_scene_buddy') : ST(d.buddy))]));
    // 本人の場面の紐づけ（Y-8 の 6）: チップ + 作業台を開く だけ（試してみる・hint は出さない）
    var sLink = sc.own ? makeLink('scene:' + sc.id) : null;
    if (sLink) right.push(makeLinkRow(sLink, 'scene:' + sc.id));
    var list = ideasOfScene(sc.id), shown = [], away = [];
    list.forEach(function (x) {
      var s = ideaState(x.id);
      if (s.status === 'away') away.push(x);
      else if (!(s.status === 'result' && s.result === 'fit')) shown.push(x);
    });
    if (shown.length) right.push(H('ul', { class: 'kidea-list' }, shown.map(function (x) { return ideaRow(x, sc); })));
    if (sc.own && !list.length) {
      // 道具を作る は作るの tool の作業台へ（Y-5）。紐づく活動があれば出さない（チップ + 作業台を開く で開く）
      right.push(H('div', { class: 'sx-react ks-kinds' }, (sLink ? ['ai', 'env'] : ['ai', 'env', 'tool']).map(function (k) {
        return btn(ST(SD().kufu.kinds[k]), k === 'tool' ? 'sx-kscene-make' : 'sx-kprefill', sc.id, { arg: k, icon: KIND_ICON[k]() });
      })));
    }
    var iKey = 'idea:' + sc.id;
    if (ek === iKey) right.push(editorEl(iKey));
    else right.push(H('p', { class: 'ks-add' }, [btn(KX('add_idea'), 'sx-edit', iKey, { kls: 'ghost', icon: licon('pen'), fk: 'addidea:' + sc.id })]));
    if (away.length) {
      var aOpen = !!ui.kfold[sc.id];
      right.push(H('div', { class: 'sx-away' }, [
        H('button', { type: 'button', class: 'link-btn', 'data-action': 'sx-kfold', 'data-id': sc.id, 'data-fk': 'kfold:' + sc.id, 'aria-expanded': aOpen ? 'true' : 'false' }, KX('away_head', { n: away.length })),
        aOpen ? H('ul', { class: 'sx-away-list' }, away.map(function (x) {
          return H('li', { class: 'sx-away-i' }, [H('span', { class: 'sx-btext' }, ideaText(x.id)), btn(TX('put_back'), 'sx-kback', x.id, { kls: 'ghost' })]);
        })) : null
      ]));
    }
    return H('div', { class: 'kufu-scene' + (ui.flash === 'scene:' + sc.id ? ' sx-enter' : ''), 'data-scene': sc.id }, [
      H('div', { class: 'ks-left' }, left), H('div', { class: 'ks-right' }, right)
    ]);
  }

  function fitList() {
    var out = [];
    allScenes().forEach(function (sc) {
      ideasOfScene(sc.id).forEach(function (x) {
        var s = ideaState(x.id);
        if (s.status !== 'result' || s.result !== 'fit') return;
        var seedNote = s.seeded && x.data.seed && x.data.seed.note, own = x.own || !!s.text, ek = ui.edit && ui.edit.key;
        out.push(H('li', { class: 'kfit-i' + (own ? ' f-own' : '') + (ui.flash === 'idea:' + x.id ? ' sx-enter' : ''), 'data-idea': x.id }, [
          icon('check'),
          H('div', { class: 'kfit-body' }, [
            own ? H('p', { class: 'kfit-note' }, [srcChip('own')]) : null,
            ek === 'oidea:' + x.id ? editorEl(ek) : H('p', { class: 'kfit-text' }, [ideaText(x.id), H('span', { class: 'kfit-meta' }, ' · ' + sceneName(sc.id) + (s.at ? ' · ' + md(s.at) : ''))]),
            seedNote ? H('p', { class: 'kfit-note' }, [srcChip(seedNote.src), H('span', null, seedNote.text)]) : null,
            !seedNote && s.note ? H('p', { class: 'kfit-note' }, [srcChip('own'), H('span', null, s.note)]) : null,
            isMakeIdea(x) && makeLink(x.id) ? makeLinkRow(makeLink(x.id), x.id) : null,
            x.own && ek !== 'oidea:' + x.id ? H('div', { class: 'sx-react' }, [
              btn(TX('edit'), 'sx-edit', 'oidea:' + x.id, { kls: 'ghost', fk: 'fedit:' + x.id }),
              btn(TX('remove'), 'sx-kdel', x.id, { kls: 'ghost', fk: 'fdel:' + x.id })
            ]) : null
          ])
        ]));
      });
    });
    if (!out.length) return null;
    return H('div', { class: 'kufu-fit' }, [H('h3', { class: 'sx-group-h', id: 'kufu-fit-h', tabindex: '-1', 'data-fk': 'fitlist' }, KX('fit_list')), H('ul', null, out)]);
  }

  function kufuEl() {
    var ek = ui.edit && ui.edit.key, adding = ek === 'scene:new';
    var kids = [
      H('div', { class: 'kufu-head' }, [
        H('div', null, [H('h2', { id: 'kufu-h', tabindex: '-1', 'data-fk': 'kufu-h' }, KX('head')), H('p', { class: 'sx-intro' }, KX('intro'))]),
        H('button', { type: 'button', class: 'btn small', 'data-action': 'sx-edit', 'data-id': 'scene:new', 'data-fk': 'addscene', 'aria-expanded': adding ? 'true' : 'false' }, [icon('plus'), H('span', null, KX('add_scene'))])
      ]),
      fitList()
    ];
    if (adding) kids.push(H('div', { class: 'kufu-new' }, [editorEl('scene:new')]));
    allScenes().forEach(function (sc) { kids.push(sceneEl(sc)); });
    return H('section', { class: 'kufu-band', id: 'kufu-band', 'aria-labelledby': 'kufu-h' }, kids);
  }

  function pageEl() {
    var t = SD().text, axes = SD().axes;
    function ax(id) { for (var i = 0; i < axes.length; i++) if (axes[i].id === id) return cardEl(axes[i]); return null; }
    return H('div', { class: 'self-page' }, [
      H('header', { class: 'self-head' }, [
        H('div', { class: 'self-head-text' }, [H('h1', null, DS().t('self')), H('p', { class: 'sx-intro' }, ST(t.intro))]),
        H('div', { class: 'self-head-side' }, [
          H('div', { class: 'sx-legend' }, [srcChip('own'), srcChip('record'), srcChip('ai'), srcChip('gap')]),
          H('span', { class: 'date-stamp' }, ST(t.as_of))
        ])
      ]),
      // V-10: 3 列の独立した縦積み（左 = 関心 → 体験 / 中央 = 本人 + バディ / 右 = 志向性 → 心理 → 習熟）。
      // ≤ 700 は列を display:contents にして order で 1 列に並べ直す（hub → 吹き出し → 関心 → 志向性 → 体験 → 心理 → 習熟）
      // ≤ 700 は DOM も表示と同じ 1 列の順にする（Tab・読み上げの順を揃える。幅の区切りが変わると app.js が描き直す）
      DS().app.bp() === 's'
        ? H('div', { class: 'self-orbit is-flat' }, [hubEl(), budEl(), ax('int'), ax('ori'), ax('exp'), ax('psy'), ax('mas')])
        : H('div', { class: 'self-orbit' }, [
          H('div', { class: 'self-col col-c' }, [hubEl(), budEl()]),
          H('div', { class: 'self-col col-l' }, [ax('int'), ax('exp')]),
          H('div', { class: 'self-col col-r' }, [ax('ori'), ax('psy'), ax('mas')])
        ]),
      kufuEl(),
      H('p', { class: 'privacy-line' }, [H('span', { class: 'privacy-note' }, [icon('lock'), H('span', null, ST(t.share))])])
    ]);
  }

  function restoreDraft() {
    ui.restore = false;
    var d = st.draft;
    if (!d) return;
    if (d.target.indexOf('rnote:') === 0) {
      var rid = d.target.slice(6);
      if (ideaKnown(st, rid) && ideaState(rid).status === 'trying') { ui.howwas = rid; ui.rnote[rid] = d.text; } else setDraft(null);
      return;
    }
    var info = editorInfo(d.target);
    if (!info) { setDraft(null); return; }
    ui.open = info.owner;
    ui.edit = { key: d.target };
    if (info.fold) ui.fold[info.fold] = true;
  }

  SELF.render = function (main) {
    if (!st) load();
    if (ui.restore) restoreDraft();
    var ae = document.activeElement, fk = null, sel = null;
    if (ae && ae !== document.body && main.contains(ae)) {
      fk = ae.getAttribute('data-fk');
      if (ae.tagName === 'TEXTAREA' || (ae.tagName === 'INPUT' && ae.type === 'text')) sel = [ae.selectionStart, ae.selectionEnd];
    }
    main.textContent = '';
    main.appendChild(pageEl());
    var want = ui.focus || fk, fresh = !!ui.focus && ui.focus !== fk;
    ui.focus = null;
    ui.flash = null;
    if (!want) return;
    var n = main.querySelector('[data-fk="' + q(want) + '"]');
    if (!n || n.disabled) return;
    n.focus();
    if (n.tagName === 'TEXTAREA' || (n.tagName === 'INPUT' && n.type === 'text')) {
      var L = n.value.length;
      if (sel && !fresh) n.setSelectionRange(Math.min(sel[0], L), Math.min(sel[1], L)); else n.setSelectionRange(L, L);
    }
  };

  // ---------- 操作 ----------
  // 開いている行・編集欄はページで 1 つ。変更なしの編集欄は下書きごと閉じ、変更ありは下書きを残して閉じる
  function leaveEdit() {
    if (!ui.edit) return;
    var k = ui.edit.key, d = st.draft, info = editorInfo(k);
    if (d && d.target === k && (!info || clean(d.text) === clean(info.base))) setDraft(null);
    ui.edit = null;
  }
  function closeTransient() { ui.reply = null; ui.hist = null; ui.kmenu = null; ui.howwas = null; }
  function openEditor(key, focus) {
    var info = editorInfo(key);
    if (!info) return;
    leaveEdit();
    closeTransient();
    ui.open = info.owner;
    ui.edit = { key: key };
    if (info.fold) ui.fold[info.fold] = true;
    ui.focus = focus || ('ta:' + key);
    rerender();
  }
  function cancelEdit(key) {
    var info = editorInfo(key);
    if (st.draft && st.draft.target === key) setDraft(null);
    ui.edit = null;
    if (ui.open === key) ui.open = null;
    ui.focus = info ? info.ret : null;
    rerender();
  }
  function save(key, text) {
    var info = editorInfo(key);
    if (!info) return;
    var t = clean(text);
    if (!t || (info.base && t === clean(info.base))) return;
    var i = key.indexOf(':'), kind = key.slice(0, i), id = key.slice(i + 1), nid = newId(), a, o, it;
    switch (kind) {
      case 'fix': a = { type: 'fix', id: id, text: t }; o = { toast: TX('t_fixed'), reply: { id: id, key: 'reply_fixed' }, focus: 'row:' + id, flash: id }; break;
      case 'on':
        it = itemById(id);
        a = { type: 'noteAdd', nid: nid, axis: it.axis, group: it.group || null, on: id, text: t };
        o = { toast: TX('t_added'), focus: 'row:note:' + nid, flash: 'note:' + nid, undoFocus: 'row:' + id }; break;
      case 'add':
        a = { type: 'noteAdd', nid: nid, axis: id, group: id === 'psy' ? 'now' : null, on: null, text: t };
        o = { toast: TX('t_added'), focus: 'row:note:' + nid, flash: 'note:' + nid, undoFocus: 'addbtn:' + id }; break;
      case 'note': a = { type: 'noteEdit', id: id, text: t }; o = { toast: TX('t_fixed'), focus: 'row:note:' + id, flash: 'note:' + id }; break;
      case 'scene':
        if (id === 'new') { a = { type: 'sceneAdd', nid: nid, text: t }; o = { toast: KX('t_scene'), focus: 'sedit:' + nid, flash: 'scene:' + nid, undoFocus: 'addscene' }; }
        else { a = { type: 'sceneEdit', id: id, text: t }; o = { toast: TX('t_fixed'), focus: 'sedit:' + id, flash: 'scene:' + id }; }
        break;
      case 'idea': a = { type: 'ownAdd', nid: nid, scene: id, text: t }; o = { toast: KX('t_idea'), focus: 'ktry:' + nid, flash: 'idea:' + nid, undoFocus: 'addidea:' + id }; break;
      case 'oidea': a = { type: 'ownEdit', id: id, text: t }; o = { toast: TX('t_fixed'), focus: isFit(id) ? 'fedit:' + id : 'kmore:' + id, flash: 'idea:' + id }; break;
      case 'adjust': a = { type: 'adjust', id: id, text: t, note: rnoteVal(id) }; delete ui.rnote[id]; o = { toast: TX('t_result'), focus: 'howwas:' + id, flash: 'idea:' + id }; break;
      default: return;
    }
    // 下書きは同じ変更の中で消す（dispatch の clearDraft）。戻すと下書きと編集欄も戻る
    var keep = { edit: ui.edit, open: ui.open };
    ui.edit = null; ui.open = null; closeTransient();
    o.clearDraft = key;
    if (!dispatch(a, o)) { ui.edit = keep.edit; ui.open = keep.open; }
  }
  function syncSave(key, ta) {
    var info = editorInfo(key);
    if (!info) return;
    var t = clean(ta.value), same = !!info.base && t === clean(info.base);
    var box = ta.closest('.sx-edit');
    if (!box) return;
    var b = box.querySelector('[data-action="sx-save"]'), h = box.querySelector('.sx-same');
    if (b) b.disabled = !t || same;
    if (h) h.hidden = !same;
  }
  // 話すの下書きへ足す（既存 DES.talk.prefill と同じ流れ: 末尾に改行して足す → トースト prefilled → 話すの入力欄へ）
  function toTalk(line) {
    var D = DS();
    D.app.closePlanDialog();
    D.app.change(function () {
      var S = D.state, cur = ((S.draft && S.draft.text) || '').replace(/\s+$/, '');
      S.draft = { text: cur ? cur + '\n' + line : line, scroll: (S.draft && S.draft.scroll) || 0 };
    });
    D.app.toast(D.t('prefilled'));
    D.ui.focusComposer = true;
    window.location.hash = '#talk';
  }
  function scrollToEl(sel) {
    var n = document.querySelector(sel);
    if (n && n.scrollIntoView) n.scrollIntoView({ block: 'center', behavior: (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) ? 'auto' : 'smooth' });
  }

  var A = DS().actions = DS().actions || {};
  function aid(el) { return el.getAttribute('data-id'); }
  A['sx-open'] = function (el) {
    var id = aid(el), it = itemById(id);
    closeTransient();
    if (ui.open === id) { leaveEdit(); ui.open = null; ui.focus = 'row:' + id; rerender(); return; }
    leaveEdit();
    ui.open = id;
    ui.flash = null;
    var d = st.draft, inf = d ? editorInfo(d.target) : null;
    if (inf && inf.owner === id) ui.edit = { key: d.target };
    else if (it && it.src === 'gap') ui.edit = { key: 'on:' + id };
    ui.focus = ui.edit ? 'ta:' + ui.edit.key : 'row:' + id;
    rerender();
  };
  A['sx-edit'] = function (el) {
    var key = aid(el);
    if (ui.edit && ui.edit.key === key) { cancelEdit(key); return; }
    openEditor(key);
  };
  A['sx-fixopen'] = function (el) { openEditor('fix:' + aid(el)); };
  A['sx-save'] = function (el) {
    var key = aid(el), box = el.closest('.sx-edit'), ta = box && box.querySelector('textarea');
    if (ta) save(key, ta.value);
  };
  A['sx-cancel'] = function (el) { cancelEdit(aid(el)); };
  A['sx-agree'] = function (el) {
    var id = aid(el);
    ui.open = null; closeTransient();
    dispatch({ type: 'agree', id: id }, { toast: TX('t_agree'), focus: 'row:' + id, flash: id });
  };
  A['sx-away'] = function (el) {
    var id = aid(el), it = itemById(id);
    leaveEdit(); ui.open = null; closeTransient();
    dispatch({ type: 'away', id: id }, { toast: TX('t_not_now'), reply: { id: id, key: 'reply_not_now', axis: it.axis }, focus: 'awaybtn:' + it.axis, undoFocus: 'row:' + id });
  };
  A['sx-back'] = function (el) {
    var id = aid(el), it = itemById(id);
    closeTransient();
    dispatch({ type: 'back', id: id }, { toast: TX('t_back'), focus: 'row:' + id, flash: id, undoFocus: 'awaybtn:' + it.axis });
  };
  A['sx-toai'] = function (el) {
    var id = aid(el);
    ui.open = null; closeTransient();
    dispatch({ type: 'toAi', id: id }, { toast: TX('t_back'), focus: 'row:' + id, flash: id });
  };
  A['sx-use'] = function (el) {
    var id = aid(el), c = +el.getAttribute('data-arg');
    ui.open = null; closeTransient();
    dispatch({ type: 'use', id: id, cur: c }, { toast: c < 0 ? TX('t_back') : TX('t_fixed'), focus: 'row:' + id, flash: id });
  };
  A['sx-hist'] = function (el) {
    var id = aid(el);
    ui.reply = null;
    leaveEdit();
    if (ui.open && ui.open !== id) ui.open = null;
    ui.kmenu = null; ui.howwas = null;
    ui.hist = ui.hist === id ? null : id;
    ui.focus = el.getAttribute('data-fk');
    rerender();
  };
  A['sx-talk'] = function (el) {
    var it = itemById(aid(el));
    if (it) toTalk('「' + aiText(it).slice(0, 30) + '」');
  };
  A['sx-fold'] = function (el) { var ax = aid(el); closeTransient(); ui.fold[ax] = !ui.fold[ax]; ui.focus = 'fold:' + ax; rerender(); };
  A['sx-awayfold'] = function (el) { var ax = aid(el); closeTransient(); ui.awayOpen[ax] = !ui.awayOpen[ax]; ui.focus = 'awaybtn:' + ax; rerender(); };
  A['sx-ndel'] = function (el) {
    var id = aid(el), n = findBy(st.notes, id);
    if (!n) return;
    leaveEdit(); ui.open = null; closeTransient();
    dispatch({ type: 'noteDel', id: id }, { toast: TX('t_removed'), focus: n.on ? 'row:' + n.on : 'addbtn:' + n.axis, undoFocus: 'row:note:' + id, flash: 'note:' + id });
  };
  A['sx-doornot'] = function (el) {
    var id = aid(el), it = itemById(id);
    ui.open = null; closeTransient();
    dispatch({ type: 'door', id: id, val: 'not_now' }, { toast: TX('t_not_now'), focus: 'awaybtn:' + it.axis, undoFocus: 'row:' + id });
  };
  A['sx-doorback'] = function (el) {
    var id = aid(el), it = itemById(id);
    closeTransient();
    dispatch({ type: 'doorBack', id: id }, { toast: TX('t_back'), focus: 'row:' + id, flash: id, undoFocus: 'awaybtn:' + it.axis });
  };
  A['sx-goto'] = function (el) {
    var id = aid(el), it = itemById(id);
    if (!it) return;
    leaveEdit(); closeTransient();
    ui.open = id;
    if (it.fold) ui.fold[it.axis] = true;
    ui.focus = 'row:' + id;
    rerender();
    scrollToEl('[data-item="' + q(id) + '"]');
  };
  A['sx-goto-kufu'] = function () {
    closeTransient();
    ui.focus = 'kufu-h';
    rerender();
    scrollToEl('#kufu-band');
  };
  // 工夫
  A['sx-try'] = function (el) {
    var id = aid(el);
    leaveEdit(); ui.open = null; closeTransient();
    dispatch({ type: 'try', id: id }, { toast: TX('t_try'), focus: 'howwas:' + id, flash: 'idea:' + id, undoFocus: 'ktry:' + id });
  };
  A['sx-howwas'] = function (el) {
    var id = aid(el), was = ui.howwas === id;
    leaveEdit(); ui.open = null; closeTransient();
    ui.howwas = was ? null : id;
    ui.focus = was ? 'howwas:' + id : 'rfit:' + id;
    rerender();
  };
  A['sx-result'] = function (el) {
    var id = aid(el), res = el.getAttribute('data-arg'), note = rnoteVal(id);
    closeTransient();
    delete ui.rnote[id];
    dispatch({ type: 'result', id: id, result: res, note: note }, { toast: TX('t_result'), focus: res === 'fit' ? 'fitlist' : 'ktry:' + id, flash: 'idea:' + id, undoFocus: 'howwas:' + id, clearDraft: 'rnote:' + id });
  };
  A['sx-adjust'] = function (el) {
    var id = aid(el);
    ui.rnote[id] = rnoteVal(id);
    openEditor('adjust:' + id);
  };
  A['sx-kmenu'] = function (el) {
    var id = aid(el), was = ui.kmenu === id;
    leaveEdit(); ui.open = null; closeTransient();
    ui.kmenu = was ? null : id;
    ui.focus = 'kmore:' + id;
    rerender();
  };
  A['sx-kaway'] = function (el) {
    var id = aid(el), sc = null;
    ideasScene(id, function (s) { sc = s; });
    closeTransient();
    dispatch({ type: 'ideaAway', id: id }, { toast: KX('t_away'), focus: sc ? 'kfold:' + sc : null, undoFocus: 'kmore:' + id });
  };
  A['sx-kback'] = function (el) {
    var id = aid(el);
    closeTransient();
    var back = SELF.reduce(st, { type: 'ideaBack', id: id }), bs = ideaCur(back, id), focus = !bs ? 'ktry:' + id : bs.status === 'trying' ? 'howwas:' + id : (bs.result === 'fit' ? 'fitlist' : 'ktry:' + id);
    dispatch({ type: 'ideaBack', id: id }, { toast: KX('t_back'), noUndo: true, focus: focus, flash: 'idea:' + id });
  };
  A['sx-kfold'] = function (el) { var id = aid(el); closeTransient(); ui.kfold[id] = !ui.kfold[id]; ui.focus = 'kfold:' + id; rerender(); };
  A['sx-ktalk'] = function (el) {
    var id = aid(el), d = dataIdea(id), kufu = SD().kufu;
    closeTransient();
    if (d && d.idea.prefill) { toTalk(d.idea.prefill); return; }
    var sid = null;
    ideasScene(id, function (s) { sid = s; });
    toTalk(fmt(kufu.prefill.tool, { scene: sceneText(sid) }));
  };
  A['sx-kprefill'] = function (el) {
    var sid = aid(el), kind = el.getAttribute('data-arg'), kufu = SD().kufu;
    if (!kufu.prefill[kind]) return;
    toTalk(fmt(kufu.prefill[kind], { scene: sceneText(sid) }));
  };
  // 作るで作る（contract-Y §Y-5 / Y-8 の 5）: データの tool の工夫 → 作るの tool の作業台（同じ紐づけがあればそれを開く）。
  // 引用の出所は、本人が工夫を直していなければ buddy、直していれば own
  A['sx-kmake'] = function (el) {
    var id = aid(el), d = dataIdea(id), M = DS().make;
    if (!d || d.idea.kind !== 'tool' || !M || !M.openFromSelf) return;
    closeTransient();
    var e = st.kufu.ideas[id];
    M.openFromSelf({ linkId: id, text: ideaText(id), variant: d.idea.variant || 'memo', src: e && e.text ? 'own' : 'buddy' });
  };
  // 本人が書いた場面の「道具を作る」: 場面の文を引用にして tool の作業台（本人の言葉）
  A['sx-kscene-make'] = function (el) {
    var sid = aid(el), o = ownScene(sid), M = DS().make;
    if (!o || o.gone || !M || !M.openFromSelf) return;
    closeTransient();
    M.openFromSelf({ linkId: 'scene:' + sid, text: o.text, variant: 'memo', src: 'own' });
  };
  // 作業台を開く（紐づく活動。止めていれば作る側で再開）
  A['sx-kbench'] = function (el) {
    var M = DS().make;
    if (!M || !M.openAct) return;
    closeTransient();
    M.openAct(aid(el));
  };
  A['sx-kdel'] = function (el) {
    var id = aid(el), o = findBy(st.kufu.own, id);
    if (!o) return;
    closeTransient();
    dispatch({ type: 'ownDel', id: id }, { toast: TX('t_removed'), focus: 'addidea:' + o.scene, undoFocus: isFit(id) ? 'fdel:' + id : 'kmore:' + id });
  };
  A['sx-sdel'] = function (el) {
    var id = aid(el);
    leaveEdit(); ui.open = null; closeTransient();
    dispatch({ type: 'sceneDel', id: id }, { toast: TX('t_removed'), focus: 'addscene', undoFocus: 'sedit:' + id });
  };
  function ideasScene(id, cb) {
    var d = dataIdea(id);
    if (d) { cb(d.scene.id); return; }
    var o = findBy(st.kufu.own, id);
    if (o) cb(o.scene);
  }

  // ---------- アバター（V-6） ----------
  function sheet() { return document.getElementById('self-sheet'); }
  function fillSheet() {
    var dlg = sheet(), p = ui.pick, av = SD().avatar;
    dlg.textContent = '';
    dlg.appendChild(H('div', { class: 'dialog-head' }, [H('h2', { id: 'self-sheet-h' }, TX('avatar_h')),
      H('button', { class: 'icon-btn', type: 'button', 'data-action': 'dialog-close', 'aria-label': DS().t('close') }, [icon('close')])]));
    dlg.appendChild(H('div', { class: 'dialog-body' }, [
      H('div', { class: 'sx-av-preview' }, [avatarEl(p, 'preview', TX('avatar_alt'))]),
      H('fieldset', { class: 'sx-fieldset' }, [
        H('legend', null, TX('avatar_hair')),
        H('div', { class: 'sx-hairs' }, av.hairs.map(function (h) {
          return H('label', { class: 'radio-card' }, [
            H('input', { type: 'radio', name: 'sx-hair', value: h.id, checked: p.hair === h.id }),
            avatarEl({ hair: h.id, color: p.color }, 'thumb', ''),
            H('span', null, ST(h))
          ]);
        }).concat([H('label', { class: 'radio-card' }, [
          H('input', { type: 'radio', name: 'sx-hair', value: 'none', checked: p.hair === 'none' }),
          avatarEl({ hair: 'none', color: p.color }, 'thumb', ''),
          H('span', null, TX('avatar_none'))
        ])]))
      ]),
      H('fieldset', { class: 'sx-fieldset', disabled: p.hair === 'none' }, [
        H('legend', null, TX('avatar_color')),
        H('div', { class: 'sx-colors' }, av.colors.map(function (c) {
          return H('label', { class: 'sx-color' }, [
            H('input', { type: 'radio', name: 'sx-color', value: c.id, checked: p.color === c.id, disabled: p.hair === 'none' }),
            H('span', { class: 'sx-swatch', style: '--sw:' + c.hex, 'aria-hidden': 'true' }),
            H('span', { class: 'sr-only' }, ST(c))
          ]);
        }))
      ])
    ]));
    dlg.appendChild(H('div', { class: 'dialog-footer' }, [
      H('button', { class: 'btn primary small', type: 'button', 'data-action': 'sx-avatar-ok' }, TX('avatar_ok')),
      H('button', { class: 'btn small', type: 'button', 'data-action': 'dialog-close' }, TX('cancel'))
    ]));
  }
  A['sx-avatar'] = function (el) {
    var dlg = sheet();
    if (!dlg) return;
    // 開いている編集欄・行は先に閉じる（変更ありの下書きは残る）。dialog の裏に編集欄を残さない
    leaveEdit(); ui.open = null; closeTransient();
    rerender();
    ui.pick = { hair: st.avatar.hair, color: st.avatar.color };
    fillSheet();
    DS().app.openDialog(dlg, el);
    var c = dlg.querySelector('input[name="sx-hair"]:checked');
    if (c) c.focus();
  };
  A['sx-avatar-ok'] = function () {
    var dlg = sheet(), p = ui.pick;
    DS().app.closeDialog(dlg);
    if (p) dispatch({ type: 'avatar', hair: p.hair, color: p.color }, { toast: TX('t_avatar'), focus: 'avatar-change' });
  };

  // ---------- 入力の受け口 ----------
  document.addEventListener('input', function (e) {
    var t = e.target;
    if (!t || !t.getAttribute || !st) return;
    var key = t.getAttribute('data-sx-input');
    if (key) {
      setDraft({ target: key, mode: key.slice(0, key.indexOf(':')), text: t.value });
      syncSave(key, t);
      return;
    }
    var rn = t.getAttribute('data-sx-rnote');
    if (rn) {
      ui.rnote[rn] = t.value;
      var nn = SELF.reduce(st, { type: 'ideaNote', id: rn, note: t.value });
      if (nn !== st) st = nn;
      setDraft({ target: 'rnote:' + rn, mode: 'rnote', text: t.value });
      persist();
    }
  });
  document.addEventListener('change', function (e) {
    var t = e.target, dlg = sheet();
    if (!t || !dlg || !dlg.contains(t) || !ui.pick) return;
    if (t.name === 'sx-hair') ui.pick.hair = t.value;
    else if (t.name === 'sx-color') ui.pick.color = t.value;
    else return;
    fillSheet();
    var n = dlg.querySelector('input[name="' + q(t.name) + '"][value="' + q(t.value) + '"]');
    if (n) n.focus();
  });
  document.addEventListener('keydown', function (e) {
    var t = e.target;
    if (t && t.getAttribute && t.getAttribute('data-sx-input') && e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing) {
      e.preventDefault();
      save(t.getAttribute('data-sx-input'), t.value);
      return;
    }
    if (e.key !== 'Escape' || !st || !onSelf() || e.isComposing) return;
    if (document.querySelector('dialog[open]')) return;
    var id;
    // Esc の順: 編集を閉じる → 開いた行（メニュー・結果・履歴）を閉じる
    if (ui.edit) { e.preventDefault(); cancelEdit(ui.edit.key); return; }
    if (ui.kmenu) { id = ui.kmenu; ui.kmenu = null; ui.focus = 'kmore:' + id; }
    else if (ui.howwas) { id = ui.howwas; ui.howwas = null; ui.focus = 'howwas:' + id; }
    else if (ui.hist) {
      id = ui.hist; ui.hist = null;
      var hi = itemById(id);
      ui.focus = hi && isAwayItem(hi) ? 'awayhist:' + id : ui.open === id ? 'row:' + id : (rxOf(id).state === 'edited' ? 'histlink:' + id : 'row:' + id);
    }
    else if (ui.open) { id = ui.open; ui.open = null; ui.focus = 'row:' + id; }
    else return;
    e.preventDefault();
    ui.reply = null;
    rerender();
  });
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest || !st) return;
    // 予定に入れる（door）: 既存 grid-add の結果を見て、入ったときだけ door を added にする
    var g = t.closest('.self-page [data-action="grid-add"]');
    if (g && !g.disabled) {
      var act = g.getAttribute('data-id'), door = g.getAttribute('data-door'), before = countPlan(act);
      setTimeout(function () {
        if (countPlan(act) > before) { ui.open = null; dispatch({ type: 'door', id: door, val: 'added' }, { focus: 'row:' + door, flash: door }); }
      }, 0);
    }
    // 工夫の more メニューは外側のクリックで閉じる
    if (ui.kmenu && !t.closest('.kmenu') && !t.closest('[data-action="sx-kmenu"]')) {
      ui.kmenu = null;
      if (!t.closest('[data-action]')) rerender();
    }
  });
  function countPlan(act) { var p = (DS().state && DS().state.plan) || []; return p.filter(function (r) { return r.activity === act; }).length; }
  // ルートを離れたら一時の開閉は閉じ、戻ったら下書きから編集欄を開き直す
  window.addEventListener('hashchange', function () {
    var dlg = sheet();
    if (dlg && dlg.open) DS().app.closeDialog(dlg, true);
    ui.open = null; ui.edit = null; closeTransient();
    ui.restore = true;
  });
  var lastW = window.innerWidth;
  window.addEventListener('resize', function () {
    if (window.innerWidth === lastW) return;
    lastW = window.innerWidth;
    var dlg = sheet();
    if (dlg && dlg.open) DS().app.closeDialog(dlg, true);
  });
})();
