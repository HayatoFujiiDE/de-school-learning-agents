# 契約 §Y — 作るの 4 つ目の題材「自分を助ける道具」と、自己理解の工夫からの入口（凍結 2026-11-05）

CONTRACT-v3 §U / §W / §X と contract-V（§V）を継承する。食い違いは本節が優先。「」内と下の表の文言は verbatim（言い換え禁止）。

## Y-0 オーナー確定（2026-11-05・蒸し返さない）

1. 自己理解の工夫で「道具を作る」を押すと、作るページで **4 つ目の題材「自分を助ける道具」** の作業台が開く（Python の題材で代用しない。思いつき入力へ送るだけにもしない）
2. 作っている道具は、自己理解の工夫と **紐づける**: 工夫の行に「作るで作っている」と作業台へ戻るリンク。道具が作品に残ったら、その工夫の「試してみる」へ進める
3. 作るの入口の見本は **3 枚のまま**（§U の確定 Q2）。道具の題材は入口の見本一覧に出さない。入口は自己理解の工夫と、思いつき入力（pickTheme）からだけ

## Y-1 触るファイル（`make.js` / `make-data.js` は feat/today-page の main 取り込み後に始める）

| ファイル | 変更 |
| - | - |
| `app-v3/js/make-data.js` | `MD.THEMES` に `'tool'`、`THEME.tool`、`VARIANT['tool.*']` 4 つ、`MD.extCards.tool`、`MD.result` / `MD.code` / 図（`MD.art` と artMarks）/ `MD.testReply` / `stepsFor` に tool の分岐。`MD.samples` と `MD.captures` には**足さない** |
| `app-v3/js/make.js` | 題材の分岐に tool を通す（下の Y-4）。`M.openFromSelf(o)` を追加。活動に `selfLink` を持たせる（migrate / validate が捨てないこと） |
| `app-v3/js/i18n.js` | `origin_self` の 1 key だけ（`['自己理解から', '自分を知るから']`） |
| `app-v3/js/self.js` / `self-data.js` | 工夫の行の「作るで作る」と紐づけの表示（Y-5） |
| `tools/make-test.js` | U12-b など全題材を回す検査が tool も通ること + tool の純関数の検査を足す |
| `docs/plans/self-page/contract-Y.md` | 本書 |
| 触らない | `today*.js`、`app.js`、`works.js`（読むだけ）、`tools/check.sh`、`data.js`、`buddy.js`、`tokens.css`、factory/ |

'odai'（feat/today-page の ext 型の題材）の分岐には触らない。tool は mc / py / circuit と同じ stage 型として THEMES 側に足す。

## Y-2 題材データ（make-data.js に verbatim で入れる）

```js
tool: {
  sample: 'memo', ideas: ['nudge', 'oneby', 'board'], capIdea: 'board', variants: ['memo', 'nudge', 'oneby', 'board'],
  topic: ['自分を助ける道具', '自分をたすける道具'],
  effect: ['手もとに出るもの', '手もとに出るもの'], aim: ['出かた', '出かた'],
  changeable: [['まとめる数', 'まとめる数'], ['間かく', 'あいだ']],
  params: [
    { key: 'count', label: ['まとめる数', 'まとめる数'], min: 1, max: 5, def: 3 },
    { key: 'every', label: ['間かく', 'あいだ'], min: 0, max: 4, def: 1,
      names: [['1 分', '1 分'], ['3 分', '3 分'], ['5 分', '5 分'], ['10 分', '10 分'], ['話が終わったら', '話がおわったら']], vals: [1, 3, 5, 10, 0] }
  ],
  stepBase: [['まとめる数を変える', 'まとめる数をかえる'], ['間かくを決める', 'あいだをきめる'], ['サークル対話で使ってみる', 'サークル対話でつかってみる']],
  extSteps: [['写真を入れる', '写真を入れる'], ['使った場面を書く', 'つかった場面を書く']],
  find: [{ count: 2, every: 1 }, { count: 4, every: 3 }]
}
```

