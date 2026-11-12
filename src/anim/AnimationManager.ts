import type { GameConfig } from '../config/gameConfig';
import type { AnimId } from '../dessert/types';

export type AnimDoneReason = 'finished' | 'timeout' | 'error';

export interface AnimSpec {
  kind: AnimId;
  durationMs: number;
  /** Hard limit; the animation ends with 'timeout' if it is still running. Default: 2 x durationMs. */
  maxMs?: number;
  /** Playing the same key again in the same round restarts it (the old one ends silently). */
  key?: string;
  onUpdate?(t: number, dtMs: number): void;
  onDone?(reason: AnimDoneReason): void;
}

interface Active {
  handle: number;
  roundId: number;
  keyId: string | null;
  spec: AnimSpec;
  elapsedMs: number;
  maxMs: number;
}

/** Headless, round-tagged tween registry. Nothing in here waits forever and cancelled animations never call back. */
export class AnimationManager {
  private nextHandle = 1;
  private readonly active = new Map<number, Active>();
  private readonly byKey = new Map<string, number>();

  constructor(private readonly config: GameConfig) {}

  get activeCount(): number {
    return this.active.size;
  }

  isActive(handle: number): boolean {
    return this.active.has(handle);
  }

  play(spec: AnimSpec, roundId: number): number {
    const keyId = spec.key !== undefined ? `${roundId}:${spec.key}` : null;
    if (keyId !== null) {
      const old = this.byKey.get(keyId);
      if (old !== undefined) this.cancel(old);
    }
    const duration = Number.isFinite(spec.durationMs) ? Math.max(0, spec.durationMs) : 0;
    const maxMs = Number.isFinite(spec.maxMs ?? NaN) ? Math.max(1, spec.maxMs as number) : Math.max(1, duration * 2);
    const handle = this.nextHandle++;
    this.active.set(handle, { handle, roundId, keyId, spec: { ...spec, durationMs: duration }, elapsedMs: 0, maxMs });
    if (keyId !== null) this.byKey.set(keyId, handle);
    while (this.active.size > this.config.anim.maxActive) {
      const oldest = this.active.keys().next().value as number;
      this.cancel(oldest);
    }
    return handle;
  }

  cancel(handle: number): boolean {
    const a = this.active.get(handle);
    if (!a) return false;
    this.remove(a);
    return true;
  }

  cancelRound(roundId: number): number {
    let n = 0;
    for (const a of [...this.active.values()]) {
      if (a.roundId === roundId) {
        this.remove(a);
        n++;
      }
    }
    return n;
  }

  update(dtMs: number): void {
    if (!Number.isFinite(dtMs) || dtMs <= 0) return;
    for (const a of [...this.active.values()]) {
      if (!this.active.has(a.handle)) continue; // cancelled by an earlier callback in this update
      a.elapsedMs += dtMs;
      const t = a.spec.durationMs <= 0 ? 1 : Math.min(1, a.elapsedMs / a.spec.durationMs);
      try {
        a.spec.onUpdate?.(t, dtMs);
      } catch (err) {
        console.error('[AnimationManager] onUpdate threw', err);
        this.finish(a, 'error');
        continue;
      }
      if (!this.active.has(a.handle)) continue; // onUpdate cancelled it
      if (t >= 1) this.finish(a, 'finished');
      else if (a.elapsedMs >= a.maxMs) this.finish(a, 'timeout');
    }
  }

  private remove(a: Active): void {
    this.active.delete(a.handle);
    if (a.keyId !== null && this.byKey.get(a.keyId) === a.handle) this.byKey.delete(a.keyId);
  }

  private finish(a: Active, reason: AnimDoneReason): void {
    this.remove(a);
    try {
      a.spec.onDone?.(reason);
    } catch (err) {
      console.error('[AnimationManager] onDone threw', err);
    }
  }
}
