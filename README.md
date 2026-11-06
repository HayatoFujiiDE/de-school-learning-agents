# DE-SCHOOL 学びのAIエージェント — モックとコンテンツファクトリー

フリースクール DE-SCHOOL の「学びのAIエージェント」構想を、動くモックと、素材を作る工場（コンテンツファクトリー）として実装するリポジトリです。

- **`app-v3/`** — 子ども向け画面のモック（「話す」+ 右パネル「今日の予定」）。ビルド無し、`app-v3/index.html` を `file://` で開くと動きます
- **`CONTRACT-v3.md`** — モックの実装契約（文言・状態機械・禁止語・検証コマンド）
- **`docs/plans/supporter-view/contract-AD.md`** — サポーターの画面（教室の一覧・個別画面・「一緒に入る」・足場かけの記録・保護者レポートの下書き）の契約。画面右上の役タブ「サポーター」か `app-v3/index.html#sup` で開きます
- **`BRIEF-v3.md`** — モック v3 の制作ブリーフ
- **`docs/content-factory-design.md`** — コンテンツファクトリー（Claude Managed Agents × Cloudflare Workers）の設計書
- **`docs/handoff-for-codex-basic-learning.md`** — 基礎学習教材（別企画）向けの引き継ぎ資料
- **`factory/`** — コンテンツファクトリーの実装（Managed Agents 定義 + Cloudflare Worker）。実装中
- **`tools/`** — headless Chrome による機械検査（禁止語・JS エラー・横はみ出し）と画面キャプチャ
- **`screens/`** — 検査時のサンプル画面

## このリポジトリに入っていないもの

- `reference/`（設計の原本、デザイン引き継ぎ資料、参考モック、サイト素材）は非公開のため含めていません。契約やブリーフが `reference/...` を参照している箇所は、その資料が別に存在することを示すだけです
- 本番のデータ、実在の子ども・家庭・サポーターに関する情報は一切含めていません。モックと画面に出てくる人物名・予定・会話はすべて架空です
- API キー、webhook 署名鍵、Cloudflare のアカウント ID は含めません。扱いは [`SECURITY.md`](SECURITY.md) を参照

## モックの動かし方と検査

```sh
open app-v3/index.html                 # macOS。ブラウザで直接開く
sh tools/check.sh talk plan            # 禁止語・JS エラー・横はみ出しを 1440 / 1024 / 390 で検査
sh tools/render.sh /tmp/shots talk plan  # 画面キャプチャ
```

検査は `CHECK_RESULT=PASS` で終わります。Google Chrome が `/Applications` にある前提です。

## コンテンツファクトリー

子どもに届く素材（活動レシピ、図解、動かせるもの、今日のお題 など）を、Claude Managed Agents の職人が作り、別のエビデンス検証係が出典を確かめ、運営が確認してから配信する流れです。1 本の流れと登場人物は `docs/content-factory-design.md` にあります。Cloudflare 側（Worker / D1 / R2 / Access）の実装契約は `CONTRACT-factory.md` に凍結します。

## ライセンス

未設定（All rights reserved）。公開はコードと設計の共有が目的で、再配布・商用利用の許諾は別途相談してください。
