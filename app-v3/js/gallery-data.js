/* 作品展示の見本データ（contract-app §AG-6）。他の人の作品 8 件はすべて架空。呼び名だけを持ち、本当の名前・学年・顔は持たない。
   反応・ひとことの見本、番人（G.guard）の語の一覧、種類ごとの簡単な線画もここに置く（§AE のカテゴリの線画が入るまでの置き場。make-data.js は変えない）。
   ここの文字列は固定の見本。利用者の入力は入らない（線画 SVG は固定の文字列だけで作る）。 */
(function (root) {
  'use strict';
  var DES = root.DES = root.DES || {};
  var GD = DES.galleryData = {};

  // 種類（画面のチップの並び順。data.js の catalog のカテゴリ id + 展示専用の writing）
  GD.CATS = ['minecraft', 'programming', 'craft', 'digital', 'media', 'drawing', 'writing'];
  // 自分の作品の種類: 題材から（catalog の id が無い時）。知らない題材は ものづくり
  GD.THEME_CAT = { mc: 'minecraft', ath: 'minecraft', py: 'programming', circuit: 'digital', stop: 'media', story: 'writing', tool: 'craft' };
  // 「先に準備する」で作る活動の題材（写真のダミーの絵に使う）。MD.THEMES に無い題材は使わない（gallery.js が確かめる）
  GD.CAT_THEME = { minecraft: 'mc', programming: 'py', digital: 'circuit', media: 'stop', writing: 'story' };
  // 「先に準備する」の手順（§AG-5 verbatim。[中, 小]）
  GD.PREP_STEPS = [
    ['何を一緒に作るか話す', 'なにを いっしょに つくるか はなす'],
    ['分けてやる所を決める', 'わけて やる ところを きめる'],
    ['合わせて見る', 'あわせて 見る']
  ];
  // 初めて展示に出した後に 1 件届く声かけ（§AG-5）
  GD.SEED_CALL = { from: 'そらまめ', kind: 'together' };

  // 他の人の作品 8 件（§AG-6 verbatim）。time = 展示に出した時刻（並びは新しい順だけ）
  GD.items = [
    { id: 'g-clay-walk', name: 'そらまめ', cat: 'media', title: '粘土のカエルが歩く動画', like: 'とぶ前に、少ししゃがむところ', answers: 'ok', art: 'photo', time: '11/1 15:20' },
    { id: 'g-ice-course', name: 'ペンギン号', cat: 'minecraft', title: '氷ですべるアスレチック', like: '最後の足場だけ、わざと小さくしたところ', answers: null, art: 'photo', time: '11/1 11:05' },
    { id: 'g-rain-novel', name: 'もくもく', cat: 'writing', title: '雨の音が聞こえる小説の表紙', like: '題の字を雨つぶの形にしたところ', answers: 'later', art: 'illust', time: '10/31 14:40' },
    { id: 'g-lamp', name: 'あおい星', cat: 'digital', title: '暗くなるとつく机のあかり', like: '手をかざすと消えるところ', answers: null, art: 'photo', time: '10/31 10:30' },
    { id: 'g-4koma', name: 'ねこパンチ', cat: 'drawing', title: 'ねこが寝ぼうする 4 コマ', like: '4 コマ目で、ねこがまだ寝ているところ', answers: null, art: 'illust', time: '10/30 15:00' },
    { id: 'g-coaster', name: 'そらまめ', cat: 'craft', title: '3 回曲がるビー玉コースター', like: '最後にベルが鳴るところ', answers: null, art: 'photo', time: '10/30 11:15' },
    { id: 'g-stamp', name: 'ねこパンチ', cat: 'drawing', title: '「あとでね」のスタンプ', like: '手をふる向きを左右で変えたところ', answers: null, art: 'illust', time: '10/29 14:00' },
    { id: 'g-coin-game', name: 'ペンギン号', cat: 'programming', title: 'コインを集めるゲーム', like: 'コインが 10 枚で色が変わるところ', answers: null, art: 'line', time: '10/29 10:40' }
  ];
  // 見本の反応（6 件）。数にはせず、ボタンごとに呼び名を並べる
  GD.reacts = [
    { itemId: 'g-clay-walk', kind: 'how', name: 'ペンギン号' },
    { itemId: 'g-clay-walk', kind: 'like', name: 'あおい星' },
    { itemId: 'g-ice-course', kind: 'like', name: 'もくもく' },
    { itemId: 'g-ice-course', kind: 'try', name: 'そらまめ' },
    { itemId: 'g-4koma', kind: 'like', name: 'ペンギン号' },
    { itemId: 'g-coaster', kind: 'try', name: 'あおい星' }
  ];
  // 見本のひとこと（4 件。作者の返事を含む）
  GD.notes = [
    { id: 'gn-1', itemId: 'g-clay-walk', name: 'あおい星', text: 'しゃがむ所、何コマ使ったの？', time: '11/1 15:40' },
    { id: 'gn-2', itemId: 'g-clay-walk', name: 'そらまめ', text: '3 コマだよ', time: '11/1 15:52' },
    { id: 'gn-3', itemId: 'g-ice-course', name: 'ねこパンチ', text: '最後の足場、何回目でとべた？', time: '11/1 11:30' },
    { id: 'gn-4', itemId: 'g-4koma', name: 'もくもく', text: '4 コマ目の顔、ずっと見ていられる', time: '10/30 15:25' }
  ];

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
