// 管理画面の上部「状況帯」（行 1 = 稼働・今日の費用・今すぐ / 行 2 = 注意 / 行 3 = 今月の内訳）の純関数。
// public/admin/admin.js を node:vm で起動せず読み（image-admin.test.ts と同じ読み方）、返す HTML を数える。
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

interface StatusUi {
  CRON_LATE_MIN: number;
  CRON_STALE_MIN: number;
  cronAge(lastIso: string | null, nowMs: number): { text: string; level: 'ok' | 'late' | 'stale' };
  capLevel(used: number, cap: number): 'ok' | 'near' | 'over' | null;
  costMeterHtml(used: number, cap: number): string;
  statusAlerts(s: unknown, nowMs: number): { level: string; html: string }[];
  statusAlertsHtml(s: unknown, nowMs: number): string;
  statusMonthHtml(s: unknown): string;
  statusBandHtml(s: unknown, nowMs: number): string;
}

const code = readFileSync(new URL('../public/admin/admin.js', import.meta.url), 'utf8');
const win: Record<string, unknown> = { __FACTORY_ADMIN_NO_BOOT__: true };
vm.runInNewContext(code, { window: win, console }, { timeout: 2000 });
const S = win.FactoryAdminStatus as StatusUi;
const n = (html: string, re: RegExp) => (html.match(re) || []).length;
const NOW = Date.parse('2026-11-07T12:00:00.000Z');
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

/** 何も起きていない応答（注意 0 件） */
const ok = (o: Record<string, unknown> = {}) => ({
  paused: false, paused_note: null, running_jobs: 1, max_concurrent: 2, queued_jobs: 0, today_cents: 9555, daily_cap_cents: 20000, agent_configured: true, last_cron_at: ago(3),
  scout: { last_run_at: ago(60), last_status: 'done', month_cents: 0, month_cap_cents: 2000, running: false },
  meeting: { last_at: ago(60), last_status: 'ended', month_cents: 0, month_cap_cents: 1000, pending_batch: false },
  images: { halted: null, month_cents: 170, month_cap_cents: 10000, backup_last_used_at: null },
  videos: { enabled: true },
  ...o,
});

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
    expect(band).toContain('<b>$95.55</b>');
    expect(n(S.statusBandHtml(ok(), NOW), /class="meter"/g)).toBe(1);
    expect(S.statusBandHtml(ok(), NOW)).not.toMatch(/\sstyle=/);
  });
});

describe('行 1（稼働・今日の費用・今すぐ）', () => {
  it('動いている時: 緑の点・止める（neutral）・定期処理の相対時間（title に絶対時刻）・$95.55 / $200・ボタンは押せる', () => {
    const h = S.statusBandHtml(ok(), NOW);
    expect(h).toContain('<span class="dot green" aria-hidden="true"></span><b>動いています</b>');
    expect(h).toContain('<button type="button" class="btn small" id="pause-btn">止める</button>');
    expect(h).toContain('<span id="cron-rel" class="cron-rel ok" data-cron-rel="1">3 分前</span>');
    expect(h).toContain('<b>$95.55</b> / $200');
    expect(h).toContain('id="scout-btn">収集を今すぐ</button>');
    expect(h).toContain('id="meeting-btn">会議を今すぐ</button>');
    expect(h.replace(/<[^>]*>/g, '')).not.toMatch(/cron|職人|設定済み|U で数えた記帳/); // 見える文字に cron・正常時の設定の状態は出さない
  });
  it('停止中: 赤の点・再開（primary）・今すぐのボタンは disabled + title', () => {
    const h = S.statusBandHtml(ok({ paused: true, paused_note: 'メモ' }), NOW);
    expect(h).toContain('<span class="dot red" aria-hidden="true"></span><b>停止中</b>');
    expect(h).toContain('<button type="button" class="btn small primary" id="pause-btn">再開</button>');
    expect(h).toContain('id="scout-btn" disabled title="停止中は実行できません">収集を今すぐ</button>');
    expect(h).toContain('id="meeting-btn" disabled title="停止中は実行できません">会議を今すぐ</button>');
  });
  it('収集中・結果待ちの文と disabled は今のまま（停止中でなければ title は付けない）', () => {
    const h = S.statusBandHtml(ok({ scout: { ...ok().scout, running: true }, meeting: { ...ok().meeting, pending_batch: true } }), NOW);
    expect(h).toContain('id="scout-btn" disabled>収集中…</button>');
    expect(h).toContain('id="meeting-btn" disabled>結果待ち</button>');
  });
});

