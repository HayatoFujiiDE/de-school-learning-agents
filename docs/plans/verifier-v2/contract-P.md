# §P 検証係の改善（取得記録・開き直しの節約・たとえ）（v3.10。2026-11-05 凍結）

起点: ふじさん 2026-11-05、版 ccf7045d（mc-redstone-basics）の確認画面への指示。
- 「検証用のエージェントでもうちょっと処理できる範囲はあると思う」
- 「学習者の理解のために比喩だったり、似た領域の概念、構造、経験と紐付けることは、このシステムにおいて極めて重要なので、そこは全然前提として作って大丈夫」
- 「厳密性としては、ここは完全にイコールじゃないみたいなところは、学びのマップのログとしては出した方がいいし、残した方がいい」

観測（版 ccf7045d の検証 1 回分。根拠は確認画面の API の verification / claims）:
- 25 件の claim のうち、confirmed は 1 件、unverified は 24 件だった。
- minecraft.wiki の s1・s3・s4・s5・s6 は、検証係の web_fetch で `url_not_accessible` になった。職人は制作中に同じ URL を web_fetch で開けている（sources.json には本文が返った URL だけを書く決まり。§D）。
- s2・s7・s8 は取得できたが、本文を照合する前に web_fetch の上限（VERIFY_MAX_FETCHES=25）に達した。理由欄を見ると、開けない URL を claim ごとに開き直している。
- minecraft.wiki が検証係の取得だけを拒んだ理由は、まだ確かめていない。サイト側の拒否・一時的な障害・取得の版の違いのどれかは区別できていない。このため本節は、理由が何であっても効く形にする。

## a. 保証（有界）

- P1: 検証係の入力に、版の sources.json の各出典について「制作時の取得記録」を入れる。取得記録とは、その版を作った制作 session の events にある、その URL（正規化して一致するもの）の web_fetch の tool_result 本文（text）である。記録が無い出典・容量で省いた出典は、その旨を 1 行で示す。
- P2: 検証係は、たとえ・似た概念への対応づけを「たとえとして成り立つか」で判定する。完全に同じではない点は、`analogy_gaps` に記録して保存する。たとえ自体を理由に claim を不利に判定しない。
- 範囲外:
  - 学びマップの画面（未実装）。本節は、マップが後で読めるデータを残すところまでとする。
  - 職人の定義の変更、配信 API の形の変更。
  - 検証係の web_fetch が minecraft.wiki で開けない原因の調査と解消。
  - VERIFY_MAX_FETCHES の値の変更。

## b. 制作時の取得記録（`src/verify.ts`）

1. 作る時: 検証の試行の入力を作る時（同期の `runAttempt`、Batch の最初のターンの送信）。R2 の `{r2_prefix}source-captures.json` が無ければ作り、あれば読む。
   - 作り方: 版の `session_id` の events を `port.listEventsPage(sid, {order:'asc'})` で最後までたどる。上限は 60 ページで、超えたら作らない。agent.tool_use の name が `web_fetch` で、input.url が sources の url と `normalizeUrl` で一致するものを拾う。対応する agent.tool_result が `is_error` でなく、本文の text（`checks/citations.ts` の `resultText` と同じ取り方。関数は export して使い回す）を持てば、その URL の記録とする。同じ URL が何度もあれば、いちばん長い本文を採る。
   - 形: `{"v":1,"captures":[{"source_id","url","chars","text"}],"missing":["s9",…],"truncated":["s3",…]}`。text は 1 出典 30,000 文字で切る。切ったものは truncated に入れる。
   - 作るのに失敗した時（events の取得エラー・ページ上限・session_id が無い）は、記録なし（captures 空・全出典 missing）で進める。試行は失敗させない。失敗した時は R2 に書かない（次の試行で作り直す）。
   - 一度書いたファイルは書き直さない。決定的にするためで、Batch の回収時の再計算には使わない。
2. 入力に入れる位置: `<sources_json>` の直後に `<source_captures>` … `</source_captures>` を置く。各出典は `## {source_id} {url}（制作時の取得記録。web_fetch ツールが返した本文で、職人が書いたものではない）` と本文。記録が無い出典は `## {source_id} {url}（制作時の取得記録なし）`。
3. 容量: 取得記録の text の合計は 120,000 文字まで。source_id 順に入れ、入らないものは「（容量のため省略）」の 1 行にする。さらに入力全体が `VERIFY_INPUT_CHAR_LIMIT` を超える時は、取得記録を後ろから省いて収める。取得記録は補助なので、取得記録のせいで `input_too_large` にしない。取得記録を全部省いても超える時だけ、従来どおり `input_too_large` にする。
4. system に次の段落を足す。入れる場所は、既存の「各 claim について、出典の URL を web_fetch で開き直し…」の段落の直後:
   ```
   同じ URL は 1 回だけ開き、その結果をその出典を使う全 claim に使い回してください。開けなかった URL を開き直さないでください。
   web_fetch で開けない、または上限で開けない出典は、<source_captures> の制作時の取得記録（制作中に web_fetch ツールが返した本文。職人が書いた文ではない）と照らして判定してかまいません。その場合は reason の先頭に「制作時の取得記録で確認:」と書き、opened_urls には入れないでください。取得記録も無ければ unverified です。
   ```
