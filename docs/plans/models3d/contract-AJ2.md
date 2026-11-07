# §AJ2 立体モデル v2: `download` を工場が自分で持って見せる（2026-11-07 凍結）

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

- 自前で見せる立体モデルは、一覧の `kind: download` のうち **運営が確認画面の「立体モデル」ページで取り込んだもの**（D1 `models3d_files` に行があり、R2 に同じ sha の GLB がある）だけ。取り込み元の url は一覧の `download_url`（静的・人が確かめた）だけで、画面や API から url を受け取る口は作らない。
- 上限: 1 件 24 MiB（`MAX_MODEL3D_BYTES = 24 * 1024 * 1024`）。超えるものは取り込めない。
- GLB の形の検査（取り込み時。純関数 `inspectGlb(bytes: ArrayBuffer)` を `src/models3d-file.ts`（新規）に置く）: 先頭 4 byte が `glTF`・version が 2・ヘッダの length が全長と一致・chunk0 の種別が JSON で parse できる・`buffers[].uri` と `images[].uri` が 1 つも無い（自己完結）・`extensionsRequired` ⊆ {`KHR_draco_mesh_compression`, `KHR_mesh_quantization`, `KHR_texture_transform`, `EXT_texture_webp`}（KTX2 / meshopt は復号器を置かないので落とす）。返り値は `{ ok: true, meshes, images, draco: boolean }` か `{ ok: false, reason }`（reason は `magic` / `version` / `length` / `json` / `external` / `extension`）。
- 配信（認証なし）: `GET /api/library/models3d/files/<catalog_id>/<sha256>.glb`。`catalog_id` は `/^[a-z0-9-]{3,40}$/`、`sha256` は `/^[0-9a-f]{64}$/`。D1 の行の sha と一致する時だけ R2 の `models3d/<catalog_id>/<sha256>.glb` を返す。headers: `content-type: model/gltf-binary`・`cache-control: public, max-age=31536000, immutable`・`x-content-type-options: nosniff`・`access-control-allow-origin: *`（公開の資料。学習者のアプリは別オリジンになる）。他の `/api/library/*` に CORS は足さない（範囲外）。
- 一覧 API `GET /api/library/models3d`: D1 を読む（async に）。返すのは v1 と同じ埋め込める件 + **取り込み済みの download**。download の件は v1 の 8 キーに `file_url`（上の配信パス。相対・先頭 `/`）・`bytes`・`sha256` を足した 11 キー。埋め込みの件は v1 のまま 8 キー（増やさない）。順は一覧の順。`cache-control: public, max-age=3600` は v1 のまま。`access-control-allow-origin: *` を足す。
- 職人: 注文票の「使ってよい立体モデル（一覧）」に取り込み済みの download を含める（行の形は v1 と同じ。`kind` は書かない）。職人の定義・rubric・allowlist・作業場は変えない（**`ant apply` は不要**）。
- 取り込み検査（`validateOutputs`）: `checkModels3d` に渡す一覧を「見せられる一覧」= 埋め込める + 取り込み済み download にする。未取り込みの download は v1 と同じく `bad_model3d:…:catalog` で落ちる。
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

- `src/models3d-file.ts`（新規・I/O あり）: `hostedModels3d(db): Promise<Map<catalog_id, { sha256, bytes, draco, fetched_at }>>`（全行。一覧は ≤200 件）/ `inspectGlb` / `MAX_MODEL3D_BYTES` / `R2_KEY(catalogId, sha)` / `fileUrlOf(catalogId, sha)` = `/api/library/models3d/files/<id>/<sha>.glb` / `MODEL3D_FILE_URL_RE = /^\/api\/library\/models3d\/files\/[a-z0-9-]{3,40}\/[0-9a-f]{64}\.glb$/`。
- `src/models3d.ts` に `isViewableModel3d(e, hosted: ReadonlySet<string>)` = 埋め込める or（`kind === 'download'` かつ hosted にある）と `viewableModels3d(hosted, catalog = MODELS3D)` を足す。`embeddableModels3d` は残す（v1 のテストが使う）。`models3dSectionLines(list)` は **渡された一覧をそのまま出す**（中で埋め込み判定をしない。呼び出し側が viewable を渡す）。既定引数 `MODELS3D` は外す（呼び出し側が必ず渡す）。
- `Model3dView` に任意の `file_url?`・`bytes?`・`sha256?` を足す。`model3dViewOf(e, hostedRow?)`: hostedRow があり `e.kind === 'download'` の時だけ 3 キーを足す。

