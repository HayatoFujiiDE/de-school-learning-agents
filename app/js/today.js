/* 今日のお題（#today 一覧 / #today/<id> 詳細）: contract-LS §LS-13 / LS-18（データの出所・保存）+ CONTRACT-v3 §X / contract-app §AF（見た目・操作）。
   お題は実行時に工場の配信 API から読む（today-data.js の TDD.load。#today を初めて開いた時に 1 回）。読み込み中は見出しと節の枠だけ描き、
   届いたら差し替える（スピナーは出さない）。0 件 = td_empty の 1 文、取れなかった = td_fetch_fail の 1 文（節ごと。§LS-18-28）。
   一覧 = 話す・考える（news / talk / philo が 1 枚ずつ）+ 作る・ためす（3 枚まで）+ とっておいたお題 + サークル対話に持っていく問い。
   作る・ためすの詳細 = 実物を探す（手がかりがある時だけ）/ 作ってみる。対話のお題の詳細 = 前提を読む / いろいろな考えを見る / 問いを選ぶ / 自分の考えを置く
   + 考えのあしあと + 次の一歩（バディと話す / サークル対話 / 作ってみる）。回数・連続日数・完了は出さない。
   記録のキーは lineage_id。記録には お題の写し（copies[lineage]）を添えるので、配信から消えても 記録・あしあと・サークル・trail の表示が残る。
   純関数（TD.initial / normalize / swap / keep / unkeep / markEntry / addFound / toggleHint / putMark / toCircle …）は DOM と DES.t に触れず、
   node からも読める（tools/live-today-test.js）。保存は DES.store.register('odai') + DES.app.change → DES.store.save → 再描画 の 1 経路。 */
