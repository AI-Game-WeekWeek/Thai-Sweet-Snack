import type { ArtId } from '../dessert/types';

/** How a picture moves while cooking (all amounts in station-world pixels or radians). */
export type Motion =
  | { m: 'rock'; a: number; speed?: number }
  | { m: 'orbit'; r: number; speed?: number; tilt?: number }
  | { m: 'dip'; h: number; speed?: number }
  | { m: 'slide'; dx: number; dy?: number; speed?: number }
  | { m: 'pulse'; k: number; speed?: number }
  | { m: 'squash'; k: number; speed?: number }
  | { m: 'gather'; dx: number; dy?: number; speed?: number }
  | { m: 'swing'; a: number; px: number; py: number; speed?: number };

/** One picture in a cooking scene. `fade` cross-fades it in or out across the step (a thing being made or changed). */
export interface Layer {
  pic: string;
  x: number;
  y: number;
  size: number;
  motion?: Motion;
  fade?: 'in' | 'out';
  /** After everything else, draw this picture again below this world y, so things (a spoon) dip behind its front rim. */
  front?: number;
}
/** Moving effects drawn over the scene (steam, bubbles, sparkles, falling drops). */
export interface Fx {
  kind: 'steam' | 'bubbles' | 'sparkle' | 'drop';
  x: number;
  y: number;
  w?: number;
  n?: number;
  color?: string;
}
export interface StageSpec {
  layers: readonly Layer[];
  fx?: readonly Fx[];
}

/** Gift emoji pictures by gift key (see giftKey): shown on the menu boards. */
export const GIFT_PICS: Record<string, string> = {
  rose: 'gift-rose',
  youreawesome: 'gift-youreawesome',
  icecreamcone: 'gift-icecreamcone',
  icelolly: 'gift-icelolly',
  chocchipcookie: 'gift-chocchipcookie',
  chili: 'gift-chili',
  mammamia: 'gift-mammamia',
  levelupsparks: 'gift-levelupsparks',
  stevenwingman: 'gift-stevenwingman',
};

export const FX_PICS = { steam: ['fx-1', 'fx-2', 'fx-3'], bubbles: ['fx-4', 'fx-5'], sparkle: ['fx-6', 'fx-7'] } as const;

const L = (pic: string, x: number, y: number, size: number, motion?: Motion, fade?: 'in' | 'out', front?: number): Layer => ({ pic, x, y, size, ...(motion ? { motion } : {}), ...(fade ? { fade } : {}), ...(front !== undefined ? { front } : {}) });
const YOLK = '#f6b21b';
const rock = (a: number, speed = 1): Motion => ({ m: 'rock', a, speed });
const orbit = (r: number, tilt = 0.12, speed = 1): Motion => ({ m: 'orbit', r, tilt, speed });

