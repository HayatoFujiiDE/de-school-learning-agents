# L0 土台の引き継ぎメモ（contract-LS §LS-1〜LS-7）

## 起動

```sh
cd /Users/hayatofujii/Coding/DESystem/Learning-Agents/.worktrees/live-site
node tools/live-serve.mjs --port 4180 --fake-buddy      # 開く: http://127.0.0.1:4180/app/index.html#talk
sh tools/live-check.sh talk plan make works gallery today self map trail paused sup   # 最後に LIVE_CHECK=PASS|FAIL
sh tools/live-render.sh /tmp/live-render talk make      # 1440 / 1024 / 390 の png
```

- `/app-live/*` `/basic-learning/*` は既定で隣の Codex の作業場（`.worktrees/basic-learning-integration`）から読むだけで配信する。`--integ /nonexistent` で「つながっていない」状態（`DES.live.available === false`）を見られる
- `--fake-buddy` の失敗状態: `curl -s -X POST http://127.0.0.1:4180/__fake/mode -H 'Content-Type: application/json' -d '{"mode":"503"}'`（`ok` / `503` / `429` / `timeout` / `invalid` / `notconfigured`。`ok` に戻すまで続く）。テスト用の返事は「（テスト用の返事）」で始まる
- `--fake-buddy` なしでは `/api/*` は 404（status は「バディと通信できませんでした。…」になる）

## DES.store（`des.live.<key>`）

```js
// 自分のページの js のトップレベル（load より前）で鍵を足す。validate は boolean、defaults は毎回新しい値を返す
DES.store.register('works', function (v) {
  return Array.isArray(v) && v.every(function (w) { return w && typeof w.id === 'string'; });
}, function () { return []; });

// 変更はモックと同じ 1 経路: DES.app.change(fn) → DES.store.save() → 再描画
DES.app.change(function () { DES.state.works = DES.state.works.concat([work]); });
// 1 つの鍵だけ書く時（false = 保存できなかった。saveFailed が立つので DES.app.renderSaveState()）
if (!DES.store.save('works')) DES.app.renderSaveState();
```

- 形が違う値はその鍵だけ既定へ戻る。register をやり直すと後勝ち
- `save(only)` は登録していない鍵でも `des.live.<only>` に書く（モックの load / save の包み方が今のまま動く）。包み方をやめて register に移すのは各レーン
- `DES.state.plan` / `talk` / `catalogMarks` は、登録されるまではメモリだけの空の値（モックの plan.js / talk.js が落ちないため）。保存しない。L1 が DES.live と register に置き換える
- node から: `require('./app/js/store.js')` → `{ PREFIX, register, keys(), validate(key, v), normalizeUi }`

## DES.live（Codex の会話・予定）

```js
await DES.live.ready;                         // 常に resolve（init はこの後）
if (!DES.live.available) { /* reason === 'module': 「つながっていない」状態 */ }
var st = DES.live.read();                     // { version, revision, events, messages, pending }。失敗は DES.live.issue
var r = await DES.live.commit(function (next) { return DES.live.ops.addEvent(next, ev); });
if (!r.ok) DES.app.toast(r.message);          // r.code は StateError の code（他は 'storage'）。throw しない
var off = DES.live.subscribe(function (e) { /* e.source: 'commit' | 'storage'（別タブ） */ DES.app.render(); });
var s = await DES.live.api.status();          // { configured, available, remaining }（取れない時は + error の文）
var res = await DES.live.api.send(payload, requestId);   // payload は ops.beginSend の戻り値。{ok:true, response} | {ok:false, message}
```

- 保存は必ず `commit` 経由（Web Locks）。messages / events / proposals に項目を足さない
- Web Locks の無いブラウザは起動時に `issue = 'locks'`（Codex の「見るだけ」と同じ判定）
- 文言: `DES.live.text.serviceError(status)` / `DES.live.text.apiErrors`（Codex app.js の verbatim）。状態行の文（「バディと話せます · 試用の残り {n} 回」など）は L1 が LS-11 のとおり持つ

## 別タブ・別画面の変更（シェルが受ける）

- `des.live.*`（または `event.key === null`）の storage イベント → `DES.store.load()` を呼び直して `DES.app.render()`。一時 dialog は閉じない（closeTransient は呼ばない）
  - `#composer` が画面にある時は、draft の text を textarea の今の値にする（別タブの draft で入力中の文を上書きしない）
  - それまでに保存できなかった印（`saveFailed`）は消さない
- `DES.live.subscribe` → `DES.app.render()`（Codex の会話・予定が commit や別タブで変わった時。「続きをする」もこれで変わる）
- 各ページは自分の DOM の一時状態（開いているメニュー・入力中の欄）を render で失わないこと。読み直した `DES.state` で描くだけでよい

## 工場の配信 API

- `DES.factory = { base: 'https://de-school-factory.h-fujii.workers.dev', timeoutMs: 8000 }`（classroom.js。LS-10）
- 使い方: `fetch(DES.factory.base + path, { signal })` を `DES.factory.timeoutMs` で abort する

## L0 で変えたモックとの差

- index.html: `js/data.js` → `js/classroom.js`、`js/photo.js`（司令塔の部品）を buddy.js の直後に、title「バディエージェント · DE-SCHOOL」、robots noindex / referrer no-referrer、`css/live.css`、末尾に module の `js/live-bridge.mjs`
- 起動: `init()` の即時呼び出しをやめ、`DOMContentLoaded` → `DES.live.ready` → `init`
- `.preview-bar`: 「試用版 · このブラウザに保存」+ 役タブは 子ども / サポーター の 2 つ（素材運用・設計を見る を出さない）。サポーターに区切り線が付かないよう live.css で戻した
- `.profile`: 名前は保存の profile、無ければ「あなた」。avatar は名前の 1 文字目、無ければ self アイコン
- `.resume-mini`: 作るの活動 → 会話の最後の本人発言（40 字）+ 見出し「バディとの会話」→ 「まだ何もないよ」/「話すから始めよう」
- 「はじめの状態に戻す」を出さない（子ども・サポーターの両サイドバー）。表示設定ダイアログの下に「このブラウザの保存」+「消す」→「本当に消す？」+ 消す / やめる → `DES.store.clearLive()`（`des.live.*` だけ消して `#talk` で再読み込み）
- `<main>` に `data-route`
- 別タブの `des.live.*` の変更と、Codex 側の変更（`DES.live.subscribe`）で描き直す（モックには無い）
- `DES.data`: today / now / weekday は JST の今（getter）、child は `{id:'me', name}`、group / supporter / resume は null、talk / plan は空、goals は 3 枠とも text:null、circle.today は 'tbd'
- i18n: `DES.i18n.add`、`sample_note` / `demo_media` / `voice` の文を契約の文に、シェルの live 文言（`live_bar` `you` `resume_talk` `resume_empty_*` `clear_*`）
- 保存先: `des3.*` → `des.live.*`
