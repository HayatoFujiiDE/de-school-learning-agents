# §O-12 検証係が図・画像を見る（v3.9.1。2026-11-05 凍結）

起点: ふじさんの指示（2026-11-05）「検証係は図を見ませんとなってるけど図見てちゃんとチェックするようにして」。
§O-0 範囲外の「検証係が画像を見ること」と、§L-6 4 の「（検証係は図を見ない）」を本節で置き換える。§O-7（旧 §M-2-7 5）の画像の説明行は残し、画像そのものも渡す。

## a. 目的と保証（有界）

- 検証係（`src/verify.ts`、Opus 5.5、同期・Batch の両方）は、版の `parts/**` にある **png / webp を画像ブロックとして見て**、**svg はソース本文（既存どおり parts に入っている）を図として読み**、図ごとに判定を返す。
- 保証は次の 2 つだけ:
  - F1: 検証が成功した版では、版の parts/** にある svg / png / webp の **path すべて**に、`figures[]` の判定が 1 件ずつある（検証係が見た図は検証係の判定、容量で見せなかった png / webp は Worker が `not_seen` を付ける）。
  - F2: 検証係に渡す画像の生バイトの合計は `VERIFY_IMAGE_BYTES_LIMIT = 10 * 1024 * 1024` 以下（Worker のメモリ 128 MB と、Batch で会話 JSON を R2 に毎ターン書く経路を守る）。
- 図の判定は**人の確認を置き換えない**。「説明と表現」は引き続き人が図をすべて見る項目（§L-6 4）。triage（§L-5）・自動差し戻し・floor の判定は変えない。
- 範囲外: svg のラスタ化（Workers で描画しない。ソースで読む）、Files API での受け渡し、図の判定による自動差し戻し、職人（material-maker）の定義の変更。

## b. 入力（`buildUserContent` の戻り値を string → content block の配列へ）

1. 図の一覧: `parts/` を R2 で列挙し（既存 `listPartPaths` と同じ上限 500 件・同じ列挙）、拡張子 `.svg` `.png` `.webp` の path を昇順に並べたものを **figures 集合**とする。本文として入れるのは従来どおり `.md` `.html` `.svg`（変更なし）。
2. 見せる画像: figures 集合のうち `.png` `.webp` を path 昇順に R2 から読み、生バイトの累計が F2 の上限を超えない範囲で先頭から採る。超えるものは「見せない」（その path は `not_seen`）。一覧にある key が get で読めなければ従来どおり `part_missing`（terminal）。media_type は拡張子から（png → `image/png`、webp → `image/webp`）。base64 はチャンクで作る（大きな文字列連結や spread で stack を溢れさせない）。
3. content の並び（1 つの user message。Batch の会話 JSON も同じ形）:
   1. text: 既存の前置き・`<claims_json>`・`<sources_json>`・`<parts>` …`</parts>`（変更なし）
   2. text: 見出し `# 図・画像（あなたが確かめる図。svg は上の parts の本文、png / webp はこの後の画像）` と、figures 集合の各 path を 1 行ずつ。行の形:
      - 生成した画像（material.json の files[] に image_id があるもの）: 既存の `- {path}: 正確さ={accuracy}、prompt={prompt}、alt={alt}`
      - それ以外の svg / png / webp: `- {path}`（material.json の files[] に alt があれば `: alt={alt}`）
      - 見せない画像は行末に `（容量のため画像は渡していません。判定に含めない）`
   3. 見せる画像ごとに text `## 画像 {path}` → image block（`{type:'image', source:{type:'base64', media_type, data}}`）
   4. text: 末尾の指示 `各 claim を出典を開き直して判定し、figures の各図（容量のため渡していない画像を除く）も判定して、最後に必ず report_verdicts を 1 回呼ぶ`
4. 文字数上限 `VERIFY_INPUT_CHAR_LIMIT` は text block の合計で数える（画像は F2 で別に数える）。既存の imageLines（生成画像の行）の `part_missing` 条件はそのまま。
5. 図が 0 枚の版は 3-2・3-3 を出さず、末尾の指示も従来の文のまま（figures は空配列を要求）。

## c. system と report の形

- `VERIFIER_SYSTEM` に次の段落を足す（既存の文は変えない。最後の「report_verdicts を必ず 1 回だけ」の行の前に入れる）:
  ```
  図・画像（svg のソース、png / webp の画像）も 1 枚ずつ確かめます。見るのは次の点です: 本文・claims・出典と食い違う描写や数値・ラベル・文字がないか、alt や説明と絵が合っているか、正確さ=scientific の絵が事実として誤った形や仕組みを描いていないか、学習者（小中学生）に不適切な表現がないか。
  図ごとに次のどれか 1 つを判定します:
  - ok: 本文・出典と合っていて、誤りや不適切な表現が見つからない
  - problem: 誤り・食い違い・不適切な表現がある（reason に場所と内容を書く）
  - unclear: 絵が不鮮明、または本文・出典だけでは正しいか決められない
  figures には、渡された図・画像の一覧の path（容量のため渡していない画像を除く）をちょうど 1 回ずつ含めます。図が無ければ空配列です。
  ```
- `VERDICT_SCHEMA` に required の `figures` を足す（strict のまま）:
  `figures: { type:'array', items: { type:'object', properties: { path:{type:'string'}, verdict:{type:'string', enum:['ok','problem','unclear']}, reason:{type:'string'} }, required:['path','verdict','reason'], additionalProperties:false } }`
- `validateVerdicts(input, claimIds, figurePaths)`: claims の検査は従来どおり。figures が無い（deploy 前に出した Batch の結果など）は空配列として扱い、ある時は配列・各要素の path が文字列で重複なし・verdict が enum・**path 集合が「見せた図」（figures 集合 − not_seen）と完全一致**。外れたら null → 理由 `claim_set_mismatch` のまま（再試行の扱いも同じ。新しい理由コードは作らない）。reason は 2000 字で切る。
- 保存する `VerdictReport.figures` は、検証係の判定に、Worker が `not_seen` の各 path を `{path, verdict:'not_seen', reason:''}` で足し、path 昇順に並べたもの（F1）。`verifications.result_json` に入る。列（confirmed 等の数）は変えない。
- Batch 経路: 会話の最初のターンを作る時に figures 集合と not_seen を決め、回収時の検査に必要な「見せた図の path 一覧」と not_seen を再計算できるようにする（R2 の会話 JSON から再計算するか、版から同じ手順で決め直す。決定的であること。同じ版で同じ R2 内容なら同じ集合）。

- 旧形式の会話（§O-12 の前に出した Batch。保存した会話の最初の user content が文字列）を回収した時、版に図（svg / png / webp）が 1 枚でもあれば、report の中身に関係なく `claim_set_mismatch` で失敗させる（再試行で新しい形の入力を作り直す）。図が 0 枚の版は従来どおり受け入れる。`not_seen` は「容量のため見せなかった」時だけに使い、旧形式の未表示には使わない（Astra high R1 BLOCKING）。

## d. 確認画面（`GET /api/review/:version_id` と admin.js）

- API: `verification` に `figures: [{path, verdict, reason}] | null` を足す（result_json に figures が無い古い検証は null）。
- 「説明と表現」の行の文言: `図・画像 N 枚（検証係も図を見ています。判定はサムネイルの下。最後はあなたがすべて見てください）`。figures が null（古い検証・検証前）の時は `図・画像 N 枚（この版の検証係は図を見ていません。すべて見てください）`。
- 各サムネイルの下に判定の pill（ok = 緑「検証係: 問題なし」/ problem = 赤「検証係: 指摘あり」/ unclear = 黄「検証係: 判断できず」/ not_seen = 灰「検証係: 未確認（容量）」）と reason（あれば）。生成画像のキャプション（§O-7 6）はその上に残す。
- 詳細（`detailsHtml`）の検証の行に `図 ok X / 指摘 Y / 判断できず Z / 未確認 W` を足す（figures がある時だけ）。
- 承認ボタン・キー操作・triage・一覧は変えない。

## e. 受け入れ（vitest。fake の port・`node:sqlite`）

1. png 2 枚 + svg 1 枚の版で、同期の最初の request の user content に image block が 2 つ（path 昇順、media_type 正しい、base64 が R2 のバイトと一致）、svg は本文に入り image block にならない。図の一覧の行が 3 行。
2. figures が見せた集合と一致する report → 成功し、result_json.figures に 3 件。1 件欠け・余分・重複・enum 外 → 失敗（`claim_set_mismatch`）。
3. png の合計が上限を超える版（上限を test で小さくできるようにするか、大きなバイト列で）: 超えた path は image block に無く、一覧の行に「渡していません」、report に含めなくても成功し、保存では `not_seen`。
4. Batch 経路でも 1 と 2 が成り立つ（会話 JSON に image block が入り、回収時の検査で figures を見る）。
5. 図 0 枚の版: 従来どおり成功（figures は空配列）、末尾の指示は従来の文。
6. review API: figures あり / 古い result_json（figures 無し）で null。
7. 既存テスト全部 green（画像の行の見出し文を変えたテストは新しい文へ直す）。`npx tsc --noEmit` と `npm test` の verdict 行を報告。
8. 変更前のコードで 1〜3 の新テストが落ちること（mutation 確認）。

## f. 範囲（実装担当が触るもの）

`factory/worker/src/verify.ts`、`src/routes/review.ts`、`public/admin/admin.js`（と必要なら admin.css の pill 1〜2 行）、`test/` の検証係・画像・review のテスト、`scripts/smoke.mjs` の検証係の fake 応答が figures を要るなら最小限。触らない: migration、jobs.ts の取り込み、images.ts、職人定義、wrangler.jsonc、契約文書（司令塔が直す）。
