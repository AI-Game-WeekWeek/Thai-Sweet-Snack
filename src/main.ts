import { AnimationManager } from './anim/AnimationManager';
import { ParticleSystem } from './anim/ParticleSystem';
import { AudioManager } from './audio/AudioManager';
import { liveConfig } from './config/gameConfig';
import { Game, WORLD_H, WORLD_W } from './Game';
import { LoopDriver } from './core/LoopDriver';
import { ALL_DESSERTS } from './dessert/data';
import { DessertManager } from './dessert/DessertManager';
import { ProgressionManager } from './reward/ProgressionManager';
import { RewardManager } from './reward/RewardManager';
import { SaveSystem, type StorageLike } from './save/SaveSystem';
import { UIManager } from './ui/UIManager';
import { Renderer } from './render/Renderer';
import { MockEventSource } from './tiktok/MockEventSource';
import { WebSocketSource } from './tiktok/WebSocketSource';
import { TikTokEventManager } from './tiktok/TikTokEventManager';

const app = document.getElementById('app');
if (!app) throw new Error('#app not found');

const canvas = document.createElement('canvas');
canvas.width = 1000;
canvas.height = 600;
canvas.style.cssText = 'width:100%;max-width:1000px;display:block;margin:0 auto;touch-action:manipulation';
const hudRoot = document.createElement('div');
app.append(canvas, hudRoot);
const ui = new UIManager(hudRoot);
const ctx = canvas.getContext('2d');

const animations = new AnimationManager(liveConfig);
const audio = new AudioManager(liveConfig);
const particles = new ParticleSystem(liveConfig.particles.cap, liveConfig.particles.gravity);
// localStorage can be missing or throw (private mode, blocked site data): the game then simply doesn't persist.
function safeStorage(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
const defaultUnlocked = ALL_DESSERTS.filter((d) => 'default' in d.unlock).map((d) => d.id);
const save = new SaveSystem(liveConfig, safeStorage(), defaultUnlocked, ALL_DESSERTS.map((d) => d.id));
const rewards = new RewardManager(liveConfig, save.load());
const events = new TikTokEventManager(liveConfig);
const game = new Game(liveConfig, new DessertManager(ALL_DESSERTS, rewards.profile.unlocked), { animations, audio, particles }, events, rewards, {
  progression: new ProgressionManager(ALL_DESSERTS, rewards),
  save,
});

// ?mock=1 feeds simulated viewer events (no TikTok needed): steady likes/follows/gifts plus a burst now and then.
const params = new URLSearchParams(location.search);
const mock = params.get('mock') === '1' ? new MockEventSource(Math.random, (e) => game.ingestEvent(e)) : null;
if (mock) {
  events.setConnection('connected');
  mock.steady(Number(params.get('rate')) || 20, 24 * 3600 * 1000);
  setInterval(() => mock.burst('like', 300, Date.now()), 15_000);
}
const renderer = new Renderer();

// ?bridge=ws://127.0.0.1:8787&token=... connects to the local bridge (see docs/tiktok-integration.md).
// Without it the game runs on its own (or with ?mock=1); a dead bridge only changes the connection label.
const bridgeParam = params.get('bridge');
if (bridgeParam && /^wss?:\/\//i.test(bridgeParam)) {
  try {
    const url = new URL(bridgeParam);
    const token = params.get('token');
    if (token) url.searchParams.set('token', token);
    const bridge = new WebSocketSource({ url: url.toString(), sink: (raw) => game.ingestEvent(raw), onState: (s) => events.setConnection(s) });
    bridge.start();
    addEventListener('pagehide', () => bridge.stop());
  } catch (err) {
    console.warn('[main] invalid ?bridge= URL, running without it', err);
  }
}

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

// The HUD only reads snapshots, ten times a second.
function render(): void {
  ui.render(game.snapshot());
}
render();
setInterval(render, 100);
