import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { liveConfig } from '../../src/config/gameConfig';
import { Game } from '../../src/Game';
import { TRANSITIONS } from '../../src/core/StateMachine';
import { ALL_DESSERTS } from '../../src/dessert/data';
import { DessertManager } from '../../src/dessert/DessertManager';
import { MockEventSource } from '../../src/tiktok/MockEventSource';
import { TikTokEventManager } from '../../src/tiktok/TikTokEventManager';
import type { LiveEvent } from '../../src/tiktok/types';

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

describe('event chaos soak', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it(`${ROUNDS} rounds under steady, burst, duplicate, delayed, out-of-order and malformed events with connection flips`, () => {
    const rand = mulberry32(2024);
    const events = new TikTokEventManager(liveConfig);
    const game = new Game(liveConfig, new DessertManager(ALL_DESSERTS, IDS, mulberry32(5)), undefined, events);
    const mock = new MockEventSource(mulberry32(6), (e) => game.ingestEvent(e));
    mock.steady(200, 1e9);
    game.start();

    let prev = game.snapshot();
    let nonCookingGain = 0;
    let bursts = 0;

    for (let frame = 0; game.snapshot().roundsCompleted < ROUNDS; frame++) {
      expect(frame).toBeLessThan(800_000);
      mock.tick(16, game.nowMs);

      const r = rand();
      if (r < 0.004) { mock.burst('like', 2000, game.nowMs); bursts++; }
      else if (r < 0.008) mock.duplicates({ id: `dup${frame}`, type: 'follow', count: 1, tsMs: game.nowMs }, 200);
      else if (r < 0.012) mock.delayed({ id: `late${frame}`, type: 'orangeHeart', count: 1, tsMs: game.nowMs }, 3000);
      else if (r < 0.016) mock.outOfOrder(Array.from({ length: 30 }, (_, i): LiveEvent => ({ id: `ooo${frame}-${i}`, type: 'like', count: 3, tsMs: game.nowMs - i * 50 })));
      else if (r < 0.02) for (const junk of [null, {}, { id: 'x' }, { id: 'y', type: 'like', count: NaN, tsMs: 1 }, 'str', 42]) game.ingestEvent(junk);
      else if (r < 0.024) mock.burst('gift', 3, game.nowMs);
      if (rand() < 0.002) events.setConnection(['connected', 'reconnecting', 'offline'][Math.floor(rand() * 3)] as 'connected');

      game.update(16);
      const s = game.snapshot();

      expect(s.progress).toBeGreaterThanOrEqual(0);
      expect(s.progress).toBeLessThanOrEqual(100);
      expect(events.queueLength).toBeLessThanOrEqual(liveConfig.events.queueMax);
      if (s.state !== prev.state) expect(TRANSITIONS[prev.state]).toContain(s.state);
      expect(s.roundId - prev.roundId === 0 || s.roundId - prev.roundId === 1).toBe(true);
      // Outside COOKING progress may only reset (new round), never grow.
      if (s.state !== 'COOKING' && s.roundId === prev.roundId && prev.state !== 'COOKING') nonCookingGain += Math.max(0, s.progress - prev.progress);
      prev = s;
    }
    expect(bursts).toBeGreaterThan(0);
    expect(nonCookingGain).toBe(0);
    expect(game.snapshot().counters.likes).toBeGreaterThan(0);
  });
});
