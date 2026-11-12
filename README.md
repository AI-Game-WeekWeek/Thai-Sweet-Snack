# Thai Dessert ASMR

A small, endless Thai-dessert game for TikTok Live, set in your own café (portrait, 9:16). **A queue of customers waits at
the counter. A viewer's gift puts that viewer in the line, with their picture on the customer's head, ordering the dessert
that gift is worth. Viewers tap hearts (likes) to make the cooking faster.** The dessert is served, the customer pays and
leaves, the next one steps up. Two things for viewers to learn, both shown on screen.

Web game: TypeScript, Canvas 2D, Web Audio, Vite. 8 Thai desserts: **ข้าวต้มมัด** (the first menu item and the café's everyday dessert: sticky rice with a black-bean and banana filling, wrapped in banana leaf and served as individual parcels), ขนมชั้น, ลูกชุบ, ฝอยทอง, ทองหยิบ, ทองหยอด, บัวลอย, ขนมเบื้อง.

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
| (default) `?mode=cafe` | the Thai café described below (portrait 9:16) |
| `?mode=vote` | landscape: viewers vote the next dessert with comments 1/2/3 |
| `?mode=classic` | the first mode: one dessert at a time, no queue, with a DOM HUD |
| `?mock=1` (`&rate=N`, max 500) | simulated viewers (likes, follows, named gifts, comments in vote mode); no TikTok needed |
| `?debug=1` | exposes `window.__snapshot()` for automated browser checks |
| `?bridge=ws://127.0.0.1:8787&token=...` | real events through the local bridge, see [docs/tiktok-integration.md](docs/tiktok-integration.md) |
| `?speed=N` | N game updates per frame (testing aid) |

## Important: TikTok

No official public TikTok API for reading LIVE events was found. The game therefore speaks one neutral event format
and ships a small authenticated local bridge; it bundles **no** reverse-engineered connector. You choose a source you
are entitled to use and check TikTok's and the provider's terms. Details and limits: [docs/tiktok-integration.md](docs/tiktok-integration.md).

## How it plays (default: Thai café)

1. **Queue:** customers line up (the front one large, up to 4 more behind, 12 waiting at most). Each orders one dessert and
   has a patience bar; someone who waits too long leaves unhappy. Anonymous customers keep the queue full, so it works
   with zero viewers. **Without gifts they all order ข้าวต้มมัด** (`cafe.defaultDessertId`); every other dessert is
   ordered only because a viewer sent a gift (or by a VIP). Phone orders also ask for ข้าวต้มมัด. Each gift is its own customer: a gifting viewer is served the dessert they paid for, separately from every other viewer (two gifts = two customers).
2. **Gifts order desserts:** a viewer's gift puts that viewer in the queue **right behind the customer being served**,
   with their name and a round head slot for their picture, ordering the dessert the gift value maps to. The menu board
   on the café wall shows the table (default coins → dessert: 1 ข้าวต้มมัด, 5 บัวลอย, 10 ทองหยอด, 20 ขนมชั้น, 50 ฝอยทอง,
   99 ทองหยิบ, 199 ลูกชุบ, 500 ขนมเบื้อง; change it in `gameConfig.cafe.giftTiers`). A dessert that is not unlocked yet
   falls back to the best unlocked one. If the queue is full, the gift still pays coins to the café.
3. **Hearts:** while it cooks, every like, orange heart and small gift fills the heart meter (up to ×4 cooking speed); it
   drains over time. Likes sent while nothing is cooking do not count.
4. **Served and paid:** the customer pays once (more if they barely waited), the screen shows `+score +coins`, and the next
   customer steps up. A share adds a reward bonus.

All numbers are in `src/config/gameConfig.ts` (`cafe`, `vote`, `events`, `reward`). Coins unlock the other desserts
automatically (cheapest affordable first); nothing requires real money. Progress is saved in the browser (`localStorage`).

**Privacy:** names and picture URLs come only from **gift** events, live only while that customer is on screen, and are never
saved. Comments, likes and other events carry no names. `cafe.anonymousNames` hides every name and picture.
**Remote profile pictures are off by default**: customers get a generated face/initial. To show real pictures, list the image
hosts in `cafe.avatar.hosts` (https only, 5 s timeout, at most 24 cached, automatic fallback). Note that names and pictures
pass through the bridge when a provider sends them.

**Provider dependency:** gift value, name and picture exist only if your event source sends them (none verified). Without a
value a gift counts as 1 coin; without a name or picture the customer is anonymous. If gifts do not arrive at all, anonymous
customers keep the café running.

### Surprise events (café mode)

| Viewer does | What happens (numbers in `cafe.surprise`) |
|---|---|
| **Follow** | **Lucky cat (แมวกวัก):** 20 s per follow (stacks to 60 s): payouts +100 %, waiting customers lose patience at half speed. |
| **Orange heart / fan club** (one button) | **VIP customer + tip rain:** an anonymous VIP with a golden crown goes to the front of the waiting line (orders the 50-coin dessert, pays +50 %); every waiting customer tips (3 coins each, max 36). One VIP at a time, 30 s cooldown. |
| *(nobody: about every 100 s)* | **Phone call:** the phone rings, then a phone-order customer joins right behind the current customer with a 35 s deadline; served in time = +200 %, too slow = they hang up. |

VIP and phone orders replace the last anonymous (filler) customer when the line is full; they never push out a paying viewer.
Nothing about who followed or sent an orange heart is shown or stored. `?surprise=1` brings the first phone call forward to 6 s.

### Vote mode (`?mode=vote`)
Viewers comment `1`, `2` or `3` to choose among 3 desserts for 15 s (the last 3 s still count for stream delay); most votes
wins, a tie is random, no votes = the first one. Comments are only ever turned into a vote number.

## Architecture

```
src/config/     gameConfig.ts           every tunable number
src/core/       StateMachine, GameManager (single loop, round ids, watchdogs), LoopDriver (only requestAnimationFrame user)
src/dessert/    types, validation, data/*.ts (one file per dessert), DessertManager (shuffle bag)
src/cooking/    ProgressManager (the only place progress changes, clamped 0..100), CookingSystem (steps, bands, watchdog)
src/anim/       AnimationManager (cancelable, round-tagged tweens), ParticleSystem (capped)
src/audio/      AudioManager (synthesized sounds, voice cap, silent when unavailable)
src/render/     Renderer (cooking station), VoteRenderer (vote UI), CafeRenderer (portrait café), AvatarCache (allowlisted pictures)
src/cafe/       CafeQueue (customers, patience, pay once), giftMenu (gift value -> dessert), avatars (generated faces)
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

`npm test` runs ~400 tests, including: 120–150 round soaks (loop, cooking, fx leaks, event chaos, progression with flaky
storage, vote spam, **café gift spam / hostile names and pictures**), 400–600 round memory/CPU checks, bridge security/limits tests, and
WebSocket reconnect tests. Browser checks (Playwright) were run by hand: a full round with mock viewers, votes through the
real bridge, a bridge kill/restart, save/reload.

## Known limits

- Sound is synthesized (no recorded foley); visuals are stylized 2D, not a physics engine.
- Audio and visual quality were checked by screenshot and automated tests only; nobody has listened to or watched a live stream of it yet.
- A hidden or minimized browser tab pauses `requestAnimationFrame`, so the game pauses. Keep the capture source visible, or use an OBS browser source.
