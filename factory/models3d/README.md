# 立体モデル（3D）の一覧 — 工場が素材に使ってよいもの

`catalog.json` は、人が提供元の記録でライセンスを確かめた立体モデルの一覧です。職人（material-maker）はこの一覧に載っているものだけを素材に組み合わせます（自分で探さない）。`scripts/sync-claude-assets.sh` が `src/generated/models3d-catalog.ts` に書き出し、形が崩れていれば止まります。

## 載せる決まり

| 項目 | 決まり |
|---|---|
| ライセンス | CC0 / CC BY（`cc0` / `cc-by`）と、NASA の利用の決まり（`nasa-media`）だけ。非営利限定（NC）は載せない（将来の月額販売と合わない） |
| 確かめ方 | 一覧に載せるだけでは学習者に届かない。**工場の権利の門番（契約 §AK。`docs/plans/rights/contract-AK.md`）が機械で確かめた記録**（D1 `rights_records`）がある項目だけが、注文票・取り込み検査・確認画面・学習者側の一覧・取り込み・配信に出る。根拠の種類: Sketchfab = 機械: 提供元の API（Data API v3 の `license.url`・投稿者 `uploader`・埋め込みの url を一覧と照らす）/ NASA = 機械: 提供元の記述（モデルのページの題名・Source の行・ファイルのリンクと、3D Resources のトップ・利用の決まりの文）/ DBCLS = 機械: CC の URL（`evidence_url` のページの creativecommons.org の URL。**埋め込みだけ**の根拠で、自前で配る根拠にはしない）/ Smithsonian = 人の記録（自動取得を拒むので `checked_how` を人が書く。**埋め込みだけ**）。ライセンスの種類は機械が `license.url` から決める（一覧の `license.code`・`label` は見せ方に使わない）。一覧の対象の値（url・`uploader`・`evidence_url`・`attribution`・`title_src`・`checked_at`・`checked_how`）を変えると記録の指紋が合わなくなり、確かめ直すまで出ない |
| 見せ方（kind） | `sketchfab` = Sketchfab の公式の埋め込み（`https://sketchfab.com/models/<uid>/embed`）/ `voyager` = Smithsonian Voyager の公式の iframe（`https://3d-api.si.edu/voyager/3d_package:<id>`）/ `download` = 取ってきて自前で見せる（契約 §AJ2・§AK。根拠が `api` / `statement` の記録が通った直後に工場が取り込み、その sha を `rights_hosted` に記録したもの = GLB・24 MiB まで だけが素材に使える。`cc-url` と人の記録の件は自前で配らない） |
| 出典 | `page_url` は提供元のそのモデルのページ。素材の sources.json にはこの url を一字も変えずに書く |
| 題材の札（topics） | 1〜8 個。職人が題材から探す手がかり（恐竜・クジラ・昆虫・花・宇宙 など） |

## 足し方

1. 提供元の記録でライセンスを確かめる（上の確かめ方）。NC・ND・不明は載せない。提供元が門番の台帳（`factory/worker/src/rights-providers.ts`）に無ければ、台帳に足す PR が先（足さないと「確かめ方が未登録」で出ない）
2. `catalog.json` の `models` に 1 件足す（`id` は `[a-z0-9-]`・一意。`checked_at` は確かめた日）。`uploader` は Sketchfab の投稿者の username（`sketchfab` は必須・英数字と `_ . -`。他は `null`）。`evidence_url` は権利の根拠のページ（`dbarchive.biosciencedbc.jp` の `download` は必須・`download` 以外は `null`）。`license.url` は実在する組み合わせ（`src/rights.ts` の `licenseCodeOfUrl`）でなければ止まる
3. `cd factory/worker && bash scripts/sync-claude-assets.sh && npx vitest run test/models3d-catalog.test.ts`
4. commit（生成ファイル `src/generated/models3d-catalog.ts` も一緒に）。deploy の後、cron（10 分ごとに 5 件まで）か確認画面の「立体モデル」ページの「権利を確かめる」で記録ができると出る

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

## 子ども向けアプリでの見せ方（契約 §AJ2-4・§AK-4）

