import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../src/config/gameConfig';
import { RewardManager } from '../../src/reward/RewardManager';
import { defaultProfile } from '../../src/reward/types';
import type { DessertDef } from '../../src/dessert/types';

const R = defaultConfig.reward;
const def = (over: Partial<DessertDef['reward']> = {}): DessertDef => ({ art: 'bowl',
  id: 'd1', nameTh: 'ท', nameEn: 'T', unlock: { default: true },
  ingredients: [{ id: 'i', nameTh: 'i', color: '#fff' }],
  steps: [{ id: 's', nameTh: 's', anim: 'stir', sound: 'stir', weight: 1, maxMs: 1000 }],
  presentation: { container: 'tray', layout: 'grid' }, palette: ['#fff'],
  reward: { baseScore: 100, baseCoins: 10, xp: 40, ...over },
});
const mk = () => new RewardManager(defaultConfig, defaultProfile(['d1']));
const slow = { roundId: 1, bonusPct: 0, cookMs: R.speedParMs };

describe('RewardManager', () => {
  it('awards base values with no bonus when the round was slow', () => {
    const m = mk();
    const r = m.award(def(), slow)!;
    expect(r).toMatchObject({ roundId: 1, dessertId: 'd1', score: 100, coins: 10, xp: 40 });
    expect(m.profile).toMatchObject({ score: 100, coins: 10, xp: 40, rounds: 1 });
    expect(m.profile.collection).toEqual({ d1: 1 });
  });

  it('share bonus and speed bonus multiply score and coins but not xp', () => {
    const m = mk();
    const r = m.award(def(), { roundId: 1, bonusPct: 20, cookMs: 0 })!;
    const mult = 1 + (20 + R.speedBonusMaxPct) / 100;
    expect(r.score).toBe(Math.round(100 * mult));
    expect(r.coins).toBe(Math.round(10 * mult));
    expect(r.xp).toBe(40);
  });

  it('speed bonus shrinks linearly to zero at the par time', () => {
    const half = mk().award(def(), { roundId: 1, bonusPct: 0, cookMs: R.speedParMs / 2 })!;
    expect(half.score).toBe(Math.round(100 * (1 + R.speedBonusMaxPct / 2 / 100)));
  });

  it('is idempotent per round: a second award returns the same result and adds nothing', () => {
    const m = mk();
    const a = m.award(def(), slow);
    const b = m.award(def(), slow);
    expect(b).toBe(a);
    expect(m.profile.score).toBe(100);
    expect(m.profile.rounds).toBe(1);
  });

  it('rejects a stale roundId but accepts the next one', () => {
    const m = mk();
    m.award(def(), { ...slow, roundId: 5 });
    expect(m.award(def(), { ...slow, roundId: 3 })).toBeNull();
    expect(m.award(def(), { ...slow, roundId: 6 })).not.toBeNull();
    expect(m.profile.rounds).toBe(2);
  });

  it('invalid bonus or time never increases the award beyond base', () => {
    for (const bad of [NaN, -50, Infinity]) {
      const r = mk().award(def(), { roundId: 1, bonusPct: bad, cookMs: bad })!;
      expect(r.score).toBeLessThanOrEqual(Math.round(100 * (1 + 1000 / 100)));
      expect(r.score).toBeGreaterThanOrEqual(100);
    }
    expect(mk().award(def(), { roundId: 1, bonusPct: NaN, cookMs: NaN })!.score).toBe(100);
    expect(mk().award(def(), { roundId: 1, bonusPct: -50, cookMs: -1 })!.score).toBe(100);
  });

  it('levels follow the xp curve and report levelUp once', () => {
    const m = mk();
    expect(m.level).toBe(1);
    const r1 = m.award(def({ xp: R.xpBase - 1 }), { ...slow, roundId: 1 })!;
    expect(r1.levelUp).toBe(false);
    expect(m.level).toBe(1);
    const r2 = m.award(def({ xp: 1 }), { ...slow, roundId: 2 })!;
    expect(r2.levelUp).toBe(true);
    expect(m.level).toBe(2);
    const r3 = m.award(def({ xp: 1 }), { ...slow, roundId: 3 })!;
    expect(r3.levelUp).toBe(false);
    m.award(def({ xp: Math.ceil(R.xpBase * R.xpGrowth) }), { ...slow, roundId: 4 });
    expect(m.level).toBe(3);
  });

  it('spend only succeeds for a valid amount within the balance', () => {
    const m = mk();
    m.award(def(), slow);
    expect(m.spend(11)).toBe(false);
    expect(m.spend(-1)).toBe(false);
    expect(m.spend(NaN)).toBe(false);
    expect(m.spend(4)).toBe(true);
    expect(m.profile.coins).toBe(6);
  });

  it('collection counts grow per dessert and replaceProfile swaps the data', () => {
    const m = mk();
    m.award(def(), { ...slow, roundId: 1 });
    m.award(def(), { ...slow, roundId: 2 });
    expect(m.profile.collection).toEqual({ d1: 2 });
    m.replaceProfile({ ...defaultProfile(['d1']), coins: 77 });
    expect(m.profile.coins).toBe(77);
    expect(m.last).toBeNull();
  });
});
