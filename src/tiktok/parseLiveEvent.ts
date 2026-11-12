import { cleanName } from './cleanName';
import { LIVE_EVENT_TYPES, type LiveEvent } from './types';

/** Shared by the game and the bridge so both reject exactly the same garbage. Returns null when invalid. */
export function parseLiveEvent(raw: unknown, maxLikeCount: number): LiveEvent | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || o.id.length === 0 || o.id.length > 128) return null;
  if (typeof o.type !== 'string' || !(LIVE_EVENT_TYPES as readonly string[]).includes(o.type)) return null;
  if (o.type === 'comment') return parseComment(o);
  const count = o.count === undefined ? 1 : o.count; // single events (gift, follow, ...) may omit it
  if (typeof count !== 'number' || !Number.isFinite(count) || count < 1) return null;
  const maxCount = o.type === 'like' ? maxLikeCount : 1e6;
  if (count > maxCount) return null;
  if (typeof o.tsMs !== 'number' || !Number.isFinite(o.tsMs)) return null;
  if (o.giftCoins !== undefined && (typeof o.giftCoins !== 'number' || !Number.isFinite(o.giftCoins) || o.giftCoins < 0)) return null;
  const giftLike = o.type === 'gift' || o.type === 'rose';
  const displayName = giftLike && typeof o.displayName === 'string' ? cleanName(o.displayName, 32) : '';
  const avatarUrl = giftLike && typeof o.avatarUrl === 'string' && SAFE_URL.test(o.avatarUrl) && o.avatarUrl.length <= 512 ? o.avatarUrl : '';
  return {
    id: o.id,
    type: o.type as LiveEvent['type'],
    count: Math.floor(count),
    tsMs: o.tsMs,
    ...(typeof o.giftCoins === 'number' ? { giftCoins: o.giftCoins } : {}),
    ...(displayName !== '' ? { displayName } : {}),
    ...(avatarUrl !== '' ? { avatarUrl } : {}),
  };
}

/** https only, no whitespace; the game additionally checks its host allowlist before loading anything. */
const SAFE_URL = /^https:\/\/\S+$/i;

const VOTE = /^\s*#?([1-3])\s*$/;

/** A comment is only useful as a vote ("1", "2", "3", "#2"). Everything else is dropped; the text is never kept. */
function parseComment(o: Record<string, unknown>): LiveEvent | null {
  if (typeof o.tsMs !== 'number' || !Number.isFinite(o.tsMs)) return null;
  let vote: number;
  if (o.text === undefined && o.vote !== undefined) {
    // Already reduced to a vote number (the bridge relays comments in this form).
    if (typeof o.vote !== 'number' || !Number.isInteger(o.vote) || o.vote < 1 || o.vote > 3) return null;
    vote = o.vote;
  } else {
    if (typeof o.text !== 'string' || o.text.length > 200) return null;
    const m = VOTE.exec(o.text);
    if (!m) return null;
    vote = Number(m[1]);
  }
  return {
    id: o.id as string,
    type: 'comment',
    count: 1,
    tsMs: o.tsMs,
    vote,
    ...(typeof o.userId === 'string' && o.userId.length > 0 ? { userId: o.userId.slice(0, 64) } : {}),
  };
}

/** A well-formed comment that is simply not a vote ("อร่อยมาก", "hi"): fine to ignore, not an error to retry. */
export function isChatterComment(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null) return false;
  const o = raw as Record<string, unknown>;
  return o.type === 'comment' && typeof o.id === 'string' && o.id.length > 0 && typeof o.text === 'string';
}
