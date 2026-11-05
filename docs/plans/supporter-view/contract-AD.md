# 契約 AD — サポーターの画面と「一緒に入る」（2026-11-06 凍結）

実装担当はここを正本にする。「」内の文言は verbatim（言い換え禁止）。`CONTRACT-v3.md` §B〜§AC と食い違う場合は本書が優先。本書に無い見た目・部品は §AA と既存ページにそろえる。

## AD-0 何を作るか・ふじさんの確定事項

元の依頼（2026-11-06）: サポーターのビューを作る。サポーター画面から生徒の画面に一緒に入り、予定表を入れたり、代わりに入力したり（バディへの話しかけ含む）できる。サポーターが何を入力したかを足場かけの記録として残し、支援の改善に使う。足場かけが減っていくこと = 自分で進めていること、を差として出し、保護者に送るレポートにも反映する。サポーターが「こんなの作ってみてもいいのでは？」と生徒の画面上で入力し、AI が答え、生徒も答える画面。

確定（AskUserQuestion 4 問）:
1. 記録は**自動だけ**（サポーターに種類を選ばせない・メモを書かせない）
2. 「自分で進めることが増えた」変化は サポーター画面・保護者レポートに加え、**子どもにも見せる**（あしあとに「自分で」した記録を前向きに出す。手伝いの量・比べる表示は子どもには出さない）
3. アイデア出しは**話すの会話に 3 人目として入る**
4. 範囲: 教室の一覧 / 個別画面の 5 観点の手がかり / 助言 → バディが試す の流れ / 保護者レポートの下書き — すべて作る

正本の設計: `reference/統合構想設計案-v1.0-2026-11-03.md` 詳細 6（521〜570 行）・詳細 8（631〜721 行）・代表例 6。守ること: 総合点で並べない / サポーターを回数で比べない / 一度の反応で決めつけない / 予定だけのことを「やったこと」にしない / 気持ちの見立てを保護者向けの確定情報にしない / 本人の編集が常に勝つ。

### 保証の範囲（有界に名指しする）
- 自動で記録が残るのは「**入っている間に `DES.store.save` を通って保存された、AD-3 の表にある種類の増分**」。自己理解（`des3.self`・独自の保存）は入っている間は操作不可にして対象外とする。学びマップ・あしあとの絞り込みなど表示だけの状態は記録しない
- 画面の外の手伝い（声かけ・見守り）は記録に入らない。画面にその旨を 1 文で出す（AD-9）
- 1 つのブラウザで役を切り替えるモック。2 台での同時表示は作らない

## AD-1 ファイルと所有

```
新規  app-v3/js/sup-data.js    サポーター画面の正準データと文言（本書 AD-13 を verbatim。実装担当は中身を書き換えない）
新規  app-v3/js/sup-core.js    純関数（DOM・DES.t・localStorage に触れない。node から読める）: normalize / snap / diff / fade / fadeLines / howCounts / reportDraft / childRow
新規  app-v3/js/sup.js         保存の包み・観察（observe）・入る/出る・帯・サポーター画面の描画と操作
新規  app-v3/css/sup.css       サポーター画面・帯・サポーターの吹き出し・アイデアカード
新規  tools/sup-test.js        SUP_TEST=PASS|FAIL
変更  app-v3/index.html        css / script の読み込み（sup-data → sup-core → sup を trail.js の後・app.js の前）、`#join-band`、`<dialog id="sup-dialog">`
変更  app-v3/js/app.js         ルート sup / 役タブ / 帯の描画呼び出し / サポーター用のサイドバー・topbar / closeTransient / inert
変更  app-v3/js/talk.js        who:'supporter' の描画・入力のしかた（3 つ）・アイデアカード・by のチップ
変更  app-v3/js/plan.js        行の by チップ・newRow が o.idea を受ける（追加だけ。既存の挙動は変えない）
変更  app-v3/js/make.js        活動に idea を持たせる入口を 1 つ（既存の題材分岐・状態機械に触らない）
変更  app-v3/js/trail.js       絞り込み「自分で」・by のチップ（AD-10）
変更  app-v3/js/i18n.js        子どもに見える新しい文言（AD-12。末尾に `// ---- §AD サポーター` としてまとめて追加）
変更  tools/trail-test.js      FILTERS の期待値に 'own' を足す・own の絞り込みの検査を足す
変更  tools/check.sh           引数に sup で始まるルートがあれば sup-test.js を走らせる（既存の 3 本と同じ書き方）
触らない  data.js / buddy.js / tokens.css / self.js / self-data.js / map*.js / today*.js / works.js / make-data.js / store.js
```

- ビルド無し・`file://` で動く・fetch 禁止・ES5〜ES2017・module 不使用（§A のまま）
- 画面の文字列を js に直書きしない。子どもに見える文言は `i18n.js`（[中, 小]）、サポーター画面の文言は `DES.supData.text`（1 通り。大人向けなので表示モードで変えない）から引く。人名は `DES.supData.supporter.name` / `DES.data.child.name` から引く（文言の中の `{sup}` `{child}` を埋める）
- 自由入力（アイデア・助言・観察メモ・レポートの直し）は `textContent` で描く。`alert/confirm/prompt` 禁止。ダイアログは `<dialog>` + `showModal()`
- 禁止語（app-v3/ 配下のソースと画面のどこにも出さない）: 点数 ランキング 順位 評価 成績 レベル 集中力 得意 苦手 上手 成長 データがありません 学びのバディ。trail.js と i18n の `tr_*` はさらに 頑張 すごい 版 未完了 やりかけ できなかった 残り まだ を使わない（コメントにも書かない）

## AD-2 保存する値 `des3.sup`

sup.js が make.js / trail.js と同じ包み方（guard `DES.store._sup`）で `DES.store.load` / `save` に足す。`DES.state.sup`:

```
{ v: 1,
  join:   null | { child: 'haruto', stance: 'proxy' | 'voice' | 'idea', since: 'H:MM' },
  log:    [ { id, day: 'M/D', time: 'H:MM', scene, how, text, ref } ],     // 追加のみ。500 件を超えたら古い方から落とす
  ideas:  [ { id, msgId, text, catalogId: string|null, state: 'open'|'made'|'planned'|'later'|'withdrawn', actId?, rowId?, day, time } ],
  advice: [ thread ],          // AD-8。ここに入るのは このブラウザで足した・直したもの。seed は DES.supData.advice（同じ id は state 側が勝つ）
  notes:  [ { id, axis: 'int'|'ori'|'exp'|'psy'|'mas', text, day, time } ],
  report: { edits: { [itemId]: string }, off: { [itemId]: true }, extra: string, state: 'draft'|'checked'|'sent', sentAt: string|null },
  logFilter: 'all'|'plan'|'talk'|'make'|'other' }
```

