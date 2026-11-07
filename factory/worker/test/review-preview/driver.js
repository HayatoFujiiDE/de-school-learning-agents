/* serve.mjs の確認用ページだけで読む操作の台本。?shot=<名前> の操作をしてから document.title を "ready" にする（headless Chrome で撮るため） */
(function () {
  'use strict';
  var shot = new URLSearchParams(location.search).get('shot');
  if (!shot) return;
  var $ = function (s) { return document.querySelector(s); };
  function click(sel) { var el = typeof sel === 'string' ? $(sel) : sel; if (el) el.click(); return !!el; }
  function when(pred, then, left) {
    left = left === undefined ? 60 : left;
    if (pred() || left <= 0) return then();
    setTimeout(function () { when(pred, then, left - 1); }, 100);
  }
  var loaded = function (n) { return function () { return document.querySelectorAll('.mp-md').length >= n; }; };
  // フォーカスで動いたスクロールも戻す（撮れるのは先頭の画面だけ）
  // y: 窓を少し下げて撮る時だけ（右の一覧を窓の上に貼り付けて、下の固定フッターに隠れないようにする）
  function done(y) { setTimeout(function () { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); window.scrollTo(0, typeof y === 'number' ? y : 0); document.title = 'ready'; }, 400); }
  function addSticky(para, kind, text, then) {
    if (!click('#mp-body-0-0 [data-stick-open="' + para + '"]')) return then();
    when(function () { return !!$('[data-stick-form]'); }, function () {
      click('[data-stick-kind="' + kind + '"]');
      var inp = $('[data-stick-form] input');
      if (inp) inp.value = text;
      click('[data-stick-add]');
      setTimeout(then, 150);
    });
  }
  function railToStickies() { var r = $('.rv-rail'); if (r) r.scrollTop = r.scrollHeight; }
  function addFigSticky(then) {
    if (!click('#mp-body-0-0 [data-stick-media="figure"]')) return then();
    when(function () { return !!$('[data-stick-form]'); }, function () {
      click('[data-stick-kind="3d"]');
      var inp = $('[data-stick-form] input');
      if (inp) inp.value = '赤血球を立体の絵にして、血管の中を流れている様子に';
      click('[data-stick-add]');
      setTimeout(then, 150);
    });
  }
  // 項目の場所（「小学生・短い 2 段落目」など）は全部の変奏を読んでから出る
  var located = function () { return !!$('.rv-it-where') || !$('.rv-it'); };
  var steps = {
    top: function () { when(located, done); },
    // 見てほしい所の 1 件目を OK にした状態・1 件目を「直してもらう」にした状態
    ok1: function () { when(located, function () { click('[data-it-ok]'); done(); }); },
    redo1: function () { when(located, function () { click('[data-it-redo="0"]'); done(); }); },
    // 全部の項目を決めた（ask は OK・fix は 1 件だけ「このまま出す」、残りは「直してもらう」）→ 直してもらうを押して理由欄を開く
    'return-open': function () {
      when(located, function () {
        Array.prototype.forEach.call(document.querySelectorAll('.rv-it[data-sev="ask"] [data-it-ok]'), function (b) { b.click(); });
        Array.prototype.forEach.call(document.querySelectorAll('.rv-it[data-sev="fix"] [data-it-redo]'), function (b) { b.click(); });
        addSticky(2, 'hard', '「いちばん 数が 多い」の根拠が子どもに伝わらない', function () {
          click('#return-btn');
          setTimeout(done, 200);
        });
      });
    },
    'marks-off': function () { when(located, function () { click('[data-mp-marks]'); when(loaded(2), done); }); },
    compare: function () { when(located, function () { click('[data-pv="compare"]'); when(loaded(4), done); }); },
    // 表示中の変奏に無い項目（中学生・長い にあります）の「場所を見る」→ その変奏に切り替わる
    'goto-other': function () {
      when(located, function () {
        var b = Array.prototype.filter.call(document.querySelectorAll('.rv-it'), function (li) { return /にあります/.test(li.textContent); })[0];
        if (b) click(b.querySelector('[data-it-goto]'));
        setTimeout(function () { when(loaded(2), done); }, 300);
      });
    },
    // 横にはみ出す要素を数える（--dump-dom で読む。幅の確かめ用）
    measure: function () {
      when(located, function () {
        var vw = document.documentElement.clientWidth, out = [];
        Array.prototype.forEach.call(document.querySelectorAll('body *'), function (el) {
          var r = el.getBoundingClientRect();
          if (r.width && r.right > vw + 1 && !(el.parentElement && el.parentElement.getBoundingClientRect().right > vw + 1)) out.push((el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0]) + ':' + Math.round(r.right));
        });
        document.body.setAttribute('data-over', out.slice(0, 20).join(' ') || 'none');
        document.body.setAttribute('data-sw', String(document.documentElement.scrollWidth) + '/' + vw);
        done();
      });
    },
    list: function () { when(function () { return !!$('#rl-autopub') && !!$('[data-rl-sec]'); }, done); },
    videos: function () { when(function () { return !!$('[data-channel-key]') || !!$('[data-channels-empty]'); }, done); },
    // §L-9: 図のボタン → 種類「立体の絵にする」+ 一言 → 付ける（右の一覧に 1 件）。-return はその後「直してもらう」で理由欄に入った状態
    // 右の一覧は中で巻き取る枠（.rv-rail）なので、付箋の区画が見えるところまで巻く
    'fig-sticky': function () { addFigSticky(function () { done(160); setTimeout(railToStickies, 450); }); },
    'fig-sticky-return': function () { addFigSticky(function () { click('#return-btn'); setTimeout(function () { done(160); setTimeout(railToStickies, 450); }, 200); }); },
    // 入力の枠を開いて種類と一言を選んだところ（付ける前）
    'fig-sticky-form': function () {
      if (!click('#mp-body-0-0 [data-stick-media="figure"]')) return done();
      when(function () { return !!$('[data-stick-form]'); }, function () {
        click('[data-stick-kind="3d"]');
        var inp = $('[data-stick-form] input');
        if (inp) inp.value = '赤血球を立体の絵にして、血管の中を流れている様子に';
        done();
      });
    },
    sticky: function () {
      addSticky(2, 'hard', '「いちばん 数が 多い」の根拠が子どもに伝わらない', function () {
        addSticky(3, 'fact', '核と運搬量の関係は食い違いの指摘あり', function () { done(); });
      });
    }
  };
  var isReview = /^#\/review\/./.test(location.hash);
  if (isReview) when(loaded(2), function () { (steps[shot] || done)(); });
  else (steps[shot] || done)();
})();
