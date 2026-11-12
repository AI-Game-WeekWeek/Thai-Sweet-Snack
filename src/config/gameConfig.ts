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
}

export const defaultConfig: GameConfig = {
  maxFrameMs: 100,
  durationsMs: { preparing: 500, cooking: 3000, presenting: 800, rewarding: 800, nextDessert: 200 },
  maxMs: { preparing: 2000, cooking: 10000, presenting: 3000, rewarding: 3000, nextDessert: 1000 },
};
