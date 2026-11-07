/* 写真の共通部品（contract-LS LS-12 / LS-13）: <input type=file> で本物の画像を選び、長辺 640px の JPEG dataURL に縮めて返す。
   保存先（活動・作品・お題の記録）は各ページの保存キーに入る。顔・名前の注意は各ページの文（face_note）で出す。
   使い方: DES.photo.pick({ multiple:true, max:3 }).then(function (photos) { ... })  // photos = [{ data, w, h, bytes }]
   キャンセル・読めないファイルは空配列。例外は投げない。 */
window.DES = window.DES || {};
(function () {
  'use strict';
  var DES = window.DES;
  var LONG = 640, QUALITY = 0.82, MAX_BYTES = 120 * 1024;
  function bytesOf(dataUrl) { var i = dataUrl.indexOf(','); return Math.floor((dataUrl.length - i - 1) * 3 / 4); }
  function draw(img, long, q) {
    var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height, s = Math.min(1, long / Math.max(w, h));
    var cw = Math.max(1, Math.round(w * s)), ch = Math.max(1, Math.round(h * s)), c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(img, 0, 0, cw, ch);
    return { data: c.toDataURL('image/jpeg', q), w: cw, h: ch };
  }
  function shrink(file) {
    return new Promise(function (resolve) {
      if (!file || !/^image\//.test(file.type || '')) { resolve(null); return; }
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        try {
          var out = draw(img, LONG, QUALITY), q = QUALITY, long = LONG;
          // 120KB を超えたら質と長辺を順に落とす（保存の quota を守る）
          while (bytesOf(out.data) > MAX_BYTES && (q > 0.5 || long > 320)) {
            if (q > 0.5) q -= 0.1; else long = Math.round(long * 0.8);
            out = draw(img, long, q);
          }
          out.bytes = bytesOf(out.data);
          resolve(out);
        } catch (e) { resolve(null); }
        URL.revokeObjectURL(url);
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }
  function pick(o) {
    o = o || {};
    return new Promise(function (resolve) {
      var input = document.createElement('input'), done = false;
      input.type = 'file'; input.accept = 'image/*';
      if (o.multiple) input.multiple = true;
      input.style.position = 'fixed'; input.style.left = '-9999px'; input.setAttribute('aria-hidden', 'true'); input.tabIndex = -1;
      function finish(list) { if (done) return; done = true; if (input.parentNode) input.parentNode.removeChild(input); resolve(list); }
      input.addEventListener('change', function () {
        var files = Array.prototype.slice.call(input.files || []).slice(0, o.max || 1);
        Promise.all(files.map(shrink)).then(function (res) { finish(res.filter(Boolean)); }, function () { finish([]); });
      });
      // キャンセル（change が来ない）: フォーカスが戻ってから少し待って空で終える
      window.addEventListener('focus', function onFocus() { window.removeEventListener('focus', onFocus); setTimeout(function () { finish([]); }, 800); });
      document.body.appendChild(input);
      input.click();
    });
  }
  // dataURL の形の検査（保存値の読み戻し用）: data:image/jpeg;base64,… で 300KB 以下
  function valid(p) {
    return !!p && typeof p === 'object' && typeof p.data === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(p.data) &&
      p.data.length <= 400 * 1024 && typeof p.w === 'number' && typeof p.h === 'number' && p.w > 0 && p.h > 0;
  }
  // des.live.* に保存されている写真の総数（LS-18-11 の全体上限 60 枚の判定用）。読めない鍵は 0 と数える
  function count() {
    var n = 0;
    try {
      var ls = window.localStorage;
      for (var i = 0; i < ls.length; i++) {
        var k = ls.key(i);
        if (!k || k.indexOf('des.live.') !== 0) continue;
        var raw = ls.getItem(k) || '';
        var m = raw.match(/data:image\/(?:jpeg|png|webp);base64,/g);
        if (m) n += m.length;
      }
    } catch (e) { /* 保存が読めない時は 0 */ }
    return n;
  }
  DES.photo = { pick: pick, shrink: shrink, valid: valid, count: count, LIMIT: 60, LONG: LONG, MAX_BYTES: MAX_BYTES };
})();
