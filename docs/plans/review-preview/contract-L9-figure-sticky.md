# §L-9 図・動かせるものへの付箋（2026-11-07 凍結）

ふじさん依頼（2026-11-07）: 「修正指示をクリックして出せるようにして。この画像とか。３D表現しろって言ったのになぜかSVGで２Dだし」。
確認画面の教材プレビューで、図（画像）や動かせるものを押して直し方を選び、差し戻しの理由に入れられるようにする。§L-8 の 4（段落の付箋）を図と動かせるものへ広げる。API・DB・migration・職人の定義は変えない。

## L9-1 対象と見た目

1. 対象は `.mp-fig`（part.files の画像。SVG / PNG / JPG / WebP）と `.mp-app`（app.html）。動画（`.mp-video`）は対象外（動画の確認は §Q）。
2. **印 ON（`o.marks && o.stick`）の時だけ**、図の `<figure>` の末尾に `<figcaption class="mp-fig-tools">` を置き、その中にボタン `<button type="button" class="mp-stick-btn" data-stick-media="figure" data-stick-key="<path>">この図に付箋</button>`。動かせるものは「さわってみよう」の行（`.mp-app-cap`）の右に同じ形のボタン（`data-stick-media="app"`）「これに付箋」。印 OFF は何も出さない（子どもが見るのと同じ見た目）。
3. 図・動かせるものに付箋がある時、印 ON なら `has-stick` クラスと「付箋 N」の札（`.mp-stuck`、段落と同じ）を同じ figcaption / 見出しの行に出す。印 OFF は札も出さない（付箋そのものは消さない）。
4. 既存の段落の付箋・見てほしい所の印（pin）・出典カードの動きは変えない。

## L9-2 種類と理由の行

- 図: `STICK_FIG_KINDS = [['3d','立体の絵にする'], ['redraw','描き直す'], ['mismatch','本文と合わない'], ['text','文字が読めない・崩れている'], ['fact','事実が心配'], ['other','その他']]`
- 動かせるもの: `STICK_APP_KINDS = [['depth','動きに奥行きがない'], ['pointless','操作の意味がない'], ['controls','操作が分かりにくい'], ['mismatch','本文と合わない'], ['broken','動かない・おかしい'], ['other','その他']]`
- 動画（追記 2026-11-07。ふじさん「図とかだけじゃなくて、動画とかも」）: `STICK_VIDEO_KINDS = [['span','区間が合わない'], ['content','内容が合わない・別の動画に'], ['remove','要らない'], ['fact','事実が心配'], ['other','その他']]`。対象は `.mp-video`（L9-1 の 1 の「動画は対象外」を取り消す）。ボタン「この動画に付箋」は `.mp-video` の先頭（印 ON の時だけ）、`data-stick-media="video"`・`data-stick-key="<videos[].id（v1 など。同じ YouTube 動画の別区間を区別するため youtube_id ではない）>"`。`id` の無い動画にはボタンを出さない。記録は `media: 'video', media_key: <videos[].id>, media_title: <title>`。理由の行は `- 動画 <part_id> <videos[].id>（<title>）: <種類> — <一言>`（題名・一言の改行や連続する空白は 1 つの空白に畳む。行の中に改行を入れない — 却下時の除外が行単位のため）。
- 付箋の記録（`reviewStates[vid].stickies` の 1 件。段落の付箋は今までどおり `target` 無し）:
  `{ id, target: 'media', media: 'figure'|'app', media_key: <path>, part_id, part_title, part_index, kind, text, flowed }`
- 理由の 1 行（`stickyLine`。職人が読んで、どのファイルをどう直すかが一意に分かる）:
  - 図: `- 図 <part_id> <path>: <種類の日本語><補足> — <一言>`（一言が無ければ ` — ` 以降は無し）
  - 動かせるもの: `- 動かせるもの <part_id> <path>: <種類の日本語><補足> — <一言>`
  - 補足は種類が `3d` と `depth` の時だけ付く固定の文:
    - `3d`: `（generate_image で、光と影・質感のある実物らしい立体の画像に描き直す。平たい SVG のままにしない。名前の引き出し線や説明は画像に入れず本文か別の SVG で）`
    - `depth`: `（app.html の canvas に奥行きのある動く絵にする。遠くは小さく暗く、近くは大きく明るく）`
    - `pointless`: `（操作は「さわると何が分かるか」を 1 文で言えるものだけにする。速さや数を変えるだけの操作は外し、本文の学びに結びつく操作に置き換える）`
