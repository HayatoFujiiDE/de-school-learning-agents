# §W 運用の依頼箱（ops_requests。2026-11-07 凍結）

ふじさん（2026-11-07）: 「押してくれ。俺の許可ないと進められないのでめんどくさいからそっちでできるようにして。時間もったいない」。

## 目的

管理画面の「今すぐ作る」は Cloudflare Access のログインが要り、Claude（司令塔）には無い。Claude の手元は `wrangler d1 execute factory --remote` で本番の D1 に書ける。D1 に依頼を 1 行置き、cron が拾って手動と同じ経路で始める。

## 範囲

- できるのは **お題の run**（`kind = 'topic_run'`）と、§W-2 の取り込み直し・§W-3 の検証し直し（どちらも route と同じ述語で状態を戻すだけ。新しい権限は増えない）。お題の run のpayload は `{ purpose: 'gen', kind }`（kind は news / talk / philo / make）か `{ purpose: 'derive', kind: 'refresh'|'extend', parent_id, note? }`（note は 200 字まで・親は topics に在る）。それ以外の形・余計な項目は `failed`・result `{ error: 'bad_payload' }`。
- 素材の注文・承認・公開・設定は扱わない。画面は変えない。管理画面の route（`POST /api/topics/runs`・`/derive`）の応答（202 / 409 / 503）は変えない。

## 権限の考え方

- 新しい鍵は作らない。D1 に書ける人（Cloudflare のログイン）は既に工場を全部動かせるので、依頼箱を D1 に置いても権限は広がらない。
- payload は信用しない（cron の `src/ops.ts` が形を確かめる）。ログと result に payload の中身（note）は出さない。

## 流れと上限

1. 表 `ops_requests`（migration 0010）。status は pending → taken → done / failed、または pending → expired。
2. cron（10 分ごと）のお題の段の直前に `opsTick` を 1 回: 作られて 60 分を超えた pending を expired（CAS）→ pending を古い順に **1 件だけ** CAS で taken → 形を確かめて `queueTopicRun`（`src/topics/queue-run.ts`。route と共有）。
3. `trigger = 'manual'`・生成の slotDay は明日（手動と同じ）。台帳の取り置き・日と月の上限・run_in_progress は手動と同じ経路を通るので、外部費用の上限は増えない。
4. 結果: 送れたら done・result `{ run_id, status: 'queued' }`。取れなければ failed・`{ not_taken: <reason> }`（reserveTopicRun の理由そのまま）。queue に送れなければ run の行と取り置きを取り消して failed・`{ error: 'queue_unavailable' }`。
5. ログ: `{ at: 'ops_request', id, kind, status, run_id? }`（失効は `{ at: 'ops_request', status: 'expired', count }`）。

## 手元の道具

`factory/worker/scripts/ops-request.sh topic <news|talk|philo|make> [--wait]`。kind を許可の一覧と照合してから 1 行 INSERT（id は uuid）。`--wait` は 30 秒ごとに依頼と run の status・error・made・cents だけを読み、run が閉じるか 20 分で止まる。wrangler の出力は一時ファイルへ落とす。

## §W-2 取り込み直し（2026-11-07 追加）

- kind `job_reingest`、payload `{ job_id }`（uuid の形だけ。余計な項目は bad_payload）。migration 0011 で CHECK を広げた（表を作り直して行を写す）。
- opsTick は route の `POST /api/jobs/:id/reingest` と同じ `claimReingest` を呼ぶ（invalid_outputs の failed・素材が待機・同じ素材の最新の job、の述語も同じ）。failed → running に戻すだけで、取り込みは次の cron の reconcile が行う。session は作らず、費用は掛からない。
- 断られた時は failed で、result に `{ refused: <コード> }`。
- 道具: `scripts/ops-request.sh reingest <job_id>`。
- 理由: §S-8 の取り込みの不具合で failed になった作り直し 2 件（出力は session に残っている）を、作り直しをやり直さずに取り戻すため。

## §W-3 検証し直し（2026-11-07 追加）

