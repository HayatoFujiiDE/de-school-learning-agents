# 実装契約 — コンテンツファクトリー v1（凍結 v3。実装担当はここを正本にする）

設計の根拠は `docs/content-factory-design.md`（人向け）と `~/.claude/plans/adaptive-gathering-hollerith.md`（承認済み計画）。本書は実装に必要な「形」だけを決める。「」内の文言は verbatim、言い換え禁止。本書と設計書が食い違ったら本書を優先し、食い違いを §R に記録する。v2 は Astra（GPT-6）と 3 視点レビューの指摘（§R）を反映した改訂。

一次情報（2026-11-04 確認）: Claude Managed Agents beta `managed-agents-2026-04-01`、`@anthropic-ai/sdk` 1.3.0、`ant` 2.5.0、`wrangler` 4.156.2。SDK の型（`factory/worker/node_modules/@anthropic-ai/sdk/resources/beta/{sessions,webhooks,files}*.d.ts`、`resources/messages/messages.d.ts`）で突き合わせ済み。

## §A ファイル構成と所有

```
factory/
  claude/                                ← ant apply で管理（司令塔が書く。実装担当は触らない）
    agents/material-maker.md             職人の定義（frontmatter = agent、本文 = system prompt）§D-1
    environments/cloud.yaml              作業場（limited networking）§D-2
    rubrics/common.md  kind-3.md  kind-4.md   採点表 §D-3
    editorial-standards.md               編集基準の静的部分（運営が編集）
    allowlist.json                       一次資料ホスト一覧（運営が編集）§D-2
  claude-lock.json                       ant apply が書く（ID のみ）。commit する
  worker/                                ← 実装担当の所有範囲
    wrangler.jsonc  package.json  tsconfig.json  vitest.config.ts  .dev.vars.example
    migrations/0001_init.sql             D1 スキーマ §C-1（1 本。以後は 0002_ から追加）
    scripts/smoke.sh  scripts/check-no-fake.sh  scripts/sync-claude-assets.sh
    src/index.ts                         fetch / scheduled の入口とルーティング
    src/env.ts                           Env 型（bindings / vars / secrets）§B-0
    src/access.ts                        Cloudflare Access JWT 検証 + Origin 検証 §B-1
    src/anthropic.ts                     Anthropic client の生成と薄い wrapper（本物）。fake は src/fake/anthropic.ts §I
    src/db.ts                            D1 の batch ヘルパ（§B-2 の条件付き batch パターン）
    src/state.ts                         純関数: 状態遷移の判定（材料・job・版）§C-2
    src/checks/schema.ts                 純関数: material.json / claims.json / sources.json の検証と公開 manifest の算出 §E
    src/checks/citations.ts              純関数: 出典 URL と引用の機械照合 §F-1
    src/checks/forbidden.ts              純関数: 禁止語・残り物の検査 §F-2
    src/jobs.ts                          job の起動（startJob）・回答・回収（reconcileJob）§B-4
    src/verify.ts                        検証係（Messages API + web_fetch）§F-3
    src/publish.ts                       公開切替の唯一の関数（publishSwitch）§B-6
    src/cron.ts                          10 分ごとの照合・起動・検証 §B-5
    src/generated/claude-assets.ts       scripts/sync-claude-assets.sh が claude/ から生成（rubric・編集基準・allowlist のテキスト）
    src/routes/{materials,jobs,webhook,review,library,status,standards}.ts
    public/admin/index.html  admin.css  admin.js   管理画面（ビルド無し）§G
    test/{state,citations,schema,forbidden,publish-sql}.test.ts  test/fixtures/<scenario>/
```

- `factory/claude/rubrics/*.md`・`editorial-standards.md`・`allowlist.json` は `scripts/sync-claude-assets.sh` が `src/generated/claude-assets.ts` に文字列として書き出す（`npm run build:assets`。`dev` と `deploy` の前に必ず走る）。**実行時に fetch で取りに行かない**
- Worker は TypeScript、`nodejs_compat` 有効、外部ランタイム依存は `@anthropic-ai/sdk` のみ。フレームワークは使わない（ルーティングは手書き）
- `app-v3/` と `CONTRACT-v3.md` は触らない

## §B API（Worker）

### §B-0 bindings / vars / secrets

| 名前 | 種類 | 内容 |
|---|---|---|
| `DB` | D1 | `factory` |
| `R2` | R2 bucket | `factory-materials` |
| `ASSETS` | assets | `{directory: "./public", binding: "ASSETS", not_found_handling: "none", run_worker_first: true}`。**`run_worker_first: true` 必須**（既定では静的ファイルが Worker より先に配信され、Access 検証を素通りする） |
| `FACTORY_AGENT_ID` | var | `claude-lock.json` の agent ID（`agent_...`）。空なら job 起動は 503 `factory_not_configured` |
| `FACTORY_ENV_ID` | var | 同 environment ID（`env_...`） |
| `ANTHROPIC_WORKSPACE` | var | Console の session URL 用。既定 `default` |
| `ACCESS_TEAM_DOMAIN` | var | `https://<team>.cloudflareaccess.com`（issuer） |
| `ACCESS_AUD` | var | Access アプリケーションの AUD |
| `MAX_CONCURRENT_JOBS` | var | 既定 `2`（`creating` + `running` の数） |
| `DAILY_CAP_CENTS` | var | 既定 `1500`（$15/日。日付境界は **Asia/Tokyo** §R-3） |
| `SESSION_BUDGET_DRAFT_CENTS` | var | 既定 `300` |
| `SESSION_BUDGET_REWORK_CENTS` | var | 既定 `500` |
| `VERIFY_MAX_FETCHES` | var | 既定 `25` |
| `VERIFY_MAX_ATTEMPTS` | var | 既定 `3` |
| `ANTHROPIC_API_KEY` | secret | `wrangler secret put`（ふじさんの通常ターミナル） |
| `ANTHROPIC_WEBHOOK_SIGNING_KEY` | secret | 同上。`whsec_...` |
| `ACCESS_DEV_BYPASS_EMAIL` | `.dev.vars` のみ | 設定時、**かつ** リクエスト URL の hostname が `localhost` / `127.0.0.1` の時だけ Access 検証を省略しこの値を reviewer_email にする |
| `ANTHROPIC_FAKE` | `.dev.vars` のみ | `1` のとき、**かつ** hostname が `localhost` / `127.0.0.1` の時だけ fake 実装 §I を使う（scheduled handler では `settings.fake_enabled='1'` も必要。本番ではこの settings 行を作らない） |

`.dev.vars.example` には名前と placeholder（`sk-ant-xxxx`, `whsec_xxxx`）だけ。`ANTHROPIC_FAKE` と `ACCESS_DEV_BYPASS_EMAIL` は secret 経由で入っても hostname 条件で本番では効かない。

### §B-1 認証の境界

| パス | 認証 |
|---|---|
| `/webhook` | Anthropic 署名のみ（`client.beta.webhooks.unwrap(rawBody, {headers, key: env.ANTHROPIC_WEBHOOK_SIGNING_KEY})`。`rawBody = await request.text()`）。Access の外に置く（3xx を返すと endpoint が自動無効化されるため） |
| `/api/library/*` | 認証なし（公開・読み取り専用・一方向）。`Cache-Control: no-store` §B-7 |
| それ以外の `/api/*` と `/admin`, `/admin/*` | Cloudflare Access。Worker 側でも `Cf-Access-Jwt-Assertion` を検証する: RS256、JWKS は `${ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`（`caches.default` に 10 分）、`iss === ACCESS_TEAM_DOMAIN`、`aud` に `ACCESS_AUD` を含む、`exp` が未来、`email` claim が非空。失敗は 401 `{error:"access_denied"}`。**GET 以外**は `Origin` ヘッダが `new URL(request.url).origin` と一致しないと 403 `bad_origin` |

Access アプリケーション（ふじさんが Zero Trust で作る。§R-5）: 対象パス `/admin`, `/admin/*`, `/api/*`。**`/api/library/*` と `/webhook` は Access のパス範囲に含めない**（Bypass ポリシーか、アプリケーションのパス指定で除外）。Worker は Access 設定に関係なく上の検証を行うので、設定漏れは 401 で表面化する（素通りしない）。

### §B-2 共通の形

