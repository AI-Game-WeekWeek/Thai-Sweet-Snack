import type { ArtId } from '../dessert/types';
import { artImage, drawArt } from './artImages';
import { COOK_PICS, SERVED_PICS } from './artManifest';

/**
 * Per-dessert art: each Thai dessert has its own cooking scene (following how it is really made) and its own served
 * look. Pure drawing in the 1000x600 station world; never changes game state; hostile numbers never throw.
 */
export interface CookingArt {
  /** Recipe step index (0-based). */
  stage: number;
  /** Number of recipe steps. */
  stages: number;
  /** 0..1 progress inside this step. */
  t: number;
  /** 0..1 progress of the whole dessert. */
  p: number;
  /** Animation clock in ms. */
  time: number;
}
export interface ServedArt {
  /** 0..1 presentation animation. */
  t: number;
  /** Items to show. */
  n: number;
  cx: number;
  cy: number;
}

const TAU = Math.PI * 2;
const c01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
const spring = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : 1 - Math.exp(-5 * t) * Math.cos(12 * t));

function oval(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, fill: string, stroke?: string, rot = 0): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, TAU);
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 3;
    ctx.stroke();
  }
}
function box(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string, r = 8): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(x, y, Math.max(0.1, w), Math.max(0.1, h), r);
  ctx.fill();
}
function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string, w: number): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}
function steam(ctx: CanvasRenderingContext2D, x: number, y: number, time: number, n = 4): void {
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  for (let k = 0; k < n; k++) {
    const ph = (time / 1400 + k * 0.27) % 1;
    ctx.beginPath();
    ctx.moveTo(x + k * 46 - 70, y - ph * 90);
    ctx.quadraticCurveTo(x + k * 46 - 56, y - ph * 90 - 24, x + k * 46 - 70, y - ph * 90 - 48);
    ctx.stroke();
  }
}
function bubbles(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, time: number, color = 'rgba(255,255,255,0.8)'): void {
  ctx.fillStyle = color;
  for (let k = 0; k < 6; k++) {
    const ph = (time / 1000 + k * 0.31) % 1;
    ctx.beginPath();
    ctx.arc(x - w / 2 + (k + 0.5) * (w / 6), y - ph * 26, 3 + ph * 5, 0, TAU);
    ctx.fill();
  }
}
function spoon(ctx: CanvasRenderingContext2D, x: number, y: number, time: number): void {
  const a = time / 220;
  const sx = x + Math.cos(a) * 60;
  const sy = y + Math.sin(a) * 14;
  line(ctx, sx + 46, sy - 150, sx, sy, '#8a5a2b', 12);
}
function pot(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, body: string, inside: string): void {
  box(ctx, cx - w / 2, cy - 20, w, 110, body, 18);
  oval(ctx, cx, cy - 20, w / 2, 34, '#3d2d22');
  oval(ctx, cx, cy - 16, w / 2 - 12, 26, inside);
  box(ctx, cx - w / 2 - 22, cy + 6, 26, 12, body, 6);
  box(ctx, cx + w / 2 - 4, cy + 6, 26, 12, body, 6);
}

