import type { ParticleSystem } from '../anim/ParticleSystem';
import { artImage, drawArt } from './artImages';
import { drawArtServed } from './dessertArt';
import { CAFE_PICS, ICON_PICS } from './artManifest';
import { avatarSpec } from '../cafe/avatars';
import { outfitIndex } from '../cafe/gender';
import type { CafeView, CustomerView, RenderView } from '../Game';
import type { AvatarCache } from './AvatarCache';
import { Renderer } from './Renderer';

interface Actor {
  c: CustomerView;
  x: number;
  y: number;
  r: number;
  leaving: boolean;
  speed: number;
  fadeMs?: number;
}

/** Portrait world (9:16). The cooking station from the landscape scene is placed inside it as a 1000x600 window. */
export const CAFE_W = 1080;
export const CAFE_H = 1920;
const STATION_X = 40;
const STATION_Y = 910;

const FONT = '"Mali", "Noto Sans Thai", system-ui, sans-serif';
const INK = '#3b2a1a';
const clip = (s: string, max: number): string => (s.length > max ? `${Array.from(s).slice(0, max - 1).join('')}…` : s);
const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
const isColor = (c: string): boolean => /^#[0-9a-f]{3,8}$/i.test(c);

/**
 * The whole café-mode UI on one portrait canvas. Top to bottom: awning and shop sign, the customers (queue with a round
 * head slot for each viewer's picture; the important part sits at the top because the bottom of a TikTok Live screen is
 * covered by chat), status and hearts, the cooking counter (existing scene) with a lucky cat, and the gift menu board.
 * Few, large, outlined elements so it reads on a phone. Pure drawing; never changes game state.
 */
export class CafeRenderer {
  private readonly scene = new Renderer();
  private timeMs = 0;
  private lastDt = 16;

  constructor(
    private readonly maxBoost: number,
    private readonly avatars: AvatarCache,
  ) {}

