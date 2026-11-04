# 採点表（共通）— 形式と完全性だけを採点する。内容の正しさは検証係と人が見る

1. `/mnt/session/outputs/material.json` が JSON として妥当で、必須キー schema_version, slug, title, kinds, catalog_item_id, concept_codes, summary_elementary, summary_secondary, parts をすべて持つ。**型も見る**: schema_version は数値の 1、kinds と parts[].kind は 1〜8 の整数、parts[].variants と parts[].files はオブジェクトの配列で各要素に path がある（文字列の配列は不可）、entry_point は {type, text} で type は look / touch / try / make のどれか。ファイル名（最後の / より後ろ）が素材全体で一意
2. `claims.json` の各 claim に status（confirmed / hypothesis / unverified）と source_ids があり、source_ids の各 id が sources.json に存在する。status が confirmed の claim は is_primary: true の出典を 1 つ以上持つ
3. `sources.json` の各出典に url, title, accessed_at, quoted_excerpt（取得したページ本文からの逐語引用、20〜300 文字）, license（不明なら unknown）がある
4. 子ども向け本文（parts/ 配下の .md）の、事実を述べる段落に claim id が `[c3]` の形で付いている
5. parts/ 配下の各 part に elementary-short.md, elementary-long.md, secondary-short.md, secondary-long.md の 4 つがあり、material.json の variants がそれらを指している
6. parts/ 配下の本文と summary_elementary / summary_secondary に次の語が無い: 点数、ランキング、順位、評価、成績、レベル、集中力、得意、苦手、上手、成長、データがありません、学びのバディ
7. 人名・児童名・教室名が無い。「確認済み」という語が無い
8. `adapt-rules.md` に「変えてよいこと」「変えてはいけないこと」の 2 つの見出しがある
9. `selfcheck.md` に 確か / 仮説 / 未確認 の三分類の自己点検と、実行した動作確認コマンドとその結果がある
10. 各 part の entry_point が「説明の前に触れること」（look / touch / try / make のどれか）を 1 文で示している
11. ゲーム的な形（お題・クイズ・「なし」を当てる など）の変奏 `parts/<part_id>/game.md` が素材全体で 1 つ以上あり、material.json の variants に game: true で載っている
12. 詳しい版（elementary-long.md / secondary-long.md）に、関心別の入口の例（マイクラ / プログラミング / ものづくり / デジもの / 画像・動画 / 絵 のうち 2 つ以上）が「〜が好きなら」の形で書かれている
11. parts[].files のうち `image_id` を持つ項目は、`alt`（絵の内容を日本語 1〜2 文、120 字以内）を持ち、`path` の拡張子が `.png` か `.webp`。画像の中身は採点しない（人が確認画面で見る）
