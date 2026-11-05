/* 保存: localStorage の des3.*（CONTRACT-v3 §D / R-11）。読み書きはすべて try/catch。
   保存できないときは状態をメモリに持ち、.save-indicator を save_fail に変える。 */
(function (root) {
  'use strict';
  var DES = root.DES = root.DES || {};
  var PREFIX = 'des3.';
  // ui = 表示設定（§AC-7: 左メニュー nav 'open' | 'rail'）
  var KEYS = ['plan', 'catalogMarks', 'goals', 'talk', 'panel', 'panelTab', 'mode', 'hidden', 'draft', 'ui'];
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }
  // catalogMarks（R-6 / T-2）: 各値が { today: string[], tomorrow: boolean } のものだけ採用し、違う形はそのキーだけ捨てる
  function cleanMarks(v) {
    var out = {};
    if (!isObj(v)) return out;
    Object.keys(v).forEach(function (k) {
      var m = v[k];
      if (isObj(m) && Array.isArray(m.today) && m.today.every(function (x) { return typeof x === 'string'; }) && typeof m.tomorrow === 'boolean') {
        out[k] = { today: m.today.slice(), tomorrow: m.tomorrow };
      }
    });
    return out;
  }
  // 表示設定を整える（形が違えば初期値。nav は 'rail' のときだけ閉じた細い列）
  function normalizeUi(v) { return { nav: isObj(v) && v.nav === 'rail' ? 'rail' : 'open' }; }
  var VALID = {
    plan: function (v) { return Array.isArray(v) && v.every(function (r) { return isObj(r) && typeof r.id === 'string' && /^\d{1,2}:\d{2}$/.test(r.start) && /^\d{1,2}:\d{2}$/.test(r.end); }); },
    catalogMarks: isObj,
    goals: function (v) { return Array.isArray(v) && v.length === 3 && v.every(isObj); },
    talk: function (v) { return Array.isArray(v) && v.every(isObj); },
    panel: function (v) { return v === 'open' || v === 'closed'; },
    panelTab: function (v) { return v === 'plan' || v === 'history'; },
    mode: function (v) { return v === 'js' || v === 'es'; },
    hidden: isObj,
    draft: function (v) { return isObj(v) && typeof v.text === 'string'; }
  };
  function defaults() {
    var d = DES.data;
    return {
      plan: clone(d.plan), catalogMarks: {}, goals: clone(d.goals), talk: [],
      panel: 'open', panelTab: 'plan', mode: 'js', hidden: {}, draft: { text: '', scroll: 0 }, ui: normalizeUi(null)
    };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { normalizeUi: normalizeUi };
  if (typeof window === 'undefined') return;
  DES.store = {
    normalizeUi: normalizeUi,
    load: function () {
      var s = defaults(), failed = false;
      KEYS.forEach(function (k) {
        try {
          var raw = window.localStorage.getItem(PREFIX + k);
          if (raw == null) return;
          var v = JSON.parse(raw);
          if (k === 'catalogMarks') s[k] = cleanMarks(v);
          else if (k === 'ui') s[k] = normalizeUi(v);
          else if (VALID[k](v)) s[k] = v;
        } catch (e) { failed = true; }
      });
      s.saveFailed = failed;
      DES.state = s;
      return s;
    },
    save: function (only) {
      var st = DES.state, ok = true;
      (only ? [only] : KEYS).forEach(function (k) {
        try { window.localStorage.setItem(PREFIX + k, JSON.stringify(st[k])); } catch (e) { ok = false; }
      });
      if (!ok) st.saveFailed = true;
      return ok;
    },
    reset: function () {
      try {
        var ls = window.localStorage, del = [];
        for (var i = 0; i < ls.length; i++) { var k = ls.key(i); if (k && k.indexOf(PREFIX) === 0) del.push(k); }
        del.forEach(function (k) { ls.removeItem(k); });
      } catch (e) { /* 保存できない環境ではメモリだけ */ }
      window.location.hash = '#talk';
      window.location.reload();
    }
  };
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
