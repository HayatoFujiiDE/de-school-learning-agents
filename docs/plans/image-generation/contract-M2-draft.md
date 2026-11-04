# §M-2 画像の生成（段階 2）— 契約の下書き（2026-11-05。司令塔が CONTRACT-factory.md へ入れる前の版。未凍結）

正本の順位: plan-v6 → plan-v5 → plan-v4（中の v3・v2 を含む）。状態表は plan-v5 §5-2 に plan-v6 §3 の追記を足したもの。オーナーの決定は context.md、本番の実測は probe-results.md（p1〜p4）。計画どうしの食い違いの扱いは末尾の「採否」。plan に無く判断が要るものは §M-2-9 に選択肢で並べ、本文では決めていない（本文中に「未決 #n」と書いた箇所）。

書き方: `?name` は名前付きの値（実装では位置の `?` に置き換える）。「batch」は §B-2 の条件付き batch（D1 の 1 トランザクション、文は上から順に実行）。本書の SQL はすべて下書き作成時に `node:sqlite`（migrations 0001〜0003 + 本書の 0004）で実行し、構文と主な述語（t1・枠・8 枚・重複 dispatch・精算 1 回・halted の取り消し・stored を unknown にしない・probe の許可）を確かめた。§B-2 の「各 UPDATE の述語が互いの更新列に依存しない」の例外として、本書の batch では**後の文の述語が前の文の結果（今回の行がある・今回の時刻 / token になった）を見る**形を使う（plan-v6 §1 と同じ形。前の文が 0 行なら後の文も 0 行になる）。

---

## §M-2-0 目的・範囲・範囲外

**目的**: 職人（Managed Agents の session）が custom tool `generate_image` で絵を作り、返ってきた絵を見て描き直すか採用できる。採用した絵は取り込み（§B-4-d）で版に入り、確認画面（§L-6）で人が見て、承認後にだけ配信（§B-7・§M-3）される。

