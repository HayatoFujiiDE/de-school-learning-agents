# §AK 権利の門番: 外から来た資料は、機械が確かめた権利の記録が無ければ学習者に届かない（2026-11-07 v3.1（Astra 実装レビュー B1〜B4 を反映）。凍結 v3 の改訂）

ふじさんの指示（2026-11-07）: 「コンテンツファクトリーの中で AI エージェントたちがこれらの重要事項（権利）をチェックして、資料を取り込むなら取り込む、URL のソースにするならそうする。エビデンスをもとに、絶対に権利の侵害がない形で工場が動くように。決定論的に動くように設計して」。

いま権利を確かめているのは、人（ふじさんと AI のセッション）が一覧 `factory/models3d/catalog.json` に `checked_how` を書く運用だけ。本契約はそれを **工場の中の決定論的な門番**に置き換える: 「根拠（エビデンス）→ 機械の検査 → 権利の記録 → 見せ方（複製して配る / 提供元の埋め込み / 出典の url）の決定」を純関数と固定の表で行い、LLM の判断も人の記述も「見せ方」を直接は決められない形にする。対象は v1 では立体モデル（工場が第三者のファイルを複製する唯一のレーン）。動画・出典・引用の扱いは AK-8 で位置づける。

レビューの経緯（Astra high × 2 回。予算は 2 往復まで。3 回目は司令塔の裁定）: 1 回目 REVISE（BLOCKING 8）→ v2 で 8 件に対応。2 回目 REVISE（1 回目の 3 件は閉鎖、5 件が残存 + 新規 2 件）→ v3 で次を採る。**(B1・B2) 記録を一覧の「対象の指紋」（`subject_sha256`）に結ぶ** — 一覧の対象の値（page_url / embed_url / download_url / uploader / evidence_url / license.url / attribution / title_src / checked_at / checked_how）が変わった記録はどの出口でも × になり、cron が優先して確かめ直す。人の記録の「2 回目は書かない」も指紋の一致で判定。**(B3) NASA** は HTML のコメントを落とし、数値の文字実体（`&#169;` 等）を復号し、`Details` の区画全体（次の `Downloads` まで・最大 3000 字）で第三者の印を見る。`href` はコメント除去後の HTML で探す。**(B4) `cc-url` は host を許さない**（ファイルとライセンスの結び付きを機械で確かめる方法が無い。embed だけ。DBCLS は download なので v1 では出ない）。**(B5) claim に所有トークン** — 結果の保存・取り込みの記録はトークンが一致する時だけ。取り込みが終わるまで claim を持つ。**(B6) 端末の古い cache（1 年 immutable）は回収できない** — 保証の範囲外と明記（子ども向けアプリは未着手。旧 url を持つ端末はふじさんの Chrome だけ）。**(B7) CC の url は実在する組み合わせの有限集合**（4.0 は移植なし、2.0 / 2.1 の `jp` だけ）。NON-BLOCKING も採る: attribution は displayName と「空白と括弧を除いた文字列」で一致（含む）・失敗の遷移表・human の no-op の定義・巡回は「見込み」・配信は 1 クエリ・一覧の cache 10 分・画面の toast の網羅・`rights_hosted` はトークンで結ぶ（autoincrement の id に依存しない）・受け入れに指紋・コメント・実体・lost claim・遷移・DOM の検査を足す。

v3.1 の改訂（2026-11-07。PR-AK1 の実装レビュー Astra high REVISE・BLOCKING 4 件。再現はすべて `test/rights-revise.test.ts` の回帰テスト）: **(B1) HTML の誤読** — 属性値の中の `<!--` や `<script>` を区切りと読み、Details の第三者の印を消していた。HTML は状態を区別する字句解析器 `parseHtml` で読み、閉じていない構造は `unparseable`（fail-closed）。正の判定（h1・リンク・Source の行・決まりの文・CC の URL が「ある」）は解析結果だけ、負の判定（第三者の印が「無い」・CC の URL が「一意」）は解析結果と生 HTML（実体を復号。comment・属性・script を除去しない）の両方で見る（AK-2 の `nasa-3d`・`dbcls`）。**(B2) claim を失った古い実行が取り込みの結果を上書きする** — `importModel3d` にトークンを渡し、有効化（`models3d_files` の upsert・`rights_hosted`・取り込みの履歴）を 1 つの batch にして各文を「claim を持ち `blocked = 0`」で条件付ける。0 行なら `lost_claim`（AK-2 の 6・AK-0 9）。**(B3) 確かめている途中に止めると、その後に取り込む** — 取り込みの fetch の前に行を読み直し、止めていれば取り込まない。有効化の条件にも `blocked = 0`。**(B4) cron の飢餓** — 指紋違い (b) は試行から 1 時間空ける。並びは (a) → (b) → (c)(d)（AK-6）。あわせて非 BLOCKING: (i) `rights_hosted` を `ON CONFLICT DO UPDATE` にして同じ sha の成功で `verified_at` を進める（`last_import_fail` が消える）/ (iii) 管理のページの最後の失敗は全件を 3 クエリで / (iv) 止める操作で作る行は未試行（1970）/ cron の段は締め切りの 330 秒前までに 1 件を始める。

## 実測した事実（2026-11-07。推測を含まない）

