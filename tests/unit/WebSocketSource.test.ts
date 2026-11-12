import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocketSource, type WsLike } from '../../src/tiktok/WebSocketSource';
import type { ConnectionState } from '../../src/tiktok/types';

class FakeWs implements WsLike {
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  close() { this.closed = true; this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.(); }
  message(data: unknown) { this.onmessage?.({ data }); }
  drop() { this.readyState = 3; this.onclose?.(); }
}

function mk(over: Partial<ConstructorParameters<typeof WebSocketSource>[0]> = {}) {
  const sockets: FakeWs[] = [];
  const sink = vi.fn();
  const states: ConnectionState[] = [];
  const src = new WebSocketSource({
    url: 'ws://x', sink, onState: (s) => states.push(s), rng: () => 1,
    create: () => { const s = new FakeWs(); sockets.push(s); return s; }, ...over,
  });
  return { src, sockets, sink, states };
}

describe('WebSocketSource', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('goes reconnecting -> connected and forwards parsed messages', () => {
    const { src, sockets, sink, states } = mk();
    src.start();
    expect(states).toEqual(['reconnecting']);
    sockets[0]!.open();
    expect(states).toEqual(['reconnecting', 'connected']);
    sockets[0]!.message(JSON.stringify({ id: 'a', type: 'like', count: 1, tsMs: 1 }));
    expect(sink).toHaveBeenCalledWith({ id: 'a', type: 'like', count: 1, tsMs: 1 });
  });

  it('ping messages refresh the heartbeat and are not forwarded', () => {
    const { src, sockets, sink } = mk();
    src.start();
    sockets[0]!.open();
    sockets[0]!.message(JSON.stringify({ ping: true }));
    expect(sink).not.toHaveBeenCalled();
  });

  it('ignores garbage, binary and oversized messages', () => {
    const { src, sockets, sink } = mk({ maxMessageBytes: 100 });
    src.start();
    sockets[0]!.open();
    for (const bad of ['{nope', 'null', '5', new ArrayBuffer(8), null, undefined, 'x'.repeat(500)]) sockets[0]!.message(bad);
    expect(sink).toHaveBeenCalledTimes(2); // 'null' and '5' parse but are forwarded for ingest to reject; real garbage is not
    expect(sockets[0]!.closed).toBe(false);
  });

  it('forwards each element of an array even when one is bad', () => {
    const { src, sockets, sink } = mk();
    src.start();
    sockets[0]!.open();
    sockets[0]!.message(JSON.stringify([{ id: 'a' }, null, { id: 'b' }]));
    expect(sink).toHaveBeenCalledTimes(3);
  });

  it('a throwing sink does not break the socket handler', () => {
    const sink = vi.fn(() => { throw new Error('boom'); });
    const { src, sockets } = mk({ sink });
    src.start();
    sockets[0]!.open();
    expect(() => sockets[0]!.message(JSON.stringify({ id: 'a' }))).not.toThrow();
  });

  it('reconnects with doubling backoff capped at the max', () => {
    const { src, sockets } = mk({ backoff: { minMs: 1000, maxMs: 8000 } });
    src.start();
    const delays: number[] = [];
    for (let i = 0; i < 6; i++) {
      const before = sockets.length;
      sockets[before - 1]!.drop();
      let waited = 0;
      while (sockets.length === before) { vi.advanceTimersByTime(250); waited += 250; if (waited > 20_000) break; }
      delays.push(waited);
    }
    expect(delays).toEqual([1000, 2000, 4000, 8000, 8000, 8000]);
  });

  it('jitter keeps the delay within [half, full] of the backoff step', () => {
    const { src, sockets } = mk({ rng: () => 0, backoff: { minMs: 1000, maxMs: 8000 } });
    src.start();
    sockets[0]!.drop();
    vi.advanceTimersByTime(499);
    expect(sockets.length).toBe(1);
    vi.advanceTimersByTime(2);
    expect(sockets.length).toBe(2);
  });

  it('a stable connection resets the backoff', () => {
    const { src, sockets } = mk({ backoff: { minMs: 1000, maxMs: 8000 } });
    src.start();
    sockets[0]!.drop();
    vi.advanceTimersByTime(1000);
    sockets[1]!.drop();
    vi.advanceTimersByTime(2000);
    sockets[2]!.open();
    vi.advanceTimersByTime(15_000);
    sockets[2]!.message(JSON.stringify({ ping: true }));
    sockets[2]!.drop();
    vi.advanceTimersByTime(1000);
    expect(sockets.length).toBe(4);
  });

  it('heartbeat silence closes the half-open socket and reconnects', () => {
    const { src, sockets, states } = mk({ heartbeatMs: 5000 });
    src.start();
    sockets[0]!.open();
    vi.advanceTimersByTime(5001);
    expect(sockets[0]!.closed).toBe(true);
    expect(states[states.length - 1]).toBe('reconnecting');
    vi.advanceTimersByTime(1000);
    expect(sockets.length).toBe(2);
  });

  it('messages keep the heartbeat alive', () => {
    const { src, sockets } = mk({ heartbeatMs: 5000 });
    src.start();
    sockets[0]!.open();
    for (let i = 0; i < 5; i++) { vi.advanceTimersByTime(4000); sockets[0]!.message(JSON.stringify({ ping: true })); }
    expect(sockets[0]!.closed).toBe(false);
  });

  it('stop during a pending reconnect leaves no timers and no further sockets', () => {
    const { src, sockets, states } = mk();
    src.start();
    sockets[0]!.open();
    sockets[0]!.drop();
    src.stop();
    expect(states[states.length - 1]).toBe('offline');
    vi.advanceTimersByTime(120_000);
    expect(sockets.length).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stop closes an open socket and later events from it are ignored', () => {
    const { src, sockets, sink } = mk();
    src.start();
    sockets[0]!.open();
    src.stop();
    expect(sockets[0]!.closed).toBe(true);
    sockets[0]!.message(JSON.stringify({ id: 'late' }));
    sockets[0]!.drop();
    expect(sink).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('double start creates one socket; start after stop works again', () => {
    const { src, sockets } = mk();
    src.start();
    src.start();
    expect(sockets.length).toBe(1);
    src.stop();
    src.start();
    expect(sockets.length).toBe(2);
  });

  it('a throwing create goes offline-safe and keeps retrying', () => {
    let n = 0;
    const sockets: FakeWs[] = [];
    const states: ConnectionState[] = [];
    const src = new WebSocketSource({ url: 'ws://x', sink: () => {}, onState: (s) => states.push(s), rng: () => 1,
      create: () => { if (++n < 3) throw new Error('no ws'); const s = new FakeWs(); sockets.push(s); return s; } });
    expect(() => src.start()).not.toThrow();
    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(2000);
    expect(sockets.length).toBe(1);
  });

  it('error events trigger a reconnect once (close after error does not double-schedule)', () => {
    const { src, sockets } = mk();
    src.start();
    sockets[0]!.open();
    sockets[0]!.onerror?.();
    sockets[0]!.drop();
    vi.advanceTimersByTime(60_000);
    expect(sockets.length).toBe(2);
  });
});
