import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { liveConfig } from '../../src/config/gameConfig';
import { AnimationManager } from '../../src/anim/AnimationManager';
import { ParticleSystem } from '../../src/anim/ParticleSystem';
import { Game, type AudioLike } from '../../src/Game';
import { ALL_DESSERTS } from '../../src/dessert/data';
import { DessertManager } from '../../src/dessert/DessertManager';

const ROUNDS = 120;
const IDS = ALL_DESSERTS.map((d) => d.id);

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Counts live "voices" per round like the real manager would. */
class CountingAudio implements AudioLike {
  live = new Map<number, number>();
  maxLive = 0;
  play(_s: string, roundId: number): boolean {
    this.live.set(roundId, (this.live.get(roundId) ?? 0) + 1);
    this.maxLive = Math.max(this.maxLive, [...this.live.values()].reduce((a, b) => a + b, 0));
    return true;
  }
  stopRound(roundId: number): number {
    return this.live.delete(roundId) ? 1 : 0;
  }
}

describe('fx leak soak', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  function run(hostile: boolean): void {
    const rand = mulberry32(hostile ? 11 : 4);
    const animations = new AnimationManager(liveConfig);
    const particles = new ParticleSystem(liveConfig.particles.cap, liveConfig.particles.gravity);
    const audio = new CountingAudio();
    const game = new Game(liveConfig, new DessertManager(ALL_DESSERTS, IDS, mulberry32(8)), { animations, audio, particles });
    game.start();
    let peakAnims = 0;
    let peakParticles = 0;
    let lastPoke = -1000;

    for (let frame = 0; game.snapshot().roundsCompleted < ROUNDS; frame++) {
      expect(frame).toBeLessThan(800_000);
      game.update(16);
      // A new round starts clean: checked right after update(), before any poke adds short-lived particles.
      if (game.snapshot().state === 'PREPARING') {
        expect(animations.activeCount).toBe(0);
        if (frame - lastPoke > 60) expect(particles.count).toBe(0); // a poke's particles live 600 ms by design
        expect(audio.live.size).toBeLessThanOrEqual(1);
      }
      if (hostile) {
        if (rand() < 0.01) game.debugAddProgress([NaN, 1e12, 9, -3][Math.floor(rand() * 4)] as number);
        if (rand() < 0.01) game.debugCompleteStep();
        if (rand() < 0.02) {
          game.poke(rand() * 1000, rand() * 600);
          lastPoke = frame;
        }
      }
      peakAnims = Math.max(peakAnims, animations.activeCount);
      peakParticles = Math.max(peakParticles, particles.count);
      expect(animations.activeCount).toBeLessThanOrEqual(liveConfig.anim.maxActive);
      expect(particles.count).toBeLessThanOrEqual(liveConfig.particles.cap);
    }
    expect(peakAnims).toBeGreaterThan(0);
    expect(peakParticles).toBeGreaterThan(0);
  }

  it(`${ROUNDS} rounds: every round ends with zero animations, voices and particles left`, () => run(false));
  it(`${ROUNDS} rounds with hostile injections and pokes`, () => run(true));
});
