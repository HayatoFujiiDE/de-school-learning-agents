# §O-13 生成画像を厳しく確かめる（絵の主張・参照・一次の出典・理科の取得先）（2026-11-07 凍結。v3 — Astra medium R1 の 6 件・R2 の 2 件 + 曖昧 4 件を反映。設計レビューは 2 回で打ち切り、残りは実装のレビューで見る）

ふじさん依頼（2026-11-07）: 「こういう画像とかあってるのかわからないからこれらもちゃんとエージェントしっかりチェックしたい」「画像生成は特にハルシネーションしやすいから」「元の参考資料も科学系はより厳しくサンプル取るとかかな？」。
§O-12 は「図を見る」まで。本節は、**検証係が何を確かめればよいかを職人に書かせ（絵の主張）、その根拠に一次の出典を機械で要求し、判定の中身を人にも見せる**。V-6 の仕分け（図の problem = fix → 自動の差し戻し）と V-7 の回数の上限はそのまま使う。

用語: **対象画像** = material.json の files[] のうち `image_id` があり、その image_requests の `accuracy` が `scientific` のもの。

## O13-0 取得先の一覧（`factory/claude/allowlist.json`。R2 MAJOR 1 の対応。職人・検証係・環境の 3 つを同じ一覧から作る）

今の `domains` は 8 件（minecraft.wiki・docs.python.org・scratch.mit.edu・mext.go.jp・nier.go.jp・ja.wikipedia.org・developer.mozilla.org・youtube.com）で、理科の一次資料をほとんど開けない。これが「科学系の参考資料が弱い」原因の 1 つ。次を足す。

1. `domains` に足す（職人の web_fetch と検証係の取得先。サブドメインを含む）: `kahaku.go.jp`（国立科学博物館）、`jaxa.jp`、`nao.ac.jp`（国立天文台）、`jamstec.go.jp`、`riken.jp`、`aist.go.jp`、`jma.go.jp`（気象庁）、`gsi.go.jp`（国土地理院）、`env.go.jp`、`mhlw.go.jp`、`jst.go.jp`、`nih.gov`、`medlineplus.gov`、`nasa.gov`、`esa.int`、`noaa.gov`、`usgs.gov`、`britannica.com`、`kotobank.jp`、`tokyo-shoseki.co.jp`、`kyoiku-shuppan.co.jp`、`dainippon-tosho.co.jp`、`keirinkan.com`、`shinko-keirin.co.jp`、`gakko-tosho.co.jp`、`teikokushoin.co.jp`、`en.wikipedia.org`、`kidshealth.org`。
2. `primary_hosts`（新設。**`domains` の部分集合**であることを test で固定する）: 上のうち `en.wikipedia.org`・`kidshealth.org`・`ja.wikipedia.org`・`minecraft.wiki`・`docs.python.org`・`scratch.mit.edu`・`developer.mozilla.org`・`youtube.com` を**除く**全部 + `mext.go.jp`・`nier.go.jp`。
3. `hosts`（限定環境の allowed_hosts）にも同じ host を足す（`domains ⊆ hosts` を test で固定。2026-11-06 の sessions.create 全件 400 の再発防止）。
4. `material-maker.md` の `allowed_domains:`（web_search / web_fetch の 2 か所）と `claude/environments/` の allowed_hosts を同じ一覧に直す（`sync-claude-assets.sh` が生成するなら生成、手書きなら手で揃えて test で突き合わせる）。反映は ant apply（職人と環境の両方）→ 確認用の session を 1 本（[[feedback-smoke-session-after-ant-apply]]）。
5. host の照合（純関数 `hostMatches(hostname, list)` は取り込みが使い、仕分け・確認画面はその判定結果（checks_json・figures_meta）を使う。検証係の取得先は API の web_fetch の allowed_domains が守るので Worker 側に照合は無い）: `new URL(url).hostname` を小文字にし、末尾の `.` を取り、ポートは見ない。一致は完全一致か、`'.' + entry` で終わること（`notkahaku.go.jp` は `kahaku.go.jp` に一致しないが `go.jp` が一覧にあれば一致する。一覧に裸の `go.jp` は入れない）。

