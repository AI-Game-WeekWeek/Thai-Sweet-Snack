# Menu-Vote Mode — Implementation Plan (minimal scope)

> Inline execution (user's choice). Spec: `docs/superpowers/specs/2026-11-12-menu-vote-mode-design.md`.
> Cuts decided after a viewer/marketing/dev review: no DOM HUD in this mode (everything is drawn on the canvas), no separate
> counter display (the existing tray is the shop front, plus a big "sold +N" message), no extra counters. Round target ≈ 40 s.

**Goal:** `?mode=vote` (new default): 15 s vote by comment 1/2/3 → winner cooks → hearts speed it up → served and sold → next vote.

## Global constraints
- `GameManager`, `StateMachine`, `LoopDriver` untouched. Vote window = PREPARING phase; winner resolved on entering COOKING.
- Comment text and usernames are never stored (only the vote number and an opaque user key for one-vote-per-user).
- All round-tagged and cleaned up at round end; no viewers / no TikTok → menu rotates, game keeps running.
- Config in `gameConfig.vote`; classic mode behaviour and tests unchanged.

## Review Focus
- 100 000 comments in one tick; same user voting 1000 times; votes for choice 0/4/NaN; votes arriving after the window or from the previous round.
- Tie; zero votes; fewer than 3 unlocked desserts.
- Likes during the vote window; likes while cooking with the meter at max; hostile numbers into the meter.
- Disconnect mid-vote; round watchdog while voting.

## Tasks
1. **Event + vote core (pure):** `tiktok/{types,parseLiveEvent,TikTokEventManager}` (`comment` → `vote`, drop text; `EventEffects.votes/likes/follows`; `RoundInfo.voting`), `src/vote/VoteManager.ts`, `src/cooking/HeartMeter.ts`, `DessertManager.pickCandidates`, `CookingSystem.rateMultiplier`, mock comments. Tests first for each.
2. **Game wiring:** vote mode option in `Game` (candidates in PREPARING, winner in COOKING, meter multiplier, votes from drained effects, snapshot/renderView vote fields); `gameConfig.vote` + `voteConfig`.
3. **Canvas UI:** `src/render/VoteRenderer.ts` (menu board with vote bars + countdown + "พิมพ์ 1 2 3", heart meter, progress, sold message), `main.ts` mode switch (default vote, `?mode=classic`).
4. **Soak/perf/browser:** vote soak (≥150 rounds, spam/dupes/ties/malformed/flaky storage), leak test for vote mode, Playwright playthrough with mock + real bridge, screenshots, README, independent review, fixes.
