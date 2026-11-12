import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cafeConfig, type GameConfig } from '../../src/config/gameConfig';
import { CafeQueue } from '../../src/cafe/CafeQueue';
import { HeartMeter } from '../../src/cooking/HeartMeter';
import { Game } from '../../src/Game';
import { ALL_DESSERTS } from '../../src/dessert/data';
import { DessertManager } from '../../src/dessert/DessertManager';
import { RewardManager } from '../../src/reward/RewardManager';
import { defaultProfile } from '../../src/reward/types';
import { TikTokEventManager } from '../../src/tiktok/TikTokEventManager';

const ALL = ALL_DESSERTS.map((d) => d.id);
const S0 = cafeConfig.cafe.surprise;
const nameOf = (id: string) => ALL_DESSERTS.find((d) => d.id === id)!.nameTh;
let n = 0;

type SurpriseOver = { luckyCat?: Partial<typeof S0.luckyCat>; vip?: Partial<typeof S0.vip>; tip?: Partial<typeof S0.tip>; phone?: Partial<typeof S0.phone> };
function mk(over: SurpriseOver = {}, cafeOver: Partial<GameConfig['cafe']> = {}, cfgOver: Partial<GameConfig> = {}) {
  const surprise = { luckyCat: { ...S0.luckyCat, ...over.luckyCat }, vip: { ...S0.vip, ...over.vip }, tip: { ...S0.tip, ...over.tip }, phone: { ...S0.phone, ...over.phone } };
  const cfg: GameConfig = { ...cafeConfig, ...cfgOver, cafe: { ...cafeConfig.cafe, surprise, ...cafeOver } };
  const events = new TikTokEventManager(cfg);
  const rewards = new RewardManager(cfg, defaultProfile(ALL));
  let s = 3;
  const rng = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const desserts = new DessertManager(ALL_DESSERTS, ALL, rng);
  const queue = new CafeQueue({ maxWaiting: cfg.cafe.maxWaiting, patienceMs: cfg.cafe.patienceMs, maxNameLength: cfg.cafe.maxNameLength });
  const meter = new HeartMeter({ decayPerSec: cfg.vote.heartDecayPerSec, maxBoost: cfg.vote.maxBoost });
  const game = new Game(cfg, desserts, undefined, events, rewards, undefined, undefined, { queue, meter, rng });
  return { game, queue, rewards, events, cfg };
}
const follow = (g: Game, times = 1) => { for (let i = 0; i < times; i++) g.ingestEvent({ id: `fo${++n}`, type: 'follow', count: 1, tsMs: g.nowMs }); };
const heart = (g: Game, times = 1) => { for (let i = 0; i < times; i++) g.ingestEvent({ id: `oh${++n}`, type: 'orangeHeart', count: 1, tsMs: g.nowMs }); };
const gift = (g: Game, coins: number, name: string) => g.ingestEvent({ id: `g${++n}`, type: 'gift', count: 1, giftCoins: coins, displayName: name, tsMs: g.nowMs });
function runUntil(g: Game, pred: () => boolean, limit = 800_000): void {
  for (let i = 0; i < limit && !pred(); i++) g.update(16);
  expect(pred()).toBe(true);
}
const advance = (g: Game, ms: number) => { for (let t = 0; t < ms; t += 16) g.update(16); };

