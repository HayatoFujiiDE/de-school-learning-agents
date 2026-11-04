# §O 画像生成（段階 2）— 契約の下書き v2（2026-11-05。未凍結）

この版は単独で読める。旧下書き `contract-M2-draft.md` と plan-v4〜v6 への差分ではない。書き直した理由は RCA（下の「書き直しの理由」）。旧下書きから**そのまま使う節**は、節番号を明記して参照する（§O-2 の tool 定義・入力検査・system prompt）。

書き方: `?name` は名前付きの値（実装では位置の `?`）。「batch」は §B-2 の条件付き batch（D1 の 1 トランザクション、上から順）。後の文の述語が前の文の結果を見る形を使う（前の文が 0 行なら後の文も 0 行）。

§O-1 と §O-3 c の SQL は、migrations 0001〜0003 + §O-1 を `node:sqlite` に入れて実行し、次を確かめた（2026-11-05、scratchpad の `sqlt/t.mjs`）: 月 2721¢ で取り置き 0 行・2720¢ で 1 行 / 取り置きのある job は月 3000¢ でも続く・無い job は断る / 8 枚で止まる / 日次は検証の飛行中予約 300¢ を含めて判定（含めない場合との差で弁別）/ D の二重は片方だけ / R1 は別 token で 0 行 / R2・C3b の停止は前の文が書いた行がある時だけ / H2 は dispatched が残ると 0 行 / F は 1 回だけで額は呼んだ分の U の合計。

## 書き直しの理由（RCA 2026-11-05 の要約）

- 旧設計は、要件（共有チョークポイントで 1 素材 8 枚・月 $30 を超えない）より強い保証を司令塔が自分で足していた: 実費の数値上界（3490¢）、試行ごとの正確な精算と返金、結果の到達保証（通知の状態機械・照合・再送・abandoned）
- それぞれが状態と例外経路を掛け算で増やし、レビュー 10 回で指摘 69 件（会計 22・配送 9・並行 8）。plan v9 で GO が出た後に、下書きでまた機構を足して REVISE に戻った
- 本版は保証を 3 つの有界な文に絞り、それを生む状態だけを持つ。「結果が職人に届いたか」は Worker の状態で推測せず、session の events（既存の `answered`）で見る

## §O-0 目的・保証・範囲

**目的**: 職人（Managed Agents の session）が custom tool `generate_image` で絵を作り、返った絵を見て描き直すか採用できる。採用した絵は取り込みで版に入り、確認画面で人が見て、承認後にだけ配信される。

**保証（この 3 つだけ。数値は §O-5）**

- (G1) **月の画像の記帳は 3000¢ を超えない**。対象は `cost_ledger` の `kind = 'image'` の行で、Asia/Tokyo の暦月ごとの合計。記帳は 1 枚 = U（§O-5 の表）で数え、job が初めて画像を頼んだ時に 8 枚分を取り置く
- (G2) **1 つの注文（job）で受け付ける画像は 8 枚まで**（描き直しも、失敗した 1 枚も 1 枚に数える）
- (G3) **実費が記帳を超えるのは、ある 1 枚の実額が U を超えた時か、実額が分からない時だけ**。そのどちらかを検出したら `image_gen_halted` を書き、以後の新しい画像を断る。その時点で OpenAI を呼んでいた画像（queue の同時実行 2 まで）は最後まで進める。**超過額の上界は主張しない**（OpenAI の出力費用は公式でも見積り）。管理画面・README では「月 $30」を「画像の記帳の上限（U で数えた額）」と書く

保証ではないが守ること: `OPENAI_API_KEY` は Worker secret だけ（D1・R2・ログ・作業場・custom_tool_result に出ない）。画像も人の承認なしに配信されない（§B-7 のまま）。

**範囲外**: 描き直しに元画像を入れる編集（v1/images/edits）、1024x1536・xhigh、JPEG、画像の Batch API、バディ側の生成、動画、検証係が画像を見ること、Workflows・Durable Objects、配信 API の形の変更、管理画面からの試し生成（probe）。

**既存の欠陥として切り離すもの**: `tooManyDenies` が interrupt と archive の両方の失敗を握りつぶして job を failed にし、後始末を再試行しない（`jobs.ts:1105-1110`。旧下書きへのレビュー M5）。今回の変更による回帰ではないので GitHub Issue で扱い、本節は既存の処理をそのまま使う。

**前提（本番で確かめたこと。probe-results.md）**: custom tool を持つ agent を API で作れる（p2）。`agent.custom_tool_use` の 252 秒後の result を受理して session が再開する（p3）。同じ id への 2 回目の result は 200 で、記録も turn も起きない（p4a。end_turn の後で確認）。archive 後は 400（p4b）。1 枚の所要は最長 83 秒、usage は `output_tokens_details.{image_tokens,text_tokens}`（p1）。

## §O-1 migration `migrations/0004_image_gen.sql`（verbatim）

