# T5 — 確認画面の schema 2 対応（本文 1 本の preview・バディ用の枠・quality の表示名）（実装担当: opus-impl-medium）

effort は medium: 契約凍結済みの UI 実装（素の HTML/JS・ES2017・ビルド無し。既存の preview 関数に分岐を足す）。

## 確定済み背景（再調査・再設計しない）
- 正本: `docs/plans/material-v2/contract-AL.md` AL-8 末尾（確認画面）・AL-10（V-9 への優先宣言）。計画 `plan-v1.md` §13 T5
- 作業場: `/Users/hayatofujii/Coding/DESystem/Learning-Agents/.worktrees/material-v2`（Worker は `factory/worker/`。画面は `public/admin/admin.js` / `admin.css`。`fetch` は自サイトの `/api/*` のみ・ES2017・ビルド無し）
- T1 は着地済み（`material_json` の schema 2 の形は契約 AL-1。画面は `d.version.material` として生の JSON を受け取る）。`GET /api/review/:id` の応答の形は変えない（画面側で `schema_version` を見て分岐）
- 現行の preview（関数名で探す。行番号は動いている）: `variantsOf` / `variantSel` / `locateItem`（「中学生・長い にあります」）、`AUD_LABEL` / `LEN_LABEL` / `defaultPv` / `pvLabel` / `variantLabel` / `pickVariant`、`previewMedia`、`previewBodyHtml`、`pvSwitchHtml`（小学生｜中学生 × 短い｜長い + ゲーム版の切替）、付箋（sticky）の `variant_path` / `variant_label`、`previewFrameHtml`（summary を audience で選ぶ・`data-mode` es/js）、`missingVariantHtml`、`fillPreview`、`loadAllMd`、切替ハンドラ、`READER_KEYS`（読み手係の判定の表示名）、`CAUSE_TEXT` の写し。テストは `test/review-preview.test.ts`（29 hit）と `models3d-review-preview`
- **schema 1 の版は従来どおり**（切替あり・既定「小学生・短い」・`data-mode="es"`）。schema 1 のテストは変えない

## やること（touch ONLY `public/admin/admin.js`・`public/admin/admin.css`・`test/review-preview.test.ts`）
1. **形の判定**: `material.schema_version === 2` を 1 か所の helper（例 `isV2(mat)`）で判定し、以下の分岐に使う。`bodiesOf` 相当（schema 2: `[{path: p.body, label: '本文'}, {path: p.play, label: '遊びの形'}]`）を画面側に小さく持つ（Worker の TS は import できない）
2. **preview（schema 2）**
   - 切替（`pvSwitchHtml`）を出さない。本文は `data-mode="js"` の 1 枠（`previewFrames` は 1 つ。「見比べ」は出さない）
   - 各 part: 型の名前・最初にやること（entry_point）→ 本文（`parts[].body` を `inlineMd` で。`[cN]` は出さない — 現行と同じ）→ 図・画像・動画・立体モデルの置き方は現行（`previewMedia`）と同じ → `play` があれば本文の下に見出し「遊びの形」で描く
   - 枠の頭の要約は `material.summary`
   - **バディ用の枠**（本文の下、子どもの画面の体裁の外に、見出し「子どもには見えない（バディ用）」）: `spark`（「面白さの芯」）、`questions_for_kids`（各問いの文 + 答えの claim id を小さく）、`interest_entries`（interest の表示名: minecraft=マイクラ / programming=プログラミング / craft=ものづくり / digital=デジもの / media=画像・動画 / drawing=絵 / それ以外は id のまま）。無ければ枠ごと出さない
   - `pickVariant` 相当が schema 2 で null を返して「無い」表示にならないようにする。body の path が material に無い schema 2 の版は「本文がありません」の 1 行（`missingVariantHtml` の文は schema 1 のまま）
   - 付箋（sticky）の `variant_path` / `variant_label` は body の path / 「本文」（play は play の path / 「遊びの形」）。`locateItem` の「〜にあります」は schema 2 では「本文にあります」/「遊びの形にあります」
   - `loadAllMd` は schema 2 では body と play だけ読む
3. **読み手係の表示**: `READER_KEYS` に quality の 4 項目の表示名を足す（`first_action`=最初の段落が動作 / `questions_first`=問いが答えより先 / `one_idea_per_paragraph`=1 段落に 1 つ / `no_goal_words`=目標の言い回しなし）。`reader_json.quality` があれば、既存の learning / conditions の判定の並びに同じ体裁で 4 行出す（ok / problem / unclear と reason）。無ければ出さない。項目（fix / ask / note）の title はサーバーの `it.title` をそのまま使う（現行どおり。画面側の `CAUSE_TEXT` の写しには足さない）
4. **CSS**: バディ用の枠と「遊びの形」の見出しのスタイル（`.mat-preview` の中に閉じ込める。既存のトークンを使う）。幅 390px で横にはみ出さない
5. **テスト** `test/review-preview.test.ts`（既存ケース不変・追加だけ）: schema 2 の material（`goodMaterialV2()`）で 切替が描画されない / 本文 1 枠が `data-mode="js"` / 要約が `summary` / バディ用の枠に spark・問い 2 件・入口 2 件 / play の見出し / 付箋の `variant_path` が body の path / `READER_KEYS` に 4 件 / quality 付き reader_json で 4 行 / body の無い schema 2 で「本文がありません」/ schema 1 の既存ケースが全部そのまま緑

## 触らないもの
Worker の `src/**`・`routes/review.ts`（応答の形は変えない）・models3d の画面（`#/models3d`・`model3dPreviewHtml`・`models3dTermsHtml`）・工場ビュー・`index.html`・`factory/claude/*`・契約。**commit しない**。

## verify（実行して verdict だけ報告）
```
cd /Users/hayatofujii/Coding/DESystem/Learning-Agents/.worktrees/material-v2/factory/worker
npx vitest run test/review-preview.test.ts test/models3d-review-preview.test.ts > /tmp/t5-vitest.log 2>&1; echo rc=$?; grep -E 'Test Files|Tests ' /tmp/t5-vitest.log
npx vitest run > /tmp/t5-vitest-all.log 2>&1; echo rc=$?; grep -E 'Test Files|Tests ' /tmp/t5-vitest-all.log
node --check public/admin/admin.js; echo rc=$?
```
実機の撮影（幅 1440 / 1024 / 390 で schema 1 と 2 の版）は司令塔が行う。

## 禁止（host guard の引き継ぎ）
- repo / worktree の外を読まない（`~/.config/**`・`~/.ssh/**`・`*.env`・credentials 類は読取も grep も禁止）。無いファイルは探さず止まって報告
- PII・secret を出力・log に書かない
- 破壊的 git 操作（force push / reset --hard / checkout / switch / stash）をしない。commit しない
- 依頼外のリファクタ・機能追加・既存テストの書き換えをしない。ファイル全体の書き直しをせず、Edit で局所的に足す

## 報告の形（これだけ）
1. 変更ファイル一覧（file:line の範囲）と足した関数名
2. verify の verdict（vitest の Test Files / Tests 行と rc、`node --check` の rc）— 生ログは path だけ
3. 未解決・follow-up
