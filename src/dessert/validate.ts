import { ANIM_IDS, SOUND_IDS, type DessertDef } from './types';

/** Returns a list of errors (empty = valid). Unknown anim/sound ids only warn: Phase 3 falls back at runtime. */
export function validateDessert(def: DessertDef): string[] {
  const errors: string[] = [];
  const tag = def.id || '(no id)';
  if (!def.id) errors.push('missing id');
  if (!def.nameTh.trim()) errors.push(`${tag}: empty nameTh`);
  if (def.ingredients.length === 0) errors.push(`${tag}: no ingredients`);
  if (def.steps.length === 0) errors.push(`${tag}: no steps`);

  const seen = new Set<string>();
  for (const st of def.steps) {
    if (seen.has(st.id)) errors.push(`${tag}: duplicate step id ${st.id}`);
    seen.add(st.id);
    if (!Number.isFinite(st.weight) || st.weight <= 0) errors.push(`${tag}/${st.id}: weight must be > 0`);
    if (!Number.isFinite(st.maxMs) || st.maxMs <= 0) errors.push(`${tag}/${st.id}: maxMs must be > 0`);
    if (!(ANIM_IDS as readonly string[]).includes(st.anim)) console.warn(`[dessert] ${tag}/${st.id}: unknown anim "${st.anim}"`);
    if (!(SOUND_IDS as readonly string[]).includes(st.sound)) console.warn(`[dessert] ${tag}/${st.id}: unknown sound "${st.sound}"`);
  }
  return errors;
}
