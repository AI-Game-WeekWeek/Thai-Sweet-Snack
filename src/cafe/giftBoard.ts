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

/** A slot may list several gifts separated by commas (all the 1-coin gifts share the first slot). */
export const DEFAULT_GIFT_BOARD: readonly GiftSlot[] = [
  { coins: 1, gift: "Rose, You're awesome, Ice Cream Cone, Chili, Steven Wingman, Mamma Mia, Level-up Sparks" },
  { coins: 5, gift: 'Choc Chip Cookie' },
  { coins: 10, gift: 'Ice Lolly' },
  { coins: 20, gift: '' },
  { coins: 50, gift: '' },
  { coins: 99, gift: '' },
  { coins: 199, gift: '' },
  { coins: 500, gift: '' },
];

/** The gift names of a slot ("A, B" -> ["A", "B"]). */
export function giftNames(slot: Pick<GiftSlot, 'gift'>): string[] {
  return String(slot.gift ?? '').split(',').map((n) => n.trim()).filter((n) => n !== '');
}

/** "Ice Cream Cone" -> "icecreamcone": how a gift name is compared and named in files. */
export function giftKey(name: string): string {
  return String(name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Cleans a slot's gift list typed by the streamer: printable, a few names. */
export function cleanGiftList(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.split(',').slice(0, 12).map(cleanGiftName).filter((n) => n !== '').join(', ').slice(0, 300);
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
    out.push({ coins: o.coins, gift: cleanGiftList(o.gift) });
  }
  return out;
}
