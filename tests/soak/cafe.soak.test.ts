import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cafeConfig } from '../../src/config/gameConfig';
import { CafeQueue } from '../../src/cafe/CafeQueue';
import { HeartMeter } from '../../src/cooking/HeartMeter';
import { Game } from '../../src/Game';
import { TRANSITIONS } from '../../src/core/StateMachine';
import { ALL_DESSERTS } from '../../src/dessert/data';
import { DessertManager } from '../../src/dessert/DessertManager';
import { ProgressionManager } from '../../src/reward/ProgressionManager';
import { RewardManager } from '../../src/reward/RewardManager';
import { SaveSystem, type StorageLike } from '../../src/save/SaveSystem';
import { MockEventSource } from '../../src/tiktok/MockEventSource';
import { TikTokEventManager } from '../../src/tiktok/TikTokEventManager';

const ROUNDS = 150;
const CFG = { ...cafeConfig, cafe: { ...cafeConfig.cafe, surprise: { ...cafeConfig.cafe.surprise, phone: { ...cafeConfig.cafe.surprise.phone, firstMs: 2000, everyMs: 9000, jitter: 0.5, deadlineMs: 20_000 } } } };
const C = CFG.cafe;
const ALL_IDS = ALL_DESSERTS.map((d) => d.id);
const DEFAULT_IDS = ALL_DESSERTS.filter((d) => 'default' in d.unlock).map((d) => d.id);
const SECRET_NAME = 'SECRET-VIEWER-NAME';

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
class Flaky implements StorageLike {
  d = new Map<string, string>();
  constructor(private readonly rand: () => number) {}
  private f() { if (this.rand() < 0.3) throw new Error('storage'); }
  getItem(k: string) { this.f(); return this.d.get(k) ?? null; }
  setItem(k: string, v: string) { this.f(); this.d.set(k, v); }
  removeItem(k: string) { this.d.delete(k); }
}

