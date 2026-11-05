// fake の Gemini（契約 §Q-7: テスト・smoke 用の GeminiPort）。src/fake/anthropic.ts が re-export し、
// 読み込みは src/anthropic.ts の loadFake（FAKE_GUARD の動的 import 1 箇所）からだけ。本番ではこのモジュールに到達しない。
// シナリオは settings.fake_gemini_scenario（既定 ok）。呼び出しの数は settings.fake_gemini_calls に数える（smoke が「Gemini 0 回」を数える）。
// プロンプトの本文は記録しない。

import { getSetting, setSetting } from '../db';
import { cfg, type Env } from '../env';
import { GeminiError, type GeminiPort } from '../gemini';

export const FAKE_GEMINI_SCENARIOS = ['ok', 'no_usage', 'server', 'bad_request', 'timeout', 'no_text'] as const;
export type FakeGeminiScenario = (typeof FAKE_GEMINI_SCENARIOS)[number];

export function createFakeGeminiPort(env: Env): GeminiPort {
  return {
    isFake: true,
    configured: true,
    model: cfg(env).videoModel,
    async watch(req) {
      const raw = await getSetting(env.DB, 'fake_gemini_scenario');
      const scenario: FakeGeminiScenario = (FAKE_GEMINI_SCENARIOS as readonly string[]).includes(raw ?? '') ? (raw as FakeGeminiScenario) : 'ok';
      const n = Number.parseInt((await getSetting(env.DB, 'fake_gemini_calls')) ?? '0', 10);
      await setSetting(env.DB, 'fake_gemini_calls', String((Number.isFinite(n) ? n : 0) + 1));
      if (scenario === 'server') throw new GeminiError(true, 500, 'server', false);
      if (scenario === 'bad_request') throw new GeminiError(true, 400, 'bad_request', false);
      if (scenario === 'timeout') throw new GeminiError(false, undefined, 'timeout', false);
      if (scenario === 'no_text') throw new GeminiError(true, 200, 'no_text', true);
      const text = `- ${req.startSec} 秒〜${req.endSec} 秒: （fake）画面に説明の図が映り、話し手が仕組みを説明している\n- 手がかり: チャンネル名と動画の説明が一致（fake）\n- 不適切な表現: 無し（fake）`;
      return scenario === 'no_usage'
        ? { text, httpStatus: 200 }
        : { text, usage: { total_input_tokens: 30_000, total_output_tokens: 400, total_tokens: 30_400 }, httpStatus: 200 };
    },
  };
}