- Sketchfab Data API v3 `GET https://api.sketchfab.com/v3/models/<uid>` は無認証で 200（OMNH のアロサウルス）。応答の `license` は `{uri, label, fullName, requirements, url, slug}` で、`url` は `http://creativecommons.org/licenses/by/4.0/`（**http**）。`user.username` は `OMNH`、`user.displayName` は「大阪市立自然史博物館　Osaka Museum of Natural History」、`embedUrl` は `https://sketchfab.com/models/<uid>/embed`、`viewerUrl` は一覧の `page_url` と同じ、`uid` あり。公式 docs のページ（docs.sketchfab.com）は自動取得だと中身が無い / 403 なので、slug の全一覧は未確認 → 本契約は slug を使わず `license.url` だけを根拠にする。
- Sketchfab の API を一覧の 3 件で照合: `uid`・`embedUrl` は一覧と一致、`user.username` は OMNH が `OMNH`・九州大学が `ffishAsia-and-floraZia`、`license.url` は CC0 が `http://creativecommons.org/publicdomain/zero/1.0/`。`viewerUrl` は OMNH が一覧の `page_url` と完全一致、九州大学は題名の slug 付き（`…/3d-models/lotus-…-<uid>`。一覧は slug 無し）で不一致。`user.displayName` は九州大学が「ffish.asia / floraZia.com」（一覧の attribution と同じ）、OMNH は「大阪市立自然史博物館　Osaka Museum of Natural History」で、一覧の attribution「大阪市立自然史博物館（Osaka Museum of Natural History）」とは空白と括弧を除くと同じ文字列。
- NASA: モデルのページ（`https://science.nasa.gov/3d-resources/mars-2020-perseverance-rover/`）は `<h1>` が 1 つで「Mars 2020 Perseverance Rover」（一覧の `title_src` と同じ）。本文（タグを除いた文）の最初の ` Details Source ` の直後が「NASA/Jet Propulsion Laboratory Mission …」。HTML に `href="<一覧の download_url>"`（`%20` 入り）がそのまま 1 つ以上ある（decode した形は無い）。ISS のページも同じ形（h1「International Space Station (ISS) (D) (IGOAL)」= `title_src`、` Details Source ` の直後が「NASA/JSC/Integrated Graphics, Operations, and Analysis Laboratory GitHub Repository …」、`href` あり）。` Details Source ` から 600 字の中に `copyright` / `©` / `courtesy` は無い。3D Resources のトップ（`https://science.nasa.gov/3d-resources/`）に「All of these assets are free to download and use.」。利用の決まり（`https://www.nasa.gov/nasa-brand-center/images-and-media/`）に「generally are not subject to copyright in the United States. You may use this material for educational or informational purposes」。いずれも自動取得で 200。
- DBCLS BodyParts3D: `https://dbarchive.biosciencedbc.jp/jp/bodyparts3d/lic.html`（一覧の `page_url` `…/jp/bodyparts3d/desc.html` と同じ host・同じ先頭 2 区分の path）が 200 で、creativecommons.org の URL が `…/licenses/by/4.0/deed.ja` と `…/licenses/by/4.0/legalcode.ja` の 2 つ（正規化すると同じ 1 つ）。本文に「BodyParts3D」（一覧の `title_src`）と「クリエイティブ・コモンズ 表示4.0 国際」。`desc.html` と `download.html` には CC の URL が無い。一覧の `download_url` は null（OBJ）。
- Smithsonian: `3d.si.edu` の記録のページ・`3d.si.edu/cc0`・`si.edu/termsofuse` は自動取得が **403**。埋め込み用の `3d-api.si.edu` の scene JSON（`…/document.json`）は 200 で、`asset.copyright` が「(c) Smithsonian Institution. All rights reserved.」（記録のページの CC0 表示と字面が違う）→ 機械では確かめられない提供元。人の確認（2026-11-07・ふじさんの Chrome で記録のページを開いて DOM を見た）: 一覧の 3 件（トリケラトプス・マンモス・アポロ 11 司令船）とも、利用条件の札は `span.usage--cc0`（「CC0」）が表示され `span.usage--restricted`（「Usage Conditions Apply」）が `display: none`（ページは両方の札を持ち、該当する方だけ見せる作り）。
- Creative Commons（公式）: 4.0 の legal code 2(a)(4) は「all media and formats … and to make technical modifications necessary to do so」「simply making modifications authorized by this Section 2(a)(4) never produces Adapted Material」。BY-SA の継承条件は改変（Adapted Material）にだけ掛かる。CC ライセンスは取り消し不能（legal code 2(a)(1) irrevocable、6(c) 配布停止でもライセンスは終わらない）。BY 4.0 3(a)(1) が求める表示: 作者の名前・著作権表示・ライセンスの表示・免責の表示・元の資料への url、改変したことの明示、ライセンスへの url。CC0 は「copy, modify, distribute and perform the work, even for commercial purposes, all without asking permission」。Public Domain Mark は「may not be free of known copyright restrictions in all jurisdictions」（印であって許諾ではない）。4.0 に国の移植は無い。2.1 の日本の移植（`…/licenses/by/2.1/jp/`）は実在。
- claim の SQL（AK-2 の 2）を node:sqlite で実測: 新規は changes 1、claim 中（claim_at ≥ 期限）は changes 0、claim が古い（< 期限）は 1、claim を NULL に戻した後は 1。テストの D1 の shim（`test/d1-shim.ts`）は `run()` の `meta.changes` を返す（`last_row_id` は返さない → 本契約は autoincrement の id に依存しない）。
- 工場の現状（repo）: 立体モデルの見せ方を決める入口は `viewableModels3d(hosted)` / `viewableCatalogMap(hosted)`（`src/models3d.ts`）で、呼び口は 注文票（`src/jobs.ts` 414 行）・取り込み検査（`src/jobs.ts` 1895 行 → `validateOutputs` → `checkModels3d`）・学習者側の一覧（`src/routes/library.ts` `libraryModels3d`。cache 3600 s）・確認画面（`src/routes/review.ts` `models3dMetaOf`）・取り込み（`src/routes/models3d.ts` `fetchModel3d`）の 5 つ + 配信（`libraryModel3dFile`。D1 を見ない。cache 1 年 immutable）。`hosted` は §AJ2 の「取り込み済み」（D1 `models3d_files` + R2 head）。一覧の `license.code` は `cc0 / cc-by / nasa-media` の 3 値（`scripts/sync-claude-assets.sh` が検査。`checked_how` は生成ファイルに出していない）。cron は `src/cron.ts` の 10 分ごとの段の列（各段が自分で deadline を見る。全体の lock は無い）。

## AK-0 保証（有界）と範囲

1. **門番が通した立体モデルだけが外に出る**: 注文票・取り込み検査・学習者側の一覧 API・確認画面の立体モデル・取り込み（複製）・配信の 6 つの出口は、すべて `offerableModels3d(gate)` か `rightsModes(record, entry)`（AK-1）を通る。**D1 `rights_records` に行が無い項目、行の `subject_sha256` が今の一覧の対象の指紋と違う項目は、どの出口にも出ない。**
2. **ライセンスの種類（code）は機械が決める**: code は提供元の API の `license.url`、または提供元のページにある creativecommons.org の URL、または提供元の固定の記述（台帳 AK-2）から `licenseCodeOfUrl` / 台帳の規則で導く。人（一覧）・cron・画面・API・LLM は code を直接書かない。例外は AK-2 の `human`（機械で確かめられない提供元）だけで、その code も一覧の `license.url` から `licenseCodeOfUrl` で導く（`license.code` の文字列は使わない）。
3. **複製して配る（host）は、ファイルとライセンスを機械で結べる根拠（`api` / `statement`）がある記録だけ**。`cc-url`（ページに CC の URL があるだけ）と `human` は埋め込みだけ。**新しい取得（取り込み）は、いま通った確認（`verified`）の直後に、その確認の claim を持ったまま行う**。`stale` は既に確認のもとで取り込んだ sha の配信を保つだけ。
4. **配信も資格を見る**: `GET /api/library/models3d/files/<id>/<sha>.glb` は、行があり指紋が一致し `rightsModes.host` で、かつ `rights_hosted` にその `(asset_key, sha)` がある時だけ 200。cache は 1 日。**本契約の deploy 前に配った url を 1 年の immutable で持っている端末の cache は回収できない**（保証の範囲外。子ども向けアプリは未着手で、旧 url を持つ端末はふじさんの Chrome だけ）。
5. **NC（非営利限定）・不明は埋め込みも複製も不可。止めた（blocked）・不正な行・指紋の不一致・未確認（`unverified`）・対象の不一致（`mismatch`）は全部不可。** 確かめている途中に止めた時も取り込まない（v3.1: 取り込みの前に行を読み直し、有効化の条件に `blocked = 0`）。
6. **通信の失敗は見せ方を下げない（`stale`）。対象の不一致・ライセンスの変化・一覧の対象の変更は見せ方を下げる（`mismatch` / 新しい code / 指紋の不一致）。** 成功した確認は常に記録を上書きする。拒否の状態（`mismatch` / `unverified`）は通信の失敗では戻らない（AK-2 の遷移表）。
7. **記録は消さない**: 現在値 `rights_records`、追記だけの `rights_checks`（確認・取り込み・停止の履歴）と `rights_hosted`（確認のもとで取り込んだ sha）。削除する SQL を書かない。
8. **外へ取りに行く url は静的な値だけ**: 一覧の `page_url` / `embed_url` / `download_url` / `evidence_url` と台帳（コード定数）の url。リダイレクトは追わない。画面・API・LLM から url を受け取って取りに行く口は作らない。
9. **1 つの項目の確認（検査 + 取り込み）は同時に 1 本**（行の claim とトークンで直列化。期限で回収された古い実行は結果を書けない）。確認の結果の書き込みと `rights_checks` の追記は 1 つの `batch`（原子）。取り込みの有効化（`models3d_files` の upsert・`rights_hosted`・取り込みの履歴）も 1 つの `batch` で、各文は「その行の claim をこのトークンが持ち、`blocked = 0`」の時だけ（v3.1）。0 行なら有効化しない（claim を失っていれば `lost_claim`、止めていれば取り込まない）。R2 の put は内容アドレスの key（sha）なので条件を付けない（有効化されない object は参照されないまま残る。害はない）。
10. ログの 1 行は `{at, asset_key, kind, result, code}` だけ（url・本文・応答の JSON・attribution を出さない。手動の確認・例外・取り込みの失敗も同じ投影）。

範囲外（v1）: 動画（§Q の仕組みをそのまま。AK-8）・出典の url と引用（AK-8）・本文の丸写しの検査（PR-AK2）・LLM の「権利係」（PR-AK3）・OBJ の変換（`modified` を true にする経路は v1 に無い）・24 MiB 超・古い object の回収・新しい提供元を台帳に足す手順の自動化（台帳はコード定数。PR で足す）・deploy 前の端末 cache（上の 4）。本契約は「立体モデルの複製・埋め込みで権利の裏付けが無いものを出さない」ことを保証する。第三者の資料全般（本文の丸写し・引用の適法性）の非侵害は保証しない（AK-8）。

## AK-1 記録と方針（純関数。`src/rights.ts`（新規）。I/O を持たない）

