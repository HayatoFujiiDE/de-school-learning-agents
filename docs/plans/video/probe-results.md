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
