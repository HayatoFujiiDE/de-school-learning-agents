# §Q YouTube 動画を素材に組み合わせる（v3.11。2026-11-05 凍結。Astra high R2 GO）

起点: ふじさん 2026-11-05「youtube の該当動画とかも使用して良い（著作権には気をつけたい）。それらもうまく組み合わせるようにして」。範囲・見せ方・確かめ方は案 A で確定した。
- **範囲**: 権利者本人がアップした動画なら、個人のクリエイターでもよい。他人の映像を転載した動画は使わない。
- **見せ方**: youtube-nocookie で埋め込み、見る区間を指定する。
- **確かめ方**: 検証係が Gemini に区間を見せて主張と照らし、最後は人が確認画面で見る。

字幕の取り出しは使わない。YouTube 公式の captions.download は「動画の編集権限を持つ人」だけが使えるため（公式 docs）。

設計書の現行「動画は公式チャンネルの埋め込みのみ」（docs/content-factory-design.md §型5）は、本節の範囲に置き換える。

## Q-0 保証（有界）と範囲

保証は次の Q1〜Q4 だけ。
- **Q1**: 版に入る動画は、1 素材 3 本までとする。各動画は `youtube_id`（11 文字の [A-Za-z0-9_-]）・区間・見どころ・「本人のアップと言える理由」・出典 id を持ち、出典は sources.json の `https://www.youtube.com/watch?v={youtube_id}` の行と一致する。満たさなければ、取り込みで invalid_outputs にする（機械検査）。
- **Q2**: Gemini への呼び出しは、1 動画 1 試行につき最大 1 回とする。記帳は呼ぶ前に U_video（既定 10¢）で取り置く。動画の月の記帳は VIDEO_MONTHLY_CAP_CENTS（既定 1000¢）までとする。日次の上限（DAILY_CAP_CENTS）にも含める。上限に当たったら呼ばない。
- **Q3**: 検証が成功した版では、版の動画すべてに `videos[]` の判定が 1 件ずつある。Gemini の記録（video notes）が無い動画には、Worker が `not_seen` を付ける。
- **Q4**: 確認画面は、動画をすべて埋め込みで出し、区間・チャンネル・見どころ・理由・Gemini の記録・検証係の判定を並べる。人の確認（「説明と表現」）は置き換えない。

範囲外:
- 動画のダウンロード・再配布・字幕の取得。
- 学習者アプリでの表示（material.json に載せるところまで）。
- 埋め込みが許可されているかの機械判定（公式の判定手段は Data API の status.embeddable で、別の鍵が要る。今回は確認画面で人が再生できるかを見る）。
- YouTube の oEmbed（公式 docs を確認できていないので使わない）。

## Q-1 material.json（`src/checks/schema.ts`）

`parts[].videos[]` を足す。任意で、無ければ 0 本。

```
{ "id": "v1",                     // 素材全体で一意。/^v[0-9]{1,2}$/
  "youtube_id": "dQw4w9WgXcQ",    // /^[A-Za-z0-9_-]{11}$/
  "title": "…", "channel": "…",   // 各 1〜200 字
  "start_sec": 80, "end_sec": 185, // 整数。0 ≤ start < end、end − start ≤ 600
  "why": "…",                     // 見どころ。何を見るとどう分かるか。1〜300 字
  "rights_note": "…",             // 本人のアップと言える理由（公式チャンネル・本人の制作と分かる説明 等）。1〜300 字
  "source_id": "s9" }             // sources.json の id。その url は https://www.youtube.com/watch?v={youtube_id} と完全一致（クエリは v だけ）
```

- 検査の失敗コード（`invalid_outputs` の detail）: `bad_video:{part_id}:{index}:{理由}`。理由は `id` / `youtube_id` / `range` / `text` / `source` / `dup` / `too_many` のどれか。
- 素材全体で 4 本以上なら `too_many`。同じ id が 2 回、または同じ youtube_id と同じ区間が 2 回なら `dup`。
- sources.json の YouTube の行は、license に「YouTube 標準ライセンス（埋め込みで参照・複製しない）」などの文字列を要求する。空なら既存の検査どおり license_unknown の扱いになる。