- `SUP.normalize(raw)`: 形が違う欄はその欄だけ初期値（join は null、配列は []、report は下書き）。知らない欄は捨てる。古い保存（`des3.sup` 無し）でも他のキーはそのまま読める
- 「はじめの状態に戻す」で消える（`des3.` の前方一致で消す既存の挙動のまま）
- `scene`: `'plan'|'talk'|'make'|'works'|'today'|'join'|'advice'|'note'|'report'`。`how`: `'proxy'`（代わりに入力）/ `'hands'`（代わりに操作）/ `'voice'`（{sup}として話す）/ `'idea'`（アイデア）/ `'in'` `'out'`（入った・出た）/ `'desk'`（サポーター画面での入力）
- `ref`: `{ msg?, row?, act?, work?, odai?, idea?, advice? }`（あるものだけ）
- 出所の印（既存データへの追加欄。どれも任意）: 会話 `m.by = 'tanaka'` / 予定の行 `r.by = 'tanaka'`・`r.idea = <ideaId>` / 活動 `a.by = 'tanaka'`・`a.idea = <ideaId>` / 活動の変化 `c.with = '田中さん'`（**既存の欄**。作品の「関わり」・あしあと・学びマップが既にこの欄を人名チップで出す）/ 活動内の発言 `m.by`

## AD-3 自動の記録（observe）— 1 か所で取る

**採った方式**: `DES.store.save` の包みの中で、保存の直前に「前回の写し（snap）と今の状態の差分」を取り、入っている間だけ 印を付けて記録を足す。**採らなかった方式**: 各操作（`P.act.*` / `TK.send` / make・works・today の各 action）に「誰が」を渡す — 状態の書き換えは `DES.app.change` を通らない経路が多く（works の saveWorks、today の見つけた、make のスライダー、トーストの「元に戻す」、150〜200 ms 遅れの 2 段目）、60 か所以上に手が入り、足し忘れが記録の欠けになる。

- `SUP.snap(state)`（純関数）: `{ talk: { [id]: who }, rows: { [id]: { kind, gone, hidden } }, acts: { [id]: { changes: [id…], says: [id…] } }, works: { [id]: 見せた数 }, found: { [odaiId]: 数 } }`。`talk` は `state.talk`（保存分）だけ（seed の `DES.data.talk` は変わらない）。`says` は活動の thread の `who:'child'` の id
- `SUP.diff(prev, cur)`（純関数）→ 出来事の配列（順序: 会話 → 行 → 活動 → 作品 → 見つけた。同じ種類は元の配列の順）:

| 出来事 | 条件 | 印（stamp） | 記録（log） scene / how / text |
| - | - | - | - |
| `msg+` | talk に新しい id・who が `child` | `m.by` | talk / proxy / 発言の文 |
| `msg+` | 同・who が `record` | `m.by` | plan / hands / 記録の文 |
| `msg+` | 同・who が `buddy` `supporter` | なし | なし（サポーターの発言は送る側が AD-6 で明示的に足す） |
| `row+` | rows に新しい id・kind が `mine` か `held` | `r.by` | なし（同じ保存で出る記録行が記録になる） |
| `rowMine` | 既存の id の kind が `proposed`/`held` → `mine` | `r.by` | なし（同上） |
| `rowHidden` | 既存の id の hidden が変わった | なし | plan / hands / `log_hide`「「{title}」を非表示にした」または `log_show`「「{title}」を表示に戻した」 |
| `act+` | acts に新しい id | `a.by` | make / hands / `log_act`「「{title}」を作り始めた」 |
| `chg+` | 既存・新規の活動の changes に新しい id | `c.who === 'own'` の時だけ `c.with = {sup}` | make / hands / 「{title}」: `M.tx(c.what)` |
| `say+` | 活動の says に新しい id | `m.by` | make / proxy / 発言の文 |
| `work+` | works に新しい id | なし | works / hands / `log_work`「「{title}」を作品に残した」 |
| `share+` | 既存の作品の見せた数が増えた | なし | works / hands / `log_share`「「{title}」を見せる設定にした」 |
| `found+` | found の数が増えた | なし | today / hands / `log_found`「お題で見つけたものを残した」 |

- 消えたもの（取り消し・削除）は出来事にしない。**記録は追加のみで、取り消しても消さない**（予定の取り消しは既存どおり「…を戻した」の記録行が新しく出て、それが記録になる）
- `SUP.observe()`（sup.js・ブラウザ側）: 写しが無ければ今の状態で作って終わる。入っていなければ 写しを更新して終わる。入っていれば diff → 印 → `state.sup.log` に追加（`day` = 今日 `M/D`、`time` = `DES.data.now`、id = `DES.plan.newId('l')`）→ 写しを更新。包んだ `save(only)` は observe → 元の save(only) → 記録が増えた時は `only` があっても `sup` を保存する。`only` が `'draft'` `'trail'` `'mapUi'` `'panel'` の時は observe を省く
- 写しを作る時機: `DES.store.load()` の直後（読み込み時の移行で増えた分を記録しない）と、入った直後
- 遅れて届く 2 段目（バディの返事 150 ms・行の退場 200 ms・トーストの「元に戻す」5 秒）も保存を通るので同じ observe で拾う。バディの発言・バディが置いた提案行は上の表のとおり印も記録も付かない
- 自己理解は対象外: 入っている間、`#self` では `#main` に `inert` を付け（他のルートでは外す）、帯に 1 文「ここは {child}が自分で書くところ。入っている間は見るだけ」を出す。`#self-sheet` は開けない

## AD-4 ルート・役の切り替え・シェル

- `ROUTES` と `PREFIX` に `sup` を足す。引数: 無し = 教室の一覧 / `haruto` = 個別（今日）/ `haruto/clues` `haruto/advice` `haruto/log` `haruto/report` = 各タブ / `haruto/in` = 入る（入った状態にして `location.replace('#talk')`。既に入っていれば そのまま `#talk` へ）。知らない子・知らないタブは `#sup` へ replace + トースト（既存の「見つからなかったよ」の key）
- **役タブ**（§B の「子ども だけ active・他 3 つは disabled」を置き換える）: `子ども` と `サポーター` を押せるようにする（`素材運用` `設計を見る` は disabled のまま）。`サポーター` が active = ルートが sup か、入っている間。`子ども` が active = それ以外。`サポーター` を押す → `#sup`（入っていれば入ったまま）。`子ども` を押す → 入っていれば出て（AD-5 の出る）`#talk` へ、入っていなければ sup ルートの時だけ `#talk` へ。役タブは描画のたびに描き直す（`aria-pressed`）
- 役は保存しない。「ルートが sup か」「`sup.join` があるか」だけで決まる
- **sup ルートのシェル**: `<html>` に class `is-sup`。
  - サイドバー: brand はそのまま / nav は 1 つ「教室」（`#sup`。icon は `map` を流用せず `today` も使わず、F の追加アイコン `people` = `M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6 M2 20a6 6 0 0 1 12 0 M17 11a2.5 2.5 0 1 0 0-5 M16 14a5 5 0 0 1 6 5`）+ 個別画面を開いている時は 2 つ目「{child}」（`#sup/haruto`。icon `self`）。`.resume-mini` は出さない。`.profile` = avatar「田」/ {sup} /「サポーター」（表示設定ボタンは出さない）。「はじめの状態に戻す」は出す。左メニューを閉じる / 開く（§AC-7）は同じ
  - topbar: breadcrumb = `サポーター / 教室`（個別は `サポーター / {child}`）。top-actions は `.save-indicator` だけ（続きをする・今日の予定・表示設定は出さない）
  - 下タブ帯（≤ 700）は出さない。ハンバーガー → 左 drawer は同じ中身
  - `closeTransient` に `#sup-dialog` と `DES.sup.resetUi()` を足す。`placeToast` の一覧に `#sup-dialog` を足す
