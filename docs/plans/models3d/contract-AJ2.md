# §AJ2 立体モデル v2: `download` を工場が自分で持って見せる（2026-11-07 凍結）

> **改訂の注記（2026-11-07・§AK 権利の門番 `docs/plans/rights/contract-AK.md` の AK-4・AK-9）**: 本契約の次の点は §AK が置き換える。(1) 取り込みの route `POST /api/models3d/<id>/fetch` は**廃止**（AJ2-2 の 2〜6 は `importModel3d` に切り出され、権利の確認 `POST /api/rights/models3d/<id>/check` / cron が verified の直後に claim を持ったまま呼ぶ経路だけ。管理のページの「取り込む」「取り直す」のボタンは無くなり「権利を確かめる」「止める」「戻す」になる）。(2) 配信 `GET /api/library/models3d/files/<id>/<sha>.glb` は **D1 を見る**（`rights_records` と `rights_hosted` を 1 クエリで読み、記録の指紋が一致し host が許され、その sha を確認のもとで取り込んだ時だけ 200。「D1 は見ない・R2 の object があれば配る」は改訂）。(3) 学習者側の一覧と確認画面の `models3d_meta` に**キーが増える**（`license_code`・`license_url`。確認画面は `rights_kind`・`rights_status` と、門番で × の時の `rights_blocked`・`rights_reason`）。`license` は記録の code と url からの名前、`attribution` は記録の値になる。注文票・取り込み検査・一覧・確認画面は `viewable*` ではなく門番の `offerableModels3d` / `offerableCatalogMap` を通る。(4) **cache の短縮**: 一覧 API は 3600 → 600 秒、配信は `public, max-age=31536000, immutable` → `public, max-age=86400`（deploy 前に 1 年の immutable で配った url の端末の cache は回収できない = §AK-0 4 の範囲外）。

ふじさんの決定（2026-11-07）: 「学習者に見せられたら何でもいい。利用できるコンテンツは利用する」+「指示を待たずどんどん進めて」。v1（`contract-AJ.md`。埋め込み。main `f3004be`・lock `927a0fc`）の次段。一覧（`factory/models3d/catalog.json`）の `kind: download` を、運営が確認画面から取り込み（GLB を R2 に置き）、確認画面と学習者側の入口で自前に見せる。

## 実測した事実（2026-11-07。推測を含まない）

- NASA 探査車（`nasa-perseverance-rover`）の GLB: 4,987,176 bytes・`content-type: model/gltf-binary`・glTF 2.0・chunk0 は JSON・`buffers` 1 件（埋め込み。`uri` 無し）・`images` 44 件（webp / jpeg / png。すべて埋め込み）・`extensionsRequired` = `["KHR_draco_mesh_compression"]`・`extensionsUsed` に KHR_materials_clearcoat / transmission / specular / ior と EXT_texture_webp・meshes 68・animations 23。sha256 `10db7c03a5e63a5a3b3e7baa6243aa4918ba045fa8ff0a731d0217491adc727f`。
- ISS（`nasa-iss`）の GLB: 64,846,620 bytes → 下の上限を超える（v2 では取り込めない。一覧には残す）。
- BodyParts3D（`dbcls-bodyparts3d`）: `download_url` が null（OBJ の変換が要る）→ v2 の範囲外。
- `@google/model-viewer@4.4.0`: Apache-2.0・2026-10-09 公開・`dist/model-viewer.min.js` 1,069,272 bytes（three 同梱の ESM）・peer `three ^0.183.0`・Draco 復号器の既定の置き場は `https://www.gstatic.com/draco/versioned/decoders/1.5.6/`（外部）。
- `three@0.183.2` の `examples/jsm/libs/draco/gltf/`: `draco_decoder.wasm` 192,420 bytes・`draco_wasm_wrapper.js` 58,456 bytes（Apache-2.0）。three の DRACOLoader は `dracoDecoderLocation` から wrapper（text）と wasm（arraybuffer）を取り、`URL.createObjectURL(new Blob([...]))` の URL で `new Worker(...)` を作る。
- CSP: WebAssembly のコンパイルは `script-src` に `'wasm-unsafe-eval'` が無いと止まる（MDN `script-src`）。Blob の URL の Worker は `worker-src blob:` が要る。
- R2 の `put` に ReadableStream を渡すと長さが要るという報告（workers-sdk の issue。公式 docs には記載なし）→ 本契約は ArrayBuffer で渡す（上限があるので買える）。
- 確認画面の `/admin` は Access の中。`/api/library/*` は認証なし・GET だけ（`src/index.ts`）。

