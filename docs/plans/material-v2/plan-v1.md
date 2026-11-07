# 素材の形 v2 — 実装計画 v2（2026-11-08。司令塔 Fable。MAP 3 + PLAN 2 + REVIEW 2（Astra medium R1 / Opus 検証役）を反映）

レビューの裁定（要点）: Astra R1 ①=検証役 B2（確認画面を同 PR に）→ T5 に移動 / Astra ②=検証役 B1（v2 row の読み手結果は `v:2` と `quality` 必須。無ければ reader_failed）→ §6-4 / Astra ③（rollback は配信中の v2 を先に解消）→ §10 / 検証役 B3（目標語の正本 1 か所 + 4 文書のマーカー行 + lock test）→ §6-9 / 検証役 B4（deploy〜ant apply の窓は `paused=1`・precheck は queued も数える・1 回の deploy）→ §6-7。

関連: `align.md`（文脈）/ `system-map.md`（file:line）/ `drafts/`（職人定義・採点表・編集基準の v2 下書き。司令塔所有）

## 1. Goal
工場が出す素材を「本文 1 本 + バディ向けの構造化データ」（schema_version 2）に変え、中身の質（基準 5 つ）を読み手係と取り込み検査で機械的に見て、だめなら既存の自動作り直し（2 回）へ戻す。既存の schema 1 の版は今までどおり読める。

測る形: (a) fake の `done-v2` シナリオが 取り込み → 読み手 → 検証 → 仕分け → 配信 を通る（vitest + smoke 緑）(b) 実 session 1 本が schema 2 で取り込まれ、reader_json に quality 4 キー、library に `body_url`、session 費用を記録 (c) わざと崩した v2 fixture で `goal_word` / `body_too_long` / `body_too_short` / `questions_missing` が fix になり（修正前 FAIL / 修正後 PASS）、正しい fixture は 0 件 (d) v1 の既存テスト 2358 件が不変で緑。

## 2. Scope / non-scope
- Scope: 契約（新節 + 既存節への「優先する」宣言）/ Worker（shape.ts 新規、schema・layout・childtext・forbidden・jobs・reader・triage・verify・library）/ fixture・fake・smoke / 職人定義・採点表・編集基準（司令塔）/ admin.js（§AK 着地後、別 PR）
- Non-scope: migration（列を作らない）/ state machine・publish / app-v3 の消費者 / v1 の版の変換 / `REDO_REJECT_NOTE` の Minecraft 文言（別件）/ interest 語彙の機械照合（採点表で見る。validator は string|null）/ 読み手係の呼び出し回数・費用上限の変更 / 既存素材の作り直し（依頼箱 material_redo。着地後にふじさんと順に）

## 3. Current state
起点 origin/main **90ab9fe**（§AK PR-AK1 着地・deploy 8a39fa69 済み。system-map.md の file:line は ced174f 時点のもので、admin.js の models3d 領域と schema.ts の validateOutputs の opts・jobs.ts:415/1896 付近・routes/library.ts の models3d handler が §AK で変わった。preview 領域・reader・childtext・triage・layout は §AK では不変。実装は関数名で位置を取り直す）。§AK の次 PR-AK2（本文の丸写し検査: citations.ts・verbatim.ts・jobs.ts 取り込み・triage の terms_of_use cause・publish.ts・review.ts・rework.ts・verify.ts）は本レーンの着地後に rebase する約束（同日、担当セッションと合意）。取り込みゲートは `checks/schema.ts:541` の 1 関数（schema 1 のみ）。本文は 4 変奏 + game.md 必須。読み手係は `<variants>` の .md だけ読み、v2 の row は「空読み clean」になる（偽緑）。define_outcome は送る時点の Worker の rubric。§AK（la-q11）が CONTRACT の末尾と admin.js の models3d 領域を触っていて未着地。基準テスト 89 files / 2358 PASS。

