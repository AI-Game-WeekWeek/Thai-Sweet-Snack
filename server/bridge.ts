import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import { isChatterComment, parseLiveEvent } from '../src/tiktok/parseLiveEvent';
import type { LiveEvent } from '../src/tiktok/types';

export interface BridgeOptions {
  /** Shared secret, at least 16 characters. Required for POST /event and for the WebSocket. */
  token: string;
  host?: string;
  port?: number;
  pingMs?: number;
  maxBodyBytes?: number;
  maxBatch?: number;
  maxLikeCount?: number;
  rateLimit?: { max: number; windowMs: number };
}

export interface Bridge {
  start(): Promise<{ port: number }>;
  stop(): Promise<void>;
  /** Validates and broadcasts one event to all connected clients; returns how many clients received it. */
  publish(event: unknown): number;
  readonly clientCount: number;
}

const sha = (s: string): Buffer => createHash('sha256').update(s).digest();
const safeEqual = (a: string, b: string): boolean => timingSafeEqual(sha(a), sha(b));

/**
 * Local relay: authenticated HTTP in (POST /event), WebSocket out. Provider-neutral on purpose:
 * whatever lawful source the streamer uses only has to POST events in the LiveEvent shape.
 */
export function createBridge(opts: BridgeOptions): Bridge {
  if (typeof opts.token !== 'string' || opts.token.length < 16) throw new Error('Bridge token must be at least 16 characters');
  const host = opts.host ?? '127.0.0.1';
  const maxBody = opts.maxBodyBytes ?? 64 * 1024;
  const maxBatch = opts.maxBatch ?? 1000;
  const maxLike = opts.maxLikeCount ?? 1000;
  const limit = opts.rateLimit ?? { max: 120, windowMs: 1000 };
  const windows = new Map<string, { start: number; count: number }>();

  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  const server = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) send(res, 500, { error: 'internal' });
      else res.end();
    });
  });
  let pingTimer: ReturnType<typeof setInterval> | null = null;

  const send = (res: ServerResponse, status: number, body: unknown): void => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  const bearerOk = (req: IncomingMessage): boolean => {
    const h = req.headers.authorization;
    return typeof h === 'string' && h.startsWith('Bearer ') && safeEqual(h.slice(7), opts.token);
  };

  const allowed = (ip: string): boolean => {
    const now = Date.now();
    const w = windows.get(ip);
    if (!w || now - w.start >= limit.windowMs) {
      windows.set(ip, { start: now, count: 1 });
      if (windows.size > 1000) for (const [k, v] of windows) if (now - v.start >= limit.windowMs) windows.delete(k);
      return true;
    }
    w.count++;
    return w.count <= limit.max;
  };

  const broadcast = (payload: string): number => {
    let n = 0;
    for (const c of wss.clients) {
      if (c.readyState === WebSocket.OPEN) {
        c.send(payload);
        n++;
      }
    }
    return n;
  };

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path === '/health') return send(res, 200, { ok: true });
    if (path !== '/event') return send(res, 404, { error: 'not found' });
    if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
    if (!bearerOk(req)) return send(res, 401, { error: 'unauthorized' });
    if (!allowed(req.socket.remoteAddress ?? 'unknown')) return send(res, 429, { error: 'rate limited' });

    let size = 0;
    let tooBig = false;
    const chunks: Buffer[] = [];
    for await (const chunk of req as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > maxBody) {
        tooBig = true;
        if (size > Math.max(maxBody * 16, 1024 * 1024)) {
          req.destroy(); // a client that keeps sending far past the limit is cut off
          return;
        }
        continue; // keep draining so the client can read our 413
      }
      chunks.push(chunk);
    }
    if (tooBig) return send(res, 413, { error: 'body too large' });

    let body: unknown;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      return send(res, 400, { error: 'invalid JSON' });
    }
    const items = Array.isArray(body) ? body : [body];
    if (items.length > maxBatch) return send(res, 413, { error: 'too many events in one request' });

    const valid: LiveEvent[] = [];
    let ignored = 0;
    for (const item of items) {
      const e = parseLiveEvent(item, maxLike);
      if (e) valid.push(e);
      else if (isChatterComment(item)) ignored++; // ordinary chat, not a vote: fine, but not an error the provider should retry
    }
    // 400 only when nothing in the request was understood at all.
    if (valid.length === 0 && ignored === 0) return send(res, 400, { error: 'no valid events', rejected: items.length });
    if (valid.length > 0) broadcast(JSON.stringify(valid));
    send(res, 202, { accepted: valid.length, ignored, rejected: items.length - valid.length - ignored });
  }

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const given = url.searchParams.get('token') ?? '';
    const pathOk = url.pathname === '/' || url.pathname === '/ws';
    if (!pathOk || !(safeEqual(given, opts.token) || bearerOk(req))) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.on('error', () => {}); // oversize or malformed frames only drop that client
      ws.on('message', () => {}); // clients are receive-only
      wss.emit('connection', ws, req);
    });
  });

  return {
    get clientCount() {
      return [...wss.clients].filter((c) => c.readyState === WebSocket.OPEN).length;
    },
    publish(event: unknown): number {
      const e = parseLiveEvent(event, maxLike);
      return e ? broadcast(JSON.stringify([e])) : 0;
    },
    start() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(opts.port ?? 8787, host, () => {
          server.off('error', reject);
          const pingMs = opts.pingMs ?? 15_000;
          pingTimer = setInterval(() => broadcast('{"ping":true}'), pingMs);
          resolve({ port: (server.address() as AddressInfo).port });
        });
      });
    },
    stop() {
      if (pingTimer) clearInterval(pingTimer);
      pingTimer = null;
      for (const c of wss.clients) c.terminate();
      wss.close();
      server.closeAllConnections();
      return new Promise((resolve) => {
        if (!server.listening) return resolve();
        server.close(() => resolve());
      });
    },
  };
}