## Q-2 職人（`factory/claude/agents/material-maker.md`・`allowlist.json`・rubric）

- allowlist の domains と hosts に `youtube.com` / `*.youtube.com`（hosts）を足す。youtu.be は足さない（url は watch の形だけ）。
- 職人の定義に「# 動画（YouTube）」の節を足す。入れる場所は「# 画像（generate_image）」の直後。司令塔が文を書く。
  - 中身: 使ってよいのは権利者本人がアップした動画だけ。チャンネル名・説明・概要欄で判断し、テレビ番組・映画・他人のゲーム実況の切り抜きや転載は使わない。
  - 見る区間は 10 分以内で、学びの入口になる場面を選ぶ。
  - web_fetch で watch ページを開き、題名とチャンネルを確かめる。
  - 区間の中身は動画の説明・章立て・本人の解説文から書く。見ていない内容を断定しない（中身の確認は検証係と人がする）。
  - 1 素材 3 本まで。動画が役に立たない題材では使わない。
- rubric `common.md` に 13 を足す: videos があれば、各動画に why と rights_note があり、出典の行と対応している（形式だけ）。

## Q-3 検証係（`src/verify.ts`、新規 `src/gemini.ts`）

1. **port**: `GeminiPort.watch({youtubeId, startSec, endSec, prompt}, {deadline}) → {text, usage?}`。実装は公式 docs の YouTube URL の例（Interactions エンドポイント `POST /v1beta/interactions`、ヘッダ `x-goog-api-key` と `Api-Revision`）に従う。clip は `processing: {type:'static', start_offset:'{n}s', end_offset:'{m}s'}` で渡す。
   - 公式 docs で「YouTube URL に clip が効く」ことは確かめられていない（例はアップロードしたファイル）。このため、§Q-6 の probe で確かめるまでは clip を付けた呼び出しを既定にする。clip が拒まれた時の扱いは、probe の結果で司令塔が決める。
   - 鍵は `GEMINI_API_KEY`（Worker secret）。モデルは `GEMINI_VIDEO_MODEL`（既定 `gemini-3.6-flash`。公式の models 一覧で Stable）。
   - 応答本文は 8,000 文字で切る。HTTP の失敗・timeout・形の違いは固定コードにする。
   - 鍵の値・応答本文はログに出さない。
2. **プロンプト**（Gemini へ。固定文 + 動画ごとの値）:
   - 指定区間で見える・聞こえることを、時刻つきの箇条書きで事実だけ書く（1,500 字以内）。
   - チャンネル・動画が権利者本人のものと判断できる手がかりと、転載らしい手がかりを書く。
   - 小中学生に不適切な表現（暴力・性的・差別・危険な行為のまね）の有無を書く。
3. **記録**: `{r2_prefix}video-notes.json`（§P の source-captures.json と同じ規則）。
   - 試行の入力を作る時に、無ければ作る。一度書いたら書き直さない。失敗した時は書かない。
   - 形は `{v:1, notes:[{video_id, youtube_id, start_sec, end_sec, model, text}], missing:[video_id…]}`。
   - 作る前に費用の取り置き（§Q-4）をする。取り置けなければ、その動画は missing にする。
   - 時間の予算は §P の取得記録と同じ考え方にする（送信の時間を残す）。
4. **入力**: `<source_captures>` の後に `<video_notes>`。動画ごとに header block と body block に分ける。body は §P の neutralize と同じ無害化をする。header は `## 動画 {id} https://www.youtube.com/watch?v={youtube_id} {start}〜{end} 秒（Gemini が区間を見て書いた記録。職人が書いたものではない）`。記録が無い動画は `（記録なし。判定に含めない）`。
5. **system に足す段落**（たとえの段落の後）:
   ```
   動画（YouTube）は <video_notes> の記録で確かめます。見るのは次の点です: 記録の内容が素材の本文・claims・見どころ（why）と合うか、権利者本人のアップと言えるか（rights_note と記録の手がかり）、小中学生に不適切な表現がないか。
   動画ごとに ok / problem / unclear のどれか 1 つを videos に書きます（記録なしの動画を除く）。動画を出典にした claim は、記録と照らして判定してかまいません。その場合 reason の先頭に「動画の記録で確認:」と書きます。
   ```
