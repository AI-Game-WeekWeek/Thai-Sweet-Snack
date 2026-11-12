import type { ArtId } from '../dessert/types';

/** Cooking pictures per recipe step (one or several pictures side by side). A step without pictures keeps the shapes. */
export const COOK_PICS: Record<ArtId, readonly (readonly string[])[]> = {
  parcel: [['ktm-3', 'ktm-4'], ['ktm-5', 'ktm-6'], ['ktm-9'], ['ktm-10'], ['ktm-12'], ['ktm-11']],
  layered: [['chan-3'], ['chan-3', 'chan-4'], ['chan-5'], ['chan-7'], ['chan-8'], ['chan-9']],
  fruit: [['lukchup-9'], ['lukchup-10'], ['lukchup-11', 'lukchup-12'], ['lukchup-13'], ['lukchup-14'], ['lukchup-15']],
  thread: [['foithong-4'], ['foithong-5'], ['foithong-6'], ['foithong-7'], ['foithong-8'], ['foithong-2']],
  flower: [['thongyipA-4'], ['thongyipA-5'], ['thongyipA-6'], ['thongyipA-7'], ['thongyipA-1']],
  syrupBall: [['thongyod2-1'], ['thongyodA-5'], ['thongyod2-2'], ['thongyod2-3'], ['thongyodA-2']],
  bowl: [['bualoy-3', 'bualoy-4', 'bualoy-5'], ['bualoy-6'], ['bualoy-7'], ['bualoy-11'], ['bualoy-9']],
  crepe: [['crepe-4'], ['crepe-5'], ['crepe-7'], ['crepe-8'], ['crepe-9'], ['crepe-1']],
};

/** The finished look on the tray (cycled when several). */
export const SERVED_PICS: Record<ArtId, readonly string[]> = {
  parcel: ['ktm-11'],
  layered: ['chan-1', 'chan-1', 'chan-2'],
  fruit: ['lukchup-1', 'lukchup-2', 'lukchup-3', 'lukchup-4', 'lukchup-5', 'lukchup-6', 'lukchup-7', 'lukchup-8'],
  thread: ['foithong-1'],
  flower: ['thongyipA-1'],
  syrupBall: ['thongyodA-1'],
  bowl: ['bualoy-2', 'bualoy-10', 'bualoy-1'],
  crepe: ['crepe-1'],
};

/** Small menu picture per dessert id (gift board, order bubble). The first uses the cover picture. */
export const ICON_PICS: Record<string, string> = {
  'khao-tom-mat': 'ktmCover-1',
  'bua-loy': 'menu-2',
  'thong-yod': 'menu-3',
  'khanom-chan': 'menu-4',
  'foi-thong': 'menu-5',
  'thong-yip': 'menu-6',
  'luk-chup': 'menu-7',
  'khanom-buang': 'menu-8',
};

/** Cafe pieces. */
export const CAFE_PICS = {
  bgDay: 'bg-day',
  bgRain: 'bg-rain',
  bgNight: 'bg-night',
  logo: 'logo-1',
  catUp: 'prop-1',
  catDown: 'prop-2',
  phoneStill: 'prop-3',
  phoneRing: 'prop-4',
  bodies: ['prop-6', 'prop-7', 'prop-8', 'prop-9'],
  crown: 'prop-11',
  coin: 'prop-12',
  glow: 'fx-21',
} as const;

function allNames(): string[] {
  const s = new Set<string>();
  Object.values(COOK_PICS).forEach((st) => st.forEach((p) => p.forEach((n) => s.add(n))));
  Object.values(SERVED_PICS).forEach((p) => p.forEach((n) => s.add(n)));
  Object.values(ICON_PICS).forEach((n) => s.add(n));
  Object.values(CAFE_PICS).forEach((v) => (Array.isArray(v) ? v.forEach((n) => s.add(n)) : s.add(v as string)));
  return [...s];
}
export const ALL_PIC_NAMES: readonly string[] = allNames();
