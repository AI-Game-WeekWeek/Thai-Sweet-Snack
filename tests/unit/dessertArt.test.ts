import { describe, expect, it } from 'vitest';
import { ART_IDS, type ArtId } from '../../src/dessert/types';
import { drawArtCooking, drawArtServed } from '../../src/render/dessertArt';
import { clearArt, registerArt } from '../../src/render/artImages';
import { ALL_PIC_NAMES } from '../../src/render/artManifest';

/** A canvas context that accepts every call; records a signature of what was drawn and keeps save/restore balanced. */
function fakeCtx() {
  const sig: string[] = [];
  let depth = 0;
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === 'save') return () => { depth++; };
      if (prop === 'restore') return () => { depth--; };
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => ({ addColorStop() {} });
      if (prop === 'measureText') return () => ({ width: 10 });
      return (...args: unknown[]) => { sig.push(`${String(prop)}(${args.map((a) => (typeof a === 'number' ? Math.round(a) : '')).join(',')})`); return proxy; };
    },
    set(_t, prop, value) { sig.push(`${String(prop)}=${String(value)}`); return true; },
  };
  const proxy: object = new Proxy({}, handler);
  return { ctx: proxy as unknown as CanvasRenderingContext2D, signature: () => sig.join(';'), depth: () => depth };
}
const cooking = (art: ArtId, stage: number, t = 0.5, p = 0.5) => {
  const f = fakeCtx();
  drawArtCooking(f.ctx, art, { stage, stages: 6, t, p, time: 1234 });
  return f;
};