6. **schema**: `videos: [{id, verdict: ok|problem|unclear, reason}]` を required にする（strict）。
   - 検査は figures と同じ: 無ければ []、null・非配列は mismatch。集合は「記録がある動画」と完全一致させる。
   - 保存では、Worker が記録なしの動画を `not_seen` で足す。
   - Batch は plan.json に `videos: {shown, not_seen}` を足して回収時に読む。prompt は解析しない。

## Q-4 費用（`cost_ledger`、migration 無し）

- 取り置き: Gemini を呼ぶ直前に `kind='verify'`・`ref_id='vv:{version_id}:{video_id}:{attempt}'`・`cents=U_video` を 1 行入れる。条件は次の 2 つで、どちらかを超えるなら入れずに missing にする。
  - 月の `vv:%` の合計 + U_video ≤ VIDEO_MONTHLY_CAP_CENTS
  - 日次の合計 + U_video ≤ DAILY_CAP_CENTS
- 精算はしない（U_video は上界の見積り。usage の記録は表示用）。usage が返れば、notes に `usage` を数字だけ残す。
- env: `GEMINI_VIDEO_MODEL`、`VIDEO_U_CENTS`（10）、`VIDEO_MONTHLY_CAP_CENTS`（1000）。
- 鍵が無い（secret 未設定）時は呼ばない。その動画は missing にし、取り置きもしない。

## Q-5 確認画面（admin.js・index.ts の CSP）

- CSP の `frame-src` に `https://www.youtube-nocookie.com` を足す。他は変えない。
- 「説明と表現」の項目に「動画 N 本」と出し、各動画について次を並べる。
  - `<iframe src="https://www.youtube-nocookie.com/embed/{youtube_id}?start={s}&end={e}&rel=0" title="{title}" allow="encrypted-media; picture-in-picture; fullscreen" referrerpolicy="strict-origin-when-cross-origin" loading="lazy">`
  - 区間（分:秒）・チャンネル・見どころ・理由
  - `<details>` に Gemini の記録
  - 検証係の判定の pill（figures と同じ 4 種）
  - 値はすべてエスケープする。youtube_id は schema で形を検査済みでも、表示の前にもう一度正規表現で確かめる。
- 図の文言の行は「図・画像 N 枚・動画 M 本（…）」にする。
- review API: `version.material` の videos はそのまま返す。`verification.videos` を返す（古いものは null）。`video_notes` を返す（R2 の video-notes.json。無ければ null）。

## Q-6 probe（本番で 1 回だけ。鍵を入れた後）

- 管理者だけが使える一時 route `POST /api/probe/video`（Origin 検証）。入力は `{youtube_id, start_sec, end_sec}`。U_video の取り置きと月の上限を通してから 1 回だけ呼ぶ。
- 返すのは次の 5 つ: `{status, clip_accepted, usage_present, text_head(300 字), error_code}`。
- 確かめること:
  - (a) YouTube URL に clip が効くか
  - (b) usage の形
  - (c) 応答の形
  - (d) 概要欄だけでなく区間の中身を言えるか。区間の前後で内容が違う公開動画を使う。
- 結果は docs/plans/video/probe-results.md に司令塔が書く。route は結果を確かめた後の PR で消す。

## Q-7 受け入れ（vitest。fake の GeminiPort）

1. schema:
   - 正しい videos は通る。
   - 形・区間・本数・重複・出典不一致は、それぞれの理由コードで落ちる。
   - videos が無い素材は従来どおりに通る。
2. video notes:
   - 作られて R2 に書かれ、2 回目の試行では呼ばない。
   - 失敗した時は書かず、取り置きも消さない（精算しないため）。
   - 鍵が無い時は呼ばず、取り置きもしない。
   - 月・日の上限に当たった時は呼ばない。
   - 時間が足りない時は記録なしで進む。
