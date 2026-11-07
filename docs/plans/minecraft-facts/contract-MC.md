# §MC 版が決まっている題材（Minecraft）は Java 版の最新を基準にし、古い情報を根拠にしない（2026-11-07）

起点: ふじさん 2026-11-07。「レッドストーン回路の仕組み」の素材群が 7 年前の動画（2019-05 公開）を参照していて古い。Minecraft は Java 版と統合版（Bedrock）で仕様が違うので、版ごとに分けて集める。うちで使うのは Java 版なので Java 版のデータを基準に解説する。根本からやり直す。

観測（2026-11-07 の本番 D1）:
- mc-redstone の素材 3 件（レッドストーン回路の仕組み v3・ボタンとレバーの信号の長さ v3・同（動画つき）v7）がすべて review / attention。
- 「ボタンとレバーの信号の長さ」の 2 件が同じ動画 `jQFCgKLAhvw`（公開 2019-05-21）を使っている。「レッドストーン回路の仕組み」v3 の出典は minecraft.wiki の英語・日本語ページ（Tutorial:Instant repeaters・Redstone computers など）で、Java 版と統合版の記述が混ざるページを版の区別なく引いている。
- 注文票には「Minecraft（Java 版）」と書いてあったが、職人・検証係・仕分けのどこにも「版」「公開日」の決まりが無い。職人は YouTube のページを開けず（§Q-11）、`youtube_info` も公開日を返さないので、動画の古さを知る手段が無かった。

## MC-0 保証（有界）と範囲

- 版が決まっている題材（今は Minecraft）の素材は、`conditions.tools` に edition と版（`Minecraft Java 版 26.3` の形）を宣言し、仕分けがそれを機械で確かめる。宣言が無い・Java 版でない版は自動の差し戻し（fix）。
- 動画は YouTube の公開日（`published`）を Worker が取り、版が決まっている題材では **公開日から 3 年（1095 日）より前の動画は fix・公開日が取れない動画は ask**。職人の道具 `youtube_info` も公開日を返し、職人は 3 年以内の動画だけ使う。
- 職人・検証係は edition を分けて扱う（Java 版の記述だけを根拠にし、統合版の仕様を Java 版の事実として書かない）。検証係は版の食い違いを hypothesis（reason の先頭「版:」）にする。
- 運用の依頼箱に `material_redo`（版を却下して、新しい注文票で draft を 1 件作る）を足し、mc-redstone の 3 素材を新しい前提で作り直す。
- 範囲外: Minecraft の事実の置き場（README の段階 A の R2・cron 接続）。お題（topics）の生成。統合版の素材を作ること。公開日の無い動画を人が許す経路（attention で人が見る）。

## MC-1 判定と宣言（新規 `src/checks/edition.ts`）

1. `isVersionBoundMaterial(material)`: `catalog_item_id` が `mc-` で始まる、または title・slug・`conditions.tools[]` のどれかが `/minecraft|マイクラ|マインクラフト/i` に合う → true。material が読めない時は false。
2. `declaredEdition(material)`: `conditions.tools[]` の文字列のうち、`/minecraft|マイクラ|マインクラフト/i` に合い、かつ `/\b(\d{1,2}\.\d{1,2}(?:\.\d{1,2})?)\b/` の版番号を含むものを探す。
   - その文字列が `/java(?!script)/i` に合う → `{ edition: 'java', version }`。
   - `/bedrock|統合版|\bbe\b/i` に合う → `{ edition: 'bedrock', version }`。
   - どちらでもない・版番号が無い・tools が無い → `null`。
3. **本文の版の 1 文（オーナー指示 2026-11-07「マイクラのコンテンツを作るときは必ずバージョンを記載」）**: 版が決まっている題材で `declaredEdition` が java の時、parts/ 配下の子ども向け本文（.md。短い・詳しい・小学生・中学生・game のすべて）の各ファイルに「Java 版」と宣言した版番号（例 `26.3`）の両方が書かれていること。取り込みの機械検査 `src/checks/childtext.ts` に kind `edition_text`（`{ path, kind: 'edition_text', sample: '' }`。無い本文ごとに 1 件。20 件の上限は既存のまま）を足し、`checks_json.child_text` に入れる。`declaredEdition` が null の版は本文を見ない（宣言の無さは MC-2 の `edition_missing` が拾う）。
4. 定数: `VERSION_BOUND_VIDEO_MAX_AGE_DAYS = 1095`。`isVideoTooOld(published, now)`: `published` が `YYYY-MM-DD` で、now − published > 1095 日 → true。形が違えば false（「不明」は別に扱う）。

