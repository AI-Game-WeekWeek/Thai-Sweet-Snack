export interface StateTimings {
  preparing: number;
  cooking: number;
  presenting: number;
  rewarding: number;
  nextDessert: number;
}

export interface GameConfig {
  /** Largest dt accepted by one update(); protects against background-tab jumps. */
  maxFrameMs: number;
  /** Nominal time spent in each state. `cooking` is the PLACEHOLDER auto-complete time (Phase 2 replaces it). */
  durationsMs: StateTimings;
  /** Watchdog: a state is force-advanced once it has lasted this long. */
  maxMs: StateTimings;
  /** true = Phase 1 timer auto-completes COOKING at durationsMs.cooking; false = CookingSystem decides. */
  placeholderCooking: boolean;
  cooking: { baseProgressPerSec: number };
  anim: { maxActive: number; stepAnimMaxMs: number };
  particles: { cap: number; gravity: number };
  audio: { maxVoices: number; master: number };
  events: {
    likeProgress: number;
    followProgress: number;
    heartProgress: number;
    largeGiftCoins: number;
    roseCooldownMs: number;
    bigGiftCooldownMs: number;
    dedupeCapacity: number;
    queueMax: number;
    maxLikeCountPerEvent: number;
    shareBonusPct: number;
    /** Provider timestamps are advisory: an event is never treated as older than this, so clock skew costs at most this much of a round. */
    maxSourceLagMs: number;
  };
  reward: { speedParMs: number; speedBonusMaxPct: number; xpBase: number; xpGrowth: number };
  save: { key: string; backupKey: string };
  progression: { autoUnlock: boolean };
  cafe: {
    maxWaiting: number;
    /** Customers drawn at once (front one included). */
    visible: number;
    patienceMs: number;
    /** Anonymous customers arrive this often while fewer than npcMinWaiting are waiting. */
    npcSpawnEveryMs: number;
    npcMinWaiting: number;
    maxGiftsPerDrain: number;
    /** Coins the café earns from a gift that finds the queue full (a flat thank-you, not the gift's face value). */
    overflowGiftCoins: number;
    maxNameLength: number;
    /** Hide every viewer's name and picture. */
    anonymousNames: boolean;
    /** Remote profile pictures are OFF while `hosts` is empty. */
    avatar: { hosts: string[]; max: number; timeoutMs: number };
    /** Extra payout (percent) for a customer who did not have to wait at all. */
    payBonusMaxPct: number;
    giftTiers: { minCoins: number; dessertId: string }[];
    surprise: {
      luckyCat: { durationMs: number; maxMs: number; payBonusPct: number; /** Waiting customers lose patience at this fraction of normal speed. */ patienceSlowdown: number };
      vip: { cooldownMs: number; payBonusPct: number; /** The VIP orders the best unlocked tier worth at least this many coins. */ minGiftCoins: number };
      tip: { perCustomer: number; max: number };
      phone: { firstMs: number; everyMs: number; jitter: number; ringMs: number; deadlineMs: number; payBonusPct: number };
    };
  };
  vote: {
    candidates: number;
    windowMs: number;
    maxVoters: number;
    /** Votes per second accepted from sources without a user id. */
    anonVotesPerSec: number;
    heartPerLike: number;
    heartPerFollow: number;
    /** Meter fill per orange heart / small gift. */
    heartPerHeart: number;
    /** Votes still count this long after the on-screen countdown reaches 0 (stream latency). */
    graceMs: number;
    heartDecayPerSec: number;
    /** Cooking speed multiplier when the heart meter is full. */
    maxBoost: number;
    cookRatePerSec: number;
  };
}

