/* 今日のお題の中身（contract-LS §LS-13 / LS-18-16・17・26・28。見た目は CONTRACT-v3 §X / contract-app §AF）。
   固定のお題（作る・ためす 12 本・対話の見本 9 本・topics-live.js の焼いた写し）は持たない。お題は実行時に工場の配信 API から読む:
   GET /api/library/topics?day=<今日> → 0 件なら GET /api/library/topics/stock?kind=news|talk|philo|make&limit=3（4 回）。各 8 秒で打ち切る。
   自動の再試行はしない（再読み込みで読み直す。1 回の読み込みで HTTP は最大 5 回）。
   変換: 対話（news / talk / philo）は tools/pull-topics.mjs の convertTopic / validateDialog の移植、作る・ためす（make）は body.make から新しく書いた変換と検査。
   どちらも本文の主張の印 [cN] を子どもに見せる前に取り除く。id は 'fx-' + topic_id、記録のキーは lineage_id。
   get(x) / getDialog(x) は 'fx-' + topic_id でも lineage_id でも引ける（読み込んだお題 → 記録に添えた写し DES.state.odai.copies の順）。
   文言は [中学生向け, 小学生向け] の組。絵は kind ごとの既定の 2 色の線画（make は種類の線画）。node からも読める（tools/live-today-test.js）。 */