## MC-2 仕分け（`src/checks/triage.ts`）

版が決まっている題材（MC-1 1）の版にだけ、次の項目を足す（report の有無に関係なく material から決まるもの、動画は videoMeta から）:

| id | key | severity | cause | 条件 |
|---|---|---|---|---|
| `edition:missing` | conditions_of_use | fix | `edition_missing` | `declaredEdition` が null |
| `edition:not_java` | conditions_of_use | fix | `edition_not_java` | edition が bedrock |
| `video:<id>:age` | terms_of_use | fix | `video_too_old` | meta.outcome が ok で `isVideoTooOld(meta.published)` |
| `video:<id>:age` | terms_of_use | ask | `video_date_unknown` | meta.outcome が ok で published が無い |
| `text:edition_text:<path>` | explanation_and_expression | fix | `edition_text_missing` | checks_json.child_text に kind `edition_text` がある（path ごとに 1 件。古い版で child_text が無ければ項目を作らない） |

- `CAUSE_TEXT`: `edition_missing` 「使う条件に Minecraft の版（Java 版 ○○）が書かれていない」/ `edition_not_java` 「Java 版でない版（統合版）を宣言している」/ `video_too_old` 「動画の公開日が 3 年より前（古い情報）」/ `video_date_unknown` 「動画の公開日が取れていない」/ `edition_text_missing` 「本文に版（Java 版 ○○）の 1 文が無い」。
- 差し戻し文（`buildReturnNote`）の該当行には、`edition_text_missing` は「<path> に『この説明は Java 版 <版> のものです。』の 1 文を入れる」、edition は「conditions.tools に『Minecraft Java 版 <版>』の形で書く（最新の正式版は version manifest の latest.release）」、動画は「公開日 <published> の動画。3 年以内の Java 版の動画に替えるか、動画なしにする」を detail に出す。
- 版が決まっていない題材には何も足さない（既存の版の仕分けは変わらない）。
- `TriageVideoMeta` に `published: string | null` を足す。review API の `video_meta[]` にも `published` を足す。

## MC-3 公開日（`src/youtube-oembed.ts`・`src/videos.ts`・`src/verify.ts`・`src/anthropic.ts`・`src/fake/`）

1. `OEmbedFields` に `published: string`（`YYYY-MM-DD`。分からなければ空）を足す。`sanitizeOEmbedFields` は `published` が `^\d{4}-\d{2}-\d{2}$` に合う文字列の時だけ残し、それ以外は空。
2. 本物の port の `lookup`: oEmbed が ok の時だけ、続けて `https://www.youtube.com/watch?v=<id>` を GET する（`redirect: 'manual'`、headers `accept: text/html`・`accept-language: ja,en;q=0.8`）。締め切りは fetch の直前に測った `min(WATCH_TIMEOUT_MS = 8_000, 試行の締め切りまでの残り)`。本文は `WATCH_BODY_MAX_BYTES = 2 MiB` まで読み、`itemprop="uploadDate" content="YYYY-MM-DD` か `"uploadDate":"YYYY-MM-DD` の最初の一致で読むのをやめる（手元の実測: 一致の位置は約 790 KB、ページ全体は約 1.4 MB）。status が 200 でない・時間切れ・上限超え・一致なし → `published` は空（oEmbed の結果は ok のまま。失敗で ok を崩さない）。GET は 1 回だけ（再試行なし）。
   - §Q-11 の「fetch を 1 回だけ」は「oEmbed の GET 1 回 + ok の時の watch ページの GET 1 回」に改める。回数の権利（版 × 動画で 5 回・job で 12 回）は lookup の数のまま。
3. 記録（R2 `video-meta/{video_id}.json`、`v: 1` のまま）: ok の時 `published` を足す（空なら key を書かない）。`parseVideoMetaRecord` は `published` が形に合う時だけ持つ。`VideoMetaState`・`VideoMetaView` に `published: string | null`。
   - 既存の記録（published 無し）は final のまま（呼び直さない）。版が決まっている題材では ask（`video_date_unknown`）になる。
