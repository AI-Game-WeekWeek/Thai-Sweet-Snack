import type { GameConfig } from '../config/gameConfig';
import type { DessertDef, StepDef } from '../dessert/types';
import type { ProgressManager } from './ProgressManager';

export interface CookingCallbacks {
  onStepStart?(step: StepDef, index: number, roundId: number): void;
  onStepComplete?(step: StepDef, index: number, roundId: number): void;
  onComplete?(roundId: number): void;
}

export interface CookingSnapshot {
  active: boolean;
  dessertId: string | null;
  stepIndex: number;
  stepId: string | null;
  progress: number;
}

/** Turns progress (0..100) into recipe steps. Progress itself lives in ProgressManager. */
export class CookingSystem {
  private dessert: DessertDef | null = null;
  private roundId = 0;
  private active = false;
  private stepIndex = 0;
  private stepElapsedMs = 0;
  private bandEnds: number[] = [];
  private advancing = false;

  constructor(
    private readonly config: GameConfig,
    private readonly progress: ProgressManager,
    private readonly callbacks: CookingCallbacks = {},
  ) {}

  start(def: DessertDef, roundId: number): void {
    this.dessert = def;
    this.roundId = roundId;
    this.stepIndex = 0;
    this.stepElapsedMs = 0;
    this.advancing = false;
    const total = def.steps.reduce((sum, s) => sum + s.weight, 0);
    let cumulative = 0;
    this.bandEnds = def.steps.map((s) => {
      cumulative += s.weight;
      return (100 * cumulative) / total;
    });
    this.bandEnds[this.bandEnds.length - 1] = 100;
    this.progress.startRound(roundId);
    this.active = true;
    const first = def.steps[0];
    if (first) this.safely(() => this.callbacks.onStepStart?.(first, 0, roundId));
  }

  /** Caller passes an already-clamped dt. Invalid dt is ignored. */
  update(dtMs: number): void {
    if (!this.active || !Number.isFinite(dtMs) || dtMs <= 0) return;
    this.progress.add((this.config.cooking.baseProgressPerSec * dtMs) / 1000, this.roundId);
    this.stepElapsedMs += dtMs;
    const step = this.dessert?.steps[this.stepIndex];
    if (step && this.stepElapsedMs >= step.maxMs) {
      console.warn(`[CookingSystem] step watchdog forced "${step.id}" (round ${this.roundId})`);
      this.forceCurrentStepDone();
    }
    this.advanceSteps();
  }

  /** `roundId` is the round the caller (e.g. a live event) was meant for; a stale or future id is ignored. */
  addProgress(amount: number, roundId: number): number {
    if (!this.active || roundId !== this.roundId) return 0;
    const applied = this.progress.add(amount, this.roundId);
    this.advanceSteps();
    return applied;
  }

  completeCurrentStep(roundId: number): boolean {
    if (!this.active || roundId !== this.roundId) return false;
    this.forceCurrentStepDone();
    this.advanceSteps();
    return true;
  }

  cancel(): void {
    this.active = false;
  }

  snapshot(): CookingSnapshot {
    const step = this.dessert?.steps[this.stepIndex];
    return {
      active: this.active,
      dessertId: this.dessert?.id ?? null,
      stepIndex: this.stepIndex,
      stepId: this.active && step ? step.id : null,
      progress: this.progress.value,
    };
  }

  private forceCurrentStepDone(): void {
    const end = this.bandEnds[this.stepIndex];
    if (end !== undefined) this.progress.setAtLeast(end, this.roundId);
  }

  private advanceSteps(): void {
    if (this.advancing || !this.active || !this.dessert) return;
    this.advancing = true;
    try {
      const steps = this.dessert.steps;
      while (this.active) {
        const end = this.bandEnds[this.stepIndex];
        const step = steps[this.stepIndex];
        if (end === undefined || !step || this.progress.value < end) break;
        const index = this.stepIndex;
        this.stepIndex += 1;
        this.stepElapsedMs = 0;
        this.safely(() => this.callbacks.onStepComplete?.(step, index, this.roundId));
        const nextStep = steps[this.stepIndex];
        if (nextStep) {
          this.safely(() => this.callbacks.onStepStart?.(nextStep, this.stepIndex, this.roundId));
        } else {
          this.active = false; // set before the callback so a re-entrant call cannot complete twice
          this.safely(() => this.callbacks.onComplete?.(this.roundId));
        }
      }
    } finally {
      this.advancing = false;
    }
  }

  private safely(fn: () => void): void {
    try {
      fn();
    } catch (err) {
      console.error('[CookingSystem] callback threw', err);
    }
  }
}
