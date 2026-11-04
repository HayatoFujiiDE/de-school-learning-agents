# 計画 v3: 職人が画像を生成できるようにする（v2 の Astra high REVISE を反映。v2 の本文を下に残し、v3 の変更がそれに優先する）

## v3 の変更（v2 レビューの指摘 → 対応）
- **保証の範囲を有界に言い直す（B1）**: 「月 $30 を絶対に超えない」は課金の元になるトークン数が公式に見積もりなので設計だけでは証明できない。v3 の保証は次の 2 つ: (G1) Worker の**記帳**は月 3000¢ を超えない（予約は記帳の上で厳密）。(G2) **実課金が記帳を超えるのは、ある試行の実額が予約額 U を超えた時だけ**で、それは毎回 usage で検出し、超えた時と usage が返らなかった時の両方で `image_gen_halted` を CAS で書いて以後の予約と dispatch を止める（人が解除）。よって超過は「halted を書く前に dispatch 済みの試行」= 最大 max_concurrency（2）件の (実額 − U) に限られる。OpenAI ダッシュボードの上限を外側の補助に置く。U の決め方は v2 §3 のまま（許可する組み合わせの表だけ。表に無い組み合わせは拒否）。この保証の言い直しはオーナーへ報告する
- **精算は試行ごとに 1 回（B2）**: image_attempts に `settled_at`。精算は 1 batch で `UPDATE image_attempts SET settled_at=?, settled_cents=? WHERE id=? AND settled_at IS NULL` と `INSERT INTO cost_ledger(kind='image', cents=負, day=予約の day, ref=attempt id) SELECT … WHERE changes の前提を EXISTS(… settled_at = 今回の値 AND 今回の token)`（recordCost と同じ共通述語の形）。cost_ledger に `UNIQUE(kind, ref_id, sign)` 相当の一意制約（予約行と精算行それぞれ attempt ごと 1 行）。返金の day は**予約の day**（月の境界をまたいでも元の月に帰属）。丸めは予約が切り上げ、返金が切り捨て
- **8 枚の単位（B3）**: ふじさん確認済み（2026-11-04）: 「注文 1 回（job）ごとに 8 枚」。試行（描き直し含む）を 1 枚と数える
- **拒否の通知は phase を問わない（B4）**: 生成の許可条件 = `job.status IN ('running','budget_reached') AND phase='making'`。通知の許可条件 = `job.status IN ('running','budget_reached','needs_answer')`（phase を問わない。session が terminated なら送らない）。questions 段階の generate_image は refused → 通知が届く
- **sending の取り残し（B5）**: notify='sending' で `notify_started_at` が 3 分を過ぎたら cron が unknown にする（CAS）。unknown の照合は events.list を最後まで読み切った時だけ「無い」と判断する（途中失敗は判断しない・次回へ）。rollback の完了条件に「notify が sending / unknown の行 0」を入れる
- **段階 1 に拒否互換を入れる（B6）**: 段階 1（読み取り対応）でも reconcile は `agent.custom_tool_use` を見分け、generate_image には `user.custom_tool_result {is_error: true, text: '画像生成は使えません。SVG で描いてください'}` を返す（deny を送らない）。段階 2 → 1 へ戻した後に職人が出した新しい呼び出しも段階 1 が正しく拒否する。旧版（段階 1 以前）へ戻すのは、職人定義から tool を消した後に作られた session しか無い時だけ（README に手順）
- **掃除が再取り込みを壊さない（B7）**: 画像の掃除の条件 = job が `done`（版ができた）で、その版にも同じ素材の他の版にも参照されない、または job が `cancelled` / `failed` で `error <> 'invalid_outputs'`（再取り込みできない）、かつ 30 日超。`failed/invalid_outputs` の job の画像は消さない
- **cron の予算（N）**: 画像の回収・照合・掃除は cron の中で 1 回あたり最大 60 秒・各 20 件。既存の reconcile / 検証の締め切りより後ろに置く
- **SDK の暗黙 retry（N）**: consumer からの Anthropic 呼び出し（upload・events.list・custom_tool_result）と OpenAI 呼び出しはすべて maxRetries 0 と明示の deadline
- **probe の費用（N）**: probe は Worker の管理画面の操作「画像の試し生成」（固定の組み合わせ表を 1 回ずつ）として実装し、**同じ予約の経路を通す**（月 $30 に数える。別枠を作らない）。probe 専用の job は作らず `request.kind='probe'`。そのため probe は段階 2 の一部になり、U の表は最初は保守的な値で始めて probe の後に下げる（上げない）
- **正本の一本化（N）**: 契約 v3.6 では、v1・v2・v3 の差分ではなく最終の状態表（gen × notify の組み合わせごとの許可される操作・回収の主体・期限）を 1 枚で書く

