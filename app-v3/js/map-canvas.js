/* 学びマップの地図の動かし方（CONTRACT-v3 §AB-2 / AB-3-1 / AB-12）。
   表示位置 view = { x, y, z }: 画面上の点 = 世界の点 × z + (x, y)（枠の左上が原点・px）。
   倍率は 下限〜2.0。下限 = min(0.3, 全体が入る倍率)（床 0.1）= 狭い枠でも、開いた時と「全体を見る」で必ず全体が入る。
   0.3 より小さい倍率では、逆に拡大した題どうしが重なる分を決定論で間引く（MPC.thin。先に並べたもの = 新しいものを残す）。
   純関数（MPC.clampZoom / minZoom / zoomAt / fit / lod / pan / clampView / reveal / center / thin）は DOM に触れず、node から読める（tools/map-test.js）。
   ブラウザでは MPC.attach(frame, api) が ドラッグ・2 本指のピンチ・ホイール（ctrlKey 付き = トラックパッドのピンチ）・キー（+ − 0 と矢印）を受ける。
   作ったもののノードの上から 6px 以上動かした時は、地図ではなくそのノードを動かす（§AD-5。api.grab / nodeStart / nodeMove / nodeEnd）。
   ピンチ（2 本目の指）に変わったら、動かしかけたノードは元の場所へ戻す。Shift + 矢印は api.keyMove（地図の座標で 24px）。
   枠の中だけが動く（touch-action:none は map.css）。ドラッグの後のクリックは、ノードを選ばないように捨てる。 */
