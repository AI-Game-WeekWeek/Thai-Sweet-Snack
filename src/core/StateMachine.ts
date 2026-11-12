export type GameState = 'IDLE' | 'PREPARING' | 'COOKING' | 'PRESENTING' | 'REWARDING' | 'NEXT_DESSERT';

/** The only legal transitions. There is deliberately no end state. */
export const TRANSITIONS: Record<GameState, readonly GameState[]> = {
  IDLE: ['PREPARING'],
  PREPARING: ['COOKING'],
  COOKING: ['PRESENTING'],
  PRESENTING: ['REWARDING'],
  REWARDING: ['NEXT_DESSERT'],
  NEXT_DESSERT: ['PREPARING'],
};

type Listener = (from: GameState, to: GameState) => void;

export class StateMachine {
  private current: GameState = 'IDLE';
  private listeners = new Set<Listener>();

  get state(): GameState {
    return this.current;
  }

  canTransition(to: GameState): boolean {
    return TRANSITIONS[this.current].includes(to);
  }

  /** Applies the transition if legal. Illegal moves are logged and ignored. */
  transition(to: GameState): boolean {
    if (!this.canTransition(to)) {
      console.warn(`[StateMachine] rejected ${this.current} -> ${to}`);
      return false;
    }
    const from = this.current;
    this.current = to;
    for (const fn of [...this.listeners]) {
      try {
        fn(from, to);
      } catch (err) {
        console.error('[StateMachine] listener threw', err);
      }
    }
    return true;
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
}
