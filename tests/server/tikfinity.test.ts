import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createBridge } from '../../server/bridge';

const TOKEN = 'test-token-0123456789';
const open: { stop(): Promise<void> }[] = [];
async function boot(opts: Record<string, unknown> = {}) {
  const bridge = createBridge({ token: TOKEN, port: 0, ...opts });
  const { port } = await bridge.start();
  open.push(bridge);
  return { bridge, port, url: `http://127.0.0.1:${port}` };
}
function connect(port: number): Promise<{ msgs: unknown[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/?token=${TOKEN}`);
    const msgs: unknown[] = [];
    ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
    ws.on('open', () => resolve({ msgs }));
    ws.on('error', reject);
  });
}
const until = async (pred: () => boolean, ms = 2000) => { const t = Date.now(); while (!pred() && Date.now() - t < ms) await new Promise((r) => setTimeout(r, 10)); };
afterEach(async () => { while (open.length) await open.pop()!.stop(); });

describe('TikFinity route', () => {
  it('POST /tikfinity needs the token (header or ?token=), converts messages and broadcasts valid game events', async () => {
    const { url, port } = await boot();
    const { msgs } = await connect(port);
    const body = JSON.stringify({ event: 'gift', data: { giftName: 'Rose', diamondCount: 5, repeatCount: 2, nickname: 'พี่ต้น' } });
    expect((await fetch(`${url}/tikfinity`, { method: 'POST', body })).status).toBe(401);
    expect((await fetch(`${url}/tikfinity?token=wrong-wrong-wrong-wrong`, { method: 'POST', body })).status).toBe(401);
    const ok = await fetch(`${url}/tikfinity?token=${TOKEN}`, { method: 'POST', body });
    expect(ok.status).toBe(202);
    await until(() => msgs.some((m) => Array.isArray(m)));
    const evs = msgs.flat() as { type: string; giftCoins?: number; displayName?: string }[];
    expect(evs.find((e) => e.type === 'rose')).toMatchObject({ giftCoins: 10, displayName: 'พี่ต้น' });
    const viaHeader = await fetch(`${url}/tikfinity`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ event: 'follow', data: {} }) });
    expect(viaHeader.status).toBe(202);
  });

  it('accepts a GET with fields in the URL and a form-style body, ignores junk, and never crashes', async () => {
    const { url } = await boot();
    expect((await fetch(`${url}/tikfinity?token=${TOKEN}&event=like&likeCount=5`)).status).toBe(202);
    expect((await fetch(`${url}/tikfinity?token=${TOKEN}`, { method: 'POST', body: 'event=follow' })).status).toBe(202);
    expect((await fetch(`${url}/tikfinity?token=${TOKEN}`, { method: 'POST', body: '{{{{' })).status).toBe(202);
    expect((await fetch(`${url}/tikfinity?token=${TOKEN}`, { method: 'PUT', body: '{}' })).status).toBe(405);
    expect((await fetch(`${url}/tikfinity?token=${TOKEN}`, { method: 'POST', body: 'x'.repeat(200_000) })).status).toBe(413);
  });

  it('/monitor needs the token and reports counts, the last events and only FIELD NAMES of messages (no values)', async () => {
    const { url, bridge } = await boot();
    bridge.ingestTikFinity({ event: 'gift', data: { giftName: 'Rose', diamondCount: 1, nickname: 'ชื่อลับ' } });
    bridge.ingestTikFinity({ event: 'like', data: { likeCount: 7 } });
    expect((await fetch(`${url}/monitor.json`)).status).toBe(401);
    expect((await fetch(`${url}/monitor`)).status).toBe(401);
    const j = (await (await fetch(`${url}/monitor.json?token=${TOKEN}`)).json()) as { received: Record<string, number>; seenMessages: Record<string, string[]>; lastEvents: unknown[] };
    expect(j.received).toMatchObject({ rose: 1, like: 1 });
    expect(j.seenMessages.gift).toEqual(['giftName', 'diamondCount', 'nickname']);
    expect(JSON.stringify(j)).not.toContain('ชื่อลับ');
    expect(j.lastEvents).toHaveLength(2);
    const html = await fetch(`${url}/monitor?token=${TOKEN}`);
    expect(html.status).toBe(200);
    expect(await html.text()).toContain('ตรวจสอบอีเวนต์');
  });

  it('serves the built game from staticDir, and never lets a path escape it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dist-'));
    writeFileSync(join(dir, 'index.html'), '<title>เกม</title>');
    mkdirSync(join(dir, 'art'));
    writeFileSync(join(dir, 'art', 'a.webp'), 'x');
    writeFileSync(join(tmpdir(), 'secret-outside.txt'), 'secret');
    const { url } = await boot({ staticDir: dir });
    const home = await fetch(`${url}/`);
    expect(home.status).toBe(200);
    expect(await home.text()).toContain('เกม');
    expect((await fetch(`${url}/art/a.webp`)).headers.get('content-type')).toBe('image/webp');
    expect((await fetch(`${url}/nope.js`)).status).toBe(404);
    expect((await fetch(`${url}/..%2Fsecret-outside.txt`)).status).toBe(404);
    expect((await fetch(`${url}/%2e%2e/secret-outside.txt`)).status).toBe(404);
    expect((await fetch(`${url}/art`)).status).toBe(404); // a folder is not a file
    expect((await fetch(`${url}/%00`)).status).toBeGreaterThanOrEqual(400);
    const noStatic = await boot();
    expect((await fetch(`${noStatic.url}/`)).status).toBe(404);
  });

  it('a gift streak with no end message is sent after the idle time', async () => {
    const { bridge, port } = await boot({ pingMs: 100 });
    const { msgs } = await connect(port);
    bridge.ingestTikFinity({ event: 'gift', data: { giftName: 'Rose', giftType: 1, diamondCount: 1, repeatCount: 3, repeatEnd: false, userId: 'u1' } });
    expect(msgs.flat().some((m) => (m as { type?: string }).type === 'rose')).toBe(false);
    await until(() => msgs.flat().some((m) => (m as { type?: string }).type === 'rose'), 6000);
    expect((msgs.flat().find((m) => (m as { type?: string }).type === 'rose') as { giftCoins: number }).giftCoins).toBe(3);
  }, 12000);
});

describe('live.html', () => {
  it('serves the game with the token built in (no query in the address) and with no-store', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dist-'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><html><head><title>เกม</title></head><body></body></html>');
    const { url } = await boot({ staticDir: dir });
    const r = await fetch(`${url}/live.html`);
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const html = await r.text();
    expect(html).toContain(`window.__BRIDGE_TOKEN__="${TOKEN}"`);
    expect(html.indexOf('__BRIDGE_TOKEN__')).toBeLessThan(html.indexOf('<title>'));
  });
});
