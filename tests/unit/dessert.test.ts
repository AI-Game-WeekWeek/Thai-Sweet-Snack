import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALL_DESSERTS } from '../../src/dessert/data';
import { validateDessert } from '../../src/dessert/validate';
import type { DessertDef } from '../../src/dessert/types';
import { ANIM_IDS, SOUND_IDS } from '../../src/dessert/types';

// The 8 v1 desserts in spec order, then the café's everyday default.
const NAMES = ['ขนมชั้น', 'ลูกชุบ', 'ฝอยทอง', 'ทองหยิบ', 'ทองหยอด', 'ขนมครก', 'บัวลอย', 'ขนมเบื้อง', 'ข้าวต้มมัด'];

function good(): DessertDef {
  return {
    id: 'x', nameTh: 'ทดสอบ', nameEn: 'Test', unlock: { default: true },
    ingredients: [{ id: 'a', nameTh: 'แป้ง', color: '#fff' }],
    steps: [{ id: 's1', nameTh: 'คน', anim: 'stir', sound: 'stir', weight: 1, maxMs: 1000 }],
    presentation: { container: 'tray', layout: 'grid' },
    palette: ['#fff'],
    reward: { baseScore: 100, baseCoins: 10, xp: 5 },
  };
}

describe('dessert data', () => {
  it('has the 8 v1 desserts in spec order plus ข้าวต้มมัด, with unique ids', () => {
    expect(ALL_DESSERTS.map((d) => d.nameTh)).toEqual(NAMES);
    expect(new Set(ALL_DESSERTS.map((d) => d.id)).size).toBe(9);
  });

  it('every dessert is valid, has >=4 steps and only known anim/sound ids', () => {
    for (const d of ALL_DESSERTS) {
      expect(validateDessert(d)).toEqual([]);
      expect(d.steps.length).toBeGreaterThanOrEqual(4);
      for (const st of d.steps) {
        expect(ANIM_IDS).toContain(st.anim);
        expect(SOUND_IDS).toContain(st.sound);
      }
    }
  });

  it('ข้าวต้มมัด is served as individual leaf-wrapped parcels, each wrapped and tied on its own', () => {
    const d = ALL_DESSERTS.find((x) => x.id === 'khao-tom-mat')!;
    expect(d.presentation.layout).toBe('parcels');
    const steps = d.steps.map((st) => st.nameTh).join(' | ');
    expect(steps).toContain('ห่อใบตองทีละห่อ');
    expect(steps).toContain('มัดเชือกแต่ละห่อ');
    expect(d.steps.length).toBeGreaterThanOrEqual(5);
  });

  it('has at least one default-unlocked dessert', () => {
    expect(ALL_DESSERTS.some((d) => 'default' in d.unlock)).toBe(true);
  });
});

describe('validateDessert', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it('accepts a good recipe', () => expect(validateDessert(good())).toEqual([]));

  it.each([
    ['no steps', (d: DessertDef) => { d.steps = []; }],
    ['zero weight', (d: DessertDef) => { d.steps[0]!.weight = 0; }],
    ['NaN weight', (d: DessertDef) => { d.steps[0]!.weight = NaN; }],
    ['zero maxMs', (d: DessertDef) => { d.steps[0]!.maxMs = 0; }],
    ['duplicate step id', (d: DessertDef) => { d.steps.push({ ...d.steps[0]! }); }],
    ['no ingredients', (d: DessertDef) => { d.ingredients = []; }],
    ['empty nameTh', (d: DessertDef) => { d.nameTh = ''; }],
  ])('rejects %s', (_n, mutate) => {
    const d = good();
    mutate(d);
    expect(validateDessert(d).length).toBeGreaterThan(0);
  });

  it('warns but accepts unknown anim/sound ids', () => {
    const d = good();
    (d.steps[0] as { anim: string }).anim = 'nope';
    (d.steps[0] as { sound: string }).sound = 'nope';
    expect(validateDessert(d)).toEqual([]);
    expect(console.warn).toHaveBeenCalled();
  });
});
