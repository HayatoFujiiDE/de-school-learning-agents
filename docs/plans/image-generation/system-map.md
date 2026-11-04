# System map（MAP 2 lenses の統合。factory/worker 相対）

## 実行環境の事実
- waitUntil は応答後 30 秒まで（webhook / 管理画面 reconcile は 25 秒で打ち切り）。cron（*/10）は 1 回最長 15 分
- Queues: consumer 1 回の wall time 最長 15 分、CPU 既定 30 秒（limits.cpu_ms で 5 分まで）、max_retries 既定 3（上限 100）、DLQ なしなら上限到達で削除、at-least-once（重複配信あり、message id で冪等化を推奨）
- Workflows: step の wall 時間は無制限、step 既定 retries {limit 5, delay 10s, exponential}・timeout 10 分/試行、NonRetryableError で即失敗、`env.WF.create({id, params})`、step output 1 MiB 上限。id 再利用時の挙動は公式に記載なし
- OpenAI Images（gpt-image-2.5-flare / -sunburst、料金同一: text in $5 / image in $8 / image out $30 per 1M）: 最大 2 分、b64_json、`usage`（input/output tokens）は reference の例に出るが schema 文言は gpt-image-1 のみと書く（食い違い）。v1/images/edits で描き直し可。組織の本人確認が要る場合あり
- Managed Agents custom tool: 定義 `{type:"custom", name, description, input_schema}`（ant apply の frontmatter での書き方の例は未確認）。`agent.custom_tool_use` で session は idle + requires_action（stop_reason.event_ids に id）。返答 `user.custom_tool_result {custom_tool_use_id, content?: (Text|Image|Document|SearchResult)[], is_error?}`、受信時に処理。Image block の source は base64 / url / file {file_id}。保留中の custom tool の締め切りは記載なし。requires_action 中は user.message 400。idle 時間は課金されない見込み（active_seconds 課金。明記はなし）

## 現行コードの該当箇所
- src/jobs.ts: reconcile の lease :821-831（LEASE_MS 120s）、extend() :892-899、onIdle 走査 :1043-1066 は最新 status_idle の stop_reason.type と event_ids だけ保持（event 本体・name を見ない）、deny 分岐 :1072-1093（送信 → CAS の順で、lease 喪失時に二重送信の余地あり。denied_event_ids_json / deny_count、>8 で too_many_denies）、outcome 分岐 :1100-1114、parts/ を全部 TextDecoder で decode :1343
- src/checks/schema.ts: PART_FILE_EXTENSIONS ['.md','.svg','.html'] :23、MAX_FILE_BYTES 2MiB :5、computePublicPaths は拡張子で絞らない :309-316、contentDigestInput はバイト安全 :319
- src/checks/forbidden.ts :66-99 は decode 済みテキストに検査
- src/verify.ts :116 listPartPaths は /\.(md|html|svg)$/、:144 o.text()
- src/routes/library.ts :18-25 contentHeaders は .md/.json/.html/.svg のみ（他は 404 :39）、review.ts :153 が同じ関数
- public/admin/admin.js :668-672 は .svg だけ <img>
- src/fake/anthropic.ts :197-209 fixture は文字列のみ（バイナリ不可）、sendEvents は記録のみ、after[type] で状態を進める
- cost: cost_ledger.kind CHECK ('session','verify','scout','meeting')（0002 で rebuild）、src/ledger.ts capCheck（読んでから判定・非原子）、monthCostCents、recordCost の INSERT…SELECT…WHERE EXISTS(P) + conditionalBatch（jobs.ts:960-987）、claimSetting は一回きりの値 claim（counter ではない）
- port（src/anthropic.ts:62-83）に upload は無い。sendEvents は任意の event param を送れる。SDK に client.files.upload
- 契約: §B-4-d 手順 4（requires_action → deny）、smoke (h)「同じ fixture を再度 reconcile しても二重送信しない」
