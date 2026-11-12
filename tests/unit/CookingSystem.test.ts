import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultConfig, type GameConfig } from '../../src/config/gameConfig';
import { CookingSystem } from '../../src/cooking/CookingSystem';
import { ProgressManager } from '../../src/cooking/ProgressManager';
import type { DessertDef } from '../../src/dessert/types';

function dessert(maxMs = 60_000): DessertDef {
  const step = (id: string, weight: number) => ({
    id, nameTh: id, anim: 'stir' as const, sound: 'stir' as const, weight, maxMs,
  });
  return {
    id: 'd', nameTh: 'ทดสอบ', nameEn: 'T', unlock: { default: true },
    ingredients: [{ id: 'i', nameTh: 'i', color: '#fff' }],
    steps: [step('a', 1), step('b', 2), step('c', 1)], // band ends 25 / 75 / 100
    presentation: { container: 'tray', layout: 'grid' },
    palette: ['#fff'], reward: { baseScore: 1, baseCoins: 1, xp: 1 },
  };
}

function setup(rate = 10, def = dessert()) {
  const config: GameConfig = { ...defaultConfig, cooking: { baseProgressPerSec: rate } };
  const progress = new ProgressManager();
  const log: string[] = [];
  const cooking = new CookingSystem(config, progress, {
    onStepStart: (s) => log.push(`start:${s.id}`),
    onStepComplete: (s) => log.push(`done:${s.id}`),
    onComplete: (id) => log.push(`complete:${id}`),
  });
  cooking.start(def, 1);
  return { cooking, progress, log };
}

describe('CookingSystem', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('start fires onStepStart for step 0 and resets progress', () => {
    const { cooking, log, progress } = setup();
    expect(log).toEqual(['start:a']);
    expect(progress.value).toBe(0);
    expect(cooking.snapshot()).toMatchObject({ active: true, stepIndex: 0, stepId: 'a', dessertId: 'd' });
  });

  it('step bands are proportional to weight', () => {
    const { cooking } = setup(0);
    cooking.addProgress(24);
    expect(cooking.snapshot().stepIndex).toBe(0);
    cooking.addProgress(2); // 26
    expect(cooking.snapshot().stepIndex).toBe(1);
    cooking.addProgress(50); // 76
    expect(cooking.snapshot().stepIndex).toBe(2);
  });

  it('auto progress follows baseProgressPerSec', () => {
    const { cooking, progress } = setup(10);
    cooking.update(1000);
    expect(progress.value).toBeCloseTo(10, 5);
  });

  it('one huge add completes all steps in order and onComplete fires once', () => {
    const { cooking, log, progress } = setup(0);
    expect(cooking.addProgress(1e9)).toBe(100);
    cooking.addProgress(1e9);
    cooking.update(1000);
    expect(progress.value).toBe(100);
    expect(log).toEqual(['start:a', 'done:a', 'start:b', 'done:b', 'start:c', 'done:c', 'complete:1']);
    expect(cooking.snapshot().active).toBe(false);
  });

  it('completeCurrentStep x3 completes the round; a 4th returns false; onComplete once', () => {
    const { cooking, log } = setup(0);
    expect(cooking.completeCurrentStep()).toBe(true);
    expect(cooking.snapshot().progress).toBe(25);
    expect(cooking.completeCurrentStep()).toBe(true);
    expect(cooking.completeCurrentStep()).toBe(true);
    expect(cooking.completeCurrentStep()).toBe(false);
    expect(log.filter((l) => l.startsWith('complete'))).toEqual(['complete:1']);
  });

  it('step watchdog force-completes a stuck step', () => {
    const { cooking, log } = setup(0, dessert(1000));
    for (let i = 0; i < 10; i++) cooking.update(100);
    expect(log).toContain('done:a');
    expect(cooking.snapshot().stepIndex).toBe(1);
  });

  it('cancel makes everything a no-op without firing callbacks', () => {
    const { cooking, log } = setup(10);
    cooking.cancel();
    const before = [...log];
    cooking.update(5000);
    expect(cooking.addProgress(50)).toBe(0);
    expect(cooking.completeCurrentStep()).toBe(false);
    expect(log).toEqual(before);
    expect(cooking.snapshot().active).toBe(false);
  });

  it('start again resets state for the new round', () => {
    const { cooking, progress, log } = setup(0);
    cooking.addProgress(60);
    cooking.start(dessert(), 2);
    expect(progress.value).toBe(0);
    expect(progress.roundId).toBe(2);
    expect(cooking.snapshot()).toMatchObject({ active: true, stepIndex: 0 });
    cooking.addProgress(1e9);
    expect(log[log.length - 1]).toBe('complete:2');
  });

  it('a throwing callback does not stop later callbacks or the round', () => {
    const progress = new ProgressManager();
    const done: number[] = [];
    const cooking = new CookingSystem({ ...defaultConfig, cooking: { baseProgressPerSec: 0 } }, progress, {
      onStepComplete: () => {
        throw new Error('boom');
      },
      onComplete: (id) => done.push(id),
    });
    cooking.start(dessert(), 1);
    cooking.addProgress(1e9);
    expect(done).toEqual([1]);
  });

  it('ignores NaN, negative and zero dt', () => {
    const { cooking, progress } = setup(10);
    for (const dt of [NaN, -1, 0, Infinity]) cooking.update(dt);
    expect(progress.value).toBe(0);
  });

  it('inactive before start', () => {
    const cooking = new CookingSystem(defaultConfig, new ProgressManager());
    expect(cooking.snapshot().active).toBe(false);
    expect(cooking.addProgress(10)).toBe(0);
    expect(cooking.completeCurrentStep()).toBe(false);
    cooking.update(100);
  });
});