## AJ2-0 保証（有界）と範囲

- 自前で見せる立体モデルは、一覧の `kind: download` のうち **運営が確認画面の「立体モデル」ページで取り込んだもの**だけ。取り込み元の url は一覧の `download_url`（静的・人が確かめた）だけで、画面や API から url を受け取る口は作らない。
- 資格は 2 つに分けて定義する（混ぜない）:
  - **「取り込み済み」（一覧 API に載る・注文票に出る・取り込み検査で通る・確認画面で回せる）** = D1 `models3d_files` に行があり、**かつ** その行の sha の object が R2 にある（`hostedModels3d(env)` が D1 の行ごとに `env.R2.head(key)` で確かめて、無い行は除く。行は数件なので head は数回）。
  - **「配信できる」（`GET /api/library/models3d/files/<id>/<sha>.glb` が 200 を返す）** = R2 の `models3d/<id>/<sha>.glb` が存在すること。D1 は見ない。R2 の `models3d/` 配下に置かれる object は **すべて** 下の取り込み手順で一覧の静的 url から取り、形の検査を通ったものだけなので（他に書く経路は無い）、D1 の行が無い object（取り直し前の古い sha・put 後に D1 が失敗した時の孤児）も公開して差し支えない。この 2 つがずれる状態（D1 の upsert 前・古い sha・孤児）は仕様として許す。
- 上限: 1 件 24 MiB（`MAX_MODEL3D_BYTES = 24 * 1024 * 1024`）。超えるものは取り込めない。
- GLB の形の検査（取り込み時。純関数 `inspectGlb(bytes: ArrayBuffer)` を `src/models3d-file.ts`（新規）に置く。glTF 2.0 の GLB の仕様どおりに読む）。順に:
  1. `magic`: 全長 < 20 byte、または先頭 4 byte が `glTF` でない。
  2. `version`: ヘッダの version が 2 でない。
  3. `length`: ヘッダの length が全長と一致しない。
  4. `chunk`: chunk0 の種別が `JSON` でない / chunk の長さがファイルの外に出る / chunk の長さが 4 の倍数でない（GLB の仕様。JSON・BIN とも）/ chunk が 3 つ以上 / 2 つ目があるのに種別が `BIN` でない。
  5. `json`: chunk0 が JSON として parse できない、または object でない / `buffers`・`images`・`extensionsRequired`・`extensionsUsed` があるのに配列でない / その要素の型が違う（buffers・images は object、extensions は string）。
  6. `asset`: `asset.version` が `"2.0"` でない。
  7. `external`: `buffers[].uri` または `images[].uri` が 1 つでもある（自己完結でない）/ `images[]` に `bufferView` が無い / `images[].mimeType` が `image/png`・`image/jpeg`・`image/webp` 以外。
  8. `buffer`: `buffers` が 2 件以上 / `buffers[0]` があるのに BIN chunk が無い / `buffers[0].byteLength` が無い・0 以上の整数（`Number.isSafeInteger`）でない / BIN chunk の長さ − `byteLength` が 0〜3 の範囲にない（仕様の詰め物は最大 3 byte。それより大きい差も、負の差も落とす）/ BIN chunk があるのに `buffers` が無い。
  9. `extension`: `extensionsRequired` ⊄ {`KHR_draco_mesh_compression`, `KHR_mesh_quantization`, `KHR_texture_transform`, `EXT_texture_webp`}、**または** `extensionsRequired ∪ extensionsUsed` に復号器が要る拡張 {`KHR_texture_basisu`, `EXT_meshopt_compression`} が 1 つでもある（optional でも model-viewer が KTX2 側を選ぶ経路があるため）。
  - 返り値は `{ ok: true, meshes, images, draco: boolean }`（draco は `extensionsRequired ∪ extensionsUsed` に `KHR_draco_mesh_compression` がある時）か `{ ok: false, reason }`（reason は上の 9 語のどれか 1 つ。最初に当たったもの）。
