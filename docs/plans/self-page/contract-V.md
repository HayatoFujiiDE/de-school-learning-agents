# 契約 §V — 自己理解（`#self`）（凍結 2026-11-05。CONTRACT-v3 §A〜§T を継承し、食い違いは本節が優先）

文言の正本は `app-v3/js/self-data.js`（司令塔が書いた verbatim。言い換え禁止・実装担当は書き換えない）。本書は構図・振る舞い・状態・検証を決める。設計の元: 設計パネル 3 案（構図 / 本人の主導権 / 子どもの体験）+ 採点 2 本の合成（構図は「構図」案、操作ループは「本人の主導権」案から接ぎ木）。

## V-0 オーナー確定（2026-11-05・蒸し返さない）

1. コメントするのは **バディエージェント 1 人**（`DES.buddy`）。観点ごとの別エージェントは作らない
2. 得意・成長は評価語にせず **場面つき**で書く（見出し「できるようになってきたこと」「次にのびそうなところ」）
3. 真ん中は **本人のアバター = やわらかい人物イラスト**（Codex 画像生成・架空）。髪型と服の色を選べる。バディと見た目で分ける（アバターは話さない・吹き出しを持たない）
4. **全部の見立てに本人が反応・書き換えできる**。書き換えたら本人の言葉として出し、元の見立ては履歴に残す
5. 成長ポイントの理想形: 本人が苦手・困ることを自覚 → **AI と一緒にやる / 環境を変える / 道具を作る** の工夫をバディが提案 → 本人が選び・試し・合うものを残す。この画面は「その意識を持てるための入口」で、次（実際の道具づくり・試行）につながる
6. **§I の例外**: 「苦手」は本人が自分について書く入口の文言（`kufu.add_scene`）でだけ使う。AI が本人に「苦手」「得意」のラベルを付けない。「得意」「成長」「評価」「レベル」等は引き続き画面に出さない

## V-1 ファイル（既存ファイルへの差分は最小 — 並行の feat/make-page が app.js / index.html / i18n.js / CONTRACT-v3.md を触る）

| ファイル | 種類 | 内容 |
| - | - | - |
| `app-v3/js/self-data.js` | 新規・**司令塔作成済み・触らない** | 正準データと全文言 |
| `app-v3/js/self.js` | 新規 | `DES.self`（純関数 `reduce` / `validate` + 描画 + 操作）。文言は `DES.selfData.text` 等から `DES.mode()` で js/es を引く関数 `ST(obj)` を自前で持つ |
| `app-v3/css/self.css` | 新規 | 本ページの全スタイル（`.src-gap` を含む） |
| `app-v3/img/self/avatar-{h1..h3}-{c1..c4}.jpg` | 新規・**司令塔が用意** | 480×480 JPEG・12 枚 |
| `app-v3/index.html` | 変更 +4 行 | `<link rel="stylesheet" href="css/self.css">` / `<dialog class="self-sheet" id="self-sheet" aria-labelledby="self-sheet-h"></dialog>` / `<script src="js/self-data.js">` と `<script src="js/self.js">`（app.js より前） |
| `app-v3/js/app.js` | 変更 +1〜3 行 | `APP.render` の route 分岐に `self` → `DES.self.render(main)`。他は変えない |
| `tools/check.sh` | 変更なし | `sh tools/check.sh self talk plan` で使う |
| i18n.js / store.js / plan.js / talk.js / data.js / buddy.js | **変更しない** | 予定・相談は既存の action（`grid-add` / `grid-ask` / `DES.talk.prefill`）を呼ぶだけ |

保存は `DES.store` を使わず self.js 内で `localStorage['des3.self']` を try/catch で読み書きする（既存の「はじめの状態に戻す」= `des3.*` 一括削除で消える）。失敗時はメモリで続け `DES.state.saveFailed = true; DES.app.renderSaveState()`。

## V-2 構図（CSS だけ。JS で位置を測らない。ブレークポイントは app.js の bp: ≥1121 / 951–1120 / 701–950 / ≤700）

**意味**: 中段 = バディ | 本人 | いまの調子。上段 = 惹かれること（関心 | 志向性）。下段 = やってきたこと（体験 | 習熟）。その下の全幅の帯 = 困りやすいことと工夫（次の一歩）。

