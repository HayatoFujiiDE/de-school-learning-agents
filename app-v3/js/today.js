/* 今日のお題（#today 一覧 / #today/<odaiId> 詳細）: CONTRACT-v3 §X（§I の「#today は空状態 1 文」を置き換え）。
   一覧 = お題 3 枚（fit near / next / new が 1 枚ずつ。fit は画面に出さない）+ とっておいたお題。
   詳細 = 問い・なぜ出したか・印 + 4 つの入口（短い動画を見る / 実物を探す / 試して遊ぶ / 作ってみる）。同時に開く入口は 1 つ。
   お題は #today を開いた時だけ出す（バッジ・通知・他画面への差し込みはしない。§X-5）。回数・連続日数・完了は出さない。
   §AE（contract-app）: 一覧は 2 段（話す・考える = news / talk / philo が 1 枚ずつ、作る・ためす = 上の 3 枚）+ とっておいた + サークル対話に持っていく問い。
   対話のお題の詳細 = 前提を読む / いろいろな考えを見る / 問いを選ぶ / 自分の考えを置く + 考えのあしあと + 次の一歩（バディと話す / サークル対話 / 作ってみる）。
   純関数（TD.initial / swap / keep / unkeep / markEntry / addFound / toggleHint / play / normalize …）は DOM と DES.t に触れず、
   node からも読める（tools/today-test.js）。変更は DES.app.change → DES.store.save → 再描画 の 1 経路（des3.odai を足す）。 */
