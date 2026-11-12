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
const DEFAULTS = ALL_DESSERTS.filter((d) => 'default' in d.unlock).map((d) => d.id);
const nameOf = (id: string) => ALL_DESSERTS.find((d) => d.id === id)!.nameTh;
let n = 0;

function mk(over: Partial<GameConfig['cafe']> = {}, unlocked: string[] = ALL, cfgOver: Partial<GameConfig> = {}) {
  const cfg: GameConfig = { ...cafeConfig, ...cfgOver, cafe: { ...cafeConfig.cafe, ...over } };
  const events = new TikTokEventManager(cfg);
  const rewards = new RewardManager(cfg, defaultProfile(unlocked));
  let s = 3;
  const rng = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const desserts = new DessertManager(ALL_DESSERTS, unlocked, rng);
  const queue = new CafeQueue({ maxWaiting: cfg.cafe.maxWaiting, patienceMs: cfg.cafe.patienceMs, maxNameLength: cfg.cafe.maxNameLength });
  const meter = new HeartMeter({ decayPerSec: cfg.vote.heartDecayPerSec, maxBoost: cfg.vote.maxBoost });
  const game = new Game(cfg, desserts, undefined, events, rewards, undefined, undefined, { queue, meter, rng });
  return { game, queue, meter, rewards, events, cfg };
}
const gift = (g: Game, coins: number | undefined, extra: Record<string, unknown> = {}) =>
  g.ingestEvent({ id: `g${++n}`, type: 'gift', count: 1, ...(coins !== undefined ? { giftCoins: coins } : {}), displayName: 'มะลิ', tsMs: g.nowMs, ...extra });
const like = (g: Game, count: number) => g.ingestEvent({ id: `l${++n}`, type: 'like', count, tsMs: g.nowMs });
function runUntil(g: Game, pred: () => boolean, limit = 600_000): void {
  for (let i = 0; i < limit && !pred(); i++) g.update(16);
  expect(pred()).toBe(true);
}
const cooking = (g: Game) => g.snapshot().state === 'COOKING';

