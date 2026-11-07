# §AJ 立体モデル（3D）を素材に組み合わせる（v1。2026-11-07 凍結）

ふじさんの決定（2026-11-07）: 「学習者に見せられたら何でもいい。埋め込みでなくてもよい。利用できるコンテンツは利用し、今あるサンプルは出典を明記して保存し、工場の利用できるコンテンツに入れる」→ C 案（埋め込みで先に出し、自前で見せる形へ後で移す）。本書は v1 = 埋め込み。自前で見せる v2 は別契約。

正本の一覧: `factory/models3d/catalog.json`（人が提供元の記録でライセンスを確かめたもの。PR-AJ1 で着地済み・main `b58fcd8`）。生成物 `src/generated/models3d-catalog.ts` の `MODELS3D`（`Model3dEntry`）。

## AJ-0 保証（有界）と範囲

- 工場が素材に入れる立体モデルは、一覧に載っていて `kind` が `sketchfab` / `voyager` のものだけ。職人は注文票に付く一覧から選ぶ（自分で探さない）。一覧に無い id は取り込み検査で落ちる（`bad_model3d`）。
- 見せ方 v1 は提供元の公式の埋め込み（Sketchfab の `https://sketchfab.com/models/<uid>/embed`・Smithsonian Voyager の `https://3d-api.si.edu/voyager/3d_package:<id>`）。確認画面（/admin）で人が回して見る。
- 保証（取り込みを通った版について）: `parts[].models3d[]` の各件は一覧の id を指し、その `source_id` の出典の行の url は一覧の `page_url` と完全一致し、素材全体で 3 件以内、`why` は 1〜300 字。確認画面に出す埋め込みの url は一覧から引き、表示の直前にもう一度形を確かめる（material.json の値を src にしない）。
- 範囲外（v1）: モデルの中身の機械検査（検証係は見ない。仕分けが「人が回して見る」の ask を出す）/ oEmbed の呼び出し / GLB の取得・保存・自前の表示（`download` の 3 件は使えない）/ 子ども向けアプリ（app-v3）の描画 / 立体モデルへの付箋（段落の付箋で代用）/ Sketchfab のライセンスの自動再確認 / allowlist・作業場（cloud.yaml）の変更（職人は提供元のページを開かない）。
- 費用: 新しい API 呼び出しは無い（注文票が 20 行ほど長くなるだけ）。
- 子どものデータは一切関わらない。

## AJ-1 material.json（`src/checks/schema.ts`）

`parts[].models3d[]` を足す。任意で、無ければ 0 件（videos と同じ扱い）。

```
{ "id": "d1",                      // 素材全体で一意。/^d[0-9]{1,2}$/
  "catalog_id": "omnh-allosaurus", // 一覧の id。kind が sketchfab / voyager のものだけ
  "why": "…",                      // 見方。何をどう見るとどう分かるか。1〜300 字
  "source_id": "s9" }              // sources.json の id。その url は一覧の page_url と完全一致
```

- 定数: `MODEL3D_ID_RE = /^d[0-9]{1,2}$/`、`MAX_MODELS3D = 3`。
- 検査は純関数 `checkModels3d(parts, sourceUrlById, catalog)`（`checkVideos` と同じ形。`catalog` は `ReadonlyMap<string, Model3dEntry>` で、呼び出し側が `MODELS3D` から作る。テストでは小さな一覧を渡せる）。失敗は `bad_model3d:{part_id}:{index}:{理由}`。理由は `id` / `catalog` / `text` / `source` / `dup` / `too_many` のどれか。
  - 要素がオブジェクトでない・id の形違い → `id`。一覧に無い id・`kind` が `download` の id → `catalog`。why が 1〜300 字でない → `text`。同じ id が 2 回、または同じ catalog_id が 2 回（part をまたいでも）→ `dup`。素材全体で 4 件以上 → 4 件目で `too_many`。`source_id` の出典の url が一覧の `page_url` と完全一致しない → `source`。
  - `models3d` が配列でなければ `bad_type:parts[i].models3d`。