- 子どもの画面（sup 以外のルート）は、入っていない限り今までと同じ見た目・同じ挙動（会話に `who:'supporter'` の発言や by の印がある時だけ、それが見える）

## AD-5 入る・出る・帯

- **入る**（`DES.sup.join()`）: `sup.join = { child:'haruto', stance:'proxy', since: now }` → 写しを作り直す → 記録 `{ scene:'join', how:'in', text: log_in }`「{child}の画面に入った」→ 保存 → `#talk` へ。入口: 教室の一覧の はると の行・個別画面の見出し右の主ボタン「一緒に入る」（`.btn.orange`）、ルート `#sup/haruto/in`
- **出る**（`DES.sup.leave()`）: 記録 `{ scene:'join', how:'out', text: log_out }`「{child}の画面から出た」→ `sup.join = null` → 保存 → `#sup/haruto/log` へ + トースト「出たよ。入っている間のことは 足場かけの記録 に残っている」
- **帯** `#join-band`（index.html の `.preview-bar` の直後。`position:sticky; top:0` ではなく通常の流れに置き、`.shell` の上に 1 行。地 `--sand`・文字 `--sand-ink`・下線 `1px solid var(--line)`・高さ 44px 以上・≤ 700 は 2 段）。入っている間だけ出す（`hidden` を切り替える。`<html>` に class `is-joined`）:
  - 子どもの画面にいる時: 左「{sup}が {child}の画面に入っている」+ 小さく「予定・会話・作る・作品・お題 でしたことは 足場かけの記録 に残る」（`#self` では AD-3 の 1 文に差し替え）。右: `.btn.small`「記録を見る」（`#sup/haruto/log`）/ `.btn.small`「出る」
  - sup ルートにいる時: 左「{child}の画面に入ったまま」。右: `.btn.small`「{child}の画面に戻る」（`#talk`）/ `.btn.small`「出る」
  - `role="status"` は付けない（常設の帯）。`aria-label`「一緒に入っている」
- リロードしても入ったまま（`sup.join` を保存）

## AD-6 話す — 入力のしかた・3 人目・アイデア

### 入っている間の composer
textarea の上に `.segmented.stance`（`role="group"` `aria-label`「入力のしかた」・3 つ・`aria-pressed`）:

| stance | ラベル | placeholder | 送ると |
| - | - | - | - |
| proxy（既定） | 「{child}の言葉を代わりに入力」 | 「{child}が言ったことを、そのまま書く」 | `who:'child'` の発言（observe が `by` と記録を付ける）→ 今までどおりバディが返事（`TK.reply`） |
| voice | 「{sup}として話す」 | 「{child}に伝えたいことを書く」 | `who:'supporter'`・`by` の発言。バディの返事は出さない。記録 talk / voice / 文 |
| idea | 「アイデアを出す」 | 「こんなの作ってみてもいいのでは？ を書く」 | 下の「アイデア」 |

- 選んだ stance は `sup.join.stance` に保存。入っていない時はこの帯を出さず、送信は今までどおり `who:'child'`
- composer の下書き（`des3.draft`）は 3 つで共有してよい

### 発言の見え方（入っていない子どもの画面でも同じ）
- `who:'supporter'`: `.message.supporter` = 左に avatar（丸・30px・地 `--sand`・文字 `--sand-ink`・「田」= 名前の 1 文字目・`role="img"` `aria-label` = 名前）+ 本文（上に 11px の名前「{sup}」・bubble は地 `--sand`・枠なし）+ 時刻
- `who:'child'` で `by` あり: 今までの `.message.user` の bubble の下・時刻の前に記録チップ（`.chip.src-record`・icon `record`）`by_typed`「{sup}が代わりに入力」
- `who:'record'` で `by` あり: 「記録」チップの後に `by_with`「{sup}と」（同じ緑チップ）
- 予定の行で `r.by` あり: kind チップの横に `by_row`「{sup}と入れた」（緑チップ）。`r.idea` があり `by` が無い行は `idea_row`「{sup}のアイデアから」（緑チップ）

### アイデア（サポーターが書く → バディが答える → 本人が答える）
- 出す入口は 2 つで同じ関数 `DES.sup.postIdea(text)`: (a) 入っている間の stance = idea の送信 (b) 個別画面「今日」の「アイデアを出す」欄（入っていなくても出せる）
- 中身: `id = newId('i')`、`catalogId = DES.plan.match(text)` の id（無ければ null）、`sup.ideas` に `{ state:'open' }` で追加 → 会話に `{ who:'supporter', by, idea: id, text }` → 記録 talk / idea / 文（ref.idea）→ 150 ms 後にバディの発言 `{ who:'buddy', ideaReply: id }`:
  - 取り組みに当たった: `idea_rep_match`「{sup}のアイデアだね。「{title}」、まず少しだけ試してみる？ 作るで小さく始めてもいいし、予定に入れてもいい。やらない、でもいいよ」
  - 当たらない: `idea_rep_free`「{sup}のアイデアだね。作るで小さく試してみる？ 気になるところを話すだけでもいい。やらない、でもいいよ」
- **アイデアカード**（サポーターの bubble の下。`.proposal-card.idea-card`・地 `--record-soft`・枠 `1px solid var(--record)` 相当の薄い線・見出しに緑チップ `idea_label`「{sup}のアイデア」）。状態と操作（`sup.ideas` の state を参照。行・活動の今の状態に追従）:

| state | 表示 | 操作 |
| - | - | - |
| open | — | `idea_make`「作るで試す」（`.btn.small.orange`）/ `idea_plan`「予定に入れる」（`catalogId` がある時だけ）/ `idea_later`「あとで」 |
| later | `idea_later_st`「あとで考える」 | 「作るで試す」/「予定に入れる」（同上） |
| made | `idea_made_st`「作るで試している」 | 「続きを作る」（`.btn.small.orange`・`#make/<actId>`。活動が無くなっていれば state を open に戻して扱う） |
| planned | 行が mine: `in_plan` + 時間帯 / 行が外された: 既存の `card_removed` / 終わった: 既存の `finished` | 外された時だけ「予定に入れる」をもう一度出す |
| withdrawn | `idea_withdrawn`「{sup}が取り下げた」 | なし |

  - 「作るで試す」: 文を題材に活動を作って作業台へ（`M.fromIdea` と同じ経路）。活動に `idea: id` を持たせ、`ideas[].state = 'made'`・`actId` を入れる
  - 「予定に入れる」: 取り組みを予定に入れる既存の経路（最初の空き・mine 行・会話に記録行・トースト + 元に戻す）。行に `idea: id`、`ideas[].state = 'planned'`・`rowId`。空きが無ければ既存の「明日にとっておく」で、state は変えない
  - 「あとで」: state = later + トースト `idea_later_toast`「あとで考えることにした」
  - 本人が押した時（入っていない）= 印は `idea` だけ（きっかけは {sup}・決めたのは本人）。入っている間に押した時 = observe が `by` も付ける
- 取り下げる（サポーターだけ）: 個別画面「今日」のアイデア一覧の各行と、入っている間のカードの右上に `.link-btn`「取り下げる」。state = withdrawn + トースト「取り下げた」+「元に戻す」（前の state に戻す）。made / planned の時は出さない
- 本人の返事は いつもの composer（文）か カードのボタン。`TK.reply` の規則は変えない

