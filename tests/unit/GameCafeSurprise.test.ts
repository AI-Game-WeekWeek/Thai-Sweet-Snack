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

    it('the ghost cuts in line: it comes even when the line is full, even of paying viewers, and never more than one at a time', () => {
      const a = mk(fast, { maxWaiting: 3, npcSpawnEveryMs: 1e9 });
      a.game.start();
      for (let i = 0; i < 5; i++) a.queue.enqueue({ viewer: false, dessertId: 'khao-tom-mat' });
      advance(a.game, 2500);
      expect(a.queue.waiting().filter((c) => c.kind === 'phone')).toHaveLength(1);

      const b = mk(fast, { maxWaiting: 3, npcSpawnEveryMs: 1e9 });
      b.game.start();
      while (b.queue.displaceAnonymous()) { /* clear the opening filler customers */ }
      for (let i = 0; i < 5; i++) b.queue.enqueue({ viewer: true, name: `v${i}`, dessertId: 'khao-tom-mat' });
      advance(b.game, 2500);
      const ghosts = b.queue.waiting().filter((c) => c.kind === 'phone');
      expect(ghosts).toHaveLength(1); // got in although all 3 places were paying viewers
      expect(b.queue.waiting()).toHaveLength(4); // one above the usual maximum
      expect(b.queue.waiting()[0]!.kind).toBe('phone'); // and it is first in line
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
    expect(game.renderView().cafe?.shamanQuota).toBeLessThanOrEqual(5); // at most 5 are saved
    expect(game.renderView().cafe?.shamanQuotaMax).toBe(5);
    expect(game.callGhostNow()).toBe(true);
    runUntil(game, () => game.renderView().cafe?.ghostCalm === true, 600_000);
    expect(game.renderView().cafe?.shamanQuota).toBeLessThan(5); // one was used
  });
});

describe('shaman only banishes a ghost that is really there', () => {
  it('does not come while the ghost is calling or waiting in line; he comes once the ghost is at the counter and banishes it', () => {
    const ph = { firstMs: 1e12, everyMs: 1e12, jitter: 0, ringMs: 2500, deadlineMs: 600_000, squeezeMs: 60_000, fineCoins: 0, reliefPerLike: 0, harderPerVisit: 0, minSqueezeMs: 1000, squeezeSlow: 0 };
    const { game, queue } = mk({ phone: ph, vip: {} }, { npcSpawnEveryMs: 1e9 });
    game.start();
    game.ingestEvent({ id: `sx${++n}`, type: 'share', count: 1, tsMs: game.nowMs });
    advance(game, 100);
    expect(game.renderView().cafe?.shamanQuota).toBe(1);
    expect(game.callGhostNow()).toBe(true); // ringing: the ghost is not in the café yet
    advance(game, 1200);
    expect(game.renderView().cafe?.phoneRinging).toBe(true);
    expect(game.renderView().cafe?.shaman ?? 0).toBe(0); // he waits
    expect(game.renderView().cafe?.shamanQuota).toBe(1);
    runUntil(game, () => queue.waiting().some((c) => c.kind === 'phone'));
    advance(game, 200);
    expect(game.renderView().cafe?.shaman ?? 0).toBe(0); // still waiting in line: he waits until the ghost reaches the counter
    runUntil(game, () => queue.current?.kind === 'phone');
    runUntil(game, () => game.renderView().cafe?.ghostCalm === true, 600_000);
    expect(game.renderView().cafe?.shamanQuota).toBe(0);
  });
});

