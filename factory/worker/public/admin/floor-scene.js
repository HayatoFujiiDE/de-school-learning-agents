/* 工場の場面（契約 §N-6）。ブラウザ（window.FactoryFloorScene）と node（module.exports）の両方で読める UMD・ES2017・I/O なし。
 * - SCENE: 背景画像（1706 × 600）に重ねる座標（§N-6-8 の表をそのまま）
 * - stationStates(floor): 持ち場の状態（§N-6-2 の判定表。上から最初に当たったもの）
 * - rowStations(row): 制作キューの行がどの持ち場にいるか（§N-6-4）
 * 描画（DOM）は admin.js が持つ。ここは純関数と定数だけ。 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else if (root) root.FactoryFloorScene = api;
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  /** キャラ画像の拡張子（'svg' | 'png'）。ここ 1 か所で切り替える。svg は inline 化して部位（.ch-body 等）を動かし、png は <img> 全体を揺らす */
  var CHAR_EXT = 'svg';

  var DAY_MS = 24 * 60 * 60 * 1000;
  var ACTIVE_JOB_STATUSES = ['queued', 'creating', 'running', 'needs_answer', 'budget_reached'];

  /**
   * 座標（§N-6-8）。単位は背景画像の px（1706 × 600）。HTML 要素は x / 1706・y / 600 の % で置く。
   * chars: anchor = 足元（机に接する点）、size = 表示枠の 1 辺。枠の下辺中央を anchor から size × 0.08 下に置く。
   *        footX = 画像の中で足元がある横位置（0〜1、既定 0.5。足元が中央に無い画像のため）
   * tag: 上の名札の中心（本線 5 つだけ）。pill: 状態札の位置（札は 1 行。上端寄りを合わせる: translate(-50%, -20%)）
   * hit: クリック範囲の楕円（anchor 中心の幅 × 高さ。選択中の光もこの中心・この幅の 2:1 楕円）
   * branch: 名札を持たず、待機中は札そのものに名前を出す持ち場。back: 動いている時だけ札の 2 行目に「↩ 職人へ」
   */
  var SCENE = {
    width: 1706,
    height: 600,
    charDrop: 0.08,
    stations: [
      { id: 'intake', name: '入口', icon: 'book', tag: [195, 117], pill: [210, 360], hit: [240, 170],
        chars: [{ id: 'scout', anchor: [150, 290], size: 150 }, { id: 'sprout', anchor: [300, 318], size: 145 }] },
      { id: 'maker', name: '職人', icon: 'pencil', tag: [470, 113], pill: [530, 330], hit: [240, 170],
        chars: [{ id: 'beret', anchor: [470, 292], size: 150 }] },
      { id: 'clerk', name: '受付', icon: 'list', tag: [765, 110], pill: [785, 310], hit: [240, 170],
        chars: [{ id: 'star', anchor: [745, 282], size: 150 }] },
      { id: 'verifier', name: '検証係', icon: 'search', tag: [1045, 110], pill: [1055, 310], hit: [240, 170],
        chars: [{ id: 'robot', anchor: [990, 288], size: 150 }] },
      { id: 'reviewer', name: '確認する人', icon: 'check', tag: [1320, 115], pill: [1345, 367], hit: [240, 170],
        chars: [{ id: 'glasses', anchor: [1290, 342], size: 150 }] },
      { id: 'rework', name: '作り直しへ', filterName: '作り直し', icon: 'bubble', pill: [1597, 245], hit: [200, 150], branch: true, back: true, bubble: [1605, 105],
        chars: [{ id: 'chick', anchor: [1530, 192], size: 130 }] },
      { id: 'library', name: '倉庫', icon: 'box', pill: [1580, 468], hit: [200, 150], branch: true,
        chars: [{ id: 'sun', anchor: [1532, 428], size: 130 }] },
      { id: 'meeting', name: '会議', icon: null, pill: [562, 512], hit: [200, 150], branch: true,
        chars: [{ id: 'cat', anchor: [472, 478], size: 130 }] },
      { id: 'questions', name: '質問', icon: null, pill: [948, 502], hit: [200, 150], branch: true,
        chars: [{ id: 'sprout-b', anchor: [882, 482], size: 130 }] },
      { id: 'autofix', name: '自動の作り直し', icon: null, pill: [1245, 504], hit: [200, 150], branch: true, back: true,
        chars: [{ id: 'ghost', anchor: [1172, 488], size: 130 }] },
      // 改善係（振り返り係 §S）: 自動の作り直しと倉庫の間の、机の無い床。見回り役なので机は無い。矢印は無い。押すと「改善係の記録」への入口を出す。
      // 札は指定の [1445, 530] から少し右下へ（自動の作り直しが「作り直し中 N・↩ 職人へ」の時の札と重ならないように）
      // 改善係は机の無い見回り役。確認する人の札（確認待ち n・要確認 n は横に長い）に頭が隠れない高さに立たせ、札は右横（倉庫の机の下の床）に出す
      { id: 'retro', name: '改善係', icon: null, pill: [1478, 513], hit: [200, 150], branch: true,
        chars: [{ id: 'owl', anchor: [1368, 506], size: 124 }] }
    ],
    // 矢印（すべて 3 次ベジェ。c1 / c2 は参考画像の曲がり方に合わせた制御点）。to = 流れ先の持ち場（そこが動いている・人の番なら流れる）
    arrows: [
      { id: 'intake-maker', to: 'maker', dashed: false, from: [355, 300], c1: [374, 284], c2: [390, 282], end: [410, 288] },
      { id: 'intake-meeting', to: 'meeting', dashed: false, from: [330, 352], c1: [384, 352], c2: [356, 410], end: [412, 410] },
      { id: 'maker-clerk', to: 'clerk', dashed: false, from: [622, 268], c1: [639, 268], c2: [655, 268], end: [672, 268] },
      // 背景の灰色の円柱（約 657, 415）の下を通す
      { id: 'maker-questions', to: 'questions', dashed: false, from: [600, 345], c1: [595, 492], c2: [690, 486], end: [835, 448] },
      { id: 'questions-maker', to: 'maker', dashed: true, from: [860, 430], c1: [846, 372], c2: [720, 352], end: [640, 352] },
      { id: 'clerk-verifier', to: 'verifier', dashed: false, from: [880, 266], c1: [896, 266], c2: [912, 266], end: [928, 266] },
      { id: 'verifier-autofix', to: 'autofix', dashed: true, from: [1088, 342], c1: [1086, 420], c2: [1092, 445], end: [1120, 445] },
      { id: 'verifier-reviewer', to: 'reviewer', dashed: false, from: [1172, 300], c1: [1186, 300], c2: [1200, 302], end: [1215, 306] },
      // 終点は札（作り直し）・sun の光の手前で止める（矢じりが隠れないように）
      { id: 'reviewer-rework', to: 'rework', dashed: false, from: [1410, 296], c1: [1426, 278], c2: [1420, 220], end: [1468, 206] },
      { id: 'reviewer-library', to: 'library', dashed: false, from: [1410, 302], c1: [1452, 302], c2: [1436, 374], end: [1468, 384] }
    ]
  };

  // ---- キャラ SVG の無害化（許可リスト）。admin.js が DOMParser の結果をこの規則で削る ----
  /** 残してよい要素（それ以外は中身ごと削除） */
  var CHAR_SVG_ELEMENTS = ['svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon'];
  /** 残してよい属性（大文字小文字は区別。style・href・on* などは一切残さない） */
  var CHAR_SVG_ATTRS = ['d', 'points', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'viewBox', 'transform',
    'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'opacity', 'fill-opacity', 'stroke-opacity', 'fill-rule', 'class'];
  var PAINT_RE = /^(#[0-9a-fA-F]{3,8}|none|currentColor|[a-zA-Z]{1,20})$/;
  /** 要素名（localName）を残してよいか */
  function charSvgElementAllowed(localName) {
    return CHAR_SVG_ELEMENTS.indexOf(String(localName)) >= 0;
  }
  /** 属性を残してよいか。fill / stroke は色の書き方だけ。transform / d / points 以外で url・\・( を含む値は捨てる */
  function charSvgAttrAllowed(name, value) {
    name = String(name);
    value = String(value);
    if (CHAR_SVG_ATTRS.indexOf(name) < 0) return false;
    if (name === 'fill' || name === 'stroke') return PAINT_RE.test(value.trim());
    if (name !== 'transform' && name !== 'd' && name !== 'points' && /url|\\|\(/i.test(value)) return false;
    return true;
  }

  function num(x) {
    var n = Number(x);
    return isFinite(n) ? n : 0;
  }
  function stepOf(row, key) {
    var steps = (row && row.steps) || [];
    for (var i = 0; i < steps.length; i++) if (steps[i] && steps[i].key === key) return steps[i];
    return null;
  }
  /** queue のうち、工程 key の state が state の行の数 */
  function countStep(queue, key, state) {
    var n = 0;
    for (var i = 0; i < queue.length; i++) {
      var s = stepOf(queue[i], key);
      if (s && s.state === state) n++;
    }
    return n;
  }
  function st(kind, text, extra) {
    var o = { kind: kind, text: text };
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k) && extra[k] !== undefined) o[k] = extra[k];
    return o;
  }
  function idle() { return { kind: 'idle', text: '待機' }; }
  function clampPct(x) { return Math.max(0, Math.min(100, Math.round(x))); }

  /**
   * 持ち場の状態（§N-6-2）。floor = GET /api/floor の応答。
   * 戻り値: 持ち場 id → { kind: 'moving'|'human'|'done'|'failed'|'idle', text, text2?, bar?, spin? }
   *   bar = 札の下の細い進捗（0〜100）。spin = false の時はリングを回さない（検証の順番待ち）
   */
  function stationStates(floor) {
    var d = floor || {};
    var s = d.stations || {};
    var q = Array.isArray(d.queue) ? d.queue : [];
    var it = s.intake || {}, mk = s.maker || {}, ck = s.clerk || {}, vf = s.verifier || {}, rv = s.reviewer || {}, lb = s.library || {}, rw = s.rework || {};
    var rt = s.retro || {};
    var nowMs = Date.parse(d.now);
    if (!isFinite(nowMs)) nowMs = Date.now();
    var out = {};

    // intake
    if (it.scout_running) out.intake = st('moving', '収集中');
    else if (num(it.proposed) > 0) out.intake = st('done', '提案 ' + num(it.proposed) + ' 件');
    else out.intake = idle();

    // meeting
    var lastMeeting = it.last_meeting_at ? Date.parse(it.last_meeting_at) : NaN;
    if (it.meeting_pending) out.meeting = st('moving', '会議中（結果待ち）');
    else if (isFinite(lastMeeting) && nowMs - lastMeeting <= DAY_MS) out.meeting = st('done', '会議 完了');
    else out.meeting = idle();

    // maker
    var making = countStep(q, 'making', 'active');
    var maxC = num(mk.max_concurrent);
    if (making > 0) out.maker = st('moving', '制作中 ' + making, { bar: maxC > 0 ? clampPct((making / maxC) * 100) : undefined });
    else if (num(mk.budget_reached) > 0) out.maker = st('human', '予算の上限 ' + num(mk.budget_reached));
    else if (num(mk.creating) > 0) out.maker = st('moving', '準備中 ' + num(mk.creating));
    else if (countStep(q, 'making', 'failed') > 0) out.maker = st('failed', '失敗 ' + countStep(q, 'making', 'failed'));
    else out.maker = idle();

    // questions
    if (num(mk.needs_answer) > 0) out.questions = st('human', '回答待ち ' + num(mk.needs_answer));
    else if (countStep(q, 'questions', 'active') > 0) out.questions = st('moving', '質問を考え中');
    else out.questions = idle();

    // clerk
    if (num(ck.ingesting) > 0) out.clerk = st('moving', '取り込み中 ' + num(ck.ingesting));
    else if (num(ck.failed_invalid_outputs) > 0) out.clerk = st('failed', '取り込み失敗 ' + num(ck.failed_invalid_outputs));
    else out.clerk = idle();

    // verifier: バーは verify が active の行の progress の平均を 70〜84 → 0〜100% に換算
    if (num(vf.running) > 0) {
      var sum = 0, n = 0;
      for (var i = 0; i < q.length; i++) {
        var v = stepOf(q[i], 'verify');
        if (v && v.state === 'active') { sum += num(q[i].progress_pct); n++; }
      }
      out.verifier = st('moving', '検証中 ' + num(vf.running), { bar: n > 0 ? clampPct(((sum / n - 70) / 14) * 100) : undefined });
    } else if (num(vf.pending) > 0) out.verifier = st('moving', '順番待ち ' + num(vf.pending), { spin: false });
    else if (num(vf.failed) > 0) out.verifier = st('failed', '検証失敗 ' + num(vf.failed));
    else out.verifier = idle();

    // autofix
    if (num(rw.auto_active) > 0) out.autofix = st('moving', '作り直し中 ' + num(rw.auto_active));
    else out.autofix = idle();

    // reviewer
    if (num(rv.waiting) > 0) out.reviewer = st('human', '確認待ち ' + num(rv.waiting), { text2: num(rv.needs_review_total) > 0 ? '要確認 ' + num(rv.needs_review_total) : undefined });
    else out.reviewer = idle();

    // rework
    if (num(rw.manual_active) > 0) out.rework = st('moving', '作り直し ' + num(rw.manual_active));
    else out.rework = idle();

    // library
    if (num(lb.available) > 0) out.library = st('done', '利用できる ' + num(lb.available));
    else out.library = idle();

    // retro（改善係 §S）: 進行中（collecting / ready / submitted）→ 直近 24 時間の ended（その回で工夫が入ったか）→ 待機
    var lastRetro = rt.last_retro_at ? Date.parse(rt.last_retro_at) : NaN;
    var recentRetro = isFinite(lastRetro) && nowMs - lastRetro <= DAY_MS;
    if (num(rt.pending) > 0) out.retro = st('moving', '振り返り中');
    else if (recentRetro && num(rt.last_tips_activated) > 0) out.retro = st('done', '工夫を入れた');
    else if (recentRetro) out.retro = st('done', '振り返り 完了');
    else out.retro = idle();

    return out;
  }

  var STEP_STATION = { questions: 'questions', making: 'maker', ingest: 'clerk', verify: 'verifier', review: 'reviewer', publish: 'library' };

  /**
   * 行の所属（§N-6-4）: steps で state が active / waiting / failed の最初の工程の持ち場。
   * 加えて、自動の作り直し中（job.auto_rework かつ job が active）は autofix、人の作り直し中（kind = rework・自動でない・active）は rework にも属する
   */
  function rowStations(row) {
    var out = [];
    var steps = (row && row.steps) || [];
    for (var i = 0; i < steps.length; i++) {
      var x = steps[i] || {};
      if (x.state === 'active' || x.state === 'waiting' || x.state === 'failed') {
        if (STEP_STATION[x.key]) out.push(STEP_STATION[x.key]);
        break;
      }
    }
    var j = row && row.job;
    if (!out.length) {
      // 動いている工程が無い行: 順番待ちは職人、利用できる素材は倉庫（§N-6-4 の補足。札の件数と絞り込みを揃える）
      if (j && j.status === 'queued') out.push('maker');
      else if (row && row.material && row.material.publish_status === 'available') out.push('library');
    }
    if (j && ACTIVE_JOB_STATUSES.indexOf(j.status) >= 0) {
      if (j.auto_rework) out.push('autofix');
      else if (j.kind === 'rework') out.push('rework');
    }
    return out;
  }

  /** 矢印が流れているか: 流れ先の持ち場が動いている・人の番（§N-6-3）。states = stationStates の戻り値 */
  function arrowFlowing(arrow, states) {
    var t = states && states[arrow.to];
    return !!t && (t.kind === 'moving' || t.kind === 'human');
  }

  /** 制作キューのチップ間の矢印（§N-6-5）: 'on' = 青の実線（active・waiting の手前）/ 'done' = 灰の実線 / 'todo' = 灰の点線 */
  function chipArrowKind(prevState, curState) {
    if (curState === 'active' || curState === 'waiting') return 'on';
    if (prevState === 'done' && (curState === 'done' || curState === 'failed')) return 'done';
    return 'todo';
  }

  return {
    CHAR_EXT: CHAR_EXT,
    charSvgElementAllowed: charSvgElementAllowed,
    charSvgAttrAllowed: charSvgAttrAllowed,
    SCENE: SCENE,
    ACTIVE_JOB_STATUSES: ACTIVE_JOB_STATUSES,
    stationStates: stationStates,
    rowStations: rowStations,
    arrowFlowing: arrowFlowing,
    chipArrowKind: chipArrowKind
  };
});
