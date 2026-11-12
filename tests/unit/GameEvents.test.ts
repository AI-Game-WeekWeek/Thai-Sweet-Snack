import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { liveConfig } from '../../src/config/gameConfig';
import { ParticleSystem } from '../../src/anim/ParticleSystem';
import { Game, type GameFx } from '../../src/Game';
import { ALL_DESSERTS } from '../../src/dessert/data';
import { DessertManager } from '../../src/dessert/DessertManager';
import { TikTokEventManager } from '../../src/tiktok/TikTokEventManager';

const IDS = ALL_DESSERTS.map((d) => d.id);
const E = liveConfig.events;
let n = 0;
const ev = (type: string, over: Record<string, unknown> = {}, game?: Game) => ({ id: `g${++n}`, type, count: 1, tsMs: game?.nowMs ?? 0, ...over });

function mk(events = new TikTokEventManager(liveConfig), withFx = false) {
  const particles = new ParticleSystem(liveConfig.particles.cap, liveConfig.particles.gravity);
  const fx: GameFx | undefined = withFx
    ? { animations: { play: () => 1, isActive: () => false, update() {}, cancelRound: () => 0, activeCount: 0 }, audio: { play: () => true, stopRound: () => 0 }, particles }
    : undefined;
  const game = new Game(liveConfig, new DessertManager(ALL_DESSERTS, IDS, () => 0.4), fx, events);
  return { game, events, particles };
}
function runUntil(g: Game, pred: () => boolean, limit = 200_000): void {
  for (let i = 0; i < limit && !pred(); i++) g.update(16);
  expect(pred()).toBe(true);
}
function cook(g: Game): void {
  g.start();
  runUntil(g, () => g.snapshot().state === 'COOKING');
  g.update(16);
}

describe('Game with live events', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it('likes during COOKING raise progress by the configured amount', () => {
    const { game } = mk();
    cook(game);
    const before = game.snapshot().progress;
    expect(game.ingestEvent(ev('like', { count: 100 }, game))).toBe('queued');
    game.update(16);
    expect(game.snapshot().progress - before).toBeGreaterThan(100 * E.likeProgress - 0.5);
    expect(game.snapshot().counters.likes).toBe(100);
  });

  it('events sent while PRESENTING never raise the next round progress', () => {
    const { game } = mk();
    game.start();
    runUntil(game, () => game.snapshot().state === 'PRESENTING');
    for (let i = 0; i < 50; i++) game.ingestEvent(ev('follow', {}, game));
    runUntil(game, () => game.snapshot().roundId === 2 && game.snapshot().state === 'COOKING');
    game.update(16);
    expect(game.snapshot().progress).toBeLessThan(1);
  });

  it('events with a timestamp before the round start are ignored', () => {
    const { game } = mk();
    cook(game);
    const before = game.snapshot().progress;
    game.ingestEvent(ev('follow', { tsMs: game.roundStartedAtMs - 1 }));
    game.update(16);
    expect(game.snapshot().progress - before).toBeLessThan(0.2);
  });

  it('a large gift completes the current step', () => {
    const { game } = mk();
    cook(game);
    const step0 = game.snapshot().stepNameTh;
    game.ingestEvent(ev('gift', { giftCoins: 999 }, game));
    game.update(16);
    expect(game.snapshot().stepNameTh).not.toBe(step0);
  });

  it('a flood of 10 000 like events keeps progress <= 100 and the queue bounded', () => {
    const { game, events } = mk();
    cook(game);
    for (let i = 0; i < 10_000; i++) {
      game.ingestEvent(ev('like', { count: 5 }, game));
      expect(events.queueLength).toBeLessThanOrEqual(E.queueMax);
    }
    game.update(16);
    expect(game.snapshot().progress).toBeLessThanOrEqual(100);
    expect(events.queueLength).toBe(0);
  });

  it('the same event id 1000 times is applied once', () => {
    const { game } = mk();
    cook(game);
    const before = game.snapshot().progress;
    const e = ev('follow', {}, game);
    for (let i = 0; i < 1000; i++) game.ingestEvent(e);
    game.update(16);
    const gained = game.snapshot().progress - before;
    expect(gained).toBeGreaterThan(E.followProgress - 0.05);
    expect(gained).toBeLessThan(E.followProgress + 0.3);
  });

  it('a rose plays a particle burst and wobble', () => {
    const { game, particles } = mk(undefined, true);
    cook(game);
    const before = particles.count;
    game.ingestEvent(ev('rose', {}, game));
    game.update(16);
    expect(particles.count).toBeGreaterThan(before);
    expect(game.renderView().wobble).toBeGreaterThan(0);
  });

  it('shares bank a bonus for the round and it resets next round', () => {
    const { game } = mk();
    cook(game);
    game.ingestEvent(ev('share', {}, game));
    game.update(16);
    expect(game.snapshot().bonusPct).toBe(E.shareBonusPct);
    runUntil(game, () => game.snapshot().roundId === 2);
    expect(game.snapshot().bonusPct).toBe(0);
  });

  it('a throwing event manager cannot stop the loop', () => {
    const broken = { ingest: () => 'queued', drain: () => { throw new Error('boom'); }, connection: 'offline', totals: { likes: 0, follows: 0, hearts: 0, gifts: 0, shares: 0 }, setConnection() {}, queueLength: 0 } as unknown as TikTokEventManager;
    const { game } = mk(broken);
    game.start();
    runUntil(game, () => game.snapshot().roundId === 3);
  });

  it('offline connection state does not stop the game and no events are needed', () => {
    const { game, events } = mk();
    events.setConnection('offline');
    game.start();
    runUntil(game, () => game.snapshot().roundsCompleted >= 2);
    expect(game.snapshot().connection).toBe('offline');
  });

  it('works without an event manager', () => {
    const game = new Game(liveConfig, new DessertManager(ALL_DESSERTS, IDS, () => 0.4));
    expect(game.ingestEvent({})).toBe('invalid');
    game.start();
    runUntil(game, () => game.snapshot().roundId === 2);
  });

  it('a far-future provider timestamp is applied, a far-past one cannot leak into a young round', () => {
    const { game } = mk();
    cook(game);
    const before = game.snapshot().progress;
    game.ingestEvent(ev('follow', { tsMs: game.nowMs + 86_400_000 }));
    game.update(16);
    expect(game.snapshot().progress - before).toBeGreaterThan(E.followProgress - 0.1);

    const mid = game.snapshot().progress;
    game.ingestEvent(ev('follow', { tsMs: -5_000_000 })); // provider clock far behind
    game.update(16);
    expect(game.snapshot().progress - mid).toBeLessThan(0.3); // looks old: ignored while the round is still young
  });
});
