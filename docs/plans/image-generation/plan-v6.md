# 計画 v6: 画像生成（v5 への Astra REVISE を反映。v6 が v5 以下の本文に優先する。状態表は v5 §5-2 に本書 §3 の追記を足したものが正本）

状態（2026-11-04 夜）: v6 は未レビュー。migration は **0004**（0003 は契約 §L）。

## 1. B1 枠は「最初の有償の試行」と同時にしか取れない

v5 は枠を 1 文目で取り、試行を 2 文目で入れていた。2 文目が 0 行（日次上限など）でも枠だけ残る。D1 の batch は、後の文が 0 行でも前の文を取り消さない。そこで **試行の INSERT を 1 文目にし、枠の条件もその WHERE に入れる**。枠の INSERT は「その試行の行がある」ことを条件にする。

予約の batch（1 回。`?att` = 新しい attempt id、`?job`、`?req`、`?U` = この組み合わせの上界、`?Umax` = 表の最大値、`?now`、`?day`、`?month`）:

```sql
-- 1. 試行（全条件をここに集める）
INSERT INTO image_attempts (id, job_id, request_id, kind, state, reserve_cents, dispatch_token, reserved_at)
SELECT ?att, ?job, ?req, 'job', 'reserved', ?U, ?token, ?now
WHERE (SELECT value FROM settings WHERE key = 'image_gen_halted') IS NULL
  AND EXISTS (SELECT 1 FROM factory_jobs j WHERE j.id = ?job AND j.status IN ('running','budget_reached') AND j.phase = 'making')
  AND EXISTS (SELECT 1 FROM image_requests r WHERE r.id = ?req AND r.job_id = ?job AND r.gen = 'queued')
  AND (SELECT COUNT(*) FROM image_attempts a WHERE a.job_id = ?job) < 8
  AND (SELECT COALESCE(SUM(cents), 0) FROM cost_ledger WHERE day = ?day) + ?U <= ?daily_cap
  AND (
        -- 枠を持っている
        EXISTS (SELECT 1 FROM image_job_slots s WHERE s.job_id = ?job AND s.released_at IS NULL)
        OR (
        -- 枠をまだ持ったことがなく、空きがあり、月の上限に収まる
              NOT EXISTS (SELECT 1 FROM image_job_slots s WHERE s.job_id = ?job)
          AND (SELECT COUNT(*) FROM image_job_slots s WHERE s.released_at IS NULL) < 2
          AND (SELECT COALESCE(SUM(cents), 0) FROM cost_ledger WHERE kind = 'image' AND substr(day, 1, 7) = ?month) + ?Umax <= 3000
        )
      );
-- 2. 枠（1 の行ができた時だけ・初回だけ）
INSERT INTO image_job_slots (job_id, acquired_at)
SELECT ?job, ?now
WHERE EXISTS (SELECT 1 FROM image_attempts WHERE id = ?att)
  AND NOT EXISTS (SELECT 1 FROM image_job_slots WHERE job_id = ?job);
-- 3. 記帳（1 の行ができた時だけ）
INSERT INTO cost_ledger (id, day, kind, ref_id, cents, created_at)
SELECT ?ledger_id, ?day, 'image', 'ia:' || ?att, ?U, ?now
WHERE EXISTS (SELECT 1 FROM image_attempts WHERE id = ?att);
-- 4. request
UPDATE image_requests SET gen = 'reserved', attempt_id = ?att
WHERE id = ?req AND gen = 'queued' AND EXISTS (SELECT 1 FROM image_attempts WHERE id = ?att);
```

- 1 が 0 行なら 2〜4 も 0 行。枠だけ・記帳だけが残ることはない。batch は 1 トランザクションで直列なので、1 の COUNT と 2 の INSERT の間に他の job は入らない
- 枠を取った時点で、その job の最初の試行が記帳済み（月の記帳 + U_max ≤ 3000 の判定込み）。残りは最大 7 試行
- **月の上界**: 枠を取れるのは記帳 + U_max ≤ 3000 の時だけで、枠は同時に 2 つまで。上限に届いた後に記帳が増えるのは、枠を持つ 2 job の残り 7 試行だけ → 記帳 ≤ 3000 + 2 × 7 × U_max（U_max = 25¢ なら 3350¢）。これは**記帳の上界**であって請求の上界ではない（実額が U を超えた分は §4）
- v5 の反例（日次上限で試行 0 行・枠 2 つ）は、この SQL では枠 0 になる。固定テストにする（§5 の t1）

