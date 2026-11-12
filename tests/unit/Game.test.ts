import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { liveConfig, type GameConfig } from '../../src/config/gameConfig';
import { Game } from '../../src/Game';
import { ALL_DESSERTS } from '../../src/dessert/data';
import { DessertManager } from '../../src/dessert/DessertManager';
import type { DessertDef } from '../../src/dessert/types';

const IDS = ALL_DESSERTS.map((d) => d.id);

function mk(seed = 1): Game {
  let s = seed;
  const rng = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  return new Game(liveConfig, new DessertManager(ALL_DESSERTS, IDS, rng));
}
function runUntil(g: Game, pred: () => boolean, limit = 200_000): void {
  for (let i = 0; i < limit && !pred(); i++) g.update(16);
  expect(pred()).toBe(true);
}

describe('Game', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it('PREPARING picks a dessert with progress 0 and names the next one', () => {
    const g = mk();
    g.start();
    const s = g.snapshot();
    expect(s.state).toBe('PREPARING');
    expect(s.dessertNameTh).toBeTruthy();
    expect(s.nextDessertNameTh).toBeTruthy();
    expect(s.progress).toBe(0);
  });

  it('COOKING makes progress rise, then the round ends in PRESENTING at 100', () => {
    const g = mk();
    g.start();
    runUntil(g, () => g.snapshot().state === 'COOKING');
    runUntil(g, () => g.snapshot().progress > 10);
    runUntil(g, () => g.snapshot().state === 'PRESENTING');
    expect(g.snapshot().progress).toBe(100);
  });

  it('the next round picks a different dessert, shown as "next" beforehand, and progress restarts at 0', () => {
    const g = mk();
    g.start();
    const first = g.snapshot();
    runUntil(g, () => g.snapshot().state === 'PRESENTING');
    const announcedNext = g.snapshot().nextDessertNameTh;
    runUntil(g, () => g.snapshot().roundId === 2);
    const second = g.snapshot();
    expect(second.dessertNameTh).not.toBe(first.dessertNameTh);
    expect(second.dessertNameTh).toBe(announcedNext);
    expect(second.progress).toBe(0);
  });

  it('debug helpers are no-ops outside COOKING and hostile values never exceed 100', () => {
    const g = mk();
    g.start();
    g.debugAddProgress(50);
    g.debugCompleteStep();
    expect(g.snapshot().progress).toBe(0);
    runUntil(g, () => g.snapshot().state === 'COOKING');
    for (const v of [NaN, -5, Infinity, 1e12]) g.debugAddProgress(v);
    expect(g.snapshot().progress).toBeLessThanOrEqual(100);
  });

  it('completeCurrentStep chain finishes the dessert once and does not skip a round', () => {
    const g = mk();
    g.start();
    runUntil(g, () => g.snapshot().state === 'COOKING');
    for (let i = 0; i < 12; i++) g.debugCompleteStep();
    expect(g.snapshot().state).toBe('PRESENTING');
    expect(g.snapshot().roundId).toBe(1);
    g.debugCompleteStep();
    expect(g.snapshot().state).toBe('PRESENTING');
  });

  it('old-round progress cannot leak into the new round', () => {
    const g = mk();
    g.start();
    runUntil(g, () => g.snapshot().roundId === 2 && g.snapshot().state === 'PREPARING');
    expect(g.snapshot().progress).toBe(0);
    g.debugAddProgress(40); // not COOKING: ignored
    expect(g.snapshot().progress).toBe(0);
  });

  it('when the COOKING watchdog ends the round early, cooking is stopped and no step is shown afterwards', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const short: GameConfig = { ...liveConfig, maxMs: { ...liveConfig.maxMs, cooking: 2000 } };
    const g = new Game(short, new DessertManager(ALL_DESSERTS, IDS, () => 0.3));
    g.start();
    runUntil(g, () => g.snapshot().state === 'PRESENTING');
    const s = g.snapshot();
    expect(s.progress).toBeLessThan(100);
    expect(s.stepNameTh).toBeNull();
    expect(g.debugAddProgress(50)).toBe(0);
  });

  it('if picking the next dessert throws, the previous dessert is not replayed', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const def = ALL_DESSERTS[0] as DessertDef;
    let calls = 0;
    const flaky = {
      next: (): DessertDef => {
        if (++calls === 2) throw new Error('boom');
        return def;
      },
      peekNext: (): DessertDef => def,
    } as unknown as DessertManager;
    const g = new Game(liveConfig, flaky);
    g.start();
    runUntil(g, () => g.snapshot().roundId === 2);
    expect(g.snapshot().dessertNameTh).toBeNull();
  });
});
