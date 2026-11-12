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
const cfgCoins = () => cafeConfig.cafe.overflowGiftCoins;
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
    const tiers: [number, string][] = [[1, 'khao-tom-mat'], [5, 'bua-loy'], [10, 'thong-yod'], [20, 'khanom-chan'], [50, 'foi-thong'], [99, 'thong-yip'], [199, 'luk-chup'], [500, 'khanom-buang']];
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
    for (let i = 0; i < 10; i++) queue.enqueue({ viewer: false, dessertId: 'khao-tom-mat' });
    expect(queue.waiting()).toHaveLength(3);
    const coins = rewards.profile.coins;
    gift(game, 40);
    game.update(16);
    expect(queue.waiting()).toHaveLength(3);
    expect(rewards.profile.coins).toBe(coins + cfgCoins()); // a small flat thank-you, not the gift's face value
  });

  it('500 gifts at once keep the queue within its cap; every gift becomes a customer or a small café payment', () => {
    const { game, queue, rewards } = mk({ npcSpawnEveryMs: 1e9 });
    game.start();
    const coins0 = rewards.profile.coins;
    for (let i = 0; i < 500; i++) gift(game, 5);
    for (let i = 0; i < 40; i++) game.update(16); // the per-tick cap spreads them over a few ticks
    expect(queue.waiting().length).toBeLessThanOrEqual(12);
    const overflowPaid = (rewards.profile.coins - coins0) / cfgCoins();
    // 500 gifts: at most 12 fit in the queue, all the rest paid the flat amount
    expect(overflowPaid).toBeGreaterThanOrEqual(500 - 12 - 1);
    expect(overflowPaid).toBeLessThanOrEqual(500);
    runUntil(game, () => game.snapshot().roundsCompleted >= 2);
  });

  it('overflow gifts can never inflate the economy: coins from a flood stay far below the face value', () => {
    const { game, rewards } = mk();
    game.start();
    const coins0 = rewards.profile.coins;
    for (let i = 0; i < 300; i++) gift(game, 500);
    for (let i = 0; i < 30; i++) game.update(16);
    expect(rewards.profile.coins - coins0).toBeLessThanOrEqual(300 * cfgCoins());
  });

  it('viewers who gift in turn are served in that order', () => {
    const { game } = mk({ npcSpawnEveryMs: 1e9 });
    game.start();
    runUntil(game, () => cooking(game));
    gift(game, 5, { displayName: 'ก่อน' });
    game.update(16);
    gift(game, 5, { displayName: 'หลัง' });
    game.update(16);
    expect(game.snapshot().cafe!.waiting.filter((c) => c.viewer).map((c) => c.name)).toEqual(['ก่อน', 'หลัง']);
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
    const { game, queue, rewards } = mk({}, ALL, { cooking: { baseProgressPerSec: 0.0001 }, maxMs: { ...cafeConfig.maxMs, cooking: 3000 } });
    game.start();
    runUntil(game, () => game.snapshot().roundsCompleted >= 3);
    runUntil(game, () => game.snapshot().state === 'NEXT_DESSERT');
    expect(queue.current).toBeNull(); // nobody left standing at the counter
    expect(rewards.profile.rounds).toBeGreaterThanOrEqual(3); // each forced round still paid its customer once
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
    expect(v.giftMenu[0]).toMatchObject({ coins: 1, nameTh: nameOf('khao-tom-mat') });
    expect(v.waiting.length).toBeLessThanOrEqual(cfg.cafe.visible - 1);
    expect(v.waitingTotal).toBeLessThanOrEqual(cfg.cafe.maxWaiting);
  });

  it('classic mode (no café object) has no café view', () => {
    const g = new Game(cafeConfig, new DessertManager(ALL_DESSERTS, ALL, () => 0.4));
    g.start();
    expect(g.snapshot().cafe).toBeUndefined();
  });

  it('the first customer arrives with a visible queue behind them (not an empty shop)', () => {
    const { game, cfg } = mk();
    game.start();
    expect(game.snapshot().cafe!.serving).not.toBeNull();
    expect(game.snapshot().cafe!.waitingTotal).toBeGreaterThanOrEqual(cfg.cafe.npcMinWaiting);
  });

  it('with no gifts every anonymous customer orders ข้าวต้มมัด and nothing else is ever cooked', () => {
    const { game } = mk({ npcSpawnEveryMs: 1500 }, ALL, { ...{} });
    game.start();
    const cooked = new Set<string>();
    for (let round = 1; round <= 8; round++) {
      runUntil(game, () => cooking(game) && game.snapshot().roundId === round);
      cooked.add(game.snapshot().dessertNameTh!);
      const v = game.snapshot().cafe!;
      for (const c of [...(v.serving ? [v.serving] : []), ...v.waiting]) expect(c.dessertNameTh).toBe('ข้าวต้มมัด');
    }
    expect([...cooked]).toEqual(['ข้าวต้มมัด']);
  });

  it('gifts still order the other desserts, so those only ever appear because a viewer paid for them', () => {
    const { game } = mk();
    game.start();
    gift(game, 20, { displayName: 'ลูกค้าจ่าย' });
    game.update(16);
    const ordered = game.snapshot().cafe!.waiting.filter((c) => c.viewer).map((c) => c.dessertNameTh);
    expect(ordered).toEqual([nameOf('khanom-chan')]);
    const anonymous = game.snapshot().cafe!.waiting.filter((c) => !c.viewer);
    for (const c of anonymous) expect(c.dessertNameTh).toBe('ข้าวต้มมัด');
  });

  it('the default dessert is always unlocked, even on a save from before it existed', () => {
    const { game } = mk({}, ['bua-loy']); // the café must still open if the default is somehow locked
    game.start();
    expect(() => runUntil(game, () => game.snapshot().roundsCompleted >= 2)).not.toThrow();
  });

  it('ข้าวต้มมัด is presented as 3 separate wrapped parcels; every other dessert keeps the round pieces', () => {
    const { game } = mk({ npcSpawnEveryMs: 1e9 });
    game.start();
    runUntil(game, () => game.snapshot().state === 'PRESENTING');
    expect(game.snapshot().dessertNameTh).toBe('ข้าวต้มมัด');
    expect(game.renderView()).toMatchObject({ pieceStyle: 'parcel', piecesCount: 3 });

    const other = mk({ npcSpawnEveryMs: 1e9 });
    other.game.start();
    gift(other.game, 5, { displayName: 'จ่าย' }); // บัวลอย
    other.game.update(16);
    runUntil(other.game, () => other.game.snapshot().roundId === 2 && other.game.snapshot().state === 'PRESENTING');
    expect(other.game.snapshot().dessertNameTh).toBe(nameOf('bua-loy'));
    expect(other.game.renderView()).toMatchObject({ pieceStyle: 'round', piecesCount: 8 });
  });

  it('every gifting viewer is served the dessert they paid for, separately from the other viewers', () => {
    const noPhone = { ...cafeConfig.cafe.surprise, phone: { ...cafeConfig.cafe.surprise.phone, firstMs: 1e12 } }; // keep the random phone call out of this test
    const { game } = mk({ npcSpawnEveryMs: 1e9, surprise: noPhone });
    game.start();
    runUntil(game, () => cooking(game));
    gift(game, 20, { displayName: 'ก้อย' });   // ขนมชั้น
    gift(game, 199, { displayName: 'เบิร์ด' }); // ลูกชุบ
    gift(game, 5, { displayName: 'ฝน' });      // บัวลอย
    game.update(16);
    const queued = game.snapshot().cafe!.waiting.filter((c) => c.viewer).map((c) => `${c.name}:${c.dessertNameTh}`);
    expect(queued).toEqual([`ก้อย:${nameOf('khanom-chan')}`, `เบิร์ด:${nameOf('luk-chup')}`, `ฝน:${nameOf('bua-loy')}`]);

    // each one is cooked in its own round and paid under that viewer's own name, one at a time
    const served: string[] = [];
    for (let round = 2; round <= 4; round++) {
      runUntil(game, () => game.snapshot().state === 'COOKING' && game.snapshot().roundId === round);
      const who = game.snapshot().cafe!.serving!;
      expect(who.viewer).toBe(true);
      expect(game.snapshot().dessertNameTh).toBe(who.dessertNameTh);
      runUntil(game, () => game.snapshot().state === 'REWARDING' && game.snapshot().roundId === round);
      expect(game.snapshot().toast).toContain(who.name!);
      served.push(`${who.name}:${who.dessertNameTh}`);
    }
    expect(served).toEqual(queued);
  });

  it('two gifts from the same viewer are two separate customers with their own desserts', () => {
    const { game } = mk({ npcSpawnEveryMs: 1e9 });
    game.start();
    gift(game, 20, { displayName: 'ซ้ำ' });
    gift(game, 50, { displayName: 'ซ้ำ' });
    game.update(16);
    const mine = game.snapshot().cafe!.waiting.filter((c) => c.name === 'ซ้ำ');
    expect(mine.map((c) => c.dessertNameTh)).toEqual([nameOf('khanom-chan'), nameOf('foi-thong')]);
    expect(new Set(mine.map((c) => c.id)).size).toBe(2);
  });
});