(function (root) {
  'use strict';
  var DES = root.DES = root.DES || {};
  var MPC = DES.mapCanvas = {};
  MPC.MIN = 0.3;     // ふだんの下限（地図が枠より小さくなる時だけ、全体が入る倍率まで下げる）
  MPC.FLOOR = 0.1;   // それでも下げない床
  MPC.MAX = 2;
  // 作ったものを Shift + 矢印で動かす幅（地図の座標・§AD-5）
  MPC.MOVE_STEP = 24;
  // 倍率で出す量（§AB-3-1）: far < 0.6 ≦ mid < 1.1 ≦ near
  MPC.FAR = 0.6;
  MPC.NEAR = 1.1;

  function num(v, d) { v = +v; return isFinite(v) ? v : d; }
  // min を渡さなければ ふだんの下限 0.3
  MPC.clampZoom = function (z, min) {
    var lo = Math.max(MPC.FLOOR, Math.min(MPC.MIN, num(min, MPC.MIN)));
    z = num(z, 1);
    return Math.min(MPC.MAX, Math.max(lo, z));
  };
  function rawFit(b, w, h, pad) { return Math.min((w - 2 * pad) / Math.max(1, b.w), (h - 2 * pad) / Math.max(1, b.h)); }
  // その枠の下限 = min(0.3, 全体が入る倍率)（床 0.1）
  MPC.minZoom = function (b, w, h, pad) {
    var f = rawFit(b, w, h, pad == null ? 24 : pad);
    return Math.max(MPC.FLOOR, Math.min(MPC.MIN, isFinite(f) ? f : MPC.MIN));
  };
  // 画面の点 (px, py) を基点に倍率を factor 倍（基点の下の世界の点は動かない。上限・下限で止まったらそこまで）
  MPC.zoomAt = function (v, factor, px, py, min) {
    var z0 = MPC.clampZoom(v.z, min), z = MPC.clampZoom(z0 * num(factor, 1), min), k = z / z0;
    return { x: px - (px - v.x) * k, y: py - (py - v.y) * k, z: z };
  };
  // 全体が入る倍率（余白 pad）で真ん中に（上限 2.0。床 0.1 でも入らない時だけ はみ出して真ん中）
  MPC.fit = function (b, w, h, pad) {
    pad = pad == null ? 24 : pad;
    var bw = Math.max(1, b.w), bh = Math.max(1, b.h);
    var z = MPC.clampZoom(rawFit(b, w, h, pad), MPC.minZoom(b, w, h, pad));
    return { x: (w - bw * z) / 2 - b.x * z, y: (h - bh * z) / 2 - b.y * z, z: z };
  };
  MPC.lod = function (z) { z = num(z, 1); return z < MPC.FAR ? 'far' : (z < MPC.NEAR ? 'mid' : 'near'); };
  MPC.pan = function (v, dx, dy) { return { x: v.x + num(dx, 0), y: v.y + num(dy, 0), z: v.z }; };
  // 地図が枠から全部はみ出さないように（少なくとも keep px は見えている）
  MPC.clampView = function (v, b, w, h, keep, min) {
    var z = MPC.clampZoom(v.z, min), k = keep == null ? 80 : keep;
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
  // 世界の箱 box の真ん中が、枠から inset を除いた見える範囲の真ん中に来るよう動かす（倍率は変えない）
  MPC.center = function (v, box, w, h, inset) {
    inset = inset || {};
    var l = inset.l || 0, t = inset.t || 0, r = w - (inset.r || 0), bt = h - (inset.b || 0);
    return { x: (l + r) / 2 - (box.x + box.w / 2) * v.z, y: (t + bt) / 2 - (box.y + box.h / 2) * v.z, z: v.z };
  };
  // 逆に拡大した札（作ったものの題・島の名前）の間引き。items = 優先の順（先 = 残す）、
  // 各 { id, ax, ay, w, h, align }: ax, ay = 世界の基点、w, h = 画面の大きさ（px）、align = 'center'（基点が上辺の真ん中）| 'left'（左上）。
  // 倍率 z で、先に残した札に重なる札の id を返す（決定論）
  MPC.thin = function (items, z, gap) {
    var kept = [], hidden = [], g = (gap == null ? 4 : gap) / z;
    (items || []).forEach(function (it) {
      var w = it.w / z, h = it.h / z, b = { x: it.align === 'left' ? it.ax : it.ax - w / 2, y: it.ay, w: w, h: h };
      for (var i = 0; i < kept.length; i++) {
        var k = kept[i];
        if (b.x < k.x + k.w + g && k.x < b.x + b.w + g && b.y < k.y + k.h + g && k.y < b.y + b.h + g) { hidden.push(it.id); return; }
      }
      kept.push(b);
    });
    return hidden;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = MPC;
  if (typeof document === 'undefined') return;

  // ======================================================================
  // ブラウザ: 枠に操作を結ぶ。api = { view(), apply(v, smooth), commit(), fit(), keyCenter(el), minZoom() }。
  // 戻り値の destroy() は、地図を作り直す・ページを離れる前に必ず呼ぶ（window の受け口を外し、押している最中の状態とタイマーを捨てる。以後は何もしない）
  // ======================================================================
  MPC.KEY_STEP = 1.25;
  MPC.PAN_STEP = 80;
  MPC.attach = function (frame, api) {
    var pts = {}, drag = null, pinch = null, moved = false, suppress = false, hooked = false, dead = false;
    function minZ() { return api.minZoom ? api.minZoom() : MPC.MIN; }
    // 枠の中の座標（枠線の内側 = 板の原点から）
    function local(e) { var r = frame.getBoundingClientRect(); return { x: e.clientX - r.left - frame.clientLeft, y: e.clientY - r.top - frame.clientTop }; }
    function ids() { return Object.keys(pts); }
    function dist(a, b) { return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y)); }
    function mid(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
    // 操作の部品（＋ − 全体を見る）と詳細パネルの上では地図を動かさない
    function isUi(t) { return !!(t && t.closest && t.closest('.mp-ctrl, .mp-detail')); }
    // 押している間だけ、枠の外で離した・取り消した時の終わりも window で受ける（枠の外で離してもドラッグが必ず終わる）
    function hook() {
      if (hooked) return;
      hooked = true;
      window.addEventListener('pointerup', up, true);
      window.addEventListener('pointercancel', cancel, true);
    }
    function unhook() {
      if (!hooked) return;
      hooked = false;
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', cancel, true);
    }
    function startPinch() {
      // ノードを動かしかけていたら元の場所へ（ピンチ中は動かさない）
      if (drag && drag.lifted && api.nodeEnd) api.nodeEnd(drag.node, false);
      var k = ids(), a = pts[k[0]], b = pts[k[1]];
      pinch = { d0: Math.max(1, dist(a, b)), c0: mid(a, b), v: api.view() };
      drag = null;
      moved = true;
      frame.classList.add('is-dragging');
    }
    function down(e) {
      if (dead) return;
      // 前のドラッグのクリック捨ては、次に押した時に必ず終わる（操作の部品を押した時も）
      suppress = false;
      if (isUi(e.target)) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      pts[String(e.pointerId)] = local(e);
      hook();
      // 作ったもののノードの上から押した時は、動かし始めたらそのノードを動かす（何も無い所からは地図の移動）
      if (ids().length === 1) { drag = { id: String(e.pointerId), s: local(e), v: api.view(), node: api.grab ? api.grab(e.target) : null, lifted: false }; moved = false; pinch = null; }
      else if (ids().length === 2) startPinch();
    }
    function move(e) {
      var k = String(e.pointerId);
      if (dead || !pts[k]) return;
      // マウスのボタンがもう離れている（離したのを受け取れなかった）なら、そこで終わり
      if (e.pointerType === 'mouse' && !(e.buttons & 1)) { end(k, true); return; }
      pts[k] = local(e);
      if (pinch) {
        var q = ids();
        if (q.length < 2) return;
        var a = pts[q[0]], b = pts[q[1]], c = mid(a, b);
        var v = MPC.zoomAt(pinch.v, dist(a, b) / pinch.d0, pinch.c0.x, pinch.c0.y, minZ());
        api.apply(MPC.pan(v, c.x - pinch.c0.x, c.y - pinch.c0.y));
        e.preventDefault();
        return;
      }
      if (!drag || drag.id !== k) return;
      var dx = pts[k].x - drag.s.x, dy = pts[k].y - drag.s.y;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 6) return;
      if (!moved) {
        moved = true;
        frame.classList.add('is-dragging');
        try { frame.setPointerCapture(e.pointerId); } catch (x) { /* 取れなくても動かせる */ }
        if (drag.node && api.nodeStart) drag.lifted = api.nodeStart(drag.node) !== false;
      }
      // ノード: 画面の動き ÷ 倍率 = 地図の座標の動き
      if (drag.lifted) { api.nodeMove(drag.node, dx / drag.v.z, dy / drag.v.z); return; }
      api.apply(MPC.pan(drag.v, dx, dy));
    }
    // 終わり。離した（up）時だけ、動かした後のクリックを捨てる。取り消し（cancel）ではクリックが来ないので捨てない
    function end(k, cancelled) {
      if (dead || !pts[k]) return;
      delete pts[k];
      // 取り消しで終わった時はクリックが来ないので、前に立てたクリック捨て（ピンチで片指を離した時など）も必ず外す
      if (cancelled) suppress = false;
      if (!ids().length) unhook();
      if (pinch) {
        if (ids().length < 2) {
          pinch = null;
          if (!cancelled) suppress = true;
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
        // ノードを動かしていたら、離した所に置く（保存）。地図の移動なら表示位置を保存
        if (moved) { if (!cancelled) suppress = true; if (drag.lifted) api.nodeEnd(drag.node, true); else api.commit(); }
        drag = null;
        moved = false;
        frame.classList.remove('is-dragging');
      }
    }
    function up(e) { end(String(e.pointerId), false); }
    function cancel(e) { end(String(e.pointerId), true); }
    // 枠そのものはスクロールさせない（フォーカスしたノードへブラウザが枠をずらすのを戻す。動かすのは板の transform だけ）
    frame.addEventListener('scroll', function () { if (frame.scrollLeft || frame.scrollTop) { frame.scrollLeft = 0; frame.scrollTop = 0; } });
    frame.addEventListener('pointerdown', down);
    frame.addEventListener('pointermove', move);
    frame.addEventListener('pointerup', up);
    frame.addEventListener('pointercancel', cancel);
    // ドラッグ・ピンチの後のクリックは捨てる（ノードを選ばない・何もない所の解除もしない）
    // キーボードで押した（Enter / Space。detail 0）クリックはドラッグの結果ではないので捨てない
    frame.addEventListener('click', function (e) { if (suppress && e.detail !== 0) { suppress = false; e.stopPropagation(); e.preventDefault(); } }, true);
    // ホイール・トラックパッドのピンチ（ctrlKey 付き）= ポインタの位置を基点に拡大縮小。ページはスクロールさせない
    var wheelT = null;
    frame.addEventListener('wheel', function (e) {
      if (dead) return;
      if (e.target && e.target.closest && e.target.closest('.mp-detail')) return;
      e.preventDefault();
      var p = local(e), dy = e.deltaY * (e.deltaMode === 1 ? 16 : (e.deltaMode === 2 ? 400 : 1));
      var f = Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0018));
      api.apply(MPC.zoomAt(api.view(), f, p.x, p.y, minZ()));
      clearTimeout(wheelT);
      wheelT = setTimeout(api.commit, 250);
    }, { passive: false });
    // キー（枠か地図の中のノードにフォーカスがある時）: + − で拡大縮小（フォーカスしたノードを基点）・0 で全体・矢印で移動
    frame.addEventListener('keydown', function (e) {
      if (dead || e.defaultPrevented || e.altKey || e.metaKey || e.ctrlKey) return;
      if (e.target && e.target.closest && e.target.closest('.mp-detail')) return;
      var c = api.keyCenter(e.target) || { x: frame.clientWidth / 2, y: frame.clientHeight / 2 }, v = api.view(), k = e.key, nv = null;
      // Shift + 矢印: 作ったもののノードにフォーカスがある時はそのノードを動かす（§AD-5）。それ以外は今までどおり地図の移動
      var dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[k];
      if (dir && e.shiftKey && api.keyMove && api.keyMove(e.target, dir[0], dir[1])) { e.preventDefault(); return; }
      if (k === '+' || k === '=') nv = MPC.zoomAt(v, MPC.KEY_STEP, c.x, c.y, minZ());
      else if (k === '-' || k === '_') nv = MPC.zoomAt(v, 1 / MPC.KEY_STEP, c.x, c.y, minZ());
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
    return {
      dragging: function () { return !!(pinch || (drag && moved)); },
      destroy: function () {
        dead = true;
        unhook();
        clearTimeout(wheelT);
        pts = {}; drag = null; pinch = null; moved = false; suppress = false;
        frame.classList.remove('is-dragging');
      }
    };
  };
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
