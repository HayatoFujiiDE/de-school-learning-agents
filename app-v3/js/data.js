/* 正準データ v3（verbatim — CONTRACT-v3 §D。実装担当はここを書き換えない。架空・人物名は v2 §D の はると / 田中さん のみ）
   today = 2026-11-02（月）。曜日グループ「月水金A」。デモの現在時刻 now = 10:20 */
window.DES = window.DES || {};
DES.data = {
  today: '2026-11-02', weekday: '月', group: '月水金A', now: '10:20',
  child: { id: 'haruto', name: 'はると' },
  supporter: { name: '田中さん' },
  classroom: {
    open: '10:00', close: '15:30',
    lunch: ['12:30', '13:30'],
    circle: { today: '10:50', minutes: 20, week: 'A', note: 'A/B は週で変わる' },
    exercise: ['11:30', '12:30'],
  },
  // 表の上の 3 枠（本人の言葉 = 青の出所。空は null → 破線枠 + 「話しながら決まる」）
  goals: [
    { id: 'g1', label: '今後やってみたいこと', text: 'Python のゲーム作りやってみたい', src: 'own', date: '11-02' },
    { id: 'g2', label: 'できるようになりたいこと', text: null },
    { id: 'g3', label: '目標', text: null },
  ],
  // 今日の予定。kind: fixed 固定 / event 当日の行事 / optional 参加自由 / mine 自分で選んだ / proposed 提案中 / held 保留
  // activity は catalog の id（固定・行事・運動は null）。from は提案の元になった会話 id
  plan: [
    { id: 'p1', start: '10:00', end: '10:50', title: '建築（大きく）', kind: 'mine', activity: 'mc-build' },
    { id: 'p2', start: '10:50', end: '11:10', title: 'サークル対話', kind: 'event' },
    { id: 'p3', start: '11:10', end: '11:30', title: 'アクセサリー作り', kind: 'mine', activity: 'craft-accessory' },
    { id: 'p4', start: '11:30', end: '12:30', title: '運動', kind: 'optional', choice: 'undecided' }, // undecided / join / skip / later
    { id: 'p5', start: '12:30', end: '13:30', title: 'お昼', kind: 'fixed' },
    { id: 'p6', start: '13:30', end: '14:15', title: 'アクセサリー作り（続き）', kind: 'proposed', activity: 'craft-accessory', from: 'talk-3' },
    { id: 'p7', start: '14:15', end: '15:15', title: 'ゲーム作り: Python', kind: 'proposed', activity: 'prog-python', from: 'talk-5' },
  ],
  // 今まで取り組んできたこと（共有された表の再構築。カテゴリ → 取り組み）
  catalog: [
    { id: 'minecraft', label: 'マイクラ', items: [
      { id: 'mc-build', title: '建築' },
      { id: 'mc-game', title: 'ゲーム作り ex) コマンド使って等' },
      { id: 'mc-redstone', title: 'レッドストーン回路' },
      { id: 'mc-mod', title: 'Mod 系 create etc...' },
      { id: 'mc-model', title: 'マイクラモデリング ex) ブロックベンチ' },
    ] },
    { id: 'programming', label: 'プログラミング', items: [
      { id: 'prog-scratch', title: 'スクラッチ' },
      { id: 'prog-js', title: 'ゲーム作り: Javascript' },
      { id: 'prog-python', title: 'ゲーム作り: Python' },
      { id: 'prog-unity', title: 'Unity' },
      { id: 'prog-roblox', title: 'Roblox ゲームづくり' },
    ] },
    { id: 'craft', label: 'ものづくり', items: [
      { id: 'craft-cardboard', title: 'ダンボール工作' },
      { id: 'craft-accessory', title: 'アクセサリー作り' },
      { id: 'craft-3dpen', title: '3D ペン' },
      { id: 'craft-lego', title: 'レゴ' },
    ] },
    { id: 'digital', label: 'デジもの', items: [
      { id: 'dig-3dprint', title: '3D プリンター/モデリング' },
      { id: 'dig-stormworks', title: 'ストームワークス' },
    ] },
    { id: 'media', label: '画像・動画', items: [
      { id: 'media-poster', title: 'ポスター作り' },
      { id: 'media-movie', title: '映画作り' },
      { id: 'media-tokusatsu', title: '特撮づくり' },
      { id: 'media-stopmotion', title: 'コマドリ' },
    ] },
    { id: 'drawing', label: '絵', items: [
      { id: 'draw-ipad', title: 'iPad 絵' },
      { id: 'draw-stamp', title: 'LINE スタンプ作り' },
      { id: 'draw-manga', title: '漫画づくり大会' },
    ] },
    { id: 'basics', label: '基礎学習系', items: [
      { id: 'basic-text', title: '基礎学習: テキストベース' },
      { id: 'basic-eboard', title: '基礎学習: eboard 動画' },
      { id: 'basic-boardgame', title: 'ボードゲーム系 学び' },
      { id: 'basic-digital', title: 'デジタル学習 ex) Duolingo etc...' },
    ] },
  ],
  // 会話（11/2）。who: child / buddy / record（表の操作の記録 = 緑の出所）
  talk: [
    { id: 'talk-0', time: '10:05', who: 'child', text: '建築、午前で終わりそうにない' },
    { id: 'talk-1', time: '10:05', who: 'buddy', text: 'どこまで進んでる？ 続きを午後に入れることもできるよ' },
    { id: 'talk-2', time: '10:06', who: 'child', text: '午後は別のことしたい。アクセサリーの続きと、なにか新しいの' },
    { id: 'talk-3', time: '10:06', who: 'buddy', text: 'アクセサリー作りの続きは 13:30 から 45 分くらい？ 新しいことは、今まで取り組んできたことから選んでもいいし、やったことがないものでもいいよ', proposal: 'p6' },
    { id: 'talk-4', time: '10:12', who: 'child', text: 'Python のゲーム作りやってみたい' },
    { id: 'talk-5', time: '10:12', who: 'buddy', text: 'いいね。14:15 から 15:15 で「ゲーム作り: Python」を入れておく？ 最初は見本を動かすところから', proposal: 'p7' },
  ],
  resume: { title: 'バディとの会話', next: 'Python のゲーム作りやってみたい' },
};