**保証（数値はすべて §M-2-5 の値）**
- (G1') 新しい job が画像を始められるのは、月の画像の記帳 + U_max ≤ 月の上限（3000¢）の時だけ
- (G3') 月の記帳の超過は、上限に届いた時点で枠を持っていた job（最大 2）の残り試行（最大 7）× U_max まで。記帳 ≤ 3000 + 2 × 7 × 35 = **3490¢**
- (G2) 実際の請求が記帳を超えるのは、ある試行の実額が U を超えた時だけ。毎回の usage で検出して `image_gen_halted` を書き、以後の予約と dispatch を止める。超過は「止める前に飛行中だった試行（最大 2）」の (実額 − U) に限られ、**数値の上界は主張しない**（OpenAI の出力費用は公式でも見積り）。管理画面・README の「月 $30」は「画像の記帳の目安（上限の判定に使う）」と書く
- 1 注文（job）あたりの試行は 8 まで（描き直し・429 の再試行も 1 と数える）。1 依頼あたりの試行は 2 まで
- `OPENAI_API_KEY` は Worker secret だけ。D1・R2・ログ・作業場・custom_tool_result・Files に出ない
- 画像も人の承認なしに配信されない（配信の可否の条件は §B-7 のまま）

**範囲（実装担当が触るもの）**

| ファイル | 変更 |
|---|---|
| `migrations/0004_image_gen.sql` | 新規（§M-2-1 verbatim） |
| `src/images.ts` | 新規。U の表・入力検査（純関数）、予約・dispatch・精算・取り消し・upload・通知の SQL（§M-2-3）、consumer の手順 `advanceImage`、DLQ の手順、cron の段 `imageCronStep`（§M-2-4） |
| `src/openai.ts` | 新規。OpenAI Images の port（`ImagePort`）と `OpenAiError`。`api.openai.com` と `OPENAI_API_KEY` を読むのはここと `env.ts` だけ |
| `src/fake/openai.ts` | 新規。fake の OpenAI。`src/fake/anthropic.ts` から re-export し、読み込みは `src/anthropic.ts` の `loadFake`（FAKE_GUARD の動的 import 1 箇所）だけ。`check-no-fake.sh` は変えない |
| `src/anthropic.ts` / `src/fake/anthropic.ts` | `FactoryPort` に `uploadFile` / `deleteFile`、`getImagePort(env, ctx)` を足す（§M-2-4）。fake は events に `agent.custom_tool_use` の本体（name・input）を持てるようにする |
| `src/jobs.ts` | reconcile の requires_action 分岐（§M-2-3-b）、deny 数の派生（同）、取り込みの image_id（§M-2-7） |
| `src/checks/schema.ts` / `src/checks/layout.ts` | files[] の `image_id` / `alt`、image_id の論理パスの予約（§M-2-7） |
| `src/verify.ts` | 検証係の入力に画像の説明を足す（§M-2-7） |
| `src/cron.ts` | 段 3-c「画像の引き取り」（§M-2-4） |
| `src/index.ts` | `queue` handler、§M-2-5 のルート。**一時 route `/api/probe/image-tool` と `src/routes/probe.ts` を削除**（鍵の lint を通すため） |
| `src/routes/images.ts` | 新規（§M-2-5 の運営の操作） |
| `src/routes/status.ts` | `GET /api/status` に `images` を足す |
| `src/env.ts` / `wrangler.jsonc` | §M-2-4 の差分 |
| `public/admin/*` | 状況帯の画像の表示と `#/images`（§M-2-5） |
| `test/*` / `scripts/smoke.mjs` / `scripts/check-no-fake.sh` | §M-2-8。`test/d1-shim.ts` の migration 一覧に 0004 を足す。既存の (m6) は「generate_image 以外の custom tool」に置き換える |

司令塔が書くもの（実装担当は触らない。§D）: `factory/claude/agents/material-maker.md` の tools と本文（§M-2-2）、rubric（画像の中身は採点しない。files の image_id に alt があることだけ見る）、`CONTRACT-factory.md` への反映。

**範囲外**: 描き直しの元画像を入れる編集（v1/images/edits。未決 #4）/ 1024x1536・xhigh（未決 #4）/ JPEG / 画像の Batch API / バディ側の生成 / 動画 / 画像の中身の自動の事実検証（検証係は画像を見ない。§L-6 で人が見る）/ Workflows・Durable Objects / 配信 API の形の変更。

**前提（本番で確かめたこと）**: custom tool を持つ agent を API で作れる（p2）。`agent.custom_tool_use` の 252 秒後の `user.custom_tool_result` を受理し session は再開する（p3）。同じ id への 2 回目の result は 200 で無害（p4a）。archive 後は 400（p4b）。1 枚の所要は最長 83 秒、usage は `output_tokens_details.{image_tokens,text_tokens}` で返る（p1）。Cloudflare Queues は使える（context.md）。`OPENAI_API_KEY` は本番の secret に入っている（一時 route の p1 が使った）。

---

## §M-2-1 migration `migrations/0004_image_gen.sql`（verbatim）

```sql
-- 契約 §M-2-1 verbatim（画像生成 段階 2）
-- 1. cost_ledger.kind に 'image' を足す。CHECK は ALTER できないので 0002 と同じ手順で作り直す。
--    DROP TABLE で 0002 の idx_cost_day と 0003 の idx_cost_ledger_vb も消えるので、両方とも作り直す
CREATE TABLE cost_ledger_v3 (
  id TEXT PRIMARY KEY, day TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('session','verify','scout','meeting','image')),
  ref_id TEXT NOT NULL, cents INTEGER NOT NULL, created_at TEXT NOT NULL
);
INSERT INTO cost_ledger_v3 SELECT id, day, kind, ref_id, cents, created_at FROM cost_ledger;
DROP TABLE cost_ledger;
ALTER TABLE cost_ledger_v3 RENAME TO cost_ledger;
CREATE INDEX idx_cost_day ON cost_ledger(day);
CREATE UNIQUE INDEX idx_cost_ledger_vb ON cost_ledger(ref_id) WHERE ref_id GLOB 'vb:*';
-- 画像の記帳は試行ごとに「予約の正の行 1 つ」と「返金の負の行 1 つ」まで（ref_id = 'ia:' || attempt id）
CREATE UNIQUE INDEX idx_cost_ledger_image ON cost_ledger(ref_id, cents > 0) WHERE kind = 'image';

-- 2. 画像を続けられる job の枠（同時に released_at IS NULL は 2 つまで。§M-2-5）
CREATE TABLE image_job_slots (
  job_id TEXT PRIMARY KEY REFERENCES factory_jobs(id),
  acquired_at TEXT NOT NULL,
  released_at TEXT
);

-- 3. 依頼（agent.custom_tool_use 1 件 = 1 行。probe は custom_tool_use_id / job_id が NULL）
CREATE TABLE image_requests (
  id TEXT PRIMARY KEY,                                   -- 'img_' + 32 桁の hex。職人に返す image_id
  kind TEXT NOT NULL CHECK (kind IN ('job','probe')),
  custom_tool_use_id TEXT UNIQUE,
  job_id TEXT REFERENCES factory_jobs(id),
  session_id TEXT,
  model TEXT, size TEXT, quality TEXT, format TEXT CHECK (format IN ('png','webp')), background TEXT,
  u_cents INTEGER,                                       -- この組み合わせの U（予約額）。入力が不正で断った行は NULL
  input_json TEXT NOT NULL DEFAULT '{}',                 -- 検査済みの {prompt, alt, accuracy}。ログに出さない
  gen TEXT NOT NULL CHECK (gen IN ('queued','reserved','dispatched','stored','uploaded','refused','failed')),
  notify TEXT NOT NULL CHECK (notify IN ('none','sending','sent','unknown','abandoned','skip')),
  error TEXT,                                            -- 固定コードだけ（§M-2-6 の表）
  attempt_id TEXT,                                       -- 今の試行（reserved 以降）
  tries INTEGER NOT NULL DEFAULT 0,                      -- この依頼で予約した試行の数（2 まで）
  enqueue_count INTEGER NOT NULL DEFAULT 0, enqueued_at TEXT,
  r2_key TEXT, sha256 TEXT, bytes INTEGER, media_type TEXT, stored_at TEXT,
  upload_tries INTEGER NOT NULL DEFAULT 0, upload_token TEXT, upload_started_at TEXT, uploaded_at TEXT, file_id TEXT,
  notify_token TEXT, notify_started_at TEXT, notify_resends INTEGER NOT NULL DEFAULT 0, notified_at TEXT,
  cleaned_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  CHECK ((kind = 'job' AND custom_tool_use_id IS NOT NULL AND job_id IS NOT NULL AND notify <> 'skip')
      OR (kind = 'probe' AND custom_tool_use_id IS NULL AND job_id IS NULL AND notify = 'skip'))
);
CREATE INDEX idx_image_requests_job ON image_requests(job_id);
CREATE INDEX idx_image_requests_gen ON image_requests(gen, updated_at);
CREATE INDEX idx_image_requests_notify ON image_requests(notify, gen);

-- 4. 試行（OpenAI 呼び出し 1 回 = 1 行。描き直し・429 の再試行も 1 行）
CREATE TABLE image_attempts (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('job','probe')),
  job_id TEXT REFERENCES factory_jobs(id),
  request_id TEXT NOT NULL REFERENCES image_requests(id),
  state TEXT NOT NULL CHECK (state IN ('reserved','dispatched','settled','unknown','void')),
  reserve_cents INTEGER NOT NULL, reserve_day TEXT NOT NULL,   -- 返金は予約の day に記帳する（月の境界をまたいでも元の月）
  dispatch_token TEXT NOT NULL,
  reserved_at TEXT NOT NULL, dispatched_at TEXT,
  usage_json TEXT,                                       -- 勝者 CAS（§M-2-3 W）で必ず非 NULL。usage が無ければ '{"missing":true}'
  settled_cents INTEGER, settled_at TEXT, unknown_at TEXT, void_at TEXT, error TEXT
);
CREATE INDEX idx_image_attempts_job ON image_attempts(job_id);
CREATE INDEX idx_image_attempts_state ON image_attempts(state, dispatched_at);
-- settings の新しい key: image_gen_halted（値 = 理由コード）、image_probe_allowed（値 = 許可した attempt id）
```

---

## §M-2-2 custom tool の定義（司令塔が `factory/claude/agents/material-maker.md` に足す）

### a. frontmatter の `tools` に足す（verbatim。既存の `agent_toolset_20260401` の項目の後ろ）

```yaml
  - type: custom
    name: generate_image
    description: >-
      教材の図や挿絵を 1 枚作る。数十秒から 2 分ほどかかる。結果に画像が返るので、見て確かめ、
      直したい時は prompt を直してもう一度呼ぶ。1 回の注文で 8 枚まで（描き直しも 1 枚に数える）。
      使う画像は material.json の parts[].files[] に image_id を書いて参照する（画像ファイルを outputs に置かない）。
    input_schema:
      type: object
      properties:
        prompt:
          type: string
          description: 描く内容。英語で具体的に（何を・どこに・どんな配置と色で）。UTF-8 で 4000 バイト以内
        accuracy:
          type: string
          enum: [standard, scientific]
          description: 大きさの順・数・比率・構造・地図・図表など正確さが要る絵は scientific（遅いが正確）。挿絵や雰囲気の絵は standard
        size:
          type: string
          enum: ["1024x1024", "1536x1024"]
          description: 正方形か横長
        quality:
          type: string
          enum: [low, medium, high, max]
          description: 普段は high。細部が要る時だけ max（時間と費用が high の 3〜4 倍）。構図の下見は low
        format:
          type: string
          enum: [png, webp]
        background:
          type: string
          enum: [opaque, transparent]
        alt:
          type: string
          description: 絵の内容を日本語 1〜2 文で（確認する人と、絵を見られない読み手のため）。120 字以内
      required: [prompt, accuracy, size, quality, format, background, alt]
      additionalProperties: false
```

`ant apply` の frontmatter での custom tool の書き方は未確認（p2 は API の `agents.create` で確かめた）。**`ant apply --dry-run` が通り、作られた agent の tools に `generate_image` が出ることを §M-2-8 の本番確認に入れる**。

### b. Worker 側の入力検査（純関数 `validateImageInput(input) → {ok:true, value} | {ok:false, field}`）

API が input_schema を守る保証は無いので、Worker が毎回検査する。違えば依頼は `refused`（`bad_input:<field>`）。

| field | 規則 |
|---|---|
| （全体） | object であること。reconcile の走査で `JSON.stringify(input)` が 16,384 文字を超えたものは `{oversized:true}` に置き換えて保持し、`bad_input:input` |
| `prompt` | 文字列。空白を除いて 1 文字以上。`new TextEncoder().encode(prompt).length ≤ 4000`（文字数でなくバイト数。plan-v6 §4） |
| `accuracy` | `standard` / `scientific` |
| `size` | `1024x1024` / `1536x1024` |
| `quality` | `low` / `medium` / `high` / `max` |
| `format` | `png` / `webp` |
| `background` | `opaque` / `transparent` |
| `alt` | 文字列。1〜120 文字（code point で数える） |
| 余分なキー | 無視する（保存しない） |

model は `accuracy` から vars で決める: `standard` → `IMAGE_MODEL_STANDARD`（既定 `gpt-image-2.5-flare`）、`scientific` → `IMAGE_MODEL_SCIENTIFIC`（既定 `gpt-image-2.5-sunburst`）。**決まった model と size と quality が §M-2-5 の U の表に無ければ `refused`（`not_configured`）**（var を表に無い model に変えても、予約の経路を通らない）。保存する `input_json` は `{prompt, alt, accuracy}` だけ。

`src/jobs.ts` の定数: `MAKER_CUSTOM_TOOLS = ['generate_image']`、`rejectsCustomTool(name) = !MAKER_CUSTOM_TOOLS.includes(name)`（generate_image 以外の custom tool は従来どおり `CUSTOM_TOOL_UNAVAILABLE_MESSAGE` の is_error）。

### c. system prompt（本文）に足す節（verbatim。「# 成果物の構成」の前に置く）

```markdown
# 画像（generate_image）

- 図は SVG で描けるものは SVG で描く。SVG では表しにくい絵（挿絵・写真のような絵・質感や立体が要る図）を generate_image で作ってよい。どこに使うかはあなたが決めてよい
- accuracy は、大きさの順・数・比率・構造・地図・図表など正確さが要る絵なら scientific、雰囲気や挿絵なら standard にする
- 返ってきた画像は必ず見て、注文票・claims.json の事実・本文と食い違っていないか確かめる。食い違いや読み取りにくさがあれば prompt を直して描き直す。1 回の注文で作れるのは 8 枚まで（描き直しも 1 枚に数える）。結果の文に残りの枚数が書いてある
- 使う画像は material.json の parts[].files[] に {"path": "parts/<part_id>/<ファイル名>.<png か webp>", "role": "figure", "image_id": "<結果にある image_id>", "alt": "<絵の説明>"} と書く。拡張子は作った時の format と同じにする。画像ファイルを outputs に置く必要はない（置いても使われない）。ファイル名は他のファイルと同じく素材全体で一意にする
- 使わなかった画像は material.json に書かない
- app.html から画像を参照しない（app.html は外部の読み込みができない）
- 画像の中の文字は短くする。子ども向け本文で使わない語は画像の中にも入れない。人の顔・実在の人物・商標やロゴを描かない
- 「今は画像を作れません」「使い切りました」が返ったら、同じ呼び出しを繰り返さず、図は SVG で描いて進める
- 質問を書く最初の段階では generate_image を使わない
```

---

## §M-2-3 状態機械

### a. 状態（正本。plan-v5 §5-2 + plan-v6 §3 を本書の SQL に合わせて 1 枚にしたもの）

依頼 `image_requests.gen`:

| gen | 意味 | 次へ進める主体 | 期限・回収 |
|---|---|---|---|
| `queued` | 受け付けた（未予約） | consumer（V） | cron: halted → Q1 / job が有効でない → Q2 / 2 分超 → Q3（再投入、`enqueue_count < 5`）/ 5 回超 → Q4 / probe は Q5 |
| `reserved` | 試行を予約し U を記帳した | consumer（D） | cron: 試行が VOID_COND に当たれば X（全額返金。依頼は queued / refused / failed） |
| `dispatched` | OpenAI を呼んだ（試行も dispatched） | consumer（W / E / U） | cron: 5 分超 → U（unknown + halted、依頼は failed `result_unknown`） |
| `stored` | 画像を R2 の試行キーに置き勝者 CAS 済み。試行は精算前か後 | consumer / cron（S → UP） | cron: 試行が dispatched なら S。`stored_at` 3 分超で UP。upload 2 回で駄目なら UP3（failed `upload_failed`） |
| `uploaded` | Files の file_id を保存した | 通知（N） | 成功の通知はこの状態だけ。取り込みが image_id で採るのもこの状態だけ |
| `refused` | 断った（上限・枠・phase・入力・停止） | 通知（N） | — |
| `failed` | 失敗（理由コード） | 通知（N） | DLQ は `queued` / `reserved` の時だけ failed にする（Q6） |

試行 `image_attempts.state`: `reserved` → `dispatched` → `settled`（usage で精算。usage が無ければ U のまま）/ `unknown`（人が H で `settled`）。`reserved` → `void`（呼んでいない。全額返金）。精算・取り消し・人の精算の返金は state の述語でどれも 1 回。

通知 `image_requests.notify`（kind='job' だけ。probe は作る時から `skip` で終端）: `none` → `sending` → `sent` / `unknown`。`unknown` → `sent`（events.list で見つかった）/ `sending`（全ページ読んで無ければ 1 回だけ再送）/ `abandoned`（再送しても届かない、または job が終端）。

枠 `image_job_slots`: 予約の batch（V2）で初回だけ取る。job が終端で、その job の試行に reserved / dispatched / unknown が無い時に cron が解放（SL）。

停止 `settings.image_gen_halted`（値 = 理由コード `manual` / `over_reserve:<att>` / `result_unknown:<att>` / `quota:<att>` / `auth:<att>`）: 書くのは S2・E1・U2・H3、消すのは人だけ（H4。unknown の試行が 1 つでも残っていれば消えない）。

### b. 入口: reconcile の requires_action（§B-4-d 手順 4 の差分。他の分岐は変えない）

1. 走査（`onIdle` の fold）: `stop_reason.event_ids` の `agent.custom_tool_use` のうち name が `generate_image` のものは、name に加えて `input` を `blocked[id].input` に保持する（大きさの上限は §M-2-2 b）。他の custom tool は従来どおり name だけ。`keepSaved` は、保存済みの集計に generate_image なのに `input` を持たない項目があれば捨てる（段階 1 の保存形式から続けない）
2. `handed` = event_ids のうち `SELECT custom_tool_use_id FROM image_requests WHERE kind = 'job' AND job_id = ? AND custom_tool_use_id IN (…)` に出るもの。**handed は recovered（Issue #1 の answered 判定）にも pending にも入れない**。返答は通知（N）が送り、deny 数には下の派生数で数える
3. pending のうち `blocked[id]` が generate_image のもの: §M-2-2 b で検査し I1 で登録する。`gen0` は通常 `queued`（`error0` は NULL）、`job.phase = 'questions'` なら `refused` / `questions_phase`、入力が不正なら `refused` / `bad_input:<field>`、`OPENAI_API_KEY` が無い・表に無い組み合わせなら `refused` / `not_configured`。changes = 1 の行は `IMAGE_GEN.send({request_id})`（失敗は無視。queued は cron の Q3、refused は通知の 2 分規則が拾う）。登録した id は送信（tool_confirmation / custom_tool_result）の対象から外し、`denied_event_ids_json` にも入れない
4. 残り（tool_confirmation と generate_image 以外の custom tool）は従来どおり送り、deny 数に数える
5. 送るものが無く handed と登録だけなら `awaiting_image:<n>` を返す（§M-5b の待ちには数えない。blocked に種別がある）
6. 詰まりの終端: handed の依頼に `notify = 'abandoned' AND notify_resends >= 1`（再送しても届かなかった）があり、job が `running` / `budget_reached` なら、`tooManyDenies` と同じ片付け（interrupt → archive）で job を failed（`error = 'image_result_unsent'`）

**deny 数の派生（Issue #1 の入口判定の差分）**: 上限の判定に使う数 = `job.deny_count + imageDenies`。`imageDenies = SELECT COUNT(*) FROM image_requests WHERE kind = 'job' AND job_id = ? AND gen IN ('refused','failed') AND notify = 'sent'`。`stopIfTooManyDenies` の 2 つの呼び出し（入口・requires_action の保存直後）でこの和を渡す。`deny_count` 列を書くのは従来どおり reconcile だけ（通知の経路は `factory_jobs` を書かない。lease の外から絶対値の CAS と競わない）。

### c. 遷移の SQL（verbatim）

#### I 依頼の登録（reconcile。lease を持つ間だけ）

```sql
INSERT INTO image_requests (id, kind, custom_tool_use_id, job_id, session_id, model, size, quality, format, background, u_cents, input_json, gen, notify, error, enqueued_at, created_at, updated_at)
SELECT ?req, 'job', ?ctu, ?job, ?sid, ?model, ?size, ?quality, ?format, ?background, ?u, ?input_json, ?gen0, 'none', ?error0, ?now, ?now, ?now
WHERE EXISTS (SELECT 1 FROM factory_jobs j WHERE j.id = ?job AND j.reconcile_token = ?rtoken)
ON CONFLICT(custom_tool_use_id) DO NOTHING;
```

#### V 予約（job。consumer。batch = V1, V2, V3, V4。成否は V4 の changes）

plan-v6 §1 の SQL に、返金の day（`reserve_day`）・依頼の試行数（`tries`）・U の一致を足したもの。`?u` は依頼の `u_cents`、`?u_max` は U の表の最大値（35）、`?day` / `?month` は Asia/Tokyo、`?daily_cap` = `DAILY_CAP_CENTS`、`?month_cap` = `IMAGE_MONTHLY_CAP_CENTS`。

```sql
-- V1 試行（全条件をここに集める）
INSERT INTO image_attempts (id, kind, job_id, request_id, state, reserve_cents, reserve_day, dispatch_token, reserved_at)
SELECT ?att, 'job', ?job, ?req, 'reserved', ?u, ?day, ?token, ?now
WHERE (SELECT value FROM settings WHERE key = 'image_gen_halted') IS NULL
  AND EXISTS (SELECT 1 FROM factory_jobs j WHERE j.id = ?job AND j.status IN ('running','budget_reached') AND j.phase = 'making')
  AND EXISTS (SELECT 1 FROM image_requests r WHERE r.id = ?req AND r.kind = 'job' AND r.job_id = ?job AND r.gen = 'queued' AND r.u_cents = ?u)
  AND (SELECT COUNT(*) FROM image_attempts a WHERE a.job_id = ?job) < 8
  AND (SELECT COALESCE(SUM(cents), 0) FROM cost_ledger WHERE day = ?day) + ?u <= ?daily_cap
  AND (
        EXISTS (SELECT 1 FROM image_job_slots s WHERE s.job_id = ?job AND s.released_at IS NULL)
        OR (
              NOT EXISTS (SELECT 1 FROM image_job_slots s WHERE s.job_id = ?job)
          AND (SELECT COUNT(*) FROM image_job_slots s WHERE s.released_at IS NULL) < 2
          AND (SELECT COALESCE(SUM(cents), 0) FROM cost_ledger WHERE kind = 'image' AND substr(day, 1, 7) = ?month) + ?u_max <= ?month_cap
        )
      );
-- V2 枠（V1 の行ができた時だけ・初回だけ）
INSERT INTO image_job_slots (job_id, acquired_at)
SELECT ?job, ?now
WHERE EXISTS (SELECT 1 FROM image_attempts WHERE id = ?att)
  AND NOT EXISTS (SELECT 1 FROM image_job_slots WHERE job_id = ?job);
-- V3 記帳（V1 の行ができた時だけ）
INSERT INTO cost_ledger (id, day, kind, ref_id, cents, created_at)
SELECT ?lid, ?day, 'image', 'ia:' || ?att, ?u, ?now
WHERE EXISTS (SELECT 1 FROM image_attempts WHERE id = ?att);
-- V4 依頼
UPDATE image_requests SET gen = 'reserved', attempt_id = ?att, tries = tries + 1, updated_at = ?now
WHERE id = ?req AND gen = 'queued' AND EXISTS (SELECT 1 FROM image_attempts WHERE id = ?att);
```

V4 が 0 行なら、読み直して理由を決め R1 で断る（理由は文面を選ぶためだけ。読み→判断の間の競合は害が無い）: halted → `halted` / job が running・budget_reached かつ making でない → R1 ではなく Q2 / その job の試行数 ≥ 8 → `job_image_limit` / 当日の合計 + U > 日次 → `daily_cap` / 枠を持たず空き枠が無い → `image_slot_unavailable` / 枠を持たず月の記帳 + U_max > 月の上限 → `monthly_cap` / それ以外 → `reserve_conflict`。

```sql
-- R1
UPDATE image_requests SET gen = 'refused', error = ?err, updated_at = ?now WHERE id = ?req AND gen = 'queued';
```

#### P 予約（probe。管理画面の `POST /api/images/probe` だけ。plan-v6 §7・§8・§9）

```sql
-- P0 許可（操作 1 回で 1 件。0 行なら 409 probe_in_progress）
INSERT INTO settings (key, value, updated_at) VALUES ('image_probe_allowed', ?att, ?now) ON CONFLICT(key) DO NOTHING;
-- batch = P1, P2, V3, V4（V3・V4 は job と同じ文）。成否は V4 の changes
-- P1 依頼
INSERT INTO image_requests (id, kind, custom_tool_use_id, job_id, session_id, model, size, quality, format, background, u_cents, input_json, gen, notify, enqueued_at, created_at, updated_at)
SELECT ?req, 'probe', NULL, NULL, NULL, ?model, ?size, ?quality, ?format, ?background, ?u, ?input_json, 'queued', 'skip', ?now, ?now, ?now
WHERE EXISTS (SELECT 1 FROM settings WHERE key = 'image_probe_allowed' AND value = ?att);
-- P2 試行（job の条件の代わりに: 許可・その月の probe の試行 < 12・月の記帳 + U ≤ 月の上限・日次）
INSERT INTO image_attempts (id, kind, job_id, request_id, state, reserve_cents, reserve_day, dispatch_token, reserved_at)
SELECT ?att, 'probe', NULL, ?req, 'reserved', ?u, ?day, ?token, ?now
WHERE (SELECT value FROM settings WHERE key = 'image_gen_halted') IS NULL
  AND EXISTS (SELECT 1 FROM settings WHERE key = 'image_probe_allowed' AND value = ?att)
  AND EXISTS (SELECT 1 FROM image_requests r WHERE r.id = ?req AND r.kind = 'probe' AND r.gen = 'queued' AND r.u_cents = ?u)
  AND (SELECT COUNT(*) FROM image_attempts a WHERE a.kind = 'probe' AND substr(a.reserve_day, 1, 7) = ?month) < 12
  AND (SELECT COALESCE(SUM(cents), 0) FROM cost_ledger WHERE kind = 'image' AND substr(day, 1, 7) = ?month) + ?u <= ?month_cap
  AND (SELECT COALESCE(SUM(cents), 0) FROM cost_ledger WHERE day = ?day) + ?u <= ?daily_cap;
-- V4 が 0 行の時（その場で。この attempt id はこの操作しか知らないので 10 分を待たない）: P5 → P6
UPDATE image_requests SET gen = 'refused', error = ?err, updated_at = ?now WHERE id = ?req AND kind = 'probe' AND gen = 'queued';
DELETE FROM settings WHERE key = 'image_probe_allowed' AND value = ?att AND NOT EXISTS (SELECT 1 FROM image_attempts WHERE id = ?att);
```

#### D dispatch（consumer。batch = D1, D2。成否は D2 の changes。0 行なら OpenAI を呼ばない）

D1 は plan-v6 §2 の verbatim。D2 を同じ batch に置くので「試行 dispatched・依頼 reserved」の窓はできない（plan-v6 §7 の回収規則は防御として残す: U3 は reserved も拾う）。

```sql
-- D1
UPDATE image_attempts SET state = 'dispatched', dispatched_at = ?now
WHERE id = ?att AND state = 'reserved' AND dispatch_token = ?token
  AND (SELECT value FROM settings WHERE key = 'image_gen_halted') IS NULL
  AND (SELECT COUNT(*) FROM image_attempts WHERE state IN ('dispatched','unknown')) < 2
  AND (
        ( kind = 'job'
          AND EXISTS (SELECT 1 FROM factory_jobs j WHERE j.id = image_attempts.job_id AND j.status IN ('running','budget_reached') AND j.phase = 'making')
          AND EXISTS (SELECT 1 FROM image_requests r WHERE r.id = image_attempts.request_id AND r.gen = 'reserved' AND r.attempt_id = image_attempts.id) )
     OR ( kind = 'probe'
          AND EXISTS (SELECT 1 FROM settings WHERE key = 'image_probe_allowed' AND value = image_attempts.id)
          AND EXISTS (SELECT 1 FROM image_requests r WHERE r.id = image_attempts.request_id AND r.gen = 'reserved' AND r.attempt_id = image_attempts.id) )
      );
-- D2
UPDATE image_requests SET gen = 'dispatched', updated_at = ?now
WHERE id = ?req AND gen = 'reserved' AND attempt_id = ?att
  AND EXISTS (SELECT 1 FROM image_attempts a WHERE a.id = ?att AND a.state = 'dispatched' AND a.dispatched_at = ?now AND a.dispatch_token = ?token);
```

#### W 勝者（consumer。画像を R2 の試行キーに put した後。batch = W1, W2。成否は W2）

`?usage_json` は必ず非 NULL（usage が返れば `{"in_text","in_image","out_image","out_text"}` の 4 つの整数、無い・読めなければ `{"missing":true}`。plan-v9）。NULL を渡すと W1 が 0 行で勝者にならない。

```sql
-- W1
UPDATE image_requests SET gen = 'stored', r2_key = ?key, sha256 = ?sha, bytes = ?bytes, media_type = ?media_type, stored_at = ?now, updated_at = ?now
WHERE id = ?req AND gen = 'dispatched' AND attempt_id = ?att AND ?usage_json IS NOT NULL
  AND EXISTS (SELECT 1 FROM image_attempts a WHERE a.id = ?att AND a.state = 'dispatched' AND a.dispatch_token = ?token AND a.usage_json IS NULL);
-- W2
UPDATE image_attempts SET usage_json = ?usage_json
WHERE id = ?att AND state = 'dispatched' AND usage_json IS NULL
  AND EXISTS (SELECT 1 FROM image_requests r WHERE r.id = ?req AND r.gen = 'stored' AND r.attempt_id = ?att AND r.r2_key = ?key);
```

#### S 精算（consumer と cron で同じ。batch = S1, S2, S3, PD。成否は S3）

`?usage_json` は読んだ値、`?c` = §M-2-5 の式で出した実額（missing なら `reserve_cents`）。S1 は `?c < reserve_cents` の時だけ返金、S2 は `?c > reserve_cents` の時だけ停止。

```sql
-- S1 返金（予約の day に負の行）
INSERT INTO cost_ledger (id, day, kind, ref_id, cents, created_at)
SELECT ?lid, a.reserve_day, 'image', 'ia:' || a.id, ?c - a.reserve_cents, ?now
FROM image_attempts a
WHERE a.id = ?att AND a.state = 'dispatched' AND a.usage_json = ?usage_json AND ?c < a.reserve_cents;
-- S2 停止（実額 > U）
INSERT INTO settings (key, value, updated_at)
SELECT 'image_gen_halted', 'over_reserve:' || a.id, ?now
FROM image_attempts a
WHERE a.id = ?att AND a.state = 'dispatched' AND a.usage_json = ?usage_json AND ?c > a.reserve_cents
ON CONFLICT(key) DO NOTHING;
-- S3
UPDATE image_attempts SET state = 'settled', settled_cents = ?c, settled_at = ?now
WHERE id = ?att AND state = 'dispatched' AND usage_json = ?usage_json;
-- PD probe の許可の削除（plan-v9 verbatim。S・E・U・X・H の各 batch の最後に置く。job の試行では 0 行）
DELETE FROM settings WHERE key = 'image_probe_allowed' AND value = ?att
  AND ( EXISTS (SELECT 1 FROM image_attempts a WHERE a.id = ?att AND a.state IN ('settled','void','unknown'))
     OR ( NOT EXISTS (SELECT 1 FROM image_attempts a WHERE a.id = ?att) AND updated_at < ?now_minus_10min ) );
```

#### E 応答のあった失敗（consumer。batch = E1, E2, E3, PD。成否は E3）

OpenAI が status を返した失敗と、200 だが画像が使えなかった応答。試行は U のまま精算（返金しない。plan-v2 §3）。`?halt_reason` は `quota` / `auth` の時だけ値、他は NULL。`?retryable` は 429（quota 以外）の時だけ 1（job の依頼で `tries < 2` なら queued に戻り、consumer が `IMAGE_GEN.send({request_id}, {delaySeconds: 60})`）。

```sql
-- E1
INSERT INTO settings (key, value, updated_at)
SELECT 'image_gen_halted', ?halt_reason || ':' || a.id, ?now
FROM image_attempts a
WHERE a.id = ?att AND a.state = 'dispatched' AND a.dispatch_token = ?token AND ?halt_reason IS NOT NULL
ON CONFLICT(key) DO NOTHING;
-- E2
UPDATE image_requests SET
  gen = CASE WHEN ?retryable = 1 AND kind = 'job' AND tries < 2 THEN 'queued' ELSE 'failed' END,
  error = CASE WHEN ?retryable = 1 AND kind = 'job' AND tries < 2 THEN NULL ELSE ?err END,
  enqueued_at = ?now, updated_at = ?now
WHERE id = ?req AND gen = 'dispatched' AND attempt_id = ?att
  AND EXISTS (SELECT 1 FROM image_attempts a WHERE a.id = ?att AND a.state = 'dispatched' AND a.dispatch_token = ?token);
-- E3
UPDATE image_attempts SET state = 'settled', settled_cents = reserve_cents, settled_at = ?now, usage_json = ?usage_json, error = ?err
WHERE id = ?att AND state = 'dispatched' AND dispatch_token = ?token
  AND EXISTS (SELECT 1 FROM image_requests r WHERE r.id = ?req AND r.gen IN ('queued','failed') AND r.updated_at = ?now);
```

| OpenAI の結果 | `?err` | `?retryable` | `?halt_reason` |
|---|---|---|---|
| 429 で `error.code = 'insufficient_quota'` | `quota` | 0 | `quota` |
| 429（それ以外） | `rate_limited` | 1 | NULL |
| 400 で `error.code = 'moderation_blocked'` | `moderation` | 0 | NULL |
| 401 / 403 | `auth` | 0 | `auth` |
| その他の 4xx | `bad_request` | 0 | NULL |
| 5xx | `server` | 0 | NULL |
| 200 だが `data[0].b64_json` が無い・decode できない・先頭バイトが format と違う | `bad_response` | 0 | NULL |
| 200 だが decode 後が `MAX_FILE_BYTES`（2 MiB）超 | `too_large` | 0 | NULL |

#### U 結果不明（plan-v8。consumer は応答不明の時に `?mine = 1` で即座に、cron は `?mine = 0` で dispatched 5 分超。batch = U1, U2, U3, PD。成否は U1）

```sql
-- U1
UPDATE image_attempts SET state = 'unknown', unknown_at = ?now
WHERE id = ?att AND state = 'dispatched'
  AND ( (?mine = 1 AND dispatch_token = ?token) OR (?mine = 0 AND dispatched_at < ?now_minus_5min) )
  AND NOT EXISTS (SELECT 1 FROM image_requests r WHERE r.attempt_id = image_attempts.id AND r.gen IN ('stored','uploaded'));
-- U2
INSERT INTO settings (key, value, updated_at)
SELECT 'image_gen_halted', 'result_unknown:' || a.id, ?now
FROM image_attempts a WHERE a.id = ?att AND a.state = 'unknown' AND a.unknown_at = ?now
ON CONFLICT(key) DO NOTHING;
-- U3（failed 済み・stored 以降は触らない）
UPDATE image_requests SET gen = 'failed', error = 'result_unknown', updated_at = ?now
WHERE attempt_id = ?att AND gen IN ('reserved','dispatched')
  AND EXISTS (SELECT 1 FROM image_attempts a WHERE a.id = ?att AND a.state = 'unknown' AND a.unknown_at = ?now);
```

#### X 呼んでいない試行の取り消し（cron。batch = X1, X2, X3, PD。成否は X3）

VOID_COND（`a` は対象の試行。X3 では `image_attempts` 自身）:

```sql
(SELECT value FROM settings WHERE key = 'image_gen_halted') IS NOT NULL
    OR a.reserved_at < ?now_minus_10min
    OR NOT EXISTS (SELECT 1 FROM image_requests r WHERE r.id = a.request_id AND r.gen = 'reserved' AND r.attempt_id = a.id)
    OR (a.kind = 'job' AND NOT EXISTS (SELECT 1 FROM factory_jobs j WHERE j.id = a.job_id AND j.status IN ('running','budget_reached') AND j.phase = 'making'))
    OR (a.kind = 'probe' AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'image_probe_allowed' AND value = a.id))
```

```sql
-- X1 全額返金
INSERT INTO cost_ledger (id, day, kind, ref_id, cents, created_at)
SELECT ?lid, a.reserve_day, 'image', 'ia:' || a.id, -a.reserve_cents, ?now
FROM image_attempts a
WHERE a.id = ?att AND a.state = 'reserved' AND ((SELECT value FROM settings WHERE key = 'image_gen_halted') IS NOT NULL
    OR a.reserved_at < ?now_minus_10min
    OR NOT EXISTS (SELECT 1 FROM image_requests r WHERE r.id = a.request_id AND r.gen = 'reserved' AND r.attempt_id = a.id)
    OR (a.kind = 'job' AND NOT EXISTS (SELECT 1 FROM factory_jobs j WHERE j.id = a.job_id AND j.status IN ('running','budget_reached') AND j.phase = 'making'))
    OR (a.kind = 'probe' AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'image_probe_allowed' AND value = a.id)));
-- X2 依頼（halted → refused / probe → failed / job が有効でない → failed / tries < 2 → queued / それ以外 → failed）
UPDATE image_requests SET
  gen = CASE
    WHEN (SELECT value FROM settings WHERE key = 'image_gen_halted') IS NOT NULL THEN 'refused'
    WHEN kind = 'probe' THEN 'failed'
    WHEN NOT EXISTS (SELECT 1 FROM factory_jobs j WHERE j.id = image_requests.job_id AND j.status IN ('running','budget_reached') AND j.phase = 'making') THEN 'failed'
    WHEN tries < 2 THEN 'queued'
    ELSE 'failed' END,
  error = CASE
    WHEN (SELECT value FROM settings WHERE key = 'image_gen_halted') IS NOT NULL THEN 'halted'
    WHEN kind = 'probe' THEN 'not_dispatched'
    WHEN NOT EXISTS (SELECT 1 FROM factory_jobs j WHERE j.id = image_requests.job_id AND j.status IN ('running','budget_reached') AND j.phase = 'making') THEN 'job_ended'
    WHEN tries < 2 THEN NULL
    ELSE 'not_dispatched' END,
  enqueued_at = ?now, updated_at = ?now
WHERE id = ?req AND gen = 'reserved' AND attempt_id = ?att
  AND EXISTS (SELECT 1 FROM image_attempts a WHERE a.id = ?att AND a.state = 'reserved' AND ((SELECT value FROM settings WHERE key = 'image_gen_halted') IS NOT NULL
    OR a.reserved_at < ?now_minus_10min
    OR NOT EXISTS (SELECT 1 FROM image_requests r WHERE r.id = a.request_id AND r.gen = 'reserved' AND r.attempt_id = a.id)
    OR (a.kind = 'job' AND NOT EXISTS (SELECT 1 FROM factory_jobs j WHERE j.id = a.job_id AND j.status IN ('running','budget_reached') AND j.phase = 'making'))
    OR (a.kind = 'probe' AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'image_probe_allowed' AND value = a.id))));
-- X3
UPDATE image_attempts SET state = 'void', void_at = ?now
WHERE id = ?att AND state = 'reserved' AND ((SELECT value FROM settings WHERE key = 'image_gen_halted') IS NOT NULL
    OR image_attempts.reserved_at < ?now_minus_10min
    OR NOT EXISTS (SELECT 1 FROM image_requests r WHERE r.id = image_attempts.request_id AND r.gen = 'reserved' AND r.attempt_id = image_attempts.id)
    OR (image_attempts.kind = 'job' AND NOT EXISTS (SELECT 1 FROM factory_jobs j WHERE j.id = image_attempts.job_id AND j.status IN ('running','budget_reached') AND j.phase = 'making'))
    OR (image_attempts.kind = 'probe' AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'image_probe_allowed' AND value = image_attempts.id)));
```

X2 で queued に戻った依頼は、cron がその場で `IMAGE_GEN.send({request_id})`。

#### Q 依頼（試行なし）の引き取り（cron。Q6 だけ DLQ consumer）

```sql
-- Q1 停止中の queued
UPDATE image_requests SET gen = 'refused', error = 'halted', updated_at = ?now
WHERE id = ?req AND gen = 'queued' AND (SELECT value FROM settings WHERE key = 'image_gen_halted') IS NOT NULL;
-- Q2 job が有効でない queued
UPDATE image_requests SET gen = 'failed', error = 'job_ended', updated_at = ?now
WHERE id = ?req AND kind = 'job' AND gen = 'queued'
  AND NOT EXISTS (SELECT 1 FROM factory_jobs j WHERE j.id = image_requests.job_id AND j.status IN ('running','budget_reached') AND j.phase = 'making');
-- Q3 再投入の処理権（1 行なら IMAGE_GEN.send({request_id})）
UPDATE image_requests SET enqueue_count = enqueue_count + 1, enqueued_at = ?now, updated_at = ?now
WHERE id = ?req AND kind = 'job' AND gen = 'queued' AND enqueue_count < 5 AND enqueued_at < ?now_minus_2min;
-- Q4 再投入の上限
UPDATE image_requests SET gen = 'failed', error = 'enqueue_exhausted', updated_at = ?now
WHERE id = ?req AND kind = 'job' AND gen = 'queued' AND enqueue_count >= 5 AND enqueued_at < ?now_minus_2min;
-- Q5 probe の取り残し（P の batch の途中で止まった）
UPDATE image_requests SET gen = 'refused', error = 'probe_not_reserved', updated_at = ?now
WHERE id = ?req AND kind = 'probe' AND gen = 'queued' AND enqueued_at < ?now_minus_2min;
-- Q6 DLQ（試行は触らない。reserved の試行は X が取り消す）
UPDATE image_requests SET gen = 'failed', error = 'dlq', updated_at = ?now WHERE id = ?req AND gen IN ('queued','reserved');
```

#### UP Files への upload（consumer は精算の直後、cron は `stored_at` が 3 分より前の依頼。plan-v6 §3 + plan-v8）

```sql
-- UP1 処理権（精算済みの時だけ）
UPDATE image_requests SET upload_token = ?t, upload_started_at = ?now, upload_tries = upload_tries + 1, updated_at = ?now
WHERE id = ?req AND gen = 'stored' AND upload_tries < 2
  AND (upload_token IS NULL OR upload_started_at < ?now_minus_5min)
  AND EXISTS (SELECT 1 FROM image_attempts a WHERE a.id = image_requests.attempt_id AND a.state = 'settled');
-- UP2 成功
UPDATE image_requests SET gen = 'uploaded', file_id = ?file_id, uploaded_at = ?now, updated_at = ?now
WHERE id = ?req AND gen = 'stored' AND upload_token = ?t;
-- UP3 打ち切り（cron）
UPDATE image_requests SET gen = 'failed', error = 'upload_failed', updated_at = ?now
WHERE id = ?req AND gen = 'stored' AND upload_tries >= 2 AND upload_started_at < ?now_minus_5min;
```

UP1 の後に upload が成功して UP2 が 0 行（他が処理権を取り直した）なら、その file は孤立（参照されないだけ）。`files_orphan_suspected` の件数をログに出す。upload の失敗は D1 に何も書かない（`upload_tries` は UP1 で数えた）。

#### N 通知（kind='job' だけ。consumer は終端に着いた直後、cron は `updated_at` が 2 分より前の `notify='none'`）

```sql
-- N1 送信の処理権（job が running / budget_reached / needs_answer。phase は問わない）
UPDATE image_requests SET notify = 'sending', notify_token = ?t, notify_started_at = ?now, updated_at = ?now
WHERE id = ?req AND kind = 'job' AND notify = 'none' AND gen IN ('uploaded','refused','failed')
  AND EXISTS (SELECT 1 FROM factory_jobs j WHERE j.id = image_requests.job_id AND j.status IN ('running','budget_reached','needs_answer'));
-- N2 送信成功
UPDATE image_requests SET notify = 'sent', notified_at = ?now, updated_at = ?now WHERE id = ?req AND notify = 'sending' AND notify_token = ?t;
-- N3 送信の例外（応答あり・なしとも）
UPDATE image_requests SET notify = 'unknown', updated_at = ?now WHERE id = ?req AND notify = 'sending' AND notify_token = ?t;
-- N4 sending の取り残し（cron）
UPDATE image_requests SET notify = 'unknown', updated_at = ?now WHERE id = ?req AND notify = 'sending' AND notify_started_at < ?now_minus_5min;
-- N5 照合で見つかった（cron）
UPDATE image_requests SET notify = 'sent', notified_at = ?now, updated_at = ?now WHERE id = ?req AND notify = 'unknown';
-- N6 1 回だけ再送の処理権（cron。p4a で二重の result が無害と確認済み）
UPDATE image_requests SET notify = 'sending', notify_token = ?t, notify_started_at = ?now, notify_resends = notify_resends + 1, updated_at = ?now
WHERE id = ?req AND notify = 'unknown' AND notify_resends < 1
  AND EXISTS (SELECT 1 FROM factory_jobs j WHERE j.id = image_requests.job_id AND j.status IN ('running','budget_reached','needs_answer'));
-- N7 job が終端
UPDATE image_requests SET notify = 'abandoned', notified_at = ?now, updated_at = ?now
WHERE id = ?req AND kind = 'job' AND notify IN ('none','unknown') AND gen IN ('uploaded','refused','failed')
  AND EXISTS (SELECT 1 FROM factory_jobs j WHERE j.id = image_requests.job_id AND j.status IN ('done','failed','cancelled'));
-- N8 再送しても見つからない（§M-2-3-b 6 が job を止める）
UPDATE image_requests SET notify = 'abandoned', notified_at = ?now, updated_at = ?now
WHERE id = ?req AND notify = 'unknown' AND notify_resends >= 1;
```

unknown の照合（cron）: job が終端 → N7。そうでなければ `events.list` を新しい順に最後のページまで読み、`type = 'user.custom_tool_result' AND custom_tool_use_id = <依頼の custom_tool_use_id>` があれば N5。最後まで読めて無ければ N6 → 送信 → N2 / N3、N6 が 0 行（再送済み）なら N8。今回の時間内に最後まで読めなければ何もしない（次の cron で先頭から）。

#### SL 枠の解放（cron）

```sql
UPDATE image_job_slots SET released_at = ?now
WHERE job_id = ?job AND released_at IS NULL
  AND EXISTS (SELECT 1 FROM factory_jobs j WHERE j.id = image_job_slots.job_id AND j.status IN ('done','failed','cancelled'))
  AND NOT EXISTS (SELECT 1 FROM image_attempts a WHERE a.job_id = image_job_slots.job_id AND a.state IN ('reserved','dispatched','unknown'));
```

#### H 運営の操作（§M-2-5 のルート）

```sql
-- H1・H2（・PD）人の精算（unknown の試行を、OpenAI の使用量画面で確かめた額 ?c で確定）
INSERT INTO cost_ledger (id, day, kind, ref_id, cents, created_at)
SELECT ?lid, a.reserve_day, 'image', 'ia:' || a.id, ?c - a.reserve_cents, ?now
FROM image_attempts a WHERE a.id = ?att AND a.state = 'unknown' AND ?c < a.reserve_cents;
UPDATE image_attempts SET state = 'settled', settled_cents = ?c, settled_at = ?now, error = 'resolved_by_operator' WHERE id = ?att AND state = 'unknown';
-- H3 手で止める
INSERT INTO settings (key, value, updated_at) VALUES ('image_gen_halted', 'manual', ?now) ON CONFLICT(key) DO NOTHING;
-- H4 解除（unknown が 1 つでも残れば 0 行）
DELETE FROM settings WHERE key = 'image_gen_halted' AND NOT EXISTS (SELECT 1 FROM image_attempts WHERE state = 'unknown');
```

### d. 止まった場所ごとの帰結（§L-2 の表と同じ書き方）

| 止まった場所 | コミット済み | 次に起きること |
|---|---|---|
| reconcile が I1 の後、send の前 | 依頼 queued | 2 分後に cron の Q3 が再投入 |
| consumer が V の後、D の前 | 依頼 reserved・試行 reserved・記帳 U | Queue の再試行で D。来なければ 10 分後に X（返金、tries < 2 なら queued に戻して再投入） |
| D の後、HTTP の前（t3） | 依頼・試行 dispatched | 再生成しない。5 分後に U（unknown・halted・依頼 failed `result_unknown`）→ 通知 |
| HTTP の途中で consumer が落ちる | 同上 | 同上（課金は不明なので U のまま。人が H で精算） |
| HTTP 成功、R2 put の後・W の前 | 同上、R2 に試行キーの物体 | 同上。物体は孤立し掃除で消える（請求はある。人が H で精算） |
| W の後、S の前（t4・t13） | 依頼 stored・試行 dispatched（usage_json あり） | cron が S（1 回だけ）→ UP |
| S の後、UP の前（t4） | 依頼 stored・試行 settled | `stored_at` 3 分後に cron が UP1 → upload → UP2 |
| upload 成功、UP2 の前（t5） | 依頼 stored・`upload_token` あり | 5 分後に cron が UP1 を取り直して 2 回目（孤立 file 1 件をログ）。2 回とも駄目なら UP3 |
| uploaded、通知の前（t6） | uploaded・notify none | 2 分後に cron が N1 → 送信 |
| N1 の後、送信の前 | notify sending | 5 分後に N4 → unknown → 照合で無い → N6 で 1 回送る |
| 送信成功、N2 の前（t7） | notify sending | 5 分後に N4 → unknown → 照合で見つかる → N5（二重に送らない） |
| 再送も届かない | notify unknown（resends 1） | N8 → abandoned → reconcile が job を failed `image_result_unsent` |
| 停止中に queued / reserved（t8） | — | Q1 / X（返金）→ refused `halted` → 通知 |
| 停止中に dispatched | — | 生成を最後まで進める（stored → uploaded → 成功の通知。「やりきる」(1)） |
| job の cancel 後に queued / reserved（t2） | — | D は 0 行で OpenAI を呼ばない。Q2 / X → failed `job_ended` → N7 abandoned |
| job の cancel 後に dispatched | — | 生成は完了し stored → uploaded。通知は N7 で abandoned。画像は掃除まで R2 に残る |
| DLQ（queued / reserved） | — | Q6 で failed `dlq` → 通知。reserved の試行は X が取り消す |
| 同じメッセージの重複配信 | — | V1（依頼 queued の述語）・D1（state と token）で 1 つだけ進む。他は ack |
| 2 つの cron が同じ依頼を見る | — | X / U / S / UP1 / N1 はすべて state か token の述語で 1 つだけ |
| 枠を持つ 2 job が動いている時に月の記帳が上限を超える | — | 2 job は 8 枚まで続く（G3'）。3 つ目の job は V で 0 行 → refused `monthly_cap` |

### e. 段階 1 への降格（plan-v6 §3 の完了条件 + plan-v5 の降格の下限）

手順: (1) H3（手で止める）(2) cron を 2 回待つ（queued / reserved は Q1・X で refused、dispatched は完了まで進む）(3) 下の 3 つがすべて 0 (4) 司令塔が職人定義から tool を消して `ant apply`（4 の後に作られた session は generate_image を呼ばない）(5) `wrangler rollback` で段階 1 の版へ。段階 1 は画像の版を読めるので配信は 404 にならない。**確認待ち・承認済みに画像付きの版が 1 つでもあれば段階 1 より前へは戻さない**（plan-v5）。

```sql
SELECT COUNT(*) AS n FROM image_requests WHERE gen IN ('queued','reserved','dispatched','stored');
SELECT COUNT(*) AS n FROM image_requests WHERE kind = 'job' AND gen IN ('uploaded','refused','failed') AND notify IN ('none','sending','unknown');
SELECT COUNT(*) AS n FROM image_attempts WHERE state IN ('reserved','dispatched');
```

`unknown` の試行は halted のまま残してよい（人が H で精算する）。上の 3 つが 0 なら、生きた session に未回答の generate_image は無い（通知は sent か abandoned）。段階 1 の Worker は、tool を消す前の session が出した generate_image に §M-5 の is_error を返す。0004 の表は残す（段階 1 のコードは読まない）。

---

## §M-2-4 実行場所（plan-v6 §3 の結論: Queue は早く進めるための通知、進める責任は D1 の状態と cron）

| 経路 | やること | やらないこと |
|---|---|---|
| webhook / 管理画面の reconcile（waitUntil 25 秒） | §M-2-3-b の登録（I1）と send だけ | 生成・upload・通知 |
| Queue consumer `factory-image-gen` | 依頼 1 件を進める（V → D → 生成 → W → S → UP → N）。生成するのはここだけ | — |
| DLQ consumer `factory-image-gen-dlq` | Q6 だけ | 生成・通知 |
| cron 段 3-c | 引き取り（X・Q・U・S・UP・N・SL・PD・掃除）。halted 中・paused 中も行う | 生成（V・D を呼ばない） |

### a. `wrangler.jsonc` の差分（verbatim）

```jsonc
  "queues": {
    "producers": [{ "binding": "IMAGE_GEN", "queue": "factory-image-gen" }],
    "consumers": [
      { "queue": "factory-image-gen", "max_batch_size": 1, "max_retries": 2, "max_concurrency": 2, "retry_delay": 30, "dead_letter_queue": "factory-image-gen-dlq" },
      { "queue": "factory-image-gen-dlq", "max_batch_size": 1, "max_retries": 3, "max_concurrency": 1 }
    ]
  },
```

`vars` に足す: `"IMAGE_MODEL_STANDARD": "gpt-image-2.5-flare"`, `"IMAGE_MODEL_SCIENTIFIC": "gpt-image-2.5-sunburst"`, `"IMAGE_MONTHLY_CAP_CENTS": "3000"`。キー名は `node_modules/wrangler/config-schema.json` の queues.consumers（`max_batch_size` / `max_retries` / `max_concurrency` / `retry_delay` / `dead_letter_queue`）で確認済み。2 つの queue は deploy 前に `wrangler queues create factory-image-gen` / `wrangler queues create factory-image-gen-dlq` で作る（司令塔。本番の変更）。DLQ consumer が 3 回失敗した message は消えるが、依頼は cron（Q3・Q4・X）が引き取る。

`src/env.ts` に足す: `IMAGE_GEN?: Queue<{ request_id: string }>`、`IMAGE_MODEL_STANDARD?`、`IMAGE_MODEL_SCIENTIFIC?`、`IMAGE_MONTHLY_CAP_CENTS?`（`cfg` は `imageMonthlyCapCents: intVar(..., 3000)`）、secret `OPENAI_API_KEY?`。コードの定数（`src/images.ts`。var にしない — 上界の式が変わるため）: 1 job の試行 8 / 枠 2 / 飛行中 2 / 1 依頼の試行 2 / probe の月の試行 12 / prompt 4000 バイト / alt 120 文字 / 生成の締め切り 150 秒 / consumer の締め切り 10 分 / cron 段の予算 60 秒・各 20 件。

### b. `src/index.ts` の `queue` handler

```ts
async queue(batch: MessageBatch<{ request_id: string }>, env: Env): Promise<void> {
  const portCtx = { hostname: null, fakeEnabledSetting: await getSetting(env.DB, 'fake_enabled') };
  const port = await getPort(env, portCtx);
  const images = await getImagePort(env, portCtx); // src/anthropic.ts。fake は §B-0 の条件（scheduled と同じ）の時だけ
  for (const msg of batch.messages) {
    const id = String((msg.body as { request_id?: unknown })?.request_id ?? '');
    if (!/^img_[0-9a-f]{32}$/.test(id)) { msg.ack(); continue; }
    try {
      if (batch.queue === 'factory-image-gen-dlq') await onImageDlq(env, id);
      else if ((await advanceImage(env, port, images, id, { deadline: Date.now() + 10 * 60_000 })) === 'retry_later') { msg.retry({ delaySeconds: 30 }); continue; }
      msg.ack();
    } catch (e) {
      console.log(JSON.stringify({ at: 'image_queue', request_id: id, error: e instanceof Error ? e.name : 'error' }));
      msg.retry();
    }
  }
}
```

### c. consumer の手順 `advanceImage(env, port, images, requestId, {deadline})`（冪等。どの状態から入っても D1 の状態で決める）

1. 依頼を読む（無ければ終わり）。`queued`（job）→ 2 / `queued`（probe）→ 終わり（Q5 が拾う）/ `reserved` → 3 / `dispatched` → 終わり（他の consumer が生成中。止まっていれば U が拾う）/ `stored` → 試行が dispatched なら 5 の S から、settled なら 6 / `uploaded`・`refused`・`failed` → 7
2. V。0 行なら R1（理由は §M-2-3-c の V の後の段落）または Q2 → 7
3. D（`attempt_id` と `dispatch_token` は D1 から読む）。0 行なら読み直し: 試行が reserved のままで、halted でなく job（probe は許可）も有効なら（＝飛行中 2 件で待ち）`retry_later` を返す。それ以外は終わり（X が取り消す）
4. 生成: `images.generate({model, prompt, size, quality, output_format: format, background, n: 1}, {deadline: min(deadline, now + 150 秒)})`
5. 結果で分岐:
   - 画像が使える: R2 put（§M-2-6 の試行キー）→ W → S → 6
   - 応答あり失敗・使えない画像: E（§M-2-3-c の表）→ queued に戻ったら `IMAGE_GEN.send({request_id}, {delaySeconds: 60})` して終わり、他は 7
   - 応答不明（timeout・接続断・本文の受信中の中断）: U（`?mine = 1`）→ 7
6. UP1 → `port.uploadFile(bytes, '<request id>.<format>', media_type)` → UP2。失敗は何もしない（cron が引き取る）→ 7
7. 通知（kind='job' の `uploaded` / `refused` / `failed` だけ）: N1 → `port.sendEvents(session_id, [§M-2-6 の event])` → N2 / 例外で N3。N1 が 0 行なら N7

D1 の失敗などの例外は投げ直し、Queue の再試行（2 回）→ DLQ に任せる。

### d. cron 段 3-c「画像の引き取り」（§B-5 の 3-b triage の直後。締め切り = min(開始 + 60 秒, cron の締め切り)。各項目 20 件まで。paused・halted でも行う）

1. X: `SELECT id, request_id FROM image_attempts a WHERE a.state = 'reserved' AND (VOID_COND) ORDER BY a.reserved_at LIMIT 20` → X（+PD）。queued に戻った依頼は send
2. Q1・Q2（queued の古い順）
3. U（`?mine = 0`）: `state = 'dispatched' AND dispatched_at < ?now_minus_5min` の試行
4. S: 依頼 `stored` かつ試行 `dispatched`（usage_json は W で必ず非 NULL）。consumer と同じ式で `?c` を出す
5. UP: `gen = 'stored' AND stored_at < ?now_minus_3min` に UP1 → upload → UP2。UP3
6. Q3（1 行なら send）・Q4・Q5
7. N: `gen IN ('uploaded','refused','failed') AND notify = 'none' AND updated_at < ?now_minus_2min` に N1 → 送信（0 行なら N7）/ N4 / `notify = 'unknown'` の照合（§M-2-3-c の N の後の段落）
8. SL: 枠を持つ job が終端のもの
9. probe の許可の取り残し: `image_probe_allowed` があれば、読んだ値で PD
10. 掃除（§M-2-6 c）
11. ログ（数値と固定コードだけ）: `{at:'image_cron', requests_queued, requests_stored, requests_uploaded_unnotified, oldest_unanswered_request_at, attempts_reserved, attempts_inflight, attempts_unknown, slots_held, slots_held_without_attempts, halted, files_orphan_suspected, month_cents}`（`slots_held_without_attempts` は V の SQL なら常に 0 のはず＝検知用）

### e. port の追加

**`src/openai.ts`**（`OPENAI_API_KEY` と `https://api.openai.com` を読むのはここだけ）

```ts
export type OpenAiErrorKind = 'no_key' | 'timeout' | 'connection' | 'rate_limited' | 'quota' | 'moderation' | 'auth' | 'bad_request' | 'server' | 'bad_response';
export class OpenAiError extends Error {
  constructor(readonly responded: boolean, readonly status: number | undefined, readonly kind: OpenAiErrorKind) {
    super(`openai_${kind}${status ? `_${status}` : ''}`);
    this.name = 'OpenAiError';
  }
}
export interface ImageUsage { in_text: number; in_image: number; out_image: number; out_text: number }
export interface ImageGenParams { model: string; prompt: string; size: string; quality: string; output_format: 'png' | 'webp'; background: 'opaque' | 'transparent'; n: 1 }
export interface ImagePort {
  readonly isFake: boolean;
  /** 成功: b64 と usage（読めなければ null）。失敗はすべて OpenAiError（本文・headers・cause を持たない） */
  generate(p: ImageGenParams, o: { deadline: number }): Promise<{ b64: string; usage: ImageUsage | null }>;
}
```

- `POST https://api.openai.com/v1/images/generations`、headers `authorization: Bearer <key>` と `content-type: application/json`、body は `ImageGenParams` の JSON（一時 route の p1 と同じ名前。`background` は p1 で使っていない — §M-2-8 の本番確認で 1 件確かめる）
- 締め切り: `AbortSignal.timeout(max(1 秒, deadline − now))` を fetch と本文の受信の両方に効かせる（`readBodyCapped` と同じ形）。本文は 4 MiB で切り、切れたら `bad_response`
- 失敗の分類に読むのは HTTP status と `error.code` だけ（message は読んでも保存・転送しない）。例外は port の境界で必ず `OpenAiError` にしてから外へ出す（`index.ts` の catch は `e.name` をログに出す）
- usage: `input_tokens_details.{text_tokens,image_tokens}` と `output_tokens_details.{image_tokens,text_tokens}`。details が無く合計だけあれば、入力の合計を `in_image`（高い単価）、出力の合計を `out_image` に入れる。usage が無ければ null（→ `{"missing":true}`）

**`FactoryPort`（`src/anthropic.ts`）に足す**

```ts
/** Files API に置く（client.files.upload。beta 不要）。filename は '<request id>.<png|webp>' */
uploadFile(bytes: Uint8Array, filename: string, mediaType: 'image/png' | 'image/webp', o?: CallOpts): Promise<{ id: string }>;
/** 掃除用。404 は成功と同じに扱う */
deleteFile(fileId: string, o?: CallOpts): Promise<void>;
```

本物は `client.files.upload({ file: await toFile(bytes, filename, { type: mediaType }) }, requestOptions(o))` / `client.files.delete(fileId, {}, requestOptions(o))`（`toFile` は `@anthropic-ai/sdk` の index から export）。consumer と cron は deadline を渡すので再試行 0。fake は file id `file_fake_<連番>` を返し、呼び出しを `settings.fake_calls_json` に記録する。

**`src/fake/openai.ts`**: `settings.fake_openai_scenario`（既定 `ok`）で `ok` / `ok_webp` / `rate_limited` / `quota` / `moderation` / `server` / `timeout` / `no_usage` / `over_reserve`（out_image 20,000）/ `bad_bytes` を返す。画像は最小の正しい PNG / WebP（§M-6 と同じ作り方）。呼び出し回数と `{model,size,quality,output_format}` を `settings.fake_openai_calls_json` に記録（smoke が「OpenAI 0 回」を数える）。`src/fake/anthropic.ts` が `createFakeImagePort` を re-export し、`src/anthropic.ts` の `getImagePort` は既存の `loadFake`（FAKE_GUARD の動的 import 1 箇所）から取る。fake の import を増やさないので `check-no-fake.sh` の 3 の検査（動的 import 1 箇所）はそのまま通る。

---

## §M-2-5 費用

### a. U の表（probe p1 の実測の最大 × 1.5 + 入力 4,000 token 上限、切り上げ。コードの定数 `IMAGE_U_CENTS`）

単価（context.md の公式料金）: text 入力 $5 / 画像入力 $8 / 画像出力 $30 per 1M token = 1 token あたり 5 / 8 / 30 micro-dollars。入力の上限 4,000 token（prompt 4,000 バイト、1 token ≥ 1 バイト）= 20,000 micro = 2¢。

| model | size | quality | p1 の出力 token | × 1.5 | 計算 | U |
|---|---|---|---|---|---|---|
| flare / sunburst | 1024x1024 | low | 196 | 294 | 0.9 + 2 = 2.9¢ | **10** |
| flare / sunburst | 1024x1024 | medium | 未測（high 以下） | — | high の値で代える | **10** |
| flare / sunburst | 1024x1024 | high | 1,756 | 2,634 | 7.9 + 2 = 9.9¢ | **10** |
| flare / sunburst | 1024x1024 | max | 7,024 | 10,536 | 31.6 + 2 = 33.6¢ | **35** |
| flare / sunburst | 1536x1024 | low / medium / high | 1,372（high） | 2,058 | 6.2 + 2 = 8.2¢ | **10** |
| flare / sunburst | 1536x1024 | max | 5,488 | 8,232 | 24.7 + 2 = 26.7¢ | **35** |

- sunburst と flare は同じ token 数だった（p1）。表は model ごとに持ち、値は同じ。**表に無い組み合わせ（1024x1536・xhigh・編集・他の model）は `not_configured` で断る**（未決 #4）
- U_max = 35（表の最大値）。1 job の最大の記帳 = 8 × 35 = 280¢
- U は下げる方向にだけ変える（実測が増えたら上げてよいが、その時は §M-2-0 の上界の式を書き直す）

### b. 実額（精算の `?c`）

`micro = in_text × 5 + in_image × 8 + out_image × 30 + out_text × 30`（出力の text は公式の単価が見つからないので画像出力と同じに多めに数える）、`?c = ceil(micro / 10,000)`。usage が missing なら `?c = reserve_cents`（返金なし）。`?c < U` なら差額を予約の day に返金（S1。予約は切り上げ・返金は整数の差なので記帳は実額以上）、`?c > U` なら停止（S2）し、記帳は U のまま（未決 #3）。

### c. 上限のかかり方（すべて予約の 1 文 V1 / P2 の WHERE。読んでから判定しない）

| 上限 | 値 | いつ掛かる |
|---|---|---|
| 月の上限 | `IMAGE_MONTHLY_CAP_CENTS` = 3000（Asia/Tokyo の暦月、`cost_ledger.kind='image'`） | job は**枠を取る最初の予約だけ**（記帳 + U_max ≤ 3000）。probe は毎回（記帳 + U ≤ 3000） |
| 1 注文 8 枚 | 試行の数（void を含む） < 8 | job の予約ごと |
| 日次上限 | `DAILY_CAP_CENTS`（session・検証・入口と共有の日次合計） | 予約ごと（job も probe も） |
| 枠 | `released_at IS NULL` の行 < 2 | job の最初の予約だけ。枠を持つ job は終端まで持つ（budget_reached でも） |
| 飛行中 | `dispatched` + `unknown` の試行 < 2 | dispatch ごと（D1） |
| 停止 | `image_gen_halted` が無い | 予約ごと・dispatch ごと。dispatch 済みには効かない |
| 1 依頼 2 試行 | `tries < 2` | queued へ戻す時（E2・X2） |
| probe | 許可 1 件・その月の probe の試行 < 12 | probe の予約ごと |

**「やりきる」の扱い（context.md の司令塔の解釈どおり）**: (1) dispatch 済みの生成は halted でも最後まで進めて職人へ渡す（停止が効くのは予約と dispatch だけ）。(2) 月の上限に途中で届いても、枠を持つ job は 8 枚まで続けられる（日次上限と 8 枚は毎回掛かる）。超過の上界は §M-2-0 の G3'（3490¢）。

**paused（§B-5-0）**: 本書では画像の予約・dispatch に paused を掛けていない（plan の SQL に無い）。掛けるかは未決 #2。cron の引き取りと通知は paused 中も動く（§B-5-0 の reconcile と同じ）。

**停止の理由と解除**: `over_reserve`（実額 > U）/ `result_unknown`（課金が分からない試行）/ `quota`（OpenAI の残高・上限）/ `auth`（鍵が使えない）/ `manual`。自動では解除しない。解除は H4（unknown の試行を H で全部精算してから）。

### d. 運営の操作（ルート。認証は §B-1 の admin と同じ。GET 以外は Origin 検証）

| Method / Path | 入力 | 処理 / 応答 |
|---|---|---|
| `GET /api/images/status` | — | `{halted: <理由コード>\|null, note, month_cents, month_cap_cents, slots_held, inflight, unknown: [{attempt_id, request_id, kind, job_id, reserve_cents, dispatched_at}], probe_allowed: <attempt id>\|null, probes: [{request_id, gen, error, model, size, quality, settled_cents, created_at}]（新しい順 12 件）}` |
| `POST /api/images/halt` | `{note}`（必須） | H3 と `settings.image_gen_note`。既に停止中でも 200 `{halted}` |
| `POST /api/images/unhalt` | `{note}`（必須） | H4。0 行で unknown が残る → 409 `unknown_attempts_remain`、停止していない → 409 `not_halted` |
| `POST /api/images/attempts/:id/resolve` | `{settled_cents: 0..1000 の整数, note}` | batch H1, H2, PD。H2 が 0 行 → 409 `not_unknown` |
| `POST /api/images/probe` | `{accuracy, size, quality, format, background, prompt}`（alt は不要） | §M-2-2 b で検査（違えば 400 `bad_input`）→ P0（0 行 → 409 `probe_in_progress`）→ P1, P2, V3, V4 → 成功なら send して 201 `{request_id}`、0 行なら P5・P6 → 409（理由コード） |
| `GET /api/images/requests/:id/file` | — | `gen IN ('stored','uploaded')` の時だけ R2 の `r2_key` を §M-3 のヘッダで返す。他は 404 |
| `GET /api/status` | 既存に追記 | `images: {halted, month_cents, month_cap_cents, unknown_count}` |

監査は `console.log` の `{at:'image_halt'|'image_unhalt'|'image_resolve'|'image_probe', attempt_id?, settled_cents?}`（メール・note は出さない）。

画面: 状況帯（§G-1 1.）に「画像: 今月 N¢ / 3000¢（記帳の目安）」と、停止中なら「画像の生成を止めています（<理由の文>）」を出し、`#/images` へのリンク（nav は §N-3 のまま変えない）。`#/images` に: 停止の状態と「止める」「再開する」/ 結果が分からない試行の一覧と「精算する」（金額欄つきダイアログ）/ 試し生成のフォームと最近の結果（画像は `<img src="/api/images/requests/<id>/file">`）。理由の文: `manual`「手で止めました」/ `over_reserve`「1 枚の実額が予約額を超えました」/ `result_unknown`「結果が分からない生成があります」/ `quota`「OpenAI の残高か上限に達しました」/ `auth`「OpenAI の鍵が使えません」。

### UI acceptance criteria（ui-interaction-completeness）
- [ ] CRUD 対称: 停止は「止める」「再開する」の両方がある。unknown の試行は一覧で見え「精算する」で消える（確認ダイアログ付き）。試し生成は結果が一覧に出る。省略: 試し生成の結果の削除はなし（理由: 記帳と監査の記録なので消さない）
- [ ] フィードバック: 各操作は処理中 disabled + 「処理中」表示、成功・失敗（409 の理由を文で）をトーストで出す。二重送信不可
- [ ] フォーム: 精算・試し生成は成功時に入力を消して一覧を再取得。失敗時は入力を保持し理由を出す
- [ ] 状態: unknown 0 件（「ありません」）/ 試し生成 0 件 / 読み込み中 / 取得失敗の表示あり
- [ ] 実機: 上記を実画面で目視確認（smoke で DOM の要素数も数える）

---

## §M-2-6 結果の返し方と保存キー

### a. `user.custom_tool_result`（`BetaManagedAgentsUserCustomToolResultEventParams`。SDK 1.3.0 の型で確認）

成功（gen = `uploaded`）:

```json
{"type": "user.custom_tool_result", "custom_tool_use_id": "<sevt_…>", "is_error": false,
 "content": [
   {"type": "image", "source": {"type": "file", "file_id": "<file_…>"}},
   {"type": "text", "text": "<成功の文>"}
 ]}
```

成功の文（verbatim。`{…}` は値を入れる。`{remaining}` = 8 − その job の試行の数）:

```
画像を作りました（image_id: {image_id}、{accuracy}・{size}・{quality}・{format}）。上の画像を見て、注文票と事実に合っているか確かめてください。直したい時は prompt を直してもう一度呼んでください（この注文で作れる残りは {remaining} 枚）。使う時は material.json の parts[].files[] に {"path": "parts/<part_id>/<ファイル名>.{format}", "role": "figure", "image_id": "{image_id}", "alt": "<絵の説明>"} を書いてください。画像ファイルを outputs に置く必要はありません。
```

断り・失敗（gen = `refused` / `failed`）: `{"type": "user.custom_tool_result", "custom_tool_use_id": "<sevt_…>", "is_error": true, "content": [{"type": "text", "text": "<下の文>"}]}`

| error | 本文（verbatim） |
|---|---|
| `questions_phase` | 画像は制作の指示が来てから使ってください。 |
| `bad_input:<field>` | 入力が正しくありません（{field}）。prompt は 4000 バイト以内、alt は 120 字以内、他の項目は決められた値から選んでください。 |
| `job_image_limit` | この注文で作れる画像（8 枚）を使い切りました。図は SVG で描いてください。 |
| `halted` / `not_configured` / `daily_cap` / `monthly_cap` / `image_slot_unavailable` / `reserve_conflict` | 今は画像を作れません。図は SVG で描いてください。 |
| `moderation` | この内容の画像は作れませんでした（安全上の制限）。描く内容を変えるか、図は SVG で描いてください。 |
| それ以外（`rate_limited` / `quota` / `auth` / `bad_request` / `server` / `bad_response` / `too_large` / `result_unknown` / `upload_failed` / `dlq` / `enqueue_exhausted` / `not_dispatched` / `job_ended`） | 画像を作れませんでした。もう一度試すか、図は SVG で描いてください。 |

image block を file 参照で返すことは本番で未確認（p3 は text だけ）。確かめ方と、駄目だった時の形は未決 #5。

### b. 保存キー

| もの | キー / 名前 |
|---|---|
| image_id（= `image_requests.id`） | `img_` + `crypto.randomUUID()` の hex 32 桁（`/^img_[0-9a-f]{32}$/`） |
| R2（生成した画像。試行ごと） | job: `img/{job_id}/{request_id}/{attempt_id}-{dispatch_token}.{png\|webp}` / probe: `img/probe/{request_id}/{attempt_id}-{dispatch_token}.{png\|webp}`。勝者 CAS（W）が `r2_key` と `sha256` を確定する。古い試行の遅れた put は別キーなので勝者の物体を変えない |
| R2（版の中） | 取り込みが `materials/{material_id}/{job_id}/{logicalPath}` に写す（既存の論理キー。検証係・確認画面・配信はここだけを読む） |
| Files API | filename `{request_id}.{png\|webp}`、media type `image/png` / `image/webp`。`file_id` は `image_requests.file_id`。期限は付けない（未決 #10） |

### c. 掃除（cron 段 3-c 10。plan-v3 B7）

対象: `kind = 'job' AND cleaned_at IS NULL AND gen IN ('uploaded','refused','failed') AND notify IN ('sent','abandoned')` で、job が 30 日より前に更新され `done` / `cancelled`、または `failed` かつ `error <> 'invalid_outputs'`（取り込み直しできる job の画像は消さない）。probe は作成から 30 日。各 20 件: R2 の `img/{job_id}/{request_id}/` 配下を消す（孤立した試行キーも含む）→ `deleteFile(file_id)` → `UPDATE image_requests SET cleaned_at = ?now WHERE id = ? AND cleaned_at IS NULL`。版の論理キーは消さない。

---

## §M-2-7 取り込み・確認画面・配信への影響（§M 段階 1 との差分だけ）

1. **`material.json` の `parts[].files[]`**: 任意のキー `image_id`（文字列）と `alt`（文字列 120 字まで）を足す。`image_id` があれば `path` の拡張子は `.png` / `.webp`、形は `/^img_[0-9a-f]{32}$/`。違えば `invalid_outputs`（`bad_image_ref:<path>`）。`alt` の型違いは無視（§R-46 と同じく安全側の既定）
2. **取り込み（§B-4-d `versioned`）**: image_id を持つ files は raw/ ではなく D1 と R2 から採る。条件（すべて）: `kind = 'job'`・`job_id` がこの job・`gen = 'uploaded'`・`format` が拡張子と同じ・R2 の `r2_key` の物体があり、その SHA-256 が `sha256` と一致・大きさ ≤ `MAX_FILE_BYTES`。通知の状態は見ない。違えば `invalid_outputs`（`bad_image_ref:<path>`）。先頭バイトの検査（§M の中身の検査）は従来どおり `validateOutputs` が掛ける
3. **`resolveOutputLayout(rawNames, materialJsonText, imagePaths)`**: 第 3 引数に image_id の論理パスを渡し、basename の一意の判定に入れる（raw に同じ basename があれば `duplicate_basename:<name>`）。image_id のパスは raw から引かない。参照されない raw の扱いは変えない
4. 版の `content_sha256`・`public_paths_json`・`MAX_FILES`（40）は image_id の画像を含めて従来どおり計算する。取り込み直し（§B-4-e）でも同じ条件で採る（掃除は `invalid_outputs` の job の画像を消さない）
5. **検証係（§F-3 / §L-2）**: 入力の末尾に「# 画像（生成した絵。画像そのものは渡さない）」の見出しと、image_id の files ごとに `- {path}: 正確さ={accuracy}、prompt={prompt}、alt={alt}` の行を足す（plan-v2 の Astra N）。400,000 文字の上限に含める。R2 の列挙（§R-38）の拡張子は変えない
6. **確認画面（§L-6）**: 変えない（§M のサムネイルのまま）。prompt・正確さを出すかは未決 #8
7. **配信（§B-7・§M-3）**: 変えない。`/api/library/available` の files は `{role, url}` のまま（image_id・alt を出さない）
8. **禁止語（§F-2）**: 変えない（画像は検査に入らない。画像の中の文字は §L-6 で人が見る）

---

## §M-2-8 受け入れ基準と検証コマンド

### vitest（`node:sqlite` の実 DB + fake の port。plan-v6 §5・§7〜§9 の t1〜t14 と追加）

| # | 状態 × 失敗点 | 確かめること |
|---|---|---|
| t1 | 月の記帳 2975¢・日次上限到達で 2 job が予約 | 試行 0・枠 0・記帳 0。翌日以降も記帳 ≤ 3000 + 2 × 7 × U_max |
| t2 | reserved の後に cancel がコミット・DLQ で failed 確定 | 後から来た consumer の D が 0 行、fake OpenAI の呼び出し 0 回 |
| t3 | D の後、HTTP 開始前に停止 | 再生成しない。5 分で unknown + halted + 依頼 failed → 通知 |
| t4 | stored × 精算前 / 精算後に停止 | 精算は 1 回。upload は cron が引き取り uploaded |
| t5 | upload 成功 × file_id の保存が応答不明 | upload は最大 2 回。勝者は 1 つ。`files_orphan_suspected` がログに出る |
| t6 | uploaded × 通知前に停止し Queue が空 | cron が通知して sent |
| t7 | sending × 送信成功後・N2 前に停止 | events.list を全ページ照合して sent。二重に送らない |
| t8 | 各状態 × halted / 段階 1 への降格の手順 | §M-2-3-e の 3 つの SQL がすべて 0 になり、待ち続けない |
| t9 | probe の依頼が failed の後の dispatch | 0 行 |
| t10 | probe 成功後 | 降格の完了条件が 0（probe も upload まで進む） |
| t11 | 許可の削除 | 別 attempt の許可を消さない /「許可 → 予約 0 行」「許可直後の停止」の後に次の probe を許可できる /「掃除が古い許可を読む → 同じ attempt の予約が成功 → PD は 0 行」 |
| t12 | 依頼 `reserved` / `dispatched` / DLQ 後 `failed` × 試行 dispatched × halt | どれも void 0・返金 0、5 分で unknown、降格の完了条件が 0 |
| t13 | usage あり / usage 欠落 × stored 直後に停止 | cron が 1 回だけ精算（欠落は U のまま）→ upload → 通知。精算前の UP1 は 0 行 |
| t14 | migration 0004 と拡張子 | 既存の svg / html の variants の fixture が取り込める・files の png / webp は通る・variants の png / webp は落ちる・`kind='image'` と `notify='skip'` が入る・既存の台帳と `idx_cost_ledger_vb` が残る・image の正の行と負の行は試行ごとに 1 つ |
| t15 | reconcile の requires_action | generate_image → I1 と send 1 回。tool_confirmation との混在では deny は tool_confirmation だけ。同じ fixture の 2 回目は登録 0・送信 0。handed の result が idle より新しくても recovered に数えない |
| t16 | deny 数の派生 | refused / failed が sent で 9 件 → 次の reconcile の入口で `too_many_denies` |
| t17 | 入力検査 | prompt 4001 バイト（マルチバイトで 4000 字未満）→ `bad_input:prompt`、enum の外、alt 欠落、16,384 文字超の input |
| t18 | U の表と実額 | 表の全行、表に無い組み合わせは断る、usage → ¢（切り上げ）、details 欠落は保守側、missing → U、実額 > U → halted |
| t19 | 取り込みの image_id | 正常 → 版に png・`content_sha256` と `public_paths_json` に入る。別 job・probe・uploaded でない・sha 不一致・拡張子不一致・raw に同じ basename → `invalid_outputs` |
| t20 | 鍵の印 | OpenAI port の fetch を差し替え、例外の `message`・`cause`・`name`・headers・本文受信中の例外に印を入れ、ログ・D1・R2・custom_tool_result・Files の upload に出ない（port 単体だけでなく consumer・cron・fetch の catch の外側まで） |
| t21 | 結果の形 | §M-2-6 a の content（image の file block + text）、is_error の本文が表どおり、残りの枚数 |
| t22 | 詰まりの終端 | 再送後も届かない（abandoned・resends 1）の handed → job failed `image_result_unsent` + interrupt / archive |
| t23 | (m6) の置き換え | generate_image 以外の custom tool は従来の is_error 1 回、generate_image は登録 |

### smoke（`scripts/smoke.mjs`。fake の Anthropic + fake の OpenAI、`wrangler dev` のローカル queue）

- (i1) 注文 → requires_action（generate_image）の webhook → consumer → fake OpenAI 1 回 → custom_tool_result（image の file block + text）1 回 → session の続き → 版に png → 確認画面のサムネイル（`img` の要素数）→ 承認 → `/api/library/files/…png` が `image/png`・nosniff・CSP、配信バイトの SHA-256 が `image_requests.sha256` と一致
- (i2) 承認前・停止後・旧版・別 job・sha 不一致・manifest 外の画像は 404 / invalid_outputs（対照として (i1) の承認済みが配信される）
- (i3) enqueue の後に cancel → fake OpenAI 0 回・通知 abandoned
- (i4) 9 回目 → fake OpenAI の呼び出しは 8 回のまま、9 回目は「使い切りました」
- (i5) 同じ turn で generate_image を 3 つ並列 → 3 件とも result、生成 3 回
- (i6) 同じ message を 3 回 send（重複配信）→ 生成 1 回・result 1 回
- (i7) halt → queued は refused で通知、dispatched は完了して成功の通知
- (i8) `quota` → halted、次の cron でも halted のまま（自動再開しない）
- (i9) `no_usage` → 記帳 = U / `over_reserve` → halted
- (i10) 月の記帳 2990 を入れて新しい job → `monthly_cap`、枠を持つ job は続く
- (i11) 通知の送信を fake で失敗 → unknown → 照合で見つかる → 二重に送らない
- (i12) 降格の完了条件の 3 つが halt → cron 2 回で 0
- (i13) probe: API で 1 件 → `GET /api/images/status` に結果、続けての 2 件目は 409 `probe_in_progress`
- (i14) 運営の操作: halt / unhalt（unknown が残ると 409）/ resolve の操作ループ（DOM の要素数とトースト）
- (i15) 既存の smoke が全件 PASS（段階 1 の (m6) は t23 に置き換え）

### 本番確認（deploy 後。司令塔。費用は probe の月 12 件の枠と U の記帳に入る）

1. 段階 2 を deploy（職人定義にはまだ tool を足さない）→ 管理画面から probe 1 件（`high`・`1024x1024`・`png`）: 費用 ≤ U、Files の upload まで通る（`uploaded`）
2. probe 1 件を `background: transparent`・`webp` で（param 名の確認）
3. 未決 #5 の確かめ方で image の file block を確かめる
4. 職人定義に §M-2-2 を足して `ant apply --dry-run` → `ant apply`（agent の tools に `generate_image`）→ 実 session で 1 枚（職人が絵を見て採用・描き直し → 取り込み → 確認画面にサムネイル）

### 検証コマンド

```sh
cd factory/worker
npm run typecheck
npm test                 # vitest run。既存の全件 + 本節の t1〜t23
npm run migrate:local
npm run smoke            # SMOKE_RESULT=PASS（既存の全件 + i1〜i14）
bash scripts/check-no-fake.sh   # rc=0（fake の動的 import は src/anthropic.ts の 1 箇所のまま）
grep -rl -e 'api.openai.com' -e 'OPENAI_API_KEY' src; echo "rc=$?"   # 出力が src/env.ts と src/openai.ts の 2 行だけ・rc=0（rc=2 は走査の失敗）
gitleaks detect --no-git
```

---

## §M-2-9 未決事項（plan に無く、判断が要るもの。本文は決めていない）

1. **節番号の衝突**: 段階 1 の §M（CONTRACT-factory.md）に既に「§M-2 中身の検査」がある。A: 本節を §M-2 とし、段階 1 の §M-2 を §M-2b などに改名 / B: 本節を別の記号（例 §M-7、§O）にする / C: 段階 1 の §M を「§M-1」の小見出しにまとめ直す
2. **paused（§B-5-0）が画像に効くか**: A: 効かない（本文のまま。既存の session を止めないのと同じ）/ B: 予約と dispatch を止め、queued のまま待つ（V1・P2・D1 の WHERE に `COALESCE((SELECT value FROM settings WHERE key = 'paused'), '0') <> '1'` を足す。session は requires_action で待つ）/ C: paused 中の新しい依頼は refused（`paused`）
3. **実額 > U の超過分の記帳**: A: 記帳しない（plan どおり。`settled_cents` に実額、台帳は U）/ B: `ref_id = 'iax:' || attempt id` の正の行で超過分を記帳する（月の合計に入る。一意の index を 1 本足す）
4. **表に無い組み合わせ**: 1024x1536・xhigh・編集（v1/images/edits、描き直しに元画像を入れる）は未測。A: 入れない（本文のまま）/ B: probe で測ってから表と input_schema に足す / C: 保守値（1024x1536 = 1536x1024 と同じ、xhigh = 35¢）で今入れる。編集は U に画像入力の上限（元画像 1 枚の token）が要る
5. **image block の file 参照**: `{"type":"image","source":{"type":"file","file_id"}}` を custom_tool_result で受け付け、職人が見られるかは本番で未確認。A: 一時の probe（p5。使い捨ての agent と session に file 参照の result を送る）で先に確かめる / B: 実 session の 1 枚目で確かめ、駄目なら通知を base64 直（`{"type":"base64","media_type","data"}`。PNG 1.5 MB → 約 2 MB の本文。events.send の大きさの上限は未確認）に切り替える / C: 最初から base64 直（Files を使わない。`uploaded` を経ずに通知）
6. **requires_action で待てる時間**: 確認できたのは 4 分（p3）。通常は 1〜3 分だが、consumer が落ちて cron が引き取ると 10〜20 分かかる。A: そのまま進める / B: 30 分の待ちを probe で確かめる / C: 待ちが 15 分を超えた依頼は is_error で返す（生成済みでも捨てる）
7. **同じ turn の複数の generate_image**: event_ids に複数ある時に、session が個別の result を受けて全部そろうまで待つか（または 1 件目で再開するか）は未確認。A: 個別に返す（本文のまま）で smoke (i5) と実 session で確かめる / B: 同じ idle の依頼が全部終わってから 1 回の events.send でまとめて返す（通知の単位が依頼から idle に変わる）
8. **確認画面に生成の情報を出すか**: A: 出さない（本文のまま）/ B: サムネイルの下に「生成（正確さ・prompt）」を出す（`GET /api/review/:version_id` に `generated_images: [{path, accuracy, prompt, alt}]` を足す）
9. **作り直し（rework）で前の job の画像を使えるか**: A: 使えない（plan-v5 の「同じ job」どおり。作り直しは描き直す）/ B: parent_version の job の `uploaded` も採る（8 枚の数え方と掃除の条件が変わる）
10. **Files API の保持**: A: 期限なし（本文のまま。30 日の掃除で delete）/ B: `expires_in_seconds` を付ける（例 30 日 = 2,592,000。session の文脈から file が消えた後の挙動は未確認）
11. **probe 機能を残すか**: p1 は一時 route で済んだ。A: 残す（plan-v6 §7〜§9。表に無い組み合わせの実測と、本番の全経路の確認に使う）/ B: 外す（P・PD・Q5・t9〜t11・i13 が無くなる。表の見直しはまた一時 route で行う）


### 司令塔の裁定（2026-11-05。本文はこの裁定に合わせて読み替え、凍結時に反映する）
1. B: 本節は契約では **§O 画像生成（段階 2）** とする（段階 1 の §M-2 は改名しない）
2. C: paused 中の新しい依頼は予約せず refused（理由 `paused`、職人へは「今は画像を作れません。図は SVG で描いてください。」）。dispatch 済み・予約済みの依頼は最後まで進める（「やりきる」）
3. B: 実額 > U の超過分は `ref_id = 'iax:' || attempt id` の正の行で記帳し、月の合計に入れる（一意 index を 1 本足す）
4. A: 表に無い組み合わせは入れない（1024x1536・xhigh・edits は後日 probe で測ってから足す）
5. A: probe p5（一時 route）で、custom_tool_result の image block を file 参照と base64 直の両方で送り、職人がそれを見たと言えるか（画像の内容を当てさせる）を先に確かめる。結果で §M-2-6 の形を決める
6. C: 依頼から 15 分を超えて通知できない依頼は is_error で返す（生成済みでも捨てる。費用は記帳済み）
7. A: 個別に返す。smoke (i5) と実 session で確かめる
8. B: `GET /api/review/:version_id` に `generated_images: [{path, accuracy, prompt, alt}]` を足し、確認画面のサムネイルの下に出す
9. A: 作り直しは前の job の画像を使わない
10. A: Files は期限なし、30 日の掃除で delete
11. B: probe 機能は本体に入れない（P・PD・Q5・t9〜t11・i13 を削る）。表の見直しは一時 route で行う。一時 route `/api/probe/image-tool` は §O の実装で削除する

---

## 採否（計画どうしの食い違い。採ったものと理由を 1 行ずつ）

1. variants の拡張子: plan-v6 §4「variants は .md だけ」vs plan-v6 §7 の撤回 → §7（と契約 §M-1）を採る。既存の svg / html の variants を壊すため
2. 飛行中の数え方: plan-v4 B1（予約時に数える）vs plan-v5 B2（dispatch の 1 文）→ v5（v6 §2 の SQL）。予約だけで呼ばない試行が枠を塞がない
3. reserved の取り残し: plan-v4 B3 (a)（failed `not_dispatched`）vs plan-v5（void → retry 枠内なら queued）vs plan-v6 §3（halt は refused `halted`）→ X2 で 3 つを順に適用。新しい方を優先し、残りは v4 の結論を終端に使う
4. 取り込みの状態: plan-v2/v3 の `gen='stored'` vs plan-v5 の `gen='uploaded'` → v5。upload に失敗した画像（`upload_failed`）は版に入れない（plan-v6 §3）
5. 通知の応答不明: plan-v2「再送は p4 次第」vs probe p4「二重は無害、1 回の再送は可」→ p4 を採り、plan に無かった再送後の終端（N8 → job failed `image_result_unsent`）を足した
6. sending の取り残し: plan-v3 B5（3 分）vs plan-v6 §3（5 分）→ v6
7. 掃除の期間: plan-v2 B5（7 日）vs plan-v3 B7（30 日・invalid_outputs は消さない）→ v3
8. 状態名: plan-v2 の `generating` vs plan-v5 の `dispatched` → v5
9. 降格の完了条件: plan-v4 B3 (c) vs plan-v6 §3 → v6（v6 が v4 の (2)(3) を置き換えると明記）
10. U_max: plan-v6 §1 の例（25¢・上界 3350¢）vs probe p1（max は 35¢）→ p1。上界は 3490¢
11. U の表の鍵: plan-v4 N（model・size・quality・has_edit ごと）vs probe p1（flare と sunburst は同じ token 数）→ model ごとの表に同じ値を入れ、has_edit の行は作らない（編集は未決 #4）
12. prompt の上限: plan-v2 §3（4,000 字）vs plan-v6 §4（4,000 バイト）→ v6
13. 超過の上界の掛け算: context.md（MAX_CONCURRENT_JOBS × 7 × U）vs plan-v5/v6（枠 2 は SQL の定数）→ v5/v6。本番の `MAX_CONCURRENT_JOBS` は開発週で 3 なので、枠は job の同時数と切り離した定数 2 にする
14. probe の許可の即時削除: plan-v8「予約 0 行ならその場で削除」vs plan-v9（DELETE は 10 分を見直す）→ 管理画面は P6（attempt が無いことだけを見る。id はその操作しか知らない）、cron は v9 の PD
15. 二表の間の窓: plan-v6 §7（試行 dispatched・依頼 reserved の窓を回収）vs 本書の D（D1・D2 を同じ batch）→ 窓は作らず、v8 の回収（U3 が reserved も拾う）は防御として残す
16. deny 数: plan-v2 N2「generate_image の is_error も deny_count に数える」→ 趣旨は採り、列への加算ではなく依頼の行からの派生にした（通知は lease の外で走るので、reconcile の絶対値の CAS と加算が競って数が消える）
17. 8 枚の数え方: plan-v6 §1（void を含む全試行）→ そのまま採る（安全側。呼んでいない試行も 1 枚に数える）
18. Queue の設定: plan-v2（max_retries 2・retry_delay 30）vs Queues の既定（3）→ v2
19. cron の段の予算: plan-v3 N（60 秒・各 20 件・reconcile と検証の後ろ）→ v3。v6 は位置を書いていない
20. probe の位置づけ: plan-v5 §6 の 6（段階 2 の deploy 後に管理画面から p1 を測る）vs 実際（p1 は一時 route で測った）→ U は p1 から決め、probe は表に無い組み合わせと本番の経路の確認に残す（要否は未決 #11）。一時 route は鍵の lint に当たるので本書の範囲で削除する
21. migration の番号: option-queues / option-cron の 0003 vs plan-v5/v6・契約 §L-1 の 0004 → 0004
22. plan に無く本書で足した安全側の規則（判断を広げないもの）: 401/403 で停止（`auth`。鍵が使えないまま全依頼を U で記帳し続けない）/ probe も upload まで進める（降格の完了条件 t10 を満たし、本番の Files の経路を先に確かめる）/ H4 は unknown が残る間は解除しない（plan-v4 の「人が照合して解除」の順序を SQL にした）
