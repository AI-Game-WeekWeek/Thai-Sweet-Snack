import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createBridge } from './bridge';
import { startTikFinityClient } from './tikfinityClient';

/** One command for the live PC: `npm run live`. Builds the game if needed, starts the bridge, prints the links to use. */
const port = Number(process.env.BRIDGE_PORT) || 8787;
const host = '127.0.0.1';
const tokenFile = '.live-token';
if (!existsSync('dist/index.html')) {
  console.log('ยังไม่มีเกมที่ build ไว้ กำลัง build ให้ (ครั้งเดียว)…');
  const r = spawnSync('npx', ['vite', 'build'], { stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) {
    console.error('build ไม่สำเร็จ ดูข้อความด้านบน');
    process.exit(1);
  }
}
let token = process.env.BRIDGE_TOKEN ?? '';
if (token.length < 16 && existsSync(tokenFile)) token = readFileSync(tokenFile, 'utf8').trim();
if (token.length < 16) {
  token = randomBytes(12).toString('hex');
  writeFileSync(tokenFile, token + '\n', { mode: 0o600 });
}

const bridge = createBridge({ token, host, port, staticDir: 'dist' });
const { port: p } = await bridge.start();
const base = `http://${host}:${p}`;
const gameUrl = `${base}/live.html`; // no ?query: the token is built into the page, which connects back to the bridge it came from
console.log('\nพร้อมแล้ว ใช้ลิงก์เหล่านี้ (เก็บเป็นความลับ: มีรหัสลับอยู่ในลิงก์)\n');
console.log('1) ใส่ใน TikTok LIVE Studio แบบ Link  ขนาด 1080x1920  Fill:');
console.log('   ' + gameUrl + '\n');
console.log('2) หน้าตรวจสอบว่าอีเวนต์เข้ามาไหม (เปิดในเบราว์เซอร์ธรรมดา):');
console.log(`   ${base}/monitor?token=${token}\n`);
console.log('3) ถ้า TikFinity ส่งแบบ Webhook / URL ให้ตั้งปลายทางเป็น:');
console.log(`   ${base}/tikfinity?token=${token}\n`);
const ws = process.env.TIKFINITY_WS ?? 'ws://localhost:21213';
const client = process.argv.includes('--no-tikfinity') ? null : startTikFinityClient(bridge, ws, (m) => console.log('[tikfinity]', m));
console.log(client ? `4) กำลังลองต่อ TikFinity ที่ ${ws} (ไม่ใช่พอร์ตที่ยืนยันแล้ว: เปลี่ยนด้วย TIKFINITY_WS หรือปิดด้วย --no-tikfinity)\n` : '4) ปิดการต่อ TikFinity อัตโนมัติ\n');
console.log('กด Ctrl+C เพื่อหยุด');
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    client?.stop();
    void bridge.stop().then(() => process.exit(0));
  });
}
