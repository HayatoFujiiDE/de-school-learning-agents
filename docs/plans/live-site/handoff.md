# 学習者向けの実サイト `app/` — 引き継ぎ（2026-11-08）

branch `live-site`（origin に push 済み。base origin/main 6da3fbf）。worktree `.worktrees/live-site`。契約は `contract-LS.md`（LS-18 が最終裁定）、棚卸しは `inventory.md`、対応表は `mapping.md`、土台の使い方は `l0-notes.md`。

## 1. 何ができたか（1 行）
保存済みモック `app-v3/` の全ルート（話す / 予定 / 作る / 作品 / 作品展示 / 今日のお題 / 自己理解 / 学びマップ / あしあと / サポーター）を、同じ DOM・CSS のまま **本物のデータ**（Codex の会話・予定、工場の配信 API、基礎学習の記録、本人の保存）で動く `app/` にした。架空の人物・会話・固定の返事・見本の進み具合は出ない。

## 2. 起動方法（ローカル）
```sh
cd /Users/hayatofujii/Coding/DESystem/Learning-Agents/.worktrees/live-site
node tools/live-serve.mjs --port 4180 --fake-buddy          # 既定で Codex の worktree から /app-live と /basic-learning を読む
open http://127.0.0.1:4180/app/index.html#talk
```
- `--fake-buddy`: `/api/buddy` にテスト用の返事（実 Claude は呼ばない）。`POST /__fake/mode {"mode":"503"}` で失敗の状態を作れる
- `--factory-proxy`: 工場の配信 API を同一 origin で中継（CORS が付いた今は不要。検証用に残す）
- Codex の worktree が無い環境: `--integ /nonexistent` で起動すると、話す・予定は「つながっていない」の 1 文を出し、他のページは動く

## 3. 検査
```sh
sh tools/live-check.sh talk plan paused make works gallery today self map map/basics trail sup sup/me   # LIVE_CHECK=PASS
node tools/live-plan-test.js; node tools/live-talk-test.js; node tools/live-make-test.js
node tools/live-today-test.js; node tools/live-gallery-test.js; node tools/live-self-test.js
node tools/live-map-test.js; node tools/live-trail-test.js; node tools/live-sup-test.js
sh tools/live-render.sh <out> talk plan make works gallery today self map map/basics trail sup   # 1440 / 1024 / 390
```
`LIVE_URL` でサーバーの URL を変えられる。モックの `tools/check.sh` / `render.sh` は app-v3 用のまま。

## 4. 保存（ブラウザごと・同じ URL）
| 名前空間 | 持ち主 | app/ からの扱い |
| - | - | - |
| `des.buddy-live.v1` | Codex（app-live/state.mjs） | `DES.live`（動的 import）経由でだけ読み書き。項目を足さない |
| `des.basic-learning.v1` | Codex（basic-learning） | 読むだけ（学びマップの帯・自己理解の習熟・あしあとの続き） |
| `des.live.*` | app/ | 本人の保存（profile / goals / catalogMarks / talkLocal / planLocal / activities / works / makeSide / odai / gallery / self / mapUi / trail / sup） |
| `des3.*` | モック app-v3 | 触らない |
「このブラウザの保存を消す」（表示設定の中）は `des.live.*` だけを消す（会話・予定・基礎学習は残る）。

## 5. Codex 側との統合（最小差分。こちらからは Codex のファイルを変更していない）
統合は Codex の branch `codex/basic-learning-integration` に `live-site` を merge した上で、次の 3 か所を Codex 側（または司令塔）が直す:

1. `tools/build-learning-site.mjs` — `appFiles()` に `app/` を足す（`git ls-files -z -- app-v3/` の隣に `-- app/` を足し、`APP_EXTENSIONS` に `.mjs` を足す）。`docs/mock-app-v3-snapshot.json` の照合はそのまま（app-v3 は変えていない）
   ```diff
   -  const result = execFileSync('git',['-C',root,'ls-files','-z','--','app-v3/'], ...);
   +  const result = execFileSync('git',['-C',root,'ls-files','-z','--','app-v3/','app/'], ...);
   -    if (!name.startsWith('app-v3/') || !APP_EXTENSIONS.has(path.extname(name))) fail('Unexpected tracked app file');
   +    if (!(name.startsWith('app-v3/') || name.startsWith('app/')) || !APP_EXTENSIONS.has(path.extname(name))) fail('Unexpected tracked app file');
   -const APP_EXTENSIONS = new Set(['.html','.js','.css',...]);
   +const APP_EXTENSIONS = new Set(['.html','.js','.mjs','.css',...]);
   ```
2. 同 `GENERATED['index.html']` と `404.html` の飛び先を `app/index.html#talk` に（`app-live/index.html#talk` は残す。両方の画面が同じ保存を見る）
3. `app-live/index.html` の header nav に 1 リンク（任意）: `<a href="../app/index.html#talk">学びの画面</a>`
`deploy/learning-review/worker.mjs` は変更不要（静的資産と `/api/buddy` の認証はそのまま効く）。`app/` から Codex 側へのリンク: 学びマップ → `../basic-learning/index.html#list/<course>` / `#unit/<ref>`、予定の「ほかの日を見る」→ `../app-live/index.html#plan?date=`。

## 6. 工場との接続
- `GET /api/library/topics?day=` / `/stock` → 今日のお題（2026-11-08 は 4 件）。`GET /api/library/available` → 作るの「工場から届いた素材」（今は 0 件。schema 2 の最初の版が承認されたら乗る）
- 配信 API に CORS（`access-control-allow-origin: *`）が付いた（Worker Version 8b428a60）。ブラウザから直接読む

## 7. 未接続・未確認（正直に）
- 本物の Claude の返事は司令塔の環境では確認していない（key は本人だけが登録。fake-buddy で画面の流れだけ確認）。Codex の審査用サイトに乗せた後、本人が確認する
- 作品の「見せる」と作品展示は端末内（教室に届ける仕組みは無い）。サポーター画面は同じ端末で使う前提（アカウント無し）。レポートの「送る」も端末に残すだけ
- 写真は localStorage の dataURL（全体 60 枚）。活動から写真を外す UI は無い
- 学びマップの「つながり」の学んだこと・これから作れそう（AI の推定）は出ない。本物の帯は touched の 2 値
- 共有 branch への push・審査サイトへの deploy・認証の変更は行っていない（ふじさんの確認待ち）
