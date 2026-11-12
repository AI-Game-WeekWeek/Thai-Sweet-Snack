export type CastResult = 'ok' | 'closed' | 'stale' | 'invalid' | 'capped';

export interface VoteOptions {
  /** Distinct voters accepted per round. */
  maxVoters: number;
  /** Votes per second accepted from sources that provide no user id. */
  anonVotesPerSec: number;
}

const MAX_KEY = 64;

/** Tallies the menu vote of one round. Pure: time comes in through cast(). Only vote numbers are kept, never comment text. */
export class VoteManager {
  private counts: number[] = [];
  private open_ = false;
  private round = 0;
  private readonly byUser = new Map<string, number>();
  private windowStart = -Infinity;
  private windowCount = 0;

  constructor(private readonly opts: VoteOptions) {}

  get isOpen(): boolean {
    return this.open_;
  }

  open(candidateCount: number, roundId: number): void {
    this.counts = new Array(Math.max(0, Math.floor(candidateCount))).fill(0);
    this.byUser.clear();
    this.windowStart = -Infinity;
    this.windowCount = 0;
    this.round = roundId;
    this.open_ = true;
  }

  /** `choice` is 1-based. A user's later vote replaces the earlier one. */
  cast(choice: number, userKey: string | undefined, roundId: number, nowMs: number): CastResult {
    if (!this.open_) return 'closed';
    if (roundId !== this.round) return 'stale';
    if (!Number.isInteger(choice) || choice < 1 || choice > this.counts.length) return 'invalid';
    if (userKey !== undefined && userKey !== '') {
      const key = userKey.slice(0, MAX_KEY);
      const previous = this.byUser.get(key);
      if (previous === undefined && this.byUser.size >= this.opts.maxVoters) return 'capped';
      if (previous !== undefined) this.counts[previous]!--;
      this.byUser.set(key, choice - 1);
    } else {
      if (nowMs - this.windowStart >= 1000) {
        this.windowStart = nowMs;
        this.windowCount = 0;
      }
      if (this.windowCount >= this.opts.anonVotesPerSec) return 'capped';
      this.windowCount++;
    }
    this.counts[choice - 1]!++;
    return 'ok';
  }

  close(): void {
    this.open_ = false;
  }

  cancel(): void {
    this.open_ = false;
    this.counts = [];
    this.byUser.clear();
  }

  tally(): readonly number[] {
    return this.counts;
  }

  /** Most votes wins; a tie is broken by `rng`; no votes at all picks the first candidate. */
  winner(rng: () => number): number {
    let max = 0;
    for (const c of this.counts) max = Math.max(max, c);
    if (max === 0) return 0;
    const best: number[] = [];
    this.counts.forEach((c, i) => {
      if (c === max) best.push(i);
    });
    return best[Math.min(best.length - 1, Math.floor(rng() * best.length))] as number;
  }
}
