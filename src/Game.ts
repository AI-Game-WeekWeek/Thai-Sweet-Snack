import type { AnimSpec } from './anim/AnimationManager';
import type { ParticleSystem } from './anim/ParticleSystem';
import type { GameConfig } from './config/gameConfig';
import { CookingSystem } from './cooking/CookingSystem';
import { ProgressManager } from './cooking/ProgressManager';
import { DessertManager } from './dessert/DessertManager';
import type { AnimId, DessertDef, SoundId } from './dessert/types';
import { GameManager } from './core/GameManager';
import type { GameState } from './core/StateMachine';
import type { ProgressionManager } from './reward/ProgressionManager';
import type { RewardManager } from './reward/RewardManager';
import type { SaveSystem } from './save/SaveSystem';
import type { HeartMeter } from './cooking/HeartMeter';
import type { VoteManager } from './vote/VoteManager';
import type { RewardResult } from './reward/types';
import type { TikTokEventManager } from './tiktok/TikTokEventManager';
import type { ConnectionState, Counters } from './tiktok/types';

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
  counters: Counters;
  connection: ConnectionState;
  /** Share bonus (percent) banked for the current round. */
  bonusPct: number;
  ingredients: { id: string; nameTh: string; color: string }[];
  reward: { score: number; coins: number; xp: number; level: number; last: RewardResult | null };
  /** Short message for the HUD (reward summary, unlock news); null when there is none. */
  toast: string | null;
  /** Menu-vote mode only. */
  vote?: VoteView;
  /** Heart meter 0..1 (vote mode; 0 otherwise). */
  heart: number;
}

export interface VoteView {
  open: boolean;
  candidates: { id: string; nameTh: string; palette: readonly string[] }[];
  tally: number[];
  remainingMs: number;
  /** Index of the winning candidate once voting has closed. */
  winner: number | null;
}

export interface GameVoteMode {
  manager: VoteManager;
  meter: HeartMeter;
  /** Tie-break randomness (default Math.random). */
  rng?: () => number;
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
  vote?: VoteView;
  heart: number;
  dessertNameTh: string | null;
  stepNameTh: string | null;
  toast: string | null;
}

export interface GamePersistence {
  progression: ProgressionManager;
  save: SaveSystem;
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
  private clockMs = 0;
  private roundStart = 0;
  private bonusPct = 0;
  private toastText: string | null = null;
  private candidates: DessertDef[] = [];
  private voteStart = 0;
  private winnerIdx: number | null = null;
  private lastCookedId: string | null = null;
  private readonly voteView: VoteView = { open: false, candidates: [], tally: [], remainingMs: 0, winner: null };

  constructor(
    private readonly config: GameConfig,
    private readonly desserts: DessertManager,
    private readonly fx?: GameFx,
    private readonly events?: TikTokEventManager,
    private readonly rewards?: RewardManager,
    private readonly persistence?: GamePersistence,
    private readonly vote?: GameVoteMode,
  ) {
    this.cooking = new CookingSystem(config, this.progress, {
      onStepStart: (step, index, roundId) => this.startStepFx(step.anim, step.sound, step.maxMs, index, roundId),
      onComplete: (roundId) => this.onCookingComplete(roundId),
    });
    this.manager = new GameManager(config, {
      onEnter: (state, roundId) => this.onEnter(state, roundId),
      onTick: (state, dtMs) => {
        if (state !== 'COOKING') return;
        if (this.vote) {
          this.vote.meter.update(dtMs);
          this.cooking.setRateMultiplier(this.vote.meter.multiplier);
        }
        this.cooking.update(dtMs);
      },
      onCleanupRound: (roundId) => this.cleanupRound(roundId),
    });
  }

  start(): boolean {
    return this.manager.start();
  }

  /** Game clock in ms (the source clock live events are timestamped against). */
  get nowMs(): number {
    return this.clockMs;
  }

  /** Game-clock time at which the current round entered COOKING. */
  get roundStartedAtMs(): number {
    return this.roundStart;
  }