// ---------- ข้าวต้มมัด: sticky rice + black beans + banana in a banana-leaf parcel ----------
function parcelScene(ctx: CanvasRenderingContext2D, s: number, t: number, p: number, time: number): void {
  const cx = 500;
  const cy = 400;
  if (s === 0) { // sticky rice, coconut milk, salt, sugar in a bowl
    oval(ctx, cx, cy + 20, 200, 60, '#e8e2d6');
    oval(ctx, cx, cy, 190, 46, '#fbf8f1');
    oval(ctx, cx, cy - 4 - t * 10, 160, 34, '#fffaf0');
    oval(ctx, cx + 40, cy - 12 - t * 10, 90 * t + 10, 14, '#f4ecd8');
    spoon(ctx, cx, cy - 6, time);
  } else if (s === 1) { // black beans and banana slices
    oval(ctx, cx - 150, cy + 10, 130, 40, '#e8e2d6');
    oval(ctx, cx - 150, cy - 6, 112, 24, '#2b2430');
    for (let k = 0; k < 8; k++) oval(ctx, cx - 210 + k * 18, cy - 8 + (k % 2) * 6, 7, 5, '#4a3e55');
    for (let k = 0; k < 5; k++) { // banana slices drop in
      const drop = c01(t * 5 - k * 0.5);
      oval(ctx, cx + 70 + k * 42, cy - 80 + drop * 70, 24, 24, '#f4d35e', '#d9a93a');
      oval(ctx, cx + 70 + k * 42, cy - 80 + drop * 70, 8, 8, '#e8bf4a');
    }
  } else if (s === 2) { // banana leaf laid out, rice spread on it
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-0.08);
    box(ctx, -230, -70, 460, 150, '#5f9a45', 20);
    line(ctx, -230, 5, 230, 5, '#7ab85a', 4);
    box(ctx, -150, -44 + 10, 300 * (0.3 + 0.7 * t), 56, '#fffaf0', 18);
    ctx.restore();
  } else if (s === 3) { // filling on top, then roll
    ctx.save();
    ctx.translate(cx, cy);
    box(ctx, -230, -70, 460, 150, '#5f9a45', 20);
    box(ctx, -150, -34, 300, 56, '#fffaf0', 18);
    oval(ctx, 0, -6, 130 * (1 - t * 0.2), 14, '#2b2430');
    for (let k = 0; k < 3; k++) oval(ctx, -80 + k * 80, -6, 22, 16, '#f4d35e', '#d9a93a');
    ctx.restore();
    ctx.fillStyle = '#5f9a45';
    ctx.globalAlpha = c01(t);
    ctx.beginPath();
    ctx.roundRect(cx - 240, cy - 80, 480, 70 * t + 6, 16);
    ctx.fill();
    ctx.globalAlpha = 1;
  } else if (s === 4) { // tie with string
    box(ctx, cx - 130, cy - 40, 260, 100, '#5f9a45', 26);
    for (const fx of [-60, 0, 60]) line(ctx, cx + fx - 8, cy - 34, cx + fx + 8, cy + 54, '#7ab85a', 3);
    for (const sx of [-58, 56]) line(ctx, cx + sx, cy - 44, cx + sx, cy - 44 + 110 * t, '#8a5a2b', 7);
    oval(ctx, cx + 130, cy + 10, 11, 25, '#fffaf0', '#2f5f25');
  } else { // steam the parcels
    pot(ctx, cx, cy, 420, '#9a9aa5', '#d8d8de');
    for (let k = 0; k < 3; k++) box(ctx, cx - 140 + k * 100, cy - 44 + (k % 2) * 6, 90, 40, '#5f9a45', 14);
    steam(ctx, cx, cy - 56, time);
    box(ctx, cx - 210, cy - 66 - (1 - p) * 8, 420, 16, '#c0c0c8', 6);
  }
}

// ---------- ขนมชั้น: layers poured and steamed one by one in a tray ----------
function layeredScene(ctx: CanvasRenderingContext2D, s: number, t: number, p: number, time: number): void {
  const cx = 500;
  const cy = 400;
  const tray = (layers: number, topFrac = 1): void => {
    box(ctx, cx - 230, cy - 20, 460, 110, '#b9b9c2', 14);
    box(ctx, cx - 214, cy - 8, 428, 90, '#e9e9ee', 10);
    for (let i = 0; i < layers; i++) {
      const h = 11;
      const frac = i === layers - 1 ? topFrac : 1;
      box(ctx, cx - 214, cy + 70 - (i + 1) * h, 428, h * frac + 0.5, i % 2 === 0 ? '#fdfaf0' : '#7fc46a', 2);
    }
  };
  if (s === 0) { // mix flour + coconut milk + sugar
    oval(ctx, cx, cy + 20, 190, 56, '#e8e2d6');
    oval(ctx, cx, cy, 175, 40, '#fdfaf0');
    spoon(ctx, cx, cy - 4, time);
  } else if (s === 1) { // split into two bowls, pandan colour
    oval(ctx, cx - 170, cy + 14, 130, 42, '#e8e2d6');
    oval(ctx, cx - 170, cy, 112, 28, '#fdfaf0');
    oval(ctx, cx + 170, cy + 14, 130, 42, '#e8e2d6');
    oval(ctx, cx + 170, cy, 112, 28, `rgb(${Math.round(253 - 130 * t)},${Math.round(250 - 50 * t)},${Math.round(240 - 130 * t)})`);
    line(ctx, cx + 170, cy - 110 + t * 20, cx + 170, cy - 20, '#5aa84a', 8);
  } else if (s === 2) { // pour layer on layer
    tray(1 + Math.floor(t * 5), 1);
    line(ctx, cx, cy - 130, cx, cy + 20 - t * 40, k2(t), 14);
    box(ctx, cx - 40, cy - 150, 80, 30, '#b5b5b5', 8);
  } else if (s === 3) { // steam each layer
    tray(6 + Math.floor(t * 2));
    steam(ctx, cx, cy - 30, time, 5);
  } else if (s === 4) { // rest and cool
    tray(8);
    oval(ctx, cx + 200, cy - 60 - t * 6, 14, 6, '#cfe8f7');
  } else { // cut into pieces
    tray(8);
    const x = cx - 214 + t * 428;
    line(ctx, x, cy - 70, x + 14, cy + 70, '#d9d9d9', 6);
    for (let k = 1; k <= 3; k++) line(ctx, cx - 214 + k * 107, cy - 8, cx - 214 + k * 107, cy + 82, 'rgba(60,40,30,0.5)', 2);
  }
  void p;
}
const k2 = (t: number): string => (t < 0.5 ? '#fdfaf0' : '#7fc46a');

