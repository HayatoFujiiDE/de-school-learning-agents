/* コンテンツファクトリー 管理画面（契約 §G）。ビルド無し・ES2017・外部読み込み無し。fetch は自サイトの /api/* だけ。
 * 表示はすべて textContent / esc() 経由。md は全部エスケープしてから限られた記法だけを変換する（§G-2）。
 * 書き込み操作は 予告（ダイアログ）→ 実行（二重送信防止）→ フィードバック（トースト）→ 反映（再取得）。失敗時は入力を消さない（§G-3）。 */
(function () {
  'use strict';
  // §AJ2-3: vendor の model-viewer（module・deferred なので admin.js が先に走る）が Draco の復号器を自前の置き場から読むように（外部の gstatic に出ない）
  window.ModelViewerElement = { dracoDecoderLocation: '/admin/vendor/draco/' };

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
    cap_reached: '動画の記帳が月または日の上限に届いています',
    too_many_active: '職人に渡している工夫が 8 件あります。先にどれかをやめてから入れてください',
    state_conflict: '他の操作で状態が変わりました。読み込み直してください',
    bad_request: '送った内容が正しくありません',
    // §V-7 e・§V-4 h
    channel_trust_required: '初めてのチャンネルを確かめてから公開してください',
    checks_pending: '機械の確認が終わってから公開してください',
    stale_reader: '読み手チェックが新しくなりました。画面を読み直します',
    reader_running: '読み手チェックが動いています'
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

  /** 書き込み操作の共通ループ: 予告 → 実行（ボタン無効化）→ トースト → 再取得。opts.busyText（実行中のボタン文言）・opts.fail（失敗トーストの後）は任意。opts.success は文字列か応答から文を作る関数 */
  function action(btn, opts) {
    return confirmDialog(opts).then(function (d) {
      if (!d.ok) return null;
      var label = btn ? btn.textContent : '';
      if (btn) { btn.disabled = true; btn.textContent = opts.busyText || '実行中…'; }
      return Promise.resolve(opts.run(d.note)).then(function (res) {
        toast(typeof opts.success === 'function' ? opts.success(res) : (opts.success || '完了しました'));
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
  // 主張 id の参照（[c3] / [c3, c4]。直後が「(」のもの = リンクの記法は除く）
  // 前の空白は正規表現に入れない（長い空白の行で 2 乗の時間にならないように、外した後で手で詰める）
  var CITE_RE = /\[([A-Za-z][\w-]*(?:[ \t]*[,、][ \t]*[A-Za-z][\w-]*)*)\](?!\()/g;
  function isCiteSpace(code) { return code === 32 || code === 9 || code === 0x3000; }
  /** text の中の主張 id の参照を取り除き（直前の空白も）、見つけた id を out に足す（known = 主張 id の表。c<数字> の形か known にある id だけを参照とみなす） */
  function stripCites(text, known, out) {
    var src = String(text), res = '', last = 0, m;
    CITE_RE.lastIndex = 0;
    while ((m = CITE_RE.exec(src))) {
      var toks = m[1].split(/[\s,、]+/).filter(Boolean);
      var ok = toks.length && toks.every(function (x) { return /^c\d+$/i.test(x) || (!!known && Object.prototype.hasOwnProperty.call(known, x)); });
      if (!ok) continue;
      res += src.slice(last, m.index);
      var e = res.length;
      while (e > 0 && isCiteSpace(res.charCodeAt(e - 1))) e--;
      res = res.slice(0, e);
      toks.forEach(function (x) { if (out.indexOf(x) < 0) out.push(x); });
      last = m.index + m[0].length;
    }
    return res + src.slice(last);
  }
  /**
   * opts（任意）: { cites: [] , known } を渡すと、主張 id の参照を本文から外して opts.cites に集める（教材として見る時。コードの中は触らない）。
   * opts.bold（教材の記法 v1 §V-5）: コードの外の対になった **…** を太字にする（対にならない ** はそのまま見せる）。ほかの画面の md は今までどおり
   */
  function inlineMd(s, opts) {
    var t = esc(s);
    if (opts && (opts.cites || opts.bold)) {
      t = t.split(/(`[^`]+`)/).map(function (seg, i) {
        if (i % 2) return seg;
        if (opts.cites) seg = stripCites(seg, opts.known, opts.cites);
        return opts.bold ? seg.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>') : seg;
      }).join('');
    }
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
  // 仕事ごとの枠 4 つを横に並べる（1100px 以上で 1 段・狭い時は 2×2）: 制作 / お金 / 入口（収集・会議）/ 画像・動画。
  // 各枠 = 見出し → 中身 → その仕事のボタン。その仕事の注意は枠の中の下に出し、注意がある枠は左の線を赤 / 黄にする。同じ注意を 2 つの枠に出さない。
  // 帯の中の金額は全部 $（fmtCents）。上限は整数ドルなら小数を落とす。¢ は #/images・#/videos の画面にだけ残す。
  /** 定期処理（cron）の最終からの経過の閾値（分）。ここ 1 か所だけで決める */
  var CRON_LATE_MIN = 20, CRON_STALE_MIN = 60;
  /** 今日の費用のメーターの段階（上限に対する割合。判定は >=） */
  var COST_NEAR = 0.8;
  /** 枠の順と見出し（key は注意の行き先の名前） */
  var STATUS_CARDS = [['run', '制作'], ['money', 'お金'], ['intake', '入口（収集・会議）'], ['media', '画像・動画']];
  var statusTimer = null; // 相対時間を 1 分ごとに直す単一のタイマー（loadStatus のたびに clear → set）
  var statusLast = null; // { s, alerts: { <枠>: html } }: タイマーが描き直しに使う最後の /api/status の応答と、枠ごとに描いた注意
  /** 上限の表示: 整数ドルなら小数を落とす（$200）。0 / 未定義は — */
  function fmtCap(c) {
    var v = Number(c);
    if (c === null || c === undefined || !isFinite(v)) return '—';
    return v % 100 === 0 ? '$' + (v / 100) : fmtCents(v);
  }
  /** 使った額（2 桁）。null / 未定義は — */
  function fmtUsed(c) { return c === null || c === undefined || !isFinite(Number(c)) ? '—' : fmtCents(c); }
  /** 定期処理の最終からの経過（純関数）。未来の時刻（時計のずれ）は 0 分扱い。null / 読めない時刻は stale */
  function cronAge(lastIso, nowMs) {
    var ts = lastIso ? Date.parse(String(lastIso)) : NaN;
    if (!isFinite(ts)) return { text: '記録なし', level: 'stale' };
    var ms = Math.max(0, nowMs - ts), min = Math.floor(ms / 60000);
    var text = min < 1 ? 'たった今' : min < 60 ? min + ' 分前' : min < 1440 ? Math.floor(min / 60) + ' 時間前' : Math.floor(min / 1440) + ' 日前';
    var level = ms > CRON_STALE_MIN * 60000 ? 'stale' : ms > CRON_LATE_MIN * 60000 ? 'late' : 'ok';
    return { text: text, level: level };
  }
  /** 上限に対する段階: 'ok'（80% 未満）/ 'near'（80% 以上）/ 'over'（100% 以上）。上限 0 / 未定義は null */
  function capLevel(used, cap) {
    var c = Number(cap), u = Number(used || 0);
    if (!(c > 0)) return null;
    return u >= c ? 'over' : u >= c * COST_NEAR ? 'near' : 'ok';
  }
  /** 今日の費用のメーター（CSP で style 属性が使えないので、幅は 5% 刻みのクラス）。上限 0 / 未定義ならバー無し */
  function costMeterHtml(used, cap) {
    var lv = capLevel(used, cap);
    if (!lv) return '';
    var pct = Number(used || 0) / Number(cap) * 100;
    var step = Math.max(0, Math.min(100, Math.floor(pct / 5) * 5));
    return '<span class="meter" role="meter" aria-label="今日の費用（上限に対する割合）" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + esc(Math.min(100, Math.round(pct))) + '" data-meter="' + lv + '">' +
      '<span class="meter-fill m-' + lv + ' w' + step + '"></span></span>';
  }
  /** 注意の 1 件。card = 出す枠（STATUS_CARDS の key）。1 件は 1 つの枠にだけ出す */
  function alertItem(card, level, html) { return { card: card, level: level, html: html }; }
  function alertLi(a) { return '<li class="sa-item sa-' + a.level + '">' + a.html + '</li>'; }
  function goLink(href, text) { return ' <a class="sa-go" href="' + href + '">' + esc(text) + ' ›</a>'; }
  /** 注意の全件（純関数）。赤を先に、同じ色の中は並べた順。各件は card の枠にだけ出る */
  function statusAlerts(s, nowMs) {
    var out = [];
    // 制作: 停止中・定期処理の遅れ / 停止・職人 未設定（今日の上限で新しい制作が始まらないことはお金の枠に出す）
    if (s.paused) out.push(alertItem('run', 'red', '停止中です。新しい制作と検証は始まりません' + (s.paused_note ? '（メモ: ' + esc(s.paused_note) + '）' : '')));
    var ca = cronAge(s.last_cron_at, nowMs), last = s.last_cron_at ? '（最終 ' + esc(fmtTime(s.last_cron_at)) + '）' : '（記録がありません）';
    if (ca.level === 'stale') out.push(alertItem('run', 'red', '定期処理が 1 時間以上動いていません' + last));
    else if (ca.level === 'late') out.push(alertItem('run', 'yellow', '定期処理が遅れています' + last));
    if (!s.agent_configured) out.push(alertItem('run', 'red', '職人（agent）が設定されていません'));
    // お金: 今日の上限 80% / 100%
    var dl = capLevel(s.today_cents, s.daily_cap_cents), money = '（' + fmtUsed(s.today_cents) + ' / ' + fmtCap(s.daily_cap_cents) + '）';
    if (dl === 'over') out.push(alertItem('money', 'red', '今日の費用が上限に達しました' + money + '。新しい制作は日付が変わるまで始まりません'));
    else if (dl === 'near') out.push(alertItem('money', 'yellow', '今日の費用が上限に近づいています' + money));
    // 入口: 収集・会議の失敗 / 失効（→ 提案箱）・月の上限 80% 以上
    var sc = s.scout || {}, mt = s.meeting || {};
    if (sc.last_status === 'failed') out.push(alertItem('intake', 'red', '収集が' + esc(RUN_LABEL.failed) + 'しました（' + esc(fmtTime(sc.last_run_at)) + '）' + goLink('#/proposals', '提案箱を見る')));
    if (mt.last_status === 'failed' || mt.last_status === 'expired') out.push(alertItem('intake', 'red', '会議が' + esc(RUN_LABEL[mt.last_status]) + 'しました（' + esc(fmtTime(mt.last_at)) + '）' + goLink('#/proposals', '提案箱を見る')));
    [['収集', sc], ['会議', mt]].forEach(function (p) {
      var lv = capLevel(p[1].month_cents, p[1].month_cap_cents);
      if (lv === 'near' || lv === 'over') out.push(alertItem('intake', 'yellow', '今月の' + p[0] + 'の費用が上限' + (lv === 'over' ? 'に達しました' : 'に近づいています') + '（' + fmtUsed(p[1].month_cents) + ' / ' + fmtCap(p[1].month_cap_cents) + '）'));
    });
    // 画像・動画: 画像の停止・予備の鍵・画像の月の上限 80% 以上
    out = out.concat(imagesAlerts(s.images, nowMs));
    return out.filter(function (a) { return a.level === 'red'; }).concat(out.filter(function (a) { return a.level !== 'red'; }));
  }
  /** 注意の全件を枠ごとに分ける: { run: [...], money: [...], intake: [...], media: [...] } */
  function alertsByCard(s, nowMs) {
    var all = statusAlerts(s, nowMs), by = {};
    STATUS_CARDS.forEach(function (c) { by[c[0]] = all.filter(function (a) { return a.card === c[0]; }); });
    return by;
  }
  /** 枠の注意の中身（0 件なら空文字） */
  function cardAlertsHtml(list) { return list.length ? '<ul class="sa-list">' + list.map(alertLi).join('') + '</ul>' : ''; }
  /** 枠のクラス: 赤が 1 件でもあれば sb-red、黄だけなら sb-yellow */
  function cardClass(list) {
    var red = list.some(function (a) { return a.level === 'red'; });
    return 'sb-card' + (red ? ' sb-red' : list.length ? ' sb-yellow' : '');
  }
  /** 枠 1 つ: 見出し（右端にその仕事のボタンを置ける）→ 中身 → 注意（aria-live はこの容器） */
  function statusCardHtml(key, title, headRight, body, list) {
    return '<div class="' + cardClass(list) + '" id="status-card-' + key + '" data-card="' + key + '">' +
      '<div class="sb-head"><span class="sb-title">' + esc(title) + '</span>' + headRight + '</div>' +
      '<div class="sb-body">' + body + '</div>' +
      '<div class="sb-alerts" id="status-alerts-' + key + '" aria-live="polite">' + cardAlertsHtml(list) + '</div></div>';
  }
  /** 制作の枠の中身: 稼働・制作中 / 順番待ち・定期処理の相対時間 */
  function runBodyHtml(s, nowMs) {
    var ca = cronAge(s.last_cron_at, nowMs);
    return '<div class="sb-line"><span class="sb-state"><span class="dot ' + (s.paused ? 'red' : 'green') + '" aria-hidden="true"></span><b>' + (s.paused ? '停止中' : '動いています') + '</b></span></div>' +
      '<div class="sb-line"><span class="item">制作中 <b>' + esc(s.running_jobs) + '</b> / ' + esc(s.max_concurrent) + '</span><span class="sb-sep" aria-hidden="true">・</span>' +
        '<span class="item">順番待ち <b>' + esc(s.queued_jobs) + '</b></span></div>' +
      '<div class="sb-line"><span class="item" title="定期処理の最終 ' + esc(fmtTime(s.last_cron_at)) + '">定期処理 <span id="cron-rel" class="cron-rel ' + ca.level + '" data-cron-rel="1">' + esc(ca.text) + '</span></span></div>';
  }
  /** お金の枠の中身: 今日のメーター・今月の額（上限は各枠にあるので額だけ。合計は出さない） */
  function moneyBodyHtml(s) {
    var sc = s.scout || {}, mt = s.meeting || {}, im = s.images && typeof s.images === 'object' ? s.images : null;
    return '<div class="sb-line sb-money"><span class="sb-label">今日</span><span class="sb-vals">' + costMeterHtml(s.today_cents, s.daily_cap_cents) +
        '<span class="sb-num"><b>' + fmtUsed(s.today_cents) + '</b> / ' + fmtCap(s.daily_cap_cents) + '</span></span></div>' +
      '<div class="sb-line sb-money"><span class="sb-label">今月</span><span class="sb-vals"><span class="item">収集 ' + fmtUsed(sc.month_cents || 0) + '</span>' +
        '<span class="item">会議 ' + fmtUsed(mt.month_cents || 0) + '</span>' +
        (im ? '<span class="item">画像 ' + fmtUsed(im.month_cents) + '</span>' : '') + '</span></div>';
  }
  /** 入口の 1 行: 名前・最終の状態（未実行は muted 文字・失敗系は赤 pill）・今月 $x / $上限・[今すぐ] */
  function intakeRowHtml(name, o, at, bad, btn) {
    var label = o.last_status ? (RUN_LABEL[o.last_status] || o.last_status) : '';
    var title = at ? ' title="最終 ' + esc(fmtTime(at)) + '"' : '';
    var st = !o.last_status ? '<span class="sb-st muted">未実行</span>'
      : bad ? '<span class="sb-st"' + title + '>' + pill(label, 'red') + '</span>'
      : '<span class="sb-st muted"' + title + '>' + esc(label) + '</span>';
    return '<div class="sb-line sb-intake"><span class="sb-name">' + name + '</span>' + st +
      '<span class="sb-num">' + fmtUsed(o.month_cents || 0) + ' / ' + fmtCap(o.month_cap_cents) + '</span>' + btn + '</div>';
  }
  /** 入口の枠の中身: 収集の行・会議の行（ボタンの文言・busy 文・disabled 条件・id は今のまま） */
  function intakeBodyHtml(s) {
    var sc = s.scout || {}, mt = s.meeting || {};
    var scoutBusy = !!sc.running, meetBusy = !!mt.pending_batch;
    var pausedTitle = ' title="停止中は実行できません"';
    return intakeRowHtml('収集', sc, sc.last_run_at, sc.last_status === 'failed',
        '<button type="button" class="btn small" id="scout-btn"' + (scoutBusy || s.paused ? ' disabled' : '') + (s.paused ? pausedTitle : '') + '>' + (scoutBusy ? '収集中…' : '収集を今すぐ') + '</button>') +
      intakeRowHtml('会議', mt, mt.last_at, mt.last_status === 'failed' || mt.last_status === 'expired',
        '<button type="button" class="btn small" id="meeting-btn"' + (meetBusy || s.paused ? ' disabled' : '') + (s.paused ? pausedTitle : '') + '>' + (meetBusy ? '結果待ち' : '会議を今すぐ') + '</button>');
  }
  /** 画像・動画の枠の中身。images / videos が無い応答（古い Worker）ではその行を出さない */
  function mediaBodyHtml(s) {
    var img = imagesMonthHtml(s.images), vid = videosBandHtml(s.videos);
    if (!img && !vid) return '<div class="sb-line muted">—</div>';
    return (img ? '<div class="sb-line">' + img + '</div>' : '') + (vid ? '<div class="sb-line">' + vid + '</div>' : '');
  }
  /** #status の中身全部（純関数）。注意の容器（#status-alerts-<枠>）は 0 件でも置く */
  function statusBandHtml(s, nowMs) {
    var now = typeof nowMs === 'number' ? nowMs : Date.now();
    var by = alertsByCard(s, now);
    var pause = '<button type="button" class="btn small' + (s.paused ? ' primary' : '') + '" id="pause-btn">' + (s.paused ? '再開' : '止める') + '</button>';
    return '<div class="status-band">' +
      statusCardHtml('run', '制作', pause, runBodyHtml(s, now), by.run) +
      statusCardHtml('money', 'お金', '', moneyBodyHtml(s), by.money) +
      statusCardHtml('intake', '入口（収集・会議）', '', intakeBodyHtml(s), by.intake) +
      statusCardHtml('media', '画像・動画', '', mediaBodyHtml(s), by.media) +
      '</div>';
  }
  /** 枠ごとに描いた注意の中身（タイマーが「変わったか」を比べる元） */
  function alertsHtmlByCard(s, nowMs) {
    var by = alertsByCard(s, nowMs), out = {};
    STATUS_CARDS.forEach(function (c) { out[c[0]] = cardAlertsHtml(by[c[0]]); });
    return out;
  }
  /** 1 分ごと: 相対時間の文字と色、各枠の注意と枠の色（中身が変わった枠だけ。読み上げを毎分起こさない）を直す */
  function tickStatus() {
    if (!statusLast) return;
    var now = Date.now(), s = statusLast.s;
    var rel = $('#cron-rel');
    if (rel) { var ca = cronAge(s.last_cron_at, now); rel.textContent = ca.text; rel.className = 'cron-rel ' + ca.level; }
    var by = alertsByCard(s, now);
    STATUS_CARDS.forEach(function (c) {
      var k = c[0], h = cardAlertsHtml(by[k]);
      if (h === statusLast.alerts[k]) return;
      var box = $('#status-alerts-' + k), card = $('#status-card-' + k);
      if (box) box.innerHTML = h;
      if (card) card.className = cardClass(by[k]);
      statusLast.alerts[k] = h;
    });
  }
  function loadStatus() {
    var el = $('#status');
    return api('GET', '/api/status').then(function (s) {
      var now = Date.now();
      el.innerHTML = statusBandHtml(s, now);
      clearInterval(statusTimer);
      statusLast = { s: s, alerts: alertsHtmlByCard(s, now) };
      statusTimer = setInterval(tickStatus, 60000);
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
      clearInterval(statusTimer);
      statusTimer = null;
      statusLast = null;
      el.innerHTML = '<span class="err">状況を読み込めませんでした: ' + esc(e.message) + '</span>';
    });
  }

  // ---- 状況欄: 収集・会議（§K-7）。ボタンと今月の額は入口の枠 ----
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
    // 未来の日時（端末の時計のずれ）は 7 日以内に数えない（Astra レビューの指摘）
    return isFinite(ts) && nowMs - ts >= 0 && nowMs - ts <= BACKUP_RECENT_MS;
  }
  /** 状況帯の「画像・動画」の枠の画像の生成の行（§O-5 e）。images が無い応答（古い Worker）では何も出さない。#/images へのリンクはここの 1 本 */
  function imagesMonthHtml(im) {
    if (!im || typeof im !== 'object') return '';
    return '<a class="item" href="#/images" data-img-band="1" title="予約額で数えた記帳。OpenAI の実際の請求とは違うことがあります">画像の生成 ' +
      fmtUsed(im.month_cents) + ' / ' + fmtCap(im.month_cap_cents) + '（概算）</a>';
  }
  /** 状況帯の「画像・動画」の枠の注意の件（純関数）。停止中は赤（行き先リンク付き）・予備の鍵を 7 日以内に使った は黄・月の上限 80% 以上は黄。
   * #/images へのリンクは注意の中で 1 本まで（画像の生成の行と合わせて 2 本まで）: 停止中なら停止の行が持ち、予備の鍵の行はリンクにしない */
  function imagesAlerts(im, nowMs) {
    if (!im || typeof im !== 'object') return [];
    var now = typeof nowMs === 'number' ? nowMs : Date.now();
    var out = [];
    if (im.halted) out.push(alertItem('media', 'red', '<span class="item" data-img-halted="1">画像の生成を止めています（' + esc(haltText(im.halted)) + '）</span>' + goLink('#/images', '画像の停止を見る')));
    if (backupUsedRecently(im.backup_last_used_at, now)) {
      var mark = pill('画像: 予備の鍵を使いました（' + fmtTime(im.backup_last_used_at) + '）', 'orange');
      out.push(alertItem('media', 'yellow', im.halted
        ? '<span class="item" data-img-backup-band="1">' + mark + '</span>'
        : '<a class="item" href="#/images" data-img-backup-band="1">' + mark + ' <span class="sa-go">画像の生成を見る ›</span></a>'));
    }
    var lv = capLevel(im.month_cents, im.month_cap_cents);
    if (lv === 'near' || lv === 'over') out.push(alertItem('media', 'yellow', '今月の画像の記帳が上限' + (lv === 'over' ? 'に達しました' : 'に近づいています') + '（' + fmtUsed(im.month_cents) + ' / ' + fmtCap(im.month_cap_cents) + '）'));
    return out;
  }
  function imagesAlertHtml(im, nowMs) { return imagesAlerts(im, nowMs).map(alertLi).join(''); }
  /** 状況帯の画像の部分（画像の生成の行 + 注意の件）。images が無い応答では何も出さない。nowMs はテストの時だけ渡す */
  function imagesBandHtml(im, nowMs) {
    if (!im || typeof im !== 'object') return '';
    return imagesMonthHtml(im) + imagesAlertHtml(im, nowMs);
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
  // §V-9 e: 確認済みのチャンネル（人が「本人のアップ」と確かめた YouTube のチャンネル。外すと次から「初めてのチャンネル」として人に出る）
  function channelDate(t) {
    var m = typeof t === 'string' ? /^(\d{4})-(\d{2})-(\d{2})/.exec(t) : null;
    return m ? Number(m[1]) + '/' + Number(m[2]) + '/' + Number(m[3]) : (t ? String(t) : '—');
  }
  /** #vc-channels の中身（GET /api/channels の応答から描く純関数）。null = 読み込み中、文字列 = 読めなかった理由 */
  function channelsHtml(d) {
    var head = '<h2>確認済みのチャンネル</h2><p class="muted">公開の時に「本人のアップ」と確かめたチャンネルです。ここにあるチャンネルの動画は、次から人の確認なしで通ります。</p>';
    if (d === null || d === undefined) return head + '<p class="loading" data-channels-loading="1">読み込み中…</p>';
    if (typeof d === 'string') return head + '<p class="err">読み込めませんでした: ' + esc(d) + '</p><p><button type="button" class="btn" id="vc-retry">もう一度読み込む</button></p>';
    var list = (d && Array.isArray(d.channels) ? d.channels : []).filter(function (c) { return c && typeof c.channel_key === 'string'; });
    if (!list.length) return head + '<p class="muted" data-channels-empty="1">確認済みのチャンネルはまだありません。</p>';
    return head + '<ul class="vc-list">' + list.map(function (c, i) {
      var name = typeof c.channel_name === 'string' && c.channel_name ? c.channel_name : c.channel_key;
      var url = typeof c.channel_url === 'string' ? c.channel_url : '';
      var link = url && safeAuthorHref(url) ? '<a href="' + esc(url) + '" rel="noopener noreferrer" target="_blank">' + esc(name) + '</a>' : '<b>' + esc(name) + '</b>';
      return '<li class="vc-item" data-channel-key="' + esc(c.channel_key) + '"><span class="vc-name">' + link + '</span>' +
        '<span class="vc-url muted">' + esc(url) + '</span><span class="vc-date muted">確かめた日 ' + esc(channelDate(c.created_at)) + '</span>' +
        '<button type="button" class="btn small" data-channel-del="' + i + '">外す</button></li>';
    }).join('') + '</ul>';
  }
  function loadChannels(here) {
    var box = $('#vc-channels');
    if (!box) return;
    box.innerHTML = channelsHtml(null);
    api('GET', '/api/channels').then(function (d) {
      if (location.hash !== here || !$('#vc-channels')) return;
      var list = (d && Array.isArray(d.channels) ? d.channels : []).filter(function (c) { return c && typeof c.channel_key === 'string'; });
      box.innerHTML = channelsHtml({ channels: list });
      Array.prototype.forEach.call(box.querySelectorAll('[data-channel-del]'), function (b) {
        var c = list[Number(b.getAttribute('data-channel-del'))];
        if (!c) return;
        b.addEventListener('click', function () {
          action(b, {
            title: 'チャンネル「' + (c.channel_name || c.channel_key) + '」を確認済みから外します',
            body: '外した後、このチャンネルの動画は次から「初めてのチャンネル」として人に出ます。公開済みの教材は変わりません。',
            okText: '外す', busyText: '外しています…',
            run: function () { return api('DELETE', '/api/channels?key=' + encodeURIComponent(c.channel_key)); },
            success: 'チャンネル「' + (c.channel_name || c.channel_key) + '」を外しました',
            after: function () { loadChannels(here); }
          });
        });
      });
    }, function (e) {
      if (location.hash !== here || !$('#vc-channels')) return;
      box.innerHTML = channelsHtml(e.message || '失敗しました');
      var r = $('#vc-retry');
      if (r) r.addEventListener('click', function () { loadChannels(here); });
    });
  }
  function viewVideos(view) {
    view.innerHTML = videosLoadingHtml();
    var here = location.hash;
    api('GET', '/api/videos/status').then(function (d) {
      if (location.hash !== here) return;
      view.innerHTML = videosAdminHtml(d) + '<div class="card" id="vc-channels"></div>';
      loadChannels(here);
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

  // ---- 画面: 立体モデル（§AJ2-3・§AK-5。権利を確かめ、通った GLB の件は確認の直後に取り込む。止める / 戻す）----
  var M3D_KIND_LABEL = { sketchfab: 'Sketchfab（埋め込み）', voyager: 'Smithsonian Voyager（埋め込み）', download: 'GLB ファイル' };
  var M3D_CHECK_BODY = '提供元の記録を取りに行き、通ればファイルも取り込みます（GLB の件）';
  var M3D_BLOCK_BODY = '学習者側の一覧と配信から外します';
  function model3dMiB(bytes) { return (Number(bytes || 0) / 1048576).toFixed(1); }
  /** 状態の文言（GET /api/models3d の 1 件の state から。§AJ2 のまま。取り直しは「権利を確かめる」） */
  function model3dStateText(m) {
    var st = m && m.state;
    if (st === 'embed') return '埋め込み';
    if (st === 'hosted') return '取り込み済み（' + model3dMiB(m.bytes) + ' MiB・' + channelDate(m.fetched_at) + '）';
    if (st === 'hosted_missing') return '取り込み済みだがファイルが無い（「権利を確かめる」で取り直します）';
    if (st === 'not_hosted') return '未取り込み';
    if (st === 'unavailable') return '取り込めない（配布の url が無い）';
    return String(st || '—');
  }
  /** §AK-5: 根拠の種類の日本語 */
  var RIGHTS_KIND_TEXT = { api: '機械: 提供元の API', statement: '機械: 提供元の記述', 'cc-url': '機械: CC の URL（埋め込みだけ）', human: '人の記録' };
  function rightsKindText(k) { return typeof k === 'string' && vhas(RIGHTS_KIND_TEXT, k) ? RIGHTS_KIND_TEXT[k] : '—'; }
  /** §AK-5: fail_code の日本語（知らないコードはそのまま） */
  function rightsFailText(code) {
    var c = typeof code === 'string' ? code : '';
    if (c.indexOf('fetch_failed:') === 0) return '提供元から取れませんでした';
    if (c === 'too_large') return '提供元のページが大きすぎます';
    if (c === 'bad_response') return '提供元の応答が読めません';
    if (c === 'uploader_mismatch') return '投稿者が一覧と違います';
    if (c === 'uploader_missing') return '一覧に投稿者がありません';
    if (c === 'embed_mismatch' || c === 'page_mismatch' || c === 'uid_mismatch') return '提供元の情報が一覧と違います';
    if (c === 'attribution_mismatch') return '出典の書き方が投稿者の名前と合いません';
    if (c === 'no_cc_url') return 'ページに CC の URL がありません';
    if (c === 'ambiguous_cc_url') return 'ページに CC の URL が 2 つ以上あります';
    if (c.indexOf('title_') === 0) return 'ページの題名が一覧と違います';
    if (c.indexOf('source_') === 0) return 'ページの Source の行が一覧と違います';
    if (c === 'third_party_marker') return '第三者の権利の印があります';
    if (c === 'download_url_not_linked') return 'ページにファイルのリンクがありません';
    if (c.indexOf('statement_missing:') === 0) return '提供元の決まりの文が見つかりません';
    if (c.indexOf('evidence_') === 0 || c === 'subject_mismatch') return '根拠のページが対象と合いません';
    return c || '—';
  }
  /** 取り込みの失敗（import: の後ろ・応答の import.error）の日本語 */
  function model3dImportErrorText(error) {
    var c = typeof error === 'string' ? error : '';
    if (c === 'too_large') return '24 MiB を超えています';
    if (c.indexOf('bad_glb:') === 0) return 'GLB の形が合いません（' + c.slice('bad_glb:'.length) + '）';
    if (c.indexOf('fetch_failed:') === 0) return '提供元から取れませんでした（' + c.slice('fetch_failed:'.length) + '）';
    return c || '失敗しました';
  }
  /** §AK-4 4・§AK-5: 門番で止まった理由（rightsReasonOf の値）の日本語 */
  var RIGHTS_REASON_TEXT = { ok: '確認済み', no_record: '未確認', invalid: '記録が壊れています', subject_changed: '一覧が変わりました（確かめ直し待ち）', blocked: '止めています', unverified: '確認できていません', mismatch: '対象が一致しません', license: 'ライセンスの決まりで出せません' };
  function rightsReasonText(r) { return typeof r === 'string' && vhas(RIGHTS_REASON_TEXT, r) ? RIGHTS_REASON_TEXT[r] : (typeof r === 'string' && r ? r : '未確認'); }
  /** 記録の status の日本語（「戻す」の確認文） */
  var RIGHTS_STATUS_TEXT = { verified: '確認済み', stale: '取り直し失敗', mismatch: '対象が一致しません', unverified: '確認できていません', human: '人の記録' };
  function rightsStatusText(s) { return typeof s === 'string' && vhas(RIGHTS_STATUS_TEXT, s) ? RIGHTS_STATUS_TEXT[s] : '未確認'; }
  function rightsOf(m) { return m && isObj(m.rights) ? m.rights : {}; }
  /** §AK-5: 権利の列の文（1 行ずつ。止めている札は rightsCellHtml が足す）。r = GET /api/models3d の 1 件の rights */
  function rightsStateText(r) {
    r = isObj(r) ? r : {};
    var out = [];
    if (r.record === 'none') out.push('未確認');
    else if (r.record === 'invalid') out.push('記録が壊れています');
    else out.push(String(r.label || '不明') + '（' + rightsKindText(r.evidence_kind) + '）');
    if (r.reason === 'subject_changed') out.push('一覧が変わりました（確かめ直し待ち）');
    if (r.check === 'unsupported') out.push('確かめ方が未登録（台帳に足す）');
    if (r.status === 'stale') out.push('取り直し失敗: ' + rightsFailText(r.fail_code));
    else if (r.status === 'mismatch') out.push('対象が一致しません: ' + rightsFailText(r.fail_code));
    else if (r.status === 'unverified') out.push(r.fail_code ? '確認できていません: ' + rightsFailText(r.fail_code) : '確認できていません');
    if (isObj(r.last_import_fail) && typeof r.last_import_fail.result === 'string') out.push('取り込み失敗: ' + model3dImportErrorText(r.last_import_fail.result.replace(/^import:/, '')));
    var modes = isObj(r.modes) ? r.modes : {};
    if (r.status === 'verified' && !modes.host && !modes.embed) out.push('提供できません（' + String(r.label || '不明') + '）');
    return out;
  }
  /** 権利の列の HTML（1 行目 = ライセンスと根拠、2 行目以降は注記、止めている時は赤の札） */
  function rightsCellHtml(r) {
    r = isObj(r) ? r : {};
    var lines = rightsStateText(r);
    return '<span class="m3d-rights-main">' + esc(lines[0]) + '</span>' + (r.blocked === true ? ' ' + pill('止めている', 'red') : '') +
      lines.slice(1).map(function (t) { return '<span class="m3d-note">' + esc(t) + '</span>'; }).join('');
  }
  /** 確認日（checked_at。無ければ最後の試行 last_attempt_at） */
  function rightsDateText(r) {
    r = isObj(r) ? r : {};
    if (typeof r.checked_at === 'string' && r.checked_at) return channelDate(r.checked_at);
    if (typeof r.last_attempt_at === 'string' && r.last_attempt_at) return '最後の試行 ' + channelDate(r.last_attempt_at);
    return '—';
  }
  /** §AK-5: 「権利を確かめる」の toast（res = POST …/check の応答、blocked = その行が止めてあるか） */
  function rightsCheckToast(res, blocked) {
    var s = res && res.status, label = res && typeof res.label === 'string' ? res.label : '不明', msg;
    var modes = res && isObj(res.modes) ? res.modes : {};
    var imp = res && isObj(res.import) ? res.import : null;
    if (s === 'verified') {
      if (imp && (imp.status === 'fetched' || imp.status === 'unchanged')) msg = '取り込みました（' + model3dMiB(imp.bytes) + ' MiB）';
      else if (imp) msg = '確かめましたが取り込めませんでした（' + model3dImportErrorText(imp.error) + '）';
      else msg = blocked || modes.host || modes.embed ? '確かめました（' + label + '）' : '確かめましたが提供できません（' + label + '）';
    } else if (s === 'human') msg = '人の記録を書きました';
    else if (s === 'human_unchanged') msg = '人の記録に変わりはありません';
    else if (s === 'failed') msg = '確かめられませんでした（' + rightsFailText(res.fail_code) + '）';
    else if (s === 'skipped') msg = res.reason === 'busy' ? 'いま別の確認が走っています' : '確かめ方が未登録（台帳に足す）';
    else if (s === 'lost_claim') msg = '確認が長引いたので結果を捨てました。もう一度';
    else msg = '完了しました';
    return msg + (blocked ? '（止めているので出ません）' : '');
  }
  /** 「戻す」の確認文 */
  function rightsUnblockBody(r) {
    r = isObj(r) ? r : {};
    return '最後の記録のとおりに戻します（' + String(r.label || '不明') + '・' + rightsStatusText(r.status) + '）';
  }
  function models3dLoadingHtml() { return '<h1>立体モデル</h1><p class="loading" data-m3d-loading="1">読み込み中…</p>'; }
  function models3dErrorHtml(msg) {
    return '<h1>立体モデル</h1><div class="card" data-m3d-error="1"><p class="err">読み込めませんでした: ' + esc(msg) + '</p><p><button type="button" class="btn" id="m3d-retry">もう一度読み込む</button></p></div>';
  }
  function models3dListOf(d) { return (d && Array.isArray(d.models) ? d.models : []).filter(function (m) { return isObj(m) && typeof m.id === 'string'; }); }
  /** #/models3d の本体（GET /api/models3d の応答から描く純関数）。題名は page_url（https:// の時だけ）へのリンク */
  function models3dPageHtml(d) {
    var list = models3dListOf(d);
    var rows = list.map(function (m, i) {
      var r = rightsOf(m);
      var title = typeof m.page_url === 'string' && /^https:\/\//.test(m.page_url)
        ? '<a href="' + esc(m.page_url) + '" target="_blank" rel="noopener noreferrer">' + esc(m.title) + '</a>' : esc(m.title);
      var btns = (r.check !== 'unsupported' ? '<button type="button" class="btn small" data-m3d-check="' + i + '">権利を確かめる</button>' : '') +
        (r.blocked === true ? '<button type="button" class="btn small" data-m3d-unblock="' + i + '">戻す</button>' : '<button type="button" class="btn small" data-m3d-block="' + i + '">止める</button>');
      return '<tr data-m3d-id="' + esc(m.id) + '" data-m3d-state="' + esc(m.state) + '"' + (r.blocked === true ? ' data-m3d-blocked="1"' : '') + '><td>' + title + '</td><td>' + esc(m.org) + '</td><td class="m3d-rights">' +
        rightsCellHtml(r) + '</td><td>' + esc(rightsDateText(r)) + '</td><td>' + esc(M3D_KIND_LABEL[m.kind] || m.kind) + '</td><td>' + esc(model3dStateText(m)) + '</td><td class="m3d-ops">' + btns + '</td></tr>';
    }).join('');
    return '<h1>立体モデル</h1>' +
      '<div class="card"><p class="muted">一覧（factory/models3d/catalog.json）の立体モデルです。工場が権利の記録を確かめたものだけが、注文票・確認画面・学習者側に出ます（10 分ごとに少しずつ自動で確かめます）。GLB ファイルの件は、権利が通った直後に取り込みます（1 件 24 MiB まで）。</p>' +
      (list.length ? '<div class="table-wrap"><table class="m3d-table"><thead><tr><th>題名</th><th>提供元</th><th>権利</th><th>確認日</th><th>種類</th><th>状態</th><th>操作</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
        : '<p class="muted" data-m3d-empty="1">一覧に立体モデルがありません。</p>') + '</div>';
  }
  function viewModels3d(view) {
    view.innerHTML = models3dLoadingHtml();
    var here = location.hash;
    api('GET', '/api/models3d').then(function (d) {
      if (location.hash !== here) return;
      var list = models3dListOf(d);
      view.innerHTML = models3dPageHtml({ models: list });
      var again = function () { if (location.hash === here) viewModels3d(view); };
      var bind = function (attr, make) {
        Array.prototype.forEach.call(view.querySelectorAll('[' + attr + ']'), function (b) {
          var m = list[Number(b.getAttribute(attr))];
          if (!m) return;
          b.addEventListener('click', function () { action(b, make(m)); });
        });
      };
      bind('data-m3d-check', function (m) {
        var blocked = rightsOf(m).blocked === true;
        return {
          title: m.title + '（' + m.org + '）の権利を確かめる', body: M3D_CHECK_BODY, okText: '確かめる', busyText: '確かめ中…',
          run: function () { return api('POST', '/api/rights/models3d/' + encodeURIComponent(m.id) + '/check'); },
          success: function (res) { return rightsCheckToast(res, blocked); },
          after: again, fail: again
        };
      });
      bind('data-m3d-block', function (m) {
        return {
          title: m.title + '（' + m.org + '）を止める', body: M3D_BLOCK_BODY, okText: '止める', busyText: '止めています…',
          run: function () { return api('POST', '/api/rights/models3d/' + encodeURIComponent(m.id) + '/block'); },
          success: '止めました（学習者側の一覧と配信から外しました）', after: again, fail: again
        };
      });
      bind('data-m3d-unblock', function (m) {
        return {
          title: m.title + '（' + m.org + '）を戻す', body: rightsUnblockBody(rightsOf(m)), okText: '戻す', busyText: '戻しています…',
          run: function () { return api('POST', '/api/rights/models3d/' + encodeURIComponent(m.id) + '/unblock'); },
          success: '戻しました', after: again, fail: again
        };
      });
    }, function (e) {
      if (location.hash !== here) return;
      view.innerHTML = models3dErrorHtml(e.message);
      var r = $('#m3d-retry');
      if (r) r.addEventListener('click', route);
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
    var chip = floor.filter === 'retro' ? stationName(floor.filter) + 'を選んでいます' : stationName(floor.filter) + 'にいる素材だけ表示中';
    b.innerHTML = esc(chip) + ' <span class="scene-filter-x" aria-hidden="true">✕</span>';
    b.setAttribute('aria-label', chip + (floor.filter === 'retro' ? '。押すと選択を解除します' : '。押すと絞り込みを解除します'));
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
  /** 工場で改善係を選んだ時の入口（GET /api/floor の stations.retro から描く純関数） */
  function retroFloorPanelHtml(rt) {
    rt = rt || {};
    var notes = Number(rt.active_maker_notes || 0), pending = Number(rt.pending || 0);
    return '<div class="fq-empty retro-floor" data-retro-floor="1"><h2 id="fq-h">改善係</h2>' +
      '<p>終わった注文ごとに費用を振り返り、質を下げずに費用を下げる「工夫」を職人に渡します。</p>' +
      '<ul class="retro-facts"><li>いま職人に渡している工夫 <b>' + esc(notes) + ' 件</b></li>' +
      '<li>振り返り中 <b>' + esc(pending) + ' 件</b></li>' +
      '<li>最後の振り返り <b>' + esc(rt.last_retro_at ? fmtTime(rt.last_retro_at) : 'まだありません') + '</b></li></ul>' +
      '<div class="row"><a class="btn primary" href="#/retro">改善係の記録を開く</a><button type="button" class="btn" data-fq-clear="1">選択を解除</button></div></div>';
  }

  /** 制作キュー（見出し + 表）。opts = { filter: 持ち場 id | null, open: { 素材 id: true }, menuOpen, retro: stations.retro }。0 件なら案内 */
  function floorQueueHtml(queue, opts) {
    opts = opts || {};
    queue = queue || [];
    var S = floorScene();
    // 改善係（§S）は素材を持たない見回り役。選んだ時は表の代わりに「改善係の記録」への入口を出す
    if (opts.filter === 'retro') return retroFloorPanelHtml(opts.retro);
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
    q.innerHTML = floorQueueHtml(d.queue, { filter: floor.filter, open: floor.open, menuOpen: floor.menuOpen, retro: d.stations && d.stations.retro });
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
  window.FactoryAdminFloor = { floorBandHtml: floorBandHtml, floorQueueHtml: floorQueueHtml, floorChipsHtml: floorChipsHtml, sanitizeCharSvg: sanitizeCharSvg, retroFloorPanelHtml: retroFloorPanelHtml };

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
        pill('制作: ' + (WORK_LABEL[m.work_status] || m.work_status)) + (autoReworkJob(d) ? pill('自動で作り直し中', 'yellow') : '') + '<span class="muted">slug ' + esc(m.slug) + ' / 型 ' + esc((m.kinds || []).join(', ')) + '</span>' + machineOrderFactHtml(d.machine_order) + '</div>' +
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
          // §V-9 d: 機械の承認（自動公開のスイッチ）
          if (r.reviewer_email === AUTO_PUBLISHER) return '<li data-auto-decision="publish">' + esc(fmtTime(r.created_at)) + ' ' + pill('自動で公開', 'green') + '</li>';
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
      var autoAns = isAutoAnswer(saved);
      html += '<div class="aq-answer"' + (autoAns ? ' data-auto-answer="1"' : '') + '><span class="aq-label">' + (autoAns ? '機械の自動回答（職人の既定案のとおり）' : 'あなたの回答') + '</span>' + (saved !== null ? '<p>' + esc(saved) + '</p>' : '<p class="muted">回答はありません</p>') + '</div>';
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

  /** §U-4: 機械用の注文の入口から来た時だけ事実の欄に出す（client の文字列は画面に出さない） */
  function machineOrderFactHtml(mo) {
    return mo ? '<span class="muted" data-machine-order="1">' + esc('注文した人: Claude（機械の入口）') + '</span>' : '';
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

  /** 契約 V-12: 自動回答の本文は固定の前置き「（自動回答・職人の既定案のとおり）」で始まる（人の回答と見分ける唯一の印） */
  function isAutoAnswer(saved) { return typeof saved === 'string' && saved.indexOf('（自動回答') === 0; }
  /** 回答済みの質問を見ている時（input / resend 以外）の案内。「今ここで答えを求められている」と読めないようにする */
  function answeredNoteHtml(j, qs, mode) {
    if (mode === 'input' || mode === 'resend' || !qs.length) return '';
    var anyAuto = qs.some(function (q) { return isAutoAnswer(savedAnswerOf(j, q.id)); });
    var txt = 'この質問はもう答えてあり、ここで答える操作はありません。';
    if (anyAuto) txt += '機械の差し戻しからの作り直しなので、機械が職人の既定案で自動で答えました。';
    if (j.status === 'done') txt += 'できあがった版は「素材へ」から確認画面で見られます。';
    else if (j.status === 'running' || j.status === 'creating') txt += '職人が制作中です。';
    return '<div class="aq-note" data-answered-note="1">' + esc(txt) + '</div>';
  }

  function jobHtml(j, mode, draft, machineOrder) {
    var qs = j.questions || [];
    var kind = KIND_TEXT[j.kind] || j.kind || '—';
    var state = JOB_LABEL[j.status] || j.status;
    var who = machineOrderFactHtml(machineOrder);
    var head;
    if (mode === 'input') head = '<h1>職人からの質問（' + qs.length + ' 問）</h1><p class="aq-lead">答えると、職人が制作を始めます。<span class="muted">注文の種類: ' + esc(kind) + '</span>' + who + '</p>';
    else if (mode === 'resend') head = '<h1>職人からの質問（' + qs.length + ' 問）</h1><p class="aq-lead"><span class="muted">注文の種類: ' + esc(kind) + '</span>' + who + '</p>';
    else if (mode === 'readonly') head = '<h1>職人からの質問（' + qs.length + ' 問）</h1><p class="aq-lead">状態: ' + esc(state) + '<span class="muted">注文の種類: ' + esc(kind) + '</span>' + who + '</p>';
    else head = '<h1>注文の状況</h1><p class="aq-lead">状態: ' + esc(state) + '<span class="muted">注文の種類: ' + esc(kind) + '</span>' + who + '</p>';
    var foot = '';
    if (mode === 'input') {
      foot = '<div class="rv-foot" id="aq-foot"><div class="row rv-foot-row"><span id="aq-progress" aria-live="polite"></span>' +
        '<div class="rv-btns aq-btns"><span class="muted" id="aq-left"></span><button type="button" class="btn primary" id="ans-btn" disabled>回答を送って制作を始める</button></div></div></div>';
    } else if (mode === 'resend') {
      foot = '<div class="rv-foot" id="aq-foot"><div class="row rv-foot-row"><span>回答は保存済みです</span>' +
        '<div class="rv-btns aq-btns"><button type="button" class="btn primary" id="ans-btn">もう一度送る</button></div></div></div>';
    }
    return '<p class="aq-crumb"><a href="#/material/' + esc(j.material_id) + '" id="job-crumb">素材へ</a></p>' + head + jobAlertHtml(j) + answeredNoteHtml(j, qs, mode) +
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
      view.innerHTML = jobHtml(j, mode, draft, d.machine_order);
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
  // §V-9: 仕分け v2 の 6 項目（どれも機械が OK にできる。並びは CHECKLIST と同じ）
  var MK_KEYS = CHECKLIST.map(function (c) { return c[0]; });
  // 読み手係の結果で決まる 3 項目（§V-6 d。読み手チェックの未了で review のままになる）
  var READER_KEYS = ['explanation_and_expression', 'relation_to_learning', 'conditions_of_use'];
  // ゲートの印（§V-9 a 1.）。attention の {n} は見てほしい所の数。pending の文は pending_on と検証の状態で変える
  var GATE_TEXT = {
    clean: '機械の確認: 全部通りました', attention: '見てほしい所 {n} 件',
    pending: '機械の確認中', verify_failed: '検証ができていません（再検証を押してください）', reader_only: '読み手チェック待ち（待たずに公開もできます）'
  };
  var GATE_CLS = { clean: 'green', attention: 'orange', pending: 'gray' };
  var READER_STATE_TEXT = { pending: '順番を待っています', running: '動いています', done: '済み', failed: 'できませんでした' };
  // note の主張の札（§V-9 b。仮説として書いてある・たとえ）
  var NOTE_TAG = { hypothesis_hedged: '仮説として書いてある', analogy: 'たとえ' };
  // 送信の checklist の note（§V-9 c）
  var CK_NOTE_CHECKED = '見てほしい所を確認';
  var CK_NOTE_NO_READER = '読み手チェックなしで見た';
  // 「公開する」が押せない理由の文（§V-9 c。verbatim）
  var WHY_TEXT = {
    not_review: '確認待ちの版ではありません',
    verify: '検証が終わるのを待つ',
    contradicted: '食い違いの主張がある（直してもらってください）',
    primary: '職人が開けていない一次資料がある（直してもらってください）',
    reverify: '自動の再検証を待っています',
    auto_return: '自動の差し戻しを待っています',
    open: '見てほしい所があと {n} 件（OK にするか、直してもらうを選ぶ）',
    redo: '『直してもらう』にした所があります（直してもらうを押してください）',
    ok: '公開できます',
    ok_reader: '公開できます（読み手チェックはまだです）'
  };
  var MEDIA_LABEL = { figure: '図', app: '動かせるもの', video: '動画', model3d: '立体モデル' };
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
      // §MC-6: YouTube の公開日（YYYY-MM-DD の形の時だけ。無い・形が違えば「不明」）
      var pub = typeof m.published === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(m.published) ? m.published : '不明';
      line += '<p data-video-meta-published="1">公開日: ' + esc(pub) + '</p>';
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
  /** §AJ-4: material.parts[].models3d[] を出現順に（形の違う要素は飛ばさず残し、表示側で埋め込まない） */
  function models3dOf(mat) {
    var out = [];
    ((mat && mat.parts) || []).forEach(function (p) {
      if (p && Array.isArray(p.models3d)) p.models3d.forEach(function (x) { out.push(x && typeof x === 'object' ? x : {}); });
    });
    return out;
  }
  /** §AJ-4: models3d_meta（無い応答 = 古い Worker は null。何も出さない） */
  function models3dMetaOf(d) { return d && isObj(d.models3d_meta) ? d.models3d_meta : null; }
  /** §AJ-4: id の一覧の情報（無ければ null） */
  function model3dMetaFor(meta, id) { return meta && typeof id === 'string' && vhas(meta, id) && isObj(meta[id]) ? meta[id] : null; }
  function isSec(n) { return typeof n === 'number' && isFinite(n) && n >= 0 && Math.floor(n) === n; }
  /** 秒 → 分:秒（例 80 → 1:20） */
  function fmtSec(n) { var s = n % 60; return Math.floor(n / 60) + ':' + (s < 10 ? '0' : '') + s; }
  function videoHtml(v, vc) {
    var s = v.start_sec, e = v.end_sec;
    var okRange = isSec(s) && isSec(e) && s < e;
    var embed = ytEmbedHtml(v) || '<p class="err" data-video-bad="1">動画の id か区間の形が正しくないため、埋め込みません</p>';
    return '<div class="rv-video" data-video="' + esc(v.id) + '"><p><b>動画 ' + esc(v.id) + '</b> ' + esc(v.title) + '</p>' + embed +
      '<p>区間 ' + (okRange ? esc(fmtSec(s)) + '〜' + esc(fmtSec(e)) : '<span class="muted">不明</span>') + '</p>' +
      '<p>見どころ: ' + esc(v.why) + '</p>' +
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
  // §O-13-5: 絵の主張の結果の印 [印, 色の class, 読み上げの文]（checks が無い旧い結果・not_seen・検証前は none = 未検査）
  var FIG_CLAIM_MARK = { ok: ['✓', 'fc-ok', '合う'], wrong: ['✗', 'fc-wrong', '問題'], unclear: ['？', 'fc-unclear', '確かめきれない'], none: ['－', 'fc-none', '未検査'] };
  /** figures_meta（版の material_json の絵の主張と参照。無い時は {}） */
  function figuresMetaOf(d) {
    var m = d && d.figures_meta;
    return isObj(m) ? m : {};
  }
  /** サムネイルの下（判定の pill の下）の「絵の主張」の一覧（§O-13-5）。meta = figures_meta の 1 図、f = verification.figures の 1 図（無ければ null） */
  function figClaimsHtml(meta, f) {
    var shows = meta && Array.isArray(meta.shows) ? meta.shows.filter(isObj) : [];
    if (!shows.length) return '';
    var byN = {};
    if (f && f.verdict !== 'not_seen' && Array.isArray(f.checks)) f.checks.forEach(function (c) { if (isObj(c) && typeof c.n === 'number' && !Object.prototype.hasOwnProperty.call(byN, c.n)) byN[c.n] = c; });
    var ref = typeof meta.reference_url === 'string' && /^https:\/\//i.test(meta.reference_url) ? meta.reference_url : '';
    return '<div class="fig-claims" data-fig-claims="' + shows.length + '"><p class="thumb-cap"><b>絵の主張</b></p><ul>' + shows.map(function (x, i) {
      var c = Object.prototype.hasOwnProperty.call(byN, i + 1) ? byN[i + 1] : null;
      var key = c && Object.prototype.hasOwnProperty.call(FIG_CLAIM_MARK, c.result) && c.result !== 'none' ? c.result : 'none';
      var mk = FIG_CLAIM_MARK[key];
      var note = c && typeof c.note === 'string' && c.note ? ' <span class="muted">' + esc(c.note) + '</span>' : '';
      return '<li data-fig-claim="' + esc(key) + '"><span class="fc-mark ' + mk[1] + '" title="' + esc(mk[2]) + '">' + esc(mk[0]) + '</span> ' +
        esc(typeof x.text === 'string' ? x.text : '') + note + '</li>';
    }).join('') + '</ul>' +
      (ref ? '<p class="thumb-cap"><a data-fig-ref="1" href="' + esc(ref) + '" target="_blank" rel="noopener noreferrer">参照を開く</a></p>' : '') + '</div>';
  }
  var ACTIVE_JOB = ['queued', 'creating', 'running', 'needs_answer', 'budget_reached'];
  var DECISION_LABEL = { approve: '承認', 'return': '差し戻し', reject: '却下' };
  var AUTO_REVIEWER = 'system:auto-triage';
  var AUTO_PUBLISHER = 'system:auto-publish';
  var isObj = function (x) { return !!x && typeof x === 'object' && !Array.isArray(x); };
  function imageFiles(mat) {
    var out = [];
    ((mat && mat.parts) || []).forEach(function (p) { (p.files || []).forEach(function (f) { if (f && IMAGE_RE.test(f.path || '')) out.push(f.path); }); });
    return out;
  }
  /** 版ごとの画面の状態。items = 見てほしい所の状態（id → ok / redo）・itemGen = その世代・cursor = N / P で選んだ項目 */
  function newReviewState() {
    return { mode: null, note: '', append: '', draftShown: false, pv: defaultPv(), stickies: [], stickySeq: 0, flowedLines: [], items: Object.create(null), itemGen: null, cursor: -1, redoFlowed: [] };
  }
  function hasDraft(st) { return !!((st.note || '').trim() || (st.append || '').trim()); }

  /**
   * triage（§V-6 b）を読む。items が無い応答（古い Worker・仕分けの前）は「機械の確認中」（pending_on = verification）として扱う（§V-9 f）。
   * shown = 見てほしい所（severity が fix / ask。triage の順）。groups は出典カードの判定に残す（§L-3 互換）
   */
  function triageOf(d) {
    var t = d && isObj(d.triage) ? d.triage : null;
    var items = t && Array.isArray(t.items) ? t.items.filter(function (x) { return isObj(x) && typeof x.id === 'string'; }) : null;
    var auto = {};
    MK_KEYS.forEach(function (k) { var x = t && isObj(t.auto) ? t.auto[k] : null; auto[k] = x === 'ok' || x === 'review' ? x : null; });
    var gate = items && (t.gate === 'clean' || t.gate === 'attention' || t.gate === 'pending') ? t.gate : 'pending';
    var pendingOn = [];
    if (gate === 'pending') {
      if (items && Array.isArray(t.pending_on)) pendingOn = t.pending_on.filter(function (x, i, a) { return (x === 'verification' || x === 'reader') && a.indexOf(x) === i; });
      else if (items) {
        // pending_on の無い応答: 版の状態から決める（§V-6 e と同じ規則）
        var v = (d && d.version) || {}, rs = readerOf(d).status;
        if (v.verification_status !== 'done' || !d.verification_id) pendingOn.push('verification');
        if (rs === 'pending' || rs === 'running') pendingOn.push('reader');
      }
      if (!pendingOn.length) pendingOn = ['verification']; // 理由が読めない pending は止める側に倒す
    }
    var shown = (items || []).filter(function (x) { return x.severity === 'fix' || x.severity === 'ask'; });
    return {
      present: !!items, hasGroups: !!t && Array.isArray(t.groups), gate: gate, pending_on: pendingOn, auto: auto,
      items: items || [], shown: shown, groups: t && Array.isArray(t.groups) ? t.groups : [],
      ok_counts: t && isObj(t.ok_counts) ? t.ok_counts : { claims: (d && d.claims || []).length, sources: (d && d.sources || []).length },
      needs_review: shown.length,
      action: t && (t.action === 'auto_return' || t.action === 'reverify') ? t.action : 'none',
      reasons: t && Array.isArray(t.reasons) ? t.reasons : [],
      verification_id: t && typeof t.verification_id === 'string' ? t.verification_id : null,
      trusted_keys: strArr(t && t.trusted_keys)
    };
  }
  /** 読み手係の結果（§V-8 reader）。無い応答（古い Worker）は status null */
  function readerOf(d) {
    var r = d && isObj(d.reader) ? d.reader : null;
    return {
      present: !!r, status: r && vhas(READER_STATE_TEXT, r.status) ? r.status : null,
      gen: r && typeof r.gen === 'string' ? r.gen : null,
      findings: r && Array.isArray(r.findings) ? r.findings.filter(isObj) : [],
      learning: r && isObj(r.learning) ? r.learning : null, conditions: r && isObj(r.conditions) ? r.conditions : null,
      summary: r && typeof r.summary === 'string' ? r.summary : '', not_read: strArr(r && r.not_read)
    };
  }
  function readerText(d) { var s = readerOf(d).status; return s ? READER_STATE_TEXT[s] : 'まだありません'; }

  // ---- 見てほしい所の状態（§V-9 c: open / ok / redo。検証の id + 読み手係の世代に結び付ける）----
  function itemGenOf(d) { return String((d && d.verification_id) || '') + '|' + String(readerOf(d).gen || ''); }
  /** st の項目の状態（世代が違えば空 = 全部 open。st は変えない） */
  function statesFor(st, d) { return st && st.items && st.itemGen === itemGenOf(d) ? st.items : Object.create(null); }
  function stateIn(states, id) { var v = vhas(states, id) ? states[id] : 'open'; return v === 'ok' || v === 'redo' ? v : 'open'; }
  /** 世代が変わっていたら項目の状態を全部 open に戻す（再検証・読み直しの後に古い OK を引き継がない） */
  function syncItemGen(st, d) {
    var g = itemGenOf(d);
    if (st.itemGen !== g || !st.items) { st.itemGen = g; st.items = Object.create(null); st.cursor = -1; st.redoFlowed = []; }
    return st;
  }
  /** 項目を ok / redo にする。同じ状態をもう一度押したら open に戻す。blocking の項目は ok にできない・ask の項目は redo にしない */
  function toggleItem(st, d, item, to) {
    syncItemGen(st, d);
    if (!item || (to === 'ok' && item.blocking) || (to === 'redo' && item.severity !== 'fix')) return st;
    st.items[item.id] = stateIn(st.items, item.id) === to ? 'open' : to;
    return st;
  }

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
  /** 判定帯のゲートの印の文（§V-9 a 1.） */
  function gateText(d, tri) {
    if (tri.gate === 'attention') return GATE_TEXT.attention.replace('{n}', tri.shown.length);
    if (tri.gate === 'clean') return GATE_TEXT.clean;
    if (tri.pending_on.indexOf('verification') >= 0) return d.version && d.version.verification_status === 'failed' ? GATE_TEXT.verify_failed : GATE_TEXT.pending;
    return GATE_TEXT.reader_only;
  }

  /**
   * 「公開する」が押せるか（§V-9 c）。why は押せない理由（verbatim の文と、押すと動く先の要素 id）。text は状態の 1 行。
   * 読み手チェックの未了（pending_on が ['reader']）では止めない（readerWait = true で「読み手チェックはまだです」を添える）
   */
  function approveState(d, st) {
    var v = d.version || {}, tri = triageOf(d), why = [];
    if (v.status !== 'review') return { enabled: false, why: [{ text: WHY_TEXT.not_review, target: 'rv-band' }], text: WHY_TEXT.not_review, readerWait: false };
    if (v.verification_status !== 'done' || !d.verification_id || tri.pending_on.indexOf('verification') >= 0) why.push({ text: WHY_TEXT.verify, target: 'rv-band' });
    var first = function (pred) { for (var i = 0; i < tri.shown.length; i++) if (pred(tri.shown[i])) return i; return -1; };
    var bOther = first(function (x) { return x.blocking === true && x.cause !== 'primary_source_unfetched'; });
    var bPrim = first(function (x) { return x.blocking === true && x.cause === 'primary_source_unfetched'; });
    if (bOther >= 0) why.push({ text: WHY_TEXT.contradicted, target: 'rv-it-' + bOther });
    if (bPrim >= 0) why.push({ text: WHY_TEXT.primary, target: 'rv-it-' + bPrim });
    if (tri.action === 'reverify') why.push({ text: WHY_TEXT.reverify, target: 'rv-band' });
    else if (tri.action === 'auto_return') why.push({ text: WHY_TEXT.auto_return, target: 'rv-band' });
    var states = statesFor(st, d), open = 0, firstOpen = -1, redo = -1;
    tri.shown.forEach(function (x, i) {
      var s = stateIn(states, x.id);
      if (s === 'open') { open++; if (firstOpen < 0) firstOpen = i; }
      if (s === 'redo' && redo < 0) redo = i;
    });
    if (open) why.push({ text: WHY_TEXT.open.replace('{n}', open), target: 'rv-it-' + firstOpen });
    if (redo >= 0) why.push({ text: WHY_TEXT.redo, target: 'return-btn' });
    var readerWait = tri.pending_on.indexOf('reader') >= 0;
    return { enabled: !why.length, why: why, readerWait: readerWait, text: why.length ? why[0].text : readerWait ? WHY_TEXT.ok_reader : WHY_TEXT.ok };
  }

  /**
   * decision に送る checklist（§V-9 c）。承認は triage.auto[k] が ok でない項目だけ。
   * note: 読み手チェックの未了で review のままの 3 項目は「読み手チェックなしで見た」、それ以外は「見てほしい所を確認」。差し戻し・却下は送らない（null）
   */
  function checklistPayload(d, st, forApprove) {
    if (!forApprove) return null;
    var tri = triageOf(d), out = {}, readerWait = tri.pending_on.indexOf('reader') >= 0;
    MK_KEYS.forEach(function (k) {
      if (tri.auto[k] === 'ok') return;
      out[k] = { result: 'ok', note: readerWait && READER_KEYS.indexOf(k) >= 0 ? CK_NOTE_NO_READER : CK_NOTE_CHECKED };
    });
    return out;
  }
  /** 承認で確認済みにするチャンネル: ok にした「初めてのチャンネル」の項目の channel_key（§V-9 c） */
  function trustChannelsOf(d, st) {
    var states = statesFor(st, d), out = [];
    triageOf(d).shown.forEach(function (x) {
      if (x.cause === 'video_channel_new' && typeof x.channel_key === 'string' && x.channel_key && stateIn(states, x.id) === 'ok' && out.indexOf(x.channel_key) < 0) out.push(x.channel_key);
    });
    return out;
  }
  /** POST …/decision の本文（§V-8・§V-7 e） */
  function decisionPayload(d, st, decision) {
    var p = { decision: decision, checklist: checklistPayload(d, st, decision === 'approve'), note: decision === 'approve' ? '' : decisionNote(st, decision), verification_id: d.verification_id };
    if (decision === 'approve') { p.trust_channels = trustChannelsOf(d, st); p.reader_gen = readerOf(d).gen; }
    if (decision === 'return') p.brief_append = st.append;
    return p;
  }

  /** キー → 命令（§V-9 c キー）。env: { inInput, dialogOpen, busy, draft }。1〜3 はやめた */
  function keyCommand(e, env) {
    if (!e || e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return null;
    if (env.inInput || env.dialogOpen || env.busy) return null;
    var key = e.key || '';
    if (key === '?') return { cmd: 'help' };
    if (e.shiftKey) return null;
    var k = key.toLowerCase();
    if (k === 'a') return { cmd: 'approve' };
    if (k === 'r') return { cmd: 'return' };
    if (k === 'x') return { cmd: 'reject' };
    if (k === 'j' || k === 'k') return env.draft ? { cmd: 'draft_block' } : { cmd: 'nav', dir: k === 'j' ? 1 : -1 };
    if (k === 'n' || k === 'p') return { cmd: 'item_step', dir: k === 'n' ? 1 : -1 };
    if (k === 'o') return { cmd: 'item_ok' };
    return null;
  }
  /** 状態だけを変える命令（draft_block・item_step・item_ok）を適用する。d は版の応答（項目の命令に要る）。他の命令は呼び出し側が実行する */
  function applyCommand(st, cmd, d) {
    if (!cmd) return st;
    if (cmd.cmd === 'draft_block') st.draftShown = true;
    if ((cmd.cmd === 'item_step' || cmd.cmd === 'item_ok') && d) {
      syncItemGen(st, d);
      var shown = triageOf(d).shown;
      if (!shown.length) return st;
      var c = typeof st.cursor === 'number' && st.cursor >= 0 && st.cursor < shown.length ? st.cursor : -1;
      if (cmd.cmd === 'item_step') st.cursor = c < 0 ? (cmd.dir > 0 ? 0 : shown.length - 1) : (c + cmd.dir + shown.length) % shown.length;
      else if (c >= 0 && !shown[c].blocking) st.items[shown[c].id] = 'ok'; // O は OK にするだけ（戻すのはボタンで）
    }
    return st;
  }

  function linkOrText(url) {
    if (!url) return '<span class="muted">なし</span>';
    return /^https?:\/\//.test(url) ? '<a class="pre" href="' + esc(url) + '" rel="noopener noreferrer" target="_blank">' + esc(url) + '</a>' : '<span class="pre">' + esc(url) + '</span>';
  }

  // ---- 項目の場所（§V-9 b）: 主張 = その主張の印が付いた段落 / path が変奏 = quote を含む段落 / material.json = 枠の頭 / 図・動かせるもの・動画 = その部品 ----
  function partsOf(d) { var m = d && d.version && d.version.material; return m && Array.isArray(m.parts) ? m.parts.map(function (p) { return isObj(p) ? p : {}; }) : []; }
  function variantsOf(p) { return (p && Array.isArray(p.variants) ? p.variants : []).filter(function (v) { return isObj(v) && typeof v.path === 'string'; }); }
  /** 空白と * # ` を取り除く（quote と段落の部分一致に使う） */
  function normQ(s) { return String(s === null || s === undefined ? '' : s).replace(/[\s*#`]/g, ''); }
  /** 変奏 → 切り替えの選び方 */
  function variantSel(vr) { return { aud: vr.audience === 'secondary' ? 'secondary' : 'elementary', len: vr.length === 'long' ? 'long' : 'short', game: vr.game === true }; }
  /** md の段落と箇条（previewBodyHtml の data-para と同じ番号）: [{ cites, text }] */
  function paraList(md, known) {
    var out = [];
    mdBlocks(md).forEach(function (b) {
      (b.t === 'p' ? [b.raw] : b.t === 'ul' || b.t === 'ol' ? b.items : []).forEach(function (raw) {
        var cites = [];
        out.push({ cites: cites, text: stripCites(raw, known, cites) });
      });
    });
    return out;
  }
  /** 項目が子どもの画面のどこを指すか（場所の無い項目は null） */
  function itemTarget(it, d) {
    var parts = partsOf(d), i, j;
    if (it.kind === 'claim' && typeof it.claim_id === 'string' && it.claim_id) return { t: 'claim', claim_id: it.claim_id };
    if (it.kind === 'model3d' && typeof it.model3d_id === 'string' && it.model3d_id) {
      for (i = 0; i < parts.length; i++) if ((Array.isArray(parts[i].models3d) ? parts[i].models3d : []).some(function (x) { return isObj(x) && x.id === it.model3d_id; })) return { t: 'media', media: 'model3d', key: it.model3d_id, pi: i };
      return null;
    }
    if (typeof it.video_id === 'string' && it.video_id) {
      for (i = 0; i < parts.length; i++) if ((Array.isArray(parts[i].videos) ? parts[i].videos : []).some(function (v) { return isObj(v) && v.id === it.video_id; })) return { t: 'media', media: 'video', key: it.video_id, pi: i };
      return null;
    }
    var path = typeof it.path === 'string' ? it.path : '';
    if (!path) return null;
    if (path === 'material.json') return it.quote ? { t: 'head', q: normQ(it.quote) } : null;
    for (i = 0; i < parts.length; i++) {
      var fs = Array.isArray(parts[i].files) ? parts[i].files : [];
      for (j = 0; j < fs.length; j++) {
        if (!isObj(fs[j]) || fs[j].path !== path) continue;
        if (/\.html$/i.test(path)) return { t: 'media', media: 'app', key: path, pi: i };
        if (IMAGE_RE.test(path)) return { t: 'media', media: 'figure', key: path, pi: i };
      }
      var vs = variantsOf(parts[i]);
      for (j = 0; j < vs.length; j++) if (vs[j].path === path) return { t: 'quote', path: path, q: normQ(it.quote), pi: i, vr: vs[j] };
    }
    return null;
  }
  function framesOf(pv) { pv = pv || defaultPv(); return pv.compare ? [pv, pv.cmp] : [pv]; }
  /**
   * 項目の場所（純関数）。md = path → 本文（読めた変奏だけ）、frames = 表示中の切り替え。
   * → { label, t: 'para'|'media'|'head', pi, path, para, sel, inView, fi, media, key, q } か null。表示中の変奏に無い時の label は「中学生・長い にあります」
   */
  function locateItem(it, d, md, frames) {
    var tg = itemTarget(it, d);
    if (!tg) return null;
    if (tg.t === 'media') return { t: 'media', media: tg.media, key: tg.key, pi: tg.pi, label: MEDIA_LABEL[tg.media], inView: true, fi: 0 };
    if (tg.t === 'head') return { t: 'head', q: tg.q, label: '要約・最初にやること', inView: true, fi: 0 };
    var parts = partsOf(d), known = claimIndexOf(d), cand = [];
    if (tg.t === 'quote') cand.push({ pi: tg.pi, vr: tg.vr });
    else {
      // 主張: 表示中の変奏 → ほかの変奏（部品の順・変奏の順）
      frames.forEach(function (sel) { parts.forEach(function (p, pi) { var vr = pickVariant(p, sel); if (vr) cand.push({ pi: pi, vr: vr }); }); });
      parts.forEach(function (p, pi) { variantsOf(p).forEach(function (vr) { cand.push({ pi: pi, vr: vr }); }); });
    }
    function at(c, n) {
      var fi = frames.map(function (sel) { var vr = pickVariant(parts[c.pi], sel); return vr ? vr.path : null; }).indexOf(c.vr.path);
      var lab = variantLabel(c.vr);
      return { t: 'para', pi: c.pi, path: c.vr.path, para: n, sel: variantSel(c.vr), inView: fi >= 0, fi: fi < 0 ? 0 : fi,
        label: fi >= 0 ? lab + (n >= 0 ? ' ' + (n + 1) + ' 段落目' : '') : lab + ' にあります' };
    }
    for (var i = 0; i < cand.length; i++) {
      var text = md && vhas(md, cand[i].vr.path) ? md[cand[i].vr.path] : null;
      if (typeof text !== 'string') continue;
      var ps = paraList(text, known);
      for (var j = 0; j < ps.length; j++) {
        if (tg.t === 'claim' ? ps[j].cites.indexOf(tg.claim_id) >= 0 : !!tg.q && normQ(ps[j].text).indexOf(tg.q) >= 0) return at(cand[i], j);
      }
    }
    return tg.t === 'quote' ? at(cand[0], -1) : null;
  }
  /** 見てほしい所ごとの場所（shown の順） */
  function locateAll(d, st, md) {
    var frames = framesOf(st && st.pv);
    return triageOf(d).shown.map(function (it) { return locateItem(it, d, md, frames); });
  }
  /** 子どもの画面の印の材料（純関数）: 見てほしい所（番号・状態）と、note の主張の札 */
  function pinsOf(d, st) {
    var tri = triageOf(d), states = statesFor(st, d);
    var p = { claims: Object.create(null), quotes: [], media: [], head: [], notes: Object.create(null) };
    tri.shown.forEach(function (it, i) {
      var pin = { id: it.id, num: i + 1, state: stateIn(states, it.id) };
      var tg = itemTarget(it, d);
      if (!tg) return;
      if (tg.t === 'claim') (p.claims[tg.claim_id] = p.claims[tg.claim_id] || []).push(pin);
      else if (tg.t === 'quote' && tg.q) p.quotes.push({ path: tg.path, q: tg.q, pin: pin });
      else if (tg.t === 'media') p.media.push({ media: tg.media, key: tg.key, pin: pin });
      else if (tg.t === 'head' && tg.q) p.head.push({ q: tg.q, pin: pin });
    });
    tri.items.forEach(function (it) {
      if (it.severity === 'note' && typeof it.claim_id === 'string' && vhas(NOTE_TAG, it.cause) && !vhas(p.notes, it.claim_id)) p.notes[it.claim_id] = NOTE_TAG[it.cause];
    });
    return p;
  }
  var PIN_STATE_TEXT = { open: 'まだ決めていません', ok: 'OK にしました', redo: '直してもらう' };
  /** 番号の印（押すと右の一覧のその項目へ）。ok は緑のチェック、redo は橙の「直」 */
  function pinBtnHtml(pin) {
    return '<button type="button" class="mp-pin is-' + pin.state + '" data-pin-goto="' + esc(pin.id) + '" aria-label="見てほしい所 ' + pin.num + '（' + PIN_STATE_TEXT[pin.state] + '）">' +
      (pin.state === 'ok' ? '✓' : pin.state === 'redo' ? '直' : pin.num) + '</button>';
  }
  /** 印の付いた部品の属性と印のボタン（pins が空なら何も付けない） */
  function pinAttrs(pins) {
    if (!pins.length) return { cls: '', attr: '', btns: '' };
    var all = function (s) { return pins.every(function (x) { return x.state === s; }); };
    return {
      cls: ' has-pin' + (all('ok') ? ' pin-ok' : pins.some(function (x) { return x.state === 'redo'; }) ? ' pin-redo' : ''),
      attr: ' data-pin="' + pins.map(function (x) { return x.num; }).join(' ') + '"',
      btns: '<span class="mp-pins">' + pins.map(pinBtnHtml).join('') + '</span>'
    };
  }
  function pinsFor(list, pred) { var out = []; (list || []).forEach(function (x) { if (pred(x) && out.indexOf(x.pin) < 0) out.push(x.pin); }); return out; }

  // ---- 右の一覧: 見てほしい所（§V-9 a 2.）----
  function itBtn(attr, i, on, label) {
    return '<button type="button" class="btn small' + (on ? ' on' : '') + '" ' + attr + '="' + i + '" aria-pressed="' + (on ? 'true' : 'false') + '">' + label + '</button>';
  }
  function itemCardHtml(it, i, state, loc, isReview, cur) {
    var sev = it.severity === 'fix' ? 'fix' : 'ask', btns = [];
    if (isReview) {
      if (sev === 'ask') btns.push(itBtn('data-it-ok', i, state === 'ok', state === 'ok' ? '✓ OK にしました（戻す）' : 'OK にする'));
      else {
        if (!it.blocking) btns.push(itBtn('data-it-ok', i, state === 'ok', state === 'ok' ? '✓ このまま出す（戻す）' : 'このまま出す'));
        btns.push(itBtn('data-it-redo', i, state === 'redo', state === 'redo' ? '直してもらう（戻す）' : '直してもらう'));
      }
    }
    if (loc) btns.push('<button type="button" class="btn small rv-it-goto" data-it-goto="' + i + '">場所を見る</button>');
    var str = function (x) { return typeof x === 'string' ? x : ''; };
    return '<li class="rv-it sev-' + sev + ' is-' + state + (cur ? ' is-cur' : '') + '" id="rv-it-' + i + '" data-item-id="' + esc(it.id) + '" data-sev="' + sev + '" data-state="' + state + '" tabindex="-1">' +
      '<p class="rv-it-head"><span class="rv-it-num" aria-hidden="true">' + (state === 'ok' ? '✓' : state === 'redo' ? '直' : i + 1) + '</span>' +
        '<span class="sr-only">見てほしい所 ' + (i + 1) + '（' + PIN_STATE_TEXT[state] + '）</span><b class="rv-it-title">' + esc(it.kind === 'model3d' ? '立体モデル ' + str(it.model3d_id) + ' ' + str(it.title) : str(it.title)) + '</b></p>' +
      (loc ? '<p class="rv-it-where">' + esc(loc.label) + '</p>' : '') +
      (str(it.channel_name) ? '<p class="rv-it-ch">チャンネル「' + esc(it.channel_name) + '」</p>' : '') +
      (str(it.quote) && it.kind !== 'claim' ? '<p class="rv-it-quote">「' + esc(it.quote) + '」</p>' : '') +
      (str(it.detail) ? '<p class="rv-it-detail">' + esc(it.detail) + '</p>' : '') +
      (str(it.suggestion) ? '<p class="rv-it-sug">直し方の案: ' + esc(it.suggestion) + '</p>' : '') +
      (it.blocking && isReview ? '<p class="rv-it-blk">このまま出すことはできません</p>' : '') +
      (btns.length ? '<div class="rv-it-btns">' + btns.join('') + '</div>' : '') + '</li>';
  }
  /** gate が pending の時の文（§V-9 a 2.。pending_on で変える） */
  function pendingNoteHtml(d, tri) {
    if (tri.pending_on.indexOf('verification') >= 0) {
      return '<p class="rv-wait-t">機械の確認が終わるのを待っています</p><p class="muted rv-wait-s">検証: ' + esc(verifyState(d.version || {}, null).text) + ' ・ 読み手チェック: ' + esc(readerText(d)) + '</p>';
    }
    return '<p class="rv-wait-t">読み手チェックを待っています。待たずに公開することもできます。</p><p class="muted rv-wait-s">読み手チェック: ' + esc(readerText(d)) + '</p>';
  }
  /** #rv-items の中身（純関数）。ctx.locs = locateAll の結果（無ければ md の要らない場所だけ出す） */
  function itemsHtml(d, st, ctx) {
    ctx = ctx || {};
    var tri = triageOf(d), states = statesFor(st, d), isReview = !!d.version && d.version.status === 'review';
    var locs = ctx.locs || locateAll(d, st, null);
    var head = '<h2 class="rv-rail-h">見てほしい所（' + tri.shown.length + '）</h2>';
    if (!tri.shown.length) {
      return head + '<div id="rv-items-none" class="rv-none">' + (tri.gate === 'pending' ? pendingNoteHtml(d, tri) : '<p>見てほしい所はありません。子どもの画面を見て、よければ公開してください。</p>') + '</div>';
    }
    var cur = st && typeof st.cursor === 'number' && st.itemGen === itemGenOf(d) ? st.cursor : -1;
    return head + (tri.gate === 'pending' ? '<div class="rv-wait">' + pendingNoteHtml(d, tri) + '</div>' : '') +
      '<ol class="rv-its">' + tri.shown.map(function (it, i) { return itemCardHtml(it, i, stateIn(states, it.id), locs[i] || null, isReview, i === cur); }).join('') + '</ol>';
  }

  // ---- 右の一覧: 機械が確かめたこと（§V-9 a 2.。6 項目を 1 行ずつ。開くと補足）----
  var MK_ICON = { ok: '✓', review: '!', pending: '…' };
  var MK_STATE_TEXT = { ok: '機械が OK にしました', review: '見てほしい所があります', pending: '機械の確認を待っています' };
  /** 6 項目の状態（pending = gate が pending で、その項目の前提 §V-6 d がまだ成り立っていない） */
  function machineStates(d) {
    var tri = triageOf(d), rd = readerOf(d), mat = d.version && d.version.material;
    var report = !!(d.verification && d.verification_id) && tri.pending_on.indexOf('verification') < 0;
    var media = imageFiles(mat).length + videosOf(mat).length;
    var srcN = (Array.isArray(d.sources) ? d.sources : []).length;
    var pre = {
      content_and_evidence: report, artifact_behavior: report,
      terms_of_use: srcN > 0 && (!videosOf(mat).length || report),
      explanation_and_expression: rd.status === 'done' && (!media || report),
      relation_to_learning: rd.status === 'done', conditions_of_use: rd.status === 'done'
    };
    var out = {};
    MK_KEYS.forEach(function (k) {
      var a = tri.auto[k];
      out[k] = (tri.gate === 'pending' && !pre[k]) || !a ? 'pending' : a;
    });
    return out;
  }
  function conditionsHtml(mat) {
    var c = mat && isObj(mat.conditions) ? mat.conditions : null;
    var none = '書かれていない';
    var needs = (c && c.supporter_check === true) || partsOf({ version: { material: mat } }).some(function (p) { return p.needs_supporter_check === true; });
    var ages = strArr(c && c.age_band).map(function (a) { return AGE_LABEL[a] || a; });
    var row = function (k, v) { return '<div><dt>' + k + '</dt><dd>' + esc(v) + '</dd></div>'; };
    return '<dl class="mk-dl">' + row('道具', strArr(c && c.tools).join('、') || none) + row('場所', c && typeof c.place === 'string' && c.place ? c.place : none) +
      row('対象', ages.join('、') || none) + row('サポーターの見守り', needs ? '要' : c && c.supporter_check === false ? '不要' : none) + '</dl>';
  }
  var MK_VERDICT = { ok: ['問題なし', 'green'], problem: ['問題あり', 'red'], unclear: ['決められなかった', 'yellow'] };
  function mkVerdictHtml(x) {
    return x && isObj(x) && vhas(MK_VERDICT, x.verdict) ? pill(MK_VERDICT[x.verdict][0], MK_VERDICT[x.verdict][1]) + (typeof x.reason === 'string' && x.reason ? ' <span class="muted">' + esc(x.reason) + '</span>' : '') : '';
  }
  /** 「説明と表現」の補足の図（サムネイル・生成の情報・検証係の判定。§O-7 6・§O-12 d） */
  function figsBlockHtml(d) {
    var base = '/api/review/' + encodeURIComponent(d.version.id) + '/files/';
    var imgs = imageFiles(d.version.material);
    var gen = {};
    (Array.isArray(d.generated_images) ? d.generated_images : []).forEach(function (g) { if (g && typeof g.path === 'string') gen[g.path] = g; });
    var figs = figuresOf(d), figBy = {};
    (figs || []).forEach(function (f) { if (f && typeof f.path === 'string') figBy[f.path] = f; });
    var vids = videosOf(d.version.material), m3n = models3dOf(d.version.material).length;
    var metaBy = figuresMetaOf(d);
    return '<div class="rv-figs"><span class="muted">図・画像 ' + imgs.length + ' 枚' + (vids.length ? '・動画 ' + vids.length + ' 本' : '') + (m3n ? '・立体モデル ' + m3n + ' 件' : '') +
      (figs ? '（検証係の判定はサムネイルの下）' : '（この版の検証係は図を見ていません）') + '</span>' +
      (imgs.length ? '<div class="thumbs">' + imgs.map(function (p) {
        var a = '<a href="' + esc(base + p) + '" target="_blank" rel="noopener noreferrer" title="' + esc(p) + '"><img class="thumb" alt="' + esc(p) + '" src="' + esc(base + p) + '"></a>';
        var g = Object.prototype.hasOwnProperty.call(gen, p) ? gen[p] : null;
        var f = Object.prototype.hasOwnProperty.call(figBy, p) ? figBy[p] : null;
        var meta = Object.prototype.hasOwnProperty.call(metaBy, p) ? metaBy[p] : null;
        if (!g && !f && !meta) return a;
        return '<div class="thumb-gen"' + (g ? ' data-gen="1"' : '') + '>' + a + (g ? '<p class="thumb-cap">' + esc(genCaption(g)) + '</p>' : '') + figVerdictHtml(f) + figClaimsHtml(meta, f) + '</div>';
      }).join('') + '</div>' : '') + '</div>';
  }
  /** 「利用条件」の補足の動画のチャンネル（チャンネル名・公式の情報・本人のアップと言える理由。§Q-11 8） */
  function videoTermsHtml(vids, d, tri) {
    if (!vids.length) return '';
    var vc = videoCtxOf(d);
    return '<div class="rv-terms" data-video-terms="1">' + vids.map(function (v) {
      var isNew = tri.shown.some(function (x) { return x.cause === 'video_channel_new' && x.video_id === v.id; });
      var m = vc.meta && typeof v.id === 'string' && vhas(vc.meta, v.id) ? vc.meta[v.id] : null;
      var trusted = !!m && typeof m.author_url === 'string' && m.author_url && tri.trusted_keys.indexOf(m.author_url) >= 0;
      var mark = !tri.present ? '' : isNew ? ' ' + pill('初めてのチャンネル', 'orange') : trusted ? ' ' + pill('確認済みのチャンネル', 'green') : '';
      return '<div class="rv-term" data-video-term="' + esc(v.id) + '"><p><b>動画 ' + esc(v.id) + '</b> チャンネル ' + esc(v.channel) + mark + '</p>' +
        videoMetaHtml(v, vc) + '<p>本人のアップと言える理由: ' + esc(v.rights_note) + '</p></div>';
    }).join('') + '</div>';
  }
  /**
   * §AJ-4・§AK-5: 「利用条件」の補足の立体モデル（題名・提供元と「ライセンス: <label>（<license_url>）。出典の書き方: <attribution>。根拠: <根拠>」。
   * 一覧に無い id は出さない。権利の確認で止まっている版（rights_blocked）は理由の文だけ）
   */
  function models3dTermsHtml(d) {
    var meta = models3dMetaOf(d);
    return models3dOf(d && d.version && d.version.material).map(function (x) {
      var id = typeof x.id === 'string' ? x.id : '', m = model3dMetaFor(meta, id);
      if (!m) return '';
      var head = '<div class="rv-term" data-model3d-term="' + esc(id) + '"><p><b>立体モデル ' + esc(id) + '</b> ' + esc(m.title) + '（' + esc(m.org) + '）</p>';
      if (m.rights_blocked === true) return head + '<p class="err" data-rights-blocked="1">' + esc(model3dBlockedText(m)) + '</p></div>';
      var link = model3dPageLink(m);
      return head + '<p>' + model3dRightsLineHtml(m) + '</p>' + (link ? '<p>' + link + '</p>' : '') + '</div>';
    }).join('');
  }
  /** #rv-machine の中身（純関数） */
  function machineHtml(d) {
    var tri = triageOf(d), rd = readerOf(d), sts = machineStates(d), mat = (d.version && d.version.material) || {};
    var claims = Array.isArray(d.claims) ? d.claims.filter(isObj) : [];
    var hasReport = !!(d.verification && d.verification_id);
    var cnt = function (pred) { return claims.filter(pred).length; };
    var figs = figuresOf(d) || [], imgs = imageFiles(mat), vids = videosOf(mat);
    var vver = d.verification && Array.isArray(d.verification.videos) ? d.verification.videos : [];
    var apps = d.verification && Array.isArray(d.verification.apps) ? d.verification.apps.filter(isObj) : null;
    var appPaths = [];
    partsOf(d).forEach(function (p) { (Array.isArray(p.files) ? p.files : []).forEach(function (f) { if (isObj(f) && typeof f.path === 'string' && /\.html$/i.test(f.path)) appPaths.push({ path: f.path, title: p.title }); }); });
    var okN = function (arr) { return arr.filter(function (x) { return isObj(x) && x.verdict === 'ok'; }).length; };
    var fixN = rd.findings.filter(function (f) { return f.severity === 'fix'; }).length, noteN = rd.findings.filter(function (f) { return f.severity === 'note'; }).length;
    var srcs = Array.isArray(d.sources) ? d.sources : [];
    var licUnknown = srcs.filter(function (s) { return !s || s.license === 'unknown'; }).length;
    var anyNew = tri.shown.some(function (x) { return x.cause === 'video_channel_new'; });
    var sum = {}, more = {};
    sum.content_and_evidence = ['主張 ' + claims.length + ' 件: ' + (hasReport ? '確か ' + cnt(function (c) { return c.verdict === 'confirmed'; }) + '・仮説として書いてある ' + cnt(function (c) { return c.verdict === 'hypothesis' && c.presented_as === 'hedged'; }) + '・たとえ ' + cnt(function (c) { return c.verdict === 'hypothesis' && c.presented_as === 'analogy'; }) : '検証を待っています')];
    more.content_and_evidence = '<p><button type="button" class="linkish rv-open-src" data-open-sources="1">根拠と出典を開く →</button></p>';
    sum.explanation_and_expression = ['読み手チェック: ' + (rd.status === 'done' ? '直す所 ' + fixN + '・気づき ' + noteN : readerText(d))];
    if (imgs.length) sum.explanation_and_expression.push('図 ' + imgs.length + ' 枚: 問題なし ' + okN(figs));
    if (vids.length) sum.explanation_and_expression.push('動画 ' + vids.length + ' 本: 問題なし ' + okN(vver));
    var notes = rd.findings.filter(function (f) { return f.severity === 'note'; });
    more.explanation_and_expression = figsBlockHtml(d) +
      (rd.status === 'done' ? '<div class="mk-reader" data-reader-notes="' + notes.length + '"><p class="mk-sub">読み手チェックの気づき</p>' +
        (notes.length ? '<ul>' + notes.map(function (f) { return '<li>' + (typeof f.quote === 'string' && f.quote ? '「' + esc(f.quote) + '」 ' : '') + esc(f.note) + (typeof f.suggestion === 'string' && f.suggestion ? '<br><span class="muted">直し方の案: ' + esc(f.suggestion) + '</span>' : '') + '</li>'; }).join('') + '</ul>' : '<p class="muted">気づきはありません</p>') +
        (rd.summary ? '<p class="mk-summary">' + esc(rd.summary) + '</p>' : '') + '</div>' : '') +
      analogyGapsHtml(d) + videosHtml(vids, d);
    sum.relation_to_learning = [rd.learning && typeof rd.learning.reason === 'string' && rd.learning.reason ? rd.learning.reason : '読み手チェック: ' + readerText(d)];
    more.relation_to_learning = rd.learning ? '<p>' + mkVerdictHtml(rd.learning) + '</p>' : '';
    sum.conditions_of_use = [rd.conditions && typeof rd.conditions.reason === 'string' && rd.conditions.reason ? rd.conditions.reason : '読み手チェック: ' + readerText(d)];
    more.conditions_of_use = conditionsHtml(mat) + (rd.conditions ? '<p>' + mkVerdictHtml(rd.conditions) + '</p>' : '');
    sum.artifact_behavior = [appPaths.length ? '動かせるもの ' + appPaths.length + ' 個: ' + (apps ? '問題なし ' + okN(apps) : '検証係はまだ見ていません') : '動かせるものはありません'];
    more.artifact_behavior = appPaths.length ? '<ul class="mk-apps">' + appPaths.map(function (a) {
      var x = (apps || []).filter(function (y) { return y.path === a.path; })[0];
      return '<li data-app-verdict="' + esc(x && typeof x.verdict === 'string' ? x.verdict : 'none') + '"><b>' + esc(a.title || '動かせるもの') + '</b> ' + (x ? mkVerdictHtml(x) : '<span class="muted">判定がありません</span>') + '</li>';
    }).join('') + '</ul>' : '';
    sum.terms_of_use = ['出典 ' + srcs.length + ' 件' + (vids.length && tri.present && (anyNew || tri.trusted_keys.length) ? '・動画のチャンネル: ' + (anyNew ? '初めて' : '確認済み') : '')];
    more.terms_of_use = (licUnknown ? '<p class="muted">利用条件が分からない出典があります（' + licUnknown + ' 件）</p>' : '') + videoTermsHtml(vids, d, tri) + models3dTermsHtml(d);
    var reread = rd.status === 'failed' && d.version && d.version.status === 'review'
      ? '<p class="mk-reread"><button type="button" class="btn small" id="rv-reread">読み手チェックをやり直す</button></p>' : '';
    return '<h2 class="rv-rail-h">機械が確かめたこと</h2>' + reread + MK_KEYS.map(function (k) {
      var s = sts[k];
      return '<details class="mk-row is-' + s + '" data-mk="' + k + '" data-mk-state="' + s + '"><summary><span class="mk-ic" aria-hidden="true">' + MK_ICON[s] + '</span>' +
        '<span class="mk-name">' + esc(CK_LABEL[k]) + '</span><span class="sr-only">（' + MK_STATE_TEXT[s] + '）</span>' +
        '<span class="mk-sum">' + sum[k].map(function (x) { return '<span>' + esc(x) + '</span>'; }).join('') + '</span></summary>' +
        (more[k] ? '<div class="mk-more">' + more[k] + '</div>' : '') + '</details>';
    }).join('');
  }

  // ---- 教材プレビュー（「教材として見る」。子どもが見る形 = app-v3 の見た目を .mat-preview に閉じ込めて出す）----
  // 型の名前（docs/content-factory-design.md §5）と最初にやることの種類（§E-1 entry_point.type）
  var KIND_NAME = { 1: '活動レシピ', 2: '作例と見本', 3: '説明と図解', 4: '動かせるもの', 5: '見る', 6: '今日のお題', 7: '基礎学習の足場', 8: '世界との接続' };
  var ENTRY_LABEL = { look: '見る', touch: 'さわる', 'try': 'ためす', make: 'つくる' };
  var AUD_LABEL = { elementary: '小学生', secondary: '中学生' };
  var LEN_LABEL = { 'short': '短い', 'long': '長い' };
  function kindName(k) { return vhas(KIND_NAME, k) ? KIND_NAME[k] : '型 ' + String(k === undefined || k === null ? '?' : k); }
  // 確認の印（要確認の段落の黄色・段落末の主張 → 出典の印・付箋のボタン）の ON / OFF。既定 ON。ブラウザに覚える（読めない・書けない時は既定のまま）
  var MARKS_KEY = 'factory.review.marks';
  function loadMarks() { try { return window.localStorage.getItem(MARKS_KEY) !== '0'; } catch (e) { return true; } }
  function saveMarks(on) { try { window.localStorage.setItem(MARKS_KEY, on ? '1' : '0'); } catch (e) { /* 覚えられなくても表示は切り替わる */ } }
  function marksToggleHtml(on) {
    return '<button type="button" class="mp-marks' + (on ? ' on' : '') + '" data-mp-marks="1" aria-pressed="' + (on ? 'true' : 'false') + '" title="OFF にすると子どもが見るのと同じ見た目になります">' +
      '<span class="mp-marks-box" aria-hidden="true">' + (on ? '✓' : '') + '</span>印を見る<span class="mp-marks-state">' + (on ? 'ON' : 'OFF') + '</span></button>';
  }
  /** 既定は「小学生・短い」1 枠。見比べの右の枠は「中学生・短い」から */
  function defaultPv() { return { aud: 'elementary', len: 'short', game: false, compare: false, cmp: { aud: 'secondary', len: 'short', game: false } }; }
  function pvLabel(sel) { return sel.game ? 'ゲーム版' : (AUD_LABEL[sel.aud] || sel.aud) + '・' + (LEN_LABEL[sel.len] || sel.len); }
  function variantLabel(vr) { return vr.game ? 'ゲーム版' : (AUD_LABEL[vr.audience] || String(vr.audience)) + '・' + (LEN_LABEL[vr.length] || String(vr.length)); }
  /** 表示する変奏（無ければ null）。ゲーム版は同じ学年のものを先に */
  function pickVariant(part, sel) {
    var vars = (part && Array.isArray(part.variants) ? part.variants : []).filter(function (v) { return v && typeof v === 'object' && typeof v.path === 'string'; });
    if (sel.game) {
      var games = vars.filter(function (v) { return v.game === true; });
      return games.filter(function (v) { return v.audience === sel.aud; })[0] || games[0] || null;
    }
    return vars.filter(function (v) { return v.game !== true && v.audience === sel.aud && v.length === sel.len; })[0] || null;
  }
  /** md を塊に分ける（教材の記法 v1 §V-5: 見出し・段落・箇条書き・番号つき・コード）。番号つきは { t: 'ol', start } */
  function mdBlocks(src) {
    var lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
    var out = [], para = [], list = null, code = null;
    function flushPara() { if (para.length) { out.push({ t: 'p', raw: para.join(' ') }); para = []; } }
    function flushList() { if (list) { out.push(list); list = null; } }
    function item(t, text, n) {
      flushPara();
      if (list && list.t !== t) flushList();
      if (!list) list = t === 'ol' ? { t: 'ol', start: n, items: [] } : { t: 'ul', items: [] };
      list.items.push(text);
    }
    lines.forEach(function (line) {
      if (code !== null) {
        if (/^```/.test(line)) { out.push({ t: 'pre', text: code.join('\n') }); code = null; } else code.push(line);
        return;
      }
      if (/^```/.test(line)) { flushPara(); flushList(); code = []; return; }
      var h = /^(#{1,4})\s+(.*)$/.exec(line);
      if (h) { flushPara(); flushList(); out.push({ t: 'h', level: Math.min(h[1].length + 1, 4), raw: h[2] }); return; }
      var li = /^\s*[-*]\s+(.*)$/.exec(line);
      if (li) { item('ul', li[1]); return; }
      var ol = /^\s*(\d{1,9})\.\s+(.*)$/.exec(line);
      if (ol) { item('ol', ol[2], Number(ol[1])); return; }
      if (!line.trim()) { flushPara(); flushList(); return; }
      flushList(); para.push(line.trim());
    });
    if (code !== null) out.push({ t: 'pre', text: code.join('\n') });
    flushPara(); flushList();
    return out;
  }
  /** 段落の先頭 20 字（付箋の場所の目印。主張 id の参照と md の記号を除く） */
  function paraHead(raw, known) {
    var t = stripCites(raw, known, []).replace(/`/g, '').replace(/\*\*/g, '').replace(/\[([^\]]+)\]\((?:[^)]*)\)/g, '$1').replace(/\s+/g, ' ').trim();
    var cps = Array.from(t);
    return cps.length > 20 ? cps.slice(0, 20).join('') + '…' : t;
  }
  /** 動画の埋め込み（§Q-5 の形。youtube_id と区間を確かめてから。だめなら空） */
  function ytEmbedHtml(v) {
    var s = v.start_sec, e = v.end_sec;
    if (!(typeof v.youtube_id === 'string' && YT_ID_RE.test(v.youtube_id) && isSec(s) && isSec(e) && s < e)) return '';
    return '<iframe src="' + esc('https://www.youtube-nocookie.com/embed/' + v.youtube_id + '?start=' + s + '&end=' + e + '&rel=0') + '" title="' + esc(v.title) +
      '" allow="encrypted-media; picture-in-picture; fullscreen" referrerpolicy="strict-origin-when-cross-origin" loading="lazy"></iframe>';
  }
  // §AJ-4: 立体モデルの公式の埋め込みの url の形（表示の直前にもう一度確かめる。material.json の値は src にしない）
  var SKETCHFAB_EMBED_RE = /^https:\/\/sketchfab\.com\/models\/[0-9a-f]{32}\/embed$/;
  var VOYAGER_EMBED_RE = /^https:\/\/3d-api\.si\.edu\/voyager\/3d_package:[0-9a-f-]{36}$/;
  /** 立体モデルの埋め込み（m = models3d_meta の 1 件。embed_url の形が合わなければ空） */
  function model3dEmbedHtml(m) {
    var u = m && typeof m.embed_url === 'string' ? m.embed_url : '';
    if (!(SKETCHFAB_EMBED_RE.test(u) || VOYAGER_EMBED_RE.test(u))) return '';
    return '<iframe src="' + esc(u) + '" title="' + esc(m.title) + '" allow="fullscreen; xr-spatial-tracking" referrerpolicy="strict-origin-when-cross-origin" loading="lazy"></iframe>';
  }
  /** 立体モデルの「提供元で開く」（page_url が https:// で始まる時だけリンク） */
  function model3dPageLink(m) {
    var u = m && typeof m.page_url === 'string' ? m.page_url : '';
    return /^https:\/\//.test(u) ? '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">提供元で開く</a>' : '';
  }
  // §AJ2-3: 取り込んだ GLB の配信の url（相対）の形（src/models3d-file.ts の MODEL3D_FILE_URL_RE と同じ）
  var MODEL3D_FILE_URL_RE = /^\/api\/library\/models3d\/files\/[a-z0-9-]{3,40}\/[0-9a-f]{64}\.glb$/;
  /** §AJ2-3: 取り込んだ立体モデル（kind download）の自前の表示。file_url の形が合わなければ「まだ取り込まれていません」。src は models3d_meta の値だけ */
  function model3dViewerHtml(m, id) {
    var u = m && typeof m.file_url === 'string' ? m.file_url : '';
    if (!MODEL3D_FILE_URL_RE.test(u)) return '<p class="mp-missing">立体モデル ' + esc(id) + ' はまだ取り込まれていません（<a href="#/models3d">立体モデル</a> のページで「権利を確かめる」と取り込みます）</p>';
    return '<model-viewer src="' + esc(u) + '" alt="' + esc(m.title) + '" camera-controls touch-action="pan-y" loading="eager"></model-viewer>';
  }
  /** §AK-5: 「ライセンス: <label>（<license_url>）。出典の書き方: <attribution>。根拠: <根拠の日本語>」（値はエスケープ済みの HTML） */
  function model3dRightsLineHtml(m) {
    var url = m && typeof m.license_url === 'string' ? m.license_url : '';
    return 'ライセンス: ' + esc(m.license) + (url ? '（' + esc(url) + '）' : '') + '。出典の書き方: ' + esc(m.attribution) + '。根拠: ' + esc(rightsKindText(m.rights_kind));
  }
  /** §AK-4 4: 門番で止まった版の文（理由は rights_reason の日本語） */
  function model3dBlockedText(m) { return '権利の確認で止まっています（' + rightsReasonText(m && m.rights_reason) + '）'; }
  /**
   * §AJ-4: 子どもの画面の立体モデル 1 件（x = material の models3d の 1 件、meta = models3d_meta。値はすべてエスケープ）。
   * §AK-4 4: rights_blocked の版は <iframe> も <model-viewer> も出さず理由の文だけ
   */
  function model3dPreviewHtml(x, meta, pa) {
    var id = typeof x.id === 'string' ? x.id : '';
    var m = model3dMetaFor(meta, id);
    var body;
    if (!m) body = '<p class="mp-missing">立体モデル ' + esc(id) + ' は一覧に無いため、埋め込みません</p>';
    else if (m.rights_blocked === true) body = '<p class="mp-missing" data-rights-blocked="1">立体モデル ' + esc(id) + ' は出しません。' + esc(model3dBlockedText(m)) + '</p>';
    else {
      body = (m.kind === 'download' ? model3dViewerHtml(m, id) : (model3dEmbedHtml(m) || '<p class="mp-missing">立体モデルの埋め込みの形が正しくないため、埋め込みません</p>')) +
        '<p class="mp-model3d-cap">' + esc(m.title) + '（' + esc(m.org) + '）' + model3dRightsLineHtml(m) + model3dPageLink(m) + '</p>';
    }
    return '<div class="mp-model3d' + pa.cls + '" data-media="model3d" data-media-key="' + esc(id) + '"' + pa.attr + '>' + pa.btns + body +
      (typeof x.why === 'string' && x.why ? '<p class="mp-model3d-why"><span class="mp-k">見方</span>' + esc(x.why) + '</p>' : '') + '</div>';
  }
  /**
   * 本文の中に置く図・動かせるもの・動画（図と動画は先頭の段落の直後、型 4 の app は本文の上）。
   * 動かせるものの上に子どもに見える見出し「さわってみよう」（§V-9 b）。o.marks と o.pins があれば、見てほしい所の部品に番号の印
   */
  function previewMedia(part, fileBase, o) {
    o = o || {};
    var figs = [], apps = [], others = [];
    var pinOf = function (media, key) { return pinAttrs(o.marks && o.pins ? pinsFor(o.pins.media, function (x) { return x.media === media && x.key === key; }) : []); };
    // 図・動かせるものの付箋の数（§L-9。印 OFF は札も出さない。付箋そのものは消さない）
    var stuckOf = function (media, key) {
      return o.marks ? (o.stickies || []).filter(function (s) { return s.target === 'media' && s.media === media && s.media_key === key; }).length : 0;
    };
    var stickTools = function (media, key, label) {
      var k = stuckOf(media, key);
      return (k ? '<span class="mp-stuck" title="' + (media === 'app' ? 'この動かせるものの付箋' : media === 'video' ? 'この動画の付箋' : 'この図の付箋') + '">付箋 ' + k + '</span>' : '') +
        (o.marks && o.stick ? '<button type="button" class="mp-stick-btn" data-stick-media="' + media + '" data-stick-key="' + esc(key) + '">' + label + '</button>' : '');
    };
    (Array.isArray(part.files) ? part.files : []).forEach(function (f) {
      if (!f || typeof f.path !== 'string') return;
      var src = esc(fileBase + f.path);
      var pa, tools;
      if (IMAGE_RE.test(f.path)) {
        pa = pinOf('figure', f.path);
        tools = stickTools('figure', f.path, 'この図に付箋');
        figs.push('<figure class="mp-fig' + pa.cls + (stuckOf('figure', f.path) ? ' has-stick' : '') + '" data-media="figure" data-media-key="' + esc(f.path) + '"' + pa.attr + '><img alt="' + esc(typeof f.alt === 'string' && f.alt ? f.alt : '図') + '" src="' + src + '">' + pa.btns +
          (tools ? '<figcaption class="mp-fig-tools">' + tools + '</figcaption>' : '') + '</figure>');
      } else if (/\.html$/i.test(f.path)) {
        pa = pinOf('app', f.path);
        tools = stickTools('app', f.path, 'これに付箋');
        var appMain = '<p class="mp-app-cap">さわってみよう</p>' + pa.btns + '<iframe class="mp-app-frame" sandbox="allow-scripts" title="動かせるもの" src="' + src + '"></iframe>';
        // 付箋の札とボタンは「さわってみよう」の行の右（CSS で右上に置く）。入力の枠は DOM 側が iframe の上に入れる
        apps.push('<div class="mp-app' + pa.cls + (stuckOf('app', f.path) ? ' has-stick' : '') + '" data-media="app" data-media-key="' + esc(f.path) + '"' + pa.attr + '>' +
          (tools ? '<span class="mp-app-tools">' + tools + '</span><div class="mp-app-main">' + appMain + '</div>' : appMain) + '</div>');
      } else others.push('<p class="mp-file"><a href="' + src + '" target="_blank" rel="noopener noreferrer">' + esc(f.path) + '</a></p>');
    });
    var vids = (Array.isArray(part.videos) ? part.videos : []).map(function (v) {
      v = v && typeof v === 'object' ? v : {};
      var emb = ytEmbedHtml(v);
      var pa = pinOf('video', v.id);
      // 動画の付箋（§L-9 追記）: 鍵は material.json の videos[].id（同じ YouTube 動画の別区間を区別する）。id が無い動画にはボタンを出さない。ボタンは .mp-video の先頭
      var yk = typeof v.id === 'string' && v.id ? v.id : '';
      var vt = yk ? stickTools('video', yk, 'この動画に付箋') : '';
      return '<div class="mp-video' + pa.cls + (stuckOf('video', yk) ? ' has-stick' : '') + '" data-media="video" data-media-key="' + esc(v.id) + '"' + pa.attr + '>' +
        (vt ? '<span class="mp-video-tools">' + vt + '</span>' : '') + pa.btns + (emb || '<p class="mp-missing">動画の id か区間の形が正しくないため、埋め込みません</p>') +
        (v.why ? '<p class="mp-video-why"><span class="mp-k">見どころ</span>' + esc(v.why) + '</p>' : '') + '</div>';
    });
    // §AJ-4: 動画の直後に立体モデル（埋め込みの url は o.models3dMeta = review API の models3d_meta から。付箋は付けない = 段落の付箋で代用）
    var m3s = (Array.isArray(part.models3d) ? part.models3d : []).map(function (x) {
      x = x && typeof x === 'object' ? x : {};
      return model3dPreviewHtml(x, o.models3dMeta || null, pinOf('model3d', x.id));
    });
    var top = part.kind === 4 ? apps : [];
    var after = figs.concat(part.kind === 4 ? [] : apps, vids, m3s);
    return { top: top.join(''), after: after.join(''), end: others.join('') };
  }
  /**
   * 1 つの変奏の本文（純関数）。o: { fileBase, marks, stick, pins, path, claimIdx, frame, pi, stickies }
   * - [cN] は出さない（inlineMd の中で外す）。**…** は太字・1. は番号つきの一覧（§V-5 教材の記法 v1）
   * - marks の時だけ: 見てほしい所の段落に番号の印と薄い色、note の主張の段落に点線と札、「ここに付箋」。OFF は子どもが見るのと同じ見た目
   * - 段落と箇条には data-para（0 始まり）・data-head（先頭 20 字）・data-cl（主張の番号）を付ける
   */
  function previewBodyHtml(md, part, o) {
    o = o || {};
    var known = o.claimIdx || {}, pins = o.marks && o.pins ? o.pins : null;
    var stuck = {};
    (o.stickies || []).forEach(function (s) { if (s.target !== 'media') stuck[s.para_index] = (stuck[s.para_index] || 0) + 1; });
    var media = previewMedia(part || {}, o.fileBase || '', o);
    var idx = 0;
    function para(tag, raw) {
      var i = idx++, cites = [];
      var inner = inlineMd(raw, { cites: cites, known: known, bold: true });
      var cl = cites.filter(function (id) { return vhas(known, id); }).map(function (id) { return known[id]; });
      var showStuck = !!o.marks && !!stuck[i]; // 印 OFF は子どもが見るのと同じ見た目（付箋そのものは消さない）
      var mine = [], tag2 = '';
      if (pins) {
        cites.forEach(function (id) { (vhas(pins.claims, id) ? pins.claims[id] : []).forEach(function (p) { if (mine.indexOf(p) < 0) mine.push(p); }); });
        var plain = normQ(stripCites(raw, known, []));
        pins.quotes.forEach(function (q) { if (q.path === o.path && plain.indexOf(q.q) >= 0 && mine.indexOf(q.pin) < 0) mine.push(q.pin); });
        for (var c = 0; c < cites.length && !tag2; c++) if (vhas(pins.notes, cites[c])) tag2 = pins.notes[cites[c]];
      }
      var pa = pinAttrs(mine);
      var cls = 'mp-para' + pa.cls + (tag2 ? ' is-note' : '') + (showStuck ? ' has-stick' : '');
      var tail = '';
      if (tag2) tail += '<span class="mp-note-tag">' + esc(tag2) + '</span>';
      if (showStuck) tail += '<span class="mp-stuck" title="この段落の付箋">付箋 ' + stuck[i] + '</span>';
      if (o.marks && o.stick) tail += '<button type="button" class="mp-stick-btn" data-stick-open="' + i + '">ここに付箋</button>';
      return '<' + tag + ' class="' + cls + '" id="mp-p-' + (o.frame || 0) + '-' + (o.pi || 0) + '-' + i + '" data-para="' + i + '" data-head="' + esc(paraHead(raw, known)) + '"' +
        (cl.length ? ' data-cl="' + cl.join(' ') + '"' : '') + pa.attr + '>' + pa.btns + inner + tail + '</' + tag + '>';
    }
    var blocks = mdBlocks(md);
    var firstP = -1;
    blocks.forEach(function (b, i) { if (firstP < 0 && b.t === 'p') firstP = i; });
    var at = firstP >= 0 ? firstP : (blocks.length ? 0 : -1);
    var html = blocks.map(function (b, i) {
      var h;
      if (b.t === 'h') h = '<h' + b.level + ' class="mp-h">' + inlineMd(b.raw, { cites: [], known: known, bold: true }) + '</h' + b.level + '>';
      else if (b.t === 'pre') h = '<pre class="mp-pre"><code>' + esc(b.text) + '</code></pre>';
      else if (b.t === 'ul') h = '<ul class="mp-ul">' + b.items.map(function (x) { return para('li', x); }).join('') + '</ul>';
      else if (b.t === 'ol') h = '<ol class="mp-ol"' + (b.start !== 1 ? ' start="' + b.start + '"' : '') + '>' + b.items.map(function (x) { return para('li', x); }).join('') + '</ol>';
      else h = para('p', b.raw);
      return i === at ? h + media.after : h;
    }).join('');
    if (at < 0) html = media.after;
    return '<div class="mp-md">' + media.top + html + media.end + '</div>';
  }
  /** 切り替えの 1 組（学年・長さ・ゲーム版）。fi = 枠の番号（0 = 左 / 1 = 見比べの右） */
  function pvSwitchHtml(sel, fi) {
    var b = function (key, val, label, on) {
      return '<button type="button" class="mp-tg' + (on ? ' on' : '') + '" data-pv="' + key + '" data-val="' + val + '" data-pvf="' + fi + '" aria-pressed="' + (on ? 'true' : 'false') + '">' + label + '</button>';
    };
    return '<span class="mp-seg' + (sel.game ? ' is-off' : '') + '" role="group" aria-label="学年">' + b('aud', 'elementary', '小学生', !sel.game && sel.aud === 'elementary') + b('aud', 'secondary', '中学生', !sel.game && sel.aud === 'secondary') + '</span>' +
      '<span class="mp-seg' + (sel.game ? ' is-off' : '') + '" role="group" aria-label="長さ">' + b('len', 'short', '短い', !sel.game && sel.len === 'short') + b('len', 'long', '長い', !sel.game && sel.len === 'long') + '</span>' +
      '<span class="mp-seg" role="group" aria-label="ゲーム版">' + b('game', '1', 'ゲーム版', !!sel.game) + '</span>' +
      (fi === 0 ? '<span class="mp-seg" role="group" aria-label="見比べ">' + b('compare', '1', '見比べ', !!sel.compare) + '</span>' : '');
  }
  // ---- 付箋（段落に「ここに付箋」→ 分類 + 一言。差し戻す時に理由欄へ箇条書きで流し込む。API・DB は変えない）----
  var STICK_KINDS = [['hard', '言葉が難しい'], ['long', '長い'], ['figure', '図と合わない'], ['fact', '事実が心配'], ['other', 'その他']];
  var STICK_LABEL = {};
  STICK_KINDS.forEach(function (k) { STICK_LABEL[k[0]] = k[1]; });
  // 図・動かせるものの付箋（§L-9）。記録は同じ stickies の配列に target: 'media' で入る
  var STICK_FIG_KINDS = [['3d', '立体の絵にする'], ['redraw', '描き直す'], ['mismatch', '本文と合わない'], ['text', '文字が読めない・崩れている'], ['fact', '事実が心配'], ['other', 'その他']];
  var STICK_APP_KINDS = [['depth', '動きに奥行きがない'], ['pointless', '操作の意味がない'], ['controls', '操作が分かりにくい'], ['mismatch', '本文と合わない'], ['broken', '動かない・おかしい'], ['other', 'その他']];
  var STICK_VIDEO_KINDS = [['span', '区間が合わない'], ['content', '内容が合わない・別の動画に'], ['remove', '要らない'], ['fact', '事実が心配'], ['other', 'その他']];
  var STICK_FIG_LABEL = {}, STICK_APP_LABEL = {}, STICK_VIDEO_LABEL = {};
  STICK_VIDEO_KINDS.forEach(function (k) { STICK_VIDEO_LABEL[k[0]] = k[1]; });
  STICK_FIG_KINDS.forEach(function (k) { STICK_FIG_LABEL[k[0]] = k[1]; });
  STICK_APP_KINDS.forEach(function (k) { STICK_APP_LABEL[k[0]] = k[1]; });
  /** 種類が 3d / depth の時だけ理由の行に付く固定の文（職人への指示） */
  var STICK_MEDIA_EXTRA = {
    figure: { '3d': '（generate_image で、光と影・質感のある実物らしい立体の画像に描き直す。平たい SVG のままにしない。名前の引き出し線や説明は画像に入れず本文か別の SVG で）' },
    app: {
      depth: '（app.html の canvas に奥行きのある動く絵にする。遠くは小さく暗く、近くは大きく明るく）',
      pointless: '（操作は「さわると何が分かるか」を 1 文で言えるものだけにする。速さや数を変えるだけの操作は外し、本文の学びに結びつく操作に置き換える）'
    },
    video: {}
  };
  function stickyKindLabel(s) {
    var L = s.target === 'media' ? (s.media === 'app' ? STICK_APP_LABEL : s.media === 'video' ? STICK_VIDEO_LABEL : STICK_FIG_LABEL) : STICK_LABEL;
    return Object.prototype.hasOwnProperty.call(L, s.kind) ? L[s.kind] : 'その他';
  }
  var NOTE_MAX = 4000; // 差し戻しの理由の上限（routes/review.ts の note）
  /** 付箋 1 件 → 理由の 1 行（例: "- parts/p1/p1-elementary-short.md 3 段落目「赤血球は…」: 言葉が難しい — 一言"） */
  function stickyLine(s) {
    if (s.target === 'media') {
      var mk = s.media === 'app' || s.media === 'video' ? s.media : 'figure', ex = STICK_MEDIA_EXTRA[mk];
      var name = mk === 'app' ? '動かせるもの' : mk === 'video' ? '動画' : '図';
      var one = function (x) { return String(x == null ? '' : x).replace(/\s+/g, ' ').trim(); }; // 行の中に改行を入れない（却下時の除外は行単位）
      var vt = mk === 'video' && one(s.media_title) ? '（' + one(s.media_title) + '）' : '';
      return '- ' + name + ' ' + one(s.part_id) + ' ' + one(s.media_key) + vt + ': ' + stickyKindLabel(s) +
        (Object.prototype.hasOwnProperty.call(ex, s.kind) ? ex[s.kind] : '') + (one(s.text) ? ' — ' + one(s.text) : '');
    }
    return '- ' + s.variant_path + ' ' + (Number(s.para_index) + 1) + ' 段落目「' + s.head + '」: ' + (STICK_LABEL[s.kind] || 'その他') + (s.text ? ' — ' + s.text : '');
  }
  /**
   * 理由の文に付箋の行を足す（書いてある理由は 1 字も変えず、その後ろに。区切りの改行だけ足す。上限を超える行は足さない）
   * → { note, added, lines }（lines = 足した行。却下の時に外すため）。1 件も足せなければ note は元のまま
   */
  function stickyNoteText(note, stickies) { return appendLines(note, stickies.map(stickyLine)); }
  /** 理由の文に行を足す（書いてある理由は 1 字も変えず、その後ろに。区切りの改行だけ足す。上限を超える行は足さない）→ { note, added, lines } */
  function appendLines(note, list) {
    var base = String(note || ''), out = base, added = 0, lines = [];
    for (var i = 0; i < list.length; i++) {
      var line = list[i];
      var next = out + (out && out.charAt(out.length - 1) !== '\n' ? '\n' : '') + line;
      if (next.length > NOTE_MAX) break;
      out = next; added++; lines.push(line);
    }
    return { note: added ? out : base, added: added, lines: lines };
  }
  /** 却下で送る理由: 流し込んだ付箋の行（lines）を 1 行ずつ外す（理由欄の表示は変えない） */
  function noteWithoutStickyLines(note, lines) {
    var left = (lines || []).slice();
    return String(note || '').split('\n').filter(function (l) {
      var k = left.indexOf(l);
      if (k < 0) return true;
      left.splice(k, 1);
      return false;
    }).join('\n');
  }
  /** decision に送る理由（却下だけ、流し込んだ付箋の行を外す） */
  function decisionNote(st, decision) {
    return decision === 'reject' ? noteWithoutStickyLines(st.note, st.flowedLines) : String(st.note || '');
  }
  /** 主張（番号 n）の段落を探す順: 左の枠 → 見比べの時は右の枠 */
  function claimParaSelectors(n, compare) {
    var sel = '[data-cl~="' + String(n).replace(/[^0-9]/g, '') + '"]';
    return ['.mat-preview[data-frame="0"] ' + sel].concat(compare ? ['.mat-preview[data-frame="1"] ' + sel] : []);
  }
  /** 確認画面のキー操作を止める「入力中」: 入力欄・選択・編集できる要素、または付箋の入力の枠の中（種類ボタン・付ける/やめるを含む） */
  function inInputOf(a) {
    if (!a) return false;
    if (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable) return true;
    return !!(a.closest && a.closest('[data-stick-form]'));
  }
  /** 付箋の一言欄のキー → 'add' / 'need_kind' / 'cancel' / null（IME の変換中 = isComposing か keyCode 229 の Enter は付けない） */
  function stickyKeyAction(e, hasKind) {
    if (!e || e.isComposing || e.keyCode === 229) return null;
    if (e.key === 'Enter') return hasKind ? 'add' : 'need_kind';
    if (e.key === 'Escape') return 'cancel';
    return null;
  }
  function stickyListHtml(stickies) {
    if (!stickies.length) return '<p class="mp-stick-empty">付箋はまだありません。「印を見る」を ON にして、段落の「ここに付箋」や、図・動かせるもの・動画のボタンから付けられます。</p>';
    var pending = stickies.filter(function (s) { return !s.flowed; }).length;
    return '<div class="mp-stick-head"><b>付箋 ' + stickies.length + ' 件</b><span class="muted">' + (pending ? '「直してもらう」を押すと、まだ入れていない ' + pending + ' 件を理由欄に箇条書きで足します（書いてある理由は消しません）' : 'すべて理由欄に入れました') + '</span></div>' +
      '<ul class="mp-stick-list">' + stickies.map(function (s) {
        var where = s.target === 'media' ? (s.media === 'app' ? '動かせるもの ' + esc(s.media_key) : s.media === 'video' ? '動画 ' + (s.media_title ? esc(s.media_title) + '（' + esc(s.media_key) + '）' : esc(s.media_key)) : '図 ' + esc(s.media_key)) : esc(s.variant_label) + ' ' + (Number(s.para_index) + 1) + ' 段落目「' + esc(s.head) + '」';
        return '<li class="mp-stick-item" data-stick-item="' + s.id + '"><span class="mp-stick-kind">' + esc(stickyKindLabel(s)) + '</span>' +
          '<span class="mp-stick-where">' + esc(s.part_title || s.part_id) + '・' + where + '</span>' +
          (s.text ? '<span class="mp-stick-text">' + esc(s.text) + '</span>' : '') +
          (s.flowed ? '<span class="pill green">理由欄に入れました</span>' : '') +
          '<button type="button" class="btn small" data-stick-del="' + s.id + '">消す</button></li>';
      }).join('') + '</ul>';
  }
  /** 付箋の入力の枠。media: 無し = 段落 / 'figure' = 図 / 'app' = 動かせるもの（§L-9 で種類・問い・一言の例が変わる） */
  function stickyFormHtml(kind, media) {
    var kinds = media === 'figure' ? STICK_FIG_KINDS : media === 'app' ? STICK_APP_KINDS : media === 'video' ? STICK_VIDEO_KINDS : STICK_KINDS;
    var q = media === 'figure' ? 'この図に付箋を付けます。どれに近いですか？' : media === 'app' ? 'この動かせるものに付箋を付けます。どれに近いですか？' : media === 'video' ? 'この動画に付箋を付けます。どれに近いですか？' : 'この段落に付箋を付けます。どれに近いですか？';
    var ex = media === 'figure' ? '赤血球を立体の絵にして、血管の中を流れている様子に' : media === 'app' ? '奥から手前に流れてくる見え方に' : media === 'video' ? '1:20 からの区間だけにして' : '「酸素」が小学生には難しい';
    return '<span class="mp-stick-form" data-stick-form="1" role="group" aria-label="付箋を付ける"><span class="mp-stick-q">' + q + '</span>' +
      '<span class="mp-chips">' + kinds.map(function (k) {
        return '<button type="button" class="mp-chip' + (kind === k[0] ? ' on' : '') + '" data-stick-kind="' + k[0] + '" aria-pressed="' + (kind === k[0] ? 'true' : 'false') + '">' + k[1] + '</button>';
      }).join('') + '</span>' +
      '<input type="text" class="mp-stick-input" maxlength="200" placeholder="一言（任意）例: ' + ex + '" aria-label="付箋の一言">' +
      '<span class="mp-stick-btns"><button type="button" class="btn small primary" data-stick-add="1"' + (kind ? '' : ' disabled') + '>付箋を付ける</button><button type="button" class="btn small" data-stick-cancel="1">やめる</button>' +
      (kind ? '' : '<span class="muted mp-stick-hint">種類を選ぶと付けられます</span>') + '</span></span>';
  }
  /** 1 枠の骨組み（本文は DOM 側が md を読んでから previewBodyHtml で入れる） */
  /**
   * 1 枠の骨組み（本文は DOM 側が md を読んでから previewBodyHtml で入れる）。o: { marks, pins }（任意）。
   * 要約・部品の題名・最初にやること（material.json の文）に、quote を含む見てほしい所があれば番号の印（§V-9 b）
   */
  function previewFrameHtml(d, sel, fi, o) {
    o = o || {};
    var mat = (d.version && d.version.material) || {};
    var parts = Array.isArray(mat.parts) ? mat.parts : [];
    var aud = sel.game ? null : sel.aud;
    var summary = aud === 'secondary' ? mat.summary_secondary : mat.summary_elementary;
    var headPin = function (text) { var q = normQ(text); return pinAttrs(o.marks && o.pins && q ? pinsFor(o.pins.head, function (x) { return q.indexOf(x.q) >= 0; }) : []); };
    var ps = summary ? headPin(summary) : null;
    return '<div class="mat-preview" data-frame="' + fi + '" data-mode="' + (sel.aud === 'secondary' && !sel.game ? 'js' : 'es') + '">' +
      (fi > 0 ? '<div class="mp-frame-bar">' + pvSwitchHtml(sel, fi) + '</div>' : '') +
      '<p class="mp-now" data-mp-now="' + fi + '">いま表示: <b>' + esc(pvLabel(sel)) + '</b></p>' +
      '<div class="mp-cover"><h2 class="mp-title">' + esc(mat.title || '') + '</h2>' + (summary ? '<p class="mp-summary' + ps.cls + '" data-head-k="summary"' + ps.attr + '>' + ps.btns + esc(summary) + '</p>' : '') + '</div>' +
      parts.map(function (p, pi) {
        p = p && typeof p === 'object' ? p : {};
        var ep = p.entry_point && typeof p.entry_point === 'object' ? p.entry_point : {};
        var pt = headPin(p.title), pe = ep.text ? headPin(ep.text) : null;
        return '<section class="mp-part" data-mp-part="' + pi + '">' +
          '<div class="mp-part-head"><span class="mp-kind">' + esc(kindName(p.kind)) + '</span><h3 class="mp-part-title' + pt.cls + '" data-head-k="title"' + pt.attr + '>' + pt.btns + esc(p.title || '') + '</h3></div>' +
          (ep.text ? '<div class="mp-entry' + pe.cls + '" data-head-k="entry"' + pe.attr + '>' + pe.btns + '<span class="mp-entry-k">最初にやること' + (vhas(ENTRY_LABEL, ep.type) ? '（' + ENTRY_LABEL[ep.type] + '）' : '') + '</span><p>' + esc(ep.text) + '</p></div>' : '') +
          '<div class="mp-body" id="mp-body-' + fi + '-' + pi + '" data-mp-body="' + pi + '"><p class="mp-loading">読み込み中…</p></div></section>';
      }).join('') +
      (parts.length ? '' : '<p class="mp-missing">部品（parts）がありません</p>') + '</div>';
  }
  /** 変奏が無い時の文 */
  function missingVariantHtml(part, sel) {
    var have = (Array.isArray(part && part.variants) ? part.variants : []).filter(function (v) { return v && typeof v === 'object'; }).map(variantLabel);
    return '<p class="mp-missing">この部品には「' + esc(pvLabel(sel)) + '」がありません' + (have.length ? '（ある形: ' + esc(have.join(' / ')) + '）' : '') + '</p>';
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

  // §S-8-2: 作り直しで前の版の取得記録により確かめた出典（この session では開いていない）。ほかの値はそのまま出す
  function checkDetailText(x) { return x === 'carried' ? '前の版の記録で確認' : x; }

  // ---- 出典カード（確認画面の「出典と主張」。表をやめ、どの主張を支えているか・何が問題かを日本語で先頭に出す）----
  // 状態の順（小さいほど上）: 食い違い → 引用不一致 → 開けていない → 確かめきれない → 利用条件不明 → 問題なし → 補助の出典（二次）
  var SRC_ISSUE = {
    contradicted: { rank: 0, cls: 'red', text: '出典と食い違う主張があります' },
    quote_mismatch: { rank: 1, cls: 'red', text: '引用が本文と一致しません' },
    maker_url_not_fetched: { rank: 2, cls: 'red', text: '職人がこのページを開けていません' },
    verifier_limit: { rank: 3, cls: 'yellow', text: '検証係が開ききれませんでした（取得の上限）' },
    not_confirmed: { rank: 3, cls: 'yellow', text: 'この出典で主張を確かめられませんでした' },
    license_unknown: { rank: 4, cls: 'yellow', text: '利用条件が分かりません' }
  };
  var SRC_OK = { rank: 5, cls: 'green', text: '問題なし' };
  var SRC_SECONDARY = { rank: 6, cls: 'gray', text: '補助の出典（一次ではない）' };
  /** 引用の照合（check_detail）の日本語。§F-1 の値。知らない値はそのまま */
  var CHECK_DETAIL_TEXT = {
    ok: '職人が開いたページの本文に引用がありました',
    not_fetched: '職人がこのページを開けていません',
    quote_not_found: '職人が開いたページの本文に、この引用が見つかりませんでした',
    no_excerpt: '引用が書かれていません（動画の出典はこの値です）',
    result_unavailable: 'ページは開けましたが、本文を照らし合わせられませんでした（PDF など）',
    secondary: '補助の出典のため、照合の結果は参考です',
    carried: '前の版の記録で確認'
  };
  var VERDICT_JA = { confirmed: '確か', hypothesis: '仮説', unverified: '未確認', contradicted: '食い違い' };
  var hasOwn = vhas;
  var strArr = function (v) { return Array.isArray(v) ? v.filter(function (x) { return typeof x === 'string'; }) : []; };

  /** 主張の逆引き: 出典 id → その出典を参照している主張（claims の source_ids から。出現順・重複なし） */
  function claimsBySource(claims) {
    var out = Object.create(null);
    (Array.isArray(claims) ? claims : []).forEach(function (c) {
      if (!c || typeof c !== 'object') return;
      strArr(c.source_ids).forEach(function (sid) {
        var list = out[sid] || (out[sid] = []);
        if (list.indexOf(c) < 0) list.push(c);
      });
    });
    return out;
  }
  /** 動画の出典（版の動画の source_id が指す行で、url がその動画の watch URL と一致するもの。§Q-11 9 と同じ規則） */
  function videoSourceIdsOf(d) {
    var ids = {}, srcs = Array.isArray(d && d.sources) ? d.sources : [];
    videosOf(d && d.version && d.version.material).forEach(function (v) {
      if (typeof v.source_id !== 'string' || typeof v.youtube_id !== 'string') return;
      var watch = 'https://www.youtube.com/watch?v=' + v.youtube_id;
      if (srcs.some(function (s) { return s && s.source_id === v.source_id && s.url === watch; })) ids[v.source_id] = true;
    });
    return ids;
  }
  /** 出典 1 件の問題（SRC_ISSUE のキー）。仕分けがある時は triage の group（要確認と同じ判定）、無い時は出典の列と主張の判定から */
  function sourceIssueKeys(s, tri, citing, isVideo) {
    var keys = [];
    var add = function (k) { if (hasOwn(SRC_ISSUE, k) && keys.indexOf(k) < 0) keys.push(k); };
    if (tri.hasGroups) {
      tri.groups.forEach(function (g) { if (g && g.source_id === s.source_id) add(g.cause); });
    } else {
      if ((citing || []).some(function (c) { return c.verdict === 'contradicted'; })) add('contradicted');
      if (!isVideo && Number(s.url_was_fetched) === 0) add('maker_url_not_fetched');
      if (!isVideo && Number(s.quote_found) === 0) add('quote_mismatch');
    }
    if (s.license === 'unknown') add('license_unknown');
    // 開けていないページは引用も照らし合わせられない。見出しは根の原因（開けていない）にする
    if (keys.indexOf('maker_url_not_fetched') >= 0 && keys.indexOf('quote_mismatch') >= 0) keys.splice(keys.indexOf('quote_mismatch'), 1);
    keys.sort(function (a, b) { return SRC_ISSUE[a].rank - SRC_ISSUE[b].rank; });
    return keys;
  }
  /**
   * 出典カードの材料（純関数）: cards は問題のある順（同じ順位は出典一覧の順）。
   * orphans = 出典の無い主張（source_ids が空）と、一覧に無い出典 id を参照する主張
   */
  function sourceCardsOf(d) {
    var tri = triageOf(d);
    var srcs = (Array.isArray(d && d.sources) ? d.sources : []).filter(function (s) { return s && typeof s === 'object'; });
    var by = claimsBySource(d && d.claims);
    var vids = videoSourceIdsOf(d);
    var known = {};
    srcs.forEach(function (s) { known[s.source_id] = true; });
    var cards = srcs.map(function (s, i) {
      var citing = hasOwn(by, s.source_id) ? by[s.source_id] : [];
      var isVideo = hasOwn(vids, s.source_id);
      var issues = sourceIssueKeys(s, tri, citing, isVideo);
      var head = issues.length ? SRC_ISSUE[issues[0]] : (s.is_primary ? SRC_OK : SRC_SECONDARY);
      var opened = [];
      tri.groups.forEach(function (g) { if (g && g.source_id === s.source_id) strArr(g.verifier_opened_urls).forEach(function (u) { if (opened.indexOf(u) < 0) opened.push(u); }); });
      if (!tri.hasGroups) citing.forEach(function (c) { strArr(c.opened_urls).forEach(function (u) { if (opened.indexOf(u) < 0) opened.push(u); }); });
      return { source: s, order: i, cardId: 'rv-src-' + i, issues: issues, rank: head.rank, head: head, claims: citing, opened: opened, video: isVideo, problem: issues.length > 0 };
    });
    cards.sort(function (a, b) { return a.rank - b.rank || a.order - b.order; });
    var orphans = [];
    (Array.isArray(d && d.claims) ? d.claims : []).forEach(function (c) {
      if (!c || typeof c !== 'object') return;
      var ids = strArr(c.source_ids);
      var missing = ids.filter(function (sid) { return !hasOwn(known, sid); });
      if (!ids.length) orphans.push({ claim: c, why: 'no_source', missing: [] });
      else if (missing.length) orphans.push({ claim: c, why: 'source_not_listed', missing: missing });
    });
    var cardOf = Object.create(null);
    cards.forEach(function (c) { if (!(c.source.source_id in cardOf)) cardOf[c.source.source_id] = c.cardId; });
    return { cards: cards, orphans: orphans, total: cards.length, problems: cards.filter(function (c) { return c.problem; }).length, cardOf: cardOf };
  }
  /** 取得日: "2026-11-04…" → "11/4 に取得"（形が違えばそのまま） */
  function accessedText(x) {
    if (typeof x !== 'string' || !x) return '';
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(x);
    return (m ? Number(m[2]) + '/' + Number(m[3]) : x) + ' に取得';
  }
  /** 短い URL: host（www. を除く）+ パスの先頭 40 字 */
  function shortUrl(url) {
    var s = String(url || '');
    var m = /^https?:\/\/([^\/?#]+)([^#]*)/i.exec(s);
    if (!m) return s.length > 50 ? s.slice(0, 50) + '…' : s;
    var rest = m[2] === '/' ? '' : m[2];
    return m[1].replace(/^www\./i, '') + (rest.length > 40 ? rest.slice(0, 40) + '…' : rest);
  }
  function verdictPill(v) {
    return v && hasOwn(VERDICT_JA, v) ? pill(VERDICT_JA[v], VERDICT_CLASS[v]) : pill('検証なし', 'gray');
  }
  function srcClaimHtml(c, claimIdx, extra) {
    var n = hasOwn(claimIdx, c.id) ? claimIdx[c.id] : -1;
    var idHtml = n >= 0 ? '<button type="button" class="linkish sc-cid" data-goto-claim="' + n + '" title="本文のこの主張の段落へ">' + esc(c.id) + '</button>' : '<b class="sc-cid">' + esc(c.id) + '</b>';
    return '<li>' + idHtml + ' ' + verdictPill(c.verdict) + ' <span class="sc-ctext">' + esc(c.text || '') + '</span>' +
      (c.reason ? '<div class="sc-reason">検証係: ' + esc(c.reason) + '</div>' : '') + (extra || '') + '</li>';
  }
  function sourceCardHtml(card, claimIdx) {
    var s = card.source, url = typeof s.url === 'string' ? s.url : '';
    var http = /^https?:\/\//i.test(url);
    var more = card.issues.slice(1).map(function (k) { return '<li>' + esc(SRC_ISSUE[k].text) + '</li>'; }).join('');
    var quoteBad = !card.video && Number(s.quote_found) === 0;
    var ex = typeof s.quoted_excerpt === 'string' ? s.quoted_excerpt : '';
    var quote = ex
      ? '<blockquote class="sc-quote' + (quoteBad ? ' is-bad' : '') + '">' + esc(ex) + '</blockquote>' +
        (quoteBad ? '<p class="sc-quote-note">' + esc(s.check_detail === 'result_unavailable' ? CHECK_DETAIL_TEXT.result_unavailable : Number(s.url_was_fetched) === 0 ? '職人がこのページを開けていないため、引用を照らし合わせられていません' : '職人が開いたページの本文に、この引用は見つかりませんでした') + '</p>' : '')
      : '<p class="sc-quote-none">' + (card.video ? '動画の出典のため、引用はありません' : '引用が書かれていません') + '</p>';
    var opened = card.opened.length && !(card.opened.length === 1 && card.opened[0] === url)
      ? '<div class="sc-opened"><span class="sc-label">検証係が開いた URL（職人の URL と違います）</span>' + card.opened.map(linkOrText).join('<br>') + '</div>' : '';
    var license = s.license === 'unknown' || !s.license ? '<span class="sc-lic-bad">分からない</span>' : esc(s.license);
    var detail = typeof s.check_detail === 'string' ? s.check_detail : '';
    return '<article class="sc sc-' + card.head.cls + '" id="' + card.cardId + '" data-src-card="' + card.order + '">' +
      '<p class="sc-state"><span class="sc-dot" aria-hidden="true"></span>' + esc(card.head.text) + '</p>' +
      (more ? '<ul class="sc-more-issues">' + more + '</ul>' : '') +
      '<h4 class="sc-title">' + esc(s.title || '（題名なし）') + ' <span class="sc-tag">' + (s.is_primary ? '一次' : '二次') + '</span></h4>' +
      '<p class="sc-meta">' + (http ? '<a href="' + esc(url) + '" title="' + esc(url) + '" rel="noopener noreferrer" target="_blank">' + esc(shortUrl(url)) + '</a>' : '<span class="pre" title="' + esc(url) + '">' + esc(shortUrl(url)) + '</span>') +
        (s.accessed_at ? ' ・ <span title="' + esc(s.accessed_at) + '">' + esc(accessedText(s.accessed_at)) + '</span>' : '') + ' ・ <span class="sc-sid">' + esc(s.source_id) + '</span></p>' +
      '<div class="sc-sec"><span class="sc-label">支えている主張</span>' + (card.claims.length ? '<ul class="sc-claims">' + card.claims.map(function (c) { return srcClaimHtml(c, claimIdx); }).join('') + '</ul>' : '<p class="sc-empty">この出典を参照している主張はありません</p>') + '</div>' +
      '<div class="sc-sec"><span class="sc-label">引用</span>' + quote + '</div>' + opened +
      '<p class="sc-lic"><span class="sc-label">利用条件</span> ' + license + '</p>' +
      '<details class="sc-log"><summary>照合の記録</summary><p>' + esc(hasOwn(CHECK_DETAIL_TEXT, detail) ? CHECK_DETAIL_TEXT[detail] : detail || '記録なし') + (detail ? ' <code>' + esc(detail) + '</code>' : '') + '</p>' +
        '<p class="muted">職人が開いた: ' + (Number(s.url_was_fetched) === 1 ? 'はい' : 'いいえ') + ' ・ 引用が本文にあった: ' + (Number(s.quote_found) === 1 ? 'はい' : 'いいえ') + (card.video ? ' ・ 動画の出典（開けたか・引用は検査しません）' : '') + '</p></details>' +
      '</article>';
  }
  function orphanCardHtml(orphans, claimIdx) {
    if (!orphans.length) return '';
    return '<article class="sc sc-red" id="rv-src-orphan" data-src-orphan="' + orphans.length + '"><p class="sc-state"><span class="sc-dot" aria-hidden="true"></span>出典のない主張が ' + orphans.length + ' 件あります</p>' +
      '<ul class="sc-claims">' + orphans.map(function (o) {
        return srcClaimHtml(o.claim, claimIdx, '<div class="sc-reason sc-why">' + (o.why === 'no_source' ? '出典が付いていません' : '出典一覧にない出典: ' + esc(o.missing.join('、'))) + '</div>');
      }).join('') + '</ul></article>';
  }
  /** 主張 id → d.claims の中の位置（段落の印と行き来するための番号。id は信頼できない文字列なので要素 id には番号を使う） */
  function claimIndexOf(d) {
    var idx = Object.create(null);
    (Array.isArray(d && d.claims) ? d.claims : []).forEach(function (c, i) { if (c && typeof c.id === 'string' && !(c.id in idx)) idx[c.id] = i; });
    return idx;
  }
  /** 「出典と主張」の欄（問題のある出典を上に。問題の無い出典だけを「問題なし」の中に畳む） */
  function sourcesPanelHtml(d, model) {
    var claimIdx = claimIndexOf(d);
    var bad = model.cards.filter(function (c) { return c.problem; }), good = model.cards.filter(function (c) { return !c.problem; });
    var secondary = good.filter(function (c) { return !c.source.is_primary; }).length;
    var sum = model.total ? '出典 ' + model.total + ' 件のうち 問題 ' + model.problems + ' 件' : '出典はありません';
    return '<div class="sc-panel" id="rv-sources">' +
      '<p class="sc-sum">' + esc(sum) + (model.orphans.length ? ' ・ <span class="err">出典のない主張 ' + model.orphans.length + ' 件</span>' : '') + '</p>' +
      orphanCardHtml(model.orphans, claimIdx) + bad.map(function (c) { return sourceCardHtml(c, claimIdx); }).join('') +
      (good.length ? '<details class="sc-okbox" id="rv-src-ok"' + (bad.length || model.orphans.length ? '' : ' open') + '><summary>問題なし（出典 ' + good.length + ' 件' + (secondary ? '。うち補助の出典 ' + secondary + ' 件' : '') + '）</summary>' +
        good.map(function (c) { return sourceCardHtml(c, claimIdx); }).join('') + '</details>' : '') +
      (!model.total && !model.orphans.length ? '<p class="muted">この版には出典も主張もありません。</p>' : '') +
      '</div>';
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
        '<td>' + (s.license === 'unknown' ? pill('unknown', 'red') : esc(s.license)) + '</td><td>' + (s.is_primary ? 'はい' : 'いいえ') + '</td><td>' + esc(checkDetailText(s.check_detail)) + '</td></tr>';
    }).join('') + '</tbody></table></div>';
    return '<h3>主張（claims）</h3>' + claimsHtml + '<h3>出典（sources）</h3>' + sourcesHtml;
  }

  /** 「直してもらう」にした項目 → 理由の行（§V-9 c: `- {title}{（場所）}: {detail}`。detail が空なら「: 」も付けない） */
  function redoLine(it, loc) {
    return '- ' + String(it.title || '') + (loc && loc.label ? '（' + loc.label + '）' : '') + (typeof it.detail === 'string' && it.detail ? ': ' + it.detail : '');
  }
  /** まだ理由に入れていない「直してもらう」の項目の行（純関数。locs = locateAll の結果） → [{ id, line }] */
  function redoLines(d, st, locs) {
    var states = statesFor(st, d), done = st && st.itemGen === itemGenOf(d) && Array.isArray(st.redoFlowed) ? st.redoFlowed : [];
    var out = [];
    triageOf(d).shown.forEach(function (it, i) {
      if (stateIn(states, it.id) === 'redo' && done.indexOf(it.id) < 0) out.push({ id: it.id, line: redoLine(it, (locs || [])[i]) });
    });
    return out;
  }

  /** 確認画面全体の HTML（純関数）。ctx: { status, queue: [version_id...], marks, busy, locs } */
  function reviewHtml(d, st, ctx) {
    ctx = ctx || {};
    var v = d.version, tri = triageOf(d), isReview = v.status === 'review';
    var vstate = verifyState(v, ctx.status);
    var queue = ctx.queue || [], pos = queue.indexOf(v.id);
    var marks = ctx.marks !== false;
    var rs = readerOf(d).status;
    var waiting = v.verification_status === 'pending' || v.verification_status === 'running' || rs === 'pending' || rs === 'running';
    // 1. 判定帯（§V-9 a 1.）
    var band = '<div class="rv-band" id="rv-band" data-rv-band="1"><div class="row">' +
      '<b class="rv-title">' + esc(d.material ? d.material.title : '') + '</b><span class="muted">v' + esc(v.version) + '</span>' +
      (pos >= 0 ? '<span class="muted">' + (pos + 1) + ' / ' + queue.length + '</span>' : '') +
      '<span class="pill rv-gate ' + GATE_CLS[tri.gate] + '" id="rv-gate" data-gate="' + tri.gate + '">' + esc(gateText(d, tri)) + '</span>' +
      (isReview ? '' : pill('この版は確認待ちではありません（' + v.status + '）', v.status === 'approved' ? 'green' : 'gray')) +
      '<span class="pill ' + vstate.cls + '" id="rv-vstate">' + esc(vstate.text) + '</span>' +
      (isReview && (v.verification_status === 'done' || v.verification_status === 'failed') ? '<button type="button" class="btn small" id="reverify-btn">再検証</button>' : '') +
      (waiting ? '<button type="button" class="btn small" id="rv-reload">読み込み直す</button>' : '') +
      (tri.action !== 'none' ? pill(tri.action === 'reverify' ? WHY_TEXT.reverify : WHY_TEXT.auto_return, 'yellow') : '') +
      '<a href="#/material/' + esc(v.material_id) + '">素材へ</a>' +
      '<button type="button" class="btn small" id="rv-help" title="キーの一覧（?）">キー ?</button></div></div>';
    // 2. 舞台: 子どもの画面（主役）と右の一覧。本文は DOM 側が md を読んでから入れる（fillPreview）
    var pv = st.pv || defaultPv();
    var po = { marks: marks, pins: pinsOf(d, st) };
    var stickies = st.stickies || [];
    var stage = '<div class="rv-stage' + (pv.compare ? ' is-compare' : '') + '" id="rv-stage">' +
      '<section class="rv-body" id="rv-body" aria-label="子どもの画面">' +
        '<div class="rv-pv-head"><div class="mp-bar" id="mp-bar" role="toolbar" aria-label="教材の見え方">' + pvSwitchHtml(pv, 0) + '</div>' + marksToggleHtml(marks) + '</div>' +
        '<div class="mp-frames' + (pv.compare ? ' is-compare' : '') + '" id="mp-frames">' + framesOf(pv).map(function (sel, fi) { return previewFrameHtml(d, sel, fi, po); }).join('') + '</div>' +
      '</section>' +
      '<aside class="rv-rail" id="rv-rail" aria-label="見てほしい所と機械の確認">' +
        '<section class="rv-rail-sec" id="rv-items">' + itemsHtml(d, st, ctx) + '</section>' +
        '<section class="rv-rail-sec" id="rv-machine">' + machineHtml(d) + '</section>' +
        '<section class="rv-rail-sec rv-stick-sec"><h2 class="rv-rail-h">付箋（<span id="rv-stick-n">' + stickies.length + '</span>）</h2>' +
          '<div class="mp-stickies" id="mp-stickies" aria-live="polite">' + stickyListHtml(stickies) + '</div></section>' +
      '</aside></div>';
    // 3. 補足（畳んだ details）
    var sup = '<div class="rv-sup" id="rv-sup">' +
      '<details class="card rv-sec" id="rv-sources-sec"><summary><h2>根拠と出典（出典カード）</h2></summary>' + sourcesPanelHtml(d, sourceCardsOf(d)) + '</details>' +
      '<details class="card rv-sec" id="rv-ok"><summary><h2>主張と出典の一覧（全件・照合の記録。主張 ' + esc((d.claims || []).length) + ' 件・出典 ' + esc((d.sources || []).length) + ' 件）</h2></summary>' + tablesHtml(d) + '</details>' +
      '<details class="card rv-sec" id="rv-detail"><summary><h2>詳細（機械検査・自己点検・変えてよい範囲・費用）</h2></summary>' + detailsHtml(d) + '</details></div>';
    // 4. 固定フッター（確認待ちの版だけ）
    var foot = '';
    if (isReview) {
      var ap = approveState(d, st), busy = !!ctx.busy;
      var hasRedo = ap.why.some(function (w) { return w.text === WHY_TEXT.redo; });
      foot = '<div class="rv-foot" id="rv-foot">' +
        '<div id="rv-reason" class="rv-reason' + (st.mode ? '' : ' hidden') + '">' +
          '<label class="field"><span id="d-note-label">' + reasonLabel(st.mode) + '</span><textarea id="d-note" rows="2" maxlength="4000">' + esc(st.note) + '</textarea></label>' +
          '<label class="field' + (st.mode === 'return' ? '' : ' hidden') + '" id="d-append-wrap"><span>直してもらう時の注文票への追記（任意）</span><textarea id="d-append" rows="2" maxlength="8000">' + esc(st.append) + '</textarea></label>' +
          '<p class="muted"><span id="d-again">' + reasonAgain(st.mode) + '</span> <button type="button" class="btn small" id="rv-reason-close">閉じる</button></p>' +
        '</div>' +
        '<div class="rv-foot-row">' +
          '<p class="rv-foot-st"><button type="button" class="linkish rv-why' + (ap.enabled ? ' is-ok' : '') + '" id="approve-why" data-target="' + esc(ap.why[0] ? ap.why[0].target : '') + '">' + esc(ap.text) + '</button>' +
          '<span id="rv-draft" class="err' + (st.draftShown && hasDraft(st) ? '' : ' hidden') + '">理由を書きかけです</span></p>' +
          '<span class="rv-btns">' +
          '<button type="button" class="btn danger" id="reject-btn"' + (busy ? ' disabled' : '') + '>却下する <span class="kbd">X</span></button>' +
          '<button type="button" class="btn' + (hasRedo ? ' is-suggest' : '') + '" id="return-btn"' + (busy ? ' disabled' : '') + '>直してもらう <span class="kbd">R</span></button>' +
          '<button type="button" class="btn primary" id="approve-btn"' + (ap.enabled && !busy ? '' : ' disabled') + '>公開する <span class="kbd">A</span></button>' +
          '</span></div></div>';
    }
    return band + stage + sup + foot;
  }
  function reasonLabel(mode) { return mode === 'reject' ? '却下の理由（必須）' : '直してもらう理由（必須）'; }
  function reasonAgain(mode) { return 'もう一度「' + (mode === 'reject' ? '却下する' : '直してもらう') + '」を押すと確認します。'; }

  // ---- 確認画面の DOM 側（状態は版ごとに残す: 失敗・再取得でも入力・項目の状態・付箋を消さない §G-3・§V-9 f）----
  var reviewStates = {};
  var reviewCtx = null; // { vid, d, st, status, queue, busy, view, marks, md, mdAll, locs }
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
    if (c.marks === undefined) c.marks = loadMarks();
    syncItemGen(st, d);
    c.locs = locateAll(d, st, c.mdAll || null);
    view.innerHTML = reviewHtml(d, st, c);
    document.body.classList.toggle('has-foot', d.version.status === 'review');
    document.body.classList.add('review-wide');
    $('#rv-stage').addEventListener('click', onStudyClick);
    $('#rv-stage').addEventListener('keydown', onStickyKey);
    $('#rv-sup').addEventListener('click', onStudyClick);
    watchReviewChrome();
    fillPreview();
    loadAllMd();
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
    $('#d-note').addEventListener('input', function () { st.note = this.value; syncReview(); });
    $('#d-append').addEventListener('input', function () { st.append = this.value; syncReview(); });
    $('#rv-reason-close').addEventListener('click', function () { st.mode = null; syncReview(); });
    $('#approve-why').addEventListener('click', function () { gotoWhy(this.getAttribute('data-target')); });
    $('#approve-btn').addEventListener('click', function () { runCommand({ cmd: 'approve' }); });
    $('#return-btn').addEventListener('click', function () { runCommand({ cmd: 'return' }); });
    $('#reject-btn').addEventListener('click', function () { runCommand({ cmd: 'reject' }); });
  }

  /** 全部を描き直さずに、見てほしい所・番号の印・理由欄・公開の可否だけを反映する（textarea の入力とフォーカス・iframe を保つ） */
  function syncReview() {
    var c = reviewCtx;
    if (!c) return;
    var st = c.st;
    syncItemGen(st, c.d);
    renderItems();
    paintPins();
    if (c.d.version.status !== 'review' || !$('#rv-foot')) return;
    $('#rv-reason').classList.toggle('hidden', !st.mode);
    $('#d-append-wrap').classList.toggle('hidden', st.mode !== 'return');
    $('#d-note-label').textContent = reasonLabel(st.mode);
    $('#d-again').textContent = reasonAgain(st.mode);
    if (!hasDraft(st)) st.draftShown = false;
    $('#rv-draft').classList.toggle('hidden', !(st.draftShown && hasDraft(st)));
    var ap = approveState(c.d, st);
    $('#approve-btn').disabled = !ap.enabled || c.busy;
    $('#return-btn').disabled = c.busy;
    $('#return-btn').classList.toggle('is-suggest', ap.why.some(function (w) { return w.text === WHY_TEXT.redo; }));
    $('#reject-btn').disabled = c.busy;
    var why = $('#approve-why');
    why.textContent = ap.text;
    why.classList.toggle('is-ok', ap.enabled);
    why.setAttribute('data-target', ap.why[0] ? ap.why[0].target : '');
    measureReviewChrome(); // 理由欄の開閉でフッターの高さが変わる
  }
  /** 右の一覧の「見てほしい所」を描き直す（押したボタンのフォーカスを保つ） */
  function renderItems() {
    var c = reviewCtx, box = $('#rv-items');
    if (!c || !box) return;
    var a = document.activeElement, keep = null;
    if (a && box.contains(a)) {
      ['data-it-ok', 'data-it-redo', 'data-it-goto'].forEach(function (k) { if (a.hasAttribute(k)) keep = '[' + k + '="' + String(a.getAttribute(k)).replace(/[^0-9]/g, '') + '"]'; });
      if (!keep && a.id) keep = '#' + a.id.replace(/[^\w-]/g, '');
    }
    box.innerHTML = itemsHtml(c.d, c.st, c);
    if (keep) { var b = box.querySelector(keep); if (b) b.focus({ preventScroll: true }); }
  }
  /** 子どもの画面の番号の印を、本文を読み直さずに今の状態の色にする（iframe を読み直さない） */
  function paintPins() {
    var c = reviewCtx;
    if (!c) return;
    var tri = triageOf(c.d), states = statesFor(c.st, c.d), byId = Object.create(null);
    tri.shown.forEach(function (it, i) { byId[it.id] = { id: it.id, num: i + 1, state: stateIn(states, it.id) }; });
    Array.prototype.forEach.call(document.querySelectorAll('#mp-frames button.mp-pin[data-pin-goto]'), function (b) {
      var id = b.getAttribute('data-pin-goto'), p = vhas(byId, id) ? byId[id] : null;
      if (!p) return;
      b.className = 'mp-pin is-' + p.state;
      b.textContent = p.state === 'ok' ? '✓' : p.state === 'redo' ? '直' : String(p.num);
      b.setAttribute('aria-label', '見てほしい所 ' + p.num + '（' + PIN_STATE_TEXT[p.state] + '）');
    });
    Array.prototype.forEach.call(document.querySelectorAll('#mp-frames [data-pin]'), function (el) {
      var ss = Array.prototype.map.call(el.querySelectorAll('.mp-pins > .mp-pin'), function (b) { var id = b.getAttribute('data-pin-goto'); return vhas(byId, id) ? byId[id].state : 'open'; });
      el.classList.toggle('pin-ok', ss.length > 0 && ss.every(function (s) { return s === 'ok'; }));
      el.classList.toggle('pin-redo', ss.some(function (s) { return s === 'redo'; }));
    });
  }

  // 右の一覧（sticky）の上端と高さを、判定帯とフッターの実際の高さに合わせる（--rv-top / --rv-bottom）
  var reviewRO = null;
  function measureReviewChrome() {
    var stage = $('#rv-stage');
    if (!stage) return;
    var band = $('#rv-band'), foot = $('#rv-foot');
    var top = (band ? band.getBoundingClientRect().height : 0) + 12;
    var bottom = (foot ? foot.getBoundingClientRect().height : 0) + 12; // fixed の要素は offsetParent が null なので高さだけで見る（隠れている時は 0）
    stage.style.setProperty('--rv-top', Math.ceil(top) + 'px');
    stage.style.setProperty('--rv-bottom', Math.ceil(bottom) + 'px');
  }
  /** 描画の時に測り、判定帯・フッターの大きさが変わった時（折り返し・理由欄の高さの変更）にも測り直す */
  function watchReviewChrome() {
    if (reviewRO) { reviewRO.disconnect(); reviewRO = null; }
    measureReviewChrome();
    if (typeof window.ResizeObserver === 'function') {
      reviewRO = new window.ResizeObserver(function () { if (reviewCtx) measureReviewChrome(); });
      ['#rv-band', '#rv-foot'].forEach(function (sel) { var el = $(sel); if (el) reviewRO.observe(el); });
    }
  }

  /** 要素へスクロールして点滅（閉じている details の中なら開く） */
  function flashEl(el) {
    if (!el) return;
    for (var p = el.parentNode; p && p !== document; p = p.parentNode) if (p.tagName === 'DETAILS') p.open = true;
    if (el.tagName === 'DETAILS') el.open = true;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
    setTimeout(function () { el.classList.remove('flash'); }, 1500);
  }
  function scrollToTarget(id) { flashEl(id ? document.getElementById(id) : null); }
  /** 「公開する」の理由の行を押した時: 項目なら選んで場所へ、それ以外はその要素へ */
  function gotoWhy(target) {
    var m = /^rv-it-(\d+)$/.exec(target || '');
    if (m) { focusItem(Number(m[1])); return; }
    scrollToTarget(target);
  }

  // ---- 子どもの画面の DOM 側（切り替え・本文の読み込み。md は版ごとに 1 回だけ読む）----
  function previewFrames(st) {
    var pv = st.pv || (st.pv = defaultPv());
    return framesOf(pv);
  }
  function mdFor(c, path) {
    c.md = c.md || Object.create(null);
    if (!(path in c.md)) {
      c.md[path] = fetchText('/api/review/' + encodeURIComponent(c.vid) + '/files/' + path).then(null, function (e) { delete c.md[path]; throw e; });
    }
    return c.md[path];
  }
  /** 枠の本文を入れる（切り替えが重なった時は最後の切り替えの結果だけを入れる） */
  function fillPreview() {
    var c = reviewCtx;
    if (!c) return;
    var d = c.d, st = c.st, token = c.pvToken = (c.pvToken || 0) + 1;
    var parts = (d.version.material && Array.isArray(d.version.material.parts)) ? d.version.material.parts : [];
    var base = { fileBase: '/api/review/' + encodeURIComponent(c.vid) + '/files/', marks: c.marks !== false, stick: true, pins: pinsOf(d, st), claimIdx: claimIndexOf(d), models3dMeta: models3dMetaOf(d) };
    previewFrames(st).forEach(function (sel, fi) {
      parts.forEach(function (p, pi) {
        var el = document.getElementById('mp-body-' + fi + '-' + pi);
        if (!el) return;
        var vr = pickVariant(p, sel);
        if (!vr) { el.innerHTML = missingVariantHtml(p, sel); return; }
        mdFor(c, vr.path).then(function (t) {
          if (reviewCtx !== c || c.pvToken !== token) return;
          var o = {};
          for (var k in base) o[k] = base[k];
          o.frame = fi; o.pi = pi; o.path = vr.path;
          // 段落の付箋は表示中の変奏の分だけ。図・動かせるものは部品ごと（どの変奏でも同じ図が出る）
          o.stickies = (st.stickies || []).filter(function (s) { return s.part_index === pi && (s.target === 'media' || s.variant_path === vr.path); });
          el.innerHTML = previewBodyHtml(t, p, o);
          bindModel3dErrors(el);
        }, function (e) {
          if (reviewCtx !== c || c.pvToken !== token) return;
          el.innerHTML = '<p class="err">' + esc(e.message) + '</p>';
        });
      });
    });
  }
  /** §AJ2-3: 描いた後の model-viewer に読み込みの失敗（error イベント）を登録し、要素の直後に「読み込めませんでした」を 1 回だけ足す */
  function bindModel3dErrors(root) {
    Array.prototype.forEach.call(root.querySelectorAll('.mp-model3d model-viewer'), function (mv) {
      mv.addEventListener('error', function () {
        if (mv.getAttribute('data-m3d-failed')) return;
        mv.setAttribute('data-m3d-failed', '1');
        var box = mv.closest ? mv.closest('.mp-model3d') : null;
        var p = document.createElement('p');
        p.className = 'mp-missing';
        p.textContent = '立体モデル ' + ((box && box.getAttribute('data-media-key')) || '') + ' を読み込めませんでした（取り直してください）';
        mv.parentNode.insertBefore(p, mv.nextSibling);
      });
    });
  }
  /** 全部の変奏の本文を読み、見てほしい所の場所（「小学生・短い 3 段落目」「中学生・長い にあります」）を出す */
  function loadAllMd() {
    var c = reviewCtx;
    if (!c || !triageOf(c.d).shown.length) return;
    var paths = [];
    partsOf(c.d).forEach(function (p) { variantsOf(p).forEach(function (vr) { if (paths.indexOf(vr.path) < 0) paths.push(vr.path); }); });
    Promise.all(paths.map(function (p) { return mdFor(c, p).then(function (t) { return [p, t]; }, function () { return [p, null]; }); })).then(function (rows) {
      if (reviewCtx !== c) return;
      var m = Object.create(null);
      rows.forEach(function (r) { if (typeof r[1] === 'string') m[r[0]] = r[1]; });
      c.mdAll = m;
      c.locs = locateAll(c.d, c.st, m);
      renderItems();
    });
  }
  /** 切り替えの後: 枠を描き直し、切り替えボタンの今の状態を出す */
  function renderPreview() {
    var c = reviewCtx;
    if (!c) return;
    var wrap = $('#mp-frames'), bar = $('#mp-bar');
    if (!wrap) return;
    var frames = previewFrames(c.st), cmp = !!c.st.pv.compare;
    var po = { marks: c.marks !== false, pins: pinsOf(c.d, c.st) };
    c.stickDraft = null;
    if (bar) bar.innerHTML = pvSwitchHtml(frames[0], 0);
    wrap.innerHTML = frames.map(function (sel, fi) { return previewFrameHtml(c.d, sel, fi, po); }).join('');
    wrap.classList.toggle('is-compare', cmp);
    var stage = $('#rv-stage');
    if (stage) stage.classList.toggle('is-compare', cmp);
    fillPreview();
    c.locs = locateAll(c.d, c.st, c.mdAll || null);
    renderItems();
  }
  /** 見てほしい所のカードを選んで（印を付けて）右の一覧の中で見せる */
  function focusItem(i) {
    var c = reviewCtx;
    if (!c) return;
    c.st.cursor = i;
    renderItems();
    var el = document.getElementById('rv-it-' + i);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    el.focus({ preventScroll: true });
  }
  /** 見てほしい所の場所へ（表示中の変奏に無い時は、その変奏に切り替えてから） */
  function gotoItem(i) {
    var c = reviewCtx;
    if (!c) return;
    c.st.cursor = i;
    renderItems();
    var loc = (c.locs || [])[i];
    if (!loc) { focusItem(i); return; }
    if (loc.t === 'para' && !loc.inView) {
      var pv = c.st.pv;
      pv.aud = loc.sel.aud; pv.len = loc.sel.len; pv.game = loc.sel.game;
      renderPreview();
      toast('「' + pvLabel(pv) + '」に切り替えました');
      mdFor(c, loc.path).then(function () {
        setTimeout(function () { if (reviewCtx === c) scrollToLoc((c.locs || [])[i] || loc); }, 0);
      }, function () { /* 読めない時は枠に理由が出る */ });
      return;
    }
    scrollToLoc(loc);
  }
  function scrollToLoc(loc) {
    var el = null, q = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
    if (loc.t === 'para') {
      if (loc.para >= 0) el = document.getElementById('mp-p-' + loc.fi + '-' + loc.pi + '-' + loc.para);
      if (!el) el = document.getElementById('mp-body-' + loc.fi + '-' + loc.pi);
    } else if (loc.t === 'media') {
      el = q('#mp-body-0-' + loc.pi + ' [data-media]').filter(function (x) { return x.getAttribute('data-media') === loc.media && x.getAttribute('data-media-key') === loc.key; })[0] ||
        document.querySelector('.mat-preview[data-frame="0"] [data-mp-part="' + loc.pi + '"]');
    } else if (loc.t === 'head') {
      el = q('.mat-preview[data-frame="0"] [data-head-k]').filter(function (x) { return normQ(x.textContent).indexOf(loc.q) >= 0; })[0] || document.querySelector('.mat-preview[data-frame="0"] .mp-cover');
    }
    if (!el) { toast('場所が見つかりません。学年・長さを切り替えてください', true); return; }
    flashEl(el);
  }
  function onStudyClick(e) {
    var c = reviewCtx;
    if (!c) return;
    var t = e.target && e.target.closest ? e.target : null;
    if (!t) return;
    var b = t.closest('[data-pv]');
    if (b) {
      var frames = previewFrames(c.st), fi = Number(b.getAttribute('data-pvf')) || 0;
      var sel = frames[fi] || frames[0], key = b.getAttribute('data-pv'), val = b.getAttribute('data-val');
      if (key === 'game') sel.game = !sel.game;
      else if (key === 'compare') c.st.pv.compare = !c.st.pv.compare;
      else if (key === 'aud' || key === 'len') { sel[key] = val; sel.game = false; }
      renderPreview();
      var again = document.querySelector('[data-pv="' + key + '"][data-pvf="' + fi + '"]' + (key === 'game' || key === 'compare' ? '' : '[data-val="' + val + '"]'));
      if (again) again.focus();
      return;
    }
    if (t.closest('[data-mp-marks]')) {
      c.marks = c.marks === false;
      saveMarks(c.marks);
      var mb = t.closest('[data-mp-marks]');
      mb.outerHTML = marksToggleHtml(c.marks);
      renderPreview();
      var nb = document.querySelector('[data-mp-marks]');
      if (nb) nb.focus();
      toast(c.marks ? '印を出しました' : '印を消しました（子どもが見るのと同じ見た目）');
      return;
    }
    // 見てほしい所: OK にする / このまま出す / 直してもらう（押し直すと戻る）・場所を見る（§V-9 c）
    var ib = t.closest('[data-it-ok], [data-it-redo]');
    if (ib) {
      if (c.busy || c.d.version.status !== 'review') return;
      var isOk = ib.hasAttribute('data-it-ok');
      var i = Number(ib.getAttribute(isOk ? 'data-it-ok' : 'data-it-redo'));
      toggleItem(c.st, c.d, triageOf(c.d).shown[i], isOk ? 'ok' : 'redo');
      c.st.cursor = i;
      syncReview();
      return;
    }
    var gi = t.closest('[data-it-goto]');
    if (gi) { gotoItem(Number(gi.getAttribute('data-it-goto'))); return; }
    var pin = t.closest('button.mp-pin[data-pin-goto]');
    if (pin) {
      var pid = pin.getAttribute('data-pin-goto'), shown = triageOf(c.d).shown;
      for (var k = 0; k < shown.length; k++) if (shown[k].id === pid) { focusItem(k); break; }
      return;
    }
    var rr = t.closest('#rv-reread');
    if (rr) {
      action(rr, {
        title: '読み手チェックをやり直します', body: '次の定期処理（10 分ごと）で読み手係がもう一度読みます。費用がかかります。',
        okText: 'やり直す', busyText: '予約中…',
        run: function () { return api('POST', '/api/review/' + encodeURIComponent(c.vid) + '/reread'); }, success: '読み手チェックのやり直しを予約しました'
      });
      return;
    }
    if (t.closest('[data-open-sources]')) { scrollToTarget('rv-sources-sec'); return; }
    var g = t.closest('[data-goto]');
    if (g) { gotoTarget(g.getAttribute('data-goto'), '出典カード'); return; }
    if (onStickyClick(c, t)) return;
    var gc = t.closest('[data-goto-claim]');
    if (gc) {
      var n = gc.getAttribute('data-goto-claim');
      var para = null;
      claimParaSelectors(n, !!c.st.pv.compare).some(function (qs) { para = document.querySelector(qs); return !!para; });
      if (para) gotoTarget(para.id, '');
      else toast('いま表示している「' + previewFrames(c.st).map(pvLabel).join('」「') + '」には、この主張の段落がありません。学年・長さを切り替えてください', true);
    }
  }
  // ---- 付箋の DOM 側 ----
  function renderStickies() {
    var c = reviewCtx, el = $('#mp-stickies'), n = $('#rv-stick-n');
    if (c && el) el.innerHTML = stickyListHtml(c.st.stickies || []);
    if (c && n) n.textContent = String((c.st.stickies || []).length);
  }
  function closeStickyForm() {
    var f = document.querySelector('[data-stick-form]');
    if (f) f.parentNode.removeChild(f);
    if (reviewCtx) reviewCtx.stickDraft = null;
  }
  /** 「直してもらう」にした項目の行を、理由欄の後ろに足す（1 件 1 回だけ。§V-9 c） */
  function flowRedo(st) {
    var c = reviewCtx;
    var pend = redoLines(c.d, st, c.locs);
    if (!pend.length) return { added: 0, left: 0 };
    var r = appendLines(st.note, pend.map(function (p) { return p.line; }));
    if (r.added) {
      st.note = r.note;
      st.flowedLines = (st.flowedLines || []).concat(r.lines);
      st.redoFlowed = (st.redoFlowed || []).concat(pend.slice(0, r.added).map(function (p) { return p.id; }));
      var ta = $('#d-note');
      if (ta) ta.value = st.note;
    }
    return { added: r.added, left: pend.length - r.added };
  }
  /** まだ理由欄に入れていない付箋を、理由欄の後ろに足す（textarea にも反映し、何件入れたかを出す）。pre = 先に足した「直してもらう」の項目の数 */
  function flowStickies(st, pre) {
    pre = pre || { added: 0, left: 0 };
    var pending = (st.stickies || []).filter(function (s) { return !s.flowed; });
    var lead = pre.added ? '直してもらう所 ' + pre.added + ' 件' : '';
    if (!pending.length) {
      if (pre.added || pre.left) toast(lead ? lead + 'を理由に足しました' + (pre.left ? '（' + NOTE_MAX + ' 字を超えるため ' + pre.left + ' 件は入れていません）' : '') : '理由が ' + NOTE_MAX + ' 字を超えるため、直してもらう所を足せませんでした', !pre.added || pre.left > 0);
      return 0;
    }
    var r = stickyNoteText(st.note, pending);
    if (r.added) {
      st.note = r.note;
      st.flowedLines = (st.flowedLines || []).concat(r.lines);
      pending.slice(0, r.added).forEach(function (s) { s.flowed = true; });
      var ta = $('#d-note');
      if (ta) ta.value = st.note;
      renderStickies();
    }
    var left = pending.length - r.added + pre.left;
    toast(r.added ? (lead ? lead + 'と' : '') + '付箋 ' + r.added + ' 件を理由に足しました' + (left ? '（' + NOTE_MAX + ' 字を超えるため ' + left + ' 件は入れていません）' : '') : '理由が ' + NOTE_MAX + ' 字を超えるため、付箋を足せませんでした', !r.added || left > 0);
    return r.added;
  }
  function addSticky(c) {
    var dr = c.stickDraft, form = document.querySelector('[data-stick-form]');
    if (!dr || !dr.kind || !form) return;
    var inp = form.querySelector('input');
    var st = c.st;
    st.stickies = st.stickies || [];
    st.stickySeq = (st.stickySeq || 0) + 1;
    var text = inp ? inp.value.trim().slice(0, 200) : '';
    if (dr.target === 'media') st.stickies.push({ id: st.stickySeq, target: 'media', media: dr.media, media_key: dr.media_key, media_title: dr.media_title || '', part_id: dr.part_id, part_title: dr.part_title, part_index: dr.pi, kind: dr.kind, text: text, flowed: false });
    else st.stickies.push({
      id: st.stickySeq, part_id: dr.part_id, part_title: dr.part_title, part_index: dr.pi, variant_path: dr.path, variant_label: dr.label,
      para_index: dr.para, head: dr.head, kind: dr.kind, text: text, flowed: false
    });
    c.stickDraft = null;
    fillPreview();
    renderStickies();
    if (st.mode === 'return') flowStickies(st);
    else toast('付箋を付けました（全部で ' + st.stickies.length + ' 件）。直してもらう時に理由欄へ入ります');
  }
  /** 付箋の操作なら true */
  function onStickyClick(c, t) {
    var mb = t.closest('[data-stick-media]');
    if (mb) {
      closeStickyForm();
      var mediaEl = mb.closest('[data-media]'), mbody = mb.closest('[data-mp-body]');
      if (!mediaEl || !mbody) return true;
      var mpi = Number(mbody.getAttribute('data-mp-body')) || 0;
      var mpart = ((c.d.version.material || {}).parts || [])[mpi] || {};
      var ma = mb.getAttribute('data-stick-media'), mk = ma === 'app' || ma === 'video' ? ma : 'figure';
      var mkey = mb.getAttribute('data-stick-key') || '';
      // 動画は理由の行と一覧に題名を出す（part.videos の title。無ければ空）
      var mvid = mk === 'video' ? (Array.isArray(mpart.videos) ? mpart.videos : []).filter(function (v) { return v && v.id === mkey; })[0] : null;
      c.stickDraft = { target: 'media', media: mk, media_key: mkey, media_title: mvid && typeof mvid.title === 'string' ? mvid.title : '', pi: mpi, part_id: String(mpart.id || ''), part_title: String(mpart.title || ''), kind: null };
      // 図は <figure> の末尾、動かせるものは見出しの行の下・iframe の上、動画はボタンの行の下・埋め込みの上
      var frameEl = mk === 'app' ? mediaEl.querySelector('iframe') : null;
      var vtools = mk === 'video' ? mb.closest('.mp-video-tools') : null;
      if (vtools) vtools.insertAdjacentHTML('afterend', stickyFormHtml(null, mk));
      else if (frameEl) frameEl.insertAdjacentHTML('beforebegin', stickyFormHtml(null, mk));
      else mediaEl.insertAdjacentHTML('beforeend', stickyFormHtml(null, mk));
      var mfirst = mediaEl.querySelector('[data-stick-kind]');
      if (mfirst) mfirst.focus();
      return true;
    }
    var open = t.closest('[data-stick-open]');
    if (open) {
      closeStickyForm();
      var paraEl = open.closest('[data-para]'), body = open.closest('[data-mp-body]'), frame = open.closest('.mat-preview');
      if (!paraEl || !body || !frame) return true;
      var fi = Number(frame.getAttribute('data-frame')) || 0, pi = Number(body.getAttribute('data-mp-body')) || 0;
      var part = ((c.d.version.material || {}).parts || [])[pi] || {};
      var vr = pickVariant(part, previewFrames(c.st)[fi] || c.st.pv);
      if (!vr) return true;
      c.stickDraft = { pi: pi, part_id: String(part.id || ''), part_title: String(part.title || ''), path: vr.path, label: variantLabel(vr), para: Number(paraEl.getAttribute('data-para')), head: paraEl.getAttribute('data-head') || '', kind: null };
      paraEl.insertAdjacentHTML('beforeend', stickyFormHtml(null));
      var first = paraEl.querySelector('[data-stick-kind]');
      if (first) first.focus();
      return true;
    }
    var kind = t.closest('[data-stick-kind]');
    if (kind) {
      if (!c.stickDraft) return true;
      c.stickDraft.kind = kind.getAttribute('data-stick-kind');
      var form = kind.closest('[data-stick-form]');
      var text = form.querySelector('input').value;
      form.outerHTML = stickyFormHtml(c.stickDraft.kind, c.stickDraft.media);
      var nf = document.querySelector('[data-stick-form]');
      if (nf) { var ni = nf.querySelector('input'); ni.value = text; ni.focus(); }
      return true;
    }
    if (t.closest('[data-stick-add]')) { addSticky(c); return true; }
    if (t.closest('[data-stick-cancel]')) { closeStickyForm(); return true; }
    var del = t.closest('[data-stick-del]');
    if (del) {
      var id = Number(del.getAttribute('data-stick-del'));
      c.st.stickies = (c.st.stickies || []).filter(function (s) { return s.id !== id; });
      fillPreview();
      renderStickies();
      toast('付箋を消しました（残り ' + c.st.stickies.length + ' 件）' + (c.st.mode === 'return' ? '。理由欄に入れた行は残っています' : ''));
      return true;
    }
    return false;
  }
  /** 付箋の一言の欄: Enter で付ける・Esc でやめる（入力中なので確認画面のキー操作は効かない） */
  function onStickyKey(e) {
    var c = reviewCtx;
    if (!c || !e.target || !e.target.closest || !e.target.closest('[data-stick-form]') || e.target.tagName !== 'INPUT') return;
    var act = stickyKeyAction(e, !!(c.stickDraft && c.stickDraft.kind));
    if (!act) return;
    e.preventDefault();
    if (act === 'add') addSticky(c);
    else if (act === 'need_kind') toast('付箋の種類を選んでください', true);
    else closeStickyForm();
  }
  /** 行き先へスクロールして点滅（閉じている details の中なら開く） */
  function gotoTarget(id, what) {
    var el = id ? document.getElementById(id) : null;
    if (!el) { if (what) toast(what + 'が見つかりません', true); return; }
    flashEl(el);
  }

  function openKeys() {
    var dlg = $('#keys-dlg');
    if (dlg && !dlg.open) dlg.showModal();
  }

  /** 公開の確認ダイアログの文（§V-9 c: 見てほしい所 N 件を OK にしました・チャンネル『…』を確認済みにします・読み手チェックはまだです） */
  function approveDialogBody(d, st, ap) {
    var tri = triageOf(d), keys = trustChannelsOf(d, st), lines = ['公開すると配信 API に出ます。'];
    if (tri.shown.length) lines.push('見てほしい所 ' + tri.shown.length + ' 件を OK にしました');
    keys.forEach(function (k) {
      var it = tri.shown.filter(function (x) { return x.channel_key === k; })[0];
      lines.push('チャンネル『' + (it && typeof it.channel_name === 'string' && it.channel_name ? it.channel_name : k) + '』を確認済みにします');
    });
    if (ap && ap.readerWait) lines.push('読み手チェックはまだです');
    return lines.join('\n');
  }

  /** キーとボタンの共通の入口 */
  function runCommand(cmd) {
    var c = reviewCtx;
    if (!c || !cmd || c.busy) return;
    var st = c.st;
    if (cmd.cmd === 'draft_block') { applyCommand(st, cmd, c.d); syncReview(); return; }
    if (cmd.cmd === 'help') return openKeys();
    if (cmd.cmd === 'nav') return navReview(cmd.dir);
    if (cmd.cmd === 'item_step') {
      applyCommand(st, cmd, c.d);
      if (st.cursor >= 0 && triageOf(c.d).shown.length) gotoItem(st.cursor);
      else toast('見てほしい所はありません');
      return;
    }
    if (cmd.cmd === 'item_ok') {
      var it = triageOf(c.d).shown[st.cursor];
      if (!it) { toast('N / P で見てほしい所を選んでから O を押してください', true); return; }
      if (it.blocking) { toast('この項目はこのまま出せません（直してもらってください）', true); return; }
      applyCommand(st, cmd, c.d);
      syncReview();
      return;
    }
    if (cmd.cmd === 'approve') {
      var ap = approveState(c.d, st);
      if (!ap.enabled) { syncReview(); if (ap.why[0]) gotoWhy(ap.why[0].target); return; }
      return sendDecision('approve', 'この版を公開します', approveDialogBody(c.d, st, ap));
    }
    if (cmd.cmd === 'return' || cmd.cmd === 'reject') {
      if (st.mode !== cmd.cmd) {
        st.mode = cmd.cmd;
        if (cmd.cmd === 'return') flowStickies(st, flowRedo(st)); // 「直してもらう」の項目と付箋を理由欄の後ろに足す（書いてある理由は消さない）
        syncReview();
        var ta = $('#d-note');
        if (ta) { ta.focus(); ta.scrollIntoView({ block: 'nearest' }); }
        return;
      }
      var sendNote = decisionNote(st, cmd.cmd); // 却下は流し込んだ行を外して送る
      if (!sendNote.trim()) { toast('理由を入力してください', true); $('#d-note').focus(); return; }
      return cmd.cmd === 'return'
        ? sendDecision('return', 'この版を直してもらいます', '理由を添えて改善 job を注文します（作り直し）。\n\n理由: ' + st.note)
        : sendDecision('reject', 'この版を却下します', '配信の状態は変わりません。\n\n理由: ' + sendNote);
    }
  }

  function navReview(dir) {
    var c = reviewCtx, q = c.queue || [], i = q.indexOf(c.vid);
    var next = i < 0 ? q[dir > 0 ? 0 : q.length - 1] : q[i + dir];
    if (!next) { toast(dir > 0 ? '最後の確認待ちです' : '最初の確認待ちです'); return; }
    location.hash = '#/review/' + next;
  }

  /** 送信が失敗した時の画面の動き（§V-9 c）: 'reload' = 読み直す / 'channel' = 最初の初めてのチャンネルの項目へ / 'stay' = そのまま */
  function decisionErrorAction(code) {
    if (code === 'channel_trust_required') return 'channel';
    if (code === 'stale_reader' || code === 'stale_verification' || code === 'conflict' || code === 'checks_pending' || code === 'auto_triage_pending' || code === 'not_in_review') return 'reload';
    return 'stay';
  }

  /** 予告（確認ダイアログ）→ 実行（送信中はボタンとキーを無効化）→ トースト → 反映（一覧を取り直して次の確認待ちへ）。失敗時は理由・項目の状態・付箋を残す */
  function sendDecision(decision, title, body) {
    var c = reviewCtx, st = c.st, vid = c.vid;
    confirmDialog({ title: title, body: body, okText: decision === 'approve' ? '公開する' : decision === 'return' ? '直してもらう' : '却下する' }).then(function (dres) {
      if (!dres.ok || reviewCtx !== c) return;
      c.busy = true;
      var btn = $(decision === 'approve' ? '#approve-btn' : decision === 'return' ? '#return-btn' : '#reject-btn');
      var label = btn ? btn.innerHTML : '';
      syncReview();
      if (btn) btn.textContent = '送信中…';
      api('POST', '/api/review/' + encodeURIComponent(vid) + '/decision', decisionPayload(c.d, st, decision)).then(function (res) {
        delete reviewStates[vid];
        var msg = decision === 'approve' ? '公開しました' : decision === 'return' ? '直してもらう注文を出しました' : '却下しました';
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
        var act = decisionErrorAction(e.body && e.body.error);
        if (act === 'reload') { route(); return; } // 理由・項目の状態・付箋は reviewStates に残る（世代が変わった項目だけ open に戻る）
        syncReview();
        if (act === 'channel') {
          var shown = triageOf(c.d).shown;
          for (var k = 0; k < shown.length; k++) if (shown[k].cause === 'video_channel_new') { focusItem(k); break; }
        }
      });
    });
  }

  function onReviewKey(e) {
    var c = reviewCtx;
    if (!c || !c.d || c.d.version.status !== 'review') return;
    var a = document.activeElement;
    var env = {
      inInput: inInputOf(a),
      dialogOpen: !!document.querySelector('dialog[open]'),
      busy: !!c.busy,
      draft: hasDraft(c.st)
    };
    var cmd = keyCommand(e, env);
    if (!cmd) return;
    e.preventDefault();
    runCommand(cmd);
  }

  // ---- 画面: 確認待ち一覧（§V-9 d。並びはサーバーの順 = 見てほしい所の多い順 → 古い順）----
  var RL_SECTIONS = [['attention', '見てほしい所がある'], ['clean', '全部通った（子どもの画面を見て公開するだけ）'], ['pending', '機械の確認中']];
  function rowGate(v) { return v && (v.gate === 'clean' || v.gate === 'attention' || v.gate === 'pending') ? v.gate : 'pending'; }
  /** 一覧の表（純関数）。gate の無い行（古い Worker）は「機械の確認中」に入れる。空の区画は出さない */
  function reviewListHtml(d) {
    var rows = (d && Array.isArray(d.versions) ? d.versions : []).filter(isObj);
    if (!rows.length) return '<p class="muted" data-rl-empty="1">確認待ちの版はありません。</p>';
    return '<p class="muted">見てほしい所の多い順です。開いた画面では J / K で次・前へ移れます。</p>' + RL_SECTIONS.map(function (s) {
      var rs = rows.filter(function (r) { return rowGate(r) === s[0]; });
      if (!rs.length) return '';
      return '<section class="rl-sec" data-rl-sec="' + s[0] + '"><h2>' + esc(s[1]) + ' <span class="muted rl-n">' + rs.length + ' 本</span></h2>' +
        '<div class="table-wrap"><table><thead><tr><th>素材</th><th>版</th><th>見てほしい所</th><th>機械の確認</th><th>検証</th><th>作成</th></tr></thead><tbody>' +
        rs.map(function (v) {
          var nr = typeof v.needs_review === 'number' ? v.needs_review : typeof v.fix === 'number' && typeof v.ask === 'number' ? v.fix + v.ask : null;
          var vs = verifyState(v, null);
          var readerOnly = Array.isArray(v.pending_on) && v.pending_on.length === 1 && v.pending_on[0] === 'reader';
          return '<tr data-rl-row="1"><td><a href="#/review/' + esc(v.version_id) + '">' + esc(v.title) + '</a></td><td>v' + esc(v.version) + '</td>' +
            '<td>' + (nr === null ? '—' : nr > 0 ? pill(nr + ' 件', 'orange') : pill('0', 'green')) + '</td>' +
            '<td>' + (typeof v.auto_ok === 'number' ? esc(v.auto_ok) + ' / 6' : '—') + (readerOnly ? ' ' + pill('読み手チェック待ち', 'gray') : '') + '</td>' +
            '<td>' + pill(vs.text, vs.cls) + '</td><td>' + esc(fmtTime(v.created_at)) + '</td></tr>';
        }).join('') + '</tbody></table></div></section>';
    }).join('');
  }
  /** #rl-stats の中身（純関数）。s: GET /api/review/stats の応答 / null = 読み込み中 / 文字列 = 読めなかった理由 */
  function rlStatsHtml(s, busy) {
    if (s === null || s === undefined) return '<p class="loading">判断の数を読み込み中…</p>';
    if (typeof s === 'string') return '<p class="err">判断の数を読めませんでした: ' + esc(s) + '</p><p><button type="button" class="btn small" id="rl-stats-retry">もう一度読み込む</button></p>';
    var c = isObj(s.clean) ? s.clean : {}, num = function (x) { return typeof x === 'number' && isFinite(x) ? x : 0; };
    var a = num(c.approve), r = num(c['return']), x = num(c.reject);
    var line = '機械が『全部通った』とした教材で、ふじさんの判断は ' + (a + r + x ? '公開 ' + a + ' 本・直してもらう ' + r + ' 本・却下 ' + x + ' 本（直近 ' + num(s.streak) + ' 本つづけて公開）' : 'まだありません');
    var on = s.auto_publish === true;
    return '<p class="rl-stats-line">' + esc(line) + '</p><div class="rl-auto">' +
      '<button type="button" class="rl-switch' + (on ? ' on' : '') + '" id="rl-autopub" aria-pressed="' + (on ? 'true' : 'false') + '"' + (busy ? ' disabled' : '') + '>' +
        '<span class="rl-knob" aria-hidden="true"></span><span class="rl-switch-t">全部通った教材は自動で公開する</span><span class="rl-switch-s">' + (busy ? '切り替え中…' : on ? 'ON' : 'OFF') + '</span></button>' +
      (on ? '<span class="muted" data-rl-autopub-n="1">自動で公開した教材 ' + num(s.auto_published) + ' 本</span>' : '') + '</div>';
  }
  function loadRlStats(here, refocus) {
    var box = $('#rl-stats');
    if (!box) return;
    api('GET', '/api/review/stats').then(function (s) {
      if (location.hash !== here || !$('#rl-stats')) return;
      box.innerHTML = rlStatsHtml(s, false);
      var sw = $('#rl-autopub');
      if (refocus) sw.focus();
      sw.addEventListener('click', function () {
        var on = s.auto_publish !== true;
        var go = function () {
          box.innerHTML = rlStatsHtml(s, true);
          api('POST', '/api/review/auto-publish', { on: on }).then(function (res) {
            toast(res && res.auto_publish ? '全部通った教材を自動で公開するようにしました' : '自動で公開するのをやめました（全部通った教材も確認待ちに並びます）');
            loadRlStats(here, true);
          }, function (e) {
            toast(e.message || '切り替えられませんでした', true);
            loadRlStats(here, true);
          });
        };
        if (!on) { go(); return; }
        confirmDialog({ title: '全部通った教材を自動で公開します', body: '機械の確認が全部通った教材を、人を通さずに公開します。見てほしい所がある教材は、これまでどおり確認待ちに出ます。', okText: 'ON にする' }).then(function (r) { if (r.ok) go(); else sw.focus(); });
      });
    }, function (e) {
      if (location.hash !== here || !$('#rl-stats')) return;
      box.innerHTML = rlStatsHtml(e.message || '失敗しました');
      var b = $('#rl-stats-retry');
      if (b) b.addEventListener('click', function () { box.innerHTML = rlStatsHtml(null); loadRlStats(here); });
    });
  }
  function viewReviewList(view) {
    var here = location.hash;
    view.innerHTML = '<h1>確認待ち</h1><div class="card rl-stats" id="rl-stats">' + rlStatsHtml(null) + '</div><div id="rl" class="card loading">読み込み中…</div><div id="rl-auto"></div>';
    loadRlStats(here);
    api('GET', '/api/review').then(function (d) {
      if (location.hash !== here) return;
      var el = $('#rl');
      el.classList.remove('loading');
      el.innerHTML = reviewListHtml(d);
    }, function (e) {
      if (location.hash !== here) return;
      $('#rl').innerHTML = '<p class="err">読み込めませんでした: ' + esc(e.message) + '</p><p><button type="button" class="btn" id="rl-retry">もう一度読み込む</button></p>';
      var b = $('#rl-retry');
      if (b) b.addEventListener('click', route);
    });
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
      el.innerHTML = '<div class="card"><h2>自動で作り直し中</h2><p class="muted">機械の確認で直す所が見つかったため、自動で差し戻しました。作り直しが終わるとここから確認待ちに移ります。</p><ul>' + rows.map(function (r) {
        return '<li>' + pill('自動で作り直し中', 'yellow') + ' <a href="#/material/' + esc(r.m.id) + '">' + esc(r.m.title) + '</a> <a class="muted" href="#/job/' + esc(r.job.id) + '">' + esc(JOB_LABEL[r.job.status] || r.job.status) + '</a></li>';
      }).join('') + '</ul></div>';
    }, function () { /* 補助の表示。失敗しても一覧は使える */ });
  }

  // smoke（§V-11 (u9)）とテストから純関数を呼べるようにする。画面の動作には使わない
  window.FactoryAdminReview = {
    CAUSE_TEXT: CAUSE_TEXT, MK_KEYS: MK_KEYS, WHY_TEXT: WHY_TEXT, GATE_TEXT: GATE_TEXT,
    triageOf: triageOf, readerOf: readerOf, verifyState: verifyState, gateText: gateText,
    approveState: approveState, checklistPayload: checklistPayload, trustChannelsOf: trustChannelsOf, decisionPayload: decisionPayload, decisionErrorAction: decisionErrorAction,
    keyCommand: keyCommand, applyCommand: applyCommand, toggleItem: toggleItem, syncItemGen: syncItemGen, statesFor: statesFor, itemGenOf: itemGenOf,
    newReviewState: newReviewState, reviewHtml: reviewHtml, itemsHtml: itemsHtml, machineHtml: machineHtml, machineStates: machineStates, renderMd: renderMd,
    // 項目の場所・子どもの画面の印
    itemTarget: itemTarget, locateItem: locateItem, locateAll: locateAll, pinsOf: pinsOf, redoLines: redoLines, redoLine: redoLine, approveDialogBody: approveDialogBody,
    // 一覧・確認済みのチャンネル
    reviewListHtml: reviewListHtml, rlStatsHtml: rlStatsHtml, channelsHtml: channelsHtml,
    // 出典カード（補足の「根拠と出典」）
    sourceCardsOf: sourceCardsOf, claimsBySource: claimsBySource, accessedText: accessedText, shortUrl: shortUrl,
    // 子どもの画面
    inlineMd: inlineMd, mdBlocks: mdBlocks, pickVariant: pickVariant, previewBodyHtml: previewBodyHtml, previewFrameHtml: previewFrameHtml, kindName: kindName,
    defaultPv: defaultPv,
    // 付箋
    figClaimsHtml: figClaimsHtml, figsBlockHtml: figsBlockHtml, models3dTermsHtml: models3dTermsHtml,
    stickyLine: stickyLine, stickyNoteText: stickyNoteText, stickyListHtml: stickyListHtml, STICK_KINDS: STICK_KINDS, appendLines: appendLines,
    STICK_FIG_KINDS: STICK_FIG_KINDS, STICK_APP_KINDS: STICK_APP_KINDS, STICK_VIDEO_KINDS: STICK_VIDEO_KINDS,
    noteWithoutStickyLines: noteWithoutStickyLines, decisionNote: decisionNote, inInputOf: inInputOf, claimParaSelectors: claimParaSelectors, stickyKeyAction: stickyKeyAction, stripCites: stripCites
  };

  // ---- 画面: 改善係の記録（振り返り係 §S-5 5。画面での名前は「改善係」）----
  // LLM が書いた文（summary・evidence・text・reason）は必ず esc() して出す
  var RETRO_WASTE_LABEL = {
    failed_fetch: '開けないページの試し直し', repeated_fetch: '同じページの取り直し', long_context: '長い文脈', many_requests: 'やり取りの回数が多い',
    outcome_retry: '採点のやり直し', image_redo: '画像の描き直し', rework_refetch: '作り直しでの取り直し', rework_round: '作り直しの回数', other: 'その他'
  };
  var RETRO_TARGET_LABEL = { maker_note: '職人への注意書き', maker_definition: '職人の定義', worker_code: 'Worker（工場のプログラム）', order: '注文の出し方' };
  var RETRO_STATUS_LABEL = { collecting: '集計中', ready: '送信待ち', submitted: '結果待ち', ended: '完了', failed: '失敗', skipped: '上限で飛ばした' };
  var RETRO_TIP_STATUS = { active: ['入っている', 'green'], proposed: ['提案中', 'yellow'], retired: ['やめた', 'gray'], rejected: ['見送った', 'gray'] };
  function retroCents(c) { return c === null || c === undefined ? '—' : '$' + (Number(c) / 100).toFixed(2); }
  function retroPct(r) { return r === null || r === undefined ? '—' : (Math.round(Number(r) * 1000) / 10) + '%'; }
  function retroWho(t) { return t && t.decided_by === 'human' ? '人' : '自動'; }

  /** 数字の比較（直近 10 件とその前 10 件）。足りない時は「まだ比べられません（あと n 件）」 */
  function retroCompareHtml(cmp) {
    cmp = cmp || {};
    var w = Number(cmp.window || 10), a = cmp.recent || {}, b = cmp.previous || {};
    var na = Number(a.n || 0), nb = Number(b.n || 0);
    var head = '<h2>数字の比較</h2><p class="muted">1 注文あたりの費用と、検証で「未確認 + 食い違い」になった主張の割合を並べます（費用が下がっても、割合が上がっていれば質が落ちています）。</p>';
    if (na < w || nb < w) {
      return '<div class="card" data-retro-compare="short">' + head + '<p><b>まだ比べられません（あと ' + esc(Math.max(1, 2 * w - na - nb)) + ' 件）</b></p>' +
        (na ? '<p class="muted">直近 ' + esc(na) + ' 件: 費用 ' + esc(retroCents(a.avg_cost_cents)) + '・未確認 + 食い違い ' + esc(retroPct(a.avg_bad_ratio)) + '</p>' : '') + '</div>';
    }
    function costDiff() {
      if (a.avg_cost_cents === null || b.avg_cost_cents === null || !Number(b.avg_cost_cents)) return '—';
      var p = Math.round((Number(a.avg_cost_cents) / Number(b.avg_cost_cents) - 1) * 100);
      return p < 0 ? pill(Math.abs(p) + '% 下がった', 'green') : p > 0 ? pill(p + '% 上がった', 'orange') : pill('変わらない', 'gray');
    }
    function ratioDiff() {
      if (a.avg_bad_ratio === null || b.avg_bad_ratio === null) return '—';
      var d = Math.round((Number(a.avg_bad_ratio) - Number(b.avg_bad_ratio)) * 1000) / 10;
      return d > 0 ? pill(d + ' ポイント増えた（質に注意）', 'red') : d < 0 ? pill(Math.abs(d) + ' ポイント減った', 'green') : pill('変わらない', 'gray');
    }
    return '<div class="card" data-retro-compare="ok">' + head + '<div class="table-wrap"><table class="retro-cmp"><thead><tr><th scope="col"></th><th scope="col">その前 ' + esc(w) + ' 件</th><th scope="col">直近 ' + esc(w) + ' 件</th><th scope="col">変化</th></tr></thead><tbody>' +
      '<tr><th scope="row">1 注文の費用</th><td>' + esc(retroCents(b.avg_cost_cents)) + '</td><td>' + esc(retroCents(a.avg_cost_cents)) + '</td><td>' + costDiff() + '</td></tr>' +
      '<tr><th scope="row">未確認 + 食い違い</th><td>' + esc(retroPct(b.avg_bad_ratio)) + '</td><td>' + esc(retroPct(a.avg_bad_ratio)) + '</td><td>' + ratioDiff() + '</td></tr>' +
      '</tbody></table></div></div>';
  }

  /** 工夫ごとの前後の数字（下書きの注文だけ。入れる前に始まった w 件と、入れた後に始まった w 件。§S v2 D 3） */
  function retroEffectHtml(eff) {
    if (!eff) return '';
    var w = Number(eff.window || 5), b = eff.before || {}, a = eff.after || {};
    var nb = Number(b.n || 0), na = Number(a.n || 0);
    if (nb < w || na < w) {
      return '<p class="muted retro-meta" data-retro-effect="short">前後の数字: まだ比べられません（入れる前 ' + esc(nb) + ' 件・入れた後 ' + esc(na) + ' 件。それぞれ ' + esc(w) + ' 件で比べます）</p>';
    }
    return '<p class="retro-meta" data-retro-effect="ok">前後の数字（下書きの注文 ' + esc(w) + ' 件ずつ）: 入れる前 費用 ' + esc(retroCents(b.avg_cost_cents)) + '・未確認 + 食い違い ' + esc(retroPct(b.avg_bad_ratio)) +
      ' → 入れた後 費用 ' + esc(retroCents(a.avg_cost_cents)) + '・未確認 + 食い違い ' + esc(retroPct(a.avg_bad_ratio)) + '</p>';
  }
  function retroActiveItemHtml(t) {
    return '<li class="retro-item" data-retro-tip="' + esc(t.id) + '"><p class="retro-text">' + esc(t.text) + '</p>' +
      '<p class="muted retro-meta">' + esc(fmtTime(t.activated_at)) + ' に入れた・' + esc(retroWho(t)) + '・入れた後に始まって終わった下書きの注文 ' + esc(Number(t.jobs_since || 0)) + ' 件' +
      (t.target !== 'maker_note' ? '・' + esc(RETRO_TARGET_LABEL[t.target] || t.target) : '') + '</p>' + retroEffectHtml(t.effect) +
      (t.retire_suggested ? '<p class="retro-warn" data-retro-suggest="1">改善係から「やめる提案」: ' + esc(t.retire_suggested.reason) + '（やめるかどうかは人が決めます）</p>' : '') +
      '<div class="row end"><button type="button" class="btn small" data-retro-act="retire" data-retro-id="' + esc(t.id) + '">やめる</button></div></li>';
  }
  /** いま職人に渡している工夫（active の maker_note）と、人が対応した印（maker_note 以外の active） */
  function retroActiveHtml(tips, limit) {
    var list = (tips && tips.active) || [];
    var notes = list.filter(function (t) { return t.target === 'maker_note'; });
    var others = list.filter(function (t) { return t.target !== 'maker_note'; });
    return '<div class="card" data-retro-active="' + notes.length + '"><h2>いま職人に渡している工夫 <span class="muted">' + esc(notes.length) + ' / ' + esc(limit || 8) + ' 件</span></h2>' +
      (notes.length ? '<ul class="retro-list">' + notes.map(retroActiveItemHtml).join('') + '</ul>' : '<p class="muted">いまは渡している工夫はありません</p>') +
      (others.length ? '<h3>人が対応した提案（職人へは渡りません）</h3><ul class="retro-list">' + others.map(retroActiveItemHtml).join('') + '</ul>' : '') + '</div>';
  }

  /** 差し戻しの観点キー → 画面の言葉（確認のチェックリストと同じ） */
  function retroNgText(keys) {
    keys = Array.isArray(keys) ? keys : [];
    if (!keys.length) return '—';
    return keys.map(function (k) {
      if (k === 'unclassified') return '観点の記録なし';
      for (var i = 0; i < CHECKLIST.length; i++) if (CHECKLIST[i][0] === k) return CHECKLIST[i][1];
      return 'その他';
    }).join('・');
  }
  /** 観点キー → 画面の言葉（return_themes の other は「その他」） */
  function retroNgLabel(k) {
    for (var i = 0; i < CHECKLIST.length; i++) if (CHECKLIST[i][0] === k) return CHECKLIST[i][1];
    return 'その他';
  }
  /**
   * 最新の差し戻しの観点の欄（§S v2 追加 A）。チェックリストに ng があればそれを出し、
   * 無い時（unclassified）は改善係が理由の文を観点に分けたもの（ai_return_themes）を「AI が読んだ観点」として出す。evidence は LLM の文なので esc()
   */
  function retroLedgerNgHtml(r) {
    var keys = Array.isArray(r.latest_return_ng) ? r.latest_return_ng : [];
    var themes = Array.isArray(r.ai_return_themes) ? r.ai_return_themes : [];
    if (keys.length === 1 && keys[0] === 'unclassified' && themes.length) {
      return '<span data-retro-ai-themes="' + esc(themes.length) + '"><span class="muted">AI が読んだ観点:</span> ' +
        themes.map(function (t) {
          return esc(retroNgLabel(t.key)) + ' ' + esc(Number(t.count || 0)) + ' 件' + (t.evidence ? ' <span class="muted">（' + esc(t.evidence) + '）</span>' : '');
        }).join('・') + '</span>';
    }
    return esc(retroNgText(keys));
  }
  var RETRO_VERSION_STATUS ={ review: ['確認待ち', 'yellow'], approved: ['承認済み', 'green'], rejected: ['差し戻し・却下', 'gray'] };
  /** 作り直しの台帳（§S v2 A）。教材ごとに作った回数・作り直し・費用・差し戻し・承認。費用の多い行に印を付ける */
  function retroLedgerHtml(rows) {
    rows = Array.isArray(rows) ? rows : [];
    var head = '<h2>作り直しの台帳</h2><p class="muted">教材ごとに、承認されるまでに作った回数と費用です（新しい順）。費用の多い行に印を付けています。教材の名前を押すと、その教材の画面を開きます。差し戻しのチェックリストに観点の記録が無い時は、改善係が理由の文から読んだ観点（AI が読んだ観点）を出します。</p>';
    if (!rows.length) return '<div class="card" data-retro-ledger="0">' + head + '<p class="muted" data-retro-ledger-empty="1">まだ注文はありません。注文が終わると、ここに教材ごとの回数と費用が出ます</p></div>';
    var costs = rows.map(function (r) { return Number(r.list_cost_cents || 0); });
    var avg = costs.reduce(function (s, c) { return s + c; }, 0) / costs.length;
    var sorted = costs.slice().sort(function (x, y) { return y - x; });
    var third = sorted[Math.min(2, sorted.length - 1)];
    var body = rows.map(function (r) {
      var c = Number(r.list_cost_cents || 0);
      var hot = c > 0 && c > avg && c >= third;
      var vs = RETRO_VERSION_STATUS[r.latest_version_status];
      var ret = Number(r.returns || 0), auto = Number(r.auto_returns || 0);
      return '<tr data-retro-ledger-row="' + esc(r.material_id) + '"' + (hot ? ' data-hot="1" class="retro-hot"' : '') + '>' +
        '<th scope="row"><a href="#/material/' + encodeURIComponent(r.material_id) + '">' + esc(r.title || '（題なし）') + '</a>' +
        (vs ? ' ' + pill(vs[0], vs[1]) : '') + (hot ? ' ' + pill('費用が多い', 'orange') : '') + '</th>' +
        '<td>' + esc(Number(r.jobs || 0)) + ' 回</td>' +
        '<td>' + esc(Number(r.reworks || 0)) + ' 回</td>' +
        '<td>' + (hot ? '<b>' + esc(retroCents(c)) + '</b>' : esc(retroCents(c))) + '</td>' +
        '<td>' + esc(ret) + ' 回' + (auto ? ' <span class="muted">（うち自動 ' + esc(auto) + '）</span>' : '') + '</td>' +
        '<td>' + esc(Number(r.approves || 0)) + ' 回</td>' +
        '<td>' + retroLedgerNgHtml(r) + '</td></tr>';
    }).join('');
    return '<div class="card" data-retro-ledger="' + rows.length + '">' + head + '<div class="table-wrap"><table class="retro-ledger"><thead><tr>' +
      '<th scope="col">教材</th><th scope="col">作った回数</th><th scope="col">作り直し</th><th scope="col">費用</th><th scope="col">差し戻し</th><th scope="col">承認</th><th scope="col">最新の差し戻しの観点</th>' +
      '</tr></thead><tbody>' + body + '</tbody></table></div></div>';
  }

  function retroWastesHtml(ws) {
    ws = Array.isArray(ws) ? ws : [];
    if (!ws.length) return '';
    return '<ul class="retro-wastes">' + ws.map(function (w) {
      return '<li>' + pill(RETRO_WASTE_LABEL[w.kind] || 'その他', 'orange') + ' ' + esc(w.evidence) + (Number(w.est_cents) > 0 ? ' <span class="muted">（見込み ' + esc(retroCents(w.est_cents)) + '）</span>' : '') + '</li>';
    }).join('') + '</ul>';
  }
  /** できごとの記録の 1 件 */
  function retroEventHtml(e) {
    var at = '<time class="muted retro-at">' + esc(fmtTime(e.at)) + '</time>';
    var from = e.material_title ? '<span class="muted">「' + esc(e.material_title) + '」の振り返りから</span>' : '';
    var saving = Number(e.expected_saving_cents) > 0 ? '<span class="muted">見込みの節約 ' + esc(retroCents(e.expected_saving_cents)) + ' / 注文</span>' : '';
    if (e.type === 'retro') {
      return '<li class="retro-ev" data-retro-ev="retro">' + at + '<p><b>振り返り</b> ' + esc(e.material_title || '（題なし）') +
        ' <span class="muted">注文の費用 ' + esc(retroCents(e.list_cost_cents)) + '・振り返りの費用 ' + esc(retroCents(e.cents)) + (Number(e.tips_added) > 0 ? '・工夫 ' + esc(e.tips_added) + ' 件' : '') + '</span></p>' +
        (e.summary ? '<p class="retro-text">' + esc(e.summary) + '</p>' : '') + retroWastesHtml(e.wastes) + '</li>';
    }
    var text = '<p class="retro-text">' + esc(e.text) + '</p>';
    if (e.type === 'activated') {
      return '<li class="retro-ev" data-retro-ev="activated">' + at + '<p>' + pill('工夫を入れた', 'green') + ' ' + esc(retroWho(e)) + (e.target !== 'maker_note' ? '・' + esc(RETRO_TARGET_LABEL[e.target] || e.target) : '') + '</p>' + text +
        '<p class="retro-meta">' + from + ' ' + saving + '</p>' + (e.reason ? '<p class="muted">理由: ' + esc(e.reason) + '</p>' : '') + '</li>';
    }
    if (e.type === 'retired') {
      return '<li class="retro-ev" data-retro-ev="retired">' + at + '<p>' + pill('工夫をやめた', 'gray') + '</p>' + text +
        '<p class="muted">理由: ' + esc(e.retire_reason === 'human' ? '人がやめました' : e.retire_reason === 'ops:factory_fault' ? '工場の不具合で起きた失敗から出た工夫だったので、司令塔がやめました' : e.retire_reason || '—') + '</p></li>';
    }
    if (e.type === 'rejected') {
      return '<li class="retro-ev" data-retro-ev="rejected">' + at + '<p>' + pill('提案を見送った', 'gray') + ' ' + esc(RETRO_TARGET_LABEL[e.target] || e.target) + '</p>' + text + '</li>';
    }
    // proposed: 人が対応するもの（職人の定義・Worker・注文の出し方）と、自動では入れなかった注意書き
    var stl = RETRO_TIP_STATUS[e.status] || [e.status, 'gray'];
    var ops = e.status === 'proposed'
      ? '<div class="row end"><button type="button" class="btn small primary" data-retro-act="activate" data-retro-id="' + esc(e.tip_id) + '">入れる</button>' +
        '<button type="button" class="btn small" data-retro-act="reject" data-retro-id="' + esc(e.tip_id) + '">見送る</button></div>'
      : '';
    return '<li class="retro-ev" data-retro-ev="proposed">' + at + '<p>' + pill('提案', 'yellow') + ' ' + esc(RETRO_TARGET_LABEL[e.target] || e.target) + ' ' + pill(stl[0], stl[1]) +
      (e.quality_risk && e.quality_risk !== 'none' ? ' ' + pill('質に触れうる（' + (e.quality_risk === 'medium' ? '中' : '小') + '）', 'red') : '') + '</p>' + text +
      (e.auto_blocked ? '<p class="retro-warn" data-retro-blocked="1">自動では入れませんでした（質に触れる言い回し）</p>' : '') +
      '<p class="retro-meta">' + from + ' ' + saving + '</p>' + (e.reason ? '<p class="muted">理由: ' + esc(e.reason) + '</p>' : '') + ops + '</li>';
  }
  function retroRecentHtml(rs) {
    rs = Array.isArray(rs) ? rs : [];
    if (!rs.length) return '';
    return '<details class="card retro-recent"><summary>直近の振り返り（' + esc(rs.length) + ' 件の状態）</summary><ul class="retro-list">' + rs.map(function (r) {
      var cls = r.status === 'ended' ? 'green' : r.status === 'failed' ? 'red' : r.status === 'skipped' ? 'gray' : 'yellow';
      return '<li>' + '<time class="muted">' + esc(fmtTime(r.updated_at)) + '</time> ' + esc(r.material_title || '（題なし）') + ' ' + pill(RETRO_STATUS_LABEL[r.status] || r.status, cls) +
        (r.last_error ? ' <span class="muted">' + esc(r.last_error) + '</span>' : '') + '</li>';
    }).join('') + '</ul></details>';
  }
  /** #/retro の本体（GET /api/retro の応答から描く純関数） */
  function retroHtml(d) {
    d = d || {};
    var st = d.settings || {};
    var tips = d.tips || {};
    var events = Array.isArray(d.events) ? d.events : [];
    var nTips = ['active', 'proposed', 'retired', 'rejected'].reduce(function (n, k) { return n + ((tips[k] || []).length); }, 0);
    var intro = '<p class="muted">終わった注文ごとに費用を振り返り、質を下げずに費用を下げる「工夫」を職人に渡します。今月の振り返りの費用 ' + esc(retroCents(st.month_cents)) + ' / ' + esc(retroCents(st.month_cap_cents)) +
      '・' + (st.auto_adopt === false ? '工夫は自動では入れません（提案だけ）' : '質に触れない注意書きは自動で入れます') + '・工夫をやめるかどうかは人が決めます' + (st.enabled === false ? '・' + '<b>いまは止めています</b>' : '') + '</p>';
    var ledger = Array.isArray(d.rework_ledger) ? d.rework_ledger : [];
    if (!(d.retros || []).length && !nTips && !ledger.length) {
      return '<h1>改善係の記録</h1>' + intro + '<div class="card" data-retro-empty="1"><p>まだ振り返りはありません。注文が終わると、ここに記録が出ます</p></div>';
    }
    return '<h1>改善係の記録</h1>' + intro + retroLedgerHtml(ledger) + retroCompareHtml(d.compare) + retroActiveHtml(tips, st.active_maker_note_limit) +
      '<div class="card"><h2>できごとの記録</h2>' + (events.length ? '<ul class="retro-events">' + events.map(retroEventHtml).join('') + '</ul>' : '<p class="muted">まだありません</p>') + '</div>' +
      retroRecentHtml(d.retros);
  }
  function viewRetro(view) {
    view.innerHTML = '<h1>改善係の記録</h1><p class="loading" data-retro-loading="1">読み込み中…</p>';
    var here = location.hash;
    api('GET', '/api/retro').then(function (d) {
      if (location.hash !== here) return; // 読み込み中に別の画面へ移った
      view.innerHTML = retroHtml(d);
      var texts = {};
      ['active', 'proposed', 'retired', 'rejected'].forEach(function (k) { ((d.tips || {})[k] || []).forEach(function (t) { texts[t.id] = t; }); });
      (d.events || []).forEach(function (e) { if (e.tip_id && !texts[e.tip_id]) texts[e.tip_id] = { id: e.tip_id, text: e.text, target: e.target }; });
      Array.prototype.forEach.call(view.querySelectorAll('[data-retro-act]'), function (btn) {
        btn.addEventListener('click', function () {
          if (btn.disabled) return; // 二重押し（action が実行中は disabled にする）
          var act = btn.getAttribute('data-retro-act'), id = btn.getAttribute('data-retro-id');
          var t = texts[id] || { text: '' };
          var o = act === 'activate'
            ? { title: '工夫を入れます', okText: '入れる', success: '入れました',
                body: (t.target === 'maker_note' ? '次の注文から、職人への最初の文に入ります。' : '「人が対応した」の印を付けます（職人へは渡りません）。') + '\n\n' + t.text }
            : act === 'reject'
              ? { title: '提案を見送ります', okText: '見送る', success: '見送りました', body: t.text }
              : { title: '工夫をやめます', okText: 'やめる', success: 'やめました', body: '次の注文から、職人へは渡しません。\n\n' + t.text };
          o.busyText = '処理中…';
          o.run = function () { return api('POST', '/api/retro/tips/' + encodeURIComponent(id), { action: act }); };
          o.fail = function () { route(); };
          action(btn, o);
        });
      });
    }, function (e) {
      if (location.hash !== here) return;
      view.innerHTML = '<h1>改善係の記録</h1><div class="card" data-retro-error="1"><p class="err">読み込めませんでした: ' + esc(e.message) + '</p><p><button type="button" class="btn" id="retro-retry">もう一度読み込む</button></p></div>';
      var b = $('#retro-retry');
      if (b) b.addEventListener('click', route);
    });
  }
  window.FactoryAdminOrders = { machineOrderFactHtml: machineOrderFactHtml, jobHtml: jobHtml };
  window.FactoryAdminRetro = { WASTE_LABEL: RETRO_WASTE_LABEL, retroHtml: retroHtml, retroCompareHtml: retroCompareHtml, retroEventHtml: retroEventHtml, retroLedgerHtml: retroLedgerHtml, retroEffectHtml: retroEffectHtml };

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
    document.body.classList.remove('review-wide');
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
    if (p[0] === 'models3d') return viewModels3d(view);
    if (p[0] === 'retro') return viewRetro(view);
    // §T-11 お題の棚（topics.js。タブの解釈・描画・遅れた応答の破棄は topics.js 側）
    if (p[0] === 'topics' && window.FactoryTopics) return window.FactoryTopics.mount(view, { api: api, toast: toast, confirm: confirmDialog });
    view.innerHTML = '<p class="muted">ページが見つかりません。<a href="#/materials">素材へ</a></p>';
  }
  // §AJ2-3・§AK-5: 立体モデルのページ（権利の列・操作の文）と子どもの画面の自前の表示の純関数（テストから呼ぶ。画面の動作には使わない）
  window.FactoryAdminModels3d = {
    MODEL3D_FILE_URL_RE: MODEL3D_FILE_URL_RE, model3dPreviewHtml: model3dPreviewHtml, model3dViewerHtml: model3dViewerHtml,
    models3dPageHtml: models3dPageHtml, models3dLoadingHtml: models3dLoadingHtml, models3dErrorHtml: models3dErrorHtml,
    model3dStateText: model3dStateText, model3dImportErrorText: model3dImportErrorText,
    rightsFailText: rightsFailText, rightsKindText: rightsKindText, rightsStateText: rightsStateText, rightsCellHtml: rightsCellHtml,
    rightsReasonText: rightsReasonText, rightsStatusText: rightsStatusText, rightsDateText: rightsDateText, rightsCheckToast: rightsCheckToast,
    rightsUnblockBody: rightsUnblockBody, model3dRightsLineHtml: model3dRightsLineHtml, model3dBlockedText: model3dBlockedText,
    M3D_CHECK_BODY: M3D_CHECK_BODY, M3D_BLOCK_BODY: M3D_BLOCK_BODY
  };
  // 状況帯（上部）の純関数（テストから呼ぶ）
  window.FactoryAdminStatus = {
    CRON_LATE_MIN: CRON_LATE_MIN, CRON_STALE_MIN: CRON_STALE_MIN, cronAge: cronAge, capLevel: capLevel, fmtCap: fmtCap, costMeterHtml: costMeterHtml,
    STATUS_CARDS: STATUS_CARDS, statusAlerts: statusAlerts, statusBandHtml: statusBandHtml
  };
  window.FactoryAdminVideos = { videosBandHtml: videosBandHtml, videosAdminHtml: videosAdminHtml, videosLoadingHtml: videosLoadingHtml, videosErrorHtml: videosErrorHtml };
  window.FactoryAdminImages = {
    HALT_TEXT: HALT_TEXT, haltText: haltText, imagesBandHtml: imagesBandHtml, imagesMonthHtml: imagesMonthHtml, imagesAlertHtml: imagesAlertHtml, imagesHtml: imagesHtml,
    imagesLoadingHtml: imagesLoadingHtml, imagesErrorHtml: imagesErrorHtml, genCaption: genCaption
  };
  if (window.__FACTORY_ADMIN_NO_BOOT__) return; // smoke が純関数だけを読む時
  window.addEventListener('hashchange', route);
  window.addEventListener('resize', function () { if (reviewCtx) measureReviewChrome(); });
  document.addEventListener('keydown', onReviewKey);
  document.addEventListener('visibilitychange', onFloorVisibility);
  route();
})();