## O13-1 職人（material-maker.md。ant apply が要る）

1. **絵の主張（shows）**: 対象画像には files[] の行に `shows` を書く（**2〜6 件**）。1 件は `{ "text": "<絵がこう描いていると言い切れる事実を 1 文（200 字まで）>", "source_ids": ["s3"] }`。書くのは**形・数・比率・色・配置・文脈**（例: 「赤血球はまん中がへこんだ円盤で、核が無い」「毛細血管の中を赤血球が 1 列で通る」「静脈の血も赤い（青くない）」）。感想や雰囲気は書かない。`source_ids` は sources.json の id（1〜5 件、重複なし）。
2. **一次の出典**: 絵の主張の各文は、**一次とみなす発行主体**（`allowlist.json` の `primary_hosts` = O13-0。公的研究機関・博物館・天文台・気象庁・教科書会社・百科事典）の出典を 1 つ以上持つ。一次が無い事実は、絵の主張に書かず、**絵にも描かない**（描いた物は絵の主張に書く義務があるため）。理科・保健の題材では、本文の claims のうち形・数・比率・仕組みの主張も同じ基準を目指す（claims 側は採点表と検証係の所見。機械の合否は絵の主張だけ）。
3. **参照（reference_url）**: 対象画像には 1 つ書ける（任意。生き物・体のつくり・天体・鉱物など実物の見た目が決まっている題材では書く）。web_fetch で実際に開いた、実物の写真・顕微鏡像・博物館や教科書の図があるページの `https://` の URL（一字も変えない。2000 字以内）。出典にも入れる。
4. 画像が返ってきて見る時（既存の「返ってきた画像は必ず見て…」の行に足す）: 絵の主張の各文が絵で成り立っているか、ありがちな誤り（核のある赤血球・青い静脈血・部屋や層の数と並びの違い・大きさの比の違い・題材と違う生き物や器官・実在しない部品・文字の崩れ）が無いかを見る。成り立たない文があれば**絵を描き直す**（絵に合わせて主張を減らさない）。
5. **作り直しの時**: 前の版と同じ画像（同じ image_id）を使うなら、前の版の絵の主張の文をすべて残す（足すのはよい）。描き直した画像（新しい image_id）は新しく書く。`accuracy=standard` にして逃げない（実物の形を描く絵は scientific）。

## O13-2 取り込み（`src/checks/schema.ts`。すべて I/O なしの純関数で検査し、checks_json に残す）

1. files[] の行の `shows`: **`image_id` のある行だけ**に書ける（SVG や他のファイルの行にあれば `bad_image_shows:<path>`）。形: 配列で **2〜6 件**。各要素は `text` が空白だけでない 1〜200 字（code point）の文字列、`source_ids` が 1〜5 件・各 1〜40 字の文字列・重複なし。`reference_url`: 文字列で、文字どおり `https://` で始まり（前後の空白なし。確認画面のリンクの条件と同じ）、`new URL()` が解析でき、host が空でなく、2000 字以内。どれかが違えば `bad_image_shows:<path>`（`bad_image_ref` と同じ＝取り込みで弾く）。素材全体で shows の合計は 48 件まで（同じ path は 1 回だけ数える。超えたら最初に超えた path で `bad_image_shows`）。**同じ path の行が 2 つ以上**ある時は、2 行目以降の shows と reference_url が 1 行目と同じでなければ `bad_image_shows:<path>`（後の行の主張が検査から漏れないように。以降の検査・一覧は path の最初の行だけを見る）。
2. 対象画像に `shows` が無い → checks_json の `figure_shows_missing: [<path>]`（弾かない。旧い版のため）。
3. `source_ids` が sources に無い id → checks_json の `figure_shows_refs: [{path, n, source_ids: [<無い id を全部>]}]`（文ごとに 1 件。既存 `missing_source_refs` には混ぜない。claim_id を作らない）。
4. **一次の出典**: 各 shows の `source_ids` のうち、sources.json の `url` の hostname が `primary_hosts`（O13-0）に `hostMatches` で一致する出典が 1 つも無い → checks_json の `figure_shows_no_primary: [{path, n}]`。`is_primary` の自己申告は使わない。url が解析できない出典は一致しない扱い。
5. **作り直しで文を減らした**: rework（job.parent_version_id あり）の取り込みでは、親の版の `material_json` を D1 から読んで渡す（読めなければ検査を省略し、ログ `{at:'ingest', warn:'parent_material_unreadable'}` を 1 行。省略は「通す」側だが、親が読めないのは別の異常なので止めない）。比べ方は **path ごと**: 新しい版の行と、親の版の**同じ path かつ同じ image_id** の行がある時だけ、新しい行の shows の text 集合（前後の空白を除いた完全一致）が親の集合を含まなければ `figure_shows_removed: [{path, texts: [<減った text>]}]`。path が違う・image_id が違う行は比べない。

