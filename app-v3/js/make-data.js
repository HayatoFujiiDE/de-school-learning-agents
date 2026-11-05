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
      stepBase: [['大きさを変える', '大きさをかえる'], ['ブロックを選ぶ', 'ブロックをえらぶ'], ['入口をあける', '入り口をあける']],
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
      stepBase: [['速さを変える', 'はやさをかえる'], ['星の数を変える', '星の数をかえる'], ['キャラの色を決める', 'キャラの色をきめる']],
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
      stepBase: [['電圧を変える', 'でんあつをかえる'], ['抵抗を変える', 'ていこうをかえる'], ['スイッチを足す', 'スイッチをたす']],
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
    'mc.tower': { title: ['石の塔', '石のとう'], values: { size: 4, block: 0 }, step3: ['窓をあける', 'まどをあける'] },
    'mc.bridge': { title: ['ガラスの橋', 'ガラスのはし'], values: { size: 4, block: 1 }, step3: ['手すりを付ける', 'てすりをつける'] },
    'mc.roof': { title: ['円すいの屋根', 'えんすいのやね'], values: { size: 4, block: 2 }, step3: ['てっぺんを決める', 'てっぺんをきめる'] },
    'py.catch': { title: ['Python の小さなゲーム', 'Python の小さなゲーム'], values: { speed: 2, count: 3 }, thing: ['星', '星'], mover: ['星', '星'] },
    'py.dodge': { title: ['岩をよけるゲーム', '岩をよけるゲーム'], values: { speed: 3, count: 4 }, thing: ['岩', '岩'], mover: ['岩', '岩'] },
    'py.coin': { title: ['コインを集めるゲーム', 'コインをあつめるゲーム'], values: { speed: 2, count: 5 }, thing: ['コイン', 'コイン'], mover: ['コイン', 'コイン'] },
    'py.maze': { title: ['迷路を進むゲーム', 'めいろを進むゲーム'], values: { speed: 2, count: 3 }, thing: ['分かれ道', 'わかれ道'], mover: ['キャラ', 'キャラ'], step3: ['ゴールの場所を決める', 'ゴールの場所をきめる'] },
    'circuit.single': { title: ['回路の電気', '回路のでんき'], values: { volt: 1, ohm: 2 } },
    'circuit.series': { title: ['電池 2 個の回路', '電池 2 この回路'], values: { volt: 1, ohm: 2 } },
    'circuit.bulbs': { title: ['電球 2 個の回路', '電球 2 この回路'], values: { volt: 2, ohm: 2 } },
    'circuit.switch': { title: ['スイッチ付きの回路', 'スイッチつきの回路'], values: { volt: 1, ohm: 2 }, step3: ['電球を 2 個にする', '電球を 2 こにする'] }
  };
  MD.variant = function (theme, v) { return VARIANT[theme + '.' + v] || VARIANT[theme + '.' + MD.theme(theme).sample]; };
  MD.variantValues = function (theme, v) { return JSON.parse(JSON.stringify(MD.variant(theme, v).values)); };
  // 今の一歩の手順（3 つ）。名詞は今の作業対象（案）から取る（§U-11 (a): 岩をよけるゲームに「星」を出さない）
  MD.stepsFor = function (theme, variant) {
    var th = MD.theme(theme), v = MD.variant(theme, variant), base = th.stepBase;
    var second = theme === 'py' ? [v.thing[0] + 'の数を変える', v.thing[1] + 'の数をかえる'] : base[1];
    return JSON.parse(JSON.stringify([base[0], second, v.step3 || base[2]]));
  };
  MD.THEMES.forEach(function (t) { THEME[t].steps = MD.stepsFor(t, THEME[t].sample); });

  // バディが「外のもの」に引き受ける作業（design-v3 §6-2 外部・実物の記録 / §6-4）。cmd は試作（線画とコマンド）を出す
  MD.extCards = {
    mc: {
      calc: { title: ['屋根の寸法', 'やねの大きさ'], lines: [['塔の幅 3 → 屋根の土台は 5×5', 'とうのはば 3 → やねのどだいは 5×5'], ['段は 3 段（5・3・1）', 'だんは 3 だん（5・3・1）'], ['ブロックは 35 個', 'ブロックは 35 こ']],
        alt: { title: ['屋根の寸法（4 段）', 'やねの大きさ（4 だん）'], lines: [['塔の幅 3 → 屋根の土台は 7×7', 'とうのはば 3 → やねのどだいは 7×7'], ['段は 4 段（7・5・3・1）', 'だんは 4 だん（7・5・3・1）'], ['ブロックは 84 個', 'ブロックは 84 こ']] } },
      steps: { title: ['屋根の手順', 'やねの手じゅん'], lines: [['1. 塔のてっぺんに 5×5 の板を置く', '1. とうのてっぺんに 5×5 のいたをおく'], ['2. その上に 3×3 を置く', '2. その上に 3×3 をおく'], ['3. いちばん上に 1 個置く', '3. いちばん上に 1 こおく']],
        alt: { title: ['屋根の手順（はみ出す形）', 'やねの手じゅん（はみ出す形）'], lines: [['1. 塔のまわりに 1 つはみ出す板を置く', '1. とうのまわりに 1 つはみ出すいたをおく'], ['2. 内側へ 1 つずつ小さく重ねる', '2. 内がわへ 1 つずつ小さくかさねる'], ['3. てっぺんに旗を立てる', '3. てっぺんにはたを立てる']] } },
      cmd: { variant: 'roof', values: { size: 3, block: 2 } }
    },
    py: {
      calc: { title: ['画面の大きさ', '画面の大きさ'], lines: [['画面は 320×240', '画面は 320×240'], ['星の間は 64 ずつ', '星のあいだは 64 ずつ'], ['5 個なら横にならべて入る', '5 こなら横にならべて入る']],
        alt: { title: ['画面の大きさ（横長）', '画面の大きさ（よこ長）'], lines: [['画面は 480×270', '画面は 480×270'], ['星の間は 96 ずつ', '星のあいだは 96 ずつ'], ['5 個なら横にならべて入る', '5 こなら横にならべて入る']] } },
      steps: { title: ['ゲームの手順', 'ゲームの手じゅん'], lines: [['1. キャラを左右に動かす', '1. キャラを左右に動かす'], ['2. 星を上から落とす', '2. 星を上からおとす'], ['3. ふれたら数を 1 ふやす', '3. ふれたら数を 1 ふやす']],
        alt: { title: ['ゲームの手順（よける形）', 'ゲームの手じゅん（よける形）'], lines: [['1. キャラを左右に動かす', '1. キャラを左右に動かす'], ['2. 岩を上から落とす', '2. 岩を上からおとす'], ['3. ふれたら最初から', '3. ふれたらさいしょから']] } },
      cmd: { variant: 'coin', values: { speed: 2, count: 5 } }
    },
    circuit: {
      calc: { title: ['電流の計算', 'でんりゅうの計算'], lines: [['3 V ÷ 330 Ω = 9.1 mA', '3 V ÷ 330 Ω = 9.1 mA'], ['6 V なら 18.2 mA', '6 V なら 18.2 mA'], ['電球は 20 mA くらいまで', '電球は 20 mA くらいまで']],
        alt: { title: ['電流の計算（電池 2 個）', 'でんりゅうの計算（電池 2 こ）'], lines: [['6 V ÷ 330 Ω = 18.2 mA', '6 V ÷ 330 Ω = 18.2 mA'], ['9 V なら 27.3 mA', '9 V なら 27.3 mA'], ['電球は 20 mA くらいまで', '電球は 20 mA くらいまで']] } },
      steps: { title: ['回路の手順', '回路の手じゅん'], lines: [['1. 電池ボックスに電池を入れる', '1. 電池ボックスに電池を入れる'], ['2. 抵抗をつなぐ', '2. ていこうをつなぐ'], ['3. 電球をつないで、スイッチを入れる', '3. 電球をつないで、スイッチを入れる']],
        alt: { title: ['回路の手順（スイッチ）', '回路の手じゅん（スイッチ）'], lines: [['1. 電池ボックスに電池を入れる', '1. 電池ボックスに電池を入れる'], ['2. スイッチと抵抗をつなぐ', '2. スイッチとていこうをつなぐ'], ['3. 電球をつないで、スイッチを入れる', '3. 電球をつないで、スイッチを入れる']] } },
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
    // 「羽を広げたら、さっきよりゆっくり落ちたね」の 羽・広げ・ゆっくり落ちた・動き だけを題材の語に差し替える（§U-11 指摘 21）
    test: ['選んだ{param}に変えて、{effect}に違いが出たね。狙っていた{aim}に近い？', '{param}をかえたら、さっきより{how}ね。変えたところが{aim}に出たね'],
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
  // ブロック 1 個。種類が地の色でも分かるようにする（石 = 灰の地 + 点 / ガラス = 白 + 斜めの光 2 本 / 板 = 薄橙の地 + 木目 2 本）
  function block(x, y, b, kind) {
    var out = rect(x, y, b, b, kind === 0 ? MID : (kind === 1 ? PAPER : SOFT));
    if (kind === 0) out += '<circle cx="' + r1(x + b * 0.35) + '" cy="' + r1(y + b * 0.4) + '" r="' + r1(Math.max(0.9, b * 0.08)) + '" fill="' + OLIVE + '"/>';
    else if (kind === 1) out += line(x + b * 0.2, y + b * 0.6, x + b * 0.55, y + b * 0.25, OLIVE, 1) + line(x + b * 0.45, y + b * 0.8, x + b * 0.8, y + b * 0.45, OLIVE, 1);
    else out += line(x + b * 0.15, y + b * 0.38, x + b * 0.85, y + b * 0.38, OLIVE, 0.9) + line(x + b * 0.15, y + b * 0.68, x + b * 0.85, y + b * 0.68, OLIVE, 0.9);
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
  // 図に出す量（§U-11 (b): 数 = 個数、速さ = 動きの線の長さ、大きさ = ブロック数、電圧 = 電池の数、抵抗 = ぎざぎざの数、
  // 電圧・抵抗の結果 = 電球の光の大きさ）。線画とテスト（artMarks）の両方がこの値を使う
  function trailLen(sp) { return 6 + sp * 7; }
  function pyMarks(v) { return { objects: v.count || 3, trail: trailLen(v.speed || 2) }; }
  function circuitMarks(variant, v) {
    var c = circuitNums(variant, v);
    // 電池の数は上限で止めない（電池 2 個の回路 6 V → 9 V でも数が変わる。§U-12 指摘 b）
    return { cells: Math.max(1, Math.round(c.V / 1.5)), teeth: 2 + (v.ohm || 0), rays: Math.round(c.B / 100 * 8), glow: Math.round(13 + c.B / 5), speed: null };
  }
  // 速さの目盛り（画面の右上に 5 つ。速さの数だけ塗る）: 線の長さが図の端で止まっても、速さが変われば必ず図が変わる（§U-12 回帰 2）
  function speedMeter(sp) {
    var out = '';
    for (var i = 0; i < 5; i++) out += '<rect x="' + (176 + i * 8) + '" y="' + (22 - i) + '" width="5" height="' + (4 + i) + '" rx="1" fill="' + (i < sp ? ORANGE : PAPER) + '" stroke="' + OLIVE + '" stroke-width="0.8"/>';
    return out;
  }
  function pyArt(variant, v) {
    var mk = pyMarks(v), n = mk.objects, L = mk.trail, out = screen() + speedMeter(v.speed || 2), i;
    if (variant === 'maze') {
      out += '<path d="M40 120 H110 V96 H70 V70 H150 V44 H200" stroke="' + INK + '" stroke-width="1.4" fill="none" stroke-linejoin="round"/>';
      for (i = 0; i < n; i++) {
        var bx = 60 + i * (130 / n), by = i % 2 ? 70 : 96;
        out += line(bx, by, bx, by - 14, OLIVE, 1.4) + '<circle cx="' + r1(bx) + '" cy="' + (by - 14) + '" r="2.2" fill="' + OLIVE + '"/>';
      }
      out += '<path d="M56 114 H' + (56 + L * 2) + '" stroke="' + ORANGE + '" stroke-width="2.2" stroke-dasharray="4 3" fill="none"/>';
      out += player(30, 104);
      return wrap(out);
    }
    for (i = 0; i < n; i++) {
      // 線の長さ（最大 41）が画面の上・右の端で止まらない位置に置く
      var x = variant === 'coin' ? 34 + (i + 0.5) * (134 / n) : 40 + (i + 0.5) * (160 / n), y = 74 + ((i * 7) % 22);
      if (variant === 'coin') {
        // コインは右から左へ流れる。後ろに速さの長さの線
        out += line(x + 9, y + 10, x + 9 + L, y + 10, OLIVE, 1.4, ' stroke-dasharray="3 3"');
        out += '<circle cx="' + r1(x) + '" cy="' + r1(y + 10) + '" r="7" fill="' + SOFT + '" stroke="' + INK + '" stroke-width="1.2"/>' + line(x, y + 6, x, y + 14, OLIVE, 1);
      } else {
        // 星・岩は上から落ちる。上に速さの長さの線
        out += line(x, y - 1, x, y - 1 - L, OLIVE, 1.4, ' stroke-dasharray="3 3"');
        if (variant === 'dodge') out += '<path d="M' + r1(x - 8) + ' ' + r1(y + 12) + 'l3 -8 8 -3 6 5 -1 8 -8 3z" fill="' + MID + '" stroke="' + INK + '" stroke-width="1.2" stroke-linejoin="round"/>';
        else out += star(x, y + 8, 7);
      }
    }
    out += player(108, 114);
    return wrap(out);
  }
  function bulb(cx, cy, B, glow, rays) {
    var out = '';
    if (B > 0) out += '<circle cx="' + cx + '" cy="' + cy + '" r="' + glow + '" fill="' + SOFT + '" stroke="none"/>';
    for (var i = 0; i < rays; i++) {
      var a = -Math.PI / 2 + (i - (rays - 1) / 2) * 0.42;
      out += line(cx + Math.cos(a) * (glow - 2), cy + Math.sin(a) * (glow - 2), cx + Math.cos(a) * (glow + 6), cy + Math.sin(a) * (glow + 6), ORANGE, 1.8);
    }
    out += '<circle cx="' + cx + '" cy="' + cy + '" r="12" fill="' + (B > 0 ? '#ffe3b8' : PAPER) + '" stroke="' + INK + '" stroke-width="1.4"/>';
    out += '<path d="M' + (cx - 5) + ' ' + (cy + 4) + ' q2.5 -9 5 0 q2.5 -9 5 0" stroke="' + OLIVE + '" stroke-width="1.1" fill="none"/>';
    return out;
  }
  // 電池（左の辺）: 1.5 V ごとに 1 つ。6 つを越えたら 2 列に並べる
  function cells(x, n) {
    var cols = n > 6 ? 2 : 1, per = Math.ceil(n / cols), gap = per > 5 ? 9 : 12, top = 75 - (per - 1) * gap / 2;
    var half = cols === 2 ? 26 : 14, out = '<rect x="' + (x - half) + '" y="' + (top - 7) + '" width="' + (half * 2) + '" height="' + ((per - 1) * gap + 14) + '" fill="#fcfbf8" stroke="none"/>';
    for (var i = 0; i < n; i++) {
      var col = cols === 2 ? (i < per ? -1 : 1) : 0, row = cols === 2 ? i % per : i, cx = x + col * 13, y = top + row * gap, w = cols === 2 ? 9 : 11;
      out += line(cx - w, y - 3, cx + w, y - 3, INK, 1.5) + line(cx - w / 2, y + 2, cx + w / 2, y + 2, INK, 2.8);
    }
    return out;
  }
  // 抵抗（上の辺のぎざぎざ）: 大きいほどぎざぎざが多い
  function resistor(teeth) {
    var w = 52, step = w / teeth, d = 'M94 28';
    for (var i = 0; i < teeth; i++) d += ' L' + r1(94 + step * (i + 0.25)) + ' 21 L' + r1(94 + step * (i + 0.75)) + ' 35';
    d += ' L146 28';
    return '<rect x="92" y="18" width="56" height="20" fill="#fcfbf8" stroke="none"/><path d="' + d + '" stroke="' + INK + '" stroke-width="1.4" fill="none" stroke-linejoin="round"/>';
  }
  function circuitArt(variant, v) {
    var c = circuitNums(variant, v), mk = circuitMarks(variant, v), out = '';
    out += '<path d="M44 28 H196 V122 H44 Z" stroke="' + INK + '" stroke-width="1.6" fill="none" stroke-linejoin="round"/>';
    out += resistor(mk.teeth);
    out += cells(44, mk.cells);
    // 電球（右の辺）。2 個のときは下の辺にもう 1 つ
    out += '<rect x="184" y="60" width="24" height="30" fill="#fcfbf8" stroke="none"/>' + bulb(196, 75, c.B, mk.glow, mk.rays);
    if (variant === 'bulbs') out += '<rect x="108" y="110" width="30" height="24" fill="#fcfbf8" stroke="none"/>' + bulb(122, 122, c.B, Math.min(mk.glow, 20), Math.min(mk.rays, 4));
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
  // 図に出している量（テスト用。線画と同じ計算）
  MD.artMarks = function (stage) {
    if (!stage || stage.kind === 'note') return '';
    var v = stage.values || MD.variantValues(stage.theme, stage.variant);
    if (stage.theme === 'py') return JSON.stringify(pyMarks(v));
    if (stage.theme === 'circuit') return JSON.stringify(circuitMarks(stage.variant, v));
    return JSON.stringify({ blocks: mcCount(stage.variant, v.size), kind: v.block });
  };
  // 「本人が試して結果が出た」の返事（§7 の型。題材で変わる名詞・動詞だけ差し込む）。key = 変えた値、from = 変える前の値
  var BLOCK_HOW = [['かたそうになった'], ['すけて見えるようになった'], ['木の感じになった']];
  MD.testReply = function (stage, key, from, mode) {
    var t = stage.theme, v = stage.values, to = v[key], p = param(t, key), va = MD.variant(t, stage.variant);
    var up = to > from, vars = { param: pick(p.label, mode) };
    if (t === 'mc' && key === 'block') { vars.effect = 'ブロックの見た目'; vars.aim = '見た目'; vars.how = BLOCK_HOW[to] ? BLOCK_HOW[to][0] : '見た目がかわった'; }
    else if (t === 'mc') { vars.effect = 'できる形'; vars.aim = '形'; vars.how = up ? 'ブロックがふえた' : 'ブロックがへった'; }
    else if (t === 'py' && key === 'speed') { vars.effect = pick(va.mover, 'js') + 'の動き'; vars.aim = '動き'; vars.how = up ? 'はやく動いた' : 'ゆっくり動いた'; }
    else if (t === 'py') { vars.effect = pick(va.thing, 'js') + 'の数'; vars.aim = '数'; vars.how = pick(va.thing, 'es') + (up ? 'がふえた' : 'がへった'); }
    else {
      var before = JSON.parse(JSON.stringify(v));
      before[key] = from;
      var b0 = circuitNums(stage.variant, before).B, b1 = circuitNums(stage.variant, v).B;
      vars.effect = '電球の明るさ'; vars.aim = '明るさ'; vars.how = b1 > b0 ? '明るくなった' : (b1 < b0 ? 'くらくなった' : '明るさがかわった');
    }
    return fmt(pick(MD.replies.test, mode), vars);
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
      ], visible: ['act-build-ph1', 'act-build-ph2'] },
      baseVis: [], stepsKind: 'build', candidate: false,
      steps: JSON.parse(JSON.stringify(MD.EXT_BUILD_STEPS)), stepIdx: 2, next: null,
      changes: [
        { id: 'act-build-c1', who: 'own', kind: 'shot', time: '10:06', what: { text: '石で塔を建てた' }, snap: null, vis: ['act-build-ph1'], photoId: 'act-build-ph1' },
        { id: 'act-build-c2', who: 'own', with: '田中さん', kind: 'shot', time: '10:14', what: { text: '塔を 2 倍にした' }, snap: null, vis: ['act-build-ph1', 'act-build-ph2'], photoId: 'act-build-ph2' }
      ],
      shelf: [],
      thread: [
        { id: 'act-build-m1', who: 'child', time: '10:14', text: '塔を 2 倍にした' },
        { id: 'act-build-m2', who: 'buddy', time: '10:14', r: 'photo', text: '塔を 2 倍にしたんだね。前の写真と並べて見る？', change: 'act-build-c2', opts: [{ a: 'mk-compare-photos', label: '比べる' }] }
      ],
      state: 'working', pauseCount: 0, declined: 0, offered: false, resumeNote: null,
      clock: 614, seq: 10, touched: 1, draft: '', v: 3
    }].concat(seedWorkActs());
  };

  // ---------- 見本の作品が結び付く活動（§W-6）。どちらも「ここで一区切り」なので作るの制作中には出ない ----------
  function cp(v) { return JSON.parse(JSON.stringify(v)); }
  function pyStage(kind, speed, count) { return { kind: kind, theme: 'py', variant: 'catch', values: { speed: speed, count: count } }; }
  function one(key, v) { var p = param('py', key); return { k: 'changed_one', v: { label: cp(p.label), value: [String(v), String(v)] } }; }
  function seedWorkActs() {
    // Python の小さなゲーム（見本から）: 本人の試す 4 回 + バディの値 1 回 + 田中さんと 1 回 → 「変わってきたところ」が見える
    var s0 = pyStage('sample', 2, 3), s1 = pyStage('sample', 3, 3), s2 = pyStage('sample', 3, 5), s3 = pyStage('sample', 4, 5), s4 = pyStage('sample', 4, 6), s5 = pyStage('sample', 3, 6);
    var py = {
      id: 'act-py', title: 'Python の小さなゲーム', origin: 'sample', theme: 'py', catalogId: 'prog-python', sampleId: 'py',
      quote: null, stage: cp(s5), base: cp(s0), baseTime: '10:20', ext: null, baseVis: null, stepsKind: 'theme', candidate: false,
      steps: MD.stepsFor('py', 'catch'), stepIdx: 2, next: null,
      changes: [
        { id: 'act-py-c1', who: 'own', kind: 'test', time: '10:22', what: one('speed', 3), res: true, snap: cp(s1), vis: null },
        { id: 'act-py-c2', who: 'own', kind: 'test', time: '10:24', what: one('count', 5), res: true, snap: cp(s2), vis: null },
        { id: 'act-py-c3', who: 'ai', kind: 'adopt', time: '10:27', what: { k: 'left_rec', v: { what: one('speed', 4) } }, cardId: 'act-py-k1', snap: cp(s3), vis: null },
        { id: 'act-py-c4', who: 'own', kind: 'test', time: '10:29', what: one('count', 6), res: true, snap: cp(s4), vis: null },
        { id: 'act-py-c5', who: 'own', with: '田中さん', kind: 'test', time: '10:31', what: one('speed', 3), res: true, snap: cp(s5), vis: null }
      ],
      shelf: [{ id: 'act-py-k1', batch: 'act-py-b1', kind: 'value', baseKind: 'sample', theme: 'py', variant: 'catch', values: { speed: 4, count: 5 }, what: one('speed', 4), time: '10:26', state: 'adopted' }],
      thread: [
        { id: 'act-py-m1', who: 'buddy', time: '10:20', r: 'open', text: MD.replies.open[0] },
        { id: 'act-py-m2', who: 'buddy', time: '10:22', r: 'test', text: MD.testReply(s1, 'speed', 2, 'js'), change: 'act-py-c1' },
        { id: 'act-py-m3', who: 'buddy', time: '10:24', r: 'test', text: MD.testReply(s2, 'count', 3, 'js'), change: 'act-py-c2' },
        { id: 'act-py-m4', who: 'child', time: '10:25', text: 'もう少し速くしてみて' },
        { id: 'act-py-m5', who: 'record', time: '10:26', text: '棚に「Python の小さなゲーム」を置いた' },
        { id: 'act-py-m6', who: 'buddy', time: '10:27', r: 'left', text: '「Python の小さなゲーム」にしたよ。' + MD.replies.left[0], change: 'act-py-c3' },
        { id: 'act-py-m7', who: 'buddy', time: '10:29', r: 'test', text: MD.testReply(s4, 'count', 5, 'js'), change: 'act-py-c4' },
        { id: 'act-py-m8', who: 'buddy', time: '10:31', r: 'test', text: MD.testReply(s5, 'speed', 4, 'js'), change: 'act-py-c5' }
      ],
      state: 'closed', pauseCount: 1, declined: 0, offered: false, resumeNote: null, lastPause: null,
      clock: 631, seq: 20, draft: '', v: 3
    };
    // 電球がつく回路（作品の「写真・スクショを入れる」から。写真 1 枚 = 変化 1 つ）
    var cap = MD.capture('cap-circuit');
    var circuit = {
      id: 'act-cap', title: pick(cap.title, 'js'), origin: 'works', theme: 'circuit', catalogId: cap.catalogId, sampleId: null,
      quote: null, stage: null, base: null, baseTime: '10:10',
      ext: { link: null, photos: [{ id: 'act-cap-ph1', theme: 'circuit', n: cap.n, kind: 'photo', time: '10:12' }], visible: ['act-cap-ph1'] },
      baseVis: [], stepsKind: 'ext', candidate: false, steps: cp(MD.theme('circuit').extSteps), stepIdx: 1, next: null,
      changes: [{ id: 'act-cap-c1', who: 'own', kind: 'photo', time: '10:12', what: { k: 'added_photo' }, snap: null, vis: ['act-cap-ph1'], photoId: 'act-cap-ph1' }],
      shelf: [],
      thread: [{ id: 'act-cap-m1', who: 'buddy', time: '10:12', text: pick(cap.read, 'js'), src: 'read' }],
      state: 'closed', pauseCount: 1, declined: 0, offered: false, resumeNote: null, lastPause: null,
      clock: 612, seq: 10, draft: '', v: 3
    };
    return [py, circuit];
  }

  // ---------- 見本の作品（§W-6）: 完成 2（変化 5 つの Python / 写真から作った回路・バディの見立て・おうちの人に見せている）+ 試作 2 ----------
  // acts に結び付く活動があるものだけ作る。残した時点の状態・絵・関わりは make.js の saveWork / addCapture と同じ形（make-test で突き合わせる）
  var SEED_WORKS = [
    { id: 'w-seed-build', actId: 'act-build', at: 'act-build-c2', title: '石の塔（2 倍）', like: null, craft: null, date: '11/2', status: 'trial' },
    { id: 'w-seed-circuit', actId: 'act-cap', at: 'act-cap-c1', capture: 'cap-circuit', title: '電球がつく回路', like: '電池を 2 個にしたら、電球がはっきりついたところ', craft: null,
      date: '11/1', status: 'done', shares: [{ id: 'w-seed-circuit-s1', to: ['family'], scope: 'work', time: '11/1 10:30' }] },
    { id: 'w-seed-py', actId: 'act-py', at: 'act-py-c5', title: '星がたくさん落ちるゲーム', like: '星が 6 つになると、どれを取りに行くか迷うところ',
      craft: '速さを 4 にしたら追いつけなかったので、3 に戻した', date: '10/30', status: 'done' },
    { id: 'w-seed-py-trial', actId: 'act-py', at: 'act-py-c2', title: '星 5 つのゲーム', like: null, craft: null, date: '10/30', status: 'trial' }
  ];
  function findIn(list, id) { for (var i = 0; i < (list || []).length; i++) if (list[i].id === id) return list[i]; return null; }
  function rolesUpTo(a, uptoId) {
    var out = { own: 0, ai: 0, people: [], lines: [] }, ppl = {};
    for (var i = 0; i < a.changes.length; i++) {
      var c = a.changes[i];
      if (c.who === 'ai') out.ai += 1; else out.own += 1;
      if (c.with) { if (!ppl[c.with]) { ppl[c.with] = { name: c.with, n: 0 }; out.people.push(ppl[c.with]); } ppl[c.with].n += 1; }
      out.lines.push({ who: c.who, with: c.with || null, what: cp(c.what) });
      if (c.id === uptoId) break;
    }
    return out;
  }
  MD.seedWorks = function (acts) {
    var out = [];
    SEED_WORKS.forEach(function (d) {
      var a = findIn(acts, d.actId), ch = a ? findIn(a.changes, d.at) : null;
      if (!ch) return;
      var st = { stage: cp(ch.snap), vis: ch.vis == null ? null : cp(ch.vis) };
      var ids = st.vis || [], photo = a.ext && ids.length ? findIn(a.ext.photos, ids[ids.length - 1]) : null;
      var cap = d.capture ? MD.capture(d.capture) : null;
      var w = { id: d.id, actId: a.id, at: ch.id, atTime: ch.time, title: d.title, like: d.like, from: cap ? 'capture' : 'make', theme: a.theme,
        art: cap ? { photo: cp(a.ext.photos[0]) } : (st.stage ? { stage: cp(st.stage) } : (photo ? { photo: cp(photo) } : null)),
        roles: rolesUpTo(a, ch.id), date: d.date, snap: st, snapTime: ch.time, status: d.status, craft: d.craft, shares: cp(d.shares || []) };
      if (cap) {
        w.images = [cap.id]; w.read = { text: pick(cap.read, 'js'), edited: false, declined: false };
        w.made = cap.made; w.madeLine = null; w.catalogId = cap.catalogId;
      }
      out.push(w);
    });
    return out;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = MD;
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
