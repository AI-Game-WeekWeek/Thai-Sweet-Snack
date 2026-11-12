# Thai Dessert ASMR

An endless Thai-dessert cooking game for TikTok Live. The streamer's screen shows satisfying cooking animation and
synthesized ASMR sound; viewers' likes, follows, gifts and shares push the cooking forward. No viewer has to control
anything, and the game never ends: dessert after dessert, forever.

Web game: TypeScript, Canvas 2D, Web Audio, Vite. 8 Thai desserts (ขนมชั้น, ลูกชุบ, ฝอยทอง, ทองหยิบ, ทองหยอด, ขนมครก, บัวลอย, ขนมเบื้อง).

## Run

```bash
npm install
npm run dev            # http://localhost:5173
npm run build          # type-checks everything, then builds to dist/
npm test               # all tests (unit, soak, chaos, bridge, memory)
```

Capture the page in OBS (browser source) or TikTok LIVE Studio. Click the page once so the browser allows sound.

| URL flag | Effect |
|---|---|
| `?mock=1` (`&rate=N`) | simulated viewers (steady likes/follows/gifts plus bursts); no TikTok needed |
| `?bridge=ws://127.0.0.1:8787&token=...` | real events through the local bridge, see [docs/tiktok-integration.md](docs/tiktok-integration.md) |
| `?speed=N` | N game updates per frame (testing aid) |

## Important: TikTok

No official public TikTok API for reading LIVE events was found. The game therefore speaks one neutral event format
and ships a small authenticated local bridge; it bundles **no** reverse-engineered connector. You choose a source you
are entitled to use and check TikTok's and the provider's terms. Details and limits: [docs/tiktok-integration.md](docs/tiktok-integration.md).

## How it plays

Select dessert → prepare → cook (steps with animation + sound) → present on a tray → reward → next dessert, automatically.
Progress rises on its own (so it works with zero viewers) and faster with viewer events:

| Event | Effect (all values in `src/config/gameConfig.ts`) |
|---|---|
| Like | + progress per like |
| Follow | + progress |
| Orange Heart | + larger progress |
| Rose | special visual effect (with cooldown) |
| Large gift (≥ `largeGiftCoins`) | completes the current step |
| Share | + bonus % on the round's reward |

Rewards (score, coins, xp, collection) never need real money or gifts. Coins unlock new desserts automatically
(cheapest affordable first). Progress is saved in the browser (`localStorage`).

## Architecture

```
src/config/     gameConfig.ts           every tunable number
src/core/       StateMachine, GameManager (single loop, round ids, watchdogs), LoopDriver (only requestAnimationFrame user)
src/dessert/    types, validation, data/*.ts (one file per dessert), DessertManager (shuffle bag)
src/cooking/    ProgressManager (the only place progress changes, clamped 0..100), CookingSystem (steps, bands, watchdog)
src/anim/       AnimationManager (cancelable, round-tagged tweens), ParticleSystem (capped)
src/audio/      AudioManager (synthesized sounds, voice cap, silent when unavailable)
src/render/     Renderer (Canvas 2D scene)
src/tiktok/     TikTokEventManager (validate, dedupe, bounded queue, coalesce, cooldowns), MockEventSource, WebSocketSource
src/reward/     RewardManager, ProgressionManager
src/save/       SaveSystem (versioned, validated, never throws)
src/ui/         UIManager (six-element HUD)
src/Game.ts     composition root
server/         local bridge (HTTP in, WebSocket out)
```

Adding a dessert: add one file in `src/dessert/data/` and one line in `data/index.ts`. Recipes are validated at load.

## Stability rules (what the tests pin down)

- Explicit state machine, illegal transitions rejected; no game-over state.
- Every event, animation, sound and timer carries a `roundId`; stale ones are dropped or cancelled at round end.
- `completeRound` and `award` are idempotent; progress is clamped in one place.
- Every state, step and animation has a watchdog; nothing waits forever.
- Event flood: validated, deduplicated, queued with a bound, coalesced into one effect per tick.
- TikTok/bridge loss, storage failures and audio failures degrade silently; the game keeps cooking.

## Tests

`npm test` runs ~245 tests, including: 120–150 round soaks (loop, cooking, fx leaks, event chaos, progression with flaky
storage), a 600-round memory/CPU check, bridge security/limits tests, and WebSocket reconnect tests.
Browser checks (Playwright) were run by hand for the visuals, HUD, save/reload, mock mode and a bridge kill/restart.

## Known limits

- Sound is synthesized (no recorded foley); visuals are stylized 2D, not a physics engine.
- Audio and visual quality were checked by screenshot and automated tests only; nobody has listened to or watched a live stream of it yet.
- A hidden or minimized browser tab pauses `requestAnimationFrame`, so the game pauses. Keep the capture source visible, or use an OBS browser source.
