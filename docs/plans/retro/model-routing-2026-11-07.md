# Sonnet 5.5 と Opus 5.5 の使い分け — ベンチマーク調査（2026-11-07）

オーナー指示「Sonnet はうまく使いたい。得意・不得意があるので信頼できるベンチマークで決める」を受けた調査の記録。次にモデルの割り当てを考える時は、ここから始める（数字は 2026-11-07 時点。新しいモデルや版が出たら取り直す）。機械が読む用の全データは同じフォルダの `model-routing-2026-11-07.json`。

## 調べ方
- 4 経路を並行: Anthropic 公式（発表・system card・料金）／第三者の独立ベンチ（Artificial Analysis・LMArena・SWE-bench 等）／日本語・教材向けの評価／工場のコードの作業の中身。
- 集めた数字は 1 件ずつ別の係が元ページを開いて反証を試み、確かめられたものだけを使った（確かめた 46 件・落とした 2 件）。

## 結論

- **「純粋なコードは Opus と同等」**: 一部だけ確かめられた。「範囲のはっきりしたコード作業なら Sonnet と Opus はほぼ同等」はベンチで裏づけがある。Terminal-Bench 4.0 は Sonnet 70.6% 対 Opus 66.4% で誤差の範囲、FrontierSWE v2 は 61.9 対 62.3、CursorBench は max 同士で 55.5 対 57.8、FrontierCode は Sonnet xhigh 52.1 対 Opus 54.4。ただし同等なのは Sonnet を xhigh〜max で動かした時だけで、その時は 1 タスクあたりの費用も Opus とほぼ同じになる（AA 実測 $10.02 対 $10.04。公式も "At higher settings, it can perform comparably at a similar cost" と書いている）。一方、複数ファイルにまたがる大きな修正（SWE-bench Pro 89.9 対 81.3 で Opus が +8.6）、長い文脈（ProgramBench +11.5）、画面を見ながらの修正（SWE-bench Multimodal +7.1）、何段階も続く自律作業（Design Arena Agentic +171 Elo）では Opus がはっきり上。「Opus と同等」という書き方の文言は Anthropic 公式には無い。


## 作業ごとの割り当て（オーナー判断 2026-11-07: 方針 A = 先に作り直しの回数と理由を見える化 → コードだけの作り直しから Sonnet を試す）

