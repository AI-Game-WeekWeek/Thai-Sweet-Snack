# Khanom Krok Shop Mode — Design Spec (draft for approval)

Date: 2026-11-12 · Status: **CANCELLED by the user; superseded by 2026-11-12-menu-vote-mode-design.md**
Builds on: `2026-11-12-thai-dessert-asmr-design.md` (Phases 1–8, unchanged)

## 1. Goal

Add a TikTok-Live "cooking shop" gameplay on top of the existing project, not a new project:
two khanom krok pans with many holes → pour batter → add toppings → cooking status → pick cooked pieces →
place on tray / banana-leaf bowls → customers (viewers' avatars) take them and pay → next batch, endlessly.
Viewers help with likes, follows and gifts; supporters appear as avatars. The reference screenshot shows the intended
layout (2 pans, pitcher pouring, wire tray with banana leaf, leaf bowls with `n/10`, "on tray x/goal", mascot cat,
avatars with piece counts at the bottom, a gift menu "ช่วย/สั่ง + coin value"). Art will be drawn procedurally and be
original; nothing is copied from the screenshot.

## 2. Phase A result: what the current code gives us

| Existing part | Reuse | Change needed |
|---|---|---|
| `GameManager`, `StateMachine`, `LoopDriver` | **as is** (single loop, round ids, watchdogs, cleanup hook) | none. A "round" becomes a *shift* |
| `AnimationManager`, `ParticleSystem`, `AudioManager` | as is | add anim ids `sprinkle`, `scoop`, `plate`, sounds `coin`, `scoop` (additive) |
| `TikTokEventManager` (validate/dedupe/queue/coalesce/cooldown/stale) | as is | additive: `EventEffects` also carries bounded per-gift details and a follow count; `LiveEvent` gets optional `giftName`, `avatarUrl` |
| `MockEventSource`, `WebSocketSource`, bridge | as is | additive: mock gifts/follows with names and generated avatars; bridge relays the two new optional fields |
| `RewardManager`, `ProgressionManager`, `SaveSystem` | as is | additive: `earn(coins, score, saleId)` (idempotent per sale); unlock ids namespaced (`topping:corn`, `pan:holes+`) |
| `UIManager` | extend | add tray counter, customer queue, helper count, supporter board, gift menu (config-driven) |
| `Renderer` | keep for classic mode | new `ShopRenderer` for the shop scene |
| `Game` (composition root, 397 lines) | keep | one seam: a `CookingBackend` interface implemented by existing `CookingSystem` (classic) and new `ShopSystem` (shop); events call the backend instead of `cooking.*` directly |
| Tests/soak/perf | reuse harnesses | new shop soak, extend the leak test |

Old single-dessert mode stays available as `?mode=classic`; nothing is deleted.

## 3. Design

**Shift = round.** The state machine is unchanged. PREPARING (open shop, reset pans) → COOKING (service: shop
simulation runs) → PRESENTING (shift summary) → REWARDING (shift award via `RewardManager`) → NEXT_DESSERT → PREPARING.
COOKING ends when the shift goal is sold (progress = sold / goal × 100, so the existing progress bar, clamp and reward
code are reused) or at the existing watchdog (`maxMs.cooking`, set to the shift length cap). Everything of a shift
(holes, tray, customers, helpers, avatars, effects) is cancelled by `roundId` at cleanup.

**Shop domain (`src/shop/`, pure logic, no rendering):**
- `Pan`: 2 pans × N holes (config, default 24). Each hole is a small state machine with a legal-transition table:
  `EMPTY → BATTER → TOPPED(optional) → COOKING → READY → (PICKED → EMPTY | BURNT → EMPTY)`; every hole has a
  generation counter, so a late/duplicate action on an old state is rejected (no double production, no double pick).
- `Station`: pour sweep (fills the next empty holes), topping (spring onion / corn / taro; unlock by coins),
  cook timers, ready window then burn (burnt pieces are discarded, no sale), pick (READY → item on tray).
- `Tray` / `Bowls`: wire tray with banana leaf, picked items get unique ids; plating moves items into leaf bowls
  (capacity 10); a bowl is the unit sold.
- `Customers`: orders `WAITING → SERVING → PAID | LEFT`; payment happens once, at the `PAID` transition, through
  `earn(..., saleId)`. Patience timer makes unserved customers leave, so nothing can stall. Queue visible ≤ 4, overflow
  counted, hard cap.
- Auto-chef: an automatic cook (mascot) performs pour → topping → pick → plate at a base speed, so the game runs with
  zero viewers or with TikTok disconnected. The streamer may also tap to pick/serve (optional, no extra buttons).

**TikTok mapping (all numbers in `gameConfig`):**
| Event | Effect |
|---|---|
| Like | production boost: cooking speed multiplier and auto-chef speed (coalesced per tick, capped) |
| Follow | adds a helper (auto-pick/plate) for a time; stacking capped (default 5) |
| Gift (by coin tier from config) | "help" tier: instant burst (fill + top all empty holes / ripen all / pick all); "order" tier: that viewer's avatar orders N pieces and pays; large gift: special action |
| Rose | visual effect (existing cooldown) |
| Share | bonus % on the shift reward (existing rule) |

Gift tiers are matched by coin value first (gift names are not guaranteed by providers); the screenshot's
"ช่วย 40 / สั่ง 60 / ช่วย 200 / สั่ง 200 / ช่วย 1000" becomes a configurable table, shown as a gift menu in the HUD.

**Avatars and supporters:** gift/order events may carry `user` and optional `avatarUrl`. Default avatar is generated
(initial + colour, no network). Remote images only if the host is on a configurable allowlist, loaded through a
bounded LRU cache (≤ 32 bitmaps, released on eviction/cleanup), with a timeout and fallback to the generated avatar.
Reason: arbitrary image URLs would make the streamer's browser contact unknown hosts. Viewer nicknames are personal
data: an "anonymous supporters" config switch hides names. A supporter board lists the top supporters of the session.

**Stability rules carried over:** one loop (`LoopDriver` → `GameManager`), one event pipeline
(`TikTokEventManager`), everything round-tagged and cancelled at cleanup, idempotent sales/picks/production, caps on
customers/helpers/avatars/particles, no network dependency for gameplay, mock events for every feature.

## 4. Files affected

New: `src/shop/{types,Hole,Pan,ShopSystem,Customers,Tray}.ts`, `src/shop/gifts.ts` (tier table), `src/render/ShopRenderer.ts`,
`src/render/AvatarCache.ts`, tests under `tests/unit/shop*`, `tests/soak/shop.soak.test.ts`.
Modified (additive): `src/Game.ts` (backend seam + mode), `src/main.ts` (`?mode=`), `src/config/gameConfig.ts`
(shop/gift/avatar config), `src/dessert/types.ts` (new anim/sound ids), `src/audio/AudioManager.ts` (2 recipes),
`src/tiktok/{types,parseLiveEvent,TikTokEventManager,MockEventSource}.ts`, `server/bridge.ts` (relay new optional fields),
`src/reward/RewardManager.ts` (`earn`), `src/ui/UIManager.ts`, `tests/perf/leak.test.ts`, `README.md`, `docs/tiktok-integration.md`.
Untouched: `GameManager`, `StateMachine`, `LoopDriver`, `AnimationManager`, `ParticleSystem`, `SaveSystem`, `WebSocketSource`.

## 5. Plan by phase (each ends with tests passing before the next)

- **B** Shop domain: holes/pans/pour/toppings/cooking/auto-chef + `ShopRenderer` v1 + `CookingBackend` seam; classic mode regression tests unchanged.
- **C** Pick, tray, bowls, customers, payment, patience, shift goal and reward; HUD tray/queue.
- **D** Events → shop: likes, follows/helpers, gift tiers, extended mock events; disconnect test.
- **E** Avatars (generated + allowlisted remote), supporter board, privacy switch.
- **F** Soak (≥150 shifts, event chaos), leak/CPU test, browser frame-time and screenshot checks, docs.

Nothing is called working until its tests pass. Known limits to state at the end: providers may not supply avatar
URLs or gift names; procedural art is simpler than the reference; audio/visual quality is judged by tests and
screenshots, not by a live stream.

## 6. Decisions needed

1. Operation: auto-chef plus optional streamer taps (recommended) vs streamer-only vs viewers-only.
2. Gift semantics: "help" = actions, "order" = viewer avatar orders and pays, by coin tiers in config (recommended).
3. Avatars: generated by default, allowlisted remote images optional (recommended) vs generated only.
4. Keep the old single-dessert mode as `?mode=classic` (recommended) vs retire it.
