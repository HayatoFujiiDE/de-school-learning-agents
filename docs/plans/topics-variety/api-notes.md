# api-notes — お題の棚の管理 API（contract-T T-10 の項目名）

2026-11-06。サーバー担当が書く。契約 T-10 が決めていない項目名だけをここで決める（契約の項目は契約が正）。
管理画面（`public/admin/topics.js`）はこの形だけを頼りにしてよい。認証・Origin の検査は既存の admin API と同じ。
失敗はどれも `{ "error": "<snake_case>", "message"?: string }`。

## 共通の形

### TopicRow（一覧・詳細・操作の応答で同じ形）

```json
{
  "id": "tp_3f2c…_1",
  "kind": "news",                       // news | talk | philo | make
  "status": "held",                     // draft | checking | held | ready | rejected | retired
  "sensitivity": "heavy",               // normal | heavy
  "origin": "gen",                      // gen | derive | manual
  "hold_reason": "heavy",               // held の時だけ。それ以外は null
  "hold_group": "heavy",                // heavy | flagged | source | other | null（held の時だけ。下の表）
  "approvable": true,                   // 人が「出せるにする」を押せる時だけ true（T-3 の承認の述語の、read_all 以外の部分）
  "needs_read_all": true,               // 承認に read_all が要る（sensitivity = heavy）
  "title": "火星の月の砂を持ち帰る探査機",
  "slot_day": "2026-11-07",
  "lineage_id": "tp_3f2c…_1",
  "parent_topic_id": null,
  "derive_kind": null,                  // refresh | extend | null
  "depth": 0,
  "starred": false,
  "evergreen": false,
  "fresh_until": "2026-11-13",          // news だけ。ほかは null
  "check_attempts": 1,
  "last_checked_at": "2026-11-06T10:00:00.000Z",
  "last_shown_day": null,               // このお題が予定に入った最後の日（今日まで）。無ければ null
  "refresh_child": null,                // 終わっていない見直しの子（draft・checking・held・ready）{ "id", "status" }。無ければ null（v2.4）
  "content_sha256": "9a1b…",            // decide に送り返す値
  "created_at": "2026-11-06T09:50:00.000Z",
  "updated_at": "2026-11-06T10:00:00.000Z"
}
```

`refresh_child` が null でない親からは、次の見直しを作れない（T-9。1 つの親に終わっていない見直しの子は 1 つまで。held で止まっている子も数える）。管理画面はこの時「見直す」を出さず、止まっている子を「出さない」にするか、やり直し・承認で先へ進める文を出す。

`hold_group` の分け方:

| hold_group | hold_reason |
|---|---|
| `heavy` | `heavy` |
| `flagged` | `flagged` |
| `source` | `source_not_found` / `source_unreachable` / `source_unsupported` / `source_lost` |
| `other` | `schema` / `forbidden` / `check_failed` / `duplicate_race` |

### RunRow

```json
{
  "id": "1c9e…", "purpose": "gen", "kind": "news", "slot_day": "2026-11-07", "week": null,
  "parent_topic_id": null, "trigger": "manual", "status": "done", "error": null,
  "dropped": 0, "made": 2, "cents": 31,
  "created_at": "2026-11-06T09:48:00.000Z", "updated_at": "2026-11-06T09:50:00.000Z"
}
```

`status`: `calling` | `done` | `failed` | `skipped`。`error` は理由コード 1 つ（`cap` / `abandoned` / `timeout` / `no_output` / `no_valid_topic` / `rate_limited` / `quota` / `auth` / `bad_request` / `server` / `lost_run` など）。締め切りまでの残りが 5 秒未満の時は run の行を残さない: 取る前なら取らず、入力を読んだ後（モデルを 1 回も呼ぶ前）に 5 秒未満になったら run の行と取り置きの台帳の行を同じ batch で削除して取り消す。どちらも応答は `not_taken`・理由 `no_time` で、その日の枠を消費しない（次の定期処理がまた取れる）。検査も同じく、出典を開いた後に 5 秒未満なら取り置きを削除して draft に戻し、`check_attempts` を 1 減らす（巡の回数を消費しない）。

## ルート

### `GET /api/topics/meta`