## 4. Dependency map
- 上流（作る側）: 職人定義（ant apply）→ 採点表・編集基準（Worker 同梱 `sync-claude-assets.sh`）→ 取り込み
- 下流（読む側）: schema.ts（Material 型）→ layout / childtext / forbidden / jobs → reader → verify → triage → triage-step（auto_return / 自動公開）→ review API / admin → library
- 並列可: childtext+triage（T2）/ reader（T3）/ jobs+verify+library（T4）は T1（型凍結）の後に並列。T2 と T3 は両方 triage.ts を触る → **T3 は T2 の後**（直列）
- 外部: §AK 着地 → admin.js（T6）

## 5. Module impact（詳細は system-map.md §3）
schema.ts（validator）/ shape.ts（新規）/ layout / childtext（新 kind 5）/ forbidden（summary 1 本）/ jobs（取り込みの配線・checks_json.body_chars）/ reader（v2 入力・schema を版で選ぶ・no_text 守り）/ triage（child_text 分岐・ITEM_TITLE・quality 項目・RETURN_NOTE の版分岐）/ verify（summary 行）/ library（v2 の応答）/ test・fixtures・fake・smoke / admin.js（後）

## 6. Chosen approach（hybrid）と根拠
1. **形の分岐は `src/checks/shape.ts` 1 か所**（最小変更レンズ）: `schemaVersionOf(m): 1|2`（`=== 2` なら 2、`=== 1` か無ければ 1。それ以外の値は validator が取り込み時に拒否するので保存された row には存在しない — 到達しない分岐として 1 を返し、黙って丸める用途には使わない）、`bodiesOf(m): [{path, label, role: 'variant'|'body'|'play'}]`、`summariesOf(m)`。childtext / reader / layout / library / schema.computePublicPaths が使う。triage の `materialPaths`（.html/.svg）は触らない
2. **validator は 1 と 2 の両受け**。v2: `body` 必須（parts/<id>/ 配下の .md・参照先実在）、`play` 任意、`summary`・`spark` 文字列必須、`questions_for_kids` 任意（**キーの省略 = 赤印（T2 の `questions_missing`）/ 存在する値の型違反（配列でない・要素に `id`/`text` が無い・`claim_ids` が無いか配列でない）= 拒否 `bad_type` / `claim_ids` が空配列 = 赤印（`questions_missing`）/ `claim_ids` の id が claims.json に無い = 赤印 `checks_json.missing_claim_refs` に `material.json#questions.q1`**。G3 と矛盾しない: 止めるのは型だけ）、`interest_entries` 任意（`{interest: string|null, text}`）、**v2 に `variants` があれば `bad_type:parts[i].variants` で拒否**（混在 row を作らない。堅牢性レンズ）。v1 経路は byte 同一（v1 で `body` は無視）。claims の `text_elementary` は任意 string
3. **取り込みの機械検査（childtext、v2 だけ）**: `goal_word`（fix）/ `body_too_long`（fix。`stripMarkdownForCheck` 後（= 散文。囲みコード・行内コード・URL・claim 印を除く）の code point > 1100。職人には「1000 字以内」と言い、機械は 10% の余裕）/ `body_too_short`（fix。**生の本文**（コードを含む・claim 印だけ除く）の code point < 150。コード主体の本文（Python / Scratch）を誤って短いと見ないため、長さの上限と下限で測る対象を分ける）/ `questions_missing`（fix。v2 の part に questions_for_kids が無い・2 件未満・または `claim_ids` が空の問いがある）/ `first_paragraph_not_action`（**note**。語尾ヒューリスティック。読み手係の ① との一致を §9 の probe で測り、90% 以上なら fix へ昇格）。既存の `file_name` / `raw_markup` / `edition_text` は `bodiesOf` の .md（body・play）に対して従来どおり走る。`checks_json.body_chars` を記録（観測用）。v1 の row には新 kind を出さない。`ChildTextKind` は `CHILD_TEXT_KINDS` の const 配列から型を導出し export する（網羅テストの材料）。**目標語の正本は `src/checks/goalwords.ts` の `GOAL_WORDS`（下の 6-9）で、契約・採点表・職人定義・編集基準の 4 文書に同じマーカー行を置き、lock test が集合一致を固定する**
4. **読み手係は row の schema_version で 2 系統**: v1 = 今の READER_SYSTEM / READING_SCHEMA を verbatim 維持（回帰不変）。v2 = `READER_SYSTEM_V2`（司令塔が契約に verbatim で書く）+ `READING_SCHEMA_V2` = v1 の項目 + `quality: {first_action, questions_first, one_idea_per_paragraph, no_goal_words}`（各 `{verdict: ok|problem|unclear, reason}`、strict・required）。基準 ③（芯と活動がつながる）は v2 の `learning` の定義として書く（重複キーを作らない）。入力は `## parts/p1/body.md（本文）` / `（遊びの形）`、`<material>` に 要約・面白さの芯・問いの種（各問いの答えの claim 本文 200 字まで）・関心別の入口を足す。**`quality` は schema 2 では必須**（Astra R1 ② = 検証役 B1）: schema 2 の読み手結果は `reader_json` に **`v: 2`** を書く（現行は `v: 1`）。`parseReading(msg, schemaVersion)` は schema 2 の応答に `quality` の 4 キーが無い・形が違えばその試行を失敗にする（strict を外した設定 `reader_strict='0'`（reader.ts:438）の経路でも同じ）。`readReaderResult(json, schemaVersion)` は schema 2 で `v !== 2` または `quality` が無ければ null を返す → triage.ts:1040-1043 の既存の扱いで `readerFailed`（`reader_failed` の ask ×3。自動公開は通らない）。これで「v2 を知らない読み手が書いた `{v:1, findings:[]}` が v2 row に残る」事故（rollback 中など）が roll-forward 後に clean にならない。schema 1 の row は `quality` を期待しない（旧 row は項目なし）。**守り**: 入力ブロックが 0 件なら API を呼ばず `input_error:no_text` で失敗（attempts を消費 → 2 回で failed → `reader_failed` の ask が人に出る）。本文（`body`）が `included` に無く遊びの形だけ読めた時は、body の path を `not_read` に入れる（`reader_partial` の ask。自動公開は通らない）
5. **仕分け**: child_text の新 kind を `triage.ts:932` の分岐に足し、severity は kind 別（上記）。quality の 4 項目は id `quality:<key>`・kind reader・key `explanation_and_expression`・problem → fix / unclear → ask。**新しい cause は `file_name` / `raw_markup` と同じく `ITEM_TITLE` だけに足す**（`Cause` 型・`CAUSE_TEXT`（出典 group 用）には足さない → triage.test.ts:590 / mc-edition:303 の verbatim ロックは不変、triage-step:59 は `ITEM_CAUSES` 経由で自動網羅）。9 件の title は契約から一字ずつ写し、reader.test.ts:118-141 と同じ型のテストで固定。`RETURN_NOTE_TEXT` の `.text` と `.scope`（:285「変奏どうし」）を版で分岐（v2: 「直した所は本文と、あれば遊びの形・問いの種・入口でそろえる」）。verify.ts:81 の文言（小学生・中学生…）は u1 の verbatim 固定なので触らない。**網羅テスト**: `CHILD_TEXT_KINDS` の各 kind を 1 件ずつ v2 material に与え、kind ごとに `text:` 項目が 1 件出て `ITEM_TITLE[kind]` が空でないことを assert（triage.ts:784 は title 欠落を `''` で黙って通すため）
6. **配信 API**: 各素材に `schema_version`・`summary`・`spark`、各 part に `body_url`・`play_url`（null 可）・`questions_for_kids`・`interest_entries`（無ければ `[]`）。v1 の row は今の項目のまま（v2 は `variants: []`・`summary_*: null`）。`spark` と `claim_ids` は「画面に出さない」であって秘密ではない（この API は認証なし。子どもを表す列は引き続き無い）
7. **着地順**（検証役 B4 を反映）: T1〜T5 を **1 回の deploy** で出す（途中 deploy は「v2 を知らない読み手」を現実にする）。手順（Astra R2: `paused=1` の後は回答の送信も 409 で止まる（jobs.ts:832）ので、完走させるなら停止の前に行う）: (a) precheck: queued の job と phase 1（質問待ち・define_outcome 未送信）の job を投影 SQL で数える。0 でなければ、回答して完走させる（v1 のまま取り込まれる）か取り消す → (b) settings `paused=1`（startJob と回答が止まる。v1 の指示 + v2 採点表の取り合わせで混成出力（`variants` 混在・body 欠落）が出て `invalid_outputs` になり注文が消えるのを防ぐ）→ (c) 再検査: 同じ SQL が 0 件（停止までの間に入った注文が無いこと）。0 でなければ (a) へ戻る（取消は停止中でも可） → (d) Worker deploy（両受け + v2 採点表・編集基準同梱）→ (e) `ant apply`（claude-lock 更新。ログインが通らなければふじさん TODO。通るまで (f) に進まない）→ (f) `paused=0` → (g) 実 session 1 本 → §9 の probe。逆順（ant apply 先行）は v2 出力が `invalid_outputs` になり `job_reingest` は同じ validator なので回収できない — やらない。切替用の settings 行は作らない（`paused` / `auto_publish` で足りる）
8. **採る/捨てる**: 最小変更レンズから shape.ts・両受け・fixture 配置・smoke の足し方・着地順を採用。読み手の option A（schema 不変）は**不採用**（基準ごとに ok/problem が画面に出ず、① の note → fix 昇格の一致率も測れない）。堅牢性レンズから quality オブジェクト・版で schema を選ぶ・no_text 守り・variants 拒否・body_too_short・網羅テスト・rollback 手順を採用。長さの上限は両レンズの間（1100）に置いた。`first_paragraph_not_action` は両レンズどおり note
9. **目標語（正本 = `src/checks/goalwords.ts` の `GOAL_WORDS`。契約 AL-3・採点表 14・職人定義「本文の書き方」・編集基準「言葉」の 4 文書に次のマーカー行を verbatim で置き、lock test が fs で読んで集合一致を固定する）**:
   `目標語（正本）: 学習目標 / めあて / 学ぼう / 学びましょう / 学習しましょう / 覚えよう / 覚えましょう / 身につけよう / 身につけましょう / できるようになろう / できるようになりましょう / 理解しよう / 理解しましょう / マスターしよう / この単元 / 本時 / 目標は / 目標： / 目標: / ねらいは / ねらい： / ねらい:`
   適用（機械・採点表とも同じ範囲）: body・play・summary・title・entry_point.text・questions_for_kids[].text・interest_entries[].text・videos[].why（**spark には当てない**）。「目標」「ねらい」単独は機械では当てない（目標物・ねらいを定める）。採点表と読み手係は、単独の「目標」「ねらい」でも学びの目標を示す意味なら指摘してよい（機械は床、採点表・読み手は意味で見る — 判定が割れても機械より厳しい側にしか割れない）