3. 入力に `<video_notes>` が入り、body が無害化されている。
4. videos の判定:
   - 一致する時は成功し、not_seen が足される。
   - 欠け・余分・null は mismatch になる。
   - Batch は plan.json から読む。
5. review API と admin:
   - iframe の src が正しい形になる。
   - エスケープされる。
   - 古い検証は null になる。
   - CSP に youtube-nocookie が入る。
6. probe route:
   - 認証・Origin・上限を通る。
   - 返す形は 5 項目だけ。
7. 既存のテストがすべて green。新しいテストが変更前のコードで落ちる（mutation）。

## Q-8 PR の分け方（直列）

- **PR-Q1**（Gemini 無し）: Q-1 schema、Q-5 の表示（Gemini の記録と判定の欄は「未実装」で空にする）、CSP、allowlist、rubric。職人の定義の文は、司令塔が別 commit で書いて ant apply する。
- **PR-Q2**: Q-3・Q-4・Q-6（Gemini の port・記録・判定・費用・probe）。鍵の投入は、ふじさんがセッションの外で行う。

## 未確認の点（推測を事実として書かない）

- Gemini の YouTube URL に clip が効くか（docs の clip 例は upload ファイル）→ probe (a)
- usage のフィールド名 → probe (b)
- `gemini-3.6-flash` の動画の単価（pricing ページで確認できたのは 3.5 Flash-Lite と 3.8 Flash）→ U_video を上界に置き、精算しない
- `rel=0` は「同じチャンネルの関連動画」になるだけで、関連動画は消せない（公式 player_parameters）。確認画面ではこれを受け入れる
- youtube-nocookie（プライバシー強化モード）は、player_parameters のページでは確認できていない。公式の該当ページを、実装の前に司令塔が確かめる

## Q-9 裁定（Astra high R1 の指摘。本節は Q-0〜Q-8 に優先する）

1. **呼び出しの権利（B1）**: Gemini の呼び出しは「版 × 動画」ごとに**生涯 1 回**とする。試行ごと・再検証ごとには呼ばない。
   - 権利は取り置きの行 `ref_id = 'vv:' || version_id || ':' || video_id` を、次の 1 文の INSERT … SELECT … WHERE で入れられた時だけ得る（D1 の 1 文は原子的）。`changes = 1` の側だけが呼ぶ。
     ```
     INSERT INTO cost_ledger (id, day, kind, ref_id, cents, created_at)
     SELECT ?id, ?day, 'verify', ?ref, ?u, ?now
     WHERE NOT EXISTS (SELECT 1 FROM cost_ledger WHERE ref_id = ?ref)
       AND (SELECT COALESCE(SUM(cents),0) FROM cost_ledger WHERE kind = 'verify' AND ref_id GLOB 'vv:*' AND substr(day,1,7) = ?month) + ?u <= ?month_cap
       AND ({dailyReservedSql()}) + ?u <= ?daily_cap
     ```
     day / month は tokyoDay（Asia/Tokyo）とする。dailyReservedSql は §O と同じ式で、飛行中の取り置きを含む。
   - 呼び出しが失敗しても、行は残して再び呼ばない（精算しない）。その動画は、その版ではずっと記録なしになる（not_seen）。SDK・fetch の自動 retry は使わない（maxRetries 0）。
   - video-notes.json は「この版で呼んだ動画の結果」を、呼んだ後に 1 回だけ書く。成功した動画は notes、失敗・上限・鍵なしの動画は missing に入れる。R2 の書き込みに失敗しても、呼び出しの権利は消費済みなので呼び直さない（その動画は not_seen）。
   - probe の行は `vv:probe:{youtube_id}:{start}:{end}` とする。同じ値の再 POST は 409 にする。
