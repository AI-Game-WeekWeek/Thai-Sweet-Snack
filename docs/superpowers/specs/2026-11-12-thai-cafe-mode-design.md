# Thai Café Mode (Round 1) — Design Spec (draft for review)

Date: 2026-11-12 · Status: **implemented and tested (Round 1); Round 2 surprise events not started**
Builds on: `2026-11-12-thai-dessert-asmr-design.md` and `2026-11-12-menu-vote-mode-design.md` (both implemented and tested).

## 1. Idea

A portrait (9:16) TikTok-Live game set in the player's own Thai-style café. A queue of customers waits at the counter;
each customer orders one dessert and has a patience timer. **A viewer's gift puts that viewer in the queue as a customer
with their profile picture, ordering the dessert that gift is worth.** Viewers' likes (hearts) make the dessert cook
faster. The finished dessert is served to the customer, who pays and leaves. Then the next customer steps up. Endless,
and still works with zero viewers or without TikTok (anonymous customers keep the queue full).

Round 1 = this core. Round 2 (separate spec, built only after Round 1 plays well): surprise events for follow
("lucky cat"), orange heart / fan club (the **same button**, one event: the viewer becomes a **VIP customer** with a golden
frame at the front of the queue, and a short "tip rain" of coins and lanterns falls), and the phone pre-order call.

Why it stays small: still one dessert cooking at a time, still two viewer inputs the audience needs to learn
(**send a gift to order, tap hearts to speed up**), and no walking staff, no décor, no quests.

## 2. Loop (existing state machine unchanged; one round = one customer)

| State | In café mode |
|---|---|
| PREPARING | The next customer steps to the counter; an order bubble shows the dessert (and who it is for). Short beat (~1.5 s). |
| COOKING | The ordered dessert cooks with the existing recipe steps, animation and ASMR. Hearts speed it up. Customers still waiting lose patience. |
| PRESENTING | The dessert is placed on the tray and handed over. |
| REWARDING | The customer pays (coins scale with remaining patience) and leaves happy; existing `RewardManager.award`. |
| NEXT_DESSERT → PREPARING | Cleanup, auto-unlock, save as today. A new customer may join the queue meanwhile. |

Queue rules (new pure class `CafeQueue`): at most 12 waiting, 5 drawn; waiting customers' patience counts down; one who
runs out **leaves unhappy** (no pay, small angry effect); the customer being served never leaves mid-cooking (so nothing
has to be cancelled). A viewer customer is inserted **right behind the current customer** (a small reward for gifting);
if the queue is full the gift still pays coins to the café (no gift is ever wasted). Anonymous customers spawn on a timer
whenever the queue is short, so the queue is always visibly long.

## 3. Gifts choose the dessert

A configurable table maps gift value to dessert, default (coins → dessert): 1 → ข้าวต้มมัด, 5 → บัวลอย, 10 → ทองหยอด,
20 → ขนมชั้น, 50 → ฝอยทอง, 99 → ทองหยิบ, 199 → ลูกชุบ, 500 → ขนมเบื้อง (highest tier not above the gift value). A dessert
not yet unlocked falls back to the best unlocked one. The same table is drawn as a **menu board on the café wall** so viewers
see "gift = dessert" at a glance. Matching is by coin value (provider-independent); gift names are optional extra info.
Likes (hearts) keep their current meaning: heart meter → cooking speed ×4 max.

## 4. Viewer in the game (profile picture on the customer's head)

Each customer has a round head slot. Viewer customers show the viewer's picture and a short display name; anonymous
customers show a generated face/colour. Rules:
- Name and picture come only from **gift events** (new optional fields `displayName`, `avatarUrl` on gift/rose events),
  live only as long as that customer is on screen, are **never saved**, never leave the page.
- **Remote pictures are off by default.** Turning them on requires an allowlist of image hosts in config, https only, a
  5 s timeout, a cache of at most 24 images that is released on eviction, and automatic fallback to a generated avatar on any
  failure. Reason: an arbitrary image URL would make the streamer's browser contact unknown servers.
- A config switch `anonymousNames` hides all names (pictures too) for streamers who prefer it.
- Provider dependency: pictures and names exist only if the event source sends them (not verified for any provider).

## 5. Portrait screen and scene (all drawn procedurally, original art)

World 1080 × 1920, scaled to fit. Top to bottom: **Thai-style awning** with the shop sign and hanging lanterns; **wooden wall**
with a Thai-pattern frieze and the **gift menu board**; **counter** with the cooking bowl / step animation (existing scene
reused in a window), the heart meter and the progress bar; the **serving tray** and a **lucky cat** mascot; the **queue** at the
bottom (front customer large, up to 4 more behind) with order bubbles and patience bars; coin count at the top right.
Only a few large, outlined elements (readable on a phone at stream resolution). Café mode is the new default
(`?mode=cafe`); `?mode=vote` and `?mode=classic` stay available and tested.

