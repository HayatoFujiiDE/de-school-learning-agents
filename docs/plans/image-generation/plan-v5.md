# 計画 v5: 職人が画像を生成できるようにする（v4 への Astra high 4 回目の REVISE を反映。v5 が v4 以下の本文に優先する。最終の状態表は §5-2 が正本）

状態（2026-11-04 夜）: v5 は未レビュー。migration 番号は確認画面の改修（契約 §L、0003）に譲り、画像は **0004**。

## v5 の変更（v4 レビュー → 対応）

- **B1 画像を続けられる job の数を永続の枠で厳密にする**: 新テーブル `image_job_slots(job_id PRIMARY KEY, acquired_at TEXT NOT NULL, released_at TEXT)`。job が**最初の画像を予約する batch の 1 文目**で枠を取る:
  `INSERT INTO image_job_slots(job_id, acquired_at) SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM image_job_slots WHERE job_id = ?) AND (SELECT COUNT(*) FROM image_job_slots WHERE released_at IS NULL) < 2 AND (月の image 記帳合計) + U_max ≤ 3000`
  2 文目以降（attempt の INSERT と U の記帳）は `EXISTS (SELECT 1 FROM image_job_slots WHERE job_id = ? AND released_at IS NULL)` を述語に持つ。D1 の batch は 1 トランザクションで直列に実行されるので、数えてから入れるまでの間に他の job が割り込めない。既存の `startJob` の同時数（目安）には頼らない。`budget_reached` の job も枠を持ったまま数える
  - 枠の解放: job が終端（done / failed / cancelled）かつ、その job の attempt に `reserved` / `dispatched` / `unknown` が 0 の時だけ、cron が `released_at` を書く
  - 枠が取れない（他の 2 job が使用中、または月の上限）: 予約しない。request は `refused`（`error='image_slot_unavailable'` か `'monthly_cap'`）、通知は is_error「今は画像を作れません。SVG で描いてください」
  - 保証の言い直し（G3'）: 月の記帳の超過は、月の上限に届いた時点で枠を持っていた job（最大 2）の残り試行（最大 7）× U_max まで。U_max は許可した組み合わせの表の最大値（25¢ なら $3.50）
- **B2 未確定の試行の枠は dispatch の 1 文で取る**: dispatch CAS を 1 文にする:
  `UPDATE image_attempts SET state = 'dispatched', dispatched_at = ? WHERE id = ? AND state = 'reserved' AND dispatch_token = ? AND (SELECT COUNT(*) FROM image_attempts WHERE state IN ('dispatched','unknown')) < 2 AND (SELECT value FROM settings WHERE key = 'image_gen_halted') IS NULL`
  0 行なら OpenAI を呼ばない（reserved のまま。queue の retry で後で再挑戦）。予約の時点では数えない（v4 の「予約時に数える」案は廃止）。枠の解放は精算の batch だけ: `UPDATE image_attempts SET state='settled', settled_cents=?, settled_at=? WHERE id=? AND state IN ('dispatched','unknown')` + 返金行 `INSERT … WHERE EXISTS (… state='settled' AND settled_at=?)`。state の述語で返金は 1 回だけ
  - `dispatched` のまま 5 分（生成の締め切り 150 秒 + 余裕）を過ぎたら cron が `unknown` + `image_gen_halted` を CAS で書く（課金されたか分からないので枠を持ち続ける）。人が OpenAI の使用量と照合して解除（U のまま精算 or 実額で精算）
  - `reserved` のまま 10 分を過ぎたもの・halted / cancel / job 終端で残った `reserved` は cron が `void`（呼んでいないので全額返金）
