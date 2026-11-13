import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createBridge } from '../../server/bridge';
import { GiftDesk } from '../../server/giftDesk';

const TOKEN = 'test-token-0123456789';
const COINS = [1, 5, 10, 20, 50, 99, 199, 500];
const open: { stop(): Promise<void> }[] = [];
afterEach(async () => { while (open.length) await open.pop()!.stop(); });
const until = async (pred: () => boolean, ms = 2000) => { const t = Date.now(); while (!pred() && Date.now() - t < ms) await new Promise((r) => setTimeout(r, 10)); };

describe('GiftDesk', () => {
  const meta = (giftName: string, diamonds = 1) => ({ giftName, user: 'พี่ต้น', avatarUrl: 'https://p.example.com/a.jpg', repeat: 1, diamonds });
  it('maps gifts by name (case/space-insensitive) to a menu slot; unknown gifts keep their diamond value; duplicates are ignored', () => {
    const d = new GiftDesk(COINS);
    expect(d.tierFor('rose')).toBe(5);
    expect(d.tierFor("  YOU'RE   awesome ")).toBe(10);
    expect(d.tierFor('Mystery Gift')).toBeNull();
    expect(d.tierFor('')).toBeNull();
    const a = d.record({ id: 'g1', type: 'rose', giftCoins: 1 }, meta('Rose', 1))!;
    expect(a.tier).toBe(5);
    expect(a.event.giftCoins).toBe(5);
    const b = d.record({ id: 'g2', type: 'gift', giftCoins: 77 }, meta('Mystery', 77))!;
    expect(b.tier).toBeNull();
    expect(b.event.giftCoins).toBe(77);
    expect(d.record({ id: 'g1', type: 'rose', giftCoins: 1 }, meta('Rose', 1))).toBeNull();
    expect(d.entries()).toHaveLength(2);
  });

  it('Play gives the event once with a fresh id; the log is bounded; hostile input never throws', () => {
    const d = new GiftDesk(COINS);
    d.record({ id: 'g1', type: 'gift', giftCoins: 5 }, meta('Rose'));
    const ev = d.play('g1')!;
    expect(ev.id).toBe('g1-p');
    expect(d.play('g1')).toBeNull();
    expect(d.play('nope')).toBeNull();
    for (let i = 0; i < 400; i++) d.record({ id: `x${i}`, type: 'gift' }, meta('Rose'));
    expect(d.entries().length).toBeLessThanOrEqual(200);
    expect(() => d.record({ id: 5 as never, type: 'gift' }, { giftName: 5 as never, repeat: NaN, diamonds: -1 })).not.toThrow();
    expect(() => d.record({ id: 'h', type: 'gift' }, { giftName: 'x'.repeat(1000), user: '‮', avatarUrl: 'javascript:alert(1)', repeat: 1e30, diamonds: Infinity })).not.toThrow();
    expect(d.entries().find((e) => e.id === 'h')!.avatarUrl).toBe('');
  });

  it('the board can be edited (validated), re-maps old gifts and is saved to the settings file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gd-'));
    const file = join(dir, 'gift-map.json');
    const d = new GiftDesk(COINS, file);
    d.record({ id: 'g1', type: 'gift', giftCoins: 1 }, meta('Galaxy'));
    expect(d.entries()[0]!.tier).toBeNull();
    expect(d.setBoard([{ coins: 500, gift: 'Galaxy' }, { coins: 5, gift: 'Rose' }])).toBe(true);
    expect(d.tierFor('galaxy')).toBe(500);
    expect(d.entries()[0]!.tier).toBe(500);
    expect(d.setBoard([{ coins: 7, gift: 'x' }])).toBe(false); // not a menu tier
    expect(d.setBoard([{ coins: 5, gift: 'a' }, { coins: 5, gift: 'b' }])).toBe(false); // twice
    expect(d.setBoard('nope')).toBe(false);
    d.setAuto(false);
    const again = new GiftDesk(COINS, file);
    expect(again.auto).toBe(false);
    expect(again.tierFor('galaxy')).toBe(500);
    expect(JSON.parse(readFileSync(file, 'utf8')).auto).toBe(false);
  });
});

