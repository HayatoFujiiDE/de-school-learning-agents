# §AK2 本文の丸写しの検査（`verbatim_copy`）: 職人が開いたページの文を 100 字以上そのまま本文に入れた版は公開できない（2026-11-07 凍結 v3 / 2026-11-08 v3.1・v3.2・v4）

ふじさんの指示（2026-11-07）: 「エビデンスをもとに、絶対に権利の侵害がない形で工場が動くように。決定論的に」。§AK（`contract-AK.md`）は立体モデルの複製・埋め込みを門番で守る。本契約はその AK-8 の次段 PR-AK2: **本文（.md / app.html / .svg の見える文）に、職人が session で開いたページの文の丸写しが無いこと**を、取り込みの時に機械で確かめる。引用の適法性（著作権法 32 条）の判定はしない（AK-8 のとおり保証の範囲外）。「長い一致 = 丸写し」を検出して止める手段である。

レビューの経緯: Astra medium 1 回目 REVISE（BLOCKING 6）→ v2 で全部に対応: (1) ページをまたぐ `web_fetch` の use → result の対応を、出典照合と**同じ解決済みの result** から受け取る（`accumulateCitations` が result ごとに呼ぶ callback を足す。対応表は 1 つだけ）(2) 上限は引用の除外の**後**で数え、未検査の部分が残った版は「なし」ではなく `verbatim_incomplete` として公開を止める (3) 本文の抽出は**見える文を全部**（行内コード・囲みコードの中身も残し、強調などの記号だけ除く）(4) 引用の除外は走査の中で区間の全文を見て行う (5) 作り直しの親の記録の検査は時間不足でも省略しない（読めなければ `verbatim_incomplete`）(6) 仕分けの観点は既存の `terms_of_use`（利用条件）。NON-BLOCKING も採る（字の単位はコードポイント・正規化の順序・保存の大きさの見積り・`MAX_PAGES` 500 の実数・反復文字の性能の上限・publishSwitch の対象・表示の 3 状態）。Astra medium 2 回目 REVISE（6 件のうち 3 件は閉鎖・新しく 4 件）→ 予算の 2 往復を使い切ったので司令塔の裁定で v3 として凍結: (B1) 一致のあとに位置を飛ばさず**ページの全部の位置**を調べ、重なりは `mergeHits` で 1 つにする (B2) md は**コードの区間を先に切り出して中身を無加工で残し**、記号の除去とリンクの変換はコードの外にだけ掛ける (B3) 作り直しは**親の版の検出をそのまま引き継ぐ**（親の hit の区間の全文が子の本文にまだあれば hit。親が `incomplete` なら子も `incomplete`）。検出した区間の全文を hit に保存する (B4) 親の取得記録は AK2 専用の厳密な読み方で読み、壊れた行・切り詰めの疑い・`missing` / `truncated` が 1 つでもあれば `incomplete`。v3.1（2026-11-08・実装時）: AK1 の textOfHtml の null の扱い — §AK（PR-AK1）で `textOfHtml` が閉じていない構造に `null` を返すようになったので、その本文を AK2-1 で `incomplete` にすると 1 文足した。

v3.2（2026-11-08 司令塔の裁定）: 作り直しの親の取得記録は `missing` が空でなくても未完了にしない（YouTube の出典と、その session で開かなかった出典は必ず `missing` に入るため、動画つきの素材の作り直しが永久に公開できなくなっていた）。`truncated`・壊れた行・記録が無いは従来どおり未完了。親が本契約の後に取り込まれた版（`verbatim_status` あり）なら、親の session の `web_fetch` は全部その時に走査済みなので、取得記録は読まず検出の引き継ぎだけで足りる（先送りを使い切っても未完了にしない）。

