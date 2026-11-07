/* 保存: localStorage の des.live.*（contract-LS §LS-2）。読み書きはすべて try/catch。
   保存できないときは状態をメモリに持ち、.save-indicator を save_fail に変える（モックと同じ）。
   des.buddy-live.v1（会話・予定）は DES.live、des.basic-learning.v1 は読むだけ、des3.* は触らない。
   各ページは自分の js のトップレベルで DES.store.register(key, validate, defaults) を呼んで鍵を足す。
   モックのページ js が load / save を包んで鍵を足す書き方（make.js などの monkey-patch）もそのまま動く:
   save(only) は登録の有無にかかわらず des.live.<only> へ DES.state[only] を書く。 */
(function (root) {
  'use strict';
  var DES = root.DES = root.DES || {};
  var PREFIX = 'des.live.';
  var REG = {}, ORDER = [];
  // モックのページ js が DES.state から読むが des.live に持たない欄（会話・予定は Codex の保存）。
  // 登録されていない間だけメモリで持ち、保存しない（L1 が DES.live へ置き換える。catalogMarks は L1 が register する）
  var MEMORY = {
    plan: function () { return clone((DES.data && DES.data.plan) || []); },
    talk: function () { return []; },
    catalogMarks: function () { return {}; }
  };
  var clearing = false;
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  // 表示設定を整える（形が違えば初期値。nav は 'rail' のときだけ閉じた細い列）
  function normalizeUi(v) { return { nav: isObj(v) && v.nav === 'rail' ? 'rail' : 'open' }; }

  // 鍵を足す。同じ key をもう一度 register したら後勝ち（並び順は最初の位置のまま）
  function register(key, validate, defaults) {
    if (!REG[key]) ORDER.push(key);
    REG[key] = { validate: validate, defaults: defaults };
  }
  function validate(key, v) {
    var r = REG[key];
    if (!r) return false;
    try { return r.validate(v) === true; } catch (e) { return false; }
  }

  // ---------- 基本の鍵（L0） ----------
  register('mode', function (v) { return v === 'js' || v === 'es'; }, function () { return 'js'; });
  register('ui', function (v) { return isObj(v) && (v.nav === 'open' || v.nav === 'rail'); }, function () { return normalizeUi(null); });
  register('panel', function (v) { return v === 'open' || v === 'closed'; }, function () { return 'open'; });
  register('panelTab', function (v) { return v === 'plan' || v === 'history'; }, function () { return 'plan'; });
  register('hidden', isObj, function () { return {}; });
  register('draft', function (v) { return isObj(v) && typeof v.text === 'string'; }, function () { return { text: '', scroll: 0 }; });
  register('profile', function (v) {
    if (!isObj(v) || !(v.name === null || typeof v.name === 'string')) return false;
    var a = v.avatar;
    return a === null || (isObj(a) && (a.none === true || (typeof a.hair === 'string' && typeof a.color === 'string')));
  }, function () { return { name: null, avatar: null }; });
  register('goals', function (v) { return Array.isArray(v) && v.length === 3 && v.every(isObj); }, function () { return clone(DES.data.goals); });

  var store = {
    PREFIX: PREFIX,
    register: register,
    normalizeUi: normalizeUi,
    keys: function () { return ORDER.slice(); },
    validate: validate,
    // 登録済みの全 key を読み、不正な形はその key だけ既定へ。DES.state を作る。失敗は saveFailed = true
    load: function () {
      var s = {}, failed = false;
      ORDER.forEach(function (k) {
        s[k] = REG[k].defaults();
        try {
          var raw = root.localStorage.getItem(PREFIX + k);
          if (raw == null) return;
          var v = JSON.parse(raw);
          if (validate(k, v)) s[k] = v;
        } catch (e) { failed = true; }
      });
      Object.keys(MEMORY).forEach(function (k) { if (!REG[k]) s[k] = MEMORY[k](); });
      s.saveFailed = failed;
      DES.state = s;
      return s;
    },
    // only があればその key だけ（登録していない key も書く = モックの包み方の約束）。失敗で false・saveFailed = true
    save: function (only) {
      var st = DES.state, ok = true;
      if (clearing) return true; // 消した後・reload までの間に書き戻さない
      if (!st) return false;
      (only ? [only] : ORDER).forEach(function (k) {
        if (!REG[k] && MEMORY[k]) return;
        if (st[k] === undefined) return;
        try { root.localStorage.setItem(PREFIX + k, JSON.stringify(st[k])); } catch (e) { ok = false; }
      });
      if (!ok) st.saveFailed = true;
      return ok;
    },
    // des.live.* だけ消す（des.buddy-live.v1 / des.basic-learning.v1 / des3.* は消さない）→ #talk → reload
    clearLive: function () {
      clearing = true;
      try {
        var ls = root.localStorage, del = [];
        for (var i = 0; i < ls.length; i++) { var k = ls.key(i); if (k && k.indexOf(PREFIX) === 0) del.push(k); }
        del.forEach(function (k) { ls.removeItem(k); });
      } catch (e) { /* 保存できない環境ではメモリだけ */ }
      root.location.hash = '#talk';
      root.location.reload();
    }
  };
  DES.store = store;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { PREFIX: PREFIX, register: register, keys: store.keys, validate: validate, normalizeUi: normalizeUi };
  }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
