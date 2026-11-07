# 素材の形 v2 — ALIGN（文脈ブロック。2026-11-07 Fable 司令塔）

Task: 工場（Worker + Managed Agents 職人）が出す素材の形を v1（4 変奏 + ゲーム版必須 + 本文内の関心別入口 + summary 2 本）から v2（本文 1 本 + バディ向けの構造化データ）へ変え、読み手係と取り込み検査に「中身の質」の基準を載せる。素材はバディが子どもごとに組み替える前提（設計書 §7）に揃える。

Goal（測れる形）:
- 新しい職人定義で作った注文が、取り込み（schema 2）→ 読み手係（基準 5 つ）→ 検証 → 仕分け → 確認画面 → 配信 API を fake と実 session の両方で通る
- 1 注文の本文ファイルが 1 本になり、session 費用が v1（$6〜8）より下がる（実測で記録）
- 既存の schema 1 の版は、確認画面・配信 API・再取り込み・作り直しで今までどおり読める（回帰テスト緑）
- 質の基準の機械検査（長さ・目標語・最初の段落の形）が、わざと崩した fixture で赤になり、正しい fixture で緑になる（修正前 FAIL / 修正後 PASS）

Constraints（変えないもの）:
- 工場に子どものデータを入れない（§7・§B-7）。配信 API に子どもを表す列を作らない
- `publishSwitch` が唯一の公開切替。状態機械（§C-2）・lease・条件付き batch の作法は維持
- factory/claude/*（職人定義・rubric・編集基準）は司令塔が書く。実装担当は変えない
- CONTRACT-factory.md は節の追記で改訂（既存節は「§X に優先する」の形で上書き宣言）
- 並走レーン §AK（la-q11: 権利の門番）が CONTRACT と admin.js を触っていて未着地 → admin.js は §AK 着地後に入る
- 外部費用: Astra レビューは medium・2 往復まで（memory）。Opus 実装。実 session の確認は 1 本

Modules（読む/書く）:
- 契約: CONTRACT-factory.md §E/§D-3/§F-2/§V（docs/plans/review-auto/contract-V.md V-4/V-5/V-6/V-9/V-10）/§MC/§Q/§O-13/§AJ の本文の形に触れる箇所
- 職人側: factory/claude/agents/material-maker.md, rubrics/common.md, rubrics/kind-3.md, kind-4.md, editorial-standards.md, claude-lock.json（ant apply）
- Worker: src/checks/schema.ts（validator）, childtext.ts, layout.ts, forbidden.ts, triage.ts, src/jobs.ts（取り込み・brief）, src/reader.ts（読み手係 prompt/schema）, src/verify.ts（本文の渡し方）, src/routes/library.ts（配信）, src/triage-step.ts, src/publish.ts
- 画面: public/admin/admin.js（.mat-preview・切替）, admin.css
- テスト: test/**, test/fixtures/**, src/fake/fixtures.generated.ts（生成元）, scripts/smoke.mjs

Invariants（壊さない）:
- schema 1 の版の読み取り（reingest / review / library / rework の prev）
- 取り込みを止める条件は §F-2 の列挙（必須キー・型・参照先・パス位置と拡張子・basename 衝突・JSON 不正・サイズ）だけ。質の検査は赤印 → 仕分け → 自動作り直し（2 回まで）で、取り込みは止めない
- 読み手係は 1 版 1 回・取り置き $0.80・締め切り付き（V-4 a）。新しい基準で呼び出し回数・費用の上限を変えない
- 禁止語 13 語の検査・「確認済み」なし・claim 参照 `[cN]` の整合（§F-2）
- §MC の版の 1 文（版が決まっている題材）は本文 1 本に対して引き続き検査する
- 配信 API の `public_paths_json` の規則（§E-4: parts/<id>/ 配下・拡張子）

Open Qs（推測しない）:
- Managed Agents の rubric 採点（user.define_outcome, max_iterations 3）は職人と独立した grader か（公式 docs で確認）
- 読み手係の `learning` 判定と 5 基準の関係（置き換えか追加か）。strict な tool schema のため判定キーの追加 = schema + prompt + 仕分けの同時変更
- 既存の schema 1 の版の件数（本番 D1）。依頼箱の material_redo が Minecraft 専用か汎用か
- Worker の deploy と ant apply の順序: 両方を受け付ける取り込み（1 と 2）にすれば順序自由か
- admin.js の preview 領域と §AK の hunk が重なるか
- `summary` 1 本化で確認画面・配信 API・工場ビューのどこが summary_* を読むか

Prior state:
- origin/main ced174f（2026-11-07）。手元の main checkout は 135 コミット遅れ（触らない）
- §V（読み手係・自動作り直し 2 回・自動公開スイッチ）は 11-07 着地・deploy 済み
- 型 4（app.html）には既に「操作は意味のある所にだけ・予想 → 試す → 確かめる」の決まりがある（本文には無い）
- 職人定義は 205 行（v15）。版の 1 文・絵の主張・立体モデル・作り直しの決まりを含む
- ふじさん決定（memory project-material-v2）: 本文 1 本（中学生向け）/ 芯 / 問いの種 / 入口の構造化 / 遊びは任意 / 基準 5 つは読み手係 / schema 2 / 既存は依頼箱で順に作り直し
