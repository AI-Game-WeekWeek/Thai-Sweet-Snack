import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultConfig, type GameConfig } from '../../src/config/gameConfig';
import { GameManager, type GameHooks } from '../../src/core/GameManager';
import type { GameState } from '../../src/core/StateMachine';

function runUntil(g: GameManager, pred: () => boolean, dt = 100, limit = 10_000): void {
  for (let i = 0; i < limit && !pred(); i++) g.update(dt);
  expect(pred()).toBe(true);
}

describe('GameManager', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('start() twice: second call returns false', () => {
    const g = new GameManager(defaultConfig);
    expect(g.start()).toBe(true);
    expect(g.start()).toBe(false);
    expect(g.snapshot().state).toBe('PREPARING');
    expect(g.snapshot().roundId).toBe(1);
  });

  it('cycles PREPARING→COOKING→PRESENTING→REWARDING→NEXT_DESSERT→PREPARING with roundId 1 then 2', () => {
    const seen: GameState[] = [];
    const g = new GameManager(defaultConfig, { onEnter: (s) => seen.push(s) });
    g.start();
    runUntil(g, () => g.snapshot().roundId === 2);
    expect(seen).toEqual(['PREPARING', 'COOKING', 'PRESENTING', 'REWARDING', 'NEXT_DESSERT', 'PREPARING']);
    expect(g.snapshot().roundsCompleted).toBe(1);
  });

  it('completeRound is idempotent and rejects stale, future and out-of-state calls', () => {
    const g = new GameManager(defaultConfig);
    g.start();
    expect(g.completeRound(1)).toBe(false); // PREPARING, not COOKING
    runUntil(g, () => g.snapshot().state === 'COOKING');
    expect(g.completeRound(99)).toBe(false);
    expect(g.completeRound(0)).toBe(false);
    expect(g.completeRound(1)).toBe(true);
    expect(g.snapshot().state).toBe('PRESENTING');
    expect(g.completeRound(1)).toBe(false);
    expect(g.snapshot().state).toBe('PRESENTING');
  });

  it('a stale roundId cannot complete the next round', () => {
    const g = new GameManager(defaultConfig);
    g.start();
    runUntil(g, () => g.snapshot().roundId === 2 && g.snapshot().state === 'COOKING');
    expect(g.completeRound(1)).toBe(false);
    expect(g.snapshot().state).toBe('COOKING');
  });

  it('a huge dt causes at most one transition and is clamped to maxFrameMs', () => {
    const quick: GameConfig = {
      ...defaultConfig,
      durationsMs: { preparing: 50, cooking: 50, presenting: 50, rewarding: 50, nextDessert: 50 },
    };
    const g = new GameManager(quick);
    g.start();
    g.update(60_000);
    expect(g.snapshot().state).toBe('COOKING');

    const g2 = new GameManager(defaultConfig);
    g2.start();
    g2.update(60_000);
    expect(g2.snapshot().state).toBe('PREPARING');
    expect(g2.snapshot().stateElapsedMs).toBeLessThanOrEqual(defaultConfig.maxFrameMs);
  });

  it('ignores NaN, negative, zero and infinite dt', () => {
    const g = new GameManager(defaultConfig);
    g.start();
    const before = g.snapshot();
    for (const dt of [NaN, -5, 0, Infinity, -Infinity]) g.update(dt);
    expect(g.snapshot()).toEqual(before);
  });

  it('watchdog advances COOKING within maxMs even if the nominal duration is longer', () => {
    const stuck: GameConfig = {
      ...defaultConfig,
      durationsMs: { ...defaultConfig.durationsMs, cooking: 999_999 },
    };
    const g = new GameManager(stuck);
    g.start();
    runUntil(g, () => g.snapshot().state === 'COOKING');
    let elapsed = 0;
    while (g.snapshot().state === 'COOKING') {
      g.update(100);
      elapsed += 100;
      expect(elapsed).toBeLessThanOrEqual(stuck.maxMs.cooking + 100);
    }
    expect(g.snapshot().state).toBe('PRESENTING');
  });

  it('calls onCleanupRound exactly once per finished round with the old id', () => {
    const cleaned: number[] = [];
    const g = new GameManager(defaultConfig, { onCleanupRound: (id) => cleaned.push(id) });
    g.start();
    runUntil(g, () => g.snapshot().roundId === 4);
    expect(cleaned).toEqual([1, 2, 3]);
  });

  it('keeps cycling when onEnter throws', () => {
    const hooks: GameHooks = {
      onEnter: () => {
        throw new Error('boom');
      },
    };
    const g = new GameManager(defaultConfig, hooks);
    g.start();
    runUntil(g, () => g.snapshot().roundId === 3);
  });

  it('keeps cycling when onCleanupRound throws', () => {
    const g = new GameManager(defaultConfig, {
      onCleanupRound: () => {
        throw new Error('boom');
      },
    });
    g.start();
    runUntil(g, () => g.snapshot().roundId === 3);
  });

  it('stop() freezes updates; start() resumes the same state and roundId', () => {
    const g = new GameManager(defaultConfig);
    g.start();
    runUntil(g, () => g.snapshot().state === 'COOKING');
    const frozen = g.snapshot();
    g.stop();
    expect(g.running).toBe(false);
    g.update(100);
    expect(g.snapshot()).toEqual(frozen);
    expect(g.start()).toBe(true);
    expect(g.snapshot().state).toBe('COOKING');
    expect(g.snapshot().roundId).toBe(frozen.roundId);
  });

  it('update before start does nothing', () => {
    const g = new GameManager(defaultConfig);
    g.update(100);
    expect(g.snapshot().state).toBe('IDLE');
  });

  it('onTick gets the clamped dt only for valid dt while running', () => {
    const ticks: [GameState, number, number][] = [];
    const g = new GameManager(defaultConfig, { onTick: (st, dt, id) => ticks.push([st, dt, id]) });
    g.update(100); // not running
    g.start();
    g.update(60_000);
    g.update(NaN);
    g.update(-1);
    g.update(16);
    expect(ticks).toEqual([
      ['PREPARING', defaultConfig.maxFrameMs, 1],
      ['PREPARING', 16, 1],
    ]);
  });

  it('a state change made inside onTick (completeRound) ends that update without a second transition', () => {
    const seen: GameState[] = [];
    let g!: GameManager;
    g = new GameManager(defaultConfig, {
      onEnter: (s) => seen.push(s),
      onTick: (st, _dt, id) => {
        if (st === 'COOKING') g.completeRound(id);
      },
    });
    g.start();
    for (let i = 0; i < 20 && g.snapshot().state !== 'COOKING'; i++) g.update(100);
    g.update(100);
    expect(g.snapshot().state).toBe('PRESENTING');
    expect(g.snapshot().stateElapsedMs).toBe(0);
    expect(seen.filter((s) => s === 'PRESENTING')).toHaveLength(1);
  });

  it('with placeholderCooking=false COOKING ignores the nominal duration and ends at the watchdog', () => {
    const live: GameConfig = {
      ...defaultConfig,
      placeholderCooking: false,
      maxMs: { ...defaultConfig.maxMs, cooking: 5000 },
    };
    const g = new GameManager(live);
    g.start();
    runUntil(g, () => g.snapshot().state === 'COOKING');
    let t = 0;
    while (g.snapshot().state === 'COOKING') {
      g.update(100);
      t += 100;
      expect(t).toBeLessThanOrEqual(5100);
    }
    expect(t).toBeGreaterThanOrEqual(4900);
  });
});