```sql
-- 契約 §O-1 verbatim（画像生成 段階 2）
-- 1. cost_ledger.kind に 'image' を足す。CHECK は ALTER できないので 0002 と同じ手順で作り直す。
--    DROP TABLE で idx_cost_day と idx_cost_ledger_vb も消えるので両方作り直す
CREATE TABLE cost_ledger_v3 (
  id TEXT PRIMARY KEY, day TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('session','verify','scout','meeting','image')),
  ref_id TEXT NOT NULL, cents INTEGER NOT NULL, created_at TEXT NOT NULL
);
INSERT INTO cost_ledger_v3 SELECT id, day, kind, ref_id, cents, created_at FROM cost_ledger;
DROP TABLE cost_ledger;
ALTER TABLE cost_ledger_v3 RENAME TO cost_ledger;
CREATE INDEX idx_cost_day ON cost_ledger(day);
CREATE UNIQUE INDEX idx_cost_ledger_vb ON cost_ledger(ref_id) WHERE ref_id GLOB 'vb:*';
-- 画像の記帳は job ごとに 1 行だけ（ref_id = 'ih:' || job_id が取り置き中、'if:' || job_id が確定後）
CREATE UNIQUE INDEX idx_cost_ledger_image_job ON cost_ledger(substr(ref_id, 4)) WHERE kind = 'image';

-- 2. 依頼（agent.custom_tool_use 1 件 = 1 行 = OpenAI 呼び出し最大 1 回）
CREATE TABLE image_requests (
  id TEXT PRIMARY KEY,                                   -- 'img_' + 32 桁の hex。職人に返す image_id
  custom_tool_use_id TEXT NOT NULL UNIQUE,
  job_id TEXT NOT NULL REFERENCES factory_jobs(id),
  session_id TEXT NOT NULL,
  model TEXT, size TEXT, quality TEXT, format TEXT CHECK (format IN ('png','webp')), background TEXT,
  u_cents INTEGER,                                       -- この組み合わせの U。断った行は NULL
  input_json TEXT NOT NULL DEFAULT '{}',                 -- 検査済みの {prompt, alt, accuracy}。ログに出さない
  state TEXT NOT NULL CHECK (state IN ('queued','dispatched','done','refused','failed')),
  error TEXT,                                            -- 固定コードだけ（§O-6 の表）
  enqueue_count INTEGER NOT NULL DEFAULT 0, enqueued_at TEXT,
  dispatch_token TEXT, dispatched_at TEXT,
  usage_json TEXT,                                       -- 応答があった時だけ。usage が無ければ '{"missing":true}'
  actual_cents INTEGER,                                  -- usage から出した実額（表示と停止の判定だけに使う。記帳には使わない）
  r2_key TEXT, sha256 TEXT, bytes INTEGER, media_type TEXT,
  file_id TEXT,                                          -- §O-6 の形 B を採った時だけ使う
  cleaned_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  CHECK ((state = 'queued' AND u_cents IS NOT NULL AND dispatched_at IS NULL)
      OR (state = 'dispatched' AND dispatch_token IS NOT NULL AND dispatched_at IS NOT NULL)
      OR (state = 'done' AND r2_key IS NOT NULL AND sha256 IS NOT NULL)
      OR state IN ('refused','failed'))
);
CREATE INDEX idx_image_requests_job ON image_requests(job_id, state);
CREATE INDEX idx_image_requests_state ON image_requests(state, updated_at);
-- settings の新しい key: image_gen_halted（値 = 理由コード。§O-5 d）
```

列の数え方:
- 8 枚に数える行 = `state <> 'refused'`（queued・dispatched・done・failed）。断った行は数えない（OpenAI を呼ぶ権利を取っていない）
- OpenAI を呼んだ行 = `dispatched_at IS NOT NULL`

## §O-2 custom tool の定義・入力検査・system prompt

旧下書き `contract-M2-draft.md` の §M-2-2 a（frontmatter の tools、verbatim）・b（`validateImageInput`、表、model の決め方、`MAKER_CUSTOM_TOOLS`）・c（system prompt の節、verbatim）を**そのまま使う**。違いは 1 点だけ: c の 3 項目め「結果の文に残りの枚数が書いてある」はそのまま、b の `not_configured` も同じ。

`ant apply` の frontmatter での custom tool の書き方は未確認（p2 は API で確かめた）。`ant apply --dry-run` が通り、作られた agent の tools に `generate_image` が出ることを §O-8 の本番確認に入れる。

## §O-3 状態と遷移

### a. 状態（正本）

| state | 意味 | 次へ進める主体 | 止まった時に拾う主体 |
|---|---|---|---|
| `queued` | 受け付けた。8 枚に数え、job の取り置きがある | consumer（D） | cron: 5 分超 → 再投入（`enqueue_count < 3`）/ 3 回超 → failed `enqueue_exhausted` / job が有効でない → failed `job_ended` / 停止中 → refused `halted` |
| `dispatched` | OpenAI を呼ぶ権利を取った（呼んだかもしれない） | consumer（R） | cron: 10 分超 → failed `result_unknown` + 停止 |
| `done` | 画像を R2 に置いた | reconcile が職人へ返す | — |
| `refused` | 断った（入力・段階・上限・停止・設定） | reconcile が職人へ返す | — |
| `failed` | 失敗（理由コード） | reconcile が職人へ返す | — |

`done` / `refused` / `failed` は終端。終端の行は変わらない（掃除の `cleaned_at` だけ書く）。

**通知の状態は持たない**。終端の依頼を職人へ返すのは reconcile で、返したかどうかは session の events に `user.custom_tool_result`（その `custom_tool_use_id`）があるかで見る（既存の `answered`）。

停止 `settings.image_gen_halted`: 書くのは R（応答の後）・cron の stale・運営の「止める」。消すのは人の「再開する」だけ。自動では消えない。

取り置き（`cost_ledger` の `ih:<job_id>`）: 登録の batch で job の最初の依頼の時だけ作る（8 × U_max）。job が終端で、その job に queued / dispatched の依頼が無くなったら cron が 1 回だけ `if:<job_id>` に書き換え、額を「その job の OpenAI を呼んだ依頼の U の合計」にする。

### b. 入口: reconcile の requires_action（§B-4-d 手順 4 の差分）

1. 走査（`onIdle` の fold）: `stop_reason.event_ids` の `agent.custom_tool_use` のうち name が `generate_image` のものは、name と `input` を `blocked[id]` に保持する（`JSON.stringify(input)` が 16,384 文字超なら `{oversized:true}`）。他の custom tool は従来どおり name だけ。保存済みの集計に generate_image なのに `input` を持たない項目があれば捨てる
2. event_ids のうち `answered` にも `denied` にも無い generate_image の id ごとに、`image_requests` を `custom_tool_use_id` で引く:
   - 行が無い → 登録（§O-3 c の I）。登録の後、行が queued なら `IMAGE_GEN.send({request_id})`（失敗は無視。cron が拾う）
   - 行が終端 → 職人へ返す（§O-6 の event。1 件ずつ `sendEvents`）。送った id は今回の pending から外す。送信の例外は従来の送信失敗と同じ扱い（次の reconcile でもう一度。二重は p4a で無害）
   - 行が queued / dispatched → 何も送らない（待つ）
