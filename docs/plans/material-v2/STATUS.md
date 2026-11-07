# §AL 素材の形 v2 — 進行状況（司令塔のメモ。コンパクション後の再開点）

更新: 2026-11-08 未明

## 今どこ
- 作業場: `/Users/hayatofujii/Coding/DESystem/Learning-Agents/.worktrees/material-v2`（branch `material-v2`、origin/main 90ab9fe 起点）。HEAD = **620968d**（T0: 契約 §AL・職人定義 v2・採点表 v2・編集基準 v2・計画・タスク仕様）
- `factory/worker/node_modules` は main checkout への symlink（gitignore に掛からない）→ **`git add -A` 禁止・明示 stage**
- 基準テスト（T0 後）: vitest 91 files / 2568 passed（採点表の番号固定テスト 2 件を 13→19・17→23 に更新済み）
- **T1 着地済み**: commit **442e1f3**（shape.ts・schema 両受け・layout・fixture _shared-v2 / _shared-v2-bad・helpers `goodMaterialV2` / `goodFilesV2` / `outputsFixture`）。司令塔の実測: vitest 92 files / 2608 passed、typecheck rc=0。docs は 72de608
- **T5 着地済み**: commit **c5a12ae**（admin.js / admin.css / review-preview.test.ts。preview テスト 134 passed、node --check rc=0）。画面は `GET /api/review/:id` の `reader.quality` を読む（T3 が同じキー名で応答に足す）
- **T4 着地済み**: commit **c18db16**（library.ts / verify.ts / done-v2 / smoke.mjs / library-v2.test.ts。library-v2 5 passed、typecheck rc=0）。smoke の AL-9 の 5 行は PASS。**smoke の既存 FAIL 8 行**（(n2) floor stations が 8 キー・(r) Batch 件数・(i10) 月の上限・(t2)(t7)(t8)(t9)(t11) お題）は T4 の対照でも同じ → このレーンの変更ではない（origin/main 単体では未実行＝未弁別。follow-up として報告する）
- **司令塔の追加タスク T4b（T2 着地後・T3 と並行可）**: 自動 security review の指摘（verify.ts）。schema 2 の `questions_for_kids[].text` / `interest_entries[].text` は配信 API でバディに渡るのに、検証係の `<child_texts>`（`childTextsBlocks`）と禁止語の検査（`checkForbidden`。FORBIDDEN_WORDS = 点数・ランキング・順位・評価・成績・レベル…）が見ていない。T2 が goal_word 用に作る子ども向けフィールドの列挙を再利用して、両方に通す（verify.ts に行を足す・forbidden.ts の targets に `material.json#parts[i].questions_for_kids[j].text` 等を足す・jobs.ts の呼出で渡す）。テスト: verify-evidence-v / forbidden。別 commit。Astra レビューの保証に G8 として足す
- **T2 着地済み**: commit **9fb8593**（goalwords / childtext v2 / forbidden summary / jobs 配線 / triage 分岐 + ITEM_TITLE 9 件 + RETURN_NOTE_TEXT_V2。司令塔の実測: vitest 94 files / 2664 passed、typecheck rc=0）
- **T4b 着地済み**: commit **9cc6204**（shape.ts `buddyTextsOf` / forbidden.ts `buddy_texts` / childtext.ts file_name の meta / verify.ts の行 / jobs.ts の呼出。4 files / 151 passed、全体 94 / 2672、typecheck rc=0）
- **T3 着地済み**: commit **e25b30d**（reader.ts v2 / triage.ts readReaderResult(raw, schema) + quality 項目 / routes/review.ts の reader.quality / fake/anthropic.ts。司令塔の実測: vitest 94 files / 2692 passed、typecheck rc=0、READER_SYSTEM_V2 は契約と機械照合で一致）
- **実装は全部着地（HEAD e25b30d）**。smoke: AL-9 の 5 行 PASS（PASS 156 / FAIL 8）。**FAIL 8 行（n2 / r / i10 / t2 / t7 / t8 / t9 / t11）は origin/main 90ab9fe 単体の一時作業場でも同じ id で FAIL → 弁別済み: main の既存のずれ**（follow-up として報告。一時作業場は削除済み）
- **Astra R1（medium、2026-11-08）: REVISE** → CONFIRMED 3 件を修正して **8f400ae** で着地（①問いの claim_ids の不在 id → `missing_claim_refs`（契約 :58）②schema 2 の title / entry_point.text / videos.why も禁止語へ（`childMetaTextsOf`）③goalwords lock test を原本 fs 読みに（契約 :87））。司令塔の実測: vitest 94 files / 2701 passed、typecheck rc=0。不採用 1 件: schema 1 の `buildReaderInput` の返り値の内部キー（model に送る文・DB は不変）。NON-BLOCKING: G6 の文言は契約 AL-6 が正
- **Astra R2（medium）: GO**（BLOCKING / NON-BLOCKING なし。F1〜F4 反証失敗）。HEAD 8f400ae の smoke: AL-9 5 行 PASS・FAIL は main 由来の 8 行のみ。レビュー予算の 2 往復を消化
- **着地（2026-11-08）**: main に push（1028b6f）→ 質問待ちの注文 1 件はふじさんが取消（前提が変わったので廃止）→ precheck `[]` → `paused=1` → 再検査 `[]` → `deploy-ref.sh 1028b6f`（Worker Version ID **e6d4cb7e-f124-4a2a-aec4-83390fb65d7d**、migration なし）→ `ant apply --yes`（material-maker v15 → **v16**。lock の commit 23dfd8f を push 済み）→ `paused=0`
- **作り直しの引き継ぎ TODO（ふじさんと順番を決める）**: 赤血球（material 0bbb62ca、rework job 4c635d44 はふじさんが取消）のふじさんの差し戻し文（2026-11-07 13:05 UTC: 図を立体に・「指でなぞろう」のコメントが謎・仮説を書かず事実だけ）は、この素材の v2 の material_redo の注文票に入れる。mc-redstone-basics の注文票には 13:04 UTC の差し戻し文（ダスト等の見た目を本物に寄せる）を追記済み（6da3fbf）
- **実 session 1 本**: 既存素材 `mc-redstone-basics`（material 56c7c85f-51b2-4d91-8797-07073060cae3、review の版を却下して draft）を依頼箱 `material_redo` で注文（依頼 0db67a54-9fba-47a7-bbe6-ab15d6a95538、注文票は `docs/plans/minecraft-facts/briefs/mc-redstone-basics.md` を v2 の形に書き直した）。**完走（2026-11-07 17:30 UTC）**: job 88446931 → 版 **287f5782-8816-4194-bad5-9907e9e1d24c**（v7、review）。probe: schema 2・body + play・問いの種 5・入口 3・芯あり・child_text 0・forbidden 0・missing_claim_refs 0・本文 658 字・読み手 done（v:2、quality = 最初の段落 ok / 問いが先 ok / 1 段落 1 つ **problem** / 目標語 ok、指摘 9 件）・検証 done・仕分けは cron 待ち・費用 session 378¢ + 読み手 10¢（v1 の実測 600〜800¢ より低い）。確認画面は v2 の形（切替なし・本文 1 枠・バディ用の枠・quality の指摘が並ぶ）で撮影済み（`~/Desktop/agent-deliverables/2026-11-08-material-v2/`。狭い幅は Chrome 拡張の切断で schema 1 のみ）。配信 API は承認後に確認（`materials: []` のまま）。並走 2 セッション（3Dモデル・教材FB）と「モック完全再現」（実サイト。配信 API を読むだけ・重なり無し）へ連絡済み
- origin/main は 90ab9fe のまま（2026-11-08 fetch。HEAD は 7 ahead・衝突なし）。push 前にもう一度 fetch
- **着地の precheck 早見（2026-11-08）**: 質問待ち（needs_answer / questions）の注文が **1 件**（job `4c635d44-b756-4609-ad3f-15b546353b67`、2026-11-07T13:05Z に質問）。停止（paused=1）の前にふじさんが管理画面で回答して完走させる（schema 1 で取り込まれる）か取り消す → ふじさん TODO。`ant` CLI は `/opt/homebrew/bin/ant` にある（ログイン状態は ant apply 時に判明）
- Astra は計画レビューで 2 往復使った（memory の予算どおり）。残りは**コードレビュー**（diff 確定後に medium 1 本、難所があれば high）