---

# 計画 v2: 職人が画像を生成できるようにする（v1 の REVISE 2 本を反映）

前提: img-context.md / system map: img-map.md / v1: img-plan-v1.md / v1 へのレビュー: Astra high（review-img-plan-out.log）と状態機械レビュー（下の「v1 からの変更」に要約）

## v1 からの変更（指摘 → 対応）
- 費用の上限が推測の R に依存（Astra B1） → §3。許可入力の全体（prompt 上限・編集元画像・size・quality・n=1）の**課金上界 U** を予約し、usage が無い・分からない時は U のまま確定（返さない）。U は公式の料金式と probe の実測の大きい方。実額 > U を 1 回でも観測したら D1 settings に `image_gen_halted` を CAS で書き、以後の予約と dispatch を止める（人が解除）。quota 不足（insufficient_quota）も同じく停止。rate limit の 429 だけが新しい予約での再試行の対象
- 結果の二重送信（Astra B2 / 状態機械 B2） → §4。生成の状態と通知の状態を分け、通知は token 付き CAS で所有権を取ってから送る。応答不明は `notify=unknown` にして、次の担当は**送らずに** events.list で照合する。照合で見つからなくても再送は、probe p4 で「二重送信が API に拒否される（無害）」と確かめた場合だけ 1 回
- 古い試行が R2 を上書き（Astra B3） → 保存キーを attempt ごと（`img/{job}/{request}/{attempt}-{token}.{ext}`）にし、D1 の CAS で勝者の key と sha を確定。負けた試行の物体は掃除で消す
- 拒否・失敗の通知が消える（Astra B4） → 成功・拒否・失敗のすべてを同じ通知の手順に通す。DLQ には consumer を置き、request を failed + 通知待ちにするだけ（job は触らない）
- 終了後の取り込みと掃除の衝突（Astra B5） → 掃除は「どの版からも参照されない」かつ「job が終端」かつ「7 日超」の物体だけ。session terminated でも request の状態は変えない。取り込みは通知の状態に依らず `gen=stored` と sha 一致で採る
- cancel 後も生成が走る（状態機械 B1） → 予約・dispatch・通知の述語に `job.status IN ('running','budget_reached') AND job.phase='making'` を入れる。consumer は job を終端にしない（reconcile の fail() だけが終端にする）
- 再投入が無限・取り残し（状態機械 B3） → 投入は「INSERT で行ができた時」と「cron が queued の 2 分超を `enqueue_count < 5` の CAS で拾った時」だけ。超えたら failed + 通知待ち。DLQ consumer を wrangler に定義。max_retries は 2 に統一
- rollback で session が止まる・画像版が 404（Astra B6 / 状態機械 B4） → §7。出荷を 2 段に分け、段階 1 = 画像の**読み取り**対応（拡張子・配信・確認画面・取り込みの image 参照）、段階 2 = 生成。段階 2 の戻し先は段階 1（画像版は読める）。戻す前に flag を切って新規の予約と dispatch を止め、未通知の request に is_error を送り切り、DLQ と queue が空になるのを確かめる
- onIdle の走査が custom_tool_use の本体を読めない（状態機械 N1） → requires_action の時だけ、stop_reason.event_ids の各 id を新しい走査 `'pending_tools'` で探す（MAX_PAGES と 25 秒の締め切りは既存の scan の規則）
- 拒否の繰り返し（N2） → generate_image への is_error（上限・拒否・失敗・その他の custom tool）も deny_count に数え、既存の too_many_denies（> 8）に合流
- 8 枚の単位（N3） → **job ごと**（注文 1 回ごと。作り直しでも描き直せる）。全体は月 $30 で守る。ふじさんに確認中
- questions 段階での生成（N5） → is_error「制作の指示が来てから使ってください」
- 採点係が画像を見られない（N6） → rubric は画像の中身を採点しない（参照の形式だけ）
- app.html の中の画像（Astra N） → 画像は別ファイルとしてだけ使う。app.html からの参照は禁止のまま（CSP `img-src data:` は維持）。職人の定義と rubric に書く
- 検証係の入力（Astra N） → verify.ts の入力に、版に入った画像ごとの `{path, model, prompt, alt}` を足す（画像そのものは渡さない）。入力上限は既存の 400,000 文字に含める
- OpenAI のエラーが鍵を漏らす経路（Astra N） → openai.ts は既存の PortError と同じく、固定の列挙型コード（`timeout` / `rate_limited` / `quota` / `moderation` / `bad_request` / `server` / `bad_response`）と HTTP status だけを外へ出す。本文・headers・cause を出さない