```ts
export type LicenseCode = 'cc0' | 'pdm' | 'cc-by' | 'cc-by-sa' | 'cc-by-nd' | 'cc-by-nc' | 'cc-by-nc-sa' | 'cc-by-nc-nd' | 'nasa-media' | 'unknown';
export type EvidenceKind = 'api' | 'statement' | 'cc-url' | 'human';
export type RightsStatus = 'verified' | 'stale' | 'mismatch' | 'unverified' | 'human';
export interface RightsRecord {
  asset_key: string;            // `models3d:<catalog_id>`
  subject_sha256: string;       // 一覧の対象の指紋（subjectSha256(e)）。unverified の行は claim の時の指紋
  license_code: LicenseCode;
  license_url: string;          // 正規化した url。unverified の行は ''
  attribution: string;          // 表示する出典の書き方（一覧の値。1〜200 字）
  evidence_kind: EvidenceKind;  // unverified の行は台帳の種類（api / statement / cc-url / human）
  evidence_json: string;        // JSON 配列 [{ url, sha256?, ok, note? }]（≤ 2000 字。本文は入れない）
  modified: boolean;            // 形式や中身を変えたか（v1 は常に false）
  status: RightsStatus;
  blocked: boolean;             // 運営が止めた
  fail_code: string | null;     // 最後の失敗の理由（stale / mismatch / unverified の時）
  checked_at: string | null;    // 最後に成功した確認（ISO）。無ければ null
  last_attempt_at: string;      // 最後に試した時刻（成否を問わない）
  checked_by: string;           // 'cron' | email
}
export type RightsModes = { host: boolean; embed: boolean };
export interface RightsGate {
  records: ReadonlyMap<string, RightsRecord | 'invalid'>;
  hosted: ReadonlyMap<string, HostedModel3d>;          // §AJ2 の「取り込み済み」
  hostedShas: ReadonlyMap<string, ReadonlySet<string>>; // rights_hosted
}
```

- `assetKey('models3d', id)` = `models3d:<id>`。
- `subjectSha256(e: Model3dEntry)`: `sha256(JSON.stringify([e.kind, e.page_url, e.embed_url, e.download_url, e.uploader, e.evidence_url, e.license.url, e.attribution, e.title_src, e.checked_at, e.checked_how]))`（この順。sha256 は hex 64 字。テストでは固定値と一致させる）。
- `normalizeLicenseUrl(url)`: 前後の空白を除く → `URL` で parse（できなければ `null`）→ `http:` を `https:` に → host と path を小文字に → query と fragment を落とす → path の末尾の区分が `deed` / `deed.<2 字>` / `legalcode` / `legalcode.<2 字>` なら落とす → 末尾に `/` を 1 つ付ける → `https://<host><path>`。
- `licenseCodeOfUrl(url): LicenseCode`（正規化した url に対して。**実在する組み合わせの有限集合**。合わなければ `unknown`）:
  - `https://creativecommons.org/publicdomain/zero/1.0/` → `cc0`
  - `https://creativecommons.org/publicdomain/mark/1.0/` → `pdm`
  - `https://creativecommons.org/licenses/<element>/<ver>/` で `element` ∈ {by, by-sa, by-nd, by-nc, by-nc-sa, by-nc-nd}、`ver` ∈ {1.0, 2.0, 2.5, 3.0, 4.0}（移植なし）→ `cc-<element>`
  - `https://creativecommons.org/licenses/<element>/<ver>/jp/` で `ver` ∈ {2.0, 2.1}（日本の移植。実在を確認した組み合わせだけ）→ `cc-<element>`
  - `https://www.nasa.gov/nasa-brand-center/images-and-media/` → `nasa-media`
  - それ以外（`by/2.1/`（移植なしの 2.1 は無い）・`by/4.0/jp/`・`by/1.0/zz/`・`by/9.9/` 等）→ `unknown`。新しい組み合わせは PR で集合に足す。
- `licenseLabelOf(code, licenseUrl)`: 表示の名前。`cc0` → `CC0 1.0`、`pdm` → `パブリックドメイン（PDM 1.0）`、`cc-by` → `CC BY <版>`（版は url の `[0-9].[0-9]`。移植は `CC BY 2.1 JP`）、`cc-by-sa` → `CC BY-SA <版>`、`cc-by-nd` → `CC BY-ND <版>`、NC の 3 つ → `CC BY-NC…<版>`、`nasa-media` → `NASA の利用の決まり`、`unknown` → `不明`。一覧の `license.label` は使わない。
- `rightsModes(r: RightsRecord | 'invalid' | undefined, e: Model3dEntry): RightsModes`（固定の表。上から順に最初に当たった行）:

| 条件 | host | embed |
|---|---|---|
| 行が無い（undefined）・不正（`'invalid'`） | × | × |
| `r.subject_sha256 !== subjectSha256(e)` | × | × |
| `blocked` | × | × |
| `status` が `unverified` / `mismatch` | × | × |
| `license_code` が `cc-by-nc` / `cc-by-nc-sa` / `cc-by-nc-nd` / `unknown` | × | × |
| `status` が `human`（`evidence_kind` も `human` でなければ × ×） | × | ○ ただし `license_code` が `cc0` / `pdm` / `cc-by` / `cc-by-sa` / `cc-by-nd` の時だけ |
| `status` が `verified` / `stale` で `evidence_kind` が `cc-url` | × | ○ ただし上と同じ code の時だけ |
| （以下は `status` が `verified` / `stale` で `evidence_kind` が `api` / `statement`）`license_code` が `pdm` | × | ○ |
| `license_code` が `nasa-media` | ○ | × |
| `license_code` が `cc0` / `cc-by` | ○ | ○ |
| `license_code` が `cc-by-sa` / `cc-by-nd` | ○ ただし `modified` が false の時だけ | ○ |
| それ以外（status と evidence_kind の組み合わせが上に無い） | × | × |

（embed は「提供元の公式の埋め込みをそのまま見せる」= 複製しない。NC と PDM の host × は法律ではなく事業の決まり（月額販売・保守）。`modified` は v1 では常に false。形式の変換（技術的な変更）と翻案を分ける属性は、変換の経路を作る時に足す。）

- `offerableModels3d(gate: RightsGate, catalog = MODELS3D): Array<{ entry: Model3dEntry; record: RightsRecord; hosted: HostedModel3d | null }>`（一覧の順）: `record` = `gate.records.get(assetKey('models3d', e.id))`。`rightsModes(record, e)` で、`kind` が `sketchfab` / `voyager` は `embed` の時だけ。`kind` が `download` は `host` **かつ** `gate.hosted.get(e.id)` があり **かつ** その sha が `gate.hostedShas.get(assetKey)` に含まれる時だけ。
- `offerableCatalogMap(gate, catalog)`: `offerableModels3d` の `entry` を id で引く Map（`checkModels3d` に渡す）。
- `rightsReasonOf(record, e): 'ok' | 'no_record' | 'invalid' | 'subject_changed' | 'blocked' | 'unverified' | 'mismatch' | 'license'`（確認画面と管理のページの理由。表の行に対応）。
- `model3dViewOf(e, record, hostedRow?)`: 既存の 8 キーの `license` を `licenseLabelOf(record.license_code, record.license_url)`、`attribution` を `record.attribution` にし、`license_code`・`license_url` の 2 キーを足す（download で hosted の時の `file_url`・`bytes`・`sha256` は §AJ2 のまま）。
- `viewableModels3d` / `viewableCatalogMap` / `isViewableModel3d` は削除（呼び口を全部 `offerable…` に替える。`isEmbeddableModel3d` は残す）。
- `squash(s)`: Unicode の空白（全角を含む）と括弧 `()（）[]［］` を全部除き、小文字にする（attribution と displayName の照合に使う）。

## AK-2 確かめ方（根拠の種類と提供元の台帳。`src/rights-providers.ts`（新規）= コード定数。`src/rights-check.ts`（新規）= I/O）

台帳 `RIGHTS_PROVIDERS` は一覧の項目から `providerOf(e)` で 1 件を選ぶ（`page_url` の host と path と `kind` で判定。当たらなければ `unsupported`）。v1 の 4 件:

| 台帳の id | 当たる項目 | 根拠の種類 | 検査（全部通った時だけ verified。1 つでも落ちたら fail_code。順番どおり） |
|---|---|---|---|
| `sketchfab` | `page_url` が `^https://sketchfab\.com/3d-models/[A-Za-z0-9-]*<uid>$`（uid = `embed_url` の 32 桁）かつ kind `sketchfab` | `api` | `GET https://api.sketchfab.com/v3/models/<uid>`（`accept: application/json`・`redirect: 'manual'`・timeout 20 s・本文 256 KiB まで（`readCapped` が `too_large` を返したら受理しない））。200 でなければ `fetch_failed:<status>` / parse できない・object でない・`user` が object でない → `bad_response` / `uid !== <uid>` → `uid_mismatch` / 一覧の `uploader` が null → `uploader_missing` / `user.username !== uploader`（大文字小文字そのまま）→ `uploader_mismatch` / `embedUrl !== embed_url` → `embed_mismatch` / `viewerUrl` が `^https://sketchfab\.com/3d-models/[A-Za-z0-9-]*<uid>$` に合わない → `page_mismatch` / `license.url` が文字列でない → `no_license_url` / `displayName` が文字列で `squash(displayName)` が 3 字以上でなければ `bad_response`、`squash(一覧の attribution)` が `squash(displayName)` を含まなければ `attribution_mismatch`。通れば `license_code = licenseCodeOfUrl(license.url)`（NC や unknown でも記録する = modes が × になる）、`license_url` = 正規化した値、`attribution` = 一覧の attribution、`evidence_json` = `[{url: API の url, sha256: sha256(JSON.stringify({uid, username, displayName, embedUrl, viewerUrl, license: {slug, url}}))（キーはこの順。displayName は 200 字で切る）, ok: true, note: 'creator=' + displayName（200 字まで）}]` |
| `nasa-3d` | host が `science.nasa.gov` かつ path が `/3d-resources/` で始まる かつ kind `download` かつ `download_url` が null でない | `statement` | 3 つのページを取る（それぞれ `redirect: 'manual'`・timeout 20 s・1 MiB まで（超えたら `too_large`。切り捨てた本文は使わない）・200 以外は `fetch_failed:<status>`）。**v3.1: HTML は状態を区別する字句解析器 `parseHtml` で読む**（text / tag（属性値の `"` `'` の引用と引用なしを区別）/ comment / script・style 等の生テキスト。script は HTML の決まりのエスケープの状態をたどる）。閉じていない comment・tag・属性の引用・script / style は `unparseable`。tag 列は名前と属性の Map（属性値は実体を復号済み）。**可視テキスト** = script・style・comment を除いた文の実体を復号（数値の `&#NN;` `&#xHH;` 全般（`;` なし・先頭の 0 も）と名前付きの `&amp;` `&nbsp;` `&quot;` `&copy;` `&lt;` `&gt;` `&apos;`）し、空白を 1 つに（タグの境目は空白 1 つ）。**正の判定は解析結果だけ**: (a) `page_url`: tag 列の `<h1>` の開始が 1 つでなければ（終了が無くても）`title_missing`、h1 の開始と終了の間の可視テキストが一覧の `title_src` と違えば `title_mismatch`（script の中の偽の h1 は数えない）。一覧の `attribution` が `/^NASA(\/|$)/` に合わなければ `source_not_nasa`。可視テキストの最初の ` Details Source ` の直後が attribution + ` ` で始まらなければ `source_mismatch`（` Details Source ` が無ければ同じ）。**負の判定は両面**: **Details の区画** = 可視テキストの ` Details Source ` から次の ` Downloads ` まで（最大 3000 字）。その可視テキストと、同じ区画に当たる生 HTML 全体（comment・属性・script を含め除去しない）を実体を復号したもの、のどちらかに `/copyright|©|courtesy|all rights reserved|used with permission/i` があれば `third_party_marker`。`<a>` の `href` 属性（復号後）が `download_url` と完全一致するものが無ければ `download_url_not_linked`（単一引用符は可・`data-href` は不可・script の中は不可・`<a>` 以外の要素は不可）。(b) `https://science.nasa.gov/3d-resources/`: 可視テキストに `free to download and use` が無ければ `statement_missing:hub`。(c) 一覧の `license.url`（正規化して `https://www.nasa.gov/nasa-brand-center/images-and-media/` でなければ `license_url_mismatch`。取らない）: 可視テキストに `not subject to copyright in the United States` と `educational or informational purposes` の両方がそろわなければ `statement_missing:terms`。通れば `license_code = nasa-media`、`attribution` = 一覧の attribution、`evidence_json` = 3 件 `{url, sha256: sha256(可視テキスト), ok: true}` |
| `dbcls` | host が `dbarchive.biosciencedbc.jp` | `cc-url`（**embed だけ。host ×**） | 一覧の `evidence_url` が null → `evidence_url_missing`。`evidence_url` と `page_url` の host が違う、または path の先頭 2 区分（`/jp/bodyparts3d/`）が違う → `evidence_scope_mismatch`。取る（同じ上限）。**v3.1: `parseHtml` で読む**（閉じていない構造は `unparseable`）。可視テキストに一覧の `title_src` が無ければ `subject_mismatch`。**「ある」は解析結果だけ**: 可視テキストと `<a>` の `href`（復号後）から `/https?:\/\/creativecommons\.org\/[A-Za-z0-9./_-]+/g` を集めて `normalizeLicenseUrl` し、0 件 → `no_cc_url`（comment・script の中だけの URL は根拠にしない）。**「一意」は和集合**: それに生 HTML の全文を実体復号したものからの CC の URL を足し、正規化した URL が 1 つでない、または `licenseCodeOfUrl` の code が 1 種類でない → `ambiguous_cc_url`（BY と NC の混在・script の中の別の URL・実体で書いた URL を含む）。1 つなら `license_code = licenseCodeOfUrl(それ)`・`license_url` = それ、`attribution` = 一覧の attribution、`evidence_json` = `[{url: evidence_url, sha256: sha256(可視テキスト), ok: true}]`。台帳の注記「ページの CC の URL は、そのページが対象のファイルに掛かることを機械で確かめられないので、複製の根拠にはしない」 |
| `smithsonian` | host が `3d.si.edu` かつ kind `voyager` | `human`（`check: 'none'`） | 自動取得を拒む提供元（403）。機械の検査はしない。一覧の値から **人の記録**の行を書く: `license_code = licenseCodeOfUrl(e.license.url)`・`license_url`・`attribution`・`evidence_kind = 'human'`・`evidence_json = [{url: page_url, ok: true, note: '<checked_at> ' + checked_how（300 字）}]`・`status = 'human'`・`checked_at = e.checked_at`・`subject_sha256 = subjectSha256(e)`。**no-op の定義**: 既存の行が `status = 'human'` で `subject_sha256` が同じなら、`last_attempt_at` と claim の解放だけ更新し、`rights_checks` に行を足さない。台帳の注記「提供元が自動取得を拒む（403）。記録のページの表示（CC0 の札）を人が確かめる」 |

- 失敗の分類（`failClass(fail_code)`）: **通信の失敗（transient）** = `fetch_failed:*` / `too_large` / `bad_response`。**対象の不一致（mismatch）** = それ以外の全部（`uid_mismatch` / `uploader_*` / `embed_mismatch` / `page_mismatch` / `no_license_url` / `attribution_mismatch` / `title_*` / `source_*` / `third_party_marker` / `download_url_not_linked` / `statement_missing:*` / `license_url_mismatch` / `evidence_*` / `subject_mismatch` / `no_cc_url` / `ambiguous_cc_url` / `unparseable`（v3.1。閉じていない HTML = fail-closed））。
- **遷移表**（行の `status` × 結果 → 次の `status`。code / url / evidence_json は成功の時だけ更新）:

| 今の status | 成功 | transient | mismatch |
|---|---|---|---|
| 行が無い（claim で `unverified` を作る） | verified | unverified | unverified |
| unverified | verified | unverified | unverified |
| verified | verified | stale | mismatch |
| stale | verified | stale | mismatch |
| mismatch | verified | mismatch | mismatch |

（`human` は機械の検査の対象外。拒否の状態は通信の失敗では戻らない。）