- 配信（認証なし）: `GET /api/library/models3d/files/<catalog_id>/<sha256>.glb`。`catalog_id` は `/^[a-z0-9-]{3,40}$/`、`sha256` は `/^[0-9a-f]{64}$/`（完全一致の正規表現。合わなければ 404）。**D1 は見ない**: 形が合えば key `models3d/<catalog_id>/<sha256>.glb` を組み立てて R2 から get し、無ければ 404（DB の `r2_key` を信用して配信する実装にはしない）。取り直しの後も古い sha の object は残す（下の AJ2-2）ので、1 時間 cache された一覧の url が取り直しの直後に死なない。headers: `content-type: model/gltf-binary`・`content-length: <R2 object の size>`・`cache-control: public, max-age=31536000, immutable`・`x-content-type-options: nosniff`・`access-control-allow-origin: *`（公開の資料。学習者のアプリは別オリジンになる）。他の `/api/library/*` に CORS は足さない（範囲外）。
- 一覧 API `GET /api/library/models3d`: D1 と R2 の head を読む（async に。署名は `libraryModels3d(env, origin: string)` で、index.ts の分岐は `return await libraryModels3d(env, url.origin)` として既存の catch に乗せる）。返すのは v1 と同じ埋め込める件 + **取り込み済みの download**（上の定義。object が欠けた行は出さない）。download の件は v1 の 8 キーに `file_url`（**絶対 url** = 渡された `origin` + 上の配信パス。学習者のアプリは別オリジンなので相対では解決を誤る）・`bytes`・`sha256` を足した 11 キー。埋め込みの件は v1 のまま 8 キー（増やさない）。順は一覧の順。`cache-control: public, max-age=3600` は v1 のまま。`access-control-allow-origin: *` を足す。
- 職人: 注文票の「使ってよい立体モデル（一覧）」に取り込み済みの download を含める（行の形は v1 と同じ。`kind` は書かない）。職人の定義・rubric・allowlist・作業場は変えない（**`ant apply` は不要**）。
- 取り込み検査（`validateOutputs`）: `validateOutputs(files, opts?: { models3dHosted?: ReadonlySet<string> })`（同期のまま。既定は空集合）。`checkModels3d` に渡す Map を `viewableCatalogMap(hosted)`（埋め込める + hosted にある download。`src/models3d.ts`）にし、**`checkModels3d` の中の「`kind` が `download` なら `catalog`」の判定は外す**（Map に無いことで落ちる）。未取り込みの download は v1 と同じく `bad_model3d:…:catalog` で落ちる。呼び出し側 `src/jobs.ts`（取り込み。1892 行付近）は async なので先に `hostedModels3d(db)` の id の集合を取って渡す。
- 検証係・仕分け・verify の子ども向け文（`childTextsBlocks`）: 変えない（download も ask「人が回して見る」のまま。v1 では自動公開しない）。
- 範囲外: 子ども向けアプリ（app-v3）の描画（API の形だけ決める）/ 一覧に無いモデルの探索 / Sketchfab のライセンスの自動再確認 / OBJ の変換（BodyParts3D）/ 24 MiB 超の軽量化（ISS）/ 検証係によるモデルの判定。
- 費用: 新しい API の呼び出しは無い。R2 の保存は数 MB、配信の egress は R2 は無料。Worker の取り込みは 1 回数秒（人が押した時だけ）。
- 子どものデータは一切関わらない。

## AJ2-1 D1（migration `0016_models3d_files.sql`）

```sql
-- 契約 §AJ2-1（2026-11-07）: 運営が取り込んだ立体モデル（GLB）の記録。R2 の object は models3d/<catalog_id>/<sha256>.glb
CREATE TABLE models3d_files (
  catalog_id TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  r2_key TEXT NOT NULL,
  draco INTEGER NOT NULL DEFAULT 0,
  fetched_at TEXT NOT NULL,
  fetched_by TEXT NOT NULL
);
```

