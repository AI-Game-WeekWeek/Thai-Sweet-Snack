import type { AnimSpec } from './anim/AnimationManager';
import type { ParticleSystem } from './anim/ParticleSystem';
import type { GameConfig } from './config/gameConfig';
import { CookingSystem } from './cooking/CookingSystem';
import { ProgressManager } from './cooking/ProgressManager';
import { DessertManager } from './dessert/DessertManager';
import type { AnimId, ArtId, DessertDef, SoundId } from './dessert/types';
import { GameManager } from './core/GameManager';
import type { GameState } from './core/StateMachine';
import type { ProgressionManager } from './reward/ProgressionManager';
import type { RewardManager } from './reward/RewardManager';
import type { SaveSystem } from './save/SaveSystem';
import { dessertForGift } from './cafe/giftMenu';
import { genderForSeed, politeEnding } from './cafe/gender';
import type { CafeQueue, Customer, CustomerKind } from './cafe/CafeQueue';
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
  /** Optional spoken line (browser voice). */
  speak?(text: string, roundId: number, pitch?: number, rate?: number, gender?: 'male' | 'female'): boolean;
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
  /** Heart meter 0..1 (vote and café mode; 0 otherwise). */
  heart: number;
  /** Café mode only. */
  cafe?: CafeView;
}

export interface VoteView {
  open: boolean;
  candidates: { id: string; nameTh: string; palette: readonly string[] }[];
  tally: number[];
  remainingMs: number;
  /** Index of the winning candidate once voting has closed. */
  winner: number | null;
}

export interface CustomerView {
  id: number;
  kind: CustomerKind;
  name: string | null;
  viewer: boolean;
  seed: number;
  avatarUrl: string | null;
  dessertId: string;
  dessertNameTh: string;
  color: string;
  /** Patience left, 0..1 (1 for the customer being served). */
  patience: number;
  serving: boolean;
}

export interface CafeView {
  serving: CustomerView | null;
  /** The next customers in line (at most `cafe.visible - 1`). */
  waiting: CustomerView[];
  waitingTotal: number;
  /** Customers who ran out of patience since the game started. */
  lost: number;
  giftMenu: { coins: number; nameTh: string; color: string; id: string }[];
  coins: number;
  /** Seconds of lucky-cat time left (0 = off). */
  luckyCatSec: number;
  /** The payout bonus (percent) the lucky cat gives, for the on-screen pill. */
  luckyCatBonusPct: number;
  /** The phone on the counter is ringing. */
  phoneRinging: boolean;
  /** A Thai ghost is about to visit or is at the counter: the café gets spooky. */
  spooky?: boolean;
  /** The ghost on the phone is talking (we picked up): "ฮือๆ ช่วยด้วย ผีอยากกินขนม". */
  phoneTalking?: boolean;
  /** 0..1 while the hungry ghost squeezes (tap hearts to loosen it); 0 when no ghost is being served. */
  squeeze?: number;
  /** True for a moment right after the ghost squeezed (screen shake). */
  squeezedNow?: boolean;
}

export interface GameCafeMode {
  queue: CafeQueue;
  meter: HeartMeter;
  /** Randomness for anonymous customers' orders (default Math.random). */
  rng?: () => number;
}

export interface GameVoteMode {
  manager: VoteManager;
  meter: HeartMeter;
  /** Tie-break randomness (default Math.random). */
  rng?: () => number;
}

const SERVED_COUNT: Record<string, number> = { parcel: 3, bowl: 3, layered: 8, fruit: 8, syrupBall: 8, flower: 6, thread: 4, crepe: 4 };

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
  /** Which dessert-specific scene and served look to draw (null before any dessert is chosen). */
  art?: ArtId | null;
  stepIndex?: number;
  stepCount?: number;
  /** 0..1: the finished dessert slides to the customer and shrinks away (café, while the order is being paid). 0 = not leaving. */
  serveOutT?: number;
  vote?: VoteView;
  cafe?: CafeView;
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
/** The ghost's voice: clearly higher and thinner than a normal customer (normal women 1.35, men 0.85). */
const GHOST_PITCH = 1.9;
const PHONE_RETRY_MS = 3000;