- JSON のみ。成功は 200/201/204、失敗は `{error: "<snake_case>", message?: string}`。4xx は入力・状態の問題、5xx は外部障害。**webhook は署名 OK なら常に 2xx**
- ID は `crypto.randomUUID()`。時刻は ISO 8601 UTC 文字列。日次集計だけ Asia/Tokyo の日付
- **条件付き batch パターン（`src/db.ts`）**: 複数行をまとめて変える時は D1 の `batch()`（逐次実行の 1 トランザクション）を使い、**全文を同じ述語で条件付け、INSERT を先・UPDATE を後**に並べる。`INSERT INTO ... SELECT ... WHERE EXISTS (SELECT 1 FROM ... WHERE <述語>)` をすべて先に置き、最後に `UPDATE ... WHERE <述語>` を置く（UPDATE が述語の列を変えるので、UPDATE を先に置くと後続 INSERT の述語が消える — §R-15）。述語は**述語の列を変える UPDATE が 1 文だけ**になるように組む（複数テーブルを変える時は、各 UPDATE の述語が互いの更新列に依存しないこと）。batch 後に**最後の UPDATE** の `meta.changes === 0` なら「競合」として 409 を返す。テスト `publish-sql.test.ts` は文字列検査ではなく **`node:sqlite`（Node 24 同梱）の実 DB で batch を順に実行**し、述語成立時は全行、非成立時は 0 行になることを確かめる
- 読み→判断→書きの間に状態が変わりうる箇所はすべて上のパターンか `UPDATE ... WHERE status = ?` の CAS で守る

### §B-3 ルート一覧

| Method | Path | 認証 | 内容 |
|---|---|---|---|
| POST | `/api/materials` | Access | 素材を新規作成し下書き job を queue → 即 start。body §B-4-a |
| GET | `/api/materials` | Access | 一覧（`?work=`, `?publish=`）。各行に `current_version`, `active_job` |
| GET | `/api/materials/:id` | Access | 詳細: material + versions（新しい順）+ jobs + review_decisions + improvement_notes |
| POST | `/api/materials/:id/stop` | Access | 配信停止 `publish_status: available → stopped`。body `{note}` 必須。§B-6 の publishSwitch(`stop`)。制作中の job には触らない |
| POST | `/api/materials/:id/rollback` | Access | body `{version_id, note}`。同素材の `approved` 版ならどれでもよい。publishSwitch(`rollback`) で `current_version_id` を付け替え `available` にする |
| POST | `/api/jobs` | Access | 既存素材に job を queue → start。body §B-4-a（`material_id` 必須、`kind: "draft" \| "rework"`） |
| GET | `/api/jobs/:id` | Access | job + D1 に保存済みの session 状態 |
| POST | `/api/jobs/:id/start` | Access | `queued` の job を起動（§B-4-a の startJob）。他の状態は 409 `not_queued` |
| POST | `/api/jobs/:id/answer` | Access | 段階 1 の質問に答える §B-4-c |
| POST | `/api/jobs/:id/cancel` | Access | `queued/creating/running/needs_answer/budget_reached` から `cancelled`。session があれば `user.interrupt` → `sessions.archive`。他は 409 `not_cancellable` |
| POST | `/api/jobs/:id/reconcile` | Access | `reconcileJob` を即時実行 §B-4-d |
| GET | `/api/review` | Access | `status = 'review'` の版の一覧 |
| GET | `/api/review/:version_id` | Access | 確認画面の全情報 §G-2 |
| GET | `/api/review/:version_id/files/*` | Access | 未承認版のファイルを確認画面用に返す。§B-7 と同じ manifest・同じ応答ヘッダ |
| POST | `/api/review/:version_id/decision` | Access | body §B-6。承認・差し戻し・却下 |
| POST | `/api/review/:version_id/reverify` | Access | `verification_status` を `pending` に戻し `verification_attempts=0`。版が `review` 以外なら 409 |
| GET | `/api/status` | Access | `{paused, paused_note, running_jobs, queued_jobs, today_cents, daily_cap_cents, max_concurrent, agent_configured, last_cron_at}` |
| POST | `/api/status/pause` | Access | body `{paused: boolean, note}`。§B-5-0 の表のとおり効く |
| GET | `/api/standards` | Access | 静的な編集基準 + `standards_log`（新しい順） |
| POST | `/api/standards` | Access | body `{text}` → `kind='note'` |
| GET | `/api/library/available` | なし | 配信 §B-7 |
| GET | `/api/library/files/:version_id/*` | なし | R2 の配信 §B-7 |
| POST | `/webhook` | 署名 | §B-4-d |
| GET | `/admin`, `/admin/*` | Access | `env.ASSETS.fetch(request)` で `public/admin/` を返す |

### §B-4 job の一生

#### a. 起動（queue → start の 2 段。`src/jobs.ts`）

body（`POST /api/materials` は material の項目も含む）:
```json
{
  "material_id": "<既存の時>",
  "title": "レッドストーン回路のしくみ", "slug": "mc-redstone-basics", "catalog_item_id": "mc-redstone",
  "kinds": [3, 4], "concept_codes": [],
  "kind": "draft", "parent_version_id": null,
  "brief_md": "…ふじさんが書く注文票…",
  "no_personal_data": true
}
```
- `no_personal_data !== true` → 400 `personal_data_confirmation_required`（管理画面のチェックボックス「子どもや家庭の個人情報を含んでいません」）。`brief_md` と回答本文は**ログに出さない**
- 既存素材への job: `title/slug/catalog_item_id/kinds/concept_codes` は無視（更新しない）。`parent_version_id` は同素材の版でなければ 400

**queue**（1 batch）: material（新規時 `work_status='queued'`, `publish_status='none'`。既存なら `work_status: idle → queued`）+ job（`status='queued'`, `phase='questions'`, `model` = kind による §D-1）。同素材に active な job（`queued/creating/running/needs_answer/budget_reached`）があれば部分 UNIQUE index で失敗 → 409 `material_busy`。

**startJob(jobId)**（POST の続き・`POST /api/jobs/:id/start`・cron §B-5-1 が呼ぶ）:
1. ガード（読み取り。**上限は「起動を止める目安」であって厳密な上限ではない** — 同時に 2 本が同じ空き枠を見ることはありうる。厳密な上限は session budget と Console の支出上限が担う）: `settings.paused='1'` → 409 `paused` / `creating+running` ≥ `MAX_CONCURRENT_JOBS` → 409 `too_many_running` / 当日 `cost_ledger` 合計 + `creating/running` job の `budget_cents` 合計 ≥ `DAILY_CAP_CENTS` → 409 `daily_cap_reached` / `FACTORY_AGENT_ID` 空 → 503。cron から呼ばれた時は 409 相当なら何もしない
2. CAS: `UPDATE factory_jobs SET status='creating', create_attempts=create_attempts+1, updated_at=? WHERE id=? AND status='queued'`。changes=0 → 409 `not_queued`。同 batch で material `work_status='making'`
3. `sessions.create` §D-4（`metadata.job_id = jobId`）
4. 成功: `UPDATE ... SET status='running', session_id=?, session_created_at=? WHERE id=? AND status='creating'`。201/200 `{job_id, material_id, session_id, console_url}`
5. 失敗: SDK が**応答を受け取った**エラー（`APIError` で `status` がある: 4xx/5xx）→ `UPDATE ... SET status='queued', last_error=<エラー種別のみ> WHERE id=? AND status='creating'`、material `work_status='queued'`。502 `anthropic_error`。**応答が不明**なエラー（`APIConnectionError` / `APIConnectionTimeoutError` / その他の例外）→ job を `creating` のまま残し `last_error='create_unconfirmed'`。502
6. `creating` の復旧（cron §B-5-1、`updated_at < now-10min`）: `sessions.list` を新しい順に、`created_at < job.updated_at - 1h` に達するか 10 ページ読むまで辿り、`metadata.job_id === jobId` の session を探す。1 件 → 採用して `running`。複数 → 最新を採用し他は `sessions.archive`。0 件 → `queued` に戻す。`create_attempts >= 3` なら `failed`（`error='create_unconfirmed'`）、material `work_status='idle'`
7. `cancel` が `queued` / `creating` に来た時: job `cancelled`、material `work_status='idle'`（session があれば archive）

