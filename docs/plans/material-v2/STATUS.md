# §AL 素材の形 v2 — 進行状況（司令塔のメモ。コンパクション後の再開点）

更新: 2026-11-08 未明

## 今どこ
- 作業場: `/Users/hayatofujii/Coding/DESystem/Learning-Agents/.worktrees/material-v2`（branch `material-v2`、origin/main 90ab9fe 起点）。HEAD = **620968d**（T0: 契約 §AL・職人定義 v2・採点表 v2・編集基準 v2・計画・タスク仕様）
- `factory/worker/node_modules` は main checkout への symlink（gitignore に掛からない）→ **`git add -A` 禁止・明示 stage**
- 基準テスト（T0 後）: vitest 91 files / 2568 passed（採点表の番号固定テスト 2 件を 13→19・17→23 に更新済み）
- **T1（opus-impl-high）を起動済み・実行中**: 仕様 `tasks/T1-schema.md`（shape.ts 新規・schema.ts 両受け・layout・v2 fixture good/bad・helpers v2 builder・schema/layout test）。完了通知が来たら: `git status` / diff で変更の出現を確かめる → 自分で `npx vitest run` と `npm run typecheck` を実行して verdict を取る → T1 を commit（明示 stage）
- Astra は計画レビューで 2 往復使った（memory の予算どおり）。残りは**コードレビュー**（diff 確定後に medium 1 本、難所があれば high）

## 次にやること（順番）
1. T1 の検証・commit
2. **T2（opus-impl-high）・T4（opus-impl-medium）・T5（opus-impl-medium）を並列起動**（仕様 `tasks/T2-childtext-triage.md` / `T4-library-fake-smoke.md` / `T5-admin-preview.md`。ファイル所有は素。T4 の smoke は T3 着地後に走らせる）
3. T2 着地・commit の後に **T3（opus-impl-high）**（`tasks/T3-reader.md`。triage.ts を T2 と共有するので直列）
4. 全部緑 → 司令塔が load-bearing diff（schema.ts の分岐・reader の v/quality 必須・triage の分岐・RETURN_NOTE）を直読 → Astra コードレビュー（`codex exec --sandbox read-only -C <worktree> -m gpt-6-astra -c model_reasoning_effort='"medium"' - < prompt`。prompt は先に `~/Coding/agents-claude-md-setting/scripts/prompt-guarantee-lint.sh` を通す）→ CONFIRMED は元の担当へ差し戻し
5. `git fetch origin && git merge origin/main` → 再検証 → `git push origin HEAD:main`
6. 着地は `landing.md` の手順どおり（precheck → 完走/取消 → `paused=1` → 再検査 → `deploy-ref.sh <SHA>` → `ant apply`（claude-lock を commit・push）→ `paused=0` → 実 session 1 本 → probe SQL → 確認画面の撮影 → 配信 API）
7. 後始末: 「3Dモデルなどの取り扱い」セッション（`uds:/tmp/cc-socks/8998.sock`）へ「§AL 着地 <commit>」を送る（PR-AK2 が rebase する約束）。「教材FB＋教材作成UI/UX改善」（`uds:/tmp/cc-socks/41249.sock`）は着地後の HEAD から確認画面の UI/UX に入る。worktree remove・branch 削除・memory 更新・ふじさんへ報告（既存素材の作り直しは依頼箱 material_redo で順番をふじさんと決める）

## 正本
契約 `contract-AL.md` / 計画 `plan-v1.md`（v2）/ システムマップ `system-map.md`（file:line は ced174f 時点）/ 文脈 `align.md` / タスク仕様 `tasks/` / 着地 `landing.md` / memory `~/.claude/projects/-Users-hayatofujii-Coding-DESystem-Learning-Agents/memory/project-material-v2.md`