2. **上限（B2）**: 月と日の条件は、上の 1 文に入れる。Q2 は**記帳額の保証**であり、Gemini の実費の上界ではない。実費は記録（usage があれば数字だけ）にとどめ、停止の判定には使わない。Gemini への要求には、公式 docs で確認できた出力の上限の指定があれば付ける。無ければ付けず、その旨を実装の報告に書く。
3. **入力（B3・B4）**: `<video_notes>` の前に `<videos>` を置く。中身は動画ごとの `part_id / id / title / channel / start_sec / end_sec / why / rights_note / source_id`（職人が書いた値で、資料であって指示ではない。1 動画 1 block。neutralize する）。無害化の関数は、`<source_captures>` `<video_notes>` `<videos>` の開始・終了タグと、行頭の `##` を対象にする。取得記録の側から `</video_notes>` を偽装するテストを入れる。
4. **集合（B5）**: `shown` は「この試行の入力に記録を実際に入れた動画」とする。容量が足りない時は、取得記録の後に動画の記録を後ろから省く。省いた動画は not_seen にする。plan.json に `videos: {shown, not_seen}` を書く。回収時の扱いは次のとおり。
   - 回収時は Gemini を呼ばない。video-notes.json からも数え直さない。
   - plan.json に videos が無く、版に動画がある時は mismatch とし、再試行する。
   - 版の動画の集合と `shown ∪ not_seen` が一致しない時は mismatch にする。
5. **probe と有効化（決定 3）**: settings `video_gen_enabled` が `'1'` の時だけ、通常の経路で Gemini を呼ぶ。既定は無しで、無しの時は呼ばない（動画は not_seen）。probe の結果を司令塔が見て、clip が区間の中身に効いていると確かめてから、管理画面の「動画の確認を有効にする」（Origin 検証つき POST）で立てる。clip が拒まれた・効いていない時は、全編解析へ自動で切り替えない（有効にせず、司令塔が §Q を改める）。`clip_accepted` は HTTP の成功ではなく、text_head と区間の中身の照合で司令塔が判断する。route が返すのは観測値だけ。
6. **人の合格条件（決定 4）**: 確認画面の「説明と表現」で、動画について次の 2 点を見る。
   - **本人性**: チャンネル・rights_note・記録の手がかり。
   - **区間**: 指定区間が再生でき、内容が見どころと合うか。

   疑いが解けなければ差し戻す（NG）。Gemini の記録と検証係の判定は補助である。

   版に動画がある時は、「使う条件」を自動 OK にしない（`src/checks/triage.ts` の該当箇所）。表示の文言は「動画: 本人のアップか・区間が再生できて内容が合うかを見てください」とする。

   区間の指定と `rel=0` は区間外への移動や関連動画を止めない（公式）。youtube-nocookie も広告・追跡が無いことを保証しない。この 2 点を確認画面の小さな注記に出す。
7. **費用の表示（NB）**: review API の verify_cost_cents に `vv:{version_id}:*` を足す。
8. **CSP（NB）**: frame-src の追加は `/admin`（管理画面の HTML の CSP）だけにする。生成物の配信（library.ts など）の CSP は変えないことを、負の検査で確かめる。
9. **補足（Astra high R2・GO）**:
   - plan.json の `videos.shown` と `videos.not_seen` は、それぞれの中で重複を許さず、互いに交わらない。受け入れテストに入れる。
   - SQL は `day = tokyoDay(now)`、`month = day.slice(0,7)`、`dailyReservedSql(day, …)` を同じ日付で組み立て、既存の位置パラメータで bind する。
   - 日次の保証は「取り置きを入れる時点の条件」である（全台帳の hard cap ではない。既存の記帳方式と同じ）。