`console_url = https://platform.claude.com/workspaces/${ANTHROPIC_WORKSPACE}/sessions/${session_id}`

#### b. 質問フェーズ → 制作フェーズ

職人は最初のターンで `/mnt/session/outputs/questions.json` を書いて止まる（§D-5）。reconcile が `end_turn` かつ `phase='questions'` を見たら:
- `questions.json` が無い、または `questions` が空 → `user.define_outcome`（§D-6）を 1 件送り、CAS で `phase='making'`（job は `running` のまま）。送信失敗は `last_error` に残して次の reconcile で再送（送る前に `events.list` に `user.define_outcome` が既にあれば送らず `making` にする）
- 空でない → CAS で `status='needs_answer'`, `questions_json` 保存。session は idle のまま（サンドボックスは残る）。reconcile は `needs_answer` の job に対して「session が `terminated` になっていないか」だけ見る（§B-4-d 手順 4）

#### c. 回答（POST /api/jobs/:id/answer）

body `{answers: [{question_id, answer}]}`。4 状態 `answer_state: none | saved | sending | sent`。
1. job が `needs_answer` でなければ 409 `not_waiting`
2. `answer_state='none'` の時だけ: batch で `standards_log` に `kind='question'` で質問と回答を 1 行ずつ + job `answers_json`, `answer_state='saved'`（まだ `needs_answer`）。`saved` / `sending` なら body を無視して保存済みを使う
3. 排他: CAS `UPDATE ... SET answer_state='sending', answer_token=?, updated_at=? WHERE id=? AND status='needs_answer' AND (answer_state='saved' OR (answer_state='sending' AND updated_at < now-5min))`。changes=0 → 409 `answer_in_flight`
4. 送信: `events.list` に `user.define_outcome` が既にあれば送らない。無ければ `user.message`（回答の列挙）+ `user.define_outcome`（§D-6）を**同じ `events.send`** で送る
5. 成功: CAS `UPDATE ... SET status='running', phase='making', answer_state='sent', answered_at=? WHERE id=? AND status='needs_answer' AND answer_token=?`。200
6. 失敗: CAS で `answer_state='saved'`（`answer_token` 一致）に戻し `last_error` に残して 502。運営が再度 answer を押すと 3 から
`paused='1'` の時は 3 以降を行わず 409 `paused`（2 は行う）。reconcile は `needs_answer` の job に対して §B-4-d 手順 3 の `terminated` 判定だけを行う（`end_turn` を見ても何もしない）。

#### d. 回収（/webhook と cron と `POST /api/jobs/:id/reconcile` が同じ `reconcileJob(jobId)` を呼ぶ）

`/webhook`:
1. `unwrap` 失敗 → 400。成功 → `webhook_events` に `INSERT OR IGNORE`。`meta.changes === 0` なら重複 → 204
2. `data.type` ∈ {`session.status_idled`, `session.status_terminated`, `session.outcome_evaluation_ended`, `session.status_run_started`} 以外 → `processed_at` を付けて 204
3. `data.id`（session_id）から job を引く。無ければ `processed_at` を付けて 204
4. `ctx.waitUntil(reconcileJob(job.id).finally(markProcessed))` → 204。**`ctx.waitUntil` の合計は 30 秒**なので reconcile は段階を D1 に残しながら進め、残り時間が無ければ途中で抜ける（cron が続きをやる）

`reconcileJob(jobId)`（冪等・再入可能・段階保存）:
0. **lease**: `UPDATE factory_jobs SET reconcile_token=?, reconcile_until=now+120s WHERE id=? AND (reconcile_until IS NULL OR reconcile_until < now)`。changes=0 → 他が処理中。何もしないで戻る。以後のこの job への書き込みはすべて `AND reconcile_token=?` を付ける。**外部呼び出し（retrieve / events / files）の前に毎回 `UPDATE ... SET reconcile_until=now+120s WHERE id=? AND reconcile_token=?` で延長し、changes=0 なら所有権を失ったとして即座に抜ける**（R2 への書き込みも止める。既に書いた分は job 固有 prefix の同じ内容なので無害）。終了時に `reconcile_token=NULL, reconcile_until=NULL, last_checked_at=now`
0-b. **順序**: まず job.status を見る。`needs_answer` なら手順 2 と 3 の `terminated` 判定だけ（他の分岐に入らない）
1. job が終端（`done/failed/cancelled`）または `queued/creating` なら lease を返して終了（`creating` の回収は §B-4-a-6）
2. `sessions.retrieve(session_id)`。`usage.list_cost.amount`（セント整数文字列）を `list_cost_cents` に保存し、差分（新 − 旧、正の時だけ）を `cost_ledger` に `kind='session'` で追記
3. session `status`:
   - `running` / `rescheduling`: job が `budget_reached` なら CAS で `running` に戻す。終了
   - `terminated`: outputs を取り込めるなら（`phase='making'` かつ job が `running` / `budget_reached` かつ §E の必須ファイルが揃う）6 へ。それ以外は job `failed`（`error='terminated_without_outputs'` / `needs_answer` 中なら `'terminated_waiting_answer'`）、material `work_status='idle'`
   - `idle`: 4 へ
4. `sessions.events.list` を新しい順に読み、最新の `session.status_idle` の `stop_reason.type` で分岐:
   - `requires_action`: `stop_reason.event_ids` の各 id について、`job.denied_event_ids_json` に無いものだけ `user.tool_confirmation {tool_use_id: <sevt_ id>, result: "deny", deny_message: "無人運用のためこの操作は許可できません。別の方法で進めてください。"}` を 1 リクエストで送り、送った id を `denied_event_ids_json` に追加、`deny_count += n`。`deny_count > 8` なら `user.interrupt` + `sessions.archive` → job `failed`（`error='too_many_denies'`）、material `work_status='idle'`
   - `budget_reached`: CAS で job `budget_reached`（material は `making` のまま）。管理画面に「上限に達しました」。Worker からは増額しない
   - `end_turn` かつ `phase='questions'`: §B-4-b
   - `end_turn` かつ `phase='making'`: 最新の `span.outcome_evaluation_end.result` が `satisfied` / `max_iterations_reached` / `failed` なら 6 へ。`span.outcome_evaluation_end` が無い（outcome 未送信）なら §B-4-b の再送を試みて終了
   - `retries_exhausted` / `refusal` / それ以外: job `failed`（`error` = その type、未知は `'unknown_stop_reason'`）、material `work_status='idle'`
   - job が `needs_answer` で `end_turn`: 何もしない（回答待ち）
5. （段階）ここまでで `reconcile_stage='inspected'`
6. 取り込み（`reconcile_stage` が `inspected` → `listed` → `ingested` → `versioned` と進む。各段階の終わりで D1 に stage と `reconcile_state_json` を書く。再入時は stage から再開。時間切れ（waitUntil の残りが 5 秒を切る、または lease 延長に失敗）はその時点で抜け、cron が続きをやる）:
   - `listed`: `files.list({scope_id: session_id, betas:["managed-agents-2026-04-01"]})` を**最後のページまで**辿り、`[{file_id, filename, size}]` を `reconcile_state_json.files` に保存。§E の必須ファイル（`material.json, claims.json, sources.json, adapt-rules.md, selfcheck.md`）が揃わなければ 3 秒待って 2 回まで再取得。それでも欠けるなら job `failed`（`error='invalid_outputs'`）、material `work_status='idle'`
   - `ingested`: `files` の各項目を `files.download` → R2 `materials/{material_id}/{job_id}/{path}` に put し、済んだ `file_id` を `reconcile_state_json.done` に追記（1 ファイルごと D1 更新。再入時は `done` に無いものだけ）。job 固有 prefix なので他 job と衝突しない。同じ job の再実行は同じ内容を同じキーに書くだけで無害
   - `versioned`: R2 から `material.json` 等を読み §E の schema 検証（不正なら `invalid_outputs`）。`events.list` を全ページ読み §F-1、R2 の本文で §F-2 を実行し `checks_json`・`sources` 行・`public_paths_json`（§E-4）・`content_sha256` を作る。batch（§B-2 のパターン、述語 = `job.status IN ('running','budget_reached') AND job.reconcile_token=?`）: `material_versions` INSERT（`version = (SELECT COALESCE(MAX(version),0)+1 FROM material_versions WHERE material_id=?)`、`job_id UNIQUE`）+ `sources` INSERT + material `work_status='review'`（`publish_status` は触らない）+ job `done`（最後の UPDATE）。version は `verification_status='pending'`
   - job が途中で `cancelled` になっていたら（CAS 失敗）取り込みを捨てる