4. 検証係の入力（`videosMetaBlocks`）: 各動画の block に `official_published: YYYY-MM-DD` の 1 行（無ければ `official_published: 不明`）。
5. 検証係の入力に `<edition>` の block（版が決まっている題材だけ）: 「この素材が宣言する版: Minecraft Java 版 26.3」か「宣言なし（使う条件に版が無い）」。system に 1 文足す（既存の文は変えない）: 「<edition> がある素材は、版（edition・バージョン）が決まっているソフトの題材です。claim は <edition> の版の事実として判定してください。出典の本文が統合版（Bedrock Edition）だけの仕様を述べている、または別の edition の記述しか無い claim は hypothesis にし、reason の先頭に「版:」と書きます。本文の『歴史』『History』の節で、宣言した版より前に変わった仕様を今の事実として書いている claim も同じです。」
6. 職人の道具 `youtube_info`（§Q-13 裁定 g）: ok の JSON に `"published":"YYYY-MM-DD"`（分からなければ `"published":""`）を足す。2 行目の注記はそのまま。
7. fake の port: fixture で `published` を返せるようにする（scenario に日付。無ければ空）。

## MC-4 運用の依頼箱 `material_redo`（§W-5。`src/ops.ts`・`migrations/0014_ops_material_redo.sql`・`scripts/ops-request.sh`）

1. payload: `{ "material_id": "<uuid>", "brief_md": "<文字列>" }`（key はこの 2 つだけ。uuid の形は §W-2 と同じ。brief_md は 1〜32768 文字）。違えば failed `bad_payload`。
2. 処理（1 tick に 1 件・60 分で expired は §W のまま）:
   1. material を読む。無ければ failed `not_found`。
   2. `work_status = 'review'` なら、その素材の status が `review` の版（最新 1 件）を `buildReject` で却下する（reviewer_email `system:ops-redo`、note 「オーナー指示: Java 版の最新を前提に作り直すため、この版を却下」、checklist_json `{}`、machine_gate は `computeTriage` の gate。review.ts の reject と同じ組）。却下の CAS が通らなければ failed `conflict`（次の依頼でやり直せる）。
   3. `work_status = 'idle'`（却下の後を含む）なら `queueJobForMaterial({ kind: 'draft', parent_version_id: null, brief_md })`。断られたら `{ refused: <code> }` で done（却下は済んでいるので、依頼を出し直せば queue だけが走る）。
   4. `queued` / `making` なら `{ refused: 'material_busy' }` で done（却下しない）。
   5. 結果: `{ material_id, job_id, rejected_version_id: <id|null> }`。ログ `{ at: 'material_redo', material_id, job_id, rejected_version_id }`（brief は出さない）。queued の job は次の tick の起動段が拾う（§W-2 と同じ）。
3. 失敗の表:
   | 状態 × 落ちる場所 | 次に起きること | 収束 |
   |---|---|---|
   | 却下の batch が通る前に落ちた | 処理中の例外なら依頼は failed（§W のまま。taken は失効しない）。出し直すと 2 からやり直す | 版は review のまま（二重却下なし） |
   | 却下が通り queue の前に落ちた | 素材は idle。出し直すと 3 だけ走る | 版の却下は 1 回 |
   | queue が通り結果の記録の前に落ちた | 依頼は failed か taken のまま。素材は queued（job が 1 つ） | 出し直すと `material_busy` で refused（二重 queue なし） |
   | 同じ素材に人が同時に差し戻した | 却下の CAS か queue の idle 条件で片方だけ通る | 1 job |
4. `scripts/ops-request.sh redo <material_id> <注文票.md>`: uuid の形を `is_uuid` で検査、ファイルを python で読んで JSON にし、SQL の `'` を `''` に倍にして INSERT。32768 文字を超えたら送らない。`--wait` は他の mode と同じ。
5. migration 0014: ops_requests の CHECK に `material_redo` を足す（0013 と同じ作り直し）。`test/d1-shim.ts` に足す。

## MC-5 職人・編集基準・採点表・取得先（司令塔が書く。`factory/claude/`）

- `editorial-standards.md`: 「版が決まっている題材（Minecraft など）」の節（Java 版の最新・版の宣言・edition を分ける・古い情報を根拠にしない）。
- `agents/material-maker.md`: 「# 版が決まっている題材（Minecraft など）」の節と、`youtube_info` の説明に `published` を足す。取得先に `minecraft.net`（公式の記事・パッチノート）と `piston-meta.mojang.com`（version manifest。`latest.release` を読む）。
- `rubrics/common.md`: 16（版の宣言と、子ども向け本文のすべてのファイルにある版の 1 文）・13 に公開日の条件。
- `allowlist.json`（domains・hosts）と `environments/cloud.yaml` を同じ commit で直す（`test/allowlist-env.test.ts`・`test/figure-claims-schema.test.ts`）。primary_hosts は変えない（minecraft.net は絵の主張の一次にしない）。
- 反映は Worker の deploy → `ant apply`（agent と environment）→ 確認用の session 1 本（[[feedback-smoke-session-after-ant-apply]]）→ `material_redo` の依頼。逆の順だと、新しい job が古い定義で走る。

