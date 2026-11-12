import type { ParticleSystem } from '../anim/ParticleSystem';
import { avatarSpec } from '../cafe/avatars';
import type { CafeView, CustomerView, RenderView } from '../Game';
import type { AvatarCache } from './AvatarCache';
import { Renderer } from './Renderer';

/** Portrait world (9:16). The cooking station from the landscape scene is placed inside it as a 1000x600 window. */
export const CAFE_W = 1080;
export const CAFE_H = 1920;
const STATION_X = 40;
const STATION_Y = 760;

const FONT = '"Noto Sans Thai", system-ui, sans-serif';
const INK = '#3b2a1a';
const clip = (s: string, max: number): string => (s.length > max ? `${Array.from(s).slice(0, max - 1).join('')}…` : s);
const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
const isColor = (c: string): boolean => /^#[0-9a-f]{3,8}$/i.test(c);

/**
 * The whole café-mode UI on one portrait canvas: Thai-style awning and lanterns, the gift menu board, the cooking
 * counter (existing scene), a lucky cat, and the customer queue with a round head slot for each viewer's picture.
 * Few, large, outlined elements so it reads on a phone. Pure drawing; never changes game state.
 */
export class CafeRenderer {
  private readonly scene = new Renderer();
  private timeMs = 0;

  constructor(
    private readonly maxBoost: number,
    private readonly avatars: AvatarCache,
  ) {}

  draw(ctx: CanvasRenderingContext2D, width: number, height: number, view: RenderView, particles: ParticleSystem, dtMs: number): void {
    const dt = Number.isFinite(dtMs) ? dtMs : 0;
    this.timeMs += dt;
    this.scene.tick(dt);
    const scale = Math.min(width / CAFE_W, height / CAFE_H);
    ctx.save();
    try {
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#2a1d14';
      ctx.fillRect(0, 0, width, height);
      ctx.translate((width - CAFE_W * scale) / 2, (height - CAFE_H * scale) / 2);
      ctx.scale(scale, scale);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      this.safely('backdrop', () => this.drawBackdrop(ctx));
      this.safely('menu', () => this.drawGiftMenu(ctx, view.cafe));
      this.safely('station', () => {
        ctx.save();
        try {
          ctx.translate(STATION_X, STATION_Y);
          this.scene.drawScene(ctx, view, particles);
        } finally {
          ctx.restore();
        }
      });
      this.safely('cat', () => this.drawCat(ctx, 950, 1215));
      this.safely('status', () => this.drawStatus(ctx, view));
      this.safely('queue', () => this.drawQueue(ctx, view.cafe));
      this.safely('hud', () => this.drawHud(ctx, view.cafe));
    } finally {
      ctx.restore();
    }
  }

  /** One failing layer (a font, a broken image) must never take the whole frame down. */
  private safely(layer: string, fn: () => void): void {
    try {
      fn();
    } catch (err) {
      console.error(`[CafeRenderer] ${layer} failed`, err);
    }
  }

