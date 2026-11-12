import { describe, expect, it } from 'vitest';
import { ProgressManager } from '../../src/cooking/ProgressManager';

function fresh(round = 1): ProgressManager {
  const p = new ProgressManager();
  p.startRound(round);
  return p;
}

describe('ProgressManager', () => {
  it('starts at 0 and adds within range', () => {
    const p = fresh();
    expect(p.value).toBe(0);
    expect(p.add(30, 1)).toBe(30);
    expect(p.value).toBe(30);
  });

  it('clamps to 100 and reports the applied amount', () => {
    const p = fresh();
    p.add(30, 1);
    expect(p.add(1e12, 1)).toBe(70);
    expect(p.value).toBe(100);
    expect(p.add(5, 1)).toBe(0);
    expect(p.value).toBe(100);
  });

  it('rejects NaN, Infinity, negative and zero amounts', () => {
    const p = fresh();
    p.add(10, 1);
    for (const bad of [NaN, Infinity, -Infinity, -5, 0]) expect(p.add(bad, 1)).toBe(0);
    expect(p.value).toBe(10);
  });

  it('rejects stale and future round ids', () => {
    const p = fresh(1);
    expect(p.add(5, 2)).toBe(0);
    expect(p.add(5, 0)).toBe(0);
    expect(p.value).toBe(0);
  });

  it('setAtLeast raises but never lowers, and clamps', () => {
    const p = fresh();
    expect(p.setAtLeast(40, 1)).toBe(40);
    expect(p.setAtLeast(10, 1)).toBe(0);
    expect(p.value).toBe(40);
    p.setAtLeast(500, 1);
    expect(p.value).toBe(100);
    expect(p.setAtLeast(NaN, 1)).toBe(0);
    expect(p.setAtLeast(60, 2)).toBe(0);
  });

  it('startRound resets progress and invalidates the old round', () => {
    const p = fresh(1);
    p.add(50, 1);
    p.startRound(2);
    expect(p.value).toBe(0);
    expect(p.roundId).toBe(2);
    expect(p.add(5, 1)).toBe(0);
    expect(p.add(5, 2)).toBe(5);
  });
});
