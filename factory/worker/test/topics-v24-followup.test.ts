// contract-T v2.4 の確認レビューの残り（本文抽出のタグ名・文字参照、取った後に時間が足りない時の取り消し）
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/env';
import { checkTopic } from '../src/topics/check';
import { decodeCharRefs, fetchSource, htmlToText, normalizeForQuote } from '../src/topics/fetch-source';
import { runTopicRun } from '../src/topics/gen';
import { count, enable, fetchStub, genMessage, ledger, migratedDb, philoBody, scriptedPort, seedTopic, supportPassed, tomorrow, topic, topicEnv } from './topics-helpers';

const Q = 'これは本文に存在する二十字以上の引用文章です。';

describe('本文抽出: タグ名は英数字と - を全部読み、script / style は名前の完全一致だけ（レビュー残り 1）', () => {
  it('<style2-panel> は style ではない（中身は本文に残り、引用が found）', async () => {
    const html = `<style2-panel>${Q}</style2-panel>`;
    expect(normalizeForQuote(htmlToText(html))).toBe(Q);
    const { fetchImpl } = fetchStub({ 'https://src.example.org/a': { body: html } });
    expect((await fetchSource('https://src.example.org/a', Q, { fetchImpl })).result).toBe('found');
  });
  it('<script2> <styles> も中身を残し、<STYLE> <Script type=x> は中身ごと除く', () => {
    expect(normalizeForQuote(htmlToText(`<script2>a</script2><styles>b</styles>`))).toBe('a b');
    expect(normalizeForQuote(htmlToText(`x<STYLE>p{}</STYLE>y<Script type="x">z()</SCRIPT >w`))).toBe('x y w');
  });
});

describe('文字参照: 数値は先頭の 0 を許し、桁の上限は 0 を除いた後。大文字の別名 QUOT AMP LT GT（レビュー残り 2）', () => {
  it.each([
    [`<p>&#0000000169; ${Q}</p>`, `© ${Q}`],
    [`<p>&#x00000A9; ${Q}</p>`, `© ${Q}`],
    [`<p>&QUOT;${Q}&QUOT;</p>`, `"${Q}"`],
  ])('%s の引用は found', async (body, quote) => {
    const { fetchImpl } = fetchStub({ 'https://src.example.org/a': { body } });
    expect((await fetchSource('https://src.example.org/a', quote, { fetchImpl })).result).toBe('found');
  });
  it('AMP LT GT を戻し、0・範囲外・代理領域・0 を除いても桁の多すぎる数値はそのまま', () => {
    expect(decodeCharRefs('&AMP;&LT;&GT;&QUOT;')).toBe('&<>"');
    expect(decodeCharRefs('&#0; &#00000; &#x0000; &#x110000; &#1114112; &#xD800; &#00055296; &#12345678; &#x0001234567;')).toBe(
      '&#0; &#00000; &#x0000; &#x110000; &#1114112; &#xD800; &#00055296; &#12345678; &#x0001234567;',
    );
    expect(decodeCharRefs('&#00001114111;&#x00010FFFF;')).toBe(String.fromCodePoint(0x10ffff).repeat(2));
  });
});

describe('取った後に時間が足りない時は取り消す（枠も巡の回数も使わない。レビュー残り 3）', () => {
  let db: DatabaseSync;
  let env: Env;
  let clock = 0;
  beforeEach(() => {
    db = migratedDb();
    enable(db);
    env = topicEnv(db);
    clock = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('生成: 残り 200 秒で取った後、入力（RSS）で 196 秒経過 → run の行も台帳も残らず、呼び出し 0。次はまた取れる', async () => {
    let first = true;
    const fetchImpl = (async () => {
      if (first) {
        first = false;
        clock += 196_000;
      }
      return new Response('nf', { status: 404, headers: { 'content-type': 'text/plain' } });
    }) as unknown as typeof fetch;
    const p = scriptedPort([genMessage(null)]);
    const req = { purpose: 'gen', kind: 'news', trigger: 'cron', slotDay: tomorrow() } as const;
    const o = await runTopicRun(env, p.port, req, { deadline: clock + 200_000, fetchImpl });
    expect(o).toMatchObject({ status: 'not_taken', reason: 'no_time' });
    expect([count(db, 'SELECT COUNT(*) AS n FROM topic_runs'), ledger(db).length, p.calls.length]).toEqual([0, 0, 0]);
    // 同じ日の同じ種類をまた取れる（exists にならない）
    const o2 = await runTopicRun(env, p.port, req, { deadline: clock + 10 * 60_000, fetchImpl });
    expect(o2.status).toBe('failed');
    expect(p.calls.length).toBe(1);
    expect(count(db, "SELECT COUNT(*) AS n FROM topic_runs WHERE status = 'failed' AND error = 'no_output'")).toBe(1);
  });

  it('検査: 残り 10 秒で取った後、出典を開いて 6 秒経過 ×2 → draft・check_attempts 0・台帳 0・呼び出し 0。次はまた取れる', async () => {
    await seedTopic(db, { id: 'tp_c_1', body: philoBody() });
    let opened = 0; // この回の出典を開き終わる時刻（出典 2 つを並行で開いて 6 秒）
    const fetchImpl = (async () => {
      clock = Math.max(clock, opened);
      return new Response('nf', { status: 404, headers: { 'content-type': 'text/plain' } });
    }) as unknown as typeof fetch;
    const p = scriptedPort([supportPassed()]);
    for (let i = 0; i < 2; i++) {
      opened = clock + 6_000;
      const r = await checkTopic(env, p.port, 'tp_c_1', { deadline: clock + 10_000, fetchImpl });
      expect(r).toMatchObject({ status: 'not_taken', error: 'no_time' });
      expect(topic(db, 'tp_c_1')).toMatchObject({ status: 'draft', check_attempts: 0, check_token: null, check_lease_until: null, hold_reason: null });
      expect([ledger(db).length, p.calls.length]).toEqual([0, 0]);
    }
    opened = clock;
    const r = await checkTopic(env, p.port, 'tp_c_1', { deadline: clock + 10 * 60_000, fetchImpl });
    expect(r.attempt).toBe(1);
    expect(p.calls.length).toBe(1);
  });
});
