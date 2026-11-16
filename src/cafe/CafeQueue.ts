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
  /** Total time spent waiting in the line (counts on screen or not): tells a fresh arrival from someone who has been there for ages. */
  waitedMs: number;
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
 * Only a gift (a viewer who paid) or a phone order cuts the line: phone orders first (they have a deadline), then viewers who
 * gifted, then the VIP (an orange-heart reward). Everyone else (viewers who joined, returning regulars, filler customers) waits in
 * the order they arrived: nobody jumps ahead of someone who was already waiting.
 */
const rank = (c: Customer): number => (c.kind === 'phone' ? 0 : c.viewer && !c.joined ? 1 : c.kind === 'vip' ? 2 : 3);

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

  /** How many count against maxWaiting: everyone waiting except a phone-order ghost (it cuts in and must never push a real viewer out). */
  countedWaiting(): number {
    let n = 0;
    for (const c of this.list) if (c.kind !== 'phone') n++;
    return n;
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
    if (this.countedWaiting() >= this.opts.maxWaiting && !n.force) return 'full';
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
      waitedMs: 0,
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
   * Makes one place when the line is full: a filler customer goes first; otherwise the viewer who only joined the live and has
   * waited longest OFF SCREEN (the first `protectFront` places are about to be served, so they are never touched). Never touches
   * gifting viewers, VIPs or phone orders. The newest viewer always gets in; the oldest (most likely gone) makes way.
   */
  makeRoom(protectFront = 0): boolean {
    if (this.displaceAnonymous()) return true;
    for (let i = Math.max(0, protectFront); i < this.list.length; i++) {
      const c = this.list[i] as Customer;
      if (c.joined && c.kind === 'normal') {
        this.list.splice(i, 1);
        return true;
      }
    }
    return false;
  }

  /**
   * More real viewers in the line than there are people in the live: the extra ones must have left. Removes the viewers who only
   * joined and have been quiet longest (`idleMs`, default: time in the line), never the first `protectFront` places (about to be
   * served), never anyone who has waited less than `minWaitedMs` (the viewer count lags behind joins), never gifting viewers,
   * VIPs or phone orders. Returns how many went. `served` is 1 when the customer at the counter is a real viewer (they count too).
   */
  trimViewers(limit: number, minWaitedMs: number, protectFront: number, served = 0, idleMs?: (c: Customer) => number): number {
    if (!Number.isFinite(limit)) return 0;
    let real = served;
    for (const c of this.list) if (c.viewer && c.kind === 'normal') real++;
    const excess = real - Math.max(0, limit);
    if (excess <= 0) return 0;
    const candidates: { c: Customer; idle: number; i: number }[] = [];
    for (let i = Math.max(0, protectFront); i < this.list.length; i++) {
      const c = this.list[i] as Customer;
      if (c.joined && c.kind === 'normal' && c.waitedMs >= minWaitedMs) candidates.push({ c, i, idle: idleMs ? idleMs(c) : c.waitedMs });
    }
    candidates.sort((a, b) => b.idle - a.idle || a.i - b.i); // the quietest first; the earlier arrival on a tie
    const drop = new Set(candidates.slice(0, excess).map((x) => x.c));
    if (drop.size === 0) return 0;
    this.list = this.list.filter((c) => !drop.has(c));
    return drop.size;
  }

  /**
   * Clears the line by hand (the control panel). Mode 'joined': the viewers who only joined, and the fillers (gifting viewers and
   * VIPs keep their place). Mode 'all': everybody waiting. The customer being served and a phone order are not touched.
   */
  clearWaiting(mode: 'joined' | 'all'): number {
    const before = this.list.length;
    this.list = this.list.filter((c) => {
      if (c.kind === 'phone') return true;
      if (mode === 'all') return false;
      return !(c.joined || (!c.viewer && c.kind === 'normal'));
    });
    return before - this.list.length;
  }

  /**
   * Customers who ran out of patience this tick (removed from the queue). `slow` (0..1] slows the loss (lucky cat).
   * Only the first `active` customers in line (the ones on screen) lose patience: those further back have not "arrived" yet,
   * so they keep all of theirs until they move up.
   */
  tick(dtMs: number, slow = 1, active = Infinity): Customer[] {
    if (!Number.isFinite(dtMs) || dtMs <= 0) return [];
    const factor = Number.isFinite(slow) && slow > 0 && slow <= 1 ? slow : 1;
    const limit = Number.isFinite(active) ? Math.max(0, Math.floor(active)) : Infinity;
    const left: Customer[] = [];
    const stay: Customer[] = [];
    let place = 0;
    for (const c of this.list) {
      c.waitedMs += dtMs;
      if (place++ >= limit) {
        stay.push(c); // not on screen yet: its patience does not run
        continue;
      }
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
