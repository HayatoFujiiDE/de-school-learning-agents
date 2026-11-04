## 案: 生成は cron だけで走らせ、予約は cost_ledger への条件付き 1 文で取る

webhook は依頼を記録するだけにします。OpenAI の呼び出しは cron の reconcile が行います。Queues や Workflows は増やしません。

### (1) 変更点
- **`migrations/0003_image.sql`**
  - 新しい表 `image_requests` を足す。列は `custom_tool_use_id` PK、`job_id`、`material_id`、`input_json`、`status`、`attempts`、`r2_key`、`sha256`、`file_id`、`error`。
  - `status` は `pending → reserved → generated → sending → delivered | refused | failed` と進む。
  - `cost_ledger.kind` に `'image'` を足す。0002 と同じ作り直しで行う（`migrations/0002_intake.sql:33-40`）。
- **`src/jobs.ts` の requires_action 分岐（:1072-1093）**
  - fold（:1043-1066）が `event_ids` に対応する `agent.custom_tool_use` の name と input も集めるようにする。
  - `tool_confirmation` はこれまでどおり deny する。
  - `generate_image` は `INSERT OR IGNORE INTO image_requests` だけを行い、`'awaiting_image'` を返す。
  - それ以外の custom tool には `is_error` の result を返す。
- **新しい `src/image.ts`**
  - 予約、OpenAI の呼び出し、保存、Files への upload、送信を持つ。
  - OpenAI の呼び出しは port にして、fake と差し替えられるようにする。
- **`src/anthropic.ts:62-83`** の port に `uploadFile` を足す。
- **契約**
  - §B-4-d 手順 4 に分岐を足す。
  - §B-5 の 2-b を新設する。
  - §E-1 の `parts[].files[]` に `image_id` と `alt` を足す。
  - §B-7 に拡張子を足す。
  - §F-2 を変える。
- **wrangler.jsonc**: binding は増やさない。足すのは次だけ。
  - var: `IMAGE_GEN_ENABLED`、`IMAGE_MONTHLY_CAP_CENTS=3000`、`IMAGE_PER_JOB_MAX=8`、`IMAGE_RESERVE_CENTS`
  - secret: `OPENAI_API_KEY`
- **`factory/claude/agents/material-maker.md`**
  - custom tool を定義する: `{prompt, accuracy: "standard"|"scientific", format: "webp"|"png", background, edit_of?}`。
  - frontmatter での書き方は**確認していません**。

### (2) 流れ
1. 職人が `agent.custom_tool_use` を出すと、session は idle（requires_action）になります。
2. webhook の reconcile（25 秒）は依頼の行を INSERT して終わります。
3. cron の手順 2-b は、残り時間が 3 分以上ある間、1 回に最大 3 件を処理します。job の lease を取り、180 秒に延長してから次を行います。
   - **予約**: 予約の 1 文（次の (3)）。0 行なら `refused` にする。
   - **生成**: OpenAI の `v1/images/generations`（`edit_of` があれば `edits`）を `AbortSignal` 150 秒で呼ぶ。
   - **保存**: b64 を decode し、magic bytes と 2 MiB 以下（`schema.ts:5`）を確かめて、R2 の `materials/{mid}/{job}/gen/{req}.{ext}` に put する。
   - **upload**: `files.upload` で file_id を受け取る。
   - **送信**: CAS で `sending` にしてから、`user.custom_tool_result` を `{custom_tool_use_id, content:[image{file}, text"image_id=…"]}` で送り、`delivered` にする。
4. 取り込みの versioned 段階では、`files[].image_id` を同じ job の `delivered` の行から引きます。R2 の gen をコピーして論理キーに置きます。職人の作業場は画像のバイナリを経由しません。`content_sha256` には画像のバイトも入ります。
5. 確認画面（§G-2）で人が見て承認し、それから配信（§B-7）されます。

**待ち時間の悪化**（cron 間隔 10 分と、ふじさんの 1 例の実測値から計算）

| | 1 枚あたり（平均） | 1 枚あたり（最悪） | 8 枚を順番に（最悪） |
|---|---|---|---|
| この案 | 約 5 分 23 秒（flare）、約 5 分 47 秒（sunburst） | 12 分 | 96 分 |
| Queues 案 | 23〜47 秒 | — | — |

### (3) 上限の守り方
チョークポイントは、OpenAI を呼ぶ直前に必ず通る 1 つの batch です（`conditionalBatch` の形。jobs.ts:960-987 と同じ）。

```sql
INSERT INTO cost_ledger(...,kind,ref_id,cents) SELECT …,'image',:req,:R
WHERE EXISTS(job lease = :token)
  AND (SELECT COUNT(*) FROM cost_ledger WHERE kind='image' AND ref_id IN (SELECT custom_tool_use_id FROM image_requests WHERE job_id=:j)) < 8
  AND (SELECT COALESCE(SUM(cents),0) FROM cost_ledger WHERE kind='image' AND substr(day,1,7)=:m) + :R <= 3000
  AND dayCost + :R <= DAILY_CAP_CENTS;
UPDATE image_requests SET status='reserved', attempts=attempts+1 WHERE … AND status IN('pending','retry');
```

- 読んでから判定する `capCheck`（`ledger.ts`）は非原子なので使いません。D1 の 1 文の中で判定します。
- 予約は返金しません。失敗した試行も 1 枚と数えます。再起動、重複配信、同時実行をまたいでも、数える元は D1 だけです。
- 最悪の月額は `3000 + N_inflight × max(0, A_max − R)` セントです。`R ≥ A_max` に設定すれば $30 ちょうどが上限になります。
- 1 job あたりの OpenAI 呼び出しは最大 8 回です（失敗した試行も含む）。
- `R` は推測です。gpt-image-1 の high 1024² が出力 4160 tokens なら $30/1M で約 13¢ なので、仮に 25¢ とします。2.5 系の tokens 数は**確認していません**。実際の probe で校正します。

