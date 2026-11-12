export interface ProfileData {
  version: 1;
  score: number;
  coins: number;
  xp: number;
  rounds: number;
  collection: Record<string, number>;
  unlocked: string[];
}

export interface RewardResult {
  roundId: number;
  dessertId: string;
  score: number;
  coins: number;
  xp: number;
  levelUp: boolean;
}

export function defaultProfile(defaultUnlocked: readonly string[]): ProfileData {
  return { version: 1, score: 0, coins: 0, xp: 0, rounds: 0, collection: {}, unlocked: [...defaultUnlocked] };
}