  draw(ctx: CanvasRenderingContext2D, width: number, height: number, view: RenderView, particles: ParticleSystem, dtMs: number): void {
    const dt = Number.isFinite(dtMs) ? dtMs : 0;
    this.timeMs += dt;
    this.lastDt = Math.min(100, Math.max(0, dt));
    this.scene.tick(dt);
    const scale = Math.min(width / CAFE_W, height / CAFE_H);
    ctx.save();
    try {
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#2a1d14';
      ctx.fillRect(0, 0, width, height);
      ctx.translate((width - CAFE_W * scale) / 2, (height - CAFE_H * scale) / 2);
      ctx.scale(scale, scale);
      // the hungry ghost squeezes: the whole café is pressed in from the sides and shakes
      const sq = Number.isFinite(view.cafe?.squeeze) ? Math.min(1, Math.max(0, view.cafe?.squeeze as number)) : 0;
      if (sq > 0.05) {
        const shake = Math.sin(this.timeMs / 45) * (2 + 6 * sq) * (view.cafe?.squeezedNow ? 2 : 1);
        const sx = 1 - 0.07 * sq - (view.cafe?.squeezedNow ? 0.03 : 0);
        ctx.translate(CAFE_W / 2 + shake, CAFE_H / 2);
        ctx.scale(sx, 1);
        ctx.translate(-CAFE_W / 2, -CAFE_H / 2);
      }
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      this.safely('backdrop', () => this.drawBackdrop(ctx));
      this.safely('spooky', () => {
        // a plain, steady cool tint while the ghost is calling or at the counter (no frame, no flicker)
        if (!view.cafe?.spooky) return;
        ctx.fillStyle = 'rgba(25,32,85,0.3)';
        ctx.fillRect(0, 0, CAFE_W, CAFE_H);
      });
      this.safely('menu', () => this.drawGiftMenu(ctx, view.cafe));
      this.safely('station', () => {
        ctx.save();
        try {
          ctx.translate(STATION_X, STATION_Y);
          // excitement: the more hearts are tapped, the more the camera slowly zooms in (plus a small kick on every tap)
          const z = this.zoomFor(view);
          if (z > 1.001) {
            ctx.beginPath();
            ctx.rect(0, 0, 1000, 600);
            ctx.clip();
            ctx.translate(500, 330);
            ctx.scale(z, z);
            ctx.translate(-500, -330);
          }
          this.scene.drawScene(ctx, view, particles, !artImage(this.backgroundKey()), !(view.serveOutT !== undefined && view.serveOutT > 0));
        } finally {
          ctx.restore();
        }
      });
      this.safely('logo', () => drawArt(ctx, CAFE_PICS.logo, 105, 1205, 180, 170, 0, 1, 1, 4));
      this.safely('excite', () => {
        // a warm pulsing glow at the edges of the cooking window while the hearts are flying
        if (view.state !== 'COOKING' || this.level < 0.25) return;
        const a = (0.10 + 0.22 * this.level) * (0.75 + 0.25 * Math.sin(this.timeMs / (260 - 120 * this.level)));
        const g = ctx.createRadialGradient(STATION_X + 500, STATION_Y + 330, 260, STATION_X + 500, STATION_Y + 330, 620);
        g.addColorStop(0, 'rgba(255,120,80,0)');
        g.addColorStop(1, `rgba(255,90,70,${a.toFixed(3)})`);
        ctx.fillStyle = g;
        ctx.fillRect(STATION_X, STATION_Y, 1000, 600);
      });
      this.safely('phone', () => this.drawPhone(ctx, view.cafe));
      this.safely('cat', () => this.drawCat(ctx, 975, 1428, view.cafe?.luckyCatSec ?? 0));
      this.safely('lucky', () => this.drawLuckyPill(ctx, view.cafe));
      this.safely('status', () => this.drawStatus(ctx, view));
      this.holdLeaving = view.serveOutT !== undefined && Number.isFinite(view.serveOutT) && view.serveOutT > 0 && view.serveOutT < 1;
      this.safely('queue', () => this.drawQueue(ctx, view.cafe, dt));
      this.safely('serve', () => this.drawServeOut(ctx, view));
      this.safely('shaman', () => this.drawShaman(ctx, view.cafe));
      this.safely('shamanQuota', () => this.drawShamanQuota(ctx, view.cafe));
      this.safely('connection', () => this.drawConnection(ctx, view.cafe));
      this.safely('squeeze', () => this.drawSqueeze(ctx, view.cafe, sq));
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
    ctx.font = `700 ${size}px ${FONT}`;
    ctx.lineWidth = Math.max(4, size / 6);
    ctx.strokeStyle = stroke;
    ctx.strokeText(s, x, y);
    ctx.fillStyle = fill;
    ctx.fillText(s, x, y);
  }

  // ---- scenery -------------------------------------------------------------------------------------------------

  /** Which painted backdrop to use ('day' | 'rain' | 'night'). */
  background: 'day' | 'rain' | 'night' = 'day';

  private mutedKey = '';
  private mutedCanvas: CanvasImageSource | null = null;

  /** The painted backdrop with its colors toned down a little (less saturated, slightly darker). Built once. */
  private mutedBackground(bg: CanvasImageSource): CanvasImageSource {
    const key = this.backgroundKey();
    if (this.mutedCanvas && this.mutedKey === key) return this.mutedCanvas;
    let out: CanvasImageSource = bg;
    try {
      if (typeof document !== 'undefined') {
        const c = document.createElement('canvas');
        c.width = 720;
        c.height = 1280;
        const g = c.getContext('2d');
        if (g) {
          g.drawImage(bg, 0, 0, 720, 1280);
          g.globalCompositeOperation = 'saturation';
          g.globalAlpha = 0.32;
          g.fillStyle = '#808080';
          g.fillRect(0, 0, 720, 1280);
          g.globalCompositeOperation = 'source-over';
          g.globalAlpha = 1;
          g.fillStyle = 'rgba(45,28,18,0.12)';
          g.fillRect(0, 0, 720, 1280);
          out = c;
        }
      }
    } catch {
      out = bg;
    }
    this.mutedKey = key;
    this.mutedCanvas = out;
    return out;
  }

  /**
   * The Isan shaman (หมอผี) comes to help when someone shares: walks in from the left saying his line, splashes holy
   * water at the ghost, then walks away. Painted pictures shaman-1/2/3 (walk, throw, stand) when loaded; drawn otherwise.
   */
  private drawShaman(ctx: CanvasRenderingContext2D, cafe: CafeView | undefined): void {
    const raw = cafe?.shaman;
    if (raw === undefined || !Number.isFinite(raw) || raw <= 0 || raw >= 1) return;
    const t = raw;
    const groundY = 690;
    const standX = 330;
    // 0..0.42 walks in, 0.42..0.7 splashes, 0.7..1 walks away
    let x = standX;
    let phase: 'walk' | 'throw' = 'throw';
    if (t < 0.42) {
      x = -160 + (standX + 160) * (t / 0.42);
      phase = 'walk';
    } else if (t > 0.7) {
      x = standX - (standX + 200) * ((t - 0.7) / 0.3);
      phase = 'walk';
    }
    const dir = t > 0.7 ? -1 : 1;
    const hop = phase === 'walk' ? Math.abs(Math.sin(this.timeMs / 110)) * 6 : 0;
    const cy = groundY - 150 - hop;
    // shadow
    ctx.fillStyle = 'rgba(40,22,10,0.3)';
    ctx.beginPath();
    ctx.ellipse(x, groundY, 90, 16, 0, 0, Math.PI * 2);
    ctx.fill();
    const pic = CAFE_PICS.shaman[phase === 'walk' ? (Math.floor(this.timeMs / 220) % 2 === 0 ? 0 : 2) : 1] as string;
    if (artImage(pic)) {
      // the pictures face left, so he is mirrored while walking in and splashing (towards the ghost on the right)
      drawArt(ctx, pic, x, cy, 280, 340, Math.sin(this.timeMs / 130) * (phase === 'walk' ? 0.04 : 0), -dir, 1, 4);
    } else {
      ctx.save();
      try {
        ctx.translate(x, cy);
        ctx.scale(dir, 1);
        // white robe
        ctx.fillStyle = '#f4f1e6';
        ctx.strokeStyle = INK;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.roundRect(-62, -40, 124, 190, 40);
        ctx.fill();
        ctx.stroke();
        // red sacred threads across the chest
        ctx.strokeStyle = '#d94f4f';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(-50, -30);
        ctx.lineTo(50, 90);
        ctx.moveTo(50, -30);
        ctx.lineTo(-50, 90);
        ctx.stroke();
        // head with a white head cloth
        ctx.fillStyle = '#e8b98a';
        ctx.strokeStyle = INK;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(0, -78, 48, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.roundRect(-52, -128, 104, 36, 18);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#2b2230';
        for (const sx of [-1, 1]) {
          ctx.beginPath();
          ctx.arc(sx * 17, -80, 5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(0, -62, 14, 0.2, Math.PI - 0.2);
        ctx.stroke();
        // silver bowl of holy water in the raised hand
        const lift = phase === 'throw' ? Math.sin(t * 40) * 4 - 20 : 0;
        ctx.fillStyle = '#d7dde6';
        ctx.beginPath();
        ctx.ellipse(86, 30 + lift, 40, 16, 0, 0, Math.PI);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#9fd6ff';
        ctx.beginPath();
        ctx.ellipse(86, 30 + lift, 38, 9, 0, 0, Math.PI * 2);
        ctx.fill();
      } finally {
        ctx.restore();
      }
    }
    // his line, while he walks in
    if (t < 0.5) {
      const label = 'ผีได๋ คือสิมาแข็งข้อกับกู๋!';
      ctx.font = `700 34px ${FONT}`;
      const w = (Number.isFinite(ctx.measureText(label).width) ? ctx.measureText(label).width : 420) + 48;
      const bx = Math.min(Math.max(x + 30, w / 2 + 10), CAFE_W - w / 2 - 10);
      ctx.fillStyle = '#fffaf0';
      ctx.beginPath();
      ctx.roundRect(bx - w / 2, cy - 250, w, 64, 24);
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = INK;
      ctx.stroke();
      this.text(ctx, label, bx, cy - 217, 34, INK, '#fffaf0');
    }
    // holy water arcing from the bowl to the ghost
    if (t >= 0.42 && t <= 0.72) {
      const k = (t - 0.42) / 0.3;
      const sx = x + (artImage(CAFE_PICS.shaman[1] as string) ? 105 : 86);
      const sy = cy + (artImage(CAFE_PICS.shaman[1] as string) ? -30 : 10);
      const tx = CAFE_W / 2;
      const ty = 520;
      for (let i = 0; i < 14; i++) {
        const p = Math.min(1, Math.max(0, k * 1.3 - i * 0.04));
        if (p <= 0) continue;
        const px = sx + (tx - sx) * p + Math.sin(i * 7.3) * 14;
        const py = sy + (ty - sy) * p - Math.sin(Math.PI * p) * 130 + Math.cos(i * 4.1) * 10;
        if (!drawArt(ctx, i % 2 ? CAFE_PICS.holyWater : CAFE_PICS.holyWaterDrop, px, py, 40 + (i % 3) * 12, 40 + (i % 3) * 12, i)) {
          ctx.fillStyle = i % 2 ? 'rgba(180,225,255,0.95)' : 'rgba(255,255,255,0.95)';
          ctx.beginPath();
          ctx.arc(px, py, 7 + (i % 3) * 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    // the splash lands: a glowing ring on the ghost
    if (t > 0.58 && t < 0.78) {
      const k = (t - 0.58) / 0.2;
      ctx.save();
      ctx.globalAlpha = 1 - k;
      const painted = drawArt(ctx, CAFE_PICS.splashRing, CAFE_W / 2, 560, 380 + 160 * k, 240 + 100 * k) || drawArt(ctx, CAFE_PICS.calmBurst, CAFE_W / 2, 520, 300 + 150 * k, 300 + 150 * k);
      ctx.restore();
      if (painted) return;
      ctx.strokeStyle = `rgba(190,235,255,${(1 - k).toFixed(3)})`;
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.ellipse(CAFE_W / 2, 520, 60 + 220 * k, 40 + 150 * k, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  /** Shown on the canvas only when asked (a live bridge is configured): a small dot and label for the event link. */
  showConnection = false;

  private drawConnection(ctx: CanvasRenderingContext2D, cafe: CafeView | undefined): void {
    if (!this.showConnection || !cafe) return;
    const st = cafe.connection ?? 'offline';
    const color = st === 'connected' ? '#5fe07a' : st === 'reconnecting' ? '#ffc247' : '#ff6b6b';
    const label = st === 'connected' ? 'ต่อ TikTok แล้ว' : st === 'reconnecting' ? 'กำลังต่อใหม่…' : 'ไม่ได้ต่อ TikTok';
    ctx.font = `700 24px ${FONT}`;
    const w = (Number.isFinite(ctx.measureText(label).width) ? ctx.measureText(label).width : 150) + 52;
    ctx.fillStyle = 'rgba(20,12,8,0.7)';
    ctx.beginPath();
    ctx.roundRect(CAFE_W - 16 - w, 84, w, 40, 20);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(CAFE_W - 16 - w + 22, 104, 9, 0, Math.PI * 2);
    ctx.fill();
    this.text(ctx, label, CAFE_W - 16 - w + 36 + (w - 36) / 2, 106, 24, '#fff3dc', '#1c1233');
  }

  /** How many shaman visits are saved up from shares (shown whenever there is at least one, or one is on its way). */
  private drawShamanQuota(ctx: CanvasRenderingContext2D, cafe: CafeView | undefined): void {
    const q = cafe?.shamanQuota;
    if (q === undefined || !Number.isFinite(q) || q <= 0) return;
    const n = Math.min(99, Math.floor(q));
    const max = Number.isFinite(cafe?.shamanQuotaMax) ? Math.max(1, Math.floor(cafe?.shamanQuotaMax as number)) : 0;
    const label = max > 0 ? `หมอผี ×${Math.min(n, max)} (สูงสุด ${max})` : `หมอผี ×${n}`;
    ctx.font = `700 30px ${FONT}`;
    const icon = artImage(CAFE_PICS.shaman[0] as string) !== null;
    const w = (Number.isFinite(ctx.measureText(label).width) ? ctx.measureText(label).width : 150) + 48 + (icon ? 36 : 0);
    ctx.fillStyle = 'rgba(40,28,60,0.85)';
    ctx.beginPath();
    ctx.roundRect(16, 84, w, 46, 23);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#bfe6ff';
    ctx.stroke();
    if (icon) drawArt(ctx, CAFE_PICS.shaman[0] as string, 40, 100, 40, 62, 0, 1, 1, 2);
    this.text(ctx, label, 16 + (icon ? 36 : 0) + (w - (icon ? 36 : 0)) / 2, 109, 28, '#e6f6ff', '#1c1233');
  }

  /** Warning while the ghost squeezes: dark red edges closing in, a danger bar and a call to tap. */
  private drawSqueeze(ctx: CanvasRenderingContext2D, cafe: CafeView | undefined, sq: number): void {
    if (!cafe || sq <= 0.05) return;
    const g = ctx.createRadialGradient(CAFE_W / 2, CAFE_H / 2, CAFE_H * (0.62 - 0.22 * sq), CAFE_W / 2, CAFE_H / 2, CAFE_H * 0.8);
    g.addColorStop(0, 'rgba(120,0,40,0)');
    g.addColorStop(1, `rgba(120,0,40,${(0.25 + 0.5 * sq).toFixed(3)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CAFE_W, CAFE_H);
    // the ghost's hands close in from both sides
    const hands = artImage(CAFE_PICS.ghostHands);
    if (hands) {
      ctx.save();
      ctx.globalAlpha = 0.18 + 0.4 * sq;
      // the hands start wide at the screen edges and close in as the squeeze grows
      drawArt(ctx, CAFE_PICS.ghostHands, CAFE_W / 2, 790, 1200 - 380 * sq, 420);
      ctx.restore();
    }
    const cx = CAFE_W / 2;
    const y = 1000;
    ctx.fillStyle = 'rgba(40,10,30,0.8)';
    ctx.beginPath();
    ctx.roundRect(cx - 330, y - 52, 660, 104, 28);
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#ff6b8b';
    ctx.stroke();
    this.text(ctx, cafe.squeezedNow ? 'ผีบีบแล้ว!' : 'ผีหิวมาก! กดหัวใจรัวๆ!', cx, y - 22, 36, '#fff', '#8b1e1e');
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.beginPath();
    ctx.roundRect(cx - 280, y + 12, 560, 22, 11);
    ctx.fill();
    ctx.fillStyle = sq > 0.7 ? '#ff4d6d' : '#ffb84d';
    ctx.beginPath();
    ctx.roundRect(cx - 280, y + 12, Math.max(22, 560 * sq), 22, 11);
    ctx.fill();
  }

  private zoom = 1;
  private level = 0;
  private lastWobble = 0;
  private kick = 0;

  /** Smoothed zoom for the cooking window, 1..~1.2. Pure function of the view and elapsed time. */
  private zoomFor(view: RenderView): number {
    const heart = Number.isFinite(view.heart) ? Math.max(0, view.heart) : 0;
    const level = Math.min(1, heart);
    this.level = level;
    const w = Number.isFinite(view.wobble) ? view.wobble : 0;
    if (w > this.lastWobble + 0.05) this.kick = 1; // a tap just happened
    this.lastWobble = w;
    this.kick = Math.max(0, this.kick - this.lastDt / 260);
    const cooking = view.state === 'COOKING';
    const target = (cooking ? 1 + 0.14 * level : 1) + 0.035 * this.kick;
    const k = 1 - Math.exp(-this.lastDt / 420); // slow, gradual approach
    this.zoom += (target - this.zoom) * k;
    return Number.isFinite(this.zoom) ? Math.min(1.25, Math.max(1, this.zoom)) : 1;
  }

  private backgroundKey(): string {
    return this.background === 'rain' ? CAFE_PICS.bgRain : this.background === 'night' ? CAFE_PICS.bgNight : CAFE_PICS.bgDay;
  }

  private drawBackdrop(ctx: CanvasRenderingContext2D): void {
    const bg = artImage(this.backgroundKey());
    if (bg) {
      ctx.drawImage(this.mutedBackground(bg), 0, 0, CAFE_W, CAFE_H);
      return;
    }
    // back wall: warm wood planks
    const wall = ctx.createLinearGradient(0, 165, 0, 1920);
    wall.addColorStop(0, '#8a5a36');
    wall.addColorStop(1, '#b57a47');
    ctx.fillStyle = wall;
    ctx.fillRect(0, 165, CAFE_W, 1755);
    ctx.strokeStyle = 'rgba(60,35,18,0.35)';
    ctx.lineWidth = 3;
    for (let x = 90; x < CAFE_W; x += 135) {
      ctx.beginPath();
      ctx.moveTo(x, 165);
      ctx.lineTo(x, 1920);
      ctx.stroke();
    }
    // Thai-style frieze: a band of gold diamonds
    ctx.fillStyle = '#4a2c17';
    ctx.fillRect(0, 716, CAFE_W, 46);
    ctx.strokeStyle = '#e8b64c';
    ctx.lineWidth = 3;
    for (let x = 30; x < CAFE_W; x += 60) {
      ctx.beginPath();
      ctx.moveTo(x, 739);
      ctx.lineTo(x + 20, 724);
      ctx.lineTo(x + 40, 739);
      ctx.lineTo(x + 20, 754);
      ctx.closePath();
      ctx.stroke();
    }
    // floor under the customers: terracotta tiles
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 10; col++) {
        ctx.fillStyle = (row + col) % 2 === 0 ? '#c9825a' : '#b9724c';
        ctx.fillRect(col * 120 - (row % 2) * 60, 664 + row * 26, 120, 26);
      }
    }
    // Thai eave: teal / magenta bands with a row of pointed gold-trimmed pennants (no Chinese red lanterns)
    for (let i = 0; i < 12; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#1f8a8a' : '#b8366f';
      ctx.fillRect(i * 90, 0, 90, 96);
      ctx.fillStyle = '#e8b64c';
      ctx.fillRect(i * 90, 0, 4, 96);
      ctx.fillStyle = i % 2 === 0 ? '#1f8a8a' : '#b8366f';
      ctx.beginPath();
      ctx.moveTo(i * 90, 96);
      ctx.lineTo(i * 90 + 90, 96);
      ctx.lineTo(i * 90 + 45, 140);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#e8b64c';
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.fillStyle = '#e8b64c';
      ctx.beginPath();
      ctx.arc(i * 90 + 45, 60, 10, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#e8b64c';
    ctx.fillRect(0, 90, CAFE_W, 8);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(0, 0, CAFE_W, 10);
    // jasmine garlands (พวงมาลัย) hanging and swaying
    const sway = Math.sin(this.timeMs / 900);
    [[70, 40], [250, 76], [830, 76], [1010, 40]].forEach(([x, len], i) => {
      const sx = (x as number) + sway * 6 * (i % 2 ? 1 : -1);
      const ly = 150 + (len as number);
      ctx.strokeStyle = '#4a7a3a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x as number, 140);
      ctx.lineTo(sx, ly);
      ctx.stroke();
      for (let k = 0; k < 6; k++) {
        const fy = 150 + ((ly - 150) * k) / 5;
        const fx = (x as number) + ((sx - (x as number)) * k) / 5;
        ctx.fillStyle = '#fffdf2';
        ctx.beginPath();
        ctx.ellipse(fx, fy, 9, 13, 0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = k % 2 ? '#f59a23' : '#f6c244';
        ctx.beginPath();
        ctx.arc(fx, fy, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#e8503a';
      ctx.beginPath();
      ctx.ellipse(sx, ly + 18, 7, 12, 0, 0, Math.PI * 2);
      ctx.fill();
    });
    // shop sign: gold-framed board with chofa (gable horn) corners
    ctx.fillStyle = '#4a2c17';
    ctx.beginPath();
    ctx.roundRect(330, 38, 420, 84, 14);
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#e8b64c';
    ctx.stroke();
    ctx.fillStyle = '#e8b64c';
    for (const [hx, dir] of [[330, -1], [750, 1]] as const) {
      ctx.beginPath();
      ctx.moveTo(hx, 70);
      ctx.quadraticCurveTo(hx + dir * 38, 62, hx + dir * 34, 24);
      ctx.quadraticCurveTo(hx + dir * 14, 50, hx, 52);
      ctx.closePath();
      ctx.fill();
    }
    this.text(ctx, 'ร้านขนมไทย', CAFE_W / 2, 82, 52, '#ffe9a8');
  }

  private drawGiftMenu(ctx: CanvasRenderingContext2D, cafe: CafeView | undefined): void {
    const tiers = cafe?.giftMenu ?? [];
    // framed chalkboard
    ctx.fillStyle = '#5a3820';
    ctx.beginPath();
    ctx.roundRect(70, 1560, 940, 350, 24);
    ctx.fill();
    ctx.fillStyle = '#2f4a3a';
    ctx.beginPath();
    ctx.roundRect(86, 1574, 908, 322, 16);
    ctx.fill();
    this.text(ctx, 'ส่งของขวัญ = สั่งขนม', CAFE_W / 2, 1604, 40, '#ffe9a8', '#1c2e24');
    const colW = 440;
    tiers.slice(0, 8).forEach((t, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = 110 + col * (colW + 20);
      const y = 1646 + row * 58;
      // the coin button, its number and the dessert picture are left out on purpose: that space stays empty
      ctx.textAlign = 'left';
      this.text(ctx, clip(t.nameTh, 10), x + 128, y + 24, 30, '#fff', '#1c2e24');
      ctx.textAlign = 'center';
    });
  }

  private drawLuckyPill(ctx: CanvasRenderingContext2D, cafe: CafeView | undefined): void {
    const sec = cafe?.luckyCatSec;
    if (sec === undefined || !Number.isFinite(sec) || sec <= 0) return;
    ctx.fillStyle = 'rgba(60,35,18,0.88)';
    ctx.beginPath();
    ctx.roundRect(770, 1312, 280, 46, 23);
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#e8b64c';
    ctx.stroke();
    const pct = Number.isFinite(cafe?.luckyCatBonusPct) ? Math.round(cafe?.luckyCatBonusPct as number) : 0;
    this.text(ctx, `แมวกวัก +${pct}% · ${Math.ceil(Math.min(999, sec))} วิ`, 910, 1336, 25, '#ffe08a');
  }

  /** The phone on the counter: decoration normally, shaking with ring arcs and a warning when a call comes in. */
  private drawPhone(ctx: CanvasRenderingContext2D, cafe: CafeView | undefined): void {
    const ringing = cafe?.phoneRinging === true;
    const x = 110;
    const y = 1452;
    const pic = ringing ? CAFE_PICS.phoneRing : CAFE_PICS.phoneStill;
    if (artImage(pic)) {
      drawArt(ctx, pic, x + 14 + (ringing ? Math.sin(this.timeMs / 35) * 5 : 0), y - 28, 220, 190, 0, 1, 1, 4);
      this.phoneLabel(ctx, cafe, x + 70, y - 138);
      return;
    }
    ctx.save();
    try {
      ctx.translate(x + (ringing ? Math.sin(this.timeMs / 35) * 4 : 0), y);
      ctx.fillStyle = '#2f2f33';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.roundRect(-48, -16, 96, 44, 12);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = ringing ? '#ff6b6b' : '#d94f4f';
      ctx.beginPath();
      ctx.roundRect(-54, -34, 108, 20, 10);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#bdbdc4';
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(-24 + i * 24, 8, 6, 0, Math.PI * 2);
        ctx.fill();
      }
      if (ringing) {
        ctx.strokeStyle = '#ffe08a';
        ctx.lineWidth = 5;
        for (let i = 0; i < 2; i++) {
          ctx.beginPath();
          ctx.arc(0, -34, 70 + i * 22 + (Math.floor(this.timeMs / 150) % 2) * 6, Math.PI * 1.15, Math.PI * 1.85);
          ctx.stroke();
        }
      }
    } finally {
      ctx.restore();
    }
    this.phoneLabel(ctx, cafe, x + 70, y - 138);
  }

  /** The "phone is ringing" label on a solid pill so nothing behind it can hide it. */
  private phoneLabel(ctx: CanvasRenderingContext2D, cafe: CafeView | undefined, cx: number, cy: number): void {
    if (cafe?.phoneTalking) return this.ringLabel(ctx, CAFE_W / 2, cy - 20, 'ฮือๆ ช่วยด้วย ผีอยากกินขนม', 32);
    if (cafe?.phoneRinging) this.ringLabel(ctx, cx, cy);
  }

  private ringLabel(ctx: CanvasRenderingContext2D, cx: number, cy: number, label = 'โทรศัพท์ดัง!', size = 38): void {
    ctx.font = `700 ${size}px ${FONT}`;
    const w = (Number.isFinite(ctx.measureText(label).width) ? ctx.measureText(label).width : 240) + 44;
    ctx.fillStyle = '#d94f4f';
    ctx.beginPath();
    ctx.roundRect(cx - w / 2, cy - 30, w, 60, 30);
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#fff3dc';
    ctx.stroke();
    this.text(ctx, label, cx, cy + 2, size, '#fff', '#8b1e1e');
  }

  private drawCat(ctx: CanvasRenderingContext2D, x: number, y: number, luckySec = 0): void {
    const lucky = Number.isFinite(luckySec) && luckySec > 0;
    const frame = Math.floor(this.timeMs / (lucky ? 260 : 700)) % 2 === 0 ? CAFE_PICS.catUp : CAFE_PICS.catDown;
    if (artImage(frame)) {
      if (lucky) drawArt(ctx, CAFE_PICS.glow, x, y, 190 + 14 * Math.sin(this.timeMs / 200), 190);
      drawArt(ctx, frame, x, y, 130, 130, 0, 1, 1, 3.5);
      return;
    }
    const wave = Math.sin(this.timeMs / (lucky ? 130 : 260)) * 0.35;
    if (lucky) {
      ctx.fillStyle = `rgba(255,214,102,${0.22 + 0.12 * Math.sin(this.timeMs / 200)})`;
      ctx.beginPath();
      ctx.arc(x, y + 10, 118, 0, Math.PI * 2);
      ctx.fill();
    }
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
        this.text(ctx, serving ? 'ลูกค้ามาแล้ว!' : 'เตรียมร้าน…', CAFE_W / 2, 790, 46);
        if (serving) this.text(ctx, clip(`สั่ง ${serving.dessertNameTh}`, 22), CAFE_W / 2, 850, 42, '#ffe9a8');
        break;
      case 'COOKING': {
        this.text(ctx, clip(`กำลังทำ ${name}`.trim(), 24), CAFE_W / 2, 790, 46);
        if (view.stepNameTh) this.text(ctx, clip(view.stepNameTh, 30), CAFE_W / 2, 840, 32, '#ffe9a8');
        const heart = clamp01(view.heart);
        this.text(ctx, view.cafe?.needsTaps ? 'กดหัวใจรัว ๆ เพื่อทำขนม!' : 'กดหัวใจรัว ๆ ให้สุกเร็ว!', CAFE_W / 2, 892, 34, '#ffd1dc');
        for (let i = 0; i < 10; i++) this.drawHeart(ctx, 308 + i * 46, 944, 17, (i + 1) / 10 <= heart + 1e-6);
        this.text(ctx, `×${(1 + heart * (this.maxBoost - 1)).toFixed(1)}`, 830, 944, 34, '#ffd1dc');
        this.drawProgress(ctx, view.progress);
        break;
      }
      case 'PRESENTING':
      case 'REWARDING':
        this.text(ctx, clip(`เสร็จแล้ว! ${name}`.trim(), 26), CAFE_W / 2, 790, 48);
        if (view.toast) this.text(ctx, clip(view.toast, 40), CAFE_W / 2, 850, 42, '#ffd966');
        break;
      default:
        break;
    }
  }

  private drawProgress(ctx: CanvasRenderingContext2D, progress: number): void {
    const p = Number.isFinite(progress) ? Math.min(100, Math.max(0, progress)) : 0;
    ctx.fillStyle = 'rgba(59,42,26,0.6)';
    ctx.beginPath();
    ctx.roundRect(140, 1522, 800, 30, 15);
    ctx.fill();
    if (p > 0) {
      const g = ctx.createLinearGradient(140, 0, 940, 0);
      g.addColorStop(0, '#f6b26b');
      g.addColorStop(1, '#e06666');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.roundRect(140, 1522, Math.max(30, 800 * (p / 100)), 30, 15);
      ctx.fill();
    }
    this.text(ctx, `${Math.round(p)}%`, CAFE_W / 2, 1537, 24);
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

  /** Customers on screen, walking in from the street and walking out again after they are served (or give up). */
  private readonly actors = new Map<number, Actor>();
  private seenFirstFrame = false;
  private holdLeaving = false;

  /** How many customers are currently drawn (walking in, standing, or walking out). For tests. */
  get actorCount(): number {
    return this.actors.size;
  }

  private stepActors(cafe: CafeView | undefined, dt: number): void {
    const slots: [number, number][] = [[170, 548], [360, 548], [720, 548], [910, 548]];
    const want = new Map<number, { c: CustomerView; x: number; y: number; r: number }>();
    if (cafe) {
      cafe.waiting.slice(0, slots.length).forEach((c, i) => {
        const [x, y] = slots[i] as [number, number];
        want.set(c.id, { c, x, y, r: 54 });
      });
      if (cafe.serving) want.set(cafe.serving.id, { c: cafe.serving, x: CAFE_W / 2, y: 446, r: 92 });
    }
    const k = 1 - Math.exp(-Math.min(100, Math.max(0, dt)) / 260); // smooth approach
    for (const [id, w] of want) {
      let a = this.actors.get(id);
      if (!a) {
        const fromLeft = Math.abs(Math.floor(Number.isFinite(w.c.seed) ? w.c.seed : id)) % 2 === 0;
        const inPlace = !this.seenFirstFrame; // the very first picture shows everyone standing; later arrivals walk in
        a = { c: w.c, x: inPlace ? w.x : fromLeft ? -140 : CAFE_W + 140, y: w.y, r: w.r, leaving: false, speed: 0 };
        this.actors.set(id, a);
      }
      a.c = w.c;
      a.leaving = false;
      // walk at a steady pace (like feet on the floor), easing only at the very end; never a floaty slow glide
      const dx = w.x - a.x;
      const dist = Math.abs(dx);
      const stepX = dist <= 1 ? dist : Math.min(dist, Math.max(dist * k, 0.16 * dt), 0.5 * dt);
      const nx = a.x + Math.sign(dx) * stepX;
      const ny = a.y + (w.y - a.y) * k;
      const nr = a.r + (w.r - a.r) * k;
      a.speed = stepX / Math.max(1, dt);
      a.x = nx;
      a.y = ny;
      a.r = nr;
    }
    for (const [id, a] of this.actors) {
      if (want.has(id)) continue;
      if (!a.leaving) {
        a.leaving = true;
        a.c = { ...a.c, serving: true }; // no patience bar or order label while walking away
      }
      // the paid customer waits at the counter until the dessert has reached them, then walks away
      if (this.holdLeaving) {
        a.speed = 0;
        continue;
      }
      const dir = a.x < CAFE_W / 2 ? -1 : 1;
      const step = 0.34 * Math.max(0, dt);
      a.x += dir * step;
      a.speed = 0.42;
      a.r += (54 - a.r) * k;
      if (a.x < -170 || a.x > CAFE_W + 170) this.actors.delete(id);
    }
    this.seenFirstFrame = true;
    // never let stray customers pile up
    while (this.actors.size > 24) {
      const first = this.actors.keys().next().value as number;
      this.actors.delete(first);
    }
  }

  /** The finished dessert slides up to the customer who ordered it, shrinking and fading as it arrives. */
  private drawServeOut(ctx: CanvasRenderingContext2D, view: RenderView): void {
    const raw = view.serveOutT;
    if (!view.art || raw === undefined || !Number.isFinite(raw) || raw <= 0) return;
    const t = Math.min(1, raw);
    const e = t * t * (3 - 2 * t);
    const fromX = STATION_X + 500;
    const fromY = STATION_Y + 380;
    const toX = CAFE_W / 2;
    const toY = 570;
    const x = fromX + (toX - fromX) * e;
    const y = fromY + (toY - fromY) * e - Math.sin(Math.PI * e) * 60; // a little arc, like being carried
    const s = 1 - 0.82 * e;
    ctx.save();
    try {
      ctx.globalAlpha = t < 0.75 ? 1 : Math.max(0, 1 - (t - 0.75) / 0.25);
      ctx.translate(x, y);
      ctx.scale(s, s);
      drawArtServed(ctx, view.art, { t: 1, n: 1, cx: 0, cy: 30 });
    } finally {
      ctx.restore();
    }
  }

  private drawQueue(ctx: CanvasRenderingContext2D, cafe: CafeView | undefined, dt = 16): void {
    this.stepActors(cafe, dt);
    const list = [...this.actors.values()].sort((p, q) => p.r - q.r);
    for (const a of list) {
      // a banished ghost fades up and away, then is not drawn at all
      let fade = 1;
      if (a.c.banished) {
        a.fadeMs = (a.fadeMs ?? 0) + dt;
        fade = 1 - Math.min(1, a.fadeMs / 600);
        if (fade <= 0) continue;
      }
      ctx.save();
      ctx.globalAlpha = fade;
      const walking = a.speed > 0.03;
      const feetY = a.y + a.r * 2.8; // the floor line under this customer
      // a soft shadow keeps the feet on the floor
      ctx.fillStyle = 'rgba(40,22,10,0.28)';
      ctx.beginPath();
      ctx.ellipse(a.x, feetY, a.r * 1.0, a.r * 0.2, 0, 0, Math.PI * 2);
      ctx.fill();
      try {
        if (walking) {
          // waddle: sway side to side and squash with each step, pivoting at the feet (no lifting off the floor)
          const ph = this.timeMs / 130 + a.c.id;
          ctx.translate(a.x, feetY);
          ctx.rotate(Math.sin(ph) * 0.07);
          ctx.scale(1 + Math.abs(Math.sin(ph)) * 0.025, 1 - Math.abs(Math.sin(ph)) * 0.035);
          ctx.translate(-a.x, -feetY);
        }
        this.drawCustomer(ctx, a.c, a.x, a.y, a.r);
      } finally {
        ctx.restore();
      }
    }
    if (cafe?.serving && !cafe.serving.banished) {
      this.drawOrderBubbleIfThere(ctx, cafe.serving);
    } else {
      this.text(ctx, 'รอลูกค้า…', CAFE_W / 2, 318, 48, '#fff3dc');
    }
  }

  /** The order bubble appears only after the customer has reached the counter. */
  private drawOrderBubbleIfThere(ctx: CanvasRenderingContext2D, c: CustomerView): void {
    const a = this.actors.get(c.id);
    if (a && Math.abs(a.x - CAFE_W / 2) < 60 && !a.leaving) this.drawOrderBubble(ctx, c);
  }

  private drawOrderBubble(ctx: CanvasRenderingContext2D, c: CustomerView): void {
    const label = clip(c.dessertNameTh, 12);
    ctx.font = `700 40px ${FONT}`;
    const tw = Number.isFinite(ctx.measureText(label).width) ? ctx.measureText(label).width : 200;
    const group = 84 + 16 + tw; // picture + gap + text, centred as one block in the bubble
    const w = Math.max(320, Math.min(760, group + 90));
    const x = CAFE_W / 2 - w / 2;
    const gx = CAFE_W / 2 - group / 2;
    const y = 196;
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
    const icon = ICON_PICS[c.dessertId];
    if (!(icon && drawArt(ctx, icon, gx + 42, y + 46, 84, 84, 0, 1, 1, 2.2))) {
      ctx.fillStyle = isColor(c.color) ? c.color : '#f5f0e1';
      ctx.beginPath();
      ctx.arc(gx + 42, y + 48, 26, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    ctx.textAlign = 'left';
    this.text(ctx, label, gx + 100, y + 52, 40, INK, '#fffaf0');
    ctx.textAlign = 'center';
  }

  /** A Thai ghost (the phone caller): กระสือ (a cold glowing floating head with a long wisp tail) or แม่นาค (tattered white sheet, long black hair over a pale face). Eerie but not gory. */
  private drawGhost(ctx: CanvasRenderingContext2D, c: CustomerView, x: number, baseY: number, r: number): void {
    const t = this.timeMs / 700;
    const float = Math.sin(t + c.id) * 10;
    const y = baseY - 14 + float;
    const krasue = outfitIndex(c.seed) % 2 === 0;
    // painted ghost when the pictures are loaded (นางรำ, ผีพราย, กระสือ, แม่นาค, ผีหิว), otherwise the drawn one below
    const pic = CAFE_PICS.ghosts[Math.abs(Math.floor(Number.isFinite(c.seed) ? c.seed : 0)) % CAFE_PICS.ghosts.length] as string;
    if (artImage(pic)) {
      const fl = 0.8 + 0.2 * Math.sin(this.timeMs / 130 + c.id) * Math.sin(this.timeMs / 530);
      ctx.save();
      try {
        drawArt(ctx, CAFE_PICS.mist, x, baseY + r * 2.6, r * 3.4, r * 0.9);
        ctx.globalAlpha = Math.max(0.45, fl);
        drawArt(ctx, pic, x + Math.sin(this.timeMs / 900 + c.id) * 4, y + r * 1.15, r * 3.7, r * 5.0, Math.sin(this.timeMs / 1100 + c.id) * 0.03);
      } finally {
        ctx.restore();
      }
      this.text(ctx, 'ผี', x, y + r * 3.6, Math.round(r * 0.5), '#d6e4ff', INK);
      if (!c.serving) {
        this.drawPatience(ctx, x, y + r * 4.05, r * 2, c.patience);
        this.text(ctx, clip(c.dessertNameTh, 11), x, y - r - 22, Math.round(r * 0.36), '#fff3dc', INK);
      }
      return;
    }
    // an uneasy flicker: now and then the ghost fades for a blink
    const flick = 0.78 + 0.22 * Math.sin(this.timeMs / 130 + c.id) * Math.sin(this.timeMs / 530);
    const sway = Math.sin(t * 0.8 + c.id) * 0.05;
    ctx.save();
    try {
      // cold glow
      const g = ctx.createRadialGradient(x, y, r * 0.3, x, y, r * 2.6);
      g.addColorStop(0, krasue ? 'rgba(150,255,170,0.55)' : 'rgba(150,190,255,0.45)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r * 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.translate(x, y);
      ctx.rotate(sway);
      ctx.translate(-x, -y);
      ctx.globalAlpha = Math.max(0.3, flick) * 0.92;
      if (krasue) {
        // long trailing wisps
        for (let i = 0; i < 5; i++) {
          ctx.strokeStyle = `rgba(170,255,190,${0.6 - i * 0.1})`;
          ctx.lineWidth = r * (0.42 - i * 0.07);
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(x + (i - 2) * r * 0.2, y + r * 0.7);
          ctx.bezierCurveTo(x + Math.sin(t * 1.3 + i) * r * 1.1, y + r * (1.7 + i * 0.2), x - Math.sin(t + i * 1.7) * r * 1.0, y + r * (2.6 + i * 0.25), x + Math.sin(t * 0.9 + i * 2.3) * r * 0.7, y + r * (3.5 + i * 0.3));
          ctx.stroke();
        }
      } else {
        // tattered white sheet with a ragged hem, and long black hair behind and over the face
        ctx.fillStyle = '#e9eef6';
        ctx.beginPath();
        ctx.moveTo(x - r * 1.0, y + r * 0.6);
        ctx.quadraticCurveTo(x - r * 1.3, y + r * 2.4, x - r * 1.0, y + r * 3.0);
        for (let i = 0; i < 7; i++) {
          const px = x - r * 1.0 + (i + 0.5) * (r * 2.0 / 7);
          const d = (i % 3) * 0.28 + Math.sin(t * 2 + i) * 0.1;
          ctx.lineTo(px, y + r * (3.0 + d));
          ctx.lineTo(px + r * 0.14, y + r * (2.6 + d * 0.5));
        }
        ctx.quadraticCurveTo(x + r * 1.3, y + r * 2.4, x + r * 1.0, y + r * 0.6);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#6a7794';
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.fillStyle = '#15111c';
        ctx.beginPath();
        ctx.ellipse(x, y + r * 0.7, r * 1.15, r * 1.9, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = Math.max(0.35, flick);
      // pale, cold face
      ctx.fillStyle = krasue ? '#d9f2dc' : '#e4e8ee';
      ctx.beginPath();
      ctx.arc(x, y, r * 0.95, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = krasue ? '#5f9a6a' : '#55607c';
      ctx.stroke();
      if (!krasue) {
        // hair falling over both sides of the face and a few strands across it
        ctx.fillStyle = '#15111c';
        for (const sx of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(x + sx * r * 0.2, y - r * 0.98);
          ctx.quadraticCurveTo(x + sx * r * 1.1, y - r * 0.4, x + sx * r * 0.85, y + r * 0.7);
          ctx.quadraticCurveTo(x + sx * r * 0.55, y - r * 0.1, x + sx * r * 0.2, y - r * 0.98);
          ctx.fill();
        }
        ctx.strokeStyle = 'rgba(21,17,28,0.8)';
        ctx.lineWidth = 2.5;
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.moveTo(x - r * 0.3 + i * r * 0.3, y - r * 0.95);
          ctx.quadraticCurveTo(x - r * 0.1 + i * r * 0.25, y - r * 0.2, x - r * 0.2 + i * r * 0.35, y + r * 0.1);
          ctx.stroke();
        }
      }
      // hollow eyes with a dim red glint, a long dark mouth
      ctx.fillStyle = '#0d0912';
      for (const sx of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(x + sx * r * 0.34, y - r * 0.08, r * 0.15, r * 0.26, sx * 0.12, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(255,70,70,0.85)';
      for (const sx of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(x + sx * r * 0.34, y - r * 0.02, r * 0.045, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#0d0912';
      ctx.beginPath();
      ctx.ellipse(x, y + r * 0.5, r * 0.17, r * 0.3 + Math.abs(Math.sin(t * 1.5)) * r * 0.08, 0, 0, Math.PI * 2);
      ctx.fill();
    } finally {
      ctx.restore();
    }
    this.text(ctx, 'ผี', x, y + r * (krasue ? 3.2 : 3.4), Math.round(r * 0.5), '#d6e4ff', INK);
    if (!c.serving) {
      this.drawPatience(ctx, x, y + r * 3.8, r * 2, c.patience);
      this.text(ctx, clip(c.dessertNameTh, 11), x, y - r - 22, Math.round(r * 0.36), '#fff3dc', INK);
    }
  }

  private drawCustomer(ctx: CanvasRenderingContext2D, c: CustomerView, x: number, baseY: number, r: number): void {
    if (c.kind === 'phone') {
      this.drawGhost(ctx, c, x, baseY, r);
      return;
    }
    const spec = avatarSpec(c.seed, c.name);
    const bob = Math.sin(this.timeMs / 420 + (Number.isFinite(c.seed) ? c.seed : 0)) * 4;
    const y = baseY + bob;
    // body: a painted outfit when loaded (picked by seed), otherwise a rounded rectangle
    const bodyPic = CAFE_PICS.bodies[outfitIndex(c.seed) % CAFE_PICS.bodies.length] as string;
    const hasBody = drawArt(ctx, bodyPic, x, y + r * 1.75, r * 2.3, r * 2.1, 0, 1, 1, Math.max(2.5, r * 0.05));
    if (!hasBody) {
      ctx.fillStyle = isColor(spec.bg) ? spec.bg : '#e06666';
      ctx.beginPath();
      ctx.roundRect(x - r * 1.15, y + r * 0.7, r * 2.3, r * 1.5, r * 0.5);
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 4;
      ctx.stroke();
    }
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
    ctx.lineWidth = 12;
    ctx.strokeStyle = INK;
    ctx.beginPath();
    ctx.arc(x, y, r + 2, 0, Math.PI * 2);
    ctx.stroke();
    const special = c.viewer || c.kind === 'vip';
    ctx.lineWidth = c.kind === 'vip' ? 10 : c.viewer ? 8 : 5;
    ctx.strokeStyle = special ? '#e8b64c' : '#fff3dc';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    if (c.kind === 'vip') this.drawCrown(ctx, x, y - r * 0.9, r);
    // name (viewers), VIP label, and patience
    if (c.kind === 'vip') this.text(ctx, 'VIP', x, y + r * 2.45, Math.round(r * 0.6), '#ffe08a', INK);
    else if (c.viewer && c.name) this.text(ctx, clip(c.name, 12), x, y + r * 2.45, Math.round(r * 0.5), '#fff', INK);
    if (!c.serving) this.drawPatience(ctx, x, y + r * 2.1 + (c.kind === 'vip' || (c.viewer && c.name) ? Math.round(r * 0.5) : 0) + 14, r * 2, c.patience);
    if (!c.serving) {
      ctx.textAlign = 'center';
      this.text(ctx, clip(c.dessertNameTh, 11), x, y - r - 22 - (c.kind === 'vip' ? r * 0.6 : 0), Math.round(r * 0.36), '#fff3dc', INK);
    }
  }

  private drawCrown(ctx: CanvasRenderingContext2D, x: number, baseY: number, r: number): void {
    if (drawArt(ctx, CAFE_PICS.crown, x, baseY - r * 0.1, r * 1.5, r * 1.1, 0, 1, 1, 2.5)) return;
    const w = r * 1.2;
    ctx.beginPath();
    ctx.moveTo(x - w / 2, baseY);
    ctx.lineTo(x - w / 2, baseY - r * 0.45);
    ctx.lineTo(x - w / 4, baseY - r * 0.2);
    ctx.lineTo(x, baseY - r * 0.6);
    ctx.lineTo(x + w / 4, baseY - r * 0.2);
    ctx.lineTo(x + w / 2, baseY - r * 0.45);
    ctx.lineTo(x + w / 2, baseY);
    ctx.closePath();
    ctx.fillStyle = '#f6c244';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = INK;
    ctx.stroke();
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
    if (!drawArt(ctx, CAFE_PICS.coin, 1030, 50, 54, 54, 0, 1, 1, 2)) {
      ctx.fillStyle = '#e8b64c';
      ctx.beginPath();
      ctx.arc(1030, 50, 26, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#a9761f';
      ctx.lineWidth = 4;
      ctx.stroke();
    }
    ctx.textAlign = 'right';
    this.text(ctx, coins >= 1e6 ? `${Math.floor(coins / 1e6)}M` : String(coins), 990, 52, 38, '#fff', '#7a4f12');
    ctx.textAlign = 'center';
    const total = Number.isFinite(cafe.waitingTotal) ? Math.max(0, Math.min(999, Math.floor(cafe.waitingTotal))) : 0;
    ctx.textAlign = 'left';
    this.text(ctx, `คิว ${total}`, 40, 52, 38, '#fff', INK);
    ctx.textAlign = 'center';
  }
}