- `parseHtml` / `decodeEntities` と各正規表現は untrusted な HTML / JSON に当てる。字句解析は `indexOf` のループで書く（v3.1）。正規表現は固定長の文字クラスと単一の量指定子だけで書く（後方参照・入れ子の量指定子を使わない）。本文は上限（`readCapped`）を超えたら使わない。`decodeURIComponent` は使わない。
- `runRightsCheck(env, e, by, fetchImpl = fetch): Promise<RightsCheckOutcome>`（`src/rights-check.ts`）:
  1. `providerOf(e)` が `unsupported` → `{ kind: 'skipped', reason: 'unsupported' }`（D1 に書かない）。
  2. **claim**: `token = <32 桁の hex（crypto.getRandomValues）>`。`INSERT INTO rights_records (asset_key, subject_sha256, license_code, license_url, attribution, evidence_kind, evidence_json, modified, status, blocked, fail_code, checked_at, last_attempt_at, checked_by, claim_at, claim_token) VALUES (?, ?, 'unknown', '', ?, ?, '[]', 0, 'unverified', 0, NULL, NULL, ?, ?, ?, ?) ON CONFLICT(asset_key) DO UPDATE SET claim_at = excluded.claim_at, claim_token = excluded.claim_token, last_attempt_at = excluded.last_attempt_at WHERE rights_records.claim_at IS NULL OR rights_records.claim_at < ?`（最後の `?` = now − 10 分）。`meta.changes` が 0 なら `{ kind: 'skipped', reason: 'busy' }`。
  3. 台帳が `none`（human）→ 上の表のとおり（no-op か、行の更新 + `rights_checks` に `result = 'human'`）。書き込みは全部 `WHERE claim_token = ?` 付き（0 件なら `lost_claim`）。→ `{ kind: 'human', record }`。
  4. 機械の検査（表）。通った → 1 つの `batch` で: `UPDATE rights_records SET subject_sha256 = ?, license_code = ?, license_url = ?, attribution = ?, evidence_kind = ?, evidence_json = ?, status = 'verified', fail_code = NULL, checked_at = ?, last_attempt_at = ?, checked_by = ? WHERE asset_key = ? AND claim_token = ?`（`blocked`・`modified` は保つ。**claim はまだ解放しない**）+ `rights_checks` に 1 行（`result = 'verified'`・`check_token = token`）。`changes` が 0（期限で回収された）→ `{ kind: 'lost_claim' }`（ログだけ。何も書かない）。
  5. 落ちた → 1 つの `batch` で: 遷移表のとおり `status`・`fail_code`・`last_attempt_at`・`checked_by`・`claim_at = NULL`・`claim_token = NULL` を `WHERE asset_key = ? AND claim_token = ?` で更新 + `rights_checks` に 1 行（`result = fail_code`）。`changes` 0 → `lost_claim`。→ `{ kind: 'failed', fail_code, status }`。例外（network / timeout）は `fetch_failed:network` / `fetch_failed:timeout`。
  6. **取り込み**（4 の直後だけ。claim を持ったまま。v3.1 で改訂）: `e.kind === 'download'` かつ `download_url !== null` かつ（`blocked` を除いて）`rightsModes(record).host` の時、**取り込みの fetch の前に行を読み直す**（`blocked`・`claim_token`）。`claim_token` が自分のトークンでなければ `lost_claim`。`blocked` なら取り込まず、結果は `verified` + 「止めているので取り込まない」（outcome の `blocked` は読み直した値）。そうでなければ `importModel3d(env, e, by, fetchImpl, token)`（`fetchModel3d` の 2〜6 を関数に切り出したもの。`fetched_by = by`）: 取得 → 形の検査 → sha256 → R2 の put（内容アドレスの key なので無条件。同じ sha で object があれば put しない）→ **有効化を 1 つの batch で**、各文に `WHERE EXISTS (SELECT 1 FROM rights_records WHERE asset_key = ? AND claim_token = ? AND blocked = 0)`: `INSERT INTO models3d_files (…) SELECT … WHERE EXISTS(…) ON CONFLICT(catalog_id) DO UPDATE SET …`・`INSERT INTO rights_hosted (asset_key, sha256, verified_at, check_token) SELECT … WHERE EXISTS(…) ON CONFLICT(asset_key, sha256) DO UPDATE SET verified_at = excluded.verified_at, check_token = excluded.check_token`・`rights_checks` に `result = 'import:fetched'` / `'import:unchanged'` の 1 行。`models3d_files` か `rights_hosted` の文が 0 行なら有効化されていない → 行を読み直し、claim を失っていれば `lost_claim`（`verified` を返さない）、止めていれば「止めているので取り込まない」。取り残された R2 の object は参照されないだけで害はない（回収は範囲外）。取得・検査の失敗は `rights_checks` に `result = 'import:' + error` の 1 行（claim を持つ時だけ）。権利の記録には影響しない。成功を保存する 4 の UPDATE は `blocked`・`modified` の列を書かない（確認の途中に止めても上書きしない）。
  7. **解放**: `UPDATE rights_records SET claim_at = NULL, claim_token = NULL WHERE asset_key = ? AND claim_token = ?`。
  8. 1 行のログ `{at: 'rights_check', asset_key, kind: evidence_kind, result, code}`（`result` は `verified` / `human` / `human_unchanged` / fail_code / `lost_claim` / `busy`。v3.1: 取り込みの前の読み直しで claim を失っていた時と、有効化の batch が claim を失って 0 行だった時も `lost_claim`（この時は `verified` のログを出さない）。取り込みは `{at: 'model3d_fetch', …}` の既存のログ。有効化されなかった時は `status: 'not_activated'`）。

## AK-3 D1（migration `0017_rights.sql` verbatim）

```sql
CREATE TABLE rights_records (
  asset_key TEXT PRIMARY KEY,
  subject_sha256 TEXT NOT NULL,
  license_code TEXT NOT NULL,
  license_url TEXT NOT NULL,
  attribution TEXT NOT NULL,
  evidence_kind TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  modified INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  blocked INTEGER NOT NULL DEFAULT 0,
  fail_code TEXT,
  checked_at TEXT,
  last_attempt_at TEXT NOT NULL,
  checked_by TEXT NOT NULL,
  claim_at TEXT,
  claim_token TEXT
);
CREATE TABLE rights_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_key TEXT NOT NULL,
  at TEXT NOT NULL,
  by TEXT NOT NULL,
  evidence_kind TEXT NOT NULL,
  result TEXT NOT NULL,
  license_code TEXT,
  evidence_json TEXT NOT NULL,
  check_token TEXT
);
CREATE INDEX rights_checks_asset ON rights_checks(asset_key, id);
CREATE TABLE rights_hosted (
  asset_key TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  check_token TEXT NOT NULL,
  PRIMARY KEY (asset_key, sha256)
);
```

- `rightsRecordRows(db): Map<string, RightsRecord | 'invalid'>`（`src/rights-store.ts`（新規））: `status` / `evidence_kind` / `license_code` が知らない値、`blocked` / `modified` が 0/1 でない、`attribution` が空、`subject_sha256` が 64 桁の hex でない、`evidence_json` が JSON 配列でない行は **`'invalid'`**。
- `loadRightsGate(env): Promise<RightsGate>`: `rights_records` の全行（≤ 200）・`rights_hosted` の全行（≤ 1000）・`hostedModels3d(env)` を 1 回ずつ読む。
- 止める / 戻す: `setRightsBlocked(env, e, blocked, by)`: 行が無ければ `unverified` の行（AK-2 の claim と同じ値・`claim_at = NULL`・`last_attempt_at = '1970-01-01T00:00:00.000Z'`（未試行。cron がすぐ確かめる。v3.1））を作ってから `blocked` を更新。`rights_checks` に `result = 'blocked'` / `'unblocked'` の 1 行（1 つの batch）。**止めている間も確認は走る**（取り込みはしない）。「戻す」は記録を変えない。
- `lastRightsEvents(db, assetKey)`: `rights_checks` の最後の失敗（`result` が `verified` / `human` / `blocked` / `unblocked` でなく `import:` でも始まらない最後の行）と、最後の取り込みの失敗（`import:` で始まり成功（`import:fetched` / `import:unchanged`）でない最後の行のうち、`rights_hosted` の同じ項目の最新の `verified_at` より新しいもの。無ければ null）。v3.1: `verified_at` は取り込みが成功するたびに更新される（同じ sha でも）。管理のページは全件版 `lastRightsEventsAll`（3 クエリ）を使う。

## AK-4 門番の差し込み口（6 つの出口）

