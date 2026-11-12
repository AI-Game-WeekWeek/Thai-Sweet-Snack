import { describe, expect, it } from 'vitest';
import { ParticleSystem } from '../../src/anim/ParticleSystem';
import type { RenderView } from '../../src/Game';
import { VoteRenderer } from '../../src/render/VoteRenderer';
import type { GameState } from '../../src/core/StateMachine';

/** A canvas context that records the text drawn and accepts every call. */
function fakeCtx() {
  const texts: string[] = [];
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === 'fillText' || prop === 'strokeText') return (t: string) => { texts.push(String(t)); };
      if (prop === 'measureText') return () => ({ width: 100 });
      if (prop === 'createLinearGradient') return () => ({ addColorStop() {} });
      return () => proxy;
    },
    set: () => true,
  };
  const proxy: object = new Proxy({}, handler);
  return { ctx: proxy as unknown as CanvasRenderingContext2D, texts };
}

const view = (over: Partial<RenderView> = {}): RenderView => ({
  state: 'PREPARING', progress: 0, palette: ['#f5f0e1'], stepKind: null, stepT: 0, presentT: null, wobble: 0, piecesCount: 8,
  heart: 0, dessertNameTh: null, stepNameTh: null, toast: null,
  vote: { open: true, candidates: [
    { id: 'a', nameTh: 'ข้าวต้มมัด', palette: ['#fdf5e6'] }, { id: 'b', nameTh: 'บัวลอย', palette: ['#b4a7d6'] }, { id: 'c', nameTh: 'ทองหยอด', palette: ['#f1c232'] },
  ], tally: [3, 10, 0], remainingMs: 7400, winner: null },
  ...over,
});
const draw = (v: RenderView) => {
  const { ctx, texts } = fakeCtx();
  new VoteRenderer(4).draw(ctx, 1000, 600, v, new ParticleSystem(10, 0), 16);
  return texts.join(' | ');
};

describe('VoteRenderer', () => {
  it('shows the instruction, all candidate names, vote counts and the countdown while voting', () => {
    const t = draw(view());
    for (const s of ['1', '2', '3', 'ข้าวต้มมัด', 'บัวลอย', 'ทองหยอด', '10', '8']) expect(t).toContain(s); // 7400 ms -> 8 s
    expect(t).toContain('พิมพ์');
  });

  it('shows the dessert, step, heart prompt and percent while cooking', () => {
    const t = draw(view({ state: 'COOKING', progress: 42, heart: 0.5, dessertNameTh: 'บัวลอย', stepNameTh: 'ต้มจนลอย', vote: undefined }));
    for (const s of ['บัวลอย', 'ต้มจนลอย', 'หัวใจ', '42%']) expect(t).toContain(s);
  });

  it('shows the sold message when serving', () => {
    const t = draw(view({ state: 'REWARDING', progress: 100, dessertNameTh: 'ข้าวต้มมัด', toast: '+120 คะแนน +14 เหรียญ', vote: undefined, presentT: 1 }));
    expect(t).toContain('+14 เหรียญ');
    expect(t).toContain('เสร็จแล้ว');
  });

  it('never throws for every state and hostile values', () => {
    const states: GameState[] = ['IDLE', 'PREPARING', 'COOKING', 'PRESENTING', 'REWARDING', 'NEXT_DESSERT'];
    const odd: Partial<RenderView>[] = [
      {}, { heart: NaN }, { heart: -3 }, { heart: 99 }, { progress: NaN }, { progress: 1e9 }, { progress: -5 },
      { dessertNameTh: 'ก'.repeat(500) }, { toast: 'x'.repeat(2000) }, { stepNameTh: '' },
      { vote: { open: false, candidates: [], tally: [], remainingMs: NaN, winner: null } },
      { vote: { open: true, candidates: [{ id: 'a', nameTh: 'x', palette: [] }], tally: [], remainingMs: -50, winner: 7 } },
      { vote: { open: true, candidates: [{ id: 'a', nameTh: 'x', palette: ['not-a-colour'] }], tally: [NaN], remainingMs: 1e12, winner: 0 } },
      { palette: [] },
    ];
    for (const s of states) for (const o of odd) expect(() => draw(view({ state: s, ...o })), `${s} ${JSON.stringify(o).slice(0, 60)}`).not.toThrow();
  });

  it('leaves the canvas state balanced even if drawing throws midway', () => {
    let depth = 0;
    const ctx = new Proxy({}, {
      get(_t, prop) {
        if (prop === 'save') return () => { depth++; };
        if (prop === 'restore') return () => { depth--; };
        if (prop === 'fillText') return () => { throw new Error('font failed'); };
        if (prop === 'createLinearGradient') return () => ({ addColorStop() {} });
        return () => ctx;
      },
      set: () => true,
    }) as unknown as CanvasRenderingContext2D;
    expect(() => new VoteRenderer(4).draw(ctx, 1000, 600, view(), new ParticleSystem(10, 0), 16)).not.toThrow();
    expect(depth).toBe(0);
  });
});
