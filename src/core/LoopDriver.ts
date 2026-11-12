import type { GameManager } from './GameManager';

type Raf = (cb: (t: number) => void) => number;
type Caf = (id: number) => void;

/** The only requestAnimationFrame user in the project. */
export class LoopDriver {
  private isRunning = false;
  private frameId: number | null = null;
  private lastT: number | null = null;

  constructor(
    private readonly game: GameManager,
    private readonly raf: Raf = (cb) => requestAnimationFrame(cb),
    private readonly caf: Caf = (id) => cancelAnimationFrame(id),
  ) {}

  start(): boolean {
    if (this.isRunning) return false;
    this.isRunning = true;
    this.lastT = null;
    this.frameId = this.raf(this.tick);
    return true;
  }

  stop(): void {
    this.isRunning = false;
    if (this.frameId !== null) this.caf(this.frameId);
    this.frameId = null;
    this.lastT = null;
  }

  private tick = (t: number): void => {
    this.frameId = null; // this frame has fired; anything scheduled from here on is a new chain
    const dt = this.lastT === null ? 0 : t - this.lastT;
    this.lastT = t;
    try {
      this.game.update(dt);
    } catch (err) {
      console.error('[LoopDriver] update threw', err);
    }
    // Reschedule only if still running and no stop()+start() inside update already scheduled the next frame.
    if (this.isRunning && this.frameId === null) this.frameId = this.raf(this.tick);
  };
}