// ---------- ลูกชุบ: mung-bean paste shaped into fruit, painted, glazed ----------
function fruitScene(ctx: CanvasRenderingContext2D, s: number, t: number, p: number, time: number): void {
  const cx = 500;
  const cy = 400;
  const cols = ['#e8493c', '#f4b333', '#7cbf4a', '#e07aa8', '#9a5fb0'];
  const row = (state: 'ball' | 'fruit' | 'paint' | 'glaze', count: number): void => {
    for (let k = 0; k < count; k++) {
      const x = cx - 200 + k * 80;
      const y = cy + 20 + (k % 2) * 12;
      if (state === 'ball') oval(ctx, x, y, 30, 28, '#e8e08a', '#c9bd5a');
      else {
        oval(ctx, x, y, 30, 28, state === 'paint' ? `rgba(${200 - k * 20},150,90,0.9)` : (cols[k % 5] as string), '#7a5a30');
        line(ctx, x, y - 28, x + 6, y - 40, '#4a8a3a', 4);
        if (state === 'glaze') oval(ctx, x - 9, y - 9, 10, 5, 'rgba(255,255,255,0.65)', undefined, -0.5);
      }
    }
  };
  if (s === 0) { // cook and stir the paste
    oval(ctx, cx, cy + 22, 190, 56, '#b9b9c2');
    oval(ctx, cx, cy, 175, 40, '#e8e08a');
    spoon(ctx, cx, cy - 4, time);
  } else if (s === 1) { // roll it into little fruit
    box(ctx, cx - 250, cy + 40, 500, 40, '#c98f5a', 8);
    row('ball', 1 + Math.floor(t * 5));
  } else if (s === 2) { // paint with a brush
    row('fruit', 6);
    line(ctx, cx - 160 + t * 320, cy - 90, cx - 160 + t * 320 + 30, cy - 30, '#8a5a2b', 8);
  } else if (s === 3) { // dip in jelly glaze
    row('fruit', 6);
    oval(ctx, cx, cy - 70 + t * 20, 26, 28, '#fbe6a0', 'rgba(200,170,60,0.6)');
    line(ctx, cx, cy - 130, cx, cy - 96 + t * 20, '#c9bd5a', 3);
    row('glaze', 1 + Math.floor(t * 5));
  } else if (s === 4) { // dry
    row('glaze', 5);
    steam(ctx, cx, cy - 40, time, 2);
  } else { // box them
    box(ctx, cx - 230, cy - 10, 460, 100, '#f4e8c8', 12);
    row('glaze', Math.max(1, Math.round(1 + t * 5)));
  }
  void p;
}

