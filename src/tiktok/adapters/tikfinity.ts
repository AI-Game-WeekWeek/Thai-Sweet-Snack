/**
 * Turns messages from a TikTok LIVE listener (TikFinity's event stream or webhook, or any connector that uses the
 * common community field names: nickname, profilePictureUrl, giftName, diamondCount, repeatCount, repeatEnd, likeCount,
 * comment ...) into the game's neutral LiveEvent objects. It is tolerant on purpose and NEVER throws: anything it does
 * not understand is dropped. The exact field names of a real TikFinity feed are not verified; the bridge's /monitor page
 * shows which messages arrived and which fields they had, so a mismatch is quick to find.
 */
const MAX_LIKES = 1000;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};
const str = (v: unknown, max = 200): string | undefined => (typeof v === 'string' && v.length > 0 ? v.slice(0, max) : undefined);
const pick = (o: Obj, keys: readonly string[]): unknown => {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k];
  return undefined;
};

interface Streak {
  base: Obj;
  coins: number;
  repeat: number;
  lastMs: number;
}

export interface AdapterOptions {
  /** A gift streak that gets no end message is sent after this many ms of silence. */
  streakIdleMs?: number;
  now?: () => number;
}

export class TikFinityAdapter {
  private seq = 0;
  private readonly streaks = new Map<string, Streak>();
  private readonly idleMs: number;
  private readonly now: () => number;

  constructor(opts: AdapterOptions = {}) {
    this.idleMs = opts.streakIdleMs ?? 4000;
    this.now = opts.now ?? Date.now;
  }

  get openStreaks(): number {
    return this.streaks.size;
  }

  private id(o: Obj, kind: string): string {
    const m = str(pick(o, ['msgId', 'eventId', 'id']), 64);
    return m ? `tf-${kind}-${m}` : `tf-${kind}-${this.now()}-${++this.seq}`;
  }

  /** Status messages the game has no use for (not an error, so the monitor does not count them as dropped). */
  static isStatus(message: unknown): boolean {
    if (typeof message !== 'object' || message === null) return false;
    const m = message as Record<string, unknown>;
    const raw = m.event ?? m.type ?? m.eventName ?? m.action;
    const name = typeof raw === 'string' ? raw.toLowerCase().replace(/[^a-z]/g, '') : '';
    return ['config', 'livestatuschange', 'roomuser', 'ping', 'pong', 'streamend', 'roomstats'].includes(name);
  }

  /** One incoming message -> zero or more LiveEvents (raw objects; the bridge validates them again). Never throws. */
  convert(message: unknown): Obj[] {
    try {
      return this.convertInner(message);
    } catch {
      return [];
    }
  }

  private convertInner(message: unknown): Obj[] {
    if (!isObj(message)) return [];
    const nameRaw = pick(message, ['event', 'type', 'eventName', 'action']);
    const name = typeof nameRaw === 'string' ? nameRaw.toLowerCase().replace(/[^a-z]/g, '') : '';
    const d: Obj = isObj(message.data) ? message.data : message;
    const out: Obj[] = [];
    const ts = this.now();
    switch (name) {
      case 'gift':
      case 'giftevent':
        return this.gift(d, ts);
      case 'like':
      case 'likes':
      case 'tap': {
        const c = Math.min(MAX_LIKES, Math.max(1, Math.floor(num(pick(d, ['likeCount', 'count', 'likes'])) ?? 1)));
        out.push({ id: this.id(d, 'like'), type: 'like', count: c, tsMs: ts });
        return out;
      }
      case 'join':
      case 'joined':
      case 'member':
      case 'memberjoin': {
        const nick = str(pick(d, ['nickname', 'displayName', 'uniqueId']), 60);
        const avatar = str(pick(d, ['profilePictureUrl', 'avatarUrl', 'profilePicture']), 500);
        if (!nick) return out; // a join with no name cannot become a named customer
        out.push({ id: this.id(d, 'join'), type: 'join', displayName: nick, ...(avatar ? { avatarUrl: avatar } : {}), tsMs: ts });
        return out;
      }
      case 'follow':
      case 'followed':
        out.push({ id: this.id(d, 'follow'), type: 'follow', tsMs: ts });
        return out;
      case 'share':
      case 'shared':
        out.push({ id: this.id(d, 'share'), type: 'share', tsMs: ts });
        return out;
      case 'subscribe':
      case 'subscription':
      case 'superfan':
      case 'sub':
      case 'fanclub':
      case 'orangeheart':
        out.push({ id: this.id(d, 'heart'), type: 'orangeHeart', tsMs: ts });
        return out;
      case 'chat':
      case 'comment':
      case 'message': {
        const text = str(pick(d, ['comment', 'text', 'message']), 200);
        if (text === undefined) return out;
        const uid = str(String(pick(d, ['userId', 'uniqueId', 'secUid']) ?? ''), 64);
        out.push({ id: this.id(d, 'chat'), type: 'comment', text, ...(uid ? { userId: uid } : {}), tsMs: ts });
        return out;
      }
      default:
        return out; // join, room stats, emotes and so on: the game has no use for them
    }
  }

