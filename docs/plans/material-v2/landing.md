# §AL 着地の runbook（契約 AL-8 の手順を実コマンドにしたもの。司令塔が実行し、実出力を引用して報告する）

前提: T1〜T5 が緑・Astra のコードレビュー GO・`git push origin HEAD:main` 済み（着地 SHA を `<SHA>`）。D1 は `factory`（wrangler.jsonc）。Worker は `factory/worker/`。

## 0. precheck（停止の前に行う。`paused=1` の後は回答の送信も 409 で止まる）
```
cd <worktree>/factory/worker
npx wrangler d1 execute factory --remote --json --command "SELECT status, phase, COUNT(*) AS n FROM factory_jobs WHERE (status IN ('queued','creating','running','needs_answer') AND phase='questions') OR status='queued' GROUP BY status, phase" 2>/dev/null | jq -c '.[0].results'
```
期待: `[]`（0 件）。0 でなければ: `needs_answer` は管理画面で回答して完走させる（schema 1 のまま取り込まれる）か、取り消す。`queued` は取り消す。

## 1. 停止
```
npx wrangler d1 execute factory --remote --command "INSERT INTO settings(key,value,updated_at) VALUES('paused','1',strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(key) DO UPDATE SET value='1', updated_at=excluded.updated_at" 2>/dev/null | tail -1
```
その後 0 の SQL をもう一度 → `[]` を確認（停止までの間に入った注文が無い）。0 でなければ取り消す（取消は停止中でも可）。

## 2. deploy（migration は無い。T1〜T5 を 1 回で）
```
cd <worktree>/factory/worker && zsh scripts/deploy-ref.sh <SHA> > /tmp/deploy-AL.log 2>&1; echo rc=$?; grep -E 'Current Version ID|Deployed|error' /tmp/deploy-AL.log | head -3
```

## 3. ant apply（職人定義・cloud.yaml）
```
cd <worktree>/factory && ant apply > /tmp/ant-apply.log 2>&1; echo rc=$?; tail -3 /tmp/ant-apply.log
git -C <worktree> diff --stat -- factory/claude-lock.json
```
→ `claude-lock.json` を commit（`claude-lock: material-maker（v16）を apply（§AL 素材の形 v2）`）して push。ログインが通らなければ **ふじさん TODO**（セッション外のターミナルで `ant auth login` → `ant apply`）。通るまで 4 に進まない。

## 4. 再開
```
npx wrangler d1 execute factory --remote --command "UPDATE settings SET value='0', updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE key='paused'" 2>/dev/null | tail -1
```

## 5. 実 session 1 本（既存の注文の入口 `scripts/order.sh`。題材は既存のもの 1 つ。費用は draft の既定 budget）
→ cron を待つ（10 分おき）。取り込み後に投影 SQL:
```
npx wrangler d1 execute factory --remote --json --command "SELECT v.id, json_extract(v.material_json,'$.schema_version') AS schema, v.reader_status, json_extract(v.reader_json,'$.v') AS reader_v, (json_extract(v.reader_json,'$.quality.first_action.verdict') IS NOT NULL) AS has_quality, json_array_length(json_extract(v.checks_json,'$.child_text')) AS child_text_n, json_extract(v.checks_json,'$.body_chars[0].chars') AS body_chars, (SELECT SUM(cents) FROM cost_ledger c WHERE c.kind='session' AND c.ref_id=v.job_id) AS session_cents FROM material_versions v ORDER BY v.created_at DESC LIMIT 3" 2>/dev/null | jq -c '.[0].results'
```
（列名 `job_id` / `created_at` は実装時に `material_versions` の実列で合わせる）
期待: schema=2・reader_status=done・reader_v=2・has_quality=1・child_text の fix 件数 0・body_chars が 300〜1000・session_cents が v1 の実測（600〜800）より低い。

## 6. 確認画面と配信
- `https://de-school-factory.h-fujii.workers.dev/admin/#/review/<version_id>`（Access）で 本文 1 枠・バディ用の枠（芯・問いの種・入口）・読み手係の quality 4 行が見える → 幅 1440 / 1024 / 390 で撮影 → 承認
- `curl -s https://de-school-factory.h-fujii.workers.dev/api/library/available | jq -c '.materials[] | select(.schema_version==2) | {slug, body_url: .parts[0].body_url, q: (.parts[0].questions_for_kids|length)}'`

## 7. 後始末
- `§AL 着地 <SHA>` を「3Dモデルなどの取り扱い」セッションへ送る（PR-AK2 が rebase する）
- worktree remove → branch 削除（`git merge-base --is-ancestor <SHA> origin/main` を確認してから）
- memory 更新・ふじさんへ報告（既存素材の作り直しの順番は依頼箱 material_redo でふじさんと）

## rollback（契約 AL-8）
0. `auto_publish=0`・`paused=1`（上の SQL の形）
0b. 配信中の schema 2 の版: `SELECT m.id, m.slug FROM materials m JOIN material_versions v ON v.id=m.current_version_id WHERE m.publish_status='available' AND json_extract(v.material_json,'$.schema_version')=2` → 素材ごとに 前の approved な schema 1 の版へ rollback decision、無ければ publishSwitch stop（管理画面）
1. 前の `claude-lock.json`（T0 の 1 つ前の commit）で `ant apply`（ログイン要。通らない間は `paused=1` のまま）
2. `zsh scripts/deploy-ref.sh <前の SHA>`
3. review 中の schema 2 の版は reject。roll-forward 後に `job_reingest`・`publishSwitch start`
