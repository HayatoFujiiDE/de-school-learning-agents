/* 教材への入口。マップの見本コード・進み具合を実教材の記録へ変換しない。 */
(function (root) {
  'use strict';
  var DES = root.DES = root.DES || {};
  var B = DES.basicLearning = {};
  var subjects = [
    { id: 'math', label: ['算数・数学', 'さんすう・数学'], prefix: '' },
    { id: 'jpn', label: ['国語', 'こくご'], prefix: 'jp' },
    { id: 'sci', label: ['理科', 'りか'], prefix: 'science' }
  ];
  function words(pair) { return pair[DES.mode() === 'es' ? 1 : 0]; }
  function gradeName(grade) { return grade < 7 ? '小学' + grade + '年生' : '中学' + (grade - 6) + '年生'; }
  function subject(id) { return subjects.filter(function (s) { return s.id === id; })[0] || null; }
  B.href = function (id, grade) {
    var s = subject(id);
    if (!s || [4, 5, 6, 7, 8, 9].indexOf(grade) === -1) return null;
    return '../basic-learning/index.html#list/' + s.prefix + grade;
  };
  B.label = function (id, grade) {
    var s = subject(id);
    return s ? words(s.label) + '・' + gradeName(grade) + words(['の教材を選ぶ', 'の きょうざいを えらぶ']) : '';
  };
  B.link = function (id, grade, className) {
    var href = B.href(id, grade);
    return href ? DES.h('a', { href: href, class: className || 'bl-course-link' }, B.label(id, grade)) : null;
  };
  B.note = function () {
    return DES.h('p', { class: 'bl-map-note' }, words([
      'マップの進み具合は表示例です。あなたの学習記録は、教材を開いて確認できます。',
      'マップの 進みぐあいは 見本です。自分の きろくは、きょうざいを 開くと 見られます。'
    ]));
  };
  B.available = function () { return words(['教科・学年から教材を選べます', '教科と 学年から きょうざいを えらべます']); };
  B.render = function () {
    var H = DES.h;
    return H('details', { class: 'bl-library' }, [
      H('summary', { class: 'bl-library-head' }, [H('span', { class: 'bl-library-title' }, words(['教材を選ぶ', 'きょうざいを えらぶ'])), H('span', { class: 'bl-library-range' }, words(['小4〜中3・算数／数学・国語・理科', '小4〜中3・さんすう／数学・こくご・りか'])), H('span', { class: 'bl-preview' }, '試用版')]),
      H('p', { class: 'bl-library-intro' }, words(['学びたい教科と学年を選んで、自分のペースで進めよう。', '教科と 学年を えらんで、自分の ペースで すすめよう。'])),
      H('div', { class: 'bl-subjects' }, subjects.map(function (s) {
        return H('section', { class: 'bl-subject', 'aria-labelledby': 'bl-subject-' + s.id }, [
          H('h3', { id: 'bl-subject-' + s.id }, words(s.label)),
          H('ul', { class: 'bl-grades' }, [4, 5, 6, 7, 8, 9].map(function (grade) {
            return H('li', null, H('a', { class: 'bl-grade', href: B.href(s.id, grade), 'aria-label': B.label(s.id, grade) }, gradeName(grade)));
          }))
        ]);
      })),
      H('p', { class: 'bl-save-note' }, words(['記録はこのブラウザに保存されます。同じURL・ブラウザで続けてください。', 'きろくは このブラウザに のこります。同じURLと ブラウザで つづけてね。']))
    ]);
  };
})(typeof window !== 'undefined' ? window : globalThis);
