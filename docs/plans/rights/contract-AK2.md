# §AK2 本文の丸写しの検査（`verbatim_copy`）: 職人が開いたページの文を 100 字以上そのまま本文に入れた版は公開できない（2026-11-07 凍結 v3 / 2026-11-08 v3.1・v3.2）

ふじさんの指示（2026-11-07）: 「エビデンスをもとに、絶対に権利の侵害がない形で工場が動くように。決定論的に」。§AK（`contract-AK.md`）は立体モデルの複製・埋め込みを門番で守る。本契約はその AK-8 の次段 PR-AK2: **本文（.md / app.html / .svg の見える文）に、職人が session で開いたページの文の丸写しが無いこと**を、取り込みの時に機械で確かめる。引用の適法性（著作権法 32 条）の判定はしない（AK-8 のとおり保証の範囲外）。「長い一致 = 丸写し」を検出して止める手段である。

レビューの経緯: Astra medium 1 回目 REVISE（BLOCKING 6）→ v2 で全部に対応: (1) ページをまたぐ `web_fetch` の use → result の対応を、出典照合と**同じ解決済みの result** から受け取る（`accumulateCitations` が result ごとに呼ぶ callback を足す。対応表は 1 つだけ）(2) 上限は引用の除外の**後**で数え、未検査の部分が残った版は「なし」ではなく `verbatim_incomplete` として公開を止める (3) 本文の抽出は**見える文を全部**（行内コード・囲みコードの中身も残し、強調などの記号だけ除く）(4) 引用の除外は走査の中で区間の全文を見て行う (5) 作り直しの親の記録の検査は時間不足でも省略しない（読めなければ `verbatim_incomplete`）(6) 仕分けの観点は既存の `terms_of_use`（利用条件）。NON-BLOCKING も採る（字の単位はコードポイント・正規化の順序・保存の大きさの見積り・`MAX_PAGES` 500 の実数・反復文字の性能の上限・publishSwitch の対象・表示の 3 状態）。Astra medium 2 回目 REVISE（6 件のうち 3 件は閉鎖・新しく 4 件）→ 予算の 2 往復を使い切ったので司令塔の裁定で v3 として凍結: (B1) 一致のあとに位置を飛ばさず**ページの全部の位置**を調べ、重なりは `mergeHits` で 1 つにする (B2) md は**コードの区間を先に切り出して中身を無加工で残し**、記号の除去とリンクの変換はコードの外にだけ掛ける (B3) 作り直しは**親の版の検出をそのまま引き継ぐ**（親の hit の区間の全文が子の本文にまだあれば hit。親が `incomplete` なら子も `incomplete`）。検出した区間の全文を hit に保存する (B4) 親の取得記録は AK2 専用の厳密な読み方で読み、壊れた行・切り詰めの疑い・`missing` / `truncated` が 1 つでもあれば `incomplete`。v3.1（2026-11-08・実装時）: AK1 の textOfHtml の null の扱い — §AK（PR-AK1）で `textOfHtml` が閉じていない構造に `null` を返すようになったので、その本文を AK2-1 で `incomplete` にすると 1 文足した。

v3.2（2026-11-08 司令塔の裁定）: 作り直しの親の取得記録は `missing` が空でなくても未完了にしない（YouTube の出典と、その session で開かなかった出典は必ず `missing` に入るため、動画つきの素材の作り直しが永久に公開できなくなっていた）。`truncated`・壊れた行・記録が無いは従来どおり未完了。親が本契約の後に取り込まれた版（`verbatim_status` あり）なら、親の session の `web_fetch` は全部その時に走査済みなので、取得記録は読まず検出の引き継ぎだけで足りる（先送りを使い切っても未完了にしない）。

## 実測した事実（repo。2026-11-07）

