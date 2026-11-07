# 実装契約 LS — 学習者向けの実サイト `app/`（モック app-v3 の見た目を写した本実装）

凍結日: 2026-11-08（司令塔 = Claude Fable 5.1 セッション「モック完全再現」）。branch `live-site`（base origin/main 6da3fbf）。
「」内の文言は verbatim（言い換え禁止）。本書と CONTRACT-v3.md（モックの契約）が食い違う時は、**見た目・部品・操作の形は CONTRACT-v3 が正本、データの出所・保存・接続は本書が正本**。

## LS-0 目的と方針

- 保存済みモック `app-v3/`（commit 5d32571 以降の origin/main 版。Desktop の `agent-deliverables/2026-11-06-all-pages/app-v3` は 11-06 10:15 の古い写しで、8 ファイルの差は全部その後の直し）の **全ルート・全画面・主要な操作を、同じレイアウト・配色・余白・文字・アイコン・バディ・情報の順序・遷移・ダイアログ・操作後の反応で**本実装する。独自のリデザインはしない
- **架空のデータ（はると・田中さん・11/2 の会話・見本の進み具合・固定の返事）を「本当に保存・生成されたもの」として見せない**。実データが無い時は、同じデザインの自然な初期状態（空状態・「これから」）を出す。見本として出すものは「見本」と明示する
- Codex の実装済み・実装中の範囲（会話の実 API と保存 `des.buddy-live.v1`・予定の候補の確認と反映・審査用の認証・利用回数・基礎学習 548 教材・教材内のバディ）は**作り直さず、そのまま使う**（接続するだけ。契約は LS-3）
- `app-v3/` は変更しない（Codex の配布ビルドが hash で固定している）。モック原本も上書きしない
- 新しいアカウント体系・権限モデル・外部公開・課金方式は足さない。保存はブラウザごと（Codex と同じ前提）

## LS-1 ファイル構成と所有

```
app/                         実サイト（app-v3 を写して作る。file:// 前提は外し http で配信。fetch 可・module 可）
app/index.html               app-v3/index.html と同じ DOM。js/data.js → js/classroom.js、末尾に <script type="module" src="js/live-bridge.mjs">
app/css/*.css                app-v3/css と同一（値を変えない）。live 固有の追加は app/css/live.css 1 本に書く（レーンごとに節を分け、同じセレクタを二重定義しない）
app/js/classroom.js          教室の設定（LS-5）と DES.data の互換ファサード
app/js/store.js              DES.store（localStorage `des.live.*`。register で各ページが鍵を足す。LS-2）
app/js/live-bridge.mjs       DES.live（Codex の app-live/state.mjs を import して会話・予定の保存と /api/buddy を包む。LS-3）
app/js/i18n.js               DES.t + DES.i18n.add（LS-4）。シェルの live 文言はここ、各ページの live 文言は各ページの js で add
app/js/app.js                シェル（LS-4）
app/js/<page>.js / <page>-data.js  各ページ（レーン所有。LS-10 以降）
tools/live-serve.mjs         開発・検証サーバー（LS-6）
tools/live-check.sh / live-render.sh / live-*-test.js   検査（LS-7）
docs/plans/live-site/        本書・対応表・引き継ぎ
```