describe('café soak', () => {
  beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => vi.restoreAllMocks());

  it(`${ROUNDS} customers under gift spam, duplicates, hostile names and pictures, invalid values, likes spam and flaky storage`, () => {
    const rand = mulberry32(2025);
    const events = new TikTokEventManager(CFG);
    const save = new SaveSystem(CFG, new Flaky(mulberry32(5)), DEFAULT_IDS, ALL_IDS);
    const rewards = new RewardManager(CFG, save.load());
    const queue = new CafeQueue({ maxWaiting: C.maxWaiting, patienceMs: C.patienceMs, maxNameLength: C.maxNameLength });
    const meter = new HeartMeter({ decayPerSec: CFG.vote.heartDecayPerSec, maxBoost: CFG.vote.maxBoost });
    const game = new Game(CFG, new DessertManager(ALL_DESSERTS, rewards.profile.unlocked, mulberry32(3)), undefined, events, rewards, { progression: new ProgressionManager(ALL_DESSERTS, rewards), save }, undefined, { queue, meter, rng: mulberry32(8) });
    const mock = new MockEventSource(mulberry32(6), (e) => game.ingestEvent(e), { cafe: true });
    mock.steady(120, 1e12);
    game.start();

    let n = 0;
    const raw = (o: Record<string, unknown>) => game.ingestEvent({ id: `s${++n}`, tsMs: game.nowMs, count: 1, ...o });
    const hostileNames = [SECRET_NAME, '‮\u0000​', 'ก'.repeat(500), '<img src=x onerror=alert(1)>', '', '   ', '\n\n'];
    const hostileUrls = ['javascript:alert(1)', 'data:image/png;base64,AAAA', 'http://evil.example/a.jpg', 'https://' + 'a'.repeat(900), 'https://cdn.example.com/a.jpg', 42, null];

    let prev = game.snapshot();
    let prevLost = 0;
    let prevCoins = rewards.profile.coins;
    let cookedChecks = 0;
    let sawVip = false;
    let sawPhone = false;
    let sawCat = false;
    let unlockedBefore = rewards.profile.unlocked.length;
    let served = 0;
    let wasServing = false;

    for (let frame = 0; game.snapshot().roundsCompleted < ROUNDS; frame++) {
      expect(frame).toBeLessThan(900_000);
      mock.tick(16, game.nowMs);
      const r = rand();
      if (r < 0.01) for (let i = 0; i < 80; i++) raw({ type: 'gift', giftCoins: [1, 5, 10, 20, 50, 99, 199, 500, NaN, -3, 1e12][i % 11], displayName: hostileNames[i % hostileNames.length], avatarUrl: hostileUrls[i % hostileUrls.length] });
      else if (r < 0.02) { const e = { id: `dup${frame}`, type: 'gift', count: 1, giftCoins: 20, displayName: 'D', tsMs: game.nowMs }; for (let i = 0; i < 200; i++) game.ingestEvent(e); }
      else if (r < 0.03) raw({ type: 'like', count: 1000 });
      else if (r < 0.035) raw({ type: 'rose' });
      else if (r < 0.04) raw({ type: 'orangeHeart', count: 3 });
      else if (r < 0.045) for (let i = 0; i < 300; i++) raw({ type: 'gift', giftCoins: 5, displayName: 'Z' }); // flood: the queue is capped, extra gifts become coins
      else if (r < 0.055) for (let i = 0; i < 500; i++) raw({ type: 'follow' }); // lucky cat spam
      else if (r < 0.065) for (let i = 0; i < 500; i++) raw({ type: 'orangeHeart' }); // VIP + tip spam
      if (rand() < 0.002) events.setConnection(['connected', 'reconnecting', 'offline'][Math.floor(rand() * 3)] as 'offline');

      game.update(16);
      const s = game.snapshot();
      const cafe = s.cafe!;

      expect(s.progress).toBeGreaterThanOrEqual(0);
      expect(s.progress).toBeLessThanOrEqual(100);
      expect(meter.value).toBeGreaterThanOrEqual(0);
      expect(meter.value).toBeLessThanOrEqual(1);
      expect(queue.waiting().length).toBeLessThanOrEqual(C.maxWaiting);
      expect(cafe.waiting.length).toBeLessThanOrEqual(C.visible - 1);
      expect(events.queueLength).toBeLessThanOrEqual(CFG.events.queueMax);
      if (s.state !== prev.state) expect(TRANSITIONS[prev.state]).toContain(s.state);
      expect(s.roundId - prev.roundId === 0 || s.roundId - prev.roundId === 1).toBe(true);
      expect(cafe.lost).toBeGreaterThanOrEqual(prevLost);
      for (const c of [...(cafe.serving ? [cafe.serving] : []), ...cafe.waiting]) {
        expect(c.patience).toBeGreaterThanOrEqual(0);
        expect(c.patience).toBeLessThanOrEqual(1);
        expect((c.name ?? '').length).toBeLessThanOrEqual(C.maxNameLength);
        expect(c.name ?? '').not.toMatch(/[\u0000-\u001f​‮]/);
      }
      // surprises stay bounded: at most one VIP waiting, one phone order in the café, the cat within its cap
      const all = queue.waiting();
      expect(all.filter((c) => c.kind === 'vip').length).toBeLessThanOrEqual(1);
      expect(all.filter((c) => c.kind === 'phone').length + (queue.current?.kind === 'phone' ? 1 : 0)).toBeLessThanOrEqual(1);
      expect(cafe.luckyCatSec).toBeGreaterThanOrEqual(0);
      expect(cafe.luckyCatSec).toBeLessThanOrEqual(C.surprise.luckyCat.maxMs / 1000 + 0.001);
      if (all.some((c) => c.kind === 'vip') || queue.current?.kind === 'vip') sawVip = true;
      if (all.some((c) => c.kind === 'phone') || queue.current?.kind === 'phone') sawPhone = true;
      if (cafe.luckyCatSec > 0) sawCat = true;
      // one round = one customer: what is cooked is what the customer at the counter ordered
      if (s.state === 'COOKING' && prev.state === 'PREPARING') {
        expect(cafe.serving).not.toBeNull();
        expect(s.dessertNameTh).toBe(cafe.serving!.dessertNameTh);
        cookedChecks++;
      }
      // coins only drop when something is bought
      const coins = rewards.profile.coins;
      if (coins < prevCoins) expect(rewards.profile.unlocked.length).toBeGreaterThan(unlockedBefore); // coins only drop when something is bought
      unlockedBefore = rewards.profile.unlocked.length;
      prevCoins = coins;
      // count customers actually paid: the counter empties exactly once per round, at REWARDING
      const hasServing = cafe.serving !== null;
      if (wasServing && !hasServing && s.state === 'REWARDING') served++;
      wasServing = hasServing;
      prevLost = cafe.lost;
      prev = s;
    }

    // the surprises really happened during the run
    expect(sawCat, 'lucky cat').toBe(true);
    expect(sawVip, 'vip').toBe(true);
    expect(sawPhone, 'phone').toBe(true);
    expect(cookedChecks).toBeGreaterThanOrEqual(ROUNDS);
    expect(rewards.profile.rounds).toBe(ROUNDS);
    expect(served).toBe(ROUNDS); // one paid customer leaves the counter per round, never two
    expect(JSON.stringify(rewards.profile)).not.toContain(SECRET_NAME); // viewer data is never saved
    expect(JSON.stringify(rewards.profile)).not.toContain('cdn.example.com');
  });

  it('with zero viewers the café keeps serving anonymous customers for many rounds', () => {
    const queue = new CafeQueue({ maxWaiting: C.maxWaiting, patienceMs: C.patienceMs, maxNameLength: C.maxNameLength });
    const meter = new HeartMeter({ decayPerSec: CFG.vote.heartDecayPerSec, maxBoost: CFG.vote.maxBoost });
    const game = new Game(CFG, new DessertManager(ALL_DESSERTS, DEFAULT_IDS, mulberry32(2)), undefined, undefined, undefined, undefined, undefined, { queue, meter, rng: mulberry32(9) });
    game.start();
    for (let frame = 0; game.snapshot().roundsCompleted < 30; frame++) {
      expect(frame).toBeLessThan(900_000);
      game.update(16);
    }
    expect(game.snapshot().roundsCompleted).toBeGreaterThanOrEqual(30);
    expect(game.snapshot().cafe!.waitingTotal).toBeGreaterThanOrEqual(C.npcMinWaiting - 1); // anonymous customers kept the queue stocked
  });
});
