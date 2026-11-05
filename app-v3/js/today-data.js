/* 今日のお題の中身（CONTRACT-v3 §X-3）。プール 9 本 = fit（near / next / new）ごとに 3 本。fit は内部値で、画面には出さない。
   v1.0 の例 2 本（回りながら落ちる種 / この街の案内板）+ 11 月の季節（落ち葉・どんぐり・夕方が早くなる・冬鳥・初雪）+ 本人の好き
   （既存データのマイクラの建築・Python のゲーム・電気の回路）。外からの依頼は 1 本だけ（架空・実在の団体名なし・締切つき）。
   屋外・生き物・刃物を使うお題は safety: true、外に出て探すお題は outdoor: true。人の名前は足さない。
   文言は [中学生向け, 小学生向け] の組。絵は数値だけから組み立てる 2 色の線画 SVG（1 枚ごとに 墨 + 橙 か 墨 + オリーブ。淡い面は同じ色の透明度）。
   play.result(values) と drawArt(kind, values) は決定論。node からも読める（tools/today-test.js）。 */
(function (root) {
  'use strict';
  var DES = root.DES = root.DES || {};
  var MD = DES.makeData || (typeof require === 'function' ? require('./make-data.js') : null);
  var TDD = DES.todayData = {};

  var INK = '#292c29', OLIVE = '#524e44', ORANGE = '#ed922c', WHITE = '#ffffff';
  TDD.FITS = ['near', 'next', 'new'];
  TDD.COLORS = { ink: INK, olive: OLIVE, orange: ORANGE };

  // ---------- 線画の部品（viewBox 240×150。make-data.js の線画と同じ枠） ----------
  // 2 色の線画（§X-3 / §U-1）: 1 枚ごとに 墨 + 橙 か 墨 + オリーブ の 2 色だけ。淡い面は同じ色の透明度で作り、別の色を足さない
  function r1(n) { return Math.round(n * 10) / 10; }
  function fo(a) { return ' fill-opacity="' + a + '"'; }
  function so(a) { return ' stroke-opacity="' + a + '"'; }
  function wrap(body, cls) {
    return '<svg class="mk-art td-art' + (cls ? ' ' + cls : '') + '" viewBox="0 0 240 150" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">' + body + '</svg>';
  }
  function line(x1, y1, x2, y2, col, w, extra) {
    return '<path d="M' + r1(x1) + ' ' + r1(y1) + 'L' + r1(x2) + ' ' + r1(y2) + '" stroke="' + (col || INK) + '" stroke-width="' + (w || 1.2) + '" fill="none" stroke-linecap="round"' + (extra || '') + '/>';
  }
  function rect(x, y, w, h, fill, extra) {
    return '<rect x="' + r1(x) + '" y="' + r1(y) + '" width="' + r1(w) + '" height="' + r1(h) + '" fill="' + fill + '" stroke="' + INK + '" stroke-width="1.2"' + (extra || '') + '/>';
  }
  function poly(pts, fill, w, extra) {
    return '<path d="M' + pts.map(function (p) { return r1(p[0]) + ' ' + r1(p[1]); }).join('L') + 'Z" fill="' + fill + '" stroke="' + INK + '" stroke-width="' + (w || 1.2) + '" stroke-linejoin="round"' + (extra || '') + '/>';
  }
  function circle(cx, cy, r, fill, stroke, w, extra) {
    return '<circle cx="' + r1(cx) + '" cy="' + r1(cy) + '" r="' + r1(r) + '" fill="' + fill + '" stroke="' + (stroke || 'none') + '" stroke-width="' + (w || 1.2) + '"' + (extra || '') + '/>';
  }
  function ground(col) { return line(14, 140, 226, 140, col || INK, 1.2); }
  function arrow(x, y, dir, col) {
    var d = dir < 0 ? -1 : 1, c = col || INK;
    return line(x - 7 * d, y, x + 7 * d, y, c, 1.4) + line(x + 7 * d, y, x + 3 * d, y - 4, c, 1.4) + line(x + 7 * d, y, x + 3 * d, y + 4, c, 1.4);
  }
  // 写真のダミー（四隅の枠で「写真」と分かるように。墨の淡い線なので色は増えない）
  function corners() {
    return '<path d="M8 22 V8 H22 M218 8 H232 V22 M232 128 V142 H218 M22 142 H8 V128" stroke="' + INK + '" stroke-width="1.6" fill="none"' + so(0.55) + '/>';
  }
  TDD.frameOnly = function () { return wrap(corners(), 'is-photo'); };

  // ---------- 絵の種類（kind ごとに values から描く） ----------
  var ART = {};
  // 落ち葉（墨 + 橙）: 風 = 横に流れる長さと矢印の数 / 葉の重さ = 左右のゆれ幅
  function leafShape(cx, cy, s) {
    return '<path d="M' + r1(cx) + ' ' + r1(cy - 7 * s) + 'Q' + r1(cx + 6 * s) + ' ' + r1(cy) + ' ' + r1(cx) + ' ' + r1(cy + 7 * s) + 'Q' + r1(cx - 6 * s) + ' ' + r1(cy) + ' ' + r1(cx) + ' ' + r1(cy - 7 * s) + 'Z" fill="' + ORANGE + '"' + fo(0.25) + ' stroke="' + ORANGE + '" stroke-width="1.3"/>' +
      line(cx, cy - 6 * s, cx, cy + 6 * s, ORANGE, 0.9);
  }
  function leavesAmp(v) { return 4 + v.wind * 4 + (3 - v.weight) * 3; }
  ART.leaves = function (v) {
    var out = ground(), amp = leavesAmp(v), drift = v.wind * 14, i, k;
    out += '<path d="M14 20 Q60 26 104 16" stroke="' + INK + '" stroke-width="2.4" fill="none" stroke-linecap="round"/>' + line(56, 23, 64, 32, INK, 1.4) + line(84, 20, 90, 29, INK, 1.4);
    for (i = 0; i < 3; i++) {
      var x0 = 40 + i * 30, y0 = 34 + i * 6, pts = [[x0, y0]];
      for (k = 1; k <= 4; k++) pts.push([x0 + drift * k / 4 + (k % 2 ? amp : -amp), y0 + (134 - y0) * k / 4]);
      out += '<path d="M' + pts.map(function (p) { return r1(p[0]) + ' ' + r1(p[1]); }).join('L') + '" stroke="' + INK + '" stroke-width="1.1" fill="none" stroke-dasharray="3 3" stroke-linejoin="round"' + so(0.45) + '/>';
      out += leafShape(pts[2][0], pts[2][1], 0.9) + leafShape(pts[4][0], pts[4][1] - 2, 0.8);
    }
    for (i = 0; i < v.wind; i++) out += arrow(176 + (i % 2) * 22, 34 + Math.floor(i / 2) * 14, 1, ORANGE);
    return wrap(out);
  };
  // 夕方の明かり（墨 + 橙）: 外の暗さ = 太陽の高さと窓の斜線の数 / 電池の数 = 電池の印と光の大きさ
  ART.dusk = function (v) {
    var out = ground(), on = v.dark >= 2, i;
    out += rect(22, 20, 96, 100, WHITE, ' rx="6"') + line(70, 20, 70, 120, INK, 1) + line(22, 92, 118, 92, INK, 1, so(0.5));
    for (i = 0; i < v.dark * 2; i++) { var y = 26 + i * 8; out += line(26, y, 66, y - 6, INK, 0.6, so(0.35)) + line(74, y, 114, y - 6, INK, 0.6, so(0.35)); }
    if (v.dark < 4) out += circle(46, 36 + v.dark * 16, 9, ORANGE, INK, 1.2);
    else out += '<path d="M44 34 a10 10 0 1 0 10 12 a8 8 0 1 1 -10 -12Z" fill="' + ORANGE + '"' + fo(0.3) + ' stroke="' + INK + '" stroke-width="1.2"/>';
    // 回路（右）: 電池 → 電球
    out += '<path d="M140 110 H198 V54 H140 Z" stroke="' + INK + '" stroke-width="1.4" fill="none" stroke-linejoin="round"/>';
    out += '<rect x="132" y="' + (80 - v.cells * 9) + '" width="16" height="' + (v.cells * 18) + '" fill="' + WHITE + '" stroke="none"/>';
    for (i = 0; i < v.cells; i++) { var cy = 80 - (v.cells - 1) * 9 + i * 18; out += line(133, cy - 3, 147, cy - 3, INK, 1.5) + line(136, cy + 2, 144, cy + 2, INK, 2.8); }
    var glow = on ? 14 + v.cells * 5 : 0;
    if (on) out += circle(198, 54, glow, ORANGE, null, 1, fo(0.22));
    if (on) for (i = 0; i < v.cells * 2; i++) { var a = -Math.PI / 2 + (i - (v.cells * 2 - 1) / 2) * 0.45; out += line(198 + Math.cos(a) * (glow - 2), 54 + Math.sin(a) * (glow - 2), 198 + Math.cos(a) * (glow + 6), 54 + Math.sin(a) * (glow + 6), ORANGE, 1.8); }
    out += circle(198, 54, 11, on ? ORANGE : WHITE, INK, 1.4, on ? fo(0.4) : '');
    return wrap(out);
  };
  // どんぐりの帽子みたいな屋根（墨 + オリーブ）: 段の数 = ブロックの段 / ブロック = 石（点）・ガラス（斜めの光）・オークの板（木目）
  function block(x, y, b, kind) {
    var out = rect(x, y, b, b, kind === 0 ? OLIVE : (kind === 2 ? OLIVE : WHITE), kind === 0 ? fo(0.2) : (kind === 2 ? fo(0.07) : ''));
    if (kind === 0) out += circle(x + b * 0.35, y + b * 0.4, Math.max(0.9, b * 0.08), OLIVE);
    else if (kind === 1) out += line(x + b * 0.2, y + b * 0.6, x + b * 0.55, y + b * 0.25, OLIVE, 1) + line(x + b * 0.45, y + b * 0.8, x + b * 0.8, y + b * 0.45, OLIVE, 1);
    else out += line(x + b * 0.15, y + b * 0.38, x + b * 0.85, y + b * 0.38, OLIVE, 0.9) + line(x + b * 0.15, y + b * 0.68, x + b * 0.85, y + b * 0.68, OLIVE, 0.9);
    return out;
  }
  ART.mcroof = function (v) {
    var out = ground(OLIVE), s = v.size, b0 = Math.min(16, 200 / (2 * s - 1), 120 / s);
    for (var i = 0; i < s; i++) {
      var w = 2 * (s - 1 - i) + 1, x0 = 120 - w * b0 / 2, y = 140 - (i + 1) * b0;
      for (var j = 0; j < w; j++) out += block(x0 + j * b0, y, b0, v.block);
    }
    return wrap(out);
  };
  // 回りながら落ちる種（紙の模型・墨 + 橙）: 羽の長さ = 羽と回る弧 / クリップ = 重りの数と落ちる線
  ART.seed = function (v) {
    // 羽の先と回る弧が枠からはみ出さない大きさ（羽 6 cm・クリップ 2 個でも上端 8 より下）
    var out = ground(), L = 12 + v.wing * 7, top = 66 + v.clip * 6, tipY = top - L * 0.8, i;
    out += poly([[116, top], [116 - L * 0.55, tipY], [116 - L * 0.55 + 12, tipY - 5], [120, top]], WHITE);
    out += poly([[124, top], [124 + L * 0.55, tipY], [124 + L * 0.55 - 12, tipY - 5], [120, top]], WHITE);
    out += rect(114, top, 12, 40, WHITE);
    for (i = 0; i < v.clip; i++) out += rect(112, top + 24 + i * 6, 16, 4.5, ORANGE, ' rx="1.5"');
    var arcs = Math.max(1, v.wing - 2);
    for (i = 0; i < arcs; i++) {
      var ry = 4 + i * 2, rx = L * 0.55 + 6 + i * 6, y = tipY - 7 - i * 3.5;
      out += '<path d="M' + r1(120 - rx) + ' ' + r1(y) + 'A' + r1(rx) + ' ' + ry + ' 0 0 0 ' + r1(120 + rx) + ' ' + r1(y) + '" stroke="' + ORANGE + '" stroke-width="1.1" fill="none" stroke-dasharray="4 3"/>';
    }
    for (i = 0; i <= v.clip; i++) out += line(104 - i * 6, top + 44, 104 - i * 6, Math.min(136, top + 52 + i * 6), ORANGE, 1, ' stroke-dasharray="2 3"');
    return wrap(out);
  };
  // 落ち葉の色（墨 + 橙）: 週 + 日当たり = 葉の中の橙の線の数 / 右に近い色のブロック 4 つ（苔 = 墨の点、黄 → 赤 = 橙の濃さ）。近いもの 1 つを囲む
  function leafTurn(v) { return Math.max(0, Math.min(9, Math.round((v.week - 1) * 2 + v.sun * 1.5))); }
  function leafColorIdx(v) { return Math.max(0, Math.min(3, Math.floor((leafTurn(v) + 1) / 2.6))); }
  ART.leaf = function (v) {
    var out = '', k = leafTurn(v), ci = leafColorIdx(v), i;
    out += '<path d="M84 16 Q132 52 84 136 Q36 52 84 16Z" fill="' + WHITE + '" stroke="' + INK + '" stroke-width="1.4" stroke-linejoin="round"/>';
    for (i = 0; i < 9; i++) {
      var y = 30 + i * 11, t = (y - 16) / 120, hw = Math.max(2, 46 * Math.sin(Math.PI * t) * 0.92 - 3);
      out += i < k ? line(84 - hw, y, 84 + hw, y, ORANGE, 2.2) : line(84 - hw, y, 84 + hw, y, INK, 0.9, so(0.3));
    }
    out += line(84, 18, 84, 146, INK, 1.2);
    for (i = 0; i < 4; i++) {
      var x = 150 + (i % 2) * 38, yy = 30 + Math.floor(i / 2) * 50;
      out += i === 0 ? rect(x, yy, 30, 30, WHITE) + circle(x + 10, yy + 12, 1.6, INK) + circle(x + 20, yy + 20, 1.6, INK) + circle(x + 22, yy + 9, 1.2, INK)
        : rect(x, yy, 30, 30, ORANGE, fo([0, 0.3, 0.6, 1][i]));
      if (i === ci) out += '<rect x="' + (x - 4) + '" y="' + (yy - 4) + '" width="38" height="38" rx="4" fill="none" stroke="' + INK + '" stroke-width="2"/>';
    }
    return wrap(out);
  };
  // 雪の結晶（墨 + 橙）: 気温 = 形（板・針・枝・扇）/ 湿り気 = 腕の長さと枝の数
  ART.snow = function (v) {
    var out = '', R = 30 + v.wet * 8, cx = 120, cy = 76, i, j;
    var arm = function (a, len, w) { return line(cx, cy, cx + Math.cos(a) * len, cy + Math.sin(a) * len, INK, w || 1.6); };
    if (v.temp === 0 || v.temp === 4) {
      var pr = v.temp === 0 ? R * 0.75 : R * 0.42, pts = [];
      for (i = 0; i < 6; i++) pts.push([cx + Math.cos(i * Math.PI / 3) * pr, cy + Math.sin(i * Math.PI / 3) * pr]);
      out += poly(pts, ORANGE, 1.4, fo(0.18));
    }
    for (i = 0; i < 6; i++) {
      var a = i * Math.PI / 3 - Math.PI / 2;
      if (v.temp === 1) { out += arm(a, R * 0.9, 2.6); continue; }
      out += arm(a, R, 1.6);
      if (v.temp === 4) {
        var fx = cx + Math.cos(a) * R, fy = cy + Math.sin(a) * R;
        out += poly([[cx + Math.cos(a - 0.22) * R * 0.55, cy + Math.sin(a - 0.22) * R * 0.55], [fx + Math.cos(a - 0.5) * 6, fy + Math.sin(a - 0.5) * 6], [fx + Math.cos(a + 0.5) * 6, fy + Math.sin(a + 0.5) * 6], [cx + Math.cos(a + 0.22) * R * 0.55, cy + Math.sin(a + 0.22) * R * 0.55]], WHITE, 1.1);
      }
      if (v.temp === 2 || v.temp === 3) {
        var nb = (v.temp === 2 ? 1 : 2) + v.wet;
        for (j = 1; j <= nb; j++) {
          var d = R * j / (nb + 1), bx = cx + Math.cos(a) * d, by = cy + Math.sin(a) * d, bl = 6 + (nb - j) * 2;
          out += line(bx, by, bx + Math.cos(a - 0.9) * bl, by + Math.sin(a - 0.9) * bl, INK, 1.1, so(0.6)) + line(bx, by, bx + Math.cos(a + 0.9) * bl, by + Math.sin(a + 0.9) * bl, INK, 1.1, so(0.6));
        }
      }
      out += circle(cx + Math.cos(a) * (R + (v.temp === 1 ? -3 : 3)), cy + Math.sin(a) * (R + (v.temp === 1 ? -3 : 3)), 1.8, ORANGE);
    }
    out += circle(cx, cy, 3, ORANGE, INK, 1);
    return wrap(out);
  };
  // 案内板（墨 + 橙）: 文字の大きさ = 3 行の文字の太さ / 離れる距離 = 人の位置と大きさ。読める行は塗り、読めない行は淡い破線
  var DIST = [2, 5, 10, 20, 30];
  function signRows(v) { var out = []; for (var r = 0; r < 3; r++) out.push((v.size + 2 - r) * 5 >= DIST[v.dist]); return out; }
  ART.sign = function (v) {
    var out = ground(), rows = signRows(v), r;
    out += line(60, 98, 60, 140, INK, 2) + line(126, 98, 126, 140, INK, 2);
    out += rect(30, 18, 128, 80, WHITE, ' rx="6"');
    var y = 28;
    for (r = 0; r < 3; r++) {
      var h = (v.size + 2 - r) * 2.4, w = [86, 66, 76][r];
      out += rows[r] ? '<rect x="40" y="' + r1(y) + '" width="' + w + '" height="' + r1(h) + '" rx="1.5" fill="' + INK + '"/>'
        : '<rect x="40" y="' + r1(y) + '" width="' + w + '" height="' + r1(h) + '" rx="1.5" fill="none" stroke="' + INK + '" stroke-width="1" stroke-dasharray="3 2"' + so(0.45) + '/>';
      y += h + 6;
    }
    out += arrow(140, 34, 1, ORANGE);
    var px = 172 + v.dist * 12, s = 1 - v.dist * 0.14, head = 132 - 40 * s;
    out += circle(px, head, 5 * s + 1, WHITE, INK, 1.3) + line(px, head + 6 * s, px, 140 - 12 * s, INK, 1.4) +
      line(px, 140 - 12 * s, px - 5 * s, 140, INK, 1.4) + line(px, 140 - 12 * s, px + 5 * s, 140, INK, 1.4) + line(px - 6 * s, head + 14 * s, px + 6 * s, head + 14 * s, INK, 1.4);
    out += line(158, 146, px, 146, ORANGE, 0.9, ' stroke-dasharray="2 3"');
    return wrap(out);
  };
  // どんぐり（墨 + 橙）: 長さ・太さ = 実の形 / 帽子の模様（細長い = しま、丸い = うろこ）/ 右に近いなかまの形を囲む
  function acornKind(v) { return v.len - v.width >= 2 ? 2 : (v.width - v.len >= 1 ? 0 : 1); }
  function acorn(cx, cy, rx, ry, stripes, tint) {
    var out = '<ellipse cx="' + r1(cx) + '" cy="' + r1(cy + ry * 0.25) + '" rx="' + r1(rx) + '" ry="' + r1(ry) + '" fill="' + (tint ? ORANGE : WHITE) + '"' + (tint ? fo(0.25) : '') + ' stroke="' + INK + '" stroke-width="1.3"/>';
    var capY = cy - ry * 0.45;
    out += '<path d="M' + r1(cx - rx - 2) + ' ' + r1(capY) + 'Q' + r1(cx) + ' ' + r1(capY - ry * 0.9) + ' ' + r1(cx + rx + 2) + ' ' + r1(capY) + 'Z" fill="' + INK + '"' + fo(0.12) + ' stroke="' + INK + '" stroke-width="1.3" stroke-linejoin="round"/>';
    if (stripes) { for (var i = 1; i <= 2; i++) out += line(cx - rx + i * 2, capY - i * ry * 0.18, cx + rx - i * 2, capY - i * ry * 0.18, INK, 0.9, so(0.55)); }
    else { for (var j = -1; j <= 1; j++) out += '<path d="M' + r1(cx + j * rx * 0.55 - 3) + ' ' + r1(capY - 3) + 'q3 -4 6 0" stroke="' + INK + '" stroke-width="0.9" fill="none"' + so(0.55) + '/>'; }
    out += line(cx, capY - ry * 0.45, cx + 2, capY - ry * 0.45 - 7, INK, 1.4);
    return out;
  }
  ART.acorn = function (v) {
    var out = ground(), k = acornKind(v), i;
    out += acorn(86, 82, 10 + v.width * 4, 14 + v.len * 6, v.len > v.width, true);
    // 右の列: 丸い / その間 / 細長い なかまの形（帯 42 ずつ。近いものを橙の枠で囲む）
    var refs = [[33, 15, 15, false], [75, 13, 20, false], [117, 9, 24, true]];
    for (i = 0; i < 3; i++) {
      var p = refs[i], band = 34 + i * 42;
      out += acorn(190, p[0], p[1] * 0.7, p[2] * 0.55, p[3], false);
      if (i === k) out += '<rect x="166" y="' + (band - 20) + '" width="48" height="40" rx="6" fill="none" stroke="' + ORANGE + '" stroke-width="1.8"/>';
    }
    return wrap(out);
  };
  // 冬鳥（墨 + 橙）: 群れの数 = V の字の鳥の数 / 風 = 下の矢印の向き（向かい風 = 墨、追い風 = 橙）
  ART.birds = function (v) {
    var out = '', i;
    out += '<ellipse cx="120" cy="132" rx="96" ry="10" fill="' + INK + '"' + fo(0.06) + ' stroke="' + INK + '" stroke-width="1"' + so(0.4) + '/>';
    for (i = 0; i < v.n; i++) {
      var rank = Math.ceil(i / 2), side = i % 2 ? -1 : 1, x = 178 - rank * 17, y = 54 + (i ? side * rank * 9 : 0);
      out += '<path d="M' + r1(x - 7) + ' ' + r1(y) + 'Q' + r1(x - 3.5) + ' ' + r1(y - 5) + ' ' + r1(x) + ' ' + r1(y) + 'Q' + r1(x + 3.5) + ' ' + r1(y - 5) + ' ' + r1(x + 7) + ' ' + r1(y) + '" stroke="' + INK + '" stroke-width="1.6" fill="none" stroke-linecap="round"/>';
    }
    if (v.wind === 1) out += line(60, 108, 180, 108, INK, 1, ' stroke-dasharray="2 5"' + so(0.5));
    else for (i = 0; i < 3; i++) out += arrow(80 + i * 40, 108, v.wind === 0 ? -1 : 1, v.wind === 0 ? INK : ORANGE);
    out += circle(40, 30, 9, ORANGE, INK, 1.2);
    return wrap(out);
  };
  TDD.drawArt = function (kind, values) { return ART[kind] ? ART[kind](values || {}) : ''; };

  // ---------- スライダーと結果 1 行（決定論。「このモックでの動き」として出す） ----------
  function names(list) { return list.map(function (p) { return Array.isArray(p) ? p : [p, p]; }); }
  function nm(sl, v) { var p = sl.names ? sl.names[v - sl.min] : null; return p || [String(v), String(v)]; }
  var WIND = names([['なし', 'なし'], ['そよ風', 'そよかぜ'], ['ふつう', 'ふつう'], ['強い', 'つよい'], ['とても強い', 'とてもつよい']]);
  var WEIGHT = names([['軽い', 'かるい'], ['ふつう', 'ふつう'], ['重い', 'おもい']]);
  var DARK = names([['明るい', 'あかるい'], ['少し暗い', '少しくらい'], ['夕方', 'ゆうがた'], ['暗い', 'くらい'], ['夜', 'よる']]);
  var SIZE5 = names([['とても小さい', 'とても小さい'], ['小さい', '小さい'], ['ふつう', 'ふつう'], ['大きい', '大きい'], ['とても大きい', 'とても大きい']]);
  var SUN = names([['日かげ', 'ひかげ'], ['半分', 'はんぶん'], ['日なた', 'ひなた']]);
  var TEMP = names(['-2 ℃', '-5 ℃', '-10 ℃', '-15 ℃', '-20 ℃']);
  var WET = names([['乾いている', 'かわいている'], ['ふつう', 'ふつう'], ['湿っている', 'しめっている']]);
  var WINDDIR = names([['向かい風', 'むかいかぜ'], ['風なし', 'かぜなし'], ['追い風', 'おいかぜ']]);

  // ---------- お題 9 本 ----------
  var TOPICS = [
    // ===== near（いつもの好きに近い）=====
    {
      id: 'od-py-leaves', fit: 'near', art: 'leaves', safety: false, outdoor: false, source: 'buddy', due: null, makeTheme: 'py', makeVariant: 'catch',
      title: ['落ち葉がひらひら舞うようす、Python のゲームで動かせる？', 'おちばがひらひらまうようす、Python のゲームでうごかせる？'],
      firstStep: ['葉っぱを 1 枚だけ、画面の上から落としてみる', 'はっぱを 1 まいだけ、画面の上からおとしてみる'],
      need: ['Python が動くパソコン · 教室の中', 'Python がうごくパソコン · 教室の中'],
      reason: ['「Python のゲーム作りやってみたい」と話していたから', '「Python のゲーム作りやってみたい」と話していたから'],
      watch: { src: ['出典: 自然観察の公式チャンネル（架空）', 'しゅってん: しぜんかんさつのこうしきチャンネル（かくう）'], points: [
        { t: '0:10', text: ['まっすぐではなく、左右にゆれて落ちる', 'まっすぐではなく、左右にゆれておちる'] },
        { t: '0:30', text: ['風が吹くと、横に流される', 'かぜがふくと、よこにながされる'] },
        { t: '0:50', text: ['軽い葉ほど、長く空中にいる', 'かるい葉ほど、長くくうちゅうにいる'] }] },
      find: { hints: [['窓から見える木を 1 本決める', 'まどから見える木を 1 本きめる'], ['まっすぐ落ちる葉', 'まっすぐおちる葉'], ['左右にゆれながら落ちる葉', '左右にゆれながらおちる葉']],
        photos: [{ id: 'p1', label: ['風のない日の落ち葉', 'かぜのない日のおちば'], values: { wind: 0, weight: 2 } },
          { id: 'p2', label: ['風で流される落ち葉', 'かぜでながされるおちば'], values: { wind: 3, weight: 1 } },
          { id: 'p3', label: ['ひらひら舞う軽い葉', 'ひらひらまうかるい葉'], values: { wind: 1, weight: 1 } }] },
      play: { sliders: [{ key: 'wind', label: ['風の強さ', 'かぜのつよさ'], min: 0, max: 4, def: 1, names: WIND }, { key: 'weight', label: ['葉の重さ', '葉のおもさ'], min: 1, max: 3, def: 2, names: WEIGHT }],
        result: function (v) {
          var amp = leavesAmp(v), t = Math.round((1.2 + (3 - v.weight) * 0.6 + v.wind * 0.2) * 10) / 10, w = WIND[v.wind], g = WEIGHT[v.weight - 1];
          return ['風: ' + w[0] + '・葉: ' + g[0] + ' → 左右に ' + amp + ' cm ゆれながら、約 ' + t + ' 秒で地面に着く',
            'かぜ: ' + w[1] + '・葉: ' + g[1] + ' → 左右に ' + amp + ' cm ゆれながら、やく ' + t + ' びょうで地面につく'];
        } },
      makeSteps: []
    },
    {
      id: 'od-mc-roof', fit: 'near', art: 'mcroof', safety: false, outdoor: false, source: 'buddy', due: null, makeTheme: 'mc', makeVariant: 'roof',
      title: ['どんぐりの帽子みたいな屋根、マイクラのブロックで建てられる？', 'どんぐりのぼうしみたいなやね、マイクラのブロックでたてられる？'],
      firstStep: ['屋根を何段にするか決めて、いちばん下の段を置く', 'やねを何だんにするかきめて、いちばん下のだんをおく'],
      need: ['マイクラ（いつものワールド）· 教室の中', 'マイクラ（いつものワールド）· 教室の中'],
      reason: ['石で塔を建てていたから、その上にのせる屋根を作れそう', '石でとうをたてていたから、その上にのせるやねをつくれそう'],
      watch: { src: ['出典: 森の観察の公式チャンネル（架空）', 'しゅってん: もりのかんさつのこうしきチャンネル（かくう）'], points: [
        { t: '0:10', text: ['帽子は、うろこが重なった形', 'ぼうしは、うろこがかさなった形'] },
        { t: '0:30', text: ['下から上へ、少しずつ小さくなる', '下から上へ、少しずつ小さくなる'] },
        { t: '0:50', text: ['帽子を外すと、中は平ら', 'ぼうしをはずすと、中はたいら'] }] },
      find: { hints: [['窓から見える、とがった屋根', 'まどから見える、とがったやね'], ['段が重なっている屋根', 'だんがかさなっているやね'], ['図鑑にのっている、どんぐりの帽子', 'ずかんにのっている、どんぐりのぼうし']],
        photos: [{ id: 'p1', label: ['低い屋根', 'ひくいやね'], values: { size: 3, block: 0 } },
          { id: 'p2', label: ['段の多い屋根', 'だんの多いやね'], values: { size: 6, block: 2 } },
          { id: 'p3', label: ['ガラスの屋根', 'ガラスのやね'], values: { size: 4, block: 1 } }] },
      play: { sliders: [{ key: 'size', label: ['段の数', 'だんの数'], min: 2, max: 6, def: 4, names: [2, 3, 4, 5, 6].map(function (n) { return [n + ' 段', n + ' だん']; }) },
        { key: 'block', label: ['ブロック', 'ブロック'], min: 0, max: 2, def: 2, names: [['石', '石'], ['ガラス', 'ガラス'], ['オークの板', 'オークのいた']] }],
        result: function (v) {
          var st = { kind: 'sample', theme: 'mc', variant: 'roof', values: { size: v.size, block: v.block } };
          return [MD.result(st, 'js'), MD.result(st, 'es')];
        } },
      makeSteps: []
    },
    {
      id: 'od-circuit-dusk', fit: 'near', art: 'dusk', safety: false, outdoor: false, source: 'buddy', due: null, makeTheme: 'circuit', makeVariant: 'switch',
      title: ['夕方が早くなった。暗くなったら灯る明かり、回路で作れる？', 'ゆうがたが早くなった。くらくなったらつく明かり、回路でつくれる？'],
      firstStep: ['電池 1 個と電球 1 個で、まず明かりをつける', '電池 1 こと電球 1 こで、まず明かりをつける'],
      need: ['電池・電球・導線（教室の電気キット）', '電池・電球・どうせん（教室のでんきキット）'],
      reason: ['前に「電球がつく回路」を作っていたから', '前に「電球がつく回路」をつくっていたから'],
      watch: { src: ['出典: 科学館の公式チャンネル（架空）', 'しゅってん: かがくかんのこうしきチャンネル（かくう）'], points: [
        { t: '0:15', text: ['光を感じる部品がある', '光をかんじるぶひんがある'] },
        { t: '0:35', text: ['暗くなると、電気が流れ始める', 'くらくなると、でんきがながれはじめる'] },
        { t: '0:55', text: ['朝になると、自動で消える', 'あさになると、じどうできえる'] }] },
      find: { hints: [['暗くなると自動でつく明かり', 'くらくなるとじどうでつく明かり'], ['人が通るとつく明かり', '人がとおるとつく明かり'], ['スイッチを押してつける明かり', 'スイッチをおしてつける明かり']],
        photos: [{ id: 'p1', label: ['昼の窓', 'ひるのまど'], values: { dark: 0, cells: 1 } },
          { id: 'p2', label: ['夕方の窓と明かり', 'ゆうがたのまどと明かり'], values: { dark: 2, cells: 2 } },
          { id: 'p3', label: ['夜の明かり', 'よるの明かり'], values: { dark: 4, cells: 3 } }] },
      play: { sliders: [{ key: 'dark', label: ['外の暗さ', 'そとのくらさ'], min: 0, max: 4, def: 2, names: DARK }, { key: 'cells', label: ['電池の数', '電池の数'], min: 1, max: 3, def: 1, names: [['1 個', '1 こ'], ['2 個', '2 こ'], ['3 個', '3 こ']] }],
        result: function (v) {
          var on = v.dark >= 2, B = on ? Math.min(100, 30 + v.cells * 23) : 0, d = DARK[v.dark];
          return ['外が' + d[0] + ': 明かりは' + (on ? 'ついている' : '消えている') + '（電池 ' + v.cells + ' 個・明るさ ' + B + '%）',
            'そとが' + d[1] + ': 明かりは' + (on ? 'ついている' : 'きえている') + '（電池 ' + v.cells + ' こ・明るさ ' + B + '%）'];
        } },
      makeSteps: []
    },
    // ===== next（少し隣）=====
    {
      id: 'od-seed', fit: 'next', art: 'seed', safety: true, outdoor: true, source: 'buddy', due: null, makeTheme: null,
      title: ['回りながら落ちる種。紙でも再現できる？', '回りながらおちるたね。紙でもまねできる？'],
      firstStep: ['紙を細長く切って、片方に羽を 2 枚つくる', '紙をほそながく切って、かたほうにはねを 2 まいつくる'],
      need: ['紙・はさみ・クリップ · 少し高い場所', '紙・はさみ・クリップ · 少し高いところ'],
      reason: ['ゲームで落ちる速さを変えていたから、本物の落ち方も見てみよう', 'ゲームでおちるはやさをかえていたから、ほんもののおちかたも見てみよう'],
      watch: { src: ['出典: 植物観察の公式チャンネル（架空）', 'しゅってん: しょくぶつかんさつのこうしきチャンネル（かくう）'], points: [
        { t: '0:20', text: ['羽が回り始める', 'はねが回りはじめる'] },
        { t: '0:45', text: ['回ると、ゆっくり落ちる', '回ると、ゆっくりおちる'] },
        { t: '1:10', text: ['風で遠くまで運ばれる', 'かぜでとおくまではこばれる'] }] },
      find: { hints: [['羽が 1 枚の種', 'はねが 1 まいのたね'], ['羽が 2 枚つながった種', 'はねが 2 まいつながったたね'], ['木の下に落ちている種', '木の下におちているたね']],
        photos: [{ id: 'p1', label: ['羽の短い種', 'はねのみじかいたね'], values: { wing: 2, clip: 0 } },
          { id: 'p2', label: ['羽の長い種', 'はねの長いたね'], values: { wing: 6, clip: 0 } },
          { id: 'p3', label: ['重めの種', 'おもめのたね'], values: { wing: 4, clip: 2 } }] },
      play: { sliders: [{ key: 'wing', label: ['羽の長さ', 'はねの長さ'], min: 2, max: 6, def: 4, names: [2, 3, 4, 5, 6].map(function (n) { return [n + ' cm', n + ' cm']; }) },
        { key: 'clip', label: ['クリップの数', 'クリップの数'], min: 0, max: 2, def: 1, names: [['0 個', '0 こ'], ['1 個', '1 こ'], ['2 個', '2 こ']] }],
        result: function (v) {
          var t = Math.round((0.6 + v.wing * 0.22 - v.clip * 0.18) * 10) / 10, sp = v.wing <= 2 ? 0 : (v.wing <= 4 ? 1 : 2);
          var spin = [['ほとんど回らずに', 'ほとんど回らずに'], ['ゆっくり回りながら', 'ゆっくり回りながら'], ['くるくる速く回りながら', 'くるくるはやく回りながら']][sp];
          return ['羽 ' + v.wing + ' cm・クリップ ' + v.clip + ' 個: ' + spin[0] + '、1 m を約 ' + t + ' 秒で落ちる',
            'はね ' + v.wing + ' cm・クリップ ' + v.clip + ' こ: ' + spin[1] + '、1 m をやく ' + t + ' びょうでおちる'];
        } },
      makeSteps: [['紙を細長く切る', '紙をほそながく切る'], ['羽を 2 枚に折り分けて、クリップを付ける', 'はねを 2 まいにおりわけて、クリップをつける'],
        ['高いところから落として、回り方を見る', '高いところからおとして、回りかたを見る'], ['羽の長さを変えて、もう一度落とす', 'はねの長さをかえて、もういちどおとす']]
    },
    {
      id: 'od-leaf-color', fit: 'next', art: 'leaf', safety: true, outdoor: true, source: 'buddy', due: null, makeTheme: null,
      title: ['落ち葉の色、マイクラのブロックでいうと何色？', 'おちばの色、マイクラのブロックでいうと何色？'],
      firstStep: ['色の違う落ち葉を 3 枚拾って、並べてみる', '色のちがうおちばを 3 まいひろって、ならべてみる'],
      need: ['落ち葉 3 枚・白い紙 · 近くの公園', 'おちば 3 まい・白い紙 · 近くのこうえん'],
      reason: ['マイクラでブロックの色を選んでいたから、本物の色とくらべてみよう', 'マイクラでブロックの色をえらんでいたから、ほんものの色とくらべてみよう'],
      watch: { src: ['出典: 自然観察の公式チャンネル（架空）', 'しゅってん: しぜんかんさつのこうしきチャンネル（かくう）'], points: [
        { t: '0:15', text: ['緑がぬけて、黄色が見えてくる', 'みどりがぬけて、きいろが見えてくる'] },
        { t: '0:35', text: ['赤い色は、秋に新しくできる', 'あかい色は、秋にあたらしくできる'] },
        { t: '0:55', text: ['最後は茶色になって落ちる', 'さいごはちゃいろになっておちる'] }] },
      find: { hints: [['赤い葉', 'あかい葉'], ['黄色い葉', 'きいろい葉'], ['半分だけ色が変わった葉', 'はんぶんだけ色がかわった葉']],
        photos: [{ id: 'p1', label: ['まだ緑の葉', 'まだみどりの葉'], values: { week: 1, sun: 0 } },
          { id: 'p2', label: ['黄色くなった葉', 'きいろくなった葉'], values: { week: 2, sun: 1 } },
          { id: 'p3', label: ['赤くなった葉', 'あかくなった葉'], values: { week: 4, sun: 2 } }] },
      play: { sliders: [{ key: 'week', label: ['11 月の何週目', '11 月の何しゅう目'], min: 1, max: 4, def: 2, names: [1, 2, 3, 4].map(function (n) { return [n + ' 週目', n + ' しゅう目']; }) },
        { key: 'sun', label: ['日当たり', 'ひあたり'], min: 0, max: 2, def: 1, names: SUN }],
        result: function (v) {
          var ci = leafColorIdx(v), s = SUN[v.sun];
          var col = [['緑が残る', 'みどりがのこる'], ['黄色', 'きいろ'], ['だいだい', 'だいだい'], ['赤', 'あか']][ci];
          var blk = [['苔ブロック', 'こけブロック'], ['黄色のテラコッタ', 'きいろのテラコッタ'], ['オレンジのテラコッタ', 'オレンジのテラコッタ'], ['赤のコンクリート', 'あかのコンクリート']][ci];
          return [v.week + ' 週目・' + s[0] + ': 葉は' + col[0] + 'っぽい色。近いブロックは「' + blk[0] + '」',
            v.week + ' しゅう目・' + s[1] + ': 葉は' + col[1] + 'っぽい色。近いブロックは「' + blk[1] + '」'];
        } },
      makeSteps: [['色の違う落ち葉を集める', '色のちがうおちばをあつめる'], ['近い色のブロックを探す', '近い色のブロックをさがす'], ['葉とブロックの色の表を作る', '葉とブロックの色の表をつくる']]
    },
    {
      id: 'od-snow', fit: 'next', art: 'snow', safety: false, outdoor: false, source: 'buddy', due: null, makeTheme: null,
      title: ['初雪の便りが届いた。雪の結晶は、なぜ 6 つの角？', 'はつゆきのたよりがとどいた。雪のけっしょうは、どうして 6 つのかど？'],
      firstStep: ['紙を 6 つに折って、手でちぎって形を作ってみる', '紙を 6 つにおって、手でちぎって形をつくってみる'],
      need: ['折り紙 · 教室の中', 'おりがみ · 教室の中'],
      reason: ['同じ形をくり返してブロックを積んでいたから、自然のくり返しの形も見つかりそう', 'おなじ形をくりかえしてブロックをつんでいたから、しぜんのくりかえしの形も見つかりそう'],
      watch: { src: ['出典: 気象の公式チャンネル（架空）', 'しゅってん: きしょうのこうしきチャンネル（かくう）'], points: [
        { t: '0:15', text: ['小さな六角形から育ち始める', '小さな六角形からそだちはじめる'] },
        { t: '0:40', text: ['6 つの角から枝がのびる', '6 つのかどからえだがのびる'] },
        { t: '1:00', text: ['同じ形は 1 つもない', 'おなじ形は 1 つもない'] }] },
      find: { hints: [['六角形のもの（えんぴつ・ボルトの頭など）', '六角形のもの（えんぴつ・ボルトのあたまなど）'], ['同じ形がくり返す模様', 'おなじ形がくりかえすもよう'], ['冷たい窓にできた模様（朝）', 'つめたいまどにできたもよう（あさ）']],
        photos: [{ id: 'p1', label: ['六角形の板の結晶', '六角形のいたのけっしょう'], values: { temp: 0, wet: 1 } },
          { id: 'p2', label: ['枝の多い結晶', 'えだの多いけっしょう'], values: { temp: 3, wet: 2 } },
          { id: 'p3', label: ['針のような結晶', 'はりのようなけっしょう'], values: { temp: 1, wet: 0 } }] },
      play: { sliders: [{ key: 'temp', label: ['気温', 'きおん'], min: 0, max: 4, def: 2, names: TEMP }, { key: 'wet', label: ['空気の湿り気', 'くうきのしめりけ'], min: 0, max: 2, def: 1, names: WET }],
        result: function (v) {
          var sh = [['六角形の板', '六角形のいた'], ['針のような形', 'はりのような形'], ['枝の多い星形', 'えだの多い星形'], ['枝がとても多い星形', 'えだがとても多い星形'], ['扇の形の板', 'おうぎの形のいた']][v.temp];
          var w = WET[v.wet];
          return [TEMP[v.temp][0] + '・' + w[0] + ': ' + sh[0] + 'の結晶になりやすい', TEMP[v.temp][1] + '・' + w[1] + ': ' + sh[1] + 'のけっしょうになりやすい'];
        } },
      makeSteps: [['紙を 6 つに折る', '紙を 6 つにおる'], ['手でちぎって切りこみを作る', '手でちぎって切りこみをつくる'], ['開いて、角と模様を見る', 'ひらいて、かどともようを見る'], ['違う折り方で、もう 1 枚作る', 'ちがうおりかたで、もう 1 まいつくる']]
    },
    // ===== new（普段は出会わないもの）=====
    {
      id: 'od-sign', fit: 'new', art: 'sign', safety: true, outdoor: true, source: 'buddy', due: null, makeTheme: null,
      title: ['この街の案内板、初めて来た人にも伝わる？', 'このまちのあんないばん、はじめて来た人にもつたわる？'],
      firstStep: ['近くの案内板を 1 つ選んで、初めて来た人のつもりで読む', '近くのあんないばんを 1 つえらんで、はじめて来た人のつもりでよむ'],
      need: ['タブレット（写真用）· 教室のまわりの道', 'タブレット（写真用）· 教室のまわりの道'],
      reason: ['建物に入口を作っていたから、街の「入口の案内」も見てみよう', 'たてものに入り口をつくっていたから、まちの「入り口のあんない」も見てみよう'],
      watch: { src: ['出典: まちづくりの公式チャンネル（架空）', 'しゅってん: まちづくりのこうしきチャンネル（かくう）'], points: [
        { t: '0:15', text: ['遠くからでも読める文字の大きさ', 'とおくからでもよめる文字の大きさ'] },
        { t: '0:40', text: ['文字の代わりになる絵の印', '文字のかわりになる絵のしるし'] },
        { t: '1:00', text: ['「今いる場所」の書き方', '「今いるところ」のかきかた'] }] },
      find: { hints: [['矢印がある案内板', 'やじるしがあるあんないばん'], ['今いる場所が書いてある地図', '今いるところがかいてある地図'], ['文字の代わりに絵の印がある看板', '文字のかわりに絵のしるしがあるかんばん']],
        photos: [{ id: 'p1', label: ['近くで見た案内板', '近くで見たあんないばん'], values: { size: 2, dist: 0 } },
          { id: 'p2', label: ['遠くから見た案内板', 'とおくから見たあんないばん'], values: { size: 3, dist: 3 } },
          { id: 'p3', label: ['大きな文字の案内板', '大きな文字のあんないばん'], values: { size: 5, dist: 2 } }] },
      play: { sliders: [{ key: 'size', label: ['文字の大きさ', '文字の大きさ'], min: 1, max: 5, def: 3, names: SIZE5 }, { key: 'dist', label: ['離れる距離', 'はなれるきょり'], min: 0, max: 4, def: 2, names: DIST.map(function (m) { return [m + ' m', m + ' m']; }) }],
        result: function (v) {
          var ok = signRows(v).filter(Boolean).length, d = DIST[v.dist];
          return [d + ' m 離れると、3 行のうち ' + ok + ' 行が読める（文字: ' + SIZE5[v.size - 1][0] + '）', d + ' m はなれると、3 行のうち ' + ok + ' 行がよめる（文字: ' + SIZE5[v.size - 1][1] + '）'];
        } },
      makeSteps: [['案内板を 1 つ選んで写真を撮る', 'あんないばんを 1 つえらんで写真をとる'], ['初めて来た人のつもりで読んでみる', 'はじめて来た人のつもりでよんでみる'],
        ['迷いそうなところに印を付ける', 'まよいそうなところにしるしをつける'], ['伝わる案内板を紙に描き直す', 'つたわるあんないばんを紙にかきなおす']]
    },
    {
      id: 'od-acorn-card', fit: 'new', art: 'acorn', safety: true, outdoor: true, source: 'request', due: ['11/20（金）', '11/20（金）'], makeTheme: null,
      title: ['図書館の秋の展示に、どんぐりの見分け方カードを作れる？', 'としょかんの秋のてんじに、どんぐりの見分けかたカードをつくれる？'],
      firstStep: ['どんぐりを 3 つ並べて、帽子と形の違いを見る', 'どんぐりを 3 つならべて、ぼうしと形のちがいを見る'],
      need: ['どんぐり 3 種類・紙と色えんぴつ · 近くの公園', 'どんぐり 3 しゅるい・紙と色えんぴつ · 近くのこうえん'],
      reason: ['近くの図書館から届いた依頼。形を見くらべるのは、ブロックで形を作るときと似ているから', '近くのとしょかんからとどいたいらい。形を見くらべるのは、ブロックで形をつくるときとにているから'],
      watch: { src: ['出典: 森の観察の公式チャンネル（架空）', 'しゅってん: もりのかんさつのこうしきチャンネル（かくう）'], points: [
        { t: '0:10', text: ['丸いどんぐりと、細長いどんぐり', 'まるいどんぐりと、ほそながいどんぐり'] },
        { t: '0:30', text: ['帽子のしま模様と、うろこ模様', 'ぼうしのしまもようと、うろこもよう'] },
        { t: '0:50', text: ['葉の形も、見分ける手がかり', '葉の形も、見分けるてがかり'] }] },
      find: { hints: [['丸いどんぐり', 'まるいどんぐり'], ['細長いどんぐり', 'ほそながいどんぐり'], ['帽子にしま模様があるどんぐり', 'ぼうしにしまもようがあるどんぐり']],
        photos: [{ id: 'p1', label: ['丸いどんぐり', 'まるいどんぐり'], values: { len: 1, width: 4 } },
          { id: 'p2', label: ['細長いどんぐり', 'ほそながいどんぐり'], values: { len: 5, width: 2 } },
          { id: 'p3', label: ['中くらいのどんぐり', '中くらいのどんぐり'], values: { len: 3, width: 3 } }] },
      play: { sliders: [{ key: 'len', label: ['実の長さ', 'みの長さ'], min: 1, max: 5, def: 3, names: SIZE5 }, { key: 'width', label: ['実の太さ', 'みのふとさ'], min: 1, max: 5, def: 3, names: SIZE5 }],
        result: function (v) {
          var k = [['丸いなかま', 'まるいなかま'], ['その間のなかま', 'そのあいだのなかま'], ['細長いなかま', 'ほそながいなかま']][acornKind(v)];
          return ['長さ ' + SIZE5[v.len - 1][0] + '・太さ ' + SIZE5[v.width - 1][0] + ': ' + k[0] + 'に近い形', '長さ ' + SIZE5[v.len - 1][1] + '・ふとさ ' + SIZE5[v.width - 1][1] + ': ' + k[1] + 'に近い形'];
        } },
      makeSteps: [['どんぐりを 3 種類集める', 'どんぐりを 3 しゅるいあつめる'], ['帽子と形の違いを見くらべる', 'ぼうしと形のちがいを見くらべる'],
        ['見分け方を 1 枚のカードに描く', '見分けかたを 1 まいのカードにかく'], ['写真を撮って、作品に残す', '写真をとって、作品にのこす']]
    },
    {
      id: 'od-bird', fit: 'new', art: 'birds', safety: true, outdoor: true, source: 'buddy', due: null, makeTheme: null,
      title: ['冬鳥がやって来た。遠くから、どうやって道を見つけるの？', 'ふゆどりがやってきた。とおくから、どうやって道を見つけるの？'],
      firstStep: ['近くの池で、群れで来ている鳥を 1 種類見つける', '近くの池で、むれで来ている鳥を 1 しゅるい見つける'],
      need: ['双眼鏡（あれば）· 近くの池や川', 'そうがんきょう（あれば）· 近くの池や川'],
      reason: ['マイクラの島を歩き回って道を覚えていたから、鳥の「道さがし」もおもしろいかも', 'マイクラのしまを歩きまわって道をおぼえていたから、鳥の「道さがし」もおもしろいかも'],
      watch: { src: ['出典: 野鳥観察の公式チャンネル（架空）', 'しゅってん: やちょうかんさつのこうしきチャンネル（かくう）'], points: [
        { t: '0:15', text: ['V の字になって飛ぶ', 'V の字になってとぶ'] },
        { t: '0:40', text: ['太陽の向きを手がかりにする', 'たいようのむきをてがかりにする'] },
        { t: '1:05', text: ['毎年、同じ池にもどってくる', 'まいとし、おなじ池にもどってくる'] }] },
      find: { hints: [['群れで泳いでいる鳥', 'むれでおよいでいる鳥'], ['V の字で飛んでいる群れ', 'V の字でとんでいるむれ'], ['水辺で休んでいる鳥', 'みずべで休んでいる鳥']],
        photos: [{ id: 'p1', label: ['小さな群れ', '小さなむれ'], values: { n: 3, wind: 1 } },
          { id: 'p2', label: ['大きな V の字', '大きな V の字'], values: { n: 9, wind: 2 } },
          { id: 'p3', label: ['向かい風の群れ', 'むかいかぜのむれ'], values: { n: 6, wind: 0 } }] },
      play: { sliders: [{ key: 'n', label: ['群れの数', 'むれの数'], min: 3, max: 9, def: 5, names: [3, 4, 5, 6, 7, 8, 9].map(function (n) { return [n + ' 羽', n + ' わ']; }) },
        { key: 'wind', label: ['風', 'かぜ'], min: 0, max: 2, def: 1, names: WINDDIR }],
        result: function (v) {
          var km = 200 + v.n * 15 + (v.wind - 1) * 120, w = WINDDIR[v.wind];
          return [v.n + ' 羽・' + w[0] + ': 1 日に約 ' + km + ' km 進む', v.n + ' わ・' + w[1] + ': 1 日にやく ' + km + ' km すすむ'];
        } },
      makeSteps: [['見る鳥を 1 種類決める', '見る鳥を 1 しゅるいきめる'], ['見た日・場所・数をメモする', '見た日・ばしょ・数をメモする'], ['1 週間分を 1 枚の表にまとめる', '1 しゅうかんぶんを 1 まいの表にまとめる']]
    }
  ];
  TDD.topics = TOPICS;
  TDD.get = function (id) { for (var i = 0; i < TOPICS.length; i++) if (TOPICS[i].id === id) return TOPICS[i]; return null; };
  TDD.pool = function (fit) { return TOPICS.filter(function (t) { return t.fit === fit; }).map(function (t) { return t.id; }); };
  TDD.defaults = function (odai) { var v = {}; (odai && odai.play ? odai.play.sliders : []).forEach(function (s) { v[s.key] = s.def; }); return v; };
  TDD.valueName = function (slider, v) { return nm(slider, v); };
  // カード・詳細の絵（スライダーの既定値の線画）
  TDD.cardArt = function (odai) { return odai ? TDD.drawArt(odai.art, TDD.defaults(odai)) : ''; };
  TDD.photo = function (odai, photoId) {
    var list = odai && odai.find ? odai.find.photos : [];
    for (var i = 0; i < list.length; i++) if (list[i].id === photoId) return list[i];
    return null;
  };
  // 見つけた写真のダミー（お題の線画 + 写真の四隅）
  TDD.photoArt = function (odai, photoId) {
    var p = TDD.photo(odai, photoId);
    if (!p) return '';
    var v = TDD.defaults(odai);
    Object.keys(p.values).forEach(function (k) { v[k] = p.values[k]; });
    return TDD.drawArt(odai.art, v).replace('</svg>', corners() + '</svg>').replace('class="mk-art td-art"', 'class="mk-art td-art is-photo"');
  };

  // ---------- 作るの作業台（3 題材に無いお題 = theme 'odai' の外で作る活動）に渡す中身 ----------
  // 作業台の「写真を足す」のダミー: そのお題の線画（探す写真と同じ 3 枚を順に）。make-data.js の MD.photoArt がここを呼ぶ
  TDD.workPhotoArt = function (photo) {
    var o = TDD.get(photo && photo.odai);
    if (!o) return TDD.frameOnly();
    var list = o.find.photos;
    return TDD.photoArt(o, list[((photo.n || 0) % list.length + list.length) % list.length].id);
  };
  TDD.photoCount = function (id) { var o = TDD.get(id); return o ? o.find.photos.length : 3; };
  if (MD) MD.odaiPhotoArt = TDD.workPhotoArt;
  // 「バディに任せる」の候補で作るメモ（お題の makeSteps / 必要な物から。3 題材の中身は出さない）。
  // opt: 'osteps' = 手順を整理して / 'oneed' = 必要な物をまとめて。alt = 同じ種類で作り直した時のもう一方の形
  function splitNeed(pair, m) { var p = String(pair[m] || '').split(/\s*·\s*/); return { things: p[0] || '', place: p.slice(1).join(' · ') }; }
  TDD.leaveNote = function (odai, opt, alt) {
    if (!odai) return null;
    if (opt === 'osteps') {
      if (!odai.makeSteps || !odai.makeSteps.length) return null;
      var list = alt ? [odai.firstStep].concat(odai.makeSteps.slice(1)) : odai.makeSteps;
      return { title: alt ? ['作り方の手順（最初の一歩から）', 'つくりかたの手じゅん（さいしょの一歩から）'] : ['作り方の手順', 'つくりかたの手じゅん'],
        lines: list.slice(0, 4).map(function (s, i) { return [(i + 1) + '. ' + s[0], (i + 1) + '. ' + s[1]]; }) };
    }
    if (opt === 'oneed') {
      var js = splitNeed(odai.need, 0), es = splitNeed(odai.need, 1);
      if (alt) {
        var tj = js.things.split('・'), te = es.things.split('・');
        return { title: ['持ち物チェック', 'もちものチェック'],
          lines: tj.map(function (t, i) { return ['□ ' + t, '□ ' + (te[i] || t)]; }).concat(js.place ? [['□ 場所: ' + js.place, '□ ばしょ: ' + es.place]] : []) };
      }
      var lines = [['用意する物: ' + js.things, 'よういするもの: ' + es.things]];
      if (js.place) lines.push(['場所: ' + js.place, 'ばしょ: ' + es.place]);
      if (odai.safety) lines.push(['始める前にサポーターと確認する', 'はじめる前にサポーターとかくにんする']);
      return { title: ['必要な物と場所', 'ひつようなものとばしょ'], lines: lines };
    }
    return null;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = TDD;
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