// ---------- ฝอยทอง: thin egg-yolk threads drizzled in a ring through boiling syrup ----------
function threadScene(ctx: CanvasRenderingContext2D, s: number, t: number, p: number, time: number): void {
  const cx = 500;
  const cy = 400;
  const wok = (syrup: string): void => {
    oval(ctx, cx, cy + 24, 230, 70, '#8c6a3a');
    oval(ctx, cx, cy, 215, 44, syrup);
  };
  if (s === 0) { // strain the yolks through a sieve
    oval(ctx, cx, cy + 20, 170, 54, '#e8e2d6');
    oval(ctx, cx, cy, 150, 34, '#f4c21b');
    box(ctx, cx - 70, cy - 120, 140, 22, '#c0c0c8', 6);
    line(ctx, cx, cy - 98, cx, cy - 10 - t * 4, '#f6c92a', 6);
  } else if (s === 1) { // boil the syrup
    wok('#e8c777');
    bubbles(ctx, cx, cy - 4, 340, time);
  } else if (s === 2) { // drizzle in circles: threads
    wok('#e8c777');
    const rot = time / 600;
    ctx.strokeStyle = '#f6c92a';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    for (let k = 0; k < 5; k++) {
      ctx.beginPath();
      ctx.ellipse(cx, cy - 2, 40 + k * 32, 10 + k * 7, 0, rot + k, rot + k + 1.2 + t * 4.5);
      ctx.stroke();
    }
    line(ctx, cx + Math.cos(rot) * 50, cy - 140, cx + Math.cos(rot) * 50, cy - 8, '#f6c92a', 3);
    box(ctx, cx + Math.cos(rot) * 50 - 30, cy - 160, 60, 28, '#c0c0c8', 8);
  } else if (s === 3) { // fold into a skein with a wooden stick
    wok('#e8c777');
    box(ctx, cx - 130, cy - 20, 260 * (0.4 + 0.6 * t), 22, '#f6c92a', 11);
    line(ctx, cx - 190, cy - 100 + t * 20, cx + 190, cy - 30 + t * 20, '#8a5a2b', 8);
  } else if (s === 4) { // lift and drain
    wok('#e8c777');
    box(ctx, cx - 100, cy - 70 - (1 - t) * 20, 200, 26, '#f6c92a', 13);
    for (let k = 0; k < 4; k++) line(ctx, cx - 60 + k * 40, cy - 44 - (1 - t) * 20, cx - 60 + k * 40, cy - 20, '#f2d479', 3);
  } else { // arrange on the tray
    box(ctx, cx - 250, cy + 20, 500, 70, '#b07a45', 16);
    for (let k = 0; k < 3; k++) box(ctx, cx - 190 + k * 130, cy + 10 - t * 14, 100, 34, '#f6c92a', 17);
  }
  void p;
}

// ---------- ทองหยิบ: a yolk drop in syrup, then pinched into an 8-petal flower ----------
function flowerScene(ctx: CanvasRenderingContext2D, s: number, t: number, p: number, time: number): void {
  const cx = 500;
  const cy = 400;
  const flower = (r: number, petals: number): void => {
    for (let k = 0; k < petals; k++) {
      const a = (k / 8) * TAU;
      oval(ctx, cx + Math.cos(a) * r * 0.5, cy + Math.sin(a) * r * 0.22, r * 0.5, r * 0.22, '#f6b21b', '#c4801b', a);
    }
    oval(ctx, cx, cy, r * 0.22, r * 0.1, '#fbd35a');
  };
  if (s === 0) { // whisk yolks
    oval(ctx, cx, cy + 20, 180, 54, '#e8e2d6');
    oval(ctx, cx, cy, 160, 34, '#f7c21d');
    spoon(ctx, cx, cy - 4, time * 1.6);
  } else if (s === 1) { // sugar syrup in a small brass pan
    oval(ctx, cx, cy + 22, 200, 60, '#b8862a');
    oval(ctx, cx, cy, 185, 38, '#f1d27a');
    bubbles(ctx, cx, cy - 4, 260, time);
  } else if (s === 2) { // a yolk drop in the syrup
    oval(ctx, cx, cy + 22, 200, 60, '#b8862a');
    oval(ctx, cx, cy, 185, 38, '#f1d27a');
    oval(ctx, cx, cy - 90 + t * 88, 14, 18, '#f7b81d');
    oval(ctx, cx, cy - 2, 20 + t * 40, 8 + t * 10, '#f7b81d');
  } else if (s === 3) { // pinch 8 petals
    oval(ctx, cx, cy + 22, 200, 60, '#b8862a');
    oval(ctx, cx, cy, 185, 38, '#f1d27a');
    flower(120, Math.max(1, Math.round(t * 8)));
  } else { // paper cups
    for (let k = 0; k < 3; k++) {
      const x = cx - 150 + k * 150;
      ctx.fillStyle = '#e8e2d6';
      ctx.beginPath();
      ctx.moveTo(x - 60, cy - 10);
      ctx.lineTo(x + 60, cy - 10);
      ctx.lineTo(x + 44, cy + 56);
      ctx.lineTo(x - 44, cy + 56);
      ctx.closePath();
      ctx.fill();
      oval(ctx, x, cy - 14 - t * 8, 44, 18, '#f6b21b', '#c4801b');
    }
  }
  void p;
}