## 2. B2 dispatch の CAS に job と request の有効性を入れる

```sql
UPDATE image_attempts SET state = 'dispatched', dispatched_at = ?now
WHERE id = ?att AND state = 'reserved' AND dispatch_token = ?token
  AND (SELECT value FROM settings WHERE key = 'image_gen_halted') IS NULL
  AND (SELECT COUNT(*) FROM image_attempts WHERE state IN ('dispatched','unknown')) < 2
  AND (
        ( kind = 'job'
          AND EXISTS (SELECT 1 FROM factory_jobs j WHERE j.id = image_attempts.job_id AND j.status IN ('running','budget_reached') AND j.phase = 'making')
          AND EXISTS (SELECT 1 FROM image_requests r WHERE r.id = image_attempts.request_id AND r.gen = 'reserved' AND r.attempt_id = image_attempts.id) )
     OR ( kind = 'probe'
          AND EXISTS (SELECT 1 FROM settings WHERE key = 'image_probe_allowed' AND value = image_attempts.id) )
      );
```

- 0 行なら OpenAI を呼ばない。cancel・job の終端・phase の変化・request の取り消しがコミット済みなら必ず 0 行
- probe は管理画面の操作で `settings.image_probe_allowed = <attempt id>` を書いた 1 件だけ（使ったら cron が消す）。job の条件とは別の明示の許可
- 通常の重複 dispatch は従来どおり state と token の述語で 0 行

## 3. B3 `stored` と `uploaded/notify=none` を cron が必ず引き取る

v5 では upload と通知の主体が consumer だけで、Queue の再試行を使い切ると誰も進めない。**Queue は「早く進めるための通知」で、進める責任は D1 の状態と cron が持つ**、に改める。

列を足す（0004）: `image_requests.stored_at`, `upload_tries INTEGER NOT NULL DEFAULT 0`, `upload_token`, `upload_started_at`, `uploaded_at`。

- **upload の処理権**（consumer も cron も同じ手順）: `UPDATE image_requests SET upload_token = ?t, upload_started_at = ?now, upload_tries = upload_tries + 1 WHERE id = ? AND gen = 'stored' AND upload_tries < 2 AND (upload_token IS NULL OR upload_started_at < ?now_minus_5min)` が 1 行の時だけ upload する。成功 → `gen = 'uploaded', file_id = ?, uploaded_at = ? WHERE id = ? AND gen = 'stored' AND upload_token = ?t`
- `upload_tries >= 2` で `gen='stored'` かつ `upload_started_at` が 5 分より前 → cron が `gen = 'failed', error = 'upload_failed'`（精算は済んでいる。画像は R2 に残り、版には入らない）
- upload 成功・file_id の保存が応答不明: 次の処理権で upload をやり直す（最大 2 回）。保存されなかった file は Files API に残る（孤立 file。参照されないだけで害はない）。件数を `files_orphan_suspected` としてログに出す
- **cron の引き取り**（毎回・`image_gen_halted` 中も行う。支払い済みの画像を渡し切るため）:
  - `gen='stored'` で `stored_at` が 3 分より前 → 上の upload の手順
  - `gen IN ('uploaded','refused','failed') AND notify='none'` で 2 分より前 → 通知の手順（v4 §4。job が終端なら `abandoned`）
  - `notify='sending'` で 5 分より前 → `unknown`（events.list を全ページ照合。v4 §4）
- halt 中の扱い: `queued` / `reserved` は cron が `refused`（`error='halted'`）にして attempt を `void`（全額返金）→ 通知。`dispatched` は 5 分で `unknown` + request `failed`（`result_unknown`）→ 通知。`stored` は upload を続けて `uploaded` → 成功の通知
- DLQ: `gen IN ('queued','reserved')` だけ failed（v5 のまま）。`stored` 以降は触らない — cron が引き取るので取り残されない

**rollback の完了条件（v4 §7 の (2)(3) を置き換え）**: 次の SQL がすべて 0 を返すまで段階 1 へ戻さない。

