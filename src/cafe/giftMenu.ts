export interface GiftTier {
  minCoins: number;
  dessertId: string;
}

/**
 * Which dessert a gift of `coins` orders: the highest tier not above the value. A tier whose dessert is not unlocked
 * falls back to the best unlocked tier below it, then to the cheapest unlocked tier. null only if nothing is unlocked.
 * An unknown or invalid value counts as 1 coin.
 */
export function dessertForGift(coins: number | undefined, tiers: readonly GiftTier[], unlocked: readonly string[]): string | null {
  const value = typeof coins === 'number' && !Number.isNaN(coins) && coins > 0 ? coins : 1;
  const sorted = [...tiers].sort((a, b) => a.minCoins - b.minCoins);
  const eligible = sorted.filter((t) => t.minCoins <= value);
  for (let i = eligible.length - 1; i >= 0; i--) {
    const t = eligible[i] as GiftTier;
    if (unlocked.includes(t.dessertId)) return t.dessertId;
  }
  const cheapest = sorted.find((t) => unlocked.includes(t.dessertId));
  if (cheapest) return cheapest.dessertId;
  return unlocked[0] ?? null;
}
