// 収集部隊（§K-4）: RSS/Atom の parse・仕分けの入力と出力・xAI 応答の読み方と費用、
// run 全体（node:sqlite の実 DB + fixture の port / fetch）で §K-8 (q)(s) と「失敗は止まり再試行しない」を確かめる。
import { beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { PortError } from '../src/anthropic';
import type { Env } from '../src/env';
import { SCOUT_FEEDS } from '../src/generated/scout-sources';
import {
  SCOUT_CALL_LIMITS,
  SCOUT_LIMITS,
  acceptableFeedType,
  buildScoutInput,
  cleanText,
  newerThan,
  parseFeed,
  parseScoutOutput,
  runScout,
  scoutDueOn,
  tokyoWeekday,
} from '../src/scout';
import { parseXaiResponse, xaiMicroDollars } from '../src/xai';
import { claimSetting } from '../src/db';
import { d1, migratedDb, one, rows } from './d1-shim';
import { fixture, fixtureJson, intakePort } from './intake-port';

const NOW = new Date('2026-11-09T01:00:00.000Z'); // 月曜（Asia/Tokyo 10:00）
const fill = (xml: string, now = NOW) =>
  xml.replace(/\{\{DAYS_AGO_(RFC822|ISO):(\d+)\}\}/g, (_m, f: string, n: string) => {
    const d = new Date(now.getTime() - Number(n) * 86_400_000);
    return f === 'ISO' ? d.toISOString() : d.toUTCString();
  });

describe('RSS / Atom の parse', () => {
  it('RSS: CDATA と HTML（エスケープされたものも）を剥がし、実体参照を戻す', () => {
    const items = parseFeed(fill(fixture('scout/feed-rss.xml')), 0);
    expect(items).toHaveLength(3);
    expect(items[0].title).toBe('Pico で温度を測る作例を公開');
    expect(items[0].summary).toBe('マイコンボードの内蔵センサーで 温度 を読み、グラフにする作例です。& 配線は不要。');
    expect(items[0].link).toBe('https://example.org/news/pico-temperature');
    expect(items[1].title).toBe('Scratch & センサーの拡張機能');
    expect(items[1].summary).toBe('ブロックで光センサーの値を扱える拡張が公開されました。');
    expect(items[2].date).toBe('2020-01-06T00:00:00.000Z');
  });

  it('Atom: link rel="alternate" の href、updated、content を読む', () => {
    const items = parseFeed(fill(fixture('scout/feed-atom.xml')), 1);
    expect(items.map((i) => i.link)).toEqual(['https://example.org/releases/v3.0', 'https://example.org/releases/v1.0']);
    expect(items[0].summary).toBe('図形を描く命令が増えました');
    expect(items[0].feed).toBe(1);
  });

  it('前回 run 以降だけ残す。日付の読めない項目は残さない', () => {
    const items = [...parseFeed(fill(fixture('scout/feed-rss.xml')), 0), ...parseFeed(fill(fixture('scout/feed-atom.xml')), 1)];
    const since = new Date(NOW.getTime() - 7 * 86_400_000).toISOString();
    expect(newerThan(items, since).map((i) => i.title)).toEqual(['Pico で温度を測る作例を公開', 'Scratch & センサーの拡張機能', 'v3.0 リリース: 新しいタートル描画']);
    expect(newerThan([{ feed: 0, title: 't', link: null, date: null, summary: '' }], since)).toEqual([]);
  });

  it('1 フィード 50 件まで、本文は 500 文字まで', () => {
    const xml = `<rss><channel>${Array.from({ length: 60 }, (_, i) => `<item><title>t${i}</title><description>${'あ'.repeat(800)}</description></item>`).join('')}</channel></rss>`;
    const items = parseFeed(xml);
    expect(items).toHaveLength(SCOUT_LIMITS.itemsPerFeed);
    expect(items[0].summary.length).toBe(SCOUT_LIMITS.itemChars);
  });

  it('script / style の中身は本文に残さない', () => {
    expect(cleanText('<p>a<script>alert(1)</script>b</p>&lt;style&gt;x{}&lt;/style&gt;c')).toBe('a b c');
  });

  it('content-type は text/xml と application/(rss|atom)+xml、application/xml だけ', () => {
    expect(acceptableFeedType('application/rss+xml; charset=utf-8')).toBe(true);
    expect(acceptableFeedType('application/atom+xml')).toBe(true);
    expect(acceptableFeedType('text/xml')).toBe(true);
    expect(acceptableFeedType('application/xml')).toBe(true);
    expect(acceptableFeedType('text/html')).toBe(false);
    expect(acceptableFeedType(null)).toBe(false);
  });
});

describe('仕分けの入力と出力', () => {
  it('合計 60,000 文字を超えた分は捨てて dropped に数える', () => {
    const items = Array.from({ length: 200 }, (_, i) => ({ feed: 0, title: `t${i}`, link: null, date: null, summary: 'x'.repeat(490) }));
    const r = buildScoutInput(items, '- a\n- b', ['既存'], [{ id: 'm1', title: '素材', kinds: '[3]' }]);
    expect(r.used + r.dropped).toBe(202);
    expect(r.dropped).toBeGreaterThan(0);
    expect(r.text).toContain('<existing_proposals>\n- 既存');
    expect(r.text).toContain('- id=m1 | 素材 | kinds=[3]');
  });

  it('出力の形が違えば null', () => {
    expect(parseScoutOutput('not json')).toBeNull();
    expect(parseScoutOutput('{"items":[{"verdict":"maybe","title":"t","body":"b"}]}')).toBeNull();
    expect(parseScoutOutput('{"items":[{"verdict":"new","title":"t","body":"b","reason":"r"}]}')?.[0].verdict).toBe('new');
  });
});

describe('xAI 応答の読み方と費用', () => {
  it('output の message.content[].output_text と annotations / 本文の URL、usage の field を取り出す', () => {
    const x = parseXaiResponse(fixtureJson('scout/xai.json'));
    expect(x.status).toBe('completed');
    expect(x.text.split('\n')).toHaveLength(2);
    expect(x.urls).toEqual(['https://x.com/example/status/1000000000000000001', 'https://x.com/example/status/1000000000000000002']);
    expect(x.usage).toEqual({ input_tokens: 4000, cached_tokens: 1000, output_tokens: 600, reasoning_tokens: 200, x_posts_fetched: 12, x_users_fetched: 0, cost_in_usd_ticks: null });
  });

  it('定価で計算（grok-4.3 + 投稿 $5/1k）。表に無いモデルは null。cost_in_usd_ticks が大きければそちら', () => {
    const u = parseXaiResponse(fixtureJson('scout/xai.json')).usage;
    // 3000×1.25 + 1000×0.20 + 600×2.50 + 12×5000 = 65,450 micro-dollars
    expect(xaiMicroDollars('grok-4.3', u)).toBe(65_450);
    expect(xaiMicroDollars('grok-unknown', u)).toBeNull();
    expect(xaiMicroDollars('grok-4.3', { ...u, cost_in_usd_ticks: 2_000_000_000 })).toBe(200_000); // $0.2
  });
});

describe('週 1 の判定', () => {
  it('SCOUT_DAY の曜日（Asia/Tokyo）で、scout_last_day が今日でない時だけ', () => {
    expect(tokyoWeekday(NOW)).toBe(1);
    expect(scoutDueOn(1, null, NOW)).toBe(true);
    expect(scoutDueOn(1, '2026-11-09', NOW)).toBe(false);
    expect(scoutDueOn(2, null, NOW)).toBe(false);
    expect(scoutDueOn(7, null, NOW)).toBe(false);
    // 日曜 23:30 JST は月曜ではない
    expect(scoutDueOn(1, null, new Date('2026-11-08T14:30:00.000Z'))).toBe(false);
  });
});

describe('runScout（node:sqlite の実 DB + fixture）', () => {
  let raw: DatabaseSync;
  let env: Env;
  let fetches: string[];
  const feedFetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    fetches.push(url);
    const i = SCOUT_FEEDS.indexOf(url);
    if (i === 0) return new Response(fill(fixture('scout/feed-rss.xml'), new Date()), { headers: { 'content-type': 'application/rss+xml' } });
    if (i === 1) return new Response(fill(fixture('scout/feed-atom.xml'), new Date()), { headers: { 'content-type': 'application/atom+xml' } });
    return new Response('<html></html>', { headers: { 'content-type': 'text/html' } });
  }) as typeof fetch;
  const opts = () => ({ trigger: 'manual' as const, deadline: Date.now() + 25_000, fetchImpl: feedFetch });

  beforeEach(() => {
    raw = migratedDb();
    fetches = [];
    env = { DB: d1(raw), DAILY_CAP_CENTS: '1500', SCOUT_MONTHLY_CAP_CENTS: '500', SCOUT_XAI_MODEL: 'grok-4.3', SCOUT_MAX_TURNS: '2', XAI_API_KEY: 'xai-test-not-a-key' } as unknown as Env;
  });

  it('(q) RSS 2 本 + xAI + Haiku で done。scout の提案と cost_ledger(scout) が入る', async () => {
    const p = intakePort();
    const r = await runScout(env, p.port, opts());
    expect(r.status).toBe('done');
    if (r.status !== 'done') return;
    expect(r.rss_items).toBe(3); // RSS 2 + Atom 1（古い 2 件は落ちる）
    expect(r.x_posts).toBe(12);
    expect(r.proposed).toBe(2);
    expect(r.dropped).toBe(2); // drop 1 + 禁止語 1
    expect(p.calls).toEqual({ xaiResponses: 1, createMessage: 1 });
    expect(fetches.length).toBe(Math.min(SCOUT_FEEDS.length, SCOUT_CALL_LIMITS.rss));
    const run = one(raw, 'SELECT status, rss_items, x_posts, proposed, dropped, cents FROM scout_runs WHERE id = ?', r.run_id);
    expect(run).toMatchObject({ status: 'done', rss_items: 3, x_posts: 12, proposed: 2, dropped: 2 });
    const props = rows(raw, "SELECT source_kind, source_ref, title, concept_codes_json, evidence_json FROM proposals ORDER BY title");
    expect(props.map((x) => x.source_kind)).toEqual(['scout', 'scout']);
    expect(props.every((x) => x.source_ref === r.run_id)).toBe(true);
    expect(JSON.parse(String(props.find((x) => String(x.title).startsWith('マイコン'))?.concept_codes_json))).toEqual(['SCI01']);
    const ledger = rows(raw, "SELECT kind, cents FROM cost_ledger WHERE ref_id = ? ORDER BY cents DESC", r.run_id);
    expect(ledger).toEqual([
      { kind: 'scout', cents: 7 }, // xAI 65,450 micro
      { kind: 'scout', cents: 1 }, // Haiku 5000×0.1 + 900×0.5 = 950 micro
    ]);
    expect(run.cents).toBe(8);
    // xAI へ渡した形（§K-4-3）
    const req = p.last.xaiResponses as { tools: Array<Record<string, unknown>>; max_turns: number; store: boolean };
    expect(req.tools[0].type).toBe('x_search');
    expect(req.max_turns).toBe(2);
    expect(req.store).toBe(false);
    const hp = p.last.createMessage as { model: string; max_tokens: number; output_config: { format: { type: string } } };
    expect(hp.model).toBe('claude-haiku-5-5');
    expect(hp.max_tokens).toBe(4096);
    expect(hp.output_config.format.type).toBe('json_schema');
    // settings に本文を入れない（lock は空に戻る）
    expect(rows(raw, 'SELECT key, value FROM settings')).toEqual([{ key: 'scout_run_lock', value: '' }]);
  });

  it('(q) XAI_API_KEY 無しでも RSS だけで done（X 検索は呼ばない）', async () => {
    delete (env as { XAI_API_KEY?: string }).XAI_API_KEY;
    const p = intakePort();
    const r = await runScout(env, p.port, opts());
    expect(r).toMatchObject({ status: 'done', x_posts: 0, proposed: 2 });
    expect(p.calls).toEqual({ createMessage: 1 });
  });

  it('(s) 月次上限 0 で skipped。外部（RSS / xAI / Haiku）を 1 つも呼ばない', async () => {
    (env as unknown as Record<string, string>).SCOUT_MONTHLY_CAP_CENTS = '0';
    const p = intakePort();
    const r = await runScout(env, p.port, opts());
    expect(r).toMatchObject({ status: 'skipped', reason: 'monthly_cap' });
    expect(p.calls).toEqual({});
    expect(fetches).toEqual([]);
    expect(one(raw, 'SELECT status, last_error FROM scout_runs')).toEqual({ status: 'skipped', last_error: 'monthly_cap' });
  });

  it('日次上限（DAILY_CAP_CENTS）に達していても skipped', async () => {
    raw.prepare("INSERT INTO cost_ledger VALUES ('c1', ?, 'session', 'j', 1500, 't')").run(new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10));
    const r = await runScout(env, intakePort().port, opts());
    expect(r).toMatchObject({ status: 'skipped', reason: 'daily_cap' });
  });

  it('pause 中は何もしない（行も作らない）。走行中（lock 有効）は already_running', async () => {
    raw.prepare("INSERT INTO settings VALUES ('paused', '1', 't')").run();
    expect(await runScout(env, intakePort().port, opts())).toEqual({ status: 'paused' });
    raw.prepare("UPDATE settings SET value = '0' WHERE key = 'paused'").run();
    raw.prepare("INSERT INTO settings VALUES ('scout_run_lock', 'other', ?)").run(new Date().toISOString());
    expect(await runScout(env, intakePort().port, opts())).toEqual({ status: 'already_running' });
    expect(one(raw, 'SELECT COUNT(*) AS c FROM scout_runs').c).toBe(0);
  });

  it('RSS の取得失敗は failed（種別だけ）で止まり、xAI / Haiku を呼ばない', async () => {
    const p = intakePort();
    const bad = (async () => new Response('x', { status: 503 })) as typeof fetch;
    const r = await runScout(env, p.port, { ...opts(), fetchImpl: bad });
    expect(r).toMatchObject({ status: 'failed', error: 'rss_http_503' });
    expect(p.calls).toEqual({});
  });

  it('Haiku の 429 は failed（haiku_429）。自動再試行しない（1 回だけ）。xAI の費用は残る', async () => {
    const p = intakePort({
      createMessage: async () => {
        throw new PortError(true, 429, 'api_error');
      },
    });
    const r = await runScout(env, p.port, opts());
    expect(r).toMatchObject({ status: 'failed', error: 'haiku_429', proposed: 0 });
    expect(p.calls.createMessage).toBe(1);
    expect(one(raw, "SELECT SUM(cents) AS c FROM cost_ledger WHERE kind = 'scout'").c).toBe(7);
    expect(one(raw, 'SELECT COUNT(*) AS c FROM proposals').c).toBe(0);
  });

  it('xAI の 5xx は failed（xai_503）で Haiku を呼ばない', async () => {
    const { XaiError } = await import('../src/xai');
    const p = intakePort({
      xaiResponses: async () => {
        throw new XaiError(true, 503, 'api_error');
      },
    });
    const r = await runScout(env, p.port, opts());
    expect(r).toMatchObject({ status: 'failed', error: 'xai_503' });
    expect(p.calls).toEqual({ xaiResponses: 1 });
  });

  it('時間切れ（deadline 経過）は failed（deadline）で外部を呼ばない', async () => {
    const p = intakePort();
    const r = await runScout(env, p.port, { ...opts(), deadline: Date.now() - 1 });
    expect(r).toMatchObject({ status: 'failed', error: 'deadline' });
    expect(fetches).toEqual([]);
  });

  it('2 回目の run は前回 done 以降の項目だけを見る（同じ fixture なら RSS 0 件で Haiku を呼ばない）', async () => {
    delete (env as { XAI_API_KEY?: string }).XAI_API_KEY;
    await runScout(env, intakePort().port, opts());
    const p = intakePort();
    const r = await runScout(env, p.port, opts());
    expect(r).toMatchObject({ status: 'done', rss_items: 0, proposed: 0 });
    expect(p.calls).toEqual({});
  });

  it('定期実行日は lock → 日付の順（§R-40 (c)(g)）: 走行中で lock を取れない cron は日付を消費しない', async () => {
    raw.prepare("INSERT INTO settings VALUES ('scout_run_lock', 'other', ?)").run(new Date().toISOString());
    expect(await runScout(env, intakePort().port, { ...opts(), trigger: 'cron', claimDay: '2026-11-09' })).toEqual({ status: 'already_running' });
    expect(one(raw, "SELECT COUNT(*) AS c FROM settings WHERE key = 'scout_last_day'").c).toBe(0);
  });

  it('同じ日の 2 本目（古い判定で来た cron）は already_ran_today で外部を呼ばない。失敗の後も同じ日は走らない', async () => {
    const db = d1(raw);
    const r = await Promise.all([claimSetting(db, 'scout_last_day', '2026-11-09'), claimSetting(db, 'scout_last_day', '2026-11-09')]);
    expect(r.filter(Boolean)).toHaveLength(1);
    raw.prepare("DELETE FROM settings WHERE key = 'scout_last_day'").run();

    const bad = (async () => new Response('x', { status: 503 })) as typeof fetch;
    const first = await runScout(env, intakePort().port, { ...opts(), trigger: 'cron', fetchImpl: bad, claimDay: '2026-11-09' });
    expect(first).toMatchObject({ status: 'failed' });
    const p = intakePort();
    expect(await runScout(env, p.port, { ...opts(), trigger: 'cron', claimDay: '2026-11-09' })).toEqual({ status: 'already_ran_today' });
    expect(p.calls).toEqual({});
    expect(fetches).toEqual([]);
    expect(one(raw, 'SELECT COUNT(*) AS c FROM scout_runs').c).toBe(1);
    expect(one(raw, "SELECT value FROM settings WHERE key = 'scout_run_lock'").value).toBe('');
  });

  it('xAI の結果不明（timeout）は見積り（既定 100 セント）を台帳に載せて failed。応答のあった 5xx は載せない（§R-40 (e)）', async () => {
    const { XaiError } = await import('../src/xai');
    const p = intakePort({
      xaiResponses: async () => {
        throw new XaiError(false, undefined, 'timeout');
      },
    });
    const r = await runScout(env, p.port, opts());
    expect(r).toMatchObject({ status: 'failed', error: 'xai_timeout' });
    if (r.status !== 'failed') return;
    expect(rows(raw, 'SELECT kind, ref_id, cents FROM cost_ledger')).toEqual([{ kind: 'scout', ref_id: r.run_id, cents: 100 }]);
    expect(one(raw, 'SELECT cents FROM scout_runs WHERE id = ?', r.run_id).cents).toBe(100);

    raw.prepare('DELETE FROM cost_ledger').run();
    raw.prepare('DELETE FROM scout_runs').run();
    const p2 = intakePort({
      xaiResponses: async () => {
        throw new XaiError(true, 503, 'api_error');
      },
    });
    expect(await runScout(env, p2.port, opts())).toMatchObject({ status: 'failed', error: 'xai_503' });
    expect(one(raw, 'SELECT COUNT(*) AS c FROM cost_ledger').c).toBe(0);
  });

  it('見積りは SCOUT_XAI_UNCONFIRMED_CENTS で変えられる。2xx の後で本文が読めない時も不明として載せる', async () => {
    (env as unknown as Record<string, string>).SCOUT_XAI_UNCONFIRMED_CENTS = '30';
    const { XaiError } = await import('../src/xai');
    const p = intakePort({
      xaiResponses: async () => {
        throw new XaiError(true, 200, 'invalid_json');
      },
    });
    await runScout(env, p.port, opts());
    expect(one(raw, "SELECT SUM(cents) AS c FROM cost_ledger WHERE kind = 'scout'").c).toBe(30);
  });
});

describe('RSS の線形パース（§R-40 (f)）', () => {
  it('閉じタグの無い 512KB の入力でも速く終わる（打ち切り）', () => {
    const inputs = [
      '<rss><channel>' + '<item><title>t</title>'.repeat(Math.ceil((512 * 1024) / 22)),
      '<feed>' + '<entry x="1">'.repeat(Math.ceil((512 * 1024) / 13)),
      '<rss>' + '<item '.repeat(Math.ceil((512 * 1024) / 6)),
    ];
    for (const xml of inputs) {
      expect(xml.length).toBeGreaterThanOrEqual(512 * 1024);
      const t0 = performance.now();
      const items = parseFeed(xml);
      const ms = performance.now() - t0;
      expect(items).toEqual([]);
      expect(ms).toBeLessThan(500);
    }
  });

  it('閉じた項目は拾い、閉じていない最後の項目で打ち切る。<items> などの別タグは項目にしない。大文字のタグも読む', () => {
    const xml = '<rss><items>x</items><ITEM><title>a</title></ITEM><item foo="1"><title>b</title></item><item><title>c</title>';
    expect(parseFeed(xml).map((i) => i.title)).toEqual(['a', 'b']);
  });
});
