/* 学びマップ（#map 作ったものから / #map/fields 分野で見る / #map/list リスト / #map/basics 基礎学習 / #map/u/<code> 単元）:
   CONTRACT-v3 §Y（基礎学習・単元・手がかりの約束）+ §AB（つながりを拡大縮小できる 1 枚の地図に。§Y-2 の 3 列と線を置き換え）。
   主役は「作ったもの」。作ったもの → そこで学んだこと（手がかり。記録 1 つを場面として必ず伴う）→ つながる単元 を基本の線に、
   作ったものどうし（同じ単元）・学ぶ順・教科をまたぐ・これから作れそう の 4 種のつながりを、チップで選んで重ねる。
   多くても読めるように: 倍率で出す量を変える（far / mid / near）/ 種類を選ぶ / 1 つ選ぶとそこだけ濃く / 詳細パネル。
   学んだことは判定ではなく手がかり。数・達成・順位・おすすめ度は出さない。
   純関数（MP.progress / overall / graph / related / peers / normalizeUi / select / decline …）は DOM と DES.t に触れず、
   node からも読める（tools/map-test.js）。並びは map-layout.js（MPL）、動かし方は map-canvas.js（MPC）。
   本人の操作で変わるのは des3.mapUi（見方・見方ごとの選択・チップ・外したもの・表示位置）だけ。変更は DES.store.save('mapUi') → DES.app.commit の 1 経路
  （失敗したら画面の状態を戻す）。表示位置だけは描き直さずに保存する。 */
