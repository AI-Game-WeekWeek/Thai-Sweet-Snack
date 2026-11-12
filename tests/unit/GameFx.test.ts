import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { liveConfig, type GameConfig } from '../../src/config/gameConfig';
import { AnimationManager } from '../../src/anim/AnimationManager';
import { ParticleSystem } from '../../src/anim/ParticleSystem';
import { Game, type AnimationsLike, type AudioLike } from '../../src/Game';
import { ALL_DESSERTS } from '../../src/dessert/data';
import { DessertManager } from '../../src/dessert/DessertManager';

const IDS = ALL_DESSERTS.map((d) => d.id);

class FakeAudio implements AudioLike {
  plays: { sound: string; roundId: number }[] = [];
  stops: number[] = [];
  play(sound: string, roundId: number): boolean {
    this.plays.push({ sound, roundId });
    return true;
  }
  stopRound(roundId: number): number {
    this.stops.push(roundId);
    return 0;
  }
}

function mk(config: GameConfig = liveConfig, animations?: AnimationsLike) {
  const audio = new FakeAudio();
  const anims = animations ?? new AnimationManager(config);
  const particles = new ParticleSystem(config.particles.cap, config.particles.gravity);
  const game = new Game(config, new DessertManager(ALL_DESSERTS, IDS, () => 0.4), { animations: anims, audio, particles });
  return { game, audio, anims, particles };
}
function runUntil(g: Game, pred: () => boolean, limit = 200_000): void {
  for (let i = 0; i < limit && !pred(); i++) g.update(16);
  expect(pred()).toBe(true);
}

describe('Game with fx', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('step start plays the step animation and its sound', () => {
    const { game, audio, anims } = mk();
    game.start();
    runUntil(game, () => game.snapshot().state === 'COOKING');
    const def = ALL_DESSERTS.find((d) => d.nameTh === game.snapshot().dessertNameTh)!;
    expect(audio.plays[0]).toEqual({ sound: def.steps[0]!.sound, roundId: 1 });
    expect(anims.activeCount).toBeGreaterThanOrEqual(1);
    expect(game.renderView().stepKind).toBe(def.steps[0]!.anim);
  });

  it('round cleanup cancels animations, stops voices and clears particles', () => {
    const { game, audio, anims, particles } = mk();
    game.start();
    runUntil(game, () => game.snapshot().roundId === 2 && game.snapshot().state === 'PREPARING');
    expect(audio.stops).toContain(1);
    expect(anims.activeCount).toBe(0);
    expect(particles.count).toBe(0);
    expect(game.renderView().stepKind).toBeNull();
  });

  it('completion waits for the final step animation', () => {
    const slow: GameConfig = { ...liveConfig, anim: { ...liveConfig.anim, stepAnimMaxMs: 5000 } };
    const { game } = mk(slow);
    game.start();
    runUntil(game, () => game.snapshot().state === 'COOKING');
    game.debugAddProgress(1e12);
    expect(game.snapshot().state).toBe('COOKING'); // progress is 100 but the last animation is still playing
    expect(game.snapshot().progress).toBe(100);
    runUntil(game, () => game.snapshot().state === 'PRESENTING');
    expect(game.snapshot().roundId).toBe(1);
  });

  it('an animation that never finishes cannot hang the round (global watchdog)', () => {
    const stuck: AnimationsLike = {
      play: () => 1,
      isActive: () => true,
      update: () => {},
      cancelRound: () => 0,
      get activeCount() {
        return 1;
      },
    };
    const cfg: GameConfig = { ...liveConfig, maxMs: { ...liveConfig.maxMs, cooking: 4000 } };
    const { game } = mk(cfg, stuck);
    game.start();
    runUntil(game, () => game.snapshot().state === 'COOKING');
    game.debugAddProgress(1e12);
    runUntil(game, () => game.snapshot().state === 'PRESENTING');
    runUntil(game, () => game.snapshot().roundId === 2);
  });

  it('PRESENTING plays the presentation sound and animation', () => {
    const { game, audio } = mk();
    game.start();
    runUntil(game, () => game.snapshot().state === 'PRESENTING');
    expect(audio.plays.some((p) => p.sound === 'pop')).toBe(true);
    expect(game.renderView().presentT).not.toBeNull();
  });

  it('a stale animation completion from an old round cannot complete the next round', () => {
    const { game } = mk();
    game.start();
    runUntil(game, () => game.snapshot().roundId === 2 && game.snapshot().state === 'COOKING');
    expect(game.snapshot().progress).toBeLessThan(100);
    expect(game.snapshot().state).toBe('COOKING');
  });

  it('poke adds particles and a wobble that decays', () => {
    const { game, particles } = mk();
    game.start();
    runUntil(game, () => game.snapshot().state === 'COOKING');
    game.poke(500, 380);
    expect(particles.count).toBeGreaterThan(0);
    expect(game.renderView().wobble).toBeGreaterThan(0);
    for (let i = 0; i < 200; i++) game.update(16);
    expect(game.renderView().wobble).toBeLessThan(0.05);
  });

  it('invalid poke coordinates are ignored', () => {
    const { game, particles } = mk();
    game.start();
    game.poke(NaN, 10);
    expect(particles.count).toBe(0);
  });
});