3. 残り（tool_confirmation と generate_image 以外の custom tool）は従来どおり送り、deny 数に数える
4. 送るものが無く、待っている generate_image だけなら `awaiting_image:<n>` を返す。§M-5b の「種別が分からない待ち」には数えない（種別は分かっている）
5. 待ちの終わり: 依頼は cron によって 15 分以内に必ず終端になる（queued 5 分 × 3 回 = 最長 15 分、dispatched 10 分）。終端になった後の reconcile が返す。reconcile は cron（10 分ごと）・webhook・consumer の終わり（§O-4 c 4）から起きる

**deny 数の派生**: 上限の判定に使う数 = `job.deny_count + imageDenies`。`imageDenies = SELECT COUNT(*) FROM image_requests WHERE job_id = ? AND state IN ('refused','failed')`。`stopIfTooManyDenies` を呼ぶ **3 か所**（reconcile の入口 `jobs.ts:973` 付近、answered を回収した後 `:1206` 付近、通常の deny を保存した後 `:1254` 付近）のすべてでこの和を渡す。`deny_count` 列を書くのは従来どおり reconcile だけ。

### c. 遷移の SQL（verbatim）

#### I 登録（reconcile。lease を持つ間だけ。batch = I1, I2。成否は I2 の changes）

先に `validateImageInput` と U の表で検査する。入力が不正・表に無い・`job.phase = 'questions'`・`OPENAI_API_KEY` が無い時は I1 を飛ばし、I3 で refused の行を入れる（理由 `bad_input:<field>` / `not_configured` / `questions_phase`）。

```sql
-- I1 取り置き（job の最初の依頼だけ。月と日次の判定はここだけ）
INSERT INTO cost_ledger (id, day, kind, ref_id, cents, created_at)
SELECT ?ledger_id, ?day, 'image', 'ih:' || ?job, ?hold, ?now
WHERE NOT EXISTS (SELECT 1 FROM cost_ledger WHERE kind = 'image' AND substr(ref_id, 4) = ?job)
  AND (SELECT value FROM settings WHERE key = 'image_gen_halted') IS NULL
  AND COALESCE((SELECT value FROM settings WHERE key = 'paused'), '0') <> '1'
  AND (SELECT COALESCE(SUM(cents), 0) FROM cost_ledger WHERE kind = 'image' AND substr(day, 1, 7) = ?month) + ?hold <= ?month_cap
  AND (SELECT COALESCE(SUM(cents), 0) FROM cost_ledger WHERE day = ?day)
      + ?verify_reserve * (SELECT COUNT(*) FROM material_versions WHERE verify_phase IN ('submitting','submitted','collecting'))
      + ?hold <= ?daily_cap;
-- I2 依頼（取り置きがあり、8 枚未満で、停止・一時停止でない時だけ queued）
INSERT INTO image_requests (id, custom_tool_use_id, job_id, session_id, model, size, quality, format, background, u_cents, input_json,
                            state, enqueue_count, enqueued_at, created_at, updated_at)
SELECT ?id, ?tool_use_id, ?job, ?session, ?model, ?size, ?quality, ?format, ?background, ?u, ?input_json,
       'queued', 1, ?now, ?now, ?now
WHERE EXISTS (SELECT 1 FROM cost_ledger WHERE kind = 'image' AND ref_id = 'ih:' || ?job)
  AND (SELECT value FROM settings WHERE key = 'image_gen_halted') IS NULL
  AND COALESCE((SELECT value FROM settings WHERE key = 'paused'), '0') <> '1'
  AND (SELECT COUNT(*) FROM image_requests WHERE job_id = ?job AND state <> 'refused') < 8
  AND NOT EXISTS (SELECT 1 FROM image_requests WHERE custom_tool_use_id = ?tool_use_id);
```

- `?hold = 8 × U_max`（= 280）。`?month` は `?day` の先頭 7 文字。`?verify_reserve` と `?daily_cap` は `verify.ts` の `claimSubmit` と同じ値（`cfg(env).verifyTurnReserveCents` / `dailyCapCents`）。日次の式は `claimSubmit` と同じ形にする（`src/images.ts` に置かず、`verify.ts` の式を関数 `dailyReservedSql()` に出して両方から使う）
- I2 が 0 行なら I3 で refused を入れる。理由は I2 の後に読み直して決める（決定は I2 の 1 文で済んでいる。理由は職人への文と表示のためだけ）: 停止中 → `halted` / 一時停止中 → `paused` / 8 枚 → `job_image_limit` / 取り置きが無く月が足りない → `monthly_cap` / 取り置きが無く日次が足りない → `daily_cap` / それ以外 → `reserve_conflict`

```sql
-- I3 断り（同じ custom_tool_use_id の行が無い時だけ）
INSERT INTO image_requests (id, custom_tool_use_id, job_id, session_id, input_json, state, error, created_at, updated_at)
SELECT ?id, ?tool_use_id, ?job, ?session, '{}', 'refused', ?error, ?now, ?now
WHERE NOT EXISTS (SELECT 1 FROM image_requests WHERE custom_tool_use_id = ?tool_use_id);
```

取り置き I1 が通ったのに I2 が 0 行（8 枚・停止の競合）の時も、取り置きは残る。job の終わりに F が「呼んだ分の U の合計」（0 なら 0）へ書き換える。

#### D 呼ぶ権利（consumer。1 文。0 行なら OpenAI を呼ばない）

```sql
UPDATE image_requests SET state = 'dispatched', dispatch_token = ?token, dispatched_at = ?now, updated_at = ?now
WHERE id = ?id AND state = 'queued'
  AND (SELECT value FROM settings WHERE key = 'image_gen_halted') IS NULL
  AND EXISTS (SELECT 1 FROM factory_jobs j WHERE j.id = image_requests.job_id
              AND j.status IN ('running','budget_reached') AND j.phase = 'making');
```

