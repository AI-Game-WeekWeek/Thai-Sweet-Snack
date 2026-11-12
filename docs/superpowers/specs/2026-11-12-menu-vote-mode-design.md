# Menu-Vote Mode — Design Spec (draft for review)

Date: 2026-11-12 · Status: **waiting for user review, no code written yet**
Builds on: `2026-11-12-thai-dessert-asmr-design.md` (Phases 1–8, unchanged).
Supersedes: `2026-11-12-krok-shop-mode-design.md` (cancelled by the user; its unfinished files are kept only in a local git stash).

## 1. Idea

A small TikTok-Live cooking game in the same project, as a new mode (`?mode=vote`, classic mode stays default-compatible).
Viewers **vote for the next dessert by commenting 1, 2 or 3**, help it cook by **tapping hearts (likes)**, and the finished
dessert is **served at the shop front** and sold automatically. Then the next vote opens. It loops forever and keeps
working with zero viewers or without TikTok.

Out of scope (explicitly cut): customers walking around, staff, viewer avatars, shop decoration, quests, multiplayer, a
full restaurant-management game.

## 2. Loop (one round = one dessert, existing state machine unchanged)

| State | What happens in this mode |
|---|---|
| PREPARING | **Vote window** (15 s, config). A menu board shows 3 candidate desserts (drawn from the unlocked ones) with live vote bars and a countdown. |
| COOKING | The winning dessert is cooked with the existing step recipe (animation + ASMR per step). Hearts speed it up. |
| PRESENTING | The finished dessert is plated and placed on the shop-front counter display. |
| REWARDING | Sold automatically: pieces leave the counter, coin sound, existing `RewardManager` award. |
| NEXT_DESSERT → PREPARING | Cleanup, auto-unlock/save as today, next vote opens. |

No new state is added: the vote window is the PREPARING phase with a longer duration, and the winner is resolved when
COOKING is entered. This keeps `GameManager`, `StateMachine`, `LoopDriver` and all their tests untouched.

## 3. Voting

- A viewer comment whose trimmed text is exactly `1`, `2` or `3` (also `#1`) is a vote; any other comment is ignored and
  **comment text and usernames are never stored or shown** (only the vote number is kept).
- One vote per user per round when the provider supplies an opaque user id; the last vote of a user replaces the earlier
  one. Without a user id, votes are capped per second (config) so one source cannot stuff the box.
- Votes count only during the vote window of the current round (round-tagged, stale or late votes are dropped).
- Winner = most votes; ties are broken randomly; **no votes → the first candidate wins** (candidates come from the existing
  shuffle-bag, so the menu still rotates). A vote round can never block: it always ends at the PREPARING timer.
- Provider dependency: comments are only available if the chosen event source sends them (not verified for any provider).
  If not, the mode degrades to automatic rotation.

## 4. Heart help

- Likes feed a **heart meter** (new, small): every like adds heat; the meter decays over time and multiplies the cooking
  progress rate (capped, config). Follow adds a chunk to the meter; a large gift completes the current step (existing rule);
  rose keeps its visual effect; share keeps its reward bonus. The existing coalescing, caps and cooldowns apply unchanged.
- The existing progress clamp, step watchdogs and idempotent completion remain the safety net.

## 5. Shop front (visuals, deliberately simple)

One Canvas scene: a **menu board** (3 slots, name, colour swatch, vote bar, countdown) at the top, the existing work bowl /
step animation in the middle, a **counter with a display tray** at the bottom that shows the last finished desserts and
empties with a coin effect when sold. Procedural art, original, no assets. HUD stays the six existing elements plus the vote
countdown and heart meter.

## 6. Architecture and reuse

Reused as is: `GameManager`, `StateMachine`, `LoopDriver`, `CookingSystem`, `ProgressManager`, `DessertManager`,
dessert data, `AnimationManager`, `ParticleSystem`, `AudioManager`, `TikTokEventManager`, `MockEventSource`, `WebSocketSource`,
bridge, `RewardManager`, `ProgressionManager`, `SaveSystem`, `UIManager`.

New (small, separate files): `src/vote/VoteManager.ts` (pure tally), `src/cooking/HeartMeter.ts`, `src/render/VoteRenderer.ts`
(board + counter scene), config section `vote`.
Additive edits: `tiktok/{types,parseLiveEvent,TikTokEventManager,MockEventSource}.ts` (event type `comment` with `text`
and optional `userId`; text reduced to a vote number at ingest and discarded), `CookingSystem` (optional rate multiplier),
`Game.ts` (candidate picking in PREPARING, winner at COOKING, vote casting from drained effects), `DessertManager`
(`pickCandidates(n)`), `main.ts` (`?mode=vote`), `UIManager` (countdown, meter), `server/bridge.ts` (relays via the shared
parser, no change expected), `README.md`, `docs/tiktok-integration.md`.

## 7. Failure and stability rules

- Votes/hearts/events are round-tagged; cleanup cancels the vote and the meter with the round.
- Idempotent: one winner per round, `completeRound` and `award` unchanged; vote casting after the window is a no-op.
- Caps: voters per round (default 5 000), per-second votes without user id, comment length 200 chars at parse.
- TikTok loss: no votes arrive, menu rotates, hearts stop, the game keeps running. Mock events cover votes and hearts.

## 8. Testing and acceptance

Unit: `VoteManager` (count, one vote per user, replace, tie, no votes, late/stale round, flood, invalid choices), comment
parsing (valid forms, text never retained), `HeartMeter` (decay, cap, invalid input), `DessertManager.pickCandidates`
(distinct, within unlocked, fewer than 3 unlocked), `Game` vote flow (winner cooked, no-vote rotation, votes during COOKING
ignored, old-round votes ignored, disconnect mid-vote).
Soak: ≥150 rounds with vote spam, ties, duplicates, malformed comments, flaky storage; leak/CPU test extended.
Browser: screenshot of board and counter, vote via mock and via the real bridge, kill/restart bridge.
Acceptance: the loop never stalls, progress ≤ 100, no stale vote or event affects a new round, comment text never persisted,
works with no viewers and without TikTok, classic mode tests unchanged.

## 9. Phases

- **V1** event `comment` + `VoteManager` + `HeartMeter` + `DessertManager.pickCandidates` (pure logic, tested).
- **V2** `Game` wiring (candidates in PREPARING, winner at COOKING, meter multiplier) and mock events; HUD countdown and meter.
- **V3** `VoteRenderer` (board, counter display, sold effect) and `?mode=vote`.
- **V4** soak, leak/CPU, browser checks, docs, independent review and fixes.

## 10. Known limits

Comments depend on the event provider; a vote needs a number only (no text commands); art is simple; audio/visual quality is
checked by tests and screenshots, not on a live stream.
