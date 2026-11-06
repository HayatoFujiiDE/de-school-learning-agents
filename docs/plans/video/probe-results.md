# 動画の確認（Gemini）の probe の結果（2026-11-05）

対象: `N4AojLGXWe4`（ibxtoycat「Ultimate Guide To Redstone In Minecraft」）。区間はどれも 60 秒。

| # | モデル | 区間 | 区間の指定 | 結果 |
|---|---|---|---|---|
| 1〜4 | gemini-3.6-flash | 2:00 前後（値を変えて 4 回） | あり 3・なし 1 | 503 `high demand` |
| 5 | gemini-3.6-flash | 2:03〜3:03 | あり | 503 `high demand` |
| 6〜7 | gemini-3.8-flash（予備） | 2:03〜3:03・2:04〜3:04 | あり | 503 `high demand`（6 は画面側で応答を受け取れず） |
| 8 | gemini-3.6-flash | 2:05〜3:05 | あり | 200・本文あり・usage あり |
| 9 | gemini-3.8-flash（予備） | 2:05〜3:05 | あり | 200・本文あり |

## 503 の原因
Gemini の鍵のプロジェクトが無料の枠だった。ふじさんが有料に直した直後から、2 つのモデルとも 1 回目で 200 になった（#8・#9）。無料の枠が混雑時に後回しにされるという Google の公式の記述は確認できていない。直す前後で結果が変わった、という観測である。

## 区間の指定が効いているか（Q-9.5 の判断）
#8・#9 の本文には、02:05 の「Activating Redstone」のテロップ、看板の「All wooden buttons have the same activation…」の文、木のボタンの列が書かれていた。司令塔が watch ページを 2:06 で開き、同じテロップ・看板の文・ボタンの列・ダイヤのツルハシを画面で確かめた。看板の文は区間の映像を見ないと書けないので、区間つきの要求で区間の中身が渡っていると判断した。全編を渡した場合との比較（区間なしの 200 応答）はしていない。

## 有効化
2026-11-05、`video_gen_enabled = '1'` と `video_fallback_enabled = '1'` を立てた（ふじさんの許可）。probe の記帳は今月計 90¢（#1〜#9。#6 も記帳済み）。

## 関連
- 混雑時のやり直しと予備のモデル: contract-Q.md §Q-10
- 作業場の allowed_hosts と職人の domains の整合（同日の 400）: contract-Q.md §Q-9.10 改め

## 実注文の通し確認（2026-11-05 夜。§Q-10・§Q-11 の反映後、Worker eb24ada7・agent の定義 §Q-11）

1 回目（mc-redstone-buttons、job 4cf38850。§Q-11 の前）: 職人は動画を入れなかった。web_fetch の watch ページが 4 回とも `url_not_allowed`。→ §Q-11。

2 回目（mc-redstone-buttons-video、job ebd59407、版 49e75180。注文票に題名・チャンネル名・url・区間を書いた）:

| 段 | 結果 |
|---|---|
| 職人 | parts[].videos[] に v1（N4AojLGXWe4、2:05〜3:05）を書いた。動画の出典 1 行 |
| 取り込みと triage | action `none`（動画の出典の空の引用で差し戻しにならない） |
| oEmbed（本番の Worker から） | outcome `ok`・題名 `Ultimate Guide To Redstone In Minecraft`・channel_match `match`。Workers から YouTube の oEmbed に届くことを確認（§Q-11.14 の未確認の 1 つ目） |
| Gemini | gemini-3.6-flash の 1 回目で記録あり（missing なし） |
| 検証係 | 13 claims: confirmed 8・hypothesis 4・unverified 1。動画の判定は `unclear`（本人のアップと言える。ただしボタンを扱うのは 2:05〜2:28 ごろだけで、why の「実際に押して見せている」は記録で確かめられない） |
| 確認画面 | 埋め込み（区間つき）・「YouTube の公式情報: 題名 / チャンネル名（リンク。rel=noopener noreferrer・target=_blank）」・Gemini の記録・検証係の判定が出る。画面の写し: screens/review-video-q11.jpg |
| 費用 | 検証 36¢（動画の 10¢ を含む） |

未確認のまま: 非公開・埋め込み不可の動画で oEmbed が返す status（§Q-11.14 の 2 つ目）。予備のモデル（3.8 Flash）が実注文で使われる場面（主のモデルが 1 回目で通ったため）。

確認の時の注意: 管理画面は、開いたままのタブでは古い admin.js が動き続ける（画面内の移動では読み直さない）。反映の後はページを再読み込みする。

## 2026-11-06 日本語の動画（§Q-12）と職人の道具 youtube_info（§Q-13）の通しの結果

素材 mc-redstone-buttons-video（material 580e3109）。版の推移:
- v1（49e75180）: 英語の動画（ibxtoycat）。§Q-12 の確認のため差し戻し。
- v2（0168c896）: 職人は日本語で 6 回検索したが、検索結果にチャンネル名が出ず、本人のアップと判断できないので動画なし。検証で未確認 7 件 → 自動で差し戻し（few_confirmed）。
- v3（7abaa542）: 動画なし。確認済み 8・仮説 2・未確認 1。§Q-13 の反映後に差し戻し。
- v4（2ebec96c）: 職人が `youtube_info` を 2 回呼び（1 本目 ok・2 本目 not_found）、日本語の動画 jQFCgKLAhvw（チャンネル「ゴラクバ!」、区間 0:30〜5:30）を入れた。
  - oEmbed の照合: match。
  - Gemini（gemini-3.6-flash、1 回目で ok）: 記録に 4 つ目の項目「説明に使われている言葉の言語: 日本語」（手がかり: 解説音声が日本語、画面に日本語のテロップ）。
  - 検証係: 11 claims（確認済み 8・仮説 3）。動画 v1 は ok（「説明は日本語で不適切な表現も無い」。区間の終わり 5:30 は動画が 3:34 で終わるので直したほうがよい、と指摘）。自動の差し戻しなし。
  - 費用: 作り直し $4.58、検証 35¢（動画 10¢ を含む）。
  - 確認画面: screens/review-video-q13-ja.jpg。
- 同じ作り直しで、職人の generate_image が 2 回とも失敗の結果（「画像を作れませんでした」「今は画像を作れません」）。原因は未調査。

試しの session（§Q-13 の背景）: 職人の web_fetch は、注文文に書かれた oEmbed の URL は開けるが、自分で組み立てた URL は開けない（「会話に出た URL だけ」の注記）。
