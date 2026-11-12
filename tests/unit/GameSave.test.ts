import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { liveConfig } from '../../src/config/gameConfig';
import { Game } from '../../src/Game';
import { ALL_DESSERTS } from '../../src/dessert/data';
import { DessertManager } from '../../src/dessert/DessertManager';
import { ProgressionManager } from '../../src/reward/ProgressionManager';
import { RewardManager } from '../../src/reward/RewardManager';
import { defaultProfile, type ProfileData } from '../../src/reward/types';
import { SaveSystem, type StorageLike } from '../../src/save/SaveSystem';

const ALL_IDS = ALL_DESSERTS.map((d) => d.id);
const DEFAULT_IDS = ALL_DESSERTS.filter((d) => 'default' in d.unlock).map((d) => d.id);
const LOCKED_BY_COST = ALL_DESSERTS.filter((d) => 'cost' in d.unlock).sort((a, b) => (a.unlock as { cost: number }).cost - (b.unlock as { cost: number }).cost).map((d) => d.id);

class MemStorage implements StorageLike {
  data = new Map<string, string>();
  writes = 0;
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.writes++; this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
}

function mk(storage: StorageLike | null, profileOverride?: Partial<ProfileData>, cfg = liveConfig) {
  const save = new SaveSystem(cfg, storage, DEFAULT_IDS, ALL_IDS);
  const profile = { ...save.load(), ...profileOverride };
  const rewards = new RewardManager(cfg, profile);
  const desserts = new DessertManager(ALL_DESSERTS, rewards.profile.unlocked, () => 0.4);
  const game = new Game(cfg, desserts, undefined, undefined, rewards, { progression: new ProgressionManager(ALL_DESSERTS, rewards), save });
  return { game, rewards, desserts, save };
}
function runUntil(g: Game, pred: () => boolean, limit = 800_000): void {
  for (let i = 0; i < limit && !pred(); i++) g.update(16);
  expect(pred()).toBe(true);
}

describe('Game progression and save', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('auto-unlocks the cheapest affordable dessert once per round, in cost order, with a toast', () => {
    const { game, rewards } = mk(new MemStorage(), { coins: 100_000 });
    game.start();
    for (let i = 0; i < LOCKED_BY_COST.length; i++) {
      runUntil(game, () => game.snapshot().roundsCompleted > i && game.snapshot().state === 'NEXT_DESSERT');
      expect(rewards.profile.unlocked).toContain(LOCKED_BY_COST[i]);
      expect(rewards.profile.unlocked.length).toBe(DEFAULT_IDS.length + i + 1);
      expect(game.snapshot().toast).toContain('ปลดล็อก');
    }
  });

  it('does not unlock when coins are insufficient', () => {
    const { game, rewards } = mk(new MemStorage(), { coins: 0 });
    game.start();
    runUntil(game, () => game.snapshot().state === 'NEXT_DESSERT');
    // one round earns far less than the cheapest unlock cost, so nothing unlocks and nothing is spent
    expect(rewards.profile.unlocked.length).toBe(DEFAULT_IDS.length);
    expect(rewards.profile.coins).toBeGreaterThan(0);
    expect(rewards.profile.coins).toBeLessThan(150);
  });

  it('newly unlocked desserts enter the rotation', () => {
    const { game } = mk(new MemStorage(), { coins: 100_000 });
    game.start();
    const seen = new Set<string>();
    for (let i = 0; i < 24; i++) {
      runUntil(game, () => game.snapshot().roundsCompleted > i);
      seen.add(game.snapshot().dessertNameTh ?? '');
    }
    expect(seen.size).toBe(ALL_DESSERTS.length);
  });

  it('saves at each round end and reloads coins, collection and unlocks', () => {
    const st = new MemStorage();
    const a = mk(st);
    a.game.start();
    runUntil(a.game, () => a.game.snapshot().roundsCompleted >= 3 && a.game.snapshot().state === 'PREPARING');
    expect(st.writes).toBeGreaterThanOrEqual(3);
    const b = mk(st);
    expect(b.rewards.profile.coins).toBe(a.rewards.profile.coins);
    expect(b.rewards.profile.rounds).toBe(a.rewards.profile.rounds);
    expect(b.rewards.profile.collection).toEqual(a.rewards.profile.collection);
    expect(b.rewards.profile.unlocked.sort()).toEqual(a.rewards.profile.unlocked.sort());
  });

  it('a throwing or full storage never stops the loop (30 rounds)', () => {
    const st = new MemStorage();
    st.setItem = () => { throw new Error('QuotaExceededError'); };
    const { game } = mk(st);
    game.start();
    runUntil(game, () => game.snapshot().roundsCompleted >= 30);
  });

  it('storage that is missing entirely still plays', () => {
    const { game } = mk(null);
    game.start();
    runUntil(game, () => game.snapshot().roundsCompleted >= 3);
  });

  it('a corrupt save at startup starts a fresh game and keeps the blob as backup', () => {
    const st = new MemStorage();
    st.setItem(liveConfig.save.key, '{oops');
    const { game, rewards } = mk(st);
    expect(rewards.profile).toEqual(defaultProfile(DEFAULT_IDS));
    expect(st.getItem(liveConfig.save.backupKey)).toBe('{oops');
    game.start();
    runUntil(game, () => game.snapshot().roundsCompleted >= 1);
  });

  it('autoUnlock=false never unlocks on its own', () => {
    const cfg = { ...liveConfig, progression: { autoUnlock: false } };
    const { game, rewards } = mk(new MemStorage(), { coins: 100_000 }, cfg);
    game.start();
    runUntil(game, () => game.snapshot().roundsCompleted >= 3);
    expect(rewards.profile.unlocked.length).toBe(DEFAULT_IDS.length);
  });
});
