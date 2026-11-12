import { AnimationManager } from './anim/AnimationManager';
import { ParticleSystem } from './anim/ParticleSystem';
import { AudioManager } from './audio/AudioManager';
import { liveConfig } from './config/gameConfig';
import { Game, WORLD_H, WORLD_W } from './Game';
import { LoopDriver } from './core/LoopDriver';
import { ALL_DESSERTS } from './dessert/data';
import { DessertManager } from './dessert/DessertManager';
import { Renderer } from './render/Renderer';

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
const game = new Game(liveConfig, new DessertManager(ALL_DESSERTS, unlocked), { animations, audio, particles });
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
const speed = Math.min(50, Math.max(1, Number(new URLSearchParams(location.search).get('speed')) || 1));
const driver = new LoopDriver({
  update(dtMs: number): void {
    for (let i = 0; i < speed; i++) game.update(dtMs);
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
    `ถัดไป: ${s.nextDessertNameTh} | state=${s.state} round=${s.roundId} done=${s.roundsCompleted}`;
}
render();
setInterval(render, 100);
