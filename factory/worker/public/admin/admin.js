/* コンテンツファクトリー 管理画面（契約 §G）。ビルド無し・ES2017・外部読み込み無し。fetch は自サイトの /api/* だけ。
 * 表示はすべて textContent / esc() 経由。md は全部エスケープしてから限られた記法だけを変換する（§G-2）。
 * 書き込み操作は 予告（ダイアログ）→ 実行（二重送信防止）→ フィードバック（トースト）→ 反映（再取得）。失敗時は入力を消さない（§G-3）。 */
(function () {
  'use strict';

  var WORK_LABEL = { idle: '待機', queued: '順番待ち', making: '制作中', review: '確認待ち' };
  var PUBLISH_LABEL = { none: 'なし', available: '利用できる', stopped: '止めている' };
  var JOB_LABEL = {
    queued: '順番待ち', creating: '作業場を準備中', running: '制作中', needs_answer: '質問への回答待ち',
    budget_reached: '上限に達しました', done: '完了', failed: '失敗', cancelled: '取り消し'
  };
  var SOURCE_LABEL = { child: '子ども由来', scout: '収集', meeting: '会議', manual: '手入力' };
  var AGE_LABEL = { elementary: '小学生', secondary: '中学生', both: '小中' };
  var PROPOSAL_TABS = [['proposed', '提案中'], ['adopted', '採択済み'], ['dismissed', '見送り']];
  var RUN_LABEL = { running: '実行中', done: '完了', failed: '失敗', skipped: '上限で飛ばした', submitted: '結果待ち', ended: '完了', expired: '失効' };
  var VERDICT_CLASS = { confirmed: 'green', hypothesis: 'yellow', unverified: 'gray', contradicted: 'red' };
  var CHECKLIST = [
    ['content_and_evidence', '内容と根拠'],
    ['explanation_and_expression', '説明と表現'],
    ['relation_to_learning', '学習との関係'],
    ['conditions_of_use', '使う条件'],
    ['artifact_behavior', '生成物の動作'],
    ['terms_of_use', '利用条件']
  ];
  var ERROR_TEXT = {
    personal_data_confirmation_required: '個人情報を含まないことの確認が必要です',
    slug_taken: 'その slug は既に使われています',
    material_busy: 'この素材は制作中または確認待ちです',
    paused: '停止中のため実行できません',
    too_many_running: '同時に動かせる数を超えています（順番待ちに入りました）',
    daily_cap_reached: '今日の費用の上限に達しています',
    factory_not_configured: '職人（agent）が設定されていません',
    anthropic_error: 'Anthropic への接続に失敗しました',
    not_queued: '順番待ちの状態ではありません',
    not_waiting: '回答待ちの状態ではありません',
    answer_in_flight: '回答を送信中です。少し待ってから再取得してください',
    not_cancellable: '取り消せる状態ではありません',
    not_reingestable: '取り込みをやり直せる状態ではありません（取り込みで失敗した job だけが対象です）',
    checklist_incomplete: '確認する項目をすべて選んでください',
    auto_triage_pending: '自動の処置を待っています（次の定期処理で差し戻し / 再検証されます）',
    checklist_has_ng: 'NG の項目があるため承認できません',
    verification_pending: '検証が終わっていません',
    verification_id_required: '検証結果を読み込み直してください',
    stale_verification: '検証結果が新しくなっています。読み込み直してください',
    has_contradicted_claims: '検証係が「食い違い」とした主張があるため承認できません',
    primary_source_unfetched: '確かめられた主張の一次出典が開かれていません',
    note_required: '理由を入力してください',
    not_in_review: '確認待ちの版ではありません',
    verification_running: '検証の実行中です',
    not_available: '配信中ではありません',
    conflict: '他の操作と競合しました。読み込み直してください',
    not_proposed: 'この提案は既に採択または見送り済みです',
    invalid_proposal: '提案の内容を確認してください',
    already_running: '収集は実行中です',
    already_submitted: '会議の結果を待っています（回収は 10 分ごと）',
    not_found: '見つかりません',
    access_denied: 'ログインが必要です',
    bad_origin: '送信元が正しくありません'
  };

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtCents(c) { return '$' + (Number(c || 0) / 100).toFixed(2); }
  function fmtTime(t) { if (!t) return '—'; try { return new Date(t).toLocaleString('ja-JP'); } catch (e) { return String(t); } }
  function pill(text, cls) { return '<span class="pill ' + (cls || '') + '">' + esc(text) + '</span>'; }
  function errText(body, status) {
    var code = body && body.error ? body.error : 'http_' + status;
    return (ERROR_TEXT[code] || code) + (body && body.message ? '（' + body.message + '）' : '');
  }

  // ---- API ----
  function api(method, path, body) {
    var opt = { method: method, headers: { accept: 'application/json' }, credentials: 'same-origin' };
    if (body !== undefined) { opt.headers['content-type'] = 'application/json'; opt.body = JSON.stringify(body); }
    return fetch(path, opt).then(function (res) {
      return res.text().then(function (t) {
        var data = null;
        try { data = t ? JSON.parse(t) : null; } catch (e) { data = null; }
        if (!res.ok) { var err = new Error(errText(data, res.status)); err.status = res.status; err.body = data; throw err; }
        return data;
      });
    });
  }
  function fetchText(path) {
    return fetch(path, { credentials: 'same-origin' }).then(function (r) {
      if (!r.ok) throw new Error('読み込めませんでした（' + r.status + '）');
      return r.text();
    });
  }

  // ---- toast ----
  var toastTimer = null;
  function toast(msg, isError) {
    var el = $('#toast');
    el.textContent = msg;
    el.className = 'toast' + (isError ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast hidden'; }, isError ? 7000 : 3500);
  }

  // ---- dialog（予告）----
  function confirmDialog(opts) {
    return new Promise(function (resolve) {
      var dlg = $('#dlg');
      $('#dlg-title').textContent = opts.title;
      $('#dlg-body').textContent = opts.body || '';
      var wrap = $('#dlg-note-wrap'), note = $('#dlg-note'), noteErr = $('#dlg-note-err');
      wrap.classList.toggle('hidden', !opts.note);
      noteErr.classList.add('hidden');
      note.value = opts.noteValue || '';
      $('#dlg-note-label').textContent = opts.noteLabel || '理由';
      $('#dlg-ok').textContent = opts.okText || '実行する';
      var ok = $('#dlg-ok'), cancel = $('#dlg-cancel');
      function done(v) { ok.removeEventListener('click', onOk); cancel.removeEventListener('click', onCancel); dlg.removeEventListener('cancel', onCancel); dlg.removeEventListener('keydown', onKey); dlg.close(); resolve(v); }
      // Enter で実行・Esc で取消（Esc は dialog の cancel）。理由欄の中の Enter は改行のまま
      function onKey(e) {
        if (e.key !== 'Enter' || e.isComposing || e.repeat || (e.target && e.target.tagName === 'TEXTAREA') || e.target === cancel) return;
        e.preventDefault();
        onOk();
      }
      function onOk() {
        if (opts.note && opts.noteRequired !== false && !note.value.trim()) { noteErr.classList.remove('hidden'); note.focus(); return; }
        done({ ok: true, note: note.value });
      }
      function onCancel(e) { if (e && e.preventDefault) e.preventDefault(); done({ ok: false }); }
      ok.addEventListener('click', onOk);
      cancel.addEventListener('click', onCancel);
      dlg.addEventListener('cancel', onCancel);
      dlg.addEventListener('keydown', onKey);
      dlg.showModal();
      if (opts.note) note.focus(); else ok.focus();
    });
  }

  /** 書き込み操作の共通ループ: 予告 → 実行（ボタン無効化）→ トースト → 再取得。opts.busyText（実行中のボタン文言）・opts.fail（失敗トーストの後）は任意 */
  function action(btn, opts) {
    return confirmDialog(opts).then(function (d) {
      if (!d.ok) return null;
      var label = btn ? btn.textContent : '';
      if (btn) { btn.disabled = true; btn.textContent = opts.busyText || '実行中…'; }
      return Promise.resolve(opts.run(d.note)).then(function (res) {
        toast(opts.success || '完了しました');
        if (opts.after) opts.after(res);
        else route();
        return res;
      }, function (e) {
        toast(e.message || '失敗しました', true);
        if (opts.fail) opts.fail(e);
        return null;
      }).then(function (r) {
        if (btn) { btn.disabled = false; btn.textContent = label; }
        return r;
      });
    });
  }

  // ---- md 描画（全部エスケープ → 見出し・段落・箇条書き・コード・http(s) リンクだけ）----
  function inlineMd(s) {
    var t = esc(s);
    t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
    t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, function (_m, text, href) {
      return '<a href="' + href + '" rel="noopener noreferrer" target="_blank">' + text + '</a>';
    });
    return t;
  }
  /** 段落の生テキストに要確認の主張 id の参照（[c3] / [c3, c4]）があるか */
  function mdMarked(raw, ids) {
    if (!ids) return false;
    var re = /\[([^\]]+)\]/g, m;
    while ((m = re.exec(raw))) {
      var toks = m[1].split(/[\s,、]+/);
      for (var i = 0; i < toks.length; i++) if (toks[i] && Object.prototype.hasOwnProperty.call(ids, toks[i])) return true;
    }
    return false;
  }
  /** markIds（任意）: 要確認の主張 id → その id を参照する段落・箇条に黄色の印（§L-6 3.） */
  function renderMd(src, markIds) {
    var lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
    var html = [], para = [], list = null, code = null;
    function open(tag, raw) { return mdMarked(raw, markIds) ? '<' + tag + ' class="flag">' : '<' + tag + '>'; }
    function flushPara() { if (para.length) { var raw = para.join(' '); html.push(open('p', raw) + inlineMd(raw) + '</p>'); para = []; } }
    function flushList() { if (list) { html.push('<ul>' + list.map(function (x) { return open('li', x) + inlineMd(x) + '</li>'; }).join('') + '</ul>'); list = null; } }
    lines.forEach(function (line) {
      if (code !== null) {
        if (/^```/.test(line)) { html.push('<pre><code>' + esc(code.join('\n')) + '</code></pre>'); code = null; } else code.push(line);
        return;
      }
      if (/^```/.test(line)) { flushPara(); flushList(); code = []; return; }
      var h = /^(#{1,4})\s+(.*)$/.exec(line);
      if (h) { flushPara(); flushList(); var n = Math.min(h[1].length + 1, 4); html.push('<h' + n + '>' + inlineMd(h[2]) + '</h' + n + '>'); return; }
      var li = /^\s*[-*]\s+(.*)$/.exec(line);
      if (li) { flushPara(); (list = list || []).push(li[1]); return; }
      if (!line.trim()) { flushPara(); flushList(); return; }
      flushList(); para.push(line.trim());
    });
    if (code !== null) html.push('<pre><code>' + esc(code.join('\n')) + '</code></pre>');
    flushPara(); flushList();
    return '<div class="md">' + html.join('') + '</div>';
  }

  // ---- 状況（上部帯）----
  function loadStatus() {
    var el = $('#status');
    return api('GET', '/api/status').then(function (s) {
      el.innerHTML =
        '<span class="item">' + (s.paused ? pill('停止中', 'red') : pill('動いています', 'green')) + (s.paused && s.paused_note ? ' <span class="muted">' + esc(s.paused_note) + '</span>' : '') + '</span>' +
        '<span class="item">制作中 <b>' + esc(s.running_jobs) + '</b> / ' + esc(s.max_concurrent) + '</span>' +
        '<span class="item">順番待ち <b>' + esc(s.queued_jobs) + '</b></span>' +
        '<span class="item">今日の費用 <b>' + fmtCents(s.today_cents) + '</b> / 上限 ' + fmtCents(s.daily_cap_cents) + '</span>' +
        '<span class="item">職人 ' + (s.agent_configured ? pill('設定済み', 'green') : pill('未設定', 'red')) + '</span>' +
        '<span class="item muted">cron 最終 ' + esc(fmtTime(s.last_cron_at)) + '</span>' +
        '<button type="button" class="btn small" id="pause-btn">' + (s.paused ? '再開' : '止める') + '</button>' +
        intakeStatusHtml(s);
      bindIntakeButtons(s);
      var btn = $('#pause-btn');
      btn.addEventListener('click', function () {
        action(btn, {
          title: s.paused ? '新しい制作と検証を再開します' : '新しい制作と検証を止めます',
          body: s.paused ? '' : '動いている制作は止まりません（必要なら各 job で取り消してください）。',
          note: true, noteLabel: 'メモ（必須）',
          run: function (note) { return api('POST', '/api/status/pause', { paused: !s.paused, note: note }); },
          success: s.paused ? '再開しました' : '止めました',
          after: function () { loadStatus(); }
        });
      });
    }, function (e) {
      el.innerHTML = '<span class="err">状況を読み込めませんでした: ' + esc(e.message) + '</span>';
    });
  }

  // ---- 状況欄: 収集・会議（§K-7）----
  function intakeStatusHtml(s) {
    var sc = s.scout || {}, mt = s.meeting || {};
    var scoutBusy = !!sc.running, meetBusy = !!mt.pending_batch;
    return '<span class="item">収集 ' + (sc.last_status ? pill(RUN_LABEL[sc.last_status] || sc.last_status, sc.last_status === 'failed' ? 'red' : '') : '<span class="muted">未実行</span>') +
        ' <span class="muted">今月 ' + fmtCents(sc.month_cents) + ' / 上限 ' + fmtCents(sc.month_cap_cents) + '</span>' +
        ' <button type="button" class="btn small" id="scout-btn"' + (scoutBusy || s.paused ? ' disabled' : '') + '>' + (scoutBusy ? '収集中…' : '収集を今すぐ') + '</button></span>' +
      '<span class="item">会議 ' + (mt.last_status ? pill(RUN_LABEL[mt.last_status] || mt.last_status, mt.last_status === 'failed' || mt.last_status === 'expired' ? 'red' : '') : '<span class="muted">未実行</span>') +
        ' <span class="muted">今月 ' + fmtCents(mt.month_cents) + ' / 上限 ' + fmtCents(mt.month_cap_cents) + '</span>' +
        ' <button type="button" class="btn small" id="meeting-btn"' + (meetBusy || s.paused ? ' disabled' : '') + '>' + (meetBusy ? '結果待ち' : '会議を今すぐ') + '</button></span>';
  }
  function bindIntakeButtons(s) {
    var sb = $('#scout-btn');
    if (sb) sb.addEventListener('click', function () {
      action(sb, {
        title: '収集を今すぐ実行します',
        body: 'RSS と X（設定されていれば）を読み、Haiku で仕分けて提案箱に入れます。費用は今月の収集の上限（' + fmtCents((s.scout || {}).month_cap_cents) + '）の範囲で記録します。25 秒で打ち切ります。',
        okText: '実行する',
        run: function () { return api('POST', '/api/scout/run'); },
        success: '収集を実行しました',
        after: function (res) {
          if (res && res.skipped) toast('上限に達しているため飛ばしました（' + (res.reason || '') + '）', true);
          else if (res && res.status === 'failed') toast('収集は失敗しました: ' + (res.error || ''), true);
          else if (res) toast('収集: 提案 ' + res.proposed + ' 件 / 捨てた ' + res.dropped + ' 件');
          route();
        }
      });
    });
    var mb = $('#meeting-btn');
    if (mb) mb.addEventListener('click', function () {
      action(mb, {
        title: '会議を今すぐ起こします',
        body: '提案箱と素材を Batch API（1 件）で検討します。結果は 10 分ごとの回収で入ります（最長 24 時間）。費用は今月の会議の上限（' + fmtCents((s.meeting || {}).month_cap_cents) + '）の範囲で記録します。',
        okText: '起こす',
        run: function () { return api('POST', '/api/meeting/run'); },
        success: '会議を起こしました。結果は回収後に提案箱に出ます',
        after: function (res) {
          if (res && res.skipped) toast('上限に達しているため起こしませんでした（' + (res.reason || '') + '）', true);
          route();
        }
      });
    });
  }

  // ---- 画面: 提案箱（§K-7）----
  function viewProposals(view, q) {
    var status = q.status || 'proposed';
    view.innerHTML = '<h1>提案箱</h1><div class="card"><div class="tabs">' +
      PROPOSAL_TABS.map(function (t) { return '<a class="btn small' + (t[0] === status ? ' on' : '') + '" href="#/proposals?status=' + t[0] + '">' + esc(t[1]) + '</a>'; }).join('') +
      '</div><div id="plist" class="loading">読み込み中…</div></div>' +
      '<div id="pdetail"></div>' +
      '<form id="p-form" class="card"><h2>手で足す</h2>' +
      '<label class="field"><span>題名（120 文字まで）</span><input type="text" id="p-title" maxlength="120"></label>' +
      '<label class="field"><span>本文（題材・つながる概念・足りなかったこと。2000 文字まで）</span><textarea id="p-body" rows="5" maxlength="2000"></textarea></label>' +
      '<label class="field"><span>つながる概念のコード（任意。英大文字と数字、カンマ区切り）</span><input type="text" id="p-concepts"></label>' +
      '<label class="field"><span>年齢帯（任意）</span><select id="p-age"><option value="">指定なし</option><option value="elementary">小学生</option><option value="secondary">中学生</option><option value="both">小中</option></select></label>' +
      '<div class="field"><span>型（任意）</span><label class="check"><input type="checkbox" id="p-k3"> 型 3</label><label class="check"><input type="checkbox" id="p-k4"> 型 4</label></div>' +
      '<label class="field"><span>根拠 URL（任意。https のみ、1 行に 1 つ、10 件まで。発想の入口であって根拠扱いしません）</span><textarea id="p-evidence" rows="3"></textarea></label>' +
      '<p id="p-err" class="err hidden"></p>' +
      '<div class="row end"><button type="submit" class="btn primary" id="p-submit">提案箱に足す</button></div></form>' +
      '<div id="minutes"></div>';
    bindManualForm();
    loadMinutes();
    api('GET', '/api/proposals?status=' + encodeURIComponent(status)).then(function (d) {
      var list = $('#plist');
      list.classList.remove('loading');
      if (!d.proposals.length) { list.innerHTML = '<p class="muted">この状態の提案はありません。</p>'; return; }
      list.innerHTML = '<div class="table-wrap"><table><thead><tr><th>入口</th><th>題名</th><th>年齢帯</th><th>優先度</th><th>似た提案</th><th>作成</th></tr></thead><tbody>' +
        d.proposals.map(function (p, i) {
          return '<tr><td>' + pill(SOURCE_LABEL[p.source_kind] || p.source_kind) + '</td><td><a href="#" data-pi="' + i + '">' + esc(p.title) + '</a></td><td>' + esc(AGE_LABEL[p.age_band] || '—') + '</td><td>' + (p.priority ? esc(p.priority) : '—') + '</td><td>' + esc(p.similar_count) + '</td><td>' + esc(fmtTime(p.created_at)) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
      Array.prototype.forEach.call(list.querySelectorAll('a[data-pi]'), function (a) {
        a.addEventListener('click', function (ev) { ev.preventDefault(); showProposal(d.proposals[Number(a.getAttribute('data-pi'))]); });
      });
    }, function (e) { $('#plist').innerHTML = '<p class="err">読み込めませんでした: ' + esc(e.message) + '</p>'; });
  }

  function showProposal(p) {
    var el = $('#pdetail');
    var ev = (p.evidence || []).map(function (e) {
      var ok = /^https:\/\//.test(e.url || '');
      return '<li>' + (ok ? '<a href="' + esc(e.url) + '" rel="noopener noreferrer" target="_blank">' + esc(e.title || e.url) + '</a>' : esc(e.url)) + (e.note ? ' <span class="muted">' + esc(e.note) + '</span>' : '') + '</li>';
    }).join('');
    el.innerHTML = '<div class="card"><h2>' + esc(p.title) + '</h2>' +
      '<div class="row">' + pill(SOURCE_LABEL[p.source_kind] || p.source_kind) + pill('年齢帯: ' + (AGE_LABEL[p.age_band] || '指定なし')) + (p.priority ? pill('優先度 ' + p.priority, 'orange') : '') + pill('似た提案 ' + p.similar_count) +
        (p.kinds && p.kinds.length ? pill('型 ' + p.kinds.join(', ')) : '') + (p.catalog_item_id ? '<span class="muted">カタログ ' + esc(p.catalog_item_id) + '</span>' : '') + '</div>' +
      '<p class="pre">' + esc(p.body) + '</p>' +
      '<p><b>つながる概念</b> ' + (p.concept_codes && p.concept_codes.length ? esc(p.concept_codes.join(', ')) : '<span class="muted">なし</span>') + '</p>' +
      '<p><b>根拠 URL</b>（発想の入口。根拠扱いしない）</p>' + (ev ? '<ul>' + ev + '</ul>' : '<p class="muted">なし</p>') +
      (p.meeting_reason ? '<p><b>会議の理由</b> ' + esc(p.meeting_reason) + '</p>' : '') +
      (p.status === 'adopted' && p.material_id ? '<p><a href="#/material/' + esc(p.material_id) + '">作った素材を見る</a></p>' : '') +
      (p.status === 'dismissed' && p.decision_note ? '<p><b>見送りの理由</b> ' + esc(p.decision_note) + '</p>' : '') +
      (p.status === 'proposed' ? '<div class="row end"><button type="button" class="btn" id="dismiss-btn">見送る</button><button type="button" class="btn primary" id="adopt-btn">素材にする</button></div>' : '') +
      '</div>';
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    var db = $('#dismiss-btn');
    if (db) db.addEventListener('click', function () {
      action(db, {
        title: 'この提案を見送ります', body: p.title, note: true, noteLabel: '理由（必須）', okText: '見送る',
        run: function (note) { return api('POST', '/api/proposals/' + encodeURIComponent(p.id) + '/dismiss', { note: note }); },
        success: '見送りました'
      });
    });
    var ab = $('#adopt-btn');
    if (ab) ab.addEventListener('click', function () { openAdopt(p, ab); });
  }

  /** 「素材にする」ダイアログ（予告）→ 実行（二重送信防止）→ トースト → 再取得。失敗時は入力を残す */
  function openAdopt(p, srcBtn) {
    var dlg = $('#adopt-dlg');
    $('#adopt-src').textContent = '提案: ' + p.title;
    $('#a-title').value = p.title;
    $('#a-slug').value = '';
    $('#a-catalog').value = p.catalog_item_id || '';
    var kinds = p.kinds || [];
    $('#a-k3').checked = kinds.indexOf(3) >= 0 || kinds.indexOf(4) < 0;
    $('#a-k4').checked = kinds.indexOf(4) >= 0;
    var conceptLine = p.concept_codes && p.concept_codes.length ? '\n\nつながる概念: ' + p.concept_codes.join(', ') : '';
    var ageLine = p.age_band ? '\n年齢帯: ' + (AGE_LABEL[p.age_band] || p.age_band) : '';
    $('#a-brief').value = p.title + '\n\n' + p.body + conceptLine + ageLine;
    $('#a-pii').checked = false;
    var errEl = $('#a-err');
    errEl.classList.add('hidden');
    var ok = $('#a-ok'), cancel = $('#a-cancel');
    function close() { ok.removeEventListener('click', onOk); cancel.removeEventListener('click', onCancel); dlg.removeEventListener('cancel', onCancel); dlg.close(); }
    function onCancel(e) { if (e && e.preventDefault) e.preventDefault(); if (!ok.disabled) close(); }
    function onOk() {
      var k = [];
      if ($('#a-k3').checked) k.push(3);
      if ($('#a-k4').checked) k.push(4);
      var problems = [];
      if (!$('#a-title').value.trim()) problems.push('題名');
      if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test($('#a-slug').value)) problems.push('slug');
      if (!k.length) problems.push('型');
      if (!$('#a-brief').value.trim()) problems.push('注文票');
      if (!$('#a-pii').checked) problems.push('個人情報の確認');
      if (problems.length) { errEl.textContent = '確認してください: ' + problems.join('、'); errEl.classList.remove('hidden'); return; }
      errEl.classList.add('hidden');
      var body = {
        title: $('#a-title').value.trim(), slug: $('#a-slug').value, catalog_item_id: $('#a-catalog').value.trim() || null,
        kinds: k, concept_codes: [], kind: 'draft', parent_version_id: null, brief_md: $('#a-brief').value, no_personal_data: true
      };
      ok.disabled = true; cancel.disabled = true; ok.textContent = '実行中…';
      api('POST', '/api/proposals/' + encodeURIComponent(p.id) + '/adopt', body).then(function (res) {
        close();
        toast('素材にしました。職人に注文しました');
        if (res && res.start_error) toast('注文は受け付けました。起動は後で行います: ' + (ERROR_TEXT[res.start_error] || res.start_error));
        if (res && res.job_id) location.hash = '#/job/' + res.job_id; else route();
      }, function (e) {
        errEl.textContent = e.message || '失敗しました'; errEl.classList.remove('hidden');
        toast(e.message || '失敗しました', true);
        if (e.status === 409 && e.body && e.body.error === 'not_proposed') { close(); route(); }
      }).then(function () { ok.disabled = false; cancel.disabled = false; ok.textContent = '素材にする'; });
    }
    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
    dlg.addEventListener('cancel', onCancel);
    dlg.showModal();
    $('#a-slug').focus();
    void srcBtn;
  }

  function bindManualForm() {
    var form = $('#p-form');
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var errEl = $('#p-err');
      var concepts = $('#p-concepts').value.split(/[,、\s]+/).map(function (x) { return x.trim(); }).filter(Boolean);
      var evidence = $('#p-evidence').value.split(/\n/).map(function (x) { return x.trim(); }).filter(Boolean);
      var k = [];
      if ($('#p-k3').checked) k.push(3);
      if ($('#p-k4').checked) k.push(4);
      var problems = [];
      if (!$('#p-title').value.trim()) problems.push('題名');
      if (!$('#p-body').value.trim()) problems.push('本文');
      if (concepts.some(function (c) { return !/^[A-Z0-9]{2,12}$/.test(c); })) problems.push('概念のコード（英大文字と数字 2〜12 文字）');
      if (evidence.length > 10 || evidence.some(function (u) { return !/^https:\/\/\S+$/.test(u); })) problems.push('根拠 URL（https のみ・10 件まで）');
      if (problems.length) { errEl.textContent = '確認してください: ' + problems.join('、'); errEl.classList.remove('hidden'); return; }
      errEl.classList.add('hidden');
      var body = { title: $('#p-title').value.trim(), body: $('#p-body').value.trim(), concept_codes: concepts, kinds: k, evidence: evidence.map(function (u) { return { url: u }; }) };
      if ($('#p-age').value) body.age_band = $('#p-age').value;
      action($('#p-submit'), {
        title: '提案箱に足します', body: body.title, okText: '足す',
        run: function () { return api('POST', '/api/proposals', body); },
        success: '提案箱に足しました',
        after: function (res) { if (!res) return; form.reset(); location.hash = '#/proposals?status=proposed'; route(); }
      });
    });
  }

  function loadMinutes() {
    api('GET', '/api/meeting/latest').then(function (d) {
      var el = $('#minutes');
      if (!el) return;
      if (!d.meeting || !d.meeting.minutes) { el.innerHTML = ''; return; }
      var m = d.meeting.minutes, v = m.views || {};
      var label = { research: '研究', pedagogy: '教え方', expression: '表現', verification: '検証' };
      el.innerHTML = '<div class="card"><h2>最新の会議 <span class="muted">' + esc(fmtTime(d.meeting.ended_at)) + '</span></h2>' +
        ['research', 'pedagogy', 'expression', 'verification'].map(function (k) { return '<p><b>' + label[k] + '</b> ' + esc(v[k] || '') + '</p>'; }).join('') +
        '<h3>編集基準への提案</h3><p class="muted">採用する時は「編集基準」画面で追記してください（自動では追記しません）。</p>' +
        ((m.standards_suggestions || []).length ? '<ul>' + m.standards_suggestions.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '<p class="muted">なし</p>') +
        '</div>';
    }, function () { /* 会議の表示は補助。失敗しても一覧は使える */ });
  }

  // ---- 画面: 素材一覧 ----
  function viewMaterials(view, q) {
    var work = q.work || '', publish = q.publish || '';
    view.innerHTML = '<h1>素材</h1><div id="your-turn"></div><div class="card"><div class="row">' +
      '<label>配信 <select id="f-publish"><option value="">すべて</option><option value="none">なし</option><option value="available">利用できる</option><option value="stopped">止めている</option></select></label>' +
      '<label>制作 <select id="f-work"><option value="">すべて</option><option value="idle">待機</option><option value="queued">順番待ち</option><option value="making">制作中</option><option value="review">確認待ち</option></select></label>' +
      '<a class="btn primary" href="#/new">新しい素材</a></div></div><div id="list" class="card loading">読み込み中…</div>';
    $('#f-publish').value = publish;
    $('#f-work').value = work;
    function apply() {
      var p = [];
      if ($('#f-publish').value) p.push('publish=' + encodeURIComponent($('#f-publish').value));
      if ($('#f-work').value) p.push('work=' + encodeURIComponent($('#f-work').value));
      location.hash = '#/materials' + (p.length ? '?' + p.join('&') : '');
    }
    $('#f-publish').addEventListener('change', apply);
    $('#f-work').addEventListener('change', apply);
    var qs = [];
    if (work) qs.push('work=' + encodeURIComponent(work));
    if (publish) qs.push('publish=' + encodeURIComponent(publish));
    api('GET', '/api/materials' + (qs.length ? '?' + qs.join('&') : '')).then(function (d) {
      var list = $('#list');
      list.classList.remove('loading');
      var yt = $('#your-turn');
      if (yt && !work && !publish) yt.innerHTML = yourTurnHtml(d.materials);
      if (!d.materials.length) { list.innerHTML = '<p class="muted">素材はまだありません。「新しい素材」から注文できます。</p>'; return; }
      list.innerHTML = '<div class="table-wrap"><table><thead><tr><th>タイトル</th><th>slug</th><th>型</th><th>配信</th><th>制作</th><th>現在版</th><th>job</th></tr></thead><tbody>' +
        d.materials.map(function (m) {
          return '<tr><td><a href="#/material/' + esc(m.id) + '">' + esc(m.title) + '</a></td><td>' + esc(m.slug) + '</td><td>' + esc((m.kinds || []).join(', ')) + '</td>' +
            '<td>' + pill(PUBLISH_LABEL[m.publish_status] || m.publish_status, m.publish_status === 'available' ? 'green' : m.publish_status === 'stopped' ? 'red' : 'gray') + '</td>' +
            '<td>' + pill(WORK_LABEL[m.work_status] || m.work_status, m.work_status === 'review' ? 'orange' : '') + '</td>' +
            '<td>' + (m.current_version ? 'v' + esc(m.current_version.version) : '—') + '</td>' +
            '<td data-job-cell="' + esc(m.id) + '">' + (m.active_job ? '<a href="#/job/' + esc(m.active_job.id) + '">' + esc(JOB_LABEL[m.active_job.status] || m.active_job.status) + '</a>' : '—') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
      markAutoRework(d.materials);
    }, function (e) { $('#list').innerHTML = '<p class="err">読み込めませんでした: ' + esc(e.message) + '</p>'; });
  }

  /** 素材一覧の先頭「あなたの番」: 質問への回答待ち・確認待ちの素材。0 件なら空（カードを出さない） */
  function yourTurnHtml(materials) {
    var rows = [];
    (materials || []).forEach(function (m) {
      if (m.active_job && m.active_job.status === 'needs_answer') {
        rows.push('<li class="yt-item"><span class="yt-title">' + esc(m.title) + '</span><a class="btn primary small" href="#/job/' + esc(m.active_job.id) + '">職人の質問に答える</a></li>');
      }
      // 一覧の応答には確認待ちの版 id が無いので、確認待ち一覧（#/review）へ案内する
      if (m.work_status === 'review') rows.push('<li class="yt-item"><span class="yt-title">' + esc(m.title) + '</span><a class="btn small" href="#/review">確認する</a></li>');
    });
    return rows.length ? '<div class="card yt"><h2>あなたの番</h2><ul class="yt-list">' + rows.join('') + '</ul></div>' : '';
  }

  // ---- 画面: 新しい素材 ----
  function viewNew(view) {
    view.innerHTML = '<h1>新しい素材</h1><form id="new-form" class="card">' +
      '<label class="field"><span>タイトル</span><input type="text" id="n-title" maxlength="200" required></label>' +
      '<label class="field"><span>slug（英小文字・数字・ハイフン）</span><input type="text" id="n-slug" maxlength="80" placeholder="mc-redstone-basics" required></label>' +
      '<label class="field"><span>カタログ id（任意）</span><input type="text" id="n-catalog" maxlength="80" placeholder="mc-redstone"></label>' +
      '<div class="field"><span>型</span><label class="check"><input type="checkbox" id="n-k3" checked> 型 3（説明と図解）</label><label class="check"><input type="checkbox" id="n-k4"> 型 4（動かせるもの）</label></div>' +
      '<label class="field"><span>注文票（brief）</span><textarea id="n-brief" rows="10" required></textarea></label>' +
      '<label class="check"><input type="checkbox" id="n-pii"> 子どもや家庭の個人情報を含んでいません</label>' +
      '<p id="n-err" class="err hidden"></p>' +
      '<div class="row end"><button type="submit" class="btn primary" id="n-submit">注文する</button></div></form>';
    var form = $('#new-form');
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var errEl = $('#n-err');
      var kinds = [];
      if ($('#n-k3').checked) kinds.push(3);
      if ($('#n-k4').checked) kinds.push(4);
      var problems = [];
      if (!$('#n-title').value.trim()) problems.push('タイトル');
      if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test($('#n-slug').value)) problems.push('slug');
      if (!kinds.length) problems.push('型');
      if (!$('#n-brief').value.trim()) problems.push('注文票');
      if (!$('#n-pii').checked) problems.push('個人情報の確認');
      if (problems.length) { errEl.textContent = '確認してください: ' + problems.join('、'); errEl.classList.remove('hidden'); return; }
      errEl.classList.add('hidden');
      var body = {
        title: $('#n-title').value.trim(), slug: $('#n-slug').value, catalog_item_id: $('#n-catalog').value.trim() || null,
        kinds: kinds, concept_codes: [], kind: 'draft', parent_version_id: null, brief_md: $('#n-brief').value, no_personal_data: true
      };
      action($('#n-submit'), {
        title: 'この内容で職人に注文します', body: body.title + '（' + body.slug + '）',
        okText: '注文する',
        run: function () { return api('POST', '/api/materials', body); },
        success: '注文しました',
        after: function (res) {
          if (!res) return;
          if (res.start_error) toast('注文は受け付けました。起動は後で行います: ' + (ERROR_TEXT[res.start_error] || res.start_error));
          form.reset();
          location.hash = '#/job/' + res.job_id;
        }
      });
    });
  }

  // ---- 画面: 素材詳細 ----
  function viewMaterial(view, id) {
    view.innerHTML = '<p class="loading">読み込み中…</p>';
    api('GET', '/api/materials/' + encodeURIComponent(id)).then(function (d) {
      var m = d.material;
      // stop 中は現在の版も選べる（同じ版で配信を再開できる）
      var approved = d.versions.filter(function (v) { return v.status === 'approved' && (v.id !== m.current_version_id || m.publish_status === 'stopped'); });
      view.innerHTML = '<h1>' + esc(m.title) + '</h1>' +
        '<div class="card"><div class="row">' + pill('配信: ' + (PUBLISH_LABEL[m.publish_status] || m.publish_status), m.publish_status === 'available' ? 'green' : 'gray') +
        pill('制作: ' + (WORK_LABEL[m.work_status] || m.work_status)) + (autoReworkJob(d) ? pill('自動で作り直し中', 'yellow') : '') + '<span class="muted">slug ' + esc(m.slug) + ' / 型 ' + esc((m.kinds || []).join(', ')) + '</span></div>' +
        '<div class="row" id="pub-actions">' +
        (m.publish_status === 'available' ? '<button type="button" class="btn danger" id="stop-btn">配信を止める</button>' : '') +
        (approved.length ? '<select id="rb-select">' + approved.map(function (v) { return '<option value="' + esc(v.id) + '">v' + esc(v.version) + '（' + esc(fmtTime(v.created_at)) + '）</option>'; }).join('') + '</select><button type="button" class="btn" id="rb-btn">前の版へ戻す</button>' : '') +
        (m.work_status === 'idle' ? '<button type="button" class="btn" id="improve-btn">改善 job を注文する</button>' : '') +
        '</div></div>' +
        '<div class="card"><h2>版</h2>' + (d.versions.length ? '<div class="table-wrap"><table><thead><tr><th>版</th><th>状態</th><th>検証</th><th>費用</th><th>作成</th></tr></thead><tbody>' +
          d.versions.map(function (v) {
            return '<tr><td>' + (v.status === 'review' ? '<a href="#/review/' + esc(v.id) + '">v' + esc(v.version) + '</a>' : '<a href="#/review/' + esc(v.id) + '">v' + esc(v.version) + '</a>') + (v.id === m.current_version_id ? ' ' + pill('現在', 'green') : '') + '</td><td>' + esc(v.status) + '</td><td>' + esc(v.verification_status) + '</td><td>' + fmtCents(v.list_cost_cents) + '</td><td>' + esc(fmtTime(v.created_at)) + '</td></tr>';
          }).join('') + '</tbody></table></div>' : '<p class="muted">まだ版はありません</p>') + '</div>' +
        '<div class="card"><h2>job</h2>' + (d.jobs.length ? '<div class="table-wrap"><table><thead><tr><th>種類</th><th>状態</th><th>費用</th><th>エラー</th><th>作成</th></tr></thead><tbody>' +
          d.jobs.map(function (j) {
            return '<tr><td><a href="#/job/' + esc(j.id) + '">' + esc(j.kind) + '</a></td><td>' + esc(JOB_LABEL[j.status] || j.status) + '</td><td>' + fmtCents(j.list_cost_cents) + '</td><td>' + esc(j.error || j.last_error || '') + '</td><td>' + esc(fmtTime(j.created_at)) + '</td></tr>';
          }).join('') + '</tbody></table></div>' : '<p class="muted">job はありません</p>') + '</div>' +
        '<div class="card"><h2>確認の記録</h2>' + (d.review_decisions.length ? '<ul class="decisions">' + d.review_decisions.map(function (r) {
          if (r.reviewer_email === AUTO_REVIEWER) {
            return '<li data-auto-decision="1">' + esc(fmtTime(r.created_at)) + ' ' + pill('自動の差し戻し', 'yellow') +
              (r.note ? '<details><summary>理由を見る</summary><p class="pre">' + esc(r.note) + '</p></details>' : '') + '</li>';
          }
          return '<li>' + esc(fmtTime(r.created_at)) + ' ' + esc(DECISION_LABEL[r.decision] || r.decision) + ' ' + esc(r.reviewer_email) + (r.note ? ' — ' + esc(r.note) : '') + '</li>';
        }).join('') + '</ul>' : '<p class="muted">記録はありません</p>') + '</div>' +
        '<p class="muted">素材の削除・編集はこの版では提供していません（契約の範囲外）。</p>';
      var stop = $('#stop-btn');
      if (stop) stop.addEventListener('click', function () {
        action(stop, {
          title: '配信を止めます', body: '停止後の新しい取得を拒否します。既に届いた内容の回収はしません。制作中の job は続きます。',
          note: true, noteLabel: '理由（必須）', okText: '止める',
          run: function (note) { return api('POST', '/api/materials/' + encodeURIComponent(id) + '/stop', { note: note }); },
          success: '配信を止めました'
        });
      });
      var rb = $('#rb-btn');
      if (rb) rb.addEventListener('click', function () {
        var vid = $('#rb-select').value;
        action(rb, {
          title: '選んだ版で配信します', body: '現在の版を選んだ承認済みの版に付け替え、配信を「利用できる」にします。',
          note: true, noteLabel: '理由（必須）', okText: '戻す',
          run: function (note) { return api('POST', '/api/materials/' + encodeURIComponent(id) + '/rollback', { version_id: vid, note: note }); },
          success: '前の版へ戻しました'
        });
      });
      var imp = $('#improve-btn');
      if (imp) imp.addEventListener('click', function () {
        action(imp, {
          title: '改善 job を注文します', body: '子どもや家庭の個人情報を含んでいないことを確認してから実行してください。配信中の版はそのまま配信されます。',
          note: true, noteLabel: '注文票（空なら最初の注文票を使う）', noteRequired: false, okText: '注文する',
          run: function (note) { return api('POST', '/api/jobs', { material_id: id, kind: 'rework', brief_md: note || null, no_personal_data: true }); },
          success: '注文しました',
          after: function (res) { if (res) location.hash = '#/job/' + res.job_id; }
        });
      });
    }, function (e) { view.innerHTML = '<p class="err">読み込めませんでした: ' + esc(e.message) + '</p>'; });
  }

  // ---- 画面: job（職人の質問に答える）----
  // 状態: input（needs_answer かつ answer_state=none）/ resend（needs_answer のまま saved・sending）/ readonly（それ以外で質問あり）/ none（質問なし）
  var KIND_TEXT = { draft: '新しく作る', rework: '作り直し' };
  var ANSWER_NOTICE = '回答は編集基準のログにも残ります。子どもや家庭の個人情報を含めないでください。';
  var ACTIVE_JOB_STATUSES = ['queued', 'creating', 'running', 'needs_answer', 'budget_reached'];
  var DRAFT_PREFIX = 'fa-answer-draft:';

  /** 下書き（{ [question_id]: { mode: 'default'|'own', text } }）。読み書きの失敗は無視して画面は動かす */
  function loadAnswerDraft(jobId, qs) {
    var raw = null;
    try { raw = JSON.parse(window.localStorage.getItem(DRAFT_PREFIX + jobId) || 'null'); } catch (e) { raw = null; }
    var out = {};
    if (!raw || typeof raw !== 'object') return out;
    qs.forEach(function (q) {
      var e = raw[q.id];
      if (!e || typeof e !== 'object') return;
      var mode = e.mode === 'default' || e.mode === 'own' ? e.mode : null;
      out[q.id] = { mode: mode, text: typeof e.text === 'string' ? e.text : '' };
    });
    return out;
  }
  function saveAnswerDraft(jobId, draft) { try { window.localStorage.setItem(DRAFT_PREFIX + jobId, JSON.stringify(draft)); } catch (e) { /* 保存できなくても入力は続けられる */ } }
  function clearAnswerDraft(jobId) { try { window.localStorage.removeItem(DRAFT_PREFIX + jobId); } catch (e) { /* 無視 */ } }

  function defaultText(q) { return q && q['default'] !== null && q['default'] !== undefined ? String(q['default']) : ''; }
  /** 1 問の下書き → 送る答え。案を選んだ問は default の全文、自分で答えた問は trim 後の値。未回答は null */
  function draftAnswer(q, e) {
    if (!e) return null;
    if (e.mode === 'default') return defaultText(q).trim() ? defaultText(q) : null;
    if (e.mode === 'own') { var t = String(e.text || '').trim(); return t ? t : null; }
    return null;
  }
  function answerProgress(qs, draft) {
    var answers = [], done = 0;
    qs.forEach(function (q) {
      var a = draftAnswer(q, draft[q.id]);
      if (a !== null) done++;
      answers.push({ question_id: q.id, answer: a });
    });
    return { total: qs.length, done: done, complete: qs.length > 0 && done === qs.length, answers: answers };
  }
  function answerMode(j) {
    if (!(j.questions || []).length) return 'none';
    if (j.status !== 'needs_answer') return 'readonly';
    if (!j.answer_state || j.answer_state === 'none') return 'input';
    if (j.answer_state === 'saved' || j.answer_state === 'sending') return 'resend';
    return 'readonly';
  }
  function savedAnswerOf(j, qid) {
    var a = (j.answers || []).filter(function (x) { return x && x.question_id === qid; })[0];
    return a && typeof a.answer === 'string' ? a.answer : null;
  }

  function questionCardHtml(q, i, mode, j, entry) {
    var answered = mode === 'input' ? draftAnswer(q, entry) !== null : savedAnswerOf(j, q.id) !== null;
    var html = '<section class="card aq-card' + (answered ? ' is-done' : '') + '" data-aq-i="' + i + '" aria-labelledby="aq-q-' + i + '">' +
      '<div class="aq-head"><span class="aq-num" aria-hidden="true">' + (i + 1) + '</span>' +
      '<p class="aq-q" id="aq-q-' + i + '"><span class="sr-only">質問 ' + (i + 1) + ': </span>' + esc(q.question) + '</p>' +
      '<span class="pill green aq-done' + (answered ? '' : ' hidden') + '">回答済み</span></div><div class="aq-body">' +
      (q.why ? '<div class="aq-why"><span class="aq-label">聞く理由</span><p>' + esc(q.why) + '</p></div>' : '');
    if (mode === 'input') {
      var mine = entry && entry.mode, hasDefault = !!defaultText(q).trim();
      html += '<div class="aq-opts" role="radiogroup" aria-labelledby="aq-q-' + i + '">' +
        '<label class="aq-opt' + (mine === 'default' ? ' is-on' : '') + '"><input type="radio" name="aq-' + i + '" value="default"' + (mine === 'default' ? ' checked' : '') + (hasDefault ? '' : ' disabled') + '>' +
        '<span class="aq-opt-body"><span class="aq-opt-title">職人の案でいい</span><span class="aq-opt-text">' + (hasDefault ? esc(defaultText(q)) : '（案はありません）') + '</span></span></label>' +
        '<label class="aq-opt' + (mine === 'own' ? ' is-on' : '') + '"><input type="radio" name="aq-' + i + '" value="own"' + (mine === 'own' ? ' checked' : '') + '>' +
        '<span class="aq-opt-body"><span class="aq-opt-title">自分で答える</span></span></label>' +
        '<div class="aq-own' + (mine === 'own' ? '' : ' hidden') + '"><textarea rows="4" placeholder="答えを書いてください" aria-label="質問 ' + (i + 1) + ' への答え">' + esc(entry && entry.text ? entry.text : '') + '</textarea></div>' +
        '</div>';
    } else {
      var saved = savedAnswerOf(j, q.id);
      html += '<div class="aq-answer"><span class="aq-label">あなたの回答</span>' + (saved !== null ? '<p>' + esc(saved) + '</p>' : '<p class="muted">回答はありません</p>') + '</div>';
    }
    return html + '</div></section>';
  }

  function jobAlertHtml(j) {
    var lines = [];
    if (j.status === 'budget_reached') lines.push('上限に達しました（Worker からは増額しません）');
    if (j.error) lines.push('エラー: ' + j.error);
    if (j.last_error) lines.push('最後のエラー: ' + j.last_error);
    return lines.length ? '<div class="aq-alert" role="alert">' + lines.map(function (l) { return '<p>' + esc(l) + '</p>'; }).join('') + '</div>' : '';
  }

  function jobDetailHtml(j, open) {
    var active = ACTIVE_JOB_STATUSES.indexOf(j.status) >= 0;
    var canReingest = j.status === 'failed' && j.error === 'invalid_outputs';
    return '<details class="card rv-sec" id="job-detail"' + (open ? ' open' : '') + '><summary><h2>作業の詳細</h2></summary>' +
      '<div class="row">' + pill(JOB_LABEL[j.status] || j.status, j.status === 'failed' ? 'red' : j.status === 'done' ? 'green' : 'orange') +
      '<span class="muted">' + esc(j.kind) + ' / ' + esc(j.model) + ' / 段階 ' + esc(j.phase) + '</span>' +
      (j.console_url ? '<a href="' + esc(j.console_url) + '" target="_blank" rel="noopener noreferrer">Console</a>' : '') + '</div>' +
      '<p>費用 ' + fmtCents(j.list_cost_cents) + ' / 拒否した操作 ' + esc(j.deny_count) + ' 件 / 最終確認 ' + esc(fmtTime(j.last_checked_at)) + '</p>' +
      '<div class="row">' +
      (j.status === 'queued' ? '<button type="button" class="btn primary" id="start-btn">起動する</button>' : '') +
      (active && j.session_id ? '<button type="button" class="btn" id="rec-btn">状態を取り込む</button>' : '') +
      (active ? '<button type="button" class="btn danger" id="cancel-btn">取り消す</button>' : '') +
      (canReingest ? '<button type="button" class="btn primary" id="reingest-btn">取り込みをやり直す</button>' : '') +
      '<button type="button" class="btn" id="reload-btn">再読み込み</button></div></details>';
  }

  function jobHtml(j, mode, draft) {
    var qs = j.questions || [];
    var kind = KIND_TEXT[j.kind] || j.kind || '—';
    var state = JOB_LABEL[j.status] || j.status;
    var head;
    if (mode === 'input') head = '<h1>職人からの質問（' + qs.length + ' 問）</h1><p class="aq-lead">答えると、職人が制作を始めます。<span class="muted">注文の種類: ' + esc(kind) + '</span></p>';
    else if (mode === 'resend') head = '<h1>職人からの質問（' + qs.length + ' 問）</h1><p class="aq-lead"><span class="muted">注文の種類: ' + esc(kind) + '</span></p>';
    else if (mode === 'readonly') head = '<h1>職人からの質問（' + qs.length + ' 問）</h1><p class="aq-lead">状態: ' + esc(state) + '<span class="muted">注文の種類: ' + esc(kind) + '</span></p>';
    else head = '<h1>注文の状況</h1><p class="aq-lead">状態: ' + esc(state) + '<span class="muted">注文の種類: ' + esc(kind) + '</span></p>';
    var foot = '';
    if (mode === 'input') {
      foot = '<div class="rv-foot" id="aq-foot"><div class="row rv-foot-row"><span id="aq-progress" aria-live="polite"></span>' +
        '<div class="rv-btns aq-btns"><span class="muted" id="aq-left"></span><button type="button" class="btn primary" id="ans-btn" disabled>回答を送って制作を始める</button></div></div></div>';
    } else if (mode === 'resend') {
      foot = '<div class="rv-foot" id="aq-foot"><div class="row rv-foot-row"><span>回答は保存済みです</span>' +
        '<div class="rv-btns aq-btns"><button type="button" class="btn primary" id="ans-btn">もう一度送る</button></div></div></div>';
    }
    return '<p class="aq-crumb"><a href="#/material/' + esc(j.material_id) + '" id="job-crumb">素材へ</a></p>' + head + jobAlertHtml(j) +
      (mode === 'resend' ? '<div class="aq-note">回答は保存済みです。送信が終わっていません</div>' : '') +
      (qs.length ? '<form id="ans-form" class="aq-list" novalidate>' + qs.map(function (q, i) { return questionCardHtml(q, i, mode, j, draft[q.id]); }).join('') + '</form>' : '') +
      '<details class="card rv-sec" id="job-brief"><summary><h2>注文票を見る</h2></summary>' + renderMd(j.brief_md) + '</details>' +
      jobDetailHtml(j, mode === 'none') + foot;
  }

  function bindJobActions(id) {
    $('#reload-btn').addEventListener('click', function () { route(); });
    var start = $('#start-btn');
    if (start) start.addEventListener('click', function () {
      action(start, { title: '職人の作業場を起動します', run: function () { return api('POST', '/api/jobs/' + encodeURIComponent(id) + '/start'); }, success: '起動しました' });
    });
    var rec = $('#rec-btn');
    if (rec) rec.addEventListener('click', function () {
      action(rec, { title: '状態を取り込みます', body: '職人の作業場の状態を読み、必要なら成果物を取り込みます。', run: function () { return api('POST', '/api/jobs/' + encodeURIComponent(id) + '/reconcile'); }, success: '取り込みました' });
    });
    var reingest = $('#reingest-btn');
    if (reingest) reingest.addEventListener('click', function () {
      action(reingest, {
        title: '取り込みをやり直します', body: '職人の成果物をそのまま取り込み直します（session は作りません）', okText: '取り込み直す',
        run: function () { return api('POST', '/api/jobs/' + encodeURIComponent(id) + '/reingest'); },
        success: '取り込みをやり直しました',
        after: function (res) {
          if (res && res.status === 'done') toast('取り込み直しました。確認待ちに出ています');
          else if (res && res.status === 'failed') toast('取り込み直しましたが、また失敗しました（エラーを確認してください）', true);
          else if (res) toast('取り込み直しを始めました（続きは自動で進みます: ' + (JOB_LABEL[res.status] || res.status || '') + '）');
          route();
        }
      });
    });
    var cancel = $('#cancel-btn');
    if (cancel) cancel.addEventListener('click', function () {
      action(cancel, { title: 'この job を取り消します', body: '作業場は止まり、元に戻せません。', okText: '取り消す', run: function () { return api('POST', '/api/jobs/' + encodeURIComponent(id) + '/cancel'); }, success: '取り消しました' });
    });
  }

  function sendAnswers(id, btn, title, answers) {
    action(btn, {
      title: title, body: ANSWER_NOTICE, busyText: '送信中…',
      run: function () { return api('POST', '/api/jobs/' + encodeURIComponent(id) + '/answer', { answers: answers }); },
      success: '回答を送りました。職人が制作を始めます',
      after: function () { clearAnswerDraft(id); route(); },
      fail: function () { route(); } // 409 answer_in_flight / not_waiting 等は toast の後に読み直す（下書きは残す）
    });
  }

  function bindAnswerInputs(view, id, qs, draft) {
    var btn = $('#ans-btn');
    function refresh() {
      var p = answerProgress(qs, draft);
      $('#aq-progress').textContent = p.total + ' 問中 ' + p.done + ' 問に答えました';
      $('#aq-left').textContent = p.complete ? '' : 'あと ' + (p.total - p.done) + ' 問';
      btn.disabled = !p.complete;
      qs.forEach(function (q, i) {
        var card = view.querySelector('[data-aq-i="' + i + '"]');
        var done = draftAnswer(q, draft[q.id]) !== null;
        card.classList.toggle('is-done', done);
        card.querySelector('.aq-done').classList.toggle('hidden', !done);
      });
      return p;
    }
    qs.forEach(function (q, i) {
      var card = view.querySelector('[data-aq-i="' + i + '"]');
      var radios = card.querySelectorAll('input[type=radio]');
      var own = card.querySelector('.aq-own'), ta = own.querySelector('textarea');
      var byArrow = false;
      function entry() { return draft[q.id] || (draft[q.id] = { mode: null, text: '' }); }
      Array.prototype.forEach.call(radios, function (r) {
        // 矢印キーで選んだ時は textarea へ移らない（radio の間を矢印で行き来できるように）
        r.addEventListener('keydown', function (e) { if (/^Arrow/.test(e.key)) { byArrow = true; setTimeout(function () { byArrow = false; }, 0); } });
        r.addEventListener('change', function () {
          if (!r.checked) return;
          entry().mode = r.value;
          Array.prototype.forEach.call(radios, function (x) { x.parentNode.classList.toggle('is-on', x.checked); });
          own.classList.toggle('hidden', r.value !== 'own');
          saveAnswerDraft(id, draft);
          refresh();
          if (r.value === 'own' && !byArrow) ta.focus();
        });
      });
      ta.addEventListener('input', function () { entry().text = ta.value; saveAnswerDraft(id, draft); refresh(); });
    });
    $('#ans-form').addEventListener('submit', function (ev) { ev.preventDefault(); });
    btn.addEventListener('click', function () {
      var p = refresh();
      if (!p.complete) return;
      sendAnswers(id, btn, '回答を送って制作を始めます', p.answers);
    });
    refresh();
  }

  function viewJob(view, id) {
    view.innerHTML = '<p class="loading">読み込み中…</p>';
    api('GET', '/api/jobs/' + encodeURIComponent(id)).then(function (d) {
      var j = d.job;
      var qs = j.questions || [];
      var mode = answerMode(j);
      // 素材のタイトルはパンくずに後から入れる（失敗したら「素材へ」のまま）
      var mid = String(j.material_id || '');
      if (mid) api('GET', '/api/materials/' + encodeURIComponent(mid)).then(function (md) {
        var a = $('#job-crumb');
        if (a && a.getAttribute('href') === '#/material/' + mid && md && md.material && md.material.title) a.textContent = '← 素材: ' + md.material.title;
      }, function () { /* 補助の表示 */ });
      var draft = mode === 'input' ? loadAnswerDraft(id, qs) : {};
      if (qs.length && mode !== 'input') clearAnswerDraft(id); // 回答は保存済み（answer_state は none に戻らない）
      view.innerHTML = jobHtml(j, mode, draft);
      document.body.classList.toggle('has-foot', mode === 'input' || mode === 'resend');
      bindJobActions(id);
      if (mode === 'input') bindAnswerInputs(view, id, qs, draft);
      else if (mode === 'resend') {
        var rb = $('#ans-btn');
        rb.addEventListener('click', function () {
          sendAnswers(id, rb, '保存済みの回答を送り直します', (j.answers || []).map(function (a) { return { question_id: a.question_id, answer: a.answer }; }));
        });
      }
    }, function (e) {
      view.innerHTML = '<p class="err">読み込めませんでした: ' + esc(e.message) + '</p><p><button type="button" class="btn" id="job-retry">もう一度読み込む</button></p>';
      var b = $('#job-retry');
      if (b) b.addEventListener('click', route);
    });
  }

  // ---- 確認画面（§L-6。§G-2 を置き換え）----
  // 描画と判定は純関数（reviewHtml / approveState / keyCommand / applyCommand）に寄せ、smoke から DOM の要素数を数えられるようにする（§L-7 (l5)）。
  var CAUSE_TEXT = {
    contradicted: '出典と食い違う',
    maker_url_not_fetched: '職人がこの URL を開けていない',
    quote_mismatch: '引用が出典の本文と一致しない',
    verifier_limit: '検証係が開ききれなかった（取得の上限）',
    not_confirmed: '出典で確かめられなかった',
    no_source: '出典が付いていない',
    source_not_listed: '出典一覧にない出典',
    license_unknown: '利用条件が分からない'
  };
  var CK_LABEL = {};
  CHECKLIST.forEach(function (c) { CK_LABEL[c[0]] = c[1]; });
  var HUMAN_KEYS = ['explanation_and_expression', 'relation_to_learning', 'conditions_of_use'];
  var AUTO_KEYS = ['content_and_evidence', 'artifact_behavior', 'terms_of_use'];
  var AUTO_HINT = {
    content_and_evidence: '機械と検証係では確かめきれませんでした（上の「要確認」を見てください）',
    artifact_behavior: '機械検査に赤印があります（下の「詳細」を見てください）',
    terms_of_use: '利用条件が分からない出典があります'
  };
  var WAIT_TEXT = { paused: '検証待ち（停止中）', daily_cap: '検証待ち（日次上限）', inflight: '検証待ち（順番）' };
  var IMAGE_RE = /\.(svg|png|webp)$/i;
  var ACTIVE_JOB = ['queued', 'creating', 'running', 'needs_answer', 'budget_reached'];
  var DECISION_LABEL = { approve: '承認', 'return': '差し戻し', reject: '却下' };
  var AUTO_REVIEWER = 'system:auto-triage';

  /** triage（§L-3 の output）を読む。API が triage を返さない時は「仕分けなし」= 6 項目すべてを人が見る */
  function triageOf(d) {
    var t = d && d.triage;
    if (!t || typeof t !== 'object') {
      return { present: false, auto: {}, groups: [], ok_counts: { claims: (d && d.claims || []).length, sources: (d && d.sources || []).length }, needs_review: null, action: 'none', reasons: [] };
    }
    var groups = Array.isArray(t.groups) ? t.groups : [];
    return {
      present: true, auto: t.auto || {}, groups: groups, ok_counts: t.ok_counts || { claims: 0, sources: 0 },
      needs_review: typeof t.needs_review === 'number' ? t.needs_review : groups.length,
      action: t.action || 'none', reasons: t.reasons || [], verification_id: t.verification_id || null
    };
  }
  /** 人が答える項目: 人の 3 項目 + auto が review の項目（仕分けなしなら 6 項目すべて） */
  function reviewItems(tri) {
    return HUMAN_KEYS.concat(AUTO_KEYS.filter(function (k) { return tri.auto[k] !== 'ok'; }));
  }
  function autoOkKeys(tri) { return AUTO_KEYS.filter(function (k) { return tri.auto[k] === 'ok'; }); }
  function itemOptions(k) { return k === 'conditions_of_use' ? ['ok', 'ng', 'na'] : ['ok', 'ng']; }
  function imageFiles(mat) {
    var out = [];
    ((mat && mat.parts) || []).forEach(function (p) { (p.files || []).forEach(function (f) { if (f && IMAGE_RE.test(f.path || '')) out.push(f.path); }); });
    return out;
  }
  function newReviewState() { return { ck: {}, mode: null, note: '', append: '', draftShown: false }; }
  function hasDraft(st) { return !!((st.note || '').trim() || (st.append || '').trim()); }

  /** 検証の状態の文（§L-6 1.）。待ちの理由は API が版に verify_wait_reason を出す時だけ、または停止中が分かる時だけ付ける */
  function verifyState(v, status) {
    var vs = v.verification_status;
    if (vs === 'done') return { text: '検証済み', cls: 'green' };
    if (vs === 'failed') return { text: '検証できませんでした', cls: 'red' };
    var waiting = vs === 'pending' || (vs === 'running' && v.verify_phase === 'to_submit');
    if (vs === 'running' && !waiting) return { text: '検証中', cls: 'yellow' };
    if (waiting) {
      if (vs === 'running' && v.verify_wait_reason && WAIT_TEXT[v.verify_wait_reason]) return { text: WAIT_TEXT[v.verify_wait_reason], cls: 'gray' };
      if (vs === 'running' && status && status.paused) return { text: WAIT_TEXT.paused, cls: 'gray' };
      return { text: '検証待ち', cls: 'gray' };
    }
    return { text: String(vs || '—'), cls: 'gray' };
  }

  /** 承認できるか。why の target は該当箇所の要素 id（押すとスクロール） */
  function approveState(d, st) {
    var v = d.version || {}, tri = triageOf(d), why = [];
    if (v.status !== 'review') return { enabled: false, why: [{ text: '確認待ちの版ではありません', target: 'rv-band' }] };
    var items = reviewItems(tri);
    var missing = items.filter(function (k) { return !(st.ck[k] && st.ck[k].result); });
    var ng = items.filter(function (k) { return st.ck[k] && st.ck[k].result === 'ng'; });
    if (missing.length) why.push({ text: missing.map(function (k) { return CK_LABEL[k]; }).join('・') + ' を選ぶ', target: 'ck-' + missing[0] });
    if (ng.length) why.push({ text: 'NG があります（差し戻すか却下してください）', target: 'ck-' + ng[0] });
    if (v.verification_status !== 'done' || !d.verification_id) why.push({ text: '検証が終わるのを待つ', target: 'rv-band' });
    if (d.verification && d.verification.contradicted > 0) why.push({ text: '食い違いの主張がある（差し戻してください）', target: 'rv-groups' });
    if (tri.present && tri.action !== 'none') why.push({ text: tri.action === 'reverify' ? '自動の再検証を待っています' : '自動の差し戻しを待っています', target: 'rv-band' });
    return { enabled: why.length === 0, why: why };
  }

  /** decision に送る checklist。auto が ok の項目は省略する（§L-5）。差し戻し・却下は答えた項目だけ */
  function checklistPayload(d, st, forApprove) {
    var tri = triageOf(d), out = {}, n = 0;
    reviewItems(tri).forEach(function (k) {
      var c = st.ck[k];
      if (!c || !c.result) { if (forApprove) out[k] = { result: null, note: '' }; return; }
      out[k] = { result: c.result, note: c.result === 'ng' ? (c.note || '') : '' };
      n++;
    });
    return forApprove || n ? out : null;
  }

  /** キー → 命令（§L-6 キー）。env: { inInput, dialogOpen, busy, draft } */
  var SHIFT_DIGIT = { '!': 1, '@': 2, '"': 2, '#': 3 };
  function keyCommand(e, env) {
    if (!e || e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return null;
    if (env.inInput || env.dialogOpen || env.busy) return null;
    var key = e.key || '', code = e.code || '';
    var m = /^(?:Digit|Numpad)([1-3])$/.exec(code);
    var n = m ? Number(m[1]) : (/^[1-3]$/.test(key) ? Number(key) : 0);
    if (key === '?') return { cmd: 'help' };
    if (e.shiftKey) {
      if (!n && SHIFT_DIGIT[key]) n = SHIFT_DIGIT[key];
      return n ? { cmd: 'set', index: n - 1, result: 'ng' } : null;
    }
    if (n) return { cmd: 'set', index: n - 1, result: 'ok' };
    var k = key.toLowerCase();
    if (k === 'a') return { cmd: 'approve' };
    if (k === 'r') return { cmd: 'return' };
    if (k === 'x') return { cmd: 'reject' };
    if (k === 'j' || k === 'k') return env.draft ? { cmd: 'draft_block' } : { cmd: 'nav', dir: k === 'j' ? 1 : -1 };
    return null;
  }
  /** 状態だけを変える命令（set / draft_block）を適用する。他の命令は呼び出し側が実行する */
  function applyCommand(st, cmd) {
    if (!cmd) return st;
    if (cmd.cmd === 'set' && HUMAN_KEYS[cmd.index]) setItem(st, HUMAN_KEYS[cmd.index], cmd.result);
    if (cmd.cmd === 'draft_block') st.draftShown = true;
    return st;
  }
  function setItem(st, k, result) {
    var prev = st.ck[k] || { result: null, note: '' };
    st.ck[k] = { result: result, note: prev.note || '' };
  }

  function linkOrText(url) {
    if (!url) return '<span class="muted">なし</span>';
    return /^https?:\/\//.test(url) ? '<a class="pre" href="' + esc(url) + '" rel="noopener noreferrer" target="_blank">' + esc(url) + '</a>' : '<span class="pre">' + esc(url) + '</span>';
  }
  function groupHtml(g, i, d) {
    var claimById = {};
    (d.claims || []).forEach(function (c) { claimById[c.id] = c; });
    var src = (d.sources || []).filter(function (s) { return s.source_id === g.source_id; })[0];
    var opened = Array.isArray(g.verifier_opened_urls) ? g.verifier_opened_urls : [];
    var sameUrl = !!g.url && opened.length === 1 && opened[0] === g.url;
    var claimsHtml = (g.claim_ids || []).map(function (id) {
      var c = claimById[id] || { id: id };
      return '<li><b>' + esc(id) + '</b> ' + esc(c.text || '') + (c.verdict ? ' ' + pill(c.verdict, VERDICT_CLASS[c.verdict]) : '') +
        (c.reason ? '<div class="muted">検証係: ' + esc(c.reason) + '</div>' : '') + '</li>';
    }).join('');
    return '<div class="rv-group" data-rv-group="' + i + '" id="rv-group-' + i + '"><h3>' + esc(CAUSE_TEXT[g.cause] || g.cause) + '</h3>' +
      '<p>出典 <b>' + (g.source_id ? esc(g.source_id) : 'なし') + '</b>' + (src && src.title ? ' <span class="muted">' + esc(src.title) + '</span>' : '') + '</p>' +
      '<p>職人が書いた URL: ' + linkOrText(g.url) + '</p>' +
      '<p>検証係が開いた URL: ' + (sameUrl ? '<span class="muted">同じ URL</span>' : opened.length ? '<span class="rv-urls">' + opened.map(linkOrText).join('<br>') + '</span>' : '<span class="muted">なし</span>') + '</p>' +
      (claimsHtml ? '<ul class="rv-claims">' + claimsHtml + '</ul>' : '<p class="muted">関係する主張はありません（出典だけの問題）</p>') + '</div>';
  }

  function itemHtml(k, i, d, st, tri) {
    var c = st.ck[k] || {};
    var human = HUMAN_KEYS.indexOf(k);
    var opts = itemOptions(k).map(function (r) {
      var on = c.result === r;
      return '<button type="button" class="btn small seg-' + r + (on ? ' on' : '') + '" data-set="' + k + '" data-val="' + r + '" aria-pressed="' + (on ? 'true' : 'false') + '">' + (r === 'ok' ? 'OK' : r === 'ng' ? 'NG' : '該当なし') + '</button>';
    }).join('');
    var extra = '';
    if (k === 'explanation_and_expression') {
      var base = '/api/review/' + encodeURIComponent(d.version.id) + '/files/';
      var imgs = imageFiles(d.version.material);
      extra = '<div class="rv-figs"><span class="muted">図・画像 ' + imgs.length + ' 枚（検証係は図を見ません。すべて見てください）</span>' +
        (imgs.length ? '<div class="thumbs">' + imgs.map(function (p) {
          return '<a href="' + esc(base + p) + '" target="_blank" rel="noopener noreferrer" title="' + esc(p) + '"><img class="thumb" alt="' + esc(p) + '" src="' + esc(base + p) + '"></a>';
        }).join('') + '</div>' : '') + '</div>';
    }
    if (tri.present && AUTO_KEYS.indexOf(k) >= 0 && AUTO_HINT[k]) extra += '<p class="muted">' + esc(AUTO_HINT[k]) + '</p>';
    return '<div class="rv-item" id="ck-' + k + '" data-ck="' + k + '"><div class="rv-item-head">' +
      (human >= 0 ? '<span class="kbd" title="' + (human + 1) + ' = OK / Shift+' + (human + 1) + ' = NG">' + (human + 1) + '</span>' : '<span class="kbd blank"></span>') +
      '<b>' + esc(CK_LABEL[k]) + '</b><span class="seg">' + opts + '</span></div>' + extra +
      '<input type="text" class="rv-ngnote' + (c.result === 'ng' ? '' : ' hidden') + '" data-note="' + k + '" maxlength="2000" placeholder="NG の理由（メモ）" value="' + esc(c.note || '') + '"></div>';
  }

  function partsHtml(d) {
    var vid = d.version.id, mat = d.version.material || { parts: [] };
    var fileBase = '/api/review/' + encodeURIComponent(vid) + '/files/';
    return (mat.parts || []).map(function (p, pi) {
      var vars = p.variants || [];
      var first = -1; // 既定は「小学生・短い」（無ければ最初の変奏）
      vars.forEach(function (vr, vi) { if (first < 0 && !vr.game && vr.audience === 'elementary' && vr.length === 'short') first = vi; });
      if (first < 0) first = 0;
      var tabs = vars.map(function (vr, vi) {
        var label = vr.game ? 'ゲーム' : (vr.audience === 'elementary' ? '小' : '中') + '・' + (vr.length === 'short' ? '短' : '長');
        return '<button type="button" class="btn small" data-part="' + pi + '" data-path="' + esc(vr.path) + '"' + (vi === first ? ' data-first="1"' : '') + '>' + esc(label) + '</button>';
      }).join('');
      var filesHtml = (p.files || []).map(function (f) {
        if (IMAGE_RE.test(f.path)) return '<img class="figure" alt="図" src="' + esc(fileBase + f.path) + '">';
        if (/\.html$/.test(f.path)) return '<iframe class="frame" sandbox="allow-scripts" title="動かせるもの" src="' + esc(fileBase + f.path) + '"></iframe>';
        return '<a href="' + esc(fileBase + f.path) + '" target="_blank" rel="noopener noreferrer">' + esc(f.path) + '</a>';
      }).join('');
      return '<div class="rv-part"><h3>' + esc(p.id) + ' ' + esc(p.title) + ' <span class="muted">型 ' + esc(p.kind) + '</span></h3>' +
        '<p>最初にやること（' + esc(p.entry_point && p.entry_point.type) + '）: ' + esc(p.entry_point && p.entry_point.text) + '</p>' +
        '<div class="tabs">' + tabs + '</div><div class="md-body" id="part-body-' + pi + '"><p class="muted">変奏を選んでください</p></div>' + filesHtml + '</div>';
    }).join('');
  }

  function detailsHtml(d) {
    var v = d.version, checks = v.checks || {};
    var red = function (arr) { return arr && arr.length; };
    var flags = [];
    if (red(checks.forbidden)) flags.push('禁止語 ' + checks.forbidden.length + ' 件');
    if (red(checks.app_html)) flags.push('app.html の外部読み込み ' + checks.app_html.length + ' 件');
    if (red(checks.missing_source_refs)) flags.push('出典 id の不一致 ' + checks.missing_source_refs.length + ' 件');
    if (red(checks.missing_claim_refs)) flags.push('claim 参照の不一致 ' + checks.missing_claim_refs.length + ' 件');
    if (red(checks.kakunin_zumi)) flags.push('「確認済み」 ' + checks.kakunin_zumi.length + ' 件');
    var unref = Array.isArray(checks.unreferenced_files) ? checks.unreferenced_files : [];
    var ver = d.verification;
    return (flags.length ? '<p class="err">機械検査: ' + esc(flags.join(' / ')) + '</p>' : '<p class="ok pill">機械検査: 赤印なし</p>') +
      (unref.length ? '<div id="unref-files"><p class="muted">参照されていないファイル（material.json から参照されていないため、確認・配信の対象外です）</p><ul>' +
        unref.map(function (n) { return '<li class="pre">' + esc(n) + '</li>'; }).join('') + '</ul></div>' : '') +
      '<p>費用: 制作 ' + fmtCents(v.list_cost_cents) + ' / 検証 ' + fmtCents(d.verify_cost_cents) + ' ・ 採点: ' + esc(v.grader_result || '—') + (v.grader_explanation ? ' — ' + esc(v.grader_explanation) : '') +
        (d.job && d.job.console_url ? ' ・ <a href="' + esc(d.job.console_url) + '" target="_blank" rel="noopener noreferrer">Console</a>' : '') + '</p>' +
      (ver ? '<p class="muted">検証 attempt ' + esc(ver.attempt) + ' / 確か ' + esc(ver.confirmed) + ' 仮説 ' + esc(ver.hypothesis) + ' 未確認 ' + esc(ver.unverified) + ' 食い違い ' + esc(ver.contradicted) + '</p>' : '') +
      (ver && ver.overall_note ? '<p class="muted">検証係のメモ: ' + esc(ver.overall_note) + '</p>' : '') +
      '<div class="grid2"><div><h3>selfcheck.md（自己点検）</h3>' + renderMd(v.selfcheck_md) + '</div><div><h3>adapt-rules.md（変えてよい範囲）</h3>' + renderMd(v.adapt_rules_md) + '</div></div>' +
      '<h3>機械検査の詳細（checks_json）</h3><pre>' + esc(JSON.stringify(checks, null, 2)) + '</pre>';
  }

  function tablesHtml(d) {
    var claimsHtml = '<div class="table-wrap"><table><thead><tr><th>id</th><th>本文</th><th>職人</th><th>検証係</th><th>理由</th></tr></thead><tbody>' + (d.claims || []).map(function (c) {
      return '<tr><td>' + esc(c.id) + '</td><td>' + esc(c.text) + '</td><td>' + esc(c.status) + '</td><td>' + (c.verdict ? pill(c.verdict, VERDICT_CLASS[c.verdict]) : '—') + '</td><td>' + esc(c.reason || '') + '</td></tr>';
    }).join('') + '</tbody></table></div>';
    var yn = function (x) { return x ? pill('はい', 'green') : pill('いいえ', 'red'); };
    var sourcesHtml = '<div class="table-wrap"><table><thead><tr><th>id</th><th>url</th><th>title</th><th>開いた</th><th>引用あり</th><th>利用条件</th><th>一次</th><th>詳細</th></tr></thead><tbody>' + (d.sources || []).map(function (s) {
      var sec = !s.is_primary;
      return '<tr><td>' + esc(s.source_id) + '</td><td class="pre">' + esc(s.url) + '</td><td>' + esc(s.title) + '</td>' +
        '<td>' + (sec ? pill(s.url_was_fetched ? 'はい' : 'いいえ', 'gray') : yn(s.url_was_fetched)) + '</td>' +
        '<td>' + (sec ? pill(s.quote_found ? 'はい' : 'いいえ', 'gray') : yn(s.quote_found)) + '</td>' +
        '<td>' + (s.license === 'unknown' ? pill('unknown', 'red') : esc(s.license)) + '</td><td>' + (s.is_primary ? 'はい' : 'いいえ') + '</td><td>' + esc(s.check_detail) + '</td></tr>';
    }).join('') + '</tbody></table></div>';
    return '<h3>主張（claims）</h3>' + claimsHtml + '<h3>出典（sources）</h3>' + sourcesHtml;
  }

  /** 要確認の主張 id（本文の段落に黄色の印を付ける） */
  function markIdsOf(tri) {
    var ids = {};
    tri.groups.forEach(function (g) { (g.claim_ids || []).forEach(function (id) { ids[id] = true; }); });
    return ids;
  }

  /** 確認画面全体の HTML。ctx: { status, queue: [version_id...] } */
  function reviewHtml(d, st, ctx) {
    ctx = ctx || {};
    var v = d.version, tri = triageOf(d), isReview = v.status === 'review';
    var vstate = verifyState(v, ctx.status);
    var okNames = autoOkKeys(tri).map(function (k) { return CK_LABEL[k]; });
    var queue = ctx.queue || [], pos = queue.indexOf(v.id);
    var nr = tri.needs_review;
    var band = '<div class="rv-band" id="rv-band" data-rv-band="1"><div class="row">' +
      '<b class="rv-title">' + esc(d.material ? d.material.title : '') + '</b><span class="muted">v' + esc(v.version) + '</span>' +
      (pos >= 0 ? '<span class="muted">' + (pos + 1) + ' / ' + queue.length + '</span>' : '') +
      (isReview ? '' : pill('この版は確認待ちではありません（' + v.status + '）', v.status === 'approved' ? 'green' : 'gray')) +
      (nr === null ? pill('仕分けなし（全項目を見てください）', 'gray') : nr > 0 ? pill('要確認 ' + nr + ' 件', 'orange') : pill('要確認なし', 'green')) +
      '<span class="pill ' + (okNames.length ? 'green' : 'gray') + '" id="rv-autook">自動で OK: ' + esc(okNames.length ? okNames.join('・') : 'なし') + '</span>' +
      '<span class="pill ' + vstate.cls + '" id="rv-vstate">' + esc(vstate.text) + '</span>' +
      (isReview && (v.verification_status === 'done' || v.verification_status === 'failed') ? '<button type="button" class="btn small" id="reverify-btn">再検証</button>' : '') +
      (v.verification_status === 'pending' || v.verification_status === 'running' ? '<button type="button" class="btn small" id="rv-reload">読み込み直す</button>' : '') +
      (tri.present && tri.action !== 'none' ? pill(tri.action === 'reverify' ? '自動の再検証を待っています' : '自動の差し戻しを待っています', 'yellow') : '') +
      '<a href="#/material/' + esc(v.material_id) + '">素材へ</a>' +
      '<button type="button" class="btn small" id="rv-help" title="キーの一覧（?）">キー ?</button></div></div>';

    var groupsBody;
    if (!tri.present) groupsBody = '<p class="muted">仕分けの結果がありません。下の「問題なし」の表も開いて、6 項目すべてを見てください。</p>';
    else if (tri.groups.length) groupsBody = tri.groups.map(function (g, i) { return groupHtml(g, i, d); }).join('');
    else groupsBody = '<p class="ok pill" id="rv-none">要確認なし</p><p class="muted">機械と検証係の確認で気になる所はありませんでした。下の項目だけ見てください。</p>';
    if (tri.present && !d.verification_id) groupsBody += '<p class="muted">主張は検証が終わってから仕分けます（いまは出典だけの問題を出しています）。</p>';
    var groups = '<details class="card rv-sec" id="rv-groups" open><summary><h2>要確認' + (tri.present ? '（' + tri.groups.length + '）' : '') + '</h2></summary>' + groupsBody + '</details>';

    var body = '<div class="card" id="rv-body"><h2>本文</h2>' + partsHtml(d) + '</div>';
    var items = reviewItems(tri);
    var check = isReview ? '<div class="card" id="rv-check"><h2>あなたが見る項目</h2>' + items.map(function (k, i) { return itemHtml(k, i, d, st, tri); }).join('') + '</div>' : '';
    var okc = tri.ok_counts || {};
    var folded = '<details class="card rv-sec" id="rv-ok"><summary><h2>問題なし（主張 ' + esc(okc.claims || 0) + ' 件・出典 ' + esc(okc.sources || 0) + ' 件）</h2></summary>' + tablesHtml(d) + '</details>' +
      '<details class="card rv-sec" id="rv-detail"><summary><h2>詳細（機械検査・自己点検・変えてよい範囲・費用）</h2></summary>' + detailsHtml(d) + '</details>';

    var foot = '';
    if (isReview) {
      var ap = approveState(d, st);
      var busy = !!ctx.busy;
      foot = '<div class="rv-foot" id="rv-foot">' +
        '<div id="rv-reason" class="rv-reason' + (st.mode ? '' : ' hidden') + '">' +
          '<label class="field"><span id="d-note-label">' + (st.mode === 'reject' ? '却下の理由（必須）' : '差し戻しの理由（必須）') + '</span><textarea id="d-note" rows="2" maxlength="4000">' + esc(st.note) + '</textarea></label>' +
          '<label class="field' + (st.mode === 'return' ? '' : ' hidden') + '" id="d-append-wrap"><span>差し戻し時の注文票への追記（任意）</span><textarea id="d-append" rows="2" maxlength="8000">' + esc(st.append) + '</textarea></label>' +
          '<p class="muted">もう一度「' + (st.mode === 'reject' ? '却下する' : '差し戻す') + '」を押すと確認します。<button type="button" class="btn small" id="rv-reason-close">閉じる</button></p>' +
        '</div>' +
        '<div class="row rv-foot-row">' +
          '<button type="button" class="linkish rv-why" id="approve-why" data-target="' + esc(ap.why[0] ? ap.why[0].target : '') + '">' + esc(ap.enabled ? '承認できます' : '承認するには: ' + ap.why.map(function (w) { return w.text; }).join(' / ')) + '</button>' +
          '<span id="rv-draft" class="err' + (st.draftShown && hasDraft(st) ? '' : ' hidden') + '">理由を書きかけです</span>' +
          '<span class="rv-btns">' +
          '<button type="button" class="btn danger" id="reject-btn"' + (busy ? ' disabled' : '') + '>却下する <span class="kbd">X</span></button>' +
          '<button type="button" class="btn" id="return-btn"' + (busy ? ' disabled' : '') + '>差し戻す <span class="kbd">R</span></button>' +
          '<button type="button" class="btn primary" id="approve-btn"' + (ap.enabled && !busy ? '' : ' disabled') + '>承認する <span class="kbd">A</span></button>' +
          '</span></div></div>';
    }
    return band + groups + body + check + folded + foot;
  }

  // ---- 確認画面の DOM 側（状態は版ごとに残す: 失敗・再取得でも入力を消さない §G-3）----
  var reviewStates = {};
  var reviewCtx = null; // { vid, d, st, status, queue, busy, view }
  function stateFor(vid) { return reviewStates[vid] || (reviewStates[vid] = newReviewState()); }

  function fetchQueue() {
    return api('GET', '/api/review').then(function (l) { return (l.versions || []).map(function (x) { return x.version_id; }); }, function () { return []; });
  }

  function viewReview(view, vid) {
    view.innerHTML = '<p class="loading">読み込み中…</p>';
    Promise.all([
      api('GET', '/api/review/' + encodeURIComponent(vid)),
      fetchQueue(),
      api('GET', '/api/status').then(null, function () { return null; })
    ]).then(function (res) {
      if (parseHash().parts[1] !== vid) return; // 読み込み中に別の画面へ移った
      var d = res[0];
      reviewCtx = { vid: vid, d: d, st: stateFor(vid), queue: res[1], status: res[2], busy: false, view: view };
      renderReview();
    }, function (e) { view.innerHTML = '<p class="err">読み込めませんでした: ' + esc(e.message) + '</p><p><button type="button" class="btn" id="rv-retry">もう一度読み込む</button></p>'; var b = $('#rv-retry'); if (b) b.addEventListener('click', route); });
  }

  function renderReview() {
    var c = reviewCtx, view = c.view, d = c.d, st = c.st;
    view.innerHTML = reviewHtml(d, st, c);
    document.body.classList.toggle('has-foot', d.version.status === 'review');
    var mark = markIdsOf(triageOf(d));
    var fileBase = '/api/review/' + encodeURIComponent(c.vid) + '/files/';
    Array.prototype.forEach.call(view.querySelectorAll('[data-path]'), function (b) {
      b.addEventListener('click', function () {
        var pi = b.getAttribute('data-part');
        Array.prototype.forEach.call(view.querySelectorAll('[data-part="' + pi + '"]'), function (x) { x.classList.toggle('on', x === b); });
        var body = $('#part-body-' + pi);
        body.innerHTML = '<p class="loading">読み込み中…</p>';
        fetchText(fileBase + b.getAttribute('data-path')).then(function (t) { body.innerHTML = renderMd(t, mark); }, function (e) { body.innerHTML = '<p class="err">' + esc(e.message) + '</p>'; });
      });
      if (b.getAttribute('data-first')) b.click();
    });
    $('#rv-help').addEventListener('click', openKeys);
    var reload = $('#rv-reload');
    if (reload) reload.addEventListener('click', function () { route(); });
    var rv = $('#reverify-btn');
    if (rv) rv.addEventListener('click', function () {
      c.busy = true;
      action(rv, {
        title: '検証をやり直します', body: '次の cron（10 分ごと）で検証係が動きます。費用がかかります。',
        run: function () { return api('POST', '/api/review/' + encodeURIComponent(c.vid) + '/reverify'); }, success: '再検証を予約しました'
      }).then(function () { c.busy = false; });
    });
    if (d.version.status !== 'review') return;
    Array.prototype.forEach.call(view.querySelectorAll('[data-set]'), function (b) {
      b.addEventListener('click', function () { setItem(st, b.getAttribute('data-set'), b.getAttribute('data-val')); syncReview(); });
    });
    Array.prototype.forEach.call(view.querySelectorAll('input[data-note]'), function (inp) {
      inp.addEventListener('input', function () { var k = inp.getAttribute('data-note'); if (st.ck[k]) st.ck[k].note = inp.value; });
    });
    $('#d-note').addEventListener('input', function () { st.note = this.value; syncReview(); });
    $('#d-append').addEventListener('input', function () { st.append = this.value; syncReview(); });
    $('#rv-reason-close').addEventListener('click', function () { st.mode = null; syncReview(); });
    $('#approve-why').addEventListener('click', function () { scrollToTarget(this.getAttribute('data-target')); });
    $('#approve-btn').addEventListener('click', function () { runCommand({ cmd: 'approve' }); });
    $('#return-btn').addEventListener('click', function () { runCommand({ cmd: 'return' }); });
    $('#reject-btn').addEventListener('click', function () { runCommand({ cmd: 'reject' }); });
  }

  /** 全部を描き直さずに、トグル・メモ欄・理由欄・承認の可否だけを反映する（textarea の入力とフォーカスを保つ） */
  function syncReview() {
    var c = reviewCtx, st = c.st, view = c.view;
    Array.prototype.forEach.call(view.querySelectorAll('[data-set]'), function (b) {
      var k = b.getAttribute('data-set'), on = !!(st.ck[k] && st.ck[k].result === b.getAttribute('data-val'));
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    Array.prototype.forEach.call(view.querySelectorAll('input[data-note]'), function (inp) {
      var k = inp.getAttribute('data-note');
      inp.classList.toggle('hidden', !(st.ck[k] && st.ck[k].result === 'ng'));
    });
    $('#rv-reason').classList.toggle('hidden', !st.mode);
    $('#d-append-wrap').classList.toggle('hidden', st.mode !== 'return');
    $('#d-note-label').textContent = st.mode === 'reject' ? '却下の理由（必須）' : '差し戻しの理由（必須）';
    if (!hasDraft(st)) st.draftShown = false;
    $('#rv-draft').classList.toggle('hidden', !(st.draftShown && hasDraft(st)));
    var ap = approveState(c.d, st);
    $('#approve-btn').disabled = !ap.enabled || c.busy;
    $('#return-btn').disabled = c.busy;
    $('#reject-btn').disabled = c.busy;
    var why = $('#approve-why');
    why.textContent = ap.enabled ? '承認できます' : '承認するには: ' + ap.why.map(function (w) { return w.text; }).join(' / ');
    why.setAttribute('data-target', ap.why[0] ? ap.why[0].target : '');
  }

  function scrollToTarget(id) {
    var el = id ? document.getElementById(id) : null;
    if (!el) return;
    if (el.tagName === 'DETAILS') el.open = true;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
    setTimeout(function () { el.classList.remove('flash'); }, 1500);
  }

  function openKeys() {
    var dlg = $('#keys-dlg');
    if (dlg && !dlg.open) dlg.showModal();
  }

  /** キーとボタンの共通の入口 */
  function runCommand(cmd) {
    var c = reviewCtx;
    if (!c || !cmd || c.busy) return;
    var st = c.st;
    if (cmd.cmd === 'set' || cmd.cmd === 'draft_block') { applyCommand(st, cmd); syncReview(); return; }
    if (cmd.cmd === 'help') return openKeys();
    if (cmd.cmd === 'nav') return navReview(cmd.dir);
    if (cmd.cmd === 'approve') {
      var ap = approveState(c.d, st);
      if (!ap.enabled) { syncReview(); if (ap.why[0]) scrollToTarget(ap.why[0].target); return; }
      var okNames = autoOkKeys(triageOf(c.d)).map(function (k) { return CK_LABEL[k]; });
      return sendDecision('approve', 'この版を承認して配信します', '承認すると配信 API に出ます。' + (okNames.length ? '\n自動で OK: ' + okNames.join('・') : ''));
    }
    if (cmd.cmd === 'return' || cmd.cmd === 'reject') {
      if (st.mode !== cmd.cmd) {
        st.mode = cmd.cmd;
        syncReview();
        var ta = $('#d-note');
        if (ta) { ta.focus(); ta.scrollIntoView({ block: 'nearest' }); }
        return;
      }
      if (!st.note.trim()) { toast('理由を入力してください', true); $('#d-note').focus(); return; }
      return cmd.cmd === 'return'
        ? sendDecision('return', 'この版を差し戻します', '理由を添えて改善 job を注文します（rework）。\n\n理由: ' + st.note)
        : sendDecision('reject', 'この版を却下します', '配信の状態は変わりません。\n\n理由: ' + st.note);
    }
  }

  function navReview(dir) {
    var c = reviewCtx, q = c.queue || [], i = q.indexOf(c.vid);
    var next = i < 0 ? q[dir > 0 ? 0 : q.length - 1] : q[i + dir];
    if (!next) { toast(dir > 0 ? '最後の確認待ちです' : '最初の確認待ちです'); return; }
    location.hash = '#/review/' + next;
  }

  /** 予告（確認ダイアログ）→ 実行（送信中はボタンとキーを無効化）→ トースト → 反映（一覧を取り直して次の確認待ちへ）。失敗時は入力を残す */
  function sendDecision(decision, title, body) {
    var c = reviewCtx, st = c.st, vid = c.vid;
    confirmDialog({ title: title, body: body, okText: decision === 'approve' ? '承認する' : decision === 'return' ? '差し戻す' : '却下する' }).then(function (dres) {
      if (!dres.ok || reviewCtx !== c) return;
      c.busy = true;
      var btn = $(decision === 'approve' ? '#approve-btn' : decision === 'return' ? '#return-btn' : '#reject-btn');
      var label = btn ? btn.innerHTML : '';
      syncReview();
      if (btn) btn.textContent = '送信中…';
      var payload = { decision: decision, checklist: checklistPayload(c.d, st, decision === 'approve'), note: decision === 'approve' ? '' : st.note, verification_id: c.d.verification_id };
      if (decision === 'return') payload.brief_append = st.append;
      api('POST', '/api/review/' + encodeURIComponent(vid) + '/decision', payload).then(function (res) {
        delete reviewStates[vid];
        var msg = decision === 'approve' ? '承認しました' : decision === 'return' ? '差し戻しました' : '却下しました';
        if (res && res.start_error) msg += '（改善 job の起動は後で行います: ' + (ERROR_TEXT[res.start_error] || res.start_error) + '）';
        var oldQ = c.queue || [];
        return fetchQueue().then(function (q) {
          var i = oldQ.indexOf(vid);
          var order = oldQ.slice(i + 1).concat(oldQ.slice(0, Math.max(i, 0)));
          var next = order.filter(function (x) { return x !== vid && q.indexOf(x) >= 0; })[0] || q.filter(function (x) { return x !== vid; })[0];
          toast(msg + (next ? '。次の確認待ちへ移ります' : '。確認待ちは残っていません'));
          c.busy = false;
          location.hash = next ? '#/review/' + next : '#/review';
        });
      }, function (e) {
        c.busy = false;
        toast(e.message || '失敗しました', true);
        if (btn) btn.innerHTML = label;
        var code = e.body && e.body.error;
        if (code === 'stale_verification' || code === 'auto_triage_pending' || code === 'conflict' || code === 'not_in_review') route(); // 入力は reviewStates に残る
        else syncReview();
      });
    });
  }

  function onReviewKey(e) {
    var c = reviewCtx;
    if (!c || !c.d || c.d.version.status !== 'review') return;
    var a = document.activeElement;
    var env = {
      inInput: !!(a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable)),
      dialogOpen: !!document.querySelector('dialog[open]'),
      busy: !!c.busy,
      draft: hasDraft(c.st)
    };
    var cmd = keyCommand(e, env);
    if (!cmd) return;
    e.preventDefault();
    runCommand(cmd);
  }

  // ---- 画面: 確認待ち一覧（§L-6 一覧。並びはサーバーの順 = 要確認の多い順 → 古い順）----
  function viewReviewList(view) {
    view.innerHTML = '<h1>確認待ち</h1><div id="rl" class="card loading">読み込み中…</div><div id="rl-auto"></div>';
    api('GET', '/api/review').then(function (d) {
      var el = $('#rl');
      el.classList.remove('loading');
      if (!d.versions.length) { el.innerHTML = '<p class="muted">確認待ちの版はありません。</p>'; return; }
      el.innerHTML = '<p class="muted">要確認の多い順です。開いた画面では J / K で次・前へ移れます。</p><div class="table-wrap"><table><thead><tr><th>素材</th><th>版</th><th>要確認</th><th>自動 OK</th><th>検証</th><th>作成</th></tr></thead><tbody>' + d.versions.map(function (v) {
        var nr = typeof v.needs_review === 'number' ? v.needs_review : null;
        var vs = verifyState(v, null);
        return '<tr data-rl-row="1"><td><a href="#/review/' + esc(v.version_id) + '">' + esc(v.title) + '</a></td><td>v' + esc(v.version) + '</td>' +
          '<td>' + (nr === null ? '—' : nr > 0 ? pill(String(nr), 'orange') : pill('0', 'green')) + '</td>' +
          '<td>' + (typeof v.auto_ok === 'number' ? esc(v.auto_ok) + ' / 3' : '—') + '</td>' +
          '<td>' + pill(vs.text, vs.cls) + '</td><td>' + esc(fmtTime(v.created_at)) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    }, function (e) { $('#rl').innerHTML = '<p class="err">読み込めませんでした: ' + esc(e.message) + '</p>'; });
    loadAutoRework();
  }

  /** 自動差し戻しで作り直し中の素材 = 動いている rework job の元の版に system:auto-triage の return がある（§L-5 素材詳細の decisions から判定） */
  function autoReworkJob(detail) {
    var decs = (detail && detail.review_decisions) || [];
    return ((detail && detail.jobs) || []).filter(function (j) {
      return j.kind === 'rework' && ACTIVE_JOB.indexOf(j.status) >= 0 && j.parent_version_id &&
        decs.some(function (r) { return r.material_version_id === j.parent_version_id && r.decision === 'return' && r.reviewer_email === AUTO_REVIEWER; });
    })[0] || null;
  }
  /** 素材一覧: 動いている rework job が自動差し戻し由来なら job 欄に「自動で作り直し中」を足す（素材詳細を最大 10 件読む） */
  function markAutoRework(materials) {
    (materials || []).filter(function (m) { return m.active_job && m.active_job.kind === 'rework'; }).slice(0, 10).forEach(function (m) {
      api('GET', '/api/materials/' + encodeURIComponent(m.id)).then(function (x) {
        if (!autoReworkJob(x)) return;
        var cell = Array.prototype.filter.call(document.querySelectorAll('[data-job-cell]'), function (el) { return el.getAttribute('data-job-cell') === m.id; })[0];
        if (cell && !cell.querySelector('.auto-rework')) cell.insertAdjacentHTML('afterbegin', '<span class="pill yellow auto-rework">自動で作り直し中</span> ');
      }, function () { /* 補助の表示 */ });
    });
  }
  function loadAutoRework() {
    api('GET', '/api/materials').then(function (d) {
      var cand = (d.materials || []).filter(function (m) { return m.active_job && m.active_job.kind === 'rework'; }).slice(0, 10);
      return Promise.all(cand.map(function (m) { return api('GET', '/api/materials/' + encodeURIComponent(m.id)).then(function (x) { return { m: m, job: autoReworkJob(x) }; }, function () { return { m: m, job: null }; }); }));
    }).then(function (rows) {
      var el = $('#rl-auto');
      if (!el) return;
      rows = (rows || []).filter(function (r) { return r.job; });
      if (!rows.length) { el.innerHTML = ''; return; }
      el.innerHTML = '<div class="card"><h2>自動で作り直し中</h2><p class="muted">検証の結果が悪かったため、自動で 1 回差し戻しました。作り直しが終わるとここから確認待ちに移ります。</p><ul>' + rows.map(function (r) {
        return '<li>' + pill('自動で作り直し中', 'yellow') + ' <a href="#/material/' + esc(r.m.id) + '">' + esc(r.m.title) + '</a> <a class="muted" href="#/job/' + esc(r.job.id) + '">' + esc(JOB_LABEL[r.job.status] || r.job.status) + '</a></li>';
      }).join('') + '</ul></div>';
    }, function () { /* 補助の表示。失敗しても一覧は使える */ });
  }

  // smoke（§L-7 (l5)）から純関数を呼べるようにする。画面の動作には使わない
  window.FactoryAdminReview = {
    CAUSE_TEXT: CAUSE_TEXT, HUMAN_KEYS: HUMAN_KEYS, triageOf: triageOf, reviewItems: reviewItems, verifyState: verifyState,
    approveState: approveState, checklistPayload: checklistPayload, keyCommand: keyCommand, applyCommand: applyCommand,
    newReviewState: newReviewState, reviewHtml: reviewHtml, renderMd: renderMd
  };

  // ---- 画面: 編集基準 ----
  function viewStandards(view) {
    view.innerHTML = '<p class="loading">読み込み中…</p>';
    api('GET', '/api/standards').then(function (d) {
      var label = { question: '質問と回答', return_reason: '差し戻し理由', approval_note: '承認メモ', note: '追記' };
      view.innerHTML = '<h1>編集基準</h1><div class="card">' + renderMd(d.static_md) + '</div>' +
        '<form id="std-form" class="card"><label class="field"><span>追記する（職人への次回以降の注文に入ります）</span><textarea id="std-text" rows="3"></textarea></label><div class="row end"><button type="submit" class="btn primary" id="std-btn">追記する</button></div></form>' +
        '<div class="card"><h2>ログ</h2>' + (d.log.length ? '<ul>' + d.log.map(function (l) {
          return '<li>' + esc(fmtTime(l.created_at)) + ' ' + pill(label[l.kind] || l.kind) + ' ' + (l.question ? esc(l.question) + ' → ' : '') + esc(l.answer) + '</li>';
        }).join('') + '</ul>' : '<p class="muted">ログはまだありません</p>') + '</div>';
      $('#std-form').addEventListener('submit', function (ev) {
        ev.preventDefault();
        var text = $('#std-text').value;
        if (!text.trim()) { toast('追記する内容を入力してください', true); return; }
        action($('#std-btn'), { title: '編集基準に追記します', body: text, run: function () { return api('POST', '/api/standards', { text: text }); }, success: '追記しました' });
      });
    }, function (e) { view.innerHTML = '<p class="err">読み込めませんでした: ' + esc(e.message) + '</p>'; });
  }

  // ---- router ----
  function parseHash() {
    var h = location.hash.replace(/^#/, '') || '/';
    var qi = h.indexOf('?');
    var path = qi >= 0 ? h.slice(0, qi) : h;
    var q = {};
    if (qi >= 0) h.slice(qi + 1).split('&').forEach(function (kv) { var p = kv.split('='); if (p[0]) q[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ''); });
    return { parts: path.split('/').filter(Boolean), q: q };
  }
  function route() {
    var view = $('#view');
    var r = parseHash(), p = r.parts;
    reviewCtx = null;
    document.body.classList.remove('has-foot');
    loadStatus();
    if (!p.length) return viewMaterials(view, r.q);
    if (p[0] === 'new') return viewNew(view);
    if (p[0] === 'material' && p[1]) return viewMaterial(view, p[1]);
    if (p[0] === 'job' && p[1]) return viewJob(view, p[1]);
    if (p[0] === 'review' && p[1]) return viewReview(view, p[1]);
    if (p[0] === 'review') return viewReviewList(view);
    if (p[0] === 'standards') return viewStandards(view);
    if (p[0] === 'proposals') return viewProposals(view, r.q);
    view.innerHTML = '<p class="muted">ページが見つかりません。<a href="#/">素材へ</a></p>';
  }
  if (window.__FACTORY_ADMIN_NO_BOOT__) return; // smoke が純関数だけを読む時
  window.addEventListener('hashchange', route);
  document.addEventListener('keydown', onReviewKey);
  route();
})();
