# T3 — 読み手係 v2（schema 2 の入力・system 文・strict schema・守り）+ 仕分けの quality 項目（実装担当: opus-impl-high）

effort を high にした理由: strict な tool schema を版で切り替え、旧 row（`v:1`）を偽緑にしない読み方を仕分けまで貫通させる契約面の難所。

## 確定済み背景（再調査・再設計しない）
- 正本: `docs/plans/material-v2/contract-AL.md` AL-4（READER_SYSTEM_V2 は verbatim）・AL-5（quality 項目）・AL-9。計画 `plan-v1.md` §6-4
- 作業場: `/Users/hayatofujii/Coding/DESystem/Learning-Agents/.worktrees/material-v2`（Worker は `factory/worker/`）
- T1（shape.ts・schema 両受け・helpers v2・fixture）と T2（childtext 新 kind・triage の child_text 分岐・`ITEM_TITLE` の 9 件）は着地済み。`ITEM_TITLE` の quality 4 件の title は既にある
- 現行: `src/reader.ts`（`READER_SYSTEM` :41-61・`READING_SCHEMA` :64-95・`variantLabel`・`materialSectionOf` :154-・`buildReaderInput` :205-249・`readerParams`・`parseReading` :267-・`readVersion`（strict 設定 :438・API 呼出 :443・書込 :460-463 で `{v:1, ...}`））、`checks/triage.ts`（`READER_FINDING_KINDS` / `READER_VERDICTS` / `ReaderResult` / `readReaderResult` :326-340・reader → 項目 :1044-1079）
- **schema 1 の row は現行のまま**: `READER_SYSTEM` / `READING_SCHEMA` / 入力の形 / `v: 1` を一字も変えない。schema 1 の `buildReaderInput` の出力は byte 同一

## やること（touch ONLY これらのファイル）
1. **`src/reader.ts`**
   - `READER_SYSTEM_V2`: 契約 AL-4 のコードブロックを **1 行 1 要素の配列で verbatim**（言い換え・句読点の変更禁止。`join('\n')` は現行と同じ）
   - `READING_SCHEMA_V2`: 現行 `READING_SCHEMA` の項目 + `quality`（`first_action` / `questions_first` / `one_idea_per_paragraph` / `no_goal_words` の 4 キー。各 `{verdict: enum READER_VERDICTS, reason: string}`。`additionalProperties: false`・全項目 required）。tool 名は同じ `report_reading`
   - `buildReaderInput(material, texts, …)`: `schemaVersionOf(material)` で分岐。schema 2 は `<bodies>` の中に `bodiesOf` の順で `## {path}（本文）` / `## {path}（遊びの形）`。`<material>` の節に、現行の項目に加えて `要約: …`（`summary`）、`面白さの芯（子どもには見せない）: …`（200 字で切る）、part ごとに `- 問いの種: q1「…」（答えの主張: c2「<claims.json の text を 200 字で>」）`（5 件まで。参照された claim だけ。claims は既存の入力経路（R2 の claims.json）から取る — 無ければ claim text を空にする）、`- 関心別の入口: minecraft「…」`（6 件まで）。節の無害化（タグの置換）・20,000 字・80,000 字の上限・`not_read` は現行のまま。schema 2 で `<bodies>` のタグ名を使う時は無害化の対象に `bodies` も足す
   - **守り**: `included` が 0 件で parts が 1 つ以上なら、API を呼ばずに `fail(0, 'input_error', { error: 'no_text' })`（attempts を消費する側の失敗）。schema 1 でも同じ。schema 2 で body の path が `included` に無い（R2 に無い）時は、その path を `notRead` に入れる
   - `readerParams(model, text, strict, schemaVersion)`: schema 2 は `READER_SYSTEM_V2` + `READING_SCHEMA_V2`
   - `parseReading(msg, schemaVersion)`: schema 2 では `quality` の 4 キー（各 verdict が `READER_VERDICTS`、reason が string）が無ければ **その試行を失敗**（strict on / off の両方）。schema 1 は現行どおり（`quality` を期待しない）
   - 書込: schema 2 の `reader_json` は `v: 2` と `quality` を含む。schema 1 は `v: 1` のまま
   - ログ行（:465 付近）に `schema` と `included` の件数を足す