## AD-7 サポーター画面の骨格

外枠 `.sup-page`（`max-width:var(--page-max); margin:0 auto`）。見出しは §AA-2（h1 + 説明 1 文 13px muted・セクション見出し 15px）。開いたら h1 へフォーカス（`tabindex=-1`）。操作領域 44px 以上。390 で横スクロール無し。色: 構造は墨・砂・線。橙は主ボタンだけ。出所は既存のチップ（本人 = 青 / 記録 = 緑 / バディ = 琥珀・破線 / まだ分からない = `.src-gap`）+ サポーターの入力 = 緑チップに人名。

### 教室の一覧 `#sup`
- h1「教室」+ 説明「{date}・{group}。今していることと、確認が要ることを並べている。並びは名前の順で、比べるための並びではない」（`{date}` =「11/2（月）」）
- 子ども 5 人を名前の順（`DES.supData.children`。はると は実データから `SUP.childRow(state, data)` で作る・他の 4 人は固定）。1 人 = 1 枚の横長カード `.sup-kid`（≥ 951: 名前 | 今 | 次 | 相談 | 確認 | 操作 の 6 列 / それ以下: 縦に積む）:
  - 名前（avatar 1 文字 + 名前 + 「中学生向け」「小学生向け」）
  - `今`: 今の時刻を含む行のタイトルと時間帯（無ければ「予定の合間」）
  - `次`: その次の行（無ければ「今日の予定はここまで」）
  - `相談`: 本人からの相談（はると = 会話の最後の本人発言・本人チップ。無い子は「相談は来ていない」）
  - `確認`: 確認が要ること（緑でも橙でもない素の `.pill` を 0〜2 つ。はると = 提案中の行があれば「提案中の予定がある」、アイデアが open なら「アイデアに返事待ち」、入っていれば「いま入っている」）
  - 操作: はると =「開く」（`#sup/haruto`）+「一緒に入る」（`.btn.small.orange`）。他の子 = disabled の「開く」+ 注記（一覧の下に 1 回だけ）「このモックで開けるのは {child}だけ」
- 数で並べない・色で良し悪しを付けない

### 個別画面 `#sup/haruto[/<tab>]`
- 戻るリンク「← 教室」→ h1「{child}」+ 説明「中学生向けの表示・{date}」（表示モードに追従）+ 右に主ボタン「一緒に入る」（入っている時は「{child}の画面に戻る」）
- タブ（`<nav class="segmented sup-tabs">` のリンク 5 つ・`aria-current`）: 「今日」「手がかり」「助言」「足場かけの記録」「レポート」
- タブを切り替えても h1 へフォーカスは移さない（タブのリンクに残す）

#### 「今日」
1. **今日の予定**（読むだけ）: 生きている行を時刻順に 1 行ずつ（時間帯 / タイトル / kind チップ / by・idea のチップ）。下に小さく「直すときは、一緒に入って予定表で」
2. **本人の言葉**: 今日の本人発言を新しい順に 3 つ（時刻 + 文 + 本人チップ。`by` 付きは「{sup}が代わりに入力」チップ）+ ボタン「会話を全部見る」→ `#sup-dialog`（見出し「{child}とバディの会話（11/2）」。会話全部を読むだけの形で並べる = talk と同じ並び・カードのボタンは出さない。× と Esc で閉じる）
3. **バディの提案**: 提案から生まれた行（`from` が会話 id の行 + 断った行）を 1 行ずつ: 時間帯 + タイトル + 状態（`提案中` / `本人が選んだ` / `保留` / `見送り`）+ バディがそう言った発言の 1 行目（琥珀チップ）
4. **アイデアを出す**: 説明「ここに書くと、{child}の 話す に {sup}の発言として出る。バディが受けて、{child}が選ぶ」+ textarea（placeholder「こんなの作ってみてもいいのでは？ を書く」）+ `.btn.orange`「話すに出す」（空は disabled・出したら欄を空にしてトースト「話すに出した」）。下に出したアイデアの一覧（新しい順: 文 / 状態 = 返事待ち・あとで考える・作るで試している・予定に入っている・取り下げた / 「取り下げる」）。0 件なら 1 文「出したアイデアは、ここに並ぶ」
5. **人が確かめること**: `DES.supData.checks`（道具・場所・安全。固定 2 件）を 1 行ずつ

#### 「手がかり」
- 説明「本人の言葉・記録・バディの見立て・まだ分からないこと を分けて並べている。見立ては決めつけない」+ 注記「気持ちの見立ては、おうちの人へのレポートに入れない」
- 5 観点（`DES.selfData.axes` の順 int → ori → exp → psy → mas。見出しはサポーター向けの語 = `DES.supData.axisHead`:「関心」「志向性」「体験」「心理面の手がかり」「習熟」）。各観点 = カード 1 枚。中身は `DES.selfData.items` をその観点で絞り、既存と同じ出所チップ + 日付 + 文（js 側の文）。習熟の `cond` は既存の語（自分で / 手伝いつき / まだ確かめていない）のチップ。`basis` があれば `<details>`「手がかり」に畳む。`fold:true` の項目は `<details>`「ほか {n} 件」に畳む
- 各カードの下に**観察メモ**: 一覧（緑チップ「{sup}の観察」+ 日付 + 文 +「直す」「消す」）+ 「観察を足す」ボタン → 行内 textarea +「残す」「やめる」。空は残せない。消す = トースト「消した」+「元に戻す」。足す・直す・消すは記録 note / desk（text = 「{軸の名前}に観察を足した」等）
- 本人の返事（`des3.self` の rx）を読む口が self.js に公開されていれば「本人が直した」チップを添える。公開されていなければ出さず、報告に残す（self.js は変えない）

#### 「助言」→ AD-8 ／「足場かけの記録」→ AD-9 ／「レポート」→ AD-11

## AD-8 助言 → バディが試す

- 説明「助言は命令ではなく、バディの見立ての材料になる。そのまま試すとは限らない。1 回の反応で決めつけない」
- **助言を書く**欄（3 つ・どれも textarea 1〜2 行）: 「ねらい」（必須）/「そう考えた根拠」/「試せそうな場面」（`<select>`: 決めていない・話す・予定を決める・作る・今日のお題）+ `.btn.orange`「助言を共有する」。出すと一覧の先頭に入り、欄は空になり、トースト「助言を共有した」。記録 advice / desk
- **一覧**（新しい順。seed 2 件 + 足した分）: 1 件 = カード。見出し = ねらい + 状態チップ + 日付。中身は `<dl>` 5 段（空の段は「—」ではなく下の文）:

| 段 | 見出し | 空の時 |
| - | - | - |
| 1 | 観察と助言 | — （必ずある） |
| 2 | バディの見立て | 「バディはこれから見る」 |
| 3 | 小さな試行 | 「試す場面を待っている」 |
| 4 | 反応と結果 | 「試していない」 |
| 5 | 仮説の更新 | 「結果が出てから」 |