## O13-3 検証係（`src/verify.ts`）

1. 図の一覧の行（§O-12 b 3-2）: 生成画像の行の末尾に `、絵の主張=[1] <text>（出典 s3, s4）[2] …、参照=<reference_url か「なし」>` を足す（text は 1 行・200 字、合計 48 件の上限は O13-2 で保証）。shows が無い行は `、絵の主張=なし`。
2. system に次の段落を足す（図の判定の段落の直後。verbatim）:
   ```
   生成画像のうち絵の主張がある図は、絵の主張を 1 文ずつ絵と照らし、その文の出典（と参照の URL）を開いて事実としても確かめます。絵がその文のとおりでない（形・数・比率・色・配置・文脈のどれかが違う）か、文が出典と食い違うなら、その文は wrong です。ありがちな誤りに注意します: 核のある赤血球、青い静脈血、部屋や層の数と並びの違い、大きさの比の違い、題材と違う生き物・器官・器具、実在しない部品、文字の崩れ。絵の主張が無い生成画像や、正確さ=standard なのに実物の形を描いている画像は、prompt と alt を同じ基準で見て、問題があれば図の reason に書きます。
   図ごとの checks には、絵の主張の番号順に {n, result, note} を書きます（result: ok = 絵も出典も合う / wrong = 絵が文のとおりでない、または文が出典と食い違う / unclear = 絵か出典だけでは決められない。参照や出典を開けなかった時も unclear）。絵の主張が無い図の checks は空配列です。
   ```
3. `VERDICT_SCHEMA` の figures の要素に required の `checks: [{ n: integer, result: 'ok'|'wrong'|'unclear', note: string }]` を足す（strict のまま。strict を外す既存の逃げ道はそのまま）。
4. **計画**: 図の一覧を作る時に `figure_checks: { <見せた path>: N }`（N = その図の shows の件数。shows 無しは 0。`not_seen` の path は入れない）を決め、同期は入力に、Batch は plan.json に残す。**継続提出や回収で plan を読み直して書き戻す時は、plan のオブジェクト全体を保つ**（読み取り側が知らないフィールドを落とさない）。
5. `validateVerdicts(input, claimIds, figurePaths, figureChecks)`:
   - `figureChecks` が **undefined（計画にキーが無い = 旧い計画）** → 応答の `checks` は見ない。保存は `checks: []`。
   - `figureChecks` のキーはあるが、オブジェクトでない・見せた path が欠けている・余分な path がある・N が 0 以上の整数でない → **旧い計画とは見なさず失敗**（`claim_set_mismatch`。再試行が新しい計画を作る）。
   - `figureChecks` が正しい → 見せた各図について: 応答の `checks` が配列でない・要素がオブジェクトでない・`n` が 1 以上の整数でない・重複・`result` が enum 外 → 失敗。`n` の集合が **1..N とちょうど一致**しなければ失敗（N=0 は空配列）。失敗の理由は既存の `claim_set_mismatch`（新しい理由コードは作らない。再試行は新しい入力で作り直す）。`note` は文字列でなければ `''` として扱い、500 字で切る。