## 次にやること（順番）
1. ~~T1 の検証・commit~~（442e1f3）
2. ~~T2・T4・T5 を並列起動~~（実行中。仕様 `tasks/T2-childtext-triage.md` / `T4-library-fake-smoke.md` / `T5-admin-preview.md`。T4 の smoke は T3 着地後に走らせる）
3. T2 着地・commit の後に **T3（opus-impl-high）**（`tasks/T3-reader.md`。triage.ts を T2 と共有するので直列）
4. 全部緑 → 司令塔が load-bearing diff（schema.ts の分岐・reader の v/quality 必須・triage の分岐・RETURN_NOTE）を直読 → Astra コードレビュー（`codex exec --sandbox read-only -C <worktree> -m gpt-6-astra -c model_reasoning_effort='"medium"' - < prompt`。prompt は先に `~/Coding/agents-claude-md-setting/scripts/prompt-guarantee-lint.sh` を通す）→ CONFIRMED は元の担当へ差し戻し
5. `git fetch origin && git merge origin/main` → 再検証 → `git push origin HEAD:main`
6. 着地は `landing.md` の手順どおり（precheck → 完走/取消 → `paused=1` → 再検査 → `deploy-ref.sh <SHA>` → `ant apply`（claude-lock を commit・push）→ `paused=0` → 実 session 1 本 → probe SQL → 確認画面の撮影 → 配信 API）
7. 後始末: 「3Dモデルなどの取り扱い」セッション（`uds:/tmp/cc-socks/8998.sock`）へ「§AL 着地 <commit>」を送る（PR-AK2 が rebase する約束）。「教材FB＋教材作成UI/UX改善」（`uds:/tmp/cc-socks/41249.sock`）は着地後の HEAD から確認画面の UI/UX に入る。worktree remove・branch 削除・memory 更新・ふじさんへ報告（既存素材の作り直しは依頼箱 material_redo で順番をふじさんと決める）

## 正本
契約 `contract-AL.md` / 計画 `plan-v1.md`（v2）/ システムマップ `system-map.md`（file:line は ced174f 時点）/ 文脈 `align.md` / タスク仕様 `tasks/` / 着地 `landing.md` / memory `~/.claude/projects/-Users-hayatofujii-Coding-DESystem-Learning-Agents/memory/project-material-v2.md`