- ページ頭: h1 = `DES.t('self')`（29px / ≤700 25px）、p = `text.intro`（13px muted、max-width 620）、右に凡例チップ 4 つ（`legend_own/record/ai/gap` — 操作ではない）と `.date-stamp` = `text.as_of`。≤700 は凡例を h1 の下へ折り返し
- **≥1121**: `.self-page` max-width 1140。`.self-orbit` = grid `minmax(0,1fr) 240px minmax(0,1fr)`、column-gap 36 / row-gap 32、areas `"int . ori" / "bud hub psy" / "exp . mas"`。下に `.kufu-band`（全幅）
  - hub: アバター 200px 円（地 `#f3eee5`、外側 6px 空けて 1.5px リング `#524e4440` — `--own` / `--ai` の色を使わない）、名前 16px/700、`.btn.ghost.small` `avatar_change`。hub の `::before` 円 340px（1px solid `--line`）/ `::after` 円 600px（1px dashed `#e6e2d8`）、z-index はカードより下。中央列の 1・3 段目は空けて円が見える
  - 四隅カードの hub 側の辺 `top:34px` に 7px の点（`#a3ab96`）+ 隙間方向へ 36px の 1px 線
  - 中段（bud / hub / psy）の行は `position: sticky; top: 96px` は**付けない**（グリッド行の sticky は崩れる）。代わりに hub セル内の `.self-hub-inner` を sticky top 96px にする（下段を読む間もアバターが見える）
  - bud = `DES.buddy(44,'neutral')` + 白吹き出し（`.bubble` 形、radius `14px 0 14px 14px`、max-width 360、13px）、右寄せ・縦中央
  - `.kufu-band`: 上辺中央に hub から下りる 1px dashed の縦線 32px（`::before`）、白カード radius 18
- **951–1120**: 4 列 `minmax(0,1fr) 84px 84px minmax(0,1fr)` gap 20、areas `"int int ori ori" / "bud hub hub psy" / "exp exp mas mas"`。アバター 150、円 300 / 520
- **701–950**: 2 列 areas `"int ori" / "hub hub" / "bud bud" / "psy psy" / "exp mas"`。アバター 140、外円 260 のみ。吹き出しは hub 直下中央 max-width 520
- **≤700**: 1 列。順: 頭 → hub（アバター 132、外円 220）→ 吹き出し → **関心 → 志向性 → 体験 → 心理 → 習熟** → 工夫の帯 → 共有の 1 行。左に縦の背骨線（1px `--line`、x=8）と各カード見出し高さに 9px の点、カードは左 20px 下げる。下余白 80px（tabbar）。横スクロール禁止
- ページ末尾: `.privacy-line`（lock）+ `text.share`
- 文字: 本文 13px / 行間 1.8、メタ 11px、グループ見出し 10px eyebrow。es は 14 / 12 / 11。操作領域 js 44px / es 48px

## V-3 カードと行

- 各カードは `<section class="axis-card" aria-labelledby>`、見出し（axes[].head）+ 右端に `.btn.ghost.small`（plus + `text.add`）= そのカードに本人の言葉を足す（psy は「いま」グループに入る）
- 行の形（出所の区別。R-10 の延長）:

| src | 行 | チップ |
| - | - | - |
| own | 白地・左 3px `--own` | `.src-own` quote + `legend_own` + 日付 |
| record | 白地・左 3px `--record` | `.src-record` record + `legend_record` + 日付（習熟は cond チップ `cond_*` を灰 `.chip` で添える） |
| ai | 白地・1px dashed `--ai`・radius 10 | `DES.buddy(18,'think')` + `.src-ai` spark + `legend_ai` |
| gap | 枠なし・文字 `--gap` | `.src-gap`（地なし・1px dashed `#cfcabd`）+ `legend_gap` |

- カード内の並びは items の配列順。`fold:true` は閉じた時「ほか {n} 件」（`text.more`）に入り、押すと開いて `text.less`。体験カードは左に日付列（48px・11px muted）
- **合ってる と返した見立ては ai の形のまま**（dashed を保つ）で、`.src-own` の小チップ `agreed_chip` + 日付を足すだけ。本人の言葉の形にしない
- 日付表示は `M/D`（'10-30' → 10/30）。`time` があれば「11/2 10:12」
- `from: 'talk-N'` を持つ根拠は「会話で見る →」（`#talk`、該当メッセージへスクロールは不要）、`to:'plan'` は「予定で見る →」（`#plan`）

## V-4 反応と書き換え（状態機械・純関数 `DES.self.reduce(state, action)`）