describe('行 2（注意）', () => {
  it('0 件なら行ごと描かない（容器は空）', () => {
    expect(S.statusAlertsHtml(ok(), NOW)).toBe('');
    const h = S.statusBandHtml(ok(), NOW);
    expect(h).toContain('<div id="status-alerts" class="status-alerts-slot" aria-live="polite"></div>');
    expect(h).not.toContain('職人');
  });
  it('停止中: 赤・paused_note を本文に（escape する）', () => {
    const h = S.statusAlertsHtml(ok({ paused: true, paused_note: '<img src=x onerror=alert(1)>' }), NOW);
    expect(h).toContain('data-status-alerts="red"');
    expect(h).toContain('status-alerts sa-box-red');
    expect(h).toContain('<b class="sa-title">注意 1 件</b>');
    expect(h).toContain('（メモ: &lt;img src=x onerror=alert(1)&gt;）');
    expect(h).not.toContain('<img');
  });
  it('今日の費用: 上限ちょうど（>=）で赤・80% で黄・79% は出さない', () => {
    const over = S.statusAlertsHtml(ok({ today_cents: 20000 }), NOW);
    expect(over).toContain('data-status-alerts="red"');
    expect(over).toContain('今日の費用が上限に達しました（$200.00 / $200）。新しい制作は日付が変わるまで始まりません');
    const near = S.statusAlertsHtml(ok({ today_cents: 16000 }), NOW);
    expect(near).toContain('data-status-alerts="yellow"');
    expect(near).toContain('status-alerts sa-box-yellow');
    expect(near).toContain('今日の費用が上限に近づいています（$160.00 / $200）');
    expect(S.statusAlertsHtml(ok({ today_cents: 15800 }), NOW)).toBe('');
  });
  it('定期処理: 21 分で黄・61 分と null で赤', () => {
    expect(S.statusAlertsHtml(ok({ last_cron_at: ago(21) }), NOW)).toContain('<li class="sa-item sa-yellow">定期処理が遅れています（最終 ');
    expect(S.statusAlertsHtml(ok({ last_cron_at: ago(61) }), NOW)).toContain('<li class="sa-item sa-red">定期処理が 1 時間以上動いていません（最終 ');
    expect(S.statusAlertsHtml(ok({ last_cron_at: null }), NOW)).toContain('定期処理が 1 時間以上動いていません（記録がありません）');
    expect(S.statusAlertsHtml(ok({ last_cron_at: ago(19) }), NOW)).toBe('');
  });
  it('職人 未設定: 赤', () => {
    const h = S.statusAlertsHtml(ok({ agent_configured: false }), NOW);
    expect(h).toContain('data-status-alerts="red"');
    expect(h).toContain('<li class="sa-item sa-red">職人（agent）が設定されていません</li>');
  });
  it('収集の失敗・会議の失効: 赤（行き先は提案箱）。未実行は出さない', () => {
    const h = S.statusAlertsHtml(ok({ scout: { ...ok().scout, last_status: 'failed' }, meeting: { ...ok().meeting, last_status: 'expired' } }), NOW);
    expect(h).toContain('data-status-alerts="red"');
    expect(n(h, /収集の最後の実行が失敗しました/g)).toBe(1);
    expect(n(h, /会議の最後の実行が失効しました/g)).toBe(1);
    expect(n(h, /href="#\/proposals"/g)).toBe(2);
    expect(S.statusAlertsHtml(ok({ scout: { month_cents: 0, month_cap_cents: 2000 }, meeting: {} }), NOW)).toBe('');
  });
  it('月の上限 80% 以上（収集・会議・画像）: 黄', () => {
    const h = S.statusAlertsHtml(ok({ scout: { ...ok().scout, month_cents: 1600 }, meeting: { ...ok().meeting, month_cents: 1000 }, images: { ...ok().images, month_cents: 8000 } }), NOW);
    expect(h).toContain('data-status-alerts="yellow"');
    expect(h).toContain('今月の収集の費用が上限に近づいています（$16.00 / $20）');
    expect(h).toContain('今月の会議の費用が上限に達しました（$10.00 / $10）');
    expect(h).toContain('今月の画像の記帳が上限に近づいています（$80.00 / $100）');
  });
  it('画像の停止（赤・#/images）と予備の鍵（黄）。赤が先、赤があれば赤地。#/images へのリンクは帯全体で 2 本まで', () => {
    const t = ago(60);
    const h = S.statusBandHtml(ok({ images: { ...ok().images, halted: 'manual', backup_last_used_at: t } }), NOW);
    expect(n(h, /data-img-halted="1"/g)).toBe(1);
    expect(n(h, /data-img-backup-band="1"/g)).toBe(1);
    expect(n(h, /href="#\/images"/g)).toBe(2);
    expect(h).toContain('data-status-alerts="red"');
    const alerts = S.statusAlerts(ok({ images: { ...ok().images, halted: 'manual', backup_last_used_at: t } }), NOW);
    expect(alerts.map((a) => a.level)).toEqual(['red', 'yellow']);
    const onlyBackup = S.statusAlertsHtml(ok({ images: { ...ok().images, backup_last_used_at: t } }), NOW);
    expect(onlyBackup).toContain('data-status-alerts="yellow"');
    expect(onlyBackup).toContain('<a class="item" href="#/images" data-img-backup-band="1"><span class="pill orange">');
  });
  it('赤と黄が混ざると件数は全部・赤地', () => {
    const h = S.statusAlertsHtml(ok({ paused: true, today_cents: 16000, last_cron_at: ago(48) }), NOW);
    expect(h).toContain('<b class="sa-title">注意 3 件</b>');
    expect(h).toContain('data-status-alerts="red"');
    expect(n(h, /<li class="sa-item/g)).toBe(3);
  });
});

describe('行 3（今月の内訳）', () => {
  it('$ 表記（上限は整数ドルなら小数を落とす）・¢ は出さない・画像は #/images（title 付き）・動画の確認は既存の印', () => {
    const h = S.statusMonthHtml(ok());
    expect(h).not.toContain('¢');
    expect(h).toContain('収集 $0.00 / $20');
    expect(h).toContain('会議 $0.00 / $10');
    expect(h).toContain('<a class="item" href="#/images" data-img-band="1" title="予約額で数えた記帳。OpenAI の実際の請求とは違うことがあります">画像 $1.70 / $100（概算）</a>');
    expect(h).toContain('<a class="item" href="#/videos" data-video-band="1">動画の確認 <span class="pill green">有効</span></a>');
    expect(S.statusMonthHtml(ok({ scout: { month_cents: 5, month_cap_cents: 2050 } }))).toContain('収集 $0.05 / $20.50');
  });
  it('images / videos が無い応答（古い Worker）ではその項目を出さない', () => {
    const h = S.statusMonthHtml(ok({ images: undefined, videos: undefined }));
    expect(n(h, /data-img-band="1"/g)).toBe(0);
    expect(n(h, /data-video-band="1"/g)).toBe(0);
    expect(h).toContain('収集 $0.00 / $20');
  });
  it('収集・会議の最終が失敗なら赤 pill', () => {
    expect(S.statusMonthHtml(ok({ scout: { ...ok().scout, last_status: 'failed' } }))).toContain('収集 $0.00 / $20 <span class="pill red">失敗</span>');
  });
  it('帯全体の印の数: data-img-band 1・#status に必要な id', () => {
    const h = S.statusBandHtml(ok(), NOW);
    expect(n(h, /data-img-band="1"/g)).toBe(1);
    expect(n(h, /data-video-band="1"/g)).toBe(1);
    for (const id of ['pause-btn', 'scout-btn', 'meeting-btn', 'cron-rel', 'status-alerts']) expect(n(h, new RegExp(`id="${id}"`, 'g'))).toBe(1);
  });
});
