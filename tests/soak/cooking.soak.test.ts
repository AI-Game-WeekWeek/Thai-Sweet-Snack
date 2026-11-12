import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { liveConfig } from '../../src/config/gameConfig';
import { Game } from '../../src/Game';
import { TRANSITIONS } from '../../src/core/StateMachine';
import { ALL_DESSERTS } from '../../src/dessert/data';
import { DessertManager } from '../../src/dessert/DessertManager';

const ROUNDS = 120;
const FRAME_LIMIT = 600_000;
const IDS = ALL_DESSERTS.map((d) => d.id);

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('cooking soak (real recipes through Game)', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  function run(hostile: boolean) {
    const rand = mulberry32(hostile ? 99 : 5);
    const game = new Game(liveConfig, new DessertManager(ALL_DESSERTS, IDS, mulberry32(3)));
    game.start();
    const seen = new Set<string>();
    const stepsByRound = new Map<number, string[]>();
    const dessertByRound = new Map<number, string>();
    let prev = game.snapshot();
    let prevProgress = 0;

    // Invariants are checked after EVERY operation: one frame may hold update() plus an injection.
    const check = (): void => {
      const s = game.snapshot();
      expect(s.progress).toBeGreaterThanOrEqual(0);
      expect(s.progress).toBeLessThanOrEqual(100);
      if (s.roundId === prev.roundId) expect(s.progress).toBeGreaterThanOrEqual(prevProgress);
      if (s.state !== prev.state) expect(TRANSITIONS[prev.state]).toContain(s.state);
      if (!hostile && s.state === 'PRESENTING' && prev.state === 'COOKING') expect(s.progress).toBe(100); // ended by completion, not a watchdog
      expect(s.roundId - prev.roundId === 0 || s.roundId - prev.roundId === 1).toBe(true);

      if (s.dessertNameTh) {
        seen.add(s.dessertNameTh);
        dessertByRound.set(s.roundId, s.dessertNameTh);
      }
      if (s.state === 'COOKING' && s.stepNameTh) {
        const list = stepsByRound.get(s.roundId) ?? [];
        if (list[list.length - 1] !== s.stepNameTh) list.push(s.stepNameTh);
        stepsByRound.set(s.roundId, list);
      }
      prevProgress = s.progress;
      prev = s;
    };

    for (let frame = 0; game.snapshot().roundsCompleted < ROUNDS; frame++) {
      expect(frame).toBeLessThan(FRAME_LIMIT);
      game.update(16);
      check();
      if (hostile && rand() < 0.01) {
        game.debugAddProgress([NaN, -5, Infinity, 1e12, 7][Math.floor(rand() * 5)] as number);
        check();
        if (rand() < 0.3) {
          game.debugCompleteStep();
          check();
        }
      }
    }
    return { seen, stepsByRound, dessertByRound };
  }

  it(`runs ${ROUNDS} rounds, every dessert appears, steps run in recipe order`, () => {
    const { seen, stepsByRound, dessertByRound } = run(false);
    expect(seen.size).toBe(8);
    let checked = 0;
    for (const [round, steps] of stepsByRound) {
      const def = ALL_DESSERTS.find((d) => d.nameTh === dessertByRound.get(round));
      expect(def).toBeDefined();
      if (round > ROUNDS) continue; // the in-progress round after the last completed one
      expect(steps).toEqual(def!.steps.map((s) => s.nameTh));
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(ROUNDS);
  });

  it(`survives ${ROUNDS} rounds with hostile progress injections (NaN, negative, Infinity, 1e12, complete-step)`, () => {
    const { seen } = run(true);
    expect(seen.size).toBe(8);
  });
});
