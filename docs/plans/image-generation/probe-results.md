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