v4（2026-11-08）: Astra 実装レビュー（high）の BLOCKING 3 件 → 司令塔の裁定。(B1) 親の検出（hit の全文）を引き継ぐだけでは、子が 1 字削った丸写し・保存の 30 件を超えた 31 件目・親のページの上限より後ろの未走査の部分を判定できない → 作り直しは**親の版が見たページの文を R2 の記録 `{prefix}verbatim-pages.json` から読み、子の本文でもう一度照らす**（親の検出の引き継ぎ・「親が incomplete なら子も」「`text_cut` なら incomplete」の規則は消す。止めから抜ける出口は作り直しで丸写しを消すこと）(B2) 見える文の抽出が区切りに空白を入れるため、行内コード・隣り合う span / tspan で区切った丸写しや `<xmp>` の中を見落とした → **本文 1 つを 2 つの読み方**（区切りに空白を入れる spaced / 何も入れない joined）で照らす (B3) 引用の除外を子の sources で評価し直していなかった → 再照合なので**子の** `quoted_excerpt` で除く。NON-BLOCKING: 区間の前後の空白を取ってから引用と比べる・`verbatim_incomplete` を独立に保存・戻しの拒否理由を返す・保存の見積りを実測に合わせる。v3.2 の「親が走査済みなら取得記録は読まない」は「親の記録 verbatim-pages.json を読む」に置き換わる（`missing` を未完了にしない規則は、本契約の前の親の取得記録を読む経路にそのまま残る）。

## 実測した事実（repo。2026-11-07）

- 出典照合（`src/checks/citations.ts`）は純関数で、取り込み（`src/jobs.ts` 1930 行付近）が session の events を古い順にページ単位で流し込む（`accumulateCitations(ev.acc, citeSources, p.data)`。ingest の 1 回の呼び出しで `MAX_PAGES` = 500 ページまで）。`fetches` に未対応の `web_fetch` の use を保存し、result を処理したら消す（ページをまたいでも対応できる）。`resultText(ev)` が result の本文（text block と document block）を返す。本文は保存しない（`CitationAcc` は URL 単位の旗だけ。`reconcile_state_json` に保存。state 全体の大きさには既存の 1,500,000 bytes の守りがある）。
- 取得記録（§P。`src/verify.ts` 610〜850 行）は検証係が最初に動く時に R2 `{prefix}source-captures.json` へ書く（1 出典 30,000 字まで・sources.json の URL だけ・YouTube は除く）。取り込みの時点では無い。作り直しは親の版の記録を `carryForIngest`（`src/rework.ts`）で読み、時間が足りない時は 3 回まで先送りし、4 回目は読まずに取り込む（`src/jobs.ts` 1953〜1965 行）。`carryForIngest` は欠け・読めないを `null` にする。
- 本文: 取り込みが `files` から `parts/*.md|svg|html` を `texts` にする（`src/jobs.ts` 1969 行付近）。`stripMarkdownForCheck` は行内コード・囲みコードを**中身ごと**消す（禁止語の検査用）→ 丸写しの検査には使わない。
- 仕分け: `CheckKey` は 6 観点の列挙（`src/checks/triage.ts` 43 行）で、`terms_of_use`（利用条件）は自動の観点（`AUTO_ITEMS`）。項目の題は `ITEM_TITLE`、自動の直しの原因の集計は `ITEM_CAUSES`。承認の硬い止めは `src/routes/review.ts` 428〜460 行、公開の切り替えは `src/publish.ts` の `publishSwitch`。

## AK2-0 保証（有界）と範囲

