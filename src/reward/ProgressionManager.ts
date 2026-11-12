import type { DessertDef } from '../dessert/types';
import type { RewardManager } from './RewardManager';

export type UnlockResult = 'ok' | 'unknown' | 'already' | 'insufficient';

/** Coin-based unlocks. Coins come only from finished rounds; nothing here involves payments or gifts. */
export class ProgressionManager {
  constructor(
    private readonly defs: readonly DessertDef[],
    private readonly rewards: RewardManager,
  ) {}

  unlock(id: string): UnlockResult {
    const def = this.defs.find((d) => d.id === id);
    if (!def) return 'unknown';
    if (this.rewards.profile.unlocked.includes(id) || 'default' in def.unlock) return 'already';
    if (!this.rewards.spend(def.unlock.cost)) return 'insufficient';
    this.rewards.addUnlocked(id);
    return 'ok';
  }

  nextAffordable(): DessertDef | null {
    let best: DessertDef | null = null;
    for (const d of this.defs) {
      if ('default' in d.unlock || this.rewards.profile.unlocked.includes(d.id)) continue;
      if (d.unlock.cost > this.rewards.profile.coins) continue;
      if (!best || d.unlock.cost < (best.unlock as { cost: number }).cost) best = d;
    }
    return best;
  }
}
