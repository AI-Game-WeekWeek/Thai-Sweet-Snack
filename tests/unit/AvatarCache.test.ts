import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AvatarCache, type AvatarImage } from '../../src/render/AvatarCache';

class FakeImg implements AvatarImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  released = false;
  constructor(public url: string) {}
  release() { this.released = true; this.onload = this.onerror = null; }
  load() { this.onload?.(); }
  fail() { this.onerror?.(); }
}

function mk(over: Partial<{ hosts: string[]; max: number; timeoutMs: number }> = {}) {
  const imgs: FakeImg[] = [];
  let t = 0;
  const cache = new AvatarCache({ hosts: ['cdn.example.com'], max: 3, timeoutMs: 1000, ...over }, (url) => { const i = new FakeImg(url); imgs.push(i); return i; }, () => t);
  return { cache, imgs, advance: (ms: number) => { t += ms; } };
}
const U = (n: number) => `https://cdn.example.com/p/${n}.jpg`;

describe('AvatarCache', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it('is off while no host is allowed: the loader is never called', () => {
    const { cache, imgs } = mk({ hosts: [] });
    expect(cache.get(U(1))).toBeNull();
    expect(imgs).toHaveLength(0);
  });

  it('returns null while loading and the image once loaded; one load per url', () => {
    const { cache, imgs } = mk();
    expect(cache.get(U(1))).toBeNull();
    expect(cache.get(U(1))).toBeNull();
    expect(imgs).toHaveLength(1);
    imgs[0]!.load();
    expect(cache.get(U(1))).toBe(imgs[0]);
  });

  it('allows the listed host and its subdomains over https only', () => {
    const { cache, imgs } = mk();
    cache.get('https://cdn.example.com/a.jpg');
    cache.get('https://p16.cdn.example.com/a.jpg');
    expect(imgs).toHaveLength(2);
    for (const bad of ['http://cdn.example.com/a.jpg', 'https://evil.com/a.jpg', 'https://cdn.example.com.evil.com/a.jpg', 'https://notcdn.example.com.au/a', 'javascript:alert(1)', 'data:image/png;base64,AAAA', 'ftp://cdn.example.com/a', '//cdn.example.com/a', 'not a url', '', 'https://user:pw@cdn.example.com/a.jpg']) {
      expect(cache.get(bad), bad).toBeNull();
    }
    expect(imgs).toHaveLength(2);
  });

  it('rejects absurdly long urls and non-string input', () => {
    const { cache, imgs } = mk();
    expect(cache.get(`https://cdn.example.com/${'a'.repeat(600)}`)).toBeNull();
    expect(cache.get(null)).toBeNull();
    expect(cache.get(undefined as never)).toBeNull();
    expect(imgs).toHaveLength(0);
  });

  it('a failed load is remembered (no retry storm) and returns null', () => {
    const { cache, imgs } = mk();
    cache.get(U(1));
    imgs[0]!.fail();
    expect(cache.get(U(1))).toBeNull();
    expect(imgs).toHaveLength(1);
  });

  it('a load that takes longer than the timeout is abandoned and released', () => {
    const { cache, imgs, advance } = mk();
    cache.get(U(1));
    advance(999);
    expect(cache.get(U(1))).toBeNull();
    expect(imgs[0]!.released).toBe(false);
    advance(2);
    expect(cache.get(U(1))).toBeNull();
    expect(imgs[0]!.released).toBe(true);
    imgs[0]!.load(); // a late load after the timeout must not resurrect it
    expect(cache.get(U(1))).toBeNull();
  });

  it('stays bounded: the oldest entries are evicted and released', () => {
    const { cache, imgs } = mk({ max: 3 });
    for (let i = 0; i < 50; i++) { cache.get(U(i)); imgs[i]!.load(); }
    expect(cache.size).toBeLessThanOrEqual(3);
    expect(imgs.filter((i) => !i.released)).toHaveLength(3);
    expect(imgs[0]!.released).toBe(true);
    expect(cache.get(U(49))).toBe(imgs[49]);
  });

  it('recently used entries survive eviction (LRU)', () => {
    const { cache, imgs } = mk({ max: 3 });
    for (let i = 0; i < 3; i++) { cache.get(U(i)); imgs[i]!.load(); }
    cache.get(U(0)); // touch the oldest
    cache.get(U(3));
    expect(imgs[0]!.released).toBe(false);
    expect(imgs[1]!.released).toBe(true);
  });

  it('a throwing loader is handled', () => {
    const cache = new AvatarCache({ hosts: ['cdn.example.com'], max: 3, timeoutMs: 1000 }, () => { throw new Error('boom'); }, () => 0);
    expect(cache.get(U(1))).toBeNull();
    expect(cache.get(U(1))).toBeNull();
  });

  it('clear releases everything', () => {
    const { cache, imgs } = mk();
    cache.get(U(1)); cache.get(U(2));
    cache.clear();
    expect(cache.size).toBe(0);
    expect(imgs.every((i) => i.released)).toBe(true);
  });
});