  /** `nowMs` is the wall clock in production; tests omit it and the clock advances by the clamped dt. */
  update(dtMs: number, nowMs?: number): void {
    const valid = Number.isFinite(dtMs) && dtMs > 0;
    if (valid) {
      this.clockMs = nowMs !== undefined && Number.isFinite(nowMs) ? nowMs : this.clockMs + Math.min(dtMs, this.config.maxFrameMs);
    }
    this.manager.update(dtMs);
    if (!valid) return;
    const dt = Math.min(dtMs, this.config.maxFrameMs);
    this.fx?.animations.update(dt);
    this.fx?.particles?.update(dt);
    this.wobble = Math.max(0, this.wobble - dt / 700);
    if (this.stepKind && this.manager.snapshot().state === 'COOKING') this.emitParticles(this.stepKind, dt);
    this.applyEvents();
  }

  ingestEvent(raw: unknown): 'queued' | 'duplicate' | 'invalid' {
    try {
      return this.events ? this.events.ingest(raw, this.clockMs) : 'invalid';
    } catch (err) {
      console.error('[Game] ingest failed', err);
      return 'invalid';
    }
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
      counters: this.events?.totals ?? { likes: 0, follows: 0, hearts: 0, gifts: 0, shares: 0 },
      connection: this.events?.connection ?? 'offline',
      bonusPct: this.bonusPct,
      ingredients: this.current?.ingredients.map((i) => ({ ...i })) ?? [],
      reward: {
        score: this.rewards?.profile.score ?? 0,
        coins: this.rewards?.profile.coins ?? 0,
        xp: this.rewards?.profile.xp ?? 0,
        level: this.rewards?.level ?? 1,
        last: this.rewards?.last ?? null,
      },
      toast: this.toastText,
      ...(this.vote ? { vote: this.currentVoteView() } : {}),
      heart: this.vote?.meter.value ?? 0,
    };
  }

  private currentVoteView(): VoteView {
    const v = this.voteView;
    const vote = this.vote;
    if (!vote) return v;
    const m = this.manager.snapshot();
    const tally = vote.manager.tally();
    for (let i = 0; i < v.tally.length; i++) v.tally[i] = tally[i] ?? 0;
    v.open = vote.manager.isOpen;
    v.remainingMs = m.state === 'PREPARING' ? Math.max(0, this.config.durationsMs.preparing - this.config.vote.graceMs - m.stateElapsedMs) : 0;
    v.winner = this.winnerIdx;
    return v;
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
      ...(this.vote ? { vote: this.currentVoteView() } : {}),
      heart: this.vote?.meter.value ?? 0,
      dessertNameTh: this.current?.nameTh ?? null,
      stepNameTh: this.cooking.snapshot().active ? (this.current?.steps[this.cooking.snapshot().stepIndex]?.nameTh ?? null) : null,
      toast: this.toastText,
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
      if (this.vote) this.openVote(roundId);
      else this.current = this.desserts.next();
      this.progress.startRound(roundId);
      this.bonusPct = 0;
    } else if (state === 'COOKING' && this.vote) {
      this.resolveVote();
      this.toastText = null;
      this.roundStart = this.clockMs;
      if (this.current) this.cooking.start(this.current, roundId);
    } else if (state === 'COOKING' && this.current) {
      this.toastText = null; // reward/unlock news stays visible through REWARDING, NEXT_DESSERT and PREPARING
      this.roundStart = this.clockMs;
      this.cooking.start(this.current, roundId);
    } else if (state !== 'COOKING') {
      // Left COOKING early (e.g. watchdog): stop cooking so no step state lingers into PRESENTING.
      this.cooking.cancel();
    }
    if (state === 'PRESENTING') this.startPresentation(roundId);
    if (state === 'REWARDING') this.awardRound(roundId);
    if (state === 'NEXT_DESSERT') this.settleRound();
  }

  /** Vote window = the PREPARING phase: pick the menu and open the box. */
  private openVote(roundId: number): void {
    const vote = this.vote;
    if (!vote) return;
    this.candidates = this.desserts.pickCandidates(this.config.vote.candidates);
    if (this.candidates.length === 0) this.candidates = [this.desserts.next()];
    // With nobody voting the first candidate wins: never let that be the dessert we just cooked.
    if (this.candidates.length > 1 && this.candidates[0]?.id === this.lastCookedId) {
      const first = this.candidates[0] as DessertDef;
      this.candidates[0] = this.candidates[1] as DessertDef;
      this.candidates[1] = first;
    }
    this.winnerIdx = null;
    this.voteStart = this.clockMs;
    vote.manager.open(this.candidates.length, roundId);
    this.voteView.candidates = this.candidates.map((d) => ({ id: d.id, nameTh: d.nameTh, palette: d.palette }));
    this.voteView.tally = new Array<number>(this.candidates.length).fill(0);
  }

  /** Entering COOKING: close the box; the winner (ties random, no votes = first) is what gets cooked. */
  private resolveVote(): void {
    const vote = this.vote;
    if (!vote) return;
    vote.manager.close();
    const idx = this.candidates.length === 0 ? -1 : vote.manager.winner(vote.rng ?? Math.random);
    this.winnerIdx = idx >= 0 ? idx : null;
    this.current = idx >= 0 ? (this.candidates[idx] ?? null) : null;
    if (this.current) this.lastCookedId = this.current.id;
  }

  /** After the reward: auto-unlock (coins only) and save. Never allowed to disturb the loop. */
  private settleRound(): void {
    const p = this.persistence;
    if (!p || !this.rewards) return;
    try {
      if (this.config.progression.autoUnlock) {
        const next = p.progression.nextAffordable();
        if (next && p.progression.unlock(next.id) === 'ok') {
          this.desserts.setUnlocked(this.rewards.profile.unlocked);
          this.toastText = `ปลดล็อกขนมใหม่: ${next.nameTh}!`;
        }
      }
      p.save.save(this.rewards.profile);
    } catch (err) {
      console.error('[Game] settle failed', err);
    }
  }

  private awardRound(roundId: number): void {
    if (!this.rewards || !this.current) return;
    const r = this.rewards.award(this.current, { roundId, bonusPct: this.bonusPct, cookMs: this.clockMs - this.roundStart });
    if (r) this.toastText = `+${r.score} คะแนน +${r.coins} เหรียญ${r.levelUp ? ' • เลเวลอัป!' : ''}`;
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
    this.vote?.manager.cancel();
    this.vote?.meter.reset();
    this.cooking.setRateMultiplier(1);
  }

  /** One coalesced drain per update; a failing event source can never stop the loop. */
  private applyEvents(): void {
    const events = this.events;
    if (!events) return;
    try {
      const m = this.manager.snapshot();
      const voting = this.vote !== undefined && m.state === 'PREPARING';
      const fx = events.drain({ roundId: m.roundId, startedAtMs: voting ? this.voteStart : this.roundStart, cooking: m.state === 'COOKING', voting }, this.clockMs);
      if (this.vote) {
        for (const v of fx.votes) this.vote.manager.cast(v.vote, v.userKey, m.roundId, this.clockMs);
        // Hearts feed the meter (which speeds cooking up) instead of adding progress directly.
        this.vote.meter.add(fx.likes * this.config.vote.heartPerLike + fx.follows * this.config.vote.heartPerFollow + fx.hearts * this.config.vote.heartPerHeart);
      } else if (fx.progressAdd > 0) this.cooking.addProgress(fx.progressAdd, m.roundId);
      if (fx.completeStep) this.cooking.completeCurrentStep(m.roundId);
      if (fx.roseEffect) this.burst(18, 160);
      if (fx.bigGiftEffect) {
        this.burst(48, 300);
        this.fx?.audio.play('pop', m.roundId);
      }
      if (fx.shareBonus > 0 && (m.state === 'COOKING' || m.state === 'PRESENTING')) this.bonusPct += fx.shareBonus;
    } catch (err) {
      console.error('[Game] event processing failed', err);
    }
  }

  private burst(count: number, speed: number): void {
    this.wobble = 1;
    const pal = this.current?.palette ?? ['#ffb3c1'];
    for (let i = 0; i < count; i++) {
      const a = (Math.PI * 2 * i) / count;
      this.fx?.particles?.spawn({ x: WORLD_W / 2, y: 330, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed - 160, lifeMs: 900, size: 6, color: i % 2 ? '#ff5d8f' : (pal[i % pal.length] ?? '#fff') });
    }
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