- 出典照合（`src/checks/citations.ts`）は純関数で、取り込み（`src/jobs.ts` 1930 行付近）が session の events を古い順にページ単位で流し込む（`accumulateCitations(ev.acc, citeSources, p.data)`。ingest の 1 回の呼び出しで `MAX_PAGES` = 500 ページまで）。`fetches` に未対応の `web_fetch` の use を保存し、result を処理したら消す（ページをまたいでも対応できる）。`resultText(ev)` が result の本文（text block と document block）を返す。本文は保存しない（`CitationAcc` は URL 単位の旗だけ。`reconcile_state_json` に保存。state 全体の大きさには既存の 1,500,000 bytes の守りがある）。
- 取得記録（§P。`src/verify.ts` 610〜850 行）は検証係が最初に動く時に R2 `{prefix}source-captures.json` へ書く（1 出典 30,000 字まで・sources.json の URL だけ・YouTube は除く）。取り込みの時点では無い。作り直しは親の版の記録を `carryForIngest`（`src/rework.ts`）で読み、時間が足りない時は 3 回まで先送りし、4 回目は読まずに取り込む（`src/jobs.ts` 1953〜1965 行）。`carryForIngest` は欠け・読めないを `null` にする。
- 本文: 取り込みが `files` から `parts/*.md|svg|html` を `texts` にする（`src/jobs.ts` 1969 行付近）。`stripMarkdownForCheck` は行内コード・囲みコードを**中身ごと**消す（禁止語の検査用）→ 丸写しの検査には使わない。
- 仕分け: `CheckKey` は 6 観点の列挙（`src/checks/triage.ts` 43 行）で、`terms_of_use`（利用条件）は自動の観点（`AUTO_ITEMS`）。項目の題は `ITEM_TITLE`、自動の直しの原因の集計は `ITEM_CAUSES`。承認の硬い止めは `src/routes/review.ts` 428〜460 行、公開の切り替えは `src/publish.ts` の `publishSwitch`。

## AK2-0 保証（有界）と範囲

1. 取り込みの時、**その session の `web_fetch` の結果の文**（sources.json に無い URL も含む。offload・エラー・非テキストは除く）と本文の見える文の間に、正規化後 **100 字以上の連続した一致**（引用の除外の後）があれば `checks.verbatim_copy` に記録し、仕分けが `terms_of_use` の `fix` 項目を出し、承認と公開は硬く止まる（`verbatim_copy_present`）。
2. 検査が最後まで済まなかった版（本文・ページの上限を超えた・作り直しの親の記録を読めなかった・候補の照合の上限に当たった）は `checks.verbatim_status = 'incomplete'` になり、**一致が 0 件でも承認と公開は止まる**（`verbatim_incomplete`）。0 件で済んだ版だけが `'clean'`。
3. 作り直し（rework）は、親の版の取得記録の文も同じ検査に掛ける。時間不足の先送りを使い切っても、この検査のための読み込みは省略しない（読めなければ 2）。
4. 一致のうち、**同じ URL の出典の `quoted_excerpt` の中に区間の全部が収まる**ものは除く。
5. 一致の区間に字（`\p{L}`）が 60 字以上含まれるものだけ（数字・記号・区切りだけの並びは対象外）。
6. ページの本文は保存しない。保存するのは一致の記録だけ（1 版 30 件まで・1 件の `sample` は 60 字・`text` は 1,000 字・`url` は 300 字まで。保存の大きさは 1 件およそ 4 KB 以下、30 件で 120 KB 以下。state 全体の既存の守り 1,500,000 bytes の内側）。
7. 検査は純関数 `src/checks/verbatim.ts`。LLM は使わない。
8. 範囲外: 言い換え・要約・99 字以下の分割・引用の適法性・検証係（§L-2）が取り込み後に開くページ・script から表示する文（app.html の script は §Forbidden の検査の範囲。見える文の抽出は script を落とす）。

## AK2-1 純関数（`src/checks/verbatim.ts`）

