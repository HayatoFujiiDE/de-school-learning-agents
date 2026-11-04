## 実装案: Cloudflare Queues の consumer で画像を生成する（堅牢性重視）

### (1) 変更点
- **migration `0003_image.sql`**: 0002 と同じ作り直しで `cost_ledger.kind` に `'image'` を足す（0002_intake.sql:33-40）。新しい表を 2 つ作る。
  - `image_requests`: 主キーは `custom_tool_use` の event id。列は job_id / material_id / accuracy / input_json / status / lease_token / lease_until / r2_key / sha256 / file_id / result_sent_at / error_code。
  - `image_attempts`: 主キーは (request_id, attempt)。列は material_id / reserved_cents / settled_cents。
- **wrangler.jsonc**:
  - `queues.producers` に `IMAGE_GEN` を足す。
  - `queues.consumers` は `{max_batch_size:1, max_concurrency:2, max_retries:2, retry_delay:30, dead_letter_queue:"image-gen-dlq"}`。
  - DLQ consumer も足す。
  - vars は `IMAGE_GEN_ENABLED`、`IMAGE_MONTHLY_CAP_CENTS=3000`、`IMAGE_PER_MATERIAL=8`、`IMAGE_RESERVE_CENTS`、`IMAGE_MODEL_STANDARD=gpt-image-2.5-flare`、`IMAGE_MODEL_SCIENTIFIC=gpt-image-2.5-sunburst`。
  - `OPENAI_API_KEY` は secret にする。
- **新しいファイル**: `src/openai.ts`、`src/images.ts`（予約・lease・consumer）、`src/fake/openai.ts`。
- **契約**: §B-0 / §B-4-d 手順 4 / §C-1 / §E-1 / §B-7 / §F-2 / §F-3 / §G-2 / §I に追記する。

### (2) 流れ
1. **検出**: reconcile の requires_action 分岐（jobs.ts:1072）で、event_ids の event 本体を取る。いまは id だけ持っている（jobs.ts:1043-1066）。
   - `generate_image` なら画像の処理へ、それ以外は従来どおり deny する。
   - `image_requests` へ `INSERT OR IGNORE` し、message `{request_id}` を送る。
2. **上限の確保**: consumer が lease を CAS で取り、(3) の予約を通す。
3. **生成**: `images/generations`、または `edit_of` があれば `images/edits` を呼ぶ。AbortSignal は 150 秒、SDK 内の再試行は 0。
4. **保存**: R2 の `img-staging/<job>/<req>.<ext>` に置き、sha を CAS で記録する。
5. **custom_tool_result**: `files.upload` で file_id を作り、次を返す（content は image ブロック 1 つ ＋ テキスト 1 つ）。
   `user.custom_tool_result {custom_tool_use_id, content:[{type:"image",source:{type:"file",file_id}}, {type:"text",text:"image_id=<短id> パス parts/<part>/img-<短id>.webp"}]}`
6. **取り込み**: material.json が `img-<短id>.*` を参照していれば、取り込みは files.list ではなく `image_requests` と R2 staging から版へコピーする。これで作業場でバイナリをコピーさせない。
7. **確認と配信**: 確認は §G-2、配信は既存の approve の後だけにする。

### (3) 費用の共有チョークポイント
OpenAI を呼ぶ道は `openai.ts` の `generate(res: Reservation, …)` 1 本だけにする。
- `Reservation` は `reserveAttempt()` の中でしか作れない（module-private の symbol）。
- テストで「`api.openai.com` と `OPENAI_API_KEY` は openai.ts にしか出てこない」を grep で確かめる。

予約は 1 回の batch で行う。jobs.ts:960-987 の `conditionalBatch` と同じ形にする。
- 文 1: `INSERT INTO image_attempts … SELECT … WHERE` で、次の 3 条件を 1 文の中で判定する。
  - `(SELECT COUNT(*) FROM image_attempts WHERE material_id=?) < 8`
  - 今月の image の合計 ＋ r ≤ 3000
  - 今日の合計 ＋ r ≤ DAILY_CAP
- 文 2: `cost_ledger` へ `INSERT … WHERE EXISTS(文 1 の行)`。

数えるのは「試行」なので、再試行も 8 枚に入る。D1 の batch がトランザクションで、書き込みは直列になる、という前提は推測（公式の確認は未実施）。この前提なら、再起動・重複配信・同時実行のどれでも判定は書き込みと同時に決まる。

精算は usage が取れた時だけ `settled_cents` に書く。usage が無い、または結果が分からない時は予約額 r をそのまま費用として残す（scout の UNCONFIRMED と同じ考え方）。

**最悪の超過額**:
- 月の画像支出 S ≤ 3000 + Σ_未精算 max(0, a_i − r)。
- r を「許した size と quality の最大出力トークン × $30/1M ＋ 入力の上限」以上に決めれば、S ≤ $30 になる。
- r が小さすぎた場合に備え、a_i > r を 1 回でも観測したら新しい予約を止める（fail-closed）。超過は 1 回分の未精算に限られ、S ≤ 3000 + 16·(a_max − r)。16 は 8 枚 × MAX_CONCURRENT_JOBS 2。
- 1 素材あたりは 8·r が上限。

