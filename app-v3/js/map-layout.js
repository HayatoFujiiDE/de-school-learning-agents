/* 学びマップの並び（CONTRACT-v3 §AB-4 / AB-5 / AB-12）。純関数・DOM 非依存・決定論（乱数と時刻を使わない）。
   MPL.layout(graph, mode) → { nodes: { id: {x,y,w,h} }, islands: [{ id, x, y, w, h, ... }], bounds: {x,y,w,h} }（mode = 'made' | 'fields'）。
   箱の大きさは文字数から見積もる（js / es の長い方を es の字の大きさで）。どの倍率でも箱の中に収まるよう、
   near の中身（場面・出所・1 行）と、mid の下限 0.6 で画面 12px にした字（世界で 20px・3 行まで）の大きい方で取る。
   置き方は「目標の位置にいちばん近い空き」を横に長いらせんで探して 1 つずつ置く。置いた箱すべてとすき間を空けて
   重ならないことを確かめてから置くので、重なりは起こらない（MPL.overlaps で確かめられる）。
   - 作ったものから: 作ったもの（中心）を、同じ単元につながるものどうしが近くなる順に置く → そのまわりに学んだこと →
     その外に単元（2 つ以上の作ったものからつながる単元は、その学んだことの間 = 橋）→ これから作れそうなものは元の外側
   - 分野で見る: 教科 × 領域の島（中に単元を全部）を、同じ作ったもの・同じ教科でつながる島どうしが近くなる順に置く →
     作ったもの・これから作れそうなものは、つながる単元の真ん中から島の外のいちばん近い空きへ（島と島の間に入る） */
