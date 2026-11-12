import type { LiveEvent, LiveEventType } from './types';

interface Stream {
  ratePerSec: number;
  remainingMs: number;
  acc: number;
}
interface Delayed {
  dueMs: number;
  event: LiveEvent;
}

let instances = 0;

/** Generates viewer events without TikTok: steady streams, bursts, duplicates, delayed and out-of-order batches. */
export class MockEventSource {
  private readonly prefix = `mock${++instances}`;
  private seq = 0;
  private clockMs = 0;
  private streams: Stream[] = [];
  private delayedEvents: Delayed[] = [];

  constructor(
    private readonly rng: () => number,
    private readonly sink: (raw: unknown) => void,
    private readonly opts: { comments?: boolean } = {},
  ) {}

  steady(ratePerSec: number, durationMs: number): void {
    if (!Number.isFinite(ratePerSec) || ratePerSec <= 0 || !Number.isFinite(durationMs) || durationMs <= 0) return;
    this.streams.push({ ratePerSec, remainingMs: durationMs, acc: 0 });
  }

  burst(type: LiveEventType, n: number, tsMs: number): void {
    for (let i = 0; i < n; i++) this.sink(this.make(type, tsMs));
  }

  duplicates(event: LiveEvent, times: number): void {
    for (let i = 0; i < times; i++) this.sink({ ...event });
  }

  delayed(event: LiveEvent, delayMs: number): void {
    this.delayedEvents.push({ dueMs: this.clockMs + Math.max(0, delayMs), event });
  }

  outOfOrder(events: readonly LiveEvent[]): void {
    const shuffled = [...events];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j] as LiveEvent, shuffled[i] as LiveEvent];
    }
    if (shuffled.length > 1 && shuffled.every((e, i) => e === events[i])) shuffled.reverse();
    for (const e of shuffled) this.sink({ ...e });
  }

  tick(dtMs: number, nowMs: number): void {
    if (!Number.isFinite(dtMs) || dtMs <= 0) return;
    this.clockMs += dtMs;
    for (const s of this.streams) {
      const active = Math.min(dtMs, s.remainingMs);
      s.remainingMs -= active;
      s.acc += (s.ratePerSec * active) / 1000;
      while (s.acc >= 1) {
        s.acc -= 1;
        this.sink(this.make(this.pickType(), nowMs));
      }
    }
    this.streams = this.streams.filter((s) => s.remainingMs > 0);
    const due = this.delayedEvents.filter((d) => d.dueMs <= this.clockMs);
    this.delayedEvents = this.delayedEvents.filter((d) => d.dueMs > this.clockMs);
    for (const d of due) this.sink({ ...d.event });
  }

  private pickType(): LiveEventType {
    if (this.opts.comments && this.rng() < 0.3) return 'comment';
    const r = this.rng();
    if (r < 0.8) return 'like';
    if (r < 0.92) return 'follow';
    if (r < 0.95) return 'orangeHeart';
    if (r < 0.97) return 'rose';
    if (r < 0.99) return 'gift';
    return 'share';
  }

  private make(type: LiveEventType, tsMs: number): LiveEvent {
    const count = type === 'like' ? 1 + Math.floor(this.rng() * 5) : 1;
    const e: LiveEvent & { text?: string } = { id: `${this.prefix}-${++this.seq}`, type, count, tsMs };
    if (type === 'comment') {
      e.text = String(1 + Math.floor(this.rng() * 3));
      e.userId = `u${Math.floor(this.rng() * 300)}`;
    }
    if (type === 'gift') e.giftCoins = this.rng() < 0.4 ? 500 : 5;
    return e;
  }
}
