import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { liveConfig } from '../../src/config/gameConfig';
import { Game } from '../../src/Game';
import { ALL_DESSERTS } from '../../src/dessert/data';
import { DessertManager } from '../../src/dessert/DessertManager';
import { RewardManager } from '../../src/reward/RewardManager';
import { defaultProfile } from '../../src/reward/types';
import { TikTokEventManager } from '../../src/tiktok/TikTokEventManager';

const IDS = ALL_DESSERTS.map((d) => d.id);

function mk(withEvents = false) {
  const rewards = new RewardManager(liveConfig, defaultProfile(IDS));
  const events = withEvents ? new TikTokEventManager(liveConfig) : undefined;
  const game = new Game(liveConfig, new DessertManager(ALL_DESSERTS, IDS, () => 0.4), undefined, events, rewards);
  return { game, rewards, events };
}
function runUntil(g: Game, pred: () => boolean, limit = 400_000): void {
  for (let i = 0; i < limit && !pred(); i++) g.update(16);
  expect(pred()).toBe(true);
}

describe('Game rewards', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it('awards exactly once per finished round over 20 rounds and totals never decrease', () => {
    const { game, rewards } = mk();
    game.start();
    let prevCoins = 0;
    let prevScore = 0;
    for (let i = 0; i < 20; i++) {
      runUntil(game, () => game.snapshot().roundsCompleted > i);
      expect(rewards.profile.rounds).toBe(i + 1);
      expect(rewards.profile.coins).toBeGreaterThanOrEqual(prevCoins);
      expect(rewards.profile.score).toBeGreaterThanOrEqual(prevScore);
      prevCoins = rewards.profile.coins;
      prevScore = rewards.profile.score;
    }
  });

  it('snapshot exposes totals, level and a reward toast that clears next round', () => {
    const { game } = mk();
    game.start();
    runUntil(game, () => game.snapshot().state === 'REWARDING');
    const s = game.snapshot();
    expect(s.reward.last).not.toBeNull();
    expect(s.reward.score).toBe(s.reward.last!.score);
    expect(s.toast).toContain(`+${s.reward.last!.score}`);
    runUntil(game, () => game.snapshot().state === 'PREPARING' && game.snapshot().roundId === 2);
    expect(game.snapshot().toast).toBeNull();
  });

  it('a share bonus raises that round\'s award', () => {
    const { game, events } = mk(true);
    game.start();
    runUntil(game, () => game.snapshot().state === 'COOKING');
    game.ingestEvent({ id: 's1', type: 'share', count: 1, tsMs: game.nowMs });
    game.update(16);
    runUntil(game, () => game.snapshot().state === 'REWARDING');
    const def = ALL_DESSERTS.find((d) => d.nameTh === game.snapshot().dessertNameTh)!;
    expect(game.snapshot().reward.last!.score).toBeGreaterThan(def.reward.baseScore);
    expect(events!.totals.shares).toBe(1);
  });

  it('repeating the completion cannot double-award', () => {
    const { game, rewards } = mk();
    game.start();
    runUntil(game, () => game.snapshot().state === 'REWARDING');
    game.manager.completeRound(1);
    game.manager.completeRound(1);
    expect(rewards.profile.rounds).toBe(1);
  });

  it('works without a RewardManager (zeros)', () => {
    const game = new Game(liveConfig, new DessertManager(ALL_DESSERTS, IDS, () => 0.4));
    game.start();
    runUntil(game, () => game.snapshot().state === 'REWARDING');
    expect(game.snapshot().reward).toMatchObject({ score: 0, coins: 0, level: 1, last: null });
  });

  it('exposes the ingredient list of the current dessert', () => {
    const { game } = mk();
    game.start();
    const s = game.snapshot();
    const def = ALL_DESSERTS.find((d) => d.nameTh === s.dessertNameTh)!;
    expect(s.ingredients.map((i) => i.nameTh)).toEqual(def.ingredients.map((i) => i.nameTh));
  });
});
