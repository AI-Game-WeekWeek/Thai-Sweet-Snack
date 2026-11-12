import { AnimationManager } from './anim/AnimationManager';
import { ParticleSystem } from './anim/ParticleSystem';
import { AudioManager } from './audio/AudioManager';
import { cafeConfig, liveConfig, voteConfig } from './config/gameConfig';
import { CafeQueue } from './cafe/CafeQueue';
import { HeartMeter } from './cooking/HeartMeter';
import { Game, WORLD_H, WORLD_W } from './Game';
import { LoopDriver } from './core/LoopDriver';
import { ALL_DESSERTS } from './dessert/data';
import { DessertManager } from './dessert/DessertManager';
import { ProgressionManager } from './reward/ProgressionManager';
import { RewardManager } from './reward/RewardManager';
import { SaveSystem, type StorageLike } from './save/SaveSystem';
import { UIManager } from './ui/UIManager';
import { AvatarCache } from './render/AvatarCache';
import { CafeRenderer } from './render/CafeRenderer';
import { Renderer } from './render/Renderer';
import { VoteRenderer } from './render/VoteRenderer';
import { VoteManager } from './vote/VoteManager';
import { MockEventSource } from './tiktok/MockEventSource';
import { WebSocketSource } from './tiktok/WebSocketSource';
import { TikTokEventManager } from './tiktok/TikTokEventManager';

declare const __DEMO__: boolean;

const app = document.getElementById('app');
if (!app) throw new Error('#app not found');

// Default: Thai café (portrait): a queue of customers, gifts order desserts, hearts speed cooking.
// ?mode=vote = menu vote by comment 1/2/3 (landscape); ?mode=classic = one dessert at a time with a DOM HUD.
const params = new URLSearchParams(location.search);
const modeParam = params.get('mode');
const mode = modeParam === 'classic' || modeParam === 'vote' ? modeParam : 'cafe';
const cafeMode = mode === 'cafe';
const voteMode = mode === 'vote';
const cfg = cafeMode ? cafeConfig : voteMode ? voteConfig : liveConfig;

const canvas = document.createElement('canvas');
if (cafeMode) {
  // Portrait 9:16 (vertical livestream): fill the window height, keep the ratio.
  canvas.width = 720;
  canvas.height = 1280;
  canvas.style.cssText = 'height:100vh;max-height:100vh;max-width:100%;aspect-ratio:9/16;display:block;margin:0 auto;touch-action:manipulation';
  document.body.style.margin = '0';
  document.body.style.background = '#2a1d14';
} else {
  canvas.width = 1000;
  canvas.height = 600;
  canvas.style.cssText = 'width:100%;max-width:1000px;display:block;margin:0 auto;touch-action:manipulation';
}
// Café and vote modes draw everything on the canvas (OBS captures one picture); classic mode adds the DOM HUD below it.
const hudRoot = document.createElement('div');
app.append(canvas);
const ui = cafeMode || voteMode ? null : new UIManager(hudRoot);
if (ui) app.append(hudRoot);
const ctx = canvas.getContext('2d');

const animations = new AnimationManager(cfg);
const audio = new AudioManager(cfg);
const particles = new ParticleSystem(cfg.particles.cap, cfg.particles.gravity);
// localStorage can be missing or throw (private mode, blocked site data): the game then simply doesn't persist.
function safeStorage(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
const defaultUnlocked = ALL_DESSERTS.filter((d) => 'default' in d.unlock).map((d) => d.id);
const save = new SaveSystem(cfg, safeStorage(), defaultUnlocked, ALL_DESSERTS.map((d) => d.id));
const rewards = new RewardManager(cfg, save.load());
const events = new TikTokEventManager(cfg);
const game = new Game(
  cfg,
  new DessertManager(ALL_DESSERTS, rewards.profile.unlocked),
  { animations, audio, particles },
  events,
  rewards,
  { progression: new ProgressionManager(ALL_DESSERTS, rewards), save },
  voteMode
    ? {
        manager: new VoteManager({ maxVoters: cfg.vote.maxVoters, anonVotesPerSec: cfg.vote.anonVotesPerSec }),
        meter: new HeartMeter({ decayPerSec: cfg.vote.heartDecayPerSec, maxBoost: cfg.vote.maxBoost }),
      }
    : undefined,
  cafeMode
    ? {
        queue: new CafeQueue({ maxWaiting: cfg.cafe.maxWaiting, patienceMs: cfg.cafe.patienceMs, maxNameLength: cfg.cafe.maxNameLength }),
        meter: new HeartMeter({ decayPerSec: cfg.vote.heartDecayPerSec, maxBoost: cfg.vote.maxBoost }),
      }
    : undefined,
);

// ?mock=1 feeds simulated viewers (no TikTok needed): likes/follows/gifts, plus comments "1/2/3" in vote mode.
// ?rate=N is capped so a typo cannot freeze the page.
// The hosted demo build turns simulated viewers on by default (?mock=0 turns them off).
const mockOn = params.get('mock') === '1' || (__DEMO__ && params.get('mock') !== '0');
const mock = mockOn ? new MockEventSource(Math.random, (e) => game.ingestEvent(e), { comments: voteMode, cafe: cafeMode }) : null;
if (mock) {
  events.setConnection('connected');
  mock.steady(Math.min(500, Math.max(1, Number(params.get('rate')) || 20)), 24 * 3600 * 1000);
  setInterval(() => mock.burst('like', 300, Date.now()), 15_000);
}
const renderer = cafeMode ? new CafeRenderer(cfg.vote.maxBoost, new AvatarCache(cfg.cafe.avatar)) : voteMode ? new VoteRenderer(cfg.vote.maxBoost) : new Renderer();

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

// Create the audio context right away (OBS browser sources allow it; nobody clicks there). Where the browser
// blocks it until a gesture, keep retrying on every gesture until the context is really running.
audio.unlock();
const gestures = ['pointerup', 'click', 'keydown', 'touchend'] as const;
const retryUnlock = (): void => {
  audio.unlock();
  if (audio.running) for (const g of gestures) removeEventListener(g, retryUnlock);
};
for (const g of gestures) addEventListener(g, retryUnlock);
if (!cafeMode) {
  canvas.addEventListener('pointerdown', (e) => {
    const r = canvas.getBoundingClientRect();
    game.poke(((e.clientX - r.left) / r.width) * WORLD_W, ((e.clientY - r.top) / r.height) * WORLD_H);
  });
}

// ?speed=N runs N updates per frame (test aid for smoke tests); capped to keep it safe.
const speed = Math.min(50, Math.max(1, Number(params.get('speed')) || 1));
const driver = new LoopDriver({
  update(dtMs: number): void {
    const now = Date.now();
    mock?.tick(Math.min(dtMs, cfg.maxFrameMs), now); // a hidden tab must not turn into millions of events
    for (let i = 0; i < speed; i++) game.update(dtMs, now);
    if (ctx) renderer.draw(ctx, canvas.width, canvas.height, game.renderView(), particles, dtMs);
  },
});
// ?debug=1 exposes a read-only snapshot for automated browser checks.
if (params.get('debug') === '1') (window as unknown as { __snapshot: () => unknown }).__snapshot = () => game.snapshot();

game.start();
driver.start();

// Classic mode's HUD only reads snapshots, ten times a second.
if (ui) {
  const render = (): void => ui.render(game.snapshot());
  render();
  setInterval(render, 100);
}