- `src/models3d-file.ts`（新規・I/O あり）: `hostedModels3d(env): Promise<Map<catalog_id, { sha256, bytes, draco, fetched_at }>>`（D1 の全行のうち `env.R2.head(key)` が object を返す行だけ。一覧は ≤200 件・行は数件）/ `inspectGlb` / `readCapped` / `MAX_MODEL3D_BYTES` / `R2_KEY(catalogId, sha)` / `fileUrlOf(catalogId, sha)` = `/api/library/models3d/files/<id>/<sha>.glb` / `MODEL3D_FILE_URL_RE = /^\/api\/library\/models3d\/files\/[a-z0-9-]{3,40}\/[0-9a-f]{64}\.glb$/`。
- `src/models3d.ts` に `isViewableModel3d(e, hosted: ReadonlySet<string>)` = 埋め込める or（`kind === 'download'` かつ hosted にある）、`viewableModels3d(hosted, catalog = MODELS3D)`、`viewableCatalogMap(hosted, catalog = MODELS3D): ReadonlyMap<string, Model3dEntry>` を足す。`embeddableModels3d` は残す（v1 のテストが使う）。`models3dSectionLines(list)` は **渡された一覧をそのまま出す**（中で埋め込み判定をしない。呼び出し側が viewable を渡す）。既定引数 `MODELS3D` は外し、引数を必須にする（tsc は `src/` の呼び出し側を拾う。テスト側の省略呼び出しは AJ2-5 の期待の更新で合わせる）。呼び出し側: `src/jobs.ts` の `buildPhase1Message`（259 行）は `models3d` 引数を必須にし、注文の開始側（412 行。今は省略している）で `viewableModels3d(await hostedIds(db))` を渡す。作り物の注文（テスト）も同じ。
- `Model3dView` に任意の `file_url?`・`bytes?`・`sha256?` を足す。`model3dViewOf(e, hostedRow?)`: hostedRow があり `e.kind === 'download'` の時だけ 3 キーを足す。

## AJ2-2 取り込み（運営の操作。Access の中）

- `POST /api/models3d/<catalog_id>/fetch`（`ROUTES`。Access の中。service token はこの route では `allowCommonName` に入れないので Access の層で 401 になる。handler でも `c.service` なら 403 `human_only` を返す = 二重の守り）。handler は `fetchModel3d(c, fetchImpl = fetch)`（テストは stub を渡す）。順に:
  1. 一覧に無い id → 404 `not_found`。`kind !== 'download'` または `download_url` が null → 400 `not_download`。
  2. `fetchImpl(download_url, { redirect: 'manual', headers: { accept: 'model/gltf-binary, */*' }, signal: AbortSignal.timeout(60_000) })`。**リダイレクトは追わない**（3xx は `!res.ok` なので 502 `fetch_failed:<status>`。取得先は一覧の静的な url そのものだけ）。例外 → 502 `fetch_failed:network`（timeout は `fetch_failed:timeout`）。`!res.ok` → 502 `fetch_failed:<status>`。
  3. `content-length` があり上限超え → 413 `too_large`（本文を読まない）。本文は **stream で読みながら累計を数え**、上限を超えた時点で `reader.cancel()` して 413 `too_large`（`arrayBuffer()` で全量を先に読まない。純関数に近い `readCapped(body, max): Promise<ArrayBuffer | 'too_large'>` を `src/models3d-file.ts` に置く）。本文の読み取り中の例外（途中で切れた・timeout）も 2 と同じ 502 `fetch_failed:network` / `fetch_failed:timeout`（2〜3 を 1 つの try で包む）。
  4. `inspectGlb` が ng → 422 `bad_glb:<reason>`。
  5. sha256（`crypto.subtle.digest`）。既存行と同じ sha → `env.R2.head(key)` で object の存在を確かめ、あれば 200 `{ status: 'unchanged', catalog_id, sha256, bytes }`（書かない）、無ければ 6 へ進む（欠けた object の修復。応答は `fetched`）。
  6. `env.R2.put(key, buf, { httpMetadata: { contentType: 'model/gltf-binary' }, sha256 })` → D1 upsert（`INSERT … ON CONFLICT(catalog_id) DO UPDATE`）→ 200 `{ status: 'fetched', catalog_id, sha256, bytes, draco }`。**古い sha の object は消さない**（配信は sha で引くので古い url も生きる。並行の取り込みで現行の object を消す競合も起きない。回収は範囲外）。
  - 保証（有界）: 1〜4 で落ちた時は D1 も R2 も書かない。R2 の put が成功して D1 の upsert が失敗した時は D1 は前のまま（一覧・確認画面は前の sha を指し続ける）で、R2 に参照されない object が残る（検査済み・出典は静的 url なので公開して差し支えない。回収は範囲外。応答は 500 `internal_error` = 既存の catch）。put → upsert の順なので、工場の操作だけでは「D1 に行があるのに object が無い」状態は作られない。外から object が消された時は「取り込み済み」から外れ（上の定義。一覧・注文票・検査・確認画面はその id を使わない）、管理のページが `hosted_missing` と出す。**修復は、提供元がその時点で返す本文を取り直すこと**（同じ本文なら 5 の head で put に進み、違う本文なら新しい sha が取り込み済みになる。古い sha の object は戻らない = 1 時間 cache された古い url はその間 404。許容）。提供元が落ちていれば修復できない（`fetch_failed`）。
  - 並行: 同じ id の二重押し・別タブからの同時取り込みは、どちらも put → upsert で、最後の upsert が勝つ。object は両方残るのでどちらの sha の url も配信できる。
  - ログは 1 行の JSON（`at: 'model3d_fetch', catalog_id, status, bytes`）。url や本文はログに出さない。
