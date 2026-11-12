import { afterEach, describe, expect, it, vi } from 'vitest';
import { StateMachine, TRANSITIONS, type GameState } from '../../src/core/StateMachine';

const ALL = Object.keys(TRANSITIONS) as GameState[];

function machineAt(target: GameState): StateMachine {
  const m = new StateMachine();
  const path: GameState[] = ['PREPARING', 'COOKING', 'PRESENTING', 'REWARDING', 'NEXT_DESSERT'];
  for (const s of path) {
    if (m.state === target) break;
    expect(m.transition(s)).toBe(true);
  }
  expect(m.state).toBe(target);
  return m;
}

describe('StateMachine', () => {
  afterEach(() => vi.restoreAllMocks());

  it('starts in IDLE', () => {
    expect(new StateMachine().state).toBe('IDLE');
  });

  it('accepts every legal edge', () => {
    for (const from of ALL) {
      for (const to of TRANSITIONS[from]) {
        const m = machineAt(from);
        expect(m.transition(to)).toBe(true);
        expect(m.state).toBe(to);
      }
    }
  });

  it('rejects every pair not in the table and leaves state unchanged', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let rejected = 0;
    for (const from of ALL) {
      for (const to of ALL) {
        if (TRANSITIONS[from].includes(to)) continue;
        const m = machineAt(from);
        expect(m.transition(to)).toBe(false);
        expect(m.state).toBe(from);
        rejected++;
      }
    }
    expect(rejected).toBe(36 - 6);
  });

  it('never allows a way back to IDLE (no end state)', () => {
    for (const from of ALL) expect(TRANSITIONS[from]).not.toContain('IDLE');
  });

  it('keeps transitioning when a listener throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const m = new StateMachine();
    m.onChange(() => {
      throw new Error('boom');
    });
    expect(m.transition('PREPARING')).toBe(true);
    expect(m.state).toBe('PREPARING');
  });

  it('stops notifying after unsubscribe', () => {
    const m = new StateMachine();
    const fn = vi.fn();
    const off = m.onChange(fn);
    m.transition('PREPARING');
    off();
    m.transition('COOKING');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('IDLE', 'PREPARING');
  });
});
