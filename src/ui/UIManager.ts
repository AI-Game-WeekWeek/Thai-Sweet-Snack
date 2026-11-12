import type { GameSnapshot } from '../Game';

const CSS = `
.hud{font-family:system-ui,'Noto Sans Thai',sans-serif;color:#3b2a1a;max-width:1000px;margin:0 auto;padding:8px 12px;display:grid;gap:8px}
.hud-row{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;justify-content:space-between}
.hud-current{font-size:22px;font-weight:700}
.hud-bar{height:18px;border-radius:9px;background:#ead9c2;overflow:hidden}
.hud-fill{height:100%;width:0;background:linear-gradient(90deg,#f6b26b,#e06666);transition:width .15s linear}
.hud-chips{display:flex;flex-wrap:wrap;gap:6px}
.hud-chip{display:inline-flex;align-items:center;gap:6px;padding:2px 10px;border-radius:12px;background:#fff7ea;border:1px solid #ead9c2;font-size:14px}
.hud-dot{width:12px;height:12px;border-radius:50%;display:inline-block;border:1px solid rgba(0,0,0,.2)}
.hud-counters,.hud-next{font-size:14px;opacity:.85}
.hud-reward{font-size:18px;font-weight:600}
.hud-toast{font-size:18px;font-weight:700;color:#b45f06;text-align:center}
`;

/** The six-element HUD. Reads snapshots only; writes to the DOM only where a value changed. */
export class UIManager {
  private readonly style: HTMLStyleElement;
  private readonly el: Record<'current' | 'progress' | 'fill' | 'ingredients' | 'counters' | 'reward' | 'next' | 'toast', HTMLElement>;
  private last = new Map<string, string>();
  private chipsKey = '';
  private destroyed = false;

  constructor(private readonly root: HTMLElement) {
    this.style = document.createElement('style');
    this.style.textContent = CSS;
    const box = document.createElement('div');
    box.className = 'hud';
    const mk = (tag: string, cls: string, hud?: string): HTMLElement => {
      const n = document.createElement(tag);
      n.className = cls;
      if (hud) n.dataset.hud = hud;
      return n;
    };
    const current = mk('div', 'hud-current', 'current');
    const progress = mk('div', 'hud-bar', 'progress');
    progress.setAttribute('role', 'progressbar');
    progress.setAttribute('aria-valuemin', '0');
    progress.setAttribute('aria-valuemax', '100');
    const fill = mk('div', 'hud-fill');
    progress.append(fill);
    const ingredients = mk('div', 'hud-chips', 'ingredients');
    const counters = mk('div', 'hud-counters', 'counters');
    const reward = mk('div', 'hud-reward', 'reward');
    const next = mk('div', 'hud-next', 'next');
    const toast = mk('div', 'hud-toast', 'toast');
    toast.hidden = true;
    const row = mk('div', 'hud-row');
    row.append(reward, next);
    box.append(current, progress, ingredients, counters, row, toast);
    root.append(this.style, box);
    this.el = { current, progress, fill, ingredients, counters, reward, next, toast };
  }

  render(s: GameSnapshot): void {
    if (this.destroyed) return;
    const pct = Number.isFinite(s.progress) ? Math.min(100, Math.max(0, s.progress)) : 0;
    this.setText('current', this.el.current, `กำลังทำ: ${s.dessertNameTh ?? '-'}  ·  ขั้นตอน: ${s.stepNameTh ?? '-'}`);
    this.setStyleWidth(pct);
    this.setChips(s.ingredients);
    const c = s.counters;
    this.setText('counters', this.el.counters, `ไลก์ ${c.likes} · ติดตาม ${c.follows} · หัวใจ ${c.hearts} · ของขวัญ ${c.gifts} · แชร์ ${c.shares} · ${s.connection}`);
    this.setText('reward', this.el.reward, `คะแนน ${s.reward.score} · เหรียญ ${s.reward.coins} · เลเวล ${s.reward.level}`);
    this.setText('next', this.el.next, `ถัดไป: ${s.nextDessertNameTh}`);
    const toast = s.toast ?? '';
    this.setText('toast', this.el.toast, toast);
    this.el.toast.hidden = toast === '';
  }

  destroy(): void {
    this.destroyed = true;
    this.root.replaceChildren();
  }

  private setText(key: string, node: HTMLElement, text: string): void {
    if (this.last.get(key) === text) return;
    this.last.set(key, text);
    node.textContent = text;
  }

  private setStyleWidth(pct: number): void {
    const w = `${Math.round(pct)}%`;
    if (this.last.get('width') === w) return;
    this.last.set('width', w);
    this.el.fill.style.width = w;
    this.el.progress.setAttribute('aria-valuenow', String(Math.round(pct)));
  }

  private setChips(items: readonly { id: string; nameTh: string; color: string }[]): void {
    const key = items.map((i) => `${i.id}|${i.nameTh}|${i.color}`).join(';');
    if (key === this.chipsKey) return;
    this.chipsKey = key;
    const nodes = items.map((i) => {
      const chip = document.createElement('span');
      chip.className = 'hud-chip';
      const dot = document.createElement('span');
      dot.className = 'hud-dot';
      dot.style.background = /^#[0-9a-f]{3,8}$/i.test(i.color) ? i.color : '#ccc';
      const label = document.createElement('span');
      label.textContent = i.nameTh;
      chip.append(dot, label);
      return chip;
    });
    this.el.ingredients.replaceChildren(...nodes);
  }
}