1. 取り込みの時、**その session の `web_fetch` の結果の文**（sources.json に無い URL も含む。offload・エラー・非テキストは除く）と本文の見える文の間に、正規化後 **100 字以上の連続した一致**（引用の除外の後）があれば `checks.verbatim_copy` に記録し、仕分けが `terms_of_use` の `fix` 項目を出し、承認と公開は硬く止まる（`verbatim_copy_present`）。
2. 検査が最後まで済まなかった版（本文・ページの上限を超えた・作り直しの親の記録を読めなかった・候補の照合の上限に当たった・この版のページの記録を R2 に書けなかった）は `checks.verbatim_status = 'incomplete'` になり、**一致が 0 件でも承認と公開は止まる**（`verbatim_incomplete`）。0 件で済んだ版だけが `'clean'`。未完了は `checks.verbatim_incomplete`（真偽値）にも独立に残す（`found` かつ未完了を区別する）。
3. 作り直し（rework）は、**親の版が見たページの文**（親の `verbatim-pages.json`。祖先の分も推移的に入っている。親が本契約の前の版なら親の取得記録）を、**子の本文と子の引用**で同じ検査にもう一度掛ける。親の検出は引き継がない。時間不足の先送りを使い切った・親の記録が無い・壊れている・`truncated` なら 2。
4. 一致のうち、**同じ URL の出典の `quoted_excerpt` の中に区間の全部（前後の空白を取ったもの）が収まる**ものは除く。作り直しの再照合では子の sources の引用で除く。
5. 一致の区間に字（`\p{L}`）が 60 字以上含まれるものだけ（数字・記号・区切りだけの並びは対象外）。
6. ページの本文は D1（`reconcile_state_json`・`checks_json`）には保存しない。D1 に保存するのは一致の記録だけ（1 版 30 件まで・1 件の `sample` は 60 字・`text` は 1,000 字・`url` は 300 字まで。保存の大きさは 1 件 5 KB 以下、30 件で 150 KB 以下（補助面の字 1,000 字の hit の実測 4,622 bytes）。state 全体の既存の守り 1,500,000 bytes の内側）。ページの文（正規化後）は**検査のためだけに** R2 の版の場所 `{prefix}verbatim-pages.json` に置く（既存の取得記録 `source-captures.json` と同じ扱い。学習者・画面・API には出さない。配信は `public_paths_json` の path だけ）。理由: 作り直しが子の本文と子の引用で照らし直すには、親が見たページの文そのものが要る（親の検出の記録だけでは、1 字削った丸写し・31 件目・未走査の部分を判定できない。v4 B1）。
7. 検査は純関数 `src/checks/verbatim.ts`。LLM は使わない。
8. 範囲外: 言い換え・要約・99 字以下の分割・引用の適法性・検証係（§L-2）が取り込み後に開くページ・script から表示する文（app.html の script は §Forbidden の検査の範囲。見える文の抽出は script を落とす）。

## AK2-1 純関数（`src/checks/verbatim.ts`）

