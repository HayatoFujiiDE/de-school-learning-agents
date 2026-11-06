// 管理画面「お題の棚」（contract-T T-11）の操作のループを、小さな偽物の DOM の上で mount から動かして確かめる（v2.4 の裁定 2・3・9）。
// public/admin/topics.js を node:vm で読む（topics-admin.test.ts と同じ読み方）。ブラウザと同じく、disabled の部品はクリック・入力を受けない。
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { beforeEach, describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------------------------
// 偽物の DOM（topics.js が使う所だけ）

class FakeText {
  parentNode: FakeEl | null = null;
  constructor(public data: string) {}
  get textContent(): string {
    return this.data;
  }
}
type FakeNode = FakeEl | FakeText;

class FakeEl {
  parentNode: FakeEl | null = null;
  childNodes: FakeNode[] = [];
  attrs: Record<string, string> = {};
  listeners: Record<string, Array<(e: unknown) => void>> = {};
  className = '';
  disabled = false;
  checked = false;
  value = '';
  classList = { add: (c: string) => (this.className = `${this.className} ${c}`.trim()), contains: (c: string) => this.className.split(/\s+/).includes(c) };
  constructor(public tagName: string) {}
  get children(): FakeEl[] {
    return this.childNodes.filter((n): n is FakeEl => n instanceof FakeEl);
  }
  get firstChild(): FakeNode | null {
    return this.childNodes[0] ?? null;
  }
  appendChild(n: FakeNode): FakeNode {
    if (n.parentNode) n.parentNode.removeChild(n);
    n.parentNode = this;
    this.childNodes.push(n);
    return n;
  }
  insertBefore(n: FakeNode, ref: FakeNode | null): FakeNode {
    if (!ref) return this.appendChild(n);
    if (n.parentNode) n.parentNode.removeChild(n);
    n.parentNode = this;
    this.childNodes.splice(this.childNodes.indexOf(ref), 0, n);
    return n;
  }
  removeChild(n: FakeNode): FakeNode {
    this.childNodes = this.childNodes.filter((x) => x !== n);
    n.parentNode = null;
    return n;
  }
  get textContent(): string {
    return this.childNodes.map((c) => c.textContent).join('');
  }
  set textContent(v: string) {
    this.childNodes = [];
    if (v !== '') this.appendChild(new FakeText(String(v)));
  }
  setAttribute(k: string, v: string) {
    this.attrs[k] = String(v);
  }
  getAttribute(k: string): string | null {
    return k in this.attrs ? this.attrs[k] : null;
  }
  removeAttribute(k: string) {
    delete this.attrs[k];
  }
  hasAttribute(k: string): boolean {
    return k in this.attrs;
  }
  addEventListener(t: string, f: (e: unknown) => void) {
    (this.listeners[t] ??= []).push(f);
  }
  /** ブラウザと同じく disabled の部品には利用者の操作が届かない */
  fire(t: string) {
    if (this.disabled) return;
    for (const f of this.listeners[t] ?? []) f({ type: t, target: this });
  }
  click() {
    this.fire('click');
  }
  focus() {}
  matches(sel: string): boolean {
    return sel.split(',').some((one) => {
      const m = /^([a-z]*)((?:\[[^\]]+\])*)$/.exec(one.trim());
      if (!m) throw new Error(`selector not supported: ${one}`);
      if (m[1] && m[1] !== this.tagName) return false;
      for (const a of m[2].match(/\[[^\]]+\]/g) ?? []) {
        const [, k, v] = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(a)!;
        if (!(k in this.attrs)) return false;
        if (v !== undefined && this.attrs[k] !== v) return false;
      }
      return true;
    });
  }
  querySelectorAll(sel: string): FakeEl[] {
    const out: FakeEl[] = [];
    const walk = (e: FakeEl) => {
      for (const c of e.children) {
        if (c.matches(sel)) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  querySelector(sel: string): FakeEl | null {
    return this.querySelectorAll(sel)[0] ?? null;
  }
}

const document = { createElement: (t: string) => new FakeEl(t.toLowerCase()), createTextNode: (s: string) => new FakeText(s) };
const location = { hash: '#/topics' };
const win: Record<string, unknown> = { confirm: () => true };
vm.runInNewContext(readFileSync(new URL('../public/admin/topics.js', import.meta.url), 'utf8'), { window: win, document, location, URL, console }, { timeout: 2000 });
const T = win.FactoryTopics as { mount(view: FakeEl, ctx: unknown): void };

// ---------------------------------------------------------------------------------------------
// 偽物の API（応答を後から返せる）

interface Deferred {
  resolve(v: unknown): void;
  reject(e: unknown): void;
  promise: Promise<unknown>;
}
const deferred = (): Deferred => {
  let resolve!: (v: unknown) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { resolve, reject, promise };
};

let calls: Array<{ method: string; path: string; body: unknown }>;
let route: (method: string, path: string, body: unknown) => unknown;
let confirmNote: string;
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
const ctx = () => ({
  api: (method: string, path: string, body: unknown) => {
    calls.push({ method, path, body });
    const r = route(method, path, body);
    return r instanceof Promise ? r : Promise.resolve(r);
  },
  toast: () => undefined,
  confirm: () => Promise.resolve({ ok: true, note: confirmNote }),
});
const SHA = 'a'.repeat(64);
const row = (o: Record<string, unknown> = {}) => ({
  id: 'tp_1',
  kind: 'philo',
  status: 'held',
  hold_reason: 'flagged',
  sensitivity: 'normal',
  approvable: true,
  needs_read_all: false,
  title: '題',
  slot_day: '2026-11-07',
  depth: 0,
  starred: false,
  check_attempts: 1,
  content_sha256: SHA,
  refresh_child: null,
  created_at: '2026-11-06T09:50:00.000Z',
  ...o,
});
const detail = (t: Record<string, unknown>) => ({
  topic: { ...t, body: { title: { s: '題', e: 'だい' }, lead: { s: 'l', e: 'l' } } },
  sources: [],
  checks: [{ attempt: 1, content_sha256: SHA, verdict: t.hold_reason === 'heavy' ? 'green' : 'red', approvable: 1, sources_ok: 1, sensitivity: t.sensitivity, reasons: [] }],
  decisions: [],
  lineage: [],
});
const meta = { enabled: true, kinds: [{ kind: 'philo', label: '答えのない問い', slots: 1 }] };
const button = (root: FakeEl, text: string): FakeEl | undefined => root.querySelectorAll('button').find((b) => b.textContent === text);

let view: FakeEl;
beforeEach(() => {
  calls = [];
  confirmNote = '';
  view = new FakeEl('div');
});

async function mountAt(hash: string) {
  location.hash = hash;
  T.mount(view, ctx());
  await flush();
}

describe('詳細の取得と操作が重なった時、古い取得の結果で行を描き直さない（裁定 9）', () => {
  it('詳細の取得中に「出さない」が成功した後、遅れて届いた held の詳細で「出せるにする」が戻らない', async () => {
    const slow = deferred();
    route = (m, p) => {
      if (p === '/api/topics/meta') return meta;
      if (p.startsWith('/api/topics?status=held')) return { topics: [row()], next_before: null };
      if (m === 'GET' && p === '/api/topics/tp_1') return slow.promise;
      if (m === 'POST' && p === '/api/topics/tp_1/decide') return { topic: row({ status: 'rejected', hold_reason: null, approvable: false }) };
      throw new Error(`unexpected ${m} ${p}`);
    };
    await mountAt('#/topics/held');
    const card = view.querySelector('article[data-tp-topic="tp_1"]')!;
    expect(card.querySelector('[data-tp-approve]')).not.toBeNull();
    button(card, '出さない')!.click();
    await flush();
    expect(calls.filter((c) => c.method === 'POST').length).toBe(1);
    expect(card.querySelector('[data-tp-approve]')).toBeNull();
    slow.resolve(detail(row()));
    await flush();
    expect(card.querySelector('[data-tp-approve]')).toBeNull();
    expect(card.textContent).toContain('出さない');
  });
});

describe('通信中は、その行の入力（チェック・入力欄・ボタン）を全部 disabled にする（裁定 9）', () => {
  it('重い話題の承認の POST 中は「全文を読んだ」も止まり、外して入れ直しても承認を 2 回送れない', async () => {
    const post = deferred();
    const heavy = row({ hold_reason: 'heavy', sensitivity: 'heavy', needs_read_all: true });
    route = (m, p) => {
      if (p === '/api/topics/meta') return meta;
      if (p.startsWith('/api/topics?status=held')) return { topics: [heavy], next_before: null };
      if (m === 'GET' && p === '/api/topics/tp_1') return detail(heavy);
      if (m === 'POST') return post.promise;
      throw new Error(`unexpected ${m} ${p}`);
    };
    await mountAt('#/topics/held');
    const card = view.querySelector('article[data-tp-topic="tp_1"]')!;
    const cb = card.querySelector('input[data-tp-readall]')!;
    expect(cb.disabled).toBe(false);
    cb.checked = true;
    cb.fire('change');
    const ap = card.querySelector('[data-tp-approve]')!;
    expect(ap.disabled).toBe(false);
    ap.click();
    await flush();
    expect(calls.filter((c) => c.method === 'POST').length).toBe(1);
    // 通信中: この行の部品は全部止まっている
    expect(card.querySelectorAll('button, input, textarea, select').filter((e) => !e.disabled).map((e) => e.tagName + ':' + e.textContent)).toEqual([]);
    cb.checked = false;
    cb.fire('change');
    cb.checked = true;
    cb.fire('change');
    card.querySelector('[data-tp-approve]')!.click();
    await flush();
    expect(calls.filter((c) => c.method === 'POST').length).toBe(1);
    post.resolve({ topic: row({ ...heavy, status: 'ready', hold_reason: null }) });
    await flush();
    expect(card.querySelector('[data-tp-approve]')).toBeNull();
  });
});

describe('一言（note）はコードポイントで数え、勝手に短くしない（裁定 9）', () => {
  const EMOJI150 = '😀'.repeat(150); // コードポイント 150・UTF-16 で 300
  it('発展の一言: 絵文字 150 個はそのまま送る（入力欄に UTF-16 の maxlength を付けない）', async () => {
    route = (m, p) => {
      if (p === '/api/topics/meta') return meta;
      if (p.startsWith('/api/topics?status=ready')) return { topics: [row({ status: 'ready', hold_reason: null })], next_before: null };
      if (m === 'POST' && p === '/api/topics/tp_1/derive') return { run: { id: 'r1', status: 'done', made: 1, dropped: 0, cents: 30 } };
      throw new Error(`unexpected ${m} ${p}`);
    };
    await mountAt('#/topics/stock');
    const card = view.querySelector('article[data-tp-topic="tp_1"]')!;
    button(card, '発展させる')!.click();
    const ta = card.querySelector('textarea[data-tp-extend]')!;
    expect(ta.getAttribute('maxlength')).toBeNull();
    ta.value = EMOJI150;
    ta.fire('input');
    expect(card.textContent).toContain('150 / 200');
    button(card, '発展の子を作る')!.click();
    await flush();
    const post = calls.find((c) => c.method === 'POST')!;
    expect((post.body as { note: string }).note).toBe(EMOJI150);
  });
  it('止めるのメモ: 絵文字 150 個はそのまま送る / 201 字は送らずに理由を出す', async () => {
    route = (m, p) => {
      if (p === '/api/topics/meta') return meta;
      if (p.startsWith('/api/topics?status=ready')) return { topics: [row({ status: 'ready', hold_reason: null })], next_before: null };
      if (m === 'POST') return { topic: row({ status: 'retired', hold_reason: null }) };
      throw new Error(`unexpected ${m} ${p}`);
    };
    await mountAt('#/topics/stock');
    const card = view.querySelector('article[data-tp-topic="tp_1"]')!;
    confirmNote = 'あ'.repeat(201);
    button(card, '止める')!.click();
    await flush();
    expect(calls.filter((c) => c.method === 'POST').length).toBe(0);
    expect(card.textContent).toContain('200 字まで');
    confirmNote = EMOJI150;
    button(card, '止める')!.click();
    await flush();
    expect((calls.find((c) => c.method === 'POST')!.body as { note: string }).note).toBe(EMOJI150);
  });
});

describe('ストックと要確認に「もっと読む」（裁定 3。続きは next_before をそのまま渡す）', () => {
  it.each([
    ['要確認', '#/topics/held', 'held', {}],
    ['ストック', '#/topics/stock', 'ready', { status: 'ready', hold_reason: null }],
  ] as const)('%s: 押すと次のページを読んで行を足し、最後のページで消える', async (_n, hash, status, over) => {
    const cursor = '2026-11-06T09:50:00.000Z|tp_1';
    route = (m, p) => {
      if (p === '/api/topics/meta') return meta;
      if (p.startsWith(`/api/topics?status=${status}`)) {
        return p.includes('before=')
          ? { topics: [row({ ...over, id: 'tp_0', title: '前の題' })], next_before: null }
          : { topics: [row({ ...over })], next_before: cursor };
      }
      if (m === 'GET' && p.startsWith('/api/topics/tp_')) return detail(row({ ...over, id: p.slice('/api/topics/'.length) }));
      throw new Error(`unexpected ${m} ${p}`);
    };
    await mountAt(hash);
    expect(view.querySelectorAll('article').length).toBe(1);
    const more = button(view, 'もっと読む')!;
    expect(more).toBeDefined();
    more.click();
    await flush();
    const listCall = calls.filter((c) => c.path.includes('before='));
    expect(listCall.map((c) => c.path)).toEqual([expect.stringContaining(`before=${encodeURIComponent(cursor)}`)]);
    expect(view.querySelectorAll('article').map((a) => a.getAttribute('data-tp-topic'))).toEqual(['tp_1', 'tp_0']);
    expect(button(view, 'もっと読む')).toBeUndefined();
  });
});

describe('見直しの子が終わっていない時は「見直す」を出さず、理由を出す（裁定 2）', () => {
  it('ストック: 見直しの子が held で止まっている ready には「見直す」が無く、止まっている子の文が出る', async () => {
    route = (m, p) => {
      if (p === '/api/topics/meta') return meta;
      if (p.startsWith('/api/topics?status=ready')) return { topics: [row({ status: 'ready', hold_reason: null, refresh_child: { id: 'tp_c', status: 'held' } }), row({ id: 'tp_2', status: 'ready', hold_reason: null })], next_before: null };
      throw new Error(`unexpected ${m} ${p}`);
    };
    await mountAt('#/topics/stock');
    const blocked = view.querySelector('article[data-tp-topic="tp_1"]')!;
    expect(button(blocked, '見直す')).toBeUndefined();
    expect(blocked.textContent).toContain('見直しの子');
    expect(blocked.textContent).toContain('出さない');
    expect(button(view.querySelector('article[data-tp-topic="tp_2"]')!, '見直す')).toBeDefined();
  });
});

describe('派生の POST が失敗した時、開いていて詳細が無ければ読み直す（レビュー残り 4）', () => {
  it('全文の取得中に「見直す」→ 500 → 古い GET の応答の順でも、読み込み中が残らず詳細が出る', async () => {
    const slow = deferred();
    const ready = row({ status: 'ready', hold_reason: null });
    let gets = 0;
    route = (m, p) => {
      if (p === '/api/topics/meta') return meta;
      if (p.startsWith('/api/topics?status=ready')) return { topics: [ready], next_before: null };
      if (m === 'GET' && p === '/api/topics/tp_1') return ++gets === 1 ? slow.promise : detail(ready);
      if (m === 'POST' && p === '/api/topics/tp_1/derive') return Promise.reject({ status: 500, code: 'server' });
      throw new Error(`unexpected ${m} ${p}`);
    };
    await mountAt('#/topics/stock');
    const card = view.querySelector('article[data-tp-topic="tp_1"]')!;
    button(card, '全文と系譜を開く')!.click();
    await flush();
    expect(card.querySelector('[data-tp-loading]')).not.toBeNull();
    button(card, '見直す')!.click();
    await flush();
    expect(calls.filter((c) => c.method === 'POST').length).toBe(1);
    slow.resolve(detail(ready));
    await flush();
    expect(calls.filter((c) => c.method === 'GET' && c.path === '/api/topics/tp_1').length).toBe(2);
    expect(card.querySelector('[data-tp-loading]')).toBeNull();
    expect(card.querySelectorAll('div').some((d) => d.className === 'tp-detail')).toBe(true);
  });
});

describe('今すぐ作る: 202 queued を「作り始めました」と出し、送った時点でボタンを戻す（v2.6）', () => {
  it('結果行に「作り始めました（1〜3 分）…下の記録に出ます」・ボタンは「今すぐ作る」に戻り押せる', async () => {
    route = (m, p) => {
      if (p === '/api/topics/meta') return meta;
      if (p === '/api/status') return { topics: { enabled: true, month_cents: 0, month_cap_cents: 10000 } };
      if (m === 'GET' && p === '/api/topics/runs?limit=50') return { runs: [] };
      if (m === 'POST' && p === '/api/topics/runs') return { status: 'queued', run: { id: 'r9', status: 'calling', kind: 'philo', purpose: 'gen' } };
      throw new Error(`unexpected ${m} ${p}`);
    };
    await mountAt('#/topics/runs');
    const go = button(view, '今すぐ作る')!;
    go.click();
    await flush();
    expect(calls.filter((c) => c.method === 'POST' && c.path === '/api/topics/runs')).toHaveLength(1);
    expect(view.textContent).toContain('を作り始めました（1〜3 分）。画面を閉じても作り続けます。できたら下の記録に出ます');
    expect(go.textContent).toBe('今すぐ作る');
    expect(go.disabled).toBe(false);
  });
});