VARIANT:
```js
'tool.memo':  { title: ['論点メモ', 'ろんてんメモ'], values: { count: 3, every: 2 } },
'tool.nudge': { title: ['ひとこと合図', 'ひとことの合図'], values: { count: 1, every: 1 }, step3: ['合図の言葉を決める', 'あいずのことばをきめる'] },
'tool.oneby': { title: ['ひとつずつリスト', 'ひとつずつリスト'], values: { count: 1, every: 4 }, step3: ['次を出す合図を決める', 'つぎを出すあいずをきめる'] },
'tool.board': { title: ['話の地図', '話のちず'], values: { count: 4, every: 2 }, step3: ['真ん中に書くことを決める', 'まん中に書くことをきめる'] }
```

extCards.tool:
```js
tool: {
  calc: { title: ['使う時間', 'つかう時間'], lines: [['サークル対話は 20 分', 'サークル対話は 20 分'], ['5 分ごとなら、まとめは 4 回', '5 分ごとなら、まとめは 4 回'], ['論点 3 つ × 4 回 = カード 12 枚', 'カード 3 まい × 4 回 = 12 まい']],
    alt: { title: ['使う時間（10 分ごと）', 'つかう時間（10 分ごと）'], lines: [['サークル対話は 20 分', 'サークル対話は 20 分'], ['10 分ごとなら、まとめは 2 回', '10 分ごとなら、まとめは 2 回'], ['論点 3 つ × 2 回 = カード 6 枚', 'カード 3 まい × 2 回 = 6 まい']] } },
  steps: { title: ['論点メモの使い方', 'ろんてんメモのつかいかた'], lines: [['1. 聞いたことを 1 行ずつメモに入れる', '1. 聞いたことを 1 行ずつメモに入れる'], ['2. 5 分たったら AI が論点に分ける', '2. 5 分たったら AI がカードに分ける'], ['3. 気になるカードに印を付ける', '3. 気になるカードにしるしをつける']],
    alt: { title: ['論点メモの使い方（話の地図）', 'ろんてんメモのつかいかた（話のちず）'], lines: [['1. 聞いたことを 1 行ずつメモに入れる', '1. 聞いたことを 1 行ずつメモに入れる'], ['2. AI が真ん中の問いから枝を伸ばす', '2. AI がまん中の問いから枝をのばす'], ['3. 自分の考えを枝に足す', '3. 自分の考えを枝にたす']] } },
  cmd: { variant: 'board', values: { count: 4, every: 2 } }
}
```

**結果の 1 行（MD.result）**: E = every の vals が 0 なら names（js「話が終わったら」/ es「話がおわったら」）、それ以外は「{n} 分ごとに」。

| variant | js | es |
| - | - | - |
| memo | `{E}、話を {count} つの論点カードにまとめる` | `{E}、話を {count} つのカードにまとめる` |
| nudge | `{E}、「いまの話を {count} 行で」と手もとに出す` | `{E}、「いまの話を {count} 行で」と手もとに出す` |
| oneby | `決めることを {count} つずつ出して、{E}次を出す` | `きめることを {count} つずつ出して、{E}つぎを出す` |
| board | `{E}、話を {count} 本の枝の図に書き足す` | `{E}、話を {count} 本のえだの図に書きたす` |

（E が「話が終わったら」の時、oneby は「話が終わったら次を出す」になる。読点の重複は作らない）

**コードの短い表示（MD.code。モード共通）**: Es = vals 0 なら「話の終わり」、それ以外は「{n} 分ごと」。
- memo: `メモ → AI → 論点 × {count}（{Es}）`
- nudge: `時計 → 合図「いまの話を {count} 行で」（{Es}）`
- oneby: `リスト → {count} 件ずつ表示（{Es}）`
- board: `メモ → AI → 枝 × {count}（{Es}）`

