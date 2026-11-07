# T4 — 配信 API v2 + 検証係の summary 行 + fake シナリオ `done-v2` + smoke（実装担当: opus-impl-medium）

effort は medium: 契約凍結済みの通常実装（serializer の項目追加・fixture と smoke の 1 本追加）。

## 確定済み背景（再調査・再設計しない）
- 正本: `docs/plans/material-v2/contract-AL.md` AL-6（配信 API）・AL-9（smoke）。計画 `plan-v1.md` §6-6・§9
- 作業場: `/Users/hayatofujii/Coding/DESystem/Learning-Agents/.worktrees/material-v2`（Worker は `factory/worker/`）
- T1 は着地済み: `src/checks/shape.ts`（`schemaVersionOf` / `bodiesOf` / `summariesOf`）、fixture `test/fixtures/_shared-v2/outputs/`（good）、`test/helpers.ts` の `goodMaterialV2()` / `goodFilesV2()`
- 現行: `src/routes/library.ts` の `libraryAvailable`（各 part に `variants[{audience,length,interest,game,url}]`・`files`・`videos`・`models3d`、素材に `summary_elementary` / `summary_secondary`。`schema_version` は返していない）。`src/verify.ts` の `<child_texts>` が summary_* の 2 行（:1614-1615 付近）。fake のシナリオは `test/fixtures/<scenario>/`（`files.json` 等。既存の `done` シナリオの作りを読む）→ `scripts/sync-claude-assets.sh` が `src/fake/fixtures.generated.ts` を再生成。`scripts/smoke.mjs` は `/api/library/available` と `parts/p1/p1-elementary-short.md` を直書きで確認

## やること（touch ONLY これらのファイル）
1. **`src/routes/library.ts`**（`libraryAvailable` だけ。models3d の handler は触らない）
   - 各素材に `schema_version`（`schemaVersionOf(material_json)`）、`summary`（schema 2 の `summary`。schema 1 は null）、`spark`（同）を足す
   - 各 part に `body_url`（schema 2: `url(parts[].body)`。schema 1: null）、`play_url`（あれば url、無ければ null）、`questions_for_kids`（配列。無ければ `[]`。各要素は `{id, text, claim_ids}` をそのまま）、`interest_entries`（配列。無ければ `[]`）を足す
   - schema 1 の part の `variants` は現行どおり。schema 2 は `variants: []`。schema 2 の `summary_elementary` / `summary_secondary` は null
   - url は現行の `url()` と `public_paths_json` の gate のまま（`libraryFile` は触らない）
2. **`src/verify.ts`**: `<child_texts>` のブロック（:1614-1615 付近）に schema 2 の `summary` の 1 行を足す（`summariesOf` を使う。schema 1 の 2 行は不変）。**:81 の `PRESENTED_AS_SYSTEM_LINE` 等の文言は verbatim 固定なので触らない**
3. **fake シナリオ `done-v2`**: `test/fixtures/done-v2/` を既存の `done` シナリオと同じ構成で作り、outputs は `_shared-v2` を指す（`files.json` の参照の仕方は既存シナリオに合わせる）。読み手係の fake 応答が schema 2 では `quality` を含む必要がある（T3 が `src/fake/anthropic.ts` を直す。T3 と同時進行なら、T4 は fake 応答に触らず、`done-v2` の smoke 検証は T3 着地後に走らせる）。`bash scripts/sync-claude-assets.sh` で `src/fake/fixtures.generated.ts` を再生成（手で編集しない）
4. **`scripts/smoke.mjs`**: `done-v2` を 1 本足す — 取り込み → 読み手 → 検証 → 仕分け → 承認 → `/api/library/available` に `schema_version: 2`・`body_url`・`questions_for_kids` 2 件 → `GET <body_url>` が 200 で本文が返る（`parts/p1/body.md`）。schema 1 の既存の直書き（`parts/p1/p1-elementary-short.md`）は残す。verdict の出し方は既存の行に合わせる
5. **テスト**（既存ケース不変・追加だけ）: `test/library*.test.ts`（既存の library 系テストの場所に合わせる）に schema 1 と 2 の応答の形（上の項目）。schema 1 の既存の応答が byte 同一であること（既存の固定があればそれで足りる）

## 触らないもの
`checks/*`・`src/reader.ts`・`src/jobs.ts`・`public/admin/*`・`routes/library.ts` の models3d handler・`routes/review.ts`・`factory/claude/*`・契約。**commit しない**。

## verify（実行して verdict だけ報告）
```
cd /Users/hayatofujii/Coding/DESystem/Learning-Agents/.worktrees/material-v2/factory/worker
npx vitest run > /tmp/t4-vitest.log 2>&1; echo rc=$?; grep -E 'Test Files|Tests ' /tmp/t4-vitest.log
npm run typecheck > /tmp/t4-tsc.log 2>&1; echo rc=$?; tail -3 /tmp/t4-tsc.log
# smoke（8787 が使われていれば SMOKE_PORT=8788）: 既存の smoke の起動方法（package.json の scripts / README）に従い、verdict 行だけ報告
```

## 禁止（host guard の引き継ぎ）
- repo / worktree の外を読まない（`~/.config/**`・`~/.ssh/**`・`*.env`・credentials 類は読取も grep も禁止）。無いファイルは探さず止まって報告
- PII・secret を出力・log に書かない。稼働中の DB に外部ツールを当てない（smoke は fake・ローカルだけ）
- 破壊的 git 操作（force push / reset --hard / checkout / switch / stash）をしない。commit しない
- 依頼外のリファクタ・機能追加・既存テストの書き換えをしない

## 報告の形（これだけ）
1. 変更ファイル一覧（file:line の範囲）
2. verify の verdict（vitest・typecheck・smoke の verdict 行と rc）— 生ログは path だけ。smoke を T3 待ちで走らせていないならそう書く
3. 未解決・follow-up