一時停止（paused）は D に掛けない（受け付けた画像はやりきる。裁定 2）。

#### R 結果（consumer。D の token を持つ側だけ。batch = R1, R2。成否は R1 の changes）

R の前に、画像が使えるなら R2 に `img/{job_id}/{request_id}/{dispatch_token}.{format}` で put する（put の失敗は「使えない画像」と同じ扱い）。

```sql
-- R1 終端へ（同じ token の dispatched の時だけ）
UPDATE image_requests
SET state = ?state,                 -- 'done' か 'failed'
    error = ?error,                 -- done は NULL
    usage_json = ?usage_json, actual_cents = ?actual_cents,
    r2_key = ?r2_key, sha256 = ?sha256, bytes = ?bytes, media_type = ?media_type,
    updated_at = ?now
WHERE id = ?id AND state = 'dispatched' AND dispatch_token = ?token;
-- R2 停止（?halt が NULL でない時だけ。最初の理由を残す）
INSERT INTO settings (key, value, updated_at) SELECT 'image_gen_halted', ?halt, ?now
WHERE ?halt IS NOT NULL
  AND EXISTS (SELECT 1 FROM image_requests WHERE id = ?id AND state = ?state AND dispatch_token = ?token AND updated_at = ?now)
ON CONFLICT(key) DO NOTHING;
```

`?halt` は**どの結果でも同じ純関数** `haltReasonFor(outcome)` で決める（画像が使えるか・応答があったかで分けない）:

| 結果 | `?state` / `?error` | `?usage_json` / `?actual_cents` | `?halt` |
|---|---|---|---|
| 画像が使え、usage あり、実額 ≤ U | done / NULL | usage / 実額 | NULL |
| 画像が使え、usage あり、実額 > U | done / NULL | usage / 実額 | `over_reserve:<request id>` |
| 画像が使え、usage なし | done / NULL | `{"missing":true}` / NULL | `usage_missing:<request id>` |
| 応答あり・画像が使えない（不正・4 MiB 超・R2 put 失敗） | failed / `bad_response` か `too_large` | 読めた usage / 実額、無ければ missing / NULL | 上の 2 行と同じ規則（実額 > U → over_reserve、missing → usage_missing） |
| 応答あり・HTTP の失敗 429 / 5xx / 400 / moderation | failed / `rate_limited` / `server` / `bad_request` / `moderation` | 読めれば usage、無ければ NULL（課金なしとみなす） | 実額 > U なら over_reserve、それ以外 NULL |
| 応答あり・quota / 残高 | failed / `quota` | 同上 | `quota` |
| 応答あり・401 / 403 | failed / `auth` | 同上 | `auth` |
| 応答不明（timeout・接続断・本文の途中の中断） | failed / `result_unknown` | NULL / NULL | `result_unknown:<request id>` |

R2 は「R1 が今回の時刻で書いた行がある」ことを条件にする（前の文の結果を見る形）。R1 が 0 行（cron が先に failed にした）なら停止も書かない（cron 側が書いている）。

#### C cron の回収（§O-4 d。各文 1 行ずつ、読んだ id で）

```sql
-- C1 queued の再投入（5 分超・3 回未満）。changes = 1 なら send
UPDATE image_requests SET enqueue_count = enqueue_count + 1, enqueued_at = ?now, updated_at = ?now
WHERE id = ?id AND state = 'queued' AND enqueued_at < ?now_minus_5min AND enqueue_count < 3
  AND (SELECT value FROM settings WHERE key = 'image_gen_halted') IS NULL
  AND EXISTS (SELECT 1 FROM factory_jobs j WHERE j.id = image_requests.job_id AND j.status IN ('running','budget_reached') AND j.phase = 'making');
-- C2 queued の打ち切り（停止中 → refused halted / job が有効でない → failed job_ended / 3 回超 → failed enqueue_exhausted）
UPDATE image_requests SET state = ?state, error = ?error, updated_at = ?now
WHERE id = ?id AND state = 'queued';
-- C3 dispatched の打ち切り（10 分超）+ 停止（batch。成否は C3a）
UPDATE image_requests SET state = 'failed', error = 'result_unknown', updated_at = ?now
WHERE id = ?id AND state = 'dispatched' AND dispatched_at < ?now_minus_10min;
INSERT INTO settings (key, value, updated_at) SELECT 'image_gen_halted', 'result_unknown:' || ?id, ?now
WHERE EXISTS (SELECT 1 FROM image_requests WHERE id = ?id AND state = 'failed' AND error = 'result_unknown' AND updated_at = ?now)
ON CONFLICT(key) DO NOTHING;
```

C2 の理由は読んだ値で決める（停止中を優先、次に job、次に回数）。C2 は `state = 'queued'` だけを条件にするので、D と競っても片方だけが勝つ。

#### F 取り置きの確定（cron。job ごとに 1 文。1 回だけ）

```sql
UPDATE cost_ledger
SET ref_id = 'if:' || ?job,
    cents = (SELECT COALESCE(SUM(u_cents), 0) FROM image_requests WHERE job_id = ?job AND dispatched_at IS NOT NULL)
WHERE kind = 'image' AND ref_id = 'ih:' || ?job
  AND EXISTS (SELECT 1 FROM factory_jobs WHERE id = ?job AND status IN ('done','failed','cancelled'))
  AND NOT EXISTS (SELECT 1 FROM image_requests WHERE job_id = ?job AND state IN ('queued','dispatched'));
```

- 額は下がる方向だけ（呼んだ数 ≤ 8 なので ≤ 8 × U ≤ 8 × U_max = 取り置き）。日は取り置きの日のまま（月をまたいでも元の月）
- `rework` など別の job は別の取り置き（同じ job を使い回さない。裁定 9）

#### H 運営の操作（§O-5 e のルート）

```sql
-- H1 止める
INSERT INTO settings (key, value, updated_at) VALUES ('image_gen_halted', 'manual', ?now) ON CONFLICT(key) DO NOTHING;
-- H2 再開する（dispatched が 1 つも無い時だけ）
DELETE FROM settings WHERE key = 'image_gen_halted'
  AND NOT EXISTS (SELECT 1 FROM image_requests WHERE state = 'dispatched');
```

