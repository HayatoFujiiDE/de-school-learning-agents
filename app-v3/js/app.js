/* シェル: ルーティング・サイドバー・topbar・下タブ・パネル開閉・表示モード・トースト・ダイアログ。
   状態の変更は DES.app.change(fn) → fn で DES.state を書く → DES.store.save() → DES.app.render() の 1 経路。 */
window.DES = window.DES || {};
(function () {
  'use strict';
  var DES = window.DES;
  var APP = DES.app = DES.app || {};
  var A = DES.actions = DES.actions || {};
  // 24 viewBox・stroke 1.65 の線画。nav 7 種は reference/codex-mock/nav-icons.md の path、他は CONTRACT-v3 §F
  var ICONS = {
    talk: 'M4 4h16v12H9l-5 4V4Z M8 9h8 M8 12h5',
    make: 'm4 17 11-11 3 3L7 20H4v-3Z M14 7l3 3 M16 5l2-2 3 3-2 2',
    works: 'M3 5h7l2 3h9v12H3V5Z M8 14h8 M12 11v6',
    today: 'M12 3v3 M12 18v3 M3 12h3 M18 12h3 M5.6 5.6l2 2 M16.4 16.4l2 2 M5.6 18.4l2-2 M16.4 7.6l2-2 M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
    self: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M4 21v-3a8 8 0 0 1 16 0v3',
    map: 'M5 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6 M18 14a3 3 0 1 0 0-6 3 3 0 0 0 0 6 M7 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6 M8 6l7 4 M16 14l-6 4 M5 8l1 8',
    trail: 'M3 11a9 9 0 1 1 3 8 M3 4v7h7 M12 7v6l4 2',
    calendar: 'M4 5h16v15H4z M4 9h16 M8 3v4 M16 3v4',
    close: 'M6 6l12 12 M18 6L6 18',
    plus: 'M12 5v14 M5 12h14',
    chat: 'M4 4h16v12H9l-5 4V4Z M8 9h8 M8 12h5',
    up: 'M12 19V5 M5 12l7-7 7 7',
    down: 'M12 5v14 M5 12l7 7 7-7',
    more: 'M5 12h.01 M12 12h.01 M19 12h.01',
    check: 'M5 12l5 5L20 7',
    drag: 'M9 6h.01 M15 6h.01 M9 12h.01 M15 12h.01 M9 18h.01 M15 18h.01',
    quote: 'M7 7h4v4H7z M13 7h4v4h-4z M7 11c0 3-2 4-2 4 M13 11c0 3-2 4-2 4',
    record: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M9 12l2 2 4-4',
    spark: 'M12 3v4 M12 17v4 M3 12h4 M17 12h4 M6 6l2.5 2.5 M15.5 15.5 18 18 M6 18l2.5-2.5 M15.5 8.5 18 6',
    lock: 'M6 11h12v9H6z M9 11V7a3 3 0 0 1 6 0v4',
    pause: 'M8 5v14 M16 5v14',
    camera: 'M4 8h4l2-2h4l2 2h4v11H4z M12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7',
    mic: 'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3 M5 11a7 7 0 0 0 14 0 M12 18v3',
    send: 'M4 12l16-8-6 16-2-6-8-2z',
    menu: 'M4 7h16 M4 12h16 M4 17h16',
    sliders: 'M4 6h10 M18 6h2 M14 4v4 M4 12h2 M10 12h10 M6 10v4 M4 18h12 M20 18h2 M16 16v4'
  };
  var THICK = { more: 3, drag: 3 };
  DES.icon = function (name) {
    var d = ICONS[name];
    if (!d) return '';
    return '<svg class="ico" aria-hidden="true" viewBox="0 0 24 24"' + (THICK[name] ? ' style="stroke-width:' + THICK[name] + '"' : '') + '><path d="' + d + '"/></svg>';
  };
  // DOM ヘルパ: 文字列の子要素はテキストノード（innerHTML に入れない）
  function append(el, kids) {
    if (kids == null || kids === false) return;
    if (Array.isArray(kids)) { kids.forEach(function (k) { append(el, k); }); return; }
    if (typeof kids === 'string' || typeof kids === 'number') { el.appendChild(document.createTextNode(String(kids))); return; }
    el.appendChild(kids);
  }
  DES.h = function (tag, attrs, kids) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'value') el.value = v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    });
    append(el, kids);
    return el;
  };
  // 固定の SVG / ruby 文字列だけを通す（DES.buddy / DES.icon / i18n の RUBY）
  DES.raw = function (html) { var t = document.createElement('template'); t.innerHTML = html; return t.content; };

  var H = DES.h;
  function T(k, v) { return DES.t(k, v); }
  function icon(n) { return DES.raw(DES.icon(n)); }
  function $(s) { return document.querySelector(s); }
  function esc(v) { return window.CSS && CSS.escape ? CSS.escape(v) : String(v).replace(/"/g, '\\"'); }
  var ROUTES = ['talk', 'plan', 'make', 'works', 'today', 'self', 'map', 'trail', 'paused'];
  var NAV = ['talk', 'make', 'works', 'today', 'self', 'map', 'trail'];

  // #make/<id>（作業台）と #works/capture は前方一致（CONTRACT-v3 §U-3）。他は完全一致
  var PREFIX = ['make', 'works'];
  function route() {
    var h = window.location.hash.replace(/^#/, ''), base = h.split('/')[0];
    if (PREFIX.indexOf(base) >= 0) return base;
    return ROUTES.indexOf(h) >= 0 ? h : 'talk';
  }
  APP.route = route;
  APP.routeArg = function () {
    var h = window.location.hash.replace(/^#/, ''), i = h.indexOf('/');
    return PREFIX.indexOf(route()) >= 0 && i >= 0 ? h.slice(i + 1) : '';
  };
  APP.bp = function () {
    var mm = function (q) { return window.matchMedia ? window.matchMedia(q).matches : false; };
    if (mm('(max-width:700px)')) return 's';
    if (mm('(max-width:950px)')) return 'm';
    if (mm('(max-width:1120px)')) return 'l';
    return 'xl';
  };
  function motionOK() { return !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  function panelShown(r) {
    var b = APP.bp();
    if (r === 'make') return !!DES.ui.planOpen;
    if (r !== 'talk') return false;
    return (b === 'xl' || b === 'l') ? DES.state.panel === 'open' : !!DES.ui.planOpen;
  }

  // ---------- フォーカスの保持（再描画で要素が作り直されるため、キーで探し直す） ----------
  function keySel(el) {
    if (!el || !el.getAttribute || el === document.body) return null;
    var a = el.getAttribute('data-action');
    if (a) {
      var s = '[data-action="' + esc(a) + '"]';
      ['data-id', 'data-arg', 'data-route'].forEach(function (k) { var v = el.getAttribute(k); if (v != null) s += '[' + k + '="' + esc(v) + '"]'; });
      return s;
    }
    var fk = el.getAttribute('data-fk');
    if (fk) return '[data-fk="' + esc(fk) + '"]';
    if (el.id) return '#' + esc(el.id);
    return null;
  }
  function isShown(n) {
    if (n.disabled || !n.getClientRects().length) return false;
    return window.getComputedStyle(n).visibility !== 'hidden';
  }
  function findVisible(sel) {
    if (!sel) return null;
    var list = document.querySelectorAll(sel);
    for (var i = 0; i < list.length; i++) { if (isShown(list[i])) return list[i]; }
    return null;
  }
  APP.focusKey = function (action, id) { var n = findVisible('[data-action="' + esc(action) + '"][data-id="' + esc(id) + '"]'); if (n) n.focus(); };
  APP.focusFk = function (fk) { var n = findVisible('[data-fk="' + esc(fk) + '"]'); if (n) n.focus(); };

  APP.commit = function (o) {
    o = o || {};
    DES.ui.leaving = false;
    var ae = document.activeElement, k = keySel(ae);
    var cf = ae && ae.closest ? ae.closest('[data-fk]') : null, cfk = cf ? cf.getAttribute('data-fk') : null;
    DES.store.save();
    APP.render();
    if (ae && ae !== document.body && document.contains(ae) && document.activeElement === ae) return;
    var fk = o.focusFn ? o.focusFn() : o.focus;
    var t = findVisible(k) || (o.sel && findVisible(o.sel)) || (cfk && findVisible('[data-fk="' + esc(cfk) + '"]')) || (fk && findVisible('[data-fk="' + esc(fk) + '"]'));
    if (t) t.focus();
  };
  APP.change = function (fn, o) {
    o = o || {};
    if (o.leave && motionOK()) {
      var els = document.querySelectorAll('.row[data-id="' + esc(o.leave) + '"]');
      if (els.length) {
        Array.prototype.forEach.call(els, function (n) { n.style.maxHeight = n.offsetHeight + 'px'; void n.offsetHeight; n.classList.add('leave'); });
        DES.ui.leaving = true;
        setTimeout(function () { fn(); APP.commit(o); }, 200);
        return;
      }
    }
    fn();
    APP.commit(o);
  };

  // ---------- トースト（戻す・明日にとっておく は 5 秒） ----------
  // plan-dialog が開いている間はその内側の末尾に置く（modal の外は操作できないため。T-2）
  var toastTimer = null, toastFn = null, toastGone = null;
  function placeToast() {
    var el = $('#toast'), host = document.body;
    ['#plan-dialog', '#make-dialog', '#works-dialog'].forEach(function (s) { var d = $(s); if (d && d.open) host = d; });
    if (el.parentNode !== host) host.appendChild(el);
  }
  APP.toast = function (text, action) {
    var el = $('#toast');
    clearTimeout(toastTimer); clearTimeout(toastGone);
    placeToast();
    el.hidden = false;
    el.textContent = '';
    el.appendChild(H('span', { class: 'toast-text' }, text));
    if (action) {
      toastFn = action.fn;
      el.appendChild(H('button', { class: 'toast-btn', type: 'button', 'data-action': 'toast-act' }, action.label));
      el.classList.add('actionable');
    } else { toastFn = null; el.classList.remove('actionable'); }
    void el.offsetWidth;
    el.classList.add('visible');
    toastTimer = setTimeout(APP.toastHide, action ? 5000 : 2600);
  };
  // 期限後は hidden を付け、ボタンを DOM から外す（T-2）
  APP.toastHide = function () {
    var el = $('#toast');
    clearTimeout(toastTimer); clearTimeout(toastGone);
    toastFn = null;
    el.classList.remove('visible', 'actionable');
    var b = el.querySelector('.toast-btn');
    if (b) b.parentNode.removeChild(b);
    toastGone = setTimeout(function () { if (!el.classList.contains('visible')) el.hidden = true; }, 220);
  };
  A['toast-act'] = function () { var fn = toastFn; APP.toastHide(); if (fn) fn(); };

  // ---------- ダイアログ（<dialog> + showModal。閉じたら開いたボタンへ戻す） ----------
  APP.openDialog = function (dlg, opener) {
    dlg._returnKey = keySel(opener || document.activeElement);
    if (!dlg.open) dlg.showModal();
  };
  APP.closeDialog = function (dlg, noReturn) {
    if (!dlg) return;
    if (noReturn) dlg._returnKey = null;
    if (dlg.open) { dlg.close(); afterClose(dlg); }
  };
  // 後片付けとフォーカス戻し。closeDialog からは同期で、Esc（native の close）からは close イベントで呼ぶ。
  // close イベントは遅れて・複数回届くことがあるため冪等にする（開き直した後に届いた分も無視）
  function onDialogClose(e) { afterClose(e.target); }
  function afterClose(dlg) {
    if (dlg.open) return;
    if (dlg.id === 'plan-dialog' && DES.ui.planOpen) {
      DES.ui.planOpen = false;
      DES.ui.seen.dialog = null;
      DES.ui.menu = null;
      var tEl = $('#toast');
      if (tEl.parentNode === dlg) document.body.appendChild(tEl);
      dlg.textContent = '';
      renderTopbar(route());
    }
    if (dlg.id === 'nav-drawer') dlg.textContent = '';
    var key = dlg._returnKey;
    dlg._returnKey = null;
    if (key) { var n = findVisible(key); if (n) n.focus(); }
  }
  function renderPlanDialog() {
    var dlg = $('#plan-dialog');
    if (!DES.ui.planOpen) return;
    var aside = dlg.querySelector('.plan-panel');
    if (!aside) { aside = H('aside', { class: 'plan-panel', 'aria-label': T('plan') }); dlg.appendChild(aside); }
    DES.plan.renderPanel(aside, { ctx: 'dialog', compact: true });
  }
  APP.openPlan = function (opener) {
    var dlg = $('#plan-dialog');
    DES.ui.planOpen = true;
    DES.ui.seen.dialog = null;
    dlg.setAttribute('aria-label', T('plan'));
    renderPlanDialog();
    APP.openDialog(dlg, opener);
    placeToast();
    renderTopbar(route());
    var h = dlg.querySelector('h2');
    if (h) h.focus();
  };
  APP.closePlanDialog = function () { var d = $('#plan-dialog'); if (d && d.open) APP.closeDialog(d, true); };
  APP.openMode = function (opener) {
    var dlg = $('#mode-dialog'), cur = DES.state.mode;
    dlg.textContent = '';
    dlg.appendChild(H('div', { class: 'dialog-head' }, [H('h2', { id: 'mode-h' }, T('choose_mode'))]));
    dlg.appendChild(H('div', { class: 'dialog-body' }, [H('div', { class: 'mode-options', role: 'radiogroup', 'aria-labelledby': 'mode-h' }, ['js', 'es'].map(function (m) {
      return H('label', { class: 'radio-card' }, [H('input', { type: 'radio', name: 'mode-pick', value: m, checked: cur === m }), H('span', null, T('mode_' + m))]);
    }))]));
    dlg.appendChild(H('div', { class: 'dialog-footer' }, [
      H('button', { class: 'btn primary', type: 'button', 'data-action': 'mode-ok' }, T('confirm_mode')),
      H('button', { class: 'btn', type: 'button', 'data-action': 'dialog-close' }, T('cancel'))
    ]));
    APP.openDialog(dlg, opener);
    var c = dlg.querySelector('input:checked');
    if (c) c.focus();
  };
  A['mode-ok'] = function () {
    var dlg = $('#mode-dialog'), sel = dlg.querySelector('input[name="mode-pick"]:checked');
    var v = sel ? sel.value : DES.state.mode;
    APP.closeDialog(dlg);
    if (v !== DES.state.mode) APP.change(function () { DES.state.mode = v === 'es' ? 'es' : 'js'; });
  };
  A['dialog-close'] = function (el) { var d = el.closest('dialog'); if (d) APP.closeDialog(d); };

  // ---------- 左メニュー（≤ 700 の drawer。<dialog> + showModal / T-2。中身はサイドバーと同じ） ----------
  function openMenu(opener) {
    var dlg = $('#nav-drawer'), aside = H('aside', { class: 'sidebar' });
    dlg.textContent = '';
    dlg.appendChild(aside);
    fillSidebar(aside, route());
    dlg.setAttribute('aria-label', T('nav_label'));
    APP.openDialog(dlg, opener);
    var c = dlg.querySelector('.mobile-close');
    if (c) c.focus();
  }
  function closeMenu(returnFocus) {
    var dlg = $('#nav-drawer');
    if (dlg && dlg.open) APP.closeDialog(dlg, !returnFocus);
  }
  A['menu-open'] = function (el) { openMenu(el); };
  A['menu-close'] = function () { closeMenu(true); };

  // ---------- シェルの描画 ----------
  function renderPreview() {
    var el = $('#preview-bar');
    el.textContent = '';
    el.appendChild(H('div', { class: 'preview-name' }, [H('span', { class: 'preview-dot' }), H('span', null, T('preview'))]));
    el.appendChild(H('div', { class: 'role-tabs', role: 'group', 'aria-label': T('role_tabs') }, [
      H('button', { type: 'button', class: 'active', 'aria-pressed': 'true' }, T('role_child')),
      H('button', { type: 'button', disabled: true }, T('role_supporter')),
      H('button', { type: 'button', disabled: true }, T('role_factory')),
      H('button', { type: 'button', disabled: true }, T('role_design'))
    ]));
  }
  function navLabel(k) { var html = DES.tNavHTML(k); return html ? DES.raw(html) : T(k); }
  function renderSidebar(r) { fillSidebar($('#sidebar'), r); }
  function fillSidebar(sb, r) {
    var d = DES.data, cur = r === 'plan' ? 'talk' : r;
    // 「続きをする」の中身: 最後に止めたのが作るの活動なら その名前と次にすること（§U-11 指摘 4）
    var ri = DES.make.resumeInfo(), resumeTitle = ri ? ri.title : d.resume.title, resumeNext = ri ? ri.next : d.resume.next;
    sb.textContent = '';
    sb.appendChild(H('button', { class: 'icon-btn mobile-menu mobile-close', type: 'button', 'data-action': 'menu-close', 'aria-label': T('menu_close') }, [icon('close')]));
    sb.appendChild(H('div', { class: 'brand' }, [H('div', { class: 'brand-word' }, ['DE', H('span', null, '-'), 'SCHOOL']), H('div', { class: 'brand-sub' }, T('brand_sub'))]));
    sb.appendChild(H('nav', { class: 'nav', 'aria-label': T('nav_label') }, NAV.map(function (k) {
      var on = k === cur;
      return H('button', { type: 'button', 'data-action': 'nav', 'data-route': k, 'aria-label': T(k), title: T(k), class: on ? 'active' : '', 'aria-current': on ? 'page' : null },
        [icon(k), H('span', { class: 'nav-label' }, [navLabel(k)])]);
    })));
    sb.appendChild(H('div', { class: 'sidebar-bottom' }, [
      H('button', { class: 'resume-mini', type: 'button', 'data-action': 'resume', 'data-arg': 'side' }, [
        H('small', null, [icon('chat'), ' ', T('resume')]),
        H('strong', null, resumeTitle),
        H('span', { class: 'resume-next' }, resumeNext)
      ]),
      H('div', { class: 'profile' }, [
        H('span', { class: 'avatar', 'aria-hidden': 'true' }, d.child.name.charAt(0)),
        H('div', { class: 'profile-text' }, [H('strong', { style: 'font-size:12px' }, d.child.name), H('p', { class: 'muted' }, T(DES.state.mode === 'es' ? 'mode_view_es' : 'mode_view_js'))]),
        H('button', { type: 'button', 'data-action': 'settings', 'data-arg': 'side', 'aria-label': T('settings'), 'aria-haspopup': 'dialog' }, [icon('sliders')])
      ]),
      H('button', { class: 'reset-link', type: 'button', 'data-action': 'reset' }, T('reset'))
    ]));
  }
  function renderTopbar(r) {
    var tb = $('#topbar'), st = DES.state, crumb = r === 'paused' ? 'done_today' : r;
    tb.textContent = '';
    tb.appendChild(H('div', { class: 'tb-left' }, [
      H('button', { class: 'icon-btn mobile-menu mobile-open', type: 'button', 'data-action': 'menu-open', 'aria-label': T('menu_open'), 'aria-haspopup': 'dialog' }, [icon('menu')]),
      H('div', { class: 'breadcrumb' }, [
        H('span', { class: 'crumb-base' }, T('crumb_base')),
        H('span', { class: 'crumb-base', 'aria-hidden': 'true' }, '/'),
        H('strong', null, T(crumb))
      ])
    ]));
    var toggle = r === 'plan'
      ? H('button', { class: 'top-link back-talk', type: 'button', 'data-action': 'plan-toggle' }, [icon('chat'), H('span', null, T('back_talk'))])
      : H('button', { class: 'top-link plan-toggle', type: 'button', 'data-action': 'plan-toggle', 'aria-pressed': panelShown(r) ? 'true' : 'false' }, [icon('calendar'), H('span', null, T('plan'))]);
    tb.appendChild(H('div', { class: 'top-actions' }, [
      H('span', { class: 'save-indicator' + (st.saveFailed ? ' fail' : '') }, T(st.saveFailed ? 'save_fail' : 'saved')),
      H('button', { class: 'top-link', type: 'button', 'data-action': 'resume', 'data-arg': 'top' }, [icon('chat'), H('span', null, T('resume'))]),
      toggle,
      H('button', { class: 'top-link', type: 'button', 'data-action': 'settings', 'data-arg': 'top', 'aria-haspopup': 'dialog' }, [icon('sliders'), H('span', null, T('settings'))])
    ]));
  }
  APP.renderSaveState = function () { renderTopbar(route()); };
  function renderTabbar(r) {
    var tb = $('#tabbar');
    tb.textContent = '';
    tb.setAttribute('aria-label', T('tabbar'));
    [['talk', 'talk'], ['make', 'make'], ['works', 'works'], ['today', 'today_tab']].forEach(function (p) {
      var on = p[0] === r || (p[0] === 'talk' && r === 'plan');
      tb.appendChild(H('button', { type: 'button', 'data-action': 'nav', 'data-route': p[0], 'data-arg': 'tab', class: on ? 'active' : '', 'aria-current': on ? 'page' : null }, [icon(p[0]), H('span', null, T(p[1]))]));
    });
    tb.appendChild(H('button', { type: 'button', 'data-action': 'menu-open', 'data-arg': 'tab' }, [icon('more'), H('span', null, T('more'))]));
  }

  APP.render = function () {
    var st = DES.state, u = DES.ui, r = route();
    document.documentElement.setAttribute('data-mode', st.mode === 'es' ? 'es' : 'js');
    renderSidebar(r);
    renderTopbar(r);
    renderTabbar(r);
    var main = $('#main'), key = r + '|' + APP.routeArg() + '|' + st.mode, rebuild = u.built !== key;
    u.built = key;
    if (r === 'talk') DES.talk.renderPage(main, rebuild);
    else if (r === 'plan') DES.plan.renderPage(main);
    else if (r === 'make') DES.make.render(main, APP.routeArg());
    else if (r === 'works') DES.works.render(main, APP.routeArg());
    else if (r === 'self') DES.self.render(main);
    else if (rebuild) {
      if (r === 'paused') { if (DES.make.pausedAct()) DES.make.renderPaused(main); else DES.talk.renderPaused(main); }
      else { main.textContent = ''; main.appendChild(H('p', { class: 'empty-line' }, T('not_yet'))); }
    }
    renderPlanDialog();
  };

  // ---------- 操作 ----------
  A['nav'] = function (el) {
    closeMenu(false);
    var r = el.getAttribute('data-route');
    if (route() !== r) window.location.hash = '#' + r;
  };
  A['resume'] = function () {
    closeMenu(false);
    // 最後に止めたのが作るの活動なら、その作業台へ（§U-11 指摘 4）。会話なら従来どおり #talk
    var mk = DES.make.resumeTarget();
    if (mk) { DES.make.openAct(mk); return; }
    DES.ui.restoreScroll = true;
    if (route() === 'talk') { window.scrollTo(0, DES.state.draft.scroll || 0); DES.ui.restoreScroll = false; }
    else window.location.hash = '#talk';
  };
  A['settings'] = function (el) {
    // 左 drawer の中から開いたときは、drawer を閉じてから topbar のメニューボタンへ戻す
    var opener = el.closest('#nav-drawer') ? findVisible('[data-action="menu-open"]') : el;
    closeMenu(false);
    APP.openMode(opener);
  };
  A['reset'] = function () { DES.store.reset(); };
  A['plan-toggle'] = function (el) {
    var r = route(), b = APP.bp(), st = DES.state;
    if (r === 'plan') { window.location.hash = '#talk'; return; }
    // 作るでは作業台を残したまま、右から被さる drawer（≤ 700 は上からのシート）で開く（design-v3 §5-2）
    if (r === 'make') { if (DES.ui.planOpen) APP.closePlanDialog(); else APP.openPlan(el); return; }
    if (r !== 'talk') {
      if (b === 'xl' || b === 'l') { st.panel = 'open'; if (!DES.store.save('panel')) st.saveFailed = true; }
      else DES.ui.openPlanAfterNav = true;
      window.location.hash = '#talk';
      return;
    }
    if (b === 'xl' || b === 'l') APP.change(function () { st.panel = st.panel === 'open' ? 'closed' : 'open'; });
    else APP.openPlan(el);
  };
  A['panel-close'] = function (el) {
    var dlg = $('#plan-dialog');
    if (dlg.open && dlg.contains(el)) { APP.closeDialog(dlg); return; }
    APP.change(function () { DES.state.panel = 'closed'; }, { sel: '[data-action="plan-toggle"]' });
  };
  A['goto-plan'] = function () {
    APP.closePlanDialog();
    if (route() !== 'plan') window.location.hash = '#plan';
  };

  function closeTransient() {
    var u = DES.ui;
    ['#plan-dialog', '#nav-drawer', '#row-sheet', '#pick-sheet', '#mode-dialog', '#make-dialog', '#works-dialog'].forEach(function (s) { APP.closeDialog($(s), true); });
    u.menu = null; u.edit = null; u.goalEdit = null; u.noSlot = {};
    DES.make.resetUi();
    DES.works.resetUi();
  }
  function onHash() {
    var u = DES.ui, st = DES.state, r = route();
    if (u.lastRoute === 'talk' && r !== 'talk') { st.draft.scroll = window.scrollY || 0; if (!DES.store.save('draft')) st.saveFailed = true; }
    if (u.lastRoute === 'paused' && r !== 'paused') DES.make.clearPaused();
    if (r === 'paused' && !DES.make.pausedAct()) DES.make.noteTalkStop();
    closeTransient();
    u.lastRoute = r;
    APP.render();
    if (u.restoreScroll && r === 'talk') window.scrollTo(0, st.draft.scroll || 0);
    else window.scrollTo(0, 0);
    u.restoreScroll = false;
    if (r === 'talk' && u.focusComposer) { u.focusComposer = false; DES.talk.focusComposer(); }
    if (r === 'talk' && u.openPlanAfterNav) {
      u.openPlanAfterNav = false;
      var b = APP.bp();
      if (b === 'm' || b === 's') APP.openPlan(findVisible('[data-action="plan-toggle"]'));
    }
  }
  // 幅が変わったら breakpoint が同じでも一時 dialog（drawer / sheet）は閉じる（T-2）。高さだけの変化は無視
  var lastW = 0;
  function onResize() {
    var w = window.innerWidth, b = APP.bp(), u = DES.ui;
    if (w !== lastW) {
      lastW = w;
      ['#plan-dialog', '#nav-drawer', '#row-sheet', '#pick-sheet'].forEach(function (s) { APP.closeDialog($(s), true); });
    }
    if (b === u.bp) return;
    u.bp = b;
    u.menu = null;
    APP.render();
  }
  // 行メニューが閉じた状態なのに DOM に残っていたら消す（他の操作・外クリックで必ず閉じる。T-2）
  function syncMenuDom() {
    if (DES.ui.menu || !document.querySelector('.row-menu')) return;
    if (!DES.ui.leaving) { APP.render(); return; }
    Array.prototype.forEach.call(document.querySelectorAll('.row-menu'), function (n) { n.parentNode.removeChild(n); });
    Array.prototype.forEach.call(document.querySelectorAll('.row-more[aria-expanded="true"]'), function (n) { n.setAttribute('aria-expanded', 'false'); });
  }

  function bind() {
    document.addEventListener('click', function (e) {
      var t = e.target, u = DES.ui;
      if (!t || !t.closest) return;
      var a = t.closest('[data-action]');
      if (u.menu) {
        var isToggle = a && a.getAttribute('data-action') === 'row-menu' && a.getAttribute('data-id') === u.menu;
        if (!t.closest('.row-menu') && !isToggle) u.menu = null;
      }
      if (!a || a.disabled) { syncMenuDom(); return; }
      var name = a.getAttribute('data-action'), fn = A[name];
      if (!fn) { syncMenuDom(); return; }
      if (a.tagName === 'A') e.preventDefault();
      var rs = a.closest('dialog.row-sheet');
      if (rs && name !== 'dialog-close') {
        var k = rs._returnKey;
        APP.closeDialog(rs, true);
        var op = findVisible(k);
        if (op) op.focus();
      }
      fn(a, e);
      syncMenuDom();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      var u = DES.ui, id;
      if (u.menu) { id = u.menu; u.menu = null; e.preventDefault(); APP.render(); APP.focusKey('row-menu', id); return; }
      if (u.edit) { id = u.edit.id; u.edit = null; e.preventDefault(); APP.render(); APP.focusKey('row-menu', id); return; }
      if (u.goalEdit) { id = u.goalEdit.id; u.goalEdit = null; e.preventDefault(); APP.render(); APP.focusFk('goal:' + id); return; }
    });
    Array.prototype.forEach.call(document.querySelectorAll('dialog'), function (dlg) {
      dlg.addEventListener('close', onDialogClose);
      // Esc は cancel → close の順。後片付けとフォーカス戻しを close イベント待ちにせず同期で行う
      dlg.addEventListener('cancel', function (e) { e.preventDefault(); APP.closeDialog(dlg); });
      dlg.addEventListener('click', function (e) {
        if (e.target !== dlg) return;
        var r = dlg.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) APP.closeDialog(dlg);
      });
    });
    window.addEventListener('hashchange', onHash);
    window.addEventListener('resize', onResize);
  }

  function init() {
    DES.ui = { built: null, bp: null, menu: null, edit: null, goalEdit: null, noSlot: {}, seen: {}, sending: false, planOpen: false, lastRoute: null, actor: null, leaving: false };
    lastW = window.innerWidth;
    DES.store.load();
    DES.ui.bp = APP.bp();
    DES.ui.lastRoute = route();
    document.documentElement.setAttribute('data-mode', DES.state.mode === 'es' ? 'es' : 'js');
    renderPreview();
    bind();
    DES.plan.initDnD();
    DES.talk.bind();
    DES.make.bind();
    DES.works.bind();
    APP.render();
  }
  init();
})();