describe('café surprise events', () => {
  beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => vi.restoreAllMocks());

  describe('lucky cat (follow)', () => {
    it('a follow switches the lucky cat on for the configured time and it runs out', () => {
      const { game } = mk();
      game.start();
      expect(game.snapshot().cafe!.luckyCatSec).toBe(0);
      follow(game);
      game.update(16);
      expect(game.snapshot().cafe!.luckyCatSec).toBeCloseTo(S0.luckyCat.durationMs / 1000, 0);
      advance(game, S0.luckyCat.durationMs + 500);
      expect(game.snapshot().cafe!.luckyCatSec).toBe(0);
    });

    it('works in every state and stacks per follow up to the cap, however many follows arrive', () => {
      const { game } = mk();
      game.start();
      for (const st of ['PREPARING', 'COOKING', 'PRESENTING', 'REWARDING'] as const) {
        runUntil(game, () => game.snapshot().state === st);
        const before = game.snapshot().cafe!.luckyCatSec;
        follow(game);
        game.update(16);
        const expected = Math.min(S0.luckyCat.maxMs / 1000, before + S0.luckyCat.durationMs / 1000);
        expect(game.snapshot().cafe!.luckyCatSec, st).toBeGreaterThan(expected - 1); // a follow really adds its time, in every state
      }
      follow(game, 10_000);
      for (let i = 0; i < 60; i++) game.update(16); // the event queue is bounded, the cat is capped
      expect(game.snapshot().cafe!.luckyCatSec).toBeLessThanOrEqual(S0.luckyCat.maxMs / 1000);
    });

    it('pays more while it is on', () => {
      const score = (withCat: boolean): number => {
        const { game } = mk({}, { npcSpawnEveryMs: 1e9 });
        game.start();
        if (withCat) { follow(game); game.update(16); }
        runUntil(game, () => game.snapshot().state === 'REWARDING');
        return game.snapshot().reward.last!.score;
      };
      expect(score(true)).toBeGreaterThan(score(false) * 1.2);
    });

    it('makes waiting customers lose patience more slowly, but never the served one', () => {
      const patience = (withCat: boolean): number => {
        const { game } = mk({}, { npcSpawnEveryMs: 1e9 });
        game.start();
        if (withCat) { follow(game, 3); game.update(16); }
        advance(game, 8000);
        return game.snapshot().cafe!.waiting[0]!.patience;
      };
      expect(patience(true)).toBeGreaterThan(patience(false));
    });
  });

  describe('VIP + tip rain (orange heart / fan club)', () => {
    it('an orange heart sends a VIP with the 50-coin dessert, behind any gifting viewer but ahead of filler customers, and tips rain', () => {
      const { game, rewards } = mk();
      game.start();
      gift(game, 5, 'ผู้ชม');
      game.update(16);
      const coins = rewards.profile.coins;
      const waiting = game.snapshot().cafe!.waitingTotal;
      heart(game);
      game.update(16);
      const v = game.snapshot().cafe!;
      expect(v.waiting[0]).toMatchObject({ viewer: true, name: 'ผู้ชม' }); // the paying viewer keeps their turn
      expect(v.waiting[1]).toMatchObject({ kind: 'vip', viewer: false, name: null, dessertNameTh: nameOf('foi-thong') });
      expect(rewards.profile.coins - coins).toBe(Math.min(S0.tip.max, (waiting + 1) * S0.tip.perCustomer));
    });

    it('with no viewers waiting the VIP is first in line', () => {
      const { game } = mk();
      game.start();
      heart(game);
      game.update(16);
      expect(game.snapshot().cafe!.waiting[0]).toMatchObject({ kind: 'vip' });
    });

    it('a second VIP arrives once the cooldown is over and the first VIP is gone', () => {
      const { game } = mk({ vip: { cooldownMs: 2000 } }, { npcSpawnEveryMs: 1e9 });
      game.start();
      heart(game);
      game.update(16);
      runUntil(game, () => game.snapshot().state === 'REWARDING' && game.snapshot().reward.last?.dessertId === 'foi-thong');
      advance(game, 2500);
      heart(game);
      game.update(16);
      expect(game.snapshot().cafe!.waiting.some((c) => c.kind === 'vip') || game.snapshot().cafe!.serving?.kind === 'vip').toBe(true);
    });

    it('works in every state, has a cooldown, and never queues two VIPs at once', () => {
      const { game, rewards } = mk();
      game.start();
      for (const st of ['PREPARING', 'COOKING', 'PRESENTING', 'REWARDING'] as const) runUntil(game, () => game.snapshot().state === st);
      const vips = () => game.snapshot().cafe!.waiting.filter((c) => c.kind === 'vip').length;
      heart(game, 50);
      game.update(16);
      expect(vips()).toBe(1);
      const coins = rewards.profile.coins;
      heart(game, 50); // inside the cooldown
      game.update(16);
      expect(vips()).toBe(1);
      expect(rewards.profile.coins).toBe(coins); // and no second tip rain
      advance(game, S0.vip.cooldownMs + 200);
      heart(game);
      game.update(16);
      expect(vips()).toBeLessThanOrEqual(1);
    });

    it('a VIP gets in even when the queue is full of anonymous customers, but never pushes out a viewer', () => {
      const a = mk({}, { maxWaiting: 3, npcSpawnEveryMs: 1e9 });
      a.game.start();
      for (let i = 0; i < 5; i++) a.queue.enqueue({ viewer: false, dessertId: 'khao-tom-mat' });
      heart(a.game);
      a.game.update(16);
      expect(a.queue.waiting()[0]?.kind).toBe('vip');
      expect(a.queue.waiting()).toHaveLength(3);

      const b = mk({}, { maxWaiting: 3, npcSpawnEveryMs: 1e9 });
      b.game.start();
      while (b.queue.displaceAnonymous()) { /* clear the opening filler customers */ }
      for (let i = 0; i < 5; i++) b.queue.enqueue({ viewer: true, name: `v${i}`, dessertId: 'khao-tom-mat' });
      heart(b.game);
      b.game.update(16);
      expect(b.queue.waiting().some((c) => c.kind === 'vip')).toBe(false);
      expect(b.queue.waiting().every((c) => c.viewer)).toBe(true);
    });

    it('a flood of orange hearts in one tick makes exactly one VIP and one tip rain', () => {
      const { game, rewards } = mk();
      game.start();
      const coins = rewards.profile.coins;
      heart(game, 10_000);
      for (let i = 0; i < 5; i++) game.update(16);
      expect(game.snapshot().cafe!.waiting.filter((c) => c.kind === 'vip')).toHaveLength(1);
      expect(rewards.profile.coins - coins).toBeLessThanOrEqual(S0.tip.max);
    });

    it('the VIP is served, pays a bonus once, and leaves nothing behind', () => {
      const { game, rewards, queue } = mk({}, { npcSpawnEveryMs: 1e9 });
      game.start();
      heart(game);
      game.update(16);
      runUntil(game, () => game.snapshot().state === 'PREPARING' && game.snapshot().roundId === 2);
      expect(game.snapshot().cafe!.serving).toMatchObject({ kind: 'vip', dessertNameTh: nameOf('foi-thong') });
      runUntil(game, () => game.snapshot().state === 'REWARDING' && game.snapshot().roundId === 2);
      const last = game.snapshot().reward.last!;
      const base = ALL_DESSERTS.find((d) => d.id === 'foi-thong')!.reward.baseScore;
      expect(last.dessertId).toBe('foi-thong');
      expect(last.score).toBeGreaterThan(base * 1.3);
      runUntil(game, () => game.snapshot().state === 'NEXT_DESSERT');
      expect(queue.current).toBeNull();
      expect(rewards.profile.rounds).toBe(2);
    });

    it('a VIP never carries a name or picture, and nothing about the sender is stored', () => {
      const { game, rewards } = mk();
      game.start();
      game.ingestEvent({ id: 'vip1', type: 'orangeHeart', count: 1, tsMs: game.nowMs, displayName: 'Somchai', user: 'Somchai', avatarUrl: 'https://x.example/a.jpg' });
      runUntil(game, () => game.snapshot().roundsCompleted >= 2);
      const vip = game.snapshot().cafe!;
      expect(JSON.stringify(vip)).not.toContain('Somchai');
      expect(JSON.stringify(rewards.profile)).not.toContain('Somchai');
    });
  });

  describe('phone order', () => {
    const fast = { phone: { firstMs: 1000, everyMs: 6000, jitter: 0, ringMs: 600, deadlineMs: 4000 } };

    it('the phone rings, then a phone-order customer joins right behind the current one, ahead of viewers', () => {
      const { game } = mk(fast, { npcSpawnEveryMs: 1e9 });
      game.start();
      gift(game, 5, 'ผู้ชม');
      game.update(16);
      advance(game, 1100);
      expect(game.snapshot().cafe!.phoneRinging).toBe(true);
      advance(game, 800);
      const v = game.snapshot().cafe!;
      expect(v.phoneRinging).toBe(false);
      expect(v.waiting[0]).toMatchObject({ kind: 'phone', name: null });
      expect(v.waiting.findIndex((c) => c.viewer)).toBeGreaterThan(0);
    });

    it('serving it before the deadline pays +200%; a phone order that waits too long hangs up and is counted as lost', () => {
      const a = mk({ phone: { ...fast.phone, deadlineMs: 120_000, squeezeMs: 1e9 }, vip: {} }, { npcSpawnEveryMs: 1e9 });
      a.game.start();
      runUntil(a.game, () => a.game.snapshot().cafe!.waiting.some((c) => c.kind === 'phone'));
      runUntil(a.game, () => a.game.snapshot().cafe!.serving?.kind === 'phone');
      runUntil(a.game, () => a.game.snapshot().state === 'REWARDING' && a.game.snapshot().cafe!.serving === null && a.game.snapshot().reward.last !== null && a.game.snapshot().roundId >= 2);
      const phoneBase = ALL_DESSERTS.find((d) => d.id === a.game.snapshot().reward.last!.dessertId)!.reward.baseScore;
      expect(a.game.snapshot().reward.last!.score).toBeGreaterThan(phoneBase * 2.5);

      const b = mk({ phone: { ...fast.phone, deadlineMs: 1000 } }, { npcSpawnEveryMs: 1e9 }, { cooking: { baseProgressPerSec: 0.5 } });
      b.game.start();
      runUntil(b.game, () => b.game.snapshot().cafe!.lost >= 1);
      expect(b.game.snapshot().cafe!.waiting.some((c) => c.kind === 'phone')).toBe(false);
    });

    it('the ghost on the phone squeezes if the dessert is slow (fine, no bonus); tapping hearts loosens it', () => {
      const slow = { cooking: { baseProgressPerSec: 0.4 } };
      const ph = { ...fast.phone, deadlineMs: 600_000, squeezeMs: 4000, fineCoins: 5, reliefPerLike: 0.05 };
      // no taps: the squeeze fills, a fine is paid, and the ghost's bonus is lost
      const a = mk({ phone: ph, vip: {} }, { npcSpawnEveryMs: 1e9 }, slow);
      a.game.start();
      runUntil(a.game, () => a.game.snapshot().cafe!.serving?.kind === 'phone');
      a.rewards.addCoins(50);
      const coinsBefore = a.rewards.profile.coins;
      runUntil(a.game, () => (a.game.renderView().cafe?.squeezedNow ?? false) === true, 400_000);
      expect(a.rewards.profile.coins).toBeLessThan(coinsBefore);
      runUntil(a.game, () => a.game.snapshot().reward.last?.score !== undefined && a.game.snapshot().cafe!.serving?.kind !== 'phone');
      const base = ALL_DESSERTS.find((d) => d.id === a.game.snapshot().reward.last!.dessertId)!.reward.baseScore;
      expect(a.game.snapshot().reward.last!.score).toBeLessThan(base * 2.5);
      // with taps the squeeze stays low and the bonus is kept
      const b = mk({ phone: ph, vip: {} }, { npcSpawnEveryMs: 1e9 }, slow);
      b.game.start();
      runUntil(b.game, () => b.game.snapshot().cafe!.serving?.kind === 'phone');
      let max = 0;
      for (let i = 0; i < 3000 && b.game.snapshot().cafe!.serving?.kind === 'phone'; i++) {
        if (i % 10 === 0) b.game.ingestEvent({ id: `lk${++n}`, type: 'like', count: 8, tsMs: b.game.nowMs });
        b.game.update(16);
        max = Math.max(max, b.game.renderView().cafe?.squeeze ?? 0);
      }
      expect(max).toBeLessThan(1);
      expect(b.game.renderView().cafe?.squeezedNow ?? false).toBe(false);
    });

    it('each ghost visit squeezes sooner than the last (down to a floor), and being squeezed slows the cooking', () => {
      const ph = { ...fast.phone, everyMs: 3000, deadlineMs: 600_000, squeezeMs: 8000, harderPerVisit: 0.5, minSqueezeMs: 3000, reliefPerLike: 0, fineCoins: 0, squeezeSlow: 0.5 };
      const { game } = mk({ phone: ph, vip: {} }, { npcSpawnEveryMs: 1e9 }, { cooking: { baseProgressPerSec: 0.3 } });
      game.start();
      const timeToSqueeze = (): number => {
        runUntil(game, () => game.snapshot().cafe!.serving?.kind === 'phone', 2_000_000);
        const t0 = game.nowMs;
        runUntil(game, () => (game.renderView().cafe?.squeezedNow ?? false) === true, 400_000);
        const dt = game.nowMs - t0;
        runUntil(game, () => game.snapshot().cafe!.serving?.kind !== 'phone', 2_000_000);
        return dt;
      };
      const first = timeToSqueeze();
      const second = timeToSqueeze();
      const third = timeToSqueeze();
      expect(second).toBeLessThan(first - 500);
      expect(third).toBeLessThan(second - 200);
      expect(third).toBeGreaterThanOrEqual(2800); // never below the floor
    });

    it('only one phone customer at a time, and calls repeat after the interval', () => {
      const { game } = mk({ phone: { ...fast.phone, everyMs: 1500, deadlineMs: 60_000 } }, { npcSpawnEveryMs: 1e9 }, { cooking: { baseProgressPerSec: 1 } });
      game.start();
      for (let i = 0; i < 400; i++) {
        game.update(16);
        const v = game.snapshot().cafe!;
        const phones = v.waiting.filter((c) => c.kind === 'phone').length + (v.serving?.kind === 'phone' ? 1 : 0);
        expect(phones).toBeLessThanOrEqual(1);
      }
      runUntil(game, () => game.snapshot().roundsCompleted >= 3);
    });

    it('with a full queue the call replaces an anonymous customer, and is skipped only when every waiting customer is a paying viewer', () => {
      const a = mk(fast, { maxWaiting: 3, npcSpawnEveryMs: 1e9 });
      a.game.start();
      for (let i = 0; i < 5; i++) a.queue.enqueue({ viewer: false, dessertId: 'khao-tom-mat' });
      expect(a.queue.waiting()).toHaveLength(3);
      advance(a.game, 2500);
      expect(a.queue.waiting().filter((c) => c.kind === 'phone')).toHaveLength(1);
      expect(a.queue.waiting().length).toBeLessThanOrEqual(3);

      const b = mk(fast, { maxWaiting: 3, npcSpawnEveryMs: 1e9 });
      b.game.start();
      while (b.queue.displaceAnonymous()) { /* clear the opening filler customers */ }
      for (let i = 0; i < 5; i++) b.queue.enqueue({ viewer: true, name: `v${i}`, dessertId: 'khao-tom-mat' });
      advance(b.game, 2500);
      expect(b.queue.waiting().filter((c) => c.kind === 'phone')).toHaveLength(0);
      expect(b.queue.waiting()).toHaveLength(3);
    });

    it('a ring that finds the queue full of paying viewers when it ends is retried soon, not forgotten for minutes', () => {
      const { game, queue } = mk({ phone: { ...fast.phone, firstMs: 500, ringMs: 1500, everyMs: 90_000 } }, { maxWaiting: 3, npcSpawnEveryMs: 1e9 });
      game.start();
      advance(game, 700); // ringing
      expect(game.snapshot().cafe!.phoneRinging).toBe(true);
      while (queue.displaceAnonymous()) { /* viewers fill the line during the ring */ }
      for (let i = 0; i < 3; i++) queue.enqueue({ viewer: true, name: `v${i}`, dessertId: 'bua-loy' });
      advance(game, 1500);
      expect(queue.waiting().filter((c) => c.kind === 'phone')).toHaveLength(0); // no room: the call is dropped...
      while (queue.waiting().length > 0) { queue.startNext(); queue.pay(); } // ...and room appears
      advance(game, 6500);
      expect(queue.waiting().some((c) => c.kind === 'phone') || queue.current?.kind === 'phone').toBe(true); // retried within seconds
    });

    it('hostile phone settings cannot disable the phone or make it fire every frame', () => {
      const a = mk({ phone: { ...fast.phone, ringMs: 0 } }, { npcSpawnEveryMs: 1e9 });
      a.game.start();
      runUntil(a.game, () => a.game.snapshot().cafe!.waiting.some((c) => c.kind === 'phone') || a.game.snapshot().cafe!.serving?.kind === 'phone');

      const b = mk({ phone: { ...fast.phone, firstMs: 500, everyMs: NaN } }, { npcSpawnEveryMs: 1e9 });
      b.game.start();
      let rings = 0;
      let was = false;
      for (let i = 0; i < 1500; i++) {
        b.game.update(16);
        const r = b.game.snapshot().cafe!.phoneRinging;
        if (r && !was) rings++;
        was = r;
      }
      expect(rings).toBeLessThanOrEqual(6); // 24 s of play: a few calls at most, not one per frame
    });

    it('surprises do nothing before the game has started', () => {
      const { game } = mk();
      follow(game);
      heart(game);
      for (let i = 0; i < 10; i++) game.update(16);
      expect(game.snapshot().cafe!.luckyCatSec).toBe(0);
      expect(game.snapshot().cafe!.waitingTotal).toBe(0);
    });

    it('with no viewers and no events the café still runs rounds (the phone is the only surprise)', () => {
      const { game } = mk(fast);
      game.start();
      runUntil(game, () => game.snapshot().roundsCompleted >= 5);
    });
  });

  it('surprise sounds are never tagged with a round that was already cleaned up', () => {
    const played: { sound: string; roundId: number }[] = [];
    const stopped: number[] = [];
    const audio = { play: (sound: string, roundId: number) => { played.push({ sound, roundId }); return true; }, stopRound: (r: number) => { stopped.push(r); return 0; } };
    const cfg: GameConfig = { ...cafeConfig, cafe: { ...cafeConfig.cafe, surprise: { ...S0, vip: { ...S0.vip, cooldownMs: 0 } } } };
    const events = new TikTokEventManager(cfg);
    const rewards = new RewardManager(cfg, defaultProfile(ALL));
    const desserts = new DessertManager(ALL_DESSERTS, ALL, () => 0.3);
    const queue = new CafeQueue({ maxWaiting: 12, patienceMs: 70_000, maxNameLength: 16 });
    const meter = new HeartMeter({ decayPerSec: 0.1, maxBoost: 4 });
    const particles = { spawn: () => true, update() {}, clear() {}, forEach() {}, count: 0 };
    const game = new Game(cfg, desserts, { animations: { play: () => 1, isActive: () => false, update() {}, cancelRound: () => 0, activeCount: 0 }, audio, particles: particles as never }, events, rewards, undefined, undefined, { queue, meter, rng: () => 0.3 });
    game.start();
    runUntil(game, () => game.snapshot().state === 'NEXT_DESSERT');
    const before = played.length;
    follow(game);
    heart(game);
    game.update(16);
    expect(played.length).toBeGreaterThan(before);
    const cleaned = Math.max(...stopped);
    for (const p of played.slice(before)) expect(p.roundId, p.sound).toBeGreaterThan(cleaned);
  });

  it('a phone order asks for the everyday dessert (it is not a gift)', () => {
    const { game } = mk({ phone: { firstMs: 500, everyMs: 6000, jitter: 0, ringMs: 300, deadlineMs: 30_000 } }, { npcSpawnEveryMs: 1e9 });
    game.start();
    runUntil(game, () => game.snapshot().cafe!.waiting.some((c) => c.kind === 'phone'));
    expect(game.snapshot().cafe!.waiting.find((c) => c.kind === 'phone')!.dessertNameTh).toBe('ข้าวต้มมัด');
  });
});

