/* サポーターの画面の正準データと文言（verbatim — docs/plans/supporter-view/contract-AD.md §AD-13。実装担当はここを書き換えない）
   架空。人物名は はると / 田中さん + 教室の一覧だけに出る 4 人（あおい・そうた・みお・れん）。
   日付は 10/5〜11/2（月水金A の登校日）。data.js / self-data.js / make-data.js と矛盾させない。
   文言は 1 通り（大人向け。表示モードで変えない）。{sup} = サポーターの名前、{child} = 子どもの名前。 */
(function (root) {
  'use strict';
  var DES = root.DES = root.DES || {};
  var SD = {
    supporter: { id: 'tanaka', name: '田中さん', initial: '田' },

    // 教室の一覧（名前の順）。live:true の子は実データから作る（SUP.childRow）
    children: [
      { id: 'aoi', name: 'あおい', mode: 'js', now: '漫画づくり大会 10:00〜10:50', next: 'サークル対話 10:50〜', consult: null, checks: [] },
      { id: 'sota', name: 'そうた', mode: 'es', now: 'レゴ 10:00〜10:50', next: 'サークル対話 10:50〜', consult: 'レゴのつづき、どこにおいたかわからない', checks: ['相談が来ている'] },
      { id: 'haruto', live: true },
      { id: 'mio', name: 'みお', mode: 'es', now: 'iPad 絵 10:00〜10:40', next: 'サークル対話 10:50〜', consult: null, checks: ['午後の予定を決めていない'] },
      { id: 'ren', name: 'れん', mode: 'js', now: 'Unity 10:00〜10:50', next: 'サークル対話 10:50〜', consult: null, checks: ['3D プリンターを使いたい（人が確かめる）'] }
    ],

    // 5 観点の見出し（サポーター向けの語。並びは DES.selfData.axes の id の順）
    axisHead: { int: '関心', ori: '志向性', exp: '体験', psy: '心理面の手がかり', mas: '習熟' },

    // 人が確かめること（はると）
    checks: [
      '3D プリンター: 使う前に{sup}と使い方を確かめる（バディが「近いかもしれない」と出している）',
      '作品を教室の外に見せる時は、{sup}が中身を確かめる'
    ],

    // 手伝いの移り変わり — 過去 4 週（固定）。今週（11/2 の週）は実データから数える
    // own = 自分で / cue = {sup}のきっかけあり / by = {sup}が代わりに
    weeks: [
      { key: '10/5', label: '10/5 の週', days: ['10/5', '10/7', '10/9'],
        scenes: { plan: { own: 1, cue: 1, by: 4 }, talk: { own: 1, cue: 2, by: 3 }, make: { own: 1, cue: 1, by: 3 } } },
      { key: '10/12', label: '10/12 の週', days: ['10/12', '10/14', '10/16'],
        scenes: { plan: { own: 2, cue: 1, by: 3 }, talk: { own: 2, cue: 2, by: 2 }, make: { own: 2, cue: 1, by: 3 } } },
      { key: '10/19', label: '10/19 の週', days: ['10/19', '10/21', '10/23'],
        scenes: { plan: { own: 2, cue: 2, by: 2 }, talk: { own: 3, cue: 2, by: 1 }, make: { own: 3, cue: 1, by: 2 } } },
      { key: '10/26', label: '10/26 の週', days: ['10/26', '10/28', '10/30'],
        scenes: { plan: { own: 4, cue: 1, by: 1 }, talk: { own: 5, cue: 1, by: 1 }, make: { own: 4, cue: 1, by: 1 } } }
    ],
    thisWeek: { key: '11/2', label: '今週', days: ['11/2', '11/4', '11/6'] },
    scenes: [
      { id: 'plan', label: '予定を決める' },
      { id: 'talk', label: 'バディに話す' },
      { id: 'make', label: '作る' }
    ],

    // 足場かけの記録の seed（過去の日。10/26 の週の「代わりに」と数が合う）
    log: [
      { id: 'sl-6', day: '10/30', time: '10:15', scene: 'make', how: 'hands', text: '「アクセサリー作り」: 最初の 3 つのビーズを一緒に通した', ref: {} },
      { id: 'sl-5', day: '10/30', time: '10:05', scene: 'talk', how: 'voice', text: '今日は形だけ決める？', ref: {} },
      { id: 'sl-4', day: '10/30', time: '10:02', scene: 'join', how: 'in', text: 'はるとの画面に入った', ref: {} },
      { id: 'sl-3', day: '10/28', time: '10:20', scene: 'talk', how: 'proxy', text: 'どれにするか決められない', ref: {} },
      { id: 'sl-2', day: '10/28', time: '10:10', scene: 'plan', how: 'hands', text: '10:10 に「アクセサリー作り」を入れた', ref: {} },
      { id: 'sl-1', day: '10/28', time: '10:08', scene: 'join', how: 'in', text: 'はるとの画面に入った', ref: {} }
    ],

    // 助言 → バディが試す（seed 2 件。mine:true = {sup}が書いた）
    advice: [
      { id: 'ad-2', day: '11/2', time: '10:14', mine: true, state: 'waiting', scene: 'make',
        aim: 'Python は、見本を動かして数字を 1 つ変えるところから入る',
        basis: '10/30 に見本を少し動かしていた。最初から自分で書くより、動くものの数字を変えるところからのほうが入りやすそう',
        stages: {
          view: '10/30 の見本では、数字を自分で変えて試していた。見本から入る案は、本人の「やってみたい」と合いそう。別の説明: 自分で一から書きたい気持ちがあるかもしれないので、始める前に聞く',
          trial: '14:15 の枠が予定に入ったら、見本のゲームを動かすところから提案する。見るのは、数字を変えたあとに自分から次を試すか',
          result: null,
          update: null
        } },
      { id: 'ad-1', day: '10/28', time: '11:20', mine: true, state: 'tried', scene: 'make',
        aim: '決めることを 1 つずつにする',
        basis: '10/28 アクセサリー作りで、形・色・長さを一度に考えて手が止まっていた。本人「どれにするか決められない」',
        stages: {
          view: '決めることが一度に多いと止まりやすいのかもしれない。別の説明: その日は時間が足りなかっただけの可能性もある。助言はそのまま試す',
          trial: '10/30 アクセサリー作りの始めに「今日は形だけ決める？」と 1 つだけ聞いた。見るのは、並びを最後まで作れるか',
          result: '本人「形だけならできる」。ビーズの並びを最後まで作った。色とひもの長さは次に回した。最初の 3 つは{sup}と一緒に通した',
          update: '続ける。1 回の反応なので決めつけない。次は色を決める場面で同じやり方を試す。合わなければ見立てを取り下げる'
        } }
    ],

    // 保護者レポートの下書き（固定の項目。sec: talk / did / learn / change / next。src: own = 本人の言葉 / record = 記録）
    report: {
      span: ['10/26', '11/2'],
      sections: [
        { id: 'talk', head: '話していたこと' },
        { id: 'did', head: '実際に取り組んだこと' },
        { id: 'learn', head: '学びの手がかり' },
        { id: 'change', head: '関心や変化' },
        { id: 'own', head: '自分で進めたこと' },
        { id: 'next', head: '次につながること（これから）' }
      ],
      items: [
        { id: 'r-t1', sec: 'talk', src: 'own', text: '建築が午前で終わりそうにないと話し、午後は別のこと（アクセサリー作りの続きと、新しいこと）をしたいと自分から言いました' },
        { id: 'r-t2', sec: 'talk', src: 'own', text: '「Python のゲーム作りやってみたい」と話しました' },
        { id: 'r-d1', sec: 'did', src: 'record', text: 'マイクラの建築: 駅を大きく作っています。10/26 には屋根を 3 回作り直して、斜めの屋根にしました' },
        { id: 'r-d2', sec: 'did', src: 'record', text: 'アクセサリー作り: 10/28 は形・色・長さを一度に考えて手が止まりましたが、10/30 は形だけ先に決めて、ビーズの並びを最後まで作りました' },
        { id: 'r-l1', sec: 'learn', src: 'record', text: '斜めの屋根を、見本なしで組めました（自分で）' },
        { id: 'r-l2', sec: 'learn', src: 'record', text: 'ビーズを左右同じ並びで通せました（{sup}と最初の 3 つを一緒に通してから）' },
        { id: 'r-c1', sec: 'change', src: 'record', text: '建築は 10/19 から 4 回続いています。アクセサリー作りは 10/28・10/30 に取り組み、今日も予定に入っています。Python は 11/2 に本人が「やってみたい」と話しました' },
        { id: 'r-c2', sec: 'change', src: 'record', text: '決めることを 1 つずつにすると進めやすい場面がありました（10/30 アクセサリー作り）。1 回の様子なので、続けて見ていきます' },
        { id: 'r-n1', sec: 'next', src: 'record', text: 'アクセサリー作りは、次に色とひもの長さを決めます' }
      ]
    },

    // 文言（サポーター画面・帯・入力のしかた）
    text: {
      // シェル
      crumb: 'サポーター', nav_class: '教室', role_label: 'サポーター', not_found: '見つからなかったよ',
      // 帯
      band_label: '一緒に入っている',
      band_in: '{sup}が {child}の画面に入っている',
      band_note: '予定・会話・作る・作品・お題 でしたことは 足場かけの記録 に残る',
      band_self: 'ここは {child}が自分で書くところ。入っている間は見るだけ',
      band_sup: '{child}の画面に入ったまま',
      band_log: '記録を見る', band_back: '{child}の画面に戻る', band_leave: '出る',
      left_toast: '出たよ。入っている間のことは 足場かけの記録 に残っている',
      join: '一緒に入る',
      // 入力のしかた
      stance_label: '入力のしかた',
      stance_proxy: '{child}の言葉を代わりに入力', stance_voice: '{sup}として話す', stance_idea: 'アイデアを出す',
      ph_proxy: '{child}が言ったことを、そのまま書く', ph_voice: '{child}に伝えたいことを書く', ph_idea: 'こんなの作ってみてもいいのでは？ を書く',
      withdraw: '取り下げる', withdrawn_toast: '取り下げた', undo: '元に戻す',
      // 記録の文（observe）
      log_in: '{child}の画面に入った', log_out: '{child}の画面から出た',
      log_hide: '「{title}」を非表示にした', log_show: '「{title}」を表示に戻した',
      log_act: '「{title}」を作り始めた', log_chg: '「{title}」: {what}',
      log_work: '「{title}」を作品に残した', log_share: '「{title}」を見せる設定にした', log_found: 'お題で見つけたものを残した', log_say: '「{title}」で: {text}',
      log_note_add: '{axis}に観察を足した', log_note_edit: '{axis}の観察を直した', log_note_del: '{axis}の観察を消した',
      log_advice_add: '助言を共有した: {aim}', log_advice_edit: '助言を直した: {aim}', log_advice_withdraw: '助言を取り下げた: {aim}', log_advice_back: '助言を戻した: {aim}',
      log_idea_withdraw: 'アイデアを取り下げた: {text}', log_idea_back: 'アイデアを戻した: {text}',
      log_report_checked: 'レポートを確かめた', log_report_sent: 'レポートを送ったことにした（体験例）', log_report_draft: 'レポートを下書きに戻した',
      // 教室の一覧
      class_h: '教室',
      class_sub: '{date}・{group}。今していることと、確認が要ることを並べている。並びは名前の順で、比べるための並びではない',
      col_now: '今', col_next: '次', col_consult: '相談', col_check: '確認',
      now_gap: '予定の合間', next_none: '今日の予定はここまで', consult_none: '相談は来ていない',
      chk_proposed: '提案中の予定がある', chk_idea: 'アイデアに返事待ち', chk_joined: 'いま入っている',
      open: '開く', only_child: 'このモックで開けるのは {child}だけ',
      mode_js: '中学生向け', mode_es: '小学生向け',
      // 個別
      back_class: '← 教室', kid_sub: '{mode}の表示・{date}',
      tab_today: '今日', tab_clues: '手がかり', tab_advice: '助言', tab_log: '足場かけの記録', tab_report: 'レポート', tabs_label: '{child}の画面',
      // 今日
      td_plan_h: '今日の予定', td_plan_note: '直すときは、一緒に入って予定表で',
      td_words_h: '本人の言葉', td_words_none: '今日の発言は、ここに出る', td_all_talk: '会話を全部見る', talk_dialog_h: '{child}とバディの会話（{date}）', close: '閉じる',
      td_prop_h: 'バディの提案', td_prop_none: '今日の提案は、ここに出る',
      st_proposed: '提案中', st_chosen: '本人が選んだ', st_held: '保留', st_declined: '見送り', st_removed: '予定から外した', st_finished: '終わった',
      td_idea_h: 'アイデアを出す',
      td_idea_sub: 'ここに書くと、{child}の 話す に {sup}の発言として出る。バディが受けて、{child}が選ぶ',
      td_idea_send: '話すに出す', td_idea_sent: '話すに出した', td_idea_none: '出したアイデアは、ここに並ぶ',
      mk_idea_frame: '{sup}のアイデア', idea_open: '返事待ち', idea_later: 'あとで考える', idea_made: '作るで試している', idea_planned: '予定に入っている', idea_withdrawn: '取り下げた',
      td_check_h: '人が確かめること',
      // 手がかり
      cl_sub: '本人の言葉・記録・バディの見立て・まだ分からないこと を分けて並べている。見立ては決めつけない',
      cl_note: '気持ちの見立ては、おうちの人へのレポートに入れない',
      cl_basis: '手がかり', cl_more: 'ほか {n} 件', cl_obs: '{sup}の観察', cl_obs_add: '観察を足す', cl_obs_ph: '見たこと・聞いたことを、そのまま書く',
      cl_fixed: '本人が直した', cl_was_ai: 'もとはバディの見立て', cl_agreed: '本人が「合ってる」と返した', cl_away: '本人が「今はちがう」と返した',
      save: '残す', cancel: 'やめる', edit: '直す', remove: '消す', removed_toast: '消した', saved_toast: '残した',
      src_own: '本人の言葉', src_record: '記録', src_ai: 'バディの見立て', src_gap: 'まだ分からない',
      // 助言
      ad_sub: '助言は命令ではなく、バディの見立ての材料になる。そのまま試すとは限らない。1 回の反応で決めつけない',
      ad_form_h: '助言を書く', ad_aim: 'ねらい', ad_basis: 'そう考えた根拠', ad_scene: '試せそうな場面',
      ad_scene_none: '決めていない', ad_scene_talk: '話す', ad_scene_plan: '予定を決める', ad_scene_make: '作る', ad_scene_today: '今日のお題',
      ad_send: '助言を共有する', ad_sent: '助言を共有した', ad_list_h: '助言と、バディが試したこと',
      ad_s1: '観察と助言', ad_s2: 'バディの見立て', ad_s3: '小さな試行', ad_s4: '反応と結果', ad_s5: '仮説の更新',
      ad_e2: 'バディはこれから見る', ad_e3: '試す場面を待っている', ad_e4: '試していない', ad_e5: '結果が出てから',
      ad_st_new: 'これから見る', ad_st_waiting: '機会を待っている', ad_st_adjusted: '方法を調整した', ad_st_tried: '試した', ad_st_pending: '結果を待っている', ad_st_withdrawn: '取り下げた',
      ad_see_view: 'バディの見立てを見る', sample_note: '応答はサンプル', ad_back: '戻す',
      advice_view: '受け取った。{scene}の場面で、本人の様子を見て試すか決める。そのまま試すとは限らない。別の説明が合いそうなら、方法を変える',
      advice_view_any: '受け取った。合いそうな場面で、本人の様子を見て試すか決める。そのまま試すとは限らない。別の説明が合いそうなら、方法を変える',
      // 足場かけの記録
      fd_h: '手伝いの移り変わり',
      fd_sub1: '場面ごとに、自分で進めたこと・{sup}のきっかけがあったこと・{sup}が代わりにしたこと を週で並べている。',
      fd_sub2: '数えているのは画面に残ったことだけで、声かけや見守りは入っていない。今週は今日までの分。手伝いが多い週が、よくない週というわけではない（新しいことを始めた週は増える）。',
      fd_own: '自分で', fd_cue: '{sup}のきっかけ', fd_by: '{sup}が代わりに', fd_legend: '四角の見方',
      fd_count: '{n} 回のうち 自分で {own}', fd_zero: '記録なし', fd_more: 'ほか {n}',
      fd_aria: '{week}: {n} 回のうち 自分で {own}、きっかけあり {cue}、代わりに {by}',
      fade_none: '{label}: 今週の記録はこれから',
      fade_up: '{label}: {w0}は {n0} 回のうち自分で {o0} 回。今週は {n1} 回のうち {o1} 回。自分で進める割合が上がっている',
      fade_flat: '{label}: {w0}は {n0} 回のうち自分で {o0} 回。今週は {n1} 回のうち {o1} 回。{sup}と一緒に進めている',
      how_h: 'どんな手伝いをしたか（今週）',
      how_proxy: '代わりに入力', how_hands: '代わりに操作', how_voice: '{sup}として話す', how_idea: 'アイデア', how_in: '入った', how_out: '出た', how_desk: 'サポーター画面で',
      how_note: '振り返りの材料で、多い少ないを比べるためのものではない',
      lg_h: '記録', lg_filter_label: '記録の絞り込み',
      lg_f_all: 'ぜんぶ', lg_f_plan: '予定', lg_f_talk: '話す', lg_f_make: '作る', lg_f_other: 'そのほか',
      lg_empty: '{filter}の記録は、ここに出る', lg_today: '今日', lg_see_talk: '会話で見る',
      lg_older: '10/26 より前は、このモックでは週ごとの数だけを入れている',
      sc_plan: '予定', sc_talk: '話す', sc_make: '作る', sc_works: '作品', sc_today: '今日のお題', sc_join: '一緒に入る', sc_advice: '助言', sc_note: '観察', sc_report: 'レポート',
      // レポート
      rp_sub: 'おうちの人に届ける 1 週間のまとめの下書き。直す・載せない・補足する ができる。送る前に{sup}が確かめる',
      rp_rule1: '予定だけのことは「これから」に分ける', rp_rule2: '気持ちの見立ては入れない', rp_rule3: 'ほかの子のことは入れない',
      rp_span: '{from}〜{to}', rp_st_draft: '下書き', rp_st_checked: '確かめた', rp_st_sent: '送った',
      rp_src_own: '本人の言葉', rp_src_record: '記録', rp_src_calc: '記録から', rp_edited: '{sup}が直した', rp_off_chip: '載せない',
      rp_edit: '直す', rp_restore: '元の文に戻す', rp_off: '載せない', rp_on: '載せる',
      rp_extra: '補足', rp_extra_ph: 'おうちの人に伝えたいことがあれば書く',
      rp_preview: 'おうちの人に届く形を見る', rp_preview_h: '{child}の 1 週間（{from}〜{to}）', rp_from: '{sup}より',
      rp_check: '確かめた', rp_send: '送る', rp_send_note: 'このモックでは送られない', rp_sent_toast: '送ったことにした（体験例）',
      rp_sent_line: '{at} に送った（体験例）', rp_to_draft: '下書きに戻す', rp_locked: '送ったあとは、下書きに戻してから直す', rp_need_one: '載せる項目を 1 つ以上選ぶ',
      rp_next_proposed: '{start}〜 {title}（提案中）',
      rp_own_up: '{label}では、自分で進める割合が上がってきました（{w0}: {n0} 回のうち {o0} 回 → 今週: {n1} 回のうち {o1} 回）',
      rp_own_flat: '{label}は、{sup}と一緒に進めています（今週: {n1} 回のうち自分で {o1} 回）',
      rp_own_note: '画面に残ったことだけを数えています。声かけや見守りは入っていません'
    }
  };
  DES.supData = SD;
  if (typeof module !== 'undefined' && module.exports) module.exports = SD;
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
