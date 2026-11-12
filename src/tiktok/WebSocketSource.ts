import type { ConnectionState } from './types';

/** The slice of the browser WebSocket we use (also what tests fake). */
export interface WsLike {
  onopen: (() => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  readonly readyState: number;
  close(): void;
}

export interface WebSocketSourceOptions {
  url: string;
  /** Receives every decoded message (single object or each array element). Validation happens downstream in ingest(). */
  sink: (raw: unknown) => void;
  onState: (s: ConnectionState) => void;
  create?: (url: string) => WsLike;
  /** No message (not even a ping) for this long means a half-open socket: reconnect. */
  heartbeatMs?: number;
  backoff?: { minMs: number; maxMs: number };
  rng?: () => number;
  maxMessageBytes?: number;
}

const STABLE_AFTER_MS = 10_000;

/** Connects to the local bridge. Reconnects forever with backoff; a dead bridge only changes the displayed state. */
export class WebSocketSource {
  private running = false;
  private socket: WsLike | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private stableTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;

  private readonly heartbeatMs: number;
  private readonly minMs: number;
  private readonly maxMs: number;
  private readonly maxBytes: number;
  private readonly rng: () => number;

  constructor(private readonly opts: WebSocketSourceOptions) {
    this.heartbeatMs = opts.heartbeatMs ?? 45_000;
    this.minMs = opts.backoff?.minMs ?? 1000;
    this.maxMs = opts.backoff?.maxMs ?? 30_000;
    this.maxBytes = opts.maxMessageBytes ?? 64 * 1024;
    this.rng = opts.rng ?? Math.random;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.connect();
  }

  stop(): void {
    this.running = false;
    this.clearTimers();
    const s = this.socket;
    this.socket = null;
    if (s) {
      s.onopen = s.onmessage = s.onclose = s.onerror = null;
      try {
        s.close();
      } catch {
        /* already closed */
      }
    }
    this.opts.onState('offline');
  }

  private connect(): void {
    if (!this.running || this.socket) return;
    this.opts.onState('reconnecting');
    let sock: WsLike;
    try {
      sock = (this.opts.create ?? defaultCreate)(this.opts.url);
    } catch (err) {
      console.warn('[WebSocketSource] cannot create socket', err);
      this.scheduleReconnect();
      return;
    }
    this.socket = sock;
    sock.onopen = () => {
      if (sock !== this.socket) return;
      this.opts.onState('connected');
      this.armHeartbeat();
      this.stableTimer = setTimeout(() => (this.attempt = 0), STABLE_AFTER_MS);
    };
    sock.onmessage = (e) => {
      if (sock !== this.socket) return;
      this.armHeartbeat();
      this.handle(e.data);
    };
    sock.onclose = () => this.lost(sock);
    sock.onerror = () => {
      try {
        sock.close();
      } catch {
        /* ignore */
      }
      this.lost(sock);
    };
  }

  private handle(data: unknown): void {
    if (typeof data !== 'string' || data.length > this.maxBytes) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) && (parsed as { ping?: unknown }).ping === true) return;
    for (const item of Array.isArray(parsed) ? parsed : [parsed]) {
      try {
        this.opts.sink(item);
      } catch (err) {
        console.error('[WebSocketSource] sink threw', err);
      }
    }
  }

  private armHeartbeat(): void {
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = setTimeout(() => {
      const sock = this.socket;
      if (!sock) return;
      console.warn('[WebSocketSource] heartbeat timeout, reconnecting');
      try {
        sock.close();
      } catch {
        /* ignore */
      }
      this.lost(sock);
    }, this.heartbeatMs);
  }

  private lost(sock: WsLike): void {
    if (sock !== this.socket) return; // stale event from an old socket
    this.socket = null;
    sock.onopen = sock.onmessage = sock.onclose = sock.onerror = null;
    this.clearTimers();
    if (!this.running) return;
    this.opts.onState('reconnecting');
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (!this.running || this.reconnectTimer) return;
    const step = Math.min(this.maxMs, this.minMs * 2 ** this.attempt);
    this.attempt = Math.min(this.attempt + 1, 30);
    const delay = step * (0.5 + 0.5 * this.rng());
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private clearTimers(): void {
    for (const t of [this.reconnectTimer, this.heartbeatTimer, this.stableTimer]) if (t) clearTimeout(t);
    this.reconnectTimer = this.heartbeatTimer = this.stableTimer = null;
  }
}

function defaultCreate(url: string): WsLike {
  if (typeof WebSocket === 'undefined') throw new Error('WebSocket is not available');
  return new WebSocket(url) as unknown as WsLike;
}