- 検査済みの part には `models3d`（上の 4 キーだけ。余分なキーは落とす）が付き、無い part には付かない。`Part` に `models3d?: Model3d[]` を足す。
- sources.json の立体モデルの行は、動画の行と同じく `quoted_excerpt` が `""` でよい（職人はページを開けない）。`license` は一覧の `license.label` を書く（空なら既存どおり `license_unknown`。検査では一致を求めない）。
- `src/videos.ts` の `versionVideosOf` と同型の `versionModels3dOf(materialJson)` / `versionModels3dOfMaterial(m)` を `src/models3d.ts`（新規）に置く（{id, catalog_id, why, source_id} の配列。読めなければ []）。一覧を引く `model3dEntryOf(catalogId)` もここ（`MODELS3D` から Map を 1 回作る）。

## AJ-2 職人（`src/jobs.ts` の注文票・`factory/claude/agents/material-maker.md`・rubric）

### a. 注文票に一覧を付ける（`buildPhase1Message`）

「# 編集基準」の節の前（「# 注文票」と前の版の区画の後）に次の節を入れる。一覧（`MODELS3D` のうち kind が `sketchfab` / `voyager`）が空なら節ごと出さず、従来の文と 1 文字も変わらない。

```
# 使ってよい立体モデル（一覧）
題材に合うものがあれば、material.json の parts[].models3d[] に catalog_id で書く（1 素材 3 件まで。無ければ使わない）。
- <id>: <title_ja>（<org>・<license.label>）— 札: <topics を「・」でつないだもの> — 出典の url: <page_url>
…
```

- 1 行 1 件、一覧の順。値は一覧のものをそのまま（職人向けの文なので無害化は要らない。一覧は repo の人が書く）。
- 作り直し（rework）の job も同じ builder を通るので、同じ節が付く。

### b. 職人の定義（司令塔が書く文。verbatim で入れる。入れる場所は「# 動画（YouTube）」の節より後・「# 作り直し（前の版がある時）」の直前。§MC の「版が決まっている題材」の節が動画と立体モデルの間に入る）

```
# 立体モデル（一覧から）

- 注文票の「使ってよい立体モデル（一覧）」に載っているものだけを素材に組み合わせてよい（1 素材 3 件まで）。一覧に無いものを探さない・一覧に無い url を書かない。題材に合うものが無ければ使わない
- 使うのは、実物の形・大きさの比べ方・骨格や体のつくりなど「回して見ると分かること」がある時。飾りに使わない。本文のどこにつながるかがはっきりした場面に置く
- 使う立体モデルは material.json の parts[].models3d[] に {"id": "d1", "catalog_id": "<一覧の id>", "why": "<何をどう見るとどう分かるか>", "source_id": "<sources.json の id>"} と書く。id は素材全体で d1・d2・d3
- sources.json には、その立体モデルの行を {"url": "<一覧の『出典の url』を一字も変えずに>", "title": "<題名>（<提供元>）", "license": "<一覧のライセンスの文字列（CC0 / CC BY 4.0 など）>", "is_primary": false, "quoted_excerpt": "", "accessed_at": "<今日>"} の形で書く。立体モデルのページは開けないので、開こうとしない（断られても立体モデルをあきらめる理由にしない）
- 本文では「立体モデルを回して、〜を見てみよう。〜に注目」のように見方を書く。立体モデルを事実の出典にしない（claims の source_ids に立体モデルの出典 id を入れない。形や数の主張は、これまでどおり一次の出典で支える）
- 質問を書く最初の段階では選ばなくてよい
```

- 「# 成果物の構成」の material.json の例に、`"videos": [],` の次の行として `"models3d": [],` を足す。
- 変更は material-maker.md だけ。allowlist.json・cloud.yaml は変えない（ant apply は agent だけ。environment は apply しない）。

### c. rubric

- `common.md` に 17 を足す（§MC が 16 を使ったため。着地時に 16 → 17）: `material.json の parts[].models3d があれば、各件に catalog_id と why（見方）があり、source_id の出典の行の url が一覧の出典の url と同じ（形式だけ。モデルの中身は人が見る）`。
- `kind-3.md` に 1 行足す: `実物の形・骨格・大きさの比べ方が大事な題材で、一覧に合う立体モデルがあれば、回して見られる立体モデルを 1 つ添えている（無ければ generate_image の立体の絵でよい）`。

## AJ-3 検証係・仕分け（v1 は人が見る）

