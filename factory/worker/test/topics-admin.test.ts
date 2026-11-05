// 管理画面「お題の棚」（contract-T T-11）の DOM に触れない判断。
// public/admin/topics.js を node:vm で読み（image-admin.test.ts が admin.js を読むのと同じ読み方）、window.FactoryTopics の純関数を確かめる。
// 読み込んだだけでは DOM に触れない（document を渡さずに評価して例外が出ない）ことも、この読み方で確かめている。
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

type Topic = Record<string, unknown>;
interface ApproveState { show: boolean; enabled: boolean; why: string; body: Record<string, unknown> | null }
interface Meta { enabled: boolean; kinds: Record<string, string>; slots: Record<string, number>; reasons: Record<string, string> }
interface TopicsUi {
  mount: unknown;
  isTopicsHash(h: string): boolean;
  parseTopicsHash(h: string): { tab: string; kind: string | null } | null;
  topicsHash(tab: string, kind: string | null): string;
  safeSourceHref(url: unknown): string | null;
  normalizeMeta(m: unknown): Meta | null;
  kindText(code: string, meta: Meta | null): string;
  reasonText(code: string, meta: Meta | null): string;
  heldGroup(r: string | null): string;
  isSourceHold(r: string | null): boolean;
  heldActions(t: Topic | null): string[];
  latestCheck(t: Topic, checks: unknown): Topic | null;
  approveState(t: Topic, detail: unknown, readAll: boolean): ApproveState;
  errorText(e: unknown, meta: Meta | null): string;
  tokyoDay(now: Date, offset: number): string;
}

const code = readFileSync(new URL('../public/admin/topics.js', import.meta.url), 'utf8');
const win: Record<string, unknown> = {};
vm.runInNewContext(code, { window: win, URL, console }, { timeout: 2000 });
const T = win.FactoryTopics as TopicsUi;

const SHA = 'a'.repeat(64);
const held = (o: Topic = {}): Topic => ({ id: 'tp_r1_1', status: 'held', hold_reason: 'flagged', sensitivity: 'normal', content_sha256: SHA, check_attempts: 2, ...o });
const check = (o: Topic = {}): Topic => ({ attempt: 2, content_sha256: SHA, verdict: 'red', approvable: 1, sources_ok: 1, sensitivity: 'normal', reasons_json: '["flagged:one_sided"]', ...o });
const detailOf = (t: Topic, checks: Topic[]) => ({ topic: t, sources: [], checks, decisions: [], lineage: [t] });

describe('読み込み', () => {
  it('window.FactoryTopics.mount だけを置き、自分では起動しない（document なしで評価できる）', () => {
    expect(typeof T.mount).toBe('function');
  });
});

describe('タブの hash の解釈', () => {
  it('4 つのタブ', () => {
    expect(T.parseTopicsHash('#/topics')).toEqual({ tab: 'today', kind: null });
    expect(T.parseTopicsHash('#/topics/')).toEqual({ tab: 'today', kind: null });
    expect(T.parseTopicsHash('#/topics/held')).toEqual({ tab: 'held', kind: null });
    expect(T.parseTopicsHash('#/topics/stock')).toEqual({ tab: 'stock', kind: null });
    expect(T.parseTopicsHash('#/topics/runs')).toEqual({ tab: 'runs', kind: null });
  });
  it('ストックの種類の絞り込み（4 種のどれかだけ。ほかのタブでは無視）', () => {
    expect(T.parseTopicsHash('#/topics/stock?kind=philo')).toEqual({ tab: 'stock', kind: 'philo' });
    expect(T.parseTopicsHash('#/topics/stock?kind=evil')).toEqual({ tab: 'stock', kind: null });
    expect(T.parseTopicsHash('#/topics/held?kind=news')).toEqual({ tab: 'held', kind: null });
    expect(T.parseTopicsHash('#/topics/stock?kind=%E0')).toEqual({ tab: 'stock', kind: null }); // 壊れた % でも落ちない
  });
  it('知らないタブは today。お題の棚でない hash は null', () => {
    expect(T.parseTopicsHash('#/topics/zzz')).toEqual({ tab: 'today', kind: null });
    expect(T.parseTopicsHash('#/topicsx')).toBeNull();
    expect(T.parseTopicsHash('#/materials')).toBeNull();
    expect(T.parseTopicsHash('')).toBeNull();
  });
  it('通信から戻った時の「まだお題の棚か」', () => {
    expect(T.isTopicsHash('#/topics')).toBe(true);
    expect(T.isTopicsHash('#/topics/runs')).toBe(true);
    expect(T.isTopicsHash('#/topics?x=1')).toBe(true);
    expect(T.isTopicsHash('#/topicsx')).toBe(false);
    expect(T.isTopicsHash('#/review')).toBe(false);
  });
  it('タブ → hash（リロードで同じタブに戻る）', () => {
    expect(T.topicsHash('today', null)).toBe('#/topics');
    expect(T.topicsHash('held', null)).toBe('#/topics/held');
    expect(T.topicsHash('stock', 'make')).toBe('#/topics/stock?kind=make');
    expect(T.topicsHash('stock', 'bad')).toBe('#/topics/stock');
    expect(T.topicsHash('runs', 'news')).toBe('#/topics/runs');
    for (const t of ['today', 'held', 'stock', 'runs']) expect(T.parseTopicsHash(T.topicsHash(t, null))!.tab).toBe(t);
  });
});

