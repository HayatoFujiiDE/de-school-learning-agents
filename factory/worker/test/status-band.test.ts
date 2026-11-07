// 管理画面の上部「状況帯」（仕事ごとの枠 4 つ: 制作 / お金 / お題集め（提案箱へ）/ 画像・動画）の純関数。
// public/admin/admin.js を node:vm で起動せず読み（image-admin.test.ts と同じ読み方）、返す HTML を数える。
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

type Card = 'run' | 'money' | 'intake' | 'media';
interface StatusUi {
  CRON_LATE_MIN: number;
  CRON_STALE_MIN: number;
  STATUS_CARDS: [Card, string][];
  cronAge(lastIso: string | null, nowMs: number): { text: string; level: 'ok' | 'late' | 'stale' };
  capLevel(used: number, cap: number): 'ok' | 'near' | 'over' | null;
  costMeterHtml(used: number, cap: number): string;
  statusAlerts(s: unknown, nowMs: number): { card: Card; level: string; html: string }[];
  statusBandHtml(s: unknown, nowMs: number): string;
}

const code = readFileSync(new URL('../public/admin/admin.js', import.meta.url), 'utf8');
const win: Record<string, unknown> = { __FACTORY_ADMIN_NO_BOOT__: true };
vm.runInNewContext(code, { window: win, console }, { timeout: 2000 });
const S = win.FactoryAdminStatus as StatusUi;
const n = (html: string, re: RegExp) => (html.match(re) || []).length;
const NOW = Date.parse('2026-11-07T12:00:00.000Z');
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const CARDS: Card[] = ['run', 'money', 'intake', 'media'];

/** 何も起きていない応答（注意 0 件） */
const ok = (o: Record<string, unknown> = {}) => ({
  paused: false, paused_note: null, running_jobs: 1, max_concurrent: 2, queued_jobs: 0, today_cents: 9555, daily_cap_cents: 20000, agent_configured: true, last_cron_at: ago(3),
  scout: { last_run_at: ago(60), last_status: 'done', month_cents: 0, month_cap_cents: 2000, running: false },
  meeting: { last_at: ago(60), last_status: 'ended', month_cents: 0, month_cap_cents: 1000, pending_batch: false },
  images: { halted: null, month_cents: 170, month_cap_cents: 10000, backup_last_used_at: null },
  videos: { enabled: true },
  ...o,
});
/** 帯の HTML から 1 つの枠の部分だけを切り出す（枠は data-card="<key>" で始まり、次の枠の手前まで） */
function card(band: string, key: Card): string {
  const parts = band.split(/(?=<div class="sb-card[^"]*" id="status-card-)/);
  const hit = parts.filter((p) => p.includes(`data-card="${key}"`));
  expect(hit).toHaveLength(1);
  return hit[0];
}
/** 枠の注意の容器の中身 */
function alertsOf(band: string, key: Card): string {
  const m = new RegExp(`<div class="sb-alerts" id="status-alerts-${key}" aria-live="polite">(.*?)</div></div>`).exec(card(band, key));
  expect(m).not.toBeNull();
  return m![1];
}
/** 枠のクラス（sb-card / sb-card sb-red / sb-card sb-yellow） */
const cardCls = (band: string, key: Card) => /^<div class="([^"]*)"/.exec(card(band, key))![1];

