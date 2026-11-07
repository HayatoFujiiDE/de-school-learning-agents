# T1 — 素材の形 v2: `shape.ts` 新規 + `schema.ts` の両受け + `layout.ts` + v2 fixture + helpers（実装担当: opus-impl-high）

effort を high にした理由: 契約面（schema・型・取り込みの唯一のゲート）をまたぎ、v1 の byte 同一を保ちながら v2 を足す難所。

## 確定済み背景（再調査・再設計しない）
- 正本: `docs/plans/material-v2/contract-AL.md`（AL-1・AL-2・AL-9）と `docs/plans/material-v2/plan-v1.md` §6-1・§6-2。設計は確定済み。v1 の取り込み経路は **byte 同一**に保つ（既存テストを 1 件も変えずに緑）
- 作業場: `/Users/hayatofujii/Coding/DESystem/Learning-Agents/.worktrees/material-v2`（branch material-v2、HEAD 90ab9fe）。Worker は `factory/worker/`。テスト実行は必ずこの絶対パスで `cd` してから
- 現行の validator: `factory/worker/src/checks/schema.ts` の `validateOutputs`（`schema_version !== 1` を拒否・4 変奏必須・`summary_elementary/secondary` 必須・`computePublicPaths` が `variants[].path`）。`layout.ts` の `referencedPaths` が variants/files の path から論理パスを復元。型 `Material` / `Part` / `Variant` は schema.ts の中

## やること（touch ONLY これらのファイル）
1. **新規 `factory/worker/src/checks/shape.ts`**（純関数・I/O なし。`material` は職人の書いた信頼できない値なので、形が違う所は黙って飛ばし、例外を投げない）
   - `schemaVersionOf(m: unknown): 1 | 2` — `m.schema_version === 2` なら 2、それ以外（1・無い・object でない）は 1
   - `bodiesOf(m: unknown): Array<{ path: string; label: string; role: 'variant' | 'body' | 'play'; partId: string | null; audience?: 'elementary' | 'secondary'; length?: 'short' | 'long'; game?: boolean }>` — schema 1: `parts[].variants[]` のうち path が `.md` のものを出現順に（label は `reader.ts` の `variantLabel` と同じ文字列: 小学生・短い / 小学生・長い / 中学生・短い / 中学生・長い / ゲーム版 — `reader.ts:129-133` を読み、その関数を shape.ts へ移して reader.ts から import する形にしてよい。文字列は一字も変えない）。schema 2: `parts[].body`（label「本文」）と、あれば `parts[].play`（label「遊びの形」）
   - `summariesOf(m: unknown): Array<{ key: 'summary_elementary' | 'summary_secondary' | 'summary'; text: string }>` — schema 1 は 2 行（文字列の時だけ）、schema 2 は `summary` の 1 行
   - 単体テスト `factory/worker/test/shape.test.ts`（v1 / v2 / 壊れた入力（parts が配列でない・path が文字列でない）で例外を投げない）
2. **`schema.ts`**: `validateOutputs` を 1 と 2 の両受けに
   - 必須キー: 共通 7（schema_version, slug, title, kinds, catalog_item_id, concept_codes, parts）+ v1 は summary_elementary / summary_secondary + v2 は summary / spark。欠落の失敗コードは既存の形式（`missing_key:material.<key>`）に合わせる
   - `schema_version` は `1` か `2`（数値）。それ以外は `bad_type:material.schema_version`（既存）
   - v2 の part: `body` 必須（文字列・`isPartPath` で `.md` のみ許す・参照先が files に無ければ `missing_ref`）。`play` 任意（あれば同条件。`null` は `bad_type`）。`variants` が**存在すれば** `bad_type:parts[i].variants`（v2 に古い形を混ぜない）。`questions_for_kids` 任意（配列・各要素 `{id: string, text: string, claim_ids: string[]}`。型違いは `bad_type:parts[i].questions_for_kids[j]...`。**claim_ids の存在は検査しない** — 不在は T2 が `missing_claim_refs` に出す）。`interest_entries` 任意（配列・各要素 `{interest: string|null, text: string}`）。`files` / `videos` / `models3d` / `entry_point` / `adjustable` / `tech_dependencies` / `runtime_check` / `needs_supporter_check` は v1 と同じ検査
   - v1 の part は現行どおり（`body` / `play` / `questions_for_kids` / `interest_entries` があっても無視する — 読まない）
   - 型: `Part` に `body?: string; play?: string; questions_for_kids?: Array<{id, text, claim_ids}>; interest_entries?: Array<{interest, text}>` を任意で足し、v2 では `variants: []`。`Material` に `summary?: string | null; spark?: string | null` を足し、`summary_elementary` / `summary_secondary` を `string | null`（v2 は null）にする。既存の利用側（`jobs.ts` 等）が型エラーになるなら、**その呼出側は触らず**、型を後方互換（`string | null` でなく `string` のまま v2 では空文字 `''` を入れる等）に寄せてよい — 判断と理由を報告に書く
   - `computePublicPaths`（§E-4）: v2 は `claims.json`, `adapt-rules.md`, `parts[].body`, `parts[].play`, `parts[].files[].path`（重複除去・昇順）。v1 は現行どおり。`bodiesOf` を使ってよい
   - `claims.json` の `claims[].text_elementary` は任意の文字列として受け、検査しない（既存の claims 検査が未知キーを拒否していないことを確認。拒否しているなら許可リストに足す）
