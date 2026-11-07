/* DES.live（contract-LS §LS-3）: Codex の app-live/state.mjs（des.buddy-live.v1 の唯一の読み書き口）への橋。
   state.mjs は写して持たない（動的 import）。import に失敗しても落ちない（available=false, reason='module'）。
   /api/buddy の fetch 条件・検査・文言は Codex app-live/app.js の checkService / sendChat の写し（文言は verbatim）。 */
const DES = window.DES = window.DES || {};

// app.js の errorText の固定文（notices に無い code の時）
const FALLBACK = '操作を反映できませんでした。入力した内容を確認して、もう一度操作してください。';
const apiErrors = Object.freeze({
  BUSY: '今はほかの会話に返事をしています。少し待ってから、内容を確認して送ってください。',
  LIMIT_REACHED: '試用の利用回数に達したため、バディへの送信を止めています。予定は自分で編集できます。',
  NOT_CONFIGURED: 'バディは準備中です。予定は自分で追加・編集できます。',
  BUDGET_UNAVAILABLE: '今はバディに接続できません。予定と会話の記録は残っています。',
  REFUSED: 'その内容では返事を作れませんでした。別の聞き方で相談してください。',
  DUPLICATE: 'この送信は受け付け済みです。自動では送り直しません。',
  INVALID_REPLY: '返事の形式を確認できませんでした。予定は変更していません。'
});
function serviceError(status) {
  const notices = live.ops.notices || {};
  return ({ 400: '送る内容を確認できませんでした。入力や予定を確認してください。', 401: '審査用IDとパスワードで、このページに入り直してください。', 403: 'このページからの送信を確認できませんでした。ページを開き直してください。', 409: 'この送信は続けられませんでした。自動では送り直しません。', 413: notices.payload, 415: '送信形式を確認できませんでした。ページを開き直してください。', 422: apiErrors.REFUSED, 429: '今はバディへ送信できません。接続を確認してから、もう一度操作してください。', 502: 'バディの返事を受け取れませんでした。予定は変更していません。', 503: '今はバディに接続できません。予定は自分で追加・編集できます。', 504: '返事を待つ時間が過ぎました。予定は変更していません。' })[status] || 'バディと通信できませんでした。予定は変更していません。';
}

// import できない時の最小の代替（emptyState 相当だけ）
const emptyState = () => ({ version: 1, revision: 0, events: [], messages: [], pending: null });
const listeners = new Set();
let store = null;

function notify(source) {
  for (const fn of Array.from(listeners)) {
    try { fn({ source }); } catch (error) { console.error(error); }
  }
}

const live = {
  ready: null,
  available: false,
  reason: null,
  ops: { emptyState },
  state: emptyState(),
  issue: null,
  // store.read() を try し、失敗は issue に入れて前の state を返す（Codex の readLatest と同じ。成功しても issue は消さない）
  read() {
    if (!store) return live.state;
    try { live.state = store.read(); }
    catch (error) { live.issue = error?.code || 'storage'; }
    return live.state;
  },
  // store.commit を包む。throw しない。例外は code（StateError.code。他は 'storage'）と message に変えて返す
  async commit(change) {
    if (!store) return { ok: false, code: 'module', message: FALLBACK };
    try {
      const result = await store.commit(change);
      live.state = result.state; live.issue = null;
      return { ok: true, state: result.state, value: result.value };
    } catch (error) {
      const code = error instanceof live.ops.StateError ? error.code : 'storage';
      if (['corrupt', 'storage', 'locks'].includes(code)) live.issue = code;
      else live.read();
      return { ok: false, code, message: live.ops.notices[code] || FALLBACK };
    } finally { notify('commit'); }
  },
  subscribe(fn) {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  },
  todayJST() { return live.available ? live.ops.todayJST() : DES.clock.today(); },
  nowJST() { return DES.clock.now(); },
  api: {
    // GET /api/buddy/status（Codex app.js checkService と同じ条件・検査）
    async status() {
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch('/api/buddy/status', { credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal });
        if (!response.ok) throw { status: response.status };
        const value = await response.json();
        if (!value || typeof value.configured !== 'boolean' || typeof value.available !== 'boolean' || !Number.isInteger(value.remaining) || value.remaining < 0 || value.remaining > 100 || (value.available && (!value.configured || !value.remaining))) throw new Error('STATUS');
        return { configured: value.configured, available: value.available, remaining: value.remaining };
      } catch (error) {
        return { configured: false, available: false, remaining: null, error: error.status ? serviceError(error.status) : 'バディへの接続を確認できません。予定は自分で編集できます。' };
      } finally { clearTimeout(timer); }
    },
    // POST /api/buddy（Codex app.js sendChat と同じ条件・検査・失敗文）。payload は ops.beginSend の戻り値
    async send(payload, requestId) {
      if (!store) return { ok: false, message: serviceError(0) };
      const body = JSON.stringify(payload);
      if (new TextEncoder().encode(body).length > 32768) return { ok: false, message: serviceError(413) };
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 50000);
      let failure;
      try {
        const response = await fetch('/api/buddy', { method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: { 'Content-Type': 'application/json' }, body, signal: controller.signal });
        if (!response.ok) {
          failure = serviceError(response.status);
          try { const b = await response.json(); if (Object.prototype.hasOwnProperty.call(apiErrors, b?.error)) failure = apiErrors[b.error]; } catch {}
          throw new Error('HTTP');
        }
        const raw = await response.text();
        if (raw.length > 32768) throw new live.ops.StateError('response');
        let value;
        try { value = JSON.parse(raw); } catch { throw new live.ops.StateError('response'); }
        if (!live.ops.validResponse(value, requestId) || value.proposals.some(p => p.op !== 'add' && !live.ops.sameEvent(p.original, payload.schedule.find(e => e.id === p.targetId)))) throw new live.ops.StateError('response');
        return { ok: true, response: value };
      } catch (error) {
        failure ||= error?.code === 'response' ? live.ops.notices.response : controller.signal.aborted ? serviceError(504) : serviceError(0);
        return { ok: false, message: failure };
      } finally { clearTimeout(timer); }
    }
  },
  text: { serviceError, apiErrors }
};
DES.live = live;

live.ready = (async () => {
  try {
    const ops = await import('../../app-live/state.mjs');
    live.ops = ops;
    store = ops.createStore({ storage: { getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) }, locks: navigator.locks });
    live.available = true; live.reason = null;
    // Web Locks が無いブラウザは見るだけ（Codex の readOnly と同じ判定を issue で表す）
    if (!store.writable) live.issue = 'locks';
    live.read();
    window.addEventListener('storage', event => {
      if (event.key === ops.KEY || event.key === null) { live.read(); notify('storage'); }
    });
  } catch (error) {
    store = null;
    live.available = false; live.reason = 'module';
    live.ops = { emptyState };
    live.state = emptyState();
  }
})();
