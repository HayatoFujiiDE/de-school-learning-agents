# 素材の形 v2 — システムマップ（MAP 3 レンズの統合。2026-11-07。パスは factory/worker/ 相対）

## 1. 決定済み（ふじさん 2026-11-07。蒸し返さない）
- 本文は中学生向け 1 本（600 字目安。「やってみる → 気づく → ことば」。最初の段落は手を動かす文）。小学生版・短い/長い・控えは作らない
- 面白さの芯（spark）1〜2 文を素材に持つ。子どもには見せない（バディ・読み手係が使う）
- 問いの種（questions_for_kids）2〜5 件。各問いに答えになる claim id。答えは書かない
- 関心別の入口は本文でなく構造化（interest_entries）。遊びの形（play.md）と入口は必須から外す
- 質の基準 5 つ: ①最初の段落が手を動かす文 ②問いが答えより先 ③芯と活動がつながる ④1 段落に新しいことは 1 つ ⑤目標語なし。読み手係に載せる。機械で決まるもの（長さ・目標語・最初の段落の形）は取り込み検査で先に落とし、既存の自動作り直し（2 回）へ
- 職人の指示は「良い素材とは」を先頭に組み直す（司令塔が書く）
- schema_version 2。既存（全部 schema 1）は読める形で残し、依頼箱 material_redo で順に作り直す
- 公式 docs 確認済み（platform.claude.com/docs/en/managed-agents/define-outcomes）: outcome の grader は職人と別 context の独立した採点係。rubric は「explicit, gradeable criteria」で。max_iterations 既定 3・最大 20

## 2. v2 の形（司令塔案。PLAN レンズは名前・必須/任意を詰めてよい）
```json
{
  "schema_version": 2, "slug": "…", "title": "…", "kinds": [3,4], "catalog_item_id": "…", "concept_codes": [],
  "summary": "…60〜80 字（中学生向け）…",
  "spark": "何に気づくと面白いか 1〜2 文（子どもには見せない）",
  "conditions": {…}, "license_summary": "…",
  "parts": [{
    "id": "p1", "kind": 3, "title": "…",
    "entry_point": {"type": "touch", "text": "最初にやること 1 文"},
    "body": "parts/p1/body.md",
    "play": "parts/p1/play.md",
    "questions_for_kids": [{"id": "q1", "text": "…？", "claim_ids": ["c2"]}],
    "interest_entries": [{"interest": "minecraft", "text": "マイクラが好きなら…"}],
    "files": [...], "videos": [], "models3d": [], "adjustable": [...], "tech_dependencies": [...], "runtime_check": {...}, "needs_supporter_check": false
  }]
}
```
- claims.json: `claims[].text_elementary`（任意。易しくすると意味が変わる事実だけ）
- basename 一意の規則（§E-0）は維持: パーツ 2 つ以上なら `parts/p2/p2-body.md`
- `interest` の語彙は既存の schema.ts:342 の検査と同じ（app-v3/js/data.js のカテゴリ id か null）