- `src/verify.ts` `childTextsBlocks`: 動画の見どころの行の後に、立体モデルごとに `立体モデル <id> 見方: <why>` の行を足す（material から `versionModels3dOfMaterial` で読む。既存の `neutralizeInputText` を通る）。検証係・読み手係の入力はそれ以外変えない。VERDICT_SCHEMA は変えない。
- `src/checks/citations.ts`: `model3dSourceIds(sources, models3d, catalog)` を足す（`videoSourceIds` と同型。source の url が一覧の page_url と一致する id の集合）。`src/checks/triage.ts` は、`maker_url_not_fetched` / `quote_mismatch` の判定で、動画の出典と同じくこの集合を除外する（職人はページを開けないので、開いていないことを理由に止めない）。
- `src/checks/triage.ts`: 版の material に models3d が 1 件以上あれば、各件に項目 `{ id: 'model3d:<id>', kind: 'model3d', key: 'explanation_and_expression', severity: 'ask', cause: 'model3d_human', model3d_id: <id>, catalog_id, title: <一覧の title_ja（無ければ catalog_id）> }` を出す（人が確認画面で回して見る。v1 では自動公開しない）。`ItemKind` に `'model3d'`、`CAUSE_LABEL` に `model3d_human: '立体モデル（人が回して見てください）'` を足す。一覧に無い catalog_id（取り込み後に一覧から消えた時）は `cause: 'model3d_missing'`（`'立体モデルが一覧に無い（一覧を直すか、素材を作り直す）'`、severity `fix`）。
- 自動の差し戻し（review-auto）は ask では動かない（既存どおり）。

## AJ-4 確認画面（`public/admin/admin.js`・`src/routes/review.ts`・`src/index.ts` の CSP）

- CSP（`ADMIN_CSP`）の `frame-src` に `https://sketchfab.com https://3d-api.si.edu` を足す。他は変えない。生成物の配信（library）の CSP は変えない（負の検査を既存の video-q1 の形で足す）。
- review API（`GET /api/review/<version>`）: `version.material` の models3d はそのまま返す。`models3d_meta` を足す: `{ <models3d の id>: { catalog_id, title, org, kind, embed_url, page_url, license, attribution } }`（一覧から。一覧に無い id は入れない）。古い Worker との互換は不要（無い応答は `null` 扱いで何も出さない）。
- 子どもの画面（`previewMedia`）: 動画の直後に、立体モデルごとに `.mp-model3d`（`data-media="model3d" data-media-key="<id>"`）を置く:
  - `models3d_meta` に id があり、`embed_url` が `^https://sketchfab\.com/models/[0-9a-f]{32}/embed$` か `^https://3d-api\.si\.edu/voyager/3d_package:[0-9a-f-]{36}$` に合う時だけ `<iframe src="<embed_url>" title="<title>" allow="fullscreen; xr-spatial-tracking" referrerpolicy="strict-origin-when-cross-origin" loading="lazy"></iframe>`。合わなければ `<p class="mp-missing">立体モデルの埋め込みの形が正しくないため、埋め込みません</p>`。meta が無ければ `<p class="mp-missing">立体モデル <id> は一覧に無いため、埋め込みません</p>`。
  - 下に `<p class="mp-model3d-cap"><title>（<org>・<license>）<a href="<page_url>" target="_blank" rel="noopener noreferrer">提供元で開く</a></p>`（page_url は `https://` で始まる時だけリンク）と `<p class="mp-model3d-why"><span class="mp-k">見方</span><why></p>`。
  - 値はすべてエスケープする。材料は `d.version.material.parts[].models3d` と `d.models3d_meta`。
- 「図・画像 N 枚・動画 M 本」の行に `・立体モデル K 件` を足す（K が 0 なら出さない）。
- 「利用条件」の節: 動画の後に、立体モデルごとに `<div class="rv-term" data-model3d-term="<id>"><p><b>立体モデル <id></b> <title>（<org>）</p><p>ライセンス: <license>。出典の書き方: <attribution></p><p><a href="<page_url>" …>提供元で開く</a></p></div>`。
- 仕分けの項目（kind `model3d`）の表示: 既存の動画の項目と同じ並びに「立体モデル <id> <title>」。クリックで `.mp-model3d[data-media-key]` へ移動（動画と同じ仕組みがあればそれに乗せる。無ければ移動は無しでよい）。
- CSS（admin.css）: `.mp-model3d iframe` は 16:9 で幅いっぱい（動画と同じ）。

## AJ-5 学習者側の入口（`src/routes/library.ts`）