## 1. Goal / 2. Scope（v1 と同じ）
Goal: 職人が custom tool `generate_image` で絵を作り、見て描き直せる。費用は「1 job 8 試行・月 $30」を超えない（台帳の記帳額 ≥ 実際の課金額）。鍵は Worker secret だけ。画像は人の確認を経てだけ子どもへ出る。
Non-scope: バディ側の生成、動画、画像の機械的な事実検証、Batch API

## 3. 費用（共有チョークポイント）
- 唯一の呼び出し口: `src/openai.ts` の `generate(res: Reservation, …)`。Reservation は `images.ts` の `reserveAttempt()` しか作れない（module-private symbol）。lint（grep）: `api.openai.com` と `OPENAI_API_KEY` は openai.ts と env.ts にだけ出る
- 上界 U(size, quality, has_edit) = text_in_max × $5/1M + image_in_max(has_edit) × $8/1M + image_out(size, quality) × $30/1M。text_in_max は prompt 上限 4,000 字から（1 字 ≤ 1 token の保守見積もり）、image_in_max は編集元 1 枚の上限サイズから、image_out は probe p1 の実測の最大 × 1.5 と公式の表（あれば）の大きい方。U は vars の表として持ち、コードは表に無い組み合わせを拒否する
- 予約（D1 batch 1 回・SQL は契約に全文で書く）: image_attempts INSERT … SELECT … WHERE (同じ job の attempts) < 8 AND (月の image 記帳合計) + U ≤ 3000 AND (日次合計) + U ≤ DAILY_CAP AND settings.image_gen_halted IS NULL AND job.status IN ('running','budget_reached') AND job.phase='making' AND request.gen='queued'|'retry'。同じ batch で cost_ledger に U を記帳（day = 予約日の Asia/Tokyo。月の境界は予約日で決める）、request.gen='reserved' + dispatch_token
- 精算: usage があり実額 ≤ U の時だけ、差額をマイナスで記帳（cost_ledger に `kind='image', cents<0` を許す。CHECK を変える）。usage が無い・失敗・応答不明は U のまま。実額 > U なら halted
- 最悪の月額: 記帳 ≤ 3000 で、各試行の実額 ≤ U（U の定義）なので、実際の課金 ≤ 3000。U の定義が破れた時（実額 > U）は 1 回で halted になり、超過は「halted を書く前に dispatch 済みの試行（max_concurrency 2）」× (実額 − U) に限られる。OpenAI ダッシュボードの上限は補助（遅延があるので証明には使わない）

## 4. 状態（request ごと）
- gen: queued → reserved → generating → stored | failed | refused（retry は reserved の前に戻る。attempt は 1 依頼 2 回まで、job で 8 回まで）
- notify: none → sending → sent | unknown。成功（stored）・拒否（refused）・失敗（failed）のどれでも notify の手順を通る
- 通知の手順: `UPDATE … SET notify='sending', notify_token=? WHERE id=? AND notify IN ('none') AND gen IN ('stored','refused','failed') AND job の述語` が 1 行の時だけ送る。送信成功 → sent。応答不明・例外 → unknown。unknown は cron が events.list で `user.custom_tool_result` の同じ custom_tool_use_id を探し、あれば sent。無ければ probe p4 の結果に従う（二重送信が拒否されるなら 1 回だけ再送、そうでなければ job を failed `image_result_unknown` + interrupt/archive を reconcile に依頼）
- 取り込み: material.json の files[] で image_id を持つものは、`gen='stored'`・同じ job・sha 一致・拡張子と先頭バイトの一致で採る（notify の状態は見ない）。違えば invalid_outputs

