import type { ParticleSystem } from '../anim/ParticleSystem';
import type { ArtId } from '../dessert/types';
import { drawArtCooking, drawArtServed } from './dessertArt';
import { WORLD_H, WORLD_W, type RenderView } from '../Game';

const spring = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : 1 - Math.exp(-5 * t) * Math.cos(12 * t));

function lerpColor(a: string, b: string, t: number): string {
  const pa = parse(a);
  const pb = parse(b);
  const m = (i: number): number => Math.round(pa[i]! + (pb[i]! - pa[i]!) * t);
  return `rgb(${m(0)},${m(1)},${m(2)})`;
}
function parse(hex: string): [number, number, number] {
  const h = /^#([0-9a-f]{6})$/i.exec(hex)?.[1] ?? 'f5f0e1';
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Draws the cooking scene in a fixed 1000x600 world, scaled to the canvas. Pure drawing, no game state changes. */
export class Renderer {
  private timeMs = 0;

  draw(ctx: CanvasRenderingContext2D, width: number, height: number, view: RenderView, particles: ParticleSystem, dtMs: number): void {
    this.timeMs += Number.isFinite(dtMs) ? dtMs : 0;
    const scale = Math.min(width / WORLD_W, height / WORLD_H);
    ctx.save();
    try {
      ctx.clearRect(0, 0, width, height);
      const bg = ctx.createLinearGradient(0, 0, 0, height);
      bg.addColorStop(0, '#fff4e0');
      bg.addColorStop(1, '#f7d9b5');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);
      ctx.translate((width - WORLD_W * scale) / 2, (height - WORLD_H * scale) / 2);
      ctx.scale(scale, scale);

      this.drawScene(ctx, view, particles);
    } finally {
      ctx.restore();
    }
  }

  /**
   * The cooking station (table, bowl or tray, step effects, particles) in the 1000x600 world. The caller sets the
   * transform, so other layouts (portrait café) can place it anywhere. Draws no background.
   */
  drawScene(ctx: CanvasRenderingContext2D, view: RenderView, particles: ParticleSystem): void {
    // table
    ctx.fillStyle = '#c98f5a';
    ctx.fillRect(0, 470, WORLD_W, 130);

    const presenting = view.presentT !== null;
    if (presenting) this.drawTray(ctx, view);
    else if (view.art && view.state === 'COOKING') this.drawCookingArt(ctx, view);
    else this.drawBowl(ctx, view);

    particles.forEach((p) => {
      const alpha = Math.max(0, 1 - p.ageMs / p.lifeMs);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  /** Advances the animation clock used by the step effects (call once per frame). */
  tick(dtMs: number): void {
    this.timeMs += Number.isFinite(dtMs) ? dtMs : 0;
  }

  private drawCookingArt(ctx: CanvasRenderingContext2D, view: RenderView): void {
    // station back plate so every scene sits on the same table
    drawArtCooking(ctx, view.art as ArtId, { stage: view.stepIndex ?? 0, stages: view.stepCount ?? 1, t: view.stepT, p: view.progress / 100, time: this.timeMs });
  }

  private batterColor(view: RenderView): string {
    const pal = view.palette;
    if (pal.length < 2) return pal[0] ?? '#f5f0e1';
    const pos = Math.min(pal.length - 1, (view.progress / 100) * (pal.length - 1));
    const i = Math.floor(pos);
    return lerpColor(pal[i]!, pal[Math.min(pal.length - 1, i + 1)]!, pos - i);
  }

  private drawBowl(ctx: CanvasRenderingContext2D, view: RenderView): void {
    const cx = WORLD_W / 2;
    const cy = 400;
    const wob = view.wobble * Math.sin(this.timeMs / 45) * 0.08;
    const kneading = view.stepKind === 'knead' || view.stepKind === 'shape';
    const squash = 1 + wob + (kneading ? Math.sin(this.timeMs / 140) * 0.06 : 0);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(squash, 2 - squash);

    // bowl body
    ctx.fillStyle = '#e8e2d6';
    ctx.beginPath();
    ctx.ellipse(0, 0, 190, 90, 0, 0, Math.PI);
    ctx.lineTo(-190, 0);
    ctx.fill();
    ctx.fillStyle = '#fbf8f1';
    ctx.beginPath();
    ctx.ellipse(0, 0, 190, 50, 0, 0, Math.PI * 2);
    ctx.fill();

    // batter surface rises with progress
    const level = 8 + (view.progress / 100) * 34;
    ctx.fillStyle = this.batterColor(view);
    ctx.beginPath();
    ctx.ellipse(0, 40 - level, 165, 38, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    this.drawStepEffect(ctx, view, cx, cy);
  }

  private drawStepEffect(ctx: CanvasRenderingContext2D, view: RenderView, cx: number, cy: number): void {
    const t = this.timeMs / 1000;
    const kind = view.stepKind;
    if (!kind) return;
    ctx.save();
    ctx.lineCap = 'round';
    if (kind === 'pour' || kind === 'drizzle' || kind === 'spread') {
      ctx.strokeStyle = this.batterColor(view);
      ctx.lineWidth = kind === 'drizzle' ? 4 : 12;
      ctx.beginPath();
      ctx.moveTo(cx + Math.sin(t * 3) * 8, 90);
      ctx.bezierCurveTo(cx + 12, 200, cx - 12, 280, cx + Math.sin(t * 5) * 6, cy - 10);
      ctx.stroke();
      ctx.fillStyle = '#b5b5b5';
      ctx.fillRect(cx - 38, 60, 76, 34); // pitcher lip
    } else if (kind === 'stir') {
      const a = t * 5;
      const sx = cx + Math.cos(a) * 70;
      const sy = cy - 6 + Math.sin(a) * 18;
      ctx.strokeStyle = '#8a5a2b';
      ctx.lineWidth = 12;
      ctx.beginPath();
      ctx.moveTo(sx + 40, sy - 150);
      ctx.lineTo(sx, sy);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.lineWidth = 3;
      for (let k = 0; k < 3; k++) {
        ctx.beginPath();
        ctx.ellipse(cx, cy - 4, 40 + k * 38, 12 + k * 7, 0, a + k, a + k + 2.2);
        ctx.stroke();
      }
    } else if (kind === 'cut') {
      const x = cx - 150 + view.stepT * 300;
      ctx.strokeStyle = '#d9d9d9';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(x, cy - 90);
      ctx.lineTo(x + 12, cy + 30);
      ctx.stroke();
    } else if (kind === 'boil') {
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      for (let k = 0; k < 7; k++) {
        const ph = (t * 0.9 + k * 0.37) % 1;
        ctx.beginPath();
        ctx.arc(cx - 120 + k * 40, cy - 6 - ph * 40, 4 + ph * 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  private drawTray(ctx: CanvasRenderingContext2D, view: RenderView): void {
    const cx = WORLD_W / 2;
    const cy = 410;
    ctx.fillStyle = '#b07a45';
    ctx.beginPath();
    ctx.roundRect(cx - 260, cy - 70, 520, 140, 24);
    ctx.fill();
    ctx.fillStyle = '#e9c9a0';
    ctx.beginPath();
    ctx.roundRect(cx - 245, cy - 56, 490, 112, 18);
    ctx.fill();

    if (view.art) drawArtServed(ctx, view.art, { t: view.presentT ?? 0, n: view.piecesCount, cx, cy });
  }
}