## MC-6 確認画面（`public/admin/admin.js`）

- 動画の欄の「YouTube の公式情報」の行に「公開日: YYYY-MM-DD」（無ければ「公開日: 不明」）を足す（escape。印は仕分けの reasons に出るので別に作らない）。

## MC-7 作り直す素材（司令塔が注文票を書く。`docs/plans/minecraft-facts/briefs/`）

| 素材 | material_id | 却下する版 | 注文票 |
|---|---|---|---|
| レッドストーン回路の仕組み（mc-redstone-basics） | 56c7c85f-51b2-4d91-8797-07073060cae3 | v3 94631b96 | `briefs/mc-redstone-basics.md` |
| ボタンとレバーの信号の長さ（mc-redstone-buttons） | 5bec54d0-808e-43a8-8419-746dbeca3312 | v3 71896d0d | `briefs/mc-redstone-buttons.md` |
| ボタンとレバーの信号の長さ（動画つき）（mc-redstone-buttons-video） | 580e3109-ae87-4d09-9cb9-0c47a6df175c | v7 417aae98 | `briefs/mc-redstone-buttons-video.md` |

版は「Java 版の最新の正式版」（2026-11-07 時点で 26.3。職人が version manifest で確かめて書く）。うちで使う版が最新でない時はふじさんが注文票の版を直す。

## MC-8 受け入れ（vitest。新しいテストは直す前のコードで落ちる）

- `edition.ts`: mc- の catalog / 題名のマイクラ / tools の Minecraft で version-bound。`Minecraft Java 版 26.3`・`Minecraft Java Edition 1.21.4`・`Minecraft（Java 版）26.3` → java。`Minecraft 統合版 1.21` → bedrock。`Minecraft` だけ・版番号なし → null。`isVideoTooOld`: 1095 日ちょうどは false、1096 日は true、形が違えば false。
- childtext: java 宣言ありで、4 つの変奏のうち 1 つに「Java 版」か版番号が無い → その path の `edition_text` 1 件。全部にある → 0 件。宣言なし・version-bound でない → 0 件（本文を見ない）。triage: `child_text` の `edition_text` → fix `edition_text_missing`（path つき）・差し戻し文に path と 1 文。
- triage: version-bound で宣言なし → fix `edition_missing`・action auto_return・差し戻し文に『Minecraft Java 版』の文。bedrock → `edition_not_java`。宣言ありの動画で published が 4 年前 → fix `video_too_old`、published 無し → ask `video_date_unknown`、2 年前 → 項目なし。version-bound でない版では、同じ動画・同じ tools でも項目が出ない（反対側）。
- oEmbed port: ok + watch ページに `itemprop="uploadDate" content="2019-05-21T03:03:18-07:00"` → published `2019-05-21`。watch が 403 / 時間切れ / 2 MiB 超えで一致なし / 一致なし → ok のまま published 空。oEmbed が 404 なら watch を呼ばない（fetch の回数で確かめる）。
- 記録: published つきの ok の記録を書き、読み直すと published が残る。形の違う published は捨てる。古い記録（published 無し）は読めて published null。
- 検証係の入力: `<edition>` の block と `official_published` の行。version-bound でない版には `<edition>` が出ない。system の文が既存の文を変えずに入る。
- youtube_info: ok の JSON に published（空も含む）。既存の q13 のテストが green。
- review API: `video_meta[].published`。
- ops: payload の検査（key の過不足・uuid・長さ 0 / 32769）。review → 却下 + queue（review_decisions に system:ops-redo、版 rejected、job draft queued、parent null、brief が一致）。idle → queue だけ。making → refused material_busy で却下なし。却下の後 queue が断られた形で、依頼を出し直すと queue だけ走る。migration 0014 の CHECK に 4 kind + material_redo。
- 既存のテストが全部 green。typecheck 0。`check-no-fake` PASS。

## 未確認の点

- Cloudflare Workers から YouTube の watch ページが 200 で返るか（手元の curl では 200・約 1.4 MB・uploadDate あり）。断られる時は published が空のまま進み、版が決まっている題材の動画は ask（人が見る）になる。deploy 後に `version_reverify` か `material_redo` の実注文で確かめる。
- `piston-meta.mojang.com` と `minecraft.net` を職人の web_fetch が開けるか（手元の curl で manifest は 200）。開けない時は注文票に書いた版を使う。