export const defaultConfig: GameConfig = {
  maxFrameMs: 100,
  durationsMs: { preparing: 500, cooking: 3000, presenting: 800, rewarding: 800, nextDessert: 200 },
  maxMs: { preparing: 2000, cooking: 10000, presenting: 3000, rewarding: 3000, nextDessert: 1000 },
  placeholderCooking: true,
  cooking: { baseProgressPerSec: 3.5 },
  anim: { maxActive: 64, stepAnimMaxMs: 2500 },
  particles: { cap: 600, gravity: 900 },
  audio: { maxVoices: 8, master: 0.6 },
  events: {
    likeProgress: 0.02,
    followProgress: 1.5,
    heartProgress: 4,
    largeGiftCoins: 100,
    roseCooldownMs: 1500,
    bigGiftCooldownMs: 2500,
    dedupeCapacity: 2000,
    queueMax: 500,
    maxLikeCountPerEvent: 1000,
    shareBonusPct: 10,
    maxSourceLagMs: 3000,
  },
  reward: { speedParMs: 25000, speedBonusMaxPct: 30, xpBase: 100, xpGrowth: 1.25 },
  save: { key: 'thai-dessert-asmr:save', backupKey: 'thai-dessert-asmr:save.corrupt' },
  progression: { autoUnlock: true },
  cafe: {
    maxWaiting: 12,
    visible: 5,
    patienceMs: 70_000,
    npcSpawnEveryMs: 7000,
    npcMinWaiting: 4,
    maxGiftsPerDrain: 20,
    overflowGiftCoins: 2,
    maxNameLength: 16,
    anonymousNames: false,
    avatar: { hosts: [], max: 24, timeoutMs: 5000 },
    payBonusMaxPct: 50,
    giftTiers: [
      { minCoins: 1, dessertId: 'khanom-krok' },
      { minCoins: 5, dessertId: 'bua-loy' },
      { minCoins: 10, dessertId: 'thong-yod' },
      { minCoins: 20, dessertId: 'khanom-chan' },
      { minCoins: 50, dessertId: 'foi-thong' },
      { minCoins: 99, dessertId: 'thong-yip' },
      { minCoins: 199, dessertId: 'luk-chup' },
      { minCoins: 500, dessertId: 'khanom-buang' },
    ],
    surprise: {
      luckyCat: { durationMs: 20_000, maxMs: 60_000, payBonusPct: 100, patienceSlowdown: 0.5 },
      vip: { cooldownMs: 30_000, payBonusPct: 50, minGiftCoins: 50 },
      tip: { perCustomer: 3, max: 36 },
      phone: { firstMs: 45_000, everyMs: 100_000, jitter: 0.3, ringMs: 3000, deadlineMs: 35_000, payBonusPct: 200 },
    },
  },
  vote: { candidates: 3, windowMs: 15_000, maxVoters: 5000, anonVotesPerSec: 50, heartPerLike: 0.012, heartPerFollow: 0.15, heartPerHeart: 0.08, graceMs: 3000, heartDecayPerSec: 0.1, maxBoost: 4, cookRatePerSec: 6 },
};

/** Real game: CookingSystem drives COOKING; the global watchdog sits above any recipe length. */
export const liveConfig: GameConfig = {
  ...defaultConfig,
  placeholderCooking: false,
  maxMs: { ...defaultConfig.maxMs, cooking: 180_000 },
};

/** Menu-vote mode: PREPARING is the vote window; short serve/sell beats; faster base cooking (hearts speed it up further). */
export const voteConfig: GameConfig = {
  ...liveConfig,
  durationsMs: { ...liveConfig.durationsMs, preparing: liveConfig.vote.windowMs, presenting: 1500, rewarding: 2500 },
  maxMs: { ...liveConfig.maxMs, preparing: liveConfig.vote.windowMs + 5000 },
  cooking: { baseProgressPerSec: liveConfig.vote.cookRatePerSec },
};

/** Thai café mode: one round = one customer; short serve/pay beats; quicker base cooking (hearts speed it up further). */
export const cafeConfig: GameConfig = {
  ...liveConfig,
  durationsMs: { ...liveConfig.durationsMs, preparing: 1500, presenting: 1200, rewarding: 1800 },
  maxMs: { ...liveConfig.maxMs, preparing: 4000 },
  cooking: { baseProgressPerSec: 8 },
};
