/* 作る の中身（CONTRACT-v3 §U-1 / U-2 / U-3、design-v3 §5-1 / §6-2 / §6-9 / §6-10 / §7）。
   題材は 3 つだけ: マイクラのコマンド例 / Python の小さなゲーム / 回路の電気。各題材に仮の案 3 つ（固定）。
   図は数値だけから組み立てる線画 SVG（墨 + オリーブ、光と星だけ橙）。利用者の入力は図に入れない。
   文言は [js, es] の組。返事の型は design-v3 §7 の表どおり（題材ごとに変わる語だけ {param} などで差し込む）。
   node からも読めるようにしてある（tools/make-test.js）。 */
(function (root) {
  'use strict';
  var DES = root.DES = root.DES || {};
  var MD = DES.makeData = {};

  var INK = '#292c29', OLIVE = '#524e44', ORANGE = '#ed922c', SAND = '#f1ece3', PAPER = '#ffffff', SOFT = '#fbecd7', MID = '#e4ded1';

  // ---------- 題材 ----------
  MD.THEMES = ['mc', 'py', 'circuit'];
  var THEME = {
    mc: {
      sample: 'cube', ideas: ['tower', 'bridge', 'roof'], capIdea: 'roof', variants: ['cube', 'tower', 'bridge', 'roof'],
      topic: ['マイクラの建物', 'マイクラのたてもの'],
      effect: ['できる形', 'できる形'], aim: ['形', '形'],
      changeable: [['大きさ', '大きさ'], ['ブロック', 'ブロック']],
      params: [
        { key: 'size', label: ['大きさ', '大きさ'], min: 2, max: 8, def: 4 },
        { key: 'block', label: ['ブロック', 'ブロック'], min: 0, max: 2, def: 0, names: [['石', '石'], ['ガラス', 'ガラス'], ['オークの板', 'オークのいた']] }
      ],
      steps: [['大きさを変える', '大きさをかえる'], ['ブロックを選ぶ', 'ブロックをえらぶ'], ['入口をあける', '入り口をあける']],
      extSteps: [['写真を入れる', '写真を入れる'], ['屋根を置く', 'やねをおく']],
      find: [{ size: 6, block: 1 }, { size: 5, block: 2 }]
    },
    py: {
      sample: 'catch', ideas: ['dodge', 'coin', 'maze'], capIdea: 'maze', variants: ['catch', 'dodge', 'coin', 'maze'],
      topic: ['Python のゲーム', 'Python のゲーム'],
      effect: ['星の動き', '星の動き'], aim: ['動き', '動き'],
      changeable: [['速さ', 'はやさ'], ['数', '数']],
      params: [
        { key: 'speed', label: ['速さ', 'はやさ'], min: 1, max: 5, def: 2 },
        { key: 'count', label: ['数', '数'], min: 1, max: 6, def: 3 }
      ],
      steps: [['速さを変える', 'はやさをかえる'], ['星の数を変える', '星の数をかえる'], ['キャラの色を決める', 'キャラの色をきめる']],
      extSteps: [['写真を入れる', '写真を入れる'], ['星の数を変える', '星の数をかえる']],
      find: [{ speed: 3, count: 5 }, { speed: 4, count: 2 }]
    },
    circuit: {
      sample: 'single', ideas: ['series', 'bulbs', 'switch'], capIdea: 'switch', variants: ['single', 'series', 'bulbs', 'switch'],
      topic: ['電気の回路', 'でんきの回路'],
      effect: ['電球の明るさ', '電球の明るさ'], aim: ['明るさ', '明るさ'],
      changeable: [['電圧', 'でんあつ'], ['抵抗', 'ていこう']],
      params: [
        { key: 'volt', label: ['電圧', 'でんあつ'], min: 0, max: 4, def: 1, names: ['1.5 V', '3 V', '4.5 V', '6 V', '9 V'], vals: [1.5, 3, 4.5, 6, 9] },
        { key: 'ohm', label: ['抵抗', 'ていこう'], min: 0, max: 4, def: 2, names: ['100 Ω', '220 Ω', '330 Ω', '470 Ω', '1000 Ω'], vals: [100, 220, 330, 470, 1000] }
      ],
      steps: [['電圧を変える', 'でんあつをかえる'], ['抵抗を変える', 'ていこうをかえる'], ['スイッチを足す', 'スイッチをたす']],
      extSteps: [['写真を入れる', '写真を入れる'], ['スイッチを足す', 'スイッチをたす']],
      find: [{ volt: 2, ohm: 1 }, { volt: 3, ohm: 3 }]
    }
  };
  MD.theme = function (id) { return THEME[id] || THEME.mc; };
  MD.CANDIDATE_STEP = ['案を選ぶ', '案をえらぶ'];
  MD.STEP_MIN = 5;
  MD.EXT_BUILD_STEPS = [['塔を建てる', 'とうをたてる'], ['塔を 2 倍にする', 'とうを 2 倍にする'], ['屋根を置く', 'やねをおく']];

  // 見本 3 枚（入口の順。確定 Q2）
  MD.samples = [
    { id: 'mc', theme: 'mc', variant: 'cube' },
    { id: 'py', theme: 'py', variant: 'catch' },
    { id: 'circuit', theme: 'circuit', variant: 'single' }
  ];

  // 案（バリアント）の名前と既定値
  var VARIANT = {
    'mc.cube': { title: ['マイクラのコマンド例', 'マイクラのコマンド例'], values: { size: 4, block: 0 } },
    'mc.tower': { title: ['石の塔', '石のとう'], values: { size: 4, block: 0 } },
    'mc.bridge': { title: ['ガラスの橋', 'ガラスのはし'], values: { size: 4, block: 1 } },
    'mc.roof': { title: ['円すいの屋根', 'えんすいのやね'], values: { size: 4, block: 2 } },
    'py.catch': { title: ['Python の小さなゲーム', 'Python の小さなゲーム'], values: { speed: 2, count: 3 } },
    'py.dodge': { title: ['岩をよけるゲーム', '岩をよけるゲーム'], values: { speed: 3, count: 4 } },
    'py.coin': { title: ['コインを集めるゲーム', 'コインをあつめるゲーム'], values: { speed: 2, count: 5 } },
    'py.maze': { title: ['迷路を進むゲーム', 'めいろを進むゲーム'], values: { speed: 2, count: 3 } },
    'circuit.single': { title: ['回路の電気', '回路のでんき'], values: { volt: 1, ohm: 2 } },
    'circuit.series': { title: ['電池 2 個の回路', '電池 2 この回路'], values: { volt: 1, ohm: 2 } },
    'circuit.bulbs': { title: ['電球 2 個の回路', '電球 2 この回路'], values: { volt: 2, ohm: 2 } },
    'circuit.switch': { title: ['スイッチ付きの回路', 'スイッチつきの回路'], values: { volt: 1, ohm: 2 } }
  };
  MD.variant = function (theme, v) { return VARIANT[theme + '.' + v] || VARIANT[theme + '.' + MD.theme(theme).sample]; };
  MD.variantValues = function (theme, v) { return JSON.parse(JSON.stringify(MD.variant(theme, v).values)); };

  // バディが「外のもの」に引き受ける作業（design-v3 §6-2 外部・実物の記録 / §6-4）。cmd は試作（線画とコマンド）を出す
  MD.extCards = {
    mc: {
      calc: { title: ['屋根の寸法', 'やねの大きさ'], lines: [['塔の幅 3 → 屋根の土台は 5×5', 'とうのはば 3 → やねのどだいは 5×5'], ['段は 3 段（5・3・1）', 'だんは 3 だん（5・3・1）'], ['ブロックは 35 個', 'ブロックは 35 こ']] },
      steps: { title: ['屋根の手順', 'やねの手じゅん'], lines: [['1. 塔のてっぺんに 5×5 の板を置く', '1. とうのてっぺんに 5×5 のいたをおく'], ['2. その上に 3×3 を置く', '2. その上に 3×3 をおく'], ['3. いちばん上に 1 個置く', '3. いちばん上に 1 こおく']] },
      cmd: { variant: 'roof', values: { size: 3, block: 2 } }
    },
    py: {
      calc: { title: ['画面の大きさ', '画面の大きさ'], lines: [['画面は 320×240', '画面は 320×240'], ['星の間は 64 ずつ', '星のあいだは 64 ずつ'], ['5 個なら横にならべて入る', '5 こなら横にならべて入る']] },
      steps: { title: ['ゲームの手順', 'ゲームの手じゅん'], lines: [['1. キャラを左右に動かす', '1. キャラを左右に動かす'], ['2. 星を上から落とす', '2. 星を上からおとす'], ['3. ふれたら数を 1 ふやす', '3. ふれたら数を 1 ふやす']] },
      cmd: { variant: 'coin', values: { speed: 2, count: 5 } }
    },
    circuit: {
      calc: { title: ['電流の計算', 'でんりゅうの計算'], lines: [['3 V ÷ 330 Ω = 9.1 mA', '3 V ÷ 330 Ω = 9.1 mA'], ['6 V なら 18.2 mA', '6 V なら 18.2 mA'], ['電球は 20 mA くらいまで', '電球は 20 mA くらいまで']] },
      steps: { title: ['回路の手順', '回路の手じゅん'], lines: [['1. 電池ボックスに電池を入れる', '1. 電池ボックスに電池を入れる'], ['2. 抵抗をつなぐ', '2. ていこうをつなぐ'], ['3. 電球をつないで、スイッチを入れる', '3. 電球をつないで、スイッチを入れる']] },
      cmd: { variant: 'switch', values: { volt: 1, ohm: 2 } }
    }
  };

  // 作品に入れる写真・スクショのダミー（design-v3 §6-10。読み取りは物・形・材料・工程の手がかりだけ。顔・名前は書かない）
  MD.captures = [
    { id: 'cap-mc', theme: 'mc', n: 1, title: ['塔のある建物', 'とうのあるたてもの'], read: ['石とガラスの塔。屋根はまだ無い', '石とガラスのとう。やねはまだない'], made: 0, catalogId: 'mc-build' },
    { id: 'cap-py', theme: 'py', n: 0, title: ['星が落ちるゲーム', '星がおちるゲーム'], read: ['キャラが 1 つと、上から落ちる星が 4 つの画面', 'キャラが 1 つと、上からおちる星が 4 つの画面'], made: 3, catalogId: 'prog-python' },
    { id: 'cap-circuit', theme: 'circuit', n: 0, title: ['電球がつく回路', '電球がつく回路'], read: ['電池 2 個と電球 1 個の回路。スイッチはまだ無い', '電池 2 こと電球 1 この回路。スイッチはまだない'], made: 5, catalogId: null }
  ];
  MD.capture = function (id) { for (var i = 0; i < MD.captures.length; i++) if (MD.captures[i].id === id) return MD.captures[i]; return null; };
  MD.PHOTO_COUNT = 4;

  // ---------- 返事（design-v3 §7「バディの返事の型」。題材で変わる語だけ差し込む） ----------
  MD.replies = {
    land: ['話していたことから、仮の案を 3 つ置いたよ。近いものを選ぶか、違うところを教えて', '話していたことから、かりの案を 3 つおいたよ。近いのをえらぶか、ちがうところを教えて'],
    open: ['まず動かしてみる？ 試した感触から、作りたい方向を考えられる', 'この見本、動かしてみる？ さわってから、変えたいところを考えてもいいよ'],
    test: ['選んだ{param}に変えて、{effect}に違いが出たね。狙っていた{aim}に近い？', '{param}をかえたら、さっきとちがう{aim}になったね。変えたところが{aim}に出たね'],
    left: ['細かな作業はこちらで進めた。残したい点と変えたい点を一緒に決めよう', '細かいところは手伝ったよ。動いたら、気になるところを教えてね'],
    photo: ['{what}んだね。前の写真と並べて見る？', '{what}んだね。前の写真とならべて見る？'],
    unknown: ['ここはまだ分からない。確かめる方法を一緒に考えよう', 'ここはまだ分からない。たしかめる方法をいっしょに考えよう']
  };

  // ---------- 値の読み ----------
  function pick(pair, mode) { return Array.isArray(pair) ? (mode === 'es' && pair[1] != null ? pair[1] : pair[0]) : pair; }
  MD.pick = pick;
  function param(theme, key) {
    var ps = MD.theme(theme).params;
    for (var i = 0; i < ps.length; i++) if (ps[i].key === key) return ps[i];
    return null;
  }
  MD.param = param;
  // スライダーの値の見せ方（名前のある値は名前）
  MD.valueLabel = function (theme, key, v, mode) {
    var p = param(theme, key);
    if (!p) return String(v);
    if (p.names) return pick(p.names[v] != null ? p.names[v] : p.names[0], mode);
    return String(v);
  };
  function num(theme, key, v) { var p = param(theme, key); return p && p.vals ? p.vals[v] : v; }
  function circuitNums(variant, v) {
    var V = num('circuit', 'volt', v.volt), R = num('circuit', 'ohm', v.ohm);
    if (variant === 'series') V = V * 2;
    var I = V / R * 1000;
    if (variant === 'bulbs') I = I / 2;
    var I1 = Math.round(I * 10) / 10;
    return { V: V, R: R, I: I1, B: Math.max(0, Math.min(100, Math.round(I / 30 * 100))) };
  }
  MD.circuitNums = circuitNums;
  function mcCount(variant, s) {
    if (variant === 'tower') { var h = 2 * s; return 9 * h - Math.max(0, h - 2); }
    if (variant === 'bridge') return 2 * (2 * s);
    if (variant === 'roof') { var n = 0; for (var i = 0; i < s; i++) { var w = 2 * (s - 1 - i) + 1; n += w * w; } return n; }
    var inner = Math.max(0, s - 2);
    return s * s * s - inner * inner * inner;
  }
  MD.mcCount = mcCount;
  function fmt(s, vars) { return String(s).replace(/\{(\w+)\}/g, function (all, k) { return vars && vars[k] != null ? String(vars[k]) : all; }); }

  // 結果 1 行（「試す」で確かめたこと）
  MD.result = function (stage, mode) {
    if (!stage || stage.kind === 'note') return '';
    var v = stage.values || {}, t = stage.theme, va = stage.variant;
    if (t === 'mc') {
      var blk = MD.valueLabel('mc', 'block', v.block, mode), s = v.size, n = mcCount(va, s);
      var shape = va === 'tower' ? fmt(pick(['高さ {h} の塔', '高さ {h} のとう'], mode), { h: 2 * s })
        : va === 'bridge' ? fmt(pick(['長さ {l} の橋', '長さ {l} のはし'], mode), { l: 2 * s })
          : va === 'roof' ? fmt(pick(['{s} 段の屋根', '{s} だんのやね'], mode), { s: s })
            : fmt(pick(['{s}×{s}×{s} の箱', '{s}×{s}×{s} のはこ'], mode), { s: s });
      return fmt(pick(['{blk}で {shape} · ブロック {n} 個', '{blk}で {shape} · ブロック {n} こ'], mode), { blk: blk, shape: shape, n: n });
    }
    if (t === 'py') {
      var what = va === 'dodge' ? pick(['岩 {c} 個が', '岩 {c} こが'], mode) : va === 'coin' ? pick(['コイン {c} 枚が', 'コイン {c} まいが'], mode)
        : va === 'maze' ? pick(['分かれ道 {c} か所の迷路を、キャラが', '分かれ道 {c} か所のめいろを、キャラが'], mode) : pick(['星 {c} 個が', '星 {c} こが'], mode);
      var how = va === 'coin' ? pick(['1 秒に {sp} マス流れる', '1 びょうに {sp} マスながれる'], mode)
        : va === 'maze' ? pick(['1 秒に {sp} マス進む', '1 びょうに {sp} マス進む'], mode) : pick(['1 秒に {sp} マス落ちる', '1 びょうに {sp} マスおちる'], mode);
      return fmt(what + ' ' + how, { c: v.count, sp: v.speed });
    }
    var c = circuitNums(va, v);
    return fmt(pick(['電流 {I} mA · 明るさ {B}%', 'でんりゅう {I} mA · 明るさ {B}%'], mode), c);
  };
  // コマンド・コードの短い表示（作業対象の中身。言葉は入れない）
  MD.code = function (stage) {
    if (!stage || stage.kind === 'note') return '';
    var v = stage.values || {}, t = stage.theme, va = stage.variant;
    if (t === 'mc') {
      var id = ['stone', 'glass', 'oak_planks'][v.block] || 'stone', s = v.size;
      if (va === 'tower') return '/fill ~ ~ ~ ~2 ~' + (2 * s - 1) + ' ~2 minecraft:' + id + ' hollow';
      if (va === 'bridge') return '/fill ~ ~ ~ ~' + (2 * s - 1) + ' ~ ~1 minecraft:' + id;
      if (va === 'roof') {
        var out = [];
        for (var i = 0; i < Math.min(s, 3); i++) { var k = s - 1 - i; out.push('/fill ~-' + k + ' ~' + i + ' ~-' + k + ' ~' + k + ' ~' + i + ' ~' + k + ' minecraft:' + id); }
        if (s > 3) out.push('…');
        return out.join('\n');
      }
      return '/fill ~1 ~ ~1 ~' + s + ' ~' + (s - 1) + ' ~' + s + ' minecraft:' + id + ' hollow';
    }
    if (t === 'py') {
      var name = va === 'dodge' ? 'rocks' : va === 'coin' ? 'coins' : va === 'maze' ? 'branches' : 'stars';
      return 'speed = ' + v.speed + '\n' + name + ' = ' + v.count + '\nplayer.move(speed)';
    }
    var c = circuitNums(va, v);
    return c.V + ' V ÷ ' + c.R + ' Ω = ' + c.I + ' mA';
  };
  // 案のカードの 1 行説明（「くさび形。高さ 20」の型。形と数だけを書く）
  MD.desc = function (stage, mode) {
    if (!stage) return '';
    if (stage.kind === 'note') return pick(stage.lines && stage.lines[0], mode) || '';
    var v = stage.values || {}, t = stage.theme, va = stage.variant;
    if (t === 'mc') {
      var blk = MD.valueLabel('mc', 'block', v.block, mode);
      if (va === 'tower') return fmt(pick(['{blk}。高さ {h}', '{blk}。高さ {h}'], mode), { blk: blk, h: 2 * v.size });
      if (va === 'bridge') return fmt(pick(['{blk}。長さ {l}', '{blk}。長さ {l}'], mode), { blk: blk, l: 2 * v.size });
      if (va === 'roof') return fmt(pick(['{blk}。{s} 段', '{blk}。{s} だん'], mode), { blk: blk, s: v.size });
      return fmt(pick(['{blk}。{s}×{s}×{s}', '{blk}。{s}×{s}×{s}'], mode), { blk: blk, s: v.size });
    }
    if (t === 'py') return fmt(pick(['速さ {sp}・数 {c}', 'はやさ {sp}・数 {c}'], mode), { sp: v.speed, c: v.count });
    return MD.valueLabel('circuit', 'volt', v.volt, mode) + ' · ' + MD.valueLabel('circuit', 'ohm', v.ohm, mode);
  };

  // ---------- 線画 SVG ----------
  function wrap(body, cls) {
    return '<svg class="mk-art' + (cls ? ' ' + cls : '') + '" viewBox="0 0 240 150" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">' + body + '</svg>';
  }
  function r1(n) { return Math.round(n * 10) / 10; }
  function rect(x, y, w, h, fill, extra) {
    return '<rect x="' + r1(x) + '" y="' + r1(y) + '" width="' + r1(w) + '" height="' + r1(h) + '" fill="' + fill + '" stroke="' + INK + '" stroke-width="1.2"' + (extra || '') + '/>';
  }
  function line(x1, y1, x2, y2, col, w, extra) {
    return '<path d="M' + r1(x1) + ' ' + r1(y1) + 'L' + r1(x2) + ' ' + r1(y2) + '" stroke="' + (col || INK) + '" stroke-width="' + (w || 1.2) + '" fill="none" stroke-linecap="round"' + (extra || '') + '/>';
  }
  function poly(pts, fill) {
    return '<path d="M' + pts.map(function (p) { return r1(p[0]) + ' ' + r1(p[1]); }).join('L') + 'Z" fill="' + fill + '" stroke="' + INK + '" stroke-width="1.2" stroke-linejoin="round"/>';
  }
  // ブロック 1 個（石 = 点 / ガラス = 斜めの光 / 板 = 木目）
  function block(x, y, b, kind) {
    var out = rect(x, y, b, b, kind === 2 ? SAND : PAPER);
    if (kind === 0) out += '<circle cx="' + r1(x + b * 0.35) + '" cy="' + r1(y + b * 0.4) + '" r="' + r1(Math.max(0.8, b * 0.07)) + '" fill="' + OLIVE + '"/>';
    else if (kind === 1) out += line(x + b * 0.25, y + b * 0.65, x + b * 0.6, y + b * 0.3, OLIVE, 1);
    else out += line(x + b * 0.15, y + b * 0.5, x + b * 0.85, y + b * 0.5, OLIVE, 0.9);
    return out;
  }
  function mcArt(variant, v) {
    var s = v.size || 4, kind = v.block || 0, out = '';
    out += line(14, 140, 226, 140, OLIVE, 1.2);
    if (variant === 'roof') {
      var b0 = Math.min(16, 200 / (2 * s - 1), 120 / s), x0, y;
      for (var i = 0; i < s; i++) {
        var w = 2 * (s - 1 - i) + 1;
        x0 = 120 - w * b0 / 2; y = 140 - (i + 1) * b0;
        for (var j = 0; j < w; j++) out += block(x0 + j * b0, y, b0, kind);
      }
      return wrap(out);
    }
    var cols = s, rows = s, depth = s;
    if (variant === 'tower') { cols = 3; rows = 2 * s; depth = 3; }
    if (variant === 'bridge') { cols = 2 * s; rows = 1; depth = 2; }
    var b = Math.min(16, 118 / (rows + depth * 0.5), 196 / (cols + depth * 0.5));
    var d = depth * b * 0.5, W = cols * b, Hh = rows * b;
    var x = (240 - W - d) / 2, yb = variant === 'bridge' ? 112 : 140, yt = yb - Hh;
    if (variant === 'bridge') {
      out += line(x + b, yb, x + b, 140, INK, 1.4) + line(x + W - b, yb, x + W - b, 140, INK, 1.4);
      out += '<path d="M14 132 q10 -5 20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0" stroke="' + OLIVE + '" stroke-width="1" fill="none"/>';
    }
    // 上の面と右の面（奥行き）
    out += poly([[x, yt], [x + W, yt], [x + W + d, yt - d], [x + d, yt - d]], SAND);
    out += poly([[x + W, yt], [x + W + d, yt - d], [x + W + d, yb - d], [x + W, yb]], MID);
    // 奥行きの目地は 2 段おき（線が詰まりすぎないように）
    for (var k = 2; k < depth; k += 2) {
      var dk = k * b * 0.5;
      out += line(x + dk, yt - dk, x + W + dk, yt - dk, OLIVE, 0.6);
      out += line(x + W + dk, yt - dk, x + W + dk, yb - dk, OLIVE, 0.6);
    }
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) out += block(x + c * b, yt + r * b, b, kind);
    return wrap(out);
  }
  function star(cx, cy, r) {
    var pts = [];
    for (var i = 0; i < 10; i++) {
      var a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r;
      pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
    return poly(pts, ORANGE);
  }
  function screen() {
    return rect(20, 12, 200, 126, PAPER, ' rx="8"') + line(20, 28, 220, 28, INK, 1) +
      '<circle cx="31" cy="20" r="2.2" fill="' + OLIVE + '"/><circle cx="39" cy="20" r="2.2" fill="' + OLIVE + '"/><circle cx="47" cy="20" r="2.2" fill="' + OLIVE + '"/>';
  }
  function player(x, y) {
    return rect(x, y, 24, 18, SAND, ' rx="5"') + '<circle cx="' + (x + 8) + '" cy="' + (y + 8) + '" r="1.8" fill="' + INK + '"/><circle cx="' + (x + 16) + '" cy="' + (y + 8) + '" r="1.8" fill="' + INK + '"/>';
  }
  function pyArt(variant, v) {
    var n = v.count || 3, sp = v.speed || 2, out = screen(), i;
    if (variant === 'maze') {
      out += '<path d="M40 120 H110 V96 H70 V70 H150 V44 H200" stroke="' + INK + '" stroke-width="1.4" fill="none" stroke-linejoin="round"/>';
      for (i = 0; i < n; i++) {
        var bx = 60 + i * (130 / n), by = i % 2 ? 70 : 96;
        out += line(bx, by, bx, by - 14, OLIVE, 1.2);
      }
      out += '<path d="M44 114 H' + (44 + sp * 12) + '" stroke="' + ORANGE + '" stroke-width="2" stroke-dasharray="3 3" fill="none"/>';
      out += player(30, 104);
      return wrap(out);
    }
    for (i = 0; i < n; i++) {
      var x = 40 + (i + 0.5) * (160 / n), y = 46 + ((i * 29) % 46);
      if (variant === 'coin') {
        out += '<circle cx="' + r1(x) + '" cy="' + r1(y + 10) + '" r="7" fill="' + SOFT + '" stroke="' + INK + '" stroke-width="1.2"/>' + line(x, y + 6, x, y + 14, OLIVE, 1);
        for (var t = 0; t < sp; t++) out += line(x - 11 - t * 5, y + 10, x - 13 - t * 5, y + 10, OLIVE, 1);
      } else if (variant === 'dodge') {
        out += '<path d="M' + r1(x - 8) + ' ' + r1(y + 12) + 'l3 -8 8 -3 6 5 -1 8 -8 3z" fill="' + MID + '" stroke="' + INK + '" stroke-width="1.2" stroke-linejoin="round"/>';
        for (var u = 0; u < sp; u++) out += line(x, y - 2 - u * 5, x, y - 4 - u * 5, OLIVE, 1);
      } else {
        out += star(x, y + 8, 7);
        for (var q = 0; q < sp; q++) out += line(x, y - 2 - q * 5, x, y - 4 - q * 5, OLIVE, 1);
      }
    }
    out += player(108, 114);
    return wrap(out);
  }
  function bulb(cx, cy, B) {
    var out = '', rays = Math.round(B / 100 * 8);
    for (var i = 0; i < rays; i++) {
      var a = -Math.PI / 2 + (i - (rays - 1) / 2) * 0.42;
      out += line(cx + Math.cos(a) * 17, cy + Math.sin(a) * 17, cx + Math.cos(a) * (21 + B / 14), cy + Math.sin(a) * (21 + B / 14), ORANGE, 1.6);
    }
    out += '<circle cx="' + cx + '" cy="' + cy + '" r="12" fill="' + (B > 0 ? SOFT : PAPER) + '" stroke="' + INK + '" stroke-width="1.4"/>';
    out += '<path d="M' + (cx - 5) + ' ' + (cy + 4) + ' q2.5 -9 5 0 q2.5 -9 5 0" stroke="' + OLIVE + '" stroke-width="1.1" fill="none"/>';
    return out;
  }
  function battery(x, y) {
    return '<rect x="' + (x - 14) + '" y="' + (y - 7) + '" width="28" height="14" fill="#fcfbf8" stroke="none"/>' +
      line(x - 12, y - 4, x + 12, y - 4, INK, 1.6) + line(x - 6, y + 4, x + 6, y + 4, INK, 3);
  }
  function circuitArt(variant, v) {
    var c = circuitNums(variant, v), out = '';
    out += '<path d="M44 28 H200 V122 H44 Z" stroke="' + INK + '" stroke-width="1.6" fill="none" stroke-linejoin="round"/>';
    // 抵抗（上の辺のぎざぎざ）
    out += '<rect x="96" y="22" width="48" height="12" fill="#fcfbf8" stroke="none"/>';
    out += '<path d="M96 28 l4 -6 8 12 8 -12 8 12 8 -12 8 12 4 -6" stroke="' + INK + '" stroke-width="1.4" fill="none" stroke-linejoin="round"/>';
    // 電池（左の辺）。直列は 2 個
    if (variant === 'series') { out += battery(44, 58) + battery(44, 92); } else out += battery(44, 75);
    // 電球（右の辺）。2 個のときは下の辺にもう 1 つ
    out += '<rect x="188" y="60" width="24" height="30" fill="#fcfbf8" stroke="none"/>' + bulb(200, 75, c.B);
    if (variant === 'bulbs') out += '<rect x="108" y="110" width="30" height="24" fill="#fcfbf8" stroke="none"/>' + bulb(122, 122, c.B);
    if (variant === 'switch') {
      out += '<rect x="108" y="116" width="34" height="12" fill="#fcfbf8" stroke="none"/>';
      out += '<circle cx="110" cy="122" r="2.4" fill="' + INK + '"/><circle cx="140" cy="122" r="2.4" fill="' + INK + '"/>' + line(110, 122, 138, 115, INK, 1.6);
    }
    return wrap(out);
  }
  MD.art = function (stage) {
    if (!stage) return '';
    if (stage.kind === 'note') return '';
    var v = stage.values || MD.variantValues(stage.theme, stage.variant);
    if (stage.theme === 'py') return pyArt(stage.variant, v);
    if (stage.theme === 'circuit') return circuitArt(stage.variant, v);
    return mcArt(stage.variant, v);
  };
  // 写真・スクショのダミー（四隅の枠で「写真」と分かるようにする）
  function corners() {
    return '<path d="M8 22 V8 H22 M218 8 H232 V22 M232 128 V142 H218 M22 142 H8 V128" stroke="' + OLIVE + '" stroke-width="1.6" fill="none"/>';
  }
  function mcShot(n) {
    var out = '<rect x="8" y="8" width="224" height="134" fill="#fcfbf8"/><rect x="8" y="118" width="224" height="24" fill="' + SAND + '"/>' + line(8, 118, 232, 118, OLIVE, 1.2);
    var h = n === 0 ? 4 : 8, b = 11, x = 120 - 1.5 * b, yt = 118 - h * b;
    for (var r = 0; r < h; r++) for (var c = 0; c < 3; c++) {
      var glass = n >= 1 && r % 3 === 1 && c === 1;
      out += block(x + c * b, yt + r * b, b, glass ? 1 : 0);
    }
    if (n >= 2) out += poly([[x - 8, yt], [x + 3 * b + 8, yt], [120, yt - 26]], MID);
    if (n >= 3) { out += rect(60, 96, 26, 22, PAPER) + line(73, 96, 73, 118, OLIVE, 1) + rect(154, 96, 26, 22, PAPER) + line(167, 96, 167, 118, OLIVE, 1); }
    return out;
  }
  MD.photoArt = function (photo) {
    if (!photo) return '';
    var n = photo.n || 0, inner;
    if (photo.theme === 'py') {
      inner = pyArt(['catch', 'dodge', 'coin', 'maze'][n % 4], { speed: 2, count: 4 + (n % 2) * 2 });
    } else if (photo.theme === 'circuit') {
      inner = circuitArt(['series', 'switch', 'bulbs', 'single'][n % 4], { volt: 1, ohm: 2 });
    } else {
      return wrap(mcShot(n % MD.PHOTO_COUNT) + corners(), 'is-photo');
    }
    return inner.replace('</svg>', corners() + '</svg>').replace('class="mk-art"', 'class="mk-art is-photo"');
  };

  // ---------- 最初からある制作中 1 件（design-v3 §8 C: 予定表 p1「建築（大きく）」の外の記録） ----------
  MD.seedActivities = function () {
    return [{
      id: 'act-build', title: '建築（大きく）', origin: 'plan', theme: 'mc', catalogId: 'mc-build', sampleId: null,
      quote: null, stage: null, base: null, baseTime: '10:02',
      ext: { link: 'Minecraft · はるとの島', photos: [
        { id: 'act-build-ph1', theme: 'mc', n: 0, kind: 'shot', time: '10:06' },
        { id: 'act-build-ph2', theme: 'mc', n: 1, kind: 'shot', time: '10:14' }
      ] },
      steps: JSON.parse(JSON.stringify(MD.EXT_BUILD_STEPS)), stepIdx: 2, next: null,
      changes: [
        { id: 'act-build-c1', who: 'own', kind: 'shot', time: '10:06', what: { text: '石で塔を建てた' }, snap: null, photoId: 'act-build-ph1' },
        { id: 'act-build-c2', who: 'own', with: '田中さん', kind: 'shot', time: '10:14', what: { text: '塔を 2 倍にした' }, snap: null, photoId: 'act-build-ph2' }
      ],
      shelf: [],
      thread: [
        { id: 'act-build-m1', who: 'child', time: '10:14', text: '塔を 2 倍にした' },
        { id: 'act-build-m2', who: 'buddy', time: '10:14', r: 'photo', v: { what: { text: '塔を 2 倍にした' } }, opts: [{ a: 'mk-compare-photos', label: { k: 'compare' } }] }
      ],
      state: 'working', pauseCount: 0, declined: 0, offered: false, resumeNote: null,
      clock: 614, seq: 10, touched: 1, draft: ''
    }];
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = MD;
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