1. 注文票（`src/jobs.ts` 414 行付近）: `offerableModels3d(await loadRightsGate(env))`。`models3dSectionLines(list)` は `Array<{entry, record}>` を受け、行を `- <id>: <title_ja>（<org>・<licenseLabelOf(record)>）— 札: … — 出典の url: <page_url>` にする。
2. 取り込み検査（`src/jobs.ts` 1895 行付近・`src/checks/schema.ts`）: `validateOutputs(files, { models3dCatalog?: ReadonlyMap<string, Model3dEntry> })` に替え、呼び出し側が `offerableCatalogMap(await loadRightsGate(env))` を渡す（既定は空の Map）。`checkModels3d` は変えない。
3. 学習者側の一覧（`src/routes/library.ts` `libraryModels3d`）: `offerableModels3d(gate)` の各件を `model3dViewOf(entry, record, hosted)` で出す。キーは v1 の 8 + `license_code`・`license_url` + download の 3。`cache-control: public, max-age=600`（初回の 0 件が 1 時間残らないように。§AJ2 の 3600 を改訂）。
4. 確認画面（`src/routes/review.ts` `models3dMetaOf`）: `Model3dMeta` の `license` を `licenseLabelOf`、`attribution` を record の値にし、`license_url`・`license_code`・`rights_kind`・`rights_status` を足す。一覧に無い id は従来どおり出さない。門番で × のものは `rights_blocked: true` と `rights_reason`（`rightsReasonOf`）を付けて出す（埋め込み・model-viewer は描かず「権利の確認で止まっています（<理由の日本語>）」の文。`admin.js` の `model3dPreviewHtml` はこの時 `<iframe>` も `<model-viewer>` も出さない）。
5. 取り込み: `POST /api/models3d/<id>/fetch` は **廃止**（§AJ2-2 の改訂）。取り込みは AK-2 の 6 だけ。手で行う時も `POST /api/rights/models3d/<id>/check`。
6. 配信（`src/routes/library.ts` `libraryModel3dFile`）: 形の検査のあと 1 クエリ `SELECT r.*, h.sha256 AS hosted_sha FROM rights_records r LEFT JOIN rights_hosted h ON h.asset_key = r.asset_key AND h.sha256 = ? WHERE r.asset_key = ?` を読み、行を `rightsRecordRows` と同じ規則で読んで `rightsModes(record, entry).host` でなければ 404、`hosted_sha` が null なら 404。それから R2 get。`cache-control: public, max-age=86400`。

## AK-5 運営の操作と画面（`#/models3d` を広げる。`ui-interaction-completeness` の 5 点を満たす）

- `GET /api/models3d`（既存）: `state` は §AJ2 のまま。各件に `rights` を足す: `{ code, label, license_url, attribution, evidence_kind, status, blocked, checked_at, last_attempt_at, fail_code, check: 'api' | 'statement' | 'cc-url' | 'none' | 'unsupported', modes: { host, embed }, record: 'ok' | 'none' | 'invalid', reason: rightsReasonOf の値, last_fail: { at, result } | null, last_import_fail: { at, result } | null }`（行が無い項目は `code: 'unknown'`・`status: null`・`record: 'none'`）。
- `POST /api/rights/models3d/<id>/check`（Access・`human_only`。service token は Access の層で 401 + handler で 403）: `runRightsCheck(env, e, c.email)`。応答 `{ status: 'verified' | 'human' | 'human_unchanged' | 'failed' | 'skipped' | 'lost_claim', code?, label?, fail_code?, fail_class?, reason?, modes, blocked?, import?: { status: 'fetched' | 'unchanged' | 'failed' | 'blocked', bytes?, error? } }`（v3.1: `blocked` は確認の後に読み直した値。止めていたので取り込まなかった時は `import.status = 'blocked'`、toast は「確かめました（<label>）。止めているので取り込みません」）。404 `not_found`。
- `POST /api/rights/models3d/<id>/block` / `…/unblock`（同じ認証）: `setRightsBlocked`。応答 `{ blocked }`。
- 画面 `#/models3d` の表の列: 題名 / 提供元 / 権利（label・根拠の日本語: `api` → 「機械: 提供元の API」・`statement` → 「機械: 提供元の記述」・`cc-url` → 「機械: CC の URL（埋め込みだけ）」・`human` → 「人の記録」。`record` が `none` なら「未確認」、`invalid` なら「記録が壊れています」。`reason` が `subject_changed` なら「一覧が変わりました（確かめ直し待ち）」。`check` が `unsupported` なら「確かめ方が未登録（台帳に足す）」。`blocked` なら赤の札「止めている」。`status` が `stale` なら「取り直し失敗: <理由>」、`mismatch` なら「対象が一致しません: <理由>」、`unverified` なら「確認できていません: <理由>」。`last_import_fail` があれば「取り込み失敗: <理由>」。`modes` が両方 × で `status` が `verified` なら「提供できません（<label>）」）/ 確認日（`checked_at`。無ければ最後の試行 `last_attempt_at`）/ 種類 / 状態 / 操作。
- 操作: 「権利を確かめる」（`check` が `unsupported` の時は出さない。blocked でも出す）→ `action()` で確認ダイアログ（本文: 「提供元の記録を取りに行き、通ればファイルも取り込みます（GLB の件）」）→ toast: `verified` で modes あり → 「確かめました（<label>）」、`verified` で両方 × → 「確かめましたが提供できません（<label>）」、`human` → 「人の記録を書きました」、`human_unchanged` → 「人の記録に変わりはありません」、`failed` → 「確かめられませんでした（<理由の日本語>）」、`skipped`（busy）→ 「いま別の確認が走っています」、`lost_claim` → 「確認が長引いたので結果を捨てました。もう一度」、取り込みあり → 「取り込みました（x MiB）」/「確かめましたが取り込めませんでした（<理由>）」、blocked 中 → 末尾に「（止めているので出ません）」。「止める」（確認ダイアログ: 「学習者側の一覧と配信から外します」）/「戻す」（確認ダイアログ: 「最後の記録のとおりに戻します（<label>・<状態>）」）。失敗は toast + 再読み込み。「取り込む」のボタンは無くす。
- `fail_code` の日本語（純関数 `rightsFailText`）: `fetch_failed:*` → 「提供元から取れませんでした」、`too_large` → 「提供元のページが大きすぎます」、`bad_response` → 「提供元の応答が読めません」、`uploader_mismatch` / `uploader_missing` → 「投稿者が一覧と違います / 一覧に投稿者がありません」、`embed_mismatch` / `page_mismatch` / `uid_mismatch` → 「提供元の情報が一覧と違います」、`attribution_mismatch` → 「出典の書き方が投稿者の名前と合いません」、`no_cc_url` → 「ページに CC の URL がありません」、`ambiguous_cc_url` → 「ページに CC の URL が 2 つ以上あります」、`title_*` → 「ページの題名が一覧と違います」、`source_*` → 「ページの Source の行が一覧と違います」、`third_party_marker` → 「第三者の権利の印があります」、`download_url_not_linked` → 「ページにファイルのリンクがありません」、`statement_missing:*` → 「提供元の決まりの文が見つかりません」、`evidence_*` / `subject_mismatch` → 「根拠のページが対象と合いません」、その他 → コードをそのまま。
- 確認画面（`admin.js`）の `models3dTermsHtml` と埋め込みの caption: 「ライセンス: <label>（<license_url>）。出典の書き方: <attribution>。根拠: <根拠の日本語>」。`rights_blocked` の版は描かない（上の文）。

## AK-6 自動（cron の段 `rightsStep`。`src/rights-cron.ts`（新規））

