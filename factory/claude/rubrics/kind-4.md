# 採点表（型 4: 動かせるもの）

- `parts/<part_id>/app.html` が 1 ファイルで完結し、`<script src`, `<link `, `fetch(`, `import ` を含まない
- 操作 1 つ（スライダー・ボタン・クリックのどれか）で見た目が変わる
- 画面の中に、何を操作すると何が変わるかの 1 文がある
- 幅 390px でも横にはみ出さない（CSS の max-width と相対単位で組む）
- material.json の runtime_check に「どう操作して」「何が起きれば正しいか」が書かれ、selfcheck.md に自分で確かめた結果がある
- 子ども向けの文言は小学生表示を既定にし、本文の変奏（elementary/secondary）と矛盾しない
