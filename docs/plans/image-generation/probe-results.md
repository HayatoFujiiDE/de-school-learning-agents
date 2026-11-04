# 本番プローブ p2〜p4 の結果（2026-11-05 未明、本番 Worker dbb65a0a の一時 route `/api/probe/image-tool` から）

実行方法: Access 内の一時 route（c852a2f）で、custom tool `generate_image` だけを持つ使い捨ての agent（claude-haiku-5-5、metadata.probe=image-tool）と session（budget 50 = $0.50、FACTORY_ENV_ID）を作り、管理画面のタブから順に叩いた。最後に session と agent を archive 済み。

| probe | 確かめたこと | 結果 |
|---|---|---|
| p2 | custom tool（type custom / name / description / input_schema）を持つ agent を API で作れるか | **可**。`agents.create` が 200、agent.tools に `generate_image` |
| p3 | `agent.custom_tool_use` の数分後に `user.custom_tool_result` を送って受け付けられるか | **可**。252 秒後に送って 200。session は `requires_action` から再開し、agent.message → `end_turn` まで進んだ |
| p4a | 同じ `custom_tool_use_id` へ 2 回目の result（1 回目の処理後、session は end_turn で idle） | **送信は 200 で受け付けるが無害**。events 一覧の `user.custom_tool_result` は 1 件のまま、session は idle（end_turn）のまま。新しい turn は起きない |
| p4b | session を archive した後の result | **400 invalid_request_error**「Cannot send events to archived session」。無害（何も起きない） |

events 一覧の並び（p3 の 1 回目）: session.status_running → user.message → span.model_request_start → agent.custom_tool_use(generate_image) → span.model_request_end → session.thread_status_idle → session.usage → session.status_idle(requires_action)。

## 計画への反映
- plan-v4 §2「通知の応答不明 → 照合で見つからなくても再送は、p4 で二重送信が無害と確かめた場合だけ 1 回」: **無害を確認**（拒否はされないが、2 通目は記録も turn も起こさない）。よって unknown → 照合で見つからない時の 1 回の再送は可
- 長時間の生成（数十秒〜数分）の結果を後から返す設計（Queue / cron で生成 → result 送信）は成立する（p3）
- 未確認: requires_action のまま何分まで待てるか（今回は 4 分）。p1（OpenAI gpt-image の usage・時間）は別途

# p1: OpenAI 画像 1 枚の所要時間と usage（2026-11-05 未明、本番 Worker 387899e1 の一時 route `step=image`、b64_json・n=1・png）

prompt は全件同じ（マイクラ風レッドストーン回路の図、英語 1 文。input 43 token）。費用は「text 入力 $5 / 画像出力 $30 per 1M token」での見積り（切り上げ）。

| model | quality | size | 秒 | output token | 見積り |
|---|---|---|---|---|---|
| flare | low | 1024x1024 | 13.8 | 196 | 1¢ |
| flare | high | 1024x1024 | 23.8 | 1,756 | 6¢ |
| flare | max | 1024x1024 | 59.3 | 7,024 | 22¢ |
| flare | high | 1536x1024 | 19.8 | 1,372 | 5¢ |
| sunburst | high | 1024x1024 | 37.0 | 1,756 | 6¢ |
| sunburst | max | 1536x1024 | 82.7 | 5,488 | 17¢ |

合計の見積り 57¢（上限 $3 内）。画像は 1.0〜1.5 MB の PNG。usage は output_tokens_details に image_tokens / text_tokens が分かれて返る（text は 0）。

## 計画への反映（U の表）
- 実測の最大 × 1.5: 1024 max = 7,024 → 10,536 token ≒ 32¢、1536 max = 5,488 → 8,232 ≒ 25¢。公式表が無い max は実測で置く。**U（1 枚の予約）は quality max なら 35¢、high 以下なら 10¢** を初期値にする（入力 4,000 token 上限 = 2¢ を含めて切り上げ）
- 所要時間は最長 83 秒。生成は waitUntil（25 秒）に収まらないので、Queue consumer か cron で実行する計画 v6 の前提どおり
- sunburst と flare は同じ token 数で、sunburst は約 1.5〜1.6 倍遅い
- 未確認: xhigh、1024x1536、画像入力つき（edits）