- 置き場: `src/cron.ts` の 3-c `images` の直後（3-d）。`try { out.rights = await rightsStep(env, { deadline: cronStart + CRON_LIMIT_MS - INTAKE_END_MARGIN_MS, fetchImpl }) } catch (e) { out.rights_error = e instanceof Error ? e.name : 'error' }`。
- 対象（`rightsCandidates(entries, rows, subjects, now)`: 純関数）: 一覧の項目のうち `providerOf(e)` が `unsupported` でないもので、次のどれか: (a) 行が無い / (b) 行の `subject_sha256` が `subjectSha256(e)` と違い、**かつ `last_attempt_at` が 1 時間より前**（v3.1・B4: 失敗し続ける指紋違いは 1 時間に 1 回しか枠を使わない。指紋は失敗の時に更新しない = 古い権利の記録を新しい対象に戻さない）/ (c) `status` が `verified` / `human` で `checked_at` が 30 日より前 かつ `last_attempt_at` が 1 日より前 / (d) `status` が `stale` / `unverified` / `mismatch` で `last_attempt_at` が 1 日より前。`claim_at` が 10 分以内なら対象外。並び: **(a)（一覧の順）→ (b)（`last_attempt_at` の古い順）→ (c)(d)（同じく古い順）**。**1 回の cron で 5 件まで**。1 件を始める前に `deadline - 330 s` を過ぎていたら残りは次回（v3.1: 1 件の最悪 150 s と、後続の会議・振り返りが要る 180 s を残す）。
- 1 件ずつ `runRightsCheck(env, e, 'cron')`。戻り値 `{ checked, verified, human, failed, skipped, lost, imported }`。`paused` の設定が真なら `'paused'` を返す（他の段と同じ）。
- 初回の deploy 後（見込み。保証ではない）: 一覧の 23 件は 5 回の cron（約 50 分）で一巡する。失敗しても `last_attempt_at` が進み、(b) は 1 時間・(d) は 1 日空けるので、先頭の失敗が後続を止め続けない（v3.1）。**一巡するまで、行が無い項目は学習者側の一覧・注文票・確認画面に出ない**（意図した fail-closed。確認画面の既存の版は「権利の確認で止まっています（未確認）」の文になる。進行中の注文で立体モデルを書いた版は取り込み検査で `bad_model3d` になるが、§L の自動の直しで次の版が作られる）。探査車は verified になった直後に取り込みが自動で走る。

## AK-7 受け入れ（fake・vitest。`test/rights.test.ts`（新規）ほか。実物の提供元には繋がない）

1. `normalizeLicenseUrl` / `licenseCodeOfUrl`: 表（最低 16 行: http、`deed.ja`、`legalcode.ja`、`legalcode`、末尾 `/` 無し、大文字、query 付き、`by/2.1/jp/` → cc-by、`by/2.1/` → unknown、`by/4.0/jp/` → unknown、`by/1.0/zz/` → unknown、`by/9.9/` → unknown、`by-nc/4.0/` → cc-by-nc、`zero/1.0/`、`mark/1.0/`、nasa の url、関係ない url → unknown、parse できない → unknown）。
2. `subjectSha256`: 固定の項目で固定の hex と一致 / `page_url` を 1 字変えると変わる / `checked_how` を変えると変わる / `topics` を変えても変わらない。
3. `rightsModes`: **全組み合わせ**（`undefined` / `'invalid'` + 指紋の一致 2 × code 10 × evidence_kind 4 × status 5 × blocked 2 × modified 2 = 1602 通り）を、テストの中に書いた AK-1 の表（上から順の規則をそのまま写した列挙）から期待値を作って突き合わせる（実装の関数を期待値に使わない）。加えて代表の 12 行を手書きの期待値で（`human × nasa-media` ×、`cc-url × cc-by` は embed だけ、`pdm` の host ×、`modified` の BY-SA の host ×、指紋違いは全部 ×）。
4. `offerableModels3d` / `offerableCatalogMap` / `rightsReasonOf`: 行が無い項目は kind を問わず出ない（`no_record`）/ `'invalid'` は出ない / 指紋違いは出ない（`subject_changed`）/ sketchfab の `verified`（api・cc-by）は出る / `human`（cc0）の voyager は出る / `human` の download は出ない / `cc-url` の download は出ない / NC の行は出ない（`license`）/ blocked は出ない / `unverified` / `mismatch` は出ない / download は `verified` でも hosted に無ければ出ない / hosted でも `rights_hosted` にその sha が無ければ出ない / `stale` の download は hosted + `rights_hosted` にあれば出る。
5. `sketchfab` の `api` 検査（fetch stub）: 通る（code・license_url・attribution = 一覧の値・evidence_json の sha が固定値と一致・`subject_sha256` が今の指紋）/ `license.url` が NC → verified だが modes × × / 各 fail_code を 1 つずつ（404・非 JSON・`user` null・uid・uploader null・uploader 違い・embedUrl 違い・viewerUrl の host 違い・license.url 無し・displayName が 2 字・attribution が displayName を含まない（「Natural Asset Studio」vs「Natural History Museum」は `attribution_mismatch`）・256 KiB 超 = `too_large`）/ OMNH の実測の displayName と attribution の組で通る / 遷移表の全セル（行なし・unverified・verified・stale・mismatch × 成功・transient・mismatch）。
6. `nasa-3d` の `statement` 検査（3 ページの stub。実測の文の形で）: 通る / h1 が 2 つ → `title_missing` / h1 が違う → `title_mismatch` / `source_not_nasa` / `source_mismatch`（直後が違う・` Details Source ` が無い）/ `third_party_marker`（Details の区画の 610 字目に `Courtesy of`・`&#169;` の形・`<!-- -->` の中の印は無視される）/ `download_url_not_linked`（href が無い・テキストにだけある・`<!-- href="…" -->` の中だけ）/ `statement_missing:hub` / `statement_missing:terms` / `license_url_mismatch` / 1 MiB 超 = `too_large` / リダイレクト（302）→ `fetch_failed:302`。
7. `dbcls` の `cc-url` 検査: `deed.ja` と `legalcode.ja` の 2 つ → 1 件に正規化されて verified `cc-by`、modes は embed だけ（download なので出ない）/ 0 件 → `no_cc_url` / `by/4.0/` と `by-sa/4.0/` → `ambiguous_cc_url` / `evidence_url` null → `evidence_url_missing` / host 違い・path の先頭 2 区分違い → `evidence_scope_mismatch` / `title_src` が本文に無い → `subject_mismatch`。
8. `smithsonian`: `runRightsCheck` が `human` の行を書き、同じ一覧で 2 回目は `human_unchanged`（`rights_checks` が増えない・`last_attempt_at` は進む）/ 一覧の `license.url` を NC に変えた 2 回目は行が書き換わり modes × × / `attribution` だけ変えた 2 回目も書き換わる / 台帳に無い host: `skipped` で D1 に書かない。
9. claim: 2 本の `runRightsCheck` を同じ項目で同時に走らせる（stub の fetch を待たせる）と 1 本だけ検査し、もう 1 本は `busy` / `claim_at` が 10 分より古い行は取れる / **lost claim**: A が claim → B が 10 分後に回収して mismatch を保存 → A が成功を保存しようとすると `changes` 0 で `lost_claim`、行は mismatch のまま・`rights_checks` に A の行は無い / 取り込みの間も claim が保持され、終わってから解放される（取り込みの stub の中で別の check が `busy`）。
10. 取り込み: `verified` の直後だけ `importModel3d` が呼ばれる / `stale` の確認では取り込まない（`rights_hosted` が増えない）/ 成功で `rights_hosted` に `(asset_key, sha, check_token = その確認のトークン)` / 失敗は `rights_checks` に `import:` の行、記録は `verified` のまま / 後の取り込みが成功すると `last_import_fail` は null。
11. 出口: 学習者側の一覧 API が行の無い項目を出さない・`cache-control: public, max-age=600` / 出る件に `license_code`・`license_url`・attribution が一覧の値 / 配信 API: 行が無い → 404、`verified` + `rights_hosted` にある sha → 200（`cache-control: public, max-age=86400`）、ある sha でも `blocked` → 404、`mismatch` → 404、指紋違い → 404、`rights_hosted` に無い sha → 404。`POST /api/models3d/<id>/fetch` が 404（route が無い）。
12. 確認画面 API と描画: `models3d_meta` に `license_url`・`rights_kind`・`rights_status` / 行が無い版は `rights_blocked: true`・`rights_reason: 'no_record'` / NC の行は `license` / `admin.js` の `model3dPreviewHtml`（`window.FactoryAdminModels3d` 経由の純関数のテスト）が `rights_blocked` の全理由で `<iframe>` も `<model-viewer>` も出さず理由の文を出す。
13. 取り込み検査の実経路: `validateOutputs(files, {})`（既定）で download の models3d が `bad_model3d:…:catalog` / `offerableCatalogMap(gate)` で verified + hosted + `rights_hosted` の download だけ通る / jobs の取り込み（`rework-from-previous.test.ts` と同じ作り。R2 fake に `head` を足す）で、行の無い項目を書いた material.json が `bad_model3d` で落ち、行がある項目は通る。
14. cron の段: `rightsCandidates` の全規則（行なし・指紋違いが先 / 30 日 + 1 日 / 1 日 / claim 10 分 / unsupported を飛ばす / blocked は飛ばさない）/ 5 件で止まる / deadline を過ぎたら残す / 先頭 5 件が毎回失敗しても次の cron で別の 5 件に進む / `paused` / ログの 1 行に url も attribution も無い（手動の確認・例外・取り込みの失敗の行も同じ）。
15. 運営の API: service token → 新しい 3 route で Access の層の 401（既存の service token のテストと同じ作り）と handler の 403 `human_only` / 知らない id → 404 / block → `blocked: true` と `rights_checks` の 1 行、行が無ければ `unverified` の行ができる / unblock → false / blocked 中の check が記録を更新し modes は × のまま。
16. migration: `test/d1-shim.ts` に 0017 を足し、空の DB と `models3d_files` に行がある DB の両方で `loadRightsGate` が読める / `rightsRecordRows` が不正な行（知らない status・`blocked = 2`・空の attribution・壊れた evidence_json・`subject_sha256` が 63 桁）を `'invalid'` にする。
17. 一覧の検査（`scripts/sync-claude-assets.sh` と `test/models3d-catalog.test.ts`）: sketchfab の項目に `uploader`（`^[A-Za-z0-9_.-]{1,60}$`）が無ければ止まる / sketchfab の `page_url` が `^https://sketchfab\.com/3d-models/[A-Za-z0-9-]*<uid>$` でなければ止まる / download 以外の `evidence_url` は null / `dbarchive.biosciencedbc.jp` の download は `evidence_url` 必須 / `license.url` が `licenseCodeOfUrl` で `unknown` になる項目があれば止まる / 生成ファイルに `uploader`・`evidence_url`・`checked_how` が出る。
18. 既存のテスト（`models3d-v2` / `models3d-order` / `models3d-schema` / `models3d-library` / `rework-from-previous` / `retro` / `review-preview` の fixtures）は本契約の変更分だけ更新する（`fetch` route のテストは check route に書き換える）。
19. v3.1 の回帰（`test/rights-revise.test.ts`。修正前のコードで落ちることを確かめてから直す）: B1 = 属性値の中の `<!--` `-->` `<script>` `</script>` で隠した印・単一引用符の属性値・script の中の `<!--` の後ろの本文・生 HTML の区画の印（属性の `&copy;`・コメント・script・`;` なしで先頭が 0 の数値の実体）・実経路で取り込みも掲載も起きない・script の中の偽 h1 は数えない・単一引用符と実体を含む href は通る・`data-href` / script の中 / `<a>` 以外の要素は `download_url_not_linked`・閉じていないコメント / 属性の引用 / script / タグは `unparseable`（mismatch）・DBCLS の script の中の BY と実体で書いた NC の混在・href と表示の不一致・コメントの中だけの URL は no_cc_url / 別の URL がコメントにあれば ambiguous。B2 = A の R2.put の間に lease を回収し B が別の sha を取り込む → A は `lost_claim`・D1 と `rights_hosted` と一覧は B の sha のまま。B3 = 提供元の検査の途中と GLB の取得の途中に止める → 取り込まない・有効化しない・`blocked` を上書きしない。B4 = 先頭 5 件が旧指紋で 503 でも 6 件目が 1 回目で確かめられる・失敗した (b) k 件は 1 時間に k 回・並び・締め切りの 330 秒前。(i) 同じ sha の成功 → 失敗 → 成功で `last_import_fail` が消える。(iv) 止めて作った行を cron がすぐ確かめる。