- 字の単位は **コードポイント**（`Array.from(s)`）。`start` / `length` もコードポイント。
- `normalizeForMatch(s)`: NFKC → ゼロ幅（U+200B〜U+200D・U+2060・U+FEFF）を除く → 小文字 → Unicode の空白の連続を 1 つの半角空白に → trim（この順）。
- 本文は **2 つの読み方**で照らす（v4 裁定 2。どちらかで当たれば hit）: `spaced`（区間・タグの境目に空白を入れる。下の既定）と `joined`（区切りに何も入れない。描画のつながりと合わせる）。joined が spaced と一字も違わない本文は spaced だけ。hit に `view: 'spaced' | 'joined'` を付け、`path`・`start`・`length` は当たった読み方の文での位置。
- `visibleTextOfMd(md, view)`: まず**コードの区間を切り出す**（囲みコード = ``` の行から次の ``` の行まで・行内コード = 対になった `` ` `` の間）。コードの区間の中身は**無加工で残す**（区切りの ``` の行と `` ` `` だけ除く）。コードの外の部分にだけ: リンク `[文](url)` は文だけ、画像 `![alt](url)` は alt だけ、強調・見出し・引用・箇条書きの記号（`*` `_` `~` `#` `>` 行頭の `-` `+` `数字.`）を除く、`[cN]` の印を除く。spaced は区間と行を元の順に空白でつなぐ。joined は同じ行の中の区間を空白なしでつなぎ（描画は行内コードの前後に空白を入れない）、行と行の間だけを空白にする。
- `visibleTextOfHtml(s, view)`: spaced は §AK の `textOfHtml`（script / style / コメントを落とし、タグを落とし、文字実体を復号。タグの境目は空白）。joined は `parseHtml` の text の token を区切りなしでつなぎ、生テキスト要素は script と style 以外を中身ごと入れる（xmp・textarea・noscript・iframe・noembed・noframes・title。title は実体を復号）。comment は入れない。`.svg` も同じ。`textOfHtml` が `null`（閉じていない構造）を返した本文は見える文が決まらないので、検査が済まないとして `verbatim_status = 'incomplete'` にする（fail-closed。その path は照合に入れない）。
- 本文: path を辞書順に並べ、各 path の見える文を 2 つの読み方で `normalizeForMatch`。合計（2 つの読み方の合計）が 300,000 字を超えたら超えた分は見ず `incomplete`。
- `buildNeedles(bodies)`: 各本文の位置 i の W = 40 字の窓を、コードポイントの列の FNV-1a 32 bit（各コードポイントを UTF-32 の 4 byte として順に混ぜる）で hash → `Map<hash, Array<{unit, pos}>>`（unit = 本文の読み方の番号。pos の昇順）。同じ hash の候補が 64 個を超えた窓（反復文字など）は 64 個までにし `incomplete`。
- `scanPage(needles, bodies, pageText, url, quotes): { hits: Hit[]; incomplete: boolean }`: ページを `normalizeForMatch`（200,000 字まで。超えたら `incomplete`）。i = 0 から、窓の hash の候補を pos の昇順に、字の列が本当に一致するか確かめ、一致なら前後に伸ばして最長の区間を取る（前はページの位置 i − 1 と本文の pos − 1 から 1 字ずつ・後ろも同じ）。区間（本文側の全文 `text` を持つ）について: 長さ 100 字以上・字 60 字以上でなければ捨てる → `quotes`（同じ URL の出典の `quoted_excerpt` を `normalizeForMatch` した列）のどれかが `text` の前後の空白を取ったものを含めば捨てる → 残れば hit。**ページの位置は一致の有無にかかわらず i + 1 へ進む**（一致の区間の内側から始まる別の一致も調べる。同じ本文の区間は `mergeHits` が 1 つにする）。1 ページの照合の回数（候補の確かめ。前後に伸ばす 1 字を 1 回と数える）は 2,000,000 回まで（超えたら `incomplete`）。hit は `{path, view, start, length, url, sample: text の先頭 60 字, text: 区間の全文（1,000 字まで。超えたら先頭 1,000 字と `text_cut: true`）}`。
- `mergeHits(acc, more)`: 同じ path・同じ読み方で区間が重なる hit は、範囲の和をとって 1 件にし、url は先に見つけた方を残す。順は path の辞書順 → 読み方（spaced → joined）→ start の昇順。30 件を超えたら 30 件で切る（数え上げは引用の除外の後なので、切っても状態は `found` のまま。`verbatim_total` に全件数を残す）。

## AK2-2 取り込みへの差し込み（`src/jobs.ts`・`src/checks/citations.ts`）

