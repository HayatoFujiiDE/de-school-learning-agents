// §N-7 係のパネル（1 段目）: stationPanelHtml・floorQueueHtml（filter あり）・あなたの番の追加・メニュー（index.html）。
// public/admin/floor-scene.js と admin.js を同じ window に node:vm で起動せず読む（status-band.test.ts と同じ読み方）。
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

interface FloorUi {
  STATION_PANEL: Record<string, unknown>;
  stationPanelHtml(id: string, floor: unknown, status: unknown): string;
  floorQueueHtml(queue: unknown, opts: unknown): string;
  floorBandHtml(att: unknown, errAt: string | null, more?: unknown): string;
}

const win: Record<string, unknown> = { __FACTORY_ADMIN_NO_BOOT__: true };
const ctx = vm.createContext({ window: win, console });
vm.runInContext(readFileSync(new URL('../public/admin/floor-scene.js', import.meta.url), 'utf8'), ctx, { timeout: 2000 });
vm.runInContext(readFileSync(new URL('../public/admin/admin.js', import.meta.url), 'utf8'), ctx, { timeout: 2000 });
const F = win.FactoryAdminFloor as FloorUi;
const n = (html: string, re: RegExp) => (html.match(re) || []).length;
const EVIL = '<img src=x onerror=alert(1)>';
const ALL = ['intake', 'meeting', 'maker', 'clerk', 'questions', 'autofix', 'rework', 'verifier', 'reviewer', 'library', 'retro', 'topics'];

const floor = (o: Record<string, Record<string, unknown>> = {}) => {
  const s: Record<string, Record<string, unknown>> = {
    intake: { proposed: 4, scout_running: false, meeting_pending: false, last_scout_at: null, last_meeting_at: null },
    maker: { queued: 1, creating: 0, running: 1, needs_answer: 1, budget_reached: 0, max_concurrent: 2 },
    clerk: { ingesting: 0, failed_invalid_outputs: 0 },
    verifier: { pending: 0, running: 1, failed: 0 },
    reviewer: { waiting: 1, needs_review_total: 3 },
    library: { available: 12, stopped: 1 },
    rework: { auto_active: 0, manual_active: 0 },
    retro: { pending: 0, last_retro_at: null, last_tips_activated: 0, active_maker_notes: 2 },
  };
  for (const k of Object.keys(o)) s[k] = { ...s[k], ...o[k] };
  return { now: '2026-11-07T12:00:00.000Z', attention: { answer: 1, review: 1, failed: 0, budget: 0 }, stations: s, queue: [] };
};
const status = (o: Record<string, unknown> = {}) => ({
  paused: false,
  scout: { last_run_at: '2026-11-07T10:00:00.000Z', last_status: 'done', month_cents: 120, month_cap_cents: 2000, running: false },
  meeting: { last_at: '2026-11-06T10:00:00.000Z', last_status: 'ended', month_cents: 50, month_cap_cents: 1000, pending_batch: false },
  images: { halted: null, month_cents: 170, month_cap_cents: 10000 },
  videos: { enabled: true },
  topics: { enabled: true, needs_review: { heavy: 1, source: 2, other: 0 }, month_cents: 312, month_cap_cents: 3000, today: { empty: 0, stopped: 1 }, tomorrow: { empty: 2, stopped: 0 } },
  ...o,
});
/** パネルの段（data-sp）の並び */
const sections = (html: string) => [...html.matchAll(/data-sp="(\w+)"/g)].map((m) => m[1]);

