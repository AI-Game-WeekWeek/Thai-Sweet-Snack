import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../src/config/gameConfig';

const KEYS = ['preparing', 'cooking', 'presenting', 'rewarding', 'nextDessert'] as const;

describe('defaultConfig', () => {
  it('has duration and watchdog entries for every state key', () => {
    for (const k of KEYS) {
      expect(defaultConfig.durationsMs[k]).toBeGreaterThan(0);
      expect(defaultConfig.maxMs[k]).toBeGreaterThan(0);
    }
  });
  it('watchdog limit exceeds nominal duration for every state', () => {
    for (const k of KEYS) {
      expect(defaultConfig.maxMs[k]).toBeGreaterThan(defaultConfig.durationsMs[k]);
    }
  });
  it('has a positive maxFrameMs', () => {
    expect(defaultConfig.maxFrameMs).toBeGreaterThan(0);
  });
});