/** Composition root: wires dessert picking, cooking, animation and sound into GameManager's hooks. */
export class Game {
  readonly manager: GameManager;
  private readonly progress = new ProgressManager();
  private readonly cooking: CookingSystem;
  private current: DessertDef | null = null;

  private stepKind: AnimId | null = null;
  private stepSound: SoundId | null = null;
  private soundAcc = 0;
  private rewardMs = 0;
  private orderSpeak: { text: string; pitch: number; roundId: number; ms: number; gender: 'male' | 'female' } | null = null;
  private dripAcc = 0;
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
  private lostCustomers = 0;
  private npcTimer = 0;
  private giftMenuView: CafeView['giftMenu'] = [];
  // Surprise events (café). Driven by game time (dt), not wall clock; they outlive a single round.
  private luckyCatMs = 0;
  private vipCooldownMs = 0;
  private phoneTimerMs = 0;
  private phoneRingMs = 0;
  private phoneTalkMs = 0;
  private squeeze = 0;
  private squeezed = false;
  private squeezeFlashMs = 0;
  private readonly voteView: VoteView = { open: false, candidates: [], tally: [], remainingMs: 0, winner: null };

  constructor(
    private readonly config: GameConfig,
    private readonly desserts: DessertManager,
    private readonly fx?: GameFx,
    private readonly events?: TikTokEventManager,
    private readonly rewards?: RewardManager,
    private readonly persistence?: GamePersistence,
    private readonly vote?: GameVoteMode,
    private readonly cafe?: GameCafeMode,
  ) {
    this.cooking = new CookingSystem(config, this.progress, {
      onStepStart: (step, index, roundId) => this.startStepFx(step.anim, step.sound, step.maxMs, index, roundId),
      onComplete: (roundId) => this.onCookingComplete(roundId),
    });
    this.manager = new GameManager(config, {
      onEnter: (state, roundId) => this.onEnter(state, roundId),
      onTick: (state, dtMs) => {
        if (state !== 'COOKING') return;
        const meter = this.vote?.meter ?? this.cafe?.meter;
        if (meter) {
          meter.update(dtMs);
          this.cooking.setRateMultiplier(meter.multiplier);
        }
        this.cooking.update(dtMs);
      },
      onCleanupRound: (roundId) => this.cleanupRound(roundId),
    });
    if (cafe) {
      const first = config.cafe.surprise.phone.firstMs;
      this.phoneTimerMs = Number.isFinite(first) ? Math.max(0, first) : 45_000;
      this.giftMenuView = [...config.cafe.giftTiers]
        .sort((a, b) => a.minCoins - b.minCoins)
        .map((t) => {
          const d = desserts.get(t.dessertId);
          return { coins: t.minCoins, nameTh: d?.nameTh ?? t.dessertId, color: d?.palette[0] ?? '#f5f0e1', id: t.dessertId };
        });
    }
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
    this.rewardMs = this.manager.snapshot().state === 'REWARDING' ? this.rewardMs + dt : 0;
    if (this.cafe) {
      this.tickCafe(dt);
      this.tickSqueeze(dt);
      this.tickOrderSpeak(dt);
    }
    if (this.stepKind && this.manager.snapshot().state === 'COOKING') {
      this.emitParticles(this.stepKind, dt);
      this.tickStepSound(dt);
    }
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
      heart: this.vote?.meter.value ?? this.cafe?.meter.value ?? 0,
      ...(this.cafe ? { cafe: this.cafeView() } : {}),
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
      piecesCount: this.current ? (SERVED_COUNT[this.current.art] ?? 4) : 4,
      art: this.current?.art ?? null,
      stepIndex: this.cooking.snapshot().active ? this.cooking.snapshot().stepIndex : 0,
      stepCount: this.current?.steps.length ?? 1,
      serveOutT: this.cafe && this.manager.snapshot().state === 'REWARDING' ? Math.min(1, this.rewardMs / (this.config.durationsMs.rewarding * 0.75)) : 0,
      ...(this.vote ? { vote: this.currentVoteView() } : {}),
      heart: this.vote?.meter.value ?? this.cafe?.meter.value ?? 0,
      ...(this.cafe ? { cafe: this.cafeView() } : {}),
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
      else if (this.cafe) this.openCustomer();
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

  /** Test shortcut: the phone rings now (the ghost calls). False when a ghost is already around or the line is full. */
  callGhostNow(): boolean {
    const cafe = this.cafe;
    if (!cafe) return false;
    const busy = this.phoneRingMs > 0 || this.phoneTalkMs > 0 || cafe.queue.current?.kind === 'phone' || cafe.queue.waiting().some((c) => c.kind === 'phone');
    if (busy || !this.hasRoomForSpecial()) return false;
    const ph = this.config.cafe.surprise.phone;
    this.phoneRingMs = Number.isFinite(ph.ringMs) ? Math.max(1, ph.ringMs) : 3000;
    this.fx?.audio.play('ring', this.soundRound(this.manager.snapshot().roundId));
    return true;
  }

  /** Test shortcut: finishes the dessert that is being cooked. False when nothing is cooking. */
  finishCookingNow(): boolean {
    const m = this.manager.snapshot();
    if (m.state !== 'COOKING') return false;
    this.cooking.addProgress(100, m.roundId);
    return true;
  }

  private ghostCooking(): boolean {
    return !!this.cafe && this.manager.snapshot().state === 'COOKING' && this.cafe.queue.current?.kind === 'phone';
  }

  /** The hungry ghost squeezes if the dessert is not made quickly: tapping hearts loosens it; if it wins, the bonus is lost and a fine is paid. */
  private tickSqueeze(dt: number): void {
    if (this.squeezeFlashMs > 0) this.squeezeFlashMs = Math.max(0, this.squeezeFlashMs - dt);
    if (!this.ghostCooking()) {
      if (this.cafe?.queue.current?.kind !== 'phone') {
        this.squeeze = 0;
        this.squeezed = false;
      }
      return;
    }
    const ph = this.config.cafe.surprise.phone;
    const fill = Number.isFinite(ph.squeezeMs) && ph.squeezeMs > 0 ? ph.squeezeMs : 16_000;
    this.squeeze = Math.min(1, this.squeeze + dt / fill);
    if (this.squeeze >= 1 && !this.squeezed) {
      this.squeezed = true;
      this.squeezeFlashMs = 1800;
      this.squeeze = 0.5; // the ghost loosens its grip for a moment
      const fine = Number.isFinite(ph.fineCoins) ? Math.max(0, Math.floor(ph.fineCoins)) : 0;
      const coins = this.rewards?.profile.coins ?? 0;
      if (fine > 0 && coins > 0) this.rewards?.spend(Math.min(fine, coins));
      this.toastText = 'ผีบีบ! เสียเหรียญ ไม่ได้โบนัส';
      this.fx?.audio.play('ghost', this.soundRound(this.manager.snapshot().roundId));
    }
  }

  private tickOrderSpeak(dt: number): void {
    const o = this.orderSpeak;
    if (!o) return;
    o.ms -= dt;
    if (o.ms > 0) return;
    this.orderSpeak = null;
    const st = this.manager.snapshot().state;
    if (st === 'PREPARING' || st === 'COOKING') this.fx?.audio.speak?.(o.text, this.soundRound(o.roundId), o.pitch, 0.7, o.gender);
  }

  /** Café: the customer at the counter orders; anonymous customers keep the queue full when nobody is gifting. */
  private openCustomer(): void {
    const cafe = this.cafe;
    if (!cafe) return;
    cafe.queue.release();
    if (cafe.queue.waiting().length === 0) this.spawnNpc();
    // Opening time: start with a visible queue instead of an empty shop.
    if (this.lastCookedId === null) {
      for (let i = 0; i <= this.config.cafe.npcMinWaiting && cafe.queue.waiting().length < this.config.cafe.npcMinWaiting + 1; i++) this.spawnNpc();
    }
    const c = cafe.queue.startNext();
    this.current = (c && this.desserts.get(c.dessertId)) || this.desserts.next();
    if (this.current) this.lastCookedId = this.current.id;
    if (c && this.current) {
      // the customer says their order once they have walked up to the counter (a moment after they become the next one)
      const g = genderForSeed(c.seed);
      const ghost = c.kind === 'phone';
      this.orderSpeak = { text: ghost ? `ขอ… ${this.current.nameTh}… หน่อย… จ้ะ` : `เอา… ${this.current.nameTh}… ${politeEnding(g)}`, pitch: ghost ? GHOST_PITCH : g === 'male' ? 0.85 : 1.35, roundId: this.manager.snapshot().roundId, ms: 1100, gender: g };
    }
  }

  private spawnNpc(): void {
    const cafe = this.cafe;
    if (!cafe) return;
    const ids = this.desserts.unlockedIds;
    if (ids.length === 0) return;
    // Without gifts customers always have the everyday dessert; the rest are earned by gifts. (Falls back if it is somehow locked.)
    const preferred = this.config.cafe.defaultDessertId;
    const id = ids.includes(preferred) ? preferred : (ids[Math.floor((cafe.rng ?? Math.random)() * ids.length)] ?? ids[0]);
    if (id) cafe.queue.enqueue({ viewer: false, dessertId: id });
  }

  private tickCafe(dt: number): void {
    const cafe = this.cafe;
    if (!cafe || !this.manager.running) return;
    const sur = this.config.cafe.surprise;
    this.luckyCatMs = Math.max(0, this.luckyCatMs - dt);
    this.vipCooldownMs = Math.max(0, this.vipCooldownMs - dt);
    // Lucky cat: waiting customers are more patient (the one being served never loses patience anyway).
    const left = cafe.queue.tick(dt, this.luckyCatMs > 0 ? sur.luckyCat.patienceSlowdown : 1);
    if (left.length > 0) {
      this.lostCustomers += left.length;
      for (let i = 0; i < left.length * 5; i++) this.fx?.particles?.spawn({ x: WORLD_W / 2 + (i % 5) * 30 - 60, y: 400, vx: (i % 5) * 20 - 40, vy: -80, lifeMs: 700, size: 6, color: 'rgba(120,120,120,0.7)', g: -0.2 });
    }
    this.tickPhone(dt);
    const c = this.config.cafe;
    if (cafe.queue.waiting().length >= c.npcMinWaiting) this.npcTimer = 0;
    else {
      this.npcTimer += dt;
      if (this.npcTimer >= c.npcSpawnEveryMs) {
        this.npcTimer = 0;
        this.spawnNpc();
      }
    }
  }

  /** Follow -> lucky cat; orange heart / fan club -> VIP customer + tip rain. Counts only: nothing about who sent them. */
  private applySurprises(sur: { follows: number; orangeHearts: number }, roundId: number): void {
    const cafe = this.cafe;
    if (!cafe) return;
    const cfg = this.config.cafe.surprise;
    if (sur.follows > 0) {
      this.luckyCatMs = Math.min(cfg.luckyCat.maxMs, this.luckyCatMs + sur.follows * cfg.luckyCat.durationMs);
      this.sparkle(910, 432, 14);
      this.fx?.audio.play('pop', this.soundRound(roundId));
    }
    if (sur.orangeHearts > 0 && this.vipCooldownMs <= 0) {
      this.vipCooldownMs = cfg.vip.cooldownMs;
      const q = cafe.queue;
      if (!q.waiting().some((c) => c.kind === 'vip')) {
        const dessertId = dessertForGift(cfg.vip.minGiftCoins, this.config.cafe.giftTiers, this.desserts.unlockedIds);
        if (dessertId) this.enqueueSpecial({ viewer: false, kind: 'vip', dessertId });
      }
      const tip = Math.min(cfg.tip.max, q.waiting().length * cfg.tip.perCustomer);
      if (tip >= 1 && this.rewards?.addCoins(tip)) {
        this.toastText = `ฝนทิป! +${tip} เหรียญ`;
        this.coinShower();
        this.fx?.audio.play('coin', this.soundRound(roundId));
      }
    }
  }

  /** Room for a VIP or phone order: a free place, or an anonymous filler customer to replace (never a paying viewer). */
  private hasRoomForSpecial(): boolean {
    const q = this.cafe?.queue;
    return !!q && (q.waiting().length < this.config.cafe.maxWaiting || q.waiting().some((c) => c.kind === 'normal' && !c.viewer));
  }

  private enqueueSpecial(n: Parameters<CafeQueue['enqueue']>[0]): boolean {
    const q = this.cafe?.queue;
    if (!q) return false;
    if (q.waiting().length >= this.config.cafe.maxWaiting && !q.displaceAnonymous()) return false;
    return q.enqueue(n) === 'ok';
  }

  /** The phone rings for a few seconds, then a phone-order customer with a deadline joins the line. */
  private tickPhone(dt: number): void {
    const cafe = this.cafe;
    if (!cafe) return;
    const ph = this.config.cafe.surprise.phone;
    if (this.phoneTalkMs > 0) this.phoneTalkMs = Math.max(0, this.phoneTalkMs - dt);
    if (this.phoneRingMs > 0) {
      this.phoneRingMs -= dt;
      if (this.phoneRingMs <= 0) {
        this.phoneRingMs = 0;
        let placed = false;
        // A phone order is not a gift, so it asks for the everyday dessert too.
        const ids = this.desserts.unlockedIds;
        const preferred = this.config.cafe.defaultDessertId;
        const id = ids.includes(preferred) ? preferred : ids[Math.floor((cafe.rng ?? Math.random)() * ids.length)];
        if (id) placed = this.enqueueSpecial({ viewer: false, kind: 'phone', dessertId: id, patienceMs: ph.deadlineMs });
        if (placed) {
          // we pick up: a Thai ghost sobs that it wants a dessert, and then turns up at the counter
          this.phoneTalkMs = 3400;
          const sr = this.soundRound(this.manager.snapshot().roundId);
          this.fx?.audio.play('ghost', sr);
          this.fx?.audio.speak?.('ฮือ ๆ… ช่วยด้วย… ผีอยากกินขนม…', sr, GHOST_PITCH, 0.62, 'female');
        }
        // The line filled up with paying viewers during the ring: try again soon instead of waiting a whole interval.
        if (!placed) this.phoneTimerMs = Math.min(this.phoneTimerMs, PHONE_RETRY_MS);
      }
      return;
    }
    this.phoneTimerMs -= dt;
    if (this.phoneTimerMs > 0) return;
    // Hostile settings must not disable the phone or make it fire every frame.
    const every = Number.isFinite(ph.everyMs) && ph.everyMs > 0 ? ph.everyMs : 100_000;
    const spread = Number.isFinite(ph.jitter) ? Math.min(0.9, Math.max(0, ph.jitter)) : 0.3;
    this.phoneTimerMs = Math.max(1000, every * (1 + spread * ((cafe.rng ?? Math.random)() * 2 - 1)));
    const busy = cafe.queue.current?.kind === 'phone' || cafe.queue.waiting().some((c) => c.kind === 'phone');
    if (!busy && this.hasRoomForSpecial()) {
      this.phoneRingMs = Number.isFinite(ph.ringMs) ? Math.max(1, ph.ringMs) : 3000;
      this.fx?.audio.play('ring', this.soundRound(this.manager.snapshot().roundId));
    }
  }

  /**
   * Surprise sounds can fire in any state. Once a round has been cleaned up (NEXT_DESSERT) its id is dead, so a sound
   * tagged with it could never be stopped by a cleanup: tag it with the round that is about to start instead.
   */
  private soundRound(roundId: number): number {
    return this.manager.snapshot().state === 'NEXT_DESSERT' ? roundId + 1 : roundId;
  }

  private coinShower(): void {
    const particles = this.fx?.particles;
    if (!particles) return;
    // Particles live in the station window's coordinates; negative y reaches the top of the portrait screen.
    for (let i = 0; i < 40; i++) {
      particles.spawn({ x: Math.random() * WORLD_W, y: -880 + Math.random() * 380, vx: (Math.random() - 0.5) * 60, vy: 140 + Math.random() * 120, lifeMs: 2600, size: 9, color: i % 3 === 0 ? '#fff3b0' : '#f6c244' });
    }
  }

  private sparkle(x: number, y: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const a = (Math.PI * 2 * i) / count;
      this.fx?.particles?.spawn({ x, y, vx: Math.cos(a) * 120, vy: Math.sin(a) * 120 - 40, lifeMs: 800, size: 5, color: '#ffe08a', g: 0.2 });
    }
  }

