import { AnimationManager } from './anim/AnimationManager';
import { ParticleSystem } from './anim/ParticleSystem';
import { AudioManager } from './audio/AudioManager';
import { liveConfig } from './config/gameConfig';
import { Game, WORLD_H, WORLD_W } from './Game';
import { LoopDriver } from './core/LoopDriver';
import { ALL_DESSERTS } from './dessert/data';
import { DessertManager } from './dessert/DessertManager';
import { Renderer } from './render/Renderer';
import { MockEventSource } from './tiktok/MockEventSource';
import { TikTokEventManager } from './tiktok/TikTokEventManager';

const app = document.getElementById('app');
if (!app) throw new Error('#app not found');

const canvas = document.createElement('canvas');
canvas.width = 1000;
canvas.height = 600;
canvas.style.cssText = 'width:100%;max-width:1000px;display:block;margin:0 auto;touch-action:manipulation';
const readout = document.createElement('div');
readout.style.cssText = 'font:16px system-ui,sans-serif;text-align:center;padding:8px';
app.append(canvas, readout);
const ctx = canvas.getContext('2d');

const animations = new AnimationManager(liveConfig);
const audio = new AudioManager(liveConfig);
const particles = new ParticleSystem(liveConfig.particles.cap, liveConfig.particles.gravity);
const unlocked = ALL_DESSERTS.filter((d) => 'default' in d.unlock).map((d) => d.id);
const events = new TikTokEventManager(liveConfig);
const game = new Game(liveConfig, new DessertManager(ALL_DESSERTS, unlocked), { animations, audio, particles }, events);

// ?mock=1 feeds simulated viewer events (no TikTok needed): steady likes/follows/gifts plus a burst now and then.
const params = new URLSearchParams(location.search);
const mock = params.get('mock') === '1' ? new MockEventSource(Math.random, (e) => game.ingestEvent(e)) : null;
if (mock) {
  events.setConnection('connected');
  mock.steady(Number(params.get('rate')) || 20, 24 * 3600 * 1000);
  setInterval(() => mock.burst('like', 300, Date.now()), 15_000);
}
const renderer = new Renderer();

// Browsers block audio until a user gesture.
const unlockAudio = (): void => audio.unlock();
addEventListener('pointerdown', unlockAudio, { once: true });
addEventListener('keydown', unlockAudio, { once: true });
canvas.addEventListener('pointerdown', (e) => {
  const r = canvas.getBoundingClientRect();
  game.poke(((e.clientX - r.left) / r.width) * WORLD_W, ((e.clientY - r.top) / r.height) * WORLD_H);
});

// ?speed=N runs N updates per frame (test aid for smoke tests); capped to keep it safe.
const speed = Math.min(50, Math.max(1, Number(params.get('speed')) || 1));
const driver = new LoopDriver({
  update(dtMs: number): void {
    const now = Date.now();
    mock?.tick(dtMs, now);
    for (let i = 0; i < speed; i++) game.update(dtMs, now);
    if (ctx) renderer.draw(ctx, canvas.width, canvas.height, game.renderView(), particles, dtMs);
  },
});
game.start();
driver.start();

// Plain-text readout; the real HUD arrives in Phase 5.
function render(): void {
  const s = game.snapshot();
  readout.textContent =
    `ขนม: ${s.dessertNameTh ?? '-'} | ขั้นตอน: ${s.stepNameTh ?? '-'} | ความคืบหน้า: ${s.progress.toFixed(0)}% | ` +
    `ถัดไป: ${s.nextDessertNameTh} | state=${s.state} round=${s.roundId} done=${s.roundsCompleted} | ` +
    `ไลก์ ${s.counters.likes} ติดตาม ${s.counters.follows} หัวใจ ${s.counters.hearts} ของขวัญ ${s.counters.gifts} แชร์ ${s.counters.shares} (${s.connection})`;
}
render();
setInterval(render, 100);