// ---------- ทองหยอด: yolk-and-flour balls dropped into syrup ----------
function syrupBallScene(ctx: CanvasRenderingContext2D, s: number, t: number, p: number, time: number): void {
  const cx = 500;
  const cy = 400;
  const pan = (): void => {
    oval(ctx, cx, cy + 22, 230, 66, '#b8862a');
    oval(ctx, cx, cy, 215, 42, '#f1d27a');
  };
  if (s === 0) { // knead yolk + rice flour dough
    box(ctx, cx - 220, cy + 30, 440, 40, '#c98f5a', 8);
    const w = 1 + Math.sin(time / 140) * 0.06;
    oval(ctx, cx, cy + 4, 90 * w, 46 / w, '#f7c944', '#d9a93a');
  } else if (s === 1) { // syrup comes to a boil
    pan();
    bubbles(ctx, cx, cy - 6, 380, time);
  } else if (s === 2) { // drop little balls
    pan();
    const n = 2 + Math.floor(t * 8);
    for (let k = 0; k < n; k++) oval(ctx, cx - 180 + (k % 5) * 90, cy - 10 + Math.floor(k / 5) * 16 + (k % 2) * 6, 20, 20, '#f7b81d', '#c4801b');
    oval(ctx, cx + 130, cy - 100 + (t * 4 % 1) * 90, 18, 20, '#f7c944');
  } else if (s === 3) { // lift with a slotted spoon
    pan();
    oval(ctx, cx, cy - 50 - t * 40, 100, 26, '#c0c0c8');
    for (let k = 0; k < 5; k++) oval(ctx, cx - 64 + k * 32, cy - 60 - t * 40, 14, 14, '#f7b81d');
    line(ctx, cx + 100, cy - 54 - t * 40, cx + 260, cy - 150, '#8a5a2b', 8);
  } else { // put in paper cups
    for (let k = 0; k < 4; k++) {
      const x = cx - 220 + k * 146;
      box(ctx, x - 44, cy + 6, 88, 54, '#e8e2d6', 10);
      oval(ctx, x, cy + 2 - t * 4, 30, 30, '#f7b81d', '#c4801b');
    }
  }
  void p;
}

// ---------- บัวลอย: coloured dough balls boiled until they float, then coconut milk ----------
function bowlScene(ctx: CanvasRenderingContext2D, s: number, t: number, p: number, time: number): void {
  const cx = 500;
  const cy = 400;
  const dough = ['#ffffff', '#f5a3c3', '#9ad06b'];
  const bowl = (): void => {
    oval(ctx, cx, cy + 40, 180, 80, '#e8e2d6');
    oval(ctx, cx, cy, 180, 44, '#fbf8f1');
  };
  if (s === 0) { // knead three doughs
    for (let k = 0; k < 3; k++) {
      const w = 1 + Math.sin(time / 150 + k) * 0.06;
      oval(ctx, cx - 200 + k * 200, cy + 10, 70 * w, 40 / w, dough[k] as string, '#b9a98a');
    }
  } else if (s === 1) { // roll small balls
    box(ctx, cx - 250, cy + 36, 500, 36, '#c98f5a', 8);
    const n = 3 + Math.floor(t * 12);
    for (let k = 0; k < n; k++) oval(ctx, cx - 210 + (k % 8) * 58, cy + 14 + Math.floor(k / 8) * 34, 18, 18, dough[k % 3] as string, '#b9a98a');
  } else if (s === 2) { // boil: balls rise and float
    pot(ctx, cx, cy, 380, '#9a9aa5', '#cfe8f7');
    for (let k = 0; k < 9; k++) {
      const rise = c01(t * 1.4 - (k % 3) * 0.1);
      oval(ctx, cx - 120 + (k % 5) * 60, cy + 10 - rise * 18 + Math.sin(time / 300 + k) * 3, 16, 16, dough[k % 3] as string, '#b9a98a');
    }
    bubbles(ctx, cx, cy - 4, 300, time);
  } else if (s === 3) { // ladle into a bowl
    bowl();
    for (let k = 0; k < Math.max(1, Math.round(t * 9)); k++) oval(ctx, cx - 100 + (k % 5) * 50, cy + 6 + Math.floor(k / 5) * 10, 18, 18, dough[k % 3] as string, '#b9a98a');
    line(ctx, cx + 150, cy - 140, cx + 40, cy - 20, '#8a5a2b', 8);
  } else { // pour coconut milk
    bowl();
    oval(ctx, cx, cy + 2, 160, 36 * (0.5 + 0.5 * t), '#fff7e2');
    for (let k = 0; k < 7; k++) oval(ctx, cx - 100 + (k % 5) * 50, cy + 2 + (k > 4 ? 10 : 0), 18, 18, dough[k % 3] as string, '#b9a98a');
    line(ctx, cx + 20, cy - 140, cx + 20, cy - 14, '#fff7e2', 12);
    box(ctx, cx - 20, cy - 170, 90, 36, '#c0c0c8', 8);
  }
  void p;
}

