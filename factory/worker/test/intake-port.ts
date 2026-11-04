// テスト用: 入口が使う FactoryPort の呼び出しだけを fixture で返す小さな stub（呼び出し回数を数える）。
import { readFileSync } from 'node:fs';
import type { Message } from '@anthropic-ai/sdk/resources/messages/messages';
import type { FactoryPort } from '../src/anthropic';
import { parseXaiResponse } from '../src/xai';

export const fixture = (p: string): string => readFileSync(new URL(`./fixtures/${p}`, import.meta.url), 'utf8');
export const fixtureJson = <T = Record<string, unknown>>(p: string): T => JSON.parse(fixture(p)) as T;

export interface Counted {
  port: FactoryPort;
  calls: Record<string, number>;
  last: Record<string, unknown>;
}

const no = () => {
  throw new Error('not used in this test');
};

export function intakePort(over: Partial<FactoryPort> = {}): Counted {
  const calls: Record<string, number> = {};
  const last: Record<string, unknown> = {};
  const count = (k: string, arg?: unknown) => {
    calls[k] = (calls[k] ?? 0) + 1;
    last[k] = arg;
  };
  const base: FactoryPort = {
    isFake: true,
    createSession: no,
    retrieveSession: no,
    listSessionsPage: no,
    listEventsPage: no,
    sendEvents: no,
    archiveSession: no,
    listFilesPage: no,
    downloadFile: no,
    async createMessage(params) {
      count('createMessage', params);
      const fx = fixtureJson<{ stop_reason: string; usage: Record<string, number>; output: unknown }>('scout/haiku.json');
      return { content: [{ type: 'text', text: JSON.stringify(fx.output) }], stop_reason: fx.stop_reason, usage: fx.usage } as unknown as Message;
    },
    async xaiResponses(req) {
      count('xaiResponses', req);
      return parseXaiResponse(fixtureJson('scout/xai.json'));
    },
    async createBatch(params) {
      count('createBatch', params);
      return { id: 'msgbatch_test_1', processing_status: 'in_progress', created_at: new Date().toISOString(), expires_at: new Date().toISOString() };
    },
    async retrieveBatch(id) {
      count('retrieveBatch', id);
      return { id, processing_status: 'ended', created_at: new Date().toISOString(), expires_at: new Date().toISOString() };
    },
    async batchResults(id) {
      count('batchResults', id);
      return [];
    },
    listBatchesPage: no,
  };
  for (const [k, f] of Object.entries(over)) {
    (base as unknown as Record<string, unknown>)[k] = async (...a: unknown[]) => {
      count(k, a[0]);
      return (f as (...x: unknown[]) => unknown)(...a);
    };
  }
  return { port: base, calls, last };
}