## 7. Rejected alternatives
- 読み手 option A（既存 kind に載せる・schema 不変）: 上記 6-8
- settings の切替フラグ: ingest の受け付けしか gate できず、職人（ant apply）と読み手の経路は deploy が要る → 価値なし
- `variants` を 1 要素で残す互換案: 混在 row と「どちらを読むか」の分岐を全消費者に残す → 不採用
- 本文ゼロ（仕掛け + claims だけ。バディが全文生成）: 人の確認面と番人の控えが無くなる → 不採用（本文 1 本が中庸）

## 8. Risks と故障マトリクス（移行）
| 状態 × 故障点 | 何が起きる | エラー前の書込 | 収束 / 予算 | 有界か |
|---|---|---|---|---|
| deploy 時に phase 1（質問待ち）の session（v1 prompt）に v2 rubric | grader が needs_revision を繰り返す ≤ max_iterations 3 → `max_iterations_reached` でも取り込み（jobs.ts:1482）。schema 1 で入る | なし | session budget 内。追加費用 ≤ 3 周 × N 本 | 有界（両受けが前提） |
| deploy 時に outcome 進行中 | outcome は再送されない（jobs.ts:1474-1479）。v1 出力が取り込まれる | なし | — | 有界 |
| ant apply 後に v1 の版が差し戻し → rework（v1 prev + v2 prompt） | 職人定義の「作り直し」節が古い形から body 1 本へ組み直す。RETURN_NOTE は版分岐済み | なし | AUTO_RETURN_MAX=2（autoRoundsOf。形に非依存） | 有界 |
| material_redo（draft・prev なし） | v2 で一から。却下は queue 前に commit（ops.ts:92-104） | 却下 | 1 session | 有界 |
| v2 Worker を v1 に rollback（v2 row が残る） | 新しい v2 出力は invalid_outputs（roll-forward 後 job_reingest で回収）。review 中の v2 row を v1 読み手が空読み → clean → 自動公開 / 配信中の v2 版は library が variants:[] を配り続ける（auto_publish=0 は既存配信を止めない。library.ts:64-102） | reader_json 等 | — | **§10 の順序で有界**: 0 で自動公開と cron を止め、0b で配信中の v2 版を v1 へ rollback か配信停止してから Worker を戻す |
| 旧読み手（v2 を知らない Worker）が v2 row を読む | 上の rollback の場合だけ起きる（T1〜T5 は 1 回の deploy）。旧読み手は `{v:1, findings:[]}` を done で書く（reader.ts:460-463）→ roll-forward 後、新 Worker の `readReaderResult(json, 2)` が `v !== 2` で null → reader_failed の ask（6-4）。新 Worker 自身は `no_text` 守りで空読みしない | reader_json | 人が見る | 有界（§10 の順序 + 6-4） |
| コード主体の本文（Python / Scratch） | 下限はコードを含む生の長さで測るので `body_too_short` にならない。上限は散文だけで測る（6-3） | なし | — | 有界 |
| 版が決まっている題材で play.md に版の 1 文が無い | `edition_text` が bodiesOf の各 .md に走る → fix → 自動作り直し | なし | AUTO_RETURN_MAX | 有界 |
| strict を外した設定（reader_strict='0'）で schema 2 の応答に quality が無い | parseReading が試行を失敗にする（attempts 消費） | なし | READER_MAX_ATTEMPTS=2 → failed → reader_failed の ask | 有界 |
| body が R2 に無く play だけ読めた | body の path を not_read → reader_partial の ask。自動公開は通らない | reader_json | 人が見る | 有界 |
| v2 出力に variants が混在 | validator が拒否（6-2）→ job は `failed`/`invalid_outputs`（再試行しない。retro が 6 時間後に振り返る）。職人の誤りなので同じ出力の reingest では直らない → 工場ビューで人が見て新しい注文 | なし | ループ無し | 有界 |
| schema 1 の版の job_reingest / 人の差し戻し（v1 prev）を v2 Worker が処理 | validator の v1 経路は byte 同一（6-2）。rework は v2 職人定義の「作り直し」節が body 1 本へ組み直す | なし | 既存の予算 | 有界（G1 の回帰テスト） |
| questions_for_kids の claim_ids が空・不在 | 拒否せず missing_claim_refs の赤印 → fix → 自動作り直し | なし | AUTO_RETURN_MAX | 有界 |
| questions_for_kids の claim_ids が不在 | missing_claim_refs の赤印 → 仕分けの fix → 自動作り直し | なし | AUTO_RETURN_MAX | 有界 |
| 空の本文・極端に長い本文 | body_too_short / body_too_long → fix → 自動作り直し | なし | AUTO_RETURN_MAX | 有界 |
| 目標語の誤検知（物語文脈） | fix → 自動作り直し 1 回（≈$10） | なし | 一覧を狭く保つ（単独の「目標」「ねらい」は当てない）。誤検知が出たら一覧を契約で改訂 | 有界 |

