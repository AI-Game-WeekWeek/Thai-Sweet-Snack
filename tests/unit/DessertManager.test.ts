import { describe, expect, it } from 'vitest';
import { ALL_DESSERTS } from '../../src/dessert/data';
import { DessertManager } from '../../src/dessert/DessertManager';

function rng(seed: number): () => number {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
const IDS = ALL_DESSERTS.map((d) => d.id);

describe('DessertManager', () => {
  it('never repeats back to back and uses every dessert (8 unlocked, 100 picks)', () => {
    const m = new DessertManager(ALL_DESSERTS, IDS, rng(1));
    const counts = new Map<string, number>();
    let prev = '';
    for (let i = 0; i < 100; i++) {
      const d = m.next();
      expect(d.id).not.toBe(prev);
      prev = d.id;
      counts.set(d.id, (counts.get(d.id) ?? 0) + 1);
    }
    for (const id of IDS) expect(counts.get(id)).toBeGreaterThanOrEqual(12);
  });

  it('each bag of 8 contains all 8', () => {
    const m = new DessertManager(ALL_DESSERTS, IDS, rng(7));
    for (let bag = 0; bag < 5; bag++) {
      const ids = Array.from({ length: 8 }, () => m.next().id);
      expect(new Set(ids).size).toBe(8);
    }
  });

  it('one unlocked dessert is always returned', () => {
    const m = new DessertManager(ALL_DESSERTS, [IDS[2]!], rng(3));
    for (let i = 0; i < 10; i++) expect(m.next().id).toBe(IDS[2]);
  });

  it('empty or unknown unlocked set falls back to a default-unlocked dessert', () => {
    for (const unlocked of [[], ['nope']]) {
      const m = new DessertManager(ALL_DESSERTS, unlocked, rng(5));
      const d = m.next();
      expect('default' in d.unlock).toBe(true);
    }
  });

  it('peekNext equals the following next and does not consume', () => {
    const m = new DessertManager(ALL_DESSERTS, IDS, rng(9));
    for (let i = 0; i < 20; i++) {
      const peek = m.peekNext();
      expect(m.peekNext().id).toBe(peek.id);
      expect(m.next().id).toBe(peek.id);
    }
  });

  it('setUnlocked changes the pool and get() finds by id', () => {
    const m = new DessertManager(ALL_DESSERTS, [IDS[0]!], rng(2));
    m.setUnlocked([IDS[4]!]);
    expect(m.next().id).toBe(IDS[4]);
    expect(m.get(IDS[1]!)?.id).toBe(IDS[1]);
    expect(m.get('zzz')).toBeUndefined();
  });

  it('pickCandidates returns distinct unlocked desserts (100 draws of 3 from 8)', () => {
    const m = new DessertManager(ALL_DESSERTS, IDS, rng(21));
    for (let i = 0; i < 100; i++) {
      const c = m.pickCandidates(3);
      expect(c).toHaveLength(3);
      expect(new Set(c.map((d) => d.id)).size).toBe(3);
      for (const d of c) expect(IDS).toContain(d.id);
    }
  });

  it('pickCandidates with fewer unlocked than asked returns what exists', () => {
    const two = new DessertManager(ALL_DESSERTS, [IDS[0]!, IDS[1]!], rng(2));
    expect(two.pickCandidates(3).map((d) => d.id).sort()).toEqual([IDS[0], IDS[1]].sort());
    const one = new DessertManager(ALL_DESSERTS, [IDS[3]!], rng(2));
    expect(one.pickCandidates(3).map((d) => d.id)).toEqual([IDS[3]]);
    const none = new DessertManager(ALL_DESSERTS, [], rng(2));
    expect(none.pickCandidates(3).length).toBeGreaterThanOrEqual(1);
    expect(none.pickCandidates(0)).toEqual([]);
  });
});