6. **最終の verdict（Worker が決める。決定的）**: `verdict_raw` = 検証係の verdict。checks に wrong が 1 つでもあれば `problem`。wrong が無く unclear があり verdict_raw が ok なら `unclear`。それ以外は verdict_raw。`problem` に直した時は reason の先頭に `絵の主張 [1][3] が成り立たない: `（wrong の n を昇順に全部）、`unclear` に直した時は `絵の主張 [2] を確かめきれない: ` を足す（reason は 2000 字で切る）。保存する `FigureReport` は `{path, verdict, verdict_raw, reason, checks}`。`not_seen` は `verdict_raw: 'not_seen', checks: []`。
7. 参照の URL と出典は検証係の web_fetch の対象（既存の allowlist と上限 `VERIFY_MAX_FETCHES` の内側。開けなければ unclear）。費用の見込み: 入力の増分は最大 48 文 × 200 字 + 8 URL × 2000 字 ≈ 26,000 字（`VERIFY_INPUT_CHAR_LIMIT` 400,000 の内側）。fetch が上限に当たれば unclear → ask（人に出る。自動の差し戻しにはならない）。

## O13-4 仕分け（`src/checks/triage.ts`。V-6 の項目の順・severity・V-7 の回数の上限は変えない）

1. 図の項目（`figure:<path>`）の severity は最終の verdict で決める（problem = fix / unclear = ask / not_seen = ask。今までどおり）。
2. 図の項目の detail（`ITEM_DETAIL_MAX` 600 はそのまま。番号が全部残る形）:
   - 1 行目（必ず入る。80 字以内）: `絵の主張 [1][3] に問題、[2] は確かめきれない`（wrong の番号を全部、次に unclear の番号を全部。無い側は省く）
   - 続けて wrong ごとに `・[n] <text を 60 字で切る>: 問題（<note を 40 字で切る>）`、unclear ごとに `・[n] <text 60 字>: 確かめきれない（<note 40 字>）`（1 行 120 字以内。48 件の上限でも 1 行目 + 4 行は入る）
   - 最後に reason。合計 600 字に入らない分は**後ろから**切る（1 行目と番号の行が先に残る）。番号の行は途中で切らず、入らない行ごと落とす。最後の reason だけ入る分まで切る（2026-11-07 Astra high の指摘 M2）
   - 「問題」の説明は「絵のとおりでない」に限らない（出典との食い違いも wrong。どちらかは note に書かれる）
3. return_note（V-6 g の書式）の図の行は §L-9 の付箋の行と同じ形: `- 図 <part_id> <path>: 検証係の指摘 — <detail>`（detail は上の順。4000 字の上限は既存どおり）。
4. 新しい項目（kind `check`、key `explanation_and_expression`、機械検査の位置）:
   - `check:figure_shows_missing:<path>`: severity `note`、title 「scientific の画像に絵の主張（shows）が無い」
   - `check:figure_shows_ref:<path>:<n>`: severity `fix`、title 「絵の主張の出典 id が出典一覧に無い」、cause `figure_shows_ref`、detail に無い id を全部（文ごとに 1 項目）
   - `check:figure_shows_no_primary:<path>:<n>`: severity `fix`、title 「絵の主張に一次の出典が無い」、cause `figure_shows_no_primary`、detail に「一次とみなす発行主体: <primary_hosts の先頭 8 件>…」
   - `check:figure_shows_removed:<path>`: severity `fix`、title 「作り直しで絵の主張が減った（同じ画像）」、detail に減った texts（1 項目にまとめる）
   fix は既存どおり自動の差し戻しの対象（`autoRounds < autoReturnMax`）。return_note の行は `- 図 <part_id> <path>: <title>（[n] <text>）`。

## O13-5 確認画面（`GET /api/review/:vid` と admin.js）

- API: `verification.figures[]` に `verdict_raw` と `checks` を通す。版の `material_json` から `figures_meta: { <path>: { shows: [{text, source_ids}], reference_url } }` を返す（shows が無い図は入れない）。
- サムネイルの下（§O-12 d の pill の下）に「絵の主張」の一覧: 各文の前に ✓（ok）/ ✗（wrong・赤）/ ？（unclear・黄）/ －（未検査・灰: checks が無い旧い結果・not_seen・検証前）、note があれば続けて。`reference_url` は「参照を開く」のリンク（`target="_blank" rel="noopener noreferrer"`、`esc()`）。教材プレビューの図（`.mp-fig`）には出さない（子どもが見る形を保つ）。
- 「見てほしい所」の図の項目の detail は O13-4 のとおり（`esc()`）。

