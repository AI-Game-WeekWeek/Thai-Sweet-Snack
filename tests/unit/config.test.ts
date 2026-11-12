import { describe, expect, it } from 'vitest';
import { defaultConfig, liveConfig } from '../../src/config/gameConfig';

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

  it('liveConfig turns placeholder cooking off with a generous global watchdog', () => {
    expect(defaultConfig.placeholderCooking).toBe(true);
    expect(liveConfig.placeholderCooking).toBe(false);
    expect(liveConfig.maxMs.cooking).toBeGreaterThan(60_000);
    expect(liveConfig.cooking.baseProgressPerSec).toBeGreaterThan(0);
  });
});
