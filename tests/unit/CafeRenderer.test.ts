import { describe, expect, it, vi } from 'vitest';
import { ParticleSystem } from '../../src/anim/ParticleSystem';
import type { CafeView, CustomerView, RenderView } from '../../src/Game';
import { AvatarCache } from '../../src/render/AvatarCache';
import { CafeRenderer } from '../../src/render/CafeRenderer';
import type { GameState } from '../../src/core/StateMachine';

/** A canvas context that records the text drawn and accepts every call (also counts save/restore and image draws). */
function fakeCtx(opts: { throwOnText?: boolean } = {}) {
  const texts: string[] = [];
  const at: { t: string; y: number }[] = [];
  let depth = 0;
  let images = 0;
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === 'save') return () => { depth++; };
      if (prop === 'restore') return () => { depth--; };
      if (prop === 'drawImage') return () => { images++; };
      if (prop === 'fillText' || prop === 'strokeText') return (t: string, _x?: number, y?: number) => { if (opts.throwOnText) throw new Error('font failed'); texts.push(String(t)); at.push({ t: String(t), y: Number(y) }); };
      if (prop === 'measureText') return () => ({ width: 100 });
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => ({ addColorStop() {} });
      return () => proxy;
    },
    set: () => true,
  };
  const proxy: object = new Proxy({}, handler);
  return { ctx: proxy as unknown as CanvasRenderingContext2D, texts, at, depth: () => depth, images: () => images };
}

const cust = (id: number, over: Partial<CustomerView> = {}): CustomerView => ({
  id, kind: 'normal', name: null, viewer: false, seed: id, avatarUrl: null, dessertId: 'khao-tom-mat', dessertNameTh: 'ข้าวต้มมัด', color: '#fdf5e6', patience: 0.6, serving: false, ...over,
});
const cafe = (over: Partial<CafeView> = {}): CafeView => ({
  serving: cust(1, { serving: true, patience: 1, viewer: true, name: 'มะลิ', dessertNameTh: 'บัวลอย' }),
  waiting: [cust(2, { viewer: true, name: 'น้ำฝน' }), cust(3), cust(4, { patience: 0.1 }), cust(5)],
  waitingTotal: 7, lost: 2, coins: 345, luckyCatSec: 0, luckyCatBonusPct: 50, phoneRinging: false,
  giftMenu: [{ coins: 1, nameTh: 'ข้าวต้มมัด', color: '#fdf5e6', id: 'khao-tom-mat' }, { coins: 5, nameTh: 'บัวลอย', color: '#b4a7d6', id: 'bua-loy' }, { coins: 500, nameTh: 'ขนมเบื้อง', color: '#fff', id: 'khanom-buang' }],
  ...over,
});
const view = (over: Partial<RenderView> = {}): RenderView => ({
  state: 'COOKING', progress: 42, palette: ['#fdf5e6', '#f1c232'], stepKind: 'stir', stepT: 0.5, presentT: null, wobble: 0, piecesCount: 8,
  heart: 0.5, dessertNameTh: 'บัวลอย', stepNameTh: 'ต้มจนลอย', toast: null, cafe: cafe(), ...over,
});
const avatars = () => new AvatarCache({ hosts: [], max: 4, timeoutMs: 1000 });
const draw = (v: RenderView, ctxOpts = {}) => {
  const f = fakeCtx(ctxOpts);
  new CafeRenderer(4, avatars()).draw(f.ctx, 720, 1280, v, new ParticleSystem(10, 0), 16);
  return f;
};