describe('stationPanelHtml: 12 の係すべて', () => {
  it('表に 12 の係（お題係を含む）があり、どれも例外なし・見出し / ひとこと / 事実 の順・✕（data-fq-clear）が 1 個', () => {
    expect(Object.keys(F.STATION_PANEL).sort()).toEqual([...ALL].sort());
    for (const id of ALL) {
      for (const [fl, st] of [[floor(), status()], [null, null], [floor(), null], [{}, {}]] as const) {
        const h = F.stationPanelHtml(id, fl, st);
        expect([id, h.startsWith('<div class="sp" data-sp-station="' + id + '"')]).toEqual([id, true]);
        const sec = sections(h);
        expect(sec.slice(0, 2)).toEqual(['head', 'role']);
        // 段は型の順（head → role → facts → actions → links）。無い段は飛ばす
        const order = ['head', 'role', 'facts', 'actions', 'links'];
        expect(sec.map((x) => order.indexOf(x))).toEqual([...sec.map((x) => order.indexOf(x))].sort((a, b) => a - b));
        expect(n(h, /data-fq-clear="1"/g)).toBe(1);
      }
    }
  });

  it('floorQueueHtml（filter あり）は パネル → この係にいる素材 の順（⑥ は最後）', () => {
    for (const id of ALL) {
      const h = F.floorQueueHtml([], { filter: id, floor: floor(), status: status() });
      const sec = sections(h);
      expect([id, sec[0], sec[sec.length - 1]]).toEqual([id, 'head', 'items']);
    }
    expect(F.floorQueueHtml([], { filter: 'retro', floor: floor(), status: status() })).toContain('この係は素材を持ちません');
    expect(F.floorQueueHtml([], { filter: 'topics', floor: floor(), status: status() })).toContain('この係は素材を持ちません');
    expect(F.floorQueueHtml([], { filter: 'maker', floor: floor(), status: status() })).toContain('職人にいる素材はありません');
    // panel: false（画面では別の容器 #station-panel に置く）なら表の段だけ
    expect(sections(F.floorQueueHtml([], { filter: 'maker', floor: floor(), panel: false }))).toEqual(['items']);
  });

  it('ボタンは入口に #scout-btn が 1 個・会議に #meeting-btn が 1 個だけ。ほかの係にボタンは ✕ だけ', () => {
    for (const id of ALL) {
      const h = F.stationPanelHtml(id, floor(), status());
      const buttons = n(h, /<button/g);
      expect([id, n(h, /id="scout-btn"/g)]).toEqual([id, id === 'intake' ? 1 : 0]);
      expect([id, n(h, /id="meeting-btn"/g)]).toEqual([id, id === 'meeting' ? 1 : 0]);
      expect([id, buttons]).toEqual([id, id === 'intake' || id === 'meeting' ? 2 : 1]);
    }
    const it = F.stationPanelHtml('intake', floor(), status());
    expect(it).toContain('id="scout-btn">収集を今すぐ</button>');
    expect(F.stationPanelHtml('meeting', floor(), status())).toContain('id="meeting-btn">会議を今すぐ</button>');
  });

  it('今すぐのボタン: 停止中は disabled + title・収集中 / 結果待ちは今の文と disabled（状況帯にあった時と同じ）', () => {
    const p = status({ paused: true });
    expect(F.stationPanelHtml('intake', floor(), p)).toContain('id="scout-btn" disabled title="停止中は実行できません">収集を今すぐ</button>');
    expect(F.stationPanelHtml('meeting', floor(), p)).toContain('id="meeting-btn" disabled title="停止中は実行できません">会議を今すぐ</button>');
    const busy = status({ scout: { ...status().scout, running: true }, meeting: { ...status().meeting, pending_batch: true } });
    expect(F.stationPanelHtml('intake', floor(), busy)).toContain('id="scout-btn" disabled>収集中…</button>');
    expect(F.stationPanelHtml('meeting', floor(), busy)).toContain('id="meeting-btn" disabled>結果待ち</button>');
  });

  it('status が未着（null）なら status の事実とボタンは「読み込み中…」（floor の事実は出る）', () => {
    const it = F.stationPanelHtml('intake', floor(), null);
    expect(it).toContain('4 件');
    expect(n(it, /data-sp-loading="1"/g)).toBe(3); // 収集の最終・今月の収集・ボタン
    expect(it).toMatch(/id="scout-btn" disabled data-sp-loading="1">読み込み中…<\/button>/);
    expect(F.stationPanelHtml('meeting', floor(), null)).toMatch(/id="meeting-btn" disabled data-sp-loading="1">読み込み中…<\/button>/);
    expect(F.stationPanelHtml('topics', floor(), null)).toContain('読み込み中…');
    expect(F.stationPanelHtml('maker', floor(), null)).toContain('読み込み中…');
    // floor も未着なら floor の事実も読み込み中
    expect(F.stationPanelHtml('library', null, null)).toContain('読み込み中…');
    // 全部届けば読み込み中は無い
    for (const id of ALL) expect([id, F.stationPanelHtml(id, floor(), status()).includes('読み込み中')]).toEqual([id, false]);
  });

  it('係ごとの事実と入口', () => {
    const h = (id: string) => F.stationPanelHtml(id, floor(), status());
    expect(h('intake')).toContain('href="#/proposals"');
    expect(h('intake')).toContain('href="#/new"');
    expect(h('intake')).toContain('$1.20 / $20');
    expect(h('meeting')).toContain('href="#/proposals?at=minutes"');
    expect(h('meeting')).toContain('$0.50 / $10');
    expect(h('maker')).toContain('1 / 最大 2');
    expect(h('maker')).toContain('$1.70 / $100');
    for (const href of ['#/standards', '#/images', '#/retro']) expect(h('maker')).toContain(`href="${href}"`);
    const halted = F.stationPanelHtml('maker', floor(), status({ images: { halted: 'manual', month_cents: 10, month_cap_cents: 10000 } }));
    expect(halted).toContain('sp-fact sp-red');
    expect(halted).toContain('停止中');
    expect(h('verifier')).toContain('href="#/videos"');
    expect(h('verifier')).toContain('有効');
    expect(h('reviewer')).toContain('class="btn primary small sp-link" href="#/review"');
    expect(h('reviewer')).not.toContain('自動公開'); // /api/floor・/api/status から取れないので出さない
    for (const href of ['#/materials', '#/materials?publish=available', '#/models3d', '#/images']) expect(h('library')).toContain(`href="${href}"`);
    expect(h('library')).toContain('12 本');
    expect(h('retro')).toContain('data-retro-floor="1"');
    expect(h('retro')).toContain('href="#/retro"');
    expect(h('topics')).toContain('href="#/topics"');
    expect(h('topics')).toContain('今日 空き 0・止まり 1');
    expect(h('topics')).toContain('明日 空き 2・止まり 0');
    expect(h('topics')).toContain('3 件');
    expect(h('topics')).toContain('$3.12 / $30');
    expect(h('topics')).toContain('今日のお題を開く ›');
    expect(h('topics')).toContain('data-sp-pill="human">お題の要確認 3</span>');
    for (const id of ['clerk', 'questions', 'autofix', 'rework']) {
      const x = h(id);
      expect([id, sections(x)]).toEqual([id, ['head', 'role', 'facts']]);
    }
  });

  it('外から来た値は esc を通す', () => {
    const bad = status({
      paused: false,
      scout: { last_run_at: EVIL, last_status: EVIL, month_cents: 0, month_cap_cents: 0 },
      meeting: { last_at: EVIL, last_status: EVIL },
      images: { halted: EVIL, month_cents: 0, month_cap_cents: 0 },
    });
    for (const id of ALL) {
      const x = F.stationPanelHtml(id, floor({ retro: { last_retro_at: EVIL } }), bad);
      expect([id, x.includes('<img')]).toEqual([id, false]);
    }
  });
});

