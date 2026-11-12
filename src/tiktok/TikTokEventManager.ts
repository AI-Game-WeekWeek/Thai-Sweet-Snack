import type { GameConfig } from '../config/gameConfig';
import { LIVE_EVENT_TYPES, type ConnectionState, type Counters, type EventEffects, type LiveEvent } from './types';

export interface RoundInfo {
  roundId: number;
  /** Source-clock time at which the active round started. Older events are stale. */
  startedAtMs: number;
  cooking: boolean;
}

type Ingest = 'queued' | 'duplicate' | 'invalid';

/** Validates, dedupes, queues and coalesces viewer events. Pure: time comes in through drain(). */
export class TikTokEventManager {
  private queue: LiveEvent[] = [];
  private readonly seen = new Map<string, true>();
  private state: ConnectionState = 'offline';
  private readonly counts: Counters = { likes: 0, follows: 0, hearts: 0, gifts: 0, shares: 0 };
  private lastRoseMs = -Infinity;
  private lastBigGiftMs = -Infinity;

  constructor(private readonly config: GameConfig) {}

  get connection(): ConnectionState {
    return this.state;
  }

  get totals(): Counters {
    return { ...this.counts };
  }

  get queueLength(): number {
    return this.queue.length;
  }

  setConnection(s: ConnectionState): void {
    this.state = s;
  }

  ingest(raw: unknown): Ingest {
    const e = this.validate(raw);
    if (!e) return 'invalid';
    if (this.seen.has(e.id)) return 'duplicate';
    this.seen.set(e.id, true);
    if (this.seen.size > this.config.events.dedupeCapacity) {
      const oldest = this.seen.keys().next().value as string;
      this.seen.delete(oldest);
    }
    this.queue.push(e);
    if (this.queue.length > this.config.events.queueMax) this.shrink();
    return 'queued';
  }

  /** Empties the queue into one coalesced result. Safe to call every tick. */
  drain(round: RoundInfo, nowMs: number): EventEffects {
    const cfg = this.config.events;
    const fx: EventEffects = { progressAdd: 0, completeStep: false, roseEffect: false, bigGiftEffect: false, shareBonus: 0, counters: this.counts };
    const batch = this.queue;
    this.queue = [];
    for (const e of batch) {
      try {
        this.count(e);
        if (e.type === 'share') {
          fx.shareBonus += cfg.shareBonusPct;
          continue;
        }
        if (!round.cooking || e.tsMs < round.startedAtMs) continue; // stale or wrong phase: never touches this round
        switch (e.type) {
          case 'like':
            fx.progressAdd += cfg.likeProgress * e.count;
            break;
          case 'follow':
            fx.progressAdd += cfg.followProgress;
            break;
          case 'orangeHeart':
            fx.progressAdd += cfg.heartProgress * e.count;
            break;
          case 'rose':
            if (nowMs - this.lastRoseMs >= cfg.roseCooldownMs) {
              this.lastRoseMs = nowMs;
              fx.roseEffect = true;
            }
            break;
          case 'gift':
            if ((e.giftCoins ?? 0) >= cfg.largeGiftCoins) {
              fx.completeStep = true;
              if (nowMs - this.lastBigGiftMs >= cfg.bigGiftCooldownMs) {
                this.lastBigGiftMs = nowMs;
                fx.bigGiftEffect = true;
              }
            } else {
              fx.progressAdd += cfg.heartProgress; // a small gift counts like a heart
            }
            break;
        }
      } catch (err) {
        console.error('[TikTokEventManager] dropped one event', err);
      }
    }
    fx.counters = { ...this.counts };
    return fx;
  }

  private count(e: LiveEvent): void {
    if (e.type === 'like') this.counts.likes += e.count;
    else if (e.type === 'follow') this.counts.follows += 1;
    else if (e.type === 'orangeHeart') this.counts.hearts += e.count;
    else if (e.type === 'share') this.counts.shares += 1;
    else this.counts.gifts += 1; // rose and gift
  }

  /** Keeps the queue bounded: merge likes first (no data loss), then drop the oldest non-gift events. */
  private shrink(): void {
    const max = this.config.events.queueMax;
    let merged: LiveEvent | null = null;
    const rest: LiveEvent[] = [];
    for (const e of this.queue) {
      if (e.type === 'like') {
        if (merged) {
          merged.count += e.count;
          merged.tsMs = Math.max(merged.tsMs, e.tsMs);
        } else {
          merged = { ...e };
          rest.push(merged);
        }
      } else rest.push(e);
    }
    this.queue = rest;
    while (this.queue.length > max) {
      const i = this.queue.findIndex((e) => e.type !== 'gift');
      this.queue.splice(i === -1 ? 0 : i, 1);
    }
  }

  private validate(raw: unknown): LiveEvent | null {
    if (typeof raw !== 'object' || raw === null) return null;
    const o = raw as Record<string, unknown>;
    if (typeof o.id !== 'string' || o.id.length === 0 || o.id.length > 128) return null;
    if (typeof o.type !== 'string' || !(LIVE_EVENT_TYPES as readonly string[]).includes(o.type)) return null;
    if (typeof o.count !== 'number' || !Number.isFinite(o.count) || o.count < 1) return null;
    const maxCount = o.type === 'like' ? this.config.events.maxLikeCountPerEvent : 1e6;
    if (o.count > maxCount) return null;
    if (typeof o.tsMs !== 'number' || !Number.isFinite(o.tsMs)) return null;
    if (o.giftCoins !== undefined && (typeof o.giftCoins !== 'number' || !Number.isFinite(o.giftCoins) || o.giftCoins < 0)) return null;
    return {
      id: o.id,
      type: o.type as LiveEvent['type'],
      count: Math.floor(o.count),
      tsMs: o.tsMs,
      ...(typeof o.user === 'string' ? { user: o.user.slice(0, 64) } : {}),
      ...(typeof o.giftCoins === 'number' ? { giftCoins: o.giftCoins } : {}),
    };
  }
}
