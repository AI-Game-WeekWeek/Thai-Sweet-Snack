export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  lifeMs: number;
  ageMs: number;
  size: number;
  color: string;
  /** Gravity multiplier (default 1; steam uses a small negative value so it rises). */
  g?: number;
}

export type ParticleInit = Omit<Particle, 'ageMs'>;

/** Capped particle pool. When full, spawns are refused (visual density drops, frame time does not). */
export class ParticleSystem {
  private items: Particle[] = [];

  constructor(
    private readonly cap: number,
    private readonly gravity: number,
  ) {}

  get count(): number {
    return this.items.length;
  }

  spawn(init: ParticleInit): boolean {
    const nums = [init.x, init.y, init.vx, init.vy, init.lifeMs, init.size];
    if (!nums.every(Number.isFinite) || init.lifeMs <= 0 || init.size <= 0) return false;
    if (this.items.length >= this.cap) return false;
    this.items.push({ ...init, ageMs: 0 });
    return true;
  }

  update(dtMs: number): void {
    if (!Number.isFinite(dtMs) || dtMs <= 0) return;
    const dt = dtMs / 1000;
    let w = 0;
    for (const p of this.items) {
      p.ageMs += dtMs;
      if (p.ageMs >= p.lifeMs) continue;
      p.vy += this.gravity * (p.g ?? 1) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      this.items[w++] = p;
    }
    this.items.length = w;
  }

  clear(): void {
    this.items.length = 0;
  }

  forEach(fn: (p: Readonly<Particle>) => void): void {
    for (const p of this.items) fn(p);
  }
}