/** Cooking scenes per recipe step, in the 1000x600 station world. A step without loaded pictures keeps the shapes. */
export const COOK_SCENES: Record<ArtId, readonly StageSpec[]> = {
  parcel: [
    { layers: [L('ktm-3', 500, 385, 280, undefined, undefined, 385), L('ktm-4', 548, 300, 250, orbit(30, 0.16, 1.4))], fx: [{ kind: 'sparkle', x: 410, y: 330, w: 200, n: 3 }] },
    { layers: [L('ktm-5', 270, 400, 230, { m: 'dip', h: 18, speed: 1.2 }), L('ktm-6', 740, 400, 230, { m: 'dip', h: 18, speed: 1.2 }), L('ktm-7', 500, 405, 300, undefined, 'out'), L('ktm-8', 500, 405, 300, undefined, 'in')], fx: [{ kind: 'drop', x: 500, y: 250, w: 160, n: 2, color: '#2b2430' }, { kind: 'drop', x: 520, y: 250, w: 140, n: 2, color: '#f4d35e' }] },
    { layers: [L('ktm-8', 500, 395, 300, { m: 'squash', k: 0.05, speed: 1.4 }, 'out'), L('ktm-9', 500, 395, 320, { m: 'squash', k: 0.06, speed: 1.4 }, 'in')] },
    { layers: [L('ktm-9', 500, 395, 320, rock(0.05, 1.6), 'out'), L('ktm-10', 500, 385, 310, rock(0.05, 1.6), 'in')], fx: [{ kind: 'sparkle', x: 500, y: 350, w: 220, n: 3 }] },
    { layers: [L('ktm-12', 500, 380, 330, rock(0.015, 2))], fx: [{ kind: 'steam', x: 500, y: 250, w: 220, n: 3 }, { kind: 'bubbles', x: 500, y: 330, w: 240, n: 3 }] },
    { layers: [L('ktm-11', 500, 385, 320, { m: 'pulse', k: 0.03, speed: 1.2 })], fx: [{ kind: 'sparkle', x: 500, y: 360, w: 300, n: 5 }] },
  ],
  layered: [
    { layers: [L('chan-3', 500, 385, 320, rock(0.04, 1.4))], fx: [{ kind: 'sparkle', x: 500, y: 340, w: 260, n: 3 }] },
    { layers: [L('chan-3', 300, 395, 270, rock(0.04, 1.3)), L('chan-4', 700, 395, 270, rock(0.04, 1.6))], fx: [{ kind: 'drop', x: 700, y: 270, w: 80, n: 2, color: '#7fc46a' }] },
    { layers: [L('chan-5', 500, 385, 330, rock(0.012, 2), 'out'), L('chan-6', 500, 385, 330, rock(0.012, 2), 'in')], fx: [{ kind: 'drop', x: 500, y: 240, w: 120, n: 2, color: '#fdfaf0' }, { kind: 'steam', x: 500, y: 270, w: 220, n: 2 }] },
    { layers: [L('chan-6', 500, 385, 330, rock(0.012, 2), 'out'), L('chan-7', 500, 385, 330, rock(0.012, 2), 'in')], fx: [{ kind: 'steam', x: 500, y: 250, w: 240, n: 3 }, { kind: 'bubbles', x: 500, y: 330, w: 240, n: 3 }] },
    { layers: [L('chan-8', 500, 385, 330, rock(0.01, 1.2))], fx: [{ kind: 'steam', x: 500, y: 280, w: 200, n: 2 }, { kind: 'sparkle', x: 500, y: 350, w: 260, n: 3 }] },
    { layers: [L('chan-9', 500, 395, 340, { m: 'dip', h: 22, speed: 2.6 })], fx: [{ kind: 'sparkle', x: 500, y: 360, w: 280, n: 3 }] },
  ],
  fruit: [
    { layers: [L('lukchup-9', 500, 385, 300, rock(0.05, 1.8))], fx: [{ kind: 'steam', x: 500, y: 260, w: 200, n: 2 }, { kind: 'bubbles', x: 500, y: 350, w: 180, n: 2 }] },
    { layers: [L('lukchup-10', 500, 400, 320, { m: 'pulse', k: 0.04, speed: 1.6 })], fx: [{ kind: 'sparkle', x: 500, y: 370, w: 300, n: 4 }] },
    { layers: [L('lukchup-10', 370, 420, 280), L('lukchup-12', 720, 400, 210), L('lukchup-11', 540, 300, 250, { m: 'slide', dx: 120, dy: 18, speed: 1.8 })] },
    { layers: [L('lukchup-13', 500, 370, 300, { m: 'dip', h: 46, speed: 1.4 })], fx: [{ kind: 'drop', x: 500, y: 330, w: 120, n: 3, color: '#f4c24a' }] },
    { layers: [L('lukchup-14', 500, 390, 350, rock(0.015, 1.2))], fx: [{ kind: 'sparkle', x: 500, y: 360, w: 300, n: 4 }] },
    { layers: [L('lukchup-1', 500, 390, 190, { m: 'gather', dx: -300, dy: 10 }, 'out'), L('lukchup-2', 500, 380, 190, { m: 'gather', dx: 0, dy: -170 }, 'out'), L('lukchup-3', 500, 390, 190, { m: 'gather', dx: 300, dy: 10 }, 'out'), L('lukchup-15', 500, 390, 340, undefined, 'in')], fx: [{ kind: 'sparkle', x: 500, y: 350, w: 320, n: 5 }] },
  ],
  thread: [
    { layers: [L('foithong-3', 500, 420, 300), L('foithong-4', 500, 262, 220, { m: 'slide', dx: 22, speed: 1.3 })], fx: [{ kind: 'drop', x: 520, y: 330, w: 80, n: 4, color: YOLK }] },
    { layers: [L('foithong-5', 500, 390, 330, rock(0.01, 2))], fx: [{ kind: 'bubbles', x: 500, y: 360, w: 280, n: 4 }, { kind: 'steam', x: 500, y: 280, w: 240, n: 2 }] },
    { layers: [L('foithong-6', 500, 385, 340)], fx: [{ kind: 'bubbles', x: 500, y: 360, w: 280, n: 3 }, { kind: 'steam', x: 500, y: 280, w: 240, n: 2 }] },
    { layers: [L('foithong-7', 500, 380, 330, { m: 'dip', h: 10, speed: 1.1 })], fx: [{ kind: 'drop', x: 420, y: 430, w: 80, n: 3, color: YOLK }] },
    { layers: [L('foithong-8', 500, 380, 340, { m: 'dip', h: 12, speed: 1.2 })], fx: [{ kind: 'drop', x: 500, y: 330, w: 100, n: 4, color: YOLK }] },
    { layers: [L('foithong-2', 500, 395, 330, { m: 'pulse', k: 0.03, speed: 1.2 })], fx: [{ kind: 'sparkle', x: 500, y: 360, w: 300, n: 4 }] },
  ],
  flower: [
    { layers: [L('thongyipA-4', 500, 405, 290, undefined, undefined, 395), L('ktm-4', 548, 315, 230, orbit(28, 0.16, 1.5))], fx: [{ kind: 'sparkle', x: 500, y: 350, w: 240, n: 3 }] },
    { layers: [L('thongyipA-5', 500, 390, 330, rock(0.01, 2))], fx: [{ kind: 'bubbles', x: 500, y: 360, w: 260, n: 3 }, { kind: 'steam', x: 500, y: 280, w: 220, n: 2 }] },
    { layers: [L('thongyipA-6', 500, 395, 330, rock(0.01, 2))], fx: [{ kind: 'drop', x: 500, y: 260, w: 40, n: 2, color: YOLK }, { kind: 'bubbles', x: 500, y: 360, w: 220, n: 2 }] },
    { layers: [L('thongyipA-7', 500, 385, 330, { m: 'dip', h: 14, speed: 1.5 })], fx: [{ kind: 'sparkle', x: 440, y: 400, w: 160, n: 3 }] },
    { layers: [L('thongyipA-1', 500, 395, 310, { m: 'pulse', k: 0.03, speed: 1.2 })], fx: [{ kind: 'sparkle', x: 500, y: 360, w: 280, n: 5 }] },
  ],
  syrupBall: [
    { layers: [L('thongyod2-1', 500, 400, 330, { m: 'squash', k: 0.04, speed: 2.2 })], fx: [{ kind: 'sparkle', x: 500, y: 370, w: 280, n: 3 }] },
    { layers: [L('thongyodA-5', 500, 390, 340, rock(0.01, 2))], fx: [{ kind: 'bubbles', x: 500, y: 360, w: 280, n: 4 }, { kind: 'steam', x: 500, y: 280, w: 240, n: 2 }] },
    { layers: [L('thongyod2-2', 500, 390, 340, rock(0.01, 2), undefined)], fx: [{ kind: 'drop', x: 430, y: 240, w: 140, n: 3, color: '#f7b81d' }, { kind: 'bubbles', x: 500, y: 360, w: 260, n: 3 }] },
    { layers: [L('thongyod2-3', 500, 360, 320, { m: 'dip', h: 32, speed: 1.3 })], fx: [{ kind: 'drop', x: 380, y: 430, w: 60, n: 3, color: '#f1c24a' }] },
    { layers: [L('thongyodA-2', 500, 395, 320, { m: 'pulse', k: 0.03, speed: 1.2 })], fx: [{ kind: 'sparkle', x: 500, y: 360, w: 280, n: 5 }] },
  ],
  bowl: [
    { layers: [L('bualoy-4', 330, 395, 165, { m: 'squash', k: 0.1, speed: 2.4 }), L('bualoy-3', 500, 395, 165, { m: 'squash', k: 0.1, speed: 2.1 }), L('bualoy-5', 670, 395, 165, { m: 'squash', k: 0.1, speed: 2.7 })], fx: [{ kind: 'sparkle', x: 500, y: 350, w: 460, n: 4 }] },
    { layers: [L('bualoy-6', 500, 400, 340, { m: 'pulse', k: 0.03, speed: 1.6 })], fx: [{ kind: 'sparkle', x: 500, y: 370, w: 320, n: 4 }] },
    { layers: [L('bualoy-7', 500, 385, 350, rock(0.012, 2))], fx: [{ kind: 'bubbles', x: 500, y: 360, w: 280, n: 4 }, { kind: 'steam', x: 500, y: 270, w: 240, n: 3 }] },
    { layers: [L('bualoy-11', 500, 370, 330, { m: 'dip', h: 36, speed: 1.3 })], fx: [{ kind: 'drop', x: 400, y: 430, w: 60, n: 3, color: '#fff7e2' }] },
    { layers: [L('bualoy-9', 500, 385, 330, { m: 'swing', a: 0.07, px: 0.3, py: -0.2, speed: 1.2 })], fx: [{ kind: 'drop', x: 470, y: 330, w: 20, n: 3, color: '#fff7e2' }] },
  ],
  crepe: [
    { layers: [L('crepe-4', 500, 405, 300, undefined, undefined, 395), L('ktm-4', 548, 315, 230, orbit(28, 0.16, 1.5))], fx: [{ kind: 'sparkle', x: 500, y: 350, w: 260, n: 3 }] },
    { layers: [L('crepe-5', 500, 400, 290, undefined, undefined, 390), L('ktm-4', 548, 305, 230, orbit(26, 0.16, 1.6))], fx: [{ kind: 'sparkle', x: 500, y: 330, w: 240, n: 4 }] },
    { layers: [L('crepe-6', 500, 400, 340, undefined, 'out'), L('crepe-7', 500, 400, 340, undefined, 'in')], fx: [{ kind: 'steam', x: 500, y: 300, w: 260, n: 3 }] },
    { layers: [L('crepe-7', 500, 400, 340, undefined, 'out'), L('crepe-8', 500, 400, 340, undefined, 'in')], fx: [{ kind: 'steam', x: 500, y: 300, w: 260, n: 2 }, { kind: 'sparkle', x: 500, y: 360, w: 260, n: 4 }] },
    { layers: [L('crepe-8', 500, 400, 340, { m: 'squash', k: 0.03, speed: 2 }, 'out'), L('crepe-9', 500, 400, 340, undefined, 'in')], fx: [{ kind: 'steam', x: 500, y: 300, w: 260, n: 2 }] },
    { layers: [L('crepe-1', 500, 395, 330, { m: 'pulse', k: 0.03, speed: 1.2 })], fx: [{ kind: 'sparkle', x: 500, y: 360, w: 300, n: 5 }] },
  ],
};