(function (root) {
  'use strict';
  var DES = root.DES = root.DES || {};
  var TDD = DES.todayData || (typeof require === 'function' ? require('./today-data.js') : null);
  var MD = DES.makeData || (typeof require === 'function' ? (function () { try { return require('./make-data.js'); } catch (e) { return null; } })() : null);
  var TD = DES.today = DES.today || {};
  var ENTRIES = ['find', 'make'], SLOTS = 3;
  // 対話のお題: 種類（news / talk / philo）・問いの段（check / self / open）・詳細の入口（前提 / 考え / 問い / 自分の考え）
  var KINDS = TDD.KINDS, LEVELS = TDD.LEVELS, OPENS = ['facts', 'views', 'asks', 'mine'], LINE_MAX = 80, FOUND_MAX = 6;

  // ---------- 小道具 ----------
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function isNat(n) { return typeof n === 'number' && isFinite(n) && n >= 0 && Math.floor(n) === n; }
  function trim(v) { return String(v == null ? '' : v).replace(/^\s+|\s+$/g, ''); }
  function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function okAt(v) { return v == null || (typeof v === 'string' && v.length <= 40 && !isNaN(Date.parse(v))); }
  // お題を引く（読み込んだお題 → この state の写し）。want: 'make' | 'dialog' | 'any'
  function topicOf(state, id, want) {
    var c = state && isObj(state.copies) ? state.copies : null;
    if (want === 'make') return TDD.resolve(id, c, 'make');
    if (want === 'dialog') return TDD.resolve(id, c, 'dialog');
    return TDD.resolve(id, c, 'make') || TDD.resolve(id, c, 'dialog');
  }
  // 記録に写しを添える（新しい版が届いていれば写しも新しくする）
  function withCopy(S, o) {
    if (!isObj(S.copies)) S.copies = {};
    S.copies[o.lineage] = TDD.copyOf(o);
    return S;
  }

  // ---------- 状態（des.live.odai）: { v, slots: [lineage ×3まで], dslots: { news, talk, philo }, kept: [lineage],
  //   tried: { lineage: { entries, found, checks } }, think: { lineage: { opened, ask, marks } }, circle: [{ id: lineage, ask, at, time }],
  //   copies: { lineage: { lineage, title, kind, body } } } ----------
  function initial() {
    return { v: 2, slots: [], dslots: { news: null, talk: null, philo: null }, kept: [], tried: {}, think: {}, circle: [], copies: {} };
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
        // 空の id は捨てる（外す・元に戻すが id で探すため）
        if (!isObj(m) || typeof m.id !== 'string' || !m.id || hasOwn(seen, m.id) || !isStance(o, m.stance) || !(m.line == null || typeof m.line === 'string') || typeof m.time !== 'string' || !okAt(m.at)) return;
        seen[m.id] = true;
        var line = m.line ? trim(m.line).slice(0, LINE_MAX) : '';
        out.marks.push({ id: m.id, stance: m.stance, line: line || null, at: m.at || null, time: m.time });
      });
    }
    return out;
  }
  function blankTried() { return { entries: { find: false, make: false }, found: [], checks: [] }; }
  function cleanTried(t, o) {
    if (!isObj(t)) return null;
    var out = blankTried(), hints = o.find ? o.find.hints.length : 0;
    if (isObj(t.entries)) ENTRIES.forEach(function (k) { out.entries[k] = t.entries[k] === true; });
    if (Array.isArray(t.found)) {
      out.found = t.found.filter(function (f) { return isObj(f) && TDD.photoValid(f.photo) && (f.line == null || typeof f.line === 'string') && typeof f.time === 'string' && okAt(f.at); })
        .slice(0, FOUND_MAX).map(function (f) { return { photo: { data: f.photo.data, w: f.photo.w, h: f.photo.h }, line: f.line ? String(f.line).slice(0, 120) : null, at: f.at || null, time: f.time }; });
    }
    if (Array.isArray(t.checks)) {
      t.checks.forEach(function (i) { if (isNat(i) && i < hints && out.checks.indexOf(i) < 0) out.checks.push(i); });
      out.checks.sort();
    }
    return out;
  }
  // 読み込んだ値を整える。形が違えばその項目だけ初期値に戻す。記録は写しがあるものだけ残す（読み込み前でも引けるように）。
  // どの記録からも指されていない写しは捨てる（保存を小さく保つ）
  function normalize(raw) {
    var out = initial();
    if (!isObj(raw)) return out;
    if (isObj(raw.copies)) Object.keys(raw.copies).forEach(function (k) { var c = TDD.checkCopy(raw.copies[k], k); if (c) out.copies[k] = c; });
    function copyKind(k) { return TDD.okLineage(k) && hasOwn(out.copies, k) ? out.copies[k].kind : null; }
    function isDialogKey(k) { return KINDS.indexOf(copyKind(k)) >= 0; }
    if (Array.isArray(raw.slots)) raw.slots.slice(0, SLOTS).forEach(function (id, i) { out.slots[i] = TDD.okLineage(id) ? id : null; });
    if (isObj(raw.dslots)) KINDS.forEach(function (k) { out.dslots[k] = TDD.okLineage(raw.dslots[k]) ? raw.dslots[k] : null; });
    if (Array.isArray(raw.kept)) raw.kept.forEach(function (id) { if (copyKind(id) && out.kept.indexOf(id) < 0) out.kept.push(id); });
    if (isObj(raw.tried)) {
      Object.keys(raw.tried).forEach(function (k) {
        if (copyKind(k) !== 'make') return;
        var t = cleanTried(raw.tried[k], out.copies[k].body);
        if (t) out.tried[k] = t;
      });
    }
    if (isObj(raw.think)) {
      Object.keys(raw.think).forEach(function (k) {
        if (!isDialogKey(k)) return;
        var t = cleanThink(raw.think[k], out.copies[k].body);
        if (t) out.think[k] = t;
      });
    }
    if (Array.isArray(raw.circle)) {
      raw.circle.forEach(function (c) {
        if (!isObj(c) || !isDialogKey(c.id) || typeof c.time !== 'string' || !okAt(c.at) || !(c.ask == null || LEVELS.indexOf(c.ask) >= 0)) return;
        if (out.circle.some(function (x) { return x.id === c.id; })) return;
        out.circle.push({ id: c.id, ask: c.ask == null ? null : c.ask, at: c.at || null, time: c.time });
      });
    }
    var used = {};
    out.kept.forEach(function (k) { used[k] = true; });
    Object.keys(out.tried).concat(Object.keys(out.think)).forEach(function (k) { used[k] = true; });
    out.circle.forEach(function (c) { used[c.id] = true; });
    Object.keys(out.copies).forEach(function (k) { if (!hasOwn(used, k)) delete out.copies[k]; });
    return out;
  }

  // ---------- 一覧に出すお題（読み込んだお題から。保存した slots / dslots は「別のお題を見る」の位置） ----------
  // 作る・ためす: 3 枚まで。保存した位置のお題が今もあればそのまま、無ければプールの先頭から重ならないものを入れる
  function shownSlots(state, pool) {
    pool = pool || TDD.pool();
    var n = Math.min(SLOTS, pool.length), out = [], used = {};
    for (var i = 0; i < n; i++) {
      var id = state && Array.isArray(state.slots) ? state.slots[i] : null;
      if (id && pool.indexOf(id) >= 0 && !hasOwn(used, id)) { out[i] = id; used[id] = true; } else out[i] = null;
    }
    for (var j = 0; j < n; j++) {
      if (out[j]) continue;
      for (var k = 0; k < pool.length; k++) if (!hasOwn(used, pool[k])) { out[j] = pool[k]; used[pool[k]] = true; break; }
    }
    return out;
  }
  function shownKind(state, kind, pool) {
    pool = pool || TDD.kindPool(kind);
    var id = state && isObj(state.dslots) ? state.dslots[kind] : null;
    return id && pool.indexOf(id) >= 0 ? id : (pool[0] || null);
  }
  // 別のお題を見る: そのスロットだけ、プールの次のお題へ（他のスロットに出ているものは飛ばす）。一巡したら最初に戻る。差し替えられない時は同じ state
  function swap(state, slotIdx, pool) {
    pool = pool || TDD.pool();
    var shown = shownSlots(state, pool), cur = shown[slotIdx];
    if (!cur) return state;
    var start = pool.indexOf(cur);
    for (var k = 1; k <= pool.length; k++) {
      var id = pool[(start + k) % pool.length];
      if (id === cur || shown.indexOf(id) >= 0) continue;
      var S = clone(state);
      S.slots = shown.slice();
      S.slots[slotIdx] = id;
      return S;
    }
    return state;
  }
  function swapKind(state, kind, pool) {
    if (KINDS.indexOf(kind) < 0 || !state) return state;
    pool = pool || TDD.kindPool(kind);
    var cur = shownKind(state, kind, pool), start = pool.indexOf(cur);
    if (pool.length < 2 || start < 0) return state;
    var S = clone(state);
    if (!isObj(S.dslots)) S.dslots = { news: null, talk: null, philo: null };
    S.dslots[kind] = pool[(start + 1) % pool.length];
    return S;
  }

  function lineageIn(state, id) { var o = topicOf(state, id, 'any'); return o ? o.lineage : null; }
  function isKeptIn(state, id) { var l = lineageIn(state, id) || id; return !!(state && Array.isArray(state.kept) && state.kept.indexOf(l) >= 0); }
  // とっておく（新しいものが先頭。at を渡すとその位置へ = 外すの元に戻す）
  // id は 'fx-' id / lineage / お題そのもの（元に戻す時、お題が配信から消えていても写しから戻せるように）
  function keep(state, id, at) {
    var o = isObj(id) && id.lineage ? id : topicOf(state, id, 'any');
    if (!o || isKeptIn(state, o.lineage)) return state;
    var S = withCopy(clone(state), o);
    S.kept.splice(Math.max(0, Math.min(at == null ? 0 : at | 0, S.kept.length)), 0, o.lineage);
    return S;
  }
  function unkeep(state, id) {
    var l = lineageIn(state, id) || id, i = state && Array.isArray(state.kept) ? state.kept.indexOf(l) : -1;
    if (i < 0) return null;
    var S = clone(state);
    S.kept.splice(i, 1);
    return { state: S, undo: { id: l, index: i } };
  }
  function triedOf(S, l) { if (!S.tried[l]) S.tried[l] = blankTried(); return S.tried[l]; }
  // 入口を開いた = やってみた の記録（画面に回数や完了は出さない）
  function markEntry(state, id, entry) {
    var o = topicOf(state, id, 'make');
    if (!o || ENTRIES.indexOf(entry) < 0) return state;
    var t = state.tried && state.tried[o.lineage];
    if (t && t.entries && t.entries[entry] && state.copies && state.copies[o.lineage]) return state;
    var S = withCopy(clone(state), o);
    triedOf(S, o.lineage).entries[entry] = true;
    return S;
  }
  function isStarted(state, id) {
    var l = lineageIn(state, id) || id, t = state && state.tried && state.tried[l];
    return !!(t && t.entries && ENTRIES.some(function (k) { return t.entries[k]; }));
  }
  function foundOf(state, id) { var l = lineageIn(state, id) || id, t = state && state.tried && state.tried[l]; return t && Array.isArray(t.found) ? t.found : []; }
  // 見つけた写真を残す: お題の記録 found に入る（作品には入れない）。f: { photo: { data, w, h }, line, at, time }。1 お題 6 枚まで
  function addFound(state, id, f) {
    var o = topicOf(state, id, 'make');
    if (!o || !f || !TDD.photoValid(f.photo) || foundOf(state, o.lineage).length >= FOUND_MAX) return state;
    var line = trim(f.line).slice(0, 120), S = withCopy(clone(state), o), t = triedOf(S, o.lineage);
    t.found.push({ photo: { data: f.photo.data, w: f.photo.w, h: f.photo.h }, line: line || null, at: f.at || null, time: String(f.time || '') });
    t.entries.find = true;
    return S;
  }
  // 残した写真を消す + 元に戻す（元の位置へ）
  function removeFound(state, id, i) {
    var l = lineageIn(state, id) || id, t = state && state.tried && state.tried[l];
    if (!t || !Array.isArray(t.found) || !isNat(i) || i >= t.found.length) return null;
    var S = clone(state), item = S.tried[l].found.splice(i, 1)[0];
    return { state: S, undo: { id: l, index: i, item: clone(item) } };
  }
  function restoreFound(state, u) {
    var o = u && topicOf(state, u.id, 'make');
    if (!o || !u.item || !TDD.photoValid(u.item.photo) || foundOf(state, o.lineage).length >= FOUND_MAX) return state;
    var S = withCopy(clone(state), o), t = triedOf(S, o.lineage);
    t.found.splice(Math.max(0, Math.min(u.index | 0, t.found.length)), 0, clone(u.item));
    return S;
  }
  // 手がかりのチェック（付ける・外す）
  function toggleHint(state, id, i) {
    var o = topicOf(state, id, 'make');
    if (!o || !o.find || !isNat(i) || i >= o.find.hints.length) return state;
    var S = withCopy(clone(state), o), t = triedOf(S, o.lineage), k = t.checks.indexOf(i);
    if (k >= 0) t.checks.splice(k, 1); else { t.checks.push(i); t.checks.sort(); }
    t.entries.find = true;
    return S;
  }

  // ---------- 対話のお題 ----------
  function thinkOf(S, l) {
    if (!isObj(S.think)) S.think = {};
    if (!S.think[l]) S.think[l] = blankThink();
    return S.think[l];
  }
  // 入口を開いた記録（画面に回数や完了は出さない。1 つでも開いたら「次の一歩」が出る）
  function markOpen(state, id, entry) {
    var o = topicOf(state, id, 'dialog');
    if (!o || OPENS.indexOf(entry) < 0) return state;
    var t = state.think && state.think[o.lineage];
    if (t && t.opened && t.opened[entry]) return state;
    var S = withCopy(clone(state), o);
    thinkOf(S, o.lineage).opened[entry] = true;
    return S;
  }
  function thinkIn(state, id) { var l = lineageIn(state, id) || id; return state && state.think ? state.think[l] || null : null; }
  function isOpened(state, id) {
    var t = thinkIn(state, id);
    return !!(t && t.opened && OPENS.some(function (k) { return t.opened[k]; }));
  }
  // 問いを選ぶ（選び直せる）
  function pickAsk(state, id, level) {
    var o = topicOf(state, id, 'dialog');
    if (!o || LEVELS.indexOf(level) < 0) return state;
    var t = state.think && state.think[o.lineage];
    if (t && t.ask === level && t.opened && t.opened.asks) return state;
    var S = withCopy(clone(state), o), th = thinkOf(S, o.lineage);
    th.ask = level;
    th.opened.asks = true;
    return S;
  }
  // 既にある id と重ならない採番: 10 億未満の 'mkN' の最大の次から。それでも重なれば次の番号へ
  var MARK_N_MAX = 1e9;
  function nextMarkId(marks) {
    var n = 0, used = {};
    marks.forEach(function (m) { used[m.id] = true; var k = /^mk(\d+)$/.exec(m.id); if (k && +k[1] > n && +k[1] < MARK_N_MAX) n = +k[1]; });
    var next = n + 1;
    while (hasOwn(used, 'mk' + next)) next += 1;
    return 'mk' + next;
  }
  // 自分の考えを置く: 新しいものが上。前のものは残す。line は 80 字で切る（空なら null）。m: { stance, line, at, time }
  function putMark(state, id, m) {
    var o = topicOf(state, id, 'dialog');
    if (!o || !m || !isStance(o, m.stance)) return state;
    var S = withCopy(clone(state), o), th = thinkOf(S, o.lineage), line = trim(m.line).slice(0, LINE_MAX);
    th.marks.unshift({ id: nextMarkId(th.marks), stance: m.stance, line: line || null, at: m.at || null, time: String(m.time || '') });
    th.opened.mine = true;
    return S;
  }
  // 外す + 元に戻す（元の位置へ。id が重なっていたら新しい id にする）
  function removeMark(state, id, markId) {
    var l = lineageIn(state, id) || id, t = state && state.think && state.think[l], i = -1;
    if (t && Array.isArray(t.marks)) t.marks.forEach(function (m, j) { if (i < 0 && m.id === markId) i = j; });
    if (i < 0) return null;
    var S = clone(state), item = S.think[l].marks.splice(i, 1)[0];
    return { state: S, undo: { id: l, index: i, item: clone(item) } };
  }
  function restoreMark(state, u) {
    var o = u && topicOf(state, u.id, 'dialog');
    if (!o || !isObj(u.item) || !isStance(o, u.item.stance)) return state;
    var S = withCopy(clone(state), o), th = thinkOf(S, o.lineage), item = clone(u.item);
    if (th.marks.some(function (m) { return m.id === item.id; })) item.id = nextMarkId(th.marks);
    th.marks.splice(Math.max(0, Math.min(u.index | 0, th.marks.length)), 0, item);
    return S;
  }
  function restoredMarkId(state, u) {
    var t = state && u && state.think && state.think[u.id];
    if (!t || !Array.isArray(t.marks) || !t.marks.length) return null;
    return t.marks[Math.max(0, Math.min(u.index | 0, t.marks.length - 1))].id;
  }
  // サークル対話に持っていく（お題 + 選んだ問いがあればその段）。新しいものが先頭（at を渡すとその位置 = 外すの元に戻す）。
  // 既に入っていれば、選んだ問いだけ今のものに替える。o: { ask, at（ISO）, time }
  function inCircle(state, id) { var l = lineageIn(state, id) || id; return !!(state && Array.isArray(state.circle) && state.circle.some(function (c) { return c.id === l; })); }
  function toCircle(state, id, o, pos) {
    var d = isObj(id) && id.lineage ? id : topicOf(state, id, 'dialog');
    if (!d) return state;
    o = o || {};
    var ask = LEVELS.indexOf(o.ask) >= 0 ? o.ask : null, S;
    if (inCircle(state, d.lineage)) {
      var cur = state.circle.filter(function (c) { return c.id === d.lineage; })[0];
      if (cur.ask === ask) return state;
      S = clone(state);
      S.circle.forEach(function (c) { if (c.id === d.lineage) c.ask = ask; });
      return S;
    }
    S = withCopy(clone(state), d);
    if (!Array.isArray(S.circle)) S.circle = [];
    S.circle.splice(Math.max(0, Math.min(pos == null ? 0 : pos | 0, S.circle.length)), 0, { id: d.lineage, ask: ask, at: o.at || null, time: String(o.time || '') });
    return S;
  }
  function fromCircle(state, id) {
    var l = lineageIn(state, id) || id, i = -1;
    if (state && Array.isArray(state.circle)) state.circle.forEach(function (c, j) { if (i < 0 && c.id === l) i = j; });
    if (i < 0) return null;
    var S = clone(state), item = S.circle.splice(i, 1)[0];
    return { state: S, undo: { index: i, item: clone(item) } };
  }

  // ---------- 保存の失敗を戻す（共通の約束。DES.make.trySave = 作る・展示と同じ約束。無ければ同じ形をここで）----------
  function trySave(st, keys, fn, save) {
    if (DES.make && DES.make.trySave) return DES.make.trySave(st, keys, fn, save);
    var prev = {};
    keys.forEach(function (k) { prev[k] = st[k]; });
    fn(st);
    var ok = keys.every(function (k) { return save(k) !== false; });
    if (!ok) keys.forEach(function (k) { st[k] = prev[k]; });
    return ok;
  }
  function saveOdai(st, next, save) { return trySave(st, ['odai'], function (s) { s.odai = next; }, save); }
  // バディと話す: 話す画面の下書き（state.draft）に line を入れる（下書きがあれば改行して足す）
  function addTalk(st, line, save) {
    return trySave(st, ['draft'], function (s) {
      var cur = String((s.draft && s.draft.text) || '').replace(/\s+$/, '');
      s.draft = { text: cur ? cur + '\n' + line : line, scroll: (s.draft && s.draft.scroll) || 0 };
    }, save);
  }
  // 対話のお題の入口を開く（同時に 1 つ。もう一度押すと閉じる）。保存できなければ入口も押す前に戻す。戻り値 { saved: true | false | null }
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
  // 作ってみる（対話）: 題 = next.makeTitle・手順 = next.makeSteps の外で作る活動を作って保存する（2 回目は同じ活動）。
  // opts: { id, mode, now, recText }。戻り値 { ok, id, created }
  function dialogMake(st, o, opts, save) {
    var mk = TDD.makeOdaiOf(o), M = DES.make;
    if (!mk || !M || !M.fromOdai || !M.addAct) return null;
    opts = opts || {};
    var r = M.fromOdai(mk, { id: opts.id, mode: opts.mode, now: opts.now, acts: st.activities || [], recText: opts.recText });
    if (!r) return null;
    if (!r.created) return { ok: true, id: r.id, created: false };
    return { ok: M.addAct(st, r.act, save), id: r.id, created: true };
  }
  // 同じお題から作った活動（odaiId は lineage。古い活動の 'fx-' id も見る）
  function actOf(acts, o) {
    var hit = null;
    (acts || []).forEach(function (a) { if (!hit && a && (a.odaiId === o.lineage || a.odaiId === o.id)) hit = a; });
    return hit;
  }

  // 参考になる資料（contract-T v2.9）: 出典のうち learn が true のものだけ。href は https:// で始まる url だけ（それ以外は名前だけ）
  function learnLinks(o) {
    var l = o && Array.isArray(o.sources) ? o.sources : [];
    return l.filter(function (s) { return isObj(s) && s.learn === true && typeof s.name === 'string' && s.name !== ''; }).map(function (s) {
      return { id: s.id, name: s.name, href: /^https:\/\/[^\s"'<>]+$/.test(String(s.url)) ? s.url : null };
    });
  }
  // 表示の時刻 'M/D H:MM'（DES.clock の今日 'YYYY-MM-DD' と今 'HH:mm' から）
  function stampOf(today, now) {
    var p = String(today || '').split('-'), t = String(now || '').split(':');
    if (p.length !== 3 || t.length !== 2) return '';
    return (+p[1]) + '/' + (+p[2]) + ' ' + (+t[0]) + ':' + t[1];
  }

  var pure = {
    initial: initial, normalize: normalize, shownSlots: shownSlots, shownKind: shownKind, swap: swap, swapKind: swapKind,
    keep: keep, unkeep: unkeep, isKept: isKeptIn, markEntry: markEntry, isStarted: isStarted,
    addFound: addFound, removeFound: removeFound, restoreFound: restoreFound, toggleHint: toggleHint, foundOf: foundOf,
    markOpen: markOpen, isOpened: isOpened, pickAsk: pickAsk, putMark: putMark, removeMark: removeMark, restoreMark: restoreMark,
    restoredMarkId: restoredMarkId, toCircle: toCircle, fromCircle: fromCircle, inCircle: inCircle,
    saveOdai: saveOdai, addTalk: addTalk, openDEntry: openDEntry, dialogMake: dialogMake, actOf: actOf, learnLinks: learnLinks, stampOf: stampOf,
    topicOf: topicOf, ENTRIES: ENTRIES, KINDS: KINDS, LEVELS: LEVELS, OPENS: OPENS, LINE_MAX: LINE_MAX, FOUND_MAX: FOUND_MAX, SLOTS: SLOTS
  };
  Object.keys(pure).forEach(function (k) { TD[k] = pure[k]; });
  if (typeof module !== 'undefined' && module.exports) module.exports = pure;
  if (typeof document === 'undefined') return;

  // ======================================================================
  // ここから下はブラウザ専用
  // ======================================================================

  // ---------- 保存（LS-2 / LS-13）: des.live.odai。形の検査で normalize した値に置き換える（部分の形違いはその項目だけ初期値） ----------
  if (DES.store && DES.store.register) {
    DES.store.register('odai', function (v) {
      if (!isObj(v)) return false;
      var n = normalize(v);
      Object.keys(v).forEach(function (k) { delete v[k]; });
      Object.keys(n).forEach(function (k) { v[k] = n[k]; });
      return true;
    }, initial);
  }
  // ---------- 文言（LS-13 の verbatim / LS-18-11） ----------
  if (DES.i18n && DES.i18n.add) {
    DES.i18n.add({
      td_empty: ['今日のお題は、まだ届いていないよ。届いたら、ここに出る', 'きょうのお題は、まだとどいていないよ。とどいたら、ここに出る'],
      td_fetch_fail: ['今はお題を取ってこられないよ。少したってから開いてね', '今はお題を取ってこられないよ。少したってから開いてね'],
      photo_full: ['写真がいっぱいだよ。いらない写真を外してから足してね', '写真がいっぱいだよ。いらない写真を外してから足してね'],
      // 動画・試して遊ぶの入口は出さない（実物が無い）。どこかで読まれても「モック」の語を出さない
      td_video: ['動画', '動画'],
      td_play_label: ['動き', 'うごき']
    });
  }

  function S() { return DES.state; }
  function T(k, v) { return DES.t(k, v); }
  function H() { return DES.h.apply(null, arguments); }
  function icon(n) { return DES.raw(DES.icon(n)); }
  function pick(pair) { return Array.isArray(pair) ? (DES.mode() === 'es' && pair[1] != null ? pair[1] : pair[0]) : (pair == null ? '' : String(pair)); }
  function esc(v) { return window.CSS && CSS.escape ? CSS.escape(v) : String(v).replace(/"/g, '\\"'); }
  function ui() {
    var u = DES.ui;
    if (!u.td) u.td = { open: {}, own: null, dlg: null, shownDetail: null, missing: null, fresh: null, dfresh: null, pendingFocus: null, dmine: {} };
    if (!u.td.dmine) u.td.dmine = {};
    return u.td;
  }
  function dlgEl() { return document.getElementById('today-dialog'); }
  function isKept(id) { return isKeptIn(S().odai, id); }
  function actFor(o) { return actOf(S().activities, o); }
  function stamp() { return stampOf(DES.clock.today(), DES.clock.now()); }
  function iso() { return DES.clock.iso(); }
  function refocus(sel) { var n = sel ? document.querySelector(sel) : null; if (n) n.focus(); }
  function anyTopic(id) { return topicOf(S().odai, id, 'any'); }
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

  // ---------- 読み込み（#today を初めて開いた時に 1 回。届いたら #today にいる時だけ描き直す） ----------
  var loadHooked = false;
  function ensureLoad() {
    if (!loadHooked) {
      loadHooked = true;
      TDD.onLoad(function (st) { if (st.phase !== 'loading' && DES.app && DES.app.route() === 'today') DES.app.render(); });
    }
    if (TDD.status.phase === 'idle') TDD.load();
  }
  function phase() { return TDD.status.phase; }
  function waiting() { return phase() === 'idle' || phase() === 'loading'; }

  // ---------- 部品 ----------
  function lineEl(key, pair) { return pair ? H('p', { class: 'odai-line' }, [H('span', { class: 'odai-k' }, T(key)), H('span', null, pick(pair))]) : null; }
  // なぜ出したか: 工場のお題は reason が null なので出さない（空の行・空のチップを出さない）
  function whyEl(o) { return o.reason ? H('p', { class: 'odai-why' }, [chip('ai', T('who_ai'), T('ai_proposal') + ' ' + T('td_why')), H('span', null, pick(o.reason))]) : null; }
  // 印（あるものだけ）: サポーターと確認 / サポーターと読む / 出所は「工場で作って確かめたお題」だけ
  function marksEl(o) {
    var out = [];
    if (o.safety) out.push(H('span', { class: 'chip k-safety' }, T('td_safety')));
    if (o.heavy) out.push(H('span', { class: 'chip k-safety' }, T('td_heavy')));
    out.push(chip('ai', T('td_src_factory')));
    return H('div', { class: 'odai-marks' }, out);
  }
  function keepBtn(o) {
    var kept = isKept(o.lineage);
    return btn(T(kept ? 'td_kept_btn' : 'td_keep'), 'td-keep', { id: o.id, kls: kept ? 'is-on' : '', icon: kept ? 'check' : null, attrs: { 'aria-pressed': kept ? 'true' : 'false' } });
  }
  function failLine() { return H('p', { class: 'empty-line td-status', role: 'status' }, T('td_fetch_fail')); }

  // ---------- 一覧 ----------
  function card(o, i, fresh, canSwap) {
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
          canSwap ? btn(T('td_other'), 'td-swap', { arg: String(i), kls: 'ghost', attrs: { 'aria-label': T('td_other') + ': ' + pick(o.title) } }) : null
        ])
      ])
    ]);
  }
  // 種類のチップ（news は右に日付）
  function kindEl(o) {
    return H('p', { class: 'odai-kind' }, [H('span', { class: 'chip k-kind k-' + o.kind }, T('td_kind_' + o.kind)),
      o.date ? H('span', { class: 'odai-date' }, T('td_news_date', { date: pick(o.date) })) : null]);
  }
  function dmarksEl(o) {
    var out = [];
    if (o.heavy) out.push(H('span', { class: 'chip k-safety' }, T('td_heavy')));
    out.push(chip('ai', T('td_src_factory')));
    return H('div', { class: 'odai-marks' }, out);
  }
  function dcard(o, kind, fresh, canSwap) {
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
          canSwap ? btn(T('td_other'), 'td-dswap', { arg: kind, kls: 'ghost', attrs: { 'aria-label': T('td_other') + ': ' + pick(o.title) } }) : null
        ])
      ])
    ]);
  }
  function keptSec() {
    var kept = S().odai.kept.map(anyTopic).filter(Boolean);
    if (!kept.length) return null;
    return H('section', { class: 'odai-kept', 'aria-labelledby': 'td-kept-h' }, [
      H('div', { class: 'section-head' }, [H('h2', { id: 'td-kept-h', tabindex: '-1', 'data-fk': 'td-kept-h' }, T('td_kept_h'))]),
      H('ul', { class: 'kept-list' }, kept.map(function (o) {
        var talk = o.kind !== 'make';
        return H('li', { class: 'kept-item' }, [
          H('span', { class: 'kept-thumb' }, [DES.raw(TDD.cardArt(o))]),
          H('div', { class: 'kept-text' }, [
            talk ? kindEl(o) : null,
            H('h3', null, pick(o.title)),
            H('div', { class: 'kept-ops' }, [
              H('a', { class: 'btn small', href: '#today/' + o.id, 'data-fk': 'ktry:' + o.id }, T(talk ? 'td_think' : 'td_try')),
              btn(T('remove'), 'td-unkeep', { id: o.id, kls: 'ghost', attrs: { 'aria-label': T('remove') + ': ' + pick(o.title) } })
            ])
          ])
        ]);
      }))
    ]);
  }
  // サークル対話に持っていく問い（入っている時だけ。お題の問い + 選んだ問いがあればその文）
  function circleSec() {
    var list = S().odai.circle.filter(function (c) { return !!topicOf(S().odai, c.id, 'dialog'); });
    if (!list.length) return null;
    return H('section', { class: 'odai-kept odai-circle', 'aria-labelledby': 'td-circle-h' }, [
      H('div', { class: 'section-head' }, [H('h2', { id: 'td-circle-h', tabindex: '-1', 'data-fk': 'td-circle-h' }, T('td_circle_h'))]),
      H('ul', { class: 'kept-list' }, list.map(function (c) {
        var o = topicOf(S().odai, c.id, 'dialog'), a = c.ask ? TDD.askOf(o, c.ask) : null;
        return H('li', { class: 'kept-item' }, [
          H('span', { class: 'kept-thumb' }, [DES.raw(TDD.cardArt(o))]),
          H('div', { class: 'kept-text' }, [
            kindEl(o),
            H('h3', null, pick(o.title)),
            a ? H('p', { class: 'circle-ask' }, [H('span', { class: 'odai-k' }, T('td_ask_chosen') + ': '), H('span', null, pick(a.text))]) : null,
            H('div', { class: 'kept-ops' }, [
              H('a', { class: 'btn small', href: '#today/' + o.id, 'data-fk': 'ctry:' + o.id }, T('td_think')),
              btn(T('remove'), 'td-uncircle', { id: o.id, kls: 'ghost', attrs: { 'aria-label': T('remove') + ': ' + pick(o.title) } })
            ])
          ])
        ]);
      }))
    ]);
  }
  function sec(key, idH, cards, fail) {
    var kids = [H('h2', { class: 'odai-sec-h', id: idH }, T(key))];
    if (cards) kids.push(H('div', { class: 'odai-cards', 'aria-busy': cards.length ? null : 'true' }, cards));
    if (fail) kids.push(failLine());
    return H('section', { class: 'odai-sec', 'aria-labelledby': idH }, kids);
  }
  function renderList(main) {
    var u = ui(), st = S().odai, status = TDD.status;
    main.textContent = '';
    var kids = [H('div', { class: 'page-head' }, [H('div', null, [H('h1', { tabindex: '-1', 'data-fk': 'today-h' }, T('today')), H('p', null, T('td_sub'))])])];
    if (waiting()) {
      // 読み込み中: 見出しと節の枠だけ（スピナーは出さない。§I）
      kids.push(sec('td_sec_talk', 'td-sec-talk', []), sec('td_sec_make', 'td-sec-make', []));
    } else if (status.phase === 'fail') {
      kids.push(failLine());
    } else {
      var dcards = [], mcards = [];
      KINDS.forEach(function (k) {
        var pool = TDD.kindPool(k), id = shownKind(st, k, pool), o = id ? TDD.resolve(id, null, 'dialog') : null;
        if (o) dcards.push(dcard(o, k, u.dfresh === k, pool.length > 1));
      });
      var mpool = TDD.pool(), slots = shownSlots(st, mpool);
      slots.forEach(function (id, i) {
        var o = TDD.resolve(id, null, 'make');
        if (o) mcards.push(card(o, i, u.fresh === i, mpool.length > slots.length));
      });
      if (!dcards.length && !mcards.length && !status.fail.talk && !status.fail.make) kids.push(H('p', { class: 'empty-line td-status' }, T('td_empty')));
      else {
        if (dcards.length || status.fail.talk) kids.push(sec('td_sec_talk', 'td-sec-talk', dcards.length ? dcards : null, status.fail.talk));
        if (mcards.length || status.fail.make) kids.push(sec('td_sec_make', 'td-sec-make', mcards.length ? mcards : null, status.fail.make));
      }
    }
    var k = keptSec();
    if (k) kids.push(k);
    var c = circleSec();
    if (c) kids.push(c);
    main.appendChild(H('div', { class: 'today-page' }, kids));
    u.fresh = null;
    u.dfresh = null;
  }
  function backEl(id) {
    return H('p', { class: 'td-back' }, [H('a', { class: 'link-btn', href: '#today', 'data-action': 'td-back', 'data-id': id, 'aria-label': T('td_back') }, [H('span', { 'aria-hidden': 'true' }, '←'), H('span', null, T('today'))])]);
  }
  // 詳細を開いたが、まだお題が届いていない（再読み込みした直後など）: 戻ると枠だけ
  function renderPending(main, id) {
    main.textContent = '';
    main.appendChild(H('div', { class: 'today-page odai-detail', 'aria-busy': 'true' }, [backEl(id), H('div', { class: 'td-head' }, [H('figure', { class: 'td-hero' }), H('div', { class: 'td-info' })])]));
  }

  // ---------- 詳細（作る・ためす） ----------
  function entriesEl(o, open) {
    var hasAct = !!actFor(o), list = ENTRIES.filter(function (k) { return k !== 'find' || !!o.find; });
    return H('section', { class: 'td-entries', 'aria-labelledby': 'td-entries-h' }, [
      H('h2', { id: 'td-entries-h' }, T('td_entries_h')),
      H('div', { class: 'td-entry-grid n' + list.length }, list.map(function (k) {
        // 作ってみる は作業台へ移る（その場では開かない）。同じお題から作った活動があれば「続きを作る」
        if (k === 'make') {
          return H('button', { class: 'td-entry is-make', type: 'button', 'data-action': 'td-make', 'data-id': o.id }, [icon('make'),
            H('strong', null, T(hasAct ? 'resume_make' : 'td_e_make')), H('span', null, T(hasAct ? 'td_d_resume' : 'td_d_make'))]);
        }
        var on = open === k;
        return H('button', { class: 'td-entry' + (on ? ' on' : ''), type: 'button', id: 'td-e-' + k, 'data-action': 'td-entry', 'data-id': o.id, 'data-arg': k,
          'aria-expanded': on ? 'true' : 'false', 'aria-controls': on ? 'td-panel' : null }, [icon('check'), H('strong', null, T('td_e_' + k)), H('span', null, T('td_d_' + k))]);
      }))
    ]);
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
        var cap = f.line || T('td_found_btn');
        return H('li', null, [H('figure', null, [DES.raw(TDD.photoArt(o, f.photo)),
          H('figcaption', null, [f.line ? H('span', { class: 'td-found-line' }, f.line) : null, H('span', { class: 'td-time' }, f.time)])]),
          btn(T('td_found_del'), 'td-found-del', { id: o.id, arg: String(i), kls: 'ghost', attrs: { 'aria-label': T('td_found_del') + ': ' + cap } })]);
      })));
    }
    return kids;
  }
  function panelEl(o, k, t) {
    return H('section', { class: 'td-panel card', id: 'td-panel', 'aria-labelledby': 'td-e-' + k, 'data-fk': 'td-panel:' + k, tabindex: '-1' }, findEl(o, t));
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
  // 始めた後（入口を 1 つでも開いたら）: 自分の案にする（問いを書き換えて作業台へ）。「ここだけ変える」は試して遊ぶが無いので出さない
  function headOps(o) {
    var u = ui(), ops = [keepBtn(o)], ownOpen = !!(u.own && u.own.id === o.id);
    if (isStarted(S().odai, o.lineage)) ops.push(btn(T('td_own_idea'), 'td-own-open', { id: o.id, icon: 'quote', attrs: { 'aria-expanded': ownOpen ? 'true' : 'false' } }));
    var out = [H('div', { class: 'td-head-ops' }, ops)];
    if (ownOpen) out.push(ownForm(o));
    return out;
  }
  function renderDetail(main, o) {
    var u = ui(), t = S().odai.tried[o.lineage], open = u.open[o.id] || null;
    if (open === 'find' && !o.find) open = null;
    main.textContent = '';
    var info = [H('h1', { tabindex: '-1', 'data-fk': 'td-h:' + o.id }, pick(o.title)), whyEl(o), marksEl(o), lineEl('td_first', o.firstStep), lineEl('td_need', o.need)].concat(headOps(o));
    var kids = [backEl(o.id), H('div', { class: 'td-head' }, [H('figure', { class: 'td-hero' }, [DES.raw(TDD.cardArt(o))]), H('div', { class: 'td-info' }, info)]), entriesEl(o, open)];
    if (open) kids.push(panelEl(o, open, t));
    main.appendChild(H('div', { class: 'today-page odai-detail', 'data-odai': o.id }, kids));
    if (u.shownDetail !== o.id) { u.shownDetail = o.id; var h = main.querySelector('h1'); if (h) h.focus(); }
  }

  // ---------- 対話のお題の詳細 ----------
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
  // 参考になる資料の欄: learn が true の出典が 1 つ以上ある時だけ。https:// のものだけリンク
  function learnSec(o) {
    var l = learnLinks(o);
    if (!l.length) return null;
    return H('section', { class: 'td-learn', 'aria-labelledby': 'td-learn-h' }, [
      H('h2', { id: 'td-learn-h' }, T('td_learn_h')),
      H('ul', { class: 'td-learn-list' }, l.map(function (x) {
        return H('li', null, [x.href ? H('a', { class: 'td-src-link', href: x.href, target: '_blank', rel: 'noopener noreferrer' }, x.name) : H('span', { class: 'td-src-name' }, x.name)]);
      }))
    ]);
  }
  // 確かめた日 = 出典の checked（無ければ出さない。取り込み日で代用しない。LS-18-16）
  function fmtChecked(o) {
    var s = o.sources.filter(function (x) { return TDD.isRealDate(x.checked); })[0], m = s ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.checked) : null;
    return m ? T('td_checked', { date: T('td_date_full', { y: +m[1], m: +m[2], d: +m[3] }) }) : '';
  }
  function factsEl(o) {
    var hasSrc = o.facts.some(function (f) { return TDD.srcIds(f.src).length > 0; }), ck = hasSrc ? fmtChecked(o) : '';
    return [
      H('ul', { class: 'td-facts' }, o.facts.map(function (f) { return H('li', null, [H('span', null, pick(f.text))]); })),
      ck ? H('p', { class: 'td-checked' }, ck) : null
    ];
  }
  function viewsEl(o) {
    return [
      H('ul', { class: 'td-views' }, o.views.map(function (v) { return H('li', { class: 'td-view' }, [H('strong', null, pick(v.who)), H('p', null, pick(v.stance))]); })),
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
    kids.push(H('fieldset', { class: 'td-choices' }, [H('legend', null, T('td_stance_legend'))].concat(opts.map(function (s, i) {
      var id = 'td-stance-' + i;
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
    var inC = inCircle(S().odai, o.lineage), hasAct = !!actFor(o);
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
    var u = ui(), st = S().odai, th = st.think[o.lineage] || null, open = u.open[o.id] || null;
    if (open && dentries(o).indexOf(open) < 0) open = null;
    main.textContent = '';
    var info = [kindEl(o), H('h1', { tabindex: '-1', 'data-fk': 'td-h:' + o.id }, pick(o.title))];
    if (o.heavy) info.push(H('p', { class: 'td-heavy-note' }, T('td_heavy_note')));
    info.push(whyEl(o), dmarksEl(o), H('div', { class: 'td-head-ops' }, [keepBtn(o)]));
    var kids = [backEl(o.id), H('div', { class: 'td-head' }, [H('figure', { class: 'td-hero' }, [DES.raw(TDD.cardArt(o))]), H('div', { class: 'td-info' }, info)]), dentriesEl(o, open)];
    if (open) kids.push(dpanelEl(o, open, th));
    var ms = marksSec(o, th);
    if (ms) kids.push(ms);
    if (isOpened(st, o.lineage)) kids.push(nextSec(o));
    var ls = learnSec(o);
    if (ls) kids.push(ls);
    main.appendChild(H('div', { class: 'today-page odai-detail is-talk', 'data-odai': o.id }, kids));
    if (u.shownDetail !== o.id) { u.shownDetail = o.id; var h = main.querySelector('h1'); if (h) h.focus(); }
  }

  TD.render = function (main, arg) {
    var u = ui();
    ensureLoad();
    if (arg) {
      var o = TDD.get(arg), d = o ? null : TDD.getDialog(arg);
      if (o) renderDetail(main, o);
      else if (d) renderDialog(main, d);
      else if (waiting()) renderPending(main, arg);
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
  TD.resetUi = function () { var u = ui(); u.open = {}; u.own = null; u.shownDetail = null; u.missing = null; u.fresh = null; u.dfresh = null; u.dmine = {}; };

  // ---------- 見つけた写真を残す（小さなダイアログ。選んだ本物の写真 + 任意の 1 行） ----------
  function renderDlg() {
    var d = ui().dlg, dlg = dlgEl(), o = d && TDD.get(d.id);
    if (!o || !dlg) return;
    var putBack = DES.make && DES.make.clearDialog ? DES.make.clearDialog(dlg) : function () {};
    if (!(DES.make && DES.make.clearDialog)) dlg.textContent = '';
    dlg.setAttribute('aria-labelledby', 'td-dlg-h');
    dlg.appendChild(H('div', { class: 'dialog-head' }, [H('h2', { id: 'td-dlg-h' }, T('td_found_btn')),
      H('button', { class: 'icon-btn', type: 'button', 'data-action': 'dialog-close', 'aria-label': T('close') }, [icon('close')])]));
    var body = H('div', { class: 'dialog-body' }, [
      H('figure', { class: 'td-found-preview' }, [DES.raw(TDD.photoArt(o, d.photo))]),
      H('div', { class: 'field' }, [H('label', { for: 'td-found-line' }, T('td_found_line')),
        H('input', { id: 'td-found-line', type: 'text', 'data-ui': 'td-found-line', value: d.line, autocomplete: 'off' })]),
      H('p', { class: 'face-note' }, T('face_note')),
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
  // 別のお題を見る: 150ms のクロスフェード（前の中身が消えながら、新しい中身が出る。reduced-motion で即時）
  function ghostOf(cardEl) {
    var g = H('div', { class: 'odai-ghost', 'aria-hidden': 'true' });
    g.setAttribute('inert', '');
    Array.prototype.forEach.call(cardEl.children, function (c) { if (!c.classList.contains('odai-ghost')) g.appendChild(c.cloneNode(true)); });
    Array.prototype.forEach.call(g.querySelectorAll('*'), function (n) {
      ['id', 'data-action', 'data-fk', 'href', 'tabindex', 'aria-labelledby', 'aria-pressed'].forEach(function (k) { n.removeAttribute(k); });
    });
    return g;
  }
  function fade(sel, ghost) {
    var c = ghost && document.querySelector(sel);
    if (!c) return;
    c.appendChild(ghost);
    setTimeout(function () { if (ghost.parentNode) ghost.parentNode.removeChild(ghost); }, 200);
  }
  // 保存してから描き直す。保存に失敗したら画面の状態を戻し、save_fail を出す（共通の約束）
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
  A['td-swap'] = function (el) {
    var i = +el.getAttribute('data-arg'), next = swap(S().odai, i);
    if (next === S().odai) return;
    var sel = '.odai-card[data-fk="odai:' + i + '"]', old = motionOK() ? document.querySelector(sel) : null, ghost = old ? ghostOf(old) : null;
    ui().fresh = ghost ? i : null;
    if (!putOdai(next)) return;
    fade(sel, ghost);
  };
  A['td-dswap'] = function (el) {
    var k = el.getAttribute('data-arg'), next = swapKind(S().odai, k);
    if (next === S().odai) return;
    var sel = '.odai-card[data-fk="dodai:' + esc(k) + '"]', old = motionOK() ? document.querySelector(sel) : null, ghost = old ? ghostOf(old) : null;
    ui().dfresh = ghost ? k : null;
    if (!putOdai(next)) return;
    fade(sel, ghost);
  };
  function unkeepWithUndo(id) {
    var o = anyTopic(id), r = unkeep(S().odai, id);
    if (!r) return;
    var fx = o ? o.id : id;
    if (!putOdai(r.state, { focusFn: function () { return S().odai.kept.length ? 'td-kept-h' : (DES.app.routeArg() ? 'td-h:' + fx : 'today-h'); } })) return;
    DES.app.toast(T('removed_toast'), { label: T('undo_restore'), fn: function () {
      putOdai(keep(S().odai, o || r.undo.id, r.undo.index), { sel: '[data-action="td-keep"][data-id="' + esc(fx) + '"],[data-action="td-unkeep"][data-id="' + esc(fx) + '"]' });
    } });
  }
  // とっておく ⇔ とっておいた（押し直すと外す。元に戻す付き）
  A['td-keep'] = function (el) {
    var id = el.getAttribute('data-id'), st = S().odai;
    if (isKept(id)) { unkeepWithUndo(id); return; }
    var next = keep(st, id);
    if (next === st) return;
    if (!putOdai(next)) return;
    DES.app.toast(T('td_kept_toast'));
  };
  A['td-unkeep'] = function (el) { unkeepWithUndo(el.getAttribute('data-id')); };
  A['td-back'] = function (el) {
    var id = el.getAttribute('data-id'), st = S().odai, o = anyTopic(id), l = o ? o.lineage : id;
    var inD = KINDS.some(function (k) { return shownKind(st, k) === l; }), inS = shownSlots(st).indexOf(l) >= 0;
    ui().pendingFocus = inS ? 'try:' + id : (inD ? 'dtry:' + id : (isKept(l) ? 'ktry:' + id : (inCircle(st, l) ? 'ctry:' + id : 'today-h')));
    window.location.hash = '#today';
  };

  // ---------- 対話のお題の操作 ----------
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
    var next = putMark(S().odai, id, { stance: mine.stance, line: mine.line, at: iso(), time: stamp() });
    if (!putOdai(next, { sel: '[data-action="td-mark-put"]', ok: function () { mine.line = ''; } })) return;
    var put = document.querySelector('[data-action="td-mark-put"]');
    if (put) put.focus();
    DES.app.toast(T('td_mark_toast'));
  };
  A['td-mark-del'] = function (el) {
    var id = el.getAttribute('data-id'), mid = el.getAttribute('data-arg'), r = removeMark(S().odai, id, mid);
    if (!r) return;
    var left = r.state.think[r.undo.id].marks;
    if (!putOdai(r.state, { sel: left.length ? '[data-action="td-mark-del"][data-arg="' + esc(left[Math.min(r.undo.index, left.length - 1)].id) + '"]' : '[data-action="td-dentry"][data-arg="mine"]' })) return;
    DES.app.toast(T('td_mark_removed'), { label: T('undo_restore'), fn: function () {
      var back = restoreMark(S().odai, r.undo), m2 = restoredMarkId(back, r.undo);
      putOdai(back, { sel: m2 ? '[data-action="td-mark-del"][data-id="' + esc(id) + '"][data-arg="' + esc(m2) + '"]' : '[data-action="td-dentry"][data-arg="mine"]' });
    } });
  };
  // バディと話す: 話す画面の下書き（S().draft）に next.talk を入れて #talk へ（下書きがあれば改行して足す）
  A['td-dtalk'] = function (el) {
    var o = TDD.getDialog(el.getAttribute('data-id'));
    if (!o) return;
    if (!addTalk(S(), pick(o.next.talk), storeSave)) { failSave(); return; }
    S().saveFailed = false;
    DES.app.commit();
    DES.app.toast(T('prefilled'));
    DES.ui.focusComposer = true;
    window.location.hash = '#talk';
  };
  function uncircleWithUndo(id, focusSel) {
    var o = anyTopic(id), r = fromCircle(S().odai, id);
    if (!r) return;
    var fx = o ? o.id : id;
    if (!putOdai(r.state, { sel: focusSel, focusFn: function () { return S().odai.circle.length ? 'td-circle-h' : (DES.app.routeArg() ? 'td-h:' + fx : 'today-h'); } })) return;
    DES.app.toast(T('td_circle_removed'), { label: T('undo_restore'), fn: function () {
      putOdai(toCircle(S().odai, o || r.undo.item.id, r.undo.item, r.undo.index), { sel: '[data-action="td-dcircle"][data-id="' + esc(fx) + '"],[data-action="td-uncircle"][data-id="' + esc(fx) + '"]' });
    } });
  }
  // サークル対話に持っていく ⇔ 入れてある（押し直すと外す。元に戻す付き）。予定表は変えない
  A['td-dcircle'] = function (el) {
    var id = el.getAttribute('data-id'), st = S().odai;
    if (inCircle(st, id)) { uncircleWithUndo(id, '[data-action="td-dcircle"][data-id="' + esc(id) + '"]'); return; }
    var th = thinkIn(st, id);
    if (!putOdai(toCircle(st, id, { ask: th ? th.ask : null, at: iso(), time: stamp() }))) return;
    DES.app.toast(T('td_circle_toast'));
  };
  A['td-uncircle'] = function (el) { uncircleWithUndo(el.getAttribute('data-id'), null); };
  // 作ってみる（対話）: 題 = next.makeTitle・手順 = next.makeSteps の外で作る活動（同じお題の活動があればそれを開く）
  A['td-dmake'] = function (el) {
    var o = TDD.getDialog(el.getAttribute('data-id'));
    if (!o || !DES.make || !DES.plan || !DES.plan.newId) return;
    var r = dialogMake(S(), o, { id: DES.plan.newId('a'), mode: DES.mode(), now: DES.clock.now(),
      recText: T('td_make_rec', { q: pick(o.title), step: pick(o.next.makeSteps[0]) }) }, storeSave);
    if (!r) return;
    if (!r.created) { if (DES.make.openAct) DES.make.openAct(r.id); return; }
    if (!r.ok) { failSave(); return; }
    S().saveFailed = false;
    DES.app.commit();
    if (window.location.hash !== '#make/' + r.id) window.location.hash = '#make/' + r.id; else DES.app.render();
  };
  // 入口を開く（同時に 1 つ。もう一度押すと閉じる）。開いたことは記録に残す
  A['td-entry'] = function (el) {
    var id = el.getAttribute('data-id'), k = el.getAttribute('data-arg'), u = ui();
    u.open[id] = u.open[id] === k ? null : k;
    var st = S().odai, next = u.open[id] ? markEntry(st, id, k) : st;
    if (next !== st) { if (!putOdai(next)) { u.open[id] = null; DES.app.render(); return; } } else DES.app.render();
    var p = u.open[id] && document.getElementById('td-panel');
    if (p && p.scrollIntoView) p.scrollIntoView({ block: 'nearest' });
  };
  // 作ってみる: DES.make.openOdai（L2）へ。odai は { id: 'fx-…', lineage, title, firstStep, need, makeSteps, makeTheme: null }
  A['td-make'] = function (el) {
    var o = TDD.get(el.getAttribute('data-id'));
    if (!o || !DES.make || !DES.make.openOdai) return;
    markAndSave(o.id, 'make');
    DES.make.openOdai(o, null);
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
    if (!o || !text || !DES.make || !DES.make.openOdai) return;
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
    var left = r.state.tried[r.undo.id].found.length;
    if (!putOdai(r.state, { sel: left ? '[data-action="td-found-del"][data-arg="' + Math.min(i, left - 1) + '"]' : '[data-action="td-found-open"]' })) return;
    DES.app.toast(T('td_found_deleted'), { label: T('undo_restore'), fn: function () {
      putOdai(restoreFound(S().odai, r.undo), { sel: '[data-action="td-found-del"][data-arg="' + i + '"]' });
    } });
  };
  // 見つけた写真を残す: 写真を選ぶ（DES.photo.pick）→ 選べたらダイアログ（1 行 + 残す）。1 お題 6 枚・全体 60 枚まで（LS-18-11）
  A['td-found-open'] = function (el) {
    var o = TDD.get(el.getAttribute('data-id'));
    if (!o || !DES.photo || !DES.photo.pick) return;
    var full = foundOf(S().odai, o.lineage).length >= FOUND_MAX || (DES.photo.count && DES.photo.count() >= (DES.photo.LIMIT || 60));
    if (full) { DES.app.toast(T('photo_full')); return; }
    DES.photo.pick({ max: 1 }).then(function (list) {
      var p = list && list[0];
      if (!p || !TDD.photoValid(p) || DES.app.routeArg() !== o.id) return;
      ui().dlg = { id: o.id, photo: { data: p.data, w: p.w, h: p.h }, line: '', failed: false };
      renderDlg();
      DES.app.openDialog(dlgEl(), document.querySelector('[data-action="td-found-open"]') || el);
      dlgFocus('#td-found-line');
    });
  };
  A['td-found-ok'] = function () {
    var d = ui().dlg;
    if (!d) return;
    var prev = S().odai, next = addFound(prev, d.id, { photo: d.photo, line: d.line, at: iso(), time: stamp() });
    if (next === prev) { DES.app.toast(T('photo_full')); return; }
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
    DES.app.closeDialog(dlgEl());
    ui().dlg = null;
    DES.app.commit({ sel: '[data-action="td-found-open"]' });
    DES.app.toast(T('td_found_toast'));
  };

  // ---------- 入力の受け口 ----------
  TD.bind = function () {
    document.addEventListener('input', function (e) {
      var t = e.target, k = t && t.getAttribute ? t.getAttribute('data-ui') : null, u = ui();
      if (k === 'td-own' && u.own) { u.own.text = t.value; syncOwn(); }
      else if (k === 'td-found-line' && u.dlg) u.dlg.line = t.value;
      else if (k === 'td-mark-line') mineOf(t.getAttribute('data-id')).line = t.value;
    });
    document.addEventListener('change', function (e) {
      var t = e.target, k = t && t.getAttribute ? t.getAttribute('data-ui') : null, id = k ? t.getAttribute('data-id') : null;
      // 問いを選ぶ（記録して描き直す・フォーカスは選んだラジオに残る）/ 立場を選ぶ（入力中の値。「置く」を使えるようにする）
      if (k === 'td-ask') { putOdai(pickAsk(S().odai, id, t.value), { sel: '#td-ask-' + esc(t.value) }); return; }
      if (k === 'td-stance') { mineOf(id).stance = t.value; syncMine(id); return; }
      if (k !== 'td-hint') return;
      var i = +t.getAttribute('data-arg');
      putOdai(toggleHint(S().odai, id, i), { sel: '#td-hint-' + i });
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