### (4) 失敗の行列
retry の上限は依頼 1 件につき 2 回です。

| 失敗点 | D1 で確定したこと | 次に起きること |
|---|---|---|
| 鍵がない / `IMAGE_GEN_ENABLED=0` | 予約なし | `is_error`「画像は使えません」を返す |
| 月または 1 job の上限を超えた | 予約 0 行 | `refused`。`is_error`「上限に達しました。画像なしで進めてください」を返す。自動では再開しない |
| OpenAI の 5xx または 2 分超 | 予約済み | `attempts<2` なら `retry`（新しい予約が要る）。2 回目も失敗なら `failed` にして `is_error` |
| moderation の拒否（4xx） | 予約済み（課金されるかは不明なので残す） | 再試行しない。`is_error` に理由を入れて返し、職人は言い換えるか諦める |
| 生成後に lease を失った | 予約済み、R2 は書いた可能性あり | 次の回で R2 の gen があれば採用する。無ければ 1 試行を使ったものとして retry |
| 重複配信（webhook / cron） | PK と INSERT OR IGNORE | 何も起きない |
| custom_tool_result の送信が失敗した | `sending` | 再送の前に `events.list` に同じ id の result があるか確かめる。あれば `delivered` にし、無ければ再送（最大 2 回）。deny の「送ってから CAS」の穴（:1078-1085）をこの経路では塞ぐ |
| session terminated | 何であれ | 未完了の依頼は `failed`。job は既存の §B-4-d の 3 に従う |

どの場合も、試行回数が 2 回と 8 回で止まるので有限で収束します。

### (5) flare / sunburst の選び方
- 職人は `accuracy` だけを選びます。`standard` なら flare、`scientific` なら sunburst です。Worker が allowlist で対応づけ、model 名そのものは職人に渡しません。
- system prompt に「大きさの順、数量、目盛り、科学図は scientific」と書きます。flare が大きさの順を誤った例が根拠です。
- 料金は同じなので、予約額 R も同じです。

### (6) 確認と配信
- **検査**
  - `PART_FILE_EXTENSIONS`（`schema.ts:23`）に `.png` / `.webp` を足すのは `files[]` だけにします。
  - 取り込み時に magic bytes が拡張子と一致しなければ `invalid_outputs` にします。
  - jobs.ts:1343 の decode と `forbidden.ts:66-99` は画像を飛ばします。代わりに、生成 prompt と `alt` を禁止語の検査にかけます。
- **配信**: `library.ts:18-25` に `image/png` / `image/webp` を足し、`nosniff` と `CSP default-src 'none'` を付けます。`public_paths_json` が完全一致の時だけ返すのはこれまでどおりです。
- **検証係**: `verify.ts:116` の検証係は絵を見ません。見るのは prompt と alt のテキストだけです。
- **人の確認**: 確認画面（`admin.js:668-672`）で画像を `<img>` で全部出し、人の承認を必須にします。「available」への遷移が approve / rollback だけなのは変わりません。

### (7) テスト
- **fake**
  - `fake/openai.ts` は本物と同じ形 `{created, data:[{b64_json}], usage}` を返す。中身は実在する小さな PNG のバイトにする。
  - `fake/anthropic.ts:197-209` に base64 のバイナリ fixture と、custom_tool_use の events を足す。
- **修正前に FAIL し、修正後に PASS する smoke**
  - (a) custom_tool_use に deny が送られない。今のコードは deny を送るので FAIL する。
  - (b) 9 枚目は `is_error` になり、OpenAI は 8 回しか呼ばれない。
  - (c) 2 つの cron を並行して走らせても、予約の数が厳密に合う。
  - (d) 台帳に 2990¢ を入れておくと、次の依頼は拒否される。
  - (e) 送信直後に落とした後で再実行しても、result は 1 回しか送られない。
  - (f) 鍵の fixture 値が D1、ログ、R2 のどこにも 0 件。
  - (g) manifest にない png は 404。
  - (h) magic bytes が拡張子と違えば `invalid_outputs`。
- 既存の 306 / 89 もすべて PASS のままにします。

### (8) ロールバック
1. `IMAGE_GEN_ENABLED=0` にすると、OpenAI は呼ばれず `is_error` だけが返ります。
2. agent の定義を前の版に `ant apply` で戻します。
3. 必要なら Worker を `wrangler rollback ac83fb57` で戻します。
- 順番は 2 を 3 より先にします。古いコードは custom tool の id に deny を送ってしまうので、その前に agent から tool を消しておきます。
- 0003 は追加だけなので、古いコードのままで動きます。

### (9) 新しい結合とトレードオフ
- **待ち時間**: 1 枚あたり平均 5 分以上延びます。
- **cron の 15 分の取り合い**: 画像に最大 7.5 分を使うので、検証係や収集部隊と時間を取り合います。
- **reconcile が OpenAI に依存する**: job の lease を 180 秒に延ばして使います。
- **session の待機（確認していません）**: 保留中の custom tool の締め切りは公式に書かれていません。長く待つと session が終わる危険があり、probe が必要です。
- **画像の正しさ**: 検証係は絵を見ないので、正しさは人の確認だけに頼ることになります。
- **OpenAI 側**: 組織の本人確認が要る場合があります。

根拠は次の 2 つです。
- `/private/tmp/claude-501/-Users-hayatofujii-Coding-DESystem-Learning-Agents/b41991a5-c8e3-4468-9e5f-5626b6906f90/scratchpad/img-map.md`
- `/Users/hayatofujii/Coding/DESystem/Learning-Agents/CONTRACT-factory.md` の §B-4-d、§B-5、§B-7