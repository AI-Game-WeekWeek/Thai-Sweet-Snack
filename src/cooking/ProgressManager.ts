/** The only place cooking progress changes. Always within 0..100. */
export class ProgressManager {
  private current = 0;
  private round = 0;

  get value(): number {
    return this.current;
  }

  get roundId(): number {
    return this.round;
  }

  startRound(roundId: number): void {
    this.round = roundId;
    this.current = 0;
  }

  /** Adds progress; returns the amount actually applied (0 when rejected). */
  add(amount: number, roundId: number): number {
    if (roundId !== this.round) return 0;
    if (!Number.isFinite(amount) || amount <= 0) return 0;
    const next = Math.min(100, this.current + amount);
    const applied = next - this.current;
    this.current = next;
    return applied;
  }

  /** Raises progress to at least `value` (clamped to 100); never lowers. Returns the amount applied. */
  setAtLeast(value: number, roundId: number): number {
    if (roundId !== this.round || !Number.isFinite(value)) return 0;
    const target = Math.min(100, value);
    if (target <= this.current) return 0;
    const applied = target - this.current;
    this.current = target;
    return applied;
  }
}
