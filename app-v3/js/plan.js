/* 今日の予定: 状態機械（純関数）+ 描画 + 操作。CONTRACT-v3 §D / §E / §R
   純関数は DOM に触れない（node から module.exports で呼べる）。描画と操作は DES.state を読み書きし、
   変更は必ず DES.app.change → DES.store.save → 再描画 の 1 経路で反映する。 */
(function (root) {
  'use strict';
  var DES = root.DES = root.DES || {};
  var P = DES.plan = DES.plan || {};
  var WAVE = '〜';
  var RANK = { fixed: 0, event: 1, optional: 2, proposed: 3, mine: 4 };

  // ---------- 時刻 ----------
  function toMin(hm) { var p = String(hm).split(':'); return parseInt(p[0], 10) * 60 + parseInt(p[1], 10); }
  function toHM(m) { var h = Math.floor(m / 60), mm = m % 60; return h + ':' + (mm < 10 ? '0' : '') + mm; }
  function range(s, e) { return s + WAVE + e; }
  function lenOf(r) { return toMin(r.end) - toMin(r.start); }
  function assign(a, b) {
    var o = {}, k;
    for (k in a) if (Object.prototype.hasOwnProperty.call(a, k)) o[k] = a[k];
    for (k in b) if (Object.prototype.hasOwnProperty.call(b, k)) o[k] = b[k];
    return o;
  }
  function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
  function cls(c) { return c || (DES.data && DES.data.classroom); }
  function frame(c) {
    c = cls(c);
    return { open: toMin(c.open), close: toMin(c.close), ls: toMin(c.lunch[0]), le: toMin(c.lunch[1]) };
  }
  function blocks(c) { var f = frame(c); return { am: [f.open, f.ls], lunch: [f.ls, f.le], pm: [f.le, f.close] }; }
  function blockOf(start, c) { var f = frame(c), m = toMin(start); return m < f.ls ? 'am' : (m >= f.le ? 'pm' : 'lunch'); }
  function find(rows, id) { for (var i = 0; i < rows.length; i++) if (rows[i].id === id) return rows[i]; return null; }
  function replace(rows, id, patch) { return rows.map(function (r) { return r.id === id ? assign(r, patch) : r; }); }
  function intersects(a, b) { return toMin(a.start) < toMin(b.end) && toMin(b.start) < toMin(a.end); }

  // サークル対話の時刻は classroom.circle から派生（R-12）。'none' は出さない / 'tbd' は 10:50〜11:10 の位置
  function circleRow(r, c) {
    var ci = cls(c).circle || {};
    if (ci.today === 'none') return null;
    if (ci.today === 'tbd') return assign(r, { start: '10:50', end: '11:10', tbd: true });
    if (/^\d{1,2}:\d{2}$/.test(ci.today || '')) return assign(r, { start: ci.today, end: toHM(toMin(ci.today) + (ci.minutes || 20)), tbd: false });
    return r;
  }
  // 表に出る行（外した・終わった行と、サークル 'none' を除く）
  function live(rows, c) {
    var out = [];
    rows.forEach(function (r) {
      if (r.gone) return;
      if (r.kind === 'event') { r = circleRow(r, c); if (!r) return; }
      out.push(r);
    });
    return out;
  }
  // 占有（R-1）: fixed / event / optional(非skip) / mine(hidden 含む) / proposed。held と optional.skip は占有しない
  function occupies(r) {
    if (!r || r.gone) return false;
    if (r.kind === 'optional') return r.choice !== 'skip';
    return r.kind === 'fixed' || r.kind === 'event' || r.kind === 'mine' || r.kind === 'proposed';
  }

  // 空き時間（§D / R-1）: 占有の合間で min 分以上の区間すべて。午前→午後の時刻順
  function freeSlots(rows, c, o) {
    o = o || {};
    var min = o.min || 15, B = blocks(c);
    var occ = live(rows, c).filter(function (r) { return occupies(r) && r.id !== o.exclude; })
      .map(function (r) { return [toMin(r.start), toMin(r.end)]; })
      .sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    var out = [];
    ['am', 'pm'].forEach(function (b) {
      if (o.block && o.block !== b) return;
      var bs = B[b][0], be = B[b][1], cur = bs;
      occ.forEach(function (iv) {
        if (iv[1] <= cur || iv[0] >= be) return;
        var gs = Math.min(iv[0], be);
        if (gs - cur >= min) out.push({ start: toHM(cur), end: toHM(gs), len: gs - cur, block: b });
        cur = Math.max(cur, iv[1]);
      });
      if (be - cur >= min) out.push({ start: toHM(cur), end: toHM(be), len: be - cur, block: b });
    });
    return out;
  }
  function firstFit(rows, c, need, o) {
    var s = freeSlots(rows, c, o);
    for (var i = 0; i < s.length; i++) if (s[i].len >= need) return s[i];
    return null;
  }
  function newRow(item, slot, kind, o) {
    var len = Math.min(slot.len, 60);
    var r = { id: o.id, start: slot.start, end: toHM(toMin(slot.start) + len), title: item.title, kind: kind, activity: item.id };
    if (o.from) r.from = o.from;
    return r;
  }
  // 会話からの提案（§G 規則 1）: 最初の空き（15 分以上）に proposed。長さ = min(空き, 60)
  function propose(rows, c, item, o) {
    o = o || {};
    var slot = freeSlots(rows, c, { block: o.block })[0];
    if (!slot) return { rows: rows, row: null };
    var row = newRow(item, slot, 'proposed', o);
    return { rows: rows.concat([row]), row: row };
  }
  // 自分で追加（空き行 / グリッド）: o.at があればその空き行、無ければ最初の空き
  function addMine(rows, c, item, o) {
    o = o || {};
    var slots = freeSlots(rows, c, { block: o.block }), slot = null;
    if (o.at) { slots.forEach(function (s) { if (!slot && s.start === o.at) slot = s; }); }
    else slot = slots[0] || null;
    if (!slot) return { rows: rows, row: null };
    var row = newRow(item, slot, 'mine', o);
    return { rows: rows.concat([row]), row: row };
  }
  // 予定に入れる: proposed → mine / held → mine（R-1 の再検査）
  function accept(rows, c, id) {
    var r = find(rows, id);
    if (!r || r.gone || (r.kind !== 'proposed' && r.kind !== 'held')) return { rows: rows, row: null, moved: false };
    if (r.kind === 'proposed') { rows = replace(rows, id, { kind: 'mine' }); return { rows: rows, row: find(rows, id), moved: false }; }
    var clash = live(rows, c).some(function (o) { return o.id !== id && occupies(o) && intersects(o, r); });
    var patch = { kind: 'mine' }, moved = false;
    if (clash) {
      var slot = firstFit(rows, c, lenOf(r), { exclude: id });
      if (slot) { patch.start = slot.start; patch.end = toHM(toMin(slot.start) + lenOf(r)); moved = true; }
    }
    rows = replace(rows, id, patch);
    return { rows: rows, row: find(rows, id), moved: moved };
  }
  function hold(rows, id) {
    var r = find(rows, id);
    if (!r || r.kind !== 'proposed') return { rows: rows, row: null };
    rows = replace(rows, id, { kind: 'held' });
    return { rows: rows, row: find(rows, id) };
  }
  // 上へ / 下へ の相手（R-2）: 同ブロックで、間に占有行を挟まない隣の mine 行（hidden は動かせない予定として扱う）
  function partner(rows, c, id, dir) {
    var r = find(rows, id);
    if (!r || r.gone || r.kind !== 'mine' || r.hidden) return null;
    var b = blockOf(r.start, c);
    var list = live(rows, c).filter(function (x) { return blockOf(x.start, c) === b && (occupies(x) || x.kind === 'mine'); });
    list.sort(function (a, z) { return toMin(a.start) - toMin(z.start); });
    var i = -1;
    list.forEach(function (x, k) { if (x.id === id) i = k; });
    var o = list[dir === 'up' ? i - 1 : i + 1];
    return o && o.kind === 'mine' && !o.hidden ? o.id : null;
  }
  // 入れ替えた 2 行がブロックの終端（午前 12:30 / 午後 15:30）に収まるか（T-1）
  function swapFits(rows, c, idA, idB) {
    var a = find(rows, idA), b = find(rows, idB);
    if (!a || !b) return false;
    var x = toMin(a.start) <= toMin(b.start) ? a : b, y = x === a ? b : a;
    var end = toMin(x.start) + lenOf(x) + lenOf(y);
    return end <= blocks(c)[blockOf(x.start, c)][1];
  }
  // 上へ / 下へ の可否: { partner, fits }。partner が無い = 間に動かせない予定 / fits=false = この時間には入らない
  function canMove(rows, c, id, dir) {
    var p = partner(rows, c, id, dir);
    return { partner: p, fits: !!p && swapFits(rows, c, id, p) };
  }
  // 入れ替え（R-2）: 早い方の開始 A から、後ろにあった行 → 前にあった行 の順に詰め直す（長さは各自維持）
  function swap(rows, c, idA, idB) {
    var a = find(rows, idA), b = find(rows, idB);
    if (!a || !b || !swapFits(rows, c, idA, idB)) return { rows: rows, ok: false };
    var x = toMin(a.start) <= toMin(b.start) ? a : b, y = x === a ? b : a;
    var A = toMin(x.start), ly = lenOf(y), lx = lenOf(x);
    rows = replace(rows, y.id, { start: toHM(A), end: toHM(A + ly), edited: true, overlapLater: false });
    rows = replace(rows, x.id, { start: toHM(A + ly), end: toHM(A + ly + lx), edited: true, overlapLater: false });
    return { rows: rows, ok: true };
  }
  function move(rows, c, id, dir) {
    var m = canMove(rows, c, id, dir);
    if (!m.partner || !m.fits) return null;
    return { rows: swap(rows, c, id, m.partner).rows, partner: m.partner };
  }
  // 時刻を直す の選択肢（R-4）
  function startOptions(row, c) {
    var B = blocks(c), out = [], m;
    for (m = B.am[0]; m <= B.am[1] - 15; m += 15) out.push(toHM(m));
    for (m = B.pm[0]; m <= B.pm[1] - 15; m += 15) out.push(toHM(m));
    if (row && out.indexOf(row.start) < 0) { out.push(row.start); out.sort(function (a, b) { return toMin(a) - toMin(b); }); }
    return out;
  }
  function lenOptions(row) {
    var out = [15, 30, 45, 60];
    if (row && out.indexOf(lenOf(row)) < 0) { out.push(lenOf(row)); out.sort(function (a, b) { return a - b; }); }
    return out;
  }
  function setTime(rows, c, id, start, len) {
    var r = find(rows, id);
    if (!r) return { rows: rows, changed: false, row: null };
    var s = toMin(start), e = Math.min(s + (+len), frame(c).close);
    var ns = toHM(s), ne = toHM(e);
    if (ns === r.start && ne === r.end) return { rows: rows, changed: false, row: r };
    rows = replace(rows, id, { start: ns, end: ne, edited: true, overlapLater: false });
    return { rows: rows, changed: true, row: find(rows, id) };
  }
  // 外す（mine / held）。行は gone で残し、提案カードが「予定から外した」を出せるようにする
  function remove(rows, marks, id) {
    var r = find(rows, id);
    if (!r || r.gone || (r.kind !== 'mine' && r.kind !== 'held')) return null;
    return { rows: replace(rows, id, { gone: 'removed' }), marks: marks, undo: { type: 'remove', row: clone(r) } };
  }
  // 終わった（mine）: 行を消し、catalogMarks[activity].today に時間帯を足す
  function finish(rows, marks, id) {
    var r = find(rows, id);
    if (!r || r.gone || r.kind !== 'mine') return null;
    var rg = range(r.start, r.end), m2 = clone(marks || {});
    if (r.activity) {
      var m = m2[r.activity] || { today: [], tomorrow: false };
      m.today = (m.today || []).concat([rg]);
      m2[r.activity] = m;
    }
    return { rows: replace(rows, id, { gone: 'finished' }), marks: m2, range: rg,
      undo: { type: 'finish', row: clone(r), act: r.activity || null, added: rg } };
  }
  // 戻す（R-6）: 行を全フィールドで復元し、catalogMarks は差分だけ戻す
  function undo(rows, marks, t) {
    var found = false;
    rows = rows.map(function (r) { if (r.id === t.row.id) { found = true; return clone(t.row); } return r; });
    if (!found) rows = rows.concat([clone(t.row)]);
    var m2 = clone(marks || {});
    if (t.type === 'finish' && t.act && m2[t.act]) {
      var list = (m2[t.act].today || []).slice(), i = list.lastIndexOf(t.added);
      if (i >= 0) list.splice(i, 1);
      m2[t.act].today = list;
      if (!list.length && !m2[t.act].tomorrow) delete m2[t.act];
    }
    return { rows: rows, marks: m2, row: find(rows, t.row.id) };
  }
  function setHidden(rows, id, v) {
    var r = find(rows, id);
    if (!r || r.kind !== 'mine') return { rows: rows };
    return { rows: replace(rows, id, { hidden: !!v }) };
  }
  // 運動（R-5）: undecided / join / skip / later
  function setChoice(rows, id, choice) {
    var r = find(rows, id);
    if (!r || r.kind !== 'optional' || ['undecided', 'join', 'skip', 'later'].indexOf(choice) < 0) return { rows: rows, changed: false };
    if (r.choice === choice) return { rows: rows, changed: false };
    return { rows: replace(rows, id, { choice: choice }), changed: true };
  }
  // 重なり（R-3 / T-1）: 占有行どうしの交差を全部拾い、帯を出す行（target）と相手を返す。
  // 帯の行: hidden の mine（T-5: stub に「重なりがある」）→ 運動と mine は mine → 操作した行（actorId）→ RANK の大きい種類 → 開始が遅い方
  function overlaps(rows, c, actorId) {
    var L = live(rows, c).filter(occupies), out = [];
    function movable(r) { return r.kind === 'mine' || r.kind === 'proposed'; }
    for (var i = 0; i < L.length; i++) {
      for (var j = i + 1; j < L.length; j++) {
        var a = L[i], b = L[j];
        if (!intersects(a, b)) continue;
        var t;
        var ah = a.kind === 'mine' && !!a.hidden, bh = b.kind === 'mine' && !!b.hidden;
        if (ah !== bh) t = ah ? a : b;
        else if (a.kind === 'optional' && b.kind === 'mine') t = b;
        else if (b.kind === 'optional' && a.kind === 'mine') t = a;
        else if (actorId && a.id === actorId && movable(a)) t = a;
        else if (actorId && b.id === actorId && movable(b)) t = b;
        else if (RANK[a.kind] !== RANK[b.kind]) t = RANK[a.kind] > RANK[b.kind] ? a : b;
        else t = toMin(b.start) >= toMin(a.start) ? b : a;
        var o = t === a ? b : a;
        if (t.kind === 'fixed' || t.kind === 'event') continue;
        out.push({ id: t.id, other: o.id, otherTitle: o.title, otherStart: o.start, canShorten: toMin(t.start) < toMin(o.start) });
      }
    }
    return out;
  }
  // あとで決める（R-3 / T-1）: 重なりを保持し、本人の操作として edited を付ける
  function defer(rows, id) {
    var r = find(rows, id);
    if (!r) return { rows: rows, row: null };
    rows = replace(rows, id, { overlapLater: true, edited: true });
    return { rows: rows, row: find(rows, id) };
  }
  function shorten(rows, c, id, otherId) {
    var t = find(rows, id), o = find(live(rows, c), otherId);
    if (!t || !o || toMin(t.start) >= toMin(o.start)) return { rows: rows, row: null };
    rows = replace(rows, id, { end: o.start, edited: true, overlapLater: false });
    return { rows: rows, row: find(rows, id) };
  }
  // 別の時間へ（R-3）: 自分を除いた占有集合で、午前→午後の順に同じ長さが入る最初の空き
  function moveElsewhere(rows, c, id) {
    var r = find(rows, id);
    if (!r) return { rows: rows, row: null };
    var need = lenOf(r), slot = firstFit(rows, c, need, { exclude: id });
    if (!slot) return { rows: rows, row: null };
    rows = replace(rows, id, { start: slot.start, end: toHM(toMin(slot.start) + need), edited: true, overlapLater: false });
    return { rows: rows, row: find(rows, id) };
  }
  function keepTomorrow(marks, act) {
    var m2 = clone(marks || {});
    var m = m2[act] || { today: [], tomorrow: false };
    m.tomorrow = true; m2[act] = m;
    return m2;
  }
  // 名前照合（R-7）: 別名の最長一致、同点は catalog 順で先
  function matchText(text, catalog, aliases) {
    var low = String(text || '').toLowerCase(), best = null, bestLen = 0;
    (catalog || []).forEach(function (cat) {
      cat.items.forEach(function (it) {
        ((aliases && aliases[it.id]) || [it.title]).forEach(function (a) {
          if (a && a.length > bestLen && low.indexOf(String(a).toLowerCase()) >= 0) { best = it; bestLen = a.length; }
        });
      });
    });
    return best;
  }
  // おためしの取り組みを 1 つ選ぶ（S-1）: goals → 今日の続き → 前にやった → catalog 順
  // ctx: { goals, marks, catalog, aliases }。戻り値 { item, reason(i18n key), title }
  function pickTrial(rows, c, ctx) {
    var L = live(rows, c), inPlan = {}, items = [], byId = {}, i;
    L.forEach(function (r) { if (r.activity) inPlan[r.activity] = true; });
    (ctx.catalog || []).forEach(function (cat) { cat.items.forEach(function (it) { items.push(it); byId[it.id] = it; }); });
    var goals = ctx.goals || [];
    for (i = 0; i < goals.length; i++) {
      if (!goals[i] || !goals[i].text) continue;
      var g = matchText(goals[i].text, ctx.catalog, ctx.aliases);
      if (g && !inPlan[g.id]) return { item: g, reason: 'reason_goal', title: g.title };
    }
    var withAct = L.filter(function (r) { return r.activity && byId[r.activity]; })
      .sort(function (a, b) { return toMin(a.start) - toMin(b.start); });
    if (withAct.length) { var it0 = byId[withAct[0].activity]; return { item: it0, reason: 'reason_continue', title: it0.title + '（続き）' }; }
    var marks = ctx.marks || {};
    for (i = 0; i < items.length; i++) {
      var m = marks[items[i].id];
      if (m && m.today && m.today.length) return { item: items[i], reason: 'reason_done', title: items[i].title };
    }
    for (i = 0; i < items.length; i++) if (!inPlan[items[i].id]) return { item: items[i], reason: 'reason_catalog', title: items[i].title };
    return null;
  }
  // おためし行（S-1 / S-2）: o.at の空き行（無ければ今日の最初の空き）の先頭に 15 分の proposed（trial:true）
  function suggestTrial(rows, c, pick, o) {
    o = o || {};
    if (!pick) return { rows: rows, row: null };
    var slot = null;
    freeSlots(rows, c).forEach(function (s) { if (!slot && (!o.at || s.start === o.at)) slot = s; });
    if (!slot || slot.len < 15) return { rows: rows, row: null };
    var row = { id: o.id, start: slot.start, end: toHM(toMin(slot.start) + 15), title: pick.title, kind: 'proposed', activity: pick.item.id, trial: true };
    if (o.from) row.from = o.from;
    return { rows: rows.concat([row]), row: row };
  }
  // 提案を断る（S-3）: 行を消し占有を外す。戻す 用の写しを返す
  function decline(rows, id) {
    var r = find(rows, id);
    if (!r || r.gone || r.kind !== 'proposed') return null;
    return { rows: replace(rows, id, { gone: 'declined' }), undo: { type: 'decline', row: clone(r) } };
  }

  var pure = {
    toMin: toMin, toHM: toHM, range: range, lenOf: lenOf, blockOf: blockOf, blocks: blocks, live: live, occupies: occupies,
    freeSlots: freeSlots, firstFit: firstFit, propose: propose, addMine: addMine, accept: accept, hold: hold,
    partner: partner, swapFits: swapFits, canMove: canMove, defer: defer,
    swap: swap, move: move, startOptions: startOptions, lenOptions: lenOptions, setTime: setTime,
    remove: remove, finish: finish, undo: undo, setHidden: setHidden, setChoice: setChoice, overlaps: overlaps,
    shorten: shorten, moveElsewhere: moveElsewhere, keepTomorrow: keepTomorrow,
    matchText: matchText, pickTrial: pickTrial, suggestTrial: suggestTrial, decline: decline
  };
  Object.keys(pure).forEach(function (k) { P[k] = pure[k]; });

  // ======================================================================
  // ここから下はブラウザ専用（DES.state / DES.h / DES.app を実行時に参照）
  // ======================================================================
  var seq = 0;
  P.newId = function (prefix) { seq += 1; return prefix + Date.now().toString(36) + '-' + seq; };
  P.item = function (actId) {
    var hit = null;
    (DES.data.catalog || []).forEach(function (cat) { cat.items.forEach(function (it) { if (it.id === actId) hit = it; }); });
    return hit;
  };
  function C() { return DES.data.classroom; }
  function S() { return DES.state; }
  function ui() { return DES.ui; }
  function T(k, v) { return DES.t(k, v); }
  function X(k, v) { return DES.fmt(DES.text[k], v); }
  function rec(text) { DES.talk.record(text); }

  // 会話 → 表（§G 規則 1）。行を足して返す（コミットは呼び出し側）
  P.propose = function (actId, o) {
    o = o || {};
    var item = P.item(actId);
    if (!item) return null;
    var res = propose(S().plan, C(), item, { block: o.block, from: o.from, id: P.newId('p') });
    if (res.row) S().plan = res.rows;
    return res.row;
  };
  P.freeNow = function (o) { return freeSlots(S().plan, C(), o); };
  P.match = function (text) { return matchText(text, DES.data.catalog, DES.aliases); };
  // おためし行を置く（S-1 / S-2）。at = 空き行の開始（null なら今日の最初の空き）。
  // 戻り値 { row, text }（text は buddy の返事）/ 置けなければ null。コミットは呼び出し側
  P.trial = function (at, from) {
    var pick = pickTrial(S().plan, C(), { goals: S().goals, marks: S().catalogMarks, catalog: DES.data.catalog, aliases: DES.aliases });
    var res = suggestTrial(S().plan, C(), pick, { at: at, from: from, id: P.newId('p') });
    if (!res.row) return null;
    S().plan = res.rows;
    return { row: res.row, text: T('trial_ask', { title: res.row.title, reason: T(pick.reason) }) };
  };

  // ---------- 操作（表 → 会話の記録） ----------
  var act = P.act = {};
  act.accept = function (id) {
    DES.app.change(function () {
      var res = accept(S().plan, C(), id);
      if (!res.row) return;
      S().plan = res.rows;
      ui().actor = id;
      if (res.row.trial) rec(X('rec_trial', { title: res.row.title, start: res.row.start }) + (res.moved ? DES.text.rec_moved_suffix : ''));
      else rec(X(res.moved ? 'rec_add_moved' : 'rec_add', { start: res.row.start, title: res.row.title }));
    }, { focus: 'row:' + id });
  };
  act.decline = function (id) {
    var r = find(S().plan, id);
    if (!r) return;
    DES.app.change(function () {
      var res = decline(S().plan, id);
      if (!res) return;
      S().plan = res.rows;
      rec(X('rec_decline', { title: r.title }));
      DES.app.toast(T('declined'), { label: T('undo'), fn: function () { act.undo(res.undo); } });
    }, { leave: id, focus: 'plan-head' });
  };
  act.trial = function (start) {
    var tid = P.newId('t'), rowId = null;
    DES.app.change(function () {
      var res = P.trial(start, tid);
      if (!res) { DES.app.toast(T('no_slot_band')); return; }
      rowId = res.row.id;
      ui().actor = rowId;
      DES.talk.push({ id: tid, time: DES.data.now, who: 'buddy', text: res.text, proposal: res.row.id });
    }, { focusFn: function () { return rowId ? 'row:' + rowId : null; } });
  };
  act.hold = function (id) {
    DES.app.change(function () {
      var res = hold(S().plan, id);
      if (!res.row) return;
      S().plan = res.rows;
      rec(X('rec_hold', { title: res.row.title }));
    }, { focus: 'row:' + id });
  };
  act.move = function (id, dir) {
    DES.app.change(function () {
      var r = find(S().plan, id), res = move(S().plan, C(), id, dir);
      if (!res) return;
      S().plan = res.rows;
      ui().actor = id;
      rec(X('rec_swap', { a: r.title, b: find(S().plan, res.partner).title }));
    }, { focus: 'row:' + id });
  };
  act.swapWith = function (id, other) {
    var ok = ['up', 'down'].some(function (d) { var m = canMove(S().plan, C(), id, d); return m.partner === other && m.fits; });
    if (!ok) return;
    DES.app.change(function () {
      var a = find(S().plan, id), b = find(S().plan, other);
      S().plan = swap(S().plan, C(), id, other).rows;
      ui().actor = id;
      rec(X('rec_swap', { a: a.title, b: b.title }));
    }, { focus: 'row:' + id });
  };
  act.setTime = function (id, start, len) {
    DES.app.change(function () {
      var res = setTime(S().plan, C(), id, start, len);
      ui().edit = null;
      if (!res.changed) return;
      S().plan = res.rows;
      ui().actor = id;
      delete ui().noSlot[id];
      rec(X('rec_time', { title: res.row.title, start: res.row.start, end: res.row.end }));
    }, { focus: 'row:' + id });
  };
  act.remove = function (id) {
    var r = find(S().plan, id);
    if (!r) return;
    DES.app.change(function () {
      var res = remove(S().plan, S().catalogMarks, id);
      if (!res) return;
      S().plan = res.rows;
      rec(X('rec_remove', { title: r.title }));
      DES.app.toast(T('removed_toast'), { label: T('undo'), fn: function () { act.undo(res.undo); } });
    }, { leave: id, focus: 'plan-head' });
  };
  act.finish = function (id) {
    var r = find(S().plan, id);
    if (!r) return;
    DES.app.change(function () {
      var res = finish(S().plan, S().catalogMarks, id);
      if (!res) return;
      S().plan = res.rows; S().catalogMarks = res.marks;
      rec(X('rec_finish', { title: r.title, start: r.start, end: r.end }));
      DES.app.toast(T('returned_toast', { title: r.title }), { label: T('undo'), fn: function () { act.undo(res.undo); } });
    }, { leave: id, focus: 'plan-head' });
  };
  act.undo = function (token) {
    DES.app.change(function () {
      var res = undo(S().plan, S().catalogMarks, token);
      S().plan = res.rows; S().catalogMarks = res.marks;
      ui().actor = token.row.id;
      rec(X('rec_undo', { title: res.row.title }));
      DES.app.toastHide();
    }, { focus: 'row:' + token.row.id });
  };
  act.hide = function (id) {
    DES.app.change(function () { S().plan = setHidden(S().plan, id, true).rows; }, { focus: 'row:' + id });
  };
  act.show = function (id) {
    DES.app.change(function () { S().plan = setHidden(S().plan, id, false).rows; ui().actor = id; }, { focus: 'row:' + id });
  };
  act.choice = function (id, choice) {
    DES.app.change(function () {
      var res = setChoice(S().plan, id, choice);
      if (!res.changed) return;
      S().plan = res.rows;
      ui().actor = id;
      if (choice === 'join') rec(DES.text.rec_join);
      if (choice === 'skip') rec(DES.text.rec_skip);
      if (choice === 'later') rec(DES.text.rec_later);
    }, { focus: 'row:' + id });
  };
  act.addAt = function (start, actId) {
    var item = P.item(actId), newId = P.newId('p');
    if (!item) return;
    DES.app.change(function () {
      var res = addMine(S().plan, C(), item, { at: start, id: newId });
      if (!res.row) { DES.app.toast(T('no_slot_band')); return; }
      S().plan = res.rows;
      ui().actor = newId;
      rec(X('rec_add', { start: res.row.start, title: res.row.title }));
    }, { focus: 'row:' + newId });
  };
  // 取り組みを予定に入れる（グリッドの「入れる」）。外から呼べる（あしあと §Z-6 は o = { undo: true, after: 戻した後のフォーカス }）。
  // o.undo の時だけトーストに「戻す」（5 秒: 入れた行を外し、記録は消さず「「{title}」を戻した」を足す — R-6 と同じ）。o 無しは従来どおり
  act.addFirst = function (actId, o) {
    o = o || {};
    var item = P.item(actId), newId = P.newId('p');
    if (!item) return;
    DES.app.change(function () {
      var res = addMine(S().plan, C(), item, { id: newId });
      if (!res.row) {
        DES.app.toast(T('no_free'), { label: T('keep_tomorrow'), fn: function () { act.keepTomorrow(actId); } });
        return;
      }
      S().plan = res.rows;
      ui().actor = newId;
      var line = X('rec_add', { start: res.row.start, title: res.row.title });
      rec(line);
      DES.app.toast(line, o.undo ? { label: T('undo'), fn: function () { act.unadd(newId, o.after); } } : null);
    });
  };
  act.unadd = function (id, after) {
    var r = find(S().plan, id);
    if (!r) return;
    DES.app.change(function () {
      S().plan = S().plan.filter(function (x) { return x.id !== id; });
      if (ui().actor === id) ui().actor = null;
      rec(X('rec_undo', { title: r.title }));
      DES.app.toastHide();
    }, after);
  };
  act.keepTomorrow = function (actId) {
    DES.app.change(function () {
      S().catalogMarks = keepTomorrow(S().catalogMarks, actId);
      DES.app.toast(T('kept_tomorrow'));
    });
  };
  act.shorten = function (id, other) {
    DES.app.change(function () {
      var res = shorten(S().plan, C(), id, other);
      if (!res.row) return;
      S().plan = res.rows;
      ui().actor = id;
      rec(X('rec_shorten', { title: res.row.title, start: res.row.start, end: res.row.end }));
    }, { focus: 'row:' + id });
  };
  act.elsewhere = function (id) {
    DES.app.change(function () {
      var res = moveElsewhere(S().plan, C(), id);
      if (!res.row) { ui().noSlot[id] = true; return; }
      delete ui().noSlot[id];
      S().plan = res.rows;
      ui().actor = id;
      rec(X('rec_moved', { title: res.row.title, start: res.row.start }));
    }, { focus: 'row:' + id });
  };
  act.defer = function (id) {
    DES.app.change(function () {
      var r = find(S().plan, id);
      S().plan = defer(S().plan, id).rows;
      ui().actor = id;
      delete ui().noSlot[id];
      rec(X('rec_defer', { title: r.title }));
    }, { focus: 'row:' + id });
  };
  act.reopen = function (id) {
    DES.app.change(function () { S().plan = replace(S().plan, id, { overlapLater: false }); ui().actor = id; }, { focus: 'row:' + id });
  };
  act.saveGoal = function (id, text) {
    DES.app.change(function () {
      var v = String(text || '').replace(/\s+$/, '').replace(/^\s+/, '');
      var before = null;
      S().goals = S().goals.map(function (g) {
        if (g.id !== id) return g;
        before = g.text;
        if (!v) return { id: g.id, label: g.label, text: null };
        return { id: g.id, label: g.label, text: v, src: 'own', date: DES.data.today.slice(5) };
      });
      ui().goalEdit = null;
      var g = S().goals.filter(function (x) { return x.id === id; })[0];
      if (v && v !== before) rec(X('rec_goal', { label: g.label, text: v }));
    }, { focus: 'goal:' + id });
  };

  // ---------- 描画ヘルパ ----------
  function H() { return DES.h.apply(null, arguments); }
  function icon(name) { return DES.raw(DES.icon(name)); }
  function chip(text, kls, o) {
    o = o || {};
    var kids = [];
    if (o.icon) kids.push(icon(o.icon));
    kids.push(H('span', null, text));
    var attrs = { class: 'chip ' + kls };
    if (o.label) { attrs.role = 'img'; attrs['aria-label'] = o.label; }
    return H('span', attrs, kids);
  }
  function srcChip(kind, text) {
    var map = { own: 'quote', record: 'record', ai: 'spark' };
    var name = T({ own: 'own_label', record: 'record_label', ai: 'ai_proposal' }[kind]);
    var label = text.indexOf(name) === 0 ? text : name + ' ' + text;
    return chip(text, 'src-' + kind, { icon: map[kind], label: label });
  }
  P.srcChip = srcChip;
  function btn(label, action, o) {
    o = o || {};
    var a = { class: 'btn small' + (o.kls ? ' ' + o.kls : ''), type: 'button', 'data-action': action };
    if (o.id) a['data-id'] = o.id;
    if (o.arg != null) a['data-arg'] = o.arg;
    if (o.disabled) { a.disabled = true; if (o.title) a.title = o.title; }
    if (o.attrs) Object.keys(o.attrs).forEach(function (k) { a[k] = o.attrs[k]; });
    var kids = [];
    if (o.icon) kids.push(icon(o.icon));
    kids.push(H('span', null, label));
    return H('button', a, kids);
  }
  P.btn = btn;
  function goalDate(d) { if (!d) return ''; var p = String(d).split('-'); return (+p[0]) + '/' + (+p[1]); }
  function bp() { return DES.app.bp(); }

  function kindChip(r) {
    if (r.kind === 'fixed') return chip(T('kind_fixed'), 'k-fixed');
    if (r.kind === 'event') return r.tbd ? chip(T('circle_tbd'), 'k-event') : chip(T('kind_event'), 'k-event');
    if (r.kind === 'optional') {
      if (r.choice === 'join') return chip(T('join'), 'k-mine');
      if (r.choice === 'later') return chip(T('decide_later'), 'k-held');
      return chip(T('kind_optional'), 'k-optional');
    }
    if (r.kind === 'mine') return chip(T('kind_mine'), 'k-mine');
    if (r.kind === 'proposed') return chip(T('kind_proposed'), 'k-proposed');
    if (r.kind === 'held') return chip(T('kind_held'), 'k-held');
    return null;
  }

  // ---------- 表 ----------
  // o: { ctx:'panel'|'dialog'|'page', compact:bool, wide:bool }
  P.renderTable = function (o) {
    var st = S(), c = C(), rows = st.plan, L = live(rows, c), B = blocks(c);
    var conf = {};
    overlaps(rows, c, ui().actor).sort(function (a, b) { return toMin(a.otherStart) - toMin(b.otherStart); })
      .forEach(function (x) { if (!conf[x.id]) conf[x.id] = x; });
    var seen = ui().seen[o.ctx], nextSeen = {};
    // drawer / sheet（ctx 'dialog'）は幅 340px 以下なので常に「…」へ収納（T-3）。作るの drawer は ≥ 1121 でも開く（§U）
    var optMenu = o.ctx === 'dialog' ? true : (o.ctx !== 'page' ? (bp() !== 'xl') : (bp() === 's'));
    var items = { am: [], lunch: [], pm: [] };
    L.forEach(function (r) { items[blockOf(r.start, c)].push({ t: 'row', s: toMin(r.start), e: toMin(r.end), r: r }); });
    freeSlots(rows, c).forEach(function (f) { items[f.block].push({ t: 'free', s: toMin(f.start), e: toMin(f.end), f: f }); });
    ['am', 'lunch', 'pm'].forEach(function (b) {
      items[b].sort(function (x, y) { return x.s - y.s || (x.t === 'free' ? 1 : 0) - (y.t === 'free' ? 1 : 0); });
    });
    // 現在時刻線（R-8）: 開始 ≤ now の最後の行の直下。その行が now を含むなら上辺
    var now = toMin(DES.data.now), flat = [];
    ['am', 'lunch', 'pm'].forEach(function (b) { items[b].forEach(function (it) { flat.push(it); }); });
    var last = null;
    flat.forEach(function (it) { if (it.s <= now) last = it; });
    var lineAt = null;
    if (last) lineAt = { it: last, before: now < last.e };

    var wrap = H('div', { class: 'plan-table' + (o.wide ? ' is-wide' : '') + (o.compact ? ' is-compact' : '') });
    var heads = { am: T('am'), lunch: T('lunch'), pm: T('pm') };
    ['am', 'lunch', 'pm'].forEach(function (b) {
      var sec = H('section', { class: 'block block-' + b, 'aria-label': heads[b] + ' ' + range(toHM(B[b][0]), toHM(B[b][1])) }, [
        H('h3', { class: 'block-head' }, [H('span', { class: 'bh-name' }, heads[b]), H('span', { class: 'bh-range' }, range(toHM(B[b][0]), toHM(B[b][1])))])
      ]);
      var list = H('div', { class: 'block-rows' });
      items[b].forEach(function (it) {
        if (lineAt && lineAt.it === it && lineAt.before) list.appendChild(nowLine());
        if (it.t === 'free') list.appendChild(freeRow(it.f, o));
        else {
          nextSeen[it.r.id] = true;
          list.appendChild(rowGroup(it.r, o, conf[it.r.id], optMenu, seen && !seen[it.r.id]));
        }
        if (lineAt && lineAt.it === it && !lineAt.before) list.appendChild(nowLine());
      });
      sec.appendChild(list);
      wrap.appendChild(sec);
    });
    ui().seen[o.ctx] = nextSeen;
    return wrap;
  };
  function nowLine() {
    return H('div', { class: 'now-line', 'aria-hidden': 'true' }, [H('span', { class: 'now-time' }, DES.data.now)]);
  }
  function timeCol(r) {
    return H('div', { class: 'row-time' }, [
      H('span', { class: 't-start' }, r.start), H('span', { class: 't-sep', 'aria-hidden': 'true' }, WAVE), H('span', { class: 't-end' }, r.end),
      r.kind === 'mine' && r.edited ? H('span', { class: 'edited-mark' }, T('edited_mark')) : null
    ]);
  }
  function freeRow(f, o) {
    var ops = [btn(T('add_activity'), 'free-add', { arg: f.start, icon: 'plus' })];
    if (f.len >= 15) ops.push(btn(T('leave_it'), 'free-trial', { arg: f.start, icon: 'spark' }));
    return H('div', { class: 'row free', 'data-slot': f.start, 'data-end': f.end }, [
      H('div', { class: 'row-time', 'aria-hidden': 'true' }),
      H('div', { class: 'row-title' }, T('free') + ' ' + range(f.start, f.end)),
      H('div', { class: 'row-ops' }, ops)
    ]);
  }
  function rowGroup(r, o, cf, optMenu, isNew) {
    var g = H('div', { class: 'row-group', 'data-fk': 'row:' + r.id, tabindex: '-1' });
    var stubHidden = r.kind === 'mine' && r.hidden, stubSkip = r.kind === 'optional' && r.choice === 'skip';
    if (stubHidden || stubSkip) {
      var label = stubHidden ? T('hidden_stub', { title: r.title }) : T('exercise_skipped');
      var op = stubHidden ? btn(T('show'), 'row-show', { id: r.id }) : btn(T('reselect'), 'opt', { id: r.id, arg: 'undecided' });
      // T-5: 非表示の行が重なりに関わるときは stub に小さく「重なりがある」。操作は「表示する」だけ
      var title = [label];
      if (stubHidden && cf) title.push(' ', H('span', { class: 'stub-overlap' }, T('compact_overlap')));
      g.appendChild(H('div', { class: 'row stub' + (isNew ? ' enter' : ''), 'data-id': r.id }, [
        H('div', { class: 'row-time' }, [H('span', { class: 't-start' }, r.start)]),
        H('div', { class: 'row-title' }, title),
        H('div', { class: 'row-ops' }, [op])
      ]));
      return g;
    }
    var kids = [timeCol(r)];
    var title = H('div', { class: 'row-title' }, [
      r.kind === 'mine' ? H('span', { class: 'drag-mark', 'aria-hidden': 'true' }, [icon('drag')]) : null,
      H('span', { class: 'rt-text' }, r.title)
    ]);
    kids.push(title);
    var chips = r.kind === 'proposed' ? [srcChip('ai', T('ai_proposal'))] : [kindChip(r)];
    if (r.trial && (r.kind === 'proposed' || r.kind === 'mine')) chips.push(chip(T('trial'), 'k-trial'));
    if (cf && r.overlapLater) {
      chips.push(H('button', { class: 'chip-btn', type: 'button', 'data-action': 'ov-reopen', 'data-id': r.id, 'aria-label': T('overlap') + ': ' + T('overlap_with', { title: cf.otherTitle }) }, [chip(T('overlap'), 'k-overlap')]));
    }
    kids.push(H('div', { class: 'row-chips' }, chips));
    var ops = H('div', { class: 'row-ops' }), wideOps = false;
    if (r.kind === 'mine') {
      ops.appendChild(H('button', { class: 'icon-btn row-more', type: 'button', 'data-action': 'row-menu', 'data-id': r.id,
        'aria-haspopup': 'menu', 'aria-expanded': ui().menu === r.id ? 'true' : 'false', 'aria-label': T('row_ops', { title: r.title }) }, [icon('more')]));
    } else if (r.kind === 'proposed') {
      wideOps = true;
      ops.appendChild(btn(T('add_to_plan'), 'accept', { id: r.id, kls: 'orange' }));
      ops.appendChild(btn(T('later'), 'hold', { id: r.id }));
      ops.appendChild(btn(T('decline'), 'decline', { id: r.id }));
    } else if (r.kind === 'held') {
      wideOps = true;
      ops.appendChild(btn(T('add_to_plan'), 'accept', { id: r.id }));
      ops.appendChild(btn(T('remove'), 'row-remove', { id: r.id }));
    } else if (r.kind === 'optional') {
      if (r.choice === 'undecided' || !r.choice) {
        if (optMenu) {
          ops.appendChild(H('button', { class: 'icon-btn row-more', type: 'button', 'data-action': 'row-menu', 'data-id': r.id,
            'aria-haspopup': 'menu', 'aria-expanded': ui().menu === r.id ? 'true' : 'false', 'aria-label': T('row_ops', { title: r.title }) }, [icon('more')]));
        } else {
          wideOps = true;
          ops.appendChild(btn(T('join'), 'opt', { id: r.id, arg: 'join' }));
          ops.appendChild(btn(T('skip_ex'), 'opt', { id: r.id, arg: 'skip' }));
          ops.appendChild(btn(T('decide_later'), 'opt', { id: r.id, arg: 'later' }));
        }
      } else {
        ops.appendChild(btn(T('reselect'), 'opt', { id: r.id, arg: 'undecided' }));
      }
    }
    kids.push(ops);
    var rowAttrs = { class: 'row k-' + r.kind + (wideOps ? ' wide-ops' : '') + (isNew ? ' enter' : '') + (cf && !r.overlapLater ? ' has-overlap' : ''), 'data-id': r.id };
    if (r.kind === 'mine') rowAttrs.draggable = 'true';
    g.appendChild(H('div', rowAttrs, kids));
    if (ui().menu === r.id && bp() !== 's') g.appendChild(rowMenu(r));
    if (ui().edit && ui().edit.id === r.id) g.appendChild(timeEditor(r));
    if (cf && !r.overlapLater) g.appendChild(band(r, cf, o));
    return g;
  }
  function menuItems(r) {
    if (r.kind === 'optional') {
      return [
        btn(T('join'), 'opt', { id: r.id, arg: 'join', attrs: { role: 'menuitem' } }),
        btn(T('skip_ex'), 'opt', { id: r.id, arg: 'skip', attrs: { role: 'menuitem' } }),
        btn(T('decide_later'), 'opt', { id: r.id, arg: 'later', attrs: { role: 'menuitem' } })
      ];
    }
    var up = canMove(S().plan, C(), r.id, 'up'), down = canMove(S().plan, C(), r.id, 'down');
    function why(m) { return !m.partner ? T('move_blocked') : T('swap_no_fit'); }
    return [
      btn(T('move_up'), 'row-move', { id: r.id, arg: 'up', icon: 'up', disabled: !up.fits, title: why(up), attrs: { role: 'menuitem' } }),
      btn(T('move_down'), 'row-move', { id: r.id, arg: 'down', icon: 'down', disabled: !down.fits, title: why(down), attrs: { role: 'menuitem' } }),
      btn(T('fix_time'), 'row-time', { id: r.id, attrs: { role: 'menuitem' } }),
      btn(T('remove'), 'row-remove', { id: r.id, attrs: { role: 'menuitem' } }),
      btn(T('hide'), 'row-hide', { id: r.id, attrs: { role: 'menuitem' } }),
      btn(T('finished'), 'row-finish', { id: r.id, icon: 'check', attrs: { role: 'menuitem' } }),
      // 7 つ目（design-v3 §3 / CONTRACT-v3 §U-3）: その取り組みの作業台、無ければ作るの入口へ
      btn(T('open_in_make'), 'row-make', { id: r.id, icon: 'make', attrs: { role: 'menuitem' } })
    ];
  }
  P.menuItems = menuItems;
  function rowMenu(r) {
    return H('div', { class: 'row-menu', role: 'menu', 'aria-label': T('row_ops', { title: r.title }) }, menuItems(r));
  }
  function timeEditor(r) {
    var e = ui().edit;
    var sSel = H('select', { 'data-ui': 'edit-start', id: 'te-s-' + r.id }, startOptions(r, C()).map(function (v) {
      return H('option', { value: v, selected: v === e.start }, v);
    }));
    var lSel = H('select', { 'data-ui': 'edit-len', id: 'te-l-' + r.id }, lenOptions(r).map(function (n) {
      return H('option', { value: String(n), selected: String(n) === String(e.len) }, T('minutes', { n: n }));
    }));
    return H('div', { class: 'time-edit' }, [
      H('label', { class: 'te-field', for: 'te-s-' + r.id }, [H('span', null, T('start_at')), sSel]),
      H('label', { class: 'te-field', for: 'te-l-' + r.id }, [H('span', null, T('length')), lSel]),
      H('div', { class: 'actions' }, [btn(T('decide'), 'time-ok', { id: r.id, kls: 'primary' }), btn(T('cancel'), 'time-cancel', { id: r.id })])
    ]);
  }
  function band(r, cf, o) {
    var b = H('div', { class: 'overlap-band', role: 'group', 'aria-label': T('overlap') });
    if (o.compact) {
      b.appendChild(H('p', null, T('compact_overlap')));
      b.appendChild(H('a', { class: 'link-btn', href: '#plan', 'data-action': 'goto-plan' }, T('fix_in_plan')));
      return b;
    }
    b.appendChild(H('p', null, ui().noSlot[r.id] ? T('no_slot_band') : T('overlap_with', { title: cf.otherTitle })));
    if (r.kind !== 'mine' && r.kind !== 'proposed') return b;
    var acts = H('div', { class: 'actions' });
    if (cf.canShorten) acts.appendChild(btn(T('shorten'), 'ov-shorten', { id: r.id, arg: cf.other }));
    acts.appendChild(btn(T('move_other'), 'ov-move', { id: r.id }));
    acts.appendChild(btn(T('decide_later'), 'ov-later', { id: r.id }));
    b.appendChild(acts);
    return b;
  }

  // ---------- 目標 3 枠（§E-2） ----------
  P.renderGoals = function (o) {
    var wrap = H('div', { class: 'goals' + (o.wide ? ' is-wide' : '') });
    if (o.wide) wrap.appendChild(H('p', { class: 'eyebrow goals-head' }, T('goals_head')));
    var list = H('div', { class: 'goal-list' });
    S().goals.forEach(function (g) {
      var ge = ui().goalEdit;
      if (ge && ge.id === g.id) {
        list.appendChild(H('div', { class: 'goal editing', 'data-fk': 'goal:' + g.id, tabindex: '-1' }, [
          H('label', { class: 'goal-label', for: 'goal-in-' + g.id }, g.label),
          H('textarea', { id: 'goal-in-' + g.id, rows: '1', 'data-ui': 'goal-input', 'data-id': g.id, value: ge.value }),
          H('div', { class: 'actions' }, [btn(T('keep_text'), 'goal-save', { id: g.id, kls: 'primary' }), btn(T('cancel'), 'goal-cancel', { id: g.id })])
        ]));
        return;
      }
      var kids, kls = 'goal ' + (g.text ? 'has-text' : 'empty');
      if (o.wide) {
        // #plan: 横並びカード（label eyebrow + 本文 + 本人の言葉チップ）
        kids = [H('span', { class: 'goal-label' }, g.label)];
        if (g.text) {
          kids.push(H('span', { class: 'goal-text' }, g.text));
          kids.push(srcChip('own', T('own_label') + ' ' + goalDate(g.date)));
        } else kids.push(H('span', { class: 'goal-empty' }, T('goal_empty')));
      } else {
        // パネル / drawer / sheet: 1 行のコンパクト形（T-4）。出所は左 3px の青 + 読み上げ用の文
        kls += ' compact';
        kids = [H('span', { class: 'g-label' }, g.label), H('span', { class: 'g-text' }, g.text || T('goal_empty'))];
        if (g.text) kids.push(H('span', { class: 'sr-only' }, T('own_label') + ' ' + goalDate(g.date)));
      }
      list.appendChild(H('button', { class: kls, type: 'button', 'data-action': 'goal-edit', 'data-id': g.id, 'data-fk': 'goal:' + g.id }, kids));
    });
    wrap.appendChild(list);
    return wrap;
  };

  // ---------- 今まで取り組んできたこと（§E-3 / R-8） ----------
  // o: { mode:'normal'|'pick', cols:1|2|3, slot }
  P.renderGrid = function (o) {
    var st = S(), L = live(st.plan, C()), marks = st.catalogMarks || {};
    var wrap = H('div', { class: 'grid' + (o.cols > 1 ? ' cols-' + o.cols : '') + (o.mode === 'pick' ? ' is-pick' : '') });
    DES.data.catalog.forEach(function (cat) {
      var ul = H('ul', { class: 'act-list' });
      cat.items.forEach(function (it) {
        var main = [H('span', { class: 'act-title' }, it.title)], ops;
        if (o.mode !== 'pick') {
          var chips = [];
          var inPlan = L.some(function (r) { return r.activity === it.id && (r.kind === 'mine' || r.kind === 'proposed' || r.kind === 'held'); });
          if (inPlan) chips.push(H('span', { class: 'pill' }, T('in_plan')));
          var m = marks[it.id] || {}, today = m.today || [];
          today.slice(0, 2).forEach(function (rg) { chips.push(srcChip('record', T('today_done', { range: rg }))); });
          if (today.length > 2) chips.push(H('span', { class: 'grid-more' }, T('grid_note_more', { n: today.length - 2 })));
          if (m.tomorrow) chips.push(chip(T('kept_tomorrow'), 'k-tomorrow'));
          if (chips.length) main.push(H('span', { class: 'act-chips' }, chips));
          // 文字だけの軽い操作（T-4）。読み上げは元の長い名前 + 取り組み名
          ops = [
            btn(T('add_short'), 'grid-add', { id: it.id, kls: 'ghost', attrs: { 'aria-label': T('add_to_plan') + ': ' + it.title } }),
            btn(T('ask_short'), 'grid-ask', { id: it.id, kls: 'ghost', attrs: { 'aria-label': T('ask_buddy') + ': ' + it.title } })
          ];
        } else {
          ops = [btn(T('add_here'), 'pick', { id: it.id, arg: o.slot, icon: 'plus' })];
        }
        var liAttrs = { class: 'act', 'data-act': it.id };
        if (o.mode !== 'pick') liAttrs.draggable = 'true';
        ul.appendChild(H('li', liAttrs, [H('span', { class: 'act-main' }, main), H('span', { class: 'act-ops' }, ops)]));
      });
      wrap.appendChild(H('section', { class: 'cat-card' }, [H('h3', { class: 'cat-name' }, cat.label), ul]));
    });
    var out = H('div', { class: 'grid-wrap' }, [wrap]);
    if (o.mode !== 'pick') out.appendChild(H('p', { class: 'grid-note' }, T('back_to_history')));
    return out;
  };

  // ---------- 右パネル（§E-1）: inline / drawer / sheet 共通 ----------
  function dateLabel() {
    var d = DES.data.today.split('-');
    return T('plan_date', { m: +d[1], d: +d[2], w: DES.data.weekday, g: DES.data.group });
  }
  P.dateLabel = dateLabel;
  P.renderPanel = function (aside, o) {
    var st = S(), tab = st.panelTab === 'history' ? 'history' : 'plan';
    aside.textContent = '';
    aside.appendChild(H('div', { class: 'panel-head' }, [
      H('div', { class: 'ph-title' }, [
        H('h2', { tabindex: '-1', 'data-fk': 'plan-head' }, T('plan')),
        H('p', { class: 'panel-date' }, dateLabel())
      ]),
      H('div', { class: 'ph-actions' }, [
        H('a', { class: 'link-btn widen', href: '#plan', 'data-action': 'goto-plan' }, T('widen')),
        H('button', { class: 'icon-btn panel-close', type: 'button', 'data-action': 'panel-close', 'aria-label': T('close') }, [icon('close')])
      ])
    ]));
    aside.appendChild(H('div', { class: 'panel-tabs' }, [H('div', { class: 'segmented', role: 'tablist', 'aria-label': T('plan') }, [
      H('button', { type: 'button', role: 'tab', class: tab === 'plan' ? 'active' : '', 'aria-selected': tab === 'plan' ? 'true' : 'false', 'data-action': 'panel-tab', 'data-arg': 'plan' }, T('tab_plan')),
      H('button', { type: 'button', role: 'tab', class: tab === 'history' ? 'active' : '', 'aria-selected': tab === 'history' ? 'true' : 'false', 'data-action': 'panel-tab', 'data-arg': 'history' }, T('history'))
    ])]));
    var body = H('div', { class: 'panel-body', role: 'tabpanel' });
    if (tab === 'plan') {
      body.appendChild(P.renderGoals({ wide: false }));
      body.appendChild(P.renderTable({ ctx: o.ctx, compact: !!o.compact }));
    } else {
      body.appendChild(P.renderGrid({ mode: 'normal', cols: 1 }));
    }
    aside.appendChild(body);
  };

  // ---------- #plan（予定を広く見る） ----------
  P.renderPage = function (content) {
    content.textContent = '';
    var cols = bp() === 'xl' ? 3 : (bp() === 'l' ? 2 : 1);
    content.appendChild(H('div', { class: 'plan-page' }, [
      H('section', { class: 'plan-main', 'aria-labelledby': 'plan-h' }, [
        H('div', { class: 'section-head' }, [
          H('div', null, [H('h1', { id: 'plan-h', tabindex: '-1', 'data-fk': 'plan-head' }, T('plan')), H('p', { class: 'panel-date' }, dateLabel())])
        ]),
        P.renderGoals({ wide: true }),
        P.renderTable({ ctx: 'page', compact: false, wide: true })
      ]),
      H('section', { class: 'plan-history', 'aria-labelledby': 'hist-h' }, [
        H('div', { class: 'section-head' }, [H('h2', { id: 'hist-h' }, T('history'))]),
        P.renderGrid({ mode: 'normal', cols: cols })
      ])
    ]));
  };

  // ---------- ダイアログ（取り組みを追加 / ≤700 の行メニュー） ----------
  P.openPick = function (start, opener) {
    var dlg = document.querySelector('dialog.pick-sheet');
    var slot = null;
    P.freeNow().forEach(function (f) { if (f.start === start) slot = f; });
    if (!slot) return;
    dlg.textContent = '';
    dlg.appendChild(H('div', { class: 'dialog-head' }, [
      H('div', null, [H('h2', { id: 'pick-h' }, T('add_activity')), H('p', { class: 'muted' }, T('free') + ' ' + range(slot.start, slot.end))]),
      H('button', { class: 'icon-btn', type: 'button', 'data-action': 'dialog-close', 'aria-label': T('close') }, [icon('close')])
    ]));
    dlg.setAttribute('aria-labelledby', 'pick-h');
    dlg.appendChild(P.renderGrid({ mode: 'pick', cols: bp() === 's' ? 1 : 2, slot: start }));
    DES.app.openDialog(dlg, opener);
  };
  P.openRowSheet = function (id, opener) {
    var r = find(S().plan, id);
    if (!r) return;
    var dlg = document.querySelector('dialog.row-sheet');
    dlg.textContent = '';
    dlg.appendChild(H('div', { class: 'dialog-head' }, [H('h2', { id: 'rs-h' }, r.title)]));
    dlg.setAttribute('aria-labelledby', 'rs-h');
    dlg.appendChild(H('div', { class: 'row-sheet-list', role: 'menu' }, menuItems(r)));
    dlg.appendChild(H('div', { class: 'dialog-footer' }, [btn(T('cancel'), 'dialog-close')]));
    DES.app.openDialog(dlg, opener);
  };

  // ---------- 操作の受け口（data-action） ----------
  var A = DES.actions = DES.actions || {};
  A['accept'] = function (el) { act.accept(el.getAttribute('data-id')); };
  A['hold'] = function (el) { act.hold(el.getAttribute('data-id')); };
  A['decline'] = function (el) { act.decline(el.getAttribute('data-id')); };
  A['free-trial'] = function (el) { act.trial(el.getAttribute('data-arg')); };
  A['row-menu'] = function (el) {
    var id = el.getAttribute('data-id');
    if (bp() === 's') { ui().menu = null; P.openRowSheet(id, el); return; }
    ui().menu = ui().menu === id ? null : id;
    DES.app.render();
    if (ui().menu) {
      var first = document.querySelector('.row-group[data-fk="row:' + id + '"] .row-menu button:not([disabled])');
      if (first) first.focus();
    } else DES.app.focusKey('row-menu', id);
  };
  A['row-move'] = function (el) { ui().menu = null; act.move(el.getAttribute('data-id'), el.getAttribute('data-arg')); };
  A['row-time'] = function (el) {
    var r = find(S().plan, el.getAttribute('data-id'));
    if (!r) return;
    ui().menu = null;
    ui().edit = { id: r.id, start: r.start, len: lenOf(r) };
    DES.app.render();
    var s = document.getElementById('te-s-' + r.id);
    if (s) s.focus();
  };
  A['time-ok'] = function (el) { var e = ui().edit; if (e) act.setTime(e.id, e.start, e.len); };
  A['time-cancel'] = function (el) { var id = el.getAttribute('data-id'); ui().edit = null; DES.app.render(); DES.app.focusKey('row-menu', id); };
  A['row-remove'] = function (el) { ui().menu = null; act.remove(el.getAttribute('data-id')); };
  A['row-hide'] = function (el) { ui().menu = null; act.hide(el.getAttribute('data-id')); };
  A['row-show'] = function (el) { act.show(el.getAttribute('data-id')); };
  A['row-finish'] = function (el) { ui().menu = null; act.finish(el.getAttribute('data-id')); };
  A['opt'] = function (el) { ui().menu = null; act.choice(el.getAttribute('data-id'), el.getAttribute('data-arg')); };
  A['row-make'] = function (el) {
    var r = find(S().plan, el.getAttribute('data-id'));
    ui().menu = null;
    DES.app.closePlanDialog();
    DES.make.openFromPlan(r);
  };
  A['free-add'] = function (el) { P.openPick(el.getAttribute('data-arg'), el); };
  A['pick'] = function (el) {
    var dlg = document.querySelector('dialog.pick-sheet');
    DES.app.closeDialog(dlg, true);
    act.addAt(el.getAttribute('data-arg'), el.getAttribute('data-id'));
  };
  A['grid-add'] = function (el) { act.addFirst(el.getAttribute('data-id')); };
  A['grid-ask'] = function (el) { var it = P.item(el.getAttribute('data-id')); if (it) DES.talk.prefill(it.title); };
  A['keep-tomorrow'] = function (el) { act.keepTomorrow(el.getAttribute('data-id')); };
  A['ov-shorten'] = function (el) { act.shorten(el.getAttribute('data-id'), el.getAttribute('data-arg')); };
  A['ov-move'] = function (el) { act.elsewhere(el.getAttribute('data-id')); };
  A['ov-later'] = function (el) { act.defer(el.getAttribute('data-id')); };
  A['ov-reopen'] = function (el) { act.reopen(el.getAttribute('data-id')); };
  A['goal-edit'] = function (el) {
    var id = el.getAttribute('data-id'), g = S().goals.filter(function (x) { return x.id === id; })[0];
    ui().goalEdit = { id: id, value: g && g.text ? g.text : '' };
    DES.app.render();
    var t = document.getElementById('goal-in-' + id);
    if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); }
  };
  A['goal-save'] = function (el) { var ge = ui().goalEdit; if (ge) act.saveGoal(ge.id, ge.value); };
  A['goal-cancel'] = function (el) { var id = el.getAttribute('data-id'); ui().goalEdit = null; DES.app.render(); DES.app.focusFk('goal:' + id); };
  A['panel-tab'] = function (el) {
    var v = el.getAttribute('data-arg');
    DES.app.change(function () { S().panelTab = v === 'history' ? 'history' : 'plan'; });
    var b = document.querySelector('[data-action="panel-tab"][data-arg="' + v + '"]');
    if (b) b.focus();
  };

  // ---------- ドラッグ（HTML5 DnD。キーボードは 上へ / 下へ・取り組みを追加 で同じ結果） ----------
  var drag = null;
  function clearDrop() {
    Array.prototype.forEach.call(document.querySelectorAll('.drop-ok,.drop-over'), function (n) { n.classList.remove('drop-ok', 'drop-over'); });
  }
  P.initDnD = function () {
    document.addEventListener('dragstart', function (e) {
      var t = e.target && e.target.closest ? e.target.closest('[draggable="true"]') : null;
      if (!t) return;
      if (t.classList.contains('row') && t.getAttribute('data-id')) {
        var id = t.getAttribute('data-id');
        drag = { type: 'row', id: id };
        [canMove(S().plan, C(), id, 'up'), canMove(S().plan, C(), id, 'down')].forEach(function (m) {
          var p = m.fits ? m.partner : null;
          if (!p) return;
          Array.prototype.forEach.call(document.querySelectorAll('.row[data-id="' + p + '"]'), function (n) { n.classList.add('drop-ok'); });
        });
      } else if (t.classList.contains('act')) {
        drag = { type: 'act', act: t.getAttribute('data-act') };
        Array.prototype.forEach.call(document.querySelectorAll('.row.free'), function (n) { n.classList.add('drop-ok'); });
      } else return;
      try { e.dataTransfer.setData('text/plain', drag.type + ':' + (drag.id || drag.act)); e.dataTransfer.effectAllowed = 'move'; } catch (err) { /* 古いブラウザ */ }
    });
    document.addEventListener('dragover', function (e) {
      if (!drag) return;
      var t = e.target && e.target.closest ? e.target.closest('.drop-ok') : null;
      if (!t) return;
      e.preventDefault();
      if (!t.classList.contains('drop-over')) {
        Array.prototype.forEach.call(document.querySelectorAll('.drop-over'), function (n) { n.classList.remove('drop-over'); });
        t.classList.add('drop-over');
      }
    });
    document.addEventListener('dragleave', function (e) {
      var t = e.target && e.target.closest ? e.target.closest('.drop-over') : null;
      if (t && !t.contains(e.relatedTarget)) t.classList.remove('drop-over');
    });
    document.addEventListener('drop', function (e) {
      if (!drag) return;
      var t = e.target && e.target.closest ? e.target.closest('.drop-ok') : null;
      var d = drag;
      drag = null; clearDrop();
      if (!t) return;
      e.preventDefault();
      if (d.type === 'row' && t.getAttribute('data-id')) act.swapWith(d.id, t.getAttribute('data-id'));
      if (d.type === 'act' && t.classList.contains('free')) act.addAt(t.getAttribute('data-slot'), d.act);
    });
    document.addEventListener('dragend', function () { drag = null; clearDrop(); });
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = pure;
})(typeof window !== 'undefined' ? window : this);
