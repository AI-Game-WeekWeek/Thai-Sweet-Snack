import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { liveConfig } from '../../src/config/gameConfig';
import { Game } from '../../src/Game';
import { ALL_DESSERTS } from '../../src/dessert/data';
import { DessertManager } from '../../src/dessert/DessertManager';
import { ProgressionManager } from '../../src/reward/ProgressionManager';
import { RewardManager } from '../../src/reward/RewardManager';
import { SaveSystem, type StorageLike } from '../../src/save/SaveSystem';
import { MockEventSource } from '../../src/tiktok/MockEventSource';
import { TikTokEventManager } from '../../src/tiktok/TikTokEventManager';

const ROUNDS = 150;
const ALL_IDS = ALL_DESSERTS.map((d) => d.id);
const DEFAULT_IDS = ALL_DESSERTS.filter((d) => 'default' in d.unlock).map((d) => d.id);

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Storage that randomly fails reads and writes, like a full or blocked browser store. */
class FlakyStorage implements StorageLike {
  data = new Map<string, string>();
  failures = 0;
  constructor(private readonly rand: () => number) {}
  private maybeFail(): void {
    if (this.rand() < 0.3) {
      this.failures++;
      throw new Error('storage failure');
    }
  }
  getItem(k: string) { this.maybeFail(); return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.maybeFail(); this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
}

describe('progression and save soak', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it(`${ROUNDS} rounds with flaky storage and event chaos: totals sane, saves reloadable, all desserts unlock`, () => {
    const rand = mulberry32(31);
    const storage = new FlakyStorage(mulberry32(77));
    const save = new SaveSystem(liveConfig, storage, DEFAULT_IDS, ALL_IDS);
    const rewards = new RewardManager(liveConfig, save.load());
    const events = new TikTokEventManager(liveConfig);
    const desserts = new DessertManager(ALL_DESSERTS, rewards.profile.unlocked, mulberry32(9));
    const game = new Game(liveConfig, desserts, undefined, events, rewards, { progression: new ProgressionManager(ALL_DESSERTS, rewards), save });
    const mock = new MockEventSource(mulberry32(5), (e) => game.ingestEvent(e));
    mock.steady(100, 1e9);
    game.start();

    let prev = { ...rewards.profile };
    let prevLevel = rewards.level;
    for (let frame = 0; game.snapshot().roundsCompleted < ROUNDS; frame++) {
      expect(frame).toBeLessThan(900_000);
      mock.tick(16, game.nowMs);
      if (rand() < 0.003) mock.burst('like', 1500, game.nowMs);
      game.update(16);

      const p = rewards.profile;
      expect(p.score).toBeGreaterThanOrEqual(prev.score);
      expect(p.xp).toBeGreaterThanOrEqual(prev.xp);
      expect(p.rounds).toBeGreaterThanOrEqual(prev.rounds);
      expect(p.coins).toBeGreaterThanOrEqual(0);
      if (p.coins < prev.coins) expect(p.unlocked.length).toBeGreaterThan(prev.unlocked.length); // coins only drop when something is bought
      expect(p.unlocked.length).toBeGreaterThanOrEqual(prev.unlocked.length);
      expect(rewards.level).toBeGreaterThanOrEqual(prevLevel);
      prev = { ...p };
      prevLevel = rewards.level;
    }

    expect(storage.failures).toBeGreaterThan(0); // the flakiness really happened
    expect(rewards.profile.rounds).toBe(ROUNDS);
    expect([...rewards.profile.unlocked].sort()).toEqual([...ALL_IDS].sort());

    // Whatever was last saved must load back cleanly (a failed write leaves an older, still valid save).
    const reload = new SaveSystem(liveConfig, { getItem: (k) => storage.data.get(k) ?? null, setItem() {}, removeItem() {} }, DEFAULT_IDS, ALL_IDS).load();
    expect(reload.version).toBe(1);
    expect(reload.rounds).toBeLessThanOrEqual(ROUNDS);
    expect(reload.unlocked.length).toBeGreaterThanOrEqual(DEFAULT_IDS.length);
  });
});
