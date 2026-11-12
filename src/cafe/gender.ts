/**
 * The customer figure's gender, decided only by the customer's seed (the painted outfit picked from it), so what the
 * viewer sees and what the voice says always agree. It says nothing about a real viewer; no such data is read or kept.
 */
export type Gender = 'male' | 'female';

/** Outfit index 0..3 for a seed (same rule the renderer uses). */
export function outfitIndex(seed: number): number {
  return Math.abs(Math.floor(Number.isFinite(seed) ? seed : 0)) % 4;
}

/** Outfits 0 and 2 are the boy/man outfits, 1 and 3 the girl/woman outfits. */
export function genderForSeed(seed: number): Gender {
  return outfitIndex(seed) % 2 === 0 ? 'male' : 'female';
}

/** The polite particle: ครับ for male, ค่ะ for female. */
export function politeEnding(g: Gender): string {
  return g === 'male' ? 'ครับ' : 'ค่ะ';
}
