import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultConfig } from '../../src/config/gameConfig';
import { AnimationManager, type AnimSpec } from '../../src/anim/AnimationManager';

function mk(maxActive = 64) {
  return new AnimationManager({ ...defaultConfig, anim: { ...defaultConfig.anim, maxActive } });
}
const spec = (over: Partial<AnimSpec> = {}): AnimSpec => ({ kind: 'stir', durationMs: 1000, ...over });

describe('AnimationManager', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it('progresses t from 0 to 1 and fires finished exactly once', () => {
    const m = mk();
    const ts: number[] = [];
    const done: string[] = [];
    m.play(spec({ onUpdate: (t) => ts.push(t), onDone: (r) => done.push(r) }), 1);
    for (let i = 0; i < 20; i++) m.update(100);
    expect(ts[0]).toBeGreaterThan(0);
    expect(ts[ts.length - 1]).toBe(1);
    expect(ts.every((t, i) => i === 0 || t >= (ts[i - 1] as number))).toBe(true);
    expect(done).toEqual(['finished']);
    expect(m.activeCount).toBe(0);
  });

  it('maxMs shorter than the duration ends with timeout', () => {
    const m = mk();
    const done: string[] = [];
    m.play(spec({ durationMs: 10_000, maxMs: 500, onDone: (r) => done.push(r) }), 1);
    for (let i = 0; i < 10; i++) m.update(100);
    expect(done).toEqual(['timeout']);
  });

  it('a throwing onUpdate ends that animation with error once; others continue', () => {
    const m = mk();
    const done: string[] = [];
    const ok: string[] = [];
    m.play(spec({ onUpdate: () => { throw new Error('x'); }, onDone: (r) => done.push(r) }), 1);
    m.play(spec({ onDone: (r) => ok.push(r) }), 1);
    for (let i = 0; i < 12; i++) m.update(100);
    expect(done).toEqual(['error']);
    expect(ok).toEqual(['finished']);
  });

  it('cancel stops callbacks and never calls onDone', () => {
    const m = mk();
    const onDone = vi.fn();
    const onUpdate = vi.fn();
    const h = m.play(spec({ onDone, onUpdate }), 1);
    expect(m.cancel(h)).toBe(true);
    expect(m.cancel(h)).toBe(false);
    m.update(5000);
    expect(onDone).not.toHaveBeenCalled();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('cancelRound cancels only that round', () => {
    const m = mk();
    const d1 = vi.fn();
    const d2 = vi.fn();
    m.play(spec({ onDone: d1 }), 1);
    m.play(spec({ onDone: d2 }), 2);
    expect(m.cancelRound(1)).toBe(1);
    for (let i = 0; i < 12; i++) m.update(100);
    expect(d1).not.toHaveBeenCalled();
    expect(d2).toHaveBeenCalledTimes(1);
  });

  it('same key restarts: the old one is cancelled silently, one stays active', () => {
    const m = mk();
    const oldDone = vi.fn();
    const h1 = m.play(spec({ key: 'step', onDone: oldDone }), 1);
    m.update(100);
    const h2 = m.play(spec({ key: 'step' }), 1);
    expect(m.isActive(h1)).toBe(false);
    expect(m.isActive(h2)).toBe(true);
    expect(m.activeCount).toBe(1);
    for (let i = 0; i < 12; i++) m.update(100);
    expect(oldDone).not.toHaveBeenCalled();
  });

  it('the same key in different rounds does not collide', () => {
    const m = mk();
    m.play(spec({ key: 'step' }), 1);
    m.play(spec({ key: 'step' }), 2);
    expect(m.activeCount).toBe(2);
  });

  it('10 000 plays in one tick keep activeCount at the cap and evict silently', () => {
    const m = mk(64);
    const done = vi.fn();
    for (let i = 0; i < 10_000; i++) m.play(spec({ onDone: done }), 1);
    expect(m.activeCount).toBe(64);
    expect(done).not.toHaveBeenCalled();
  });

  it('ignores invalid dt', () => {
    const m = mk();
    const onUpdate = vi.fn();
    m.play(spec({ onUpdate }), 1);
    for (const dt of [NaN, -1, 0, Infinity]) m.update(dt);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('a callback that cancels another animation or the round is safe, onDone never doubles', () => {
    const m = mk();
    const doneB = vi.fn();
    let hb = -1;
    m.play(spec({ durationMs: 100, onDone: () => { m.cancel(hb); m.cancelRound(1); } }), 1);
    hb = m.play(spec({ durationMs: 100, onDone: doneB }), 1);
    for (let i = 0; i < 5; i++) m.update(100);
    expect(doneB.mock.calls.length).toBeLessThanOrEqual(1);
    expect(m.activeCount).toBe(0);
  });

  it('a non-positive duration finishes on the next update', () => {
    const m = mk();
    const done = vi.fn();
    m.play(spec({ durationMs: 0, onDone: done }), 1);
    m.update(16);
    expect(done).toHaveBeenCalledTimes(1);
  });
});
