import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { voteConfig } from '../../src/config/gameConfig';
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
import { VoteManager } from '../../src/vote/VoteManager';

const ROUNDS = 150;
const V = voteConfig.vote;
const ALL_IDS = ALL_DESSERTS.map((d) => d.id);
const DEFAULT_IDS = ALL_DESSERTS.filter((d) => 'default' in d.unlock).map((d) => d.id);

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

describe('menu-vote soak', () => {
  beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => vi.restoreAllMocks());

  it(`${ROUNDS} rounds under vote spam, ties, duplicates, malformed comments, hearts and flaky storage`, () => {
    const rand = mulberry32(99);
    const events = new TikTokEventManager(voteConfig);
    const save = new SaveSystem(voteConfig, new Flaky(mulberry32(5)), DEFAULT_IDS, ALL_IDS);
    const rewards = new RewardManager(voteConfig, save.load());
    const manager = new VoteManager({ maxVoters: V.maxVoters, anonVotesPerSec: V.anonVotesPerSec });
    const meter = new HeartMeter({ decayPerSec: V.heartDecayPerSec, maxBoost: V.maxBoost });
    const game = new Game(voteConfig, new DessertManager(ALL_DESSERTS, rewards.profile.unlocked, mulberry32(3)), undefined, events, rewards, { progression: new ProgressionManager(ALL_DESSERTS, rewards), save }, { manager, meter, rng: mulberry32(8) });
    const mock = new MockEventSource(mulberry32(6), (e) => game.ingestEvent(e), { comments: true });
    mock.steady(150, 1e12);
    game.start();

    let n = 0;
    const raw = (o: Record<string, unknown>) => game.ingestEvent({ id: `s${++n}`, tsMs: game.nowMs, ...o });
    let prev = game.snapshot();
    let tallyAtClose: number[] | null = null;
    let cookedFromVote = 0;
    const seenDesserts = new Set<string>();

    for (let frame = 0; game.snapshot().roundsCompleted < ROUNDS; frame++) {
      expect(frame).toBeLessThan(900_000);
      mock.tick(16, game.nowMs);
      const r = rand();
      if (r < 0.01) for (let i = 0; i < 300; i++) raw({ type: 'comment', text: '1', userId: 'spammer' });
      else if (r < 0.02) for (let i = 0; i < 400; i++) raw({ type: 'comment', text: String(1 + (i % 3)), userId: `t${i}` }); // forces ties
      else if (r < 0.03) for (const text of ['0', '4', 'ข้าวต้มมัด', '1 2', '', '9'.repeat(500), '#3']) raw({ type: 'comment', text, userId: 'x' });
      else if (r < 0.035) raw({ type: 'comment', text: '2', userId: 'old', tsMs: -1e12 });
      else if (r < 0.04) raw({ type: 'like', count: 1000 });
      else if (r < 0.042) raw({ type: 'gift', count: 1, giftCoins: 999 });
      if (rand() < 0.002) events.setConnection(['connected', 'reconnecting', 'offline'][Math.floor(rand() * 3)] as 'offline');

      game.update(16);
      const s = game.snapshot();

      expect(s.progress).toBeGreaterThanOrEqual(0);
      expect(s.progress).toBeLessThanOrEqual(100);
      expect(meter.value).toBeGreaterThanOrEqual(0);
      expect(meter.value).toBeLessThanOrEqual(1);
      expect(events.queueLength).toBeLessThanOrEqual(voteConfig.events.queueMax);
      if (s.state !== prev.state) expect(TRANSITIONS[prev.state]).toContain(s.state);
      expect(s.roundId - prev.roundId === 0 || s.roundId - prev.roundId === 1).toBe(true);

      // The ballot box is open during the vote window and only then.
      expect(manager.isOpen).toBe(s.state === 'PREPARING');
      const tallySum = manager.tally().reduce((a, b) => a + b, 0);
      expect(tallySum).toBeLessThanOrEqual(V.maxVoters + voteConfig.vote.anonVotesPerSec * 20);

      if (s.state === 'COOKING' && prev.state === 'PREPARING') {
        tallyAtClose = [...manager.tally()];
        const w = s.vote!.winner!;
        const max = Math.max(...tallyAtClose);
        expect(tallyAtClose[w]).toBe(max); // the cooked dessert had the most votes (or no votes at all -> first)
        expect(s.dessertNameTh).toBe(s.vote!.candidates[w]!.nameTh);
        if (max === 0) expect(w).toBe(0);
        cookedFromVote++;
        seenDesserts.add(s.dessertNameTh!);
      }
      if (s.state === 'COOKING' && tallyAtClose) expect([...manager.tally()]).toEqual(tallyAtClose); // votes after the close change nothing
      if (s.state === 'PREPARING') {
        expect(s.dessertNameTh).toBeNull();
        expect(new Set(s.vote!.candidates.map((c) => c.id)).size).toBe(s.vote!.candidates.length);
      }
      prev = s;
    }

    expect(cookedFromVote).toBeGreaterThanOrEqual(ROUNDS);
    expect(seenDesserts.size).toBeGreaterThanOrEqual(4);
    expect(rewards.profile.rounds).toBe(ROUNDS);
  });

  it('with zero viewers the game still runs rounds back to back (menu just rotates)', () => {
    const manager = new VoteManager({ maxVoters: V.maxVoters, anonVotesPerSec: V.anonVotesPerSec });
    const meter = new HeartMeter({ decayPerSec: V.heartDecayPerSec, maxBoost: V.maxBoost });
    const game = new Game(voteConfig, new DessertManager(ALL_DESSERTS, DEFAULT_IDS, mulberry32(2)), undefined, undefined, undefined, undefined, { manager, meter });
    game.start();
    const cooked = new Set<string>();
    for (let frame = 0; game.snapshot().roundsCompleted < 30; frame++) {
      expect(frame).toBeLessThan(900_000);
      game.update(16);
      if (game.snapshot().dessertNameTh) cooked.add(game.snapshot().dessertNameTh!);
    }
    expect(cooked.size).toBeGreaterThanOrEqual(3);
  });
});