10. **watch ページの扱い（自動のセキュリティ確認の指摘）**: ~~allowlist の hosts（作業場の通信）には YouTube を入れない。domains（web_fetch / web_search）だけに入れる。~~ **改め（2026-11-05）**: API は web ツールの allowed_domains が limited 環境の allowed_hosts の中にあることを求め、外れると sessions.create が 400 `invalid_request_error`（「web tool `allowed_domains` must stay within the `allowed_hosts`…」）になる。本番で新しい素材がすべて始まらなくなったため、ふじさんの判断で hosts に `youtube.com` と `*.youtube.com` だけを足す（動画の本体の googlevideo.com・画像の ytimg.com は入れない。package manager は閉じたまま）。整合は test/allowlist-env.test.ts で検査する。watch ページの題名・概要欄は投稿者が自由に書ける文なので、検証係は watch ページの本文だけを根拠に claim を confirmed にしない。動画を出典にした claim を confirmed にできるのは「動画の記録で確認:」の時だけとする（PR-Q2 の system 段落と検査に入れる）。
11. **Q-9.10 の有界な形（実装レビュー R1〜R3 の後の裁定）**: 「watch ページだけで confirmed にしない」は、モデルの振る舞いの約束ではなく、Worker が判定の後に当てる次の検査として保証する。
   - **見せないもの**: 検証係は YouTube のページの文を受け取らない。入力の sources_json では、YouTube の出典の quoted_excerpt を伏せる。取得記録にも入れない。検証係の web_fetch の許可にも入れない。YouTube の出典は、url が YouTube の行と、版の動画が指す行の両方とする。
   - **残してよい条件**: YouTube の出典を含む claim は、次のどれかの構造化された証拠がある時だけ confirmed のまま残す。
     - (a) その動画の記録を入力に入れた（shown）。
     - (b) YouTube でない出典の取得記録を入力に入れた（captured）。
     - (c) この試行の web_fetch の結果（fetched_ok）に、YouTube でない出典の url がある。

     どれも無ければ Worker が unverified に下げる。

   検証係が書く opened_urls や reason の書き出しは、証拠に数えない。§P の deploy の前に出した Batch で、plan.json に captured が無く、YouTube の出典がある版は、作り直しにする（mismatch）。
12. **probe の診断（本番で 503 が 2 回続いた後の追加）**: probe の応答に `clip`（区間を付けたか）と `api_error`（Google の error の status と message の先頭 200 字。鍵らしい文字列は伏せる）を足す。入力 `clip:false` で区間を付けない診断の呼び出しを 1 回だけできる（取り置きの ref は `…:noclip`）。通常の経路は常に区間を付ける。

凍結: 2026-11-05（Astra high R2 GO）。

## Q-10 混雑時のやり直しと予備のモデル（2026-11-05。本節は Q-9.1 の「生涯 1 回」と video-notes.json の書き方に優先する）

起点: probe 4 回がすべて 503 `UNAVAILABLE`（Google の message「gemini-3.6-flash is currently experiencing high demand…」）。区間あり・区間なしの両方で同じだった。Google の開発者フォーラムには、同じ 503 の報告がモデルを問わず数か月分ある。Q-9.1 のままでは、混雑した日に検証した版の動画は二度と確認されない。ふじさん: 「頻繁にあるんだったら、代替手段を持っておかないといけないんじゃないの？」