- `GET /api/models3d`（Access の中・ページ用）: `{ models: [{ id, title, org, kind, license, page_url, has_download_url, state, bytes?, sha256?, fetched_at?, object_ok? }] }`。`state` は `embed`（sketchfab / voyager）/ `hosted`（D1 の行があり object もある）/ `hosted_missing`（D1 の行はあるが object が無い。`object_ok: false`）/ `not_hosted`（download かつ url あり・行なし）/ `unavailable`（download かつ url 無し）。`hosted` と `hosted_missing` の件は `env.R2.head(key)` の結果 `object_ok`（boolean）を付ける（行は数件なので head は数回）。

## AJ2-3 確認画面（`public/admin/`・`src/routes/review.ts`・`src/index.ts`）

- `GET /api/review/:id` の `models3d_meta` の 1 件に、取り込み済み download の時だけ `file_url`（**相対**。先頭 `/` の配信パス。確認画面は同じオリジンなので相対でよい。学習者向けの一覧 API だけ絶対）・`bytes` を足す（`hostedModels3d(db)` を 1 回読む）。埋め込みの件は v1 のまま。
- 子どもの画面（`previewMedia` → `model3dPreviewHtml`）: `meta.kind === 'download'` の時、`meta.file_url` が `MODEL3D_FILE_URL_RE`（相対の形。admin.js にも同じ正規表現を書く）に合えば `<model-viewer src="<file_url>" alt="<title>" camera-controls touch-action="pan-y" loading="eager"></model-viewer>` を `.mp-model3d` の中の iframe と同じ位置に出す（caption「<題名>（<提供元>・<ライセンス>）提供元で開く」と「見方」は v1 と同じ）。合わなければ `<p class="mp-missing">立体モデル <id> はまだ取り込まれていません（<a href="#/models3d">立体モデル</a> のページで取り込んでください）</p>`。値はすべてエスケープ。src は `models3d_meta` の値だけ（material.json の値を使わない）。
  - 見た目: `admin.css` の `.mp-model3d iframe` の箱（幅 100%・16:9）を `.mp-model3d model-viewer` にも当てる（`display: block` は model-viewer 自身の style が持つ。背景は薄い灰色）。
  - 読み込みに失敗した時（url の形は合うが 404 等。`model-viewer` の `error` イベント）: admin.js が要素の直後に `<p class="mp-missing">立体モデル <id> を読み込めませんでした（取り直してください）</p>` を足す（描画後にイベントを登録。純関数の HTML には含めない）。
