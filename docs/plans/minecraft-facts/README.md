# Minecraft のバージョン別の事実を貯める・クラウドで実験する（調査メモ 2026-11-04）

状態: 調査のみ。実装・EULA への同意・server.jar の取得はまだ。公開情報だけで書く。

## なぜ要るか

学習系は学習指導要領という一次データがある。Minecraft はバージョンでブロック・コマンド・挙動が変わるので、職人と検証係が「どのバージョンの話か」を確かめられる事実の置き場が要る。

## 1. 事実の出どころ（強い順）

| 強さ | 出どころ | 取れるもの |
|---|---|---|
| primary_mechanical | Java 版 server.jar のデータ生成（`java -DbundlerMainClass=net.minecraft.data.Main -jar server.jar --reports`） | blocks / commands / registries の JSON |
| primary_doc | Bedrock 版: github.com/Mojang/bedrock-samples（公式のサンプル・定義） | 振る舞い・資源パックの定義 |
| primary_doc | 公式のパッチノート JSON: `launchercontent.mojang.com/v2/javaPatchNotes.json` / `bedrockPatchNotes.json` | バージョンごとの変更点 |
| experiment | 下の「クラウドの実験」で実際に動かした結果 | 回路・コマンドの挙動 |
| secondary | minecraft.wiki 等 | 発想の入口（根拠にしない） |

バージョン一覧は Mojang の version manifest（`piston-meta.mojang.com/mc/game/version_manifest_v2.json`）。2026-11-04 時点で release 26.3、snapshot 26.4-snapshot-7。必要な Java: 26.3 は 25、1.21.4 は 21、1.20.1 は 17。

## 2. 置き場

R2 `facts/{edition}/{version}/` に JSON で置き、事実ごとに `fact_id` と強さ（上の表の 4 段）を持つ。職人の brief と検証係の入力に、題材のバージョンの事実だけを渡す。

## 3. クラウドの実験（第一候補: Cloudflare Containers）

- Worker → Durable Object → Container（`standard-1`、使う時だけ起動、`enableInternet=false`）
- コンテナの中: JDK + server.jar + RCON。`/tick freeze` / `/tick step` で時間を止めて 1 tick ずつ進め、`execute if block` / `data get block` で結果を読む
- 費用の目安: 10 分の実験 1 回あたり約 $0.012（見積り。実測していない）
- 次点: Managed Agents の作業場（8GB・JDK 21 のみ・$0.08/時）。Java 25 が要る新しい版には足りない

物理の Mac mini は使わない（電源・更新の保守が要るため。オーナー指示）。

## 4. 権利

- EULA: 配布ページからのダウンロードで同意したことになる。**同意はオーナーの操作**。それまで server.jar を取得しない
- ゲームのソフトウェアは再配布できない → server.jar を公開のイメージや repo に入れない

## 5. オーナーに決めてもらうこと

1. EULA への同意
2. server.jar をイメージに焼くか、実行ごとに取るか（焼くなら非公開のレジストリ）
3. 最初は Java 26.3 だけで始めるか
4. Workers Paid（月 $5）と実験の月の上限
5. Docker イメージを作る場所（Mac か CI）

## 実装（段階 A: パッチノート）

状態: 部品だけ作った。cron にはつないでいない。本番で定期的に動かすには**オーナーの承認が要る**。

- **集めるもの**: Mojang が公開しているパッチノート（Java 版・Bedrock 版）と、Java 版のバージョン一覧（version manifest）だけ。server.jar などゲーム本体は取らない（EULA が要らない範囲）
- **形**: バージョンごとに 1 つの JSON。変更点を「見出しの道筋（例: 新機能 › コマンド）＋本文の平文」に分け、1 件ずつ `fact_id`（版・見出し・本文から決まる番号。同じ内容なら毎回同じ）を付ける。強さは `primary_doc`。HTML のタグやリンク先は残さず、平文だけにする
- **置き場（予定）**: R2 の `facts/{edition}/{version}/patch-notes.json`。版の一覧は `facts/{edition}/index.json`（内容のハッシュを持ち、変わっていない版は書き直さない）
- **上限**: 1 回で取る版は指定した数まで / 1 回の取得は 10 秒まで / 一覧は 4MB・1 版の本文は 2MB まで / 全体の締め切りを過ぎたら次を始めない / 取りに行くのは `launchercontent.mojang.com` と `piston-meta.mojang.com` の https だけ（一覧に別のリンクが書かれていても取らない。転送も追わない）
- **repo に入れないもの**: 取ってきた Mojang の本文（著作物のため）。repo にあるのはコードと手書きの小さなテスト用データだけ
- **試運転**: `factory/worker` で `node scripts/mc-facts-dryrun.mjs <出力ディレクトリ>`。Java の release を最新 3 件まで取り、指定したディレクトリにだけ書く。画面には件数だけ出る。2026-11-04 の試運転: 26.3（変更点 2031 件）/ 26.2（684 件）/ 26.1.2（1 件）、2 回目は 3 件とも「変わらず」で書き込みなし
- コード: `factory/worker/src/mc-facts/`、テスト: `factory/worker/test/mc-facts.test.ts`