  private text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, fill = '#fff', stroke = INK): void {
    ctx.font = `800 ${size}px ${FONT}`;
    ctx.lineWidth = Math.max(4, size / 6);
    ctx.strokeStyle = stroke;
    ctx.strokeText(s, x, y);
    ctx.fillStyle = fill;
    ctx.fillText(s, x, y);
  }

  // ---- scenery -------------------------------------------------------------------------------------------------

  private drawBackdrop(ctx: CanvasRenderingContext2D): void {
    // back wall: warm wood planks
    const wall = ctx.createLinearGradient(0, 200, 0, 1420);
    wall.addColorStop(0, '#8a5a36');
    wall.addColorStop(1, '#b57a47');
    ctx.fillStyle = wall;
    ctx.fillRect(0, 200, CAFE_W, 1240);
    ctx.strokeStyle = 'rgba(60,35,18,0.35)';
    ctx.lineWidth = 3;
    for (let x = 90; x < CAFE_W; x += 135) {
      ctx.beginPath();
      ctx.moveTo(x, 200);
      ctx.lineTo(x, 1420);
      ctx.stroke();
    }
    // Thai-style frieze: a band of gold diamonds
    ctx.fillStyle = '#4a2c17';
    ctx.fillRect(0, 232, CAFE_W, 46);
    ctx.strokeStyle = '#e8b64c';
    ctx.lineWidth = 3;
    for (let x = 30; x < CAFE_W; x += 60) {
      ctx.beginPath();
      ctx.moveTo(x, 255);
      ctx.lineTo(x + 20, 240);
      ctx.lineTo(x + 40, 255);
      ctx.lineTo(x + 20, 270);
      ctx.closePath();
      ctx.stroke();
    }
    // floor: terracotta tiles
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 9; col++) {
        ctx.fillStyle = (row + col) % 2 === 0 ? '#c9825a' : '#b9724c';
        ctx.fillRect(col * 130 - (row % 2) * 65, 1430 + row * 100, 130, 100);
      }
    }
    // awning with scalloped edge
    for (let i = 0; i < 12; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#d94f4f' : '#fff3dc';
      ctx.fillRect(i * 90, 0, 90, 170);
      ctx.beginPath();
      ctx.arc(i * 90 + 45, 170, 45, 0, Math.PI);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(0, 0, CAFE_W, 14);
    // hanging lanterns
    const sway = Math.sin(this.timeMs / 900);
    [[60, 20], [250, 46], [830, 46], [1020, 20]].forEach(([x, len], i) => {
      const sx = (x as number) + sway * 6 * (i % 2 ? 1 : -1);
      const ly = 196 + (len as number);
      ctx.strokeStyle = '#6b3a1c';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(x as number, 170);
      ctx.lineTo(sx, ly - 38);
      ctx.stroke();
      ctx.fillStyle = '#f6c244';
      ctx.fillRect(sx - 16, ly - 42, 32, 10);
      ctx.fillStyle = '#e8503a';
      ctx.beginPath();
      ctx.ellipse(sx, ly, 28, 36, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,220,150,0.7)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(sx, ly, 12, 36, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#f6c244';
      ctx.fillRect(sx - 16, ly + 32, 32, 10);
    });
    // shop sign
    ctx.fillStyle = '#4a2c17';
    ctx.beginPath();
    ctx.roundRect(300, 96, 480, 96, 20);
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#e8b64c';
    ctx.stroke();
    this.text(ctx, 'ร้านขนมไทย', CAFE_W / 2, 146, 60, '#ffe9a8');
  }

  private drawGiftMenu(ctx: CanvasRenderingContext2D, cafe: CafeView | undefined): void {
    const tiers = cafe?.giftMenu ?? [];
    // framed chalkboard
    ctx.fillStyle = '#5a3820';
    ctx.beginPath();
    ctx.roundRect(70, 292, 940, 430, 24);
    ctx.fill();
    ctx.fillStyle = '#2f4a3a';
    ctx.beginPath();
    ctx.roundRect(86, 308, 908, 398, 16);
    ctx.fill();
    this.text(ctx, 'ส่งของขวัญ = สั่งขนม', CAFE_W / 2, 345, 44, '#ffe9a8', '#1c2e24');
    const colW = 440;
    tiers.slice(0, 8).forEach((t, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = 110 + col * (colW + 20);
      const y = 410 + row * 74;
      ctx.fillStyle = '#e8b64c';
      ctx.beginPath();
      ctx.arc(x + 34, y + 30, 31, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#a9761f';
      ctx.lineWidth = 4;
      ctx.stroke();
      this.text(ctx, String(t.coins), x + 34, y + 32, t.coins >= 100 ? 24 : 30, '#fff', '#7a4f12');
      ctx.fillStyle = isColor(t.color) ? t.color : '#f5f0e1';
      ctx.beginPath();
      ctx.arc(x + 96, y + 30, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.textAlign = 'left';
      this.text(ctx, clip(t.nameTh, 11), x + 118, y + 32, 36, '#fff', '#1c2e24');
      ctx.textAlign = 'center';
    });
  }

  private drawCat(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    const wave = Math.sin(this.timeMs / 260) * 0.35;
    ctx.save();
    try {
      ctx.translate(x, y);
      ctx.fillStyle = '#fffaf0';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.ellipse(0, 40, 48, 56, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // waving paw
      ctx.save();
      ctx.translate(34, 0);
      ctx.rotate(-0.6 + wave);
      ctx.beginPath();
      ctx.roundRect(-10, -52, 22, 62, 11);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      // head
      ctx.beginPath();
      ctx.arc(0, -28, 40, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      for (const sx of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(sx * 18, -58);
        ctx.lineTo(sx * 40, -86);
        ctx.lineTo(sx * 42, -50);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.arc(-14, -32, 4, 0, Math.PI * 2);
      ctx.arc(14, -32, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, -20, 9, 0.2, Math.PI - 0.2);
      ctx.stroke();
      // red collar and gold bell
      ctx.fillStyle = '#d94f4f';
      ctx.fillRect(-30, -4, 60, 12);
      ctx.fillStyle = '#e8b64c';
      ctx.beginPath();
      ctx.arc(0, 14, 10, 0, Math.PI * 2);
      ctx.fill();
    } finally {
      ctx.restore();
    }
  }

  // ---- state text, hearts, progress -----------------------------------------------------------------------------

  private drawStatus(ctx: CanvasRenderingContext2D, view: RenderView): void {
    const name = view.dessertNameTh ?? '';
    const serving = view.cafe?.serving ?? null;
    switch (view.state) {
      case 'PREPARING':
        this.text(ctx, serving ? 'ลูกค้ามาแล้ว!' : 'เตรียมร้าน…', CAFE_W / 2, 748, 46);
        if (serving) this.text(ctx, clip(`สั่ง ${serving.dessertNameTh}`, 22), CAFE_W / 2, 808, 42, '#ffe9a8');
        break;
      case 'COOKING': {
        this.text(ctx, clip(`กำลังทำ ${name}`.trim(), 24), CAFE_W / 2, 748, 46);
        if (view.stepNameTh) this.text(ctx, clip(view.stepNameTh, 30), CAFE_W / 2, 800, 32, '#ffe9a8');
        const heart = clamp01(view.heart);
        this.text(ctx, 'กดหัวใจรัว ๆ ให้สุกเร็ว!', CAFE_W / 2, 858, 34, '#ffd1dc');
        for (let i = 0; i < 10; i++) this.drawHeart(ctx, 308 + i * 46, 912, 17, (i + 1) / 10 <= heart + 1e-6);
        this.text(ctx, `×${(1 + heart * (this.maxBoost - 1)).toFixed(1)}`, 830, 912, 34, '#ffd1dc');
        this.drawProgress(ctx, view.progress);
        break;
      }
      case 'PRESENTING':
      case 'REWARDING':
        this.text(ctx, clip(`เสร็จแล้ว! ${name}`.trim(), 26), CAFE_W / 2, 748, 48);
        if (view.toast) this.text(ctx, clip(view.toast, 40), CAFE_W / 2, 810, 42, '#ffd966');
        break;
      default:
        break;
    }
  }

  private drawProgress(ctx: CanvasRenderingContext2D, progress: number): void {
    const p = Number.isFinite(progress) ? Math.min(100, Math.max(0, progress)) : 0;
    ctx.fillStyle = 'rgba(59,42,26,0.6)';
    ctx.beginPath();
    ctx.roundRect(140, 1392, 800, 30, 15);
    ctx.fill();
    if (p > 0) {
      const g = ctx.createLinearGradient(140, 0, 940, 0);
      g.addColorStop(0, '#f6b26b');
      g.addColorStop(1, '#e06666');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.roundRect(140, 1392, Math.max(30, 800 * (p / 100)), 30, 15);
      ctx.fill();
    }
    this.text(ctx, `${Math.round(p)}%`, CAFE_W / 2, 1407, 24);
  }

  private drawHeart(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, filled: boolean): void {
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.9);
    ctx.bezierCurveTo(x - s * 1.6, y - s * 0.2, x - s * 0.7, y - s * 1.2, x, y - s * 0.35);
    ctx.bezierCurveTo(x + s * 0.7, y - s * 1.2, x + s * 1.6, y - s * 0.2, x, y + s * 0.9);
    ctx.closePath();
    ctx.fillStyle = filled ? '#ff5d8f' : 'rgba(255,255,255,0.28)';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = filled ? '#8b1e3f' : 'rgba(255,255,255,0.7)';
    ctx.stroke();
  }

  // ---- queue -----------------------------------------------------------------------------------------------------

  private drawQueue(ctx: CanvasRenderingContext2D, cafe: CafeView | undefined): void {
    if (!cafe) return;
    // Waiting customers stand in a line behind the counter; the one being served is large in the middle.
    const slots: [number, number][] = [[170, 1730], [360, 1730], [720, 1730], [910, 1730]];
    cafe.waiting.slice(0, slots.length).forEach((c, i) => {
      const [x, y] = slots[i] as [number, number];
      this.drawCustomer(ctx, c, x, y, 54);
    });
    if (cafe.serving) {
      this.drawCustomer(ctx, cafe.serving, CAFE_W / 2, 1655, 92);
      this.drawOrderBubble(ctx, cafe.serving);
    } else {
      this.text(ctx, 'รอลูกค้า…', CAFE_W / 2, 1650, 40, '#fff3dc');
    }
  }

  private drawOrderBubble(ctx: CanvasRenderingContext2D, c: CustomerView): void {
    const w = 460;
    const x = CAFE_W / 2 - w / 2;
    const y = 1440;
    ctx.fillStyle = '#fffaf0';
    ctx.beginPath();
    ctx.roundRect(x, y, w, 96, 30);
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = c.viewer ? '#e8b64c' : INK;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(CAFE_W / 2 - 18, y + 94);
    ctx.lineTo(CAFE_W / 2, y + 128);
    ctx.lineTo(CAFE_W / 2 + 18, y + 94);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = isColor(c.color) ? c.color : '#f5f0e1';
    ctx.beginPath();
    ctx.arc(x + 58, y + 48, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.textAlign = 'left';
    this.text(ctx, clip(c.dessertNameTh, 12), x + 100, y + 52, 40, INK, '#fffaf0');
    ctx.textAlign = 'center';
  }

  private drawCustomer(ctx: CanvasRenderingContext2D, c: CustomerView, x: number, baseY: number, r: number): void {
    const spec = avatarSpec(c.seed, c.name);
    const bob = Math.sin(this.timeMs / 420 + (Number.isFinite(c.seed) ? c.seed : 0)) * 4;
    const y = baseY + bob;
    // body
    ctx.fillStyle = isColor(spec.bg) ? spec.bg : '#e06666';
    ctx.beginPath();
    ctx.roundRect(x - r * 1.15, y + r * 0.7, r * 2.3, r * 1.5, r * 0.5);
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 4;
    ctx.stroke();
    // head slot: a round frame (gold for a viewer) with the profile picture or a generated face inside
    ctx.fillStyle = spec.skin;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    const img = this.avatars.get(c.avatarUrl);
    ctx.save();
    try {
      ctx.beginPath();
      ctx.arc(x, y, r - 4, 0, Math.PI * 2);
      ctx.clip();
      let drawn = false;
      if (img?.source) {
        try {
          ctx.drawImage(img.source, x - r, y - r, r * 2, r * 2);
          drawn = true;
        } catch {
          drawn = false; // a broken image falls back to the generated avatar
        }
      }
      if (!drawn) this.drawGeneratedFace(ctx, spec.bg, spec.fg, spec.initial, x, y, r);
    } finally {
      ctx.restore();
    }
    ctx.lineWidth = c.viewer ? 8 : 5;
    ctx.strokeStyle = c.viewer ? '#e8b64c' : '#fff3dc';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    // name (viewers only) and patience
    if (c.viewer && c.name) this.text(ctx, clip(c.name, 12), x, y + r * 2.45, Math.round(r * 0.5), '#fff', INK);
    if (!c.serving) this.drawPatience(ctx, x, y + r * 2.1 + (c.viewer && c.name ? Math.round(r * 0.5) : 0) + 14, r * 2, c.patience);
    if (!c.serving) {
      ctx.textAlign = 'center';
      this.text(ctx, clip(c.dessertNameTh, 8), x, y - r - 22, Math.round(r * 0.42), '#fff3dc', INK);
    }
  }

  private drawGeneratedFace(ctx: CanvasRenderingContext2D, bg: string, fg: string, initial: string | null, x: number, y: number, r: number): void {
    ctx.fillStyle = isColor(bg) ? bg : '#e06666';
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
    if (initial) {
      this.text(ctx, initial, x, y + 2, Math.round(r * 1.2), isColor(fg) ? fg : '#fff', 'rgba(0,0,0,0.35)');
      return;
    }
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x - r * 0.3, y - r * 0.15, r * 0.12, 0, Math.PI * 2);
    ctx.arc(x + r * 0.3, y - r * 0.15, r * 0.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = Math.max(3, r * 0.08);
    ctx.beginPath();
    ctx.arc(x, y + r * 0.05, r * 0.38, 0.2, Math.PI - 0.2);
    ctx.stroke();
  }

  private drawPatience(ctx: CanvasRenderingContext2D, cx: number, y: number, w: number, patience: number): void {
    const p = clamp01(patience);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.roundRect(cx - w / 2, y, w, 12, 6);
    ctx.fill();
    if (p > 0) {
      ctx.fillStyle = p > 0.5 ? '#7bc96f' : p > 0.25 ? '#f1c232' : '#e06666';
      ctx.beginPath();
      ctx.roundRect(cx - w / 2, y, Math.max(12, w * p), 12, 6);
      ctx.fill();
    }
  }

  // ---- top-corner counters ---------------------------------------------------------------------------------------

  private drawHud(ctx: CanvasRenderingContext2D, cafe: CafeView | undefined): void {
    if (!cafe) return;
    const coins = Number.isFinite(cafe.coins) ? Math.max(0, Math.floor(cafe.coins)) : 0;
    ctx.fillStyle = '#e8b64c';
    ctx.beginPath();
    ctx.arc(1030, 50, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#a9761f';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.textAlign = 'right';
    this.text(ctx, coins >= 1e6 ? `${Math.floor(coins / 1e6)}M` : String(coins), 990, 52, 38, '#fff', '#7a4f12');
    ctx.textAlign = 'center';
    const total = Number.isFinite(cafe.waitingTotal) ? Math.max(0, Math.min(999, Math.floor(cafe.waitingTotal))) : 0;
    ctx.textAlign = 'left';
    this.text(ctx, `คิว ${total}`, 40, 52, 38, '#fff', INK);
    ctx.textAlign = 'center';
  }
}