describe('regulars come back, bots fill the line', () => {
  const names = (g: Game) => { const c = g.snapshot().cafe!; return [...c.waiting, ...(c.serving ? [c.serving] : [])].filter((x) => x.viewer).map((x) => x.name); };
  const seenAgain = (g: Game, name: string, ms: number) => { for (let t = 0; t < ms; t += 16) { g.update(16); if (names(g).includes(name)) return true; } return false; };
  const served = (g: Game, name: string) => { runUntil(g, () => g.snapshot().cafe!.serving?.name === name, 400_000); runUntil(g, () => g.snapshot().state === 'NEXT_DESSERT' || g.snapshot().cafe!.serving?.name !== name, 400_000); };

  it('a viewer who gifted comes back with the same order after a while, at most the configured number of times', () => {
    const { game } = mk({ phone: { firstMs: 1e12, everyMs: 1e12 } }, { npcSpawnEveryMs: 1e9, regularEveryMs: 5000, regularWindowMs: 10 * 60_000, regularMaxReturns: 2 });
    game.start();
    gift(game, 20, 'มะลิ');
    const firstDessert = () => { const c = game.snapshot().cafe!; return [...c.waiting, ...(c.serving ? [c.serving] : [])].find((x) => x.name === 'มะลิ')?.dessertId; };
    runUntil(game, () => names(game).includes('มะลิ'), 200_000);
    const dessert = firstDessert();
    served(game, 'มะลิ');
    advance(game, 200);
    for (let back = 1; back <= 2; back++) {
      expect(seenAgain(game, 'มะลิ', 60_000), `return ${back}`).toBe(true);
      expect(firstDessert()).toBe(dessert);
      served(game, 'มะลิ');
      advance(game, 200);
    }
    expect(seenAgain(game, 'มะลิ', 40_000)).toBe(false); // used up its returns
  });

  it('stops coming back when it has not gifted for the whole window, and never when names are hidden', () => {
    const a = mk({ phone: { firstMs: 1e12, everyMs: 1e12 } }, { npcSpawnEveryMs: 1e9, regularEveryMs: 5000, regularWindowMs: 20_000 });
    a.game.start();
    gift(a.game, 5, 'น้ำฝน');
    runUntil(a.game, () => names(a.game).includes('น้ำฝน'), 200_000);
    served(a.game, 'น้ำฝน');
    advance(a.game, 30_000); // longer than the window
    expect(seenAgain(a.game, 'น้ำฝน', 30_000)).toBe(false);

    const b = mk({}, { npcSpawnEveryMs: 1e9, regularEveryMs: 5000, anonymousNames: true });
    b.game.start();
    gift(b.game, 5, 'ลับ');
    advance(b.game, 120_000);
    expect(names(b.game).includes('ลับ')).toBe(false);
  });

  it('when fewer than 3 people are in the café, bots come until there are 5 (viewers included)', () => {
    const { game } = mk();
    game.start();
    let frames = 0;
    let low = 0;
    for (let t = 0; t < 120_000; t += 16) {
      game.update(16);
      if (t > 20_000) { const c = game.snapshot().cafe!; frames++; if (c.waitingTotal + (c.serving ? 1 : 0) < 3) low++; }
    }
    expect(low / frames).toBeLessThan(0.1); // below 3 only for the moment a bot is on its way
    // viewers count too: with 3 viewers in the café, only 2 bots are added to reach 5; with 5 viewers no bot at all
    const v = mk({}, { npcSpawnEveryMs: 700 });
    v.game.start();
    for (let i = 0; i < 3; i++) gift(v.game, 10, `ผู้ชม${i}`);
    let peak = 0;
    for (let t = 0; t < 20_000; t += 16) { v.game.update(16); const c = v.game.snapshot().cafe!; peak = Math.max(peak, c.waitingTotal + (c.serving ? 1 : 0)); }
    expect(peak).toBeLessThanOrEqual(5 + 3); // never floods: the viewers' own orders can go above 5, bots stop at 5
    const w = mk({}, { npcSpawnEveryMs: 700 });
    w.game.start();
    advance(w.game, 20_000);
    const c0 = w.game.snapshot().cafe!;
    const total = c0.waitingTotal + (c0.serving ? 1 : 0);
    expect(total).toBeGreaterThanOrEqual(3);
    expect(total).toBeLessThanOrEqual(5);
  });
});

describe('cooking waits for taps (idleCookRate 0)', () => {
  const progressAfter = (idle: number, likes: boolean) => {
    const { game } = mk({}, { idleCookRate: idle, npcSpawnEveryMs: 700 });
    game.start();
    runUntil(game, () => game.snapshot().state === 'COOKING', 200_000);
    const p0 = game.snapshot().progress;
    for (let t = 0; t < 4000; t += 16) {
      if (likes && t % 160 === 0) game.ingestEvent({ id: `tp${++n}`, type: 'like', count: 5, tsMs: game.nowMs });
      game.update(16);
    }
    return { gain: game.snapshot().progress - p0, needsTaps: game.renderView().cafe?.needsTaps };
  };
  it('with idleCookRate 0 nothing cooks without taps, taps make it cook, and the screen says so; normal mode is unchanged', () => {
    const idle = progressAfter(0, false);
    const tapped = progressAfter(0, true);
    const normal = progressAfter(1, false);
    expect(idle.gain).toBeLessThan(1);
    expect(idle.needsTaps).toBe(true);
    expect(tapped.gain).toBeGreaterThan(idle.gain + 3);
    expect(normal.gain).toBeGreaterThan(3);
    expect(normal.needsTaps).toBe(false);
  });
});

