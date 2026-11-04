Review this implementation plan for: コンテンツファクトリーに画像生成（職人が custom tool で生成・確認・描き直し）を追加する。
計画: docs/plans/image-generation/plan-v4.md（前提と system map は同じフォルダの context.md / system-map.md）。repo /Users/hayatofujii/Coding/DESystem/Learning-Agents の factory/worker と CONTRACT-factory.md を読んで根拠にしてよい（読み取りのみ）。
目的は出荷前の自己点検: 計画の弱いところを着手前に塞ぐ。
Focus: correctness, coupling risk, fault isolation, rollback safety. 特に (a) 費用の上限が並列・重複配信・再起動・プロセス停止をまたいで本当に超えないか（反例の入力と順序を具体的に） (b) 失敗の行列に抜けている状態 × 失敗点 (c) 子どもに人の確認なしで画像が届く経路 (d) OPENAI_API_KEY がログ・D1・作業場・エラー文に出る経路 (e) 既存の取り込み・承認・配信への回帰
Return: 1. BLOCKING issues 2. NON-BLOCKING recommendations 3. Coverage gaps (test / lint / observability) 4. Verdict: GO or REVISE
Ground every finding in the plan content or codebase evidence. Label inferences explicitly. 反例を挙げられない観点は「反証失敗」と書く。
