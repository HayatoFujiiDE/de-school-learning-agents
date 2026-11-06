/* サポーターの画面と「一緒に入る」の純関数（docs/plans/supporter-view/contract-AD.md §AD-14 / 18-2 / 18-12 / 18-13）。
   DOM・DES.t・localStorage に触れない（node から module.exports で読める。tools/sup-test.js）。
   observe だけは state の中の印（m.by / r.by / a.by / w.by / c.day / sup.helped）を直接書く（18-2）。他は引数を書き換えない。 */
(function (root) {
  'use strict';
  var DES = root.DES = root.DES || {};
  var C = DES.supCore = DES.supCore || {};

  var LOG_MAX = 500;
  var SCENES = ['plan', 'talk', 'make', 'works', 'today', 'join', 'advice', 'note', 'report'];
  var HOWS = ['proxy', 'hands', 'voice', 'idea', 'in', 'out', 'desk'];
  var STANCES = ['proxy', 'voice', 'idea'];
  var IDEA_ST = ['open', 'made', 'planned', 'later', 'withdrawn'];
  var AD_ST = ['new', 'waiting', 'adjusted', 'tried', 'pending', 'withdrawn'];
  var AXES = ['int', 'ori', 'exp', 'psy', 'mas'];
  var RP_ST = ['draft', 'checked', 'sent'];
  var FILTERS = ['all', 'plan', 'talk', 'make', 'other'];
  var REF_KEYS = ['msg', 'row', 'act', 'work', 'odai', 'idea', 'advice'];
  // 保存のキー → 写しの部分（18-2）。ここに無いキーは何もしない
  var PART = { talk: 'talk', plan: 'rows', activities: 'acts', works: 'works', odai: 'found' };
  var PARTS = ['talk', 'rows', 'acts', 'works', 'found'];

  // ---------- 小道具 ----------
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function isStr(v) { return typeof v === 'string'; }
  function strOrNull(v) { return isStr(v) ? v : null; }
  function fmt(s, vars) { return String(s == null ? '' : s).replace(/\{(\w+)\}/g, function (all, k) { return vars && vars[k] != null ? String(vars[k]) : all; }); }
  function merge(a, b) { var o = {}, k; for (k in a || {}) o[k] = a[k]; for (k in b || {}) o[k] = b[k]; return o; }
  function toMin(hm) { var m = /^(\d{1,2}):(\d{2})$/.exec(String(hm == null ? '' : hm)); return m ? (+m[1]) * 60 + (+m[2]) : -1; }
  function findId(list, id) { for (var i = 0; i < (list || []).length; i++) if (list[i] && list[i].id === id) return list[i]; return null; }
  function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  // ---------- 保存する値（AD-2 / 18-13）: 形が違う欄はその欄だけ初期値・知らない欄は捨てる ----------
  function emptyReport() { return { edits: {}, off: {}, extra: '', state: 'draft', sentAt: null, body: null }; }
  function defaults() {
    return { v: 1, join: null, log: [], ideas: [], advice: [], notes: [], report: emptyReport(), logFilter: 'all', helped: { odai: {} } };
  }
  function normRef(r) {
    var out = {};
    if (!isObj(r)) return out;
    REF_KEYS.forEach(function (k) { if (isStr(r[k])) out[k] = r[k]; });
    return out;
  }
  function normLog(e) {
    if (!isObj(e) || !isStr(e.id) || !isStr(e.day) || !isStr(e.time) || SCENES.indexOf(e.scene) < 0 || HOWS.indexOf(e.how) < 0 || !isStr(e.text)) return null;
    return { id: e.id, day: e.day, time: e.time, scene: e.scene, how: e.how, text: e.text, ref: normRef(e.ref) };
  }
  function normIdea(x) {
    if (!isObj(x) || !isStr(x.id) || !isStr(x.text) || IDEA_ST.indexOf(x.state) < 0) return null;
    var o = { id: x.id, msgId: strOrNull(x.msgId), text: x.text, catalogId: strOrNull(x.catalogId), state: x.state, day: isStr(x.day) ? x.day : '', time: isStr(x.time) ? x.time : '' };
    if (isStr(x.actId)) o.actId = x.actId;
    if (isStr(x.rowId)) o.rowId = x.rowId;
    return o;
  }
  // 助言（AD-8）: このブラウザで足した・直したもの。stages の 4 段は 文 か null。prev = 取り下げる前の状態（「戻す」で使う）
  function normAdvice(x) {
    if (!isObj(x) || !isStr(x.id) || !isStr(x.aim) || AD_ST.indexOf(x.state) < 0) return null;
    var st = isObj(x.stages) ? x.stages : {};
    return {
      id: x.id, day: isStr(x.day) ? x.day : '', time: isStr(x.time) ? x.time : '', mine: x.mine !== false, added: x.added === true,
      state: x.state, prev: AD_ST.indexOf(x.prev) >= 0 && x.prev !== 'withdrawn' ? x.prev : null, scene: isStr(x.scene) ? x.scene : 'none', aim: x.aim, basis: strOrNull(x.basis),
      stages: { view: strOrNull(st.view), trial: strOrNull(st.trial), result: strOrNull(st.result), update: strOrNull(st.update) }
    };
  }
  function normNote(x) {
    if (!isObj(x) || !isStr(x.id) || AXES.indexOf(x.axis) < 0 || !isStr(x.text)) return null;
    return { id: x.id, axis: x.axis, text: x.text, day: isStr(x.day) ? x.day : '', time: isStr(x.time) ? x.time : '' };
  }
  function normJoin(j) {
    if (!isObj(j) || !isStr(j.child) || !j.child) return null;
    return { child: j.child, stance: STANCES.indexOf(j.stance) >= 0 ? j.stance : 'proxy', since: isStr(j.since) ? j.since : '' };
  }
  function normReport(r) {
    var d = emptyReport();
    if (!isObj(r)) return d;
    if (isObj(r.edits)) Object.keys(r.edits).forEach(function (k) { if (isStr(r.edits[k])) d.edits[k] = r.edits[k]; });
    if (isObj(r.off)) Object.keys(r.off).forEach(function (k) { if (r.off[k] === true) d.off[k] = true; });
    if (isStr(r.extra)) d.extra = r.extra;
    if (RP_ST.indexOf(r.state) >= 0) d.state = r.state;
    d.sentAt = strOrNull(r.sentAt);
    d.body = normBody(r.body);
    // 確かめた・送った なのに写しが無い（壊れた保存）→ 下書きに戻す
    if (d.state !== 'draft' && !d.body) { d.state = 'draft'; d.sentAt = null; }
    return d;
  }
  // 写し（18-13）: [ { id, head, items: [ { id, text, orig?, src, edited, off } ], note? } …, { id: 'extra', text } ]。形が違えば null
  function normBody(b) {
    if (!Array.isArray(b)) return null;
    var out = [], bad = false;
    b.forEach(function (s) {
      if (bad) return;
      if (!isObj(s) || !isStr(s.id)) { bad = true; return; }
      if (s.id === 'extra' && !Array.isArray(s.items)) { if (isStr(s.text)) out.push({ id: 'extra', text: s.text }); else bad = true; return; }
      if (!isStr(s.head) || !Array.isArray(s.items)) { bad = true; return; }
      var items = [];
      s.items.forEach(function (it) {
        if (!isObj(it) || !isStr(it.id) || !isStr(it.text) || !isStr(it.src)) { bad = true; return; }
        var o = { id: it.id, text: it.text };
        if (isStr(it.orig)) o.orig = it.orig;
        o.src = it.src;
        o.edited = it.edited === true;
        o.off = it.off === true;
        items.push(o);
      });
      var sec = { id: s.id, head: s.head, items: items };
      if (isStr(s.note)) sec.note = s.note;
      out.push(sec);
    });
    return bad || !out.length ? null : out;
  }
  function normHelped(h) {
    var out = { odai: {} };
    if (!isObj(h) || !isObj(h.odai)) return out;
    Object.keys(h.odai).forEach(function (k) { if (h.odai[k] === true) out.odai[k] = true; });
    return out;
  }
  function list(v, fn) { return Array.isArray(v) ? v.map(fn).filter(Boolean) : []; }
  function normalize(raw) {
    var d = defaults();
    if (!isObj(raw)) return d;
    d.join = normJoin(raw.join);
    d.log = capLog(list(raw.log, normLog));
    d.ideas = list(raw.ideas, normIdea);
    d.advice = list(raw.advice, normAdvice);
    d.notes = list(raw.notes, normNote);
    d.report = normReport(raw.report);
    d.logFilter = FILTERS.indexOf(raw.logFilter) >= 0 ? raw.logFilter : 'all';
    d.helped = normHelped(raw.helped);
    return d;
  }
  // 記録は追加のみ。上限を超えたら古い方（配列の先頭）から落とす
  function capLog(log) { return log.length > LOG_MAX ? log.slice(log.length - LOG_MAX) : log; }
  function appendLog(log, add) { return capLog((log || []).concat(add || [])); }

  // ---------- 写し（AD-3） ----------
  function snap(state) {
    var s = state || {}, out = { talk: {}, rows: {}, acts: {}, works: {}, found: {} };
    (s.talk || []).forEach(function (m) { if (m && isStr(m.id)) out.talk[m.id] = m.who; });
    (s.plan || []).forEach(function (r) { if (r && isStr(r.id)) out.rows[r.id] = { kind: r.kind, gone: r.gone || null, hidden: !!r.hidden }; });
    (s.activities || []).forEach(function (a) {
      if (!a || !isStr(a.id)) return;
      out.acts[a.id] = {
        changes: (a.changes || []).map(function (c) { return c && c.id; }).filter(isStr),
        says: (a.thread || []).filter(function (m) { return m && m.who === 'child'; }).map(function (m) { return m.id; }).filter(isStr)
      };
    });
    (s.works || []).forEach(function (w) { if (w && isStr(w.id)) out.works[w.id] = Array.isArray(w.shares) ? w.shares.length : 0; });
    var tried = s.odai && isObj(s.odai.tried) ? s.odai.tried : {};
    Object.keys(tried).forEach(function (k) { var f = tried[k] && tried[k].found; out.found[k] = Array.isArray(f) ? f.length : 0; });
    return out;
  }

  // ---------- 差分（AD-3 の表 / 18-12）: 増えたものだけ。消えたものは出来事にしない ----------
  // 順序: 会話 → 行 → 活動（act+ → chg+ → say+）→ 作品 → 見つけた。同じ種類は写しの並び（= 元の配列の順）
  function diff(prev, cur) {
    var p = prev || {}, c = cur || {}, out = [];
    var pt = p.talk || {}, pr = p.rows || {}, pa = p.acts || {}, pw = p.works || {}, pf = p.found || {};
    Object.keys(c.talk || {}).forEach(function (id) { if (!hasOwn(pt, id)) out.push({ t: 'msg+', id: id }); });
    Object.keys(c.rows || {}).forEach(function (id) {
      var r = c.rows[id], o = pr[id];
      if (!o) { if (r.kind === 'mine' || r.kind === 'held') out.push({ t: 'row+', id: id }); return; }
      if ((o.kind === 'proposed' || o.kind === 'held') && r.kind === 'mine') out.push({ t: 'rowMine', id: id });
      if (!!o.hidden !== !!r.hidden) out.push({ t: 'rowHidden', id: id, hidden: !!r.hidden });
    });
    var acts = Object.keys(c.acts || {}), chg = [], say = [];
    acts.forEach(function (id) {
      var a = c.acts[id], o = pa[id];
      if (!o) out.push({ t: 'act+', id: id });
      var oc = o ? o.changes : [], os = o ? o.says : [];
      a.changes.forEach(function (x) { if (oc.indexOf(x) < 0) chg.push({ t: 'chg+', id: x, act: id }); });
      a.says.forEach(function (x) { if (os.indexOf(x) < 0) say.push({ t: 'say+', id: x, act: id }); });
    });
    out = out.concat(chg, say);
    Object.keys(c.works || {}).forEach(function (id) {
      if (!hasOwn(pw, id)) out.push({ t: 'work+', id: id });
      else if (c.works[id] > pw[id]) out.push({ t: 'share+', id: id });
    });
    Object.keys(c.found || {}).forEach(function (k) { if (c.found[k] > (pf[k] || 0)) out.push({ t: 'found+', id: k, odai: k }); });
    return out;
  }

  // ---------- 観察（18-2）: 成功した保存のあとに呼ぶ。key = 保存したキー（null = 全部） ----------
  // ctx: { joined, supId, supName, child, today, now, text, tx, newId }
  // 戻り値: { snap, log: [足す記録], touched: [印を付けたキー] }。写しは key に属する部分だけ更新する
  function observe(state, prevSnap, key, ctx) {
    ctx = ctx || {};
    var full = snap(state);
    if (!prevSnap) return { snap: full, log: [], touched: [] };
    var parts = key == null ? PARTS : (PART[key] ? [PART[key]] : []);
    if (!parts.length) return { snap: prevSnap, log: [], touched: [] };
    var prev = {}, cur = {}, next = {};
    PARTS.forEach(function (k) {
      var on = parts.indexOf(k) >= 0;
      prev[k] = on ? (prevSnap[k] || {}) : {};
      cur[k] = on ? full[k] : {};
      next[k] = on ? full[k] : (prevSnap[k] || {});
    });
    var evs = diff(prev, cur), log = [], touched = {}, tx = ctx.text || {};
    var names = { sup: ctx.supName, child: ctx.child };
    function line(k, v) { return fmt(tx[k], merge(names, v)); }
    function add(scene, how, text, ref) {
      log.push({ id: ctx.newId ? ctx.newId('l') : 'l' + (log.length + 1), day: ctx.today, time: ctx.now, scene: scene, how: how, text: String(text == null ? '' : text), ref: ref || {} });
    }
    function what(c) { return ctx.tx ? ctx.tx(c.what) : (c.what && c.what.text != null ? String(c.what.text) : ''); }
    evs.forEach(function (e) {
      var a, c, m;
      // 変化の日（18-1）: 入っていなくても付ける
      if (e.t === 'chg+') {
        a = findId(state.activities, e.act); c = a ? findId(a.changes, e.id) : null;
        if (c && !c.day) { c.day = ctx.today; touched.activities = true; }
      }
      if (!ctx.joined) return;
      if (e.t === 'msg+') {
        m = findId(state.talk, e.id);
        if (!m) return;
        if (m.who === 'child') add('talk', 'proxy', m.text, { msg: m.id });
        else if (m.who === 'record') add('plan', 'hands', m.text, { msg: m.id });
      } else if (e.t === 'row+' || e.t === 'rowMine') {
        var r = findId(state.plan, e.id);
        if (r && !r.by) { r.by = ctx.supId; touched.plan = true; }
      } else if (e.t === 'rowHidden') {
        var rh = findId(state.plan, e.id);
        if (rh) add('plan', 'hands', line(e.hidden ? 'log_hide' : 'log_show', { title: rh.title }), { row: rh.id });
      } else if (e.t === 'act+') {
        a = findId(state.activities, e.id);
        if (!a) return;
        if (!a.by) { a.by = ctx.supId; touched.activities = true; }
        add('make', 'hands', line('log_act', { title: a.title }), { act: a.id });
      } else if (e.t === 'chg+') {
        if (c) add('make', 'hands', line('log_chg', { title: a.title, what: what(c) }), { act: a.id });
      } else if (e.t === 'say+') {
        a = findId(state.activities, e.act); m = a ? findId(a.thread, e.id) : null;
        if (m) add('make', 'proxy', line('log_say', { title: a.title, text: m.text }), { act: a.id });
      } else if (e.t === 'work+') {
        var w = findId(state.works, e.id);
        if (!w) return;
        if (!w.by) { w.by = ctx.supId; touched.works = true; }
        add('works', 'hands', line('log_work', { title: w.title }), { work: w.id });
      } else if (e.t === 'share+') {
        var ws = findId(state.works, e.id);
        if (ws) add('works', 'hands', line('log_share', { title: ws.title }), { work: ws.id });
      } else if (e.t === 'found+') {
        add('today', 'hands', line('log_found', {}), { odai: e.odai });
        if (state.sup) {
          var h = state.sup.helped = isObj(state.sup.helped) ? state.sup.helped : { odai: {} };
          if (!isObj(h.odai)) h.odai = {};
          if (h.odai[e.odai] !== true) { h.odai[e.odai] = true; touched.sup = true; }
        }
      }
    });
    return { snap: next, log: log, touched: Object.keys(touched) };
  }

  // ---------- 手伝いの移り変わり（AD-9 / 18-6 / 18-12） ----------
  // o: { weeks, thisWeek, scenes, state, messages, today }
  function countThisWeek(scene, o) {
    var n = { own: 0, cue: 0, by: 0 }, st = o.state || {};
    if (scene === 'plan') {
      (st.plan || []).forEach(function (r) {
        if (!r || r.kind !== 'mine' || r.gone === 'removed') return;
        if (r.by) n.by += 1; else if (r.idea) n.cue += 1; else n.own += 1;
      });
    } else if (scene === 'talk') {
      var ms = o.messages || [];
      ms.forEach(function (m, i) {
        if (!m || m.who !== 'child') return;
        var pv = ms[i - 1];
        if (m.by) n.by += 1;
        else if (pv && (pv.who === 'supporter' || (pv.who === 'buddy' && pv.ideaReply))) n.cue += 1;
        else n.own += 1;
      });
    } else if (scene === 'make') {
      (st.activities || []).forEach(function (a) {
        (a && a.changes || []).forEach(function (c) {
          if (!c || c.day !== o.today || c.who !== 'own') return;
          if (c.with) n.by += 1; else if (a.idea) n.cue += 1; else n.own += 1;
        });
      });
    }
    return n;
  }
  function fade(o) {
    o = o || {};
    var tw = o.thisWeek || { key: 'this', label: '' };
    return (o.scenes || []).map(function (sc) {
      var weeks = (o.weeks || []).map(function (w) {
        var v = (w.scenes && w.scenes[sc.id]) || {};
        return { key: w.key, label: w.label, own: v.own || 0, cue: v.cue || 0, by: v.by || 0, live: false };
      });
      var n = countThisWeek(sc.id, o);
      weeks.push({ key: tw.key, label: tw.label, own: n.own, cue: n.cue, by: n.by, live: true });
      return { scene: sc.id, label: sc.label, weeks: weeks };
    });
  }
  function total(w) { return w.own + w.cue + w.by; }
  // 最初の週（回数 > 0 の最初）と今週を「割合」で比べる（18-6）
  function compare(f) {
    var ws = f.weeks, last = ws[ws.length - 1], first = null;
    for (var i = 0; i < ws.length - 1; i++) if (total(ws[i]) > 0) { first = ws[i]; break; }
    var n1 = total(last);
    if (!n1) return { kind: 'none', first: first, last: last };
    if (!first) return { kind: 'flat', only: true, first: null, last: last };
    var n0 = total(first);
    return { kind: last.own * n0 > first.own * n1 ? 'up' : 'flat', first: first, last: last };
  }
  function cmpVars(f, cp, names) {
    return merge(names, { label: f.label, w0: cp.first ? cp.first.label : '', n0: cp.first ? total(cp.first) : 0, o0: cp.first ? cp.first.own : 0, n1: total(cp.last), o1: cp.last.own });
  }
  function fadeLines(fd, text, names) {
    var tx = text || {};
    return (fd || []).map(function (f) {
      var cp = compare(f);
      // 過去の週がすべて 0 回: 比べる相手が無いので 今週だけの文（fade_only）
      var key = cp.kind === 'flat' && cp.only ? 'fade_only' : 'fade_' + cp.kind;
      return { scene: f.scene, kind: cp.kind, line: fmt(tx[key], cmpVars(f, cp, names)) };
    });
  }

  // ---------- どんな手伝いをしたか（AD-9 の 2） ----------
  function howCounts(log, days) {
    var out = { proxy: 0, hands: 0, voice: 0, idea: 0 };
    (log || []).forEach(function (e) { if (e && (days || []).indexOf(e.day) >= 0 && hasOwn(out, e.how)) out[e.how] += 1; });
    return out;
  }

  // ---------- 保護者レポートの下書き（AD-11 / 18-10 / 18-12） ----------
  // o: { report（DES.supData.report）, fade, lines, plan, text, names, edits, off } → 節 6 つ
  function reportDraft(o) {
    o = o || {};
    var rp = o.report || {}, tx = o.text || {}, names = o.names || {}, edits = o.edits || {}, off = o.off || {};
    var lines = o.lines || fadeLines(o.fade, tx, names), kinds = {};
    lines.forEach(function (l) { kinds[l.scene] = l.kind; });
    function item(id, text, src) {
      var e = isStr(edits[id]) ? edits[id] : null;
      return { id: id, text: e != null ? e : text, orig: text, src: src, edited: e != null && e !== text, off: off[id] === true };
    }
    return (rp.sections || []).map(function (sec) {
      var items = (rp.items || []).filter(function (it) { return it.sec === sec.id; }).map(function (it) { return item(it.id, fmt(it.text, names), it.src === 'own' ? 'own' : 'record'); });
      var out = { id: sec.id, head: sec.head, items: items };
      if (sec.id === 'own') {
        (o.fade || []).forEach(function (f) {
          var cp = compare(f);
          if (cp.kind === 'none') return;
          var k = (kinds[f.scene] || cp.kind) === 'up' ? 'rp_own_up' : 'rp_own_flat';
          items.push(item('own:' + f.scene, fmt(tx[k], cmpVars(f, cp, names)), 'calc'));
        });
        out.note = tx.rp_own_note;
      }
      if (sec.id === 'next') {
        (o.plan || []).filter(function (r) { return r && r.kind === 'proposed' && !r.gone; })
          .sort(function (a, b) { return toMin(a.start) - toMin(b.start); })
          .forEach(function (r) { items.push(item('next:' + r.id, fmt(tx.rp_next_proposed, { start: r.start, title: r.title }), 'record')); });
      }
      return out;
    });
  }

  // ---------- 教室の一覧の 1 行（はると。AD-7 / 18-12） ----------
  // o: { plan, messages, ideas, joined, now, child: { id, name }, mode, text }。時間帯は text.range_fmt で作る（記号を直書きしない）
  // 非表示（hidden）の mine 行も時間は占めているので「今・次」に数える。「確認」は当たったものを契約の順に全部（最大 3 つ）
  function childRow(o) {
    o = o || {};
    var tx = o.text || {}, now = toMin(o.now), ch = o.child || {};
    function rg(start, end) { return fmt(tx.range_fmt, { start: start, end: end == null ? '' : end }); }
    var rows = (o.plan || []).filter(function (r) {
      if (!r || r.gone) return false;
      if (r.kind === 'optional') return r.choice !== 'skip';
      return r.kind === 'fixed' || r.kind === 'event' || r.kind === 'mine';
    }).slice().sort(function (a, b) { return toMin(a.start) - toMin(b.start); });
    var cur = null, nxt = null;
    rows.forEach(function (r) {
      if (!cur && toMin(r.start) <= now && now < toMin(r.end)) cur = r;
      if (!nxt && toMin(r.start) > now) nxt = r;
    });
    var consult = null;
    (o.messages || []).forEach(function (m) { if (m && m.who === 'child') consult = String(m.text == null ? '' : m.text); });
    var checks = [];
    if ((o.plan || []).some(function (r) { return r && r.kind === 'proposed' && !r.gone; })) checks.push(tx.chk_proposed);
    if ((o.ideas || []).some(function (x) { return x && x.state === 'open'; })) checks.push(tx.chk_idea);
    if (o.joined) checks.push(tx.chk_joined);
    return {
      id: ch.id, name: ch.name, mode: o.mode === 'es' ? 'es' : 'js',
      now: cur ? cur.title + ' ' + rg(cur.start, cur.end) : tx.now_gap,
      next: nxt ? nxt.title + ' ' + rg(nxt.start, '') : tx.next_none,
      consult: consult, checks: checks.filter(Boolean)
    };
  }

  // ---------- サポーター画面の並べ替え・判定（W2。画面の決まりを支える純関数） ----------
  // 'M/D' → 比べられる数（月 * 100 + 日）。形が違えば -1
  function dayNum(d) { var m = /^(\d{1,2})\/(\d{1,2})$/.exec(String(d == null ? '' : d)); return m ? (+m[1]) * 100 + (+m[2]) : -1; }
  // 記録の絞り込み（AD-9 の 3）: そのほか = 作品・今日のお題・一緒に入る・助言・観察・レポート
  var LOG_GROUP = { plan: ['plan'], talk: ['talk'], make: ['make'], other: ['works', 'today', 'join', 'advice', 'note', 'report'] };
  // 記録（seed + このブラウザの記録）→ 絞り込み → 日の新しい順 → 時刻の新しい順（同じ時刻は配列の後ろ = 後から足したものが先）→ 日ごとにまとめる
  // 戻り値 [ { day, items: [記録…] } ]。引数を書き換えない
  function logView(list, filter) {
    var g = LOG_GROUP[filter] || null, out = [];
    var rows = (list || []).map(function (e, i) { return { e: e, i: i }; }).filter(function (x) { return isObj(x.e) && (!g || g.indexOf(x.e.scene) >= 0); });
    rows.sort(function (a, b) { return (dayNum(b.e.day) - dayNum(a.e.day)) || (toMin(b.e.time) - toMin(a.e.time)) || (b.i - a.i); });
    rows.forEach(function (x) {
      var last = out[out.length - 1];
      if (!last || last.day !== x.e.day) { last = { day: x.e.day, items: [] }; out.push(last); }
      last.items.push(x.e);
    });
    return out;
  }
  // 助言の一覧（AD-8）: このブラウザの分（同じ id は state 側が勝つ）+ seed → 日・時刻の新しい順（同じ時刻は state の並び = 先頭が新しい）
  function adviceList(seed, mine) {
    var have = {}, all = [];
    function put(x) { if (isObj(x) && isStr(x.id) && !have[x.id]) { have[x.id] = true; all.push(x); } }
    (mine || []).forEach(put);
    (seed || []).forEach(put);
    return all.map(function (x, i) { return { x: x, i: i }; })
      .sort(function (a, b) { return (dayNum(b.x.day) - dayNum(a.x.day)) || (toMin(b.x.time) - toMin(a.x.time)) || (a.i - b.i); })
      .map(function (o) { return o.x; });
  }
  // 手伝いの移り変わりの四角（AD-9）: 1 回 = 1 つ。自分で → きっかけ → 代わりに の順に最大 max 個。超えた分は more
  function squares(w, max) {
    var cells = [], lim = max || 10;
    ['own', 'cue', 'by'].forEach(function (k) { for (var i = 0; i < ((w && w[k]) || 0); i++) cells.push(k); });
    return { n: cells.length, cells: cells.slice(0, lim), more: Math.max(0, cells.length - lim) };
  }
  // バディの提案（AD-7 の「今日」3）: 会話から生まれた行（from が会話の id）を時刻順に。状態と、元の発言の 1 行目
  // status: proposed 提案中 / chosen 本人が選んだ / held 保留 / declined 見送り / removed 予定から外した / finished 終わった
  function proposals(plan, messages) {
    var msgs = {};
    (messages || []).forEach(function (m) { if (isObj(m) && isStr(m.id)) msgs[m.id] = m; });
    function status(r) {
      if (r.gone === 'declined') return 'declined';
      if (r.gone === 'removed') return 'removed';
      if (r.gone === 'finished') return 'finished';
      return r.kind === 'proposed' ? 'proposed' : r.kind === 'mine' ? 'chosen' : r.kind === 'held' ? 'held' : null;
    }
    return (plan || []).filter(function (r) { return isObj(r) && isStr(r.from) && msgs[r.from] && status(r); })
      .slice().sort(function (a, b) { return toMin(a.start) - toMin(b.start); })
      .map(function (r) { return { row: r, status: status(r), line: String(msgs[r.from].text == null ? '' : msgs[r.from].text).split('\n')[0] }; });
  }
  // レポート（18-13）: 「確かめた」時点の中身を body に写す。補足は末尾の { id: 'extra', text } に入れる（body は配列のまま）
  function reportFreeze(sections, extra) {
    var out = (sections || []).map(function (s) {
      var o = { id: s.id, head: s.head, items: (s.items || []).map(function (it) { return { id: it.id, text: it.text, orig: it.orig, src: it.src, edited: !!it.edited, off: !!it.off }; }) };
      if (s.note) o.note = s.note;
      return o;
    });
    out.push({ id: 'extra', text: String(extra == null ? '' : extra) });
    return out;
  }
  // body → { sections, extra }（形が違えば null）
  function reportThaw(body) {
    if (!Array.isArray(body)) return null;
    var secs = [], extra = '';
    body.forEach(function (s) {
      if (!isObj(s)) return;
      if (s.id === 'extra' && !Array.isArray(s.items)) { extra = isStr(s.text) ? s.text : ''; return; }
      var o = { id: s.id, head: s.head, items: (Array.isArray(s.items) ? s.items : []).filter(isObj) };
      if (s.note) o.note = s.note;
      secs.push(o);
    });
    return { sections: secs, extra: extra };
  }
  // 中身（節・項目の id と文・載せる / 載せない・補足）が同じか。違えば rp_stale を出す
  function reportKey(sections, extra) {
    return JSON.stringify([(sections || []).map(function (s) { return [s.id, (s.items || []).map(function (it) { return [it.id, it.text, !!it.off]; })]; }), String(extra == null ? '' : extra)]);
  }
  function reportSame(body, sections, extra) {
    var b = reportThaw(body);
    return !!b && reportKey(b.sections, b.extra) === reportKey(sections, extra);
  }
  // 載せる項目の数（0 なら「確かめた」を押せない）
  function reportOnCount(sections) {
    var n = 0;
    (sections || []).forEach(function (s) { (s.items || []).forEach(function (it) { if (it && !it.off) n += 1; }); });
    return n;
  }
  // おうちの人に届く形: 載せる項目だけ・項目が 0 の節は出さない
  function reportOut(sections) {
    return (sections || []).map(function (s) {
      var o = { id: s.id, head: s.head, items: (s.items || []).filter(function (it) { return it && !it.off; }).map(function (it) { return it.text; }) };
      if (s.note) o.note = s.note;
      return o;
    }).filter(function (s) { return s.items.length > 0; });
  }

  var pure = {
    normalize: normalize, appendLog: appendLog, snap: snap, diff: diff, observe: observe, fade: fade, fadeLines: fadeLines,
    howCounts: howCounts, reportDraft: reportDraft, childRow: childRow, fmt: fmt, LOG_MAX: LOG_MAX, FILTERS: FILTERS, STANCES: STANCES,
    logView: logView, adviceList: adviceList, squares: squares, proposals: proposals,
    reportFreeze: reportFreeze, reportThaw: reportThaw, reportSame: reportSame, reportOnCount: reportOnCount, reportOut: reportOut
  };
  Object.keys(pure).forEach(function (k) { C[k] = pure[k]; });
  if (typeof module !== 'undefined' && module.exports) module.exports = pure;
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