7. 検証係は **cron だけ**が動かす（§B-5-2。waitUntil では走らせない）

### §B-5 cron（`*/10 * * * *`。scheduled handler は最長 15 分）

#### §B-5-0 pause の効き方

| 対象 | `paused='1'` の時 |
|---|---|
| 新しい session の作成（startJob） | 止める |
| 回答の送信（answer 手順 3） | 止める（保存はする） |
| 検証係の実行 | 止める |
| webhook の受信と reconcile（状態の取り込み・deny 送信） | 動く |
| 既に動いている session | 止めない（運営が cancel を押す） |
| 配信 API | 動く |

#### §B-5-1〜4 手順

1. **起動**: `queued` の job（`updated_at < now-1min`）を古い順に最大 1 件 `startJob`。`creating` で 10 分超のものは §B-4-a-6 の復旧
2. **回収**: `running / needs_answer / budget_reached` の job で `last_checked_at IS NULL OR last_checked_at < now-10min` を最大 5 件 `reconcileJob`。`webhook_events` の `processed_at IS NULL AND received_at < now-2min` も対象 job を引いて `reconcileJob`
3. **検証**: `running` で `verification_started_at < now-30min` の版は `pending` に戻す（attempts は増やさない。取得時に数えるため）。`verification_status='pending'` の版を最大 1 件 `runVerification`（取得時に `attempts += 1`。取得前に `attempts >= VERIFY_MAX_ATTEMPTS` なら `failed`）。ガード: `paused` と `DAILY_CAP_CENTS` は検証にも効く
4. `settings.last_cron_at` を更新

### §B-6 確認と公開切替

`POST /api/review/:version_id/decision`:
```json
{
  "decision": "approve" | "return" | "reject",
  "checklist": {
    "content_and_evidence": {"result": "ok" | "ng" | "na", "note": ""},
    "explanation_and_expression": {...}, "relation_to_learning": {...},
    "conditions_of_use": {...}, "artifact_behavior": {...}, "terms_of_use": {...}
  },
  "note": "差し戻し・却下は必須", "brief_append": "差し戻し時の追記（任意）",
  "verification_id": "<GET /api/review/:version_id が返した verifications.id。approve では必須>"
}
```

前提: 版が `status='review'`。同素材に active な job があれば 409 `material_busy`（rework 中の別版承認を防ぐ）。

- `approve` の追加条件（すべて 400。事前チェックであり、最終判定は下の述語で原子的に行う）: 6 項目すべてに `result`（`checklist_incomplete`）/ `ng` が無い（`checklist_has_ng`）/ `verification_status='done'`（`verification_pending`）/ **検証係の verdict** に `contradicted` が無い（`has_contradicted_claims`）/ 検証係が `confirmed` とした claim の `is_primary` 出典に `url_was_fetched=0` が無い（`primary_source_unfetched`）。`license='unknown'` と `quote_found=0` は承認可だが画面に**赤**で出す
- `approve` = `publishSwitch({kind:'approve', material_id, version_id, verification_id, reviewer_email, checklist, note})`
- `return`: batch（述語 = version `review`、§B-2 の順）: `review_decisions` INSERT(`return`, checklist, note) + `standards_log kind='return_reason'` + 新 job `queued`（`kind='rework'`, `parent_version_id`, brief = 元 brief + 差し戻し理由 + `brief_append`）+ material `work_status='queued'` + version `rejected`（最後の UPDATE）。その後 `startJob`。起動失敗でも job は `queued` で残り cron が拾う
- `reject`: batch: `review_decisions` INSERT(`reject`) + `standards_log kind='return_reason'` + material `work_status='idle'` + version `rejected`。`publish_status` は変えない

**`publishSwitch`（`src/publish.ts`。`publish_status` と `current_version_id` を変える唯一の関数）**: 1 batch、§B-2 のパターン（INSERT 先・UPDATE 後）。
| kind | 述語 | 変更 |
|---|---|---|
| `approve` | version `status='review' AND verification_status='done' AND material_id=?` AND `EXISTS verifications(id=:verification_id AND material_version_id=version AND contradicted=0 AND attempt = (SELECT MAX(attempt) FROM verifications WHERE material_version_id=version))` AND `NOT EXISTS active job for material`（古い attempt の id は事前チェックで 409 `stale_verification`） | `review_decisions` INSERT(`approve`, `content_sha256_at_decision`) + material `current_version_id=version`, `publish_status='available'`, `work_status='idle'` + version `approved`（最後の UPDATE。この 1 文だけが述語の列を変える） |
| `rollback` | version `status='approved'` AND material_id 一致 AND (material `current_version_id != version` OR material `publish_status='stopped'`) | `review_decisions` INSERT(`rollback`) + material `current_version_id=version`, `publish_status='available'`（UPDATE） |
| `stop` | material `publish_status='available'` | `review_decisions` INSERT(`stop`, material_version_id = current) + material `publish_status='stopped'`（UPDATE） |

停止の保証範囲は「停止後の新しい取得を拒否する」まで。既に子ども側に届いた内容の回収は保証しない（バディ側は配信 API を都度読む前提。§R-16）。
grep で `publish_status` への UPDATE が `src/publish.ts` にしか無いことを確認できる形にする。`review_decisions` に UPDATE / DELETE を書かない。

### §B-7 配信（一方向）

`GET /api/library/available`（`Cache-Control: no-store`）:
```json
{"materials":[{
  "material_id":"…","slug":"…","title":"…","version":2,"version_id":"…",
  "kinds":[3,4],"catalog_item_id":"mc-redstone","concept_codes":[],
  "summary_elementary":"…","summary_secondary":"…",
  "parts":[{"id":"p1","kind":3,"title":"…","entry_point":{…},"variants":[{"audience":"elementary","length":"short","interest":null,"game":false,"url":"/api/library/files/<version_id>/parts/p1/elementary-short.md"}],"files":[{"role":"figure","url":"…"}],"adjustable":[…],"needs_supporter_check":false}],
  "claims_url":"/api/library/files/<version_id>/claims.json",
  "adapt_rules_url":"/api/library/files/<version_id>/adapt-rules.md",
  "conditions":{…},"license_summary":"…","approved_at":"…"
}]}
```
- SQL: `materials m JOIN material_versions v ON v.id = m.current_version_id AND v.status='approved' WHERE m.publish_status='available'`。条件は JOIN/WHERE で表現する（アプリ側の if で絞らない）
- `approved_at` = その version を対象にした最新の `review_decisions`（`approve` または `rollback`）の `created_at`
- `GET /api/library/files/:version_id/*`: 上の条件を満たす version **かつ** パスが `public_paths_json`（§E-4）に完全一致する時だけ R2 を返す。それ以外は 404。パスは `..`・`%`・先頭 `/`・空セグメントを含めば 404
- 応答ヘッダ（`/api/review/:version_id/files/*` も同じ）: `X-Content-Type-Options: nosniff`、`Cache-Control: no-store`。拡張子別:
  - `.md` → `text/markdown; charset=utf-8`、`.json` → `application/json`
  - `.html` → `text/html; charset=utf-8` + `Content-Security-Policy: sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:`（`allow-same-origin` を付けない = 配信元 origin の cookie・storage に触れない）
  - `.svg` → `image/svg+xml` + `Content-Security-Policy: sandbox; default-src 'none'; style-src 'unsafe-inline'`
- 子どもを表す列・パラメータはこの API に存在しない

## §C D1 スキーマと状態機械

### §C-1 スキーマ（`migrations/0001_init.sql`）