## 3. v1 の形に依存する箇所（Scope + Module レンズ）
### Worker（validator / scanner / builder / serializer）
| file:line | 役割 | v1 前提 |
|---|---|---|
| checks/schema.ts:14-27, :34-38, :302-330, :541, :546, :574-597, :491-498, :718-726, :744-750 | validator（唯一の取り込みゲート。呼び出しは jobs.ts:1895 の 1 か所） | 必須キー summary_*、`schema_version !== 1` で拒否、4 変奏 `missing_variant:*`、computePublicPaths が variants[].path |
| checks/childtext.ts:101-118, :151-176, :180-181 | scanner → checks_json.child_text | variants の .md だけ走査。summary_* を走査 |
| checks/layout.ts:24-36 | resolver（basename → 論理パス） | variants/files の path |
| checks/forbidden.ts:31-34, :68-72 / jobs.ts:1969-1976 | scanner | summary_* を入力に取る |
| checks/triage.ts:21-35 Cause, :63 CAUSE_TEXT, :126 ITEM_TITLE, :159-160, :201 ITEM_CAUSES, :291 RETURN_NOTE_TEXT, :298-323 READER_*, :326 readReaderResult, :536-537 materialPaths（private）, :644, :779, :911-934 child_text → items（他 kind は :932 で捨てる）, :1044-1079 reader → items, :1118 needs_fix, :1146 auto_return | 仕分け | variants を歩く・variant path でキー・reader の learning/conditions 必須 |
| reader.ts:41-61 READER_SYSTEM（契約 V-4 d verbatim）, :64-94 READING_SCHEMA（strict・全項目 required）, :104-106, :129-133 variantLabel, :154-161 materialSectionOf（summary_*）, :180, :205-249 buildReaderInput（`## {path}（小学生・短い…）`）, :267 parseReading, :463 not_read | prompt builder / parser | `<variants>` の .md だけ読む。body.md は読まれない |
| verify.ts:81（文言）, :536-560（parts/* を拡張子で列挙 = 形に依存しない）, :1614-1615 summary_*, :1638-1643 appPaths(variants+files .html) | prompt builder | 判定は claim_id キー（形に非依存） |
| routes/library.ts:64-117（:90-102 variants/summary_* を serialize, schema_version は返さない）, :55 libraryFile（public_paths で gate） | serializer | 消費者は repo 内に無し（app-v3/tools は /api/library/topics のみ。positive control 済み） |
| routes/review.ts:147,168,172,193,448 / triage-step.ts:144 / rework.ts:113,135 / verify.ts:934 / jobs.ts:1693,1731 / routes/floor.ts:97,133 | material_json を unknown で再パース（TS 型を使わない） | 寛容（object でなければ飛ばす） |
| jobs.ts:193-200 defineOutcomeEvent（:890, :1494 で送信）, :262-299 buildPhase1Message | rubric / 編集基準の送信 | **session 作成時に凍結されない**: define_outcome は送る時点の Worker の RUBRIC_COMMON |
| src/generated/claude-assets.ts ← scripts/sync-claude-assets.sh:110-126（editorial-standards / rubrics / allowlist / fixtures.generated.ts） | 生成物（git 管理・deploy/typecheck/dev で再生成） | |

### 画面（admin.js。§AK レーンは触らない領域）
- :3072-3150 variantsOf / variantSel / locateItem（「中学生・長い にあります」）
- :3368-3395 AUD_LABEL / LEN_LABEL / defaultPv / pvLabel / variantLabel / pickVariant
- :3479 previewMedia（**§AK の hunk 3456-3478 の直後 = textual conflict の可能性**）
- :3536 previewBodyHtml / :3581-3588 pvSwitchHtml（切替）/ :3616-3626 sticky の variant_path / :3707-3729 previewFrameHtml（summary を audience で選ぶ・data-mode es/js）/ :3731 missingVariantHtml
- :4198-4237 fillPreview / :4252-4266 loadAllMd / :4297-4345 切替ハンドラ / :4447-4500 付箋 draft（variant_path/label）
- :2623 CAUSE_TEXT の写し・:2638 READER_KEYS。admin.css:659-913 .mat-preview / .mp-seg / .mp-tg / [data-mode="es"]
- テスト: test/review-preview.test.ts（29 hit）、models3d-review-preview

### テスト・fixture・smoke
- test/fixtures/_shared/outputs/material.json（v1・4 変奏×2 parts + p1-game.md・9 .md）→ fixtures.generated.ts（sync script）
- test/helpers.ts:3-46 v1 builder（多数のテストが使う）
- v2 ケースが要るテスト: schema, childtext, layout, forbidden, reader, triage, review-preview, mc-edition, mc-published, reingest-route, rework-from-previous。v1 のままでよい: images, models3d-*, verify-*, video-q*
- scripts/smoke.mjs:293-308 が `parts/p1/p1-elementary-short.md` を直書き、:276-380 が /api/library/available

### 契約
- CONTRACT-factory.md: §B-7 (:279-280), §D-3 (:439), §E (:490-496), §E-1 (:503-526), §E-4 (:540-542), §F-2 (:555), §L-3 (:897), §L-6 3 (:940), §L-8 1 (:959), §M-1/§M-4 (:967-970), §R-6 (:1281)。§AK（la-q11）は :1386 に append
- docs/plans/review-auto/contract-V.md: V-3 (:103-104,:111,:115), V-4 (:166-183, :191-192), V-5 (:250-252), V-6 (:395,:400), V-9 (:461,:463,:481), V-10 (:510-515), V-11 (:543)
- docs/plans/minecraft-facts/contract-MC.md: MC-1 3 (:27 全本文ファイル), MC-5 (:83), MC-8 (:104)
- docs/plans/image-generation/contract-M2-draft.md :885, :968
- 司令塔所有: factory/claude/agents/material-maker.md:175-179,205 / rubrics/common.md:14 / kind-3.md / kind-4.md（「小学生表示を既定」）/ editorial-standards.md

## 4. 依存と順序（Dependency レンズ）
- 取り込みのゲートは schema.ts:541 の 1 関数 → **1 と 2 の両受け**は実現可能（型 `schema_version: number`）。v2 出力が v1 Worker に当たると invalid_outputs → 復旧は依頼箱 job_reingest（jobs.ts:665）
- 出荷経路: 職人定義・cloud.yaml は `ant apply`（claude-lock.json 更新・README）。rubric・編集基準は Worker に bundle。先例の順序: **Worker deploy → ant apply → 確認用 session 1 本**（contract-Q.md:403 / contract-V.md:518）
- **define_outcome は session 作成時に凍結されない**（送る時点の Worker）。deploy と ant apply の間に phase 1（質問待ち）の session があると、v1 prompt + v2 rubric（またはその逆）の取り合わせが起きうる。session が agent の版を pin するかは不明（公式 docs 要確認）
- 読み手係 → 仕分け → 自動作り直し: findings は kind:'reader' / key explanation_and_expression / severity 通過（triage.ts:1044-1061）。learning/conditions の problem → fix、unclear → ask（:1062-1068）。fix ≥1 → needs_fix（:1118）→ `auto_return`（fix>0 && autoRounds < AUTO_RETURN_MAX=2、wrangler.jsonc:81。カウンタは parent_version_id を遡って再計算 triage-step.ts:92-112）。新しい finding kind は enum の上位集合なので旧 reader_json も valid。新しい judgement キーは READING_SCHEMA + READER_SYSTEM + parseReading + readReaderResult + triage :1073 + admin READER_KEYS + test/reader.test.ts を同時に変える（旧 row は欠けるので「無ければ項目なし」で読む）
- childtext の新 kind は triage.ts:932 の分岐 + Cause + CAUSE_TEXT + ITEM_TITLE + admin の写し + 語彙を固定するテスト（triage.test.ts:18,:590 / mc-edition:303 / models3d-triage:106 / triage-step:59）
- 既存データ: schema_version の列は無い（material_json の中だけ）。全版 v1。本番の件数は不明。material_redo は汎用（ops.ts:61-109）で kind:'draft'・prev なし（v1 の prev は渡らない）。**v1 の版への人の差し戻し / auto_return の rework は v1 prev（uploads/prev/）+ v2 prompt**になる → 職人定義の「作り直し」節に「前の版が古い形なら中学生・詳しい版を元に body.md 1 本へ組み直し schema 2 で出す」が要る（司令塔）
- 検証係: parts/* を拡張子で全部送る（形に非依存）。本文が 1/4 になり入力 token が減る（額は未計測）
- §AK（la-q11、origin/main より 3 commit 先・41 ファイル）: admin.js の hunk は 842-929 / 3304-3318 / 3456-3473 / 5129（preview 関数は触らない）。schema.ts（import・validateOutputs opts・:710 checkModels3d）・jobs.ts（:263・:410-414・:1895）・library.ts:168-211・review.ts・sync-claude-assets.sh・migration 0017（次は 0018）
- 基準テスト（worktree, ced174f）: vitest 89 files / 2358 tests PASS rc=0

## 5. 結合リスクと故障の隔離
- 取り込みは唯一の書き手。validateOutputs の v2 バグは v1 の reingest / redo も壊す → v1 経路の回帰テストが必須
- 読み手は寛容: v2 row に variants が無ければ「何も読まずに clean」になる（reader.ts）→ v2 を知らない読み手はサイレントに空読みする（**偽緑**）。読み手・childtext・triage・library・preview は v2 を明示的に扱う必要がある
- 旧 reader_json / 旧 checks_json は新キー欠落で valid のまま（欠けていれば項目なし）