## AJ2-2 取り込み（運営の操作。Access の中）

- `POST /api/models3d/<catalog_id>/fetch`（`ROUTES`。`c.service` なら 403 `human_only`）。handler は `fetchModel3d(c, fetchImpl = fetch)`（テストは stub を渡す）。順に:
  1. 一覧に無い id → 404 `not_found`。`kind !== 'download'` または `download_url` が null → 400 `not_download`。
  2. `fetchImpl(download_url, { redirect: 'follow', headers: { accept: 'model/gltf-binary, */*' } })`。例外 → 502 `fetch_failed:network`。`!res.ok` → 502 `fetch_failed:<status>`。
  3. `content-length` があり上限超え → 413 `too_large`（本文を読まない）。`arrayBuffer()` の後も上限超え → 413 `too_large`。
  4. `inspectGlb` が ng → 422 `bad_glb:<reason>`。
  5. sha256（`crypto.subtle.digest`）。既存行と同じ sha → 200 `{ status: 'unchanged', catalog_id, sha256, bytes }`（R2 に触らない）。
  6. `env.R2.put(R2_KEY, buf, { httpMetadata: { contentType: 'model/gltf-binary' }, sha256 })` → D1 upsert（`INSERT … ON CONFLICT(catalog_id) DO UPDATE`）→ 古い行の sha が違えば古い object を `delete`（失敗しても応答は成功。ログだけ）→ 200 `{ status: 'fetched', catalog_id, sha256, bytes, draco }`。
  - 失敗の時は D1 も R2 も変えない。同じ id の二重押しは同じ key への put なので無害。
  - ログは 1 行の JSON（`at: 'model3d_fetch', catalog_id, status, bytes`）。url や本文はログに出さない。
- `GET /api/models3d`（Access の中・ページ用）: `{ models: [{ id, title, org, kind, license, page_url, has_download_url, state, bytes?, sha256?, fetched_at? }] }`。`state` は `embed`（sketchfab / voyager）/ `hosted` / `not_hosted`（download かつ url あり）/ `unavailable`（download かつ url 無し）。

## AJ2-3 確認画面（`public/admin/`・`src/routes/review.ts`・`src/index.ts`）

