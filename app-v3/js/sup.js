/* サポーター（docs/plans/supporter-view/contract-AD.md）: 保存の包み（18-2）・入る / 出る / 帯（AD-5）・アイデア（AD-6）・sup ルートの骨組み（AD-7）。
   W2 へ: 各画面の中身は DES.sup.renderTab[name] = function (host, ctx) { ... } で足す。name = class（教室の一覧）/ today / clues / advice / log / report。
   host は空の要素（描画のたびに作り直す）。ctx = { tab, child, names, t, joined }。読む値は DES.sup.fade() / fadeLines() / howCounts() / reportDraft() / childRow() / logAll() / selfReplies()。
   書き換えは DES.app.change(fn) の中で DES.state.sup を直し、記録は DES.sup.addLog(scene, how, text, ref) で足す。#sup-dialog の中身も W2（開閉は DES.app.openDialog / closeDialog）。
   文字列は DES.sup.t(key, vars)（DES.supData.text。{sup} {child} を埋める）か、子どもに見える語は DES.t。 */
(function () {
  'use strict';
  var DES = window.DES;
  var SD = DES.supData, C = DES.supCore;
  var SUP = DES.sup = DES.sup || {};
  var TABS = ['today', 'clues', 'advice', 'log', 'report'];
  // 保存しても記録を取らないキー（表示だけの状態。§AD-3）
  var SKIP = ['draft', 'trail', 'mapUi', 'panel'];
  var snapRef = null;

  function S() { return DES.state; }
  function H() { return DES.h.apply(null, arguments); }
  function $(s) { return document.querySelector(s); }
  function merge(a, b) { var o = {}, k; for (k in a || {}) o[k] = a[k]; for (k in b || {}) o[k] = b[k]; return o; }
  function find(list, id) { for (var i = 0; i < (list || []).length; i++) if (list[i] && list[i].id === id) return list[i]; return null; }
  function trim(s) { return String(s == null ? '' : s).replace(/^\s+|\s+$/g, ''); }
  function todayStr() { var p = DES.data.today.split('-'); return (+p[1]) + '/' + (+p[2]); }
  function childId() { return DES.data.child.id; }
  function newId(p) { return DES.plan.newId(p); }
  function go(hash) { if (window.location.hash !== hash) window.location.hash = hash; else DES.app.render(); }
  function names() { return { sup: SD.supporter.name, child: DES.data.child.name }; }
  function ui() {
    var u = DES.ui;
    if (!u.sup) u.sup = { fresh: true, last: null };
    return u.sup;
  }

  // ---------- 名前と文言 ----------
  SUP.t = function (k, v) { return C.fmt(SD.text[k], merge(names(), v)); };
  SUP.names = names;
  SUP.supId = function () { return SD.supporter.id; };
  SUP.supName = function () { return SD.supporter.name; };
  // by（サポーターの id）→ 名前。このモックのサポーターは 1 人
  SUP.nameOf = function () { return SD.supporter.name; };
  // 「11/2（月）」: サポーター画面の書式（date_fmt）で作る
  SUP.dateLabel = function () { var p = DES.data.today.split('-'); return SUP.t('date_fmt', { m: +p[1], d: +p[2], w: DES.data.weekday }); };
  SUP.today = todayStr;

  // ---------- 入っているか ----------
  SUP.isJoined = function () { var st = S(); return !!(st && st.sup && st.sup.join); };
  // TK.push が付ける印（入っている間だけ）
  SUP.byNow = function () { return SUP.isJoined() ? SD.supporter.id : null; };
  SUP.stance = function () { return SUP.isJoined() ? S().sup.join.stance : 'proxy'; };
  SUP.onKid = function () { var a = DES.app.routeArg(); return DES.app.route() === 'sup' && (a === childId() || a.indexOf(childId() + '/') === 0); };
  // 作るの変化に人名を入れる（18-1）
  function syncWith() { if (DES.make && DES.make.setWith) DES.make.setWith(SUP.isJoined() ? SD.supporter.name : null); }

  function ctx() {
    return { joined: SUP.isJoined(), supId: SD.supporter.id, supName: SD.supporter.name, child: DES.data.child.name, today: todayStr(), now: DES.data.now,
      text: SD.text, tx: DES.make && DES.make.tx, newId: newId };
  }

  // ---------- 保存（AD-2 / 18-2 / 18-13）: 既存の DES.store に des3.sup を足す（make.js / trail.js と同じ包み方） ----------
  // save(only): 元の save → 成功した時だけ observe → 印を付けたキーと sup を保存し直す（失敗は saveFailed を立てるだけ・戻り値は元の save の結果）
  if (DES.store && !DES.store._sup) {
    var load4 = DES.store.load, save4 = DES.store.save;
    DES.store._sup = true;
    DES.store.load = function () {
      var s = load4.apply(DES.store, arguments), raw = null;
      try {
        var t = window.localStorage.getItem('des3.sup');
        if (t != null) raw = JSON.parse(t);
      } catch (e) { s.saveFailed = true; }
      s.sup = C.normalize(raw);
      // 読み込み時の移行で増えた分は記録しない（写しは読み込みの直後に作る）
      snapRef = C.snap(s);
      syncWith();
      return s;
    };
    DES.store.save = function (only) {
      var st = DES.state, ok = save4.call(DES.store, only), needSup = !only;
      if (only === 'sup' || !st || !st.sup) return ok;
      if (ok && SKIP.indexOf(only) < 0) {
        var r = C.observe(st, snapRef, only || null, ctx());
        snapRef = r.snap;
        if (r.log.length) { st.sup.log = C.appendLog(st.sup.log, r.log); needSup = true; }
        r.touched.forEach(function (k) {
          if (k === 'sup') { needSup = true; return; }
          if (!save4.call(DES.store, k)) st.saveFailed = true;
        });
      }
      if (needSup && !save4.call(DES.store, 'sup')) st.saveFailed = true;
      return ok;
    };
  }

  // ---------- 記録を足す（サポーター画面の入力・入る / 出る・話す の 3 人目。コミットは呼び出し側） ----------
  SUP.addLog = function (scene, how, text, ref) {
    var st = S();
    st.sup.log = C.appendLog(st.sup.log, [{ id: newId('l'), day: todayStr(), time: DES.data.now, scene: scene, how: how, text: String(text == null ? '' : text), ref: ref || {} }]);
  };

  // ---------- 入る・出る（AD-5 / 18-9） ----------
  function enter() {
    var st = S();
    st.sup.join = { child: childId(), stance: 'proxy', since: DES.data.now };
    snapRef = C.snap(st);
    syncWith();
    SUP.addLog('join', 'in', SUP.t('log_in'));
  }
  SUP.join = function () {
    if (!SUP.isJoined()) DES.app.change(enter);
    go('#talk');
  };
  SUP.leave = function (dest) {
    dest = dest || '#sup/' + childId() + '/log';
    if (SUP.isJoined()) {
      DES.app.change(function () {
        SUP.addLog('join', 'out', SUP.t('log_out'));
        S().sup.join = null;
        syncWith();
      });
    }
    go(dest);
    DES.app.toast(SUP.t('left_toast'));
  };
  SUP.setStance = function (s) {
    if (!SUP.isJoined() || C.STANCES.indexOf(s) < 0) return;
    S().sup.join.stance = s;
    if (!DES.store.save('sup')) { S().saveFailed = true; DES.app.renderSaveState(); }
    if (DES.talk.syncStance) DES.talk.syncStance();
  };

  // ---------- 話す: {sup}として話す / アイデア（AD-6 / 18-5） ----------
  SUP.voice = function (text) {
    var t = String(text == null ? '' : text), mid = newId('t');
    if (!trim(t)) return;
    DES.app.change(function () {
      DES.talk.push({ id: mid, time: DES.data.now, who: 'supporter', by: SD.supporter.id, text: t });
      SUP.addLog('talk', 'voice', t, { msg: mid });
    });
  };
  // 入口は 2 つ（入っている間の stance = idea の送信 / 個別画面「今日」の「アイデアを出す」）で同じ関数
  SUP.postIdea = function (text) {
    var t = trim(text);
    if (!t) return null;
    var item = DES.plan.match(t), id = newId('i'), mid = newId('t');
    var idea = { id: id, msgId: mid, text: t, catalogId: item ? item.id : null, state: 'open', day: todayStr(), time: DES.data.now };
    DES.ui.sending = true;
    DES.app.change(function () {
      S().sup.ideas = (S().sup.ideas || []).concat([idea]);
      DES.talk.push({ id: mid, time: DES.data.now, who: 'supporter', by: SD.supporter.id, idea: id, text: t });
      SUP.addLog('talk', 'idea', t, { msg: mid, idea: id });
    });
    DES.talk.syncSend();
    setTimeout(function () {
      var bid = newId('t'), v = { sup: SD.supporter.name };
      if (item) v.title = item.title;
      DES.app.change(function () {
        DES.talk.push({ id: bid, time: DES.data.now, who: 'buddy', ideaReply: id, text: DES.t(item ? 'idea_rep_match' : 'idea_rep_free', v) });
      });
      DES.ui.sending = false;
      DES.talk.syncSend();
      DES.talk.keepComposerInView();
    }, 150);
    return idea;
  };
  SUP.ideas = function () { return S().sup.ideas || []; };
  SUP.idea = function (id) { return find(SUP.ideas(), id); };
  SUP.ideaText = function (id) { var x = SUP.idea(id); return x ? x.text : null; };
  // 表示に使う状態（18-4）: 行・活動が無くなっていれば open と同じ
  SUP.ideaView = function (id) {
    var x = SUP.idea(id);
    if (!x) return null;
    var st = x.state, row = null, act = null;
    if (st === 'planned') { row = find(S().plan, x.rowId); if (!row) st = 'open'; }
    if (st === 'made') { act = find(S().activities, x.actId); if (!act) st = 'open'; }
    return { idea: x, state: st, row: row, act: act };
  };
  // 取り下げられるのは 返事待ち・あとで の時だけ（作るで試している・予定に入っている時は出さない）
  SUP.canWithdraw = function (id) { var v = SUP.ideaView(id); return !!v && (v.state === 'open' || v.state === 'later'); };
  SUP.ideaMake = function (id) {
    var x = SUP.idea(id);
    if (!x) return;
    DES.make.fromSupIdea({ id: id, text: x.text, onAdded: function (a) { x.state = 'made'; x.actId = a.id; } });
  };
  SUP.ideaOpen = function (id) { var v = SUP.ideaView(id); if (v && v.act) DES.make.openAct(v.act.id); };
  SUP.ideaPlan = function (id) {
    var x = SUP.idea(id);
    if (!x || !x.catalogId || !DES.plan.item(x.catalogId)) return;
    DES.plan.act.addFirst(x.catalogId, { idea: id, undo: true, after: { focus: 'idea:' + id }, onAdded: function (row) { x.state = 'planned'; x.rowId = row.id; } });
  };
  SUP.ideaLater = function (id) {
    var x = SUP.idea(id);
    if (!x) return;
    DES.app.change(function () { x.state = 'later'; }, { focus: 'idea:' + id });
    DES.app.toast(DES.t('idea_later_toast'));
  };
  SUP.ideaWithdraw = function (id) {
    var x = SUP.idea(id);
    if (!x || !SUP.canWithdraw(id)) return;
    var prev = x.state;
    DES.app.change(function () {
      x.state = 'withdrawn';
      SUP.addLog('talk', 'desk', SUP.t('log_idea_withdraw', { text: x.text }), { msg: x.msgId, idea: id });
    }, { focus: 'idea:' + id });
    DES.app.toast(SUP.t('withdrawn_toast'), { label: SUP.t('undo'), fn: function () {
      DES.app.change(function () {
        x.state = prev;
        SUP.addLog('talk', 'desk', SUP.t('log_idea_back', { text: x.text }), { msg: x.msgId, idea: id });
      }, { focus: 'idea:' + id });
    } });
  };
  // あしあとの「自分で」に渡す（18-7 / 18-13）
  SUP.helped = function () { var st = S(); return st && st.sup ? st.sup.helped : { odai: {} }; };

  // ---------- W2 が読む値（純関数を今の状態で呼ぶ） ----------
  SUP.fade = function () { return C.fade({ weeks: SD.weeks, thisWeek: SD.thisWeek, scenes: SD.scenes, state: S(), messages: DES.talk.messages(), today: todayStr() }); };
  SUP.fadeLines = function (f) { return C.fadeLines(f || SUP.fade(), SD.text, names()); };
  SUP.howCounts = function () { return C.howCounts(S().sup.log, SD.thisWeek.days); };
  SUP.reportDraft = function () {
    var f = SUP.fade(), rp = S().sup.report;
    return C.reportDraft({ report: SD.report, fade: f, lines: C.fadeLines(f, SD.text, names()), plan: S().plan, text: SD.text, names: names(), edits: rp.edits, off: rp.off });
  };
  SUP.childRow = function () {
    return C.childRow({ plan: S().plan, messages: DES.talk.messages(), ideas: SUP.ideas(), joined: SUP.isJoined(), now: DES.data.now, child: DES.data.child, mode: DES.mode(), text: SD.text });
  };
  // 記録の全部（seed の過去の日 + このブラウザの記録。並べ替えは W2）
  SUP.logAll = function () { return (SD.log || []).concat(S().sup.log || []); };
  // 自己理解の本人の返事（18-8）: des3.self を読み、DES.self.validate に通す。読めなければ {}（書かない）
  SUP.selfReplies = function () {
    try {
      var raw = window.localStorage.getItem('des3.self');
      if (raw == null || !DES.self || !DES.self.validate) return {};
      var v = DES.self.validate(JSON.parse(raw));
      return v && v.rx ? v.rx : {};
    } catch (e) { return {}; }
  };

  // ---------- 帯（AD-5） ----------
  function smallBtn(label, action, arg) { return H('button', { class: 'btn small', type: 'button', 'data-action': action, 'data-arg': arg }, label); }
  SUP.renderBand = function (r) {
    var el = $('#join-band');
    if (!el) return;
    var on = SUP.isJoined();
    el.textContent = '';
    el.hidden = !on;
    if (!on) { el.removeAttribute('aria-label'); return; }
    el.setAttribute('aria-label', SUP.t('band_label'));
    var left, right;
    if (r === 'sup') {
      left = [H('strong', null, SUP.t('band_sup'))];
      right = [smallBtn(SUP.t('band_back'), 'sup-nav', '#talk'), smallBtn(SUP.t('band_leave'), 'sup-leave', '')];
    } else {
      left = [H('strong', null, SUP.t('band_in')), H('small', null, SUP.t(r === 'self' ? 'band_self' : 'band_note'))];
      right = [smallBtn(SUP.t('band_log'), 'sup-nav', '#sup/' + childId() + '/log'), smallBtn(SUP.t('band_leave'), 'sup-leave', '')];
    }
    el.appendChild(H('div', { class: 'jb-text' }, left));
    el.appendChild(H('div', { class: 'jb-ops' }, right));
  };

  // ---------- sup ルートの骨組み（AD-4 / AD-7。中身は W2 が renderTab に書く） ----------
  function noop() {}
  SUP.renderTab = SUP.renderTab || {};
  ['class'].concat(TABS).forEach(function (k) { if (!SUP.renderTab[k]) SUP.renderTab[k] = noop; });
  // '' → 教室 / '<child>' → 今日 / '<child>/<tab>' / '<child>/in'。知らない子・タブは null
  function parse(arg) {
    if (!arg) return { page: 'class' };
    var p = arg.split('/');
    if (p[0] !== childId() || p.length > 2) return null;
    if (p.length === 1) return { page: 'kid', tab: 'today' };
    if (p[1] === 'in') return { page: 'in' };
    return TABS.indexOf(p[1]) > 0 ? { page: 'kid', tab: p[1] } : null;
  }
  function tabHash(k) { return '#sup/' + childId() + (k === 'today' ? '' : '/' + k); }
  function headEl(kids) { return H('div', { class: 'page-head sup-head' }, kids); }
  SUP.render = function (main, arg) {
    var p = parse(arg), u = ui();
    if (!p) {
      main.textContent = '';
      window.location.replace('#sup');
      DES.app.toast(SUP.t('not_found'));
      return;
    }
    // #sup/<child>/in: 入った状態にして #talk へ（既に入っていればそのまま）
    if (p.page === 'in') {
      main.textContent = '';
      if (!SUP.isJoined()) { enter(); DES.store.save(); }
      window.location.replace('#talk');
      return;
    }
    var key = p.page === 'kid' ? 'kid:' + p.tab : 'class', cx = { tab: p.tab || 'class', child: DES.data.child, names: names(), t: SUP.t, joined: SUP.isJoined() };
    var host = H('div', { class: 'sup-body', id: 'sup-body' }), kids;
    main.textContent = '';
    if (p.page === 'class') {
      kids = [headEl([H('div', null, [H('h1', { tabindex: '-1', 'data-fk': 'sup-h' }, SUP.t('class_h')), H('p', null, SUP.t('class_sub', { date: SUP.dateLabel(), group: DES.data.group }))])]), host];
    } else {
      var j = SUP.isJoined();
      var main1 = j ? H('button', { class: 'btn orange', type: 'button', 'data-action': 'sup-nav', 'data-arg': '#talk' }, SUP.t('band_back'))
        : H('button', { class: 'btn orange', type: 'button', 'data-action': 'sup-join' }, SUP.t('join'));
      kids = [
        H('p', { class: 'sup-back' }, [H('a', { class: 'link-btn', href: '#sup' }, SUP.t('back_class'))]),
        headEl([H('div', null, [H('h1', { tabindex: '-1', 'data-fk': 'sup-h' }, DES.data.child.name),
          H('p', null, SUP.t('kid_sub', { mode: SUP.t(DES.mode() === 'es' ? 'mode_es' : 'mode_js'), date: SUP.dateLabel() }))]), H('div', { class: 'sup-head-ops' }, [main1])]),
        H('nav', { class: 'segmented sup-tabs', 'aria-label': SUP.t('tabs_label') }, TABS.map(function (k) {
          var on = k === p.tab;
          return H('a', { href: tabHash(k), class: on ? 'active' : '', 'aria-current': on ? 'page' : null, 'data-fk': 'sup-tab:' + k }, SUP.t('tab_' + k));
        })),
        host
      ];
    }
    main.appendChild(H('div', { class: 'sup-page', 'data-sup-page': key }, kids));
    SUP.renderTab[p.page === 'class' ? 'class' : p.tab](host, cx);
    // 開いたら h1（tabindex=-1）。個別画面でタブを移った時は、そのタブのリンクに残す（18-9）
    if (u.fresh) {
      var n = p.page === 'kid' && u.last && u.last.indexOf('kid:') === 0 && u.last !== key ? main.querySelector('[data-fk="sup-tab:' + p.tab + '"]') : main.querySelector('h1');
      if (n) n.focus();
    }
    u.fresh = false;
    u.last = key;
  };
  // ルートが変わったら（app.js の closeTransient から）。sup の外へ出たら、次に開いた時は h1 へ
  SUP.resetUi = function () {
    var u = ui();
    u.fresh = true;
    if (DES.app.route() !== 'sup') u.last = null;
  };

  // ---------- 操作 ----------
  var A = DES.actions = DES.actions || {};
  A['sup-nav'] = function (el) { go(el.getAttribute('data-arg') || '#sup'); };
  A['sup-join'] = function () { SUP.join(); };
  A['sup-leave'] = function () { SUP.leave(); };
  A['sup-stance'] = function (el) { SUP.setStance(el.getAttribute('data-arg')); };
  A['idea-make'] = function (el) { SUP.ideaMake(el.getAttribute('data-id')); };
  A['idea-open'] = function (el) { SUP.ideaOpen(el.getAttribute('data-id')); };
  A['idea-plan'] = function (el) { SUP.ideaPlan(el.getAttribute('data-id')); };
  A['idea-later'] = function (el) { SUP.ideaLater(el.getAttribute('data-id')); };
  A['idea-withdraw'] = function (el) { SUP.ideaWithdraw(el.getAttribute('data-id')); };
})();