**試した時の返事（MD.testReply の vars）**: key 'count' → effect「まとめる数」/ aim「数」/ how = 増えた「カードがふえた」・減った「カードがへった」（board は「枝がふえた」「枝がへった」、nudge は「行がふえた」「行がへった」）。key 'every' → effect「出る間かく」/ aim「間かく」/ how = vals が小さくなった（0 = 話の終わりは最も長い扱い）「よく出るようになった」・大きくなった「出るのがゆっくりになった」。

**図（MD.art / artMarks）**: 既存 3 題材と同じ 2 色の線画（墨 + 橙/オリーブ）・同じ 240×150 枠。count と every で図が変わる（make-test U12-b の「隣り合う値で線画が変わる」を満たす）:
- memo: 左に罫線のメモ、矢印、右に count 枚の小カード（縦に並ぶ）。右上に小さな時計と every の文字
- nudge: 吹き出し 1 つの中に count 本の横線。右上に時計と every
- oneby: 重なったカードの束で、いちばん上の 1 枚に count 本の線。右上に時計と every
- board: 真ん中の丸から count 本の枝と端の小さな四角。右上に時計と every
- 顔・人物・絵文字は描かない

## Y-3 pickTheme（思いつき入力・話すの bridge）

既存の判定の**前に**: 本文に「論点」「道具」「整理」「合図」のどれかがあれば 'tool'。それ以外は既存どおり（§U-2 の「どれも無ければマイクラ」は維持）。

## Y-4 make.js の分岐

- テーマ表で 'mc' / 'py' / 'circuit' を個別に見ている所（result / code / art / testReply / stepsFor / whatDiff / extCards / 見本カード / 入口の一覧 等 — 洗い出しは `/Users/hayatofujii/.claude/jobs/7864add7/tmp/theme-map.md` の 138 か所）すべてで、tool が既定値（mc / 回路）に落ちないこと。落ちるとエラーにならずに別の題材の文や NaN が出る（MD.theme の既定が mc、MD.result / MD.code の既定が回路）
- **入口の見本一覧（MD.samples）・作品に入れる写真（MD.captures）には tool を出さない**（Y-0 の 3）
- `M.openFromSelf(o)`: `o = { linkId, text, variant }`（linkId = 工夫の id か `'scene:' + 場面 id`、text = 工夫または場面の文、variant 既定 'memo'）
  - 同じ `selfLink === linkId` の活動があれば `openAct(id)`（止めていれば再開）
  - 無ければ `newAct({ theme: 'tool', origin: 'self', title: MD.pick(VARIANT title, mode), stage: stageOf('tool', variant, 'sample'), quote: { text, removed: false } })` に `selfLink = linkId` を付け、バディの返事は `say(a, 'open', mode)`、活動の先頭に追加して `#make/<id>` へ
  - 戻り値は活動 id
- `origin: 'self'` の出所チップは `T('origin_self')`
- migrate / normalize が `selfLink`（文字列・`/^[A-Za-z0-9:_-]{1,64}$/`）を保ち、それ以外の形は捨てる

## Y-5 自己理解の側（self.js / self-data.js）

self-data.js に追加（司令塔が書く・verbatim）:
```js
// kufu に
make_btn: { js: '作るで作る', es: 'つくるで作る' },
making: { js: '作るで作っている', es: 'つくるで作っている' },
open_bench: { js: '作業台を開く', es: 'さぎょうだいをひらく' },
saved_work: { js: '作品に残した', es: '作品にのこした' },
saved_hint: { js: 'できた道具を、試してみよう', es: 'できた道具を、ためしてみよう' },
// ideas の k1-tool に
variant: 'memo'
```