// ---------- ขนมเบื้อง: crisp crepe spread on a hot round griddle, cream and golden threads, folded ----------
function crepeScene(ctx: CanvasRenderingContext2D, s: number, t: number, p: number, time: number): void {
  const cx = 500;
  const cy = 400;
  const griddle = (): void => {
    oval(ctx, cx, cy + 14, 240, 68, '#2f2a30');
    oval(ctx, cx, cy, 230, 52, '#4a444d');
  };
  if (s === 0) { // batter
    oval(ctx, cx, cy + 20, 180, 54, '#e8e2d6');
    oval(ctx, cx, cy, 160, 34, '#f7efd4');
    spoon(ctx, cx, cy - 4, time);
  } else if (s === 1) { // whip egg-white cream
    oval(ctx, cx, cy + 24, 170, 56, '#e8e2d6');
    for (let k = 0; k < 4; k++) oval(ctx, cx - 70 + k * 46, cy - 6 - t * 24 - (k % 2) * 8, 40, 26 + t * 22, '#ffffff', '#ececf0');
    line(ctx, cx + 90, cy - 120, cx + 20, cy - 24, '#c0c0c8', 6);
  } else if (s === 2) { // spread batter into a thin round
    griddle();
    oval(ctx, cx, cy - 2, 200 * (0.2 + 0.8 * t), 42 * (0.2 + 0.8 * t), '#f2e2a8', '#d9b95a');
    steam(ctx, cx, cy - 30, time, 3);
  } else if (s === 3) { // cream and threads of golden yolk
    griddle();
    oval(ctx, cx, cy - 2, 200, 42, '#f2e2a8', '#d9b95a');
    oval(ctx, cx - 40, cy - 4, 120 * t + 10, 20 * t + 4, '#ffffff');
    for (let k = 0; k < 5; k++) line(ctx, cx - 120 + k * 12, cy - 12, cx - 20 + k * 30, cy + 8, '#f6c92a', 3);
  } else if (s === 4) { // fold in half
    griddle();
    ctx.fillStyle = '#f2e2a8';
    ctx.beginPath();
    ctx.ellipse(cx, cy - 2, 200, 42, 0, Math.PI, TAU - t * Math.PI);
    ctx.closePath();
    ctx.fill();
    oval(ctx, cx, cy - 4, 200, 42 * (1 - t), '#ffffff');
  } else { // arrange
    box(ctx, cx - 250, cy + 20, 500, 70, '#b07a45', 16);
    for (let k = 0; k < 3; k++) oval(ctx, cx - 140 + k * 140, cy + 14 - t * 10, 64, 26, '#f2e2a8', '#d9b95a');
  }
  void p;
}

type Scene = (ctx: CanvasRenderingContext2D, s: number, t: number, p: number, time: number) => void;
const SCENES: Record<ArtId, Scene> = {
  parcel: parcelScene,
  layered: layeredScene,
  fruit: fruitScene,
  thread: threadScene,
  flower: flowerScene,
  syrupBall: syrupBallScene,
  bowl: bowlScene,
  crepe: crepeScene,
};

/** Watercolor pictures for one recipe step; false when none of them is loaded (the shapes are drawn instead). */
function drawCookPics(ctx: CanvasRenderingContext2D, art: ArtId, a: CookingArt): boolean {
  const steps = COOK_PICS[art];
  if (!steps || steps.length === 0) return false;
  const stages = Number.isFinite(a.stages) ? Math.max(1, Math.floor(a.stages)) : 1;
  const raw = Number.isFinite(a.stage) ? Math.floor(a.stage) : 0;
  const stage = Math.min(Math.max(0, raw), Math.max(0, Math.min(stages, steps.length) - 1));
  const names = (steps[stage] ?? []).filter((n) => artImage(n) !== null);
  if (names.length === 0) return false;
  const t = c01(a.t);
  const time = Number.isFinite(a.time) ? a.time : 0;
  const pop = 0.9 + 0.1 * spring(Math.min(1, t * 5));
  const bob = 1 + 0.02 * Math.sin(time / 170);
  const k = names.length;
  const box = k === 1 ? 330 : k === 2 ? 270 : 210;
  names.forEach((n, i) => {
    drawArt(ctx, n, 500 + (i - (k - 1) / 2) * (box + 10), 360 + Math.sin(time / 260 + i) * 4, box, 300, Math.sin(time / 400 + i) * 0.02, pop * bob, pop / bob);
  });
  return true;
}