- 字の単位は **コードポイント**（`Array.from(s)`）。`start` / `length` もコードポイント。
- `normalizeForMatch(s)`: NFKC → ゼロ幅（U+200B〜U+200D・U+2060・U+FEFF）を除く → 小文字 → Unicode の空白の連続を 1 つの半角空白に → trim（この順）。
- `visibleTextOfMd(md)`: まず**コードの区間を切り出す**（囲みコード = ``` の行から次の ``` の行まで・行内コード = 対になった `` ` `` の間）。コードの区間の中身は**無加工で残す**（区切りの ``` の行と `` ` `` だけ除く）。コードの外の部分にだけ: リンク `[文](url)` は文だけ、画像 `![alt](url)` は alt だけ、強調・見出し・引用・箇条書きの記号（`*` `_` `~` `#` `>` 行頭の `-` `+` `数字.`）を除く、`[cN]` の印を除く。区間と行は元の順に空白でつなぐ。
- `visibleTextOfHtml(s)`: §AK の `textOfHtml`（script / style / コメントを落とし、タグを落とし、文字実体を復号）。`.svg` も同じ。`textOfHtml` が `null`（閉じていない構造）を返した本文は見える文が決まらないので、検査が済まないとして `verbatim_status = 'incomplete'` にする（fail-closed。その path は照合に入れない）。
- 本文: path を辞書順に並べ、各 path の見える文を `normalizeForMatch`。合計が 300,000 字を超えたら超えた分は見ず `incomplete`。
- `buildNeedles(bodies)`: 各本文の位置 i の W = 40 字の窓を、コードポイントの列の FNV-1a 32 bit（各コードポイントを UTF-32 の 4 byte として順に混ぜる）で hash → `Map<hash, Array<{path, pos}>>`（pos の昇順）。同じ hash の候補が 64 個を超えた窓（反復文字など）は 64 個までにし `incomplete`。
- `scanPage(needles, bodies, pageText, url, quotes): { hits: Hit[]; incomplete: boolean }`: ページを `normalizeForMatch`（200,000 字まで。超えたら `incomplete`）。i = 0 から、窓の hash の候補を pos の昇順に、字の列が本当に一致するか確かめ、一致なら前後に伸ばして最長の区間を取る（前はページの位置 i − 1 と本文の pos − 1 から 1 字ずつ・後ろも同じ）。区間（本文側の全文 `text` を持つ）について: 長さ 100 字以上・字 60 字以上でなければ捨てる → `quotes`（同じ URL の出典の `quoted_excerpt` を `normalizeForMatch` した列）のどれかが `text` を含めば捨てる → 残れば hit。**ページの位置は一致の有無にかかわらず i + 1 へ進む**（一致の区間の内側から始まる別の一致も調べる。同じ本文の区間は `mergeHits` が 1 つにする）。1 ページの照合の回数（候補の確かめ。前後に伸ばす 1 字を 1 回と数える）は 2,000,000 回まで（超えたら `incomplete`）。hit は `{path, start, length, url, sample: text の先頭 60 字, text: 区間の全文（1,000 字まで。超えたら先頭 1,000 字と `text_cut: true`）}`。
- `mergeHits(acc, more)`: 同じ path で区間が重なる hit は、範囲の和をとって 1 件にし、url は先に見つけた方を残す。順は path の辞書順 → start の昇順。30 件を超えたら 30 件で切る（数え上げは引用の除外の後なので、切っても状態は `found` のまま。`verbatim_total` に全件数を残す）。

## AK2-2 取り込みへの差し込み（`src/jobs.ts`・`src/checks/citations.ts`）

