# Thai Dessert ASMR

A small, endless Thai-dessert cooking game for TikTok Live. **Viewers pick the next dessert by commenting 1, 2 or 3,
then tap hearts (likes) to make it cook faster.** The finished dessert is served and sold automatically, and the next
vote opens. Nobody has to learn anything: two things to do, both visible on screen.

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
| `?mode=classic` | the older mode: one dessert at a time, no voting, with a DOM HUD |
| `?mock=1` (`&rate=N`, max 500) | simulated viewers (likes, follows, gifts, comments "1/2/3"); no TikTok needed |
| `?debug=1` | exposes `window.__snapshot()` for automated browser checks |
| `?bridge=ws://127.0.0.1:8787&token=...` | real events through the local bridge, see [docs/tiktok-integration.md](docs/tiktok-integration.md) |
| `?speed=N` | N game updates per frame (testing aid) |

## Important: TikTok

No official public TikTok API for reading LIVE events was found. The game therefore speaks one neutral event format
and ships a small authenticated local bridge; it bundles **no** reverse-engineered connector. You choose a source you
are entitled to use and check TikTok's and the provider's terms. Details and limits: [docs/tiktok-integration.md](docs/tiktok-integration.md).

## How it plays (default mode)

Every round (about 25–40 s):

1. **Vote (15 s, the last 3 s still count after the clock shows 0, for stream delay):** a menu board shows 3 desserts and live vote bars. Viewers comment `1`, `2` or `3` (also `#2`).
   Most votes wins, a tie is random, **no votes = the first dessert**, so the show never waits.
2. **Cook:** the winner is cooked step by step with animation and ASMR sound. Progress also rises on its own, so it
   works with zero viewers.
3. **Hearts:** while it cooks, every like, orange heart and small gift fills the heart meter (up to ×4 cooking speed); it
   drains over time. A follow adds a chunk; a large gift completes the current step; a share adds a reward bonus. Likes sent
   during the vote window do not count.
4. **Served and sold:** the dessert goes on the tray, the screen shows `+score +coins`, then the next vote starts.

All numbers are in `src/config/gameConfig.ts` (`vote`, `events`, `reward`). Coins unlock the other desserts automatically
(cheapest affordable first); nothing requires real money or gifts. Progress is saved in the browser (`localStorage`).

**Privacy:** a comment is only ever turned into a vote number. The text is never stored, shown or relayed, and nicknames are dropped from every event;
an opaque viewer key is used only to allow one vote per viewer per round.

**Provider dependency:** votes need an event source that delivers comments (and ideally a user key). If yours does not,
the menu simply rotates by itself (never the same dessert twice in a row); likes, follows and gifts still work. See [docs/tiktok-integration.md](docs/tiktok-integration.md).

## Architecture

```
src/config/     gameConfig.ts           every tunable number
src/core/       StateMachine, GameManager (single loop, round ids, watchdogs), LoopDriver (only requestAnimationFrame user)
src/dessert/    types, validation, data/*.ts (one file per dessert), DessertManager (shuffle bag)
src/cooking/    ProgressManager (the only place progress changes, clamped 0..100), CookingSystem (steps, bands, watchdog)
src/anim/       AnimationManager (cancelable, round-tagged tweens), ParticleSystem (capped)
src/audio/      AudioManager (synthesized sounds, voice cap, silent when unavailable)
src/render/     Renderer (Canvas 2D scene), VoteRenderer (the whole vote-mode UI on one canvas)
src/tiktok/     TikTokEventManager (validate, dedupe, bounded queue, coalesce, cooldowns), MockEventSource, WebSocketSource
src/vote/       VoteManager (menu vote tally); src/cooking/HeartMeter.ts (likes -> cooking speed)
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

`npm test` runs ~320 tests, including: 120–150 round soaks (loop, cooking, fx leaks, event chaos, progression with flaky
storage, **vote spam / ties / malformed comments**), 400–600 round memory/CPU checks, bridge security/limits tests, and
WebSocket reconnect tests. Browser checks (Playwright) were run by hand: a full round with mock viewers, votes through the
real bridge, a bridge kill/restart, save/reload.

## Known limits

- Sound is synthesized (no recorded foley); visuals are stylized 2D, not a physics engine.
- Audio and visual quality were checked by screenshot and automated tests only; nobody has listened to or watched a live stream of it yet.
- A hidden or minimized browser tab pauses `requestAnimationFrame`, so the game pauses. Keep the capture source visible, or use an OBS browser source.