/** Draws the cooking scene for one recipe step. Unknown art ids and hostile values draw nothing or clamp. */
export function drawArtCooking(ctx: CanvasRenderingContext2D, art: ArtId, a: CookingArt): void {
  const scene = SCENES[art];
  if (!scene) return;
  if (drawCookPics(ctx, art, a)) return;
  const stages = Number.isFinite(a.stages) ? Math.max(1, Math.floor(a.stages)) : 1;
  const raw = Number.isFinite(a.stage) ? Math.floor(a.stage) : 0;
  // scenes are authored with up to 6 stages; map the recipe step onto them
  const stage = Math.min(Math.max(0, raw), Math.max(0, stages - 1));
  const time = Number.isFinite(a.time) ? a.time : 0;
  ctx.save();
  try {
    ctx.lineCap = 'round';
    scene(ctx, stage, c01(a.t), c01(a.p), time);
  } finally {
    ctx.restore();
  }
}

// ---------- served looks ----------
type Item = (ctx: CanvasRenderingContext2D, i: number) => void;
function placed(ctx: CanvasRenderingContext2D, t: number, n: number, cap: number, pos: (i: number, n: number) => [number, number, number], draw: Item): void {
  const count = Number.isFinite(n) ? Math.min(cap, Math.max(0, Math.floor(n))) : 0;
  for (let i = 0; i < count; i++) {
    const s = spring((t * 1.6 - (i / Math.max(1, count)) * 0.6) / 0.4);
    if (s <= 0) continue;
    const [x, y, tilt] = pos(i, count);
    ctx.save();
    try {
      ctx.translate(x, y);
      ctx.rotate(tilt);
      ctx.scale(s, Math.max(0.2, 2 - s));
      draw(ctx, i);
    } finally {
      ctx.restore();
    }
  }
}
function parcelItem(ctx: CanvasRenderingContext2D): void {
  box(ctx, -62, -28, 124, 56, '#5f9a45', 16);
  ctx.strokeStyle = '#2f5f25';
  ctx.lineWidth = 4;
  ctx.stroke();
  for (const fx of [-34, 0, 34]) line(ctx, fx - 10, -22, fx + 10, 22, '#7ab85a', 3);
  oval(ctx, 62, 0, 9, 17, '#fffaf0', '#2f5f25');
  for (const sx of [-26, 26]) line(ctx, sx, -30, sx, 30, '#8a5a2b', 6);
  oval(ctx, 26, -30, 7, 7, '#8a5a2b');
}

/** Watercolor pictures on the tray; false when the first picture is not loaded. */
function drawServedPics(ctx: CanvasRenderingContext2D, art: ArtId, t: number, nRaw: number, cx: number, cy: number): boolean {
  const names = SERVED_PICS[art];
  if (!names || names.length === 0 || artImage(names[0] as string) === null) return false;
  const n = Number.isFinite(nRaw) ? Math.min(8, Math.max(0, Math.floor(nRaw))) : 0;
  const size = n <= 3 ? 150 : n <= 5 ? 118 : 96;
  const perRow = n <= 4 ? n : Math.ceil(n / 2);
  for (let i = 0; i < n; i++) {
    const s = spring((t * 1.6 - (i / Math.max(1, n)) * 0.6) / 0.4);
    if (s <= 0) continue;
    const row = Math.floor(i / Math.max(1, perRow));
    const inRow = i % Math.max(1, perRow);
    const rowCount = Math.min(perRow, n - row * perRow);
    const gap = size * 1.05;
    const x = cx + (inRow - (rowCount - 1) / 2) * gap;
    const y = cy - 6 + (n > 4 ? (row - 0.5) * size * 0.62 : 0);
    const name = names[i % names.length] as string;
    drawArt(ctx, artImage(name) ? name : (names[0] as string), x, y, size, size, ([-0.08, 0.06, -0.04, 0.09][i % 4] as number), s, Math.max(0.2, 2 - s));
  }
  return true;
}