- `accumulateCitations(acc, sources, events, onResult?)`: 既存の対応の規則のまま、`web_fetch` の result を処理する時（`fetches` から URL を引いて消す直前）に、`onResult?.(url, text)` を呼ぶ（text は `resultText`。null・offload なら呼ばない）。出典照合の結果は変えない。
- `texts` の組み立てを events の走査の**前**に移し、`bodies` と `needles` を 1 回作る。
- events の各ページで `accumulateCitations(ev.acc, citeSources, p.data, (url, text) => { const r = scanPage(needles, bodies, text, url, quotesOf(url)); ev.verb.hits = mergeHits(ev.verb.hits, r.hits); ev.verb.total += r.hits.length; ev.verb.pages++; if (r.incomplete) ev.verb.incomplete = true; })`。callback はページの文（`normalizeForMatch` 後・200,000 字まで。超えたら `lost`）も集め、events の 1 ページ分を R2 `{prefix}verbatim-pages.parts/<parts>.json` に置いてから（置けなければ `lost` かつ `incomplete`）`parts` を進める。`ev.verb = { v: 2, hits, total, pages, incomplete, parts, lost }` を `ev` と一緒に保存する（ページごとの `writeState` に含まれる）。旧形式の `ev`（`verb` が無い・`v` が違う）なら `cursor` / `acc` / `verb` / `grader` / `complete` を全部初期化して events を先頭から集計し直す（既存の規則と同じ単位）。
- **この版のページの記録**（v4 裁定 1）: events の走査が済んだら、`verbatim-pages.parts/` の記録と、作り直しなら親の分（下）を `{v:1, pages:[{url, text}], truncated}` にまとめて R2 `{prefix}verbatim-pages.json` に書く。同じ url で同じ text のものは 1 つ。合計が 3,000,000 字を超えたら超えた分は入れず `truncated: true`。入れられなかった文がある時（ページの上限で切った・途中の記録を読めない・親の記録を読めなかった / 親の記録が `truncated`）も `truncated: true`。書けなければこの版は `incomplete`（fail-closed）。版を書いた後、途中の記録は消す（失敗しても残るだけ）。
- 作り直し（`job.kind === 'rework'` かつ親あり）: 既存の引用の引き継ぎ（`carryForIngest` の先送りの規則）とは**別に**、親の版の `r2_prefix` と `checks_json` を D1 から 1 回読み、親が見たページの文を**子の本文と子の引用**で照らし直す（親の検出は引き継がない）。時間の残りが無ければ先送り（既存の `carry_defers` と同じ数え方で 3 回まで）、使い切ったら読まずに `incomplete`。
  - 親の `{prefix}verbatim-pages.json` を R2 から 1 回読み、各ページに `scanPage`（`quotesOf` は子の sources）→ `mergeHits`。読んだページはこの版の記録にも入れる（孫が祖先の分も照らせる）。形が壊れている（`v === 1`・`pages` が配列・各行の `url` と `text` が文字列・`truncated` が真偽値でない）・`truncated: true` → `incomplete`。
  - 親の記録が無い: 親に `verbatim_status` が無い（本契約の前の版）なら、AK2 専用の厳密な読み方 `readCapturesStrict(env, parent)` で親の取得記録を読む（R2 の 1 回の get → JSON → `v === 1`・`captures` が配列・各行の `url` と `text` が文字列・`text` の長さが 30,000 字未満（30,000 字ちょうどは切り詰めの疑い）・`truncated` が空の配列。`missing` は空でなくてよい（v3.2）。外れた・記録が無い → `incomplete`）。読めた記録の各 `{url, text}` に `scanPage` → `mergeHits`、この版の記録にも入れる。親に `verbatim_status` がある → `incomplete`。既存の `readSourceCapturesFile`（引用の引き継ぎ用）は変えない。
- `checks` に `verbatim_copy`（hits）・`verbatim_total`・`verbatim_pages`・`verbatim_status`（`'found'` = 1 件以上 / `'incomplete'` = 0 件で未完了 / `'clean'`）・`verbatim_incomplete`（真偽値）を足す。1 件以上かつ未完了は `'found'`（止まる理由は同じ）。取り込みは止めない（既存の検査と同じ）。
- ログは既存の `{at:'ingest', …}` に `verbatim: <status>`・`verbatim_n: <total>`・`verbatim_pages` を足すだけ（本文・URL は出さない）。

## AK2-3 仕分けと承認