describe('dessert art', () => {
  it('every art draws every stage and served look without errors, with a balanced canvas state, for hostile values too', () => {
    const odd = [0, 0.5, 1, NaN, -1, 2, Infinity];
    for (const art of ART_IDS) {
      for (let stage = -1; stage <= 8; stage++) {
        for (const t of odd) for (const p of [0, 0.5, 1, NaN]) {
          const f = fakeCtx();
          expect(() => drawArtCooking(f.ctx, art, { stage, stages: 6, t, p, time: 1234 }), `${art} s${stage} t${t}`).not.toThrow();
          expect(f.depth()).toBe(0);
        }
      }
      for (const n of [0, 1, 3, 5, 8, 50, NaN, -2]) for (const t of odd) {
        const f = fakeCtx();
        expect(() => drawArtServed(f.ctx, art, { t, n, cx: 500, cy: 410 }), `${art} served n${n} t${t}`).not.toThrow();
        expect(f.depth()).toBe(0);
      }
    }
    const bad = fakeCtx();
    expect(() => drawArtCooking(bad.ctx, 'nope' as ArtId, { stage: 0, stages: 6, t: 0, p: 0, time: 0 })).not.toThrow();
  });

  it('within one dessert the stages look different from each other (the process visibly changes)', () => {
    for (const art of ART_IDS) {
      const sigs = new Set([0, 1, 2, 3, 4, 5].map((s) => cooking(art, s).signature()));
      expect(sigs.size, art).toBeGreaterThanOrEqual(4);
    }
  });

  it('progress inside a stage changes the picture (things grow, fill, fold)', () => {
    for (const art of ART_IDS) {
      let changed = 0;
      for (const stage of [1, 2, 3]) {
        if (cooking(art, stage, 0.1).signature() !== cooking(art, stage, 0.9).signature()) changed++;
      }
      expect(changed, art).toBeGreaterThanOrEqual(2);
    }
  });

  it('different desserts look different at the same stage: no shared base', () => {
    for (const stage of [0, 1, 2, 3]) {
      const sigs = new Set(ART_IDS.map((a) => cooking(a, stage).signature()));
      expect(sigs.size, `stage ${stage}`).toBe(ART_IDS.length);
    }
    const served = new Set(ART_IDS.map((a) => { const f = fakeCtx(); drawArtServed(f.ctx, a, { t: 1, n: 6, cx: 500, cy: 410 }); return f.signature(); }));
    expect(served.size).toBe(ART_IDS.length);
  });

  it('a served look draws nothing before it pops in, and the item count follows n (within its cap)', () => {
    for (const art of ART_IDS) {
      const none = fakeCtx(); drawArtServed(none.ctx, art, { t: 0, n: 5, cx: 500, cy: 410 });
      const some = fakeCtx(); drawArtServed(some.ctx, art, { t: 1, n: 5, cx: 500, cy: 410 });
      const zero = fakeCtx(); drawArtServed(zero.ctx, art, { t: 1, n: 0, cx: 500, cy: 410 });
      expect(some.signature().length, art).toBeGreaterThan(none.signature().length);
      expect(zero.signature().length, art).toBeLessThan(some.signature().length);
    }
  });

  it('uses painted pictures when loaded, falls back to shapes when not, and never throws on hostile values', () => {
    const calls: string[] = [];
    const rec = () => {
      const f = fakeCtx();
      const orig = f.ctx as unknown as Record<string, unknown>;
      return { f, orig };
    };
    void rec;
    clearArt();
    const none = fakeCtx();
    drawArtCooking(none.ctx, 'parcel', { stage: 0, stages: 6, t: 0.5, p: 0.5, time: 100 });
    expect(none.signature()).not.toContain('drawImage');
    for (const n of ALL_PIC_NAMES) registerArt(n, { width: 100, height: 80 } as unknown as CanvasImageSource & { width: number; height: number });
    try {
      for (const art of ART_IDS) {
        const f = fakeCtx();
        drawArtCooking(f.ctx, art, { stage: 1, stages: 6, t: 0.5, p: 0.5, time: 100 });
        expect(f.signature(), `cook ${art}`).toContain('drawImage');
        expect(f.depth()).toBe(0);
        const g = fakeCtx();
        drawArtServed(g.ctx, art, { t: 1, n: 5, cx: 500, cy: 410 });
        expect(g.signature(), `served ${art}`).toContain('drawImage');
        expect(g.depth()).toBe(0);
        const z = fakeCtx();
        drawArtServed(z.ctx, art, { t: 0, n: 5, cx: 500, cy: 410 });
        expect(z.signature(), `served t=0 ${art}`).not.toContain('drawImage');
        for (const t of [NaN, -1, 5, Infinity]) {
          const h = fakeCtx();
          expect(() => drawArtCooking(h.ctx, art, { stage: NaN, stages: NaN, t, p: t, time: NaN })).not.toThrow();
          expect(() => drawArtServed(h.ctx, art, { t, n: NaN, cx: NaN, cy: Infinity })).not.toThrow();
          expect(h.depth()).toBe(0);
        }
      }
    } finally {
      clearArt();
    }
    void calls;
  });
});

describe('calm (waiting for a tap)', () => {
  it('calm pictures only rock a little and show no steam or bubbles; with no calm the full animation and effects are drawn', () => {
    clearArt();
    for (const n of ALL_PIC_NAMES) registerArt(n, { width: 100, height: 80 } as unknown as CanvasImageSource & { width: number; height: number });
    try {
      const draw = (calm: number, time: number) => { const f = fakeCtx(); drawArtCooking(f.ctx, 'thread', { stage: 2, stages: 6, t: 0.5, p: 0.5, time, calm }); return f; };
      const busy = draw(0, 1000);
      const calm = draw(1, 1000);
      expect(calm.signature().length).toBeLessThan(busy.signature().length); // fewer pictures/effects
      // calm: two moments a quarter second apart differ only by a slight sway; the full animation moves a lot more
      const move = (calmV: number) => { const a = draw(calmV, 1000).signature().match(/-?\d+/g)!.map(Number); const b = draw(calmV, 1250).signature().match(/-?\d+/g)!.map(Number); let d = 0; for (let i = 0; i < Math.min(a.length, b.length); i++) d += Math.abs(a[i]! - b[i]!); return d; };
      expect(move(1)).toBeLessThan(move(0));
      for (const c of [NaN, -1, 5, Infinity]) expect(() => draw(c, 1000)).not.toThrow();
    } finally { clearArt(); }
  });
});