(function (root) {
  'use strict';
  var DES = root.DES = root.DES || {};
  var MPD = DES.mapData || (typeof require === 'function' ? require('./map-data.js') : null);
  var MPL = DES.mapLayout || (typeof require === 'function' ? require('./map-layout.js') : null);
  var MPC = DES.mapCanvas || (typeof require === 'function' ? require('./map-canvas.js') : null);
  var MP = DES.map = DES.map || {};
  var SRC = ['own', 'person', 'buddy'];
  var VIEWS = ['made', 'fields', 'list'];
  var CHIPS = ['peer', 'order', 'cross', 'next'];
  var MADE = { act: 1, work: 1, past: 1 };

  // ---------- 小道具 ----------
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function find(list, id) { for (var i = 0; i < (list || []).length; i++) if (list[i] && list[i].id === id) return list[i]; return null; }
  function trim(v) { return String(v == null ? '' : v).replace(/^\s+|\s+$/g, ''); }
  function fin(v) { return typeof v === 'number' && isFinite(v); }

  // ---------- 進み具合（§Y-3）: 両方そろった項目 / 項目数（整数・四捨五入） ----------
  function progress(unit, prog) {
    var out = { done: 0, practiceOnly: 0, explainOnly: 0, total: 0, pct: 0 };
    if (!unit || !Array.isArray(unit.items)) return out;
    unit.items.forEach(function (it) {
      var v = MPD.itemProgress(prog, it.id);
      out.total += 1;
      if (v.practice && v.explain) out.done += 1;
      else if (v.practice) out.practiceOnly += 1;
      else if (v.explain) out.explainOnly += 1;
    });
    out.pct = out.total ? Math.round(out.done * 100 / out.total) : 0;
    return out;
  }
  // 全体 = 全項目の両方済み / 全項目数（単元 % の平均にしない）
  function overall(units, prog) {
    var done = 0, total = 0;
    (units || []).forEach(function (u) { var r = progress(u, prog); done += r.done; total += r.total; });
    return { done: done, total: total, pct: total ? Math.round(done * 100 / total) : 0 };
  }
  // 記録が 1 つも無い（どの項目も問題・説明の印が無い）
  function isBlank(units, prog) {
    return (units || []).every(function (u) {
      return (u.items || []).every(function (it) { var v = MPD.itemProgress(prog, it.id); return !v.practice && !v.explain; });
    });
  }
  // 'M/D' を比べられる数に（月 * 100 + 日）
  function dayNum(s) { var m = /^(\d{1,2})\/(\d{1,2})$/.exec(String(s || '')); return m ? (+m[1]) * 100 + (+m[2]) : -1; }
  // その単元で基礎学習をした いちばん新しい日（問題・説明のどちらでも）。無ければ null
  function lastDate(unit, prog) {
    var best = null;
    ((unit && unit.items) || []).forEach(function (it) {
      var v = MPD.itemProgress(prog, it.id);
      [v.practice, v.explain].forEach(function (d) { if (d && (best == null || dayNum(d) > dayNum(best))) best = d; });
    });
    return best;
  }

  // ---------- 場面（記録 1 つ）。記録が無い・空・引き出した時の原文（quote）と違う（本人が直した）なら null = その学んだことは出さない ----------
  function scene(ev, a, works, opts) {
    if (!isObj(ev) || !a || typeof ev.quote !== 'string' || !trim(ev.quote)) return null;
    var quote = trim(ev.quote);
    if (typeof ev.changeId === 'string') {
      var c = find(a.changes, ev.changeId), t = c && c.what && typeof c.what.text === 'string' ? trim(c.what.text) : '';
      if (!t || t !== quote) return null;
      return { kind: 'change', ref: c.id, field: 'what', date: opts.today || null, time: c.time || null, text: t, with: c.with || null };
    }
    if (typeof ev.workId === 'string') {
      var w = find(works, ev.workId), f = ev.field === 'craft' || ev.field === 'like' ? ev.field : null;
      if (!w || !f || w.actId !== a.id) return null;
      var v = typeof w[f] === 'string' ? trim(w[f]) : '';
      if (!v || v !== quote) return null;
      return { kind: 'work', ref: w.id, field: f, date: w.date || null, time: w.atTime || null, text: v, with: null };
    }
    return null;
  }
  // 前に作ったもの（地図専用の見本）の記録
  function pastScene(ev, p) {
    if (!isObj(ev) || !p || typeof ev.recordId !== 'string' || typeof ev.quote !== 'string' || !trim(ev.quote)) return null;
    var r = find(p.records, ev.recordId), t = r && typeof r.text === 'string' ? trim(r.text) : '';
    if (!t || t !== trim(ev.quote)) return null;
    return { kind: 'record', ref: r.id, field: 'text', date: r.date || p.date || null, time: r.time || null, text: t, with: r.with || null };
  }

  // ---------- つながり（§AB-12）----------
  // nodes = { made（今の活動 act: / 活動の無い作品 work: / 前に作ったもの past:。新しい順）, learned（ln:）, units（unit:。全教科）, next（next:）}
  // edges = { id, kind, from, to, views }: kind = base（作ったもの → 学んだこと → 単元）/ mu（分野で見る: 作ったもの → 単元）/
  //   peer（作ったものどうし = 同じ単元につながる。データに持たず導く）/ order（学ぶ順）/ cross（教科をまたぐ）/ next（これから作れそう）。
  // 存在しない活動・作品・記録・単元を指すものは線ごと落とす。外した（declined）見立てと next も落とす。
  function graph(learned, acts, works, declined, opts) {
    opts = opts || {};
    learned = Array.isArray(learned) ? learned : [];
    acts = (Array.isArray(acts) ? acts : []).filter(function (a) { return a && typeof a.id === 'string'; });
    works = (Array.isArray(works) ? works : []).filter(function (w) { return w && typeof w.id === 'string'; });
    declined = Array.isArray(declined) ? declined : [];
    var past = (Array.isArray(opts.past) ? opts.past : MPD.past).filter(function (p) { return p && typeof p.id === 'string'; });
    var nexts = Array.isArray(opts.next) ? opts.next : MPD.next;
    var links = Array.isArray(opts.links) ? opts.links : MPD.unitLinks;
    var dn = Array.isArray(opts.declinedNext) ? opts.declinedNext : [];
    var g = { nodes: { made: [], learned: [], units: [], next: [] }, edges: [], islands: [] }, eix = {}, ux = {}, lx = {};
    function edge(e) {
      if (eix[e.id]) { e.views.forEach(function (v) { if (eix[e.id].views.indexOf(v) < 0) eix[e.id].views.push(v); }); return; }
      eix[e.id] = e;
      g.edges.push(e);
    }
    var all = MPD.allUnits(), uorder = {};
    all.forEach(function (u, i) {
      uorder[u.code] = i;
      var n = { id: 'unit:' + u.code, kind: 'unit', code: u.code, material: u.material !== false, name: clone(u.name), subject: clone(u.subject), sub: u.sub, grade: u.grade, area: u.area || null, made: [], learned: [] };
      ux[n.id] = n;
      g.nodes.units.push(n);
    });
    // 作ったもの: 新しい順（日付が同じなら 活動 → 作品 → 前に作ったもの の並び）。日付の無い活動は今日
    var made = [];
    acts.forEach(function (a) {
      made.push({ id: 'act:' + a.id, kind: 'act', actId: a.id, workId: null, pastId: null, title: String(a.title || ''), date: typeof a.day === 'string' ? a.day : (opts.today || null), art: null,
        works: works.filter(function (w) { return w.actId === a.id; }).map(function (w) { return { id: w.id, title: String(w.title || '') }; }), learned: [], units: [] });
    });
    works.forEach(function (w) {
      if (find(acts, w.actId)) return;
      made.push({ id: 'work:' + w.id, kind: 'work', actId: null, workId: w.id, pastId: null, title: String(w.title || ''), date: typeof w.date === 'string' ? w.date : null, art: null, works: [], learned: [], units: [] });
    });
    past.forEach(function (p) {
      made.push({ id: 'past:' + p.id, kind: 'past', actId: null, workId: null, pastId: p.id, title: clone(p.title), date: typeof p.date === 'string' ? p.date : null, art: p.art || null, works: [], learned: [], units: [] });
    });
    var pos = made.map(function (m) { return m.id; });
    made.sort(function (a, b) { return (dayNum(b.date) - dayNum(a.date)) || (pos.indexOf(a.id) - pos.indexOf(b.id)); });
    g.nodes.made = made;
    // 学んだこと（対応表に載っているものだけ。本番の推定はしない）
    made.forEach(function (m) {
      if (m.kind === 'work') return;
      var a = m.kind === 'act' ? find(acts, m.actId) : null, p = m.kind === 'past' ? find(past, m.pastId) : null;
      learned.forEach(function (l) {
        if (!l || typeof l.id !== 'string' || declined.indexOf(l.id) >= 0) return;
        if (m.kind === 'act' && l.actId !== m.actId) return;
        if (m.kind === 'past' && l.pastId !== m.pastId) return;
        var sc = a ? scene(l.evidence, a, works, opts) : pastScene(l.evidence, p);
        if (!sc) return;
        var codes = [];
        (l.units || []).forEach(function (code) { if (MPD.anyUnit(code) && codes.indexOf(code) < 0) codes.push(code); });
        var ln = { id: 'ln:' + l.id, kind: 'learned', learnedId: l.id, madeId: m.id, text: clone(l.text), src: SRC.indexOf(l.src) >= 0 ? l.src : 'buddy', scene: sc, units: codes };
        g.nodes.learned.push(ln);
        lx[ln.id] = ln;
        m.learned.push(ln.id);
        edge({ id: m.id + '>' + ln.id, kind: 'base', from: m.id, to: ln.id, views: ['made'] });
        codes.forEach(function (code) {
          var u = ux['unit:' + code];
          if (m.units.indexOf(code) < 0) m.units.push(code);
          if (u.made.indexOf(m.id) < 0) u.made.push(m.id);
          u.learned.push(ln.id);
          edge({ id: ln.id + '>' + u.id, kind: 'base', from: ln.id, to: u.id, views: ['made'] });
        });
      });
      m.units.sort(function (x, y) { return uorder[x] - uorder[y]; });
    });
    // 分野で見る: 作ったもの → 単元（学んだことは詳細パネルで読む）
    made.forEach(function (m) {
      m.units.forEach(function (code) {
        edge({ id: m.id + '>unit:' + code, kind: 'mu', from: m.id, to: 'unit:' + code, views: ['fields'],
          via: m.learned.filter(function (lid) { return lx[lid].units.indexOf(code) >= 0; }) });
      });
    });
    // 作ったものどうし = 同じ単元につながる
    for (var i = 0; i < made.length; i++) {
      for (var j = i + 1; j < made.length; j++) {
        var shared = made[i].units.filter(function (c) { return made[j].units.indexOf(c) >= 0; });
        if (shared.length) edge({ id: 'peer:' + made[i].id + '|' + made[j].id, kind: 'peer', from: made[i].id, to: made[j].id, units: shared, views: ['made', 'fields'] });
      }
    }
    // 学ぶ順・教科をまたぐ（無い単元を指すものは落とす）
    links.forEach(function (k) {
      if (!k || (k.kind !== 'order' && k.kind !== 'cross') || !MPD.anyUnit(k.from) || !MPD.anyUnit(k.to) || k.from === k.to) return;
      edge({ id: 'ul:' + (typeof k.id === 'string' ? k.id : k.from + '>' + k.to), kind: k.kind, from: 'unit:' + k.from, to: 'unit:' + k.to, why: k.why ? clone(k.why) : null, views: ['made', 'fields'] });
    });
    // これから作れそうなもの: 元の学んだことが 1 つも残っていなければ出さない
    nexts.forEach(function (x) {
      if (!x || typeof x.id !== 'string' || dn.indexOf(x.id) >= 0) return;
      var srcL = (x.learned || []).map(function (id) { return 'ln:' + id; }).filter(function (id) { return lx[id]; });
      if (!srcL.length) return;
      var srcU = (x.units || []).filter(function (code) { return !!MPD.anyUnit(code); }), mids = [];
      srcL.forEach(function (lid) { if (mids.indexOf(lx[lid].madeId) < 0) mids.push(lx[lid].madeId); });
      var n = { id: 'next:' + x.id, kind: 'next', nextId: x.id, title: clone(x.title), line: clone(x.line || null), learned: srcL, units: srcU, made: mids };
      g.nodes.next.push(n);
      srcL.forEach(function (lid) { edge({ id: lid + '>' + n.id, kind: 'next', from: lid, to: n.id, views: ['made'] }); });
      srcU.forEach(function (code) { edge({ id: 'unit:' + code + '>' + n.id, kind: 'next', from: 'unit:' + code, to: n.id, views: ['made', 'fields'] }); });
      // 分野で見るでは学んだことを出さないので、その単元から線を引く
      srcL.forEach(function (lid) { lx[lid].units.forEach(function (code) { edge({ id: 'unit:' + code + '>' + n.id, kind: 'next', from: 'unit:' + code, to: n.id, views: ['fields'] }); }); });
    });
    // 島（教科 × 領域）
    g.islands = MPD.islands().map(function (s) { return { id: s.id, sub: s.sub, area: s.area, subject: clone(s.subject), name: clone(s.name), units: s.units.map(function (c) { return 'unit:' + c; }) }; });
    return g;
  }
  function allNodes(g) { return g ? g.nodes.made.concat(g.nodes.learned, g.nodes.units, g.nodes.next) : []; }
  var IX = typeof WeakMap === 'function' ? new WeakMap() : null;
  function index(g) {
    var ix = IX && IX.get(g);
    if (ix) return ix;
    ix = {};
    allNodes(g).forEach(function (n) { ix[n.id] = n; });
    if (IX) IX.set(g, ix);
    return ix;
  }
  function nodeById(g, id) { return g && typeof id === 'string' ? (index(g)[id] || null) : null; }
  function hasNode(g, id) { return !!nodeById(g, id); }
  function isMade(n) { return !!n && !!MADE[n.kind]; }
  // その見方に出すノード: 作ったものから / リスト = 作ったもの・学んだこと・作ったものとつながる単元・これから / 分野で見る = 作ったもの・全単元・これから
  function viewNodes(g, view) {
    var out = {};
    if (!g) return out;
    g.nodes.made.forEach(function (n) { out[n.id] = true; });
    g.nodes.next.forEach(function (n) { out[n.id] = true; });
    g.nodes.units.forEach(function (u) { if (view === 'fields' || u.made.length) out[u.id] = true; });
    if (view !== 'fields') g.nodes.learned.forEach(function (n) { out[n.id] = true; });
    return out;
  }
  function edgesIn(g, view) {
    var vn = viewNodes(g, view), v = view === 'fields' ? 'fields' : 'made';
    return g ? g.edges.filter(function (e) { return e.views.indexOf(v) >= 0 && vn[e.from] && vn[e.to]; }) : [];
  }
  // 選んだノードとつながるもの（種類ごと）。選んだノードのつながりは、チップが off の種類も含めて全部（§AB-3-3）。自分は含めない
  function related(g, id) {
    var out = { nodes: [], edges: [], kinds: { base: [], mu: [], peer: [], order: [], cross: [], next: [] } };
    var n = nodeById(g, id);
    if (!n) return out;
    var E = g.edges, nodes = {}, seen = {};
    function add(e) {
      if (seen[e.id]) return;
      seen[e.id] = true;
      out.kinds[e.kind].push(e.id);
      if (e.from !== id) nodes[e.from] = true;
      if (e.to !== id) nodes[e.to] = true;
    }
    function from(x, k) { return E.filter(function (e) { return e.from === x && e.kind === k; }); }
    function to(x, k) { return E.filter(function (e) { return e.to === x && e.kind === k; }); }
    function touch(x, k) { return E.filter(function (e) { return (e.from === x || e.to === x) && e.kind === k; }); }
    if (isMade(n)) {
      from(id, 'base').forEach(function (e) { add(e); from(e.to, 'base').forEach(add); });
      from(id, 'mu').forEach(add);
      touch(id, 'peer').forEach(add);
      E.forEach(function (e) {
        if (e.kind === 'next' && (n.learned.indexOf(e.from) >= 0 || (e.from.indexOf('unit:') === 0 && n.units.indexOf(e.from.slice(5)) >= 0))) add(e);
      });
    } else if (n.kind === 'learned') {
      to(id, 'base').forEach(add);
      from(id, 'base').forEach(add);
      from(id, 'next').forEach(add);
    } else if (n.kind === 'unit') {
      to(id, 'base').forEach(function (e) { add(e); to(e.from, 'base').forEach(add); });
      to(id, 'mu').forEach(add);
      touch(id, 'order').forEach(add);
      touch(id, 'cross').forEach(add);
      E.forEach(function (e) { if (e.kind === 'peer' && e.units.indexOf(n.code) >= 0) add(e); });
      from(id, 'next').forEach(add);
    } else if (n.kind === 'next') {
      to(id, 'next').forEach(function (e) { add(e); if (e.from.indexOf('ln:') === 0) to(e.from, 'base').forEach(add); });
    }
    out.nodes = allNodes(g).map(function (x) { return x.id; }).filter(function (x) { return nodes[x]; });
    out.edges = E.filter(function (e) { return seen[e.id]; }).map(function (e) { return e.id; });
    return out;
  }
  // 前に作ったものとのつながり: 同じ単元につながる他の作ったもの + 共有する単元（作ったものの並び = 新しい順）
  function peers(g, id) {
    var out = [];
    if (!g) return out;
    g.edges.forEach(function (e) {
      if (e.kind !== 'peer') return;
      if (e.from === id) out.push({ id: e.to, units: e.units.slice() });
      else if (e.to === id) out.push({ id: e.from, units: e.units.slice() });
    });
    var ord = g.nodes.made.map(function (m) { return m.id; });
    out.sort(function (a, b) { return ord.indexOf(a.id) - ord.indexOf(b.id); });
    return out;
  }
  // des3.mapUi を整える（§AB-13）。壊れた値はその欄だけ初期値。
  // 選択は見方ごと（その見方に無いノードは null）。外せるのはバディの見立てと これから作れそうなもの だけ。表示位置は 作ったものから / 分野で見る ごと
  function defaultUi() {
    return { view: 'made', sel: { made: null, fields: null, list: null }, chips: { peer: true, order: false, cross: false, next: false }, declined: [], declinedNext: [], pos: { made: null, fields: null } };
  }
  function normalizeUi(raw, g, opt) {
    opt = opt || {};
    var table = Array.isArray(opt.learned) ? opt.learned : MPD.learned, ntable = Array.isArray(opt.next) ? opt.next : MPD.next, out = defaultUi();
    if (isObj(raw)) {
      if (VIEWS.indexOf(raw.view) >= 0) out.view = raw.view;
      // 選択: 見方ごと。§Y の形（文字列 1 つ）は「作ったものから」の選択として読む
      if (isObj(raw.sel)) VIEWS.forEach(function (v) { if (typeof raw.sel[v] === 'string') out.sel[v] = raw.sel[v]; });
      else if (typeof raw.sel === 'string') out.sel.made = raw.sel;
      if (isObj(raw.chips)) CHIPS.forEach(function (k) { if (typeof raw.chips[k] === 'boolean') out.chips[k] = raw.chips[k]; });
      var buddy = table.filter(function (l) { return l && l.src === 'buddy'; }).map(function (l) { return l.id; });
      if (Array.isArray(raw.declined)) raw.declined.forEach(function (id) { if (typeof id === 'string' && buddy.indexOf(id) >= 0 && out.declined.indexOf(id) < 0) out.declined.push(id); });
      var nids = ntable.map(function (x) { return x && x.id; });
      if (Array.isArray(raw.declinedNext)) raw.declinedNext.forEach(function (id) { if (typeof id === 'string' && nids.indexOf(id) >= 0 && out.declinedNext.indexOf(id) < 0) out.declinedNext.push(id); });
      if (isObj(raw.pos)) ['made', 'fields'].forEach(function (v) {
        var p = raw.pos[v];
        if (isObj(p) && fin(p.x) && fin(p.y) && fin(p.z) && p.z >= MPC.MIN && p.z <= MPC.MAX) out.pos[v] = { x: p.x, y: p.y, z: p.z };
      });
    }
    if (g) {
      VIEWS.forEach(function (v) { if (out.sel[v] != null && !viewNodes(g, v)[out.sel[v]]) out.sel[v] = null; });
    }
    return out;
  }
  function viewOk(v) { return VIEWS.indexOf(v) >= 0 ? v : 'made'; }
  // 選ぶ: 同じノードをもう一度で外す（null）。その見方に無いノードは何もしない
  function select(ui, g, view, id) {
    var cur = normalizeUi(ui, g);
    view = viewOk(view);
    if (!viewNodes(g, view)[id]) return cur;
    cur.sel[view] = cur.sel[view] === id ? null : id;
    return cur;
  }
  function deselect(ui, g, view) { var cur = normalizeUi(ui, g); cur.sel[viewOk(view)] = null; return cur; }
  // バディの見立てを「違う」で外す（本人・人の言葉は外さない）。その学んだことを選んでいた見方は、その作ったものへ
  function decline(ui, g, view, id) {
    var n = nodeById(g, id), cur = normalizeUi(ui, g);
    if (!n || n.kind !== 'learned' || n.src !== 'buddy') return null;
    cur.declined.push(n.learnedId);
    VIEWS.forEach(function (v) { if (cur.sel[v] === id) cur.sel[v] = n.madeId; });
    return cur;
  }
  // 元に戻す: 外した学んだことを戻し、選択は外す前（無ければその学んだこと）に
  function undecline(ui, view, learnedId, selBefore) {
    var cur = normalizeUi(ui, null);
    cur.declined = cur.declined.filter(function (x) { return x !== learnedId; });
    cur.sel[viewOk(view)] = typeof selBefore === 'string' ? selBefore : 'ln:' + learnedId;
    return cur;
  }
  // これから作れそうなものを「違う」で地図から外す
  function declineNext(ui, g, view, id) {
    var n = nodeById(g, id), cur = normalizeUi(ui, g);
    if (!n || n.kind !== 'next') return null;
    cur.declinedNext.push(n.nextId);
    VIEWS.forEach(function (v) { if (cur.sel[v] === id) cur.sel[v] = null; });
    return cur;
  }
  function undeclineNext(ui, view, nextId, selBefore) {
    var cur = normalizeUi(ui, null);
    cur.declinedNext = cur.declinedNext.filter(function (x) { return x !== nextId; });
    cur.sel[viewOk(view)] = typeof selBefore === 'string' ? selBefore : 'next:' + nextId;
    return cur;
  }
  // 単元につながる 学んだこと + 作ったもの（単元の詳細の「作ったものとのつながり」）
  function unitLinks(g, code) {
    var out = [];
    if (!g) return out;
    g.nodes.learned.forEach(function (ln) {
      if (ln.units.indexOf(code) < 0) return;
      out.push({ learned: ln, made: nodeById(g, ln.madeId) });
    });
    return out;
  }

  var pure = {
    progress: progress, overall: overall, isBlank: isBlank, lastDate: lastDate, dayNum: dayNum, graph: graph, related: related, peers: peers,
    viewNodes: viewNodes, edgesIn: edgesIn, defaultUi: defaultUi, normalizeUi: normalizeUi, select: select, deselect: deselect,
    decline: decline, undecline: undecline, declineNext: declineNext, undeclineNext: undeclineNext, unitLinks: unitLinks, nodeById: nodeById, hasNode: hasNode
  };
  Object.keys(pure).forEach(function (k) { MP[k] = pure[k]; });
  if (typeof module !== 'undefined' && module.exports) module.exports = pure;
  if (typeof document === 'undefined') return;

  // ======================================================================
  // ここから下はブラウザ専用
  // ======================================================================

  // ---------- 保存（§AB-13）: 既存の DES.store に des3.mapUi を足す（today.js と同じ包み方） ----------
  if (DES.store && !DES.store._map) {
    var load1 = DES.store.load, save1 = DES.store.save;
    DES.store._map = true;
    DES.store.load = function () {
      var s = load1.apply(DES.store, arguments), raw = null;
      try {
        var t = window.localStorage.getItem('des3.mapUi');
        if (t != null) raw = JSON.parse(t);
      } catch (e) { s.saveFailed = true; }
      s.mapUi = normalizeUi(raw, null);
      return s;
    };
    DES.store.save = function (only) {
      var ok = save1.call(DES.store, only);
      if (!only && !save1.call(DES.store, 'mapUi')) ok = false;
      return ok;
    };
  }

  var MD = DES.makeData;
  var SVGNS = 'http://www.w3.org/2000/svg';
  function S() { return DES.state; }
  function T(k, v) { return DES.t(k, v); }
  function H() { return DES.h.apply(null, arguments); }
  function icon(n) { return DES.raw(DES.icon(n)); }
  function pick(pair) { return Array.isArray(pair) ? (DES.mode() === 'es' && pair[1] ? pair[1] : pair[0]) : String(pair == null ? '' : pair); }
  function esc(v) { return window.CSS && CSS.escape ? CSS.escape(v) : String(v).replace(/"/g, '\\"'); }
  function narrow() { return DES.app.bp() === 's'; }
  function motionOK() {
    if (document.documentElement.classList.contains('reduced-motion')) return false;
    return !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  function wide() { return !(window.matchMedia && window.matchMedia('(max-width:1023px)').matches); }
  function ui() {
    var u = DES.ui;
    if (!u.mp) u.mp = { shown: null, missing: null, selCard: null, redirect: false, lastUnit: null, unitFrom: null, cache: {}, reveal: null, ro: null };
    return u.mp;
  }
  function todayMD() { var p = DES.data.today.split('-'); return (+p[1]) + '/' + (+p[2]); }
  function mapUi() { if (!isObj(S().mapUi) || !isObj(S().mapUi.sel) || !isObj(S().mapUi.chips)) S().mapUi = normalizeUi(S().mapUi, null); return S().mapUi; }
  function graphNow() { var u = mapUi(); return graph(MPD.learned, S().activities || [], S().works || [], u.declined, { today: todayMD(), declinedNext: u.declinedNext }); }
  // 並びは外したものを含む全体で決める（「違う」・元に戻すで他のノードが動かない）
  function graphFull() { return graph(MPD.learned, S().activities || [], S().works || [], [], { today: todayMD() }); }
  function shape(g) {
    return JSON.stringify([g.nodes.made.map(function (n) { return [n.id, n.title]; }), g.nodes.learned.map(function (n) { return n.id; }), g.nodes.next.map(function (n) { return n.id; }), g.edges.length]);
  }
  function layoutOf(view) {
    var gf = graphFull(), key = view + '|' + shape(gf), c = ui().cache;
    if (c[view] && c[view].key === key) return c[view].L;
    var L = MPL.layout(gf, view);
    c[view] = { key: key, L: L };
    return L;
  }
  function selOf(id) { return '[data-action="mp-sel"][data-id="' + esc(id) + '"]:not(.mp-rel)'; }
  function btn(label, action, o) {
    o = o || {};
    var at = { class: 'btn small' + (o.kls ? ' ' + o.kls : ''), type: 'button', 'data-action': action };
    if (o.id) at['data-id'] = o.id;
    if (o.disabled) { at.disabled = true; if (o.title) at.title = o.title; }
    return H('button', at, [o.icon ? icon(o.icon) : null, H('span', null, label)]);
  }
  function chip(kind, text, label) {
    var ic = { own: 'quote', ai: 'spark', record: 'record' }[kind];
    return H('span', { class: 'chip src-' + kind, role: 'img', 'aria-label': label || text }, [icon(ic), H('span', null, text)]);
  }
  // 出所チップ（本人 = 青 / 人 = 記録の緑 / バディ = 琥珀）
  function srcName(src) { return src === 'own' ? T('who_own') : (src === 'person' ? T('mp_src_person') : T('who_ai')); }
  function srcChip(src) { return chip(src === 'own' ? 'own' : (src === 'person' ? 'record' : 'ai'), srcName(src), T('mp_src_label', { who: srcName(src) })); }

  // ---------- ノードの言葉 ----------
  function unitFull(u) { return u ? T('mp_unit_ext', { subject: pick(u.subject), grade: u.grade, name: pick(u.name) }) : ''; }
  function unitHead(u) { return T('mp_unit_head', { subject: pick(u.subject), grade: u.grade }); }
  function areaName(u) { var a = MPD.areaOf(u); return a ? pick(a.name) : ''; }
  function kindLabel(kind) { return T({ act: 'mp_kind_act', past: 'mp_kind_act', work: 'mp_kind_work', learned: 'mp_kind_learned', unit: 'mp_kind_unit', next: 'mp_kind_next' }[kind]); }
  function words(n) {
    if (!n) return '';
    if (n.kind === 'learned') return pick(n.text);
    if (n.kind === 'unit') return unitFull(n);
    return pick(n.title);
  }
  // グラフに無いノード（単元の詳細で、つながりの無い単元）も言葉にできるように
  function wordsOf(id) {
    var n = nodeById(graphNow(), id);
    if (n) return words(n);
    if (/^unit:/.test(id)) { var u = MPD.anyUnit(id.slice(5)); return u ? unitFull({ subject: u.subject, grade: u.grade, name: u.name }) : ''; }
    return '';
  }
  function sceneText(sc) {
    var head = [sc.date, sc.time].filter(Boolean).join(' ');
    return (head ? head + ' ' : '') + sc.text + (sc.with ? T('mp_with', { name: sc.with }) : '');
  }
  function basicLine(n) {
    if (!n.material) return T('mp_no_material');
    var d = lastDate(MPD.unit(n.code), MPD.progress);
    return d ? T('mp_basic_done', { date: d }) : T('mp_basic_next');
  }
  function madeSub(n) {
    var bits = [];
    if (n.date) bits.push(n.date);
    if (n.works && n.works.length) bits.push(T('mp_works_of', { titles: n.works.map(function (w) { return w.title; }).join('・') }));
    if (n.kind === 'work') bits.push(kindLabel('work'));
    return bits.join(' · ');
  }
  function sameLine(codes) { return T('mp_peer_same', { units: codes.map(function (c) { var u = MPD.anyUnit(c); return u ? pick(u.name) : c; }).join('』『') }); }
  // 「〇〇と〇〇で学んだことから」
  function nextFrom(g, n) {
    var titles = n.made.map(function (id) { return words(nodeById(g, id)); }).filter(Boolean);
    return T('mp_next_from', { titles: titles.join(T('mp_and')) });
  }
  function nodeLabel(n) {
    var k = kindLabel(n.kind) + ': ' + words(n);
    if (n.kind === 'learned') return k + '（' + srcName(n.src) + '）';
    if (n.kind === 'unit') return k + '（' + areaName(n) + '）';
    if (isMade(n) && n.date) return k + '（' + n.date + '）';
    return k;
  }

  // ---------- 作ってきたものの絵（作るの入口のカードと同じ選び方。make.js の actArt は公開されていないので同じ順で引く） ----------
  function actArt(a) {
    var M = DES.make;
    if (a.stage && a.stage.kind !== 'note') return MD.art(a.stage);
    var vp = M.visiblePhotos(a);
    if (vp.length) return MD.photoArt(vp[vp.length - 1]);
    if (M.isOdaiExt(a)) { var K = DES.todayData, od = K && a.odaiId ? K.get(a.odaiId) : null; return od ? K.cardArt(od) : MD.photoArt({ theme: M.ODAI_THEME }); }
    var th = MD.theme(a.theme), c = (a.shelf || []).filter(function (x) { return x.kind !== 'note'; })[0];
    return MD.art(c ? M.cardStage(c) : { kind: 'sample', theme: a.theme, variant: th.sample, values: MD.variantValues(a.theme, th.sample) });
  }
  function workArt(w) {
    var art = w && w.art;
    if (art && art.photo) return MD.photoArt(art.photo);
    if (art && art.stage) return MD.art(art.stage);
    return '';
  }
  // 前に作ったものの絵（2 色線画: 墨 + 橙 か 墨 + オリーブ。viewBox は作るの絵と同じ 240×150）
  var INK = '#292c29', OLIVE = '#524e44', ORANGE = '#ed922c', WHITE = '#ffffff';
  function r1(n) { return Math.round(n * 10) / 10; }
  function ln(x1, y1, x2, y2, c, w, ex) { return '<path d="M' + r1(x1) + ' ' + r1(y1) + 'L' + r1(x2) + ' ' + r1(y2) + '" stroke="' + (c || INK) + '" stroke-width="' + (w || 1.2) + '" fill="none" stroke-linecap="round"' + (ex || '') + '/>'; }
  function rc(x, y, w, h, f, ex) { return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + f + '" stroke="' + INK + '" stroke-width="1.3"' + (ex || '') + '/>'; }
  function ci(cx, cy, r, f, ex) { return '<circle cx="' + r1(cx) + '" cy="' + r1(cy) + '" r="' + r1(r) + '" fill="' + f + '" stroke="' + INK + '" stroke-width="1.2"' + (ex || '') + '/>'; }
  function pth(d, f, s, w, ex) { return '<path d="' + d + '" fill="' + (f || 'none') + '" stroke="' + (s || INK) + '" stroke-width="' + (w || 1.3) + '" stroke-linejoin="round" stroke-linecap="round"' + (ex || '') + '/>'; }
  function svgWrap(body) { return '<svg class="mk-art mp-art" viewBox="0 0 240 150" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">' + body + '</svg>'; }
  var PAST_ART = {
    // 雨量計（墨 + オリーブ）: ペットボトルと目もり・たまった水・雨つぶ
    gauge: function () {
      var o = ln(20, 140, 220, 140, OLIVE, 1.2) + pth('M86 26H154L142 44H98Z', WHITE) + pth('M98 44H142V128Q142 136 134 136H106Q98 136 98 128Z', WHITE);
      o += '<rect x="99" y="104" width="42" height="31" fill="' + OLIVE + '" fill-opacity="0.22"/>';
      for (var i = 0; i < 7; i++) o += ln(132, 128 - i * 12, 141, 128 - i * 12, INK, 1);
      [[52, 34], [184, 30], [64, 76], [182, 84], [40, 112]].forEach(function (p) { o += pth('M' + p[0] + ' ' + (p[1] - 8) + 'Q' + (p[0] + 6) + ' ' + p[1] + ' ' + p[0] + ' ' + (p[1] + 5) + 'Q' + (p[0] - 6) + ' ' + p[1] + ' ' + p[0] + ' ' + (p[1] - 8) + 'Z', OLIVE, OLIVE, 1, ' fill-opacity="0.35"'); });
      return svgWrap(o);
    },
    // 防災ポスター（墨 + 橙）: 見出しの帯・道・ひなん場所の印・矢印
    poster: function () {
      var o = rc(62, 14, 116, 124, WHITE, ' rx="5"') + '<rect x="74" y="26" width="92" height="15" rx="3" fill="' + ORANGE + '" fill-opacity="0.85"/>';
      o += ln(76, 62, 164, 62, INK, 1.4) + ln(118, 50, 118, 110, INK, 1.4) + ln(76, 92, 118, 92, INK, 1.4);
      o += pth('M138 92L152 80L166 92V108H138Z', ORANGE, INK, 1.3, ' fill-opacity="0.3"');
      o += ln(86, 104, 126, 100, ORANGE, 2.2) + ln(126, 100, 120, 95, ORANGE, 2.2) + ln(126, 100, 121, 106, ORANGE, 2.2);
      o += ln(76, 122, 164, 122, INK, 1, ' stroke-opacity="0.45"') + ln(76, 129, 140, 129, INK, 1, ' stroke-opacity="0.45"');
      return svgWrap(o);
    },
    // お月見のコマドリ（墨 + 橙）: フィルムのコマに、満ちていく月
    moon: function () {
      var o = rc(14, 42, 212, 66, WHITE, ' rx="4"'), i;
      for (i = 0; i < 9; i++) o += '<rect x="' + (22 + i * 23) + '" y="47" width="10" height="6" rx="1.5" fill="' + INK + '" fill-opacity="0.75"/><rect x="' + (22 + i * 23) + '" y="97" width="10" height="6" rx="1.5" fill="' + INK + '" fill-opacity="0.75"/>';
      for (i = 0; i < 5; i++) {
        var cx = 38 + i * 41, cy = 75, r = 13, t = (i + 1) / 5, rx = r * Math.abs(1 - 2 * t);
        o += ci(cx, cy, r, WHITE);
        o += pth('M' + cx + ' ' + (cy - r) + 'A' + r + ' ' + r + ' 0 0 1 ' + cx + ' ' + (cy + r) + 'A' + r1(rx) + ' ' + r + ' 0 0 ' + (t < 0.5 ? 0 : 1) + ' ' + cx + ' ' + (cy - r) + 'Z', ORANGE, ORANGE, 1, ' fill-opacity="0.55"');
        if (i < 4) o += ln(cx + 17, 116, cx + 25, 116, INK, 1.2) + ln(cx + 25, 116, cx + 21, 113, INK, 1.2) + ln(cx + 25, 116, cx + 21, 119, INK, 1.2);
      }
      return svgWrap(o);
    },
    // ダンボールの貯金箱（墨 + オリーブ）: 箱（正面・上・横）と、お金を入れる口・硬貨
    box: function () {
      var o = ln(20, 140, 220, 140, OLIVE, 1.2) + pth('M66 66H156V134H66Z', OLIVE, INK, 1.3, ' fill-opacity="0.12"');
      o += pth('M66 66L94 42H184L156 66Z', WHITE) + pth('M156 66L184 42V110L156 134Z', OLIVE, INK, 1.3, ' fill-opacity="0.28"');
      o += ln(116, 54, 150, 54, INK, 2.6) + ln(111, 66, 111, 134, OLIVE, 1.2, ' stroke-dasharray="4 3"');
      o += ci(133, 24, 10, WHITE) + ci(133, 24, 5.5, OLIVE, ' fill-opacity="0.3"');
      return svgWrap(o);
    },
    // スクラッチの迷路（墨 + 橙）: かべ・進む道（橙の点線）・キャラ・ゴールの旗
    maze: function () {
      var o = rc(36, 18, 168, 114, WHITE, ' rx="4"');
      o += ln(36, 48, 158, 48, INK, 2) + ln(80, 48, 80, 102, INK, 2) + ln(80, 102, 204, 102, INK, 2) + ln(120, 48, 120, 76, INK, 2) + ln(158, 76, 204, 76, INK, 2);
      o += pth('M56 34H182V62H100V88H186V118', 'none', ORANGE, 2, ' stroke-dasharray="4 4"');
      o += ci(56, 34, 7.5, ORANGE, ' fill-opacity="0.45"') + ln(186, 108, 186, 126, INK, 1.4) + pth('M186 108L198 112L186 116Z', ORANGE, ORANGE, 1, ' fill-opacity="0.8"');
      return svgWrap(o);
    },
    // ビーズのブレスレット（墨 + 橙）: 3 色を 1 組にくり返す輪
    beads: function () {
      var o = pth('M44 75A76 50 0 1 0 196 75A76 50 0 1 0 44 75Z', 'none', INK, 1, ' stroke-opacity="0.5"');
      for (var i = 0; i < 15; i++) {
        var a = (i / 15) * 2 * Math.PI - Math.PI / 2, x = 120 + Math.cos(a) * 76, y = 75 + Math.sin(a) * 50, k = i % 3;
        o += ci(x, y, 8.5, k === 2 ? WHITE : ORANGE, k === 0 ? ' fill-opacity="0.85"' : (k === 1 ? ' fill-opacity="0.3"' : ''));
      }
      return svgWrap(o);
    },
    // 落ち葉のしおり（墨 + 橙）: しおり・ひも・葉・俳句の行
    leaf: function () {
      var o = rc(94, 16, 52, 122, WHITE, ' rx="5"') + ci(120, 30, 4, WHITE) + pth('M120 26Q124 12 138 8', 'none', INK, 1.3);
      o += pth('M120 54Q140 72 120 100Q100 72 120 54Z', ORANGE, ORANGE, 1.4, ' fill-opacity="0.3"') + ln(120 , 58, 120, 104, ORANGE, 1.1);
      o += ln(120, 74, 129, 67, ORANGE, 1) + ln(120, 84, 111, 77, ORANGE, 1);
      o += ln(104, 114, 136, 114, INK, 1, ' stroke-opacity="0.5"') + ln(104, 122, 128, 122, INK, 1, ' stroke-opacity="0.5"');
      return svgWrap(o);
    }
  };
  function nodeArt(n) {
    try {
      if (n.kind === 'act') { var a = find(S().activities, n.actId); return a ? actArt(a) : ''; }
      if (n.kind === 'work') return workArt(find(S().works, n.workId));
      if (n.kind === 'past') return PAST_ART[n.art] ? PAST_ART[n.art]() : '';
    } catch (e) { /* 絵が描けない古い記録は絵なしで出す */ }
    return '';
  }

  // ---------- 見出し + タブ（§Y-1）+ 見方（§AB-1） ----------
  function viewHash(v) { return v === 'fields' ? '#map/fields' : (v === 'list' ? '#map/list' : '#map'); }
  function head(tab, view) {
    var tabs = H('div', { class: 'studio-tabs mp-tabs' }, [H('div', { class: 'segmented', role: 'group', 'aria-label': T('mp_tabs_label') }, ['links', 'basics'].map(function (k) {
      var on = k === tab;
      return H('button', { type: 'button', class: on ? 'active' : null, 'data-action': 'mp-tab', 'data-arg': k, 'aria-current': on ? 'page' : null }, T(k === 'links' ? 'mp_tab_links' : 'mp_tab_basics'));
    }))]);
    var views = tab !== 'links' ? null : H('div', { class: 'mp-views' }, [H('div', { class: 'segmented', role: 'group', 'aria-label': T('mp_view_label') }, VIEWS.map(function (v) {
      var on = v === view;
      return H('button', { type: 'button', class: on ? 'active' : null, 'data-action': 'mp-view', 'data-arg': v, 'aria-current': on ? 'page' : null }, T('mp_view_' + v));
    }))]);
    return [
      H('div', { class: 'page-head mp-head' }, [H('div', null, [H('h1', { tabindex: '-1', 'data-fk': 'mp-h' }, T('map')), H('p', null, T('mp_head_sub'))])]),
      H('div', { class: 'mp-bar' }, [tabs, views])
    ];
  }

  // ---------- 線の見本（凡例とチップの中。色だけに頼らず形で分ける: 実線 細 / 実線 太 / 点線 / 二重 / 破線） ----------
  function swatch(k) {
    var d = 'M2 6H30', body = k === 'cross' ? '<path class="o" d="' + d + '"/><path class="i" d="' + d + '"/>' : '<path d="' + d + '"/>';
    return DES.raw('<svg class="mp-sw k-' + k + '" viewBox="0 0 32 12" aria-hidden="true" focusable="false">' + body + '</svg>');
  }
  function chipsBar() {
    var u = mapUi();
    return H('div', { class: 'mp-chipbar' }, [
      H('div', { class: 'opt-chips mp-chips', role: 'group', 'aria-label': T('mp_chips_label') }, CHIPS.map(function (k) {
        return H('button', { type: 'button', class: 'opt-chip mp-chip', 'data-action': 'mp-chip', 'data-arg': k, 'aria-pressed': u.chips[k] ? 'true' : 'false' }, [swatch(k), H('span', null, T('mp_k_' + k))]);
      })),
      H('p', { class: 'mp-legend-base' }, [swatch('base'), H('span', null, T('mp_k_base'))])
    ]);
  }

  // ---------- 地図（§AB-2）: 枠 > 動く板（線の SVG・島・ノード）+ 右下の操作 + 詳細パネル ----------
  function svgEl(tag, at) { var e = document.createElementNS(SVGNS, tag); Object.keys(at).forEach(function (k) { e.setAttribute(k, at[k]); }); return e; }
  var EDGE_RANK = { base: 0, mu: 0, order: 1, next: 2, peer: 3, cross: 4 };
  var BEND = { peer: 0.16, order: -0.12, cross: 0.12, next: -0.14 };
  function pathD(e, a, b) {
    var x1 = a.x + a.w / 2, y1 = a.y + a.h / 2, x2 = b.x + b.w / 2, y2 = b.y + b.h / 2;
    if (!BEND[e.kind]) return 'M' + x1 + ' ' + y1 + 'L' + x2 + ' ' + y2;
    var mx = (x1 + x2) / 2, my = (y1 + y2) / 2, dx = x2 - x1, dy = y2 - y1;
    return 'M' + x1 + ' ' + y1 + 'Q' + r1(mx - dy * BEND[e.kind]) + ' ' + r1(my + dx * BEND[e.kind]) + ' ' + x2 + ' ' + y2;
  }
  function edgesSvg(g, L, view) {
    var b = L.bounds, svg = svgEl('svg', { class: 'mp-edges', width: b.w, height: b.h, viewBox: '0 0 ' + b.w + ' ' + b.h, 'aria-hidden': 'true', focusable: 'false' });
    edgesIn(g, view).slice().sort(function (x, y) { return EDGE_RANK[x.kind] - EDGE_RANK[y.kind]; }).forEach(function (e) {
      var a = L.nodes[e.from], c = L.nodes[e.to];
      if (!a || !c) return;
      var d = pathD(e, a, c);
      if (e.kind === 'cross') {
        var gr = svgEl('g', { class: 'mp-e k-cross', 'data-edge': e.id });
        gr.appendChild(svgEl('path', { class: 'o', d: d }));
        gr.appendChild(svgEl('path', { class: 'i', d: d }));
        svg.appendChild(gr);
      } else svg.appendChild(svgEl('path', { class: 'mp-e k-' + (e.kind === 'mu' ? 'base' : e.kind), 'data-edge': e.id, d: d }));
    });
    return svg;
  }
  function band(u, mini) {
    var pr = progress(u, MPD.progress);
    return H('span', { class: 'mp-band' + (mini ? ' is-mini' : ''), role: 'img', 'aria-label': T('mp_band_label', { total: pr.total, done: pr.done, p: pr.practiceOnly, e: pr.explainOnly }) }, u.items.map(function (it) {
      var v = MPD.itemProgress(MPD.progress, it.id);
      return H('span', { class: 'mp-sq' + (v.practice ? ' p' : '') + (v.explain ? ' e' : '') });
    }));
  }
  function nodeCls(n) {
    return 'mp-n is-' + (isMade(n) ? 'made' : n.kind) + (n.kind === 'work' ? ' is-work' : '') + (n.kind === 'past' ? ' is-past' : '') + (n.kind === 'unit' && !n.material ? ' is-ext' : '');
  }
  function mapNode(g, n, b, view) {
    var kids = [], st = '--x:' + b.x + 'px;--y:' + b.y + 'px;--w:' + b.w + 'px;--h:' + b.h + 'px';
    if (isMade(n)) {
      var art = nodeArt(n);
      kids.push(H('span', { class: 'mp-thumb', 'aria-hidden': 'true' }, art ? [DES.raw(art)] : null));
      kids.push(H('span', { class: 'mp-label' }, words(n)));
      kids.push(H('span', { class: 'mp-sub' }, madeSub(n)));
    } else if (n.kind === 'learned') {
      kids.push(H('span', { class: 'mp-t' }, pick(n.text)), H('span', { class: 'mp-scene' }, [srcChip(n.src), H('span', null, sceneText(n.scene))]));
    } else if (n.kind === 'unit') {
      if (view !== 'fields') kids.push(H('span', { class: 'mp-eb' }, unitHead(n)));
      kids.push(H('span', { class: 'mp-t' }, pick(n.name)));
      if (view === 'fields' && n.material) { var u = MPD.unit(n.code); kids.push(H('span', { class: 'mp-bandrow' }, [band(u, true), H('span', { class: 'mp-pct' }, progress(u, MPD.progress).pct + '%')])); }
      kids.push(H('span', { class: 'mp-sub' }, basicLine(n)));
    } else {
      kids.push(H('span', { class: 'mp-t' }, pick(n.title)), H('span', { class: 'mp-chips' }, [srcChip('buddy')]));
    }
    return H('button', { type: 'button', class: nodeCls(n), style: st, 'data-action': 'mp-sel', 'data-id': n.id, 'data-arg': 'map', 'aria-pressed': 'false', 'aria-label': nodeLabel(n) }, kids);
  }
  // Tab の順: 作ったもの → その学んだこと → その単元 …（分野で見る: 島の順に単元 → 作ったもの）→ これから作れそうなもの
  function nodeOrder(g, view) {
    var out = [], seen = {}, vn = viewNodes(g, view);
    function add(n) { if (n && vn[n.id] && !seen[n.id]) { seen[n.id] = true; out.push(n); } }
    if (view === 'fields') {
      g.islands.forEach(function (s) { s.units.forEach(function (id) { add(nodeById(g, id)); }); });
      g.nodes.made.forEach(add);
    } else {
      g.nodes.made.forEach(function (m) {
        add(m);
        m.learned.forEach(function (lid) { var l = nodeById(g, lid); add(l); l.units.forEach(function (c) { add(nodeById(g, 'unit:' + c)); }); });
      });
    }
    g.nodes.next.forEach(add);
    allNodes(g).forEach(add);
    return out;
  }
  function detailSection() {
    return H('section', { class: 'mp-detail', 'aria-labelledby': 'mp-detail-h', hidden: true }, [
      H('div', { class: 'mp-dhead' }, [
        H('div', { class: 'mp-dtitle' }, [H('p', { class: 'eyebrow mp-kind' }), H('h2', { id: 'mp-detail-h', 'aria-live': 'polite' })]),
        H('button', { type: 'button', class: 'icon-btn mp-dclose', 'data-action': 'mp-close', 'aria-label': T('close') }, [icon('close')])
      ]),
      H('div', { class: 'mp-detail-body' })
    ]);
  }
  function buildMapPage(view, g, L) {
    var kids = head('links', view);
    kids.push(chipsBar());
    var vp = H('div', { class: 'mp-vp', style: 'width:' + L.bounds.w + 'px;height:' + L.bounds.h + 'px' });
    vp.appendChild(edgesSvg(g, L, view));
    if (view === 'fields') L.islands.forEach(function (s) {
      var gi = find(g.islands, s.id);
      if (!gi) return;
      vp.appendChild(H('div', { class: 'mp-isl', 'aria-hidden': 'true', 'data-isl': s.id, style: '--x:' + s.x + 'px;--y:' + s.y + 'px;--w:' + s.w + 'px;--h:' + s.h + 'px' },
        [H('span', { class: 'mp-isl-name' }, T('mp_island', { subject: pick(gi.subject), area: pick(gi.name) }))]));
    });
    nodeOrder(g, view).forEach(function (n) { var b = L.nodes[n.id]; if (b) vp.appendChild(mapNode(g, n, b, view)); });
    var frame = H('div', { class: 'mp-frame', tabindex: '0', role: 'region', 'aria-label': T('mp_frame_label'), 'aria-describedby': 'mp-frame-hint', 'data-lod': 'mid', 'data-view': view, 'data-fk': 'mp-frame' }, [
      vp,
      H('div', { class: 'mp-ctrl', role: 'group', 'aria-label': T('mp_ctrl_label') }, [
        H('button', { type: 'button', class: 'btn mp-zbtn', 'data-action': 'mp-zoom', 'data-arg': 'in', 'aria-label': T('mp_zoom_in') }, [H('span', { 'aria-hidden': 'true' }, '＋')]),
        H('button', { type: 'button', class: 'btn mp-zbtn', 'data-action': 'mp-zoom', 'data-arg': 'out', 'aria-label': T('mp_zoom_out') }, [H('span', { 'aria-hidden': 'true' }, '−')]),
        H('button', { type: 'button', class: 'btn mp-fit', 'data-action': 'mp-zoom', 'data-arg': 'fit' }, T('mp_fit'))
      ]),
      detailSection()
    ]);
    kids.push(frame, H('p', { id: 'mp-frame-hint', class: 'sr-only' }, T('mp_frame_hint')));
    return H('div', { class: 'map-page is-map', 'data-view': view }, kids);
  }

  // ---------- 表示位置（§AB-2）: 動かすのは板の transform だけ。倍率で枠の data-lod と --inv（縮小に合わせて逆に拡大する字）を変える ----------
  function r4(n) { return Math.round(n * 10000) / 10000; }
  function applyView(page, v, smooth) {
    var frame = page.querySelector('.mp-frame'), vp = frame && frame.querySelector('.mp-vp');
    if (!vp) return;
    v = { x: v.x, y: v.y, z: MPC.clampZoom(v.z) };
    page._v = v;
    var anim = !!smooth && motionOK();
    vp.classList.toggle('is-anim', anim);
    if (anim) { clearTimeout(page._animT); page._animT = setTimeout(function () { vp.classList.remove('is-anim'); }, 260); }
    vp.style.transform = 'translate(' + r4(v.x) + 'px,' + r4(v.y) + 'px) scale(' + r4(v.z) + ')';
    frame.style.setProperty('--inv', String(r4(1 / v.z)));
    var lod = MPC.lod(v.z);
    if (frame.getAttribute('data-lod') !== lod) frame.setAttribute('data-lod', lod);
  }
  var posT = null;
  function savePos(view, v) {
    var u = mapUi();
    if (!u.pos) u.pos = { made: null, fields: null };
    u.pos[view] = { x: Math.round(v.x * 10) / 10, y: Math.round(v.y * 10) / 10, z: r4(v.z) };
    clearTimeout(posT);
    posT = setTimeout(function () {
      if (!DES.store.save('mapUi')) { S().saveFailed = true; DES.app.renderSaveState(); }
    }, 200);
  }
  // 枠の高さ = ページの残りの高さいっぱい（最小 420px。≤ 700 は下タブ帯の分を除く）
  function sizeFrame(frame) {
    if (!frame || !frame.isConnected) return;
    var top = frame.getBoundingClientRect().top + (window.scrollY || window.pageYOffset || 0);
    var h = Math.max(420, Math.round(window.innerHeight - top - (narrow() ? 56 + 14 : 24)));
    if (frame._h !== h) { frame._h = h; frame.style.height = h + 'px'; }
  }
  // 詳細パネルで隠れている分（≥ 1024 = 右 / それ未満 = 下のシート）
  function inset(frame) {
    var d = frame.querySelector('.mp-detail'), o = { l: 16, t: 16, r: 16, b: 16 };
    if (!d || d.hidden) return o;
    var fr = frame.getBoundingClientRect(), dr = d.getBoundingClientRect();
    if (wide()) o.r = Math.max(16, fr.right - dr.left + 16);
    else o.b = Math.max(16, fr.bottom - dr.top + 16);
    return o;
  }
  function frameSize(frame) { return { w: frame.clientWidth, h: frame.clientHeight }; }
  // そのノードが枠の中（パネルで隠れていない所）に入るよう地図を動かす
  function revealNode(page, id, smooth) {
    var frame = page.querySelector('.mp-frame'), L = page._L, b = L && L.nodes[id];
    if (!frame || !b || !page._v) return;
    // far の作ったものは、逆に拡大した題（絵の下・画面で 150px 幅・2 行）まで入るように
    var z = page._v.z;
    if (/^(act|work|past):/.test(id) && MPC.lod(z) === 'far') {
      var lw = Math.max(b.w, 150 / z);
      b = { x: b.x + b.w / 2 - lw / 2, y: b.y, w: lw, h: Math.max(b.h, 110 + (2 * 13 * 1.3 + 6) / z) };
    }
    var fs = frameSize(frame), nv = MPC.reveal(page._v, b, fs.w, fs.h, inset(frame));
    if (Math.abs(nv.x - page._v.x) < 0.5 && Math.abs(nv.y - page._v.y) < 0.5) return;
    applyView(page, nv, smooth);
    savePos(page.getAttribute('data-view'), page._v);
  }
  function unwatch() { var u = ui(); if (u.ro) { u.ro.disconnect(); u.ro = null; } }
  function mountMap(page, view, keepV) {
    var frame = page.querySelector('.mp-frame'), L = page._L;
    sizeFrame(frame);
    var fs = frameSize(frame), saved = keepV || mapUi().pos[view];
    applyView(page, saved ? MPC.clampView(saved, L.bounds, fs.w, fs.h) : MPC.fit(L.bounds, fs.w, fs.h, 20), false);
    var api = {
      view: function () { return page._v; },
      apply: function (v, smooth) { applyView(page, v, smooth); },
      commit: function () { savePos(view, page._v); },
      fit: function (smooth) { var s = frameSize(frame); applyView(page, MPC.fit(L.bounds, s.w, s.h, 20), smooth); savePos(view, page._v); },
      keyCenter: function (el) {
        var n = el && el.closest ? el.closest('.mp-n') : null, b = n ? L.nodes[n.getAttribute('data-id')] : null, v = page._v;
        return b ? { x: (b.x + b.w / 2) * v.z + v.x, y: (b.y + b.h / 2) * v.z + v.y } : null;
      }
    };
    page._api = api;
    MPC.attach(frame, api);
    // Tab でたどったノードは枠の中へ
    frame.addEventListener('focusin', function (e) {
      var n = e.target && e.target.closest ? e.target.closest('.mp-n') : null;
      if (n && frame.contains(n)) revealNode(page, n.getAttribute('data-id'), true);
    });
    // 何もない所を押す = 選択を外す
    frame.addEventListener('click', function (e) {
      if (e.defaultPrevented || !e.target || !e.target.closest) return;
      if (e.target.closest('.mp-n, .mp-ctrl, .mp-detail, button, a')) return;
      if (mapUi().sel[view]) closeSel(view, null);
    });
    unwatch();
    if (window.ResizeObserver) {
      var u = ui(), last = fs;
      u.ro = new ResizeObserver(function () {
        var s = frameSize(frame);
        if (!frame.isConnected || (s.w === last.w && s.h === last.h)) return;
        last = s;
        applyView(page, MPC.clampView(page._v, L.bounds, s.w, s.h), false);
      });
      u.ro.observe(frame);
    }
  }

  // ---------- 詳細パネル（§AB-6）。見出しは aria-live。フォーカスは奪わない ----------
  function relBtn(g, id, view, extra) {
    var n = nodeById(g, id);
    if (!n) return null;
    var label = [H('span', { class: 'mp-rel-k' }, kindLabel(n.kind)), H('span', { class: 'mp-rel-t' }, words(n))].concat(extra || []);
    if (!viewNodes(g, view)[id]) return H('span', { class: 'mp-rel is-static' }, label);
    return H('button', { type: 'button', class: 'mp-rel', 'data-action': 'mp-sel', 'data-id': id, 'data-arg': 'rel' }, label);
  }
  function sec(title, kids) { return H('section', { class: 'mp-dsec' }, [H('h3', { class: 'mp-rel-h' }, title)].concat(kids)); }
  function relList(items) { return H('ul', { class: 'mp-rel-list' }, items.filter(Boolean).map(function (x) { return H('li', null, Array.isArray(x) ? x : [x]); })); }
  function detailBody(g, n, view) {
    var kids = [], ops = [];
    if (!n) return kids;
    if (isMade(n)) {
      var art = nodeArt(n);
      if (art) kids.push(H('div', { class: 'mp-dart', 'aria-hidden': 'true' }, [DES.raw(art)]));
      if (madeSub(n)) kids.push(H('p', { class: 'mp-sub' }, madeSub(n)));
      var lns = n.learned.map(function (id) { return nodeById(g, id); });
      kids.push(sec(T('mp_col_learned'), lns.length ? [relList(lns.map(function (l) {
        var row = [relBtn(g, l.id, view), H('p', { class: 'mp-scene-line' }, [srcChip(l.src), H('span', null, sceneText(l.scene))])];
        if (l.src === 'buddy') row.push(btn(T('decline'), 'mp-decline', { id: l.id, kls: 'ghost' }));
        return row;
      }))] : [H('p', { class: 'mp-none' }, T('mp_learned_none'))]));
      if (n.units.length) kids.push(sec(T('mp_col_units'), [relList(n.units.map(function (c) { return relBtn(g, 'unit:' + c, view); }))]));
      var ps = peers(g, n.id);
      kids.push(sec(T('mp_d_peers'), ps.length ? [relList(ps.map(function (p) {
        var m = nodeById(g, p.id);
        return [relBtn(g, p.id, view, m && m.date ? [H('span', { class: 'mp-rel-d' }, m.date)] : null), H('p', { class: 'mp-same' }, sameLine(p.units))];
      }))] : [H('p', { class: 'mp-none' }, T('mp_peers_none'))]));
      // 活動のある作ってきたものは「続きを作る」、活動の無いもの（作品だけ）は今のまま「これで作る」（§AA-4）。前に作ったものは「バディと話す」だけ（§AB-9）
      if (n.kind === 'act' || n.kind === 'work') ops.push(btn(T(n.kind === 'act' ? 'resume_make' : 'mp_make_this'), 'mp-make', { id: n.id, kls: 'orange', icon: 'make', disabled: n.kind === 'work', title: T('story_lost') }));
      ops.push(btn(T('mp_talk'), 'mp-talk', { id: n.id, icon: 'chat' }));
    } else if (n.kind === 'learned') {
      kids.push(H('p', { class: 'mp-scene-line' }, [srcChip(n.src), H('span', null, sceneText(n.scene))]));
      kids.push(sec(T('mp_d_from'), [relList([relBtn(g, n.madeId, view)])]));
      if (n.units.length) kids.push(sec(T('mp_d_to'), [relList(n.units.map(function (c) { return relBtn(g, 'unit:' + c, view); }))]));
      ops.push(btn(T('mp_talk'), 'mp-talk', { id: n.id, icon: 'chat' }));
      if (n.src === 'buddy') ops.push(btn(T('decline'), 'mp-decline', { id: n.id, kls: 'ghost' }));
    } else if (n.kind === 'unit') {
      kids.push(H('p', { class: 'mp-where' }, T('mp_unit_where_all', { subject: pick(n.subject), grade: n.grade, area: areaName(n) })));
      if (n.material) { var u = MPD.unit(n.code); kids.push(H('div', { class: 'mp-ubar' }, [band(u), H('span', { class: 'mp-pct' }, progress(u, MPD.progress).pct + '%')])); }
      kids.push(H('p', { class: 'mp-sub' }, basicLine(n)));
      kids.push(sec(T('mp_d_from'), n.made.length ? [relList(n.made.map(function (id) { return relBtn(g, id, view); }))] : [H('p', { class: 'mp-none' }, T('mp_links_none'))]));
      var before = [], after = [], cross = [];
      g.edges.forEach(function (e) {
        if (e.kind === 'order' && e.to === n.id) before.push(e.from);
        if (e.kind === 'order' && e.from === n.id) after.push(e.to);
        if (e.kind === 'cross' && (e.from === n.id || e.to === n.id)) cross.push(e);
      });
      if (before.length || after.length) {
        var ord = [];
        if (before.length) ord.push(H('p', { class: 'mp-ord-k' }, T('mp_d_before')), relList(before.map(function (id) { return relBtn(g, id, view); })));
        if (after.length) ord.push(H('p', { class: 'mp-ord-k' }, T('mp_d_after')), relList(after.map(function (id) { return relBtn(g, id, view); })));
        kids.push(sec(T('mp_k_order'), ord));
      }
      if (cross.length) kids.push(sec(T('mp_k_cross'), [relList(cross.map(function (e) {
        return [relBtn(g, e.from === n.id ? e.to : e.from, view), e.why ? H('p', { class: 'mp-same' }, pick(e.why)) : null];
      }))]));
      // 算数は「基礎学習で見る」、他教科は教材がこれからの 1 文（リンクなし）
      if (n.material) ops.push(H('a', { class: 'btn small orange', href: '#map/u/' + n.code, 'data-action': 'mp-unit', 'data-id': n.code }, [H('span', null, T('mp_see_basic'))]));
      ops.push(btn(T('mp_talk'), 'mp-talk', { id: n.id, icon: 'chat' }));
    } else if (n.kind === 'next') {
      kids.push(H('p', { class: 'mp-scene-line' }, [srcChip('buddy'), H('span', null, nextFrom(g, n))]));
      if (n.line) kids.push(H('p', { class: 'mp-nline' }, pick(n.line)));
      ops.push(btn(T('mp_make_this'), 'mp-make-next', { id: n.id, kls: 'orange', icon: 'make' }));
      ops.push(btn(T('decline'), 'mp-decline-next', { id: n.id, kls: 'ghost' }));
    }
    kids.push(H('div', { class: 'mp-ops' }, ops));
    return kids;
  }
  function fillDetail(sec0, g, n, view) {
    sec0.querySelector('.mp-kind').textContent = n ? kindLabel(n.kind) : '';
    sec0.querySelector('#mp-detail-h').textContent = n ? words(n) : '';
    sec0.replaceChild(H('div', { class: 'mp-detail-body' }, detailBody(g, n, view)), sec0.querySelector('.mp-detail-body'));
  }

  // ---------- 選択・チップの反映（作り直さずに書き換える: 濃淡は 150ms で入れ替わり、フォーカスと見出しの aria-live を保つ） ----------
  function applyState(page, g, view) {
    var u = mapUi(), sel = u.sel[view], rel = sel ? related(g, sel) : null, rn = {}, re = {};
    if (rel) { rel.nodes.forEach(function (id) { rn[id] = true; }); rel.edges.forEach(function (id) { re[id] = true; }); }
    Array.prototype.forEach.call(page.querySelectorAll('.mp-n[data-id], .mp-node[data-id]'), function (b) {
      var id = b.getAttribute('data-id');
      b.setAttribute('aria-pressed', id === sel ? 'true' : 'false');
      b.classList.toggle('is-on', !!sel && (id === sel || !!rn[id]));
    });
    Array.prototype.forEach.call(page.querySelectorAll('.mp-e'), function (p) { p.classList.toggle('is-on', !!re[p.getAttribute('data-edge')]); });
    Array.prototype.forEach.call(page.querySelectorAll('[data-action="mp-chip"]'), function (c) { c.setAttribute('aria-pressed', u.chips[c.getAttribute('data-arg')] ? 'true' : 'false'); });
    var frame = page.querySelector('.mp-frame');
    if (frame) {
      frame.classList.toggle('has-sel', !!sel);
      CHIPS.forEach(function (k) { frame.classList.toggle('c-' + k, !!u.chips[k]); });
    }
    var d = page.querySelector('.mp-detail');
    if (!d) return;
    var n = sel ? nodeById(g, sel) : null, card = null;
    if (view === 'list' && n) {
      var cs = page.querySelectorAll('.mp-card-li'), i;
      for (i = 0; i < cs.length && !card; i++) if (cs[i].getAttribute('data-card') === ui().selCard && cs[i].querySelector('.mp-node[data-id="' + esc(sel) + '"]')) card = cs[i];
      for (i = 0; i < cs.length && !card; i++) if (cs[i].querySelector('.mp-node[data-id="' + esc(sel) + '"]')) card = cs[i];
    }
    var dk = (sel || '') + '|' + (card ? card.getAttribute('data-card') : '');
    if (page._dk !== dk) {
      page._dk = dk;
      if (n) fillDetail(d, g, n, view);
      d.hidden = !n;
      if (view === 'list') {
        d.hidden = !card;
        if (card && d.parentNode !== card) card.appendChild(d);
      }
    }
  }

  // ---------- リスト（§AB-7）: 作ったもの 1 つ = カード 1 枚（学んだこと → 単元、前に作ったものとのつながり）+ これから作れそうなもの ----------
  function listNode(g, n, arg) {
    var kids = [H('span', { class: 'sr-only' }, kindLabel(n.kind) + ': ')];
    if (isMade(n)) {
      var art = nodeArt(n);
      if (art) kids.push(H('span', { class: 'mp-thumb', 'aria-hidden': 'true' }, [DES.raw(art)]));
      kids.push(H('span', { class: 'mp-title' }, words(n)));
      if (madeSub(n)) kids.push(H('span', { class: 'mp-sub' }, madeSub(n)));
    } else if (n.kind === 'learned') {
      kids.push(H('span', { class: 'mp-title' }, pick(n.text)), H('span', { class: 'mp-scene' }, sceneText(n.scene)), H('span', { class: 'mp-chips' }, [srcChip(n.src)]));
    } else if (n.kind === 'unit') {
      kids.push(H('span', { class: 'mp-title' }, unitFull(n)), H('span', { class: 'mp-sub' }, basicLine(n)));
    } else {
      kids.push(H('span', { class: 'mp-title' }, pick(n.title)), H('span', { class: 'mp-chips' }, [srcChip('buddy')]));
    }
    var cls = 'mp-node is-' + (isMade(n) ? 'act' : n.kind) + (n.kind === 'unit' && !n.material ? ' is-ext' : '') + (n.kind === 'next' ? ' is-next' : '');
    return H('button', { type: 'button', class: cls, 'data-action': 'mp-sel', 'data-id': n.id, 'data-arg': arg, 'aria-pressed': 'false' }, kids);
  }
  function arrowDown() { return H('span', { class: 'mp-arrow', 'aria-hidden': 'true' }, [icon('down')]); }
  function buildList(g) {
    var kids = head('links', 'list');
    if (!g.nodes.made.length) {
      kids.push(H('div', { class: 'mp-empty' }, [H('p', { class: 'empty-line' }, T('mp_empty')), H('p', null, [H('a', { class: 'link-btn', href: '#make' }, [icon('make'), H('span', null, T('mp_to_make'))])])]));
      return H('div', { class: 'map-page', 'data-view': 'list' }, kids);
    }
    kids.push(H('ol', { class: 'mp-cards' }, g.nodes.made.map(function (m) {
      var ck = 'c:' + m.id;
      var chain = m.learned.map(function (lid) {
        var l = nodeById(g, lid), row = [listNode(g, l, ck)];
        if (l.units.length) row.push(arrowDown());
        l.units.forEach(function (c) { row.push(listNode(g, nodeById(g, 'unit:' + c), ck + '|' + lid)); });
        return H('li', { class: 'mp-chain-item' }, row);
      });
      var ps = peers(g, m.id);
      var card = [listNode(g, m, ck), chain.length ? H('ul', { class: 'mp-chain' }, chain) : H('p', { class: 'mp-none' }, T('mp_learned_none'))];
      if (ps.length) card.push(H('div', { class: 'mp-peers' }, [H('p', { class: 'mp-rel-h' }, T('mp_d_peers')), H('ul', { class: 'mp-rel-list' }, ps.map(function (p) {
        return H('li', null, [listNode(g, nodeById(g, p.id), ck + '|peer'), H('p', { class: 'mp-same' }, sameLine(p.units))]);
      }))]));
      return H('li', { class: 'mp-card-li', 'data-card': m.id }, [H('div', { class: 'mp-card' }, card)]);
    })));
    if (g.nodes.next.length) {
      kids.push(H('section', { class: 'mp-list-next', 'aria-labelledby': 'mp-ln-h' }, [H('h2', { id: 'mp-ln-h' }, T('mp_kind_next')),
        H('ol', { class: 'mp-cards' }, g.nodes.next.map(function (x) {
          return H('li', { class: 'mp-card-li', 'data-card': x.id }, [H('div', { class: 'mp-card' }, [listNode(g, x, 'c:' + x.id), H('p', { class: 'mp-sub' }, nextFrom(g, x))])]);
        }))]));
    }
    kids.push(detailSection());
    return H('div', { class: 'map-page', 'data-view': 'list' }, kids);
  }

  // ---------- つながりの 3 つの見方の描画 ----------
  function renderLinks(main, view) {
    var g = graphNow(), key = [view, DES.mode(), shape(g)].join('|');
    var page = main.querySelector('.map-page[data-view="' + view + '"]');
    if (!page || page._key !== key) {
      var keepV = page && page._v ? page._v : null;
      unwatch();
      main.textContent = '';
      if (view === 'list') page = buildList(g);
      else {
        var L = layoutOf(view);
        page = buildMapPage(view, g, L);
        page._L = L;
      }
      page._key = key;
      main.appendChild(page);
      if (view !== 'list') mountMap(page, view, keepV);
    } else if (view !== 'list') sizeFrame(page.querySelector('.mp-frame'));
    applyState(page, g, view);
    var u = ui();
    if (u.reveal && view !== 'list') { var id = u.reveal; u.reveal = null; revealNode(page, id, false); }
  }

  // ---------- 基礎学習（§Y-3）: 4 領域を段に・学習指導要領の順で固定。マス = 左 問題 / 右 説明 ----------
  function unitRow(u, linked) {
    var pr = progress(u, MPD.progress);
    return H('li', { class: 'mp-urow' }, [
      H('a', { class: 'mp-uname', href: '#map/u/' + u.code, 'data-fk': 'mp-u:' + u.code }, pick(u.name)),
      H('span', { class: 'mp-ubar' }, [band(u), H('span', { class: 'mp-pct' }, pr.pct + '%')]),
      linked ? H('button', { type: 'button', class: 'mp-linked', 'data-action': 'mp-linked', 'data-id': u.code, 'aria-label': T('mp_linked_mark') + ': ' + pick(u.name) },
        [H('span', { class: 'mp-pill' }, [icon('map'), H('span', null, T('mp_linked_mark'))])]) : null
    ]);
  }
  function renderBasics(main) {
    var g = graphNow(), linked = {}, ov = overall(MPD.units, MPD.progress);
    g.nodes.units.forEach(function (n) { if (n.made.length) linked[n.code] = true; });
    var kids = head('basics');
    var sec0 = [
      H('div', { class: 'mp-prog-head' }, [H('h2', { id: 'mp-prog-h' }, T('mp_progress_h')), H('span', { class: 'mp-overall' }, T('mp_overall', { pct: ov.pct }))]),
      H('p', { class: 'mp-legend' }, [H('span', { class: 'mp-sq p', 'aria-hidden': 'true' }), H('span', { class: 'mp-sq e', 'aria-hidden': 'true' }), H('span', null, T('mp_legend'))])
    ];
    if (isBlank(MPD.units, MPD.progress)) sec0.push(H('p', { class: 'mp-zero' }, T('mp_zero')));
    MPD.areas.forEach(function (area) {
      sec0.push(H('section', { class: 'mp-area', 'aria-labelledby': 'mp-area-' + area.id }, [
        H('h3', { id: 'mp-area-' + area.id }, pick(area.name)),
        H('ul', { class: 'mp-urows' }, MPD.units.filter(function (u) { return u.area === area.id; }).map(function (u) { return unitRow(u, linked[u.code]); }))
      ]));
    });
    sec0.push(H('p', { class: 'mp-scope' }, T('mp_scope_note')));
    kids.push(H('section', { class: 'mp-basics', 'aria-labelledby': 'mp-prog-h' }, sec0));
    unwatch();
    main.textContent = '';
    main.appendChild(H('div', { class: 'map-page', 'data-view': 'basics' }, kids));
  }

  // ---------- 単元（§Y-4）。地図の詳細から開いた時は、戻るリンクがその見方へ（§AB-15） ----------
  function renderUnit(main, u) {
    var g = graphNow(), pr = progress(u, MPD.progress), links = unitLinks(g, u.code), area = MPD.area(u.area), from = ui().unitFrom;
    var items = H('ul', { class: 'mp-items' }, u.items.map(function (it) {
      var v = MPD.itemProgress(MPD.progress, it.id), marks = [];
      if (v.practice) marks.push(H('span', { class: 'chip mp-mark' }, [icon('check'), H('span', null, T('mp_practice_done', { date: v.practice }))]));
      if (v.explain) marks.push(H('span', { class: 'chip mp-mark' }, [icon('check'), H('span', null, T('mp_explain_done', { date: v.explain }))]));
      return H('li', { class: 'mp-item' }, [H('span', { class: 'mp-iname' }, pick(it.name)), marks.length ? H('span', { class: 'mp-marks' }, marks) : null]);
    }));
    var linkKids = links.length ? [H('ul', { class: 'mp-ulinks' }, links.map(function (L) {
      return H('li', null, [
        H('span', { class: 'mp-rel-k' }, kindLabel('learned')), H('button', { type: 'button', class: 'link-btn', 'data-action': 'mp-show', 'data-id': L.learned.id }, pick(L.learned.text)),
        L.made ? H('span', { class: 'mp-rel-k' }, kindLabel(L.made.kind)) : null, L.made ? H('button', { type: 'button', class: 'link-btn', 'data-action': 'mp-show', 'data-id': L.made.id }, words(L.made)) : null
      ]);
    }))] : [H('p', { class: 'mp-none' }, T('mp_links_none'))];
    var backLabel = from ? T('mp_view_' + from) : T('mp_tab_basics');
    unwatch();
    main.textContent = '';
    main.appendChild(H('div', { class: 'map-page mp-unit', 'data-view': 'unit', 'data-unit': u.code }, [
      H('p', { class: 'mp-back' }, [H('a', { class: 'link-btn', href: from ? viewHash(from) : '#map/basics', 'aria-label': from ? T('mp_back_to', { view: backLabel }) : T('mp_back_basics') }, [H('span', { 'aria-hidden': 'true' }, '←'), H('span', null, backLabel)])]),
      H('h1', { tabindex: '-1', 'data-fk': 'mp-uh:' + u.code }, pick(u.name)),
      H('p', { class: 'mp-where' }, T('mp_unit_where', { area: pick(area.name) })),
      H('div', { class: 'mp-ubar is-head' }, [band(u), H('span', { class: 'mp-pct' }, pr.pct + '%')]),
      H('section', { class: 'mp-sec', 'aria-labelledby': 'mp-items-h' }, [H('h2', { id: 'mp-items-h' }, T('mp_items_h')), items]),
      H('section', { class: 'mp-sec', 'aria-labelledby': 'mp-ulinks-h' }, [H('h2', { id: 'mp-ulinks-h' }, T('mp_links_h'))].concat(linkKids)),
      H('div', { class: 'mp-ops' }, [btn(T('mp_start_basic'), 'mp-start', { kls: 'orange', id: 'unit:' + u.code }), btn(T('mp_talk'), 'mp-talk', { id: 'unit:' + u.code, icon: 'chat' })])
    ]));
  }

  // ---------- 描画の入口（app.js から）。引数は '' / 'fields' / 'list' / 'basics' / 'u/<code>'。それ以外は見つからなかった ----------
  function notFound(arg, to) {
    var u = ui();
    if (u.missing !== arg) { u.missing = arg; DES.app.toast(T('mp_not_found')); }
    window.location.replace(to);
  }
  // 描き直しでフォーカスしていた要素が消えたら、同じもの（data-fk → 操作 + id + arg → 操作 + id → href）へ戻す。
  // 幅の切替で app.js が DES.app.render を直接呼ぶ時（APP.commit を通らない）もフォーカスを失わない
  function focusKeyOf(main) {
    var ae = document.activeElement;
    if (!ae || ae === document.body || !main.contains(ae)) return null;
    return { el: ae, fk: ae.getAttribute('data-fk'), action: ae.getAttribute('data-action'), id: ae.getAttribute('data-id'), arg: ae.getAttribute('data-arg'), href: ae.getAttribute('href') };
  }
  function firstShown(main, sel) {
    var list = main.querySelectorAll(sel);
    for (var i = 0; i < list.length; i++) if (!list[i].disabled && list[i].getClientRects().length) return list[i];
    return null;
  }
  function restoreFocus(main, k) {
    if (!k || (k.el.isConnected && document.activeElement === k.el)) return;
    var a = k.action ? '[data-action="' + esc(k.action) + '"]' : null, id = k.id != null ? '[data-id="' + esc(k.id) + '"]' : '', cands = [];
    if (k.fk) cands.push('[data-fk="' + esc(k.fk) + '"]');
    if (a && k.arg != null) cands.push(a + id + '[data-arg="' + esc(k.arg) + '"]');
    // 見方・幅でノードの置き場所（data-arg）が変わる時は、同じノード
    if (a && k.id != null) cands.push(a + id);
    if (k.href) cands.push('a[href="' + esc(k.href) + '"]');
    for (var i = 0; i < cands.length; i++) { var n = firstShown(main, cands[i]); if (n) { n.focus(); return; } }
  }
  MP.render = function (main, arg) {
    var fk = focusKeyOf(main);
    renderView(main, arg);
    restoreFocus(main, fk);
    var u = ui();
    // 開いたら見出しへ（タブ・見方・単元を開いた時も）。同じ画面の描き直しでは動かさない。見つからなかった引数は移った先で
    if (u.redirect) { u.redirect = false; u.lastUnit = null; return; }
    if (u.shown !== (arg || '')) {
      u.shown = arg || '';
      // 単元から戻った時は、開く元になった単元の行（基礎学習）/ 地図・リストのノードへ（作品・お題と同じ。§AA-6 / §AB-15）。元が無ければ h1
      var mu = /^u\/(.+)$/.exec(u.shown), from = u.lastUnit, t = null;
      u.lastUnit = mu ? mu[1] : null;
      if (!mu) u.unitFrom = null;
      if (from && !mu) t = firstShown(main, '[data-fk="mp-u:' + esc(from) + '"]') || firstShown(main, '.mp-n[data-id="unit:' + esc(from) + '"]') || firstShown(main, '.mp-node[data-id="unit:' + esc(from) + '"][aria-pressed="true"]') || firstShown(main, '.mp-node[data-id="unit:' + esc(from) + '"]');
      if (!t) t = main.querySelector('h1');
      if (t) t.focus();
    }
  };
  function viewOfArg(arg) { return !arg ? 'made' : (arg === 'fields' || arg === 'list' ? arg : null); }
  function renderView(main, arg) {
    var u = ui(), m = /^u\/(.+)$/.exec(arg || ''), view = viewOfArg(arg);
    if (m) {
      var un = MPD.unit(m[1]);
      // 教材の無い単元（理科など）・無い code は基礎学習の一覧へ
      if (!un) { renderBasics(main); u.redirect = true; notFound(arg, '#map/basics'); return; }
      renderUnit(main, un);
    } else if (arg === 'basics') renderBasics(main);
    else {
      renderLinks(main, view || 'made');
      if (!view) { u.redirect = true; notFound(arg, '#map'); return; }
      // いま見ている見方を覚える（上のタブ「つながり」で戻る先）。描き直しはしない
      if (mapUi().view !== view) { mapUi().view = view; if (!DES.store.save('mapUi')) { S().saveFailed = true; DES.app.renderSaveState(); } }
    }
  }
  // ルートが変わったら一時的な UI を閉じる（app.js の closeTransient から）
  MP.resetUi = function () {
    var u = ui();
    u.shown = null; u.missing = null; u.selCard = null;
    if (DES.app.route() !== 'map') { u.lastUnit = null; u.unitFrom = null; }
    unwatch();
  };

  // ---------- 保存（失敗したら save_fail + 画面の状態を戻す） ----------
  function saveUi(next) {
    var prev = S().mapUi;
    S().mapUi = next;
    if (!DES.store.save('mapUi')) {
      S().mapUi = prev;
      S().saveFailed = true;
      DES.app.renderSaveState();
      DES.app.render();
      DES.app.toast(T('save_fail'));
      return false;
    }
    S().saveFailed = false;
    return true;
  }
  function setUi(next, o) { if (!saveUi(next)) return false; DES.app.commit(o || {}); return true; }
  function curView() { return DES.app.route() === 'map' ? viewOfArg(DES.app.routeArg()) : null; }
  // 他の画面から、選んだ状態で「作ったものから」を開く（作品の「学びマップで見る」/ 基礎学習の印 / 単元の「作ったものとのつながり」）
  MP.show = function (id) {
    var next = normalizeUi(mapUi(), null);
    next.sel.made = id;
    next.view = 'made';
    if (!saveUi(next)) return;
    ui().selCard = null;
    ui().reveal = id;
    if (window.location.hash !== '#map') window.location.hash = '#map';
    else DES.app.render();
  };
  // 選択を外す（詳細パネルの中にフォーカスがあれば、先にそのノードへ移す）
  function closeSel(view, focusId) {
    var sel = mapUi().sel[view], main = document.getElementById('main');
    if (!sel) return;
    var ae = document.activeElement, inPanel = ae && ae.closest && ae.closest('.mp-detail'), t = focusId || sel;
    if (inPanel || focusId) { var n = firstShown(main, selOf(t)); if (n) n.focus(); }
    setUi(deselect(mapUi(), graphNow(), view), { sel: selOf(t) });
  }

  // ---------- 操作 ----------
  var A = DES.actions = DES.actions || {};
  A['mp-tab'] = function (el) {
    var h = el.getAttribute('data-arg') === 'basics' ? '#map/basics' : viewHash(mapUi().view);
    if (window.location.hash !== h) window.location.hash = h;
  };
  A['mp-view'] = function (el) {
    var v = viewOk(el.getAttribute('data-arg')), h = viewHash(v);
    if (window.location.hash !== h) window.location.hash = h;
  };
  // 選ぶ / もう一度で外す。詳細の中のつながりから選んだ時は、そのノードへフォーカスを移して枠の中へ
  A['mp-sel'] = function (el) {
    var view = curView(), id = el.getAttribute('data-id'), arg = el.getAttribute('data-arg') || '', g = graphNow();
    if (!view || !viewNodes(g, view)[id]) return;
    ui().selCard = arg.indexOf('c:') === 0 ? arg.slice(2).split('|')[0] : null;
    var next = select(mapUi(), g, view, id);
    if (arg === 'rel') next.sel[view] = id;
    if (!setUi(next, { sel: arg === 'rel' ? selOf(id) : null })) return;
    if (arg === 'rel') { var n = firstShown(document.getElementById('main'), selOf(id)); if (n) n.focus(); }
    var page = document.querySelector('.map-page.is-map');
    if (page && next.sel[view]) revealNode(page, id, true);
  };
  A['mp-close'] = function () { var v = curView(); if (v) closeSel(v, null); };
  A['mp-chip'] = function (el) {
    var k = el.getAttribute('data-arg'), next = normalizeUi(mapUi(), null);
    if (CHIPS.indexOf(k) < 0) return;
    next.chips[k] = !next.chips[k];
    setUi(next);
  };
  A['mp-zoom'] = function (el) {
    var page = document.querySelector('.map-page.is-map'), api = page && page._api, k = el.getAttribute('data-arg');
    if (!api) return;
    if (k === 'fit') { api.fit(true); return; }
    var f = page.querySelector('.mp-frame');
    api.apply(MPC.zoomAt(api.view(), k === 'in' ? MPC.KEY_STEP : 1 / MPC.KEY_STEP, f.clientWidth / 2, f.clientHeight / 2), true);
    api.commit();
  };
  // 違う（バディの見立てだけ）: ノードと線が消える → トースト「外したよ」+「元に戻す」5 秒
  A['mp-decline'] = function (el) {
    var view = curView() || 'made', id = el.getAttribute('data-id'), g = graphNow(), before = mapUi().sel[view], next = decline(mapUi(), g, view, id), n = nodeById(g, id);
    if (!next || !setUi(next, { sel: selOf(next.sel[view] || n.madeId) })) return;
    DES.app.toast(T('removed_toast'), { label: T('undo_restore'), fn: function () { setUi(undecline(mapUi(), view, n.learnedId, before), { sel: selOf(before || id) }); } });
  };
  // これから作れそうなものの「違う」: 地図から外す → トースト + 元に戻す
  A['mp-decline-next'] = function (el) {
    var view = curView() || 'made', id = el.getAttribute('data-id'), g = graphNow(), before = mapUi().sel[view], n = nodeById(g, id), next = declineNext(mapUi(), g, view, id);
    if (!next) return;
    var src = n.learned[0] || null;
    if (!setUi(next, { sel: src ? selOf(src) : null, focus: 'mp-frame' })) return;
    var main = document.getElementById('main'), f = src && firstShown(main, selOf(src)) || firstShown(main, '[data-fk="mp-frame"]');
    if (f && (!document.activeElement || document.activeElement === document.body || !document.activeElement.isConnected)) f.focus();
    DES.app.toast(T('removed_toast'), { label: T('undo_restore'), fn: function () { setUi(undeclineNext(mapUi(), view, n.nextId, before), { sel: selOf(id) }); } });
  };
  // 活動の「続きを作る」: 活動の今の状態で作業台を開く（巻き戻さない。作品の「続きを作る」と同じ）
  A['mp-make'] = function (el) {
    var n = nodeById(graphNow(), el.getAttribute('data-id'));
    if (n && n.kind === 'act') DES.make.openAct(n.actId);
  };
  // これから作れそうなものの「これで作る」: 作るの「思いつきから」と同じ入口で活動を作り、作業台へ
  A['mp-make-next'] = function (el) {
    var n = nodeById(graphNow(), el.getAttribute('data-id'));
    if (n && n.kind === 'next') DES.make.fromIdea(pick(n.title));
  };
  // バディと話す: 既存の DES.talk.prefill（title = ノードの言葉）
  A['mp-talk'] = function (el) { var w = wordsOf(el.getAttribute('data-id')); if (w) DES.talk.prefill(w); };
  // 詳細の「基礎学習で見る」: どの見方から開いたかを覚えて単元へ（戻るでその見方・そのノードへ）
  A['mp-unit'] = function (el) {
    ui().unitFrom = curView();
    var h = '#map/u/' + el.getAttribute('data-id');
    if (window.location.hash !== h) window.location.hash = h;
  };
  A['mp-linked'] = function (el) { MP.show('unit:' + el.getAttribute('data-id')); };
  A['mp-show'] = function (el) { MP.show(el.getAttribute('data-id')); };
  A['mp-start'] = function () { DES.app.toast(T('mp_start_toast')); };

  // Esc で選択を外す（フォーカスはそのノードに残す）。窓の高さが変わったら枠の高さも
  MP.bind = function () {
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      var view = curView();
      if (!view || document.querySelector('dialog[open]') || !mapUi().sel[view]) return;
      e.preventDefault();
      closeSel(view, null);
    });
    window.addEventListener('resize', function () { if (curView()) sizeFrame(document.querySelector('.mp-frame')); });
  };
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