- **画像付きの版がある時の降格の下限（非 BLOCKING 1）**: 確認待ち・承認済みのどちらかに画像付きの版が 1 つでもあれば、Worker を段階 1 より前へ戻さない（段階 1 未満では承認の述語を通るのに配信で 404 になる）。戻す必要がある時は先に画像付きの版を全部「却下」または「配信を止める」。README と契約の rollback 節に書く
- **作業順の一本化（非 BLOCKING 2）**: §6 の表が正本。v4 の §10 は使わない
- **保証の書き方（非 BLOCKING 3）**: 実額が U を超えた分には数値の上界は無い（毎回 usage で検出して halted、超過は未確定枠 2 件分）。複数の組み合わせが混ざる時の残額計算はすべて U_max で行う
- **鍵の検査の印（coverage）**: 例外の `message`・`cause` に加えて `name`・headers・本文受信中の例外にも印を入れて、ログ・D1・R2・tool result・Files に出ないことを確かめる
- **観測**: cron のログ（数値と固定コードだけ）に `slots_held`、`attempts_reserved`、`attempts_inflight`（dispatched + unknown）、`attempts_unknown`、`oldest_unanswered_request_at`、`halted`

## §5-2 最終の状態表（正本。v1〜v4 の状態の記述はこれに置き換わる）

request（custom_tool_use 1 件）の `gen`:

| gen | 意味 | 次へ進める主体 | 期限・回収 |
|---|---|---|---|
| queued | 受け付けた（enqueue 済み or 未） | consumer | cron: 2 分超を再 enqueue（enqueue_count < 5、Queue の件数は見ない） |
| reserved | attempt を予約（U を記帳） | consumer の dispatch CAS | cron: attempt が void になったら queued（retry 枠内）か failed |
| dispatched | OpenAI を呼んだ | consumer | cron: 5 分超 → attempt unknown + halted、request は failed（`result_unknown`）で通知 |
| stored | 画像を R2 の attempt キーに保存し勝者 CAS 済み | consumer の upload | upload は request ごと 2 回（`upload_tries` を D1 に持つ）。超えたら failed（`upload_failed`） |
| uploaded | Files API の file_id を保存 | 通知 | 成功の通知はこの状態だけ |
| refused | 枠・上限・phase で断った | 通知 | — |
| failed | 失敗（理由コード） | 通知 | DLQ は `gen IN ('queued','reserved')` の時だけ failed にする（stored / uploaded を巻き戻さない） |

attempt の `state`: reserved → dispatched → settled（usage で精算、≤ U）/ unknown（人が解除して settled）/ reserved → void（呼んでいない・全額返金）。精算・void の返金はどちらも state の述語で 1 回。

`notify`: none → sending → sent / unknown（events.list を最後まで読めた時だけ「無い」と判断）/ abandoned（session terminated・job 終端）。通知の CAS は `gen IN ('uploaded','refused','failed')`。

取り込み: material.json の files[] の image_id は `gen='uploaded'`・同じ job・sha 一致・拡張子と先頭バイト一致で採る。

## §6 作業順（正本）

| # | Task | Depends on | Parallel? | Verification |
|---|---|---|---|---|
| 1 | 契約 v3.7（画像）を凍結: §5-2 の状態表・予約 / dispatch / 精算 / 解放の SQL 全文・2 段出荷・降格の下限 | 本計画 GO | — | Astra |
| 2 | 段階 1: 画像の読み取り対応 + generate_image を is_error で断る互換 | 1 | — | vitest + smoke + 実ブラウザ |
| 3 | 段階 1 を deploy | 2 | — | 実 URL |
| 4 | probe p2〜p4（custom tool の dry-run・遅れた result・二重 result） | 1 | 2 と並行 | 実出力 |
| 5 | 段階 2: migration 0004・枠・予約・openai port・fake・consumer・DLQ・通知・cron・管理画面の probe | 3・4 | — | vitest + smoke（v4 §6 + coverage 表の 8 行） |
| 6 | 段階 2 を deploy（職人定義にはまだ tool を足さない）→ 管理画面から probe p1 → U の表を下げる | 5 | — | 費用・時間の実出力 |
| 7 | 職人定義に tool と使い方の規則を足して ant apply → 実 session で 1 枚 | 6 | — | 費用・画像の実出力 |