- `GET /api/library/models3d`（認証なし。既存の `/api/library/*` と同じ扱い）: 一覧のうち kind が `sketchfab` / `voyager` のものを `{ "models": [{ id, title, org, kind, embed_url, page_url, license, attribution }] }` で返す（`title` = title_ja、`license` = license.label）。`Cache-Control: public, max-age=3600`。子ども向けアプリは material.json の `catalog_id` をこれで引いて描く（描画はアプリ側の別契約。埋め込みの形の再確認は AJ-4 と同じ 2 つの正規表現）。
- `/api/library/files/<id>/material.json` は今までどおり職人の material.json をそのまま返す（models3d はそこに入っている）。

## AJ-6 受け入れ（vitest。fake で）

1. schema: 正しい models3d が通り part に 4 キーだけが付く / 無い素材は従来どおり / 配列でなければ `bad_type` / 理由 6 種それぞれ / 3 件は通り 4 件目で `too_many` / `download` の id は `catalog`。
2. 取り込み（`validateOutputs` に files を渡す）: 立体モデルの出典の行が `quoted_excerpt: ""` でも通る。
3. 注文票: `buildPhase1Message` の出力に「# 使ってよい立体モデル（一覧）」の節があり、行数が一覧の埋め込みの件数と同じ（`download` は出ない）。一覧が空の時（テストで差し替え）は節が無く、従来の文と一致。
4. triage: models3d のある版は `model3d_human` の ask が件数分出て、`explanation_and_expression` が `review` になる / 無い版は既存のテストがそのまま緑 / 一覧に無い catalog_id は `model3d_missing` の fix / 立体モデルの出典が未取得でも `maker_url_not_fetched` を出さない。
5. 検証係の入力: `childTextsBlocks` に `立体モデル d1 見方:` の行が入る。
6. 確認画面（review-preview のテストの形）: `.mp-model3d` に一覧どおりの `src` の iframe が 1 つ・「提供元で開く」のリンク・見方 / meta が無い id は「一覧に無い」 / embed_url の形が違う meta は「埋め込みません」で iframe なし / `/admin` の CSP に 2 つのホストがあり library の CSP には無い（負の検査）。
7. `GET /api/library/models3d` が埋め込みの件数を返し、`download` を含まない。
8. 職人の定義の文: `material-maker.md` に「# 立体モデル（一覧から）」の節があり、例に `"models3d": []` がある（既存の定義の検査があればそこに足す）。

## AJ-7 PR の分け方と着地

- PR-AJ1（着地済み）: 一覧・同期・テスト（main `b58fcd8`）。
- PR-AJ2: AJ-1〜AJ-6 を 1 PR（契約面 schema・CSP・仕分けの 3 面をまたぐので実装は Opus high、レビューは Astra medium。security 境界に当たる所は CSP と iframe の src の形の再確認だけ）。着地後に deploy（AI が `deploy-ref.sh`）→ `ant apply --yes claude/agents/material-maker.md`（ふじさん。environment は変えないので cloud.yaml は渡さない）→ 費用ゼロの確認用 session 1 本（AI）→ `claude-lock.json` の commit。
- v2（別契約・別レーン。契約は `contract-AJ2.md`。2026-11-07 凍結）: `download` を自前で見せる（GLB の取得と R2・`<model-viewer>`・容量の上限・子ども向けアプリの描画）/ 検証係が立体モデルの題名と見方の食い違いを判定 / 職人が一覧に無いモデルを探す時の Sketchfab Data API によるライセンス確認。

## 未確認の点（推測を事実として書かない）

- Sketchfab の埋め込みが、ログインしていない閲覧者に対してどこまで追跡・広告を含むか（表示の非表示 `ui_*` は有料プラン限定で、本契約では使わない）。
- Smithsonian の利用規約のページは自動取得を断る（403）。埋め込みの条件は Voyager の手順書（「Embed a model on your site」。条件の記載なし）だけで判断している。3d.si.edu の記録の CC0 は検索の抜粋で確かめた。
- Smithsonian の Voyager の document.json の著作権表示は「(c) Smithsonian Institution. All rights reserved.」（ファイルの表示）で、記録のページの CC0 と字面が違う。埋め込みは公式の手順どおりなので v1 では問題にしないが、v2 でファイルを取ってくる時は記録のページの表示を正とする。