```sql
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
-- keys: paused ('0'|'1'), paused_note, last_cron_at, fake_enabled, fake_scenario（fake はローカルのみ）

CREATE TABLE materials (
  id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
  catalog_item_id TEXT, concept_codes_json TEXT NOT NULL DEFAULT '[]', kinds_json TEXT NOT NULL,
  work_status TEXT NOT NULL CHECK (work_status IN ('idle','queued','making','review')),
  publish_status TEXT NOT NULL CHECK (publish_status IN ('none','available','stopped')) DEFAULT 'none',
  current_version_id TEXT, proposal_id TEXT, brief_md TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE factory_jobs (
  id TEXT PRIMARY KEY, material_id TEXT NOT NULL REFERENCES materials(id),
  kind TEXT NOT NULL CHECK (kind IN ('draft','rework')), model TEXT NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('questions','making')),
  status TEXT NOT NULL CHECK (status IN ('queued','creating','running','needs_answer','budget_reached','done','failed','cancelled')),
  session_id TEXT UNIQUE, session_created_at TEXT, parent_version_id TEXT,
  brief_md TEXT NOT NULL, questions_json TEXT, answers_json TEXT,
  answer_state TEXT NOT NULL CHECK (answer_state IN ('none','saved','sending','sent')) DEFAULT 'none', answered_at TEXT,
  answer_token TEXT, create_attempts INTEGER NOT NULL DEFAULT 0, budget_cents INTEGER NOT NULL DEFAULT 0,
  deny_count INTEGER NOT NULL DEFAULT 0, denied_event_ids_json TEXT NOT NULL DEFAULT '[]',
  list_cost_cents INTEGER NOT NULL DEFAULT 0,
  reconcile_stage TEXT NOT NULL DEFAULT 'none', reconcile_state_json TEXT NOT NULL DEFAULT '{}',
  reconcile_token TEXT, reconcile_until TEXT,
  last_checked_at TEXT, last_error TEXT, error TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_jobs_one_active_per_material ON factory_jobs(material_id)
  WHERE status IN ('queued','creating','running','needs_answer','budget_reached');
CREATE INDEX idx_jobs_status ON factory_jobs(status, last_checked_at);

CREATE TABLE material_versions (
  id TEXT PRIMARY KEY, material_id TEXT NOT NULL REFERENCES materials(id),
  version INTEGER NOT NULL, job_id TEXT NOT NULL UNIQUE REFERENCES factory_jobs(id),
  session_id TEXT NOT NULL, r2_prefix TEXT NOT NULL, content_sha256 TEXT NOT NULL,
  material_json TEXT NOT NULL, claims_json TEXT NOT NULL, adapt_rules_md TEXT NOT NULL,
  selfcheck_md TEXT, grader_result TEXT, grader_explanation TEXT,
  checks_json TEXT NOT NULL, public_paths_json TEXT NOT NULL, tech_dependencies_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('review','approved','rejected')),
  verification_status TEXT NOT NULL CHECK (verification_status IN ('pending','running','done','failed')) DEFAULT 'pending',
  verification_attempts INTEGER NOT NULL DEFAULT 0, verification_started_at TEXT, verification_token TEXT,
  list_cost_cents INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, UNIQUE (material_id, version)
);
CREATE INDEX idx_versions_material ON material_versions(material_id, version);

CREATE TABLE sources (
  id TEXT PRIMARY KEY, material_version_id TEXT NOT NULL REFERENCES material_versions(id),
  source_id TEXT NOT NULL, url TEXT NOT NULL, title TEXT, accessed_at TEXT, quoted_excerpt TEXT,
  license TEXT NOT NULL DEFAULT 'unknown', is_primary INTEGER NOT NULL DEFAULT 0,
  url_was_fetched INTEGER NOT NULL DEFAULT 0, quote_found INTEGER NOT NULL DEFAULT 0, check_detail TEXT
);

CREATE TABLE verifications (
  id TEXT PRIMARY KEY, material_version_id TEXT NOT NULL REFERENCES material_versions(id),
  attempt INTEGER NOT NULL,
  model TEXT NOT NULL, claims_total INTEGER NOT NULL, confirmed INTEGER NOT NULL, hypothesis INTEGER NOT NULL,
  unverified INTEGER NOT NULL, contradicted INTEGER NOT NULL, result_json TEXT NOT NULL,
  cost_cents INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
  UNIQUE (material_version_id, attempt)
);  -- 試行ごとに 1 行。画面と承認は「最新の attempt」を使う

CREATE TABLE review_decisions (
  id TEXT PRIMARY KEY, material_version_id TEXT REFERENCES material_versions(id), material_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approve','return','reject','stop','rollback')),
  checklist_json TEXT, note TEXT, reviewer_email TEXT NOT NULL,
  content_sha256_at_decision TEXT, created_at TEXT NOT NULL
);

CREATE TABLE standards_log (
  id TEXT PRIMARY KEY, material_id TEXT, job_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('question','return_reason','approval_note','note')),
  question TEXT, answer TEXT NOT NULL, created_at TEXT NOT NULL
);

CREATE TABLE improvement_notes (
  id TEXT PRIMARY KEY, material_id TEXT NOT NULL REFERENCES materials(id),
  source TEXT NOT NULL CHECK (source IN ('review','verification','buddy_sampling','scout','manual')),
  note TEXT NOT NULL, created_at TEXT NOT NULL
);  -- 子どもを表す列は作らない

CREATE TABLE webhook_events (
  event_id TEXT PRIMARY KEY, data_type TEXT NOT NULL, resource_id TEXT NOT NULL,
  received_at TEXT NOT NULL, processed_at TEXT
);

CREATE TABLE cost_ledger (
  id TEXT PRIMARY KEY, day TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('session','verify')),
  ref_id TEXT NOT NULL, cents INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX idx_cost_day ON cost_ledger(day);
```

### §C-2 状態機械（`src/state.ts` の純関数で判定。表に無い遷移は `IllegalTransition`）

materials.work_status（制作の進み）:

| from | to | 引き金 |
|---|---|---|
| idle | queued | job queue（draft / rework）。新規素材は queued で生まれる |
| queued | making | startJob が job を `creating` にした時 |
| making | queued | sessions.create が応答ありで失敗（job を queued に戻す） |
| queued | idle | `queued` の job を cancel |
| making | review | 版の取り込み完了 |
| making | idle | job `failed` / `cancelled`（creating / running / needs_answer / budget_reached から） |
| review | idle | approve / reject |
| review | queued | return（rework job queue） |
| idle | queued | 改善 job（available の素材にも起動できる。配信は続く） |

materials.publish_status（配信。`publishSwitch` だけが変える）:

| from | to | 引き金 |
|---|---|---|
| none / stopped / available | available | approve（`current_version_id` を新版に） |
| stopped | available | rollback（approved 版を指定） |
| available | available | rollback（別の approved 版へ付け替え） |
| available | stopped | stop |

factory_jobs: `queued → creating → running → (needs_answer → running) → done | failed | cancelled`。`running ↔ budget_reached`。`creating → queued`（応答ありの作成失敗）。`creating → failed`（`create_attempts >= 3`、`error='create_unconfirmed'`）。`cancelled` は `queued/creating/running/needs_answer/budget_reached` から。

material_versions: `review → approved | rejected`。`approved` と `rejected` は終端（`approved` は何度でも rollback の対象になれる）。

自動遷移は安全側のみ（`failed`・`idle` へ）。`publish_status` の自動遷移は存在しない。

## §D Managed Agents 定義（`factory/claude/`。司令塔が書く。実装担当はここを変更しない）

### §D-1 `agents/material-maker.md`（現物が正。要点）

- `model: {id: claude-sonnet-5-5, effort: high}`。job の `model` 列は draft=`claude-sonnet-5-5`、rework=`claude-opus-5-5`
- `tools`: `agent_toolset_20260401`、`default_config: {enabled: true, permission_policy: {type: auto}}`、`configs`: `web_search` / `web_fetch` を `enabled: true` + `allowed_domains`（allowlist.json の `domains`）、`web_fetch.max_content_tokens: 40000`
- rework の session は `agent: {type: "agent_with_overrides", id, model: {id: "claude-opus-5-5", effort: "high"}}`（override は `model` を丸ごと置き換えるので `effort` を必ず入れる）

### §D-2 `environments/cloud.yaml` と `allowlist.json`（現物が正）

`limited`、`allow_package_managers: false`、`allow_mcp_servers: false`、`allowed_hosts` = allowlist.json の `hosts`（bare は完全一致、`*.` はサブドメインのみ）。SNS は入れない。

