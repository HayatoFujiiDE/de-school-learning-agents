/* 作品（#works 一覧 / #works/<id> 詳細 / 見せる）: CONTRACT-v3 §W（§U-6 の「一覧・詳細・共有は作らない」を置き換え。他は §U〜§U-12）。
   一覧 = 完成（大きいカード）+ 残した試作（小さいカード）。詳細の主役は「変わってきたところ」（元の活動の変化のうち、残した時点まで）。
   画面に「版」の語は出さない（時刻で指す。design-v3）。評価の語・件数・順位は出さない。
   純関数（W.group / storyFrames / setStatus / edit / remove / restore / share / unshare / normalize …）は DOM と DES.t に触れず、
   node からも読める（tools/make-test.js）。変更は DES.store.save('works') → DES.app.commit の 1 経路（失敗したら画面の状態を戻す。§W-5）。 */
(function (root) {
  'use strict';
  var DES = root.DES = root.DES || {};
  var MD = DES.makeData || (typeof require === 'function' ? require('./make-data.js') : null);
  var M = DES.make && DES.make.chState ? DES.make : (typeof require === 'function' ? require('./make.js') : null);
  var W = DES.works = DES.works || {};

  // ---------- 小道具 ----------
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function find(list, id) { for (var i = 0; i < (list || []).length; i++) if (list[i] && list[i].id === id) return list[i]; return null; }
  function idx(list, id) { for (var i = 0; i < (list || []).length; i++) if (list[i] && list[i].id === id) return i; return -1; }
  function trim(v) { return String(v == null ? '' : v).replace(/^\s+|\s+$/g, ''); }
  // 1 件だけ写して直す。fn が false を返したら何も変えない（同じ配列を返す = 変化なし）
  function patch(works, id, fn) {
    var i = idx(works, id);
    if (i < 0) return works;
    var w = clone(works[i]);
    if (fn(w) === false) return works;
    var out = works.slice();
    out[i] = w;
    return out;
  }
  var STATUS = ['done', 'trial'];
  var FIELDS = ['title', 'like', 'craft'];
  // 見せる相手（§W-4）。個人名は置かない
  var TO = ['supporter', 'family', 'friends'];

  // ---------- 一覧: 完成 / 試作（§W-2）。並びは保存の並び（新しいものが先頭。saveWork / addCapture が先頭に足す） ----------
  function group(works) {
    var out = { done: [], trial: [] };
    (works || []).forEach(function (w) { if (w) (w.status === 'trial' ? out.trial : out.done).push(w); });
    return out;
  }
  function isShown(w) { return !!(w && Array.isArray(w.shares) && w.shares.length); }
  function siblings(works, w) { return (works || []).filter(function (x) { return x && w && x.actId === w.actId && x.id !== w.id; }); }

  // ---------- 変わってきたところ（§W-3）: はじめ + 残した時点までの変化。絵の無いコマは前の絵（inherited） ----------
  function artOf(a, st) {
    if (!st) return null;
    if (st.stage && st.stage.kind === 'note') return { note: { title: clone(st.stage.title), lines: clone(st.stage.lines) } };
    if (st.stage) return { stage: clone(st.stage) };
    var ids = st.vis || [], ph = a && a.ext && ids.length ? find(a.ext.photos, ids[ids.length - 1]) : null;
    return ph ? { photo: clone(ph) } : null;
  }
  function storyFrames(a, w) {
    if (!a || !w) return [];
    var k = w.at ? idx(a.changes, w.at) : -1;
    // 残した時点の変化が無い（変化の前に残した・取り消された）時は、作品が持つ状態 1 コマだけ。
    // 活動の今の a.base / a.stage は後から変わりうる（同じ活動で見本を置き直す等）ので使わない
    if (k < 0) {
      var own = w.snap ? artOf(a, w.snap) : null;
      return [{ id: '@work', kind: 'work', time: w.snapTime || w.atTime || null, who: null, with: null, what: null,
        art: own || clone(w.art || null), inherited: false, last: true }];
    }
    var frames = [], prev = null;
    function push(f, st) {
      var art = artOf(a, st);
      f.inherited = !art && !!prev;
      f.art = art || clone(prev);
      if (art) prev = art;
      f.last = false;
      frames.push(f);
    }
    // 変化が 1 つでもある活動の a.base は書き換わらない（pickSample が base を置き直すのは変化 0 の時だけ）
    push({ id: '@base', kind: 'base', time: a.baseTime || null, who: null, with: null, what: null }, M.baseState(a));
    for (var i = 0; i <= k; i++) {
      var c = a.changes[i];
      push({ id: c.id, kind: c.kind, time: c.time, who: c.who, with: c.with || null, what: clone(c.what) }, M.chState(a, c));
    }
    frames[frames.length - 1].last = true;
    return frames;
  }

  // ---------- 直す（§W-1 / §W-3） ----------
  function setStatus(works, id, status) {
    if (STATUS.indexOf(status) < 0) return works;
    return patch(works, id, function (w) { if (w.status === status) return false; w.status = status; });
  }
  // title / like / craft。空のタイトルは元のまま。気に入っている・工夫は空にできる（null）
  function edit(works, id, field, value) {
    if (FIELDS.indexOf(field) < 0) return works;
    var v = trim(value);
    return patch(works, id, function (w) {
      if (field === 'title') { if (!v || v === w.title) return false; w.title = v; return true; }
      var nv = v || null;
      if ((w[field] == null ? null : w[field]) === nv) return false;
      w[field] = nv;
      return true;
    });
  }
  // バディの見立て（写真から作った作品だけ。直す・違う）
  function setRead(works, id, read) {
    return patch(works, id, function (w) {
      if (w.from !== 'capture') return false;
      if (JSON.stringify(w.read || null) === JSON.stringify(read || null)) return false;
      w.read = clone(read || null);
      return true;
    });
  }
  // 作品から外す（作品レコードだけ。活動は残る）+ 元の位置に戻す
  function remove(works, id) {
    var i = idx(works, id);
    if (i < 0) return null;
    var out = works.slice(), w = out.splice(i, 1)[0];
    return { works: out, undo: { work: clone(w), index: i } };
  }
  function restore(works, u) {
    if (!u || !u.work || idx(works, u.work.id) >= 0) return works;
    var out = (works || []).slice();
    out.splice(Math.max(0, Math.min(u.index | 0, out.length)), 0, clone(u.work));
    return out;
  }

  // ---------- 見せる（§W-4）。作品に残すことと見せることは別の操作 ----------
  function share(works, id, o) {
    o = o || {};
    var w = find(works, id), want = o.to || [];
    var to = TO.filter(function (t) { return want.indexOf(t) >= 0; });
    if (!w || !to.length) return null;
    var list = Array.isArray(w.shares) ? w.shares : [], k = list.length + 1;
    while (find(list, w.id + '-s' + k)) k += 1;
    var sh = { id: o.id || (w.id + '-s' + k), to: to, scope: o.scope === 'story' ? 'story' : 'work', time: String(o.time || '') };
    return { works: patch(works, id, function (x) { x.shares = (Array.isArray(x.shares) ? x.shares : []).concat([clone(sh)]); }), share: sh };
  }
  function unshare(works, id, shareId) {
    var w = find(works, id), i = w && Array.isArray(w.shares) ? idx(w.shares, shareId) : -1;
    if (i < 0) return null;
    var sh = clone(w.shares[i]);
    return { works: patch(works, id, function (x) { x.shares.splice(i, 1); }), undo: { workId: id, share: sh, index: i } };
  }
  function undoUnshare(works, u) {
    if (!u || !u.share) return works;
    return patch(works, u.workId, function (x) {
      var list = Array.isArray(x.shares) ? x.shares : [];
      if (find(list, u.share.id)) return false;
      list.splice(Math.max(0, Math.min(u.index | 0, list.length)), 0, clone(u.share));
      x.shares = list;
      return true;
    });
  }
  // 相手に見える内容（プレビューの箇条。§W-4）。作品だけ = 絵とタイトル・本人の言葉 2 つ / 流れも = + 変わってきたところ・関わり
  // バディの分（関わりのバディ・見立て）は出所つきで出す（src / ai）
  function shareItems(w, a, scope) {
    var out = [{ k: 'pv_title', v: { title: w.title } },
      w.like ? { k: 'pv_like', v: { text: w.like }, src: 'own' } : { k: 'pv_like_none' },
      w.craft ? { k: 'pv_craft', v: { text: w.craft }, src: 'own' } : { k: 'pv_craft_none' }];
    if (scope !== 'story') return out;
    var fr = storyFrames(a, w);
    out.push(fr.length ? { k: 'pv_story', v: { n: fr.length } } : { k: 'pv_story_lost' });
    var read = w.from === 'capture' && w.read && w.read.text && !w.read.declined ? w.read.text : null;
    // 相手に見せるものには個人名を入れない（§W-4）: 手伝った人は名前でなく「いっしょに作った人 n 回」にまとめる。名前は本人の詳細だけ
    var r = w.roles || null, withN = 0;
    if (r && r.people) r.people.forEach(function (p) { withN += p.n || 0; });
    out.push({ k: 'pv_roles', src: 'record', roles: r ? { own: r.own || 0, ai: r.ai || 0, with: withN } : null, read: read });
    return out;
  }

  var pure = {
    group: group, isShown: isShown, siblings: siblings, storyFrames: storyFrames, setStatus: setStatus, edit: edit, setRead: setRead,
    remove: remove, restore: restore, share: share, unshare: unshare, undoUnshare: undoUnshare, shareItems: shareItems,
    normalize: M.normalizeWorks, TO: TO
  };
  Object.keys(pure).forEach(function (k) { W[k] = pure[k]; });
  if (typeof module !== 'undefined' && module.exports) module.exports = pure;
  if (typeof document === 'undefined') return;

  // ======================================================================
  // ここから下はブラウザ専用
  // ======================================================================
  function S() { return DES.state; }
  function T(k, v) { return DES.t(k, v); }
  function H() { return DES.h.apply(null, arguments); }
  function icon(n) { return DES.raw(DES.icon(n)); }
  function mode() { return DES.mode(); }
  function esc(v) { return window.CSS && CSS.escape ? CSS.escape(v) : String(v).replace(/"/g, '\\"'); }
  function wk() {
    var u = DES.ui;
    if (!u.wk) u.wk = { dlg: null, opened: false, edit: null, frame: null, shownDetail: null, missing: null, pendingFocus: null };
    return u.wk;
  }
  function dlgEl() { return document.getElementById('works-dialog'); }
  function act(id) { return find(S().activities || [], id); }
  function work(id) { return find(S().works || [], id); }
  function stamp() { var p = DES.data.today.split('-'); return (+p[1]) + '/' + (+p[2]); }
  function chip(kind, text, label) {
    var ic = { own: 'quote', ai: 'spark', record: 'record' }[kind];
    return H('span', { class: 'chip src-' + kind, role: 'img', 'aria-label': label || text }, [icon(ic), H('span', null, text)]);
  }
  function btn(label, action, o) {
    o = o || {};
    var at = { class: 'btn small' + (o.kls ? ' ' + o.kls : ''), type: 'button', 'data-action': action };
    if (o.id) at['data-id'] = o.id;
    if (o.arg != null) at['data-arg'] = o.arg;
    if (o.disabled) { at.disabled = true; if (o.title) at.title = o.title; }
    if (o.attrs) Object.keys(o.attrs).forEach(function (k) { at[k] = o.attrs[k]; });
    var kids = [];
    if (o.icon) kids.push(icon(o.icon));
    kids.push(H('span', null, label));
    return H('button', at, kids);
  }
  function madeOpts() { return T('made_opts').split(' / '); }
  function refocus(sel) { var n = sel ? document.querySelector(sel) : null; if (n) n.focus(); }
  function statusLabel(w) { return T(w.status === 'trial' ? 'chip_trial' : 'chip_done'); }
  function statusChip(w) {
    return H('span', { class: 'chip k-w' + (w.status === 'trial' ? 'trial' : 'done'), role: 'img', 'aria-label': T('status_h') + ' ' + statusLabel(w) }, statusLabel(w));
  }
  function metaText(w) { return [w.date || '', w.atTime || ''].filter(Boolean).join(' '); }
  function toNames(to) { return (to || []).filter(function (t) { return TO.indexOf(t) >= 0; }).map(function (t) { return T('to_' + t); }).join('・'); }

  // 作品の絵（線画 / 写真 / メモ）。cls = 置き場所の印
  function preview(art, cls) {
    var k = 'work-preview' + (cls ? ' ' + cls : '');
    if (art && art.note) {
      return H('div', { class: k + ' work-note' }, [H('p', { class: 'wn-title' }, MD.pick(art.note.title, mode())),
        H('ul', null, (art.note.lines || []).map(function (l) { return H('li', null, MD.pick(l, mode())); }))]);
    }
    var svg = art && art.photo ? MD.photoArt(art.photo) : (art && art.stage ? MD.art(art.stage) : '');
    return H('div', { class: k + (svg ? '' : ' is-empty') }, svg ? [DES.raw(svg)] : null);
  }

  // ---------- 一覧（§W-2） ----------
  function workCard(w, size) {
    var info = [H('h3', null, w.title)], foot = [], meta = metaText(w);
    if (meta) foot.push(H('span', { class: 'work-meta' }, meta));
    if (isShown(w)) foot.push(H('span', { class: 'chip k-shown' }, T('shown_badge')));
    if (foot.length) info.push(H('div', { class: 'work-foot' }, foot));
    // カード全体が詳細へのリンク（カードの中に操作を 2 つ置かない）
    return H('a', { class: 'work-card is-' + size, href: '#works/' + w.id, 'data-fk': 'work:' + w.id }, [preview(w.art), H('div', { class: 'work-info' }, info)]);
  }
  function listSection(id, title, grid) {
    return H('section', { class: 'works-sec', 'aria-labelledby': id }, [H('div', { class: 'section-head' }, [H('h2', { id: id }, title)]), grid]);
  }
  function renderList(main) {
    var works = S().works || [], g = group(works);
    main.textContent = '';
    var kids = [H('div', { class: 'page-head' }, [
      // 見出しの横に「作品展示を見る」（contract-app §AG-1。3 幅とも同じリンク。下タブは増やさない）
      H('div', null, [H('div', { class: 'wk-title-row' }, [H('h1', { tabindex: '-1', 'data-fk': 'works-h' }, T('works')),
        H('a', { class: 'link-btn wk-gallery-link', href: '#gallery' }, [H('span', null, T('gl_see')), H('span', { 'aria-hidden': 'true' }, '→')])]), H('p', null, T('works_sub'))]),
      // 作品 0 件の時は破線の枠だけ（同じ操作を 2 つ並べない。§U-12 (f)）
      works.length ? H('div', { class: 'actions' }, [H('button', { class: 'btn orange', type: 'button', 'data-action': 'wk-open', 'data-arg': 'head' }, [icon('camera'), H('span', null, T('add_capture'))])]) : null
    ])];
    // 空の段は見出しごと出さない
    if (g.done.length) kids.push(listSection('wk-done-h', T('works_done_h'), H('div', { class: 'works-done' }, g.done.map(function (w) { return workCard(w, 'done'); }))));
    if (g.trial.length) kids.push(listSection('wk-trial-h', T('works_trial_h'), H('div', { class: 'works-trial' }, g.trial.map(function (w) { return workCard(w, 'trial'); }))));
    if (!works.length) {
      kids.push(H('div', { class: 'works-empty' }, [
        H('button', { class: 'work-add', type: 'button', 'data-action': 'wk-open' }, [icon('camera'), H('span', null, T('add_capture'))]),
        H('p', { class: 'empty-line' }, T('works_empty'))
      ]));
    }
    main.appendChild(H('div', { class: 'works-page' }, kids));
  }

  // ---------- 詳細（§W-3） ----------
  function who(fr) {
    var out = [];
    if (fr.who === 'ai') out.push(chip('ai', T('who_ai'), T('ai_proposal') + ' ' + T('who_ai')));
    else if (fr.who) out.push(chip('own', T('who_own'), T('own_label') + ' ' + T('who_own')));
    if (fr.with) out.push(chip('record', fr.with, T('record_label') + ' ' + fr.with));
    return out;
  }
  function whoText(fr) { return [fr.who === 'ai' ? T('who_ai') : (fr.who ? T('who_own') : ''), fr.with || ''].filter(Boolean).join('・'); }
  function frameLabel(fr) { return fr.kind === 'base' ? T('frame_base') : (fr.kind === 'work' ? T('frame_this') : M.tx(fr.what)); }
  function frameFigure(fr, cls) {
    return H('figure', { class: cls }, [preview(fr.art, fr.inherited ? 'is-inherited' : ''),
      H('figcaption', null, [fr.time ? H('span', { class: 'sf-time' }, fr.time) : null, H('span', { class: 'sf-what' }, frameLabel(fr)), H('span', { class: 'sf-who' }, who(fr)),
        fr.last ? H('span', { class: 'sf-this' }, T('frame_this')) : null])]);
  }
  // コマの小さな絵（ボタンの中なので span。メモはタイトルだけ）
  function thumb(fr) {
    var art = fr.art, cls = 'sf-thumb' + (fr.inherited ? ' is-inherited' : '');
    if (art && art.note) return H('span', { class: cls + ' is-note' }, MD.pick(art.note.title, mode()));
    var svg = art && art.photo ? MD.photoArt(art.photo) : (art && art.stage ? MD.art(art.stage) : '');
    return H('span', { class: cls + (svg ? '' : ' is-empty') }, svg ? [DES.raw(svg)] : null);
  }
  function frameBtn(w, fr, on) {
    var label = [fr.time, frameLabel(fr), whoText(fr), fr.last ? T('frame_this') : ''].filter(Boolean).join(' ');
    return H('button', { class: 'sf-frame' + (on ? ' on' : '') + (fr.last ? ' is-last' : ''), type: 'button', 'data-action': 'wd-frame', 'data-id': w.id, 'data-arg': fr.id,
      'aria-pressed': on ? 'true' : 'false', 'aria-label': label }, [
      thumb(fr),
      H('span', { class: 'sf-text' }, [fr.time ? H('span', { class: 'sf-time' }, fr.time) : null, H('span', { class: 'sf-what' }, frameLabel(fr)),
        H('span', { class: 'sf-who' }, who(fr)), fr.last ? H('span', { class: 'sf-this' }, T('frame_this')) : null])
    ]);
  }
  function storyEl(w, a) {
    var u = wk(), f = u.frame;
    var head = H('div', { class: 'section-head' }, [H('h2', { id: 'wd-story-h' }, T('story_h'))]);
    var sec = function (kids) { return H('section', { class: 'wd-story card', 'aria-labelledby': 'wd-story-h', 'data-fk': 'wd-story:' + w.id, tabindex: '-1' }, [head].concat(kids)); };
    // 元の活動が消えていたら、作品の絵だけ + 1 文
    if (!a) return sec([H('figure', { class: 'sf-view' }, [preview(w.art)]), H('p', { class: 'sf-note' }, T('story_lost'))]);
    var frames = storyFrames(a, w);
    // 変化が 0〜1 個なら大きな絵 1 枚 + 1 文
    if (frames.length <= 2) return sec([H('figure', { class: 'sf-view' }, [preview(frames[frames.length - 1].art || w.art)]), H('p', { class: 'sf-note' }, T('story_none'))]);
    var si = frames.length - 1;
    frames.forEach(function (fr, i) { if (fr.id === f.sel) si = i; });
    var view = f.cmp && si > 0
      ? H('div', { class: 'compare-pair sf-compare', role: 'group', 'aria-label': T('compare_prev') }, [frameFigure(frames[si - 1], 'compare-item'), frameFigure(frames[si], 'compare-item')])
      : frameFigure(frames[si], 'sf-view');
    var tools = H('div', { class: 'sf-tools' }, [btn(f.cmp ? T('compare_off') : T('compare_prev'), 'wd-compare', { id: w.id, kls: 'ghost', disabled: si === 0 && !f.cmp,
      title: T('compare_none'), attrs: { 'aria-pressed': f.cmp ? 'true' : 'false' } })]);
    var strip = H('ol', { class: 'sf-strip', 'aria-label': T('story_h') }, frames.map(function (fr, i) { return H('li', null, [frameBtn(w, fr, i === si)]); }));
    return sec([view, tools, strip]);
  }
  function inlineEdit(id, field, label, value) {
    var inId = 'wd-edit-' + field;
    return H('div', { class: 'inline-edit', 'data-fk': 'wd-edit:' + field }, [
      H('label', { class: 'sr-only', for: inId }, label),
      H('input', { id: inId, type: 'text', 'data-ui': 'wd-edit', value: value, autocomplete: 'off' }),
      H('div', { class: 'actions' }, [btn(T('keep_text'), 'wd-edit-ok', { id: id, arg: field, kls: 'primary' }), btn(T('cancel'), 'wd-edit-cancel', { id: id, arg: field })])
    ]);
  }
  function editing(w, field) { var e = wk().edit; return !!(e && e.id === w.id && e.field === field); }
  function headEl(w, a) {
    var kids = [];
    if (editing(w, 'title')) kids.push(inlineEdit(w.id, 'title', T('title_label'), wk().edit.value));
    else {
      kids.push(H('div', { class: 'wd-title-row' }, [H('h1', { tabindex: '-1', 'data-fk': 'wd-h:' + w.id }, w.title),
        btn(T('quote_edit'), 'wd-edit', { id: w.id, arg: 'title', kls: 'ghost', attrs: { 'aria-label': T('edit_title') } })]));
    }
    var meta = metaText(w);
    kids.push(H('div', { class: 'wd-meta' }, [statusChip(w), meta ? H('span', null, meta) : null]));
    var lost = T('story_lost');
    var acts = H('div', { class: 'wd-actions', role: 'group', 'aria-label': T('row_ops', { title: w.title }) }, [
      btn(T('resume_make'), 'wd-continue', { id: w.id, kls: 'orange', disabled: !a, title: lost }),
      btn(T('from_here'), 'wd-from-here', { id: w.id, disabled: !a, title: lost }),
      btn(T('share'), 'wd-share', { id: w.id, attrs: { 'aria-haspopup': 'dialog' } }),
      btn(T(w.status === 'trial' ? 'to_done' : 'to_trial'), 'wd-status', { id: w.id }),
      // 学びマップで見る（§Y-8）: その作品の活動のノード（活動が無ければ作品のノード）を選んだ状態で #map へ
      H('a', { class: 'btn small', href: '#map', 'data-action': 'wd-map', 'data-id': w.id }, [H('span', null, T('mp_in_map'))]),
      btn(T('remove_work'), 'wd-remove', { id: w.id, kls: 'ghost' })
    ]);
    return H('div', { class: 'wd-head' }, [H('div', { class: 'wd-title' }, kids), acts]);
  }
  function block(w, key, title, kids, extraHead) {
    var hid = 'wd-' + key + '-h';
    return H('section', { class: 'wd-block', 'aria-labelledby': hid, 'data-fk': 'wd-' + key + ':' + w.id, tabindex: '-1' },
      [H('div', { class: 'wb-head' }, [H('h2', { id: hid }, title)].concat(extraHead || []))].concat(kids));
  }
  // 本人の言葉（気に入っているところ / 工夫したところ）: 直せる・空なら「まだ書いていないよ ＋ 書く」
  function ownBlock(w, field, label) {
    var v = w[field], kids;
    if (editing(w, field)) kids = [inlineEdit(w.id, field, label, wk().edit.value)];
    else if (v) kids = [H('p', { class: 'wb-text' }, v), H('div', { class: 'actions' }, [btn(T('quote_edit'), 'wd-edit', { id: w.id, arg: field, kls: 'ghost', attrs: { 'aria-label': label + ' ' + T('quote_edit') } })])];
    else kids = [H('p', { class: 'wb-empty' }, T('not_written')), H('div', { class: 'actions' }, [btn(T('write'), 'wd-edit', { id: w.id, arg: field, kls: 'ghost', icon: 'plus', attrs: { 'aria-label': label + ' ' + T('write') } })])];
    return block(w, field, label, kids, [chip('own', T('own_label'), T('own_label') + ' ' + label)]);
  }
  // バディの見立て（写真から作った作品だけ。琥珀の出所・直す・違う。違うと言った見立ては出さない）
  function readBlock(w) {
    var r = w.read || {}, kids, has = r.text && !r.declined;
    if (editing(w, 'read')) kids = [inlineEdit(w.id, 'read', T('ai_read'), wk().edit.value)];
    else {
      kids = [H('p', { class: 'wb-text' }, has ? r.text : T('ai_read_none')), H('div', { class: 'actions' }, [
        btn(T('quote_edit'), 'wd-edit', { id: w.id, arg: 'read', kls: 'ghost', attrs: { 'aria-label': T('ai_read') + ' ' + T('quote_edit') } }),
        has ? btn(T('decline'), 'wd-read-decline', { id: w.id, kls: 'ghost', attrs: { 'aria-label': T('ai_read') + ' ' + T('decline') } }) : null])];
    }
    var sec = block(w, 'read', T('ai_read'), kids, [chip('ai', T('who_ai'), T('ai_proposal') + ' ' + T('ai_read'))]);
    sec.classList.add('is-ai');
    return sec;
  }
  function rolesBlock(w) {
    if (!w.roles) return null;
    return block(w, 'roles', T('roles_works_h'), [H('p', { class: 'wb-roles' }, [chip('record', T('record_label'), T('record_label') + ' ' + T('roles_works_h')), ' ', M.rolesText(w.roles)])]);
  }
  function sharesBlock(w) {
    var list = (Array.isArray(w.shares) ? w.shares : []).filter(function (s) { return s && Array.isArray(s.to); });
    var kids = list.length ? [H('ul', { class: 'wb-shares' }, list.map(function (s) {
      return H('li', null, [H('p', null, [T('shares_line', { to: toNames(s.to), time: s.time || '' }), ' ', H('span', { class: 'pill' }, T(s.scope === 'story' ? 'scope_story' : 'scope_work'))]),
        btn(T('unshare'), 'wd-unshare', { id: w.id, arg: s.id, kls: 'ghost', attrs: { 'aria-label': T('unshare') + ': ' + toNames(s.to) } })]);
    }))] : [H('p', { class: 'wb-empty' }, T('shares_none'))];
    return block(w, 'shares', T('share'), kids);
  }
  // 作品展示（contract-app §AG-2 の 1 つずつ）: 出す / 出している（時刻）+ 外す。中身は gallery.js。見せる（§W-4）とは別の操作
  function galleryBlock(w) {
    if (!DES.gallery || !DES.gallery.workBlock) return null;
    return block(w, 'gallery', T('gallery'), DES.gallery.workBlock(w));
  }
  function siblingsBlock(w) {
    var sib = siblings(S().works, w);
    if (!sib.length) return null;
    return block(w, 'sib', T('siblings_h'), [H('ul', { class: 'wb-sib' }, sib.map(function (x) {
      return H('li', null, [H('a', { class: 'link-btn', href: '#works/' + x.id }, x.title), statusChip(x), H('span', { class: 'work-meta' }, metaText(x))]);
    }))]);
  }
  function renderDetail(main, w) {
    var u = wk(), a = act(w.actId);
    if (!u.frame || u.frame.work !== w.id) u.frame = { work: w.id, sel: null, cmp: false };
    main.textContent = '';
    var left = [ownBlock(w, 'like', T('like_point')), ownBlock(w, 'craft', T('craft_point'))];
    if (w.from === 'capture') left.push(readBlock(w));
    var right = [rolesBlock(w), sharesBlock(w), galleryBlock(w), siblingsBlock(w)];
    main.appendChild(H('div', { class: 'works-page work-detail', 'data-work': w.id }, [
      H('p', { class: 'wd-back' }, [H('a', { class: 'link-btn', href: '#works', 'data-action': 'wd-back', 'data-id': w.id, 'aria-label': T('back_works') }, [H('span', { 'aria-hidden': 'true' }, '←'), H('span', null, T('works'))])]),
      headEl(w, a),
      storyEl(w, a),
      H('div', { class: 'wd-cols' }, [H('div', { class: 'wd-col' }, left), H('div', { class: 'wd-col' }, right)])
    ]));
    // 詳細を開いたら h1 へ（§W-10）
    if (u.shownDetail !== w.id) { u.shownDetail = w.id; var h = main.querySelector('h1'); if (h) h.focus(); }
  }

  W.render = function (main, arg) {
    var u = wk();
    if (arg && arg !== 'capture') {
      var w = work(arg);
      if (w) renderDetail(main, w);
      else {
        // 存在しない id は一覧へ（履歴に残さない）+ トースト
        renderList(main);
        if (u.missing !== arg) { u.missing = arg; DES.app.toast(T('not_found_work')); }
        window.location.replace('#works');
      }
    } else {
      renderList(main);
      if (arg === 'capture' && !u.opened) { u.opened = true; W.openCapture(null); }
    }
    if (u.pendingFocus) { var n = main.querySelector('[data-fk="' + esc(u.pendingFocus) + '"]'); if (n) { u.pendingFocus = null; n.focus(); } }
  };
  // ルートが変わったら一時的な UI を閉じる（app.js の closeTransient から）
  W.resetUi = function () { var u = wk(); u.opened = false; u.edit = null; u.frame = null; u.shownDetail = null; u.missing = null; };

  // ---------- 保存（§W-5）: 失敗したら save_fail + 画面の状態を戻す ----------
  function saveWorks(next, o) {
    o = o || {};
    var prev = S().works;
    if (next === prev) return true;
    S().works = next;
    if (!DES.store.save('works')) {
      S().works = prev;
      S().saveFailed = true;
      DES.app.renderSaveState();
      DES.app.render();
      // 描き直しで消えたフォーカスを、操作した場所（編集なら「直す」）へ戻す
      var t = (o.sel && document.querySelector(o.sel)) || (o.focus && document.querySelector('[data-fk="' + esc(o.focus) + '"]'));
      if (t) t.focus();
      DES.app.toast(T('save_fail'));
      return false;
    }
    S().saveFailed = false;
    if (o.navigate) { o.navigate(); return true; }
    DES.app.commit(o);
    return true;
  }

  // ---------- 写真・スクショを入れる（ダイアログ。§U-6 + §W-1 の 2 択） ----------
  function syncDefaults(d) {
    var c = MD.capture(d.imgs[0]);
    if (!c) return;
    if (!d.titleEdited) d.title = MD.pick(c.title, mode());
    if (!d.madeEdited) d.made = c.made;
    if (!d.catEdited) d.catalogId = c.catalogId || '';
    if (!d.read.edited) d.read = { text: MD.pick(c.read, mode()), edited: false, declined: false };
  }
  W.openCapture = function (opener) {
    var d = { type: 'capture', imgs: [MD.captures[0].id], title: '', titleEdited: false, made: null, madeEdited: false, madeLine: '', catalogId: '', catEdited: false,
      read: { text: null, edited: false, declined: false }, readEdit: null, status: 'done', failed: false };
    syncDefaults(d);
    wk().dlg = d;
    render();
    DES.app.openDialog(dlgEl(), opener);
    var f = dlgEl().querySelector('.cap-thumb');
    if (f) f.focus();
  };
  function render() {
    var d = wk().dlg;
    if (!d) return;
    if (d.type === 'share') renderShare(); else renderCapture();
  }
  function dialogHead(title) {
    return H('div', { class: 'dialog-head' }, [H('h2', { id: 'wk-h' }, title),
      H('button', { class: 'icon-btn', type: 'button', 'data-action': 'dialog-close', 'aria-label': T('close') }, [icon('close')])]);
  }
  function renderCapture() {
    var d = wk().dlg, dlg = dlgEl();
    // 中のトーストは描き直しで消さない（§U-11 指摘 1）
    var putBack = M.clearDialog(dlg);
    dlg.setAttribute('aria-labelledby', 'wk-h');
    dlg.appendChild(dialogHead(T('add_capture')));
    var body = H('div', { class: 'dialog-body' });
    // 画像（1〜3 枚。モックはダミーの線画から選ぶ）
    body.appendChild(H('fieldset', { class: 'cap-images' }, [
      H('legend', null, T('images')),
      H('div', { class: 'cap-thumbs' }, MD.captures.map(function (c) {
        var on = d.imgs.indexOf(c.id) >= 0, only = on && d.imgs.length === 1;
        return H('button', { class: 'cap-thumb' + (on ? ' on' : ''), type: 'button', 'data-action': 'wk-img', 'data-arg': c.id, 'aria-pressed': on ? 'true' : 'false',
          'aria-disabled': only ? 'true' : null, 'aria-label': T('images') + ': ' + MD.pick(c.title, mode()) }, [DES.raw(MD.photoArt({ theme: c.theme, n: c.n })), on ? H('span', { class: 'cap-check', 'aria-hidden': 'true' }, [icon('check')]) : null]);
      })),
      btn(T('add_photo'), 'wk-file', { kls: 'ghost', icon: 'camera' })
    ]));
    body.appendChild(H('div', { class: 'field' }, [H('label', { for: 'wk-title' }, T('title_label')),
      H('input', { id: 'wk-title', type: 'text', 'data-ui': 'wk', 'data-key': 'title', value: d.title, autocomplete: 'off' })]));
    // 何を作った？（候補 + 1 行。作るの「何を変えた？」と同じ部品）
    body.appendChild(H('fieldset', { class: 'cap-made' }, [
      H('legend', null, T('what_made')),
      H('div', { class: 'opt-chips' }, madeOpts().map(function (l, i) {
        return H('button', { class: 'opt-chip', type: 'button', 'data-action': 'wk-made', 'data-arg': String(i), 'aria-pressed': d.made === i ? 'true' : 'false' }, l);
      })),
      H('input', { id: 'wk-made-line', type: 'text', 'data-ui': 'wk', 'data-key': 'madeLine', value: d.madeLine, autocomplete: 'off', 'aria-label': T('what_made') })
    ]));
    var cats = [H('option', { value: '', selected: !d.catalogId }, T('new_activity'))];
    DES.data.catalog.forEach(function (cat) {
      cats.push(H('optgroup', { label: cat.label }, cat.items.map(function (it) { return H('option', { value: it.id, selected: d.catalogId === it.id }, it.title); })));
    });
    body.appendChild(H('div', { class: 'field' }, [H('label', { for: 'wk-cat' }, T('which_activity')), H('select', { id: 'wk-cat', 'data-ui': 'wk', 'data-key': 'catalogId' }, cats)]));
    // 完成 / 試作（§W-1。既定 = 完成）
    body.appendChild(M.statusField('wk', d.status, 'wk-status'));
    // バディの見立て（本人の言葉とは別欄。直す・違う）
    var rd = d.read, readKids = [H('div', { class: 'ar-head' }, [chip('ai', T('ai_read'))])];
    if (d.readEdit != null) {
      readKids.push(H('label', { class: 'sr-only', for: 'wk-read' }, T('ai_read')));
      readKids.push(H('input', { id: 'wk-read', type: 'text', 'data-ui': 'wk', 'data-key': 'readEdit', value: d.readEdit, autocomplete: 'off' }));
      readKids.push(H('div', { class: 'actions' }, [btn(T('keep_text'), 'wk-read-ok', { kls: 'primary' }), btn(T('cancel'), 'wk-read-cancel')]));
    } else {
      readKids.push(H('p', { class: 'ar-text' }, rd.declined || !rd.text ? T('ai_read_none') : rd.text));
      readKids.push(H('div', { class: 'actions' }, [btn(T('quote_edit'), 'wk-read-edit', { kls: 'ghost' }), rd.declined ? null : btn(T('decline'), 'wk-read-decline', { kls: 'ghost' })]));
    }
    body.appendChild(H('div', { class: 'ai-read-box', 'data-fk': 'wk-read', tabindex: '-1' }, readKids));
    body.appendChild(H('p', { class: 'face-note' }, T('face_note')));
    if (d.failed) body.appendChild(H('p', { class: 'dlg-error', role: 'alert' }, T('save_work_fail')));
    dlg.appendChild(body);
    dlg.appendChild(H('div', { class: 'dialog-footer' }, [
      H('button', { class: 'btn primary', type: 'button', 'data-action': 'wk-save' }, d.failed ? T('retry_save') : T('save_work')),
      H('button', { class: 'btn', type: 'button', 'data-action': 'dialog-close' }, T('cancel'))
    ]));
    putBack();
  }
  function rerender(sel) {
    render();
    var n = sel ? dlgEl().querySelector(sel) : null;
    if (n) n.focus();
  }

  // ---------- 見せる（ダイアログ。§W-4） ----------
  function openShare(id, opener) {
    if (!work(id)) return;
    wk().dlg = { type: 'share', id: id, to: [], scope: 'work', failed: false };
    render();
    DES.app.openDialog(dlgEl(), opener);
    var f = dlgEl().querySelector('input');
    if (f) f.focus();
  }
  // 見せる相手に出す関わり: 本人 + いっしょに作った人（名前は出さない）
  function ownPeople(r) {
    var parts = [T('roles_count', { who: T('who_own'), n: r.own })];
    if (r.with) parts.push(T('roles_count', { who: T('who_with'), n: r.with }));
    return parts.join(' · ');
  }
  function previewItem(it) {
    if (it.k === 'pv_roles') {
      var r = it.roles, kids = [chip('record', T('roles_works_h'), T('record_label') + ' ' + T('roles_works_h'))];
      if (r) kids.push(' ', ownPeople(r));
      // バディの分は出所チップ付きで（本人の作と混ぜない）
      if (r && r.ai) kids.push(' ', chip('ai', T('roles_count', { who: T('who_ai'), n: r.ai }), T('ai_proposal') + ' ' + T('roles_count', { who: T('who_ai'), n: r.ai })));
      if (it.read) kids.push(' ', chip('ai', T('ai_read'), T('ai_proposal') + ' ' + T('ai_read')), ' ', it.read);
      return H('li', null, kids);
    }
    var out = [];
    if (it.src === 'own') out.push(chip('own', T('own_label')), ' ');
    out.push(T(it.k, it.v));
    return H('li', null, out);
  }
  function sharePreview(d, w) {
    return H('div', { class: 'share-preview', id: 'wk-share-preview' }, [H('p', { class: 'eyebrow' }, T('preview_h')),
      H('ul', null, shareItems(w, act(w.actId), d.scope).map(previewItem))]);
  }
  function renderShare() {
    var d = wk().dlg, dlg = dlgEl(), w = work(d.id);
    if (!w) return;
    var putBack = M.clearDialog(dlg);
    dlg.setAttribute('aria-labelledby', 'wk-h');
    dlg.appendChild(dialogHead(T('share')));
    var body = H('div', { class: 'dialog-body' }, [
      H('p', { class: 'share-work' }, [preview(w.art, 'share-thumb'), H('strong', null, w.title)]),
      H('fieldset', { class: 'share-pick' }, [H('legend', null, T('share_to_h')), H('div', { class: 'mode-options' }, TO.map(function (t) {
        return H('label', { class: 'radio-card' }, [H('input', { type: 'checkbox', name: 'wk-to', value: t, checked: d.to.indexOf(t) >= 0, 'data-ui': 'wk-share', 'data-key': 'to' }), H('span', null, T('to_' + t))]);
      }))]),
      H('fieldset', { class: 'share-pick' }, [H('legend', null, T('scope_h')), H('div', { class: 'mode-options' }, ['work', 'story'].map(function (s) {
        return H('label', { class: 'radio-card' }, [H('input', { type: 'radio', name: 'wk-scope', value: s, checked: d.scope === s, 'data-ui': 'wk-share', 'data-key': 'scope' }), H('span', null, T('scope_' + s))]);
      }))]),
      sharePreview(d, w),
      H('p', { class: 'hint share-need', id: 'wk-share-need', hidden: d.to.length > 0 }, T('share_need_to'))
    ]);
    if (d.failed) body.appendChild(H('p', { class: 'dlg-error', role: 'alert' }, T('save_fail')));
    dlg.appendChild(body);
    dlg.appendChild(H('div', { class: 'dialog-footer' }, [
      H('button', { class: 'btn primary', type: 'button', 'data-action': 'wk-share-ok', disabled: !d.to.length, 'aria-describedby': 'wk-share-need' }, T('share')),
      H('button', { class: 'btn', type: 'button', 'data-action': 'dialog-close' }, T('cancel'))
    ]));
    putBack();
  }
  // 選び直した時はプレビューと確定ボタンだけ差し替える（フォーカスを動かさない）
  function syncShare() {
    var d = wk().dlg, w = d && work(d.id), dlg = dlgEl();
    if (!w) return;
    var pv = document.getElementById('wk-share-preview');
    if (pv) pv.parentNode.replaceChild(sharePreview(d, w), pv);
    var need = document.getElementById('wk-share-need');
    if (need) need.hidden = d.to.length > 0;
    var ok = dlg.querySelector('[data-action="wk-share-ok"]');
    if (ok) ok.disabled = !d.to.length;
  }

  // ---------- 操作 ----------
  var A = DES.actions = DES.actions || {};
  function cur(el) { return work(el.getAttribute('data-id')); }
  A['wk-open'] = function (el) { W.openCapture(el); };
  A['wk-file'] = function () { DES.app.toast(T('demo_media')); };
  A['wk-img'] = function (el) {
    var d = wk().dlg, id = el.getAttribute('data-arg');
    if (!d) return;
    var i = d.imgs.indexOf(id);
    if (i >= 0) { if (d.imgs.length > 1) d.imgs.splice(i, 1); } else if (d.imgs.length < 3) d.imgs.push(id);
    syncDefaults(d);
    rerender('.cap-thumb[data-arg="' + id + '"]');
  };
  A['wk-made'] = function (el) {
    var d = wk().dlg, i = +el.getAttribute('data-arg');
    if (!d) return;
    d.made = d.made === i ? null : i;
    d.madeEdited = true;
    rerender('.opt-chip[data-arg="' + i + '"]');
  };
  A['wk-read-edit'] = function () { var d = wk().dlg; if (!d) return; d.readEdit = d.read.declined || !d.read.text ? '' : d.read.text; rerender('#wk-read'); };
  A['wk-read-cancel'] = function () { var d = wk().dlg; if (!d) return; d.readEdit = null; rerender('[data-action="wk-read-edit"]'); };
  A['wk-read-ok'] = function () {
    var d = wk().dlg;
    if (!d) return;
    var v = trim(d.readEdit);
    d.read = v ? { text: v, edited: true, declined: false } : { text: null, edited: true, declined: true };
    d.readEdit = null;
    rerender('[data-action="wk-read-edit"]');
  };
  // 違う: 読み取りを外す（提案の材料にもしない）
  A['wk-read-decline'] = function () {
    var d = wk().dlg;
    if (!d) return;
    d.read = { text: d.read.text, edited: true, declined: true };
    rerender('[data-action="wk-read-edit"]');
  };
  A['wk-save'] = function () {
    var d = wk().dlg;
    if (!d || d.type !== 'capture') return;
    // 再試行も毎回フォームの今の値で作る（§U-11 指摘 10）。失敗した試みはメモリにも残さない（§W-5）
    var prevActs = S().activities, prevWorks = S().works;
    var res = M.addCapture(prevActs, prevWorks, {
      workId: DES.plan.newId('w'), actId: DES.plan.newId('a'), images: d.imgs, title: d.title,
      made: d.made == null ? null : d.made, madeLine: trim(d.madeLine), status: d.status,
      catalogId: d.catalogId || null, read: d.read, now: DES.data.now, date: stamp(), mode: mode()
    });
    if (!res) return;
    S().activities = res.activities;
    S().works = res.works;
    // 活動を先に保存し、成功した時だけ作品を保存する（作品だけが残って活動が無い状態を作らない）
    if (!(DES.store.save('activities') && DES.store.save('works'))) {
      // 画面の状態を保存の前へ戻す。活動だけ書けていた時のために、戻した一覧で書き直しておく
      S().activities = prevActs;
      S().works = prevWorks;
      DES.store.save('activities');
      S().saveFailed = true;
      d.failed = true;
      DES.app.renderSaveState();
      rerender('[data-action="wk-save"]');
      return;
    }
    S().saveFailed = false;
    var wid = res.work.id;
    DES.app.closeDialog(dlgEl(), true);
    wk().dlg = null;
    // 保存後は詳細でなく一覧の該当カードへ（既存の挙動）。閉じた dialog は開いたボタンへフォーカスを戻すので、描き直した後にカードへ移す
    DES.app.commit({ focus: 'work:' + wid });
    DES.app.focusFk('work:' + wid);
    DES.app.toast(T('saved_work'));
  };
  // 見せる → 確定（相手 0 人では押せない）
  A['wk-share-ok'] = function () {
    var d = wk().dlg;
    if (!d || d.type !== 'share') return;
    var r = share(S().works, d.id, { to: d.to, scope: d.scope, time: stamp() + ' ' + DES.data.now });
    if (!r) return;
    var prev = S().works;
    S().works = r.works;
    if (!DES.store.save('works')) {
      S().works = prev;
      S().saveFailed = true;
      d.failed = true;
      DES.app.renderSaveState();
      rerender('[data-action="wk-share-ok"]');
      return;
    }
    S().saveFailed = false;
    // 閉じたら開いた「見せる」へフォーカスが戻る
    DES.app.closeDialog(dlgEl());
    wk().dlg = null;
    DES.app.commit({ sel: '[data-action="wd-share"]' });
    DES.app.toast(T('shared_toast'));
  };

  // 詳細の操作
  A['wd-back'] = function (el) { wk().pendingFocus = 'work:' + el.getAttribute('data-id'); window.location.hash = '#works'; };
  A['wd-frame'] = function (el) {
    var u = wk(), id = el.getAttribute('data-arg');
    if (!u.frame) return;
    u.frame.sel = id;
    DES.app.render();
    refocus('[data-action="wd-frame"][data-arg="' + esc(id) + '"]');
  };
  A['wd-compare'] = function () {
    var u = wk();
    if (!u.frame) return;
    u.frame.cmp = !u.frame.cmp;
    DES.app.render();
    refocus('[data-action="wd-compare"]');
  };
  A['wd-edit'] = function (el) {
    var w = cur(el), f = el.getAttribute('data-arg');
    if (!w) return;
    var v = f === 'read' ? (w.read && !w.read.declined && w.read.text ? w.read.text : '') : (w[f] || '');
    wk().edit = { id: w.id, field: f, value: v };
    DES.app.render();
    var t = document.getElementById('wd-edit-' + f);
    if (t) { t.focus(); if (t.setSelectionRange) t.setSelectionRange(t.value.length, t.value.length); }
  };
  A['wd-edit-ok'] = function () {
    var u = wk(), e = u.edit;
    if (!e) return;
    u.edit = null;
    var next, sel = '[data-action="wd-edit"][data-arg="' + e.field + '"]';
    if (e.field === 'read') {
      var t = trim(e.value), w = work(e.id), prev = w && w.read ? w.read : {};
      next = setRead(S().works, e.id, t ? { text: t, edited: true, declined: false } : { text: prev.text || null, edited: true, declined: true });
    } else next = edit(S().works, e.id, e.field, e.value);
    // 変わらない（空のタイトルなど）時は元の表示に戻す
    if (next === S().works) { DES.app.render(); refocus(sel); return; }
    saveWorks(next, { sel: sel });
  };
  A['wd-edit-cancel'] = function () {
    var u = wk(), e = u.edit;
    if (!e) return;
    u.edit = null;
    DES.app.render();
    refocus('[data-action="wd-edit"][data-arg="' + e.field + '"]');
  };
  A['wd-read-decline'] = function (el) {
    var w = cur(el);
    if (!w || !w.read) return;
    var before = clone(w.read), id = w.id;
    if (!saveWorks(setRead(S().works, id, { text: before.text, edited: true, declined: true }), { sel: '[data-action="wd-edit"][data-arg="read"]' })) return;
    DES.app.toast(T('removed_toast'), { label: T('undo_restore'), fn: function () {
      saveWorks(setRead(S().works, id, before), { sel: '[data-action="wd-read-decline"]', focus: 'wd-read:' + id });
    } });
  };
  A['wd-status'] = function (el) {
    var w = cur(el);
    if (!w) return;
    var to = w.status === 'trial' ? 'done' : 'trial';
    if (saveWorks(setStatus(S().works, w.id, to), { sel: '[data-action="wd-status"]' })) DES.app.toast(T(to === 'done' ? 'to_done_toast' : 'to_trial_toast'));
  };
  // 作品から外す: 作品だけ消して一覧へ。確認は出さず 5 秒の「元に戻す」（元の位置へ）
  A['wd-remove'] = function (el) {
    var w = cur(el);
    if (!w) return;
    var r = remove(S().works, w.id), id = w.id;
    if (!r) return;
    var ok = saveWorks(r.works, { sel: '[data-action="wd-remove"]', navigate: function () { wk().pendingFocus = 'works-h'; window.location.replace('#works'); } });
    if (!ok) return;
    DES.app.toast(T('removed_work'), { label: T('undo_restore'), fn: function () {
      saveWorks(restore(S().works, r.undo), { focus: 'work:' + id });
    } });
  };
  // 続きを作る: 活動の今の状態で作業台を開く（巻き戻さない）/ この時点から作る: 残した時点を新しい変化として積んで開く（既存）
  A['wd-continue'] = function (el) { var w = cur(el); if (w && act(w.actId)) M.openAct(w.actId); };
  A['wd-from-here'] = function (el) { var w = cur(el); if (w && act(w.actId)) M.openWork(w.id); };
  A['wd-share'] = function (el) { openShare(el.getAttribute('data-id'), el); };
  A['wd-map'] = function (el) { var w = cur(el); if (w) DES.map.show(act(w.actId) ? 'act:' + w.actId : 'work:' + w.id); };
  A['wd-unshare'] = function (el) {
    var w = cur(el), sid = el.getAttribute('data-arg');
    if (!w) return;
    var r = unshare(S().works, w.id, sid), id = w.id;
    if (!r) return;
    if (!saveWorks(r.works, { focus: 'wd-shares:' + id })) return;
    DES.app.toast(T('unshared_toast'), { label: T('undo_restore'), fn: function () {
      saveWorks(undoUnshare(S().works, r.undo), { sel: '[data-action="wd-unshare"][data-arg="' + esc(sid) + '"]', focus: 'wd-shares:' + id });
    } });
  };

  W.bind = function () {
    document.addEventListener('input', function (e) {
      var t = e.target, u = wk(), d = u.dlg, ui = t && t.getAttribute ? t.getAttribute('data-ui') : null;
      if (ui === 'wd-edit' && u.edit) { u.edit.value = t.value; return; }
      if (!d || ui !== 'wk' || d.type !== 'capture') return;
      var k = t.getAttribute('data-key');
      if (k === 'title') { d.title = t.value; d.titleEdited = true; }
      else if (k === 'madeLine') d.madeLine = t.value;
      else if (k === 'readEdit') d.readEdit = t.value;
    });
    document.addEventListener('change', function (e) {
      var t = e.target, d = wk().dlg, ui = t && t.getAttribute ? t.getAttribute('data-ui') : null;
      if (!d || !ui) return;
      var k = t.getAttribute('data-key');
      if (ui === 'wk' && d.type === 'capture') {
        if (k === 'catalogId') { d.catalogId = t.value; d.catEdited = true; }
        if (k === 'status') d.status = t.value === 'trial' ? 'trial' : 'done';
      }
      if (ui === 'wk-share' && d.type === 'share') {
        if (k === 'to') {
          var on = t.checked, v = t.value;
          d.to = TO.filter(function (x) { return x === v ? on : d.to.indexOf(x) >= 0; });
        }
        if (k === 'scope') d.scope = t.value === 'story' ? 'story' : 'work';
        syncShare();
      }
    });
    document.addEventListener('keydown', function (e) {
      var t = e.target, ui = t && t.getAttribute ? t.getAttribute('data-ui') : null;
      if (e.key === 'Enter' && !e.isComposing && t && t.id === 'wk-read') { e.preventDefault(); A['wk-read-ok'](); return; }
      // 詳細のインライン編集: Enter で確定・Esc で取り消し
      if (e.key === 'Enter' && !e.isComposing && ui === 'wd-edit') { e.preventDefault(); A['wd-edit-ok'](); return; }
      if (e.key === 'Escape' && wk().edit && !document.querySelector('dialog[open]')) { e.preventDefault(); A['wd-edit-cancel'](); }
    });
    var dlg = dlgEl();
    if (dlg) dlg.addEventListener('close', function () {
      var tEl = document.getElementById('toast');
      if (tEl && tEl.parentNode === dlg) document.body.appendChild(tEl);
      wk().dlg = null;
      dlg.textContent = '';
      if (window.location.hash === '#works/capture') window.location.replace('#works');
    });
  };
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