## 6. Architecture and reuse

Reused unchanged: `GameManager`, `StateMachine`, `LoopDriver`, `CookingSystem`, `ProgressManager`, `HeartMeter`,
`AnimationManager`, `ParticleSystem`, `AudioManager`, `TikTokEventManager` (extended), `MockEventSource` (extended),
`WebSocketSource`, bridge, `RewardManager`, `ProgressionManager`, `SaveSystem`, dessert data.

New (small, separate): `src/cafe/CafeQueue.ts` (pure queue + patience), `src/cafe/giftMenu.ts` (coins → dessert),
`src/cafe/avatars.ts` (generated avatar spec), `src/render/AvatarCache.ts` (allowlist, LRU, timeout), `src/render/CafeRenderer.ts`.
Additive edits: `Game.ts` (café option: customer = round, order from the queue, gifts enqueue), `gameConfig.ts` (`cafe` section,
`cafeConfig`), `tiktok/{types,parseLiveEvent,TikTokEventManager,MockEventSource}.ts` (gift details: coins, `displayName`,
`avatarUrl`, bounded per drain), `main.ts` (`?mode=cafe`, portrait canvas), `index.html`/page styles (portrait layout),
`server/bridge.ts` (relay new fields via the shared parser), docs.
Privacy rule change: nicknames are no longer dropped from **gift** events (needed for the queue); they stay out of comments, of
saves and of all other event types.

## 7. Stability and safety rules

- Everything is round-tagged and cleaned up at round end; customers carry no state across rounds except the queue itself,
  which is bounded (12) and reset on reload.
- Idempotent: a customer is paid once (state `WAITING → SERVING → PAID | LEFT`, payment only at `PAID`); one order per
  customer; a duplicate gift (same event id) is already dropped by the existing dedupe.
- Caps: 12 queued, 24 cached images, gifts per drain, name length 16 characters, particles.
- Zero viewers / TikTok down: anonymous customers keep coming; the loop never waits. Mock events cover gifts, hearts, avatars.
- Existing watchdogs (state and cooking) stay as the backstop.

## 8. Testing and acceptance

Unit: `CafeQueue` (order, patience, leave, cap, viewer insert position, serving customer never leaves, pay once),
`giftMenu` (tiers, boundaries, invalid coins, locked fallback), gift parsing (details kept only for gifts, truncated, no
other type keeps a name), `AvatarCache` with a fake loader (allowlist, https only, timeout, eviction releases, bounded),
`Game` café flow (gift order cooks the matching dessert, queue FIFO with viewer behind current, heart speed-up, unhappy
leave, zero-viewer loop, TikTok drop), `CafeRenderer` (hostile values never throw, canvas state balanced).
Soak: ≥150 customers with gift spam, ties of arrival, hostile names/urls, flaky storage; extend the leak/CPU test.
Browser: portrait screenshots of the full scene and a played round with mock viewers; real bridge with a gift.
Acceptance: the loop never stalls; progress ≤ 100; no customer paid twice or lost; queue and cache bounded; names and pictures
never saved; works with no viewers and without TikTok; vote and classic mode tests unchanged.

## 9. Phases

- **C1** pure logic: `CafeQueue`, `giftMenu`, gift detail parsing, `AvatarCache` (all tested).
- **C2** `Game` café wiring and mock events.
- **C3** `CafeRenderer` (portrait scene, customers with head slots, gift menu board), `?mode=cafe` default, portrait page.
- **C4** soak, leak/CPU, browser checks, docs, independent review, fixes.

## 10. Decisions to confirm (defaults in brackets)

1. Gift → dessert table as in §3 [as written; every number is config].
2. Remote profile pictures [off by default; generated avatars; names shown].
3. Viewer customer joins right behind the current customer [yes].
4. Café mode becomes the default; vote and classic stay as options [yes].

## 11. Known limits

Pictures, names and gift values depend on the event provider (none verified); art is procedural and simple; sound and visuals are
checked by tests and screenshots, not on a live stream; the surprise events and the phone call are Round 2. Orange heart and fan club are
treated as one event (`orangeHeart` in our event format); whether a given provider sends it is not verified.

## 12. Changes made during build

- The shop opens with a visible queue (anonymous customers are pre-seeded) instead of an empty counter.
- Large gifts no longer complete a cooking step in café mode: every gift is an order (the old `completeStep` rule applies to classic mode only).
- A gift with an unknown value counts as 1 coin; a name or picture that fails validation just makes the customer anonymous.
- After two independent reviews: viewers are served first-come first-served among themselves (a combo of gifts cannot jump the
  line); gifts over the per-tick cap are deferred, never dropped; a gift that finds the queue full pays a flat 2 coins
  (`cafe.overflowGiftCoins`) instead of its face value (it inflated the economy); `count` may be omitted on single events; the
  portrait canvas keeps its 9:16 shape in any window.
