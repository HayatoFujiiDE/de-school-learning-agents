## 案: 画像 1 枚ごとに Cloudflare Workflows のインスタンスを 1 つ立てる（id は `custom_tool_use` の id）

### (1) 変更点
- **migration `0003_images.sql`**:
  - `cost_ledger` を 0002 と同じ手順（`0002_intake.sql:33-40`）で作り直し、CHECK に `'image'` を足す。
  - `image_requests` 表を新設する。列は `id`（= custom_tool_use の id、PK）、job_id、material_id、session_id、model、params_json、status（`reserved / dispatched / stored / uploaded / replied / failed / released`）、`dispatch_count`、reserved_cents、actual_cents、r2_key、sha256、mime、bytes、file_id、error。
  - `factory_jobs.image_error_count` を足す。
- **wrangler.jsonc**:
  - `"workflows":[{"name":"factory-image","binding":"IMAGE_WF","class_name":"ImageWorkflow"}]` を追加。
  - vars に `IMAGE_ENABLED`, `IMAGE_PER_MATERIAL_MAX=8`, `IMAGE_MONTHLY_CAP_CENTS=3000`, `IMAGE_RESERVE_CENTS` を追加。
  - secret に `OPENAI_API_KEY` を追加（入れるのはふじさんの通常ターミナル）。
- **契約**: §B-0 に上記を追記。§B-4-d 手順 4 に custom tool の分岐を追加。§E-1 の `files[]` に `image_id` を追加。§E-4 の許可拡張子に `.png/.webp` を追加。§B-7 に content-type を追加。
- **コード**:
  - 新設: `src/image.ts`（Workflow クラスと OpenAI の port）。
  - 修正: `jobs.ts:1072-1093`、`anthropic.ts:62-83`（`files.upload` を足す）、`checks/schema.ts:23`、`jobs.ts:1343`、`routes/library.ts:18-25`、`admin.js:668-672`。
  - `material-maker.md` に tool の定義と使い方を追記。

### (2) 流れ
1. reconcile が `requires_action` を見る。`event_ids` の本体を引き、name が `generate_image` のものだけをこの分岐に回す。それ以外は従来どおり deny する。
2. D1 の batch 1 回で上限を確保する（(3) の式）。
3. `IMAGE_WF.create({id: tool_use_id})` を呼ぶ。同じ id で既にあれば `get(id)` で既存のものとみなす。
4. Workflow の各 step:
   - a. dispatch の CAS: `UPDATE … SET dispatch_count=1 WHERE id=? AND dispatch_count=0`。0 行なら呼ばずに `NonRetryableError` で止める。
   - b. OpenAI の generations または edits を呼ぶ（AbortSignal 180 秒）。b64 を decode し、先頭バイトで形式を確かめ、R2 `images/{material_id}/{id}.{ext}` に put する。step の出力は 1 MiB までなので、本体は R2 に置き、step が返すのはキーと sha だけ。
   - c. `usage` から実費を計算して精算する。
   - d. `files.upload` で file_id を得る。
   - e. 送信済みかを `events.list` で確かめてから `user.custom_tool_result` を送る。content は image block（file 参照）と「material.json の files[] に `image_id: <id>` を書く」の 1 文。
   - f. status を `replied` にする。
5. 職人は絵を見て、描き直す（edits を指定して再度呼ぶ）か採用する。
6. 取り込み（`versioned` 段階）: `files[]` のうち `.png/.webp` で `image_id` を持つものは、raw ではなく R2 からコピーする。条件は「同じ素材」「status が `replied`」「sha 一致」。条件に合わなければ `invalid_outputs`。
7. 確認画面（§G-2）を通り、承認の後だけ配信される（`publishSwitch` は変えない）。

### (3) 費用の共有チョークポイント
batch 1 回でまとめて行う（D1 の batch は transaction: https://developers.cloudflare.com/d1/worker-api/d1-database/#batch）。
- `INSERT OR IGNORE INTO image_requests … SELECT … WHERE` に次の 3 条件を付ける。
  - `(SELECT COUNT(*) … material_id=? AND status!='released') < 8`
  - `(SELECT SUM(cents) FROM cost_ledger WHERE kind='image' AND 月=?) + R ≤ 3000`
  - job の lease が成立している
- 続けて `cost_ledger` に R を入れる `INSERT … WHERE EXISTS(その行)`。
- id が PK なので、重複配信や再起動が来ても確保は 1 回だけ。1 回の確保につき OpenAI 呼び出しも最大 1 回（step a）。
- 精算は `c ≤ R` の時だけ差額（負の値）を記録する。`usage` が無い時は R を残す。