### §D-3 rubric（`rubrics/common.md` + `rubrics/kind-N.md`。現物が正）

`user.define_outcome.rubric` は `{type: "text", content: common + 型別}`。採点は形式と完全性に限る。common 1〜12 の要点: 必須キー / claims の status と source_ids / sources の 5 項目 / 段落の claim 参照 `[c3]` / 4 変奏（小・中 × 短・長）/ 禁止語 13 語 / 人名なし・「確認済み」なし / adapt-rules の 2 見出し / selfcheck の三分類と実行結果 / entry_point / **ゲーム的な形 `game.md` が素材に 1 つ以上** / **詳しい版に関心別の入口の例が 2 つ以上**（§R-6）。

### §D-4 `sessions.create` の形（`src/anthropic.ts`）

```ts
client.beta.sessions.create({
  agent: kind === 'rework'
    ? { type: 'agent_with_overrides', id: env.FACTORY_AGENT_ID, model: { id: 'claude-opus-5-5', effort: 'high' } }
    : env.FACTORY_AGENT_ID,
  environment_id: env.FACTORY_ENV_ID,
  title: `${slug} ${kind} ${jobId.slice(0, 8)}`,
  metadata: { job_id: jobId, material_id, kind },
  budget: { type: 'limit', max_list_cost: { amount: String(budgetCents), currency: 'USD' } },
  initial_events: [{ type: 'user.message', content: [{ type: 'text', text: phase1Message }] }],
});
```
`client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, webhookKey: env.ANTHROPIC_WEBHOOK_SIGNING_KEY })`。リクエストごとに生成する。

### §D-5 質問フェーズの `user.message`（Worker が組み立てる。構造固定）

```
# 注文票
<brief_md>

# 編集基準
<editorial-standards.md の本文>
## これまでの回答と差し戻し理由（全素材・新しい順・最大 40 件）
- Q: … / A: …
- 差し戻し: …

# 今回の型
<kinds の列挙と、型別 rubric の本文>

# 最初にやること
注文票と編集基準を読み、作る前に運営に確認したいことがあれば /mnt/session/outputs/questions.json に
{"questions":[{"id":"q1","question":"…","why":"…","default":"…"}]} の形で 3 件以内で書いて止まってください。
編集基準で答えが決まるものは質問にしないでください。確認したいことが無ければ {"questions":[]} を書いて止まってください。
この段階では調査も制作も始めないでください。
```

### §D-6 `user.define_outcome`（制作フェーズ）

```json
{"type": "user.define_outcome",
 "description": "注文票の素材を /mnt/session/outputs/ に §E の構成で作る。調査→構成→制作→自分で動作確認→selfcheck の順",
 "rubric": {"type": "text", "content": "<common + kind-N>"},
 "max_iterations": 3}
```

### §D-7 system prompt（`agents/material-maker.md` の本文が正）

## §E 成果物の形（`/mnt/session/outputs/`）

```
material.json  claims.json  sources.json  adapt-rules.md  selfcheck.md  questions.json
parts/<part_id>/elementary-short.md  elementary-long.md  secondary-short.md  secondary-long.md
parts/<part_id>/game.md               （素材に 1 つ以上）
parts/<part_id>/figure-N.svg          （型 3）
parts/<part_id>/app.html              （型 4）
```
必須ファイル（取り込み条件）: `material.json, claims.json, sources.json, adapt-rules.md, selfcheck.md`。1 ファイル 2 MB 以下、合計 40 ファイル以下（超えたら `invalid_outputs`）。

### §E-1 `material.json`（必須キー 9: `schema_version, slug, title, kinds, catalog_item_id, concept_codes, summary_elementary, summary_secondary, parts`）

```json
{
  "schema_version": 1, "slug": "mc-redstone-basics", "title": "…", "kinds": [3,4],
  "catalog_item_id": "mc-redstone", "concept_codes": [],
  "summary_elementary": "…60 字以内…", "summary_secondary": "…",
  "conditions": {"tools": ["Minecraft Java 1.21"], "place": "教室", "age_band": ["elementary","secondary"], "supporter_check": false},
  "license_summary": "…",
  "parts": [{
    "id": "p1", "kind": 3, "title": "…",
    "entry_point": {"type": "look" | "touch" | "try" | "make", "text": "最初にやること 1 文"},
    "variants": [{"audience": "elementary", "length": "short", "interest": null, "game": false, "path": "parts/p1/elementary-short.md"}, …,
                 {"audience": "elementary", "length": "short", "interest": null, "game": true, "path": "parts/p1/game.md"}],
    "files": [{"path": "parts/p1/figure-1.svg", "role": "figure"}],
    "adjustable": ["例に出すブロックの種類", "説明の長さ"],
    "tech_dependencies": ["svg"],
    "runtime_check": {"how": "…", "expected": "…"},
    "needs_supporter_check": false
  }]
}
```
`variants` は `audience ∈ {elementary, secondary}` × `length ∈ {short, long}` の 4 つが最低限。`interest` は `app-v3/js/data.js` のカテゴリ id か null。`path` は outputs 相対で、**参照先ファイルが実在しなければ schema 検証失敗**。

### §E-2 `claims.json` / `sources.json` / `questions.json`

```json
{"claims":[{"id":"c1","text":"…1 文…","status":"confirmed","source_ids":["s1"],"used_in":["p1"]}]}
{"sources":[{"id":"s1","url":"https://…","title":"…","accessed_at":"2026-11-04","quoted_excerpt":"…逐語…","license":"CC BY-NC-SA 3.0","is_primary":true}]}
{"questions":[{"id":"q1","question":"…","why":"…","default":"…"}]}
```

### §E-3 `content_sha256`

版の全ファイルを `path` の昇順に並べ、`path + "\n" + bytes` を連結した SHA-256（hex）。承認時に `content_sha256_at_decision` へ写す。

### §E-4 公開 manifest `public_paths_json`

`claims.json`, `adapt-rules.md`, `material.json` の `parts[].variants[].path` と `parts[].files[].path` の集合（重複除去、昇順）。**`variants[].path` と `files[].path` は `parts/<part_id>/` 配下で拡張子が `.md` / `.svg` / `.html` のものだけ許す**（それ以外・`sources.json` 等への参照は schema 検証失敗 = `invalid_outputs`）。`sources.json` / `selfcheck.md` / `questions.json` / その他 outputs にあった余剰ファイルは含めない。

## §F 機械検証と検証係

### §F-1 出典照合（`src/checks/citations.ts`、純関数 `checkCitations(sources, events)`）

- `url_was_fetched`: `agent.tool_use` で `name === 'web_fetch'` かつ `normalize(input.url) === normalize(source.url)`。`normalize` = 小文字 host、`#fragment` 除去、末尾 `/` 除去、`http→https` 同一視
- `quote_found`: 対応する `agent.tool_result`（`tool_use_id` 一致）の text に、空白正規化した `quoted_excerpt` が部分文字列として存在。tool_result が無い・本文が offload された（ファイルパスだけ）場合は `quote_found=0, check_detail='result_unavailable'`
- `is_primary=0` の出典は `check_detail='secondary'`（赤にしない）
- 戻り値 `{sources: [{source_id, url_was_fetched, quote_found, check_detail}], summary: {total, fetched, quoted}}`

### §F-2 禁止語と残り物（`src/checks/forbidden.ts`）

- `parts/**` と `summary_*` に禁止語 13 語（点数 / ランキング / 順位 / 評価 / 成績 / レベル / 集中力 / 得意 / 苦手 / 上手 / 成長 / データがありません / 学びのバディ）が無い。あれば `checks_json.forbidden = [{path, word, count}]`
- `app.html` に `<script src`, `<link `, `fetch(`, `import ` が無い（型 4）
- `claims.json` の `source_ids` が全部 `sources.json` に存在。`parts/**` の `[cN]` 参照が全部 `claims.json` に存在
- 「確認済み」が `parts/**` に無い
- いずれも**赤印にするだけで取り込みを止めない**（人が差し戻す）。§E-1 必須キー欠落・参照先不在・JSON 不正・サイズ超過だけが `invalid_outputs`

### §F-3 検証係（`src/verify.ts`、Messages API。cron からのみ）

