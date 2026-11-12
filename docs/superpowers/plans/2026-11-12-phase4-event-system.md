# Phase 4: TikTok Event System (Mock Events) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline). Steps use checkbox syntax.

**Goal:** A bounded, deduplicating, coalescing event pipeline that turns viewer events into game effects, round-safe, fully testable with mock events and no TikTok connection.

**Architecture:** `TikTokEventManager` (pure, clock-injected) ingests `LiveEvent`s into a bounded queue; once per tick `drain(ctx)` returns one coalesced `EventEffects`. `Game` applies the effects (progress, complete step, rose visual, share bonus) only while COOKING and only for the active round. `MockEventSource` generates scripted/steady/burst/duplicate/delayed/out-of-order streams.

**Tech Stack:** TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-12-thai-dessert-asmr-design.md` (§9, §13 items 2–7)

## Global Constraints

- Mapping from the spec: like → +progress × count; follow → +progress; orangeHeart → +larger progress; rose → special visual (cooldown); gift ≥ large threshold → complete current step; share → bonus reward. All numbers in `gameConfig.events`.
- Duplicate event ids dropped (bounded LRU). Queue bounded; overflow merges likes, never grows unbounded.
- Progress clamp stays in `ProgressManager`; events never bypass it.
- Events whose source timestamp is before the active round started, or that are drained outside COOKING, never affect progress. Share bonus is banked to the round it arrives in.
- An exception while handling one event drops only that event.
- Connection state `connected | reconnecting | offline` is display-only; gameplay never depends on it.
- One animation/effect per drain regardless of event count (coalescing).

## Review Focus

- 10 000 likes in one tick: one progress add, one visual pulse, queue bounded.
- Same event id sent 1 000 times: applied once; id evicted from the LRU after capacity is exceeded can be applied again (documented).
- `count` of 0, NaN, negative, huge; unknown `type`; missing id: rejected without throwing.
- Event arriving in PRESENTING/REWARDING/NEXT_DESSERT or timestamped before the round: no progress on the next round.
- Gift + follow + like in the same tick: complete-step and progress both applied once, progress ≤ 100.

### Task 1: Config and TikTokEventManager
**Files:** Modify `src/config/gameConfig.ts` (`events: { likeProgress: number; followProgress: number; heartProgress: number; largeGiftCoins: number; roseCooldownMs: number; bigGiftCooldownMs: number; dedupeCapacity: number; queueMax: number; maxLikeCountPerEvent: number }` = 0.02 / 1.5 / 4 / 100 / 1500 / 2500 / 2000 / 500 / 1000; `shareBonusPct: number` = 10); Create `src/tiktok/types.ts`, `src/tiktok/TikTokEventManager.ts`, `tests/unit/TikTokEventManager.test.ts`.
**Interfaces:** `type LiveEventType = 'like'|'follow'|'orangeHeart'|'rose'|'gift'|'share'`; `interface LiveEvent { id: string; type: LiveEventType; count: number; tsMs: number; user?: string; giftCoins?: number }`; `interface EventEffects { progressAdd: number; completeStep: boolean; roseEffect: boolean; bigGiftEffect: boolean; shareBonus: number; counters: { likes: number; follows: number; hearts: number; gifts: number; shares: number } }`; `class TikTokEventManager { constructor(config: GameConfig); ingest(raw: unknown): 'queued'|'duplicate'|'invalid'; drain(round: { roundId: number; startedAtMs: number; cooking: boolean }, nowMs: number): EventEffects; setConnection(s: 'connected'|'reconnecting'|'offline'): void; get connection(): ConnectionState; get totals(): Counters; get queueLength(): number }`.
Behavior: `ingest` validates shape (string non-empty id, known type, finite count 1..maxLikeCountPerEvent for like else 1..1e6, finite tsMs), dedupes via a Map-based LRU, queues; on overflow merges the oldest likes into one like event, then drops oldest non-gift events. `drain` empties the queue: events with `tsMs < startedAtMs` or `!cooking` are discarded except share (banked as shareBonus) and counters (always count for the HUD); progress = sum of per-type values; gift with `giftCoins >= largeGiftCoins` → completeStep; rose/big-gift effect flags respect their cooldowns (`nowMs`); each event handled in try/catch.
- [ ] Tests for every Review Focus item plus: mapping values; cooldown suppresses the second rose within the window but progress/counters still count; setConnection never affects drain; queue never exceeds `queueMax`.
- [ ] RED → implement → GREEN → commit `feat: add TikTokEventManager`.

### Task 2: MockEventSource
**Files:** Create `src/tiktok/MockEventSource.ts`, `tests/unit/MockEventSource.test.ts`.
**Interfaces:** `class MockEventSource { constructor(rng: () => number, sink: (raw: unknown) => void); steady(ratePerSec: number, durationMs: number): void; burst(type: LiveEventType, n: number, tsMs: number): void; duplicates(event: LiveEvent, times: number): void; tick(dtMs: number, nowMs: number): void }` — `steady` schedules a pseudo-random like/follow/share stream emitted by `tick`; `burst`/`duplicates` emit immediately; ids are unique per generated event; `delayed(event, delayMs)` and `outOfOrder(events)` helpers for chaos tests.
- [ ] Tests: ids unique, steady rate within 20 %, duplicates share one id, deterministic with the same rng seed. RED → implement → GREEN → commit.

### Task 3: Game integration
**Files:** Modify `src/Game.ts`, `src/main.ts`, `tests/unit/Game.test.ts`; Create `tests/unit/GameEvents.test.ts`.
**Interfaces:** `Game` constructor takes optional `events?: TikTokEventManager`; `Game.ingestEvent(raw: unknown): 'queued'|'duplicate'|'invalid'`; `Game.update(dtMs, nowMs?)` drains once per update while running: `progressAdd` → `cooking.addProgress`, `completeStep` → `completeCurrentStep`, `roseEffect` → particle burst + `wobble`, `bigGiftEffect` → larger burst; `shareBonus` accumulated for the round (`Game.roundBonus`). `Game.snapshot()` gains `counters` and `connection`. The round's `startedAtMs` is the `nowMs` at COOKING entry (injected clock; default `performance.now`/`Date.now`). `main.ts` reads `?mock=1` to start a `MockEventSource.steady(...)` and shows counters in the readout.
- [ ] Tests: likes during COOKING raise progress; the same likes sent during PRESENTING/NEXT_DESSERT do not raise progress of the next round; stale-timestamp events are ignored; gift completes the step; flood of 10 000 likes → progress ≤ 100 and one particle burst; duplicate ids applied once; a throwing event handler does not stop the loop; offline connection state does not stop the game; existing tests unchanged.
- [ ] RED → implement → GREEN → commit `feat: wire live events into the game`.

### Task 4: Event chaos soak
**Files:** Create `tests/soak/events.soak.test.ts`.
- [ ] 120 rounds with `MockEventSource` mixing steady, burst, duplicate, delayed, out-of-order and malformed events plus random connection flips: per update progress ∈ [0,100], no progress increase outside COOKING, queue ≤ max, loop completes all rounds. Commit `test: event chaos soak`.

## Self-Review
§9 pipeline in Tasks 1–3; §13 items 2–7 in Tasks 1, 3, 4; the real TikTok source is Phase 7 (this phase uses only `ingest()`).
