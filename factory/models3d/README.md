# 立体モデル（3D）の一覧 — 工場が素材に使ってよいもの

`catalog.json` は、人が提供元の記録でライセンスを確かめた立体モデルの一覧です。職人（material-maker）はこの一覧に載っているものだけを素材に組み合わせます（自分で探さない）。`scripts/sync-claude-assets.sh` が `src/generated/models3d-catalog.ts` に書き出し、形が崩れていれば止まります。

## 載せる決まり

| 項目 | 決まり |
|---|---|
| ライセンス | CC0 / CC BY（`cc0` / `cc-by`）と、NASA の利用の決まり（`nasa-media`）だけ。非営利限定（NC）は載せない（将来の月額販売と合わない） |
| 確かめ方 | Sketchfab は Data API v3（`GET https://api.sketchfab.com/v3/models/<uid>` の `license.slug`）。Smithsonian は 3d.si.edu の記録の表示。NASA は brand center の利用の決まり。`checked_how` に書く |
| 見せ方（kind） | `sketchfab` = Sketchfab の公式の埋め込み（`https://sketchfab.com/models/<uid>/embed`）/ `voyager` = Smithsonian Voyager の公式の iframe（`https://3d-api.si.edu/voyager/3d_package:<id>`）/ `download` = 取ってきて自前で見せる予定（まだ素材に使わない） |
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

## 載せなかったもの（理由つき）

- 国立科学博物館のヨシモトコレクション（Sketchfab・路上博物館）: CC BY-NC（非営利限定）
- スミソニアンのティラノサウルスの前あし: 記録に「非営利・教育・個人に限る」の注記
- 九州大学のニホンマムシ（CT）: CC BY-NC-SA
- NIH 3D: 分子の模型が中心で、赤血球そのものの立体は見つからなかった

## 提供元の状況（2026-11-07 時点）

- Sketchfab は 2026-08-12 に Epic Games から KitBash へ売却。埋め込み・oEmbed（`https://sketchfab.com/oembed?url=`）・CC ライセンスのダウンロードは変わっていない。「無料ダウンロードはいずれ終える」と 2024 年に予告あり（時期は未定）。消える備えとして、CC0 / CC BY のものは将来 GLB を取ってきて自前で見せる（download への移行）
- Smithsonian の 3d.si.edu は自動取得を断る（403）。確認はブラウザか検索の抜粋で行う。埋め込み用の `3d-api.si.edu` は 200 を返す
