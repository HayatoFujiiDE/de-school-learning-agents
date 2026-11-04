// Batch results / files.download の本文受信（§R-40 (d)）: SDK の timeout はヘッダ受信で解除されるので、
// 本文が止まったままでも絶対期限（AbortSignal）で抜けること、受信量に上限があることを、本物の port に偽の fetch を渡して確かめる。
import { describe, expect, it } from 'vitest';
import { BATCH_RESULTS_MAX, DOWNLOAD_MAX_BYTES, PortError, realPort } from '../src/anthropic';
import type { Env } from '../src/env';

const env = { ANTHROPIC_API_KEY: 'test-not-a-key' } as unknown as Env;
const RESULTS_URL = 'https://api.anthropic.com/v1/messages/batches/msgbatch_t/results';

const batchJson = () =>
  JSON.stringify({
    id: 'msgbatch_t',
    type: 'message_batch',
    processing_status: 'ended',
    created_at: '2026-11-04T00:00:00Z',
    expires_at: '2026-11-05T00:00:00Z',
    ended_at: '2026-11-04T01:00:00Z',
    archived_at: null,
    cancel_initiated_at: null,
    request_counts: { processing: 0, succeeded: 1, errored: 0, canceled: 0, expired: 0 },
    results_url: RESULTS_URL,
  });

/** 最初の 1 片だけ送って止まる本文（fetch の signal は見ない: fetch 実装が本文を止めなくても期限で抜けることを見る） */
const stalled = () =>
  new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode('{"custom_id":"m1",'));
    },
  });

/** 終わらない本文（毎回 64KB を返し続ける） */
const endless = (chunk: Uint8Array) => new ReadableStream<Uint8Array>({ pull: (c) => c.enqueue(chunk) });

function fakeFetch(body: () => ReadableStream<Uint8Array> | string): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (/\/v1\/messages\/batches\/msgbatch_t(\?|$)/.test(url)) return new Response(batchJson(), { headers: { 'content-type': 'application/json' } });
    return new Response(body(), { headers: { 'content-type': 'application/binary' } });
  }) as typeof fetch;
}

describe('本文受信の絶対期限と受信量上限（§R-40 (d)）', () => {
  it('batches.results: ヘッダの後で本文が止まったままなら期限で中断して PortError(timeout)', async () => {
    const port = realPort(env, { fetchImpl: fakeFetch(stalled) });
    const t0 = Date.now();
    const err = await port.batchResults('msgbatch_t', { deadline: Date.now() + 1_500 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PortError);
    expect((err as PortError).kind).toBe('timeout');
    expect((err as PortError).responded).toBe(false);
    expect(Date.now() - t0).toBeLessThan(5_000);
  });

  it('files.download: 本文が止まったままなら期限で中断して PortError(timeout)', async () => {
    const port = realPort(env, { fetchImpl: fakeFetch(stalled) });
    const err = await port.downloadFile('file_t', { deadline: Date.now() + 1_500 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PortError);
    expect((err as PortError).kind).toBe('timeout');
  });

  it('files.download: 終わらない本文も上限 + 1 bytes で読むのをやめる（呼び出し側の大きさ検査で落ちる）', async () => {
    const port = realPort(env, { fetchImpl: fakeFetch(() => endless(new Uint8Array(64 * 1024))) });
    const bytes = await port.downloadFile('file_t', { deadline: Date.now() + 10_000 });
    expect(bytes.byteLength).toBe(DOWNLOAD_MAX_BYTES + 1);
  });

  it(`batches.results: ${BATCH_RESULTS_MAX} 行まで・1MB を超える本文は閉じた行だけ使い、それより先は読まない`, async () => {
    const line = (i: number) => `${JSON.stringify({ custom_id: `m${i}`, result: { type: 'canceled' } })}\n`;
    const many = Array.from({ length: 30 }, (_, i) => line(i)).join('');
    const port = realPort(env, { fetchImpl: fakeFetch(() => many) });
    const r = await port.batchResults('msgbatch_t', { deadline: Date.now() + 10_000 });
    expect(r).toHaveLength(BATCH_RESULTS_MAX);
    expect(r[0].custom_id).toBe('m0');

    const enc = new TextEncoder();
    const big = enc.encode(line(0) + 'x'.repeat(64 * 1024));
    const port2 = realPort(env, { fetchImpl: fakeFetch(() => endless(big)) });
    await expect(port2.batchResults('msgbatch_t', { deadline: Date.now() + 10_000 })).rejects.toMatchObject({ kind: 'invalid_results' });
  });
});
