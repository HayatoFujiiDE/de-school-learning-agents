/* 作る の中身（CONTRACT-v3 §U-1 / U-2 / U-3、design-v3 §5-1 / §6-2 / §6-9 / §6-10 / §7）。
   題材は 4 つ: マイクラのコマンド例 / Python の小さなゲーム / 回路の電気 / 自分を助ける道具（contract-Y。入口の見本と写真には出さない）。各題材に仮の案 3 つ（固定）。
   図は数値だけから組み立てる線画 SVG（墨 + オリーブ、光と星だけ橙）。利用者の入力は図に入れない。
   文言は [js, es] の組。返事の型は design-v3 §7 の表どおり（題材ごとに変わる語だけ {param} などで差し込む）。
   node からも読めるようにしてある（tools/make-test.js）。 */
(function (root) {
  'use strict';
  var DES = root.DES = root.DES || {};
  var MD = DES.makeData = {};

  var INK = '#292c29', OLIVE = '#524e44', ORANGE = '#ed922c', SAND = '#f1ece3', PAPER = '#ffffff', SOFT = '#fbecd7', MID = '#e4ded1';

  // ---------- 題材 ----------
  // §AE-1: コマ撮りの動画（stop）/ マイクラのアスレチック（ath）/ 物語（story）を足して 7 つ
  MD.THEMES = ['mc', 'py', 'circuit', 'tool', 'stop', 'ath', 'story'];
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
    },
    // 自分を助ける道具（contract-Y §Y-2 verbatim）。入口は自己理解の工夫と思いつき入力だけ（MD.samples / MD.captures には足さない）
    tool: {
      sample: 'memo', ideas: ['nudge', 'oneby', 'board'], capIdea: 'board', variants: ['memo', 'nudge', 'oneby', 'board'],
      topic: ['自分を助ける道具', '自分をたすける道具'],
      effect: ['手もとに出るもの', '手もとに出るもの'], aim: ['出かた', '出かた'],
      changeable: [['まとめる数', 'まとめる数'], ['間かく', 'あいだ']],
      params: [
        { key: 'count', label: ['まとめる数', 'まとめる数'], min: 1, max: 5, def: 3 },
        { key: 'every', label: ['間かく', 'あいだ'], min: 0, max: 4, def: 1,
          names: [['1 分', '1 分'], ['3 分', '3 分'], ['5 分', '5 分'], ['10 分', '10 分'], ['話が終わったら', '話がおわったら']], vals: [1, 3, 5, 10, 0] }
      ],
      stepBase: [['まとめる数を変える', 'まとめる数をかえる'], ['間かくを決める', 'あいだをきめる'], ['サークル対話で使ってみる', 'サークル対話でつかってみる']],
      extSteps: [['写真を入れる', '写真を入れる'], ['使った場面を書く', 'つかった場面を書く']],
      find: [{ count: 2, every: 1 }, { count: 4, every: 3 }]
    },
    // ---- §AE-1（contract-app verbatim。「小」は既存の書き方で起こした） ----
    stop: {
      sample: 'walk', ideas: ['clay', 'brick', 'draw'], capIdea: 'clay', variants: ['walk', 'clay', 'brick', 'draw'],
      topic: ['コマ撮りの動画', 'コマどりの動画'],
      effect: ['動画の動き', '動画のうごき'], aim: ['動き', 'うごき'],
      changeable: [['コマの数', 'コマの数'], ['1 秒のコマ数', '1 びょうのコマ数']],
      params: [
        { key: 'frames', label: ['コマの数', 'コマの数'], min: 0, max: 4, def: 2, vals: [6, 8, 12, 18, 24],
          names: ['6 コマ', '8 コマ', '12 コマ', '18 コマ', '24 コマ'] },
        { key: 'fps', label: ['1 秒のコマ数', '1 びょうのコマ数'], min: 0, max: 3, def: 1, vals: [4, 6, 8, 12],
          names: [['1 秒に 4 コマ', '1 びょうに 4 コマ'], ['1 秒に 6 コマ', '1 びょうに 6 コマ'], ['1 秒に 8 コマ', '1 びょうに 8 コマ'], ['1 秒に 12 コマ', '1 びょうに 12 コマ']] }
      ],
      stepBase: [['コマの数を変える', 'コマの数をかえる'], ['1 秒のコマ数を変える', '1 びょうのコマ数をかえる'], ['撮る物を決める', 'とる物をきめる']],
      extSteps: [['写真を入れる', '写真を入れる'], ['コマを足す', 'コマをたす']],
      find: [{ frames: 3, fps: 1 }, { frames: 1, fps: 2 }]
    },
    ath: {
      sample: 'jump', ideas: ['slime', 'piston', 'ice'], capIdea: 'slime', variants: ['jump', 'slime', 'piston', 'ice'],
      topic: ['マイクラのアスレチック', 'マイクラのアスレチック'],
      effect: ['コースの手ごたえ', 'コースの手ごたえ'], aim: ['手ごたえ', '手ごたえ'],
      changeable: [['足場のあいだ', '足場のあいだ'], ['足場の数', '足場の数']],
      params: [
        { key: 'gap', label: ['足場のあいだ', '足場のあいだ'], min: 1, max: 4, def: 2 },
        { key: 'count', label: ['足場の数', '足場の数'], min: 3, max: 8, def: 5 }
      ],
      stepBase: [['足場のあいだを変える', '足場のあいだをかえる'], ['足場の数を変える', '足場の数をかえる'], ['ゴールを置く', 'ゴールをおく']],
      extSteps: [['写真を入れる', '写真を入れる'], ['ギミックを足す', 'ギミックをたす']],
      find: [{ gap: 3, count: 6 }, { gap: 1, count: 8 }]
    },
    story: {
      sample: 'short', ideas: ['mystery', 'future', 'letter'], capIdea: 'mystery', variants: ['short', 'mystery', 'future', 'letter'],
      topic: ['物語', 'ものがたり'],
      effect: ['話の流れ', '話のながれ'], aim: ['流れ', 'ながれ'],
      changeable: [['場面の数', '場めんの数'], ['語り手', 'かたり手']],
      params: [
        { key: 'scenes', label: ['場面の数', '場めんの数'], min: 3, max: 7, def: 4 },
        { key: 'voice', label: ['語り手', 'かたり手'], min: 0, max: 2, def: 0,
          names: [['「わたし」が語る', '「わたし」がかたる'], ['外から語る', '外からかたる'], ['手紙で語る', '手紙でかたる']] }
      ],
      stepBase: [['場面の数を変える', '場めんの数をかえる'], ['語り手を選ぶ', 'かたり手をえらぶ'], ['最初の 1 文を書く', 'さいしょの 1 文を書く']],
      extSteps: [['写真を入れる', '写真を入れる'], ['次の場面を書く', 'つぎの場めんを書く']],
      find: [{ scenes: 5, voice: 1 }, { scenes: 3, voice: 2 }]
    }
  };
  MD.theme = function (id) { return THEME[id] || THEME.mc; };
  MD.CANDIDATE_STEP = ['案を選ぶ', '案をえらぶ'];
  MD.STEP_MIN = 5;
  MD.EXT_BUILD_STEPS = [['塔を建てる', 'とうをたてる'], ['塔を 2 倍にする', 'とうを 2 倍にする'], ['屋根を置く', 'やねをおく']];

  // 見本 6 枚（§AE-3 の順。入口には 3 枚ずつ出す。tool は入れない）
  MD.samples = [
    { id: 'stop', theme: 'stop', variant: 'walk' },
    { id: 'ath', theme: 'ath', variant: 'jump' },
    { id: 'story', theme: 'story', variant: 'short' },
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
    'circuit.switch': { title: ['スイッチ付きの回路', 'スイッチつきの回路'], values: { volt: 1, ohm: 2 }, step3: ['電球を 2 個にする', '電球を 2 こにする'] },
    'tool.memo':  { title: ['論点メモ', 'ろんてんメモ'], values: { count: 3, every: 2 } },
    'tool.nudge': { title: ['ひとこと合図', 'ひとことの合図'], values: { count: 1, every: 1 }, step3: ['合図の言葉を決める', 'あいずのことばをきめる'] },
    'tool.oneby': { title: ['ひとつずつリスト', 'ひとつずつリスト'], values: { count: 1, every: 4 }, step3: ['次を出す合図を決める', 'つぎを出すあいずをきめる'] },
    'tool.board': { title: ['話の地図', '話のちず'], values: { count: 4, every: 2 }, step3: ['真ん中に書くことを決める', 'まん中に書くことをきめる'] },
    // §AE-1。subj = 結果の主語（stop）/ gim = ギミックの足場・block = ブロック id（ath）
    'stop.walk': { title: ['コマ撮りの短い動画', 'コマどりのみじかい動画'], values: { frames: 2, fps: 1 }, subj: ['人形が歩く動画', '人形があるく動画'] },
    'stop.clay': { title: ['粘土が形を変える動画', 'ねん土が形をかえる動画'], values: { frames: 2, fps: 1 }, step3: ['粘土の色を決める', 'ねん土の色をきめる'], subj: ['粘土が形を変える動画', 'ねん土が形をかえる動画'] },
    'stop.brick': { title: ['ブロックの車が走る動画', 'ブロックの車が走る動画'], values: { frames: 3, fps: 2 }, step3: ['道を作る', '道をつくる'], subj: ['ブロックの車が走る動画', 'ブロックの車が走る動画'] },
    'stop.draw': { title: ['絵が動き出す動画', '絵がうごき出す動画'], values: { frames: 1, fps: 1 }, step3: ['最初の絵を描く', 'さいしょの絵をかく'], subj: ['絵が動き出す動画', '絵がうごき出す動画'] },
    'ath.jump': { title: ['マイクラのアスレチック', 'マイクラのアスレチック'], values: { gap: 2, count: 5 }, gim: null, block: 'stone' },
    'ath.slime': { title: ['スライムで跳ねるコース', 'スライムではねるコース'], values: { gap: 3, count: 5 }, step3: ['跳ねる高さを試す', 'はねる高さをためす'], gim: ['跳ねる足場', 'はねる足場'], block: 'slime_block' },
    'ath.piston': { title: ['ピストンで動く足場のコース', 'ピストンでうごく足場のコース'], values: { gap: 2, count: 6 }, step3: ['動くタイミングを決める', 'うごくタイミングをきめる'], gim: ['動く足場', 'うごく足場'], block: 'piston' },
    'ath.ice': { title: ['氷ですべるコース', 'こおりですべるコース'], values: { gap: 2, count: 4 }, step3: ['止まる場所を作る', 'とまる場所をつくる'], gim: ['すべる足場', 'すべる足場'], block: 'packed_ice' },
    'story.short': { title: ['短い物語', 'みじかいものがたり'], values: { scenes: 4, voice: 0 } },
    'story.mystery': { title: ['なぞ解きの物語', 'なぞときのものがたり'], values: { scenes: 5, voice: 1 }, step3: ['なぞの答えを先に決める', 'なぞの答えを先にきめる'] },
    'story.future': { title: ['100 年後の町の物語', '100 年後の町のものがたり'], values: { scenes: 4, voice: 1 }, step3: ['今とちがう所を 1 つ決める', '今とちがう所を 1 つきめる'] },
    'story.letter': { title: ['手紙でつづる物語', '手紙でつづるものがたり'], values: { scenes: 3, voice: 2 }, step3: ['だれからだれへの手紙か決める', 'だれからだれへの手紙かきめる'] }
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
    },
    tool: {
      calc: { title: ['使う時間', 'つかう時間'], lines: [['サークル対話は 20 分', 'サークル対話は 20 分'], ['5 分ごとなら、まとめは 4 回', '5 分ごとなら、まとめは 4 回'], ['論点 3 つ × 4 回 = カード 12 枚', 'カード 3 まい × 4 回 = 12 まい']],
        alt: { title: ['使う時間（10 分ごと）', 'つかう時間（10 分ごと）'], lines: [['サークル対話は 20 分', 'サークル対話は 20 分'], ['10 分ごとなら、まとめは 2 回', '10 分ごとなら、まとめは 2 回'], ['論点 3 つ × 2 回 = カード 6 枚', 'カード 3 まい × 2 回 = 6 まい']] } },
      steps: { title: ['論点メモの使い方', 'ろんてんメモのつかいかた'], lines: [['1. 聞いたことを 1 行ずつメモに入れる', '1. 聞いたことを 1 行ずつメモに入れる'], ['2. 5 分たったら AI が論点に分ける', '2. 5 分たったら AI がカードに分ける'], ['3. 気になるカードに印を付ける', '3. 気になるカードにしるしをつける']],
        alt: { title: ['論点メモの使い方（話の地図）', 'ろんてんメモのつかいかた（話のちず）'], lines: [['1. 聞いたことを 1 行ずつメモに入れる', '1. 聞いたことを 1 行ずつメモに入れる'], ['2. AI が真ん中の問いから枝を伸ばす', '2. AI がまん中の問いから枝をのばす'], ['3. 自分の考えを枝に足す', '3. 自分の考えを枝にたす']] } },
      cmd: { variant: 'board', values: { count: 4, every: 2 } }
    },
    // ---- §AE-1 ----
    stop: {
      calc: { title: ['コマの計算', 'コマの計算'], lines: [['12 コマ ÷ 1 秒に 6 コマ = 2 秒', '12 コマ ÷ 1 びょうに 6 コマ = 2 びょう'], ['10 秒にするには 60 コマ', '10 びょうにするには 60 コマ'], ['1 コマで 5 mm 動かすと、60 コマで 30 cm', '1 コマで 5 mm うごかすと、60 コマで 30 cm']],
        alt: { title: ['コマの計算（1 秒に 12 コマ）', 'コマの計算（1 びょうに 12 コマ）'], lines: [['12 コマ ÷ 1 秒に 12 コマ = 1 秒', '12 コマ ÷ 1 びょうに 12 コマ = 1 びょう'], ['10 秒にするには 120 コマ', '10 びょうにするには 120 コマ'], ['1 コマで 2.5 mm 動かすと、120 コマで 30 cm', '1 コマで 2.5 mm うごかすと、120 コマで 30 cm']] } },
      steps: { title: ['撮り方の手順', 'とりかたの手じゅん'], lines: [['1. カメラを動かないように固定する', '1. カメラをうごかないようにおく'], ['2. 少し動かして 1 枚撮る', '2. 少しうごかして 1 まいとる'], ['3. 12 回くり返して、つなげて見る', '3. 12 回くりかえして、つなげて見る']],
        alt: { title: ['撮り方の手順（形を変える）', 'とりかたの手じゅん（形をかえる）'], lines: [['1. カメラを動かないように固定する', '1. カメラをうごかないようにおく'], ['2. 粘土を少しつまんで 1 枚撮る', '2. ねん土を少しつまんで 1 まいとる'], ['3. 12 回くり返して、つなげて見る', '3. 12 回くりかえして、つなげて見る']] } },
      cmd: { variant: 'clay', values: { frames: 2, fps: 2 } }
    },
    ath: {
      calc: { title: ['コースの長さ', 'コースの長さ'], lines: [['足場 5 個 · あいだ 2 ブロック', '足場 5 こ · あいだ 2 ブロック'], ['5 + 2 × 4 = 13 ブロックの長さ', '5 + 2 × 4 = 13 ブロックの長さ'], ['足場を 8 個にすると 22 ブロック', '足場を 8 こにすると 22 ブロック']],
        alt: { title: ['コースの長さ（あいだ 3）', 'コースの長さ（あいだ 3）'], lines: [['足場 5 個 · あいだ 3 ブロック', '足場 5 こ · あいだ 3 ブロック'], ['5 + 3 × 4 = 17 ブロックの長さ', '5 + 3 × 4 = 17 ブロックの長さ'], ['足場を 8 個にすると 29 ブロック', '足場を 8 こにすると 29 ブロック']] } },
      steps: { title: ['コースの手順', 'コースの手じゅん'], lines: [['1. スタートの足場を置く', '1. スタートの足場をおく'], ['2. あいだをあけて、次の足場を置く', '2. あいだをあけて、つぎの足場をおく'], ['3. 最後にゴールの目印を置く', '3. さいごにゴールの目じるしをおく']],
        alt: { title: ['コースの手順（ギミック）', 'コースの手じゅん（ギミック）'], lines: [['1. スタートの足場を置く', '1. スタートの足場をおく'], ['2. 2 個目ごとにスライムブロックを置く', '2. 2 こ目ごとにスライムブロックをおく'], ['3. だれかに遊んでもらって、手ごたえを聞く', '3. だれかにあそんでもらって、手ごたえを聞く']] } },
      cmd: { variant: 'slime', values: { gap: 3, count: 5 } }
    },
    story: {
      calc: { title: ['場面の割りふり', '場めんのわりふり'], lines: [['4 場面: はじまり 1 · できごと 2 · おわり 1', '4 場めん: はじまり 1 · できごと 2 · おわり 1'], ['1 場面 200 字なら、全部で 800 字', '1 場めん 200 字なら、ぜんぶで 800 字'], ['山場は 3 場面目', '山場は 3 場めん目']],
        alt: { title: ['場面の割りふり（6 場面）', '場めんのわりふり（6 場めん）'], lines: [['6 場面: はじまり 1 · できごと 4 · おわり 1', '6 場めん: はじまり 1 · できごと 4 · おわり 1'], ['1 場面 200 字なら、全部で 1200 字', '1 場めん 200 字なら、ぜんぶで 1200 字'], ['山場は 5 場面目', '山場は 5 場めん目']] } },
      steps: { title: ['書き進める手順', '書きすすめる手じゅん'], lines: [['1. 主人公がほしいものを 1 つ決める', '1. しゅじんこうがほしいものを 1 つきめる'], ['2. じゃまをするできごとを 1 つ置く', '2. じゃまをするできごとを 1 つおく'], ['3. 最初の 1 文を書く', '3. さいしょの 1 文を書く']],
        alt: { title: ['書き進める手順（なぞ解き）', '書きすすめる手じゅん（なぞとき）'], lines: [['1. なぞの答えを先に決める', '1. なぞの答えを先にきめる'], ['2. 手がかりを 3 つ置く', '2. 手がかりを 3 つおく'], ['3. 最初の 1 文を書く', '3. さいしょの 1 文を書く']] } },
      cmd: { variant: 'mystery', values: { scenes: 5, voice: 1 } }
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
  // 自分を助ける道具（contract-Y §Y-2）: 間かくの分数（vals。0 = 話が終わったら）
  function toolMin(every) { var p = param('tool', 'every'), m = p.vals[every]; return m == null ? p.vals[p.def] : m; }
  MD.toolMin = toolMin;
  // 「{n} 分ごと」/「話の終わり」（コード・説明。モード共通）
  function toolEs(every) { var m = toolMin(every); return m === 0 ? '話の終わり' : m + ' 分ごと'; }
  var TOOL_RESULT = {
    memo: ['{E}、話を {count} つの論点カードにまとめる', '{E}、話を {count} つのカードにまとめる'],
    nudge: ['{E}、「いまの話を {count} 行で」と手もとに出す', '{E}、「いまの話を {count} 行で」と手もとに出す'],
    oneby: ['決めることを {count} つずつ出して、{E}次を出す', 'きめることを {count} つずつ出して、{E}つぎを出す'],
    board: ['{E}、話を {count} 本の枝の図に書き足す', '{E}、話を {count} 本のえだの図に書きたす']
  };
  var TOOL_CODE = { memo: 'メモ → AI → 論点 × {count}（{Es}）', nudge: '時計 → 合図「いまの話を {count} 行で」（{Es}）', oneby: 'リスト → {count} 件ずつ表示（{Es}）', board: 'メモ → AI → 枝 × {count}（{Es}）' };
  var TOOL_DESC = { memo: '論点 {count}', nudge: '{count} 行', oneby: '{count} 件ずつ', board: '枝 {count}' };
  function toolVariant(va) { return TOOL_RESULT[va] ? va : THEME.tool.sample; }
  // ---- §AE-1 の計算（知らない案は題材の最初の案として読む。別の題材には落とさない） ----
  function adVariant(theme, va) { return VARIANT[theme + '.' + va] ? va : THEME[theme].sample; }
  // 値が欠けている・整数でない・範囲の外の時は、その題材の既定値（params の def）で読む（NaN・undefined・{F} を出さない。レビューへの裁定）
  var AD_THEMES = { stop: true, ath: true, story: true };
  function adVals(theme, v) {
    var src = v && typeof v === 'object' ? v : {}, out = {};
    THEME[theme].params.forEach(function (p) {
      var x = src[p.key];
      out[p.key] = typeof x === 'number' && isFinite(x) && x % 1 === 0 && x >= p.min && x <= p.max ? x : p.def;
    });
    return out;
  }
  MD.adVals = adVals;
  // コマ撮り: F = コマの数 / P = 1 秒のコマ数 / S = 秒（小数 1 けた）
  function stopNums(v) { v = adVals('stop', v); var F = num('stop', 'frames', v.frames), P = num('stop', 'fps', v.fps); return { F: F, P: P, S: Math.round(F / P * 10) / 10 }; }
  MD.stopNums = stopNums;
  // アスレチック: n = 足場の数 / g = あいだ / k = ギミックの足場（2 個目・4 個目…。jump は 0）/ L = コースの長さ
  function athNums(va, v) { v = adVals('ath', v); var n = v.count, g = v.gap, gim = !!VARIANT['ath.' + adVariant('ath', va)].gim; return { n: n, g: g, k: gim ? Math.floor(n / 2) : 0, L: n + g * (n - 1) }; }
  MD.athNums = athNums;
  // 手ごたえ（このモックでの目安。ゲームの事実としては書かない）
  var ATH_FEEL = [['かんたん', 'かんたん'], ['ふつう', 'ふつう'], ['むずかしい', 'むずかしい'], ['とてもむずかしい', 'とてもむずかしい']];
  function athFeel(g, mode) { return pick(ATH_FEEL[Math.max(1, Math.min(4, g)) - 1], mode); }
  // 物語: n = 場面の数 / k = 山場（最後の 1 つ前の場面）
  function storyNums(v) { v = adVals('story', v); return { n: v.scenes, k: v.scenes - 1 }; }
  MD.storyNums = storyNums;

  // 結果 1 行（「試す」で確かめたこと）
  MD.result = function (stage, mode) {
    if (!stage || stage.kind === 'note') return '';
    var v = stage.values || {}, t = stage.theme, va = stage.variant;
    if (AD_THEMES[t]) v = adVals(t, v);
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
    if (t === 'tool') {
      // E = 「{n} 分ごとに」/ 話が終わったら（params の names）。oneby は「…、{E}次を出す」（読点を重ねない）
      var m = toolMin(v.every), E = m === 0 ? MD.valueLabel('tool', 'every', v.every, mode) : m + ' 分ごとに';
      return fmt(pick(TOOL_RESULT[toolVariant(va)], mode), { E: E, count: v.count });
    }
    // §AE-1
    if (t === 'stop') {
      var sn = stopNums(v);
      return fmt(pick(['{subj} · {F} コマ ÷ 1 秒に {P} コマ = {S} 秒', '{subj} · {F} コマ ÷ 1 びょうに {P} コマ = {S} びょう'], mode),
        { subj: pick(VARIANT['stop.' + adVariant('stop', va)].subj, mode), F: sn.F, P: sn.P, S: sn.S });
    }
    if (t === 'ath') {
      var an = athNums(va, v), gim = VARIANT['ath.' + adVariant('ath', va)].gim;
      if (!gim) return fmt(pick(['足場 {n} 個 · あいだ {g} ブロック · {feel}', '足場 {n} こ · あいだ {g} ブロック · {feel}'], mode), { n: an.n, g: an.g, feel: athFeel(an.g, mode) });
      return fmt(pick(['足場 {n} 個（{gim} {k} 個）· あいだ {g} ブロック · {feel}', '足場 {n} こ（{gim} {k} こ）· あいだ {g} ブロック · {feel}'], mode),
        { n: an.n, gim: pick(gim, mode), k: an.k, g: an.g, feel: athFeel(an.g, mode) });
    }
    if (t === 'story') {
      var stn = storyNums(v);
      return fmt(pick(['{n} 場面の物語 · {name} · 山場は {k} 場面目', '{n} 場めんのものがたり · {name} · 山場は {k} 場めん目'], mode),
        { n: stn.n, k: stn.k, name: MD.valueLabel('story', 'voice', v.voice, mode) });
    }
    var c = circuitNums(va, v);
    return fmt(pick(['電流 {I} mA · 明るさ {B}%', 'でんりゅう {I} mA · 明るさ {B}%'], mode), c);
  };
  // コマンド・コードの短い表示（作業対象の中身。言葉は入れない）
  MD.code = function (stage) {
    if (!stage || stage.kind === 'note') return '';
    var v = stage.values || {}, t = stage.theme, va = stage.variant;
    if (AD_THEMES[t]) v = adVals(t, v);
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
    if (t === 'tool') return fmt(TOOL_CODE[toolVariant(va)], { count: v.count, Es: toolEs(v.every) });
    // §AE-1
    if (t === 'stop') { var sn = stopNums(v); return sn.F + ' コマ ÷ ' + sn.P + ' コマ/秒 = ' + sn.S + ' 秒'; }
    if (t === 'ath') {
      var an = athNums(va, v), vd = VARIANT['ath.' + adVariant('ath', va)], lines = [];
      for (var ai = 0; ai < Math.min(an.n, 3); ai++) lines.push('/setblock ~' + (ai * (an.g + 1)) + ' ~ ~ minecraft:' + (vd.gim && ai % 2 === 1 ? vd.block : 'stone'));
      if (an.n > 3) lines.push('…');
      return lines.join('\n');
    }
    if (t === 'story') return 'はじまり → できごと × ' + (v.scenes - 2) + ' → おわり（' + MD.valueLabel('story', 'voice', v.voice, 'js') + '）';
    var c = circuitNums(va, v);
    return c.V + ' V ÷ ' + c.R + ' Ω = ' + c.I + ' mA';
  };
  // 案のカードの 1 行説明（「くさび形。高さ 20」の型。形と数だけを書く）
  MD.desc = function (stage, mode) {
    if (!stage) return '';
    if (stage.kind === 'note') return pick(stage.lines && stage.lines[0], mode) || '';
    var v = stage.values || {}, t = stage.theme, va = stage.variant;
    if (AD_THEMES[t]) v = adVals(t, v);
    if (t === 'mc') {
      var blk = MD.valueLabel('mc', 'block', v.block, mode);
      if (va === 'tower') return fmt(pick(['{blk}。高さ {h}', '{blk}。高さ {h}'], mode), { blk: blk, h: 2 * v.size });
      if (va === 'bridge') return fmt(pick(['{blk}。長さ {l}', '{blk}。長さ {l}'], mode), { blk: blk, l: 2 * v.size });
      if (va === 'roof') return fmt(pick(['{blk}。{s} 段', '{blk}。{s} だん'], mode), { blk: blk, s: v.size });
      return fmt(pick(['{blk}。{s}×{s}×{s}', '{blk}。{s}×{s}×{s}'], mode), { blk: blk, s: v.size });
    }
    if (t === 'py') return fmt(pick(['速さ {sp}・数 {c}', 'はやさ {sp}・数 {c}'], mode), { sp: v.speed, c: v.count });
    if (t === 'tool') return fmt(TOOL_DESC[toolVariant(va)], { count: v.count }) + ' · ' + toolEs(v.every);
    // §AE-1
    if (t === 'stop') { var sn = stopNums(v); return fmt(pick(['{F} コマ · 1 秒に {P} コマ', '{F} コマ · 1 びょうに {P} コマ'], mode), sn); }
    if (t === 'ath') return fmt('足場 {n} · あいだ {g}', { n: v.count, g: v.gap });
    if (t === 'story') return fmt(pick(['{n} 場面 · {name}', '{n} 場めん · {name}'], mode), { n: v.scenes, name: MD.valueLabel('story', 'voice', v.voice, mode) });
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
  // 自分を助ける道具（contract-Y §Y-2）: まとめる数 = カード・行・枝の数、間かく = 右上の時計の弧と文字（{n}分 / おわり）。顔・人物は描かない
  function toolMarks(v) { return { items: Math.max(1, v.count || 1), every: toolMin(v.every) }; }
  function toolClock(m) {
    var cx = 212, cy = 24, r = 10, out = '';
    out += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + PAPER + '" stroke="' + INK + '" stroke-width="1.2"/>';
    if (m > 0) {
      // 間かくの分だけ橙の弧（1 分 = 6 度。10 分 = 60 度）
      var a = (-90 + m * 6) * Math.PI / 180, ex = cx + Math.cos(a) * (r - 2.5), ey = cy + Math.sin(a) * (r - 2.5);
      out += '<path d="M' + cx + ' ' + cy + ' L' + cx + ' ' + (cy - r + 2.5) + ' A' + (r - 2.5) + ' ' + (r - 2.5) + ' 0 0 1 ' + r1(ex) + ' ' + r1(ey) + ' Z" fill="' + ORANGE + '" stroke="none"/>';
      out += line(cx, cy, r1(ex), r1(ey), INK, 1.2);
    } else {
      // 話が終わったら: 針を止めた印（短い横線 2 本）
      out += line(cx - 4, cy - 2, cx + 4, cy - 2, INK, 1.4) + line(cx - 4, cy + 2, cx + 4, cy + 2, INK, 1.4);
    }
    out += line(cx, cy, cx, cy - r + 3, INK, 1.2);
    out += '<text x="' + (cx - r - 5) + '" y="' + (cy + 4) + '" font-size="10" text-anchor="end" fill="' + OLIVE + '">' + (m > 0 ? m + '分' : 'おわり') + '</text>';
    return out;
  }
  function textLines(x, y, w, h, n, col) {
    var out = '', gap = h / (n + 1);
    for (var i = 0; i < n; i++) { var yy = y + gap * (i + 1), ww = w * (i % 2 ? 0.7 : 0.9); out += line(x, yy, x + ww, yy, col || OLIVE, 1.6); }
    return out;
  }
  function toolArt(variant, v) {
    var mk = toolMarks(v), n = mk.items, out = '', i;
    if (variant === 'nudge') {
      out += rect(34, 40, 150, 84, PAPER, ' rx="14"') + poly([[60, 123], [52, 140], [80, 123]], PAPER) + line(61, 123, 79, 123, PAPER, 2);
      out += textLines(52, 46, 114, 72, n, INK);
    } else if (variant === 'oneby') {
      for (i = 3; i >= 1; i--) out += rect(50 + i * 7, 52 - i * 6, 128, 78, i === 1 ? SAND : MID, ' rx="6"');
      out += rect(50, 52, 128, 78, PAPER, ' rx="6"') + rect(50, 52, 6, 78, ORANGE, ' rx="2"');
      out += textLines(66, 54, 100, 74, n, INK);
    } else if (variant === 'board') {
      var cx = 108, cy = 90;
      for (i = 0; i < n; i++) {
        var a = (-90 + (360 / n) * i + (n % 2 ? 0 : 180 / n)) * Math.PI / 180, ex = cx + Math.cos(a) * 52, ey = cy + Math.sin(a) * 44;
        out += line(cx, cy, ex, ey, OLIVE, 1.4) + rect(ex - 9, ey - 6, 18, 12, PAPER, ' rx="2"');
      }
      out += '<circle cx="' + cx + '" cy="' + cy + '" r="15" fill="' + SOFT + '" stroke="' + INK + '" stroke-width="1.4"/>' + line(cx - 7, cy, cx + 7, cy, INK, 1.4);
    } else {
      // memo: 左に罫線のメモ → 右に論点カード（縦に count 枚）
      out += rect(18, 34, 70, 100, PAPER, ' rx="4"') + poly([[74, 34], [88, 48], [74, 48]], SAND);
      for (i = 0; i < 6; i++) out += line(26, 56 + i * 12, 80, 56 + i * 12, OLIVE, 0.9);
      out += line(96, 84, 120, 84, INK, 1.6) + poly([[120, 79], [128, 84], [120, 89]], INK);
      var top = 44, avail = 96, ch = Math.min(18, (avail - (n - 1) * 6) / n);
      for (i = 0; i < n; i++) {
        var y = top + i * (ch + 6) + (avail - (n * ch + (n - 1) * 6)) / 2;
        out += rect(138, y, 82, ch, i === 0 ? SOFT : PAPER, ' rx="3"') + line(146, y + ch / 2, 146 + (i % 2 ? 40 : 56), y + ch / 2, OLIVE, 1.2);
      }
    }
    out += toolClock(mk.every);
    return wrap(out);
  }
  // ---- §AE-1 の線画（墨 + オリーブ、強調だけ橙。文字は入れない） ----
  // コマ撮り: 上にコマの枠が F 個（1 行に入らなければ 2〜3 行。主役の位置や形がコマごとに少しずつ変わる）、下に時間の線（長さ ∝ S・1 秒ごとの目盛り）
  var STOP_SEC_PX = 33;
  function stopMarks(v) { var sn = stopNums(v); return { frames: sn.F, secs: sn.S }; }
  function stopSubject(va, x, y, w, h, t, i) {
    var cx, cy = y + h * 0.55;
    if (va === 'clay') {
      // 粘土: 丸 → 横長へ少しずつ形が変わる
      return '<ellipse cx="' + r1(x + w / 2) + '" cy="' + r1(y + h * 0.62) + '" rx="' + r1(w * (0.16 + 0.16 * t)) + '" ry="' + r1(h * (0.3 - 0.13 * t)) + '" fill="' + SAND + '" stroke="' + INK + '" stroke-width="0.9"/>';
    }
    if (va === 'brick') {
      // ブロックの車: 左から右へ進む
      cx = x + w * (0.22 + 0.5 * t);
      var bw = w * 0.32, bh = h * 0.22;
      return rect(cx - bw / 2, cy - bh / 2, bw, bh, MID) + rect(cx - bw * 0.25, cy - bh * 1.2, bw * 0.5, bh * 0.7, SAND) +
        '<circle cx="' + r1(cx - bw * 0.28) + '" cy="' + r1(cy + bh * 0.6) + '" r="' + r1(Math.max(1, h * 0.07)) + '" fill="' + INK + '"/>' +
        '<circle cx="' + r1(cx + bw * 0.28) + '" cy="' + r1(cy + bh * 0.6) + '" r="' + r1(Math.max(1, h * 0.07)) + '" fill="' + INK + '"/>';
    }
    if (va === 'draw') {
      // 絵が動き出す: 描いた線が少しずつ伸びる
      var x1 = x + w * 0.18, y1 = y + h * 0.75, len = w * (0.12 + 0.58 * t);
      return '<path d="M' + r1(x1) + ' ' + r1(y1) + ' q' + r1(len / 2) + ' ' + r1(-h * 0.5) + ' ' + r1(len) + ' 0" stroke="' + OLIVE + '" stroke-width="1.2" fill="none" stroke-linecap="round"/>' +
        '<circle cx="' + r1(x1 + len) + '" cy="' + r1(y1) + '" r="' + r1(Math.max(1, h * 0.06)) + '" fill="' + INK + '"/>';
    }
    // walk: 人形（顔は描かない）が左から右へ。足を交互に出す
    cx = x + w * (0.25 + 0.5 * t);
    var hr = Math.max(1.2, h * 0.1), top = y + h * 0.2, hip = y + h * 0.62, foot = y + h * 0.88, step = w * (i % 2 ? 0.08 : 0.14);
    return '<circle cx="' + r1(cx) + '" cy="' + r1(top + hr) + '" r="' + r1(hr) + '" fill="' + PAPER + '" stroke="' + INK + '" stroke-width="0.9"/>' +
      line(cx, top + hr * 2, cx, hip, INK, 1) + line(cx, hip, cx - step, foot, INK, 1) + line(cx, hip, cx + step, foot, INK, 1);
  }
  function stopArt(va, v) {
    var mk = stopMarks(v), F = mk.frames, S = mk.secs, out = '', i;
    var rows = F <= 8 ? 1 : (F <= 16 ? 2 : 3), per = Math.ceil(F / rows), gap = 4;
    var fw = Math.min(30, (216 - (per - 1) * gap) / per), fh = fw * 0.75;
    var totalW = per * fw + (per - 1) * gap, totalH = rows * fh + (rows - 1) * gap;
    var x0 = (240 - totalW) / 2, y0 = 10 + (88 - totalH) / 2;
    for (i = 0; i < F; i++) {
      var row = Math.floor(i / per), col = i % per, x = x0 + col * (fw + gap), y = y0 + row * (fh + gap);
      out += rect(x, y, fw, fh, PAPER, ' rx="2"') + stopSubject(va, x, y, fw, fh, F > 1 ? i / (F - 1) : 0, i);
    }
    // 時間の線（1 秒 = 33px）。始まりに再生の三角、終わりに橙の丸
    var tx = 22, ty = 124, len = S * STOP_SEC_PX;
    out += poly([[tx - 10, ty - 5], [tx - 3, ty], [tx - 10, ty + 5]], OLIVE);
    out += line(tx, ty, tx + len, ty, INK, 1.6);
    for (i = 0; i <= Math.floor(S); i++) out += line(tx + i * STOP_SEC_PX, ty - 5, tx + i * STOP_SEC_PX, ty + 5, OLIVE, 1.2);
    out += '<circle cx="' + r1(tx + len) + '" cy="' + ty + '" r="3.2" fill="' + ORANGE + '" stroke="' + INK + '" stroke-width="1"/>';
    return wrap(out);
  }
  // アスレチック: 横から見たコース。左にスタート・右にゴールの旗。足場 n 個が g に比例した間隔。ギミックの足場は橙で形を変える
  function athMarks(va, v) { var an = athNums(va, v); return { count: an.n, gap: an.g, gimmick: an.k }; }
  function flag(x, yb, fill) { return line(x, yb, x, yb - 34, INK, 1.4) + poly([[x, yb - 34], [x + 14, yb - 29], [x, yb - 24]], fill); }
  function athArt(va, v) {
    var an = athNums(va, v), vk = adVariant('ath', va), gim = !!VARIANT['ath.' + vk].gim, out = '', i;
    var u = Math.min(14, 172 / an.L), total = an.L * u, x0 = 120 - total / 2, base = 104, ph = Math.max(5, Math.min(9, u * 0.7));
    out += '<path d="M10 138 q8 -4 16 0 t16 0 t16 0 t16 0 t16 0 t16 0 t16 0 t16 0 t16 0 t16 0 t16 0 t16 0 t16 0 t16 0" stroke="' + OLIVE + '" stroke-width="1" fill="none"/>';
    out += flag(16, base + 30, SAND) + line(10, base + 30, 30, base + 30, INK, 1.2);
    out += flag(218, base + 30, SAND) + line(212, base + 30, 232, base + 30, INK, 1.2) + line(218, base - 4, 232, base - 4, OLIVE, 0.8);
    var prev = null;
    for (i = 0; i < an.n; i++) {
      var x = x0 + i * (an.g + 1) * u, y = base - (i % 3) * 9, isG = gim && i % 2 === 1;
      // とぶ線（前の足場から）
      if (prev) out += '<path d="M' + r1(prev[0]) + ' ' + r1(prev[1]) + ' Q' + r1((prev[0] + x) / 2) + ' ' + r1(Math.min(prev[1], y) - 10 - an.g * 3) + ' ' + r1(x + u / 2) + ' ' + r1(y) + '" stroke="' + OLIVE + '" stroke-width="0.9" stroke-dasharray="2 2" fill="none"/>';
      out += rect(x, y, u, ph, isG ? ORANGE : MID);
      if (isG) {
        var cx = x + u / 2, ty = y - 4;
        if (vk === 'slime') out += line(cx, ty, cx, ty - 9, INK, 1.2) + poly([[cx - 3, ty - 7], [cx, ty - 11], [cx + 3, ty - 7]], INK);
        else if (vk === 'piston') out += line(cx - 6, ty - 4, cx + 6, ty - 4, INK, 1.2) + poly([[cx - 6, ty - 6.5], [cx - 9, ty - 4], [cx - 6, ty - 1.5]], INK) + poly([[cx + 6, ty - 6.5], [cx + 9, ty - 4], [cx + 6, ty - 1.5]], INK);
        else out += line(x + 1, y + ph - 1, x + u - 1, y + 1, INK, 1) + line(x + 1 + u * 0.4, y + ph - 1, x + u - 1, y + 1 + ph * 0.4, INK, 0.8);
      }
      prev = [x + u / 2, y];
    }
    return wrap(out);
  }
  // 物語: 場面のカード n 枚が山なりの線の上に左から右へ。山場のカードだけ橙。左上に語り手の印（吹き出し / 目 / 封筒）
  function storyMarks(v) { var sn = storyNums(v); return { scenes: sn.n, voice: v.voice, peak: sn.k }; }
  function voiceMark(voice) {
    if (voice === 1) {
      return '<path d="M14 22 Q30 8 46 22 Q30 36 14 22 Z" fill="' + PAPER + '" stroke="' + INK + '" stroke-width="1.2"/><circle cx="30" cy="22" r="4.5" fill="' + OLIVE + '"/>';
    }
    if (voice === 2) return rect(14, 12, 32, 21, PAPER, ' rx="2"') + '<path d="M14.5 12.5 L30 24 L45.5 12.5" stroke="' + INK + '" stroke-width="1.1" fill="none"/>';
    return rect(14, 10, 32, 20, PAPER, ' rx="7"') + poly([[21, 29], [18, 37], [28, 29]], PAPER) + line(21.5, 29, 27.5, 29, PAPER, 1.6);
  }
  function storyArt(va, v) {
    var sn = storyNums(v), n = sn.n, p = n - 2, out = voiceMark(v.voice), i;
    var cw = Math.min(26, (196 - (n - 1) * 6) / n), ch = cw * 1.3, left = 28 + cw / 2, right = 226 - cw / 2;
    var pts = [];
    for (i = 0; i < n; i++) {
      // 山場（p 番目）まで上がり、最後は少し下がる
      var x = left + i * (right - left) / (n - 1), y = i <= p ? 118 - (i / p) * 62 : 118 - 62 * 0.45;
      pts.push([x, y]);
    }
    out += '<path d="M' + pts.map(function (q) { return r1(q[0]) + ' ' + r1(q[1]); }).join(' L') + '" stroke="' + OLIVE + '" stroke-width="1.2" fill="none" stroke-linejoin="round"/>';
    pts.forEach(function (q, k) {
      var x = q[0] - cw / 2, y = q[1] - ch / 2;
      out += rect(x, y, cw, ch, k === p ? ORANGE : PAPER, ' rx="2"') + line(x + cw * 0.2, y + ch * 0.38, x + cw * 0.8, y + ch * 0.38, k === p ? INK : OLIVE, 0.9) + line(x + cw * 0.2, y + ch * 0.6, x + cw * 0.62, y + ch * 0.6, k === p ? INK : OLIVE, 0.9);
    });
    return wrap(out);
  }
  MD.art = function (stage) {
    if (!stage) return '';
    if (stage.kind === 'note') return '';
    // 3 題材は MD.result と同じ値（values が無ければ題材の既定値）。既存 4 題材は今までどおり案の既定値
    var v = AD_THEMES[stage.theme] ? adVals(stage.theme, stage.values || {}) : (stage.values || MD.variantValues(stage.theme, stage.variant));
    if (stage.theme === 'py') return pyArt(stage.variant, v);
    if (stage.theme === 'circuit') return circuitArt(stage.variant, v);
    if (stage.theme === 'tool') return toolArt(stage.variant, v);
    if (stage.theme === 'stop') return stopArt(stage.variant, v);
    if (stage.theme === 'ath') return athArt(stage.variant, v);
    if (stage.theme === 'story') return storyArt(stage.variant, v);
    return mcArt(stage.variant, v);
  };
  // 図に出している量（テスト用。線画と同じ計算）
  MD.artMarks = function (stage) {
    if (!stage || stage.kind === 'note') return '';
    var v = AD_THEMES[stage.theme] ? adVals(stage.theme, stage.values || {}) : (stage.values || MD.variantValues(stage.theme, stage.variant));
    if (stage.theme === 'py') return JSON.stringify(pyMarks(v));
    if (stage.theme === 'circuit') return JSON.stringify(circuitMarks(stage.variant, v));
    if (stage.theme === 'tool') return JSON.stringify(toolMarks(v));
    if (stage.theme === 'stop') return JSON.stringify(stopMarks(v));
    if (stage.theme === 'ath') return JSON.stringify(athMarks(stage.variant, v));
    if (stage.theme === 'story') return JSON.stringify(storyMarks(v));
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
    else if (t === 'tool' && key === 'every') {
      // 間かくは分で比べる（0 = 話の終わりは最も長い扱い）
      var mf = toolMin(from), mt = toolMin(to);
      if (mf === 0) mf = Infinity;
      if (mt === 0) mt = Infinity;
      vars.effect = '出る間かく'; vars.aim = '間かく'; vars.how = mt < mf ? 'よく出るようになった' : '出るのがゆっくりになった';
    } else if (t === 'tool') {
      var noun = stage.variant === 'board' ? '枝' : (stage.variant === 'nudge' ? '行' : 'カード');
      vars.effect = 'まとめる数'; vars.aim = '数'; vars.how = noun + (up ? 'がふえた' : 'がへった');
    }
    // §AE-1（contract-app verbatim）
    else if (t === 'stop' && key === 'frames') { vars.effect = '動画の長さ'; vars.aim = '長さ'; vars.how = up ? '動画が長くなった' : '動画がみじかくなった'; }
    else if (t === 'stop') { vars.effect = '動きのなめらかさ'; vars.aim = 'なめらかさ'; vars.how = up ? 'なめらかに動いた' : 'カクカク動いた'; }
    else if (t === 'ath' && key === 'gap') { vars.effect = 'とぶ距離'; vars.aim = '距離'; vars.how = up ? '足場がはなれた' : '足場が近くなった'; }
    else if (t === 'ath') { vars.effect = 'コースの長さ'; vars.aim = '長さ'; vars.how = up ? 'コースが長くなった' : 'コースがみじかくなった'; }
    else if (t === 'story' && key === 'scenes') { vars.effect = '話の長さ'; vars.aim = '長さ'; vars.how = up ? '場面がふえた' : '場面がへった'; }
    else if (t === 'story') {
      vars.effect = '語り方'; vars.aim = '語り方';
      vars.how = ['「わたし」の気持ちが近くなった', '外から見わたせるようになった', '手紙を読んでいる感じになった'][to] || '語り方がかわった';
    }
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
    // 今日のお題から作った外の記録（theme 'odai'）はお題の線画（today-data.js が MD.odaiPhotoArt を置く）。無ければ写真の枠だけ（3 題材の絵を出さない）
    if (photo.theme === 'odai') return MD.odaiPhotoArt ? MD.odaiPhotoArt(photo) : wrap(corners(), 'is-photo');
    var n = photo.n || 0, inner;
    if (photo.theme === 'py') {
      inner = pyArt(['catch', 'dodge', 'coin', 'maze'][n % 4], { speed: 2, count: 4 + (n % 2) * 2 });
    } else if (photo.theme === 'circuit') {
      inner = circuitArt(['series', 'switch', 'bulbs', 'single'][n % 4], { volt: 1, ohm: 2 });
    } else if (photo.theme === 'tool') {
      // 写真から tool を作る経路は無い（§Y-7）。万一来ても道具の線画にする（マイクラの写真に落とさない）
      inner = toolArt(['memo', 'nudge', 'oneby', 'board'][n % 4], { count: 3, every: 2 });
    } else if (photo.theme === 'stop' || photo.theme === 'ath' || photo.theme === 'story') {
      // §AE-1: 題材の線画（案を順に。値は案の既定）
      var vk = THEME[photo.theme].variants[n % 4];
      inner = MD.art({ kind: 'sample', theme: photo.theme, variant: vk, values: MD.variantValues(photo.theme, vk) });
    } else if (photo.theme === 'project') {
      // §AE-4: 提案から作った活動の写真は提案のカテゴリの線画（マイクラの写真に落とさない）
      inner = MD.catArt(photo.cat);
    } else {
      return wrap(mcShot(n % MD.PHOTO_COUNT) + corners(), 'is-photo');
    }
    return inner.replace('</svg>', corners() + '</svg>').replace('class="mk-art"', 'class="mk-art is-photo"');
  };

  // ---------- §AE-5 カテゴリの線画（7 種。墨 + オリーブ、強調だけ橙）。知らないカテゴリは空の枠 ----------
  MD.CATS = ['minecraft', 'programming', 'craft', 'digital', 'media', 'drawing', 'writing'];
  MD.catArt = function (cat) {
    var out = '', i;
    if (cat === 'minecraft') {
      out += line(30, 132, 210, 132, OLIVE, 1.2);
      for (i = 0; i < 4; i++) out += block(72 + i * 24, 108, 24, 0);
      for (i = 0; i < 2; i++) out += block(96 + i * 24, 84, 24, 2);
      out += rect(108, 60, 24, 24, ORANGE);
      out += block(176, 108, 24, 1);
    } else if (cat === 'programming') {
      out += screen();
      out += line(44, 50, 84, 50, OLIVE, 2) + line(56, 66, 120, 66, OLIVE, 2) + line(56, 82, 104, 82, OLIVE, 2) + line(44, 98, 76, 98, OLIVE, 2);
      out += '<path d="M150 58 l-10 14 10 14 M176 58 l10 14 -10 14" stroke="' + ORANGE + '" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>';
      out += rect(84, 108, 8, 14, ORANGE);
    } else if (cat === 'craft') {
      out += line(20, 136, 220, 136, OLIVE, 1.2);
      out += poly([[30, 52], [150, 92], [150, 100], [30, 60]], SAND) + poly([[200, 104], [80, 128], [80, 136], [200, 112]], SAND);
      out += line(150, 96, 150, 136, INK, 1.2) + line(30, 56, 30, 136, INK, 1.2) + line(200, 108, 200, 136, INK, 1.2);
      out += '<circle cx="58" cy="54" r="7" fill="' + ORANGE + '" stroke="' + INK + '" stroke-width="1.2"/>';
    } else if (cat === 'digital') {
      out += rect(60, 20, 120, 112, PAPER, ' rx="4"') + line(60, 40, 180, 40, INK, 1.2) + rect(108, 40, 24, 14, MID);
      out += poly([[114, 54], [126, 54], [120, 62]], ORANGE);
      out += poly([[98, 116], [142, 116], [132, 92], [108, 92]], SAND) + line(76, 116, 164, 116, INK, 1.4);
    } else if (cat === 'media') {
      out += rect(46, 46, 112, 70, PAPER, ' rx="8"') + rect(64, 36, 34, 12, MID, ' rx="3"');
      out += '<circle cx="102" cy="81" r="22" fill="' + SAND + '" stroke="' + INK + '" stroke-width="1.4"/><circle cx="102" cy="81" r="11" fill="' + PAPER + '" stroke="' + OLIVE + '" stroke-width="1.2"/>';
      out += '<circle cx="144" cy="58" r="5" fill="' + ORANGE + '"/>';
      for (i = 0; i < 4; i++) out += rect(172, 30 + i * 24, 34, 20, PAPER, ' rx="2"');
      out += line(168, 26, 168, 128, OLIVE, 1) + line(210, 26, 210, 128, OLIVE, 1);
    } else if (cat === 'drawing') {
      out += rect(40, 20, 120, 112, PAPER, ' rx="3"');
      out += '<path d="M60 96 q20 -40 40 -10 t40 -16" stroke="' + ORANGE + '" stroke-width="3" fill="none" stroke-linecap="round"/>';
      out += line(60, 60, 96, 52, OLIVE, 1.4);
      out += poly([[168, 40], [178, 46], [138, 116], [128, 110]], SAND) + poly([[128, 110], [138, 116], [130, 124]], INK);
    } else if (cat === 'writing') {
      out += poly([[30, 34], [118, 40], [118, 130], [30, 124]], PAPER) + poly([[122, 40], [210, 34], [210, 124], [122, 130]], PAPER);
      for (i = 0; i < 5; i++) { out += line(42, 56 + i * 14, 106, 60 + i * 14, OLIVE, 1); out += line(134, 60 + i * 14, 198, 56 + i * 14, OLIVE, 1); }
      out += poly([[176, 26], [188, 26], [188, 58], [182, 52], [176, 58]], ORANGE);
    }
    return wrap(out);
  };

  // ---------- §AE-4「こんなのも作れる」の提案 12 件（contract-app verbatim。「小」は既存の書き方で起こした）----------
  // cat = data.js の catalog のカテゴリ id（writing だけはこの一覧専用）。catalogId は catalog に対応する項目がある時だけ
  function pj(id, cat, style, safety, catalogId, title, what, first, need, min, steps) {
    return { id: id, cat: cat, style: style, safety: safety, catalogId: catalogId, title: title, what: what, first: first, need: need, min: min, steps: steps };
  }
  MD.projects = [
    pj('pj-stop-moon', 'media', 'photo', true, 'media-stopmotion', ['月の満ち欠けをコマ撮りで 10 秒に', '月のみちかけをコマどりで 10 びょうに'],
      ['紙の月を少しずつ取りかえて撮る', '紙の月を少しずつとりかえてとる'], ['黒い紙と、丸く切った白い紙を用意する', '黒い紙と、丸く切った白い紙をよういする'],
      ['タブレット · 黒と白の紙 · はさみ', 'タブレット · 黒と白の紙 · はさみ'], 40,
      [['月の形を 8 枚切る', '月の形を 8 まい切る'], ['カメラを固定する', 'カメラをうごかないようにおく'], ['1 枚ずつ置きかえて撮る', '1 まいずつおきかえてとる'], ['つなげて見る', 'つなげて見る']]),
    pj('pj-mc-ath', 'minecraft', 'photo', false, 'mc-game', ['3 回めでクリアできるアスレチック', '3 回めでクリアできるアスレチック'],
      ['むずかしすぎず、かんたんすぎないコースを作って遊んでもらう', 'むずかしすぎず、かんたんすぎないコースをつくってあそんでもらう'], ['スタートとゴールの場所を決める', 'スタートとゴールの場所をきめる'],
      ['マイクラ（いつものワールド）', 'マイクラ（いつものワールド）'], 50,
      [['スタートとゴールを置く', 'スタートとゴールをおく'], ['足場を 5 個置く', '足場を 5 こおく'], ['ギミックを 1 つ足す', 'ギミックを 1 つたす'], ['だれかに遊んでもらう', 'だれかにあそんでもらう']]),
    pj('pj-novel-3', 'writing', 'illust', false, null, ['3 場面の短い小説に、表紙をつける', '3 場めんのみじかい小説に、ひょうしをつける'],
      ['はじまり・できごと・おわりの 3 場面で 1 つの話にする', 'はじまり・できごと・おわりの 3 場めんで 1 つの話にする'], ['主人公がほしいものを 1 つ決める', 'しゅじんこうがほしいものを 1 つきめる'],
      ['ノートかパソコン · 表紙の紙', 'ノートかパソコン · ひょうしの紙'], 60,
      [['主人公を決める', 'しゅじんこうをきめる'], ['3 場面を書く', '3 場めんを書く'], ['題を決める', 'だいをきめる'], ['表紙を描く', 'ひょうしをかく']]),
    pj('pj-trailer', 'media', 'photo', false, 'media-movie', ['好きな本の予告編を 30 秒で', '好きな本のよこくへんを 30 びょうで'],
      ['見た人が読みたくなる 30 秒の動画を作る', '見た人が読みたくなる 30 びょうの動画をつくる'], ['本の中で見せたい場面を 3 つ選ぶ', '本の中で見せたい場めんを 3 つえらぶ'],
      ['タブレット · 好きな本', 'タブレット · 好きな本'], 45,
      [['見せたい場面を 3 つ選ぶ', '見せたい場めんを 3 つえらぶ'], ['1 場面ずつ撮る', '1 場めんずつとる'], ['題と一言を入れる', 'だいとひとことを入れる'], ['つなげて見る', 'つなげて見る']]),
    pj('pj-mc-door', 'minecraft', 'line', false, 'mc-redstone', ['合図で開くかくし扉', 'あいずでひらくかくしとびら'],
      ['レッドストーン回路で、ボタンを押すと壁が開く仕組みを作る', 'レッドストーン回路で、ボタンをおすとかべがひらくしくみをつくる'], ['扉にする壁の場所を決める', 'とびらにするかべの場所をきめる'],
      ['マイクラ（いつものワールド）', 'マイクラ（いつものワールド）'], 50,
      [['壁を作る', 'かべをつくる'], ['ピストンを置く', 'ピストンをおく'], ['ボタンから回路をつなぐ', 'ボタンから回路をつなぐ'], ['外から見えないようにかくす', '外から見えないようにかくす']]),
    pj('pj-scratch-quiz', 'programming', 'photo', false, 'prog-scratch', ['おうちの人に出すクイズゲーム', 'おうちの人に出すクイズゲーム'],
      ['スクラッチで 3 問のクイズを作る', 'スクラッチで 3 もんのクイズをつくる'], ['クイズを 3 問、紙に書く', 'クイズを 3 もん、紙に書く'],
      ['スクラッチが動くパソコン', 'スクラッチがうごくパソコン'], 45,
      [['クイズを 3 問書く', 'クイズを 3 もん書く'], ['1 問目を作る', '1 もん目をつくる'], ['正解の時の動きを作る', 'せいかいの時のうごきをつくる'], ['3 問つなげる', '3 もんつなげる']]),
    pj('pj-marble', 'craft', 'photo', true, 'craft-cardboard', ['ダンボールのビー玉コースター', 'ダンボールのビーだまコースター'],
      ['ビー玉が最後まで転がるコースを作る', 'ビーだまがさいごまでころがるコースをつくる'], ['ビー玉が転がる坂を 1 本作る', 'ビーだまがころがるさかを 1 本つくる'],
      ['ダンボール · テープ · ビー玉 · カッター', 'ダンボール · テープ · ビーだま · カッター'], 60,
      [['坂を 1 本作る', 'さかを 1 本つくる'], ['曲がり角を足す', 'まがりかどをたす'], ['落ちないようにへりを付ける', 'おちないようにへりをつける'], ['最後まで転がるか試す', 'さいごまでころがるかためす']]),
    pj('pj-3d-key', 'digital', 'photo', false, 'dig-3dprint', ['好きな形のキーホルダーを 3D で', '好きな形のキーホルダーを 3D で'],
      ['3D モデリングで形を作り、プリンターで出す', '3D モデリングで形をつくり、プリンターで出す'], ['作りたい形を紙に描く', 'つくりたい形を紙にかく'],
      ['3D モデリングのソフト · 3D プリンター', '3D モデリングのソフト · 3D プリンター'], 60,
      [['形を紙に描く', '形を紙にかく'], ['画面で形を作る', '画面で形をつくる'], ['穴をあける', 'あなをあける'], ['プリンターで出す', 'プリンターで出す']]),
    pj('pj-stamp', 'drawing', 'illust', false, 'draw-stamp', ['気持ちを伝えるスタンプ 4 個', 'きもちをつたえるスタンプ 4 こ'],
      ['「ありがとう」「あとでね」などを絵で伝えるスタンプを描く', '「ありがとう」「あとでね」などを絵でつたえるスタンプをかく'], ['伝えたい言葉を 4 つ決める', 'つたえたいことばを 4 つきめる'],
      ['iPad かペンと紙', 'iPad かペンと紙'], 40,
      [['言葉を 4 つ決める', 'ことばを 4 つきめる'], ['キャラを 1 人決める', 'キャラを 1 人きめる'], ['4 個描く', '4 こかく'], ['だれかに送って試す', 'だれかにおくってためす']]),
    pj('pj-manga', 'drawing', 'line', false, 'draw-manga', ['今日あったことを 4 コマ漫画に', 'きょうあったことを 4 コマまんがに'],
      ['今日のできごとを 1 つ選んで 4 コマにする', 'きょうのできごとを 1 つえらんで 4 コマにする'], ['今日のできごとを 1 つ選ぶ', 'きょうのできごとを 1 つえらぶ'],
      ['紙とペン', '紙とペン'], 30,
      [['できごとを 1 つ選ぶ', 'できごとを 1 つえらぶ'], ['4 コマに分ける', '4 コマに分ける'], ['絵とせりふを描く', '絵とせりふをかく'], ['だれかに読んでもらう', 'だれかに読んでもらう']]),
    pj('pj-sugoroku', 'craft', 'photo', false, null, ['自分のルールのすごろく', '自分のルールのすごろく'],
      ['マスとルールを自分で決めたすごろくを作る', 'マスとルールを自分できめたすごろくをつくる'], ['マスの数とゴールを決める', 'マスの数とゴールをきめる'],
      ['大きい紙 · ペン · サイコロ', '大きい紙 · ペン · サイコロ'], 50,
      [['マスとゴールを描く', 'マスとゴールをかく'], ['特別なマスを 3 つ作る', 'とくべつなマスを 3 つつくる'], ['ルールを書く', 'ルールを書く'], ['遊んで直す', 'あそんでなおす']]),
    pj('pj-tokusatsu', 'media', 'photo', false, 'media-tokusatsu', ['ミニチュアの町で特撮の 1 シーン', 'ミニチュアの町でとくさつの 1 シーン'],
      ['小さな町を作り、下から撮って大きく見せる', '小さな町をつくり、下からとって大きく見せる'], ['町に置く建物を 3 つ決める', '町におくたてものを 3 つきめる'],
      ['箱や紙の建物 · タブレット', '箱や紙のたてもの · タブレット'], 60,
      [['建物を 3 つ作る', 'たてものを 3 つつくる'], ['町に並べる', '町にならべる'], ['下から撮る', '下からとる'], ['見てもらう', '見てもらう']])
  ];
  MD.project = function (id) { for (var i = 0; i < MD.projects.length; i++) if (MD.projects[i].id === id) return MD.projects[i]; return null; };
  // 提案から作った活動の「バディに任せる」のメモ（お題から作った活動と同じ 2 つ: 手順を整理して / 必要な物をまとめて）。alt = 同じ種類で作り直した時のもう一方の形
  MD.projectNote = function (p, opt, alt) {
    if (!p) return null;
    if (opt === 'osteps') {
      var list = alt ? [p.first].concat(p.steps.slice(1)) : p.steps;
      return { title: alt ? ['作り方の手順（最初の一歩から）', 'つくりかたの手じゅん（さいしょの一歩から）'] : ['作り方の手順', 'つくりかたの手じゅん'],
        lines: list.map(function (s, i) { return [(i + 1) + '. ' + s[0], (i + 1) + '. ' + s[1]]; }) };
    }
    if (opt === 'oneed') {
      var js = String(p.need[0]).split(/\s*·\s*/), es = String(p.need[1]).split(/\s*·\s*/);
      if (alt) return { title: ['持ち物チェック', 'もちものチェック'], lines: js.map(function (s, i) { return ['□ ' + s, '□ ' + (es[i] || s)]; }) };
      return { title: ['必要な物', 'ひつようなもの'], lines: js.map(function (s, i) { return [s, es[i] || s]; }).concat([['目安 ' + p.min + ' 分くらい', 'めやす ' + p.min + ' 分くらい']]) };
    }
    return null;
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
      id: 'act-py', day: '10/30', title: 'Python の小さなゲーム', origin: 'sample', theme: 'py', catalogId: 'prog-python', sampleId: 'py',
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
      id: 'act-cap', day: '11/1', title: pick(cap.title, 'js'), origin: 'works', theme: 'circuit', catalogId: cap.catalogId, sampleId: null,
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
  MD.seedWorks = function (acts) { return buildWorks(SEED_WORKS, acts); };
  function buildWorks(defs, acts) {
    var out = [];
    defs.forEach(function (d) {
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
  }

  // ---------- §AE-6 見本を足した回 2: 作品の見本 3 件（完成 2 + 試作 1）と結び付く活動 3 件 ----------
  // 回 1（上の seedActivities / seedWorks）は変えない。読み込み時に make.js が MD.addSeeds で「足した回」が古い保存データにだけ足す
  MD.SEED_V = 2;
  function adStage(theme, variant, values) { return { kind: 'sample', theme: theme, variant: variant, values: values }; }
  // 「{label}を {value} にした」（make.js の whatDiff と同じ形。名前のある値は名前）
  function oneOf(theme, key, v) { var p = param(theme, key); return { k: 'changed_one', v: { label: cp(p.label), value: [MD.valueLabel(theme, key, v, 'js'), MD.valueLabel(theme, key, v, 'es')] } }; }
  function testCh(id, time, theme, key, v, snap, extra) {
    var c = { id: id, who: 'own', kind: 'test', time: time, what: oneOf(theme, key, v), res: true, snap: cp(snap), vis: null };
    if (extra) Object.keys(extra).forEach(function (k) { c[k] = extra[k]; });
    return c;
  }
  function seedAct(o) {
    var thread = [{ id: o.id + '-m1', who: 'buddy', time: o.baseTime, r: 'open', text: MD.replies.open[0] }];
    o.changes.forEach(function (c, i) {
      var prev = i ? o.changes[i - 1].snap : o.base, key = Object.keys(c.snap.values).filter(function (k) { return c.snap.values[k] !== prev.values[k]; })[0];
      thread.push({ id: o.id + '-m' + (i + 2), who: 'buddy', time: c.time, r: 'test', text: MD.testReply(c.snap, key, prev.values[key], 'js'), change: c.id });
    });
    var last = o.changes[o.changes.length - 1];
    return {
      id: o.id, day: o.day, title: pick(MD.variant(o.base.theme, o.base.variant).title, 'js'), origin: 'sample', theme: o.base.theme, catalogId: o.catalogId, sampleId: o.base.theme,
      quote: null, stage: cp(last.snap), base: cp(o.base), baseTime: o.baseTime, ext: null, baseVis: null, stepsKind: 'theme', candidate: false,
      steps: MD.stepsFor(o.base.theme, o.base.variant), stepIdx: Math.min(o.changes.length, 2), next: null,
      changes: o.changes, shelf: [], thread: thread,
      state: 'closed', pauseCount: 1, declined: 0, offered: false, resumeNote: null, lastPause: null,
      clock: o.clock, seq: 20, draft: '', v: 3
    };
  }
  function seedActsV2() {
    // 人形が歩く動画: コマの数 12 → 18 / 1 秒のコマ数 6 → 8 / 6 に戻す（田中さんと）
    var t0 = adStage('stop', 'walk', { frames: 2, fps: 1 }), t1 = adStage('stop', 'walk', { frames: 3, fps: 1 }), t2 = adStage('stop', 'walk', { frames: 3, fps: 2 }), t3 = adStage('stop', 'walk', { frames: 3, fps: 1 });
    var stop = seedAct({ id: 'act-stop', day: '11/4', catalogId: 'media-stopmotion', base: t0, baseTime: '10:20', clock: 626, changes: [
      testCh('act-stop-c1', '10:22', 'stop', 'frames', 3, t1), testCh('act-stop-c2', '10:24', 'stop', 'fps', 2, t2),
      testCh('act-stop-c3', '10:26', 'stop', 'fps', 1, t3, { with: '田中さん' })] });
    // 短い物語: 語り手を「外から語る」に / 「わたし」が語るに戻す
    var s0 = adStage('story', 'short', { scenes: 4, voice: 0 }), s1 = adStage('story', 'short', { scenes: 4, voice: 1 }), s2 = adStage('story', 'short', { scenes: 4, voice: 0 });
    var story = seedAct({ id: 'act-story', day: '11/3', catalogId: null, base: s0, baseTime: '10:20', clock: 624, changes: [
      testCh('act-story-c1', '10:22', 'story', 'voice', 1, s1), testCh('act-story-c2', '10:24', 'story', 'voice', 0, s2)] });
    // スライムで跳ねるコース: 足場の数 5 → 6
    var a0 = adStage('ath', 'slime', { gap: 3, count: 5 }), a1 = adStage('ath', 'slime', { gap: 3, count: 6 });
    var ath = seedAct({ id: 'act-ath', day: '11/5', catalogId: 'mc-game', base: a0, baseTime: '10:20', clock: 622, changes: [
      testCh('act-ath-c1', '10:22', 'ath', 'count', 6, a1)] });
    return [stop, story, ath];
  }
  // 並びは日付の新しい順（回 1 の見本の前に入る）
  var SEED_WORKS_V2 = [
    { id: 'w-seed-ath', actId: 'act-ath', at: 'act-ath-c1', title: 'スライムで跳ねるコース（足場 6 個）', like: null, craft: null, date: '11/5', status: 'trial' },
    { id: 'w-seed-stop', actId: 'act-stop', at: 'act-stop-c3', title: '人形が歩く 18 コマの動画', like: 'コマを 18 にしたら、歩き方がなめらかになったところ',
      craft: '1 秒に 8 コマだと速すぎたので、6 コマに戻した', date: '11/4', status: 'done' },
    { id: 'w-seed-story', actId: 'act-story', at: 'act-story-c2', title: '雨の日の図書室（4 場面）', like: '3 場面目で、なくした本が見つかるところ',
      craft: '「わたし」が語る形にしたら、気持ちを書きやすくなった', date: '11/3', status: 'done' }
  ];
  // 足した回が fromV（保存されていた番号）より新しい見本のうち、無い活動・作品だけ足す。既存の活動・作品は変えない（元の配列も変えない）。
  // 活動は末尾に、作品は回 1 の見本（w-seed-*）の前に（無ければ末尾に）入れる。戻り値 { activities, works, changed }
  MD.addSeeds = function (acts, works, fromV) {
    acts = acts || []; works = works || [];
    if ((fromV | 0) >= MD.SEED_V) return { activities: acts, works: works, changed: false };
    var addA = seedActsV2().filter(function (a) { return !findIn(acts, a.id); });
    var allA = acts.concat(addA);
    var addW = buildWorks(SEED_WORKS_V2, allA).filter(function (w) { return !findIn(works, w.id); });
    var at = -1;
    works.forEach(function (w, i) { if (at < 0 && w && typeof w.id === 'string' && w.id.indexOf('w-seed-') === 0) at = i; });
    var outW = at < 0 ? works.concat(addW) : works.slice(0, at).concat(addW, works.slice(at));
    return { activities: allA, works: outW, changed: addA.length > 0 || addW.length > 0 };
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = MD;
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