H2 は人が OpenAI の利用画面で実額を確かめてから押す前提（画面の文に書く）。金額の入力はない（記帳は U で確定しているので直す値が無い）。

### d. 止まった場所ごとの帰結（状態 × 失敗点 × 書き込みが確定したか）

| 止まった所 | D1 の状態 | 次に起きること | 収束 |
|---|---|---|---|
| I1 の後、I2 の前（同じ batch） | どちらも無い（batch は 1 トランザクション） | 次の reconcile が登録し直す | 次の reconcile |
| I2 の後、send の前 | queued、message 無し | cron C1 が 5 分後に send | ≤ 15 分で終端 |
| consumer が D の前に落ちた | queued | Queue の再試行 or C1 | 同上 |
| D の後、OpenAI を呼ぶ前に落ちた | dispatched | 再試行の consumer は D が 0 行で呼ばない。C3 が 10 分で failed + 停止 | 10 分。費用は U（取り置きの内） |
| OpenAI の応答待ちで落ちた | dispatched | 同上（課金されたか分からない → 停止） | 10 分 |
| 応答を受けた後、R2 put の前 / 後、R1 の前に落ちた | dispatched | 同上。R2 の物体は孤立（掃除が prefix で消す） | 10 分 |
| R1 の後 | 終端 | reconcile が返す | 次の reconcile |
| C3 の後に遅れた consumer の R1 | failed | R1 は 0 行（state 条件）。R2 の物体は孤立 | — |
| reconcile が sendEvents の後、保存の前に落ちた | 終端（D1 は送信を記録しない） | 次の reconcile が events の `answered` で見る。見えなければもう一度送る（p4a で無害） | 次の reconcile |
| job が cancel / failed になった時に queued | queued | D は 0 行。C2 が failed `job_ended` | ≤ 5 分 |
| job が終端の時に dispatched | dispatched | 生成は進む。R1 で done。返す先の session は archive 済みなら 400（無害）。F は dispatched が無くなってから | 10 分以内 |

どの行も、待ちは最長 15 分で終端になり、終端の依頼は reconcile が返すか、session が終わって不要になる。

### e. 段階 1 への降格

降格してよいのは、次の 2 つがともに 0 の時: (1) `SELECT COUNT(*) FROM image_requests WHERE state IN ('queued','dispatched')` (2) 確認待ち・承認済みの版のうち、files に `image_id` を持つものの数。0 でない時は先に止める（H1）→ 15 分待つ → 画像付きの版を「却下」か「配信を止める」。段階 1 では `generate_image` に従来の is_error（§M-5 互換）を返す。

## §O-4 実行場所

| 経路 | やること | やらないこと |
|---|---|---|
| reconcile（webhook・管理画面・cron・consumer の終わりから） | 登録（I）・send・終端の依頼を職人へ返す | 生成 |
| Queue consumer `factory-image-gen` | 依頼 1 件を D → 生成 → R2 put → R → reconcile | 職人へ直接返す（返すのは reconcile だけ） |
| cron 段 3-c | C1〜C3・F・掃除・ログ。停止中・一時停止中も行う | 生成（D を呼ばない） |

DLQ は置かない（Queue の再試行が尽きた message の依頼は queued のまま残り、C1・C2 が拾う）。

### a. `wrangler.jsonc` の差分（verbatim）

```jsonc
  "queues": {
    "producers": [{ "binding": "IMAGE_GEN", "queue": "factory-image-gen" }],
    "consumers": [
      { "queue": "factory-image-gen", "max_batch_size": 1, "max_retries": 2, "max_concurrency": 2, "retry_delay": 30 }
    ]
  },
```

`vars` に足す: `"IMAGE_MODEL_STANDARD": "gpt-image-2.5-flare"`, `"IMAGE_MODEL_SCIENTIFIC": "gpt-image-2.5-sunburst"`, `"IMAGE_MONTHLY_CAP_CENTS": "3000"`。queue は deploy 前に `wrangler queues create factory-image-gen` で作る（本番の変更。司令塔がふじさんに確認）。

`src/env.ts`: `IMAGE_GEN?: Queue<{ request_id: string }>`、上の 3 つの var、secret `OPENAI_API_KEY?`。コードの定数（`src/images.ts`。var にしない）: 1 job 8 枚 / 再投入 3 回 / queued 5 分 / dispatched 10 分 / prompt 4000 バイト / alt 120 文字 / 生成の締め切り 150 秒 / cron 段の予算 60 秒・各 20 件。

### b. `src/index.ts` の `queue` handler

```ts
async queue(batch: MessageBatch<{ request_id: string }>, env: Env, ctx: ExecutionContext): Promise<void> {
  const portCtx = { hostname: null, fakeEnabledSetting: await getSetting(env.DB, 'fake_enabled') };
  const port = await getPort(env, portCtx);
  const images = await getImagePort(env, portCtx);
  for (const msg of batch.messages) {
    const id = String((msg.body as { request_id?: unknown })?.request_id ?? '');
    if (!/^img_[0-9a-f]{32}$/.test(id)) { msg.ack(); continue; }
    try {
      await runImage(env, port, images, id, { deadline: Date.now() + 5 * 60_000 });
      msg.ack();
    } catch (e) {
      console.log(JSON.stringify({ at: 'image_queue', request_id: id, error: e instanceof Error ? e.name : 'error' }));
      msg.retry();
    }
  }
}
```

### c. consumer の手順 `runImage(env, port, images, requestId, {deadline})`

1. 依頼を読む。`queued` でなければ 5 へ（他の consumer か cron が進めた）
2. D（新しい token）。0 行なら 5 へ（停止中・job が有効でない・他が取った。queued のままなら cron が C2）
3. `images.generate({model, prompt, size, quality, output_format: format, background, n: 1}, {deadline: min(deadline, now + 150 秒)})` → 結果を §O-3 c の R の表の 1 行に分類（`OpenAiError` の kind で）。画像が使えれば R2 put
4. R（batch R1, R2）
5. `reconcileJob(env, port, job_id, { deadline: min(deadline, now + 25 秒) })` を呼ぶ（job が終端・lease 競合なら何もせず返る。失敗は無視。cron が拾う）

