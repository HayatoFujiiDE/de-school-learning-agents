/* 話す: 会話の描画・composer・会話 → 表の連動（CONTRACT-v3 §G / R-7 / §S-2）。
   会話本文・記録・本人の言葉は textContent で描く（DES.h の文字列子要素はテキストノード）。 */
window.DES = window.DES || {};
(function () {
  'use strict';
  var DES = window.DES;
  var TK = DES.talk = {};
  var R0 = ['わからない', '分からない', '決められない', '何したら', 'なにしたら', '何をしたら'];
  function S() { return DES.state; }
  function ui() { return DES.ui; }
  function T(k, v) { return DES.t(k, v); }
  function H() { return DES.h.apply(null, arguments); }
  function icon(n) { return DES.raw(DES.icon(n)); }
  function has(text, w) { return text.indexOf(w) >= 0; }

  TK.messages = function () { return (DES.data.talk || []).concat(S().talk || []); };
  // 会話の唯一の追加口。サポーターが入っている間は 本人の発言・記録行に by を付ける（contract-AD §18-1。supporter は送る側が付ける・buddy は付けない）
  TK.push = function (m) {
    var by = DES.sup && DES.sup.byNow ? DES.sup.byNow() : null;
    if (by && !m.by && (m.who === 'child' || m.who === 'record')) m.by = by;
    S().talk = (S().talk || []).concat([m]);
  };
  // 表 → 会話の記録（1 行）。コミットは呼び出し側
  TK.record = function (text) { TK.push({ id: DES.plan.newId('t'), time: DES.data.now, who: 'record', text: text }); };

  // ---------- 応答規則（決定論・応答はサンプル） ----------
  // id = これから足す buddy メッセージの id（提案行の from になる）
  TK.reply = function (text, id) {
    var P = DES.plan, out = { text: '', proposal: null, keep: null }, parts = [];
    // 規則 0（§S-2）: 迷っているとき → おためし 15 分を 1 つ
    if (R0.some(function (w) { return has(text, w); })) {
      var tr = P.trial(null, id);
      if (tr) { out.text = tr.text; out.proposal = tr.row.id; }
      else out.text = T('no_free_trial');
      return out;
    }
    var block = has(text, '午前') ? 'am' : (has(text, '午後') ? 'pm' : null);
    // 規則 2（R-7 で規則 1 より先）: 運動 + 見送 → optional を skip
    var rule2 = false;
    if (has(text, '運動') && has(text, '見送')) {
      var ex = P.live(S().plan).filter(function (r) { return r.kind === 'optional'; })[0];
      if (ex) {
        rule2 = true;
        S().plan = P.setChoice(S().plan, ex.id, 'skip').rows;
        parts.push(DES.fmt(DES.text.rep_skip, { range: P.range(ex.start, ex.end) }));
      }
    }
    // 規則 1: 取り組み名 → 最初の空きに提案
    var item = P.match(text);
    if (item) {
      var row = P.propose(item.id, { block: block, from: id });
      if (row) {
        parts.push(DES.fmt(DES.text.rep_propose, { start: row.start, title: item.title, len: P.lenOf(row) }));
        out.proposal = row.id;
      } else {
        parts.push(T('no_free'));
        out.keep = item.id;
      }
    } else if (!rule2 && has(text, '午後') && (has(text, 'やりたい') || has(text, 'したい'))) {
      // 規則 3: 午後の空きを freeSlots から
      var fs = P.freeNow({ block: 'pm' });
      parts.push(fs.length
        ? DES.fmt(DES.text.rep_pm, { ranges: fs.map(function (f) { return P.range(f.start, f.end); }).join('、') })
        : DES.text.rep_pm_none);
    }
    if (!parts.length) parts.push(DES.text.rep_default); // 規則 4
    out.text = parts.join('\n');
    return out;
  };

  TK.send = function () {
    var ta = document.getElementById('composer');
    if (!ta || ui().sending) return;
    var text = ta.value;
    if (!text.replace(/\s/g, '')) return;
    // 入っている間の入力のしかた（contract-AD §AD-6）: {sup}として話す / アイデアを出す は バディの返事の規則を通さない
    var stance = DES.sup && DES.sup.isJoined() ? DES.sup.stance() : 'proxy';
    if (stance === 'voice' || stance === 'idea') {
      ta.value = '';
      S().draft = { text: '', scroll: S().draft.scroll || 0 };
      if (stance === 'voice') DES.sup.voice(text); else DES.sup.postIdea(text);
      TK.syncSend();
      TK.keepComposerInView();
      return;
    }
    ui().sending = true;
    ta.value = '';
    DES.app.change(function () {
      TK.push({ id: DES.plan.newId('t'), time: DES.data.now, who: 'child', text: text });
      S().draft = { text: '', scroll: S().draft.scroll || 0 };
    });
    TK.syncSend();
    TK.keepComposerInView();
    setTimeout(function () {
      var bid = DES.plan.newId('t');
      DES.app.change(function () {
        var r = TK.reply(text, bid), m = { id: bid, time: DES.data.now, who: 'buddy', text: r.text };
        if (r.proposal) m.proposal = r.proposal;
        if (r.keep) m.keep = r.keep;
        TK.push(m);
      });
      ui().sending = false;
      TK.syncSend();
      TK.keepComposerInView();
    }, 150);
  };
  TK.syncSend = function () {
    var ta = document.getElementById('composer'), b = document.getElementById('send-btn');
    if (ta && b) b.disabled = ui().sending || !ta.value.replace(/\s/g, '');
  };
  TK.keepComposerInView = function () {
    var c = document.querySelector('.composer');
    if (c && c.scrollIntoView) c.scrollIntoView({ block: 'nearest' });
  };
  // バディに相談する（R-8）: 下書きの末尾に改行して足す（上書きしない）→ composer へ
  TK.prefill = function (title) {
    var line = DES.fmt(DES.text.prefill_line, { title: title });
    DES.app.closePlanDialog();
    DES.app.change(function () {
      var cur = (S().draft && S().draft.text) || '';
      cur = cur.replace(/\s+$/, '');
      S().draft = { text: cur ? cur + '\n' + line : line, scroll: (S().draft && S().draft.scroll) || 0 };
    });
    DES.app.toast(T('prefilled'));
    if (DES.app.route() !== 'talk') { ui().focusComposer = true; window.location.hash = '#talk'; return; }
    TK.focusComposer();
  };
  TK.focusComposer = function () {
    var ta = document.getElementById('composer');
    if (!ta) return;
    ta.value = S().draft.text || '';
    TK.syncSend();
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    TK.keepComposerInView();
  };

  // ---------- 描画 ----------
  function findRow(id) { var r = null; S().plan.forEach(function (x) { if (x.id === id) r = x; }); return r; }
  function cardHead() {
    return H('div', { class: 'pc-head' }, [DES.raw(DES.buddy(18, 'think')), DES.plan.srcChip('ai', T('ai_proposal'))]);
  }
  function proposalCard(m) {
    var r = findRow(m.proposal);
    if (!r) return null;
    var P = DES.plan, rg = P.range(r.start, r.end), kids = [cardHead()], status = null, acts = null;
    var body = [H('span', null, (r.kind === 'mine' && !r.gone) ? r.title : rg + ' ' + r.title)];
    if (r.trial) body.push(' ', H('span', { class: 'chip k-trial' }, T('trial')));
    if (r.gone === 'removed') status = T('card_removed');
    else if (r.gone === 'finished') status = T('finished');
    else if (r.gone === 'declined') status = T('declined');
    else if (r.kind === 'proposed') {
      acts = [P.btn(T('add_to_plan'), 'accept', { id: r.id, kls: 'orange' }), P.btn(T('later'), 'hold', { id: r.id }), P.btn(T('decline'), 'decline', { id: r.id })];
    } else if (r.kind === 'mine') status = T('in_plan') + ' ' + rg;
    else if (r.kind === 'held') { status = T('kind_held'); acts = [P.btn(T('add_to_plan'), 'accept', { id: r.id })]; }
    kids.push(H('div', { class: 'pc-body' }, body));
    if (status) kids.push(H('div', { class: 'pc-status' }, status));
    if (acts) kids.push(H('div', { class: 'actions' }, acts));
    return H('div', { class: 'proposal-card', 'data-fk': 'card:' + r.id, tabindex: '-1' }, kids);
  }
  function keepCard(m) {
    var it = DES.plan.item(m.keep);
    if (!it) return null;
    var mk = (S().catalogMarks || {})[m.keep], kids = [cardHead(), H('div', { class: 'pc-body' }, it.title)];
    if (mk && mk.tomorrow) kids.push(H('div', { class: 'pc-status' }, [H('span', { class: 'chip k-tomorrow' }, T('kept_tomorrow'))]));
    else kids.push(H('div', { class: 'actions' }, [DES.plan.btn(T('keep_tomorrow'), 'keep-tomorrow', { id: m.keep })]));
    return H('div', { class: 'proposal-card', 'data-fk': 'keep:' + m.id, tabindex: '-1' }, kids);
  }
  // ---------- サポーター（contract-AD §AD-6） ----------
  function supName(by) { return DES.sup ? (by ? DES.sup.nameOf(by) : DES.sup.supName()) : ''; }
  function recChip(text) { return DES.plan.srcChip('record', text); }
  // アイデアカード（サポーターの bubble の下）。sup.ideas の状態を、行・活動の今の状態に追従して出す
  function ideaCard(m) {
    var v = DES.sup ? DES.sup.ideaView(m.idea) : null;
    if (!v) return null;
    var P = DES.plan, id = v.idea.id, name = supName(m.by), head = [recChip(T('idea_label', { sup: name }))], kids, status = null, acts = [];
    var canPlan = !!(v.idea.catalogId && P.item(v.idea.catalogId));
    function makeBtn() { return P.btn(T('idea_make'), 'idea-make', { id: id, kls: 'orange' }); }
    function planBtn() { return canPlan ? P.btn(T('idea_plan'), 'idea-plan', { id: id }) : null; }
    if (v.state === 'open') acts = [makeBtn(), planBtn(), P.btn(T('idea_later'), 'idea-later', { id: id })];
    else if (v.state === 'later') { status = T('idea_later_st'); acts = [makeBtn(), planBtn()]; }
    else if (v.state === 'made') { status = T('idea_made_st'); acts = [P.btn(T('resume_make'), 'idea-open', { id: id, kls: 'orange' })]; }
    else if (v.state === 'planned') {
      var r = v.row;
      if (r.gone === 'removed') { status = T('card_removed'); acts = [planBtn()]; }
      else if (r.gone === 'finished') status = T('finished');
      else status = T('in_plan') + ' ' + P.range(r.start, r.end);
    } else if (v.state === 'withdrawn') status = T('idea_withdrawn', { sup: name });
    if (DES.sup.isJoined() && DES.sup.canWithdraw(id)) head.push(H('button', { class: 'link-btn idea-withdraw', type: 'button', 'data-action': 'idea-withdraw', 'data-id': id }, DES.sup.t('withdraw')));
    kids = [H('div', { class: 'pc-head' }, head)];
    if (status) kids.push(H('div', { class: 'pc-status' }, status));
    acts = acts.filter(Boolean);
    if (acts.length) kids.push(H('div', { class: 'actions' }, acts));
    return H('div', { class: 'proposal-card idea-card', 'data-fk': 'idea:' + id, tabindex: '-1' }, kids);
  }
  function supporterEl(m) {
    var name = supName(m.by);
    var body = H('div', { class: 'msg-body' }, [H('span', { class: 'sup-name' }, name), H('div', { class: 'bubble' }, m.text)]);
    if (m.idea) { var c = ideaCard(m); if (c) body.appendChild(c); }
    body.appendChild(H('span', { class: 'msg-time' }, m.time));
    return H('div', { class: 'message supporter', 'data-id': m.id }, [H('span', { class: 'sup-avatar', role: 'img', 'aria-label': name }, name.charAt(0)), body]);
  }
  // 1 件の発言の要素（サポーター画面の「会話を全部見る」用。readOnly = カードのボタンを出さない）
  TK.messageEl = function (m, o) {
    var el = messageEl(m);
    if (o && o.readOnly) Array.prototype.forEach.call(el.querySelectorAll('.actions, button'), function (n) { if (n.parentNode) n.parentNode.removeChild(n); });
    return el;
  };
  function messageEl(m) {
    if (m.who === 'record') {
      return H('div', { class: 'message record', 'data-id': m.id }, [
        DES.plan.srcChip('record', T('record_label')),
        m.by ? recChip(T('by_with', { sup: supName(m.by) })) : null,
        H('span', { class: 'msg-time' }, m.time),
        H('span', { class: 'rec-text' }, m.text)
      ]);
    }
    if (m.who === 'supporter') return supporterEl(m);
    var body = H('div', { class: 'msg-body' }, [H('div', { class: 'bubble' }, m.text)]);
    if (m.proposal) { var c = proposalCard(m); if (c) body.appendChild(c); }
    if (m.keep) { var k = keepCard(m); if (k) body.appendChild(k); }
    if (m.who === 'child' && m.by) body.appendChild(recChip(T('by_typed', { sup: supName(m.by) })));
    body.appendChild(H('span', { class: 'msg-time' }, m.time));
    if (m.who === 'buddy') return H('div', { class: 'message buddy', 'data-id': m.id }, [DES.raw(DES.buddy(30, 'neutral')), body]);
    return H('div', { class: 'message user', 'data-id': m.id }, [body]);
  }

  // 入っている間だけ、textarea の上に 入力のしかた 3 つ（contract-AD §AD-6）。切り替えは aria-pressed と placeholder だけ差し替える（18-9）
  function joined() { return !!(DES.sup && DES.sup.isJoined()); }
  function composerPh() { return joined() ? DES.sup.t('ph_' + DES.sup.stance()) : T('composer_ph'); }
  function stanceEl() {
    if (!joined()) return null;
    var cur = DES.sup.stance();
    return H('div', { class: 'segmented stance', role: 'group', 'aria-label': DES.sup.t('stance_label') }, ['proxy', 'voice', 'idea'].map(function (s) {
      return H('button', { type: 'button', class: s === cur ? 'active' : '', 'aria-pressed': s === cur ? 'true' : 'false', 'data-action': 'sup-stance', 'data-arg': s }, DES.sup.t('stance_' + s));
    }));
  }
  TK.syncStance = function () {
    var ta = document.getElementById('composer');
    if (!ta || !joined()) return;
    var cur = DES.sup.stance();
    ta.placeholder = composerPh();
    Array.prototype.forEach.call(document.querySelectorAll('.segmented.stance button'), function (b) {
      var on = b.getAttribute('data-arg') === cur;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  };
  // content を作り直すのは route / mode が変わった時だけ（composer の入力とフォーカスを保つ）
  TK.renderPage = function (content, rebuild) {
    var st = S();
    if (rebuild || !document.getElementById('message-list')) {
      content.textContent = '';
      var draft = (st.draft && st.draft.text) || '';
      var page = H('div', { class: 'chat-page' }, [
        H('div', { class: 'chat-welcome' }, [DES.raw(DES.buddy(56, 'happy')), H('h1', null, T('welcome_h')), H('p', null, T('welcome_p'))]),
        H('div', { class: 'message-list', id: 'message-list' }),
        H('div', { class: 'chat-bridge' }, [H('p', null, T('bridge')), H('a', { class: 'btn', href: '#make', 'data-action': 'bridge-make' }, T('make'))]),
        H('div', { class: 'composer' }, [
          stanceEl(),
          H('label', { class: 'sr-only', for: 'composer' }, T('composer_label')),
          H('textarea', { id: 'composer', rows: '3', placeholder: composerPh(), 'data-ui': 'composer', value: draft }),
          H('div', { class: 'composer-bottom' }, [
            H('div', { class: 'composer-tools' }, [
              H('button', { class: 'btn ghost small', type: 'button', 'data-action': 'media' }, [icon('camera'), H('span', null, T('photo'))]),
              H('button', { class: 'btn ghost small', type: 'button', 'data-action': 'media' }, [icon('mic'), H('span', null, T('voice'))])
            ]),
            H('div', { class: 'composer-send' }, [
              H('span', { class: 'hint' }, T('sample_note')),
              H('button', { class: 'btn orange', id: 'send-btn', type: 'button', 'data-action': 'send', disabled: !draft.replace(/\s/g, '') }, [icon('send'), H('span', null, T('send'))])
            ])
          ])
        ]),
        H('p', { class: 'privacy-line' }, [H('span', { class: 'privacy-note' }, [icon('lock'), H('span', null, T('share_note'))])]),
        H('div', { class: 'chat-done' }, [H('a', { class: 'btn ghost', href: '#paused' }, [icon('pause'), H('span', null, T('done_today'))])])
      ]);
      var aside = H('aside', { class: 'plan-panel', id: 'plan-panel', 'aria-label': T('plan') });
      content.appendChild(H('div', { class: 'talk-layout' }, [page, aside]));
    }
    var layout = content.querySelector('.talk-layout');
    var b = DES.app.bp(), inline = (b === 'xl' || b === 'l');
    layout.classList.toggle('panel-closed', !inline || st.panel !== 'open');
    var list = document.getElementById('message-list');
    list.textContent = '';
    TK.messages().forEach(function (m) { list.appendChild(messageEl(m)); });
    // あしあとの「話すで見る」（CONTRACT-v3 §Z-4）: DES.ui.focusMsg の発言へ 1 回だけ移る。
    // ルート移動の scrollTo(0,0) の後にスクロールするため、スクロールだけ次のタスクで行う
    var fm = ui().focusMsg;
    if (fm) {
      ui().focusMsg = null;
      var tgt = null;
      Array.prototype.forEach.call(list.children, function (n) { if (n.getAttribute('data-id') === fm) tgt = n; });
      if (tgt) {
        tgt.setAttribute('tabindex', '-1');
        tgt.classList.add('is-trail-focus');
        tgt.focus({ preventScroll: true });
        setTimeout(function () { if (tgt.isConnected && tgt.scrollIntoView) tgt.scrollIntoView({ block: 'center' }); }, 0);
      }
    }
    var aside2 = document.getElementById('plan-panel');
    if (inline && st.panel === 'open') DES.plan.renderPanel(aside2, { ctx: 'panel', compact: false });
    else aside2.textContent = '';
  };
  TK.renderPaused = function (content) {
    content.textContent = '';
    content.appendChild(H('div', { class: 'paused' }, [
      DES.raw(DES.buddy(56, 'neutral')),
      H('h1', null, T('paused_h')),
      H('p', null, T('paused_p')),
      H('button', { class: 'btn primary', type: 'button', 'data-action': 'resume' }, T('resume'))
    ]));
  };

  // ---------- 入力の受け口 ----------
  TK.bind = function () {
    document.addEventListener('input', function (e) {
      var t = e.target;
      if (!t || !t.getAttribute) return;
      var u = t.getAttribute('data-ui');
      if (u === 'composer') {
        S().draft = { text: t.value, scroll: (S().draft && S().draft.scroll) || 0 };
        if (!DES.store.save('draft')) DES.app.renderSaveState();
        TK.syncSend();
      } else if (u === 'goal-input' && ui().goalEdit) {
        ui().goalEdit.value = t.value;
      }
    });
    document.addEventListener('change', function (e) {
      var t = e.target, u = t && t.getAttribute ? t.getAttribute('data-ui') : null;
      if (!ui().edit) return;
      if (u === 'edit-start') ui().edit.start = t.value;
      if (u === 'edit-len') ui().edit.len = +t.value;
    });
    document.addEventListener('keydown', function (e) {
      var t = e.target;
      if (t && t.id === 'composer' && e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing) {
        e.preventDefault();
        TK.send();
      }
    });
  };

  var A = DES.actions = DES.actions || {};
  A['send'] = function () { TK.send(); };
  A['media'] = function () { DES.app.toast(T('demo_media')); };
  // bridge（CONTRACT-v3 §U-2）: 直近の本人発言から題材を決め、仮の案 3 つを置いた作業台を作って開く
  A['bridge-make'] = function () { DES.make.fromTalk(); };
})();
