# T2 — 子ども向け本文の機械検査 v2 + 仕分けの分岐 + 取り込みの配線（実装担当: opus-impl-high）

effort を high にした理由: 仕分け（triage.ts）は語彙ロックと自動作り直しの判定を持つ契約面で、新 kind の分岐・severity・網羅テストを既存の verbatim ロックを壊さずに足す難所。

## 確定済み背景（再調査・再設計しない）
- 正本: `docs/plans/material-v2/contract-AL.md` AL-2・AL-3・AL-5（RETURN_NOTE と網羅テスト）・AL-9。計画 `plan-v1.md` §6-3・§6-5・§6-9
- 作業場: `/Users/hayatofujii/Coding/DESystem/Learning-Agents/.worktrees/material-v2`（Worker は `factory/worker/`。テストは必ずこの絶対パスで `cd`）
- T1 は着地済み: `src/checks/shape.ts`（`schemaVersionOf` / `bodiesOf` / `summariesOf`）、`schema.ts` の両受け、`test/helpers.ts` の `goodMaterialV2()` / `goodFilesV2()`、fixture `test/fixtures/_shared-v2/outputs/`（good）と `_shared-v2-bad/outputs/`（bad）。これらを使う。変えてよいのは helpers への追加だけ
- 現行: `checks/childtext.ts`（kind `file_name` / `raw_markup` / `edition_text`。variants の .md と summary_* を走査。`stripMarkdownForCheck` あり）、`checks/triage.ts`（`:911-934` 付近で child_text を項目に。他 kind は黙って捨てる。`ITEM_TITLE` / `ITEM_CAUSES = Object.keys(ITEM_TITLE)`。`RETURN_NOTE_TEXT` の `.text` と `.scope`）、`checks/forbidden.ts`（summary_* を入力に取る）、`src/jobs.ts`（取り込みで `checkForbidden` → `checkChildText` → `checks_json`）
- **語彙ロックを壊さない**: 出典 group 用の `Cause` 型・`CAUSE_TEXT` には**足さない**（triage.test.ts の `CAUSE_TEXT` toEqual・mc-edition / models3d-triage の固定は不変）。新 cause は `ITEM_TITLE` だけ（`file_name` / `raw_markup` と同じ扱い）

## やること（touch ONLY これらのファイル）
1. **新規 `src/checks/goalwords.ts`**: `export const GOAL_WORDS: readonly string[]`（契約 AL-3 のマーカー行の語を ` / ` で分けた順どおり・22 語・一字も変えない）と `export const GOAL_WORDS_MARKER = '目標語（正本）: '`
2. **`src/checks/childtext.ts`**（schema 1 の出力は byte 同一）
   - `export const CHILD_TEXT_KINDS = ['file_name', 'raw_markup', 'edition_text', 'goal_word', 'body_too_long', 'body_too_short', 'questions_missing', 'first_paragraph_not_action'] as const; export type ChildTextKind = (typeof CHILD_TEXT_KINDS)[number];`
   - 走査対象を `bodiesOf(material)`（.md）と `summariesOf(material)` に。既存 3 kind は schema 2 の body / play にも走る（`edition_text` は各 .md に 1 件）
   - schema 2 の時だけ（`schemaVersionOf(material) === 2`）新 kind を出す（契約 AL-3 の表どおり）:
     - `goal_word`: 子ども向けの文（body・play の `stripMarkdownForCheck` 後の本文、`summary`、各 part の `title`・`entry_point.text`・`questions_for_kids[].text`・`interest_entries[].text`・`videos[].why`）に `GOAL_WORDS` の語が含まれる（`FORBIDDEN_WORDS` と同じ部分一致）。`spark` には当てない。sample は当たった語の前後 40 字（`sampleAt`）。path は本文の path か `material.json`
     - `body_too_long`: `parts[].body` の `stripMarkdownForCheck` 後の code point 数 > `BODY_MAX_CHARS = 1100`
     - `body_too_short`: `parts[].body` の生の本文から claim 印 `[cN]` だけ除いた code point 数 < `BODY_MIN_CHARS = 150`（コードを含めて数える）
     - `questions_missing`: その part の `questions_for_kids` が無い・配列でない・2 件未満、または `claim_ids` が空配列の問いがある（sample はその問いの id）。path は `material.json`。T1 の validator は型違反だけ拒否し、省略・空は通す（契約 AL-1）
     - `first_paragraph_not_action`: body の最初のブロック（見出し行・箇条書き・囲みコードを飛ばした最初の段落）に正規表現 `/(て|で)(みよう|みて|みましょう|ごらん)|しよう|しましょう|やってみ|さわって|開いて|置いて|押して|動かして|作って|数えて|見つけて|たどって|見て/` が 1 つも無い。sample は最初の段落の先頭 40 字
   - 定数は export（`BODY_MAX_CHARS` / `BODY_MIN_CHARS` / `FIRST_ACTION_RE`）
   - `export function bodyChars(material, texts): Array<{path, chars}>`（散文の code point 数。`checks_json.body_chars` 用。schema 2 だけ）