```ts
client.messages.create({
  model: 'claude-opus-5-5', max_tokens: 8000, thinking: { type: 'adaptive' },
  system: VERIFIER_SYSTEM,   // 固定文
  tools: [
    { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: Number(env.VERIFY_MAX_FETCHES) },
    { name: 'report_verdicts', description: '…', input_schema: VERDICT_SCHEMA, strict: true }
  ],
  tool_choice: { type: 'auto' },   // Opus 5.5 は any / tool の強制を 400 で拒否する（§R-1）
  messages: [{ role: 'user', content: '<claims.json + sources.json + parts/** の本文>。各 claim を出典を開き直して判定し、最後に必ず report_verdicts を 1 回呼ぶ' }]
});
```
- ループ（server tool の公式手順に従う）: 応答の `content` を assistant turn として messages に積む。`stop_reason === 'pause_turn'` → そのまま続きを要求（最大 5 回）。`stop_reason === 'tool_use'` で `report_verdicts` の block があれば終了。`end_turn` で `report_verdicts` が無ければ `user: "report_verdicts を呼んでください"` を足して再送。`max_tokens` / `refusal` / その他は失敗。合計 8 ターンで打ち切り
- `VERDICT_SCHEMA`: `{verdicts: [{claim_id, verdict: 'confirmed'|'hypothesis'|'unverified'|'contradicted', reason, opened_urls: []}], overall_note}`。**`verdicts` の claim_id 集合が `claims.json` と完全一致**しなければその試行は失敗
- lease: 取得時 CAS `UPDATE ... SET verification_status='running', verification_started_at=now, verification_attempts=verification_attempts+1, verification_token=? WHERE id=? AND verification_status='pending'`。終了時 batch（述語 = `verification_status='running' AND verification_token=?`）: `verifications` INSERT（`attempt = (SELECT COALESCE(MAX(attempt),0)+1 FROM verifications WHERE material_version_id=?)`。版ごとに単調増加。`verification_attempts` は再試行上限のカウンタとしてだけ使う）+ `cost_ledger` INSERT + version `done`（UPDATE）。失敗は同じ述語で `pending`（attempts < 上限）または `failed`。述語が成立しなければ（reverify で世代が変わった）結果を捨てる
- 費用: 各試行の usage から定価計算（Opus 5.5 入力 $4 / 出力 $20 per 1M。web_fetch 無料）を `cost_ledger kind='verify'` に追記（失敗試行も）
- `POST /api/review/:version_id/reverify`: CAS `UPDATE ... SET verification_status='pending', verification_token=NULL WHERE id=? AND status='review' AND verification_status IN ('done','failed')`（`running` 中は 409 `verification_running`）。`verification_attempts` は 0 に戻す
- 検証係には制作 session の会話を渡さない

## §G 管理画面（`public/admin/`。ビルド無し、ES2017、`fetch` は自サイトの `/api/*` のみ）

### §G-1 画面

1. **状況**（上部帯）: paused / running / queued / 今日の費用 / 上限 / agent 設定済み / cron 最終時刻。「止める」「再開」（note 必須）
2. **素材一覧**: 配信（なし / 利用できる / 止めている）と制作（待機 / 制作中 / 確認待ち）の 2 軸でフィルタ。行: title, slug, 型, 現在版, active job
3. **新しい素材**: フォーム + チェックボックス「子どもや家庭の個人情報を含んでいません」（必須）→ 確認ダイアログ「この内容で職人に注文します」→ 送信中は無効化 → トースト
4. **job**: 質問待ちなら質問ごとに回答欄 + 「default を使う」。start / cancel / reconcile。Console へのリンク。`last_error` の表示
5. **確認**（§G-2）
6. **編集基準**: 静的本文 + ログ。追記フォーム

### §G-2 確認画面

- 本文: 変奏切替（小 / 中 × 短 / 長、ゲーム）で md を描画。**md 描画は HTML を全部エスケープしてから** 見出し・段落・箇条書き・コード・`[text](https://…)` リンク（`http(s)` のみ、`rel="noopener noreferrer" target="_blank"`）だけを変換する。生 HTML・`javascript:`・`data:` は通さない
- 型 4 の `app.html` は `<iframe sandbox="allow-scripts" src="/api/review/<version_id>/files/parts/p1/app.html">`（`allow-same-origin` を付けない）。SVG は `<img src="/api/review/<version_id>/files/…">`
- claims の表: id / 本文 / 職人の status / 検証係の verdict（confirmed 緑、hypothesis 黄、unverified 灰、contradicted 赤）/ reason
- sources の表: url / title / `url_was_fetched` `quote_found` の緑・赤 / license / is_primary
- `checks_json`、grader の result / explanation、selfcheck.md、adapt-rules.md、費用、Console リンク、検証の状態（pending / running / done / failed + 「再検証」）。応答には最新 attempt の `verification_id` を含め、承認時にそのまま送る
- **6 項目チェックリスト**（verbatim）: 「内容と根拠」「説明と表現」「学習との関係」「使う条件」「生成物の動作」「利用条件」。各 OK / NG / 該当なし + note
- 操作: 「承認する」（6 項目回答 + NG なし + 検証 done + contradicted なし で有効化）/ 「差し戻す」（理由必須、追記任意）/ 「却下する」（理由必須）。確認ダイアログ → 実行中無効化 → トースト → 再取得
- 素材詳細: 「配信を止める」「前の版へ戻す」（approved 版の選択）

### §G-3 操作ループ（ui-interaction-completeness）

書き込み操作すべてで: 予告（文言とダイアログ）→ 実行（二重送信防止）→ フィードバック（成功 / 失敗理由のトースト）→ 反映（再取得）。失敗時は入力を消さない。

## §H 受け入れ基準（司令塔が実出力で確認）

- (a) `/admin` から注文 → 201 `job_id`、D1: material `work_status='making'`、job `running` + `session_id`
- (b) webhook fixture（`session.status_idled`、scenario `questions-empty-then-done`）2 発で、1 発目に `user.define_outcome` が送られ、2 発目で outputs が R2 に入り版が `review` で `/api/review` に出る
- (c) 検証を cron（`scheduled` をローカルで叩く: `curl "http://localhost:8787/__scheduled?cron=*/10+*+*+*+*"`）で `done` にし、6 項目を埋めて承認 → `/api/library/available` に出る → `stop` で消える（`no-store`）→ `rollback` で戻る
- (d) 同じ webhook を 2 回 POST しても版は 1 つ
- (e) scenario `done-bad-source` で `url_was_fetched=0` / `quote_found=0` が赤
- (f) `gitleaks detect --no-git` 0 件
- (g) scenario `questions-nonempty`: job `needs_answer` → answer → `standards_log` 行が増え、fake の呼び出し記録に `user.message` + `user.define_outcome` の 1 リクエストが残る
- (h) scenario `requires-action`: `user.tool_confirmation deny` が `sevt_` id に送られ `deny_count` 増加。同じ fixture を再度 reconcile しても二重送信しない
- (i) 検証 `done` 前の approve は 400 `verification_pending`。`contradicted` を含む scenario は 400 `has_contradicted_claims`
- (j) `vitest run` 全 pass（state の遷移表 + 不正遷移 / citations / schema（参照先不在・parts 外参照を含む）/ forbidden / publish-sql（`node:sqlite` で approve・rollback・stop・return の batch を実行し、述語成立で全行・非成立で 0 行））
- (n) `reverify` 後に 2 回目の検証が `done` になり `verifications` が 2 行（attempt 1, 2）。approve に古い `verification_id` を渡すと 409
- (k) `/api/library/files/<version_id>/sources.json` と `../` を含むパスが 404。`app.html` の応答に CSP `sandbox allow-scripts` と `nosniff`
- (l) Access 無し（ヘッダなし・非 localhost host）で `/admin` と `/api/materials` が 401、`/api/library/available` と `/webhook`（署名 NG → 400）は Access を要求しない
- (m) 同素材に 2 本目の job → 409 `material_busy`

## §I 検証コマンドと fake

