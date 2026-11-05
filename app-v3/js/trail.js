/* あしあと（#trail）: CONTRACT-v3 §Z（§I の「#trail は空状態 1 文」を置き換え）。
   上段「前はここまで」= 作業中・止めた活動（最大 3 枚）。時系列「たどる」= 作った / 作品に残した / 話した / 予定の記録 / 見つけた を日ごと・新しい順。
   新しい履歴ストアは作らない（§Z-1）: activities / works / 会話 / plan / odai / makeSide.lastStop を読んで並べ直すだけ。保存するのは des3.trail = { filter } の 1 つ。
   活動・作品・会話・お題の記録はここから消せない。数（件数・連続日数・達成率）・入口を開いただけ・断った回数は出さない。
   純関数（TR.resumeCards / entries / groupByDay / filter / talkTopics / buddyLine / normalize）は DOM と DES.t に触れず、node からも読める（tools/trail-test.js）。
   変更は DES.app.change → DES.store.save → 再描画 の 1 経路（des3.trail を足す）。 */
(function (root) {
  'use strict';
  var DES = root.DES = root.DES || {};
  var M = DES.make && DES.make.stepNext ? DES.make : (typeof require === 'function' ? require('./make.js') : null);
  var TR = DES.trail = DES.trail || {};
  var FILTERS = ['all', 'make', 'talk', 'found', 'plan'];
  // 絞り込み → 出す種類（作った = 作った + 作品に残した）
  var KINDS = { make: ['make', 'work'], talk: ['talk'], found: ['found'], plan: ['plan'] };

  // ---------- 小道具 ----------
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function toMin(hm) { var m = /^(\d{1,2}):(\d{2})$/.exec(String(hm == null ? '' : hm)); return m ? (+m[1]) * 60 + (+m[2]) : -1; }
  function dayKey(d) { var m = /^(\d{1,2})\/(\d{1,2})$/.exec(String(d == null ? '' : d)); return m ? (+m[1]) * 100 + (+m[2]) : -1; }
  function lastChange(a) { return a && Array.isArray(a.changes) && a.changes.length ? a.changes[a.changes.length - 1] : null; }
  // 活動の日（§Z-12 a の任意欄 day。無ければ今日）
  function dayOf(a, today) { return a && dayKey(a.day) >= 0 ? a.day : today; }
  // 「11/2 10:20」形式の時刻（お題の記録）を日と時刻に分ける。日が無ければ今日
  function splitStamp(s, today) {
    var m = /^(\d{1,2}\/\d{1,2})\s+(\d{1,2}:\d{2})$/.exec(String(s == null ? '' : s));
    return m ? { day: m[1], time: m[2] } : { day: today, time: String(s == null ? '' : s) };
  }
  function firstLine(s) { return String(s == null ? '' : s).split('\n')[0]; }
  function fmt(s, vars) { return String(s).replace(/\{(\w+)\}/g, function (all, k) { return vars && vars[k] != null ? String(vars[k]) : all; }); }
  // 記録行のテンプレート（i18n の DES.text。{title} 等は任意の文字）に一致するか。会話の記録行は種類を持たないので、テンプレートで見分ける
  function tplRe(t) { return new RegExp('^' + String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{\w+\\\}/g, '.+') + '$'); }
  // 文言の値（[中, 小] / { text }）が本人の文 s と同じか
  function sameText(x, s) {
    if (!x || !s) return false;
    if (Array.isArray(x)) return x[0] === s || x[1] === s;
    return x.text != null && String(x.text) === s;
  }

  // ---------- 保存する値（§Z-1）: { filter: 'all'|'make'|'talk'|'found'|'plan' }。形が違えば 'all' ----------
  function normalize(raw) { return { filter: isObj(raw) && FILTERS.indexOf(raw.filter) >= 0 ? raw.filter : 'all' }; }

  // ---------- 上段「前はここまで」（§Z-2） ----------
  // working | paused の活動だけ。lastStop が make:<id> の活動を先頭、以降は最後の変化（無ければ baseTime）の新しい順で最大 3 枚
  function card(a) {
    var c = lastChange(a), wanted = typeof a.next === 'string' && a.next ? a.next : null, nx = M.stepNext(a);
    // 次の候補は 本人が書いた「前にしたかったこと」と同じ文なら出さない
    if (nx && wanted && sameText(nx, wanted)) nx = null;
    return {
      id: a.id, title: a.title, origin: a.origin || 'make', catalogId: a.catalogId || null, state: a.state, wanted: wanted,
      stop: c ? { what: clone(c.what), time: c.time, who: c.who || 'own', with: c.with || null } : { what: { k: 'opened_stage' }, time: a.baseTime, who: null, with: null },
      next: nx ? clone(nx) : null
    };
  }
  function resumeCards(acts, lastStop, today) {
    var first = typeof lastStop === 'string' && lastStop.indexOf('make:') === 0 ? lastStop.slice(5) : null;
    var list = (acts || []).filter(function (a) { return a && (a.state === 'working' || a.state === 'paused'); }).map(function (a, i) {
      var c = lastChange(a);
      return { a: a, i: i, day: dayKey(dayOf(a, today)), t: toMin(c ? c.time : a.baseTime) };
    });
    list.sort(function (x, y) {
      var fx = x.a.id === first ? 1 : 0, fy = y.a.id === first ? 1 : 0;
      return (fy - fx) || (y.day - x.day) || (y.t - x.t) || (x.i - y.i);
    });
    return list.slice(0, 3).map(function (x) { return card(x.a); });
  }

  // ---------- 話した（§Z-4）: 本人の発言 1 つ + 直後のバディの返事 で 1 件。記録行（who:'record'）は別件 ----------
  function talkTopics(messages) {
    var ms = messages || [], out = [];
    ms.forEach(function (m, i) {
      if (!m || m.who !== 'child') return;
      var nx = ms[i + 1], reply = nx && nx.who === 'buddy' ? nx : null;
      out.push({ id: 'talk:' + m.id, msgId: m.id, time: m.time, text: String(m.text == null ? '' : m.text),
        reply: reply ? firstLine(reply.text) : null, replyId: reply ? reply.id : null, seq: i });
    });
    return out;
  }

  // ---------- 時系列「たどる」（§Z-4）: day 降順 → time 降順（同じ時刻は新しく足されたものが先）。id は重ならない ----------
  // o: { acts, works, messages, plan, odai, today, finishTpl, hideRec }
  //   finishTpl = 終わった の記録行のテンプレート（DES.text.rec_finish）。終わった行と同じ終わりを書いた記録行は出さず、行の recId にする（1 回だけ出す）
  //   hideRec   = 見送り・外した を書いた記録行のテンプレート（DES.text.rec_decline / rec_remove / rec_skip）。一致する記録行は出さない
  // 出さないもの: 予定の見送り・外した・非表示の行とその記録行 / 入口を開いただけ・とっておいた（odai）/ 背中押し・断った回数 / 変化の無い活動
  function stoppedRec(a) {
    for (var i = (a.thread || []).length - 1; i >= 0; i--) {
      var m = a.thread[i];
      if (m && m.who === 'record' && m.k === 'stopped_rec') return m.text != null ? { text: m.text } : { k: 'stopped_rec' };
    }
    return { k: 'stopped_rec' };
  }
  function entries(o) {
    o = o || {};
    var today = o.today, out = [], seen = {};
    function add(e, ord) {
      if (seen[e.id]) return;
      seen[e.id] = true;
      out.push({ e: e, ord: ord, dk: dayKey(e.day), tm: toMin(e.time) });
    }
    // 予定の記録: 終わった行だけ（見送り・外した・非表示は出さない）
    var fin = {};
    (o.plan || []).forEach(function (r, i) {
      if (!r || r.gone !== 'finished' || r.hidden) return;
      var e = { id: 'plan:' + r.id, kind: 'plan', sub: 'finished', day: today, time: r.start, rowId: r.id, title: r.title, start: r.start, end: r.end,
        catalogId: r.activity || null, recId: null };
      if (o.finishTpl) fin[fmt(o.finishTpl, { title: r.title, start: r.start, end: r.end })] = e;
      add(e, i);
    });
    // 会話: 記録行は「予定の記録」、本人の発言 + 直後の返事は「話した」。
    // 終わった行と同じ終わりの記録行はその行にまとめ、見送り・外した の記録行は出さない
    var hide = (o.hideRec || []).filter(Boolean).map(tplRe), ms = o.messages || [];
    ms.forEach(function (m, i) {
      if (!m || m.who !== 'record') return;
      var text = String(m.text == null ? '' : m.text), f = fin[text];
      if (f) { if (!f.recId) f.recId = m.id; return; }
      if (hide.some(function (re) { return re.test(text); })) return;
      add({ id: 'rec:' + m.id, kind: 'plan', sub: 'record', day: today, time: m.time, msgId: m.id, text: text }, 1000 + i);
    });
    talkTopics(ms).forEach(function (t) {
      add({ id: t.id, kind: 'talk', day: today, time: t.time, msgId: t.msgId, text: t.text, reply: t.reply, replyId: t.replyId }, 1000 + t.seq);
    });
    // 作品に残した（作品の並びは新しいものが先）
    var works = o.works || [];
    works.forEach(function (w, i) {
      if (!w || typeof w.id !== 'string') return;
      add({ id: 'work:' + w.id, kind: 'work', day: dayKey(w.date) >= 0 ? w.date : today, time: w.atTime || w.snapTime || '', workId: w.id, title: w.title,
        status: w.status === 'trial' ? 'trial' : 'done', like: w.like || null, art: clone(w.art || null) }, 2000 + works.length - i);
    });
    // 作った: 活動 × 日で 1 件に畳む（変化は日を持たないので、活動の日 = day 欄か今日）
    var acts = o.acts || [];
    acts.forEach(function (a, i) {
      var c = lastChange(a);
      if (!c) return;
      var e = { id: 'make:' + a.id, kind: 'make', day: dayOf(a, today), time: c.time, actId: a.id, title: a.title, what: clone(c.what),
        who: c.who || 'own', with: c.with || null, more: a.changes.length - 1, state: a.state };
      if (a.state === 'stopped') e.stopRec = stoppedRec(a);
      add(e, 3000 + acts.length - i);
    });
    // 見つけた: お題の記録 found[]
    var tried = o.odai && isObj(o.odai.tried) ? o.odai.tried : {};
    Object.keys(tried).forEach(function (oid) {
      var f = tried[oid] && tried[oid].found;
      (Array.isArray(f) ? f : []).forEach(function (x, j) {
        if (!isObj(x)) return;
        var p = splitStamp(x.time, today);
        add({ id: 'found:' + oid + ':' + j, kind: 'found', day: p.day, time: p.time, odaiId: oid, photo: x.photo, line: x.line ? String(x.line) : null }, 4000 + j);
      });
    });
    out.sort(function (x, y) { return (y.dk - x.dk) || (y.tm - x.tm) || (y.ord - x.ord); });
    return out.map(function (x) { return x.e; });
  }
  // 日ごとにまとめる（並びはそのまま）。today の日は isToday
  function groupByDay(list, today) {
    var out = [], cur = null;
    (list || []).forEach(function (e) {
      if (!cur || cur.day !== e.day) { cur = { day: e.day, isToday: e.day === today, items: [] }; out.push(cur); }
      cur.items.push(e);
    });
    return out;
  }
  function filter(list, f) {
    var k = KINDS[f];
    return k ? (list || []).filter(function (e) { return k.indexOf(e.kind) >= 0; }) : (list || []).slice();
  }
  // 先頭の 1 文（§Z-3 / Z-8）: 上段の先頭カードがあれば resume_push（{step} = 前にしたかったこと か 次の候補。どちらも無ければ出さない）。
  // 上段が無ければ 中立の 1 文。上段も時系列も無ければ 空状態の 1 文
  function buddyLine(cards, hasEntries) {
    var c = cards && cards[0];
    if (!c) return hasEntries === false ? { kind: 'empty' } : { kind: 'neutral' };
    var step = c.wanted ? { text: c.wanted } : (c.next ? clone(c.next) : null);
    return step ? { kind: 'resume', step: step, actId: c.id } : null;
  }

  var pure = {
    normalize: normalize, resumeCards: resumeCards, talkTopics: talkTopics, entries: entries, groupByDay: groupByDay, filter: filter,
    buddyLine: buddyLine, FILTERS: FILTERS
  };
  Object.keys(pure).forEach(function (k) { TR[k] = pure[k]; });
  if (typeof module !== 'undefined' && module.exports) module.exports = pure;
  if (typeof document === 'undefined') return;

  // ======================================================================
  // ここから下はブラウザ専用
  // ======================================================================
  var MD = DES.makeData, TDD = DES.todayData;

  // ---------- 保存（§Z-1）: 既存の DES.store に des3.trail を足す（make.js / today.js と同じ包み方） ----------
  if (DES.store && !DES.store._trail) {
    var load2 = DES.store.load, save2 = DES.store.save;
    DES.store._trail = true;
    DES.store.load = function () {
      var s = load2.apply(DES.store, arguments), raw = null;
      try {
        var t = window.localStorage.getItem('des3.trail');
        if (t != null) raw = JSON.parse(t);
      } catch (e) { s.saveFailed = true; }
      s.trail = normalize(raw);
      return s;
    };
    DES.store.save = function (only) {
      var ok = save2.call(DES.store, only);
      if (!only && !save2.call(DES.store, 'trail')) ok = false;
      return ok;
    };
  }

  function S() { return DES.state; }
  function T(k, v) { return DES.t(k, v); }
  function H() { return DES.h.apply(null, arguments); }
  function icon(n) { return DES.raw(DES.icon(n)); }
  function mode() { return DES.mode(); }
  function pick(pair) { return MD.pick(pair, mode()); }
  function esc(v) { return window.CSS && CSS.escape ? CSS.escape(v) : String(v).replace(/"/g, '\\"'); }
  function ui() {
    var u = DES.ui;
    if (!u.tr) u.tr = { shown: false, pendingFocus: null };
    return u.tr;
  }
  function todayStr() { var p = DES.data.today.split('-'); return (+p[1]) + '/' + (+p[2]); }
  function actOf(id) { var hit = null; (S().activities || []).forEach(function (a) { if (!hit && a.id === id) hit = a; }); return hit; }
  function go(hash) { if (window.location.hash !== hash) window.location.hash = hash; else DES.app.render(); }
  function chip(kind, text, label) {
    var ic = { own: 'quote', ai: 'spark', record: 'record' }[kind];
    return H('span', { class: 'chip src-' + kind, role: 'img', 'aria-label': label || text }, [icon(ic), H('span', null, text)]);
  }
  function ownChip() { return chip('own', T('who_own'), T('own_label') + ' ' + T('who_own')); }
  function aiChip() { return chip('ai', T('who_ai'), T('ai_proposal') + ' ' + T('who_ai')); }
  function recChip(text) { return chip('record', text || T('record_label'), T('record_label') + (text ? ' ' + text : '')); }
  // 誰が（本人 / バディ / いっしょにした人の名前）
  function whoChips(who, withName) {
    var out = [];
    if (who === 'ai') out.push(aiChip());
    else if (who) out.push(ownChip());
    if (withName) out.push(recChip(withName));
    return out;
  }
  function btn(label, action, o) {
    o = o || {};
    var at = { class: 'btn small' + (o.kls ? ' ' + o.kls : ''), type: 'button', 'data-action': action };
    if (o.id) at['data-id'] = o.id;
    if (o.arg != null) at['data-arg'] = o.arg;
    if (o.attrs) Object.keys(o.attrs).forEach(function (k) { at[k] = o.attrs[k]; });
    var kids = [];
    if (o.icon) kids.push(icon(o.icon));
    kids.push(H('span', null, label));
    return H('button', at, kids);
  }
  // 予定に入れる（§Z-6）: 取り組み（catalogId）がある時だけ
  function planBtn(catalogId, arg, title) {
    if (!catalogId || !DES.plan.item(catalogId)) return null;
    return btn(T('add_to_plan'), 'tr-plan', { id: catalogId, arg: arg, icon: 'calendar', attrs: { 'aria-label': T('add_to_plan') + ': ' + title } });
  }

  // ---------- 先頭の 1 文（§Z-3 / Z-8） ----------
  function buddyEl(b) {
    if (!b) return null;
    if (b.kind === 'resume') {
      // make.js の「前はここまで」と同じく {step} を「…ところ」で入れる
      var step = M.tx({ k: 'tokoro', v: { what: b.step } });
      return H('div', { class: 'tr-buddy' }, [DES.raw(DES.buddy(30)), H('p', null, [aiChip(), H('span', null, T('resume_push', { step: step }))])]);
    }
    if (b.kind === 'neutral') return H('p', { class: 'tr-intro' }, T('tr_intro'));
    return H('p', { class: 'empty-line tr-empty' }, T('tr_empty'));
  }

  // ---------- 上段（§Z-2） ----------
  function lineEl(key, kids) { return H('div', { class: 'trc-line' }, [H('dt', null, T(key)), H('dd', null, kids)]); }
  function cardEl(c) {
    var lines = [];
    if (c.wanted) lines.push(lineEl('tr_wanted', [ownChip(), H('span', { class: 'trc-own' }, c.wanted)]));
    lines.push(lineEl('tr_stop', [H('span', null, M.tx(c.stop.what)), c.stop.time ? H('span', { class: 'tr-at' }, c.stop.time) : null].concat(whoChips(c.stop.who, c.stop.with))));
    if (c.next) lines.push(lineEl('tr_next', [aiChip(), H('span', null, M.tx(c.next))]));
    var ops = [btn(T('resume'), 'tr-resume', { id: c.id, arg: 'card', kls: 'orange', attrs: { 'aria-label': T('resume') + ': ' + c.title } })];
    var pb = planBtn(c.catalogId, 'card:' + c.id, c.title);
    if (pb) ops.push(pb);
    return H('article', { class: 'tr-rcard', 'data-fk': 'tr:card:' + c.id, 'aria-labelledby': 'tr-rc-' + c.id }, [
      H('div', { class: 'trc-head' }, [H('h3', { id: 'tr-rc-' + c.id }, c.title), H('span', { class: 'pill origin-chip' }, T('origin_' + c.origin))]),
      H('dl', { class: 'trc-lines' }, lines),
      H('div', { class: 'trc-ops' }, ops)
    ]);
  }
  function resumeEl(cards) {
    return H('section', { class: 'tr-resume', 'aria-labelledby': 'tr-resume-h' }, [
      H('div', { class: 'section-head' }, [H('h2', { id: 'tr-resume-h' }, T('tr_resume_h'))]),
      H('div', { class: 'tr-cards' }, cards.map(cardEl))
    ]);
  }

  // ---------- 時系列（§Z-4） ----------
  var KIND_ICON = { make: 'make', work: 'works', talk: 'talk', plan: 'calendar', found: 'today' };
  function kindMark(e) {
    var ic = e.kind === 'plan' && e.sub === 'record' ? 'record' : KIND_ICON[e.kind];
    return H('span', { class: 'tr-kind', role: 'img', 'aria-label': T('tr_k_' + e.kind) }, [icon(ic)]);
  }
  function thumb(art) {
    var svg = art && art.photo ? MD.photoArt(art.photo) : (art && art.stage ? MD.art(art.stage) : '');
    return H('span', { class: 'tr-thumb' + (svg ? '' : ' is-empty') }, svg ? [DES.raw(svg)] : null);
  }
  function makeBody(e) {
    var kids = [
      H('div', { class: 'tr-line1' }, [kindMark(e), H('strong', { class: 'tr-title' }, e.title)]),
      H('p', { class: 'tr-text' }, [H('span', null, M.tx(e.what))].concat(whoChips(e.who, e.with)))
    ];
    if (e.state === 'closed') kids.push(H('p', { class: 'tr-note' }, T('closed')));
    if (e.state === 'stopped') kids.push(H('p', { class: 'tr-note' }, [recChip(), H('span', null, M.tx(e.stopRec))]));
    var ops = [btn(T('resume'), 'tr-resume', { id: e.actId, arg: 'row', attrs: { 'aria-label': T('resume') + ': ' + e.title } })];
    if (e.state === 'closed' || e.state === 'stopped') ops.push(btn(T('tr_retry'), 'tr-retry', { id: e.actId, attrs: { 'aria-label': T('tr_retry') + ': ' + e.title } }));
    // 変化が 2 つ以上なら「ほか {n} 件の変化」（作業台で全部見られる）
    if (e.more >= 1) ops.push(H('a', { class: 'link-btn tr-more', href: '#make/' + e.actId }, T('tr_more', { n: e.more })));
    kids.push(H('div', { class: 'tr-ops' }, ops));
    return H('div', { class: 'tr-body' }, kids);
  }
  // 作品に残した: カード全体が詳細へのリンク
  function workBody(e) {
    var st = e.status === 'trial' ? 'trial' : 'done', label = T(st === 'trial' ? 'chip_trial' : 'chip_done');
    var info = [H('span', { class: 'tr-line1' }, [kindMark(e), H('strong', { class: 'tr-title' }, e.title),
      H('span', { class: 'chip k-w' + st, role: 'img', 'aria-label': T('status_h') + ' ' + label }, label)])];
    if (e.like) info.push(H('span', { class: 'tr-text' }, [ownChip(), H('span', null, e.like)]));
    return H('a', { class: 'tr-body tr-work', href: '#works/' + e.workId, 'data-fk': 'tr-link:' + e.id }, [thumb(e.art), H('span', { class: 'tr-side' }, info)]);
  }
  function talkBody(e) {
    var kids = [H('p', { class: 'tr-say' }, [kindMark(e), ownChip(), H('span', { class: 'tr-own' }, e.text)])];
    if (e.reply) kids.push(H('p', { class: 'tr-reply' }, [aiChip(), H('span', null, e.reply)]));
    kids.push(H('div', { class: 'tr-ops' }, [btn(T('tr_see_talk'), 'tr-talk', { arg: e.msgId, icon: 'chat' })]));
    return H('div', { class: 'tr-body' }, kids);
  }
  // 記録行の操作は 1 つ: 話すで見る（会話のその記録行へ）
  function seeTalkBtn(msgId) { return btn(T('tr_see_talk'), 'tr-talk', { arg: msgId, icon: 'chat' }); }
  function planBody(e) {
    if (e.sub === 'record') {
      return H('div', { class: 'tr-body' }, [H('p', { class: 'tr-text' }, [kindMark(e), recChip(), H('span', null, e.text)]), H('div', { class: 'tr-ops' }, [seeTalkBtn(e.msgId)])]);
    }
    var kids = [H('div', { class: 'tr-line1' }, [kindMark(e), recChip(),
      H('strong', { class: 'tr-title' }, e.title + ' ' + DES.plan.range(e.start, e.end)), H('span', { class: 'tr-done' }, T('finished'))])];
    // 終わった行の操作も 1 つ: 予定に入れる（取り組みがある時）→ 無ければ まとめた記録行を話すで見る → それも無ければ 今日の予定
    var op = planBtn(e.catalogId, 'row:' + e.rowId, e.title) || (e.recId ? seeTalkBtn(e.recId) : H('a', { class: 'btn small', href: '#plan' }, [icon('calendar'), H('span', null, T('plan'))]));
    kids.push(H('div', { class: 'tr-ops' }, [op]));
    return H('div', { class: 'tr-body' }, kids);
  }
  function foundBody(e) {
    var o = TDD.get(e.odaiId), p = TDD.photo(o, e.photo);
    return H('div', { class: 'tr-body tr-found' }, [
      H('span', { class: 'tr-thumb' }, [DES.raw(TDD.photoArt(o, e.photo))]),
      H('div', { class: 'tr-side' }, [
        H('p', { class: 'tr-text' }, [kindMark(e), e.line ? ownChip() : null, H('span', { class: e.line ? 'tr-own' : null }, e.line || pick(p.label))]),
        H('p', { class: 'tr-q' }, pick(o.title)),
        H('div', { class: 'tr-ops' }, [H('a', { class: 'btn small', href: '#today/' + o.id, 'aria-label': T('tr_see_odai') + ': ' + pick(o.title) }, [icon('today'), H('span', null, T('tr_see_odai'))])])
      ])
    ]);
  }
  var BODY = { make: makeBody, work: workBody, talk: talkBody, plan: planBody, found: foundBody };
  function itemEl(e) {
    return H('li', { class: 'tr-item is-' + e.kind, 'data-fk': 'tr:' + e.id, tabindex: '-1' }, [
      H('span', { class: 'tr-time' }, e.time || ''),
      H('span', { class: 'tr-rail', 'aria-hidden': 'true' }, [H('span', { class: 'tr-dot' })]),
      BODY[e.kind](e)
    ]);
  }
  function filtersEl(f) {
    return H('div', { class: 'tr-filters', role: 'group', 'aria-label': T('tr_filter_label') }, FILTERS.map(function (k) {
      var on = k === f;
      return H('button', { class: 'tr-filter' + (on ? ' on' : ''), type: 'button', 'data-action': 'tr-filter', 'data-arg': k, 'aria-pressed': on ? 'true' : 'false' }, T('tr_f_' + k));
    }));
  }
  function flowEl(list, f, today) {
    var shown = filter(list, f);
    var kids = [H('div', { class: 'section-head' }, [H('h2', { id: 'tr-flow-h' }, T('tr_flow_h'))]), filtersEl(f)];
    if (!shown.length) kids.push(H('p', { class: 'empty-line tr-none' }, T('tr_filter_empty', { filter: T('tr_f_' + f) })));
    else {
      kids.push(H('ol', { class: 'tr-days' }, groupByDay(shown, today).map(function (g) {
        return H('li', { class: 'tr-day' }, [H('h3', { class: 'tr-day-h' }, g.isToday ? T('tr_today') : g.day), H('ol', { class: 'tr-list' }, g.items.map(itemEl))]);
      })));
    }
    return H('section', { class: 'tr-flow', 'aria-labelledby': 'tr-flow-h' }, kids);
  }

  // 見送り・外した を書いた記録行（plan.js の 提案を断る / 外す / 運動を見送る）
  var HIDE_REC = ['rec_decline', 'rec_remove', 'rec_skip'];
  function view() {
    var st = S(), today = todayStr();
    var cards = resumeCards(st.activities, st.makeSide && st.makeSide.lastStop, today);
    var list = entries({ acts: st.activities, works: st.works, messages: DES.talk.messages(), plan: st.plan, odai: st.odai, today: today,
      finishTpl: DES.text.rec_finish, hideRec: HIDE_REC.map(function (k) { return DES.text[k]; }) });
    // お題の定義が無い「見つけた」は出さない（today.js の normalize と同じ扱い）
    list = list.filter(function (e) { if (e.kind !== 'found') return true; var o = TDD && TDD.get(e.odaiId); return !!(o && TDD.photo(o, e.photo)); });
    return { today: today, cards: cards, list: list };
  }
  TR.render = function (main) {
    var u = ui(), d = view(), f = (S().trail && S().trail.filter) || 'all';
    main.textContent = '';
    var kids = [H('div', { class: 'page-head' }, [H('div', null, [H('h1', { tabindex: '-1', 'data-fk': 'trail-h' }, T('trail')), H('p', null, T('tr_sub'))])])];
    var be = buddyEl(buddyLine(d.cards, d.list.length > 0));
    if (be) kids.push(be);
    if (d.cards.length) kids.push(resumeEl(d.cards));
    if (d.list.length) kids.push(flowEl(d.list, FILTERS.indexOf(f) >= 0 ? f : 'all', d.today));
    main.appendChild(H('div', { class: 'trail-page' }, kids));
    // 開いたら h1（§Z-10）。「戻す」で戻った時は元の行へ（ルート移動の scrollTo(0,0) の後に見える位置へ）
    var n = u.pendingFocus ? main.querySelector(u.pendingFocus) : null;
    u.pendingFocus = null;
    if (n) {
      n.focus({ preventScroll: true });
      setTimeout(function () { if (n.isConnected && document.activeElement === n && n.scrollIntoView) n.scrollIntoView({ block: 'center' }); }, 0);
    } else if (!u.shown) { var h = main.querySelector('h1'); if (h) h.focus(); }
    u.shown = true;
  };
  // ルートが変わったら（app.js の closeTransient から）。pendingFocus は戻った先で使うので残す
  TR.resetUi = function () { ui().shown = false; };

  // ---------- 操作 ----------
  var A = DES.actions = DES.actions || {};
  // 続きをする（§Z-5）: 既存の作業台を開く経路（止めた・一区切り・やめた → 作業中。変化は積まない）
  A['tr-resume'] = function (el) { var id = el.getAttribute('data-id'); if (actOf(id)) DES.make.openAct(id); };
  // もう一度試す（§Z-5）: 同じ始まりから新しい活動（元の活動は変えない）→ 作業台。トーストの「戻す」で新しい活動を外して元の行へ
  A['tr-retry'] = function (el) {
    var a = actOf(el.getAttribute('data-id'));
    if (!a) return;
    var m = mode(), od = a.odaiId && TDD ? TDD.get(a.odaiId) : null;
    var n = M.fromTrail(a, { id: DES.plan.newId('a'), now: DES.data.now, mode: m, works: S().works, odai: od,
      recText: od ? T('odai_rec', { q: MD.pick(od.title, m), step: MD.pick(od.firstStep, m), need: MD.pick(od.need, m) }) : null });
    if (!n) return;
    var origId = a.id, prevStop = S().makeSide ? S().makeSide.lastStop : null;
    DES.app.change(function () {
      if (S().makeSide && n.shelf.some(function (c) { return c.state === 'new'; })) S().makeSide.shelfFolded = false;
      S().activities = [n].concat(S().activities);
    });
    go('#make/' + n.id);
    DES.app.toast(T('tr_retry_toast', { title: n.title }), { label: T('undo'), fn: function () {
      var st = S();
      st.activities = st.activities.filter(function (x) { return x.id !== n.id; });
      if (st.makeSide && st.makeSide.lastStop === 'make:' + n.id) st.makeSide.lastStop = prevStop;
      var saved = DES.store.save('activities');
      if (st.makeSide && !DES.store.save('makeSide')) saved = false;
      if (!saved) st.saveFailed = true;
      ui().pendingFocus = '[data-action="tr-retry"][data-id="' + esc(origId) + '"]';
      go('#trail');
    } });
  };
  // 予定に入れる（§Z-6）: plan.js の取り組みを予定に入れる経路と同じ（空きの選び方・mine 行・記録行・トースト）+ 戻す
  A['tr-plan'] = function (el) {
    var cat = el.getAttribute('data-id'), arg = el.getAttribute('data-arg');
    if (!DES.plan.item(cat)) return;
    DES.plan.act.addFirst(cat, { undo: true, after: { sel: '[data-action="tr-plan"][data-id="' + esc(cat) + '"][data-arg="' + esc(arg) + '"]' } });
  };
  // 絞り込み（§Z-7）: 即時に描き直し・des3.trail に保存
  A['tr-filter'] = function (el) {
    var f = el.getAttribute('data-arg');
    if (FILTERS.indexOf(f) < 0 || (S().trail && S().trail.filter === f)) return;
    // 保存するのは des3.trail だけ（§Z-1。DES.app.change の全キー保存を通さず、他のストアを書き直さない）
    S().trail = { filter: f };
    if (!DES.store.save('trail')) S().saveFailed = true;
    DES.app.render();
    var n = document.querySelector('[data-action="tr-filter"][data-arg="' + esc(f) + '"]');
    if (n) n.focus();
  };
  // 話すで見る（§Z-4）: #talk へ移り、その発言へ（talk.js の renderPage が DES.ui.focusMsg を 1 回だけ使う）
  A['tr-talk'] = function (el) {
    DES.ui.focusMsg = el.getAttribute('data-arg');
    go('#talk');
  };
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