(function (root) {
  'use strict';
  var DES = root.DES = root.DES || {};
  var TDD = DES.todayData || (typeof require === 'function' ? require('./today-data.js') : null);
  var MD = DES.makeData || (typeof require === 'function' ? require('./make-data.js') : null);
  var TD = DES.today = DES.today || {};
  var FITS = TDD.FITS, ENTRIES = ['watch', 'find', 'play', 'make'];
  // §AE 対話のお題: 種類（news / talk / philo）・問いの段（check / self / open）・詳細の入口（前提 / 考え / 問い / 自分の考え）
  var KINDS = TDD.KINDS, LEVELS = TDD.LEVELS, OPENS = ['facts', 'views', 'asks', 'mine'], LINE_MAX = 80;

  // ---------- 小道具 ----------
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function isNat(n) { return typeof n === 'number' && isFinite(n) && n >= 0 && Math.floor(n) === n; }
  function trim(v) { return String(v == null ? '' : v).replace(/^\s+|\s+$/g, ''); }
  function valid(id) { return typeof id === 'string' && !!TDD.get(id); }
  function validD(id) { return typeof id === 'string' && !!TDD.getDialog(id); }
  function validAny(id) { return valid(id) || validD(id); }

  // ---------- 状態（§X-4）: { slots: [id,id,id], kept: [id], tried: { id: { entries, found, checks } }, rot: { near, next, new } } ----------
  // rot = その fit のプールで、いまスロットに出ている位置。slots[i] は FITS[i] のプールから
  // §AE-5 で足す: dslots { news, talk, philo } / drot（同じ形の回転の位置）/ think { id: { opened, ask, marks } } / circle [{ id, ask, time }]
  function initial() {
    var dslots = {}, drot = {};
    KINDS.forEach(function (k) { dslots[k] = TDD.kindPool(k)[0]; drot[k] = 0; });
    return { slots: FITS.map(function (f) { return TDD.pool(f)[0]; }), kept: [], tried: {}, rot: { near: 0, next: 0, new: 0 },
      dslots: dslots, drot: drot, think: {}, circle: [] };
  }
  function blankThink() { return { opened: { facts: false, views: false, asks: false, mine: false }, ask: null, marks: [] }; }
  function isStance(o, sid) { return sid === 'none' || !!TDD.stanceOf(o, sid); }
  function cleanThink(t, o) {
    if (!isObj(t)) return null;
    var out = blankThink(), seen = {};
    if (isObj(t.opened)) OPENS.forEach(function (k) { out.opened[k] = t.opened[k] === true; });
    out.ask = LEVELS.indexOf(t.ask) >= 0 ? t.ask : null;
    if (Array.isArray(t.marks)) {
      t.marks.forEach(function (m) {
        // 空の id は捨てる（外す・元に戻すが id で探すため。レビューへの裁定）
        if (!isObj(m) || typeof m.id !== 'string' || !m.id || seen[m.id] || !isStance(o, m.stance) || !(m.line == null || typeof m.line === 'string') || typeof m.time !== 'string') return;
        seen[m.id] = true;
        var line = m.line ? trim(m.line).slice(0, LINE_MAX) : '';
        out.marks.push({ id: m.id, stance: m.stance, line: line || null, time: m.time });
      });
    }
    return out;
  }
  function cleanCircle(list) {
    var out = [];
    list.forEach(function (c) {
      if (!isObj(c) || !validD(c.id) || typeof c.time !== 'string' || !(c.ask == null || LEVELS.indexOf(c.ask) >= 0)) return;
      if (out.some(function (x) { return x.id === c.id; })) return;
      out.push({ id: c.id, ask: c.ask == null ? null : c.ask, time: c.time });
    });
    return out;
  }
  function blankTried() { return { entries: { watch: false, find: false, play: false, make: false }, found: [], checks: [] }; }
  function cleanTried(t, odai) {
    if (!isObj(t)) return null;
    var out = blankTried();
    if (isObj(t.entries)) ENTRIES.forEach(function (k) { out.entries[k] = t.entries[k] === true; });
    if (Array.isArray(t.found)) {
      out.found = t.found.filter(function (f) { return isObj(f) && !!TDD.photo(odai, f.photo) && (f.line == null || typeof f.line === 'string') && typeof f.time === 'string'; })
        .map(function (f) { return { photo: f.photo, line: f.line ? String(f.line) : null, time: f.time }; });
    }
    if (Array.isArray(t.checks)) {
      t.checks.forEach(function (i) { if (isNat(i) && i < odai.find.hints.length && out.checks.indexOf(i) < 0) out.checks.push(i); });
      out.checks.sort();
    }
    return out;
  }
  // 読み込んだ値を整える（§X-4）。形が違えばそのキーだけ初期値に戻す（他のキーから作り直さない）
  function normalize(raw) {
    var d = initial();
    if (!isObj(raw)) return d;
    var out = { slots: d.slots, kept: [], tried: {}, rot: d.rot, dslots: d.dslots, drot: d.drot, think: {}, circle: [] };
    // slots: 3 枚とも知っているお題で、near / next / new の順に合っているものだけ
    if (Array.isArray(raw.slots) && raw.slots.length === FITS.length && raw.slots.every(function (id, i) { return valid(id) && TDD.get(id).fit === FITS[i]; })) out.slots = raw.slots.slice();
    // rot: near / next / new がどれも 0 以上の整数（プールの長さで折り返す）
    if (isObj(raw.rot) && FITS.every(function (f) { return isNat(raw.rot[f]); })) {
      out.rot = {};
      FITS.forEach(function (f) { out.rot[f] = raw.rot[f] % TDD.pool(f).length; });
    }
    // kept: 配列なら知っているお題だけ（重なりなし。§AE: 種類を問わない）
    if (Array.isArray(raw.kept)) raw.kept.forEach(function (id) { if (validAny(id) && out.kept.indexOf(id) < 0) out.kept.push(id); });
    // tried: オブジェクトなら、お題ごとに形の合うものだけ
    if (isObj(raw.tried)) {
      Object.keys(raw.tried).forEach(function (id) {
        var o = TDD.get(id), t = o ? cleanTried(raw.tried[id], o) : null;
        if (t) out.tried[id] = t;
      });
    }
    // §AE-5: dslots は 3 種類とも、その種類の知っているお題 / drot は 3 種類とも 0 以上の整数（プールの長さで折り返す）
    if (isObj(raw.dslots) && KINDS.every(function (k) { return validD(raw.dslots[k]) && TDD.getDialog(raw.dslots[k]).kind === k; })) {
      out.dslots = {};
      KINDS.forEach(function (k) { out.dslots[k] = raw.dslots[k]; });
    }
    if (isObj(raw.drot) && KINDS.every(function (k) { return isNat(raw.drot[k]); })) {
      out.drot = {};
      KINDS.forEach(function (k) { out.drot[k] = raw.drot[k] % TDD.kindPool(k).length; });
    }
    // think: お題ごとに形の合うものだけ / circle: 知っているお題だけ（重なりなし）
    if (isObj(raw.think)) {
      Object.keys(raw.think).forEach(function (id) {
        var o = TDD.getDialog(id), t = o ? cleanThink(raw.think[id], o) : null;
        if (t) out.think[id] = t;
      });
    }
    if (Array.isArray(raw.circle)) out.circle = cleanCircle(raw.circle);
    return out;
  }
  // 別のお題を見る: そのスロットだけ、同じ fit の次のお題へ（他のスロットに出ているものは飛ばす）。一巡したら最初に戻る。
  // 見送ったお題はプールの後ろに回るだけで、また出会える。差し替えられない時は同じ state を返す
  function swap(state, slotIdx) {
    var f = FITS[slotIdx];
    if (!f || !state || !Array.isArray(state.slots)) return state;
    var pool = TDD.pool(f), cur = state.slots[slotIdx], start = pool.indexOf(cur);
    if (start < 0) start = state.rot && isNat(state.rot[f]) ? (state.rot[f] + pool.length - 1) % pool.length : -1;
    for (var k = 1; k <= pool.length; k++) {
      var j = (start + k + pool.length) % pool.length, id = pool[j];
      if (id === cur) continue;
      if (state.slots.some(function (x, i) { return i !== slotIdx && x === id; })) continue;
      var S = clone(state);
      S.slots[slotIdx] = id;
      if (!isObj(S.rot)) S.rot = {};
      S.rot[f] = j;
      return S;
    }
    return state;
  }
  function isKeptIn(state, id) { return !!(state && Array.isArray(state.kept) && state.kept.indexOf(id) >= 0); }
  // とっておく（新しいものが先頭。at を渡すとその位置へ = 外すの元に戻す）
  function keep(state, id, at) {
    if (!validAny(id) || isKeptIn(state, id)) return state;
    var S = clone(state);
    S.kept.splice(Math.max(0, Math.min(at == null ? 0 : at | 0, S.kept.length)), 0, id);
    return S;
  }
  function unkeep(state, id) {
    var i = state && Array.isArray(state.kept) ? state.kept.indexOf(id) : -1;
    if (i < 0) return null;
    var S = clone(state);
    S.kept.splice(i, 1);
    return { state: S, undo: { id: id, index: i } };
  }
  function triedOf(S, id) { if (!S.tried[id]) S.tried[id] = blankTried(); return S.tried[id]; }
  // 入口を開いた = やってみた の記録（画面に回数や完了は出さない）
  function markEntry(state, id, entry) {
    if (!valid(id) || ENTRIES.indexOf(entry) < 0) return state;
    var t = state.tried && state.tried[id];
    if (t && t.entries && t.entries[entry]) return state;
    var S = clone(state);
    triedOf(S, id).entries[entry] = true;
    return S;
  }
  function isStarted(state, id) {
    var t = state && state.tried && state.tried[id];
    return !!(t && t.entries && ENTRIES.some(function (k) { return t.entries[k]; }));
  }
  // 見つけた写真を残す: お題の記録 found に入る（作品には入れない）。photo はそのお題のダミー線画の id だけ
  function addFound(state, id, f) {
    var o = TDD.get(id);
    if (!o || !f || !TDD.photo(o, f.photo)) return state;
    var line = trim(f.line).slice(0, 120), S = clone(state), t = triedOf(S, id);
    t.found.push({ photo: f.photo, line: line || null, time: String(f.time || '') });
    t.entries.find = true;
    return S;
  }
  // 残した写真を消す + 元に戻す（元の位置へ）
  function removeFound(state, id, i) {
    var t = state && state.tried && state.tried[id];
    if (!t || !Array.isArray(t.found) || !isNat(i) || i >= t.found.length) return null;
    var S = clone(state), item = S.tried[id].found.splice(i, 1)[0];
    return { state: S, undo: { id: id, index: i, item: clone(item) } };
  }
  function restoreFound(state, u) {
    var o = u && TDD.get(u.id);
    if (!o || !u.item || !TDD.photo(o, u.item.photo)) return state;
    var S = clone(state), t = triedOf(S, u.id);
    t.found.splice(Math.max(0, Math.min(u.index | 0, t.found.length)), 0, clone(u.item));
    return S;
  }
  // 手がかりのチェック（付ける・外す）
  function toggleHint(state, id, i) {
    var o = TDD.get(id);
    if (!o || !isNat(i) || i >= o.find.hints.length) return state;
    var S = clone(state), t = triedOf(S, id), k = t.checks.indexOf(i);
    if (k >= 0) t.checks.splice(k, 1); else { t.checks.push(i); t.checks.sort(); }
    t.entries.find = true;
    return S;
  }
  // 試して遊ぶ（決定論）: 値を範囲に収め、線画と結果 1 行 [中, 小] を返す
  function play(odai, values) {
    if (!odai || !odai.play) return null;
    var v = {};
    odai.play.sliders.forEach(function (s) {
      var x = values && values[s.key] != null ? Math.round(+values[s.key]) : s.def;
      if (isNaN(x)) x = s.def;
      v[s.key] = Math.max(s.min, Math.min(s.max, x));
    });
    return { values: v, art: TDD.drawArt(odai.art, v), result: odai.play.result(v) };
  }

  // ---------- §AE-6 対話のお題 ----------
  // 別のお題を見る（種類ごと）: そのカードだけ、同じ種類の次のお題へ。一巡したら最初に戻る。差し替えられない時は同じ state
  function swapKind(state, kind) {
    if (KINDS.indexOf(kind) < 0 || !state || !isObj(state.dslots)) return state;
    var pool = TDD.kindPool(kind), cur = state.dslots[kind], start = pool.indexOf(cur);
    if (start < 0) start = isObj(state.drot) && isNat(state.drot[kind]) ? (state.drot[kind] + pool.length - 1) % pool.length : -1;
    var j = (start + 1 + pool.length) % pool.length;
    if (!pool.length || pool[j] === cur) return state;
    var S = clone(state);
    S.dslots[kind] = pool[j];
    if (!isObj(S.drot)) S.drot = {};
    S.drot[kind] = j;
    return S;
  }
  function thinkOf(S, id) {
    if (!isObj(S.think)) S.think = {};
    if (!S.think[id]) S.think[id] = blankThink();
    return S.think[id];
  }
  // 入口を開いた記録（画面に回数や完了は出さない。1 つでも開いたら「次の一歩」が出る）
  function markOpen(state, id, entry) {
    if (!validD(id) || OPENS.indexOf(entry) < 0) return state;
    var t = state.think && state.think[id];
    if (t && t.opened && t.opened[entry]) return state;
    var S = clone(state);
    thinkOf(S, id).opened[entry] = true;
    return S;
  }
  function isOpened(state, id) {
    var t = state && state.think && state.think[id];
    return !!(t && t.opened && OPENS.some(function (k) { return t.opened[k]; }));
  }
  // 問いを選ぶ（選び直せる）
  function pickAsk(state, id, level) {
    if (!validD(id) || LEVELS.indexOf(level) < 0) return state;
    var t = state.think && state.think[id];
    if (t && t.ask === level && t.opened && t.opened.asks) return state;
    var S = clone(state), th = thinkOf(S, id);
    th.ask = level;
    th.opened.asks = true;
    return S;
  }
  // 既にある id と重ならない採番（レビューへの裁定）: 番号は 10 億未満の 'mkN' の最大の次から。とても大きい番号（数の精度を超える）は
  // 最大に数えない。それでも重なれば次の番号へ進める
  var MARK_N_MAX = 1e9;
  function nextMarkId(marks) {
    var n = 0, used = {};
    marks.forEach(function (m) { used[m.id] = true; var k = /^mk(\d+)$/.exec(m.id); if (k && +k[1] > n && +k[1] < MARK_N_MAX) n = +k[1]; });
    var next = n + 1;
    while (used['mk' + next]) next += 1;
    return 'mk' + next;
  }
  // 自分の考えを置く: 新しいものが上。前のものは残す（考えが変わったことが見える）。line は 80 字で切る（空なら null）
  function putMark(state, id, m) {
    var o = TDD.getDialog(id);
    if (!o || !m || !isStance(o, m.stance)) return state;
    var S = clone(state), th = thinkOf(S, id), line = trim(m.line).slice(0, LINE_MAX);
    th.marks.unshift({ id: nextMarkId(th.marks), stance: m.stance, line: line || null, time: String(m.time || '') });
    th.opened.mine = true;
    return S;
  }
  // 外す + 元に戻す（元の位置へ。id が重なっていたら新しい id にする）
  function removeMark(state, id, markId) {
    var t = state && state.think && state.think[id], i = -1;
    if (t && Array.isArray(t.marks)) t.marks.forEach(function (m, j) { if (i < 0 && m.id === markId) i = j; });
    if (i < 0) return null;
    var S = clone(state), item = S.think[id].marks.splice(i, 1)[0];
    return { state: S, undo: { id: id, index: i, item: clone(item) } };
  }
  function restoreMark(state, u) {
    var o = u && TDD.getDialog(u.id);
    if (!o || !isObj(u.item) || !isStance(o, u.item.stance)) return state;
    var S = clone(state), th = thinkOf(S, u.id), item = clone(u.item);
    if (th.marks.some(function (m) { return m.id === item.id; })) item.id = nextMarkId(th.marks);
    th.marks.splice(Math.max(0, Math.min(u.index | 0, th.marks.length)), 0, item);
    return S;
  }
  // 元に戻した考えの id（restoreMark の後の state で、戻した位置の 1 件。id が重なって替わった時はその新しい id）。フォーカスを戻す先
  function restoredMarkId(state, u) {
    var t = state && u && state.think && state.think[u.id];
    if (!t || !Array.isArray(t.marks) || !t.marks.length) return null;
    return t.marks[Math.max(0, Math.min(u.index | 0, t.marks.length - 1))].id;
  }
  // サークル対話に持っていく（お題 + 選んだ問いがあればその段）。新しいものが先頭（at を渡すとその位置 = 外すの元に戻す）。
  // 既に入っていれば、選んだ問いだけ今のものに替える
  function inCircle(state, id) { return !!(state && Array.isArray(state.circle) && state.circle.some(function (c) { return c.id === id; })); }
  function toCircle(state, id, o, at) {
    if (!validD(id)) return state;
    o = o || {};
    var ask = LEVELS.indexOf(o.ask) >= 0 ? o.ask : null, S;
    if (inCircle(state, id)) {
      var cur = state.circle.filter(function (c) { return c.id === id; })[0];
      if (cur.ask === ask) return state;
      S = clone(state);
      S.circle.forEach(function (c) { if (c.id === id) c.ask = ask; });
      return S;
    }
    S = clone(state);
    if (!Array.isArray(S.circle)) S.circle = [];
    S.circle.splice(Math.max(0, Math.min(at == null ? 0 : at | 0, S.circle.length)), 0, { id: id, ask: ask, time: String(o.time || '') });
    return S;
  }
  function fromCircle(state, id) {
    var i = -1;
    if (state && Array.isArray(state.circle)) state.circle.forEach(function (c, j) { if (i < 0 && c.id === id) i = j; });
    if (i < 0) return null;
    var S = clone(state), item = S.circle.splice(i, 1)[0];
    return { state: S, undo: { index: i, item: clone(item) } };
  }

  // ---------- 保存の失敗を戻す（共通の約束。DES.make.trySave = 作る・展示と同じ約束）----------
  // save(key) は DES.store.save と同じ約束（偽 = 保存できなかった）。どれも保存できなければ state を前に戻して false
  function trySave(st, keys, fn, save) { return DES.make.trySave(st, keys, fn, save); }
  function saveOdai(st, next, save) { return trySave(st, ['odai'], function (s) { s.odai = next; }, save); }
  // バディと話す: 話す画面の下書き（state.draft）に line を入れる（下書きがあれば改行して足す）
  function addTalk(st, line, save) {
    return trySave(st, ['draft'], function (s) {
      var cur = String((s.draft && s.draft.text) || '').replace(/\s+$/, '');
      s.draft = { text: cur ? cur + '\n' + line : line, scroll: (s.draft && s.draft.scroll) || 0 };
    }, save);
  }
  // 対話のお題の入口を開く（同時に 1 つ。もう一度押すと閉じる）。open = 画面の今開いている入口 { id: entry }。
  // 開いた記録が変わる時は保存し、保存できなければ入口も押す前に戻す。戻り値 { saved: true | false | null（保存なし） }
  function openDEntry(st, open, id, k, save) {
    var prev = open[id] || null;
    open[id] = prev === k ? null : k;
    if (!open[id]) return { saved: null };
    var cur = st.odai, next = markOpen(cur, id, k);
    if (next === cur) return { saved: null };
    if (saveOdai(st, next, save)) return { saved: true };
    open[id] = prev;
    return { saved: false };
  }
  // 作ってみる（§AE-4 の 5）: 題 = next.makeTitle・手順 = next.makeSteps の外で作る活動を作って保存する（2 回目は同じ活動）。
  // opts: { id, mode, now, recText }。戻り値 { ok, id, created }（ok = 保存できた。created でなければ保存しない）
  function dialogMake(st, o, opts, save) {
    var mk = TDD.makeOdaiOf(o), M = DES.make;
    if (!mk || !M || !M.fromOdai) return null;
    opts = opts || {};
    var r = M.fromOdai(mk, { id: opts.id, mode: opts.mode, now: opts.now, acts: st.activities || [], recText: opts.recText });
    if (!r) return null;
    if (!r.created) return { ok: true, id: r.id, created: false };
    return { ok: M.addAct(st, r.act, save), id: r.id, created: true };
  }

  var pure = {
    initial: initial, normalize: normalize, swap: swap, keep: keep, unkeep: unkeep, markEntry: markEntry, isStarted: isStarted,
    addFound: addFound, removeFound: removeFound, restoreFound: restoreFound, toggleHint: toggleHint, play: play, isKept: isKeptIn, FITS: FITS, ENTRIES: ENTRIES,
    swapKind: swapKind, markOpen: markOpen, isOpened: isOpened, pickAsk: pickAsk, putMark: putMark, removeMark: removeMark, restoreMark: restoreMark,
    toCircle: toCircle, fromCircle: fromCircle, inCircle: inCircle, KINDS: KINDS, LEVELS: LEVELS, OPENS: OPENS, LINE_MAX: LINE_MAX,
    // レビューへの裁定
    restoredMarkId: restoredMarkId, saveOdai: saveOdai, addTalk: addTalk, openDEntry: openDEntry, dialogMake: dialogMake
  };
  Object.keys(pure).forEach(function (k) { TD[k] = pure[k]; });
  if (typeof module !== 'undefined' && module.exports) module.exports = pure;
  if (typeof document === 'undefined') return;

  // ======================================================================
  // ここから下はブラウザ専用
  // ======================================================================

  // ---------- 保存（§X-4）: 既存の DES.store に des3.odai を足す（make.js と同じ包み方） ----------
  if (DES.store && !DES.store._today) {
    var load1 = DES.store.load, save1 = DES.store.save;
    DES.store._today = true;
    DES.store.load = function () {
      var s = load1.apply(DES.store, arguments), raw = null;
      try {
        var t = window.localStorage.getItem('des3.odai');
        if (t != null) raw = JSON.parse(t);
      } catch (e) { s.saveFailed = true; }
      s.odai = normalize(raw);
      return s;
    };
    DES.store.save = function (only) {
      var ok = save1.call(DES.store, only);
      if (!only && !save1.call(DES.store, 'odai')) ok = false;
      return ok;
    };
  }

  function S() { return DES.state; }
  function T(k, v) { return DES.t(k, v); }
  function H() { return DES.h.apply(null, arguments); }
  function icon(n) { return DES.raw(DES.icon(n)); }
  function pick(pair) { return MD.pick(pair, DES.mode()); }
  function esc(v) { return window.CSS && CSS.escape ? CSS.escape(v) : String(v).replace(/"/g, '\\"'); }
  function ui() {
    var u = DES.ui;
    if (!u.td) u.td = { open: {}, play: {}, own: null, dlg: null, shownDetail: null, missing: null, fresh: null, pendingFocus: null };
    // §AE: dmine = 自分の考えの入力中の値（お題ごと { stance, line }。保存しない）/ dfresh = 替えたばかりの対話のカード（種類）
    if (!u.td.dmine) u.td.dmine = {};
    return u.td;
  }
  function dlgEl() { return document.getElementById('today-dialog'); }
  function isKept(id) { return isKeptIn(S().odai, id); }
  function actFor(id) { var hit = null; (S().activities || []).forEach(function (a) { if (!hit && a.odaiId === id) hit = a; }); return hit; }
  function stamp() { var p = DES.data.today.split('-'); return (+p[1]) + '/' + (+p[2]) + ' ' + DES.data.now; }
  function refocus(sel) { var n = sel ? document.querySelector(sel) : null; if (n) n.focus(); }
  function motionOK() {
    if (document.documentElement.classList.contains('reduced-motion')) return false;
    return !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  function chip(kind, text, label) {
    var ic = { own: 'quote', ai: 'spark', record: 'record' }[kind];
    return H('span', { class: 'chip src-' + kind, role: 'img', 'aria-label': label || text }, [icon(ic), H('span', null, text)]);
  }
  function btn(label, action, o) {
    o = o || {};
    var at = { class: 'btn small' + (o.kls ? ' ' + o.kls : ''), type: 'button', 'data-action': action };
    if (o.id) at['data-id'] = o.id;
    if (o.arg != null) at['data-arg'] = o.arg;
    if (o.disabled) at.disabled = true;
    if (o.attrs) Object.keys(o.attrs).forEach(function (k) { at[k] = o.attrs[k]; });
    var kids = [];
    if (o.icon) kids.push(icon(o.icon));
    kids.push(H('span', null, label));
    return H('button', at, kids);
  }

  // ---------- 部品 ----------
  function lineEl(key, pair) { return H('p', { class: 'odai-line' }, [H('span', { class: 'odai-k' }, T(key)), H('span', null, pick(pair))]); }
  // なぜ出したか（琥珀の AI 出所チップ付き 1 行。区分名は出さない）
  function whyEl(o) { return H('p', { class: 'odai-why' }, [chip('ai', T('who_ai'), T('ai_proposal') + ' ' + T('td_why')), H('span', null, pick(o.reason))]); }
  // 印（あるものだけ）: サポーターと確認 / 出所（外からの依頼 + 締切、それ以外は バディが作ったお題）
  function marksEl(o) {
    var out = [];
    if (o.safety) out.push(H('span', { class: 'chip k-safety' }, T('td_safety')));
    if (o.source === 'request') {
      out.push(H('span', { class: 'chip k-request', role: 'img', 'aria-label': T('td_src_request') }, [icon('send'), H('span', null, T('td_src_request'))]));
      if (o.due) out.push(H('span', { class: 'odai-due' }, T('td_due', { date: pick(o.due) })));
    } else out.push(chip('ai', T('td_src_buddy'), T('ai_proposal') + ' ' + T('td_src_buddy')));
    return H('div', { class: 'odai-marks' }, out);
  }
  function keepBtn(o) {
    var kept = isKept(o.id);
    return btn(T(kept ? 'td_kept_btn' : 'td_keep'), 'td-keep', { id: o.id, kls: kept ? 'is-on' : '', icon: kept ? 'check' : null, attrs: { 'aria-pressed': kept ? 'true' : 'false' } });
  }

  // ---------- 一覧（§X-1） ----------
  function card(o, i, fresh) {
    return H('article', { class: 'odai-card' + (fresh ? ' swap-in' : ''), 'data-fk': 'odai:' + i, 'data-odai': o.id, 'aria-labelledby': 'odai-q-' + i }, [
      H('div', { class: 'odai-art' }, [DES.raw(TDD.cardArt(o))]),
      H('div', { class: 'odai-body' }, [
        H('h2', { class: 'odai-q', id: 'odai-q-' + i }, pick(o.title)),
        lineEl('td_first', o.firstStep),
        lineEl('td_need', o.need),
        whyEl(o),
        marksEl(o),
        H('div', { class: 'odai-ops' }, [
          H('a', { class: 'btn orange', href: '#today/' + o.id, 'data-fk': 'try:' + o.id }, T('td_try')),
          keepBtn(o),
          btn(T('td_other'), 'td-swap', { arg: String(i), kls: 'ghost', attrs: { 'aria-label': T('td_other') + ': ' + pick(o.title) } })
        ])
      ])
    ]);
  }
  // ---------- §AE-2 対話のカード（話す・考える） ----------
  // 種類のチップ（news は右に日付）
  function kindEl(o) {
    return H('p', { class: 'odai-kind' }, [H('span', { class: 'chip k-kind k-' + o.kind }, T('td_kind_' + o.kind)),
      o.date ? H('span', { class: 'odai-date' }, T('td_news_date', { date: pick(o.date) })) : null]);
  }
  // 印: サポーターと読む（heavy の時）+ 出所（バディが作ったお題）
  function dmarksEl(o) {
    var out = [];
    if (o.heavy) out.push(H('span', { class: 'chip k-safety' }, T('td_heavy')));
    out.push(chip('ai', T('td_src_buddy'), T('ai_proposal') + ' ' + T('td_src_buddy')));
    return H('div', { class: 'odai-marks' }, out);
  }
  function dcard(o, kind, fresh) {
    return H('article', { class: 'odai-card is-talk' + (fresh ? ' swap-in' : ''), 'data-fk': 'dodai:' + kind, 'data-odai': o.id, 'aria-labelledby': 'dodai-q-' + kind }, [
      H('div', { class: 'odai-art' }, [DES.raw(TDD.cardArt(o))]),
      H('div', { class: 'odai-body' }, [
        kindEl(o),
        H('h2', { class: 'odai-q', id: 'dodai-q-' + kind }, pick(o.title)),
        H('p', { class: 'odai-lead' }, [H('span', { class: 'odai-k' }, T('td_lead') + ': '), H('span', null, pick(o.lead))]),
        whyEl(o),
        dmarksEl(o),
        H('div', { class: 'odai-ops' }, [
          H('a', { class: 'btn orange', href: '#today/' + o.id, 'data-fk': 'dtry:' + o.id }, T('td_think')),
          keepBtn(o),
          btn(T('td_other'), 'td-dswap', { arg: kind, kls: 'ghost', attrs: { 'aria-label': T('td_other') + ': ' + pick(o.title) } })
        ])
      ])
    ]);
  }
  function anyTopic(id) { return TDD.get(id) || TDD.getDialog(id); }
  function keptSec() {
    var kept = S().odai.kept;
    if (!kept.length) return null;
    return H('section', { class: 'odai-kept', 'aria-labelledby': 'td-kept-h' }, [
      H('div', { class: 'section-head' }, [H('h2', { id: 'td-kept-h', tabindex: '-1', 'data-fk': 'td-kept-h' }, T('td_kept_h'))]),
      H('ul', { class: 'kept-list' }, kept.map(function (id) {
        var o = anyTopic(id), talk = !!o.kind;
        return H('li', { class: 'kept-item' }, [
          H('span', { class: 'kept-thumb' }, [DES.raw(TDD.cardArt(o))]),
          H('div', { class: 'kept-text' }, [
            talk ? kindEl(o) : null,
            H('h3', null, pick(o.title)),
            H('div', { class: 'kept-ops' }, [
              H('a', { class: 'btn small', href: '#today/' + id, 'data-fk': 'ktry:' + id }, T(talk ? 'td_think' : 'td_try')),
              btn(T('remove'), 'td-unkeep', { id: id, kls: 'ghost', attrs: { 'aria-label': T('remove') + ': ' + pick(o.title) } })
            ])
          ])
        ]);
      }))
    ]);
  }
  // サークル対話に持っていく問い（入っている時だけ。お題の問い + 選んだ問いがあればその文）
  function circleSec() {
    var list = S().odai.circle;
    if (!list.length) return null;
    return H('section', { class: 'odai-kept odai-circle', 'aria-labelledby': 'td-circle-h' }, [
      H('div', { class: 'section-head' }, [H('h2', { id: 'td-circle-h', tabindex: '-1', 'data-fk': 'td-circle-h' }, T('td_circle_h'))]),
      H('ul', { class: 'kept-list' }, list.map(function (c) {
        var o = TDD.getDialog(c.id), a = c.ask ? TDD.askOf(o, c.ask) : null;
        return H('li', { class: 'kept-item' }, [
          H('span', { class: 'kept-thumb' }, [DES.raw(TDD.cardArt(o))]),
          H('div', { class: 'kept-text' }, [
            kindEl(o),
            H('h3', null, pick(o.title)),
            a ? H('p', { class: 'circle-ask' }, [H('span', { class: 'odai-k' }, T('td_ask_chosen') + ': '), H('span', null, pick(a.text))]) : null,
            H('div', { class: 'kept-ops' }, [
              H('a', { class: 'btn small', href: '#today/' + c.id, 'data-fk': 'ctry:' + c.id }, T('td_think')),
              btn(T('remove'), 'td-uncircle', { id: c.id, kls: 'ghost', attrs: { 'aria-label': T('remove') + ': ' + pick(o.title) } })
            ])
          ])
        ]);
      }))
    ]);
  }
  function renderList(main) {
    var u = ui(), st = S().odai;
    main.textContent = '';
    var kids = [
      H('div', { class: 'page-head' }, [H('div', null, [H('h1', { tabindex: '-1', 'data-fk': 'today-h' }, T('today')), H('p', null, T('td_sub'))])]),
      H('section', { class: 'odai-sec', 'aria-labelledby': 'td-sec-talk' }, [H('h2', { class: 'odai-sec-h', id: 'td-sec-talk' }, T('td_sec_talk')),
        H('div', { class: 'odai-cards' }, KINDS.map(function (k) { return dcard(TDD.getDialog(st.dslots[k]), k, u.dfresh === k); }))]),
      H('section', { class: 'odai-sec', 'aria-labelledby': 'td-sec-make' }, [H('h2', { class: 'odai-sec-h', id: 'td-sec-make' }, T('td_sec_make')),
        H('div', { class: 'odai-cards' }, st.slots.map(function (id, i) { return card(TDD.get(id), i, u.fresh === i); }))])
    ];
    var k = keptSec();
    if (k) kids.push(k);
    var c = circleSec();
    if (c) kids.push(c);
    main.appendChild(H('div', { class: 'today-page' }, kids));
    u.fresh = null;
    u.dfresh = null;
  }

  // ---------- 詳細（§X-2） ----------
  var ENTRY_ICON = { watch: 'camera', find: 'check', play: 'sliders', make: 'make' };
  function entriesEl(o, open) {
    var hasAct = !!actFor(o.id);
    return H('section', { class: 'td-entries', 'aria-labelledby': 'td-entries-h' }, [
      H('h2', { id: 'td-entries-h' }, T('td_entries_h')),
      H('div', { class: 'td-entry-grid' }, ENTRIES.map(function (k) {
        // 作ってみる は作業台へ移る（その場では開かない）。同じお題から作った活動があれば「続きを作る」
        if (k === 'make') {
          return H('button', { class: 'td-entry is-make', type: 'button', 'data-action': 'td-make', 'data-id': o.id }, [icon('make'),
            H('strong', null, T(hasAct ? 'resume_make' : 'td_e_make')), H('span', null, T(hasAct ? 'td_d_resume' : 'td_d_make'))]);
        }
        var on = open === k;
        return H('button', { class: 'td-entry' + (on ? ' on' : ''), type: 'button', id: 'td-e-' + k, 'data-action': 'td-entry', 'data-id': o.id, 'data-arg': k,
          'aria-expanded': on ? 'true' : 'false', 'aria-controls': on ? 'td-panel' : null }, [icon(ENTRY_ICON[k]), H('strong', null, T('td_e_' + k)), H('span', null, T('td_d_' + k))]);
      }))
    ]);
  }
  function watchEl(o) {
    return [
      // 外部の埋め込みはしない（file:// で動く・外部依存なし）。枠と出典と見どころだけ
      H('div', { class: 'td-video', role: 'img', 'aria-label': T('td_video') }, [H('div', { class: 'td-video-art' }, [DES.raw(TDD.cardArt(o))]), H('p', { class: 'td-video-cap', 'aria-hidden': 'true' }, T('td_video'))]),
      H('p', { class: 'td-src' }, pick(o.watch.src)),
      H('h3', null, T('td_points_h')),
      H('ol', { class: 'td-points' }, o.watch.points.map(function (p) { return H('li', null, [H('span', { class: 'td-time' }, p.t), H('span', null, pick(p.text))]); }))
    ];
  }
  function findEl(o, t) {
    var checks = t ? t.checks : [], found = t ? t.found : [], kids = [];
    if (o.outdoor) kids.push(H('p', { class: 'td-out-note' }, T('td_out_note')));
    kids.push(H('h3', { id: 'td-hints-h' }, T('td_hints_h')));
    kids.push(H('ul', { class: 'td-hints', 'aria-labelledby': 'td-hints-h' }, o.find.hints.map(function (h, i) {
      var id = 'td-hint-' + i;
      return H('li', null, [H('label', { class: 'td-hint', for: id }, [
        H('input', { type: 'checkbox', id: id, 'data-ui': 'td-hint', 'data-id': o.id, 'data-arg': String(i), checked: checks.indexOf(i) >= 0 }),
        H('span', null, pick(h))])]);
    })));
    kids.push(H('div', { class: 'actions' }, [btn(T('td_found_btn'), 'td-found-open', { id: o.id, icon: 'camera', attrs: { 'aria-haspopup': 'dialog' } })]));
    if (found.length) {
      kids.push(H('h3', { id: 'td-found-h' }, T('td_found_h')));
      kids.push(H('ul', { class: 'td-found', 'aria-labelledby': 'td-found-h' }, found.map(function (f, i) {
        var p = TDD.photo(o, f.photo), cap = f.line || pick(p.label);
        return H('li', null, [H('figure', null, [DES.raw(TDD.photoArt(o, f.photo)),
          H('figcaption', null, [H('span', { class: 'td-found-line' }, cap), H('span', { class: 'td-time' }, f.time)])]),
          btn(T('td_found_del'), 'td-found-del', { id: o.id, arg: String(i), kls: 'ghost', attrs: { 'aria-label': T('td_found_del') + ': ' + cap } })]);
      })));
    }
    return kids;
  }
  function valueName(s, v) { return pick(TDD.valueName(s, v)); }
  function playEl(o) {
    var r = play(o, ui().play[o.id]);
    return [
      H('div', { class: 'td-play-art', 'data-play-art': o.id }, [DES.raw(r.art)]),
      H('div', { class: 'td-play-tools' }, o.play.sliders.map(function (s) {
        var id = 'td-p-' + s.key, v = r.values[s.key];
        return H('div', { class: 'range-row' }, [
          H('label', { for: id }, pick(s.label)),
          H('input', { id: id, type: 'range', min: String(s.min), max: String(s.max), step: '1', value: String(v), 'data-ui': 'td-play', 'data-id': o.id, 'data-key': s.key, 'aria-valuetext': valueName(s, v) }),
          H('output', { for: id, 'data-out': s.key }, valueName(s, v))
        ]);
      })),
      // 結果は「確かめたこと」ではなく「このモックでの動き」
      H('p', { class: 'td-result' }, [H('span', { class: 'rl-label' }, T('td_play_label') + ':'), ' ', H('span', { 'data-play-result': o.id }, pick(r.result))])
    ];
  }
  function panelEl(o, k, t) {
    var kids = k === 'watch' ? watchEl(o) : (k === 'find' ? findEl(o, t) : playEl(o));
    return H('section', { class: 'td-panel card', id: 'td-panel', 'aria-labelledby': 'td-e-' + k, 'data-fk': 'td-panel:' + k, tabindex: '-1' }, kids);
  }
  function ownForm(o) {
    var u = ui(), dis = !trim(u.own.text);
    return H('div', { class: 'inline-edit td-own', 'data-fk': 'td-own:' + o.id }, [
      H('label', { for: 'td-own' }, T('td_own_label')),
      H('input', { id: 'td-own', type: 'text', 'data-ui': 'td-own', value: u.own.text, autocomplete: 'off', 'aria-describedby': 'td-own-need' }),
      H('p', { class: 'hint', id: 'td-own-need', hidden: !dis }, T('td_own_need')),
      H('div', { class: 'actions' }, [btn(T('td_own_ok'), 'td-own-ok', { id: o.id, kls: 'orange', disabled: dis }), btn(T('cancel'), 'td-own-cancel', { id: o.id })])
    ]);
  }
  // 始めた後（入口を 1 つでも開いたら）: ここだけ変える（試して遊ぶを開く）/ 自分の案にする（問いを書き換えて作業台へ）
  function headOps(o) {
    var u = ui(), ops = [keepBtn(o)], ownOpen = !!(u.own && u.own.id === o.id);
    if (isStarted(S().odai, o.id)) {
      ops.push(btn(T('td_change_here'), 'td-change-here', { id: o.id, icon: 'sliders' }));
      ops.push(btn(T('td_own_idea'), 'td-own-open', { id: o.id, icon: 'quote', attrs: { 'aria-expanded': ownOpen ? 'true' : 'false' } }));
    }
    var out = [H('div', { class: 'td-head-ops' }, ops)];
    if (ownOpen) out.push(ownForm(o));
    return out;
  }
  function renderDetail(main, o) {
    var u = ui(), t = S().odai.tried[o.id], open = u.open[o.id] || null;
    main.textContent = '';
    var info = [H('h1', { tabindex: '-1', 'data-fk': 'td-h:' + o.id }, pick(o.title)), whyEl(o), marksEl(o), lineEl('td_first', o.firstStep), lineEl('td_need', o.need)].concat(headOps(o));
    var kids = [
      H('p', { class: 'td-back' }, [H('a', { class: 'link-btn', href: '#today', 'data-action': 'td-back', 'data-id': o.id, 'aria-label': T('td_back') }, [H('span', { 'aria-hidden': 'true' }, '←'), H('span', null, T('today'))])]),
      H('div', { class: 'td-head' }, [H('figure', { class: 'td-hero' }, [DES.raw(TDD.cardArt(o))]), H('div', { class: 'td-info' }, info)]),
      entriesEl(o, open)
    ];
    if (open) kids.push(panelEl(o, open, t));
    main.appendChild(H('div', { class: 'today-page odai-detail', 'data-odai': o.id }, kids));
    // 詳細を開いたら h1 へ（§X-9）
    if (u.shownDetail !== o.id) { u.shownDetail = o.id; var h = main.querySelector('h1'); if (h) h.focus(); }
  }

  // ---------- §AE-4 対話のお題の詳細 ----------
  var DENTRY_ICON = { facts: 'record', views: 'chat', asks: 'quote', mine: 'check' };
  function dentries(o) { return OPENS.filter(function (k) { return k !== 'views' || o.views.length > 0; }); }
  function dentriesEl(o, open) {
    var list = dentries(o);
    return H('section', { class: 'td-entries', 'aria-labelledby': 'td-entries-h' }, [
      H('h2', { id: 'td-entries-h' }, T('td_entries_h')),
      H('div', { class: 'td-entry-grid n' + list.length }, list.map(function (k) {
        var on = open === k, label = k === 'facts' && o.kind === 'news' ? T('td_e_facts_news') : T('td_e_' + k);
        return H('button', { class: 'td-entry' + (on ? ' on' : ''), type: 'button', id: 'td-e-' + k, 'data-action': 'td-dentry', 'data-id': o.id, 'data-arg': k,
          'aria-expanded': on ? 'true' : 'false', 'aria-controls': on ? 'td-panel' : null }, [icon(DENTRY_ICON[k]), H('strong', null, label), H('span', null, T('td_d_' + k))]);
      }))
    ]);
  }
  // 出典の名前（リンク）。href はデータ内の定数の URL だけ
  function srcEl(o, s) {
    var links = [];
    TDD.srcIds(s).forEach(function (sid) {
      var x = TDD.sourceOf(o, sid);
      if (!x) return;
      if (links.length) links.push('・');
      links.push(H('a', { class: 'td-src-link', href: x.url, target: '_blank', rel: 'noopener noreferrer' }, x.name));
    });
    return links.length ? H('span', { class: 'td-src-of' }, [T('td_src') + ': '].concat(links)) : null;
  }
  function fmtChecked(o) {
    var c = o.sources.length ? String(o.sources[0].checked).split('-') : null;
    return c ? T('td_checked', { date: T('td_date_full', { y: +c[0], m: +c[1], d: +c[2] }) }) : '';
  }
  function factsEl(o) {
    var hasSrc = o.facts.some(function (f) { return TDD.srcIds(f.src).length > 0; });
    return [
      H('ul', { class: 'td-facts' }, o.facts.map(function (f) { return H('li', null, [H('span', null, pick(f.text)), srcEl(o, f.src)]); })),
      hasSrc ? H('p', { class: 'td-checked' }, fmtChecked(o)) : null
    ];
  }
  function viewsEl(o) {
    return [
      H('ul', { class: 'td-views' }, o.views.map(function (v) {
        return H('li', { class: 'td-view' }, [H('strong', null, pick(v.who)), H('p', null, pick(v.stance)), srcEl(o, v.src)]);
      })),
      H('p', { class: 'td-views-more' }, T('td_views_more'))
    ];
  }
  function asksEl(o, th) {
    var cur = th ? th.ask : null;
    return [H('fieldset', { class: 'td-choices' }, [H('legend', null, T('td_asks_legend'))].concat(o.asks.map(function (a) {
      var id = 'td-ask-' + a.level;
      return H('label', { class: 'td-hint td-choice', for: id }, [
        H('input', { type: 'radio', id: id, name: 'td-ask', value: a.level, 'data-ui': 'td-ask', 'data-id': o.id, checked: cur === a.level }),
        H('span', null, pick(a.text))]);
    })))];
  }
  function stanceLabel(o, sid) { var s = TDD.stanceOf(o, sid); return s ? pick(s.label) : T('td_stance_none'); }
  function mineOf(id) { var m = ui().dmine; if (!m[id]) m[id] = { stance: null, line: '' }; return m[id]; }
  function mineEl(o, th) {
    var mine = mineOf(o.id), a = th && th.ask ? TDD.askOf(o, th.ask) : null, dis = !mine.stance, kids = [];
    if (a) kids.push(H('div', { class: 'td-chosen' }, [H('span', { class: 'odai-k' }, T('td_ask_chosen')), H('p', null, pick(a.text))]));
    var opts = o.stances.map(function (s) { return { id: s.id, label: pick(s.label) }; }).concat([{ id: 'none', label: T('td_stance_none') }]);
    kids.push(H('fieldset', { class: 'td-choices' }, [H('legend', null, T('td_stance_legend'))].concat(opts.map(function (s) {
      var id = 'td-stance-' + s.id;
      return H('label', { class: 'td-hint td-choice', for: id }, [
        H('input', { type: 'radio', id: id, name: 'td-stance', value: s.id, 'data-ui': 'td-stance', 'data-id': o.id, checked: mine.stance === s.id }),
        H('span', null, s.label)]);
    }))));
    kids.push(H('div', { class: 'inline-edit td-mine-line' }, [
      H('label', { for: 'td-mark-line' }, T('td_mark_line')),
      H('input', { id: 'td-mark-line', type: 'text', maxlength: String(LINE_MAX), 'data-ui': 'td-mark-line', 'data-id': o.id, value: mine.line, autocomplete: 'off' })
    ]));
    kids.push(H('p', { class: 'hint td-mark-need', id: 'td-mark-need', hidden: !dis }, T('td_mark_need')));
    kids.push(H('div', { class: 'actions' }, [btn(T('td_mark_put'), 'td-mark-put', { id: o.id, kls: 'orange td-put', disabled: dis, attrs: { 'aria-describedby': 'td-mark-need' } })]));
    return kids;
  }
  function dpanelEl(o, k, th) {
    var kids = k === 'facts' ? factsEl(o) : (k === 'views' ? viewsEl(o) : (k === 'asks' ? asksEl(o, th) : mineEl(o, th)));
    return H('section', { class: 'td-panel card', id: 'td-panel', 'aria-labelledby': 'td-e-' + k, 'data-fk': 'td-panel:' + k, tabindex: '-1' }, kids);
  }
  // 考えのあしあと（新しいものが上。時刻・立場・1 行。1 件ずつ外せる）
  function marksSec(o, th) {
    if (!th || !th.marks.length) return null;
    return H('section', { class: 'td-marks', 'aria-labelledby': 'td-marks-h' }, [
      H('h2', { id: 'td-marks-h', tabindex: '-1', 'data-fk': 'td-marks-h' }, T('td_marks_h')),
      H('ol', { class: 'td-mark-list' }, th.marks.map(function (m) {
        var lb = stanceLabel(o, m.stance);
        return H('li', { class: 'td-mark' }, [H('span', { class: 'td-time' }, m.time), H('strong', null, lb), m.line ? H('span', { class: 'td-mark-line' }, m.line) : null,
          btn(T('remove'), 'td-mark-del', { id: o.id, arg: m.id, kls: 'ghost', attrs: { 'aria-label': T('remove') + ': ' + lb } })]);
      }))
    ]);
  }
  // 次の一歩（入口を 1 つでも開いたら）: バディと話す / サークル対話に持っていく / 作ってみる
  function nextSec(o) {
    var inC = inCircle(S().odai, o.id), hasAct = !!actFor(o.id);
    return H('section', { class: 'td-next', 'aria-labelledby': 'td-next-h' }, [
      H('h2', { id: 'td-next-h' }, T('td_next_h')),
      H('div', { class: 'td-next-ops' }, [
        btn(T('td_next_talk'), 'td-dtalk', { id: o.id, icon: 'talk' }),
        btn(T(inC ? 'td_next_circle_on' : 'td_next_circle'), 'td-dcircle', { id: o.id, icon: inC ? 'check' : 'chat', kls: inC ? 'is-on' : '', attrs: { 'aria-pressed': inC ? 'true' : 'false' } }),
        btn(T(hasAct ? 'resume_make' : 'td_e_make'), 'td-dmake', { id: o.id, icon: 'make' })
      ])
    ]);
  }
  function renderDialog(main, o) {
    var u = ui(), st = S().odai, th = st.think[o.id], open = u.open[o.id] || null;
    if (open && dentries(o).indexOf(open) < 0) open = null;
    main.textContent = '';
    var info = [kindEl(o), H('h1', { tabindex: '-1', 'data-fk': 'td-h:' + o.id }, pick(o.title))];
    if (o.heavy) info.push(H('p', { class: 'td-heavy-note' }, T('td_heavy_note')));
    info.push(whyEl(o), dmarksEl(o), H('div', { class: 'td-head-ops' }, [keepBtn(o)]));
    var kids = [
      H('p', { class: 'td-back' }, [H('a', { class: 'link-btn', href: '#today', 'data-action': 'td-back', 'data-id': o.id, 'aria-label': T('td_back') }, [H('span', { 'aria-hidden': 'true' }, '←'), H('span', null, T('today'))])]),
      H('div', { class: 'td-head' }, [H('figure', { class: 'td-hero' }, [DES.raw(TDD.cardArt(o))]), H('div', { class: 'td-info' }, info)]),
      dentriesEl(o, open)
    ];
    if (open) kids.push(dpanelEl(o, open, th));
    var ms = marksSec(o, th);
    if (ms) kids.push(ms);
    if (isOpened(st, o.id)) kids.push(nextSec(o));
    main.appendChild(H('div', { class: 'today-page odai-detail is-talk', 'data-odai': o.id }, kids));
    if (u.shownDetail !== o.id) { u.shownDetail = o.id; var h = main.querySelector('h1'); if (h) h.focus(); }
  }

  TD.render = function (main, arg) {
    var u = ui();
    if (arg) {
      var o = TDD.get(arg), d = o ? null : TDD.getDialog(arg);
      if (o) renderDetail(main, o);
      else if (d) renderDialog(main, d);
      else {
        // 無い id は一覧へ（履歴に残さない）+ トースト
        renderList(main);
        if (u.missing !== arg) { u.missing = arg; DES.app.toast(T('td_not_found')); }
        window.location.replace('#today');
      }
    } else renderList(main);
    if (u.pendingFocus) { var n = main.querySelector('[data-fk="' + esc(u.pendingFocus) + '"]'); if (n) { u.pendingFocus = null; n.focus(); } }
  };
  // ルートが変わったら一時的な UI を閉じる（app.js の closeTransient から）。pendingFocus は戻った先で使うので残す
  TD.resetUi = function () { var u = ui(); u.open = {}; u.play = {}; u.own = null; u.shownDetail = null; u.missing = null; u.fresh = null; u.dfresh = null; u.dmine = {}; };

  // ---------- 見つけた写真を残す（小さなダイアログ。ダミーの線画から 1 枚 + 任意の 1 行） ----------
  function renderDlg() {
    var d = ui().dlg, dlg = dlgEl(), o = d && TDD.get(d.id);
    if (!o) return;
    var putBack = DES.make.clearDialog(dlg);
    dlg.setAttribute('aria-labelledby', 'td-dlg-h');
    dlg.appendChild(H('div', { class: 'dialog-head' }, [H('h2', { id: 'td-dlg-h' }, T('td_found_btn')),
      H('button', { class: 'icon-btn', type: 'button', 'data-action': 'dialog-close', 'aria-label': T('close') }, [icon('close')])]));
    var body = H('div', { class: 'dialog-body' }, [
      H('fieldset', { class: 'cap-images' }, [H('legend', null, T('td_found_pick')), H('div', { class: 'cap-thumbs' }, o.find.photos.map(function (p) {
        var on = d.photo === p.id;
        return H('button', { class: 'cap-thumb' + (on ? ' on' : ''), type: 'button', 'data-action': 'td-found-pick', 'data-arg': p.id, 'aria-pressed': on ? 'true' : 'false', 'aria-label': pick(p.label) },
          [DES.raw(TDD.photoArt(o, p.id)), on ? H('span', { class: 'cap-check', 'aria-hidden': 'true' }, [icon('check')]) : null]);
      }))]),
      H('div', { class: 'field' }, [H('label', { for: 'td-found-line' }, T('td_found_line')),
        H('input', { id: 'td-found-line', type: 'text', 'data-ui': 'td-found-line', value: d.line, autocomplete: 'off' })]),
      H('p', { class: 'face-note' }, T('td_found_note'))
    ]);
    if (d.failed) body.appendChild(H('p', { class: 'dlg-error', role: 'alert' }, T('save_fail')));
    dlg.appendChild(body);
    dlg.appendChild(H('div', { class: 'dialog-footer' }, [
      H('button', { class: 'btn primary', type: 'button', 'data-action': 'td-found-ok' }, d.failed ? T('retry_save') : T('keep_text')),
      H('button', { class: 'btn', type: 'button', 'data-action': 'dialog-close' }, T('cancel'))
    ]));
    putBack();
  }
  function dlgFocus(sel) { var n = dlgEl().querySelector(sel); if (n) n.focus(); }

  // ---------- 操作 ----------
  var A = DES.actions = DES.actions || {};
  function setOdai(next, o) { DES.app.change(function () { S().odai = next; }, o); }
  // 入口の記録だけを保存する（作業台へ移る前。移った先の描き直しを待たない）
  function markAndSave(id, k) {
    var st = S().odai, next = markEntry(st, id, k);
    if (next === st) return;
    S().odai = next;
    if (!DES.store.save('odai')) S().saveFailed = true;
  }
  // 別のお題を見る: 150ms のクロスフェード（前のカードの中身が消えながら、新しい中身が出る。reduced-motion で即時）
  // 前の中身は描き直す前に写しておき、新しいカードの上に重ねて消す（読み上げ・操作・フォーカスの対象にしない）
  function ghostOf(card) {
    var g = H('div', { class: 'odai-ghost', 'aria-hidden': 'true' });
    g.setAttribute('inert', '');
    Array.prototype.forEach.call(card.children, function (c) { if (!c.classList.contains('odai-ghost')) g.appendChild(c.cloneNode(true)); });
    Array.prototype.forEach.call(g.querySelectorAll('*'), function (n) {
      ['id', 'data-action', 'data-fk', 'href', 'tabindex', 'aria-labelledby', 'aria-pressed'].forEach(function (k) { n.removeAttribute(k); });
    });
    return g;
  }
  A['td-swap'] = function (el) {
    var i = +el.getAttribute('data-arg'), st = S().odai, next = swap(st, i);
    if (next === st) return;
    var old = motionOK() ? document.querySelector('.odai-card[data-fk="odai:' + i + '"]') : null, ghost = old ? ghostOf(old) : null;
    ui().fresh = ghost ? i : null;
    setOdai(next);
    var card = ghost && document.querySelector('.odai-card[data-fk="odai:' + i + '"]');
    if (card) {
      card.appendChild(ghost);
      setTimeout(function () { if (ghost.parentNode) ghost.parentNode.removeChild(ghost); }, 200);
    }
  };
  function unkeepWithUndo(id) {
    var r = unkeep(S().odai, id);
    if (!r) return;
    setOdai(r.state, { focusFn: function () { return S().odai.kept.length ? 'td-kept-h' : (DES.app.routeArg() ? 'td-h:' + id : 'today-h'); } });
    DES.app.toast(T('removed_toast'), { label: T('undo_restore'), fn: function () {
      setOdai(keep(S().odai, r.undo.id, r.undo.index), { sel: '[data-action="td-keep"][data-id="' + esc(id) + '"],[data-action="td-unkeep"][data-id="' + esc(id) + '"]' });
    } });
  }
  // とっておく ⇔ とっておいた（押し直すと外す。元に戻す付き）
  A['td-keep'] = function (el) {
    var id = el.getAttribute('data-id'), st = S().odai;
    if (isKept(id)) { unkeepWithUndo(id); return; }
    var next = keep(st, id);
    if (next === st) return;
    // 保存できなければとっておかず、成功のトーストも出さない（save_fail。レビューへの裁定）
    if (!putOdai(next)) return;
    DES.app.toast(T('td_kept_toast'));
  };
  A['td-unkeep'] = function (el) { unkeepWithUndo(el.getAttribute('data-id')); };
  A['td-back'] = function (el) {
    var id = el.getAttribute('data-id'), st = S().odai;
    var inD = KINDS.some(function (k) { return st.dslots[k] === id; });
    ui().pendingFocus = st.slots.indexOf(id) >= 0 ? 'try:' + id : (inD ? 'dtry:' + id : (isKept(id) ? 'ktry:' + id : (inCircle(st, id) ? 'ctry:' + id : 'today-h')));
    window.location.hash = '#today';
  };

  // ---------- §AE 対話のお題の操作 ----------
  // 保存してから描き直す。保存に失敗したら画面の状態を戻し、save_fail を出す（共通の約束）
  // o.ok = 保存できた時だけ、描き直す前にする事（入力欄を空にする等。失敗した時は入力を残し、描き直しは 1 回だけ）
  function storeSave(k) { return DES.store.save(k); }
  function failSave(o) { DES.app.commit(o); DES.app.toast(T('save_fail')); }
  function putOdai(next, o) {
    o = o || {};
    if (next === S().odai) return false;
    if (!saveOdai(S(), next, storeSave)) { failSave(o); return false; }
    S().saveFailed = false;
    if (o.ok) o.ok();
    DES.app.commit(o);
    return true;
  }
  // 別のお題を見る（種類ごと）: 作る・ためすのカードと同じ 150ms のクロスフェード
  A['td-dswap'] = function (el) {
    var k = el.getAttribute('data-arg'), next = swapKind(S().odai, k);
    if (next === S().odai) return;
    var sel = '.odai-card[data-fk="dodai:' + esc(k) + '"]', old = motionOK() ? document.querySelector(sel) : null, ghost = old ? ghostOf(old) : null;
    ui().dfresh = ghost ? k : null;
    if (!putOdai(next)) return;
    var c = ghost && document.querySelector(sel);
    if (c) {
      c.appendChild(ghost);
      setTimeout(function () { if (ghost.parentNode) ghost.parentNode.removeChild(ghost); }, 200);
    }
  };
  // 入口を開く（同時に 1 つ。もう一度押すと閉じる）。開いたことは記録に残す。保存できなければ開かない（記録とパネルを食い違わせない）
  A['td-dentry'] = function (el) {
    var id = el.getAttribute('data-id'), k = el.getAttribute('data-arg'), u = ui(), r = openDEntry(S(), u.open, id, k, storeSave);
    if (r.saved === false) { failSave(); return; }
    if (r.saved) S().saveFailed = false;
    DES.app.commit();
    var p = u.open[id] && document.getElementById('td-panel');
    if (p && p.scrollIntoView) p.scrollIntoView({ block: 'nearest' });
  };
  function syncMine(id) {
    var dis = !mineOf(id).stance, b = document.querySelector('[data-action="td-mark-put"]'), h = document.getElementById('td-mark-need');
    if (b) b.disabled = dis;
    if (h) h.hidden = !dis;
  }
  // 自分の考えを置く → 考えのあしあとに 1 件（入力中の 1 行は空に戻す。立場の選択は残す）
  A['td-mark-put'] = function (el) {
    var id = el ? el.getAttribute('data-id') : null;
    if (!id) { var b = document.querySelector('[data-action="td-mark-put"]'); id = b ? b.getAttribute('data-id') : null; }
    var mine = id ? mineOf(id) : null;
    if (!mine || !mine.stance) return;
    var next = putMark(S().odai, id, { stance: mine.stance, line: mine.line, time: stamp() });
    // 保存できた時だけ 1 行を空に戻す。失敗した時は入力を残したまま 1 回だけ描き直し、フォーカスを「置く」（Enter なら入力欄）に戻す
    if (!putOdai(next, { sel: '[data-action="td-mark-put"]', ok: function () { mine.line = ''; } })) return;
    var put = document.querySelector('[data-action="td-mark-put"]');
    if (put) put.focus();
    DES.app.toast(T('td_mark_toast'));
  };
  A['td-mark-del'] = function (el) {
    var id = el.getAttribute('data-id'), mid = el.getAttribute('data-arg'), r = removeMark(S().odai, id, mid);
    if (!r) return;
    var left = r.state.think[id].marks;
    if (!putOdai(r.state, { sel: left.length ? '[data-action="td-mark-del"][data-arg="' + esc(left[Math.min(r.undo.index, left.length - 1)].id) + '"]' : '[data-action="td-dentry"][data-arg="mine"]' })) return;
    DES.app.toast(T('td_mark_removed'), { label: T('undo_restore'), fn: function () {
      // 元に戻した考えの「外す」へフォーカス（古い考えを戻しても、先頭の考えへ飛ばない）
      var back = restoreMark(S().odai, r.undo), mid = restoredMarkId(back, r.undo);
      putOdai(back, { sel: mid ? '[data-action="td-mark-del"][data-id="' + esc(id) + '"][data-arg="' + esc(mid) + '"]' : '[data-action="td-dentry"][data-arg="mine"]' });
    } });
  };
  // バディと話す: 話す画面の下書き（S().draft）に next.talk を入れて #talk へ（下書きがあれば改行して足す）
  A['td-dtalk'] = function (el) {
    var o = TDD.getDialog(el.getAttribute('data-id'));
    if (!o) return;
    // 保存できなければ下書きを変えず、#talk へ移らない・成功のトーストも出さない（save_fail。レビューへの裁定）
    if (!addTalk(S(), pick(o.next.talk), storeSave)) { failSave(); return; }
    S().saveFailed = false;
    DES.app.commit();
    DES.app.toast(T('prefilled'));
    DES.ui.focusComposer = true;
    window.location.hash = '#talk';
  };
  function uncircleWithUndo(id, focusSel) {
    var r = fromCircle(S().odai, id);
    if (!r) return;
    if (!putOdai(r.state, { sel: focusSel, focusFn: function () { return S().odai.circle.length ? 'td-circle-h' : (DES.app.routeArg() ? 'td-h:' + id : 'today-h'); } })) return;
    DES.app.toast(T('td_circle_removed'), { label: T('undo_restore'), fn: function () {
      putOdai(toCircle(S().odai, r.undo.item.id, r.undo.item, r.undo.index), { sel: '[data-action="td-dcircle"][data-id="' + esc(id) + '"],[data-action="td-uncircle"][data-id="' + esc(id) + '"]' });
    } });
  }
  // サークル対話に持っていく ⇔ 入れてある（押し直すと外す。元に戻す付き）。予定表は変えない
  A['td-dcircle'] = function (el) {
    var id = el.getAttribute('data-id'), st = S().odai;
    if (inCircle(st, id)) { uncircleWithUndo(id, '[data-action="td-dcircle"][data-id="' + esc(id) + '"]'); return; }
    var th = st.think[id];
    if (!putOdai(toCircle(st, id, { ask: th ? th.ask : null, time: stamp() }))) return;
    DES.app.toast(T('td_circle_toast'));
  };
  A['td-uncircle'] = function (el) { uncircleWithUndo(el.getAttribute('data-id'), null); };
  // 作ってみる: DES.make.openOdai と同じ移動（同じお題の活動があればそれを開く）。題 = next.makeTitle・手順 = next.makeSteps の外で作る活動
  A['td-dmake'] = function (el) {
    var o = TDD.getDialog(el.getAttribute('data-id'));
    if (!o) return;
    var r = dialogMake(S(), o, { id: DES.plan.newId('a'), mode: DES.mode(), now: DES.data.now,
      recText: T('td_make_rec', { q: pick(o.title), step: pick(o.next.makeSteps[0]) }) }, storeSave);
    if (!r) return;
    if (!r.created) { DES.make.openAct(r.id); return; }
    // 保存できなければ活動を足さず、作業台へ移らない（save_fail。レビューへの裁定）
    if (!r.ok) { failSave(); return; }
    S().saveFailed = false;
    DES.app.commit();
    if (window.location.hash !== '#make/' + r.id) window.location.hash = '#make/' + r.id; else DES.app.render();
  };
  // 入口を開く（同時に 1 つ。もう一度押すと閉じる）。開いたことは記録に残す
  A['td-entry'] = function (el) {
    var id = el.getAttribute('data-id'), k = el.getAttribute('data-arg'), u = ui();
    u.open[id] = u.open[id] === k ? null : k;
    setOdai(u.open[id] ? markEntry(S().odai, id, k) : S().odai);
    var p = u.open[id] && document.getElementById('td-panel');
    if (p && p.scrollIntoView) p.scrollIntoView({ block: 'nearest' });
  };
  A['td-make'] = function (el) {
    var o = TDD.get(el.getAttribute('data-id'));
    if (!o) return;
    markAndSave(o.id, 'make');
    DES.make.openOdai(o, null);
  };
  // ここだけ変える: 試して遊ぶを開いて、最初のスライダーへ
  A['td-change-here'] = function (el) {
    var id = el.getAttribute('data-id'), o = TDD.get(id);
    if (!o) return;
    ui().open[id] = 'play';
    setOdai(markEntry(S().odai, id, 'play'));
    var f = document.getElementById('td-p-' + o.play.sliders[0].key);
    if (f) { f.focus(); if (f.scrollIntoView) f.scrollIntoView({ block: 'nearest' }); }
  };
  A['td-own-open'] = function (el) {
    var id = el.getAttribute('data-id'), u = ui(), o = TDD.get(id);
    if (!o) return;
    if (u.own && u.own.id === id) { u.own = null; DES.app.render(); refocus('[data-action="td-own-open"]'); return; }
    u.own = { id: id, text: pick(o.title) };
    DES.app.render();
    var t = document.getElementById('td-own');
    if (t) { t.focus(); if (t.setSelectionRange) t.setSelectionRange(t.value.length, t.value.length); }
  };
  A['td-own-cancel'] = function () { ui().own = null; DES.app.render(); refocus('[data-action="td-own-open"]'); };
  A['td-own-ok'] = function () {
    var u = ui(), o = u.own && TDD.get(u.own.id), text = u.own ? trim(u.own.text) : '';
    if (!o || !text) return;
    markAndSave(o.id, 'make');
    u.own = null;
    DES.make.openOdai(o, text);
  };
  function syncOwn() {
    var dis = !trim(ui().own && ui().own.text), b = document.querySelector('[data-action="td-own-ok"]'), h = document.getElementById('td-own-need');
    if (b) b.disabled = dis;
    if (h) h.hidden = !dis;
  }
  // 残した写真を消す: 確認は出さず 5 秒の「元に戻す」（元の位置へ）
  A['td-found-del'] = function (el) {
    var id = el.getAttribute('data-id'), i = +el.getAttribute('data-arg'), r = removeFound(S().odai, id, i);
    if (!r) return;
    var left = r.state.tried[id].found.length;
    setOdai(r.state, { sel: left ? '[data-action="td-found-del"][data-arg="' + Math.min(i, left - 1) + '"]' : '[data-action="td-found-open"]' });
    DES.app.toast(T('td_found_deleted'), { label: T('undo_restore'), fn: function () {
      setOdai(restoreFound(S().odai, r.undo), { sel: '[data-action="td-found-del"][data-arg="' + i + '"]' });
    } });
  };
  A['td-found-open'] = function (el) {
    var o = TDD.get(el.getAttribute('data-id'));
    if (!o) return;
    ui().dlg = { id: o.id, photo: o.find.photos[0].id, line: '', failed: false };
    renderDlg();
    DES.app.openDialog(dlgEl(), el);
    dlgFocus('.cap-thumb.on');
  };
  A['td-found-pick'] = function (el) {
    var d = ui().dlg;
    if (!d) return;
    d.photo = el.getAttribute('data-arg');
    renderDlg();
    dlgFocus('.cap-thumb[data-arg="' + esc(d.photo) + '"]');
  };
  A['td-found-ok'] = function () {
    var d = ui().dlg;
    if (!d) return;
    var prev = S().odai, next = addFound(prev, d.id, { photo: d.photo, line: d.line, time: stamp() });
    if (next === prev) return;
    S().odai = next;
    // 失敗したら閉じずに理由を出し、記録はメモリにも残さない（再試行はフォームの今の値で）
    if (!DES.store.save('odai')) {
      S().odai = prev;
      S().saveFailed = true;
      d.failed = true;
      DES.app.renderSaveState();
      renderDlg();
      dlgFocus('[data-action="td-found-ok"]');
      return;
    }
    S().saveFailed = false;
    // 閉じたら開いた「見つけた写真を残す」へフォーカスが戻る
    DES.app.closeDialog(dlgEl());
    ui().dlg = null;
    DES.app.commit({ sel: '[data-action="td-found-open"]' });
    DES.app.toast(T('td_found_toast'));
  };

  // ---------- 入力の受け口 ----------
  function patchPlay(o) {
    var r = play(o, ui().play[o.id]);
    var a = document.querySelector('[data-play-art="' + esc(o.id) + '"]');
    if (a) { a.textContent = ''; a.appendChild(DES.raw(r.art)); }
    o.play.sliders.forEach(function (s) {
      var lbl = valueName(s, r.values[s.key]), out = document.querySelector('output[data-out="' + esc(s.key) + '"]'), inp = document.getElementById('td-p-' + s.key);
      if (out) out.textContent = lbl;
      if (inp) inp.setAttribute('aria-valuetext', lbl);
    });
    var res = document.querySelector('[data-play-result="' + esc(o.id) + '"]');
    if (res) res.textContent = pick(r.result);
  }
  TD.bind = function () {
    document.addEventListener('input', function (e) {
      var t = e.target, k = t && t.getAttribute ? t.getAttribute('data-ui') : null, u = ui();
      if (k === 'td-play') {
        var o = TDD.get(t.getAttribute('data-id'));
        if (!o) return;
        var v = clone(u.play[o.id] || TDD.defaults(o));
        v[t.getAttribute('data-key')] = +t.value;
        u.play[o.id] = play(o, v).values;
        patchPlay(o);
      } else if (k === 'td-own' && u.own) { u.own.text = t.value; syncOwn(); }
      else if (k === 'td-found-line' && u.dlg) u.dlg.line = t.value;
      else if (k === 'td-mark-line') mineOf(t.getAttribute('data-id')).line = t.value;
    });
    document.addEventListener('change', function (e) {
      var t = e.target, k = t && t.getAttribute ? t.getAttribute('data-ui') : null, id = k ? t.getAttribute('data-id') : null;
      // §AE: 問いを選ぶ（記録して描き直す・フォーカスは選んだラジオに残る）/ 立場を選ぶ（入力中の値。「置く」を使えるようにする）
      if (k === 'td-ask') { putOdai(pickAsk(S().odai, id, t.value), { sel: '#td-ask-' + esc(t.value) }); return; }
      if (k === 'td-stance') { mineOf(id).stance = t.value; syncMine(id); return; }
      if (k !== 'td-hint') return;
      var i = +t.getAttribute('data-arg');
      setOdai(toggleHint(S().odai, id, i));
    });
    document.addEventListener('keydown', function (e) {
      var t = e.target, k = t && t.getAttribute ? t.getAttribute('data-ui') : null;
      if (e.key === 'Enter' && !e.isComposing && k === 'td-mark-line') { e.preventDefault(); A['td-mark-put'](document.querySelector('[data-action="td-mark-put"]')); return; }
      if (e.key === 'Enter' && !e.isComposing && k === 'td-own') { e.preventDefault(); A['td-own-ok'](); return; }
      if (e.key === 'Enter' && !e.isComposing && k === 'td-found-line') { e.preventDefault(); A['td-found-ok'](); return; }
      if (e.key === 'Escape' && ui().own && !document.querySelector('dialog[open]') && DES.app.route() === 'today') { e.preventDefault(); A['td-own-cancel'](); }
    });
    var dlg = dlgEl();
    if (dlg) dlg.addEventListener('close', function () {
      var tEl = document.getElementById('toast');
      if (tEl && tEl.parentNode === dlg) document.body.appendChild(tEl);
      ui().dlg = null;
      dlg.textContent = '';
    });
  };
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