所有（同じファイルを 2 レーンで触らない）:
| レーン | 所有ファイル |
| - | - |
| L0 土台 | index.html, classroom.js, store.js, live-bridge.mjs, i18n.js（シェル節）, app.js, css/live.css（土台節）, tools/live-serve.mjs, tools/live-check.sh, tools/live-render.sh |
| L1 話す・予定 | talk.js, talk.css, plan.js, plan.css, buddy.js（不変）, css/live.css（L1 節） |
| L2 作る・作品 | make.js, make-data.js, make.css, works.js, works.css, thumbs.js |
| L3 お題・展示 | today.js, today-data.js, topics-live.js（削除）, today.css, gallery.js, gallery-data.js, gallery.css |
| L4 マップ・あしあと | map.js, map-data.js, map-layout.js, map-canvas.js, map.css, basic-learning.js（新・Codex の写し）, trail.js, trail.css |
| L5 自己理解 | self.js, self-data.js, self.css, img/self/* |
| L6 サポーター | sup.js, sup-core.js, sup-view.js, sup-data.js, sup.css |

各ページの js は **自分のファイルの中で** `DES.store.register(...)` と `DES.i18n.add({...})` を呼ぶ。app.js / store.js / i18n.js への変更が要る時は、変更せずに最終報告へ「土台への要望」として書く（司令塔が L0 へ反映する）。

## LS-2 保存（3 つの名前空間。混ぜない）

| 名前空間 | 持ち主 | 中身 | app/ からの扱い |
| - | - | - | - |
| `des.buddy-live.v1` | Codex（app-live/state.mjs） | 会話 messages・予定 events・送信中 pending | **state.mjs の関数経由でだけ読み書き**（LS-3）。鍵の形を変える・項目を足すことは禁止（state.mjs の検査が厳密一致で、違えば corrupt 扱いになる） |
| `des.basic-learning.v1` | Codex（basic-learning/js/core.js） | 教材の記録 `{version, grade, mode, interest, course, progress:{<code>:{answers:{<qid>:{value,correct}}, buddy:{}}}, resume}` | **読み取りだけ**（JSON.parse を try/catch。形が違えば「記録なし」扱い）。書かない・消さない |
| `des.live.<key>` | 本サイト（app/js/store.js） | 下表 | 読み書き |
| `des3.*` | モック | 触らない（別アプリ）| 読まない・消さない |

`des.live.*` の鍵（L0 が定義する基本 + 各レーンが register で足す）:
| key | 形 | 既定 | 持ち主 |
| - | - | - | - |
| mode | 'js' \| 'es' | 'js' | L0 |
| ui | { nav:'open'\|'rail' } | {nav:'open'} | L0 |
| panel / panelTab | 'open'\|'closed' / 'plan'\|'history' | 'open' / 'plan' | L0 |
| hidden | object | {} | L0 |
| draft | { text:string, scroll:number } | {text:'',scroll:0} | L0 |
| profile | { name: string\|null, avatar: {hair,color}\|{none:true}\|null } | {name:null, avatar:null} | L0（編集は L5） |
| goals | [3]（モック data.js の goals と同じ形。text は null 始まり） | 3 枠とも text:null | L0（描画は L1） |
| catalogMarks | { [activityId]: { tomorrow:boolean } }（today はもう保存しない。終わった予定から導く） | {} | L1 |
| records | [{ id, at: ISO, date:'YYYY-MM-DD', time:'HH:mm', text, by?:string }]（表の操作の記録行。会話の時系列に混ぜて出す。最大 400 件・古いものから落とす） | [] | L1 |
| planLocal | { optional: { [date]: 'undecided'\|'join'\|'skip'\|'later' }, held: [proposalId], hidden: [eventId], meta: { [eventId]: { activity?:string, trial?:boolean, edited?:boolean } } } | 空 | L1 |
| activities / works / makeSide | モックと同じ形（見本は seed しない） | [] / [] / sideDefaults | L2 |
| odai | モックと同じ形 | {} | L3 |
| gallery | { shares: [...] }（この端末から「見せる」準備をした作品） | {shares:[]} | L3 |
| mapUi | モックと同じ形 | 既定 | L4 |
| trail | モックと同じ形 | 既定 | L4 |
| self | { entries: [...], avatar, agreed, history, ... }（contract-V の保存項目） | 空 | L5 |
| sup | モックと同じ形 + checks / log / report（この端末の学習者 1 人分） | 空 | L6 |

`DES.store` の API（L0）:
```js
DES.store.register(key, validate /* v => boolean */, defaults /* () => value */)  // 読み込み前に呼ぶ（各 js のトップレベル）
DES.store.load()   // 登録済みの全 key を localStorage から読み、不正な形は既定へ。DES.state を作る。失敗は state.saveFailed = true
DES.store.save(only) // only があればその key だけ。失敗で false・state.saveFailed = true
DES.store.clearLive() // des.live.* だけ消す（des.buddy-live.v1 / des.basic-learning.v1 / des3.* は消さない）→ #talk へ → reload
```
全部 try/catch。「保存できていないのに保存した」と見せない: save が false の時は topbar の `.save-indicator` を `save_fail` にする（モックと同じ）。

## LS-3 DES.live（Codex の会話・予定への橋。app/js/live-bridge.mjs）

`import('../../app-live/state.mjs')` を**動的 import**し、成功したら `DES.live.available = true`。失敗（ファイルが無い = Codex の branch と統合する前の単独ビルド）しても例外にせず `available=false, reason='module'` で進む（話す・予定は LS-11 の「つながっていない」状態を出す）。**state.mjs を写して持たない（fork 禁止）**。

```js
DES.live = {
  ready: Promise<void>,          // import の成否が決まったら resolve（常に resolve。reject しない）
  available: boolean, reason: null | 'module',
  ops: <state.mjs の export 全部>,  // KEY, LIMITS, StateError, notices, emptyState, createStore, validDate, validTime, todayJST, validEvent, sameEvent, validState, parseState, addEvent, updateEvent, removeEvent, decideProposal, beginSend, finishSend, failSend, validResponse
  state: { version, revision, events, messages, pending },  // 直近の read。available=false なら emptyState() と同じ形
  issue: null | 'corrupt' | 'storage' | 'locks',          // 直近の read / commit の保存の問題
  read(): state,                  // store.read() を try し、失敗は issue に入れて前の state を返す
  commit(change): Promise<{ok:true, state, value} | {ok:false, code, message}>,  // store.commit を包む。例外は code（StateError.code。他は 'storage'）と message（ops.notices[code] か固定文）に変えて返す。throw しない
  subscribe(fn): () => void,      // 変更通知（commit 後・他タブの storage イベント）。戻り値で解除
  todayJST(): 'YYYY-MM-DD', nowJST(): 'HH:mm',
  api: {
    status(): Promise<{configured, available, remaining} | {configured:false, available:false, remaining:null, error:string}>,   // GET /api/buddy/status。Codex app.js checkService と同じ: 10 秒 abort・credentials same-origin・cache no-store・redirect error・形の検査（available なら configured かつ remaining>0）
    send(payload, requestId): Promise<{ok:true, response} | {ok:false, message}>   // POST /api/buddy。Codex app.js sendChat と同じ: 50 秒 abort・Content-Type application/json・本文 32768 以下・validResponse(value, requestId)・update/remove の proposal は payload.schedule の該当 event と sameEvent・失敗文は Codex の serviceError(status) / apiErrors[body.error] を verbatim
  },
  text: { serviceError(status), apiErrors }   // Codex app-live/app.js の文言を verbatim で持つ（読み取り元: .worktrees/basic-learning-integration/app-live/app.js）
};
```
- `credentials:'same-origin'` の Basic 認証は審査用 Worker が持つ。app/ は認証を実装しない
- state.mjs の不変条件を守る: 保存は必ず `commit(change)` 経由（Web Locks `des.buddy-live.v1:write`）。messages / events / proposals に**項目を足さない**（記録行・活動 id などは `des.live.*` 側に持つ）
- 「返事は届いたが保存できない」（unsavedResponse）・「60 秒たった pending の受信終了」（end-pending）・「失敗した発言を入力欄に戻す」（restore-message）の 3 つの回復は Codex app.js と同じ条件・同じ文で L1 が実装する

## LS-4 シェル（app.js / i18n.js / index.html）

- モックの DOM・クラス・遷移・ダイアログ・breakpoint（xl / l / m / s）・下タブ・左 drawer・パネル開閉・表示モード・トースト・focus 戻しは**そのまま**
- `.preview-bar`: 左の文を「試用版 · このブラウザに保存」（key `live_bar`。es 同文）に。役タブは「子ども」「サポーター」の 2 つだけ（工場・デザインの disabled ボタンは出さない）
- `.profile`: 名前は `DES.state.profile.name`、無ければ「あなた」（key `you`）。avatar の文字は名前の 1 文字目、無ければ `DES.icon('self')`。副文は表示モード（モックと同じ）。名前・アバターの編集は自己理解（L5）
- `.resume-mini`（続きをする）: `DES.make.resumeInfo()` があればそれ。無ければ Codex の会話の最後の本人発言（`DES.live.state.messages` の最後の role user の content を 40 字で切る）を `.resume-next` に、見出しは「バディとの会話」。会話も無ければ見出し「まだ何もないよ」・副文「話すから始めよう」（key `resume_empty_h` / `resume_empty_p`）
- 「はじめの状態に戻す」リンクは**出さない**。代わりに表示設定ダイアログ（`.mode-dialog`）の下に区切り線 + 小見出し「このブラウザの保存」+ 文「作ったもの・書いたこと・予定の表の印を、このブラウザから消す。会話と予定、基礎学習の記録は消えない」+ ボタン「消す」（`.btn.ghost.small`）→ 押すと同じダイアログ内が確認表示に変わり「本当に消す？」+「消す」「やめる」→ 消す = `DES.store.clearLive()`。keys: `clear_h` `clear_p` `clear_btn` `clear_confirm` `clear_yes`（「消す」）
- `DES.data` 依存の日付・時刻: `DES.data.today` / `now` / `weekday` は classroom.js の getter（JST の今日・今の時刻 HH:mm・曜日 1 字）。`DES.data.group` は null（曜日グループは設定が無い。パネルの日付の「· 月水金A」は出さない）
- `<main>` に `data-route="<route>"` を付ける（検査の目印）
- 起動: 全 classic script → module の live-bridge → `DOMContentLoaded` で `DES.live.ready.then(init)`。init 前に描画しない
- i18n: `DES.i18n.add(table)`（`{key: [js, es]}` を T に merge。同じ key は後勝ち。console.warn しない）。モック由来のモック専用文言の差し替え（L0 が i18n.js で行う）:
  - `preview` → 使わない（`live_bar` を使う）
  - `sample_note`「応答はサンプル」→ 「会話と予定は AI に送られる」（es「会話と予定は AI におくられる」）
  - `demo_media`「このモックでは体験例だけ…」→ 「写真と音声は、これから使えるようになるよ」（es「写真と音声は、これからつかえるようになるよ」）
  - `photo` / `voice` の「体験例」の語を外す: `photo`「写真」/ `voice`「音声」（es 同）。ボタンは出すが押すとトースト `demo_media`
  - `shared_toast`「見せたよ（モックなので実際には届かないよ）」→ L3 が置き換える（LS-13）
  - `td_video`「…（モックでは再生しない）」/ `td_play_label`「このモックでの動き」→ L3 が置き換える
  - `share_note` は「この会話はサポーターも見られるよ。おうちの人には、学んだことをまとめて伝えるね」（es「…まなんだことをまとめてつたえるね」。固定の人名を出さない）
  - `plan_date` は「{m}/{d}（{w}）」（曜日グループは出さない）
- reduced motion / 文字サイズ / focus-visible / 44・48px はモックのまま

## LS-5 教室の設定（classroom.js）

モック data.js のうち**架空でないもの**を残す: `classroom`（open 10:00 / close 15:30 / lunch 12:30〜13:30 / circle { today:'tbd', minutes:20, note:'A/B は週で変わる' } / exercise 11:30〜12:30）と `catalog`（共有された表の再構築 = 教室の取り組みの一覧 7 カテゴリ 27 件。verbatim）。`circle.today` は **'tbd'**（週の A/B を知る設定が無いので「確認中」の表示 = CONTRACT-v3 §R-12 の規定どおり）。`child` / `supporter` / `talk` / `plan` / `resume` / `goals` の架空の値は持たない（`DES.data.child = { id:'me', name: <profile から> }`、`DES.data.supporter = null`、`DES.data.talk = []`、`DES.data.plan = []`、`DES.data.goals = [3 枠 text:null]`）。
`DES.clock = { today(), now(), weekday(), iso() }`（JST）。

## LS-6 開発・検証サーバー（tools/live-serve.mjs）

`node tools/live-serve.mjs [--port 4180] [--integ <dir>] [--fake-buddy]`
- `/app/*` → `<worktree>/app`、`/tools/*` → `<worktree>/tools`（frame-measure.html / frame390.html を同一 origin で使う）、`/` → `302 /app/index.html#talk`
- `--integ <dir>`: `/app-live/*` と `/basic-learning/*` をその dir から配信（既定は Codex の worktree `/Users/hayatofujii/Coding/DESystem/Learning-Agents/.worktrees/basic-learning-integration`。**読み取りだけ**。無ければ 404）
- `--fake-buddy`: `/api/buddy/status` → `{configured:true, available:true, remaining:100}`、`POST /api/buddy` → Codex の plan-buddy-live.md の契約どおりの形で**テスト用の返事**（reply は「（テスト用の返事）」で始める。本文に「入れ」「やりたい」「予定」があれば schedule と重ならない最初の 30 分の add 候補を 1 つ。「変え」があり schedule が空でなければ最初の予定の update 候補、「外し」なら remove 候補）。`POST /__fake/mode` `{mode:'ok'|'503'|'429'|'timeout'|'invalid'|'notconfigured'}` で次の応答を切り替える（画面の失敗状態の検査用）。実 Claude は呼ばない。本物の key を読まない
- 応答ヘッダ: nosniff / no-referrer / noindex / no-cache。MIME は tools/serve-learning-site.mjs と同じ表。`.mjs` は text/javascript

## LS-7 検査

- `sh tools/live-check.sh <route...>`: `LIVE_URL`（既定 http://127.0.0.1:4180）の `/app/index.html#<route>` を 1440 / 1024 / 390 で headless Chrome `--dump-dom`。禁止語（点数|ランキング|順位|評価|成績|レベル|データがありません|学びのバディ|モック|架空。モックの check.sh の表 + 学びのバディ・モック・架空。§I の 集中力・得意・苦手・上手・成長 は書き方の規則として守るが機械検査には入れない — 自己理解の「苦手なこと・困ることを書く」はオーナー指示の例外）0 件・JS エラー 0・横はみ出し無し（`/tools/frame-measure.html#<W>|<URL>`）・`main[data-route="<base>"]` がある・DOM 5KB 以上。最後に `LIVE_CHECK=PASS|FAIL`
- `sh tools/live-render.sh <out> <route...>`: 1440 / 1024 / 390 の png
- 各レーンの純関数テスト `node tools/live-<page>-test.js` → `LIVE_<PAGE>_TEST=PASS|FAIL`
- 実ブラウザの操作確認は司令塔（Chrome）。空・入力中・送信中・成功・失敗・保存後・再読込・別タブ・保存失敗（`--fake-buddy` の mode と localStorage の満杯）

## LS-8 Codex 側との接続（最小差分。こちらからは Codex のファイルを変更しない）

統合時に Codex（または司令塔）が行う差分（全部で 4 か所）:
1. `tools/build-learning-site.mjs`: `appFiles()` に `git ls-files -- app/` の結果を足す（拡張子の許可表に `.mjs` を足す）。`docs/mock-app-v3-snapshot.json` の照合はそのまま
2. 同 `GENERATED['index.html']` の飛び先を `app/index.html#talk` に（app-live は `/app-live/index.html#talk` のまま残す）
3. `app-live/index.html` の header nav に「画面」リンク 1 つ: `<a href="../app/index.html#talk">学びの画面</a>`（任意。無くても app/ から app-live へは行ける）
4. `deploy/learning-review/worker.mjs`: 変更なし（静的資産と /api/buddy の認証はそのまま効く）
app/ から Codex 側へのリンク: 学びマップ → `../basic-learning/index.html#list/<course>`（Codex の basic-learning.js を写して使う）/ 話すの「予定を日付で見る」→ `../app-live/index.html#plan?date=<date>`（L1）。

## LS-10 各ページに共通の規則

- **見た目・部品・操作・遷移・ダイアログ・文言はモック（app-v3 + CONTRACT-v3 + 各 contract）のまま**。変えるのはデータの出所・保存・接続と、架空のものを「自然な初期状態」へ置き換える所だけ。変えた所は最終報告の「モックとの差」に 1 行ずつ残す
- 架空の固定物（はると / 田中さん / 11/2 の会話 / 見本の進み具合 / 固定の返事 / 架空の日付）を**本人の記録として出さない**。日付・時刻は `DES.clock`（JST の今日・今）。モックの `DES.data.today` / `now` / `weekday` は classroom.js の getter になっているのでそのまま使ってよい（値が本物になる）
- 見本を出してよい所は**「見本」のラベル付き**で（key `sample_label`）。見本からコピーして本人の活動・作品を作る時、作られたものは本物（本人の記録）
- 空状態はモックの流儀（左揃え・アイコンなし・バディ口調 1 文）。「データがありません」禁止。評価語禁止（点数・ランキング・順位・評価・成績・レベル・集中力・得意・苦手・上手・成長）。「モック」「架空」「サンプル」という語を画面に出さない
- 保存は `DES.app.change(fn)` → `DES.store.save` → 再描画の 1 経路（モックと同じ）。Codex の保存は `DES.live.commit`。両方にまたがる操作は **Codex 側を先に**（失敗したら live 側を書かない）
- 工場の配信 API を読む時: `fetch(FACTORY + path)`（`DES.factory.base` = `https://de-school-factory.h-fujii.workers.dev`。`app/js/classroom.js` に定数）。8 秒で abort。失敗・0 件は空状態（「今は取ってこられない」はトースト・行の 1 文で、空状態と区別する）。応答は「知らない項目は無視・無い項目は null」で読む。本文 markdown の `[cN]`（主張の印）は子どもに見せる前に取り除く。`spark` は見せない。schema 1 / 2 どちらでも落ちない
- 他タブ・別画面での変更: `DES.live.subscribe` と `storage` イベント（`des.live.*`）で再描画。古い状態で上書きしない
- 禁止事項・verify の形は L0 のプロンプトと同じ（commit しない・app-v3 と Codex の作業場を変えない・repo 外を読まない）

## LS-11 話す（`#talk` `#paused`）と予定（右パネル / `#plan`）— レーン L1

### 会話の出所
- 会話 = Codex の `DES.live.state.messages`（role user / assistant）+ 本サイトの `DES.state.talkLocal`（表の操作の記録行と、サポーターの発言 / アイデア。Codex の保存に項目を足せないのでこちらに持つ）を `at`（ISO）で並べた 1 本。
- `talkLocal` の要素: `{ id, at: ISO, date:'YYYY-MM-DD', time:'HH:mm', who:'record'|'supporter', text, by: string|null, idea: object|null }`。最大 400 件（古いものから落とす）。register は L1（L6 は `DES.talk.pushLocal(entry)` 経由で足す）
- 日付が変わる所に `.day-sep`（新規・11px muted・左揃え。「11/8（日）」）を入れる。同じ日の中はモックと同じ見た目
- 描画: user → `.message.user`（時刻は createdAt の JST HH:mm）。assistant → `.message.buddy`（`DES.buddy(30,'neutral')`）。record → `.message.record`（モック）。supporter → モックの supporterEl（名前は `DES.sup.nameOf(by)`）
- user の `delivery==='failed'`: bubble の下に `.msg-error`（11px・`var(--muted)`）= `message.error` の文 + `.btn.ghost.small`「内容を入力欄に戻す」（Codex と同じ。入力欄に文があれば上書きせずトースト「入力中の文を残しています。先に入力欄の内容を確認してください。」）
- `pending` がある間: 会話の末尾に `.message.buddy.pending`（`DES.buddy(30,'think')` + bubble「返事を待っています。予定はまだ変更していません。」）。送信から 60 秒たっても pending なら bubble の下に「前の送信の返事を受け取れていません。自動では送り直しません。」+ `.btn.ghost.small`「この送信の受信を終了」（Codex の end-pending と同じ条件: `Date.now() - pending.startedAt >= 60000`、失敗文は `notices.interrupted`）
- 返事は届いたが保存できない（`finishSend` が失敗）: 会話の末尾に `.notice.unsaved`（新規）「返事は届きましたが、保存できていません。予定は変更していません。」+ 返事の bubble + `.btn.small`「届いた返事を保存する」。保存できたらトースト「返事が届きました。予定の候補は、内容を見てから選べます。」
- `DES.live.issue`（corrupt / storage / locks）がある間: message-list の上に `.notice`（`ops.notices[issue]` の文）+ `.btn.ghost.small`「保存を再確認」。composer は読み取り専用
- `DES.live.available === false`（単独ビルド）: message-list の上に 1 文「バディの会話は、まだこの画面につながっていないよ」（key `live_unlinked`）。composer は disabled

### 接続の状態の行（`.service-line`・新規）
welcome の p の下に 12px muted の 1 行 + `.btn.ghost.small`「接続を確認」。文は Codex verbatim: 未設定「バディは準備中です。予定は自分で追加・編集できます。」/ 設定済みで送れない「今はバディへ送信できません。試用の残り回数：{n}」/ 送れる「バディと話せます · 試用の残り {n} 回」/ 取れない時は `DES.live.text.serviceError(status)` か「バディへの接続を確認できません。予定は自分で編集できます。」。起動時と送信のあとに `DES.live.api.status()` を 1 回

### 送信（Codex app-live/app.js sendChat の写し）
1. 送れる条件: 本文が空でない・`pending` なし・`sending` でない・`api.available`・`issue` なし・`messages.length <= LIMITS.messages - 2`。送るボタンは条件を満たさない間 disabled。IME 変換中は送らない。Ctrl/Cmd+Enter で送る
2. `requestId = crypto.randomUUID()`。`DES.live.commit(next => ops.beginSend(next, { requestId, messageId: uuid, date: DES.clock.today(), content, now: Date.now() }))` → payload。失敗（code）はトーストに `message`
3. textarea と `des.live.draft` を空に。`DES.live.api.send(payload, requestId)`
4. ok → `commit(next => ops.finishSend(next, response, uuid, Date.now()))`。失敗なら上の unsaved 表示
5. ng → `commit(next => ops.failSend(next, requestId, message))` + トースト `message + ' 自動で送り直していません。'`
6. 終わったら `api.status()`
- 写真 / 音声ボタンはモックのまま（押すとトースト `demo_media`）。`.privacy-line` の `share_note` はそのまま。`.chat-bridge` の「作る」は `DES.make.fromTalk()`（L2。`DES.talk.lastOwnText()` = 最後の user 発言の content を L1 が公開する）
- `#paused`（今日はここまで）はモックのまま

### 予定の出所（右パネル = 今日の表。`#plan` = 広い表 + カテゴリカード）
行 `rows` は**毎回導く**（保存しない）:
| 行 | 出所 |
| - | - |
| fixed お昼 12:30〜13:30 | `DES.data.classroom.lunch` |
| event サークル対話 | `classroom.circle.today`: `'tbd'` → 10:50〜11:10 + チップ `circle_tbd`（CONTRACT-v3 §R-12）/ `'none'` → 出さない |
| optional 運動 11:30〜12:30 | `classroom.exercise`。choice は `planLocal.optional[today]`（無ければ undecided） |
| mine | Codex の `events` のうち `date === today && !done`。`id` = event.id。`hidden` = `planLocal.hidden` に含む。`edited` / `activity` = `planLocal.meta[id]` |
| proposed / held | Codex の messages の proposals のうち `op==='add' && status==='pending' && date === today`。`planLocal.held` に含めば held。`from` = message.id。update / remove の候補は行にせずカードだけ |
空き行・現在時刻線・ブロック・重なりの計算はモックの純関数（freeSlots / overlaps / blocks）を `rows` に対して使う（占有の規則は §R-1 のまま）。現在時刻線は `DES.clock.now()`。1 分ごとに描き直す（route が talk / plan の時だけ）

### 操作 → 書き込み（Codex 側を先に。失敗したら live 側を書かず、トーストに `message`）
| 操作 | Codex（`DES.live.commit`） | live（`DES.app.change`） | 記録行（`DES.text.rec_*` verbatim） |
| - | - | - | - |
| 予定に入れる（proposed / held） | `decideProposal(msgId, propId, true)` | held から外す。`meta[event.id].activity` = タイトルの別名照合（`DES.aliases`） | rec_add |
| あとで | なし | `planLocal.held` に追加 | rec_hold |
| 違う | `decideProposal(..., false)` | held から外す | rec_decline（**取り消し不可**。トーストは「見送った」のみ。モックの 5 秒 undo は出さない） |
| 時刻を直す | `updateEvent(original, {...original, start, end})` | `meta[id].edited = true` | rec_time |
| 上へ / 下へ / ドラッグ | 1 回の commit の中で 2 行の start/end を**直接**書き換える（`sameEvent` で元と一致を確かめてから `next.events[i]` を更新。`updateEvent` を 2 回呼ぶと間の状態で overlap になるため） | 両方 `edited = true` | rec_swap |
| 外す | `removeEvent(original)` | `meta[id]` と hidden を退避 | rec_remove。トースト「外したよ」+「元に戻す」5 秒 → `addEvent(同じ event)` + 退避を戻す + rec_undo |
| 非表示 / 表示する | なし | `planLocal.hidden` | なし |
| 終わった | `updateEvent(original, {...original, done:true})` | なし（カタログの「今日 10:00〜10:50」は done の event から導く） | rec_finish。トースト「…に戻した」+「元に戻す」5 秒 → `done:false` + rec_undo |
| 運動 4 値 | なし | `planLocal.optional[today]` | rec_join / rec_skip / rec_later |
| 取り組みを追加（空き行 → pick-sheet） | `addEvent({ id: uuid, title, date: today, start, end, done:false })` | `meta[id].activity` | rec_add |
| 今日の予定に入れる（グリッド） | 最初の空き（15 分以上・長さ min(空き,60)）へ `addEvent` | 空きが無ければ書かずトースト `no_free` + 「明日にとっておく」→ `catalogMarks[act].tomorrow = true` | 入った時だけ rec_add |
| バディに相談する | なし | composer の下書き末尾に `prefill_line`（モック） | なし |
| バディにまかせる（空き行） | **実際にバディへ送る**: composer の送信と同じ経路で本文 = key `leave_it_msg`「{start}〜{end} があいているから、まかせるね。まず 15 分でためせるものを 1 つ選んで」（es「{start}〜{end} があいているから、まかせるね。まず 15分で ためせるものを 1つ えらんで」）。送れない状態（available でない / pending）ではボタン disabled・title「今はバディに送れないよ」 | なし | なし（候補はカードに出る） |
| 重なり 3 候補 | 短くする = `updateEvent(end を相手の開始に)` / 別の時間へ = 同じ長さが入る最初の空きへ `updateEvent` / あとで決める = なし | あとで決める → `planLocal.deferred` に id（チップ「重なり」） | rec_shorten / rec_moved / rec_defer |
| 目標 3 枠 | なし | `DES.state.goals[i].text`（src 'own'、date = today 'MM-DD'） | rec_goal |
- Codex の `decideProposal` / `addEvent` が `overlap` / `conflict` / `event_limit` を返したら、live 側は書かず `message`（`ops.notices[code]`）をトーストにする（行はそのまま）
- 提案カード（会話側）の状態表: pending = ボタン 3 つ（予定に入れる / あとで / 違う。update は「この内容に変える」/ remove は「予定から外す」が 1 つ目）/ held = チップ「保留」+ 予定に入れる + 違う / accepted（add）= event が今もあれば「予定に入っている {start}〜{end}」（event の今の時刻に追従）、done なら「終わった」、無ければ「予定から外した」/ accepted（update）=「この内容にした」/ accepted（remove）=「予定から外した」/ declined =「見送った」。今日以外の日付の候補はカードに日付（M/D（曜））を出し、行にはしない
- モックの `trial`（おためし 15 分）のチップと `DES.plan.trial` / `suggestTrial` の**決定論の提案生成は使わない**（固定の返事になるため）。`TK.reply` の規則 0〜4 も使わない。会話の返事は全部 Codex の API
- `#plan` の日付見出しの下に小リンク「ほかの日を見る」（key `other_days`）→ `../app-live/index.html#plan?date=<today>`（Codex の日付別の予定へ。同じ保存を見ている）
- 保存失敗（localStorage が throw）はモックと同じ `save_fail` 表示。Codex 側の失敗は `DES.live.issue` の `.notice`
- 純関数テスト `tools/live-plan-test.js`（rows の導出・空き・重なり・入れ替えの 2 行更新・カードの状態表）と `tools/live-talk-test.js`（会話の結合と並び・日付区切り）

## LS-12 作る（`#make` `#make/<id>` `#make/<id>/save|pause`）と作品（`#works` `#works/<id>`）— レーン L2

### 本物にするもの
- **見本の活動・作品を seed しない**: `MD.seedActivities` / `seedWorks` / `SEED_WORKS(_V2)` / `addSeeds` / `applySeeds` / `seedV` を使わない。初回は `activities = []`・`works = []`。入口は「制作中」0 件の形（見本が先頭）。`#works` は既存の空状態（破線 `.work-add` + `works_empty`）
- **`#make/demo-*` の自動生成ルートを外す**（無い id は `#make` へ replace + トースト）
- **時刻**: 活動・変化・作品・共有の時刻は `DES.clock`（JST）。各記録に `at`（ISO）を持ち、表示用の `time`（'H:MM'）と `day`（'M/D'）は `at` から導く。擬似時計 `tick` は使わない。既存の `migrate` / `migrateWork` の 'H:MM' 比較は `at` が無い旧データ用として残してよい
- **写真・スクショ**: `demo_media` のトーストとダミー線画をやめ、`DES.photo.pick(opts)`（app/js/photo.js。`<input type=file accept="image/*">` → 長辺 640px の JPEG dataURL）で**本物の画像**を活動の `ext.photos[]`（`{id, at, time, kind:'shot'|'photo', data: dataURL, w, h}`）と作品の `images[]` に保存する。1 活動 12 枚まで・1 枚 120KB 超は再圧縮・保存失敗（quota）は `save_fail` の約束どおり画面状態を戻す。顔・名前の注意文（`face_note`）はそのまま。線画 `MD.photoArt` は「写真が無い時の枠」だけに使う
- **バディの固定の返事をバディの発話として出さない**: 作業台の相談列（thread）で `MD.replies` / `MD.testReply` / `settle` の「「{案}」にしたよ。」等の決定論の文を buddy の bubble にしない。代わりに
  - 棚の見出しを「案の棚」（key `shelf_h` を上書き。es「あんのたな」）、棚のカードのチップを「仮の案」（key `card_tentative`。es 同）にし、案（nextVariant / find の 2 値 / extCards のメモ）は**道具が出した候補**として出す（「バディが作った」とは書かない）
  - 案を置いた・試した・採用した等は**記録行**（`.message.record`・緑チップ「記録」）で残す（文は既存の `shelf_new_rec` 等のテンプレートを使う）
  - 相談列の composer は残し、送ると**本物のバディ**へ行く: 本文の先頭に活動の文脈 1 行「（作る「{title}」で）」を付けて `DES.talk.sendFromMake(text, title)`（L1 が公開。中身は LS-11 の送信と同じ。返事は話す画面に残る）。送れない時（`DES.live` が available でない / pending）は composer の下に 1 文「今はバディに送れないよ。話すの画面で確かめてね」（key `mk_cannot_send`）
  - 「バディに任せる」の候補（leaveOptions）はそのまま（道具の操作）。`free`（言葉で頼む）は上の composer へ
  - 「今日はここまで」の背中押し 3 ケース（pause / confirmPause）は**本人の操作の結果に対する定型の案内**なので残してよい。ただし文の出所チップは「バディ」でなく記録の形にしない — 既存どおりダイアログ内の文として出す（AI の発話として会話に保存しない）
  - 作品のキャプチャーの「バディの見立て」（read）は生成しない: 既存の `ai_read_none`「何を作ったか、まだ分からない。教えてくれたら覚えておくね」+「直す」で本人が書く
- **工場の素材**: `/api/library/available` を読み、`materials.length > 0` なら入口の「見本から始める」の下に節「工場から届いた素材」（key `mk_factory_h`。es「こうじょうから とどいた そざい」）: カード = title + `summary`（schema 1 は `summary_elementary`/`summary_secondary` を表示モードで）+ kinds チップ + ボタン「読む」（`body_url` の markdown を `#make-dialog` に描く。見出し・段落・箇条書き・太字・リンクだけの最小の変換、`[cN]` を除去、HTML は通さない）+「この素材で始める」（ext 活動。origin 'material'、`materialId`、手順 = `parts[].title`、`needs_supporter_check` があれば `td_safety` のチップ）。`spark` は出さない。取得失敗・0 件は節を出さない
- **見本（`MD.samples` 6 枚）と「こんなのも作れる」（`MD.projects` 12 件）は残す**（見本のラベル `sample_label` をカードに付ける。画像は「AI が作ったイメージ」の印のまま）。見本から始めた活動は本人の活動（本物）
- 「作品に残す」「見せる」: 既存どおり保存。**見せる**の確定後の文を「見せる準備をしたよ。教室に届ける仕組みはこれから」（key `shared_toast` を上書き。es「見せるじゅんびをしたよ。きょうしつにとどけるしくみはこれから」）にし、作品の「見せている」行の見出しを「見せる準備」（key `shares_h` 上書き）にする。個人名は出さない（既存の規則）
- サポーターの名前は `DES.sup.supName()`（L6。無ければ null → 「{sup}と」のチップを出さない）
- `DES.data.catalog` は教室の設定（classroom.js）のまま。`openFromPlan(row)` は L1 の行（event id）を受ける: `row.activity`（取り組み id）が無ければ title から alias 照合、それでも無ければ theme 'mc' 固定をやめ「思いつきから」と同じ ext 活動にする
- 純関数テスト `tools/live-make-test.js`: 既存 `tools/make-test.js` から見本 seed に依存しない検査を移植（件数が減ってよい。減った理由を報告に書く）。`#make/demo-*` に依存する検査は削る

## LS-13 今日のお題（`#today` `#today/<id>`）と作品展示（`#gallery` `#gallery/<id>`）— レーン L3

### 今日のお題
- **固定のお題を出さない**: `TDD.topics`（作る・ためす 12 本）と `DIALOGS`（見本 9 本）・`DES.topicsLive` の焼いたスナップショット（topics-live.js は削除）を使わない。お題は**実行時に工場から**: `GET /api/library/topics?day=<今日>` → 0 件なら `GET /api/library/topics/stock?kind=news|talk|philo|make&limit=3`（4 回）。両方 0 件 → 空状態 1 文「今日のお題は、まだ届いていないよ。届いたら、ここに出る」（key `td_empty`。es「きょうのお題は、まだとどいていないよ。とどいたら、ここに出る」）+ とっておいたお題・サークルの節は従来どおり（あれば）
- 読み込み中はスピナーを出さず、見出しと節の枠だけ先に描き、届いたら差し替える（§I）。取れなかった時は空状態の代わりに 1 文「今はお題を取ってこられないよ。少したってから開いてね」（key `td_fetch_fail`）
- 変換は `tools/pull-topics.mjs` の `convertTopic` / `validateDialog` を today-data.js へ移植（`[cN]` の除去を足す）。`id` は `'fx-' + topic_id`、**記録のキーは `lineage_id`**（`odai.kept / tried / think / circle` の id を lineage にし、記録に `{ lineage, title:[js,es], kind, body: <変換後の本文の写し> }` を添える。配信から消えても記録・あしあと・サークルの表示が残る）
- 出所チップは「工場で作って確かめたお題」（既存 `td_src_factory`）だけ。「バディが作ったお題」「外からの依頼」「締切」は**出さない**（データが無い）。`reason` は null なので「なぜ出したか」行は出ない
- 入口: 対話のお題（news / talk / philo）= 前提を読む / いろいろな考えを見る（views があれば）/ 問いを選ぶ / 自分の考えを置く（既存どおり）。作る・ためす（make）= 「作ってみる」+「実物を探す」（`body.make` に hints が無ければ探すは出さない）だけ。**「短い動画を見る」「試して遊ぶ」は出さない**（実物が無い）
- 「見つけた写真を残す」は `DES.photo.pick` の本物の写真（`found[].photo` = `{data, w, h}`）。線画は写真が無い時の枠だけ
- 「作ってみる」→ `DES.make.openOdai`（L2）はそのまま（活動に `odaiId` = lineage）
- 記録の時刻は `at`（ISO）+ 表示 'M/D H:MM'
- `tools/live-today-test.js`: 変換（配信の形 → 画面の形・`[cN]` 除去・禁止語）と記録のキー（lineage）の純関数テスト

### 作品展示
- **見本の展示（`GD.items` 8 件・`reacts`・`notes`・`calls`・`inbox`・`promises`・`SEED_CALL`・`seeded`）を使わない**。並ぶのは**この端末の作品のうち「見せる」の準備をしたもの**（`works[].shares` があるもの。`gallery.mine` の state）だけ。0 件は既存の空状態 `gl_empty` + 「作品を見る」
- 見出しの下の 2 文（`gl_sub` / `gl_sub2`）は残す（将来の約束）。加えて 1 文「今はこの端末の作品だけが並ぶよ。教室のみんなの作品が並ぶ仕組みはこれから」（key `gl_local_note`。es「いまはこの たんまつの作品だけがならぶよ。きょうしつのみんなの作品がならぶしくみはこれから」）
- 呼び名のダイアログ・自動切替・種類チップ・カード・詳細（絵・題・気に入っている・工夫した）・「展示から外す」はそのまま。自分の作品なので反応ボタン・声かけは出さない（既存の「自分の作品」の分岐）。ひとこと（notes）は自分の作品へのメモとして残す（番人 `G.guard` はそのまま・hold はサポーターが読む前提の文のまま）
- 届いた声かけ・約束の節は出さない（データが無い）
- `tools/live-gallery-test.js`: 既存 `tools/gallery-test.js` から見本に依存しない検査を移植

## LS-14 学びマップ（`#map` …）とあしあと（`#trail`）— レーン L4

### 学びマップ
- **つながり（made / flow / fields / concepts / list）**: ノードは**本人の活動・作品**（`activities` / `works`）だけ。`MPD.past`（前に作ったもの 7 件）・`MPD.learned`（学んだこと 26 件）・`MPD.next`（これから作れそう 5 件）は使わない。学んだことは推定の仕組みが無いので 0 件 = 各ノードの詳細に `mp_learned_none`、`next` チップは無し（出さない）。活動 0 件は `mp_empty` + 「作るへ」（地図系の見方でも同じ空状態を出す）
- 単元の母集団（`MPD.units` 算数 4 年 14 単元 / `extUnits` / `areas` / `concepts` / `unitLinks`）は**参考の地図**として残す（学習指導要領の要約。架空の人物を含まない）。ただし見出しの下に 1 文「単元の名前は学習指導要領の要約。教材は基礎学習で開ける」（key `mp_ref_note`。es「たんげんの名前は がくしゅうしどうようりょうの ようやく。きょうざいは きそ学習で ひらける」）。i18n の「表示例」「見本」の語（Codex が `mp_overall` / `mp_scope_note` / `mp_all_h` / `mp_all_band` / `mp_lg_unit_ext` に入れた文）は本物の帯（下）に合わせて書き直す
- **全体（`#map/basics`）= 本物の基礎学習の記録**: `../basic-learning/js/courses.js` と `courses-jp56.js` を `<script>` で動的に読んで `window.BL.courseRegistry` を得る（同じ origin。失敗したら Codex の入口（教科 × 学年のリンク）だけを出す）。コースごと（math4〜9 / jp4〜9 / science4〜9）に帯（マス = `codes[]` の順）と「ふれた単元 {n} こ / {total}」。マスの状態は `des.basic-learning.v1` の `progress[code]`: 無し = none / `answers` が 1 つ以上 = touched / `answers` の全部が `correct:true` = done（問題数が分からないので「全部正解で done」）。割合（%）は出さない。マスの `aria-label` = 「{course label} · {n} 番目の単元」。マスを押すと `../basic-learning/index.html#list/<course>`（単元への直リンクが basic-learning/js/app.js にあれば（読み取り専用で確認）それを使う）。「続きから」= `resume` の code のコースへのリンク
- Codex の `app-v3/js/basic-learning.js`（教科 × 学年の入口 details/summary）を `app/js/basic-learning.js` として写し、`note()` の文「マップの進み具合は表示例です…」は**出さない**（本物になったため）
- `#map/u/<code>`（単元ページ）: 参考の地図の単元は従来どおり（進み具合の印は出さない。「基礎学習を始める」はその教科・学年の `#list/` へのリンクに）
- `tools/live-map-test.js`: 本物の帯（registry + progress → マスの状態・数）の純関数テスト。見本の件数に依存する検査は移植しない

### あしあと
- 時系列の出所: 作った（`activities` の変化・一区切り・やめた）/ 作品に残した（`works`）/ 話した（Codex の messages: user + 直後の assistant の 1 行目。`DES.live.state`）/ 予定の記録（`talkLocal` の record。終わった行は Codex の done の event と `rec_finish` の記録行を照合）/ 見つけた（`odai.tried[*].found`）/ 考えのあしあと（`odai.think[*].marks`。**新規**: 行の種類「考えた」、key `tr_f_think`「考えた」。既存の絞り込み 6 ボタンの「見つけた」に含めてもよい — 実装を正とする）/ 基礎学習（`des.basic-learning.v1` の `resume` を上段「前はここまで」の 1 枚「基礎学習: {course label}」+「続きをする」→ `../basic-learning/index.html#list/<course>`。`progress` に時刻が無いので時系列には出さない）
- 日付は各記録の `at`（ISO）から。今日 = `tr_today`。年をまたいでも並ぶ
- 空状態・中立文・先頭のバディ 1 文（`resume_push`）はそのまま（バディ 1 文は本人の活動の `next` から作る定型 = AI の発話でなく案内）
- `tr-retry`（もう一度試す）/ `tr-plan`（予定に入れる = L1 の `DES.plan.act.addFirst`）はそのまま
- `tools/live-trail-test.js`: 既存 `tools/trail-test.js` から見本に依存しない検査を移植（記録行はテンプレート一致でなく `kind` で分類する）

## LS-15 自己理解（`#self`）— レーン L5

- **固定の見立て・記録・引用・gap（`DES.selfData.items` 26 件）・工夫の場面（`kufu.scenes` k1/k2・ideas・seed）・`comment.first` を使わない**。初回は空
- 5 観点のカードの中身の出所:
  - 本人の言葉（own）: 本人が「書く」で書いたもの（既存の notes。保存は `des.live.self`）
  - 記録（record）: 本人の記録から**機械的に**導く（AI の推定ではない）: 体験（exp）← 作品と活動（「{title} を作った（M/D）」）/ 習熟（mas）← 基礎学習の記録（「{course label} の単元に {n} こふれた」。`des.basic-learning.v1` 読み取り）/ 関心（int）← 目標 3 枠の text と「明日にとっておいた」取り組み / 志向性（ori）・心理（psy）← 無し。record の行は既存の record の形（緑チップ）で、`cond` は出さない
  - バディの見立て（ai）: 生成の仕組みが無いので**出さない**。各観点に own も record も無い時だけ gap の行「まだ分からない」（既存の gap の形 + 「書く」）
- 中央の吹き出し: 見立てが無い間は「まだ見立ては置いていないよ。話す・作る・基礎学習をすると、ここに手がかりがたまっていく」（key `sx_empty_comment`。es「まだ見立てはおいていないよ。はなす・つくる・きそ学習をすると、ここに手がかりがたまっていく」）。`react_hint` 等の返事の UI は見立てがある時だけ
- 工夫の帯: 本人が場面を書く → kinds（AI と一緒に / 環境を変える / 道具を作る）のボタン（既存）。`new_scene_buddy` の固定返事は出さない（代わりに何も出さない）。`try / result / adjust / away` の操作はそのまま。「自分に合う工夫」は本人の result fit だけ
- アバターと名前: `#self-sheet`（アバター）に「呼んでほしい名前」の入力（12 字まで・空なら名前なし）を足し、保存先は **`DES.state.profile`（L0 の store）**（`{name, avatar:{hair,color}|{none:true}}`）。`avatar_alt` は「{name}のアバター」（名前が無ければ「アバター」）。画像 12 枚は選べる絵のまま（本人の写真と言わない）。`share` の文は「サポーターも見られる」（key `sx_share` 上書き。サポーター名は入れない）
- `as_of` / 日付は `DES.clock`。`door`（予定に入れる）は L1 の `DES.plan.act.addFirst` の結果（Promise）で判定する（setTimeout(0) の件数差分はやめる）
- `toTalk` は `DES.talk.prefill`（L1）を呼ぶ（二重実装をやめる）
- `tools/live-self-test.js`: reduce の純関数テスト（fixture を注入しない形に直す）

## LS-16 サポーター（`#sup` …）— レーン L6

- **前提（本書の範囲）**: アカウントは無い。サポーターは**この端末で学習者と一緒に**使う（「一緒に入る」はその場の操作）。教室の一覧に出るのは**この端末の学習者 1 人**（`profile.name` か「この端末の学習者」key `sup_this_device`）。他の子ども 4 人の固定カードは出さない。注記 `only_child` の文を「この端末の記録だけが見られるよ」（es 同）に
- サポーターの名前: 固定の「田中さん」をやめ、`sup.supporter = { name }`（最初は null）。`#sup` の見出しの下に 1 行入力「あなたの呼び名（記録に残る）」（key `sup_name_label`）。空の間は `DES.sup.supName()` が null を返し、by のチップ・「{sup}が…」の文は名前の代わりに「サポーター」（key `sup_generic`）を使う
- 今日 / 手がかり / 助言 / 記録 / レポートの中身は全部**本物の記録**から: 今日 = Codex の events（今日）と messages（今日）と talkLocal / 手がかり = `des.live.self` の own と record（L5 の導出関数 `DES.self.records()` を使う。ai は無い）/ 助言 = サポーターが書いたもの（バディの見立て・「応答はサンプル」は出さない。空の段は「これから」の既存文）/ 記録 = `sup.log`（一緒に入っている間の操作の記録。週の四角と読み取り 1 文は実データから。「10/26 より前は…」の注記は出さない）/ レポート = 今の記録から毎回作る（既存）。「送る」→ 状態 sent の文を「{at} に送った（この端末に残した。おうちの人に届ける仕組みはこれから）」（key `rp_sent_at` 上書き）
- 一緒に入る: `join` と帯・紫の枠・`#self` の inert・stance（proxy / voice / idea）はそのまま。proxy の送信は L1 の送信（本物のバディ）。voice / idea は `DES.talk.pushLocal({who:'supporter', ...})`（talkLocal）。by の印は `sup.log` に `{kind, at, messageId|eventId|recId, by}` を書き、画面側はそれを引いて出す（Codex の messages / events に項目を足さない）
- `#sup/<id>` の id は `me`（`DES.data.child.id`）。`haruto` は使わない。check.sh の目印 `data-sup-page` はそのまま
- `tools/live-sup-test.js`: 既存 `tools/sup-test.js` から fixture（5 人・週の数字）に依存しない検査を移植

## LS-17 対応表と検証の約束（全レーン）
- 各レーンは最終報告に **対応表**（モックの画面・操作 / 現在の実装状況 / 接続する既存機能・データ / 今回実装した内容 / 検証方法）を Markdown の表で含める（司令塔が `docs/plans/live-site/mapping.md` にまとめる）
- 検証: `sh tools/live-check.sh <自分のルート…>` = `LIVE_CHECK=PASS`、`node tools/live-<page>-test.js` = PASS、`sh tools/live-render.sh` の 1440 / 1024 / 390 を自分で見る（png のパスを報告）。司令塔が Chrome で操作確認する

## LS-18 裁定（2026-11-08 Astra high の契約レビュー REVISE 42 件への回答。LS-2〜LS-16 と食い違う時は本節が優先）

- **18-1 記録行の保存先は `talkLocal` 1 本**（LS-2 の `records` は廃止）。要素: `{ id, at: ISO, date, time, who: 'record'|'supporter', kind: string, refs: { eventId?, proposalId?, activity?, messageId? }, text, by: string|null, idea: object|null }`。`kind` は記録のテンプレート key（`rec_add` `rec_time` `rec_finish` …）か `voice` / `idea`。あしあと・サポーター画面は **`kind` で分類**する（文面一致は使わない）
- **18-2 `planLocal` に `deferred: [eventId]`** を足す（「あとで決める」の重なり。rows ではチップ「重なり」）。`meta[eventId]` は `{ activity?, edited? }`
- **18-3 占有と重なりは Codex と同じ集合で判定する**: 空き時間の計算・入れ替えの可否は、**done の event も占有として含める**（表には出さないが枠は埋まっている。Codex の `assertSlot` が done も重なりに数えるため）。入れ替え・ドラッグ・別の時間へ は、commit の中で**最終の events 全体**に対して「同じ日付で start<end の重なりが無い」ことを確かめ、重なれば `overlap` で止める（`updateEvent` と同じ結果になるように）
- **18-4 Codex 側が成功して live 側が失敗した時**: Codex の変更は戻さない。`save_fail` の印（既存）を出し、メモリの状態は保つ。付随情報（記録行・activity 対応・held 解除）は次の `DES.store.save` で一緒に保存される（再試行の導線は `save_fail` の印の既存どおり）
- **18-5 「違う」（decline）は取り消し不可**（Codex の `decideProposal` に戻す口が無い）。CONTRACT-v3 §S-3 の 5 秒 undo は本サイトでは**例外として出さない**（モックとの差として報告に残す）
- **18-6 並び替えの日時**: Codex の messages は `createdAt`、live の記録は `at`。表示用の配列へ投影する時に `at = createdAt` を写す（Codex の保存に `at` を足さない）
- **18-7 受信終了（end-pending）の条件**: `!sending` かつ 実行時に読み直した `pending.requestId` が同じ かつ 60 秒経過（Codex app.js と同じ）
- **18-8 取り組みのグリッドの見出し**: パネルのタブ `history` の値を「取り組み」（es「とりくみ」）、グリッドの見出し `grid_head` を「教室で選べる取り組み」（es「きょうしつで えらべる とりくみ」）にする（本人の履歴に見えないように）。チップ（今日 10:00〜10:50 / 明日にとっておいた / 予定に入っている）が本人の記録
- **18-9 作品の `at` は変化の id（change id）であって日時ではない** → 日時は **`createdAt`（ISO）** を別に持つ。`at` の意味・参照（「この時点から作る」・コマ範囲）は変えない。活動の変化・thread の発言は `at`（ISO）を**新しく**足す（既存に `at` が無い）
- **18-10 工場の素材の形**: `body_url` / `play_url` / `questions_for_kids` / `needs_supporter_check` は **`parts[]` の中**。schema 1 は `parts[].variants[].url`、schema 2 は `parts[].body_url`。URL は相対パス → `DES.factory.base + url`。「読む」は schema 2 の `parts[0].body_url`（無ければ schema 1 の variants から表示モードに合う audience の url）。どちらも無ければ「読む」を出さない。取得は 64KB 上限・`text/markdown` 以外は失敗扱い。markdown のリンクは `https://` だけ `a` にし（`rel="noopener noreferrer" target="_blank"`）、相対リンクは文字のまま。**取得失敗**は 1 文「今は素材を取ってこられないよ」（key `mk_factory_fail`）を節の位置に出す（0 件は節を出さない。LS-10 の区別）
- **18-11 写真の総量**: 1 枚 ≤ 120KB（dataURL の文字長から見積もる）・活動 12 枚・作品 3 枚・お題の見つけた 6 枚、**全体で 60 枚**（`DES.photo.count()` で `des.live.*` の中の写真を数える。超えたら「写真がいっぱいだよ。いらない写真を外してから足してね」key `photo_full`）。圧縮は photo.js の有限の段階（質 0.82→0.5、長辺 640→320）で終わる
- **18-12 共有の文言の key**: works の共有の見出しは `share`（「見せる」）のまま、詳細の「見せている相手:」の行 `shares_line` を「見せる準備: {to}（{time}）」（es「見せるじゅんび: {to}（{time}）」）、`shares_none` を「まだ見せる準備はしていないよ」（es「まだ見せるじゅんびはしていないよ」）、一覧の印 `shown_badge` を「見せる準備中」（es 同）、`unshared_toast` を「見せる準備をやめた」。`shares_h` は使わない。`shared_toast` の所有は **L2**（L3 は触らない）
- **18-13 本人が書いた「見立て」（作品の read）は本人の言葉**: 保存の `who` を `'own'` にし、チップは `own_label`（本人の言葉）。`ai_read_none` の文は「何を作ったか、ここに書いておけるよ」（key を上書き。es「何をつくったか、ここに書いておけるよ」）
- **18-14 道具が出した案の採用は本人の操作**: 棚の案を採用した変化は `who:'own'`・`kind:'adopt'`（`who:'ai'` は本物の AI が関わった時だけ。今は無い）。関わり（roles）の集計もそれに従う
- **18-15 作品展示の並び方はモックのまま**: 展示に出る作品 = `gallery.mine[workId].state === 'shown'`（「展示に出す」と自動切替）。works の「見せる」（shares）とは別の操作のまま。`gl_local_note` の 1 文は両方が端末内であることを言う
- **18-16 今日のお題の make の変換**: `pull-topics.mjs` の変換器は対話 3 種だけ → make（`body.make`: category / line / first_step / need / steps / safety）の変換・検査は L3 が新しく書く。`checked` は `sources[].checked`（無ければ出さない。取り込み日で代用しない）
- **18-17 お題の解決**: `DES.todayData.get(x)` / `getDialog(x)` は **`'fx-' + topic_id` でも `lineage_id` でも**引ける（読み込んだお題 → 記録に添えた写し の順）。活動の `odaiId` は lineage
- **18-18 基礎学習の記録の読み方**: `progress` のキーは **ref**（`<code>` または `jp5/<code>` 等。`core.js` の `ref(unit)` と同じ）。コースの codes を ref に直して引く（jp5〜9 は `'jp' + grade + '/' + code`）。状態は **none / touched の 2 値**（`answers` が 1 つ以上で touched。done は問題数が分からないので出さない）。帯の凡例も 2 値
- **18-19 courses registry の読み込み**: `basic-learning/index.html` の script 列のうち core.js より前の catalogue / courses 系（`catalogue.js` `courses.js` `catalogue-jp56.js` `courses-jp56.js` `catalogue-jp7.js` `catalogue-jp8.js` `catalogue-jp9.js` `catalogue-science4..9.js`）を**同じ順で**動的に読む（`units-*` は読まない）。読み終えて `BL.courseRegistry.courses` に 18 コース無ければ、有るコースだけで描く。読み込み中は帯の枠だけ描いて差し替え
- **18-20 マップのマスの読み上げ**: 単元名が無いので `aria-label` は「{course label} · {n} 番目 · {状態}」。遷移アニメ（§AH の札が飛ぶ）は参考の地図（M4-* の単元）と本物の帯で id が対応しないため、本物の帯では**行わない**（つながり ⇄ 全体 の切替はタブの切替だけ。モックとの差として記録）
- **18-21 サポーターの表示名は記録時に写す**: `talkLocal.by` と `sup.log[].by` に**その時の表示名**を保存し、`nameOf(by)` は保存値をそのまま返す（後で改名しても過去の記録は変わらない）
- **18-22 サポーターのレポート・アイデアの文言 key**: 送った後の行は `rp_sent_line`（「{at} に送った（この端末に残した）」）、`rp_send_note`（「おうちの人に届ける仕組みはこれから」）、送信トースト `rp_sent_toast`（「この端末に残したよ」）。アイデアへの 150ms の固定返信（`idea_rep_match` / `idea_rep_free`）は**出さない**（返事は本物のバディだけ）
- **18-23 アバターと名前の正本は `profile`**（L0 の store）。`self` の保存に avatar を持たない
- **18-24 文言の直し**: `resume_empty_p` →「「話す」から始めよう」/ `sx_empty_comment` →「まだ見立てはおいていないよ。作る・基礎学習・自分の言葉を書くと、ここに手がかりがたまっていく」（es「まだ見立てはおいていないよ。つくる・きそ学習・自分のことばを書くと、ここに手がかりがたまっていく」）/ `clear_p` →「名前とアバター・作ったもの・書いたこと・予定の表の印・サポーターの記録・表示の設定を、このブラウザから消す。会話と予定、基礎学習の記録は消えない」
- **18-25 禁止語の機械検査の範囲**: `live-check.sh` は固定 UI の検査。本人の自由入力（textarea / 本人の言葉）に評価語があっても本人の文は変えない（検査用の合成データには入れない）
- **18-26 工場 API の CORS**: 配信 API（`/api/library/*`）はブラウザの別オリジンから読むための `access-control-allow-origin: *` が **未確認**（`http.ts` の json() に無い。models3d だけ付いている）。工場の担当セッションへ付与を依頼済み（下の統合手順に記録）。付くまでは本物の環境で `td_fetch_fail` / `mk_factory_fail` の状態になる。開発・検証は `tools/live-serve.mjs --factory-proxy`（同一 origin で `/api/library/*` を工場へ中継する読み取り専用の口）を使い、画面側は `DES.factory.base` を `''`（同一 origin）に切り替えられる（`window.DES_FACTORY_BASE` があればそれを使う）
- **18-27 公開 API 表（提供側が約束する形）**:
  - `DES.talk.lastOwnText() → string|null` / `DES.talk.pushLocal(entry) → void`（18-1 の形。保存は呼び手が `DES.app.change` で）/ `DES.talk.record(text, kind?, refs?)` / `DES.talk.sendFromMake(text, title) → Promise<{ok:true}|{ok:false, message}>`（送信後は `#talk` に移らない。返事は話す画面に残る）/ `DES.talk.prefill(title) → void`（下書き末尾に追記 + トースト + `#talk` へ）/ `DES.talk.messages() → [{id, at, date, time, who, text, by, proposals?, delivery?}]`
  - `DES.plan.act.addFirst(catalogId, o) → Promise<{ok:true, event}|{ok:false, reason:'no_free'|'overlap'|'event_limit'|'conflict'|'storage'}>` / `DES.plan.item(id)` / `DES.plan.range(start,end)` / `DES.plan.live() → rows`
  - `DES.sup.supName() → string|null` / `DES.sup.nameOf(by) → string`（by は保存済みの表示名） / `DES.sup.isJoined() → boolean` / `DES.sup.byNow() → string|null`
  - `DES.self.records() → [{axis, text, at}]`（record の導出。L6 が読む）
  - `DES.todayData.get(idOrLineage)` / `getDialog(idOrLineage)`
  - `DES.photo.pick(o) → Promise<[{data,w,h,bytes}]>` / `DES.photo.valid(p)` / `DES.photo.count() → number`（司令塔が photo.js に足す）
- **18-28 各ページの失敗・競合・再読込の受入条件（共通の状態機械）**: (a) 読み込み中（API / registry）= 枠だけ先に描く・スピナー無し・8 秒で失敗扱い (b) 失敗 = その節の位置に 1 文（key は各節）+ 再読み込みで再試行（自動再試行は無し）(c) 保存失敗 = `save_fail` の印 + 操作した場所の状態を戻す（ダイアログは閉じない）(d) 別タブの変更 = `storage` / `DES.live.subscribe` で読み直して描く。入力中の欄（textarea / inline edit）の値は保たれる (e) 再読み込み = 保存した状態がそのまま出る（一時 UI は閉じる）(f) 参照先が消えた（お題・活動・event）= 行を出さないか「見つからなかったよ」で一覧へ replace（既存の約束）
