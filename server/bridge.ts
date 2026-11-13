import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { isChatterComment, parseLiveEvent } from '../src/tiktok/parseLiveEvent';
import { TikFinityAdapter } from '../src/tiktok/adapters/tikfinity';
import { DEFAULT_GIFT_BOARD } from '../src/cafe/giftBoard';
import { GiftDesk, type GiftMeta } from './giftDesk';
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
  /** Hosts the game may load viewer pictures from (built into /live.html). Empty = generated faces only. */
  avatarHosts?: string[];
  /** Where the gift page saves its settings (gift board + Auto/Manual). Omit for in-memory only. */
  giftFile?: string;
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
  /** Hosts (never full URLs) of viewer pictures that arrived, with a count: shows which host to allow. */
  avatarHosts: Record<string, number>;
  dropped: number;
}

/** Commands the control panel may send (test / show actions, not viewer events). */
export const COMMANDS = ['ghost', 'shaman', 'squeeze', 'finish'] as const;

const PANEL_HTML = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>แผงควบคุมร้านขนมไทย</title>
<style>body{font:15px/1.4 system-ui,sans-serif;background:#1c1511;color:#f4e6d3;margin:0;padding:14px;max-width:680px}h1{font-size:20px;margin:0 0 8px}h2{font-size:15px;margin:14px 0 6px;color:#ffc878}
.row{display:flex;flex-wrap:wrap;gap:8px}button{font:inherit;background:#34271d;color:#fff3dc;border:1px solid #6a4a30;border-radius:10px;padding:10px 14px;cursor:pointer;min-width:84px}button:active{background:#5a3d28}
button.g{border-color:#e8b64c}button.f{border-color:#b8a0ff}input{font:inherit;padding:8px;border-radius:8px;border:1px solid #6a4a30;background:#2a1f18;color:#fff;width:200px}#msg{position:fixed;right:12px;top:12px;background:#0008;padding:6px 12px;border-radius:12px;opacity:0;transition:opacity .2s}</style>
<h1>แผงควบคุม (ส่งเข้าเกมที่เปิดอยู่ทุกหน้า รวมถึงใน LIVE Studio)</h1>
<p>ชื่อผู้ชมสำหรับของขวัญ (เว้นว่างได้): <input id=nm maxlength=16 placeholder="เช่น พี่ต้น"></p>
<h2>ของขวัญ → ลูกค้าสั่งขนม</h2><div class=row id=g></div>
<h2>อีเวนต์ผู้ชม</h2><div class=row id=e></div>
<h2>ผีและหมอผี</h2><div class=row id=s></div>
<div id=msg></div>
<script>const TOKEN=__TOKEN__;let n=0;const nm=()=>document.getElementById('nm').value.trim();
const say=m=>{const e=document.getElementById('msg');e.textContent=m;e.style.opacity=1;clearTimeout(say.t);say.t=setTimeout(()=>e.style.opacity=0,1200)};
async function post(path,body,label){try{const r=await fetch(path,{method:'POST',headers:{authorization:'Bearer '+TOKEN,'content-type':'application/json'},body:JSON.stringify(body)});say(r.ok?label:'ไม่สำเร็จ ('+r.status+')')}catch(e){say('ต่อสะพานไม่ได้')}}
const ev=(type,extra,label)=>post('/event',{id:'panel'+Date.now()+'-'+(++n),type,count:1,tsMs:Date.now(),...extra},label);
const mk=(box,label,fn,cls)=>{const b=document.createElement('button');b.textContent=label;if(cls)b.className=cls;b.onclick=fn;document.getElementById(box).append(b)};
[[1,'ข้าวต้มมัด'],[5,'บัวลอย'],[10,'ทองหยอด'],[20,'ขนมชั้น'],[50,'ฝอยทอง'],[99,'ทองหยิบ'],[199,'ลูกชุบ'],[500,'ขนมเบื้อง']].forEach(([c,t])=>mk('g',c+' · '+t,()=>ev('gift',{giftCoins:c,...(nm()?{displayName:nm()}:{})},'ส่งของขวัญ '+c),'g'));
mk('e','กุหลาบ',()=>ev('rose',{giftCoins:1,...(nm()?{displayName:nm()}:{})},'กุหลาบ'));
mk('e','ไลก์ ×1',()=>ev('like',{count:1},'ไลก์ 1'));mk('e','ไลก์ ×30',()=>ev('like',{count:30},'ไลก์ 30'));mk('e','ไลก์ ×400',()=>ev('like',{count:400},'ไลก์ 400'));
mk('e','ติดตาม (แมวกวัก)',()=>ev('follow',{},'ติดตาม'),'f');mk('e','แชร์ (+โควตาหมอผี)',()=>ev('share',{},'แชร์'),'f');mk('e','หัวใจส้ม (VIP)',()=>ev('orangeHeart',{},'หัวใจส้ม'),'f');
['นางรำ','ผีพราย','กระสือ','แม่นาค','ผีหิว'].forEach((t,i)=>mk('s','เสก'+t,()=>post('/cmd',{cmd:'ghost',arg:i},'เสก'+t)));
mk('s','เสกผีสุ่ม',()=>post('/cmd',{cmd:'ghost'},'เสกผีสุ่ม'));mk('s','เรียกหมอผี',()=>post('/cmd',{cmd:'shaman'},'เรียกหมอผี'),'f');mk('s','ผีบีบทันที',()=>post('/cmd',{cmd:'squeeze'},'ผีบีบ'));mk('s','ทำขนมให้เสร็จ',()=>post('/cmd',{cmd:'finish'},'ขนมเสร็จ'));
</script>`;

const GIFTS_HTML = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ของขวัญ</title>
<style>body{font:15px/1.45 system-ui,sans-serif;background:#1c1511;color:#f4e6d3;margin:0;padding:14px;max-width:900px}h1{font-size:20px;margin:0 0 8px}h2{font-size:16px;margin:16px 0 6px;color:#ffc878}
button{font:inherit;background:#34271d;color:#fff3dc;border:1px solid #6a4a30;border-radius:8px;padding:6px 12px;cursor:pointer}button.on{background:#1f6b4a}button.p{border-color:#e8b64c}
table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #46352a;padding:5px 8px;text-align:left}img{width:34px;height:34px;border-radius:50%;vertical-align:middle;background:#444}input,select{font:inherit;padding:4px 6px;border-radius:6px;border:1px solid #6a4a30;background:#2a1f18;color:#fff}.dim{color:#a8957f}.ok{color:#7ddc8c}</style>
<h1>ระบบรับของขวัญ</h1>
<p><button id=mode></button> <span class=dim id=modehelp></span></p>
<h2>ป้ายเมนู: ของขวัญไหน = ขนมช่องไหน (ชื่อต้องตรงกับชื่อของขวัญใน TikTok ไม่สนตัวพิมพ์ใหญ่เล็ก)</h2>
<table id=board></table><p><button id=save class=p>บันทึกป้ายเมนู</button> <span id=sm class=ok></span></p>
<h2>ของขวัญที่เข้ามา (ล่าสุดอยู่บน)</h2><table id=log></table>
<script>const T=new URLSearchParams(location.search).get('token')||'';const H={authorization:'Bearer '+T,'content-type':'application/json'};
const NAMES={1:'ข้าวต้มมัด (ฟรี)',5:'บัวลอย',10:'ทองหยอด',20:'ขนมชั้น',50:'ฝอยทอง',99:'ทองหยิบ',199:'ลูกชุบ',500:'ขนมเบื้อง'};
let state=null,editing=false;
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
async function load(){try{const r=await fetch('/gifts.json?token='+encodeURIComponent(T));if(!r.ok)throw 0;state=await r.json();draw()}catch(e){document.body.insertAdjacentHTML('afterbegin','<p>เปิดหน้านี้ด้วยลิงก์ที่มี ?token=... ที่โปรแกรมแสดงให้</p>')}}
function draw(){const m=document.getElementById('mode');m.textContent=state.auto?'โหมด: อัตโนมัติ (ของขวัญเข้าเกมทันที)':'โหมด: กดเล่นเอง (ของขวัญรอปุ่ม เล่น)';m.className=state.auto?'on':'';
document.getElementById('modehelp').textContent='กดเพื่อสลับ';
if(!editing)document.getElementById('board').innerHTML='<tr><th>ช่อง</th><th>ขนม</th><th>ชื่อของขวัญ</th></tr>'+state.board.map(s=>'<tr><td>'+s.coins+'</td><td>'+NAMES[s.coins]+'</td><td>'+(s.coins===1?'<span class=dim>ฟรี (ไลก์ คนเข้า)</span>':'<input data-c="'+s.coins+'" value="'+esc(s.gift)+'" maxlength=32>')+'</td></tr>').join('');
document.getElementById('log').innerHTML='<tr><th></th><th>เวลา</th><th>ผู้ส่ง</th><th>ของขวัญ</th><th>จำนวน</th><th>เพชร</th><th>ช่อง</th><th></th></tr>'+(state.log.length?state.log.map(e=>'<tr><td>'+(e.avatarUrl?'<img src="'+esc(e.avatarUrl)+'" referrerpolicy="no-referrer">':'')+'</td><td>'+new Date(e.atMs).toLocaleTimeString()+'</td><td>'+esc(e.user||'-')+'</td><td>'+esc(e.gift||'?')+'</td><td>'+e.repeat+'</td><td>'+e.diamonds+'</td><td>'+(e.tier===null?'<span class=dim>ไม่อยู่ในป้าย (ใช้ค่าเพชร)</span>':e.tier+' · '+esc(NAMES[e.tier]))+'</td><td>'+(e.played?'<span class=ok>เล่นแล้ว</span>':'<button class=p data-p="'+esc(e.id)+'">เล่น</button>')+'</td></tr>').join(''):'<tr><td class=dim>ยังไม่มีของขวัญเข้ามา</td></tr>')}
document.addEventListener('input',e=>{if(e.target.dataset.c)editing=true});
document.addEventListener('click',async e=>{const t=e.target;
if(t.id==='mode'){await fetch('/gifts/auto',{method:'POST',headers:H,body:JSON.stringify({auto:!state.auto})});load()}
else if(t.dataset.p){await fetch('/gifts/play',{method:'POST',headers:H,body:JSON.stringify({id:t.dataset.p})});load()}
else if(t.id==='save'){const board=[{coins:1,gift:''}];document.querySelectorAll('input[data-c]').forEach(i=>board.push({coins:Number(i.dataset.c),gift:i.value.trim()}));
const r=await fetch('/gifts/board',{method:'POST',headers:H,body:JSON.stringify({board})});document.getElementById('sm').textContent=r.ok?'บันทึกแล้ว':'บันทึกไม่ได้';editing=false;load()}});
load();setInterval(load,1500);</script>`;

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };

const MONITOR_HTML = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ตรวจสอบอีเวนต์</title>
<style>body{font:15px/1.5 system-ui,sans-serif;background:#1c1511;color:#f4e6d3;margin:0;padding:16px;max-width:760px}h1{font-size:20px}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #46352a;padding:4px 8px;text-align:left}.ok{color:#7ddc8c}.no{color:#ff8a8a}code{background:#34271d;padding:0 4px;border-radius:4px}</style>
<h1>ตรวจสอบอีเวนต์จาก TikTok</h1><p id=s>กำลังโหลด…</p><h2>นับตามชนิด</h2><table id=c></table><h2>30 อีเวนต์ล่าสุด</h2><table id=l></table><h2>โฮสต์ของรูปโปรไฟล์ที่ส่งมา (ใช้ตั้ง AVATAR_HOSTS)</h2><table id=h></table><h2>ข้อความที่เข้ามา (ชื่อฟิลด์เท่านั้น ไม่มีค่า)</h2><table id=m></table>
<script>const q=new URLSearchParams(location.search).get('token')||'';
async function tick(){try{const r=await fetch('/monitor.json?token='+encodeURIComponent(q));if(!r.ok)throw 0;const j=await r.json();
document.getElementById('s').innerHTML='เกมต่ออยู่ <b class="'+(j.clients>0?'ok':'no')+'">'+j.clients+'</b> หน้า · แหล่งอีเวนต์: <b>'+j.source+'</b> · ทิ้งข้อมูลที่ไม่เข้าใจ '+j.dropped+' ครั้ง';
const kinds=['gift','rose','like','follow','share','orangeHeart','comment','join'];
document.getElementById('c').innerHTML=kinds.map(k=>'<tr><td>'+k+'</td><td class="'+(j.received[k]?'ok':'no')+'">'+(j.received[k]||0)+'</td></tr>').join('');
document.getElementById('l').innerHTML=j.lastEvents.slice().reverse().map(e=>'<tr><td>'+new Date(e.atMs).toLocaleTimeString()+'</td><td>'+e.type+'</td><td>'+(e.count||'')+'</td><td>'+(e.giftCoins??'')+'</td></tr>').join('');
document.getElementById('h').innerHTML=Object.entries(j.avatarHosts||{}).map(([k,v])=>'<tr><td><code>'+k+'</code></td><td>'+v+'</td></tr>').join('')||'<tr><td>ยังไม่มีรูปส่งมา</td></tr>';
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
  const desk = new GiftDesk(DEFAULT_GIFT_BOARD.map((s) => s.coins), opts.giftFile ?? null);
  const stats: MonitorStats = { startedMs: Date.now(), clients: 0, source: 'ยังไม่มีข้อมูลเข้า', received: {}, lastEvents: [], seenMessages: {}, avatarHosts: {}, dropped: 0 };
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
    if (path === '/gifts' || path === '/gifts.json') {
      const t = new URL(req.url ?? '/', 'http://localhost').searchParams.get('token') ?? '';
      if (!(safeEqual(t, opts.token) || bearerOk(req))) return send(res, 401, { error: 'unauthorized' });
      if (path === '/gifts.json') return send(res, 200, { auto: desk.auto, board: desk.board, log: desk.entries().slice(-100).reverse().map(({ event: _e, ...rest }) => rest) });
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return void res.end(GIFTS_HTML);
    }
    if (path === '/gifts/play' || path === '/gifts/auto' || path === '/gifts/board') return handleGiftApi(req, res, path);
    if (path === '/panel') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return void res.end(PANEL_HTML.replace('__TOKEN__', () => JSON.stringify(opts.token)));
    }
    if (path === '/cmd') return handleCmd(req, res);
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

  async function handleGiftApi(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
    if (!bearerOk(req)) return send(res, 401, { error: 'unauthorized' });
    if (!allowed(req.socket.remoteAddress ?? 'unknown')) return send(res, 429, { error: 'rate limited' });
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > 8192) return send(res, 413, { error: 'body too large' });
      chunks.push(chunk);
    }
    let body: Record<string, unknown>;
    try {
      const j = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
      body = typeof j === 'object' && j !== null ? (j as Record<string, unknown>) : {};
    } catch {
      return send(res, 400, { error: 'invalid JSON' });
    }
    if (path === '/gifts/auto') {
      desk.setAuto(body.auto === true);
      return send(res, 200, { auto: desk.auto });
    }
    if (path === '/gifts/board') {
      if (!desk.setBoard(body.board)) return send(res, 400, { error: 'invalid board' });
      broadcast(JSON.stringify({ cmd: 'giftboard', board: desk.board }));
      return send(res, 200, { board: desk.board });
    }
    const ev = typeof body.id === 'string' ? desk.play(body.id) : null;
    if (!ev) return send(res, 404, { error: 'unknown or already played' });
    const e = parseLiveEvent(ev, maxLike);
    if (e) {
      note([e]);
      broadcast(JSON.stringify([e]));
    }
    send(res, 200, { played: true });
  }

  /** The streamer's own control panel sends test commands (call a ghost, shaman, ...) that are relayed to the game pages. */
  async function handleCmd(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
    if (!bearerOk(req)) return send(res, 401, { error: 'unauthorized' });
    if (!allowed(req.socket.remoteAddress ?? 'unknown')) return send(res, 429, { error: 'rate limited' });
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > 1024) return send(res, 413, { error: 'body too large' });
      chunks.push(chunk);
    }
    let body: unknown;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      return send(res, 400, { error: 'invalid JSON' });
    }
    const o = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
    if (typeof o.cmd !== 'string' || !(COMMANDS as readonly string[]).includes(o.cmd)) return send(res, 400, { error: 'unknown command' });
    const arg = typeof o.arg === 'number' && Number.isInteger(o.arg) && o.arg >= 0 && o.arg <= 9 ? o.arg : undefined;
    const sent = broadcast(JSON.stringify({ cmd: o.cmd, ...(arg !== undefined ? { arg } : {}) }));
    stats.received['cmd:' + o.cmd] = (stats.received['cmd:' + o.cmd] ?? 0) + 1;
    send(res, 202, { sent });
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
    for (let raw of converted) {
      const meta = (raw as { meta?: GiftMeta }).meta;
      if (meta && (raw.type === 'gift' || raw.type === 'rose')) {
        // every gift goes through the gift page: logged, mapped to a menu slot, and sent now (Auto) or held for the Play button (Manual)
        const entry = desk.record(raw, meta);
        if (!entry) continue; // a duplicate
        raw = entry.event;
        if (!desk.auto) continue;
        entry.played = true;
      }
      const e = parseLiveEvent(raw, maxLike);
      if (e?.avatarUrl) {
        try {
          const h = new URL(e.avatarUrl).hostname;
          if (Object.keys(stats.avatarHosts).length < 20 || h in stats.avatarHosts) stats.avatarHosts[h] = (stats.avatarHosts[h] ?? 0) + 1;
        } catch {
          /* not a url */
        }
      }
      if (e) valid.push(e);
      else stats.dropped++;
    }
    if (converted.length === 0 && !TikFinityAdapter.isStatus(message)) stats.dropped++;
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
        const inject = `<script>window.__BRIDGE_TOKEN__=${JSON.stringify(opts.token)};window.__AVATAR_HOSTS__=${JSON.stringify(opts.avatarHosts ?? [])};window.__GIFT_BOARD__=${JSON.stringify(desk.board)};</script>`;
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