describe('gift page in the bridge', () => {
  async function boot() {
    const bridge = createBridge({ token: TOKEN, port: 0 });
    const { port } = await bridge.start();
    open.push(bridge);
    const msgs: unknown[] = [];
    await new Promise<void>((res, rej) => { const ws = new WebSocket(`ws://127.0.0.1:${port}/?token=${TOKEN}`); ws.on('message', (d) => msgs.push(JSON.parse(d.toString()))); ws.on('open', () => res()); ws.on('error', rej); });
    return { bridge, url: `http://127.0.0.1:${port}`, msgs };
  }
  const auth = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
  const gift = { event: 'gift', data: { giftName: 'Rose', diamondCount: 1, repeatCount: 1, nickname: 'พี่ต้น', msgId: 'm1' } };

  it('Auto: a mapped gift reaches the game as its slot tier and is logged as played; the page needs the token', async () => {
    const { bridge, url, msgs } = await boot();
    bridge.ingestTikFinity(gift);
    bridge.ingestTikFinity(gift); // same msgId: a duplicate
    await until(() => msgs.length > 0);
    expect((msgs.flat()[0] as { giftCoins: number; displayName: string })).toMatchObject({ giftCoins: 5, displayName: 'พี่ต้น' });
    expect(msgs.flat().length).toBe(1);
    expect((await fetch(`${url}/gifts.json`)).status).toBe(401);
    expect((await fetch(`${url}/gifts`)).status).toBe(401);
    const j = (await (await fetch(`${url}/gifts.json?token=${TOKEN}`)).json()) as { auto: boolean; log: { gift: string; user: string; tier: number; played: boolean }[] };
    expect(j.auto).toBe(true);
    expect(j.log).toHaveLength(1);
    expect(j.log[0]).toMatchObject({ gift: 'Rose', user: 'พี่ต้น', tier: 5, played: true });
    expect((await fetch(`${url}/gifts?token=${TOKEN}`)).status).toBe(200);
  });

  it('Manual: gifts wait in the log, the Play button sends one exactly once', async () => {
    const { bridge, url, msgs } = await boot();
    expect((await fetch(`${url}/gifts/auto`, { method: 'POST', headers: auth, body: JSON.stringify({ auto: false }) })).status).toBe(200);
    bridge.ingestTikFinity(gift);
    await new Promise((r) => setTimeout(r, 150));
    expect(msgs.flat().filter((m) => (m as { type?: string }).type).length).toBe(0); // held
    const log = ((await (await fetch(`${url}/gifts.json?token=${TOKEN}`)).json()) as { log: { id: string; played: boolean }[] }).log;
    expect(log[0]!.played).toBe(false);
    expect((await fetch(`${url}/gifts/play`, { method: 'POST', body: JSON.stringify({ id: log[0]!.id }) })).status).toBe(401);
    expect((await fetch(`${url}/gifts/play`, { method: 'POST', headers: auth, body: JSON.stringify({ id: log[0]!.id }) })).status).toBe(200);
    expect((await fetch(`${url}/gifts/play`, { method: 'POST', headers: auth, body: JSON.stringify({ id: log[0]!.id }) })).status).toBe(404);
    expect((await fetch(`${url}/gifts/play`, { method: 'POST', headers: auth, body: JSON.stringify({ id: 'nope' }) })).status).toBe(404);
    await until(() => msgs.flat().some((m) => (m as { type?: string }).type === 'rose' || (m as { type?: string }).type === 'gift'));
    expect((msgs.flat().find((m) => (m as { giftCoins?: number }).giftCoins !== undefined) as { giftCoins: number }).giftCoins).toBe(5);
  });

  it('editing the board is pushed to the games; a bad board is refused; an unmapped gift still plays by its diamonds', async () => {
    const { bridge, url, msgs } = await boot();
    expect((await fetch(`${url}/gifts/board`, { method: 'POST', headers: auth, body: JSON.stringify({ board: [{ coins: 3, gift: 'x' }] }) })).status).toBe(400);
    const r = await fetch(`${url}/gifts/board`, { method: 'POST', headers: auth, body: JSON.stringify({ board: [{ coins: 500, gift: 'Galaxy' }] }) });
    expect(r.status).toBe(200);
    await until(() => msgs.some((m) => (m as { cmd?: string }).cmd === 'giftboard'));
    expect(msgs.some((m) => (m as { cmd?: string }).cmd === 'giftboard')).toBe(true);
    bridge.ingestTikFinity({ event: 'gift', data: { giftName: 'Galaxy', diamondCount: 1, nickname: 'a', msgId: 'g9' } });
    bridge.ingestTikFinity({ event: 'gift', data: { giftName: 'Nobody Knows', diamondCount: 12, nickname: 'b', msgId: 'g10' } });
    await until(() => msgs.flat().filter((m) => (m as { giftCoins?: number }).giftCoins !== undefined).length >= 2);
    const coins = msgs.flat().filter((m) => (m as { giftCoins?: number }).giftCoins !== undefined).map((m) => (m as { giftCoins: number }).giftCoins);
    expect(coins).toEqual([500, 12]);
  });
});
