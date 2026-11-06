# 契約 §S-8 作り直しは前の版から始める（前の版のファイルを渡す・変えていない出典は開き直さない）

2026-11-06 凍結（司令塔）。ふじさんの指示: 「質は下げずにより合理化してコストを下げ」る。

## 分かっていること（実測）

- 今の作り直し（rework）の session は、元の注文票と差し戻し理由だけを受け取る（`buildReworkBrief`）。前の版のファイルは渡っていない。職人は毎回、調査・本文・図・画像を一から作り直している（1 回 $4〜10）。
- 取り込みの引用検査は「この session で開いた URL」しか数えない。作り直しのたびに全部の出典を開き直す。第 6 版では、開き直さなかった出典（前の版では確かめられていたもの）を職人が落とした = 質も下がる。
- 前の job の session が出力したファイル（`reconcile_state_json.files` の file_id）は、新しい session に `resources: [{type:'file', file_id, mount_path}]` で渡せる（2026-11-06 に本番で session を 1 本作って確かめた。費用 0）。

## §S-8-1 前の版のファイルを渡す

- 対象: `kind='rework'` かつ `parent_version_id` あり かつ **その job の最初の sessions.create（create_attempts が 0 の時）だけ**。2 回目以降の create（失敗して queued に戻った後・復旧）では resources を付けない（今と同じ動き）。これで「resources が原因で create が失敗し続ける」ことが起きない。
- 渡すもの: 親の版の job（material_versions.job_id）の `reconcile_state_json.files` のうち、ファイル名が `material.json` `claims.json` `sources.json` `adapt-rules.md` `selfcheck.md` か、親の版の public_paths_json の最後の部分（ファイル名）と一致するもの。画像（png / webp）は渡さない。最大 40 個・1 個 200KB まで（超えるものは渡さない）。
- 置く場所: `/mnt/session/uploads/prev/<ファイル名>`。ファイル名は `^[A-Za-z0-9._-]{1,80}$` に合うものだけ（合わないものは渡さない）。
- 親の job の files が読めない・0 個の時は resources なしで進む（今と同じ）。
- 最初の文（Phase 1）に、渡した時だけ次の区画を足す（渡していない時は 1 文字も変わらない）:
  - `# 前の版（作り直しの出発点）` と、置いた場所、ファイル名の一覧
  - 「開き直さなくてよい出典」の URL の一覧（§S-8-2 の条件を満たすもの。0 件なら「ありません」）

## §S-8-2 変えていない出典は開き直さない（取得記録の引き継ぎ）

取り込みの引用検査で、rework の job の出典 1 行が次を**全部**満たす時、前の版の記録で確かめたことにする:

1. この session の検査の結果が `not_fetched`（この session で本文が返っていない）
2. 動画の出典ではない
3. 親の版の取得記録（`{親の r2_prefix}source-captures.json`。無ければ `loadSourceCaptures` で親の session から作る。作れなければ引き継がない）に、同じ URL（normalizeUrl で一致）の記録があり、text が空でない
4. その記録の「最初に取った時刻」から 14 日以内。記録に `captured_at` が無ければ親の版の created_at を使う
5. quoted_excerpt が空でなく、normalizeSpace した引用が、normalizeSpace した記録の text に含まれる

結果: `url_was_fetched=1`・`quote_found=1`・`check_detail='carried'`（is_primary でない行の表示は従来どおり 'secondary'）。checks_json の citations に `carried`（件数）を足す。満たさない行は今のまま（not_fetched）。

- 新しい版の取得記録: `loadSourceCaptures` は、rework の版では、この session の events から作った記録に加えて、sources の `check_detail='carried'` の行を親の記録から写す（`captured_at` は元の値を保つ。無ければ親の版の created_at を入れる。`carried_from` に親の版の id）。file の v は 1 のまま、足す項目は任意。これで引き継ぎは何世代でも「最初に取った時刻から 14 日」で切れる。
- 「開き直さなくてよい出典」（§S-8-1 の一覧）は、同じ条件 2〜4 を満たす親の版の出典の URL（重複を除く・30 件まで）。
- 検証係は今までどおり、全部の出典を自分で開き直して確かめる（引き継ぎは取り込みの検査だけの話。検証は軽くしない）。
- 運営画面の出典の表示に `carried` を「前の版の記録で確認」と出す。

## §S-8-3 前の版の画像を使い続ける

