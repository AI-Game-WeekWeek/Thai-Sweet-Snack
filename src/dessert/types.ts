export const ANIM_IDS = ['pour', 'stir', 'drizzle', 'steam', 'cut', 'arrange', 'fry', 'shape', 'knead', 'spread', 'boil'] as const;
export const SOUND_IDS = ['pour', 'stir', 'syrup', 'steam', 'slice', 'arrange', 'sizzle', 'boil', 'pop', 'ring', 'coin', 'slosh', 'drip', 'bubble'] as const;

/** Each dessert has its own cooking scene and served look (no shared base). */
export const ART_IDS = ['parcel', 'layered', 'fruit', 'thread', 'flower', 'syrupBall', 'bowl', 'crepe'] as const;

export type AnimId = (typeof ANIM_IDS)[number];
export type ArtId = (typeof ART_IDS)[number];
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
  /** Which scene is drawn while cooking and how the finished dessert looks. */
  art: ArtId;
  steps: StepDef[];
  presentation: { container: 'tray' | 'box'; layout: 'grid' | 'stack' | 'pile' | 'parcels' };
  palette: string[];
  reward: { baseScore: number; baseCoins: number; xp: number };
}
