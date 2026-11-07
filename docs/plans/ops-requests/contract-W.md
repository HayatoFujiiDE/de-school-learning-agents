# §W 運用の依頼箱（ops_requests。2026-11-07 凍結）

ふじさん（2026-11-07）: 「押してくれ。俺の許可ないと進められないのでめんどくさいからそっちでできるようにして。時間もったいない」。

## 目的

管理画面の「今すぐ作る」は Cloudflare Access のログインが要り、Claude（司令塔）には無い。Claude の手元は `wrangler d1 execute factory --remote` で本番の D1 に書ける。D1 に依頼を 1 行置き、cron が拾って手動と同じ経路で始める。

## 範囲

- できるのは **お題の run だけ**（`kind = 'topic_run'`）。payload は `{ purpose: 'gen', kind }`（kind は news / talk / philo / make）か `{ purpose: 'derive', kind: 'refresh'|'extend', parent_id, note? }`（note は 200 字まで・親は topics に在る）。それ以外の形・余計な項目は `failed`・result `{ error: 'bad_payload' }`。
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