D1 の例外は投げ直して Queue の再試行に任せる（再試行の consumer は 1 から。D の後なら 2 が 0 行で呼ばない）。

### d. cron 段 3-c「画像の回収」（§B-5 の 3-b triage の直後。締め切り = min(開始 + 60 秒, cron の締め切り)。各項目 20 件まで）

1. C3: `state = 'dispatched' AND dispatched_at < ?now_minus_10min`
2. C2 → C1: `state = 'queued' AND enqueued_at < ?now_minus_5min`（停止中・job が有効でない・`enqueue_count >= 3` は C2、それ以外 C1 → send）
3. F: `kind = 'image' AND ref_id GLOB 'ih:*'` の job
4. 掃除（§O-6 c）
5. ログ（数値と固定コードだけ）: `{at:'image_cron', queued, dispatched, halted, month_cents, holds_open}`

### e. port の追加

旧下書き §M-2-4 e の **`src/openai.ts`**（`OpenAiError`・`ImageUsage`・`ImageGenParams`・`ImagePort`、締め切り、4 MiB、分類に読むのは status と `error.code` だけ、usage の details 欠落の扱い）と **`src/fake/openai.ts`**（シナリオ一覧・呼び出しの記録・`loadFake` 経由）を**そのまま使う**。fake のシナリオに `bad_bytes_with_usage`（不正な画像 + out_image 20,000）を足す。

`FactoryPort` への追加は §O-6 の形で決まる: 形 A（base64）なら追加なし。形 B（file）なら旧下書き §M-2-4 e の `uploadFile` / `deleteFile`。

## §O-5 費用

### a. U の表

旧下書き §M-2-5 a の表をそのまま使う（high 以下 10¢、max 35¢、表に無い組み合わせは `not_configured`）。U_max = 35、取り置き = 8 × 35 = 280¢。

### b. 実額（表示と停止の判定だけ）

`micro = in_text × 5 + in_image × 8 + out_image × 30 + out_text × 30`、`actual_cents = ceil(micro / 10,000)`。記帳には使わない（記帳は U で確定している）。

### c. 上限のかかり方

| 上限 | 値 | どの文で |
|---|---|---|
| 月 | `IMAGE_MONTHLY_CAP_CENTS` = 3000（`kind='image'`、Asia/Tokyo の暦月） | I1（job の最初の依頼だけ。取り置き 280 が入るか） |
| 日次 | `DAILY_CAP_CENTS`。記帳の日次合計 + 検証の飛行中予約 + 280 | I1（同上）。`claimSubmit` と同じ式 |
| 1 job 8 枚 | `state <> 'refused'` の行 < 8 | I2 |
| 停止 | `image_gen_halted` が無い | I1・I2・D・C1 |
| 一時停止 | `paused` でない | I1・I2（新しい依頼だけ。D には掛けない） |
| 同時に OpenAI を呼ぶ数 | 2 | queue の `max_concurrency`（D1 では数えない） |

「やりきる」の扱い: 受け付けた依頼（queued）は、一時停止中も最後まで進める。停止中は queued を断り、dispatched だけ最後まで進める。月の上限は job の最初の依頼にだけ掛かり、取り置きがあるので、その job の 8 枚目までは月の判定をしない（記帳はすでに 8 枚分ある）。

日次の保証の範囲: 日次の判定は記帳と検証の予約だけを見る。走っている session の予算（`startJob` が数えるもの）は見ない（検証係の `claimSubmit` と同じ範囲）。

### d. 停止の理由

`manual` / `over_reserve:<id>` / `usage_missing:<id>` / `result_unknown:<id>` / `quota` / `auth`。画面の文: `manual`「手で止めました」/ `over_reserve`「1 枚の実額が予約額を超えました」/ `usage_missing`「1 枚の費用が分かりませんでした」/ `result_unknown`「結果が分からない生成があります」/ `quota`「OpenAI の残高か上限に達しました」/ `auth`「OpenAI の鍵が使えません」。

### e. 運営の操作（認証は §B-1 の admin と同じ。GET 以外は Origin 検証）

| Method / Path | 入力 | 処理 / 応答 |
|---|---|---|
| `GET /api/images/status` | — | `{halted: <理由>\|null, month_cents, month_cap_cents, holds_open, dispatched: n, recent: [{request_id, job_id, state, error, model, size, quality, u_cents, actual_cents, created_at}]（新しい順 20 件）}` |
| `POST /api/images/halt` | — | H1。200 `{halted}` |
| `POST /api/images/unhalt` | — | H2。0 行で dispatched が残る → 409 `dispatched_remain`、停止していない → 409 `not_halted` |
| `GET /api/images/requests/:id/file` | — | `state = 'done'` の時だけ R2 の `r2_key` を §M-3 のヘッダで返す。他は 404 |
| `GET /api/status` | 既存に追記 | `images: {halted, month_cents, month_cap_cents}` |

監査: `console.log({at:'image_halt'|'image_unhalt'})`。

画面: 状況帯に「画像: 今月 N¢ / 3000¢（U で数えた記帳）」と、停止中なら「画像の生成を止めています（<理由の文>）」と `#/images` へのリンク。`#/images` に停止の状態と「止める」「再開する」（再開の確認ダイアログに「OpenAI の利用画面で実額を確かめてから押してください」）、最近の 20 件（U と実額を並べ、実額 > U は強調）。

UI acceptance criteria（ui-interaction-completeness）:
- [ ] CRUD 対称: 「止める」「再開する」の両方がある。最近の一覧は読むだけ（記帳と監査の記録なので消さない）
- [ ] フィードバック: 処理中は disabled +「処理中」、成功・失敗（409 の理由を文で）をトースト。二重送信不可
- [ ] 状態: 一覧 0 件（「まだありません」）/ 読み込み中 / 取得失敗の表示
- [ ] 実機: 止める → 状況帯に停止の文が出る → 再開する → 消える、を DOM の要素数で確かめる

