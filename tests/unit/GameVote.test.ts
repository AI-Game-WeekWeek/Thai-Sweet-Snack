import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { voteConfig } from '../../src/config/gameConfig';
import { HeartMeter } from '../../src/cooking/HeartMeter';
import { Game } from '../../src/Game';
import { ALL_DESSERTS } from '../../src/dessert/data';
import { DessertManager } from '../../src/dessert/DessertManager';
import { TikTokEventManager } from '../../src/tiktok/TikTokEventManager';
import { VoteManager } from '../../src/vote/VoteManager';

const IDS = ALL_DESSERTS.map((d) => d.id);
const V = voteConfig.vote;
let n = 0;

function mk(seed = 7, rng: () => number = () => 0.4) {
  const events = new TikTokEventManager(voteConfig);
  const vote = { manager: new VoteManager({ maxVoters: V.maxVoters, anonVotesPerSec: V.anonVotesPerSec }), meter: new HeartMeter({ decayPerSec: V.heartDecayPerSec, maxBoost: V.maxBoost }), rng };
  let s = seed;
  const desserts = new DessertManager(ALL_DESSERTS, IDS, () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296));
  const game = new Game(voteConfig, desserts, undefined, events, undefined, undefined, vote);
  return { game, events, vote };
}
const comment = (g: Game, text: string, userId: string, over: Record<string, unknown> = {}) => g.ingestEvent({ id: `v${++n}`, type: 'comment', tsMs: g.nowMs, text, userId, ...over });
const like = (g: Game, count: number) => g.ingestEvent({ id: `l${++n}`, type: 'like', count, tsMs: g.nowMs });
function runUntil(g: Game, pred: () => boolean, limit = 400_000): void {
  for (let i = 0; i < limit && !pred(); i++) g.update(16);
  expect(pred()).toBe(true);
}
const cookingName = (g: Game) => g.snapshot().dessertNameTh;

