import { readdirSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vitest/config';

/** Lists the recorded voice files in public/voice as voice/index.json, so the game only asks for files that exist (no 404 noise). */
function voiceIndex(): Plugin {
  const list = (): string => {
    try {
      return JSON.stringify(readdirSync('public/voice').filter((f) => /^[a-z0-9-]+\.mp3$/.test(f)).sort());
    } catch {
      return '[]';
    }
  };
  return {
    name: 'voice-index',
    configureServer(server) {
      server.middlewares.use('/voice/index.json', (_req, res) => {
        res.setHeader('content-type', 'application/json');
        res.end(list());
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'voice/index.json', source: list() });
    },
  };
}

// `vite build --mode demo` makes simulated viewers the default (for a hosted demo page nobody can add ?mock=1 to).
export default defineConfig(({ mode }) => ({
  // relative asset paths: the same build works at a domain root, in a sub-folder (GitHub Pages) and when the bridge serves it
  base: './',
  // demo = simulated viewers + visible test keys; packed = the downloadable game (no simulated viewers, shortcut keys on, quiet)
  define: { __DEMO__: JSON.stringify(mode === 'demo'), __PACKED__: JSON.stringify(mode === 'packed') },
  plugins: [voiceIndex()],
  // Soak and memory tests simulate hundreds of rounds (several seconds of CPU).
  test: { include: ['tests/**/*.test.ts'], testTimeout: 120_000 },
}));
