# Thai Café Mode (Round 1) — Implementation Plan

> Inline execution (user's standing choice). Spec: `docs/superpowers/specs/2026-11-12-thai-cafe-mode-design.md` (approved with all defaults).

**Goal:** `?mode=cafe` (new default, portrait 9:16): customer queue with patience; a viewer's gift puts that viewer in the queue (profile-picture head slot) ordering the dessert the gift value maps to; hearts speed cooking; serve, pay, next customer; endless; works with zero viewers / no TikTok.

**Seam:** one round = one customer. `GameManager`/`StateMachine`/`LoopDriver` untouched. `Game` gets an optional 8th parameter `cafe` (queue + heart meter), mutually exclusive with `vote`; every cafe branch is behind `if (this.cafe)`.

## Global constraints
- Customer lifecycle `WAITING → SERVING → PAID | LEFT`; pay exactly once; the serving customer never leaves mid-cooking.
- Queue ≤ 12 waiting (config), names ≤ 16 chars, gifts per drain ≤ 20, avatar cache ≤ 24, remote pictures OFF unless a host allowlist is configured (https only, 5 s timeout, fallback to generated).
- Names/pictures come only from gift/rose events, live only while on screen, never saved; comment/other event types keep no names.
- Config in `gameConfig.cafe` / `cafeConfig`; vote and classic mode tests unchanged.

## Review Focus
- Gift with coins 0/NaN/negative/huge/missing; locked dessert; queue full; 500 gifts in one tick; gift while PRESENTING/REWARDING.
- Name with control chars/RTL/very long/empty; avatarUrl with `javascript:`/`data:`/http/off-allowlist/huge.
- Customer paid twice; round ended by watchdog while serving; queue empty at PREPARING; all NPC and viewer orders for locked desserts.
- Hostile render input (NaN patience, 0 customers, 100 customers, 1 000-char name).

## Tasks
1. **C1 pure logic** (tests first): `src/cafe/CafeQueue.ts`, `src/cafe/giftMenu.ts`, `src/cafe/avatars.ts`, `src/render/AvatarCache.ts`; `parseLiveEvent`/`TikTokEventManager` gift details (`displayName`, `avatarUrl`, `EventEffects.gifts`, `RoundInfo.acceptsGifts`); `DessertManager.unlockedIds`; `RewardManager.addCoins`; `MockEventSource` `{ cafe: true }` (gifts with names and coin values); `gameConfig.cafe` + `cafeConfig`.
2. **C2 Game wiring:** customer = round (order → dessert), NPC spawning, gifts → queue, patience leave, payment with patience bonus, heart meter, snapshot/renderView `cafe` view; `tests/unit/GameCafe.test.ts`.
3. **C3 portrait UI:** `Renderer.drawScene` extraction, `src/render/CafeRenderer.ts` (awning, lanterns, wall, gift menu board, counter + existing station scene, lucky cat, queue with head slots, patience bars, order bubbles), `main.ts` (`?mode=cafe` default, portrait canvas, avatar cache), page styles; `tests/unit/CafeRenderer.test.ts`.
4. **C4 verify:** `tests/soak/cafe.soak.test.ts`, extend leak test, Playwright playthrough + portrait screenshots + real-bridge gift, README/docs, independent review and fix pass, republish the hosted demo.
