import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Soak and memory tests simulate hundreds of rounds (several seconds of CPU).
  test: { include: ['tests/**/*.test.ts'], testTimeout: 120_000 },
});