```sh
cd factory/worker
npm run build:assets       # scripts/sync-claude-assets.sh
npm run typecheck          # tsc --noEmit
npm test                   # vitest run（純関数のみ）
npm run migrate:local      # wrangler d1 migrations apply factory --local
npm run dev                # wrangler dev（ローカル D1/R2）
npm run smoke              # scripts/smoke.sh: dev をバックグラウンドで起動し (a)〜(e),(g)〜(i),(k)〜(m) を curl で叩き PASS/FAIL と SMOKE_RESULT=PASS|FAIL を出す
bash scripts/check-no-fake.sh   # wrangler.jsonc の vars に ANTHROPIC_FAKE / ACCESS_DEV_BYPASS_EMAIL が無いこと、src/fake/ を import するのが src/anthropic.ts の hostname ガード内だけであること（rc）
```

fake（`src/fake/anthropic.ts`）: §B-0 の条件下でのみ。`sessions.create`（job ごとに新しい `sesn_<uuid>`）/ `retrieve` / `events.list` / `events.send` / `archive` / `files.list` / `files.download` / `messages.create` を `test/fixtures/<scenario>/` から返し、**送った events と messages.create の引数を `settings.fake_calls_json` に追記**する（smoke が (g)(h) を確認するため）。scenario は `settings.fake_scenario`。scenario 一覧: `questions-nonempty`, `questions-empty-then-done`, `requires-action`, `budget-reached`, `terminated-no-outputs`, `done-bad-source`, `done-contradicted`, `retries-exhausted`。本番コードに fake を有効化する別経路を作らない。

## §J スコープ外（v1 では作らない。理由 1 行）

- Files API による rubric / brief の upload（text rubric で足りる）
- deployments / multiagent / memory store / vault / MCP / skills（職人 1 体・1 session）
- Queues / Workflows / KV（webhook + cron + D1）
- 検証係の Managed Agents 化（Messages API の独立文脈のほうが安い）
- 3 入口・「今日のお題」（§K）
- app-v3 からの読み込み（契約 §A の fetch 禁止との整合は別途裁定）
- 月次の出典再確認、改善提案の自動採択、段階 2 以降の自走、brief の自動 PII 検出（チェックボックスと運用で担保）

## §K 第 2 スライス（入口）の凍結済みインターフェース（Phase D-2）

- テーブル: `proposals(id, created_at, source_kind CHECK IN ('child','scout','meeting','manual'), title, body, evidence_json, catalog_item_id, kinds_json, similar_count, status CHECK IN ('proposed','adopted','dismissed'), supporter_checked INTEGER, adopted_by, adopted_at, material_id)`, `scout_runs`, `meeting_minutes`, `topics(material_version_id, publish_date, needs_supporter_check)`
- ルート: `GET/POST /api/proposals`, `POST /api/proposals/:id/adopt`（→ `POST /api/materials` と同じ処理）, `/dismiss`, `POST /api/intake`（子ども由来・`supporter_checked` 必須・個人を含む項目を受け付けない）、cron 週 1 `scout`（Haiku 5.5）、月 2 回 `meeting`（Sonnet 5.5）
- secret: `XAI_API_KEY`（収集部隊のみ）

## §R 裁定記録（2026-11-04。Astra medium + 3 視点レビューの指摘への裁定）

1. **`tool_choice: any` は Opus 5.5 で 400** → `auto` + `strict: true` + 再送ループ（§F-3）。採用
2. **公開状態と制作状態を 1 列で兼ねていた** → `work_status` と `publish_status` に分離。rollback は `approved` 版ならどれでも。`superseded` を廃止。`publishSwitch` を唯一の切替関数に（§B-6, §C）。採用
3. **日次上限の日付境界** → Asia/Tokyo を既定（ふじさん確認待ち）
4. **検証・機械検査が赤でも人のチェックだけで承認できるか** → `contradicted` あり / confirmed の一次出典が未 fetch は承認不可。`license=unknown` と `quote_found=0` は承認可だが画面に赤（ふじさん確認待ち）
5. **Access のパス範囲の所有** → ふじさんが Zero Trust で設定（§B-1 に範囲を明記）。Worker 側検証で設定漏れは 401 に倒れる
6. **ゲーム的な形と関心別入口** → 設計書 §6 の 4 層に合わせ、`game.md` 1 つ以上と関心別入口 2 つ以上を rubric 必須に昇格
7. **`ctx.waitUntil` 合計 30 秒** → reconcile は段階保存で再入可能に、検証係は cron（15 分）だけで実行
8. **Static Assets が Worker より先に配信** → `run_worker_first: true`
9. **同一 origin での生成物実行** → 配信・確認とも CSP `sandbox`（`allow-same-origin` なし）+ `nosniff`、manifest 外のファイルは 404、md は全エスケープ描画
10. **キャッシュで停止が即時でない** → 配信 API は `no-store`
11. **answer / return / create の途中失敗** → answer は 3 状態、return は queue までを原子化して起動は cron が再試行、create は `creating` 状態 + `metadata.job_id` で採用
12. **stop の意味** → 配信停止のみ。制作中の job は続き、版は `review` で待つ。承認で再び `available`（ふじさん確認待ち。別案: stop で active job も cancel）
13. **設計書との差分**: 設計書 §12 の「`initial_events` で brief + define_outcome を渡す」は本書 §B-4-b の「質問フェーズ後に define_outcome を送る」に変更（段階 1 の制作前質問を実現するため）
14. 棄却: 「brief の自動 PII 検出」（氏名検出は機械化できないため運用で担保。`no-secrets-to-agents` の方針と同じ）

v3（Astra 再レビュー後）:
15. **同じ述語の batch で先頭 UPDATE が後続 INSERT の述語を消す**（SQLite 実測で指摘）→ INSERT 先・UPDATE 後に固定し、述語列を変える UPDATE は 1 文だけ。テストは `node:sqlite` の実行に変更
16. **approve の述語が弱い** → `verification_id`（世代）・`done`・`contradicted=0`・active job 不在・素材一致を述語に含める
17. **段階保存の中身が無い** → `reconcile_state_json` に files / done を持ち、ファイル単位で再開。lease は外部呼び出し前に毎回延長し、失敗したら即抜ける
18. **検証の UNIQUE 衝突・世代混線・attempts 二重加算** → `verifications` は試行ごと 1 行、`verification_token` で世代を固定、attempts は取得時のみ
19. **`pause_turn`** → server tool の継続手順をループに追加
20. **answer の二重送信** → `sending` 状態 + `answer_token`
21. **create の応答不明** → `creating` に残し、`sessions.list` で採用、3 回で `failed`
22. **manifest に非公開ファイルが紛れる** → `parts/` 配下・拡張子限定を schema 条件に
23. **return / reject の監査記録** → `review_decisions` に INSERT
24. **上限は厳密か目安か** → 目安（起動停止）。厳密な上限は session budget と Console の支出上限
25. 未凍結（ふじさん確認待ち。既定で進める）: §R-3 日付境界 = Asia/Tokyo、§R-4 承認可能条件、§R-12 stop = 配信停止のみ
26. 停止の保証範囲は「新しい取得の拒否」まで（§B-6 末尾）

v3.1（Opus 実装担当の指摘）:
27. reverify 後の `attempt` が UNIQUE で衝突 → `attempt = MAX+1`（版ごと単調増加）。`verification_attempts` は上限カウンタ専用
28. approve の述語が古い `verification_id` を弾けない → `attempt = MAX(attempt)` を述語に追加、事前チェックは 409 `stale_verification`
29. 承認版が 1 つの素材は stop 後に配信へ戻せない → rollback の述語に `OR publish_status='stopped'` を追加（同じ版を再び配信できる）
30. `creating → failed` を job 遷移表に追加

v3.2（Astra high 実装レビュー後）:
31. 検証係の入力は `parts/**` の .md / .html / .svg すべて。合計 400,000 文字超は切り詰めず試行を `failed` にし、理由は `improvement_notes(source='verification')` に残す（`material_versions` に `last_error` 列を足さない）
32. events / files は全ページ取得。途中で抜ける時は `reconcile_state_json` に続き位置を保存。外部呼び出しの timeout は残時間に連動（waitUntil 25 秒 / cron 10 分）、reconcile 内の SDK 再試行は 0
33. cancel は CAS 後に再読して session を interrupt + archive。失敗へ落とす UPDATE は読んだ時点の status / phase を述語に含める
34. `pause_turn` の継続は応答の `container` id を引き継ぐ。HEAD も Origin 検証の対象