| 作業 | 推奨 | 根拠 | 費用の変化 | 質のリスクと見張り方 |
|---|---|---|---|---|
| 職人の下書き（draft。1 session で本文・SVG・app.html・出典・selfcheck をまとめて作る） | 根拠不足 — 試験で決める（それまでは Sonnet 5.5 high のまま） | 作業の中身によって有利なモデルが逆になる。【Sonnet でもほぼ同じ】HTML/JS の単発生成。LMArena WebDev は Sonnet xHigh 1770（3位）対 Opus Max 1810（+40、信頼区間は重ならない）。Design Arena Frontend Web App は +25。【Opus がはっきり上】日本語の文章は Arena 日本語 +70（約200票で区間がわずかに重なる）、創作文 +52、指示追従 +36。事実の正確さは AA-Omniscience +18。何段階も続く自律作業は Design Arena Agentic +171。【effort】Sonnet は high と xhigh で差が大きい（CursorBench は high 47.8、xhigh 53.1、max 55.5）。子ども向けのやさしい日本語を測った公開ベンチは無い。 | 今の実測は Sonnet high で 1 本 $6.17。Opus にした場合、単価は 2 倍だが AA の max 計測では Opus の出力トークンが約 0.6 倍だったので、$6〜12 程度と見込む（未実測）。下書きが良くなって作り直し（Opus で 1 回 $4.58〜16）が 1 回でも減れば、注文 1 本の合計は安くなりうる。判断の物差しは下書き単価ではなく『承認までの合計費用』。 | Sonnet のままにすると、日本語本文と多段階作業の質が作り直しの多さとして出ている可能性がある。ただし 5 回作り直した原因はまだ切り分けていない。見るもの: 注文ごとの作り直し回数、初回の承認率、差し戻し理由の種類（本文・事実・コード・図）、検証係の『矛盾・未確認』の件数、app.html の selfcheck 失敗数。effort を medium へ下げるのは禁止（CursorBench 39.2）。 |
| 作り直し（rework。人の差し戻しも auto_return も） | 条件つき（試験で確かめてから）。差し戻し理由がコード・SVG・app.html の局所修正だけなら Sonnet 5.5 xhigh 候補、本文・事実・見た目・複数ファイルにまたがる理由なら Opus 5.5 のまま。今の構成は 1 session = 1 モデルなので、理由ごとに分けるには triage の理由分類でモデルを選ぶ改修が要る。 | 作り直しは『関係する所だけ直す』作業。範囲の決まった修正では差が小さい: FrontierCode（範囲外の変更は減点）は Sonnet xhigh 52.1 対 Opus 54.4、CursorBench は max 同士で -2.3、Terminal-Bench は Sonnet が上。一方、複数ファイルの大きな差分（SWE-bench Pro +8.6）、画面・デザインを見ながらの修正（SWE-bench Multimodal +7.1）、日本語の文章（Arena 日本語 +70、指示追従 +36）、毎回成功する安定性（Toolathlon Pass³ +3.7）は Opus が上。Sonnet は max にすると範囲外の編集が増えた例がある（FrontierCode 脚注。Claude Code の code-review skill が原因で、Managed Agents に同じことが起きるかは未確認）ので、max ではなく xhigh にする。 | Opus の実測は 1 回 $4.58（1 件のみ）。Sonnet にすると単価は半分だが、AA の max 計測では出力トークンが約 1.65 倍で、費用差はほぼ消えた。期待できる節約は 1 回あたり $0〜2.3 で幅が大きく、実測で決める。作り直しの回数が減らなければ、モデルを替えても費用の問題は解けない。 | docs/plans/retro/contract-S.md:8 に『制作のモデルを下げる、は禁止の方向』とあり、Opus から Sonnet へ下げるのはオーナー方針に触れる。変えるならオーナーの判断が要る。モデル id は 4 か所（jobs.ts:366 の直書き、env.ts:180 JOB_MODEL.rework、material-maker.md と claude-lock、CONTRACT-factory.md:429-446）を揃える。見るもの: 同じ理由での再差し戻し率、差し戻し理由の解消率、変えていないファイルへの差分の量（範囲外の編集）、作り直し 1 回の費用。 |
| 検証係（verify。Opus、Batch） | Opus 5.5 のまま | 事実の正確さと幻覚の少なさは AA-Omniscience Net Score で Opus 48 対 Sonnet 30（+18。第三者の評価）。ツールなしの推論は HLE で +7.5（自己申告）、HLE-Diamond で +15（AA）。図を読む力は Chartography ツールなしで +2.8。どれも検証係の仕事に直結し、差も大きい。オーナーの決定（CONTRACT-factory.md:789）とも一致する。 | 実測は 1 回 35〜36¢（動画の 10¢ を含む）。Sonnet にしても節約は 1 回あたり最大 13¢ 程度で、ほぼ効果がない。 | 検証係は質を守る最後の砦なので、ここを下げると下書き・作り直しを Sonnet にする前提そのものが崩れる。見るもの: 検証係の判定と人の承認判断が食い違う率（下書きの A/B を評価する時の物差しにもなる）。 |
| お題の生成（topics gen） | Sonnet 5.5 のまま | 日本語の文章（Arena 日本語 +70）と事実の正確さ（Omniscience +18）は Opus が上。ただしお題には後段に『検査（引用が主張を支えるか）』と Worker 自身による web_fetch があり、事実の誤りはそこで止められる。知識労働の成果物は GDPval-AA で 1844 対 1846 とほぼ同じ。 | 実測は 1 回 13〜18¢。Opus にすると約 2 倍（+13〜18¢）。金額は小さいが、変えても得るものの根拠が弱い。 | 見るもの: 検査での unsupported / unclear の率、形の検査で捨てられる率（18¢ 全部を捨てた例あり）、人がお題を却下する率。これが高ければ Opus との A/B に回す。 |
| お題の検査（topics check。引用が主張を支えるか、重い話題か） | 根拠不足 — 試験で決める（それまでは Sonnet 5.5 のまま） | 文書を根拠にした判断は OfficeQA で Opus が約 +2（76.9 対 78.9）と近い。ただしこの検査は『緑なら自動公開』の門番で、重い話題かどうかを判断する力を測ったベンチは無い。事実と幻覚の Omniscience は Opus +18。 | 実測 0〜3¢、取り置き 15¢。Opus にしても 1 回 +3¢ 程度で、費用面の理由ではどちらとも決まらない。 | 検査の見落としは、そのまま公開事故になる。見るもの: 自動公開されたお題のうち人が後で取り下げた率、supported と判定したのに引用が主張を支えていなかった件数。 |
| エージェント会議（meeting。月 2 回、Batch） | Sonnet 5.5 のまま | 知識労働と企画に近い GDPval-AA は 1844 対 1846、AA-Briefcase は 1811 対 1822（独立評価では 1813 対 1800 で Sonnet が上）で同等。 | 月の上限 $10。変更しないので費用は変わらない。 | 提案がオーナーにどれだけ採用されたか（採用率）を見るだけで十分。 |
| 振り返り係・改善係（retro。注文ごと、Batch） | Sonnet 5.5 のまま | 数字の分析と提案。OfficeQA（文書からの数値推論）は約 -2 で近く、GDPval も同等。入力は数字と列挙値だけで、日本語の文章の質は問われない。 | 1 件 2¢ 未満。変更しない。 | tips を自動で反映しているので、反映後に費用は下がったが質が落ちていないかを確かめる（contract-S.md:8 の『質を下げる工夫は入れない』）。 |
| 収集部隊の仕分け（scout）・動画の記録（Gemini）・画像の生成（gpt-image） | 変更なし（今回の比較の対象外） | 確かめたベンチは Sonnet 5.5 と Opus 5.5 の比較だけで、Haiku・Gemini・gpt-image の数字は無い。 | 変化なし | 対象外 |

