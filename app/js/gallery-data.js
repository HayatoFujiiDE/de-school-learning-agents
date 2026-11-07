/* 作品展示の設定（contract-LS §LS-13 / LS-18-15。見た目は contract-app §AG）。
   見本の他の人の作品・反応・ひとこと・声かけ・約束（モックの架空のデータ）は持たない。並ぶのはこの端末の自分の作品だけ（gallery.js）。
   ここに残すのは 種類の並び・題材との対応・番人（G.guard）の語の一覧・種類ごとの簡単な線画（固定の文字列。利用者の入力は入らない）。 */
(function (root) {
  'use strict';
  var DES = root.DES = root.DES || {};
  var GD = DES.galleryData = {};

  // 種類（画面のチップの並び順。data.js の catalog のカテゴリ id + 展示専用の writing）
  GD.CATS = ['minecraft', 'programming', 'craft', 'digital', 'media', 'drawing', 'writing'];
  // 自分の作品の種類: 題材から（catalog の id が無い時）。知らない題材は ものづくり
  GD.THEME_CAT = { mc: 'minecraft', ath: 'minecraft', py: 'programming', circuit: 'digital', stop: 'media', story: 'writing', tool: 'craft' };
  // 種類 → 題材（今の展示では使わない。設定値として残す）
  GD.CAT_THEME = { minecraft: 'mc', programming: 'py', digital: 'circuit', media: 'stop', writing: 'story' };
  // 番人の語の一覧（§AG-4 (a)。人を傷つける言い方の短い一覧。画面には出さない）
  GD.BAD_WORDS = ['ばか', 'バカ', '馬鹿', 'あほ', 'アホ', 'きもい', 'キモい', 'キモイ', 'うざい', 'ウザい', '死ね', 'しね', '消えろ', 'きえろ',
    'へたくそ', '下手くそ', 'ブス', 'ぶす', 'デブ', 'でぶ'];

  // ---------- 種類ごとの簡単な線画（墨 + オリーブ、強調だけ橙。固定の文字列） ----------
  var INK = '#292c29', OLIVE = '#524e44', ORANGE = '#ed922c', SAND = '#f1ece3', PAPER = '#ffffff', MID = '#e4ded1';
  function wrap(body) {
    return '<svg class="mk-art gl-art" viewBox="0 0 240 150" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">' + body + '</svg>';
  }
  function rect(x, y, w, h, fill, extra) { return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + fill + '" stroke="' + INK + '" stroke-width="1.2"' + (extra || '') + '/>'; }
  function ln(x1, y1, x2, y2, col, w) { return '<path d="M' + x1 + ' ' + y1 + 'L' + x2 + ' ' + y2 + '" stroke="' + (col || INK) + '" stroke-width="' + (w || 1.2) + '" fill="none" stroke-linecap="round"/>'; }
  var ART = {
    minecraft: function () {
      var out = ln(20, 128, 220, 128, OLIVE, 1.2), b = 18;
      [[0, 0], [1, 0], [2, 0], [3, 0], [1, 1], [2, 1], [2, 2]].forEach(function (p, i) {
        out += rect(84 + p[0] * b, 110 - p[1] * b, b, b, i === 6 ? ORANGE : (i % 2 ? MID : PAPER));
      });
      return out + rect(30, 92, 22, 36, PAPER) + ln(41, 92, 41, 128, OLIVE, 1) + rect(186, 100, 18, 28, SAND);
    },
    programming: function () {
      var out = rect(34, 18, 172, 112, PAPER, ' rx="8"') + ln(34, 34, 206, 34, INK, 1);
      out += '<circle cx="45" cy="26" r="2.2" fill="' + OLIVE + '"/><circle cx="53" cy="26" r="2.2" fill="' + OLIVE + '"/>';
      [[52, 50, 140], [64, 64, 150], [64, 78, 124], [52, 92, 110], [64, 106, 136]].forEach(function (l) { out += ln(l[0], l[1], l[2], l[1], OLIVE, 3); });
      return out + '<rect x="142" y="100" width="4" height="12" fill="' + ORANGE + '"/>';
    },
    craft: function () {
      var out = ln(20, 130, 220, 130, OLIVE, 1.2);
      out += '<path d="M40 40 L190 82 L190 92 L40 50 Z" fill="' + SAND + '" stroke="' + INK + '" stroke-width="1.2" stroke-linejoin="round"/>';
      out += '<path d="M190 92 L70 118 L70 126 L190 100 Z" fill="' + PAPER + '" stroke="' + INK + '" stroke-width="1.2" stroke-linejoin="round"/>';
      out += ln(48, 50, 48, 130, OLIVE, 1.2) + ln(182, 96, 182, 130, OLIVE, 1.2);
      return out + '<circle cx="60" cy="38" r="8" fill="' + ORANGE + '" stroke="' + INK + '" stroke-width="1.2"/>';
    },
    digital: function () {
      var out = ln(30, 128, 210, 128, OLIVE, 1.2) + rect(86, 112, 68, 16, SAND, ' rx="3"');
      out += ln(120, 112, 120, 70, INK, 2) + ln(120, 70, 150, 44, INK, 2);
      out += '<path d="M138 36 L176 30 L170 62 Z" fill="' + PAPER + '" stroke="' + INK + '" stroke-width="1.2" stroke-linejoin="round"/>';
      out += '<circle cx="164" cy="56" r="7" fill="' + ORANGE + '"/>';
      return out + ln(172, 72, 182, 84, ORANGE, 1.4) + ln(160, 76, 162, 90, ORANGE, 1.4) + ln(178, 62, 194, 66, ORANGE, 1.4);
    },
    media: function () {
      var out = rect(24, 34, 192, 82, PAPER, ' rx="4"');
      for (var i = 0; i < 9; i++) { out += rect(30 + i * 21, 38, 10, 7, SAND) + rect(30 + i * 21, 105, 10, 7, SAND); }
      out += rect(40, 52, 50, 46, MID) + rect(96, 52, 50, 46, MID) + rect(152, 52, 50, 46, MID);
      return out + '<path d="M115 64 L132 75 L115 86 Z" fill="' + ORANGE + '"/>';
    },
    drawing: function () {
      var out = rect(46, 22, 120, 106, PAPER, ' rx="4"');
      out += '<path d="M64 98 C80 60 104 60 118 84 S150 100 152 70" stroke="' + OLIVE + '" stroke-width="2" fill="none" stroke-linecap="round"/>';
      out += '<circle cx="86" cy="50" r="10" fill="none" stroke="' + OLIVE + '" stroke-width="1.6"/>';
      out += '<path d="M150 112 L196 44 L204 50 L158 118 Z" fill="' + SAND + '" stroke="' + INK + '" stroke-width="1.2" stroke-linejoin="round"/>';
      return out + '<path d="M150 112 L158 118 L148 124 Z" fill="' + ORANGE + '" stroke="' + INK + '" stroke-width="1.2" stroke-linejoin="round"/>';
    },
    writing: function () {
      var out = '<path d="M120 36 C96 28 66 28 40 36 L40 122 C66 114 96 114 120 122 Z" fill="' + PAPER + '" stroke="' + INK + '" stroke-width="1.2" stroke-linejoin="round"/>';
      out += '<path d="M120 36 C144 28 174 28 200 36 L200 122 C174 114 144 114 120 122 Z" fill="' + PAPER + '" stroke="' + INK + '" stroke-width="1.2" stroke-linejoin="round"/>';
      [52, 64, 76, 88, 100].forEach(function (y) { out += ln(52, y, 108, y - 2, OLIVE, 1) + ln(132, y - 2, 188, y, OLIVE, 1); });
      return out + '<path d="M168 30 L168 58 L176 52 L184 58 L184 30" fill="' + ORANGE + '" stroke="' + INK + '" stroke-width="1" stroke-linejoin="round"/>';
    }
  };
  GD.lineArt = function (cat) { return wrap((ART[cat] || ART.craft)()); };

  if (typeof module !== 'undefined' && module.exports) module.exports = GD;
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