describe('あなたの番（工場の帯）: 提案の判断・お題の要確認', () => {
  it('0 件なら出ず、ほかも 0 なら「あなたの番の作業はありません」', () => {
    const h = F.floorBandHtml({ answer: 0, review: 0, failed: 0, budget: 0 }, null, { proposed: 0, topicsReview: 0 });
    expect(h).toContain('あなたの番の作業はありません');
    expect(h).not.toContain('data-floor-link');
    expect(F.floorBandHtml({}, null)).toContain('あなたの番の作業はありません');
  });
  it('n 件なら出て、行き先は提案箱・今日のお題の要確認タブ（topics.js の TABS の held = #/topics/held）', () => {
    const h = F.floorBandHtml({ answer: 1, review: 2, failed: 0, budget: 0 }, null, { proposed: 4, topicsReview: 3 });
    expect(h).toContain('<a class="floor-att yellow" href="#/proposals" data-floor-link="proposed">提案の判断 4</a>');
    expect(h).toContain('<a class="floor-att yellow" href="#/topics/held" data-floor-link="topicsReview">お題の要確認 3</a>');
    expect(h).toContain('data-floor-goto="answer"');
    expect(h).toContain('data-floor-goto="review"');
    const only = F.floorBandHtml({}, null, { proposed: 0, topicsReview: 2 });
    expect(only).toContain('<span class="floor-band-title">あなたの番</span>');
    expect(only).not.toContain('あなたの番の作業はありません');
    expect(only).not.toContain('提案の判断');
  });
  it('要確認タブの hash は topics.js の topicsHash("held") と同じ', () => {
    const tw: Record<string, unknown> = {};
    vm.runInNewContext(readFileSync(new URL('../public/admin/topics.js', import.meta.url), 'utf8'), { window: tw, console }, { timeout: 2000 });
    const T = tw.FactoryTopics as { topicsHash?: (t: string) => string };
    if (T && typeof T.topicsHash === 'function') expect(T.topicsHash('held')).toBe('#/topics/held');
    else expect(readFileSync(new URL('../public/admin/topics.js', import.meta.url), 'utf8')).toContain("['held', '要確認', 'held']");
  });
});

describe('メニュー（index.html）', () => {
  const html = readFileSync(new URL('../public/admin/index.html', import.meta.url), 'utf8');
  it('工場 / 確認待ち / 道具と記録 ▾（details）。href="#/" と href="#/materials" がある（smoke n3）', () => {
    expect(html).toContain('href="#/"');
    expect(html).toContain('href="#/materials"');
    const nav = html.slice(html.indexOf('<nav'), html.indexOf('</nav>'));
    const outside = nav.slice(0, nav.indexOf('<details'));
    expect([...outside.matchAll(/href="([^"]+)"/g)].map((m) => m[1])).toEqual(['#/', '#/review']);
    expect(nav).toContain('<details class="nav-more">');
    expect(nav).toContain('<summary>道具と記録</summary>');
  });
  it('details の中に全部の画面のリンク（グループ見出し付き）。表示名は「今日のお題」', () => {
    const det = html.slice(html.indexOf('<details'), html.indexOf('</details>'));
    expect([...det.matchAll(/href="([^"]+)"/g)].map((m) => m[1])).toEqual(['#/proposals', '#/new', '#/standards', '#/images', '#/videos', '#/materials', '#/models3d', '#/topics', '#/retro']);
    expect([...det.matchAll(/<span class="nav-grp-h">([^<]+)<\/span>/g)].map((m) => m[1])).toEqual(['入口', '制作', '倉庫', 'そのほか']);
    expect(det).toContain('<a href="#/topics">今日のお題</a>');
    expect(html).not.toContain('お題の棚');
  });
});