## AK-8 位置づけ（v1 で変えないレーンとの整合。表の行として記す）

| 資料 | 見せ方 | 権利の根拠 | 決める場所 |
|---|---|---|---|
| 立体モデル（sketchfab / voyager） | 提供元の公式の埋め込み（複製しない） | 本契約の記録（embed。機械の根拠か、機械で確かめられない提供元の人の記録） | `offerableModels3d` |
| 立体モデル（download） | 複製して配る（host） | 本契約の記録（host。`api` / `statement` の根拠だけ。sha ごとの取り込み記録） | `offerableModels3d` + 配信 |
| 動画（§Q） | YouTube の公式の埋め込み（複製しない） | 提供元の標準の決まり（埋め込みのみ） + 本人のチャンネルを人が初回だけ確かめる（`trusted_channels`） | §Q のまま（本契約の `rightsModes` には載せない。将来 `provider-embed` の行として統合する時は別契約） |
| 出典（sources.json・お題の sources） | url を示す・短い引用（`quoted_excerpt`） | 引用は複製ではあるが、著作権法 32 条の要件（明瞭な区別・主従の関係・必然性・出典の明示）を満たす時だけ許される。既存の検査（§L・§T）は「文がページにある」「出典がある」を見るだけで、**適法な引用であることの保証ではない**。字数の上限も根拠にならない | 既存（次段 PR-AK2 で扱う） |
| 本文（.md / app.html） | 職人が自分で書く | 丸写しは引用でない → **PR-AK2（次段）**: 取得したページの文と本文の 100 字以上の一致を `verbatim_copy` として止める（§P の取得記録の文を使う。純関数 + `checks/citations.ts` への差し込み）。これは検出の手段であって非侵害の保証ではない | 次段 |
| 新しい提供元・記述だけのページ | — | **PR-AK3（次段）**: LLM の「権利係」が「このページのこの文」を候補として出し、同じ機械の検査（`page-quote`: 文がページにある + 文が固定の正規表現でどの code かに当たる + host が台帳の「記述を認める host」）で決める。LLM は code も見せ方も決めない。複製の根拠にはしない（`cc-url` と同じ） | 次段 |

## AK-9 PR と着地

- PR-AK1（本契約の全部。1 つの commit で着地 = 出口の資格が揃っていない中間の状態を本番に出さない）: migration 0017、`src/rights.ts` / `rights-providers.ts` / `rights-check.ts` / `rights-store.ts` / `rights-cron.ts`、`src/models3d.ts` の置き換え、6 つの出口、`src/routes/rights.ts`（新規）と `src/index.ts` の ROUTES 3 本（`fetch` route の削除）、`GET /api/models3d` の `rights`、`admin.js` / `admin.css` / `index.html`、一覧 `catalog.json`（`uploader` 17 件・`evidence_url` 1 件・他は null）と `sync-claude-assets.sh`・生成ファイル（`checked_how` を出す）、`factory/models3d/README.md`（「載せる決まり」「子ども向けアプリでの見せ方」を本契約に合わせる: 出典の表示は `attribution`・`license`・`license_url`・`page_url` の 4 つ）、`docs/plans/models3d/contract-AJ2.md` の冒頭に改訂の注記（`fetch` route の廃止・配信が D1 を見る・キーの追加・cache の短縮）、`CONTRACT-factory.md` §AK（v3.17）、テスト AK-7。着地は worktree から `git push origin HEAD:main`、deploy は `deploy-ref.sh`（migration 0017 が当たる）。職人の定義は変えない（`ant apply` 不要）。
- deploy 後の確認（AI が行う）: 本番の `GET /api/library/models3d` が 200（直後は 0 件でよい）。cron が一巡したあと（約 50 分の見込み）同じ API に sketchfab 17 件と voyager 3 件が戻り、`nasa-perseverance-rover` に `file_url` が付き、その url が 200・`content-length: 4987176`・`cache-control: public, max-age=86400` を返す。ISS は `import:too_large` の行、DBCLS は download なので一覧に出ない。`GET /api/models3d` は Access の中なので、ふじさんの Chrome で `#/models3d` を見てもらう（TODO ではなく報告の添え物）。

## 未確認の点

- Sketchfab の `license.slug` の全一覧（公式 docs が自動取得で読めない）。本契約は `license.url` だけを使うので影響しない。
- Smithsonian の scene JSON の `asset.copyright`（All rights reserved）と記録のページの CC0 表示の食い違い（記録のページは 403 で機械では読めない）。v1 は人の記録 = embed のみ。
- YouTube の oEmbed が「埋め込み不可」の動画に 401 を返すか（§Q の機械化の種。本契約の範囲外）。
- Public Domain Mark の扱い（host ×）は保守的に決めた。必要になったら表の 1 行とテストを変える。
- 取り込みの自動化（確認の直後に GLB を取る）に運営の明示の操作を挟まない判断は、ふじさんの「取り込むなら取り込む」に依る。止めたければ `#/models3d` の「止める」。
- D1 の実環境で claim の SQL と `meta.changes` が node:sqlite と同じに動くことは、deploy 後の 1 件目の確認で見る（ログの `result`）。