/** The finished dessert shown as ONE big picture on the tray. */
export const SERVED_PICS: Record<ArtId, readonly string[]> = {
  parcel: ['ktmCover-1'],
  layered: ['chan-1'],
  fruit: ['menu-7'],
  thread: ['foithong-2'],
  flower: ['menu-6'],
  syrupBall: ['thongyodA-2'],
  bowl: ['bualoy-2'],
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
  ghosts: ['ghost-1', 'ghost-2', 'ghost-3', 'ghost-4', 'ghost-5'],
  ghostHands: 'ghost-6',
  wisps: 'halo-1',
  mist: 'halo-2',
  frame: 'halo-8',
  shaman: ['shaman-1', 'shaman-2', 'shaman-3'],
  holyWater: 'holywater-3',
  holyWaterDrop: 'holywater-1',
  splashRing: 'holywater-4',
  calmBurst: 'holywater-5',
} as const;

function allNames(): string[] {
  const s = new Set<string>();
  Object.values(COOK_SCENES).forEach((st) => st.forEach((spec) => spec.layers.forEach((l) => s.add(l.pic))));
  Object.values(FX_PICS).forEach((p) => p.forEach((n) => s.add(n)));
  Object.values(SERVED_PICS).forEach((p) => p.forEach((n) => s.add(n)));
  Object.values(ICON_PICS).forEach((n) => s.add(n));
  Object.values(GIFT_PICS).forEach((n) => s.add(n));
  Object.values(CAFE_PICS).forEach((v) => (Array.isArray(v) ? v.forEach((n) => s.add(n)) : s.add(v as string)));
  return [...s];
}
export const ALL_PIC_NAMES: readonly string[] = allNames();