- 新しいページ `#/models3d`（nav「立体モデル」を「お題の棚」の後に）。`GET /api/models3d` を読み、表（題名 / 提供元 / ライセンス / 種類 / 状態 / 操作）。状態の文言: `embed` → 「埋め込み」、`hosted` → 「取り込み済み（<MiB を小数 1 桁> MiB・<日付>）」、`hosted_missing` → 「取り込み済みだがファイルが無い（取り直してください）」、`not_hosted` → 「未取り込み」、`unavailable` → 「取り込めない（配布の url が無い）」。操作: `not_hosted` に「取り込む」、`hosted` と `hosted_missing` に「取り直す」ボタン（`action()`。確認文「提供元から GLB を取り込みます（24 MiB まで）」→ POST → busy「取り込み中…」→ toast「取り込みました（<MiB> MiB）」/ `unchanged` は「変わっていません」→ 表を描き直す）。失敗は toast に日本語（`too_large` → 「24 MiB を超えています」、`bad_glb:<reason>` → 「GLB の形が合いません（<reason>）」、`fetch_failed:<x>` → 「提供元から取れませんでした（<x>）」、他は応答の error）。読み込み中・失敗（再試行ボタン）の 2 状態も出す（videos ページと同じ形）。題名は `page_url` へのリンク。
- vendor（repo に入れる。`public/admin/vendor/`）: `model-viewer.min.js`（4.4.0）・`draco/draco_decoder.wasm`・`draco/draco_wasm_wrapper.js`（three 0.183.2 の `examples/jsm/libs/draco/gltf/`）・`LICENSES.md`（両方の Apache-2.0 全文・版・取得元・取得日）。`factory/worker/scripts/vendor-model-viewer.sh` が `npm pack` で取り直す（版は script に固定。実行後に `ls -l` の bytes を出す）。
- `public/admin/index.html`: admin.js の後に `<script type="module" src="/admin/vendor/model-viewer.min.js"></script>`。admin.js の先頭（IIFE の中の最初）で `window.ModelViewerElement = { dracoDecoderLocation: '/admin/vendor/draco/' };`（module は deferred なので admin.js が先に走る。既に要素が作られた後では効かない）。
- `/admin` の CSP（`src/index.ts` の `ADMIN_CSP` と `test/review-preview/serve.mjs` の `CSP`。同じ文字列）。**実ブラウザ（Chrome・2026-11-07）で探査車の GLB を vendor の model-viewer + Draco で出して、拒否ゼロ・質感つきで描けることを確かめた最小の組**:
  - `script-src 'self' 'wasm-unsafe-eval'`（Draco の wasm のコンパイル）
  - `worker-src blob:`（DRACOLoader の Blob の Worker）
  - `connect-src 'self' blob:`（three の GLTFLoader が埋め込みの画像を `blob:` の URL を fetch して読む。無いと質感が全部落ちる。`img-src` に `blob:` を足しても効かないことを実測）
  - `style-src 'self' 'sha256-<model-viewer が shadow root に入れる `<style>` の本文の hash>'`（model-viewer 4.4.0 は adoptedStyleSheets を使わず、template の `<style>`（`:host { display: block; …` 4,891 字）を shadow root に入れる。これが拒否されると要素が 0×0 になり何も見えない。`'unsafe-inline'` は使わず、本文の sha256（base64）を hash で許す。hash の値は `src/index.ts` の定数 `MODEL_VIEWER_STYLE_HASH` に置き、**テストが `public/admin/vendor/model-viewer.min.js` の `<style>…</style>` の本文から同じ hash を計算して一致を確かめる**（vendor を上げたら定数も上げる。`scripts/vendor-model-viewer.sh` が最後に hash を出す））
  - 他の指示子は v1 のまま（`img-src`・`frame-src` を変えない。`/api/library/*` の CSP も変えない）。
  - `serveAdmin` は path が `.wasm` で終わる時 `content-type: application/wasm` を上書きする（ASSETS の既定は未確認）。serve.mjs の `TYPES` に `.wasm` を足す。
