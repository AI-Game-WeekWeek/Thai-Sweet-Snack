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
}

export interface CafeQueueOptions {
  maxWaiting: number;
  patienceMs: number;
  maxNameLength: number;
}

/** VIP first, then phone orders, then viewers (gifts), then anonymous customers. */
const rank = (c: Customer): number => (c.kind === 'vip' ? 0 : c.kind === 'phone' ? 1 : c.viewer ? 2 : 3);

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

  waiting(): readonly Customer[] {
    return this.list;
  }

  /** Viewers queue right behind the customer being served (in order of arrival); anonymous customers join the back. */
  enqueue(n: NewCustomer): 'ok' | 'full' {
    if (this.list.length >= this.opts.maxWaiting) return 'full';
    const name = n.name ? cleanName(n.name, this.opts.maxNameLength) : '';
    const patience = n.patienceMs !== undefined && Number.isFinite(n.patienceMs) && n.patienceMs > 0 ? n.patienceMs : this.opts.patienceMs;
    const customer: Customer = {
      id: this.nextId++,
      kind: n.kind ?? 'normal',
      viewer: n.viewer,
      name: name === '' ? null : name,
      avatarUrl: n.avatarUrl ?? null,
      seed: this.nextId,
      dessertId: n.dessertId,
      patienceMs: patience,
      patienceMaxMs: patience,
      state: 'WAITING',
    };
    // Priority rank, first-come first-served within a rank: a combo of gifts cannot jump the line.
    const r = rank(customer);
    let at = this.list.length;
    for (let i = 0; i < this.list.length; i++) {
      if (rank(this.list[i] as Customer) > r) {
        at = i;
        break;
      }
    }
    this.list.splice(at, 0, customer);
    return 'ok';
  }

  /** Customers who ran out of patience this tick (removed from the queue). `slow` (0..1] slows the loss (lucky cat). */
  tick(dtMs: number, slow = 1): Customer[] {
    if (!Number.isFinite(dtMs) || dtMs <= 0) return [];
    const dt = dtMs * (Number.isFinite(slow) && slow > 0 && slow <= 1 ? slow : 1);
    const left: Customer[] = [];
    const stay: Customer[] = [];
    for (const c of this.list) {
      c.patienceMs -= dt;
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