## 9. Verification strategy
- vitest: schema（v2 ok / 必須キー各欠落 / body missing_ref / variants 混在拒否 / schema 3 拒否（schema.test.ts:70-78 の「2 を拒否」の固定は「3 を拒否」に変える — v1 のケースで変わるのはこの 1 行だけ）/ claim_ids 空・不在 → 取り込み成功 + missing_claim_refs / v1 の他の全ケース不変）、layout（`resolveOutputLayout` が v2 の body・play を論理パスに置く）、childtext（bad fixture → 正確に {goal_word×2, body_too_long, questions_missing, first_paragraph_not_action}、good → []、v1 → 新 kind 0、v2 の body/play に対する file_name / raw_markup / edition_text（MC 題材で play.md に版の 1 文が無い）、コード主体の本文で body_too_short が出ない、目標語の lock test（GOAL_WORDS と 4 文書のマーカー行の集合一致））、forbidden、reader（v1 入力 byte 同一 / v2 included=[body, play] / 空入力で API 未呼出 / v2 で quality 欠落 → 試行失敗（strict on と off の両方）/ v1 で quality 無し → ok / play だけ読めた → body が not_read）、triage（**kind ごとに 1 件投入 → 期待 severity と項目 id** の表テスト（文字列一覧の比較だけにしない）、autoRounds 0 で auto_return・2 で none/attention、quality problem → fix・unclear → ask、v2 の row に **現行で正常に読める完全な v1 の結果**（`{v:1, findings:[], learning:{ok}, conditions:{ok}, summary, not_read:[]}`）→ `readReaderResult(json, 2)` が null → reader_failed の ask（attention。clean にならない。`{v:1, findings:[]}` だけでは learning 欠落で現行でも null になるので弁別にならない — Astra R2））、library（v1 + v2）、review-preview（v1 と v2 の版・missing の表示）
- 観測: reader のログ行に `schema`・`included` 件数、取り込みのログに `schema_version` と child_text の kind 別件数。§9 の投影 SQL は `json_extract(reader_json,'$.v')` も引く
- fixture: `test/fixtures/_shared-v2/outputs/`（good）・`_shared-v2-bad/outputs/`（bad: 本文 1300 cp・「今日は〜について学ぼう」で始まる・summary に目標語・q1 → c9 不在・questions 1 件の part）。fake scenario `done-v2`。`sync-claude-assets.sh` で fixtures.generated.ts 再生成
- smoke: `done-v2` を 1 本足し、`/api/library/available` の `body_url` と `parts/p1/body.md` の 200 を数える（v1 の直書きは残す）
- 実機（着地後）: `ant apply` → 注文 1 本（scripts/order.sh）→ cron → `wrangler d1 execute --remote` の投影 SQL（schema_version・reader_status・quality の 4 キー・child_text の fix 件数・body_chars・session cents だけ）→ `GET /api/review/:id` → 承認 → `GET /api/library/available` に body_url。done の証拠 = これらの値の引用 + cents が v1 の実測（$6〜8）より低い
- 観測: `checks_json.body_chars`、reader のログ行に schema、`cost_ledger kind='session'` を `json_extract(material_json,'$.schema_version')` で group

