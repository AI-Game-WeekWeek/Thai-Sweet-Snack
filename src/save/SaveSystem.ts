import type { GameConfig } from '../config/gameConfig';
import { defaultProfile, type ProfileData } from '../reward/types';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const MAX_NUMBER = 1e12;
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(MAX_NUMBER, v) : 0);

/** Versioned, validated persistence. Never throws and never blocks gameplay; failures degrade to defaults. */
export class SaveSystem {
  private lastSaved: string | null = null;

  constructor(
    private readonly config: GameConfig,
    private readonly storage: StorageLike | null,
    private readonly defaultUnlocked: readonly string[],
    private readonly knownIds?: readonly string[],
  ) {}

  load(): ProfileData {
    const fresh = defaultProfile(this.defaultUnlocked);
    if (!this.storage) return fresh;
    let raw: string | null;
    try {
      raw = this.storage.getItem(this.config.save.key);
    } catch (err) {
      console.warn('[SaveSystem] read failed, starting fresh', err);
      return fresh;
    }
    if (raw === null) return fresh;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return this.rejectCorrupt(raw, fresh);
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return this.rejectCorrupt(raw, fresh);
    const o = parsed as Record<string, unknown>;
    if (o.version !== 1) return this.rejectCorrupt(raw, fresh); // no older versions exist yet: add a migration here when v2 appears

    const profile = this.sanitize(o);
    this.lastSaved = JSON.stringify(profile);
    return profile;
  }

  /** Returns true when the data is persisted (or already was); false on any storage problem. */
  save(profile: ProfileData): boolean {
    if (!this.storage) return false;
    try {
      const json = JSON.stringify(profile);
      if (json === this.lastSaved) return true;
      this.storage.setItem(this.config.save.key, json);
      this.lastSaved = json;
      return true;
    } catch (err) {
      console.warn('[SaveSystem] write failed', err);
      return false;
    }
  }

  private rejectCorrupt(raw: string, fresh: ProfileData): ProfileData {
    console.warn('[SaveSystem] unreadable save, starting fresh (original kept as backup)');
    try {
      this.storage?.setItem(this.config.save.backupKey, raw);
    } catch {
      /* backup is best effort */
    }
    return fresh;
  }

  private sanitize(o: Record<string, unknown>): ProfileData {
    const known = this.knownIds ? new Set(this.knownIds) : null;
    const isKnown = (id: string): boolean => known === null || known.has(id);

    const collection: Record<string, number> = {};
    if (typeof o.collection === 'object' && o.collection !== null && !Array.isArray(o.collection)) {
      for (const [id, v] of Object.entries(o.collection as Record<string, unknown>)) {
        if (isKnown(id)) collection[id] = Math.floor(num(v));
      }
    }
    const unlocked = new Set<string>(this.defaultUnlocked);
    if (Array.isArray(o.unlocked)) {
      for (const id of o.unlocked) if (typeof id === 'string' && isKnown(id)) unlocked.add(id);
    }
    return {
      version: 1,
      score: num(o.score),
      coins: num(o.coins),
      xp: num(o.xp),
      rounds: Math.floor(num(o.rounds)),
      collection,
      unlocked: [...unlocked],
    };
  }
}