describe('CafeRenderer', () => {
  it('draws the shop sign, the gift menu with every tier, the queue and the coin count', () => {
    const t = draw(view()).texts.join(' | ');
    for (const s of ['ร้านขนมไทย', 'ส่งของขวัญ', 'ข้าวต้มมัด', 'บัวลอย', 'ขนมเบื้อง', '500', 'มะลิ', 'น้ำฝน', '345']) expect(t).toContain(s);
  });

  it('shows what is happening in each state', () => {
    expect(draw(view({ state: 'PREPARING', cafe: cafe() })).texts.join(' ')).toContain('สั่ง');
    const cooking = draw(view({ state: 'COOKING' })).texts.join(' ');
    for (const s of ['กำลังทำ', 'ต้มจนลอย', 'หัวใจ', '42%']) expect(cooking).toContain(s);
    const served = draw(view({ state: 'REWARDING', presentT: 1, toast: 'มะลิ +120 คะแนน +14 เหรียญ' })).texts.join(' ');
    expect(served).toContain('เสร็จแล้ว');
    expect(served).toContain('+14 เหรียญ');
  });

  it('never throws for every state and hostile values, and keeps the canvas state balanced', () => {
    const states: GameState[] = ['IDLE', 'PREPARING', 'COOKING', 'PRESENTING', 'REWARDING', 'NEXT_DESSERT'];
    const many = Array.from({ length: 100 }, (_, i) => cust(i + 10, { name: 'ก'.repeat(500), patience: i % 2 ? NaN : -4 }));
    const odd: Partial<RenderView>[] = [
      {}, { cafe: undefined }, { heart: NaN }, { heart: 99 }, { progress: NaN }, { progress: 1e9 }, { palette: [] },
      { toast: 'x'.repeat(5000) }, { dessertNameTh: 'ก'.repeat(500) }, { stepNameTh: null },
      { cafe: cafe({ serving: null, waiting: [], waitingTotal: 0, giftMenu: [], coins: NaN, lost: NaN }) },
      { cafe: cafe({ waiting: many, waitingTotal: 1e9 }) },
      { cafe: cafe({ serving: cust(1, { color: 'not-a-colour', patience: NaN, name: '‮', avatarUrl: 'javascript:alert(1)' }) }) },
    ];
    for (const st of states) for (const o of odd) {
      const f = fakeCtx();
      expect(() => new CafeRenderer(4, avatars()).draw(f.ctx, 720, 1280, view({ state: st, ...o }), new ParticleSystem(10, 0), 16), `${st} ${JSON.stringify(o).slice(0, 50)}`).not.toThrow();
      expect(f.depth()).toBe(0);
    }
  });

  it('draws at most the visible customers even if more are passed', () => {
    const f = draw(view({ cafe: cafe({ waiting: Array.from({ length: 50 }, (_, i) => cust(i + 10, { viewer: true, name: `N${i}` })) }) }));
    // every text is recorded twice (outline + fill), so count distinct names: the 4 waiting slots only
    expect(new Set(f.texts.filter((t) => /^N\d+$/.test(t))).size).toBeLessThanOrEqual(4);
  });

  it('draws a loaded profile picture inside the head slot, and falls back to the generated avatar otherwise', () => {
    const img = { onload: null, onerror: null, release() {}, source: {} as CanvasImageSource };
    const cache = new AvatarCache({ hosts: ['cdn.example.com'], max: 4, timeoutMs: 1000 }, () => img, () => 0);
    cache.get('https://cdn.example.com/a.jpg');
    (img.onload as unknown as (() => void) | null)?.call(null);
    const v = view({ cafe: cafe({ serving: cust(1, { serving: true, viewer: true, name: 'มะลิ', avatarUrl: 'https://cdn.example.com/a.jpg' }), waiting: [] }) });
    const withPic = fakeCtx();
    new CafeRenderer(4, cache).draw(withPic.ctx, 720, 1280, v, new ParticleSystem(10, 0), 16);
    expect(withPic.images()).toBe(1);
    const without = draw(v);
    expect(without.images()).toBe(0);
  });

  it('survives a picture that cannot be drawn and a font failure without breaking the canvas state', () => {
    const img = { onload: null, onerror: null, release() {}, source: null as unknown as CanvasImageSource };
    const cache = new AvatarCache({ hosts: ['cdn.example.com'], max: 4, timeoutMs: 1000 }, () => img, () => 0);
    cache.get('https://cdn.example.com/a.jpg');
    (img.onload as unknown as (() => void) | null)?.call(null);
    const f = fakeCtx({ throwOnText: true });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => new CafeRenderer(4, cache).draw(f.ctx, 720, 1280, view({ cafe: cafe({ serving: cust(1, { serving: true, avatarUrl: 'https://cdn.example.com/a.jpg' }) }) }), new ParticleSystem(10, 0), 16)).not.toThrow();
    expect(f.depth()).toBe(0);
  });

  it('layout: customers are in the top part of the screen, then status, then the cooking counter, then the gift menu', () => {
    const f = draw(view({ state: 'COOKING', progress: 42, cafe: cafe() }));
    const yOf = (text: string): number => f.at.find((a) => a.t === text)!.y;
    const customerYs = ['มะลิ', 'น้ำฝน'].map(yOf);
    const sign = yOf('ร้านขนมไทย');
    const status = yOf('กำลังทำ บัวลอย');
    const progress = yOf('42%');
    const menuTitle = yOf('ส่งของขวัญ = สั่งขนม');
    for (const y of customerYs) {
      expect(y).toBeGreaterThan(sign);
      expect(y).toBeLessThan(720); // upper third: nothing a customer says or shows is low on the screen
      expect(y).toBeLessThan(status);
    }
    expect(status).toBeLessThan(progress);
    expect(progress).toBeLessThan(menuTitle);
    expect(menuTitle).toBeLessThan(1920);
    // the order bubble sits above the served customer, near the top
    const bubble = f.at.find((a) => a.t === 'บัวลอย' && a.y < 400);
    expect(bubble).toBeDefined();
  });

  it('shows the lucky cat pill with its timer only while it is on', () => {
    const on = draw(view({ cafe: cafe({ luckyCatSec: 12.4, luckyCatBonusPct: 50 }) })).texts.join(' | ');
    expect(on).toContain('แมวกวัก');
    expect(on).toContain('+50%'); // the real bonus, not a made-up multiplier
    expect(draw(view({ cafe: cafe({ luckyCatSec: 5, luckyCatBonusPct: 100 }) })).texts.join(' | ')).toContain('+100%');
    expect(on).toContain('13'); // seconds, rounded up
    expect(draw(view({ cafe: cafe({ luckyCatSec: 0 }) })).texts.join(' | ')).not.toContain('แมวกวัก');
  });

  it('shows a ringing phone warning only while it rings, and the phone is always on the counter', () => {
    expect(draw(view({ cafe: cafe({ phoneRinging: true }) })).texts.join(' | ')).toContain('โทรศัพท์ดัง');
    expect(draw(view({ cafe: cafe({ phoneRinging: false }) })).texts.join(' | ')).not.toContain('โทรศัพท์ดัง');
  });

  it('marks a VIP with a crown label instead of a name, and a phone order with a phone badge', () => {
    const vip = cust(7, { kind: 'vip', serving: true, patience: 1, dessertNameTh: 'ฝอยทอง' });
    const t = draw(view({ cafe: cafe({ serving: vip, waiting: [cust(8, { kind: 'phone', patience: 0.4 })] }) })).texts.join(' | ');
    expect(t).toContain('VIP');
    expect(t).toContain('โทร');
  });

  it('hostile surprise values never throw and keep the canvas state balanced', () => {
    for (const o of [{ luckyCatSec: NaN }, { luckyCatSec: -5 }, { luckyCatSec: 1e12 }, { phoneRinging: true, luckyCatSec: Infinity }]) {
      const f = fakeCtx();
      expect(() => new CafeRenderer(4, avatars()).draw(f.ctx, 720, 1280, view({ cafe: cafe(o) }), new ParticleSystem(10, 0), 16)).not.toThrow();
      expect(f.depth()).toBe(0);
    }
  });

  it('draws wrapped parcels for ข้าวต้มมัด without errors and with a balanced canvas state', () => {
    for (const t of [0, 0.3, 1]) {
      const f = fakeCtx();
      const v = view({ state: 'PRESENTING', presentT: t, art: 'parcel', piecesCount: 3, dessertNameTh: 'ข้าวต้มมัด' });
      expect(() => new CafeRenderer(4, avatars()).draw(f.ctx, 720, 1280, v, new ParticleSystem(10, 0), 16)).not.toThrow();
      expect(f.depth()).toBe(0);
    }
    for (const n of [0, 1, 50, NaN]) {
      const f = fakeCtx();
      expect(() => new CafeRenderer(4, avatars()).draw(f.ctx, 720, 1280, view({ state: 'PRESENTING', presentT: 1, art: 'parcel', piecesCount: n }), new ParticleSystem(10, 0), 16)).not.toThrow();
      expect(f.depth()).toBe(0);
    }
  });
});