## 10. Rollback（順序が肝。Astra R1 ③）
0. settings `auto_publish=0`・`paused=1`（偽緑の自動公開と cron の進行を先に止める）
0b. **配信中の schema 2 の版を先に解消する**: 投影 SQL（`materials.publish_status='available'` かつ current 版の `json_extract(material_json,'$.schema_version')=2`）で素材を列挙し、素材ごとに (a) 前の approved な schema 1 の版があれば `rollback` decision（publish.ts の P_ROLLBACK は「同素材の approved 版で現在の版でない」を要求）(b) 無ければ `publishSwitch stop`（配信停止）。review 中の schema 2 の版は人が reject
1. `ant apply` 前の claude-lock（v2 出力を止める）
2. `deploy-ref.sh <prev>`
3. 残る不整合: v2 row の reader_json / checks_json の余分なキー（無害）。進行中の v2 session は invalid_outputs → roll-forward 後に job_reingest。停止した素材は roll-forward 後に `publishSwitch start`

## 11. Open questions
- session が agent の版を create 時に固定するか（公式 docs 未確認。§6-7 の `paused` + precheck 0 件で窓を閉じるので、どちらでも有界）
- rollback の手順 1（前の claude-lock で `ant apply`）は ant のログインが要る。通らない間は v1 Worker で新しい注文が `invalid_outputs` になる → その間は `paused=1` のまま（ふじさん TODO として明記）
- `triageStep` は `paused` を見ない（triage-step.ts:258-290）→ rollback 手順 0 の後も poisoned row の auto_return が rework job を queued で作りうるが、startJob が paused で止まるので動かない（許容。roll-forward 後に消化される）
- 本番 D1 の schema 1 の版の件数（投影 SQL で数える。作り直しの順番はふじさんと）
- 確認画面が未知の cause を描けるか（§AK 後の T6 で確認。描けないなら T6 を先に）