- `accumulateCitations(acc, sources, events, onResult?)`: 既存の対応の規則のまま、`web_fetch` の result を処理する時（`fetches` から URL を引いて消す直前）に、`onResult?.(url, text)` を呼ぶ（text は `resultText`。null・offload なら呼ばない）。出典照合の結果は変えない。
- `texts` の組み立てを events の走査の**前**に移し、`bodies` と `needles` を 1 回作る。
- events の各ページで `accumulateCitations(ev.acc, citeSources, p.data, (url, text) => { const r = scanPage(needles, bodies, text, url, quotesOf(url)); ev.verb.hits = mergeHits(ev.verb.hits, r.hits); ev.verb.total += r.hits.length; ev.verb.pages++; if (r.incomplete) ev.verb.incomplete = true; })`。`ev.verb = { v: 1, hits, total, pages, incomplete }` を `ev` と一緒に保存する（ページごとの `writeState` に含まれる）。旧形式の `ev`（`verb` が無い・`v` が違う）なら `cursor` / `acc` / `verb` / `grader` / `complete` を全部初期化して events を先頭から集計し直す（既存の規則と同じ単位）。
- 作り直し（`job.kind === 'rework'` かつ親あり）: 既存の引用の引き継ぎ（`carryForIngest` の先送りの規則）とは**別に**、次の 2 つを行う。
  - **親の検出の引き継ぎ**（D1 の親の版の `checks_json` を 1 回読む）: 親の `verbatim_status` が `'incomplete'` → 子も `incomplete`。親が `'found'` → 親の各 hit について、`text_cut` なら子は `incomplete`、そうでなければ `text` が子の正規化した本文（どれかの path）に含まれれば、その位置で hit（`url` は親の値・`carried: true`）。親に `verbatim_status` が無い（本契約の前の版）→ 引き継ぐものは無い。親の検出は孫へも同じ規則で伝わる（子の hit に残るため）。
  - **親の取得記録の検査**: AK2 専用の厳密な読み方 `readCapturesStrict(env, parent)`（R2 の 1 回の get → JSON → `v === 1`・`captures` が配列・各行の `url` と `text` が文字列・`text` の長さが 30,000 字未満（30,000 字ちょうどは切り詰めの疑い）・`missing` と `truncated` が空の配列。1 つでも外れたら記録全体を `incomplete`）。時間の残りが無ければ先送り（既存の `carry_defers` と同じ数え方で 3 回まで）、使い切ったら読まずに `incomplete`。記録が無い → `incomplete`。読めた記録の各 `{url, text}` に `scanPage` → `mergeHits`。既存の `readSourceCapturesFile`（引用の引き継ぎ用）は変えない。
  - 親の session で開いたが記録に残っていないページ（sources.json に無い URL）は、上の引き継ぎで捕まえる（親の検査が自分の session の全部の `web_fetch` を見ているため）。
- `checks` に `verbatim_copy`（hits）・`verbatim_total`・`verbatim_pages`・`verbatim_status`（`'found'` = 1 件以上 / `'incomplete'` = 0 件で未完了 / `'clean'`）を足す。1 件以上かつ未完了は `'found'`（止まる理由は同じ）。取り込みは止めない（既存の検査と同じ）。
- ログは既存の `{at:'ingest', …}` に `verbatim: <status>`・`verbatim_n: <total>`・`verbatim_pages` を足すだけ（本文・URL は出さない）。

## AK2-3 仕分けと承認

- `src/checks/triage.ts`: `verbatim_copy` の各件を `{kind:'check', key:'terms_of_use', severity:'fix', cause:'verbatim_copy', path, quote: sample}`。`verbatim_status` が `'incomplete'` なら 1 件 `{key:'terms_of_use', severity:'fix', cause:'verbatim_incomplete'}`。`ITEM_TITLE.verbatim_copy = '本文にページの文の丸写し（100 字以上）がある'`、`ITEM_TITLE.verbatim_incomplete = '丸写しの検査が最後まで済んでいない'`（`ITEM_CAUSES` に入り、自動の直しの返し文に出る）。
- 公開の止め（`src/publish.ts` の `publishSwitch` の共通の前提。承認・自動公開・戻し（rollback）で版を `available` にする全部の経路）: 版の `checks_json` の `verbatim_status` が `'clean'` でなければ拒否（`verbatim_copy_present` / `verbatim_incomplete`）。`verbatim_status` が無い版（本契約の前に取り込んだ版）は従来どおり通す（既に公開されている版を本契約で止めない。新しく取り込んだ版から効く）。
- `src/routes/review.ts` の承認: 上と同じ理由で 409（人が上書きできない = 直した版を作る）。
- 確認画面（`admin.js` の純関数 `verbatimHtml`）: 「丸写し: なし（検査済み）」/「丸写し: <件数>（path・sample・URL の host を esc して列挙）」/「丸写しの検査: 最後まで済んでいません」の 3 通り。キーの無い古い版は何も出さない。

## AK2-4 受け入れ（fake・vitest。`test/verbatim.test.ts` ほか）