- 一覧は `GET <工場のオリジン>/api/library/models3d`（認証なし・`access-control-allow-origin: *`・10 分 cache）。**権利の門番を通った項目だけ**が入る（記録の無い項目・止めた項目は入らない）。material.json の `parts[].models3d[].catalog_id` をここの `id` で引く（無ければ描かない）。埋め込みの件（`kind` が `sketchfab` / `voyager`）は `embed_url` を iframe に渡す（形の再確認は §AJ-4 と同じ 2 つの正規表現）
- 取り込み済みの `download` の件には `file_url`（**絶対 url**）・`bytes`・`sha256` が付く。`file_url` はそのまま `<model-viewer src="…">` に渡す（工場とアプリは別オリジンなので、相対の url に組み直さない）。配信は `GET /api/library/models3d/files/<id>/<sha256>.glb`（`content-type: model/gltf-binary`・`access-control-allow-origin: *`・1 日 cache。権利の記録が通っていて、その sha を確認のもとで取り込んだ時だけ 200）
- アプリ側の CSP に要るもの（確認画面 `/admin` で実ブラウザ・Chrome で確かめた組）:
  - `connect-src` に工場のオリジン（GLB の取得）と `blob:`（three の GLTFLoader が埋め込みの画像を `blob:` の URL で読む。無いと質感が全部落ちる）
  - `script-src` に `'wasm-unsafe-eval'`（Draco の復号器の wasm のコンパイル）
  - `worker-src blob:`（DRACOLoader が Blob の URL で Worker を作る）
  - `style-src` に model-viewer が shadow root に入れる `<style>` の本文の hash（版ごとに違う。model-viewer 4.4.0 は `src/index.ts` の `MODEL_VIEWER_STYLE_HASH`）か、アプリ自前の許し方。拒否されると要素が 0×0 になり何も見えない
- Draco の復号器は自前に置いて `dracoDecoderLocation` を指す（既定の置き場は外部の gstatic）。model-viewer の script より前に `window.ModelViewerElement = { dracoDecoderLocation: '<自前の置き場>/' };` を実行する（確認画面は `public/admin/vendor/draco/` に three 0.183.2 の `draco_decoder.wasm`・`draco_wasm_wrapper.js` を置いている）
- 出典の表示は一覧 API の 4 つをそのまま出す: `attribution`（出典の書き方）・`license`（ライセンスの名前。機械が決めた code から）・`license_url`（ライセンスの url）・`page_url`（提供元のページ）。`license_code` は機械の判定用（`cc0` / `cc-by` / `nasa-media` など）

## 載せなかったもの（理由つき）

- 国立科学博物館のヨシモトコレクション（Sketchfab・路上博物館）: CC BY-NC（非営利限定）
- スミソニアンのティラノサウルスの前あし: 記録に「非営利・教育・個人に限る」の注記
- 九州大学のニホンマムシ（CT）: CC BY-NC-SA
- NIH 3D: 分子の模型が中心で、赤血球そのものの立体は見つからなかった

## 提供元の状況（2026-11-07 時点）

- Sketchfab は 2026-08-12 に Epic Games から KitBash へ売却。埋め込み・oEmbed（`https://sketchfab.com/oembed?url=`）・CC ライセンスのダウンロードは変わっていない。「無料ダウンロードはいずれ終える」と 2024 年に予告あり（時期は未定）。消える備えとして、CC0 / CC BY のものは将来 GLB を取ってきて自前で見せる（download への移行）
- Smithsonian の 3d.si.edu は自動取得を断る（403）。確認はブラウザか検索の抜粋で行う。埋め込み用の `3d-api.si.edu` は 200 を返す

## 取り込み（複製して自前で配る）の権利（2026-11-07 確認）

埋め込み（Sketchfab / Smithsonian Voyager の公式の iframe）は提供元のサーバーがそのまま見せるので、複製の権利は要らない。**取り込み（`download`。GLB を工場の R2 に置いて配る）は複製と公衆送信にあたるので、提供元が再配布を許しているものだけ**を一覧に載せる。

| 提供元 | 根拠（確かめたページ） | 取り込んでよいか | 条件 |
|---|---|---|---|
| NASA 3D Resources | https://science.nasa.gov/3d-resources/ （「free to download and use」）・配布元 GitHub `nasa/NASA-3D-Resources` の README（「free and without copyright」）・利用の決まり https://www.nasa.gov/nasa-brand-center/images-and-media/ | よい（教育・情報目的は明示。商用も条件つきで可） | 出典を書く（各ページの Source の行をそのまま `attribution` に）・NASA の推薦と誤解させない・NASA のロゴや記章を自分の商品・宣伝・ブランドに使わない（模型の表面に写っているロゴは実物の再現なので問題にしない）・第三者の著作物と明記されたものは別途許諾が要る（Source が NASA 以外の名前なら一覧に載せる前に確かめる）・「著作権の対象外」は米国内の話で、日本での扱いは NASA の許諾文に依る |
| DBCLS BodyParts3D | 配布元の最新の README（CC BY 4.0） | よい（CC BY 4.0 は複製・改変・商用を許す） | 出典とライセンスの表示・形式を変えた（OBJ → GLB）ことを書く・古い版（CC BY-SA 2.1 JP）は使わない |
| Sketchfab の CC0 / CC BY | Data API の `license.slug` | 将来取り込むなら可（CC0 は条件なし・CC BY は出典の表示） | Sketchfab の「Standard」等の独自ライセンスは再配布不可なので載せない |
| Smithsonian 3D（CC0） | 記録のページの表示 | 可 | 記録の表示を正とする（ファイルの中の著作権表示と字面が違う点は `contract-AJ.md` 未確認の点） |

NC（非営利限定）は埋め込みでも取り込みでも載せない（将来の月額販売と合わない）。
