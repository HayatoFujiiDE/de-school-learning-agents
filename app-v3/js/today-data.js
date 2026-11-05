/* 今日のお題の中身（CONTRACT-v3 §X-3）。プール 9 本 = fit（near / next / new）ごとに 3 本。fit は内部値で、画面には出さない。
   v1.0 の例 2 本（回りながら落ちる種 / この街の案内板）+ 11 月の季節（落ち葉・どんぐり・夕方が早くなる・冬鳥・初雪）+ 本人の好き
   （既存データのマイクラの建築・Python のゲーム・電気の回路）。外からの依頼は 1 本だけ（架空・実在の団体名なし・締切つき）。
   屋外・生き物・刃物を使うお題は safety: true、外に出て探すお題は outdoor: true。人の名前は足さない。
   文言は [中学生向け, 小学生向け] の組。絵は数値だけから組み立てる 2 色の線画 SVG（1 枚ごとに 墨 + 橙 か 墨 + オリーブ。淡い面は同じ色の透明度）。
   play.result(values) と drawArt(kind, values) は決定論。node からも読める（tools/today-test.js）。
   §AF（contract-app）: 作る・ためすに 3 本（od-ath-winter / od-stop-leaf / od-story-snow。プール 12 本 = fit ごとに 4 本）+ 対話のお題 9 本（TDD.dialogs。
   news / talk / philo が 3 本ずつ）。対話のお題に限り、実在の人・組織の名前を出典つきで書く。TDD.get は作る・ためすのお題だけ（作るの作業台が読む）。 */
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
  // ---------- §AF 作る・ためすに足す 3 本の線画（墨 + 橙）。§AE の題材（ath / stop / story）と同じ値で描く ----------
  // マイクラのアスレチック（横から見たコース）: 足場の数 = 足場の個数 / 足場のあいだ = 間隔。2 個目・4 個目…はすべる足場（橙 + 斜めの線）
  function flag(x, goal) {
    return line(x, 140, x, 74, INK, 1.4) + poly([[x, 74], [x + 16, 80], [x, 86]], goal ? ORANGE : WHITE, 1.2, goal ? fo(0.5) : '');
  }
  ART.ath = function (v) {
    var g = v.gap, n = v.count, L = n + g * (n - 1), u = Math.min(16, 168 / L), x0 = 120 - L * u / 2, y = 108, out = ground(), i;
    out += flag(x0 - 12, false) + flag(x0 + L * u + 10, true);
    for (i = 0; i < n; i++) {
      var x = x0 + i * (g + 1) * u, gim = i % 2 === 1;
      if (i < n - 1) {
        var x2 = x0 + (i + 1) * (g + 1) * u, h = 10 + g * 7;
        out += '<path d="M' + r1(x + u / 2) + ' ' + y + 'Q' + r1((x + x2 + u) / 2) + ' ' + r1(y - h) + ' ' + r1(x2 + u / 2) + ' ' + y + '" stroke="' + INK + '" stroke-width="1" fill="none" stroke-dasharray="3 3"' + so(0.5) + '/>';
      }
      out += line(x + u / 2, y + 10, x + u / 2, 140, INK, 0.8, so(0.35));
      out += rect(x, y, u, 10, gim ? ORANGE : WHITE, gim ? fo(0.25) : '');
      if (gim) out += line(x + u * 0.15, y + 8, x + u * 0.5, y + 2, ORANGE, 1) + line(x + u * 0.5, y + 8, x + u * 0.85, y + 2, ORANGE, 1);
    }
    return wrap(out);
  };
  // コマ撮りの動画: 上にコマの枠が F 個（葉の位置と色の濃さがコマごとに少しずつ変わる）/ 下に時間の線（長さ = 秒数・1 秒ごとの目盛り）
  var STOP_F = [6, 8, 12, 18, 24], STOP_P = [4, 6, 8, 12];
  function stopSecs(v) { return Math.round(STOP_F[v.frames] / STOP_P[v.fps] * 10) / 10; }
  ART.stop = function (v) {
    var F = STOP_F[v.frames], S = stopSecs(v), cols = F <= 8 ? F : (F === 24 ? 8 : 6), rows = Math.ceil(F / cols), out = '', i;
    var cw = 200 / cols, ch = 84 / rows, bw = cw - 4, bh = ch - 5, gx = 120 - (cols * cw - 4) / 2;
    for (i = 0; i < F; i++) {
      var c = i % cols, rr = Math.floor(i / cols), x = gx + c * cw, y = 10 + rr * ch, t = F > 1 ? i / (F - 1) : 0;
      out += rect(x, y, bw, bh, WHITE, ' rx="2"');
      out += circle(x + bw * (0.3 + 0.4 * t), y + bh * (0.62 - 0.24 * t), Math.max(1.6, Math.min(bw, bh) * 0.2), ORANGE, ORANGE, 1, fo(r1(0.15 + 0.8 * t)));
    }
    var px = 200 / 6, end = 20 + S * px;
    out += line(20, 120, 220, 120, INK, 1, so(0.3));
    out += line(20, 120, end, 120, ORANGE, 3);
    for (i = 0; i <= Math.floor(S); i++) out += line(20 + i * px, 113, 20 + i * px, 127, INK, 1.2);
    out += circle(end, 120, 3.5, ORANGE, INK, 1);
    return wrap(out);
  };
  // 物語: 場面のカード n 枚が山なりの線の上に並ぶ（山場 = 最後の 1 つ前だけ橙）。左上に語り手の印（吹き出し / 目 / 封筒）
  ART.story = function (v) {
    var n = v.scenes, out = '', pts = [], i;
    for (i = 0; i < n; i++) pts.push([62 + i * (156 / (n - 1)), i <= n - 2 ? 116 - 72 * i / (n - 2) : 92]);
    out += '<path d="M' + pts.map(function (p) { return r1(p[0]) + ' ' + r1(p[1]); }).join('L') + '" stroke="' + INK + '" stroke-width="1.2" fill="none" stroke-linejoin="round"' + so(0.6) + '/>';
    pts.forEach(function (p, j) { out += rect(p[0] - 10, p[1] - 8, 20, 16, j === n - 2 ? ORANGE : WHITE, ' rx="2"' + (j === n - 2 ? fo(0.35) : '')); });
    if (v.voice === 0) out += '<path d="M12 12 H44 V34 H24 L16 42 V34 H12 Z" fill="' + WHITE + '" stroke="' + INK + '" stroke-width="1.3" stroke-linejoin="round"/>';
    else if (v.voice === 1) out += '<path d="M10 26 Q28 10 46 26 Q28 42 10 26 Z" fill="' + WHITE + '" stroke="' + INK + '" stroke-width="1.3"/>' + circle(28, 26, 5, INK);
    else out += rect(10, 14, 36, 24, WHITE, ' rx="2"') + '<path d="M10 14 L28 28 L46 14" stroke="' + INK + '" stroke-width="1.3" fill="none" stroke-linejoin="round"/>';
    out += line(14, 140, 226, 140, INK, 1.2);
    return wrap(out);
  };

  // ---------- §AF 対話のお題の線画（お題ごとに 1 枚・2 色。値で変わらない） ----------
  // 火星の月から砂を持ち帰る（墨 + 橙）: 火星・フォボス・探査機と行き帰りの破線
  ART.d_mmx = function () {
    var out = '';
    out += '<ellipse cx="78" cy="82" rx="62" ry="22" fill="none" stroke="' + INK + '" stroke-width="1" stroke-dasharray="3 4"' + so(0.45) + '/>';
    out += circle(78, 82, 36, ORANGE, INK, 1.4, fo(0.2)) + circle(64, 70, 6, 'none', INK, 1, so(0.5)) + circle(92, 96, 4, 'none', INK, 1, so(0.5)) + circle(86, 66, 3, 'none', INK, 1, so(0.5));
    out += '<ellipse cx="138" cy="70" rx="9" ry="6" fill="' + WHITE + '" stroke="' + INK + '" stroke-width="1.3"/>';
    out += rect(190, 104, 14, 10, WHITE) + line(178, 109, 190, 109, INK, 2) + line(204, 109, 216, 109, INK, 2);
    out += '<path d="M188 102 Q168 64 148 68" stroke="' + ORANGE + '" stroke-width="1.3" fill="none" stroke-dasharray="4 3"/>';
    out += '<path d="M206 116 Q220 132 226 140" stroke="' + ORANGE + '" stroke-width="1.3" fill="none" stroke-dasharray="4 3"/>';
    out += circle(30, 24, 1.5, INK) + circle(212, 30, 1.5, INK) + circle(170, 20, 1.2, INK);
    return wrap(out);
  };
  // 防災庁（墨 + 橙）: 建物 + 前・最中・後の 3 つの丸（真ん中が橙）
  ART.d_bosai = function () {
    var out = ground();
    out += poly([[84, 52], [120, 24], [156, 52]], WHITE) + rect(92, 52, 56, 40, WHITE) + rect(112, 70, 16, 22, WHITE);
    out += line(120, 24, 120, 10, INK, 1.2) + poly([[120, 10], [134, 14], [120, 18]], ORANGE, 1.1, fo(0.5));
    [52, 120, 188].forEach(function (x, i) { out += circle(x, 118, 13, i === 1 ? ORANGE : WHITE, INK, 1.4, i === 1 ? fo(0.35) : ''); });
    out += arrow(86, 118, 1, INK) + arrow(154, 118, 1, INK);
    return wrap(out);
  };
  // 遠い国の選挙（墨 + オリーブ）: 投票箱と紙・地球
  ART.d_election = function () {
    var out = ground(OLIVE);
    out += rect(50, 82, 84, 58, WHITE, ' rx="3"') + line(76, 92, 108, 92, INK, 2.4);
    out += poly([[82, 92], [80, 58], [104, 56], [106, 92]], OLIVE, 1.2, fo(0.15)) + line(86, 66, 100, 65, OLIVE, 1) + line(86, 74, 100, 73, OLIVE, 1);
    out += circle(184, 54, 26, WHITE, INK, 1.4) + '<ellipse cx="184" cy="54" rx="11" ry="26" fill="none" stroke="' + OLIVE + '" stroke-width="1.1"/>';
    out += line(158, 54, 210, 54, OLIVE, 1.1) + line(162, 40, 206, 40, OLIVE, 0.9, so(0.7)) + line(162, 68, 206, 68, OLIVE, 0.9, so(0.7));
    out += '<path d="M158 70 Q140 92 136 104" stroke="' + INK + '" stroke-width="1" fill="none" stroke-dasharray="3 3"' + so(0.5) + '/>';
    return wrap(out);
  };
  // 教室のルール（墨 + オリーブ）: 決まりの板（3 行・印）と 3 つの丸い駒から伸びる線
  ART.d_rule = function () {
    var out = '';
    out += rect(46, 14, 148, 76, WHITE, ' rx="6"');
    for (var i = 0; i < 3; i++) {
      var y = 32 + i * 20;
      out += rect(60, y - 6, 12, 12, i === 2 ? WHITE : OLIVE, i === 2 ? '' : fo(0.2)) + line(82, y, [170, 150, 160][i], y, INK, 2, i === 2 ? so(0.35) : '');
      if (i < 2) out += line(62, y, 65, y + 3, OLIVE, 1.4) + line(65, y + 3, 70, y - 3, OLIVE, 1.4);
    }
    [70, 120, 170].forEach(function (x, j) { out += circle(x, 128, 9, j === 1 ? OLIVE : WHITE, INK, 1.3, j === 1 ? fo(0.25) : '') + line(x, 118, 120 + (x - 120) * 0.4, 92, INK, 1, ' stroke-dasharray="2 3"' + so(0.5)); });
    return wrap(out);
  };
  // 調べ学習と AI（墨 + 橙）: 吹き出しと虫めがね
  ART.d_aitalk = function () {
    var out = '';
    out += '<path d="M24 22 H134 V88 H66 L48 106 V88 H24 Z" fill="' + WHITE + '" stroke="' + INK + '" stroke-width="1.4" stroke-linejoin="round"/>';
    out += line(40, 42, 116, 42, INK, 2) + line(40, 56, 104, 56, INK, 2) + line(40, 70, 90, 70, INK, 2, so(0.4));
    out += circle(174, 84, 26, ORANGE, INK, 1.6, fo(0.15)) + line(193, 103, 216, 128, INK, 4);
    out += line(166, 76, 174, 68, ORANGE, 1.4) + line(176, 90, 186, 80, ORANGE, 1.4);
    out += line(176, 22, 176, 34, ORANGE, 1.4) + line(170, 28, 182, 28, ORANGE, 1.4);
    return wrap(out);
  };
  // ボール禁止の看板（墨 + 橙）: 看板・ボール・分けるための破線
  ART.d_ball = function () {
    var out = ground();
    out += line(64, 76, 64, 140, INK, 2) + circle(64, 50, 26, WHITE, INK, 1.6) + circle(64, 50, 11, WHITE, INK, 1.2) + line(57, 43, 71, 57, INK, 0.9, so(0.6));
    out += line(46, 32, 82, 68, ORANGE, 3);
    out += line(132, 30, 132, 140, INK, 1.2, ' stroke-dasharray="5 4"' + so(0.55));
    out += circle(184, 126, 13, ORANGE, INK, 1.4, fo(0.3)) + '<path d="M174 118 Q184 126 194 118" stroke="' + INK + '" stroke-width="1" fill="none"/>';
    out += arrow(170, 92, -1, ORANGE) + arrow(196, 92, 1, ORANGE);
    for (var i = 0; i < 4; i++) out += line(96 + i * 8, 140, 98 + i * 8, 134, INK, 1, so(0.5));
    return wrap(out);
  };
  // AI の時代に人にいる力（墨 + オリーブ）: 電球と歯車
  ART.d_aiphilo = function () {
    var out = '';
    out += circle(84, 58, 30, WHITE, INK, 1.5) + '<path d="M74 66 L80 52 L88 64 L94 50" stroke="' + OLIVE + '" stroke-width="1.6" fill="none" stroke-linejoin="round"/>';
    out += rect(72, 88, 24, 8, WHITE) + rect(74, 96, 20, 8, WHITE) + line(80, 108, 88, 108, INK, 2);
    for (var i = 0; i < 8; i++) { var a = i * Math.PI / 4; out += line(172 + Math.cos(a) * 26, 92 + Math.sin(a) * 26, 172 + Math.cos(a) * 34, 92 + Math.sin(a) * 34, INK, 4); }
    out += circle(172, 92, 26, OLIVE, INK, 1.5, fo(0.2)) + circle(172, 92, 9, WHITE, INK, 1.3);
    out += line(84, 20, 84, 12, OLIVE, 1.4) + line(54, 30, 48, 24, OLIVE, 1.4) + line(114, 30, 120, 24, OLIVE, 1.4);
    return wrap(out);
  };
  // お金と幸せ（墨 + 橙）: 積んだ硬貨と、上がって平らになる線（上がり続ける線は淡い破線）
  ART.d_money = function () {
    var out = '';
    [3, 5, 7].forEach(function (h, j) {
      for (var k = 0; k < h; k++) out += '<ellipse cx="' + (34 + j * 26) + '" cy="' + (136 - k * 7) + '" rx="10" ry="4" fill="' + WHITE + '" stroke="' + INK + '" stroke-width="1.2"/>';
    });
    out += line(120, 140, 226, 140, INK, 1.2) + line(120, 140, 120, 20, INK, 1.2);
    out += '<path d="M124 130 Q150 70 180 56 L224 50" stroke="' + ORANGE + '" stroke-width="2.2" fill="none"/>';
    out += '<path d="M180 56 L224 24" stroke="' + INK + '" stroke-width="1.2" fill="none" stroke-dasharray="4 3"' + so(0.5) + '/>';
    return wrap(out);
  };
  // テセウスの船（墨 + 橙）: 船の板の一部が取りかえた色（橙）・外した板が下に並ぶ
  ART.d_ship = function () {
    var out = '', i;
    out += line(120, 18, 120, 82, INK, 1.6) + poly([[124, 24], [170, 74], [124, 74]], WHITE);
    out += poly([[40, 84], [200, 84], [180, 112], [60, 112]], WHITE, 1.4);
    for (i = 0; i < 6; i++) {
      var x = 50 + i * 24, on = i === 1 || i === 3 || i === 4;
      out += rect(x, 88, 20, 8, on ? ORANGE : WHITE, on ? fo(0.4) : '');
    }
    out += '<path d="M24 122 Q60 116 96 122 T168 122 T226 122" stroke="' + INK + '" stroke-width="1" fill="none"' + so(0.5) + '/>';
    for (i = 0; i < 3; i++) out += rect(84 + i * 26, 132, 20, 7, WHITE, ' transform="rotate(' + (i - 1) * 8 + ' ' + (94 + i * 26) + ' 135)"');
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
  // §AF の 3 本（§AE の題材の値の名前）
  var ATH_FEEL = names([['かんたん', 'かんたん'], ['ふつう', 'ふつう'], ['むずかしい', 'むずかしい'], ['とてもむずかしい', 'とてもむずかしい']]);
  var VOICE = names([['「わたし」が語る', '「わたし」がかたる'], ['外から語る', '外からかたる'], ['手紙で語る', '手紙でかたる']]);
  // 作るに題材がある時は作るの結果 1 行（MD.result）、無い時（§AE の着地前）はお題の中の決定論の 1 行
  function hasTheme(theme) { return !!(MD && MD.THEMES && MD.THEMES.indexOf(theme) >= 0); }
  function themeResult(theme, variant, values) {
    var st = { kind: 'sample', theme: theme, variant: variant, values: values };
    return [MD.result(st, 'js'), MD.result(st, 'es')];
  }

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
    },
    // ===== §AF 作る・ためすに足す 3 本（題材 ath / stop / story は §AE。作るに題材が無い間は外で作る活動に落ちる = M.fromOdai の既存の分岐）=====
    {
      id: 'od-ath-winter', fit: 'near', art: 'ath', safety: false, outdoor: false, source: 'buddy', due: null, makeTheme: 'ath', makeVariant: 'ice',
      title: ['冬の遊び場みたいなアスレチック、マイクラで作れる？', 'ふゆのあそび場みたいなアスレチック、マイクラでつくれる？'],
      firstStep: ['氷の足場を 3 個、あいだをあけて置いてみる', 'こおりの足場を 3 こ、あいだをあけておいてみる'],
      need: ['マイクラ（いつものワールド）· 教室の中', 'マイクラ（いつものワールド）· 教室の中'],
      reason: ['マイクラで建てることが多いから', 'マイクラでたてることが多いから'],
      watch: { src: ['出典: ゲームづくりの公式チャンネル（架空）', 'しゅってん: ゲームづくりのこうしきチャンネル（かくう）'], points: [
        { t: '0:10', text: ['足場のあいだが広いほど、とぶのがむずかしくなる', '足場のあいだが広いほど、とぶのがむずかしくなる'] },
        { t: '0:30', text: ['氷の足場の上では、止まりにくくすべる', 'こおりの足場の上では、止まりにくくすべる'] },
        { t: '0:50', text: ['遊んだ人の声を聞いて、コースを直す', 'あそんだ人の声を聞いて、コースをなおす'] }] },
      find: { hints: [['公園の遊具で、とび移るところ', 'こうえんのゆうぐで、とびうつるところ'], ['冬にすべりやすくなる場所', 'ふゆにすべりやすくなるところ'], ['だんだん間が広くなる足場', 'だんだんあいだが広くなる足場']],
        photos: [{ id: 'p1', label: ['足場が近いコース', '足場が近いコース'], values: { gap: 1, count: 4 } },
          { id: 'p2', label: ['足場がはなれたコース', '足場がはなれたコース'], values: { gap: 4, count: 5 } },
          { id: 'p3', label: ['足場の多いコース', '足場の多いコース'], values: { gap: 2, count: 8 } }] },
      play: { sliders: [{ key: 'gap', label: ['足場のあいだ', '足場のあいだ'], min: 1, max: 4, def: 2, names: [1, 2, 3, 4].map(function (n) { return [n + ' ブロック', n + ' ブロック']; }) },
        { key: 'count', label: ['足場の数', '足場の数'], min: 3, max: 8, def: 4, names: [3, 4, 5, 6, 7, 8].map(function (n) { return [n + ' 個', n + ' こ']; }) }],
        result: function (v) {
          if (hasTheme('ath')) return themeResult('ath', 'ice', { gap: v.gap, count: v.count });
          var k = Math.floor(v.count / 2), f = ATH_FEEL[v.gap - 1];
          return ['足場 ' + v.count + ' 個（すべる足場 ' + k + ' 個）· あいだ ' + v.gap + ' ブロック · ' + f[0],
            '足場 ' + v.count + ' こ（すべる足場 ' + k + ' こ）· あいだ ' + v.gap + ' ブロック · ' + f[1]];
        } },
      makeSteps: []
    },
    {
      id: 'od-stop-leaf', fit: 'next', art: 'stop', safety: false, outdoor: false, source: 'buddy', due: null, makeTheme: 'stop', makeVariant: 'draw',
      title: ['落ち葉の色が変わっていくようす、コマ撮りで 10 秒にできる？', 'おちばの色がかわっていくようす、コマどりで 10 びょうにできる？'],
      firstStep: ['葉っぱの絵を 1 枚描いて、1 コマ撮る', 'はっぱの絵を 1 まいかいて、1 コマとる'],
      need: ['タブレット · 紙と色えんぴつ', 'タブレット · 紙と色えんぴつ'],
      reason: ['落ち葉の色のお題を見ていたから', 'おちばの色のお題を見ていたから'],
      watch: { src: ['出典: アニメーションづくりの公式チャンネル（架空）', 'しゅってん: アニメーションづくりのこうしきチャンネル（かくう）'], points: [
        { t: '0:10', text: ['1 枚ずつ、少しだけ変えて撮る', '1 まいずつ、少しだけかえてとる'] },
        { t: '0:30', text: ['1 秒に見せるコマが多いほど、なめらかに見える', '1 びょうに見せるコマが多いほど、なめらかに見える'] },
        { t: '0:50', text: ['コマの数を 1 秒のコマ数でわると、動画の長さになる', 'コマの数を 1 びょうのコマ数でわると、どうがの長さになる'] }] },
      find: { hints: [['色のちがう落ち葉を 3 枚', '色のちがうおちばを 3 まい'], ['パラパラ漫画', 'パラパラまんが'], ['少しずつ形が変わるもの', '少しずつ形がかわるもの']],
        photos: [{ id: 'p1', label: ['コマの少ない動画', 'コマの少ないどうが'], values: { frames: 0, fps: 0 } },
          { id: 'p2', label: ['なめらかな動画', 'なめらかなどうが'], values: { frames: 3, fps: 3 } },
          { id: 'p3', label: ['長めの動画', '長めのどうが'], values: { frames: 4, fps: 1 } }] },
      play: { sliders: [{ key: 'frames', label: ['コマの数', 'コマの数'], min: 0, max: 4, def: 1, names: STOP_F.map(function (n) { return [n + ' コマ', n + ' コマ']; }) },
        { key: 'fps', label: ['1 秒のコマ数', '1 びょうのコマ数'], min: 0, max: 3, def: 1, names: STOP_P.map(function (n) { return ['1 秒に ' + n + ' コマ', '1 びょうに ' + n + ' コマ']; }) }],
        result: function (v) {
          if (hasTheme('stop')) return themeResult('stop', 'draw', { frames: v.frames, fps: v.fps });
          var F = STOP_F[v.frames], P = STOP_P[v.fps], S = stopSecs(v);
          return ['絵が動き出す動画 · ' + F + ' コマ ÷ 1 秒に ' + P + ' コマ = ' + S + ' 秒', '絵がうごき出すどうが · ' + F + ' コマ ÷ 1 びょうに ' + P + ' コマ = ' + S + ' びょう'];
        } },
      makeSteps: []
    },
    {
      id: 'od-story-snow', fit: 'new', art: 'story', safety: false, outdoor: false, source: 'buddy', due: null, makeTheme: 'story', makeVariant: 'short',
      title: ['初雪の朝から始まる物語、最初の 1 文をどう書く？', 'はつゆきの朝からはじまるものがたり、さいしょの 1 文をどう書く？'],
      firstStep: ['主人公が窓の外を見て、何に気づくかを決める', '主人公がまどのそとを見て、何に気づくかをきめる'],
      need: ['ノートかパソコン', 'ノートかパソコン'],
      reason: ['絵や動画のほかに、言葉で作る入口も置いてみた', '絵やどうがのほかに、ことばでつくる入り口もおいてみた'],
      watch: { src: ['出典: 物語づくりの公式チャンネル（架空）', 'しゅってん: ものがたりづくりのこうしきチャンネル（かくう）'], points: [
        { t: '0:10', text: ['最初の 1 文で、季節と場所が分かる', 'さいしょの 1 文で、きせつとばしょが分かる'] },
        { t: '0:30', text: ['だれが語るかで、見えるものが変わる', 'だれがかたるかで、見えるものがかわる'] },
        { t: '0:50', text: ['山場は、おわりの少し前に置く', '山ばは、おわりの少し前におく'] }] },
      find: { hints: [['好きな本の、最初の 1 文', 'すきな本の、さいしょの 1 文'], ['「わたし」が語る本', '「わたし」がかたる本'], ['季節から始まる話', 'きせつからはじまる話']],
        photos: [{ id: 'p1', label: ['短い話のメモ', 'みじかい話のメモ'], values: { scenes: 3, voice: 0 } },
          { id: 'p2', label: ['外から語る話のメモ', '外からかたる話のメモ'], values: { scenes: 5, voice: 1 } },
          { id: 'p3', label: ['手紙の話のメモ', '手紙の話のメモ'], values: { scenes: 4, voice: 2 } }] },
      play: { sliders: [{ key: 'scenes', label: ['場面の数', '場めんの数'], min: 3, max: 7, def: 4, names: [3, 4, 5, 6, 7].map(function (n) { return [n + ' 場面', n + ' 場めん']; }) },
        { key: 'voice', label: ['語り手', 'かたり手'], min: 0, max: 2, def: 0, names: VOICE }],
        result: function (v) {
          if (hasTheme('story')) return themeResult('story', 'short', { scenes: v.scenes, voice: v.voice });
          var w = VOICE[v.voice];
          return [v.scenes + ' 場面の物語 · ' + w[0] + ' · 山場は ' + (v.scenes - 1) + ' 場面目', v.scenes + ' 場めんのものがたり · ' + w[1] + ' · 山ばは ' + (v.scenes - 1) + ' 場めん目'];
        } },
      makeSteps: []
    }
  ];
  TDD.topics = TOPICS;
  TDD.get = function (id) { for (var i = 0; i < TOPICS.length; i++) if (TOPICS[i].id === id) return TOPICS[i]; return null; };
  TDD.pool = function (fit) { return TOPICS.filter(function (t) { return t.fit === fit; }).map(function (t) { return t.id; }); };

  // ---------- §AF 対話のお題 9 本（news / talk / philo が 3 本ずつ）。「中」は contract-app §AF の verbatim ----------
  // 事実・数字・名前・URL は 2026-11-06 に確かめたもの（design.md §6）。足さない・言い換えない。
  // src は sources の id（1 つの前提を 2 つの出典が支える時だけ id の配列）。kind の無いお題（TOPICS）は make として扱う
  TDD.KINDS = ['news', 'talk', 'philo'];
  TDD.LEVELS = ['check', 'self', 'open'];
  var CHECKED = '2026-11-06';
  function src(id, name, url) { return { id: id, name: name, url: url, checked: CHECKED }; }
  var MEXT_AI = ['文部科学省は 2024 年 12 月、学校での生成 AI の使い方のガイドライン（Ver.2.0）を公表した', 'もんぶかがくしょうは 2024 年 12 月、学校での生成 AI のつかい方のガイドライン（Ver.2.0）を出した'];
  var MEXT_SRC_NAME = '文部科学省 学校現場における生成 AI の利用について', MEXT_SRC_URL = 'https://www.mext.go.jp/a_menu/other/mext_02412.html';
  var DIALOGS = [
    // ===== news（ニュースから）=====
    {
      id: 'od-news-mmx', kind: 'news', date: ['10 月 20 日', '10 月 20 日'], heavy: false, art: 'd_mmx', source: 'buddy',
      title: ['火星の月から砂を持ち帰る探査機が出発した。5 年かかる旅で、何を確かめたい？', 'かせいの月からすなをもちかえるたんさきが出発した。5 年かかるたびで、何をたしかめたい？'],
      lead: ['日本の探査機 MMX が 10 月に打ち上げられ、火星の月フォボスへ向かっている', '日本のたんさき MMX が 10 月にうち上げられ、かせいの月フォボスへむかっている'],
      reason: ['夜空や宇宙の話に目を向けることが多いから', 'よぞらやうちゅうの話に目をむけることが多いから'],
      facts: [
        { text: ['JAXA の探査機 MMX は、2026 年 10 月 20 日に H3 ロケットで打ち上げられた', 'JAXA のたんさき MMX は、2026 年 10 月 20 日に H3 ロケットでうち上げられた'], src: 's1' },
        { text: ['火星の月フォボスから 10 g 以上の砂を採って、地球に持ち帰る計画', 'かせいの月フォボスから 10 g いじょうのすなをとって、ちきゅうにもちかえるけいかく'], src: 's1' },
        { text: ['行って帰るまでに約 5 年かかる', '行って帰るまでにやく 5 年かかる'], src: 's1' }],
      views: [
        { who: ['捕獲説', 'ほかくせつ'], stance: ['遠くから来た小惑星が、火星の引力につかまって月になった、という考え', 'とおくから来た小わく星が、かせいの引力につかまって月になった、という考え'], src: 's2' },
        { who: ['巨大衝突説', 'きょだいしょうとつせつ'], stance: ['火星に大きな天体がぶつかり、飛び散ったかけらが集まって月になった、という考え', 'かせいに大きな天体がぶつかり、とびちったかけらがあつまって月になった、という考え'], src: 's2' }],
      asks: [
        { level: 'check', text: ['フォボスの砂を調べると、2 つの説のどちらが確かめられそう？', 'フォボスのすなをしらべると、何が分かりそう？'] },
        { level: 'self', text: ['結果が出るまで 5 年かかる研究を、自分ならやってみたい？', '5 年かかるたびに、自分なら何をもっていく？'] },
        { level: 'open', text: ['すぐ役に立つか分からないことを調べるのに、大きなお金を使うのはよいこと？', 'とおい星のことをしらべるのは、何のため？'] }],
      stances: [{ id: 's1', label: ['よいと思う', 'よいと思う'] }, { id: 's2', label: ['場合による', 'ばあいによる'] }, { id: 's3', label: ['よくないと思う', 'よくないと思う'] }],
      sources: [src('s1', 'JAXA 火星衛星探査計画 MMX（ミッション）', 'https://www.mmx.jaxa.jp/mission/'), src('s2', 'JAXA 火星衛星探査計画 MMX（サイエンス）', 'https://www.mmx.jaxa.jp/science/')],
      next: { talk: ['火星の月の 2 つの説、どっちがありそうか話したい', 'かせいの月の 2 つのせつ、どっちがありそうか話したい'],
        makeTitle: ['火星の月ができた 2 つの説を、コマ撮りで見せる', 'かせいの月ができた 2 つのせつを、コマどりで見せる'],
        makeSteps: [['粘土で火星と月を作る', 'ねんどでかせいと月をつくる'], ['捕獲説の動きを撮る', 'ほかくせつのうごきをとる'], ['巨大衝突説の動きを撮る', 'きょだいしょうとつせつのうごきをとる'], ['2 つを並べて見る', '2 つをならべて見る']] }
    },
    {
      id: 'od-news-bosai', kind: 'news', date: ['11 月 2 日', '11 月 2 日'], heavy: false, art: 'd_bosai', source: 'buddy',
      title: ['防災庁ができた。災害の時「だれが決めるか」を先に決めておくのは、なぜ？', 'ぼうさいちょうができた。さいがいの時「だれがきめるか」を先にきめておくのは、なぜ？'],
      lead: ['災害への備えと対応をまとめる国の組織「防災庁」が、11 月 2 日に発足した', 'さいがいへのそなえとたいおうをまとめる国のそしき「ぼうさいちょう」が、11 月 2 日にできた'],
      reason: ['教室の決めごとを話し合う場面が、このごろ多いから', '教室のきめごとを話し合うばめんが、このごろ多いから'],
      facts: [
        { text: ['防災庁は 2026 年 11 月 2 日に発足した', 'ぼうさいちょうは 2026 年 11 月 2 日にできた'], src: 's1' },
        { text: ['防災庁をつくる法律は、2026 年 7 月に国会で成立した', 'ぼうさいちょうをつくるほうりつは、2026 年 7 月にこっかいできまった'], src: 's2' },
        { text: ['災害の前の備えから、起きた時の対応、復旧・復興までを続けて担当する', 'さいがいの前のそなえから、おきた時のたいおう、ふっきゅう・ふっこうまでをつづけてたんとうする'], src: 's2' }],
      views: [
        { who: ['政府', 'せいふ'], stance: ['司令塔を 1 つにすると、備えから復興までを一貫して進められる、としている', 'しれいとうを 1 つにすると、そなえからふっこうまでをひとつづきですすめられる、としている'], src: 's2' }],
      asks: [
        { level: 'check', text: ['防災庁は、災害の『前・最中・後』のどこを担当する？', 'ぼうさいちょうは、何をするところ？'] },
        { level: 'self', text: ['教室で地震が起きたら、最初にだれが何を決める？', '教室でじしんがおきたら、さいしょに何をする？'] },
        { level: 'open', text: ['急ぐ時は 1 人が決めるのと、みんなで話し合うのと、どちらがよい？', 'いそぐ時、1 人がきめるのと、みんなできめるのは、どっちがいい？'] }],
      stances: [{ id: 's1', label: ['1 人が決める', '1 人がきめる'] }, { id: 's2', label: ['みんなで決める', 'みんなできめる'] }, { id: 's3', label: ['場面で変える', 'ばめんでかえる'] }],
      sources: [src('s1', '政府広報オンライン', 'https://www.gov-online.go.jp/article/202611/radio-3782.html'), src('s2', '時事ドットコム（2026 年 7 月 13 日）', 'https://www.jiji.com/jc/article?k=2026071300545&g=pol')],
      next: { talk: ['急ぐ時の決め方について話したい', 'いそぐ時のきめ方について話したい'],
        makeTitle: ['教室の『もしも』カードを作る', '教室の『もしも』カードをつくる'],
        makeSteps: [['起きそうなことを 3 つ書く', 'おきそうなことを 3 つ書く'], ['最初にすることを 1 つずつ決める', 'さいしょにすることを 1 つずつきめる'], ['カードにして、はる場所を決める', 'カードにして、はるばしょをきめる']] }
    },
    {
      id: 'od-news-election', kind: 'news', date: ['11 月 3 日', '11 月 3 日'], heavy: true, art: 'd_election', source: 'buddy',
      title: ['アメリカで大きな選挙があった。遠い国の選挙が、なぜ日本のニュースになる？', 'アメリカで大きなせんきょがあった。とおい国のせんきょが、なぜ日本のニュースになる？'],
      lead: ['アメリカで 11 月 3 日、国の議会の議員を選ぶ「中間選挙」の投票があった', 'アメリカで 11 月 3 日、国のぎかいのぎいんをえらぶ「ちゅうかんせんきょ」のとうひょうがあった'],
      reason: ['ニュースで見たことを、だれかと話したそうにしていたから', 'ニュースで見たことを、だれかと話したそうにしていたから'],
      facts: [
        { text: ['アメリカの中間選挙は、大統領の任期 4 年の真ん中の年にある', 'アメリカのちゅうかんせんきょは、大とうりょうのにんき 4 年のまん中の年にある'], src: 's1' },
        { text: ['下院の全部の議席と、上院のおよそ 3 分の 1 の議席を選び直す', 'かいんのぜんぶのぎせきと、じょういんのおよそ 3 分の 1 のぎせきをえらびなおす'], src: 's1' },
        { text: ['2026 年は 11 月 3 日が投票の日だった', '2026 年は 11 月 3 日がとうひょうの日だった'], src: 's2' }],
      views: [],
      asks: [
        { level: 'check', text: ['中間選挙では、何を選ぶ？', 'この せんきょでは、だれを えらぶ？'] },
        { level: 'self', text: ['自分の暮らしの中で、遠い国のできごととつながっているものは？', '自分の まわりで、とおい国と つながっているものは ある？'] },
        { level: 'open', text: ['自分が投票できない国の選挙に、関心を持つ意味はある？', '自分が えらべない せんきょのことを、知っておくのは なぜ？'] }],
      stances: [{ id: 's1', label: ['ある', 'ある'] }, { id: 's2', label: ['あまりない', 'あまりない'] }, { id: 's3', label: ['場合による', 'ばあいによる'] }],
      sources: [src('s1', '選挙ドットコム（中間選挙の解説）', 'https://go2senkyo.com/articles/2022/03/24/66870.html'), src('s2', '北海道新聞（2026 米中間選挙の特設ページの紹介）', 'https://www.hokkaido-np.co.jp/article/1398054/')],
      next: { talk: ['遠い国のニュースが自分に関係あるか話したい', 'とおい国のニュースが自分にかんけいあるか話したい'],
        makeTitle: ['世界とつながっている物の地図を作る', 'せかいとつながっているものの地図をつくる'],
        makeSteps: [['身のまわりの物を 5 つ選ぶ', 'みのまわりのものを 5 つえらぶ'], ['どこの国から来たか調べる', 'どこの国から来たかしらべる'], ['地図に線でつなぐ', '地図に線でつなぐ']] }
    },
    // ===== talk（話し合い）=====
    {
      id: 'od-talk-rule', kind: 'talk', date: null, heavy: false, art: 'd_rule', source: 'buddy',
      title: ['教室のルールは、だれが決めるのがいい？', '教室のルールは、だれがきめるのがいい？'],
      lead: ['ルールには、先に決まっているものと、自分たちで決められるものがある', 'ルールには、先にきまっているものと、自分たちできめられるものがある'],
      reason: ['道具の使い方を決め直したい、と話していたから', 'どうぐのつかい方をきめなおしたい、と話していたから'],
      facts: [
        { text: ['この教室には、時間や道具の使い方のルールがある', 'この教室には、時間やどうぐのつかい方のルールがある'], src: null },
        { text: ['ルールを変えたい時の決め方は、まだ決まっていない', 'ルールをかえたい時のきめ方は、まだきまっていない'], src: null }],
      views: [
        { who: ['大人が決める、という考え', '大人がきめる、という考え'], stance: ['全体を見ている人が決めると、早く決まる', 'ぜんたいを見ている人がきめると、早くきまる'], src: null },
        { who: ['使う人が決める、という考え', 'つかう人がきめる、という考え'], stance: ['自分たちで決めたルールは、守りやすい', '自分たちできめたルールは、まもりやすい'], src: null },
        { who: ['順番やくじで決める、という考え', 'じゅんばんやくじできめる、という考え'], stance: ['だれの声が大きいかで決まらない', 'だれの声が大きいかできまらない'], src: null }],
      asks: [
        { level: 'check', text: ['今ある教室のルールで、だれが決めたか知っているものは？', '教室の ルールで、だれが きめたか 知っているものは？'] },
        { level: 'self', text: ['自分が変えたいルールを 1 つ選ぶなら？', 'かえたい ルールは ある？'] },
        { level: 'open', text: ['自分が納得していないルールも、守るべき？', 'いやだなと 思う ルールも、まもったほうが いい？'] }],
      stances: [{ id: 's1', label: ['大人が決める', '大人がきめる'] }, { id: 's2', label: ['使う人が決める', 'つかう人がきめる'] }, { id: 's3', label: ['ルールによって変える', 'ルールによってかえる'] }],
      sources: [],
      next: { talk: ['教室のルールの決め方について話したい', '教室のルールのきめ方について話したい'],
        makeTitle: ['ルールの決め方カードを作る', 'ルールのきめ方カードをつくる'],
        makeSteps: [['決めたいことを 1 つ選ぶ', 'きめたいことを 1 つえらぶ'], ['決め方を 3 つ書く', 'きめ方を 3 つ書く'], ['サークル対話で 1 つ試す', 'サークル対話で 1 つためす']] }
    },
    {
      id: 'od-talk-ai', kind: 'talk', date: null, heavy: false, art: 'd_aitalk', source: 'buddy',
      title: ['調べ学習に AI を使うのは、ずるい？ ずるくない？', 'しらべ学習に AI をつかうのは、ずるい？ ずるくない？'],
      lead: ['文章や絵を作る AI を、学校や家で使う人がふえている', '文しょうや絵をつくる AI を、学校や家でつかう人がふえている'],
      reason: ['AI に手伝ってもらった所を、自分の作品と言っていいか迷っていたから', 'AI に手つだってもらったところを、自分の作品と言っていいかまよっていたから'],
      facts: [{ text: MEXT_AI, src: 's1' }],
      views: [
        { who: ['文部科学省のガイドライン', 'もんぶかがくしょうのガイドライン'], stance: ['年齢や使いこなす力に気を配り、リスクへの対策をしたうえで使うことを考える、としている', '年れいやつかいこなす力に気をくばり、リスクへのたいさくをしたうえでつかうことを考える、としている'], src: 's1' },
        { who: ['自分で考える時間がへる、という考え', '自分で考える時間がへる、という考え'], stance: ['先に答えを見ると、考える前に終わってしまう', '先に答えを見ると、考える前におわってしまう'], src: null },
        { who: ['道具の 1 つ、という考え', 'どうぐの 1 つ、という考え'], stance: ['辞書や電卓と同じで、使い方しだい', 'じしょや電たくと同じで、つかい方しだい'], src: null }],
      asks: [
        { level: 'check', text: ['AI に聞いたことが正しいか、どうやって確かめる？', 'AI が 言ったことが 合っているか、どうやって たしかめる？'] },
        { level: 'self', text: ['自分でやりたい所と、手伝ってほしい所は、どこで分ける？', '自分で やりたい ところは どこ？'] },
        { level: 'open', text: ['手伝ってもらって作ったものは、どこまで『自分の作品』？', '手つだって もらった ものは、自分の さくひん？'] }],
      stances: [{ id: 's1', label: ['ずるいと思う', 'ずるいと思う'] }, { id: 's2', label: ['ずるくないと思う', 'ずるくないと思う'] }, { id: 's3', label: ['使い方による', 'つかい方による'] }],
      sources: [src('s1', MEXT_SRC_NAME, MEXT_SRC_URL)],
      next: { talk: ['AI に手伝ってもらう時の線引きを話したい', 'AI に手つだってもらう時の線引きを話したい'],
        makeTitle: ['『ここは自分でやる』リストを作る', '『ここは自分でやる』リストをつくる'],
        makeSteps: [['最近 AI に手伝ってもらったことを書く', 'さいきん AI に手つだってもらったことを書く'], ['自分でやりたい所に印を付ける', '自分でやりたいところにしるしをつける'], ['リストにして作業台に置く', 'リストにしてさぎょうだいにおく']] }
    },
    {
      id: 'od-talk-ball', kind: 'talk', date: null, heavy: false, art: 'd_ball', source: 'buddy',
      title: ['遊び場に「ボール禁止」の看板。困る人と助かる人がいる時、どうする？', 'あそび場に「ボールきんし」のかんばん。こまる人とたすかる人がいる時、どうする？'],
      lead: ['同じ場所を、ちがう使い方をしたい人たちが使っている', '同じばしょを、ちがうつかい方をしたい人たちがつかっている'],
      reason: ['場所の使い方で、ゆずり合う場面があったから', 'ばしょのつかい方で、ゆずり合うばめんがあったから'],
      facts: [
        { text: ['ボールで遊びたい人がいる', 'ボールであそびたい人がいる'], src: null },
        { text: ['小さい子や、静かに過ごしたい人もいる', '小さい子や、しずかにすごしたい人もいる'], src: null }],
      views: [
        { who: ['禁止する、という考え', 'きんしする、という考え'], stance: ['けがをする人が出ないことを先に考える', 'けがをする人が出ないことを先に考える'], src: null },
        { who: ['時間で分ける、という考え', '時間で分ける、という考え'], stance: ['使える時間を決めれば、どちらも使える', 'つかえる時間をきめれば、どちらもつかえる'], src: null },
        { who: ['場所で分ける、という考え', 'ばしょで分ける、という考え'], stance: ['線を引いて、ボールの場所を決める', '線をひいて、ボールのばしょをきめる'], src: null }],
      asks: [
        { level: 'check', text: ['看板を立てた人は、何を心配したと思う？', 'かんばんを 立てた 人は、何が しんぱいだった？'] },
        { level: 'self', text: ['自分が『がまんする側』になった時、何があれば納得できる？', 'がまんする 時、どうして もらえたら いい？'] },
        { level: 'open', text: ['全員が満足する決め方は、ある？', 'みんなが『いいよ』と 言える きめ方は ある？'] }],
      stances: [{ id: 's1', label: ['禁止する', 'きんしする'] }, { id: 's2', label: ['時間で分ける', '時間で分ける'] }, { id: 's3', label: ['場所で分ける', 'ばしょで分ける'] }],
      sources: [],
      next: { talk: ['みんなが使う場所の決め方を話したい', 'みんながつかうばしょのきめ方を話したい'],
        makeTitle: ['遊び場の使い方の案を図にする', 'あそび場のつかい方の案を図にする'],
        makeSteps: [['遊び場の図を描く', 'あそび場の図をかく'], ['使いたい人を書き出す', 'つかいたい人を書き出す'], ['分け方を 2 つ描く', '分け方を 2 つかく']] }
    },
    // ===== philo（答えのない問い）=====
    {
      id: 'od-philo-ai', kind: 'philo', date: null, heavy: false, art: 'd_aiphilo', source: 'buddy',
      title: ['AI がいろいろできる時代に、人にはどんな力がいる？', 'AI がいろいろできるじだいに、人にはどんな力がいる？'],
      lead: ['文章や絵を作る AI が広まり、「人にしかできないことは何か」が世界中で話し合われている', '文しょうや絵をつくる AI が広まり、「人にしかできないことは何か」がせかい中で話し合われている'],
      reason: ['AI と一緒に作ることがふえてきたから', 'AI といっしょにつくることがふえてきたから'],
      facts: [
        { text: ['世界経済フォーラムの 2025 年の報告は、働く人に必要な力のおよそ 4 割が 2030 年までに変わる、と会社が見ているとしている', 'せかいけいざいフォーラムの 2025 年のほうこくは、はたらく人にひつような力のおよそ 4 わりが 2030 年までにかわる、と会社が見ているとしている'], src: 's1' },
        { text: MEXT_AI, src: 's3' }],
      views: [
        { who: ['世界経済フォーラム', 'せかいけいざいフォーラム'], stance: ['会社がいちばん大事だと答えた力は『分析的に考える力』。10 社のうち 7 社が欠かせないとした', '会社がいちばん大じだと答えた力は『ぶんせきてきに考える力』。10 社のうち 7 社がかかせないとした'], src: 's1' },
        { who: ['OECD（経済協力開発機構）', 'OECD（けいざいきょうりょくかいはつきこう）'], stance: ['これから必要な力として『新しい価値をつくる』『対立やジレンマに折り合いをつける』『責任をもって行動する』の 3 つを挙げている', 'これからひつような力として『新しいかちをつくる』『たいりつやジレンマにおりあいをつける』『せきにんをもってこうどうする』の 3 つをあげている'], src: 's2' },
        { who: ['文部科学省', 'もんぶかがくしょう'], stance: ['AI を使う時も人が中心であること、情報を確かめて使いこなす力を育てることを基本にしている', 'AI をつかう時も人がちゅうしんであること、じょうほうをたしかめてつかいこなす力をそだてることをきほんにしている'], src: 's3' }],
      asks: [
        { level: 'check', text: ['3 つの考えは、それぞれ『どんな力』を大事だと言っている？', '3 つの 考えは、どんな 力が 大じだと 言っている？'] },
        { level: 'self', text: ['自分がふだんやっていることで、AI に任せたくないことは？', 'AI に やってほしくない、自分で やりたい ことは？'] },
        { level: 'open', text: ['AI のほうが速く正確にできることを、それでも自分でやる意味はある？', 'AI の ほうが はやく できても、自分で やるのは なぜ？'] }],
      stances: [{ id: 's1', label: ['考える力', '考える力'] }, { id: 's2', label: ['人と折り合う力', '人とおりあう力'] }, { id: 's3', label: ['確かめて使いこなす力', 'たしかめてつかいこなす力'] }, { id: 's4', label: ['ほかの力', 'ほかの力'] }],
      sources: [src('s1', '世界経済フォーラム Future of Jobs Report 2025', 'https://www.weforum.org/publications/the-future-of-jobs-report-2025/in-full/3-skills-outlook/'),
        src('s2', 'OECD Learning Compass 2030', 'https://search.oecd.org/education/2030-project/teaching-and-learning/learning/transformative-competencies'),
        src('s3', MEXT_SRC_NAME, MEXT_SRC_URL)],
      next: { talk: ['人にしかできないことって何か、話したい', '人にしかできないことって何か、話したい'],
        makeTitle: ['『人にしかできないこと』のポスターを作る', '『人にしかできないこと』のポスターをつくる'],
        makeSteps: [['自分の考えを 1 文にする', '自分の考えを 1 文にする'], ['理由を 2 つ書く', 'りゆうを 2 つ書く'], ['絵か図を足す', '絵か図をたす'], ['教室にはる場所を決める', '教室にはるばしょをきめる']] }
    },
    {
      id: 'od-philo-money', kind: 'philo', date: null, heavy: false, art: 'd_money', source: 'buddy',
      title: ['お金がふえると、人はどこまでも幸せになる？', 'お金がふえると、人はどこまでもしあわせになる？'],
      lead: ['収入と毎日の気分の関係を、研究者たちが何万人もの人に聞いて調べている', 'しゅうにゅうとまい日の気分のかんけいを、けんきゅうしゃたちが何万人もの人に聞いてしらべている'],
      reason: ['ほしい物とお金の話をしていたから', 'ほしいものとお金の話をしていたから'],
      facts: [
        { text: ['2010 年と 2021 年に、ちがう結果の研究が発表された', '2010 年と 2021 年に、ちがうけっかのけんきゅうが出された'], src: ['s1', 's2'] },
        { text: ['2023 年、2 つの研究をした人たちが一緒に調べ直した', '2023 年、2 つのけんきゅうをした人たちがいっしょにしらべなおした'], src: 's3' }],
      views: [
        { who: ['カーネマンとディートン（2010 年の研究）', 'カーネマンとディートン（2010 年のけんきゅう）'], stance: ['毎日の気分のよさは、収入がある所をこえると上がりにくくなる', 'まい日の気分のよさは、しゅうにゅうがあるところをこえると上がりにくくなる'], src: 's1' },
        { who: ['キリングスワース（2021 年の研究）', 'キリングスワース（2021 年のけんきゅう）'], stance: ['収入がふえるほど、気分のよさも上がり続ける', 'しゅうにゅうがふえるほど、気分のよさも上がりつづける'], src: 's2' },
        { who: ['3 人で調べ直した研究（2023 年）', '3 人でしらべなおしたけんきゅう（2023 年）'], stance: ['多くの人では上がり続けるが、つらい気持ちが強い人たちでは、ある所で上がらなくなる', '多くの人では上がりつづけるが、つらい気もちが強い人たちでは、あるところで上がらなくなる'], src: 's3' }],
      asks: [
        { level: 'check', text: ['2 つの研究の結果は、どこがちがう？', '2 つの けんきゅうは、どこが ちがう？'] },
        { level: 'self', text: ['お金では手に入らないけれど、自分の気分をよくするものは？', 'お金で 買えないけど、うれしく なる ものは？'] },
        { level: 'open', text: ['『幸せ』は、数字ではかれる？', '『しあわせ』は、数で はかれる？'] }],
      stances: [{ id: 's1', label: ['どこまでも幸せになる', 'どこまでもしあわせになる'] }, { id: 's2', label: ['ある所で止まる', 'あるところで止まる'] }, { id: 's3', label: ['人による', '人による'] }],
      sources: [src('s1', 'Kahneman & Deaton (2010) PNAS', 'https://doi.org/10.1073/pnas.1011492107'), src('s2', 'Killingsworth (2021) PNAS', 'https://doi.org/10.1073/pnas.2016976118'),
        src('s3', 'Killingsworth, Kahneman & Mellers (2023) PNAS', 'https://doi.org/10.1073/pnas.2208661120')],
      next: { talk: ['幸せってはかれるのか、話したい', 'しあわせってはかれるのか、話したい'],
        makeTitle: ['自分の『気分がよくなるもの』の図を作る', '自分の『気分がよくなるもの』の図をつくる'],
        makeSteps: [['気分がよくなるものを 5 つ書く', '気分がよくなるものを 5 つ書く'], ['お金がいるものに印を付ける', 'お金がいるものにしるしをつける'], ['図にまとめる', '図にまとめる']] }
    },
    {
      id: 'od-philo-ship', kind: 'philo', date: null, heavy: false, art: 'd_ship', source: 'buddy',
      title: ['部品を 1 つずつ全部取りかえた船は、最後も同じ船？', 'ぶひんを 1 つずつぜんぶとりかえた船は、さいごも同じ船？'],
      lead: ['2000 年近く前から考えられてきた「テセウスの船」という問い', '2000 年近く前から考えられてきた「テセウスの船」という問い'],
      reason: ['作品を作り直す時、どこまでが同じ作品かを気にしていたから', '作品をつくりなおす時、どこまでが同じ作品かを気にしていたから'],
      facts: [{ text: ['古代ギリシャの作家プルタルコスが、この問いを書き残している', '大むかしのギリシャの作家プルタルコスが、この問いを書きのこしている'], src: 's1' }],
      views: [
        { who: ['プルタルコスが書き残した問い', 'プルタルコスが書きのこした問い'], stance: ['部品を全部取りかえた時、その船は同じ船と言えるのか', 'ぶひんをぜんぶとりかえた時、その船は同じ船と言えるのか'], src: 's1' },
        { who: ['あとから加わった問い', 'あとからくわわった問い'], stance: ['外した古い部品を集めて別の船を組み立てたら、どちらがテセウスの船なのか', 'はずした古いぶひんをあつめてべつの船をくみ立てたら、どちらがテセウスの船なのか'], src: 's1' }],
      asks: [
        { level: 'check', text: ['2 つめの問いは、1 つめの問いに何を足している？', '2 つめの といは、1 つめと 何が ちがう？'] },
        { level: 'self', text: ['自分の作品を作り直す時、何が残っていれば『同じ作品』？', '作りなおした さくひんは、前と 同じ さくひん？'] },
        { level: 'open', text: ['10 年後の自分は、今の自分と『同じ人』？', '大きく なった 自分は、今の 自分と 同じ？'] }],
      stances: [{ id: 's1', label: ['同じ船', '同じ船'] }, { id: 's2', label: ['ちがう船', 'ちがう船'] }, { id: 's3', label: ['決め方による', 'きめ方による'] }],
      sources: [src('s1', 'ウィキペディア『テセウスの船』', 'https://ja.wikipedia.org/wiki/テセウスの船')],
      next: { talk: ['同じってどういうことか、話したい', '同じってどういうことか、話したい'],
        makeTitle: ['少しずつ取りかえる船を、コマ撮りで作る', '少しずつとりかえる船を、コマどりでつくる'],
        makeSteps: [['ブロックで船を作る', 'ブロックで船をつくる'], ['1 コマごとに部品を 1 つ取りかえる', '1 コマごとにぶひんを 1 つとりかえる'], ['最初と最後を並べて見る', 'さいしょとさいごをならべて見る']] }
    }
  ];
  TDD.dialogs = DIALOGS;
  TDD.getDialog = function (id) { for (var i = 0; i < DIALOGS.length; i++) if (DIALOGS[i].id === id) return DIALOGS[i]; return null; };
  TDD.kindPool = function (kind) { return DIALOGS.filter(function (t) { return t.kind === kind; }).map(function (t) { return t.id; }); };
  TDD.kindOf = function (o) { return o && o.kind ? o.kind : 'make'; };
  TDD.srcIds = function (s) { return s == null ? [] : (Array.isArray(s) ? s.slice() : [s]); };
  TDD.sourceOf = function (o, sid) { var l = o && o.sources ? o.sources : []; for (var i = 0; i < l.length; i++) if (l[i].id === sid) return l[i]; return null; };
  TDD.stanceOf = function (o, sid) { var l = o && o.stances ? o.stances : []; for (var i = 0; i < l.length; i++) if (l[i].id === sid) return l[i]; return null; };
  TDD.askOf = function (o, level) { var l = o && o.asks ? o.asks : []; for (var i = 0; i < l.length; i++) if (l[i].level === level) return l[i]; return null; };
  // 対話のお題を作るの作業台へ渡す形（外で作る活動: 題 = next.makeTitle・手順 = next.makeSteps。M.fromOdai がそのまま読める）
  TDD.makeOdaiOf = function (o) {
    if (!o || !o.next) return null;
    return { id: o.id, title: o.next.makeTitle, firstStep: o.next.makeSteps[0], makeTheme: null, makeSteps: o.next.makeSteps };
  };
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
    // 対話のお題（§AF）から作った活動の写真: お題の絵 + 写真の四隅（探す写真が無いので、どの 1 枚もお題の絵。レビューへの裁定）
    var d = o ? null : TDD.getDialog(photo && photo.odai);
    if (d) return TDD.cardArt(d).replace('</svg>', corners() + '</svg>').replace('class="mk-art td-art"', 'class="mk-art td-art is-photo"');
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
