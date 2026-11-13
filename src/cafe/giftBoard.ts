/**
 * The TikTok gift shown for each menu slot (slot = the coin tier). The 1-coin slot is free (anyone who likes or joins),
 * so it has no gift. Shared by the game and the bridge; the streamer can change it on the bridge's /gifts page.
 */
export interface GiftSlot {
  /** The tier (coins) this slot belongs to: the same numbers as cafe.giftTiers. */
  coins: number;
  /** TikTok gift name, or '' for the free slot. */
  gift: string;
}

export const DEFAULT_GIFT_BOARD: readonly GiftSlot[] = [
  { coins: 1, gift: '' },
  { coins: 5, gift: 'Rose' },
  { coins: 10, gift: "You're awesome" },
  { coins: 20, gift: 'Ice Cream Cone' },
  { coins: 50, gift: 'Ice Lolly' },
  // Chili and Steven Wingman cost 1 coin each, so they come early, right after Ice Lolly
  { coins: 99, gift: 'Chili' },
  { coins: 199, gift: 'Steven Wingman' },
  { coins: 500, gift: 'Choc Chip Cookie' },
];

/** "Ice Cream Cone" -> "icecreamcone": how a gift name is compared and named in files. */
export function giftKey(name: string): string {
  return String(name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Cleans a gift name typed by the streamer or sent by a provider: printable, short. */
export function cleanGiftName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 32);
}

/** Validates a board sent from outside; returns null when it is not usable. */
export function parseGiftBoard(raw: unknown, validCoins: readonly number[]): GiftSlot[] | null {
  if (!Array.isArray(raw) || raw.length > 16) return null;
  const out: GiftSlot[] = [];
  const seenCoins = new Set<number>();
  for (const r of raw) {
    if (typeof r !== 'object' || r === null) return null;
    const o = r as Record<string, unknown>;
    if (typeof o.coins !== 'number' || !validCoins.includes(o.coins) || seenCoins.has(o.coins)) return null;
    seenCoins.add(o.coins);
    out.push({ coins: o.coins, gift: cleanGiftName(o.gift) });
  }
  return out;
}