describe('Game in menu-vote mode', () => {
  beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => vi.restoreAllMocks());

  it('PREPARING opens a vote with distinct candidates and a counting-down timer', () => {
    const { game } = mk();
    game.start();
    const s = game.snapshot();
    expect(s.state).toBe('PREPARING');
    expect(s.vote?.open).toBe(true);
    expect(s.vote?.candidates).toHaveLength(V.candidates);
    expect(new Set(s.vote!.candidates.map((c) => c.id)).size).toBe(V.candidates);
    expect(s.dessertNameTh).toBeNull(); // nothing is cooking yet
    const first = s.vote!.remainingMs;
    for (let i = 0; i < 50; i++) game.update(16);
    expect(game.snapshot().vote!.remainingMs).toBeLessThan(first);
  });

  it('the most voted candidate is cooked', () => {
    for (const pick of [1, 2, 3]) {
      const { game } = mk(pick);
      game.start();
      const names = game.snapshot().vote!.candidates.map((c) => c.nameTh);
      for (let i = 0; i < 10; i++) comment(game, String(pick), `u${i}`);
      comment(game, String(pick === 1 ? 2 : 1), 'other');
      runUntil(game, () => game.snapshot().state === 'COOKING');
      expect(cookingName(game)).toBe(names[pick - 1]);
      expect(game.snapshot().vote?.winner).toBe(pick - 1);
    }
  });

  it('no votes: the first candidate is cooked and the game never waits', () => {
    const { game } = mk();
    game.start();
    const first = game.snapshot().vote!.candidates[0]!.nameTh;
    runUntil(game, () => game.snapshot().state === 'COOKING');
    expect(cookingName(game)).toBe(first);
  });

  it('a tie is decided by the rng', () => {
    const seen = new Set<string | null>();
    for (const r of [0, 0.99]) {
      const { game } = mk(3, () => r);
      game.start();
      comment(game, '1', 'a'); comment(game, '2', 'b');
      runUntil(game, () => game.snapshot().state === 'COOKING');
      seen.add(cookingName(game));
    }
    expect(seen.size).toBe(2);
  });

  it('one viewer cannot stuff the box; a later vote replaces the earlier one', () => {
    const { game, vote } = mk();
    game.start();
    for (let i = 0; i < 500; i++) comment(game, '1', 'spammer');
    comment(game, '2', 'x'); comment(game, '2', 'y');
    game.update(16);
    expect(vote.manager.tally()).toEqual([1, 2, 0]);
    comment(game, '3', 'spammer');
    game.update(16);
    expect(vote.manager.tally()).toEqual([0, 2, 1]);
  });

  it('votes sent after the window closed do not change the cooking dessert or the next vote', () => {
    const { game, vote } = mk();
    game.start();
    comment(game, '1', 'a');
    runUntil(game, () => game.snapshot().state === 'COOKING');
    const name = cookingName(game);
    for (let i = 0; i < 100; i++) comment(game, '3', `late${i}`);
    game.update(16);
    expect(cookingName(game)).toBe(name);
    expect(vote.manager.isOpen).toBe(false);
    runUntil(game, () => game.snapshot().state === 'PREPARING' && game.snapshot().roundId === 2);
    game.update(16);
    expect(vote.manager.tally()).toEqual([0, 0, 0]); // late votes from round 1 did not leak into round 2
  });

  it('a vote stamped before the new window opened is ignored', () => {
    const { game, vote } = mk();
    game.start();
    runUntil(game, () => game.snapshot().roundId === 2 && game.snapshot().state === 'PREPARING');
    comment(game, '2', 'old', { tsMs: -9_999_999 }); // looks ancient: only counted after maxSourceLagMs into the window
    game.update(16);
    expect(vote.manager.tally()).toEqual([0, 0, 0]);
  });

  it('likes while cooking fill the heart meter and speed cooking up; likes during the vote do not', () => {
    const progressAfter = (withLikes: boolean): number => {
      const { game } = mk(11);
      game.start();
      if (withLikes) like(game, 500); // during the vote window: ignored
      runUntil(game, () => game.snapshot().state === 'COOKING');
      expect(game.snapshot().heart).toBe(0);
      game.update(16);
      const p0 = game.snapshot().progress;
      if (withLikes) { like(game, 500); game.update(16); expect(game.snapshot().heart).toBeGreaterThan(0.5); }
      for (let i = 0; i < 125; i++) game.update(16); // 2 s
      return game.snapshot().progress - p0;
    };
    expect(progressAfter(true)).toBeGreaterThan(progressAfter(false) * 1.8);
  });

  it('the meter is empty again in the next round', () => {
    const { game, vote } = mk();
    game.start();
    runUntil(game, () => game.snapshot().state === 'COOKING');
    like(game, 500);
    game.update(16);
    expect(vote.meter.value).toBeGreaterThan(0);
    runUntil(game, () => game.snapshot().roundId === 2);
    expect(vote.meter.value).toBe(0);
  });

  it('a large gift still completes the current step in vote mode', () => {
    const { game } = mk();
    game.start();
    runUntil(game, () => game.snapshot().state === 'COOKING');
    game.update(16);
    const step = game.snapshot().stepNameTh;
    game.ingestEvent({ id: `g${++n}`, type: 'gift', count: 1, giftCoins: 999, tsMs: game.nowMs });
    game.update(16);
    expect(game.snapshot().stepNameTh).not.toBe(step);
  });

  it('with no viewers and no events the loop runs for several dessert rounds', () => {
    const { game } = mk();
    game.start();
    runUntil(game, () => game.snapshot().roundsCompleted >= 3);
  });

  it('losing the connection mid-vote changes nothing for the game', () => {
    const { game, events } = mk();
    game.start();
    events.setConnection('connected');
    comment(game, '2', 'a');
    events.setConnection('offline');
    runUntil(game, () => game.snapshot().roundsCompleted >= 1);
    expect(game.snapshot().connection).toBe('offline');
  });

  it('classic mode (no vote object) still picks and cooks as before', () => {
    const g = new Game(voteConfig, new DessertManager(ALL_DESSERTS, IDS, () => 0.4));
    g.start();
    expect(g.snapshot().vote).toBeUndefined();
    expect(g.snapshot().dessertNameTh).not.toBeNull();
  });

  it('with no votes the same dessert is never cooked twice in a row (3 unlocked, 80 rounds)', () => {
    const events = new TikTokEventManager(voteConfig);
    const vote = { manager: new VoteManager({ maxVoters: V.maxVoters, anonVotesPerSec: V.anonVotesPerSec }), meter: new HeartMeter({ decayPerSec: V.heartDecayPerSec, maxBoost: V.maxBoost }), rng: () => 0.4 };
    let s = 5;
    const dm = new DessertManager(ALL_DESSERTS, IDS.slice(0, 3), () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296));
    const game = new Game(voteConfig, dm, undefined, events, undefined, undefined, vote);
    game.start();
    let last: string | null = null;
    let repeats = 0;
    for (let round = 0; round < 80; round++) {
      runUntil(game, () => game.snapshot().state === 'COOKING' && game.snapshot().roundId === round + 1);
      const name = cookingName(game);
      if (name === last) repeats++;
      last = name;
    }
    expect(repeats).toBe(0);
  });

  it('orange hearts and small gifts fill the heart meter while cooking', () => {
    const { game, vote } = mk();
    game.start();
    runUntil(game, () => game.snapshot().state === 'COOKING');
    game.update(16);
    game.ingestEvent({ id: `h${++n}`, type: 'orangeHeart', count: 3, tsMs: game.nowMs });
    game.ingestEvent({ id: `g${++n}`, type: 'gift', count: 1, giftCoins: 1, tsMs: game.nowMs });
    game.update(16);
    expect(vote.meter.value).toBeGreaterThanOrEqual(4 * V.heartPerHeart - 0.02);
  });

  it('votes still count for graceMs after the on-screen countdown shows 0 (stream latency)', () => {
    const { game, vote } = mk();
    game.start();
    runUntil(game, () => game.snapshot().state === 'PREPARING' && game.snapshot().vote!.remainingMs === 0);
    expect(game.snapshot().state).toBe('PREPARING'); // the box is still open
    expect(vote.manager.isOpen).toBe(true);
    for (let i = 0; i < 5; i++) comment(game, '3', `late${i}`);
    game.update(16);
    expect(vote.manager.tally()[2]).toBe(5);
    runUntil(game, () => game.snapshot().state === 'COOKING');
    expect(game.snapshot().vote?.winner).toBe(2);
  });
});
