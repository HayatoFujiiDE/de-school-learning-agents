# §U 機械用の注文の入口（2026-11-07 凍結）

ふじさん裁定（2026-11-07）: 「そっちでいれられない？この内容も自動化したい」→ A（Claude が新しい注文を入れられる入口。差し戻しは含めない）。

## 目的と範囲

- Claude（ふじさんの手元の Claude Code）が、会話で頼まれた新しい素材の注文を工場に入れられるようにする。
- できること: **新しい素材の draft の注文 1 種類だけ**。差し戻し・承認・公開・提案箱・設定変更・既存素材への追加注文はできない。
- 人の入口（`POST /api/materials`・画面）は一切変えない。

## U-1 認証

1. `POST /api/orders` を追加する。`requireAccess` は `/api/intake` と同じく service token（`common_name`）を受ける。Origin の検証は既存どおり（POST なので必須）。
2. `AccessResult` に「service token で通ったか」を表す明示のフィールド（例 `service: true`）を持たせ、`RouteCtx` へ渡す。**文字列の接頭辞（`service:`）で判定しない**。
3. `/api/orders` は service token の時だけ受ける。人（email）で来たら 403 `service_only`。
4. `common_name` が env `ORDER_CLIENT_IDS`（カンマ区切り。前後の空白は除く）の**どれかと完全一致**する時だけ通す。未設定・空・不一致は 403 `orders_disabled`（どれが理由かは応答で区別しない）。`ORDER_CLIENT_IDS` は `wrangler secret` で入れる（repo に書かない。`env.ts` では任意の string）。
5. `/api/intake` 以外の既存ルートが service token を拒むことは変えない（`/api/orders` を足したことで他ルートが通らないことを test で固定する）。`/api/intake` の動作も変えない。

## U-2 リクエスト

`{ request_id, title, slug, kinds, brief_md, no_personal_data: true, catalog_item_id?, concept_codes? }`（上限 64 KiB）

- `request_id`: `^[A-Za-z0-9_-]{8,64}$`。必須。無効は 400 `invalid_request_id`。
- 残りは `parseNewMaterialBody` と同じ検査・同じ error（`material_id` / `kind` / `parent_version_id` の扱いも同じ）。

## U-3 記録と上限（migration `0007_machine_orders.sql`）

```sql
CREATE TABLE machine_orders (
  request_id TEXT PRIMARY KEY,
  client TEXT NOT NULL,          -- common_name
  material_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  day TEXT NOT NULL,             -- 1 日の区切りは cost_ledger の日と同じ決め方
  created_at TEXT NOT NULL
);
CREATE INDEX idx_machine_orders_day ON machine_orders(day);
CREATE INDEX idx_machine_orders_material ON machine_orders(material_id);
```

1. **1 日の件数の上限**: env `ORDER_DAILY_MAX`（既定 5。0 以下なら全部止まる）。その日の `machine_orders` の行数が上限未満の時だけ入る。判定は materials / factory_jobs / machine_orders の INSERT と**同じ batch の SQL の述語**で行う（先に数えて後で入れる形にしない）。超えたら 429 `daily_order_limit`。
2. **止める設定**: settings `machine_orders_enabled` が `'0'` の時は 403 `orders_disabled`。これも同じ述語に入れる（判定と INSERT の間に切り替わっても入らない）。行が無ければ有効。
3. **同じ request_id の再送**: 行が既にあれば新しく作らず、200 `{ material_id, job_id, replay: true }` を返す（client が違う時は 409 `request_id_conflict`）。同時に 2 通来ても素材は 1 つ（PRIMARY KEY と batch の原子性で保証。負けた方は再読して replay を返す）。replay では startJob を呼ばない。
4. slug の重複などで INSERT が 0 件の時の error は人の入口と同じ（`slug_taken` 等）。machine_orders の行は残らない。
5. 成功時は人の入口と同じく `startAfterQueue` で起動し、201 を返す。金額の上限は既存のまま（1 注文 `SESSION_BUDGET_DRAFT_CENTS`、1 日 `DAILY_CAP_CENTS`）。最悪の式: `ORDER_DAILY_MAX × SESSION_BUDGET_DRAFT_CENTS` = 5 × $8 = $40 / 日（かつ 1 日の全体の上限 `DAILY_CAP_CENTS` の内側。2026-11-11 までは $200、その後 $60）。
6. ログは `{ at: 'machine_order', client, material_id, job_id }`。注文票の本文・題名は出さない。

## U-4 画面（読み取りだけ）

- `GET /api/jobs/:id` と `GET /api/materials/:id` の応答に `machine_order: { client, created_at } | null` を足す（素材は最初の注文の行）。
- 注文の状況の画面と素材の画面の事実の欄に「注文した人: Claude（機械の入口）」を出す（行がある時だけ。`client` の文字列は画面に出さない）。
- 既存の表示・操作は変えない。

## U-5 手元の道具 `factory/worker/scripts/order.sh <注文の JSON ファイル>`

- macOS の keychain から 2 つを読む: service `de-factory-order` の account `client-id` と `client-secret`（`security find-generic-password -s de-factory-order -a <account> -w`）。
- 値は**引数・画面・ログ・一時ファイルに出さない**。curl へは `--config -`（標準入力）で header を渡す。`set -x` を使わない。失敗時も値を含む文字列を出さない（curl の `-v` は使わない。stderr は捨てる）。
- 送るもの: `POST https://de-school-factory.h-fujii.workers.dev/api/orders`、`Origin` は同じ origin、`CF-Access-Client-Id` / `CF-Access-Client-Secret`、body はファイル（`request_id` が無ければ道具が作って足す。JSON の検査は python3 か node）。
- 出すもの: 送った `request_id`（同じ注文を送り直す時にファイルへ書けば replay になる）、HTTP の status と、応答の `material_id` / `job_id` / `replay` / `error` / `start_error` だけ。status が 200 / 201 以外なら exit 1。応答が JSON でない時（Access のログイン画面など）は「入口に届いていない」と status だけを出す。
- keychain に無い時は、入れ方（ふじさんが通常のターミナルで行う 2 行）を出して exit 2。
- zsh / bash のどちらでも動く。`zsh -n` と、偽の `security` / `curl` を PATH の先頭に置いた test（値が出力に現れないこと・header が argv に載らないこと）で確かめる。

## U-6 受け入れ（vitest）

1. service token + 一致する client → 201、素材・job・machine_orders が 1 行ずつ。
2. 人（email）→ 403 `service_only`。3. 不一致の client・未設定 → 403 `orders_disabled`。4. Origin なし → 403 `bad_origin`。
5. 既存の他ルート（例 `POST /api/materials`・`GET /api/floor`）は service token で今までどおり拒まれる（Access の段の 401 `access_denied`）。`/api/intake` は今までどおり。
6. 上限: 5 件目まで 201、6 件目 429。日が変われば入る。`ORDER_DAILY_MAX=0` は全部 429。
7. `machine_orders_enabled='0'` → 403、素材は増えない。
8. 同じ request_id の再送 → 200 replay、素材は 1 つ、startJob は 1 回。別 client の同じ request_id → 409。
9. `no_personal_data` なし・slug 重複・不正な kinds は人の入口と同じ error で、machine_orders に行が残らない。
10. 画面用の応答に `machine_order` が出る / 人の注文では null。
11. 既存の test が全部通る。typecheck 0。

## 範囲の外

差し戻しの入口（B 案）、Claude 以外の呼び出し元、画面からの上限の変更、Access 側の設定（ふじさんが行う）。