(function (root) {
  'use strict';
  var DES = root.DES = root.DES || {};
  var MD = DES.makeData || (typeof require === 'function' ? require('./make-data.js') : null);
  var TDD = DES.todayData = {};

  var INK = '#292c29', OLIVE = '#524e44', ORANGE = '#ed922c', WHITE = '#ffffff';
  TDD.COLORS = { ink: INK, olive: OLIVE, orange: ORANGE };

  // ---------- 線画の部品（viewBox 240×150。make-data.js の線画と同じ枠） ----------
  // 2 色の線画（§X-3 / §U-1）: 1 枚ごとに 墨 + 橙 か 墨 + オリーブ の 2 色だけ。淡い面は同じ色の透明度で作り、別の色を足さない
  function r1(n) { return Math.round(n * 10) / 10; }
  function fo(a) { return ' fill-opacity="' + a + '"'; }
  function so(a) { return ' stroke-opacity="' + a + '"'; }
  function wrap(body, cls) {
    return '<svg class="mk-art td-art' + (cls ? ' ' + cls : '') + '" viewBox="0 0 240 150" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">' + body + '</svg>';
  }
  function line(x1, y1, x2, y2, col, w, extra) {
    return '<path d="M' + r1(x1) + ' ' + r1(y1) + 'L' + r1(x2) + ' ' + r1(y2) + '" stroke="' + (col || INK) + '" stroke-width="' + (w || 1.2) + '" fill="none" stroke-linecap="round"' + (extra || '') + '/>';
  }
  function rect(x, y, w, h, fill, extra) {
    return '<rect x="' + r1(x) + '" y="' + r1(y) + '" width="' + r1(w) + '" height="' + r1(h) + '" fill="' + fill + '" stroke="' + INK + '" stroke-width="1.2"' + (extra || '') + '/>';
  }
  function poly(pts, fill, w, extra) {
    return '<path d="M' + pts.map(function (p) { return r1(p[0]) + ' ' + r1(p[1]); }).join('L') + 'Z" fill="' + fill + '" stroke="' + INK + '" stroke-width="' + (w || 1.2) + '" stroke-linejoin="round"' + (extra || '') + '/>';
  }
  function circle(cx, cy, r, fill, stroke, w, extra) {
    return '<circle cx="' + r1(cx) + '" cy="' + r1(cy) + '" r="' + r1(r) + '" fill="' + fill + '" stroke="' + (stroke || 'none') + '" stroke-width="' + (w || 1.2) + '"' + (extra || '') + '/>';
  }
  function ground(col) { return line(14, 140, 226, 140, col || INK, 1.2); }
  function arrow(x, y, dir, col) {
    var d = dir < 0 ? -1 : 1, c = col || INK;
    return line(x - 7 * d, y, x + 7 * d, y, c, 1.4) + line(x + 7 * d, y, x + 3 * d, y - 4, c, 1.4) + line(x + 7 * d, y, x + 3 * d, y + 4, c, 1.4);
  }
  // 写真のダミー（四隅の枠で「写真」と分かるように。墨の淡い線なので色は増えない）
  function corners() {
    return '<path d="M8 22 V8 H22 M218 8 H232 V22 M232 128 V142 H218 M22 142 H8 V128" stroke="' + INK + '" stroke-width="1.6" fill="none"' + so(0.55) + '/>';
  }
  TDD.frameOnly = function () { return wrap(corners(), 'is-photo'); };
  var ART = {};
  // ---------- 対話のお題の既定の絵（kind ごとに 1 枚・2 色。既存の部品と色だけで描く） ----------
  // ニュースから（墨 + 橙）: 新聞（見出しの帯・写真の枠・本文の線）
  ART.dk_news = function () {
    var out = '', i;
    out += rect(40, 20, 160, 110, WHITE, ' rx="4"') + line(120, 24, 120, 126, INK, 0.8, so(0.3));
    out += rect(52, 32, 96, 12, ORANGE, ' rx="2"' + fo(0.35));
    out += rect(52, 54, 56, 40, WHITE, ' rx="2"') + line(56, 90, 74, 70, INK, 1, so(0.5)) + line(74, 70, 86, 82, INK, 1, so(0.5)) + circle(96, 64, 4, ORANGE, INK, 1, fo(0.5));
    for (i = 0; i < 4; i++) out += line(128, 60 + i * 10, 188 - (i % 2) * 14, 60 + i * 10, INK, 1.6, so(i === 3 ? 0.35 : 1));
    for (i = 0; i < 2; i++) out += line(52, 106 + i * 10, 188 - i * 30, 106 + i * 10, INK, 1.6, so(0.5));
    out += arrow(170, 38, 1, ORANGE);
    return wrap(out);
  };
  // 話し合い（墨 + オリーブ）: 向かい合う 2 つの吹き出し（右はオリーブの淡い面）
  ART.dk_talk = function () {
    var out = '';
    out += '<path d="M22 22 H126 V76 H68 L50 94 V76 H22 Z" fill="' + WHITE + '" stroke="' + INK + '" stroke-width="1.4" stroke-linejoin="round"/>';
    out += line(36, 40, 110, 40, INK, 2) + line(36, 56, 96, 56, INK, 2, so(0.45));
    out += '<path d="M114 60 H218 V114 H192 V132 L172 114 H114 Z" fill="' + OLIVE + '"' + fo(0.15) + ' stroke="' + INK + '" stroke-width="1.4" stroke-linejoin="round"/>';
    out += line(128, 78, 202, 78, OLIVE, 2) + line(128, 94, 184, 94, OLIVE, 2, so(0.6));
    return wrap(out);
  };
  // 答えのない問い（墨 + 橙）: 考えの雲と、その中の問いの印
  ART.dk_philo = function () {
    var out = '';
    out += '<path d="M78 92 Q52 92 54 70 Q50 46 76 44 Q82 22 108 26 Q124 12 146 24 Q172 18 178 42 Q200 50 192 72 Q194 94 168 94 Z" fill="' + WHITE + '" stroke="' + INK + '" stroke-width="1.4" stroke-linejoin="round"/>';
    out += '<path d="M110 50 Q110 38 122 38 Q134 38 134 50 Q134 58 126 62 Q122 65 122 72" stroke="' + ORANGE + '" stroke-width="4" fill="none" stroke-linecap="round"/>';
    out += circle(122, 82, 3.2, ORANGE);
    out += circle(70, 108, 6, WHITE, INK, 1.3) + circle(54, 124, 4, WHITE, INK, 1.2) + circle(42, 136, 2.6, WHITE, INK, 1.1);
    out += line(150, 128, 214, 128, INK, 1.2, so(0.4)) + line(160, 138, 204, 138, INK, 1.2, so(0.25));
    return wrap(out);
  };
  var KIND_ART = { news: 'dk_news', talk: 'dk_talk', philo: 'dk_philo' };
  TDD.drawArt = function (kind, values) { return ART[kind] ? ART[kind](values || {}) : ''; };

  // ---------- 小道具 ----------
  TDD.KINDS = ['news', 'talk', 'philo'];
  TDD.ALL_KINDS = ['news', 'talk', 'philo', 'make'];
  TDD.LEVELS = ['check', 'self', 'open'];
  var TEXT_MAX = 300;
  // 禁止語（tools/check.sh の forbidden と同じ語。tools/pull-topics.mjs の FORBIDDEN と同じ配列）
  TDD.FORBIDDEN = ['点数', 'ランキング', '順位', '評価', '成績', 'レベル'];
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function arr(v) { return Array.isArray(v) ? v : []; }
  function chars(s) { return Array.from ? Array.from(s).length : String(s).length; }
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function isRealDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var d = new Date(s + 'T00:00:00Z');
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }
  TDD.isRealDate = isRealDate;
  // 記録のキーに使える lineage（オブジェクトの鍵にするので __proto__ などは使わない）
  var BAD_KEYS = { __proto__: true, constructor: true, prototype: true, hasOwnProperty: true, toString: true, valueOf: true };
  function okLineage(k) { return typeof k === 'string' && /^[A-Za-z0-9_.:-]{1,120}$/.test(k) && !hasOwn(BAD_KEYS, k) && k !== '__proto__'; }
  TDD.okLineage = okLineage;

  // ---------- 主張の印 [cN] を取り除く（[c1] / [c1, c2] / [c1][c2]。前の空白ごと） ----------
  var CLAIM_RE = /\s*\[c\d+(?:\s*[,、]\s*c\d+)*\]/g;
  function stripClaims(s) { return String(s).replace(CLAIM_RE, ''); }
  TDD.stripClaims = stripClaims;
  // 文字列を全部 stripClaims した深い写し（関数・undefined は落ちる。JSON の値だけ）
  function scrub(v) {
    if (typeof v === 'string') return stripClaims(v);
    if (Array.isArray(v)) return v.map(scrub);
    if (isObj(v)) { var o = {}; Object.keys(v).forEach(function (k) { if (!hasOwn(BAD_KEYS, k)) o[k] = scrub(v[k]); }); return o; }
    return v;
  }

  // ---------- 変換（配信の 1 件 { topic_id, kind, needs_supporter, lineage_id, body } → 画面の形） ----------
  function pair(l) { return isObj(l) ? [l.s, l.e] : null; }
  function srcOf(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return null;
    return ids.length === 1 ? ids[0] : ids.slice();
  }
  function monthDay(day) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day); return (+m[2]) + ' 月 ' + (+m[3]) + ' 日'; }
  TDD.idOf = function (topicId) { return 'fx-' + String(topicId).replace(/[^A-Za-z0-9_-]/g, '-'); };
  function lineageOf(item) {
    if (okLineage(item.lineage_id)) return item.lineage_id;
    return okLineage(item.topic_id) ? item.topic_id : null;
  }
  // 対話（tools/pull-topics.mjs の convertTopic の移植）。checked は出典の checked（無ければ null。取り込み日で代用しない。LS-18-16）
  function convertDialog(item) {
    var b = scrub(item.body), kind = item.kind, news = kind === 'news';
    return {
      id: TDD.idOf(item.topic_id), lineage: lineageOf(item), kind: kind,
      date: news ? (isRealDate(b.event_day) ? [monthDay(b.event_day), monthDay(b.event_day)] : null) : null,
      heavy: item.needs_supporter === true, art: null, source: 'factory',
      title: pair(b.title), lead: pair(b.lead), reason: null,
      // 前提（premises）は facts の前に、出典なしの前提として入れる（前提の入口に出す）
      facts: arr(b.premises).map(function (p) { return { text: isObj(p) ? pair(p.text) : null, src: null }; })
        .concat(arr(b.facts).map(function (f) { return { text: isObj(f) ? pair(f.text) : null, src: isObj(f) ? srcOf(f.source_ids) : null }; })),
      views: arr(b.views).map(function (v) {
        var name = isObj(v) && isObj(v.who) ? v.who.name : null;
        return { who: [name, name], stance: isObj(v) ? pair(v.stance) : null, src: isObj(v) ? srcOf(v.source_ids) : null };
      }),
      asks: arr(b.asks).map(function (a) { return { level: isObj(a) ? a.level : null, text: isObj(a) ? pair(a.text) : null }; }),
      stances: arr(b.stances).map(function (s) { return { id: isObj(s) ? s.id : null, label: isObj(s) ? pair(s.label) : null }; }),
      // learn: 「参考になる資料」に出すか（工場の sources[].for_learner が true の時だけ。contract-T v2.9）
      sources: arr(b.sources).map(function (s) {
        return { id: isObj(s) ? s.id : null, name: isObj(s) ? s.name : null, url: isObj(s) ? s.url : null,
          checked: isObj(s) && isRealDate(s.checked) ? s.checked : null, learn: isObj(s) && s.for_learner === true };
      }),
      next: isObj(b.next) ? { talk: pair(b.next.talk), makeTitle: pair(b.next.make_title), makeSteps: arr(b.next.make_steps).map(pair) } : null
    };
  }
  // 作る・ためす（LS-18-16。body.make: category / line / first_step / need / minutes / steps / safety。hints は今の配信に無い — あれば「実物を探す」）
  function convertMake(item) {
    var b = scrub(item.body), m = isObj(b.make) ? b.make : {};
    var hints = arr(m.hints).map(pair);
    return {
      id: TDD.idOf(item.topic_id), lineage: lineageOf(item), kind: 'make', source: 'factory',
      heavy: item.needs_supporter === true, art: null, reason: null,
      category: typeof m.category === 'string' ? m.category : null,
      title: pair(b.title), lead: pair(b.lead), line: pair(m.line),
      firstStep: pair(m.first_step), need: pair(m.need),
      minutes: typeof m.minutes === 'number' && isFinite(m.minutes) ? m.minutes : null,
      makeSteps: arr(m.steps).map(pair), makeTheme: null,
      safety: m.safety === true, outdoor: false,
      find: hints.length ? { hints: hints } : null
    };
  }
  TDD.convertTopic = function (item) {
    if (!isObj(item) || typeof item.topic_id !== 'string' || !item.topic_id || !isObj(item.body)) return null;
    if (item.kind === 'make') return convertMake(item);
    return TDD.KINDS.indexOf(item.kind) >= 0 ? convertDialog(item) : null;
  };

  // ---------- 検査（変換した後の形で。理由コードの配列・空なら合格） ----------
  function okStr(v) { return typeof v === 'string' && v.trim().length > 0 && chars(v) <= TEXT_MAX; }
  function okHttps(u) {
    if (typeof u !== 'string' || u.indexOf('https://') !== 0 || /[\s"'<>]/.test(u)) return false;
    try { return new URL(u).protocol === 'https:'; } catch (e) { return false; }
  }
  function okPair(p) { return Array.isArray(p) && p.length === 2 && okStr(p[0]) && okStr(p[1]); }
  function hasForbidden(d) {
    return TDD.kidTexts(d).some(function (s) { return typeof s === 'string' && TDD.FORBIDDEN.some(function (w) { return s.indexOf(w) >= 0; }); });
  }
  function baseChecks(d, r) {
    if (typeof d.id !== 'string' || !/^fx-[A-Za-z0-9_-]{1,80}$/.test(d.id)) r.add('id');
    if (!okLineage(d.lineage)) r.add('lineage');
    if (typeof d.heavy !== 'boolean') r.add('missing');
  }
  function list(r) { var out = []; r.forEach(function (x) { out.push(x); }); return out; }
  TDD.validateDialog = function (d) {
    var r = new Set();
    function chkPair(p) { if (!Array.isArray(p) || p.length !== 2) r.add('missing'); else if (!okStr(p[0]) || !okStr(p[1])) r.add('text'); }
    if (!isObj(d)) return ['missing'];
    baseChecks(d, r);
    if (TDD.KINDS.indexOf(d.kind) < 0) r.add('kind');
    if (d.kind === 'news') chkPair(d.date); else if (d.date !== null) r.add('date');
    chkPair(d.title);
    chkPair(d.lead);
    if (!Array.isArray(d.facts) || d.facts.length === 0) r.add('facts');
    if (!Array.isArray(d.views) || !Array.isArray(d.asks) || !Array.isArray(d.stances) || !Array.isArray(d.sources) || !isObj(d.next)) r.add('missing');
    if (r.has('missing')) return list(r);
    d.facts.forEach(function (f) { if (!isObj(f)) r.add('missing'); else chkPair(f.text); });
    d.views.forEach(function (v) { if (!isObj(v)) r.add('missing'); else { chkPair(v.who); chkPair(v.stance); } });
    // asks はちょうど 3 で level が check・self・open 1 つずつ
    var lv = d.asks.map(function (a) { return isObj(a) ? a.level : null; }).sort();
    if (d.asks.length !== 3 || lv.join() !== TDD.LEVELS.slice().sort().join()) r.add('asks');
    d.asks.forEach(function (a) { if (isObj(a)) chkPair(a.text); });
    // stances 2〜4。id は空でなく重ならない（「まだ決めない」の 'none' と重ならない）
    var sids = d.stances.map(function (s) { return isObj(s) ? s.id : null; });
    if (d.stances.length < 2 || d.stances.length > 4 || sids.some(function (x, i) { return typeof x !== 'string' || !x || x === 'none' || sids.indexOf(x) !== i; })) r.add('stances');
    d.stances.forEach(function (s) { if (isObj(s)) chkPair(s.label); });
    // sources: id は重ならない・name は空でない・url は https:// で new URL() で読める・checked は日付か null
    var srcIds = d.sources.map(function (s) { return isObj(s) ? s.id : null; });
    d.sources.forEach(function (s, i) {
      if (!isObj(s) || typeof s.id !== 'string' || !s.id || srcIds.indexOf(s.id) !== i || !okStr(s.name) || !(s.checked === null || isRealDate(s.checked))) { r.add('source'); return; }
      if (!okHttps(s.url)) r.add('url');
    });
    // src が指す id が sources にある
    var refs = [];
    d.facts.concat(d.views).forEach(function (x) { if (isObj(x) && x.src != null) refs.push.apply(refs, Array.isArray(x.src) ? x.src : [x.src]); });
    if (refs.some(function (id) { return srcIds.indexOf(id) < 0; })) r.add('src_ref');
    chkPair(d.next.talk);
    chkPair(d.next.makeTitle);
    if (!Array.isArray(d.next.makeSteps) || d.next.makeSteps.length < 3 || d.next.makeSteps.length > 4) r.add('steps');
    else d.next.makeSteps.forEach(chkPair);
    if (!r.size && hasForbidden(d)) r.add('forbidden');
    return list(r);
  };
  TDD.validateMake = function (d) {
    var r = new Set();
    function chkPair(p) { if (!Array.isArray(p) || p.length !== 2) r.add('missing'); else if (!okStr(p[0]) || !okStr(p[1])) r.add('text'); }
    if (!isObj(d)) return ['missing'];
    baseChecks(d, r);
    if (d.kind !== 'make') r.add('kind');
    chkPair(d.title);
    if (d.lead !== null) chkPair(d.lead);
    if (d.line !== null) chkPair(d.line);
    chkPair(d.firstStep);
    chkPair(d.need);
    if (!(d.category === null || typeof d.category === 'string')) r.add('category');
    if (typeof d.safety !== 'boolean') r.add('missing');
    if (!Array.isArray(d.makeSteps) || d.makeSteps.length < 3 || d.makeSteps.length > 4) r.add('steps');
    else d.makeSteps.forEach(chkPair);
    if (d.find !== null) {
      if (!isObj(d.find) || !Array.isArray(d.find.hints) || d.find.hints.length < 1 || d.find.hints.length > 6) r.add('find');
      else d.find.hints.forEach(chkPair);
    }
    if (!r.size && hasForbidden(d)) r.add('forbidden');
    return list(r);
  };
  TDD.validate = function (d) { return isObj(d) && d.kind === 'make' ? TDD.validateMake(d) : TDD.validateDialog(d); };
  // 子どもが読む文: 題・前提・事実・考え・問い・立場・次の一歩・最初の一歩・必要な物・手順・手がかり（出典の名前・url は含めない）
  TDD.kidTexts = function (d) {
    var out = [];
    function add(p) { if (Array.isArray(p)) out.push(p[0], p[1]); }
    if (!isObj(d)) return out;
    add(d.title); add(d.lead); add(d.reason); add(d.line); add(d.firstStep); add(d.need);
    arr(d.makeSteps).forEach(add);
    if (isObj(d.find)) arr(d.find.hints).forEach(add);
    arr(d.facts).forEach(function (f) { add(f && f.text); });
    arr(d.views).forEach(function (v) { add(v && v.who); add(v && v.stance); });
    arr(d.asks).forEach(function (a) { add(a && a.text); });
    arr(d.stances).forEach(function (s) { add(s && s.label); });
    if (isObj(d.next)) { add(d.next.talk); add(d.next.makeTitle); arr(d.next.makeSteps).forEach(add); }
    return out;
  };

  // ---------- 応答の束 → お題の一覧（同じ lineage は 1 本だけ: 日付の新しい方、同じなら先に来た方。同じ id も 1 本だけ） ----------
  TDD.buildTopics = function (responses) {
    var stat = { topics: 0, kept: 0, dropped: 0, reasons: {} }, cands = [], seq = 0;
    function drop(code) { stat.dropped += 1; stat.reasons[code] = (stat.reasons[code] || 0) + 1; }
    arr(responses).forEach(function (res) {
      var day = isObj(res) && isRealDate(res.day) ? res.day : null; // ストックの応答には日付が無い（日付つきより古い扱い）
      arr(isObj(res) ? res.topics : null).forEach(function (item) {
        stat.topics += 1;
        var d = null;
        try { d = TDD.convertTopic(item); } catch (e) { d = null; }
        if (!d) { drop('shape'); return; }
        var why = TDD.validate(d);
        if (why.length) { drop(why[0]); return; }
        cands.push({ d: d, day: day, seq: seq++ });
      });
    });
    cands.sort(function (a, b) { return a.day === b.day ? a.seq - b.seq : (a.day === null ? 1 : (b.day === null ? -1 : (a.day < b.day ? 1 : -1))); });
    var seenL = {}, seenId = {}, kept = [];
    cands.forEach(function (c) {
      if (hasOwn(seenL, c.d.lineage)) { drop('dup_lineage'); return; }
      if (hasOwn(seenId, c.d.id)) { drop('dup_id'); return; }
      seenL[c.d.lineage] = true;
      seenId[c.d.id] = true;
      kept.push(c.d);
    });
    stat.kept = kept.length;
    return { stat: stat, topics: kept };
  };

  // ---------- 読み込み（実行時。LS-13 / LS-18-28） ----------
  // phase: idle（まだ）/ loading（読み込み中 = 枠だけ描く）/ done（届いた。0 件もある）/ fail（全部取れなかった）
  // fail.talk / fail.make: ストックのうち、その節の種類が取れなかった（取れた分は出し、その節に td_fetch_fail の 1 文）
  var STOCK_KINDS = ['news', 'talk', 'philo', 'make'], STOCK_LIMIT = 3;
  TDD.STOCK_KINDS = STOCK_KINDS;
  var LOADED = [], listeners = [];
  TDD.status = { phase: 'idle', source: null, fail: { talk: false, make: false } };
  TDD.onLoad = function (fn) { if (typeof fn === 'function') listeners.push(fn); };
  function notify() { listeners.forEach(function (fn) { try { fn(TDD.status); } catch (e) { /* 描き直しの失敗で止めない */ } }); }
  TDD.loaded = function () { return LOADED.slice(); };
  // 配信の根: window.DES_FACTORY_BASE（検証の同一 origin の中継。'' = 同じ origin）があればそれ、無ければ DES.factory.base（LS-18-26）
  TDD.base = function () {
    var b = typeof root.DES_FACTORY_BASE === 'string' ? root.DES_FACTORY_BASE : (DES.factory && typeof DES.factory.base === 'string' ? DES.factory.base : '');
    return b.replace(/\/+$/, '');
  };
  // GET して JSON を読む唯一の出口（timeoutMs で abort。200 以外・JSON でない・topics が配列でない は失敗）。例外は投げない
  TDD.fetchJson = function (url, timeoutMs) {
    if (typeof root.fetch !== 'function') return Promise.resolve({ ok: false, why: 'no_fetch' });
    var ac = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = ac ? setTimeout(function () { ac.abort(); }, timeoutMs || 8000) : null;
    return root.fetch(url, { signal: ac ? ac.signal : undefined, cache: 'no-store', credentials: 'omit', headers: { accept: 'application/json' } })
      .then(function (res) {
        if (res.status !== 200) return { ok: false, why: 'status' };
        return res.json().then(function (j) { return isObj(j) && Array.isArray(j.topics) ? { ok: true, json: j } : { ok: false, why: 'shape' }; }, function () { return { ok: false, why: 'not_json' }; });
      }, function (e) { return { ok: false, why: e && e.name === 'AbortError' ? 'timeout' : 'network' }; })
      .then(function (r) { if (timer) clearTimeout(timer); return r; });
  };
  // o: { day: 'YYYY-MM-DD', base, timeoutMs, get(url, timeoutMs) → Promise<{ok, json}>（テスト用の差し替え） }。1 回だけ走る（force で読み直し）
  var running = null;
  TDD.load = function (o) {
    o = o || {};
    if (running && !o.force) return running;
    if (TDD.status.phase === 'done' && !o.force) return Promise.resolve(TDD.status);
    var get = o.get || TDD.fetchJson, base = o.base != null ? String(o.base).replace(/\/+$/, '') : TDD.base(), t = o.timeoutMs || (DES.factory && DES.factory.timeoutMs) || 8000;
    var day = o.day || (DES.clock ? DES.clock.today() : null);
    function safe(url) { try { return Promise.resolve(get(url, t)).then(function (r) { return isObj(r) ? r : { ok: false }; }, function () { return { ok: false }; }); } catch (e) { return Promise.resolve({ ok: false }); } }
    TDD.status = { phase: 'loading', source: null, fail: { talk: false, make: false } };
    notify();
    running = safe(base + '/api/library/topics?day=' + encodeURIComponent(day || '')).then(function (r) {
      if (!r.ok) return { phase: 'fail', source: 'day', fail: { talk: true, make: true }, topics: [] };
      var built = TDD.buildTopics([r.json]);
      if (built.topics.length) return { phase: 'done', source: 'day', fail: { talk: false, make: false }, topics: built.topics };
      return Promise.all(STOCK_KINDS.map(function (k) { return safe(base + '/api/library/topics/stock?kind=' + k + '&limit=' + STOCK_LIMIT); })).then(function (rs) {
        var okJson = [], failed = [];
        rs.forEach(function (x, i) { if (x.ok) okJson.push(x.json); else failed.push(STOCK_KINDS[i]); });
        var b = TDD.buildTopics(okJson);
        return { phase: failed.length === STOCK_KINDS.length ? 'fail' : 'done', source: 'stock',
          fail: { talk: failed.some(function (k) { return k !== 'make'; }), make: failed.indexOf('make') >= 0 }, topics: b.topics };
      });
    }).then(function (res) {
      LOADED = res.topics;
      TDD.status = { phase: res.phase, source: res.source, fail: res.fail };
      running = null;
      notify();
      return TDD.status;
    });
    return running;
  };
  // テスト用: 読み込んだお題を直接置く（node の純関数テスト）
  TDD._setLoaded = function (topics, status) {
    LOADED = arr(topics).slice();
    TDD.status = status || { phase: 'done', source: 'day', fail: { talk: false, make: false } };
  };

  // ---------- 引く（読み込んだお題 → 記録に添えた写し の順。'fx-' id でも lineage でも。LS-18-17） ----------
  function wantOk(o, want) { return isObj(o) && (want === 'make' ? o.kind === 'make' : TDD.KINDS.indexOf(o.kind) >= 0); }
  // copies: { [lineage]: { lineage, title, kind, body } }（normalize 済みの写し）
  TDD.resolve = function (id, copies, want) {
    if (typeof id !== 'string' || !id) return null;
    for (var i = 0; i < LOADED.length; i++) {
      var o = LOADED[i];
      if ((o.id === id || o.lineage === id) && wantOk(o, want)) return o;
    }
    if (!isObj(copies)) return null;
    if (okLineage(id) && hasOwn(copies, id) && isObj(copies[id]) && wantOk(copies[id].body, want)) return copies[id].body;
    var keys = Object.keys(copies);
    for (var j = 0; j < keys.length; j++) {
      var c = copies[keys[j]];
      if (isObj(c) && isObj(c.body) && c.body.id === id && wantOk(c.body, want)) return c.body;
    }
    return null;
  };
  // 写しの出所（既定はブラウザの DES.state.odai.copies。today.js が normalize した値）
  TDD.copiesFn = function () { var s = root.DES && root.DES.state; return s && isObj(s.odai) && isObj(s.odai.copies) ? s.odai.copies : null; };
  TDD.get = function (id) { return TDD.resolve(id, TDD.copiesFn(), 'make'); };
  TDD.getDialog = function (id) { return TDD.resolve(id, TDD.copiesFn(), 'dialog'); };
  TDD.pool = function () { return LOADED.filter(function (o) { return o.kind === 'make'; }).map(function (o) { return o.lineage; }); };
  TDD.kindPool = function (kind) { return LOADED.filter(function (o) { return o.kind === kind; }).map(function (o) { return o.lineage; }); };
  // 記録に添える写し（配信から消えても記録・あしあと・サークルの表示が残る）
  TDD.copyOf = function (o) { return { lineage: o.lineage, title: [o.title[0], o.title[1]], kind: o.kind, body: clone(o) }; };
  // 保存から読んだ写しを検査する（key = 記録のキー）。形が違えば null
  TDD.checkCopy = function (c, key) {
    if (!isObj(c) || !okLineage(key) || c.lineage !== key || !isObj(c.body) || c.body.lineage !== key || c.body.kind !== c.kind) return null;
    var b = clone(c.body);
    if (TDD.validate(b).length) return null;
    return { lineage: key, title: [b.title[0], b.title[1]], kind: b.kind, body: b };
  };
  // 互換: 変換済みのお題の配列を検査して取り込む（base の id と重なるものは捨てる。例外を外へ出さない）
  TDD.importLive = function (items, base) {
    var out = [], seen = {};
    arr(base).forEach(function (d) { if (d && d.id) seen[d.id] = true; });
    arr(items).forEach(function (t) {
      var d = null;
      try { d = isObj(t) && !TDD.validate(t).length ? clone(t) : null; } catch (e) { d = null; }
      if (!d || hasOwn(seen, d.id)) return;
      seen[d.id] = true;
      out.push(d);
    });
    return out;
  };
  TDD.kindOf = function (o) { return o && o.kind ? o.kind : 'make'; };
  TDD.srcIds = function (s) { return s == null ? [] : (Array.isArray(s) ? s.slice() : [s]); };
  TDD.sourceOf = function (o, sid) { var l = o && o.sources ? o.sources : []; for (var i = 0; i < l.length; i++) if (l[i].id === sid) return l[i]; return null; };
  TDD.stanceOf = function (o, sid) { var l = o && o.stances ? o.stances : []; for (var i = 0; i < l.length; i++) if (l[i].id === sid) return l[i]; return null; };
  TDD.askOf = function (o, level) { var l = o && o.asks ? o.asks : []; for (var i = 0; i < l.length; i++) if (l[i].level === level) return l[i]; return null; };
  // 対話のお題を作るの作業台へ渡す形（外で作る活動: 題 = next.makeTitle・手順 = next.makeSteps。M.fromOdai がそのまま読める）
  TDD.makeOdaiOf = function (o) {
    if (!o || !o.next) return null;
    return { id: o.id, lineage: o.lineage, title: o.next.makeTitle, firstStep: o.next.makeSteps[0], makeTheme: null, makeSteps: o.next.makeSteps };
  };

  // ---------- 絵 ----------
  // 対話 = kind ごとの既定の線画 / 作る・ためす = 種類の線画（gallery-data.js の GD.lineArt。種類が無い・知らない時は ものづくり）
  function GDref() { return DES.galleryData || (typeof require === 'function' ? (function () { try { return require('./gallery-data.js'); } catch (e) { return null; } })() : null); }
  TDD.cardArt = function (o) {
    if (!o) return '';
    if (o.kind === 'make') {
      var GD = GDref();
      if (!GD || !GD.lineArt) return TDD.frameOnly();
      return GD.lineArt(GD.CATS && GD.CATS.indexOf(o.category) >= 0 ? o.category : 'craft').replace('class="mk-art gl-art"', 'class="mk-art td-art"');
    }
    return TDD.drawArt(o.art && ART[o.art] ? o.art : KIND_ART[o.kind], {});
  };
  // 見つけた写真（DES.photo.pick の本物の写真 { data, w, h }）。形の検査は photo.js の valid と同じ
  var PHOTO_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
  TDD.photoValid = function (p) {
    return isObj(p) && typeof p.data === 'string' && p.data.length <= 400 * 1024 && PHOTO_RE.test(p.data) &&
      typeof p.w === 'number' && typeof p.h === 'number' && isFinite(p.w) && isFinite(p.h) && p.w > 0 && p.h > 0;
  };
  // trail.js が読む形: 本物の写真なら { data, w, h, label }（label は 1 行が無い時の見出し）、違えば null
  TDD.photo = function (odai, p) {
    if (!odai || !TDD.photoValid(p)) return null;
    return { data: p.data, w: p.w, h: p.h, label: ['見つけた写真', '見つけた写真'] };
  };
  // 写真の img（data URL は PHOTO_RE を通ったものだけ = 属性を壊す文字を含まない）。写真が無い時は枠だけ
  TDD.photoArt = function (odai, p) {
    if (!TDD.photoValid(p)) return TDD.frameOnly();
    return '<img class="td-photo" src="' + p.data + '" width="' + Math.round(p.w) + '" height="' + Math.round(p.h) + '" alt="" decoding="async">';
  };
  // 作業台の写真のダミー（make-data.js の MD.photoArt から。お題の絵 + 写真の四隅。お題が無ければ枠だけ）
  TDD.workPhotoArt = function (photo) {
    var id = photo && photo.odai, o = TDD.get(id) || TDD.getDialog(id);
    if (!o) return TDD.frameOnly();
    return TDD.cardArt(o).replace('</svg>', corners() + '</svg>').replace('class="mk-art td-art"', 'class="mk-art td-art is-photo"');
  };
  TDD.photoCount = function () { return 3; };
  if (MD) MD.odaiPhotoArt = TDD.workPhotoArt;
  // 「バディに任せる」の候補で作るメモ（お題の makeSteps / 必要な物から）。
  // opt: 'osteps' = 手順を整理して / 'oneed' = 必要な物をまとめて。alt = 同じ種類で作り直した時のもう一方の形
  function splitNeed(p, m) { var s = String((p && p[m]) || '').split(/\s*·\s*/); return { things: s[0] || '', place: s.slice(1).join(' · ') }; }
  TDD.leaveNote = function (odai, opt, alt) {
    if (!odai) return null;
    if (opt === 'osteps') {
      if (!odai.makeSteps || !odai.makeSteps.length) return null;
      var steps = alt && odai.firstStep ? [odai.firstStep].concat(odai.makeSteps.slice(1)) : odai.makeSteps;
      return { title: alt ? ['作り方の手順（最初の一歩から）', 'つくりかたの手じゅん（さいしょの一歩から）'] : ['作り方の手順', 'つくりかたの手じゅん'],
        lines: steps.slice(0, 4).map(function (s, i) { return [(i + 1) + '. ' + s[0], (i + 1) + '. ' + s[1]]; }) };
    }
    if (opt === 'oneed') {
      if (!odai.need) return null;
      var js = splitNeed(odai.need, 0), es = splitNeed(odai.need, 1);
      if (alt) {
        var tj = js.things.split('・'), te = es.things.split('・');
        return { title: ['持ち物チェック', 'もちものチェック'],
          lines: tj.map(function (t, i) { return ['□ ' + t, '□ ' + (te[i] || t)]; }).concat(js.place ? [['□ 場所: ' + js.place, '□ ばしょ: ' + es.place]] : []) };
      }
      var lines = [['用意する物: ' + js.things, 'よういするもの: ' + es.things]];
      if (js.place) lines.push(['場所: ' + js.place, 'ばしょ: ' + es.place]);
      if (odai.safety) lines.push(['始める前にサポーターと確認する', 'はじめる前にサポーターとかくにんする']);
      return { title: ['必要な物と場所', 'ひつようなものとばしょ'], lines: lines };
    }
    return null;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = TDD;
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