- 状態: `new`「これから見る」/ `waiting`「機会を待っている」/ `adjusted`「方法を調整した」/ `tried`「試した」/ `pending`「結果を待っている」/ `withdrawn`「取り下げた」
- 自分の助言（このブラウザで足したもの + seed）の操作: 「直す」（1 段目を行内で直す・残す / やめる）/「取り下げる」（状態 = withdrawn。段は残す。トースト + 元に戻す）。取り下げた助言には「戻す」
- 新しく足した助言だけ: `.btn.small`「バディの見立てを見る」+ 小さく「応答はサンプル」→ 2 段目に `advice_view`（場面を埋める）を入れ、状態 = waiting
  - `advice_view`:「受け取った。{scene}の場面で、本人の様子を見て試すか決める。そのまま試すとは限らない。別の説明が合いそうなら、方法を変える」（場面が「決めていない」なら `{scene}の場面で、` を「合いそうな場面で、」に）

## AD-9 足場かけの記録と、手伝いの移り変わり

タブ「足場かけの記録」は上から 3 つの節。

### 1. 手伝いの移り変わり
- 説明（2 文）:「場面ごとに、自分で進めたこと・{sup}のきっかけがあったこと・{sup}が代わりにしたこと を週で並べている。」「数えているのは画面に残ったことだけで、声かけや見守りは入っていない。今週は今日までの分。手伝いが多い週が、よくない週というわけではない（新しいことを始めた週は増える）。」
- 場面 3 つ × 週 5 つ。`SUP.fade({ weeks: DES.supData.weeks, state, data })` が返す形: `[ { scene, label, weeks: [ { key, label, own, cue, by, live } ] } ]`
  - 過去 4 週は `DES.supData.weeks`（固定）。今週（11/2 の週）は実データから数える（`live:true`）:
    - `plan`「予定を決める」= 今日の 自分で選んだ行（kind mine・終わった行も含む・外した行は含まない）。`by` → by / `idea` だけ → cue / どちらも無い → own
    - `talk`「バディに話す」= 今日の本人発言（seed + 保存分の `who:'child'`）。`by` → by / 直前の発言が `who:'supporter'` か、直前がアイデアへのバディの返事（`ideaReply`）→ cue / それ以外 → own
    - `make`「作る」= 今日の活動（`day` が無いか今日）の変化のうち `who:'own'`。`with` あり → by / 活動に `idea` があり `with` が無い → cue / それ以外 → own
- 見せ方: 場面ごとに 1 段。左に場面名、右に週 5 つを横に並べる。1 週 = 上に週のラベル（「10/5 の週」…「今週」）、下に**四角の列**（1 つの出来事 = 1 つの四角・12px・すき間 3px・最大 10 個、超えたら「ほか {n}」）: 自分で = 塗り `--own` / きっかけあり = 白地に `--own` の 2px 枠 / 代わりに = 塗り `--sand` に `--sand-ink` の 1px 枠。その下に小さく「{n} 回のうち 自分で {own}」。0 回の週は四角を出さず「記録なし」。四角の列は `role="img"` + `aria-label`（例「10/5 の週: 6 回のうち 自分で 1、きっかけあり 1、代わりに 4」）。凡例を節の先頭に 1 回（四角 + 語: 自分で / {sup}のきっかけ / {sup}が代わりに）。色だけに頼らない（形 = 塗り・枠・砂）
- ≤ 700: 週は横スクロールさせず、場面ごとに週を縦に並べる（1 週 1 行: ラベル | 四角 | 「n 回のうち 自分で m」）
- 各場面の下に読み取りの 1 文 `SUP.fadeLines(fade)`（決定論）: 最初の週（回数 > 0 の最初）と今週を比べる:
  - 今週が 0 回: `fade_none`「{label}: 今週の記録はこれから」
  - 自分での割合が上がった: `fade_up`「{label}: {w0}は {n0} 回のうち自分で {o0} 回。今週は {n1} 回のうち {o1} 回。自分で進める割合が上がっている」
  - 同じか下がった: `fade_flat`「{label}: {w0}は {n0} 回のうち自分で {o0} 回。今週は {n1} 回のうち {o1} 回。{sup}と一緒に進めている」
- 総合の数・合計・順位は出さない

### 2. どんな手伝いをしたか（今週）
- `SUP.howCounts(log, today の週の日)` → `proxy / hands / voice / idea` の件数。1 行ずつ「代わりに入力 {n}」「代わりに操作 {n}」「{sup}として話す {n}」「アイデア {n}」（0 も出す）+ 注記「振り返りの材料で、多い少ないを比べるためのものではない」

### 3. 記録
- 絞り込み（`.segmented`・`aria-pressed`・`sup.logFilter` に保存）: 「ぜんぶ」「予定」「話す」「作る」「そのほか」（そのほか = works / today / join / advice / note / report）
- seed（`DES.supData.log`・過去の日）+ `sup.log` を 日の新しい順 → 時刻の新しい順（同じ時刻は後から足したものが先）。日の見出し（今日 =「今日」）。1 件 = 時刻 | 手伝いの種類チップ（緑チップ: 代わりに入力 / 代わりに操作 / {sup}として話す / アイデア / 入った / 出た / サポーター画面で）| 場面（小さい muted の語: 予定・話す・作る・作品・今日のお題・一緒に入る・助言・観察・レポート）| 文。`ref.msg` があれば `.link-btn`「会話で見る」→ `#sup-dialog` の会話でその発言へスクロール + フォーカス
- 絞って 0 件: 「{filter}の記録は、ここに出る」。全部 0 件にはならない（seed がある）
- 記録は消せない（消すボタンを置かない）

## AD-10 子どもの画面への反映（あしあと）

- `FILTERS` に `'own'` を足す（並び: all / make / talk / found / plan / own）。ラベル `tr_f_own`:「自分で」/「じぶんで」
- 絞り込み own の中身 = 手伝いの印が無いもの: 話した（`by` 無し）/ 予定の記録（`by` 無し）/ 終わった予定（行に `by` 無し）/ 作った（最後の変化が `who:'own'` で `with` 無し）/ 作品に残した / 見つけた。0 件の文は既存の `tr_filter_empty` を使う
- 印の出し方: 話した で `by` あり → 本人チップの後に緑チップ `by_typed` / 予定の記録で `by` あり → 記録チップの後に `by_with` / 終わった予定の行に `by` → `by_with`。`entries()` の話した・記録・終わった予定に `by` 欄（無ければ null）を足す。`talkTopics` は `m.by` を渡すだけ（組にする規則は変えない）
- 子どもの画面には、手伝いの数・週の比べ・「減った / 増えた」の文を出さない（§Z-4 のまま）
- trail.js のソース（コメント含む）に §Z-11 の禁止語を入れない

## AD-11 保護者レポートの下書き

タブ「レポート」。
- 説明「おうちの人に届ける 1 週間のまとめの下書き。直す・載せない・補足する ができる。送る前に{sup}が確かめる」+ 決まり 3 行（箇条書き）:「予定だけのことは『これから』に分ける」「気持ちの見立ては入れない」「ほかの子のことは入れない」
- 見出し行: 期間「{from}〜{to}」（`DES.supData.report.span` = 10/26〜11/2）+ 状態チップ（`draft`「下書き」/ `checked`「確かめた」/ `sent`「送った」）
- `SUP.reportDraft({ data: DES.supData.report, fade, state })` → 節 6 つ（この順）。各節 = 見出し + 項目の一覧:
  1. 「話していたこと」 2. 「実際に取り組んだこと」 3. 「学びの手がかり」 4. 「関心や変化」 5. 「自分で進めたこと」 6. 「次につながること（これから）」
  - 1〜4・6 の項目は `DES.supData.report.items`（固定・AD-13）。6 には今の予定の提案中の行も「これから」として足す（「{start}〜 {title}（提案中）」）
  - 5 は fade から作る（場面ごとに 1 項目。今週 0 回の場面は出さない）: 上がった →「{label}では、自分で進める割合が上がってきました（{w0}: {n0} 回のうち {o0} 回 → 今週: {n1} 回のうち {o1} 回）」/ それ以外 →「{label}は、{sup}と一緒に進めています（今週: {n1} 回のうち自分で {o1} 回）」+ 節の末尾に固定の 1 文「画面に残ったことだけを数えています。声かけや見守りは入っていません」
