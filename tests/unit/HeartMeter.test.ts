import { describe, expect, it } from 'vitest';
import { HeartMeter } from '../../src/cooking/HeartMeter';

const mk = () => new HeartMeter({ decayPerSec: 0.1, maxBoost: 4 });

describe('HeartMeter', () => {
  it('starts empty with multiplier 1', () => {
    const m = mk();
    expect(m.value).toBe(0);
    expect(m.multiplier).toBe(1);
  });

  it('adds heat, caps at 1, multiplier reaches maxBoost', () => {
    const m = mk();
    m.add(0.5);
    expect(m.value).toBe(0.5);
    expect(m.multiplier).toBeCloseTo(2.5, 6);
    m.add(1e12);
    expect(m.value).toBe(1);
    expect(m.multiplier).toBe(4);
  });

  it('decays over time and never goes below 0', () => {
    const m = mk();
    m.add(0.5);
    m.update(2000);
    expect(m.value).toBeCloseTo(0.3, 6);
    m.update(60_000);
    expect(m.value).toBe(0);
  });

  it('ignores NaN, Infinity, negative and zero amounts and invalid dt', () => {
    const m = mk();
    m.add(0.4);
    for (const a of [NaN, Infinity, -Infinity, -1, 0]) m.add(a);
    for (const d of [NaN, -5, 0, Infinity]) m.update(d);
    expect(m.value).toBe(0.4);
  });

  it('reset empties the meter', () => {
    const m = mk();
    m.add(1);
    m.reset();
    expect(m.value).toBe(0);
  });
});
