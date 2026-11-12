import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultConfig, type GameConfig } from '../../src/config/gameConfig';
import { TikTokEventManager } from '../../src/tiktok/TikTokEventManager';
import type { LiveEvent } from '../../src/tiktok/types';

const E = defaultConfig.events;
const ROUND = { roundId: 1, startedAtMs: 1000, cooking: true };
let n = 0;
const ev = (over: Partial<LiveEvent> = {}): LiveEvent => ({ id: `e${++n}`, type: 'like', count: 1, tsMs: 2000, ...over });

function mk(over: Partial<GameConfig['events']> = {}) {
  return new TikTokEventManager({ ...defaultConfig, events: { ...E, ...over } });
}

describe('TikTokEventManager', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it('maps like/follow/heart to progress using config values', () => {
    const m = mk();
    m.ingest(ev({ type: 'like', count: 10 }));
    m.ingest(ev({ type: 'follow' }));
    m.ingest(ev({ type: 'orangeHeart' }));
    const fx = m.drain(ROUND, 3000);
    expect(fx.progressAdd).toBeCloseTo(10 * E.likeProgress + E.followProgress + E.heartProgress, 6);
    expect(fx.completeStep).toBe(false);
    expect(fx.counters).toMatchObject({ likes: 10, follows: 1, hearts: 1 });
  });

  it('10 000 likes in one tick: a single coalesced result and a bounded queue', () => {
    const m = mk();
    for (let i = 0; i < 10_000; i++) {
      m.ingest(ev({ count: 5 }));
      expect(m.queueLength).toBeLessThanOrEqual(E.queueMax);
    }
    const fx = m.drain(ROUND, 3000);
    expect(fx.progressAdd).toBeGreaterThan(0);
    expect(fx.roseEffect).toBe(false);
    expect(m.queueLength).toBe(0);
    expect(m.drain(ROUND, 3001).progressAdd).toBe(0);
  });

  it('overflow merges likes without losing their total', () => {
    const m = mk({ queueMax: 10 });
    for (let i = 0; i < 100; i++) m.ingest(ev({ count: 2 }));
    expect(m.queueLength).toBeLessThanOrEqual(10);
    const fx = m.drain(ROUND, 3000);
    expect(fx.counters.likes).toBe(200);
  });

  it('a gift never gets dropped by overflow of other events', () => {
    const m = mk({ queueMax: 5 });
    m.ingest(ev({ type: 'gift', giftCoins: 500 }));
    for (let i = 0; i < 50; i++) m.ingest(ev({ type: 'follow' }));
    expect(m.drain(ROUND, 3000).completeStep).toBe(true);
  });

  it('dedupes the same id: 1000 sends apply once', () => {
    const m = mk();
    const e = ev({ type: 'follow' });
    const results = new Set<string>();
    for (let i = 0; i < 1000; i++) results.add(m.ingest(e));
    expect(results).toEqual(new Set(['queued', 'duplicate']));
    expect(m.drain(ROUND, 3000).counters.follows).toBe(1);
  });

  it('an id evicted from the LRU may be applied again (documented bound)', () => {
    const m = mk({ dedupeCapacity: 3 });
    const first = ev();
    m.ingest(first);
    for (let i = 0; i < 5; i++) m.ingest(ev());
    expect(m.ingest(first)).toBe('queued');
  });

  it('rejects malformed input without throwing', () => {
    const m = mk();
    const bad: unknown[] = [
      null, undefined, 5, 'x', [], {},
      { ...ev(), id: '' }, { ...ev(), id: 7 }, { ...ev(), type: 'nope' },
      { ...ev(), count: 0 }, { ...ev(), count: NaN }, { ...ev(), count: -3 }, { ...ev(), count: Infinity },
      { ...ev(), count: E.maxLikeCountPerEvent + 1 }, { ...ev(), tsMs: NaN }, { ...ev(), tsMs: 'now' },
      { ...ev({ type: 'gift' }), giftCoins: -1 }, { ...ev({ type: 'gift' }), giftCoins: NaN },
    ];
    for (const b of bad) expect(m.ingest(b)).toBe('invalid');
    expect(m.queueLength).toBe(0);
  });

  it('a large gift completes the current step; a small gift is worth a heart', () => {
    const m = mk();
    m.ingest(ev({ type: 'gift', giftCoins: E.largeGiftCoins }));
    expect(m.drain(ROUND, 3000).completeStep).toBe(true);
    m.ingest(ev({ type: 'gift', giftCoins: 1 }));
    const fx = m.drain(ROUND, 9000);
    expect(fx.completeStep).toBe(false);
    expect(fx.progressAdd).toBeCloseTo(E.heartProgress, 6);
  });

  it('rose and big-gift visuals respect cooldowns while progress and counters still count', () => {
    const m = mk();
    m.ingest(ev({ type: 'rose' }));
    expect(m.drain(ROUND, 5000).roseEffect).toBe(true);
    m.ingest(ev({ type: 'rose' }));
    const second = m.drain(ROUND, 5000 + E.roseCooldownMs - 1);
    expect(second.roseEffect).toBe(false);
    expect(second.counters.gifts).toBeGreaterThanOrEqual(2);
    m.ingest(ev({ type: 'rose' }));
    expect(m.drain(ROUND, 5000 + E.roseCooldownMs + 1).roseEffect).toBe(true);

    m.ingest(ev({ type: 'gift', giftCoins: 999 }));
    expect(m.drain(ROUND, 20_000).bigGiftEffect).toBe(true);
    m.ingest(ev({ type: 'gift', giftCoins: 999 }));
    const g2 = m.drain(ROUND, 20_001);
    expect(g2.bigGiftEffect).toBe(false);
    expect(g2.completeStep).toBe(true); // the step still completes during the visual cooldown
  });

  it('events outside COOKING or older than the round start never add progress', () => {
    const m = mk();
    m.ingest(ev({ type: 'follow', tsMs: 500 }));
    expect(m.drain(ROUND, 3000).progressAdd).toBe(0); // stale timestamp
    m.ingest(ev({ type: 'follow', tsMs: 2500 }));
    const notCooking = m.drain({ ...ROUND, cooking: false }, 3000);
    expect(notCooking.progressAdd).toBe(0);
    expect(notCooking.completeStep).toBe(false);
    expect(m.queueLength).toBe(0); // discarded, not kept for the next round
    expect(m.drain(ROUND, 3001).progressAdd).toBe(0);
  });

  it('shares are counted and bank a bonus even outside COOKING', () => {
    const m = mk();
    m.ingest(ev({ type: 'share', tsMs: 500 }));
    const fx = m.drain({ ...ROUND, cooking: false }, 3000);
    expect(fx.shareBonus).toBe(E.shareBonusPct);
    expect(fx.counters.shares).toBe(1);
  });

  it('gift + follow + like in one tick are all applied once', () => {
    const m = mk();
    m.ingest(ev({ type: 'gift', giftCoins: 999 }));
    m.ingest(ev({ type: 'follow' }));
    m.ingest(ev({ type: 'like', count: 50 }));
    const fx = m.drain(ROUND, 3000);
    expect(fx.completeStep).toBe(true);
    expect(fx.progressAdd).toBeCloseTo(E.followProgress + 50 * E.likeProgress, 6);
  });

  it('connection state is display-only', () => {
    const m = mk();
    m.setConnection('offline');
    expect(m.connection).toBe('offline');
    m.ingest(ev({ type: 'follow' }));
    expect(m.drain(ROUND, 3000).progressAdd).toBeCloseTo(E.followProgress, 6);
    m.setConnection('reconnecting');
    expect(m.connection).toBe('reconnecting');
  });

  it('totals accumulate across drains', () => {
    const m = mk();
    m.ingest(ev({ count: 3 }));
    m.drain(ROUND, 3000);
    m.ingest(ev({ count: 4 }));
    m.drain(ROUND, 3100);
    expect(m.totals.likes).toBe(7);
  });

  describe('clock skew between the provider and the game', () => {
    const NOW = 1_000_000;
    const round = (startedAgoMs: number) => ({ roundId: 1, startedAtMs: NOW - startedAgoMs, cooking: true });
    const lag = E.maxSourceLagMs;

    it('a future-dated event counts as "now" and is applied', () => {
      const m = mk();
      expect(m.ingest(ev({ type: 'follow', tsMs: NOW + 3_600_000 }), NOW)).toBe('queued');
      expect(m.drain(round(1000), NOW).progressAdd).toBeCloseTo(E.followProgress, 6);
    });

    it('a provider clock far behind (or timestamps in seconds) only costs the first maxSourceLagMs of a round', () => {
      for (const ts of [NOW - 3_600_000, 1_700]) {
        const early = mk();
        early.ingest(ev({ type: 'follow', tsMs: ts }), NOW);
        expect(early.drain(round(lag - 500), NOW).progressAdd).toBe(0);
        const later = mk();
        later.ingest(ev({ type: 'follow', tsMs: ts }), NOW);
        expect(later.drain(round(lag + 500), NOW).progressAdd).toBeCloseTo(E.followProgress, 6);
      }
    });

    it('a genuinely late event from the previous round is still dropped', () => {
      const m = mk();
      m.ingest(ev({ type: 'follow', tsMs: NOW - 5000 }), NOW);
      expect(m.drain(round(1000), NOW).progressAdd).toBe(0);
    });

    it('an event stamped inside the current round is applied', () => {
      const m = mk();
      m.ingest(ev({ type: 'follow', tsMs: NOW - 200 }), NOW);
      expect(m.drain(round(1000), NOW).progressAdd).toBeCloseTo(E.followProgress, 6);
    });

    it('without a receive time the provider timestamp is used as is', () => {
      const m = mk();
      m.ingest(ev({ type: 'follow', tsMs: 500 }));
      expect(m.drain(ROUND, 3000).progressAdd).toBe(0);
    });
  });
});
