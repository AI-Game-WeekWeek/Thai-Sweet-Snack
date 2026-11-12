import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createBridge } from '../../server/bridge';

const TOKEN = 'test-token-0123456789';
let n = 0;
const ev = (over: Record<string, unknown> = {}) => ({ id: `b${++n}`, type: 'follow', count: 1, tsMs: Date.now(), ...over });

const open: { stop(): Promise<void> }[] = [];
async function boot(opts: Record<string, unknown> = {}) {
  const bridge = createBridge({ token: TOKEN, port: 0, ...opts });
  const { port } = await bridge.start();
  open.push(bridge);
  return { bridge, port, url: `http://127.0.0.1:${port}` };
}
function connect(port: number, token: string | null = TOKEN): Promise<{ ws: WebSocket; msgs: unknown[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/${token === null ? '' : `?token=${token}`}`);
    const msgs: unknown[] = [];
    ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
    ws.on('open', () => resolve({ ws, msgs }));
    ws.on('error', reject);
    ws.on('unexpected-response', (_req, res) => reject(new Error(`status ${res.statusCode}`)));
  });
}
const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${url}/event`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const auth = { authorization: `Bearer ${TOKEN}` };
const until = async (pred: () => boolean, ms = 2000) => { const t = Date.now(); while (!pred() && Date.now() - t < ms) await new Promise((r) => setTimeout(r, 10)); };

afterEach(async () => { while (open.length) await open.pop()!.stop(); });

describe('bridge', () => {
  it('refuses to start without a strong token', () => {
    expect(() => createBridge({ token: '' })).toThrow();
    expect(() => createBridge({ token: 'short' })).toThrow();
  });

  it('GET /health needs no auth', async () => {
    const { url } = await boot();
    expect((await fetch(`${url}/health`)).status).toBe(200);
  });

  it('rejects POST /event without or with a wrong token (401)', async () => {
    const { url } = await boot();
    expect((await post(url, ev())).status).toBe(401);
    expect((await post(url, ev(), { authorization: 'Bearer nope-nope-nope-nope' })).status).toBe(401);
    expect((await post(url, ev(), { authorization: TOKEN })).status).toBe(401);
  });

  it('rejects a WebSocket without or with a wrong token', async () => {
    const { port } = await boot();
    await expect(connect(port, null)).rejects.toThrow();
    await expect(connect(port, 'wrong-wrong-wrong-wrong')).rejects.toThrow();
  });

  it('relays a valid POSTed event to connected clients (202)', async () => {
    const { port, url } = await boot();
    const a = await connect(port);
    const b = await connect(port);
    const e = ev({ type: 'like', count: 7 });
    const res = await post(url, e, auth);
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ accepted: 1, rejected: 0 });
    await until(() => a.msgs.length > 0 && b.msgs.length > 0);
    for (const c of [a, b]) {
      const first = (c.msgs[0] as { id: string }[])[0];
      expect(first).toMatchObject({ id: e.id, type: 'like', count: 7 });
      c.ws.close();
    }
  });

  it('arrays: valid events are relayed, invalid ones are counted as rejected', async () => {
    const { port, url } = await boot();
    const c = await connect(port);
    const res = await post(url, [ev(), { nope: 1 }, ev({ type: 'bogus' }), ev()], auth);
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ accepted: 2, rejected: 2 });
    await until(() => c.msgs.length > 0);
    expect((c.msgs[0] as unknown[]).length).toBe(2);
    c.ws.close();
  });

  it('all-invalid input is a 400 and nothing is broadcast', async () => {
    const { port, url } = await boot();
    const c = await connect(port);
    expect((await post(url, [{ x: 1 }], auth)).status).toBe(400);
    await new Promise((r) => setTimeout(r, 50));
    expect(c.msgs).toHaveLength(0);
    c.ws.close();
  });

  it('non-JSON body is 400', async () => {
    const { url } = await boot();
    expect((await post(url, '{not json', auth)).status).toBe(400);
  });

  it('oversized body is 413', async () => {
    const { url } = await boot({ maxBodyBytes: 1024 });
    const big = Array.from({ length: 200 }, () => ev({ user: 'x'.repeat(20) }));
    expect((await post(url, big, auth)).status).toBe(413);
  });

  it('too many events in one batch is rejected (413)', async () => {
    const { url } = await boot({ maxBatch: 10 });
    expect((await post(url, Array.from({ length: 11 }, () => ev()), auth)).status).toBe(413);
  });

  it('rate limits bursts (429) and recovers after the window', async () => {
    const { url } = await boot({ rateLimit: { max: 3, windowMs: 300 } });
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await post(url, ev(), auth)).status);
    expect(codes.slice(0, 3)).toEqual([202, 202, 202]);
    expect(codes.slice(3)).toContain(429);
    await new Promise((r) => setTimeout(r, 350));
    expect((await post(url, ev(), auth)).status).toBe(202);
  });

  it('unknown routes are 404 and wrong methods 405', async () => {
    const { url } = await boot();
    expect((await fetch(`${url}/nope`, { headers: auth })).status).toBe(404);
    expect((await fetch(`${url}/event`, { headers: auth })).status).toBe(405);
  });

  it('sends periodic ping messages to clients', async () => {
    const { port } = await boot({ pingMs: 50 });
    const c = await connect(port);
    await until(() => c.msgs.some((m) => (m as { ping?: boolean }).ping === true));
    expect(c.msgs.some((m) => (m as { ping?: boolean }).ping === true)).toBe(true);
    c.ws.close();
  });

  it('publish() broadcasts directly and reports the recipient count', async () => {
    const { bridge, port } = await boot();
    const c = await connect(port);
    await until(() => bridge.clientCount === 1);
    expect(bridge.publish(ev())).toBe(1);
    expect(bridge.publish({ bad: true })).toBe(0);
    c.ws.close();
  });

  it('a client that sends data cannot crash the bridge', async () => {
    const { port, url } = await boot();
    const c = await connect(port);
    c.ws.send('x'.repeat(5000));
    c.ws.send(Buffer.from([1, 2, 3]));
    await new Promise((r) => setTimeout(r, 100));
    expect((await fetch(`${url}/health`)).status).toBe(200);
    c.ws.close();
  });

  it('stop() closes clients and frees the port', async () => {
    const bridge = createBridge({ token: TOKEN, port: 0 });
    const { port } = await bridge.start();
    const c = await connect(port);
    const closed = new Promise((r) => c.ws.on('close', r));
    await bridge.stop();
    await closed;
    await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow();
  });
});