最悪の額:
- 月の合計 ≤ 3000 + Σ_{同時に未精算} max(0, c_i − R)
- size / quality / n=1 を enum で絞り、R ≥ C_max にすれば超過は 0。
- 1 素材 ≤ 8R、1 か月 ≤ ⌊3000/R⌋ 枚。
- gpt-image-2.5 の出力トークン数は公表値を確認していない（推測）。R は最初の実測 `usage` で見直す。

### (4) 失敗の行列（「確定」= 費用・状態が D1 に書かれた）

| 失敗点 | 確定 | 次に起きること / 収束 |
|---|---|---|
| 鍵なし | 確保前 | is_error を返す（確保しない）。`image_error_count>8` で `too_many_denies` と同じく終了 |
| 月の上限超過 / 9 枚目 | 拒否 | is_error「上限です。SVG で描いてください」。自動では再開しない |
| moderation の拒否 | R を残す | is_error「題材を変えて」。8 枚に数える |
| 2 分超 / timeout | R を残す | 課金の有無が分からないので R を残し、is_error |
| OpenAI 5xx / 429 | R を残す | step a があるので再試行は 0。職人が呼び直すと次の確保（最大 8 回） |
| R2 put の失敗 | dispatched | 再実行しても step a で止まる。is_error |
| lease の喪失 | 確保前なら未確定 | 次の reconcile が同じ id で確保と create をやり直す（冪等） |
| 重複配信 / webhook の二重受信 | PK | 確保も Workflow も 1 つ |
| result の送信失敗 | stored | step e を 3 回まで再試行（送信済みかを先に確かめる） |
| session terminated | 費用は確定 | step e が 4xx なら `failed`。cron が 15 分超の行を `IMAGE_WF.get().status()` で調べ、止まっていれば is_error を送るか打ち切る |

reconcile は `image_requests` に行がある id を deny しない。

### (5) flare / sunburst の選び方
`input_schema` は次のとおり。
- `{prompt, accuracy:"standard"|"scientific", size, quality:"low"|"medium"|"high", background, format:"webp"|"png", edit_of?: image_id}`
- `scientific` なら sunburst、それ以外は flare（料金は同じなので R も同じ）。
- 職人の system prompt に「大きさ・数・順序・構造が正しさの要になる絵は scientific」と書く（flare が大きさの順を誤った例から）。

### (6) 確認と配信
- 取り込みの検査: 拡張子・先頭バイト（PNG / RIFF…WEBP）・sha の 3 つが一致すること、1 枚 ≤ 2 MiB。
- forbidden.ts と TextDecoder は文字のファイルにだけ当てる。
- 配信の応答: `image/png` と `image/webp` に `nosniff` と `CSP: default-src 'none'` を付ける。
- 検証係は画像を見ない。渡すのは職人の alt / キャプションと prompt の文字だけ。絵の正しさは確認画面で人が見る（`<img>`、model と prompt も表示）。
- 未承認の版は従来どおり 404。

### (7) テスト
- fake の形:
  - fake OpenAI は本物の小さい PNG の b64 と `usage` を返す。400 moderation、429、abort、usage なしも再現できるようにする。
  - fake Anthropic の fixture: `agent.custom_tool_use` と idle の `requires_action` を入れ、送られた `custom_tool_result` を記録する。バイナリは base64 で持つ。
- smoke の項目（修正前 FAIL → 修正後 PASS）:
  - ① deny ではなく result を送る
  - ② 9 枚目は OpenAI を呼ばない
  - ③ 月 2990+R は拒否される
  - ④ 同じ fixture で reconcile を 2 回しても確保 1・dispatch 1
  - ⑤ step を再実行しても 2 回目の呼び出しが起きない
  - ⑥ `.png` が取り込まれる（現状は `invalid_outputs`）。sha が違えば `invalid_outputs`
  - ⑦ 未承認の png は 404
  - ⑧ 鍵なしでは確保しない
  - ⑨ ログ・D1 に鍵の文字列が出ないことを grep で確かめる
  - ⑩ 既存の vitest 306 / smoke 89
- Workflows のテスト基盤は未確認（推測）。

### (8) ロールバック
1. `IMAGE_ENABLED=0` にする（generate_image には is_error を返す）。
2. `ant apply` で職人の定義を前の版に戻す。
3. png を含む公開中の素材を「配信を止める」。
4. 必要なら Worker を ac83fb57 に戻す。旧版は custom tool に誤った deny を送り、png は 404 になるので、この順にする。
5. 0003 は追加だけなので残してよい。

### (9) 新しい結合とトレードオフ
- Workflows への依存が増える。id を再利用した時の挙動は公式に記載がない。
- 画像の正本が職人の outputs ではなく Worker の R2 になる。material.json の `image_id` と取り込みが結びつく。
- R を保守的に取るほど、$30 で作れる枚数が減る。
- 1 枚あたりの step が 6 つになり外部呼び出しが増える。その代わり失敗した場所が `image_requests.status` で見える。
- 絵の内容を機械では検証せず、人の確認に頼る。