- 項目 1 つ = 文 + 根拠チップ（`src`: 会話 = 本人チップ / 記録・作品 = 緑チップ / レポート用の計算 = 緑チップ「記録から」）+ 操作「直す」（行内 textarea・残す / やめる・空では残せない。直した文は `report.edits[id]`、チップ「{sup}が直した」が付き、「元の文に戻す」が出る）/「載せない」⇄「載せる」（`report.off[id]`。載せない項目は薄く・打ち消し線なしで「載せない」チップ）
- 「補足」: 節の下に textarea 1 つ（`report.extra`。入力ごとに保存・記録は付けない）
- 下の操作列: `.btn`「おうちの人に届く形を見る」→ `#sup-dialog`（見出し「{child}の 1 週間（{from}〜{to}）」+ 載せる項目だけを節ごとに素の文で + 補足 + 末尾「{sup}より」。チップ・操作は出さない）/ 状態で変わる主ボタン: draft →「確かめた」（state = checked）/ checked →「送る」+ 小さく「このモックでは送られない」（state = sent・`sentAt` = 「11/2 10:20」・トースト「送ったことにした（体験例）」）/ sent → 文「{sentAt} に送った（体験例）」+ `.btn.small`「下書きに戻す」。直す・載せない を触ると checked は draft に戻る。確かめた・送る・下書きに戻す は記録 report / desk
- 載せる項目が 0 の時は「確かめた」を disabled にし 1 文「載せる項目を 1 つ以上選ぶ」

## AD-12 子どもに見える新しい文言（i18n.js・[中, 小]。`{sup}` は名前を埋める）

```
sup:            ['サポーター', 'サポーター']            // breadcrumb 用
by_typed:       ['{sup}が代わりに入力', '{sup}が かわりに入力']
by_with:        ['{sup}と', '{sup}と']
by_row:         ['{sup}と入れた', '{sup}と入れた']
idea_row:       ['{sup}のアイデアから', '{sup}のアイデアから']
idea_label:     ['{sup}のアイデア', '{sup}のアイデア']
idea_make:      ['作るで試す', 'つくるでためす']
idea_plan:      ['予定に入れる', '予定に入れる']
idea_later:     ['あとで', 'あとにする']
idea_later_st:  ['あとで考える', 'あとでかんがえる']
idea_made_st:   ['作るで試している', 'つくるでためしている']
idea_withdrawn: ['{sup}が取り下げた', '{sup}がとりさげた']
idea_later_toast: ['あとで考えることにした', 'あとでかんがえることにした']
idea_rep_match: ['{sup}のアイデアだね。「{title}」、まず少しだけ試してみる？ 作るで小さく始めてもいいし、予定に入れてもいい。やらない、でもいいよ', '{sup}のアイデアだね。「{title}」、まず少しだけためしてみる？ つくるで小さくはじめてもいいし、予定に入れてもいい。やらない、でもいいよ']
idea_rep_free:  ['{sup}のアイデアだね。作るで小さく試してみる？ 気になるところを話すだけでもいい。やらない、でもいいよ', '{sup}のアイデアだね。つくるで小さくためしてみる？ 気になるところを話すだけでもいい。やらない、でもいいよ']
tr_f_own:       ['自分で', 'じぶんで']                 // これだけ §Z あしあとの塊の末尾に置く
```

バディの返事 2 つ（`idea_rep_*`）は表示モードで変わる文なので i18n に置く（会話に保存するのは出した時点の文）。帯・入力のしかた・サポーター画面の文言はすべて `DES.supData.text`（AD-13）。

## AD-13 正準データ `app-v3/js/sup-data.js`

司令塔が書いて同じコミットに入れる（実装担当は読むだけ）。中身: `supporter` / `children` / `axisHead` / `checks` / `weeks` / `log`（seed）/ `advice`（seed 2 件）/ `report` / `text`。架空。人物名は はると・田中さん + 一覧だけに出る 4 人（あおい・そうた・みお・れん）。日付は 10/5〜11/2（月水金 A の登校日）で、data.js・self-data.js・make-data.js と矛盾させない。

## AD-14 純関数（sup-core.js・`module.exports` あり）

`normalize(raw)` / `snap(state)` / `diff(prev, cur)` / `fade({ weeks, state, data, today })` / `fadeLines(fade, text, names)` / `howCounts(log, days)` / `reportDraft({ data, fade, state, text, names })` / `childRow(state, data)`。どれも引数を書き換えない。`fade` の今週の数え方・`diff` の表は AD-9・AD-3 のとおり。

## AD-15 受け入れ（操作ループ）

- [ ] 役タブ サポーター → 教室の一覧 → はると を開く → 5 つのタブが開く・戻れる・リロードで同じ場所
- [ ] 一緒に入る → 帯が出る → 話すで 3 つの入力のしかた: 代わりに入力（本人の吹き出し + 「田中さんが代わりに入力」+ バディの返事）/ 田中さんとして話す（3 人目の吹き出し）/ アイデアを出す（3 人目 + カード + バディの返事）
- [ ] 入ったまま予定表で 取り組みを足す・時刻を直す・外す → 行に「田中さんと入れた」・記録行に「田中さんと」→ 足場かけの記録に 1 件ずつ増える（取り消しても消えない）
- [ ] 入ったまま 作る で 1 つ変える → 変化に人名チップ・記録が増える。自己理解は見るだけ
- [ ] 出る → 記録タブへ・トースト。子どもの役に切り替え → 帯なし・3 人目の発言と印は残る・アイデアカードのボタンを本人として押せる（作るで試す / 予定に入れる / あとで）
- [ ] 本人として予定を足す・話す → 手伝いの移り変わりの「今週」の 自分で が増える。サポーターとして足すと 代わりに が増える。アイデアから本人が入れると きっかけあり が増える
- [ ] あしあと: 絞り込み「自分で」に 手伝いの印が無いものだけ出る
- [ ] 助言: 書く → 一覧の先頭 → バディの見立てを見る → 直す → 取り下げる → 元に戻す
- [ ] 手がかり: 観察を足す → 直す → 消す → 元に戻す
- [ ] レポート: 直す → 元の文に戻す → 載せない → 届く形を見る（載せない項目が無い）→ 確かめた → 送る → 下書きに戻す
- [ ] 「はじめの状態に戻す」で全部消える。`des3.sup` が無い古い保存でも今までどおり動く
- [ ] キーボードだけで全部。Esc でダイアログが閉じ、開いたボタンへ戻る。1440 / 1024 / 390 で横スクロール無し

