// fake の YouTube oEmbed（契約 §Q-11 2・12: テスト・smoke 用の OEmbedPort）。src/fake/anthropic.ts が re-export し、
// 読み込みは src/anthropic.ts の loadFake（FAKE_GUARD の動的 import 1 箇所）からだけ。本番ではこのモジュールに到達しない。
// 外へは通信しない。シナリオは settings.fake_oembed_scenario（既定 ok）。呼び出しの数は settings.fake_oembed_calls に数える。

import { getSetting, setSetting } from '../db';
import type { Env } from '../env';
import { sanitizeOEmbedFields, type OEmbedPort } from '../youtube-oembed';

export const FAKE_OEMBED_SCENARIOS = ['ok', 'not_found', 'restricted', 'unavailable'] as const;
export type FakeOEmbedScenario = (typeof FAKE_OEMBED_SCENARIOS)[number];

export function createFakeOEmbedPort(env: Env): OEmbedPort {
  return {
    isFake: true,
    async lookup(youtubeId) {
      const raw = await getSetting(env.DB, 'fake_oembed_scenario');
      const scenario: FakeOEmbedScenario = (FAKE_OEMBED_SCENARIOS as readonly string[]).includes(raw ?? '') ? (raw as FakeOEmbedScenario) : 'ok';
      const n = Number.parseInt((await getSetting(env.DB, 'fake_oembed_calls')) ?? '0', 10);
      await setSetting(env.DB, 'fake_oembed_calls', String((Number.isFinite(n) ? n : 0) + 1));
      if (scenario !== 'ok') return { outcome: scenario };
      return {
        outcome: 'ok',
        ...sanitizeOEmbedFields({ title: `（fake）動画の題名 ${youtubeId}`, author_name: '（fake）チャンネル', author_url: 'https://www.youtube.com/@fake-channel' }),
      };
    },
  };
}
