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
import '@fontsource/mali/thai-700.css';
import '@fontsource/mali/latin-700.css';
import { CafeRenderer } from './render/CafeRenderer';
import { installDevKeys } from './devKeys';
import { voiceFiles } from './audio/voiceFiles';
import { preloadArt } from './render/artImages';
import { ALL_PIC_NAMES } from './render/artManifest';
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
// ?surprise=1 brings the first phone call forward (to see it without waiting a minute).
const quickPhone = params.get('surprise') === '1';
const cfg = cafeMode
  ? quickPhone
    ? { ...cafeConfig, cafe: { ...cafeConfig.cafe, surprise: { ...cafeConfig.cafe.surprise, phone: { ...cafeConfig.cafe.surprise.phone, firstMs: 6000, everyMs: 25_000 } } } }
    : cafeConfig
  : voteMode
    ? voteConfig
    : liveConfig;

const canvas = document.createElement('canvas');
if (cafeMode) {
  // Portrait 9:16 (vertical livestream): fill the window height, keep the ratio.
  canvas.width = 720;
  canvas.height = 1280;
  // Largest 9:16 box that fits the window: never stretched, never scrolling.
  canvas.style.cssText = 'width:min(100vw, calc(100vh * 9 / 16));height:auto;aspect-ratio:9/16;display:block;margin:0 auto;touch-action:manipulation';
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
const cafeRenderer = cafeMode ? new CafeRenderer(cfg.vote.maxBoost, new AvatarCache(cfg.cafe.avatar)) : null;
if (cafeRenderer) {
  // painted pictures are optional: shapes are drawn until (and unless) they load
  preloadArt(ALL_PIC_NAMES);
  const bgParam = params.get('bg');
  const hour = new Date().getHours();
  cafeRenderer.background = bgParam === 'rain' || bgParam === 'night' || bgParam === 'day' ? bgParam : hour >= 18 || hour < 6 ? 'night' : 'day';
}
const renderer = cafeRenderer ?? (voteMode ? new VoteRenderer(cfg.vote.maxBoost) : new Renderer());

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
// Recorded sounds (cat meow, ghost wail) replace the synthesized ones once loaded; the demo build inlines them.
{
  const inline = (globalThis as { __SFX__?: Record<string, string> }).__SFX__;
  audio.registerSample('meow', inline?.meow ?? 'sfx/cat.mp3');
  audio.registerSample('ghost', inline?.ghost ?? 'sfx/ghost.mp3');
  audio.registerSample('ring', inline?.ring ?? 'sfx/ring.mp3');
}
// Optional recorded voice lines in public/voice/ (see src/audio/voiceFiles.ts): played when present, otherwise the device voice speaks.
for (const v of voiceFiles(ALL_DESSERTS)) audio.registerSample(v.key, `voice/${v.file}`);
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

// Test shortcuts (press ? to see them): on with ?keys=1, ?debug=1 or in the hosted demo.
if (cafeMode && (params.get('keys') === '1' || params.get('debug') === '1' || __DEMO__)) {
  const bgs = ['day', 'rain', 'night'] as const;
  installDevKeys({
    game,
    giftCoins: [...cfg.cafe.giftTiers].sort((a, b) => a.minCoins - b.minCoins).map((t) => t.minCoins),
    setMuted: (m) => audio.setMuted(m),
    cycleBackground: () => {
      if (!cafeRenderer) return '-';
      const next = bgs[(bgs.indexOf(cafeRenderer.background) + 1) % bgs.length] as (typeof bgs)[number];
      cafeRenderer.background = next;
      return next;
    },
    speak: (text, pitch, gender) => void audio.speak(text, 0, pitch, 0.7, gender),
    playSound: (id) => void audio.play(id as never, 0),
    voiceName: () => audio.lastVoiceName,
    voiceCount: () => (globalThis as { speechSynthesis?: SpeechSynthesis }).speechSynthesis?.getVoices?.().length ?? 0,
  });
}

// Classic mode's HUD only reads snapshots, ten times a second.
if (ui) {
  const render = (): void => ui.render(game.snapshot());
  render();
  setInterval(render, 100);
}
