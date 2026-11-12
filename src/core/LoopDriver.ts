import type { GameManager } from './GameManager';

type Raf = (cb: (t: number) => void) => number;
type Caf = (id: number) => void;

/** The only requestAnimationFrame user in the project. */
export class LoopDriver {
  private frameId: number | null = null;
  private lastT: number | null = null;

  constructor(
    private readonly game: GameManager,
    private readonly raf: Raf = (cb) => requestAnimationFrame(cb),
    private readonly caf: Caf = (id) => cancelAnimationFrame(id),
  ) {}

  start(): boolean {
    if (this.frameId !== null) return false;
    this.lastT = null;
    this.frameId = this.raf(this.tick);
    return true;
  }

  stop(): void {
    if (this.frameId !== null) this.caf(this.frameId);
    this.frameId = null;
    this.lastT = null;
  }

  private tick = (t: number): void => {
    const dt = this.lastT === null ? 0 : t - this.lastT;
    this.lastT = t;
    try {
      this.game.update(dt);
    } catch (err) {
      console.error('[LoopDriver] update threw', err);
    }
    // Schedule exactly one next frame (stop() inside update clears frameId first).
    if (this.frameId !== null) this.frameId = this.raf(this.tick);
  };
}
