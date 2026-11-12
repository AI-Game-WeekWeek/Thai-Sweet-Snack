import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../src/config/gameConfig';
import { dessertForGift } from '../../src/cafe/giftMenu';
import { ALL_DESSERTS } from '../../src/dessert/data';

const T = defaultConfig.cafe.giftTiers;
const ALL = ALL_DESSERTS.map((d) => d.id);

describe('dessertForGift', () => {
  it('picks the highest tier not above the gift value (all unlocked)', () => {
    const cases: [number, string][] = [[1, 'khao-tom-mat'], [4, 'khao-tom-mat'], [5, 'bua-loy'], [9, 'bua-loy'], [10, 'thong-yod'], [20, 'khanom-chan'], [50, 'foi-thong'], [99, 'thong-yip'], [199, 'luk-chup'], [500, 'khanom-buang'], [99999, 'khanom-buang']];
    for (const [coins, id] of cases) expect(dessertForGift(coins, T, ALL), String(coins)).toBe(id);
  });

  it('every tier points at a real dessert', () => {
    for (const t of T) expect(ALL).toContain(t.dessertId);
  });

  it('treats a missing or invalid value as the cheapest gift', () => {
    for (const bad of [undefined, NaN, 0, -5, Infinity, -Infinity]) expect(dessertForGift(bad, T, ALL), String(bad)).toBe(bad === Infinity ? 'khanom-buang' : 'khao-tom-mat');
  });

  it('a dessert that is not unlocked falls back to the best unlocked tier below it', () => {
    const unlocked = ['khao-tom-mat', 'bua-loy', 'thong-yod', 'khanom-chan'];
    expect(dessertForGift(500, T, unlocked)).toBe('khanom-chan');
    expect(dessertForGift(50, T, unlocked)).toBe('khanom-chan');
    expect(dessertForGift(7, T, unlocked)).toBe('bua-loy');
  });

  it('when nothing at or below the value is unlocked, the cheapest unlocked tier is used', () => {
    expect(dessertForGift(1, T, ['thong-yip'])).toBe('thong-yip');
    expect(dessertForGift(1, T, ['not-in-the-menu'])).toBe('not-in-the-menu');
  });

  it('returns null only when nothing is unlocked', () => {
    expect(dessertForGift(10, T, [])).toBeNull();
  });

  it('works with unsorted tiers', () => {
    const shuffled = [T[3]!, T[0]!, T[2]!, T[1]!];
    expect(dessertForGift(12, shuffled, ALL)).toBe('thong-yod');
  });
});
