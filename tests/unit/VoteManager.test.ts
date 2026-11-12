import { describe, expect, it } from 'vitest';
import { VoteManager } from '../../src/vote/VoteManager';

const mk = () => new VoteManager({ maxVoters: 100, anonVotesPerSec: 5 });
const open = (v: VoteManager, n = 3, round = 1) => v.open(n, round);

describe('VoteManager', () => {
  it('counts votes per choice', () => {
    const v = mk(); open(v);
    expect(v.cast(1, 'a', 1, 0)).toBe('ok');
    expect(v.cast(2, 'b', 1, 0)).toBe('ok');
    expect(v.cast(2, 'c', 1, 0)).toBe('ok');
    expect(v.tally()).toEqual([1, 2, 0]);
  });

  it('one vote per user: a later vote replaces the earlier one', () => {
    const v = mk(); open(v);
    for (let i = 0; i < 1000; i++) v.cast(1, 'same', 1, 0);
    expect(v.tally()).toEqual([1, 0, 0]);
    v.cast(3, 'same', 1, 0);
    expect(v.tally()).toEqual([0, 0, 1]);
  });

  it('rejects invalid choices', () => {
    const v = mk(); open(v);
    for (const c of [0, 4, -1, NaN, Infinity, 1.5]) expect(v.cast(c, 'a', 1, 0), String(c)).toBe('invalid');
    expect(v.tally()).toEqual([0, 0, 0]);
  });

  it('is closed before open, after close, and for another round', () => {
    const v = mk();
    expect(v.cast(1, 'a', 1, 0)).toBe('closed');
    open(v, 3, 5);
    expect(v.cast(1, 'a', 4, 0)).toBe('stale');
    expect(v.cast(1, 'a', 6, 0)).toBe('stale');
    expect(v.cast(1, 'a', 5, 0)).toBe('ok');
    v.close();
    expect(v.isOpen).toBe(false);
    expect(v.cast(2, 'b', 5, 0)).toBe('closed');
    expect(v.tally()).toEqual([1, 0, 0]);
  });

  it('caps distinct voters per round', () => {
    const v = new VoteManager({ maxVoters: 10, anonVotesPerSec: 5 }); open(v);
    let capped = 0;
    for (let i = 0; i < 100; i++) if (v.cast(1, `u${i}`, 1, 0) === 'capped') capped++;
    expect(capped).toBe(90);
    expect(v.tally()[0]).toBe(10);
    expect(v.cast(2, 'u0', 1, 0)).toBe('ok'); // an existing voter can still change their mind
  });

  it('caps anonymous votes per second and recovers in the next second', () => {
    const v = mk(); open(v);
    const r = Array.from({ length: 20 }, () => v.cast(1, undefined, 1, 100));
    expect(r.filter((x) => x === 'ok')).toHaveLength(5);
    expect(r.filter((x) => x === 'capped')).toHaveLength(15);
    expect(v.cast(1, undefined, 1, 1200)).toBe('ok');
  });

  it('100 000 comments in one tick stay bounded and fast', () => {
    const v = new VoteManager({ maxVoters: 5000, anonVotesPerSec: 50 }); open(v);
    for (let i = 0; i < 100_000; i++) v.cast(1 + (i % 3), `u${i}`, 1, 0);
    const t = v.tally();
    expect(t[0]! + t[1]! + t[2]!).toBeLessThanOrEqual(5000);
  });

  it('winner is the most voted; a tie is broken by the rng; no votes picks index 0', () => {
    const v = mk(); open(v);
    expect(v.winner(() => 0.99)).toBe(0);
    v.cast(2, 'a', 1, 0); v.cast(2, 'b', 1, 0); v.cast(3, 'c', 1, 0);
    expect(v.winner(() => 0.5)).toBe(1);
    v.cast(3, 'd', 1, 0); // 2 vs 2
    const seen = new Set([v.winner(() => 0), v.winner(() => 0.99)]);
    expect(seen).toEqual(new Set([1, 2]));
  });

  it('winner works after close and does not depend on being open', () => {
    const v = mk(); open(v);
    v.cast(2, 'a', 1, 0);
    v.close();
    expect(v.winner(() => 0.3)).toBe(1);
  });

  it('cancel clears everything and re-open starts fresh', () => {
    const v = mk(); open(v);
    v.cast(1, 'a', 1, 0);
    v.cancel();
    expect(v.isOpen).toBe(false);
    expect(v.tally()).toEqual([]);
    open(v, 2, 2);
    expect(v.cast(1, 'a', 2, 0)).toBe('ok');
    expect(v.tally()).toEqual([1, 0]);
  });

  it('works with fewer than 3 candidates', () => {
    const v = mk(); open(v, 1);
    expect(v.cast(1, 'a', 1, 0)).toBe('ok');
    expect(v.cast(2, 'a', 1, 0)).toBe('invalid');
    expect(v.winner(() => 0)).toBe(0);
  });

  it('ignores an over-long user key safely', () => {
    const v = mk(); open(v);
    expect(v.cast(1, 'x'.repeat(10_000), 1, 0)).toBe('ok');
    expect(v.tally()).toEqual([1, 0, 0]);
  });
});
