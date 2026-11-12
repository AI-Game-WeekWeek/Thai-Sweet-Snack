import type { DessertDef } from './types';

/** Picks the next dessert with a shuffle-bag: every unlocked dessert once per bag, no back-to-back repeats. */
export class DessertManager {
  private bag: DessertDef[] = [];
  private pool: DessertDef[] = [];
  private last: string | null = null;

  constructor(
    private readonly defs: readonly DessertDef[],
    unlockedIds: readonly string[],
    private readonly rng: () => number = Math.random,
  ) {
    this.setUnlocked(unlockedIds);
  }

  get(id: string): DessertDef | undefined {
    return this.defs.find((d) => d.id === id);
  }

  setUnlocked(ids: readonly string[]): void {
    const wanted = new Set(ids);
    let pool = this.defs.filter((d) => wanted.has(d.id));
    if (pool.length === 0) {
      const fallback = this.defs.find((d) => 'default' in d.unlock) ?? this.defs[0];
      pool = fallback ? [fallback] : [];
    }
    this.pool = pool;
    this.bag = [];
  }

  /** Up to `n` distinct unlocked desserts for a menu board (fewer if fewer are unlocked). */
  pickCandidates(n: number): DessertDef[] {
    const want = Math.min(Math.max(0, Math.floor(n)), this.pool.length);
    const out: DessertDef[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < want * 4 && out.length < want; i++) {
      const d = this.next();
      if (!seen.has(d.id)) {
        seen.add(d.id);
        out.push(d);
      }
    }
    return out;
  }

  peekNext(): DessertDef {
    this.ensureBag();
    return this.bag[this.bag.length - 1] as DessertDef;
  }

  next(): DessertDef {
    this.ensureBag();
    const d = this.bag.pop() as DessertDef;
    this.last = d.id;
    return d;
  }

  private ensureBag(): void {
    if (this.bag.length > 0) return;
    if (this.pool.length === 0) throw new Error('DessertManager: no desserts available');
    const shuffled = [...this.pool];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j] as DessertDef, shuffled[i] as DessertDef];
    }
    // The bag is consumed from the end. Make sure the first pick is not the previous dessert.
    const lastIdx = shuffled.length - 1;
    if (shuffled.length > 1 && shuffled[lastIdx]?.id === this.last) {
      [shuffled[lastIdx], shuffled[0]] = [shuffled[0] as DessertDef, shuffled[lastIdx] as DessertDef];
    }
    this.bag = shuffled;
  }
}
