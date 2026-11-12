import type { ParticleSystem } from '../anim/ParticleSystem';
import { WORLD_H, WORLD_W, type RenderView } from '../Game';
import { Renderer } from './Renderer';

const FONT = '"Noto Sans Thai", system-ui, sans-serif';
/** Fixed, high-contrast colour per menu slot (dessert palettes are pastel and vanish on the cream board). */
const SLOT_COLORS = ['#e06666', '#4a90d9', '#58a55c'] as const;
const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
const clip = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/**
 * The whole game UI for menu-vote mode, drawn on the one canvas OBS captures. Few elements, big outlined text:
 * a viewer who scrolls past should understand "type 1 2 3" and "tap hearts" in three seconds.
 */
export class VoteRenderer {
  private readonly scene = new Renderer();

  constructor(private readonly maxBoost: number) {}

  draw(ctx: CanvasRenderingContext2D, width: number, height: number, view: RenderView, particles: ParticleSystem, dtMs: number): void {
    try {
      this.scene.draw(ctx, width, height, view, particles, dtMs);
    } catch (err) {
      console.error('[VoteRenderer] scene failed', err);
    }
    const scale = Math.min(width / WORLD_W, height / WORLD_H);
    ctx.save();
    try {
      ctx.translate((width - WORLD_W * scale) / 2, (height - WORLD_H * scale) / 2);
      ctx.scale(scale, scale);
      this.overlay(ctx, view);
    } catch (err) {
      console.error('[VoteRenderer] overlay failed', err);
    } finally {
      ctx.restore();
    }
  }

  private overlay(ctx: CanvasRenderingContext2D, view: RenderView): void {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    switch (view.state) {
      case 'PREPARING':
        this.drawVote(ctx, view);
        break;
      case 'COOKING':
        this.drawCooking(ctx, view);
        break;
      case 'PRESENTING':
      case 'REWARDING':
        this.drawServed(ctx, view);
        break;
      default:
        break;
    }
  }

  private text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, fill = '#fff', stroke = '#3b2a1a'): void {
    ctx.font = `800 ${size}px ${FONT}`;
    ctx.lineWidth = Math.max(4, size / 6);
    ctx.strokeStyle = stroke;
    ctx.strokeText(s, x, y);
    ctx.fillStyle = fill;
    ctx.fillText(s, x, y);
  }

  private drawVote(ctx: CanvasRenderingContext2D, view: RenderView): void {
    const vote = view.vote;
    this.text(ctx, 'พิมพ์ 1  2  3  เพื่อเลือกขนม!', 470, 42, 40);
    const n = vote?.candidates.length ?? 0;
    if (!vote || n === 0) return;

    const seconds = Number.isFinite(vote.remainingMs) ? Math.max(0, Math.ceil(vote.remainingMs / 1000)) : 0;
    ctx.fillStyle = '#e06666';
    ctx.beginPath();
    ctx.arc(935, 46, 36, 0, Math.PI * 2);
    ctx.fill();
    this.text(ctx, String(seconds), 935, 48, 40);

    const total = vote.tally.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
    const max = vote.tally.reduce((a, b) => Math.max(a, Number.isFinite(b) ? b : 0), 0);
    const cw = 290;
    const gap = 20;
    const x0 = (WORLD_W - (n * cw + (n - 1) * gap)) / 2;
    vote.candidates.slice(0, 3).forEach((c, i) => {
      const x = x0 + i * (cw + gap);
      const y = 90;
      const color = SLOT_COLORS[i % SLOT_COLORS.length] as string;
      const count = Number.isFinite(vote.tally[i]) ? (vote.tally[i] as number) : 0;
      const leading = max > 0 && count === max;
      ctx.fillStyle = '#fff7ea';
      ctx.beginPath();
      ctx.roundRect(x, y, cw, 175, 22);
      ctx.fill();
      ctx.lineWidth = leading ? 8 : 5;
      ctx.strokeStyle = leading ? '#f1c232' : color;
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x + 38, y + 38, 28, 0, Math.PI * 2);
      ctx.fill();
      this.text(ctx, String(i + 1), x + 38, y + 40, 38, '#fff', '#3b2a1a');
      this.text(ctx, clip(c.nameTh, 12), x + cw / 2 + 22, y + 62, 34, '#3b2a1a', '#fff7ea');
      ctx.fillStyle = '#ead9c2';
      ctx.beginPath();
      ctx.roundRect(x + 20, y + 118, cw - 40, 30, 15);
      ctx.fill();
      const frac = total > 0 ? count / total : 0;
      if (frac > 0) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.roundRect(x + 20, y + 118, Math.max(30, (cw - 40) * frac), 30, 15);
        ctx.fill();
      }
      this.text(ctx, String(count), x + cw / 2, y + 134, 26, '#fff', '#3b2a1a');
    });
  }

  private drawCooking(ctx: CanvasRenderingContext2D, view: RenderView): void {
    this.text(ctx, clip(`กำลังทำ ${view.dessertNameTh ?? ''}`.trim(), 24), WORLD_W / 2, 46, 42);
    if (view.stepNameTh) this.text(ctx, clip(view.stepNameTh, 30), WORLD_W / 2, 96, 30, '#ffe9a8');

    // Heart meter: "tap hearts" is the one thing viewers can do while it cooks.
    const heart = clamp01(view.heart);
    this.text(ctx, 'กดหัวใจรัว ๆ ให้สุกเร็ว!', WORLD_W / 2, 150, 32, '#ffd1dc');
    for (let i = 0; i < 10; i++) this.drawHeart(ctx, 290 + i * 44, 200, 17, (i + 1) / 10 <= heart + 1e-6);
    this.text(ctx, `×${(1 + heart * (this.maxBoost - 1)).toFixed(1)}`, 770, 200, 34, '#ffd1dc');

    this.drawProgress(ctx, view.progress);
  }

  private drawServed(ctx: CanvasRenderingContext2D, view: RenderView): void {
    this.text(ctx, clip(`เสร็จแล้ว! ${view.dessertNameTh ?? ''}`.trim(), 26), WORLD_W / 2, 52, 46);
    if (view.toast) this.text(ctx, clip(view.toast, 40), WORLD_W / 2, 150, 44, '#ffd966');
  }

  private drawProgress(ctx: CanvasRenderingContext2D, progress: number): void {
    const p = Number.isFinite(progress) ? Math.min(100, Math.max(0, progress)) : 0;
    ctx.fillStyle = 'rgba(59,42,26,0.55)';
    ctx.beginPath();
    ctx.roundRect(100, 548, 800, 30, 15);
    ctx.fill();
    if (p > 0) {
      const g = ctx.createLinearGradient(100, 0, 900, 0);
      g.addColorStop(0, '#f6b26b');
      g.addColorStop(1, '#e06666');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.roundRect(100, 548, Math.max(30, 800 * (p / 100)), 30, 15);
      ctx.fill();
    }
    this.text(ctx, `${Math.round(p)}%`, WORLD_W / 2, 563, 24);
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
}