## §O-6 結果の返し方と保存キー

### a. `user.custom_tool_result`

**形は probe p5 の結果で 1 つに決める（凍結の条件）**。p5 は「file 参照」「base64 直」の両方で青い三角を返し、職人が内容を言い当てられるかを見る。

- 形 A（base64 直）: `{"type":"image","source":{"type":"base64","media_type":"image/png"|"image/webp","data":"<R2 の物体の base64>"}}`。reconcile が返す時に R2 から読む。Files を使わない
- 形 B（file 参照）: reconcile が返す時に、`file_id` が NULL なら R2 から読んで `uploadFile` → `UPDATE image_requests SET file_id = ? WHERE id = ? AND file_id IS NULL`（0 行なら今 upload した file を `deleteFile`）→ `{"type":"image","source":{"type":"file","file_id":"<file_…>"}}`
- 両方通れば A を採る（状態と外部の置き場所が 1 つ減る）。片方だけ通ればそれを採る。どちらも駄目なら画像を返さず text だけにする形 C を検討する（職人は絵を見られない。オーナーに確認）

成功（`done`）の content は `[image block, text]`、text は旧下書き §M-2-6 a の成功の文（`{remaining}` = 8 − その job の `state <> 'refused'` の行数）。断り・失敗は `is_error: true` と旧下書き §M-2-6 a の表の文。表の error に `paused`（「今は画像を作れません。図は SVG で描いてください。」）・`usage_missing` 系は無い（usage_missing は done なので成功の文）・`job_ended`・`enqueue_exhausted`（「画像を作れませんでした。…」）を合わせる。`upload_failed` / `not_dispatched` / `dlq` / `image_slot_unavailable` は無くなったので表から消す。

### b. 保存キー

| もの | キー |
|---|---|
| image_id | `img_` + `crypto.randomUUID()` の hex 32 桁 |
| R2（生成した画像） | `img/{job_id}/{request_id}/{dispatch_token}.{png\|webp}`。R1 が `r2_key` と `sha256` を確定する |
| R2（版の中） | 取り込みが既存の論理キーへ写す |
| Files（形 B だけ） | filename `{request_id}.{format}` |

### c. 掃除（cron 段 3-c 4）

`cleaned_at IS NULL AND state IN ('done','refused','failed')` で、job が 30 日より前に更新され `done` / `cancelled`、または `failed` かつ `error <> 'invalid_outputs'`。各 20 件: R2 の `img/{job_id}/{request_id}/` 配下を消す（孤立した物体も含む）→（形 B なら `deleteFile`）→ `cleaned_at` を書く。

## §O-7 取り込み・確認画面・配信への影響

旧下書き §M-2-7 の 1〜8 を**そのまま使う**。違いは 2 点: 2 の条件の `gen = 'uploaded'` を `state = 'done'` に、「`kind = 'job'`」を削る（probe が無い）。6 は裁定 8 どおり `GET /api/review/:version_id` に `generated_images: [{path, accuracy, prompt, alt}]` を足し、確認画面のサムネイルの下に「生成: {accuracy}・{prompt の先頭 80 字}」を出す。

## §O-8 受け入れ基準と検証コマンド

### vitest（`node:sqlite` の実 DB + fake の port）

| # | 確かめること | FAIL しうる対照 |
|---|---|---|
| t1 | 月の記帳 2721¢ で新しい job → I1 0 行・refused `monthly_cap`。2720¢ なら通る（2720 + 280 = 3000） | 境界の 1¢ |
| t2 | 取り置きのある job は月が 3000 に達しても 8 枚目まで queued | 取り置きの無い 2 つ目の job は monthly_cap |
| t3 | 9 枚目 → refused `job_image_limit`。refused の行は数えない（refused 3 + 受付 8 まで通る） | — |
| t4 | 日次: 記帳 1000 + 検証の飛行中 1 × 予約 + 280 が `DAILY_CAP_CENTS` を超える → daily_cap（旧 M1 の再現: 記帳 1235・検証予約 300・上限 1500 で 0 行） | 検証予約 0 なら通る |
| t5 | 2 つの consumer が同じ依頼で D → 1 つだけ changes = 1、fake OpenAI は 1 回 | — |
| t6 | R の表の全行（fake のシナリオ）: 状態・error・actual_cents・停止の理由が表どおり。**不正な画像 + usage 超過で停止する**（旧 B1）。**usage 欠落で停止する**（旧 M4） | 実額 ≤ U の正常は停止しない |
| t7 | C3 の後に遅れた R1 は 0 行、停止は 1 回だけ（理由は result_unknown） | — |
| t8 | queued × 停止 / job cancel / 3 回 → C2 の理由が順位どおり。D は 0 行 | — |
| t9 | F: job 終端・queued / dispatched 無し → 1 回だけ if:、額 = 呼んだ分の U の合計。dispatched が残る間は 0 行。2 回目は 0 行 | — |
| t10 | reconcile: generate_image → I と send 1 回。終端の依頼 → result 1 回。events に result がある（answered）→ 送らない。queued → 送らず `awaiting_image:1`。tool_confirmation との混在では deny は tool_confirmation だけ | answered の無い fixture では送る |
| t11 | deny 数の派生を 3 か所で使う: refused / failed 9 件 → 入口で `too_many_denies` | 8 件では止まらない |
| t12 | 入力検査（旧 t17）・U の表（旧 t18）・取り込みの image_id（旧 t19 の `uploaded` を `done` に）・鍵の印（旧 t20）・(m6) の置き換え（旧 t23） | 旧と同じ |
| t13 | migration 0004: 既存の台帳と `idx_cost_ledger_vb` が残る・image は job ごとに 1 行（ih と if で 2 行にならない） | — |
| t14 | 結果の形（§O-6 で決めた形 A か B）と文の表 | — |

### smoke（fake の Anthropic + fake の OpenAI、ローカル queue）

