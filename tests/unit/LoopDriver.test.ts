import { describe, expect, it, vi } from 'vitest';
import { LoopDriver } from '../../src/core/LoopDriver';
import type { GameManager } from '../../src/core/GameManager';

function fakeRaf() {
  let nextId = 1;
  const pending = new Map<number, (t: number) => void>();
  return {
    raf: (cb: (t: number) => void) => {
      const id = nextId++;
      pending.set(id, cb);
      return id;
    },
    caf: (id: number) => {
      pending.delete(id);
    },
    pendingCount: () => pending.size,
    frame(t: number) {
      const batch = [...pending.entries()];
      pending.clear();
      for (const [, cb] of batch) cb(t);
    },
  };
}

function fakeGame() {
  const update = vi.fn();
  return { game: { update } as unknown as GameManager, update };
}

describe('LoopDriver', () => {
  it('start() twice schedules only one pending frame', () => {
    const f = fakeRaf();
    const { game } = fakeGame();
    const d = new LoopDriver(game, f.raf, f.caf);
    expect(d.start()).toBe(true);
    expect(d.start()).toBe(false);
    expect(f.pendingCount()).toBe(1);
  });

  it('calls update once per frame with the elapsed delta (first dt = 0)', () => {
    const f = fakeRaf();
    const { game, update } = fakeGame();
    new LoopDriver(game, f.raf, f.caf).start();
    f.frame(1000);
    f.frame(1016);
    f.frame(1050);
    expect(update.mock.calls.map((c) => c[0])).toEqual([0, 16, 34]);
    expect(f.pendingCount()).toBe(1);
  });

  it('stop() leaves no pending frame and stops updates', () => {
    const f = fakeRaf();
    const { game, update } = fakeGame();
    const d = new LoopDriver(game, f.raf, f.caf);
    d.start();
    f.frame(0);
    d.stop();
    expect(f.pendingCount()).toBe(0);
    f.frame(16);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('after stop()+start() the first dt is 0, not the idle gap', () => {
    const f = fakeRaf();
    const { game, update } = fakeGame();
    const d = new LoopDriver(game, f.raf, f.caf);
    d.start();
    f.frame(0);
    f.frame(16);
    d.stop();
    d.start();
    f.frame(50_000);
    expect(update).toHaveBeenLastCalledWith(0);
  });

  it('keeps looping when game.update throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const f = fakeRaf();
    const update = vi.fn(() => {
      throw new Error('boom');
    });
    new LoopDriver({ update } as unknown as GameManager, f.raf, f.caf).start();
    f.frame(0);
    f.frame(16);
    expect(update).toHaveBeenCalledTimes(2);
    expect(f.pendingCount()).toBe(1);
    vi.restoreAllMocks();
  });

  it('stop()+start() called from inside update() leaves exactly one loop', () => {
    const f = fakeRaf();
    let driver: LoopDriver | undefined;
    let calls = 0;
    const update = vi.fn(() => {
      if (++calls === 1) {
        driver!.stop();
        driver!.start();
      }
    });
    driver = new LoopDriver({ update } as unknown as GameManager, f.raf, f.caf);
    driver.start();
    f.frame(0);
    expect(f.pendingCount()).toBe(1);
    f.frame(16);
    f.frame(32);
    expect(f.pendingCount()).toBe(1);
    expect(update).toHaveBeenCalledTimes(3); // one update per frame, not two
  });

  it('stop() called from inside update() ends the loop', () => {
    const f = fakeRaf();
    let driver: LoopDriver | undefined;
    const update = vi.fn(() => driver!.stop());
    driver = new LoopDriver({ update } as unknown as GameManager, f.raf, f.caf);
    driver.start();
    f.frame(0);
    expect(f.pendingCount()).toBe(0);
  });
});
