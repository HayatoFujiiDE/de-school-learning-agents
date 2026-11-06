/* サポーター画面の中身（docs/plans/supporter-view/contract-AD.md §AD-7〜AD-11 / 18-8 / 18-10 / 18-13）。
   sup.js の差し込み口 DES.sup.renderTab に 6 つ（class / today / clues / advice / log / report）を足す。
   文字列は DES.sup.t（DES.supData.text）・DES.t（子どもに見える既存の語）・DES.selfData から引く（ここに直書きしない）。自由入力は textContent で描く。
   入力中の文は DES.ui.supv に持つ（別の操作の再描画で消さない）。状態の変更は DES.app.change の 1 経路、記録は DES.sup.addLog。 */
(function () {
  'use strict';
  var DES = window.DES;
  var SUP = DES.sup, SD = DES.supData, C = DES.supCore;
  var RT = SUP.renderTab;
  var A = DES.actions = DES.actions || {};
  var AXES = ['int', 'ori', 'exp', 'psy', 'mas'];
  var SCENE_OPTS = ['none', 'talk', 'plan', 'make', 'today'];
  var HOW_KEYS = ['proxy', 'hands', 'voice', 'idea'];
  var IDEA_LABEL = { open: 'idea_open', later: 'idea_later', made: 'idea_made', planned: 'idea_planned', withdrawn: 'idea_withdrawn' };
  var PROP_LABEL = { proposed: 'st_proposed', chosen: 'st_chosen', held: 'st_held', declined: 'st_declined', removed: 'st_removed', finished: 'st_finished' };
  var SRC_ICON = { own: 'quote', record: 'record', ai: 'spark' };

  function S() { return DES.state; }
  function St() { return DES.state.sup; }
  function H() { return DES.h.apply(null, arguments); }
  function t(k, vars) { return SUP.t(k, vars); }
  function icon(n) { return DES.raw(DES.icon(n)); }
  function trim(s) { return String(s == null ? '' : s).replace(/^\s+|\s+$/g, ''); }
  function esc(x) { return window.CSS && CSS.escape ? CSS.escape(x) : String(x).replace(/"/g, '\\"'); }
  function find(list, id) { for (var i = 0; i < (list || []).length; i++) if (list[i] && list[i].id === id) return list[i]; return null; }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function newId(p) { return DES.plan.newId(p); }
  function at() { return { day: SUP.today(), time: DES.data.now }; }
  // '11-02' → '11/2'
  function dateOf(s) { var p = String(s == null ? '' : s).split('-'); return p.length === 2 ? (+p[0]) + '/' + (+p[1]) : String(s == null ? '' : s); }
  function selfText(x) { return x && typeof x === 'object' ? (x.js != null ? x.js : '') : String(x == null ? '' : x); }
  function domId(fk) { return 'sv-' + String(fk).replace(/[^\w-]/g, '-'); }
  // 入力中の値（再描画で消さない一時値）
  function vv() {
    var u = DES.ui;
    if (!u.supv) u.supv = { idea: '', adv: { aim: '', basis: '', scene: 'none' }, noteAdd: {}, noteEdit: {}, advEdit: {}, rpEdit: {} };
    return u.supv;
  }
  function saveSup() { if (!DES.store.save('sup')) { S().saveFailed = true; DES.app.renderSaveState(); } }
  function focusFk(fk) { var n = document.querySelector('[data-fk="' + esc(fk) + '"]'); if (n) n.focus(); }
  function focusSel(sel) { var n = document.querySelector(sel); if (n) n.focus(); }
  function btnSel(action, id) { return '[data-action="' + esc(action) + '"]' + (id != null ? '[data-id="' + esc(id) + '"]' : ''); }
  function setDisabled(action, id, off) { Array.prototype.forEach.call(document.querySelectorAll(btnSel(action, id)), function (b) { b.disabled = !!off; }); }

  // ---------- 部品 ----------
  function chip(text, kls, ic, label) {
    var a = { class: 'chip' + (kls ? ' ' + kls : '') };
    if (label) { a.role = 'img'; a['aria-label'] = label; }
    return H('span', a, [ic ? icon(ic) : null, H('span', null, text)]);
  }
  // 出所チップ（本人 = 青 / 記録 = 緑 / バディ = 琥珀・破線 / まだ分からない = 破線の枠だけ）
  function srcChip(kind, text) {
    var name = t('src_' + kind), tx = text || name;
    return chip(tx, 'src-' + kind, SRC_ICON[kind], tx.indexOf(name) === 0 ? tx : name + ' ' + tx);
  }
  // サポーターの入力 = 緑チップに人名
  function recChip(text) { return chip(text, 'src-record', 'record', text); }
  function btn(label, action, o) {
    o = o || {};
    var a = { class: 'btn small' + (o.kls ? ' ' + o.kls : ''), type: 'button', 'data-action': action };
    if (o.id != null) a['data-id'] = o.id;
    if (o.arg != null) a['data-arg'] = o.arg;
    if (o.fk) a['data-fk'] = o.fk;
    if (o.disabled) a.disabled = true;
    return H('button', a, label);
  }
  function link(label, action, o) {
    o = o || {};
    var a = { class: 'link-btn', type: 'button', 'data-action': action };
    if (o.id != null) a['data-id'] = o.id;
    if (o.arg != null) a['data-arg'] = o.arg;
    if (o.disabled) a.disabled = true;
    return H('button', a, label);
  }
  function box(key, head, kids, o) {
    o = o || {};
    var hid = 'sh-' + key;
    return H('section', { class: 'sup-box' + (o.kls ? ' ' + o.kls : ''), 'aria-labelledby': hid }, [
      H('div', { class: 'sup-box-head' }, [H('h2', { id: hid }, head)].concat(o.side ? [o.side] : []))
    ].concat(kids));
  }
  function stamp(day, time) { return H('span', { class: 'sx-date' }, day + (time ? ' ' + time : '')); }
  function closeX() { return H('button', { class: 'icon-btn', type: 'button', 'data-action': 'dialog-close', 'aria-label': t('close') }, [icon('close')]); }
  // 行内の textarea（残す / やめる）。空は残せない
  function editor(o) {
    var fid = domId(o.fk);
    var fields = (o.fields || [o]).map(function (f) {
      var id = domId(f.fk);
      return H('div', { class: 'sup-field' }, [
        H('label', { class: f.showLabel ? 'sup-label' : 'sr-only', for: id }, f.label),
        H('textarea', { id: id, rows: String(f.rows || 2), 'data-ui': f.ui, 'data-id': f.id, 'data-key': f.key, 'data-fk': f.fk, placeholder: f.ph || null, value: f.value })
      ]);
    });
    return H('div', { class: 'inline-edit sup-edit', id: fid + '-box' }, fields.concat([
      H('div', { class: 'actions' }, [
        btn(t('save'), o.save, { id: o.id, kls: 'primary', disabled: !trim(o.need) }),
        btn(t('cancel'), o.cancel, { id: o.id })
      ])
    ]));
  }

  // 予定の行の kind チップ（plan.js と同じ語と色。子どもに見える語なので DES.t）
  function kindChip(r) {
    var T = DES.t;
    if (r.kind === 'fixed') return chip(T('kind_fixed'), 'k-fixed');
    if (r.kind === 'event') return chip(T(r.tbd ? 'circle_tbd' : 'kind_event'), 'k-event');
    if (r.kind === 'optional') {
      if (r.choice === 'join') return chip(T('join'), 'k-mine');
      if (r.choice === 'later') return chip(T('decide_later'), 'k-held');
      return chip(T('kind_optional'), 'k-optional');
    }
    if (r.kind === 'mine') return chip(T('kind_mine'), 'k-mine');
    if (r.kind === 'proposed') return chip(T('kind_proposed'), 'k-proposed');
    if (r.kind === 'held') return chip(T('kind_held'), 'k-held');
    return null;
  }
  function range(r) { return DES.plan.range(r.start, r.end); }
  function joinBtn(small) {
    var kls = 'btn orange' + (small ? ' small' : '');
    return SUP.isJoined() ? H('button', { class: kls, type: 'button', 'data-action': 'sup-nav', 'data-arg': '#talk' }, t('band_back'))
      : H('button', { class: kls, type: 'button', 'data-action': 'sup-join' }, t('join'));
  }

  // ======================================================================
  // 教室の一覧（AD-7）
  // ======================================================================
  function cell(kls, label, kids) { return H('div', { class: 'sk-cell ' + kls }, [H('span', { class: 'sk-lb' }, label), H('div', { class: 'sk-val' }, kids)]); }
  function kidCard(c, live) {
    var hid = 'sk-' + c.id;
    var consult = c.consult ? [srcChip('own'), H('span', null, c.consult)] : [H('span', { class: 'sk-none' }, t('consult_none'))];
    var ops = live ? [H('a', { class: 'btn small', href: '#sup/' + c.id }, t('open')), joinBtn(true)]
      : [H('button', { class: 'btn small', type: 'button', disabled: true }, t('open'))];
    return H('article', { class: 'sup-kid' + (live ? ' is-live' : ''), 'aria-labelledby': hid }, [
      H('div', { class: 'sk-cell sk-name' }, [
        H('span', { class: 'sk-av', 'aria-hidden': 'true' }, c.name.charAt(0)),
        H('div', null, [H('h2', { id: hid }, c.name), H('span', { class: 'sk-mode' }, t(c.mode === 'es' ? 'mode_es' : 'mode_js'))])
      ]),
      cell('sk-now', t('col_now'), c.now),
      cell('sk-next', t('col_next'), c.next),
      cell('sk-consult', t('col_consult'), consult),
      cell('sk-check', t('col_check'), (c.checks || []).map(function (x) { return H('span', { class: 'pill' }, x); })),
      H('div', { class: 'sk-cell sk-ops' }, ops)
    ]);
  }
  RT['class'] = function (host) {
    var row = SUP.childRow();
    host.appendChild(H('ul', { class: 'sup-kids' }, SD.children.map(function (c) { return H('li', null, kidCard(c.live ? row : c, !!c.live)); })));
    host.appendChild(H('p', { class: 'sup-note' }, t('only_child')));
  };

  // ======================================================================
  // 個別「今日」（AD-7 の 1〜5）
  // ======================================================================
  function planBox() {
    var rows = DES.plan.live(S().plan, DES.data.classroom).slice().sort(function (a, b) { return DES.plan.toMin(a.start) - DES.plan.toMin(b.start); });
    return box('plan', t('td_plan_h'), [
      H('ul', { class: 'sp-rows' }, rows.map(function (r) {
        return H('li', { class: 'sp-row' }, [
          H('span', { class: 'sp-time' }, range(r)),
          H('div', { class: 'sp-main' }, [H('span', { class: 'sp-title' }, r.title), H('span', { class: 'sp-chips' }, [kindChip(r), DES.plan.byChip(r)])])
        ]);
      })),
      H('p', { class: 'sup-note' }, t('td_plan_note'))
    ], { kls: 'td-plan' });
  }
  function wordsBox() {
    var ms = DES.talk.messages().filter(function (m) { return m && m.who === 'child'; }).slice().reverse().slice(0, 3);
    var list = ms.length ? H('ul', { class: 'sp-words' }, ms.map(function (m) {
      return H('li', { class: 'sp-word' }, [
        H('span', { class: 'sp-time' }, m.time),
        H('div', { class: 'sp-main' }, [H('span', { class: 'sp-say' }, m.text), H('span', { class: 'sp-chips' }, [srcChip('own'), m.by ? recChip(DES.t('by_typed', { sup: SUP.nameOf(m.by) })) : null])])
      ]);
    })) : H('p', { class: 'sup-empty' }, t('td_words_none'));
    return box('words', t('td_words_h'), [list, H('div', { class: 'sup-ops' }, [btn(t('td_all_talk'), 'sup-talk-all')])], { kls: 'td-words' });
  }
  function propBox() {
    var ps = C.proposals(S().plan, DES.talk.messages());
    var list = ps.length ? H('ul', { class: 'sp-rows' }, ps.map(function (p) {
      return H('li', { class: 'sp-row' }, [
        H('span', { class: 'sp-time' }, range(p.row)),
        H('div', { class: 'sp-main' }, [
          H('span', { class: 'sp-title' }, [H('span', null, p.row.title), H('span', { class: 'pill' }, t(PROP_LABEL[p.status]))]),
          H('span', { class: 'sp-quote' }, [srcChip('ai', DES.t('ai_proposal')), H('span', null, p.line)])
        ])
      ]);
    })) : H('p', { class: 'sup-empty' }, t('td_prop_none'));
    return box('prop', t('td_prop_h'), [list], { kls: 'td-prop' });
  }
  function ideaBox() {
    var v = vv(), busy = !!DES.ui.sending;
    var ideas = SUP.ideas().slice().reverse();
    var list = ideas.length ? H('ul', { class: 'sp-ideas' }, ideas.map(function (x) {
      var view = SUP.ideaView(x.id), st = view ? view.state : x.state, label = t(IDEA_LABEL[st]), again = null;
      // 子どもの画面のカードと同じ状態表示: 予定から外した行 → 「予定から外した」+「予定に入れる」をもう一度 / 終わった行 → 「終わった」
      if (st === 'planned' && view && view.row && view.row.gone === 'removed') {
        label = t('st_removed');
        if (x.catalogId && DES.plan.item(x.catalogId)) again = btn(DES.t('idea_plan'), 'idea-plan', { id: x.id });
      } else if (st === 'planned' && view && view.row && view.row.gone === 'finished') label = t('st_finished');
      return H('li', { class: 'sp-idea', 'data-fk': 'idea:' + x.id, tabindex: '-1' }, [
        H('span', { class: 'sp-say' }, x.text),
        H('span', { class: 'sp-idea-foot' }, [H('span', { class: 'pill' }, label), again, SUP.canWithdraw(x.id) ? link(t('withdraw'), 'idea-withdraw', { id: x.id }) : null])
      ]);
    })) : H('p', { class: 'sup-empty' }, t('td_idea_none'));
    return box('idea', t('td_idea_h'), [
      H('p', { class: 'sup-lead-s' }, t('td_idea_sub')),
      H('div', { class: 'sup-form' }, [
        H('label', { class: 'sr-only', for: 'sv-idea' }, t('td_idea_h')),
        H('textarea', { id: 'sv-idea', rows: '3', 'data-ui': 'sv-idea', 'data-fk': 'sv-idea', placeholder: t('ph_idea'), value: v.idea }),
        H('div', { class: 'actions' }, [
          btn(t('td_idea_send'), 'sup-idea-send', { kls: 'orange', disabled: busy || !trim(v.idea) }),
          btn(t('cancel'), 'sup-idea-clear', { kls: 'ghost', disabled: !v.idea })
        ])
      ]),
      list
    ], { kls: 'td-idea' });
  }
  function checkBox() {
    return box('check', t('td_check_h'), [H('ul', { class: 'sp-checks' }, (SD.checks || []).map(function (c) { return H('li', null, C.fmt(c, SUP.names())); }))], { kls: 'td-check' });
  }
  RT.today = function (host) {
    host.appendChild(H('div', { class: 'sup-today' }, [planBox(), wordsBox(), propBox(), ideaBox(), checkBox()]));
  };

  // ---------- 会話を全部見る（#sup-dialog・読むだけ） ----------
  function openTalk(opener, msgId) {
    var dlg = document.getElementById('sup-dialog');
    if (!dlg) return;
    dlg.textContent = '';
    dlg.className = 'make-dialog sup-dialog sup-talk-dialog';
    dlg.setAttribute('aria-labelledby', 'sup-dlg-h');
    var list = H('div', { class: 'message-list sup-talk' }, DES.talk.messages().map(function (m) { return DES.talk.messageEl(m, { readOnly: true }); }));
    dlg.appendChild(H('div', { class: 'dialog-head' }, [H('h2', { id: 'sup-dlg-h', tabindex: '-1' }, t('talk_dialog_h', { date: SUP.today() })), closeX()]));
    dlg.appendChild(H('div', { class: 'dialog-body' }, [list]));
    DES.app.openDialog(dlg, opener);
    var tgt = null;
    if (msgId) Array.prototype.forEach.call(list.children, function (n) { if (n.getAttribute('data-id') === msgId) tgt = n; });
    if (tgt) {
      tgt.setAttribute('tabindex', '-1');
      tgt.classList.add('is-sup-focus');
      tgt.focus({ preventScroll: true });
      if (tgt.scrollIntoView) tgt.scrollIntoView({ block: 'center' });
    } else dlg.querySelector('h2').focus();
  }

  // ======================================================================
  // 手がかり（AD-7 / 18-8）
  // ======================================================================
  function condText(c) { var tx = DES.selfData.text['cond_' + c]; return tx ? tx.js : c; }
  function basisRow(b) {
    return H('li', { class: 'sx-basis-i' }, [b.src === 'gap' ? chip(t('src_gap'), 'src-gap') : srcChip(b.src), b.date ? stamp(dateOf(b.date), b.time) : null, H('span', { class: 'sx-btext' }, b.text)]);
  }
  function itemRow(it, rx) {
    var r = it.src === 'ai' ? rx[it.id] : null, st = r ? r.state : null, base = selfText(it.text);
    var meta = [], text = base, kls = 'srow sup-item f-' + it.src, after = [];
    if (st === 'edited' && r.vers && r.vers[r.cur]) {
      kls = 'srow sup-item f-own';
      meta.push(srcChip('own', t('cl_fixed')));
      text = r.vers[r.cur].text;
      after.push(H('p', { class: 'sup-was' }, [H('span', { class: 'sup-was-k' }, t('cl_was_ai')), H('span', null, base)]));
    } else if (st === 'agreed') {
      meta.push(srcChip('ai'), srcChip('own', t('cl_agreed')));
    } else if (st === 'away') {
      kls += ' is-away';
      meta.push(srcChip('ai'), srcChip('own', t('cl_away')));
    } else if (it.src === 'gap') meta.push(chip(t('src_gap'), 'src-gap'));
    else meta.push(srcChip(it.src));
    if (it.cond) meta.push(chip(condText(it.cond), 'k-cond'));
    if (it.date) meta.push(stamp(dateOf(it.date), it.time));
    var kids = [H('div', { class: 'srow-meta' }, meta), H('span', { class: 'srow-text' }, text)].concat(after);
    var counter = it.counter && it.counter.length ? it.counter : null;
    if ((it.basis && it.basis.length) || counter) {
      kids.push(H('details', { class: 'sup-basis' }, [
        H('summary', null, t('cl_basis')),
        it.basis && it.basis.length ? H('ul', { class: 'sx-basis' }, it.basis.map(basisRow)) : null,
        counter ? H('p', { class: 'sx-sub-h' }, selfText(DES.selfData.text.counter)) : null,
        counter ? H('ul', { class: 'sx-basis' }, counter.map(basisRow)) : null
      ]));
    }
    return H('li', { class: kls }, [H('div', { class: 'srow-main' }, kids)]);
  }
  function itemList(items, rx) {
    var open = items.filter(function (x) { return !x.fold; }), fold = items.filter(function (x) { return x.fold; });
    var out = [H('ul', { class: 'sx-list sup-items' }, open.map(function (x) { return itemRow(x, rx); }))];
    if (fold.length) out.push(H('details', { class: 'sup-fold' }, [H('summary', null, t('cl_more', { n: fold.length })), H('ul', { class: 'sx-list sup-items' }, fold.map(function (x) { return itemRow(x, rx); }))]));
    return out;
  }
  function noteRow(n) {
    var v = vv();
    if (v.noteEdit[n.id] != null) {
      return H('li', { class: 'sup-note-row is-edit', 'data-fk': 'note:' + n.id }, [editor({
        id: n.id, fk: 'note-ed:' + n.id, ui: 'sv-note-edit', label: t('cl_obs'), ph: t('cl_obs_ph'), value: v.noteEdit[n.id], need: v.noteEdit[n.id],
        save: 'sup-note-update', cancel: 'sup-note-ecancel', rows: 2
      })]);
    }
    return H('li', { class: 'sup-note-row', 'data-fk': 'note:' + n.id, tabindex: '-1' }, [
      H('div', { class: 'srow-meta' }, [recChip(t('cl_obs')), stamp(n.day, n.time)]),
      H('span', { class: 'srow-text' }, n.text),
      H('span', { class: 'sup-row-ops' }, [link(t('edit'), 'sup-note-edit', { id: n.id }), link(t('remove'), 'sup-note-del', { id: n.id })])
    ]);
  }
  function notesBlock(axis) {
    var v = vv(), notes = (St().notes || []).filter(function (n) { return n.axis === axis; });
    var add = v.noteAdd[axis] != null
      ? editor({ id: axis, fk: 'note-new:' + axis, ui: 'sv-note-add', label: t('cl_obs_add'), ph: t('cl_obs_ph'), value: v.noteAdd[axis], need: v.noteAdd[axis], save: 'sup-note-save', cancel: 'sup-note-cancel', rows: 2 })
      : btn(t('cl_obs_add'), 'sup-note-open', { id: axis, fk: 'note-add:' + axis });
    return H('div', { class: 'sup-notes' }, [notes.length ? H('ul', { class: 'sup-note-list' }, notes.map(noteRow)) : null, add]);
  }
  function axisCard(ax, rx) {
    var items = (DES.selfData.items || []).filter(function (x) { return x.axis === ax.id; }), body = [];
    if (ax.groups && ax.groups.length) {
      ax.groups.forEach(function (g) {
        var gi = items.filter(function (x) { return x.group === g.id; });
        if (!gi.length) return;
        body.push(H('div', { class: 'sx-group' }, [H('h3', { class: 'sx-group-h' }, selfText(g.head))].concat(itemList(gi, rx))));
      });
      var rest = items.filter(function (x) { return !x.group; });
      if (rest.length) body = body.concat(itemList(rest, rx));
    } else body = itemList(items, rx);
    var hid = 'ax-' + ax.id;
    return H('section', { class: 'axis-card sup-axis', 'aria-labelledby': hid }, [
      H('div', { class: 'axis-head' }, [H('h2', { id: hid }, SD.axisHead[ax.id])])
    ].concat(body, [notesBlock(ax.id)]));
  }
  RT.clues = function (host) {
    var rx = SUP.selfReplies() || {}, axes = {};
    (DES.selfData.axes || []).forEach(function (a) { axes[a.id] = a; });
    host.appendChild(H('div', { class: 'sup-lead' }, [H('p', null, t('cl_sub')), H('p', { class: 'sup-note' }, t('cl_note'))]));
    host.appendChild(H('div', { class: 'sup-axes' }, AXES.filter(function (k) { return axes[k]; }).map(function (k) { return axisCard(axes[k], rx); })));
  };

  // ======================================================================
  // 助言（AD-8）
  // ======================================================================
  function adviceAll() { return C.adviceList(SD.advice, St().advice); }
  // 書き換える助言を state に置く（seed なら写してから）
  function adviceMine(id) {
    var x = find(St().advice, id);
    if (x) return x;
    var s = find(SD.advice, id);
    if (!s) return null;
    x = clone(s);
    x.added = false;
    x.prev = null;
    // 写す時に {sup} {child} を埋めた文にする（記録と画面が同じ文になる。直した文には埋め込みをかけない）
    x.aim = nm(s, s.aim);
    x.basis = s.basis == null ? null : nm(s, s.basis);
    ['view', 'trial', 'result', 'update'].forEach(function (k) { if (x.stages && x.stages[k] != null) x.stages[k] = nm(s, x.stages[k]); });
    St().advice = (St().advice || []).concat([x]);
    return x;
  }
  function sceneLabel(s) { return t('ad_scene_' + (SCENE_OPTS.indexOf(s) >= 0 ? s : 'none')); }
  function adviceForm() {
    var a = vv().adv;
    return box('adform', t('ad_form_h'), [
      H('div', { class: 'sup-form ad-form' }, [
        H('div', { class: 'sup-field' }, [H('label', { class: 'sup-label', for: 'sv-adv-aim' }, t('ad_aim')),
          H('textarea', { id: 'sv-adv-aim', rows: '2', 'data-ui': 'sv-adv', 'data-key': 'aim', 'data-fk': 'sv-adv-aim', 'aria-required': 'true', value: a.aim })]),
        H('div', { class: 'sup-field' }, [H('label', { class: 'sup-label', for: 'sv-adv-basis' }, t('ad_basis')),
          H('textarea', { id: 'sv-adv-basis', rows: '2', 'data-ui': 'sv-adv', 'data-key': 'basis', 'data-fk': 'sv-adv-basis', value: a.basis })]),
        H('div', { class: 'sup-field' }, [H('label', { class: 'sup-label', for: 'sv-adv-scene' }, t('ad_scene')),
          H('select', { id: 'sv-adv-scene', 'data-ui': 'sv-adv', 'data-key': 'scene', 'data-fk': 'sv-adv-scene' }, SCENE_OPTS.map(function (s) {
            return H('option', { value: s, selected: a.scene === s }, sceneLabel(s));
          }))]),
        H('div', { class: 'actions' }, [
          btn(t('ad_send'), 'sup-adv-send', { kls: 'orange', disabled: !trim(a.aim) }),
          btn(t('cancel'), 'sup-adv-clear', { kls: 'ghost', disabled: !advDirty() })
        ])
      ])
    ], { kls: 'ad-form-box' });
  }
  function advDirty() { var a = vv().adv; return !!(a.aim || a.basis || (a.scene && a.scene !== 'none')); }
  // seed の文の {sup} {child} を埋める（足した文は自由入力なので埋めない）
  function nm(x, s) { return SD.advice.indexOf(x) >= 0 ? C.fmt(s, SUP.names()) : s; }
  function stageDd(x, text, empty) { return text ? H('dd', null, nm(x, text)) : H('dd', { class: 'is-empty' }, t(empty)); }
  function adviceCard(x) {
    var ed = vv().advEdit[x.id], wd = x.state === 'withdrawn', st = x.stages || {};
    var s1 = ed ? H('dd', null, [editor({
      id: x.id, fk: 'adv-ed:' + x.id, save: 'sup-adv-update', cancel: 'sup-adv-ecancel', need: ed.aim,
      fields: [
        { fk: 'adv-ed-aim:' + x.id, ui: 'sv-adv-edit', id: x.id, key: 'aim', label: t('ad_aim'), showLabel: true, value: ed.aim, rows: 2 },
        { fk: 'adv-ed-basis:' + x.id, ui: 'sv-adv-edit', id: x.id, key: 'basis', label: t('ad_basis'), showLabel: true, value: ed.basis, rows: 2 }
      ]
    })]) : H('dd', null, [
      H('p', { class: 'ad-aim' }, nm(x, x.aim)),
      x.basis ? H('p', { class: 'ad-basis' }, [H('span', { class: 'ad-k' }, t('ad_basis')), H('span', null, nm(x, x.basis))]) : null,
      H('p', { class: 'ad-basis' }, [H('span', { class: 'ad-k' }, t('ad_scene')), H('span', null, sceneLabel(x.scene))])
    ]);
    var ops = [];
    if (x.mine && !ed) {
      if (x.added && !st.view && !wd) ops.push(H('span', { class: 'ad-view' }, [btn(t('ad_see_view'), 'sup-adv-view', { id: x.id }), H('small', { class: 'sup-note' }, t('sample_note'))]));
      if (!wd) ops.push(link(t('edit'), 'sup-adv-edit', { id: x.id }), link(t('withdraw'), 'sup-adv-withdraw', { id: x.id }));
      else ops.push(link(t('ad_back'), 'sup-adv-back', { id: x.id }));
    }
    var hid = 'adh-' + x.id;
    return H('article', { class: 'sup-adv' + (wd ? ' is-withdrawn' : ''), 'data-fk': 'adv:' + x.id, tabindex: '-1', 'aria-labelledby': hid }, [
      H('div', { class: 'ad-head' }, [H('h3', { id: hid }, nm(x, x.aim)), H('span', { class: 'ad-head-meta' }, [chip(t('ad_st_' + x.state), 'ad-st'), stamp(x.day, x.time)])]),
      H('dl', { class: 'ad-stages' }, [
        H('div', { class: 'ad-stage' }, [H('dt', null, t('ad_s1')), s1]),
        H('div', { class: 'ad-stage' }, [H('dt', null, t('ad_s2')), stageDd(x, st.view, 'ad_e2')]),
        H('div', { class: 'ad-stage' }, [H('dt', null, t('ad_s3')), stageDd(x, st.trial, 'ad_e3')]),
        H('div', { class: 'ad-stage' }, [H('dt', null, t('ad_s4')), stageDd(x, st.result, 'ad_e4')]),
        H('div', { class: 'ad-stage' }, [H('dt', null, t('ad_s5')), stageDd(x, st.update, 'ad_e5')])
      ]),
      ops.length ? H('div', { class: 'sup-row-ops ad-ops' }, ops) : null
    ]);
  }
  RT.advice = function (host) {
    host.appendChild(H('div', { class: 'sup-lead' }, [H('p', null, t('ad_sub'))]));
    host.appendChild(H('div', { class: 'sup-advice' }, [
      adviceForm(),
      box('adlist', t('ad_list_h'), [H('div', { class: 'ad-list' }, adviceAll().map(adviceCard))], { kls: 'ad-list-box' })
    ]));
  };

  // ======================================================================
  // 足場かけの記録（AD-9 / 18-2）
  // ======================================================================
  function sq(kind) { return H('span', { class: 'sq sq-' + kind }); }
  function weekEl(w) {
    var q = C.squares(w, 10);
    return H('li', { class: 'fd-week' + (w.live ? ' is-live' : '') }, [
      H('span', { class: 'fd-wl' }, w.label),
      q.n ? H('span', { class: 'fd-sqs' }, [
        H('span', { class: 'fd-sq', role: 'img', 'aria-label': t('fd_aria', { week: w.label, n: q.n, own: w.own, cue: w.cue, by: w.by }) }, q.cells.map(sq)),
        q.more ? H('span', { class: 'fd-more' }, t('fd_more', { n: q.more })) : null
      ]) : null,
      H('span', { class: 'fd-n' }, q.n ? t('fd_count', { n: q.n, own: w.own }) : t('fd_zero'))
    ]);
  }
  function fadeBox() {
    var f = SUP.fade(), lines = SUP.fadeLines(f);
    return box('fade', t('fd_h'), [
      H('p', { class: 'sup-lead-s' }, [t('fd_sub1'), t('fd_sub2')].join('')),
      H('div', { class: 'fd-legend' }, [
        H('span', { class: 'fd-legend-h' }, t('fd_legend')),
        H('ul', null, [['own', 'fd_own'], ['cue', 'fd_cue'], ['by', 'fd_by']].map(function (p) { return H('li', null, [sq(p[0]), H('span', null, t(p[1]))]); }))
      ]),
      H('div', { class: 'fd-scenes' }, f.map(function (sc, i) {
        return H('div', { class: 'fd-scene' }, [
          H('h3', { class: 'fd-name' }, sc.label),
          H('ol', { class: 'fd-weeks' }, sc.weeks.map(weekEl)),
          H('p', { class: 'fd-line' }, lines[i] ? lines[i].line : '')
        ]);
      }))
    ], { kls: 'fd-box' });
  }
  function howBox() {
    var n = SUP.howCounts();
    return box('how', t('how_h'), [
      H('ul', { class: 'how-list' }, HOW_KEYS.map(function (k) { return H('li', null, [H('span', null, t('how_' + k)), H('span', { class: 'how-n' }, String(n[k] || 0))]); })),
      H('p', { class: 'sup-note' }, t('how_note'))
    ], { kls: 'how-box' });
  }
  function logRow(e, msgs) {
    var mid = e.ref && e.ref.msg && msgs[e.ref.msg] ? e.ref.msg : null;
    return H('li', { class: 'lg-item' }, [
      H('span', { class: 'lg-time' }, e.time),
      H('span', { class: 'lg-meta' }, [recChip(t('how_' + e.how)), H('span', { class: 'lg-scene' }, t('sc_' + e.scene))]),
      H('span', { class: 'lg-text' }, e.text),
      mid ? H('span', { class: 'lg-ops' }, [link(t('lg_see_talk'), 'sup-see-talk', { id: e.id, arg: mid })]) : null
    ]);
  }
  function logBox() {
    var f = St().logFilter || 'all', groups = C.logView(SUP.logAll(), f), msgs = {}, today = SUP.today();
    DES.talk.messages().forEach(function (m) { if (m && m.id) msgs[m.id] = true; });
    var filters = H('div', { class: 'segmented sup-filter', role: 'group', 'aria-label': t('lg_filter_label') }, C.FILTERS.map(function (k) {
      var on = k === f;
      return H('button', { type: 'button', class: on ? 'active' : '', 'aria-pressed': on ? 'true' : 'false', 'data-action': 'sup-log-filter', 'data-arg': k }, t('lg_f_' + k));
    }));
    var body = groups.length ? H('div', { class: 'lg-days' }, groups.map(function (g) {
      return H('div', { class: 'lg-day' }, [H('h3', { class: 'lg-day-h' }, g.day === today ? t('lg_today') : g.day), H('ul', { class: 'lg-list' }, g.items.map(function (e) { return logRow(e, msgs); }))]);
    })) : H('p', { class: 'sup-empty' }, t('lg_empty', { filter: t('lg_f_' + f) }));
    return box('log', t('lg_h'), [filters, body, H('p', { class: 'sup-note' }, t('lg_older'))], { kls: 'lg-box' });
  }
  RT.log = function (host) {
    host.appendChild(H('div', { class: 'sup-logpage' }, [fadeBox(), howBox(), logBox()]));
  };

  // ======================================================================
  // レポート（AD-11 / 18-10 / 18-13）
  // ======================================================================
  // 画面と「届く形」に出す中身: 確かめた・送った の間は body（写し）、下書きの間は今の記録から作る
  function reportNow() {
    var rp = St().report, draft = SUP.reportDraft(), b = rp.state !== 'draft' && rp.body ? C.reportThaw(rp.body) : null, ids = {};
    draft.forEach(function (s) { s.items.forEach(function (it) { ids[it.id] = true; }); });
    return { rp: rp, draft: draft, ids: ids, frozen: !!b, sections: b ? b.sections : draft, extra: b ? b.extra : rp.extra, stale: !!b && !C.reportSame(rp.body, draft, rp.extra) };
  }
  function srcOf(src) { return src === 'own' ? srcChip('own', t('rp_src_own')) : srcChip('record', t(src === 'calc' ? 'rp_src_calc' : 'rp_src_record')); }
  // live = 今の記録にもある項目。写しにだけある項目（確かめた後に消えた行など）は 直す・載せない を出さない（rp_stale の文で案内）
  function rpItem(it, locked, live) {
    var ed = live ? vv().rpEdit[it.id] : null;
    var chips = [srcOf(it.src), it.edited ? recChip(t('rp_edited')) : null, it.off ? chip(t('rp_off_chip'), 'k-off') : null];
    var main = ed != null && !locked
      ? editor({ id: it.id, fk: 'rp-ed:' + it.id, ui: 'sv-rp-edit', label: t('rp_edit'), value: ed, need: ed, save: 'sup-rp-save', cancel: 'sup-rp-ecancel', rows: 3 })
      : H('p', { class: 'rp-text' }, it.text);
    var ops = (ed != null && !locked) || !live ? null : H('span', { class: 'sup-row-ops' }, [
      link(t('rp_edit'), 'sup-rp-edit', { id: it.id, disabled: locked }),
      it.edited ? link(t('rp_restore'), 'sup-rp-restore', { id: it.id, disabled: locked }) : null,
      link(t(it.off ? 'rp_on' : 'rp_off'), 'sup-rp-off', { id: it.id, disabled: locked })
    ]);
    return H('li', { class: 'rp-item' + (it.off ? ' is-off' : ''), 'data-fk': 'rp:' + it.id, tabindex: '-1' }, [H('div', { class: 'rp-chips' }, chips), main, ops]);
  }
  function rpMain(now) {
    var rp = now.rp, on = C.reportOnCount(now.sections), kids = [btn(t('rp_preview'), 'sup-rp-preview', { kls: '' })];
    if (rp.state === 'draft') {
      kids.push(H('button', { class: 'btn orange', type: 'button', 'data-action': 'sup-rp-check', 'data-fk': 'rp-main', disabled: !on }, t('rp_check')));
      if (!on) kids.push(H('p', { class: 'sup-warn' }, t('rp_need_one')));
    } else if (rp.state === 'checked') {
      // 「送る」は列の末尾（二度押しで「確かめた」の位置に来ないように。先頭側は「下書きに戻す」）
      kids.push(btn(t('rp_to_draft'), 'sup-rp-draft'));
      kids.push(H('span', { class: 'rp-send' }, [H('button', { class: 'btn orange', type: 'button', 'data-action': 'sup-rp-send', 'data-fk': 'rp-main' }, t('rp_send')), H('small', { class: 'sup-note' }, t('rp_send_note'))]));
    } else {
      kids.push(H('span', { class: 'rp-sent' }, t('rp_sent_line', { at: rp.sentAt || '' })));
      kids.push(H('button', { class: 'btn small', type: 'button', 'data-action': 'sup-rp-draft', 'data-fk': 'rp-main' }, t('rp_to_draft')));
    }
    return H('div', { class: 'rp-bar' }, kids);
  }
  RT.report = function (host) {
    var now = reportNow(), rp = now.rp, locked = rp.state === 'sent', span = SD.report.span;
    host.appendChild(H('div', { class: 'sup-lead' }, [H('p', null, t('rp_sub')), H('ul', { class: 'rp-rules' }, [t('rp_rule1'), t('rp_rule2'), t('rp_rule3')].map(function (x) { return H('li', null, x); }))]));
    var kids = [H('div', { class: 'rp-head' }, [H('span', { class: 'rp-span' }, t('rp_span', { from: span[0], to: span[1] })), H('span', { class: 'chip rp-st rp-st-' + rp.state, 'data-fk': 'rp-state', tabindex: '-1' }, [H('span', null, t('rp_st_' + rp.state))])])];
    if (now.stale) kids.push(H('p', { class: 'sup-warn' }, t('rp_stale')));
    if (locked) kids.push(H('p', { class: 'sup-warn' }, t('rp_locked')));
    now.sections.forEach(function (s) {
      var hid = 'rps-' + s.id;
      kids.push(H('section', { class: 'rp-sec', 'aria-labelledby': hid }, [
        H('h2', { id: hid }, s.head),
        s.items.length ? H('ul', { class: 'rp-items' }, s.items.map(function (it) { return rpItem(it, locked, !!now.ids[it.id]); })) : null,
        s.note ? H('p', { class: 'sup-note' }, s.note) : null
      ]));
    });
    kids.push(H('div', { class: 'sup-field rp-extra' }, [
      H('label', { class: 'sup-label', for: 'sv-rp-extra' }, t('rp_extra')),
      H('textarea', { id: 'sv-rp-extra', rows: '3', 'data-ui': 'sv-rp-extra', 'data-fk': 'rp-extra', placeholder: t('rp_extra_ph'), value: now.extra, disabled: locked })
    ]));
    kids.push(rpMain(now));
    host.appendChild(H('div', { class: 'sup-report sup-box' }, kids));
  };
  function openPreview(opener) {
    var dlg = document.getElementById('sup-dialog'), now = reportNow(), span = SD.report.span;
    if (!dlg) return;
    dlg.textContent = '';
    dlg.className = 'make-dialog sup-dialog sup-preview-dialog';
    dlg.setAttribute('aria-labelledby', 'sup-dlg-h');
    var body = C.reportOut(now.sections).map(function (s) {
      return H('section', { class: 'rpv-sec' }, [H('h3', null, s.head), H('ul', null, s.items.map(function (x) { return H('li', null, x); })), s.note ? H('p', { class: 'rpv-note' }, s.note) : null]);
    });
    if (trim(now.extra)) body.push(H('p', { class: 'rpv-extra' }, now.extra));
    body.push(H('p', { class: 'rpv-from' }, t('rp_from')));
    dlg.appendChild(H('div', { class: 'dialog-head' }, [H('h2', { id: 'sup-dlg-h', tabindex: '-1' }, t('rp_preview_h', { from: span[0], to: span[1] })), closeX()]));
    dlg.appendChild(H('div', { class: 'dialog-body rpv' }, body));
    DES.app.openDialog(dlg, opener);
    dlg.querySelector('h2').focus();
  }

  // ======================================================================
  // 操作
  // ======================================================================
  function rerender(fk) { DES.app.render(); if (fk) focusFk(fk); }
  // 今日
  A['sup-talk-all'] = function (el) { openTalk(el, null); };
  A['sup-see-talk'] = function (el) { openTalk(el, el.getAttribute('data-arg')); };
  A['sup-idea-send'] = function () {
    var v = vv(), text = trim(v.idea);
    if (!text || DES.ui.sending) return;
    v.idea = '';
    SUP.postIdea(text);
    DES.app.toast(t('td_idea_sent'));
    focusFk('sv-idea');
  };
  A['sup-idea-clear'] = function () { vv().idea = ''; rerender('sv-idea'); };

  // 手がかり: 観察メモ
  A['sup-note-open'] = function (el) { var ax = el.getAttribute('data-id'); vv().noteAdd[ax] = ''; rerender('note-new:' + ax); };
  A['sup-note-cancel'] = function (el) { var ax = el.getAttribute('data-id'); delete vv().noteAdd[ax]; rerender('note-add:' + ax); };
  A['sup-note-save'] = function (el) {
    var ax = el.getAttribute('data-id'), v = vv(), text = trim(v.noteAdd[ax]);
    if (!text || AXES.indexOf(ax) < 0) return;
    var w = at();
    DES.app.change(function () {
      St().notes = (St().notes || []).concat([{ id: newId('n'), axis: ax, text: text, day: w.day, time: w.time }]);
      SUP.addLog('note', 'desk', t('log_note_add', { axis: SD.axisHead[ax] }));
      delete v.noteAdd[ax];
    }, { focus: 'note-add:' + ax });
    DES.app.toast(t('saved_toast'));
  };
  A['sup-note-edit'] = function (el) {
    var id = el.getAttribute('data-id'), n = find(St().notes, id);
    if (!n) return;
    vv().noteEdit[id] = n.text;
    rerender('note-ed:' + id);
  };
  A['sup-note-ecancel'] = function (el) { var id = el.getAttribute('data-id'); delete vv().noteEdit[id]; DES.app.render(); focusSel(btnSel('sup-note-edit', id)); };
  A['sup-note-update'] = function (el) {
    var id = el.getAttribute('data-id'), v = vv(), n = find(St().notes, id), text = trim(v.noteEdit[id]);
    if (!n || !text) return;
    if (text === n.text) { delete v.noteEdit[id]; DES.app.render(); focusSel(btnSel('sup-note-edit', id)); return; }
    DES.app.change(function () {
      n.text = text;
      SUP.addLog('note', 'desk', t('log_note_edit', { axis: SD.axisHead[n.axis] }));
      delete v.noteEdit[id];
    }, { sel: btnSel('sup-note-edit', id) });
    DES.app.toast(t('saved_toast'));
  };
  A['sup-note-del'] = function (el) {
    var id = el.getAttribute('data-id'), list = St().notes || [], idx = -1, n = null;
    list.forEach(function (x, i) { if (x.id === id) { idx = i; n = x; } });
    if (!n) return;
    var keep = clone(n);
    DES.app.change(function () {
      St().notes = list.filter(function (x) { return x.id !== id; });
      SUP.addLog('note', 'desk', t('log_note_del', { axis: SD.axisHead[n.axis] }));
    }, { focus: 'note-add:' + n.axis, sel: '[data-fk="note-new:' + esc(n.axis) + '"]' });
    DES.app.toast(t('removed_toast'), { label: t('undo'), fn: function () {
      if (find(St().notes, keep.id)) return;
      DES.app.change(function () {
        var cur = (St().notes || []).slice();
        cur.splice(Math.min(idx, cur.length), 0, keep);
        St().notes = cur;
        SUP.addLog('note', 'desk', t('log_note_back', { axis: SD.axisHead[keep.axis] }));
      }, { sel: btnSel('sup-note-edit', keep.id) });
    } });
  };

  // 助言
  A['sup-adv-clear'] = function () { vv().adv = { aim: '', basis: '', scene: 'none' }; rerender('sv-adv-aim'); };
  A['sup-adv-send'] = function () {
    var a = vv().adv, aim = trim(a.aim);
    if (!aim) return;
    var id = newId('ad'), w = at(), scene = SCENE_OPTS.indexOf(a.scene) >= 0 ? a.scene : 'none', basis = trim(a.basis) || null;
    DES.app.change(function () {
      St().advice = [{ id: id, day: w.day, time: w.time, mine: true, added: true, state: 'new', prev: null, scene: scene, aim: aim, basis: basis,
        stages: { view: null, trial: null, result: null, update: null } }].concat(St().advice || []);
      SUP.addLog('advice', 'desk', t('log_advice_add', { aim: aim }), { advice: id });
      vv().adv = { aim: '', basis: '', scene: 'none' };
    }, { focus: 'adv:' + id });
    DES.app.toast(t('ad_sent'));
  };
  A['sup-adv-edit'] = function (el) {
    var id = el.getAttribute('data-id'), x = find(adviceAll(), id);
    if (!x) return;
    vv().advEdit[id] = { aim: nm(x, x.aim), basis: x.basis ? nm(x, x.basis) : '' };
    rerender('adv-ed-aim:' + id);
  };
  A['sup-adv-ecancel'] = function (el) { var id = el.getAttribute('data-id'); delete vv().advEdit[id]; DES.app.render(); focusSel(btnSel('sup-adv-edit', id)); };
  A['sup-adv-update'] = function (el) {
    var id = el.getAttribute('data-id'), v = vv(), e = v.advEdit[id], cur = find(adviceAll(), id);
    if (!e || !cur) return;
    var aim = trim(e.aim), basis = trim(e.basis) || null;
    if (!aim) return;
    if (aim === nm(cur, cur.aim) && basis === (cur.basis ? nm(cur, cur.basis) : null)) { delete v.advEdit[id]; DES.app.render(); focusSel(btnSel('sup-adv-edit', id)); return; }
    DES.app.change(function () {
      var x = adviceMine(id);
      x.aim = aim;
      x.basis = basis;
      SUP.addLog('advice', 'desk', t('log_advice_edit', { aim: aim }), { advice: id });
      delete v.advEdit[id];
    }, { sel: btnSel('sup-adv-edit', id) });
    DES.app.toast(t('saved_toast'));
  };
  A['sup-adv-view'] = function (el) {
    var id = el.getAttribute('data-id');
    DES.app.change(function () {
      var x = adviceMine(id);
      if (!x || !x.added || (x.stages && x.stages.view)) return;
      x.stages = x.stages || { view: null, trial: null, result: null, update: null };
      x.stages.view = x.scene && x.scene !== 'none' ? t('advice_view', { scene: sceneLabel(x.scene) }) : t('advice_view_any');
      x.state = 'waiting';
    }, { focus: 'adv:' + id });
  };
  function adviceBack(id, sel) {
    DES.app.change(function () {
      var x = adviceMine(id);
      if (!x || x.state !== 'withdrawn') return;
      x.state = x.prev || 'new';
      x.prev = null;
      SUP.addLog('advice', 'desk', t('log_advice_back', { aim: x.aim }), { advice: id });
    }, { sel: sel || btnSel('sup-adv-withdraw', id), focus: 'adv:' + id });
  }
  A['sup-adv-withdraw'] = function (el) {
    var id = el.getAttribute('data-id');
    DES.app.change(function () {
      var x = adviceMine(id);
      if (!x || x.state === 'withdrawn') return;
      x.prev = x.state;
      x.state = 'withdrawn';
      SUP.addLog('advice', 'desk', t('log_advice_withdraw', { aim: x.aim }), { advice: id });
    }, { sel: btnSel('sup-adv-back', id) });
    DES.app.toast(t('withdrawn_toast'), { label: t('undo'), fn: function () { adviceBack(id); } });
  };
  A['sup-adv-back'] = function (el) { adviceBack(el.getAttribute('data-id')); };

  // 足場かけの記録
  A['sup-log-filter'] = function (el) {
    var k = el.getAttribute('data-arg');
    if (C.FILTERS.indexOf(k) < 0) return;
    DES.app.change(function () { St().logFilter = k; });
  };

  // レポート
  function toDraft(rp) { if (rp.state === 'checked') { rp.state = 'draft'; rp.body = null; } }
  function rpLive(id) { return !!reportNow().ids[id]; }
  function rpItemNow(id) {
    var hit = null;
    reportNow().sections.forEach(function (s) { (s.items || []).forEach(function (it) { if (it.id === id) hit = it; }); });
    return hit;
  }
  function rpOrig(id) {
    var hit = null;
    SUP.reportDraft().forEach(function (s) { s.items.forEach(function (it) { if (it.id === id) hit = it; }); });
    return hit;
  }
  A['sup-rp-edit'] = function (el) {
    var id = el.getAttribute('data-id'), it = rpItemNow(id);
    if (!it || !rpLive(id) || St().report.state === 'sent') return;
    vv().rpEdit[id] = it.text;
    rerender('rp-ed:' + id);
  };
  A['sup-rp-ecancel'] = function (el) { var id = el.getAttribute('data-id'); delete vv().rpEdit[id]; DES.app.render(); focusSel(btnSel('sup-rp-edit', id)); };
  A['sup-rp-save'] = function (el) {
    var id = el.getAttribute('data-id'), v = vv(), text = trim(v.rpEdit[id]), rp = St().report, o = rpOrig(id);
    if (!text || rp.state === 'sent' || !rpLive(id)) return;
    DES.app.change(function () {
      if (o && text === o.orig) delete rp.edits[id]; else rp.edits[id] = text;
      toDraft(rp);
      delete v.rpEdit[id];
    }, { sel: btnSel('sup-rp-edit', id) });
    DES.app.toast(t('saved_toast'));
  };
  A['sup-rp-restore'] = function (el) {
    var id = el.getAttribute('data-id'), rp = St().report;
    if (rp.state === 'sent' || !rpLive(id)) return;
    DES.app.change(function () { delete rp.edits[id]; toDraft(rp); }, { sel: btnSel('sup-rp-edit', id) });
  };
  A['sup-rp-off'] = function (el) {
    var id = el.getAttribute('data-id'), rp = St().report;
    if (rp.state === 'sent' || !rpLive(id)) return;
    DES.app.change(function () { if (rp.off[id]) delete rp.off[id]; else rp.off[id] = true; toDraft(rp); });
  };
  // 確かめた → 送る → 下書きに戻す は、状態が変わった直後の押し直し（二度押し・連打）を受けない。フォーカスは状態チップへ移す
  // 受けないのは「その遷移で作った状態のまま」の間だけ（補足の入力などで状態が変わっていれば、すぐ押せる）
  var rpAt = 0, rpTo = null, RP_GAP = 600, RP_FOCUS = { sel: '[data-fk="rp-state"]', focus: 'rp-state' };
  function rpBusy() { return Date.now() - rpAt < RP_GAP && St().report.state === rpTo; }
  function rpMark(to) { rpAt = Date.now(); rpTo = to; }
  A['sup-rp-check'] = function () {
    var rp = St().report, d = SUP.reportDraft();
    if (rpBusy() || rp.state !== 'draft' || !C.reportOnCount(d)) return;
    rpMark('checked');
    DES.app.change(function () {
      rp.state = 'checked';
      rp.body = C.reportFreeze(d, rp.extra);
      SUP.addLog('report', 'desk', t('log_report_checked'));
    }, RP_FOCUS);
  };
  A['sup-rp-send'] = function () {
    var rp = St().report;
    if (rpBusy() || rp.state !== 'checked') return;
    rpMark('sent');
    DES.app.change(function () {
      rp.state = 'sent';
      rp.sentAt = SUP.today() + ' ' + DES.data.now;
      SUP.addLog('report', 'desk', t('log_report_sent'));
    }, RP_FOCUS);
    DES.app.toast(t('rp_sent_toast'));
  };
  A['sup-rp-draft'] = function () {
    var rp = St().report;
    if (rpBusy() || rp.state === 'draft') return;
    rpMark('draft');
    DES.app.change(function () {
      rp.state = 'draft';
      rp.body = null;
      rp.sentAt = null;
      SUP.addLog('report', 'desk', t('log_report_draft'));
    }, RP_FOCUS);
  };
  A['sup-rp-preview'] = function (el) { openPreview(el); };

  // ---------- 入力の受け口（一時値に持つ・空なら残すを押せない） ----------
  function onInput(e) {
    var el = e.target, k = el && el.getAttribute ? el.getAttribute('data-ui') : null;
    if (!k || k.indexOf('sv-') !== 0) return;
    var v = vv(), id = el.getAttribute('data-id'), key = el.getAttribute('data-key'), val = el.value;
    if (k === 'sv-idea') {
      v.idea = val;
      setDisabled('sup-idea-send', null, !trim(val) || DES.ui.sending);
      setDisabled('sup-idea-clear', null, !val);
    } else if (k === 'sv-adv') {
      if (key === 'aim' || key === 'basis' || key === 'scene') v.adv[key] = val;
      setDisabled('sup-adv-send', null, !trim(v.adv.aim));
      setDisabled('sup-adv-clear', null, !advDirty());
    } else if (k === 'sv-note-add') {
      v.noteAdd[id] = val;
      setDisabled('sup-note-save', id, !trim(val));
    } else if (k === 'sv-note-edit') {
      v.noteEdit[id] = val;
      setDisabled('sup-note-update', id, !trim(val));
    } else if (k === 'sv-adv-edit') {
      var ae = v.advEdit[id];
      if (!ae) return;
      if (key === 'aim' || key === 'basis') ae[key] = val;
      setDisabled('sup-adv-update', id, !trim(ae.aim));
    } else if (k === 'sv-rp-edit') {
      v.rpEdit[id] = val;
      setDisabled('sup-rp-save', id, !trim(val));
    } else if (k === 'sv-rp-extra') {
      // 補足だけは入力ごとに保存（記録は付けない）。確かめた の間に触ると下書きに戻る（18-10 / 18-13）
      var rp = St().report;
      if (rp.state === 'sent') return;
      if (rp.state === 'checked') {
        if (e.isComposing) return;
        var s0 = el.selectionStart, s1 = el.selectionEnd;
        DES.app.change(function () { rp.extra = val; toDraft(rp); }, { focus: 'rp-extra' });
        var n = document.querySelector('[data-fk="rp-extra"]');
        if (n) { n.focus(); try { n.setSelectionRange(s0, s1); } catch (x) { /* 範囲を戻せなくても入力は残る */ } }
        return;
      }
      rp.extra = val;
      saveSup();
    }
  }
  document.addEventListener('input', onInput);
  document.addEventListener('change', function (e) { if (e.target && e.target.tagName === 'SELECT') onInput(e); });
  document.addEventListener('compositionend', function (e) { if (e.target && e.target.getAttribute && e.target.getAttribute('data-ui') === 'sv-rp-extra') onInput(e); });
})();
