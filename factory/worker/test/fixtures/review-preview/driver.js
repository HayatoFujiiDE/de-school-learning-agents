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
  function toStudy() { var el = $('#rv-study'); if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 70); }
  function done() { setTimeout(function () { document.title = 'ready'; }, 300); }
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
  var steps = {
    top: function () { done(); },
    'default': function () { toStudy(); done(); },
    'marks-off': function () { click('[data-mp-marks]'); when(loaded(2), function () { toStudy(); done(); }); },
    compare: function () { click('[data-pv="compare"]'); when(loaded(4), function () { toStudy(); done(); }); },
    sticky: function () {
      addSticky(2, 'hard', '「いちばん 数が 多い」の根拠が子どもに伝わらない', function () {
        addSticky(3, 'fact', '核と運搬量の関係は食い違いの指摘あり', function () {
          click('#mp-body-0-0 [data-stick-open="1"]');
          when(function () { return !!$('[data-stick-form]'); }, function () {
            click('[data-stick-kind="long"]');
            var el = $('#mp-body-0-0 [data-para="1"]');
            if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 200);
            done();
          });
        });
      });
    },
    'sticky-list': function () {
      addSticky(2, 'hard', '「いちばん 数が 多い」の根拠が子どもに伝わらない', function () {
        addSticky(3, 'fact', '核と運搬量の関係は食い違いの指摘あり', function () {
          var el = $('#mp-stickies');
          if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 360);
          done();
        });
      });
    },
    flowed: function () {
      addSticky(2, 'hard', '「いちばん 数が 多い」の根拠が子どもに伝わらない', function () {
        addSticky(3, 'fact', '核と運搬量の関係は食い違いの指摘あり', function () {
          click('#return-btn');
          setTimeout(function () { if (document.activeElement) document.activeElement.blur(); toStudy(); done(); }, 200);
        });
      });
    },
    goto: function () {
      toStudy();
      setTimeout(function () { click('#mp-body-0-0 [data-para="3"] .mp-cite'); setTimeout(done, 400); }, 200);
    }
  };
  when(loaded(2), function () { (steps[shot] || done)(); });
})();