  private gift(d: Obj, ts: number): Obj[] {
    const each = Math.max(0, num(pick(d, ['diamondCount', 'giftValue', 'diamonds', 'coins', 'giftCoins'])) ?? 1);
    const repeat = Math.max(1, Math.floor(num(pick(d, ['repeatCount', 'count', 'amount'])) ?? 1));
    const total = Math.min(1_000_000, each * repeat);
    const uid = String(pick(d, ['userId', 'uniqueId']) ?? 'anon');
    const key = `${uid}:${String(pick(d, ['giftId', 'giftName']) ?? '')}`;
    const streakable = num(d.giftType) === 1; // gifts that can be sent in a row (e.g. Rose)
    const ended = d.repeatEnd === true || d.repeatEnd === 1 || d.repeatEnd === 'true';
    if (streakable && !ended) {
      // still counting: hold it, and send one event with the total when the streak ends
      this.streaks.set(key, { base: d, coins: total, repeat, lastMs: ts });
      if (this.streaks.size > 500) this.streaks.delete(this.streaks.keys().next().value as string);
      return [];
    }
    this.streaks.delete(key);
    return [this.giftEvent(d, total, ts)];
  }

  private giftEvent(d: Obj, coins: number, ts: number): Obj {
    const gname = str(pick(d, ['giftName', 'name']), 40) ?? '';
    const isRose = /^rose$|กุหลาบ/i.test(gname);
    const nick = str(pick(d, ['nickname', 'displayName', 'uniqueId']), 60);
    const avatar = str(pick(d, ['profilePictureUrl', 'avatarUrl', 'profilePicture']), 500);
    const rep = Math.max(1, Math.floor(num(pick(d, ['repeatCount', 'count', 'amount'])) ?? 1));
    const each = Math.max(0, num(pick(d, ['diamondCount', 'giftValue', 'diamonds', 'coins', 'giftCoins'])) ?? 1);
    return {
      id: this.id(d, 'gift'),
      type: isRose ? 'rose' : 'gift',
      giftCoins: coins,
      // extras for the streamer's gift page (the game's validator drops them)
      meta: { giftName: gname, user: nick ?? '', avatarUrl: avatar ?? '', repeat: rep, diamonds: each * rep },
      ...(nick ? { displayName: nick } : {}),
      ...(avatar ? { avatarUrl: avatar } : {}),
      tsMs: ts,
    };
  }

  /** Sends streaks that never got an end message. Call about once a second. */
  flush(nowMs: number = this.now()): Obj[] {
    const out: Obj[] = [];
    for (const [k, s] of this.streaks) {
      if (nowMs - s.lastMs >= this.idleMs) {
        out.push(this.giftEvent(s.base, s.coins, nowMs));
        this.streaks.delete(k);
      }
    }
    return out;
  }
}
