import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { isChatterComment, parseLiveEvent } from '../src/tiktok/parseLiveEvent';
import { TikFinityAdapter } from '../src/tiktok/adapters/tikfinity';
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
  /** If set, this folder (the built game, dist/) is served at / so the game and the bridge share one address. */
  staticDir?: string;
}

export interface Bridge {
  start(): Promise<{ port: number }>;
  stop(): Promise<void>;
  /** Validates and broadcasts one event to all connected clients; returns how many clients received it. */
  publish(event: unknown): number;
  readonly clientCount: number;
  /** Feed a raw TikFinity-style message (from the websocket client or webhook) through the adapter. Returns events published. */
  ingestTikFinity(message: unknown): number;
  /** Counters shown on the /monitor page. */
  stats(): MonitorStats;
  /** Marks the state of the link to the event source (shown on /monitor). */
  setSourceState(state: string): void;
}

export interface MonitorStats {
  startedMs: number;
  clients: number;
  source: string;
  received: Record<string, number>;
  lastEvents: { atMs: number; type: string; count?: number; giftCoins?: number }[];
  /** Which message kinds arrived from the source and the field NAMES they had (never values). */
  seenMessages: Record<string, string[]>;
  dropped: number;
}

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };

const MONITOR_HTML = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ตรวจสอบอีเวนต์</title>
<style>body{font:15px/1.5 system-ui,sans-serif;background:#1c1511;color:#f4e6d3;margin:0;padding:16px;max-width:760px}h1{font-size:20px}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #46352a;padding:4px 8px;text-align:left}.ok{color:#7ddc8c}.no{color:#ff8a8a}code{background:#34271d;padding:0 4px;border-radius:4px}</style>
<h1>ตรวจสอบอีเวนต์จาก TikTok</h1><p id=s>กำลังโหลด…</p><h2>นับตามชนิด</h2><table id=c></table><h2>30 อีเวนต์ล่าสุด</h2><table id=l></table><h2>ข้อความที่เข้ามา (ชื่อฟิลด์เท่านั้น ไม่มีค่า)</h2><table id=m></table>
<script>const q=new URLSearchParams(location.search).get('token')||'';
async function tick(){try{const r=await fetch('/monitor.json?token='+encodeURIComponent(q));if(!r.ok)throw 0;const j=await r.json();
document.getElementById('s').innerHTML='เกมต่ออยู่ <b class="'+(j.clients>0?'ok':'no')+'">'+j.clients+'</b> หน้า · แหล่งอีเวนต์: <b>'+j.source+'</b> · ทิ้งข้อมูลที่ไม่เข้าใจ '+j.dropped+' ครั้ง';
const kinds=['gift','rose','like','follow','share','orangeHeart','comment'];
document.getElementById('c').innerHTML=kinds.map(k=>'<tr><td>'+k+'</td><td class="'+(j.received[k]?'ok':'no')+'">'+(j.received[k]||0)+'</td></tr>').join('');
document.getElementById('l').innerHTML=j.lastEvents.slice().reverse().map(e=>'<tr><td>'+new Date(e.atMs).toLocaleTimeString()+'</td><td>'+e.type+'</td><td>'+(e.count||'')+'</td><td>'+(e.giftCoins??'')+'</td></tr>').join('');
document.getElementById('m').innerHTML=Object.entries(j.seenMessages).map(([k,v])=>'<tr><td>'+k+'</td><td><code>'+v.join('</code> <code>')+'</code></td></tr>').join('');}catch(e){document.getElementById('s').textContent='เปิดหน้านี้ด้วยลิงก์ที่มี ?token=... ที่โปรแกรมแสดงให้';}}
tick();setInterval(tick,1000);</script>`;

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
  const adapter = new TikFinityAdapter();
  const stats: MonitorStats = { startedMs: Date.now(), clients: 0, source: 'ยังไม่มีข้อมูลเข้า', received: {}, lastEvents: [], seenMessages: {}, dropped: 0 };
  const staticRoot = opts.staticDir ? resolve(opts.staticDir) : null;

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

  const note = (list: readonly LiveEvent[]): void => {
    for (const e of list) {
      stats.received[e.type] = (stats.received[e.type] ?? 0) + 1;
      stats.lastEvents.push({ atMs: Date.now(), type: e.type, ...(e.count > 1 ? { count: e.count } : {}), ...(e.giftCoins !== undefined ? { giftCoins: e.giftCoins } : {}) });
    }
    if (stats.lastEvents.length > 30) stats.lastEvents.splice(0, stats.lastEvents.length - 30);
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
    if (path === '/monitor' || path === '/monitor.json') {
      const t = new URL(req.url ?? '/', 'http://localhost').searchParams.get('token') ?? '';
      if (!(safeEqual(t, opts.token) || bearerOk(req))) return send(res, 401, { error: 'unauthorized' });
      stats.clients = [...wss.clients].filter((c) => c.readyState === WebSocket.OPEN).length;
      if (path === '/monitor.json') return send(res, 200, stats);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return void res.end(MONITOR_HTML);
    }
    if (path === '/tikfinity') return handleTikFinity(req, res);
    if (path !== '/event') return serveStatic(req, res, path);
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
    if (valid.length > 0) {
      note(valid);
      broadcast(JSON.stringify(valid));
    }
    send(res, 202, { accepted: valid.length, ignored, rejected: items.length - valid.length - ignored });
  }

  /** TikFinity (or similar) posts its messages here; the token may be in the URL because such tools often cannot set headers. */
  async function handleTikFinity(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST' && req.method !== 'GET') return send(res, 405, { error: 'method not allowed' });
    const u = new URL(req.url ?? '/', 'http://localhost');
    if (!(safeEqual(u.searchParams.get('token') ?? '', opts.token) || bearerOk(req))) return send(res, 401, { error: 'unauthorized' });
    if (!allowed(req.socket.remoteAddress ?? 'unknown')) return send(res, 429, { error: 'rate limited' });
    let body: unknown = null;
    if (req.method === 'POST') {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req as AsyncIterable<Buffer>) {
        size += chunk.length;
        if (size > maxBody) return send(res, 413, { error: 'body too large' });
        chunks.push(chunk);
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        body = JSON.parse(raw);
      } catch {
        // a form-style body (a=1&b=2) is accepted too
        body = Object.fromEntries(new URLSearchParams(raw));
      }
    } else {
      body = Object.fromEntries(u.searchParams.entries());
      delete (body as Record<string, unknown>).token;
    }
    const items = Array.isArray(body) ? body : [body];
    if (items.length > maxBatch) return send(res, 413, { error: 'too many events in one request' });
    let published = 0;
    for (const item of items) published += ingest(item);
    send(res, 202, { accepted: published });
  }

  function ingest(message: unknown): number {
    // remember only the message kind and its field NAMES (never values) for the /monitor page
    if (typeof message === 'object' && message !== null && !Array.isArray(message)) {
      const m = message as Record<string, unknown>;
      const kind = String(m.event ?? m.type ?? m.eventName ?? m.action ?? '?').slice(0, 24);
      const d = typeof m.data === 'object' && m.data !== null ? (m.data as Record<string, unknown>) : m;
      if (Object.keys(stats.seenMessages).length < 40) stats.seenMessages[kind] = Object.keys(d).slice(0, 40);
    }
    stats.source = 'มีข้อมูลเข้า ' + new Date().toLocaleTimeString('th-TH');
    const converted = adapter.convert(message);
    const valid: LiveEvent[] = [];
    for (const raw of converted) {
      const e = parseLiveEvent(raw, maxLike);
      if (e) valid.push(e);
      else stats.dropped++;
    }
    if (converted.length === 0) stats.dropped++;
    if (valid.length > 0) {
      note(valid);
      broadcast(JSON.stringify(valid));
    }
    return valid.length;
  }

  async function serveStatic(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    if (!staticRoot || (req.method !== 'GET' && req.method !== 'HEAD')) return send(res, 404, { error: 'not found' });
    // /live.html = the game with the token built in, so the address has no ?query at all (TikTok LIVE Studio's Link field
    // rejects some URLs). The bridge only listens on this computer, and other web pages cannot read this response.
    if (path === '/live.html') {
      try {
        const html = await readFile(join(staticRoot, 'index.html'), 'utf8');
        const inject = `<script>window.__BRIDGE_TOKEN__=${JSON.stringify(opts.token)};</script>`;
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'SAMEORIGIN' });
        return void res.end(req.method === 'HEAD' ? undefined : html.replace('<head>', () => `<head>${inject}`));
      } catch {
        return send(res, 404, { error: 'not found' });
      }
    }
    let rel = '';
    try {
      rel = decodeURIComponent(path);
    } catch {
      return send(res, 400, { error: 'bad path' });
    }
    if (rel.includes('\0')) return send(res, 400, { error: 'bad path' });
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = normalize(join(staticRoot, rel));
    if (file !== staticRoot && !file.startsWith(staticRoot + sep)) return send(res, 404, { error: 'not found' }); // no ../ escapes
    try {
      const st = await stat(file);
      if (!st.isFile()) return send(res, 404, { error: 'not found' });
      const data = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch {
      send(res, 404, { error: 'not found' });
    }
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
      if (e) note([e]);
      return e ? broadcast(JSON.stringify([e])) : 0;
    },
    ingestTikFinity: ingest,
    stats: () => ({ ...stats, clients: [...wss.clients].filter((c) => c.readyState === WebSocket.OPEN).length }),
    setSourceState(state: string) {
      stats.source = state;
    },
    start() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(opts.port ?? 8787, host, () => {
          server.off('error', reject);
          const pingMs = opts.pingMs ?? 15_000;
          pingTimer = setInterval(() => {
            broadcast('{"ping":true}');
            for (const raw of adapter.flush()) {
              const e = parseLiveEvent(raw, maxLike);
              if (e) {
                note([e]);
                broadcast(JSON.stringify([e]));
              }
            }
          }, Math.min(pingMs, 1000));
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
