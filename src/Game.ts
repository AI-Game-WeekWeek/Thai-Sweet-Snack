import type { AnimSpec } from './anim/AnimationManager';
import type { ParticleSystem } from './anim/ParticleSystem';
import type { GameConfig } from './config/gameConfig';
import { CookingSystem } from './cooking/CookingSystem';
import { ProgressManager } from './cooking/ProgressManager';
import { DessertManager } from './dessert/DessertManager';
import type { AnimId, DessertDef, SoundId } from './dessert/types';
import { GameManager } from './core/GameManager';
import type { GameState } from './core/StateMachine';

export interface AnimationsLike {
  play(spec: AnimSpec, roundId: number): number;
  isActive(handle: number): boolean;
  update(dtMs: number): void;
  cancelRound(roundId: number): number;
  readonly activeCount: number;
}

export interface AudioLike {
  play(sound: SoundId, roundId: number): boolean;
  stopRound(roundId: number): number;
}

export interface GameFx {
  animations: AnimationsLike;
  audio: AudioLike;
  particles?: ParticleSystem;
}

export interface GameSnapshot {
  state: GameState;
  roundId: number;
  roundsCompleted: number;
  dessertNameTh: string | null;
  nextDessertNameTh: string;
  stepNameTh: string | null;
  progress: number;
}

/** What the Renderer needs, in world units (WORLD_W x WORLD_H). */
export interface RenderView {
  state: GameState;
  progress: number;
  palette: readonly string[];
  stepKind: AnimId | null;
  stepT: number;
  /** 0..1 while the presentation animation plays, otherwise null. */
  presentT: number | null;
  wobble: number;
  piecesCount: number;
}

export const WORLD_W = 1000;
export const WORLD_H = 600;
const PRESENT_MS = 900;

/** Composition root: wires dessert picking, cooking, animation and sound into GameManager's hooks. */
export class Game {
  readonly manager: GameManager;
  private readonly progress = new ProgressManager();
  private readonly cooking: CookingSystem;
  private current: DessertDef | null = null;

  private stepKind: AnimId | null = null;
  private stepT = 0;
  private presentT: number | null = null;
  private wobble = 0;
  private emitAcc = 0;
  private finalAnim: number | null = null;
  private pendingComplete: number | null = null;

  constructor(
    private readonly config: GameConfig,
    private readonly desserts: DessertManager,
    private readonly fx?: GameFx,
  ) {
    this.cooking = new CookingSystem(config, this.progress, {
      onStepStart: (step, index, roundId) => this.startStepFx(step.anim, step.sound, step.maxMs, index, roundId),
      onComplete: (roundId) => this.onCookingComplete(roundId),
    });
    this.manager = new GameManager(config, {
      onEnter: (state, roundId) => this.onEnter(state, roundId),
      onTick: (state, dtMs) => {
        if (state === 'COOKING') this.cooking.update(dtMs);
      },
      onCleanupRound: (roundId) => this.cleanupRound(roundId),
    });
  }

  start(): boolean {
    return this.manager.start();
  }