## AD-16 検証（実装担当が実行し verdict だけ報告。全出力は一時ファイルへ）

```
node tools/sup-test.js                 # SUP_TEST=PASS
node tools/make-test.js && node tools/today-test.js && node tools/map-test.js && node tools/trail-test.js   # 既存 4 本 PASS
sh tools/check.sh talk plan make make/act-py works today map trail self paused sup sup/haruto sup/haruto/clues sup/haruto/advice sup/haruto/log sup/haruto/report sup/haruto/in   # CHECK_RESULT=PASS
grep -rnE '点数|ランキング|順位|評価|成績|レベル|集中力|得意|苦手|上手|成長|データがありません|学びのバディ' app-v3/   # 0 件（今ある hit があれば件数を変えないこと）
```

sup-test.js が見ること: normalize（壊れた形 → 初期値・知らない欄を捨てる）/ snap・diff の表の全行（増えた時だけ出る・消えた時は出ない・引数を書き換えない）/ fade の今週の数え方（own・cue・by の境目を 1 つずつ）と過去 4 週が seed と同じ / fadeLines の 3 分岐 / howCounts / reportDraft（6 節・提案中の行が「これから」に入る・今週 0 回の場面を出さない）/ childRow / i18n に AD-12 の key が [中, 小] で在る / sup*.js と sup-data.js に禁止語が無い / sup.js に日本語の文字列の直書きが無い（コメントを除く）。

## AD-17 今回作らないもの（報告に残す）
2 台での同時表示 / サポーターの権限・担当の切り替え / 他の 4 人の個別画面 / レポートの実送信・配信の予定 / 保護者の画面 / 本番 AI による見立て・要約 / 支援のケース集（詳細 6「支援の知恵を蓄える」）/ 自己理解への代筆。

## AD-18 裁定（2026-11-06 Astra high の契約レビュー REVISE への回答。AD-1〜AD-17 と食い違う場合は本節が優先）

### 18-1 印を付ける時機（AD-3 の表の「印」列を置き換える）
保存の直前に印を付けると、先に作られた派生値（作品の `roles` など）に間に合わない。**派生値に効く印は、作る時に付ける**。それ以外は observe で付ける。

| 印 | 付ける所 | 条件 |
| - | - | - |
| 会話 `m.by` | `TK.push`（talk.js の唯一の追加口）| 入っている間・`who` が `child` か `record`（`supporter` は送る側が付ける。`buddy` は付けない） |
| 変化 `c.with` | make.js の `commitChange`（唯一の追加口）| make.js にモジュール変数を 1 つ置き（`M.setWith(name|null)`。純関数の引数は変えない）、値がある間・`who === 'own'` の変化に `with` を入れる。sup.js が 入る / 出る / 読み込み時 に設定する |
| 変化 `c.day` | observe（**入っていなくても**）| 新しく増えた変化に 今日の `M/D` を入れる（AD-9 の「作る」の今週を数えるため。派生値には使われない） |
| 行 `r.by` | observe | AD-3 の `row+` `rowMine`。意味は「**最初に入れたのが {sup}**」。後から本人が時刻を直しても消さない・{sup}が既存の行の時刻を直しても付けない（記録行には `by` が付く） |
| 活動 `a.by`・作品 `w.by` | observe | `act+` / `work+`。作品の `by` が既存の正規化（`migrateWork` / `normalizeWorks`）で落ちる場合は、そこに `by` を通す 1 行を足してよい |
| 活動内の発言 | 付けない | 記録だけ残す（`say+` → make / proxy / `log_say`）。作業台には印を出さない |

### 18-2 observe の順序と保存の失敗（AD-3 を置き換える）
- 包んだ `save(only)` の順: **元の `save(only)` → 成功した時だけ observe → 印を付けたキーと `sup` を保存し直す**。失敗した時は observe しない・写しも更新しない（既存の巻き戻しの後の状態が次の保存で比べられる）
- `only` がある時は、そのキーに属する部分だけを比べて、その部分の写しだけを更新する: `talk` → 会話 / `plan` → 行 / `activities` → 活動・変化・発言 / `works` → 作品・見せた数 / `odai` → 見つけた。他のキーは何もしない。`only` 無し = 全部
- この処理は sup-core.js の純関数 `SUP.observe(state, snap, key, ctx)` に置く（`ctx = { joined, supId, supName, today, now, text, tx, newId }`。戻り値 `{ snap, log: [足す記録], touched: [印を付けたキー] }`。`state` の中の印は直接書いてよい — ここだけ引数を書き換える）。sup.js の包みはそれを呼んで保存するだけにする（node で検査できるように）
- 保存できない環境（`saveFailed`）では記録は増えない。画面の保存表示は既存の `save_fail` のまま
- 「元に戻す」で戻ってきたもの（作品・見せる・見つけた）は、新しい 1 件として記録に残る（消えたものは記録しないので、往復で 1 件増える）。そのままでよい
- 記録の件数と、手伝いの移り変わりの回数は別の単位（1 回の操作で記録が 2 件以上になることがある）。画面でも足し合わせない

### 18-3 アイデアから作る（AD-6 を補う）
- 「作るで試す」は `M.fromIdea` を使わず、make.js に足す入口 `M.fromSupIdea({ id, text })`: `fromText(text, …)` で活動を作り、**`quote` は null にする**（本人の言葉の枠に入れない）・`a.idea = id`・`origin` は `'talk'`。作業台では、引用枠の場所に読むだけの枠（緑チップ `mk_idea_frame`「{sup}のアイデア」+ 文。直す・外す のボタンは無し）を出す。文は `DES.sup.ideaText(id)` から引く（無ければ枠を出さない）
- make.js の変更はこの入口・枠・`setWith`・`commitChange` の 1 行・（必要なら）作品の `by` を通す 1 行に限る
- アイデア → 予定 → 作る、あしあとの「もう一度試す」では `idea` を引き継がない（その先は本人の活動として数える）

### 18-4 アイデアから予定に入れる（AD-6 を補う）
- `P.act.addFirst(actId, o)` に `o.idea`（行に `idea` を入れる。`addMine` → `newRow` へ渡す）と `o.onAdded(row)`（行が入った時だけ、同じ change の中で呼ぶ）を足す。空きが無い時は今までどおりで `onAdded` は呼ばれない
- アイデアの表示は行の今の状態から決める: `state:'planned'` で `rowId` の行が配列に無い（「元に戻す」で消えた）→ open と同じ表示・操作。`state:'made'` で活動が無い → 同じ

### 18-5 話した の組み方・送信の直列化（AD-6 / AD-10 を補う）
- アイデアを出してからバディの返事が入るまでの 150 ms は、既存の送信中フラグ（`DES.ui.sending`）を立てて送るボタンを止める
- `talkTopics` は 直後の発言が `who:'buddy'` でも `ideaReply` があれば返事にしない（本人の発言の返事として組まない）

### 18-6 今週の数え方（AD-9 を置き換える所だけ）
- `make`「作る」= 全活動の変化のうち **`c.day` が今日** で `who:'own'` のもの。`with` あり → by / `with` 無しで活動に `idea` → cue / それ以外 → own。seed の変化には `day` が無いので、何も操作していない時は 0 回
- `plan` の by は「最初に入れたのが {sup}」の行（18-1）。`talk` の cue の「直前」は、会話全体（seed + 保存分）の並びで 1 つ前
- 読み取りの文とレポートの文は「割合」で比べる（文言は直してある）