- serve.mjs: 作り物の版 `vm3d-0001`（fixtures.mjs の `models3d()`。着地済み）に `d3`（`nasa-perseverance-rover`・`file_url` 付き）を足し、環境変数 `FACTORY_PREVIEW_GLB=<手元の .glb のパス>` がある時だけ `/api/library/models3d/files/nasa-perseverance-rover/<sha>.glb` でそのファイルを返す（無ければ 404。GLB は repo に入れない）。`GET /api/models3d` の作り物も返す（`#/models3d` を手元で見るため）。

## AJ2-4 学習者側（`src/routes/library.ts`・`src/index.ts`）

- `libraryModels3d(env)`（async）と `libraryModel3dFile(env, catalogId, sha)`（上の配信）。index.ts の `/api/library/` の分岐に 2 行足す（正規表現は `^/api/library/models3d/files/([a-z0-9-]{3,40})/([0-9a-f]{64})\.glb$`）。
- 子ども向けアプリ向けの書き方を `factory/models3d/README.md` に 1 節足す: 一覧 API の `file_url` は絶対 url なのでそのまま `<model-viewer src>` に渡す（アプリ側の CSP の `connect-src` に工場のオリジンが要る）・Draco 復号器は自前に置いて `dracoDecoderLocation` を指す・CSP に `'wasm-unsafe-eval'`・`worker-src blob:`・`connect-src blob:`・model-viewer の style の hash（または自前の許し方）が要る（本契約 AJ2-3 の実測）・ライセンス表示は `attribution` をそのまま出す。

## AJ2-5 受け入れ（vitest。fake で。実物の GLB は repo に入れず、テストは最小の GLB を合成する）

