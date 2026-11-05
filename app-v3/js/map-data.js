/* 学びマップの中身（CONTRACT-v3 §Y-5 / §AB-8〜AB-10）。読み取りのみの見本: 算数 4 年の単元・項目、進み具合、学んだことの対応表、
   理科・国語・社会 4 年の単元（教材なし）、地図専用の「前に作ったもの」、単元どうしのつながり（学ぶ順・教科をまたぐ）、これから作れそうなもの。
   単元の主キーは code 欄。モックの code は "M4-A-01" / "S4-…" / "J4-…" / "C4-…" 形式の仮値で、学習指導要領コードの実在の値ではない（本番で差し替える）。
   単元の並び = 2017 改訂（2020 実施）第 4 学年の内容の順（領域ごと）。% や日付で並べ替えない。
   文言は [中学生向け, 小学生向け] の組。学んだことの場面は既存の見本記録（make-data.js の活動・作品）の原文だけを引く。
   node からも読める（tools/map-test.js）。 */
(function (root) {
  'use strict';
  var DES = root.DES = root.DES || {};
  var MPD = DES.mapData = {};

  MPD.SUBJECT = ['算数', 'さんすう'];
  MPD.GRADE = 4;

  // ---------- 領域（段の順） ----------
  MPD.areas = [
    { id: 'A', sub: 'math', name: ['数と計算', '数とけいさん'] },
    { id: 'B', sub: 'math', name: ['図形', 'ずけい'] },
    { id: 'C', sub: 'math', name: ['変化と関係', 'へんかとかんけい'] },
    { id: 'D', sub: 'math', name: ['データの活用', 'データのかつよう'] }
  ];

  // ---------- 単元（14）と項目（3〜6）。項目の id = code + '-' + 番号 ----------
  // 並び = 学習指導要領（2017 改訂）第 4 学年の内容の項目の順（領域ごと）。code の番号もこの順
  function unit(code, area, name, items) {
    return {
      code: code, sub: 'math', area: area, subject: MPD.SUBJECT, grade: MPD.GRADE, name: name, material: true,
      items: items.map(function (nm, i) { return { id: code + '-' + (i + 1), name: nm }; })
    };
  }
  MPD.units = [
    unit('M4-A-01', 'A', ['大きな数', '大きな数'], [
      ['億と兆の位', 'おくと ちょうの くらい'], ['大きな数の読み方・書き方', '大きな数の 読みかた・書きかた'],
      ['10 倍・10 分の 1 の大きさ', '10 ばい・10 分の 1 の大きさ'], ['大きな数のかけ算', '大きな数の かけ算']]),
    unit('M4-A-02', 'A', ['がい数', 'がい数'], [
      ['四捨五入', 'ししゃごにゅう'], ['以上・以下と範囲', 'いじょう・いかと はんい'], ['がい数で見積もる', 'がい数で 見つもる']]),
    unit('M4-A-03', 'A', ['わり算の筆算', 'わり算の ひっ算'], [
      ['何十・何百のわり算', '何十・何百の わり算'], ['1 けたでわる筆算', '1 けたで わる ひっ算'], ['2 けたでわる筆算', '2 けたで わる ひっ算'],
      ['あまりのあるわり算', 'あまりの ある わり算'], ['答えの確かめ', '答えの たしかめ']]),
    unit('M4-A-04', 'A', ['小数', '小数'], [
      ['100 分の 1 の位', '100 分の 1 の くらい'], ['小数のたし算・ひき算', '小数の たし算・ひき算'], ['小数 × 整数', '小数 × せいすう'], ['小数 ÷ 整数', '小数 ÷ せいすう']]),
    unit('M4-A-05', 'A', ['分数', '分数'], [
      ['真分数・仮分数・帯分数', 'しん分数・か分数・たい分数'], ['大きさの等しい分数', '大きさの ひとしい分数'], ['分数のたし算・ひき算', '分数の たし算・ひき算']]),
    unit('M4-A-06', 'A', ['計算のきまり', '計算の きまり'], [
      ['( ) を使った式', '( ) を つかった式'], ['計算の順序', '計算の じゅんじょ'], ['計算のきまりを使う', '計算の きまりを つかう'], ['□を使った式', '□を つかった式']]),
    unit('M4-B-01', 'B', ['垂直・平行と四角形', 'すいちょく・へいこうと 四角形'], [
      ['垂直', 'すいちょく'], ['平行', 'へいこう'], ['台形・平行四辺形', 'だいけい・へいこう四辺形'], ['ひし形', 'ひし形'], ['対角線', 'たいかく線']]),
    unit('M4-B-02', 'B', ['直方体と立方体', 'ちょくほうたいと りっぽうたい'], [
      ['面・辺・頂点', 'めん・へん・ちょう点'], ['展開図', 'てんかい図'], ['面や辺の垂直・平行', 'めんや へんの すいちょく・へいこう'],
      ['見取図', '見とり図'], ['ものの位置の表し方', 'ものの いちの あらわしかた']]),
    unit('M4-B-03', 'B', ['面積', 'めんせき'], [
      ['面積の表し方（cm²）', 'めんせきの あらわしかた（cm²）'], ['長方形・正方形の面積', '長方形・正方形の めんせき'],
      ['大きな面積の単位（m²・km²）', '大きな めんせきの たんい（m²・km²）'], ['a・ha の単位', 'a・ha の たんい'], ['組み合わせた形の面積', 'くみあわせた形の めんせき']]),
    unit('M4-B-04', 'B', ['角の大きさ', '角の大きさ'], [
      ['角の大きさの表し方（度）', '角の大きさの あらわしかた（ど）'], ['分度器ではかる', '分度きで はかる'], ['角をかく', '角を かく'], ['三角じょうぎの角', '三角じょうぎの 角']]),
    unit('M4-C-01', 'C', ['変わり方', 'かわりかた'], [
      ['2 つの量の変わり方を表にする', '2 つの りょうの かわりかたを ひょうにする'], ['変わり方を式に表す', 'かわりかたを 式に あらわす'], ['変わり方をグラフに表す', 'かわりかたを グラフに あらわす']]),
    unit('M4-C-02', 'C', ['簡単な割合', 'かんたんな わりあい'], [
      ['何倍かで比べる', '何ばいかで くらべる'], ['もとにする大きさ', 'もとにする 大きさ'], ['割合を使って比べる', 'わりあいを つかって くらべる']]),
    unit('M4-D-01', 'D', ['整理のしかた', 'せいりの しかた'], [
      ['2 つの観点で分ける', '2 つの 見かたで 分ける'], ['二次元の表', 'たてと よこの ひょう'], ['表から特徴を読む', 'ひょうから とくちょうを 読む']]),
    unit('M4-D-02', 'D', ['折れ線グラフ', 'おれ線グラフ'], [
      ['折れ線グラフの読み方', 'おれ線グラフの 読みかた'], ['折れ線グラフのかき方', 'おれ線グラフの かきかた'], ['変わり方の様子を読む', 'かわりかたの ようすを 読む'], ['2 つのグラフを比べる', '2 つの グラフを くらべる']])
  ];

  // ---------- 教科（分野で見るの島の並び = この順 × 領域の順）と、算数以外の領域（§AB-5 / AB-8） ----------
  MPD.subjects = [
    { id: 'math', name: MPD.SUBJECT },
    { id: 'sci', name: ['理科', 'りか'] },
    { id: 'jpn', name: ['国語', 'こくご'] },
    { id: 'soc', name: ['社会', 'しゃかい'] }
  ];
  MPD.otherAreas = [
    { id: 'SA', sub: 'sci', name: ['物質とエネルギー', 'ものと エネルギー'] },
    { id: 'SB', sub: 'sci', name: ['生命と地球', 'いのちと ちきゅう'] },
    { id: 'JK', sub: 'jpn', name: ['言葉', 'ことば'] },
    { id: 'JE', sub: 'jpn', name: ['話す・書く', '話す・書く'] },
    { id: 'JR', sub: 'jpn', name: ['読む', '読む'] },
    { id: 'CR', sub: 'soc', name: ['県のようす', 'けんの ようす'] },
    { id: 'CL', sub: 'soc', name: ['くらしを支える', 'くらしを ささえる'] }
  ];

  // ---------- 教材の無い単元（%・項目を持たない。§Y-2 の破線枠 / §AB-8）。学習指導要領 第 4 学年の内容を要約した名前 ----------
  function ext(code, sub, area, name) {
    var sj = null;
    for (var i = 0; i < MPD.subjects.length; i++) if (MPD.subjects[i].id === sub) sj = MPD.subjects[i].name;
    return { code: code, sub: sub, area: area, subject: sj, grade: MPD.GRADE, name: name, material: false };
  }
  MPD.extUnits = [
    // 理科 4 年（8）: 物質・エネルギー / 生命・地球
    ext('S4-A-01', 'sci', 'SA', ['電流の働き', 'でんりゅうの はたらき']),
    ext('S4-A-02', 'sci', 'SA', ['空気と水の性質', 'くうきと 水の せいしつ']),
    ext('S4-A-03', 'sci', 'SA', ['金属・水・空気と温度', 'きんぞく・水・くうきと おんど']),
    ext('S4-B-01', 'sci', 'SB', ['人の体のつくりと運動', '人の からだの つくりと うんどう']),
    ext('S4-B-02', 'sci', 'SB', ['季節と生物', 'きせつと 生きもの']),
    ext('S4-B-03', 'sci', 'SB', ['雨水の行方と地面の様子', '雨水の ゆくえと じめんの ようす']),
    ext('S4-B-04', 'sci', 'SB', ['天気の様子', '天気の ようす']),
    ext('S4-B-05', 'sci', 'SB', ['月と星', '月と 星']),
    // 国語 4 年（6）: 言葉（知識及び技能）/ 話す・書く / 読む
    ext('J4-K-01', 'jpn', 'JK', ['情報の整理（比べる・分ける）', 'じょうほうの せいり（くらべる・分ける）']),
    ext('J4-K-02', 'jpn', 'JK', ['ことわざ・短歌・俳句', 'ことわざ・たんか・はいく']),
    ext('J4-A-01', 'jpn', 'JE', ['調べたことを話す・聞く', 'しらべたことを 話す・聞く']),
    ext('J4-B-01', 'jpn', 'JE', ['理由を挙げて書く', 'りゆうを あげて 書く']),
    ext('J4-C-01', 'jpn', 'JR', ['説明文を要約する', 'せつめい文を まとめる']),
    ext('J4-C-02', 'jpn', 'JR', ['物語の気持ちの変化を読む', 'ものがたりの 気もちの へんかを 読む']),
    // 社会 4 年（6）: 県のようす / くらしを支える
    ext('C4-A-01', 'soc', 'CR', ['県の地形と地図', 'けんの ちけいと ちず']),
    ext('C4-A-02', 'soc', 'CR', ['県内の特色ある地域', 'けんの とくちょうの ある ちいき']),
    ext('C4-A-03', 'soc', 'CR', ['伝わる行事と先人の働き', 'つたわる ぎょうじと せんじんの はたらき']),
    ext('C4-B-01', 'soc', 'CL', ['水はどこから', '水は どこから']),
    ext('C4-B-02', 'soc', 'CL', ['ごみの処理と利用', 'ごみの しょりと りよう']),
    ext('C4-B-03', 'soc', 'CL', ['自然災害からくらしを守る', 'しぜんさいがいから くらしを まもる'])
  ];

  // ---------- 進み具合（項目ごと { practice: 'M/D' | null, explain: 'M/D' | null }）----------
  // 見本の物語: 11 月の 4 年生。大きな数・折れ線グラフ・わり算の筆算・角の大きさ・垂直・平行と四角形はおおむね両方済み、
  // 小数・がい数は途中、面積は途中（問題 2 項目・説明 1 項目）、計算のきまり・分数・直方体と立方体・変わり方・簡単な割合・整理のしかたは空。
  // 全体で 21 / 55 項目
  function p(practice, explain) { return { practice: practice || null, explain: explain || null }; }
  MPD.progress = {
    'M4-A-01-1': p('9/8', '9/9'), 'M4-A-01-2': p('9/8', '9/9'), 'M4-A-01-3': p('9/10', '9/11'), 'M4-A-01-4': p('9/11', '9/12'),
    'M4-D-02-1': p('9/15', '9/15'), 'M4-D-02-2': p('9/16', '9/17'), 'M4-D-02-3': p('9/17', '9/18'), 'M4-D-02-4': p('9/18', '9/19'),
    'M4-A-03-1': p('9/24', '9/25'), 'M4-A-03-2': p('9/26', '9/29'), 'M4-A-03-3': p('10/1', '10/2'), 'M4-A-03-4': p('10/3', '10/6'), 'M4-A-03-5': p('10/7', null),
    'M4-B-04-1': p('10/9', '10/9'), 'M4-B-04-2': p('10/10', '10/14'), 'M4-B-04-3': p('10/14', '10/15'), 'M4-B-04-4': p('10/15', '10/16'),
    'M4-B-01-1': p('10/20', '10/21'), 'M4-B-01-2': p('10/21', '10/22'), 'M4-B-01-3': p('10/23', '10/27'), 'M4-B-01-4': p('10/27', null),
    'M4-A-04-1': p('10/28', '10/29'), 'M4-A-04-2': p('10/30', null),
    'M4-A-02-1': p('10/31', null), 'M4-A-02-2': p(null, '10/31'),
    'M4-B-03-1': p('11/1', null), 'M4-B-03-2': p('11/1', '11/1')
  };

  // ---------- 前に作ったもの（地図専用の見本・§AB-9）。作る・作品・あしあとのデータには入れない ----------
  // 題材は予定ページの「今まで取り組んできたこと」の名前（catalogId）+ 季節のもの。art = 2 色線画の種類（map.js が描く）。
  // records = その時の記録（本人の言葉・操作 / 人の言葉）。原文はモードで書き換えないので 1 つの文字列。人名は既存の見本と同じ人だけ
  function rec(pid, n, date, time, text, w) { return { id: pid + '-r' + n, date: date, time: time, text: text, with: w || null }; }
  MPD.past = [
    { id: 'past-gauge', title: ['ペットボトルの雨量計', 'ペットボトルの うりょうけい'], date: '8/26', art: 'gauge', catalogId: null,
      records: [rec('past-gauge', 1, '8/22', '9:10', '雨の量を 2.5 mm と書いた'), rec('past-gauge', 2, '8/26', '10:05', '1 週間の雨の量をグラフにかいた'),
        rec('past-gauge', 3, '8/24', '8:40', '庭の低いところに水たまりができていた')] },
    { id: 'past-poster', title: ['防災ポスター', 'ぼうさいポスター'], date: '9/5', art: 'poster', catalogId: 'media-poster',
      records: [rec('past-poster', 1, '9/3', '10:20', '「いちばん伝えたいことは？」と聞かれて、1 つにしぼった', '田中さん'),
        rec('past-poster', 2, '9/2', '11:00', '家から近いひなん場所を地図でさがした'), rec('past-poster', 3, '9/5', '13:40', 'みんなの前でポスターを見せて説明した')] },
    { id: 'past-moon', title: ['お月見のコマドリ', 'おつきみの コマドリ'], date: '9/17', art: 'moon', catalogId: 'media-stopmotion',
      records: [rec('past-moon', 1, '9/17', '19:00', '5 日間、同じ時こくに月の写真をとった'), rec('past-moon', 2, '9/17', '14:30', '1 秒 4 まいだとカクカクしたので、8 まいにした')] },
    { id: 'past-box', title: ['ダンボールの貯金箱', 'ダンボールの ちょきんばこ'], date: '9/19', art: 'box', catalogId: 'craft-cardboard',
      records: [rec('past-box', 1, '9/18', '10:30', '展開図をかいてから切ったら、ふたがぴったりしまった'), rec('past-box', 2, '9/18', '11:05', 'かどがななめだと、箱がかたむいた'),
        rec('past-box', 3, '9/19', '14:10', '10 円玉が 100 まいで 1000 円になった')] },
    { id: 'past-maze', title: ['スクラッチの迷路ゲーム', 'スクラッチの めいろゲーム'], date: '9/26', art: 'maze', catalogId: 'prog-scratch',
      records: [rec('past-maze', 1, '9/25', '10:40', '90 度ずつ回したら、ちゃんと曲がれた'), rec('past-maze', 2, '9/25', '11:10', 'かべを同じ向きにならべたら、通路がまっすぐになった'),
        rec('past-maze', 3, '9/26', '10:15', '外のかべを、たて 8 マス・よこ 12 マスにした')] },
    { id: 'past-beads', title: ['ビーズのブレスレット', 'ビーズの ブレスレット'], date: '10/9', art: 'beads', catalogId: 'craft-accessory',
      records: [rec('past-beads', 1, '10/8', '11:20', '赤・青・白を 1 組にして、くり返してならべた'), rec('past-beads', 2, '10/8', '11:00', '手首をはかったら 15 cm と少しだった。ひもは 18 cm にした'),
        rec('past-beads', 3, '10/9', '10:30', 'ビーズを色ごとに分けて、数を表に書いた')] },
    { id: 'past-leaf', title: ['落ち葉のしおり', 'おちばの しおり'], date: '10/23', art: 'leaf', catalogId: null,
      records: [rec('past-leaf', 1, '10/22', '10:10', '日なたの葉の方が先に赤くなっていた'), rec('past-leaf', 2, '10/23', '11:30', '「落ち葉ふむ」で始まる俳句を書いた'),
        rec('past-leaf', 3, '10/23', '10:50', '方眼紙の上に葉っぱをおいて、マスを数えた')] }
  ];

  // ---------- 学んだこと（対応表）。判定ではなく手がかり: 記録 1 つを場面として必ず伴う ----------
  // 今の活動: evidence = { changeId, field: 'what', quote }（活動の変化）か { workId, field: 'like'|'craft', quote }（作品の本人の言葉）。
  // 前に作ったもの: pastId + evidence = { recordId, quote }。
  // quote = 学んだことを引き出した記録の原文。記録の今の文が quote と違う（本人が直した・空にした）時は、その学んだことを出さない。
  // 原文は make-data.js の見本: act-build-c1「石で塔を建てた」/ act-build-c2「塔を 2 倍にした」（田中さんと）/
  // w-seed-py の like・craft / w-seed-circuit の like。速さ（第 5 学年）は 4 年の単元に結ばない
  function pr(pid, n) {
    var p = null;
    MPD.past.forEach(function (x) { if (x.id === pid) p = x; });
    var r = p.records[n - 1];
    return { recordId: r.id, quote: r.text };
  }
  MPD.learned = [
    { id: 'ln-area', actId: 'act-build', text: ['大きさを 2 倍にすると、床の広さは 4 倍', '大きさを 2 ばいにすると、ゆかの 広さは 4 ばい'],
      evidence: { changeId: 'act-build-c2', field: 'what', quote: '塔を 2 倍にした' }, src: 'buddy', units: ['M4-B-03'] },
    { id: 'ln-cuboid', actId: 'act-build', text: ['塔は直方体。面は 6 つ', 'とうは ちょくほうたい。めんは 6 つ'],
      evidence: { changeId: 'act-build-c1', field: 'what', quote: '石で塔を建てた' }, src: 'buddy', units: ['M4-B-02'] },
    { id: 'ln-stars', actId: 'act-py', text: ['星の数を増やすと、ふれる回数も変わる（2 つの量がいっしょに変わる）', '星の数を ふやすと、ふれる回数も かわる（2 つの りょうが いっしょに かわる）'],
      evidence: { workId: 'w-seed-py', field: 'like', quote: '星が 6 つになると、どれを取りに行くか迷うところ' }, src: 'own', units: ['M4-C-01'] },
    { id: 'ln-speed', actId: 'act-py', text: ['速さを上げると取れる数が減る', 'はやさを 上げると とれる数が へる'],
      evidence: { workId: 'w-seed-py', field: 'craft', quote: '速さを 4 にしたら追いつけなかったので、3 に戻した' }, src: 'own', units: ['M4-C-01'] },
    { id: 'ln-battery', actId: 'act-cap', text: ['電池を 2 個つなぐと明るくなる', 'でんちを 2 こ つなぐと 明るくなる'],
      evidence: { workId: 'w-seed-circuit', field: 'like', quote: '電池を 2 個にしたら、電球がはっきりついたところ' }, src: 'own', units: ['S4-A-01'] },
    // ---- 前に作ったもの（§AB-10: 1 つの学んだことが複数の単元へ / 複数の作ったものが同じ単元へ を含む） ----
    { id: 'ln-rain-decimal', pastId: 'past-gauge', text: ['1 mm より少ない量は、小数で表せる', '1 mm より 少ない りょうは、小数で あらわせる'], evidence: pr('past-gauge', 1), src: 'own', units: ['M4-A-04'] },
    { id: 'ln-rain-graph', pastId: 'past-gauge', text: ['毎日の雨の量を折れ線グラフにすると、変わり方が見える', 'まいにちの 雨の りょうを おれ線グラフに すると、かわりかたが 見える'], evidence: pr('past-gauge', 2), src: 'own', units: ['M4-D-02', 'S4-B-04'] },
    { id: 'ln-rain-low', pastId: 'past-gauge', text: ['雨水は、地面の低いところに集まる', '雨水は、じめんの ひくい ところに あつまる'], evidence: pr('past-gauge', 3), src: 'buddy', units: ['S4-B-03'] },
    { id: 'ln-poster-one', pastId: 'past-poster', text: ['伝えたいことを 1 つにしぼると、見る人に伝わる', 'つたえたいことを 1 つに しぼると、見る人に つたわる'], evidence: pr('past-poster', 1), src: 'person', units: ['J4-B-01'] },
    { id: 'ln-poster-map', pastId: 'past-poster', text: ['ひなん場所は、地図で道すじをたどると分かる', 'ひなん ばしょは、ちずで みちすじを たどると わかる'], evidence: pr('past-poster', 2), src: 'own', units: ['C4-B-03', 'C4-A-01'] },
    { id: 'ln-poster-talk', pastId: 'past-poster', text: ['調べたことは、順番を決めて話すと伝わる', 'しらべたことは、じゅんばんを きめて 話すと つたわる'], evidence: pr('past-poster', 3), src: 'buddy', units: ['J4-A-01'] },
    { id: 'ln-moon-shape', pastId: 'past-moon', text: ['月の形は、日がたつと少しずつ変わる', '月の 形は、日が たつと 少しずつ かわる'], evidence: pr('past-moon', 1), src: 'own', units: ['S4-B-05'] },
    { id: 'ln-moon-frames', pastId: 'past-moon', text: ['1 秒の枚数をふやすと動きがなめらかになる（2 つの量がいっしょに変わる）', '1 びょうの まい数を ふやすと 動きが なめらかに なる（2 つの りょうが いっしょに かわる）'], evidence: pr('past-moon', 2), src: 'buddy', units: ['M4-C-01'] },
    { id: 'ln-box-net', pastId: 'past-box', text: ['展開図をかいてから切ると、ふたがぴったり閉まる', 'てんかい図を かいてから 切ると、ふたが ぴったり しまる'], evidence: pr('past-box', 1), src: 'own', units: ['M4-B-02'] },
    { id: 'ln-box-right', pastId: 'past-box', text: ['かどを直角にすると、箱がまっすぐ立つ', 'かどを ちょっかくに すると、はこが まっすぐ 立つ'], evidence: pr('past-box', 2), src: 'buddy', units: ['M4-B-01', 'M4-B-04'] },
    { id: 'ln-box-coins', pastId: 'past-box', text: ['10 円玉 100 枚で 1000 円。10 倍ずつ位が上がる', '10 円玉 100 まいで 1000 円。10 ばいずつ くらいが 上がる'], evidence: pr('past-box', 3), src: 'own', units: ['M4-A-01'] },
    { id: 'ln-maze-turn', pastId: 'past-maze', text: ['90 度ずつ回すと、通路にそって曲がれる', '90 どずつ 回すと、つうろに そって まがれる'], evidence: pr('past-maze', 1), src: 'own', units: ['M4-B-04'] },
    { id: 'ln-maze-wall', pastId: 'past-maze', text: ['かべを平行にならべると、まっすぐな通路になる', 'かべを へいこうに ならべると、まっすぐな つうろに なる'], evidence: pr('past-maze', 2), src: 'buddy', units: ['M4-B-01'] },
    { id: 'ln-maze-area', pastId: 'past-maze', text: ['外わくの広さは、たて × よこで分かる', 'そとわくの 広さは、たて × よこで わかる'], evidence: pr('past-maze', 3), src: 'buddy', units: ['M4-B-03'] },
    { id: 'ln-bead-repeat', pastId: 'past-beads', text: ['3 色を 1 組にしてくり返すと、組の数とビーズの数がいっしょに変わる', '3 色を 1 くみに して くりかえすと、くみの 数と ビーズの 数が いっしょに かわる'], evidence: pr('past-beads', 1), src: 'buddy', units: ['M4-C-01', 'M4-A-06'] },
    { id: 'ln-bead-length', pastId: 'past-beads', text: ['手首の長さは、だいたいの数でつかむと決めやすい', 'てくびの 長さは、だいたいの 数で つかむと きめやすい'], evidence: pr('past-beads', 2), src: 'own', units: ['M4-A-02'] },
    { id: 'ln-bead-table', pastId: 'past-beads', text: ['色ごとに分けて表にすると、数を比べやすい', '色ごとに 分けて ひょうに すると、数を くらべやすい'], evidence: pr('past-beads', 3), src: 'own', units: ['M4-D-01', 'J4-K-01'] },
    { id: 'ln-leaf-sun', pastId: 'past-leaf', text: ['日なたの葉の方が、先に色が変わる', 'ひなたの 葉の ほうが、さきに 色が かわる'], evidence: pr('past-leaf', 1), src: 'own', units: ['S4-B-02'] },
    { id: 'ln-leaf-haiku', pastId: 'past-leaf', text: ['季節の言葉を入れると、俳句になる', 'きせつの ことばを 入れると、はいくに なる'], evidence: pr('past-leaf', 2), src: 'own', units: ['J4-K-02'] },
    { id: 'ln-leaf-area', pastId: 'past-leaf', text: ['方眼のマスを数えると、葉の広さを比べられる', 'ほうがんの マスを 数えると、葉の 広さを くらべられる'], evidence: pr('past-leaf', 3), src: 'buddy', units: ['M4-B-03'] }
  ];

  // ---------- 単元どうしのつながり（§AB-10）: 学ぶ順（from が前・to が後）/ 教科をまたぐ（why = なぜつながるか [中, 小]） ----------
  MPD.unitLinks = [
    { id: 'o-num-round', kind: 'order', from: 'M4-A-01', to: 'M4-A-02' },
    { id: 'o-div-dec', kind: 'order', from: 'M4-A-03', to: 'M4-A-04' },
    { id: 'o-rule-change', kind: 'order', from: 'M4-A-06', to: 'M4-C-01' },
    { id: 'o-angle-par', kind: 'order', from: 'M4-B-04', to: 'M4-B-01' },
    { id: 'o-par-cube', kind: 'order', from: 'M4-B-01', to: 'M4-B-02' },
    { id: 'o-par-area', kind: 'order', from: 'M4-B-01', to: 'M4-B-03' },
    { id: 'o-graph-change', kind: 'order', from: 'M4-D-02', to: 'M4-C-01' },
    { id: 'o-weather-rain', kind: 'order', from: 'S4-B-04', to: 'S4-B-03' },
    { id: 'o-air-heat', kind: 'order', from: 'S4-A-02', to: 'S4-A-03' },
    { id: 'o-info-write', kind: 'order', from: 'J4-K-01', to: 'J4-B-01' },
    { id: 'o-map-area', kind: 'order', from: 'C4-A-01', to: 'C4-A-02' },
    { id: 'o-water-trash', kind: 'order', from: 'C4-B-01', to: 'C4-B-02' },
    { id: 'x-change-current', kind: 'cross', from: 'M4-C-01', to: 'S4-A-01', why: ['電池の数と明るさも、2 つの量の変わり方', 'でんちの 数と 明るさも、2 つの りょうの かわりかた'] },
    { id: 'x-graph-weather', kind: 'cross', from: 'M4-D-02', to: 'S4-B-04', why: ['気温の変わり方は、折れ線グラフにすると見やすい', 'きおんの かわりかたは、おれ線グラフに すると 見やすい'] },
    { id: 'x-table-info', kind: 'cross', from: 'M4-D-01', to: 'J4-K-01', why: ['表に分けて整理すると、比べやすくなる', 'ひょうに 分けて せいりすると、くらべやすく なる'] },
    { id: 'x-area-map', kind: 'cross', from: 'M4-B-03', to: 'C4-A-01', why: ['地図の上の広さも、面積で比べられる', 'ちずの 上の 広さも、めんせきで くらべられる'] },
    { id: 'x-num-water', kind: 'cross', from: 'M4-A-01', to: 'C4-B-01', why: ['町で使う水の量は、大きな数で表す', 'まちで つかう 水の りょうは、大きな 数で あらわす'] },
    { id: 'x-dec-weather', kind: 'cross', from: 'M4-A-04', to: 'S4-B-04', why: ['雨の量は 2.5 mm のように小数で表す', '雨の りょうは 2.5 mm のように 小数で あらわす'] },
    { id: 'x-moon-angle', kind: 'cross', from: 'S4-B-05', to: 'M4-B-04', why: ['月の高さは、角度で表せる', '月の 高さは、かくどで あらわせる'] },
    { id: 'x-season-haiku', kind: 'cross', from: 'S4-B-02', to: 'J4-K-02', why: ['季節の生き物は、俳句の季語にもなる', 'きせつの 生きものは、はいくの きごにも なる'] },
    { id: 'x-disaster-rain', kind: 'cross', from: 'C4-B-03', to: 'S4-B-03', why: ['大雨の水の流れ方を知ると、災害にそなえられる', '大雨の 水の ながれかたを しると、さいがいに そなえられる'] },
    { id: 'x-talk-region', kind: 'cross', from: 'J4-A-01', to: 'C4-A-02', why: ['調べた地域のよさを、話して伝える', 'しらべた ちいきの よさを、話して つたえる'] }
  ];

  // ---------- これから作れそうなもの（§AB-10）: 元になった学んだこと・単元と、バディの 1 行。数・おすすめ度は持たない ----------
  MPD.next = [
    { id: 'nx-lamp', title: ['明るさを変えられるランプ', '明るさを かえられる ランプ'], learned: ['ln-battery', 'ln-stars'], units: [],
      line: ['電池の数で明るさが変わるなら、つまみで変えられるかも', 'でんちの 数で 明るさが かわるなら、つまみで かえられるかも'] },
    { id: 'nx-evac-game', title: ['ひなん場所までの迷路ゲーム', 'ひなん ばしょまでの めいろゲーム'], learned: ['ln-maze-turn', 'ln-poster-map'], units: ['C4-B-03'],
      line: ['迷路の曲がり方で、ひなんの道すじをたどれそう', 'めいろの まがりかたで、ひなんの みちすじを たどれそう'] },
    { id: 'nx-weather-cal', title: ['雨と気温の天気カレンダー', '雨と きおんの 天気カレンダー'], learned: ['ln-rain-graph', 'ln-leaf-sun'], units: ['S4-B-04'],
      line: ['雨の量のグラフに、葉の色の変わり方も書きこめそう', '雨の りょうの グラフに、葉の 色の かわりかたも 書きこめそう'] },
    { id: 'nx-tower-box', title: ['ダンボールで作る塔の模型', 'ダンボールで つくる とうの もけい'], learned: ['ln-cuboid', 'ln-box-net'], units: ['M4-B-02'],
      line: ['マイクラの塔を、展開図から箱にして立てられそう', 'マイクラの とうを、てんかい図から はこに して 立てられそう'] },
    { id: 'nx-moon-haiku', title: ['月と季節の俳句カード', '月と きせつの はいくカード'], learned: ['ln-moon-shape', 'ln-leaf-haiku'], units: [],
      line: ['月の形の写真に、季節の言葉をそえられそう', '月の 形の 写真に、きせつの ことばを そえられそう'] }
  ];

  // ---------- 引く ----------
  function findBy(list, k, v) { for (var i = 0; i < list.length; i++) if (list[i][k] === v) return list[i]; return null; }
  MPD.unit = function (code) { return findBy(MPD.units, 'code', code); };
  MPD.extUnit = function (code) { return findBy(MPD.extUnits, 'code', code); };
  MPD.anyUnit = function (code) { return MPD.unit(code) || MPD.extUnit(code); };
  MPD.area = function (id) { return findBy(MPD.areas, 'id', id); };
  MPD.learnedDef = function (id) { return findBy(MPD.learned, 'id', id); };
  MPD.pastDef = function (id) { return findBy(MPD.past, 'id', id); };
  MPD.nextDef = function (id) { return findBy(MPD.next, 'id', id); };
  MPD.allUnits = function () { return MPD.units.concat(MPD.extUnits); };
  MPD.subject = function (id) { return findBy(MPD.subjects, 'id', id); };
  // 島（教科 × 領域）の並び: 教科の順 → 領域の順。units = その領域の単元（data の順）
  MPD.islands = function () {
    var all = MPD.allUnits(), areas = MPD.areas.concat(MPD.otherAreas), out = [];
    MPD.subjects.forEach(function (sj) {
      areas.forEach(function (a) {
        if (a.sub !== sj.id) return;
        out.push({ id: sj.id + ':' + a.id, sub: sj.id, area: a.id, subject: sj.name, name: a.name,
          units: all.filter(function (u) { return u.sub === sj.id && u.area === a.id; }).map(function (u) { return u.code; }) });
      });
    });
    return out;
  };
  MPD.areaOf = function (u) { return u ? findBy(MPD.areas.concat(MPD.otherAreas), 'id', u.area) : null; };
  MPD.itemProgress = function (progress, itemId) {
    var v = progress && progress[itemId];
    return { practice: v && typeof v.practice === 'string' ? v.practice : null, explain: v && typeof v.explain === 'string' ? v.explain : null };
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = MPD;
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