## 試験の設計

- 【A/B 1：下書きのモデル（いちばん効果が大きい）】過去に作り直しが多かった注文から、型3と型4を混ぜて 6 本選ぶ。同じ注文書（brief）で、A=Sonnet 5.5 high（今の設定）、B=Opus 5.5 high の下書きを 1 本ずつ作る。評価は見た目でどちらか分からない状態で、オーナーか検証係が行う。測るもの: (1) 初回の承認か差し戻しか、(2) 差し戻し理由の数と種類（本文・事実・コード・図）、(3) 検証係の『矛盾・未確認』の件数、(4) app.html の selfcheck 結果、(5) 下書き費用。作り直しはどちらの側も最大 1 回までにして、『承認までの合計費用』を比べる。費用の上限は 6 本 × 2 方式 × (下書き $8 + 作り直し $10) = $216 で打ち切る。判断の基準: B の作り直しが 1 本あたり 1 回以上少なく、合計費用が A 以下なら、下書きを Opus にする。
- 【A/B 2：作り直しのモデルを差し戻し理由ごとに】同じ前の版と同じ差し戻し理由を、A=Opus 5.5 high、B=Sonnet 5.5 xhigh の両方に渡す。理由を『コード・SVG・app.html だけ』と『本文・事実・見た目を含む』に分け、それぞれ 4 件、合計 8 件 × 2 方式で行う。測るもの: 理由が解消されたか（人が判定）、変えていないファイルへの差分の量（範囲外の編集）、検証係の判定、費用。上限は 16 回 × $10 = $160。判断の基準: コードだけの理由で B の解消率が A と同じで、費用が明らかに安い時だけ、理由ごとにモデルを分ける改修を検討する（contract-S.md:8 との関係はオーナーが判断する）。
- 【A/B 3：お題の検査】D1 に保存されている過去の検査の入力（お題と取得済みの引用）を 40 件、Batch で Sonnet と Opus の両方に再判定させる。判定が食い違った件だけ人が正解を決め、どちらの誤りが『自動公開してはいけないものを通した』側かを数える。費用は数十セント。Opus の方が通してはいけないものを確実に減らすなら、+3¢/回で切り替える。
- 【前提として先に記録を整える】『同じ教材を 5 回作り直した』原因はまだ切り分けていない。候補は、モデルの質、差し戻し理由が職人に伝わっていない、注文の要件が曖昧、など。A/B を始める前に、注文ごとの作り直し回数・理由の種類・各回の費用を retro の D1 から並べて見られるようにする。原因がモデル以外なら、モデルを替えても費用は下がらない。

