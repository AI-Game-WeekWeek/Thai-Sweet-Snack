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
};

/** Real game: CookingSystem drives COOKING; the global watchdog sits above any recipe length. */
export const liveConfig: GameConfig = {
  ...defaultConfig,
  placeholderCooking: false,
  maxMs: { ...defaultConfig.maxMs, cooking: 180_000 },
};
