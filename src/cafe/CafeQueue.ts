import { cleanName } from '../tiktok/cleanName';

export type CustomerState = 'WAITING' | 'SERVING' | 'PAID' | 'LEFT';
export type CustomerKind = 'normal' | 'vip' | 'phone';

export interface Customer {
  id: number;
  kind: CustomerKind;
  viewer: boolean;
  name: string | null;
  avatarUrl: string | null;
  /** Stable per customer, used for the generated face and colours. */
  seed: number;
  dessertId: string;
  /** Came in by joining the live (no gift yet): a gift from the same viewer changes this order instead of adding a customer. */
  joined?: boolean;
  patienceMs: number;
  patienceMaxMs: number;
  state: CustomerState;
}

export interface NewCustomer {
  viewer: boolean;
  /** Default 'normal'. Special customers (VIP, phone order) jump ahead of normal ones. */
  kind?: CustomerKind;
  /** Overrides the default patience (a phone order's deadline). */
  patienceMs?: number;
  name?: string | null;
  avatarUrl?: string | null;
  dessertId: string;
  joined?: boolean;
  /** Fixes the look (outfit / ghost kind) of this customer. Default: derived from the id. */
  seed?: number;
  /** Joins even when the line is full (a ghost cuts in line). */
  force?: boolean;
}

export interface CafeQueueOptions {
  maxWaiting: number;
  patienceMs: number;
  maxNameLength: number;
}

/** A viewer who gave a gift shows no countdown bar (their wait is long and hidden: someone who left the live must not block the line for ever). */
export const hidesCountdown = (c: Customer): boolean => c.viewer && !c.joined && c.kind === 'normal';

/**
 * Phone orders first (they have a deadline), then viewers who gifted (they cut the line: they paid), then viewers who only
 * joined the live, then the VIP, then anonymous filler customers.
 */
const rank = (c: Customer): number => (c.kind === 'phone' ? 0 : c.viewer && !c.joined ? 1 : c.viewer ? 2 : c.kind === 'vip' ? 3 : 4);

/**
 * The café queue. Customers are WAITING → SERVING → PAID | LEFT. Only waiting customers lose patience; the one being
 * served never leaves mid-cooking, so nothing ever has to be cancelled. Payment happens once, in pay().
 */
export class CafeQueue {
  private list: Customer[] = [];
  private serving: Customer | null = null;
  private nextId = 1;

  constructor(private readonly opts: CafeQueueOptions) {}

  get current(): Customer | null {
    return this.serving;
  }

  /** Removes every WAITING customer of a kind (a banished ghost). Returns how many left. The one being served is not touched. */
  removeKind(kind: CustomerKind): number {
    const before = this.list.length;
    this.list = this.list.filter((c) => c.kind !== kind);
    return before - this.list.length;
  }

  waiting(): readonly Customer[] {
    return this.list;
  }

  /** Priority rank, first-come first-served within a rank: a combo of gifts cannot jump the line. */
  private insertByRank(customer: Customer): void {
    const r = rank(customer);
    let at = this.list.length;
    for (let i = 0; i < this.list.length; i++) {
      if (rank(this.list[i] as Customer) > r) {
        at = i;
        break;
      }
    }
    this.list.splice(at, 0, customer);
  }

  /** A viewer already waiting (e.g. came in the live) sends a gift: change that customer's order instead of adding a second one. */
  changeOrder(name: string, dessertId: string, avatarUrl?: string | null, patienceMs?: number): boolean {
    const clean = cleanName(name, this.opts.maxNameLength);
    if (clean === '') return false;
    const c = this.list.find((x) => x.joined && x.name === clean);
    if (!c) return false;
    c.dessertId = dessertId;
    delete c.joined; // paid now: a second gift is a second order
    if (avatarUrl) c.avatarUrl = avatarUrl;
    if (patienceMs !== undefined && Number.isFinite(patienceMs) && patienceMs > 0) {
      c.patienceMs = patienceMs;
      c.patienceMaxMs = patienceMs;
    } else c.patienceMs = c.patienceMaxMs;
    // a viewer who now gifted cuts the line like any gifter (after those who gifted before)
    this.list.splice(this.list.indexOf(c), 1);
    this.insertByRank(c);
    return true;
  }

