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
    d.body = Array.isArray(r.body) ? clone(r.body) : null;
    return d;
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
    if (!first) first = last;
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
      return { scene: f.scene, kind: cp.kind, line: fmt(tx['fade_' + cp.kind], cmpVars(f, cp, names)) };
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
  // o: { plan, messages, ideas, joined, now, child: { id, name }, mode, text }
  function childRow(o) {
    o = o || {};
    var tx = o.text || {}, now = toMin(o.now), ch = o.child || {};
    var rows = (o.plan || []).filter(function (r) {
      if (!r || r.gone || r.hidden) return false;
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
      now: cur ? cur.title + ' ' + cur.start + '〜' + cur.end : tx.now_gap,
      next: nxt ? nxt.title + ' ' + nxt.start + '〜' : tx.next_none,
      consult: consult, checks: checks.filter(Boolean)
    };
  }

  var pure = {
    normalize: normalize, appendLog: appendLog, snap: snap, diff: diff, observe: observe, fade: fade, fadeLines: fadeLines,
    howCounts: howCounts, reportDraft: reportDraft, childRow: childRow, fmt: fmt, LOG_MAX: LOG_MAX, FILTERS: FILTERS, STANCES: STANCES
  };
  Object.keys(pure).forEach(function (k) { C[k] = pure[k]; });
  if (typeof module !== 'undefined' && module.exports) module.exports = pure;
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