describe('forced ghost kind (test shortcut)', () => {
  it('callGhostNow(type) makes the next ghost look like that kind, and squeezeNow only works while a ghost is served', () => {
    const { game } = mk({}, { npcSpawnEveryMs: 1e9 });
    game.start();
    expect(game.squeezeNow()).toBe(false);
    expect(game.callGhostNow(3)).toBe(true);
    expect(game.callGhostNow(1)).toBe(false); // already ringing
    const all = () => { const c = game.snapshot().cafe!; return [...c.waiting, ...(c.serving ? [c.serving] : [])]; };
    runUntil(game, () => all().some((c) => c.kind === 'phone'));
    const ghost = all().find((c) => c.kind === 'phone')!;
    expect(ghost.seed % 5).toBe(3);
    runUntil(game, () => game.snapshot().cafe!.serving?.kind === 'phone');
    runUntil(game, () => game.snapshot().state === 'COOKING');
    expect(game.squeezeNow()).toBe(true);
  });
});

describe('shaman (share)', () => {
  it('a share with a ghost around calls the shaman: he splashes holy water, the ghost is calmed (no squeeze, no fine); without a ghost nothing happens', () => {
    const slow = { cooking: { baseProgressPerSec: 0.3 } };
    const ph = { firstMs: 1e12, everyMs: 1e12, jitter: 0, ringMs: 600, deadlineMs: 600_000, squeezeMs: 3000, fineCoins: 5, reliefPerLike: 0, harderPerVisit: 0, minSqueezeMs: 1000, squeezeSlow: 0 };
    const { game, rewards } = mk({ phone: ph, vip: {} }, { npcSpawnEveryMs: 1e9 }, slow);
    game.start();
    expect(game.callShaman()).toBe(false); // no ghost yet: a share does not call him
    expect(game.callGhostNow()).toBe(true);
    runUntil(game, () => game.snapshot().cafe!.serving?.kind === 'phone');
    runUntil(game, () => game.snapshot().state === 'COOKING');
    rewards.addCoins(40);
    const coins = rewards.profile.coins;
    const r = game.ingestEvent({ id: `sh${++n}`, type: 'share', count: 1, tsMs: game.nowMs });
    game.update(16);
    expect(r).toBe('queued');
    game.update(16);
    expect((game.renderView().cafe?.shaman ?? 0)).toBeGreaterThan(0);
    runUntil(game, () => game.renderView().cafe?.ghostCalm === true, 100_000);
    expect(game.callShaman()).toBe(false); // already calm this visit
    for (let i = 0; i < 1200 && game.snapshot().cafe!.serving?.kind === 'phone'; i++) game.update(16); // far longer than squeezeMs
    expect(game.renderView().cafe?.squeezedNow ?? false).toBe(false);
    expect(rewards.profile.coins).toBeGreaterThanOrEqual(coins);
  });
});

