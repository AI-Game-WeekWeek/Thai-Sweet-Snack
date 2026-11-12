import { LIVE_EVENT_TYPES, type LiveEvent } from './types';

/** Shared by the game and the bridge so both reject exactly the same garbage. Returns null when invalid. */
export function parseLiveEvent(raw: unknown, maxLikeCount: number): LiveEvent | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || o.id.length === 0 || o.id.length > 128) return null;
  if (typeof o.type !== 'string' || !(LIVE_EVENT_TYPES as readonly string[]).includes(o.type)) return null;
  if (typeof o.count !== 'number' || !Number.isFinite(o.count) || o.count < 1) return null;
  const maxCount = o.type === 'like' ? maxLikeCount : 1e6;
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
