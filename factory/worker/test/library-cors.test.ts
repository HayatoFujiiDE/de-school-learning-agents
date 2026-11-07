// 配信 API（/api/library/*。認証なし・読み取り専用）は別オリジンの学習者サイトがブラウザから直接 fetch で読むので、
// 応答（エラーを含む）に access-control-allow-origin: * が付く。管理 API には付かない。
import { describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import worker from '../src/index';
import { d1, migratedDb } from './d1-shim';

const envOf = () => ({ DB: d1(migratedDb()), R2: { head: async () => null, get: async () => null } }) as unknown as Env;
const call = (path: string, method = 'GET') => worker.fetch(new Request(`http://localhost${path}`, { method }), envOf(), {} as ExecutionContext);

describe('配信 API の CORS（別オリジンの学習者サイト向け）', () => {
  it('GET /api/library/available に access-control-allow-origin: * が付く', async () => {
    const res = await call('/api/library/available');
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(await res.json()).toEqual({ materials: [] });
  });

  it('GET /api/library/topics?day= と /api/library/topics/stock?kind= にも付く', async () => {
    for (const p of ['/api/library/topics?day=2026-11-08', '/api/library/topics/stock?kind=news&limit=3']) {
      const res = await call(p);
      expect(res.headers.get('access-control-allow-origin'), p).toBe('*');
    }
  });

  it('GET /api/library/models3d は従来どおり * と 10 分の cache', async () => {
    const res = await call('/api/library/models3d');
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('cache-control')).toBe('public, max-age=600');
  });

  it('404（知らない path）と 405（GET 以外）にも付く（ブラウザがエラーの本文を読める）', async () => {
    const nf = await call('/api/library/nothing');
    expect(nf.status).toBe(404);
    expect(nf.headers.get('access-control-allow-origin')).toBe('*');
    const mna = await call('/api/library/available', 'POST');
    expect(mna.status).toBe(405);
    expect(mna.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('管理 API（/api/jobs 等）には付かない', async () => {
    const res = await call('/api/jobs');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});
