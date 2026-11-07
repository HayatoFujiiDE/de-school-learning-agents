/* 話す: 会話の描画・composer・送信（CONTRACT-v3 §G / R-7、contract-LS §LS-11 / §LS-18）。
   会話 = Codex の des.buddy-live.v1 の messages（DES.live.state）+ 本サイトの des.live.talkLocal（表の操作の記録行・サポーターの発言）を
   日時で並べた 1 本。送信は Codex app-live/app.js の sendChat の写し（requestId・beginSend・api.send・finishSend / failSend）。
   会話本文・記録・本人の言葉は textContent で描く（DES.h の文字列子要素はテキストノード）。
   純関数（merge / withDays / pushLocalList / project …）は DOM に触れない（node から module.exports で呼べる）。 */
(function (root) {
  'use strict';
  var DES = root.DES = root.DES || {};
  var TK = DES.talk = DES.talk || {};
  var MAX_LOCAL = 400;

  // ---------- 純関数 ----------
  var FMT = null;
  // ISO → JST の { date:'YYYY-MM-DD', time:'HH:mm' }
  function jst(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return { date: '', time: '' };
    if (!FMT) FMT = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    var p = {};
    FMT.formatToParts(d).forEach(function (x) { p[x.type] = x.value; });
    return { date: p.year + '-' + p.month + '-' + p.day, time: (p.hour === '24' ? '00' : p.hour) + ':' + p.minute };
  }
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  // Codex の message → 表示用（LS-18 18-6: at = createdAt を写す。Codex の保存には足さない）
  function project(m) {
    var t = jst(m.createdAt), v = { id: m.id, at: m.createdAt, date: t.date, time: t.time, who: m.role === 'user' ? 'child' : 'buddy', text: m.content, by: null };
    if (m.role === 'user') { v.delivery = m.delivery; if (m.error) v.error = m.error; }
    else v.proposals = m.proposals || [];
    return v;
  }
  // talkLocal の要素 → 表示用（time / date は at から導き直す）
  function localView(e) {
    var t = jst(e.at), v = { id: e.id, at: e.at, date: t.date || e.date || '', time: t.time || e.time || '', who: e.who, text: e.text, by: e.by == null ? null : e.by, kind: e.kind || null, refs: isObj(e.refs) ? e.refs : {} };
    if (e.idea != null) v.idea = e.idea;
    return v;
  }
  // 結合して日時順（同じ時刻は Codex → talkLocal、それぞれ元の順）
  function merge(messages, local) {
    var list = [];
    (messages || []).forEach(function (m, i) { list.push({ v: project(m), k: 0, i: i }); });
    (local || []).forEach(function (e, i) { if (e && typeof e.at === 'string') list.push({ v: localView(e), k: 1, i: i }); });
    list.forEach(function (x) { var n = Date.parse(x.v.at); x.t = isNaN(n) ? 0 : n; });
    list.sort(function (a, b) { return a.t - b.t || a.k - b.k || a.i - b.i; });
    return list.map(function (x) { return x.v; });
  }
  // 日付が変わる所に区切り（{ sep: 'YYYY-MM-DD' }）。最初の日付の前にも入れる
  function withDays(list) {
    var out = [], prev = null;
    list.forEach(function (m) {
      if (m.date && m.date !== prev) { out.push({ sep: m.date }); prev = m.date; }
      out.push({ msg: m });
    });
    return out;
  }
  // talkLocal へ 1 件（最大 max 件。古いものから落とす）。新しい配列を返す
  function pushLocalList(list, entry, max) {
    var out = (Array.isArray(list) ? list : []).concat([entry]);
    max = max || MAX_LOCAL;
    return out.length > max ? out.slice(out.length - max) : out;
  }
  // 1 件の形を整える（LS-18 18-1）。now = ISO（無ければ今）
  function normalizeLocal(entry, now, id) {
    var e = entry || {}, at = typeof e.at === 'string' && !isNaN(Date.parse(e.at)) ? e.at : (now || new Date().toISOString()), t = jst(at);
    var who = e.who === 'supporter' ? 'supporter' : 'record';
    var refs = {};
    if (isObj(e.refs)) Object.keys(e.refs).forEach(function (k) { if (e.refs[k] != null) refs[k] = e.refs[k]; });
    return {
      id: typeof e.id === 'string' && e.id ? e.id : id,
      at: at, date: t.date, time: t.time, who: who,
      kind: typeof e.kind === 'string' && e.kind ? e.kind : (who === 'supporter' ? (e.idea != null ? 'idea' : 'voice') : 'record'),
      refs: refs, text: String(e.text == null ? '' : e.text),
      by: typeof e.by === 'string' ? e.by : null,
      idea: isObj(e.idea) || typeof e.idea === 'string' ? e.idea : null
    };
  }
  // 最後の本人発言（Codex の messages の role user）
  function lastOwn(messages) {
    for (var i = (messages || []).length - 1; i >= 0; i--) if (messages[i].role === 'user') return messages[i].content;
    return null;
  }
  // 送れる条件（Codex sendChat と同じ。LS-11 送信 1）
  function canSendState(s) {
    return !!(s.available && !s.issue && !s.pending && !s.sending && s.api && s.api.available && s.count <= s.limit - 2);
  }
  var pure = { jst: jst, project: project, localView: localView, merge: merge, withDays: withDays, pushLocalList: pushLocalList, normalizeLocal: normalizeLocal, lastOwn: lastOwn, canSendState: canSendState, MAX_LOCAL: MAX_LOCAL };
  Object.keys(pure).forEach(function (k) { TK['_' + k] = pure[k]; });

  // ======================================================================
  // ここから下はブラウザ専用
  // ======================================================================
  if (DES.store && DES.store.register) {
    DES.store.register('talkLocal', function (v) {
      return Array.isArray(v) && v.every(function (e) { return isObj(e) && typeof e.id === 'string' && typeof e.at === 'string' && (e.who === 'record' || e.who === 'supporter') && typeof e.text === 'string'; });
    }, function () { return []; });
  }
  // 本ページの live 文言（contract-LS §LS-11。Codex app-live の文は verbatim）
  if (DES.i18n && DES.i18n.add) {
    DES.i18n.add({
      live_unlinked: ['バディの会話は、まだこの画面につながっていないよ', 'バディの会話は、まだこの画面につながっていないよ'],
      svc_checking: ['バディの接続を確認しています', 'バディの接続を確認しています'],
      svc_unconfigured: ['バディは準備中です。予定は自分で追加・編集できます。', 'バディは準備中です。予定は自分で追加・編集できます。'],
      svc_unavailable: ['今はバディへ送信できません。試用の残り回数：{n}', '今はバディへ送信できません。試用の残り回数：{n}'],
      svc_ok: ['バディと話せます · 試用の残り {n} 回', 'バディと話せます · 試用の残り {n} 回'],
      svc_check: ['接続を確認', '接続を確認'],
      pending_wait: ['返事を待っています。予定はまだ変更していません。', '返事を待っています。予定はまだ変更していません。'],
      pending_stale: ['前の送信の返事を受け取れていません。自動では送り直しません。', '前の送信の返事を受け取れていません。自動では送り直しません。'],
      pending_end: ['この送信の受信を終了', 'この送信の受信を終了'],
      pending_ended: ['受信を終了しました。予定は変更していません。', '受信を終了しました。予定は変更していません。'],
      unsaved_p: ['返事は届きましたが、保存できていません。予定は変更していません。', '返事は届きましたが、保存できていません。予定は変更していません。'],
      unsaved_save: ['届いた返事を保存する', '届いた返事を保存する'],
      unsaved_saved: ['返事が届きました。予定の候補は、内容を見てから選べます。', '返事が届きました。予定の候補は、内容を見てから選べます。'],
      restore_msg: ['内容を入力欄に戻す', '内容を入力欄に戻す'],
      restore_keep: ['入力中の文を残しています。先に入力欄の内容を確認してください。', '入力中の文を残しています。先に入力欄の内容を確認してください。'],
      storage_check: ['保存を再確認', '保存を再確認'],
      storage_ok: ['保存できることを確認しました。', '保存できることを確認しました。'],
      no_resend: [' 自動で送り直していません。', ' 自動で送り直していません。'],
      pc_update: ['この内容に変える', 'この内容に変える'],
      pc_remove: ['予定から外す', '予定から外す'],
      pc_updated: ['この内容にした', 'この内容にした'],
      pc_orig: ['元の予定：', '元の予定：']
    });
  }

  function S() { return DES.state; }
  function ui() { return DES.ui; }
  function T(k, v) { return DES.t(k, v); }
  function H() { return DES.h.apply(null, arguments); }
  function icon(n) { return DES.raw(DES.icon(n)); }
  function $(id) { return document.getElementById(id); }
  function L() { return DES.live || null; }
  function linked() { var l = L(); return !!(l && l.available); }
  function liveState() { var l = L(); return (l && l.state) || { events: [], messages: [], pending: null }; }
  function ops() { return L().ops; }
  function uuid() { return DES.plan.uuid(); }
  function rerender() { DES.plan.rerender(); }

  // 接続の状態（Codex app.js checkService の写し。取得は DES.live.api.status）
  var api = { configured: false, available: false, remaining: null }, apiText = null, checking = false, checked = false;
  // 送信中（この画面で送った requestId）/ 届いたが保存できていない返事（Codex の unsavedResponse）
  var sending = null, unsaved = null;

  function checkService() {
    if (checking || !linked()) return Promise.resolve();
    checking = true;
    syncService();
    return L().api.status().then(function (s) {
      api = s;
      apiText = s.error ? s.error : (!s.configured ? T('svc_unconfigured') : (!s.available ? T('svc_unavailable', { n: s.remaining }) : T('svc_ok', { n: s.remaining })));
    }, function () {
      api = { configured: false, available: false, remaining: null };
      apiText = DES.live.text.serviceError(0);
    }).then(function () { checking = false; checked = true; rerender(); });
  }
  TK.checkService = checkService;
  function ensureService() { if (!checked && !checking && linked()) checkService(); }
  TK.ensureService = ensureService;

  // ---------- 会話（公開 API。LS-18 18-27） ----------
  TK.messages = function () { return merge(liveState().messages, (S() && S().talkLocal) || []); };
  TK.lastOwnText = function () { return lastOwn(liveState().messages); };
  // talkLocal へ 1 件（保存は呼び手が DES.app.change で）
  TK.pushLocal = function (entry) {
    var e = normalizeLocal(entry, DES.clock.iso(), uuid());
    S().talkLocal = pushLocalList(S().talkLocal, e, MAX_LOCAL);
    return e;
  };
  // 表 → 会話の記録（1 行）。kind = 記録のテンプレート key、refs = { eventId, proposalId, activity, messageId }。コミットは呼び出し側。
  // サポーターが入っている間は by（その時の表示名）を付ける（contract-AD §18-1 / LS-18 18-21）
  TK.record = function (text, kind, refs) {
    var by = DES.sup && DES.sup.byNow ? DES.sup.byNow() : null;
    return TK.pushLocal({ who: 'record', text: text, kind: kind || 'record', refs: refs || {}, by: by || null });
  };
  // モックの追加口の互換（record / supporter だけ talkLocal へ。本人・バディの発言は Codex の送信でだけ増える）
  TK.push = function (m) {
    if (!m || (m.who !== 'record' && m.who !== 'supporter')) return null;
    return TK.pushLocal({ id: m.id, who: m.who, text: m.text, kind: m.kind, refs: m.refs, by: m.by, idea: m.idea });
  };

  // ---------- 送信（Codex app-live/app.js sendChat の写し） ----------
  function limitOf() { return linked() && ops().LIMITS ? ops().LIMITS.messages : 200; }
  TK.canSend = function () {
    var st = liveState();
    return canSendState({ available: linked(), issue: linked() ? L().issue : 'module', pending: st.pending, sending: sending, api: api, count: st.messages.length, limit: limitOf() });
  };
  function cannotMessage() {
    var st = liveState();
    if (!linked()) return T('live_unlinked');
    if (L().issue) return ops().notices[L().issue] || ops().notices.storage;
    if (st.pending || sending) return ops().notices.pending;
    if (st.messages.length > limitOf() - 2) return ops().notices.message_limit;
    return apiText || T('svc_checking');
  }
  function joined() { return !!(DES.sup && DES.sup.isJoined && DES.sup.isJoined()); }
  function stance() { return joined() && DES.sup.stance ? DES.sup.stance() : 'proxy'; }
  function storeReply() {
    if (!unsaved) return Promise.resolve(false);
    var saved = unsaved;
    return L().commit(function (next) { return ops().finishSend(next, saved.response, saved.messageId, saved.receivedAt); }).then(function (r) {
      if (!r.ok) { DES.app.toast(r.message); rerender(); return false; }
      if (unsaved === saved) unsaved = null;
      rerender();
      return true;
    });
  }
  // 本文 content を送る（composer・バディにまかせる・作るの相談列が同じ経路）。o.fromComposer なら入力欄と下書きを空に。
  // Promise → { ok:true } | { ok:false, message }。画面は移らない
  TK.sendText = function (content, o) {
    o = o || {};
    content = String(content == null ? '' : content).replace(/^\s+|\s+$/g, '');
    if (!content) return Promise.resolve({ ok: false, message: T('composer_ph') });
    if (!TK.canSend()) return Promise.resolve({ ok: false, message: cannotMessage() });
    var requestId = uuid(), messageId = uuid(), payload = null;
    sending = requestId;
    TK.syncSend();
    return L().commit(function (next) {
      return ops().beginSend(next, { requestId: requestId, messageId: messageId, date: DES.clock.today(), content: content, now: Date.now() });
    }).then(function (started) {
      if (!started.ok) { sending = null; DES.app.toast(started.message); rerender(); return { ok: false, message: started.message }; }
      payload = started.value;
      if (o.fromComposer) {
        var ta = $('composer');
        if (ta && ta.value.replace(/^\s+|\s+$/g, '') === content) ta.value = '';
        S().draft = { text: ta ? ta.value : '', scroll: (S().draft && S().draft.scroll) || 0 };
        if (!DES.store.save('draft')) DES.app.renderSaveState();
      }
      rerender();
      TK.keepComposerInView();
      return L().api.send(payload, requestId).then(function (res) {
        if (res.ok) {
          unsaved = { response: res.response, messageId: uuid(), receivedAt: Date.now() };
          return storeReply().then(function (ok) { return ok ? { ok: true } : { ok: false, message: T('unsaved_p') }; });
        }
        return L().commit(function (next) { return ops().failSend(next, requestId, res.message); }).then(function () {
          DES.app.toast(res.message + T('no_resend'));
          return { ok: false, message: res.message };
        });
      });
    }).then(function (out) {
      if (sending === requestId) sending = null;
      if (payload) { rerender(); TK.keepComposerInView(); checkService(); }
      return out;
    }, function (e) {
      if (sending === requestId) sending = null;
      if (root.console) console.error(e);
      rerender();
      return { ok: false, message: DES.live.text.serviceError(0) };
    });
  };
  TK.send = function () {
    var ta = $('composer');
    if (!ta) return;
    var text = ta.value;
    if (!text.replace(/\s/g, '')) return;
    // 入っている間の入力のしかた（contract-AD §AD-6）: {sup}として話す / アイデアを出す は バディへ送らない（talkLocal）
    var s = stance();
    if (s === 'voice' || s === 'idea') {
      ta.value = '';
      S().draft = { text: '', scroll: (S().draft && S().draft.scroll) || 0 };
      if (s === 'voice' && DES.sup.voice) DES.sup.voice(text);
      else if (s === 'idea' && DES.sup.postIdea) DES.sup.postIdea(text);
      TK.syncSend();
      TK.keepComposerInView();
      return;
    }
    if (!TK.canSend()) return;
    TK.sendText(text, { fromComposer: true });
  };
  // 作るの相談列から（LS-12）: 本文の先頭に「（作る「{title}」で）」の 1 行を付けて同じ経路で送る。画面は移らない
  TK.sendFromMake = function (text, title) {
    var body = String(text == null ? '' : text).replace(/^\s+|\s+$/g, '');
    if (!body) return Promise.resolve({ ok: false, message: T('composer_ph') });
    return TK.sendText('（作る「' + String(title == null ? '' : title) + '」で）\n' + body);
  };
  TK.syncSend = function () {
    var ta = $('composer'), b = $('send-btn');
    if (!ta || !b) return;
    var s = stance(), can = (s === 'voice' || s === 'idea') ? linked() : TK.canSend();
    b.disabled = !can || !ta.value.replace(/\s/g, '');
  };
  TK.keepComposerInView = function () {
    var c = document.querySelector('.composer');
    if (c && c.scrollIntoView) c.scrollIntoView({ block: 'nearest' });
  };
  // バディに相談する（R-8）: 下書きの末尾に改行して「「{title}」をやってみたい」を足す（上書きしない）→ composer へ
  TK.prefill = function (title) { TK.prefillText(DES.fmt(DES.text.prefill_line, { title: title })); };
  // 渡した文をそのまま（包まずに）下書きの末尾に改行して足す → トースト prefilled → #talk の composer へ（L4 / L5 が使う）
  TK.prefillText = function (text) {
    var line = String(text == null ? '' : text).replace(/^\s+|\s+$/g, '');
    if (!line) return;
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
    var ta = $('composer');
    if (!ta) return;
    ta.value = S().draft.text || '';
    TK.syncSend();
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    TK.keepComposerInView();
  };
  // 受信を終了（LS-18 18-7: !sending かつ 読み直した pending の requestId が同じ かつ 60 秒）
  function endPending() {
    var p = liveState().pending, requestId = p && p.requestId;
    if (!requestId || sending || !linked()) return;
    L().commit(function (next) {
      if (!next.pending || next.pending.requestId !== requestId || Date.now() - next.pending.startedAt < 60000) throw new (ops().StateError)('conflict');
      ops().failSend(next, requestId, ops().notices.interrupted);
    }).then(function (r) { DES.app.toast(r.ok ? T('pending_ended') : r.message); rerender(); });
  }
  // 失敗した発言を入力欄に戻す（入力欄に文があれば上書きしない）
  function restoreMessage(id) {
    var m = null;
    liveState().messages.forEach(function (x) { if (x.id === id) m = x; });
    if (!m) return;
    var ta = $('composer');
    if (!ta) return;
    if (ta.value.replace(/\s/g, '')) { DES.app.toast(T('restore_keep')); ta.focus(); return; }
    ta.value = m.content;
    S().draft = { text: ta.value, scroll: (S().draft && S().draft.scroll) || 0 };
    if (!DES.store.save('draft')) DES.app.renderSaveState();
    TK.syncSend();
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }
  // 保存を再確認（届いた返事があればそれを保存、無ければ空の commit）
  function checkStorage() {
    if (!linked()) return;
    if (unsaved) { storeReply().then(function (ok) { if (ok) DES.app.toast(T('unsaved_saved')); }); return; }
    L().commit(function () {}).then(function (r) { DES.app.toast(r.ok ? T('storage_ok') : r.message); rerender(); });
  }

  // ---------- 描画 ----------
  function cardHead() {
    return H('div', { class: 'pc-head' }, [DES.raw(DES.buddy(18, 'think')), DES.plan.srcChip('ai', T('ai_proposal'))]);
  }
  // 提案カード（会話側）。状態は Codex の proposal.status と events・planLocal.held から（DES.plan.cardState）
  function proposalCard(p) {
    var P = DES.plan, cs = P.cardState(p, { events: liveState().events, held: P.held(), today: DES.clock.today() });
    var text = (cs.date ? P.dateText(cs.date) + ' ' : '') + (cs.range ? cs.range + ' ' : '') + p.title;
    var kids = [cardHead(), H('div', { class: 'pc-body' }, [H('span', null, text)])];
    if (cs.orig) kids.push(H('div', { class: 'pc-status' }, T('pc_orig') + cs.orig.range + ' ' + cs.orig.title));
    if (cs.status) kids.push(H('div', { class: 'pc-status' }, T(cs.status.key) + (cs.status.range ? ' ' + cs.status.range : '')));
    var off = !!(linked() && L().issue);
    if (cs.acts.length) kids.push(H('div', { class: 'actions' }, cs.acts.map(function (a) {
      return P.btn(T(a.label), a.action, { id: p.id, kls: a.orange ? 'orange' : null, disabled: off });
    })));
    return H('div', { class: 'proposal-card', 'data-fk': 'card:' + p.id, tabindex: '-1' }, kids);
  }
  // ---------- サポーター（contract-AD §AD-6） ----------
  function supName(by) {
    if (!DES.sup) return '';
    var n = by ? (DES.sup.nameOf ? DES.sup.nameOf(by) : by) : (DES.sup.supName ? DES.sup.supName() : '');
    return n == null ? '' : String(n);
  }
  function recChip(text) { return DES.plan.srcChip('record', text); }
  // アイデアカード（サポーターの bubble の下）。sup.ideas の状態を、行・活動の今の状態に追従して出す（中身は L6 の DES.sup.ideaView）
  function ideaCard(m) {
    var v = DES.sup && DES.sup.ideaView ? DES.sup.ideaView(m.idea) : null;
    if (!v) return null;
    var P = DES.plan, id = v.idea.id, name = supName(m.by), head = [recChip(T('idea_label', { sup: name }))], kids, status = null, acts = [];
    var canPlan = !!(v.idea.catalogId && P.item(v.idea.catalogId));
    function makeBtn() { return P.btn(T('idea_make'), 'idea-make', { id: id, kls: 'orange' }); }
    function planBtn() { return canPlan ? P.btn(T('idea_plan'), 'idea-plan', { id: id }) : null; }
    if (v.state === 'open') acts = [makeBtn(), planBtn(), P.btn(T('idea_later'), 'idea-later', { id: id })];
    else if (v.state === 'later') { status = T('idea_later_st'); acts = [makeBtn(), planBtn()]; }
    else if (v.state === 'made') { status = T('idea_made_st'); acts = [P.btn(T('resume_make'), 'idea-open', { id: id, kls: 'orange' })]; }
    else if (v.state === 'planned') {
      var r = v.row || {};
      if (r.gone === 'removed') { status = T('card_removed'); acts = [planBtn()]; }
      else if (r.gone === 'finished') status = T('finished');
      else if (r.start) status = T('in_plan') + ' ' + P.range(r.start, r.end);
      else status = T('in_plan');
    } else if (v.state === 'withdrawn') status = T('idea_withdrawn', { sup: name });
    if (joined() && DES.sup.canWithdraw && DES.sup.canWithdraw(id)) head.push(H('button', { class: 'link-btn idea-withdraw', type: 'button', 'data-action': 'idea-withdraw', 'data-id': id }, DES.sup.t('withdraw')));
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
    if (m.who === 'buddy') (m.proposals || []).forEach(function (p) { body.appendChild(proposalCard(p)); });
    if (m.who === 'child' && m.by) body.appendChild(recChip(T('by_typed', { sup: supName(m.by) })));
    // 送れなかった発言: 理由の文 + 「内容を入力欄に戻す」（Codex と同じ）
    if (m.who === 'child' && m.delivery === 'failed') {
      body.appendChild(H('p', { class: 'msg-error' }, m.error || (linked() ? ops().notices.interrupted : '')));
      body.appendChild(H('button', { class: 'btn ghost small', type: 'button', 'data-action': 'restore-message', 'data-id': m.id }, T('restore_msg')));
    }
    body.appendChild(H('span', { class: 'msg-time' }, m.time));
    if (m.who === 'buddy') return H('div', { class: 'message buddy', 'data-id': m.id }, [DES.raw(DES.buddy(30, 'neutral')), body]);
    return H('div', { class: 'message user', 'data-id': m.id }, [body]);
  }
  // 返事待ち（pending）: 会話の末尾に考え中のバディ。60 秒たっても届かなければ受信を終了できる
  var staleTimer = null;
  function pendingEl(p) {
    var stale = !sending && Date.now() - p.startedAt >= 60000;
    var body = H('div', { class: 'msg-body' }, [H('div', { class: 'bubble' }, T('pending_wait'))]);
    if (stale) {
      body.appendChild(H('p', { class: 'msg-error' }, T('pending_stale')));
      body.appendChild(H('button', { class: 'btn ghost small', type: 'button', 'data-action': 'end-pending', disabled: !!L().issue }, T('pending_end')));
    }
    clearTimeout(staleTimer); staleTimer = null;
    if (!stale) {
      staleTimer = setTimeout(function () { staleTimer = null; if (DES.app.route() === 'talk') rerender(); }, Math.max(1000, p.startedAt + 60000 - Date.now() + 50));
    }
    return H('div', { class: 'message buddy pending', 'data-id': 'pending' }, [DES.raw(DES.buddy(30, 'think')), body]);
  }
  // 返事は届いたが保存できない（Codex の unsavedResponse）
  function unsavedEl() {
    return H('div', { class: 'notice unsaved', role: 'status' }, [
      H('p', null, T('unsaved_p')),
      H('div', { class: 'bubble' }, unsaved.response.reply),
      H('button', { class: 'btn small', type: 'button', 'data-action': 'save-reply' }, T('unsaved_save'))
    ]);
  }
  // message-list の上の 1 文（つながっていない / 保存の問題 / 会話の上限）
  function renderNotices(box) {
    box.textContent = '';
    if (!linked()) { box.appendChild(H('p', { class: 'notice live-unlinked' }, T('live_unlinked'))); return; }
    var issue = L().issue, st = liveState();
    if (issue) {
      box.appendChild(H('div', { class: 'notice', role: 'alert' }, [
        H('p', null, ops().notices[issue] || ops().notices.locks),
        issue !== 'locks' ? H('button', { class: 'btn ghost small', type: 'button', 'data-action': 'check-storage' }, T('storage_check')) : null
      ]));
    }
    if (st.messages.length > limitOf() - 2) box.appendChild(H('p', { class: 'notice' }, ops().notices.message_limit));
  }
  function renderService() {
    var el = $('service-line');
    if (!el) return;
    el.hidden = !linked();
    var t = el.querySelector('.svc-text'), b = el.querySelector('button');
    if (t) t.textContent = apiText || T('svc_checking');
    if (b) b.disabled = checking;
  }
  function syncService() { renderService(); }

  // 入っている間だけ、textarea の上に 入力のしかた 3 つ（contract-AD §AD-6）。切り替えは aria-pressed と placeholder だけ差し替える（18-9）
  function composerPh() { return joined() && DES.sup.t ? DES.sup.t('ph_' + stance()) : T('composer_ph'); }
  function stanceEl() {
    if (!joined()) return null;
    var cur = stance();
    return H('div', { class: 'segmented stance', role: 'group', 'aria-label': DES.sup.t('stance_label') }, ['proxy', 'voice', 'idea'].map(function (s) {
      return H('button', { type: 'button', class: s === cur ? 'active' : '', 'aria-pressed': s === cur ? 'true' : 'false', 'data-action': 'sup-stance', 'data-arg': s }, DES.sup.t('stance_' + s));
    }));
  }
  TK.syncStance = function () {
    var ta = $('composer');
    if (!ta || !joined()) return;
    var cur = stance();
    ta.placeholder = composerPh();
    Array.prototype.forEach.call(document.querySelectorAll('.segmented.stance button'), function (b) {
      var on = b.getAttribute('data-arg') === cur;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    TK.syncSend();
  };
  // content を作り直すのは route / mode が変わった時だけ（composer の入力とフォーカスを保つ）
  TK.renderPage = function (content, rebuild) {
    var st = S();
    DES.plan.ensureTick();
    ensureService();
    if (rebuild || !$('message-list')) {
      content.textContent = '';
      var draft = (st.draft && st.draft.text) || '';
      var page = H('div', { class: 'chat-page' }, [
        H('div', { class: 'chat-welcome' }, [
          DES.raw(DES.buddy(56, 'happy')), H('h1', null, T('welcome_h')), H('p', null, T('welcome_p')),
          // 接続の状態の行（LS-11）: Codex の文 + 接続を確認
          H('div', { class: 'service-line', id: 'service-line' }, [
            H('span', { class: 'svc-text', role: 'status' }, apiText || T('svc_checking')),
            H('button', { class: 'btn ghost small', type: 'button', 'data-action': 'check-service' }, T('svc_check'))
          ])
        ]),
        H('div', { class: 'live-notices', id: 'live-notices' }),
        H('div', { class: 'message-list', id: 'message-list' }),
        H('div', { class: 'chat-bridge' }, [H('p', null, T('bridge')), H('a', { class: 'btn', href: '#make', 'data-action': 'bridge-make' }, T('make'))]),
        H('div', { class: 'composer' }, [
          stanceEl(),
          H('label', { class: 'sr-only', for: 'composer' }, T('composer_label')),
          H('textarea', { id: 'composer', rows: '3', maxlength: '2000', placeholder: composerPh(), 'data-ui': 'composer', value: draft }),
          H('div', { class: 'composer-bottom' }, [
            H('div', { class: 'composer-tools' }, [
              H('button', { class: 'btn ghost small', type: 'button', 'data-action': 'media' }, [icon('camera'), H('span', null, T('photo'))]),
              H('button', { class: 'btn ghost small', type: 'button', 'data-action': 'media' }, [icon('mic'), H('span', null, T('voice'))])
            ]),
            H('div', { class: 'composer-send' }, [
              H('span', { class: 'hint' }, T('sample_note')),
              H('button', { class: 'btn orange', id: 'send-btn', type: 'button', 'data-action': 'send', disabled: true }, [icon('send'), H('span', null, T('send'))])
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
    renderService();
    renderNotices($('live-notices'));
    // composer: つながっていない = disabled / 保存の問題 = 読み取り専用（LS-11）
    var ta = $('composer');
    if (ta) { ta.disabled = !linked(); ta.readOnly = !!(linked() && L().issue); }
    var list = $('message-list');
    list.textContent = '';
    withDays(TK.messages()).forEach(function (x) {
      if (x.sep) list.appendChild(H('p', { class: 'day-sep' }, DES.plan.dateText(x.sep)));
      else list.appendChild(messageEl(x.msg));
    });
    var pend = liveState().pending;
    if (pend) list.appendChild(pendingEl(pend));
    else { clearTimeout(staleTimer); staleTimer = null; }
    if (unsaved) list.appendChild(unsavedEl());
    TK.syncSend();
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
    var aside2 = $('plan-panel');
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
        var b = $('send-btn');
        if (b && !b.disabled) TK.send();
      }
    });
  };

  var A = DES.actions = DES.actions || {};
  A['send'] = function () { TK.send(); };
  A['media'] = function () { DES.app.toast(T('demo_media')); };
  // bridge（CONTRACT-v3 §U-2）: 直近の本人発言から作るの作業台へ（L2）
  A['bridge-make'] = function () { if (DES.make && DES.make.fromTalk) DES.make.fromTalk(); };
  A['check-service'] = function () { checkService(); };
  A['restore-message'] = function (el) { restoreMessage(el.getAttribute('data-id')); };
  A['end-pending'] = function () { endPending(); };
  A['save-reply'] = function () { storeReply().then(function (ok) { if (ok) DES.app.toast(T('unsaved_saved')); }); };
  A['check-storage'] = function () { checkStorage(); };

  if (typeof module !== 'undefined' && module.exports) module.exports = pure;
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
