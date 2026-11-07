# モック app-v3 の棚卸し（2026-11-08・機械生成。各モジュールの読み取り結果の要約）

正本: 保存済みモック `app-v3/`（origin/main 6da3fbf）。本実装の対応表は `mapping.md`、設計は `contract-LS.md`。

## app

### ルート

| hash | 画面 |
| - | - |
| `#talk（空 hash・未知 hash も talk）` | DES.talk.renderPage(main, rebuild)。topbar の plan-toggle は xl/l で des3.panel を切替、m/s で #plan-dialog を開く |
| `#plan` | DES.plan.renderPage(main)。crumb 「今日の予定」、plan-toggle が 「話すに戻る」(back_talk) に変わる。tabbar は talk を active |
| `#make / #make/<id>（前方一致）` | DES.make.render(main, routeArg)。plan-toggle は全幅で #plan-dialog を drawer として開閉 (DES.ui.planOpen) |
| `#works / #works/<id>` | DES.works.render(main, routeArg) |
| `#gallery / #gallery/<id>` | DES.gallery.render(main, routeArg)。NAV 8 項目目として sidebar に出る (tabbar には無い) |
| `#today / #today/<id>` | DES.today.render(main, routeArg)。tabbar ラベルは today_tab 「お題」 |
| `#map / #map/<arg>` | DES.map.render(main, routeArg)。nav-rail (§AC-7) は全ページ共通だがここが起点 |
| `#self` | DES.self.render(main)。サポーターが入っている間 (is-joined) は #main に inert |
| `#trail` | DES.trail.render(main) |
| `#paused` | DES.make.pausedAct() なら DES.make.renderPaused、無ければ DES.talk.renderPaused。crumb は done_today 「今日はここまで」 |
| `#sup / #sup/<arg>` | DES.sup.render(main, routeArg, rebuild)。sidebar/topbar がサポーター版 (fillSupSidebar / renderSupTopbar)、tabbar hidden、html.is-sup |
| `(到達不能) 上記以外` | APP.render の else 分岐 .empty-line not_yet 「ここはまだ作っていないよ。話す か 今日の予定 を使ってね」。route() が未知 hash を talk に落とすため実際には出ない |

### 操作（data-action など 21 件）

- `nav (data-route=talk|make|works|gallery|today|self|map|trail; data-arg=tab は下タブ)` — sidebar .nav / #nav-drawer 内 / .tabbar → closeMenu(false) → location.hash を変える。onHash が走り closeTransient・render・scrollTo(0,0)（保存: 直接なし（onHash が talk を離れる時 des3.draft.scroll を save('draft')））
- `resume (data-arg=side|top)` — sidebar .resume-mini / topbar .top-link → DES.make.resumeTarget() があれば DES.make.openAct(mk)（作業台へ）。無ければ DES.ui.restoreScroll=true で #talk へ（talk 上なら draft.scroll へ scrollTo）（保存: なし）
- `settings (data-arg=side|top)` — sidebar .profile の sliders ボタン / topbar .top-link / drawer 内 → closeMenu → APP.openMode(opener) で #mode-dialog を showModal（drawer から開いた時は menu-open ボタンへ戻す）（保存: なし）
- `mode-ok` — #mode-dialog .dialog-footer 「この表示にする」 → 選択 radio を読み closeDialog → 変わっていれば APP.change で DES.state.mode='js'|'es' → html[data-mode] 更新・全 re-render（保存: des3.mode（save() は全 KEYS を書く））
- `dialog-close` — 任意 dialog（#mode-dialog 「やめる」、row-sheet 等） → el.closest('dialog') を APP.closeDialog → afterClose で _returnKey の要素へフォーカス復帰（保存: なし）
- `reset` — sidebar .reset-link 「はじめの状態に戻す」（≤950 は CSS で非表示、≤700 drawer 内で表示） → DES.store.reset(): localStorage の des3.* 接頭辞キーを全削除 → hash=#talk → location.reload()（保存: des3.* 全削除（他モジュールの des3.self / mapUi / sup / gallery / trail）
- `role (data-arg=child|sup)` — .preview-bar .role-tabs（素材運用 / 設計を見る は disabled） → sup: route が sup でない or routeArg ありなら hash=#sup。child: DES.sup.isJoined() なら DES.sup.leave('#talk')、sup 上なら hash=#talk（保存: なし（leave は sup.js 側で des3.sup を書く））
- `nav-toggle` — sidebar .sb-top の .nav-toggle（≥951 のみ。aria-expanded / aria-controls=sidebar） → APP.change で DES.state.ui={nav: rail?'open':'rail'} → html.nav-rail 切替、同ボタンへフォーカス保持 (sel)（保存: des3.ui）
- `plan-toggle` — topbar .top-link.plan-toggle（#plan では .back-talk） → #plan→hash=#talk / #make→DES.ui.planOpen で #plan-dialog 開閉 / talk 以外→ xl,l は st.panel='open' + save('panel') 後 hash=#talk、m,s は DES.ui.openPlanAfterNav=true 後 h（保存: des3.panel（xl/l のみ。m/s は dialog の一時状態で書かない））
- `panel-close` — plan-panel 内の閉じるボタン（描画は plan.js、handler は app.js） → #plan-dialog 内なら closeDialog、そうでなければ APP.change で state.panel='closed'（フォーカスは plan-toggle へ）（保存: des3.panel）
- `goto-plan` — plan-panel 「広く見る →」（描画は plan.js） → closePlanDialog → hash=#plan（保存: なし）
- `menu-open (data-arg=tab は下タブ「もっと」)` — topbar hamburger (≤700) / .tabbar 5 つ目 → openMenu: #nav-drawer に aside.sidebar を生成し fillSidebar → showModal、.mobile-close へフォーカス（保存: なし）
- `menu-close` — #nav-drawer 内 .mobile-close × → closeMenu(true) → drawer close、開いたボタンへフォーカス復帰（保存: なし）
- `toast-act` — #toast .toast-btn（戻す / 元に戻す 等） → 保持した toastFn を実行し toastHide。トーストは plan/make/works/today/gallery/sup の dialog が開いていればその内側へ reparent (placeToast)（保存: fn 次第（他モジュール））
- `sup-nav（描画のみ app.js。handler は sup.js:331）` — サポーター sidebar .nav（教室 / はると） → sup.js の go(data-arg) で hash 変更（保存: なし）
- `（委譲）document click` — document 全体 → [data-action] を closest で拾い DES.actions[name](el, e)。row-menu 外クリックで DES.ui.menu=null、dialog.row-sheet 内の操作は dialog-close 以外で自動 close + opener へフォーカス、<a data-ac（保存: —）
- `（キーボード）Escape` — document keydown → DES.ui.menu → 閉じて row-menu[data-id] へフォーカス / DES.ui.edit → 閉じて row-menu へ / DES.ui.goalEdit → 閉じて data-fk=goal:<id> へ。dialog の cancel は preventDefault して APP.cl（保存: なし）
- `（マウス）dialog backdrop クリック` — 全 <dialog> → e.target===dlg かつ矩形外なら APP.closeDialog（保存: なし）
- `（イベント）hashchange → onHash` — window → talk を離れる時 draft.scroll 保存 / paused を離れる時 DES.make.clearPaused / paused に入り act 無しなら DES.make.noteTalkStop / closeTransient（10 dialog close + 各モジュール resetUi）/ r（保存: des3.draft（save('draft')、失敗時 saveFailed））
- `（イベント）resize → onResize` — window → 幅が変われば plan-dialog / nav-drawer / row-sheet / pick-sheet を閉じる。breakpoint が変われば DES.ui.menu=null + render（保存: なし）
- `（ドラッグ）` — app.js には無い → DnD は DES.plan.initDnD()（init で呼ぶだけ）（保存: —）

### ダイアログ・シート

- #mode-dialog — dialog.mode-dialog[aria-labelledby=mode-h]（表示を選ぶ。中身は openMode が都度生成）
- #plan-dialog — dialog.plan-dialog.plan-drawer.plan-sheet（右 drawer 340px / ≤700 上シート。中身 aside.plan-panel を DES.plan.renderPanel(ctx:'dialog')）
- #nav-drawer — dialog.nav-drawer（≤700 左メニュー。aside.sidebar を fillSidebar で生成）
- #row-sheet — dialog.row-sheet（plan.js 所有。app.js の click 委譲が操作後に自動 close）
- #pick-sheet — dialog.pick-sheet（plan.js 所有。closeTransient / onResize で閉じる）
- #make-dialog — dialog.make-dialog（make.js 所有。closeTransient・placeToast 対象）
- #works-dialog — dialog.make-dialog.works-dialog
- #today-dialog — dialog.make-dialog.today-dialog
- #gallery-dialog — dialog.make-dialog.gallery-dialog
- #sup-dialog — dialog.make-dialog.sup-dialog
- #self-sheet — dialog.self-sheet[aria-labelledby=self-sheet-h]（index.html にあるが app.js の closeTransient / placeToast / onResize のリストに無い）
- #toast — div.toast[role=status][aria-live=polite][hidden]（dialog ではないが開いている dialog の内側へ移動する）
- #join-band — section.join-band[hidden]（sup.js renderBand が描く帯。app.js は render で呼ぶだけ）

### 状態

- **保存済み**: topbar .save-indicator 緑ドット + 「このブラウザに保存」(saved)。≤700 は CSS で display:none
- **保存失敗**: DES.state.saveFailed=true → .save-indicator.fail（muted・ドット無し）「このブラウザに保存できない」(save_fail)。発生源: store.load の JSON parse 失敗 / store.save の setItem 失敗 / plan-toggle・onHash の部分 save 失敗。APP.renderSaveState() で topbar だけ描き直す
- **左メニュー閉（rail）**: des3.ui.nav==='rail' → html.nav-rail、sidebar 76px のアイコン列、.nav-toggle の aria-expanded=false・ラベル 「メニューを開く」(nav_rail_open)。≤950 はボタン非表示。「はじめの状態に戻す」で open に戻る（§AC-7 verbatim）
- **予定パネル open / closed（xl・l）**: des3.panel。.top-link.plan-toggle[aria-pressed=true] は bg #fae8ce・色 #6f430b
- **予定 dialog open（m・s、または #make 全幅）**: DES.ui.planOpen=true、#plan-dialog showModal、トーストが dialog 内へ移動、閉じると planOpen=false・seen.dialog=null・menu=null・topbar 再描画
- **表示モード es**: html[data-mode=es] font-size 15px、nav の 作品 / 学びマップ / 今日のお題 は RUBY の固定 HTML（DES.tNavHTML）、profile 下に 「小学生向けの表示」(mode_view_es)
- **サポーター画面**: route sup → html.is-sup、sidebar/topbar がサポーター版（教室 / 田中さん）、tabbar hidden、role-tabs の サポーター が active
- **一緒に入っている（joined）**: DES.sup.isJoined() → html.is-joined（sup.css で紫の外周枠）、role-tabs サポーター active、#self では #main に inert、render key に in/out を含めて作り直す
- **今日はここまで（paused）**: crumb に 「今日はここまで」(done_today)、本文は make か talk の renderPaused
- **行の退場中（leaving）**: APP.change(fn,{leave:id}) で .row[data-id] に .leave を付け 200ms 後に fn+commit。DES.ui.leaving=true、syncMenuDom は render を避け DOM から row-menu を外す。reduced-motion では即時
- **トースト表示**: .toast.visible（2600ms、ボタン付きは 5000ms）→ 220ms 後 hidden。ボタンは期限後 DOM から外す
- **体験モックの帯**: .preview-bar 「体験モック · 架空のデータ」(preview) 常時表示。role-tabs の 素材運用 / 設計を見る は disabled
- **空状態（未実装ルート）**: .empty-line 「ここはまだ作っていないよ。話す か 今日の予定 を使ってね」(not_yet)。現行 route() では到達しない
- **入力中・送信中・読み取り専用**: app.js には無い（DES.ui.sending は init で初期化するだけで talk.js が使う。読み取り専用は joined 時の #self inert のみ）

### 架空のまま出してはいけないもの

- sidebar .resume-mini の 「バディとの会話」/「Python のゲーム作りやってみたい」（DES.data.resume フォールバック）— 実の最後の活動から導くか、無ければ出さない
- profile の 「はると」/ avatar 「は」— 実学習者
- サポーター sidebar / topbar の 「田中さん」/「田」— 実サポーター
- store.js defaults() が des3.plan / des3.goals に見本の 1 日（p1〜p7）と 「Python のゲーム作りやってみたい」(src own, date 11-02) を書き込む初期化 — 実の初期状態は空か実保存
- i18n share_note に直書きの 「田中さん」— 実サポーター名の差し込みに
- 「このブラウザに保存」/「このブラウザに保存できない」の save-indicator 文言と意味 — サーバ保存の 保存中 / 保存済み / 失敗 / オフライン を表す面に置き換える（≤700 で非表示にしている点も見直し）
- 「はじめの状態に戻す」= des3.* 全削除 + reload — 実データを消す導線にしない（確認必須 action の既定設計に該当）
- preview-bar の 「体験モック · 架空のデータ」帯と、クリックで 子ども ⇄ サポーター を切り替える role-tabs — 本実装では認証に基づく役割。帯を消すと calc(100vh - 40px) 系の高さ計算がずれる
- データ日付 2026-11-02 / now 10:20（data.js）に依存した見本の進み具合（他モジュール経由）

### 見本として残せるもの

- ICONS の固定 SVG（nav 7+1 種・補助アイコン。§F verbatim）
- i18n T 表の nav / mode / shell ラベル（talk・make・…・nav_rail_open 等）と RUBY 3 件（share_note を除く）
- brand 「DE-SCHOOL」/「バディと、学ぶ。」/ crumb 「バディエージェント」
- #mode-dialog の 「表示を選ぶ」「中学生向け / 小学生向け」「この表示にする / やめる」
- not_yet 「ここはまだ作っていないよ。話す か 今日の予定 を使ってね」（本当に未実装のルートがあるなら）
- shell.css の codex 移植値・breakpoint（1120 / 950 / 700）・nav-rail 76px・tabbar 56px

## talk

### ルート

| hash | 画面 |
| - | - |
| `#talk（空 hash・未知 hash も talk に落ちる。app.js route()）` | TK.renderPage(main, rebuild): .talk-layout = .chat-page（welcome → #message-list → .chat-bridge → .composer → .privacy-line → .chat-done）+ aside#plan-panel（DES.plan.renderPanel）。rebuild は route\|arg\|mode\|joined が変わった時だけ |
| `#paused（.chat-done の a[href="#paused"] から）` | TK.renderPaused(main): .paused = DES.buddy(56,'neutral') + h1 paused_h + p paused_p + .btn.primary[data-action=resume]。ただし app.js:455 が DES.make.pausedAct() 真なら DES.make.renderPaused を優先（#paused は make と共有） |

### 操作（data-action など 14 件）

- `send（data-action=send / #send-btn、および #composer で Ctrl/Cmd+Enter・isComposing 中は無視）` — #talk .composer → 空白のみなら何もしない。サポーター同席で stance=voice/idea なら DES.sup.voice / DES.sup.postIdea へ委譲（バディ規則を通さない）。通常: ui.sending=true → textarea クリア → child メッセージ push（同席中は by 付与）→ 15（保存: des3.talk（child+buddy 行）/ des3.draft（text:''）/ des3.plan（規則 ）
- `input（[data-ui=composer]）` — #talk .composer textarea#composer → 1 打鍵ごとに S().draft.text を更新し DES.store.save('draft')。失敗時 DES.app.renderSaveState()（save_fail 表示）。send ボタンの disabled を同期（TK.syncSend）（保存: des3.draft.text）
- `media（写真 / 音声の体験例 の 2 ボタン）` — #talk .composer-tools → トースト demo_media「このモックでは体験例だけ。本番では写真・音声入力が使える」だけ。.attachment も dialog も出さない（§G）（保存: なし）
- `bridge-make（.chat-bridge a.btn[href=#make]）` — #talk .chat-bridge → DES.make.fromTalk(): 直近の child 発言から題材を決定論で決め（§U-2）、仮の案 3 つの作業台を作って #make/<id> へ（保存: des3.activities（make.js 側））
- `（リンク）a[href=#paused] done_today` — #talk .chat-done → hash 遷移。app.js onHash が talk を離れる時に draft.scroll=window.scrollY を保存し、DES.make.noteTalkStop() で makeSide.lastStop='talk'（保存: des3.draft.scroll / des3.makeSide（app.js・make.js 側））
- `resume（#paused の .btn.primary。定義は app.js A['resume']）` — #paused / サイドバー .resume-mini / topbar → DES.make.resumeTarget() があれば作業台へ、無ければ #talk へ戻り des3.draft.scroll の位置へ scrollTo（保存: なし（読み取り: des3.draft.scroll, des3.makeSide））
- `accept / hold / decline（提案カード 3 ボタン。定義は plan.js act.*）` — #talk .message.buddy .proposal-card .actions → accept: proposed→mine、記録行 rec_add / rec_trial。hold: →held、記録行 rec_hold、カードは「保留」+「予定に入れる」。decline: 行を消し（占有解除）カードは「見送った」、記録行 rec_decline、トースト declined + undo 5 秒（（保存: des3.plan / des3.talk（record 行））
- `keep-tomorrow（keepCard。定義は plan.js act.keepTomorrow）` — #talk .proposal-card（規則 1 で空きが無い時の no_free カード） → catalogMarks[actId].tomorrow=true、トースト kept_tomorrow。再描画でカードは「明日にとっておいた」チップに変わりボタンが消える（保存: des3.catalogMarks）
- `idea-make / idea-plan / idea-later / idea-open / idea-withdraw（ideaCard。定義は sup.js）` — #talk .message.supporter .idea-card → サポーターのアイデアの状態遷移（open→made/planned/later/withdrawn）。表示は DES.sup.ideaView で行・活動の今の状態に追従。withdraw は同席中かつ open/later の時だけ head に出る（保存: des3.sup.ideas / des3.activities / des3.plan（sup.js・make.js・）
- `sup-stance（segmented .stance の 3 ボタン proxy/voice/idea。定義は sup.js）` — #talk .composer 上（サポーター同席中のみ描画） → DES.sup.setStance → TK.syncStance が placeholder（ph_proxy/ph_voice/ph_idea）と aria-pressed/active だけ差し替える（再描画しない）（保存: des3.sup.join.stance）
- `TK.prefill(title)（外部入口: plan.js grid-ask、map.js mp-talk / mp-talk-concept。today.js td-dtalk・self.js toTalk は同じ流れを自前実装）` — #plan グリッド / 学びマップ / お題 / 自己理解 → #talk composer → #plan-dialog を閉じ、draft 末尾に改行して「「{title}」をやってみたい」を足す（上書きしない）→ トースト prefilled → #talk でなければ ui.focusComposer=true で hash 遷移、app.js onHash が TK.focusComposer（texta（保存: des3.draft.text）
- `tr-talk（あしあと「会話で見る」。定義は trail.js）` — #trail → #talk → DES.ui.focusMsg=発言 id → renderPage がその .message に tabindex=-1 + .is-trail-focus を付け focus → 次タスクで scrollIntoView(center)。1 回だけ消費（§Z-4）（保存: なし）
- `TK.record(text)（表→会話の記録行。plan.js の全操作から rec() 経由）` — #talk .message.record（左寄せ・左 3px 緑・チップ「記録」+ 時刻 + 文） → who:'record' の行を push（同席中は by 付与・チップ by_with「{sup}と」）。コミットは呼び出し側（保存: des3.talk）
- `キーボード: Escape / ドラッグ` — #talk → talk.js 自身には Esc・ドラッグの処理なし（Esc は app.js の row-menu/edit/goalEdit、DnD は plan.js initDnD）。talk.js の bind は input（composer・goal-input）/ change（edit-start・edit-len）（保存: goal-input は ui.goalEdit.value、edit-* は ui.edit（plan の一時 UI ）

### ダイアログ・シート

- talk.js 自身が開く dialog は無し（§G「.attachment 行や dialog は出さない」どおり）
- #plan-dialog（dialog.plan-dialog.plan-drawer.plan-sheet、index.html:33）— TK.prefill が DES.app.closePlanDialog() で閉じる。≤950 では予定パネルの代わりに app.js がここへ DES.plan.renderPanel(ctx:'dialog')
- aside#plan-panel（.plan-panel、talk.js:277）— ≥951 で会話の右に inline 描画される非 dialog の aside
- #toast（div.toast[role=status][aria-live=polite]、index.html:31）— demo_media / prefilled / declined+undo / kept_tomorrow の表示先（dialog が開いていればその内側へ移動 app.js placeToast）

### 状態

- **空（会話 0 件）**: #message-list が空のまま welcome（welcome_h「今日は、何を話そう。」/ welcome_p「相談でも、ひとことでも。予定を見ながら話せるよ」）と composer だけ。モックでは DES.data.talk 6 件が常に先頭に連結されるため、この状態は実際には出ない（talk.js:16）
- **入力欄が空**: #send-btn disabled（§G「空は送れない（disabled）」）。placeholder composer_ph「話したいことを書く」/ es「話したいことを書いてね」。同席中は ph_proxy「{child}が言ったことを、そのまま書く」等に差し替え
- **入力中（下書きあり）**: 1 打鍵ごとに des3.draft.text へ保存。send 有効化。ルートを離れると draft.scroll も保存され、#paused → resume / 再訪で textarea と scroll が復元（R-8「composer の下書きと scroll 位置は des3.draft から復元」）
- **送信中**: ui.sending=true の 150ms 間 #send-btn disabled（§G「`sending` 中は送るボタン disabled（150ms）」）。child の bubble は即時反映、typing 表示などは無し
- **成功（返事あり）**: 150ms 後に .message.buddy（DES.buddy(30,'neutral') + 白 bubble）が追加。規則 0/1 では bubble 下に .proposal-card（--ai-soft 地・dashed --ai・DES.buddy(18,'think') + チップ ai_proposal「バディの提案」）。composer が scrollIntoView(nearest)
- **提案カードの状態（R-7 verbatim）**: proposed = 予定に入れる / あとで / 違う の 3 ボタン（§S-3 で 2→3）/ mine = 「予定に入っている {range}」ボタンなし / held = 「保留」+「予定に入れる」/ removed = 「予定から外した」/ finished = 「終わった」/ declined = 「見送った」ボタンなし。trial 行はチップ「おためし 15 分」。時刻変更はカードの時刻が行に追従
- **空きなし**: 規則 1 で空きが無い: buddy no_free「今日はもう空きがないよ。明日にとっておく？」+ keepCard「明日にとっておく」ボタン → 押すと「明日にとっておいた」チップ。規則 0 で置けない: no_free_trial「今日はもう空きがないよ。明日、まず 15 分だけ触るのはどう？」（§S-2 verbatim）
- **失敗（保存不可）**: localStorage が throw → DES.store.save('draft') false → .save-indicator が save_fail「このブラウザに保存できない」（R-11）。状態はメモリ保持。ネットワーク失敗の状態は存在しない（通信ゼロ）
- **保存後**: topbar .save-indicator「このブラウザに保存」。composer 右の .hint sample_note「応答はサンプル」（≤700 で非表示）。paused_p「会話と予定はこのブラウザに残るよ。次は「続きをする」から戻れる」
- **読み取り専用**: TK.messageEl(m, {readOnly:true}) が .actions と button を DOM から外す。サポーター画面「会話を全部見る」（sup-view.js:231）で使用。子ども側 #talk には読み取り専用モードは無い
- **サポーター同席中**: textarea の上に segmented .stance（proxy/voice/idea）。child 発言に by があればチップ by_typed「{sup}が代わりに入力」、record 行に by_with「{sup}と」。supporter 発言は .message.supporter（頭文字アバター + .sup-name + bubble）+ idea があれば .idea-card（open/later/made/
- **あしあとからの着地**: 対象 .message に .is-trail-focus + focus + scrollIntoView(center)。1 回だけ（ui.focusMsg を消費）
- **今日はここまで（#paused）**: paused_h「今日はここまで」/ paused_p / resume「続きをする」。make の活動が止まっていれば make 側の paused が優先される

### 架空のまま出してはいけないもの

- DES.data.talk の 6 件の架空会話（はると ↔ バディ、建築・アクセサリー・Python）を本人の履歴として見せない。本実装の会話一覧は保存済み会話だけ（初回は空）
- TK.reply の固定返事（rep_propose / rep_skip / rep_pm / rep_pm_none / rep_default / trial_ask / no_free / no_free_trial）と、キーワード部分一致の規則 0〜4 — 本番 AI 応答に置換。i18n.js:734-739 は js 単一文字列で es 対応も無い
- 150ms の setTimeout で作る疑似レイテンシと ui.sending の 2 値 — 実応答の待ち状態（長い待ち・失敗・再送）を持つ必要がある。現状は失敗分岐が無い
- DES.data.now '10:20' 固定の time と、日付を持たないメッセージ形 { id, time:'HH:MM', who, text } — 実時刻と日付が要る（trail は日ごとに束ねる）
- composer の .hint sample_note「応答はサンプル」/ es「返事はサンプル」— 本番では外す
- media ボタンのトースト demo_media「このモックでは体験例だけ。本番では写真・音声入力が使える」— 本番では実入力にするか、ボタンを出さない（§K: 写真・音声の実入力はスコープ外）
- share_note「この会話は田中さんも見られるよ。おうちの人には、学んだことをまとめて伝えるね」— 固定の人名と共有範囲の断定。実際の共有設定・サポーター名から作る（R-11「本番想定の文」）
- paused_p「会話と予定はこのブラウザに残るよ」— 保存先がサーバーになるなら文を変える
- 提案カードが参照する fixture の予定行 p6 / p7（from:'talk-3'/'talk-5'）と、規則 1 が置く proposed 行 — 本人の実予定と AI 提案の実データに
- サポーター 田中さん（id 'tanaka'）と by の付与（DES.sup.byNow）— 同席中の実ユーザーの認証情報から
- 会話 id 't'+Date.now().toString(36)+'-'+seq（seq はロードごとに 0 から）— 複数端末・複数タブで衝突しうる。サーバー発行 id に
- DES.data.resume { title:'バディとの会話', next:'Python のゲーム作りやってみたい' }（サイドバー .resume-mini が読む。talk.js 外だが会話の続き文として架空）

### 見本として残せるもの

- welcome_h「今日は、何を話そう。」/ welcome_p / bridge「この話の続きを、作る で試してみる？」/ composer_ph — 固定の UI 文言（架空の出来事を含まない）
- DES.buddy の SVG アバターと mood（happy / neutral / think）
- 取り組み一覧 DES.data.catalog の題名と aliases 表 — 「見本の取り組み一覧」と明示すれば残せる（人物・出来事を含まない）。本番では教室の一覧に差し替え
- 提案カード / 記録行 / idea カードの見た目と状態表（R-7 の文言 in_plan / kind_held / card_removed / finished / declined / trial / kept_tomorrow）— 実データに付ければそのまま使える
- 規則 0 の R0 キーワードと trial の理由文 reason_goal / reason_continue / reason_done / reason_catalog — AI が無い時の fallback として「見本の返事」と明示すれば残せる
- talk.css の .suggestions / .attachment（DOM からは未使用の codex 移植 CSS）— 残しても害は無いが削除可
- DES.data.classroom の時間割（open 10:00 / lunch 12:30-13:30 / exercise 11:30-12:30）— 「見本の教室」と明示すれば残せる