describe('cronAge（定期処理の最終からの経過）', () => {
  it('閾値は 20 分超で late・60 分超で stale', () => {
    expect(S.CRON_LATE_MIN).toBe(20);
    expect(S.CRON_STALE_MIN).toBe(60);
    expect(S.cronAge(ago(19), NOW)).toEqual({ text: '19 分前', level: 'ok' });
    expect(S.cronAge(ago(20), NOW).level).toBe('ok');
    expect(S.cronAge(ago(21), NOW)).toEqual({ text: '21 分前', level: 'late' });
    expect(S.cronAge(ago(60), NOW).level).toBe('late');
    expect(S.cronAge(ago(61), NOW)).toEqual({ text: '1 時間前', level: 'stale' });
    expect(S.cronAge(ago(60 * 50), NOW).text).toBe('2 日前');
  });
  it('null・読めない時刻は stale（記録なし）、未来の時刻（時計のずれ）は 0 分扱い', () => {
    expect(S.cronAge(null, NOW)).toEqual({ text: '記録なし', level: 'stale' });
    expect(S.cronAge('not a date', NOW).level).toBe('stale');
    expect(S.cronAge(ago(-30), NOW)).toEqual({ text: 'たった今', level: 'ok' });
  });
});

describe('今日の費用のメーター', () => {
  it('段階は >= で判定: 79% ok・80% near・99% near・100% over', () => {
    expect(S.capLevel(7900, 10000)).toBe('ok');
    expect(S.capLevel(8000, 10000)).toBe('near');
    expect(S.capLevel(9900, 10000)).toBe('near');
    expect(S.capLevel(10000, 10000)).toBe('over');
    expect(S.costMeterHtml(7900, 10000)).toContain('meter-fill m-ok w75');
    expect(S.costMeterHtml(8000, 10000)).toContain('meter-fill m-near w80');
    expect(S.costMeterHtml(9900, 10000)).toContain('meter-fill m-near w95');
    expect(S.costMeterHtml(10000, 10000)).toContain('meter-fill m-over w100');
    expect(S.costMeterHtml(25000, 10000)).toContain('meter-fill m-over w100'); // 超えてもバーは 100% まで
  });
  it('上限が 0 / 未定義ならバー無しで数字だけ。style 属性は使わない（CSP）', () => {
    expect(S.costMeterHtml(500, 0)).toBe('');
    expect(S.costMeterHtml(500, undefined as unknown as number)).toBe('');
    const band = S.statusBandHtml(ok({ daily_cap_cents: 0 }), NOW);
    expect(n(band, /class="meter"/g)).toBe(0);
    expect(card(band, 'money')).toContain('<b>$95.55</b>');
    expect(n(S.statusBandHtml(ok(), NOW), /class="meter"/g)).toBe(1);
    expect(S.statusBandHtml(ok(), NOW)).not.toMatch(/\sstyle=/);
    expect(S.statusBandHtml(ok({ paused: true, today_cents: 30000, last_cron_at: null, agent_configured: false }), NOW)).not.toMatch(/\sstyle=/);
  });
});