1. `normalizeForMatch`: 全角英数・空白の連続・ゼロ幅（空白の間にあっても空白 1 つになる）・大文字・補助面の字（絵文字）・結合文字が 1 字に数えられない場合の長さ。
2. `visibleTextOfMd`: 行内コードの中身が残る / 囲みコードの中身が残る / `**強調**` の途中で分断されない / リンクの文・画像の alt が残り url は消える。
3. `scanPage`: 99 字 → なし / 100 字 → 1 件 / 字が 59 字 → なし / 60 字 → あり / 引用の 120 字の一致が 10 区間あり、その後に引用外の 120 字 → 引用外の 1 件が見つかる / 先頭 60 字だけ同じで末尾が違う 2 区間のうち引用に収まる方だけ除かれる / ページ 200,000 字超・本文 300,000 字超・同じ hash の候補 64 超・照合 200,000 回超 → `incomplete` / CJK と英語。
4. `mergeHits`: 重なりの併合・順・30 件で切っても `total` は全件数。
5. 取り込みの実経路（`rework-from-previous.test.ts` の作り。events の stub に `next` を使ってページを分ける）: use が 1 ページ目・result が 2 ページ目（間で `writeState` → JSON で復元 → 再開）でも 1 件見つかる / offload は飛ばす / 二重に数えない / 旧形式の `ev` から集計し直す / `checks_json.verbatim_status` が 3 通り出る / 出典照合の結果が従来と同じ（callback を足しても変わらない）。
6. 作り直し: 親の記録の文に一致 → 1 件 / 親の記録が無い・`text: null` の行がある・`text` が 30,000 字・`truncated` / `missing` がある・`v` が違う → `incomplete` / 先送りを使い切った → `incomplete` / **親が `found` で、本文を変えずに作り直した子 → 引き継いだ hit で `found`**（子の session では何も開かず、親の記録にもその URL が無い）/ 子が丸写しを書き直した → 引き継ぐ hit が無く `clean` / 親が `incomplete` → 子も `incomplete` / 親の hit が `text_cut` → 子は `incomplete`。
6-b. 走査: ページ `P`（すべて異なる字）に対し本文 a = `P[0:120]`（引用に収まる）と b = `P[20:140]`（収まらない）→ b の 1 件が見つかる / 最初の一致が 90 字で、その内側から始まる 100 字の一致 → 見つかる / md の行内コードの中の `_` 入りの 123 字がページと一致 → 見つかる。
7. 仕分け: `verbatim_copy` と `verbatim_incomplete` が `terms_of_use` の fix 項目になり、自動の直しの返し文（return_note）に原因が出る。
8. 公開: 承認が 409 / 自動公開が止まる / 戻しも止まる / `verbatim_status` の無い古い版は通る / `'clean'` は通る。
9. 表示: `verbatimHtml` の 3 通りと esc。
10. ログに本文・URL が無い。

## AK2-5 PR と着地

- PR-AK2 = 本契約の全部（§AK の PR-AK1 の**後**に着地。`jobs.ts` の同じ関数と `textOfHtml` に依存するため直列。AK1 着地後の HEAD で行番号を読み直す）。`contract-AK.md` の AK-8 の表の本文の行を本契約の経路（events を直接流し読み・`jobs.ts` と `citations.ts` に差し込み）に合わせて直す。`CONTRACT-factory.md` の §AK の段落に 1 文足す（v3.18）。職人の定義は変えない（`ant apply` 不要）。migration なし。deploy は `deploy-ref.sh`。
- deploy 後の確認: 次の取り込みのログに `verbatim: clean | found | incomplete` と `verbatim_pages` が出る（0 件だけでは検査が動いた証拠にならないので、`verbatim_pages` が 1 以上であることも見る）。

## 未確認の点

- 100 字・60 字（文字）の閾値は保守的な初期値。誤検出（公式の名称の列挙・自作の文の再掲）が出たら、閾値も除外規則も自動では変えず、別契約で根拠つきの例外を設ける。
- 検証係（§L-2）が開くページは対象外。将来、検証係の web_fetch の結果も同じ針で流し読みできる。
- `looksOffloaded`（4,000 字未満でファイルのパスを含む）は短い技術のページを誤って飛ばしうる（既存の判定。本契約はそのまま使う）。