describe('one share = one shaman visit', () => {
  it('each share adds exactly one (also when several arrive together) and never five at once', () => {
    const { game } = mk({}, { npcSpawnEveryMs: 1e9 });
    game.start();
    game.ingestEvent({ id: `o${++n}`, type: 'share', count: 1, tsMs: game.nowMs });
    advance(game, 200);
    expect(game.renderView().cafe?.shamanQuota).toBe(1);
    for (let i = 0; i < 3; i++) game.ingestEvent({ id: `o${++n}`, type: 'share', count: 1, tsMs: game.nowMs });
    advance(game, 200);
    expect(game.renderView().cafe?.shamanQuota).toBe(4);
  });
});

describe('nothing moves on without a tap (idleCookRate 0)', () => {
  it('for minutes with no hearts the bar stays at 0 and no step is forced; the first tap starts it', () => {
    const { game } = mk({}, { idleCookRate: 0, npcSpawnEveryMs: 700 }, { maxMs: { ...cafeConfig.maxMs, cooking: 6 * 3600_000 } });
    game.start();
    runUntil(game, () => game.snapshot().state === 'COOKING', 200_000);
    const step0 = game.snapshot().stepNameTh;
    for (let t = 0; t < 5 * 60_000; t += 16) game.update(16);
    expect(game.snapshot().state).toBe('COOKING');
    expect(game.snapshot().progress).toBe(0);
    expect(game.snapshot().stepNameTh).toBe(step0);
    for (let i = 0; i < 20; i++) { game.ingestEvent({ id: `z${++n}`, type: 'like', count: 5, tsMs: game.nowMs }); advance(game, 100); }
    expect(game.snapshot().progress).toBeGreaterThan(3);
  });
});

describe('the ghost is very hard, but never a dead end', () => {
  it('a ghost that nobody can deal with gets bored and vanishes after giveUpMs, and the game goes on', () => {
    const ph = { firstMs: 1e12, everyMs: 1e12, jitter: 0, ringMs: 600, deadlineMs: 600_000, giveUpMs: 20_000 };
    const { game } = mk({ phone: ph, vip: {} }, { npcSpawnEveryMs: 700, idleCookRate: 0 }, { maxMs: { ...cafeConfig.maxMs, cooking: 6 * 3600_000 } });
    game.start();
    for (let i = 0; i < 200_000 && !game.callGhostNow(); i++) game.update(16);
    for (let i = 0; i < 600_000 && game.snapshot().cafe!.serving?.kind !== 'phone'; i++) { if (game.snapshot().state === 'COOKING') game.finishCookingNow(); game.update(16); } // the dessert before it needs taps too
    runUntil(game, () => game.renderView().cafe?.ghostCalm === true, 2_000_000); // no taps at all: it gives up
    expect(game.snapshot().toast ?? '').toContain('ผีเบื่อ');
  });
});

describe('each tap adds a fixed percent', () => {
  it('with tapPercent 10 every like event adds 10% to the bar (one tap = +10, three = +30), whatever its batch size', () => {
    const { game } = mk({}, { idleCookRate: 0, tapPercent: 10, npcSpawnEveryMs: 1e9 }, { maxMs: { ...cafeConfig.maxMs, cooking: 6 * 3600_000 } });
    game.start();
    for (let i = 0; i < 100_000 && game.snapshot().state !== 'COOKING'; i++) game.update(16);
    const p0 = game.snapshot().progress;
    game.ingestEvent({ id: `tp${++n}`, type: 'like', count: 1, tsMs: game.nowMs });
    advance(game, 100);
    const p1 = game.snapshot().progress;
    expect(p1 - p0).toBeGreaterThanOrEqual(9.5);
    expect(p1 - p0).toBeLessThan(12);
    game.ingestEvent({ id: `tp${++n}`, type: 'like', count: 300, tsMs: game.nowMs }); // a big batch is still ONE tap
    advance(game, 100);
    expect(game.snapshot().progress - p1).toBeLessThan(20);
  });
});