## 12. Human approval needed
- deploy・ant apply（deploy は AI 自走の既定。ant apply はログインが通れば AI、通らなければふじさん）
- 既存素材の作り直し（1 件 ≈ $10。順番）

## 13. Task breakdown（Opus 実装。司令塔 = factory/claude/*・契約・admin.js の指揮）
| # | Task | Depends on | Parallel? | Verification |
|---|---|---|---|---|
| T0 | 契約 §(新節) + 既存節への優先宣言 + READER_SYSTEM_V2・ITEM_TITLE 文・目標語一覧（司令塔） | — | — | Astra レビュー |
| T1 | `shape.ts` 新規 + schema.ts 両受け（v2 型・variants 拒否・computePublicPaths）+ layout + helpers の v2 builder + good/bad v2 fixture + sync | T0 | — | schema/layout test 緑・v1 不変・tsc |
| T2 | childtext 新 kind 5 + body_chars + forbidden summary + jobs 配線 + triage の分岐・ITEM_TITLE・RETURN_NOTE 版分岐 + 網羅テスト | T1 | T4 と並列 | bad fixture FAIL→PASS・triage 緑 |
| T3 | reader v2（入力・SYSTEM_V2・SCHEMA_V2・no_text 守り・schema 2 は `v:2` と quality 必須）+ triage の quality 項目 + routes/review.ts の `readReaderResult` 呼出に版を渡し quality を画面へ返す + reader.test | T2 | — | reader.test 緑・v1 入力 byte 同一・空入力で未呼出・完全な v1 結果を v2 row に与えて reader_failed |
| T4 | library v2 応答 + verify summary 行 + fake `done-v2` + smoke 1 本 | T1 | T2 と並列 | smoke verdict・library JSON |
| T5 | admin.js: v2 preview（切替なし・`data-mode="js"`・spark と問いの種を「子どもには見えない」枠で表示）・READER_KEYS・locateItem 文・付箋の variant_path → body path + review-preview test（**実機承認の前提。Astra R1 ①**） | T1（型）| T2〜T4 と並列（admin.js は他タスクが触らない） | review-preview 緑・幅 1440/1024/390 の撮影（v1 と v2 の版） |
| T6 | 着地: origin/main を取り込み再検証 → `git push origin HEAD:main` → **§6-7 の順（precheck → 完走/取消 → `paused=1` → 再検査 0 件 → deploy-ref → ant apply → `paused=0`）** → 実 session 1 本 → 確認画面で本文・spark・問いの種が見える → probe → §AK の担当セッションへ「着地 <commit>」を送る（PR-AK2 が rebase する） | T1–T5 | 直列 | §9 実機の証拠 + 確認画面の撮影 |