- `GET /api/review/:id` の `models3d_meta` の 1 件に、取り込み済み download の時だけ `file_url`・`bytes` を足す（`hostedModels3d(db)` を 1 回読む）。埋め込みの件は v1 のまま。
- 子どもの画面（`previewMedia` → `model3dPreviewHtml`）: `meta.kind === 'download'` の時、`meta.file_url` が `MODEL3D_FILE_URL_RE` と同じ形（admin.js にも同じ正規表現を書く）に合えば `<model-viewer src="<file_url>" alt="<title>" camera-controls touch-action="pan-y" loading="eager"></model-viewer>` を `.mp-model3d` の中の iframe と同じ位置に出す（caption「<題名>（<提供元>・<ライセンス>）提供元で開く」と「見方」は v1 と同じ）。合わなければ `<p class="mp-missing">立体モデル <id> はまだ取り込まれていません（<a href="#/models3d">立体モデル</a> のページで取り込んでください）</p>`。値はすべてエスケープ。src は `models3d_meta` の値だけ（material.json の値を使わない）。
- 新しいページ `#/models3d`（nav「立体モデル」を「お題の棚」の後に）。`GET /api/models3d` を読み、表（題名 / 提供元 / ライセンス / 種類 / 状態 / 操作）。状態の文言: `embed` → 「埋め込み」、`hosted` → 「取り込み済み（<MB を小数 1 桁> MB・<日付>）」、`not_hosted` → 「未取り込み」、`unavailable` → 「取り込めない（配布の url が無い）」。操作: `not_hosted` と `hosted` に「取り込む」/「取り直す」ボタン（`action()`。確認文「提供元から GLB を取り込みます（24 MB まで）」→ POST → busy「取り込み中…」→ toast「取り込みました（<MB> MB）」/ `unchanged` は「変わっていません」→ 表を描き直す）。失敗は toast に日本語（`too_large` → 「24 MB を超えています」、`bad_glb:<reason>` → 「GLB の形が合いません（<reason>）」、`fetch_failed:<x>` → 「提供元から取れませんでした（<x>）」、他は応答の error）。読み込み中・失敗（再試行ボタン）の 2 状態も出す（videos ページと同じ形）。題名は `page_url` へのリンク。
- vendor（repo に入れる。`public/admin/vendor/`）: `model-viewer.min.js`（4.4.0）・`draco/draco_decoder.wasm`・`draco/draco_wasm_wrapper.js`（three 0.183.2 の `examples/jsm/libs/draco/gltf/`）・`LICENSES.md`（両方の Apache-2.0 全文・版・取得元・取得日）。`factory/worker/scripts/vendor-model-viewer.sh` が `npm pack` で取り直す（版は script に固定。実行後に `ls -l` の bytes を出す）。
- `public/admin/index.html`: admin.js の後に `<script type="module" src="/admin/vendor/model-viewer.min.js"></script>`。admin.js の先頭（IIFE の中の最初）で `window.ModelViewerElement = { dracoDecoderLocation: '/admin/vendor/draco/' };`（module は deferred なので admin.js が先に走る。既に要素が作られた後では効かない）。
- `/admin` の CSP（`src/index.ts` の `ADMIN_CSP` と `test/review-preview/serve.mjs` の `CSP`。同じ文字列）: `script-src 'self' 'wasm-unsafe-eval'` と `worker-src blob:` を足す。他の指示子は v1 のまま（`frame-src` を変えない。`/api/library/*` の CSP も変えない）。`serveAdmin` は path が `.wasm` で終わる時 `content-type: application/wasm` を上書きする（ASSETS の既定は未確認）。serve.mjs の `TYPES` に `.wasm` を足す。
- serve.mjs: 作り物の版 `vm3d-0001`（fixtures.mjs の `models3d()`。着地済み）に `d3`（`nasa-perseverance-rover`・`file_url` 付き）を足し、環境変数 `FACTORY_PREVIEW_GLB=<手元の .glb のパス>` がある時だけ `/api/library/models3d/files/nasa-perseverance-rover/<sha>.glb` でそのファイルを返す（無ければ 404。GLB は repo に入れない）。`GET /api/models3d` の作り物も返す（`#/models3d` を手元で見るため）。

## AJ2-4 学習者側（`src/routes/library.ts`・`src/index.ts`）

- `libraryModels3d(env)`（async）と `libraryModel3dFile(env, catalogId, sha)`（上の配信）。index.ts の `/api/library/` の分岐に 2 行足す（正規表現は `^/api/library/models3d/files/([a-z0-9-]{3,40})/([0-9a-f]{64})\.glb$`）。
- 子ども向けアプリ向けの書き方を `factory/models3d/README.md` に 1 節足す: `file_url` を `<model-viewer src>` に渡す・Draco 復号器は自前に置いて `dracoDecoderLocation` を指す・CSP に `'wasm-unsafe-eval'` と `worker-src blob:` が要る・ライセンス表示は `attribution` をそのまま出す。

## AJ2-5 受け入れ（vitest。fake で。実物の GLB は repo に入れず、テストは最小の GLB を合成する）

