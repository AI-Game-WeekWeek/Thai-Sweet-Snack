export interface AvatarSpec {
  /** Background colour of the round head slot. */
  bg: string;
  fg: string;
  skin: string;
  /** First letter or digit of the name, or null (then a simple face is drawn). */
  initial: string | null;
}

const BGS = ['#e06666', '#f6b26b', '#f1c232', '#93c47d', '#76a5af', '#6fa8dc', '#8e7cc3', '#c27ba0'] as const;
const SKINS = ['#f5d0b0', '#e8b98f', '#c98f66', '#a9714a'] as const;

/** Deterministic generated avatar for a customer (used whenever there is no picture). */
export function avatarSpec(seed: number, name: string | null): AvatarSpec {
  const s = Number.isFinite(seed) ? Math.abs(Math.floor(seed)) % 1_000_000 : 0;
  const first = name ? Array.from(name).find((ch) => /[\p{L}\p{N}]/u.test(ch)) : undefined;
  return {
    bg: BGS[s % BGS.length] as string,
    fg: '#ffffff',
    skin: SKINS[Math.floor(s / BGS.length) % SKINS.length] as string,
    initial: first ? first.toUpperCase() : null,
  };
}