- (i1) 注文 → generate_image の webhook → consumer → fake OpenAI 1 回 → reconcile が result 1 回 → 版に png → 確認画面のサムネイルと生成の情報 → 承認 → 配信の SHA-256 が `sha256` と一致
- (i2) 承認前・停止後・別 job・sha 不一致の画像は 404 / invalid_outputs（対照: (i1) は配信される）
- (i3) enqueue の後に cancel → fake OpenAI 0 回・failed `job_ended`
- (i4) 9 回目 → OpenAI は 8 回のまま
- (i5) 同じ turn で generate_image を 3 つ → 3 件とも result、生成 3 回
- (i6) 同じ message を 3 回 send → 生成 1 回・result 1 回
- (i7) 止める → queued は refused、dispatched は done で返る。再開する → 次の依頼が通る
- (i8) `quota` → 停止、次の cron でも停止のまま
- (i9) `no_usage` → done + 停止（usage_missing）/ `over_reserve` → done + 停止 / `bad_bytes_with_usage` → failed + 停止
- (i10) 月の記帳 2721 で新しい job → monthly_cap、取り置きのある job は続く
- (i11) 返す送信を fake で 1 回失敗 → 次の reconcile が送る、result は 1 件
- (i12) 運営の操作の画面（DOM の要素数とトースト）
- (i13) 既存の smoke が全件 PASS

### 本番確認（deploy 後。司令塔）

1. p5 の結果で §O-6 の形を決めてから凍結（この下書きの凍結条件）
2. queue を作り（ふじさんに確認）段階 2 を deploy。職人定義にはまだ tool を足さない
3. 職人定義に §O-2 を足して `ant apply --dry-run` → `ant apply`（tools に `generate_image`）→ 実 session で 1 枚（見て採用・描き直し → 取り込み → 確認画面）
4. `background: transparent`・`webp` を 1 枚（param 名の確認）

### 検証コマンド

```sh
cd factory/worker
npm run typecheck
npm test
npm run migrate:local
npm run smoke            # SMOKE_RESULT=PASS
bash scripts/check-no-fake.sh
grep -rl -e 'api.openai.com' -e 'OPENAI_API_KEY' src; echo "rc=$?"   # src/env.ts と src/openai.ts の 2 行だけ・rc=0
gitleaks detect --no-git
```

## §O-9 旧下書きへのレビュー指摘の行き先

| 指摘 | 本版での扱い |
|---|---|
| B1 使えない画像で usage 超過を精算・停止しない | 精算が無い。停止の判定は全結果で同じ関数（R の表）。t6 |
| B2 15 分打ち切りの通知・精算が未定義、照合が有限終了しない | 通知の状態と照合が無い。待ちは C1〜C3 で 15 分以内に終端。§O-3 d |
| M1 日次が検証の予約を見ない | I1 が `claimSubmit` と同じ式。t4 |
| M2 古い照合で受理済みの再送を abandoned | abandoned も照合も無い。届いたかは events で見る |
| M3 超過記帳と 3490¢ の不整合 | 超過は記帳しない。保証は G1（U で数えた記帳 ≤ 3000）と G3（上界を主張しない） |
| M4 usage 欠落で停止しない | usage_missing で停止。t6 |
| M5 interrupt/archive の後始末 | 既存の欠陥。Issue へ（§O-0） |
| minor: deny の 3 か所 | §O-3 b に 3 か所を明記。t11 |
| minor: 手動精算 1000¢ | 手動精算が無い |

## §O-10 裁定（2026-11-05）の扱い

| 裁定 | 本版 |
|---|---|
| 1 §O | そのまま |
| 2 paused は新しい依頼を断る | そのまま（I1・I2） |
| 3 超過を iax で記帳 | **取り下げ**。超過は記帳せず `actual_cents` で表示し、停止する（M3） |
| 4 表に無い組み合わせは入れない | そのまま |
| 5 p5 を先に | そのまま（§O-6 の凍結条件） |
| 6 15 分で is_error | 形を変えた: 15 分で依頼が終端になり、reconcile が is_error で返す（捨てるのは queued のまま進まなかったものだけ。dispatched は 10 分で result_unknown） |
| 7 個別に返す | そのまま（i5） |
| 8 generated_images | そのまま（§O-7） |
| 9 作り直しは前の画像を使わない | そのまま（取り置きも job ごと） |
| 10 Files は期限なし | 形 B を採った時だけ |
| 11 probe を本体に入れない | そのまま。一時 route は §O の実装で削除 |

## §O-11 範囲（実装担当が触るもの）

| ファイル | 変更 |
|---|---|
| `migrations/0004_image_gen.sql` | 新規（§O-1） |
| `src/images.ts` | 新規。U の表・入力検査・I/D/R/C/F/H の SQL・`haltReasonFor`・`runImage`・cron 段 |
| `src/openai.ts` / `src/fake/openai.ts` | 新規（§O-4 e） |
| `src/verify.ts` | 日次の式を `dailyReservedSql()` に出す（挙動は変えない）・検証係の入力に画像の説明（§O-7） |
| `src/jobs.ts` | reconcile の requires_action（§O-3 b）・deny 数の派生 3 か所・取り込みの image_id |
| `src/checks/schema.ts` / `layout.ts` | files[] の image_id / alt（§O-7） |
| `src/cron.ts` | 段 3-c |
| `src/index.ts` | `queue` handler・§O-5 e のルート・**一時 route `/api/probe/image-tool` と `src/routes/probe.ts` を削除** |
| `src/routes/images.ts` / `src/routes/status.ts` / `src/routes/review.ts` | 新規 / 追記 |
| `src/env.ts` / `wrangler.jsonc` | §O-4 a |
| `public/admin/*` | 状況帯・`#/images`・確認画面の生成の情報 |
| `test/*` / `scripts/smoke.mjs` | §O-8 |

司令塔が書くもの: 職人定義の tools と本文（§O-2）、rubric（files の image_id に alt があることだけ見る）、`CONTRACT-factory.md` への反映。
