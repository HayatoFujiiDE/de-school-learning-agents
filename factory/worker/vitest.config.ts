import { defineConfig } from 'vitest/config';

// 純関数（state / checks）と publish の SQL（node:sqlite の実 DB）だけを対象にする。Workers ランタイムは使わない
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