3. **`src/checks/forbidden.ts`**: 入力に `summary?: string` を足し、schema 2 では `material.json#summary` の 1 行を走査（schema 1 の 2 行は不変）
4. **`src/jobs.ts`** 取り込み: `checkForbidden` に summary を渡す、`checks_json` に `body_chars`（schema 2 だけ）を足す、取り込みのログ行（既存の `at: 'ingest'` 相当）に `schema_version` と child_text の kind 別件数を足す。それ以外の取り込みの流れ・SQL は変えない
5. **`src/checks/triage.ts`**
   - child_text → 項目の分岐（`:911-934` 付近）を `CHILD_TEXT_KINDS` で網羅: `goal_word` / `body_too_long` / `body_too_short` / `questions_missing` は severity **fix**、`first_paragraph_not_action` は **note**。id `text:<kind>:<path>`、key `explanation_and_expression`、cause = kind。既存 3 kind の扱いは不変
   - `ITEM_TITLE` に 9 件を契約 AL-5 から**一字ずつ写す**（5 件の child_text kind + `quality_first_action` / `quality_questions_first` / `quality_one_idea_per_paragraph` / `quality_no_goal_words`。quality の 4 件は T3 が項目を出すが title は T2 で置く）
   - `RETURN_NOTE_TEXT` を `schemaVersionOf(material)` で分岐: schema 2 の `.text` は契約 AL-5 の verbatim、`.scope` は現行の文の「変奏どうしの食い違い」を「本文と問い・入口の食い違い」に置き換えた文。schema 1 は現行のまま（`buildReturnNote` の呼出側で material を渡す形にする。署名を変えるなら呼出側（triage-step.ts 等）も最小で合わせる — 変更箇所を報告）
6. **テスト**（既存ケースは変えない）
   - `test/goalwords.test.ts`（lock test）: `GOAL_WORDS` の集合が、`src/generated/claude-assets.ts` の `RUBRIC_COMMON`（採点表）・`EDITORIAL_STANDARDS`・`../claude/agents/material-maker.md`（fs で読む）・`../../docs/plans/material-v2/contract-AL.md` の 4 文書それぞれの `目標語（正本）: ` で始まる行（先頭の空白を除く）を ` / ` で分けた集合と一致する。**4 文書の現物は司令塔が置く（T0）。無ければテストは失敗してよい（それが目的）**
   - `test/childtext.test.ts`: bad fixture → kind の多重集合が正確に `{goal_word ×2（body と summary）, body_too_long, questions_missing, first_paragraph_not_action}`、good → 0 件、schema 1 の既存 fixture → 新 kind 0 件、schema 2 の body/play に `file_name` / `raw_markup` / `edition_text`（版が決まっている題材（conditions.tools に `Minecraft Java 版 26.3`）で play.md に版の 1 文が無い → `edition_text` が play の path で 1 件）、コード主体の本文（囲みコード 400 字 + 散文 100 字）で `body_too_short` が出ない、`body_chars`
   - `test/forbidden.test.ts`: schema 2 の summary に禁止語 → 1 件
   - `test/triage.test.ts`（既存ケース不変・追加だけ）: **網羅テスト** — `CHILD_TEXT_KINDS` の各 kind を 1 件ずつ schema 2 の material（版が決まっている題材）に与え、kind ごとに `text:` 項目が 1 件出て severity が契約どおり、`ITEM_TITLE[kind]` が空でない / bad fixture 相当の child_text で autoRounds 0 → `auto_return`、autoRounds 2 → `none` と gate attention / 9 件の title を契約から写した文字列と toEqual（reader.test.ts:118-141 の型）/ schema 2 の `RETURN_NOTE_TEXT` の `.text` と `.scope`
   - 既存の `test/triage-step.test.ts:59`（`ITEM_CAUSES` の列挙）が新 cause で変わるなら、その列挙だけ更新

## 触らないもの
`src/reader.ts`・`routes/*`・`src/verify.ts`・`public/admin/*`・`scripts/smoke.mjs`・`src/fake/*`・`checks/schema.ts`・`checks/shape.ts`・`checks/layout.ts`・`factory/claude/*`・契約。出典 group 用の `Cause` / `CAUSE_TEXT` に足さない。**commit しない**。

## verify（実行して verdict だけ報告）
```
cd /Users/hayatofujii/Coding/DESystem/Learning-Agents/.worktrees/material-v2/factory/worker
npx vitest run > /tmp/t2-vitest.log 2>&1; echo rc=$?; grep -E 'Test Files|Tests ' /tmp/t2-vitest.log
npm run typecheck > /tmp/t2-tsc.log 2>&1; echo rc=$?; tail -3 /tmp/t2-tsc.log
```
**FAIL-before の証拠**: 新しい childtext のテストを先に書き、`git stash` を使わず（禁止）、実装前に 1 回だけ `npx vitest run test/childtext.test.ts` を走らせて失敗件数を控える（報告に書く）。その後実装して緑にする。

## 禁止（host guard の引き継ぎ）
- repo / worktree の外を読まない（`~/.config/**`・`~/.ssh/**`・`*.env`・credentials 類は読取も grep も禁止）。無いファイルは探さず止まって報告
- PII・secret を出力・log に書かない。稼働中の DB に外部ツールを当てない
- 破壊的 git 操作（force push / reset --hard / checkout / switch / stash）をしない。commit しない
- 依頼外のリファクタ・機能追加・既存テストの書き換えをしない。見つけた既存バグは報告に follow-up として書くだけ

## 報告の形（これだけ）
1. 変更ファイル一覧（file:line の範囲）。`buildReturnNote` の署名を変えたなら呼出側の変更箇所
2. FAIL-before の失敗件数、verify の verdict（vitest の Test Files / Tests 行と rc、typecheck の rc）— 生ログは path だけ
3. 未解決・follow-up
