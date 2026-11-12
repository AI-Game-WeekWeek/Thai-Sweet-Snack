export interface HeartMeterOptions {
  decayPerSec: number;
  /** Cooking speed multiplier when the meter is full. */
  maxBoost: number;
}

/** Viewer hearts (likes) fill it; it drains over time; its multiplier speeds up cooking. */
export class HeartMeter {
  private v = 0;

  constructor(private readonly opts: HeartMeterOptions) {}

  get value(): number {
    return this.v;
  }

  get multiplier(): number {
    return 1 + this.v * (this.opts.maxBoost - 1);
  }

  add(amount: number): void {
    if (!Number.isFinite(amount) || amount <= 0) return;
    this.v = Math.min(1, this.v + amount);
  }

  update(dtMs: number): void {
    if (!Number.isFinite(dtMs) || dtMs <= 0) return;
    this.v = Math.max(0, this.v - (this.opts.decayPerSec * dtMs) / 1000);
  }

  reset(): void {
    this.v = 0;
  }
}
