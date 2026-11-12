import type { GameConfig } from '../config/gameConfig';
import type { DessertDef } from '../dessert/types';
import { defaultProfile, type ProfileData, type RewardResult } from './types';

const MAX_BONUS_PCT = 1000;

export interface AwardContext {
  roundId: number;
  /** Share bonus, percent. */
  bonusPct: number;
  /** Cooking time in ms (game clock). */
  cookMs: number;
}

/** Owns the persisted profile and turns finished rounds into score, coins and xp. */
export class RewardManager {
  private data: ProfileData;
  private lastRound = 0;
  private lastResult: RewardResult | null = null;

  constructor(
    private readonly config: GameConfig,
    profile: ProfileData = defaultProfile([]),
  ) {
    this.data = profile;
  }

  get profile(): Readonly<ProfileData> {
    return this.data;
  }

  get last(): RewardResult | null {
    return this.lastResult;
  }

  get level(): number {
    return this.levelFor(this.data.xp);
  }

  replaceProfile(p: ProfileData): void {
    this.data = p;
    this.lastRound = 0;
    this.lastResult = null;
  }

  /** Idempotent per round: repeats return the same result; older rounds return null. */
  award(def: DessertDef, ctx: AwardContext): RewardResult | null {
    if (ctx.roundId === this.lastRound && this.lastResult) return this.lastResult;
    if (ctx.roundId < this.lastRound) return null;

    const bonus = Number.isFinite(ctx.bonusPct) ? Math.min(MAX_BONUS_PCT, Math.max(0, ctx.bonusPct)) : 0;
    const { speedParMs, speedBonusMaxPct } = this.config.reward;
    const validTime = Number.isFinite(ctx.cookMs) && ctx.cookMs >= 0;
    const speedPct = validTime ? speedBonusMaxPct * (1 - Math.min(1, ctx.cookMs / speedParMs)) : 0;
    const mult = 1 + (bonus + speedPct) / 100;

    const before = this.level;
    const result: RewardResult = {
      roundId: ctx.roundId,
      dessertId: def.id,
      score: Math.round(def.reward.baseScore * mult),
      coins: Math.round(def.reward.baseCoins * mult),
      xp: def.reward.xp,
      levelUp: false,
    };
    this.data = {
      ...this.data,
      score: this.data.score + result.score,
      coins: this.data.coins + result.coins,
      xp: this.data.xp + result.xp,
      rounds: this.data.rounds + 1,
      collection: { ...this.data.collection, [def.id]: (this.data.collection[def.id] ?? 0) + 1 },
    };
    result.levelUp = this.level > before;
    this.lastRound = ctx.roundId;
    this.lastResult = result;
    return result;
  }

  /** Extra coins that are not tied to a finished round (e.g. a gift when the queue is full). */
  addCoins(coins: number): boolean {
    if (!Number.isFinite(coins) || coins > 1_000_000 || Math.floor(coins) < 1) return false;
    this.data = { ...this.data, coins: this.data.coins + Math.floor(coins) };
    return true;
  }

  spend(coins: number): boolean {
    if (!Number.isFinite(coins) || coins < 0 || coins > this.data.coins) return false;
    this.data = { ...this.data, coins: this.data.coins - coins };
    return true;
  }

  /** Marks a dessert unlocked (no cost check: ProgressionManager decides). Returns false if it already was. */
  addUnlocked(id: string): boolean {
    if (this.data.unlocked.includes(id)) return false;
    this.data = { ...this.data, unlocked: [...this.data.unlocked, id] };
    return true;
  }

  private levelFor(xp: number): number {
    let level = 1;
    let need = this.config.reward.xpBase;
    let cumulative = 0;
    while (level < 1000 && xp >= cumulative + need) {
      cumulative += need;
      need *= this.config.reward.xpGrowth;
      level++;
    }
    return level;
  }
}
