import { describe, expect, it } from 'vitest';
import { cafeConfig } from '../../src/config/gameConfig';
import { CafeQueue } from '../../src/cafe/CafeQueue';
import { genderForSeed, outfitIndex, politeEnding } from '../../src/cafe/gender';
import { HeartMeter } from '../../src/cooking/HeartMeter';
import { ParticleSystem } from '../../src/anim/ParticleSystem';
import { Game, type GameFx } from '../../src/Game';
import { ALL_DESSERTS } from '../../src/dessert/data';
import { DessertManager } from '../../src/dessert/DessertManager';
import { RewardManager } from '../../src/reward/RewardManager';
import { defaultProfile } from '../../src/reward/types';

describe('gender and polite ending', () => {
  it('maps outfits to male/female and ครับ/ค่ะ, for any seed', () => {
    expect([0, 1, 2, 3, 4, 5].map((s) => genderForSeed(s))).toEqual(['male', 'female', 'male', 'female', 'male', 'female']);
    expect(politeEnding('male')).toBe('ครับ');
    expect(politeEnding('female')).toBe('ค่ะ');
    for (const s of [NaN, -3, Infinity, 1e15, 2.9]) expect([0, 1, 2, 3]).toContain(outfitIndex(s));
  });
});

describe('customer says the order', () => {
  it('speaks "เอา<dessert>ค่ะ/ครับ" once per customer with a lower pitch for ครับ and a higher one for ค่ะ', () => {
    const lines: { t: string; pitch: number | undefined }[] = [];
    const fx: GameFx = {
      animations: { play: () => 1, isActive: () => false, update() {}, cancelRound: () => 0, activeCount: 0 },
      audio: { play: () => true, stopRound: () => 0, speak: (t, _r, pitch) => { lines.push({ t, pitch }); return true; } },
      particles: new ParticleSystem(cafeConfig.particles.cap, cafeConfig.particles.gravity),
    };
    const ids = ALL_DESSERTS.map((d) => d.id);
    const cfg = cafeConfig;
    const rewards = new RewardManager(cfg, defaultProfile(ids));
    const queue = new CafeQueue({ maxWaiting: cfg.cafe.maxWaiting, patienceMs: cfg.cafe.patienceMs, maxNameLength: cfg.cafe.maxNameLength });
    const meter = new HeartMeter({ decayPerSec: cfg.vote.heartDecayPerSec, maxBoost: cfg.vote.maxBoost });
    const game = new Game(cfg, new DessertManager(ALL_DESSERTS, ids, () => 0.3), fx, undefined, rewards, undefined, undefined, { queue, meter, rng: () => 0.3 });
    game.start();
    for (let i = 0; i < 400_000 && game.snapshot().roundsCompleted < 4; i++) game.update(16);
    const orders = lines.filter((l) => l.t.startsWith('เอา'));
    expect(orders.length).toBeGreaterThanOrEqual(3);
    for (const o of orders) {
      const male = o.t.endsWith('ครับ');
      expect(male || o.t.endsWith('ค่ะ')).toBe(true);
      expect(o.pitch).toBe(male ? 0.85 : 1.35);
      expect(ALL_DESSERTS.some((d) => o.t.includes(d.nameTh))).toBe(true);
    }
  });
});