3. **`layout.ts`**: `referencedPaths` を `bodiesOf(material)` の path + `files[].path` にする（v1 の結果は現行と同じ順序・同じ集合）
4. **fixture と helpers**
   - `factory/worker/test/fixtures/_shared-v2/outputs/`: good な v2 素材一式（`material.json`（schema 2・parts 1 つ `p1`・kind 3 と 4・`body: parts/p1/body.md`・`play: parts/p1/play.md`・`questions_for_kids` 2 件（claim_ids は claims.json に実在）・`interest_entries` 2 件・`summary`・`spark`）、`claims.json`（`text_elementary` を 1 件だけ持つ）、`sources.json`、`adapt-rules.md`、`selfcheck.md`、`parts/p1/body.md`（**最初の段落が動作の文で始まり、問いが答えより先、段落 4 つ、記法と claim 印を除いて 300〜600 字、目標語なし**）、`parts/p1/play.md`、`parts/p1/figure-1.svg`、`parts/p1/app.html`）。既存の `_shared/outputs/` の各ファイルの形（claims の status・sources の quoted_excerpt・app.html の外部読み込み無し等）に合わせる
   - `factory/worker/test/fixtures/_shared-v2-bad/outputs/`: 同じ構成で、わざと崩した v2 素材（`body.md` が「今日は〜について学ぼう」で始まり、記法と印を除いて 1300 字以上、`summary` に「学習目標」、`questions_for_kids` が 1 件で `claim_ids: ["c9"]`（claims.json に無い）。それ以外は good と同じ）。**取り込み（validateOutputs）自体は通る**形にする（bad は T2 の機械検査が赤印にする対象であって、validator が拒否するものではない）
   - `factory/worker/test/helpers.ts`: 既存の v1 builder は**変えない**。`goodMaterialV2()` / `goodFilesV2()`（`_shared-v2` と同じ内容をコードで返す）を足す
   - `bash factory/worker/scripts/sync-claude-assets.sh` を実行して `src/fake/fixtures.generated.ts` を再生成する（生成物を手で編集しない）
5. **テスト** `factory/worker/test/schema.test.ts` / `layout.test.ts` に v2 ケースを足す（既存ケースは変更しない）:
   - v2 good → ok、`public_paths` に `parts/p1/body.md` と `parts/p1/play.md` があり `variants` 由来の path が無い
   - v2 で必須キー各 1 つ欠落 → `missing_key:...`（summary / spark / body）
   - v2 で `body` の参照先ファイル無し → `missing_ref`
   - v2 で `variants` あり → `bad_type:parts[0].variants`
   - v2 で `play: null` → `bad_type`
   - v2 で `questions_for_kids` の要素の型違い → `bad_type`、`claim_ids` に不在 id → **ok**（拒否しない）
   - `schema_version: 3` / `"2"`（文字列）→ `bad_type:material.schema_version`。既存の「`2` を拒否する」固定（schema.test.ts:70-78 付近）は「`3` を拒否する」に書き換える — **v1 のケースで変えてよいのはこの 1 行だけ**
   - v2 bad fixture → ok（validator は通す）。bad の `body.md` は生の長さが 150 字以上（下限の検査に当たらないように）
   - v1 の他の既存ケースが全部そのまま緑

## 触らないもの（他タスクの所有）
`checks/childtext.ts`・`checks/triage.ts`・`checks/forbidden.ts`・`src/jobs.ts`・`src/reader.ts`・`src/verify.ts`・`src/routes/*`・`public/admin/*`・`scripts/smoke.mjs`・`src/fake/*`（生成物の再生成を除く）・`factory/claude/*`・`CONTRACT-factory.md`。**commit しない**。

## verify（実行して verdict だけ報告）
```
cd /Users/hayatofujii/Coding/DESystem/Learning-Agents/.worktrees/material-v2/factory/worker
npx vitest run > /tmp/t1-vitest.log 2>&1; echo rc=$?; grep -E 'Test Files|Tests ' /tmp/t1-vitest.log
npm run typecheck > /tmp/t1-tsc.log 2>&1; echo rc=$?; tail -3 /tmp/t1-tsc.log
```
基準（変更前）: vitest 2568 passed / rc=0。変更後は 2568 + 追加分が passed、failed 0。

## 禁止（host guard の引き継ぎ）
- repo / worktree の外を読まない（`~/.config/**`・`~/.ssh/**`・`*.env`・credentials 類は読取も grep も禁止）。無いファイルは探さず止まって報告
- PII・secret を出力・log に書かない。稼働中の DB に外部ツールを当てない
- 破壊的 git 操作（force push / reset --hard / checkout / switch / stash）をしない。commit しない
- 依頼外のリファクタ・機能追加・既存テストの書き換えをしない。見つけた既存バグは報告に follow-up として書くだけ

## 報告の形（これだけ）
1. 変更ファイル一覧（file:line の範囲）と、`Material` 型の後方互換で取った判断（理由 1 行）
2. verify の verdict（vitest の Test Files / Tests 行と rc、typecheck の rc）— 生ログを貼らない（path だけ）
3. 未解決・気づいた follow-up（直していないもの）
