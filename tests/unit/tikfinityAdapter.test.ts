import { describe, expect, it } from 'vitest';
import { TikFinityAdapter } from '../../src/tiktok/adapters/tikfinity';
import { parseLiveEvent } from '../../src/tiktok/parseLiveEvent';

const mk = (t = 1000) => { let now = t; const a = new TikFinityAdapter({ now: () => now, streakIdleMs: 4000 }); return { a, tick: (ms: number) => { now += ms; return now; } }; };
const valid = (raw: unknown[]) => raw.map((r) => parseLiveEvent(r, 1000));

describe('TikFinity adapter', () => {
  it('maps the common listener events to game events that pass the game validator', () => {
    const { a } = mk();
    const out = [
      ...a.convert({ event: 'like', data: { likeCount: 15, totalLikeCount: 900, nickname: 'x' } }),
      ...a.convert({ event: 'follow', data: { nickname: 'secret name' } }),
      ...a.convert({ event: 'share', data: {} }),
      ...a.convert({ event: 'subscribe', data: {} }),
      ...a.convert({ event: 'chat', data: { comment: '2', userId: 'u1', nickname: 'who' } }),
      ...a.convert({ event: 'gift', data: { giftName: 'Rose', diamondCount: 1, repeatCount: 1, giftType: 2, nickname: 'พี่ต้น', profilePictureUrl: 'https://p/x.jpg' } }),
      ...a.convert({ event: 'gift', data: { giftName: 'Heart Me', diamondCount: 49, repeatCount: 1, nickname: 'มะลิ' } }),
    ];
    expect(out.map((o) => o.type)).toEqual(['like', 'follow', 'share', 'orangeHeart', 'comment', 'rose', 'gift']);
    expect(valid(out).every((e) => e !== null)).toBe(true);
    expect(out[0]).toMatchObject({ count: 15 });
    expect(out[5]).toMatchObject({ giftCoins: 1, displayName: 'พี่ต้น', avatarUrl: 'https://p/x.jpg' });
    expect(out[6]).toMatchObject({ giftCoins: 49 });
    expect(JSON.stringify(out[1])).not.toContain('secret'); // follows carry no name
  });

  it('accepts other wrappers and names (type instead of event, flat objects, strings for numbers)', () => {
    const { a } = mk();
    expect(a.convert({ type: 'Gift', diamondCount: '5', repeatCount: '2', giftName: 'x' })[0]).toMatchObject({ type: 'gift', giftCoins: 10 });
    expect(a.convert({ event: 'chat', comment: 'hello' })[0]).toMatchObject({ type: 'comment', text: 'hello' });
  });

  it('merges a gift streak into ONE event with the total value, sent when the streak ends', () => {
    const { a } = mk();
    const g = (n: number, end: boolean) => ({ event: 'gift', data: { giftName: 'Rose', giftId: 5655, giftType: 1, diamondCount: 1, repeatCount: n, repeatEnd: end, userId: 'u9', nickname: 'a' } });
    expect(a.convert(g(1, false))).toEqual([]);
    expect(a.convert(g(2, false))).toEqual([]);
    expect(a.convert(g(7, false))).toEqual([]);
    expect(a.openStreaks).toBe(1);
    const out = a.convert(g(10, true));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: 'rose', giftCoins: 10 });
    expect(a.openStreaks).toBe(0);
  });

  it('sends a streak that never got an end message after the idle time, once', () => {
    const { a, tick } = mk();
    a.convert({ event: 'gift', data: { giftName: 'Rose', giftType: 1, diamondCount: 1, repeatCount: 4, repeatEnd: false, userId: 'u1' } });
    expect(a.flush(tick(1000))).toEqual([]);
    const out = a.flush(tick(4000));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ giftCoins: 4 });
    expect(a.flush(tick(5000))).toEqual([]);
  });

  it('different viewers and different gifts keep separate streaks', () => {
    const { a } = mk();
    const s = (u: string, id: number) => a.convert({ event: 'gift', data: { giftType: 1, giftId: id, diamondCount: 1, repeatCount: 3, repeatEnd: false, userId: u } });
    s('a', 1); s('b', 1); s('a', 2);
    expect(a.openStreaks).toBe(3);
  });

  it('never throws and drops anything it does not understand (hostile input)', () => {
    const { a } = mk();
    for (const m of [null, undefined, 1, 'x', [], {}, { event: 5 }, { event: 'gift', data: null }, { event: 'gift', data: { diamondCount: 'abc' } }, { event: 'like', data: { likeCount: 1e12 } }, { event: 'chat', data: { comment: 123 } }, { event: 'join' }, { event: 'gift', data: { diamondCount: 1e30, repeatCount: 1e30 } }]) {
      expect(() => a.convert(m)).not.toThrow();
    }
    expect(a.convert({ event: 'join', data: { nickname: 'x' } })).toEqual([]);
    expect(a.convert({ event: 'like', data: { likeCount: 1e12 } })[0]).toMatchObject({ count: 1000 });
    const big = a.convert({ event: 'gift', data: { diamondCount: 1e30, repeatCount: 1e30 } })[0]!;
    expect(big.giftCoins as number).toBeLessThanOrEqual(1_000_000);
  });
});