## 注意点（根拠の弱い所）

- ベンチのほとんどは英語中心で、Anthropic の自己申告（max effort、5試行平均）。第三者が実行したのは FrontierCode、CursorBench、FrontierSWE、GDPval-AA と Briefcase、AutomationBench、AA と Arena の各評価。子ども向けのやさしい日本語の評価と、日本語単独のベンチ（Nejumi・Swallow・JMMLU）には、5.5 世代の値が無い。
- effort の条件がそろっていない比較が多い（Arena は Opus High/Max 対 Sonnet xHigh、Terminal-Bench は Opus xhigh 対 Sonnet max など）。Sonnet の高いスコアは多くが xhigh か max の値で、今の下書き設定 high での値ではない。
- FrontierCode で Sonnet が max で点を落とした件は Claude Code の code-review skill が原因で、工場の Managed Agents で同じことが起きるかは確かめていない。
- 費用の実測は少ない。作り直しは $4.58 の 1 件、下書きは $6.17 の 1 件だけ。同じ注文を Sonnet と Opus の両方で作って比べた値は無い。AA の 1 タスク費用（$10.02 対 $10.04）は max effort での値。二次記事にある $7.60 対 $5.98 は確かめていないので使っていない。『Opus の既定 effort は medium』も一次情報では確かめていない。
- contract-S.md:8 にある『制作のモデルを下げる』は禁止の方向、という方針があるので、作り直しを Opus から Sonnet へ下げる判断はオーナーが決める。
- 今の構成では、モデルを session 単位でしか選べない。下書きの中で『本文は Opus、app.html は Sonnet』のように分けるには、session を分ける設計変更が必要になる。

## 料金（公式。100 万トークンあたり）

- 公式 platform.claude.com pricing（2026-11-07取得）: Claude Sonnet 5.5 は入力 $2/MTok・5分キャッシュ書き込み $2.50・1時間キャッシュ書き込み $4・キャッシュ読み $0.10・出力 $10。Claude Opus 5.5 は $4・$5・$8・$0.20・$20。Sonnet の単価は Opus のちょうど半分。

## 確かめた数字（46 件）