1. `inspectGlb`: 合成した最小 GLB（JSON chunk だけ・`asset.version "2.0"`）で ok / draco は `extensionsRequired` で判定 / magic・version・length・json・external（buffers.uri と images.uri の両方）・extension（`KHR_texture_basisu`）の各 ng。
2. `POST /api/models3d/<id>/fetch`: not_found / not_download（voyager の id と download_url 無しの id）/ too_large（content-length で・本文で）/ fetch_failed（status と例外）/ bad_glb / fetched（R2 に key が入り D1 に行が入る。応答の sha が本文の sha256 と一致）/ unchanged（2 回目は R2 に触らない）/ 取り直し（sha が変わると古い key が消える）/ service token は 403。
3. `GET /api/library/models3d/files/…`: 行と sha が合う → 200 と 4 つの headers・本文が R2 の bytes / sha 違い・id 違い・R2 に無い → 404 / POST は 405。
4. `GET /api/library/models3d`: 取り込み済みの download があれば一覧の順で入り 11 キー・`file_url` が `MODEL3D_FILE_URL_RE` に合う / 無ければ v1 と同じ（`test/models3d-library.test.ts` の既存の期待は維持）/ CORS の header。
5. 注文票: 取り込み済みの download の行が出る・未取り込みは出ない・埋め込みの行は v1 と同じ位置。
6. `validateOutputs`: hosted を渡すと download の id が通り、渡さないと `catalog` で落ちる。
7. `GET /api/review/:id`: 取り込み済み download の `models3d_meta` に `file_url`・`bytes`。
8. admin.js の純関数: download + 正しい `file_url` → `<model-viewer src=…>` が 1 つ（src は meta の値・エスケープ）/ 形が違う・`file_url` 無し → 「まだ取り込まれていません」/ `#/models3d` の表の 4 状態の文言とボタンの有無 / `/admin` の CSP に `'wasm-unsafe-eval'` と `worker-src blob:` があり `frame-src` は v1 と同じ（既存のテストの期待を更新）。
9. serve.mjs の CSP 文字列が Worker と同じ（既存の形）。
10. 実ブラウザ（AI が着地後に手元で）: `FACTORY_PREVIEW_GLB` に実測の探査車 GLB を指して serve.mjs を上げ、`#/review/vm3d-0001` で探査車が回せる・console に CSP の拒否が無い・`#/models3d` の表が出る。本番: deploy 後に **ふじさんが `#/models3d` で探査車を「取り込む」**（Access の中の操作。TODO に出す）→ AI が `GET /api/library/models3d` に `nasa-perseverance-rover` が `file_url` 付きで入ること・その url が 200 で `content-length: 4987176` を返すことを curl で確かめる。

## AJ2-6 PR の分け方と着地

- 1 PR（migration・route・library・admin・vendor・テスト。契約面 schema と CSP をまたぐので実装は Opus high、レビューは Astra high — CSP の緩和（`'wasm-unsafe-eval'`・`worker-src blob:`）と認証なしの配信 route と R2 への書き込みが security 境界）。
- 着地後: deploy（AI が `deploy-ref.sh`。migration 0016 が先に走る）→ ふじさんの TODO は「取り込む」ボタン 1 回だけ（`ant apply` は無い）→ AI が本番の入口を curl で確認 → memory 更新。

## 未確認の点（推測を事実として書かない）

- Cloudflare の静的アセット（ASSETS）が `.wasm` にどの content-type を付けるか（未確認。`serveAdmin` が上書きするので動作には関係しない）。
- `<model-viewer>` が Draco 以外に外部へ出る経路（環境マップ等）を持たないか。手元の実ブラウザで console と network を見て確かめる（AJ2-5 10）。出る経路があれば v2 の範囲で塞ぐ（CSP は広げない）。
- three 0.183.2 の復号器と model-viewer 4.4.0（gstatic 1.5.6 想定）の版の整合。実ブラウザで探査車が出れば OK、出なければ gstatic の 1.5.6 と同じ版の復号器（`draco` npm）へ差し替える。