describe('枠の並びと中身', () => {
  it('4 枠の見出しがこの順で出る: 制作 → お金 → お題集め（提案箱へ）→ 画像・動画', () => {
    expect(S.STATUS_CARDS.map((c) => c[0])).toEqual(CARDS);
    const h = S.statusBandHtml(ok(), NOW);
    const titles = [...h.matchAll(/<span class="sb-title">([^<]*)<\/span>/g)].map((m) => m[1]);
    expect(titles).toEqual(['制作', 'お金', 'お題集め（提案箱へ）', '画像・動画']);
    expect([...h.matchAll(/data-card="(\w+)"/g)].map((m) => m[1])).toEqual(CARDS);
    expect(h.startsWith('<div class="status-band">')).toBe(true);
  });
  it('ボタンはその仕事の枠の中: 止める → 制作（見出し行）・収集 / 会議を今すぐ → お題集め', () => {
    const h = S.statusBandHtml(ok(), NOW);
    expect(card(h, 'run')).toContain('<div class="sb-head"><span class="sb-title">制作</span><button type="button" class="btn small" id="pause-btn">止める</button></div>');
    expect(card(h, 'intake')).toContain('id="scout-btn">収集を今すぐ</button>');
    expect(card(h, 'intake')).toContain('id="meeting-btn">会議を今すぐ</button>');
    for (const k of ['money', 'media'] as Card[]) expect(card(h, k)).not.toMatch(/<button/);
    for (const id of ['pause-btn', 'scout-btn', 'meeting-btn', 'cron-rel']) expect(n(h, new RegExp(`id="${id}"`, 'g'))).toBe(1);
    for (const k of CARDS) {
      expect(n(h, new RegExp(`id="status-card-${k}"`, 'g'))).toBe(1);
      expect(n(h, new RegExp(`id="status-alerts-${k}" aria-live="polite"`, 'g'))).toBe(1);
    }
    expect(n(h, /aria-live=/g)).toBe(4); // 注意の容器だけ
  });
  it('制作: 緑の点・制作中 / 順番待ち・定期処理の相対時間（title に絶対時刻）。見える文字に cron・正常時の設定の状態は出さない', () => {
    const h = S.statusBandHtml(ok(), NOW);
    const r = card(h, 'run');
    expect(r).toContain('<span class="dot green" aria-hidden="true"></span><b>動いています</b>');
    expect(r).toContain('制作中 <b>1</b> / 2');
    expect(r).toContain('順番待ち <b>0</b>');
    expect(r).toContain('<span id="cron-rel" class="cron-rel ok" data-cron-rel="1">3 分前</span>');
    expect(r).toMatch(/title="定期処理の最終 [^"]+"/);
    expect(h.replace(/<[^>]*>/g, '')).not.toMatch(/cron|職人|設定済み|U で数えた記帳|›\s*・/);
  });
  it('停止中: 赤の点・再開（primary）・今すぐのボタンは disabled + title', () => {
    const h = S.statusBandHtml(ok({ paused: true, paused_note: 'メモ' }), NOW);
    expect(card(h, 'run')).toContain('<span class="dot red" aria-hidden="true"></span><b>停止中</b>');
    expect(card(h, 'run')).toContain('<button type="button" class="btn small primary" id="pause-btn">再開</button>');
    expect(card(h, 'intake')).toContain('id="scout-btn" disabled title="停止中は実行できません">収集を今すぐ</button>');
    expect(card(h, 'intake')).toContain('id="meeting-btn" disabled title="停止中は実行できません">会議を今すぐ</button>');
  });
  it('収集中・結果待ちの文と disabled は今のまま（停止中でなければ title は付けない）', () => {
    const h = S.statusBandHtml(ok({ scout: { ...ok().scout, running: true }, meeting: { ...ok().meeting, pending_batch: true } }), NOW);
    expect(h).toContain('id="scout-btn" disabled>収集中…</button>');
    expect(h).toContain('id="meeting-btn" disabled>結果待ち</button>');
  });
  it('お金: 今日 $95.55 / $200 とメーター・今月は収集・会議・画像の額だけ（上限・合計は出さない）・¢ は出さない', () => {
    const m = card(S.statusBandHtml(ok({ scout: { ...ok().scout, month_cents: 5 } }), NOW), 'money');
    expect(m).toContain('<span class="sb-label">今日</span><span class="sb-vals"><span class="meter"');
    expect(m).toContain('<b>$95.55</b> / $200');
    expect(m).toContain('<span class="sb-label">今月</span><span class="sb-vals"><span class="item">収集 $0.05</span><span class="item">会議 $0.00</span><span class="item">画像 $1.70</span></span>');
    expect(m).not.toMatch(/合計|\$20\b|\$10\b|\$100\b|¢/);
  });
  it('お題集め: 名前・最終の状態（未実行は muted・失敗系は赤 pill）・今月 $x / $上限（整数ドルは小数を落とす）', () => {
    const i = card(S.statusBandHtml(ok(), NOW), 'intake');
    expect(i).toMatch(/<span class="sb-name">収集<\/span><span class="sb-st muted" title="最終 [^"]+">完了<\/span><span class="sb-num">\$0\.00 \/ \$20<\/span>/);
    expect(i).toMatch(/<span class="sb-name">会議<\/span><span class="sb-st muted" title="最終 [^"]+">完了<\/span><span class="sb-num">\$0\.00 \/ \$10<\/span>/);
    const never = card(S.statusBandHtml(ok({ scout: { month_cents: 5, month_cap_cents: 2050 }, meeting: {} }), NOW), 'intake');
    expect(never).toContain('<span class="sb-name">収集</span><span class="sb-st muted">未実行</span><span class="sb-num">$0.05 / $20.50</span>');
    expect(never).toContain('<span class="sb-name">会議</span><span class="sb-st muted">未実行</span><span class="sb-num">$0.00 / —</span>');
    const bad = card(S.statusBandHtml(ok({ scout: { ...ok().scout, last_status: 'failed' }, meeting: { ...ok().meeting, last_status: 'expired' } }), NOW), 'intake');
    expect(bad).toMatch(/<span class="sb-name">収集<\/span><span class="sb-st" title="最終 [^"]+"><span class="pill red">失敗<\/span><\/span>/);
    expect(bad).toMatch(/<span class="sb-name">会議<\/span><span class="sb-st" title="最終 [^"]+"><span class="pill red">失効<\/span><\/span>/);
  });
  it('画像・動画: 画像の生成（#/images・title 付き・概算）と動画の確認（既存の印）。#/images は通常 1 本', () => {
    const h = S.statusBandHtml(ok(), NOW);
    const md = card(h, 'media');
    expect(md).toContain('<a class="item" href="#/images" data-img-band="1" title="予約額で数えた記帳。OpenAI の実際の請求とは違うことがあります">画像の生成 $1.70 / $100（概算）</a>');
    expect(md).toContain('<a class="item" href="#/videos" data-video-band="1">動画の確認 <span class="pill green">有効</span></a>');
    expect(n(h, /data-img-band="1"/g)).toBe(1);
    expect(n(h, /data-video-band="1"/g)).toBe(1);
    expect(n(h, /href="#\/images"/g)).toBe(1);
    expect(h).not.toContain('¢');
  });
  it('images / videos が無い応答（古い Worker）ではその行を出さない', () => {
    const h = S.statusBandHtml(ok({ images: undefined, videos: undefined }), NOW);
    expect(n(h, /data-img-band="1"/g)).toBe(0);
    expect(n(h, /data-video-band="1"/g)).toBe(0);
    expect(card(h, 'media')).toContain('<div class="sb-line muted">—</div>');
    expect(card(h, 'money')).not.toContain('画像 ');
    expect(card(h, 'intake')).toContain('<span class="sb-num">$0.00 / $20</span>');
    const onlyVideo = card(S.statusBandHtml(ok({ images: undefined }), NOW), 'media');
    expect(onlyVideo).toContain('data-video-band="1"');
    expect(onlyVideo).not.toContain('—');
  });
});