  update(dtMs: number): void {
    this.manager.update(dtMs);
    if (!Number.isFinite(dtMs) || dtMs <= 0) return;
    const dt = Math.min(dtMs, this.config.maxFrameMs);
    this.fx?.animations.update(dt);
    this.fx?.particles?.update(dt);
    this.wobble = Math.max(0, this.wobble - dt / 700);
    if (this.stepKind && this.manager.snapshot().state === 'COOKING') this.emitParticles(this.stepKind, dt);
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

  renderView(): RenderView {
    return {
      state: this.manager.snapshot().state,
      progress: this.progress.value,
      palette: this.current?.palette ?? ['#f5f0e1'],
      stepKind: this.stepKind,
      stepT: this.stepT,
      presentT: this.presentT,
      wobble: this.wobble,
      piecesCount: 8,
    };
  }

  /** Touch response: a squishy wobble and a small burst of particles. Invalid coordinates are ignored. */
  poke(x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    this.wobble = 1;
    const color = this.current?.palette[0] ?? '#f5f0e1';
    for (let i = 0; i < 10; i++) {
      const a = (Math.PI * 2 * i) / 10;
      this.fx?.particles?.spawn({ x, y, vx: Math.cos(a) * 140, vy: Math.sin(a) * 140 - 120, lifeMs: 600, size: 5, color });
    }
  }

  /** Test/mock helper: no-op outside COOKING. Phase 4 replaces this with the event system. */
  debugAddProgress(amount: number): number {
    return this.isCooking() ? this.cooking.addProgress(amount, this.manager.snapshot().roundId) : 0;
  }

  /** Test/mock helper: no-op outside COOKING. */
  debugCompleteStep(): boolean {
    return this.isCooking() ? this.cooking.completeCurrentStep(this.manager.snapshot().roundId) : false;
  }

  private isCooking(): boolean {
    return this.manager.snapshot().state === 'COOKING';
  }

  private onEnter(state: GameState, roundId: number): void {
    if (state === 'PREPARING') {
      this.current = null; // if next() throws, never replay the previous round's dessert
      this.current = this.desserts.next();
      this.progress.startRound(roundId);
    } else if (state === 'COOKING' && this.current) {
      this.cooking.start(this.current, roundId);
    } else if (state !== 'COOKING') {
      // Left COOKING early (e.g. watchdog): stop cooking so no step state lingers into PRESENTING.
      this.cooking.cancel();
    }
    if (state === 'PRESENTING') this.startPresentation(roundId);
  }

  private startStepFx(anim: AnimId, sound: SoundId, stepMaxMs: number, index: number, roundId: number): void {
    const fx = this.fx;
    if (!fx) return;
    const durationMs = Math.min(stepMaxMs * 0.8, this.config.anim.stepAnimMaxMs);
    this.stepKind = anim;
    this.stepT = 0;
    const isLast = this.current ? index === this.current.steps.length - 1 : false;
    const handle = fx.animations.play(
      {
        kind: anim,
        durationMs,
        key: 'step',
        onUpdate: (t) => {
          this.stepT = t;
        },
        onDone: () => {
          if (this.pendingComplete === roundId) {
            this.pendingComplete = null;
            this.manager.completeRound(roundId);
          }
        },
      },
      roundId,
    );
    this.finalAnim = isLast ? handle : null;
    fx.audio.play(sound, roundId);
  }

  /** Cooking reached 100%: finish once the last step's animation is done (or its timeout fired). */
  private onCookingComplete(roundId: number): void {
    const fx = this.fx;
    if (fx && this.finalAnim !== null && fx.animations.isActive(this.finalAnim)) {
      this.pendingComplete = roundId; // completed from the animation's onDone; the global watchdog is the backstop
      return;
    }
    this.manager.completeRound(roundId);
  }

  private startPresentation(roundId: number): void {
    const fx = this.fx;
    this.pendingComplete = null;
    this.finalAnim = null;
    this.stepKind = null;
    if (!fx) return;
    fx.animations.cancelRound(roundId); // drop any step animation that outlived COOKING
    this.presentT = 0;
    fx.animations.play(
      {
        kind: 'arrange',
        durationMs: PRESENT_MS,
        key: 'present',
        onUpdate: (t) => {
          this.presentT = t;
        },
      },
      roundId,
    );
    fx.audio.play('pop', roundId);
    for (let i = 0; i < 24; i++) {
      const a = (Math.PI * 2 * i) / 24;
      fx.particles?.spawn({
        x: WORLD_W / 2,
        y: 330,
        vx: Math.cos(a) * 220,
        vy: Math.sin(a) * 220 - 200,
        lifeMs: 900,
        size: 5,
        color: this.current?.palette[i % (this.current?.palette.length ?? 1)] ?? '#fff',
      });
    }
  }

  private cleanupRound(roundId: number): void {
    this.cooking.cancel();
    this.pendingComplete = null;
    this.finalAnim = null;
    this.stepKind = null;
    this.stepT = 0;
    this.presentT = null;
    this.emitAcc = 0;
    this.fx?.animations.cancelRound(roundId);
    this.fx?.audio.stopRound(roundId);
    this.fx?.particles?.clear();
  }

  private emitParticles(kind: AnimId, dtMs: number): void {
    const particles = this.fx?.particles;
    if (!particles) return;
    const color = this.current?.palette[Math.floor(this.progress.value / 34) % (this.current?.palette.length ?? 1)] ?? '#fff';
    const rates: Partial<Record<AnimId, number>> = { pour: 60, drizzle: 40, steam: 25, boil: 30, fry: 45, stir: 12, spread: 20, cut: 6, knead: 10, shape: 8 };
    this.emitAcc += ((rates[kind] ?? 0) * dtMs) / 1000;
    while (this.emitAcc >= 1) {
      this.emitAcc -= 1;
      const jitter = (Math.random() - 0.5) * 2;
      if (kind === 'pour' || kind === 'drizzle' || kind === 'spread') {
        particles.spawn({ x: WORLD_W / 2 + jitter * 12, y: 120, vx: jitter * 20, vy: 160, lifeMs: 700, size: kind === 'drizzle' ? 3 : 6, color });
      } else if (kind === 'steam' || kind === 'boil') {
        particles.spawn({ x: WORLD_W / 2 + jitter * 120, y: 380, vx: jitter * 15, vy: -140, lifeMs: 1100, size: 7, color: 'rgba(255,255,255,0.7)', g: -0.1 });
      } else if (kind === 'fry') {
        particles.spawn({ x: WORLD_W / 2 + jitter * 140, y: 380, vx: jitter * 120, vy: -200, lifeMs: 450, size: 3, color: '#ffd966' });
      } else {
        particles.spawn({ x: WORLD_W / 2 + jitter * 100, y: 360, vx: jitter * 60, vy: -120, lifeMs: 500, size: 4, color });
      }
    }
  }
}