  /** A gift puts that viewer in the queue ordering what the gift value maps to; a full queue still pays the café a flat thank-you. */
  private enqueueGifts(gifts: readonly { coins: number; displayName?: string; avatarUrl?: string }[]): void {
    const cafe = this.cafe;
    if (!cafe) return;
    const anon = this.config.cafe.anonymousNames;
    for (const g of gifts) {
      const dessertId = dessertForGift(g.coins, this.config.cafe.giftTiers, this.desserts.unlockedIds);
      if (!dessertId) continue;
      const r = cafe.queue.enqueue({ viewer: true, name: anon ? null : (g.displayName ?? null), avatarUrl: anon ? null : (g.avatarUrl ?? null), dessertId });
      if (r === 'full') this.rewards?.addCoins(this.config.cafe.overflowGiftCoins);
    }
  }

  private cafeView(): CafeView {
    const cafe = this.cafe as GameCafeMode;
    const toView = (c: Customer, serving: boolean): CustomerView => {
      const d = this.desserts.get(c.dessertId);
      return {
        id: c.id,
        kind: c.kind,
        name: c.name,
        viewer: c.viewer,
        seed: c.seed,
        avatarUrl: c.avatarUrl,
        dessertId: c.dessertId,
        dessertNameTh: d?.nameTh ?? c.dessertId,
        color: d?.palette[0] ?? '#f5f0e1',
        patience: serving ? 1 : Math.min(1, Math.max(0, c.patienceMs / c.patienceMaxMs)),
        serving,
      };
    };
    const waiting = cafe.queue.waiting();
    return {
      serving: cafe.queue.current ? toView(cafe.queue.current, true) : null,
      waiting: waiting.slice(0, Math.max(0, this.config.cafe.visible - 1)).map((c) => toView(c, false)),
      waitingTotal: waiting.length,
      lost: this.lostCustomers,
      giftMenu: this.giftMenuView,
      coins: this.rewards?.profile.coins ?? 0,
      luckyCatSec: this.luckyCatMs / 1000,
      luckyCatBonusPct: this.config.cafe.surprise.luckyCat.payBonusPct,
      phoneRinging: this.phoneRingMs > 0,
      phoneTalking: this.phoneTalkMs > 0,
      squeeze: this.ghostCooking() ? this.squeeze : 0,
      squeezedNow: this.squeezeFlashMs > 0,
      spooky: this.phoneRingMs > 0 || this.phoneTalkMs > 0 || this.cafe?.queue.current?.kind === 'phone' || (this.cafe?.queue.waiting().some((c) => c.kind === 'phone') ?? false),
    };
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
    // Café: the customer pays exactly once, here; a customer who barely waited pays a bonus.
    let who = '';
    if (this.cafe) {
      const paid = this.cafe.queue.pay();
      const sur = this.config.cafe.surprise;
      if (paid) {
        this.bonusPct += paid.happiness * this.config.cafe.payBonusMaxPct;
        if (paid.customer.kind === 'vip') this.bonusPct += sur.vip.payBonusPct;
        if (paid.customer.kind === 'phone' && !this.squeezed) this.bonusPct += sur.phone.payBonusPct;
        who = paid.customer.kind === 'vip' ? 'VIP ' : paid.customer.kind === 'phone' ? (this.squeezed ? 'ผีบีบ! ' : 'ผีพอใจ! ') : paid.customer.name ? `${paid.customer.name} ` : '';
      }
      if (this.luckyCatMs > 0) this.bonusPct += sur.luckyCat.payBonusPct;
    }
    if (!this.rewards || !this.current) return;
    const r = this.rewards.award(this.current, { roundId, bonusPct: this.bonusPct, cookMs: this.clockMs - this.roundStart });
    if (r) {
      this.toastText = `${who}+${r.score} คะแนน +${r.coins} เหรียญ${r.levelUp ? ' • เลเวลอัป!' : ''}`;
      const sr = this.soundRound(roundId);
      this.fx?.audio.play('reward', sr);
      this.fx?.audio.speak?.(`${this.current.nameTh}… เสร็จแล้วค่ะ`, sr, 1.25, 0.75, 'female');
    }
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
    this.stepSound = sound;
    this.soundAcc = 0;
    this.dripAcc = 0;
    fx.audio.play(sound, roundId);
  }