| ベンチ | Sonnet 5.5 | Opus 5.5 | 出典 |
|---|---|---|---|
| SWE-bench Pro | 81.3% | 89.9% | https://www.anthropic.com/document/claude-sonnet-5-5-system-card （取得 2026-11-07） |
| SWE-bench Multilingual | 90.3% | 93.9% | https://www.anthropic.com/document/claude-sonnet-5-5-system-card （取得 2026-11-07） |
| SWE-bench Multimodal | 54.3% | 61.4% | https://www.anthropic.com/document/claude-sonnet-5-5-system-card （取得 2026-11-07） |
| DeepSWE v1.1（長時間のソフトウェア開発 113課題） | 71.0% | 74.2% | https://www.anthropic.com/document/claude-sonnet-5-5-system-card ・ https://www.anthropic.com/claude-opus-5-5-system-card （取得 2026-11-07） |
| FrontierCode v1.1 Main（Cognition 作） | 52.1%（xhigh。Sonnet の最高値）／46.2%（max） | 54.4%（max）。medium（既定）では 54.6% | https://www.anthropic.com/news/claude-sonnet-5-5 ・ https://www.anthropic.com/news/claude-opus-5-5 ・ Sonnet system card （取得 2026-11-07） |
| Terminal-Bench 4.0 | 70.6%（max・±2.5） | 66.4%（xhigh・±2.6）。max では 64.8% | https://www.anthropic.com/document/claude-sonnet-5-5-system-card （取得 2026-11-07） |
| CursorBench 4.0 | 55.5%（max）／53.1%（xhigh）／47.8%（high）／39.2%（medium） | 57.8%（max）。medium（既定）では 52.5% | https://www.anthropic.com/news/claude-sonnet-5-5 ・ system card （取得 2026-11-07） |
| FrontierSWE v2（Proximal 作、超長時間の 34課題） | 61.9% | 62.3% | https://www.anthropic.com/document/claude-sonnet-5-5-system-card （取得 2026-11-07） |
| ProgramBench（長文脈・166課題） | 79.7% | 91.2% | https://www.anthropic.com/document/claude-sonnet-5-5-system-card （取得 2026-11-07） |
| OSWorld 2.1 | partial 80.1% / strict 43.5% | partial 81.8% / strict 48.7% | https://www.anthropic.com/document/claude-sonnet-5-5-system-card （取得 2026-11-07） |
| Humanity's Last Exam | ツールなし 56.9% / ツールあり 64.5% | ツールなし 64.4% / ツールあり 67.7% | https://www.anthropic.com/document/claude-sonnet-5-5-system-card （取得 2026-11-07） |
| ArXivMath（2026年8月版） | ツールなし 86.8% / ツールあり 95.2% | 91.2% / 96.9% | https://www.anthropic.com/document/claude-sonnet-5-5-system-card （取得 2026-11-07） |
| GDPval-AA v2.1（Artificial Analysis 作） | 1844 Elo（max）／1725（xhigh） | 1846 Elo（max） | https://www.anthropic.com/document/claude-sonnet-5-5-system-card （取得 2026-11-07） |
| AA-Briefcase v1.1 | 1811 Elo（max）／1746（xhigh） | 1822 Elo（max） | https://www.anthropic.com/document/claude-sonnet-5-5-system-card （取得 2026-11-07） |
| Toolathlon-Verified | Pass@1 77.8 / Pass³ 68.5 / 平均 31.6ターン | Pass@1 77.8 / Pass³ 72.2 / 平均 26.9ターン | https://www.anthropic.com/document/claude-sonnet-5-5-system-card （取得 2026-11-07） |
| AutomationBench（Zapier 作） | 44.7% | 42.5%（refusal を fallback で再実行した値）／40.0%（再実行なし） | https://www.anthropic.com/document/claude-sonnet-5-5-system-card （取得 2026-11-07） |
| Chartography（Surge AI 作） | ツールなし 61.6% / ツールあり 90.2% | 64.4% / 89.0% | https://www.anthropic.com/document/claude-sonnet-5-5-system-card （取得 2026-11-07） |
| BenchCAD Vision2Code（1000件のサブセット） | 0.747（ツールなし）/ 0.963（ツールあり） | 0.730 / 0.962 | https://www.anthropic.com/document/claude-sonnet-5-5-system-card （取得 2026-11-07） |
| GMMLU（42言語）／MILU（11言語） | GMMLU 92.1% / MILU 91.6% | GMMLU 94.3% / MILU 93.1% | https://www.anthropic.com/document/claude-sonnet-5-5-system-card （取得 2026-11-07） |
| OfficeQA / OfficeQA Pro（Databricks 作） | 76.9% / 65.6% | 78.9% / 67.7% | https://www.anthropic.com/document/claude-sonnet-5-5-system-card （取得 2026-11-07） |
| HealthBench Professional（長さ補正後）／PhysicianBench | 69.2%（補正前は 77.1%）／63.2% | 65.6%（補正前は 77.1%）／68.4% | https://www.anthropic.com/document/claude-sonnet-5-5-system-card （取得 2026-11-07） |
| Artificial Analysis Intelligence Index（総合・Max effort） | 55（69モデル中9位） | 59（69モデル中2位） | https://artificialanalysis.ai/models/comparisons/claude-opus-5-5-vs-claude-sonnet-5-5 （取得日2026-11-07。個別ページ https://artificialanalysis.ai/models/claude-sonnet-5-5 / https://artificialanalysis.ai/models/claude-opus-5-5 も同値） |
| FrontierCode（難度の高いエージェント型コーディング） | AA独立 v2.0: 42% / Anthropic v1.1 Main: 46.2%（Max）、52.1%（Xhigh。表の列配置からの推定） | AA独立 v2.0: 46% / Anthropic v1.1: 54.4% | https://artificialanalysis.ai/models/comparisons/claude-opus-5-5-vs-claude-sonnet-5-5 ／ https://www.anthropic.com/news/claude-sonnet-5-5 |
| CursorBench 4.0 | 55.5% | 57.8% | https://www.anthropic.com/news/claude-sonnet-5-5 |
| SWE-bench Pro / SWE-bench Multilingual | Pro 81.3 / Multilingual 90.3（Max） | Pro 89.9 / Multilingual 93.9 | https://apidog.com/blog/claude-sonnet-5-5-benchmarks/ （二次。一次の system card は取得できていない） |
| Code Arena WebDev（LMArena→arena.ai） | xHigh: 1770±11（3位、4,469票）/ High: 1711±9（8位） | Max: 1810±13（1位、3,473票） | https://arena.ai/leaderboard/webdev （取得日2026-11-07） |
| Text Arena（総合 / Coding / Instruction Following / 日本語） | 総合 1477±7（31位）/ Coding 1529±13（24位）/ IF 1486±11（18位）/ 日本語 1465±40（30位、205票） | 総合 1509±7（3位）/ Coding 1551±12（3位）/ IF 1522±10（3位）/ 日本語 1535±41（2位、214票） | https://arena.ai/leaderboard/text ／ https://arena.ai/leaderboard/text/coding ／ https://arena.ai/leaderboard/text/instruction-following ／ https://arena.ai/leaderboard/text/japanese （取得日2026-11-07） |
| AA-PersonalityBench（文体の比較） | Lexically Varied 17% / Eloquent 23% / Natural Sounding 28% / Literate 40% | 同 83% / 77% / 72% / 60% | https://artificialanalysis.ai/models/comparisons/claude-opus-5-5-vs-claude-sonnet-5-5 |
| HLE-Diamond / CritPt v2 / Terminal-Bench-Science（AA）、HLE with tools（Anthropic） | HLE-Diamond 53% / CritPt 59% / TB-Science 53% / HLE with tools 64.5%（自己申告） | 68% / 68% / 59% / 67.7%（自己申告） | https://artificialanalysis.ai/models/comparisons/claude-opus-5-5-vs-claude-sonnet-5-5 ／ https://www.anthropic.com/news/claude-sonnet-5-5 |
| AA-Omniscience v1.1（知識の正確さと幻覚の少なさ） | 30（Net Score） | 48（Net Score）。Xhigh の Accuracy は 66% | https://artificialanalysis.ai/models/comparisons/claude-opus-5-5-vs-claude-sonnet-5-5 ／ https://artificialanalysis.ai/evaluations/omniscience |
| GDPval-AA v2.1 / AA-Briefcase v1.1 / GDP.pdf / AutomationBench-AA | 自己申告 GDPval 1844、Briefcase 1811 / AA独立 Briefcase 1813、GDP.pdf 26%、AutomationBench 72% | 自己申告 GDPval 1846、Briefcase 1822 / AA独立 Briefcase 1800、GDP.pdf 26%、AutomationBench 70% | https://www.anthropic.com/news/claude-sonnet-5-5 ／ https://artificialanalysis.ai/models/comparisons/claude-opus-5-5-vs-claude-sonnet-5-5 |
| OSWorld 2.1 partial / Chartography | OSWorld 80.1% / Chartography 61.6% | 81.8% / 64.4% | https://www.anthropic.com/news/claude-sonnet-5-5 |
| 速度・トークン効率（AA） | 151 tok/s、1タスク31.5分、出力285k/タスク、$10.02/タスク | 104 tok/s、1タスク27.7分、出力173k/タスク、$10.04/タスク | https://artificialanalysis.ai/models/comparisons/claude-opus-5-5-vs-claude-sonnet-5-5 |
| Global MMLU (GMMLU), 42言語の平均。Global-MMLUの42言語には日本語が入る | 92.1% | 94.3%（比較用: Fable 5.1 94.0%、Sonnet 5 89.2%） | https://www.anthropic.com/claude-sonnet-5-5-system-card（PDFへ転送: https://assets.claude.com/870c8f525702625d2c62fc6dd04c857e3250bec1.pdf、2026-11-07取得、pdftotextで抽出した本文から引用） |
| MILU（インドの10言語と英語） | 91.6% | 93.1% | https://assets.claude.com/870c8f525702625d2c62fc6dd04c857e3250bec1.pdf（2026-11-07取得） |
| LMArena (arena.ai) Text — Japanese カテゴリ | Claude Sonnet 5.5 (xHigh): 30位, 1465 ±40, 205票 | Claude Opus 5.5 (High): 2位, 1535 ±41, 214票（1位は Fable 5.1 (Max) 1553） | https://arena.ai/leaderboard/text/japanese（lmarena.aiから転送、2026-11-07取得） |
| LMArena (arena.ai) Text — Creative Writing カテゴリ（言語は問わない） | Claude Sonnet 5.5 (xHigh): 23位, 1468 ±14, 2,278票 | Claude Opus 5.5 (High): 1位, 1520 ±13, 2,672票 | https://arena.ai/leaderboard/text/creative-writing（2026-11-07取得） |
| LMArena (arena.ai) Text 総合 | Claude Sonnet 5.5 (xHigh): 31位, 1477 ±7, 10,033票 | Claude Opus 5.5 (High): 3位, 1509 ±7, 11,415票 | https://arena.ai/leaderboard/text（2026-11-07取得） |
| LMArena (arena.ai) WebDev（HTML/JSのWebアプリ生成を人が投票で比べる） | Sonnet 5.5 (xHigh): 3位, 1770 ±11, 4,469票 / Sonnet 5.5 (High): 8位, 1711 ±9 | Opus 5.5 (Max): 1位, 1810 ±13, 3,473票 | https://arena.ai/leaderboard/webdev（2026-11-07取得） |
| Design Arena — Website | 10位, Elo 1315 | 6位, Elo 1326（1位 Muse Wonder (max) 1369） | https://www.designarena.ai/leaderboard/website（2026-11-07取得） |
| Design Arena — Frontend Web App | 5位, Elo 1289, 724戦 | 3位, Elo 1314, 840戦（1位 GPT-6 Astra (max) 1352） | https://www.designarena.ai/leaderboard?section=website&board=webapps（2026-11-07取得） |
| Design Arena — Overall Agentic | 6位, Elo 1282, 勝率58.5%, 1,948戦 | Opus 5.5 (high): 1位, Elo 1453, 勝率73.5%, 1,586戦 | https://www.designarena.ai/leaderboard（2026-11-07取得） |
| Anthropic 公式の発表ページにある文章の質の記述（定性） | "Sonnet 5.5 writes more clearly than our previous generation of models" | Every社の評として "It's got some of Opus 5.5's natural writing upgrades" | https://www.anthropic.com/claude-sonnet-5-5（2026-11-07取得） |
| Nejumi Leaderboard 4（W&B） | 見つからない | 見つからない | https://wandb.ai/llm-leaderboard/nejumi-leaderboard4/reports/Nejumi-LLM-Leaderboard4--VmlldzoxMzc1OTk1MA（forge.coreweave.comへ転送、2026-11-07取得） |
| Japanese MT-Bench / JMMLU / Swallow 日本語評価 | 見つからない | 見つからない | （該当なし。検索で確認、2026-11-07） |
| 子ども向けのやさしい文章・要約・説明の質 | 見つからない | 見つからない | https://assets.claude.com/870c8f525702625d2c62fc6dd04c857e3250bec1.pdf |

