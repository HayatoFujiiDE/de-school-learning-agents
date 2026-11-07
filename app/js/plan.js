/* 今日の予定: 状態機械（純関数）+ 描画 + 操作。CONTRACT-v3 §D / §E / §R、contract-LS §LS-11 / §LS-18
   行（rows）は保存しない。毎回 Codex の des.buddy-live.v1（DES.live.state の events / messages）と
   des.live.planLocal（運動の選択・保留・非表示・取り組みの対応・直した印・重なりのあとで）から導く。
   純関数は DOM に触れない（node から module.exports で呼べる）。
   書き込みは Codex 側（DES.live.commit）を先に、成功したら DES.app.change で live 側（記録行・planLocal）を書く。 */
(function (root) {
  'use strict';
  var DES = root.DES = root.DES || {};
  var P = DES.plan = DES.plan || {};
  var WAVE = '〜';
  var RANK = { fixed: 0, event: 1, optional: 2, proposed: 3, mine: 4 };
  var WD = ['日', '月', '火', '水', '木', '金', '土'];

  // ---------- 時刻 ----------
  function toMin(hm) { var p = String(hm).split(':'); return parseInt(p[0], 10) * 60 + parseInt(p[1], 10); }
  function toHM(m) { var h = Math.floor(m / 60), mm = m % 60; return h + ':' + (mm < 10 ? '0' : '') + mm; }
  // Codex の保存は 'HH:mm'（2 桁）。'9:00' → '09:00'
  function hh(t) { var m = toMin(t), h = Math.floor(m / 60), mm = m % 60; return (h < 10 ? '0' : '') + h + ':' + (mm < 10 ? '0' : '') + mm; }
  function range(s, e) { return s + WAVE + e; }
  function lenOf(r) { return toMin(r.end) - toMin(r.start); }
  function assign(a, b) {
    var o = {}, k;
    for (k in a) if (Object.prototype.hasOwnProperty.call(a, k)) o[k] = a[k];
    for (k in b) if (Object.prototype.hasOwnProperty.call(b, k)) o[k] = b[k];
    return o;
  }
  function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
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
  // 'YYYY-MM-DD' の曜日 1 字（日付だけの計算なので UTC で読む）
  function weekdayOf(date) { var d = new Date(String(date) + 'T00:00:00Z'); return isNaN(d.getTime()) ? '' : WD[d.getUTCDay()]; }

  // サークル対話の時刻は classroom.circle から派生（R-12）。'none' は出さない / 'tbd' は 10:50〜11:10 の位置
  function circleRow(r, c) {
    var ci = cls(c).circle || {};
    if (ci.today === 'none') return null;
    if (ci.today === 'tbd') return assign(r, { start: '10:50', end: '11:10', tbd: true });
    if (/^\d{1,2}:\d{2}$/.test(ci.today || '')) return assign(r, { start: ci.today, end: toHM(toMin(ci.today) + (ci.minutes || 20)), tbd: false });
    return r;
  }
  // 表と占有の対象の行（外した行と、サークル 'none' を除く）。done の行（終わった予定）は残る: 表には出さないが枠は埋まっている（LS-18 18-3）
  function live(rows, c) {
    var out = [];
    rows.forEach(function (r) {
      if (r.gone) return;
      if (r.kind === 'event') { r = circleRow(r, c); if (!r) return; }
      out.push(r);
    });
    return out;
  }
  // 占有（R-1）: fixed / event / optional(非skip) / mine(hidden・done 含む) / proposed。held と optional.skip は占有しない
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
    if (o.idea) r.idea = o.idea;
    return r;
  }
  // 会話からの提案（モックの §G 規則 1。本サイトでは呼ばない。純関数として残す）
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
  // 予定に入れる（モックの行の遷移。本サイトでは Codex の decideProposal が正本。純関数として残す）
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
  // 上へ / 下へ の相手（R-2）: 同ブロックで、間に占有行を挟まない隣の mine 行（hidden・done は動かせない予定として扱う）
  function partner(rows, c, id, dir) {
    var r = find(rows, id);
    if (!r || r.gone || r.kind !== 'mine' || r.hidden || r.done) return null;
    var b = blockOf(r.start, c);
    var list = live(rows, c).filter(function (x) { return blockOf(x.start, c) === b && (occupies(x) || x.kind === 'mine'); });
    list.sort(function (a, z) { return toMin(a.start) - toMin(z.start); });
    var i = -1;
    list.forEach(function (x, k) { if (x.id === id) i = k; });
    var o = list[dir === 'up' ? i - 1 : i + 1];
    return o && o.kind === 'mine' && !o.hidden && !o.done ? o.id : null;
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
    if (toMin(ns) === toMin(r.start) && toMin(ne) === toMin(r.end)) return { rows: rows, changed: false, row: r };
    rows = replace(rows, id, { start: ns, end: ne, edited: true, overlapLater: false });
    return { rows: rows, changed: true, row: find(rows, id) };
  }
  // 外す（モックの行の遷移。本サイトでは Codex の removeEvent。純関数として残す）
  function remove(rows, marks, id) {
    var r = find(rows, id);
    if (!r || r.gone || (r.kind !== 'mine' && r.kind !== 'held')) return null;
    return { rows: replace(rows, id, { gone: 'removed' }), marks: marks, undo: { type: 'remove', row: clone(r) } };
  }
  // 終わった（モックの行の遷移。本サイトでは Codex の event に done:true。純関数として残す）
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
  // 帯の行: done の行（表に出ない）には出さず相手へ → hidden の mine（T-5）→ 運動と mine は mine → 操作した行（actorId）→ RANK の大きい種類 → 開始が遅い方
  function overlaps(rows, c, actorId) {
    var L = live(rows, c).filter(occupies), out = [];
    function movable(r) { return r.kind === 'mine' || r.kind === 'proposed'; }
    for (var i = 0; i < L.length; i++) {
      for (var j = i + 1; j < L.length; j++) {
        var a = L[i], b = L[j];
        if (!intersects(a, b)) continue;
        var t;
        var ad = !!a.done, bd = !!b.done;
        if (ad && bd) continue;
        var ah = a.kind === 'mine' && !!a.hidden, bh = b.kind === 'mine' && !!b.hidden;
        if (ad !== bd) t = ad ? b : a;
        else if (ah !== bh) t = ah ? a : b;
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
    var m = isObj(m2[act]) ? m2[act] : {};
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
  // おためしの取り組みを 1 つ選ぶ（モックの S-1。本サイトでは呼ばない — バディの返事は本物の API だけ。純関数として残す）
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
  function decline(rows, id) {
    var r = find(rows, id);
    if (!r || r.gone || r.kind !== 'proposed') return null;
    return { rows: replace(rows, id, { gone: 'declined' }), undo: { type: 'decline', row: clone(r) } };
  }

  // ---------- 本サイトの導出（contract-LS §LS-11 / §LS-18） ----------
  // 今日の行（保存しない）。ctx: { classroom, today, events, messages, local: planLocal, catalog, aliases }
  //   fixed お昼 / event サークル対話（circle.today から）/ optional 運動（choice = planLocal.optional[today]）
  //   mine = Codex の events のうち date === today（done は done:true で残す = 占有するが表には出さない）
  //   proposed / held = messages の proposals のうち op 'add'・status 'pending'・date === today（planLocal.held にあれば held）
  function deriveRows(ctx) {
    var c = cls(ctx.classroom), today = ctx.today, L = ctx.local || {}, rows = [];
    var meta = isObj(L.meta) ? L.meta : {}, hidden = Array.isArray(L.hidden) ? L.hidden : [], held = Array.isArray(L.held) ? L.held : [];
    var deferred = Array.isArray(L.deferred) ? L.deferred : [], opt = isObj(L.optional) ? L.optional : {};
    function actOf(title) { var it = matchText(title, ctx.catalog, ctx.aliases); return it ? it.id : null; }
    rows.push({ id: 'circle', kind: 'event', title: 'サークル対話', start: '10:50', end: '11:10' });
    if (c.exercise) {
      var ch = opt[today];
      rows.push({ id: 'exercise', kind: 'optional', title: '運動', start: c.exercise[0], end: c.exercise[1], choice: ['undecided', 'join', 'skip', 'later'].indexOf(ch) >= 0 ? ch : 'undecided' });
    }
    rows.push({ id: 'lunch', kind: 'fixed', title: 'お昼', start: c.lunch[0], end: c.lunch[1] });
    (ctx.events || []).forEach(function (e) {
      if (!e || e.date !== today) return;
      var m = isObj(meta[e.id]) ? meta[e.id] : {}, act = typeof m.activity === 'string' ? m.activity : actOf(e.title);
      var r = { id: e.id, kind: 'mine', title: e.title, start: e.start, end: e.end, ev: e };
      if (act) r.activity = act;
      if (e.done) r.done = true;
      if (hidden.indexOf(e.id) >= 0) r.hidden = true;
      if (m.edited) r.edited = true;
      if (deferred.indexOf(e.id) >= 0) r.overlapLater = true;
      rows.push(r);
    });
    (ctx.messages || []).forEach(function (msg) {
      if (!msg || msg.role !== 'assistant') return;
      (msg.proposals || []).forEach(function (p) {
        if (p.op !== 'add' || p.status !== 'pending' || p.date !== today) return;
        var r = { id: p.id, kind: held.indexOf(p.id) >= 0 ? 'held' : 'proposed', title: p.title, start: p.start, end: p.end, from: msg.id, prop: p };
        var act = actOf(p.title);
        if (act) r.activity = act;
        rows.push(r);
      });
    });
    return rows;
  }
  // 提案カード（会話側）の状態表（LS-11）。ctx: { events, held, today }
  //   戻り値 { date: 今日以外なら 'YYYY-MM-DD' / range: 本文に出す時間帯 or null / status: {key, range?} or null / acts: [{label, action, orange}] / orig: {range, title} or null }
  function cardState(p, ctx) {
    var today = ctx.today, held = (ctx.held || []).indexOf(p.id) >= 0, ev = null, target = p.op === 'add' ? p.id : p.targetId;
    (ctx.events || []).forEach(function (e) { if (e && e.id === target) ev = e; });
    var out = { date: p.date !== today ? p.date : null, range: range(p.start, p.end), status: null, acts: [], orig: null };
    if (p.status === 'pending') {
      var first = { add: 'add_to_plan', update: 'pc_update', remove: 'pc_remove' }[p.op];
      out.acts.push({ label: first, action: 'accept', orange: !held });
      if (!held) out.acts.push({ label: 'later', action: 'hold', orange: false });
      out.acts.push({ label: 'decline', action: 'decline', orange: false });
      if (held) out.status = { key: 'kind_held' };
      if (p.op !== 'add' && p.original) out.orig = { range: range(p.original.start, p.original.end), title: p.original.title };
    } else if (p.status === 'declined') out.status = { key: 'declined' };
    else if (p.op === 'add') {
      if (ev && !ev.done) { out.status = { key: 'in_plan', range: range(ev.start, ev.end) }; out.range = null; }
      else if (ev) { out.status = { key: 'finished' }; out.range = range(ev.start, ev.end); }
      else out.status = { key: 'card_removed' };
    } else if (p.op === 'update') out.status = { key: 'pc_updated' };
    else out.status = { key: 'card_removed' };
    return out;
  }
  // 同じ日付の events に start<end の重なりが無いか（Codex の assertSlot と同じ判定を events 全体に）
  function noOverlap(events, date) {
    var L = events.filter(function (e) { return e && e.date === date; })
      .slice().sort(function (a, b) { return a.start < b.start ? -1 : (a.start > b.start ? 1 : 0); });
    var maxEnd = null;
    for (var i = 0; i < L.length; i++) {
      if (maxEnd !== null && L[i].start < maxEnd) return false;
      if (maxEnd === null || L[i].end > maxEnd) maxEnd = L[i].end;
    }
    return true;
  }
  // 入れ替え・ドラッグの 1 回の commit（LS-11 / LS-18 18-3）。updateEvent を 2 回呼ぶと間の状態で overlap になるため、
  // 元と一致を sameEvent で確かめてから next.events の 2 行を直接書き、最終の events 全体の重なりを確かめる。ops = state.mjs の export
  function applySwap(state, a0, b0, a1, b1, ops) {
    var ia = -1, ib = -1;
    state.events.forEach(function (e, i) { if (e.id === a0.id) ia = i; if (e.id === b0.id) ib = i; });
    if (ia < 0 || ib < 0 || !ops.sameEvent(state.events[ia], a0) || !ops.sameEvent(state.events[ib], b0)) throw new ops.StateError('conflict');
    if (a1.id !== a0.id || b1.id !== b0.id || !ops.validEvent(a1) || !ops.validEvent(b1)) throw new ops.StateError('invalid');
    state.events[ia] = clone(a1);
    state.events[ib] = clone(b1);
    if (!noOverlap(state.events, a1.date) || !noOverlap(state.events, b1.date)) throw new ops.StateError('overlap');
    return a1.id;
  }

  var pure = {
    toMin: toMin, toHM: toHM, hh: hh, range: range, lenOf: lenOf, blockOf: blockOf, blocks: blocks, live: live, occupies: occupies,
    freeSlots: freeSlots, firstFit: firstFit, propose: propose, addMine: addMine, accept: accept, hold: hold,
    partner: partner, swapFits: swapFits, canMove: canMove, defer: defer,
    swap: swap, move: move, startOptions: startOptions, lenOptions: lenOptions, setTime: setTime,
    remove: remove, finish: finish, undo: undo, setHidden: setHidden, setChoice: setChoice, overlaps: overlaps,
    shorten: shorten, moveElsewhere: moveElsewhere, keepTomorrow: keepTomorrow,
    matchText: matchText, pickTrial: pickTrial, suggestTrial: suggestTrial, decline: decline,
    weekdayOf: weekdayOf, deriveRows: deriveRows, cardState: cardState, noOverlap: noOverlap, applySwap: applySwap
  };
  Object.keys(pure).forEach(function (k) { P[k] = pure[k]; });

  // ======================================================================
  // ここから下はブラウザ専用（DES.state / DES.h / DES.app / DES.live を実行時に参照）
  // ======================================================================
  function emptyLocal() { return { optional: {}, held: [], hidden: [], meta: {}, deferred: [] }; }
  // 保存の鍵（contract-LS §LS-2 / §LS-18 18-2）。catalogMarks は { [activityId]: { tomorrow:boolean } }（today は終わった予定から導く）
  if (DES.store && DES.store.register) {
    DES.store.register('planLocal', function (v) {
      return isObj(v) && isObj(v.optional) && Array.isArray(v.held) && Array.isArray(v.hidden) && isObj(v.meta) && (v.deferred === undefined || Array.isArray(v.deferred));
    }, emptyLocal);
    DES.store.register('catalogMarks', isObj, function () { return {}; });
  }
  // 本ページの live 文言（contract-LS §LS-11 / §LS-18 18-8）
  if (DES.i18n && DES.i18n.add) {
    DES.i18n.add({
      history: ['取り組み', 'とりくみ'],
      grid_head: ['教室で選べる取り組み', 'きょうしつで えらべる とりくみ'],
      other_days: ['ほかの日を見る', 'ほかの日を見る'],
      leave_it_msg: ['{start}〜{end} があいているから、まかせるね。まず 15 分でためせるものを 1 つ選んで', '{start}〜{end} があいているから、まかせるね。まず 15分で ためせるものを 1つ えらんで'],
      leave_it_off: ['今はバディに送れないよ', '今はバディに送れないよ']
    });
  }

  var seq = 0;
  P.newId = function (prefix) { seq += 1; return prefix + Date.now().toString(36) + '-' + seq; };
  // Codex の id（UUID v4）
  function uuid() {
    var c = root.crypto;
    if (c && c.randomUUID) return c.randomUUID();
    var b = new Uint8Array(16), i, h = '';
    if (c && c.getRandomValues) c.getRandomValues(b); else for (i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    for (i = 0; i < 16; i++) { h += (b[i] < 16 ? '0' : '') + b[i].toString(16); if (i === 3 || i === 5 || i === 7 || i === 9) h += '-'; }
    return h;
  }
  P.uuid = uuid;
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
  function today() { return DES.clock.today(); }
  function liveState() { return (DES.live && DES.live.state) || { events: [], messages: [], pending: null }; }
  // planLocal（足りない欄は補う）
  function PL() {
    var st = S(), v = st.planLocal;
    if (!isObj(v)) v = st.planLocal = emptyLocal();
    if (!isObj(v.optional)) v.optional = {};
    if (!Array.isArray(v.held)) v.held = [];
    if (!Array.isArray(v.hidden)) v.hidden = [];
    if (!isObj(v.meta)) v.meta = {};
    if (!Array.isArray(v.deferred)) v.deferred = [];
    return v;
  }
  function marks() { var m = S().catalogMarks; return isObj(m) ? m : (S().catalogMarks = {}); }
  function without(list, v) { return (list || []).filter(function (x) { return x !== v; }); }
  function withItem(list, v) { list = without(list, v); list.push(v); return list; }
  function metaOf(id) { var L = PL(); if (!isObj(L.meta[id])) L.meta[id] = {}; return L.meta[id]; }
  // 記録行（表 → 会話。LS-18 18-1: talkLocal に kind と refs を持つ）。コミットは呼び出し側
  function rec(text, kind, refs) {
    var r = {};
    Object.keys(refs || {}).forEach(function (k) { if (refs[k] != null) r[k] = refs[k]; });
    DES.talk.record(text, kind, r);
  }

  // 今日の行（毎回導く）
  P.rows = function () {
    var st = liveState();
    return deriveRows({ classroom: C(), today: today(), events: st.events, messages: st.messages, local: PL(), catalog: DES.data.catalog, aliases: DES.aliases });
  };
  // 引数なし = 今日の表に出る行（done を除く）。引数あり = 純関数の live(rows, c)（モックの呼び方の互換）
  P.live = function (rows, c) {
    if (rows === undefined) return live(P.rows(), C()).filter(function (r) { return !r.done; });
    return live(rows, c);
  };
  P.held = function () { return PL().held.slice(); };
  P.freeNow = function (o) { return freeSlots(P.rows(), C(), o); };
  P.match = function (text) { return matchText(text, DES.data.catalog, DES.aliases); };
  // 日付の見出し「11/8（日）」（plan_date の形。曜日グループは出さない）
  P.dateText = function (date) {
    var d = String(date).split('-');
    return T('plan_date', { m: +d[1], d: +d[2], w: weekdayOf(date) });
  };
  function findRow(id) { return find(P.rows(), id); }
  function findProposal(id) {
    var hit = null;
    liveState().messages.forEach(function (m) { (m.proposals || []).forEach(function (p) { if (!hit && p.id === id) hit = { p: p, m: m }; }); });
    return hit;
  }

  // ---------- 描き直し（フォーカスを保つ）と 1 分ごとの現在時刻線 ----------
  function keyOf(el) {
    if (!el || !el.getAttribute || el === document.body) return null;
    var a = el.getAttribute('data-action');
    if (a) {
      var s = '[data-action="' + a + '"]';
      ['data-id', 'data-arg'].forEach(function (k) { var v = el.getAttribute(k); if (v != null) s += '[' + k + '="' + String(v).replace(/"/g, '\\"') + '"]'; });
      return s;
    }
    var fk = el.getAttribute('data-fk');
    if (fk) return '[data-fk="' + String(fk).replace(/"/g, '\\"') + '"]';
    return el.id ? '#' + el.id : null;
  }
  P.rerender = function () {
    if (!DES.app || !DES.ui || !DES.state) return;
    var ae = document.activeElement, sel = keyOf(ae);
    DES.app.render();
    if (ae && ae !== document.body && !document.contains(ae) && sel) {
      var n = document.querySelector(sel);
      if (n) n.focus();
    }
  };
  var tick = null;
  // route が talk / plan の間だけ 60 秒ごとに描き直す（離れたら止める）。入力中・メニュー・退場中はその回を飛ばす
  P.ensureTick = function () {
    if (tick) return;
    tick = setInterval(function () {
      var r = DES.app.route();
      if (r !== 'talk' && r !== 'plan') { clearInterval(tick); tick = null; return; }
      var u = DES.ui || {};
      if (u.goalEdit || u.edit || u.menu || u.leaving) return;
      P.rerender();
    }, 60000);
  };

  // ---------- 書き込みの共通部 ----------
  // 1 つずつ（書き込み中の 2 度押しで conflict のトーストを出さない）
  var busy = false;
  function run(fn) {
    if (busy) return Promise.resolve(null);
    busy = true;
    return Promise.resolve().then(fn).then(function (v) { busy = false; return v; }, function (e) { busy = false; if (root.console) console.error(e); return null; });
  }
  // Codex 側（先）。失敗はトーストに message
  function codex(change) {
    return DES.live.commit(change).then(function (r) { if (!r.ok) DES.app.toast(r.message); return r; });
  }
  function noop() {}
  // live 側だけの操作（Codex に書かない）。保存に失敗したら操作した欄を元に戻す（LS-18 18-28 (c)。save_fail の印は store が立てる）。
  // mutate が false を返したら変更なし。onSaved は保存できた時だけ（同じ change の中で）
  function liveOnly(keys, mutate, o, onSaved) {
    var snap = {};
    keys.forEach(function (k) { snap[k] = clone(S()[k]); });
    DES.app.change(function () {
      if (mutate() === false) return;
      var ok = keys.every(function (k) { return DES.store.save(k); });
      if (!ok) { keys.forEach(function (k) { S()[k] = snap[k]; }); return; }
      if (onSaved) onSaved();
    }, o);
  }
  // 行の退場（200ms。モックの APP.change の leave と同じ見え方）。Codex の commit の前に流す
  function leaveAnim(id) {
    return new Promise(function (res) {
      var reduce = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
      var els = document.querySelectorAll('.row[data-id="' + String(id).replace(/"/g, '\\"') + '"]');
      if (reduce || !els.length) { res(); return; }
      Array.prototype.forEach.call(els, function (n) { n.style.maxHeight = n.offsetHeight + 'px'; void n.offsetHeight; n.classList.add('leave'); });
      DES.ui.leaving = true;
      setTimeout(res, 200);
    });
  }
  function reasonOf(code) { return ['overlap', 'event_limit', 'conflict'].indexOf(code) >= 0 ? code : 'storage'; }
  function upd(orig, patch) { return function (next) { return DES.live.ops.updateEvent(next, orig, assign(orig, patch)); }; }

  // ---------- 操作（LS-11 の「操作 → 書き込み」） ----------
  var act = P.act = {};
  // 予定に入れる（proposed / held 行・提案カード。update / remove の候補も同じ口）
  act.accept = function (id, o) {
    o = o || {};
    return run(function () {
      var f = findProposal(id);
      if (!f) return null;
      var p = f.p, m = f.m, focus = (!o.fromCard && p.op === 'add' && p.date === today()) ? 'row:' + p.id : 'card:' + p.id;
      return codex(function (next) { return DES.live.ops.decideProposal(next, m.id, p.id, true); }).then(function (r) {
        if (!r.ok) { DES.app.change(noop, { focus: focus }); return; }
        DES.app.change(function () {
          var L = PL();
          L.held = without(L.held, p.id);
          if (p.op === 'add') {
            var it = P.match(p.title);
            if (it) metaOf(p.id).activity = it.id;
            ui().actor = p.id;
            rec(X('rec_add', { start: p.start, title: p.title }), 'rec_add', { eventId: p.id, proposalId: p.id, messageId: m.id, activity: it ? it.id : null });
          } else if (p.op === 'update') {
            rec(X('rec_time', { title: p.title, start: p.start, end: p.end }), 'rec_time', { eventId: p.targetId, proposalId: p.id, messageId: m.id });
          } else {
            delete L.meta[p.targetId];
            L.hidden = without(L.hidden, p.targetId);
            L.deferred = without(L.deferred, p.targetId);
            rec(X('rec_remove', { title: p.title }), 'rec_remove', { eventId: p.targetId, proposalId: p.id, messageId: m.id });
          }
        }, { focus: focus });
      });
    });
  };
  // あとで（Codex に書かない）
  act.hold = function (id, o) {
    o = o || {};
    var f = findProposal(id);
    if (!f || f.p.status !== 'pending') return;
    liveOnly(['planLocal', 'talkLocal'], function () {
      PL().held = withItem(PL().held, id);
      rec(X('rec_hold', { title: f.p.title }), 'rec_hold', { proposalId: id, messageId: f.m.id });
    }, { focus: o.fromCard ? 'card:' + id : 'row:' + id });
  };
  // 違う（取り消し不可。トーストは「見送った」のみ。LS-18 18-5）。held 行の「外す」も同じ
  act.decline = function (id, o) {
    o = o || {};
    return run(function () {
      var f = findProposal(id);
      if (!f) return null;
      var focus = o.fromCard ? 'card:' + id : 'plan-head';
      return leaveAnim(id).then(function () {
        return codex(function (next) { return DES.live.ops.decideProposal(next, f.m.id, id, false); });
      }).then(function (r) {
        if (!r.ok) { DES.app.change(noop, { focus: focus }); return; }
        DES.app.change(function () {
          PL().held = without(PL().held, id);
          rec(X('rec_decline', { title: f.p.title }), 'rec_decline', { proposalId: id, messageId: f.m.id });
          DES.app.toast(T('declined'));
        }, { focus: focus });
      });
    });
  };
  // 入れ替え（上へ / 下へ / ドラッグ）: 1 回の commit で 2 行を直接書く
  function doSwap(id, other) {
    return run(function () {
      var rows = P.rows(), a = find(rows, id), b = find(rows, other);
      if (!a || !b || !a.ev || !b.ev) return null;
      var res = swap(rows, C(), id, other);
      if (!res.ok) return null;
      var a1 = find(res.rows, id), b1 = find(res.rows, other);
      var na = assign(a.ev, { start: hh(a1.start), end: hh(a1.end) }), nb = assign(b.ev, { start: hh(b1.start), end: hh(b1.end) });
      return codex(function (next) { return applySwap(next, a.ev, b.ev, na, nb, DES.live.ops); }).then(function (r) {
        if (!r.ok) { DES.app.change(noop, { focus: 'row:' + id }); return; }
        DES.app.change(function () {
          var L = PL();
          metaOf(id).edited = true; metaOf(other).edited = true;
          L.deferred = without(without(L.deferred, id), other);
          ui().actor = id;
          rec(X('rec_swap', { a: a.title, b: b.title }), 'rec_swap', { eventId: id });
        }, { focus: 'row:' + id });
      });
    });
  }
  act.move = function (id, dir) {
    var m = canMove(P.rows(), C(), id, dir);
    if (!m.partner || !m.fits) return;
    doSwap(id, m.partner);
  };
  act.swapWith = function (id, other) {
    var rows = P.rows();
    var ok = ['up', 'down'].some(function (d) { var m = canMove(rows, C(), id, d); return m.partner === other && m.fits; });
    if (ok) doSwap(id, other);
  };
  act.setTime = function (id, start, len) {
    return run(function () {
      var rows = P.rows(), r0 = find(rows, id);
      ui().edit = null;
      if (!r0 || !r0.ev) { DES.app.change(noop, { focus: 'row:' + id }); return null; }
      var res = setTime(rows, C(), id, start, len);
      if (!res.changed) { DES.app.change(noop, { focus: 'row:' + id }); return null; }
      var ns = hh(res.row.start), ne = hh(res.row.end);
      return codex(upd(r0.ev, { start: ns, end: ne })).then(function (r) {
        if (!r.ok) { DES.app.change(noop, { focus: 'row:' + id }); return; }
        DES.app.change(function () {
          metaOf(id).edited = true;
          PL().deferred = without(PL().deferred, id);
          ui().actor = id;
          delete ui().noSlot[id];
          rec(X('rec_time', { title: r0.title, start: ns, end: ne }), 'rec_time', { eventId: id, activity: r0.activity || null });
        }, { focus: 'row:' + id });
      });
    });
  };
  // 外す: removeEvent。トースト「外したよ」+「元に戻す」5 秒 → 同じ event を addEvent + 退避を戻す
  act.remove = function (id) {
    return run(function () {
      var r0 = findRow(id);
      if (!r0 || !r0.ev) return null;
      var ev = r0.ev, L = PL();
      var stash = { meta: isObj(L.meta[id]) ? clone(L.meta[id]) : null, hidden: L.hidden.indexOf(id) >= 0, deferred: L.deferred.indexOf(id) >= 0 };
      return leaveAnim(id).then(function () { return codex(function (next) { return DES.live.ops.removeEvent(next, ev); }); }).then(function (r) {
        if (!r.ok) { DES.app.change(noop, { focus: 'row:' + id }); return; }
        DES.app.change(function () {
          var L2 = PL();
          delete L2.meta[id];
          L2.hidden = without(L2.hidden, id);
          L2.deferred = without(L2.deferred, id);
          rec(X('rec_remove', { title: ev.title }), 'rec_remove', { eventId: id, activity: r0.activity || null });
          DES.app.toast(T('removed_toast'), { label: T('undo'), fn: function () { act.undoRemove(ev, stash, r0.activity); } });
        }, { focus: 'plan-head' });
      });
    });
  };
  act.undoRemove = function (ev, stash, activity) {
    return run(function () {
      return codex(function (next) { return DES.live.ops.addEvent(next, ev); }).then(function (r) {
        if (!r.ok) { DES.app.change(noop, { focus: 'plan-head' }); return; }
        DES.app.change(function () {
          var L = PL();
          if (stash.meta) L.meta[ev.id] = stash.meta;
          if (stash.hidden) L.hidden = withItem(L.hidden, ev.id);
          if (stash.deferred) L.deferred = withItem(L.deferred, ev.id);
          ui().actor = ev.id;
          rec(X('rec_undo', { title: ev.title }), 'rec_undo', { eventId: ev.id, activity: activity || null });
          DES.app.toastHide();
        }, { focus: 'row:' + ev.id });
      });
    });
  };
  // 終わった: done:true。グリッドの「今日 10:00〜10:50」は done の event から導く
  act.finish = function (id) {
    return run(function () {
      var r0 = findRow(id);
      if (!r0 || !r0.ev) return null;
      var ev = r0.ev, done = assign(ev, { done: true });
      return leaveAnim(id).then(function () { return codex(upd(ev, { done: true })); }).then(function (r) {
        if (!r.ok) { DES.app.change(noop, { focus: 'row:' + id }); return; }
        DES.app.change(function () {
          rec(X('rec_finish', { title: ev.title, start: ev.start, end: ev.end }), 'rec_finish', { eventId: id, activity: r0.activity || null });
          DES.app.toast(T('returned_toast', { title: ev.title }), { label: T('undo'), fn: function () { act.undoFinish(done, ev, r0.activity); } });
        }, { focus: 'plan-head' });
      });
    });
  };
  act.undoFinish = function (doneEv, ev, activity) {
    return run(function () {
      return codex(function (next) { return DES.live.ops.updateEvent(next, doneEv, ev); }).then(function (r) {
        if (!r.ok) { DES.app.change(noop, { focus: 'plan-head' }); return; }
        DES.app.change(function () {
          ui().actor = ev.id;
          rec(X('rec_undo', { title: ev.title }), 'rec_undo', { eventId: ev.id, activity: activity || null });
          DES.app.toastHide();
        }, { focus: 'row:' + ev.id });
      });
    });
  };
  act.hide = function (id) {
    liveOnly(['planLocal'], function () { PL().hidden = withItem(PL().hidden, id); }, { focus: 'row:' + id });
  };
  act.show = function (id) {
    liveOnly(['planLocal'], function () { PL().hidden = without(PL().hidden, id); ui().actor = id; }, { focus: 'row:' + id });
  };
  // 運動の 4 値（planLocal.optional[今日]）
  act.choice = function (id, choice) {
    if (['undecided', 'join', 'skip', 'later'].indexOf(choice) < 0) return;
    liveOnly(['planLocal', 'talkLocal'], function () {
      var L = PL(), d = today(), cur = L.optional[d] || 'undecided';
      if (cur === choice) return false;
      L.optional[d] = choice;
      ui().actor = id;
      if (choice === 'join') rec(DES.text.rec_join, 'rec_join', {});
      if (choice === 'skip') rec(DES.text.rec_skip, 'rec_skip', {});
      if (choice === 'later') rec(DES.text.rec_later, 'rec_later', {});
    }, { focus: 'row:' + id });
  };
  function eventFor(item, slotRow, id) {
    return { id: id, title: item.title, date: today(), start: hh(slotRow.start), end: hh(slotRow.end), done: false };
  }
  // 取り組みを追加（空き行 → pick-sheet / グリッドから空き行へドロップ）
  act.addAt = function (start, actId) {
    var item = P.item(actId);
    if (!item) return;
    return run(function () {
      var id = uuid(), res = addMine(P.rows(), C(), item, { at: start, id: id });
      if (!res.row) { DES.app.toast(T('no_slot_band')); return null; }
      var ev = eventFor(item, res.row, id);
      return codex(function (next) { return DES.live.ops.addEvent(next, ev); }).then(function (r) {
        if (!r.ok) { DES.app.change(noop, { focus: 'plan-head' }); return; }
        DES.app.change(function () {
          metaOf(id).activity = actId;
          ui().actor = id;
          rec(X('rec_add', { start: ev.start, title: item.title }), 'rec_add', { eventId: id, activity: actId });
        }, { focus: 'row:' + id });
      });
    });
  };
  // 取り組みを今日の予定に入れる（グリッドの「入れる」。外から呼べる: あしあと・サポーター）。
  // Promise → { ok:true, event } | { ok:false, reason:'no_free'|'overlap'|'event_limit'|'conflict'|'storage' }（LS-18 18-27）。
  // o.undo の時だけトーストに「元に戻す」（5 秒）/ o.after = 戻した後のフォーカス / o.onAdded(event) = 入った時だけ同じ change の中で呼ぶ
  act.addFirst = function (actId, o) {
    o = o || {};
    var item = P.item(actId);
    if (!item) return Promise.resolve({ ok: false, reason: 'conflict' });
    return run(function () {
      var id = uuid(), res = addMine(P.rows(), C(), item, { id: id });
      if (!res.row) {
        DES.app.toast(T('no_free'), { label: T('keep_tomorrow'), fn: function () { act.keepTomorrow(actId); } });
        return { ok: false, reason: 'no_free' };
      }
      var ev = eventFor(item, res.row, id);
      return codex(function (next) { return DES.live.ops.addEvent(next, ev); }).then(function (r) {
        if (!r.ok) { DES.app.change(noop); return { ok: false, reason: reasonOf(r.code) }; }
        var line = X('rec_add', { start: ev.start, title: item.title });
        DES.app.change(function () {
          metaOf(id).activity = actId;
          ui().actor = id;
          rec(line, 'rec_add', { eventId: id, activity: actId });
          if (o.onAdded) o.onAdded(ev);
          DES.app.toast(line, o.undo ? { label: T('undo'), fn: function () { act.unadd(ev, o.after); } } : null);
        });
        return { ok: true, event: ev };
      });
    }).then(function (v) { return v || { ok: false, reason: 'conflict' }; });
  };
  act.unadd = function (ev, after) {
    return run(function () {
      return codex(function (next) { return DES.live.ops.removeEvent(next, ev); }).then(function (r) {
        if (!r.ok) { DES.app.change(noop, after); return; }
        DES.app.change(function () {
          delete PL().meta[ev.id];
          if (ui().actor === ev.id) ui().actor = null;
          rec(X('rec_undo', { title: ev.title }), 'rec_undo', { eventId: ev.id });
          DES.app.toastHide();
        }, after);
      });
    });
  };
  act.keepTomorrow = function (actId) {
    liveOnly(['catalogMarks'], function () { S().catalogMarks = keepTomorrow(marks(), actId); }, null, function () { DES.app.toast(T('kept_tomorrow')); });
  };
  act.shorten = function (id, other) {
    return run(function () {
      var rows = P.rows(), r0 = find(rows, id), res = shorten(rows, C(), id, other);
      if (!r0 || !r0.ev || !res.row) return null;
      var ne = hh(res.row.end);
      return codex(upd(r0.ev, { end: ne })).then(function (r) {
        if (!r.ok) { DES.app.change(noop, { focus: 'row:' + id }); return; }
        DES.app.change(function () {
          metaOf(id).edited = true;
          PL().deferred = without(PL().deferred, id);
          ui().actor = id;
          rec(X('rec_shorten', { title: r0.title, start: r0.ev.start, end: ne }), 'rec_shorten', { eventId: id });
        }, { focus: 'row:' + id });
      });
    });
  };
  act.elsewhere = function (id) {
    return run(function () {
      var rows = P.rows(), r0 = find(rows, id), res = moveElsewhere(rows, C(), id);
      if (!r0 || !r0.ev) return null;
      if (!res.row) { ui().noSlot[id] = true; DES.app.change(noop, { focus: 'row:' + id }); return null; }
      var ns = hh(res.row.start), ne = hh(res.row.end);
      return codex(upd(r0.ev, { start: ns, end: ne })).then(function (r) {
        if (!r.ok) { DES.app.change(noop, { focus: 'row:' + id }); return; }
        DES.app.change(function () {
          delete ui().noSlot[id];
          metaOf(id).edited = true;
          PL().deferred = without(PL().deferred, id);
          ui().actor = id;
          rec(X('rec_moved', { title: r0.title, start: ns }), 'rec_moved', { eventId: id });
        }, { focus: 'row:' + id });
      });
    });
  };
  act.defer = function (id) {
    var r0 = findRow(id);
    if (!r0) return;
    liveOnly(['planLocal', 'talkLocal'], function () {
      PL().deferred = withItem(PL().deferred, id);
      metaOf(id).edited = true;
      ui().actor = id;
      delete ui().noSlot[id];
      rec(X('rec_defer', { title: r0.title }), 'rec_defer', { eventId: id });
    }, { focus: 'row:' + id });
  };
  act.reopen = function (id) {
    liveOnly(['planLocal'], function () { PL().deferred = without(PL().deferred, id); ui().actor = id; }, { focus: 'row:' + id });
  };
  act.saveGoal = function (id, text) {
    var v = String(text || '').replace(/\s+$/, '').replace(/^\s+/, '');
    liveOnly(['goals', 'talkLocal'], function () {
      var before = null;
      S().goals = S().goals.map(function (g) {
        if (g.id !== id) return g;
        before = g.text;
        if (!v) return { id: g.id, label: g.label, text: null };
        return { id: g.id, label: g.label, text: v, src: 'own', date: DES.data.today.slice(5) };
      });
      var g = S().goals.filter(function (x) { return x.id === id; })[0];
      if (v && v !== before && g) rec(X('rec_goal', { label: g.label, text: v }), 'rec_goal', {});
    }, { focus: 'goal:' + id }, function () { ui().goalEdit = null; });
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

  // サポーターと入れた行・サポーターのアイデアから入れた行（contract-AD §AD-6）。緑の記録チップに人名
  function byChip(r) {
    if (!DES.sup || !DES.sup.nameOf || (!r.by && !r.idea)) return null;
    var t = r.by ? T('by_row', { sup: DES.sup.nameOf(r.by) }) : T('idea_row', { sup: DES.sup.supName ? DES.sup.supName() : '' });
    return chip(t, 'src-record', { icon: 'record', label: t });
  }
  P.byChip = byChip;

  // ---------- 表 ----------
  // o: { ctx:'panel'|'dialog'|'page', compact:bool, wide:bool }
  P.renderTable = function (o) {
    var c = C(), rows = P.rows(), L = live(rows, c).filter(function (r) { return !r.done; }), B = blocks(c);
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
    // 現在時刻線（R-8）: 開始 ≤ now の最後の行の直下。その行が now を含むなら上辺。now は DES.clock（JST）
    var nowHM = DES.clock.now(), now = toMin(nowHM), flat = [];
    ['am', 'lunch', 'pm'].forEach(function (b) { items[b].forEach(function (it) { flat.push(it); }); });
    var last = null;
    flat.forEach(function (it) { if (it.s <= now) last = it; });
    var lineAt = null;
    if (last) lineAt = { it: last, before: now < last.e };
    // 「バディにまかせる」は送れる時だけ（接続の状態を 1 回確かめる。#plan・作るの drawer から開いた時も）
    if (DES.talk && DES.talk.ensureService) DES.talk.ensureService();
    var canLeave = !!(DES.talk && DES.talk.canSend && DES.talk.canSend());

    var wrap = H('div', { class: 'plan-table' + (o.wide ? ' is-wide' : '') + (o.compact ? ' is-compact' : '') });
    var heads = { am: T('am'), lunch: T('lunch'), pm: T('pm') };
    ['am', 'lunch', 'pm'].forEach(function (b) {
      var sec = H('section', { class: 'block block-' + b, 'aria-label': heads[b] + ' ' + range(toHM(B[b][0]), toHM(B[b][1])) }, [
        H('h3', { class: 'block-head' }, [H('span', { class: 'bh-name' }, heads[b]), H('span', { class: 'bh-range' }, range(toHM(B[b][0]), toHM(B[b][1])))])
      ]);
      var list = H('div', { class: 'block-rows' });
      items[b].forEach(function (it) {
        if (lineAt && lineAt.it === it && lineAt.before) list.appendChild(nowLine(nowHM));
        if (it.t === 'free') list.appendChild(freeRow(it.f, o, canLeave));
        else {
          nextSeen[it.r.id] = true;
          list.appendChild(rowGroup(it.r, o, conf[it.r.id], optMenu, seen && !seen[it.r.id], rows));
        }
        if (lineAt && lineAt.it === it && !lineAt.before) list.appendChild(nowLine(nowHM));
      });
      sec.appendChild(list);
      wrap.appendChild(sec);
    });
    ui().seen[o.ctx] = nextSeen;
    return wrap;
  };
  function nowLine(nowHM) {
    return H('div', { class: 'now-line', 'aria-hidden': 'true' }, [H('span', { class: 'now-time' }, nowHM)]);
  }
  function timeCol(r) {
    return H('div', { class: 'row-time' }, [
      H('span', { class: 't-start' }, r.start), H('span', { class: 't-sep', 'aria-hidden': 'true' }, WAVE), H('span', { class: 't-end' }, r.end),
      r.kind === 'mine' && r.edited ? H('span', { class: 'edited-mark' }, T('edited_mark')) : null
    ]);
  }
  // 空き行: 取り組みを追加 / バディにまかせる（本物の送信。送れない間は disabled + title）
  function freeRow(f, o, canLeave) {
    var ops = [btn(T('add_activity'), 'free-add', { arg: f.start, icon: 'plus' })];
    if (f.len >= 15) ops.push(btn(T('leave_it'), 'free-trial', { arg: f.start, icon: 'spark', disabled: !canLeave, title: T('leave_it_off') }));
    return H('div', { class: 'row free', 'data-slot': f.start, 'data-end': f.end }, [
      H('div', { class: 'row-time', 'aria-hidden': 'true' }),
      H('div', { class: 'row-title' }, T('free') + ' ' + range(f.start, f.end)),
      H('div', { class: 'row-ops' }, ops)
    ]);
  }
  function rowGroup(r, o, cf, optMenu, isNew, rows) {
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
    var title2 = H('div', { class: 'row-title' }, [
      r.kind === 'mine' ? H('span', { class: 'drag-mark', 'aria-hidden': 'true' }, [icon('drag')]) : null,
      H('span', { class: 'rt-text' }, r.title)
    ]);
    kids.push(title2);
    var chips = r.kind === 'proposed' ? [srcChip('ai', T('ai_proposal'))] : [kindChip(r)];
    var bc = byChip(r);
    if (bc) chips.push(bc);
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
    if (ui().menu === r.id && bp() !== 's') g.appendChild(rowMenu(r, rows));
    if (ui().edit && ui().edit.id === r.id) g.appendChild(timeEditor(r));
    if (cf && !r.overlapLater) g.appendChild(band(r, cf, o));
    return g;
  }
  function menuItems(r, rows) {
    if (r.kind === 'optional') {
      return [
        btn(T('join'), 'opt', { id: r.id, arg: 'join', attrs: { role: 'menuitem' } }),
        btn(T('skip_ex'), 'opt', { id: r.id, arg: 'skip', attrs: { role: 'menuitem' } }),
        btn(T('decide_later'), 'opt', { id: r.id, arg: 'later', attrs: { role: 'menuitem' } })
      ];
    }
    rows = rows || P.rows();
    var up = canMove(rows, C(), r.id, 'up'), down = canMove(rows, C(), r.id, 'down');
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
  function rowMenu(r, rows) {
    return H('div', { class: 'row-menu', role: 'menu', 'aria-label': T('row_ops', { title: r.title }) }, menuItems(r, rows));
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
  // 重なり帯。3 候補は mine 行だけ（提案の行は Codex の候補なので時刻を変えられない。文だけ出す）
  function band(r, cf, o) {
    var b = H('div', { class: 'overlap-band', role: 'group', 'aria-label': T('overlap') });
    if (o.compact) {
      b.appendChild(H('p', null, T('compact_overlap')));
      b.appendChild(H('a', { class: 'link-btn', href: '#plan', 'data-action': 'goto-plan' }, T('fix_in_plan')));
      return b;
    }
    b.appendChild(H('p', null, ui().noSlot[r.id] ? T('no_slot_band') : T('overlap_with', { title: cf.otherTitle })));
    if (r.kind !== 'mine') return b;
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
        kids = [H('span', { class: 'goal-label' }, g.label)];
        if (g.text) {
          kids.push(H('span', { class: 'goal-text' }, g.text));
          kids.push(srcChip('own', T('own_label') + ' ' + goalDate(g.date)));
        } else kids.push(H('span', { class: 'goal-empty' }, T('goal_empty')));
      } else {
        kls += ' compact';
        kids = [H('span', { class: 'g-label' }, g.label), H('span', { class: 'g-text' }, g.text || T('goal_empty'))];
        if (g.text) kids.push(H('span', { class: 'sr-only' }, T('own_label') + ' ' + goalDate(g.date)));
      }
      list.appendChild(H('button', { class: kls, type: 'button', 'data-action': 'goal-edit', 'data-id': g.id, 'data-fk': 'goal:' + g.id }, kids));
    });
    wrap.appendChild(list);
    return wrap;
  };

  // ---------- 教室で選べる取り組み（§E-3 / R-8 / LS-18 18-8）。チップ（予定に入っている / 今日 10:00〜10:50 / 明日にとっておいた）が本人の記録 ----------
  // o: { mode:'normal'|'pick', cols:1|2|3, slot }
  P.renderGrid = function (o) {
    var L = live(P.rows(), C()), mk = marks();
    var wrap = H('div', { class: 'grid' + (o.cols > 1 ? ' cols-' + o.cols : '') + (o.mode === 'pick' ? ' is-pick' : '') });
    DES.data.catalog.forEach(function (cat) {
      var ul = H('ul', { class: 'act-list' });
      cat.items.forEach(function (it) {
        var main = [H('span', { class: 'act-title' }, it.title)], ops;
        if (o.mode !== 'pick') {
          var chips = [];
          var inPlan = L.some(function (r) { return !r.done && r.activity === it.id && (r.kind === 'mine' || r.kind === 'proposed' || r.kind === 'held'); });
          if (inPlan) chips.push(H('span', { class: 'pill' }, T('in_plan')));
          var m = isObj(mk[it.id]) ? mk[it.id] : {};
          var today2 = L.filter(function (r) { return r.done && r.activity === it.id; })
            .sort(function (a, b) { return toMin(a.start) - toMin(b.start); })
            .map(function (r) { return range(r.start, r.end); });
          today2.slice(0, 2).forEach(function (rg) { chips.push(srcChip('record', T('today_done', { range: rg }))); });
          if (today2.length > 2) chips.push(H('span', { class: 'grid-more' }, T('grid_note_more', { n: today2.length - 2 })));
          if (m.tomorrow === true) chips.push(chip(T('kept_tomorrow'), 'k-tomorrow'));
          if (chips.length) main.push(H('span', { class: 'act-chips' }, chips));
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
    P.ensureTick();
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
    P.ensureTick();
    content.textContent = '';
    var cols = bp() === 'xl' ? 3 : (bp() === 'l' ? 2 : 1);
    // 「ほかの日を見る」→ Codex の日付別の予定（同じ保存を見ている）。つながっていない単独ビルドでは出さない
    var other = DES.live && DES.live.available
      ? H('a', { class: 'link-btn other-days', href: '../app-live/index.html#plan?date=' + DES.clock.today() }, T('other_days')) : null;
    content.appendChild(H('div', { class: 'plan-page' }, [
      H('section', { class: 'plan-main', 'aria-labelledby': 'plan-h' }, [
        H('div', { class: 'section-head' }, [
          H('div', null, [H('h1', { id: 'plan-h', tabindex: '-1', 'data-fk': 'plan-head' }, T('plan')), H('p', { class: 'panel-date' }, dateLabel()), other])
        ]),
        P.renderGoals({ wide: true }),
        P.renderTable({ ctx: 'page', compact: false, wide: true })
      ]),
      H('section', { class: 'plan-history', 'aria-labelledby': 'hist-h' }, [
        H('div', { class: 'section-head' }, [H('h2', { id: 'hist-h' }, T('grid_head'))]),
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
    var rows = P.rows(), r = find(rows, id);
    if (!r) return;
    var dlg = document.querySelector('dialog.row-sheet');
    dlg.textContent = '';
    dlg.appendChild(H('div', { class: 'dialog-head' }, [H('h2', { id: 'rs-h' }, r.title)]));
    dlg.setAttribute('aria-labelledby', 'rs-h');
    dlg.appendChild(H('div', { class: 'row-sheet-list', role: 'menu' }, menuItems(r, rows)));
    dlg.appendChild(H('div', { class: 'dialog-footer' }, [btn(T('cancel'), 'dialog-close')]));
    DES.app.openDialog(dlg, opener);
  };

  // ---------- 操作の受け口（data-action） ----------
  var A = DES.actions = DES.actions || {};
  function fromCard(el) { return !!(el && el.closest && el.closest('.proposal-card')); }
  A['accept'] = function (el) { act.accept(el.getAttribute('data-id'), { fromCard: fromCard(el) }); };
  A['hold'] = function (el) { act.hold(el.getAttribute('data-id'), { fromCard: fromCard(el) }); };
  A['decline'] = function (el) { act.decline(el.getAttribute('data-id'), { fromCard: fromCard(el) }); };
  // バディにまかせる（空き行）: 本物の送信（composer の送信と同じ経路）。本文 = leave_it_msg
  A['free-trial'] = function (el) {
    var start = el.getAttribute('data-arg'), slot = null;
    P.freeNow().forEach(function (f) { if (f.start === start) slot = f; });
    if (!slot || !DES.talk || !DES.talk.sendText) return;
    DES.talk.sendText(T('leave_it_msg', { start: slot.start, end: slot.end }));
  };
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
    var r = findRow(el.getAttribute('data-id'));
    if (!r) return;
    ui().menu = null;
    ui().edit = { id: r.id, start: r.start, len: lenOf(r) };
    DES.app.render();
    var s = document.getElementById('te-s-' + r.id);
    if (s) s.focus();
  };
  A['time-ok'] = function () { var e = ui().edit; if (e) act.setTime(e.id, e.start, e.len); };
  A['time-cancel'] = function (el) { var id = el.getAttribute('data-id'); ui().edit = null; DES.app.render(); DES.app.focusKey('row-menu', id); };
  // 外す: mine は removeEvent（元に戻す 5 秒）/ held（保留の提案）は「違う」と同じ（取り消し不可）
  A['row-remove'] = function (el) {
    var id = el.getAttribute('data-id'), r = findRow(id);
    ui().menu = null;
    if (r && r.kind === 'held') act.decline(id, {});
    else act.remove(id);
  };
  A['row-hide'] = function (el) { ui().menu = null; act.hide(el.getAttribute('data-id')); };
  A['row-show'] = function (el) { act.show(el.getAttribute('data-id')); };
  A['row-finish'] = function (el) { ui().menu = null; act.finish(el.getAttribute('data-id')); };
  A['opt'] = function (el) { ui().menu = null; act.choice(el.getAttribute('data-id'), el.getAttribute('data-arg')); };
  A['row-make'] = function (el) {
    var r = findRow(el.getAttribute('data-id'));
    ui().menu = null;
    DES.app.closePlanDialog();
    if (r && DES.make && DES.make.openFromPlan) DES.make.openFromPlan({ id: r.id, title: r.title, activity: r.activity || null, start: r.start, end: r.end, kind: r.kind });
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
  A['goal-save'] = function () { var ge = ui().goalEdit; if (ge) act.saveGoal(ge.id, ge.value); };
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
        var id = t.getAttribute('data-id'), rows = P.rows();
        drag = { type: 'row', id: id };
        [canMove(rows, C(), id, 'up'), canMove(rows, C(), id, 'down')].forEach(function (m) {
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
