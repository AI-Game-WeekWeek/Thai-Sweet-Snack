import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultConfig } from '../../src/config/gameConfig';
import { MockEventSource } from '../../src/tiktok/MockEventSource';
import { parseLiveEvent } from '../../src/tiktok/parseLiveEvent';
import { TikTokEventManager } from '../../src/tiktok/TikTokEventManager';
import type { LiveEvent } from '../../src/tiktok/types';

const NOW = 100_000;
let n = 0;
const cm = (text: unknown, over: Record<string, unknown> = {}) => ({ id: `c${++n}`, type: 'comment', tsMs: NOW, text, userId: 'u1', ...over });
const voting = { roundId: 1, startedAtMs: NOW - 1000, cooking: false, voting: true };

describe('comment events', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it.each([['1', 1], ['2', 2], ['3', 3], [' 3 ', 3], ['#2', 2], ['\n1\n', 1]])('"%s" parses to vote %i', (text, vote) => {
    const e = parseLiveEvent(cm(text), 1000) as LiveEvent;
    expect(e.type).toBe('comment');
    expect(e.vote).toBe(vote);
    expect(e.count).toBe(1);
  });

  it.each([['0'], ['4'], ['12'], ['one'], ['ขนมครก'], ['1 2'], [''], ['   '], ['9'.repeat(300)], ['1​'], ['๑']])('"%s" is not a vote', (text) => {
    expect(parseLiveEvent(cm(text), 1000)).toBeNull();
  });

  it('accepts an already-parsed vote (what the bridge relays) and rejects a bad one', () => {
    const e = parseLiveEvent({ id: 'p1', type: 'comment', count: 1, tsMs: NOW, vote: 3, userId: 'u9' }, 1000) as LiveEvent;
    expect(e.vote).toBe(3);
    expect(e.userId).toBe('u9');
    for (const v of [0, 4, 1.5, NaN, '2', null]) expect(parseLiveEvent({ id: 'p2', type: 'comment', tsMs: NOW, vote: v }, 1000), String(v)).toBeNull();
  });

  it('a parsed vote survives a second parse (bridge -> game round trip)', () => {
    const once = parseLiveEvent(cm('2'), 1000) as LiveEvent;
    const twice = parseLiveEvent(JSON.parse(JSON.stringify(once)), 1000) as LiveEvent;
    expect(twice).toEqual(once);
  });

  it('rejects a non-string text or a missing one', () => {
    for (const t of [undefined, null, 2, {}, [], true]) expect(parseLiveEvent(cm(t), 1000)).toBeNull();
  });

  it('never keeps the comment text or the nickname, only the vote and an opaque user key', () => {
    const e = parseLiveEvent(cm('2', { user: 'Somchai', text: '2' }), 1000) as unknown as Record<string, unknown>;
    expect(e.text).toBeUndefined();
    expect(e.user).toBeUndefined();
    expect(JSON.stringify(e)).not.toContain('Somchai');
    expect(e.userId).toBe('u1');
  });

  it('truncates an over-long userId and drops a non-string one', () => {
    expect((parseLiveEvent(cm('1', { userId: 'x'.repeat(500) }), 1000) as LiveEvent).userId).toHaveLength(64);
    expect((parseLiveEvent(cm('1', { userId: 42 }), 1000) as LiveEvent).userId).toBeUndefined();
  });

  it('still needs an id and a finite timestamp', () => {
    expect(parseLiveEvent(cm('1', { id: '' }), 1000)).toBeNull();
    expect(parseLiveEvent(cm('1', { tsMs: NaN }), 1000)).toBeNull();
  });

  it('manager: votes are collected only during the vote window', () => {
    const m = new TikTokEventManager(defaultConfig);
    m.ingest(cm('2', { userId: 'a' }));
    m.ingest(cm('3', { userId: 'b' }));
    const fx = m.drain(voting, NOW);
    expect(fx.votes).toEqual([{ vote: 2, userKey: 'a' }, { vote: 3, userKey: 'b' }]);

    m.ingest(cm('1'));
    expect(m.drain({ ...voting, voting: false, cooking: true }, NOW).votes).toEqual([]);
    expect(m.queueLength).toBe(0);
  });

  it('manager: stale comments (before the window) are dropped; comments never touch the counters or progress', () => {
    const m = new TikTokEventManager(defaultConfig);
    m.ingest(cm('1', { tsMs: NOW - 60_000 }), NOW); // far older than maxSourceLagMs -> clamped, still before the window start
    m.ingest(cm('2'));
    const fx = m.drain({ ...voting, startedAtMs: NOW - 500 }, NOW);
    expect(fx.votes.map((v) => v.vote)).toEqual([2]);
    expect(fx.progressAdd).toBe(0);
    expect(m.totals).toEqual({ likes: 0, follows: 0, hearts: 0, gifts: 0, shares: 0 });
  });

  it('manager: duplicate comment ids count once', () => {
    const m = new TikTokEventManager(defaultConfig);
    const e = cm('1');
    expect(m.ingest(e)).toBe('queued');
    expect(m.ingest(e)).toBe('duplicate');
    expect(m.drain(voting, NOW).votes).toHaveLength(1);
  });

  it('manager: effects report the likes and follows applied while cooking', () => {
    const m = new TikTokEventManager(defaultConfig);
    m.ingest({ id: 'l1', type: 'like', count: 40, tsMs: NOW });
    m.ingest({ id: 'f1', type: 'follow', count: 1, tsMs: NOW });
    const cooking = { roundId: 1, startedAtMs: NOW - 10, cooking: true };
    const fx = m.drain(cooking, NOW);
    expect(fx.likes).toBe(40);
    expect(fx.follows).toBe(1);
    m.ingest({ id: 'l2', type: 'like', count: 40, tsMs: NOW });
    expect(m.drain({ ...cooking, cooking: false }, NOW).likes).toBe(0); // not cooking: ignored
  });

  it('a flood of 100 000 comments leaves the queue bounded', () => {
    const m = new TikTokEventManager(defaultConfig);
    for (let i = 0; i < 100_000; i++) {
      m.ingest(cm('1', { userId: `u${i}` }));
      if (m.queueLength > defaultConfig.events.queueMax) throw new Error('queue grew');
    }
    expect(m.drain(voting, NOW).votes.length).toBeLessThanOrEqual(defaultConfig.events.queueMax);
  });

  it('mock source can emit comments (opt in) and they all parse as votes; off by default', () => {
    const rng = (() => { let s = 5; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); })();
    const on: unknown[] = [];
    const a = new MockEventSource(rng, (e) => on.push(e), { comments: true });
    a.steady(200, 2000);
    for (let t = 0; t < 2000; t += 16) a.tick(16, NOW);
    const comments = on.filter((e) => (e as { type: string }).type === 'comment');
    expect(comments.length).toBeGreaterThan(20);
    for (const c of comments) expect(parseLiveEvent(c, 1000)?.vote).toBeGreaterThanOrEqual(1);

    const off: unknown[] = [];
    const b = new MockEventSource(rng, (e) => off.push(e));
    b.steady(200, 2000);
    for (let t = 0; t < 2000; t += 16) b.tick(16, NOW);
    expect(off.some((e) => (e as { type: string }).type === 'comment')).toBe(false);
  });

  it('no event type keeps a nickname: `user` is dropped everywhere', () => {
    const like = parseLiveEvent({ id: 'u1', type: 'like', count: 1, tsMs: NOW, user: 'Somchai99' }, 1000) as unknown as Record<string, unknown>;
    expect(like.user).toBeUndefined();
    expect(JSON.stringify(like)).not.toContain('Somchai99');
  });

  it('manager reports orange hearts and small gifts as "hearts" while cooking (not big gifts, not outside cooking)', () => {
    const m = new TikTokEventManager(defaultConfig);
    const cooking = { roundId: 1, startedAtMs: NOW - 10, cooking: true };
    m.ingest({ id: 'h1', type: 'orangeHeart', count: 5, tsMs: NOW });
    m.ingest({ id: 'g1', type: 'gift', count: 1, giftCoins: 1, tsMs: NOW });
    m.ingest({ id: 'g2', type: 'gift', count: 1, giftCoins: 999, tsMs: NOW });
    const fx = m.drain(cooking, NOW);
    expect(fx.hearts).toBe(6);
    expect(fx.completeStep).toBe(true);
    m.ingest({ id: 'h2', type: 'orangeHeart', count: 5, tsMs: NOW });
    expect(m.drain({ ...cooking, cooking: false }, NOW).hearts).toBe(0);
  });
});