## モデルの切り替えと文脈の読み直しの費用（2026-11-07 調査）

調べ方: 公式資料・工場のコード・本番の記録の 3 経路 → まとめ → 敵対的な確認（引用と式の照合）。全データは `model-routing-2026-11-07.json` の `switch_cost`。

**結論: 今の工場の作りでは、モデルを切り替えること自体の追加費用はほぼゼロ（作り直し 1 回あたり最大 $0.07〜0.15 の推定）。** 費用を決めるのは「作り直しの session に何をどれだけ読ませるか」と「作り直しの回数」。

| 観点 | 分かったこと | 根拠 |
|---|---|---|
| キャッシュはモデルをまたげるか | またげない。モデルごとに分かれる | 公式 fallback-credit「Prompt caches are per-model」／cache-diagnostics の `model_changed` |
| 工場での切り替え方 | Managed Agents は session の途中でモデルを替えられない。作り直しはもともと新しい session（文脈は空から）で始まる | 公式 session-operations／memory「Each Managed Agents session starts with a fresh context」 |
| 作り直しまでの間隔 | 本番の実測（教材 580e3109）: 下書き→作り直し約 3 時間、作り直しどうしは 10 分〜4 時間。最短 10 分で、5 分の TTL は必ず超える。同じ Sonnet のまま作り直しても、キャッシュは外れていた | D1 factory_jobs の created_at / updated_at（2026-11-07 に読んだ値） |
| 同じ会話の中で往復させた時 | 切り替え直後の 1 回は、同じモデルのまま続ける場合の 12.5〜50 倍（キャッシュの罰の分は 25 倍）。ただしキャッシュはモデルごとに 5 分残るので、往復のたびに文脈全体を書き直すわけではない | 公式の料金表からの計算（確認係が 50 倍・40 倍の誇張を訂正した） |
| 作り直しの本当の費用 | 読ませる量 × Opus の単価: 前の版・brief・積み重なった差し戻し理由（publish.ts:123）・出典の開き直し。推定 1 回 $0.5〜2.3 | コード読み＋公式単価（ターン数・文脈の大きさは推測） |
| 作り直しが 1 回増えた時 | 作り直し session と再検証で推定 $3.5〜7（検証の出力・最大 3 回の再試行を足すともっと増える）。切り替え費用の 30〜100 倍 | 推測値を入れた式 |
| Sonnet を xhigh にした時 | 費用は Opus high に近づくのに、質の上がり方に根拠が無い。公式資料も、xhigh/max では作業の後に自分でレビューを始めると注意している | 公式（Opus 5.5 の xhigh は high の 2.5 倍の費用で +1.4 点） |

