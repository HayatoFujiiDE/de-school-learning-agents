# コンテンツファクトリー（factory/）

設計は `../docs/content-factory-design.md`、実装契約は `../CONTRACT-factory.md`。ここには「動かすまでの手順」だけを書く。秘密の値はこのリポジトリに書かない。

## 構成

- `claude/` — Claude Managed Agents の定義（職人 `agents/material-maker.md`、作業場 `environments/cloud.yaml`、採点表 `rubrics/`、編集基準、allowlist）。`ant apply` で同期し、`claude-lock.json` を commit する
- `worker/` — Cloudflare Worker（HTTP + cron + 管理画面）。D1 と R2 を使う

## ローカルで動かす（本物の API は呼ばない）

```sh
cd factory/worker
npm install
cp .dev.vars.example .dev.vars        # 値は placeholder のまま。ANTHROPIC_FAKE=1 で fake 実装が動く
npm run migrate:local
npm run dev                           # http://localhost:8787/admin
npm test                              # 純関数のテスト
npm run smoke                         # 受け入れ基準を fake で一周（SMOKE_RESULT=PASS）
```

管理画面の入口は工場ビュー（`/admin/#/`）。素材一覧は `#/materials`

## 本番の現状（2026-11-04）

- Worker: `https://de-school-factory.h-fujii.workers.dev`（管理画面 `/admin/`。Cloudflare Access でふじさんのメールだけ許可）
- Anthropic: workspace「Learning-Agents」、職人 `de-school-material-maker` / 作業場 `de-school-factory-cloud`（ID は `claude-lock.json`）、webhook 登録済み（4 種類）、月の支出上限 $100
- Cloudflare: D1 `factory`、R2 `factory-materials`、Access アプリ 2 つ（`de-school-factory admin` = admin/api を許可制、`de-school-factory library public bypass` = `/api/library/*` を公開）
- secret: `ANTHROPIC_API_KEY` / `ANTHROPIC_WEBHOOK_SIGNING_KEY` / `OPENAI_API_KEY` 投入済み（2026-11-04）。`XAI_API_KEY` は未投入（RSS だけで動く）
- 名前の対応: Cloudflare の Worker 名は `de-school-factory`。OpenAI 側の鍵の名前は `learning-agents-factory-worker`（Default project・Service account・90 日。期限が来たら同じ手順で `wrangler secret put OPENAI_API_KEY`）。Anthropic の workspace は `Learning-Agents`。名前は揃えていないが、どれも同じ工場を指す

## 本番に出す手順（運営が通常ターミナルで行う。順番どおり）

1. Anthropic 側
   ```sh
   ant auth login
   cd factory
   ant apply --dry-run -v claude/agents/material-maker.md claude/environments/cloud.yaml   # 計画を見る
   ant apply --yes claude/agents/material-maker.md claude/environments/cloud.yaml           # 作成。claude-lock.json ができる
   ```
   `claude-lock.json` の `agent_...` と `env_...` を `worker/wrangler.jsonc` の `FACTORY_AGENT_ID` / `FACTORY_ENV_ID` に書く
2. Cloudflare 側
   ```sh
   cd factory/worker
   npx wrangler login
   npx wrangler d1 create factory                 # 出力の database_id を wrangler.jsonc に書く
   npx wrangler r2 bucket create factory-materials
   npx wrangler d1 migrations apply factory --remote
   npm run deploy                                 # check-no-fake を通してから wrangler deploy
   npx wrangler secret put ANTHROPIC_API_KEY      # プロンプトに値を貼る
   npx wrangler secret put ANTHROPIC_WEBHOOK_SIGNING_KEY
   npx wrangler secret put XAI_API_KEY            # 収集部隊の X 検索用（任意。無ければ RSS だけで動く）
   ```
3. Cloudflare Access（Zero Trust）: アプリケーションを作り、対象を `<worker の URL>/admin*` と `/api/*` にする。**`/api/library/*` と `/webhook` は対象に含めない**。AUD と team domain を `wrangler.jsonc` の `ACCESS_AUD` / `ACCESS_TEAM_DOMAIN` に書いて再 deploy
4. Anthropic Console → Manage → Webhooks: URL `https://<worker の URL>/webhook`、購読する種類は `session.status_idled`, `session.status_terminated`, `session.outcome_evaluation_ended`, `session.status_run_started`。表示された `whsec_` を手順 2 の `wrangler secret put ANTHROPIC_WEBHOOK_SIGNING_KEY` で投入
5. Console の Spend limit（月の上限）を設定する
6. 入口（提案箱・収集部隊・会議。契約 §K）
   - `factory/scout/sources.json` を編集して情報源を決める（RSS 10 本・X の handle 20 件まで）。変更したら `npm run build:assets` → `npm run deploy`
   - 収集は週 1（`SCOUT_DAY`、既定 月曜）、会議は月 2 回（`MEETING_DAYS`、既定 1 日と 15 日）に cron が起こす。管理画面の「収集を今すぐ」「会議を今すぐ」で手動起動できる。月次上限は `SCOUT_MONTHLY_CAP_CENTS`（$5）/ `MEETING_MONTHLY_CAP_CENTS`（$2）
   - 最初の手動起動で確かめること: `SCOUT_XAI_MODEL`（既定 `grok-4.3`）が x_search に対応しているか、所要時間が 25 秒に収まるか（収まらなければ cron 任せにする）
   - バディ側から提案を送る `POST /api/intake` は Cloudflare Access の service token で呼ぶ（`CF-Access-Client-Id` / `CF-Access-Client-Secret` と `Origin` ヘッダ）。`supporter_checked: true` が無い提案は受け付けない

## 運用の勘所

- 「利用できる」への切替は管理画面の承認だけ。職人側に遷移手段はない
- 素材に組み合わせてよい立体モデル（3D）は `factory/models3d/catalog.json` の一覧だけ（人が提供元の記録でライセンスを確かめたもの。CC0 / CC BY / NASA の利用の決まり。足し方は同じフォルダの README）。変更したら `npm run build:assets` → `npm run deploy`
- 止めたい時は管理画面の「止める」（新しい session を作らない）。配信を止めるのは素材ごとの「配信を止める」
- 予算に当たった job（`budget_reached`）は、job 画面の赤い帯にある「$5 / $10 / $20 増やして続ける」で増額できる（`POST /api/jobs/:id/raise-budget`、契約 §B-4-f）。新しい予算は `max(今の予算, 使った額 + 1¢) + 増やす額`（1 job $50 まで・日次上限あり）。増額が受理されると職人は自動で続きを始める（公式仕様）。cron・webhook・職人からは増額しない
- Files API はファイル名の basename しか返さないので、職人の成果物はファイル名が素材全体で一意である必要がある（契約 §E-0）。Worker は `raw/` に取り込んでから material.json の参照で `parts/<id>/…` の論理キーへ復元する
- 取り込み（schema 検証）で `failed` になった job は、Worker や職人定義を直した後に管理画面の「取り込みをやり直す」で費用ゼロで取り込み直せる（契約 §B-4-e）。職人に同じ session で書き直させた場合も同じ操作でよい
- 段階 0 の実測（2026-11-04）: 型 3 + 型 4 + 変奏一式の注文 1 本で $6.17（$3 では途中で止まる）