- Known, deferred minors: names are cut by code point (a Thai tone mark can be cut off, ZWJ emoji split); `AvatarCache` ignores the
  port, does not re-check redirects, needs punycode hosts, and keeps up to 24 picture URLs after their customers leave;
  neighbouring long names can overlap in the waiting row; the 720x1280 backing canvas looks soft in a 1080x1920 OBS source;
  small per-frame allocations in `cafeView`; `AvatarCache` could be cut entirely if pictures are never used.

## 13. Round 2: surprise events (approved scope, details decided here)

Each is one event the audience can trigger, each is visible at a glance, each is bounded and config-driven.

| Viewer does | What happens (defaults in `cafe.surprise`) |
|---|---|
| **Follow** | **Lucky cat (แมวกวัก)** for 20 s per follow (stacks up to 60 s): payouts +100 %, waiting customers lose patience at half speed. The cat glows and a pill "แมวกวัก ×2" with a timer shows at the top. Works in every state. Follows carry no name (privacy: nothing is shown about the follower). |
| **Orange heart / fan club** (same button) | **VIP customer + tip rain.** An anonymous VIP with a golden crown goes to the **front of the waiting line** and orders the dessert of the 50-coin tier (the best unlocked tier at or below it); pays +50 %. Every waiting customer throws a tip: a coin shower and 3 coins per waiting customer (max 36). At most one VIP waiting; 30 s cooldown (extra hearts still feed the heart meter). Works in every state. |
| *(nobody: random, about every 100 s, first after 45 s)* | **Phone call.** The phone on the counter rings for 3 s, then a **phone-order customer** joins right behind the current customer with a **35 s deadline** (their patience) and orders a random unlocked dessert; served in time = payout +200 %, too slow = they hang up (customer lost, nothing else happens). Only one phone customer at a time. |

Queue priority (first-come first-served within a rank): VIP, phone order, viewer (gift), anonymous.
Sounds: new synthesized `ring` and `coin`. Everything is round-tagged and cleaned up; a surprise can never block the loop,
double-pay a customer, or touch the save (nothing about followers or orange-heart senders is stored or shown).
Provider dependency: follow and orange-heart events exist only if the event source sends them (not verified); without them
only the phone call happens, and the café works as before.
- Round 2 build notes: a VIP or phone order **replaces the last anonymous (filler) customer when the queue is full**; the call or VIP is
  skipped only when every waiting customer is a paying viewer (found by the soak: gift floods kept the queue full, so the phone never
  rang). Surprise sounds are tagged with a live round (the next one when fired during NEXT_DESSERT). `?surprise=1` brings the first
  phone call forward to 6 s for demos and screenshots.
- **Everyday dessert (user request):** a 9th dessert, ข้าวต้มมัด, is always unlocked. Anonymous customers and phone orders always order it, so
  with no gifts the café serves only ข้าวต้มมัด; the other eight desserts are ordered by a viewer's gift (gift tiers) or by a VIP
  (orange heart, 50-coin tier). `cafe.defaultDessertId` sets it; if it is somehow locked the café falls back to a random unlocked dessert.
- **Menu change (user request):** ขนมครก was removed from the game; **ข้าวต้มมัด** (black-bean and banana filling) is the first menu item and the
  1-coin gift tier. There are 8 desserts. Old saves that list ขนมครก simply drop it. Each gift is its own customer, so a gifting viewer is
  served the dessert they paid for, separately from other viewers (guarded by tests).
- **Round 2 review outcome (changed from §13):** lucky cat pays +50 % (not +100 %); tip rain is 1 coin per waiting customer (max 12); VIP cooldown
  is 60 s; **a VIP is called after gifting viewers** (rank: phone order, viewer, VIP, filler) because a VIP every 30 s starved paying viewers
  and the surprises together doubled coin income; the lucky cat does not slow a phone order's deadline; a ring that cannot place its
  customer retries after 3 s; the phone ignores nonsense settings (ring 0, NaN interval); surprises do nothing before `start()`; the cat pill
  shows the real bonus and sits beside the cat (not at the top of the screen); the phone orders ข้าวต้มมัด (not a random dessert).
  Known, deferred minors: the tip-rain message is only visible in some states (it can be replaced by the payout text) and its coins are
  cleared with the particles at round end; a replaced filler customer vanishes without counting as lost; the "in time" phone bonus means
  "reached the counter in time" (cooking time is not part of the deadline).
