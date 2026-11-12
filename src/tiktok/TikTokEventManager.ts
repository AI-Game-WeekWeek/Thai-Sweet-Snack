import type { GameConfig } from '../config/gameConfig';
import { parseLiveEvent } from './parseLiveEvent';
import type { ConnectionState, Counters, EventEffects, LiveEvent } from './types';

export interface RoundInfo {
  roundId: number;
  /** Source-clock time at which the active round started. Older events are stale. */
  startedAtMs: number;
  cooking: boolean;
  /** True during the menu vote window: comments count as votes. */
  voting?: boolean;
  /** Café mode: gifts and roses are reported in `gifts` in every state (they are not tied to a round). */
  acceptsGifts?: boolean;
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

  /**
   * `receivedAtMs` (game clock) makes the provider's timestamp advisory: it is never later than the receive time,
   * and never earlier than `maxSourceLagMs` before it. Provider clock skew can then not leak old events into a new
   * dessert (ahead) nor swallow a whole round (behind, or timestamps in seconds).
   */
  ingest(raw: unknown, receivedAtMs?: number): Ingest {
    const e = this.validate(raw);
    if (!e) return 'invalid';
    if (receivedAtMs !== undefined && Number.isFinite(receivedAtMs)) {
      e.tsMs = Math.max(Math.min(e.tsMs, receivedAtMs), receivedAtMs - this.config.events.maxSourceLagMs);
    }
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
    const cfg = { ...this.config.events, maxGiftsPerDrain: this.config.cafe.maxGiftsPerDrain };
    const fx: EventEffects = { progressAdd: 0, completeStep: false, roseEffect: false, bigGiftEffect: false, shareBonus: 0, votes: [], likes: 0, follows: 0, hearts: 0, gifts: [], counters: this.counts };
    const batch = this.queue;
    this.queue = [];
    const deferred: LiveEvent[] = [];
    for (const e of batch) {
      try {
        // Over the per-drain gift cap: keep the gift for the next drain instead of losing it.
        if ((e.type === 'gift' || e.type === 'rose') && round.acceptsGifts && fx.gifts.length >= cfg.maxGiftsPerDrain) {
          deferred.push(e);
          continue;
        }
        if (e.type === 'comment') {
          if (round.voting && e.tsMs >= round.startedAtMs && e.vote !== undefined) {
            fx.votes.push({ vote: e.vote, ...(e.userId !== undefined ? { userKey: e.userId } : {}) });
          }
          continue;
        }
        this.count(e);
        if ((e.type === 'gift' || e.type === 'rose') && round.acceptsGifts && fx.gifts.length < cfg.maxGiftsPerDrain) {
          fx.gifts.push({
            coins: e.giftCoins ?? 1,
            kind: e.type,
            ...(e.displayName !== undefined ? { displayName: e.displayName } : {}),
            ...(e.avatarUrl !== undefined ? { avatarUrl: e.avatarUrl } : {}),
          });
        }
        if (e.type === 'share') {
          fx.shareBonus += cfg.shareBonusPct;
          continue;
        }
        if (!round.cooking || e.tsMs < round.startedAtMs) continue; // stale or wrong phase: never touches this round
        switch (e.type) {
          case 'like':
            fx.progressAdd += cfg.likeProgress * e.count;
            fx.likes += e.count;
            break;
          case 'follow':
            fx.progressAdd += cfg.followProgress;
            fx.follows += 1;
            break;
          case 'orangeHeart':
            fx.progressAdd += cfg.heartProgress * e.count;
            fx.hearts += e.count;
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
              fx.hearts += 1;
            }
            break;
        }
      } catch (err) {
        console.error('[TikTokEventManager] dropped one event', err);
      }
    }
    this.queue = deferred;
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
      const i = this.queue.findIndex((e) => e.type !== 'gift' && e.type !== 'rose');
      this.queue.splice(i === -1 ? 0 : i, 1);
    }
  }

  private validate(raw: unknown): LiveEvent | null {
    return parseLiveEvent(raw, this.config.events.maxLikeCountPerEvent);
  }
}
