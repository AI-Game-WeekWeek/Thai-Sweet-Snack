import type { GameConfig, StateTimings } from '../config/gameConfig';
import { StateMachine, TRANSITIONS, type GameState } from './StateMachine';

export interface GameHooks {
  onEnter?(state: GameState, roundId: number): void;
  /** Called once when a round ends (entering NEXT_DESSERT); later phases cancel animations/voices/events here. */
  onCleanupRound?(roundId: number): void;
}

export interface Snapshot {
  state: GameState;
  roundId: number;
  stateElapsedMs: number;
  roundsCompleted: number;
}

const TIMING_KEY: Partial<Record<GameState, keyof StateTimings>> = {
  PREPARING: 'preparing',
  COOKING: 'cooking',
  PRESENTING: 'presenting',
  REWARDING: 'rewarding',
  NEXT_DESSERT: 'nextDessert',
};

export class GameManager {
  private readonly machine = new StateMachine();
  private isRunning = false;
  private roundId = 0;
  private stateElapsedMs = 0;
  private roundsCompleted = 0;

  constructor(
    private readonly config: GameConfig,
    private readonly hooks: GameHooks = {},
  ) {}

  get running(): boolean {
    return this.isRunning;
  }

  start(): boolean {
    if (this.isRunning) return false;
    this.isRunning = true;
    if (this.machine.state === 'IDLE') this.enter('PREPARING');
    return true;
  }

  stop(): void {
    this.isRunning = false;
  }

  update(dtMs: number): void {
    if (!this.isRunning || !Number.isFinite(dtMs) || dtMs <= 0) return;
    const state = this.machine.state;
    const key = TIMING_KEY[state];
    if (!key) return;

    this.stateElapsedMs += Math.min(dtMs, this.config.maxFrameMs);

    if (this.stateElapsedMs >= this.config.maxMs[key]) {
      console.warn(`[GameManager] watchdog forced ${state} to advance (round ${this.roundId})`);
      this.advance(state);
    } else if (this.stateElapsedMs >= this.config.durationsMs[key]) {
      // In COOKING this expiry is the PLACEHOLDER auto-complete.
      this.advance(state);
    }
  }

  completeRound(roundId: number): boolean {
    if (roundId !== this.roundId || this.machine.state !== 'COOKING') return false;
    return this.enter('PRESENTING');
  }

  snapshot(): Snapshot {
    return {
      state: this.machine.state,
      roundId: this.roundId,
      stateElapsedMs: this.stateElapsedMs,
      roundsCompleted: this.roundsCompleted,
    };
  }

  private advance(from: GameState): void {
    const next = TRANSITIONS[from][0];
    if (next) this.enter(next);
  }

  private enter(to: GameState): boolean {
    const from = this.machine.state;
    if (!this.machine.transition(to)) return false;
    this.stateElapsedMs = 0;

    if (to === 'PREPARING') this.roundId += 1;
    if (to === 'NEXT_DESSERT' && from === 'REWARDING') {
      this.roundsCompleted += 1;
      this.safely(() => this.hooks.onCleanupRound?.(this.roundId));
    }
    this.safely(() => this.hooks.onEnter?.(to, this.roundId));
    return true;
  }

  private safely(fn: () => void): void {
    try {
      fn();
    } catch (err) {
      console.error('[GameManager] hook threw', err);
    }
  }
}
