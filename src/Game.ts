import type { GameConfig } from './config/gameConfig';
import { CookingSystem } from './cooking/CookingSystem';
import { ProgressManager } from './cooking/ProgressManager';
import { DessertManager } from './dessert/DessertManager';
import type { DessertDef } from './dessert/types';
import { GameManager } from './core/GameManager';
import type { GameState } from './core/StateMachine';

export interface GameSnapshot {
  state: GameState;
  roundId: number;
  roundsCompleted: number;
  dessertNameTh: string | null;
  nextDessertNameTh: string;
  stepNameTh: string | null;
  progress: number;
}

/** Composition root: wires dessert picking and cooking into GameManager's hooks. */
export class Game {
  readonly manager: GameManager;
  private readonly progress = new ProgressManager();
  private readonly cooking: CookingSystem;
  private current: DessertDef | null = null;

  constructor(
    config: GameConfig,
    private readonly desserts: DessertManager,
  ) {
    this.cooking = new CookingSystem(config, this.progress, {
      onComplete: (roundId) => {
        this.manager.completeRound(roundId);
      },
    });
    this.manager = new GameManager(config, {
      onEnter: (state, roundId) => {
        if (state === 'PREPARING') {
          this.current = this.desserts.next();
          this.progress.startRound(roundId);
        } else if (state === 'COOKING' && this.current) {
          this.cooking.start(this.current, roundId);
        }
      },
      onTick: (state, dtMs) => {
        if (state === 'COOKING') this.cooking.update(dtMs);
      },
      onCleanupRound: () => this.cooking.cancel(),
    });
  }

  start(): boolean {
    return this.manager.start();
  }

  update(dtMs: number): void {
    this.manager.update(dtMs);
  }

  snapshot(): GameSnapshot {
    const m = this.manager.snapshot();
    const c = this.cooking.snapshot();
    const step = c.active ? this.current?.steps[c.stepIndex] : undefined;
    return {
      state: m.state,
      roundId: m.roundId,
      roundsCompleted: m.roundsCompleted,
      dessertNameTh: this.current?.nameTh ?? null,
      nextDessertNameTh: this.desserts.peekNext().nameTh,
      stepNameTh: step?.nameTh ?? null,
      progress: this.progress.value,
    };
  }

  /** Test/mock helper: no-op outside COOKING. Phase 4 replaces this with the event system. */
  debugAddProgress(amount: number): number {
    return this.manager.snapshot().state === 'COOKING' ? this.cooking.addProgress(amount) : 0;
  }

  /** Test/mock helper: no-op outside COOKING. */
  debugCompleteStep(): boolean {
    return this.manager.snapshot().state === 'COOKING' ? this.cooking.completeCurrentStep() : false;
  }
}