/** The finished look on the serving tray, popping in with a spring. */
export function drawArtServed(ctx: CanvasRenderingContext2D, art: ArtId, a: ServedArt): void {
  const t = c01(a.t);
  const cx = Number.isFinite(a.cx) ? a.cx : 500;
  const cy = Number.isFinite(a.cy) ? a.cy : 410;
  if (drawServedPics(ctx, art, t, a.n, cx, cy)) return;
  const row = (gap: number, wave = 0) => (i: number, n: number): [number, number, number] => [cx + (i - (n - 1) / 2) * gap, cy + (i % 2) * wave, 0];
  switch (art) {
    case 'parcel':
      placed(ctx, t, a.n, 5, (i, n) => [cx + (i - (n - 1) / 2) * 150, cy, ([-0.18, 0.1, -0.06, 0.16, -0.12][i % 5] as number)], parcelItem);
      break;
    case 'layered':
      placed(ctx, t, a.n, 8, (i) => [cx - 150 + (i % 4) * 100, cy - 20 + Math.floor(i / 4) * 52, 0], (c, i) => {
        for (let k = 0; k < 5; k++) box(c, -38, 18 - k * 8, 76, 8, k % 2 === 0 ? '#fdfaf0' : '#7fc46a', 1);
        void i;
      });
      break;
    case 'fruit':
      placed(ctx, t, a.n, 8, (i) => [cx - 150 + (i % 4) * 100, cy - 20 + Math.floor(i / 4) * 52, 0], (c, i) => {
        oval(c, 0, 0, 28, 24, ['#e8493c', '#f4b333', '#7cbf4a', '#e07aa8', '#9a5fb0'][i % 5] as string, '#7a5a30');
        line(c, 0, -24, 5, -34, '#4a8a3a', 4);
        oval(c, -8, -8, 9, 4, 'rgba(255,255,255,0.65)', undefined, -0.5);
      });
      break;
    case 'thread':
      placed(ctx, t, a.n, 4, row(150, 10), (c) => {
        oval(c, 0, 0, 56, 26, '#f6c92a', '#c4961b');
        for (let k = 0; k < 4; k++) line(c, -40 + k * 26, -16, -30 + k * 26, 16, '#fbe08a', 3);
      });
      break;
    case 'flower':
      placed(ctx, t, a.n, 6, (i) => [cx - 150 + (i % 3) * 150, cy - 18 + Math.floor(i / 3) * 56, 0], (c) => {
        box(c, -42, 6, 84, 24, '#e8e2d6', 6);
        for (let k = 0; k < 8; k++) {
          const ang = (k / 8) * TAU;
          oval(c, Math.cos(ang) * 16, -4 + Math.sin(ang) * 8, 16, 8, '#f6b21b', '#c4801b', ang);
        }
        oval(c, 0, -4, 6, 4, '#fbd35a');
      });
      break;
    case 'syrupBall':
      placed(ctx, t, a.n, 8, (i) => [cx - 150 + (i % 4) * 100, cy - 20 + Math.floor(i / 4) * 52, 0], (c) => {
        box(c, -30, 8, 60, 22, '#e8e2d6', 6);
        oval(c, 0, -2, 24, 24, '#f7b81d', '#c4801b');
        oval(c, -7, -9, 7, 4, 'rgba(255,255,255,0.6)', undefined, -0.5);
      });
      break;
    case 'bowl':
      placed(ctx, t, a.n, 4, row(150, 8), (c, i) => {
        oval(c, 0, 14, 56, 26, '#e8e2d6');
        oval(c, 0, 0, 56, 18, '#fff7e2');
        for (let k = 0; k < 3; k++) oval(c, -22 + k * 22, -2, 11, 11, (['#ffffff', '#f5a3c3', '#9ad06b'][(k + i) % 3]) as string, '#b9a98a');
      });
      break;
    case 'crepe':
      placed(ctx, t, a.n, 4, row(140, 8), (c) => {
        c.fillStyle = '#f2e2a8';
        c.beginPath();
        c.ellipse(0, 6, 60, 30, 0, Math.PI, TAU);
        c.closePath();
        c.fill();
        c.strokeStyle = '#d9b95a';
        c.lineWidth = 3;
        c.stroke();
        for (let k = 0; k < 3; k++) line(c, -30 + k * 30, -6, -22 + k * 30, 8, '#f6c92a', 3);
        oval(c, 0, 8, 52, 6, '#ffffff');
      });
      break;
    default:
      break;
  }
}