1. **保証（有界）**: 版 × 動画ごとの Gemini の呼び出しは、生涯 `VIDEO_MAX_CALLS = 3` 回まで。1 回の検証の試行の中では 2 回まで。記帳は呼び出し 1 回ごとに U_video で、精算しない（行は消さない）。最悪の記帳は 1 動画あたり 3U（30¢）。月と日の上限は Q-9.1 の 1 文のまま、呼び出しごとに当てる。
2. **呼び出しの権利の行**: n 回目の呼び出しの ref は、n = 1 なら `vv:{version_id}:{video_id}`（Q-9.1 と同じ。既存の行と互換）、n ≥ 2 なら `vv:{version_id}:{video_id}:r{n}`。n は D1 にある行（この 3 つの ref）の最大 + 1 で決め、**n > 3 なら取り置きを試みない**。取り置きは Q-9.1 の 1 文（`NOT EXISTS ref`）をそのまま使う。同時に 2 つの試行が同じ n を取ろうとしても、入れられるのは 1 つだけで、負けた側はその動画を呼ばない（この試行では not_seen）。
3. **呼び出しの記録（1 呼び出し 1 ファイル・書き直さない）**: 取り置きに勝った側だけが、呼び出しの後に `{r2_prefix}video-calls/{video_id}/{n}.json` を作る。中身は `{"v":1,"video_id","n","model","model_role":"primary"|"fallback","outcome":"ok"|"retryable"|"final","error":<kind or null>,"text"?,"usage"?,"at"}`（text は ok の時だけ。8,000 文字で切る）。put は条件なし（実装時の追記: Workers の R2 binding で `etagDoesNotMatch: "*"` を「まだ無い時だけ」に使えることは公式 docs に無いため、それに頼らない）。n は D1 の取り置きで一意なので、書き手は 1 つだけ。put が null を返した時と、put の例外の時は、その呼び出しの結果はこの試行に出さない（not_seen。呼び出しは記帳済み）。
4. **動画の状態は記録から組み立てる**（毎試行・回収では行わない）: その動画の D1 の行（n = 1..3）と、R2 の呼び出しの記録を読み、次で決める。
   - ok の記録が 1 つでもある → note にする（n がいちばん小さい ok を採る）。以後は呼ばない。
   - final の記録がある → 呼ばない（not_seen）。
   - 次の n を呼んでよいのは、**いちばん大きい n の行に記録があり、その outcome が retryable で、n < 3 の時だけ**。行があるのに記録が無い（呼び出し中・結果不明・put 失敗）時は、時間がたっても呼ばない（not_seen）。後から retryable の記録が届けば、その後の試行で呼べる。final の記録が届けば、以後は呼ばない。時間で retryable に格上げする規則は置かない（結果が retryable だった証拠にならないため）。
   - 試行の締め切りまでの残りが `VIDEO_CALL_MIN_MS` 未満なら呼ばない（従来どおり）。