保存形 `des3.self`:
```js
{ v: 1,
  avatar: { hair: 'h1'|'h2'|'h3'|'none', color: 'c1'..'c4' },
  rx: { '<itemId>': { state: 'agreed'|'edited'|'away', vers: [{ text, at }], cur: -1|0..n } }, // 無い = pending。cur -1 = 元の見立て
  notes: [{ id, axis, group|null, on: null|'<recordId>', vers: [{ text, at }], cur: 0, gone: false }], // 本人が足した言葉・記録への注記
  door: { 'int-d1': 'added'|'not_now' },
  kufu: { scenes: [{ id, text, at, gone:false }],            // 本人が足した場面
          ideas: { '<ideaId>': { status: 'trying'|'result'|'away', result: 'fit'|'meh'|'adjust'|null, note: '', at } },
          own: [{ id, scene, text, at, gone:false }] },        // 本人が足した工夫（kind:'self' 扱い）
  log: [{ id, item, act, text, at }],                          // 履歴（新しい順に表示）
  draft: null | { target, mode, text } }                       // 入力途中（再読み込みでも戻す）
```
`validate(raw)` は形の違うキーを捨てて既定を返す（壊れた JSON でも画面が出る）。日付 `at` は `DES.data.today` の 'MM-DD'。新 id は `'n' + Date.now().toString(36) + '-' + 連番`。

**見立て（src:'ai'、door 以外）**

| 状態 | 操作 | 次 | 見え方 |
| - | - | - | - |
| pending | 行を押す（`<button aria-expanded>`） | open | 行内に 手がかり（basis: チップ+日付+文+リンク）/ 反対の手がかり（counter、空なら行ごと出さない）/ 反応 `react_agree` `react_fix` `react_not_now` + `.link-btn` `react_talk` / hint `react_hint`。200ms |
| pending / edited | 合ってる | agreed | `agreed_chip` を足す。トースト `t_agree` + 戻す |
| pending / agreed / edited | 少しちがう | 編集（fix） | 行内 textarea に現在の文を入れて開く。ラベル `fix_label`、`save` / `cancel` |
| 編集 | 残す（trim 空 or 編集前と同じ文は disabled。後者は hint `same_text_hint`） | edited | 行は own の形・本文は本人の文、小リンク `from_ai` · `history`。バディ 1 行 `reply_fixed` + トースト `t_fixed` + 戻す |
| 編集 | やめる / Esc | 元 | 何も変えず閉じ、フォーカスを行へ |
| pending / agreed / edited | 今はちがう | away | 行はカード下の `put_away`（n 件）の折りたたみへ移る。バディ 1 行 `reply_not_now` + トースト `t_not_now` + 戻す |
| away | もどす（折りたたみ内） | pending | 履歴に残す。トースト `t_back` |
| agreed / edited | 見立てに戻す | pending | 履歴に残す（`cur=-1`）。トースト `t_back` + 戻す |
| edited | 直す | 編集（今の本人の文入り） | 残すと vers に追加、前の版は履歴 |
| 任意 | 履歴 | 表示のみ | 新しい順。各版に `use_this`（cur を動かす）。0 件は `history_empty` |
| 任意 | 話して伝える | — | `DES.talk.prefill(<見立ての先頭 30 字>)` 相当の下書き → 既存の prefill トースト。§V はこれ以外 talk に書き込まない |

- **戻す（5 秒）** = 誤操作の取り消し（操作前の状態へ丸ごと・その履歴行も消す）。既存 `DES.app.toast(text, fn)`
- 返事しないことを同意として扱わない（pending のまま）。返事の催促・残り件数は出さない
- **door（int-d1）**: 予定に入れる（既存 `grid-add` と同じ処理を `data-action="grid-add" data-id="dig-3dprint"` で呼ぶ）/ 相談する（`grid-ask`）/ `kufu.not_now` 相当の「今はいい」→ `door.not_now`（折りたたみ・もどす可）
- **own（会話からの引用、from あり）**: 直せない。開くと `add_now_words` でそのカードに本人の言葉を足す
- **notes（本人が足した言葉・注記）**: 直す / 消す（gone、トースト + 戻す）
- **record**: 本文は直せない。開くと `note_on_record` で注記（own 形でその記録の直下）
- **gap**: 開くと `write_label` で本人の言葉を gap の直下に足す。gap 自体は残す
- 開いている行・編集中の入力は **ページで 1 つ**。別の行を開くと、変更なしならそのまま閉じ、変更ありなら draft に残したまま閉じる（戻った時に同じ行の編集欄へ戻す）
- 送信は「残す」か Ctrl/Cmd+Enter。IME 変換中（`isComposing`）は送らない。maxlength 200。本人の文は `textContent` で描く（innerHTML 禁止）

**工夫（kufu）** — 帯の中に場面ごとのブロック（左: 場面 + 手がかり、右: バディ 1 行 `scenes[].buddy` + 工夫の一覧）

