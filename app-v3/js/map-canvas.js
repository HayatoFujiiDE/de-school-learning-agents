/* 学びマップの地図の動かし方（CONTRACT-v3 §AB-2 / AB-3-1 / AB-12）。
   表示位置 view = { x, y, z }: 画面上の点 = 世界の点 × z + (x, y)（枠の左上が原点・px）。倍率 z は 0.3〜2.0。
   純関数（MPC.clampZoom / zoomAt / fit / lod / pan / clampView / reveal）は DOM に触れず、node から読める（tools/map-test.js）。
   ブラウザでは MPC.attach(frame, api) が ドラッグ・2 本指のピンチ・ホイール（ctrlKey 付き = トラックパッドのピンチ）・キー（+ − 0 と矢印）を受ける。
   枠の中だけが動く（touch-action:none は map.css）。ドラッグの後のクリックは、ノードを選ばないように捨てる。 */
(function (root) {
  'use strict';
  var DES = root.DES = root.DES || {};
  var MPC = DES.mapCanvas = {};
  MPC.MIN = 0.3;
  MPC.MAX = 2;
  // 倍率で出す量（§AB-3-1）: far < 0.6 ≦ mid < 1.1 ≦ near
  MPC.FAR = 0.6;
  MPC.NEAR = 1.1;

  function num(v, d) { v = +v; return isFinite(v) ? v : d; }
  MPC.clampZoom = function (z) { z = num(z, 1); return Math.min(MPC.MAX, Math.max(MPC.MIN, z)); };
  // 画面の点 (px, py) を基点に倍率を factor 倍（基点の下の世界の点は動かない。上限・下限で止まったらそこまで）
  MPC.zoomAt = function (v, factor, px, py) {
    var z0 = MPC.clampZoom(v.z), z = MPC.clampZoom(z0 * num(factor, 1)), k = z / z0;
    return { x: px - (px - v.x) * k, y: py - (py - v.y) * k, z: z };
  };
  // 全体が入る倍率（余白 pad）で真ん中に。入りきらない（下限 0.3）時も真ん中に置く
  MPC.fit = function (b, w, h, pad) {
    pad = pad == null ? 24 : pad;
    var bw = Math.max(1, b.w), bh = Math.max(1, b.h);
    var z = MPC.clampZoom(Math.min((w - 2 * pad) / bw, (h - 2 * pad) / bh));
    return { x: (w - bw * z) / 2 - b.x * z, y: (h - bh * z) / 2 - b.y * z, z: z };
  };
  MPC.lod = function (z) { z = num(z, 1); return z < MPC.FAR ? 'far' : (z < MPC.NEAR ? 'mid' : 'near'); };
  MPC.pan = function (v, dx, dy) { return { x: v.x + num(dx, 0), y: v.y + num(dy, 0), z: v.z }; };
  // 地図が枠から全部はみ出さないように（少なくとも keep px は見えている）
  MPC.clampView = function (v, b, w, h, keep) {
    var z = MPC.clampZoom(v.z), k = keep == null ? 80 : keep;
    var L = b.x * z, R = (b.x + b.w) * z, T = b.y * z, B = (b.y + b.h) * z;
    var x = num(v.x, 0), y = num(v.y, 0);
    x = Math.min(Math.max(x, k - R), w - k - L);
    y = Math.min(Math.max(y, k - B), h - k - T);
    return { x: x, y: y, z: z };
  };
  // 世界の箱 box が枠の中（inset を除いた所）に入るよう、いちばん少なく動かす。入りきらなければ真ん中
  MPC.reveal = function (v, box, w, h, inset) {
    inset = inset || {};
    var l = inset.l == null ? 16 : inset.l, t = inset.t == null ? 16 : inset.t, r = w - (inset.r == null ? 16 : inset.r), bt = h - (inset.b == null ? 16 : inset.b);
    var sx = box.x * v.z + v.x, sy = box.y * v.z + v.y, sw = box.w * v.z, sh = box.h * v.z, dx = 0, dy = 0;
    if (sw > r - l) dx = (l + r) / 2 - (sx + sw / 2); else if (sx < l) dx = l - sx; else if (sx + sw > r) dx = r - (sx + sw);
    if (sh > bt - t) dy = (t + bt) / 2 - (sy + sh / 2); else if (sy < t) dy = t - sy; else if (sy + sh > bt) dy = bt - (sy + sh);
    return { x: v.x + dx, y: v.y + dy, z: v.z };
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = MPC;
  if (typeof document === 'undefined') return;

  // ======================================================================
  // ブラウザ: 枠に操作を結ぶ。api = { view(), apply(v, smooth), commit(), fit(), keyCenter(el) }
  // ======================================================================
  MPC.KEY_STEP = 1.25;
  MPC.PAN_STEP = 80;
  MPC.attach = function (frame, api) {
    var pts = {}, drag = null, pinch = null, moved = false, suppress = false;
    function local(e) { var r = frame.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    function ids() { return Object.keys(pts); }
    function dist(a, b) { return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y)); }
    function mid(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
    // 操作の部品（＋ − 全体を見る）と詳細パネルの上では地図を動かさない
    function isUi(t) { return !!(t && t.closest && t.closest('.mp-ctrl, .mp-detail')); }
    function startPinch() {
      var k = ids(), a = pts[k[0]], b = pts[k[1]];
      pinch = { d0: Math.max(1, dist(a, b)), c0: mid(a, b), v: api.view() };
      drag = null;
      moved = true;
      frame.classList.add('is-dragging');
    }
    function down(e) {
      if (isUi(e.target)) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      pts[String(e.pointerId)] = local(e);
      if (ids().length === 1) { drag = { id: String(e.pointerId), s: local(e), v: api.view() }; moved = false; suppress = false; pinch = null; }
      else if (ids().length === 2) startPinch();
    }
    function move(e) {
      var k = String(e.pointerId);
      if (!pts[k]) return;
      pts[k] = local(e);
      if (pinch) {
        var q = ids();
        if (q.length < 2) return;
        var a = pts[q[0]], b = pts[q[1]], c = mid(a, b);
        var v = MPC.zoomAt(pinch.v, dist(a, b) / pinch.d0, pinch.c0.x, pinch.c0.y);
        api.apply(MPC.pan(v, c.x - pinch.c0.x, c.y - pinch.c0.y));
        e.preventDefault();
        return;
      }
      if (!drag || drag.id !== k) return;
      var dx = pts[k].x - drag.s.x, dy = pts[k].y - drag.s.y;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 6) return;
      if (!moved) { moved = true; frame.classList.add('is-dragging'); try { frame.setPointerCapture(e.pointerId); } catch (x) { /* 取れなくても動かせる */ } }
      api.apply(MPC.pan(drag.v, dx, dy));
    }
    function up(e) {
      var k = String(e.pointerId);
      if (!pts[k]) return;
      delete pts[k];
      if (pinch) {
        if (ids().length < 2) {
          pinch = null;
          suppress = true;
          // 残った 1 本の指でそのまま動かせる
          var rest = ids()[0];
          drag = rest ? { id: rest, s: pts[rest], v: api.view() } : null;
          moved = !!rest;
          if (!rest) frame.classList.remove('is-dragging');
          api.commit();
        }
        return;
      }
      if (drag && drag.id === k) {
        if (moved) { suppress = true; api.commit(); }
        drag = null;
        frame.classList.remove('is-dragging');
      }
    }
    frame.addEventListener('pointerdown', down);
    frame.addEventListener('pointermove', move);
    frame.addEventListener('pointerup', up);
    frame.addEventListener('pointercancel', up);
    // ドラッグ・ピンチの後のクリックは捨てる（ノードを選ばない・何もない所の解除もしない）
    frame.addEventListener('click', function (e) { if (suppress) { suppress = false; e.stopPropagation(); e.preventDefault(); } }, true);
    // ホイール・トラックパッドのピンチ（ctrlKey 付き）= ポインタの位置を基点に拡大縮小。ページはスクロールさせない
    var wheelT = null;
    frame.addEventListener('wheel', function (e) {
      if (e.target && e.target.closest && e.target.closest('.mp-detail')) return;
      e.preventDefault();
      var p = local(e), dy = e.deltaY * (e.deltaMode === 1 ? 16 : (e.deltaMode === 2 ? 400 : 1));
      var f = Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0018));
      api.apply(MPC.zoomAt(api.view(), f, p.x, p.y));
      clearTimeout(wheelT);
      wheelT = setTimeout(api.commit, 250);
    }, { passive: false });
    // キー（枠か地図の中のノードにフォーカスがある時）: + − で拡大縮小（フォーカスしたノードを基点）・0 で全体・矢印で移動
    frame.addEventListener('keydown', function (e) {
      if (e.defaultPrevented || e.altKey || e.metaKey || e.ctrlKey) return;
      if (e.target && e.target.closest && e.target.closest('.mp-detail')) return;
      var r = frame.getBoundingClientRect(), c = api.keyCenter(e.target) || { x: r.width / 2, y: r.height / 2 }, v = api.view(), k = e.key, nv = null;
      if (k === '+' || k === '=') nv = MPC.zoomAt(v, MPC.KEY_STEP, c.x, c.y);
      else if (k === '-' || k === '_') nv = MPC.zoomAt(v, 1 / MPC.KEY_STEP, c.x, c.y);
      else if (k === '0') { e.preventDefault(); api.fit(true); return; }
      else if (k === 'ArrowLeft') nv = MPC.pan(v, MPC.PAN_STEP, 0);
      else if (k === 'ArrowRight') nv = MPC.pan(v, -MPC.PAN_STEP, 0);
      else if (k === 'ArrowUp') nv = MPC.pan(v, 0, MPC.PAN_STEP);
      else if (k === 'ArrowDown') nv = MPC.pan(v, 0, -MPC.PAN_STEP);
      if (!nv) return;
      e.preventDefault();
      api.apply(nv, true);
      api.commit();
    });
    return { dragging: function () { return !!(pinch || (drag && moved)); } };
  };
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
