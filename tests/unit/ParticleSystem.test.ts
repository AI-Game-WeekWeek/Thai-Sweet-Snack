import { describe, expect, it } from 'vitest';
import { ParticleSystem } from '../../src/anim/ParticleSystem';

const p = (over = {}) => ({ x: 0, y: 0, vx: 0, vy: 0, lifeMs: 1000, size: 4, color: '#fff', ...over });

describe('ParticleSystem', () => {
  it('rejects spawns beyond the cap', () => {
    const s = new ParticleSystem(10, 0);
    let ok = 0;
    for (let i = 0; i < 1000; i++) if (s.spawn(p())) ok++;
    expect(ok).toBe(10);
    expect(s.count).toBe(10);
  });

  it('particles expire after lifeMs and free room', () => {
    const s = new ParticleSystem(5, 0);
    for (let i = 0; i < 5; i++) s.spawn(p({ lifeMs: 100 }));
    s.update(50);
    expect(s.count).toBe(5);
    s.update(60);
    expect(s.count).toBe(0);
    expect(s.spawn(p())).toBe(true);
  });

  it('gravity accelerates vy and velocity moves position', () => {
    const s = new ParticleSystem(5, 1000);
    s.spawn(p({ vx: 100, vy: 0 }));
    s.update(100);
    let seen: { x: number; y: number; vy: number } | null = null;
    s.forEach((q) => { seen = { x: q.x, y: q.y, vy: q.vy }; });
    expect(seen!.vy).toBeCloseTo(100, 5);
    expect(seen!.x).toBeCloseTo(10, 5);
    expect(seen!.y).toBeGreaterThan(0);
  });

  it('clear empties the system', () => {
    const s = new ParticleSystem(5, 0);
    s.spawn(p());
    s.clear();
    expect(s.count).toBe(0);
  });

  it('rejects invalid particles and ignores invalid dt', () => {
    const s = new ParticleSystem(5, 0);
    expect(s.spawn(p({ x: NaN }))).toBe(false);
    expect(s.spawn(p({ lifeMs: 0 }))).toBe(false);
    expect(s.spawn(p({ size: -1 }))).toBe(false);
    s.spawn(p());
    for (const dt of [NaN, -1, 0, Infinity]) s.update(dt);
    expect(s.count).toBe(1);
  });
});