- `src/checks/triage.ts`: `verbatim_copy` の各件を `{kind:'check', key:'terms_of_use', severity:'fix', cause:'verbatim_copy', path, quote: sample}`。`verbatim_status` が `'incomplete'` なら 1 件 `{key:'terms_of_use', severity:'fix', cause:'verbatim_incomplete'}`。`ITEM_TITLE.verbatim_copy = '本文にページの文の丸写し（100 字以上）がある'`、`ITEM_TITLE.verbatim_incomplete = '丸写しの検査が最後まで済んでいない'`（`ITEM_CAUSES` に入り、自動の直しの返し文に出る）。
- 公開の止め（`src/publish.ts` の `publishSwitch` の共通の前提。承認・自動公開・戻し（rollback）で版を `available` にする全部の経路）: 版の `checks_json` の `verbatim_status` が `'clean'` でなければ拒否（`verbatim_copy_present` / `verbatim_incomplete`）。`verbatim_status` が無い版（本契約の前に取り込んだ版）は従来どおり通す（既に公開されている版を本契約で止めない。新しく取り込んだ版から効く）。
- `src/routes/review.ts` の承認: 上と同じ理由で 409（人が上書きできない = 直した版を作る）。`src/routes/materials.ts` の戻しも `publishSwitch` の理由を捨てずに 409 の `error` にする（画面は `ERROR_TEXT` の文を出す）。
- 確認画面（`admin.js` の純関数 `verbatimHtml`）: 「丸写し: なし（検査済み）」/「丸写し: <件数>（path・sample・URL の host を esc して列挙）」/「丸写しの検査: 最後まで済んでいません」の 3 通り。found かつ `verbatim_incomplete` は「丸写し: <件数> 件（検査は最後まで済んでいません）」。キーの無い古い版は何も出さない。

## AK2-4 受け入れ（fake・vitest。`test/verbatim.test.ts` ほか）

1. `normalizeForMatch`: 全角英数・空白の連続・ゼロ幅（空白の間にあっても空白 1 つになる）・大文字・補助面の字（絵文字）・結合文字が 1 字に数えられない場合の長さ。
2. `visibleTextOfMd`: 行内コードの中身が残る / 囲みコードの中身が残る / `**強調**` の途中で分断されない / リンクの文・画像の alt が残り url は消える。2-b（v4 B2）: 異なる字の 150 字 `P` を、md の「先頭 50 字 + `中央 50 字` + 末尾 50 字」・html の隣り合う span・svg の隣り合う tspan・`<xmp>`・`<noscript>`・`<textarea>`・`<title>` で書いた本文 → 1 件。script・style・comment の中は入れない。引用の前後の空白だけの違いでは除外が外れない。
3. `scanPage`: 99 字 → なし / 100 字 → 1 件 / 字が 59 字 → なし / 60 字 → あり / 引用の 120 字の一致が 10 区間あり、その後に引用外の 120 字 → 引用外の 1 件が見つかる / 先頭 60 字だけ同じで末尾が違う 2 区間のうち引用に収まる方だけ除かれる / ページ 200,000 字超・本文 300,000 字超・同じ hash の候補 64 超・照合 200,000 回超 → `incomplete` / CJK と英語。
4. `mergeHits`: 重なりの併合・順・30 件で切っても `total` は全件数。
5. 取り込みの実経路（`rework-from-previous.test.ts` の作り。events の stub に `next` を使ってページを分ける）: use が 1 ページ目・result が 2 ページ目（間で `writeState` → JSON で復元 → 再開）でも 1 件見つかる / offload は飛ばす / 二重に数えない / 旧形式の `ev` から集計し直す / `checks_json.verbatim_status` が 3 通り出る / 出典照合の結果が従来と同じ（callback を足しても変わらない）。
6. 作り直し: 本契約の前の親の取得記録の文に一致 → 1 件 / その記録が無い・`text: null` の行がある・`text` が 30,000 字・`truncated` がある・`v` が違う → `incomplete`（`missing` は未完了にしない）/ 先送りを使い切った → `incomplete` / 親の `verbatim-pages.json` のページに一致 → 1 件・その記録が壊れている・`truncated` → `incomplete`・親に `verbatim_status` があるのに記録が無い → `incomplete` / 自分の記録を書けない → `incomplete`。6-c（v4 B1・B3 の再現。親は本当の取り込みで作る）: 親の 220 字の丸写しの先頭 1 字を削った子 → `found` / 親の 31 件目だけ残した子 → `found` / 親は P を検出・ページの上限の後ろの Q は未走査 → Q だけ残した子は `clean` にならない / 親が `found` → 子で全文の引用を足す → `clean` / 親が引用の除外で `clean` → 子で引用を外す → `found` / 子が書き直す → `clean`、孫が祖父母のページの文を写す → `found`。
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
