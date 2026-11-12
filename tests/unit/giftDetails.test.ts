import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultConfig } from '../../src/config/gameConfig';
import { ALL_DESSERTS } from '../../src/dessert/data';
import { DessertManager } from '../../src/dessert/DessertManager';
import { RewardManager } from '../../src/reward/RewardManager';
import { defaultProfile } from '../../src/reward/types';
import { MockEventSource } from '../../src/tiktok/MockEventSource';
import { parseLiveEvent } from '../../src/tiktok/parseLiveEvent';
import { TikTokEventManager } from '../../src/tiktok/TikTokEventManager';
import type { LiveEvent } from '../../src/tiktok/types';

const NOW = 50_000;
let n = 0;
const gift = (over: Record<string, unknown> = {}) => ({ id: `g${++n}`, type: 'gift', count: 1, giftCoins: 5, tsMs: NOW, ...over });
const round = { roundId: 1, startedAtMs: NOW - 100, cooking: false, acceptsGifts: true };

describe('gift details (viewer name and picture)', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it('gifts and roses keep a cleaned displayName and an https avatarUrl', () => {
    for (const type of ['gift', 'rose']) {
      const e = parseLiveEvent(gift({ type, displayName: '  มะลิ\u0000  ', avatarUrl: 'https://cdn.example.com/a.jpg' }), 1000) as LiveEvent;
      expect(e.displayName).toBe('มะลิ');
      expect(e.avatarUrl).toBe('https://cdn.example.com/a.jpg');
    }
  });

  it('truncates long names by characters and drops bad picture urls without rejecting the event', () => {
    const e = parseLiveEvent(gift({ displayName: 'ก'.repeat(100), avatarUrl: 'http://x.com/a.jpg' }), 1000) as LiveEvent;
    expect(e.displayName).toHaveLength(32); // parser keeps a generous bound; the queue cuts to the configured length
    expect(e.avatarUrl).toBeUndefined();
    for (const bad of ['javascript:alert(1)', 'data:image/png;base64,AA', 'https://' + 'a'.repeat(600), 42, null, '']) {
      const g = parseLiveEvent(gift({ avatarUrl: bad }), 1000) as LiveEvent;
      expect(g, String(bad)).not.toBeNull();
      expect(g.avatarUrl).toBeUndefined();
    }
    expect((parseLiveEvent(gift({ displayName: 42 }), 1000) as LiveEvent).displayName).toBeUndefined();
  });

  it('no other event type keeps a name or a picture', () => {
    for (const type of ['like', 'follow', 'orangeHeart', 'share']) {
      const e = parseLiveEvent({ id: `o${++n}`, type, count: 1, tsMs: NOW, displayName: 'Somchai', avatarUrl: 'https://cdn.example.com/a.jpg', user: 'Somchai' }, 1000) as unknown as Record<string, unknown>;
      expect(e.displayName, type).toBeUndefined();
      expect(e.avatarUrl, type).toBeUndefined();
      expect(JSON.stringify(e), type).not.toContain('Somchai');
    }
    const c = parseLiveEvent({ id: 'c1', type: 'comment', text: '2', tsMs: NOW, displayName: 'Somchai' }, 1000) as unknown as Record<string, unknown>;
    expect(c.displayName).toBeUndefined();
  });

  it('manager reports every gift and rose when gifts are accepted, in any state and even when old', () => {
    const m = new TikTokEventManager(defaultConfig);
    m.ingest(gift({ giftCoins: 30, displayName: 'A' }));
    m.ingest(gift({ type: 'rose', displayName: 'B', giftCoins: undefined }));
    m.ingest(gift({ giftCoins: 7, tsMs: -9e9 }));
    const fx = m.drain(round, NOW);
    expect(fx.gifts.map((g) => g.coins)).toEqual([30, 1, 7]);
    expect(fx.gifts.map((g) => g.displayName)).toEqual(['A', 'B', undefined]);
  });

  it('without acceptsGifts (classic and vote modes) no gift details are reported', () => {
    const m = new TikTokEventManager(defaultConfig);
    m.ingest(gift());
    expect(m.drain({ ...round, acceptsGifts: false }, NOW).gifts).toEqual([]);
  });

  it('a flood of gifts is bounded per drain; the rest wait for the next drain (see the deferral test)', () => {
    const m = new TikTokEventManager({ ...defaultConfig, events: { ...defaultConfig.events, queueMax: 1000 } });
    for (let i = 0; i < 100; i++) m.ingest(gift());
    const fx = m.drain(round, NOW);
    expect(fx.gifts).toHaveLength(defaultConfig.cafe.maxGiftsPerDrain);
    expect(m.queueLength).toBe(100 - defaultConfig.cafe.maxGiftsPerDrain); // deferred, not dropped
    expect(m.totals.gifts).toBe(defaultConfig.cafe.maxGiftsPerDrain); // counted when handled
  });

  it('a gift with an unknown value counts as 1 coin; invalid values are rejected at parse', () => {
    const m = new TikTokEventManager(defaultConfig);
    m.ingest(gift({ giftCoins: undefined }));
    expect(m.drain(round, NOW).gifts[0]?.coins).toBe(1);
    expect(parseLiveEvent(gift({ giftCoins: -3 }), 1000)).toBeNull();
    expect(parseLiveEvent(gift({ giftCoins: NaN }), 1000)).toBeNull();
  });

  it('DessertManager exposes the unlocked ids', () => {
    const m = new DessertManager(ALL_DESSERTS, ['khao-tom-mat', 'bua-loy', 'nope'], () => 0.5);
    expect([...m.unlockedIds].sort()).toEqual(['bua-loy', 'khao-tom-mat']);
    m.setUnlocked(['thong-yod']);
    expect(m.unlockedIds).toEqual(['thong-yod']);
  });

  it('RewardManager.addCoins adds valid amounts only', () => {
    const r = new RewardManager(defaultConfig, defaultProfile(['khao-tom-mat']));
    expect(r.addCoins(25)).toBe(true);
    expect(r.profile.coins).toBe(25);
    for (const bad of [NaN, Infinity, -1, 0, 2e6]) expect(r.addCoins(bad), String(bad)).toBe(false);
    expect(r.profile.coins).toBe(25);
  });

  it('mock source can emit named gifts with coin values (cafe option) that all parse', () => {
    const rng = (() => { let s = 9; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); })();
    const out: unknown[] = [];
    const src = new MockEventSource(rng, (e) => out.push(e), { cafe: true });
    src.steady(200, 3000);
    for (let t = 0; t < 3000; t += 16) src.tick(16, NOW);
    const gifts = out.filter((e) => (e as { type: string }).type === 'gift');
    expect(gifts.length).toBeGreaterThan(20);
    const coins = new Set(gifts.map((g) => (g as { giftCoins: number }).giftCoins));
    expect(coins.size).toBeGreaterThan(3);
    for (const g of gifts) {
      const e = parseLiveEvent(g, 1000) as LiveEvent;
      expect(e).not.toBeNull();
      expect(e.displayName).toBeTruthy();
    }
    expect(out.some((e) => (e as { type: string }).type === 'comment')).toBe(false);
  });

  it('gifts beyond the per-drain cap are deferred to the next drain, never dropped or double counted', () => {
    const m = new TikTokEventManager({ ...defaultConfig, events: { ...defaultConfig.events, queueMax: 1000 } });
    for (let i = 0; i < 100; i++) m.ingest(gift({ giftCoins: i + 1 }));
    const seen: number[] = [];
    for (let d = 0; d < 10; d++) seen.push(...m.drain(round, NOW).gifts.map((g) => g.coins));
    expect(seen).toHaveLength(100);
    expect(new Set(seen).size).toBe(100);
    expect(m.totals.gifts).toBe(100);
    expect(m.queueLength).toBe(0);
  });

  it('roses survive queue overflow just like gifts (they are orders in café mode)', () => {
    const m = new TikTokEventManager({ ...defaultConfig, events: { ...defaultConfig.events, queueMax: 10 } });
    m.ingest({ id: 'r1', type: 'rose', count: 1, tsMs: NOW });
    for (let i = 0; i < 50; i++) m.ingest({ id: `f${i}`, type: 'follow', count: 1, tsMs: NOW });
    expect(m.drain(round, NOW).gifts).toHaveLength(1);
  });

  it('events without a count (as in the documented examples) are accepted and count as 1', () => {
    for (const type of ['gift', 'rose', 'follow', 'share', 'orangeHeart', 'like']) {
      const e = parseLiveEvent({ id: `nc${++n}`, type, tsMs: NOW }, 1000) as LiveEvent;
      expect(e, type).not.toBeNull();
      expect(e.count).toBe(1);
    }
    expect(parseLiveEvent({ id: 'bad', type: 'like', count: 'x', tsMs: NOW }, 1000)).toBeNull();
    expect(parseLiveEvent({ id: 'bad2', type: 'like', count: 0, tsMs: NOW }, 1000)).toBeNull();
  });

  it('follows and orange hearts are counted for the surprise events in every state, even when old, when gifts are accepted', () => {
    const m = new TikTokEventManager(defaultConfig);
    for (let i = 0; i < 10_000; i++) {
      m.ingest({ id: `f${i}`, type: 'follow', count: 1, tsMs: i % 2 ? NOW : -9e9 });
      if (m.queueLength >= defaultConfig.events.queueMax) m.drain(round, NOW); // keep the queue below its cap
    }
    const m2 = new TikTokEventManager(defaultConfig);
    m2.ingest({ id: 'a', type: 'follow', count: 1, tsMs: NOW });
    m2.ingest({ id: 'b', type: 'follow', count: 1, tsMs: NOW });
    m2.ingest({ id: 'c', type: 'orangeHeart', count: 5, tsMs: NOW });
    const fx = m2.drain({ ...round, cooking: false }, NOW);
    expect(fx.surprises).toEqual({ follows: 2, orangeHearts: 1 }); // one orange-heart event = one VIP trigger, whatever its count
    const cooking = m2.drain({ ...round, cooking: true }, NOW);
    expect(cooking.surprises).toEqual({ follows: 0, orangeHearts: 0 });
  });

  it('without acceptsGifts (classic and vote modes) no surprise counts are reported', () => {
    const m = new TikTokEventManager(defaultConfig);
    m.ingest({ id: 'a', type: 'follow', count: 1, tsMs: NOW });
    m.ingest({ id: 'b', type: 'orangeHeart', count: 1, tsMs: NOW });
    expect(m.drain({ ...round, acceptsGifts: false }, NOW).surprises).toEqual({ follows: 0, orangeHearts: 0 });
  });

  it('follow and orange-heart events carry no names even if a provider sends them', () => {
    for (const type of ['follow', 'orangeHeart']) {
      const e = parseLiveEvent({ id: `nm${++n}`, type, count: 1, tsMs: NOW, displayName: 'Somchai', avatarUrl: 'https://x.example/a.jpg', user: 'Somchai' }, 1000) as unknown as Record<string, unknown>;
      expect(e.displayName).toBeUndefined();
      expect(e.avatarUrl).toBeUndefined();
    }
  });
});
