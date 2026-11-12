import { describe, expect, it } from 'vitest';
import { liveConfig } from '../../src/config/gameConfig';
import { ALL_DESSERTS } from '../../src/dessert/data';
import { ProgressionManager } from '../../src/reward/ProgressionManager';
import { RewardManager } from '../../src/reward/RewardManager';
import { defaultProfile } from '../../src/reward/types';

const DEFAULT_IDS = ALL_DESSERTS.filter((d) => 'default' in d.unlock).map((d) => d.id);
const LOCKED = ALL_DESSERTS.filter((d) => 'cost' in d.unlock).sort((a, b) => (a.unlock as { cost: number }).cost - (b.unlock as { cost: number }).cost);
const cost = (d: (typeof ALL_DESSERTS)[number]) => (d.unlock as { cost: number }).cost;

function mk(coins: number) {
  const rewards = new RewardManager(liveConfig, { ...defaultProfile(DEFAULT_IDS), coins });
  return { rewards, prog: new ProgressionManager(ALL_DESSERTS, rewards) };
}

describe('ProgressionManager', () => {
  it('unlocks a dessert and spends its cost', () => {
    const { rewards, prog } = mk(1000);
    const d = LOCKED[0]!;
    expect(prog.unlock(d.id)).toBe('ok');
    expect(rewards.profile.unlocked).toContain(d.id);
    expect(rewards.profile.coins).toBe(1000 - cost(d));
  });

  it('reports insufficient coins without spending or unlocking', () => {
    const { rewards, prog } = mk(cost(LOCKED[0]!) - 1);
    expect(prog.unlock(LOCKED[0]!.id)).toBe('insufficient');
    expect(rewards.profile.coins).toBe(cost(LOCKED[0]!) - 1);
    expect(rewards.profile.unlocked).not.toContain(LOCKED[0]!.id);
  });

  it('reports unknown ids and already-unlocked desserts', () => {
    const { rewards, prog } = mk(1000);
    expect(prog.unlock('nope')).toBe('unknown');
    expect(prog.unlock(DEFAULT_IDS[0]!)).toBe('already');
    prog.unlock(LOCKED[0]!.id);
    const coins = rewards.profile.coins;
    expect(prog.unlock(LOCKED[0]!.id)).toBe('already'); // double call does not charge twice
    expect(rewards.profile.coins).toBe(coins);
  });

  it('nextAffordable is the cheapest affordable locked dessert, or null', () => {
    expect(mk(0).prog.nextAffordable()).toBeNull();
    expect(mk(cost(LOCKED[0]!)).prog.nextAffordable()?.id).toBe(LOCKED[0]!.id);
    expect(mk(1e9).prog.nextAffordable()?.id).toBe(LOCKED[0]!.id);
    const { prog } = mk(1e9);
    for (const d of LOCKED) expect(prog.unlock(d.id)).toBe('ok');
    expect(prog.nextAffordable()).toBeNull();
  });
});