describe('注意はその仕事の枠の中', () => {
  it('0 件なら全部の枠の注意の容器が空で、枠は色なし', () => {
    const h = S.statusBandHtml(ok(), NOW);
    expect(S.statusAlerts(ok(), NOW)).toEqual([]);
    for (const k of CARDS) {
      expect(alertsOf(h, k)).toBe('');
      expect(cardCls(h, k)).toBe('sb-card');
    }
  });
  it('停止中 → 制作（赤・paused_note は escape する）', () => {
    const h = S.statusBandHtml(ok({ paused: true, paused_note: '<img src=x onerror=alert(1)>' }), NOW);
    const a = alertsOf(h, 'run');
    expect(a).toContain('<li class="sa-item sa-red">停止中です。新しい制作と検証は始まりません（メモ: &lt;img src=x onerror=alert(1)&gt;）</li>');
    expect(h).not.toContain('<img');
    expect(cardCls(h, 'run')).toBe('sb-card sb-red');
    for (const k of ['money', 'intake', 'media'] as Card[]) { expect(alertsOf(h, k)).toBe(''); expect(cardCls(h, k)).toBe('sb-card'); }
  });
  it('今日の費用: 上限ちょうど（>=）で お金 に赤・80% で黄・79% は出さない。制作の枠には出さない', () => {
    const over = S.statusBandHtml(ok({ today_cents: 20000 }), NOW);
    expect(alertsOf(over, 'money')).toContain('<li class="sa-item sa-red">今日の費用が上限に達しました（$200.00 / $200）。新しい制作は日付が変わるまで始まりません</li>');
    expect(cardCls(over, 'money')).toBe('sb-card sb-red');
    expect(alertsOf(over, 'run')).toBe('');
    expect(cardCls(over, 'run')).toBe('sb-card');
    const near = S.statusBandHtml(ok({ today_cents: 16000 }), NOW);
    expect(alertsOf(near, 'money')).toContain('<li class="sa-item sa-yellow">今日の費用が上限に近づいています（$160.00 / $200）</li>');
    expect(cardCls(near, 'money')).toBe('sb-card sb-yellow');
    expect(alertsOf(S.statusBandHtml(ok({ today_cents: 15800 }), NOW), 'money')).toBe('');
  });
  it('定期処理 → 制作: 21 分で黄・61 分と null で赤・19 分は出さない', () => {
    const late = S.statusBandHtml(ok({ last_cron_at: ago(21) }), NOW);
    expect(alertsOf(late, 'run')).toContain('<li class="sa-item sa-yellow">定期処理が遅れています（最終 ');
    expect(cardCls(late, 'run')).toBe('sb-card sb-yellow');
    expect(alertsOf(S.statusBandHtml(ok({ last_cron_at: ago(61) }), NOW), 'run')).toContain('<li class="sa-item sa-red">定期処理が 1 時間以上動いていません（最終 ');
    expect(alertsOf(S.statusBandHtml(ok({ last_cron_at: null }), NOW), 'run')).toContain('定期処理が 1 時間以上動いていません（記録がありません）');
    expect(alertsOf(S.statusBandHtml(ok({ last_cron_at: ago(19) }), NOW), 'run')).toBe('');
  });
  it('職人 未設定 → 制作（赤）', () => {
    const h = S.statusBandHtml(ok({ agent_configured: false }), NOW);
    expect(alertsOf(h, 'run')).toContain('<li class="sa-item sa-red">職人（agent）が設定されていません</li>');
    expect(cardCls(h, 'run')).toBe('sb-card sb-red');
  });
  it('収集の失敗・会議の失効 → お題集め（赤・行き先は提案箱）。未実行は出さない', () => {
    const h = S.statusBandHtml(ok({ scout: { ...ok().scout, last_status: 'failed' }, meeting: { ...ok().meeting, last_status: 'expired' } }), NOW);
    const a = alertsOf(h, 'intake');
    expect(n(a, /収集が失敗しました/g)).toBe(1);
    expect(n(a, /会議が失効しました/g)).toBe(1);
    expect(n(a, /href="#\/proposals"/g)).toBe(2);
    expect(cardCls(h, 'intake')).toBe('sb-card sb-red');
    expect(alertsOf(S.statusBandHtml(ok({ scout: { month_cents: 0, month_cap_cents: 2000 }, meeting: {} }), NOW), 'intake')).toBe('');
  });
  it('月の上限 80% 以上: 収集・会議 → お題集め（黄）・画像 → 画像・動画（黄）', () => {
    const h = S.statusBandHtml(ok({ scout: { ...ok().scout, month_cents: 1600 }, meeting: { ...ok().meeting, month_cents: 1000 }, images: { ...ok().images, month_cents: 8000 } }), NOW);
    expect(alertsOf(h, 'intake')).toContain('今月の収集の費用が上限に近づいています（$16.00 / $20）');
    expect(alertsOf(h, 'intake')).toContain('今月の会議の費用が上限に達しました（$10.00 / $10）');
    expect(cardCls(h, 'intake')).toBe('sb-card sb-yellow');
    expect(alertsOf(h, 'media')).toContain('今月の画像の記帳が上限に近づいています（$80.00 / $100）');
    expect(cardCls(h, 'media')).toBe('sb-card sb-yellow');
    expect(alertsOf(h, 'money')).toBe('');
  });
  it('画像の停止（赤）・予備の鍵（黄）→ 画像・動画。赤が先。#/images へのリンクは帯全体で 2 本まで', () => {
    const t = ago(60);
    const both = ok({ images: { ...ok().images, halted: 'manual', backup_last_used_at: t } });
    const h = S.statusBandHtml(both, NOW);
    const a = alertsOf(h, 'media');
    expect(n(a, /data-img-halted="1"/g)).toBe(1);
    expect(n(a, /data-img-backup-band="1"/g)).toBe(1);
    expect(n(h, /href="#\/images"/g)).toBe(2);
    expect(cardCls(h, 'media')).toBe('sb-card sb-red');
    expect(S.statusAlerts(both, NOW).map((x) => [x.card, x.level])).toEqual([['media', 'red'], ['media', 'yellow']]);
    const onlyBackup = S.statusBandHtml(ok({ images: { ...ok().images, backup_last_used_at: t } }), NOW);
    expect(alertsOf(onlyBackup, 'media')).toContain('<a class="item" href="#/images" data-img-backup-band="1"><span class="pill orange">');
    expect(cardCls(onlyBackup, 'media')).toBe('sb-card sb-yellow');
    expect(n(onlyBackup, /href="#\/images"/g)).toBe(2);
  });
  it('全部起きた時: 各注意は 1 つの枠にだけ出る（同じ注意が 2 枠に出ない）・枠の色・帯の外に注意をまとめる段は無い', () => {
    const all = ok({
      paused: true, paused_note: 'メモ', today_cents: 21040, last_cron_at: ago(48), agent_configured: false,
      scout: { ...ok().scout, last_status: 'failed', month_cents: 1700 }, meeting: { ...ok().meeting, last_status: 'failed' },
      images: { ...ok().images, halted: 'manual', month_cents: 8400, backup_last_used_at: ago(60) },
    });
    const list = S.statusAlerts(all, NOW);
    const h = S.statusBandHtml(all, NOW);
    // 1 件ずつ、出る枠はちょうど 1 つ（その件の card の枠）
    for (const a of list) {
      const inCards = CARDS.filter((k) => alertsOf(h, k).includes(a.html));
      expect(inCards).toEqual([a.card]);
    }
    // 枠ごとの件数の合計 = 全件（取りこぼし・重複なし）
    const total = CARDS.reduce((sum, k) => sum + n(alertsOf(h, k), /<li class="sa-item/g), 0);
    expect(total).toBe(list.length);
    expect(n(h, /<li class="sa-item/g)).toBe(list.length);
    expect(Object.fromEntries(CARDS.map((k) => [k, list.filter((a) => a.card === k).length]))).toEqual({ run: 3, money: 1, intake: 3, media: 3 });
    expect(n(h, /今日の費用が上限に達しました/g)).toBe(1);
    expect(n(h, /停止中です/g)).toBe(1);
    for (const k of CARDS) expect(cardCls(h, k)).toBe('sb-card sb-red');
    expect(h).not.toMatch(/注意 \d+ 件|status-alerts"|data-status-alerts/);
    // 枠の中は赤が先
    for (const k of CARDS) {
      const lv = [...alertsOf(h, k).matchAll(/<li class="sa-item sa-(\w+)">/g)].map((m) => m[1]);
      expect(lv).toEqual([...lv].sort((x, y) => (x === 'red' ? 0 : 1) - (y === 'red' ? 0 : 1)));
    }
  });
});
