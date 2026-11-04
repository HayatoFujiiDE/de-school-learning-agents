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
