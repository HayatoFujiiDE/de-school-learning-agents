# お題の RSS の一覧（`sources.json`）

contract-T T-4・T-13。news の生成 run が Worker から開く RSS / Atom / RDF。`scripts/sync-claude-assets.sh` が `worker/src/generated/topic-sources.ts` に書き出す（https の URL で 8 件まで。違反なら止まる）。

Worker は 1 run で最大 8 本・1 本 256 KiB・1 本 5 秒で開き、URL とリダイレクト先に T-5 の URL の規則（`checkSourceUrl`）を当てる。開けない RSS は飛ばす（run は止めない）。

## 開けたことを確かめた記録

2026-11-06（実装担当）。本文は標準出力に出さず、状態と件数だけを数えた（`curl -sS -o <一時ファイル> -w '%{http_code}'` と、`redirect: 'manual'` の fetch で状態・content-type の主部分・`<item>` / `<entry>` の数）。

| URL | 状態 | content-type | 項目の数 |
|---|---|---|---|
| https://www3.nhk.or.jp/rss/news/cat1.xml（社会） | 200 | application/xml | 264 |
| https://www3.nhk.or.jp/rss/news/cat2.xml（文化・エンタメ） | 200 | application/xml | 30 |
| https://www3.nhk.or.jp/rss/news/cat3.xml（科学・医療） | 200 | application/xml | 12 |
| https://www3.nhk.or.jp/rss/news/cat4.xml（政治） | 200 | application/xml | 72 |
| https://www3.nhk.or.jp/rss/news/cat6.xml（国際） | 200 | application/xml | 98 |
| https://www.jaxa.jp/rss/press_j.rdf | 200 | application/rdf+xml | 20 |
| https://www.nao.ac.jp/atom.xml | 200 | application/xml | 20 |
| https://www.mext.go.jp/b_menu/news/index.rdf | 200 | application/rdf+xml | 21 |

入れなかったもの:

| URL | 理由 |
|---|---|
| https://www3.nhk.or.jp/rss/news/cat0.xml（主要） | 200・7 件。社会・政治・国際と重なり、1 run の上限 8 本に収めるため外した |
| https://www.jaxa.jp/rss/topics_j.rdf | 404 |
| https://www.nao.ac.jp/rss/news.xml | 404 |
| https://www.mext.go.jp/rss/news.rdf | 404 |
| https://www.jma.go.jp/jma/press/index.rdf | 404 |
| https://www.data.jma.go.jp/developer/xml/feed/regular.xml | 200・146 件だが、気象庁防災情報 XML の機械向けの配信（項目のリンク先が XML の電文で、ニュースの見出しではない）なので外した |

NHK の RSS は短い間隔で続けて開くと接続を切られることがあった（間を 1.5 秒あけると 4 本とも 200）。Worker は 1 本ずつ順に開き、開けない本は飛ばす。