1. `inspectGlb`: 合成した最小 GLB（JSON chunk + BIN chunk・`asset.version "2.0"`・buffers 1 件・images は bufferView 付き）で ok / draco は `extensionsUsed` だけにあっても true / 9 つの reason をそれぞれ 1 つ以上の反例で（magic・version・length・chunk（3 つ目の chunk / 2 つ目が BIN でない）・json（配列でない extensionsUsed）・asset（"1.0"）・external（buffers.uri / images.uri / mimeType が gif）・buffer（BIN 無し / byteLength 超過）・extension（required に `KHR_texture_basisu` / used だけに `KHR_texture_basisu` / required に未知の拡張））。
2. `readCapped`: 上限ちょうど → 通る / 上限 + 1 byte（content-length 無しの stream）→ `too_large` で cancel が呼ばれる。
3. `POST /api/models3d/<id>/fetch`: not_found / not_download（voyager の id と download_url 無しの id）/ too_large（content-length で・本文で）/ fetch_failed（status 500・302（追わない）・例外・timeout）/ bad_glb / fetched（R2 に key が入り D1 に行が入る。応答の sha が本文の sha256 と一致）/ unchanged（同じ本文の 2 回目は put を呼ばない）/ 欠けた object の修復（D1 に行・R2 に無し → 2 回目で put が呼ばれ `fetched`）/ 取り直し（sha が変わっても古い key は残る）/ 落ちた時に D1・R2 が変わらない（not_download・too_large・bad_glb の後に行も object も無い）/ handler 単体で `c.service` は 403 / route は common_name の request が Access の層で 401。
4. `GET /api/library/models3d/files/…`: object があれば 200 と 5 つの headers（content-length は object の size）・本文が R2 の bytes / D1 の行が別の sha を指していても object があれば 200（古い url が生きる）/ 形が違う（sha が 63 桁・id に `.`）・object 無し → 404 / POST は 405。
5. `GET /api/library/models3d`: 取り込み済みの download があれば一覧の順で入り 11 キー・`file_url` が `http://localhost/api/library/models3d/files/<id>/<sha>.glb`（絶対）/ 無ければ v1 と同じ（`test/models3d-library.test.ts` の既存の期待は維持。Env に空の D1 を渡す）/ CORS の header。
6. 注文票: 取り込み済みの download の行が出る・未取り込みは出ない・埋め込みの行は v1 と同じ位置（`buildPhase1Message` に一覧を渡す形で。注文の開始側が `viewableModels3d` を渡すことは `test/models3d-order.test.ts` か jobs のテストで 1 本）。
7. `validateOutputs`: `models3dHosted` に id を入れると download の id が通り、入れないと `catalog` で落ちる。**既存のテストの期待の整理**（意味が変わるので契約で決める）: `test/models3d-schema.test.ts` の「Map に download が入っていても `catalog` で落ちる」（173・188 行付近）は、「`viewableCatalogMap(空集合)` で作った Map に download は入らない（→ `catalog` で落ちる）」と「download を含む Map を渡せば通る」の 2 本に分ける。`test/models3d-order.test.ts` の「download だけの一覧を渡すと節を出さない」（43 行付近）は、「`viewableModels3d(空集合)` は download を含まない（→ 節は空）」と「渡した一覧はそのまま出る」の 2 本に分ける。埋め込み判定の責務は `viewable*` に移る。
8. `GET /api/review/:id`: 取り込み済み download の `models3d_meta` に相対の `file_url`・`bytes`。D1 に行があっても object が無ければ付かない（`hostedModels3d` の定義）。`hostedModels3d`: 行 2 件のうち object が 1 件しか無い時に 1 件だけ返る。
9. admin.js の純関数: download + 正しい `file_url` → `<model-viewer src=…>` が 1 つ（src は meta の値・エスケープ）/ 形が違う（絶対 url・`..`）・`file_url` 無し → 「まだ取り込まれていません」/ `#/models3d` の表の 4 状態の文言とボタンの有無・`object_ok: false` の時の「取り直す」/ `/admin` の CSP: `script-src` に `'wasm-unsafe-eval'`・`worker-src blob:`・`connect-src 'self' blob:`・`style-src 'self' 'sha256-…'` があり、`img-src`・`frame-src` は v1 と同じ（既存のテストの期待を更新）/ `MODEL_VIEWER_STYLE_HASH` が vendor の bundle の `<style>` 本文の sha256 と一致。
10. serve.mjs の CSP 文字列が Worker と同じ（既存の形）。
11. 実ブラウザ（AI が着地後に手元で）: `FACTORY_PREVIEW_GLB` に実測の探査車 GLB を指して serve.mjs を上げ、`#/review/vm3d-0001` で探査車が回せる・console に CSP の拒否が無い・`#/models3d` の表が出る。本番: deploy 後に **ふじさんが `#/models3d` で探査車を「取り込む」**（Access の中の操作。TODO に出す）→ AI が `GET /api/library/models3d` に `nasa-perseverance-rover` が `file_url` 付きで入ること・その url が 200 で `content-length: 4987176` を返すことを curl で確かめる。

## AJ2-6 PR の分け方と着地

- 1 PR（migration・route・library・admin・vendor・テスト。契約面 schema と CSP をまたぐので実装は Opus high、レビューは Astra high — CSP の緩和（`'wasm-unsafe-eval'`・`worker-src blob:`）と認証なしの配信 route と R2 への書き込みが security 境界）。
- 着地後: deploy（AI が `deploy-ref.sh`。migration 0016 が先に走る）→ ふじさんの TODO は「取り込む」ボタン 1 回だけ（`ant apply` は無い）→ AI が本番の入口を curl で確認 → memory 更新。

## 未確認の点（推測を事実として書かない）

- Cloudflare の静的アセット（ASSETS）が `.wasm` にどの content-type を付けるか（未確認。`serveAdmin` が上書きするので動作には関係しない）。
- `<model-viewer>` が Draco 以外に外部へ出る経路（環境マップ等）: 手元の実ブラウザ（Chrome）では上の CSP で拒否ゼロ・外部への要求なしを確かめた（`default-src 'self'` のまま）。Safari / Firefox は未確認（three は `createImageBitmap` が無い環境では `<img>` で読むので、その時は `img-src blob:` が要る可能性がある — 推測。確認画面は運営の Chrome だけなので v2 では足さない）。
- three 0.183.2 の復号器と model-viewer 4.4.0 の整合: 実ブラウザで探査車（Draco 必須）が出たので OK（2026-11-07）。
