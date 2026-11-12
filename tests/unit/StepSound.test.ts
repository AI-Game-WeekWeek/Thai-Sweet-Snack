import { describe, expect, it } from 'vitest';
import { liveConfig } from '../../src/config/gameConfig';
import { ParticleSystem } from '../../src/anim/ParticleSystem';
import { Game, type GameFx } from '../../src/Game';
import { ALL_DESSERTS } from '../../src/dessert/data';
import { DessertManager } from '../../src/dessert/DessertManager';
import { SOUND_IDS } from '../../src/dessert/types';
import { RewardManager } from '../../src/reward/RewardManager';
import { defaultProfile } from '../../src/reward/types';

describe('cooking sound lasts the whole step', () => {
  it('replays the step sound and adds detail sounds (sloshing, drips, bubbles) while cooking, never with a stale round', () => {
    const played: { s: string; r: number }[] = [];
    const fx: GameFx = {
      animations: { play: () => 1, isActive: () => false, update() {}, cancelRound: () => 0, activeCount: 0 },
      audio: { play: (s, r) => { played.push({ s, r }); return true; }, stopRound: () => 0 },
      particles: new ParticleSystem(liveConfig.particles.cap, liveConfig.particles.gravity),
    };
    const game = new Game(liveConfig, new DessertManager(ALL_DESSERTS, ALL_DESSERTS.map((d) => d.id), () => 0.4), fx);
    game.start();
    for (let i = 0; i < 4000 && game.snapshot().state !== 'COOKING'; i++) game.update(16);
    played.length = 0;
    for (let i = 0; i < 120; i++) game.update(16); // ~2 s of cooking
    const kinds = new Set(played.map((p) => p.s));
    expect(played.length).toBeGreaterThanOrEqual(3); // more than the single blip at the start of the step
    expect([...kinds].every((k) => (SOUND_IDS as readonly string[]).includes(k))).toBe(true);
    const round = game.snapshot().roundId;
    expect(played.every((p) => p.r === round)).toBe(true);
  });
});

describe('reward sound and spoken line', () => {
  it('plays the reward jingle and speaks the dessert name once when a round is paid', () => {
    const played: string[] = [];
    const spoken: string[] = [];
    const fx: GameFx = {
      animations: { play: () => 1, isActive: () => false, update() {}, cancelRound: () => 0, activeCount: 0 },
      audio: { play: (s) => { played.push(s); return true; }, stopRound: () => 0, speak: (t) => { spoken.push(t); return true; } },
      particles: new ParticleSystem(liveConfig.particles.cap, liveConfig.particles.gravity),
    };
    const rewards = new RewardManager(liveConfig, defaultProfile(ALL_DESSERTS.map((d) => d.id).slice(0, 1)));
    const game = new Game(liveConfig, new DessertManager(ALL_DESSERTS, rewards.profile.unlocked, () => 0.4), fx, undefined, rewards);
    game.start();
    for (let i = 0; i < 20000 && !played.includes('reward'); i++) game.update(16);
    expect(played.filter((s) => s === 'reward').length).toBe(1);
    expect(spoken.length).toBe(1);
    expect(spoken[0]).toContain('เสร็จแล้ว');
  });
});
