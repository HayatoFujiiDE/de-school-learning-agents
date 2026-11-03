window.DES = window.DES || {};
/*
 * DES.buddy(size, mood) -> inline SVG string
 * バディの見た目はこの関数だけで決まる（差し替え点。契約 §J）。
 * 暫定キャラ: クリームの円の中に、オリーブ線画の吹き出し型の顔（右下に二股の尾）と目 2 つ。
 * 黒い塗りの円はやめた（全画面で最も強い塊になり、通知アイコンに見えるため）。
 * mood: 'neutral'（既定）/ 'happy'（目が弧）/ 'think'（目が寄る + 顔が少し傾く）
 * リング（橙の枠）は呼び出し側 CSS が付ける。ここでは描かない。
 */
(function () {
  var DES = window.DES;
  // SVG 文字列に埋め込むため JS に定数を置く。値は tokens.css と同じ hex
  var CREAM = '#fff8e8',  // = --cream
    PAPER = '#ffffff',    // = --paper
    OLIVE = '#524e44';    // = --olive
  // 100x100 の座標で描き、size に拡縮する（線は画面上で 1.75px に固定）
  var FACE = 'M20 50 C20 34 34 25 50 25 C67 25 80 35 80 48 C80 55 77 60 72.5 64 ' +
    'L79 74.5 L70.5 71.5 L66 78 L60.5 70.5 C55.5 72.2 49.5 73 44 73 C30 73 20 63 20 50 Z';
  var FACE_SMALL = 'M16 50 C16 32 32 22 50 22 C69 22 84 33 84 49 C84 58 79 64 73 67 ' +
    'L80 79 L64 72 C58 73.5 52 74.5 46 74.5 C29 74.5 16 65 16 50 Z';

  function eyes(size, mood) {
    var small = size <= 20;
    var lx = 40, rx = 58, y = 46;
    if (mood === 'think') { lx = 43.5; rx = 56; y = 44; }
    var sw = small ? 1.5 : 1.75;
    if (mood === 'happy') {
      var w = small ? 6 : 4.6, h = small ? 6 : 5.6;
      return '<path d="M' + (lx - w) + ' ' + (y + 2.6) + ' Q' + lx + ' ' + (y - h) + ' ' + (lx + w) + ' ' + (y + 2.6) +
        ' M' + (rx - w) + ' ' + (y + 2.6) + ' Q' + rx + ' ' + (y - h) + ' ' + (rx + w) + ' ' + (y + 2.6) +
        '" fill="none" stroke="' + OLIVE + '" stroke-width="' + sw + '" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round"/>';
    }
    if (small) {
      return '<circle cx="' + lx + '" cy="' + y + '" r="5.5" fill="' + OLIVE + '"/><circle cx="' + rx + '" cy="' + y + '" r="5.5" fill="' + OLIVE + '"/>';
    }
    var erx = size <= 30 ? 3.9 : 3.2, ery = size <= 30 ? 5.6 : 5;
    return '<ellipse cx="' + lx + '" cy="' + y + '" rx="' + erx + '" ry="' + ery + '" fill="' + OLIVE + '"/>' +
      '<ellipse cx="' + rx + '" cy="' + y + '" rx="' + erx + '" ry="' + ery + '" fill="' + OLIVE + '"/>';
  }

  DES.buddy = function (size, mood) {
    size = +size || 40;
    mood = mood === 'happy' || mood === 'think' ? mood : 'neutral';
    var small = size <= 20;
    var face = small ? FACE_SMALL : FACE;
    var tilt = mood === 'think' ? ' transform="rotate(-7 50 50)"' : '';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="' + size + '" height="' + size + '"' +
      ' role="img" aria-label="バディ" class="des-buddy des-buddy--' + mood + '">' +
      '<circle cx="50" cy="50" r="50" fill="' + CREAM + '"/>' +
      '<g' + tilt + '><path d="' + face + '" fill="' + PAPER + '" stroke="' + OLIVE + '" stroke-width="' + (small ? 1.5 : 1.75) + '"' +
      ' vector-effect="non-scaling-stroke" stroke-linejoin="round"/>' + eyes(size, mood) + '</g>' +
      '</svg>';
  };
})();
