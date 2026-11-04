/* 作品（#works）の最小部分（CONTRACT-v3 §U-6、design-v3 §6-10 / §13）:
   見出し + 「写真・スクショを入れる」+ 小さなダイアログ 1 枚 + 残した作品のカード（タイトル・線画・バディの見立て・「続きを作る」）。
   残すと作品が 1 件増え、外の記録を持つ活動が 1 つ生まれる（DES.make.addCapture）。一覧・詳細・共有は作らない。 */
window.DES = window.DES || {};
(function () {
  'use strict';
  var DES = window.DES, MD = DES.makeData, M = DES.make;
  var W = DES.works = {};
  function S() { return DES.state; }
  function T(k, v) { return DES.t(k, v); }
  function H() { return DES.h.apply(null, arguments); }
  function icon(n) { return DES.raw(DES.icon(n)); }
  function mode() { return DES.mode(); }
  function wk() { var u = DES.ui; if (!u.wk) u.wk = { dlg: null, opened: false }; return u.wk; }
  function dlgEl() { return document.getElementById('works-dialog'); }
  function act(id) { var hit = null; (S().activities || []).forEach(function (a) { if (a.id === id) hit = a; }); return hit; }
  function chip(kind, text, label) {
    var ic = { own: 'quote', ai: 'spark', record: 'record' }[kind];
    return H('span', { class: 'chip src-' + kind, role: 'img', 'aria-label': label || text }, [icon(ic), H('span', null, text)]);
  }
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
  function madeOpts() { return T('made_opts').split(' / '); }

  // ---------- 作品のカード ----------
  function workArt(w) {
    if (w.art && w.art.photo) return MD.photoArt(w.art.photo);
    if (w.art && w.art.stage) return MD.art(w.art.stage);
    return '';
  }
  // 作品の絵の部分: 線画、メモなら本文（§U-11 指摘 14）
  function workPreview(w) {
    if (w.art && w.art.note) {
      return H('div', { class: 'work-preview work-note' }, [H('p', { class: 'wn-title' }, MD.pick(w.art.note.title, mode())),
        H('ul', null, (w.art.note.lines || []).map(function (l) { return H('li', null, MD.pick(l, mode())); }))]);
    }
    return H('div', { class: 'work-preview' }, [DES.raw(workArt(w))]);
  }
  function workCard(w) {
    var a = act(w.actId), info = [];
    info.push(H('h3', null, w.title));
    var meta = [w.date || '', w.atTime ? w.atTime : ''].filter(Boolean).join(' ');
    if (meta) info.push(H('p', { class: 'muted work-meta' }, meta));
    if (w.from === 'capture' && w.read && w.read.text && !w.read.declined) {
      info.push(H('div', { class: 'work-read' }, [chip('ai', T('ai_read'), T('ai_read') + ' ' + w.read.text), H('p', null, w.read.text)]));
    }
    if (w.like) info.push(H('div', { class: 'work-like' }, [chip('own', T('like_point'), T('own_label') + ' ' + T('like_point')), H('p', null, w.like)]));
    if (w.roles) info.push(H('p', { class: 'work-roles' }, [chip('record', T('roles_h'), T('record_label') + ' ' + T('roles_h')), ' ', M.rolesText(w.roles)]));
    info.push(H('div', { class: 'actions' }, [btn(T('resume_make'), 'wk-continue', { id: w.id, kls: 'primary', disabled: !a })]));
    return H('article', { class: 'work-card', 'data-fk': 'work:' + w.id, tabindex: '-1' }, [workPreview(w), H('div', { class: 'work-info' }, info)]);
  }
  W.render = function (main, arg) {
    var works = S().works || [];
    main.textContent = '';
    var add = H('button', { class: 'work-add', type: 'button', 'data-action': 'wk-open' }, [icon('camera'), H('span', null, T('add_capture'))]);
    main.appendChild(H('div', { class: 'works-page' }, [
      H('div', { class: 'page-head' }, [
        H('div', null, [H('h1', { tabindex: '-1', 'data-fk': 'works-h' }, T('works'))]),
        H('div', { class: 'actions' }, [H('button', { class: 'btn orange', type: 'button', 'data-action': 'wk-open', 'data-arg': 'head' }, [icon('camera'), H('span', null, T('add_capture'))])])
      ]),
      H('div', { class: 'works-grid' }, [add].concat(works.map(workCard)))
    ]));
    if (arg === 'capture' && !wk().opened) { wk().opened = true; W.openCapture(null); }
  };
  W.resetUi = function () { wk().opened = false; };

  // ---------- 写真・スクショを入れる（ダイアログ） ----------
  function syncDefaults(d) {
    var c = MD.capture(d.imgs[0]);
    if (!c) return;
    if (!d.titleEdited) d.title = MD.pick(c.title, mode());
    if (!d.madeEdited) d.made = c.made;
    if (!d.catEdited) d.catalogId = c.catalogId || '';
    if (!d.read.edited) d.read = { text: MD.pick(c.read, mode()), edited: false, declined: false };
  }
  W.openCapture = function (opener) {
    var d = { imgs: [MD.captures[0].id], title: '', titleEdited: false, made: null, madeEdited: false, madeLine: '', catalogId: '', catEdited: false,
      read: { text: null, edited: false, declined: false }, readEdit: null, failed: false, saved: null };
    syncDefaults(d);
    wk().dlg = d;
    render();
    DES.app.openDialog(dlgEl(), opener);
    var f = dlgEl().querySelector('.cap-thumb');
    if (f) f.focus();
  };
  function render() {
    var d = wk().dlg, dlg = dlgEl();
    if (!d) return;
    // 中のトーストは描き直しで消さない（§U-11 指摘 1）
    var putBack = M.clearDialog(dlg);
    dlg.setAttribute('aria-labelledby', 'wk-h');
    dlg.appendChild(H('div', { class: 'dialog-head' }, [H('h2', { id: 'wk-h' }, T('add_capture')),
      H('button', { class: 'icon-btn', type: 'button', 'data-action': 'dialog-close', 'aria-label': T('close') }, [icon('close')])]));
    var body = H('div', { class: 'dialog-body' });
    // 画像（1〜3 枚。モックはダミーの線画から選ぶ）
    body.appendChild(H('fieldset', { class: 'cap-images' }, [
      H('legend', null, T('images')),
      H('div', { class: 'cap-thumbs' }, MD.captures.map(function (c) {
        var on = d.imgs.indexOf(c.id) >= 0, only = on && d.imgs.length === 1;
        return H('button', { class: 'cap-thumb' + (on ? ' on' : ''), type: 'button', 'data-action': 'wk-img', 'data-arg': c.id, 'aria-pressed': on ? 'true' : 'false',
          'aria-disabled': only ? 'true' : null, 'aria-label': T('images') + ': ' + MD.pick(c.title, mode()) }, [DES.raw(MD.photoArt({ theme: c.theme, n: c.n })), on ? H('span', { class: 'cap-check', 'aria-hidden': 'true' }, [icon('check')]) : null]);
      })),
      btn(T('add_photo'), 'wk-file', { kls: 'ghost', icon: 'camera' })
    ]));
    body.appendChild(H('div', { class: 'field' }, [H('label', { for: 'wk-title' }, T('title_label')),
      H('input', { id: 'wk-title', type: 'text', 'data-ui': 'wk', 'data-key': 'title', value: d.title, autocomplete: 'off' })]));
    // 何を作った？（候補 + 1 行。作るの「何を変えた？」と同じ部品）
    body.appendChild(H('fieldset', { class: 'cap-made' }, [
      H('legend', null, T('what_made')),
      H('div', { class: 'opt-chips' }, madeOpts().map(function (l, i) {
        return H('button', { class: 'opt-chip', type: 'button', 'data-action': 'wk-made', 'data-arg': String(i), 'aria-pressed': d.made === i ? 'true' : 'false' }, l);
      })),
      H('input', { id: 'wk-made-line', type: 'text', 'data-ui': 'wk', 'data-key': 'madeLine', value: d.madeLine, autocomplete: 'off', 'aria-label': T('what_made') })
    ]));
    var cats = [H('option', { value: '', selected: !d.catalogId }, T('new_activity'))];
    DES.data.catalog.forEach(function (cat) {
      cats.push(H('optgroup', { label: cat.label }, cat.items.map(function (it) { return H('option', { value: it.id, selected: d.catalogId === it.id }, it.title); })));
    });
    body.appendChild(H('div', { class: 'field' }, [H('label', { for: 'wk-cat' }, T('which_activity')), H('select', { id: 'wk-cat', 'data-ui': 'wk', 'data-key': 'catalogId' }, cats)]));
    // バディの見立て（本人の言葉とは別欄。直す・違う）
    var rd = d.read, readKids = [H('div', { class: 'ar-head' }, [chip('ai', T('ai_read'))])];
    if (d.readEdit != null) {
      readKids.push(H('label', { class: 'sr-only', for: 'wk-read' }, T('ai_read')));
      readKids.push(H('input', { id: 'wk-read', type: 'text', 'data-ui': 'wk', 'data-key': 'readEdit', value: d.readEdit, autocomplete: 'off' }));
      readKids.push(H('div', { class: 'actions' }, [btn(T('keep_text'), 'wk-read-ok', { kls: 'primary' }), btn(T('cancel'), 'wk-read-cancel')]));
    } else {
      readKids.push(H('p', { class: 'ar-text' }, rd.declined || !rd.text ? T('ai_read_none') : rd.text));
      readKids.push(H('div', { class: 'actions' }, [btn(T('quote_edit'), 'wk-read-edit', { kls: 'ghost' }), rd.declined ? null : btn(T('decline'), 'wk-read-decline', { kls: 'ghost' })]));
    }
    body.appendChild(H('div', { class: 'ai-read-box', 'data-fk': 'wk-read' , tabindex: '-1' }, readKids));
    body.appendChild(H('p', { class: 'face-note' }, T('face_note')));
    if (d.failed) body.appendChild(H('p', { class: 'dlg-error', role: 'alert' }, T('save_work_fail')));
    dlg.appendChild(body);
    dlg.appendChild(H('div', { class: 'dialog-footer' }, [
      H('button', { class: 'btn primary', type: 'button', 'data-action': 'wk-save' }, d.failed ? T('retry_save') : T('save_work')),
      H('button', { class: 'btn', type: 'button', 'data-action': 'dialog-close' }, T('cancel'))
    ]));
    putBack();
  }
  function rerender(sel) {
    render();
    var n = sel ? dlgEl().querySelector(sel) : null;
    if (n) n.focus();
  }

  // ---------- 操作 ----------
  var A = DES.actions = DES.actions || {};
  A['wk-open'] = function (el) { W.openCapture(el); };
  A['wk-file'] = function () { DES.app.toast(T('demo_media')); };
  A['wk-img'] = function (el) {
    var d = wk().dlg, id = el.getAttribute('data-arg');
    if (!d) return;
    var i = d.imgs.indexOf(id);
    if (i >= 0) { if (d.imgs.length > 1) d.imgs.splice(i, 1); } else if (d.imgs.length < 3) d.imgs.push(id);
    syncDefaults(d);
    rerender('.cap-thumb[data-arg="' + id + '"]');
  };
  A['wk-made'] = function (el) {
    var d = wk().dlg, i = +el.getAttribute('data-arg');
    if (!d) return;
    d.made = d.made === i ? null : i;
    d.madeEdited = true;
    rerender('.opt-chip[data-arg="' + i + '"]');
  };
  A['wk-read-edit'] = function () { var d = wk().dlg; if (!d) return; d.readEdit = d.read.declined || !d.read.text ? '' : d.read.text; rerender('#wk-read'); };
  A['wk-read-cancel'] = function () { var d = wk().dlg; if (!d) return; d.readEdit = null; rerender('[data-action="wk-read-edit"]'); };
  A['wk-read-ok'] = function () {
    var d = wk().dlg;
    if (!d) return;
    var v = String(d.readEdit || '').replace(/^\s+|\s+$/g, '');
    d.read = v ? { text: v, edited: true, declined: false } : { text: null, edited: true, declined: true };
    d.readEdit = null;
    rerender('[data-action="wk-read-edit"]');
  };
  // 違う: 読み取りを外す（提案の材料にもしない）
  A['wk-read-decline'] = function () {
    var d = wk().dlg;
    if (!d) return;
    d.read = { text: d.read.text, edited: true, declined: true };
    rerender('[data-action="wk-read-edit"]');
  };
  A['wk-save'] = function () {
    var d = wk().dlg;
    if (!d) return;
    // 再試行はフォームの今の値で作り直す（§U-11 指摘 10）。前の試みで足した作品と活動は外してから
    if (d.saved) {
      S().works = S().works.filter(function (w) { return w.id !== d.saved; });
      S().activities = S().activities.filter(function (a) { return a.id !== d.savedAct; });
      d.saved = null;
    }
    {
      var line = String(d.madeLine || '').replace(/^\s+|\s+$/g, '');
      var made = d.made == null ? null : d.made;
      var res = M.addCapture(S().activities, S().works, {
        workId: DES.plan.newId('w'), actId: DES.plan.newId('a'), images: d.imgs, title: d.title,
        made: made, madeLine: line,
        catalogId: d.catalogId || null, read: d.read, now: DES.data.now, date: (function () { var p = DES.data.today.split('-'); return (+p[1]) + '/' + (+p[2]); })(), mode: mode()
      });
      if (!res) return;
      S().activities = res.activities;
      S().works = res.works;
      d.saved = res.work.id;
      d.savedAct = res.act.id;
    }
    // 活動を先に保存し、成功した時だけ作品を保存する（作品だけが残って活動が無い状態を作らない）
    if (!(DES.store.save('activities') && DES.store.save('works'))) {
      S().saveFailed = true;
      d.failed = true;
      DES.app.renderSaveState();
      rerender('[data-action="wk-save"]');
      return;
    }
    S().saveFailed = false;
    var wid = d.saved;
    DES.app.closeDialog(dlgEl(), true);
    wk().dlg = null;
    DES.app.commit({ focus: 'work:' + wid });
    DES.app.toast(T('saved_work'));
  };
  // 続きを作る: 残した時点を開く（§U-11 指摘 5）
  A['wk-continue'] = function (el) { M.openWork(el.getAttribute('data-id')); };

  W.bind = function () {
    document.addEventListener('input', function (e) {
      var t = e.target, d = wk().dlg;
      if (!d || !t || !t.getAttribute || t.getAttribute('data-ui') !== 'wk') return;
      var k = t.getAttribute('data-key');
      if (k === 'title') { d.title = t.value; d.titleEdited = true; }
      else if (k === 'madeLine') d.madeLine = t.value;
      else if (k === 'readEdit') d.readEdit = t.value;
    });
    document.addEventListener('change', function (e) {
      var t = e.target, d = wk().dlg;
      if (!d || !t || !t.getAttribute || t.getAttribute('data-ui') !== 'wk') return;
      if (t.getAttribute('data-key') === 'catalogId') { d.catalogId = t.value; d.catEdited = true; }
    });
    document.addEventListener('keydown', function (e) {
      var t = e.target;
      if (e.key === 'Enter' && !e.isComposing && t && t.id === 'wk-read') { e.preventDefault(); A['wk-read-ok'](); }
    });
    var dlg = dlgEl();
    if (dlg) dlg.addEventListener('close', function () {
      var tEl = document.getElementById('toast');
      if (tEl && tEl.parentNode === dlg) document.body.appendChild(tEl);
      wk().dlg = null;
      dlg.textContent = '';
      if (window.location.hash === '#works/capture') window.location.replace('#works');
    });
  };
})();
