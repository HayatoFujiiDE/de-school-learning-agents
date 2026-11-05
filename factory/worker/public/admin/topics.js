/* コンテンツファクトリー 管理画面「お題の棚」（契約 contract-T T-11。ビルド無し・ES2017・外部読み込み無し。fetch は自サイトの /api/* だけ）。
 * window.FactoryTopics = { mount(view, ctx) } を置くだけで、自分ではルーティングしない（admin.js の route() が #/topics で mount を呼ぶ）。
 * お題の文・出典の名前・検査のメモ・エラーの文は全部 textContent（createTextNode）で出す。HTML の文字列として差し込む API は使わない。
 * 出典のリンクは checkSourceUrl（T-5）と同じ規則を満たす URL だけ a.href に入れる。
 * DOM に触れない判断（承認ボタン・リンクにしてよい URL・タブの hash の解釈など）は純関数にして window.FactoryTopics から出す（test/topics-admin.test.ts）。 */
(function () {
  'use strict';

  // ---- 定数（契約で固定のもの。表示名は GET /api/topics/meta から取る）----
  var KINDS = ['news', 'talk', 'philo', 'make'];                     // T-1
  var TABS = [['today', '今日と明日', ''], ['held', '要確認', 'held'], ['stock', 'ストック', 'stock'], ['runs', '記録', 'runs']];
  var APPROVABLE_HOLD = { heavy: true, flagged: true };              // T-3 人が承認する述語の hold_reason
  var REFRESHABLE_HOLD = { source_lost: true, source_unreachable: true }; // T-9 見直しの親にできる held
  var SOURCE_HOLD = { source_not_found: true, source_unsupported: true, source_unreachable: true, source_lost: true };
  var BLOCKED_HOST_SUFFIX = ['.local', '.internal', '.localhost', '.home.arpa'];
  var NOTE_MAX = 200;                                                // T-9・T-10 note は 200 字まで
  var STATUS_LABEL = { draft: ['下書き', 'gray'], checking: ['検査中', 'yellow'], held: ['要確認', 'orange'], ready: ['出せる', 'green'], rejected: ['出さない', 'gray'], retired: ['引退', 'gray'] };
  var RUN_STATUS = { calling: ['作成中', 'yellow'], done: ['完了', 'green'], failed: ['失敗', 'red'], skipped: ['飛ばした', 'gray'] };
  var PURPOSE_LABEL = { gen: '作る', derive: '派生' };
  var DERIVE_LABEL = { refresh: '見直す', extend: '発展させる' };
  var TRIGGER_LABEL = { cron: '定期', manual: '手動' };
  var SLOT_STATE = { ready: ['出せる', 'green'], stopped: ['止めた', 'orange'], empty: ['空き', 'red'] };
  var FETCH_LABEL = { found: ['見つかった', 'green'], not_found: ['引用が見つからない', 'red'], fetch_failed: ['開けない', 'red'], blocked: ['規則で開かない', 'red'], pending: ['まだ開いていない', 'gray'] };
  var EVIDENCE_LABEL = { gen_fetch: '作った時の取得で照合', worker_fetch: '工場が開いて照合' };
  var DECISION_LABEL = { approve: '承認', reject: '出さない', retire: '止めた', star: '星を付けた', unstar: '星を外した', recheck: '検査のやり直し', auto_ready: '自動で出せるに', auto_hold: '自動で要確認に', auto_retire: '自動で引退' };
  var ASK_LABEL = { check: '確かめる', self: '自分に引きつける', open: '答えが 1 つでない' };
  var WHO_LABEL = { person: '人', org: '組織', position: '考え' };
  var ERR_TEXT = {
    not_approvable: 'この理由で止めたお題は「出せるにする」ができません（出典・形・禁止語・検査の失敗などで止めたもの）。「検査をやり直す」「見直す」「出さない」から選んでください',
    read_all_required: '重い話題です。全文を読んで「全文を読んだ」にチェックを入れてから押してください',
    sha_mismatch: '画面を開いた後に本文が変わっています。読み込み直して、もう一度全文を確かめてください',
    state_conflict: '状態が変わっています（ほかの操作か定期処理が先に動きました）。読み込み直してください',
    invalid_note: 'メモは 200 字までです',
    invalid_decision: 'この操作は受け付けられません',
    run_in_progress: '同じ種類の作成がもう動いています。終わってから押してください',
    cap: '費用の上限に届いているため始められません',
    parent_not_eligible: 'このお題からは今は作れません（状態・深さ・子の数・週の上限の条件に合いません）',
    topics_disabled: 'お題は「切」になっています。記録のタブで「入」にしてから押してください',
    paused: '工場が一時停止中のため実行できません',
    not_found: '見つかりません（消えたか、id が違います）',
    access_denied: 'ログインが必要です',
    bad_origin: '送信元が正しくありません'
  };

  // ---- 純関数 ----
  function has(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }

  /** hash がお題の棚か（#/topics・#/topics/…・#/topics?…） */
  function isTopicsHash(hash) {
    return /^#\/topics(?:[/?]|$)/.test(String(hash || ''));
  }

  /** #/topics → today / #/topics/held / #/topics/stock?kind=news / #/topics/runs。お題の棚でなければ null。知らないタブは today */
  function parseTopicsHash(hash) {
    var s = String(hash || '');
    if (!isTopicsHash(s)) return null;
    var rest = s.slice('#/topics'.length);
    var qi = rest.indexOf('?');
    var path = qi >= 0 ? rest.slice(0, qi) : rest;
    var q = {};
    if (qi >= 0) rest.slice(qi + 1).split('&').forEach(function (kv) {
      var p = kv.split('=');
      if (!p[0]) return;
      try { q[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ''); } catch (e) { /* 壊れた % は無視 */ }
    });
    var seg = path.split('/').filter(Boolean)[0] || '';
    var tab = 'today';
    TABS.forEach(function (t) { if (t[2] && t[2] === seg) tab = t[0]; });
    var kind = tab === 'stock' && KINDS.indexOf(q.kind) >= 0 ? q.kind : null;
    return { tab: tab, kind: kind };
  }

  /** タブ（と種類）→ hash */
  function topicsHash(tab, kind) {
    var t = TABS.filter(function (x) { return x[0] === tab; })[0];
    var base = '#/topics' + (t && t[2] ? '/' + t[2] : '');
    return base + (tab === 'stock' && kind && KINDS.indexOf(kind) >= 0 ? '?kind=' + kind : '');
  }

  /** 出典の URL をリンクにしてよいか（T-5 checkSourceUrl と同じ規則）。よければ正規化した href、だめなら null */
  function safeSourceHref(raw) {
    if (typeof raw !== 'string' || !raw) return null;
    var URLCtor = typeof URL === 'function' ? URL : null;
    if (!URLCtor) return null;
    var u;
    try { u = new URLCtor(raw); } catch (e) { return null; }
    if (u.protocol !== 'https:') return null;
    if (u.username || u.password) return null;
    if (u.port) return null;
    var host = String(u.hostname || '').toLowerCase().replace(/\.$/, '');
    if (!host || host.indexOf('.') < 0) return null;
    if (host.charAt(0) === '[' || host.indexOf(':') >= 0) return null;          // IPv6
    if (/^[0-9.]+$/.test(host)) return null;                                     // IPv4（URL が正規化した後の形）
    if (host === 'localhost') return null;
    for (var i = 0; i < BLOCKED_HOST_SUFFIX.length; i++) {
      var sfx = BLOCKED_HOST_SUFFIX[i];
      if (host.length > sfx.length && host.slice(-sfx.length) === sfx) return null;
    }
    return u.href;
  }

  /** meta の表示名の表（{code: label} でも [{code|kind|id, label|name}] でも受ける） */
  function labelMap(x) {
    var out = {};
    if (Array.isArray(x)) {
      x.forEach(function (it) {
        if (!it || typeof it !== 'object') return;
        var k = it.code || it.kind || it.id;
        var v = it.label || it.name;
        if (typeof k === 'string' && typeof v === 'string') out[k] = v;
      });
    } else if (x && typeof x === 'object') {
      Object.keys(x).forEach(function (k) { if (typeof x[k] === 'string') out[k] = x[k]; });
    }
    return out;
  }
  function slotMap(x) {
    var out = {};
    if (Array.isArray(x)) {
      x.forEach(function (it) { if (it && typeof it.kind === 'string' && typeof it.count === 'number') out[it.kind] = it.count; });
    } else if (x && typeof x === 'object') {
      Object.keys(x).forEach(function (k) { if (typeof x[k] === 'number') out[k] = x[k]; });
    }
    return out;
  }
  /** GET /api/topics/meta の応答 → { enabled, kinds, slots, reasons }。取れなかった時（null）は表示名なし */
  function normalizeMeta(m) {
    if (!m || typeof m !== 'object') return null;
    return { enabled: m.enabled === true, kinds: labelMap(m.kinds), slots: slotMap(m.slots), reasons: labelMap(m.reasons) };
  }
  /** 種類の表示名。meta に無ければコードそのまま */
  function kindText(code, meta) {
    var k = String(code === null || code === undefined ? '' : code);
    return meta && has(meta.kinds, k) ? meta.kinds[k] : k;
  }
  /** 理由コードの表示名。完全一致 → 「接頭:接尾」を分けて引く → コードそのまま */
  function reasonText(code, meta) {
    var c = String(code === null || code === undefined ? '' : code);
    var r = meta ? meta.reasons : null;
    if (r && has(r, c)) return r[c];
    var i = c.indexOf(':');
    if (r && i > 0) {
      var pre = c.slice(0, i), post = c.slice(i + 1);
      if (has(r, pre)) return r[pre] + '（' + (has(r, post) ? r[post] : post) + '）';
    }
    return c;
  }

  /** 要確認の 3 つの分け方: heavy（重い話題）/ flagged（気になる点）/ source（出典と、そのほかの止まった理由） */
  function heldGroup(holdReason) {
    if (holdReason === 'heavy') return 'heavy';
    if (holdReason === 'flagged') return 'flagged';
    return 'source';
  }
  function isSourceHold(holdReason) { return has(SOURCE_HOLD, holdReason); }

  /** held のお題に出す操作（T-3・T-9）。approve は hold_reason が heavy / flagged の時だけ。refresh は source_lost / source_unreachable の時だけ */
  function heldActions(topic) {
    if (!topic || topic.status !== 'held') return [];
    if (has(APPROVABLE_HOLD, topic.hold_reason)) return ['approve', 'reject'];
    var out = ['recheck'];
    if (has(REFRESHABLE_HOLD, topic.hold_reason)) out.push('refresh');
    out.push('reject');
    return out;
  }

  /** 最新の検査の記録（attempt = check_attempts。check_attempts が無ければ attempt の一番大きいもの） */
  function latestCheck(topic, checks) {
    if (!Array.isArray(checks) || !checks.length) return null;
    var want = topic && typeof topic.check_attempts === 'number' ? topic.check_attempts : null;
    var best = null;
    checks.forEach(function (c) {
      if (!c || typeof c.attempt !== 'number') return;
      if (want !== null) { if (c.attempt === want) best = c; return; }
      if (!best || c.attempt > best.attempt) best = c;
    });
    return best;
  }
  function truthyFlag(v) { return v === 1 || v === true; }

  /**
   * 「出せるにする」の状態（T-3 人が承認する述語を画面で先に見る。最終の判定はサーバー）。
   * topic = 一覧か詳細のお題の行 / detail = GET /api/topics/:id の応答（未取得は null）/ readAll = 「全文を読んだ」のチェック。
   * → { show, enabled, why, body }。body は POST /api/topics/:id/decide に送る形
   */
  function approveState(topic, detail, readAll) {
    var t = detail && detail.topic ? detail.topic : topic;
    if (!t || t.status !== 'held' || !has(APPROVABLE_HOLD, t.hold_reason)) return { show: false, enabled: false, why: '', body: null };
    if (!detail || !detail.topic) return { show: true, enabled: false, why: '全文を読み込んでいます', body: null };
    var heavy = t.sensitivity === 'heavy';
    if (typeof t.content_sha256 !== 'string' || !t.content_sha256) return { show: true, enabled: false, why: '本文の印（content_sha256）がありません。読み込み直してください', body: null };
    var c = latestCheck(t, detail.checks);
    if (!c) return { show: true, enabled: false, why: '最新の検査の記録がありません', body: null };
    if (c.content_sha256 !== t.content_sha256) return { show: true, enabled: false, why: '最新の検査が今の本文のものではありません', body: null };
    if (!truthyFlag(c.approvable)) return { show: true, enabled: false, why: '最新の検査が、人が承認してよい結果ではありません', body: null };
    if (heavy && readAll !== true) return { show: true, enabled: false, why: '重い話題です。全文を読んで「全文を読んだ」にチェックを入れてください', body: null };
    var body = { decision: 'approve', content_sha256: t.content_sha256 };
    if (heavy) body.read_all = true;
    return { show: true, enabled: true, why: '', body: body };
  }

  /** API の失敗 → 画面の文（400 / 409 の理由を文で）。e は admin.js の api() が投げる Error（status・body つき） */
  function errorText(e, meta) {
    var status = e && typeof e.status === 'number' ? e.status : 0;
    var body = e && e.body && typeof e.body === 'object' ? e.body : null;
    var code = body && typeof body.error === 'string' ? body.error : '';
    var text;
    if (code && has(ERR_TEXT, code)) text = ERR_TEXT[code];
    else if (status === 409) text = '状態か本文が変わっています。読み込み直してください' + (code ? '（' + code + '）' : '');
    else if (status === 400) text = '送った内容を受け付けませんでした' + (code ? '（' + reasonText(code, meta) + '）' : '');
    else if (status) text = '失敗しました（' + (code ? reasonText(code, meta) : 'HTTP ' + status) + '）';
    else text = '通信できませんでした' + (e && e.message ? '（' + e.message + '）' : '');
    if (body && Array.isArray(body.reasons) && body.reasons.length) text += ': ' + body.reasons.map(function (r) { return reasonText(r, meta); }).join('・');
    if (body && typeof body.message === 'string' && body.message) text += '（' + body.message + '）';
    return text;
  }

  /** Asia/Tokyo の日付（YYYY-MM-DD）。offset 日ずらす（Asia/Tokyo は夏時間なし） */
  function tokyoDay(now, offset) {
    var t = new Date(now.getTime() + 9 * 3600 * 1000 + (offset || 0) * 86400 * 1000);
    return t.toISOString().slice(0, 10);
  }

  /** JSON の文字列か、もう解いた値か */
  function parsed(v, fallback) {
    if (typeof v === 'string') { try { return JSON.parse(v); } catch (e) { return fallback; } }
    return v === undefined || v === null ? fallback : v;
  }
  function bodyOf(t) { return t ? parsed(has(t, 'body') ? t.body : t.body_json, null) : null; }
  function checkReasons(c) { var r = c ? parsed(has(c, 'reasons') ? c.reasons : c.reasons_json, []) : []; return Array.isArray(r) ? r : []; }
  function checkDetail(c) { var d = c ? parsed(has(c, 'detail') ? c.detail : c.detail_json, null) : null; return d && typeof d === 'object' ? d : null; }

  // ---- DOM（ここから下は mount の後だけ動く）----
  function append(el, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { append(el, x); }); return; }
    if (typeof c === 'string' || typeof c === 'number') { el.appendChild(document.createTextNode(String(c))); return; }
    el.appendChild(c);
  }
  /** 要素を作る。文字は必ず textContent。href は内部の固定値か safeSourceHref を通した値だけを渡す */
  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = String(v);
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'disabled' || k === 'checked') el[k] = !!v;
      else el.setAttribute(k, v === true ? '' : String(v));
    });
    append(el, children);
    return el;
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  function pill(text, cls) { return h('span', { class: 'pill ' + (cls || ''), text: text }); }
  function labelPill(table, code) { var x = table[code] || [String(code === null || code === undefined ? '—' : code), 'gray']; return pill(x[0], x[1]); }
  function fmtTime(t) { if (!t) return '—'; try { return new Date(t).toLocaleString('ja-JP'); } catch (e) { return String(t); } }
  function loadingEl() { return h('p', { class: 'loading', 'data-tp-loading': '1', text: '読み込み中…' }); }

  var S = { gen: 0, ctx: null, meta: null, metaOk: false };
  function alive(g) { return g === S.gen && isTopicsHash(location.hash); }
  function api(method, path, body) { return S.ctx.api(method, path, body); }
  function toast(msg, isErr) { if (S.ctx && typeof S.ctx.toast === 'function') S.ctx.toast(msg, isErr); }
  /** 予告。admin.js の確認ダイアログ（Enter / Esc）があればそれを使う */
  function confirmFirst(opts) {
    if (S.ctx && typeof S.ctx.confirm === 'function') return S.ctx.confirm(opts);
    return Promise.resolve({ ok: window.confirm(opts.title + (opts.body ? '\n\n' + opts.body : '')), note: '' });
  }
  function errorBox(msg, retry) {
    return h('div', { class: 'card', 'data-tp-error': '1' }, [
      h('p', { class: 'err', role: 'alert', text: '読み込めませんでした: ' + msg }),
      retry ? h('p', null, h('button', { type: 'button', class: 'btn', onclick: retry, text: 'もう一度読み込む' })) : null
    ]);
  }

  /** 行ごとの結果の欄（成功・失敗の文。aria-live） */
  function resultLine() { return h('p', { class: 'tp-result', 'aria-live': 'polite', tabindex: '-1' }); }
  function setResult(el, text, isErr) {
    el.textContent = text || '';
    el.className = 'tp-result' + (isErr ? ' err' : text ? ' ok-text' : '');
    if (text) el.setAttribute('role', isErr ? 'alert' : 'status'); else el.removeAttribute('role');
  }
  /** 通信中は buttons を全部止める（二重送信・同じ行の別操作を防ぐ） */
  function runBusy(buttons, btn, busyText, p) {
    var label = btn ? btn.textContent : '';
    var prev = buttons.map(function (b) { return b.disabled; });
    buttons.forEach(function (b) { b.disabled = true; });
    if (btn) btn.textContent = busyText || '送信中…';
    function restore() { buttons.forEach(function (b, i) { b.disabled = prev[i]; }); if (btn) btn.textContent = label; }
    return p.then(function (r) { restore(); return r; }, function (e) { restore(); throw e; });
  }

  // ---- 全文 ----
  function seBlock(se) {
    var o = se && typeof se === 'object' ? se : {};
    return h('div', { class: 'tp-se' }, [
      h('div', { class: 'tp-se-cell' }, [h('span', { class: 'tp-se-tag', text: '中学生' }), h('span', { class: 'pre', text: o.s || '' })]),
      h('div', { class: 'tp-se-cell' }, [h('span', { class: 'tp-se-tag', text: '小学生' }), h('span', { class: 'pre', text: o.e || '' })])
    ]);
  }
  function srcIdPills(ids) {
    return Array.isArray(ids) && ids.length ? h('span', { class: 'tp-srcids' }, ids.map(function (id) { return pill('出典 ' + id, 'gray'); })) : null;
  }
  function section(title, items) {
    if (!items || !items.length) return null;
    return h('section', { class: 'tp-sec' }, [h('h4', { text: title }), h('ol', { class: 'tp-list' }, items)]);
  }
  function sourceLink(url, text) {
    var href = safeSourceHref(url);
    if (!href) return h('span', { class: 'tp-url-text', title: 'リンクにしない URL（https 以外・資格情報・ポート・IP・社内の名前）', text: String(url || '') });
    return h('a', { href: href, target: '_blank', rel: 'noopener noreferrer', text: text || href });
  }
  function fullTextEl(detail, meta) {
    var t = detail.topic || {};
    var b = bodyOf(t);
    if (!b || typeof b !== 'object') return h('p', { class: 'err', text: '本文を読めませんでした' });
    var srcRows = Array.isArray(detail.sources) ? detail.sources : [];
    var rowById = {};
    srcRows.forEach(function (r) { if (r && typeof r.source_id === 'string') rowById[r.source_id] = r; });
    var bodySources = Array.isArray(b.sources) ? b.sources : [];
    var srcIds = bodySources.map(function (s) { return s && s.id; }).filter(function (x) { return typeof x === 'string'; });
    srcRows.forEach(function (r) { if (r && typeof r.source_id === 'string' && srcIds.indexOf(r.source_id) < 0) srcIds.push(r.source_id); });
    var out = h('div', { class: 'tp-full', 'data-tp-full': '1' });
    append(out, [
      h('section', { class: 'tp-sec' }, [h('h4', { text: '題' }), seBlock(b.title)]),
      h('section', { class: 'tp-sec' }, [h('h4', { text: 'リード' }), seBlock(b.lead)]),
      b.event_day ? h('p', null, [h('b', { text: 'できごとの日 ' }), String(b.event_day)]) : null,
      section('場面の設定・仮定', (b.premises || []).map(function (p) { return h('li', null, seBlock(p && p.text)); })),
      section('事実', (b.facts || []).map(function (f) {
        return h('li', null, [h('div', { class: 'row' }, [pill(String(f && f.id || ''), 'gray'), srcIdPills(f && f.source_ids)]), seBlock(f && f.text)]);
      })),
      section('いろいろな考え', (b.views || []).map(function (v) {
        var who = v && v.who || {};
        return h('li', null, [
          h('div', { class: 'row' }, [pill('立場 ' + String(v && v.side || ''), 'orange'), h('b', { text: String(who.name || '') }), pill(WHO_LABEL[who.type] || String(who.type || ''), 'gray'), srcIdPills(v && v.source_ids)]),
          seBlock(v && v.stance)
        ]);
      })),
      section('問い', (b.asks || []).map(function (a) { return h('li', null, [pill(ASK_LABEL[a && a.level] || String(a && a.level || ''), 'gray'), seBlock(a && a.text)]); })),
      section('自分の考えの選択肢', (b.stances || []).map(function (s) { return h('li', null, seBlock(s && s.label)); })),
      b.next && typeof b.next === 'object' ? h('section', { class: 'tp-sec' }, [
        h('h4', { text: '次へ（話す・作る）' }),
        h('p', { class: 'muted', text: '話す' }), seBlock(b.next.talk),
        h('p', { class: 'muted', text: '作るの題' }), seBlock(b.next.make_title),
        h('ol', { class: 'tp-list' }, (b.next.make_steps || []).map(function (s) { return h('li', null, seBlock(s)); }))
      ]) : null,
      b.make && typeof b.make === 'object' ? h('section', { class: 'tp-sec' }, [
        h('h4', { text: '作るの提案' }),
        h('p', null, [pill(String(b.make.category || ''), 'gray'), ' ', String(b.make.minutes || '') + ' 分', b.make.safety ? [' ', pill('刃物・火・屋外あり', 'red')] : null]),
        h('p', { class: 'muted', text: 'ひとこと' }), seBlock(b.make.line),
        h('p', { class: 'muted', text: '最初の一歩' }), seBlock(b.make.first_step),
        h('p', { class: 'muted', text: '必要な物' }), seBlock(b.make.need),
        h('ol', { class: 'tp-list' }, (b.make.steps || []).map(function (s) { return h('li', null, seBlock(s)); })),
        b.make.thumb_prompt ? h('p', { class: 'muted pre', text: 'サムネイルの説明: ' + String(b.make.thumb_prompt) }) : null
      ]) : null,
      section('出典と抜き書き', srcIds.map(function (id) {
        var bs = bodySources.filter(function (s) { return s && s.id === id; })[0] || {};
        var r = rowById[id] || {};
        var url = r.url || bs.url || '';
        return h('li', { class: 'tp-src', 'data-tp-src': id }, [
          h('div', { class: 'row' }, [
            pill(id, 'gray'), h('b', { text: String(r.name || bs.name || '') }),
            truthyFlag(r.required) ? pill('必須', 'orange') : null,
            r.fetch_result ? labelPill(FETCH_LABEL, r.fetch_result) : null,
            r.evidence ? h('span', { class: 'muted', text: EVIDENCE_LABEL[r.evidence] || String(r.evidence) }) : null
          ]),
          h('p', { class: 'tp-url' }, sourceLink(url)),
          h('blockquote', { class: 'tp-quote pre', text: String(r.quote || bs.quote || '') }),
          r.excerpt ? h('div', { class: 'tp-excerpt' }, [h('span', { class: 'muted', text: '抜き書き（引用の前後）' }), h('p', { class: 'pre', text: String(r.excerpt) })]) : null
        ]);
      })),
      b.tags && typeof b.tags === 'object' ? h('p', { class: 'muted' }, [
        '関心: ', (b.tags.interests || []).join('・') || '—', ' / 概念: ', (b.tags.concept_codes || []).join('・') || '—'
      ]) : null
    ]);
    return out;
  }
  function checkEl(detail, meta) {
    var t = detail.topic || {};
    var c = latestCheck(t, detail.checks);
    if (!c) return h('p', { class: 'muted', text: '検査の記録はまだありません' });
    var d = checkDetail(c);
    var o = d && d.output && typeof d.output === 'object' ? d.output : null;
    var reasons = checkReasons(c);
    return h('section', { class: 'tp-sec tp-check', 'data-tp-check': '1' }, [
      h('h4', { text: '最新の検査（' + String(c.attempt) + ' 回目）' }),
      h('div', { class: 'row' }, [
        pill(c.verdict === 'green' ? '緑' : '赤', c.verdict === 'green' ? 'green' : 'red'),
        c.sensitivity === 'heavy' ? pill('重い話題', 'red') : pill('重くない', 'gray'),
        pill(truthyFlag(c.sources_ok) ? '出典はそろった' : '出典がそろっていない', truthyFlag(c.sources_ok) ? 'green' : 'red'),
        pill(truthyFlag(c.approvable) ? '人が承認できる結果' : '承認できない結果', truthyFlag(c.approvable) ? 'green' : 'gray'),
        h('span', { class: 'muted', text: fmtTime(c.created_at) })
      ]),
      reasons.length ? h('ul', { class: 'tp-reasons' }, reasons.map(function (r) { return h('li', null, [h('span', { text: reasonText(r, meta) }), ' ', h('code', { class: 'muted', text: String(r) })]); })) : null,
      o && Array.isArray(o.heavy_reasons) && o.heavy_reasons.length ? h('p', null, ['重い理由: ', o.heavy_reasons.map(function (r) { return reasonText(r, meta); }).join('・')]) : null,
      o && Array.isArray(o.flags) && o.flags.length ? h('p', null, ['気になる点: ', o.flags.map(function (r) { return reasonText(r, meta); }).join('・')]) : null,
      o && typeof o.note === 'string' && o.note ? h('p', { class: 'pre' }, [h('b', { text: '検査のメモ ' }), o.note]) : null
    ]);
  }
  function lineageEl(detail, meta) {
    var rows = Array.isArray(detail.lineage) ? detail.lineage.slice() : [];
    if (rows.length <= 1) return null;
    rows.sort(function (a, b) { return (a.depth || 0) - (b.depth || 0); });
    var me = detail.topic && detail.topic.id;
    return h('section', { class: 'tp-sec' }, [h('h4', { text: '系譜（深さの順）' }), h('ol', { class: 'tp-lineage' }, rows.map(function (r) {
      return h('li', { class: r.id === me ? 'tp-me' : '' }, [
        pill('深さ ' + String(r.depth || 0), 'gray'), ' ',
        r.derive_kind ? pill(DERIVE_LABEL[r.derive_kind] || r.derive_kind, 'gray') : null, ' ',
        h('span', { text: String(r.title || '') }), ' ', labelPill(STATUS_LABEL, r.status), ' ',
        h('span', { class: 'muted', text: kindText(r.kind, meta) }), r.id === me ? h('span', { class: 'muted', text: '（このお題）' }) : null
      ]);
    }))]);
  }
  function decisionsEl(detail) {
    var rows = Array.isArray(detail.decisions) ? detail.decisions : [];
    if (!rows.length) return null;
    return h('section', { class: 'tp-sec' }, [h('h4', { text: '決定の記録' }), h('ul', { class: 'tp-decisions' }, rows.map(function (d) {
      return h('li', null, [
        h('span', { class: 'muted', text: fmtTime(d.created_at) }), ' ', h('b', { text: DECISION_LABEL[d.decision] || String(d.decision) }), ' ',
        h('span', { class: 'muted', text: String(d.by || '') }), truthyFlag(d.read_all) ? [' ', pill('全文を読んだ', 'green')] : null,
        d.note ? h('span', { class: 'pre', text: ' ' + String(d.note) }) : null
      ]);
    }))]);
  }

  // ---- お題 1 本のカード（要確認・ストック共通）----
  /** cfg: { g, mode: 'held'|'stock', open: 全文を最初から開くか } */
  function topicCard(row, cfg) {
    var st = { topic: row, detail: null, detailErr: null, loading: false, open: !!cfg.open, readAll: false, extendOpen: false };
    var root = h('article', { class: 'tp-card', 'data-tp-topic': row.id });
    var result = resultLine();
    var meta = S.meta;

    function loadDetail() {
      st.loading = true; st.detailErr = null; paint();
      return api('GET', '/api/topics/' + encodeURIComponent(st.topic.id)).then(function (d) {
        if (!alive(cfg.g)) return;
        st.loading = false; st.detail = d && d.topic ? d : null; st.readAll = false;
        if (st.detail) st.topic = mergeTopic(st.topic, st.detail.topic);
        else st.detailErr = '応答の形が違います';
        paint();
      }, function (e) {
        if (!alive(cfg.g)) return;
        st.loading = false; st.detailErr = errorText(e, meta); paint();
      });
    }
    function mergeTopic(a, b) { var o = {}; Object.keys(a || {}).forEach(function (k) { o[k] = a[k]; }); Object.keys(b || {}).forEach(function (k) { if (k !== 'body' && k !== 'body_json') o[k] = b[k]; }); return o; }

    /** 決定を送る。成功は行の状態を変える・失敗は理由の文。409 は詳細を読み直す（チェックは外れる） */
    function decide(btn, body, okText, nextStatus) {
      var buttons = Array.prototype.slice.call(root.querySelectorAll('button'));
      setResult(result, '');
      return runBusy(buttons, btn, '送信中…', api('POST', '/api/topics/' + encodeURIComponent(st.topic.id) + '/decide', body)).then(function (res) {
        if (!alive(cfg.g)) return;
        var t = res && res.topic && typeof res.topic === 'object' ? res.topic : null;
        st.topic = mergeTopic(st.topic, t || nextStatus);
        st.detail = null; st.open = false; st.extendOpen = false; // 状態が変わったので全文は閉じ、次に開いた時に読み直す
        paint();
        setResult(result, okText, false);
        result.focus();
        toast(okText);
      }, function (e) {
        if (!alive(cfg.g)) return;
        var msg = errorText(e, meta);
        toast(msg, true);
        if (e && e.status === 409 && st.open) {
          loadDetail().then(function () { if (alive(cfg.g)) { setResult(result, msg, true); result.focus(); } });
        } else { setResult(result, msg, true); result.focus(); }
      });
    }
    function shaThen(fn) {
      // 星・止める・やり直し・出さないにも content_sha256 を送る（T-10）。一覧に無ければ詳細から取る
      if (st.topic.content_sha256) return fn(st.topic.content_sha256);
      return api('GET', '/api/topics/' + encodeURIComponent(st.topic.id)).then(function (d) {
        if (d && d.topic && d.topic.content_sha256) { st.topic = mergeTopic(st.topic, d.topic); return fn(d.topic.content_sha256); }
        setResult(result, '本文の印（content_sha256）を読めませんでした。読み込み直してください', true);
      }, function (e) { setResult(result, errorText(e, meta), true); });
    }
    function simpleDecide(btn, decision, okText, nextStatus, confirmOpts) {
      var go = function (note) {
        if (Array.from(String(note || '').trim()).length > NOTE_MAX) { setResult(result, ERR_TEXT.invalid_note, true); result.focus(); return null; }
        return shaThen(function (sha) {
          var body = { decision: decision, content_sha256: sha };
          if (note && note.trim()) body.note = note.trim().slice(0, NOTE_MAX);
          return decide(btn, body, okText, nextStatus);
        });
      };
      if (!confirmOpts) return go('');
      return confirmFirst(confirmOpts).then(function (d) { if (d && d.ok) return go(d.note || ''); });
    }
    function derive(btn, kind, note) {
      if (Array.from(String(note || '').trim()).length > NOTE_MAX) { setResult(result, ERR_TEXT.invalid_note, true); result.focus(); return Promise.resolve(false); }
      var buttons = Array.prototype.slice.call(root.querySelectorAll('button'));
      setResult(result, '');
      var body = { kind: kind };
      if (note && note.trim()) body.note = note.trim().slice(0, NOTE_MAX);
      return runBusy(buttons, btn, '送信中…', api('POST', '/api/topics/' + encodeURIComponent(st.topic.id) + '/derive', body)).then(function (res) {
        if (!alive(cfg.g)) return;
        var rid = res && (res.run_id || (res.run && res.run.id));
        var text = (kind === 'refresh' ? '見直しの子を作り始めました' : '発展の子を作り始めました') + (rid ? '（run ' + rid + '）' : '') + '。できた子は検査を通ってから出ます。記録のタブで進み具合を見られます';
        st.extendOpen = false; paint();
        setResult(result, text, false); result.focus(); toast(kind === 'refresh' ? '見直しを始めました' : '発展を始めました');
        return true;
      }, function (e) {
        if (!alive(cfg.g)) return false;
        var msg = errorText(e, meta);
        setResult(result, msg, true); result.focus(); toast(msg, true);
        return false;
      });
    }

    function headEl() {
      var t = st.topic;
      return h('div', { class: 'tp-card-head' }, [
        h('h3', { class: 'tp-title', text: String(t.title || t.id) }),
        h('div', { class: 'row' }, [
          pill(kindText(t.kind, meta), 'gray'), labelPill(STATUS_LABEL, t.status),
          t.sensitivity === 'heavy' ? pill('重い話題（サポーターと読む）', 'red') : null,
          t.status === 'held' && t.hold_reason ? h('span', { class: 'tp-reason' }, [h('span', { text: reasonText(t.hold_reason, meta) }), ' ', h('code', { class: 'muted', text: String(t.hold_reason) })]) : null,
          typeof t.depth === 'number' && t.depth > 0 ? pill('深さ ' + t.depth, 'gray') : null,
          truthyFlag(t.starred) ? pill('★ 星', 'yellow') : null,
          h('span', { class: 'muted', text: '何日用 ' + String(t.slot_day || '—') })
        ])
      ]);
    }
    function toggleBtn() {
      return h('button', {
        type: 'button', class: 'btn small', 'aria-expanded': st.open ? 'true' : 'false',
        text: st.open ? '全文を閉じる' : '全文と系譜を開く',
        onclick: function () { st.open = !st.open; if (st.open && !st.detail && !st.loading) loadDetail(); else paint(); }
      });
    }
    function bodyEl() {
      if (!st.open) return null;
      if (st.loading) return loadingEl();
      if (st.detailErr) return h('div', null, [h('p', { class: 'err', role: 'alert', text: '全文を読めませんでした: ' + st.detailErr }), h('button', { type: 'button', class: 'btn small', onclick: loadDetail, text: 'もう一度読み込む' })]);
      if (!st.detail) return null;
      return h('div', { class: 'tp-detail' }, [fullTextEl(st.detail, meta), checkEl(st.detail, meta), lineageEl(st.detail, meta), decisionsEl(st.detail)]);
    }

    function heldOps() {
      var t = st.topic;
      var acts = heldActions(t);
      if (!acts.length) return null;
      var wrap = h('div', { class: 'tp-ops' });
      if (acts.indexOf('approve') >= 0) {
        var ap = approveState(t, st.detail, st.readAll);
        var why = h('span', { class: 'tp-why muted', 'aria-live': 'polite', text: ap.why });
        var abtn = h('button', { type: 'button', class: 'btn primary', disabled: !ap.enabled, 'data-tp-approve': '1', text: '出せるにする' });
        var heavy = (st.detail && st.detail.topic ? st.detail.topic : t).sensitivity === 'heavy';
        if (heavy) {
          var cb = h('input', { type: 'checkbox', 'data-tp-readall': '1', checked: st.readAll, disabled: !st.detail });
          cb.addEventListener('change', function () {
            st.readAll = cb.checked;
            var s2 = approveState(st.topic, st.detail, st.readAll);
            abtn.disabled = !s2.enabled; why.textContent = s2.why;
          });
          wrap.appendChild(h('label', { class: 'check tp-readall' }, [cb, h('span', { text: '全文（事実・考え・問い・出典と抜き書き）を読んだ' })]));
        }
        abtn.addEventListener('click', function () {
          var s3 = approveState(st.topic, st.detail, st.readAll);
          if (!s3.enabled) { setResult(result, s3.why, true); return; }
          decide(abtn, s3.body, '出せるにしました。次の予定の確定から候補に入ります', { status: 'ready', hold_reason: null });
        });
        wrap.appendChild(h('div', { class: 'row' }, [abtn, why]));
      }
      var row2 = h('div', { class: 'row' });
      if (acts.indexOf('recheck') >= 0) {
        var rb = h('button', { type: 'button', class: 'btn', text: '検査をやり直す' });
        rb.addEventListener('click', function () {
          simpleDecide(rb, 'recheck', '検査のやり直しに戻しました（下書き。出典を開き直して次の定期処理で検査します）', { status: 'draft', hold_reason: null }, {
            title: '検査をやり直します', body: String(t.title || '') + '\n\n出典を全部開き直し、次の定期処理（10 分ごと）で検査をもう 1 巡します。検査の費用がかかります。', okText: 'やり直す'
          });
        });
        row2.appendChild(rb);
      }
      if (acts.indexOf('refresh') >= 0) {
        var fb = h('button', { type: 'button', class: 'btn', text: '見直す' });
        fb.addEventListener('click', function () {
          confirmFirst({ title: 'このお題を見直します', body: String(t.title || '') + '\n\n出典を今に合わせた子を 1 本作ります（生成の費用がかかります）。子が出せるようになった時に、このお題は引退します。', okText: '見直す', note: true, noteRequired: false, noteLabel: '運営のひとこと（任意・200 字まで）' })
            .then(function (d) { if (d && d.ok) derive(fb, 'refresh', d.note || ''); });
        });
        row2.appendChild(fb);
      }
      if (acts.indexOf('reject') >= 0) {
        var xb = h('button', { type: 'button', class: 'btn danger', text: '出さない' });
        xb.addEventListener('click', function () {
          simpleDecide(xb, 'reject', '出さないにしました', { status: 'rejected' }, {
            title: 'このお題を出さないにします', body: String(t.title || '') + '\n\n元には戻せません（同じ題は、新しく作り直す必要があります）。', okText: '出さない', note: true, noteRequired: false, noteLabel: 'メモ（任意・200 字まで）'
          });
        });
        row2.appendChild(xb);
      }
      if (row2.firstChild) wrap.appendChild(row2);
      return wrap;
    }

    function stockOps() {
      var t = st.topic;
      if (t.status !== 'ready') return null;
      var starred = truthyFlag(t.starred);
      var sb = h('button', { type: 'button', class: 'btn small', 'aria-pressed': starred ? 'true' : 'false', text: starred ? '★ 星を外す' : '☆ 星を付ける' });
      sb.addEventListener('click', function () {
        simpleDecide(sb, starred ? 'unstar' : 'star', starred ? '星を外しました' : '星を付けました', { starred: starred ? 0 : 1 }, null);
      });
      var rb = h('button', { type: 'button', class: 'btn small danger', text: '止める' });
      rb.addEventListener('click', function () {
        simpleDecide(rb, 'retire', '止めました（引退。配信と次の予定から外れます）', { status: 'retired' }, {
          title: 'このお題を止めます', body: String(t.title || '') + '\n\n配信と次からの予定に出なくなります（引退）。ここからは元に戻せません。', okText: '止める', note: true, noteRequired: false, noteLabel: 'メモ（任意・200 字まで）'
        });
      });
      var fb = h('button', { type: 'button', class: 'btn small', text: '見直す' });
      fb.addEventListener('click', function () {
        confirmFirst({ title: 'このお題を見直します', body: String(t.title || '') + '\n\n前提・事実・出典を今に合わせた子を 1 本作ります（生成の費用がかかります）。子が出せるようになった時に、このお題は引退します。', okText: '見直す', note: true, noteRequired: false, noteLabel: '運営のひとこと（任意・200 字まで）' })
          .then(function (d) { if (d && d.ok) derive(fb, 'refresh', d.note || ''); });
      });
      var eb = h('button', { type: 'button', class: 'btn small', 'aria-expanded': st.extendOpen ? 'true' : 'false', text: '発展させる' });
      eb.addEventListener('click', function () { st.extendOpen = !st.extendOpen; paint(); var ta = root.querySelector('textarea[data-tp-extend]'); if (ta) ta.focus(); });
      var form = null;
      if (st.extendOpen) {
        var ta = h('textarea', { 'data-tp-extend': '1', rows: '2', maxlength: String(NOTE_MAX), placeholder: '例: 作るにつなげたい / 中学生向けの答えのない問いへ' });
        var count = h('span', { class: 'muted', 'aria-live': 'polite', text: '0 / ' + NOTE_MAX });
        ta.addEventListener('input', function () { count.textContent = Array.from(ta.value).length + ' / ' + NOTE_MAX; });
        var go = h('button', { type: 'button', class: 'btn primary small', text: '発展の子を作る' });
        go.addEventListener('click', function () {
          if (Array.from(ta.value).length > NOTE_MAX) { setResult(result, ERR_TEXT.invalid_note, true); return; }
          var keep = ta.value;
          derive(go, 'extend', keep).then(function (ok) { if (!ok) { var t2 = root.querySelector('textarea[data-tp-extend]'); if (t2) t2.value = keep; } });
        });
        var cancel = h('button', { type: 'button', class: 'btn small', text: 'やめる', onclick: function () { st.extendOpen = false; paint(); eb.focus(); } });
        form = h('div', { class: 'tp-extend' }, [
          h('label', { class: 'field' }, [h('span', { text: '運営のひとこと（任意・200 字まで。次の問い・別の角度・別の種類のヒント）' }), ta]),
          h('div', { class: 'row' }, [go, cancel, count]),
          h('p', { class: 'muted', text: '子の種類は 話し合い・答えのない問い・作る から選ばれます。生成の費用がかかります。このお題は残ります。' })
        ]);
      }
      return h('div', { class: 'tp-ops' }, [h('div', { class: 'row' }, [sb, rb, fb, eb]), form]);
    }

    function paint() {
      var keepMsg = result.textContent, keepErr = /\berr\b/.test(result.className);
      clear(root);
      append(root, [headEl(), h('div', { class: 'row' }, toggleBtn()), bodyEl(), cfg.mode === 'held' ? heldOps() : stockOps(), result]);
      if (keepMsg) setResult(result, keepMsg, keepErr);
    }
    paint();
    if (st.open) loadDetail();
    return root;
  }

  // ---- タブ: 今日と明日 ----
  function renderToday(box, g) {
    var meta = S.meta;
    var now = new Date();
    var days = [['今日', tokyoDay(now, 0)], ['明日', tokyoDay(now, 1)]];
    clear(box);
    var cards = days.map(function (d) {
      var c = h('div', { class: 'card', 'data-tp-day': d[1] }, [h('h2', { text: d[0] + '（' + d[1] + '）' }), loadingEl()]);
      box.appendChild(c);
      return c;
    });
    days.forEach(function (d, i) {
      var card = cards[i];
      api('GET', '/api/topics/schedule?day=' + encodeURIComponent(d[1])).then(function (res) {
        if (!alive(g)) return;
        clear(card);
        card.appendChild(h('h2', { text: d[0] + '（' + d[1] + '）' }));
        var slots = res && Array.isArray(res.slots) ? res.slots : [];
        if (res && res.planned === false) card.appendChild(h('p', { class: 'muted', text: 'この日の予定はまだ確定していません（翌日の分は 18:00 以降の定期処理で確定します）' }));
        var kinds = KINDS.slice();
        slots.forEach(function (s) { if (s && kinds.indexOf(s.kind) < 0) kinds.push(s.kind); });
        var any = false;
        kinds.forEach(function (k) {
          var mine = slots.filter(function (s) { return s && s.kind === k; }).sort(function (a, b) { return (a.pos || 0) - (b.pos || 0); });
          var n = meta && has(meta.slots, k) ? meta.slots[k] : null;
          if (!mine.length && n === null) return;
          any = true;
          card.appendChild(h('section', { class: 'tp-kind', 'data-tp-kind': k }, [
            h('h3', null, [kindText(k, meta), h('span', { class: 'muted', text: n !== null ? '（' + n + ' 枠）' : '' })]),
            mine.length ? h('ul', { class: 'tp-slots' }, mine.map(function (s) {
              var t = s.topic && typeof s.topic === 'object' ? s.topic : null;
              return h('li', { class: 'tp-slot tp-slot-' + String(s.state || ''), 'data-tp-slot': String(s.state || '') }, [
                h('span', { class: 'muted', text: String(s.pos || '') + '.' }), ' ',
                labelPill(SLOT_STATE, s.state), ' ',
                t ? h('span', { text: String(t.title || t.id || '') }) : (s.state === 'empty' ? h('span', { class: 'err', text: '出せるお題がありません' }) : null),
                t && t.sensitivity === 'heavy' ? [' ', pill('サポーターと読む', 'red')] : null,
                t && s.state === 'stopped' && t.status ? [' ', h('span', { class: 'muted', text: '今は ' + (STATUS_LABEL[t.status] ? STATUS_LABEL[t.status][0] : t.status) })] : null
              ]);
            })) : h('p', { class: 'muted', text: '枠の情報がありません' })
          ]));
        });
        if (!any) card.appendChild(h('p', { class: 'muted', 'data-tp-empty': '1', text: 'この日の枠はありません' }));
      }, function (e) {
        if (!alive(g)) return;
        clear(card);
        card.appendChild(h('h2', { text: d[0] + '（' + d[1] + '）' }));
        card.appendChild(h('p', { class: 'err', role: 'alert', 'data-tp-error': '1', text: '読み込めませんでした: ' + errorText(e, meta) }));
        card.appendChild(h('button', { type: 'button', class: 'btn', text: 'もう一度読み込む', onclick: function () { renderToday(box, g); } }));
      });
    });
  }

  // ---- タブ: 要確認 ----
  var HELD_GROUPS = [
    ['heavy', '重い話題', '人が全文を読んで承認するまで出しません。子どもの画面には「サポーターと読む」の印が付きます。'],
    ['flagged', '気になる点', '検査が気になる点（出典のない主張・偏り・こわがらせる書き方など）を見つけました。全文を読んで判断してください。'],
    ['source', '出典（とそのほかの止まった理由）', '出典・形・禁止語・検査の失敗で止めたお題は「出せるにする」ができません。検査をやり直す・見直す・出さない、から選びます。']
  ];
  function renderHeld(box, g) {
    clear(box);
    box.appendChild(loadingEl());
    api('GET', '/api/topics?status=held&limit=100').then(function (res) {
      if (!alive(g)) return;
      clear(box);
      var rows = res && Array.isArray(res.topics) ? res.topics : [];
      HELD_GROUPS.forEach(function (gr) {
        var mine = rows.filter(function (t) { return t && heldGroup(t.hold_reason) === gr[0]; });
        var card = h('section', { class: 'card tp-group', 'data-tp-group': gr[0] }, [
          h('h2', null, [gr[1], ' ', pill(String(mine.length) + ' 件', mine.length ? 'orange' : 'gray')]),
          h('p', { class: 'muted', text: gr[2] })
        ]);
        if (!mine.length) card.appendChild(h('p', { class: 'muted', 'data-tp-empty': '1', text: 'ありません' }));
        mine.forEach(function (t) { card.appendChild(topicCard(t, { g: g, mode: 'held', open: gr[0] !== 'source' })); });
        box.appendChild(card);
      });
      if (res && res.next_before) box.appendChild(h('p', { class: 'muted', text: '100 件より多くあります。処理すると続きが出ます。' }));
    }, function (e) {
      if (!alive(g)) return;
      clear(box);
      box.appendChild(errorBox(errorText(e, S.meta), function () { renderHeld(box, g); }));
    });
  }

  // ---- タブ: ストック ----
  function renderStock(box, g, kind) {
    var meta = S.meta;
    clear(box);
    var filter = h('nav', { class: 'tabs', 'aria-label': '種類で絞る' }, [null].concat(KINDS).map(function (k) {
      var on = (k || null) === (kind || null);
      return h('a', { class: 'btn small' + (on ? ' on' : ''), href: topicsHash('stock', k), 'aria-current': on ? 'true' : null, text: k ? kindText(k, meta) : 'すべて' });
    }));
    var list = h('div', { class: 'tp-stock' }, loadingEl());
    box.appendChild(h('div', { class: 'card' }, [h('p', { class: 'muted', text: '出せるお題（ready）です。話し合い・答えのない問い・作るは 30 日あけてまた出ます。ニュースは 7 日で役目を終えます。' }), filter]));
    box.appendChild(list);
    api('GET', '/api/topics?status=ready&limit=100' + (kind ? '&kind=' + encodeURIComponent(kind) : '')).then(function (res) {
      if (!alive(g)) return;
      clear(list);
      var rows = res && Array.isArray(res.topics) ? res.topics : [];
      if (!rows.length) { list.appendChild(h('div', { class: 'card' }, h('p', { class: 'muted', 'data-tp-empty': '1', text: 'この種類の出せるお題はありません' }))); return; }
      rows.forEach(function (t) {
        var card = topicCard(t, { g: g, mode: 'stock', open: false });
        card.classList.add('card');
        var info = h('p', { class: 'muted tp-stock-info', text: '最後に出した日 ' + String(t.last_scheduled_day || 'まだ出していない') + ' / 系譜の深さ ' + String(typeof t.depth === 'number' ? t.depth : '—') });
        card.insertBefore(info, card.children[1] || null);
        list.appendChild(card);
      });
      if (res && res.next_before) list.appendChild(h('p', { class: 'muted', text: '100 件より多くあります。種類で絞ると続きが見られます。' }));
    }, function (e) {
      if (!alive(g)) return;
      clear(list);
      list.appendChild(errorBox(errorText(e, meta), function () { renderStock(box, g, kind); }));
    });
  }

  // ---- タブ: 記録 ----
  function renderRuns(box, g) {
    var meta = S.meta;
    clear(box);
    var enabled = meta ? meta.enabled : null;
    // 入・切と今月の額
    var stateCard = h('div', { class: 'card', 'data-tp-switch': enabled === null ? 'unknown' : enabled ? 'on' : 'off' });
    var money = h('p', { class: 'muted', text: '今月の額を読み込み中…' });
    var swResult = resultLine();
    var sw = h('button', { type: 'button', class: enabled ? 'btn danger' : 'btn primary', disabled: enabled === null, text: enabled ? '切にする' : '入にする' });
    sw.addEventListener('click', function () {
      var next = !enabled;
      confirmFirst({
        title: next ? 'お題の工場を入にします' : 'お題の工場を切にします',
        body: next ? '定期処理がお題を作り（生成の費用がかかります）、検査し、毎日の予定を確定します。月・日の上限の中で動きます。' : '新しく作る・検査する・予定の確定を止めます。配信 API も空になります。',
        okText: next ? '入にする' : '切にする'
      }).then(function (d) {
        if (!d || !d.ok) return;
        setResult(swResult, '');
        runBusy([sw], sw, '送信中…', api('POST', '/api/topics/settings', { enabled: next })).then(function () {
          if (!alive(g)) return;
          enabled = next;
          if (S.meta) S.meta.enabled = next;
          paintSwitch();
          setResult(swResult, next ? '入にしました' : '切にしました', false); swResult.focus(); toast(next ? 'お題を入にしました' : 'お題を切にしました');
        }, function (e) {
          if (!alive(g)) return;
          var msg = errorText(e, meta); setResult(swResult, msg, true); swResult.focus(); toast(msg, true);
        });
      });
    });
    var swState = h('span');
    function paintSwitch() {
      clear(swState);
      swState.appendChild(enabled === null ? pill('分かりません（表示名を読めませんでした）', 'gray') : enabled ? pill('入', 'green') : pill('切', 'gray'));
      stateCard.setAttribute('data-tp-switch', enabled === null ? 'unknown' : enabled ? 'on' : 'off');
      sw.className = enabled ? 'btn danger' : 'btn primary';
      sw.textContent = enabled ? '切にする' : '入にする';
      sw.disabled = enabled === null;
    }
    paintSwitch();
    append(stateCard, [h('h2', { text: '入・切と費用' }), h('div', { class: 'row' }, [swState, sw]), swResult, money]);
    box.appendChild(stateCard);
    api('GET', '/api/status').then(function (s) {
      if (!alive(g)) return;
      var tp = s && s.topics && typeof s.topics === 'object' ? s.topics : null;
      if (!tp) { money.textContent = '今月の額は状況の応答にありません'; return; }
      if (enabled === null && typeof tp.enabled === 'boolean') { enabled = tp.enabled; paintSwitch(); }
      var txt = '今月の記帳 ' + (typeof tp.month_cents === 'number' ? tp.month_cents + '¢' : '—') + ' / 上限 ' + (typeof tp.month_cap_cents === 'number' ? tp.month_cap_cents + '¢' : '—');
      if (typeof tp.over_reserve === 'number' && tp.over_reserve > 0) txt += '（実額が取り置きを超えた呼び出し ' + tp.over_reserve + ' 回）';
      money.textContent = txt;
      money.className = '';
    }, function (e) { if (alive(g)) { money.textContent = '今月の額を読めませんでした: ' + errorText(e, meta); money.className = 'err'; } });

    // 今すぐ作る
    var sel = h('select', { id: 'tp-run-kind', 'aria-label': '作る種類' }, KINDS.map(function (k) { return h('option', { value: k, text: kindText(k, meta) }); }));
    var runResult = resultLine();
    var go = h('button', { type: 'button', class: 'btn primary', text: '今すぐ作る' });
    go.addEventListener('click', function () {
      var k = sel.value;
      confirmFirst({ title: kindText(k, meta) + 'のお題を今すぐ作ります', body: '生成を 1 回呼びます（費用がかかります。上限を超える時は始まりません）。できたお題は検査を通ってから出ます。', okText: '作る' }).then(function (d) {
        if (!d || !d.ok) return;
        setResult(runResult, '');
        runBusy([go, sel], go, '送信中…', api('POST', '/api/topics/runs', { kind: k })).then(function (res) {
          if (!alive(g)) return;
          var rid = res && (res.run_id || (res.run && res.run.id));
          setResult(runResult, '作り始めました' + (rid ? '（run ' + rid + '）' : '') + '。下の記録に出ます', false); runResult.focus(); toast('作り始めました');
          loadRuns();
        }, function (e) {
          if (!alive(g)) return;
          var msg = errorText(e, meta); setResult(runResult, msg, true); runResult.focus(); toast(msg, true);
        });
      });
    });
    box.appendChild(h('div', { class: 'card' }, [h('h2', { text: '今すぐ作る' }), h('div', { class: 'row' }, [h('label', { for: 'tp-run-kind', text: '種類' }), sel, go]), runResult]));

    // run の一覧
    var listCard = h('div', { class: 'card' }, [h('h2', { text: '作った記録（新しい順）' })]);
    var list = h('div', null, loadingEl());
    listCard.appendChild(list);
    box.appendChild(listCard);
    function loadRuns() {
      clear(list); list.appendChild(loadingEl());
      api('GET', '/api/topics/runs?limit=50').then(function (res) {
        if (!alive(g)) return;
        clear(list);
        var rows = res && Array.isArray(res.runs) ? res.runs : [];
        if (!rows.length) { list.appendChild(h('p', { class: 'muted', 'data-tp-empty': '1', text: 'まだありません' })); return; }
        list.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 'tp-runs' }, [
          h('thead', null, h('tr', null, ['時刻', '目的', '種類', '何日用', '起動', '状態', '保存', '落とした', '額', '理由'].map(function (x) { return h('th', { text: x }); }))),
          h('tbody', null, rows.map(function (r) {
            return h('tr', { 'data-tp-run': String(r.status || '') }, [
              h('td', { text: fmtTime(r.created_at) }),
              h('td', { text: PURPOSE_LABEL[r.purpose] || String(r.purpose || '') }),
              h('td', { text: r.purpose === 'derive' ? (DERIVE_LABEL[r.kind] || String(r.kind || '')) : kindText(r.kind, meta) }),
              h('td', { text: String(r.slot_day || '—') }),
              h('td', { text: TRIGGER_LABEL[r.trigger] || String(r.trigger || '') }),
              h('td', null, labelPill(RUN_STATUS, r.status)),
              h('td', { text: String(typeof r.made === 'number' ? r.made : '—') }),
              h('td', { text: String(typeof r.dropped === 'number' ? r.dropped : '—') }),
              h('td', { text: typeof r.cents === 'number' ? r.cents + '¢' : '—' }),
              h('td', null, r.error ? [h('span', { text: reasonText(r.error, meta) }), ' ', h('code', { class: 'muted', text: String(r.error) })] : '—')
            ]);
          }))
        ])));
      }, function (e) {
        if (!alive(g)) return;
        clear(list);
        list.appendChild(h('p', { class: 'err', role: 'alert', 'data-tp-error': '1', text: '読み込めませんでした: ' + errorText(e, meta) }));
        list.appendChild(h('button', { type: 'button', class: 'btn', text: 'もう一度読み込む', onclick: loadRuns }));
      });
    }
    loadRuns();
  }

  // ---- mount ----
  function mount(view, ctx) {
    S.gen += 1;
    var g = S.gen;
    S.ctx = ctx || {};
    var r = parseTopicsHash(location.hash) || { tab: 'today', kind: null };
    clear(view);
    var nav = h('nav', { class: 'tabs tp-tabs', 'aria-label': 'お題の棚のタブ' }, TABS.map(function (t) {
      var on = t[0] === r.tab;
      return h('a', { class: 'btn small' + (on ? ' on' : ''), href: topicsHash(t[0], null), 'aria-current': on ? 'page' : null, 'data-tp-tab': t[0], text: t[1] });
    }));
    var metaLine = h('p', { class: 'muted tp-meta-line', 'aria-live': 'polite' });
    var box = h('div', { class: 'tp-box', 'data-tp-box': r.tab }, loadingEl());
    append(view, [h('h1', { text: 'お題の棚' }), nav, metaLine, box]);
    api('GET', '/api/topics/meta').then(function (m) { return normalizeMeta(m); }, function (e) { return { err: e }; }).then(function (m) {
      if (!alive(g)) return;
      if (m && m.err) { S.meta = null; metaLine.className = 'err tp-meta-line'; metaLine.textContent = '表示名を読めませんでした（' + errorText(m.err, null) + '）。種類と理由はコードのまま出します'; }
      else {
        S.meta = m;
        metaLine.textContent = m ? (m.enabled ? '' : 'お題の工場は「切」です（記録のタブで入にできます）') : '表示名がありません。種類と理由はコードのまま出します';
      }
      if (r.tab === 'held') renderHeld(box, g);
      else if (r.tab === 'stock') renderStock(box, g, r.kind);
      else if (r.tab === 'runs') renderRuns(box, g);
      else renderToday(box, g);
    });
  }

  window.FactoryTopics = {
    mount: mount,
    // 以下は DOM に触れない純関数（test/topics-admin.test.ts）
    isTopicsHash: isTopicsHash,
    parseTopicsHash: parseTopicsHash,
    topicsHash: topicsHash,
    safeSourceHref: safeSourceHref,
    normalizeMeta: normalizeMeta,
    kindText: kindText,
    reasonText: reasonText,
    heldGroup: heldGroup,
    isSourceHold: isSourceHold,
    heldActions: heldActions,
    latestCheck: latestCheck,
    approveState: approveState,
    errorText: errorText,
    tokyoDay: tokyoDay
  };
})();