5. **やり直す失敗（retryable）**: `GeminiErrorKind` の `server`（5xx）・`rate_limited`（429）・`timeout`・`connection`、および外側の締め切り（`beforeDeadline`）で待ちきれなかったもの。それ以外（`auth`・`not_found`・`bad_request`・`bad_response`・`not_completed`・`no_text`・`no_key`・`bad_input`）は final。
6. **1 回の試行の中**: 呼べる動画について 1 回呼ぶ。retryable で、`deadline - now ≥ VIDEO_RETRY_WAIT_MS(20,000) + VIDEO_CALL_MIN_MS` の時だけ、20 秒待って次の n を取り置いてもう 1 回呼ぶ（試行内で 2 回まで）。SDK・fetch の自動 retry は引き続き使わない。
7. **予備のモデルの使いどころ**: n ≥ 2 の呼び出しは、予備のモデルが有効なら予備のモデルで呼ぶ（試行の中でも、後の試行でも同じ）。無効なら主のモデル。これで、主のモデルが混んでいる間に予備が一度も使われない形を避ける。
8. **試行をまたぐやり直し**: 後の試行（再検証の操作、または mismatch による作り直し）で、4 の規則で呼んでよい動画を呼ぶ。Batch の回収（collect）では呼ばない・組み立てない（Q-9.4 のまま。plan.json の videos を使う）。自動の定期実行は足さない。
9. **video-notes.json の扱い**: 新しい版では書かない。既に v1 のファイルがある版はそのファイルを使い、呼ばない（Q-9.1 のまま。既存の missing は救わない）。読む側は 1 つの関数（`src/videos.ts` の `readVersionVideoNotes`）にまとめる。v1 のファイルがあればそれを、無ければ呼び出しの記録から 4 の規則で組み立てた `{notes, missing}` を返す。検証係の入力と review API（`src/routes/review.ts` の video_notes）は、どちらもこの関数を使う。review API の応答の形は変えない。
10. **予備のモデル**: env `GEMINI_VIDEO_FALLBACK_MODEL`（wrangler の値は `gemini-3.8-flash`。公式の pricing で、入力の単価は 3.6 Flash と同じ「$0.75 / 1M tokens、2026-12-31 まで」）。settings `video_fallback_enabled` が `'1'` の時だけ使う。既定は無し。区間の指定が 3.8 Flash で効くかは公式の docs で確かめられていないので、有効にする手順は Q-9.5 と同じとする。probe（入力 `model: "fallback"`。取り置きの ref に `:fb` を足す）の text_head を司令塔が見て、区間の中身に効いていると確かめてから、`POST /api/videos/enable` に `{"fallback": true}` を送って立てる。予備のモデルが未設定なら 409。
11. **記録とログ**: note の `model` は、実際に答えたモデル。ログ `video_notes` に `call`（n）と `model_role` を足す（数とラベルだけ）。
12. **変えないもの**: plan.json と回収、Q-9.11 の検査、確認画面、review API の形（verify_cost_cents の `vv:{version_id}:*` は r2・r3 の行も含む）。probe は Q-9.12 に `model` の入力を足すだけ（ref は primary/fallback × clip/noclip で別）。
13. **受け入れ（vitest。fake の GeminiPort・fake の時計・fake の R2 の条件つき put）**:
    - 503 → 20 秒待ち → 2 回目で成功: note になり、行が 2 つ（`vv:…` と `…:r2`）、記録が 2 つ。
    - 503 が 2 回 → 次の試行で 3 回目を呼ぶ。3 回目も 503 なら、その後の試行では呼ばない（D1 に r3 があれば R2 の状態に関係なく追加の取り置きはゼロ）。
    - `auth` や `no_text` は 1 回で final。外側の締め切りは retryable。
    - 締め切りが足りない時は待たずに 1 回で終わり、後の試行で呼べる。
    - 同じ n を 2 つの試行が同時に取りに行くと、片方だけが呼ぶ。負けた側は記録を書かず、勝った側の ok が残る。
    - 記録が無い行: 時間がたっても呼ばない。n=1 が auth で put に失敗 → 何分たっても n=2 を取り置かない。欠損を読んだ後に retryable の記録が届く → 次の試行で呼べる。final が届く → 呼ばない。
    - 複数の ok（n=1 と n=2）がある時は n=1 だけを note にし、入力にも 1 回だけ出す。
    - 呼び出しの記録だけがある版で、review API の video_notes が note を返し、確認画面に出る（v1 の版も従来どおり）。
    - 予備のモデルが有効な時、n ≥ 2 の送信 body の model が予備のモデルである。probe の ref は primary/fallback × clip/noclip の 4 組で別になる。
    - 予備のモデル: 無効なら n ≥ 2 も主のモデル。有効なら n ≥ 2 は予備の名前で呼び、note の model もそれになる。
    - 条件つき put が null を返す時と例外の時は、その試行では not_seen。
    - 月・日の上限で n = 1 / n = 2 の取り置きが入らない時は呼ばず、上限が空いた後の試行で呼べる（行が増えていないこと）。
    - v1 の video-notes.json がある版は呼ばない。
    - 回収（collect）は Gemini を呼ばず、R2 の記録も読まない。提出後に記録が増えても、回収は plan.json のまま。
    - 動画の確認が無効の時は呼び出しゼロ。予備のモデルが未設定の時の enable は 409。
    - 過去の retryable に引きずられない: n=1 が retryable、n=2 は行だけ（記録なし）→ 何分たっても n=3 を取り置かない。
    - 遅れて届く ok: 欠損として扱った後に ok の記録が届く → 次の試行では呼ばず、検証係の入力と review API の両方に同じ note が出る。
    - readVersionVideoNotes の返す形の互換: 動画の記録が 1 つも無い版は従来どおり null（確認画面は「まだありません」のまま）。記録がある版は `v:1` と、動画ごとの id・区間などを含む従来の完全な形。
    - 既存のテストが green。新しいテストが変更前のコードで落ちる（mutation）。
14. **範囲**: 触るのは `src/verify.ts`・`src/videos.ts`・`src/routes/review.ts`（video_notes の読み方だけ）・`src/routes/videos.ts`・`src/env.ts`・`src/fake/gemini.ts`・fake の R2（条件つき put が無ければ足す）・`wrangler.jsonc`（var 1 つ）・test/。migration は無し。職人の定義・admin.js は変えない。

凍結（Q-10）: 2026-11-05（Astra high R3 GO）。
