# 立体モデル（3D）の一覧 — 工場が素材に使ってよいもの

`catalog.json` は、人が提供元の記録でライセンスを確かめた立体モデルの一覧です。職人（material-maker）はこの一覧に載っているものだけを素材に組み合わせます（自分で探さない）。`scripts/sync-claude-assets.sh` が `src/generated/models3d-catalog.ts` に書き出し、形が崩れていれば止まります。

## 載せる決まり

| 項目 | 決まり |
|---|---|
| ライセンス | CC0 / CC BY（`cc0` / `cc-by`）と、NASA の利用の決まり（`nasa-media`）だけ。非営利限定（NC）は載せない（将来の月額販売と合わない） |
| 確かめ方 | Sketchfab は Data API v3（`GET https://api.sketchfab.com/v3/models/<uid>` の `license.slug`）。Smithsonian は 3d.si.edu の記録の表示。NASA は brand center の利用の決まり。`checked_how` に書く |
| 見せ方（kind） | `sketchfab` = Sketchfab の公式の埋め込み（`https://sketchfab.com/models/<uid>/embed`）/ `voyager` = Smithsonian Voyager の公式の iframe（`https://3d-api.si.edu/voyager/3d_package:<id>`）/ `download` = 取ってきて自前で見せる（契約 §AJ2。運営が確認画面の「立体モデル」ページで取り込んだもの = GLB・24 MiB まで だけが素材に使える） |
| 出典 | `page_url` は提供元のそのモデルのページ。素材の sources.json にはこの url を一字も変えずに書く |
| 題材の札（topics） | 1〜8 個。職人が題材から探す手がかり（恐竜・クジラ・昆虫・花・宇宙 など） |

## 足し方

1. 提供元の記録でライセンスを確かめる（上の確かめ方）。NC・ND・不明は載せない
2. `catalog.json` の `models` に 1 件足す（`id` は `[a-z0-9-]`・一意。`checked_at` は確かめた日）
3. `cd factory/worker && bash scripts/sync-claude-assets.sh && npx vitest run test/models3d-catalog.test.ts`
4. commit（生成ファイル `src/generated/models3d-catalog.ts` も一緒に）

## 今の一覧（2026-11-07）

| 題材 | id | 提供元 | ライセンス | 見せ方 |
|---|---|---|---|---|
| 恐竜 | si-triceratops / omnh-allosaurus | スミソニアン国立自然史博物館 / 大阪市立自然史博物館 | CC0 / CC BY 4.0 | voyager / sketchfab |
| マンモス | si-woolly-mammoth | スミソニアン国立自然史博物館 | CC0 | voyager |
| 宇宙 | si-apollo11-command-module | スミソニアン国立航空宇宙博物館 | CC0 | voyager |
| クジラ | omnh-sperm-whale / omnh-fin-whale / omnh-humpback-whale | 大阪市立自然史博物館 | CC BY 4.0 | sketchfab |
| アンモナイト | omnh-pravitoceras / omnh-didymoceras | 大阪市立自然史博物館 | CC BY 4.0 | sketchfab |
| 昆虫 | kyu-rhinoceros-beetle / kyu-giant-hornet | ffish.asia / floraZia.com（九州大学） | CC0 | sketchfab |
| 水辺・海の生き物 | kyu-forest-green-tree-frog / kyu-japanese-crayfish / kyu-asian-paddle-crab / kyu-long-arm-octopus / kyu-luna-lionfish / kyu-japanese-grass-lizard | 同上 | CC0 | sketchfab |
| 花 | kyu-sakura-someiyoshino / kyu-lotus / kyu-red-spider-lily | 同上 | CC0 | sketchfab |
| 宇宙（自前で見せる予定） | nasa-perseverance-rover / nasa-iss | NASA | NASA の利用の決まり | download |
| 体のつくり（自前で見せる予定） | dbcls-bodyparts3d | DBCLS | CC BY 4.0 | download |

## 子ども向けアプリでの見せ方（契約 §AJ2-4）

- 一覧は `GET <工場のオリジン>/api/library/models3d`（認証なし・`access-control-allow-origin: *`・1 時間 cache）。material.json の `parts[].models3d[].catalog_id` をここの `id` で引く。埋め込みの件（`kind` が `sketchfab` / `voyager`）は v1 のまま `embed_url` を iframe に渡す（形の再確認は §AJ-4 と同じ 2 つの正規表現）
- 取り込み済みの `download` の件には `file_url`（**絶対 url**）・`bytes`・`sha256` が付く。`file_url` はそのまま `<model-viewer src="…">` に渡す（工場とアプリは別オリジンなので、相対の url に組み直さない）。配信は `GET /api/library/models3d/files/<id>/<sha256>.glb`（`content-type: model/gltf-binary`・`access-control-allow-origin: *`・`immutable` で 1 年 cache）
- アプリ側の CSP に要るもの（確認画面 `/admin` で実ブラウザ・Chrome で確かめた組）:
  - `connect-src` に工場のオリジン（GLB の取得）と `blob:`（three の GLTFLoader が埋め込みの画像を `blob:` の URL で読む。無いと質感が全部落ちる）
  - `script-src` に `'wasm-unsafe-eval'`（Draco の復号器の wasm のコンパイル）
  - `worker-src blob:`（DRACOLoader が Blob の URL で Worker を作る）
  - `style-src` に model-viewer が shadow root に入れる `<style>` の本文の hash（版ごとに違う。model-viewer 4.4.0 は `src/index.ts` の `MODEL_VIEWER_STYLE_HASH`）か、アプリ自前の許し方。拒否されると要素が 0×0 になり何も見えない
- Draco の復号器は自前に置いて `dracoDecoderLocation` を指す（既定の置き場は外部の gstatic）。model-viewer の script より前に `window.ModelViewerElement = { dracoDecoderLocation: '<自前の置き場>/' };` を実行する（確認画面は `public/admin/vendor/draco/` に three 0.183.2 の `draco_decoder.wasm`・`draco_wasm_wrapper.js` を置いている）
- ライセンスの表示は一覧の `attribution` をそのまま出す（`license` はライセンスの名前、`page_url` は提供元のページ）

## 載せなかったもの（理由つき）

- 国立科学博物館のヨシモトコレクション（Sketchfab・路上博物館）: CC BY-NC（非営利限定）
- スミソニアンのティラノサウルスの前あし: 記録に「非営利・教育・個人に限る」の注記
- 九州大学のニホンマムシ（CT）: CC BY-NC-SA
- NIH 3D: 分子の模型が中心で、赤血球そのものの立体は見つからなかった

## 提供元の状況（2026-11-07 時点）

- Sketchfab は 2026-08-12 に Epic Games から KitBash へ売却。埋め込み・oEmbed（`https://sketchfab.com/oembed?url=`）・CC ライセンスのダウンロードは変わっていない。「無料ダウンロードはいずれ終える」と 2024 年に予告あり（時期は未定）。消える備えとして、CC0 / CC BY のものは将来 GLB を取ってきて自前で見せる（download への移行）
- Smithsonian の 3d.si.edu は自動取得を断る（403）。確認はブラウザか検索の抜粋で行う。埋め込み用の `3d-api.si.edu` は 200 を返す
