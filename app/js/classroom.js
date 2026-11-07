/* 教室の設定（contract-LS §LS-5）と DES.data の互換ファサード。
   モック data.js のうち架空でないもの（classroom・catalog）だけを残す。今日・今の時刻・曜日は DES.clock（JST）の getter。
   child / supporter / talk / plan / resume / goals の架空の値は持たない。 */
(function (root) {
  'use strict';
  var DES = root.DES = root.DES || {};
  var WD = { Sun: '日', Mon: '月', Tue: '火', Wed: '水', Thu: '木', Fri: '金', Sat: '土' };
  var FMT = null;
  function parts(d) {
    if (!FMT) FMT = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' });
    var out = {};
    FMT.formatToParts(d || new Date()).forEach(function (p) { out[p.type] = p.value; });
    return out;
  }
  // JST の今日 'YYYY-MM-DD' / 今の時刻 'HH:mm' / 曜日 '月'〜'日' / ISO（UTC。Codex の createdAt と同じ形で並べられる）
  DES.clock = {
    today: function (d) { var p = parts(d); return p.year + '-' + p.month + '-' + p.day; },
    now: function (d) { var p = parts(d); return (p.hour === '24' ? '00' : p.hour) + ':' + p.minute; },
    weekday: function (d) { return WD[parts(d).weekday] || ''; },
    iso: function (d) { return (d || new Date()).toISOString(); }
  };

  var data = {
    group: null,
    supporter: null,
    classroom: {
      open: '10:00', close: '15:30',
      lunch: ['12:30', '13:30'],
      circle: { today: 'tbd', minutes: 20, note: 'A/B は週で変わる' },
      exercise: ['11:30', '12:30'],
    },
    // 表の上の 3 枠（本人の言葉。空は null → 破線枠 + 「話しながら決まる」）
    goals: [
      { id: 'g1', label: '今後やってみたいこと', text: null },
      { id: 'g2', label: 'できるようになりたいこと', text: null },
      { id: 'g3', label: '目標', text: null },
    ],
    plan: [],
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
    talk: [],
    resume: null
  };
  function getter(name, fn) { Object.defineProperty(data, name, { get: fn, enumerable: true, configurable: true }); }
  getter('today', function () { return DES.clock.today(); });
  getter('now', function () { return DES.clock.now(); });
  getter('weekday', function () { return DES.clock.weekday(); });
  // 本人の名前は保存の profile から（自己理解で編集）。無ければ「あなた」
  getter('child', function () {
    var p = DES.state && DES.state.profile, name = p && typeof p.name === 'string' ? p.name.trim() : '';
    return { id: 'me', name: name || (DES.t ? DES.t('you') : '') };
  });
  DES.data = data;
  // 工場の配信 API（contract-LS §LS-10）。fetch(DES.factory.base + path) を timeoutMs で打ち切る
  DES.factory = { base: 'https://de-school-factory.h-fujii.workers.dev', timeoutMs: 8000 };
  if (typeof module !== 'undefined' && module.exports) module.exports = { clock: DES.clock, data: data };
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
