/** A picture being loaded. `source` is what the renderer draws once `ready`. */
export interface AvatarImage {
  onload: (() => void) | null;
  onerror: (() => void) | null;
  release(): void;
  source?: CanvasImageSource;
}

export interface AvatarCacheOptions {
  /** Remote pictures are OFF while this is empty. Subdomains of a listed host are allowed. */
  hosts: readonly string[];
  max: number;
  timeoutMs: number;
}

interface Entry {
  img: AvatarImage;
  state: 'loading' | 'ready' | 'failed';
  started: number;
}

const MAX_URL = 512;

/**
 * Bounded cache of viewer profile pictures. https only, allowlisted hosts only, a timeout per load, least-recently-used
 * eviction that releases the image, and failures are remembered (no retry storm). Anything unusual yields null so the
 * caller draws a generated avatar instead.
 */
export class AvatarCache {
  private readonly map = new Map<string, Entry>();

  constructor(
    private readonly opts: AvatarCacheOptions,
    private readonly load: (url: string) => AvatarImage = defaultLoad,
    private readonly now: () => number = () => performance.now(),
  ) {}

  get size(): number {
    return this.map.size;
  }

  /** The loaded picture, or null (not allowed, still loading, failed, timed out). Starts the load on first use. */
  get(url: string | null | undefined): AvatarImage | null {
    if (typeof url !== 'string' || !this.allowed(url)) return null;
    let entry = this.map.get(url);
    if (!entry) {
      entry = this.start(url);
    } else {
      this.map.delete(url); // refresh recency
      this.map.set(url, entry);
    }
    if (entry.state === 'loading' && this.now() - entry.started > this.opts.timeoutMs) this.fail(entry);
    return entry.state === 'ready' ? entry.img : null;
  }

  clear(): void {
    for (const e of this.map.values()) this.safeRelease(e.img);
    this.map.clear();
  }

  private start(url: string): Entry {
    let img: AvatarImage;
    try {
      img = this.load(url);
    } catch (err) {
      console.warn('[AvatarCache] loader failed', err);
      img = { onload: null, onerror: null, release() {} };
      const dead: Entry = { img, state: 'failed', started: this.now() };
      this.insert(url, dead);
      return dead;
    }
    const entry: Entry = { img, state: 'loading', started: this.now() };
    img.onload = () => {
      if (entry.state === 'loading') entry.state = 'ready';
    };
    img.onerror = () => this.fail(entry);
    this.insert(url, entry);
    return entry;
  }

  private insert(url: string, entry: Entry): void {
    this.map.set(url, entry);
    while (this.map.size > this.opts.max) {
      const oldest = this.map.keys().next().value as string;
      const e = this.map.get(oldest);
      this.map.delete(oldest);
      if (e) this.safeRelease(e.img);
    }
  }

  private fail(entry: Entry): void {
    entry.state = 'failed';
    this.safeRelease(entry.img);
  }

  private safeRelease(img: AvatarImage): void {
    try {
      img.release();
    } catch {
      /* already released */
    }
  }

  private allowed(url: string): boolean {
    if (this.opts.hosts.length === 0 || url.length === 0 || url.length > MAX_URL) return false;
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return false;
    }
    if (u.protocol !== 'https:' || u.username !== '' || u.password !== '') return false;
    const host = u.hostname.toLowerCase();
    return this.opts.hosts.some((h) => host === h.toLowerCase() || host.endsWith(`.${h.toLowerCase()}`));
  }
}

function defaultLoad(url: string): AvatarImage {
  const el = new Image();
  const wrapper: AvatarImage = {
    onload: null,
    onerror: null,
    source: el,
    release() {
      el.onload = el.onerror = null;
      el.src = '';
    },
  };
  el.onload = () => wrapper.onload?.();
  el.onerror = () => wrapper.onerror?.();
  el.referrerPolicy = 'no-referrer';
  el.decoding = 'async';
  el.src = url;
  return wrapper;
}