  /** Keeps the cooking sound going for the whole step (not just a blip at its start), with small detail sounds on top. */
  private tickStepSound(dt: number): void {
    const audio = this.fx?.audio;
    const sound = this.stepSound;
    if (!audio || !sound) return;
    const roundId = this.manager.snapshot().roundId;
    const heart = Math.max(1, this.cafe?.meter.value ?? this.vote?.meter.value ?? 0);
    const speed = Number.isFinite(heart) ? Math.min(3, heart) : 1;
    this.soundAcc += dt * (sound === 'stir' || sound === 'sizzle' ? speed : 1);
    this.dripAcc += dt;
    const period: Partial<Record<SoundId, number>> = { stir: 520, pour: 850, syrup: 800, steam: 1200, boil: 1000, sizzle: 1000, pop: 700, arrange: 700, slice: 600 };
    const every = period[sound] ?? 900;
    if (this.soundAcc >= every) {
      this.soundAcc = 0;
      audio.play(sound === 'stir' ? 'slosh' : sound, roundId);
    }
    const detail = sound === 'pour' || sound === 'syrup' ? 'drip' : sound === 'boil' || sound === 'steam' ? 'bubble' : sound === 'stir' ? 'slosh' : null;
    const detailEvery = detail === 'drip' ? 420 : detail === 'bubble' ? 330 : 520;
    if (detail && this.dripAcc >= detailEvery) {
      this.dripAcc = 0;
      if (detail !== 'slosh') audio.play(detail, roundId);
    }
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
    this.stepSound = null;
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
    this.stepSound = null;
    this.stepT = 0;
    this.presentT = null;
    this.emitAcc = 0;
    this.fx?.animations.cancelRound(roundId);
    this.fx?.audio.stopRound(roundId);
    this.fx?.particles?.clear();
    this.vote?.manager.cancel();
    this.vote?.meter.reset();
    this.cafe?.meter.reset();
    this.cafe?.queue.release(); // the counter is never left occupied, whatever ended the round
    this.cooking.setRateMultiplier(1);
  }