| 工夫の状態 | 操作 | 次 | 見え方 |
| - | - | - | - |
| idle | 試してみる | trying | 種類チップ（`kinds[kind]`、4 種とも灰 `.chip` + 先頭の小アイコン: ai=spark / env=pin（新規 path `M12 21s7-6 7-11a7 7 0 1 0-14 0c0 5 7 11 7 11z M12 10h.01`）/ tool=make / self=pen（新規 path `M4 20h4L19 9l-4-4L4 16v4z`））の横に `trying` バッジ（橙を使わない: `--record-soft` 地 `--record` 字）+ `scenes[].when`。トースト `t_try` + 戻す |
| trying | `how_was` → 合った / いまいち / 少し変える（+ 任意 1 行 `r_note_ph`） | result | 合った → 帯の上部「`fit_list`」に移る（場面名つき）。いまいち → 工夫の下に結果チップ。少し変える → textarea（工夫の文入り）で直して trying のまま。トースト `t_result` |
| idle / trying | 今はいい | away | 折りたたみ（もどす可） |
| tool の工夫 | 話すで一緒に考える | — | `DES.talk.prefill` で `ideas[].prefill`（無ければ prefill テンプレート）を下書き。（§U の作るが main に入ったら「作るで開く」に差し替える — 本スコープでは talk） |
| — | 自分の工夫を書く | own 追加 | textarea → 残す → kind:'self'・本人の言葉の形で一覧に足す。トースト `t_idea` |
| — | 帯の見出し右 `add_scene` | 場面追加 | textarea（`scene_ph`）→ 残す → 新しい場面ブロック（own 形）。工夫は空で、バディ 1 行 `new_scene_buddy` + `kinds` の ai / env / tool の 3 ボタン → `DES.talk.prefill`（`kufu.prefill[kind]` に scene を入れる）。直す / 消す（戻す付き）。トースト `t_scene` |

- 初期: k2-self は seed により result/fit（「自分に合う工夫」に「形だけ先に決めて、色と長さはあとにする · アクセサリー作り · 10/30」が最初から 1 件ある）。k1 は全部 idle
- 同時に見える操作を抑える: 工夫の行の操作は「試してみる」1 つ + `more` メニュー（今はいい / tool は話すで一緒に考える）。trying になったら「やってみてどうだった？」1 つに置き換わる

## V-5 バディの話しかけ（中央の吹き出し・1 つだけ）

- 初期は `comment.first` + `.link-btn` `comment.link`（ori-a1 を開いてスクロール・フォーカス）
- `ask` の順で最初の pending を名指し: `comment.next`（{text} = その見立ての現モード文の先頭 20 字）。見立てが全部返事済み（agreed/edited/away）で、k1 に trying/result が無ければ `comment.kufu` + `comment.link_kufu`（帯へスクロール）。それも済んだら `comment.done`（リンクなし）
- 返事の直後だけ、その行に 1 行（`DES.buddy(18,'neutral')` + 12px）。次の操作で消える
- アバターは話さない

## V-6 アバター

- `img` = `img/self/avatar-{hair}-{color}.jpg`、alt `text.avatar_alt`、`onerror` と hair:'none' は同じ円の中に `avatar.initialLetter`（40px/700、色 `--ink`）
- `avatar_change` → `<dialog id="self-sheet">`（showModal。≤700 は下からのシート — 既存 `.pick-sheet` と同じ見た目の値）: h2 `avatar_h` / プレビュー 160 円（即時更新）/ `avatar_hair` の `.radio-card` 3 つ（64px サムネ + ラベル）+ `avatar_none` / `avatar_color` の色ラジオ 4（26px の点、当たり 44/48px。none の時は disabled）/ `.dialog-footer` `avatar_ok` と `cancel`
- これにする: 保存・トースト `t_avatar` + 戻す（前の値へ）。やめる / Esc / 外側クリック: 変えない。閉じたら「変える」へフォーカス
- 服の色の hex は画像にだけ使う値（UI の構造色にしない）

## V-7 受け入れ基準（ui-interaction-completeness）

