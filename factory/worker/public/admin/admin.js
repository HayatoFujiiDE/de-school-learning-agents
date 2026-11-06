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
    bad_origin: '送信元が正しくありません',
    not_budget_reached: '予算の上限で止まっている状態ではありません。読み込み直してください',
    job_budget_cap: '1 つの作業の予算は $50.00 までです',
    daily_cap: '今日の費用の上限を超えるため、予算を増やせません',
    raise_failed: '予算を増やせませんでした。予算は変わっていません',
    raise_unknown: 'Anthropic から返事がなく、予算が増えたか分かりません（増えている可能性があります）。「状態を取り込む」で確かめてから押し直してください',
    invalid_add_cents: '増やす額は $5 / $10 / $20 のどれかです',
    invalid_note: 'メモは 200 字までです',
    dispatched_remain: '生成中の画像が残っているため、まだ再開できません。生成が終わってから（10 分ごとの定期処理で進みます）押し直してください',
    not_halted: '画像の生成は止まっていません',
    not_configured: 'Gemini の鍵が設定されていません（鍵の投入はセッションの外で行います）',
    already_probed: '同じ動画・区間の probe は実行済みです',
    cap_reached: '動画の記帳が月または日の上限に届いています'
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
        intakeStatusHtml(s) + imagesBandHtml(s.images) + videosBandHtml(s.videos);
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

  // ---- 画像の生成（§O-5 e）。金額・停止の理由・一覧は読むだけ。書き込みは「止める」「再開する」だけ ----
  var HALT_TEXT = {
    manual: '手で止めました',
    over_reserve: '1 枚の実額が予約額を超えました',
    usage_missing: '1 枚の費用が分かりませんでした',
    result_unknown: '結果が分からない生成があります',
    quota: 'OpenAI の残高か上限に達しました',
    auth: 'OpenAI の鍵が使えません'
  };
  var IMAGE_STATE = {
    queued: ['順番待ち', ''], dispatched: ['生成中', 'orange'], done: ['完成', 'green'], refused: ['断った', 'gray'], failed: ['失敗', 'red']
  };
  var GEN_PROMPT_MAX = 80;
  /** 停止の理由コード（over_reserve:<id> 等）→ 画面の文（§O-5 d）。表に無いコードはそのまま */
  function haltText(code) {
    if (!code) return '';
    var k = String(code).split(':')[0];
    return Object.prototype.hasOwnProperty.call(HALT_TEXT, k) ? HALT_TEXT[k] : String(code);
  }
  function cents(c) { return c === null || c === undefined ? '—' : esc(c) + '¢'; }
  /** 予備の鍵を最後に使った時刻が、now から 7 日以内か（§O-13 5 の状況帯の印） */
  var BACKUP_RECENT_MS = 7 * 24 * 60 * 60 * 1000;
  function backupUsedRecently(t, nowMs) {
    if (!t) return false;
    var ts = Date.parse(String(t));
    return isFinite(ts) && nowMs - ts <= BACKUP_RECENT_MS;
  }
  /** 状況帯の 1 行（§O-5 e）。images が無い応答（古い Worker）では何も出さない。nowMs はテストの時だけ渡す */
  function imagesBandHtml(im, nowMs) {
    if (!im || typeof im !== 'object') return '';
    var now = typeof nowMs === 'number' ? nowMs : Date.now();
    return '<span class="item" data-img-band="1">画像: 今月 <b>' + cents(im.month_cents) + '</b> / ' + cents(im.month_cap_cents) + '<span class="muted">（U で数えた記帳）</span></span>' +
      (im.halted ? '<span class="item" data-img-halted="1">' + pill('画像の生成を止めています（' + haltText(im.halted) + '）', 'red') + '</span>' : '') +
      (backupUsedRecently(im.backup_last_used_at, now)
        ? '<a class="item" href="#/images" data-img-backup-band="1">' + pill('画像: 予備の鍵を使いました（' + fmtTime(im.backup_last_used_at) + '）', 'orange') + '</a>'
        : '') +
      '<a class="item" href="#/images">' + (im.halted ? '画像の停止を見る' : '画像の生成') + '</a>';
  }
  /** 確認画面のサムネイルの下の 1 行（§O-7 6）: 「生成: {accuracy}・{prompt の先頭 80 字}」 */
  function genCaption(g) {
    var chars = Array.from(String((g && g.prompt) || ''));
    var head = chars.slice(0, GEN_PROMPT_MAX).join('') + (chars.length > GEN_PROMPT_MAX ? '…' : '');
    return '生成: ' + String((g && g.accuracy) || '—') + '・' + head;
  }
  function imagesLoadingHtml() { return '<h1>画像の生成</h1><p class="loading" data-img-loading="1">読み込み中…</p>'; }
  function imagesErrorHtml(msg) {
    return '<h1>画像の生成</h1><div class="card" data-img-error="1"><p class="err">読み込めませんでした: ' + esc(msg) + '</p><p><button type="button" class="btn" id="img-retry">もう一度読み込む</button></p></div>';
  }
  function imageRowHtml(r) {
    var over = typeof r.actual_cents === 'number' && typeof r.u_cents === 'number' && r.actual_cents > r.u_cents;
    var st = IMAGE_STATE[r.state] || [r.state, ''];
    return '<tr data-img-row="1"' + (over ? ' class="img-over-row" data-img-over="1"' : '') + '>' +
      '<td>' + esc(fmtTime(r.created_at)) + '</td>' +
      '<td>' + pill(st[0], st[1]) + (r.error ? ' <code class="muted">' + esc(r.error) + '</code>' : '') + '</td>' +
      '<td><a href="#/job/' + esc(r.job_id) + '">作業</a></td>' +
      '<td>' + esc(r.model || '—') + '<br><span class="muted">' + esc(r.size || '—') + '・' + esc(r.quality || '—') + '</span></td>' +
      '<td>' + cents(r.u_cents) + '</td>' +
      '<td' + (over ? ' class="img-over"' : '') + '>' + cents(r.actual_cents) + (over ? ' ' + pill('予約額を超えています', 'red') : '') + '</td>' +
      '<td>' + (r.state === 'done' ? '<a href="/api/images/requests/' + encodeURIComponent(r.request_id) + '/file" target="_blank" rel="noopener noreferrer">見る</a>' : '<span class="muted">—</span>') + '</td></tr>';
  }
  /** #/images の本体（GET /api/images/status の応答から描く純関数） */
  function imagesHtml(d) {
    var halted = d.halted || null;
    var recent = Array.isArray(d.recent) ? d.recent : [];
    var disp = Number(d.dispatched || 0);
    var stateHtml = halted
      ? '<p>' + pill('止めています', 'red') + ' <b data-img-reason="1">' + esc(haltText(halted)) + '</b> <code class="muted">' + esc(halted) + '</code></p>' +
        '<p class="muted">新しい画像は断り、職人には「今は画像を作れません」と返しています。再開は「再開する」を押すまで自動ではされません。</p>' +
        (disp > 0 ? '<p class="err" data-img-disp="1">生成中の画像が ' + esc(disp) + ' 枚あります。終わるまで再開できません（10 分ごとの定期処理で進みます）。</p>' : '')
      : '<p>' + pill('生成できます', 'green') + '</p>';
    // §O-13 5: 予備の鍵は有無と最後に使った時刻だけ（値は Worker も返さない）
    var backupHtml =
      '<p data-img-backup="' + (d.backup_configured === true ? 'yes' : 'no') + '">予備の鍵: ' + (d.backup_configured === true ? 'あり' : 'なし') + '</p>' +
      '<p data-img-backup-used="1">予備の鍵を最後に使った: ' + (d.backup_last_used_at ? esc(fmtTime(d.backup_last_used_at)) : 'まだ無い') + '</p>';
    return '<h1>画像の生成</h1>' +
      '<div class="card" data-img-state="' + (halted ? 'halted' : 'running') + '"><h2>停止の状態</h2>' + stateHtml + backupHtml +
        '<div class="row">' +
          '<button type="button" class="btn danger" id="img-halt-btn"' + (halted ? ' disabled' : '') + '>止める</button>' +
          '<button type="button" class="btn primary" id="img-unhalt-btn"' + (halted ? '' : ' disabled') + '>再開する</button>' +
        '</div></div>' +
      '<div class="card"><h2>今月の画像の記帳</h2>' +
        '<p><b>' + cents(d.month_cents) + '</b> / ' + cents(d.month_cap_cents) + ' <span class="muted">（U で数えた記帳。U = 1 枚の予約額。OpenAI の実際の請求とは違うことがあります）</span></p>' +
        '<p class="muted">取り置き中の作業 ' + esc(Number(d.holds_open || 0)) + ' 件・生成中 ' + esc(disp) + ' 枚</p></div>' +
      '<div class="card"><h2>最近の 20 件</h2>' +
        (recent.length
          ? '<div class="table-wrap"><table class="img-table"><thead><tr><th>時刻</th><th>状態</th><th>作業</th><th>モデル</th><th>U</th><th>実額</th><th>画像</th></tr></thead><tbody>' +
            recent.map(imageRowHtml).join('') + '</tbody></table></div><p class="muted">記帳と監査の記録なので、ここからは消せません。</p>'
          : '<p class="muted" data-img-empty="1">まだありません</p>') +
      '</div>';
  }
  function viewImages(view) {
    view.innerHTML = imagesLoadingHtml();
    var here = location.hash;
    api('GET', '/api/images/status').then(function (d) {
      if (location.hash !== here) return; // 読み込み中に別の画面へ移った
      view.innerHTML = imagesHtml(d);
      var hb = $('#img-halt-btn'), ub = $('#img-unhalt-btn');
      hb.addEventListener('click', function () {
        action(hb, {
          title: '新しい画像の生成を止めます',
          body: '順番待ちの画像は断り、職人には「今は画像を作れません」と返します。生成中の画像（最大 2 枚）は最後まで進みます。止めた後は「再開する」を押すまで止まったままです。',
          okText: '止める', busyText: '処理中…',
          run: function () { return api('POST', '/api/images/halt'); },
          success: '画像の生成を止めました',
          fail: function () { route(); }
        });
      });
      ub.addEventListener('click', function () {
        action(ub, {
          title: '画像の生成を再開します',
          body: 'OpenAI の利用画面で実額を確かめてから押してください',
          okText: '再開する', busyText: '処理中…',
          run: function () { return api('POST', '/api/images/unhalt'); },
          success: '画像の生成を再開しました',
          fail: function () { route(); }
        });
      });
    }, function (e) {
      if (location.hash !== here) return;
      view.innerHTML = imagesErrorHtml(e.message);
      var b = $('#img-retry');
      if (b) b.addEventListener('click', route);
    });
  }

  // ---- 画面: 動画の確認（Gemini。§Q-9.5）----
  /** probe の clip_accepted の意味（src/routes/videos.ts の PROBE_CLIP_ACCEPTED_LABEL と同じ文） */
  var PROBE_CLIP_ACCEPTED_LABEL = 'API が区間つきの要求を受けて本文を返したか（中身が区間どおりかは司令塔が text_head で判断）';
  /** 状況帯の 1 行。videos が無い応答（古い Worker）では何も出さない */
  function videosBandHtml(vi) {
    if (!vi || typeof vi !== 'object') return '';
    return '<a class="item" href="#/videos" data-video-band="1">動画の確認 ' + (vi.enabled ? pill('有効', 'green') : pill('無効', 'gray')) + '</a>';
  }
  function videosLoadingHtml() { return '<h1>動画の確認（Gemini）</h1><p class="loading" data-video-loading="1">読み込み中…</p>'; }
  function videosErrorHtml(msg) {
    return '<h1>動画の確認（Gemini）</h1><div class="card" data-video-error="1"><p class="err">読み込めませんでした: ' + esc(msg) + '</p><p><button type="button" class="btn" id="video-retry">もう一度読み込む</button></p></div>';
  }
  /** #/videos の本体（GET /api/videos/status の応答から描く純関数） */
  function videosAdminHtml(d) {
    var enabled = !!(d && d.enabled), configured = !!(d && d.configured);
    var stateHtml = enabled
      ? '<p>' + pill('有効', 'green') + ' 検証のたびに、版の動画 1 本につき 1 回だけ（その版で 1 回きり）Gemini に区間を見せて記録を作ります。</p>'
      : '<p>' + pill('無効', 'gray') + ' Gemini は呼びません（版の動画は「未確認（記録なし）」になります）。</p>' +
        '<p class="muted">probe（POST /api/probe/video）の結果で、区間の指定が中身に効いていると確かめてから有効にしてください。</p>' +
        (configured ? '' : '<p class="err" data-video-nokey="1">Gemini の鍵が設定されていないため、有効にできません。</p>');
    return '<h1>動画の確認（Gemini）</h1>' +
      '<div class="card" data-video-state="' + (enabled ? 'enabled' : 'disabled') + '"><h2>状態</h2>' + stateHtml +
        '<div class="row"><button type="button" class="btn primary" id="video-enable-btn"' + (enabled || !configured ? ' disabled' : '') + '>動画の確認を有効にする</button></div></div>' +
      '<div class="card"><h2>今月の動画の記帳</h2>' +
        '<p><b>' + cents(d && d.month_cents) + '</b> / ' + cents(d && d.month_cap_cents) + ' <span class="muted">（1 回 ' + cents(d && d.u_cents) + ' の取り置きで数えた記帳。Gemini の実際の請求とは違うことがあります）</span></p>' +
        '<p class="muted">モデル ' + esc((d && d.model) || '—') + '</p></div>' +
      '<div class="card" data-video-probe-help="1"><h2>probe（POST /api/probe/video）の見方</h2><ul>' +
        '<li><code>status</code>: HTTP の status（応答が無ければ null）</li>' +
        '<li><code>clip_accepted</code>: ' + esc(PROBE_CLIP_ACCEPTED_LABEL) + '。true = 受けて本文を返した / false = API が断った（4xx）/ null = それ以外（5xx・応答なし・形の違い）</li>' +
        '<li><code>usage_present</code>: 応答に usage の数字があったか</li>' +
        '<li><code>text_head</code>: Gemini の記録の先頭 300 字</li>' +
        '<li><code>error_code</code>: 失敗の固定コード（成功は null）</li></ul></div>';
  }
  function viewVideos(view) {
    view.innerHTML = videosLoadingHtml();
    var here = location.hash;
    api('GET', '/api/videos/status').then(function (d) {
      if (location.hash !== here) return;
      view.innerHTML = videosAdminHtml(d);
      var eb = $('#video-enable-btn');
      eb.addEventListener('click', function () {
        action(eb, {
          title: '動画の確認を有効にします',
          body: 'これから検証する版の動画を、1 本につき 1 回だけ Gemini に見せます（1 回 ' + String(d.u_cents) + '¢ を取り置き、月 ' + String(d.month_cap_cents) + '¢ まで）。ここからは無効に戻せません。',
          okText: '有効にする', busyText: '処理中…',
          run: function () { return api('POST', '/api/videos/enable'); },
          success: '動画の確認を有効にしました',
          fail: function () { route(); }
        });
      });
    }, function (e) {
      if (location.hash !== here) return;
      view.innerHTML = videosErrorHtml(e.message);
      var b = $('#video-retry');
      if (b) b.addEventListener('click', route);
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

  // ---- 画面: 工場（§N-3 / §N-6）。読み取り専用。書き込み操作は置かず、既存の画面へ送る ----
  // 場面（背景・キャラ・名札・状態札・矢印）の座標と持ち場の判定は floor-scene.js（window.FactoryFloorScene）。ここは DOM と表だけ
  var FLOOR_POLL_MS = 15000;
  var FLOOR_ATT = [['answer', '回答待ち', 'yellow'], ['review', '確認待ち', 'yellow'], ['failed', '失敗', 'red'], ['budget', '予算の上限', 'yellow']];
  var FLOOR_ATT_LABEL = { answer: '回答待ち', review: '確認待ち', failed: '失敗', budget: '予算の上限' };
  var FLOOR_STATE_LABEL = { done: '済み', active: '進行中', waiting: 'あなたの番', failed: '失敗', pending: 'これから', skipped: 'なし' };
  var SVGNS = 'http://www.w3.org/2000/svg';
  // timer は 1 つだけ。gen は画面を開き直すたびに増え、古い応答を捨てる。inflight は取得中の gen（同じ gen で二重に取りに行かない）
  // filter = 絞り込み中の持ち場 id、open = ▶ で詳細を開いている素材 id、prevSt = 前回の持ち場の札（変わったら 1 回跳ねる）
  // menuOpen = 表の「…」の説明を開いている、userScrolled = 人が場面を横にスクロールした（以後は自動で送らない）、resizeObs = 札の寄せ直し用
  var floor = { active: false, gen: 0, timer: null, inflight: null, data: null, prev: null, errAt: null, bandHtml: null, filter: null, open: {}, prevSt: null,
    menuOpen: false, userScrolled: false, autoScrollAt: 0, resizeObs: null };

  function floorScene() { return window.FactoryFloorScene || null; }
  function hhmm(d) { var p = function (n) { return (n < 10 ? '0' : '') + n; }; return p(d.getHours()) + ':' + p(d.getMinutes()); }

  // 線のアイコン（24 × 24。色は CSS の currentColor）
  var ICON_PATH = {
    book: 'M2.5 5.5C5 4.3 8.7 4.2 12 6.2c3.3-2 7-1.9 9.5-.7v13.3c-2.5-1.2-6.2-1.3-9.5.7-3.3-2-7-1.9-9.5-.7Z M12 6.2v13.3',
    pencil: 'M15.6 4.4l4 4L8.2 19.8 3.5 20.5l.7-4.7Z M13.4 6.6l4 4',
    list: 'M5 3.5h14a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V5A1.5 1.5 0 0 1 5 3.5Z M7.8 8.5h.01 M11 8.5h5.5 M7.8 12h.01 M11 12h5.5 M7.8 15.5h.01 M11 15.5h5.5',
    search: 'M10.5 3.8a6.7 6.7 0 1 0 0 13.4a6.7 6.7 0 1 0 0-13.4Z M15.5 15.5l5 5',
    check: 'M5 3.5h14a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V5A1.5 1.5 0 0 1 5 3.5Z M7.5 12.3l3.1 3.1 6-6.6',
    bubble: 'M5 4h14a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2h-7.5L7 20.5v-4H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z M7.5 8.5h9 M7.5 12h6',
    box: 'M3.5 8.5h17v10a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5Z M2.5 4.5h19v4h-19Z M10 12.5h4',
    order: 'M9 3.5h6v3H9Z M7 5H5.5v15.5h13V5H17 M8.5 11h7 M8.5 14.5h7 M8.5 18h4',
    doc: 'M6 3h8.5L19 7.5V21H6Z M14 3v5h5 M9 12h7 M9 15.5h7 M9 8.5h2.5',
    app: 'M3.5 4.5h17v13h-17Z M3.5 8h17 M6 6.2h.01 M8.2 6.2h.01 M11.5 10.5l6 2.3-2.6 1-1 2.6Z',
    menu: 'M4 6.5h16 M4 12h16 M4 17.5h16',
    tri: 'M8 5.5l10 6.5-10 6.5Z'
  };
  var STEP_ICON = { order: 'order', questions: 'bubble', making: 'pencil', ingest: 'list', verify: 'search', review: 'check', publish: 'box' };
  function iconSvg(name, cls) {
    return '<svg class="scene-ic ' + (cls || '') + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="' + ICON_PATH[name] + '"/></svg>';
  }
  /** 状態の印（緑の塗り丸 ✓ / 「!」丸 / × 丸）。active は回転リング */
  function symHtml(kind) {
    if (kind === 'active' || kind === 'moving') return '<span class="scene-ring" aria-hidden="true"></span>';
    var fg = kind === 'done' ? 'M5.6 10.4l3 3 5.8-6.4' : kind === 'failed' ? 'M7 7l6 6 M13 7l-6 6' : 'M10 5.2v6.2 M10 14.7v.1';
    return '<svg class="scene-sym scene-sym-' + kind + '" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><circle cx="10" cy="10" r="9.5"/><path d="' + fg + '"/></svg>';
  }

  /** 人の番の帯（§N-3 1.）。att = floor.attention、errAt = 更新に失敗した時刻（HH:MM）か null */
  function floorBandHtml(att, errAt) {
    att = att || {};
    var pills = FLOOR_ATT.filter(function (a) { return Number(att[a[0]] || 0) > 0; }).map(function (a) {
      return '<button type="button" class="floor-att ' + a[2] + '" data-floor-goto="' + a[0] + '">' + esc(a[1] + ' ' + att[a[0]]) + '</button>';
    });
    return (pills.length ? '<span class="floor-band-title">あなたの番</span>' + pills.join('') : '<span class="floor-band-calm">あなたの番の作業はありません</span>') +
      (errAt ? '<span class="floor-band-err">更新できませんでした（' + esc(errAt) + '）</span>' : '');
  }

  // ---- 場面（§N-6-1〜§N-6-4）----
  var SCENE_W = 1706, SCENE_H = 600;
  function pctX(x) { return (x / SCENE_W * 100) + '%'; }
  function pctY(y) { return (y / SCENE_H * 100) + '%'; }
  function placeCenter(el, xy) { el.style.left = pctX(xy[0]); el.style.top = pctY(xy[1]); }
  function placeBox(el, x, y, w, h) { el.style.left = pctX(x); el.style.top = pctY(y); el.style.width = pctX(w); el.style.height = pctY(h); }
  function cubicD(a) { return 'M' + a.from.join(' ') + ' C' + a.c1.join(' ') + ' ' + a.c2.join(' ') + ' ' + a.end.join(' '); }
  function cubicLen(a) {
    var len = 0, px = a.from[0], py = a.from[1];
    for (var i = 1; i <= 24; i++) {
      var t = i / 24, u = 1 - t;
      var x = u * u * u * a.from[0] + 3 * u * u * t * a.c1[0] + 3 * u * t * t * a.c2[0] + t * t * t * a.end[0];
      var y = u * u * u * a.from[1] + 3 * u * u * t * a.c1[1] + 3 * u * t * t * a.c2[1] + t * t * t * a.end[1];
      len += Math.sqrt((x - px) * (x - px) + (y - py) * (y - py));
      px = x; py = y;
    }
    return len;
  }
  /** 矢じり（終点の向き = c2 → end）。開いた山形、角丸 */
  function arrowHeadD(a) {
    var dx = a.end[0] - a.c2[0], dy = a.end[1] - a.c2[1];
    var l = Math.sqrt(dx * dx + dy * dy) || 1;
    dx /= l; dy /= l;
    var back = 15, wing = 11;
    var bx = a.end[0] - dx * back, by = a.end[1] - dy * back;
    var r = function (n) { return Math.round(n * 10) / 10; };
    return 'M' + r(bx - dy * wing) + ' ' + r(by + dx * wing) + ' L' + a.end.join(' ') + ' L' + r(bx + dy * wing) + ' ' + r(by - dx * wing);
  }
  function sceneArrowsSvg(S) {
    return '<svg class="scene-arrows" viewBox="0 0 ' + SCENE_W + ' ' + SCENE_H + '" aria-hidden="true" focusable="false">' + S.arrows.map(function (a) {
      var d = cubicD(a), id = 'scene-arrow-p-' + a.id, len = cubicLen(a);
      var dur = Math.max(1.2, len / 95);
      var dots = len < 100 ? [] : len > 220 ? [0, dur / 2] : [0]; // 短い矢印には点を出さない
      return '<g class="scene-arrow' + (a.dashed ? ' dashed' : '') + '" data-arrow="' + esc(a.id) + '">' +
        '<path class="scene-arrow-glow" d="' + d + '"/><path class="scene-arrow-glow" d="' + arrowHeadD(a) + '"/>' +
        '<path class="scene-arrow-line" id="' + id + '" d="' + d + '"/><path class="scene-arrow-sheen" d="' + d + '"/>' +
        '<path class="scene-arrow-head" d="' + arrowHeadD(a) + '"/>' +
        '<g class="scene-arrow-dots">' + dots.map(function (b) {
          return '<circle class="scene-arrow-dot" r="4" cx="0" cy="0"><animateMotion dur="' + dur.toFixed(2) + 's" begin="' + (-b).toFixed(2) + 's" repeatCount="indefinite" keyPoints="0;1" keyTimes="0;1" calcMode="linear"><mpath href="#' + id + '"/></animateMotion></circle>';
        }).join('') + '</g></g>';
    }).join('') + '</svg>';
  }

  // キャラ（§N-6-1）: svg は fetch → DOMParser で解析・無害化して inline（部位の class に CSS が効く）、png は <img>。読めなければ丸いキャラの inline SVG
  var FALLBACK_CHAR_SVG = '<svg class="ch-svg" viewBox="0 0 200 200" aria-hidden="true" focusable="false" fill="none" stroke-linejoin="round" stroke-linecap="round">' +
    '<g class="ch-body"><path d="M44 146 C34 116 52 86 88 84 C122 82 141 104 138 134 C137 152 128 164 114 168 C110 176 102 182 94 180 C88 178 84 174 80 172 C72 176 62 175 58 168 C48 164 44 156 44 146 Z" fill="#ffffff" stroke="#1c1c22" stroke-width="6"/>' +
    '<path d="M50 148 C52 160 60 166 70 166 C64 158 58 150 56 138 Z" fill="#eeedf4"/>' +
    '<g class="ch-eyes"><ellipse cx="100" cy="134" rx="4.6" ry="8" fill="#1c1c22"/><ellipse cx="98.7" cy="130.4" rx="1.4" ry="1.9" fill="#fff"/><ellipse cx="121" cy="131" rx="4.6" ry="8" fill="#1c1c22"/><ellipse cx="119.7" cy="127.4" rx="1.4" ry="1.9" fill="#fff"/></g>' +
    '<g class="ch-hands"><ellipse cx="131" cy="168" rx="6" ry="4.6" fill="#ffffff" stroke="#1c1c22" stroke-width="4.2"/></g></g>' +
    '<g class="ch-laptop"><path d="M102 175 L134 189 L186 173 L182 165 Z" fill="#5b5f6b" stroke="#1c1c22" stroke-width="4.5"/><path d="M138 139 L186 116 L182 166 L132 180 Z" fill="#4d515c" stroke="#1c1c22" stroke-width="5"/><path d="M143 145 L180 127 L177 160 L140 170 Z" fill="#5a5e6a"/></g></svg>';
  var charCache = {}; // キャラ id → { mode: 'svg'|'img'|'fallback', url, root?, promise }
  /**
   * 自サイトのキャラ SVG を解析して無害化する（許可リスト。規則は floor-scene.js の charSvgElementAllowed / charSvgAttrAllowed）。
   * 許可した要素・属性だけを残し、それ以外は中身ごと削除する。style 属性・<style> は残さない。読めなければ null
   */
  function sanitizeCharSvg(text) {
    var S = floorScene();
    if (!S || typeof DOMParser === 'undefined' || !text || text.length > 300000) return null;
    // 解析の前に on* / style 属性と <style> を落としておく（CSP の違反報告が出ないようにするだけ。安全の担保は下の許可リスト）
    text = String(text).replace(/<style[\s\S]*?<\/style\s*>/gi, '').replace(/\s(?:on[a-z]+|style)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    var doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    var svg = doc.documentElement;
    if (!svg || svg.namespaceURI !== SVGNS || svg.localName !== 'svg' || doc.getElementsByTagName('parsererror').length) return null;
    function clean(el) {
      Array.prototype.slice.call(el.childNodes).forEach(function (n) {
        if (n.nodeType === 3) return; // 文字（空白）はそのまま
        if (n.nodeType !== 1 || n.namespaceURI !== SVGNS || !S.charSvgElementAllowed(n.localName)) { el.removeChild(n); return; }
        clean(n);
      });
      Array.prototype.slice.call(el.attributes).forEach(function (a) {
        if (a.namespaceURI || !S.charSvgAttrAllowed(a.name, a.value)) el.removeAttributeNode(a);
      });
    }
    clean(svg);
    return svg;
  }
  function loadChar(id) {
    var c = charCache[id];
    if (c) return c.promise;
    var S = floorScene();
    var ext = S && S.CHAR_EXT === 'png' ? 'png' : 'svg';
    c = charCache[id] = { mode: null, url: '/admin/img/chars/char-' + id + '.' + ext };
    if (ext === 'png' || typeof fetch !== 'function') { c.mode = 'img'; c.promise = Promise.resolve(c); return c.promise; }
    c.promise = fetch(c.url, { credentials: 'same-origin' }).then(function (r) {
      if (!r.ok) throw new Error('http_' + r.status);
      return r.text();
    }).then(function (text) {
      var root = sanitizeCharSvg(text);
      if (root) { c.mode = 'svg'; c.root = root; } else c.mode = 'fallback';
      return c;
    }).catch(function () { c.mode = 'fallback'; return c; });
    return c.promise;
  }
  function mountFallbackChar(holder) { holder.innerHTML = FALLBACK_CHAR_SVG; holder.setAttribute('data-ch-mode', 'fallback'); }
  function mountChar(holder, id) {
    loadChar(id).then(function (c) {
      if (!holder.isConnected) return;
      if (c.mode === 'svg' && c.root) {
        var node = document.importNode(c.root, true);
        node.removeAttribute('width');
        node.removeAttribute('height');
        node.setAttribute('class', 'ch-svg');
        node.setAttribute('aria-hidden', 'true');
        node.setAttribute('focusable', 'false');
        holder.textContent = '';
        holder.appendChild(node);
        holder.setAttribute('data-ch-mode', 'svg');
      } else if (c.mode === 'img') {
        var img = document.createElement('img');
        img.className = 'ch-img';
        img.alt = '';
        img.onerror = function () { c.mode = 'fallback'; if (holder.isConnected) mountFallbackChar(holder); };
        img.src = c.url;
        holder.textContent = '';
        holder.appendChild(img);
        holder.setAttribute('data-ch-mode', 'img');
      } else mountFallbackChar(holder);
    });
  }

  /** 場面の骨組み（1 回だけ作る。状態は renderScene が class と札の中身で反映する） */
  function buildScene(el) {
    var S = floorScene();
    if (!S) { el.innerHTML = ''; return; }
    var SC = S.SCENE;
    el.innerHTML = sceneArrowsSvg(SC);
    var drop = SC.charDrop;
    SC.stations.forEach(function (st, si) {
      var main = st.chars[0];
      // クリック範囲（anchor 中心の楕円。キャラが 2 体なら 2 体の足元の中点）
      var cx = 0, cy = 0;
      st.chars.forEach(function (c) { cx += c.anchor[0]; cy += c.anchor[1]; });
      cx /= st.chars.length; cy /= st.chars.length;
      var hit = document.createElement('button');
      hit.type = 'button';
      hit.className = 'scene-hit';
      hit.setAttribute('data-st', st.id);
      hit.setAttribute('aria-pressed', 'false');
      hit.setAttribute('aria-describedby', 'scene-pill-' + st.id);
      hit.innerHTML = '<span class="sr-only">' + esc(st.name) + '</span>';
      placeBox(hit, cx - st.hit[0] / 2, cy - st.hit[1] / 2, st.hit[0], st.hit[1]);
      el.appendChild(hit);
      var glow = document.createElement('div');
      glow.className = 'scene-glow';
      glow.setAttribute('data-st', st.id);
      glow.setAttribute('aria-hidden', 'true');
      placeBox(glow, cx - st.hit[0] / 2, cy + 8 - st.hit[0] / 4, st.hit[0], st.hit[0] / 2);
      el.appendChild(glow);
      // キャラ
      st.chars.forEach(function (c, ci) {
        var h = document.createElement('div');
        h.className = 'scene-char' + (c.flip ? ' flip' : '');
        h.setAttribute('data-st', st.id);
        h.setAttribute('data-char', c.id);
        var fx = typeof c.footX === 'number' ? c.footX : 0.5;
        placeBox(h, c.anchor[0] - c.size * fx, c.anchor[1] + c.size * drop - c.size, c.size, c.size);
        // 瞬きはキャラごとに周期と遅延をずらす（5〜7 秒に 1 回）
        var k = si * 2 + ci;
        h.style.setProperty('--blink-dur', (5 + (k % 5) * 0.5) + 's');
        h.style.setProperty('--blink-delay', (-(k * 1.7) % 6).toFixed(1) + 's');
        el.appendChild(h);
        mountChar(h, c.id);
      });
      // 机の上の光の粒（動いている時だけ見える）と、人の番の「!」の吹き出し
      var spark = document.createElement('div');
      spark.className = 'scene-spark';
      spark.setAttribute('data-st', st.id);
      spark.setAttribute('aria-hidden', 'true');
      spark.innerHTML = '<i></i><i></i><i></i>';
      placeCenter(spark, [main.anchor[0] + main.size * 0.3, main.anchor[1] - main.size * 0.3]);
      el.appendChild(spark);
      var alert = document.createElement('div');
      alert.className = 'scene-alert';
      alert.setAttribute('data-st', st.id);
      alert.setAttribute('aria-hidden', 'true');
      alert.textContent = '!';
      placeCenter(alert, [main.anchor[0] - main.size * 0.08, main.anchor[1] - main.size * 0.66]);
      el.appendChild(alert);
      if (st.bubble) {
        var bub = document.createElement('div');
        bub.className = 'scene-bubble';
        bub.setAttribute('data-st', st.id);
        bub.setAttribute('aria-hidden', 'true');
        bub.innerHTML = iconSvg('menu');
        placeCenter(bub, st.bubble);
        el.appendChild(bub);
      }
      // 名札（本線 5 つ）
      if (st.tag) {
        var tag = document.createElement('div');
        tag.className = 'scene-pos scene-tag-pos';
        tag.setAttribute('data-st', st.id);
        tag.innerHTML = '<div class="scene-tag">' + (st.icon ? iconSvg(st.icon) : '') + '<span>' + esc(st.name) + '</span></div>';
        placeCenter(tag, st.tag);
        el.appendChild(tag);
      }
      // 状態札
      var pillPos = document.createElement('div');
      pillPos.className = 'scene-pos scene-pill-pos';
      pillPos.setAttribute('data-st', st.id);
      pillPos.innerHTML = '<div class="scene-pill idle' + (st.branch ? ' branch' : '') + '" id="scene-pill-' + esc(st.id) + '"><span class="scene-pill-text"><span class="scene-pill-main">' + esc(st.branch ? st.name : '…') + '</span></span></div>';
      placeCenter(pillPos, st.pill);
      el.appendChild(pillPos);
    });
  }

  function scenePillInner(st, x) {
    var branchIdle = st.branch && x.kind === 'idle';
    var sym = x.kind === 'moving' ? '<span class="scene-ring' + (x.spin === false ? ' still' : '') + '" aria-hidden="true"></span>'
      : x.kind === 'done' ? symHtml('done') : x.kind === 'human' ? symHtml('waiting') : x.kind === 'failed' ? symHtml('failed') : '';
    var subs = '';
    if (x.text2) subs += '<span class="scene-pill-sub">・' + esc(x.text2) + '</span>';
    if (st.back && x.kind === 'moving') subs += '<span class="scene-pill-sub">・↩ 職人へ</span>';
    var bar = typeof x.bar === 'number' ? '<progress class="scene-pill-bar" max="100" value="' + Math.max(0, Math.min(100, x.bar)) + '" aria-label="進み具合 ' + Math.round(x.bar) + '%"></progress>' : '';
    return sym + '<span class="scene-pill-text"><span class="scene-pill-line"><span class="scene-pill-main">' + esc(branchIdle ? st.name : x.text) + '</span>' + subs + '</span>' + bar + '</span>';
  }
  function bump(el) {
    if (!el) return;
    el.classList.remove('jump');
    void el.offsetWidth;
    el.classList.add('jump');
    setTimeout(function () { el.classList.remove('jump'); }, 700);
  }
  /** 状態を場面に反映する（札・キャラの動き・矢印・絞り込みの押下） */
  function renderScene(d) {
    var S = floorScene();
    var root = $('#scene');
    if (!S || !root) return;
    var states = S.stationStates(d);
    var prev = floor.prevSt;
    var next = {};
    S.SCENE.stations.forEach(function (st) {
      var x = states[st.id] || { kind: 'idle', text: '待機' };
      var key = x.kind + '|' + x.text + '|' + (x.text2 || ''); // 変わったら 1 回跳ねる
      var htmlKey = key + '|' + (typeof x.bar === 'number' ? x.bar : '') + '|' + (x.spin === false ? 0 : 1);
      next[st.id] = key;
      var pillEl = root.querySelector('#scene-pill-' + st.id);
      if (pillEl) {
        if (pillEl.getAttribute('data-html') !== htmlKey) {
          pillEl.innerHTML = scenePillInner(st, x);
          pillEl.setAttribute('data-html', htmlKey);
        }
        pillEl.className = 'scene-pill ' + x.kind + (st.branch ? ' branch' : '') + (floor.filter === st.id ? ' on' : '');
      }
      Array.prototype.forEach.call(root.querySelectorAll('[data-st="' + st.id + '"]'), function (n) {
        if (n.classList.contains('scene-char')) {
          n.classList.toggle('is-moving', x.kind === 'moving');
          n.classList.toggle('is-human', x.kind === 'human');
        } else if (n.classList.contains('scene-hit')) {
          n.setAttribute('aria-pressed', floor.filter === st.id ? 'true' : 'false');
        } else if (n.classList.contains('scene-spark')) n.classList.toggle('on', x.kind === 'moving' && x.spin !== false);
        else if (n.classList.contains('scene-alert')) n.classList.toggle('on', x.kind === 'human');
        else if (n.classList.contains('scene-bubble')) n.classList.toggle('on', x.kind === 'moving');
        else if (n.classList.contains('scene-glow')) n.classList.toggle('on', floor.filter === st.id);
        else if (n.classList.contains('scene-tag-pos')) n.firstChild.classList.toggle('on', floor.filter === st.id);
      });
      if (prev && prev[st.id] !== undefined && prev[st.id] !== key) {
        bump(pillEl);
        Array.prototype.forEach.call(root.querySelectorAll('.scene-char[data-st="' + st.id + '"]'), bump);
      }
    });
    floor.prevSt = next;
    S.SCENE.arrows.forEach(function (a) {
      var g = root.querySelector('[data-arrow="' + a.id + '"]');
      if (g) g.classList.toggle('flowing', S.arrowFlowing(a, states));
    });
    clampScenePills();
    autoScrollScene(states);
  }
  /** 札が場面の端からはみ出す時は内側へ寄せる（札の文が長い持ち場・狭い幅のため。座標は SCENE のまま） */
  function clampScenePills() {
    var root = $('#scene');
    if (!root) return;
    var box = root.getBoundingClientRect();
    if (!box.width) return;
    var pad = box.width * 0.006;
    Array.prototype.forEach.call(root.querySelectorAll('.scene-pill-pos, .scene-tag-pos'), function (el) {
      el.style.marginLeft = '0px';
      var r = el.getBoundingClientRect();
      var shift = 0;
      if (r.right > box.right - pad) shift = box.right - pad - r.right;
      else if (r.left < box.left + pad) shift = box.left + pad - r.left;
      if (shift) el.style.marginLeft = Math.round(shift) + 'px';
    });
  }
  /**
   * 880px 未満で場面が横スクロールになる時、最初の「人の番」か「失敗」の持ち場が見える位置まで横に送る（§N-6 差し戻し B12）。
   * 人が一度でもスクロールしたら以後は動かさない（floor.userScrolled）
   */
  function autoScrollScene(states) {
    var S = floorScene();
    var sc = $('#scene-scroll');
    var root = $('#scene');
    if (!S || !sc || !root || floor.userScrolled || sc.scrollWidth <= sc.clientWidth + 1) return;
    var st = S.SCENE.stations.filter(function (x) { var k = states[x.id] && states[x.id].kind; return k === 'human' || k === 'failed'; })[0];
    if (!st) return;
    var x = st.pill[0] / SCENE_W * root.offsetWidth;
    var left = Math.max(0, Math.min(sc.scrollWidth - sc.clientWidth, Math.round(x - sc.clientWidth / 2)));
    if (Math.abs(sc.scrollLeft - left) < 2) return;
    floor.autoScrollAt = Date.now();
    sc.scrollLeft = left;
  }
  function onSceneScroll() {
    if (Date.now() - (floor.autoScrollAt || 0) > 400) floor.userScrolled = true; // 自動で送った直後のスクロール通知は人の操作に数えない
  }
  function stationName(id) {
    var S = floorScene();
    var st = S ? S.SCENE.stations.filter(function (x) { return x.id === id; })[0] : null;
    return st ? st.filterName || st.name : id;
  }
  function renderFilterChip() {
    var b = $('#scene-filter');
    if (!b) return;
    if (!floor.filter) { b.classList.add('hidden'); b.textContent = ''; return; }
    b.classList.remove('hidden');
    b.innerHTML = esc(stationName(floor.filter) + 'にいる素材だけ表示中') + ' <span class="scene-filter-x" aria-hidden="true">✕</span>';
    b.setAttribute('aria-label', stationName(floor.filter) + 'にいる素材だけ表示中。押すと絞り込みを解除します');
  }
  function setFloorFilter(id) {
    floor.filter = id && floor.filter !== id ? id : null;
    renderFilterChip();
    if (floor.data) { renderScene(floor.data); renderQueue(floor.data, false); }
  }

  // ---- 制作キュー（§N-3 5. の中身・リンク、§N-6-5 の見た目）----
  function stepTitle(s) { return s.label + '：' + (FLOOR_STATE_LABEL[s.state] || s.state) + (s.detail ? '（' + s.detail + '）' : ''); }
  function chipArrowHtml(kind, flowing) {
    return '<svg class="fq-arr ' + kind + (flowing ? ' flow' : '') + '" viewBox="0 0 20 12" aria-hidden="true" focusable="false"><path class="fq-arr-l" d="M2 6H15"/>' +
      (flowing ? '<path class="fq-arr-f" d="M2 6H15"/>' : '') + '<path class="fq-arr-h" d="M12 2.6L16 6L12 9.4"/></svg>';
  }
  function chipInner(s) {
    var icon = s.state === 'done' || s.state === 'active' || s.state === 'waiting' || s.state === 'failed' ? symHtml(s.state) : iconSvg(STEP_ICON[s.key] || 'order', 'fq-step-ic');
    return icon + '<span class="fq-chip-t">' + esc(s.label) + '</span>';
  }
  /** 工程チップ 7 個（§N-6-5）。row を渡すと rework の行の「注文」を二段の分岐にする */
  function floorChipsHtml(steps, row) {
    var S = floorScene();
    var job = row && row.job;
    steps = steps || [];
    return '<div class="fq-chips">' + steps.map(function (s, i) {
      var arrow = '';
      if (i > 0) {
        var kind = S ? S.chipArrowKind(steps[i - 1].state, s.state) : 'todo';
        arrow = chipArrowHtml(kind, s.state === 'active');
      }
      var title = stepTitle(s);
      if (i === 0 && job && job.kind === 'rework') {
        var top = '前の版' + (job.parent_version !== null && job.parent_version !== undefined ? ' v' + job.parent_version : '');
        var bottom = job.auto_rework ? '自動の差し戻し' : '差し戻し';
        return '<span class="fq-step fq-step-fork"><span class="floor-chip fq-chip fq-fork ' + esc(s.state) + '" data-step="' + esc(s.key) + '" title="' + esc(title + '・' + top + '・' + bottom) + '" aria-label="' + esc(title + '・' + top + '・' + bottom) + '">' +
          '<span class="fq-fork-col"><span class="fq-sub">' + symHtml('done') + '<span class="fq-chip-t">' + esc(top) + '</span></span>' +
          '<span class="fq-sub">' + symHtml('done') + '<span class="fq-chip-t">' + esc(bottom) + '</span></span></span>' +
          '<svg class="fq-brace" viewBox="0 0 20 60" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path d="M0 15 C11 15 7 30 20 30 M0 45 C11 45 7 30 20 30"/></svg></span></span>';
      }
      return '<span class="fq-step">' + arrow + '<span class="floor-chip fq-chip ' + esc(s.state) + '" data-step="' + esc(s.key) + '" title="' + esc(title) + '" aria-label="' + esc(title) + '">' + chipInner(s) + '</span></span>';
    }).join('') + '</div>';
  }
  function floorRowStatusHtml(r) {
    var steps = r.steps || [];
    var a = r.attention;
    if (a === 'failed') return '<span class="fq-st failed">' + symHtml('failed') + '失敗</span>';
    if (a) return '<span class="fq-st waiting">' + symHtml('waiting') + esc(FLOOR_ATT_LABEL[a] || a) + '</span>';
    if (steps.some(function (x) { return x.state === 'active'; })) return '<span class="fq-st running">' + iconSvg('tri', 'fq-st-ic') + '稼働中</span>';
    if (r.job && r.job.status === 'queued') return '<span class="fq-st ended">順番待ち</span>';
    return '<span class="fq-st ended">終了</span>';
  }
  function floorOpHtml(r) {
    var m = r.material || {}, j = r.job, v = r.version;
    if (r.attention === 'answer' && j) return '<a class="fq-op primary" href="#/job/' + esc(j.id) + '">回答する</a>';
    if (r.attention === 'review' && v) return '<a class="fq-op primary" href="#/review/' + esc(v.id) + '">確認する</a>';
    if (r.attention === 'budget' && j && j.status === 'budget_reached') return '<a class="fq-op primary" href="#/job/' + esc(j.id) + '">増額する</a>';
    if (r.attention === 'failed' && j && j.status === 'failed' && j.error === 'invalid_outputs') return '<a class="fq-op" href="#/job/' + esc(j.id) + '">取り込みをやり直す</a>';
    return '<a class="fq-op" href="#/material/' + esc(m.id) + '">詳細</a>';
  }
  function kindIconHtml(kinds) {
    kinds = Array.isArray(kinds) ? kinds.map(Number) : [];
    var has3 = kinds.indexOf(3) >= 0, has4 = kinds.indexOf(4) >= 0;
    var label = kinds.length ? kinds.map(function (k) { return k === 3 ? '型 3（文書）' : k === 4 ? '型 4（操作できるもの）' : '型 ' + k; }).join('・') : '型なし';
    return '<span class="fq-kind" title="' + esc(label) + '"><span class="sr-only">' + esc(label) + '</span>' + iconSvg(has4 && !has3 ? 'app' : 'doc') + (has3 && has4 ? iconSvg('app', 'scene-ic-sub') : '') + '</span>';
  }
  function floorDetailHtml(r) {
    var m = r.material || {}, j = r.job, v = r.version;
    var steps = (r.steps || []).map(function (s) {
      return '<li class="' + esc(s.state) + '"><b>' + esc(s.label) + '</b> ' + esc(FLOOR_STATE_LABEL[s.state] || s.state) + (s.detail ? '・' + esc(s.detail) : '') + '</li>';
    }).join('');
    var facts = [];
    facts.push('<div><dt>slug</dt><dd>' + esc(m.slug || '—') + '</dd></div>');
    if (j) {
      facts.push('<div><dt>職人の作業</dt><dd>' + esc((j.kind === 'rework' ? (j.auto_rework ? '自動の作り直し' : '作り直し') : '注文') + '・' + (JOB_LABEL[j.status] || j.status)) +
        (j.kind === 'rework' && j.parent_version !== null && j.parent_version !== undefined ? '（前の版 v' + esc(j.parent_version) + '）' : '') + '</dd></div>');
      if (j.last_error || j.error) facts.push('<div><dt>最後のエラー</dt><dd class="err">' + esc(j.last_error || j.error) + '</dd></div>');
    }
    if (v) {
      facts.push('<div><dt>版</dt><dd>v' + esc(v.version) + '・' + esc(v.status) + '</dd></div>');
      if (v.needs_review !== null && v.needs_review !== undefined) facts.push('<div><dt>要確認</dt><dd>' + esc(v.needs_review) + ' 件' + (v.auto_ok !== null && v.auto_ok !== undefined ? '（自動で OK ' + esc(v.auto_ok) + ' 項目）' : '') + '</dd></div>');
    }
    var links = ['<a href="#/material/' + esc(m.id) + '">素材の詳細</a>'];
    if (j) links.push('<a href="#/job/' + esc(j.id) + '">職人の作業</a>');
    if (v && v.status === 'review') links.push('<a href="#/review/' + esc(v.id) + '">確認画面</a>');
    return '<div class="fq-detail-in"><ul class="fq-detail-steps">' + steps + '</ul><dl class="fq-facts">' + facts.join('') + '</dl><p class="fq-links">' + links.join('') + '</p></div>';
  }
  var FQ_ORDER_NOTE = '並び順: あなたの番（回答待ち・確認待ち・失敗・予算の上限）→ 動いている → 24 時間以内に終わった。同じまとまりの中は更新の新しい順（最大 100 件）。' +
    '▶ で工程ごとの詳細を開きます。場面の持ち場を押すと、その持ち場にいる素材だけを表示します。';
  /** 見出し「≡ 制作キュー（N件）」と右端の「…」（並び順の説明を出す小さなポップオーバー） */
  function fqHeadHtml(count, menuOpen) {
    return '<div class="fq-head">' + iconSvg('menu', 'fq-menu') + '<h2 id="fq-h">制作キュー' + (count === null ? '' : '<span class="fq-count">（' + count + '件）</span>') + '</h2>' +
      '<div class="fq-more"><button type="button" class="fq-more-btn" data-fq-menu="1" aria-expanded="' + (menuOpen ? 'true' : 'false') + '" aria-controls="fq-more-pop" aria-label="表の並び順の説明">' +
      '<span aria-hidden="true">…</span></button><div id="fq-more-pop" class="fq-pop" role="note"' + (menuOpen ? '' : ' hidden') + '>' + esc(FQ_ORDER_NOTE) + '</div></div></div>';
  }
  /** 制作キュー（見出し + 表）。opts = { filter: 持ち場 id | null, open: { 素材 id: true }, menuOpen }。0 件なら案内 */
  function floorQueueHtml(queue, opts) {
    opts = opts || {};
    queue = queue || [];
    var S = floorScene();
    var rows = opts.filter && S ? queue.filter(function (r) { return S.rowStations(r).indexOf(opts.filter) >= 0; }) : queue;
    var head = fqHeadHtml(rows.length, !!opts.menuOpen);
    if (!queue.length) {
      return head + '<div class="fq-empty"><p>動いている素材はありません。新しい素材を注文するか、提案箱から採択してください</p>' +
        '<div class="row"><a class="btn primary" href="#/new">新しい素材を注文する</a><a class="btn" href="#/proposals">提案箱を見る</a></div></div>';
    }
    if (!rows.length) {
      return head + '<div class="fq-empty"><p>' + esc(stationName(opts.filter)) + 'にいる素材はありません</p><button type="button" class="btn" data-fq-clear="1">絞り込みを解除</button></div>';
    }
    var open = opts.open || {};
    return head + '<div class="fq-wrap"><table class="fq-table"><colgroup><col class="fq-c-name"><col class="fq-c-steps"><col class="fq-c-prog"><col class="fq-c-status"><col class="fq-c-op"></colgroup><thead><tr><th scope="col">コンテンツ名</th><th scope="col">進行状況（制作ステップ）</th><th scope="col">進捗</th><th scope="col">ステータス</th><th scope="col">操作</th></tr></thead><tbody>' +
      rows.map(function (r) {
        var m = r.material || {}, v = r.version;
        var pct = Math.max(0, Math.min(100, Number(r.progress_pct || 0)));
        var isOpen = !!open[m.id];
        var did = 'fq-d-' + esc(m.id);
        return '<tr class="fq-row' + (r.attention ? ' att' : '') + (isOpen ? ' open' : '') + '" data-floor-row="' + esc(m.id) + '"' + (r.attention ? ' data-floor-att="' + esc(r.attention) + '"' : '') + '>' +
          '<td class="fq-name"><div class="fq-name-in"><button type="button" class="fq-toggle" data-fq-open="' + esc(m.id) + '" aria-expanded="' + (isOpen ? 'true' : 'false') + '"' + (isOpen ? ' aria-controls="' + did + '"' : '') + '>' +
          iconSvg('tri') + '<span class="sr-only">' + (isOpen ? '詳細を閉じる' : '詳細を開く') + '</span></button>' + kindIconHtml(m.kinds) +
          '<a class="fq-title" href="#/material/' + esc(m.id) + '">' + esc(m.title) + '</a>' + (v ? '<span class="fq-ver">v' + esc(v.version) + '</span>' : '') + '</div></td>' +
          '<td class="fq-steps">' + floorChipsHtml(r.steps, r) + '</td>' +
          '<td class="fq-prog"><div class="fq-prog-in"><progress class="fq-bar" max="100" value="' + pct + '" aria-label="進捗 ' + pct + '%"></progress><b>' + pct + '%</b></div></td>' +
          '<td class="fq-status">' + floorRowStatusHtml(r) + '</td>' +
          '<td class="fq-opcell">' + floorOpHtml(r) + '</td></tr>' +
          (isOpen ? '<tr class="fq-detail' + (r.attention ? ' att' : '') + '" id="' + did + '" data-fq-detail="' + esc(m.id) + '"><td colspan="5">' + floorDetailHtml(r) + '</td></tr>' : '');
      }).join('') + '</tbody></table></div>';
  }
  function floorSkeletonHtml() {
    var row = '<div class="floor-skel"><i></i><i></i><i></i></div>';
    return fqHeadHtml(null, false) + row + row + row;
  }
  function floorRowKey(r) { return (r.steps || []).map(function (x) { return x.state; }).join(','); }

  function floorFlash(el) {
    if (!el) return;
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
    setTimeout(function () { el.classList.remove('flash'); }, 1500);
  }

  function findAttRow(kind) { return document.querySelector('#floor-queue [data-floor-att="' + kind + '"]'); }
  function renderFloorBand() {
    var el = $('#floor-band');
    if (!el) return;
    var html = floorBandHtml(floor.data ? floor.data.attention : null, floor.errAt);
    if (floor.data === null && !floor.errAt) html = '<span class="muted">読み込み中…</span>';
    if (html === floor.bandHtml) return; // 同じ内容は書き直さない（aria-live が毎回読み上げないように）
    floor.bandHtml = html;
    el.innerHTML = html;
    Array.prototype.forEach.call(el.querySelectorAll('[data-floor-goto]'), function (btn) {
      btn.addEventListener('click', function () {
        var kind = btn.getAttribute('data-floor-goto');
        var row = findAttRow(kind);
        if (!row && floor.filter) { setFloorFilter(null); row = findAttRow(kind); } // 絞り込みで隠れていたら解除してから探す
        if (!row) return;
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        floorFlash(row);
      });
    });
  }
  /** 制作キューを描き直す。flashChanged = 前回から工程が変わった行を光らせる（自動更新の時だけ） */
  function renderQueue(d, flashChanged) {
    var q = $('#floor-queue');
    if (!q) return;
    q.classList.remove('loading');
    q.innerHTML = floorQueueHtml(d.queue, { filter: floor.filter, open: floor.open, menuOpen: floor.menuOpen });
    if (!flashChanged) return;
    var prev = floor.prev;
    var next = {};
    (d.queue || []).forEach(function (r) {
      var id = r.material && r.material.id;
      next[id] = floorRowKey(r);
      if (prev && Object.prototype.hasOwnProperty.call(prev, id) && prev[id] !== next[id]) {
        var row = Array.prototype.filter.call(q.querySelectorAll('[data-floor-row]'), function (el) { return el.getAttribute('data-floor-row') === id; })[0];
        floorFlash(row);
      }
    });
    floor.prev = next;
  }
  function renderFloor(d) {
    floor.data = d;
    renderFloorBand();
    renderScene(d);
    renderQueue(d, true);
    var upd = $('#floor-updated');
    if (upd) upd.textContent = '更新 ' + hhmm(new Date());
  }
  function setFloorMenu(open, focusBtn) {
    floor.menuOpen = !!open;
    var btn = $('#floor-queue [data-fq-menu]'), pop = $('#fq-more-pop');
    if (btn) btn.setAttribute('aria-expanded', floor.menuOpen ? 'true' : 'false');
    if (pop) pop.hidden = !floor.menuOpen;
    if (focusBtn && btn) btn.focus();
  }
  function onFloorKey(e) {
    if (e.key === 'Escape' && floor.menuOpen) setFloorMenu(false, true);
  }
  function onFloorClick(e) {
    var t = e.target && e.target.closest ? e.target : null;
    if (!t) return;
    if (t.closest('[data-fq-menu]')) { setFloorMenu(!floor.menuOpen, false); return; }
    if (floor.menuOpen && !t.closest('.fq-more')) setFloorMenu(false, false); // 外側を押したら閉じる
    var tog = t.closest('[data-fq-open]');
    if (tog) {
      var id = tog.getAttribute('data-fq-open');
      if (floor.open[id]) delete floor.open[id]; else floor.open[id] = true;
      if (floor.data) renderQueue(floor.data, false);
      var again = document.querySelector('[data-fq-open="' + id.replace(/["\\]/g, '') + '"]');
      if (again) again.focus();
      return;
    }
    if (t.closest('[data-fq-clear]') || t.closest('#scene-filter')) { setFloorFilter(null); return; }
    var st = t.closest('#scene [data-st]');
    if (st) setFloorFilter(st.getAttribute('data-st'));
  }

  function stopFloor() {
    floor.active = false;
    floor.gen++;
    if (floor.timer) { clearTimeout(floor.timer); floor.timer = null; }
    if (document.body) document.body.classList.remove('floor-wide');
    if (floor.resizeObs) { floor.resizeObs.disconnect(); floor.resizeObs = null; }
  }
  function scheduleFloor() {
    if (floor.timer) { clearTimeout(floor.timer); floor.timer = null; }
    if (!floor.active || document.hidden) return; // 隠れている間は止める（戻ったら即 1 回）
    floor.timer = setTimeout(function () { floor.timer = null; fetchFloor(); }, FLOOR_POLL_MS);
  }
  function fetchFloor() {
    if (!floor.active || floor.inflight === floor.gen) return;
    var gen = floor.gen;
    floor.inflight = gen;
    api('GET', '/api/floor').then(function (d) {
      if (gen !== floor.gen) return;
      floor.errAt = null;
      renderFloor(d);
    }, function (e) {
      if (gen !== floor.gen) return;
      // 失敗したら前回の表示を残し、帯に小さく出す。次の周期で再試行
      floor.errAt = hhmm(new Date());
      renderFloorBand();
      var q = $('#floor-queue');
      if (q && !floor.data) { q.classList.remove('loading'); q.innerHTML = '<p class="err">読み込めませんでした: ' + esc(e.message) + '</p>'; }
    }).then(function () {
      if (floor.inflight === gen) floor.inflight = null;
      if (gen === floor.gen) scheduleFloor();
    });
  }
  function onFloorVisibility() {
    if (!floor.active) return;
    if (document.hidden) { if (floor.timer) { clearTimeout(floor.timer); floor.timer = null; } return; }
    fetchFloor();
  }

  function viewFloor(view) {
    stopFloor();
    floor.active = true;
    floor.data = null;
    floor.prev = null;
    floor.prevSt = null;
    floor.errAt = null;
    floor.bandHtml = null;
    floor.filter = null;
    floor.open = {};
    floor.menuOpen = false;
    floor.userScrolled = false;
    floor.autoScrollAt = 0;
    document.body.classList.add('floor-wide');
    view.innerHTML = '<div class="floor-view">' +
      '<div id="floor-band" class="floor-band" aria-live="polite"><span class="muted">読み込み中…</span></div>' +
      '<div class="row floor-head-row"><h1>工場</h1><span class="muted" id="floor-updated"></span></div>' +
      '<div class="scene-stage">' +
      '<button type="button" id="scene-filter" class="scene-filter hidden"></button>' +
      '<div class="scene-scroll" id="scene-scroll"><div class="scene" id="scene"></div></div>' +
      '<section class="fq-card" aria-labelledby="fq-h"><div id="floor-queue" class="loading">' + floorSkeletonHtml() + '</div></section>' +
      '</div></div>';
    buildScene($('#scene'));
    var fv = view.querySelector('.floor-view');
    fv.addEventListener('click', onFloorClick);
    fv.addEventListener('keydown', onFloorKey);
    $('#scene-scroll').addEventListener('scroll', onSceneScroll, { passive: true });
    // 場面の幅が変わったら札の寄せ直し（札の大きさは cqw と clamp で場面の幅に追従する）
    if (typeof ResizeObserver === 'function') {
      floor.resizeObs = new ResizeObserver(function () { clampScenePills(); });
      floor.resizeObs.observe($('#scene'));
    }
    // 隠れたタブで開いた時は取りに行かない（見えるようになったら onFloorVisibility が取る）
    if (!document.hidden) fetchFloor();
  }

  // smoke（§N-5 (n3)）から描画の純関数を呼べるようにする。画面の動作には使わない
  window.FactoryAdminFloor = { floorBandHtml: floorBandHtml, floorQueueHtml: floorQueueHtml, floorChipsHtml: floorChipsHtml, sanitizeCharSvg: sanitizeCharSvg };

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
  // localStorage が使えない環境でも、同じページを開いている間は下書きを失わない（送信失敗 → 再描画で消えないように）
  var answerDraftMem = {};

  /** 下書き（{ [question_id]: { mode: 'default'|'own', text } }）。読み書きの失敗は無視して画面は動かす */
  function loadAnswerDraft(jobId, qs) {
    var raw = null;
    // このページで入力した最新の下書き（メモリ）を優先する。storage の値は保存に失敗していると古いことがある
    raw = answerDraftMem[jobId] || null;
    if (!raw) { try { raw = JSON.parse(window.localStorage.getItem(DRAFT_PREFIX + jobId) || 'null'); } catch (e) { raw = null; } }
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
  function saveAnswerDraft(jobId, draft) { answerDraftMem[jobId] = JSON.parse(JSON.stringify(draft)); try { window.localStorage.setItem(DRAFT_PREFIX + jobId, JSON.stringify(draft)); } catch (e) { /* 保存できなくても入力は続けられる */ } }
  function clearAnswerDraft(jobId) { delete answerDraftMem[jobId]; try { window.localStorage.removeItem(DRAFT_PREFIX + jobId); } catch (e) { /* 無視 */ } }

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

  // 予算の増額（契約 §B-4-f）。額と上限はサーバーと同じ（サーバーが正。ここは押せるかの目安）
  var RAISE_STEPS = [500, 1000, 2000];
  var JOB_BUDGET_CAP_CENTS = 5000;
  /**
   * 増やした後の予算の見込み = max(今の予算, 使った額 + 1¢) + 増やす額。
   * サーバーは押した時に session の使った額を読み直して決める（丸め分の 1¢ を足す）ので、応答の budget_cents が正
   */
  function raisedBudget(j, add) { return Math.max(Number(j.budget_cents || 0), Number(j.list_cost_cents || 0) + 1) + add; }
  function raiseButtonsHtml(j) {
    if (j.status !== 'budget_reached' || !j.session_id) return '';
    return '<div class="row">' + RAISE_STEPS.map(function (add) {
      var over = raisedBudget(j, add) > JOB_BUDGET_CAP_CENTS;
      return '<button type="button" class="btn" data-raise="' + add + '"' + (over ? ' disabled title="1 つの作業の予算は $50.00 までです"' : '') + '>' + esc(fmtCents(add).replace(/\.00$/, '')) + ' 増やして続ける</button>';
    }).join('') + '</div>';
  }

  function jobAlertHtml(j) {
    var lines = [];
    if (j.status === 'budget_reached') lines.push('予算 ' + fmtCents(j.budget_cents) + ' に達して止まっています（使った額 ' + fmtCents(j.list_cost_cents) + '）');
    if (j.error) lines.push('エラー: ' + j.error);
    if (j.last_error) lines.push('最後のエラー: ' + j.last_error);
    return lines.length ? '<div class="aq-alert" role="alert">' + lines.map(function (l) { return '<p>' + esc(l) + '</p>'; }).join('') + raiseButtonsHtml(j) + '</div>' : '';
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

  /** 増額のメモの下書き（job id ごと）。失敗しても書いたメモを消さない（§G-3） */
  var raiseNoteMem = {};
  /** 増額ボタン（§B-4-f）: 予告（新しい予算とメモ欄）→ 実行（3 つとも止める）→ トースト → 読み直し */
  function bindRaiseButtons(id, j) {
    var btns = document.querySelectorAll('[data-raise]');
    Array.prototype.forEach.call(btns, function (btn) {
      btn.addEventListener('click', function () {
        var add = Number(btn.getAttribute('data-raise'));
        var next = raisedBudget(j, add);
        action(btn, {
          title: '予算を ' + fmtCents(add) + ' 増やして、職人に続きを頼みます。新しい予算 ' + fmtCents(next),
          body: '今の予算 ' + fmtCents(j.budget_cents) + ' / 使った額 ' + fmtCents(j.list_cost_cents) + '。新しい予算は押した時の使った額から決まるので、少し変わることがあります。1 つの作業の予算は ' + fmtCents(JOB_BUDGET_CAP_CENTS) + ' まで、今日の費用の上限も超えない範囲で増やします。増やすと職人は自動で続きを始めます。',
          note: true, noteRequired: false, noteLabel: 'メモ（任意・200 字まで）', noteValue: raiseNoteMem[id] || '',
          okText: '増やして続ける', busyText: '増やしています…',
          run: function (note) {
            raiseNoteMem[id] = note || '';
            Array.prototype.forEach.call(btns, function (b) { b.disabled = true; }); // 送信中は他の額も押せない
            var body = { add_cents: add };
            if (note && note.trim()) body.note = note.trim();
            return api('POST', '/api/jobs/' + encodeURIComponent(id) + '/raise-budget', body);
          },
          success: '予算を ' + fmtCents(next) + ' にして続きを頼みました',
          after: function (res) {
            delete raiseNoteMem[id];
            toast('予算を ' + fmtCents(res && res.budget_cents !== undefined ? res.budget_cents : next) + ' にして続きを頼みました');
            route();
          },
          fail: function (e) {
            // 状態が変わった（409）・増えたか分からない（raise_unknown）時は読み直して今の状態を出す。それ以外はボタンを戻してもう一度押せるようにする
            if (e && (e.status === 409 || (e.body && e.body.error === 'raise_unknown'))) { route(); return; }
            Array.prototype.forEach.call(btns, function (b) { b.disabled = raisedBudget(j, Number(b.getAttribute('data-raise'))) > JOB_BUDGET_CAP_CENTS; });
          }
        });
      });
    });
  }

  function bindJobActions(id, j) {
    $('#reload-btn').addEventListener('click', function () { route(); });
    if (j) bindRaiseButtons(id, j);
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

  /** hooks.start / hooks.end: 送信の開始と終了（成功・失敗とも）。送信中は入力とボタンを止めるために使う */
  function sendAnswers(id, btn, title, answers, hooks) {
    hooks = hooks || {};
    action(btn, {
      title: title, body: ANSWER_NOTICE, busyText: '送信中…',
      run: function () { if (hooks.start) hooks.start(); return api('POST', '/api/jobs/' + encodeURIComponent(id) + '/answer', { answers: answers }); },
      success: '回答を送りました。職人が制作を始めます',
      after: function () { if (hooks.end) hooks.end(); clearAnswerDraft(id); route(); },
      fail: function () { if (hooks.end) hooks.end(); route(); } // 409 answer_in_flight / not_waiting 等は toast の後に読み直す（下書きは残す）
    });
  }

  function bindAnswerInputs(view, id, qs, draft) {
    var btn = $('#ans-btn');
    var sending = false;
    function setSending(on) {
      if (!view.contains(btn) || !document.body.contains(btn)) return; // 送信中に別の画面へ移った
      sending = on;
      Array.prototype.forEach.call(view.querySelectorAll('.aq-card input, .aq-card textarea'), function (el) { el.disabled = on; });
      if (!on) refresh();
    }
    function refresh() {
      var p = answerProgress(qs, draft);
      $('#aq-progress').textContent = p.total + ' 問中 ' + p.done + ' 問に答えました';
      $('#aq-left').textContent = p.complete ? '' : 'あと ' + (p.total - p.done) + ' 問';
      btn.disabled = sending || !p.complete;
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
      if (sending || !p.complete) return;
      sendAnswers(id, btn, '回答を送って制作を始めます', p.answers, { start: function () { setSending(true); }, end: function () { setSending(false); } });
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
      bindJobActions(id, j);
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
  // 検証係の図ごとの判定（§O-12 d）: [文, pill の色]
  var FIG_VERDICT = { ok: ['検証係: 問題なし', 'green'], problem: ['検証係: 指摘あり', 'red'], unclear: ['検証係: 判断できず', 'yellow'], not_seen: ['検証係: 未確認（容量）', 'gray'] };
  /** verification.figures（無い・古い検証は null） */
  function figuresOf(d) {
    var f = d && d.verification && d.verification.figures;
    return Array.isArray(f) ? f : null;
  }
  /** verification.analogy_gaps（無い・古い検証は null。§P c 6） */
  function analogyGapsOf(d) {
    var g = d && d.verification && d.verification.analogy_gaps;
    return Array.isArray(g) ? g : null;
  }
  /** 「説明と表現」の下のたとえのずれ（0 件・null は出さない。§P c 6） */
  function analogyGapsHtml(d) {
    var gaps = (analogyGapsOf(d) || []).filter(function (g) { return g && typeof g === 'object'; });
    if (!gaps.length) return '';
    var str = function (x) { return typeof x === 'string' ? x : ''; };
    return '<details class="rv-gaps" data-analogy-gaps="' + gaps.length + '"><summary>たとえのずれ ' + gaps.length + ' 件（学びマップに残す記録）</summary><ul>' +
      gaps.map(function (g) {
        var sub = [];
        if (str(g.claim_id)) sub.push(esc(str(g.claim_id)));
        if (str(g.where)) sub.push(esc(str(g.where)));
        return '<li data-analogy-gap="1">' + esc(str(g.analogy)) + ': 同じ = ' + esc(str(g.same)) + ' / 違う = ' + esc(str(g.differs)) +
          (sub.length ? ' <small class="muted">' + sub.join(' ・ ') + '</small>' : '') + '</li>';
      }).join('') + '</ul></details>';
  }
  // §Q-5: 動画（YouTube）。youtube_id は取り込みの schema で検査済みでも、埋め込む前にもう一度この形で確かめる
  var YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;
  /** §Q-9.6 の文（verbatim） */
  var VIDEO_CHECK_TEXT = '動画: 本人のアップか・区間が再生できて内容が合うかを見てください';
  var VIDEO_NOTE_TEXT = '区間の指定と rel=0 は、区間の外への移動や関連動画を止めません。youtube-nocookie も、広告・追跡が無いことを保証しません。';
  var VIDEO_NO_RECORD = '動画の記録はまだありません';
  /** §Q-5: Gemini の記録（video-notes.json はあるが、この動画の記録が無い）・検証係の判定（figures と同じ 4 種の pill） */
  var VIDEO_NOTE_MISSING = 'Gemini の記録はありません（呼ばなかった・失敗した・上限のため。検証係もこの動画は見ていません）';
  var VIDEO_OLD_VERIFY = 'この版の検証係は動画を見ていません';
  var VIDEO_NO_VERDICT = '判定がありません';
  var VIDEO_VERDICT = { ok: ['検証係: 問題なし', 'green'], problem: ['検証係: 指摘あり', 'red'], unclear: ['検証係: 判断できず', 'yellow'], not_seen: ['検証係: 未確認（記録なし）', 'gray'] };
  var vhas = function (o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); };
  /** §Q-11 8: YouTube の公式情報（oEmbed）の印の文（verbatim） */
  var VIDEO_META_MARK = {
    partial: 'チャンネル名が一部だけ一致しています。本人のチャンネルか確かめてください',
    mismatch: '職人が書いたチャンネル名と違います',
    not_found: '動画が見つかりません',
    unknown: '公式の情報をまだ取れていません',
    unknown_match: 'チャンネル名を照合できませんでした。本人のチャンネルか確かめてください'
  };
  /** リンクにしてよい author_url（Worker で確かめた形をもう一度: https://www.youtube.com/ の下だけ） */
  var YT_AUTHOR_URL_RE = /^https:\/\/www\.youtube\.com\/(?:@([^\/?#\s]+)|channel\/[A-Za-z0-9_-]+|c\/([^\/?#\s]+)|user\/([^\/?#\s]+))$/;
  /** 復号した後のハンドル・名前に入ってはいけない文字（制御文字・空白・/ \ ? # %。Worker の safeAuthorUrl と同じ規則） */
  var YT_AUTHOR_SEGMENT_BAD_RE = /[\u0000-\u001F\u007F-\u009F\s\/\\?#%]/;
  function safeAuthorHref(url) {
    if (typeof url !== 'string') return false;
    var m = YT_AUTHOR_URL_RE.exec(url);
    if (!m) return false;
    var seg = m[1] || m[2] || m[3];
    if (seg === undefined) return true;
    var decoded;
    try { decoded = decodeURIComponent(seg); } catch (e) { return false; }
    return !YT_AUTHOR_SEGMENT_BAD_RE.test(decoded);
  }
  /** 確認画面の動画の欄の材料: notes = video_id → 記録（video_notes が無ければ null）、verdicts = id → 判定（検証が無ければ null、古い検証は 'old'） */
  function videoCtxOf(d) {
    var vn = d && d.video_notes;
    var notes = null;
    if (vn && typeof vn === 'object' && Array.isArray(vn.notes)) {
      notes = Object.create(null); // id が __proto__ でもプロトタイプを踏まない
      vn.notes.forEach(function (n) { if (n && typeof n.video_id === 'string' && typeof n.text === 'string' && !vhas(notes, n.video_id)) notes[n.video_id] = n; });
    }
    var ver = d && d.verification;
    var verdicts = null;
    if (ver && typeof ver === 'object') {
      if (!Array.isArray(ver.videos)) verdicts = 'old';
      else {
        verdicts = Object.create(null);
        ver.videos.forEach(function (x) { if (x && typeof x.id === 'string' && !vhas(verdicts, x.id)) verdicts[x.id] = x; });
      }
    }
    // §Q-11 8: video_meta（無い応答 = 古い Worker は null。表示しない）
    var meta = null;
    if (d && Array.isArray(d.video_meta)) {
      meta = Object.create(null);
      d.video_meta.forEach(function (m) { if (m && typeof m.video_id === 'string' && !vhas(meta, m.video_id)) meta[m.video_id] = m; });
    }
    return { notes: notes, verdicts: verdicts, meta: meta };
  }
  /** §Q-11 8: 職人が書いたチャンネル名と並べる「YouTube の公式情報」と印（値はすべて escape。リンクは author_url がある時だけ） */
  function videoMetaHtml(v, vc) {
    var ms = vc ? vc.meta : null;
    if (!ms) return '';
    var m = typeof v.id === 'string' && vhas(ms, v.id) ? ms[v.id] : null;
    var outcome = m && m.outcome === 'ok' ? 'ok' : m && m.outcome === 'not_found' ? 'not_found' : 'unknown';
    var line = '';
    var mark = outcome;
    if (outcome === 'ok') {
      var name = typeof m.author_name === 'string' ? m.author_name : '';
      var url = typeof m.author_url === 'string' ? m.author_url : '';
      var ch = url && safeAuthorHref(url)
        ? '<a href="' + esc(url) + '" rel="noopener noreferrer" target="_blank" data-video-meta-link="1">' + esc(name) + '</a>'
        : esc(name);
      line = '<p data-video-meta="ok">YouTube の公式情報: ' + esc(typeof m.title === 'string' ? m.title : '') + ' / ' + ch + '</p>';
      // 照合できなかった（正規化の後でどちらかの名前が空）時も印を出す
      mark = m.channel_match === 'partial' || m.channel_match === 'mismatch' ? m.channel_match : m.channel_match === 'unknown' ? 'unknown_match' : '';
    }
    var markHtml = mark && vhas(VIDEO_META_MARK, mark)
      ? '<p class="' + (mark === 'unknown' ? 'muted' : 'err') + '" data-video-meta-mark="' + esc(mark) + '">' + esc(VIDEO_META_MARK[mark]) + '</p>'
      : '';
    return line + markHtml;
  }
  function usageText(u) {
    if (!u || typeof u !== 'object') return '';
    var parts = [];
    if (typeof u.total_input_tokens === 'number') parts.push('入力 ' + u.total_input_tokens);
    if (typeof u.total_output_tokens === 'number') parts.push('出力 ' + u.total_output_tokens);
    if (typeof u.total_thought_tokens === 'number') parts.push('思考 ' + u.total_thought_tokens);
    return parts.length ? ' ・ tokens ' + parts.join(' / ') : '';
  }
  function videoNotesHtml(v, vc) {
    var n = vc && vc.notes && typeof v.id === 'string' && vhas(vc.notes, v.id) ? vc.notes[v.id] : null;
    var body = n
      ? '<p class="muted"><small>' + esc(n.model || '') + esc(usageText(n.usage)) + '</small></p><div class="rv-video-note" data-video-note="1">' + esc(n.text) + '</div>'
      : '<p class="muted">' + esc(vc && vc.notes ? VIDEO_NOTE_MISSING : VIDEO_NO_RECORD) + '</p>';
    return '<details data-video-notes="1"><summary>Gemini の記録</summary>' + body + '</details>';
  }
  function videoVerdictHtml(v, vc) {
    var vs = vc ? vc.verdicts : null;
    var inner;
    if (vs === null || vs === undefined) inner = '<span class="muted">' + esc(VIDEO_NO_RECORD) + '</span>';
    else if (vs === 'old') inner = '<span class="muted">' + esc(VIDEO_OLD_VERIFY) + '</span>';
    else {
      var x = typeof v.id === 'string' && vhas(vs, v.id) ? vs[v.id] : null;
      if (x && vhas(VIDEO_VERDICT, x.verdict)) {
        var t = VIDEO_VERDICT[x.verdict];
        inner = '<span data-video-pill="' + esc(x.verdict) + '">' + pill(t[0], t[1]) + '</span>' + (x.reason ? ' <span class="muted">' + esc(x.reason) + '</span>' : '');
      } else inner = '<span class="muted">' + esc(VIDEO_NO_VERDICT) + '</span>';
    }
    return '<p data-video-verdict="1">検証係の判定: ' + inner + '</p>';
  }
  /** material.parts[].videos[] を出現順に（形の違う要素は飛ばさず残し、表示側で埋め込まない） */
  function videosOf(mat) {
    var out = [];
    ((mat && mat.parts) || []).forEach(function (p) {
      if (p && Array.isArray(p.videos)) p.videos.forEach(function (v) { out.push(v && typeof v === 'object' ? v : {}); });
    });
    return out;
  }
  function isSec(n) { return typeof n === 'number' && isFinite(n) && n >= 0 && Math.floor(n) === n; }
  /** 秒 → 分:秒（例 80 → 1:20） */
  function fmtSec(n) { var s = n % 60; return Math.floor(n / 60) + ':' + (s < 10 ? '0' : '') + s; }
  function videoHtml(v, vc) {
    var s = v.start_sec, e = v.end_sec;
    var okId = typeof v.youtube_id === 'string' && YT_ID_RE.test(v.youtube_id);
    var okRange = isSec(s) && isSec(e) && s < e;
    var embed = okId && okRange
      ? '<iframe src="' + esc('https://www.youtube-nocookie.com/embed/' + v.youtube_id + '?start=' + s + '&end=' + e + '&rel=0') + '" title="' + esc(v.title) +
        '" allow="encrypted-media; picture-in-picture; fullscreen" referrerpolicy="strict-origin-when-cross-origin" loading="lazy"></iframe>'
      : '<p class="err" data-video-bad="1">動画の id か区間の形が正しくないため、埋め込みません</p>';
    return '<div class="rv-video" data-video="' + esc(v.id) + '"><p><b>動画 ' + esc(v.id) + '</b> ' + esc(v.title) + '</p>' + embed +
      '<p>区間 ' + (okRange ? esc(fmtSec(s)) + '〜' + esc(fmtSec(e)) : '<span class="muted">不明</span>') + ' ・ チャンネル ' + esc(v.channel) + '</p>' +
      videoMetaHtml(v, vc) +
      '<p>見どころ: ' + esc(v.why) + '</p>' +
      '<p>本人のアップと言える理由: ' + esc(v.rights_note) + '</p>' +
      videoNotesHtml(v, vc) + videoVerdictHtml(v, vc) + '</div>';
  }
  /** 「説明と表現」の下の動画（0 本なら出さない）。d は review API の応答（video_notes・verification.videos を読む） */
  function videosHtml(vids, d) {
    if (!vids.length) return '';
    var vc = videoCtxOf(d);
    return '<div class="rv-videos" data-videos="' + vids.length + '"><p><span class="muted">動画 ' + vids.length + ' 本</span> ' + esc(VIDEO_CHECK_TEXT) + '</p>' +
      '<p class="muted"><small>' + esc(VIDEO_NOTE_TEXT) + '</small></p>' + vids.map(function (v) { return videoHtml(v, vc); }).join('') + '</div>';
  }
  /** サムネイルの下の判定の pill と reason（判定の無い path は空） */
  function figVerdictHtml(f) {
    if (!f || !Object.prototype.hasOwnProperty.call(FIG_VERDICT, f.verdict)) return '';
    var t = FIG_VERDICT[f.verdict];
    return '<p class="thumb-fig" data-fig-verdict="' + esc(f.verdict) + '">' + pill(t[0], t[1]) + '</p>' +
      (f.reason ? '<p class="thumb-cap" data-fig-reason="1">' + esc(f.reason) + '</p>' : '');
  }
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
      var gen = {};
      (Array.isArray(d.generated_images) ? d.generated_images : []).forEach(function (g) { if (g && typeof g.path === 'string') gen[g.path] = g; });
      var figs = figuresOf(d), figBy = {};
      (figs || []).forEach(function (f) { if (f && typeof f.path === 'string') figBy[f.path] = f; });
      var vids = videosOf(d.version.material);
      extra = '<div class="rv-figs"><span class="muted">図・画像 ' + imgs.length + ' 枚' + (vids.length ? '・動画 ' + vids.length + ' 本' : '') +
        (figs ? '（検証係も図を見ています。判定はサムネイルの下。最後はあなたがすべて見てください）' : '（この版の検証係は図を見ていません。すべて見てください）') + '</span>' +
        (imgs.length ? '<div class="thumbs">' + imgs.map(function (p) {
          var a = '<a href="' + esc(base + p) + '" target="_blank" rel="noopener noreferrer" title="' + esc(p) + '"><img class="thumb" alt="' + esc(p) + '" src="' + esc(base + p) + '"></a>';
          var g = Object.prototype.hasOwnProperty.call(gen, p) ? gen[p] : null;
          var f = Object.prototype.hasOwnProperty.call(figBy, p) ? figBy[p] : null;
          if (!g && !f) return a;
          // 生成した絵はサムネイルの下に「生成: 正確さ・prompt の先頭 80 字」（§O-7 6）、その下に検証係の判定（§O-12 d）
          return '<div class="thumb-gen"' + (g ? ' data-gen="1"' : '') + '>' + a + (g ? '<p class="thumb-cap">' + esc(genCaption(g)) + '</p>' : '') + figVerdictHtml(f) + '</div>';
        }).join('') + '</div>' : '') + '</div>' + videosHtml(vids, d) + analogyGapsHtml(d);
    }
    // §Q-9.6: 動画のある版の「利用条件」は自動 OK にならない。理由の文を動画の文にする（出典の利用条件が分からない時は従来の文も残す）
    var tuVideos = k === 'terms_of_use' && videosOf(d.version && d.version.material).length > 0;
    if (tuVideos) {
      var srcs = Array.isArray(d.sources) ? d.sources : [];
      var tuLicense = !srcs.length || srcs.some(function (s) { return !s || s.license === 'unknown'; });
      extra += (tri.present && tuLicense ? '<p class="muted">' + esc(AUTO_HINT.terms_of_use) + '</p>' : '') + '<p class="muted" data-video-terms="1">' + esc(VIDEO_CHECK_TEXT) + '</p>';
    } else if (tri.present && AUTO_KEYS.indexOf(k) >= 0 && AUTO_HINT[k]) extra += '<p class="muted">' + esc(AUTO_HINT[k]) + '</p>';
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

  /** 詳細の検証の行に足す図の数（figures がある時だけ。§O-12 d） */
  function figCountsText(figs) {
    if (!figs) return '';
    var c = { ok: 0, problem: 0, unclear: 0, not_seen: 0 };
    figs.forEach(function (f) { if (f && Object.prototype.hasOwnProperty.call(c, f.verdict)) c[f.verdict]++; });
    return ' / 図 ok ' + c.ok + ' / 指摘 ' + c.problem + ' / 判断できず ' + c.unclear + ' / 未確認 ' + c.not_seen;
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
      (ver ? '<p class="muted">検証 attempt ' + esc(ver.attempt) + ' / 確か ' + esc(ver.confirmed) + ' 仮説 ' + esc(ver.hypothesis) + ' 未確認 ' + esc(ver.unverified) + ' 食い違い ' + esc(ver.contradicted) + figCountsText(figuresOf(d)) + '</p>' : '') +
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
    stopFloor(); // 工場のポーリングは他の画面へ移ったら必ず止める（viewFloor が開き直す）
    document.body.classList.remove('has-foot');
    loadStatus();
    if (!p.length) return viewFloor(view);
    if (p[0] === 'materials') return viewMaterials(view, r.q);
    if (p[0] === 'new') return viewNew(view);
    if (p[0] === 'material' && p[1]) return viewMaterial(view, p[1]);
    if (p[0] === 'job' && p[1]) return viewJob(view, p[1]);
    if (p[0] === 'review' && p[1]) return viewReview(view, p[1]);
    if (p[0] === 'review') return viewReviewList(view);
    if (p[0] === 'standards') return viewStandards(view);
    if (p[0] === 'proposals') return viewProposals(view, r.q);
    if (p[0] === 'images') return viewImages(view);
    if (p[0] === 'videos') return viewVideos(view);
    view.innerHTML = '<p class="muted">ページが見つかりません。<a href="#/materials">素材へ</a></p>';
  }
  window.FactoryAdminVideos = { videosBandHtml: videosBandHtml, videosAdminHtml: videosAdminHtml, videosLoadingHtml: videosLoadingHtml, videosErrorHtml: videosErrorHtml };
  window.FactoryAdminImages = {
    HALT_TEXT: HALT_TEXT, haltText: haltText, imagesBandHtml: imagesBandHtml, imagesHtml: imagesHtml,
    imagesLoadingHtml: imagesLoadingHtml, imagesErrorHtml: imagesErrorHtml, genCaption: genCaption
  };
  if (window.__FACTORY_ADMIN_NO_BOOT__) return; // smoke が純関数だけを読む時
  window.addEventListener('hashchange', route);
  document.addEventListener('keydown', onReviewKey);
  document.addEventListener('visibilitychange', onFloorVisibility);
  route();
})();
