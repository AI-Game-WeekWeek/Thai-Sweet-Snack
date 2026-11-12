import { describe, expect, it } from 'vitest';
import { avatarSpec } from '../../src/cafe/avatars';

describe('avatarSpec', () => {
  it('is deterministic and varies with the seed', () => {
    expect(avatarSpec(3, 'มะลิ')).toEqual(avatarSpec(3, 'มะลิ'));
    const colors = new Set(Array.from({ length: 16 }, (_, i) => avatarSpec(i, null).bg));
    expect(colors.size).toBeGreaterThan(4);
  });

  it('uses the first letter or digit of the name, else none', () => {
    expect(avatarSpec(1, 'น้ำฝน').initial).toBe('น');
    expect(avatarSpec(1, 'bob').initial).toBe('B');
    expect(avatarSpec(1, '7eleven').initial).toBe('7');
    for (const n of [null, '', '   ', '😀😀', '---']) expect(avatarSpec(1, n).initial, String(n)).toBeNull();
  });

  it('always returns valid colours, even for hostile seeds', () => {
    for (const seed of [0, -1, 1.5, NaN, Infinity, 2 ** 40]) {
      const a = avatarSpec(seed, 'x');
      for (const c of [a.bg, a.fg, a.skin]) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