  /** Viewers queue right behind the customer being served (in order of arrival); anonymous customers join the back. */
  enqueue(n: NewCustomer): 'ok' | 'full' {
    if (this.list.length >= this.opts.maxWaiting && !n.force) return 'full';
    const name = n.name ? cleanName(n.name, this.opts.maxNameLength) : '';
    const patience = n.patienceMs !== undefined && Number.isFinite(n.patienceMs) && n.patienceMs > 0 ? n.patienceMs : this.opts.patienceMs;
    const customer: Customer = {
      id: this.nextId++,
      kind: n.kind ?? 'normal',
      viewer: n.viewer,
      name: name === '' ? null : name,
      avatarUrl: n.avatarUrl ?? null,
      seed: n.seed !== undefined && Number.isFinite(n.seed) ? n.seed : this.nextId,
      dessertId: n.dessertId,
      ...(n.joined ? { joined: true } : {}),
      patienceMs: patience,
      patienceMaxMs: patience,
      state: 'WAITING',
    };
    this.insertByRank(customer);
    return 'ok';
  }

  /** Removes the last anonymous (filler) customer to make room for a special one. Never touches viewers, VIPs or phone orders. */
  displaceAnonymous(): boolean {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const c = this.list[i] as Customer;
      if (c.kind === 'normal' && !c.viewer) {
        this.list.splice(i, 1);
        return true;
      }
    }
    return false;
  }

  /**
   * Makes one place for a viewer when the line is full: a filler customer goes first; otherwise the viewer who only joined the live
   * and has waited longest (most likely gone by now). Never touches gifting viewers, VIPs or phone orders.
   */
  makeRoom(): boolean {
    if (this.displaceAnonymous()) return true;
    let at = -1;
    for (let i = 0; i < this.list.length; i++) {
      const c = this.list[i] as Customer;
      if (c.joined && c.kind === 'normal' && (at < 0 || c.patienceMs < (this.list[at] as Customer).patienceMs)) at = i;
    }
    if (at < 0) return false;
    this.list.splice(at, 1);
    return true;
  }

  /** Customers who ran out of patience this tick (removed from the queue). `slow` (0..1] slows the loss (lucky cat). */
  tick(dtMs: number, slow = 1): Customer[] {
    if (!Number.isFinite(dtMs) || dtMs <= 0) return [];
    const factor = Number.isFinite(slow) && slow > 0 && slow <= 1 ? slow : 1;
    const left: Customer[] = [];
    const stay: Customer[] = [];
    for (const c of this.list) {
      c.patienceMs -= c.kind === 'phone' ? dtMs : dtMs * factor; // a phone order's deadline is never stretched
      if (c.patienceMs <= 0) {
        c.state = 'LEFT';
        left.push(c);
      } else stay.push(c);
    }
    if (left.length > 0) this.list = stay;
    return left;
  }

  startNext(): Customer | null {
    if (this.serving || this.list.length === 0) return null;
    const next = this.list.shift() as Customer;
    next.state = 'SERVING';
    this.serving = next;
    return next;
  }

  /** Pays the customer being served, exactly once. Happiness = patience left (0..1) when they were called up. */
  pay(): { customer: Customer; happiness: number } | null {
    const c = this.serving;
    if (!c) return null;
    c.state = 'PAID';
    this.serving = null;
    return { customer: c, happiness: Math.min(1, Math.max(0, c.patienceMs / c.patienceMaxMs)) };
  }

  /** Frees the counter without paying (the round ended some other way). */
  release(): Customer | null {
    const c = this.serving;
    if (!c) return null;
    c.state = 'LEFT';
    this.serving = null;
    return c;
  }

  reset(): void {
    this.list = [];
    this.serving = null;
  }
}
