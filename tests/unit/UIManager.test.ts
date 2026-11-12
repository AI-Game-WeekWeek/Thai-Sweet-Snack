// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { GameSnapshot } from '../../src/Game';
import { UIManager } from '../../src/ui/UIManager';

const snap = (over: Partial<GameSnapshot> = {}): GameSnapshot => ({
  state: 'COOKING', roundId: 1, roundsCompleted: 0, dessertNameTh: 'ขนมชั้น', nextDessertNameTh: 'บัวลอย',
  stepNameTh: 'ผสมแป้ง', progress: 40,
  counters: { likes: 12, follows: 3, hearts: 1, gifts: 2, shares: 4 }, connection: 'connected', bonusPct: 0,
  ingredients: [{ id: 'a', nameTh: 'แป้ง', color: '#fff' }, { id: 'b', nameTh: 'กะทิ', color: '#eee' }],
  reward: { score: 250, coins: 30, xp: 10, level: 2, last: null }, toast: null, heart: 0, ...over,
});
const q = (root: HTMLElement, name: string) => root.querySelector(`[data-hud="${name}"]`) as HTMLElement;
const nodeCount = (root: HTMLElement) => root.querySelectorAll('*').length;

function mk() {
  const root = document.createElement('div');
  document.body.append(root);
  return { root, ui: new UIManager(root) };
}

describe('UIManager', () => {
  it('builds exactly the six HUD regions (plus the toast)', () => {
    const { root } = mk();
    for (const n of ['current', 'progress', 'ingredients', 'counters', 'reward', 'next']) expect(q(root, n), n).not.toBeNull();
    expect(root.querySelectorAll('button').length).toBe(0);
  });

  it('shows dessert, step, counters, reward and next dessert', () => {
    const { root, ui } = mk();
    ui.render(snap());
    expect(q(root, 'current').textContent).toContain('ขนมชั้น');
    expect(q(root, 'current').textContent).toContain('ผสมแป้ง');
    expect(q(root, 'counters').textContent).toContain('12');
    expect(q(root, 'counters').textContent).toContain('connected');
    expect(q(root, 'reward').textContent).toContain('250');
    expect(q(root, 'reward').textContent).toContain('30');
    expect(q(root, 'next').textContent).toContain('บัวลอย');
  });

  it('progress bar follows progress and clamps to 0..100', () => {
    const { root, ui } = mk();
    const fill = () => (q(root, 'progress').firstElementChild as HTMLElement).style.width;
    ui.render(snap({ progress: 40 }));
    expect(fill()).toBe('40%');
    ui.render(snap({ progress: 150 }));
    expect(fill()).toBe('100%');
    ui.render(snap({ progress: -5 }));
    expect(fill()).toBe('0%');
    ui.render(snap({ progress: NaN }));
    expect(fill()).toBe('0%');
  });

  it('ingredient chips match the dessert and are not rebuilt when it is unchanged', () => {
    const { root, ui } = mk();
    ui.render(snap());
    const first = q(root, 'ingredients').firstElementChild;
    expect(q(root, 'ingredients').children.length).toBe(2);
    ui.render(snap({ progress: 60 }));
    expect(q(root, 'ingredients').firstElementChild).toBe(first);
    ui.render(snap({ ingredients: [{ id: 'z', nameTh: 'เผือก', color: '#b4a7d6' }] }));
    expect(q(root, 'ingredients').children.length).toBe(1);
    expect(q(root, 'ingredients').textContent).toContain('เผือก');
  });

  it('copes with no dessert yet', () => {
    const { root, ui } = mk();
    ui.render(snap({ dessertNameTh: null, stepNameTh: null, ingredients: [], state: 'IDLE' }));
    expect(q(root, 'current').textContent).toContain('-');
    expect(q(root, 'ingredients').children.length).toBe(0);
  });

  it('toast shows its message and hides when null', () => {
    const { root, ui } = mk();
    ui.render(snap({ toast: '+120 คะแนน' }));
    expect(q(root, 'toast').textContent).toContain('+120');
    expect(q(root, 'toast').hidden).toBe(false);
    ui.render(snap({ toast: null }));
    expect(q(root, 'toast').hidden).toBe(true);
  });

  it('1000 renders do not grow the DOM', () => {
    const { root, ui } = mk();
    ui.render(snap());
    const base = nodeCount(root);
    for (let i = 0; i < 1000; i++) ui.render(snap({ progress: i % 100, counters: { likes: i, follows: 0, hearts: 0, gifts: 0, shares: 0 } }));
    expect(nodeCount(root)).toBe(base);
  });

  it('destroy empties the root and later renders are harmless', () => {
    const { root, ui } = mk();
    ui.render(snap());
    ui.destroy();
    expect(root.childElementCount).toBe(0);
    expect(() => ui.render(snap())).not.toThrow();
    expect(root.childElementCount).toBe(0);
  });

  it('renders text safely (no HTML injection from names)', () => {
    const { root, ui } = mk();
    ui.render(snap({ dessertNameTh: '<img src=x onerror=alert(1)>' }));
    expect(root.querySelector('img')).toBeNull();
  });
});