- kind が 'tool' の工夫（データの k1-tool、本人が足した工夫は対象外）: 行の操作は「試してみる」+ `.btn.ghost.small` `make_btn`（= `DES.make.openFromSelf({ linkId: idea.id, text: <工夫の今の文>, variant: idea.variant || 'memo' })`）。more メニューの「話すで一緒に考える」は残す
- 本人が書いた場面の 3 ボタンのうち `kinds.tool` は、話すへの下書きをやめて `openFromSelf({ linkId: 'scene:' + 場面 id, text: 場面の文, variant: 'memo' })`。ai / env は今までどおり話すへの下書き
- 紐づけの表示: `DES.state.activities` に `selfLink === linkId` の活動があれば、その工夫の行（または本人の場面のブロック）に `--record` の小チップ `making` + `.link-btn` `open_bench`（= `DES.make.openAct(id)`）。`make_btn` は出さない
  - その活動の作品（`DES.state.works` で `actId === 活動 id`）があれば、チップを `saved_work` に替え、`試してみる` の隣に hint `saved_hint`（12px muted）を出す。工夫が idle の時だけ
  - 活動・作品の状態は読むだけ（self.js から書き込まない）
- 工夫の状態（idle / trying / result）と紐づけは独立。紐づけがあっても「試してみる」はいつでも押せる

## Y-6 受け入れ（ui-interaction-completeness）

- [ ] 自己理解 k1-tool「作るで作る」→ 作業台が tool / 論点メモで開く。引用枠に工夫の文、出所チップ「自己理解から」、図・結果の 1 行・コードが tool のもの（マイクラ・回路の文や NaN が出ない）
- [ ] スライダー 2 つ（まとめる数 / 間かく）を動かす → 図と 1 行が変わる → 試す → バディの返事が Y-2 の語
- [ ] 任せる → 作っているカード（calc / steps / cmd）が tool の文。仮の案 3 つ（ひとこと合図 / ひとつずつリスト / 話の地図）を選べる。比べる・作り直す・違う・前に戻す が他の題材と同じに動く
- [ ] 作品に残す → 自己理解へ戻ると、工夫の行に「作品に残した」と hint。作業台を開く で同じ作業台へ（新しい活動を作らない）
- [ ] 自己理解で 2 回目の「作るで作る」→ 新しく作らず同じ作業台
- [ ] 本人が書いた場面の「道具を作る」→ tool の作業台。引用枠に場面の文
- [ ] 思いつき入力に「論点を整理する道具」→ tool。「マイクラの家」→ mc のまま（既存の判定を壊さない）
- [ ] 入口の見本は 3 枚のまま。作品の「写真・スクショを入れる」の選択肢も 3 つのまま
- [ ] js / es 切替・再読み込みで状態保持。1440 / 1024 / 390 で横スクロールなし
- [ ] 既存: `node tools/make-test.js` が MAKE_TEST=PASS（全題材ループが tool も通る）、`sh tools/check.sh talk plan make works paused self today` が PASS

## Y-7 スコープ外

道具の実際の動作（本当にメモを AI が分ける）、サークル対話の場での使用、写真から tool の活動を作る経路、作るの入口に 4 枚目の見本を出すこと。

## Y-8 裁定（2026-11-05 Astra medium 契約レビュー REVISE への回答。Y-1〜Y-7 に優先）