```json
{
  "enabled": false,
  "locale": "ja-JP",
  "kinds": [
    { "kind": "news",  "label": "ニュースから",     "slots": 2 },
    { "kind": "talk",  "label": "話し合い",         "slots": 1 },
    { "kind": "philo", "label": "答えのない問い",   "slots": 1 },
    { "kind": "make",  "label": "作るの提案",       "slots": 3 }
  ],
  "statuses":      { "draft": "下書き", "checking": "確かめ中", "held": "要確認", "ready": "出せる", "rejected": "出さない", "retired": "引退" },
  "hold_reasons":  { "heavy": "重い話題", "flagged": "気になる点", "schema": "形が合わない", "...": "..." },
  "reasons":       { "source_not_found": "引用が見つからない", "flagged:one_sided": "1 つの立場に寄っている", "...": "..." },
  "flags":         { "unsourced_claim": "出典のない事実・考え", "...": "..." },
  "heavy_reasons": { "incident": "事件・事故", "...": "..." },
  "fetch_results": { "pending": "まだ開いていない", "found": "引用あり", "not_found": "引用なし", "fetch_failed": "開けない", "blocked": "開かない（規則）" },
  "decisions":     { "approve": "出せるにした", "reject": "出さない", "...": "..." }
}
```

`reasons` は検査の記録の `reasons`（`schema:<code>` は `schema:` で始まるものをまとめて「形が合わない」と出してよい）。

### `GET /api/topics?status=&kind=&limit=&before=`

- `status` は 6 つのどれか（省略 = 全部）、`kind` は 4 つのどれか（省略 = 全部）、`limit` 1〜100（既定 50）、`before` は前のページの `next_before` をそのまま（URL エンコードして）渡す。範囲外・形の違う `before` は 400 `bad_query`。
- 並びは `created_at` の新しい順・同じ時刻は `id` の大きい順。
- `next_before` は「作成時刻と id の組」を表す文字列 `"<created_at>|<id>"`（ページの最後の行）。次のページはこの組より後ろ（`created_at` が前、または同じ時刻で `id` が小さい）の行なので、同じ時刻のお題（同じ run の 2 本目など）がページの境目で抜けない。中身に頼らず、そのまま次の `before` に渡す（v2.4。前は `created_at` だけで、同じ時刻の残りが抜けた）。

```json
{ "topics": [ /* TopicRow… */ ], "next_before": "2026-11-05T09:50:00.000Z|tp_3f2c…_1" }
```

`next_before` は次のページが無ければ `null`。管理画面の要確認とストックは、`next_before` がある間「もっと読む」を出す。

### `GET /api/topics/:id`

```json
{
  "topic": { /* TopicRow */ "body": { /* T-1 の本文そのまま */ }, "check_round_start": 0, "check_not_before": null, "recheck_tried_at": null, "recheck_fail_count": 0 },
  "sources": [
    { "source_id": "s1", "url": "https://…", "name": "JAXA", "quote": "…", "required": true,
      "evidence": "worker_fetch", "excerpt": "…", "fetch_result": "found", "checked_at": "…" }
  ],
  "checks": [
    { "attempt": 1, "content_sha256": "9a1b…", "verdict": "green", "sources_ok": true, "approvable": true,
      "sensitivity": "heavy", "reasons": [], "detail": { "sources": [ … ], "model": { "note": "…", "flags": [], "heavy_reasons": ["war"] } },
      "created_at": "…" }
  ],
  "decisions": [ { "id": "td:…", "decision": "auto_hold", "by": "machine", "read_all": false, "content_sha256": "9a1b…", "note": null, "created_at": "…" } ],
  "lineage": [ { "id": "tp_…", "kind": "news", "status": "retired", "depth": 0, "title": "…", "derive_kind": null, "parent_topic_id": null, "created_at": "…" } ]
}
```

`checks` と `decisions` は新しい順。`lineage` は同じ `lineage_id` の全部を `depth`（同じなら `created_at`）の順。404 `not_found`。

### `POST /api/topics/:id/decide`

リクエスト: `{ "decision": "approve", "content_sha256": "9a1b…", "read_all": true, "note": "全文を読んだ" }`
（`decision`: `approve` / `reject` / `retire` / `star` / `unstar` / `recheck`。`content_sha256` は全部の操作で必須。`note` は 200 字まで）

成功 200: `{ "topic": { /* TopicRow（操作の後） */ } }`

失敗:

| status | error | いつ |
|---|---|---|
| 400 | `bad_request` | `decision` が無い・知らない値 / `content_sha256` が無い / `note` が 200 字超 |
| 404 | `not_found` | お題が無い |
| 409 | `sha_mismatch` | 画面の sha と今の sha が違う |
| 409 | `state_conflict` | 状態がその操作に合わない（承認・却下・やり直しは held だけ、引退は ready だけ）・ほかの操作と重なった |
| 400 | `not_approvable` | held だが `hold_reason` が `heavy`・`flagged` 以外、または最新の検査が `approvable = 0` |
| 400 | `read_all_required` | 重い話題を `read_all: true` なしで承認しようとした |

### `POST /api/topics/:id/derive`

リクエスト: `{ "kind": "refresh" | "extend", "note": "一言（200 字まで・省略可）" }`

成功 202: `{ "status": "queued", "run": { /* RunRow（status は calling） */ } }`（contract-T v2.6。取り置きと run の行を取った時点で返り、生成と保存は queue の受け手が行う。結果は `GET /api/topics/runs` の同じ run の行で見る）

失敗: 400 `bad_request` / 404 `not_found` / 503 `queue_unavailable`（queue に送れなかった。run の行と取り置きは取り消し済み）/ 409 `run_in_progress`（同じ種類の run が動いている）/ 409 `parent_not_eligible`（深さ 5・状態が合わない・発展の子が 2 つある・終わっていない見直しの子（held を含む）がある）/ 409 `cap`（費用の上限）/ 409 `disabled`（入・切が切、または一時停止）

### `POST /api/topics`

リクエスト: `{ "body": { /* T-1 の本文 */ } }`

成功 201: `{ "topic": { /* TopicRow */ } }`
失敗 400: `{ "error": "invalid_body", "reasons": ["facts_count", "…"] }`

### `POST /api/topics/runs`

リクエスト: `{ "kind": "news" | "talk" | "philo" | "make" }`
成功 202: `{ "status": "queued", "run": { /* RunRow（status は calling） */ } }`（contract-T v2.6。derive と同じく queue の受け手が作る）。失敗は derive と同じ（`not_found`・`parent_not_eligible` を除く。503 `queue_unavailable` を含む）。

### `GET /api/topics/runs?limit=`

`limit` 1〜100（既定 20）。`{ "runs": [ /* RunRow…（新しい順） */ ] }`

### `GET /api/topics/schedule?day=YYYY-MM-DD`

`day` 省略 = 今日（Asia/Tokyo）。実在しない日付は 400 `bad_day`。

```json
{
  "day": "2026-11-07",
  "planned": true,
  "slots": [
    { "kind": "news", "pos": 1, "state": "ready",   "topic": { /* TopicRow */ } },
    { "kind": "news", "pos": 2, "state": "stopped", "topic": { /* TopicRow */ } },
    { "kind": "talk", "pos": 1, "state": "empty",   "topic": null }
  ]
}
```

`slots` は種類（news → talk → philo → make）× 枠の数（2・1・1・3）の 7 行を必ず返す。`planned` はその日の予定を確定済みか（未確定なら全部 `empty`）。

### `POST /api/topics/settings`

リクエスト: `{ "enabled": true }` → 200 `{ "enabled": true }`。400 `bad_request`。

### `GET /api/status` の `topics`

```json
"topics": {
  "enabled": true,
  "last_run": { /* RunRow */ } ,
  "failed_24h": 0,
  "needs_review": { "heavy": 1, "source": 0, "other": 1 },
  "month_cents": 31, "month_cap_cents": 2000,
  "today":    { "empty": 0, "stopped": 0 },
  "tomorrow": { "empty": 7, "stopped": 0 },
  "over_reserve": 0
}
```

`needs_review.other` は held のうち重い話題と出典以外（気になる点を含む）。

`last_run` は「最後に実際に呼んだ run」: `status` が `skipped`（上限で始めなかった・呼んでいない）の行は除いた、いちばん新しい run。最新が `skipped: cap` でも、その前に呼んだ run を返す。呼んだ run が 1 つも無ければ `null`（上限で止まっていることは `topic_runs` の一覧＝記録のタブで見る）。

## 配信（認証なし。管理画面からは使わない）

- `GET /api/library/topics?day=` → `{ "day", "topics": [ { "topic_id", "kind", "pos", "needs_supporter", "lineage_id", "body" } ] }`
- `GET /api/library/topics/stock?kind=&limit=` → `{ "kind", "topics": [ { "topic_id", "kind", "needs_supporter", "lineage_id", "body" } ] }`
