import { readFileSync, writeFileSync } from 'node:fs';
import { DEFAULT_GIFT_BOARD, cleanGiftName, giftKey, parseGiftBoard, type GiftSlot } from '../src/cafe/giftBoard';

export interface GiftMeta {
  giftName: string;
  user?: string;
  avatarUrl?: string;
  repeat: number;
  diamonds: number;
}

export interface GiftEntry {
  id: string;
  atMs: number;
  user: string;
  avatarUrl: string;
  gift: string;
  repeat: number;
  diamonds: number;
  /** The menu slot (coins tier) this gift is mapped to, or null when it is not on the board. */
  tier: number | null;
  /** Sent to the game (automatically or by the Play button). */
  played: boolean;
  /** The event that goes to the game. */
  event: Record<string, unknown>;
}

const MAX_LOG = 200;

/**
 * Keeps the list of gifts that arrived, the gift -> menu slot board and the Auto / Manual switch. Pure bookkeeping (plus an
 * optional settings file); never throws on bad input. A gift that is not on the board still plays, using its diamond value
 * (the old behaviour), so an unknown gift can never break anything.
 */
export class GiftDesk {
  board: GiftSlot[] = DEFAULT_GIFT_BOARD.map((s) => ({ ...s }));
  auto = true;
  private log: GiftEntry[] = [];
  private seen = new Set<string>();

  constructor(
    private readonly validCoins: readonly number[],
    private readonly file: string | null = null,
    private readonly now: () => number = Date.now,
  ) {
    this.load();
  }

  tierFor(giftName: string): number | null {
    const k = giftKey(giftName);
    if (k === '') return null;
    const slot = this.board.find((s) => s.gift !== '' && giftKey(s.gift) === k);
    return slot ? slot.coins : null;
  }

  /** Adds a gift to the log. Returns null for a duplicate id. */
  record(event: Record<string, unknown>, meta: GiftMeta): GiftEntry | null {
    const id = typeof event.id === 'string' ? event.id : '';
    if (id === '' || this.seen.has(id)) return null;
    this.seen.add(id);
    if (this.seen.size > 2000) this.seen.delete(this.seen.values().next().value as string);
    const tier = this.tierFor(meta.giftName);
    const base = typeof event.giftCoins === 'number' ? event.giftCoins : meta.diamonds;
    const entry: GiftEntry = {
      id,
      atMs: this.now(),
      user: cleanGiftName(meta.user ?? '').slice(0, 32),
      avatarUrl: typeof meta.avatarUrl === 'string' && /^https:\/\/\S+$/i.test(meta.avatarUrl) && meta.avatarUrl.length <= 512 ? meta.avatarUrl : '',
      gift: cleanGiftName(meta.giftName),
      repeat: Number.isFinite(meta.repeat) ? Math.max(1, Math.floor(meta.repeat)) : 1,
      diamonds: Number.isFinite(meta.diamonds) ? Math.max(0, meta.diamonds) : 0,
      tier,
      played: false,
      event: { ...event, giftCoins: tier ?? base },
    };
    this.log.push(entry);
    if (this.log.length > MAX_LOG) this.log.splice(0, this.log.length - MAX_LOG);
    return entry;
  }

  entries(): readonly GiftEntry[] {
    return this.log;
  }

  /** Marks a gift as played and returns its event (a fresh id, so the game never mistakes it for a duplicate). Null if unknown or already played. */
  play(id: string): Record<string, unknown> | null {
    const e = this.log.find((x) => x.id === id);
    if (!e || e.played) return null;
    e.played = true;
    return { ...e.event, id: `${e.id}-p` };
  }

  setBoard(raw: unknown): boolean {
    const b = parseGiftBoard(raw, this.validCoins);
    if (!b) return false;
    this.board = this.validCoins.map((coins) => b.find((s) => s.coins === coins) ?? { coins, gift: '' });
    // re-map what is already in the log
    for (const e of this.log) {
      e.tier = this.tierFor(e.gift);
      if (e.tier !== null) e.event = { ...e.event, giftCoins: e.tier };
    }
    this.save();
    return true;
  }

  setAuto(on: boolean): void {
    this.auto = on === true;
    this.save();
  }

  private load(): void {
    if (!this.file) return;
    try {
      const j = JSON.parse(readFileSync(this.file, 'utf8')) as { auto?: unknown; board?: unknown };
      const b = parseGiftBoard(j.board, this.validCoins);
      if (b) this.board = this.validCoins.map((coins) => b.find((s) => s.coins === coins) ?? { coins, gift: '' });
      if (typeof j.auto === 'boolean') this.auto = j.auto;
    } catch {
      /* no file yet, or unreadable: defaults */
    }
  }

  private save(): void {
    if (!this.file) return;
    try {
      writeFileSync(this.file, JSON.stringify({ auto: this.auto, board: this.board }, null, 2) + '\n');
    } catch {
      /* cannot save: the settings just do not survive a restart */
    }
  }
}
