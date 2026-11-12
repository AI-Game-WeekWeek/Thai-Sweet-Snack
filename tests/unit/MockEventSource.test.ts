import { describe, expect, it } from 'vitest';
import { MockEventSource } from '../../src/tiktok/MockEventSource';
import type { LiveEvent } from '../../src/tiktok/types';

function rng(seed: number): () => number {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
function collect(seed = 1) {
  const out: LiveEvent[] = [];
  const src = new MockEventSource(rng(seed), (e) => out.push(e as LiveEvent));
  return { out, src };
}

describe('MockEventSource', () => {
  it('steady emits at about the requested rate with unique ids', () => {
    const { out, src } = collect();
    src.steady(50, 4000);
    for (let t = 0; t < 4000; t += 16) src.tick(16, t);
    expect(out.length).toBeGreaterThan(160);
    expect(out.length).toBeLessThan(240);
    expect(new Set(out.map((e) => e.id)).size).toBe(out.length);
  });

  it('steady stops after its duration', () => {
    const { out, src } = collect();
    src.steady(100, 500);
    for (let t = 0; t < 2000; t += 16) src.tick(16, t);
    const n = out.length;
    for (let t = 2000; t < 4000; t += 16) src.tick(16, t);
    expect(out.length).toBe(n);
  });

  it('burst emits n events of the type with unique ids', () => {
    const { out, src } = collect();
    src.burst('like', 500, 1234);
    expect(out).toHaveLength(500);
    expect(out.every((e) => e.type === 'like' && e.tsMs === 1234)).toBe(true);
    expect(new Set(out.map((e) => e.id)).size).toBe(500);
  });

  it('duplicates repeats one id', () => {
    const { out, src } = collect();
    src.duplicates({ id: 'dup', type: 'follow', count: 1, tsMs: 1 }, 5);
    expect(out.map((e) => e.id)).toEqual(Array(5).fill('dup'));
  });

  it('delayed releases the event only after its delay', () => {
    const { out, src } = collect();
    src.delayed({ id: 'late', type: 'follow', count: 1, tsMs: 1 }, 1000);
    for (let t = 0; t < 900; t += 100) src.tick(100, t);
    expect(out).toHaveLength(0);
    for (let t = 900; t < 1200; t += 100) src.tick(100, t);
    expect(out.map((e) => e.id)).toEqual(['late']);
  });

  it('outOfOrder emits all events in a different order', () => {
    const { out, src } = collect(3);
    const events: LiveEvent[] = Array.from({ length: 20 }, (_, i) => ({ id: `o${i}`, type: 'like', count: 1, tsMs: i }));
    src.outOfOrder(events);
    expect(out).toHaveLength(20);
    expect(new Set(out.map((e) => e.id))).toEqual(new Set(events.map((e) => e.id)));
    expect(out.map((e) => e.id)).not.toEqual(events.map((e) => e.id));
  });

  it('is deterministic for the same seed', () => {
    const run = () => {
      const { out, src } = collect(9);
      src.steady(30, 1000);
      for (let t = 0; t < 1000; t += 16) src.tick(16, t);
      return out.map((e) => `${e.type}:${e.count}`).join(',');
    };
    expect(run()).toBe(run());
  });

  it('ignores invalid tick dt', () => {
    const { out, src } = collect();
    src.steady(100, 1000);
    for (const dt of [NaN, -5, 0, Infinity]) src.tick(dt, 0);
    expect(out).toHaveLength(0);
  });
});
