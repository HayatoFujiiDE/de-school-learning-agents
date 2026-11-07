# 採点表（共通）— 形式と完全性、本文の形を採点する。事実の正しさは検証係と人が見る

1. `/mnt/session/outputs/material.json` が JSON として妥当で、必須キー schema_version, slug, title, kinds, catalog_item_id, concept_codes, summary, spark, parts をすべて持つ。**型も見る**: schema_version は数値の 2、kinds と parts[].kind は 1〜8 の整数、parts[].body は文字列の path（`parts/<part_id>/` 配下の .md）、parts[].files はオブジェクトの配列で各要素に path がある（文字列の配列は不可）、entry_point は {type, text} で type は look / touch / try / make のどれか。parts に `variants` が無い。ファイル名（最後の / より後ろ）が素材全体で一意
2. `claims.json` の各 claim に status（confirmed / hypothesis / unverified）と source_ids があり、source_ids の各 id が sources.json に存在する。status が confirmed の claim は is_primary: true の出典を 1 つ以上持つ。`text_elementary` があれば 1 文（形だけ見る）
3. `sources.json` の各出典に url, title, accessed_at, quoted_excerpt（取得したページ本文からの逐語引用、20〜300 文字）, license（不明なら unknown）がある。例外: 動画（YouTube）の出典の行（parts[].videos[] の source_id が指す行）は、ページを開けないので quoted_excerpt を空文字にする
4. 子ども向け本文（body.md と、あれば play.md）の、事実を述べる段落に claim id が `[c3]` の形で付いている
5. parts/ 配下の各 part に body.md（パーツが 2 つ以上なら `<part_id>-body.md`）があり、material.json の parts[].body がそれを指している。古い形のファイル（elementary-short.md / elementary-long.md / secondary-short.md / secondary-long.md / game.md）が無い
6. 子ども向けの文（body.md・play.md・summary・各 part の title・entry_point の text・questions_for_kids の text・interest_entries の text・動画の why）に次の語が無い: 点数、ランキング、順位、評価、成績、レベル、集中力、得意、苦手、上手、成長、データがありません、学びのバディ
7. 人名・児童名・教室名が無い。「確認済み」という語が無い
8. `adapt-rules.md` に「変えてよいこと」「変えてはいけないこと」の 2 つの見出しがある
9. `selfcheck.md` に 確か / 仮説 / 未確認 の三分類の自己点検と、実行した動作確認コマンドとその結果がある
10. 各 part の entry_point が「説明の前に触れること」（look / touch / try / make のどれか）を 1 文で示している
11. **最初の段落が動作**: body.md の最初の段落（見出しを除く最初の文のかたまり）が、読み手がする動作の文（「〜してみよう」「〜を見て」「〜を数えて」「〜を押して」など）で始まる。「〜とは」「〜です」「〜について」の説明文で始まっていない
12. **問いが答えより先**: body.md に、試す前に予想する問い（「〜と思う？」「どうなる？」「どっち？」）があり、その答えになる事実の段落より前に置かれている。questions_for_kids の各問いの文に、その claim_ids の事実（答え）が書かれていない
13. **1 段落 1 つ**: body.md の各段落が述べる新しい事柄は 1 つ（1 つの段落に別々の事実の claim 印が 2 つ以上ある時は、それらが 1 つの事柄の説明になっている）。段落は 3〜6 つ。本文は 600 字が目安で、記法と claim の印を除いて 1000 字以内
14. **目標語なし**: 子ども向けの文（6 と同じ範囲）に次の行の語が無い。
    目標語（正本）: 学習目標 / めあて / 学ぼう / 学びましょう / 学習しましょう / 覚えよう / 覚えましょう / 身につけよう / 身につけましょう / できるようになろう / できるようになりましょう / 理解しよう / 理解しましょう / マスターしよう / この単元 / 本時 / 目標は / 目標： / 目標: / ねらいは / ねらい： / ねらい:
    また、学びの目標を示す意味での「目標」「ねらい」や、「今日は〜を学びます」のような前置きが無い
15. **面白さの芯**: material.json の spark が 1〜2 文（20〜160 字）で、「何に気づくと面白いか」を述べている。「〜できるようになる」「〜を学ぶ」「〜を身につける」の形でない。body.md に spark の文がそのまま出ていない
16. **問いの種**: parts[].questions_for_kids が各 part に 2〜5 件。各件に id（素材全体で一意）・text（「？」で終わる）・claim_ids（1〜3 件、すべて claims.json にある）がある
17. **関心別の入口**: parts[].interest_entries の各件の interest が minecraft / programming / craft / digital / media / drawing のどれかで、text が 1〜2 文。body.md に「〜が好きなら」の段落が無い（入口は本文でなく interest_entries に置く）
18. parts[].files のうち `image_id` を持つ項目は、`alt`（絵の内容を日本語 1〜2 文、120 字以内）を持ち、`path` の拡張子が `.png` か `.webp`。画像の中身は採点しない（人が確認画面で見る）
19. material.json の parts[].videos があれば、各動画に `why`（見どころ）と `rights_note`（本人のアップと言える理由）があり、`source_id` の出典の行の url が `https://www.youtube.com/watch?v={youtube_id}` で対応している（形式だけを見る。動画の中身は採点しない）。版が決まっている題材（22）では、各動画の公開日（youtube_info の published）が今日から 3 年以内
20. 子ども向けの文（6 と同じ範囲）に、この素材のファイル名（app.html・figure-1.svg・body.md など）が書かれていない
21. parts/ 配下の .md が、見出し・段落・箇条書き・番号つき・太字・コード・リンク以外の記法（表・HTML のタグ・画像の埋め込み・引用の >）を使っていない
22. 版が決まっている題材（Minecraft など）では、material.json の conditions.tools に `Minecraft Java 版 <版>` の形で edition と版が書かれ、子ども向け本文のすべてのファイル（body.md と、あれば play.md）に「この説明は Java 版 <版> のものです」の 1 文（「Java 版」と版番号の両方）がある
23. material.json の parts[].models3d があれば、各件に catalog_id と why（見方）があり、source_id の出典の行の url が一覧の出典の url と同じ（形式だけ。モデルの中身は人が見る）
