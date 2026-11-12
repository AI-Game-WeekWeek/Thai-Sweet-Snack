import { defineConfig } from 'vitest/config';

// `vite build --mode demo` makes simulated viewers the default (for a hosted demo page nobody can add ?mock=1 to).
export default defineConfig(({ mode }) => ({
  define: { __DEMO__: JSON.stringify(mode === 'demo') },
  // Soak and memory tests simulate hundreds of rounds (several seconds of CPU).
  test: { include: ['tests/**/*.test.ts'], testTimeout: 120_000 },
}));