## O13-6 採点表（`claude/rubrics/kind-3.md`）

- 「scientific の画像には絵の主張（shows）が 2〜6 件あり、各文に一次の出典（`primary_hosts`）が付いている」「絵の主張の各文が絵で成り立っている。成り立たない時は絵を描き直してある」「理科・保健の題材では、形・数・比率・仕組みの主張に一次の出典がある」を足す。

## O13-7 受け入れ（vitest。fake の port・`node:sqlite`）

1. schema: 正しい shows は通る。1 件・7 件・空白の text・201 字・source_ids 0 件 / 6 件 / 重複・`http://`・host 無し・2001 字 → `bad_image_shows:<path>`。49 件目で素材が弾かれる。対象画像で shows 無し → `figure_shows_missing`。sources に無い id → `figure_shows_refs` に `{path, n, source_ids}`（無い id を全部）。同じ path の行が 2 つで絵の主張が違う → `bad_image_shows`、同じなら通り合計は 1 回だけ数える。`https://` で始まらない参照（先頭の空白・`https:host`）→ `bad_image_shows`。一次の host が無い → `figure_shows_no_primary` に `{path, n}`。サブドメイン（`www.kahaku.go.jp`）は一致、`notkahaku.go.jp` は `kahaku.go.jp` に一致しない（`go.jp` には一致）。作り直しで親の text を 1 つ落とす → `figure_shows_removed`。親無しでは検査しない。
2. verify（同期）: 図の行に絵の主張と参照が入る。計画の `figure_checks` が 1..N と一致する応答 → 成功し result_json に `checks` と `verdict_raw`。欠け・重複・enum 外・`checks` 無し → `claim_set_mismatch`。旧い計画（`figure_checks` 無し）では `checks` 無しの応答も成功し保存は `[]`。wrong があるのに verdict ok → 保存は problem で reason の先頭に文。unclear だけで ok → unclear。not_seen の図は `figure_checks` に入らず `checks: []`。
3. verify（Batch）: plan.json に `figure_checks` が残り、継続提出を 1 回挟んでも落ちない（読み直し → 書き戻しで保つ）。回収時に同じ検査。
4. triage: problem の図の detail の 1 行目が「絵の主張 [n] に問題、[m] は確かめきれない」、続く行が `・[n]`、600 字で後ろから切れる（6 文・wrong と unclear が混ざる時も番号の行が途中で切れない）。return_note の図の行が `- 図 <part_id> <path>: 検証係の指摘 — 絵の主張 [n] に問題` で始まる。`figure_shows_no_primary` / `figure_shows_ref` / `figure_shows_removed` は fix で、`autoRounds < autoReturnMax` の時に auto_return。`figure_shows_missing` は note。
5. admin: `figures_meta` から ✓ ✗ ？ － の一覧が出る。shows 無しの図は出ない。`esc()` を通る。
6. allowlist: `primary_hosts ⊆ domains ⊆ hosts`。`hostMatches`（小文字化・末尾 `.`・ポート無視・サブドメイン・`notkahaku.go.jp` 不一致）。material-maker.md の `allowed_domains` 2 か所と環境の allowed_hosts が allowlist.json と一致する（test で突き合わせ）。検証係の `VERIFIER_FETCH_DOMAINS` に新しい host が入る。
7. 計画の不正: `figure_checks` が null / path 欠け / 余分 / N が -1 → `claim_set_mismatch`（旧い計画扱いにしない）。旧 Batch（計画にキー無し）の継続提出 → 回収は `checks: []` で成功。
8. 既存の test が全部通る。tsc 0。
9. 見た目: `test/review-preview/` の作り物のデータに shows 付きの図を 1 枚足し、1440 を 1 枚撮って `screens/2026-11-07-figure-claims/` に置く。

## 範囲の外

無料の 3D 教材（Sketchfab 等）の埋め込み（外部読み込みの決まりと CSP に触るため、動画 §Q と同じ「許可リストとライセンスの確認」を持つ別レーン）、SVG の図への shows、画像どうしの機械的な一致、claims 側の一次の出典の機械の合否（採点表と検証係の所見にとどめる）。