```sql
SELECT COUNT(*) FROM image_requests WHERE gen IN ('queued','reserved','dispatched','stored');
SELECT COUNT(*) FROM image_requests WHERE gen IN ('uploaded','refused','failed') AND notify IN ('none','sending','unknown');
SELECT COUNT(*) FROM image_attempts WHERE state IN ('reserved','dispatched');
```
`unknown`（課金不明）の attempt は halted のまま残してよい（人が OpenAI の使用量と照合して精算する）。上の 3 つが 0 なら、生きた session に未回答の generate_image は無い（通知は `sent` か `abandoned`）。

## 4. 非 BLOCKING の反映

- **画像の人手確認を §L に接続**: 契約 §L-6 の「説明と表現」は図・画像をすべて見る項目とした（v3.6.1 で反映済み。サムネイルと枚数を出す）。検証係は画像を見ないので、画像の正しさの自動 OK は無い
- **添付と variants の拡張子を分ける**: `schema.ts` の `isPartPath` を 2 つに分ける — variants（本文）は `.md` だけ、files（添付）は `.md` `.svg` `.png` `.webp`（`.html` は §F の既存規則）。確認画面は variants をテキストとして、files の画像を `<img>` で描く
- **U を請求上限と書かない**: 管理画面・README の「月 $30」は「画像の記帳の目安（上限の判定に使う）」と書く。実額が U を超えた分の上界は主張しない（毎回の usage で検出して halted、未確定は同時 2 件まで）。prompt は**文字数でなく UTF-8 バイト数**で上限（4,000 バイト）を切り、`text_in_max` = 4,000 token とする（1 token ≥ 1 バイト）。OpenAI の出力費用は公式でも見積りなので、U の表は probe p1 の実測の最大 × 1.5 と公式の表の大きい方

## 5. 検証の追加（v5 の「coverage 表の 8 行」は本節の t1〜t8 を指す）

| # | 状態 × 失敗点 | 確かめること |
|---|---|---|
| t1 | 月の記帳 2975¢・日次上限到達で 2 job が予約 | 試行 0・枠 0・記帳 0。翌日以降も記帳 ≤ 3000 + 2×7×U_max（固定テスト） |
| t2 | reserved の後に cancel がコミット・DLQ で failed 確定 | 後から来た consumer の dispatch CAS が 0 行、fake OpenAI の呼び出し 0 回 |
| t3 | dispatch CAS の後、HTTP 開始前に停止 | 再生成しない。5 分で unknown + halted + request failed → 通知 |
| t4 | stored × 精算前 / 精算後に停止 | 精算は 1 回（state の述語）。upload は cron が引き取り uploaded |
| t5 | upload 成功 × file_id の保存が応答不明 | upload は最大 2 回。勝者は 1 つ。孤立 file の件数がログに出る |
| t6 | uploaded × 通知前に停止し Queue が空 | cron が通知して sent |
| t7 | sending × 送信成功後・CAS 前に停止 | events.list を全ページ照合して sent。二重に送らない |
| t8 | 各状態 × halted / 段階 1 への降格の手順 | §3 の完了条件 SQL がすべて 0 になり、待ち続けない |

追加の合格条件:
- 配信・取り込み: 承認前・停止済み・旧版・別 job・sha 不一致・manifest 外の画像を拒否。対照として承認済みの正常画像が配信され、配信バイトの sha が版の digest と一致
- 回帰: 段階 1 を migration 0004 の前後で通す（既存のテキスト素材と画像素材の両方）。§L の triage と画像付きの版を合わせたケース（「説明と表現」に図の枚数が出る）
- 鍵: 印のテストを openai port 単体だけでなく consumer・cron・fetch の catch の外側まで通す。`index.ts` の fetch catch は `e.name` をログへ出すので、port の境界で固定コードの `PortError` に変えてから外へ出す
- 観測: cron のログに `requests_stored`・`requests_uploaded_unnotified` の件数と最古時刻、`slots_held_without_attempts`（枠あり・試行 0。§1 の SQL なら常に 0 のはず＝検知用）

## 6. 作業順

v5 §6 のまま（#1 の契約 v3.7 に本書 §1〜§3 の SQL 全文と完了条件を入れる）。