describe('出典のリンクにしてよい URL（T-5 checkSourceUrl と同じ規則）', () => {
  it('https・資格情報なし・ポートなし・点のあるホストはリンクにする', () => {
    expect(T.safeSourceHref('https://www.mext.go.jp/a_menu/other/mext_02412.html')).toBe('https://www.mext.go.jp/a_menu/other/mext_02412.html');
    expect(T.safeSourceHref('https://Example.COM./a?b=1')).not.toBeNull();
    expect(T.safeSourceHref('https://ja.wikipedia.org/wiki/テセウスの船')).toMatch(/^https:\/\/ja\.wikipedia\.org\/wiki\//);
  });
  it.each([
    ['http', 'http://www.example.com/'],
    ['javascript', 'javascript:alert(1)'],
    ['data', 'data:text/html,<b>x</b>'],
    ['資格情報', 'https://user:pw@www.example.com/'],
    ['ユーザー名だけ', 'https://user@www.example.com/'],
    ['ポート', 'https://www.example.com:8443/'],
    ['IPv4', 'https://127.0.0.1/'],
    ['IPv4（16 進）', 'https://0x7f.0.0.1/'],
    ['IPv4（省略形）', 'https://127.1/'],
    ['IPv6', 'https://[::1]/'],
    ['localhost', 'https://localhost/'],
    ['localhost.', 'https://localhost./'],
    ['*.localhost', 'https://a.localhost/'],
    ['*.local.', 'https://a.local./'],
    ['*.internal', 'https://db.internal/'],
    ['*.home.arpa', 'https://nas.home.arpa/'],
    ['点のないホスト', 'https://intranet/'],
    ['解釈できない', 'not a url'],
    ['空', ''],
  ])('%s は文字として出す（null）', (_n, url) => {
    expect(T.safeSourceHref(url)).toBeNull();
  });
  it('文字列でない値は null', () => {
    expect(T.safeSourceHref(null)).toBeNull();
    expect(T.safeSourceHref({ toString: () => 'https://a.example/' })).toBeNull();
  });
});

describe('要確認の 3 つの分け方と、出す操作', () => {
  it('heavy / flagged / それ以外（出典・形・禁止語・検査の失敗・重複の競合）', () => {
    expect(T.heldGroup('heavy')).toBe('heavy');
    expect(T.heldGroup('flagged')).toBe('flagged');
    for (const r of ['source_not_found', 'source_unsupported', 'source_unreachable', 'source_lost', 'schema', 'forbidden', 'check_failed', 'duplicate_race']) {
      expect(T.heldGroup(r)).toBe('source');
    }
    expect(T.isSourceHold('source_lost')).toBe(true);
    expect(T.isSourceHold('forbidden')).toBe(false);
  });
  it('「出せるにする」は hold_reason が heavy・flagged の時だけ', () => {
    expect(T.heldActions(held({ hold_reason: 'heavy' }))).toEqual(['approve', 'reject']);
    expect(T.heldActions(held({ hold_reason: 'flagged' }))).toEqual(['approve', 'reject']);
    for (const r of ['source_not_found', 'source_unsupported', 'source_unreachable', 'source_lost', 'schema', 'forbidden', 'check_failed', 'duplicate_race', null]) {
      expect(T.heldActions(held({ hold_reason: r }))).not.toContain('approve');
      expect(T.heldActions(held({ hold_reason: r }))).toContain('recheck');
      expect(T.heldActions(held({ hold_reason: r }))).toContain('reject');
    }
  });
  it('「見直す」は見直しの親にできる held（source_lost・source_unreachable）の時だけ（T-9）', () => {
    expect(T.heldActions(held({ hold_reason: 'source_lost' }))).toEqual(['recheck', 'refresh', 'reject']);
    expect(T.heldActions(held({ hold_reason: 'source_unreachable' }))).toEqual(['recheck', 'refresh', 'reject']);
    expect(T.heldActions(held({ hold_reason: 'source_not_found' }))).toEqual(['recheck', 'reject']);
    expect(T.heldActions(held({ hold_reason: 'forbidden' }))).toEqual(['recheck', 'reject']);
  });
  it('held でなければ何も出さない（承認した後の行など）', () => {
    expect(T.heldActions(held({ status: 'ready', hold_reason: null }))).toEqual([]);
    expect(T.heldActions(held({ status: 'rejected' }))).toEqual([]);
    expect(T.heldActions(null)).toEqual([]);
  });
});

describe('「出せるにする」を押せるか・送る中身（T-3 人が承認する述語）', () => {
  it('詳細（全文）がまだ無い時は押せない', () => {
    const s = T.approveState(held(), null, false);
    expect(s).toMatchObject({ show: true, enabled: false });
  });
  it('気になる点だけ・最新の検査が同じ sha で approvable → 押せる。read_all は送らない', () => {
    const t = held();
    const s = T.approveState(t, detailOf(t, [check({ attempt: 1, approvable: 0 }), check()]), false);
    expect(s.enabled).toBe(true);
    expect(s.body).toEqual({ decision: 'approve', content_sha256: SHA });
  });
  it('重い話題は「全文を読んだ」のチェックまで押せず、押した時は read_all: true と content_sha256 を送る', () => {
    const t = held({ hold_reason: 'heavy', sensitivity: 'heavy' });
    const d = detailOf(t, [check({ verdict: 'green', reasons_json: '[]', sensitivity: 'heavy' })]);
    const off = T.approveState(t, d, false);
    expect(off.enabled).toBe(false);
    expect(off.why).toContain('全文を読んだ');
    const on = T.approveState(t, d, true);
    expect(on.enabled).toBe(true);
    expect(on.body).toEqual({ decision: 'approve', content_sha256: SHA, read_all: true });
  });
  it('気になる点で止まった重い話題（hold_reason = flagged・sensitivity = heavy）もチェックが要る', () => {
    const t = held({ hold_reason: 'flagged', sensitivity: 'heavy' });
    const d = detailOf(t, [check({ sensitivity: 'heavy' })]);
    expect(T.approveState(t, d, false).enabled).toBe(false);
    expect(T.approveState(t, d, true).body).toEqual({ decision: 'approve', content_sha256: SHA, read_all: true });
  });
  it.each([
    ['出典が見つからない', 'source_not_found'],
    ['出典が支えていない', 'source_unsupported'],
    ['出典を開けない', 'source_unreachable'],
    ['見直しで出典が消えた（前の検査が緑でも）', 'source_lost'],
    ['形', 'schema'],
    ['禁止語', 'forbidden'],
    ['検査の失敗', 'check_failed'],
    ['重複の競合', 'duplicate_race'],
  ])('%s の held には出さない', (_n, r) => {
    const t = held({ hold_reason: r });
    const s = T.approveState(t, detailOf(t, [check({ verdict: 'green', reasons_json: '[]' })]), true);
    expect(s.show).toBe(false);
    expect(s.enabled).toBe(false);
  });
  it('最新の検査が承認できない結果（approvable = 0）なら押せない', () => {
    const t = held();
    expect(T.approveState(t, detailOf(t, [check({ approvable: 0 })]), true).enabled).toBe(false);
    expect(T.approveState(t, detailOf(t, [check({ approvable: false })]), true).enabled).toBe(false);
  });
  it('最新の検査が別の本文（sha 違い）・最新の attempt の記録が無い・sha が無い時は押せない', () => {
    const t = held();
    expect(T.approveState(t, detailOf(t, [check({ content_sha256: 'b'.repeat(64) })]), true).enabled).toBe(false);
    expect(T.approveState(t, detailOf(t, [check({ attempt: 1 })]), true).enabled).toBe(false); // check_attempts = 2 の記録が無い
    expect(T.approveState(t, detailOf(t, []), true).enabled).toBe(false);
    const noSha = held({ content_sha256: '' });
    expect(T.approveState(noSha, detailOf(noSha, [check()]), true).enabled).toBe(false);
  });
  it('詳細の状態が一覧より新しければ詳細に従う（一覧では held でも詳細で ready なら出さない）', () => {
    const listRow = held();
    const now = held({ status: 'ready', hold_reason: null });
    expect(T.approveState(listRow, detailOf(now, [check()]), true).show).toBe(false);
  });
});

describe('表示名（GET /api/topics/meta。取れなければコードのまま）', () => {
  const meta = T.normalizeMeta({
    enabled: true,
    kinds: { news: 'ニュースから', talk: '話し合い' },
    slots: { news: 2, make: 3 },
    reasons: { heavy: '重い話題', flagged: '気になる点', one_sided: '1 つの立場に寄っている', schema: '形' },
  })!;
  it('種類・理由の表示名', () => {
    expect(T.kindText('news', meta)).toBe('ニュースから');
    expect(T.kindText('philo', meta)).toBe('philo');
    expect(T.reasonText('heavy', meta)).toBe('重い話題');
    expect(T.reasonText('flagged:one_sided', meta)).toBe('気になる点（1 つの立場に寄っている）');
    expect(T.reasonText('schema:too_long', meta)).toBe('形（too_long）');
    expect(T.reasonText('unknown_code', meta)).toBe('unknown_code');
    expect(meta.slots).toEqual({ news: 2, make: 3 });
  });
  it('配列の形でも受ける', () => {
    const m = T.normalizeMeta({ enabled: false, kinds: [{ kind: 'make', label: '作る' }], slots: [{ kind: 'make', count: 3 }], reasons: [{ code: 'cap', label: '上限' }] })!;
    expect(T.kindText('make', m)).toBe('作る');
    expect(m.slots.make).toBe(3);
    expect(T.reasonText('cap', m)).toBe('上限');
    expect(m.enabled).toBe(false);
  });
  it('meta が無い時はコードのまま', () => {
    expect(T.normalizeMeta(null)).toBeNull();
    expect(T.kindText('news', null)).toBe('news');
    expect(T.reasonText('flagged:one_sided', null)).toBe('flagged:one_sided');
  });
});

describe('サーバーの 400 / 409 の理由を文で出す', () => {
  const err = (status: number, body: unknown) => Object.assign(new Error('x'), { status, body });
  it('not_approvable・read_all_required・sha 違い・状態違い', () => {
    expect(T.errorText(err(400, { error: 'not_approvable' }), null)).toContain('「出せるにする」ができません');
    expect(T.errorText(err(400, { error: 'read_all_required' }), null)).toContain('全文を読んだ');
    expect(T.errorText(err(409, { error: 'sha_mismatch' }), null)).toContain('本文が変わっています');
    expect(T.errorText(err(409, { error: 'state_conflict' }), null)).toContain('状態が変わっています');
  });
  it('知らない 409 も「読み込み直して」の文にする。400 の理由コードの配列は表示名で並べる', () => {
    expect(T.errorText(err(409, { error: 'whatever' }), null)).toContain('読み込み直してください');
    expect(T.errorText(err(409, null), null)).toContain('読み込み直してください');
    const meta = T.normalizeMeta({ reasons: { 'schema:asks_count': '問いの数' } });
    expect(T.errorText(err(400, { error: 'invalid_body', reasons: ['schema:asks_count'] }), meta)).toContain('問いの数');
  });
  it('通信の失敗（status なし）', () => {
    expect(T.errorText(new Error('Failed to fetch'), null)).toContain('通信できませんでした');
  });
});

describe('今日と明日（Asia/Tokyo）', () => {
  it('UTC 15:00 を境に日付が進む', () => {
    expect(T.tokyoDay(new Date('2026-11-06T14:59:59Z'), 0)).toBe('2026-11-06');
    expect(T.tokyoDay(new Date('2026-11-06T15:00:00Z'), 0)).toBe('2026-11-07');
    expect(T.tokyoDay(new Date('2026-11-06T14:59:59Z'), 1)).toBe('2026-11-07');
    expect(T.tokyoDay(new Date('2026-12-31T16:00:00Z'), 1)).toBe('2027-01-02');
  });
});

describe('textContent で出す（innerHTML を使わない）', () => {
  it('topics.js に innerHTML・insertAdjacentHTML・outerHTML・document.write が無い', () => {
    expect(code).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML|document\.write/);
  });
  it('fetch を直接呼ばない（admin.js の api を ctx で受けて /api/* だけ）', () => {
    expect(code).not.toMatch(/\bfetch\s*\(/);
    const paths = [...code.matchAll(/api\('(?:GET|POST)', '([^']+)'/g)].map((m) => m[1]);
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) expect(p.startsWith('/api/')).toBe(true);
  });
});
