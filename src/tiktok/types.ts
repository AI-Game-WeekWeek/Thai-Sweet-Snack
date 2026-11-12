export const LIVE_EVENT_TYPES = ['like', 'follow', 'orangeHeart', 'rose', 'gift', 'share'] as const;
export type LiveEventType = (typeof LIVE_EVENT_TYPES)[number];
export type ConnectionState = 'connected' | 'reconnecting' | 'offline';

/** Normalized event shape produced by the mock source and by the Phase 7 bridge. */
export interface LiveEvent {
  /** Unique per event; used for dedupe. */
  id: string;
  type: LiveEventType;
  /** Like batch size, heart count, ...; 1 for single-shot events. */
  count: number;
  /** Source timestamp (ms). */
  tsMs: number;
  user?: string;
  /** Gift value in coins, when known. */
  giftCoins?: number;
}

export interface Counters {
  likes: number;
  follows: number;
  hearts: number;
  gifts: number;
  shares: number;
}

export interface EventEffects {
  progressAdd: number;
  completeStep: boolean;
  roseEffect: boolean;
  bigGiftEffect: boolean;
  /** Percent bonus accumulated from shares in this drain. */
  shareBonus: number;
  counters: Counters;
}