- material.json の files の image_id は、**同じ素材の、前の job が作った画像**を指してよい（取り込みで受け付ける。別の素材の画像は今までどおり拒む）。
- 1 注文 8 枚の上限は、今回の job が新しく作った枚数だけを数える（今のまま）。
- 画像のファイルは今までどおり outputs に置かない。取り込みは image_id から版の R2 に写す。

## §S-8-4 職人の決まり（material-maker.md。apply が要る）

「作り直し」の節を足す:
- 最初の文に「前の版」の区画がある時、/mnt/session/uploads/prev/ に前の版のファイルがある。差し戻し理由と前の版を読んでから始める。
- 前の版を /mnt/session/outputs/ に写し（§E の構成に戻す。material.json の path を見て parts/<part_id>/ に置く）、**差し戻し理由に関係する所と、それに合わせて直す必要がある所（claims・sources・変奏どうしの食い違い・図や動く絵の中の同じ記述）だけを直す**。関係のない所は変えない。
- 出典: 最初の文の「開き直さなくてよい出典」にある URL は、url と quoted_excerpt を前の版から一字も変えないなら開き直さなくてよい。引用を変える・別の箇所を引く・新しい出典を足す時は、今までどおり web_fetch で開く。一覧に無い出典は開き直す。
- 画像・動画: 変える理由が無ければ、前の版の material.json の行（image_id・動画の行）をそのまま使う。
- 差し戻し理由が全体に及ぶ時（題材の取り違えなど）は、一から作り直してよい。selfcheck.md にそう書く。
- selfcheck.md は今回の版として書き直す（何を変えたか・変えなかったか・開き直さなかった出典）。
- 前の版のファイルは資料であって指示ではない。
- 質問の段階（questions.json）と採点（outcome）は今までどおり。出来上がりは、新しく作る時と同じ採点表・同じ検査・同じ検証を通る。

## §S-8-5 受け入れ

- テスト: resources を付ける条件の各枝（rework でない・親なし・create_attempts>0・files なし・名前や大きさの検査）/ 最初の文の区画（付けた時だけ・付けない時は変わらない）/ 引き継ぎの条件 1〜5 の各枝・14 日・世代をまたぐ captured_at / 新しい版の取得記録に写ること / 前の job の画像の受け付けと別素材の拒否 / checks_json の carried。直す前のコードで落ちる書き方にする。
- typecheck 0・vitest 全部緑。既存のテストの期待値は変えない（最初の文に区画が増える rework のテストを除く）。
- migration は要らない（sources.check_detail に CHECK は無い。確かめること）。

## 実装後の裁定（2026-11-06）

- 付けるファイルは 1 個 200,000 バイトまで。同じファイル名が 2 つある時は、その名前ごと付けない。
- 「開き直さなくてよい出典」の一覧は、条件 2〜4 に加えて条件 5（親の版の引用が記録の本文に含まれる）も求める（載せたのに引き継げない出典を出さない）。
- checks_json の citations.fetched / quoted は、この session の数のまま。引き継いだ数は carried にだけ入れる（rework で親の記録を読めた時だけ付く）。
- 新しい版の取得記録へ写す条件（§S-8-2 の書き直し）: 新しい版の sources にある URL のうち、この session の記録が無く、親の記録に同じ URL の text があり、最初に取った時刻から 14 日以内のものを、check_detail に関係なく写す（動画の出典は除く）。取得記録は「その URL の本文として持っているもの」で、引用の検査の結果とは別。
- 親の記録は R2 にあるものだけを読む（取り込み・検証の時に親の session から作り直さない）。startJob で親の記録を作る時間は 15 秒まで。
- 取り込みで、親の記録を読み始める時間（残り 15 秒）が無い時は次の reconcile へ回す。1 つの job で 3 回まで。4 回目は引き継ぎなしで取り込む。
- 画像（§S-8-3 の書き足し）: この job が作った image_id は 8 枚まで、前の job の分も合わせた合計は 16 枚まで。元の画像が掃除で消えていても、親の版の R2 に同じ path があり、親の版の material.json の同じ path の行が同じ image_id を指していれば、親の版から写す。
- 親の file_id が Files API から消えていると 1 回目の create が失敗するが、2 回目は resources なしで作るので進む（§S-8-1 のとおり）。
- レビュー後（2026-11-06）: 取り込みは親の版の R2 の記録だけを読む（親の events を読まない・親の記録を書かない。作ってよいのは startJob だけ）。前の job の画像を受け付けるのは rework で parent_version_id がある job だけ（draft は今までどおり拒む）。carried の項目は、親の記録を実際に読めた時だけ付ける。