2. **`src/checks/triage.ts`**
   - `ReaderResult` に `quality?: Record<'first_action'|'questions_first'|'one_idea_per_paragraph'|'no_goal_words', {verdict, reason}>` と `v?: number`
   - `readReaderResult(json, schemaVersion)`: schema 2 では `v === 2` かつ `quality` の 4 キーが揃っていなければ **null**（→ 既存の扱いで `readerFailed` = `reader_failed` の ask ×3）。schema 1 は現行どおり（`quality` があっても無視）
   - quality → 項目（reader の項目の直後）: id `quality:<key>`、kind `reader`、key `explanation_and_expression`、cause `quality_<key>`、`problem` → fix、`unclear` → ask、`ok` → 出さない。title は `ITEM_TITLE`（T2 が置いた）
   - `readReaderResult` の呼出側は `triage.ts` の中のほかに **`routes/review.ts`（:176 付近）** にもある。両方に material の schema を渡す形に最小で合わせ、確認画面の応答（`GET /api/review/:id`）の reader の結果に `quality` が含まれるようにする（応答の既存の項目は変えない。足すだけ。変更箇所を報告）
3. **`src/fake/anthropic.ts`**（fake の読み手応答）: schema 2 の呼出（system が `READER_SYSTEM_V2`）には `quality` を含む応答を返す。schema 1 の fake 応答は不変
4. **テスト**（既存ケース不変・追加だけ）
   - `test/reader.test.ts`: schema 1 の `buildReaderInput` 出力が現行と byte 同一（既存の固定があればそれで足りる）/ schema 2 で included = [body, play] の順と `## … （本文）` `（遊びの形）` のヘッダ / `<material>` に要約・芯・問いの種（claim の text 入り）・入口 / 空入力（texts が空）で `createMessage` が呼ばれず `input_error` / schema 2 で `quality` 欠落の応答 → 試行失敗（strict on と、設定 `reader_strict='0'` の両方）/ schema 1 で `quality` 無しの応答 → ok / play だけ読めた → body の path が `not_read` / `READER_SYSTEM_V2` の各行を契約から写した文字列と toEqual（reader.test.ts:118-141 の型）/ 書込の `v` が schema で 1 / 2
   - `test/triage.test.ts`: schema 2 の row に**現行で正常に読める完全な schema 1 の結果**（`{v:1, findings:[], learning:{verdict:'ok', reason}, conditions:{verdict:'ok', reason}, summary, not_read:[]}`）の reader_json → `readReaderResult(json, 2)` が null → `reader_failed` の ask が出て gate が attention（clean にならない。`{v:1, findings:[]}` だけでは現行でも null になるので弁別にならない）/ quality problem → fix・unclear → ask・ok → 項目なし / schema 1 の row で quality 付き json → 項目なし
   - `test/review-route*.test.ts`（既存の review API のテストの場所）: schema 2 の版の `GET /api/review/:id` の応答に reader の `quality` が入る

## 触らないもの
`checks/schema.ts`・`shape.ts`・`layout.ts`・`childtext.ts`・`forbidden.ts`・`goalwords.ts`・`src/jobs.ts`・`routes/library.ts`・`src/verify.ts`・`public/admin/*`・`scripts/smoke.mjs`・`factory/claude/*`・契約。`routes/review.ts` は `readReaderResult` の呼出と応答への `quality` の追加だけ。`READER_SYSTEM`（schema 1）を変えない。**commit しない**。

## verify（実行して verdict だけ報告）
```
cd /Users/hayatofujii/Coding/DESystem/Learning-Agents/.worktrees/material-v2/factory/worker
npx vitest run > /tmp/t3-vitest.log 2>&1; echo rc=$?; grep -E 'Test Files|Tests ' /tmp/t3-vitest.log
npm run typecheck > /tmp/t3-tsc.log 2>&1; echo rc=$?; tail -3 /tmp/t3-tsc.log
```

## 禁止（host guard の引き継ぎ）
- repo / worktree の外を読まない（`~/.config/**`・`~/.ssh/**`・`*.env`・credentials 類は読取も grep も禁止）。無いファイルは探さず止まって報告
- PII・secret を出力・log に書かない。稼働中の DB に外部ツールを当てない
- 破壊的 git 操作（force push / reset --hard / checkout / switch / stash）をしない。commit しない
- 依頼外のリファクタ・機能追加・既存テストの書き換えをしない

## 報告の形（これだけ）
1. 変更ファイル一覧（file:line の範囲）。`readReaderResult` の署名変更で合わせた呼出側
2. verify の verdict（vitest の Test Files / Tests 行と rc、typecheck の rc）— 生ログは path だけ
3. 未解決・follow-up