### 18-7 あしあとの「自分で」（AD-10 を置き換える）
- 絞り込み own に出すもの: 話した（`by` 無し）/ 予定の記録（`by` 無し）/ 終わった予定（行に `by` 無し **かつ** まとめた終わりの記録行に `by` 無し）/ 作った（最後の変化が `who:'own'`・`with` 無し）/ 作品に残した（`w.by` 無し）/ 見つけた（そのお題に {sup}の記録が無い = `entries` に渡す `helped.odai[odaiId]` が無い。`helped` は sup.js が `sup.log` の `scene:'today'` から作って trail に渡す。渡されなければ空）
- 終わった予定の `by_with` チップ: 行か、まとめた記録行のどちらかに `by` があれば出す

### 18-8 手がかりと本人の返事（AD-7 を置き換える）
- sup.js は `localStorage` の `des3.self` を読み、公開されている `DES.self.validate(raw)` に通して返事を得る（読むだけ・書かない。読めなければ返事なしとして扱う）
- バディの見立て（`src:'ai'`）で 本人が直した（`rx.state === 'edited'`）→ **本人が直した文を出し**（本人チップ + `cl_fixed`）、その下に小さく `cl_was_ai` + 元の見立ての文。`agreed` → 見立ての文 + `cl_agreed`。`away` → 見立ての文を薄く + `cl_away`

### 18-9 役の切り替え・タブ（AD-4 / AD-5 / AD-7 を補う）
- 話すの作り直しの鍵（`u.built`）に「入っているか」を足す（同じ `#talk` で役が変わっても composer が作り直される）。入力のしかたの切り替えは `aria-pressed` と placeholder を差し替えるだけで、書きかけの文は消さない
- `DES.sup.leave(dest)`: `dest` を省いたら `#sup/haruto/log`。役タブ「子ども」からは `leave('#talk')`（トーストは同じ）
- sup の中でタブを移った後は、そのタブのリンクへフォーカスを戻す

### 18-10 レポート（AD-11 を補う）
- 動的な項目の id: 自分で進めたこと = `own:<scene>` / これからの提案中の行 = `next:<rowId>`。`edits` / `off` はこの id で持つ（行が無くなった項目の edits は使われないだけで消さない）
- `checked` → `draft` に戻るきっかけ: 直す・元の文に戻す・載せない / 載せる・補足の入力
- `sent` の間は 直す・載せない・補足 を disabled にし、`rp_locked` の 1 文を出す（下書きに戻すと直せる）

### 18-11 禁止語と検証（AD-1 / AD-16 を置き換える）
- 既存ファイルには禁止語を含む行が 6 行ある（`i18n.js` `map.js` `self-data.js` `works.js`。今回は触らない）。今回の決まりは「**新規ファイルに 0 件・既存ファイルに足した行に 0 件**」:
  `grep -nE '<禁止語>' app-v3/js/sup*.js app-v3/css/sup.css tools/sup-test.js` が 0 件、`git diff -U0 -- app-v3 tools | grep '^+' | grep -vE '^\+\+\+' | grep -cE '<禁止語>'` が 0
- check.sh: (a) node のテストは `PASS` の文字に加えて終了コード 0 を見る（sup-test の分。既存 3 本も同じ形に直してよい）(b) `sup` で始まるルートでは、取った DOM に そのルートの目印があること: `sup` → `data-sup-page="class"` / `sup/haruto` と各タブ → `data-sup-page="kid:<tab>"`（今日は `kid:today`）/ `sup/haruto/in` → `id="join-band"` に `hidden` が無い + `class="message-list"`。目印が無ければ FAIL（別のページへ落ちても通る、を防ぐ）
- sup-test.js に足す: `SUP.observe` を `only` あり / 無し・入っている / いない で呼ぶ（成功時だけ呼ばれる前提の純関数として、印・記録・touched・写しの更新を見る）/ 記録 500 件の上限 / `talkTopics` が `ideaReply` を返事にしない / own の絞り込み（by 付きの 話した・記録・終わった予定（行だけ by・記録だけ by の両方）・作品・`helped` 付きの見つけた が出ない）/ `m.by` が話したの entry に渡る
- 操作後の画面（同じ hash での役の切り替え・入っている間の各画面・自己理解の inert・アイデアの元に戻す・Esc 後のフォーカス・知らない sup のパス・小学生向けの表示）は司令塔が実ブラウザで確かめる（実装担当は node と check.sh まで）

### 18-12 純関数の受け渡しの形（AD-14 を補う）
- `diff` の出来事: `{ t: 'msg+'|'row+'|'rowMine'|'rowHidden'|'act+'|'chg+'|'say+'|'work+'|'share+'|'found+', id, act?, odai?, hidden? }`
- `fade({ weeks, thisWeek, scenes, state, messages, today })` → `[ { scene, label, weeks: [ { key, label, own, cue, by, live } ] } ]`（`messages` = seed + 保存分の会話。`state` から `plan` `activities` を読む）
- `fadeLines(fade, text, names)` → `[ { scene, kind: 'none'|'up'|'flat', line } ]`
- `childRow({ plan, messages, ideas, joined, now, child, mode, text })` → `{ id, name, mode, now, next, consult, checks: [] }`
- `reportDraft({ report, fade, lines, plan, text, names, edits, off })` → `[ { id, head, items: [ { id, text, orig, src: 'own'|'record'|'calc', edited, off } ], note? } ]`

### 18-13 2 回目の契約レビュー（REVISE・残り 4 点）への裁定
- **保存が途中で失敗した時（範囲を限る）**: 記録は「成功した保存 1 回ごと」に確定する。印と記録の保存し直しが失敗した時は `saveFailed` を立てるだけで、状態も記録も巻き戻さない。1 つの操作が複数のキーを順に保存し、後のキーが失敗して既存の処理が巻き戻した場合（写真から作品を残す、など）、先に確定した記録は残る。**このモックでは、保存の途中の失敗で記録と状態が食い違うことを受け入れる**（既存の保存も一部のキーだけ成功することがあり、今回それは直さない）。画面は既存の `save_fail` の表示になる。本番の記録の保存は別に設計する（AD-17 に足す）
- **見つけた の手伝いの印は記録の上限と分ける**: `des3.sup` に `helped: { odai: { [odaiId]: true } }` を足す（上限なし・追加のみ）。observe が `found+` の時に入っていれば立てる。あしあとの「自分で」（18-7）はこの `helped` を読む（`sup.log` からは作らない）。`normalize` は形が違えば `{ odai: {} }`
- **レポートを確かめた・送った後の中身**: 「確かめた」を押した時点の中身（節・項目の id と文・載せる / 載せない・補足）を `report.body` に写して保存する。状態が `checked` / `sent` の間、画面と「届く形」は **`report.body` を出す**（元の予定や記録が後で変わっても変わらない）。今の記録から作った中身と `report.body` が違う時は 1 文「確かめたあとに、元の記録が変わっている。下書きに戻すと今の中身になる」（`rp_stale`）を出す。「下書きに戻す」で `report.body = null` になり、今の記録から作り直す。`checked` の間に 直す・載せない・補足 を触ると `draft` に戻る（`body = null`）。`normalize`: `body` は null か配列