describe('shaman test key', () => {
  it('callShaman(true) brings him even with no ghost, and he does not come twice at once', () => {
    const { game } = mk({}, { npcSpawnEveryMs: 1e9 });
    game.start();
    expect(game.callShaman(true)).toBe(true);
    expect(game.callShaman(true)).toBe(false);
    for (let i = 0; i < 100; i++) game.update(16);
    expect(game.renderView().cafe?.shaman ?? 0).toBeGreaterThan(0);
    expect(game.renderView().cafe?.ghostCalm ?? false).toBe(false);
  });
});

describe('shaman quota from shares', () => {
  it('each share saves a shaman visit (shown on screen, capped); the next ghost uses one automatically', () => {
    const ph = { firstMs: 1e12, everyMs: 1e12, jitter: 0, ringMs: 600, deadlineMs: 600_000, squeezeMs: 60_000, fineCoins: 0, reliefPerLike: 0, harderPerVisit: 0, minSqueezeMs: 1000, squeezeSlow: 0 };
    const { game } = mk({ phone: ph, vip: {} }, { npcSpawnEveryMs: 1e9 });
    game.start();
    expect(game.renderView().cafe?.shamanQuota).toBe(0);
    const share = () => { game.ingestEvent({ id: `sq${++n}`, type: 'share', count: 1, tsMs: game.nowMs }); advance(game, 6000); };
    share();
    expect(game.renderView().cafe?.shamanQuota).toBe(1); // no ghost: saved, shaman does not come
    expect(game.renderView().cafe?.shaman ?? 0).toBe(0);
    for (let i = 0; i < 8; i++) share();
    expect(game.renderView().cafe?.shamanQuota).toBeLessThanOrEqual(5);
    expect(game.callGhostNow()).toBe(true);
    runUntil(game, () => game.renderView().cafe?.ghostCalm === true, 600_000);
    expect(game.renderView().cafe?.shamanQuota).toBeLessThan(5); // one was used
  });
});
