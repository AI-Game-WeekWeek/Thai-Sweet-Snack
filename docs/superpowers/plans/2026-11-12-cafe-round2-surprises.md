# Café Round 2: Surprise Events — Implementation Plan

> Inline execution. Spec: `docs/superpowers/specs/2026-11-12-thai-cafe-mode-design.md` §13.

**Goal:** lucky cat (follow), VIP + tip rain (orange heart / fan club), phone pre-order (random), all visible, bounded, tested.

## Global constraints
- No new loop or event pipeline: follows / orange hearts reach `Game` through `TikTokEventManager` effects (counts only, no names).
- Customer kinds `normal | vip | phone` with a priority rank in `CafeQueue`; payment still happens once in `awardRound`.
- Everything in `cafe.surprise` config; timers use the game clock (`dt`), nothing uses real timers; cleanup on round end where round-bound.

## Review Focus
- 10 000 follows / orange hearts in one tick; VIP while a VIP is waiting; phone call with a full queue; phone customer timing out while another customer is served.
- Lucky cat stacking beyond its cap; patience slowdown applied to the serving customer (must not); payout bonus stacking with share bonus (cap).
- A VIP or phone customer paid twice or left at the counter.

## Tasks
1. **R1 logic:** `cafe.surprise` config; `CafeQueue` kinds, priority insert, per-customer patience, `tick(dt, slow)`; manager `surprises: {follows, orangeHearts}` in any state when `acceptsGifts`; sounds `ring`, `coin`.
2. **R2 Game:** lucky cat timer + payout/patience effect; VIP + tip rain with cooldown; phone scheduler (ring → order → deadline); `CafeView` fields; tests.
3. **R3 render:** top pills (cat timer, phone), crown/VIP badge, phone badge, glowing cat, phone icon ringing; coin shower particles; tests.
4. **R4 verify:** soak and leak updates with surprise spam, browser screenshots (`?surprise=1` shortens the first call), real-bridge follow/orange-heart, docs, independent review, republish demo.