5. meta（`VerifyMeta`）に `captures: {used: number, missing: number, truncated: number}` を足す（数だけ）。

## c. たとえ（`src/verify.ts` の system・schema・保存、review API、admin）

1. system に次の段落を足す。入れる場所は、判定の 4 択の段落の直後:
   ```
   この素材は学習者の理解のために、たとえ（比喩）や、似た領域の概念・仕組み・体験との対応づけを意図して使います。これは素材の大事な方法です。
   たとえや対応づけを述べる claim は「たとえとして成り立つか」で判定します。つまり、対応づけた点がそれぞれの側で事実として正しいか、たとえだと分かる書き方かを見ます。二つが完全に同じでないことだけを理由に hypothesis / contradicted にしないでください。たとえを「同じものだ」と断定して誤解を招く書き方の時だけ hypothesis にし、reason にその点を書きます。
   たとえ・対応づけで完全には同じでない点（違い・成り立たない範囲）は、claim に関係なく、素材の本文・図の中のものも含めて analogy_gaps に 1 件ずつ書きます。学習者が後で「ここは同じ、ここは違う」と振り返る記録として残します。
   ```
2. `VERDICT_SCHEMA` に required の `analogy_gaps` を足す（strict のまま）:
   `{type:'array', items:{type:'object', properties:{claim_id:{type:'string'}, where:{type:'string'}, analogy:{type:'string'}, same:{type:'string'}, differs:{type:'string'}}, required:['claim_id','where','analogy','same','differs'], additionalProperties:false}}`
   - claim_id: 関係する claim の id。無ければ空文字。
   - where: 本文・図の path。無ければ空文字。
   - analogy: 何を何にたとえたか。
   - same: 対応している点。
   - differs: 完全には同じでない点。
3. `validateVerdicts`: analogy_gaps が無い時は [] として扱う（deploy 前の Batch 結果と互換にするため）。配列でない時は null（`claim_set_mismatch`）にする。各要素の文字列でないフィールドは空文字にする。各フィールドは 1000 字で切り、件数は 50 件で切る。claim_id は検査しない（ログなので落とさない）。
4. 保存: `VerdictReport.analogy_gaps` として `verifications.result_json` に入る。列は変えない。学びマップは、後でこれ（版の最新の verification の result_json.analogy_gaps）を読む。
5. review API: `verification.analogy_gaps: [...] | null`。null になるのは、result_json に無い古い検証。
6. 確認画面: 「説明と表現」の行の下に、`<details>` で「たとえのずれ N 件（学びマップに残す記録）」を出す。0 件や null の時は出さない。各項目は 1 行で「{analogy}: 同じ = {same} / 違う = {differs}」とし、claim_id と where があれば小さく添える。エスケープする。承認・キー・triage は変えない。

## d. 受け入れ（vitest）

1. 取得記録:
   - events（fake port）に、2 出典の web_fetch use と result を入れる。片方は is_error、もう片方は本文あり。同じ URL を 2 回取った時は長い方を採る。これで source-captures.json が作られ、入力に `<source_captures>` が入り、記録なしの行も出ることを確かめる。
   - 2 回目の試行では events を読まない。port の呼び出し回数で確かめる。
   - events の取得がエラーの時は、記録なしで試行が進み、R2 に書かれないことを確かめる。
   - 30,000 字の切り詰めと 120,000 字の上限を確かめる。
   - 入力全体の上限を超える時は、取得記録を省いて成功し、取得記録が無くても超える時だけ input_too_large になることを確かめる。
2. Batch の最初のターンの会話 JSON に取得記録が入る。回収（collect）は events を読まない。
3. analogy_gaps について、次を確かめる。
   - あれば保存される。
   - 無ければ [] になる。
   - 配列でなければ mismatch になる。
   - 長い文字列は切られる。
   - review API が返す（古いものは null）。
4. system の新しい 2 段落が、既存の文を変えずに入っている（文字列の一致）。
5. 既存のテストがすべて green であること。tsc と npm test の結果は verdict の行だけを報告する。新しいテストが変更前のコードで落ちることを確かめる（mutation）。

## e. 範囲

触るもの:
- `factory/worker/src/verify.ts`
- `src/checks/citations.ts`（resultText の export だけ）
- `src/routes/review.ts`
- `public/admin/admin.js`（と必要なら admin.css）
- `src/fake/anthropic.ts`（fake の検証係の応答に analogy_gaps: [] を足す・events の fake）
- test/

触らない:
- migration
- jobs.ts の取り込み
- 職人の定義
- wrangler.jsonc
- 契約文書（司令塔が直す）
