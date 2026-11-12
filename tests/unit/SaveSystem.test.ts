import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultConfig } from '../../src/config/gameConfig';
import { SaveSystem, type StorageLike } from '../../src/save/SaveSystem';
import { defaultProfile, type ProfileData } from '../../src/reward/types';

const KEY = defaultConfig.save.key;
const BACKUP = defaultConfig.save.backupKey;
const DEFAULTS = ['a', 'b'];

class MemStorage implements StorageLike {
  data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
}
const good = (over: Partial<ProfileData> = {}): ProfileData => ({ ...defaultProfile(DEFAULTS), score: 500, coins: 40, xp: 90, rounds: 7, collection: { a: 4, b: 3 }, unlocked: ['a', 'b', 'c'], ...over });
const mk = (storage: StorageLike | null, known?: string[]) => new SaveSystem(defaultConfig, storage, DEFAULTS, known);

describe('SaveSystem', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it('round-trips a profile', () => {
    const st = new MemStorage();
    expect(mk(st).save(good())).toBe(true);
    expect(mk(st).load()).toEqual(good());
  });

  it('empty storage gives defaults', () => {
    expect(mk(new MemStorage()).load()).toEqual(defaultProfile(DEFAULTS));
  });

  it('null storage (unavailable) gives defaults and save returns false without throwing', () => {
    const s = mk(null);
    expect(s.load()).toEqual(defaultProfile(DEFAULTS));
    expect(s.save(good())).toBe(false);
  });

  it('corrupt JSON gives defaults and the blob is kept under the backup key', () => {
    const st = new MemStorage();
    st.setItem(KEY, '{not json');
    expect(mk(st).load()).toEqual(defaultProfile(DEFAULTS));
    expect(st.getItem(BACKUP)).toBe('{not json');
  });

  it.each([['null', 'null'], ['array', '[]'], ['number', '5'], ['string', '"x"']])('non-object root (%s) gives defaults', (_n, raw) => {
    const st = new MemStorage();
    st.setItem(KEY, raw);
    expect(mk(st).load()).toEqual(defaultProfile(DEFAULTS));
    expect(st.getItem(BACKUP)).toBe(raw);
  });

  it('an unknown version gives defaults and is backed up', () => {
    const st = new MemStorage();
    const raw = JSON.stringify({ ...good(), version: 99 });
    st.setItem(KEY, raw);
    expect(mk(st).load()).toEqual(defaultProfile(DEFAULTS));
    expect(st.getItem(BACKUP)).toBe(raw);
  });

  it('sanitizes wrong types, negative, NaN-like and huge numbers field by field', () => {
    const st = new MemStorage();
    st.setItem(KEY, JSON.stringify({ version: 1, score: '999', coins: -5, xp: 1e30, rounds: null, collection: { a: 'x', b: 2, c: -1 }, unlocked: ['c', 5, null] }));
    const p = mk(st).load();
    expect(p.score).toBe(0);
    expect(p.coins).toBe(0);
    expect(p.xp).toBe(1e12);
    expect(p.rounds).toBe(0);
    expect(p.collection).toEqual({ a: 0, b: 2, c: 0 });
    expect(p.unlocked).toEqual(expect.arrayContaining(['a', 'b', 'c']));
    expect(p.unlocked.every((u) => typeof u === 'string')).toBe(true);
  });

  it('default-unlocked desserts are always present; duplicates removed', () => {
    const st = new MemStorage();
    st.setItem(KEY, JSON.stringify({ ...good(), unlocked: ['c', 'c'] }));
    const p = mk(st).load();
    expect(p.unlocked.sort()).toEqual(['a', 'b', 'c']);
  });

  it('drops unknown dessert ids when the known list is given', () => {
    const st = new MemStorage();
    st.setItem(KEY, JSON.stringify({ ...good(), unlocked: ['a', 'zzz'], collection: { a: 1, zzz: 9 } }));
    const p = mk(st, ['a', 'b', 'c']).load();
    expect(p.unlocked).not.toContain('zzz');
    expect(p.collection).toEqual({ a: 1 });
  });

  it('getItem throwing gives defaults', () => {
    const st = new MemStorage();
    st.getItem = () => { throw new Error('denied'); };
    expect(mk(st).load()).toEqual(defaultProfile(DEFAULTS));
  });

  it('setItem throwing (quota) returns false and never throws', () => {
    const st = new MemStorage();
    st.setItem = () => { throw new Error('QuotaExceededError'); };
    expect(mk(st).save(good())).toBe(false);
  });

  it('a failing backup write does not break load', () => {
    const st = new MemStorage();
    st.setItem(KEY, '{bad');
    const real = st.setItem.bind(st);
    st.setItem = (k, v) => { if (k === BACKUP) throw new Error('full'); real(k, v); };
    expect(mk(st).load()).toEqual(defaultProfile(DEFAULTS));
  });

  it('skips writes when nothing changed and writes again after a change', () => {
    const st = new MemStorage();
    const spy = vi.spyOn(st, 'setItem');
    const s = mk(st);
    s.save(good());
    s.save(good());
    expect(spy).toHaveBeenCalledTimes(1);
    s.save(good({ coins: 41 }));
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('a failed save is retried on the next call', () => {
    const st = new MemStorage();
    let fail = true;
    const real = st.setItem.bind(st);
    st.setItem = (k, v) => { if (fail) throw new Error('x'); real(k, v); };
    const s = mk(st);
    expect(s.save(good())).toBe(false);
    fail = false;
    expect(s.save(good())).toBe(true);
    expect(mk(st).load()).toEqual(good());
  });
});
