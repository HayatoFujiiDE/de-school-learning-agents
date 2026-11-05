/* 作る（#make / #make/<id>）: 活動の状態（純関数）+ 描画 + 操作。CONTRACT-v3 §U、design-v3 §3〜§6・§13。
   純関数は DOM と DES.t に触れない（文言は { k, v } / { r, v } / { text } の形で持ち、描く時に今の表示で読む）。
   変更は必ず DES.app.change → DES.store.save → 再描画 の 1 経路。保存は既存の DES.store に activities / works / makeSide を足して使う。 */
(function (root) {
  'use strict';
  var DES = root.DES = root.DES || {};
  var MD = DES.makeData || (typeof require === 'function' ? require('./make-data.js') : null);
  var M = DES.make = DES.make || {};

  // ---------- 小道具 ----------
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function same(a, b) { return JSON.stringify(a == null ? null : a) === JSON.stringify(b == null ? null : b); }
  function toMin(hm) { var p = String(hm).split(':'); return parseInt(p[0], 10) * 60 + parseInt(p[1], 10); }
  function toHM(m) { var h = Math.floor(m / 60), mm = m % 60; return h + ':' + (mm < 10 ? '0' : '') + mm; }
  function find(list, id) { for (var i = 0; i < (list || []).length; i++) if (list[i].id === id) return list[i]; return null; }
  function idx(list, id) { for (var i = 0; i < (list || []).length; i++) if (list[i].id === id) return i; return -1; }
  function nid(a, p) { a.seq = (a.seq || 0) + 1; return a.id + '-' + p + a.seq; }
  // モックの時計: 活動ごとに DES.data.now から始め、変化ごとに 2 分進む（決定論。表示の時刻が並びで区別できるように）
  function tick(a, n) { a.clock = (a.clock || 600) + (n == null ? 2 : n); return toHM(a.clock); }
  function nowOf(a) { return toHM(a.clock || 600); }
  var TIRED = ['疲れた', 'めんどくさい', 'つかれた'];
  var REST = ['飽きた', 'あきた', '休みたい', 'やすみたい'];
  var REQUEST = /作って|つくって|直して|なおして|変えて|かえて|出して|探して|さがして/;
  function hasAny(text, words) { text = String(text || ''); return words.some(function (w) { return text.indexOf(w) >= 0; }); }

  // ---------- 題材の決め方（U-2）: 直近の本人発言から決定論で ----------
  function pickTheme(text) {
    var t = String(text || ''), low = t.toLowerCase();
    if (/マイクラ|建築|コマンド/.test(t)) return 'mc';
    if (low.indexOf('python') >= 0 || /ゲーム|プログラム/.test(t)) return 'py';
    if (low.indexOf('led') >= 0 || /回路|電気|電池/.test(t)) return 'circuit';
    return 'mc';
  }

  // 保存データの版（§U-12 指摘 6）。版が無い・古い活動は読み込み時に migrate で不足欄を補う
  // v3: 98f0a71 の移行で stepsKind を写真の有無で決めてしまった v:2 の活動を作り直す（Astra 4 回目）
  var SCHEMA = 3;
  // ---------- 活動を作る ----------
  function newAct(o) {
    var clock = toMin(o.now || '10:20');
    var a = {
      id: o.id, title: o.title, origin: o.origin || 'make', theme: o.theme || 'mc', catalogId: o.catalogId || null, sampleId: o.sampleId || null,
      quote: o.quote || null, stage: o.stage || null, base: clone(o.stage || null), baseTime: toHM(clock),
      ext: o.ext || null, steps: clone(o.steps || []), stepIdx: 0, next: null,
      // stepsKind 'theme' = 手順を今の作業対象（案）から作り直す / 'ext' 'build' = 外の記録の決まった手順
      stepsKind: o.stepsKind || 'theme', candidate: !!o.candidate, baseVis: o.ext ? clone(o.ext.visible || []) : null,
      changes: [], shelf: [], thread: [],
      state: 'working', pauseCount: 0, declined: 0, offered: false, resumeNote: null, lastPause: null,
      clock: clock, seq: 0, draft: '', v: SCHEMA
    };
    return refreshSteps(a);
  }
  // 手順の名詞は今の作業対象から（§U-11 (a)）。候補状態から始めた活動は先頭に「案を選ぶ」
  function refreshSteps(A) {
    if (A.stepsKind !== 'theme') return A;
    var st = A.stage && A.stage.kind !== 'note' ? A.stage : null, th = MD.theme(st ? st.theme : A.theme);
    var variant = st ? st.variant : (A.candidate ? th.ideas[0] : th.sample);
    A.steps = (A.candidate ? [clone(MD.CANDIDATE_STEP)] : []).concat(MD.stepsFor(st ? st.theme : A.theme, variant));
    if (A.stepIdx > A.steps.length - 1) A.stepIdx = A.steps.length - 1;
    return A;
  }
  function pushMsg(a, m) { m.id = nid(a, 'm'); m.time = nowOf(a); a.thread.push(m); return m; }
  // 返事は作った時点の表示の文字列で持つ（§U-11 指摘 16。表示を切り替えても書き換えない）
  function say(a, r, mode, extra) {
    var m = { who: 'buddy', r: r, text: MD.pick(MD.replies[r], mode) };
    if (extra) Object.keys(extra).forEach(function (k) { m[k] = extra[k]; });
    return pushMsg(a, m);
  }
  function sampleDef(id) { for (var i = 0; i < MD.samples.length; i++) if (MD.samples[i].id === id) return MD.samples[i]; return null; }
  function stageOf(theme, variant, kind, values) {
    return { kind: kind || 'draft', theme: theme, variant: variant, values: values ? clone(values) : MD.variantValues(theme, variant) };
  }
  // 見本から（入口の「動かしてみる」）
  function fromSample(sampleId, o) {
    o = o || {};
    var s = sampleDef(sampleId) || MD.samples[0], th = MD.theme(s.theme);
    var a = newAct({ id: o.id, title: MD.pick(MD.variant(s.theme, s.variant).title, o.mode), origin: o.origin || 'sample', theme: s.theme,
      sampleId: s.id, catalogId: o.catalogId, stage: stageOf(s.theme, s.variant, 'sample'), now: o.now });
    say(a, 'open', o.mode);
    return a;
  }
  // 仮の案 3 つ（U-2）。作品のスクショの読み取りがあれば、題材の 1 枚に出所 1 行（design-v3 §6-10 (e)）
  function captureHook(works, theme) {
    var hit = null;
    (works || []).forEach(function (w) {
      if (hit || w.from !== 'capture' || w.theme !== theme || !w.read || w.read.declined || w.read.excluded || !w.read.text) return;
      hit = w;
    });
    return hit;
  }
  function addIdeas(a, theme, works) {
    var th = MD.theme(theme), batch = nid(a, 'b'), time = nowOf(a), hook = captureHook(works, theme), cards = [];
    th.ideas.forEach(function (v) {
      var c = { id: nid(a, 'k'), batch: batch, kind: 'draft', theme: theme, variant: v, values: MD.variantValues(theme, v), time: time, state: 'new' };
      if (hook && v === th.capIdea) { c.srcCapture = hook.id; c.srcTitle = hook.title; }
      cards.push(c);
    });
    a.shelf = cards.concat(a.shelf);
    return cards;
  }
  // 話す の bridge / 入口の「思いつきから」: 引用枠（本人の言葉）+ 棚に仮の案 3 つ
  function fromText(text, o) {
    o = o || {};
    var theme = pickTheme(text), th = MD.theme(theme);
    var a = newAct({ id: o.id, title: MD.pick(th.topic, o.mode), origin: o.origin || 'make', theme: theme, catalogId: o.catalogId,
      quote: text ? { text: String(text), removed: false } : null, candidate: true, now: o.now });
    addIdeas(a, theme, o.works);
    say(a, 'land', o.mode);
    return a;
  }
  // 入口の「写真を見せる」「リンクを貼る」: 作業対象 = 外の記録（モックの写真はダミーの線画）
  function fromExt(kind, o) {
    o = o || {};
    var th = MD.theme('mc');
    var a = newAct({ id: o.id, title: MD.pick(th.topic, o.mode), origin: o.origin || 'make', theme: 'mc', catalogId: o.catalogId,
      ext: { link: kind === 'link' ? 'Minecraft（リンクの体験例）' : null, photos: [], visible: [] }, steps: th.extSteps, stepsKind: 'ext', now: o.now });
    if (kind !== 'link') a = addPhoto(a, 'photo').act;
    return a;
  }

  // 今日のお題から（§X-2 / X-8）: お題の問い・最初の一歩・必要な物を引き継いだ活動（origin 'today'、odaiId 付き）。
  // 題材が §U-1 の 3 つなら theme 活動（見本の作業対象から）、それ以外は外で作って写真で記録する ext 活動（手順 = お題の makeSteps）。
  // 同じお題から作った活動があれば作らずにその id を返す。o: { id, mode, now, acts, question（自分の案にした問い）, recText（記録の 1 行。作った時点の表示の文字列） }
  // 戻り値: { id, act, created, changed }（changed = 既存の活動の問いを書き換えた）
  // 既存の活動: 問いが今のタイトルと違えば（元のお題の問いに戻す時も）タイトルを書き換える。本人の言葉として残すのは元の問いと違う時だけ
  function fromOdai(odai, o) {
    o = o || {};
    if (!odai || !odai.id) return null;
    var q = String(o.question == null ? '' : o.question).replace(/^\s+|\s+$/g, '');
    var own = !!q && !(Array.isArray(odai.title) && odai.title.indexOf(q) >= 0);
    var hit = null;
    (o.acts || []).forEach(function (x) { if (!hit && x && x.odaiId === odai.id) hit = x; });
    if (hit) {
      if (!q || hit.title === q) return { id: hit.id, act: hit, created: false, changed: false };
      var X = clone(hit);
      X.title = q;
      if (own) pushMsg(X, { who: 'child', text: q });
      return { id: X.id, act: X, created: false, changed: true };
    }
    var title = own ? q : MD.pick(odai.title, o.mode);
    var theme = MD.THEMES.indexOf(odai.makeTheme) >= 0 ? odai.makeTheme : null, a;
    if (theme) {
      var th = MD.theme(theme), variant = th.variants.indexOf(odai.makeVariant) >= 0 ? odai.makeVariant : th.sample;
      a = newAct({ id: o.id, title: title, origin: 'today', theme: theme, stage: stageOf(theme, variant, 'sample'), now: o.now });
    } else {
      var steps = Array.isArray(odai.makeSteps) && odai.makeSteps.length ? odai.makeSteps : MD.theme('mc').extSteps;
      // 題材は 'odai'（写真のダミー・任せる候補はお題から。3 題材の中身を出さない）
      a = newAct({ id: o.id, title: title, origin: 'today', theme: ODAI_THEME, ext: { link: null, photos: [], visible: [] }, steps: steps, stepsKind: 'ext', now: o.now });
    }
    a.odaiId = odai.id;
    pushMsg(a, { who: 'record', k: 'odai_rec', v: { q: odai.title, step: odai.firstStep, need: odai.need }, text: o.recText || null });
    if (own) pushMsg(a, { who: 'child', text: q });
    if (theme) say(a, 'open', o.mode);
    return { id: a.id, act: a, created: true, changed: false };
  }

  // ---------- 作業対象と変化 ----------
  // いま「確かめた」状態（最後の変化の写し。無ければ始めの状態）
  function committed(a) {
    for (var i = a.changes.length - 1; i >= 0; i--) if (a.changes[i].snap !== undefined) return a.changes[i].snap;
    return a.base;
  }
  function isDirty(a) { return !!a.stage && a.stage.kind !== 'note' && !same(a.stage, committed(a)); }
  function setParam(a, key, val) {
    if (!a.stage || a.stage.kind === 'note') return a;
    var p = MD.param(a.stage.theme, key);
    if (!p) return a;
    var v = Math.max(p.min, Math.min(p.max, Math.round(+val)));
    if (isNaN(v)) return a;
    var A = clone(a);
    A.stage.values[key] = v;
    return A;
  }
  function pairOf(theme, key, v) { return [MD.valueLabel(theme, key, v, 'js'), MD.valueLabel(theme, key, v, 'es')]; }
  // 何を変えたか（{ k, v } で持ち、描く時に読む）
  function whatDiff(theme, from, to) {
    var ps = MD.theme(theme).params, ch = [];
    ps.forEach(function (p) { if (!from || from[p.key] !== to[p.key]) ch.push(p); });
    if (!ch.length) return { k: 'test_same' };
    if (ch.length === 1) return { k: 'changed_one', v: { label: ch[0].label, value: pairOf(theme, ch[0].key, to[ch[0].key]) } };
    return { k: 'changed_two', v: { a: ch[0].label, av: pairOf(theme, ch[0].key, to[ch[0].key]), b: ch[1].label, bv: pairOf(theme, ch[1].key, to[ch[1].key]) } };
  }
  function firstChanged(theme, from, to) {
    var ps = MD.theme(theme).params;
    for (var i = 0; i < ps.length; i++) if (!from || from[ps[i].key] !== to[ps[i].key]) return ps[i];
    return null;
  }
  // 変化を 1 つ積む（積まれる瞬間は 4 つ: 試す / バディが置いた / 写真を足した / 戻した。design-v3 §6-6）
  function commitChange(a, ch) {
    var A = clone(a);
    ch = clone(ch);
    var photoLike = ch.kind === 'photo' || ch.kind === 'shot';
    ch.id = nid(A, 'c');
    ch.time = tick(A);
    ch.snap = clone(photoLike ? committed(A) : A.stage);
    ch.vis = A.ext ? clone(visibleIds(A)) : null;
    refreshSteps(A);
    if (ch.advance && A.stepIdx < A.steps.length - 1) A.stepIdx += 1;
    delete ch.advance;
    A.changes.push(ch);
    A.resumeNote = null;
    if (A.state === 'paused' || A.state === 'closed' || A.state === 'stopped') A.state = 'working';
    return { act: A, change: ch };
  }
  // 外の記録で今見えている写真（戻すと隠れる。記録は消さない）。古い保存データは全部見えている扱い
  function visibleIds(a) {
    if (!a.ext) return [];
    return a.ext.visible ? a.ext.visible : a.ext.photos.map(function (p) { return p.id; });
  }
  function visiblePhotos(a) {
    var ids = visibleIds(a);
    return a.ext ? a.ext.photos.filter(function (p) { return ids.indexOf(p.id) >= 0; }) : [];
  }
  // 戻す先の状態 = 作業対象 + 見えている写真
  function curState(a) { return { stage: a.stage, vis: a.ext ? visibleIds(a) : null }; }
  function chState(a, ch) { return { stage: ch.snap, vis: ch.vis === undefined ? (a.ext ? visibleIds(a) : null) : ch.vis }; }
  function baseState(a) { return { stage: a.base, vis: a.baseVis === undefined ? (a.ext ? visibleIds(a) : null) : a.baseVis }; }
  // 試す（本人）: 値を変えていれば「{label}を {value} にした」。変えずに 2 回目以降は積まない
  function test(a) {
    if (!a.stage || a.stage.kind === 'note') return null;
    var from = committed(a), changed = !from || !same(from.values, a.stage.values) || from.variant !== a.stage.variant;
    // 積まないのは「直前の変化がもう試す」で値も変えていない時だけ。採用・戻した・写真の後の試すは必ず積む（§U-11 指摘 2）
    var last = a.changes[a.changes.length - 1];
    if (!changed && last && last.kind === 'test') return { act: a, change: null, same: true };
    var p = changed ? firstChanged(a.stage.theme, from && from.values, a.stage.values) : null;
    var res = commitChange(a, { who: 'own', kind: 'test', what: changed ? whatDiff(a.stage.theme, from && from.values, a.stage.values) : { k: 'test_same' }, res: true, advance: changed });
    return { act: res.act, change: res.change, param: p ? p.label : null, key: p ? p.key : null, from: p && from ? from.values[p.key] : null, same: false };
  }
  // 戻す: changeId 無し = 前に戻す（直前に積まれたものへ。試していない値があれば、最後に確かめたところへ）
  function revert(a, changeId) {
    var chs = a.changes, target, time;
    if (changeId === '@base') {
      target = baseState(a); time = a.baseTime;
    } else if (changeId) {
      var t = find(chs, changeId);
      if (!t) return null;
      target = chState(a, t); time = t.time;
    } else if (isDirty(a)) {
      if (chs.length) { target = chState(a, chs[chs.length - 1]); time = chs[chs.length - 1].time; } else { target = baseState(a); time = a.baseTime; }
    } else {
      if (!chs.length) return null;
      if (chs.length >= 2) { target = chState(a, chs[chs.length - 2]); time = chs[chs.length - 2].time; } else { target = baseState(a); time = a.baseTime; }
    }
    return restoreState(a, target, time);
  }
  // 状態（作業対象 + 見えている写真）へ戻し、「{time} のところに戻した」を変化として積む。今と同じなら null
  // 写真の無い時点（vis が null）へ戻したら、後から足した写真は見えなくする（§U-12 補足 1。記録は消さない）
  function restoreState(a, target, time) {
    if (!target || target.stage === undefined) return null;
    var want = { stage: target.stage, vis: a.ext ? (target.vis || []) : null };
    if (same(want, curState(a))) return null;
    var before = clone(curState(a)), A = clone(a);
    A.stage = clone(want.stage);
    if (A.ext) A.ext.visible = clone(want.vis);
    var res = commitChange(A, { who: 'own', kind: 'revert', what: { k: 'reverted_rec', v: { time: time } } });
    return { act: res.act, change: res.change, undo: { type: 'revert', changeId: res.change.id, stage: before.stage, vis: before.vis } };
  }
  function canRevert(a) { return !!revert(a, null); }
  // 変化の行の「ここに戻す」: 写真だけの履歴でも、今と違えば出す（§U-12 指摘 5）
  function canRevertTo(a, changeId) { return !!revert(a, changeId); }
  // 前に戻す の取り消し（5 秒）: 取り消した操作は積まれていなかったことにする
  function undoRevert(a, u) {
    var A = clone(a), last = A.changes[A.changes.length - 1];
    if (!last || last.id !== u.changeId) return A;
    A.changes.pop();
    A.stage = clone(u.stage);
    if (A.ext && u.vis) A.ext.visible = clone(u.vis);
    return A;
  }

  // ---------- バディに任せる / 棚（design-v3 §6-4 / §6-9） ----------
  function cardStage(c) {
    if (!c) return null;
    if (c.kind === 'note') return { kind: 'note', theme: c.theme, title: c.title, lines: c.lines, opt: c.opt || null, alt: !!c.alt };
    return { kind: c.kind === 'value' ? (c.baseKind || 'draft') : 'draft', theme: c.theme, variant: c.variant, values: clone(c.values) };
  }
  // 任せる時の土台: 作業対象（見本・試作）→ 棚の最新の案 → 題材の最初の案
  function baseStage(a) {
    if (a.stage && a.stage.kind !== 'note') return { stage: a.stage, fromStage: true };
    for (var i = 0; i < a.shelf.length; i++) {
      var c = a.shelf[i];
      if (c.kind !== 'note' && c.state !== 'making' && c.state !== 'passed') return { stage: cardStage(c), fromStage: false };
    }
    var th = MD.theme(a.theme);
    return { stage: stageOf(a.theme, th.ideas[0], 'draft'), fromStage: false };
  }
  // 今日のお題から作った外で作る活動（theme 'odai'）: 任せる候補は 手順を整理して / 必要な物をまとめて（お題の makeSteps / 必要な物から）。
  // 「どこが違う？」の材料・色 は必要な物、それ以外は手順。言葉で頼む も手順
  var ODAI_THEME = 'odai', ODAI_OPTS = ['osteps', 'oneed'], ODAI_ASPECT = ['osteps', 'osteps', 'oneed', 'osteps', 'osteps'];
  function isOdaiExt(a) { return !!(a && a.theme === ODAI_THEME); }
  function odaiDef(a) { var K = DES.todayData; return K && a && a.odaiId ? K.get(a.odaiId) : null; }
  // メモの中身: お題のデータから（today-data.js の leaveNote）。データが無い時は活動の手順だけ
  function odaiNote(a, opt, alt) {
    var K = DES.todayData, od = odaiDef(a);
    if (od && K.leaveNote) return K.leaveNote(od, opt, alt);
    if (opt !== 'osteps' || !a.steps.length) return null;
    return { title: ['作り方の手順', 'つくりかたの手じゅん'], lines: a.steps.map(function (s, i) { return [(i + 1) + '. ' + s[0], (i + 1) + '. ' + s[1]]; }) };
  }
  function leaveOdai(a, opt, o) {
    o = o || {};
    if (opt === 'aspect') opt = ODAI_ASPECT[Math.max(0, Math.min(4, o.aspect | 0))];
    if (ODAI_OPTS.indexOf(opt) < 0) return { act: a, ids: [] };
    var A = clone(a), card = o.card ? find(A.shelf, o.card) : null;
    // 同じ種類のメモを作り直す時は、もう一方の形にする（§U-11 指摘 13 と同じ）
    var alt = !!(card && card.kind === 'note' && card.opt === opt && !card.alt), n = odaiNote(A, opt, alt);
    if (!n) return { act: a, ids: [] };
    var spec = { kind: 'note', theme: ODAI_THEME, title: clone(n.title), lines: clone(n.lines), opt: opt, alt: alt };
    spec.batch = nid(A, 'b'); spec.time = tick(A, 1); spec.id = nid(A, 'k'); spec.state = 'making';
    A.shelf = [spec].concat(A.shelf);
    return { act: A, ids: [spec.id], opt: opt };
  }
  function remakeOptions(a, c) {
    if (isOdaiExt(a)) return ODAI_OPTS.slice();
    return c && c.kind === 'note' ? ['calc', 'steps', 'cmd'] : ['redo', 'two', 'fix'];
  }
  function leaveOptions(a) {
    if (isOdaiExt(a)) return ODAI_OPTS.slice();
    if (a.stage && a.stage.kind === 'sample') return ['find', 'one'];
    if (a.stage && a.stage.kind === 'draft') return ['redo', 'two', 'fix'];
    if (a.ext) return ['calc', 'steps', 'cmd'];
    return ['redo', 'two', 'fix'];
  }
  var OPT_KEY = { find: ['leave_opts_sample', 0], one: ['leave_opts_sample', 1], redo: ['leave_opts_draft', 0], two: ['leave_opts_draft', 1], fix: ['leave_opts_draft', 2],
    calc: ['leave_opts_ext', 0], steps: ['leave_opts_ext', 1], cmd: ['leave_opts_ext', 2], osteps: ['leave_opts_odai', 0], oneed: ['leave_opts_odai', 1] };
  M.OPT_KEY = OPT_KEY;
  // 「どこが違う？」の候補（形 / 大きさ / 材料・色 / 動き / それ以外）→ 作り直しの種類
  var ASPECT_OPT = ['redo', 'one', 'fix', 'one', 'redo'];
  function bump(theme, values, n) {
    var ps = MD.theme(theme).params, p = ps[Math.min(n, ps.length - 1)], out = clone(values);
    out[p.key] = values[p.key] + 1 > p.max ? p.min : values[p.key] + 1;
    return out;
  }
  function nextVariant(theme, v, k) {
    var ideas = MD.theme(theme).ideas, i = ideas.indexOf(v);
    return ideas[((i < 0 ? -1 : i) + (k || 1) + ideas.length * 2) % ideas.length];
  }
  function specsFor(a, opt, base) {
    var st = base.stage, th = MD.theme(st.theme), valueKind = base.fromStage, specs = [];
    function valueCard(values) {
      if (valueKind) return { kind: 'value', baseKind: st.kind, theme: st.theme, variant: st.variant, values: values, what: whatDiff(st.theme, st.values, values) };
      return { kind: 'draft', theme: st.theme, variant: st.variant, values: values };
    }
    if (opt === 'find') specs.push(valueCard(clone(same(th.find[0], st.values) ? th.find[1] : th.find[0])));
    else if (opt === 'one') specs.push(valueCard(bump(st.theme, st.values, 0)));
    else if (opt === 'fix') specs.push(valueCard(bump(st.theme, st.values, 1)));
    else if (opt === 'redo') { var nv = nextVariant(st.theme, st.variant, 1); specs.push({ kind: 'draft', theme: st.theme, variant: nv, values: MD.variantValues(st.theme, nv) }); }
    else if (opt === 'two') {
      var others = th.ideas.filter(function (v) { return v !== st.variant; }).slice(0, 2);
      others.forEach(function (v) { specs.push({ kind: 'draft', theme: st.theme, variant: v, values: MD.variantValues(st.theme, v) }); });
    } else if (opt === 'calc' || opt === 'steps') {
      var n = MD.extCards[a.theme] && MD.extCards[a.theme][opt];
      // メモを同じ種類で作り直す時は、もう一方の版にする（§U-11 指摘 13）
      var alt = !!(n && n.alt && st.kind === 'note' && st.opt === opt && !st.alt);
      var src = alt ? n.alt : n;
      if (n) specs.push({ kind: 'note', theme: a.theme, title: clone(src.title), lines: clone(src.lines), opt: opt, alt: alt });
    } else if (opt === 'cmd') {
      var c = MD.extCards[a.theme] && MD.extCards[a.theme].cmd;
      if (c) specs.push({ kind: 'draft', theme: a.theme, variant: c.variant, values: clone(c.values) });
    }
    return specs;
  }
  // 任せる（作っている の破線カードを置く。中身は settle で決まる）
  function leave(a, opt, o) {
    o = o || {};
    if (isOdaiExt(a)) return leaveOdai(a, opt, o);
    if (opt === 'aspect') opt = ASPECT_OPT[Math.max(0, Math.min(4, o.aspect | 0))];
    var A = clone(a), base = o.card ? { stage: cardStage(find(A.shelf, o.card)), fromStage: false } : baseStage(A);
    if (!base.stage || (base.stage.kind === 'note' && opt !== 'calc' && opt !== 'steps' && opt !== 'cmd')) base = baseStage(A);
    var specs = specsFor(A, opt, base);
    if (!specs.length) return { act: a, ids: [] };
    var batch = nid(A, 'b'), time = tick(A, 1), ids = [];
    specs.forEach(function (s) { s.id = nid(A, 'k'); s.batch = batch; s.time = time; s.state = 'making'; ids.push(s.id); });
    A.shelf = specs.concat(A.shelf);
    return { act: A, ids: ids, opt: opt };
  }
  function remake(a, cardId, opt) {
    if (!find(a.shelf, cardId)) return { act: a, ids: [] };
    return leave(a, opt, { card: cardId });
  }
  function settle(a, ids) {
    var A = clone(a);
    A.shelf.forEach(function (c) { if (c.state === 'making' && (!ids || ids.indexOf(c.id) >= 0)) c.state = 'new'; });
    return A;
  }
  function cancelMaking(a, cardId) {
    var A = clone(a);
    A.shelf = A.shelf.filter(function (c) { return !(c.id === cardId && c.state === 'making'); });
    return A;
  }
  function cardTitle(c) { return c.kind === 'note' ? c.title : MD.variant(c.theme, c.variant).title; }
  // これにする: 作業対象に取り込み、変化 +1（バディ）。同じ回に出た他の案は「見送った案」へ
  function adopt(a, cardId) {
    var A = clone(a), c = find(A.shelf, cardId);
    if (!c || c.state === 'making') return null;
    var wasPassed = c.state === 'passed';
    A.stage = cardStage(c);
    if (A.stage.kind === 'draft' || A.stage.kind === 'sample') A.theme = A.stage.theme;
    c.state = 'adopted';
    if (!wasPassed) A.shelf.forEach(function (x) { if (x.batch === c.batch && x.id !== c.id && x.state === 'new') x.state = 'passed'; });
    var what = c.kind === 'value' ? { k: 'left_rec', v: { what: c.what } } : { k: 'adopt_rec', v: { what: cardTitle(c) } };
    return commitChange(A, { who: 'ai', kind: 'adopt', what: what, cardId: c.id, advance: true });
  }
  // 違う（棚のカード）: 見送った案へ畳む。5 秒は戻せる
  function decline(a, cardId) {
    var A = clone(a), c = find(A.shelf, cardId);
    if (!c || c.state === 'making' || c.state === 'passed') return null;
    var prev = c.state;
    c.state = 'passed';
    return { act: A, undo: { type: 'decline', cardId: cardId, prev: prev }, capture: c.srcCapture || null };
  }
  function undoDecline(a, u) {
    var A = clone(a), c = find(A.shelf, u.cardId);
    if (c && c.state === 'passed') c.state = u.prev;
    return A;
  }

  // ---------- 外の記録（写真・スクショ） ----------
  function addPhoto(a, kind) {
    var A = clone(a);
    if (!A.ext) A.ext = { link: null, photos: [], visible: [] };
    var last = A.ext.photos[A.ext.photos.length - 1];
    // お題の活動の写真はそのお題の線画（ダミー 3 枚を順に。theme 'odai' + odai）
    var odai = isOdaiExt(A), cnt = odai && DES.todayData ? DES.todayData.photoCount(A.odaiId) : (odai ? 3 : MD.PHOTO_COUNT);
    var n = last ? (last.n + 1) % cnt : 0;
    var ph = { id: nid(A, 'ph'), theme: odai ? ODAI_THEME : (last ? last.theme : A.theme), n: n, kind: kind === 'shot' ? 'shot' : 'photo', time: nowOf(A) };
    if (odai) ph.odai = A.odaiId;
    A.ext.visible = visibleIds(A).concat([ph.id]);
    A.ext.photos.push(ph);
    var res = commitChange(A, { who: 'own', kind: ph.kind, what: { k: ph.kind === 'shot' ? 'added_shot' : 'added_photo' }, photoId: ph.id, advance: true });
    res.act.ext.photos[res.act.ext.photos.length - 1].time = res.change.time;
    return { act: res.act, change: res.change, photo: ph };
  }
  // 「何を変えた？」（候補 5 つ + 任意の 1 行。確定 Q5）。1 行があれば本人の言葉で、無ければ候補で
  function describePhoto(a, changeId, aspect, line) {
    var A = clone(a), ch = find(A.changes, changeId);
    if (!ch) return { act: a, what: null };
    var text = String(line || '').replace(/^\s+|\s+$/g, ''), what = null;
    var opts = ['形', '大きさ', '材料・色', '動き', 'それ以外'];
    var optsEs = ['形', '大きさ', 'ざいりょう・色', '動き', 'それ以外'];
    if (text) what = { text: text };
    else if (aspect != null && aspect >= 0 && aspect < 4) what = { k: 'changed_aspect', v: { what: [opts[aspect], optsEs[aspect]] } };
    if (what) ch.what = what;
    if (aspect != null) ch.aspect = aspect;
    return { act: A, what: what };
  }

  // ---------- 今の一歩・区切り・背中押し（design-v3 §6-5 / §6-8、U-5） ----------
  function stepNow(a) { return a.steps[a.stepIdx] || null; }
  // 次: 本人が書いた文（空にしたら空のまま。§U-11 指摘 7）→ 無ければ手順の次の一歩
  // 今と同じ文は次に出さない（§U-12 (e)）
  function stepNext(a) {
    var nx = a.next != null ? (a.next ? { text: a.next } : null) : (a.steps[a.stepIdx + 1] || null), now = stepNow(a);
    if (nx && now && nx.text != null && (nx.text === now[0] || nx.text === now[1])) return null;
    return nx;
  }
  function lastChild(a) {
    for (var i = a.thread.length - 1; i >= 0; i--) if (a.thread[i].who === 'child') return a.thread[i].text || '';
    return '';
  }
  function lastWhat(a) { var c = a.changes[a.changes.length - 1]; return c ? c.what : { k: 'opened_stage' }; }
  // 背中押しの選び方（決定論 3 ケース）。最終決定は本人。押した・断った回数は画面に出さない
  // 戻り値: { kind: 'step'|'next'|'accept', key, vars, step }
  function pause(a) {
    var said = lastChild(a), step = stepNow(a);
    var accept = { kind: 'accept', key: 'accept_msg', vars: { last: { k: 'tokoro', v: { what: lastWhat(a) } } }, step: null };
    // (3) 同じ活動で今日 2 回目 / 直前に断っている / 休みたい旨 → 受け止めるだけ
    if (a.pauseCount >= 1 || a.declined > 0 || hasAny(said, REST)) return accept;
    // (2) 疲れ・めんどくさい → 受け止めて次回へ（次にすることに一歩を書く）
    if (hasAny(said, TIRED) && step) return { kind: 'next', key: 'push_next_msg', vars: { step: { k: 'tokoro', v: { what: step } } }, step: step };
    // (1) 今の一歩が残り 1 つ + 直前に「試す」で結果あり → 一歩を 1 つ
    var last = a.changes[a.changes.length - 1];
    if (step && a.stepIdx >= a.steps.length - 1 && last && last.kind === 'test' && last.res && last.who === 'own') {
      return { kind: 'step', key: 'push_step_msg', vars: { step: step, min: MD.STEP_MIN }, step: step };
    }
    return accept;
  }
  // 今日はここまで（確定）。o: { next: string, closed: bool, push: pause の戻り値 }
  function confirmPause(a, o) {
    o = o || {};
    var A = clone(a), next = String(o.next == null ? '' : o.next).replace(/^\s+|\s+$/g, '');
    A.state = o.closed ? 'closed' : 'paused';
    A.pauseCount += 1;
    if (o.push && o.push.kind === 'step') { A.declined += 1; A.offered = true; } else A.offered = false;
    A.next = next;
    A.resumeNote = next ? { k: 'resume_push', v: { step: { k: 'tokoro', v: { what: { text: next } } } } } : null;
    A.lastPause = o.push ? clone(o.push) : null;
    return A;
  }
  // 「{一歩}だけやってみる」: 作業中に戻る（変化は積まれない）。#paused から押した時は断った数を戻す
  function takeStep(a, fromPaused) {
    var A = clone(a);
    A.state = 'working';
    // 区切った回数（pauseCount）は残す: 次の「今日はここまで」は今日 2 回目として受け止めるだけにする
    if (fromPaused && A.offered && A.declined > 0) A.declined -= 1;
    A.offered = false;
    A.resumeNote = null;
    return A;
  }
  // 再開（止めた・一区切り・やめた → 作業中。§U-11 指摘 6）
  function resume(a) {
    var A = clone(a);
    if (A.state === 'paused' || A.state === 'closed' || A.state === 'stopped') A.state = 'working';
    return A;
  }
  // 作品の「続きを作る」: 残した時点（at）を新しい変化として開く（§U-11 指摘 5）。今と同じなら積まない
  // 保存時点の id が無い作品（未試行で残した等）は、作品が持つ状態 snap へ戻す（§U-12 指摘 4）
  function reopenAt(a, at, snap, time) {
    var A = resume(a);
    var r = at && find(A.changes, at) ? revert(A, at) : (snap ? restoreState(A, snap, time || A.baseTime) : null);
    return r ? { act: r.act, change: r.change } : { act: A, change: null };
  }
  function stop(a, o) {
    var A = clone(a), prev = A.state;
    A.state = 'stopped';
    pushMsg(A, o && o.text ? { who: 'record', k: 'stopped_rec', text: o.text } : { who: 'record', k: 'stopped_rec' });
    return { act: A, undo: { type: 'stop', prev: prev, msg: A.thread[A.thread.length - 1].id } };
  }
  function undoStop(a, u) {
    var A = clone(a);
    A.state = u.prev;
    A.thread = A.thread.filter(function (m) { return m.id !== u.msg; });
    return A;
  }
  // 相談列への返事の種類（composer 送信）: 疲れ → 受け止め / 頼みごと → 任せる / それ以外 → 情報が足りない
  function replyKind(a, text, freeReq) {
    if (hasAny(text, TIRED) || hasAny(text, REST)) return 'accept';
    if (freeReq || REQUEST.test(String(text || ''))) return 'request';
    return 'unknown';
  }
  function requestOpt(a) {
    if (isOdaiExt(a)) return 'osteps';
    if (a.stage && a.stage.kind === 'sample') return 'one';
    if (a.stage && a.stage.kind === 'draft') return 'fix';
    if (a.ext) return 'cmd';
    return 'redo';
  }

  // ---------- 引用枠（直す / 外す）・見本の取り込み ----------
  function editQuote(a, text, works, mode) {
    var A = clone(a), t = String(text || '').replace(/^\s+|\s+$/g, '');
    if (!t || !A.quote) return { act: a, changed: false };
    if (A.quote.text === t) return { act: a, changed: false };
    A.quote = { text: t, removed: false };
    A.shelf.forEach(function (c) { if (c.state === 'new') c.state = 'passed'; });
    var theme = pickTheme(t);
    A.theme = theme;
    tick(A, 1);
    addIdeas(A, theme, works);
    // 題材が変わったら手順も新しい題材に（§U-11 指摘 8）。作業対象がまだ無ければ候補状態の手順から
    if (A.stepsKind === 'theme' && !A.stage) { A.candidate = true; A.stepIdx = 0; refreshSteps(A); }
    say(A, 'land', mode);
    return { act: A, changed: true };
  }
  function removeQuote(a) {
    if (!a.quote || a.quote.removed) return null;
    var A = clone(a), prev = {};
    A.quote.removed = true;
    A.shelf.forEach(function (c) { if (c.state === 'new') { prev[c.id] = c.state; c.state = 'passed'; } });
    return { act: A, undo: { type: 'quote', prev: prev } };
  }
  function undoRemoveQuote(a, u) {
    var A = clone(a);
    if (A.quote) A.quote.removed = false;
    A.shelf.forEach(function (c) { if (u.prev[c.id] && c.state === 'passed') c.state = u.prev[c.id]; });
    return A;
  }
  // 空の作業対象に見本を置く（意図を外した時・候補状態の「見本を見る」）
  function pickSample(a, sampleId, mode) {
    var s = sampleDef(sampleId);
    if (!s) return a;
    var A = clone(a);
    A.stage = stageOf(s.theme, s.variant, 'sample');
    A.theme = s.theme; A.sampleId = s.id;
    if (A.stepsKind === 'theme') { A.candidate = false; if (!A.changes.length) A.stepIdx = 0; refreshSteps(A); }
    if (!A.changes.length) A.base = clone(A.stage);
    say(A, 'open', mode);
    return A;
  }
  function setNext(a, text) {
    var A = clone(a), t = String(text == null ? '' : text).replace(/^\s+|\s+$/g, '');
    A.next = t;
    return A;
  }
  function setTitle(a, text) {
    var t = String(text || '').replace(/^\s+|\s+$/g, '');
    if (!t || t === a.title) return a;
    var A = clone(a);
    A.title = t;
    return A;
  }

  // ---------- 作品 ----------
  // 誰が何をした（自動・編集不可）。upto までの変化を数える
  function roles(a, uptoId) {
    var out = { own: 0, ai: 0, people: [], lines: [] }, ppl = {};
    for (var i = 0; i < a.changes.length; i++) {
      var c = a.changes[i];
      if (c.who === 'ai') out.ai += 1; else out.own += 1;
      if (c.with) { if (!ppl[c.with]) { ppl[c.with] = { name: c.with, n: 0 }; out.people.push(ppl[c.with]); } ppl[c.with].n += 1; }
      out.lines.push({ who: c.who, with: c.with || null, what: clone(c.what) });
      if (uptoId && c.id === uptoId) break;
    }
    return out;
  }
  // 作品に残す（活動は閉じない）。o: { id, at, title, like, date }
  // 「今」で残す時、まだ試していない値があれば、保存の前に変化として積む（本人・結果はまだ確かめていない。§U-12 補足 4）
  function withPending(a) {
    if (!isDirty(a)) return a;
    var from = committed(a);
    return commitChange(a, { who: 'own', kind: 'set', what: whatDiff(a.stage.theme, from && from.values, a.stage.values) }).act;
  }
  // 完成 / 試作（§W-1）。作るの「作品に残す」の既定: 活動の手順が最後まで進んでいれば完成、それ以外は試作
  var STATUS = ['done', 'trial'];
  function defaultStatus(a) {
    var n = a && a.steps ? a.steps.length : 0;
    return n > 0 && a.stepIdx >= n - 1 ? 'done' : 'trial';
  }
  function pickStatus(v, def) { return STATUS.indexOf(v) >= 0 ? v : def; }
  function saveWork(works, a, o) {
    o = o || {};
    var status = pickStatus(o.status, defaultStatus(a));
    if (!o.at) a = withPending(a);
    var k = o.at ? idx(a.changes, o.at) : a.changes.length - 1;
    var ch = k >= 0 ? a.changes[k] : null, snap = ch ? ch.snap : a.stage, photo = null;
    // 写真はその時点で見えていた最後の 1 枚（戻した後なら戻した先の写真。§U-12 回帰 1）
    var st = ch ? chState(a, ch) : curState(a), ids = st.vis || [];
    if (a.ext && ids.length) photo = find(a.ext.photos, ids[ids.length - 1]);
    // メモを残した時は本文を持つ（§U-11 指摘 14）
    var art = snap && snap.kind === 'note' ? { note: { title: clone(snap.title), lines: clone(snap.lines) } }
      : (snap ? { stage: clone(snap) } : (photo ? { photo: clone(photo) } : null));
    var title = String(o.title || '').replace(/^\s+|\s+$/g, '') || a.title;
    var like = String(o.like || '').replace(/^\s+|\s+$/g, '');
    var work = { id: o.id, actId: a.id, at: ch ? ch.id : null, atTime: ch ? ch.time : null, title: title, like: like || null, from: 'make',
      theme: a.theme, art: art, roles: roles(a, ch ? ch.id : null), date: o.date || null, snap: clone(st), snapTime: ch ? ch.time : nowOf(a),
      status: status, craft: null, shares: [] };
    return { works: [work].concat(works || []), work: work, act: a };
  }
  // 保存済みの作品に §W の欄を補う（§W-5）: status 無し → done、craft 無し → null、shares 無し → []。補うだけで消さない
  function normalizeWorks(works) {
    return (works || []).map(function (w) {
      if (!w || typeof w !== 'object') return w;
      var okS = STATUS.indexOf(w.status) >= 0, okC = w.craft === null || typeof w.craft === 'string', okSh = Array.isArray(w.shares);
      if (okS && okC && okSh) return w;
      var W = clone(w);
      if (!okS) W.status = 'done';
      if (!okC) W.craft = w.craft == null ? null : String(w.craft);
      if (!okSh) W.shares = [];
      return W;
    });
  }
  // 前の版の作品（at / snap が無い）の移行（§U-12 補足 2）: 保存時刻以前で最後の変化を at に、その変化の状態を snap に。
  // 保存時刻は 残した時点の時刻、キャプチャーなら活動の最初の変化（入れた時）。該当する変化が無ければ活動の最初の状態
  function migrateWork(w, acts) {
    if (!w || w.snap) return w;
    var a = find(acts, w.actId);
    if (!a) return w;
    var W = clone(w), at = W.at ? find(a.changes, W.at) : null;
    if (!at) {
      var t = W.atTime || W.snapTime || (W.from === 'capture' && a.changes.length ? a.changes[0].time : null);
      if (t) a.changes.forEach(function (c) { if (toMin(c.time) <= toMin(t)) at = c; });
    }
    if (at) { W.at = at.id; W.atTime = at.time; W.snap = clone(chState(a, at)); }
    else { W.at = null; W.snap = clone(baseState(a)); W.snapTime = a.baseTime; }
    return W;
  }
  // 作品に写真・スクショを入れる → 作品 +1 と、外の記録を持つ活動 +1（design-v3 §6-10）
  // o: { workId, actId, images:[captureId], title, made, madeLine, catalogId, read:{ text, edited, declined }, now, date, mode }
  function addCapture(acts, works, o) {
    o = o || {};
    var caps = (o.images || []).map(MD.capture).filter(Boolean).slice(0, 3);
    if (!caps.length) return null;
    var theme = caps[0].theme, th = MD.theme(theme);
    var title = String(o.title || '').replace(/^\s+|\s+$/g, '') || MD.pick(caps[0].title, o.mode);
    var a = newAct({ id: o.actId, title: title, origin: 'works', theme: theme, catalogId: o.catalogId || null, steps: th.extSteps, stepsKind: 'ext', now: o.now });
    a.ext = { link: null, photos: [], visible: [] };
    a.baseVis = [];
    var line = String(o.madeLine || '').replace(/^\s+|\s+$/g, '');
    // 写真 1 枚 = 変化 1 つ（本人）。1 行は最初の 1 枚に付ける（§U-11 指摘 15）
    caps.forEach(function (c, i) {
      var ph = { id: nid(a, 'ph'), theme: c.theme, n: c.n, kind: 'photo', time: nowOf(a) };
      a.ext.photos.push(ph);
      a.ext.visible = a.ext.visible.concat([ph.id]);
      a = commitChange(a, { who: 'own', kind: 'photo', what: i === 0 && line ? { text: line } : { k: 'added_photo' }, photoId: ph.id, advance: i === 0 }).act;
    });
    var read = o.read ? clone(o.read) : { text: null, edited: false, declined: true };
    if (read.text && !read.declined) pushMsg(a, { who: 'buddy', text: read.text, src: 'read' });
    var work = { id: o.workId, actId: a.id, from: 'capture', title: title, images: caps.map(function (c) { return c.id; }), read: read,
      made: o.made == null ? null : o.made, madeLine: line || null, catalogId: o.catalogId || null, theme: theme,
      art: { photo: clone(a.ext.photos[0]) }, roles: roles(a), date: o.date || null, like: null,
      at: a.changes[a.changes.length - 1].id, atTime: a.changes[a.changes.length - 1].time, snap: clone(curState(a)),
      // 写真から入れる作品の既定は完成（外で作ったものを撮る想定。§W-1）
      status: pickStatus(o.status, 'done'), craft: null, shares: [] };
    return { activities: [a].concat(acts || []), works: [work].concat(works || []), work: work, act: a };
  }

  // ---------- 決定論のデモ（render / check 用。#make/demo-* で開くと同じものが作られる） ----------
  function demo(id, o) {
    o = o || {};
    var base = { id: id, now: o.now || '10:20', mode: o.mode, works: o.works };
    if (id === 'demo-mc' || id === 'demo-py' || id === 'demo-circuit') return fromSample(id.slice(5), base);
    if (id === 'demo-cand') { base.origin = 'talk'; return fromText('Python のゲーム作りやってみたい', base); }
    if (id === 'demo-full') {
      var a = fromSample('mc', base), r;
      a = setParam(a, 'size', 6); r = test(a); a = r.act;
      pushMsg(a, { who: 'buddy', r: 'test', text: MD.testReply(a.stage, r.key, r.from, o.mode), change: r.change.id });
      a = setParam(a, 'block', 1); r = test(a); a = r.act;
      pushMsg(a, { who: 'child', text: 'もう少し大きくしたい' });
      r = leave(a, 'one'); a = settle(r.act, r.ids);
      var name = cardNames(a.shelf, o.mode)[r.ids[0]], ad = adopt(a, r.ids[0]);
      a = ad.act;
      // 画面の「これにする」と同じ 1 文（i18n の adopt_reply_pre と同じ形）
      pushMsg(a, { who: 'buddy', r: 'left', text: '「' + name + '」にしたよ。' + MD.pick(MD.replies.left, o.mode), change: ad.change.id });
      r = leave(a, 'find'); a = settle(r.act, r.ids);
      return a;
    }
    return null;
  }
  // 相談の返事の「違う」が戻すもの（§U-11 指摘 9）: 返事に紐づく変化の 1 つ前へ / 紐づく新しいカードは見送る
  function replyTarget(a, m) {
    var out = { revertTo: null, cards: [] };
    if (m && m.change) { var k = idx(a.changes, m.change); if (k >= 0) out.revertTo = k > 0 ? a.changes[k - 1].id : '@base'; }
    if (m && m.cards) out.cards = m.cards.filter(function (id) { var c = find(a.shelf, id); return c && c.state === 'new'; });
    return out;
  }
  function findMsg(a, id) { return find(a.thread, id); }
  // 相談の返事の「違う」: 紐づく変更を戻し、紐づく新しいカードは見送り、返事に使った印を付ける。undo で 3 つとも戻す（§U-12 回帰 3）
  function declineReply(a, msgId) {
    var m = findMsg(a, msgId) || {}, tg = replyTarget(a, m), x = clone(a), passed = [];
    tg.cards.forEach(function (id) { var d = decline(x, id); if (d) { x = d.act; passed.push(id); } });
    var r = tg.revertTo ? revert(x, tg.revertTo) : null;
    if (r) x = r.act;
    var mm = findMsg(x, msgId);
    if (mm) mm.declined = true;
    return { act: x, change: r ? r.change : null, passed: passed, undo: { revert: r ? r.undo : null, passed: passed, msg: msgId } };
  }
  function undoDeclineReply(a, u) {
    var y = clone(a);
    if (u.revert) y = undoRevert(y, u.revert);
    u.passed.forEach(function (id) { y = undoDecline(y, { cardId: id, prev: 'new' }); });
    var m = findMsg(y, u.msg);
    if (m) delete m.declined;
    if (u.prompt) y.thread = y.thread.filter(function (x) { return x.id !== u.prompt; });
    return y;
  }
  // 前の版の活動の移行（§U-12 指摘 6）。消して作り直さず、不足欄だけを補う。resolve(m) は返事の文を作る（今の表示で）
  // お題から作った外で作る活動は題材 'odai'（修正前の branch で theme 'mc' のまま保存された活動を直す。Astra 再レビュー）
  function fixOdaiTheme(a) {
    if (!a || !a.odaiId || a.stepsKind !== 'ext' || a.theme === ODAI_THEME) return a;
    var A = clone(a);
    A.theme = ODAI_THEME;
    if (A.ext && A.ext.photos) A.ext.photos.forEach(function (p) { p.theme = ODAI_THEME; });
    return A;
  }
  function migrate(a, resolve) {
    a = fixOdaiTheme(a);
    if (a && a.v >= SCHEMA) return a;
    var A = clone(a);
    // 作業対象の主の種類で決める（§U-12 補足 3）: 見本・バディの試作なら theme（写真があっても）、外の記録だけなら ext / build
    if (!A.stepsKind || (A.v || 0) < 3) {
      var build = A.id === 'act-build' || same(A.steps, MD.EXT_BUILD_STEPS);
      var mainStage = A.stage && (A.stage.kind === 'sample' || A.stage.kind === 'draft');
      A.stepsKind = mainStage || !A.ext ? 'theme' : (build ? 'build' : 'ext');
    }
    if (A.candidate === undefined) A.candidate = !!(A.steps && A.steps[0] && same(A.steps[0], MD.CANDIDATE_STEP));
    if (A.ext) {
      var ref = {}, order = A.ext.photos.map(function (p) { return p.id; });
      A.changes.forEach(function (c) { if (c.photoId) ref[c.photoId] = true; });
      // 変化に紐づかない写真は最初から見えていた扱い。並びは写真の並び順
      var vis = order.filter(function (id) { return !ref[id]; });
      if (A.baseVis == null) A.baseVis = vis.slice();
      A.changes.forEach(function (c) {
        if (c.photoId && vis.indexOf(c.photoId) < 0) vis = order.filter(function (id) { return id === c.photoId || vis.indexOf(id) >= 0; });
        if (c.vis === undefined) c.vis = vis.slice();
      });
      if (!A.ext.visible) A.ext.visible = A.ext.photos.map(function (p) { return p.id; });
    } else if (A.baseVis === undefined) A.baseVis = null;
    A.thread.forEach(function (m) {
      if (m.text == null && (m.r || m.k) && resolve) m.text = resolve(m);
      if (m.opts) m.opts = m.opts.map(function (o) { return typeof o.label === 'string' || !resolve ? o : { a: o.a, arg: o.arg, label: resolve(o.label) }; });
    });
    refreshSteps(A);
    if (A.stepIdx > A.steps.length - 1) A.stepIdx = Math.max(0, A.steps.length - 1);
    A.v = SCHEMA;
    return A;
  }
  // 「作っている」のまま読み込んだら完了させ、相談列に 1 行（§U-11 指摘 11）
  function finishMaking(a, line) {
    if (!a.shelf.some(function (c) { return c.state === 'making'; })) return a;
    var A = settle(a);
    if (line) pushMsg(A, { who: 'record', text: line });
    return A;
  }
  // 棚のカードの名前。同じ名前が並ぶ時は 1 行説明を添え、それでも同じなら時刻を添える（§U-11 (d)）
  function cardNames(shelf, mode) {
    var base = {}, count = {}, names = {}, seen = {};
    shelf.forEach(function (c) { if (c.state === 'making') return; base[c.id] = MD.pick(cardTitle(c), mode); count[base[c.id]] = (count[base[c.id]] || 0) + 1; });
    shelf.forEach(function (c) {
      if (!base[c.id]) return;
      var d = c.kind === 'note' ? '' : MD.desc(cardStage(c), mode);
      names[c.id] = count[base[c.id]] > 1 && d ? base[c.id] + '（' + d + '）' : base[c.id];
      seen[names[c.id]] = (seen[names[c.id]] || 0) + 1;
    });
    shelf.forEach(function (c) { if (names[c.id] && seen[names[c.id]] > 1) names[c.id] += ' · ' + c.time; });
    // それでも同じなら、古いほうから順に番号を添える（見送った案を含めて同名を並べない。§U-12 (d)）
    var fin = {}, k = {};
    Object.keys(names).forEach(function (id) { fin[names[id]] = (fin[names[id]] || 0) + 1; });
    shelf.slice().reverse().forEach(function (c) {
      var nm = names[c.id];
      if (!nm || fin[nm] < 2) return;
      k[nm] = (k[nm] || 0) + 1;
      if (k[nm] > 1) names[c.id] = nm + ' · ' + k[nm];
    });
    return names;
  }

  var pure = {
    pickTheme: pickTheme, fromSample: fromSample, fromText: fromText, fromExt: fromExt, committed: committed, isDirty: isDirty, setParam: setParam,
    whatDiff: whatDiff, commitChange: commitChange, test: test, revert: revert, canRevert: canRevert, undoRevert: undoRevert,
    leaveOptions: leaveOptions, leave: leave, remake: remake, settle: settle, cancelMaking: cancelMaking, adopt: adopt, decline: decline, undoDecline: undoDecline,
    addPhoto: addPhoto, describePhoto: describePhoto, stepNow: stepNow, stepNext: stepNext, pause: pause, confirmPause: confirmPause, takeStep: takeStep,
    resume: resume, stop: stop, undoStop: undoStop, replyKind: replyKind, requestOpt: requestOpt, editQuote: editQuote, removeQuote: removeQuote,
    undoRemoveQuote: undoRemoveQuote, pickSample: pickSample, setNext: setNext, setTitle: setTitle, roles: roles, saveWork: saveWork, addCapture: addCapture,
    demo: demo, cardStage: cardStage, pushMsg: pushMsg, lastWhat: lastWhat, reopenAt: reopenAt, replyTarget: replyTarget,
    finishMaking: finishMaking, cardNames: cardNames, visiblePhotos: visiblePhotos, cardTitle: cardTitle,
    canRevertTo: canRevertTo, restoreState: restoreState, findMsg: findMsg, declineReply: declineReply, undoDeclineReply: undoDeclineReply, migrate: migrate,
    migrateWork: migrateWork, withPending: withPending, fromOdai: fromOdai, isOdaiExt: isOdaiExt, remakeOptions: remakeOptions, ODAI_THEME: ODAI_THEME,
    // §W（作品の一覧・詳細）が使う
    defaultStatus: defaultStatus, normalizeWorks: normalizeWorks, chState: chState, baseState: baseState, curState: curState
  };
  Object.keys(pure).forEach(function (k) { M[k] = pure[k]; });
  if (typeof module !== 'undefined' && module.exports) module.exports = pure;
  if (typeof document === 'undefined') return;

  // ======================================================================
  // ここから下はブラウザ専用
  // ======================================================================

  // ---------- 保存（U-8）: 既存の DES.store に des3.activities / des3.works / des3.makeSide を足す ----------
  var EXTRA = ['activities', 'works', 'makeSide'];
  var STATES = ['working', 'paused', 'closed', 'stopped'];
  function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }
  function validAct(a) {
    return isObj(a) && typeof a.id === 'string' && typeof a.title === 'string' && Array.isArray(a.changes) && Array.isArray(a.shelf) &&
      Array.isArray(a.thread) && Array.isArray(a.steps) && typeof a.stepIdx === 'number' && STATES.indexOf(a.state) >= 0;
  }
  function sideDefaults() { return { chatHidden: false, shelfFolded: false, tab: 'stage', paused: null, lastStop: null }; }
  var CLEAN = {
    activities: function (v) { return Array.isArray(v) ? v.filter(validAct) : null; },
    works: function (v) { return Array.isArray(v) ? v.filter(function (w) { return isObj(w) && typeof w.id === 'string' && typeof w.title === 'string'; }) : null; },
    makeSide: function (v) {
      if (!isObj(v)) return null;
      var d = sideDefaults();
      return { chatHidden: v.chatHidden === true, shelfFolded: v.shelfFolded === true, tab: v.tab === 'consult' ? 'consult' : 'stage',
        paused: typeof v.paused === 'string' ? v.paused : d.paused, lastStop: typeof v.lastStop === 'string' ? v.lastStop : d.lastStop };
    }
  };
  if (DES.store && !DES.store._make) {
    var load0 = DES.store.load, save0 = DES.store.save;
    DES.store._make = true;
    DES.store.load = function () {
      var s = load0.apply(DES.store, arguments), failed = false;
      s.activities = MD.seedActivities(); s.works = null; s.makeSide = sideDefaults();
      EXTRA.forEach(function (k) {
        try {
          var raw = window.localStorage.getItem('des3.' + k);
          if (raw == null) return;
          var v = CLEAN[k](JSON.parse(raw));
          if (v) s[k] = v;
        } catch (e) { failed = true; }
      });
      if (failed) s.saveFailed = true;
      // 前の版の活動は不足欄を補う（§U-12 指摘 6）。返事の文は今の表示で作って固定する
      s.activities = s.activities.map(function (a) { return migrate(a, tx); });
      // 作品が保存されていない（初めて・はじめの状態に戻した）時は見本の作品（§W-6）。活動に結び付くものだけ
      if (!s.works) s.works = MD.seedWorks(s.activities);
      // 前の版の作品は 残した時点（at / snap）を補い（§U-12 補足 2）、§W の欄（status / craft / shares）を補う（§W-5）
      s.works = normalizeWorks(s.works.map(function (w) { return migrateWork(w, s.activities); }));
      // 「作っている」の途中で閉じた・読み込んだ活動は、ここで完了させる（§U-11 指摘 11）。新しいカードが入るので棚は開く
      s.activities = s.activities.map(function (a) {
        var ids = a.shelf.filter(function (c) { return c.state === 'making'; }).map(function (c) { return c.id; });
        if (ids.length) s.makeSide.shelfFolded = false;
        return ids.length ? finishMaking(a, readyLine(settle(a, ids), ids)) : a;
      });
      return s;
    };
    DES.store.save = function (only) {
      var ok = save0.call(DES.store, only);
      if (!only) EXTRA.forEach(function (k) { if (!save0.call(DES.store, k)) ok = false; });
      return ok;
    };
  }

  // ---------- 状態の読み書き ----------
  function S() { return DES.state; }
  function T(k, v) { return DES.t(k, v); }
  function H() { return DES.h.apply(null, arguments); }
  function icon(n) { return DES.raw(DES.icon(n)); }
  function mode() { return DES.mode(); }
  function bp() { return DES.app.bp(); }
  function mk() {
    var u = DES.ui;
    if (!u.mk) u.mk = { edit: null, headMenu: false, remakeFor: null, showAll: {}, compare: null, passedOpen: {}, dot: { stage: false, consult: false },
      makeFirst: null, makeFrom: null, ideaText: '', showSamples: {}, freeReq: {}, opened: {}, flashStep: null, sending: false, dlg: null };
    return u.mk;
  }
  function act(id) { return find(S().activities, id); }
  function freshIds(a) { return a ? a.shelf.filter(function (c) { return c.state === 'new' || c.state === 'making'; }).map(function (c) { return c.id; }) : []; }
  function freshCards(a) { return freshIds(a).length; }
  // 前に無かった新しいカードが入ったら、棚を畳んでいても開く（どの経路でも。§U-12 指摘 12）
  function setAct(a, front) {
    var before = freshIds(act(a.id));
    if (freshIds(a).some(function (id) { return before.indexOf(id) < 0; }) && S().makeSide) S().makeSide.shelfFolded = false;
    var list = S().activities.filter(function (x) { return x.id !== a.id; });
    if (front) list.unshift(a);
    else { var i = idx(S().activities, a.id); list.splice(i < 0 ? 0 : i, 0, a); }
    S().activities = list;
  }
  function newId(p) { return DES.plan.newId(p); }
  // 文言の読み（{ k, v } / { r, v } / { text } / [js, es]）
  function tx(x) {
    if (x == null) return '';
    if (typeof x === 'string' || typeof x === 'number') return String(x);
    if (Array.isArray(x)) return MD.pick(x, mode());
    if (x.text != null) return String(x.text);
    var vars = {};
    if (x.v) Object.keys(x.v).forEach(function (k) { vars[k] = tx(x.v[k]); });
    if (x.k && x.i != null) return T(x.k).split(' / ')[x.i] || '';
    if (x.k) return T(x.k, vars);
    if (x.r) return DES.fmt(MD.pick(MD.replies[x.r], mode()), vars);
    return '';
  }
  M.tx = tx;
  function optLabels(key) { return T(key).split(' / '); }
  function optLabel(opt) { var k = OPT_KEY[opt]; return k ? optLabels(k[0])[k[1]] : T('leave_free'); }
  // 相談列に足す 1 件は、作った時点の表示の文字列で持つ（§U-11 指摘 16）。ボタンの名前も同じ
  function sayText(x, m) {
    m.text = tx(m);
    if (m.opts) m.opts = m.opts.map(function (o) { return { a: o.a, arg: o.arg, label: tx(o.label) }; });
    if (!m.who) m.who = 'buddy';
    return pushMsg(x, m);
  }
  function cardName(a, id) { return cardNames(a.shelf, mode())[id] || ''; }
  // 棚に新しいカードが置かれた時の相談列の 1 行（記録）
  function readyLine(x, ids) {
    var names = cardNames(x.shelf, mode());
    return T('shelf_new_rec', { title: ids.map(function (id) { return names[id]; }).filter(Boolean).join('」「') });
  }
  function motionOK() {
    if (document.documentElement.classList.contains('reduced-motion')) return false;
    return !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  function go(hash) { if (window.location.hash !== hash) window.location.hash = hash; else DES.app.render(); }
  function today() { var d = DES.data.today.split('-'); return (+d[1]) + '/' + (+d[2]); }

  // ---------- 入口から活動を作る（話す bridge / 予定表 / 入口） ----------
  function createAndOpen(a) {
    var from = mk().makeFrom;
    if (from) { if (!a.catalogId) a.catalogId = from.catalogId; a.origin = from.origin || a.origin; }
    mk().makeFrom = null;
    DES.app.change(function () { if (freshCards(a)) S().makeSide.shelfFolded = false; S().activities = [a].concat(S().activities); });
    go('#make/' + a.id);
  }
  // 話す の bridge（U-2）: 直近の本人発言で題材を決め、引用枠 + 仮の案 3 つの作業台へ
  M.fromTalk = function () {
    var msgs = DES.talk.messages(), said = '';
    for (var i = msgs.length - 1; i >= 0; i--) if (msgs[i].who === 'child') { said = msgs[i].text; break; }
    createAndOpen(fromText(said, { id: newId('a'), origin: 'talk', now: DES.data.now, mode: mode(), works: S().works }));
  };
  // 予定表 mine 行の「作るで開く」: その取り組みの制作中があれば作業台、無ければ入口（同じカテゴリの見本を先頭に）
  var CAT_THEME = { minecraft: 'mc', programming: 'py', digital: 'circuit' };
  M.openFromPlan = function (row) {
    if (!row) return;
    var hit = null;
    S().activities.forEach(function (a) { if (!hit && row.activity && a.catalogId === row.activity && (a.state === 'working' || a.state === 'paused')) hit = a; });
    if (hit) { openAct(hit.id); return; }
    var cat = null;
    DES.data.catalog.forEach(function (c) { c.items.forEach(function (it) { if (it.id === row.activity) cat = c.id; }); });
    mk().makeFirst = CAT_THEME[cat] || null;
    mk().makeFrom = row.activity ? { catalogId: row.activity, origin: 'plan' } : null;
    go('#make');
  };
  function openAct(id) {
    var a = act(id);
    if (!a) return;
    if (a.state === 'paused' || a.state === 'closed' || a.state === 'stopped') {
      DES.app.change(function () { setAct(resume(a), true); });
    }
    go('#make/' + id);
  }
  M.openAct = openAct;
  // 今日のお題の「作ってみる」/「自分の案にする」（§X-2）: 同じお題の活動があればそれを開く（問いを書き換えていれば反映して開く）
  M.openOdai = function (odai, question) {
    if (!odai) return null;
    var m = mode();
    var r = fromOdai(odai, { id: newId('a'), mode: m, now: DES.data.now, acts: S().activities, question: question,
      recText: T('odai_rec', { q: MD.pick(odai.title, m), step: MD.pick(odai.firstStep, m), need: MD.pick(odai.need, m) }) });
    if (!r) return null;
    if (r.created) {
      change(function () { S().activities = [r.act].concat(S().activities); });
      go('#make/' + r.id);
    } else if (r.changed) {
      change(function () { setAct(resume(r.act), true); });
      go('#make/' + r.id);
    } else openAct(r.id);
    return r;
  };

  // ---------- 共通の「続きをする」（§U-11 指摘 4）: 最後に止めたのが作るなら その作業台、会話なら #talk ----------
  M.resumeTarget = function () {
    var ls = S().makeSide && S().makeSide.lastStop, id = ls && ls.indexOf('make:') === 0 ? ls.slice(5) : null, a = id ? act(id) : null;
    return a && a.state !== 'stopped' ? a.id : null;
  };
  M.resumeInfo = function () {
    var id = M.resumeTarget(), a = id ? act(id) : null;
    if (!a) return null;
    var nx = stepNext(a);
    return { title: a.title, next: nx ? tx(nx) : '' };
  };
  M.noteTalkStop = function () {
    if (!S().makeSide || S().makeSide.lastStop === 'talk') return;
    S().makeSide.lastStop = 'talk';
    if (!DES.store.save('makeSide')) S().saveFailed = true;
  };
  // 作品の「続きを作る」（§U-11 指摘 5 / 6）: 残した時点を新しい変化として開く。やめた活動も作業中へ
  M.openWork = function (workId) {
    var w = find(S().works, workId), a = w ? act(w.actId) : null;
    if (!a) return;
    var r = reopenAt(a, w.at, w.snap, w.atTime || w.snapTime);
    change(function () { setAct(r.act, true); });
    go('#make/' + a.id);
    if (r.change) DES.app.toast(tx(r.change.what));
  };

  // ---------- #paused（作る から来た時） ----------
  M.pausedAct = function () {
    var id = S().makeSide && S().makeSide.paused, a = id ? act(id) : null;
    return a && (a.state === 'paused' || a.state === 'closed') ? a : null;
  };
  M.clearPaused = function () {
    if (!S().makeSide || !S().makeSide.paused) return;
    S().makeSide.paused = null;
    if (!DES.store.save('makeSide')) S().saveFailed = true;
  };
  M.renderPaused = function (content) {
    var a = M.pausedAct();
    content.textContent = '';
    var kids = [DES.raw(DES.buddy(56, 'neutral')), H('h1', null, T('paused_h')), H('p', null, T('paused_make_p'))];
    var lp = a.lastPause;
    if (lp && lp.kind === 'step' && a.offered) {
      kids.push(H('div', { class: 'card paused-push' }, [
        H('div', { class: 'push-line' }, [DES.raw(DES.buddy(30, 'neutral')), H('p', null, T(lp.key, varsOf(lp.vars)))]),
        H('div', { class: 'actions' }, [H('button', { class: 'btn soft', type: 'button', 'data-action': 'mk-paused-step', 'data-id': a.id }, T('push_step', { step: tx(lp.step) }))])
      ]));
    }
    var acts = [H('button', { class: 'btn primary', type: 'button', 'data-action': 'mk-paused-resume', 'data-id': a.id }, T('resume'))];
    if (a.state === 'closed') acts.push(H('button', { class: 'btn', type: 'button', 'data-action': 'mk-save-open', 'data-id': a.id }, T('ask_save_once')));
    kids.push(H('div', { class: 'actions paused-actions' }, acts));
    content.appendChild(H('div', { class: 'paused make-paused' }, kids));
  };
  function varsOf(v) { var o = {}; Object.keys(v || {}).forEach(function (k) { o[k] = tx(v[k]); }); return o; }

  // ---------- 描画: 入口（#make） ----------
  function stageArt(st) { return st && st.kind !== 'note' ? MD.art(st) : ''; }
  function actArt(a) {
    if (a.stage && a.stage.kind !== 'note') return MD.art(a.stage);
    var vp = visiblePhotos(a);
    if (vp.length) return MD.photoArt(vp[vp.length - 1]);
    // お題の活動（theme 'odai'）はお題の絵（3 題材の見本を出さない）
    if (isOdaiExt(a)) { var od = odaiDef(a); return od ? DES.todayData.cardArt(od) : MD.photoArt({ theme: ODAI_THEME }); }
    var th = MD.theme(a.theme), c = a.shelf.filter(function (x) { return x.kind !== 'note'; })[0];
    return MD.art(c ? cardStage(c) : stageOf(a.theme, th.sample, 'sample'));
  }
  function originChip(a) { return H('span', { class: 'pill origin-chip' }, T('origin_' + (a.origin || 'make'))); }
  function projectRow(a) {
    var last = a.changes[a.changes.length - 1], nx = stepNext(a);
    return H('div', { class: 'project-row' }, [
      H('div', { class: 'project-thumb' }, [DES.raw(actArt(a))]),
      H('div', { class: 'project-text' }, [
        H('h3', null, a.title),
        H('p', { class: 'muted' }, last ? tx(last.what) + ' · ' + today() + ' ' + last.time : T('origin_' + (a.origin || 'make'))),
        nx ? H('p', { class: 'project-next' }, T('next_line') + ': ' + tx(nx)) : null
      ]),
      H('button', { class: 'btn primary small', type: 'button', 'data-action': 'mk-open', 'data-id': a.id }, T('resume_make'))
    ]);
  }
  function changeableText(theme) { return MD.theme(theme).changeable.map(function (p) { return MD.pick(p, mode()); }).join('・'); }
  function sampleCard(s, o) {
    o = o || {};
    var v = MD.variant(s.theme, s.variant);
    return H('article', { class: 'idea-option sample-card' }, [
      H('div', { class: 'sample-art' }, [DES.raw(MD.art(stageOf(s.theme, s.variant, 'sample')))]),
      H('div', { class: 'sample-body' }, [
        H('h3', null, MD.pick(v.title, mode())),
        H('p', { class: 'muted' }, T('changeable') + ': ' + changeableText(s.theme)),
        H('button', { class: 'btn orange small', type: 'button', 'data-action': o.action || 'mk-sample', 'data-arg': s.id, 'data-id': o.id || null }, [T('try_sample')])
      ])
    ]);
  }
  function orderedSamples() {
    var first = mk().makeFirst, list = MD.samples.slice();
    if (first) list.sort(function (a, b) { return (a.theme === first ? 0 : 1) - (b.theme === first ? 0 : 1); });
    return list;
  }
  function renderEntry(main) {
    var acts = S().activities.filter(function (a) { return a.state === 'working' || a.state === 'paused'; });
    var u = mk(), canStart = !!u.ideaText.replace(/\s/g, '');
    main.textContent = '';
    main.appendChild(H('div', { class: 'make-entry' }, [
      H('div', { class: 'page-head' }, [H('div', null, [H('h1', { tabindex: '-1', 'data-fk': 'make-h' }, T('make')), H('p', null, T('make_sub'))])]),
      acts.length ? H('section', { class: 'make-sec', 'aria-labelledby': 'mk-prog-h' }, [
        H('div', { class: 'section-head' }, [H('h2', { id: 'mk-prog-h' }, T('in_progress'))]),
        H('div', { class: 'project-list' }, acts.map(projectRow))
      ]) : null,
      H('section', { class: 'make-sec', 'aria-labelledby': 'mk-samples-h' }, [
        H('div', { class: 'section-head' }, [H('h2', { id: 'mk-samples-h' }, T('samples_h'))]),
        H('div', { class: 'idea-options sample-options' }, orderedSamples().map(function (s) { return sampleCard(s); })),
        H('div', { class: 'more-row' }, [H('button', { class: 'link-btn', type: 'button', 'data-action': 'mk-more-samples' }, T('more_samples'))])
      ]),
      H('section', { class: 'make-sec make-idea', 'aria-labelledby': 'mk-idea-h' }, [
        H('div', { class: 'section-head' }, [H('h2', { id: 'mk-idea-h' }, T('from_idea_h'))]),
        H('div', { class: 'idea-form' }, [
          H('label', { class: 'sr-only', for: 'mk-idea' }, T('from_idea_ph')),
          H('input', { id: 'mk-idea', type: 'text', 'data-ui': 'mk-idea', placeholder: T('from_idea_ph'), value: u.ideaText, autocomplete: 'off' }),
          H('button', { class: 'btn orange', type: 'button', id: 'mk-start', 'data-action': 'mk-start', disabled: !canStart }, T('start_make'))
        ]),
        H('div', { class: 'idea-media' }, [
          H('button', { class: 'btn ghost small', type: 'button', 'data-action': 'mk-from-ext', 'data-arg': 'photo' }, [icon('camera'), H('span', null, T('from_photo'))]),
          H('button', { class: 'btn ghost small', type: 'button', 'data-action': 'mk-from-ext', 'data-arg': 'link' }, [icon('plus'), H('span', null, T('from_link'))])
        ])
      ]),
      H('p', { class: 'make-today' }, [H('a', { class: 'link-btn', href: '#today' }, T('see_today'))])
    ]));
  }

  // ---------- 描画: 作業台（#make/<id>） ----------
  function whoChips(c) {
    var out = [];
    if (c.who === 'ai') out.push(chip('ai', T('who_ai')));
    else out.push(chip('own', T('who_own')));
    if (c.with) out.push(chip('record', c.with));
    return out;
  }
  // 出所チップ（色 + ラベル + アイコン。aria-label は出所名 + 表示文）
  function chip(kind, text, label) {
    var ic = { own: 'quote', ai: 'spark', record: 'record' }[kind];
    return H('span', { class: 'chip src-' + kind, role: 'img', 'aria-label': label || text }, [icon(ic), H('span', null, text)]);
  }
  function btn(label, action, o) {
    o = o || {};
    var at = { class: 'btn small' + (o.kls ? ' ' + o.kls : ''), type: 'button', 'data-action': action };
    if (o.id) at['data-id'] = o.id;
    if (o.arg != null) at['data-arg'] = o.arg;
    if (o.disabled) { at.disabled = true; if (o.title) at.title = o.title; }
    if (o.attrs) Object.keys(o.attrs).forEach(function (k) { at[k] = o.attrs[k]; });
    var kids = [];
    if (o.icon) kids.push(icon(o.icon));
    kids.push(H('span', null, label));
    return H('button', at, kids);
  }
  function inlineEdit(type, id, label, value, multi) {
    var e = mk().edit, inId = 'mk-edit-' + type;
    var field = multi
      ? H('textarea', { id: inId, rows: '2', 'data-ui': 'mk-edit', value: value })
      : H('input', { id: inId, type: 'text', 'data-ui': 'mk-edit', value: value, autocomplete: 'off' });
    return H('div', { class: 'inline-edit', 'data-fk': 'edit:' + type }, [
      H('label', { class: 'sr-only', for: inId }, label),
      field,
      H('div', { class: 'actions' }, [btn(T('keep_text'), 'mk-edit-ok', { id: id, kls: 'primary' }), btn(T('cancel'), 'mk-edit-cancel', { id: id })])
    ]);
  }
  function studioHeader(a, b) {
    var u = mk(), side = S().makeSide, editing = u.edit && u.edit.type === 'title' && u.edit.act === a.id;
    var titleEl = editing ? inlineEdit('title', a.id, T('edit_title'), u.edit.value)
      : H('h1', { class: 'studio-title' }, [H('button', { class: 'title-btn', type: 'button', 'data-action': 'mk-title-edit', 'data-id': a.id, 'data-fk': 'title:' + a.id }, a.title)]);
    var acts = [];
    if ((b === 'xl' || b === 'l') && side.chatHidden) acts.push(btn(T('unfold_chat'), 'mk-fold-chat', { id: a.id, kls: 'ghost', icon: 'chat' }));
    if (b === 'm') acts.push(btn(T('to_consult'), 'mk-to-consult', { id: a.id, kls: 'ghost', icon: 'chat' }));
    acts.push(H('button', { class: 'icon-btn head-more', type: 'button', 'data-action': 'mk-head-menu', 'data-id': a.id, 'aria-haspopup': 'menu',
      'aria-expanded': u.headMenu ? 'true' : 'false', 'aria-label': T('row_ops', { title: a.title }) }, [icon('more')]));
    var head = H('div', { class: 'studio-header' }, [
      H('div', { class: 'sh-main' }, [originChip(a), titleEl]),
      H('div', { class: 'sh-actions' }, acts)
    ]);
    if (u.headMenu) {
      head.appendChild(H('div', { class: 'head-menu', role: 'menu', 'aria-label': T('row_ops', { title: a.title }) }, [
        btn(T('edit_title'), 'mk-title-edit', { id: a.id, attrs: { role: 'menuitem' } }),
        btn(T('stop_activity'), 'mk-stop', { id: a.id, attrs: { role: 'menuitem' } })
      ]));
    }
    return head;
  }
  function tabsEl(a) {
    var side = S().makeSide, tab = side.tab === 'consult' ? 'consult' : 'stage', d = mk().dot;
    function tb(k, label, dot) {
      return H('button', { type: 'button', role: 'tab', class: tab === k ? 'active' : '', 'aria-selected': tab === k ? 'true' : 'false', 'data-action': 'mk-tab', 'data-arg': k, 'data-id': a.id },
        [H('span', null, label), dot ? H('span', { class: 'new-dot', 'aria-hidden': 'true' }) : null]);
    }
    return H('div', { class: 'studio-tabs' }, [H('div', { class: 'segmented', role: 'tablist', 'aria-label': a.title }, [
      tb('stage', T('side_stage'), d.stage && tab !== 'stage'), tb('consult', T('side_consult'), d.consult && tab !== 'consult')
    ])]);
  }
  // 相談列（この活動の会話だけ）
  function messageEl(a, m, isLast) {
    if (m.who === 'record') {
      return H('div', { class: 'message record', 'data-id': m.id }, [chip('record', T('record_label')), H('span', { class: 'msg-time' }, m.time), H('span', { class: 'rec-text' }, tx(m))]);
    }
    if (m.who === 'child') return H('div', { class: 'message user', 'data-id': m.id }, [H('div', { class: 'msg-body' }, [H('div', { class: 'bubble' }, m.text), H('span', { class: 'msg-time' }, m.time)])]);
    var body = H('div', { class: 'msg-body' }, [H('div', { class: 'bubble' }, tx(m))]);
    if (m.src === 'read') body.insertBefore(chip('ai', T('ai_read')), body.firstChild);
    var ops = [];
    if (!m.used) {
      if (m.opts) m.opts.forEach(function (o, i) {
        ops.push(btn(tx(o.label), o.a, { id: a.id, arg: o.arg != null ? o.arg : i, attrs: { 'data-msg': m.id } }));
      });
      if (m.diff) optLabels('change_opts').forEach(function (l, i) { ops.push(btn(l, 'mk-diff-pick', { id: a.id, arg: i, attrs: { 'data-msg': m.id } })); });
    }
    if (ops.length) body.appendChild(H('div', { class: 'msg-opts' }, ops));
    if (!m.diff && !m.ask) body.appendChild(H('div', { class: 'msg-foot' }, [
      H('span', { class: 'msg-time' }, m.time),
      m.declined ? null : btn(T('decline'), 'mk-msg-decline', { id: a.id, kls: 'ghost', attrs: { 'data-msg': m.id, 'aria-label': T('decline') + ': ' + tx(m).slice(0, 24) } })
    ]));
    else body.appendChild(H('span', { class: 'msg-time' }, m.time));
    return H('div', { class: 'message buddy', 'data-id': m.id }, [DES.raw(DES.buddy(30, 'neutral')), body]);
  }
  var keptComposer = null;
  function composerEl(a) {
    var ta = keptComposer && keptComposer.getAttribute('data-act') === a.id ? keptComposer : null;
    if (!ta) {
      ta = H('textarea', { id: 'mk-composer', rows: '2', placeholder: T('composer_ph'), 'data-ui': 'mk-composer', 'data-act': a.id, value: a.draft || '' });
    } else ta.placeholder = T('composer_ph');
    var dis = mk().sending || !String(ta.value || '').replace(/\s/g, '');
    return H('div', { class: 'composer mk-composer' }, [
      H('label', { class: 'sr-only', for: 'mk-composer' }, T('composer_label')),
      ta,
      H('div', { class: 'composer-bottom' }, [
        H('span', { class: 'hint' }, T('sample_note')),
        H('button', { class: 'btn orange small', id: 'mk-send', type: 'button', 'data-action': 'mk-send', 'data-id': a.id, disabled: dis }, [icon('send'), H('span', null, T('send'))])
      ])
    ]);
  }
  function quoteEl(a) {
    var q = a.quote, u = mk();
    if (!q || q.removed) return null;
    if (u.edit && u.edit.type === 'quote' && u.edit.act === a.id) {
      return H('div', { class: 'quote-frame editing' }, [chip('own', T('own_label')), inlineEdit('quote', a.id, T('own_label'), u.edit.value, true)]);
    }
    return H('div', { class: 'quote-frame', 'data-fk': 'quote:' + a.id, tabindex: '-1' }, [
      H('div', { class: 'qf-head' }, [chip('own', T('own_label'))]),
      H('p', { class: 'qf-text' }, q.text),
      H('div', { class: 'actions' }, [btn(T('quote_edit'), 'mk-quote-edit', { id: a.id, kls: 'ghost' }), btn(T('quote_remove'), 'mk-quote-remove', { id: a.id, kls: 'ghost' })])
    ]);
  }
  function fillConsult(sec, a, b) {
    var side = S().makeSide;
    var head = [H('h2', { id: 'mk-consult-h', tabindex: '-1', 'data-fk': 'consult:' + a.id }, T('side_consult'))];
    if (b === 'xl' || b === 'l') head.push(btn(T('fold_chat'), 'mk-fold-chat', { id: a.id, kls: 'ghost' }));
    sec.appendChild(H('div', { class: 'chat-head' }, head));
    if (a.resumeNote) sec.appendChild(H('div', { class: 'resume-note' }, [DES.raw(DES.buddy(18, 'think')), H('p', null, tx(a.resumeNote))]));
    var q = quoteEl(a);
    if (q) sec.appendChild(q);
    var list = H('div', { class: 'message-list', id: 'mk-messages' });
    a.thread.forEach(function (m, i) { list.appendChild(messageEl(a, m, i === a.thread.length - 1)); });
    sec.appendChild(list);
    sec.appendChild(composerEl(a));
    if (b === 's' && side.tab !== 'consult') sec.hidden = true;
    return sec;
  }
  // 今の一歩（1 行。本人が「次」を直せる）
  function stepLine(a) {
    var u = mk(), now = stepNow(a), nx = stepNext(a);
    if (u.edit && u.edit.type === 'next' && u.edit.act === a.id) {
      return H('div', { class: 'step-line editing' }, [H('span', null, T('step_now') + ':'), H('strong', null, tx(now)), H('span', { 'aria-hidden': 'true' }, '→'),
        inlineEdit('next', a.id, T('step_next'), u.edit.value)]);
    }
    // 次が無い（または今と同じ）時は「—」も出さず、「次を決める」の小リンクだけ（§U-12 (e)）
    var tail = nx ? [H('span', { 'aria-hidden': 'true' }, '→'), H('span', null, T('step_next') + ':'), H('strong', null, tx(nx)),
      btn(T('quote_edit'), 'mk-step-edit', { id: a.id, kls: 'ghost', attrs: { 'aria-label': T('step_next') + ' ' + T('quote_edit') } })]
      : [H('button', { class: 'link-btn next-set', type: 'button', 'data-action': 'mk-step-edit', 'data-id': a.id }, T('decide_next'))];
    return H('div', { class: 'step-line' + (u.flashStep === a.id ? ' flash' : ''), 'data-fk': 'step:' + a.id, tabindex: '-1' },
      [H('span', null, T('step_now') + ':'), H('strong', null, tx(now))].concat(tail));
  }
  function rangeRow(a, p) {
    var st = a.stage, id = 'mk-p-' + p.key, val = st.values[p.key];
    return H('div', { class: 'range-row' }, [
      H('label', { for: id }, MD.pick(p.label, mode())),
      H('input', { id: id, type: 'range', min: String(p.min), max: String(p.max), step: '1', value: String(val), 'data-ui': 'mk-param', 'data-key': p.key, 'data-act': a.id,
        'aria-valuetext': MD.valueLabel(st.theme, p.key, val, mode()) }),
      H('output', { for: id, 'data-out': p.key }, MD.valueLabel(st.theme, p.key, val, mode()))
    ]);
  }
  // 今の値を「試す」で確かめたことがあるか（あれば結果 1 行、無ければ「まだ確かめていない」）
  function isTested(a) {
    for (var i = a.changes.length - 1; i >= 0; i--) { var c = a.changes[i]; if (c.kind === 'test' && same(c.snap, a.stage)) return true; }
    return false;
  }
  function resultLine(a) {
    var tested = isTested(a);
    return H('p', { class: 'result-line' + (tested ? ' has-result' : '') }, [H('span', { class: 'rl-label' }, T('result_label') + ':'), ' ',
      H('span', { class: 'rl-text', 'data-result': a.id }, tested ? MD.result(a.stage, mode()) : T('not_checked'))]);
  }
  function stageBlock(a) {
    var st = a.stage, kids = [], dirty = isDirty(a);
    var label = st.kind === 'draft' ? chip('ai', T('who_ai')) : (st.kind === 'note' ? chip('ai', T('who_ai')) : H('span', { class: 'pill' }, T('sample_label')));
    var title = st.kind === 'note' ? tx(st.title) : MD.pick(MD.variant(st.theme, st.variant).title, mode());
    kids.push(H('div', { class: 'stage-top' }, [H('div', { class: 'st-name' }, [label, H('strong', null, title)]),
      H('span', { class: 'untested', 'data-untested': a.id, hidden: !dirty }, T('untested'))]));
    if (st.kind === 'note') {
      kids.push(H('ul', { class: 'stage-note' }, (st.lines || []).map(function (l) { return H('li', null, tx(l)); })));
      return H('div', { class: 'stage-block is-note' }, kids);
    }
    kids.push(H('div', { class: 'stage-canvas', 'data-art': a.id }, [DES.raw(MD.art(st))]));
    kids.push(H('pre', { class: 'stage-code', 'data-code': a.id }, MD.code(st)));
    kids.push(H('div', { class: 'stage-tools' }, MD.theme(st.theme).params.map(function (p) { return rangeRow(a, p); })));
    kids.push(H('div', { class: 'test-row' }, [btn(T('test'), 'mk-test', { id: a.id, kls: 'orange' }), resultLine(a)]));
    return H('div', { class: 'stage-block', 'data-fk': 'stage:' + a.id, tabindex: '-1' }, kids);
  }
  function emptyStage(a) {
    var u = mk(), showS = u.showSamples[a.id] || (a.quote && a.quote.removed);
    var kids = [H('p', { class: 'stage-empty-text' }, T('shelf_empty_stage'))];
    if (!showS) kids.push(H('div', { class: 'actions' }, [btn(T('see_samples'), 'mk-show-samples', { id: a.id })]));
    else kids.push(H('div', { class: 'mini-samples' }, MD.samples.map(function (s) { return sampleCard(s, { action: 'mk-pick-sample', id: a.id }); })));
    return H('div', { class: 'stage-empty', 'data-fk': 'stage:' + a.id, tabindex: '-1' }, kids);
  }
  function extBlock(a) {
    var e = a.ext, u = mk(), photos = visiblePhotos(a), latest = photos[photos.length - 1], kids = [];
    kids.push(H('div', { class: 'stage-top' }, [H('div', { class: 'st-name' }, [H('span', { class: 'pill' }, T('ext_label')), H('strong', null, e.link || a.title)])]));
    if (latest) {
      kids.push(H('figure', { class: 'photo-main' }, [DES.raw(MD.photoArt(latest)), H('figcaption', null, (latest.kind === 'shot' ? T('add_shot') : T('add_photo')).replace(/を.+$/, '') + ' · ' + latest.time)]));
      if (photos.length > 1) {
        kids.push(H('div', { class: 'photo-thumbs' }, photos.slice(0, -1).reverse().map(function (p) {
          return H('figure', { class: 'photo-thumb' }, [DES.raw(MD.photoArt(p)), H('figcaption', null, p.time)]);
        })));
      }
    }
    kids.push(H('div', { class: 'actions ext-actions' }, [
      btn(T('add_photo'), 'mk-photo', { id: a.id, arg: 'photo', icon: 'camera' }),
      btn(T('add_shot'), 'mk-photo', { id: a.id, arg: 'shot', icon: 'plus' }),
      photos.length >= 2 ? btn(T('compare'), 'mk-compare-photos', { id: a.id, kls: 'ghost' }) : null
    ]));
    if (u.edit && u.edit.type === 'photo' && u.edit.act === a.id) kids.push(photoForm(a));
    return H('div', { class: 'ext-block', 'data-fk': 'ext:' + a.id, tabindex: '-1' }, kids);
  }
  function photoForm(a) {
    var e = mk().edit;
    return H('div', { class: 'photo-form', role: 'group', 'aria-labelledby': 'mk-pf-h' }, [
      H('p', { class: 'pf-head', id: 'mk-pf-h' }, T('what_changed')),
      H('div', { class: 'opt-chips' }, optLabels('change_opts').map(function (l, i) {
        return H('button', { class: 'opt-chip', type: 'button', 'data-action': 'mk-photo-opt', 'data-id': a.id, 'data-arg': String(i), 'aria-pressed': e.opt === i ? 'true' : 'false' }, l);
      })),
      H('label', { class: 'sr-only', for: 'mk-edit-photo' }, T('what_changed')),
      H('input', { id: 'mk-edit-photo', type: 'text', 'data-ui': 'mk-edit', value: e.value, autocomplete: 'off' }),
      H('div', { class: 'actions' }, [btn(T('keep_text'), 'mk-edit-ok', { id: a.id, kls: 'primary' }), btn(T('cancel'), 'mk-edit-cancel', { id: a.id })])
    ]);
  }
  // 比べる（棚の 2 枚 / 変化の 2 つ / 写真の 2 枚を作業対象の上に並べる）
  function compareItems(a, c) {
    return c.picks.map(function (pid) {
      if (c.src === 'shelf') { var k = find(a.shelf, pid); return k ? { art: k.kind === 'note' ? '' : MD.art(cardStage(k)), lines: k.kind === 'note' ? k.lines : null, label: k.time + ' · ' + (cardName(a, k.id) || tx(cardTitle(k))) + (k.kind === 'value' ? ' · ' + tx(k.what) : '') } : null; }
      if (c.src === 'photos') { var p = find(a.ext && a.ext.photos, pid); return p ? { art: MD.photoArt(p), label: p.time } : null; }
      var ch = find(a.changes, pid);
      if (!ch) return null;
      if ((ch.kind === 'photo' || ch.kind === 'shot') && a.ext) { var ph = find(a.ext.photos, ch.photoId); return { art: MD.photoArt(ph), label: ch.time + ' · ' + tx(ch.what) }; }
      return { art: stageArt(ch.snap), lines: ch.snap && ch.snap.kind === 'note' ? ch.snap.lines : null, label: ch.time + ' · ' + tx(ch.what) };
    }).filter(Boolean);
  }
  function compareView(a) {
    var c = mk().compare;
    if (!c || c.act !== a.id || !c.open) return null;
    var items = compareItems(a, c);
    return H('div', { class: 'compare-view', 'data-fk': 'compare:' + a.id, tabindex: '-1', role: 'group', 'aria-label': T('compare') }, [
      H('div', { class: 'cv-head' }, [H('strong', null, T('compare')), btn(T('close'), 'mk-compare-close', { id: a.id, kls: 'ghost', icon: 'close' })]),
      H('div', { class: 'compare-pair' }, items.map(function (it) {
        return H('figure', { class: 'compare-item' }, [it.art ? DES.raw(it.art) : H('ul', { class: 'stage-note' }, (it.lines || []).map(function (l) { return H('li', null, tx(l)); })), H('figcaption', null, it.label)]);
      }))
    ]);
  }
  function pickToggle(a, src, id, label) {
    var c = mk().compare;
    if (!c || c.act !== a.id || c.src !== src || c.open) return null;
    var on = c.picks.indexOf(id) >= 0;
    return H('button', { class: 'btn small ghost pick-toggle' + (on ? ' on' : ''), type: 'button', 'data-action': 'mk-compare-pick', 'data-id': a.id, 'data-arg': id,
      'aria-pressed': on ? 'true' : 'false', 'aria-label': T('compare') + ': ' + label }, [on ? icon('check') : null, H('span', null, T('compare'))]);
  }
  function changesEl(a) {
    var u = mk(), chs = a.changes.slice().reverse(), all = !!u.showAll[a.id], shown = all ? chs : chs.slice(0, 2), c = u.compare;
    if (!chs.length) return null;
    var picking = c && c.act === a.id && c.src === 'changes' && !c.open;
    var headOps = chs.length >= 2 ? btn(picking ? T('cancel') : T('compare'), 'mk-compare', { id: a.id, arg: 'changes', kls: 'ghost' }) : null;
    var list = H('ol', { class: 'change-list' }, shown.map(function (ch, i) {
      var ops = [];
      var isLatest = ch.id === a.changes[a.changes.length - 1].id;
      if (!isLatest && canRevertTo(a, ch.id)) ops.push(btn(T('revert_to'), 'mk-revert-to', { id: a.id, arg: ch.id, kls: 'ghost' }));
      if (ch.who === 'ai') ops.push(btn(T('decline'), 'mk-change-decline', { id: a.id, arg: ch.id, kls: 'ghost' }));
      var pt = pickToggle(a, 'changes', ch.id, ch.time);
      if (pt) ops = [pt];
      var res = ch.kind === 'test' ? MD.result(ch.snap, mode()) : (ch.kind === 'revert' ? null : (ch.kind === 'adopt' || ch.kind === 'set' || ch.kind === 'photo' || ch.kind === 'shot' ? T('not_checked') : null));
      return H('li', { class: 'change-row', 'data-fk': 'change:' + ch.id, tabindex: '-1' }, [
        H('span', { class: 'cr-time' }, ch.time),
        H('div', { class: 'cr-main' }, [
          H('div', { class: 'cr-who' }, whoChips(ch)),
          H('p', { class: 'cr-what' }, tx(ch.what)),
          res ? H('p', { class: 'cr-result' }, T('result_label') + ': ' + res) : null
        ]),
        ops.length ? H('div', { class: 'cr-ops' }, ops) : null
      ]);
    }));
    var kids = [H('div', { class: 'section-head changes-head' }, [H('h3', { id: 'mk-ch-h-' + a.id }, T('changes_h')), headOps]), picking ? H('p', { class: 'pick-hint' }, T('compare_pick')) : null, list];
    if (chs.length > 2) kids.push(H('button', { class: 'link-btn see-all', type: 'button', 'data-action': 'mk-show-all', 'data-id': a.id, 'aria-expanded': all ? 'true' : 'false' },
      all ? T('fold') : T('see_all_changes', { n: chs.length })));
    return H('section', { class: 'changes', 'aria-labelledby': 'mk-ch-h-' + a.id }, kids);
  }
  // 棚「バディが作ったもの」
  function shelfCard(a, c) {
    var u = mk(), st = cardStage(c), kids = [];
    if (c.state === 'making') {
      return H('article', { class: 'shelf-card is-making', 'data-fk': 'card:' + c.id, tabindex: '-1' }, [
        H('p', { class: 'making-text' }, T('making')),
        btn(T('stop_making'), 'mk-cancel-making', { id: a.id, arg: c.id, kls: 'ghost' })
      ]);
    }
    var title = cardName(a, c.id) || tx(cardTitle(c));
    kids.push(c.kind === 'note' ? H('ul', { class: 'card-note' }, c.lines.map(function (l) { return H('li', null, tx(l)); })) : H('div', { class: 'card-art' }, [DES.raw(MD.art(st))]));
    var body = [H('h3', { class: 'card-title' }, title), H('p', { class: 'card-desc' }, c.kind === 'value' ? tx(c.what) : (c.kind === 'note' ? '' : MD.desc(st, mode()))),
      H('div', { class: 'card-chips' }, [chip('ai', T('who_ai') + ' ' + c.time, T('ai_proposal') + ' ' + T('who_ai') + ' ' + c.time), c.state === 'adopted' ? H('span', { class: 'chip k-adopted' }, T('adopted')) : null])];
    if (c.srcTitle) body.push(H('p', { class: 'card-src' }, T('from_capture', { title: c.srcTitle })));
    kids.push(H('div', { class: 'card-body' }, body));
    var ops = [], pt = pickToggle(a, 'shelf', c.id, title);
    if (pt) ops.push(pt);
    else if (c.state === 'passed') ops.push(btn(T('readopt'), 'mk-adopt', { id: a.id, arg: c.id }));
    else {
      if (c.state !== 'adopted') ops.push(btn(T('adopt'), 'mk-adopt', { id: a.id, arg: c.id, kls: 'primary' }));
      ops.push(btn(T('remake'), 'mk-remake-open', { id: a.id, arg: c.id, attrs: { 'aria-expanded': u.remakeFor === c.id ? 'true' : 'false' } }));
      if (c.state !== 'adopted') ops.push(btn(T('decline'), 'mk-card-decline', { id: a.id, arg: c.id, kls: 'ghost' }));
    }
    kids.push(H('div', { class: 'card-ops' }, ops));
    if (u.remakeFor === c.id && !pt) {
      // メモ（計算・手順）は外の記録の候補で作り直す（§U-11 指摘 13）
      kids.push(H('div', { class: 'remake-opts', role: 'group', 'aria-label': T('remake') }, remakeOptions(a, c).map(function (o) {
        return btn(optLabel(o), 'mk-remake', { id: a.id, arg: c.id + '|' + o });
      })));
    }
    return H('article', { class: 'shelf-card is-' + c.state + (u.flashCard === c.id ? ' enter' : ''), 'data-fk': 'card:' + c.id, tabindex: '-1' }, kids);
  }
  function shelfEl(a, inline) {
    var u = mk(), side = S().makeSide, live = a.shelf.filter(function (c) { return c.state !== 'passed'; }), passed = a.shelf.filter(function (c) { return c.state === 'passed'; });
    var folded = side.shelfFolded, c = u.compare, picking = c && c.act === a.id && c.src === 'shelf' && !c.open;
    var comparable = a.shelf.filter(function (x) { return x.state !== 'making'; }).length >= 2;
    var head = H('div', { class: 'shelf-head' }, [
      H('h2', { id: 'mk-shelf-h', tabindex: '-1', 'data-fk': 'shelf:' + a.id }, T('shelf_h', { n: live.length })),
      H('div', { class: 'shelf-acts' }, [
        comparable && !folded ? btn(picking ? T('cancel') : T('compare'), 'mk-compare', { id: a.id, arg: 'shelf', kls: 'ghost' }) : null,
        btn(folded ? T('unfold') : T('fold'), 'mk-fold-shelf', { id: a.id, kls: 'ghost', attrs: { 'aria-expanded': folded ? 'false' : 'true' } })
      ])
    ]);
    var kids = [head];
    if (!folded) {
      if (picking) kids.push(H('p', { class: 'pick-hint' }, T('compare_pick')));
      kids.push(H('div', { class: 'shelf-cards' }, live.map(function (x) { return shelfCard(a, x); })));
      if (passed.length) {
        var open = !!u.passedOpen[a.id];
        kids.push(H('button', { class: 'link-btn passed-toggle', type: 'button', 'data-action': 'mk-passed-toggle', 'data-id': a.id, 'aria-expanded': open ? 'true' : 'false' }, T('passed_ideas', { n: passed.length })));
        if (open || picking) kids.push(H('div', { class: 'shelf-cards passed' }, passed.map(function (x) { return shelfCard(a, x); })));
      }
    }
    return H(inline ? 'section' : 'aside', { class: 'shelf' + (inline ? ' inline' : ' card'), 'aria-labelledby': 'mk-shelf-h' }, kids);
  }
  function stageEl(a, b) {
    var side = S().makeSide, kids = [stepLine(a)], cv = compareView(a);
    if (cv) kids.push(cv);
    if (a.stage) kids.push(stageBlock(a));
    else if (!a.ext) kids.push(emptyStage(a));
    if (a.ext) kids.push(extBlock(a));
    // 狭い幅は棚を作業対象の直下に（§U-11 指摘 19）
    if (b !== 'xl' && a.shelf.length) kids.push(shelfEl(a, true));
    var revOK = canRevert(a);
    kids.push(H('div', { class: 'work-ops' }, [
      btn(T('revert'), 'mk-revert', { id: a.id, disabled: !revOK, title: T('revert_none') }),
      btn(T('leave_step'), 'mk-leave', { id: a.id, icon: 'spark' })
    ]));
    var ch = changesEl(a);
    if (ch) kids.push(ch);
    kids.push(H('div', { class: 'checkpoint-ops' }, [
      btn(T('save_work'), 'mk-save-open', { id: a.id }),
      btn(T('done_today'), 'mk-pause-open', { id: a.id, icon: 'pause' })
    ]));
    return H('section', { class: 'studio-stage card', 'aria-label': T('side_stage'), hidden: b === 's' && side.tab === 'consult' }, kids);
  }
  function renderStudio(main, a) {
    var b = bp(), side = S().makeSide, hidden = side.chatHidden && (b === 'xl' || b === 'l'), shelfCol = b === 'xl' && a.shelf.length > 0;
    var oldTa = document.getElementById('mk-composer'), oldMl = document.getElementById('mk-messages'), u = mk();
    keptComposer = oldTa && oldTa.getAttribute('data-act') === a.id ? oldTa : null;
    var keepTop = oldMl && u.chatKey === a.id + ':' + a.thread.length ? oldMl.scrollTop : null;
    main.textContent = '';
    var layout = H('div', { class: 'studio-layout' + (shelfCol ? ' has-shelf' : '') + (hidden ? ' chat-hidden' : '') + (b === 's' ? ' is-tabs' : '') });
    var chat = H('section', { class: 'studio-chat card', 'aria-labelledby': 'mk-consult-h' });
    fillConsult(chat, a, b);
    layout.appendChild(chat);
    layout.appendChild(stageEl(a, b));
    if (shelfCol) layout.appendChild(shelfEl(a, false));
    main.appendChild(H('div', { class: 'studio', 'data-act': a.id }, [studioHeader(a, b), b === 's' ? tabsEl(a) : null, layout]));
    keptComposer = null;
    // 相談列は新しい返事が来た時だけ末尾へ。それ以外の再描画では読んでいた位置を保つ
    var ml = document.getElementById('mk-messages');
    if (ml) ml.scrollTop = keepTop != null ? keepTop : ml.scrollHeight;
    u.chatKey = a.id + ':' + a.thread.length;
    u.flashCard = null;
  }

  M.render = function (main, arg) {
    var parts = String(arg || '').split('/'), id = parts[0], sub = parts[1] || null, u = mk();
    if (!id) { renderEntry(main); return; }
    var a = act(id);
    if (!a && /^demo-/.test(id)) {
      a = demo(id, { now: DES.data.now, mode: mode(), works: S().works });
      if (a) { S().activities = [a].concat(S().activities); if (!DES.store.save('activities')) S().saveFailed = true; }
    }
    if (!a) { window.location.replace('#make'); return; }
    renderStudio(main, a);
    if (sub && !u.opened[arg]) {
      u.opened[arg] = true;
      if (sub === 'save') openSave(a.id, null);
      if (sub === 'pause') openPause(a.id, null);
    }
  };
  // ルートが変わったら一時的な UI を閉じる（app.js の closeTransient から）
  M.resetUi = function () {
    var u = mk(), r = DES.app.route();
    u.edit = null; u.headMenu = false; u.remakeFor = null; u.compare = null; u.opened = {}; u.flashStep = null; u.dot = { stage: false, consult: false };
    if (r !== 'make') { u.makeFirst = null; u.makeFrom = null; }
  };

  // ---------- 操作 ----------
  var A = DES.actions = DES.actions || {};
  function cur(el) { return act(el.getAttribute('data-id')); }
  function change(fn, o) { DES.app.change(fn, o); }
  function update(a, fn, o) {
    change(function () {
      var x = act(a.id);
      if (!x) return;
      var res = fn(x);
      if (res) setAct(res, true);
    }, o);
  }
  function settleLater(actId, ids, after) {
    function run() {
      change(function () {
        var x = act(actId);
        if (!x) return;
        x = settle(x, ids);
        if (after) x = after(x);
        setAct(x, true);
        S().makeSide.shelfFolded = false;
        if (bp() === 's' && S().makeSide.tab === 'consult') mk().dot.stage = true;
        mk().flashCard = ids[0];
      }, { focusFn: function () { return document.activeElement && document.activeElement !== document.body ? null : 'card:' + ids[0]; } });
    }
    if (!motionOK()) run(); else setTimeout(run, 150);
  }
  // 任せる → 作っている → カード（150ms）→ 相談列に 1 行（記録「棚に「…」を置いた」）。棚は畳んでいても開く（§U-11 指摘 12）
  function runLeave(a, opt, o) {
    var res = o && o.card ? remake(a, o.card, opt) : leave(a, opt, o);
    if (!res.ids.length) return;
    change(function () { setAct(res.act, true); S().makeSide.shelfFolded = false; });
    settleLater(a.id, res.ids, function (x) { pushMsg(x, { who: 'record', text: readyLine(x, res.ids) }); return x; });
  }
  function ensureChatVisible() {
    var b = bp(), side = S().makeSide;
    if ((b === 'xl' || b === 'l') && side.chatHidden) side.chatHidden = false;
    if (b === 's') side.tab = 'consult';
  }
  // 相談列に返事が増えた後（再描画の後に呼ぶ）: ≤ 700 で作業台タブなら相談タブ名に橙の点、701〜950 は相談列を見える位置へ
  function afterChatPush() {
    var b = bp();
    if (b === 's' && S().makeSide.tab !== 'consult' && !mk().dot.consult) { mk().dot.consult = true; DES.app.render(); }
    if (b === 'm') { var sec = document.querySelector('.studio-chat'); if (sec && sec.scrollIntoView) sec.scrollIntoView({ block: 'nearest' }); }
  }

  A['mk-sample'] = function (el) { createAndOpen(fromSample(el.getAttribute('data-arg'), { id: newId('a'), now: DES.data.now, mode: mode() })); };
  A['mk-open'] = function (el) { openAct(el.getAttribute('data-id')); };
  // 見本は 3 つだけ（U-1）。見本が 0 件の時の文（no_samples）は使わない（§U-11 指摘 18）
  A['mk-more-samples'] = function () { DES.app.toast(MD.samples.length ? T('only_samples') : T('no_samples')); };
  A['mk-start'] = function () {
    var text = mk().ideaText.replace(/^\s+|\s+$/g, '');
    if (!text) return;
    mk().ideaText = '';
    createAndOpen(fromText(text, { id: newId('a'), origin: 'make', now: DES.data.now, mode: mode(), works: S().works }));
  };
  A['mk-from-ext'] = function (el) {
    DES.app.toast(T('demo_media'));
    createAndOpen(fromExt(el.getAttribute('data-arg'), { id: newId('a'), now: DES.data.now, mode: mode() }));
  };
  A['mk-show-samples'] = function (el) { var id = el.getAttribute('data-id'); mk().showSamples[id] = true; DES.app.render(); var f = document.querySelector('.mini-samples button'); if (f) f.focus(); };
  A['mk-pick-sample'] = function (el) {
    var a = cur(el), sid = el.getAttribute('data-arg');
    if (!a) return;
    update(a, function (x) { return pickSample(x, sid, mode()); }, { focus: 'stage:' + a.id });
  };
  A['mk-test'] = function (el) {
    var a = cur(el);
    if (!a) return;
    var r = test(a);
    if (!r) return;
    if (r.same) { DES.app.toast(T('result_label') + ': ' + MD.result(a.stage, mode())); return; }
    change(function () {
      var x = r.act;
      if (r.key) pushMsg(x, { who: 'buddy', r: 'test', text: MD.testReply(x.stage, r.key, r.from, mode()), change: r.change.id });
      setAct(x, true);
    });
    if (r.key) afterChatPush();
  };
  function revertWith(a, changeId, then) {
    var r = revert(a, changeId);
    if (!r) return null;
    change(function () { var x = r.act; if (then) x = then(x); setAct(x, true); }, { focus: 'stage:' + a.id });
    DES.app.toast(tx(r.change.what), { label: T('undo'), fn: function () {
      var x = act(a.id);
      if (!x) return;
      change(function () { setAct(undoRevert(x, r.undo), true); });
    } });
    return r;
  }
  A['mk-revert'] = function (el) { var a = cur(el); if (a) revertWith(a, null); };
  A['mk-revert-to'] = function (el) { var a = cur(el); if (a) revertWith(a, el.getAttribute('data-arg')); };
  // バディに任せる → 相談列に「何を任せる？」+ 対象ごとの候補 + 言葉で頼む
  A['mk-leave'] = function (el) {
    var a = cur(el);
    if (!a) return;
    var opts = leaveOptions(a).map(function (o) { return { a: 'mk-leave-opt', arg: o, label: { k: OPT_KEY[o][0], i: OPT_KEY[o][1] } }; });
    opts.push({ a: 'mk-leave-opt', arg: 'free', label: { k: 'leave_free' } });
    var mid = null;
    change(function () {
      var x = clone(a);
      mid = sayText(x, { k: 'leave_ask', opts: opts, ask: true }).id;
      ensureChatVisible();
      setAct(x, true);
    });
    afterChatPush();
    var first = document.querySelector('.message[data-id="' + mid + '"] .msg-opts button');
    if (first) first.focus();
  };
  function useMsg(x, mid, label) {
    var m = find(x.thread, mid);
    if (m) m.used = true;
    if (label) pushMsg(x, { who: 'child', text: label });
  }
  A['mk-leave-opt'] = function (el) {
    var a = cur(el), opt = el.getAttribute('data-arg'), mid = el.getAttribute('data-msg');
    if (!a) return;
    if (opt === 'free') {
      change(function () { var x = clone(a); useMsg(x, mid, null); setAct(x, true); mk().freeReq[a.id] = true; });
      var ta = document.getElementById('mk-composer');
      if (ta) ta.focus();
      return;
    }
    var x = clone(a);
    useMsg(x, mid, optLabel(opt));
    runLeave(x, opt);
  };
  A['mk-adopt'] = function (el) {
    var a = cur(el), cid = el.getAttribute('data-arg');
    if (!a) return;
    var r = adopt(a, cid);
    if (!r) return;
    if (mk().compare && mk().compare.act === a.id) mk().compare = null;
    var name = cardName(a, cid);
    // これにした後の 1 文（§U-11 (c)）: 「{案}にしたよ。」+ §7 の「任せた後」の返事。違う でこの採用を戻せる
    change(function () {
      var x = r.act;
      pushMsg(x, { who: 'buddy', r: 'left', text: T('adopt_reply_pre', { title: name }) + MD.pick(MD.replies.left, mode()), change: r.change.id });
      setAct(x, true);
    }, { focus: 'stage:' + a.id });
    afterChatPush();
    DES.app.toast(tx(r.change.what));
  };
  A['mk-remake-open'] = function (el) {
    var cid = el.getAttribute('data-arg');
    mk().remakeFor = mk().remakeFor === cid ? null : cid;
    DES.app.render();
    var f = document.querySelector('.shelf-card[data-fk="card:' + cid + '"] .remake-opts button');
    if (f && mk().remakeFor) f.focus();
  };
  A['mk-remake'] = function (el) {
    var a = cur(el), p = String(el.getAttribute('data-arg')).split('|');
    if (!a) return;
    mk().remakeFor = null;
    runLeave(a, p[1], { card: p[0] });
  };
  function diffPrompt(x) { sayText(x, { k: 'ask_what_diff', diff: true }); return x; }
  A['mk-card-decline'] = function (el) {
    var a = cur(el), cid = el.getAttribute('data-arg');
    if (!a) return;
    var r = decline(a, cid);
    if (!r) return;
    var capWork = r.capture;
    change(function () {
      var x = diffPrompt(r.act);
      setAct(x, true);
      if (capWork) S().works = S().works.map(function (w) { if (w.id !== capWork || !w.read) return w; var n = clone(w); n.read.excluded = true; return n; });
    }, { focus: 'shelf:' + a.id });
    afterChatPush();
    DES.app.toast(T('declined'), { label: T('undo'), fn: function () {
      var x = act(a.id);
      if (!x) return;
      change(function () {
        setAct(undoDecline(x, r.undo), true);
        if (capWork) S().works = S().works.map(function (w) { if (w.id !== capWork || !w.read) return w; var n = clone(w); n.read.excluded = false; return n; });
      }, { focus: 'card:' + cid });
    } });
  };
  A['mk-cancel-making'] = function (el) { var a = cur(el), cid = el.getAttribute('data-arg'); if (a) update(a, function (x) { return cancelMaking(x, cid); }, { focus: 'shelf:' + a.id }); };
  // 相談の返事の「違う」（§U-11 指摘 9）: 返事に紐づく変更を戻し（変化として積む）、紐づく新しいカードは見送って、どこが違う？
  A['mk-msg-decline'] = function (el) {
    var a = cur(el);
    if (!a) return;
    var d = declineReply(a, el.getAttribute('data-msg')), x = d.act;
    x = diffPrompt(x);
    d.undo.prompt = x.thread[x.thread.length - 1].id;
    change(function () { setAct(x, true); }, { focus: d.change ? 'stage:' + a.id : null });
    afterChatPush();
    if (!d.change && !d.passed.length) return;
    // 戻す: 値・見送ったカード・返事の「違う」・足した「どこが違う？」をまとめて元へ（§U-12 回帰 3）
    DES.app.toast(d.change ? tx(d.change.what) : T('declined'), { label: T('undo'), fn: function () {
      var y = act(a.id);
      if (!y) return;
      change(function () { setAct(undoDeclineReply(y, d.undo), true); });
    } });
  };
  A['mk-diff-pick'] = function (el) {
    var a = cur(el), i = +el.getAttribute('data-arg'), mid = el.getAttribute('data-msg');
    if (!a) return;
    var x = clone(a);
    useMsg(x, mid, optLabels('change_opts')[i]);
    runLeave(x, 'aspect', { aspect: i });
  };
  // 違う（変化の列のバディ行）: その変化の前に戻して、相談列に「どこが違う？」
  A['mk-change-decline'] = function (el) {
    var a = cur(el), cid = el.getAttribute('data-arg');
    if (!a) return;
    var k = idx(a.changes, cid), prev = k > 0 ? a.changes[k - 1].id : (k === 0 ? '@base' : null);
    var done = prev ? revertWith(a, prev, diffPrompt) : null;
    if (!done) update(a, function (x2) { return diffPrompt(clone(x2)); });
    afterChatPush();
  };
  A['mk-compare'] = function (el) {
    var a = cur(el), src = el.getAttribute('data-arg'), c = mk().compare;
    if (!a) return;
    mk().compare = c && c.act === a.id && c.src === src && !c.open ? null : { act: a.id, src: src, picks: [], open: false };
    DES.app.render();
    var f = document.querySelector('.pick-toggle');
    if (f) f.focus();
  };
  A['mk-compare-pick'] = function (el) {
    var c = mk().compare, id = el.getAttribute('data-arg');
    if (!c) return;
    var i = c.picks.indexOf(id);
    if (i >= 0) c.picks.splice(i, 1); else c.picks.push(id);
    if (c.picks.length >= 2) { c.open = true; DES.app.render(); DES.app.focusFk('compare:' + c.act); return; }
    DES.app.render();
    var b = document.querySelector('.pick-toggle[data-arg="' + id + '"]');
    if (b) b.focus();
  };
  A['mk-compare-close'] = function (el) { var id = el.getAttribute('data-id'); mk().compare = null; DES.app.render(); DES.app.focusFk('stage:' + id) ; };
  A['mk-compare-photos'] = function (el) {
    var a = cur(el);
    var ps = a ? visiblePhotos(a) : [];
    if (ps.length < 2) return;
    mk().compare = { act: a.id, src: 'photos', picks: [ps[ps.length - 2].id, ps[ps.length - 1].id], open: true };
    if (bp() === 's') S().makeSide.tab = 'stage';
    DES.app.commit({});
    DES.app.focusFk('compare:' + a.id);
  };
  A['mk-photo'] = function (el) {
    var a = cur(el), kind = el.getAttribute('data-arg');
    if (!a) return;
    var r = addPhoto(a, kind);
    change(function () { setAct(r.act, true); mk().edit = { type: 'photo', act: a.id, change: r.change.id, opt: null, value: '' }; });
    DES.app.toast(T('demo_media'));
    var f = document.querySelector('.photo-form .opt-chip');
    if (f) f.focus();
  };
  A['mk-photo-opt'] = function (el) {
    var e = mk().edit, i = +el.getAttribute('data-arg');
    if (!e || e.type !== 'photo') return;
    e.opt = e.opt === i ? null : i;
    DES.app.render();
    var b = document.querySelector('.opt-chip[data-arg="' + i + '"]');
    if (b) b.focus();
  };
  A['mk-step-edit'] = function (el) {
    var a = cur(el);
    if (!a) return;
    var nx = stepNext(a);
    mk().edit = { type: 'next', act: a.id, value: nx ? tx(nx) : '' };
    DES.app.render();
    focusEdit('next');
  };
  A['mk-title-edit'] = function (el) {
    var a = cur(el);
    if (!a) return;
    mk().headMenu = false;
    mk().edit = { type: 'title', act: a.id, value: a.title };
    DES.app.render();
    focusEdit('title');
  };
  A['mk-quote-edit'] = function (el) {
    var a = cur(el);
    if (!a || !a.quote) return;
    mk().edit = { type: 'quote', act: a.id, value: a.quote.text };
    DES.app.render();
    focusEdit('quote');
  };
  function focusEdit(type) {
    var t = document.getElementById('mk-edit-' + type);
    if (t) { t.focus(); if (t.setSelectionRange) t.setSelectionRange(t.value.length, t.value.length); }
  }
  A['mk-edit-ok'] = function (el) {
    var e = mk().edit, a = e && act(e.act);
    if (!e || !a) return;
    mk().edit = null;
    if (e.type === 'title') update(a, function (x) { return setTitle(x, e.value); }, { focus: 'title:' + a.id });
    else if (e.type === 'next') update(a, function (x) { return setNext(x, e.value); }, { focus: 'step:' + a.id });
    else if (e.type === 'quote') {
      var r = editQuote(a, e.value, S().works, mode());
      change(function () { if (r.changed) setAct(r.act, true); }, { focus: 'quote:' + a.id });
      if (r.changed) { afterChatPush(); DES.app.toast(T('remake_ideas')); }
    } else if (e.type === 'photo') {
      var d = describePhoto(a, e.change, e.opt, e.value);
      change(function () {
        var x = d.act;
        if (d.what) {
          var opts = visiblePhotos(x).length >= 2 ? [{ a: 'mk-compare-photos', label: { k: 'compare' } }] : null;
          var line = String(e.value || '').replace(/^\s+|\s+$/g, '');
          if (line) pushMsg(x, { who: 'child', text: line });
          sayText(x, { r: 'photo', v: { what: d.what }, opts: opts, change: e.change });
        }
        setAct(x, true);
      }, { focus: 'ext:' + a.id });
      if (d.what) afterChatPush();
    }
  };
  A['mk-edit-cancel'] = function (el) {
    var e = mk().edit;
    mk().edit = null;
    DES.app.render();
    if (e) DES.app.focusFk({ title: 'title:', next: 'step:', quote: 'quote:', photo: 'ext:' }[e.type] + e.act);
  };
  A['mk-quote-remove'] = function (el) {
    var a = cur(el);
    if (!a) return;
    var r = removeQuote(a);
    if (!r) return;
    change(function () { setAct(r.act, true); }, { focus: 'stage:' + a.id });
    DES.app.toast(T('removed_toast'), { label: T('undo'), fn: function () {
      var x = act(a.id);
      if (x) change(function () { setAct(undoRemoveQuote(x, r.undo), true); }, { focus: 'quote:' + a.id });
    } });
  };
  A['mk-head-menu'] = function (el) {
    mk().headMenu = !mk().headMenu;
    DES.app.render();
    var f = document.querySelector('.head-menu button');
    if (mk().headMenu && f) f.focus(); else DES.app.focusKey('mk-head-menu', el.getAttribute('data-id'));
  };
  A['mk-stop'] = function (el) {
    var a = cur(el);
    if (!a) return;
    mk().headMenu = false;
    var r = stop(a, { text: T('stopped_rec') });
    change(function () { setAct(r.act, false); });
    go('#make');
    DES.app.toast(T('stop_accept'), { label: T('undo'), fn: function () {
      var x = act(a.id);
      if (!x) return;
      change(function () { setAct(undoStop(x, r.undo), true); });
      go('#make/' + a.id);
    } });
  };
  A['mk-fold-chat'] = function (el) {
    var id = el.getAttribute('data-id');
    change(function () { S().makeSide.chatHidden = !S().makeSide.chatHidden; });
    DES.app.focusKey('mk-fold-chat', id);
  };
  A['mk-fold-shelf'] = function (el) { var id = el.getAttribute('data-id'); change(function () { S().makeSide.shelfFolded = !S().makeSide.shelfFolded; }); DES.app.focusKey('mk-fold-shelf', id); };
  A['mk-passed-toggle'] = function (el) { var id = el.getAttribute('data-id'); mk().passedOpen[id] = !mk().passedOpen[id]; DES.app.render(); DES.app.focusKey('mk-passed-toggle', id); };
  A['mk-show-all'] = function (el) { var id = el.getAttribute('data-id'); mk().showAll[id] = !mk().showAll[id]; DES.app.render(); DES.app.focusKey('mk-show-all', id); };
  A['mk-tab'] = function (el) {
    var t = el.getAttribute('data-arg') === 'consult' ? 'consult' : 'stage';
    mk().dot[t] = false;
    change(function () { S().makeSide.tab = t; });
    var b = document.querySelector('[data-action="mk-tab"][data-arg="' + t + '"]');
    if (b) b.focus();
  };
  A['mk-to-consult'] = function () {
    var sec = document.querySelector('.studio-chat');
    if (sec && sec.scrollIntoView) sec.scrollIntoView({ block: 'start' });
    var ta = document.getElementById('mk-composer');
    if (ta) ta.focus();
  };
  // 相談列の送信（応答はサンプル・決定論。150ms 送信中）
  function send(a) {
    var ta = document.getElementById('mk-composer'), u = mk();
    if (!ta || u.sending) return;
    var text = ta.value;
    if (!text.replace(/\s/g, '')) return;
    u.sending = true;
    ta.value = '';
    var free = !!u.freeReq[a.id];
    u.freeReq[a.id] = false;
    change(function () {
      var x = clone(act(a.id));
      pushMsg(x, { who: 'child', text: text });
      x.draft = '';
      setAct(x, true);
    });
    syncSend();
    setTimeout(function () {
      u.sending = false;
      if (!act(a.id)) { syncSend(); return; }
      var x = clone(act(a.id)), kind = replyKind(x, text, free);
      if (kind === 'request') { runLeave(x, requestOpt(x)); syncSend(); return; }
      change(function () {
        if (kind === 'accept') sayText(x, { k: 'accept_msg', v: { last: { k: 'tokoro', v: { what: lastWhat(x) } } } });
        else sayText(x, { r: 'unknown' });
        setAct(x, true);
      });
      afterChatPush();
      syncSend();
    }, 150);
  }
  function syncSend() {
    var ta = document.getElementById('mk-composer'), b = document.getElementById('mk-send');
    if (ta && b) b.disabled = mk().sending || !ta.value.replace(/\s/g, '');
  }
  A['mk-send'] = function (el) { var a = cur(el); if (a) send(a); };

  // ---------- ダイアログ: 作品に残す / 今日はここまで ----------
  function dlgEl() { return document.getElementById('make-dialog'); }
  function field(label, forId, control) { return H('div', { class: 'field' }, [H('label', { for: forId }, label), control]); }
  function rolesText(r) {
    var parts = [T('roles_count', { who: T('who_own'), n: r.own })];
    if (r.ai) parts.push(T('roles_count', { who: T('who_ai'), n: r.ai }));
    r.people.forEach(function (p) { parts.push(T('roles_count', { who: p.name, n: p.n })); });
    return parts.join(' · ');
  }
  M.rolesText = rolesText;
  function rolesBox(r) {
    var lines = r.lines.slice(-5);
    return H('div', { class: 'roles-box', id: 'mk-roles' }, [
      H('p', { class: 'eyebrow' }, T('roles_h')),
      H('p', { class: 'roles-sum' }, [chip('record', T('record_label')), ' ', rolesText(r)]),
      lines.length ? H('ul', { class: 'roles-lines' }, lines.map(function (l) {
        // バディの行は文が「バディが…」で始まるので、誰の印を前に付けない
        return H('li', null, l.who === 'ai' ? tx(l.what) : T('who_own') + (l.with ? '・' + l.with : '') + ': ' + tx(l.what));
      })) : null
    ]);
  }
  function openSave(id, opener) {
    var a = act(id), dlg = dlgEl();
    if (!a) return;
    mk().dlg = { type: 'save', act: id, at: '', title: a.title, like: '', status: defaultStatus(a), failed: false };
    renderSave();
    DES.app.openDialog(dlg, opener);
    var t = document.getElementById('mk-save-title');
    if (t) t.focus();
  }
  // ダイアログの中身を描き直す時、中にあるトーストは外して戻す（§U-11 指摘 1）
  function clearDialog(dlg) {
    var t = document.getElementById('toast');
    if (t && t.parentNode === dlg) dlg.removeChild(t); else t = null;
    dlg.textContent = '';
    return function () { if (t) dlg.appendChild(t); };
  }
  M.clearDialog = clearDialog;
  // 「完成にする」/「試作として残す」の 2 択（§W-1。作るの「作品に残す」と作品の「写真・スクショを入れる」で同じ部品）
  function statusField(ui, cur, name) {
    return H('fieldset', { class: 'status-pick' }, [
      H('legend', null, T('status_h')),
      H('div', { class: 'mode-options' }, STATUS.map(function (s) {
        return H('label', { class: 'radio-card' }, [H('input', { type: 'radio', name: name, value: s, checked: cur === s, 'data-ui': ui, 'data-key': 'status' }),
          H('span', null, T('status_' + s + '_pick'))]);
      }))
    ]);
  }
  M.statusField = statusField;
  function renderSave() {
    var d = mk().dlg, a = act(d.act), dlg = dlgEl();
    var putBack = clearDialog(dlg);
    dlg.setAttribute('aria-labelledby', 'mk-dlg-h');
    // 「今」= 画面に見えている今の値（まだ試していない変更も含む。§U-12 補足 4）。その後に変化の時刻を新しい順
    var last = a.changes[a.changes.length - 1], dirty = isDirty(a);
    var nowLabel = T('step_now') + (dirty ? ' · ' + T('untested') : (last ? ' · ' + last.time + ' ' + tx(last.what) : ''));
    var opts = [H('option', { value: '', selected: !d.at }, nowLabel)];
    a.changes.slice().reverse().forEach(function (c, i) {
      if (i === 0 && !dirty) return;
      opts.push(H('option', { value: c.id, selected: d.at === c.id }, c.time + ' ' + tx(c.what)));
    });
    dlg.appendChild(H('div', { class: 'dialog-head' }, [H('h2', { id: 'mk-dlg-h' }, T('save_work')), H('button', { class: 'icon-btn', type: 'button', 'data-action': 'dialog-close', 'aria-label': T('close') }, [icon('close')])]));
    var body = H('div', { class: 'dialog-body' }, [
      field(T('save_point'), 'mk-save-at', H('select', { id: 'mk-save-at', 'data-ui': 'mk-dlg', 'data-key': 'at' }, opts)),
      field(T('title_label'), 'mk-save-title', H('input', { id: 'mk-save-title', type: 'text', 'data-ui': 'mk-dlg', 'data-key': 'title', value: d.title, autocomplete: 'off' })),
      field(T('like_point'), 'mk-save-like', H('input', { id: 'mk-save-like', type: 'text', 'data-ui': 'mk-dlg', 'data-key': 'like', value: d.like, autocomplete: 'off' })),
      statusField('mk-dlg', d.status, 'mk-save-status'),
      rolesBox(roles(d.at ? a : withPending(a), d.at || null))
    ]);
    if (d.failed) body.appendChild(H('p', { class: 'dlg-error', role: 'alert' }, T('save_work_fail')));
    dlg.appendChild(body);
    dlg.appendChild(H('div', { class: 'dialog-footer' }, [
      H('button', { class: 'btn primary', type: 'button', 'data-action': 'mk-save-ok' }, d.failed ? T('retry_save') : T('save_work')),
      H('button', { class: 'btn', type: 'button', 'data-action': 'dialog-close' }, T('cancel'))
    ]));
    putBack();
  }
  A['mk-save-open'] = function (el) { openSave(el.getAttribute('data-id'), el); };
  A['mk-save-ok'] = function () {
    var d = mk().dlg, a = d && act(d.act);
    if (!a) return;
    // 再試行も毎回フォームの今の値で作る（§U-11 指摘 10）。失敗した試みの作品はメモリにも残さない（§W-5）
    var prevWorks = S().works;
    var r = saveWork(prevWorks, a, { id: newId('w'), at: d.at || null, title: d.title, like: d.like, status: d.status, date: today() });
    S().works = r.works;
    // 未試行の値を残した時は、積んだ変化を活動にも反映する（保存に失敗しても活動の変化は残す。§U-12 補足 4。戻すのは作品だけ）
    if (r.act !== a) setAct(r.act, true);
    var ok = DES.store.save('works');
    if (!ok) {
      S().works = prevWorks;
      S().saveFailed = true; d.failed = true; DES.app.renderSaveState(); renderSave();
      var b = dlgEl().querySelector('[data-action="mk-save-ok"]'); if (b) b.focus();
      return;
    }
    S().saveFailed = false;
    DES.app.closeDialog(dlgEl());
    mk().dlg = null;
    DES.app.commit({});
    DES.app.toast(T('saved_work'), { label: T('see_work'), fn: function () { go('#works'); } });
  };
  function openPause(id, opener) {
    var a = act(id), dlg = dlgEl();
    if (!a) return;
    var p = pause(a);
    // 次にすること の既定はバディ案（次の一歩。最後の一歩なら今の一歩）。本人が直す・空にできる
    var def = p.kind === 'next' ? tx(p.step) : (a.next != null ? a.next : tx(stepNext(a)));
    mk().dlg = { type: 'pause', act: id, push: p, next: def, closed: false };
    renderPause();
    DES.app.openDialog(dlg, opener);
    var f = dlg.querySelector('[data-action="mk-take-step"]') || document.getElementById('mk-next');
    if (f) f.focus();
  }
  function renderPause() {
    var d = mk().dlg, dlg = dlgEl(), p = d.push;
    var putBack = clearDialog(dlg);
    dlg.setAttribute('aria-labelledby', 'mk-dlg-h');
    dlg.appendChild(H('div', { class: 'dialog-head' }, [H('h2', { id: 'mk-dlg-h' }, T('done_today')), H('button', { class: 'icon-btn', type: 'button', 'data-action': 'dialog-close', 'aria-label': T('close') }, [icon('close')])]));
    var push = H('div', { class: 'push-line' }, [DES.raw(DES.buddy(30, 'neutral')), H('p', null, T(p.key, varsOf(p.vars)))]);
    var body = [push];
    if (p.kind === 'step') body.push(H('div', { class: 'actions push-actions' }, [H('button', { class: 'btn soft', type: 'button', 'data-action': 'mk-take-step', 'data-id': d.act }, T('push_step', { step: tx(p.step) }))]));
    body.push(field(T('next_line'), 'mk-next', H('input', { id: 'mk-next', type: 'text', 'data-ui': 'mk-dlg', 'data-key': 'next', value: d.next, autocomplete: 'off' })));
    body.push(H('div', { class: 'mode-options', role: 'radiogroup', 'aria-label': T('done_today') }, [
      H('label', { class: 'radio-card' }, [H('input', { type: 'radio', name: 'mk-close', value: 'more', checked: !d.closed, 'data-ui': 'mk-dlg', 'data-key': 'closed' }), H('span', null, T('has_more'))]),
      H('label', { class: 'radio-card' }, [H('input', { type: 'radio', name: 'mk-close', value: 'closed', checked: d.closed, 'data-ui': 'mk-dlg', 'data-key': 'closed' }), H('span', null, T('closed'))])
    ]));
    dlg.appendChild(H('div', { class: 'dialog-body' }, body));
    dlg.appendChild(H('div', { class: 'dialog-footer' }, [
      H('button', { class: 'btn primary', type: 'button', 'data-action': 'mk-pause-ok' }, T('done_today')),
      H('button', { class: 'btn', type: 'button', 'data-action': 'dialog-close' }, T('cancel'))
    ]));
    putBack();
  }
  A['mk-pause-open'] = function (el) { openPause(el.getAttribute('data-id'), el); };
  A['mk-take-step'] = function (el) {
    var d = mk().dlg, a = d && act(d.act);
    DES.app.closeDialog(dlgEl(), true);
    mk().dlg = null;
    if (!a) return;
    mk().flashStep = a.id;
    change(function () { setAct(takeStep(a, false), true); }, { focus: 'step:' + a.id });
    setTimeout(function () { if (mk().flashStep === a.id) { mk().flashStep = null; var s = document.querySelector('.step-line.flash'); if (s) s.classList.remove('flash'); } }, 1600);
  };
  A['mk-pause-ok'] = function () {
    var d = mk().dlg, a = d && act(d.act);
    if (!a) return;
    DES.app.closeDialog(dlgEl(), true);
    mk().dlg = null;
    change(function () {
      setAct(confirmPause(a, { next: d.next, closed: d.closed, push: d.push }), true);
      S().makeSide.paused = a.id;
      S().makeSide.lastStop = 'make:' + a.id;
    });
    go('#paused');
  };
  A['mk-paused-step'] = function (el) {
    var a = cur(el);
    if (!a) return;
    mk().flashStep = a.id;
    change(function () { setAct(takeStep(a, true), true); S().makeSide.paused = null; });
    go('#make/' + a.id);
  };
  A['mk-paused-resume'] = function (el) { var id = el.getAttribute('data-id'); change(function () { S().makeSide.paused = null; }); openAct(id); };

  // ---------- 入力の受け口 ----------
  function patchStage(a) {
    var st = a.stage;
    Array.prototype.forEach.call(document.querySelectorAll('[data-art="' + a.id + '"]'), function (n) { n.textContent = ''; n.appendChild(DES.raw(MD.art(st))); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-code="' + a.id + '"]'), function (n) { n.textContent = MD.code(st); });
    MD.theme(st.theme).params.forEach(function (p) {
      Array.prototype.forEach.call(document.querySelectorAll('output[data-out="' + p.key + '"]'), function (n) { n.textContent = MD.valueLabel(st.theme, p.key, st.values[p.key], mode()); });
      var inp = document.getElementById('mk-p-' + p.key);
      if (inp) inp.setAttribute('aria-valuetext', MD.valueLabel(st.theme, p.key, st.values[p.key], mode()));
    });
    var dirty = isDirty(a);
    Array.prototype.forEach.call(document.querySelectorAll('[data-untested="' + a.id + '"]'), function (n) { n.hidden = !dirty; });
    var tested = isTested(a);
    Array.prototype.forEach.call(document.querySelectorAll('[data-result="' + a.id + '"]'), function (n) {
      n.textContent = tested ? MD.result(st, mode()) : T('not_checked');
      if (n.parentNode) n.parentNode.classList.toggle('has-result', tested);
    });
    var rv = document.querySelector('[data-action="mk-revert"][data-id="' + a.id + '"]');
    if (rv) rv.disabled = !canRevert(a);
  }
  M.bind = function () {
    document.addEventListener('input', function (e) {
      var t = e.target, ui = t && t.getAttribute ? t.getAttribute('data-ui') : null, u = mk();
      if (!ui) return;
      if (ui === 'mk-param') {
        var a = act(t.getAttribute('data-act'));
        if (!a) return;
        a = setParam(a, t.getAttribute('data-key'), t.value);
        setAct(a, false);
        patchStage(a);
      } else if (ui === 'mk-composer') {
        var b = act(t.getAttribute('data-act'));
        if (b) { b.draft = t.value; if (!DES.store.save('activities')) DES.app.renderSaveState(); }
        syncSend();
      } else if (ui === 'mk-idea') {
        u.ideaText = t.value;
        var s = document.getElementById('mk-start');
        if (s) s.disabled = !t.value.replace(/\s/g, '');
      } else if (ui === 'mk-edit' && u.edit) {
        u.edit.value = t.value;
      } else if (ui === 'mk-dlg' && u.dlg) {
        var k = t.getAttribute('data-key');
        if (k === 'closed') u.dlg.closed = t.value === 'closed';
        else if (k === 'status') u.dlg.status = t.value === 'trial' ? 'trial' : 'done';
        else if (k !== 'at') u.dlg[k] = t.value;
      }
    });
    document.addEventListener('change', function (e) {
      var t = e.target, ui = t && t.getAttribute ? t.getAttribute('data-ui') : null, u = mk();
      if (ui === 'mk-param') { if (!DES.store.save('activities')) { S().saveFailed = true; DES.app.renderSaveState(); } }
      if (ui === 'mk-dlg' && u.dlg) {
        var k = t.getAttribute('data-key');
        if (k === 'at') {
          u.dlg.at = t.value;
          var a = act(u.dlg.act), box = document.getElementById('mk-roles');
          if (a && box) box.parentNode.replaceChild(rolesBox(roles(u.dlg.at ? a : withPending(a), u.dlg.at || null)), box);
        }
        if (k === 'closed') u.dlg.closed = t.value === 'closed';
        if (k === 'status') u.dlg.status = t.value === 'trial' ? 'trial' : 'done';
      }
    });
    document.addEventListener('keydown', function (e) {
      var t = e.target, u = mk(), ui = t && t.getAttribute ? t.getAttribute('data-ui') : null;
      if (e.key === 'Enter' && !e.isComposing) {
        if (ui === 'mk-idea') { e.preventDefault(); A['mk-start'](); return; }
        if (ui === 'mk-composer' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); var a = act(t.getAttribute('data-act')); if (a) send(a); return; }
        if (ui === 'mk-edit' && t.tagName === 'INPUT') { e.preventDefault(); A['mk-edit-ok'](); return; }
      }
      if (e.key === 'Escape' && !document.querySelector('dialog[open]')) {
        if (u.edit) { e.preventDefault(); A['mk-edit-cancel'](); return; }
        if (u.headMenu) { e.preventDefault(); u.headMenu = false; DES.app.render(); var hb = document.querySelector('[data-action="mk-head-menu"]'); if (hb) hb.focus(); return; }
        if (u.remakeFor) {
          var rid = u.remakeFor;
          e.preventDefault(); u.remakeFor = null; DES.app.render();
          var rb = document.querySelector('[data-action="mk-remake-open"][data-arg="' + rid + '"]');
          if (rb) rb.focus();
          return;
        }
        if (u.compare) { e.preventDefault(); var cid = u.compare.act; u.compare = null; DES.app.render(); DES.app.focusFk('stage:' + cid); return; }
      }
    });
    // 外クリックで「…」メニューと作り直しの候補を閉じる
    document.addEventListener('click', function (e) {
      var u = mk(), t = e.target;
      if (!t || !t.closest) return;
      var redraw = false;
      if (u.headMenu && !t.closest('.head-menu') && !t.closest('[data-action="mk-head-menu"]')) { u.headMenu = false; redraw = true; }
      if (u.remakeFor && !t.closest('.remake-opts') && !t.closest('[data-action="mk-remake-open"]')) { u.remakeFor = null; redraw = true; }
      if (redraw && DES.app.route() === 'make') DES.app.render();
    });
    var dlg = dlgEl();
    if (dlg) dlg.addEventListener('close', function () {
      var tEl = document.getElementById('toast');
      if (tEl && tEl.parentNode === dlg) document.body.appendChild(tEl);
      mk().dlg = null;
      dlg.textContent = '';
      var parts = String(window.location.hash).split('/');
      if (parts[0] === '#make' && parts.length > 2) window.location.replace(parts[0] + '/' + parts[1]);
    });
  };
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
