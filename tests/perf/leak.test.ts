import v8 from 'node:v8';
import vm from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { liveConfig, voteConfig } from '../../src/config/gameConfig';
import { HeartMeter } from '../../src/cooking/HeartMeter';
import { VoteManager } from '../../src/vote/VoteManager';
import { AnimationManager } from '../../src/anim/AnimationManager';
import { ParticleSystem } from '../../src/anim/ParticleSystem';
import { Game, type AudioLike } from '../../src/Game';
import { ALL_DESSERTS } from '../../src/dessert/data';
import { DessertManager } from '../../src/dessert/DessertManager';
import { ProgressionManager } from '../../src/reward/ProgressionManager';
import { RewardManager } from '../../src/reward/RewardManager';
import { SaveSystem, type StorageLike } from '../../src/save/SaveSystem';
import { MockEventSource } from '../../src/tiktok/MockEventSource';
import { TikTokEventManager } from '../../src/tiktok/TikTokEventManager';

v8.setFlagsFromString('--expose-gc');
const gc = vm.runInNewContext('gc') as () => void;

const ROUNDS = 600;
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
class Mem implements StorageLike {
  d = new Map<string, string>();
  getItem(k: string) { return this.d.get(k) ?? null; }
  setItem(k: string, v: string) { this.d.set(k, v); }
  removeItem(k: string) { this.d.delete(k); }
}
class CountingAudio implements AudioLike {
  live = new Map<number, number>();
  play(_s: string, r: number) { this.live.set(r, (this.live.get(r) ?? 0) + 1); return true; }
  stopRound(r: number) { return this.live.delete(r) ? 1 : 0; }
}

describe('long-run memory and CPU', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it(`${ROUNDS} rounds with every subsystem active: bounded heap, bounded registries, cheap frames`, () => {
    const animations = new AnimationManager(liveConfig);
    const particles = new ParticleSystem(liveConfig.particles.cap, liveConfig.particles.gravity);
    const audio = new CountingAudio();
    const events = new TikTokEventManager(liveConfig);
    const save = new SaveSystem(liveConfig, new Mem(), DEFAULT_IDS, ALL_IDS);
    const rewards = new RewardManager(liveConfig, save.load());
    const game = new Game(liveConfig, new DessertManager(ALL_DESSERTS, rewards.profile.unlocked, mulberry32(3)), { animations, audio, particles }, events, rewards, {
      progression: new ProgressionManager(ALL_DESSERTS, rewards),
      save,
    });
    const rand = mulberry32(17);
    const mock = new MockEventSource(mulberry32(4), (e) => game.ingestEvent(e));
    mock.steady(150, 1e12);
    game.start();

    const heap: number[] = [];
    let frames = 0;
    let busyMs = 0;
    let peakAnims = 0;
    let peakVoiceRounds = 0;
    let nextSample = 100;
    while (game.snapshot().roundsCompleted < ROUNDS) {
      const t0 = performance.now();
      mock.tick(16, game.nowMs);
      if (rand() < 0.002) mock.burst('like', 1500, game.nowMs);
      if (rand() < 0.01) game.poke(rand() * 1000, rand() * 600);
      game.update(16);
      busyMs += performance.now() - t0;
      frames++;
      peakAnims = Math.max(peakAnims, animations.activeCount);
      peakVoiceRounds = Math.max(peakVoiceRounds, audio.live.size);
      expect(events.queueLength).toBeLessThanOrEqual(liveConfig.events.queueMax);
      expect(particles.count).toBeLessThanOrEqual(liveConfig.particles.cap);
      if (game.snapshot().roundsCompleted >= nextSample) {
        gc();
        heap.push(process.memoryUsage().heapUsed);
        nextSample += 100;
      }
    }

    expect(peakAnims).toBeLessThanOrEqual(liveConfig.anim.maxActive);
    expect(peakVoiceRounds).toBeLessThanOrEqual(2); // at most the finishing and the starting round overlap
    expect(heap.length).toBeGreaterThanOrEqual(5);
    const growthMb = (heap[heap.length - 1]! - heap[0]!) / 1024 / 1024;
    console.log(`[leak] heap MB per 100 rounds: ${heap.map((h) => (h / 1048576).toFixed(1)).join(', ')} | growth ${growthMb.toFixed(2)} MB | avg frame ${(busyMs / frames).toFixed(4)} ms over ${frames} frames`);
    expect(growthMb).toBeLessThan(8); // 500 rounds should not retain anything meaningful
    expect(busyMs / frames).toBeLessThan(1); // a 60 fps frame has ~16 ms; the simulation must stay far below that
    expect(rewards.profile.rounds).toBe(ROUNDS);
  });

  it('menu-vote mode: 400 rounds with vote spam keep the heap flat and frames cheap', () => {
    const cfg = voteConfig;
    const animations = new AnimationManager(cfg);
    const particles = new ParticleSystem(cfg.particles.cap, cfg.particles.gravity);
    const audio = new CountingAudio();
    const events = new TikTokEventManager(cfg);
    const save = new SaveSystem(cfg, new Mem(), DEFAULT_IDS, ALL_IDS);
    const rewards = new RewardManager(cfg, save.load());
    const vote = { manager: new VoteManager({ maxVoters: cfg.vote.maxVoters, anonVotesPerSec: cfg.vote.anonVotesPerSec }), meter: new HeartMeter({ decayPerSec: cfg.vote.heartDecayPerSec, maxBoost: cfg.vote.maxBoost }) };
    const game = new Game(cfg, new DessertManager(ALL_DESSERTS, rewards.profile.unlocked, mulberry32(3)), { animations, audio, particles }, events, rewards, { progression: new ProgressionManager(ALL_DESSERTS, rewards), save }, vote);
    const rand = mulberry32(23);
    const mock = new MockEventSource(mulberry32(4), (e) => game.ingestEvent(e), { comments: true });
    mock.steady(150, 1e12);
    game.start();

    const heap: number[] = [];
    let frames = 0;
    let busyMs = 0;
    let nextSample = 100;
    const TARGET = 400;
    while (game.snapshot().roundsCompleted < TARGET) {
      const t0 = performance.now();
      mock.tick(16, game.nowMs);
      if (rand() < 0.01) mock.burst('comment', 500, game.nowMs);
      if (rand() < 0.002) mock.burst('like', 1500, game.nowMs);
      game.update(16);
      busyMs += performance.now() - t0;
      frames++;
      expect(events.queueLength).toBeLessThanOrEqual(cfg.events.queueMax);
      if (game.snapshot().roundsCompleted >= nextSample) {
        gc();
        heap.push(process.memoryUsage().heapUsed);
        nextSample += 100;
      }
    }
    const growthMb = (heap[heap.length - 1]! - heap[0]!) / 1024 / 1024;
    console.log(`[leak/vote] heap MB per 100 rounds: ${heap.map((h) => (h / 1048576).toFixed(1)).join(', ')} | growth ${growthMb.toFixed(2)} MB | avg frame ${(busyMs / frames).toFixed(4)} ms over ${frames} frames`);
    expect(growthMb).toBeLessThan(8);
    expect(busyMs / frames).toBeLessThan(1);
    expect(audio.live.size).toBeLessThanOrEqual(2);
    expect(animations.activeCount).toBeLessThanOrEqual(cfg.anim.maxActive);
  });
});