### (4) 失敗の行列
| 失敗点 | 書き込み確定 | 次に起きること | 収束 |
|---|---|---|---|
| 鍵なし / ENABLED=0 | なし | 予約せずに is_error「SVG で描く」を返す | 即 |
| 上限超過（1 素材 8 枚 / 月 $30） | 予約失敗 | is_error「上限。SVG で」を返す。自動では再開しない | 即 |
| OpenAI 5xx / timeout（2 分超） | 予約は残る | 新しい予約で試行 2。2 回で is_error | 1 依頼で 2 回まで |
| moderation 拒否 / 4xx | 予約は残る（課金は推測で保守側） | 再試行せず is_error と理由 | 即 |
| lease 喪失 / 重複配信 | lease は他の consumer にある | ack して何もしない | 主キーと CAS |
| consumer が落ちる | status=generating | lease 切れ（5 分）の後、再配信で試行 2 | 試行は 2 回まで |
| R2 に保存済み、upload 前に落ちる | r2_key あり | 生成を飛ばして upload から再開 | 保存済みの段は飛ばす |
| result 送信の失敗 | sending | 再送の前に session events に同じ id の result があるか調べ、あれば CAS だけ行う。deny の二重送信の穴（jobs.ts:1078-1086）は再現しない | 再送 3 回 → DLQ → job failed `image_result_unsent`、interrupt と archive |
| session terminated | ― | 送らずに orphaned。cron が R2 と file を 7 日で消す | 即 |

### (5) flare と sunburst
input_schema に `accuracy: "standard"|"scientific"` を必須で入れ、Worker が vars でモデルに対応させる。職人はモデル名を知らない。scientific を使うのは、大小の順・数量・図表・解剖・地図。根拠は flare が大きさの順を誤ったこと（img-context.md 追記）。ほかの入力は次のとおり。
- size（enum）
- quality（low〜high の enum。max は r が大きくなるので vars で解禁）
- `background`
- `edit_of`（任意）
- prompt（4000 字まで）

### (6) 画像の確認と配信
- **許す拡張子**: `.png` と `.webp`（schema.ts:23）。
- **中身の検査**: マジックバイトが拡張子と一致すること。上限は 3 MiB（IMAGE_MAX_BYTES）。
- **テキスト検査から外す**: jobs.ts:1343 の decode と forbidden.ts は拡張子で分け、画像は通さない。
- **配信のヘッダ**: library.ts:18-25 に `image/png` と `image/webp` を足す。nosniff と `CSP: sandbox` を付ける。公開の範囲はこれまでどおり public_paths_json との完全一致。
- **検証係**: listPartPaths（verify.ts:116）は text のまま。image ブロックを別に渡し、claims と食い違う絵を `needs_supporter_check` に回す（費用の増え方は推測）。
- **人の確認**: 確認画面（admin.js:668）に、拡大表示・accuracy・prompt・試行回数を出す。承認の道は approve と rollback の 2 つのまま。

### (7) テスト（fake は本物の形）
- **fake OpenAI**: `{data:[{b64_json}], usage}` を本物の PNG と WebP のバイトで返す。timeout、429、`moderation_blocked` も再現する。
- **fake Anthropic**: event 本体付きの `agent.custom_tool_use` を返す。fixture はバイナリも持てるようにする（いまは fake/anthropic.ts:197-209 が文字列だけ）。

修正前 FAIL → 修正後 PASS にする smoke:
1. custom_tool_use が deny されない
2. 同じ素材の 9 回目は OpenAI の呼び出し回数 8 のまま
3. 予約 20 件の並列で月合計 ≤ 3000
4. message の 3 重配信で生成 1 回・result 1 回
5. 送信後に CAS 前で落ちても再送しない
6. timeout で試行 2、3 回目は無い
7. 鍵なしで ledger 0 行
8. png は承認前の library で 404、承認後は `image/png` で返り、sha は版の全ファイル
9. 中身が SVG の .png は invalid_outputs
10. fake の鍵の値がログと D1 に出ない

既存の vitest 306 と smoke 89 が PASS のまま。

### (8) ロールバック
1. `IMAGE_GEN_ENABLED=0` にする。即 is_error を返すので、職人は SVG へ戻る。
2. 職人定義を前の版で `ant apply` し、tool を消す。
3. queue を空にしてから binding を外す。
4. `wrangler rollback` する。ただし png を含む available な版があれば、先に rollback か非公開にしないと配信が 404 になる。
5. 0003 の表は残す。古いコードは kind=image を読まない。

### (9) 新しい結合とトレードオフ
- **部品が増える**: queue と DLQ を見張る必要がある。管理画面に月の確定額・予約額・DLQ 件数を出す。ログは request_id / stage / attempt / cents / HTTP status の構造化ログ。
- **取り込みが `image_requests` に依存する**: 作業場の outputs ではなく Worker の保管が正本になる。
- **予算を多めに見る**: r を保守的にするほど月の枚数が減る（r=50¢ なら 60 枚。r は推測で、初回の usage で直す）。
- **日次上限の共有**: 日次上限は session と共有なので、画像が session の枠を押しのけることがある。
- **未確認**: 保留中の custom tool に締め切りがあるかと、custom_tool_result を二重に送った時の挙動は、公式に記載がない（img-map.md）。