  /** One coalesced drain per update; a failing event source can never stop the loop. */
  private applyEvents(): void {
    const events = this.events;
    if (!events) return;
    try {
      const m = this.manager.snapshot();
      const voting = this.vote !== undefined && m.state === 'PREPARING';
      const fx = events.drain({ roundId: m.roundId, startedAtMs: voting ? this.voteStart : this.roundStart, cooking: m.state === 'COOKING', voting, acceptsGifts: this.cafe !== undefined }, this.clockMs);
      if (this.vote) {
        for (const v of fx.votes) this.vote.manager.cast(v.vote, v.userKey, m.roundId, this.clockMs);
        // Hearts feed the meter (which speeds cooking up) instead of adding progress directly.
        this.vote.meter.add(fx.likes * this.config.vote.heartPerLike + fx.follows * this.config.vote.heartPerFollow + fx.hearts * this.config.vote.heartPerHeart);
      } else if (this.cafe) {
        this.enqueueGifts(fx.gifts);
        if (this.manager.running) this.applySurprises(fx.surprises, m.roundId);
        if (this.ghostCooking() && !this.squeezed) {
          const rl = this.config.cafe.surprise.phone.reliefPerLike;
          const relief = (Number.isFinite(rl) ? rl : 0.012) * (fx.likes + fx.hearts * 3);
          this.squeeze = Math.max(0, this.squeeze - (Number.isFinite(relief) ? relief : 0));
        }
        this.cafe.meter.add(fx.likes * this.config.vote.heartPerLike + fx.follows * this.config.vote.heartPerFollow + fx.hearts * this.config.vote.heartPerHeart);
      } else if (fx.progressAdd > 0) this.cooking.addProgress(fx.progressAdd, m.roundId);
      if (fx.completeStep && !this.cafe) this.cooking.completeCurrentStep(m.roundId);
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
