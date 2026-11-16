import { describe, expect, it } from 'vitest';
import { BOT_PERSONAS, BOT_PICS, pickBotPersona } from '../../src/cafe/botPersona';
import { ALL_PIC_NAMES } from '../../src/render/artManifest';
import { existsSync } from 'node:fs';

describe('bot personas', () => {
  it('has a cheeky name for every picture, names are unique and short enough to fit under a customer, and every picture file exists', () => {
    expect(BOT_PICS).toHaveLength(6);
    expect(BOT_PERSONAS.length).toBeGreaterThanOrEqual(24);
    expect(new Set(BOT_PERSONAS.map((p) => p.name)).size).toBe(BOT_PERSONAS.length);
    for (const p of BOT_PERSONAS) {
      expect(p.name.length, p.name).toBeGreaterThan(0);
      expect(Array.from(p.name).length, p.name).toBeLessThanOrEqual(14);
      expect(BOT_PICS as readonly string[], p.name).toContain(p.pic);
    }
    for (const pic of BOT_PICS) {
      expect(BOT_PERSONAS.some((p) => p.pic === pic), pic).toBe(true);
      expect(existsSync(`public/art/${pic}.webp`), pic).toBe(true);
      expect(ALL_PIC_NAMES, pic).toContain(pic); // preloaded and packed with the other pictures
    }
  });

  it('picks a persona not already in the café, and a picture nobody has while one is left; never fails, whatever the random numbers', () => {
    const rng = (() => { let s = 7; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); })();
    const taken = new Set<string>();
    const pics = new Set<string>();
    for (let i = 0; i < BOT_PICS.length; i++) {
      const p = pickBotPersona(rng, taken);
      expect(taken.has(p.name)).toBe(false);
      expect(pics.has(p.pic), 'a picture is not repeated while others are left').toBe(false);
      taken.add(p.name);
      pics.add(p.pic);
    }
    expect(pics.size).toBe(BOT_PICS.length);
    for (let i = 0; i < 200; i++) { const p = pickBotPersona(rng, taken); expect(taken.has(p.name)).toBe(false); taken.add(p.name); if (taken.size >= BOT_PERSONAS.length) taken.clear(); }
    expect(pickBotPersona(rng, new Set(BOT_PERSONAS.map((p) => p.name)))).toBeDefined(); // everything taken: still answers
    for (const bad of [NaN, -1, 5, Infinity, undefined as unknown as number]) expect(pickBotPersona(() => bad)).toBeDefined();
  });
});
