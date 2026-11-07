// 管理画面の上部「状況帯」（仕事ごとの枠 3 つ: 制作 / お金 / 注意。§N-8）の純関数。
// public/admin/admin.js を node:vm で起動せず読み（image-admin.test.ts と同じ読み方）、返す HTML を数える。
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

type Card = 'run' | 'money' | 'alerts';
interface StatusUi {
  CRON_LATE_MIN: number;
  CRON_STALE_MIN: number;
  STATUS_CARDS: [Card, string][];
  cronAge(lastIso: string | null, nowMs: number): { text: string; level: 'ok' | 'late' | 'stale' };
  capLevel(used: number, cap: number): 'ok' | 'near' | 'over' | null;
  costMeterHtml(used: number, cap: number): string;
  ALERT_GO_TEXT: Record<string, string>;
  statusAlerts(s: unknown, nowMs: number): { st: string | null; level: string; html: string }[];
  statusBandHtml(s: unknown, nowMs: number): string;
  stationGoId(href: string): string | null;
}

const code = readFileSync(new URL('../public/admin/admin.js', import.meta.url), 'utf8');
const win: Record<string, unknown> = { __FACTORY_ADMIN_NO_BOOT__: true };
vm.runInNewContext(code, { window: win, console }, { timeout: 2000 });
const S = win.FactoryAdminStatus as StatusUi;
const n = (html: string, re: RegExp) => (html.match(re) || []).length;
const NOW = Date.parse('2026-11-07T12:00:00.000Z');
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const CARDS: Card[] = ['run', 'money', 'alerts'];

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
/** 注意の枠の容器の中身 */
function alertsOf(band: string): string {
  const m = /<div class="sb-alerts" id="status-alerts" aria-live="polite">(.*?)<\/div><\/div>/.exec(card(band, 'alerts'));
  expect(m).not.toBeNull();
  return m![1];
}
/** 注意の行（li）を 1 本ずつ */
const rowsOf = (band: string) => [...alertsOf(band).matchAll(/<li class="sa-item sa-(\w+)">(.*?)<\/li>/g)].map((m) => ({ level: m[1], html: m[2] }));
/** 行の末尾の行き先（#/?st=<係>）。無ければ null */
const goOf = (row: string) => /<a class="sa-go" href="#\/\?st=(\w+)" data-sa-go="\1">[^<]+ ›<\/a>$/.exec(row)?.[1] ?? null;
/** 枠のクラス（sb-card / sb-card sb-note / sb-card sb-note sb-red / …） */
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
  it('3 枠の見出しがこの順で出る: 制作 → お金 → 注意（入口・画像・動画の枠は無い）', () => {
    expect(S.STATUS_CARDS.map((c) => c[0])).toEqual(CARDS);
    const h = S.statusBandHtml(ok(), NOW);
    const titles = [...h.matchAll(/<span class="sb-title">([^<]*)<\/span>/g)].map((m) => m[1]);
    expect(titles).toEqual(['制作', 'お金', '注意']);
    expect([...h.matchAll(/data-card="(\w+)"/g)].map((m) => m[1])).toEqual(CARDS);
    expect(h.startsWith('<div class="status-band">')).toBe(true);
    expect(h).not.toMatch(/入口（収集・会議）|画像・動画|sb-go-floor/);
  });
  it('ボタンは 止める（制作の見出し行）だけ。収集 / 会議を今すぐは工場の係のパネル（§N-7）。aria-live は注意の容器だけ', () => {
    const h = S.statusBandHtml(ok(), NOW);
    expect(card(h, 'run')).toContain('<div class="sb-head"><span class="sb-title">制作</span><button type="button" class="btn small" id="pause-btn">止める</button></div>');
    for (const k of ['money', 'alerts'] as Card[]) expect(card(h, k)).not.toMatch(/<button/);
    for (const id of ['scout-btn', 'meeting-btn']) expect(n(h, new RegExp(`id="${id}"`, 'g'))).toBe(0);
    for (const id of ['pause-btn', 'cron-rel', 'status-alerts', 'status-alerts-n']) expect(n(h, new RegExp(`id="${id}"`, 'g'))).toBe(1);
    for (const k of CARDS) expect(n(h, new RegExp(`id="status-card-${k}"`, 'g'))).toBe(1);
    expect(n(h, /aria-live=/g)).toBe(1);
    expect(n(h, /id="status-alerts" aria-live="polite"/g)).toBe(1);
  });
  it('制作: 緑の点・制作中 / 順番待ち・定期処理の相対時間（title に絶対時刻）。枠の中に注意を持たない。見える文字に cron・正常時の設定の状態は出さない', () => {
    const h = S.statusBandHtml(ok(), NOW);
    const r = card(h, 'run');
    expect(r).toContain('<span class="dot green" aria-hidden="true"></span><b>動いています</b>');
    expect(r).toContain('制作中 <b>1</b> / 2');
    expect(r).toContain('順番待ち <b>0</b>');
    expect(r).toContain('<span id="cron-rel" class="cron-rel ok" data-cron-rel="1">3 分前</span>');
    expect(r).toMatch(/title="定期処理の最終 [^"]+"/);
    expect(h.replace(/<[^>]*>/g, '')).not.toMatch(/cron|職人|設定済み|U で数えた記帳|›\s*・/);
    // 停止中・定期処理の遅れでも制作の枠の中には注意を出さない（注意の枠へ）
    const bad = S.statusBandHtml(ok({ paused: true, paused_note: 'メモ', last_cron_at: ago(48), agent_configured: false }), NOW);
    expect(card(bad, 'run')).not.toMatch(/sa-item|sb-alerts|停止中です/);
    expect(cardCls(bad, 'run')).toBe('sb-card');
  });
  it('停止中: 赤の点・再開（primary）', () => {
    const h = S.statusBandHtml(ok({ paused: true, paused_note: 'メモ' }), NOW);
    expect(card(h, 'run')).toContain('<span class="dot red" aria-hidden="true"></span><b>停止中</b>');
    expect(card(h, 'run')).toContain('<button type="button" class="btn small primary" id="pause-btn">再開</button>');
  });
  it('お金: 今日 $95.55 / $200 とメーター・今月は収集・会議・画像の額だけ（上限・合計は出さない）・¢ は出さない・画像の額に data-img-band（#/images・title・概算）', () => {
    const h = S.statusBandHtml(ok({ scout: { ...ok().scout, month_cents: 5 } }), NOW);
    const m = card(h, 'money');
    expect(m).toContain('<span class="sb-label">今日</span><span class="sb-vals"><span class="meter"');
    expect(m).toContain('<b>$95.55</b> / $200');
    expect(m).toContain('<span class="sb-label">今月</span><span class="sb-vals"><span class="item">収集 $0.05</span><span class="item">会議 $0.00</span>' +
      '<a class="item" href="#/images" data-img-band="1" title="予約額で数えた記帳。OpenAI の実際の請求とは違うことがあります">画像 $1.70（概算）</a></span>');
    expect(m).not.toMatch(/合計|\$20\b|\$10\b|\$100\b|¢/);
    expect(n(h, /data-img-band="1"/g)).toBe(1); // smoke (i12) が #status の中で数える
    expect(n(h, /href="#\/images"/g)).toBe(1);
    expect(n(h, /data-video-band="1"/g)).toBe(0); // 動画の確認は検証係のパネルへ（videosBandHtml の純関数は残す）
    expect(h).not.toContain('¢');
  });
  it('images / videos が無い応答（古い Worker）では画像の額を出さない', () => {
    const h = S.statusBandHtml(ok({ images: undefined, videos: undefined }), NOW);
    expect(n(h, /data-img-band="1"/g)).toBe(0);
    expect(card(h, 'money')).not.toContain('画像 ');
    expect(alertsOf(h)).toBe('<p class="sa-none muted">注意はありません</p>');
  });
});