1. **新規活動の id と保存**（BLOCKING）: `openFromSelf` は `id: newId('a')` で作り、既存の入口と同じく `DES.app.change(function () { S().activities = [a].concat(S().activities); })` で追加してから `#make/<id>` へ
2. **MD.desc**: tool の説明は `{c} · {Es}`。c は memo「論点 {count}」/ nudge「{count} 行」/ oneby「{count} 件ずつ」/ board「枝 {count}」（モード共通）。Es は Y-2 と同じ（「{n} 分ごと」/「話の終わり」）
3. **任せる・仮の案**: `openFromSelf` は作った活動に既存の `addIdeas(a, 'tool', works)` で仮の案 3 つ（ひとこと合図 / ひとつずつリスト / 話の地図）を棚に置く。stage は 'sample'（見本と同じ操作の組 = find / one）。`extCards.tool` は既存 3 題材で extCards が使われる場面と同じ場面で使う。受け入れの「任せる」は「他の題材の見本と同じ操作が出て、どれも tool の文になる」と読み替える
4. **題材の固定**: `selfLink` を持つ活動は、引用を直しても題材を選び直さない（`editQuote` で pickTheme を通さない）。紐づけも外さない
5. **引用の出所**: `openFromSelf(o)` に `o.src = 'buddy' | 'own'` を足し、`quote.src` に入れる。データの工夫を本人が直していない時は 'buddy'、本人が直した工夫・本人が書いた場面は 'own'。作業台の引用枠は 'buddy' の時 `T('ai_proposal')`（バディの提案）+ 琥珀の出所チップ、'own' または無い時は今までどおり本人の言葉。src が無い既存の引用は 'own' 扱い
6. **本人の場面**: 紐づけの表示（チップ + 作業台を開く）だけにする。「試してみる」と hint は出さない（場面には試す対象の工夫が無いため）
7. **工夫の状態ごとの表示**（データの kind 'tool' の工夫）:

   | 工夫の状態 | 活動なし | 活動あり | 作品あり |
   | - | - | - | - |
   | idle（通常の行） | 「試してみる」+ `make_btn` | 「試してみる」+ チップ + `open_bench` | 「試してみる」+ チップ `saved_work` + `open_bench` + hint `saved_hint` |
   | trying（通常の行） | 「やってみてどうだった？」+ `make_btn` | 「やってみてどうだった？」+ チップ + `open_bench` | 同左（チップは `saved_work`、hint なし） |
   | result fit（「自分に合う工夫」の行） | なし | チップ + `open_bench` | チップ `saved_work` + `open_bench` |
   | result meh / adjust（通常の行） | idle と同じ | idle と同じ | idle と同じ（hint なし） |
   | away（折りたたみ） | なし | なし | なし |

   紐づけは工夫の状態遷移を変えない（§V-4 の reducer はそのまま）
8. **チップの文言**: 活動の state が 'working' なら `making`、それ以外（paused / stopped / closed 等）は `made_tool`。作品がある時は state によらず `saved_work`。hint `saved_hint` は「作った道具を、試してみよう」（試作・完成を問わない文に変更済み）
9. **pickTheme の複合入力**: 「論点 / 道具 / 整理 / 合図」を含めば他の題材語より tool を優先する（意図した仕様）。受け入れに「マイクラの道具」→ tool、「マイクラの家」→ mc を入れる
10. **受け入れの時点**: 作業台を開いた直後は図とコードが tool のもの（結果の 1 行は「まだ試していない」の既存表示）。試した後に結果の 1 行が Y-2 の文になる
11. **図の間かくの表記**: `MD.art` はモードを持たないので、時計の横の文字は vals > 0 なら「{n}分」、0 なら「おわり」（モード共通）
12. **migrate**: `selfLink` と `quote.src` の検査は、現行版の早期 return より前、または全活動に通る正規化で行う

## Y-9 追加裁定（実装後・司令塔）

1. **「どこが違う？」の選択肢（tool だけ）**: i18n.js に `change_opts_tool: ['まとめる数 / 間かく / 出かた / 使う場面 / それ以外', 'まとめる数 / あいだ / 出かた / つかう場面 / それいがい']` を足し、tool の活動では `change_opts` の代わりに使う（他の題材と 'odai' は今までどおり）。選んだ番号から任せる操作への対応は、既存の ASPECT_OPT と同じ考え方で: まとめる数 → 'one'（まとめる数を 1 つ変える）、間かく → 'fix'（間かくを 1 つ変える）、出かた・使う場面・それ以外 → 'redo'（別の仮の案）。対応表は `TOOL_ASPECT = ['one', 'fix', 'redo', 'redo', 'redo']` として make.js に置く（2026-11-05 訂正: 初版は間かくを 'one' にしていて、間かくを選んでもまとめる数が変わっていた）
2. 既存の自己理解テストのうち、本人の場面の「道具を作る」が話すへ下書きする前提の 3 件は、Y-5 の変更による期待値の変化（不具合ではない）。scratch のテストを契約に合わせて直してよい
