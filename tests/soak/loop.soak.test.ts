import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultConfig } from '../../src/config/gameConfig';
import { GameManager, type Snapshot } from '../../src/core/GameManager';
import { TRANSITIONS, type GameState } from '../../src/core/StateMachine';

const ROUNDS = 150;
const KEY = { PREPARING: 'preparing', COOKING: 'cooking', PRESENTING: 'presenting', REWARDING: 'rewarding', NEXT_DESSERT: 'nextDessert' } as const;
const SUM_MAX_MS = Object.values(defaultConfig.maxMs).reduce((a, b) => a + b, 0);
const FRAME_LIMIT = Math.ceil((ROUNDS * SUM_MAX_MS) / 16) + 1000;

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Runs the loop to ROUNDS finished rounds, asserting stability invariants on every frame. */
function soak(frameFn: (g: GameManager, check: () => void) => void): { cleaned: number[]; frames: number } {
  const cleaned: number[] = [];
  const g = new GameManager(defaultConfig, { onCleanupRound: (id) => cleaned.push(id) });
  expect(g.start()).toBe(true);
  expect(g.start()).toBe(false);

  let prev: Snapshot = g.snapshot();
  let frames = 0;

  // Invariants are checked after EVERY operation, so a frame with several legal moves is judged move by move.
  const check = (): void => {
    const cur = g.snapshot();
    expect(cur.state).not.toBe('IDLE');
    if (cur.state !== prev.state) expect(TRANSITIONS[prev.state]).toContain(cur.state);
    const idStep = cur.roundId - prev.roundId;
    expect(idStep === 0 || (idStep === 1 && cur.state === 'PREPARING')).toBe(true);
    expect(cur.stateElapsedMs).toBeGreaterThanOrEqual(0);
    expect(cur.stateElapsedMs).toBeLessThanOrEqual(defaultConfig.maxMs[KEY[cur.state as Exclude<GameState, 'IDLE'>]]);
    prev = cur;
  };

  while (g.snapshot().roundsCompleted < ROUNDS) {
    expect(frames++).toBeLessThan(FRAME_LIMIT); // loop never stalls
    frameFn(g, check);
    check();
  }
  return { cleaned, frames };
}

describe('core loop soak', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it(`completes ${ROUNDS} consecutive rounds without stalling`, () => {
    const { cleaned } = soak((g) => g.update(16));
    expect(cleaned).toHaveLength(ROUNDS);
    expect(new Set(cleaned).size).toBe(ROUNDS);
    expect(cleaned).toEqual(Array.from({ length: ROUNDS }, (_, i) => i + 1));
  });

  it(`survives ${ROUNDS} rounds of hostile input (bad dt, stale/future completeRound, repeated start)`, () => {
    const rand = mulberry32(12345);
    const dts = [16, 16, 16, NaN, -1, 0, 1e6, 5000, Infinity];
    const { cleaned } = soak((g, check) => {
      g.update(dts[Math.floor(rand() * dts.length)] as number);
      check();
      if (rand() < 0.1) {
        const id = g.snapshot().roundId;
        g.completeRound([id, id - 1, id + 1, 0][Math.floor(rand() * 4)] as number);
        check();
      }
      if (rand() < 0.05) g.start();
    });
    expect(cleaned).toHaveLength(ROUNDS);
    expect(new Set(cleaned).size).toBe(ROUNDS);
  });
});
