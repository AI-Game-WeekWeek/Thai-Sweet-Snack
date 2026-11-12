import type { ParticleSystem } from '../anim/ParticleSystem';
import { avatarSpec } from '../cafe/avatars';
import type { CafeView, CustomerView, RenderView } from '../Game';
import type { AvatarCache } from './AvatarCache';
import { Renderer } from './Renderer';

/** Portrait world (9:16). The cooking station from the landscape scene is placed inside it as a 1000x600 window. */
export const CAFE_W = 1080;
export const CAFE_H = 1920;
const STATION_X = 40;
const STATION_Y = 910;

const FONT = '"Noto Sans Thai", system-ui, sans-serif';
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
      this.safely('phone', () => this.drawPhone(ctx, view.cafe));
      this.safely('cat', () => this.drawCat(ctx, 950, 1342, view.cafe?.luckyCatSec ?? 0));
      this.safely('lucky', () => this.drawLuckyPill(ctx, view.cafe));
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
    // awning with scalloped edge
    for (let i = 0; i < 12; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#d94f4f' : '#fff3dc';
      ctx.fillRect(i * 90, 0, 90, 112);
      ctx.beginPath();
      ctx.arc(i * 90 + 45, 112, 45, 0, Math.PI);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(0, 0, CAFE_W, 14);
    // hanging lanterns
    const sway = Math.sin(this.timeMs / 900);
    [[60, 20], [250, 46], [830, 46], [1020, 20]].forEach(([x, len], i) => {
      const sx = (x as number) + sway * 6 * (i % 2 ? 1 : -1);
      const ly = 164 + (len as number);
      ctx.strokeStyle = '#6b3a1c';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(x as number, 112);
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
    ctx.roundRect(330, 22, 420, 84, 18);
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#e8b64c';
    ctx.stroke();
    this.text(ctx, 'ร้านขนมไทย', CAFE_W / 2, 66, 52, '#ffe9a8');
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
      ctx.fillStyle = '#e8b64c';
      ctx.beginPath();
      ctx.arc(x + 30, y + 22, 25, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#a9761f';
      ctx.lineWidth = 4;
      ctx.stroke();
      this.text(ctx, String(t.coins), x + 30, y + 24, t.coins >= 100 ? 21 : 26, '#fff', '#7a4f12');
      ctx.fillStyle = isColor(t.color) ? t.color : '#f5f0e1';
      ctx.beginPath();
      ctx.arc(x + 86, y + 22, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.textAlign = 'left';
      this.text(ctx, clip(t.nameTh, 11), x + 106, y + 24, 32, '#fff', '#1c2e24');
      ctx.textAlign = 'center';
    });
  }

  private drawLuckyPill(ctx: CanvasRenderingContext2D, cafe: CafeView | undefined): void {
    const sec = cafe?.luckyCatSec;
    if (sec === undefined || !Number.isFinite(sec) || sec <= 0) return;
    ctx.fillStyle = 'rgba(60,35,18,0.88)';
    ctx.beginPath();
    ctx.roundRect(730, 1196, 300, 54, 27);
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#e8b64c';
    ctx.stroke();
    const pct = Number.isFinite(cafe?.luckyCatBonusPct) ? Math.round(cafe?.luckyCatBonusPct as number) : 0;
    this.text(ctx, `แมวกวัก +${pct}% · ${Math.ceil(Math.min(999, sec))} วิ`, 880, 1224, 28, '#ffe08a');
  }

  /** The phone on the counter: decoration normally, shaking with ring arcs and a warning when a call comes in. */
  private drawPhone(ctx: CanvasRenderingContext2D, cafe: CafeView | undefined): void {
    const ringing = cafe?.phoneRinging === true;
    const x = 110;
    const y = 1452;
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
    if (ringing) this.text(ctx, 'โทรศัพท์ดัง!', x + 40, y - 96, 36, '#fff', '#b3261e');
  }

  private drawCat(ctx: CanvasRenderingContext2D, x: number, y: number, luckySec = 0): void {
    const lucky = Number.isFinite(luckySec) && luckySec > 0;
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
        this.text(ctx, 'กดหัวใจรัว ๆ ให้สุกเร็ว!', CAFE_W / 2, 892, 34, '#ffd1dc');
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

  private drawQueue(ctx: CanvasRenderingContext2D, cafe: CafeView | undefined): void {
    if (!cafe) return;
    // Waiting customers stand in a line behind the counter; the one being served is large in the middle.
    const slots: [number, number][] = [[170, 548], [360, 548], [720, 548], [910, 548]];
    cafe.waiting.slice(0, slots.length).forEach((c, i) => {
      const [x, y] = slots[i] as [number, number];
      this.drawCustomer(ctx, c, x, y, 54);
    });
    if (cafe.serving) {
      this.drawCustomer(ctx, cafe.serving, CAFE_W / 2, 446, 92);
      this.drawOrderBubble(ctx, cafe.serving);
    } else {
      this.text(ctx, 'รอลูกค้า…', CAFE_W / 2, 440, 40, '#fff3dc');
    }
  }

  private drawOrderBubble(ctx: CanvasRenderingContext2D, c: CustomerView): void {
    const w = 460;
    const x = CAFE_W / 2 - w / 2;
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
    const special = c.viewer || c.kind === 'vip';
    ctx.lineWidth = c.kind === 'vip' ? 10 : c.viewer ? 8 : 5;
    ctx.strokeStyle = special ? '#e8b64c' : '#fff3dc';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    if (c.kind === 'vip') this.drawCrown(ctx, x, y - r * 0.9, r);
    if (c.kind === 'phone') {
      ctx.fillStyle = '#d94f4f';
      ctx.beginPath();
      ctx.arc(x + r * 0.9, y - r * 0.78, r * 0.34, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
      this.text(ctx, 'โทร', x + r * 0.9, y - r * 0.76, Math.round(r * 0.3), '#fff', '#8b1e1e');
    }
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