## plan

### ルート

| hash | 画面 |
| - | - |
| `#plan` | 予定を広く見る（.plan-page: 見出し「今日の予定」+ 日付 → 目標 3 枠（横並び）→ 表（午前/昼/午後の 3 ブロック）\| 右に「今まで取り組んできたこと」カテゴリカード）。DES.plan.renderPage(main) を app.js:445 が呼ぶ |
| `#talk（右パネル）` | aside.plan-panel（panel-head 「今日の予定」+ 日付 + 「広く見る →」+ ×、segmented タブ 予定 / 今まで取り組んできたこと、予定タブ = コンパクト目標 3 枠 + 表、今までタブ = グリッド 1 列）。talk.js:301 が DES.plan.renderPanel(aside,{ctx:'panel'}) を呼ぶ。表示は des3.panel==='open' のとき |
| `#talk / #make（drawer・sheet）` | dialog#plan-dialog の中に同じ aside.plan-panel を ctx:'dialog', compact:true で描く（app.js:246-262）。plan-toggle ボタンで開閉。#make では ≥1121 でも drawer で開く |

### 操作（data-action など 35 件）

- `accept` — 表（panel / dialog / page）の proposed 行「予定に入れる」(.btn.small.orange) と held 行「予定に入れる」。talk の提案カ → proposed→mine はそのまま。held→mine は R-1 再検査: 元の時間帯に占有があれば同じ長さが入る最初の空きへ移動（moved）。ui.actor=id。記録行 rec_add / rec_add_moved / trial 行なら rec_trial（+ rec_moved_suffix）。fo（保存: des3.plan, des3.talk（DES.talk.record 経由））
- `hold` — proposed 行「あとで」 → kind=held（占有を外す）。記録行 rec_hold「「{title}」をあとで決めることにした」（plan.js:125-130, 426-433）（保存: des3.plan, des3.talk）
- `decline` — proposed 行「違う」（§S-3）。カードにも同じ → 行を gone:'declined' にして占有解除（行は配列に残る）。leave アニメ 200ms 後に commit。記録行 rec_decline。トースト「見送った」+「元に戻す」5 秒 → act.undo(token)。focus 'plan-head'（plan.js:338-343, 405-415）（保存: des3.plan, des3.talk）
- `free-trial` — 空き行 .row.free の「バディにまかせる」（spark アイコン・空き 15 分以上のときだけ出る） → pickTrial（goals の text 照合 → 今日の続き → 前にやった → catalog 順）で 1 件選び、その空き行の先頭に 15 分の proposed 行（trial:true, from=talk id）を置く。同時に talk に buddy メッセージ（trial_ask + reason_（保存: des3.plan, des3.talk）
- `row-menu` — mine 行右端の「…」(.icon-btn.row-more, aria-haspopup=menu)。optional 行も optMenu のとき（dialog ctx 常時 → bp s なら ui.menu=null で #row-sheet を showModal。それ以外は ui.menu をトグルして再描画し、行直下に .row-menu（role=menu）を出し最初の有効 menuitem にフォーカス。閉じるときは「…」へ戻す。Esc と外クリックで閉じる（app.js:592-（保存: なし（DES.ui.menu のみ））
- `row-move (data-arg up|down)` — .row-menu / #row-sheet の「上へ」「下へ」（up/down アイコン）。相手が無い・終端に収まらないときは disabled + title「間に動かせない予 → 同ブロック内で間に占有行を挟まない隣接 mine 行と入れ替え。早い方の開始 A から 後ろの行→前の行 の順に詰め直し、両行に edited:true, overlapLater:false。記録行 rec_swap（plan.js:132-170, 434-442, 803-809）（保存: des3.plan, des3.talk）
- `row-time` — .row-menu の「時刻を直す」 → ui.edit={id,start,len} を立てて再描画、行直下に .time-edit（開始 select: 10:00〜12:15 / 13:30〜15:15 の 15 分刻み + 現在値、長さ select: 15/30/45/60 + 現在値）を出し開始 select にフォーカス。select の cha（保存: なし（DES.ui.edit））
- `time-ok` — .time-edit の「決める」(.btn.small.primary) → setTime: 終了は classroom.close(15:30) で頭打ち。変更なしなら記録なし。変更あれば edited:true, overlapLater:false, ui.noSlot[id] を消し記録行 rec_time「「{title}」を {start}〜{end} にした」。ui.edit=n（保存: des3.plan, des3.talk）
- `time-cancel` — .time-edit の「やめる」 → ui.edit=null、再描画、「…」ボタンへフォーカス（plan.js:1029）（保存: なし）
- `row-remove` — .row-menu の「外す」/ held 行の「外す」ボタン → 行を gone:'removed' にして残す（提案カードが「予定から外した」を出すため）。leave アニメ後 commit。記録行 rec_remove。トースト「外したよ」+「元に戻す」5 秒（plan.js:194-198, 464-474, 1030）（保存: des3.plan, des3.talk）
- `row-hide` — .row-menu の「非表示にする」 → mine 行に hidden:true。1 行の薄い stub「非表示: {title}」+「表示する」に畳まれる。占有は維持（空き計算では埋まったまま）。記録行なし（plan.js:226-230, 495-497, 728-740, 1031）（保存: des3.plan）
- `row-show` — hidden stub の「表示する」 → hidden:false、ui.actor=id。重なりがあれば通常の帯と 3 候補が出る（plan.js:498-500, 1032）（保存: des3.plan）
- `row-finish` — .row-menu の「終わった」（check アイコン） → 行を gone:'finished' にし catalogMarks[activity].today に「{start}〜{end}」を追加。グリッドに緑チップ「今日 10:00〜10:50」。記録行 rec_finish。トースト「「{title}」を 今まで取り組んできたこと に戻した」+「元に戻す」5 秒（pla（保存: des3.plan, des3.catalogMarks, des3.talk）
- `opt (data-arg undecided|join|skip|later)` — optional（運動）行の 3 ボタン（参加する / 今日は見送る / あとで決める）、optMenu 時は .row-menu、選択後は「選び直す」(arg undecided → choice を変更（同値なら何もしない）。join → チップ「参加する」占有 / skip → stub「運動（見送り）」占有せず 11:30〜12:30 が空き行に / later → チップ「あとで決める」占有。記録行 rec_join / rec_skip / rec_later（undecided への戻し（保存: des3.plan, des3.talk）
- `row-make` — .row-menu の 7 つ目「open_in_make」(make アイコン)（§U-3） → ui.menu=null、#plan-dialog を閉じ、DES.make.openFromPlan(row) で作るの作業台へ（plan.js:810-811, 1035-1040; make.js:1213）（保存: なし（make 側））
- `free-add` — 空き行の「取り組みを追加」（plus アイコン） → P.openPick(start, opener): #pick-sheet を showModal。見出し「取り組みを追加」+「あいている {range}」、グリッドを pick モード（各取り組みに「ここに入れる」1 ボタン、cols は bp s で 1 / 他 2）（plan.js:976-989, 1041）（保存: なし）
- `pick (data-id=activity, data-arg=slot start)` — #pick-sheet の各取り組み「ここに入れる」 → dialog を閉じ act.addAt: その空き行の位置に mine 行（長さ = min(空き,60)）。ui.actor=newId。記録行 rec_add「{start} に「{title}」を入れた」。空きが消えていればトースト no_slot_band（plan.js:102-110, 512-524, （保存: des3.plan, des3.talk）
- `grid-add` — グリッド（panel 今までタブ / #plan 右列）の各取り組み「入れる」(.btn.ghost.small, aria-label「予定に入れる: {title}」) → act.addFirst: 最初の空き（15 分以上）に mine 行。空きが無ければ追加せずトースト「今日はもう空きがないよ。明日にとっておく？」+ ボタン「明日にとっておく」→ act.keepTomorrow。記録行は入った時だけ。外部呼出（trail / sup）では o.undo で「元に戻す」付きトースト （保存: des3.plan, des3.talk（空きなし→明日: des3.catalogMarks））
- `grid-ask` — グリッドの各取り組み「相談する」(.btn.ghost.small, aria-label「バディに相談する: {title}」) → DES.talk.prefill(title): composer の下書き末尾に「「{title}」をやってみたい」を足してトースト prefilled（送信しない）（plan.js:1048）（保存: des3.draft（talk 側））
- `keep-tomorrow` — no_free トースト内ボタン / talk 提案カードの「明日にとっておく」(talk.js:166) → catalogMarks[act].tomorrow=true、グリッドにサンドのチップ「明日にとっておいた」。トースト「明日にとっておいた」（plan.js:285-290, 554-559, 1049）（保存: des3.catalogMarks）
- `ov-shorten (data-arg=other id)` — 重なり帯 .overlap-band の「短くする」（自分の開始 < 相手の開始 のときだけ出る） → end を相手の開始に合わせ edited:true, overlapLater:false。記録行 rec_shorten（plan.js:270-275, 560-568, 846）（保存: des3.plan, des3.talk）
- `ov-move` — 重なり帯の「別の時間へ」 → 自分を除いた占有集合で午前→午後の順に同じ長さが入る最初の空きへ移す（edited:true）。無ければ ui.noSlot[id]=true で帯文を「空いている時間がないよ。短くするか、あとで決めてね」に変え移動しない。記録行 rec_moved（plan.js:277-283, 569-578, 843）（保存: des3.plan, des3.talk）
- `ov-later` — 重なり帯の「あとで決める」 → overlapLater:true, edited:true。帯が消え行チップに「重なり」ボタン。記録行 rec_defer（plan.js:264-268, 579-587）（保存: des3.plan, des3.talk）
- `ov-reopen` — 行チップ「重なり」(.chip-btn, aria-label「重なり: {title}と重なる」) → overlapLater:false にして帯と 3 候補を再表示。記録なし（plan.js:588-590, 754-756, 1053）（保存: des3.plan）
- `goal-edit` — 目標 3 枠（button.goal）クリック。#plan は横並びカード、パネルは .goal.compact 1 行 → ui.goalEdit={id,value} で再描画し、枠が .goal.editing（label + textarea rows=1 + 残す / やめる）に変わり末尾にカーソル。textarea の input は talk.js:324-326 が ui.goalEdit.value に反映。Esc は ap（保存: なし（DES.ui.goalEdit））
- `goal-save` — .goal.editing の「残す」(.btn.small.primary) → 前後空白を落として goals[id].text を更新。空なら text:null（破線枠へ戻る）。値ありは src:'own', date=DES.data.today.slice(5)。変化した時だけ記録行 rec_goal「「{label}」に「{text}」と書いた」。focus 'goal:'+id（pla（保存: des3.goals, des3.talk）
- `goal-cancel` — .goal.editing の「やめる」 → ui.goalEdit=null、再描画、枠へフォーカス（plan.js:1062）（保存: なし）
- `panel-tab (data-arg plan|history)` — パネル .panel-tabs .segmented の 2 タブ（role=tab） → S().panelTab を切替（予定 = 目標 + 表 / 今まで = グリッド 1 列）。同じタブボタンへフォーカス（plan.js:942-953, 1063-1068）（保存: des3.panelTab）
- `goto-plan` — パネル見出しの「広く見る →」リンク、コンパクト重なり帯の「今日の予定で直す →」（href=#plan） → app.js:513-516: plan-dialog を閉じ location.hash='#plan'（plan.js:838, 938）（保存: なし）
- `panel-close` — パネル見出し右の ×（aria-label 閉じる） → app.js:507-512: dialog 内なら closeDialog、inline なら des3.panel='closed'（plan.js:939）（保存: des3.panel（inline のとき））
- `dialog-close` — #pick-sheet 見出しの × / #row-sheet 末尾の「やめる」 → app.js:289: 最寄りの dialog を閉じ、開いたボタンへフォーカスを戻す（plan.js:984, 998）（保存: なし）
- `toast-act` — #toast 内の「元に戻す」「明日にとっておく」ボタン（5 秒） → app.js:216: 登録 closure を実行（act.undo(token) → 行を全フィールド復元 + catalogMarks 差分戻し + 記録行 rec_undo / act.unadd / act.keepTomorrow）。toast は hidden になりボタンは DOM から外す（plan.（保存: des3.plan, des3.catalogMarks, des3.talk）
- `DnD: dragstart .row.k-mine[draggable]` — 表の mine 行（drag アイコン .drag-mark、≤700 では非表示） → canMove(up/down) で fits な相手行に .drop-ok（薄橙）、dragover で .drop-over（橙リング）。drop → act.swapWith(id, other)（row-move と同じ結果・rec_swap）。dragend / drop で clearDrop（plan.j（保存: des3.plan, des3.talk）
- `DnD: dragstart .act[draggable]（グリッドの取り組み、pick モード以外）` — グリッドの li.act → 全 .row.free に .drop-ok。drop → act.addAt(slot, act)（空き行の「取り組みを追加」と同じ・rec_add）（plan.js:1086-1090, 1113-1115）（保存: des3.plan, des3.talk）
- `キーボード: Escape` — document keydown（app.js:592-598） → ui.menu → 閉じて「…」へ / ui.edit → 閉じて「…」へ / ui.goalEdit → 閉じて枠へ。dialog の Esc は cancel → closeDialog（app.js:602-604）（保存: なし）

### ダイアログ・シート

- #plan-dialog = dialog.plan-dialog.plan-drawer.plan-sheet（index.html:33）: 中に aside.plan-panel を renderPanel(ctx 'dialog', compact). 701+ は右 340px drawer、≤700 は上からのシート 88vh。開閉 APP.openPlan / APP.closePl
- #pick-sheet = dialog.pick-sheet（index.html:34）: P.openPick(start, opener)。.dialog-head（h2#pick-h「取り組みを追加」+ p.muted「あいている {range}」+ × data-action=dialog-close）+ renderGrid({mode:'pick', slot})（plan.js:
- #row-sheet = dialog.row-sheet（index.html:35）: P.openRowSheet(id, opener)。bp s のときの行メニュー。h2#rs-h=行タイトル + .row-sheet-list[role=menu]（menuItems）+ .dialog-footer「やめる」。下から出る 18px 角丸シート（plan.js:990-1000, pl
- #toast = div.toast[role=status][aria-live=polite]（index.html:31）: .toast.actionable に .toast-btn（元に戻す / 明日にとっておく）。pointer-events:auto（R-9）（app.js:188-216, plan.css:194-197）
- inline（dialog ではない）: .row-menu[role=menu]（行直下・margin-left 74px）/ .time-edit（select×2 + 決める/やめる）/ .overlap-band[role=group]（帯 + 3 候補）/ .goal.editing（textarea + 残す/やめる）（plan.js:817-850, 859-863）
- セレクタ: 表 .plan-table > section.block.block-{am|lunch|pm} > .block-rows > .row-group[data-fk=row:{id}] > .row.k-{kind}[data-id] / .row.free[data-slot][data-end] / .row.stub / .now-line / .goals .goal-li

### 状態

- **空（行なし・目標なし・記録なし）**: 3 ブロック見出し（午前 10:00〜12:30 / 昼 12:30〜13:30 / 午後 13:30〜15:30）は常に出る。占有が無いブロックは 1 本の空き行「あいている 10:00〜12:30」+「取り組みを追加」「バディにまかせる」。目標 text なし = 破線枠 1px dashed #cfcabd + 灰文字「話しながら決まる」(goal_empty)。catalogMarks 空 = グリッドにチップなし。※初期値は 
- **通常（kind 別の見え方）**: fixed/event = サンド地 --sand・チップ「固定」「当日の行事」 / optional = 白地 dashed・チップ「参加自由」+ 3 ボタン / mine = 白地 実線・左 3px 緑 --record・チップ「自分で選んだ」・drag アイコン・「…」 / proposed = --ai-soft 地 dashed 琥珀・.src-ai「バディの提案」（kind チップは出さない T-4）+ 予定に入れる(ora
- **確認中 / サークル none**: classroom.circle.today==='tbd' → event 行を 10:50〜11:10 に置きチップ「確認中」(circle_tbd)、占有する。'none' → 行を出さず占有もしない（plan.js:35-51）
- **おためし 15 分（trial）**: proposed / mine の trial:true 行にチップ「おためし 15 分」(.k-trial 白地)。予定に入れた後も残る。buddy メッセージ「まず 15 分、「{title}」を触ってみる？ {reason} 続けるか、そのあと決めてもいいよ」（plan.js:385-391, 753）
- **直した（edited）**: mine かつ edited:true の行は時間列の下に 10px 緑「直した」(edited_mark)（plan.js:713-718, plan.css:83）
- **入力中（時刻を直す）**: 行直下 .time-edit に「開始」「長さ」の select + 「決める」(primary)「やめる」。開いたまま決める = 変更なし・記録なし（R-4）（plan.js:820-832）
- **入力中（目標）**: .goal.editing（左 3px 青）に label + textarea rows=1 + 「残す」「やめる」。Esc / やめる で破棄。空で残す = null（plan.js:859-863, 591-605）
- **メニュー開**: 「…」に aria-expanded=true、行直下に .row-menu（6+1 操作縦並び・44px / es 48px）。上へ/下へ が不可なら disabled + title「間に動かせない予定がある」/「この時間には入らない」（plan.js:795-819）
- **ドラッグ中**: 落とせる相手だけ .drop-ok（背景 --orange-soft・枠橙）、直上で .drop-over（橙 2px リング）。mine 行 → 入替相手の mine 行 / グリッド取り組み → 空き行（plan.js:1075-1118, plan.css:143-144）
- **送信中**: plan には無い（同期・localStorage）。talk の DES.ui.sending のみ（talk.js:86-106）
- **成功・保存後**: 新しい行は .row.enter（200ms rowIn、ctx ごとの ui.seen で判定）。消える行は .row.leave 200ms 後に commit。会話に緑の記録行（rec_*）が追加。トースト: 「外したよ」/「「{title}」を 今まで取り組んできたこと に戻した」/「見送った」/「明日にとっておいた」/ addFirst は記録行そのもの、戻す付きは 5 秒・通常 2.6 秒（app.js:188-216）。保
- **失敗（保存）**: localStorage が throw → st.saveFailed=true → .save-indicator を「このブラウザに保存できない」(save_fail・muted・緑点なし) に（store.js:63-69, R-11）。状態はメモリに残る
- **失敗（空きがない）**: グリッド「入れる」: 追加せずトースト「今日はもう空きがないよ。明日にとっておく？」+「明日にとっておく」/ pick・trial で空きが消えていた: トースト「空いている時間がないよ。短くするか、あとで決めてね」(no_slot_band) / 重なり帯「別の時間へ」で無理: 帯文が同じ no_slot_band に変わり移動しない（plan.js:420, 517, 533, 571, 842）
- **重なり**: 操作した行（actor）の直下にサンド帯 .overlap-band「{title}と重なる」+「短くする」(自分の開始<相手のときのみ)「別の時間へ」「あとで決める」。行は .has-overlap（枠 #d9c9a6）。あとで決める後は帯を消し行チップ「重なり」(ボタン) で再開。コンパクト（dialog ctx）では「重なりがある」+「今日の予定で直す →」のみ。hidden stub は「非表示: {title}」+ 小文字「重
- **非表示 / 見送り stub**: hidden mine = 1 行の薄い stub「非表示: {title}」+「表示する」。optional skip = 「運動（見送り）」+「選び直す」、その枠は空き行に（plan.js:728-740, plan.css:127-131）
- **読み取り専用**: plan.js 自体に readonly モードは無い。サポーター側の読み取り表示は sup-view.js:155-160 が DES.plan.live / byChip を使って別描画。一緒に入っている間の inert は #self のみ（app.js:436）
- **現在時刻線**: .now-line（橙 1.5px）+ 左に時刻ラベル（DES.data.now 固定 '10:20'）。「開始 ≤ now の最後の行」の直下、その行が now を含むなら上辺。昼休み中はお昼行の上辺（plan.js:680-686, 710-712）

### 架空のまま出してはいけないもの

- DES.data.plan の初期 7 行（data.js:22-30）。特に proposed の p6「アクセサリー作り（続き）」/ p7「ゲーム作り: Python」と from:'talk-3'/'talk-5' は架空のバディ提案 — 保存が無いときにこれを「今日の予定」として出してはいけない。初期値は 教室の設定から導く fixed/event/optional のみ + 本人の保存
- DES.data.goals の g1 本文「Python のゲーム作りやってみたい」(src own, date '11-02')（data.js:15-19）— 本人が書いた言葉として見える。初期は 3 枠とも null
- DES.data.now '10:20' / today '2026-11-02' / weekday '月' / group '月水金A'（data.js:5）— 現在時刻線・日付ラベル・目標の日付・trial メッセージの time に出る
- P.trial / pickTrial の決定論「バディの返事」（trial_ask + reason_goal/continue/done/catalog を埋めて who:'buddy' で talk に push。plan.js:385-391, 416-425）— 固定テンプレの会話を本物のバディ発言として保存してはいけない。本実装はバディ（Codex）の実提案か、「仮の提案」と明示
- talk.js TK.reply が plan の純関数で作る提案（rep_propose / rep_skip / rep_pm 等。talk.js:29-60）— plan 側の P.propose / P.setChoice を会話から直接叩いている。会話→表の生成はバディ実装に移す
- catalogMarks.today の「今日 10:00〜10:50」緑チップと記録行 rec_finish — 本人の「終わった」操作からのみ生成（固定値を入れない）
- byChip の「{sup}と入れた」「{sup}のアイデアから」のサポーター名（'田中さん'）— 実サポーターの名前解決へ
- classroom.circle.today '10:50' / exercise 枠 — 教室の当日設定から（R-12: 切替 UI は作らない）
- P.newId の Date.now ベース id — サーバ側採番か衝突耐性のある id へ（リロードで seq=0 に戻る）

### 見本として残せるもの

- DES.data.catalog の 7 カテゴリ × 27 取り組み名（「今まで取り組んできたこと」の見本一覧。人物・出来事を含まない。ただし「本人の履歴」ではなく「教室で選べる取り組み」と明示する。data.js:32-72）
- DES.aliases の別名表（照合用データ。i18n.js:745-772）
- classroom の枠の既定値（10:00〜15:30 / 昼 12:30〜13:30 / 運動 11:30〜12:30 / サークル対話 20 分）— 教室設定の初期値として
- fixed「お昼」/ event「サークル対話」/ optional「運動」の 3 行の形（教室の日課。見本の行として残せる。data.js:24, 26-27）
- i18n の全文言・記録行テンプレ rec_* / reason_* / trial_ask（文のテンプレであって架空の記録ではない。i18n.js:17-141, 715-741）
- アイコン・チップ色・CSS（plan.css 全体。tokens は §E-4）
- check.sh / render.sh の検証スクリプト（tools/）。plan.js 純関数の node テストは契約 R-13 (c) の想定だが repo に無い

## make

### ルート

| hash | 画面 |
| - | - |
| `#make` | 入口（renderEntry）: h1「作る」+ 1 行 / 制作中（working\|paused の活動行 .project-row、0 件なら節ごと非表示）/ 見本から始める（MD.samples 6 枚を 3 枚ずつ、「別の見本を見る」で組替え）/ こんなのも作れる（MD.projects 12 件を 4 件ずつ）/ 思いつきから（1 行入力 + 写真を見せる・リンクを貼る）/ 小リンク「今日のお題を見る」 |
| `#make/<id>` | 作業台（renderStudio）: 戻るリンク「← 作る」/ 見出し行（きっかけチップ + タイトル（押すと 1 行編集）+ 「…」メニュー）/ 今の一歩 .step-line / 作業対象（stageBlock=スライダー2本+線画+コード+試す / emptyStage / extBlock=写真）/ 前に戻す・バディに任せる / ここまでの変化（既定 2 行）/ 作品に残す・今日はここまで。左に相談列（thread + comp |
| `#make/<id>/save` | 作業台を描いた上で「作品に残す」ダイアログを自動で開く（M.render の sub='save'。閉じると #make/<id> へ replace） |
| `#make/<id>/pause` | 作業台を描いた上で「今日はここまで」ダイアログを自動で開く（sub='pause'） |
| `#make/demo-mc\|demo-py\|demo-circuit\|demo-cand\|demo-full` | 無い id が demo- で始まれば決定論のデモ活動を生成して des3.activities に保存してから作業台を描く（render/check 用） |
| `#paused（作るから来た時）` | app.js が DES.make.pausedAct() で判定し M.renderPaused: バディ絵 + 「今日はここまで」+ paused_make_p + （背中押し step の時）「{step}だけやってみる」+ 「続きをする」+（closed の時）「作品に残す？」 |

### 操作（data-action など 39 件）

- `mk-sample` — 入口 見本カード「動かしてみる」 → fromSample → 新活動（stage=sample、返事 open 1 件）を先頭に足して #make/<id>。makeFrom（予定表から）があれば catalogId/origin を引き継ぐ（保存: DES.state.activities / makeSide.shelfFolded）
- `mk-open` — 入口 制作中の行「続きを作る」/ 他モジュール経由 openAct → paused/closed/stopped なら resume（state=working）して先頭へ、#make/<id>（保存: DES.state.activities）
- `mk-more-samples / mk-more-projects` — 入口 見本・提案の「別の見本を見る」「別の提案を見る」 → swapPage で組の位置を +1（最後の次は最初）。先に save、失敗なら入れ替えず save_fail。150ms フェード、aria-live で通知（保存: DES.state.makeSide.samplePage / projectPage）
- `mk-project` — 入口 提案カード「これで始める」 → fromProject → ext 活動（theme 'project'、手順=提案の steps）。同じ提案の活動があれば開くだけ。addAct 失敗なら足さず save_fail。成功で #make/<id> + トースト pj_placed（保存: DES.state.activities）
- `mk-start（Enter でも）` — 入口 思いつきから「作るを始める」 → fromText → pickTheme で題材、引用枠 + 棚に仮の案 3（candidate）、返事 land。作業台へ（保存: DES.state.activities）
- `mk-from-ext（photo|link）` — 入口 「写真を見せる」「リンクを貼る」 → トースト demo_media → fromExt（theme mc 固定・ext 活動。photo はダミー写真 1 枚を足す）→ 作業台（保存: DES.state.activities）
- `mk-show-samples / mk-pick-sample` — 作業台 空の作業対象「見本を見る」→ mini-samples 「動かしてみる」 → showSamples[id]=true（UI のみ）/ pickSample で見本を作業対象に取り込む（保存: （pick）DES.state.activities）
- `input[data-ui=mk-param]（スライダー input/change）` — 作業台 stageBlock range → setParam で値を範囲内に丸め、線画・コード・output・untested・結果行を DOM 差し替え（再描画なし）。change で activities 保存、失敗は saveFailed（保存: DES.state.activities）
- `mk-test` — 作業台 「試す」 → test(): 値が変わっていれば変化 +1（own, kind test, advance）+ バディ返事 MD.testReply。変えずに直前も test ならトーストで結果だけ（保存: DES.state.activities）
- `mk-revert / mk-revert-to` — 作業台 「前に戻す」/ 変化の行「ここに戻す」 → revert → restoreState で変化 +1（kind revert「{time} のところに戻した」）。トースト + 5 秒「戻す」で undoRevert（保存: DES.state.activities）
- `mk-leave` — 作業台 「バディに任せる」 → 相談列に「何を任せる？」+ 対象別候補（leaveOptions）+「言葉で頼む」。相談列を見える位置へ（保存: DES.state.activities（thread））
- `mk-leave-opt` — 相談列 候補ボタン → free なら composer にフォーカス（freeReq）。他は runLeave: leave()→棚に破線「作っている」カード→150ms 後 settle→state new・相談列に記録「棚に「…」を置いた」・棚を開く（保存: DES.state.activities / makeSide.shelfFolded）
- `mk-adopt` — 棚カード「これにする」/ 見送った案「やっぱりこれにする」 → adopt: 作業対象に取り込み、同じ回の他案を passed、変化 +1（ai, kind adopt）+ 返事「「{案}」にしたよ。」+ replies.left。トースト（保存: DES.state.activities）
- `mk-remake-open / mk-remake` — 棚カード「作り直す」→ 候補 → 1 つ押す → remakeFor（UI）→ remake=leave(opt,{card}) で新カード（メモは alt 版）（保存: DES.state.activities）
- `mk-card-decline` — 棚カード「違う」 → decline → passed、相談列に「どこが違う？」+ 候補 5。srcCapture があれば works の read.excluded=true。トースト + 5 秒 undo（保存: DES.state.activities / works）
- `mk-cancel-making` — 棚 破線カード「やめる」 → making のカードを棚から外す（保存: DES.state.activities）
- `mk-msg-decline` — 相談列 返事の「違う」 → declineReply: 返事に紐づく変化の 1 つ前へ戻し（変化 +1）、紐づく new カードは passed、返事に declined 印、「どこが違う？」。トースト + undo で 3 つとも戻す（保存: DES.state.activities）
- `mk-diff-pick` — 相談列 「どこが違う？」候補（形/大きさ/材料・色/動き/それ以外） → 候補→作り直しの種類（ASPECT_OPT / TOOL_ASPECT / ODAI_ASPECT）→ runLeave（保存: DES.state.activities）
- `mk-change-decline` — 変化の行（バディ行）「違う」 → その変化の前へ revertWith + 「どこが違う？」（保存: DES.state.activities）
- `mk-compare / mk-compare-pick / mk-compare-close / mk-compare-photos` — 変化・棚の見出し「比べる」/ pick-toggle / 比較ビュー「閉じる」/ 写真「比べる」 → UI 状態 mk().compare（2 つ選ぶと作業対象の上に並ぶ）。保存しない
- `mk-photo（photo|shot）` — 作業台 extBlock「写真を足す」「スクショを足す」 → トースト demo_media → addPhoto: ダミー線画 1 枚（n を巡回）+ 変化 +1（own）+ 「何を変えた？」フォームを開く（保存: DES.state.activities）
- `mk-photo-opt` — 写真フォーム 候補チップ → edit.opt を切替（UI）
- `mk-step-edit / mk-title-edit / mk-quote-edit` — 今の一歩「直す」「次を決める」/ 見出し・メニュー「タイトルを直す」/ 引用枠「直す」 → mk().edit を立てて 1 行編集を描く（UI）
- `mk-edit-ok（input で Enter でも）` — 1 行編集「この文で」 → title→setTitle / next→setNext（空なら空のまま）/ quote→editQuote（題材が変われば案と手順を作り直し、トースト remake_ideas）/ photo→describePhoto（what を書換え）+ 本人行 + 返事 photo（保存: DES.state.activities）
- `mk-edit-cancel（Esc でも）` — 1 行編集「やめる」 → edit=null、元の要素へフォーカス
- `mk-quote-remove` — 引用枠「外す」 → removeQuote（quote.removed=true、見本 3 枚に切替）。トースト + undo（保存: DES.state.activities）
- `mk-head-menu / mk-stop` — 見出し「…」→「この活動をやめる」 → stop: state=stopped + 記録「やめた。あしあとから戻れる」、#make へ。トースト stop_accept + undo で戻す（保存: DES.state.activities）
- `mk-fold-chat / mk-fold-shelf` — 相談の見出し「相談を畳む/開く」/ 棚「畳む/開く」 → makeSide.chatHidden / shelfFolded を反転（保存: DES.state.makeSide）
- `mk-passed-toggle / mk-show-all` — 棚「見送った案（n）」/ 変化「ぜんぶ見る（n）」 → UI 開閉のみ
- `mk-tab` — ≤700 segmented「作業台｜相談」 → makeSide.tab を切替、未読の点を消す（保存: DES.state.makeSide.tab）
- `mk-to-consult` — 701〜950 見出し「相談へ」 → 相談列へスクロール + composer フォーカス（UI）
- `mk-send（Ctrl/Cmd+Enter でも）/ input[data-ui=mk-composer]` — 相談列 composer → 入力は draft として即保存。送信: 本人行を積み、150ms 後に replyKind（疲れ系→accept_msg / 頼む系→runLeave(requestOpt) / それ以外→replies.unknown）で決定論の返事（保存: DES.state.activities（thread, draft））
- `mk-save-open / mk-save-ok / input[data-ui=mk-dlg]` — 作業台「作品に残す」→ dialog#make-dialog → openSave: 残すところ(select)・タイトル・気に入っているところ・完成/試作・誰が何をした。save-ok: saveWork → works 先頭に +1（未試行なら変化 set も積む）。works 保存失敗なら works を戻し dlg-error + 「もう一度残す」。成功でトースト saved（保存: DES.state.works / activities）
- `mk-pause-open / mk-pause-ok` — 作業台「今日はここまで」→ dialog → pause(a) で背中押し 3 ケース（step/next/accept）を決め、次にすること（既定バディ案・本人が直す/空に）+ 続きがある/ここで一区切り。ok で confirmPause（state paused|closed、pauseCount+1、declined/offered 更新）→ makeSi（保存: DES.state.activities / makeSide.paused / makeSide.lastStop）
- `mk-take-step / mk-paused-step` — ダイアログ・#paused「{step}だけやってみる」 → takeStep: state=working、一歩を 1.6 秒ハイライト。#paused からは declined を 1 戻す、paused=null（保存: DES.state.activities / makeSide.paused）
- `mk-paused-resume` — #paused「続きをする」 → makeSide.paused=null → openAct（resume）（保存: DES.state.makeSide / activities）
- `Esc / 外クリック` — 作業台全体 → Esc: 編集→メニュー→作り直し候補→比較の順に閉じる。外クリックで「…」メニューと作り直し候補を閉じる
- `error(capture) on img[data-thumb]` — 入口 提案カードの画像 → 読めない画像はカテゴリ線画に差し替え（thumbFail）
- `dialog close` — dialog#make-dialog → トーストを body へ戻し、#make/<id>/save|pause を #make/<id> に replace

### ダイアログ・シート

- dialog#make-dialog（index.html:37、class .make-dialog。作品に残す = renderSave（h2#mk-dlg-h、#mk-save-at select、#mk-save-title、#mk-save-like、fieldset.status-pick、#mk-roles）/ 今日はここまで = renderPause（.push-line、#mk
- #toast（APP.toast。dialog が開いている間は dialog 内末尾に移動、閉じると body へ戻す）
- .head-menu[role=menu]（見出し「…」のインラインメニュー。dialog ではない）
- .remake-opts[role=group]（棚カード内の作り直し候補。インライン）
- .compare-view（作業対象の上の比較枠。インライン）
- .inline-edit[data-fk=edit:<type>]（タイトル・次・引用・写真の 1 行編集。インライン）
- .photo-form[role=group]（「何を変えた？」。インライン）
- 今日の予定 drawer は app.js 側（#plan-dialog。#make では右から被さる drawer）

### 状態

- **入口: 制作中 0 件**: 「制作中」の節ごと出さず見本が先頭（renderEntry acts.length ? … : null。design-v3 §4 表「制作中 0 件: 見出しを出さず、見本が先頭」）
- **入口: 見本 0（本番のみ・モック未実装）**: i18n no_samples「見本はまだ届いていないよ。思いつきか写真から始められる」。make.js に表示経路なし（MD.samples は固定 6 枚）
- **入口: 見本・案が開けない（本番のみ・未実装）**: i18n sample_fail「今は開けない。別の見本か、写真から始められる」。表示経路なし
- **入口: 思いつき未入力**: #mk-start disabled（canStart = ideaText の空白除去が空でない時だけ有効）
- **入口: 見本・提案の組替え中**: .is-fading（150ms 不透明度 0）→ .is-fadein。reduced-motion は即時。sr-only aria-live に samples_swapped / pj_swapped
- **作業台: 候補状態（意図つき着地）**: 作業対象は .stage-empty + shelf_empty_stage「右の案から選ぶか、見本を動かすところから始められる」+「見本を見る」。棚に仮の案 3（state new）。手順先頭が CANDIDATE_STEP「案を選ぶ」
- **作業台: 値を変えて未試行**: stage-top に .untested「まだ試していない」、結果行は not_checked「まだ確かめていない」。試すと結果 1 行（MD.result）と .has-result
- **作業台: 戻せる変化が無い**: 「前に戻す」disabled + title revert_none「戻せる変化はまだ無い」
- **棚: 作っている（生成中）**: .shelf-card.is-making（破線・ai-soft）に making「作っている」+「やめる」。150ms 後に settle で new カードに差し替え .enter アニメ。相談列に記録 shelf_new_rec「棚に「{title}」を置いた」
- **棚: 失敗（本番のみ・未実装）**: i18n draft_fail「今は作れなかった。見本を触るか、一緒に手で描く？」+ retry_make「もう一度」。make.js に表示経路なし（モックは必ず成功）
- **棚: 空**: xl では列ごと出さない（has-shelf は a.shelf.length>0 の時だけ）。≤1120 では見出しも出さない
- **棚: 採用 / 見送った案**: adopted カードに chip k-adopted「採用」。passed は「見送った案（n）」の畳みに薄く + 「やっぱりこれにする」
- **相談列: 送信中**: mk().sending=true の 150ms、送信ボタン disabled（syncSend）。スピナーなし
- **相談列: 返事を断った**: message に declined → 「違う」ボタン非表示。opts は used で非表示
- **相談列: 未読（≤700）**: 相談タブ名の横に .new-dot（dot.consult）。作業台タブ側も新カードで dot.stage
- **相談列: 再開メモ**: a.resumeNote「前はここまで。{step}から始める？」を先頭に（confirmPause で next があれば）。変化を積むと消える
- **作品に残す: 保存失敗**: ダイアログを閉じず .dlg-error[role=alert] save_work_fail「このブラウザに保存できない。作業台の中身は残っている」+ ボタン retry_save「もう一度残す」。works はメモリも戻す（§W-5）
- **作品に残す: 成功**: 閉じてトースト saved_work「作品に残した」+ 「作品で見る」→ #works。活動は working のまま
- **今日はここまで: 背中押し 3 ケース**: (1) step: push_step_msg「{step}だけなら {min} 分くらい。そこまでやってみる？」+ ボタン push_step / (2) next: push_next_msg「わかった。次は{step}から始められるようにしておくね」/ (3) accept: accept_msg「わかった。{last}まで進んだね」。pause() の決定論（pauseCount>=1 or declined>0 or 休みたい
- **活動の状態 working / paused / closed / stopped**: working・paused は入口の制作中に出る。closed（ここで一区切り）・stopped（やめた）は出ない。stopped は #paused 対象外・resumeTarget からも外れる。どれも openAct で working に戻る
- **#paused（作るから）**: paused_h + paused_make_p「作業台はこのブラウザに残るよ。次は「続きをする」から戻れる」。lastPause.kind=step かつ offered なら push_step を再掲。closed なら ask_save_once「作品に残す？」
- **やめる**: 記録 stopped_rec「やめた。あしあとから戻れる」+ トースト stop_accept「わかった。あしあとから戻れるよ」+ 5 秒 undo
- **無い id**: 入口を描いて toast not_found_work「見つからなかったよ」、location.replace('#make')（履歴に残さない）
- **保存失敗（作業中）**: DES.state.saveFailed=true → APP.renderSaveState（.save-indicator save_fail「このブラウザに保存できない」）。swapPage/addAct は trySave で画面状態も戻す
- **読み込み時の移行**: migrate（SCHEMA v:3 未満の活動に stepsKind・vis・返事 text を補う）、normalizeWorks/migrateWork、making のまま閉じた活動は finishMaking で完了、applySeeds で seedV<2 なら見本を足す
- **表示切替 js/es**: 作業対象・変化・下書き・相談列を保持。返事 text は作った時点の文字列で固定（§U-11 指摘 16）。{k,v} 形式の記録だけ今の表示で読む
- **読み取り専用**: 該当なし（サポーター同席時は commitChange に with=サポーター名が付くだけ。setWith）

### 架空のまま出してはいけないもの

- seedActivities / seedWorks / addSeeds の見本の活動・作品（act-build「建築（大きく）」はるとの島・田中さんの同席、act-py の 5 変化、act-cap、act-stop/story/ath、w-seed-*）— 本人の保存に見本を自動で混ぜない。空状態から始める
- MD.replies（land/open/test/left/photo/unknown）と MD.testReply の固定返事、adopt 後の「「{案}」にしたよ。」— 本物のバディ応答（des.buddy-live.v1）に。§7 の型は維持
- send() の 150ms 決定論応答（replyKind: 疲れ語→accept / 頼む語→任せる / それ以外→unknown）— 実会話
- leave / specsFor / settle の「作っている → 150ms で固定カード」（bump・nextVariant・find の 2 値・extCards の固定メモ）— 実生成 + 本番の失敗状態 draft_fail / retry_make を実装
- addPhoto / fromExt の demo_media トーストとダミー線画（MD.photoArt、n 巡回）— 実ファイル入力と実画像
- captures（cap-*）の固定「バディの見立て」read 文 — 実画像の読み取り
- DES.data.today / now 固定と tick（変化ごと +2 分）の擬似時計 — 実時刻
- #make/demo-* の demo() 自動生成 — 本番から外す（check 用）
- captureHook の「前に入れた『{title}』のスクショから」— 実作品の読み取りに基づく提案に
- DES.thumbs の pj-*.webp「AI が作ったイメージ」— 工場生成物の実 URL と印

### 見本として残せるもの

- 入口の見本（MD.samples の 6 枚と変えられるところ）— 「見本」ラベル（sample_label）付きで残せる。ただし工場の available が 0 なら no_samples
- 「こんなのも作れる」提案 12 件の題・一歩・必要な物（contract-app verbatim）— 「提案」として残せるが、実装では工場のお題ストックへ寄せるのが筋
- 題材ごとの線画 SVG（MD.art / catArt / stageOf）— 見本の作業対象の絵として。実写真・実生成物と混ぜない
- 作業台の手順 3 歩（stepsFor / stepBase / extSteps / CANDIDATE_STEP）— 見本から始めた時の既定の一歩として
- 入口のカテゴリ線画（MD.catArt。提案画像が無い時のフォールバック）

## works

### ルート

| hash | 画面 |
| - | - |
| `#works` | 一覧 renderList（works.js:241-262）。page-head（h1「作品」data-fk=works-h + 「作品展示を見る→」#gallery リンク + works_sub 1 文 + 作品≧1 件の時だけ右上 橙ボタン「写真・スクショを入れる」data-action=wk-open data-arg=head）→ 上段「完成」section#wk-done-h（大カード）→ 下段「残した試作」section |
| `#works/<workId>` | 詳細 renderDetail（works.js:393-408）。.wd-back「← 作品」→ .wd-head（h1 タイトル tabindex=-1 + 「直す」/ 状態チップ + 日付・時刻 / 操作行 .wd-actions: 続きを作る(橙)・この時点から作る・見せる・完成にする⇔試作に戻す・学びマップで見る(a#map)・作品から外す）→ 主役 section.wd-story「変わってきたところ」（選んだコマ大 or  |
| `#works/capture` | 一覧を描いた上で「写真・スクショを入れる」ダイアログを 1 回だけ自動で開く（works.js:421-423 u.opened）。ダイアログ close で location.replace('#works')（works.js:835）。app.js 内に #works/capture へ遷移するリンクは grep で見つからず（gallery/trail/make は #works か #works/<id> のみ）— deep  |
| `#works/<存在しない id>` | 一覧を描き、トースト not_found_work「見つからなかったよ」（1 回だけ u.missing）→ location.replace('#works')（works.js:415-420） |

### 操作（data-action など 29 件）

- `a.work-card[href=#works/<id>]（data-action 無し）` — 一覧カード全体（完成・試作とも）works.js:230-237 → 詳細へ遷移。カード内に他の操作は置かない（W-2）。data-fk=work:<id> で保存後・戻る時のフォーカス先
- `a.wk-gallery-link[href=#gallery] / a.link-btn[href=#works/<sibId>]` — 一覧見出し横（works.js:246）/ 詳細「同じ活動から残したほかの作品」（works.js:390） → 作品展示 / 兄弟作品の詳細へ遷移
- `wk-open` — 一覧右上 橙ボタン（data-arg=head、作品≧1）/ 0 件時の破線 .work-add（works.js:249, 256） → W.openCapture(opener): wk().dlg={type:'capture', imgs:[MD.captures[0].id], status:'done', read…} を作り syncDefaults で見本の題名・見立て・分類を埋め、#works-dialog を showModal、最初の
- `wk-img（data-arg=captureId）` — キャプチャーダイアログ 画像サムネ .cap-thumb（1〜3 枚トグル。最後の 1 枚は aria-disabled）works.js:491-495, 617-624 → d.imgs を増減（上限 3・下限 1）→ syncDefaults（未編集なら title/made/catalogId/read を先頭画像の見本値で上書き）→ 再描画 + 同じサムネに focus
- `wk-file` — キャプチャーダイアログ「写真を足す」ゴーストボタン works.js:496, 616 → トースト demo_media「このモックでは体験例だけ。本番では写真・音声入力が使える」のみ。実ファイル入力は無い
- `wk-made（data-arg=index）` — 「何を作った？」.opt-chip（建物/道具/絵/ゲーム/文章/それ以外）works.js:503-505, 625-631 → d.made をトグル（同じ chip でもう一度押すと null）、d.madeEdited=true
- `input[data-ui=wk][data-key=title|madeLine|readEdit]（input イベント）` — #wk-title / #wk-made-line / #wk-read works.js:797-804 → d.title（+titleEdited）/ d.madeLine / d.readEdit を更新。描き直さない
- `select#wk-cat[data-ui=wk][data-key=catalogId] / radio[name=wk-status][data-key=status]（change イベント）` — 「どの取り組み？」optgroup（DES.data.catalog）/ M.statusField の 2 択「完成にする」「試作として残す」works.js:508-514,  → d.catalogId（+catEdited）/ d.status='done'|'trial'
- `wk-read-edit / wk-read-cancel / wk-read-ok（Enter on #wk-read も）/ wk-read-decline` — キャプチャーダイアログ「バディの見立て」琥珀枠 .ai-read-box works.js:516-526, 632-648, 824 → 見立ての編集開始（input 表示）/ 取り消し / 確定（空なら declined:true）/「違う」（text を保持したまま declined:true・以後 提案の材料にしない）。すべて d.read に反映、保存はしない
- `wk-save` — キャプチャーダイアログ footer 主ボタン「作品に残す」（失敗後は「もう一度残す」）works.js:530, 649-682 → M.addCapture(prevActs, prevWorks, {workId:newId('w'), actId:newId('a'), images, title, made, madeLine, status, catalogId, read, now:DES.data.now, date:stamp(), （保存: des3.activities, des3.works（+ commit 経由で全 key 再保存））
- `dialog-close（app.js:286）/ Esc（dialog cancel app.js:602）/ 背景クリック（app.js:603-607）` — #works-dialog の × ボタン・footer「やめる」works.js:479, 531, 596 → DES.app.closeDialog → 開いたボタンへフォーカス戻し。close イベントで wk().dlg=null・中身を空に・#toast を body へ戻す・hash が #works/capture なら #works へ replace（works.js:830-836）
- `wd-back（data-id）` — 詳細「← 作品」リンク works.js:401, 708 → pendingFocus='work:<id>' を立てて hash=#works（一覧で該当カードに focus）
- `wd-edit（data-arg=title|like|craft|read）` — 詳細 h1 横「直す」/ 本人の言葉ブロックの「直す」または「＋ 書く」/ 見立ての「直す」works.js:325, 352-353, 362, 723-731 → wk().edit={id, field, value} → インライン input#wd-edit-<field> + 「残す」「やめる」を描画し末尾にカーソル
- `wd-edit-ok（ボタン or Enter on input[data-ui=wd-edit]）` — 詳細のインライン編集 works.js:317, 732-744, 826 → field=read なら W.setRead（空確定 → declined:true）、それ以外 W.edit（空タイトルは元のまま・like/craft は空で null）。変化なしなら描き直しのみ。変化あれば saveWorks → 失敗時は状態を戻し save_fail トースト（保存: des3.works）
- `wd-edit-cancel（ボタン or Esc ※dialog が開いていない時）` — インライン編集 works.js:317, 745-751, 827 → wk().edit=null → 元の表示へ・「直す」に focus
- `wd-read-decline（data-id）` — 詳細「バディの見立て」ブロックの「違う」（見立てがある時だけ）works.js:364, 752-760 → setRead({text 保持, edited:true, declined:true}) → saveWorks → トースト removed_toast「外したよ」+「元に戻す」（before へ復元）（保存: des3.works）
- `wd-status（data-id）` — 詳細 操作行「完成にする」⇔「試作に戻す」works.js:336, 761-766 → W.setStatus でトグル → saveWorks → トースト to_done_toast「完成にした」/ to_trial_toast「試作に戻した」。一覧の段が変わる（保存: des3.works）
- `wd-remove（data-id）` — 詳細 操作行「作品から外す」ゴースト works.js:339, 768-779 → W.remove（作品レコードだけ・活動は残る）→ saveWorks(navigate: pendingFocus='works-h', replace('#works')) → トースト removed_work「作品から外した」+「元に戻す」（W.restore で元の位置へ・focus work:<id>）。確（保存: des3.works）
- `wd-continue（data-id）` — 詳細 操作行 橙「続きを作る」（活動が無ければ disabled・title=story_lost）works.js:333, 780 → M.openAct(actId): paused/closed/stopped なら resume して DES.app.change で保存 → #make/<actId>（巻き戻さない）（保存: des3.activities（make.js 経由・状態が止まっていた時のみ））
- `wd-from-here（data-id）` — 詳細 操作行「この時点から作る」（活動が無ければ disabled）works.js:334, 781 → M.openWork(id): reopenAt(a, w.at, w.snap, time) で残した時点を新しい変化として積み保存 → #make/<actId> + トースト tx(change.what)（保存: des3.activities（make.js 経由））
- `wd-share（data-id）` — 詳細 操作行「見せる」（aria-haspopup=dialog）works.js:335, 782, 542-549 → openShare: wk().dlg={type:'share', id, to:[], scope:'work'} → #works-dialog を showModal、最初の checkbox に focus
- `wd-map（a[href=#map] data-id）` — 詳細 操作行「学びマップで見る」works.js:338, 783 → DES.map.show('act:<actId>' or 活動が無ければ 'work:<id>') → mapUi.sel.made/view='made' を保存して #map へ（map.js:2539-2548）（保存: des3.mapUi（map.js saveUi 経由））
- `wd-unshare（data-id, data-arg=shareId）` — 詳細「見せる」ブロックの各行「見せるのをやめる」works.js:377, 784-793 → W.unshare → saveWorks(focus wd-shares:<id>) → トースト unshared_toast「見せるのをやめた」+「元に戻す」（W.undoUnshare で元の位置へ）（保存: des3.works）
- `wd-frame（data-id, data-arg=frameId: '@base' | changeId | '@work'）` — 詳細 主役の ol.sf-strip 内 button.sf-frame（aria-pressed）works.js:285-292, 709-715 → wk().frame.sel=frameId → 上の大きな絵を差し替え（DES.app.render）→ 同じコマに focus
- `wd-compare` — 詳細 主役 .sf-tools「1 つ前と比べる」/「比べるのをやめる」（先頭コマ選択中は disabled・title=compare_none）works.js:308-309 → wk().frame.cmp をトグル → .compare-pair.sf-compare で 2 枚並置
- `gl-put / gl-take（gallery.js:757, 803 が処理）` — 詳細 右列「作品展示」ブロック（DES.gallery.workBlock が描く）works.js:382-385, gallery.js:671-680 → 作品展示へ出す / 外す。from=capture か名前未設定なら #gallery-dialog が開く。works.js は描く場所を提供するだけ（保存: des3.gallery（gallery.js setGal 経由））
- `checkbox[name=wk-to][data-ui=wk-share][data-key=to] / radio[name=wk-scope][data-key=scope]（change）` — 見せるダイアログ「見せる相手」3 択（担当のサポーター / おうちの人 / 教室の友だち）/「見せる範囲」2 択（作品だけ / 作ってきた流れも）works.js:583-589, → d.to / d.scope を更新 → syncShare: #wk-share-preview（相手に見える内容の箇条）を差し替え・#wk-share-need の hidden・確定ボタンの disabled を同期（フォーカスを動かさない）
- `wk-share-ok` — 見せるダイアログ footer 主ボタン「見せる」（相手 0 人は disabled・aria-describedby=wk-share-need）works.js:595, 68 → W.share(works, id, {to, scope, time: stamp()+' '+DES.data.now}) で w.shares に 1 件追加 → save('works')。失敗: 戻して d.failed・.dlg-error save_fail。成功: closeDialog（開いた「見せる（保存: des3.works）
- `ドラッグ` — — → works.js にドラッグ処理は無い（grep: dragstart/pointer 無し）。sf-strip は overflow-x:auto のスクロールのみ

### ダイアログ・シート

- dialog#works-dialog（class make-dialog works-dialog、index.html:38）— キャプチャー（type capture）と見せる（type share）の両方をこの 1 枚で描き分ける（works.js:189 dlgEl, 472-476 render）。aria-labelledby=wk-h。閉じる経路: data-action=dial
- キャプチャーダイアログ内の id/セレクタ: h2#wk-h / fieldset.cap-images > .cap-thumbs > button.cap-thumb[data-action=wk-img] / input#wk-title[data-ui=wk][data-key=title] / fieldset.cap-made > .opt-chips > button.opt-chi
- 見せるダイアログ内の id/セレクタ: p.share-work（絵 .share-thumb + タイトル）/ fieldset.share-pick input[name=wk-to][data-ui=wk-share][data-key=to]（checkbox×3）/ fieldset.share-pick input[name=wk-scope][data-key=scope]（radi
- #toast（app.js:185 がダイアログが開いていれば中にホストし、works.js:830-833 の close で body へ戻す）
- 間接: dialog#gallery-dialog（works 詳細の gl-put が開く。gallery.js 側）、#make-dialog は works からは開かない

### 状態

- **一覧 空（作品 0 件）**: 見出し右の橙ボタンを出さず、.works-empty に破線 button.work-add「写真・スクショを入れる」+ p.empty-line works_empty「作るで残したものや、外で作ったものの写真がここに並ぶよ」（es: 「つくるでのこしたものや、外でつくったものの写真がここにならぶよ」）works.js:249, 254-259 / 契約 W-2「両方空なら既存の破線枠 + 1 文」
- **一覧 段が片方だけ空**: 空の段は見出しごと出さない（works.js:252-253、契約 W-2）
- **一覧 共有中の印**: カードの foot に chip.k-shown shown_badge「見せている」（shares.length>0 の時だけ。works.js:233, isShown:39）
- **詳細 存在しない id**: 一覧を描画 + トースト not_found_work「見つからなかったよ」+ location.replace('#works')（works.js:415-420、契約 W-3）
- **詳細 元の活動が消えている（act(w.actId) 無し）**: 主役は作品の絵 1 枚 + p.sf-note story_lost「作った時の記録は残っていないよ」。「続きを作る」「この時点から作る」は disabled（title=story_lost）（works.js:299, 333-334、契約 W-3）
- **詳細 変化が 0〜1 個（frames≦2）**: 大きな絵 1 枚 + story_none「まだ変わってきたところはないよ」。コマ列・比べるを出さない（works.js:302）
- **詳細 コマ選択 / 比較中**: 選んだ .sf-frame.on（青枠 var(--own)）、最後のコマ .is-last（墨枠）+ .sf-this「この作品」。cmp=true で .compare-pair.sf-compare に 1 つ前と 2 枚並置、ボタン文言 compare_off「比べるのをやめる」。先頭コマでは disabled + title compare_none「いちばん前のところなので、比べるものが無い」。絵の無い変化は前の絵を .is
- **詳細 インライン編集中（title/like/craft/read）**: .inline-edit に input#wd-edit-<field> + 「残す」「やめる」。Enter 確定・Esc 取り消し。空タイトルは元に戻す（works.js:313-320, 732-751）
- **詳細 本人の言葉 空**: p.wb-empty not_written「まだ書いていないよ」+「＋ 書く」ゴースト（works.js:353）。契約 W-3「まだ書いていないよ ＋ 書く」
- **詳細 バディの見立て（from=capture のみ）**: 琥珀 .wd-block.is-ai + chip ai「バディ」。text あり & !declined: 本文 + 「直す」「違う」。無し/declined: ai_read_none「何を作ったか、まだ分からない。教えてくれたら覚えておくね」+「直す」のみ（works.js:357-367）
- **詳細 見せている / いない**: ul.wb-shares の各行 shares_line「見せている相手: {to}（{time}）」+ pill（作品だけ / 作ってきた流れも）+「見せるのをやめる」。0 件は shares_none「まだ誰にも見せていないよ」（works.js:373-380）
- **キャプチャー 入力中**: 画像 1〜3 枚（選択中 .cap-thumb.on + check、最後の 1 枚は aria-disabled）、未編集の欄は先頭画像の見本値に追従（syncDefaults）。読み取り編集中は #wk-read + 残す/やめる（works.js:454-460, 491-526）
- **送信中**: 無し（localStorage 同期保存。ボタンの無効化・スピナー無し）
- **キャプチャー 保存失敗**: d.failed=true → p.dlg-error[role=alert] save_work_fail「このブラウザに保存できない。作業台の中身は残っている」+ 主ボタン文言 retry_save「もう一度残す」、topbar .save-indicator.fail save_fail「このブラウザに保存できない」。activities/works を保存前へ戻す（works.js:527, 530, 663-673）
- **キャプチャー 保存成功（保存後）**: ダイアログ閉（フォーカスは開いたボタンへ戻さず）→ 一覧の該当カード data-fk=work:<id> に focus → トースト saved_work「作品に残した」。詳細へは遷移しない（works.js:674-681、契約 W-10 既存挙動維持）
- **見せる 相手 0 人**: 確定ボタン disabled + p#wk-share-need share_need_to「見せる相手を 1 つ以上選んでね」表示（≧1 で hidden）（works.js:590, 595, 606-609）
- **見せる プレビュー**: #wk-share-preview に preview_h「相手に見える内容」+ 箇条: pv_title「絵とタイトル「{title}」」/ pv_like or pv_like_none / pv_craft or pv_craft_none、scope=story で + pv_story「変わってきたところ（{n} コマ）」or pv_story_lost + pv_roles（本人 n 回・いっしょに作った人 n 回・バディ 
- **見せる 保存失敗**: d.failed=true → .dlg-error save_fail、状態を戻す、同じボタンで再試行（works.js:691-698）
- **見せる 成功**: ダイアログ閉 → 「見せる」ボタンへ focus → トースト shared_toast「見せたよ（モックなので実際には届かないよ）」→ 詳細に行が増え一覧に「見せている」印（works.js:699-704）
- **詳細の保存失敗（状態切替・編集・外す・見せるのをやめる）**: saveWorks: S().works を prev へ戻し saveFailed=true → renderSaveState（topbar save_fail）→ 再描画 → 操作した場所へ focus → トースト save_fail（works.js:431-449、契約 W-5）
- **取り消し可能トースト（5 秒）**: removed_work「作品から外した」/ unshared_toast「見せるのをやめた」/ removed_toast「外したよ」に undo_restore「元に戻す」ボタン。復元は元の位置（works.js:757, 775, 790）
- **読み取り専用**: works.js に読み取り専用モードは無い。サポーター画面（sup-core.js:236-241）は state.works を読むだけで works.js を使わない

### 架空のまま出してはいけないもの

- キャプチャーの画像: MD.captures の 3 枚のダミー線画からしか選べず、「写真を足す」(wk-file) はトースト demo_media を出すだけ（works.js:491-496, 616）。実ファイル/カメラ入力と実画像の保存・表示が必要
- 「バディの見立て」の本文: captures[].read の固定 1 行（make-data.js:228-230）を syncDefaults が流し込み、保存後は w.read.text として詳細・共有プレビューに AI の出所チップ付きで出る。実生成か空状態（ai_read_none）にする。固定文を「バディが読んだ」ように見せない
- 見本作品 4 件（SEED_WORKS）と §AE-6 の追加見本: 本人の作品として一覧・詳細・兄弟リンク・学びマップ・作品展示に出る。like/craft の文・family への共有記録（11/1 10:30）も固定。本実装では投入しない（make.js:1084 の seedWorks フォールバックと applySeeds を切る）
- 見本活動（seedActivities）の変化列 = 「変わってきたところ」のコマ・時刻・関わり（本人 n 回・田中さん n 回）。実活動データに置き換える
- 共有（見せる）の実体: w.shares に 1 件足すだけで誰にも届かない。トースト shared_toast は「（モックなので実際には届かないよ）」を含む（i18n.js:329）。実際の可視性付与/通知と文言差し替えが必要
- 日付・時刻: stamp() は DES.data.today（2026-11-02 固定）→ '11/2'、時刻は DES.data.now '10:20' 固定。作品の date / atTime / snapTime / share.time がすべて表示文字列（年なし）で保存される（make.js:725-727, 788-790; works.js:192, 657, 687）。実時刻を
- サポーターの識別: DES.supData.supporter.name '田中さん' との名前一致で手伝いを集計から除外（works.js:158-161）・rolesText 表記（make.js:2290）。id ベースの実割り当てにする
- id 生成: DES.plan.newId（Date.now 36 進 + 連番）はクライアント内の一意性のみ。サーバー発行に
- 「学びマップで見る」「作品展示」ブロック: 本実装の map / gallery の実データに依存（works 側は呼ぶだけ）
- 「続きを作る」「この時点から作る」: make.js の活動状態機械（resume / reopenAt）に依存。作るの本実装が先行条件

### 見本として残せるもの

- MD.art による線画 SVG（stage の数値から決定論で描く）— 作るの活動モデルを本実装でも持つなら、作品・コマの「絵」の描画部品としてそのまま使える（見本ではなく描画）
- 「何を作った？」の 6 候補（made_opts）と「見せる相手」3 区分（TO）・「見せる範囲」2 択 — 固定の選択肢として継続可
- i18n の全文言（§W 節 278-335 ほか）— shared_toast のモック注記と demo_media 以外はそのまま。評価語・「版」を出さない方針も維持
- 空状態の文（works_empty / story_none / story_lost / not_written / shares_none / ai_read_none）— 本実装の空状態文としてそのまま
- DES.data.catalog の取り組み一覧 — 教室設定の実データが来るまで「見本の一覧」と明示すれば暫定利用可（ただし作品の catalogId に保存されるので差し替え時の移行が要る）
- 見本作品カード — 残すなら「見本」バッジを付け、本人の作品と同じ編集・共有・展示の操作に乗せない（現状は区別が無いので、そのままでは残せない）
- MD.captures の 3 枚 — 「見本画像」と明示した上でファイル入力の横に置く形ならサンプル画像として残せる（ただし title/read の自動流し込みは止める）

## today

### ルート

| hash | 画面 |
| - | - |
| `#today` | 一覧: page-head（h1「今日のお題」+ td_sub）→ 節「話す・考える」= 対話カード 3 枚（news/talk/philo を dslots から 1 枚ずつ）→ 節「作る・ためす」= カード 3 枚（slots: near/next/new）→ 節「とっておいたお題」（kept が 1 件以上の時だけ）→ 節「サークル対話に持っていく問い」（circle が 1 件以上の時だけ）。today.js:555-574 |
| `#today/<odaiId>（作る・ためすのお題 = TDD.get が返す id）` | 詳細: 戻る「今日のお題」→ td-head（大きい絵 \| h1 問い・なぜ出したか・印・最初の一歩・必要な物・とっておく／始めた後は「ここだけ変える」「自分の案にする」+ 自分の問いの inline form）→ 入口 4 枚（短い動画を見る / 実物を探す / 試して遊ぶ / 作ってみる）→ 開いている入口の #td-panel（1 つだけ）。today.js:664-679 |
| `#today/<dialogId>（対話のお題 = TDD.getDialog が返す id。見本 9 本 + 工場 fx-*）` | 対話の詳細: 戻る → td-head（絵 \| 種類チップ(+日付)・h1・heavy なら 1 文・なぜ出したか・印・とっておく）→ 入口 3〜4 枚（前提を読む（news は「何があった？」）/ いろいろな考えを見る（views 空なら出ない）/ 問いを選ぶ / 自分の考えを置く）→ #td-panel → 考えのあしあと（marks ありの時）→ 次の一歩（入口を 1 つでも開いた後: バディと話す / サークル対話に持っていく |
| `#today/<無い id>` | 一覧を描いてトースト「見つからなかったよ」+ location.replace('#today')（履歴に残さない。ui.missing で 1 回だけ）。today.js:811-816 |

### 操作（data-action など 34 件）

- `td-swap（data-arg=スロット番号 0..2）` — 一覧・作る・ためすカードの「別のお題を見る」 → TD.swap で同じ fit の次のお題へ（他スロットと重複せず一巡で戻る）→ setOdai = DES.app.change → DES.store.save() → 再描画。motionOK なら旧カードの ghost を重ねて 150ms クロスフェード（200ms 後に除去）。today.js:873-88（保存: des3.odai.slots / des3.odai.rot）
- `td-dswap（data-arg=news|talk|philo）` — 一覧・話す・考えるカードの「別のお題を見る」 → TD.swapKind → putOdai（saveOdai=trySave('odai')）。保存失敗なら state を戻して save_fail トースト・カードは替わらない。成功で同じクロスフェード。today.js:924-935（保存: des3.odai.dslots / des3.odai.drot）
- `td-keep（data-id）` — 一覧カード・詳細・対話詳細の「とっておく」⇔「とっておいた」 → 未保存なら TD.keep（先頭に追加）→ putOdai → トースト「とっておいたよ」（保存失敗なら追加せず save_fail）。既に kept なら unkeepWithUndo（トースト「外したよ」+「元に戻す」5 秒・元の位置へ）。today.js:891-903（保存: des3.odai.kept）
- `td-unkeep（data-id）` — 一覧・下段「とっておいたお題」の「外す」 → unkeepWithUndo。フォーカスは kept が残れば td-kept-h、無ければ詳細なら td-h:<id>、一覧なら today-h。today.js:884-890,903（保存: des3.odai.kept）
- `td-uncircle（data-id）` — 一覧・下段「サークル対話に持っていく問い」の「外す」 → uncircleWithUndo: TD.fromCircle → putOdai → トースト「サークル対話に持っていく問いから外したよ」+ 元に戻す（toCircle 元の位置）。today.js:987-995,1003（保存: des3.odai.circle）
- `リンク a[href=#today/<id>]（data-fk try:/dtry:/ktry:/ctry:）` — カード「やってみる」/ 対話カード「考えてみる」/ kept・circle の小ボタン → hash 遷移で詳細へ。詳細を初めて開いたら h1 へフォーカス（ui.shownDetail）。today.js:472,503,524,547,677,802
- `td-back（data-id）` — 詳細・対話詳細の「← 今日のお題」 → ui.pendingFocus を 出ていた場所（try:/dtry:/ktry:/ctry:/today-h）に決めて hash='#today'。一覧描画後に [data-fk] へフォーカス。today.js:904-908,818
- `td-entry（data-id, data-arg=watch|find|play）` — 詳細・入口カード → ui.open[id] をトグル（同時に 1 つ）→ 開く時は TD.markEntry（tried[id].entries[k]=true = やってみた の記録。回数は出さない）→ setOdai → #td-panel を scrollIntoView。today.js:1019-1025（保存: des3.odai.tried[id].entries）
- `td-make（data-id）` — 詳細・入口「作ってみる」/「続きを作る」 → markAndSave(id,'make')（DES.store.save('odai') を直接・失敗は saveFailed）→ DES.make.openOdai(o, null): 同じ odaiId の活動があれば openAct、無ければ M.fromOdai で活動を作り（origin 'today'・3（保存: des3.odai.tried[id].entries.make / des3.activities（make.js 側）
- `td-change-here（data-id）` — 詳細・始めた後の「ここだけ変える」 → ui.open[id]='play' + markEntry 'play' → setOdai → 最初のスライダー #td-p-<key> へフォーカス。today.js:1033-1040（保存: des3.odai.tried[id].entries.play）
- `td-own-open（data-id）` — 詳細・始めた後の「自分の案にする」（aria-expanded） → ui.own={id, text: お題の問い} をトグル → render → #td-own にフォーカス・カーソル末尾。閉じる時は同ボタンへ refocus。today.js:1041-1049
- `td-own-cancel` — 自分の問いの inline form「キャンセル」/ Escape → ui.own=null → render → 「自分の案にする」へ refocus。today.js:1050,1153
- `td-own-ok（Enter でも）` — 自分の問いの inline form「この問いで作る」（空なら disabled + hint「問いを書いてね」） → markAndSave(id,'make') → DES.make.openOdai(o, text): 既存活動の題を書き換え（元の問いと違えば child メッセージ追加）or 新規活動 → #make/<id>。today.js:1051-1057,1151（保存: des3.odai.tried / des3.activities）
- `input[data-ui=td-hint] change（data-id, data-arg=index）` — 詳細・実物を探す・手がかりチェックボックス 3 つ → TD.toggleHint（checks に index を出し入れ・entries.find=true）→ setOdai。today.js:1145-1147（保存: des3.odai.tried[id].checks / entries.find）
- `td-found-open（data-id, aria-haspopup=dialog）` — 詳細・実物を探す「見つけた写真を残す」 → ui.dlg={id, photo: photos[0].id, line:'', failed:false} → renderDlg → DES.app.openDialog(#today-dialog, el) → .cap-thumb.on にフォーカス。today.js:1073-1079
- `td-found-pick（data-arg=photoId, aria-pressed）` — #today-dialog のダミー線画サムネ 3 枚 → ui.dlg.photo を替えて dialog を描き直し・同じサムネにフォーカス。today.js:1080-1085
- `input[data-ui=td-found-line] input / Enter` — #today-dialog「ひとこと（なくてもいい）」 → ui.dlg.line を更新。Enter は td-found-ok。today.js:1138,1152
- `td-found-ok` — #today-dialog フッター「残す」（失敗後は「もう一度残す」） → TD.addFound（120 字・time=stamp()）→ DES.store.save('odai')。失敗: state を prev に戻し saveFailed・d.failed=true → renderSaveState・dialog に .dlg-error[role=alert]「このブラウザに保（保存: des3.odai.tried[id].found[] / entries.find）
- `dialog-close（共通 action）` — #today-dialog の × と「キャンセル」 → DES.app.closeDialog。dialog の close イベントで中のトーストを body に戻し ui.dlg=null・中身を空に。today.js:830,845,1155-1160
- `td-found-del（data-id, data-arg=index）` — 詳細・実物を探す「残した写真」各項目の「消す」 → 確認なしで TD.removeFound → setOdai（フォーカスは次の「消す」か「見つけた写真を残す」）→ トースト「残した写真を消したよ」+ 元に戻す（restoreFound 元の位置）。today.js:1064-1072（保存: des3.odai.tried[id].found）
- `input[data-ui=td-play] input（data-id, data-key）` — 詳細・試して遊ぶのスライダー 1〜2 本 → ui.play[id] に値（保存しない）→ TD.play（決定論）→ patchPlay で線画 SVG・output・aria-valuetext・結果 1 行「このモックでの動き: …」を DOM パッチ（再描画なし）。today.js:1127-1134,1113-1124
- `td-dentry（data-id, data-arg=facts|views|asks|mine）` — 対話詳細・入口カード → TD.openDEntry: ui.open をトグル → 開く時 TD.markOpen（think[id].opened[k]=true）→ saveOdai。保存失敗なら入口も押す前に戻し save_fail。成功で commit・#td-panel を scrollIntoView。today.js:937-9（保存: des3.odai.think[id].opened）
- `input[data-ui=td-ask] change（radio name=td-ask）` — 対話詳細・問いを選ぶ（check/self/open の 3 つ） → TD.pickAsk（ask=level・opened.asks=true）→ putOdai（フォーカスは選んだラジオ）。選び直し可。「自分の考えを置く」の上に「この問いで考える: …」が出る。today.js:1143,244-254,737-739（保存: des3.odai.think[id].ask）
- `input[data-ui=td-stance] change（radio name=td-stance、末尾に「まだ決めない」=none）` — 対話詳細・自分の考えを置く → ui.dmine[id].stance（保存しない）→ syncMine: 「置く」の disabled 解除・hint「考えを 1 つ選ぶと置けるよ」を隠す。today.js:1144,946-950
- `input[data-ui=td-mark-line] input / Enter` — 対話詳細・自分の考えの 1 行（maxlength 80） → ui.dmine[id].line。Enter で td-mark-put。today.js:1139,1150
- `td-mark-put（data-id）` — 対話詳細「置く」（立場未選択は disabled） → TD.putMark（id=mkN 採番・line 80 字・time=stamp()・先頭に追加・opened.mine=true）→ putOdai。成功時だけ 1 行を空に（立場は残す）→「置く」にフォーカス → トースト「考えのあしあとに置いたよ」。失敗は入力を残して save_fail。today.js:95（保存: des3.odai.think[id].marks）
- `td-mark-del（data-id, data-arg=markId）` — 対話詳細・考えのあしあと 各件の「外す」 → TD.removeMark → putOdai（フォーカスは隣の「外す」か「自分の考えを置く」入口）→ トースト「あしあとから外したよ」+ 元に戻す（restoreMark・id が重なれば新 id・restoredMarkId へフォーカス）。today.js:964-974（保存: des3.odai.think[id].marks）
- `td-dtalk（data-id）` — 対話詳細・次の一歩「バディと話す」 → TD.addTalk: S().draft.text に next.talk（表示の学年の文）を改行して足す → trySave('draft')。失敗は下書きを変えず save_fail・移動しない。成功で commit → トースト「入力欄に入れたよ。送るで相談できる」→ DES.ui.focusComposer=（保存: des3.draft）
- `td-dcircle（data-id, aria-pressed）` — 対話詳細・次の一歩「サークル対話に持っていく」⇔「サークル対話に入れてある」 → 未登録なら TD.toCircle({ask: think[id].ask, time: stamp()}) 先頭に追加 → putOdai → トースト「サークル対話に持っていく問いに入れたよ」。登録済みなら uncircleWithUndo。予定表（des3.plan）は変えない。today.js:996-1002（保存: des3.odai.circle）
- `td-dmake（data-id）` — 対話詳細・次の一歩「作ってみる」/「続きを作る」 → TD.dialogMake: TDD.makeOdaiOf（題=next.makeTitle・手順=next.makeSteps・makeTheme null）→ M.fromOdai（既存なら openAct）→ M.addAct（trySave('activities')）。失敗は活動を足さず save_fail・（保存: des3.activities）
- `keydown Escape` — 詳細で自分の問い form を開いている時（dialog が開いておらず route==='today'） → td-own-cancel。today.js:1153
- `TD.render(main, arg)（app.js の render 分岐）` — route 'today'（前方一致 PREFIX） → arg 無し=一覧 / TDD.get=詳細 / TDD.getDialog=対話詳細 / 無い id=一覧+トースト+replace。描画後 ui.pendingFocus の [data-fk] へフォーカス。today.js:805-819, app.js:86-96,449
- `TD.resetUi()（app.js closeTransient）` — ルートが変わる時 → ui.open/play/own/shownDetail/missing/fresh/dfresh/dmine を初期化（pendingFocus は残す）。today.js:821, app.js:518-528
- `DES.store.load / save の包み（モジュール読込時）` — today.js 読み込み時に DES.store を一度だけラップ → load: localStorage 'des3.odai' を JSON.parse → TD.normalize（例外は saveFailed）。save(only): 元の save を呼び、only 無しの時は 'odai' も保存。today.js:383-400（保存: des3.odai）

### ダイアログ・シート

- dialog#today-dialog.make-dialog.today-dialog（index.html:39）= 「見つけた写真を残す」小ダイアログ。中身: .dialog-head > h2#td-dlg-h + button[data-action=dialog-close].icon-btn / .dialog-body > fieldset.cap-images（legend「どの
- トースト #toast（DES.app.toast）: 開いている dialog の中に置かれる（app.js:185 に '#today-dialog' をハードコード）。元に戻す付きは 5 秒、無しは 2.6 秒（app.js:188-215）
- インライン（dialog ではない）: div.inline-edit.td-own[data-fk=td-own:<id>]（自分の問い。input#td-own, p.hint#td-own-need[hidden]）today.js:644-653 / section.td-panel.card#td-panel[tabindex=-1]（開いた入口の中身。aria-labelledby=t
- 他モジュールへの遷移: #make/<id>（作るの作業台。DES.make.openOdai / openAct）と #talk（DES.ui.focusComposer）
- app.js closeTransient が閉じる一覧に '#today-dialog' が含まれる（app.js:520）

### 状態

- **一覧の空状態**: 存在しない。initial() が各プールの先頭を入れるため常に 6 枚（today.js:31-36）。kept / circle 節は 0 件なら節ごと出さない（keptSec/circleSec が null。today.js:511-514,533-536）。contract-app AF-2「下段に…がある時だけ、その節を出す」
- **無い id**: 一覧を描き、トースト「見つからなかったよ」(td_not_found) を 1 回出し、location.replace('#today')。today.js:811-816 / CONTRACT-v3 X-2「無い id は #today へ replace + トースト『見つからなかったよ』」
- **カード入れ替え中**: .odai-card.swap-in のアニメーション 150ms + 旧中身の .odai-ghost[inert][aria-hidden] を重ねて消す。reduced-motion（html.reduced-motion か prefers-reduced-motion）は即時。today.js:420-423,863-882, today.css:14-18
- **入口 開いている / 閉じている**: button.td-entry.on + aria-expanded=true + aria-controls=td-panel。同時に 1 つ。閉じると #td-panel が消える。開いたことだけ記録（画面に回数・完了は出さない。今日.js:4 / X-2）。today.js:576-591,681-694
- **始めた後（作る・ためす）**: isStarted（entries のどれかが true）で頭の操作に「ここだけ変える」「自分の案にする」が足される。today.js:654-663
- **自分の案 入力中**: .td-own form が出て「この問いで作る」は空なら disabled、hint「問いを書いてね」(td_own_need) 表示。Enter で送る / Escape で閉じる。today.js:644-653,1058-1062,1151-1153
- **作ってみる 2 回目（同じお題の活動あり）**: 入口の文言が「続きを作る」(resume_make) +「この問いから作った作業台を開く」(td_d_resume)。対話詳細の次の一歩も「続きを作る」。actFor(id) = activities の odaiId 一致。today.js:417,580-585,779
- **立場 未選択（対話）**: 「置く」disabled + hint#td-mark-need「考えを 1 つ選ぶと置けるよ」。選ぶと即時解除（syncMine）。today.js:737-753,946-950 / AF-4 の 4「立場を選んでいない時は『置く』を disabled にし、理由を 1 行で出す」
- **問いを選んだ後**: 「自分の考えを置く」パネル上部に .td-chosen「この問いで考える」+ 問いの文。サークルに持っていく時はその level が入る。today.js:739,996-1001
- **考えのあしあと あり**: section.td-marks に ol（新しいものが上。時刻・立場ラベル・1 行・「外す」）。0 件なら節ごと出さない。today.js:760-771
- **次の一歩 表示**: isOpened（think.opened のどれか true）の時だけ section.td-next。today.js:772-782,801 / AF-4 の 5「入口を 1 つでも開くと『次の一歩』の行が出る」
- **サークルに入れてある**: ボタン文言「サークル対話に入れてある」(td_next_circle_on)・.is-on・check アイコン・aria-pressed=true。一覧下段にも出る。today.js:775-777
- **とっておいた**: ボタン文言「とっておいた」(td_kept_btn)・.is-on・check アイコン・aria-pressed=true。today.js:456-460
- **保存失敗（共通の約束）**: state を前に戻し、移動・成功トースト・切替をしない。トースト「このブラウザに保存できない」(save_fail)。topbar の .save-indicator.fail（app.js:389,407）。dialog 内は .dlg-error[role=alert] + ボタンが「もう一度残す」(retry_save) になり閉じない。today.js:913-922,1094-1102 / contract-app 539-
- **保存後（成功）**: トースト: 「とっておいたよ」「見つけた写真を残したよ」「考えのあしあとに置いたよ」「サークル対話に持っていく問いに入れたよ」「入力欄に入れたよ。送るで相談できる」。外す系は「外したよ」「残した写真を消したよ」「あしあとから外したよ」「サークル対話に持っていく問いから外したよ」+「元に戻す」5 秒。i18n.js:75,92,349,371,379,653,655,660,662
- **heavy（重い話題）**: カード・詳細にチップ「サポーターと読む」(td_heavy)、詳細の問いの下に .td-heavy-note「このお題は、サポーターといっしょに読むことになっているよ」。today.js:486-491,787 / AF-4
- **工場のお題（source factory）**: 出所チップ「工場で作って確かめたお題」(td_src_factory)、reason が null なので「なぜ出したか」行を出さない、art null なので kind ごとの既定線画（dk_news/dk_talk/dk_philo）。today.js:445,489, today-data.js:406-407,1017 / AF-9
- **外からの依頼（source request）**: チップ「外からの依頼」(send アイコン) + 「締切 {date}」(td_due) — due がある時だけ。それ以外は AI チップ「バディが作ったお題」。today.js:447-455
- **サポーターと確認（safety）/ 屋外（outdoor）**: チップ「サポーターと確認」(td_safety)。outdoor なら実物を探すの手がかりの上に「外に出る時はサポーターと確認してね」(td_out_note)。today.js:449,603
- **短い動画を見る**: 16:9 の枠に線画 + 「公式チャンネルの動画（モックでは再生しない）」(td_video)、出典 1 行、見どころ 3 つ。外部埋め込みなし（file:// 前提）。再生状態は存在しない。today.js:592-600 / X-2 の 1
- **試して遊ぶ 入力中**: ui.play[id]（保存しない・ルート変更で消える）。結果ラベル「このモックでの動き」(td_play_label)。today.js:624-639,1127-1134 / X-2 の 3「結果は『確かめたこと』ではなく『このモックでの動き』と明記」
- **参考になる資料 あり / なし**: learn:true の出典が 1 つ以上ある時だけ section.td-learn（https:// だけ a[target=_blank][rel=noopener noreferrer]、それ以外は名前だけ）。無ければ欄ごと出さない。today.js:358-365,695-706 / contract-T v2.9（582-592）
- **確かめた日 あり / なし**: facts に src を持つものがある時だけ「確かめた日: {y} 年 {m} 月 {d} 日」（sources[0].checked。工場のお題は取り込んだ日）。today.js:707-717
- **いろいろな考え 無し**: views が空なら入口を出さず 3 枚（.td-entry-grid.n3）。末尾の 1 行「ここにない考えもあるよ」(td_views_more) は views ありの時。today.js:681,718-725
- **読み取り専用**: 存在しない（サポーター「一緒に入る」は sup-core.js が found+ をログするだけで today.js に read-only 分岐はない。sup-core.js:243-248）
- **送信中**: 存在しない（localStorage への同期保存。boolean を即時返す契約。store.js:62-70, make.js:925-940）
- **詳細を開いた直後のフォーカス**: h1 へ（ui.shownDetail で初回のみ）。一覧へ戻った時は pendingFocus の [data-fk] へ。today.js:677-678,802,818,904-908 / X-9「詳細を開いたら h1 にフォーカス」

### 架空のまま出してはいけないもの

- 「なぜ出したか」(reason) の全文 — 本人の会話・活動を見たかのような架空の観察（例 today-data.js:439「『Python のゲーム作りやってみたい』と話していたから」、732）。AI チップ「バディの提案」を付けて出すので、実バディの生成か null（行を出さない）にする
- 出所チップ「バディが作ったお題」（source 'buddy'）— 見本データに付けると「バディが作った」が嘘になる。実バディ生成 / 'factory' / 「見本」の 3 値に分ける（today.js:452,490）
- od-acorn-card の「外からの依頼」+「締切 11/20（金）」（today-data.js:597-601）— 架空の図書館からの依頼。実在の依頼レコードが無ければ出さない
- 「短い動画を見る」の枠 + 出典「…公式チャンネル（架空）」+ 見どころ 3 つ（today-data.js:440-444 ほか、today.js:592-600、i18n td_video「モックでは再生しない」）— 実動画の URL が無い入口は出さない
- 「見つけた写真を残す」のダミー線画 3 枚からの選択（today.js:824-848, 1073-1110）— 本人の実写真（カメラ/ファイル）+ 保存先。残した写真の表示（findEl 612-620）と trail の「見つけた」(trail.js:144-151) も実画像に
- 記録の時刻 stamp() = DES.data.today/now の固定値 'M/D HH:MM'（today.js:418。marks.time / found.time / circle.time と td-dmake の now）— 実時刻
- 初期の 6 枚（initial() がプール先頭）と「別のお題を見る」の固定回転（swap/swapKind）— 工場の当日の予定（day=）とストックから出す。デモ日付 2026-11-02 と工場の「今日」がずれる
- topics-live.js の焼いたスナップショット（pulledAt 2026-11-06、1 件）— 実行時に配信 API を読む（モックの「fetch 禁止」(design.md §5) は本実装では解除が要る）
- 「確かめた日」の CHECKED '2026-11-06'（today-data.js:721）— 実際に確かめた日（工場 sources[].checked）
- 「作ってみる」が作る活動（des3.activities に origin 'today'・odaiId・odai_rec メッセージ。make.js:156-186）— 実保存の活動として。同じお題の 2 回目判定（actFor / fromOdai の odaiId 一致）も実データで
- 試して遊ぶの結果「このモックでの動き」（i18n td_play_label）— 本実装でこの文言のまま出さない。残すなら「見本の動き」等に、無くすなら入口ごと
- 対話の見本 9 本を「今日のお題」として出すこと（kindPool の後ろに常に 9 本入る。today-data.js:1015-1018）— 本実装は工場のお題だけ（または見本と明示）
- 作る・ためすの 12 本（本人の好き マイクラ/Python/回路 に合わせた題）— 工場 kind=make か バディ生成

### 見本として残せるもの

- 2 色線画 SVG（ART / drawArt / cardArt / KIND_ART dk_news・dk_talk・dk_philo。today-data.js:52-408）— お題の既定の絵として（「絵は見本」と明示すれば）
- 対話の見本 9 本の facts / views / asks / stances / sources（2026-11-06 に実在の出典で確認済み。design.md §6）— 「見本のお題」と明示し、出所チップを「バディが作ったお題」にしない条件で
- 試して遊ぶのスライダーと決定論の結果（play.sliders / result）— 「見本の模型」と明示すれば残せる（結果が本人の確かめたことではないという注記は契約 X-2 の 3 の趣旨）
- 探す手がかり 3 つ（find.hints）・最初の一歩・必要な物・makeSteps・next.makeTitle / makeSteps / talk の文 — 題材の見本文として
- i18n の td_* 文言（i18n.js:336-379,621-663,684）・トースト・空状態の挙動・レイアウト（today.css）
- 禁止語の配列 TDD.FORBIDDEN（点数・ランキング・順位・評価・成績・レベル。today-data.js:981）と importLive の検査（931-1012）
- pull-topics.mjs の変換・検査ロジック（convertTopic / validateDialog / buildTopics の lineage 重複排除）— 実装の土台として流用可
- 見つけた写真のダミー線画は「写真が無い時の枠」(TDD.frameOnly) としてだけ

## gallery

### ルート

| hash | 画面 |
| - | - |
| `#gallery` | 一覧（renderList）: 見出し「作品展示」+ gl_sub/gl_sub2 + 呼び名行（決めている時）+ 自動切替 + 届いた声かけ（あれば）+ いっしょに作る約束（あれば）+ 種類チップ + カード格子。見本 8 件 + 自分の出した作品を新しい順 |
| `#gallery/<itemId>` | 詳細（renderDetail）: itemId は見本 id（g-*）か自分の作品 'my-<workId>'。戻る / 大きい絵 / 題 / 呼び名・種類・自分の作品・バディと作った の印 / 気に入っている・工夫した / 反応 / ひとこと / 声をかける（他人の作品のみ）。無い id は renderList + トースト「見つからなかったよ」+ location.replace('#gallery') |

### 操作（data-action など 19 件）

- `gl-back` — 詳細 上部の戻るリンク（a.link-btn href=#gallery） → ui.pendingFocus='glc:<itemId>' を置き hash を #gallery へ。戻った一覧で元のカードへフォーカス（保存: なし（DES.ui.gl のみ））
- `gl-filter` — 一覧 種類チップ（.opt-chip data-arg=all|minecraft|…）aria-pressed → ui.cat を更新して DES.app.render、同じチップへ refocus。並んでいない種類が選ばれていたら all へ戻す（保存: なし（DES.ui.gl.cat は非永続））
- `gl-name` — 一覧 呼び名行の「呼び名を変える」（aria-haspopup=dialog） → #gallery-dialog を kind:'name' で開く（現在の呼び名を入力欄に）（保存: なし（確定は gl-dlg-ok））
- `gl-put` — 作品の詳細（works.js）節「作品展示」の「展示に出す」（G.workBlock 経由） → 呼び名あり & from!=='capture' → 即 put()・保存・トースト「展示に出したよ」・フォーカスは「展示から外す」へ。呼び名なし or 写真から入れた作品 → ダイアログ kind:'put'（needName / face）（保存: des3.gallery.mine[workId]={state:'in',time}）
- `gl-dlg-ok` — #gallery-dialog 主ボタン（決める / 展示に出す）。gl-name 入力の Enter でも発火 → needName なら setName（空/13 字以上は syncName で disabled のまま）→ kind put なら put、kind auto なら setAuto(true)。save('gallery') 失敗で状態を戻し .dlg-error[role=alert] を出してダイアログは開いた（保存: des3.gallery.name / .mine / .auto）
- `dialog-close` — #gallery-dialog の × と「やめる」（app.js 共通ハンドラ）+ dialog 'close' イベント → gallery.js の close リスナーが #toast を body に戻し ui.dlg=null・dialog を空にする（保存: なし）
- `gl-take` — 作品の詳細 節「作品展示」の「展示から外す」/ 展示の詳細（自分の作品）の「展示から外す」（data-arg=detail） → take() で out に。詳細からは location.replace('#gallery') + pendingFocus gl-h。トースト「展示から外した」+「元に戻す」（restoreTake）。確認ダイアログなし（保存: des3.gallery.mine[workId]={state:'out',time}（元に戻すで前の記録 or 削除）
- `gl-react` — 詳細（他人の作品）反応ボタン 3 つ（.gl-react-btn data-arg=like|how|try, aria-pressed） → 押すと入る・もう一度で外れる。押した人の呼び名チップに「自分」（or 呼び名）が増減。数は出さない（保存: des3.gallery.reacts[itemId]=['like'|'how'|'try']）
- `gl-note-send` — 詳細 ひとこと欄の「送る」（#gl-note の Enter でも。isComposing は無視） → ui.sending={itemId} → 入力 readonly+aria-busy・全作品の送るが disabled・「AI が先に読んでいるよ」(role=status) → setTimeout 1000ms → addNote（guard → ok|hold、80 字 cp で切る）→ 保存。ok: スレッド（保存: des3.gallery.notes[] += {id:newId('gn'),itemId,text,state,ti）
- `gl-note-del` — 詳細 自分のひとこと（スレッド / 保留枠）の「取り消す」 → removeNote → トースト「ひとことを取り消したよ」+「元に戻す」（restoreNote、元の位置へ）（保存: des3.gallery.notes）
- `gl-call-pick（data-ui, change）` — 詳細 声をかける の radio-card 3 択（together/teach/continue） → ui.pick[itemId]=kind、「届ける」を有効化・ヒント「どれか 1 つ選ぶと届けられるよ」を隠す（保存: なし（非永続））
- `gl-call` — 詳細（他人の作品）「届ける」（btn orange） → call() で state 'sent' を 1 件（同じ作品に 1 つまで）。表示が pill+「{name}さんの返事を待っているよ」+「取り消す」に変わる。トースト「声かけを届けたよ」（保存: des3.gallery.calls[] += {id:newId('gc'),itemId,kind,state:'s）
- `gl-call-cancel` — 詳細 待ち状態の「取り消す」 → cancelCall（sent の時だけ）→ radio へ refocus、トースト「声かけを取り消したよ」+「元に戻す」（restoreCall）（保存: des3.gallery.calls）
- `gl-answer` — 一覧 「届いた声かけ」行の「OK する」（orange）/「今はやめておく」（data-arg=ok|later） → answer()。ok → promises の先頭に {id:'p-'+inboxId（重複時 -2,-3…）, with, title, actId:null, time}、トースト「いっしょに作る約束に入れたよ」、フォーカス gl-promise-h。later → トースト「今はやめておく、と返事したよ」。理由（保存: des3.gallery.inbox[].state / .promises[]）
- `gl-prep` — 一覧 「いっしょに作る約束」行の「先に準備する」 → p.actId の活動があれば DES.make.openAct（2 回目は同じ活動）。無ければ DES.make.fromPromise で外で作る活動（origin 'gallery'・promiseId・題「{title} を いっしょに作る」・手順 GD.PREP_STEPS・題材 CAT_THEME[prom（保存: des3.activities（新規活動）+ des3.gallery.promises[].actId）
- `gl-auto（data-ui, change）` — 一覧 上の切替 checkbox「完成にした作品を、自動で展示に出す」（#gl-auto） → 入れる時に呼び名が無ければ checkbox を戻して kind:'auto' のダイアログ。あれば setAuto → トースト「完成にした作品が展示に並ぶよ」/「自動で出すのをやめたよ」。完成(status done) & from!=='capture' & out でない作品が並ぶ（保存: des3.gallery.auto）
- `gl-note / gl-name（data-ui, input）` — 詳細 #gl-note 入力 / ダイアログ #gl-name-in 入力 → gl-note: fitNote で 80 cp に切り ui.draft[itemId] に保持、送るの disabled とヒントを切替。gl-name: ui.dlg.text を更新し syncName（決めるの disabled と理由 1 行だけ差替）（保存: なし（下書きは DES.ui.gl.draft、非永続・ルート移動で残る））
- `（暗黙）settleOnOpen` — #gallery 一覧を開いた時（ui.entered が false の初回。closeTransient でリセット） → G.settle: 送った声かけのうち見本 answers 'ok' → state ok + 約束追加、'later' → later。seeded=false で自分の作品が 1 件以上出ていれば inbox に 'in-seed'（そらまめ・いっしょに作りたい）を 1 件足し seeded=true。変わった時だ（保存: des3.gallery.calls / .promises / .inbox / .seeded）
- `（リンク）a.gl-card / 作品のページで開く / 作品を見る / 作品展示を見る` — 一覧カード全体 href=#gallery/<id>（data-fk glc:<id>）/ 詳細（自分の作品）#works/<workId> / 空状態 #works / work → hash 遷移のみ（保存: なし）

### ダイアログ・シート

- #gallery-dialog — dialog.make-dialog.gallery-dialog。gallery.js:386-391 がスクリプト読込時に document.body へ append。aria-labelledby=gl-dlg-h。kind: 'name'（呼び名を変える）/ 'put'（展示に出す。needName・face）/ 'auto'（自動切替の初回）
- #gallery-dialog の内側セレクタ: #gl-dlg-h（h2）/ .gl-dlg-work（作品題）/ #gl-name-in（input data-ui=gl-name, aria-describedby=gl-name-hint gl-name-why）/ #gl-name-hint（「本当の名前は使わないでね」）/ #gl-name-why（理由 1 行, hidden 切替）
- 開閉は DES.app.openDialog(dlg, opener)（showModal + 戻り先記録）/ DES.app.closeDialog(dlg, noReturn)。app.js closeTransient（app.js:520）がルート変更時に閉じる。描き直しは DES.make.clearDialog（#toast を退避して戻す）
- sheet / drawer: このモジュール固有のものは無し（390 の nav drawer #nav-drawer は app.js のもの）

### 状態

- **空（展示 0 件）**: .gl-empty 破線枠 + 「まだ展示に作品がないよ。作品のページから出せるよ」(gl_empty) + btn「作品を見る」→#works。チップも格子も出さない。モックでは GD.items が常に 8 件あるため到達しない
- **一覧・通常**: 見出し「作品展示」/「教室のみんなが、見せてもいいよと出した作品。見られるのは、同じ教室の人とサポーターだけ」/ 小さく「サポーターは、展示のやりとりを全部見られるよ」/ 切替の下に「写真から入れた作品は、1 つずつ出してね」/ チップ「すべて」+ 並んでいる種類だけ / カード: 絵・題・呼び名・種類チップ、自分の作品に「自分の作品」チップ（.is-mine 緑枠）
- **呼び名 未設定 / 設定済**: 未設定: 呼び名行を出さない。自分の表示名は「自分」(gl_me)。展示に出す・自動切替の初回でダイアログ「展示での呼び名」。設定済: .gl-name 行「呼び名 {name}」+「呼び名を変える」
- **呼び名 入力中（検証）**: 空 →「呼び名を 1 字以上書いてね」、13 字以上 →「呼び名は 12 字までにしてね」を #gl-name-why に出し「決める」disabled。字数はコードポイント
- **写真から入れた作品を出す**: ダイアログに .gl-face「写真に、人の顔や名前が写っていないか見てね」を確定前に表示。自動切替では並ばない
- **作品の詳細 節「作品展示」(works.js)**: 出していない: btn「展示に出す」(+plus icon)。出している: 「展示に出している（{time}）」+ btn ghost「展示から外す」
- **ひとこと 入力中**: ヒント「1 字以上書くと送れるよ」は下書きがあると hidden。「送る」は canSend(draft, sending) で disabled 切替。入力は 80 cp で即切る
- **ひとこと 送信中**: input readonly + aria-busy=true、全作品の「送る」disabled、.gl-reading[role=status]「AI が先に読んでいるよ」。1000ms 固定（reduced-motion でも同じ）
- **ひとこと 成功（ok）**: スレッド .gl-thread に .gl-msg.is-me（呼び名 or 自分・時刻・本文・「取り消す」）。トースト「届いたよ」。フォーカス #gl-note
- **ひとこと 保留（hold）**: スレッドには出ず .gl-held（砂色）「自分にだけ見えている」+ 本文 + 「このひとことは、サポーターが先に読むことになったよ」+「取り消す」。フォーカス [data-fk=gl-held]。トーストなし
- **ひとこと 無し**: 「まだひとことはないよ」(wb-empty)
- **反応（他人の作品）**: 3 ボタン aria-pressed、on で check アイコン + .on 色。各ボタン横に押した人の呼び名チップ（.k-glname、自分は .is-me）。数字は出さない
- **反応（自分の作品）**: ボタンは出さず、届いた反応だけ「ここが好き: そらまめ…」の列。無ければ「反応が届くと、ここに呼び名が並ぶよ」
- **声かけ 未送信**: radio-card 3 択 + 「届ける」disabled + ヒント「どれか 1 つ選ぶと届けられるよ」（選ぶと hidden）
- **声かけ 待ち（sent）**: pill「いっしょに作りたい」等 + 「{name}さんの返事を待っているよ」+ ghost「取り消す」
- **声かけ 返事あり（ok / later）**: pill + 「OK の返事が来たよ」/「今はやめておく、の返事が来たよ」。操作なし。#gallery を次に開いた時に settle で変わりトーストも出る
- **届いた声かけ（inbox new）**: 一覧上部 section .gl-inbox（橙の左線）「{from}さんから「{work}」に: {kind}」+ 「OK する」(orange) /「今はやめておく」。state new かつ作品が存在する行だけ。見本では初回展示後の次回オープンに 1 件（そらまめ）
- **いっしょに作る約束**: section .gl-promises（緑の左線）「{name}さんと · {title}」+ 「{supporter}に知らせたよ。いっしょに作る時間を決めるのを待っているよ」（supporter = DES.data.supporter.name「田中さん」）+ btn「先に準備する」
- **保存失敗**: setGal が状態を戻し S().saveFailed=true → DES.app.renderSaveState（トップバー表示）+ 再描画 + 元の要素へ refocus + トースト「このブラウザに保存できない」。ダイアログ内は .dlg-error[role=alert] で開いたまま。ひとことは下書きを残す。gl-prep は activities も巻き戻す
- **保存後**: DES.app.commit({sel|focusFn}) で DES.store.save() → render → フォーカス復元。成功トースト（gl_put_toast / gl_taken+元に戻す / gl_sent / gl_call_sent 等）
- **無い id**: 一覧を描き、トースト「見つからなかったよ」（同じ id では 1 回）、location.replace('#gallery')（履歴に残さない）
- **絵の読み込み**: 見本 photo/illust: DES.thumbs にあれば img + 右下バッジ「AI が作ったイメージ」(.gl-ai-mark)、img error で種類の線画へ。自分の作品: safeArt が通れば MD.photoArt/MD.art/work-note、形が違う・例外なら GD.lineArt(cat)
- **読み取り専用の面**: 他人の作品の題・呼び名・気に入っている・ひとこと・反応は固定の見本で変更不可。自分の作品は展示側では「作品のページで開く」+「展示から外す」のみ（本文編集は works）

### 架空のまま出してはいけないもの

- GD.items の架空 8 作品（そらまめ・ペンギン号・もくもく・あおい星・ねこパンチ の呼び名、題、気に入っているところ、時刻）を「教室のみんなの作品」として出すこと
- GD.reacts / GD.notes の固定の反応・会話（作者の返事「3 コマだよ」を含む）を実際のやりとりとして出すこと
- settle() の決定論の返事（answers 'ok'/'later' を次回オープンで『OK の返事が来たよ』にする）— 相手の子の実際の返事に置き換える
- SEED_CALL: 初めて展示に出した後に そらまめ から「いっしょに作りたい」が必ず届く演出（inbox 'in-seed'・seeded フラグ）
- 「AI が先に読んでいるよ」の 1000ms setTimeout + G.guard の語一覧判定を AI の番人として見せること。hold（『サポーターが先に読むことになったよ』）は現状 localStorage に残るだけでサポーターへ届かない
- 約束の状態文「田中さんに知らせたよ。いっしょに作る時間を決めるのを待っているよ」— DES.data.supporter.name 固定 + 実際には誰にも知らせていない
- stamp() の時刻（DES.data.today '2026-11-02' / now '10:20' 固定）を展示・ひとこと・声かけ・約束の時刻として出すこと
- 見出し下の「見られるのは、同じ教室の人とサポーターだけ」「サポーターは、展示のやりとりを全部見られるよ」— モックは教室スコープも共有もサポーター閲覧（sup.js に gallery 参照なし）も未実装
- 自分の 'my-<workId>' 作品は自分のブラウザにしか無い（他の子には見えない）— 展示に出す = 共有ストアへの公開にする
- DES.thumbs の img/gallery/g-*.webp（架空作品の AI 生成画像）を実作品の絵として出すこと
- 自分の反応・ひとこと・声かけが相手に届いている前提の文言（『届いたよ』『声かけを届けたよ』）— 実送信に置き換える

### 見本として残せるもの

- GD.lineArt(cat) の種類ごとの線画（画像が無い時の絵。固定 SVG）
- GD.CATS / THEME_CAT / CAT_THEME の種類マッピングと i18n の gl_cat_*（設定値）
- GD.PREP_STEPS（契約 verbatim の 3 手順）と gl_prep_title「{title} を いっしょに作る」
- GD.BAD_WORDS + guard の規則 — 「クライアント側の前フィルタ」として明示するなら残せる（AI の番人の代わりとしては不可）
- 空状態の文言と全 gl_* の i18n 文字列（検証済み: 評価語・人気・いいね数を含まない）
- 見本の作品カードを残すなら「見本」チップを付け、架空の呼び名を作者として出さない形（例: 作者欄を「見本」）にすれば題・絵の例として残せる（契約 AG-6 はモック期の見本であり本実装の扱いは未規定）
- ダイアログ・保存失敗・元に戻す・フォーカス復元の操作ループ設計（setGal / commit / data-fk）はそのまま移植可

## self

### ルート

| hash | 画面 |
| - | - |
| `#self` | 自己理解ページ（.self-page = 頭 h1/intro/凡例4チップ/日付印 → .self-orbit（5 観点カード + 中央 hub アバター + バディ吹き出し）→ .kufu-band（困りやすいことと工夫）→ .privacy-line）。完全一致ルートのみ・sub-arg なし（app.js:82-91、PREFIX に無い）。描画は app.js:451 `DES.self.render(main)`。サポーター |

### 操作（data-action など 44 件）

- `sx-open` — 各カードの行ボタン .srow-main（見立て / 記録 / 本人の言葉 / gap / 注記 note:<id>） → 行の開閉をトグル（ページで開くのは 1 つ）。gap 行は開くと同時に編集欄 on:<id> を開く。下書き（st.draft）の持ち主なら編集欄を復元。開いていた別の編集欄は leaveEdit（変更なしなら下書き削除）（保存: des3.self.draft（変更なしの下書きを消す時だけ））
- `sx-edit` — カード見出し右の「書く」(add:<axis>) / 行内「今の言葉を足す」「ちがうところを伝える」「自分の言葉で書く」(on:<id>) / 注記の「直す」(note:<id>) → editorInfo(key) で textarea を開く（同じ key をもう一度押すと cancelEdit）。self.js:445-484, 1087-1091（保存: なし（入力中は input イベントで des3.self.draft））
- `sx-fixopen` — 見立て行の開いたパネル「少しちがう」「直す」 → fix:<id> の編集欄を現在の文入りで開く（self.js:1092）（保存: なし）
- `sx-save` — 編集欄の「残す」(.sx-edit 内)。Ctrl/Cmd+Enter も同じ（self.js:1355-1360） → save(key, text) → key の種類で reduce action: fix→rx edited + log / on,add→noteAdd / note→noteEdit / scene:new→sceneAdd / scene:<id>→sceneEdit / idea→ownAdd / oidea（保存: des3.self（rx / notes / kufu.scenes / kufu.own / kufu.ideas /）
- `sx-cancel` — 編集欄の「やめる」。Esc も同じ（self.js:1366） → 下書きを捨てて閉じ、フォーカスを info.ret へ（self.js:1006-1013）（保存: des3.self.draft（削除））
- `sx-agree` — 見立て行（pending / edited）「合ってる」 → rx[id] = agreed（vers 保持・cur -1）+ log 'agree'。ai の形のまま agreed_chip + 日付。トースト t_agree + 戻す（self.js:1098-1102, 145-151）（保存: des3.self.rx / log）
- `sx-away` — 見立て行「今はちがう」 → rx[id] = away + log。行はカード下「外した見立て（n）」折りたたみへ。バディ 1 行 reply_not_now。トースト t_not_now + 戻す（self.js:1103-1107）（保存: des3.self.rx / log）
- `sx-back` — 外した見立ての折りたたみ内「もどす」 → rx away → pending + log 'back'。トースト t_back + 戻す（self.js:1108-1112）（保存: des3.self.rx / log）
- `sx-toai` — agreed / edited 行「見立てに戻す」 → rx → pending（vers は残し cur -1）+ log 'toAi'。トースト t_back + 戻す（self.js:1113-1117）（保存: des3.self.rx / log）
- `sx-use` — 履歴の各版「これに戻す」(data-arg = cur) → cur を動かす: -1 なら pending + log toAi、それ以外は edited + log use。トースト t_back / t_fixed + 戻す（self.js:1118-1122, 184-197）（保存: des3.self.rx / log）
- `sx-hist` — 見立て行「履歴」リンク（開いたパネル・edited の sublinks・外した見立ての中） → 履歴パネルをトグル（版一覧 新しい順 + 元の見立て + log 行）。0 件は history_empty。UI のみ（self.js:1123-1132, 549-570）（保存: なし）
- `sx-talk` — 見立て行「話して伝える」 → toTalk('「' + 見立ての先頭 30 字 + '」')：DES.app.closePlanDialog → DES.app.change で DES.state.draft に 1 行追記 → トースト prefilled → DES.ui.focusComposer = true → hash #talk（s（保存: DES.state.draft（des3.draft、他モジュールの保存））
- `sx-fold / sx-awayfold` — カード下「ほか n 件 / 畳む」「外した見立て（n）」 → ui.fold[axis] / ui.awayOpen[axis] をトグル（self.js:1137-1138）（保存: なし）
- `sx-ndel` — 注記（本人の言葉）行の「消す」 → notes[id].gone = true。トースト t_removed + 戻す（self.js:1139-1144）（保存: des3.self.notes）
- `sx-doornot` — door 行（int-d1）「今はいい」 → door[id] = 'not_now' + log door_not_now。折りたたみへ。トースト t_not_now + 戻す（self.js:1145-1149）（保存: des3.self.door / log）
- `sx-doorback` — 外した door の「もどす」 → delete door[id] + log back。トースト t_back（self.js:1150-1154）（保存: des3.self.door / log）
- `grid-add（plan.js のハンドラ・data-door 付き）` — door 行「予定に入れる」(data-id = activity 'dig-3dprint') → plan.js:1047 act.addFirst が DES.state.plan に行を足す。self.js の document click 監視（self.js:1380-1390）が setTimeout(0) で plan の件数差を見て、増えていれば door[id] = 'added'（チップ in_p（保存: DES.state.plan（des3.plan）→ 成功時 des3.self.door / log）
- `grid-ask（plan.js のハンドラ）` — door 行「相談する」 → plan.js:1048 → DES.talk.prefill(item.title)。self 側は何も書かない（保存: DES.state.draft（des3.draft））
- `sx-goto` — 中央の吹き出しのリンク「その見立てを見る」 → 該当行を開き（fold なら展開）、scrollIntoView。UI のみ（self.js:1155-1163）（保存: なし）
- `sx-goto-kufu` — 吹き出しのリンク「工夫を見る」 → #kufu-band へスクロール・見出しへフォーカス（self.js:1165-1169）（保存: なし）
- `sx-try` — 工夫行「試してみる」 → kufu.ideas[id] = { status 'trying' }。チップ 試し中 + scenes[].when。トースト t_try + 戻す（self.js:1172-1176, 213-217）（保存: des3.self.kufu.ideas）
- `sx-howwas` — trying の工夫行「やってみてどうだった？」 → ui.howwas をトグル → 合った / いまいち / 少し変える + ひとこと input（self.js:1177-1183, 809-816）（保存: なし）
- `sx-result` — 結果パネル「合った」(data-arg fit) / 「いまいち」(meh) → kufu.ideas[id] = { status 'result', result, note }。fit は帯上部「自分に合う工夫」へ移る（フォーカス fitlist）。rnote 下書き削除。トースト t_result + 戻す（self.js:1184-1189, 218-221）（保存: des3.self.kufu.ideas / draft）
- `sx-adjust` — 結果パネル「少し変える」 → ui.rnote を保持して adjust:<id> 編集欄（工夫の文入り）を開く。残すと reduce 'adjust'（trying のまま・text 更新・result 'adjust'・own チップ）（self.js:1190-1194, 222-226）（保存: 保存は sx-save 経由で des3.self.kufu.ideas）
- `sx-kmenu` — 工夫行の「…」icon-btn（aria-label row_ops） → more メニューをトグル（今はいい / tool は 話すで一緒に考える / 本人の工夫は 直す・消す）。外側クリックで閉じる（self.js:1195-1200, 1392-1395）（保存: なし）
- `sx-kaway` — 工夫 more メニュー「今はいい」 → kufu.ideas[id] = { status 'away', prev }。場面の「今はいい（n）」折りたたみへ。トースト t_away + 戻す（self.js:1202-1207, 247-252）（保存: des3.self.kufu.ideas）
- `sx-kback` — 工夫の折りたたみ内「もどす」 → ideaBack: prev へ戻す（idle なら delete）。トースト t_back・戻すなし noUndo（self.js:1208-1213, 253-265）（保存: des3.self.kufu.ideas）
- `sx-kfold` — 場面の「今はいい（n）」 → ui.kfold[sceneId] をトグル（self.js:1214）（保存: なし）
- `sx-ktalk` — tool の工夫 more メニュー「話すで一緒に考える」 → toTalk(ideas[].prefill か kufu.prefill.tool に {scene} を埋めた文)（self.js:1215-1222）（保存: DES.state.draft（des3.draft））
- `sx-kprefill` — 本人が書いた場面（工夫 0 件）の「AI と一緒に」「環境を変える」ボタン (data-arg ai|env) → toTalk(kufu.prefill[kind] に {scene} を埋めた文)（self.js:1223-1227）（保存: DES.state.draft（des3.draft））
- `sx-kmake` — データの tool の工夫行「作るで作る」（紐づく活動が無い時のみ） → DES.make.openFromSelf({ linkId: 工夫 id, text, variant, src: 直していれば own / 元なら buddy }) → make.js:1235 が活動を先頭に足し #make/<id> へ（self.js:1230-1236）（保存: DES.state.activities（des3.activities、make.js の保存））
- `sx-kscene-make` — 本人が書いた場面（工夫 0 件）の「道具を作る」 → DES.make.openFromSelf({ linkId: 'scene:' + sid, text: 場面の文, variant 'memo', src 'own' })（self.js:1238-1243）（保存: DES.state.activities（des3.activities））
- `sx-kbench` — 紐づけチップ（作るで作っている / 作るにある道具 / 作品に残した）の「作業台を開く」 → DES.make.openAct(actId) → #make/<id>（self.js:1245-1250）（保存: なし（make 側で再開処理あり））
- `sx-kdel` — 本人の工夫 more メニュー / fit 一覧の「消す」 → kufu.own[id].gone = true。トースト t_removed + 戻す（self.js:1251-1256）（保存: des3.self.kufu.own）
- `sx-sdel` — 本人が書いた場面の「消す」 → kufu.scenes[id].gone = true。トースト t_removed + 戻す（self.js:1257-1261）（保存: des3.self.kufu.scenes）
- `sx-avatar` — hub の「変える」(aria-haspopup=dialog) → 開いている編集欄・行を閉じて再描画 → ui.pick = 現在値 → fillSheet → DES.app.openDialog(#self-sheet) showModal、選択中の髪型ラジオへフォーカス（self.js:1308-1319）（保存: なし）
- `sx-avatar-ok` — #self-sheet フッター「これにする」 → closeDialog → reduce 'avatar' { hair, color }。トースト t_avatar + 戻す（前の値へ）（self.js:1320-1324, 290-295）（保存: des3.self.avatar）
- `dialog-close（app.js:286 のハンドラ）` — #self-sheet の × と「やめる」。Esc / 外側クリックは app.js:602-607 → 変えずに閉じ、開いた「変える」へフォーカス戻し（保存: なし）
- `(input) data-sx-input textarea` — 全編集欄 → 1 打鍵ごとに reduce 'draft' { target, mode, text } を保存 + 残すボタンの活性を同期（self.js:1327-1334）（保存: des3.self.draft）
- `(input) data-sx-rnote text input` — 結果パネルの「ひとこと」 → ui.rnote + reduce 'ideaNote'（trying の note を即保存）+ draft rnote:<id>（self.js:1335-1343, 238-245）（保存: des3.self.kufu.ideas[id].note / draft）
- `(change) radio sx-hair / sx-color` — #self-sheet → ui.pick を更新して fillSheet（プレビュー即時更新・none なら色 fieldset disabled）。保存しない（self.js:1345-1353）（保存: なし）
- `(keydown) Escape` — #self 上・dialog が開いていない時 → 編集を閉じる → kmenu / howwas / hist を閉じる → 開いた行を閉じる の順（self.js:1362-1378）。dialog 内の Esc は app.js の cancel → closeDialog（保存: des3.self.draft（編集を閉じる時））
- `toast-act（app.js:214 のハンドラ）` — トースト「元に戻す」(5 秒) → dispatch の undo fn: reduce 'undo' で操作前の state 丸ごと復元（履歴行も消える）→ persist → 再描画（self.js:383-394, 315）（保存: des3.self 全体）
- `(hashchange / resize)` — window → hashchange: dialog を閉じ ui.open/edit/transient をリセット・ui.restore=true（戻った時に下書きから編集欄を復元）。resize: 幅が変わったら dialog を閉じる（self.js:1399-1411）（保存: なし）

### ダイアログ・シート

- <dialog class="self-sheet" id="self-sheet" aria-labelledby="self-sheet-h"> — app-v3/index.html:40。中身は self.js:1271-1307 fillSheet が都度生成: .dialog-head > h2#self-sheet-h + .icon-btn[data-action=dialog-c
- #toast（app.js:188-212 APP.toast）— 戻す付きは 5 秒、無しは 2.6 秒。self は直接触らず DES.app.toast 経由
- #plan-dialog — toTalk で DES.app.closePlanDialog() を呼んで閉じるだけ（self.js:1058）
- 行内の一時パネル（dialog ではない）: .srow-open（開いた行）/ .sx-edit（編集欄）/ .sx-history / .kidea-how（結果）/ .kmenu（more メニュー）/ .sx-away（折りたたみ）— いずれも ui.* の状態で描き分け

### 状態

- **見立て pending（既定・返事なし）**: rx に無い = pending。行は 1px dashed --ai + DES.buddy(18,'think') + チップ「バディの見立て」。開くと 手がかり / 反対の手がかり（空なら出さない）/ 合ってる・少しちがう・今はちがう + 履歴・話して伝える、hint『返事はしなくてもいいよ』（react_hint）。返事しないことを同意と扱わない・催促なし（contract-V V-4）
- **行 open**: ui.open = id。.srow.open + .srow-open が sxIn .2s で開く。ページで 1 つだけ
- **見立て agreed**: ai の形（dashed）のまま .chip.src-own.sx-agreed『合ってる』+ 日付を足す（self.js:579-582）。操作は 少しちがう / 今はちがう / 見立てに戻す
- **見立て edited（本人が直した）**: 行は own の形（左 3px --own）・本文は vers[cur].text、下に小リンク『もとはバディの見立て』·『履歴』。返事直後だけバディ 1 行 reply_fixed『直したほうで覚えておくね。もとの見立ては履歴にあるよ』（次の操作で消える）
- **見立て away（今はちがう）**: カード下の『外した見立て（{n}）』折りたたみへ移る（文字 --gap）。直後にカード内へ reply_not_now『わかった。今はちがうんだね。この見立ては外しておくよ。いつでも戻せる』。中に 履歴 / もどす
- **door（int-d1）added / not_now**: added: チップ in_plan『予定に入っている』+ 開くと『予定で見る →』のみ。not_now: 外した見立ての折りたたみへ（もどす可）
- **編集中（入力中）**: ui.edit.key。textarea rows=3 maxlength=200、ラベル fix_label / write_label、placeholder は axes[].ph / scene_ph / idea_ph。残す は trim 空 or 編集前と同じ文で disabled、同文なら hint『変えたいところを書きかえてね』（self.js:523-537）
- **下書きあり（再読み込み・ルート移動・表示モード切替の後）**: st.draft があれば restoreDraft が同じ行の編集欄（または rnote の結果パネル）を開き直す（self.js:947-961）。変更なしの下書きは別の行を開いた時に消える
- **履歴 0 件 / 1 件以上**: 0: hint『履歴はまだないよ』。1+: 版一覧（新しい順・own チップ）+ 元の見立て（ai チップ）+ 現在版に aria-current、他の版に『これに戻す』+ log 行（t_agree 等の文言で日付つき）
- **折りたたみ閉 / 開**: fold:true の行は『ほか {n} 件』に入る。開くと『畳む』
- **本人の言葉・注記 0 件**: 何も出ない（notes は空配列）。カード見出し右の『書く』だけ
- **工夫 idle**: 種類チップ（kinds[kind] + 小アイコン）+ 文 + 『試してみる』+ … メニュー。tool でデータ由来かつ紐づけ無しなら『作るで作る』
- **工夫 trying**: チップ『試し中』（.k-trying: --record-soft 地 --record 字）+ scenes[].when『今日 10:50 のサークル対話で試す』。操作は『やってみてどうだった？』1 つに置き換わる。ひとことは入力中も保存
- **工夫 result fit**: 帯上部『自分に合う工夫』（.kufu-fit）へ移る: check アイコン + 文 + ' · 場面名 · M/D'。own（本人の工夫 or 少し変えた）は f-own 形 + own チップ。seed の note は record チップで表示
- **工夫 result meh**: 工夫の下に .kidea-res: チップ『いまいち』+ ひとこと。操作は『試してみる』に戻る
- **工夫 adjust（少し変える）**: trying のまま文が本人の文に置き換わり own チップ + f-own。結果は 'adjust'
- **工夫 away（今はいい）**: 場面右下『今はいい（{n}）』折りたたみ。中に 文 + 『もどす』（戻す先は prev）
- **本人の場面 0 件 / 1 件以上**: 0: 帯に データの k1 / k2 だけ。追加中は .kufu-new に編集欄。1+: own 形の場面ブロック（直す / 消す）、バディ 1 行 new_scene_buddy『書いてくれてありがとう。どんな工夫が合いそうか、一緒に考えよう。どこから考える？』、工夫 0 件なら kinds の ai / env / tool ボタン（tool は作るへ・紐づけがあれば出さずチップ + 作業台を開く）
- **作るとの紐づけ（making / made_tool / saved_work）**: DES.state.activities[].selfLink が一致すると .kidea-link: チップ『作るで作っている』『作るにある道具』『作品に残した』+ 『作業台を開く』。作品あり & idle なら『試してみる』の隣に hint『作った道具を、試してみよう』（self.js:434-440, 795-797）
- **バディの話しかけ（中央・1 つだけ）**: 段階: comment.first（返事 0 かつ先頭が pending）→ comment.next『次は「{先頭 20 字}…」はどう？ 返事はしなくてもいいよ』→ 全部返事済みで k1 に trying/result 無し → comment.kufu + 『工夫を見る』→ comment.done『返事をありがとう。直したところは、これから使うね』（self.js:727-737）
- **保存失敗**: localStorage の get/set が throw → markFail: DES.state.saveFailed = true + DES.app.renderSaveState() → トップバーの .save-indicator.fail に i18n save_fail『このブラウザに保存できない』。画面はメモリで続く（self.js:349-362、app.js:389,407）
- **アバター画像の読込失敗 / hair:'none'**: img.hidden、同じ円に頭文字 'は'（.sx-av-letter 40px/700）、wrap に role=img + aria-label avatar_alt。失敗は ui.failed[src] に記憶（self.js:749-760）
- **読み取り専用（サポーターが一緒に入っている間）**: app.js:436 で #main に inert（操作不可）。帯には band_self の文。契約 AD-3: 自己理解は入っている間 操作不可・記録対象外
- **es（小学生向け）表示**: 全文言が ST() で es 値に切替（本文 14 / メタ 12 / 操作 48px）。本人の言葉・記録の本文は 1 通りで変わらない
- **送信中 / ネットワーク失敗**: 存在しない（モックは同期 localStorage のみ）。本実装で新設が必要

### 架空のまま出してはいけないもの

- src:'ai' の見立て 10 件（int-a1, int-d1(door), ori-a1, ori-a2, exp-a1, psy-n2, psy-l1, mas-a1, mas-n1, mas-n2）とその basis / counter — 固定文を「バディの見立て」として出してはいけない（self-data.js:129-207）
- src:'record' の記録 13 件（int-r1/r2, exp-r1〜r7, mas-r1/r2 + cond）— 架空の活動記録（日付 10/19〜11/2・田中さん）
- src:'own' の会話引用 2 件（int-o1『Python のゲーム作りやってみたい』from talk-4 / psy-n1『午後は別のことしたい』from talk-2）と basis 内の from:'talk-N' / to:'plan' リンク — 存在しない会話・予定への参照
- src:'gap' 3 件（ori-g1, psy-g1, mas-g1）— 固定の「まだ分からない」
- kufu.scenes k1 / k2 の全部: 場面文・basis・buddy 1 行（『4 つ考えてみたよ』『10/30 は「形だけ先に決める」で最後まで作れたね』）・when（『今日 10:50 のサークル対話で試す』）・ideas 6 件・k1-tool.prefill・k2-self.seed（result fit 10-30 + record note『10/30 ビーズの並びを最後ま
- comment.first（『10/19〜11/2 の会話と記録から、仮の見立てを置いたよ。まず聞きたいのは「形や並びがそろうのが好き」かどうか…』）・comment.ask の id 順（self-data.js:291-302）
- kufu.new_scene_buddy — 本人が場面を書いた直後に出る決定論の固定返事（self-data.js:239-242、コメントに「決定論・サンプル」）
- text.reply_fixed / text.reply_not_now — 返事直後のバディの固定 1 行（バディの発話として出すなら生成 or システム文言と明示）
- 日付の固定: DES.data.today '2026-11-02'・selfData.asOf '11-02'・text.as_of『11/2 時点』・axes psy.groups now.head『いま（11/2）』・全 at は 'MM-DD'（年なし）
- 本人・サポーターの固定名: DES.data.child.name『はると』・avatar.initialLetter『は』・text.avatar_alt『はるとのアバター』・text.share『田中さんも見られる』・記録文中の『田中さん』
- door 項目 int-d1 の activity 'dig-3dprint'（予定カタログの固定 id）
- img/self/avatar-*.jpg を「本人の写真・似顔絵」として見せること（架空人物の生成画像。選択式アバターとしてなら可）

### 見本として残せるもの

- placeholder の例文 kufu.scene_ph『例: 人の話を聞いているだけだと、ぼーっとしてくる』/ kufu.idea_ph『例: 聞きながら、手もとで図にする』（『例:』と明示済み）
- axes[].ph（『最近気になっていること』等の入力ヒント）
- UI 文言 text.* / kufu.* のボタン・ラベル・トースト・凡例・kinds（AI と一緒に / 環境を変える / 道具を作る / 自分でやる）・cond_*（自分で / 手伝いつき / まだ確かめていない）
- kufu.prefill.{ai,env,tool} の下書きテンプレ（本人の入力欄に入る定型文。{scene} を実文で埋める）
- アバター画像 12 枚 + hairs / colors の選択肢（『見た目を選ぶ』機能として。本人の実写ではないことが自明な線画イラスト）
- LOCAL_ICONS（pin / pen の path）と KIND_ICON の対応
- intro 文 text.intro / kufu.intro（固定の説明文）

## map

### ルート

| hash | 画面 |
| - | - |
| `#map` | つながり › 作ったものから（view=made）。全幅の地図枠（.mp-frame）+ 枠内オーバーレイ（左上チップ / 右上 全体で見る・大きく見る / 左下 しるしの見方 / 右下 ＋−全体・ならびを元に戻す）+ 詳細パネル |
| `#map/flow` | つながり › 流れで見る。3 列（作ったもの+これから / 学んだこと / 単元）+ SVG 線（.mp-flines）。選択で並べ替え（flowOrder） |
| `#map/fields` | つながり › 分野で見る。教科×領域の島（.mp-isl）に全単元、作ったもの→単元の線（mu）。学んだことノードは出さない |
| `#map/concepts` | つながり › 概念で見る（参考の見方）。考え方カード 7 枚（.mp-ccards）→ 選ぶと帯 #mp-cband（やったこと / 近い / 遠い の 3 列、mixed は 2 列） |
| `#map/list` | つながり › リスト。作ったもの 1 つ = カード 1 枚（学んだこと → 単元の縦チェーン + 前に作ったものとのつながり）+ これから作れそうなもの の段。詳細はカード内に append |
| `#map/basics` | 基礎学習（全体の画面 §AH-1）。上: 全体の帯（単元 1 マス button）+ 凡例（数つき）/ 算数: 領域 4 段 × 単元行（名前リンク + 帯 + % + ふれた印）/ 理科・国語・社会: 点線の札 / 末尾 1 文 + #mpx-live。見出し行に「つながりで見る」 |
| `#map/u/<code>` | 単元（§Y-4）。戻る（開いた元の見方 or 基礎学習）/ h1 単元名 / 領域 / 帯+% / 項目一覧（問題・説明の印）/ 作ったものとのつながり / 操作「基礎学習を始める」（モック: トースト）「バディと話す」。教材の無い code・無い code は #map/basics へ replace + トースト |
| `#map/<不正な引数>` | renderLinks(made) を描いてから #map へ location.replace + トースト「見つからなかったよ」 |

### 操作（data-action など 32 件）

- `mp-tab (data-arg=links|basics)` — 見出し行 .mp-tabs .segmented（全画面） → basics: 地図系の見方からなら goAll（§AH-3 札が飛ぶ遷移）、それ以外は hash=#map/basics。links: 全体の画面から最後の見方が地図系なら goLinks（§AH-4 逆向き遷移）、それ以外は viewHash(mapUi.view) へ hash 変更（保存: 直接は無し（hash 変更後 renderView が mapUi.view を DES.store.save('map）
- `mp-view (data-arg=made|flow|fields|concepts|list)` — 見出し行 .mp-views .segmented（つながりタブ内） → hash を viewHash(v) へ。描画時に mapUi.view を更新（保存: des3.mapUi.view）
- `mp-sel (data-id, data-arg=map|rel|flow|concepts|c:<cardId>|c:<cardId>|<lid>|peer)` — 地図ノード .mp-n / カード・流れ・概念のノード .mp-node / 詳細パネル内の関連ボタン .mp-rel → select（同じ id をもう一度で解除）。rel から選んだ時はそのノードへフォーカス移動。地図ではノードを枠内中央へ（centerNode）。詳細パネルを差し替え、関連だけ濃く（has-sel / is-on）（保存: des3.mapUi.sel[view]（setUi → DES.store.save('mapUi') → DES.a）
- `mp-close` — 詳細パネル右上 × .mp-dclose → closeSel: 選択を外す。パネル内にフォーカスがあれば先にそのノードへ（保存: des3.mapUi.sel[view]=null）
- `mp-only` — 枠左上チップ面 .mp-onlybtn（作ったものから・分野で見る） → 作ったものだけ on/off（is-only・ノードを is-hid・チップ disabled）。並び・倍率は変えない（保存: des3.mapUi.only）
- `mp-chip (data-arg=next)` — 枠左上チップ面「これから作れそう」 → 線の種類 next の表示 on/off（frame.c-next）（保存: des3.mapUi.chips.next）
- `mp-legend` — 枠左下「しるしの見方」.mp-lgbtn → #mp-lgpop の開閉（aria-expanded）。Esc / 外側クリックで閉じてボタンへフォーカス（保存: 無し（DES.ui.mp.legendOpen のみ））
- `mp-big` — 枠右上「大きく見る / もとの大きさ」.mp-bigbtn → html.mp-big を切替（#sidebar・#topbar 非表示、h1 18px）。地図の中心（世界座標）を保って再クランプし位置も保存。Esc でも戻る（保存: des3.mapUi.big（+ savePos → des3.mapUi.pos[view]））
- `mp-overview` — 枠右上「全体で見る」.mp-allbtn → goAll: 地図を 350ms で薄くし、単元ノードの札が全体の帯のマスへ飛ぶ（1.4〜1.8s）→ #map/basics。reduced-motion / animate 不可なら allStill（保存: 無し（§AH-6））
- `mp-inall (data-id=code)` — 単元の詳細パネル操作「全体の中で見る」 → goAll({single: code}): その単元の札だけ飛び、着いたら札へスクロール + 2 回光る（flash）（保存: 無し）
- `mpo-links` — 全体の画面の見出し行「つながりで見る」.mpo-linksbtn → goLinks: 最後に使った地図系の見方（無ければ made）へ逆向きの遷移（保存: 無し（sel 指定時のみ mapUi.sel/view））
- `mpo-touch (data-id=code)` — 全体の画面の単元行 / 札の「作ったものでふれた」印 .mpo-touch → goLinks({sel: code}): その単元を選んだ状態（詳細パネル）で地図系の見方へ着く。ui.reveal に id を入れ着地後 centerNode（保存: des3.mapUi.sel[view]='unit:<code>'・des3.mapUi.view）
- `mpo-cell (data-id=code)` — 全体の帯のマス button .mpo-cell → 下のその単元の行 / 札へスクロールしてフォーカス（scrollToUnit）（保存: 無し）
- `mp-zoom (data-arg=in|out|fit)` — 枠右下 .mp-ctrl（＋ / − / 全体を見る） → MPC.zoomAt（中心基点・KEY_STEP）/ fit。apply 後 api.commit → savePos（200ms デバウンス）（保存: des3.mapUi.pos[view] = {x,y,z}）
- `mp-moved-reset` — 枠右下 .mp-mvreset（1 つでも動かした時だけ表示） → その見方の moved を {} に。トースト「ならびを元に戻したよ」+「元に戻す」。フォーカスは「全体を見る」へ。アニメで戻る（animMove）（保存: des3.mapUi.moved[view]）
- `mp-unmove (data-id)` — 作ったものの詳細パネル操作「場所を元に戻す」（動かしたものだけ） → moved[view][id] を削除。トースト「場所を元に戻したよ」+「元に戻す」（保存: des3.mapUi.moved[view][id]）
- `mp-concept (data-id)` — 概念で見るのカード .mp-ccard → 考え方を選ぶ / もう一度で閉じる。帯 #mp-cband を描き直し、帯内の選択は外す（保存: des3.mapUi.concept・des3.mapUi.sel.concepts=null）
- `mp-talk-concept (data-id)` — 概念の帯の見出し右「この考え方をバディと話す」 → DES.talk.prefill(考え方の名前) → #talk の下書きに 1 行 + トースト（talk 側）（保存: des3.draft（talk.js 経由））
- `mp-decline (data-id=ln:*)` — 学んだこと（出所=バディ）の詳細パネル / 作ったものの詳細の学んだこと行の「違う」 → decline: ノードと線が消え、選択はその作ったものへ。トースト「外したよ」+「元に戻す」（undecline）（保存: des3.mapUi.declined[]（learnedId）・sel）
- `mp-decline-next (data-id=next:*)` — これから作れそうなものの詳細パネル「違う」 → declineNext: 地図から外す。トースト「外したよ」+「元に戻す」（undeclineNext）。フォーカスは元の学んだこと or 枠（保存: des3.mapUi.declinedNext[]・sel）
- `mp-make (data-id)` — 作ったもの（活動あり）の詳細パネル「続きを作る」（kind=work は disabled・title=story_lost） → DES.make.openAct(actId) → #make/<actId>（止めていれば再開）（保存: des3.activities（make.js 側））
- `mp-make-next (data-id)` — これから作れそうなものの詳細パネル「これで作る」 → DES.make.fromIdea(題) → 活動を作って作業台へ（保存: des3.activities（make.js 側））
- `mp-talk (data-id)` — 各詳細パネル / 単元ページの「バディと話す」 → DES.talk.prefill(ノードの言葉 wordsOf)（保存: des3.draft（talk.js 経由））
- `mp-unit (data-id=code) ＝ a[href=#map/u/<code>]` — 算数の単元の詳細パネル「基礎学習で見る」 → ui.unitFrom に今の見方を覚えて #map/u/<code> へ（戻るリンクがその見方へ）（保存: 無し）
- `mp-show (data-id)` — 単元ページ「作ったものとのつながり」の学んだこと / 作ったもの link-btn → MP.show(id): sel.made=id・view=made にして #map へ（着地後 centerNode）（保存: des3.mapUi.sel.made・view）
- `mp-start` — 単元ページ操作「基礎学習を始める」 → モック: トースト「基礎学習の教材は別のところで作っているよ」だけ（保存: 無し）
- `a.mp-uname[href=#map/u/<code>] / a.mp-back / a[href=#make]（空状態「作るへ」）/ works.js wd-map（a[href=#map]）` — 全体の画面の単元名 / 単元ページの戻る / 空状態 / 作品詳細「学びマップで見る」 → hash 遷移。wd-map は DES.map.show('act:<actId>' or 'work:<id>')（保存: wd-map のみ des3.mapUi.sel.made・view）
- `キー: Escape（document）` — 学びマップ全体（dialog[open] が無い時） → しるしの見方 → 選択（詳細パネル）→ 大きく見る の順に 1 つずつ閉じる（保存: sel / big を経由して des3.mapUi）
- `キー: + = / - _ / 0 / 矢印 / Shift+矢印 / Tab（.mp-frame keydown・focusin）` — 地図枠（フォーカス時。.mp-detail 内は除外） → 拡大 / 縮小 / 全体 / 24px 移動（PAN_STEP）。Shift+矢印は作ったものノードを地図座標で 24px 動かす（addMoved）。Tab で来たノードは枠内へ reveal（保存: des3.mapUi.pos[view] / des3.mapUi.moved[view]）
- `ポインタ: ドラッグ / 2 本指ピンチ / wheel（ctrlKey=ピンチ）/ 作ったものノード上から 6px 以上のドラッグ / 空白クリック（MPC.attach）` — 地図枠 .mp-frame（touch-action:none） → 地図の移動・拡大縮小（commit → savePos）。ノードドラッグは nodeStart/Move/End → addMoved（学んだことが付いてくる・ピンチに変わったら戻す・ドラッグ後のクリックは捨てる）。空白クリックは closeSel（保存: des3.mapUi.pos[view] / des3.mapUi.moved[view] / sel）
- `resize / matchMedia(max-width:700px) change / ResizeObserver（MP.bind・mountMap）` — window / 枠 → 枠の高さ再計算（sizeFrame）・流れの線引き直し（drawFlow）・概念で見るの帯の置き場所作り直し・倍率再クランプ（保存: 無し）
- `遷移中の click / keydown / pointerdown / wheel / resize（xListen）` — .mpx-ovl 表示中の document → 遷移を飛ばして最後の状態へ（xEnd 'skip'）。別ページ・別見方へ移ったら resetUi → xEnd 'abort' で重ね面を片付ける（保存: 無し）

### ダイアログ・シート

- ネイティブ <dialog> は map モジュール自身は持たない（Esc 処理で document.querySelector('dialog[open]') を見るだけ。map.js:2712）
- 詳細パネル: section.mp-detail[aria-labelledby="mp-detail-h"][hidden]（見出し h2#mp-detail-h aria-live=polite、× は [data-action=mp-close]）。置き場所: 地図系は .mp-frame 内の重ね（≥1024 右 350px / <1024 下シート 60%）、flow・concepts 
- 凡例ポップ: div#mp-lgpop.mp-lgpop[role=group][hidden] ← button.mp-lgbtn[aria-expanded][aria-controls=mp-lgpop]（map.js:947-969）
- 概念の帯: section#mp-cband.mp-cband（aria-labelledby=mp-cband-h）← button.mp-ccard[aria-controls=mp-cband]（map.js:1740, 1776）
- 遷移の重ね面: div.mpx-ovl[aria-hidden][inert]（position:fixed・pointer-events:none。中に .mpx-ghost > .mpx-gsp > .mpx-gpage（古い画面）と .mpx-card 札）（map.js:2002-2013, map.css:324-337）
- 読み上げ: p#mpx-live.sr-only[aria-live=polite]（全体の画面の末尾。遷移後 mp_live を入れる）（map.js:1924, 2158, 2194）/ p#mp-frame-hint.sr-only（枠の aria-describedby）（map.js:1073）
- トースト: #toast（DES.app.toast。元に戻すは toast-act ボタン）（app.js:188-200）
- 枠: div.mp-frame[tabindex=0][role=region][aria-label=mp_frame_label][data-lod=far|mid|near][data-view][data-fk=mp-frame]（map.js:1060）

### 状態

- **空（作ったもの 0）**: flow / list（と ≤700 の flow）だけ .mp-empty: 「作るで作ったものから、学んだことと基礎学習のつながりがここに出るよ」+ リンク「作るへ」（mp_empty / mp_to_make）。made / fields の buildMapPage には空分岐が無い。モックでは MPD.past（7 件）が常に graph に入るため空状態は実質到達しない（map.js:1608-1615, 1646, 104
- **学んだこと 0（対応表に無い作ったもの）**: 詳細パネル・カードに「学んだことの記録は これから」（mp_learned_none）1 行（map.js:1440, 1626）
- **選択なし**: frame に has-sel 無し。全ノード・線が通常の濃さ。詳細パネル hidden。契約 §Y-2 の「既定で最新を選択済み」は現状 normalizeUi の初期値 sel=null（静かな初期表示。map-test.js:376 'normalizeUi 無い = 初期値（選択なし = 静かな初期表示）'）
- **選択あり**: frame.has-sel・stage.has-panel: 選んだノードと related だけ is-on、他は opacity .3（ノード）/ .1（線）、150ms transition。詳細パネルが開き h2（aria-live）に言葉、種類の eyebrow（map.css:70-76, 99; map.js:1512-1530）
- **作ったものだけ on**: frame.is-only: 作ったもの以外 is-hid（display:none・Tab 順からも外れる）、チップ disabled、選択中はその 1 つのつながり（next 含む）だけ出す（map.js:565-589, 1519-1537）
- **倍率 far / mid / near**: frame[data-lod]: far(<0.6) 学んだこと・単元は点・題は逆拡大 12px 以上・重なる題は thin で間引き / mid 3 行まで / near 場面・出所チップ・帯 (map-canvas.js:22-24, map.css:121-154)
- **ドラッグ中 / ノードを持ち上げ中 / 動かした後**: .mp-frame.is-dragging（cursor:grabbing）/ .mp-n.is-lifting（枠線濃く）/ .mp-n.is-moved（z-index 2）。1 つでも動かすと .mp-mvreset が出る。詳細に「場所を元に戻す」（map.css:65, 94-96; map.js:1562-1566, 1455）
- **保存後（成功）**: saveUi: S().saveFailed=false・posOk 更新 → DES.app.commit で描き直し・フォーカス復元（map.js:2521-2536）。位置は 200ms 後にまとめて保存（map.js:1164-1187）
- **保存失敗**: 状態を直前に戻し S().saveFailed=true → topbar の .save-indicator が「このブラウザに保存できない」(save_fail)、トースト save_fail、再描画。位置は最後に保存できた位置へ戻す（posSettle）（map.js:2524-2531, 1176-1185; app.js:389）
- **外した（違う）**: ノード・線が消える → トースト「外したよ」（removed_toast）+「元に戻す」（undo_restore）。選択はその作ったものへ（map.js:2664-2685）
- **ならび / 場所を元に戻した**: トースト「ならびを元に戻したよ」/「場所を元に戻したよ」+「元に戻す」。reduced-motion でなければ位置がアニメで戻る（animMove / syncMoved）（map.js:2614-2635）
- **見つからなかった（不正 arg・無い code・教材の無い code）**: 先に移動先を描いてから location.replace + トースト「見つからなかったよ」（mp_not_found）1 回（ui.missing で重複抑止）（map.js:2429-2433, 2496-2502）
- **基礎学習の進み具合 0**: 同じ図（空のマス）+「基礎学習をやると、ここが塗られていくよ」（mp_zero）（map.js:1900）
- **単元: つながり無し**: 「作ったものとのつながりは これから」（mp_links_none）。詳細パネルの単元でも同文（map.js:1462, 1947）
- **同じ単元につながる作ったものが無い**: 「同じ単元につながる作ったものは これから」（mp_peers_none）（map.js:1446）
- **概念で見る: やったことの無い考え方（mixed）**: 左列に「ここは これから」（mp_cc_none）+ その考え方の単元につながる これから作れそう。中列は「この考え方が出てくる所」1 列（map.js:1759-1761, 1767）
- **概念で見る: 考え方未選択**: 「考え方を 1 つ選ぶと、やったことから近いところ・遠いところが出るよ」（mp_cc_pick）だけ、帯なし（map.js:1783）
- **全体の帯のマス 4 状態**: data-state=none|touched|doing|done + data-touched: 空枠 / 橙の丸 / 下から塗り（終えた/項目数、進めているが 0 なら 12%）/ 全塗り。凡例に状態ごとの単元数（割合は出さない）（map.js:1832-1864）
- **遷移中（つながり ⇄ 全体）**: .mpx-ovl が document に 1 枚（inert・aria-hidden）。地図 350ms フェード、札 640ms 弧（stagger 25ms・合計 580ms 上限）、印 250ms、帯 300ms。クリック・キー・Esc・ホイール・リサイズで即最後の状態。終わりに h1 フォーカス + #mpx-live に「作ったものでふれた単元は {n} こ。全体の帯に しるしが ついたよ」（mp_live）（map.js:
- **reduced-motion（OS 設定 or html.reduced-motion）**: motionOK()=false: 遷移なしで最後の状態（allStill / xAfterLinks）、位置アニメなし、濃淡の transition は shell.css で 0（map.js:709-712, 2184-2195; shell.css:101-103）
- **大きく見る on**: html.mp-big: #sidebar・#topbar 非表示、.content 幅いっぱい、h1 18px・説明文非表示。学びマップを離れると resetUi が class を外す（map.css:409-415; map.js:2457-2460, 2516）
- **読み取り専用（本人が変えられないもの）**: 進み具合（MPD.progress）・学んだことの対応表（MPD.learned）・前に作ったもの（MPD.past）・これから作れそう（MPD.next）・考え方（MPD.concepts）・単元は全て読み取りのみの見本。本人の操作で変わるのは des3.mapUi だけ（map.js:12-13; map-data.js:1-7）
- **保存済みの選択が今のグラフに無い**: selIn → 「選択なし」として開く（全部を薄くしない）。moved のうちグラフに無い id は描く前に pruneMoved で捨てる（map.js:353-356, 2492-2493）

### 架空のまま出してはいけないもの

- MPD.progress — 見本の進み具合（9/8〜11/1 の日付・21/55 項目）を本人の基礎学習の記録に。空なら mp_zero の空状態で出す
- MPD.learned — 「学んだこと」の対応表（バディの見立て / 本人・人の言葉）は本人の記録から実際に導いたものだけ。固定の見立て文を本番で出さない（§Y-6「本番の推定はしない」= 推定は別系で行い結果を渡す）
- MPD.past — 地図専用の「前に作ったもの」7 件と records（田中さんとの会話を含む架空の出来事）。本人の実活動 / 作品の履歴に置き換え、無ければ出さない
- MPD.next — バディの「これから作れそうなもの」5 件と 1 行（固定の返事）。本人のデータから生成されたものだけ
- make-data.js の seed 活動 / 作品（act-build / act-py / act-cap / w-seed-*）とその changes・like・craft の原文 — 本人の保存のみ
- DES.data.today / now の固定日時（2026-11-02 10:20）— 実時刻。日付の無い活動を「今日」にする graph の既定（map.js:135）も実時刻で
- mp-start「基礎学習を始める」のトースト（mp_start_toast）— 実際の教材（基礎学習サービス）への遷移に
- map.js 内蔵の 2 色線画（past の art）— 本人の作品画像に。見本の絵を「本人の作品」として出さない
- coverage の「作ったものでふれた単元は {n} こ」（mp_live）・凡例の単元数 — 固定データではなく本人のグラフから
- detail の場面 1 文（日付 時刻 + 記録の原文 + 「（田中さんと）」）— 本人の実記録のみ。with の人名は PII 扱い
- 単元 code 'M4-A-01' 等の仮値（des3.mapUi.declined / declinedNext / sel / moved が ln-* / nx-* / unit:M4-* の見本 id を保存している）— 実 id へ。既存の保存値は移行 or 読み捨て

### 見本として残せるもの

- MPD.units / extUnits / areas / otherAreas / subjects の単元名・領域名（学習指導要領の要約）— 「仮の code」と注記した上で本番マスタに差し替えるまでの暫定として可（名前は架空の人物・出来事を含まない）
- MPD.unitLinks（学ぶ順 12 本）— 系統表として見本のまま可（詳細パネルの前 / 後だけに使う）
- MPD.concepts（考え方 7 個・why の文）— 教科横断の概念マスタとして見本のまま可。learned の紐付けだけ本人データ由来に
- 凡例（しるしの見方）の線 / ノードの見本・全体の帯の凡例マス（.mpo-box.is-sample）— 見本と明示済み
- mp_frame_hint・列見出しの説明（mp_cc_near_d / mp_cc_far_d）などの操作説明文言
- MD.art の見本の絵（写真の無い活動の sample variant）— 作る側が既に見本として扱っているもの
- 概念で見るの「参考の見方」印（mp_ref_view）— 契約で参考と明示

## trail

### ルート

| hash | 画面 |
| - | - |
| `#trail` | あしあと 1 画面（完全一致ルート。app.js:82 ROUTES に含まれ PREFIX には無いので #trail/<id> は無い）。上から: .page-head（h1「あしあと」+ tr_sub）→ 先頭の 1 文（.tr-buddy resume_push / .tr-intro / .tr-empty のいずれか 1 つ、または無し）→ 上段 .tr-resume「前はここまで」（working\|paused の活動  |
| `#make/<actId>` | （描画は make.js）trail からは「ほか {n} 件の変化」リンク（trail.js:323）、tr-resume（DES.make.openAct → go）、tr-retry の遷移先（trail.js:439） |
| `#works/<workId>` | （描画は works.js）作品に残した の行全体が <a href="#works/<id>">（trail.js:332） |
| `#today/<odaiId>` | （描画は today.js）見つけた の「お題で見る」<a>（trail.js:360） |
| `#plan` | （描画は plan.js）終わった予定の行で catalogId も recId も無い時のフォールバック <a>（trail.js:349） |
| `#talk` | （描画は talk.js）tr-talk で DES.ui.focusMsg を置いて移動。talk.js:286-298 が 1 回だけ消費して .is-trail-focus + focus + scrollIntoView |

### 操作（data-action など 12 件）

- `tr-resume（data-id=actId, data-arg='card'|'row'）` — 上段カード .trc-ops 主ボタン（橙、trail.js:286）/ 作った の行 .tr-ops（trail.js:320） → DES.make.openAct(id)（make.js:1224-1232）: 活動が paused|closed|stopped なら DES.app.change(setAct(resume(a))) で working に戻す（変化は積まない）→ #make/<id> へ。activity が見つからなければ何（保存: des3.activities（+ DES.app.change の全キー保存: store.js KEYS 10 個 ）
- `tr-retry（data-id=actId）` — 作った の行で state が closed|stopped の時だけ .tr-ops（trail.js:321） → M.fromTrail(a, { id: DES.plan.newId('a'), now: DES.data.now, mode, works, odai: TDD.get(a.odaiId), recText }) で同じ始まりの新しい活動（origin 'trail'・fromActId・元は不変、make.js（保存: des3.activities, des3.makeSide（change 経由では全キー）。undo は des3.a）
- `tr-plan（data-id=catalogId, data-arg='card:<actId>'|'row:<rowId>'）` — 上段カード副ボタン（catalogId があり DES.plan.item が引ける時だけ、trail.js:262-265, 287）/ 予定の記録の 終わった 行（trail. → DES.plan.act.addFirst(cat, { undo: true, after: { sel } })（plan.js:526-546）: addMine で空きを探し S().plan に mine 行を足し、ui.actor、会話に rec_add の記録行（DES.talk.record → S()（保存: des3.plan, des3.talk（change 経由で全キー）。空き無し分岐は des3.catalogMark）
- `tr-filter（data-arg=all|make|talk|found|plan|own）` — .tr-filters の 6 つの button[aria-pressed]（trail.js:372-377） → 値が FILTERS に無い・現在値と同じなら何もしない。S().trail = { filter: f } → DES.store.save('trail') だけ（他ストアは書き直さない）、失敗なら saveFailed=true → DES.app.render() → 同じ data-arg のボタンへ foc（保存: des3.trail のみ）
- `tr-talk（data-arg=msgId）` — 話した の行「会話で見る」（trail.js:338）/ 予定の記録 record 行（trail.js:344）/ 終わった 行で catalogId 無し・recId あり（t → DES.ui.focusMsg = msgId; go('#talk')（trail.js:469-472）。talk.js:288-298 が renderPage で 1 回消費し、その .message に tabindex=-1 + .is-trail-focus を付けて focus（preventScrol（保存: なし（DES.ui の一時値だけ））
- `リンク a.tr-more「ほか {n} 件の変化」` — 作った の行で a.changes.length ≥ 2（trail.js:323） → href=#make/<actId> へ。保存なし（保存: なし）
- `リンク a.tr-work（行全体）` — 作品に残した の行（trail.js:332） → href=#works/<workId>。data-fk='tr-link:work:<id>'（保存: なし）
- `リンク「お題で見る」` — 見つけた の行（trail.js:360） → href=#today/<odaiId>（保存: なし）
- `toast-act（app.js の共通トースト「元に戻す」）` — #toast（app.js:188-200）。tr-retry と tr-plan が渡す fn を実行 → 上記 undo（retry: 新活動の除去 / plan: act.unadd）（保存: 上記に同じ）
- `キーボード・フォーカス` — 全体 → 開いたら h1[tabindex=-1] へ focus（ui.tr.shown が false の時だけ。trail.js:417）。pendingFocus があればそのセレクタへ focus + scrollIntoView center（trail.js:410-416）。li.tr-item は tabind（保存: なし）
- `TR.resetUi（ルート移動時）` — app.js closeTransient（app.js:527） → ui.tr.shown=false（次に開いた時 h1 へ focus する）。pendingFocus は残す（保存: なし）
- `DES.store.load / save の包み（モジュール読込時）` — trail.js:199-216 → load: des3.trail を読み normalize（形が違えば 'all'、parse 失敗は saveFailed）して s.trail に置く。save(only 無し): 元の save の後に save('trail') も呼ぶ（保存: des3.trail）

### ダイアログ・シート

- trail 自身が持つ dialog / sheet / drawer は無し（app.js:520 の closeTransient のセレクタ一覧にも trail 用は無い）
- 共通トースト #toast（app.js:188-200。.toast-text + button.toast-btn[data-action="toast-act"]）を tr-retry / tr-plan の「元に戻す」に使う
- 共通保存表示 .save-indicator（app.js:389, 407）が saveFailed で「このブラウザに保存できない」になる

### 状態

- **空状態（上段も時系列も 0）**: <p class="empty-line tr-empty"> に tr_empty（verbatim 中:「話す か 作る から始めると、ここにあしあとが残るよ」/ 小:「はなす か つくる からはじめると、ここにあしあとがのこるよ」）。上段・時系列の section は描かない（trail.js:183, 278, 401-408; i18n.js:494）
- **中立（上段 0・時系列あり）**: <p class="tr-intro"> に tr_intro（verbatim 中:「前にしたこと・話したこと・見つけたものが、ここに残るよ」/ 小:「まえにしたこと・はなしたこと・見つけたものが、ここにのこるよ」）（trail.js:277; i18n.js:493）
- **バディの 1 文（上段の先頭カードに wanted か next がある）**: .tr-buddy = DES.buddy(30) + AI チップ + resume_push「前はここまで。{step}から始める？」。{step} は M.tx({k:'tokoro', v:{what}})、what は a.next（本人の文）優先、無ければ stepNext（trail.js:181-185, 271-275; i18n.js:211）
- **先頭の 1 文を出さない**: 先頭カードが wanted も next も持たない時 buddyLine は null → 中立文も出さない（trail.js:183-185; trail-test.js:240-241「見本データ（建築は次の一歩が無い）は出さない」）
- **絞って 0 件**: <p class="empty-line tr-none"> に tr_filter_empty「{filter}のあしあとは、ここに出るよ」（{filter} は tr_f_* の語）。見出し「たどる」と絞り込みボタンは残る（trail.js:381; i18n.js:507）
- **絞り込み中**: .tr-filter.on（オリーブ地・白字）+ aria-pressed="true"。リロードで des3.trail.filter から復元（trail.js:373-376, 402; trail.css:44-47）
- **保存失敗**: S().saveFailed=true → topbar .save-indicator.fail「このブラウザに保存できない」（save_fail）。tr-filter の save('trail') 失敗（trail.js:463）、retry の undo で save 失敗（trail.js:446）、load 時の des3.trail parse 失敗（trail.js:207）
- **作った の行: 一区切り（state closed）**: .tr-note に T('closed')「ここで一区切り」+ 操作に「もう一度試す」（trail.js:318, 321; i18n.js:204）
- **作った の行: やめた（state stopped）**: .tr-note に 記録チップ + M.tx(stopRec)（thread の who:'record' k:'stopped_rec' の text、無ければ stopped_rec 既定文）+「もう一度試す」（trail.js:87-93, 319, 321）
- **作った の行: 変化が 2 つ以上**: 右端に a.link-btn.tr-more「ほか {n} 件の変化」（n = changes.length-1）（trail.js:323; i18n.js:513）
- **作品に残した: 完成 / 試作**: .chip.k-wdone「完成」/ .chip.k-wtrial「試作」（chip_done / chip_trial）、w.like があれば本人チップ + like の 1 行（trail.js:327-333）
- **話した: 返事あり / なし**: 本人の発言（本人チップ、.tr-own）の下に .tr-reply（AI チップ + 返事の 1 行目）。直後がバディでない・ideaReply ならば返事行なし（trail.js:69-80, 334-340）
- **サポーターの印（手伝い）**: e.by があれば 緑の記録チップに「{sup}が代わりに入力」（話した）/「{sup}と」（予定の記録・終わった）。作った は c.with の人名チップ、見つけた は helped フラグ。「自分で」絞り込み（own）はこれらを除外（trail.js:166-176, 241, 336, 344, 346）
- **もう一度試す の直後**: #make/<新 id> に移り、トースト「もう一度、{title}を始めたよ」+ 「元に戻す」（T('undo')。契約 Z-5 の表記は「戻す」）。5 秒後に消える。戻すと #trail に戻り元の行の retry ボタンへ focus + scrollIntoView center（trail.js:440-449, 410-416）
- **予定に入れる の直後**: plan.js の既存トースト（rec_add の文 + 元に戻す）。空きが無ければ no_free +「明日にとっておく」（plan.js:531-545）
- **読み取り専用**: あしあとから削除・編集はできない（ヘッダコメント trail.js:4、契約 Z-1）。入力欄・送信中の状態は無い。操作は 遷移 / 新活動作成 / 予定追加 / 絞り込み の 4 系統のみ
- **日見出し**: 今日 = tr_today「今日」/「きょう」、他は 'M/D' 文字列をそのまま（trail.js:157-164, 384）
- **見つけた でお題定義が無い**: TDD.get で引けない / TDD.photo が無い found は行ごと出さない（today.js の normalize と同じ扱い、trail.js:397-398）

### 架空のまま出してはいけないもの

- DES.data.talk の固定会話（talk-0〜5「建築、午前で終わりそうにない」等）が「話した」として常に出る（talk.js:16 で連結）— 本人の実会話か空状態に
- MD.seedActivities の見本活動 act-build / act-py / act-cap（田中さん・固定時刻・day 10/30, 11/1）が des3.activities 不在時に注入され、上段カードと「作った」に本物の履歴として出る（make.js:1070）— 実活動のみ
- MD.seedWorks の見本作品 w-seed-*（like 文「星が 6 つになると…」等）が「作品に残した」に出る（make.js:1078）— 実作品のみ
- DES.data.plan の fixture 行と、それに紐づく記録行（rec_finish 等）— 実予定
- odai.tried[].found の「写真」が TDD.photoArt のダミー線画（today-data.js:1033-1038）— 実写真
- サポーター名 田中さん（sup-data.js:9、DES.sup.nameOf が by を無視して固定返し）— 実サポーターの名前解決
- 「話した」のバディの返事 1 行目（talkTopics の reply）— MD.replies / data.js の見本文ではなく実バディの返事
- 上段の「次の候補」（stepNext）と「止まった場所」の文（M.tx）— make-data の固定 steps / 見本文ではなく、本人の活動の実記録・実提案
- もう一度試す の新活動の中身（fromTrail → fromSample / fromText / fromOdai の見本初期値・MD.replies の open/land 文）— 実テンプレート・実バディ文
- DES.data.today / now の固定時計で作られる日見出し「11/1」「今日」・時刻 — 実日時
- 会話の record 行を DES.text の文面一致で分類する仕組み（tplRe、trail.js:32, 104-121）— 記録に種類を持たせる（文面一致は本番で崩れる）
- DES.data.catalog / classroom に依存する「予定に入れる」— 教室の実カタログ・実日課
- 「自分で」絞り込みの元になる by / with / helped の印（TK.push が sup 参加中に付ける）— 実サポーター操作の記録

### 見本として残せるもの

- i18n の tr_* / origin_trail の文言（契約 Z-11 verbatim・禁止語テスト付き）— そのまま
- 純関数一式（normalize / resumeCards / talkTopics / entries / groupByDay / filter / buddyLine）と tools/trail-test.js の検証（入力の形を保てば移植可）
- trail.css のレイアウト（820px 箱・3 列/1 列・時刻|線|本文・es の文字サイズ・44/48px の操作領域）
- 種類アイコン（DES.icon の線画）とバディのアバター（DES.buddy(30)）
- チップの体系（本人 / バディ / 記録（緑）/ 出所 origin_*）
- 写真・サムネが無い時の線画 placeholder（MD.art / TDD.drawArt）— 「見本」「仮の絵」と明示する場合のみ。実写真があるのに線画を出すのは不可
- FILTERS と KINDS の対応（作った = make + work）
- 空状態・中立・0 件の 1 文（契約 Z-3 / Z-7 / Z-8 の文）
- お題の問い・題材の例（TDD.topics の title）は「お題」として出す分には固定資産でよい（ただし本人が取り組んだ記録 found が無ければ出ない）

## sup

### ルート

| hash | 画面 |
| - | - |
| `#sup` | 教室の一覧（data-sup-page="class"）: h1「教室」+ 説明 + 子ども 5 人の横長カード .sup-kid（はると だけ live、他 4 人は固定・disabled「開く」）+ 注記 only_child |
| `#sup/haruto` | 個別「今日」（data-sup-page="kid:today"）: 戻るリンク「← 教室」+ h1 {child} + 説明 kid_sub + 主ボタン（一緒に入る / {child}の画面に戻る）+ 5 タブ nav.segmented.sup-tabs + 5 箱（今日の予定 / 本人の言葉 / バディの提案 / アイデアを出す / 人が確かめること） |
| `#sup/haruto/clues` | 手がかり（kid:clues）: 説明 cl_sub + 注記 cl_note + 5 観点カード .axis-card.sup-axis（DES.selfData.items を観点で絞り、本人の返事 rx で装飾）+ 各カード下に観察メモ（一覧 + 観察を足す） |
| `#sup/haruto/advice` | 助言（kid:advice）: 説明 ad_sub + 助言を書く欄（ねらい/根拠/場面 select）+ 一覧 .ad-list（カード = 見出し ねらい + 状態チップ + 日付、dl 5 段） |
| `#sup/haruto/log` | 足場かけの記録（kid:log）: 手伝いの移り変わり（場面 3 × 週 5 の四角の列 + 読み取りの 1 文）/ どんな手伝いをしたか（今週）4 件数 / 記録（絞り込み segmented 5 + 日ごとの一覧 + 「会話で見る」） |
| `#sup/haruto/report` | レポート（kid:report）: 説明 rp_sub + 決まり 3 行 + 期間 + 状態チップ（下書き/確かめた/送った）+ 節 6 つの項目（直す/元の文に戻す/載せない）+ 補足 textarea + 操作列（届く形を見る / 確かめた / 送る / 下書きに戻す） |
| `#sup/haruto/in` | リダイレクト専用: 入っていなければ enter()（join 設定・写し作り直し・記録 join/in）+ DES.store.save() → location.replace('#talk')。画面は描かない sup.js:283-289 |
| `#sup/<他の子> / #sup/haruto/<知らないタブ> / 3 階層以上` | parse() が null → main を空にして location.replace('#sup') + トースト not_found「見つからなかったよ」sup.js:265-282 |
| `（全ルート共通）#join-band` | 入っている間だけ hidden を外す帯。sup ルート: 「{child}の画面に入ったまま」+「{child}の画面に戻る」「出る」/ 子どもの画面: 「{sup}が {child}の画面に入っている」+ band_note（#self では band_self）+「記録を見る」「出る」。子どもの画面では紫 --sup-frame の帯 + body::after 5px 固定枠 sup.css:9-15 |
| `（#talk に差し込み）composer .segmented.stance` | 入っている間の入力のしかた 3 つ（proxy/voice/idea、aria-pressed）。talk.js:231-236 が DES.sup.stance()/t() を読んで描く。#self では #main に inert（app.js:436） |

### 操作（data-action など 38 件）

- `sup-nav（data-arg=hash）` — 帯の「記録を見る」「{child}の画面に戻る」/ 個別見出しの「{child}の画面に戻る」/ サポーター用サイドバー nav（app.js:333） → go(hash): hash を変える（同じなら DES.app.render()）sup.js:25,331（保存: なし）
- `sup-join` — 教室の一覧 はると のカード「一緒に入る」(sup-view.js:118-122,131) / 個別見出し右の主ボタン (sup.js:298) → SUP.join(): 入っていなければ DES.app.change(enter) — sup.join={child,stance:'proxy',since:now}・snapRef を今の状態で作り直し・DES.make.setWith(田中さん)・addLog('join','in',log_in「{chil（保存: des3.sup（join, log）。DES.app.commit 経由で全キー保存）
- `sup-leave` — 帯「出る」（全ルート）sup.js:251,254。役タブ「子ども」からは app.js:487 が DES.sup.leave('#talk') を直接呼ぶ → SUP.leave(dest): DES.app.flushPending()（退場 200ms 待ちの変更を先に走らせる）→ change(addLog('join','out',log_out「{child}の画面から出た」); sup.join=null; setWith(null)) → go(dest || （保存: des3.sup（join=null, log））
- `sup-stance（data-arg=proxy|voice|idea）` — #talk composer の .segmented.stance（talk.js:235） → SUP.setStance: 入っていて STANCES に在る時だけ sup.join.stance=s → DES.store.save('sup')（失敗なら saveFailed + renderSaveState）→ DES.talk.syncStance()（aria-pressed と placehold（保存: des3.sup.join.stance（only='sup' なので observe は走らない sup.js:77））
- `（talk.js TK.send 経由）stance=voice の送信` — #talk composer 送る（talk.js:71-85） → DES.sup.voice(text): change(DES.talk.push({who:'supporter', by:'tanaka', text}); addLog('talk','voice',text,{msg})) — バディの返事なし sup.js:133-140（保存: des3.talk（supporter 発言）, des3.sup.log）
- `sup-idea-send / （talk.js stance=idea の送信）` — 個別「今日」アイデアを出す欄「話すに出す」(sup-view.js:210,563-570) / #talk composer（talk.js:81） → SUP.postIdea(text): catalogId=DES.plan.match(text)?.id、ideas に {state:'open',msgId,day,time} 追加・talk.push({who:'supporter',by,idea:id,text})・addLog('talk','idea（保存: des3.sup（ideas, log）, des3.talk（2 件: supporter + buddy））
- `sup-idea-clear` — アイデア欄「やめる」sup-view.js:211,571 → DES.ui.supv.idea='' → 再描画 → focus sv-idea（保存: なし（一時値））
- `idea-make（data-id）` — #talk のアイデアカード「作るで試す」（talk.js:178-181） → SUP.ideaMake → DES.make.fromSupIdea({id,text,onAdded}) が fromText で活動を作り quote=null・a.idea=id・origin:'talk'、同じ change で x.state='made'・x.actId、#make/<actId> へ s（保存: des3.activities（make の包み）, des3.sup.ideas, des3.makeSide）
- `idea-open（data-id）` — #talk のアイデアカード「続きを作る」（state=made）talk.js:182 → SUP.ideaOpen → ideaView で活動が生きていれば DES.make.openAct(actId)（止めていれば再開して #make/<id>）sup.js:185, make.js:1224-1231（保存: des3.activities（再開時））
- `idea-plan（data-id）` — #talk のアイデアカード「予定に入れる」（catalogId がある時）talk.js:179 / 個別「今日」アイデア一覧（外された行の時にもう一度）sup-view.js: → SUP.ideaPlan → DES.plan.act.addFirst(catalogId,{idea:id, undo:true, after:{focus:'idea:'+id}, onAdded: state='planned', rowId}) — 最初の空きに mine 行（r.idea）+ 会話に記録行 （保存: des3.plan, des3.talk（記録行）, des3.sup.ideas）
- `idea-later（data-id）` — #talk のアイデアカード「あとで」talk.js:180 → change(x.state='later', {focus:'idea:'+id}) → トースト DES.t('idea_later_toast')「あとで考えることにした」sup.js:191-196（保存: des3.sup.ideas）
- `idea-withdraw（data-id）` — 個別「今日」アイデア一覧 .link-btn「取り下げる」sup-view.js:201 / #talk カード右上（入っている間だけ）talk.js:189 → canWithdraw（open|later のみ）→ change(state='withdrawn'; addLog('talk','desk',log_idea_withdraw)) → トースト withdrawn_toast「取り下げた」+「元に戻す」（prev に戻し addLog log_idea_bac（保存: des3.sup（ideas, log））
- `sup-talk-all` — 個別「今日」本人の言葉「会話を全部見る」sup-view.js:174,561 → openTalk(el,null): #sup-dialog を sup-talk-dialog にして DES.talk.messages() を DES.talk.messageEl(m,{readOnly:true}) で並べ、DES.app.openDialog → h2 へフォーカス sup-view.js:（保存: なし）
- `sup-see-talk（data-id=log id, data-arg=msgId）` — 足場かけの記録の各行「会話で見る」（ref.msg が今の会話に在る時）sup-view.js:460,562 → openTalk(el,msgId): 同ダイアログを開き、data-id=msgId の要素に tabindex=-1・.is-sup-focus を付けて focus + scrollIntoView(center) sup-view.js:235-242（保存: なし）
- `sup-note-open / sup-note-cancel（data-id=axis）` — 手がかり 各観点カード下「観察を足す」/ 行内「やめる」sup-view.js:303-305,574-575 → DES.ui.supv.noteAdd[axis]='' で行内 editor を開く（focus note-new:<axis>）/ delete で閉じる（focus note-add:<axis>）（保存: なし（一時値））
- `sup-note-save（data-id=axis）` — 観察メモ 行内 editor「残す」（空は disabled）sup-view.js:304,576-586 → change(notes.concat({id:newId('n'),axis,text,day,time}); addLog('note','desk',log_note_add「{axis}に観察を足した」)) → トースト saved_toast「残した」（保存: des3.sup（notes, log））
- `sup-note-edit / sup-note-ecancel / sup-note-update（data-id=note id）` — 観察メモ行「直す」→ 行内 editor「残す」「やめる」sup-view.js:289-299,587-604 → edit: noteEdit[id]=text を開く / ecancel: 閉じて「直す」ボタンへ戻す / update: 同文なら閉じるだけ、違えば change(n.text=text; addLog log_note_edit「{axis}の観察を直した」) → saved_toast（保存: des3.sup（notes, log）（update のみ））
- `sup-note-del（data-id）` — 観察メモ行「消す」sup-view.js:298,605-623 → change(notes から除く; addLog log_note_del) → トースト removed_toast「消した」+「元に戻す」（元の位置へ splice・addLog log_note_back「{axis}の観察を戻した」）。記録は消さない（追加のみ）（保存: des3.sup（notes, log））
- `sup-adv-clear` — 助言を書く「やめる」（advDirty の時だけ押せる）sup-view.js:366,626 → DES.ui.supv.adv={aim:'',basis:'',scene:'none'} → 再描画 → focus sv-adv-aim（保存: なし）
- `sup-adv-send` — 助言を書く「助言を共有する」（ねらい空は disabled）sup-view.js:365,627-638 → change(advice の先頭に {id:newId('ad'),day,time,mine:true,added:true,state:'new',prev:null,scene,aim,basis,stages:{view:null,trial:null,result:null,update:null}}; a（保存: des3.sup（advice, log））
- `sup-adv-edit / sup-adv-ecancel / sup-adv-update（data-id）` — 助言カード（mine）「直す」→ 1 段目の行内 editor（ねらい・根拠）sup-view.js:377-383,639-660 → edit: advEdit[id]={aim,basis}（seed は nm() で {sup}{child} を埋めた文）/ update: 変化なしなら閉じる、あれば change(adviceMine(id)（seed なら state へ写してから）.aim/basis を更新; addLog log_adv（保存: des3.sup（advice, log））
- `sup-adv-view（data-id）` — 足した助言だけ（added && stages.view 無し && 未取り下げ）「バディの見立てを見る」+ 小さく「応答はサンプル」sup-view.js:390,661-670 → change(x.stages.view = t(scene!=='none' ? 'advice_view' : 'advice_view_any')（固定文）; x.state='waiting') → focus adv:<id>。記録は付けない（保存: des3.sup.advice）
- `sup-adv-withdraw / sup-adv-back（data-id）` — 助言カード「取り下げる」/ 取り下げ済みカード「戻す」sup-view.js:391-392,671-691 → withdraw: change(x.prev=state; state='withdrawn'; addLog log_advice_withdraw) → トースト withdrawn_toast +「元に戻す」(adviceBack) / back: change(state=prev||'new'; prev=（保存: des3.sup（advice, log））
- `sup-log-filter（data-arg=all|plan|talk|make|other）` — 足場かけの記録 3 節目の .segmented.sup-filter（aria-pressed）sup-view.js:466-469,694-698 → change(sup.logFilter=k) → 再描画（C.logView で絞り込み・日→時刻の新しい順）（保存: des3.sup.logFilter）
- `sup-rp-edit / sup-rp-ecancel / sup-rp-save（data-id=item id）` — レポート 各項目「直す」→ 行内 editor「残す」「やめる」（sent の間は disabled・写しにだけある項目には出さない）sup-view.js:490-501,713 → edit: rpEdit[id]=今の文（live && 未送信のみ）/ save: change(文が orig と同じなら edits[id] を消す、違えば edits[id]=text; toDraft(rp)（checked→draft・body=null）) → saved_toast（保存: des3.sup.report（edits, state, body））
- `sup-rp-restore（data-id）` — 直した項目「元の文に戻す」sup-view.js:498,730-734 → change(delete edits[id]; toDraft(rp))（保存: des3.sup.report）
- `sup-rp-off（data-id）` — 各項目「載せない」⇄「載せる」sup-view.js:499,735-739 → change(off[id] を toggle; toDraft(rp))。載せない項目は .is-off + チップ rp_off_chip「載せない」（保存: des3.sup.report）
- `sup-rp-check` — 状態 draft の主ボタン「確かめた」（載せる項目 0 なら disabled + 1 文 rp_need_one）sup-view.js:506,745-754 → rpBusy（600ms 二度押し防止）/ state!=='draft' / onCount 0 なら無視 → change(state='checked'; body=C.reportFreeze(draft, extra)（写し）; addLog('report','desk',log_report_checke（保存: des3.sup（report.state/body, log））
- `sup-rp-send` — 状態 checked の「送る」（横に小さく rp_send_note「このモックでは送られない」）sup-view.js:511,755-765 → change(state='sent'; sentAt= today+' '+now; addLog log_report_sent「レポートを送ったことにした（体験例）」) → トースト rp_sent_toast「送ったことにした（体験例）」。実送信は無い（保存: des3.sup（report, log））
- `sup-rp-draft` — checked の「下書きに戻す」/ sent の .btn.small「下書きに戻す」sup-view.js:510,514,766-776 → change(state='draft'; body=null; sentAt=null; addLog log_report_draft「レポートを下書きに戻した」) → 今の記録から作り直す → focus rp-state（保存: des3.sup（report, log））
- `sup-rp-preview` — 操作列 .btn「おうちの人に届く形を見る」sup-view.js:504,539-554,777 → openPreview: #sup-dialog を sup-preview-dialog にし、C.reportOut(now.sections)（載せる項目だけ・0 件の節は出さない）+ 補足 + rp_from「{sup}より」を素の文で並べる → h2 へフォーカス（保存: なし）
- `dialog-close（app.js A）` — #sup-dialog の × (closeX sup-view.js:83) / Esc（app.js:602 cancel → closeDialog） → DES.app.closeDialog → 開いたボタン（_returnKey）へフォーカスを戻す app.js:217-244（保存: なし）
- `input / change / compositionend（document リスナー・data-ui=sv-*）` — sv-idea / sv-adv(aim,basis,scene select) / sv-note-add / sv-note-edit / sv-adv-edit / sv-r → 値を DES.ui.supv に持ち、該当ボタンの disabled を setDisabled で即時更新。sv-rp-extra は入力ごとに rp.extra=val → saveSup()（記録なし）。checked の間に sv-rp-extra / sv-rp-edit へ入力（IME 変換中を除く）→ d（保存: des3.sup.report.extra（sv-rp-extra のみ・毎キー保存）/ 他は一時値）
- `タブ移動（<a href="#sup/haruto[/tab]"> nav.segmented.sup-tabs）/ 戻る <a href="#sup">` — 個別画面の見出し下 sup.js:300,303-306 → hash 遷移 → SUP.render。タブ間移動では h1 でなく移った先のタブリンクにフォーカスを残す（u.last が kid:* の時）sup.js:313-318。ルートを離れると DES.sup.resetUi()（app.js:528）が fresh=true・DES.ui.supv=null（書きかけ（保存: なし）
- `キーボード / フォーカス管理` — 全画面 → 開いたら h1(tabindex=-1) へ。change の o.focus / o.sel で data-fk（idea:<id> / adv:<id> / note:<id> / rp:<id> / rp-state / sv-* / note-add:<axis> ...）へ戻す（app.js commit f（保存: なし）
- `（受動）DES.store.save の包み observe` — どの画面でも、入っている間に他モジュールが保存した時 sup.js:75-89, sup-core.js:186-253 → 元の save 成功後に C.observe(state, snapRef, only, ctx) → diff（msg+/row+/rowMine/rowHidden/act+/chg+/say+/work+/share+/found+）→ 印（r.by / a.by / w.by / c.day / sup.hel（保存: des3.sup（log, helped）+ des3.plan / des3.activities / des3.wo）
- `（受動）TK.push の by 付与 / make.commitChange の with 付与` — talk.js:18-22 / make.js:247-253 → 入っている間 who:'child'|'record' の発言に m.by=SUP.byNow()、who:'own' の変化に c.with=SD.supporter.name（setWith で sup.js が 読み込み/入る/出る 時に設定）（保存: des3.talk / des3.activities）
- `reset（app.js A['reset']・サポーター用サイドバー「はじめの状態に戻す」）` — fillSupSidebar app.js:341 → DES.store.reset: des3.* を前方一致で全部消して #talk へ reload（des3.sup も消える）store.js:71-79（保存: des3.* 全削除）

### ダイアログ・シート

- <dialog class="make-dialog sup-dialog" id="sup-dialog"> (index.html:41) — 唯一の dialog。開閉は DES.app.openDialog(dlg, opener)/closeDialog（showModal・_returnKey でフォーカス戻し）。closeTransient（app.js:520）と placeToa
- #sup-dialog の変種 1: className 'make-dialog sup-dialog sup-talk-dialog'（会話を全部見る）: .dialog-head > h2#sup-dlg-h(tabindex=-1) + .icon-btn[data-action=dialog-close] / .dialog-body > .message-list.sup-talk（D
- #sup-dialog の変種 2: className 'make-dialog sup-dialog sup-preview-dialog'（おうちの人に届く形）: h2#sup-dlg-h rp_preview_h「{child}の 1 週間（{from}〜{to}）」/ .dialog-body.rpv > .rpv-sec（h3 + ul）+ .rpv-extra + .rpv-from
- <section class="join-band" id="join-band" hidden> (index.html:22) — dialog ではなく常設の帯（role=status は付けない・aria-label「一緒に入っている」）。.jb-text / .jb-ops。SUP.renderBand(route) が毎描画で中身を作り直す sup.js:240-258
- #nav-drawer（既存 dialog）— sup ルートではサポーター用サイドバーと同じ中身を fillSupSidebar で入れる app.js:351
- 行内 editor .inline-edit.sup-edit#sv-<fk>-box（観察メモ・助言の直し・レポート項目の直し）— dialog ではなく行内差し替え sup-view.js:85-100
- sheet / drawer はこのモジュール独自には無し（#self-sheet は入っている間 inert で開けない app.js:436）

### 状態

- **入っていない（join=null）**: 帯 hidden・html に is-joined 無し。個別見出しの主ボタン「一緒に入る」(.btn.orange)。教室カードに「一緒に入る」。#talk composer に stance 帯なし。sup.js:45,296-298
- **入っている（join あり）**: 帯表示（sup ルート:「{child}の画面に入ったまま」/ 子どもの画面:「{sup}が {child}の画面に入っている」+ 小「予定・会話・作る・作品・お題 でしたことは 足場かけの記録 に残る」/ #self:「ここは {child}が自分で書くところ。入っている間は見るだけ」）。子どもの画面では帯が紫 --sup-frame + 画面外周 5px 固定枠（sup.css:9-15）。#self の #main に inert
- **教室の一覧・他の子は読むだけ**: 4 人のカードは disabled「開く」のみ・一覧の下に 1 回「このモックで開けるのは {child}だけ」sup-view.js:131-132,148
- **今日・空状態**: 本人の言葉 0 件「今日の発言は、ここに出る」/ バディの提案 0 件「今日の提案は、ここに出る」/ アイデア 0 件「出したアイデアは、ここに並ぶ」(.sup-empty) sup-view.js:173,186,203
- **アイデア 入力中 / 送信中**: textarea 空 → 「話すに出す」disabled・「やめる」disabled。送信後 150ms は DES.ui.sending=true で「話すに出す」disabled（busy）。出したら欄を空にしトースト「話すに出した」sup-view.js:190,210-211,563-570
- **アイデアの状態（pill）**: open「返事待ち」/ later「あとで考える」/ made「作るで試している」/ planned「予定に入っている」（行が removed →「予定から外した」+「予定に入れる」再掲、finished →「終わった」）/ withdrawn「取り下げた」。取り下げるは open|later のみ。行・活動が消えていれば open と同じ扱い（ideaView）sup.js:170-179, sup-view.js:193-201
- **手がかり・本人の返事で装飾**: src:'ai' で rx edited → 本人の文を出し 本人チップ「本人が直した」+ 下に「もとはバディの見立て」+ 元の文 / agreed → バディチップ + 本人チップ「本人が「合ってる」と返した」/ away → .is-away（薄く）+「本人が「今はちがう」と返した」/ src gap → .src-gap「まだ分からない」。des3.self が読めなければ装飾なし sup-view.js:252-266, sup
- **観察メモ 入力中 / 保存後 / 削除後**: 行内 editor「残す」は空で disabled（「空は残せない」）。保存でトースト「残した」。削除でトースト「消した」+「元に戻す」(5 秒)。sup-view.js:96,585,603,614
- **助言 入力中**: 「助言を共有する」はねらい空で disabled・「やめる」は advDirty の時だけ。送るとトースト「助言を共有した」・一覧先頭・欄が空に sup-view.js:365-366,637
- **助言カードの状態**: 状態チップ new「これから見る」/ waiting「機会を待っている」/ adjusted「方法を調整した」/ tried「試した」/ pending「結果を待っている」/ withdrawn「取り下げた」(.is-withdrawn・操作は「戻す」のみ)。空の段: 2「バディはこれから見る」3「試す場面を待っている」4「試していない」5「結果が出てから」。足した助言で view 無し → 「バディの見立てを見る」+「応答はサンプル」
- **記録・空 / 今日 / 古い分**: 絞って 0 件「{filter}の記録は、ここに出る」/ 日見出しは今日なら「今日」/ 末尾注記「10/26 より前は、このモックでは週ごとの数だけを入れている」。記録は消せない sup-view.js:471-473
- **手伝いの移り変わり・週 0 回 / 読み取り文**: 0 回の週は四角なしで「記録なし」。読み取り 1 文: fade_none「{label}: 今週の記録はこれから」/ fade_up「…自分で進める割合が上がっている」/ fade_flat「…{sup}と一緒に進めている」/ fade_only（過去全 0）「{label}: 今週は {n1} 回のうち自分で {o1} 回」。超過は「ほか {n}」sup-view.js:419-446, sup-core.js:298-318
- **レポート draft（下書き）**: 状態チップ「下書き」。主ボタン「確かめた」。載せる項目 0 → disabled + .sup-warn「載せる項目を 1 つ以上選ぶ」。直す/載せない/補足が使える。中身は今の記録から毎回作る sup-view.js:505-507,519-536
- **レポート checked（確かめた）**: チップ「確かめた」。中身は report.body（写し）。操作列: 「下書きに戻す」+「送る」+ 小「このモックでは送られない」。直す・元の文に戻す・載せない・補足入力・項目欄への入力（IME 確定後）で draft に戻る（body=null）。今の記録と写しが違えば .sup-warn「確かめたあとに、元の記録が変わっている。下書きに戻すと今の中身になる」。写しにだけある項目は操作なし sup-view.js:483-487,50
- **レポート sent（送った）**: チップ「送った」。文「{at} に送った（体験例）」+ .btn.small「下書きに戻す」。直す/載せない/補足 disabled + .sup-warn「送ったあとは、下書きに戻してから直す」。送信トースト「送ったことにした（体験例）」sup-view.js:512-515,523,534,764
- **レポート 項目の装飾**: 直した → 緑チップ「{sup}が直した」+「元の文に戻す」/ 載せない → .is-off + チップ「載せない」（打ち消し線なし）/ 出所チップ own「本人の言葉」record「記録」calc「記録から」sup-view.js:488-501
- **二度押し防止（レポート遷移）**: 確かめた→送る→下書き の直後 600ms は同じ遷移先のまま押し直しを受けない（rpBusy）。フォーカスは状態チップへ sup-view.js:742-744
- **保存失敗（saveFailed）**: 包んだ save は元の save が失敗したら observe しない・写しも更新しない。印/sup の再保存失敗は st.saveFailed=true のみ（巻き戻さない）。画面は既存の save-indicator save_fail（renderSaveState）。記録は増えない sup.js:75-89,128, sup-view.js:39
- **壊れた保存の正規化**: normalize: 形が違う欄はその欄だけ初期値・知らない欄は捨てる。checked/sent なのに body 無し → draft に戻し sentAt=null。log 500 件超は古い方から落とす。des3.sup 無し（古い保存）でも他キーはそのまま sup-core.js:35-134
- **出た直後**: #sup/haruto/log へ遷移 + トースト「出たよ。入っている間のことは 足場かけの記録 に残っている」。記録の順は 操作 → 出た（flushPending）sup.js:110-124
- **知らないパス**: main 空 → #sup へ replace + トースト「見つからなかったよ」sup.js:277-282
- **フォーカス（開いたとき / タブ移動）**: 開いたら h1 へ。sup 内でタブを移った時は移った先のタブリンクへ。ルートを離れると fresh=true・一時値 supv を消す sup.js:313-327

### 架空のまま出してはいけないもの

- DES.supData.log（seed 6 件の過去の記録: 10/28・10/30 の はると への手伝い）— 本物の記録だけを出す。無ければ空状態（lg_empty）
- DES.supData.weeks（過去 4 週の own/cue/by の数）— 実記録から週集計。固定値で「自分で進める割合が上がっている」を出さない
- DES.supData.advice（seed 2 件・田中さんが書いたことになっている助言と、バディの見立て/試行/結果/更新の文）— 保存済みの助言と実応答だけ
- sup-adv-view の固定文 advice_view / advice_view_any + 「応答はサンプル」— バディ AI の実応答へ。ボタンで見立てを「見る」操作自体を無くすか非同期に
- postIdea の setTimeout 150ms 固定返事（i18n idea_rep_match / idea_rep_free）— バディ AI の実応答へ（sending フラグ・syncSend の扱いも実応答の到着に合わせる）
- DES.supData.report.items（9 文: 駅の建築・ビーズ・Python の希望 等）と span 10/26〜11/2 — 実記録から生成した週次下書き。「予定だけのことは『これから』」「気持ちの見立ては入れない」の規則は生成側で守る
- レポートの「送る」= 実送信なし（rp_send_note「このモックでは送られない」/ rp_sent_toast・rp_sent_line・log_report_sent の「（体験例）」）— 本当の配信（保護者への届け方）を実装するか、ボタンを出さない
- DES.supData.children の 4 人（あおい・そうた・みお・れん）の now/next/consult/checks と、only_child「このモックで開けるのは {child}だけ」— 名簿から人数分の childRow を実計算し全員を開けるように
- DES.supData.checks（3D プリンター / 作品を外に見せる の 2 件）— バディの door 項目・教室ルールから生成
- DES.supData.supporter（tanaka / 田中さん 固定）と SUP.nameOf が id を無視する点 — 認証されたサポーターと id→名前の対応
- DES.data.today / now / weekday / group の固定時刻と、M/D（年なし）の day・sentAt・join.since — 実時計・ISO 日付。dayNum（月*100+日）の並び替えは年をまたぐと壊れる
- DES.data.child 固定（haruto）と parse() の単一児ガード — #sup/<childId> の一般化
- DES.data.talk / plan の seed（talk-0〜5・p1〜p7）と DES.selfData の見立て — 実会話・実予定・バディの live 学習者モデル（手がかりタブ全体）
- lg_older「10/26 より前は、このモックでは週ごとの数だけを入れている」の注記 — 実装では不要
- des3.sup の localStorage 保存（500 件上限・端末ローカル）と des3.self の直接読み — サーバー保存（append-only ログ・複数端末・複数サポーター）
- DES.plan.newId（Date.now 由来のクライアント id）— サーバー発行 id
- report.extra の毎キー保存（saveSup）— debounce か明示保存へ

### 見本として残せるもの

- DES.supData.text の UI 文言（タブ名・箱の見出し・説明文・placeholder「こんなの作ってみてもいいのでは？ を書く」・空状態の文・決まり 3 行・ad_sub / cl_sub / fd_sub1-2 / how_note の注意書き）— i18n として保持
- DES.supData.axisHead（関心 / 志向性 / 体験 / 心理面の手がかり / 習熟）と scenes のラベル（予定を決める / バディに話す / 作る）
- 助言の 5 段の見出し（観察と助言 / バディの見立て / 小さな試行 / 反応と結果 / 仮説の更新）と空の段の文、状態チップの語
- レポートの節見出し 6 つ（話していたこと … 次につながること（これから））と「自分で進めたこと」末尾の固定 1 文 rp_own_note、読み取り文のテンプレ fade_up/flat/none/only・rp_own_up/flat
- 手伝いの移り変わりの四角の凡例（自分で = 塗り / きっかけ = 枠 / 代わりに = 砂）と最大 10 個 + 「ほか {n}」の見せ方（C.squares）
- 記録の how / scene の語（代わりに入力・代わりに操作・{sup}として話す・アイデア・入った・出た・サポーター画面で / 予定・話す・作る・作品・今日のお題・一緒に入る・助言・観察・レポート）
- アイコン people（教室）・self（個別）とサポーター用サイドバーの形（app.js fillSupSidebar）
- sup.css のレイアウト・色（--sup-frame 紫の帯と外周枠・src チップの色分け）
- 入力のしかた 3 つ（proxy / voice / idea）の語と placeholder
- アイデアカードの状態の語（返事待ち / あとで考える / 作るで試している / 予定に入っている / 取り下げた）

