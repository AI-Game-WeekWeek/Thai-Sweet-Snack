export const ANIM_IDS = ['pour', 'stir', 'drizzle', 'steam', 'cut', 'arrange', 'fry', 'shape', 'knead', 'spread', 'boil'] as const;
export const SOUND_IDS = ['pour', 'stir', 'syrup', 'steam', 'slice', 'arrange', 'sizzle', 'boil', 'pop', 'ring', 'coin'] as const;

export type AnimId = (typeof ANIM_IDS)[number];
export type SoundId = (typeof SOUND_IDS)[number];

export interface StepDef {
  id: string;
  nameTh: string;
  anim: AnimId;
  sound: SoundId;
  /** Share of total progress (relative to the other steps). */
  weight: number;
  /** Watchdog: the step is force-completed after this long. */
  maxMs: number;
}

export interface DessertDef {
  id: string;
  nameTh: string;
  nameEn: string;
  unlock: { default: true } | { cost: number };
  ingredients: { id: string; nameTh: string; color: string }[];
  steps: StepDef[];
  presentation: { container: 'tray' | 'box'; layout: 'grid' | 'stack' | 'pile' };
  palette: string[];
  reward: { baseScore: number; baseCoins: number; xp: number };
}
