/* 学びマップ（#map つながり / #map/basics 基礎学習 / #map/u/<code> 単元）: CONTRACT-v3 §Y（§I の「#map は空状態 1 文」を置き換え）。
   つながり = 作ってきたもの（活動 1 つ = ノード 1 つ）→ そこで学んだこと（手がかり。記録 1 つを場面として必ず伴う）→ つながる単元。
   基礎学習 = 算数 4 年の一覧図（4 領域・学習指導要領の順・マスは 左 = 問題ができた / 右 = 説明できた）。
   学んだことは判定ではなく手がかり。段階・ゲージの語にしない。本人の操作で変わるのは des3.mapUi（選択・外したバディの見立て）だけ。
   純関数（MP.progress / overall / graph / related / defaultSel / normalizeUi / unitLinks …）は DOM と DES.t に触れず、
   node からも読める（tools/map-test.js）。変更は DES.store.save('mapUi') → DES.app.commit の 1 経路（失敗したら画面の状態を戻す）。 */
(function (root) {
  'use strict';
  var DES = root.DES = root.DES || {};
  var MPD = DES.mapData || (typeof require === 'function' ? require('./map-data.js') : null);
  var MP = DES.map = DES.map || {};
  var SRC = ['own', 'person', 'buddy'];

  // ---------- 小道具 ----------
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function find(list, id) { for (var i = 0; i < (list || []).length; i++) if (list[i] && list[i].id === id) return list[i]; return null; }
  function trim(v) { return String(v == null ? '' : v).replace(/^\s+|\s+$/g, ''); }

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

  // ---------- つながり（§Y-2 / §Y-9） ----------
  // 場面 = 記録 1 つ（活動の変化の文 / 作品の本人の言葉）。記録が無い・空なら null（その学んだことは出さない）
  function scene(ev, a, works, opts) {
    if (!isObj(ev) || !a) return null;
    if (typeof ev.changeId === 'string') {
      var c = find(a.changes, ev.changeId), t = c && c.what && typeof c.what.text === 'string' ? trim(c.what.text) : '';
      if (!t) return null;
      return { kind: 'change', ref: c.id, field: 'what', date: opts.today || null, time: c.time || null, text: t, with: c.with || null };
    }
    if (typeof ev.workId === 'string') {
      var w = find(works, ev.workId), f = ev.field === 'craft' || ev.field === 'like' ? ev.field : null;
      if (!w || !f || w.actId !== a.id) return null;
      var v = typeof w[f] === 'string' ? trim(w[f]) : '';
      if (!v) return null;
      return { kind: 'work', ref: w.id, field: f, date: w.date || null, time: w.atTime || null, text: v, with: null };
    }
    return null;
  }
  // 左 = 作ってきたもの（活動 1 つ = ノード 1 つ。活動の無い作品だけ作品をノードに）/ 中 = 学んだこと / 右 = 単元。
  // 学んだことは対応表に載っているものだけ。活動・記録が消えたもの・外したもの（declined）は辺ごと落とす。
  // 並び: 作ってきたものは活動の並び（新しく作った・再開したものが先頭）→ 活動の無い作品。学んだことは活動ごとに対応表の順。単元は最初に出た順
  function graph(learned, acts, works, declined, opts) {
    opts = opts || {};
    acts = (Array.isArray(acts) ? acts : []).filter(function (a) { return a && typeof a.id === 'string'; });
    works = (Array.isArray(works) ? works : []).filter(function (w) { return w && typeof w.id === 'string'; });
    declined = Array.isArray(declined) ? declined : [];
    var g = { nodes: { acts: [], learned: [], units: [] }, edges: [] }, seen = {};
    acts.forEach(function (a) {
      g.nodes.acts.push({ id: 'act:' + a.id, kind: 'act', actId: a.id, workId: null, title: String(a.title || ''),
        works: works.filter(function (w) { return w.actId === a.id; }).map(function (w) { return { id: w.id, title: String(w.title || '') }; }), learned: [] });
    });
    works.forEach(function (w) {
      if (find(acts, w.actId)) return;
      g.nodes.acts.push({ id: 'work:' + w.id, kind: 'work', actId: null, workId: w.id, title: String(w.title || ''), works: [], learned: [] });
    });
    g.nodes.acts.forEach(function (an) {
      if (an.kind !== 'act') return;
      var a = find(acts, an.actId);
      (learned || []).forEach(function (l) {
        if (!l || l.actId !== a.id || declined.indexOf(l.id) >= 0) return;
        var sc = scene(l.evidence, a, works, opts);
        if (!sc) return;
        var codes = (l.units || []).filter(function (code) { return !!MPD.anyUnit(code); });
        var ln = { id: 'ln:' + l.id, kind: 'learned', learnedId: l.id, actId: a.id, text: clone(l.text), src: SRC.indexOf(l.src) >= 0 ? l.src : 'buddy', scene: sc, units: codes };
        g.nodes.learned.push(ln);
        an.learned.push(ln.id);
        g.edges.push({ id: an.id + '>' + ln.id, from: an.id, to: ln.id });
        codes.forEach(function (code) {
          var uid = 'unit:' + code, u = MPD.anyUnit(code);
          if (!seen[uid]) {
            seen[uid] = true;
            g.nodes.units.push({ id: uid, kind: 'unit', code: code, material: u.material !== false, name: clone(u.name), subject: clone(u.subject), grade: u.grade, area: u.area || null });
          }
          g.edges.push({ id: ln.id + '>' + uid, from: ln.id, to: uid });
        });
      });
    });
    return g;
  }
  function allNodes(g) { return g ? g.nodes.acts.concat(g.nodes.learned, g.nodes.units) : []; }
  function nodeById(g, id) { return find(allNodes(g), id); }
  function hasNode(g, id) { return typeof id === 'string' && !!nodeById(g, id); }
  // 選んだノードとつながるもの（辺の向きに沿って前へ 2 / 後ろへ 2 = 2 ホップ）。自分は含めない
  function related(g, id) {
    var out = { nodes: [], edges: [] };
    if (!hasNode(g, id)) return out;
    var seenN = {};
    seenN[id] = true;
    function walk(start, dir, depth) {
      if (!depth) return;
      g.edges.forEach(function (e) {
        var from = dir > 0 ? e.from : e.to, to = dir > 0 ? e.to : e.from;
        if (from !== start) return;
        if (out.edges.indexOf(e.id) < 0) out.edges.push(e.id);
        if (!seenN[to]) { seenN[to] = true; out.nodes.push(to); }
        walk(to, dir, depth - 1);
      });
    }
    walk(id, 1, 2);
    walk(id, -1, 2);
    // 並びはグラフの並び（作ったもの → 学んだこと → 単元）
    var order = allNodes(g).map(function (n) { return n.id; });
    out.nodes.sort(function (a, b) { return order.indexOf(a) - order.indexOf(b); });
    return out;
  }
  // 既定の選択 = いちばん新しい作ったもの（左の列の先頭）
  function defaultSel(g) { return g && g.nodes.acts.length ? g.nodes.acts[0].id : null; }
  // des3.mapUi を整える。形が違えば初期値（{ declined: [] }・選択は既定）。
  // declined は対応表にある学んだことだけ（重なりなし）。sel: null = 本人が外した（保つ）/ 無い・無効な id = 既定（graph がある時）
  function normalizeUi(raw, g, table) {
    var known = (table || MPD.learned).map(function (l) { return l.id; }), out = { sel: undefined, declined: [] };
    var ok = isObj(raw) && (raw.sel == null || typeof raw.sel === 'string') && (raw.declined == null || Array.isArray(raw.declined));
    if (ok) {
      (raw.declined || []).forEach(function (id) { if (typeof id === 'string' && known.indexOf(id) >= 0 && out.declined.indexOf(id) < 0) out.declined.push(id); });
      if (raw.sel === null) out.sel = null;
      else if (typeof raw.sel === 'string') out.sel = raw.sel;
    }
    if (g && out.sel !== null && !hasNode(g, out.sel)) out.sel = defaultSel(g);
    if (out.sel === undefined) delete out.sel;
    return out;
  }
  // 選ぶ: 同じノードをもう一度で外す（null）。無いノードは何もしない
  function select(ui, g, id) {
    var cur = normalizeUi(ui, g);
    if (!hasNode(g, id)) return cur;
    return { sel: cur.sel === id ? null : id, declined: cur.declined.slice() };
  }
  // バディの見立てを「違う」で外す（本人・人の言葉は外さない）。選択はその学んだことの作ったものへ
  function decline(ui, g, id) {
    var n = nodeById(g, id), cur = normalizeUi(ui, g);
    if (!n || n.kind !== 'learned' || n.src !== 'buddy') return null;
    return { sel: 'act:' + n.actId, declined: cur.declined.concat([n.learnedId]) };
  }
  // 元に戻す: 外した学んだことを戻して、それを選ぶ
  function undecline(ui, learnedId) {
    var cur = normalizeUi(ui, null);
    return { sel: 'ln:' + learnedId, declined: cur.declined.filter(function (x) { return x !== learnedId; }) };
  }
  // 単元につながる 学んだこと + 作ったもの（単元の詳細の「作ったものとのつながり」）
  function unitLinks(g, code) {
    var out = [];
    if (!g) return out;
    g.nodes.learned.forEach(function (ln) {
      if (ln.units.indexOf(code) < 0) return;
      out.push({ learned: ln, act: nodeById(g, 'act:' + ln.actId) });
    });
    return out;
  }

  var pure = {
    progress: progress, overall: overall, isBlank: isBlank, lastDate: lastDate, graph: graph, related: related, defaultSel: defaultSel,
    normalizeUi: normalizeUi, select: select, decline: decline, undecline: undecline, unitLinks: unitLinks, nodeById: nodeById, hasNode: hasNode
  };
  Object.keys(pure).forEach(function (k) { MP[k] = pure[k]; });
  if (typeof module !== 'undefined' && module.exports) module.exports = pure;
  if (typeof document === 'undefined') return;

  // ======================================================================
  // ここから下はブラウザ専用
  // ======================================================================

  // ---------- 保存（§Y-6）: 既存の DES.store に des3.mapUi を足す（today.js と同じ包み方） ----------
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
  function S() { return DES.state; }
  function T(k, v) { return DES.t(k, v); }
  function H() { return DES.h.apply(null, arguments); }
  function icon(n) { return DES.raw(DES.icon(n)); }
  function pick(pair) { return Array.isArray(pair) ? (DES.mode() === 'es' && pair[1] ? pair[1] : pair[0]) : String(pair == null ? '' : pair); }
  function esc(v) { return window.CSS && CSS.escape ? CSS.escape(v) : String(v).replace(/"/g, '\\"'); }
  function narrow() { return DES.app.bp() === 's'; }
  function ui() {
    var u = DES.ui;
    if (!u.mp) u.mp = { shown: null, missing: null, selCard: null, ro: null };
    return u.mp;
  }
  function todayMD() { var p = DES.data.today.split('-'); return (+p[1]) + '/' + (+p[2]); }
  function mapUi() { if (!isObj(S().mapUi)) S().mapUi = normalizeUi(null, null); return S().mapUi; }
  function graphNow() { return graph(MPD.learned, S().activities || [], S().works || [], mapUi().declined, { today: todayMD() }); }
  function effSel(g) { return normalizeUi(mapUi(), g).sel; }
  function nodeSel(id) { return '.mp-node[data-id="' + esc(id) + '"]'; }
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
  function srcChip(src) {
    var who = src === 'own' ? T('who_own') : (src === 'person' ? T('mp_src_person') : T('who_ai'));
    return chip(src === 'own' ? 'own' : (src === 'person' ? 'record' : 'ai'), who, T('mp_src_label', { who: who }));
  }

  // ---------- ノードの言葉 ----------
  function unitLabel(u) {
    if (!u) return '';
    return u.material === false ? T('mp_unit_ext', { subject: pick(u.subject), grade: u.grade, name: pick(u.name) }) : T('mp_unit_label', { grade: u.grade, name: pick(u.name) });
  }
  function kindLabel(kind) { return T({ act: 'mp_kind_act', work: 'mp_kind_work', learned: 'mp_kind_learned', unit: 'mp_kind_unit' }[kind]); }
  function words(n) { return !n ? '' : (n.kind === 'learned' ? pick(n.text) : (n.kind === 'unit' ? unitLabel(n) : n.title)); }
  // グラフに無いノード（単元の詳細で、つながりの無い単元）も言葉にできるように
  function wordsOf(id) {
    var n = nodeById(graphNow(), id);
    if (n) return words(n);
    if (/^unit:/.test(id)) return unitLabel(MPD.anyUnit(id.slice(5)));
    return '';
  }
  function sceneText(sc) {
    var head = [sc.date, sc.time].filter(Boolean).join(' ');
    return (head ? head + ' ' : '') + sc.text + (sc.with ? T('mp_with', { name: sc.with }) : '');
  }
  function basicLine(code) {
    var d = lastDate(MPD.unit(code), MPD.progress);
    return d ? T('mp_basic_done', { date: d }) : T('mp_basic_next');
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
  function nodeArt(n) {
    try {
      if (n.kind === 'act') { var a = find(S().activities, n.actId); return a ? actArt(a) : ''; }
      if (n.kind === 'work') return workArt(find(S().works, n.workId));
    } catch (e) { /* 絵が描けない古い記録は絵なしで出す */ }
    return '';
  }

  // ---------- ノード（<button aria-pressed>。選択は applySel が付ける） ----------
  function nodeBtn(n, arg, cls, kids) {
    return H('button', { type: 'button', class: 'mp-node ' + cls, 'data-action': 'mp-sel', 'data-id': n.id, 'data-arg': arg, 'aria-pressed': 'false' },
      [H('span', { class: 'sr-only' }, kindLabel(n.kind) + ': ')].concat(kids));
  }
  function actBtn(n, arg) {
    var art = nodeArt(n), kids = [];
    if (art) kids.push(H('span', { class: 'mp-thumb', 'aria-hidden': 'true' }, [DES.raw(art)]));
    kids.push(H('span', { class: 'mp-title' }, n.title));
    if (n.works.length) kids.push(H('span', { class: 'mp-sub' }, T('mp_works_of', { titles: n.works.map(function (w) { return w.title; }).join('・') })));
    if (n.kind === 'work') kids.push(H('span', { class: 'mp-sub' }, kindLabel('work')));
    return nodeBtn(n, arg, 'is-act' + (n.kind === 'work' ? ' is-work' : ''), kids);
  }
  function learnedBtn(n, arg) {
    return nodeBtn(n, arg, 'is-learned', [H('span', { class: 'mp-title' }, pick(n.text)), H('span', { class: 'mp-scene' }, sceneText(n.scene)), H('span', { class: 'mp-chips' }, [srcChip(n.src)])]);
  }
  function unitBtn(n, arg) {
    return nodeBtn(n, arg, 'is-unit' + (n.material ? '' : ' is-ext'), [H('span', { class: 'mp-title' }, unitLabel(n)), H('span', { class: 'mp-sub' }, n.material ? basicLine(n.code) : T('mp_no_material'))]);
  }
  function arrowDown() { return H('span', { class: 'mp-arrow', 'aria-hidden': 'true' }, [icon('down')]); }

  // ---------- 見出し + タブ（§Y-1） ----------
  function head(view) {
    return [
      H('div', { class: 'page-head mp-head' }, [H('div', null, [H('h1', { tabindex: '-1', 'data-fk': 'mp-h' }, T('map'))])]),
      H('div', { class: 'studio-tabs mp-tabs' }, [H('div', { class: 'segmented', role: 'group', 'aria-label': T('mp_tabs_label') }, ['links', 'basics'].map(function (k) {
        var on = k === view;
        return H('button', { type: 'button', class: on ? 'active' : null, 'data-action': 'mp-tab', 'data-arg': k, 'aria-current': on ? 'page' : null }, T(k === 'links' ? 'mp_tab_links' : 'mp_tab_basics'));
      }))])
    ];
  }

  // ---------- つながり（§Y-2）: 広い幅 = 3 列 + 線 / 狭い幅（s）= 作ったもの 1 つ = カード 1 枚 ----------
  var SVGNS = 'http://www.w3.org/2000/svg';
  function buildCols(g) {
    var cols = H('div', { class: 'mp-cols' }), svg = document.createElementNS(SVGNS, 'svg'), placed = {};
    svg.setAttribute('class', 'mp-lines');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    cols.appendChild(svg);
    ['mp_col_acts', 'mp_col_learned', 'mp_col_units'].forEach(function (k) { cols.appendChild(H('div', { class: 'mp-colhead', 'aria-hidden': 'true' }, T(k))); });
    // 作ったもの 1 つ = 横 1 段。その段に、学んだことと（初めて出る）単元を並べる
    g.nodes.acts.forEach(function (an) {
      var lns = an.learned.map(function (id) { return nodeById(g, id); }), units = [];
      lns.forEach(function (ln) { ln.units.forEach(function (code) { var uid = 'unit:' + code; if (!placed[uid]) { placed[uid] = true; units.push(nodeById(g, uid)); } }); });
      cols.appendChild(H('div', { class: 'mp-cell is-acts' }, [actBtn(an, 'n')]));
      cols.appendChild(H('div', { class: 'mp-cell is-learned' }, lns.length ? lns.map(function (ln) { return learnedBtn(ln, 'n'); }) : [H('p', { class: 'mp-none' }, T('mp_learned_none'))]));
      cols.appendChild(H('div', { class: 'mp-cell is-units' }, units.map(function (un) { return unitBtn(un, 'n'); })));
    });
    return cols;
  }
  function buildCards(g) {
    return H('ol', { class: 'mp-cards' }, g.nodes.acts.map(function (an) {
      var ck = 'c:' + an.id;
      var chain = an.learned.map(function (lid) {
        var ln = nodeById(g, lid), kids = [learnedBtn(ln, ck)];
        if (ln.units.length) kids.push(arrowDown());
        ln.units.forEach(function (code) { kids.push(unitBtn(nodeById(g, 'unit:' + code), ck + '|' + lid)); });
        return H('li', { class: 'mp-chain-item' }, kids);
      });
      return H('li', { class: 'mp-card-li', 'data-card': an.id }, [H('div', { class: 'mp-card' }, [
        actBtn(an, ck), chain.length ? H('ul', { class: 'mp-chain' }, chain) : H('p', { class: 'mp-none' }, T('mp_learned_none'))])]);
    }));
  }
  function buildLinks(g) {
    var kids = head('links');
    if (!g.nodes.acts.length) {
      kids.push(H('div', { class: 'mp-empty' }, [H('p', { class: 'empty-line' }, T('mp_empty')), H('p', null, [H('a', { class: 'link-btn', href: '#make' }, [icon('make'), H('span', null, T('mp_to_make'))])])]));
    } else {
      var detail = H('section', { class: 'mp-detail card', 'aria-labelledby': 'mp-detail-h' }, [
        H('p', { class: 'eyebrow mp-kind' }), H('h2', { id: 'mp-detail-h', 'aria-live': 'polite' }), H('div', { class: 'mp-detail-body' })]);
      if (narrow()) kids.push(buildCards(g), detail);
      else kids.push(H('div', { class: 'mp-links' }, [buildCols(g), detail]));
    }
    return H('div', { class: 'map-page', 'data-view': 'links' }, kids);
  }

  // 詳細パネル（見出しは aria-live。フォーカスは奪わない）。進む先はノード種別で決める
  function relList(g, rel) {
    if (!rel.nodes.length) return [H('p', { class: 'mp-none' }, T('mp_learned_none'))];
    return [H('ul', { class: 'mp-rel-list' }, rel.nodes.map(function (id) {
      var n = nodeById(g, id);
      return H('li', null, [H('button', { type: 'button', class: 'mp-rel', 'data-action': 'mp-sel', 'data-id': id, 'data-arg': 'rel' },
        [H('span', { class: 'mp-rel-k' }, kindLabel(n.kind)), H('span', { class: 'mp-rel-t' }, words(n))])]);
    }))];
  }
  function detailBody(g, n, rel) {
    var kids = [];
    if (!n) return [H('p', { class: 'mp-hint' }, T('mp_pick'))];
    if (n.kind === 'act' && n.works.length) kids.push(H('p', { class: 'mp-sub' }, T('mp_works_of', { titles: n.works.map(function (w) { return w.title; }).join('・') })));
    if (n.kind === 'learned') kids.push(H('p', { class: 'mp-scene-line' }, [srcChip(n.src), H('span', null, sceneText(n.scene))]));
    if (n.kind === 'unit') kids.push(H('p', { class: 'mp-sub' }, n.material ? basicLine(n.code) : T('mp_no_material')));
    kids.push(H('h3', { class: 'mp-rel-h' }, T('mp_related_h')));
    kids = kids.concat(relList(g, rel));
    var ops = [];
    if (n.kind === 'act' || n.kind === 'work') ops.push(btn(T('mp_make_this'), 'mp-make', { id: n.id, kls: 'orange', icon: 'make', disabled: n.kind === 'work', title: T('story_lost') }));
    if (n.kind === 'unit' && n.material) ops.push(H('a', { class: 'btn small orange', href: '#map/u/' + n.code }, [H('span', null, T('mp_see_basic'))]));
    ops.push(btn(T('mp_talk'), 'mp-talk', { id: n.id, icon: 'chat' }));
    if (n.kind === 'learned' && n.src === 'buddy') ops.push(btn(T('decline'), 'mp-decline', { id: n.id, kls: 'ghost' }));
    kids.push(H('div', { class: 'mp-ops' }, ops));
    return kids;
  }
  // 選択の反映（作り直さずに書き換える: 線の濃淡は 150ms で入れ替わり、フォーカスと見出しの aria-live を保つ）
  function applySel(page, g, sel) {
    var rel = sel ? related(g, sel) : { nodes: [], edges: [] };
    Array.prototype.forEach.call(page.querySelectorAll('.mp-node[data-id]'), function (b) {
      var id = b.getAttribute('data-id');
      b.setAttribute('aria-pressed', id === sel ? 'true' : 'false');
      b.classList.toggle('is-rel', rel.nodes.indexOf(id) >= 0);
    });
    Array.prototype.forEach.call(page.querySelectorAll('.mp-edge'), function (p) { p.classList.toggle('on', rel.edges.indexOf(p.getAttribute('data-edge')) >= 0); });
    var sec = page.querySelector('.mp-detail');
    if (!sec) return;
    var n = sel ? nodeById(g, sel) : null, u = ui(), card = null;
    if (narrow() && n) {
      var cs = page.querySelectorAll('.mp-card-li');
      for (var i = 0; i < cs.length && !card; i++) if (cs[i].getAttribute('data-card') === u.selCard && cs[i].querySelector(nodeSel(sel))) card = cs[i];
      for (i = 0; i < cs.length && !card; i++) if (cs[i].querySelector(nodeSel(sel))) card = cs[i];
    }
    var dk = (sel || '') + '|' + (card ? card.getAttribute('data-card') : '');
    if (page._detailKey === dk) return;
    page._detailKey = dk;
    sec.querySelector('.mp-kind').textContent = n ? kindLabel(n.kind) : '';
    sec.querySelector('#mp-detail-h').textContent = n ? words(n) : T('mp_tab_links');
    var body = H('div', { class: 'mp-detail-body' }, detailBody(g, n, rel));
    sec.replaceChild(body, sec.querySelector('.mp-detail-body'));
    // 狭い幅: 選んだカードの直下に展開。何も選んでいなければ出さない
    if (narrow()) {
      sec.hidden = !card;
      if (card && sec.parentNode !== card) card.appendChild(sec);
    }
  }

  // ---------- 線（SVG・aria-hidden・pointer-events:none）。ResizeObserver で引き直す ----------
  function r1(n) { return Math.round(n * 10) / 10; }
  function drawLines(page, g) {
    var cols = page.querySelector('.mp-cols'), svg = cols && cols.querySelector('.mp-lines');
    if (!svg || !cols.isConnected) return;
    var box = cols.getBoundingClientRect();
    g.edges.forEach(function (e) {
      var a = cols.querySelector(nodeSel(e.from)), b = cols.querySelector(nodeSel(e.to)), path = svg.querySelector('[data-edge="' + esc(e.id) + '"]');
      if (!a || !b) { if (path) svg.removeChild(path); return; }
      var ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      var x1 = ra.right - box.left, y1 = ra.top + ra.height / 2 - box.top, x2 = rb.left - box.left, y2 = rb.top + rb.height / 2 - box.top, dx = Math.max(10, (x2 - x1) / 2);
      if (!path) {
        path = document.createElementNS(SVGNS, 'path');
        path.setAttribute('class', 'mp-edge');
        path.setAttribute('data-edge', e.id);
        svg.appendChild(path);
      }
      path.setAttribute('d', 'M' + r1(x1) + ' ' + r1(y1) + 'C' + r1(x1 + dx) + ' ' + r1(y1) + ' ' + r1(x2 - dx) + ' ' + r1(y2) + ' ' + r1(x2) + ' ' + r1(y2));
    });
  }
  function unwatch() { var u = ui(); if (u.ro) { u.ro.disconnect(); u.ro = null; } }
  function watch(page, g) {
    var cols = page.querySelector('.mp-cols');
    if (!cols) return;
    drawLines(page, g);
    if (window.ResizeObserver) { var ro = new ResizeObserver(function () { drawLines(page, g); }); ro.observe(cols); ui().ro = ro; }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { drawLines(page, g); });
  }

  function renderLinks(main) {
    var g = graphNow(), key = ['links', DES.mode(), narrow() ? 's' : 'w', JSON.stringify(g)].join('|');
    var page = main.querySelector('.map-page[data-view="links"]');
    if (!page || page._key !== key) {
      unwatch();
      main.textContent = '';
      page = buildLinks(g);
      page._key = key;
      main.appendChild(page);
      watch(page, g);
    }
    applySel(page, g, effSel(g));
  }

  // ---------- 基礎学習（§Y-3）: 4 領域を段に・学習指導要領の順で固定。マス = 左 問題 / 右 説明 ----------
  function band(u) {
    var pr = progress(u, MPD.progress);
    return H('span', { class: 'mp-band', role: 'img', 'aria-label': T('mp_band_label', { total: pr.total, done: pr.done, p: pr.practiceOnly, e: pr.explainOnly }) }, u.items.map(function (it) {
      var v = MPD.itemProgress(MPD.progress, it.id);
      return H('span', { class: 'mp-sq' + (v.practice ? ' p' : '') + (v.explain ? ' e' : '') });
    }));
  }
  function unitRow(u, linked) {
    var pr = progress(u, MPD.progress);
    return H('li', { class: 'mp-urow' }, [
      H('a', { class: 'mp-uname', href: '#map/u/' + u.code, 'data-fk': 'mp-u:' + u.code }, pick(u.name)),
      H('span', { class: 'mp-ubar' }, [band(u), H('span', { class: 'mp-pct' }, pr.pct + '%')]),
      linked ? H('button', { type: 'button', class: 'mp-linked', 'data-action': 'mp-linked', 'data-id': u.code, 'aria-label': T('mp_linked_mark') + ': ' + pick(u.name) }, [icon('map'), H('span', null, T('mp_linked_mark'))]) : null
    ]);
  }
  function renderBasics(main) {
    var g = graphNow(), linked = {}, ov = overall(MPD.units, MPD.progress);
    g.nodes.units.forEach(function (n) { linked[n.code] = true; });
    var kids = head('basics');
    var sec = [
      H('div', { class: 'mp-prog-head' }, [H('h2', { id: 'mp-prog-h' }, T('mp_progress_h')), H('span', { class: 'mp-overall' }, T('mp_overall', { pct: ov.pct }))]),
      H('p', { class: 'mp-legend' }, [H('span', { class: 'mp-sq p', 'aria-hidden': 'true' }), H('span', { class: 'mp-sq e', 'aria-hidden': 'true' }), H('span', null, T('mp_legend'))])
    ];
    if (isBlank(MPD.units, MPD.progress)) sec.push(H('p', { class: 'mp-zero' }, T('mp_zero')));
    MPD.areas.forEach(function (area) {
      sec.push(H('section', { class: 'mp-area', 'aria-labelledby': 'mp-area-' + area.id }, [
        H('h3', { id: 'mp-area-' + area.id }, pick(area.name)),
        H('ul', { class: 'mp-urows' }, MPD.units.filter(function (u) { return u.area === area.id; }).map(function (u) { return unitRow(u, linked[u.code]); }))
      ]));
    });
    sec.push(H('p', { class: 'mp-scope' }, T('mp_scope_note')));
    kids.push(H('section', { class: 'mp-basics', 'aria-labelledby': 'mp-prog-h' }, sec));
    unwatch();
    main.textContent = '';
    main.appendChild(H('div', { class: 'map-page', 'data-view': 'basics' }, kids));
  }

  // ---------- 単元（§Y-4） ----------
  function renderUnit(main, u) {
    var g = graphNow(), pr = progress(u, MPD.progress), links = unitLinks(g, u.code), area = MPD.area(u.area);
    var items = H('ul', { class: 'mp-items' }, u.items.map(function (it) {
      var v = MPD.itemProgress(MPD.progress, it.id), marks = [];
      if (v.practice) marks.push(H('span', { class: 'chip mp-mark' }, [icon('check'), H('span', null, T('mp_practice_done', { date: v.practice }))]));
      if (v.explain) marks.push(H('span', { class: 'chip mp-mark' }, [icon('check'), H('span', null, T('mp_explain_done', { date: v.explain }))]));
      return H('li', { class: 'mp-item' }, [H('span', { class: 'mp-iname' }, pick(it.name)), marks.length ? H('span', { class: 'mp-marks' }, marks) : null]);
    }));
    var linkKids = links.length ? [H('ul', { class: 'mp-ulinks' }, links.map(function (L) {
      return H('li', null, [
        H('span', { class: 'mp-rel-k' }, kindLabel('learned')), H('button', { type: 'button', class: 'link-btn', 'data-action': 'mp-show', 'data-id': L.learned.id }, pick(L.learned.text)),
        L.act ? H('span', { class: 'mp-rel-k' }, kindLabel(L.act.kind)) : null, L.act ? H('button', { type: 'button', class: 'link-btn', 'data-action': 'mp-show', 'data-id': L.act.id }, L.act.title) : null
      ]);
    }))] : [H('p', { class: 'mp-none' }, T('mp_links_none'))];
    unwatch();
    main.textContent = '';
    main.appendChild(H('div', { class: 'map-page mp-unit', 'data-view': 'unit', 'data-unit': u.code }, [
      H('p', { class: 'mp-back' }, [H('a', { class: 'link-btn', href: '#map/basics', 'aria-label': T('mp_back_basics') }, [H('span', { 'aria-hidden': 'true' }, '←'), H('span', null, T('mp_tab_basics'))])]),
      H('h1', { tabindex: '-1', 'data-fk': 'mp-uh:' + u.code }, pick(u.name)),
      H('p', { class: 'mp-where' }, T('mp_unit_where', { area: pick(area.name) })),
      H('div', { class: 'mp-ubar is-head' }, [band(u), H('span', { class: 'mp-pct' }, pr.pct + '%')]),
      H('section', { class: 'mp-sec', 'aria-labelledby': 'mp-items-h' }, [H('h2', { id: 'mp-items-h' }, T('mp_items_h')), items]),
      H('section', { class: 'mp-sec', 'aria-labelledby': 'mp-ulinks-h' }, [H('h2', { id: 'mp-ulinks-h' }, T('mp_links_h'))].concat(linkKids)),
      H('div', { class: 'mp-ops' }, [btn(T('mp_start_basic'), 'mp-start', { kls: 'orange' }), btn(T('mp_talk'), 'mp-talk', { id: 'unit:' + u.code, icon: 'chat' })])
    ]));
  }

  // ---------- 描画の入口（app.js から）。引数は '' / 'basics' / 'u/<code>'。それ以外は見つからなかった ----------
  function notFound(arg, to) {
    var u = ui();
    if (u.missing !== arg) { u.missing = arg; DES.app.toast(T('mp_not_found')); }
    window.location.replace(to);
  }
  MP.render = function (main, arg) {
    var u = ui(), m = /^u\/(.+)$/.exec(arg || ''), view = !arg ? 'links' : (arg === 'basics' ? 'basics' : (m ? 'unit' : null));
    if (view === 'unit') {
      var un = MPD.unit(m[1]);
      // 教材の無い単元（理科）・無い code は基礎学習の一覧へ
      if (!un) { renderBasics(main); notFound(arg, '#map/basics'); return; }
      renderUnit(main, un);
    } else if (view === 'basics') renderBasics(main);
    else {
      renderLinks(main);
      if (view === null) { notFound(arg, '#map'); return; }
    }
    // 開いたら見出しへ（タブ・単元を開いた時も）。同じ画面の描き直しでは動かさない
    if (u.shown !== (arg || '')) { u.shown = arg || ''; var h = main.querySelector('h1'); if (h) h.focus(); }
  };
  // ルートが変わったら一時的な UI を閉じる（app.js の closeTransient から）
  MP.resetUi = function () { var u = ui(); u.shown = null; u.missing = null; u.selCard = null; unwatch(); };

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
  // 他の画面から、選んだ状態で つながり を開く（作品の「学びマップで見る」/ 基礎学習の印 / 単元の「作ったものとのつながり」）
  MP.show = function (id) {
    if (!saveUi({ sel: id, declined: mapUi().declined.slice() })) return;
    ui().selCard = null;
    if (window.location.hash !== '#map') window.location.hash = '#map';
    else DES.app.render();
  };

  // ---------- 操作 ----------
  var A = DES.actions = DES.actions || {};
  A['mp-tab'] = function (el) {
    var h = el.getAttribute('data-arg') === 'basics' ? '#map/basics' : '#map';
    if (window.location.hash !== h) window.location.hash = h;
  };
  // 選ぶ / もう一度で外す。詳細の「つながっているもの」から選んだ時は、そのノードへフォーカスを移す
  A['mp-sel'] = function (el) {
    var id = el.getAttribute('data-id'), arg = el.getAttribute('data-arg') || '', g = graphNow();
    if (!hasNode(g, id)) return;
    ui().selCard = arg.indexOf('c:') === 0 ? arg.slice(2).split('|')[0] : null;
    setUi(select(mapUi(), g, id), { sel: arg === 'rel' ? nodeSel(id) : null });
  };
  // 違う（バディの見立てだけ）: ノードと辺が消える → トースト「外したよ」+「元に戻す」5 秒
  A['mp-decline'] = function (el) {
    var id = el.getAttribute('data-id'), g = graphNow(), next = decline(mapUi(), g, id), n = nodeById(g, id);
    if (!next || !setUi(next, { sel: nodeSel(next.sel) })) return;
    DES.app.toast(T('removed_toast'), { label: T('undo_restore'), fn: function () { setUi(undecline(mapUi(), n.learnedId), { sel: nodeSel(id) }); } });
  };
  // これで作る: 活動の今の状態で作業台を開く（巻き戻さない。作品の「続きを作る」と同じ）
  A['mp-make'] = function (el) {
    var n = nodeById(graphNow(), el.getAttribute('data-id'));
    if (n && n.kind === 'act') DES.make.openAct(n.actId);
  };
  // バディと話す: 既存の DES.talk.prefill（title = ノードの言葉）
  A['mp-talk'] = function (el) { var w = wordsOf(el.getAttribute('data-id')); if (w) DES.talk.prefill(w); };
  A['mp-linked'] = function (el) { MP.show('unit:' + el.getAttribute('data-id')); };
  A['mp-show'] = function (el) { MP.show(el.getAttribute('data-id')); };
  A['mp-start'] = function () { DES.app.toast(T('mp_start_toast')); };

  // Esc で選択を外す（フォーカスはそのノードに残す）
  MP.bind = function () {
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' || e.defaultPrevented || DES.app.route() !== 'map' || DES.app.routeArg()) return;
      if (document.querySelector('dialog[open]')) return;
      var g = graphNow(), sel = effSel(g);
      if (!sel) return;
      e.preventDefault();
      setUi({ sel: null, declined: mapUi().declined.slice() }, { sel: nodeSel(sel) });
    });
  };
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