(function (root) {
  'use strict';
  var DES = root.DES = root.DES || {};
  var MPL = DES.mapLayout = {};

  var GAP = 24;        // 箱どうしのすき間（世界の px）
  var PAD = 60;        // 地図の外まわりの余白
  var STEP = 16;       // らせんの 1 周ごとの広がり
  var XS = 1.55;       // らせんを横に伸ばす（横長の枠に合わせる）
  // 箱の寸法（map.css と同じ値。字の大きさは es の方）
  var SZ = {
    made: { w: 172, pad: 6, thumb: 100, title: 14, lh: 1.45, sub: 18 },
    learned: { w: 212, px: 11, py: 9, text: 13.5, lh: 1.5, scene: 12, slh: 1.55, chip: 22 },
    unit: { w: 180, px: 10, py: 8, eb: 19, name: 14, lh: 1.45, band: 13, basic: 12, blh: 1.5, gap: 3 },
    next: { w: 196, px: 11, py: 9, title: 14, lh: 1.45, line: 12, llh: 1.55, chip: 22 },
    island: { px: 18, top: 50, bottom: 18, gap: 14, gutter: 250, vgap: 70 }
  };
  // mid（0.6〜1.1）の字は画面で 12px 以上 = 倍率 0.6 で世界の 20px（map.css の max(…, 12px × 1/倍率)）。mid では 3 行まで（それより長い言葉は短く切る）
  var MID = { px: 12 / 0.6, lines: 3, eblh: 1.6 };
  MPL.SZ = SZ;
  MPL.MID = MID;
  MPL.GAP = GAP;
  var TUNE = { kb: 0.03, kn: 0.008, iters: 320, step: 36, gx: 0.006, gy: 0.018, m: 10, sx: 1.3, sy: 0.5, hx: 1.2 };

  // ---------- 文字の行数の見積もり（全角 = 1 字、半角 = 0.62 字。1 字ぶん余らせる = 行頭の禁則で次の行へ送られる分） ----------
  function charW(c, px) {
    var k = c.charCodeAt(0);
    if (k === 32) return 0.3 * px;
    if (k < 0x80) return 0.62 * px;
    return px;
  }
  function lineCount(str, px, width) {
    var s = String(str == null ? '' : str);
    if (!s) return 0;
    var toks = s.match(/[\x21-\x7e]+|[\s\S]/g) || [], n = 1, x = 0, w = width - px;
    toks.forEach(function (t) {
      var tw = 0;
      for (var i = 0; i < t.length; i++) tw += charW(t[i], px);
      if (/^\s$/.test(t)) { if (x > 0) x += tw; return; }
      if (x > 0 && x + tw > w) { n += 1; x = 0; }
      while (tw > w) { n += 1; tw -= w; }
      x += tw;
    });
    return n;
  }
  function maxLines(v, px, width) {
    var list = Array.isArray(v) ? v : [v], m = 0;
    list.forEach(function (t) { m = Math.max(m, lineCount(t, px, width)); });
    return Math.max(1, m);
  }
  MPL.lineCount = lineCount;
  function sceneStr(sc) {
    if (!sc) return '';
    return [sc.date, sc.time].filter(Boolean).join(' ') + ' ' + sc.text + (sc.with ? '（' + sc.with + 'と）' : '');
  }
  // 箱の大きさ（mode で単元の中身が違う: 作ったものから = 教科と学年の小見出し / 分野で見る = 算数の帯）
  function midLines(v, width) { return Math.min(MID.lines, maxLines(v, MID.px, width)); }
  MPL.size = function (n, mode) {
    var s, iw, h, hm;
    if (n.kind === 'learned') {
      s = SZ.learned; iw = s.w - 2 * s.px - 2;
      // near: 言葉 + 場面（行の頭に出所チップ。幅は 6 字ぶん・高さは 1 行目だけ少し高い）/ mid: 言葉だけ（20px・3 行まで）
      h = 2 * s.py + 2 + maxLines(n.text, s.text, iw) * s.text * s.lh + 5 + maxLines('あああああ\u3000' + sceneStr(n.scene), s.scene, iw) * s.scene * s.slh + (s.chip - s.scene * s.slh);
      hm = 2 * s.py + 2 + midLines(n.text, iw) * MID.px * s.lh;
      return { w: s.w, h: Math.ceil(Math.max(h, hm)) };
    }
    if (n.kind === 'unit') {
      s = SZ.unit; iw = s.w - 2 * s.px - 2;
      // 中身: 作ったものから = 教科と学年 / 名前 /（算数の near は）帯 / 基礎学習の 1 行（2 行まで）。分野で見る = 名前 /（算数は）帯 / 基礎学習の 1 行
      var kids = mode === 'fields' ? (n.material ? 3 : 2) : 3, kidsMid = mode === 'fields' ? (n.material ? 2 : 1) : 2;
      h = 2 * s.py + 2 + maxLines(n.name, s.name, iw) * s.name * s.lh + 2 * s.basic * s.blh + (kids - 1) * s.gap;
      hm = 2 * s.py + 2 + midLines(n.name, iw) * MID.px * s.lh + (kidsMid - 1) * s.gap;
      // 算数の帯: 分野で見る = いつも / 作ったものから = near の時だけ（§AH-2。near の箱だけ 1 段ぶん高く）
      if (mode === 'fields') { if (n.material) { h += s.band; hm += s.band; } } else { h += s.eb; hm += MID.px * MID.eblh; if (n.material) h += s.band + s.gap; }
      return { w: s.w, h: Math.ceil(Math.max(h, hm)) };
    }
    if (n.kind === 'next') {
      s = SZ.next; iw = s.w - 2 * s.px - 2;
      // near: 題 + バディの 1 行（行の頭に出所チップ）/ mid: 題だけ
      h = 2 * s.py + 2 + maxLines(n.title, s.title, iw) * s.title * s.lh + 5 + maxLines(['あああああ\u3000'].concat(Array.isArray(n.line) ? n.line.map(function (t) { return 'あああああ\u3000' + t; }) : []), s.line, iw) * s.line * s.llh + (s.chip - s.line * s.llh);
      hm = 2 * s.py + 2 + midLines(n.title, iw) * MID.px * s.lh;
      return { w: s.w, h: Math.ceil(Math.max(h, hm)) };
    }
    s = SZ.made; iw = s.w - 2 * s.pad - 2;
    // near: 絵 + 題（3 行まで）+ 日付・作品 / mid: 絵 + 題（20px・3 行まで）
    h = 2 * s.pad + 2 + s.thumb + 6 + Math.min(3, maxLines(n.title, s.title, iw)) * s.title * s.lh + 2 + s.sub;
    hm = 2 * s.pad + 2 + s.thumb + 6 + midLines(n.title, iw) * MID.px * s.lh;
    return { w: s.w, h: Math.ceil(Math.max(h, hm)) };
  };

  // ---------- 置く（らせんで空きを探す） ----------
  function hit(a, b, m) { return a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m; }
  function isFree(b, placed, m) {
    for (var i = 0; i < placed.length; i++) if (hit(b, placed[i], Math.max(m, placed[i].m || 0))) return false;
    return true;
  }
  function place(w, h, tx, ty, placed, m, ok, xs) {
    var sx = xs || XS;
    for (var ring = 0; ring < 700; ring++) {
      var r = ring * STEP, steps = ring === 0 ? 1 : Math.max(8, Math.round(2 * Math.PI * r / STEP));
      for (var k = 0; k < steps; k++) {
        var a = (k / steps) * 2 * Math.PI + ring * 0.37;
        var b = { x: tx + Math.cos(a) * r * sx - w / 2, y: ty + Math.sin(a) * r - h / 2, w: w, h: h };
        if (isFree(b, placed, m) && (!ok || ok(b))) return b;
      }
    }
    // （ここには来ない）置いたものすべての右へ
    var right = 0;
    placed.forEach(function (p) { right = Math.max(right, p.x + p.w + (p.m || 0)); });
    return { x: right + m + 1, y: ty - h / 2, w: w, h: h };
  }
  function center(b) { return { x: b.x + b.w / 2, y: b.y + b.h / 2 }; }
  function centroid(pts) {
    if (!pts.length) return null;
    var x = 0, y = 0;
    pts.forEach(function (p) { x += p.x; y += p.y; });
    return { x: x / pts.length, y: y / pts.length };
  }
  function norm(dx, dy, fx, fy) {
    var d = Math.sqrt(dx * dx + dy * dy);
    return d > 1e-6 ? { x: dx / d, y: dy / d } : { x: fx, y: fy };
  }
  // 重みの大きい順に 1 つずつ（すでに置いたものとのつながりがいちばん強いもの → 同じなら全体のつながり → 並び順）
  function order(n, wt) {
    var tot = [], done = [], out = [], i, j;
    for (i = 0; i < n; i++) { tot[i] = 0; for (j = 0; j < n; j++) tot[i] += wt[i][j]; done[i] = false; }
    while (out.length < n) {
      var best = -1, bs = -1, bt = -1;
      for (i = 0; i < n; i++) {
        if (done[i]) continue;
        var sc = 0;
        out.forEach(function (p) { sc += wt[i][p]; });
        if (!out.length) sc = 0;
        if (sc > bs || (sc === bs && tot[i] > bt)) { best = i; bs = sc; bt = tot[i]; }
      }
      done[best] = true;
      out.push(best);
    }
    return out;
  }
  // すべての並べ方（辞書順。決定論）
  function perms(a) {
    if (a.length <= 1) return [a.slice()];
    var out = [];
    a.forEach(function (x, i) { perms(a.slice(0, i).concat(a.slice(i + 1))).forEach(function (p) { out.push([x].concat(p)); }); });
    return out;
  }
  function matrix(n) { var m = []; for (var i = 0; i < n; i++) { m[i] = []; for (var j = 0; j < n; j++) m[i][j] = 0; } return m; }

  // ---------- 詰める（決定論の力学: ばね + 中心への弱い引力 + 箱の押し分け。回数は固定）----------
  // items = [{ id, x, y, w, h, mass }]（左上）。springs = [{ a, b, k }]（添字・自然長 0 = 引き寄せる。重なりは押し分けで止める）
  function relax(items, springs, o) {
    var n = items.length, cx = [], cy = [], i, j, it, C = { x: 0, y: 0 };
    for (i = 0; i < n; i++) { cx[i] = items[i].x + items[i].w / 2; cy[i] = items[i].y + items[i].h / 2; C.x += cx[i] / n; C.y += cy[i] / n; }
    // 横長の枠に合わせて、始めの並びを縦に縮めてから詰める（重なりは押し分けで解く）
    for (i = 0; i < n; i++) { cx[i] = C.x + (cx[i] - C.x) * (o.sx || 1); cy[i] = C.y + (cy[i] - C.y) * (o.sy || 1); }
    for (it = 0; it < o.iters; it++) {
      var t = 1 - it / o.iters, fx = [], fy = [], cap = o.step * t + 1;
      for (i = 0; i < n; i++) { fx[i] = -(cx[i] - C.x) * o.gx; fy[i] = -(cy[i] - C.y) * o.gy; }
      springs.forEach(function (s) {
        var dx = cx[s.b] - cx[s.a], dy = cy[s.b] - cy[s.a];
        fx[s.a] += dx * s.k; fy[s.a] += dy * s.k; fx[s.b] -= dx * s.k; fy[s.b] -= dy * s.k;
      });
      for (i = 0; i < n; i++) {
        var m = items[i].mass || 1;
        cx[i] += Math.max(-cap, Math.min(cap, fx[i] / m));
        cy[i] += Math.max(-cap, Math.min(cap, fy[i] / m));
      }
      push(items, cx, cy, o.margin, 2);
    }
    return items.map(function (b, k) { return { id: b.id, x: cx[k] - b.w / 2, y: cy[k] - b.h / 2, w: b.w, h: b.h }; });
  }
  // 重なり（すき間 m を含む）を、押し分けの少ない向きに半分ずつ（重い方は少し）動かす。重なりが無くなったら true
  function push(items, cx, cy, m, passes) {
    var n = items.length, clean = true;
    for (var p = 0; p < passes; p++) {
      clean = true;
      for (var i = 0; i < n; i++) {
        for (var j = i + 1; j < n; j++) {
          var dx = cx[j] - cx[i], dy = cy[j] - cy[i], hub = items[i].hub && items[j].hub;
          var ox = (items[i].w + items[j].w) / 2 + m + (hub ? HUB.x : 0) - Math.abs(dx), oy = (items[i].h + items[j].h) / 2 + m + (hub ? HUB.y : 0) - Math.abs(dy);
          if (ox <= 0 || oy <= 0) continue;
          clean = false;
          var mi = items[i].mass || 1, mj = items[j].mass || 1, si = mj / (mi + mj), sj = mi / (mi + mj);
          if (ox * XS < oy) { var sx = dx > 0 ? 1 : (dx < 0 ? -1 : (i % 2 ? 1 : -1)); cx[i] -= sx * (ox + 0.5) * si; cx[j] += sx * (ox + 0.5) * sj; }
          else { var sy = dy > 0 ? 1 : (dy < 0 ? -1 : (j % 2 ? 1 : -1)); cy[i] -= sy * (oy + 0.5) * si; cy[j] += sy * (oy + 0.5) * sj; }
        }
      }
      if (clean) return true;
    }
    return clean;
  }
  function anyHit(list, m) {
    for (var i = 0; i < list.length; i++) for (var j = i + 1; j < list.length; j++) if (hit(list[i], list[j], m - 0.001)) return true;
    return false;
  }
  // 作ったものどうしの間合い: far で題を逆に拡大しても（倍率 0.3 で画面 150px 幅・2 行）となりの作ったものに重ならない分
  var HUB = { x: 330, y: 56 };
  MPL.HUB = HUB;
  // far の題の札（map.css の .mp-frame[data-lod="far"] .mp-n.is-made .mp-label と同じ: 絵の下 110px・画面で 150px 幅・12.5px × 2 行）を倍率 0.3 の世界の大きさで
  var FAR_Z = 0.3;
  var LABEL = { top: 110, w: 150 / FAR_Z, h: (2 * 12.5 * 1.3 + 4) / FAR_Z };
  function textW(t, px) { var w = 0, str = String(t || ''); for (var i = 0; i < str.length; i++) w += charW(str[i], px); return w; }
  function pickN(v, k) { return Array.isArray(v) ? (v[k] || v[0]) : String(v == null ? '' : v); }
  MPL.textW = textW;

  // ---------- 作ったものから（§AB-4） ----------
  function layoutMade(g) {
    // 学んだことのある作ったものだけで並べて詰め、学んだことの記録が無いもの（今日作り始めた活動・活動の無い作品）は最後に端へ置く
    // （作り始めても、他の並びが動かない）
    var made = g.nodes.made.filter(function (m) { return m.learned.length > 0; }), loose = g.nodes.made.filter(function (m) { return !m.learned.length; });
    var learned = g.nodes.learned, units = g.nodes.units.filter(function (u) { return u.made.length > 0; });
    var unitIds = {}, nodes = {}, placed = [], sizes = {};
    units.forEach(function (u) { unitIds[u.id] = true; });
    var nexts = g.nodes.next;
    g.nodes.made.concat(learned, units, nexts).forEach(function (n) { sizes[n.id] = MPL.size(n, 'made'); });
    function put(id, b) { var bb = { id: id, x: b.x, y: b.y, w: b.w, h: b.h }; nodes[id] = bb; placed.push(bb); return bb; }

    // 1) 作ったもの: 同じ単元につながる数（重み）が多いものどうしを近くに。まわりに学んだことの場所を空けて置く。
    //    教科をまたぐ（§AD-1）・学ぶ順（§AD-9）の線をやめたので、どちらも重みに使わない（画面に出る線だけで並べる）
    var n = made.length, wt = matrix(n), idx = {};
    made.forEach(function (m, i) { idx[m.id] = i; });
    g.edges.forEach(function (e) {
      if (e.kind === 'peer' && idx[e.from] != null && idx[e.to] != null) { wt[idx[e.from]][idx[e.to]] += e.units.length; wt[idx[e.to]][idx[e.from]] += e.units.length; }
    });
    var RX = 205, RY = 165, hubs = [], hubC = {};
    order(n, wt).forEach(function (i) {
      var m = made[i], s = sizes[m.id], near = [], t;
      hubs.forEach(function (h) { var j = idx[h.id]; if (wt[i][j] > 0) for (var k = 0; k < wt[i][j] * 2; k++) near.push(hubC[h.id]); });
      t = centroid(near) || centroid(hubs.map(function (h) { return hubC[h.id]; })) || { x: 0, y: 0 };
      var b = place(s.w + 2 * RX, s.h + 2 * RY, t.x, t.y, hubs, 0, null, TUNE.hx);
      hubs.push({ id: m.id, x: b.x, y: b.y, w: b.w, h: b.h });
      hubC[m.id] = center(b);
    });
    made.forEach(function (m) { var c = hubC[m.id], s = sizes[m.id]; put(m.id, { x: c.x - s.w / 2, y: c.y - s.h / 2, w: s.w, h: s.h }); });
    var G = centroid(made.map(function (m) { return hubC[m.id]; })) || { x: 0, y: 0 };
    function unitHubC(code) {
      var u = g.nodes.units.filter(function (x) { return x.code === code; })[0];
      return u && u.made.length > 1 ? centroid(u.made.map(function (id) { return hubC[id]; }).filter(Boolean)) : null;
    }

    // 2) 学んだこと: 橋になる単元があればその向き（もう一方の作ったものの方）、無ければ外向きに扇形に広げる
    order(n, wt).forEach(function (i) {
      var m = made[i], H = hubC[m.id], lns = learned.filter(function (l) { return l.madeId === m.id; });
      var out = norm(H.x - G.x, H.y - G.y, 0, 1), outs = [], dir = {};
      lns.forEach(function (l) {
        var v = { x: 0, y: 0 };
        l.units.forEach(function (code) { var c = unitHubC(code); if (c) { v.x += c.x - H.x; v.y += c.y - H.y; } });
        dir[l.id] = Math.abs(v.x) + Math.abs(v.y) > 1 ? norm(v.x, v.y, 0, 1) : null;
        if (!dir[l.id]) outs.push(l);
      });
      outs.forEach(function (l, k) {
        var a = Math.atan2(out.y, out.x) + (k - (outs.length - 1) / 2) * 0.85;
        dir[l.id] = { x: Math.cos(a), y: Math.sin(a) };
      });
      lns.forEach(function (l) {
        var s = sizes[l.id], t = { x: H.x + dir[l.id].x * 270, y: H.y + dir[l.id].y * 215 };
        put(l.id, place(s.w, s.h, t.x, t.y, placed, GAP));
      });
    });

    // 3) 単元: 橋（2 つ以上の作ったもの）を先に、その学んだことの真ん中へ。1 つだけの単元は学んだことの外側へ
    units.slice().sort(function (a, b) { return (b.made.length - a.made.length) || (g.nodes.units.indexOf(a) - g.nodes.units.indexOf(b)); }).forEach(function (u) {
      var s = sizes[u.id], lc = centroid(u.learned.map(function (id) { return nodes[id] ? center(nodes[id]) : null; }).filter(Boolean)) || G, t;
      if (u.made.length > 1) t = lc;
      else {
        var H = hubC[u.made[0]] || G, d = norm(lc.x - H.x, lc.y - H.y, 0, 1);
        t = { x: lc.x + d.x * 190, y: lc.y + d.y * 150 };
      }
      put(u.id, place(s.w, s.h, t.x, t.y, placed, GAP));
    });

    // 4) これから作れそうなもの: 元（学んだこと・出ている単元）の真ん中から、さらに外側へ
    nexts.forEach(function (x) {
      var src = x.learned.concat(x.units.map(function (c) { return 'unit:' + c; })).filter(function (id) { return nodes[id]; });
      var c = centroid(src.map(function (id) { return center(nodes[id]); })) || G, d = norm(c.x - G.x, c.y - G.y, 0, 1), s = sizes[x.id];
      put(x.id, place(s.w, s.h, c.x + d.x * 230, c.y + d.y * 180, placed, GAP));
    });

    // 5) 詰める: 線でつながるものどうしを引き寄せ（作ったもの = 重い）、押し分けで重なりを解く。
    //    最後まで重なりが残る（ここには来ない想定）なら、らせんで置いた並び（重なりなし）をそのまま使う
    var ids = Object.keys(nodes), at = {};
    ids.forEach(function (id, k) { at[id] = k; });
    var items = ids.map(function (id) { var b = nodes[id], hub = !(id.indexOf('ln:') === 0 || id.indexOf('unit:') === 0 || id.indexOf('next:') === 0); return { id: id, x: b.x, y: b.y, w: b.w, h: b.h, mass: hub ? 3 : 1, hub: hub }; });
    var springs = [];
    g.edges.forEach(function (e) {
      if (at[e.from] == null || at[e.to] == null) return;
      if (e.kind === 'base') springs.push({ a: at[e.from], b: at[e.to], k: TUNE.kb });
      else if (e.kind === 'next') springs.push({ a: at[e.from], b: at[e.to], k: TUNE.kn });
    });
    var out = relax(items, springs, { iters: TUNE.iters, step: TUNE.step, gx: TUNE.gx, gy: TUNE.gy, margin: GAP + TUNE.m, sx: TUNE.sx, sy: TUNE.sy });
    var cx = out.map(function (b) { return b.x + b.w / 2; }), cy = out.map(function (b) { return b.y + b.h / 2; });
    push(items, cx, cy, GAP + 2, 400);
    var fin2 = items.map(function (b, k) { return { id: b.id, x: cx[k] - b.w / 2, y: cy[k] - b.h / 2, w: b.w, h: b.h }; });
    if (!anyHit(fin2, GAP)) { nodes = {}; fin2.forEach(function (b) { nodes[b.id] = b; }); }

    // 6) 学んだことの記録が無い作ったもの: 地図の上の端に横へ並べる（作ったものどうしの間合いを取る）
    var list = Object.keys(nodes).map(function (id) { return nodes[id]; }), top = Infinity, mid = 0, madeBoxes = made.map(function (m) { return nodes[m.id]; }).filter(Boolean);
    list.forEach(function (b) { top = Math.min(top, b.y); mid += (b.x + b.w / 2) / list.length; });
    if (!list.length) top = 0;
    loose.forEach(function (m) {
      var s = sizes[m.id];
      var b = place(s.w, s.h, mid, top - s.h / 2 - 2 * GAP, list, GAP, function (c) { return hubOk(c, madeBoxes); }, 4);
      nodes[m.id] = { id: m.id, x: b.x, y: b.y, w: b.w, h: b.h };
      list.push(nodes[m.id]);
      madeBoxes.push(nodes[m.id]);
    });
    return finish(nodes, []);
  }
  // 作ったものどうしの間合い（far で逆に拡大した題が重ならない）
  function hubOk(b, others) {
    for (var i = 0; i < others.length; i++) {
      var o = others[i];
      if (Math.abs((b.x + b.w / 2) - (o.x + o.w / 2)) < (b.w + o.w) / 2 + GAP + HUB.x && Math.abs((b.y + b.h / 2) - (o.y + o.h / 2)) < (b.h + o.h) / 2 + GAP + HUB.y) return false;
    }
    return true;
  }

  // ---------- 分野で見る（§AB-5） ----------
  function layoutFields(g) {
    var I = SZ.island, units = {}, nodes = {}, sizes = {}, isl = [];
    g.nodes.units.forEach(function (u) { units[u.id] = u; sizes[u.id] = MPL.size(u, 'fields'); });
    g.nodes.made.concat(g.nodes.next).forEach(function (n) { sizes[n.id] = MPL.size(n, 'fields'); });
    // 1) 島の中: 2 個まで = 1 段、4 個まで = 2 列、それより多い = 3 列（段の高さはその段のいちばん高い単元）
    (g.islands || []).forEach(function (s) {
      var ids = s.units.filter(function (id) { return units[id]; }), k = ids.length;
      if (!k) return;
      var cols = k <= 2 ? k : (k <= 4 ? 2 : 3), rows = Math.ceil(k / cols), rowH = [], local = {}, y = I.top, r, c;
      for (r = 0; r < rows; r++) { rowH[r] = 0; for (c = 0; c < cols; c++) { var id = ids[r * cols + c]; if (id) rowH[r] = Math.max(rowH[r], sizes[id].h); } }
      for (r = 0; r < rows; r++) {
        for (c = 0; c < cols; c++) { var uid = ids[r * cols + c]; if (uid) local[uid] = { x: I.px + c * (SZ.unit.w + I.gap), y: y }; }
        y += rowH[r] + (r < rows - 1 ? I.gap : 0);
      }
      isl.push({ id: s.id, sub: s.sub, area: s.area, units: ids, local: local, w: 2 * I.px + cols * SZ.unit.w + (cols - 1) * I.gap, h: y + I.bottom });
    });
    // 2) 島を置く: 教科ごとに縦 1 列（領域の順に上から）。列の並びは、隣り合う教科どうしのつながり
    //    （両方につながる作ったもの）の和がいちばん大きい並び（同じなら教科の順で先のもの）。
    //    列と列の間は作ったものが入る幅を空ける（作ったものは、つながる島どうしの間に入る）
    var subs = [];
    isl.forEach(function (s) { if (subs.indexOf(s.sub) < 0) subs.push(s.sub); });
    var sw = matrix(subs.length), subOf = {};
    isl.forEach(function (s) { s.units.forEach(function (id) { subOf[id] = subs.indexOf(s.sub); }); });
    function link(a, b) { if (a != null && b != null && a !== b) { sw[a][b] += 1; sw[b][a] += 1; } }
    g.nodes.made.forEach(function (m) {
      var hs = [];
      m.units.forEach(function (code) { var k = subOf['unit:' + code]; if (k != null && hs.indexOf(k) < 0) hs.push(k); });
      hs.forEach(function (a) { hs.forEach(function (b) { if (a < b) link(a, b); }); });
    });
    var best = subs.map(function (x, k) { return k; }), bestS = -1;
    if (subs.length <= 6) perms(subs.map(function (x, k) { return k; })).forEach(function (p) {
      var sc = 0;
      for (var k = 0; k + 1 < p.length; k++) sc += sw[p[k]][p[k + 1]];
      if (sc > bestS) { bestS = sc; best = p; }
    });
    var cols = best.map(function (k) { return isl.filter(function (s) { return s.sub === subs[k]; }); });
    var colW = cols.map(function (c) { var w = 0; c.forEach(function (s) { w = Math.max(w, s.w); }); return w; });
    var colH = cols.map(function (c) { var h = 0; c.forEach(function (s, k) { h += s.h + (k ? I.vgap : 0); }); return h; });
    var maxH = Math.max.apply(null, colH.concat([0])), x0 = 0;
    cols.forEach(function (c, k) {
      var y = (maxH - colH[k]) / 2;
      c.forEach(function (s) { s.x = x0 + (colW[k] - s.w) / 2; s.y = y; y += s.h + I.vgap; });
      x0 += colW[k] + I.gutter;
    });
    isl.forEach(function (s) { s.units.forEach(function (id) { nodes[id] = { id: id, x: s.x + s.local[id].x, y: s.y + s.local[id].y, w: sizes[id].w, h: sizes[id].h }; }); });
    // 3) 作ったもの → これから作れそうなもの: つながる単元の真ん中から、島にも他の箱にも重ならないいちばん近い空きへ
    var placed = isl.map(function (s) { return { x: s.x, y: s.y, w: s.w, h: s.h, m: 30 }; });
    g.nodes.units.forEach(function (u) { if (nodes[u.id]) placed.push(nodes[u.id]); });
    var G = centroid(isl.map(function (s) { return { x: s.x + s.w / 2, y: s.y + s.h / 2 }; })) || { x: 0, y: 0 };
    var bottom = 0;
    isl.forEach(function (s) { bottom = Math.max(bottom, s.y + s.h); });
    // far（いちばん小さい倍率 0.3）で逆に拡大した字: 島の名前の札と、作ったものの題の札（絵の下）。題の札は島の名前にかけない
    var names = isl.map(function (s) {
      var gi = (g.islands || []).filter(function (x) { return x.id === s.id; })[0], w = 0;
      if (gi) [0, 1].forEach(function (k) { w = Math.max(w, textW(pickN(gi.subject, k) + '・' + pickN(gi.name, k), 13)); });
      return { x: s.x + 12, y: s.y + 4, w: w / FAR_Z + 16, h: 13 * 1.4 / FAR_Z + 10 };
    });
    var madeBoxes = [];
    function labelOk(b) {
      var F = { x: b.x + b.w / 2 - LABEL.w / 2, y: b.y + LABEL.top, w: LABEL.w, h: LABEL.h };
      for (var i = 0; i < names.length; i++) if (hit(F, names[i], 0)) return false;
      return hubOk(b, madeBoxes);
    }
    function putNear(nd, codes, isMade) {
      var c = centroid(codes.map(function (code) { return nodes['unit:' + code] ? center(nodes['unit:' + code]) : null; }).filter(Boolean));
      var s = sizes[nd.id], t = c || { x: G.x, y: bottom + 200 };
      var b = place(s.w, s.h, t.x, t.y, placed, GAP, isMade ? labelOk : null);
      nodes[nd.id] = { id: nd.id, x: b.x, y: b.y, w: b.w, h: b.h };
      placed.push(nodes[nd.id]);
      if (isMade) madeBoxes.push(nodes[nd.id]);
    }
    g.nodes.made.slice().sort(function (a, b) { return (b.units.length - a.units.length) || (g.nodes.made.indexOf(a) - g.nodes.made.indexOf(b)); })
      .forEach(function (m) { putNear(m, m.units, true); });
    g.nodes.next.forEach(function (x) {
      var codes = x.units.slice();
      x.learned.forEach(function (lid) { var l = g.nodes.learned.filter(function (q) { return q.id === lid; })[0]; if (l) l.units.forEach(function (c) { if (codes.indexOf(c) < 0) codes.push(c); }); });
      putNear(x, codes, false);
    });
    return finish(nodes, isl.map(function (s) {
      return { id: s.id, sub: s.sub, area: s.area, units: s.units.slice(), x: s.x, y: s.y, w: s.w, h: s.h };
    }));
  }

  // 左上を (PAD, PAD) にそろえ、整数にまるめる（すき間 GAP があるので、まるめても重ならない）
  function finish(nodes, islands) {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, out = {};
    Object.keys(nodes).forEach(function (id) { var b = nodes[id]; minX = Math.min(minX, b.x); minY = Math.min(minY, b.y); maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h); });
    islands.forEach(function (b) { minX = Math.min(minX, b.x); minY = Math.min(minY, b.y); maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h); });
    if (minX === Infinity) { minX = 0; minY = 0; maxX = 0; maxY = 0; }
    var dx = PAD - minX, dy = PAD - minY;
    function mv(b) { return { x: Math.round(b.x + dx), y: Math.round(b.y + dy), w: Math.round(b.w), h: Math.round(b.h) }; }
    Object.keys(nodes).forEach(function (id) { out[id] = mv(nodes[id]); });
    return {
      nodes: out,
      islands: islands.map(function (s) { var b = mv(s); b.id = s.id; b.sub = s.sub; b.area = s.area; b.units = s.units; return b; }),
      bounds: { x: 0, y: 0, w: Math.round(maxX - minX + 2 * PAD), h: Math.round(maxY - minY + 2 * PAD) }
    };
  }

  MPL.layout = function (g, mode) {
    if (!g || !g.nodes) return { nodes: {}, islands: [], bounds: { x: 0, y: 0, w: 0, h: 0 } };
    return mode === 'fields' ? layoutFields(g) : layoutMade(g);
  };
  // 重なっている箱の組（テスト・確かめ用）。m = 最低限のすき間
  MPL.overlaps = function (L, m) {
    var ids = Object.keys(L.nodes), out = [];
    for (var i = 0; i < ids.length; i++) for (var j = i + 1; j < ids.length; j++) if (hit(L.nodes[ids[i]], L.nodes[ids[j]], (m || 0) - 0.001)) out.push([ids[i], ids[j]]);
    return out;
  };
  MPL.inside = function (b, box) { return b.x >= box.x && b.y >= box.y && b.x + b.w <= box.x + box.w && b.y + b.h <= box.y + box.h; };

  if (typeof module !== 'undefined' && module.exports) module.exports = MPL;
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