- kind `version_reverify`、payload `{ version_id }`（uuid の形だけ。余計な項目・形違いは bad_payload）。migration 0012 で CHECK を広げた（表を作り直して行を写す）。
- opsTick は route の `POST /api/review/:version_id/reverify` と同じ `claimReverify`（`src/reverify.ts`。route と共有）を呼ぶ（review の版・検証が done / failed の時だけ pending に戻す、の述語も同じ）。attempts を 0 に、verify_* と triaged_verification_id を初期化するだけで、検証は次の cron の検証の段が行う。成功は done で、result に `{ version_id, verification_status: 'pending' }`。
- 断られた時は failed で、result に `{ refused: <コード> }`（`not_found` / `not_in_review` / `verification_running` / `conflict`）。
- 道具: `scripts/ops-request.sh reverify <version_id>`。
- 理由: §S-8-3 の画像の使い回しで検証が part_missing になった版 2 件を、直した後に人の操作なしで検証し直すため。
- 費用と有限化: 依頼 1 件で検証係が 1 回ぶん走り直す（route の再検証と同じ。§W-2 と違い外部費用が掛かる）。上限は version ごとの検証の試行回数（verifyMaxAttempts）・1 回の検証の費用の上限（verify_cost_cap）・1 tick 1 件・60 分で失効、で押さえる。依頼の日次の上限は設けない（運用者だけが書ける）。

## §W-4 工夫をやめる（2026-11-07 追加）

- kind `tip_retire`、payload `{ tip_id, reason }`。tip_id は uuid の形だけ、reason は理由コード `factory_fault`（工場の不具合で起きた失敗から出た工夫）だけ。自由文・余計な項目・形違いは bad_payload。migration 0013 で CHECK を広げた（表を作り直して行を写す）。
- opsTick は `retro_tips` の **decided_by = 'auto' かつ status = 'active'** の行だけを CAS で `retired` にし、`retire_reason = 'ops:<reason>'`・retired_at を書く。人が入れた工夫（decided_by = 'human'）は止めない（管理画面の「やめる」だけ）。成功は done で、result に `{ tip_id, status: 'retired' }`。
- 断られた時は failed で、result に `{ refused: <コード> }`（`not_found` / `not_active` / `not_auto`）。
- 管理画面の「改善係の記録」の「やめた」の理由は「工場の不具合で起きた失敗から出た工夫だったので、司令塔がやめました」と出る。
- 道具: `scripts/ops-request.sh tip-retire <tip_id>`（理由は factory_fault 固定）。
- 理由: §S-8 の取り込みの不具合（7bfa689 で修正）で failed になった 2 件を改善係が職人の失敗と読み、工夫が 2 つ自動で入った。本番の記録を直接書き換える操作は許可の判定で止まるため、オーナーの承認（2026-11-07「A」）で依頼箱に足した。§S v2 D 2（自動でやめない）は改善係の LLM の判断の話で、本節は司令塔が原因を確かめた上で止める経路。
- 費用: 外部費用なし（D1 の 1 行の更新だけ）。1 tick 1 件・60 分で失効。

## §W-5 作り直し（material_redo。2026-11-07 追加。正本は `docs/plans/minecraft-facts/contract-MC.md` §MC-4）

- kind `material_redo`、payload `{ material_id, brief_md }`（uuid の形・brief は 1〜32768 文字。余計な項目は bad_payload）。migration 0014 で CHECK を広げた。
- review の版を route の reject と同じ `buildReject`（reviewer_email `system:ops-redo`・machine_gate は `computeTriage` の gate）で却下し、idle なら `queueJobForMaterial` で draft を 1 件 queue。queued / making は却下せず `{ refused: 'material_busy' }` で done。失敗の表は §MC-4 3。
- 道具: `scripts/ops-request.sh redo <material_id> <注文票.md> [--wait]`（注文票の中身は画面・ログ・result に出さない）。費用は draft 1 件分（job の予算と日次の上限は通常の注文と同じ）。