describe('注意の枠（すべての注意を 1 列・行き先は係のパネル）', () => {
  it('0 件: 「注意はありません」を muted で 1 行・件数なし・枠は色なしで残る（3 枠の形）', () => {
    const h = S.statusBandHtml(ok(), NOW);
    expect(S.statusAlerts(ok(), NOW)).toEqual([]);
    expect(alertsOf(h)).toBe('<p class="sa-none muted">注意はありません</p>');
    expect(cardCls(h, 'alerts')).toBe('sb-card sb-note');
    expect(card(h, 'alerts')).toContain('<span class="sb-count" id="status-alerts-n"></span>');
    for (const k of ['run', 'money'] as Card[]) expect(cardCls(h, k)).toBe('sb-card');
  });
  it('停止中（赤・paused_note は escape する・行き先なし）', () => {
    const h = S.statusBandHtml(ok({ paused: true, paused_note: '<img src=x onerror=alert(1)>' }), NOW);
    const rs = rowsOf(h);
    expect(rs).toEqual([{ level: 'red', html: '停止中です。新しい制作と検証は始まりません（メモ: &lt;img src=x onerror=alert(1)&gt;）' }]);
    expect(h).not.toContain('<img');
    expect(cardCls(h, 'alerts')).toBe('sb-card sb-note sb-red');
    expect(card(h, 'alerts')).toContain('<span class="sb-count" id="status-alerts-n">1 件</span>');
  });
  it('今日の費用: 上限ちょうど（>=）で赤・80% で黄・79% は出さない。行き先なし', () => {
    const over = rowsOf(S.statusBandHtml(ok({ today_cents: 20000 }), NOW));
    expect(over).toEqual([{ level: 'red', html: '今日の費用が上限に達しました（$200.00 / $200）。新しい制作は日付が変わるまで始まりません' }]);
    const nearBand = S.statusBandHtml(ok({ today_cents: 16000 }), NOW);
    expect(rowsOf(nearBand)).toEqual([{ level: 'yellow', html: '今日の費用が上限に近づいています（$160.00 / $200）' }]);
    expect(cardCls(nearBand, 'alerts')).toBe('sb-card sb-note sb-yellow');
    expect(rowsOf(S.statusBandHtml(ok({ today_cents: 15800 }), NOW))).toEqual([]);
  });
  it('定期処理: 21 分で黄・61 分と null で赤・19 分は出さない。行き先なし', () => {
    const late = rowsOf(S.statusBandHtml(ok({ last_cron_at: ago(21) }), NOW));
    expect(late).toHaveLength(1);
    expect(late[0].level).toBe('yellow');
    expect(late[0].html).toMatch(/^定期処理が遅れています（最終 /);
    expect(goOf(late[0].html)).toBeNull();
    expect(rowsOf(S.statusBandHtml(ok({ last_cron_at: ago(61) }), NOW))[0].html).toMatch(/^定期処理が 1 時間以上動いていません（最終 /);
    expect(rowsOf(S.statusBandHtml(ok({ last_cron_at: null }), NOW))[0].html).toBe('定期処理が 1 時間以上動いていません（記録がありません）');
    expect(rowsOf(S.statusBandHtml(ok({ last_cron_at: ago(19) }), NOW))).toEqual([]);
  });
  it('職人 未設定（赤・行き先なし）', () => {
    expect(rowsOf(S.statusBandHtml(ok({ agent_configured: false }), NOW))).toEqual([{ level: 'red', html: '職人（agent）が設定されていません' }]);
  });
  it('収集の失敗 → 入口の係・会議の失効 → 会議の係（赤）。未実行は出さない', () => {
    const rs = rowsOf(S.statusBandHtml(ok({ scout: { ...ok().scout, last_status: 'failed' }, meeting: { ...ok().meeting, last_status: 'expired' } }), NOW));
    expect(rs.map((r) => [r.level, goOf(r.html)])).toEqual([['red', 'intake'], ['red', 'meeting']]);
    expect(rs[0].html).toMatch(/^収集が失敗しました（[^）]+） <a class="sa-go" href="#\/\?st=intake" data-sa-go="intake">入口の係を開く ›<\/a>$/);
    expect(rs[1].html).toMatch(/^会議が失効しました（[^）]+） <a class="sa-go" href="#\/\?st=meeting" data-sa-go="meeting">会議の係を開く ›<\/a>$/);
    expect(rowsOf(S.statusBandHtml(ok({ scout: { month_cents: 0, month_cap_cents: 2000 }, meeting: {} }), NOW))).toEqual([]);
  });
  it('月の上限 80% 以上: 収集 → 入口・会議 → 会議・画像 → 職人・お題 → お題係（黄）', () => {
    const h = S.statusBandHtml(ok({
      scout: { ...ok().scout, month_cents: 1600 }, meeting: { ...ok().meeting, month_cents: 1000 }, images: { ...ok().images, month_cents: 8000 },
      topics: { month_cents: 2500, month_cap_cents: 3000, failed_24h: 0, last_run: null },
    }), NOW);
    const rs = rowsOf(h);
    expect(rs.map((r) => [r.level, goOf(r.html)])).toEqual([['yellow', 'intake'], ['yellow', 'meeting'], ['yellow', 'maker'], ['yellow', 'topics']]);
    expect(rs[0].html).toContain('今月の収集の費用が上限に近づいています（$16.00 / $20）');
    expect(rs[1].html).toContain('今月の会議の費用が上限に達しました（$10.00 / $10）');
    expect(rs[2].html).toContain('今月の画像の記帳が上限に近づいています（$80.00 / $100）');
    expect(rs[3].html).toContain('今月のお題の費用が上限に近づいています（$25.00 / $30）');
    expect(cardCls(h, 'alerts')).toBe('sb-card sb-note sb-yellow');
  });
  it('画像の停止（赤）・予備の鍵（黄）→ 職人の係。印は注意の行に（data-img-halted・data-img-backup-band）。#/images へのリンクはお金の枠の 1 本だけ', () => {
    const t = ago(60);
    const both = ok({ images: { ...ok().images, halted: 'manual', backup_last_used_at: t } });
    const h = S.statusBandHtml(both, NOW);
    const rs = rowsOf(h);
    expect(rs.map((r) => [r.level, goOf(r.html)])).toEqual([['red', 'maker'], ['yellow', 'maker']]);
    expect(rs[0].html).toContain('<span class="item" data-img-halted="1">画像の生成を止めています（手で止めました）</span>');
    expect(rs[1].html).toMatch(/^<span class="item" data-img-backup-band="1"><span class="pill orange">画像: 予備の鍵を使いました（[^）<]+）<\/span><\/span>/);
    expect(n(h, /data-img-halted="1"/g)).toBe(1);
    expect(n(h, /data-img-backup-band="1"/g)).toBe(1);
    expect(n(alertsOf(h), /data-img-halted="1"|data-img-backup-band="1"/g)).toBe(2);
    expect(n(h, /href="#\/images"/g)).toBe(1);
    expect(cardCls(h, 'alerts')).toBe('sb-card sb-note sb-red');
    const onlyBackup = S.statusBandHtml(ok({ images: { ...ok().images, backup_last_used_at: t } }), NOW);
    expect(rowsOf(onlyBackup).map((r) => [r.level, goOf(r.html)])).toEqual([['yellow', 'maker']]);
    expect(cardCls(onlyBackup, 'alerts')).toBe('sb-card sb-note sb-yellow');
  });
  it('お題: 最後の作成が失敗なら赤・成功していて 24 時間以内に失敗があれば黄 → お題係。topics が無い応答では出さない', () => {
    const red = rowsOf(S.statusBandHtml(ok({ topics: { last_run: { status: 'failed', updated_at: ago(30) }, failed_24h: 2, month_cents: 0, month_cap_cents: 3000 } }), NOW));
    expect(red.map((r) => [r.level, goOf(r.html)])).toEqual([['red', 'topics']]);
    expect(red[0].html).toMatch(/^お題の作成が失敗しました（/);
    const y = rowsOf(S.statusBandHtml(ok({ topics: { last_run: { status: 'done' }, failed_24h: 2, month_cents: 0, month_cap_cents: 3000 } }), NOW));
    expect(y.map((r) => [r.level, goOf(r.html)])).toEqual([['yellow', 'topics']]);
    expect(y[0].html).toContain('お題の作成が 24 時間以内に 2 回失敗しています');
    expect(rowsOf(S.statusBandHtml(ok({ topics: { last_run: null, failed_24h: 0, month_cents: 0, month_cap_cents: 3000 } }), NOW))).toEqual([]);
    expect(rowsOf(S.statusBandHtml(ok({ topics: undefined }), NOW))).toEqual([]);
  });
  it('全部起きた時: 1 列で赤が先・黄が後・各件は 1 回だけ・枠は赤・行き先は係の対応どおり', () => {
    const all = ok({
      paused: true, paused_note: 'メモ', today_cents: 21040, last_cron_at: ago(48), agent_configured: false,
      scout: { ...ok().scout, last_status: 'failed', month_cents: 1700 }, meeting: { ...ok().meeting, last_status: 'failed' },
      images: { ...ok().images, halted: 'manual', month_cents: 8400, backup_last_used_at: ago(60) },
      topics: { last_run: { status: 'failed', updated_at: ago(5) }, failed_24h: 1, month_cents: 0, month_cap_cents: 3000 },
    });
    const list = S.statusAlerts(all, NOW);
    const h = S.statusBandHtml(all, NOW);
    const rs = rowsOf(h);
    expect(rs).toHaveLength(list.length);
    expect(n(h, /<li class="sa-item/g)).toBe(list.length);
    const lv = rs.map((r) => r.level);
    expect(lv).toEqual([...lv].sort((x, y) => (x === 'red' ? 0 : 1) - (y === 'red' ? 0 : 1)));
    // 行き先の対応（st の値 → リンク）を 1 件ずつ: 行き先なしの件にはリンクが無い
    for (let i = 0; i < list.length; i++) expect([i, goOf(rs[i].html)]).toEqual([i, list[i].st]);
    // 赤: 停止中・職人 未設定・今日の上限・収集・会議・画像の停止・お題 / 黄: 定期処理・収集の月の上限・予備の鍵・画像の月の上限
    expect(list.map((a) => a.st)).toEqual([null, null, null, 'intake', 'meeting', 'maker', 'topics', null, 'intake', 'maker', 'maker']);
    expect(lv).toEqual(['red', 'red', 'red', 'red', 'red', 'red', 'red', 'yellow', 'yellow', 'yellow', 'yellow']);
    expect(n(h, /今日の費用が上限に達しました/g)).toBe(1);
    expect(n(h, /停止中です/g)).toBe(1);
    expect(cardCls(h, 'alerts')).toBe('sb-card sb-note sb-red');
    for (const k of ['run', 'money'] as Card[]) expect(cardCls(h, k)).toBe('sb-card');
  });
  it('行き先のリンクの文は係ごとに 1 つ（ALERT_GO_TEXT）。href の形 #/?st=<係> から係の id を取れる', () => {
    expect(Object.keys(S.ALERT_GO_TEXT).sort()).toEqual(['intake', 'maker', 'meeting', 'topics', 'verifier']);
    expect(S.stationGoId('#/?st=intake')).toBe('intake');
    expect(S.stationGoId('#/?st=maker')).toBe('maker');
    expect(S.stationGoId('#/?st=intake&x=1')).toBeNull();
    expect(S.stationGoId('#/materials')).toBeNull();
    expect(S.stationGoId('')).toBeNull();
  });
});
