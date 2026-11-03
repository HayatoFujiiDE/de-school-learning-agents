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
    checklist_incomplete: '6 項目すべてを選んでください',
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
      function done(v) { ok.removeEventListener('click', onOk); cancel.removeEventListener('click', onCancel); dlg.removeEventListener('cancel', onCancel); dlg.close(); resolve(v); }
      function onOk() {
        if (opts.note && opts.noteRequired !== false && !note.value.trim()) { noteErr.classList.remove('hidden'); note.focus(); return; }
        done({ ok: true, note: note.value });
      }
      function onCancel(e) { if (e && e.preventDefault) e.preventDefault(); done({ ok: false }); }
      ok.addEventListener('click', onOk);
      cancel.addEventListener('click', onCancel);
      dlg.addEventListener('cancel', onCancel);
      dlg.showModal();
      if (opts.note) note.focus();
    });
  }

  /** 書き込み操作の共通ループ: 予告 → 実行（ボタン無効化）→ トースト → 再取得 */
  function action(btn, opts) {
    return confirmDialog(opts).then(function (d) {
      if (!d.ok) return null;
      var label = btn ? btn.textContent : '';
      if (btn) { btn.disabled = true; btn.textContent = '実行中…'; }
      return Promise.resolve(opts.run(d.note)).then(function (res) {
        toast(opts.success || '完了しました');
        if (opts.after) opts.after(res);
        else route();
        return res;
      }, function (e) {
        toast(e.message || '失敗しました', true);
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
  function renderMd(src) {
    var lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
    var html = [], para = [], list = null, code = null;
    function flushPara() { if (para.length) { html.push('<p>' + inlineMd(para.join(' ')) + '</p>'); para = []; } }
    function flushList() { if (list) { html.push('<ul>' + list.map(function (x) { return '<li>' + inlineMd(x) + '</li>'; }).join('') + '</ul>'); list = null; } }
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
        '<button type="button" class="btn small" id="pause-btn">' + (s.paused ? '再開' : '止める') + '</button>';
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

  // ---- 画面: 素材一覧 ----
  function viewMaterials(view, q) {
    var work = q.work || '', publish = q.publish || '';
    view.innerHTML = '<h1>素材</h1><div class="card"><div class="row">' +
      '<label>配信 <select id="f-publish"><option value="">すべて</option><option value="none">なし</option><option value="available">利用できる</option><option value="stopped">止めている</option></select></label>' +
      '<label>制作 <select id="f-work"><option value="">すべて</option><option value="idle">待機</option><option value="queued">順番待ち</option><option value="making">制作中</option><option value="review">確認待ち</option></select></label>' +
      '<a class="btn primary" href="#/new">新しい素材</a></div></div><div id="list" class="card loading">読み込み中…</div>';
    $('#f-publish').value = publish;
    $('#f-work').value = work;
    function apply() {
      var p = [];
      if ($('#f-publish').value) p.push('publish=' + encodeURIComponent($('#f-publish').value));
      if ($('#f-work').value) p.push('work=' + encodeURIComponent($('#f-work').value));
      location.hash = '#/' + (p.length ? '?' + p.join('&') : '');
    }
    $('#f-publish').addEventListener('change', apply);
    $('#f-work').addEventListener('change', apply);
    var qs = [];
    if (work) qs.push('work=' + encodeURIComponent(work));
    if (publish) qs.push('publish=' + encodeURIComponent(publish));
    api('GET', '/api/materials' + (qs.length ? '?' + qs.join('&') : '')).then(function (d) {
      var list = $('#list');
      list.classList.remove('loading');
      if (!d.materials.length) { list.innerHTML = '<p class="muted">素材はまだありません。「新しい素材」から注文できます。</p>'; return; }
      list.innerHTML = '<div class="table-wrap"><table><thead><tr><th>タイトル</th><th>slug</th><th>型</th><th>配信</th><th>制作</th><th>現在版</th><th>job</th></tr></thead><tbody>' +
        d.materials.map(function (m) {
          return '<tr><td><a href="#/material/' + esc(m.id) + '">' + esc(m.title) + '</a></td><td>' + esc(m.slug) + '</td><td>' + esc((m.kinds || []).join(', ')) + '</td>' +
            '<td>' + pill(PUBLISH_LABEL[m.publish_status] || m.publish_status, m.publish_status === 'available' ? 'green' : m.publish_status === 'stopped' ? 'red' : 'gray') + '</td>' +
            '<td>' + pill(WORK_LABEL[m.work_status] || m.work_status, m.work_status === 'review' ? 'orange' : '') + '</td>' +
            '<td>' + (m.current_version ? 'v' + esc(m.current_version.version) : '—') + '</td>' +
            '<td>' + (m.active_job ? '<a href="#/job/' + esc(m.active_job.id) + '">' + esc(JOB_LABEL[m.active_job.status] || m.active_job.status) + '</a>' : '—') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }, function (e) { $('#list').innerHTML = '<p class="err">読み込めませんでした: ' + esc(e.message) + '</p>'; });
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
      var approved = d.versions.filter(function (v) { return v.status === 'approved' && v.id !== m.current_version_id; });
      view.innerHTML = '<h1>' + esc(m.title) + '</h1>' +
        '<div class="card"><div class="row">' + pill('配信: ' + (PUBLISH_LABEL[m.publish_status] || m.publish_status), m.publish_status === 'available' ? 'green' : 'gray') +
        pill('制作: ' + (WORK_LABEL[m.work_status] || m.work_status)) + '<span class="muted">slug ' + esc(m.slug) + ' / 型 ' + esc((m.kinds || []).join(', ')) + '</span></div>' +
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
        '<div class="card"><h2>確認の記録</h2>' + (d.review_decisions.length ? '<ul>' + d.review_decisions.map(function (r) {
          return '<li>' + esc(fmtTime(r.created_at)) + ' ' + esc(r.decision) + ' ' + esc(r.reviewer_email) + (r.note ? ' — ' + esc(r.note) : '') + '</li>';
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

  // ---- 画面: job ----
  function viewJob(view, id) {
    view.innerHTML = '<p class="loading">読み込み中…</p>';
    api('GET', '/api/jobs/' + encodeURIComponent(id)).then(function (d) {
      var j = d.job;
      var qs = j.questions || [];
      var canAnswer = j.status === 'needs_answer';
      var active = ['queued', 'creating', 'running', 'needs_answer', 'budget_reached'].indexOf(j.status) >= 0;
      view.innerHTML = '<h1>job</h1><div class="card"><div class="row">' + pill(JOB_LABEL[j.status] || j.status, j.status === 'failed' ? 'red' : j.status === 'done' ? 'green' : 'orange') +
        '<span class="muted">' + esc(j.kind) + ' / ' + esc(j.model) + ' / 段階 ' + esc(j.phase) + '</span>' +
        '<a href="#/material/' + esc(j.material_id) + '">素材へ</a>' +
        (j.console_url ? '<a href="' + esc(j.console_url) + '" target="_blank" rel="noopener noreferrer">Console</a>' : '') + '</div>' +
        '<p>費用 ' + fmtCents(j.list_cost_cents) + ' / 拒否した操作 ' + esc(j.deny_count) + ' 件 / 最終確認 ' + esc(fmtTime(j.last_checked_at)) + '</p>' +
        (j.status === 'budget_reached' ? '<p class="err">上限に達しました（Worker からは増額しません）</p>' : '') +
        (j.error ? '<p class="err">エラー: ' + esc(j.error) + '</p>' : '') +
        (j.last_error ? '<p class="err">最後のエラー: ' + esc(j.last_error) + '</p>' : '') +
        '<div class="row">' +
        (j.status === 'queued' ? '<button type="button" class="btn primary" id="start-btn">起動する</button>' : '') +
        (active && j.session_id ? '<button type="button" class="btn" id="rec-btn">状態を取り込む</button>' : '') +
        (active ? '<button type="button" class="btn danger" id="cancel-btn">取り消す</button>' : '') +
        '<button type="button" class="btn" id="reload-btn">再読み込み</button></div></div>' +
        (qs.length ? '<form id="ans-form" class="card"><h2>職人からの質問</h2>' + qs.map(function (q) {
          var saved = (j.answers || []).filter(function (a) { return a.question_id === q.id; })[0];
          return '<div class="field"><span>' + esc(q.question) + '</span><span class="muted">理由: ' + esc(q.why) + ' / 既定: ' + esc(q["default"]) + '</span>' +
            '<textarea data-qid="' + esc(q.id) + '" rows="3"' + (canAnswer && j.answer_state === 'none' ? '' : ' disabled') + '>' + esc(saved ? saved.answer : '') + '</textarea>' +
            (canAnswer && j.answer_state === 'none' ? '<button type="button" class="btn small" data-default="' + esc(q.id) + '">default を使う</button>' : '') + '</div>';
        }).join('') + (canAnswer ? '<p class="muted">' + (j.answer_state === 'none' ? '' : '回答は保存済みです（' + esc(j.answer_state) + '）。送信だけをやり直します。') + '</p><div class="row end"><button type="submit" class="btn primary" id="ans-btn">回答を送る</button></div>' : '') + '</form>' : '') +
        '<div class="card"><h2>注文票</h2>' + renderMd(j.brief_md) + '</div>';
      $('#reload-btn').addEventListener('click', function () { route(); });
      var start = $('#start-btn');
      if (start) start.addEventListener('click', function () {
        action(start, { title: '職人の作業場を起動します', run: function () { return api('POST', '/api/jobs/' + encodeURIComponent(id) + '/start'); }, success: '起動しました' });
      });
      var rec = $('#rec-btn');
      if (rec) rec.addEventListener('click', function () {
        action(rec, { title: '状態を取り込みます', body: '職人の作業場の状態を読み、必要なら成果物を取り込みます。', run: function () { return api('POST', '/api/jobs/' + encodeURIComponent(id) + '/reconcile'); }, success: '取り込みました' });
      });
      var cancel = $('#cancel-btn');
      if (cancel) cancel.addEventListener('click', function () {
        action(cancel, { title: 'この job を取り消します', body: '作業場は止まり、元に戻せません。', okText: '取り消す', run: function () { return api('POST', '/api/jobs/' + encodeURIComponent(id) + '/cancel'); }, success: '取り消しました' });
      });
      var form = $('#ans-form');
      if (form) {
        Array.prototype.forEach.call(form.querySelectorAll('[data-default]'), function (b) {
          b.addEventListener('click', function () {
            var qid = b.getAttribute('data-default');
            var q = qs.filter(function (x) { return x.id === qid; })[0];
            var ta = form.querySelector('textarea[data-qid="' + qid + '"]');
            if (q && ta) ta.value = q["default"];
          });
        });
        form.addEventListener('submit', function (ev) {
          ev.preventDefault();
          var answers = Array.prototype.map.call(form.querySelectorAll('textarea[data-qid]'), function (ta) { return { question_id: ta.getAttribute('data-qid'), answer: ta.value }; });
          if (j.answer_state === 'none' && answers.some(function (a) { return !a.answer.trim(); })) { toast('すべての質問に回答してください', true); return; }
          action($('#ans-btn'), {
            title: '回答を送ります', body: '回答は編集基準のログにも残ります。子どもや家庭の個人情報を含めないでください。',
            run: function () { return api('POST', '/api/jobs/' + encodeURIComponent(id) + '/answer', { answers: answers }); },
            success: '回答を送りました'
          });
        });
      }
    }, function (e) { view.innerHTML = '<p class="err">読み込めませんでした: ' + esc(e.message) + '</p>'; });
  }

  // ---- 画面: 確認待ち一覧 ----
  function viewReviewList(view) {
    view.innerHTML = '<h1>確認待ち</h1><div id="rl" class="card loading">読み込み中…</div>';
    api('GET', '/api/review').then(function (d) {
      var el = $('#rl');
      el.classList.remove('loading');
      if (!d.versions.length) { el.innerHTML = '<p class="muted">確認待ちの版はありません。</p>'; return; }
      el.innerHTML = '<div class="table-wrap"><table><thead><tr><th>素材</th><th>版</th><th>検証</th><th>作成</th></tr></thead><tbody>' + d.versions.map(function (v) {
        return '<tr><td><a href="#/review/' + esc(v.version_id) + '">' + esc(v.title) + '</a></td><td>v' + esc(v.version) + '</td><td>' + esc(v.verification_status) + '</td><td>' + esc(fmtTime(v.created_at)) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    }, function (e) { $('#rl').innerHTML = '<p class="err">読み込めませんでした: ' + esc(e.message) + '</p>'; });
  }

  // ---- 画面: 確認（§G-2）----
  function viewReview(view, vid) {
    view.innerHTML = '<p class="loading">読み込み中…</p>';
    api('GET', '/api/review/' + encodeURIComponent(vid)).then(function (d) {
      var v = d.version, mat = v.material || { parts: [] };
      var fileBase = '/api/review/' + encodeURIComponent(vid) + '/files/';
      var checks = v.checks || {};
      var red = function (arr) { return arr && arr.length; };
      var verification = d.verification;
      var hasContra = verification && verification.contradicted > 0;
      var isReview = v.status === 'review';
      var partsHtml = (mat.parts || []).map(function (p, pi) {
        var tabs = (p.variants || []).map(function (vr, vi) {
          var label = vr.game ? 'ゲーム' : (vr.audience === 'elementary' ? '小' : '中') + '・' + (vr.length === 'short' ? '短' : '長');
          return '<button type="button" class="btn small" data-part="' + pi + '" data-path="' + esc(vr.path) + '"' + (vi === 0 ? ' data-first="1"' : '') + '>' + esc(label) + '</button>';
        }).join('');
        var filesHtml = (p.files || []).map(function (f) {
          if (/\.svg$/.test(f.path)) return '<img class="figure" alt="図" src="' + esc(fileBase + f.path) + '">';
          if (/\.html$/.test(f.path)) return '<iframe class="frame" sandbox="allow-scripts" title="動かせるもの" src="' + esc(fileBase + f.path) + '"></iframe>';
          return '<a href="' + esc(fileBase + f.path) + '" target="_blank" rel="noopener noreferrer">' + esc(f.path) + '</a>';
        }).join('');
        return '<div class="card"><h2>' + esc(p.id) + ' ' + esc(p.title) + ' <span class="muted">型 ' + esc(p.kind) + '</span></h2>' +
          '<p>最初にやること（' + esc(p.entry_point && p.entry_point.type) + '）: ' + esc(p.entry_point && p.entry_point.text) + '</p>' +
          '<div class="tabs">' + tabs + '</div><div class="md-body" id="part-body-' + pi + '"><p class="muted">変奏を選んでください</p></div>' + filesHtml + '</div>';
      }).join('');
      var claimsHtml = '<div class="table-wrap"><table><thead><tr><th>id</th><th>本文</th><th>職人</th><th>検証係</th><th>理由</th></tr></thead><tbody>' + d.claims.map(function (c) {
        return '<tr><td>' + esc(c.id) + '</td><td>' + esc(c.text) + '</td><td>' + esc(c.status) + '</td><td>' + (c.verdict ? pill(c.verdict, VERDICT_CLASS[c.verdict]) : '—') + '</td><td>' + esc(c.reason || '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
      var yn = function (x) { return x ? pill('はい', 'green') : pill('いいえ', 'red'); };
      var sourcesHtml = '<div class="table-wrap"><table><thead><tr><th>id</th><th>url</th><th>title</th><th>開いた</th><th>引用あり</th><th>利用条件</th><th>一次</th><th>詳細</th></tr></thead><tbody>' + d.sources.map(function (s) {
        var sec = !s.is_primary;
        return '<tr><td>' + esc(s.source_id) + '</td><td class="pre">' + esc(s.url) + '</td><td>' + esc(s.title) + '</td>' +
          '<td>' + (sec ? pill(s.url_was_fetched ? 'はい' : 'いいえ', 'gray') : yn(s.url_was_fetched)) + '</td>' +
          '<td>' + (sec ? pill(s.quote_found ? 'はい' : 'いいえ', 'gray') : yn(s.quote_found)) + '</td>' +
          '<td>' + (s.license === 'unknown' ? pill('unknown', 'red') : esc(s.license)) + '</td><td>' + (s.is_primary ? 'はい' : 'いいえ') + '</td><td>' + esc(s.check_detail) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
      var flags = [];
      if (red(checks.forbidden)) flags.push('禁止語 ' + checks.forbidden.length + ' 件');
      if (red(checks.app_html)) flags.push('app.html の外部読み込み ' + checks.app_html.length + ' 件');
      if (red(checks.missing_source_refs)) flags.push('出典 id の不一致 ' + checks.missing_source_refs.length + ' 件');
      if (red(checks.missing_claim_refs)) flags.push('claim 参照の不一致 ' + checks.missing_claim_refs.length + ' 件');
      if (red(checks.kakunin_zumi)) flags.push('「確認済み」 ' + checks.kakunin_zumi.length + ' 件');
      var vstat = v.verification_status;
      view.innerHTML = '<h1>' + esc(d.material ? d.material.title : '') + ' v' + esc(v.version) + '</h1>' +
        '<div class="card"><div class="row">' + pill('版: ' + v.status, v.status === 'approved' ? 'green' : v.status === 'rejected' ? 'red' : 'orange') +
        pill('検証: ' + vstat, vstat === 'done' ? 'green' : vstat === 'failed' ? 'red' : 'yellow') +
        (verification ? '<span class="muted">attempt ' + esc(verification.attempt) + ' / 確か ' + esc(verification.confirmed) + ' 仮説 ' + esc(verification.hypothesis) + ' 未確認 ' + esc(verification.unverified) + ' 食い違い ' + esc(verification.contradicted) + '</span>' : '') +
        (isReview && (vstat === 'done' || vstat === 'failed') ? '<button type="button" class="btn small" id="reverify-btn">再検証</button>' : '') +
        (d.job && d.job.console_url ? '<a href="' + esc(d.job.console_url) + '" target="_blank" rel="noopener noreferrer">Console</a>' : '') +
        '<a href="#/material/' + esc(v.material_id) + '">素材へ</a></div>' +
        '<p>費用: 制作 ' + fmtCents(v.list_cost_cents) + ' / 検証 ' + fmtCents(d.verify_cost_cents) + ' ・ 採点: ' + esc(v.grader_result || '—') + (v.grader_explanation ? ' — ' + esc(v.grader_explanation) : '') + '</p>' +
        (flags.length ? '<p class="err">機械検査: ' + esc(flags.join(' / ')) + '</p>' : '<p class="ok pill">機械検査: 赤印なし</p>') +
        (verification && verification.overall_note ? '<p class="muted">検証係のメモ: ' + esc(verification.overall_note) + '</p>' : '') + '</div>' +
        partsHtml +
        '<div class="card"><h2>主張（claims）</h2>' + claimsHtml + '</div>' +
        '<div class="card"><h2>出典（sources）</h2>' + sourcesHtml + '</div>' +
        '<div class="grid2"><div class="card"><h2>adapt-rules.md</h2>' + renderMd(v.adapt_rules_md) + '</div><div class="card"><h2>selfcheck.md</h2>' + renderMd(v.selfcheck_md) + '</div></div>' +
        '<div class="card"><h2>機械検査の詳細（checks_json）</h2><pre>' + esc(JSON.stringify(checks, null, 2)) + '</pre></div>' +
        (isReview ? '<form id="decide-form" class="card checklist"><h2>確認</h2>' + CHECKLIST.map(function (c) {
          return '<div class="item"><b>' + esc(c[1]) + '</b><div class="opts">' +
            ['ok', 'ng', 'na'].map(function (r) { return '<label><input type="radio" name="ck-' + c[0] + '" value="' + r + '"> ' + (r === 'ok' ? 'OK' : r === 'ng' ? 'NG' : '該当なし') + '</label>'; }).join('') +
            '</div><input type="text" data-note="' + c[0] + '" placeholder="メモ（任意）"></div>';
        }).join('') +
        '<label class="field"><span>理由（差し戻し・却下は必須）</span><textarea id="d-note" rows="3"></textarea></label>' +
        '<label class="field"><span>差し戻し時の注文票への追記（任意）</span><textarea id="d-append" rows="3"></textarea></label>' +
        '<p id="approve-why" class="muted"></p>' +
        '<div class="row end"><button type="button" class="btn danger" id="reject-btn">却下する</button><button type="button" class="btn" id="return-btn">差し戻す</button><button type="button" class="btn primary" id="approve-btn" disabled>承認する</button></div></form>' : '');

      // 変奏切替
      Array.prototype.forEach.call(view.querySelectorAll('[data-path]'), function (b) {
        b.addEventListener('click', function () {
          var pi = b.getAttribute('data-part');
          Array.prototype.forEach.call(view.querySelectorAll('[data-part="' + pi + '"]'), function (x) { x.classList.toggle('on', x === b); });
          var body = $('#part-body-' + pi);
          body.innerHTML = '<p class="loading">読み込み中…</p>';
          fetchText(fileBase + b.getAttribute('data-path')).then(function (t) { body.innerHTML = renderMd(t); }, function (e) { body.innerHTML = '<p class="err">' + esc(e.message) + '</p>'; });
        });
        if (b.getAttribute('data-first')) b.click();
      });
      var rv = $('#reverify-btn');
      if (rv) rv.addEventListener('click', function () {
        action(rv, { title: '検証をやり直します', body: '次の cron（10 分ごと）で検証係が動きます。費用がかかります。', run: function () { return api('POST', '/api/review/' + encodeURIComponent(vid) + '/reverify'); }, success: '再検証を予約しました' });
      });
      var form = $('#decide-form');
      if (!form) return;
      function checklist() {
        var out = {}, complete = true, ng = false;
        CHECKLIST.forEach(function (c) {
          var sel = form.querySelector('input[name="ck-' + c[0] + '"]:checked');
          if (!sel) complete = false; else if (sel.value === 'ng') ng = true;
          out[c[0]] = { result: sel ? sel.value : null, note: form.querySelector('[data-note="' + c[0] + '"]').value };
        });
        return { value: out, complete: complete, ng: ng };
      }
      function refreshApprove() {
        var c = checklist();
        var why = [];
        if (!c.complete) why.push('6 項目をすべて選ぶ');
        if (c.ng) why.push('NG を無くす');
        if (vstat !== 'done') why.push('検証が done になるのを待つ');
        if (hasContra) why.push('食い違いの主張がある（差し戻してください）');
        $('#approve-btn').disabled = why.length > 0;
        $('#approve-why').textContent = why.length ? '承認するには: ' + why.join(' / ') : '承認できます';
      }
      form.addEventListener('change', refreshApprove);
      refreshApprove();
      function decide(btn, decision, title, body) {
        var c = checklist();
        var note = $('#d-note').value;
        if (decision !== 'approve' && !note.trim()) { toast('理由を入力してください', true); $('#d-note').focus(); return; }
        action(btn, {
          title: title, body: body,
          run: function () {
            return api('POST', '/api/review/' + encodeURIComponent(vid) + '/decision', {
              decision: decision, checklist: c.value, note: note, brief_append: $('#d-append').value, verification_id: d.verification_id
            });
          },
          success: decision === 'approve' ? '承認しました' : decision === 'return' ? '差し戻しました' : '却下しました'
        });
      }
      $('#approve-btn').addEventListener('click', function () { decide(this, 'approve', 'この版を承認して配信します', '承認すると配信 API に出ます。'); });
      $('#return-btn').addEventListener('click', function () { decide(this, 'return', 'この版を差し戻します', '理由を添えて改善 job を注文します（rework）。'); });
      $('#reject-btn').addEventListener('click', function () { decide(this, 'reject', 'この版を却下します', '配信の状態は変わりません。'); });
    }, function (e) { view.innerHTML = '<p class="err">読み込めませんでした: ' + esc(e.message) + '</p>'; });
  }

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
    loadStatus();
    if (!p.length) return viewMaterials(view, r.q);
    if (p[0] === 'new') return viewNew(view);
    if (p[0] === 'material' && p[1]) return viewMaterial(view, p[1]);
    if (p[0] === 'job' && p[1]) return viewJob(view, p[1]);
    if (p[0] === 'review' && p[1]) return viewReview(view, p[1]);
    if (p[0] === 'review') return viewReviewList(view);
    if (p[0] === 'standards') return viewStandards(view);
    view.innerHTML = '<p class="muted">ページが見つかりません。<a href="#/">素材へ</a></p>';
  }
  window.addEventListener('hashchange', route);
  route();
})();