- [ ] CRUD 対称: 見立て = 返事 / 直す / 今はちがう / もどす / 見立てに戻す / 戻す。本人の言葉・注記 = 書く / 直す / 消す（戻す付き）。工夫 = 試す / 結果 / 少し変える / 今はいい / もどす / 自分の工夫を書く。場面 = 書く / 直す / 消す。アバター = 変える / やめる / 戻す。省略: 記録本文と会話引用の編集（正本は data.js と作品）
- [ ] フィードバック: 全操作で行の差し替え 150〜200ms + トースト（取り消せる操作は戻す 5 秒）
- [ ] フォーム: 空・同文は残せない / 下書きは再読み込み・表示モード切替・ルート移動の後も戻る / やめる・Esc で元
- [ ] 状態: 見立て pending/open/agreed/edited/away、door、gap、履歴 0 / 1 以上、折りたたみ開閉、notes 0 件、工夫 idle/trying/result(fit/meh)/away、本人の場面 0 / 1 以上、保存失敗、画像読込失敗
- [ ] a11y: section aria-labelledby / 行は button aria-expanded / チップ aria-label（出所名）/ `DES.buddy` は role=img / Esc は 編集を閉じる → 開いた行を閉じる → dialog を閉じる の順 / focus-visible は codex の値 / reduced-motion で transition 0
- [ ] es: 全文言が es 値に変わる（own / record の本文は変わらない）
- [ ] 実機: 1440 / 1024 / 390 で目視（司令塔）・横スクロールなし

## V-8 検証（実装担当が実行し verdict だけ報告。合否の根拠は司令塔が自分で取り直す）

```
sh tools/check.sh self talk plan        # CHECK_RESULT=PASS
sh tools/render.sh <scratch>/render self # 1440 / 1024 / 390
node <scratch>/self-reduce.test.js       # reduce / validate の全遷移・戻す・draft・壊れた JSON（テストは scratch に置き、repo に入れない）
```
加えて `--dump-dom` 1440 で `.axis-card` = 5、`.self-hub img` = 1、`.kufu-band` = 1、`buddy-mark` = 0。禁止語 grep（`grep -rIE '得意|成長|上手|評価|レベル|ランキング|順位|成績|点数|集中力|学びのバディ' app-v3/js/self*.js app-v3/css/self.css`）が 0 件（「苦手」は V-0 の 6 により `kufu.add_scene` の 1 か所のみ許可）。

## V-9 スコープ外（作らない・報告に残す）

サポーター画面への反映、会話・予定データへの書き込み（door と prefill の既存操作を除く）、論点整理ツール本体、作る（§U）への遷移（talk で代替）、本番 AI 応答、気持ちの欄に深刻な内容が書かれた時のサポーターへの知らせ方（本番前に設計）。

## V-10 裁定（2026-11-05 Astra high 実装レビュー + 司令塔目視。§V-1〜V-9 に優先）

1. **構図の改訂（司令塔目視）**: 1440×900 の最初の画面にアバターが出ない（上段カードが高く、中段が折り目の下へ押し出される）。「真ん中に本人」が最初に見えることを優先し、≥1121 は **3 列の独立した縦積み**にする: `grid-template-columns: minmax(0,1fr) 280px minmax(0,1fr)`、column-gap 32。左列 = 関心 → 体験、中央列 = hub（アバター 200・名前・変える）+ その直下にバディの吹き出し（幅 280、尖った角は上辺中央）、右列 = 志向性 → 心理 → 習熟。各列は flex column（gap 24）で、行を揃えない。中央列の中身は `position: sticky; top: 96px`。hub の同心円は ::before 340px の 1 本だけ（カードより下の z-index）。四隅の点と線は、左列カードは右辺、右列カードは左辺の `top:34px` に置く。工夫の帯はその下に全幅
   - 951–1120: 上に hub の段（アバター 150 + 名前 + 変える を左、吹き出しを右に横並び・中央寄せ）、その下に 2 列の縦積み（左 = 関心 → 体験、右 = 志向性 → 心理 → 習熟、column-gap 20、列内 gap 20）。同心円なし
   - 701–950: 951–1120 と同じ並び（吹き出しは hub の下に回してよい）
   - ≤700: 変更なし（hub → 吹き出し → 関心 → 志向性 → 体験 → 心理 → 習熟 → 工夫）
2. **保存形の追認**: `rx[id].state` に `'pending'`（見立てに戻した後も vers を残し cur=-1）を認める。`kufu.ideas[id].text`（少し変えた工夫の文）と `kufu.ideas[id].note`（結果のひとこと）を認める。validate はこの形を通す
3. **reduce の純関数化**: 新 id と日付は dispatch 側で作って action に入れる（reduce は時刻・外部の連番を読まない）。同じ state と action からは同じ結果
4. **工夫の文言**: `kufu.t_away` / `kufu.t_back` / `kufu.away_head` を self-data.js に追加済み。工夫の「今はいい」「もどす」は行の差し替え + トースト（今はいいは戻す 5 秒付き）
5. Astra の MAJOR / MINOR は全件直す（既存の check.sh の問題は対象外）。edited の行にも「合ってる」を出す。履歴は pending（0 件表示）と away でも開ける
