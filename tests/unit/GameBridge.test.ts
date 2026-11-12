import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { liveConfig } from '../../src/config/gameConfig';
import { Game } from '../../src/Game';
import { ALL_DESSERTS } from '../../src/dessert/data';
import { DessertManager } from '../../src/dessert/DessertManager';
import { TikTokEventManager } from '../../src/tiktok/TikTokEventManager';
import { WebSocketSource, type WsLike } from '../../src/tiktok/WebSocketSource';

const IDS = ALL_DESSERTS.map((d) => d.id);

class FakeWs implements WsLike {
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  close() { this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.(); }
  send(o: unknown) { this.onmessage?.({ data: typeof o === 'string' ? o : JSON.stringify(o) }); }
  drop() { this.readyState = 3; this.onclose?.(); }
}

function mk() {
  const events = new TikTokEventManager(liveConfig);
  const game = new Game(liveConfig, new DessertManager(ALL_DESSERTS, IDS, () => 0.4), undefined, events);
  const sockets: FakeWs[] = [];
  const src = new WebSocketSource({
    url: 'ws://bridge', sink: (raw) => game.ingestEvent(raw), onState: (s) => events.setConnection(s), rng: () => 1,
    create: () => { const s = new FakeWs(); sockets.push(s); return s; },
  });
  return { game, events, src, sockets };
}
function runUntil(g: Game, pred: () => boolean, limit = 400_000): void {
  for (let i = 0; i < limit && !pred(); i++) g.update(16);
  expect(pred()).toBe(true);
}
let n = 0;
const ev = (g: Game, over = {}) => ({ id: `w${++n}`, type: 'follow', count: 1, tsMs: g.nowMs, ...over });

describe('Game + WebSocketSource', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('events from the socket raise progress and the HUD state shows connected', () => {
    const { game, src, sockets } = mk();
    src.start();
    sockets[0]!.open();
    game.start();
    runUntil(game, () => game.snapshot().state === 'COOKING');
    game.update(16);
    const before = game.snapshot().progress;
    sockets[0]!.send([ev(game, { type: 'like', count: 200 }), ev(game)]);
    game.update(16);
    expect(game.snapshot().progress - before).toBeGreaterThan(4);
    expect(game.snapshot().connection).toBe('connected');
    src.stop();
  });

  it('dropping the socket mid-round does not stop cooking; reconnect resumes events', () => {
    const { game, src, sockets } = mk();
    src.start();
    sockets[0]!.open();
    game.start();
    runUntil(game, () => game.snapshot().state === 'COOKING');
    sockets[0]!.drop();
    expect(game.snapshot().connection).toBe('reconnecting');
    const roundBefore = game.snapshot().roundId;
    runUntil(game, () => game.snapshot().roundId > roundBefore); // a whole round completes while the bridge is down
    vi.advanceTimersByTime(1000);
    expect(sockets.length).toBe(2);
    sockets[1]!.open();
    expect(game.snapshot().connection).toBe('connected');
    runUntil(game, () => game.snapshot().state === 'COOKING');
    game.update(16);
    const before = game.snapshot().progress;
    sockets[1]!.send(ev(game, { type: 'orangeHeart' }));
    game.update(16);
    expect(game.snapshot().progress).toBeGreaterThan(before + 3);
    src.stop();
  });

  it('a bridge that never comes back is harmless', () => {
    const { game, src, sockets } = mk();
    src.start();
    sockets[0]!.drop();
    game.start();
    runUntil(game, () => game.snapshot().roundsCompleted >= 3);
    src.stop();
    expect(game.snapshot().connection).toBe('offline');
  });

  it('garbage and hostile messages never break the loop or push progress past 100', () => {
    const { game, src, sockets } = mk();
    src.start();
    sockets[0]!.open();
    game.start();
    runUntil(game, () => game.snapshot().state === 'COOKING');
    for (const junk of ['{bad', '[]', 'null', '"x"', '5', JSON.stringify([{}, null, 5, 'x']), JSON.stringify(ev(game, { count: 1e12 })), JSON.stringify(ev(game, { type: 'like', count: NaN })), 'x'.repeat(200_000)]) sockets[0]!.send(junk);
    for (let i = 0; i < 3000; i++) sockets[0]!.send(ev(game, { type: 'like', count: 1000 }));
    game.update(16);
    expect(game.snapshot().progress).toBeLessThanOrEqual(100);
    runUntil(game, () => game.snapshot().roundsCompleted >= 1);
    src.stop();
  });

  it('stop() ends cleanly with no timers left', () => {
    const { src, sockets } = mk();
    src.start();
    sockets[0]!.open();
    src.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});