- 行の流し込み（`appendLines` / `flowStickies`）・却下時の除外（`noteWithoutStickyLines`）・4000 字の上限・トーストの件数は段落の付箋と同じ仕組みをそのまま使う（別の配列を作らない）。

## L9-3 操作（ui-interaction-completeness）

1. ボタン → その図の `<figure>` の末尾（動かせるものは見出しの行の下・iframe の上）に、段落と同じ形の入力の枠（`stickyFormHtml`）を出す。問いの文は「この図に付箋を付けます。どれに近いですか？」/「この動かせるものに付箋を付けます。どれに近いですか？」。種類のチップは L9-2 の一覧。一言の欄の例は図「例: 赤血球を立体の絵にして、血管の中を流れている様子に」、動かせるもの「例: 奥から手前に流れてくる見え方に」。
2. 種類を選ぶと「付箋を付ける」が押せる。Enter で付ける・Esc でやめる（IME 変換中は付けない）。入力の枠の中は「入力中」扱いで確認画面のキー操作は効かない（既存の判定が `[data-stick-form]` を見るので同じ）。
3. 付けた後: 図に「付箋 N」の札、右の一覧（`stickyListHtml`）に 1 行（場所の表示は `<part_title>・図 <path>` / `<part_title>・動かせるもの <path>`。種類・一言・「理由欄に入れました」・「消す」は段落と同じ）。トーストの文も同じ。「直してもらう」の状態なら即座に理由欄へ流し込む。
4. 一覧の「消す」で消える（図の札も消える。理由欄に入れた行は残る、の挙動も同じ）。
5. 同じ図に複数の付箋を付けられる（札の数が増える）。

## L9-4 受け入れ

1. `test/review-preview.test.ts` に足す（純関数。`window.FactoryAdminReview` に `stickyLine` / `stickyListHtml` / `STICK_FIG_KINDS` / `STICK_APP_KINDS` が無ければ公開する。既存の公開名は変えない）:
   a. `stickyLine`: 図 `3d` は `- 図 p1 parts/p1/figure-1.svg: 立体の絵にする（generate_image で…` で始まり一言が後ろに付く。`redraw` には補足が無い。動かせるもの `depth` に補足が付く。段落の付箋の行は今までどおり。
   b. `previewBodyHtml`（印 ON・stick あり）: 図に `data-stick-media="figure"` と `data-stick-key="<path>"` のボタンが出る。動かせるものに `data-stick-media="app"`。印 OFF では両方とも出ない。
   c. 図の付箋が 1 件ある時、その図だけに「付箋 1」の札と `has-stick`。別の図には付かない。印 OFF では札も出ない。
   d. `stickyListHtml`: 図の付箋の行に `図 parts/p1/figure-1.svg` が出る。
   e. `stickyNoteText` → `noteWithoutStickyLines` で、図の行も外せる。
   f. 既存の test は全部そのまま通る。tsc 0。
2. 見た目: `test/review-preview/` の作り物のデータに、画像の図（PNG か SVG）1 枚以上と app.html がある版を使う（無ければ `fixtures.mjs` と `files/` に足す）。`driver.js` に shot `fig-sticky`（印 ON → 図のボタンを押して種類 `3d` を選び一言を入れて付ける → 右の一覧に 1 件）と `fig-sticky-return`（その後「直してもらう」を押して理由欄に行が入った状態）を足し、headless Chrome で 1440 幅を撮って `screens/2026-11-07-figure-sticky/` に置く（`fig-sticky_1440.png`・`fig-sticky-return_1440.png`）。撮り方は既存の shot と同じ。
3. CSS は `admin.css` に足す（`.mp-fig-tools` は図の下に小さく右寄せ。ボタンは `.mp-stick-btn` をそのまま使う。`.mp-fig.has-stick` は段落と同じ黄色の目印を枠に）。app-v3 の CSS は読み込まない。

## 範囲の外

職人の定義の変更（図の決まりと作り直しの節で足りる。理由の行がそのまま指示になる）、動画への付箋、API・DB。