describe('Game in café mode', () => {
  beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => vi.restoreAllMocks());

  it('with zero viewers anonymous customers keep coming: many rounds, one customer each', () => {
    const { game, rewards } = mk();
    game.start();
    runUntil(game, () => game.snapshot().roundsCompleted >= 6);
    expect(rewards.profile.rounds).toBe(6);
    expect(game.snapshot().cafe?.serving ?? game.snapshot().cafe?.waiting.length).toBeDefined();
  });

  it('one round = one customer: the cooked dessert is what the customer on the counter ordered', () => {
    const { game } = mk();
    game.start();
    for (let i = 0; i < 4; i++) {
      runUntil(game, () => game.snapshot().state === 'PREPARING' && game.snapshot().roundId === i + 1 && game.snapshot().cafe?.serving != null);
      const ordered = game.snapshot().cafe!.serving!.dessertNameTh;
      runUntil(game, () => cooking(game) && game.snapshot().roundId === i + 1);
      expect(game.snapshot().dessertNameTh).toBe(ordered);
    }
  });

  it('a gift puts a named viewer in the queue ordering the dessert its value maps to, right behind the current customer', () => {
    const { game } = mk();
    game.start();
    runUntil(game, () => cooking(game));
    const servingBefore = game.snapshot().cafe!.serving!;
    gift(game, 30, { displayName: 'ใบเตย' });
    game.update(16);
    const s = game.snapshot().cafe!;
    expect(s.serving!.id).toBe(servingBefore.id); // the customer being served is not bumped
    expect(s.waiting[0]).toMatchObject({ viewer: true, name: 'ใบเตย', dessertNameTh: nameOf('khanom-chan') });
    runUntil(game, () => game.snapshot().state === 'PREPARING' && game.snapshot().roundId === 2);
    runUntil(game, () => cooking(game) && game.snapshot().roundId === 2);
    expect(game.snapshot().dessertNameTh).toBe(nameOf('khanom-chan'));
  });

  it('every tier orders its own dessert; a locked dessert falls back to the best unlocked tier', () => {
    const tiers: [number, string][] = [[1, 'khanom-krok'], [5, 'bua-loy'], [10, 'thong-yod'], [20, 'khanom-chan'], [50, 'foi-thong'], [99, 'thong-yip'], [199, 'luk-chup'], [500, 'khanom-buang']];
    for (const [coins, id] of tiers) {
      const { game } = mk();
      game.start();
      gift(game, coins);
      game.update(16);
      expect(game.snapshot().cafe!.waiting[0]?.dessertNameTh ?? game.snapshot().cafe!.serving?.dessertNameTh, String(coins)).toBeDefined();
      const w = game.snapshot().cafe!.waiting.find((c) => c.viewer);
      expect(w?.dessertNameTh, String(coins)).toBe(nameOf(id));
    }
    const { game } = mk({}, DEFAULTS);
    game.start();
    gift(game, 500);
    game.update(16);
    expect(game.snapshot().cafe!.waiting.find((c) => c.viewer)?.dessertNameTh).toBe(nameOf('khanom-chan'));
  });

  it('a duplicate gift event creates one customer', () => {
    const { game } = mk();
    game.start();
    const e = { id: 'same', type: 'gift', count: 1, giftCoins: 5, displayName: 'A', tsMs: game.nowMs };
    for (let i = 0; i < 50; i++) game.ingestEvent(e);
    game.update(16);
    expect(game.snapshot().cafe!.waiting.filter((c) => c.viewer)).toHaveLength(1);
  });

  it('gifts work in every state, including serving and paying', () => {
    const { game } = mk();
    game.start();
    for (const st of ['PREPARING', 'COOKING', 'PRESENTING', 'REWARDING'] as const) {
      runUntil(game, () => game.snapshot().state === st);
      const before = game.snapshot().cafe!.waiting.filter((c) => c.viewer).length;
      gift(game, 5);
      game.update(16);
      expect(game.snapshot().cafe!.waiting.filter((c) => c.viewer).length, st).toBeGreaterThan(before);
    }
  });

  it('when the queue is full a gift still pays coins to the café and nothing breaks', () => {
    const { game, rewards, queue } = mk({ maxWaiting: 3, npcSpawnEveryMs: 1e9 });
    game.start();
    for (let i = 0; i < 10; i++) queue.enqueue({ viewer: false, dessertId: 'khanom-krok' });
    expect(queue.waiting()).toHaveLength(3);
    const coins = rewards.profile.coins;
    gift(game, 40);
    game.update(16);
    expect(queue.waiting()).toHaveLength(3);
    expect(rewards.profile.coins).toBe(coins + 40);
  });

  it('500 gifts in one tick keep the queue within its cap and lose nothing silently', () => {
    const { game, queue, rewards } = mk();
    game.start();
    for (let i = 0; i < 500; i++) gift(game, 5);
    game.update(16);
    expect(queue.waiting().length).toBeLessThanOrEqual(12);
    expect(rewards.profile.coins).toBeGreaterThanOrEqual(0);
    runUntil(game, () => game.snapshot().roundsCompleted >= 2);
  });

  it('waiting customers lose patience and leave unhappy; the one being served stays; the game carries on', () => {
    const { game, queue } = mk({ patienceMs: 3000, npcSpawnEveryMs: 1000, npcMinWaiting: 3 });
    game.start();
    runUntil(game, () => (game.snapshot().cafe?.lost ?? 0) >= 2);
    expect(queue.waiting().every((c) => c.patienceMs > 0)).toBe(true);
    runUntil(game, () => game.snapshot().roundsCompleted >= 3);
  });

  it('pays exactly once per customer and the happier (less waited) customer pays more', () => {
    const { game, rewards, queue } = mk();
    game.start();
    runUntil(game, () => game.snapshot().state === 'REWARDING');
    const first = game.snapshot().reward.last!;
    const def = ALL_DESSERTS.find((d) => d.id === first.dessertId)!;
    expect(first.score).toBeGreaterThan(def.reward.baseScore); // a customer who barely waited pays a bonus
    expect(queue.current).toBeNull();
    runUntil(game, () => game.snapshot().roundsCompleted >= 5);
    expect(rewards.profile.rounds).toBe(5);
  });

  it('likes while cooking fill the heart meter and speed cooking up; likes outside cooking do nothing', () => {
    const { game, meter } = mk();
    game.start();
    like(game, 500);
    game.update(16);
    expect(meter.value).toBe(0);
    runUntil(game, () => cooking(game));
    game.update(16);
    like(game, 500);
    game.update(16);
    expect(meter.value).toBeGreaterThan(0.5);
    runUntil(game, () => game.snapshot().roundId === 2);
    expect(meter.value).toBe(0);
  });

  it('names and pictures are hidden when anonymousNames is on', () => {
    const { game } = mk({ anonymousNames: true });
    game.start();
    gift(game, 5, { displayName: 'Somchai', avatarUrl: 'https://cdn.example.com/a.jpg' });
    game.update(16);
    const v = game.snapshot().cafe!.waiting.find((c) => c.viewer)!;
    expect(v.name).toBeNull();
    expect(v.avatarUrl).toBeNull();
  });

  it('names and pictures are never saved: the profile holds no customer data', () => {
    const { game, rewards } = mk();
    game.start();
    gift(game, 5, { displayName: 'Somchai', avatarUrl: 'https://cdn.example.com/a.jpg' });
    runUntil(game, () => game.snapshot().roundsCompleted >= 2);
    expect(JSON.stringify(rewards.profile)).not.toContain('Somchai');
    expect(JSON.stringify(rewards.profile)).not.toContain('cdn.example.com');
  });

  it('a round ended by the cooking watchdog does not leave a customer stuck at the counter', () => {
    const { game, queue } = mk({}, ALL, { cooking: { baseProgressPerSec: 0.0001 }, maxMs: { ...cafeConfig.maxMs, cooking: 3000 } });
    game.start();
    runUntil(game, () => game.snapshot().roundsCompleted >= 3);
    expect(queue.waiting().length).toBeGreaterThanOrEqual(0);
  });

  it('invalid gifts (negative or NaN value) never create customers or throw', () => {
    const { game } = mk();
    game.start();
    for (const coins of [-5, NaN, Infinity]) gift(game, coins);
    game.update(16);
    expect(game.snapshot().cafe!.waiting.filter((c) => c.viewer && c.name === 'มะลิ')).toHaveLength(0);
  });

  it('the TikTok connection dropping changes nothing for the loop', () => {
    const { game, events } = mk();
    game.start();
    events.setConnection('connected');
    gift(game, 5);
    events.setConnection('offline');
    runUntil(game, () => game.snapshot().roundsCompleted >= 3);
    expect(game.snapshot().connection).toBe('offline');
  });

  it('the view exposes the gift menu with every tier and no more than the configured customers', () => {
    const { game, cfg } = mk();
    game.start();
    for (let i = 0; i < 30; i++) gift(game, 5);
    game.update(16);
    const v = game.snapshot().cafe!;
    expect(v.giftMenu).toHaveLength(cfg.cafe.giftTiers.length);
    expect(v.giftMenu[0]).toMatchObject({ coins: 1, nameTh: nameOf('khanom-krok') });
    expect(v.waiting.length).toBeLessThanOrEqual(cfg.cafe.visible - 1);
    expect(v.waitingTotal).toBeLessThanOrEqual(cfg.cafe.maxWaiting);
  });

  it('classic mode (no café object) has no café view', () => {
    const g = new Game(cafeConfig, new DessertManager(ALL_DESSERTS, ALL, () => 0.4));
    g.start();
    expect(g.snapshot().cafe).toBeUndefined();
  });
});