## 5. 流れ（v1 §6 から変更点だけ）
1. reconcile の requires_action: 走査 'pending_tools' で event 本体を読む。generate_image → INSERT OR IGNORE（行ができたら enqueue）。phase='questions' なら即 refused（通知の手順へ）。tool_confirmation は deny。他の custom tool は refused
2. consumer（max_batch_size 1、max_concurrency 2、max_retries 2、retry_delay 30、DLQ あり）: D1 の状態で冪等に判定 → 予約 → dispatch CAS → 生成（150 秒・SDK 再試行 0）→ attempt キーへ put → 勝者 CAS（stored, key, sha）→ 精算 → Files upload（file_id を CAS で保存。upload は request ごと 2 回まで）→ 通知の手順
3. DLQ consumer: gen を failed、notify は手順へ（job は触らない）
4. cron: queued 2 分超（enqueue_count < 5）を再投入 / generating 5 分超を回収（attempt を消費して retry か failed）/ notify unknown を照合 / 掃除（参照なし・job 終端・7 日超）/ 状態ごとの件数・最古時刻・未精算額・halted をログ（ID・数値・固定コードのみ）

## 6. 検証（v1 §9 に追加）
fake OpenAI は課金額の合計を持ち、smoke で「台帳の記帳 ≥ fake の課金」を比べる。追加の smoke: enqueue 後に cancel → OpenAI 0 回 / DLQ 後の reconcile 5 回で再投入しない / queue 送信失敗後に queued が回収される / tool_confirmation と custom_tool_use の混在 / 同じ turn で generate_image を 3 つ並列 / 古い attempt の遅れた put が勝者の物体を変えない / refused の通知前に停止 → 再起動後に通知される / 返答済み → session 終了 → 取り込みで画像が版に入る / usage 全欠落で記帳 = U / 月の境界 / insufficient_quota で halted になり自動再開しない / 例外 message・cause に検査用の印を入れても、ログ・D1・R2・custom_tool_result・Files upload に出ない / 段階 2 → 段階 1 へ戻した後も画像版が読める
本番 probe（鍵の投入後・実装前）: p1 size × quality × model ごとの usage・時間（U の表を作る。probe の費用枠 $3） / p2 custom tool を frontmatter に書いて `ant apply --dry-run` / p3 custom_tool_use → 数分後の result が受け付けられるか / p4 同じ custom_tool_use_id への 2 回目の result、archive 後の result の応答

## 7. Rollback
段階 2（生成）→ 段階 1（読み取り）へ: (1) settings `image_gen_halted` を書く（新規予約・dispatch 停止） (2) consumer が空になるまで待つ（queue と DLQ の件数 0、gen が reserved/generating の行 0） (3) notify が none/unknown の行に通知の手順を済ませる（is_error「画像生成を止めました」） (4) 職人定義から tool を消して ant apply (5) Worker を段階 1 の版へ wrangler rollback。段階 1 は画像版を読めるので配信は 404 にならない
段階 1 → 旧版へ: 画像を含む版（png / webp どちらも）を全部「配信を止める」→ 旧版へ。旧版で停止済み画像版を再公開しない運用を README に書く

## 8. Open questions
p1〜p4 の結果。D1 batch の述語の正しさ（smoke で並列 20 件）。8 枚の単位（job ごとで進める。ふじさんに確認中）

## 9. Human approval
OPENAI_API_KEY の投入（ふじさん、通常ターミナル）。OpenAI 組織の本人確認（必要なら）。OpenAI ダッシュボードの上限（補助）

## 10. Task breakdown
| # | Task | Depends on | Parallel? | Verification |
|---|---|---|---|---|
| 1 | 契約 v3.6 を凍結（§3 の SQL 全文・状態表・通知の手順・2 段出荷） | 本計画 GO | — | Astra |
| 2 | 本番 probe p1〜p4 | 鍵 | 1 と並行 | 実出力 |
| 3 | 段階 1: 画像の読み取り対応（拡張子・先頭バイト・配信・確認画面・取り込みの image_id・検証係の入力・fixture バイナリ） | 1 | — | vitest + smoke + 実ブラウザで確認画面 |
| 4 | 段階 1 を deploy | 3 | — | 既存 smoke と実 URL |
| 5 | 段階 2: migration 0003・予約・openai port・fake・consumer・DLQ・通知・cron | 1・2・4 | — | vitest + smoke（§6） |
| 6 | 職人定義（tool・accuracy・使い方の規則）と rubric | 2(p2) | 5 と並行 | dry-run |
| 7 | Astra high → 段階 2 deploy → 実 session で 1 枚 | 5・6 | — | 費用・時間・画像の実出力 |