設計の結論:
- 下書き（Sonnet）と作り直し（Opus）を別の session に分ける今の作りは、切り替え費用の面で正しい。変えなくてよい。
- 本文は Opus・コードは Sonnet のように役割で分けたい時は、1 つの会話の中でモデルを往復させない。別の session か subagent に分けて、ファイルで受け渡す。難しい所が散らばっている作業なら advisor（Sonnet が作業を回し、Opus に相談する）が候補。
- 作り直しの費用を下げる一番の手は、新しい session に読ませる量を減らすこと（積み重なる差し戻し理由を最新の数件か要約に絞る）と、作り直しの回数を減らすこと。

ついでに見つかった無駄の候補（未実測）:
- **検証係の Batch のキャッシュ**: ターンごとに 5 分 TTL の cache_control を付けているが、cron は 10 分おきなので、次のターンは早くても 10 分後になる。書き込みの割増（1.25 倍）だけ払い、読み出しは起きていない疑いが強い。verifications の usage（cache_read / cache_creation）を実測してから、外すか 1 時間にするかを決める（1 時間は、全ターンで当たれば今の約 0.39 倍、外れれば今より損）。
- **費用の数え方**: verify.ts は cache read を 0.1 倍で数えている。Opus 5.5 の公式は 0.05 倍なので、2 倍に数え過ぎている（多めに数える側の誤り）。
- 作り直しの Opus は effort high に固定されている（Opus 5.5 の既定は medium。high は約 1.4 倍の費用）。

根拠の弱い所: ターン数・文脈の大きさ・前の版の大きさ・system＋tools のトークン数は推測。Opus 5.5 と Sonnet 5.5 のトークナイザが同じかは推論（公式は「どちらも 4.7 以降の新しい系統」まで）。作り直し 1 回の実費は、job_retros.metrics_json のトークンの内訳で次に確かめる。

