# Thai Dessert ASMR — Design Spec

Date: 2026-11-12
Status: Draft for review
Source: project brief "THAI DESSERT ASMR" (Thai-language spec, sections 1–11)

## 1. Goal

An endless, streamer-run Thai-dessert cooking game. Viewers do not control
anything; TikTok Live activity (Like, Follow, Orange Heart, Rose, Large Gift,
Share) is translated into in-game progress and effects. Priorities, highest
first:

1. Stable gameplay
2. Endless game loop
3. Satisfying cooking animation
4. TikTok Live interaction
5. Dessert variety and progression
6. Visual polish and audio quality

## 2. Decisions

| Topic | Decision |
|---|---|
| Platform | Web: HTML5 + TypeScript, Vite build. Captured by OBS for streaming. |
| Rendering | Canvas 2D, own tween/particle code. No game framework. |
| Audio | Web Audio API, synthesized ASMR sounds (no audio asset files in v1). |
| Tests | Vitest (logic, soak, chaos), Playwright (browser smoke). |
| TikTok | Separate Node bridge sending normalized events over WebSocket. Built only in Phase 7, using an officially supported route; limits reported before coding. Phases 1–6 use mock events only. |
| Language | UI text Thai; code and identifiers English. |

## 3. Architecture

```
src/
  config/   gameConfig.ts    all tunables (event values, cooldowns, timings, rewards)
  core/     StateMachine.ts, GameManager.ts
  dessert/  DessertManager.ts, data/*.ts  (one file per dessert, pure data)
  cooking/  CookingSystem.ts, ProgressManager.ts
  anim/     AnimationManager.ts
  audio/    AudioManager.ts
  tiktok/   TikTokEventManager.ts, MockEventSource.ts, WebSocketSource.ts
  reward/   RewardManager.ts
  save/     SaveSystem.ts
  ui/       UIManager.ts
server/     tiktok-bridge/    (Phase 7)
tests/      unit/, soak/, chaos/
docs/superpowers/{specs,plans}/
```

Each module has one purpose and talks to others through a narrow interface.
Modules never mutate each other's state directly; GameManager coordinates.

| Module | Responsibility | Depends on |
|---|---|---|
| StateMachine | Validates and applies state transitions | none |
| GameManager | Owns the single loop, round ID, wiring | all below |
| DessertManager | Menu selection, recipe lookup, unlocks | dessert data, SaveSystem |
| CookingSystem | Runs steps of the current recipe, step completion | ProgressManager, AnimationManager, AudioManager |
| ProgressManager | Only place progress changes; clamped 0..100 | config |
| AnimationManager | Tween/particle registry, cancel, timeout, fallback | none |
| AudioManager | Synth voices, voice cap, mute-safe | none |
| TikTokEventManager | Dedupe, queue, coalesce, cooldown, stale filter | config |
| RewardManager | Score, coins, XP, collection from a finished round | config |
| SaveSystem | Versioned, validated persistence | none |
| UIManager | HUD from read-only state snapshots | none |

## 4. State machine and game loop

States: `IDLE → PREPARING → COOKING → PRESENTING → REWARDING → NEXT_DESSERT → PREPARING …`

- Explicit transition table. A transition not in the table is rejected, logged,
  and leaves state unchanged.
- No GAME_OVER or END state exists.
- `roundId` increments on entering PREPARING. Every event, tween, timer and
  audio voice is tagged with its `roundId`; anything with a stale ID is dropped
  or cancelled.
- One loop driver (`requestAnimationFrame` with fixed-step update). `start()`
  is guarded against re-entry.
- `completeRound(roundId)` is idempotent: a second call, or a call with a stale
  ID, is a no-op.
- Entering NEXT_DESSERT runs a full cleanup for the old round (cancel
  animations, stop voices, clear event buffer for that round, reset progress and
  step state) before PREPARING begins.
- Watchdogs: every state and every step has a max duration in config. On
  timeout the system force-advances (step completes with fallback visuals; state
  advances) so nothing can wait forever.

## 5. Dessert data

A dessert is a data object:

```ts
interface DessertDef {
  id: string; nameTh: string; nameEn: string;
  unlock: { cost: number } | { default: true };
  ingredients: { id: string; nameTh: string; color: string }[];
  steps: StepDef[];            // ordered
  presentation: { container: 'tray'|'box'; layout: 'grid'|'stack'|'pile' };
  palette: string[];
  reward: { baseScore: number; baseCoins: number; xp: number };
}
interface StepDef {
  id: string; nameTh: string;
  anim: AnimId;                // registered animation kind, e.g. 'pour','stir','drizzle','steam','cut','arrange'
  sound: SoundId;              // registered synth sound, e.g. 'pour','stir','sizzle','steam','syrup','arrange'
  weight: number;              // share of total progress
  maxMs: number;               // watchdog
}
```

Adding a dessert = adding one file to `dessert/data/` and registering it. No
gameplay code changes. Unknown `anim`/`sound` IDs fall back to a generic
animation/silence and log a warning (data validation at load).

v1 menu (8): ขนมชั้น, ลูกชุบ, ฝอยทอง, ทองหยิบ, ทองหยอด, ขนมครก, บัวลอย, ขนมเบื้อง.

Selection: next dessert chosen from unlocked set by a shuffle-bag (no immediate
repeat; each unlocked dessert appears once per bag).

## 6. Cooking and progress

- Total progress 0..100 for the round. Each step owns a band proportional to
  `weight`. Step completes when progress crosses its band end.
- Time-based auto progress runs at a low base rate so the game advances with zero
  viewers (streamer-only play is valid). Rate is config.
- `ProgressManager.add(amount, roundId)` is the single mutation point:
  rejects stale `roundId`, rejects NaN/negative, clamps to 100.
- "Complete Current Step" (Large Gift) sets progress to the current step's band
  end.
- Round completes when progress reaches 100 and the final step's animation has
  finished or timed out. Complete is idempotent.

## 7. Animation (AnimationManager)

- Tween registry keyed by `roundId` and `groupId`. API: `play(def, roundId) →
  handle`, `cancel(handle)`, `cancelRound(roundId)`.
- Each animation has `maxMs`; on timeout it is force-finished and its completion
  callback runs once.
- If an animation definition is missing or throws, a built-in fallback
  (simple fill/fade) plays instead.
- Same animation kind on the same target cannot overlap unless declared
  stackable; a duplicate request restarts or is ignored per definition.
- Visual elements per spec §4: dough/batter flow into mould, syrup flow, colour
  reveal, ingredient mixing, orderly arranging; soft-body squash/stretch for
  dough and jelly, bounce on finished pieces, liquid via particle/metaball
  rendering, touch response via pointer-driven impulses.
- Particle count is capped; overflow reduces particle spawn rate, not frame rate.

## 8. Audio (AudioManager)

- Web Audio synth voices: pour, stir, slice, steam, syrup, arrange, sizzle,
  pop/complete chime, reward. Noise + filtered envelopes, no external files.
- Max concurrent voices (config); oldest voice stolen on overflow.
- Voices tagged by `roundId`; `stopRound(roundId)` on cleanup.
- AudioContext resume on first user gesture; if audio is unavailable or blocked
  the game runs silently without error.
- Master volume and mute in config and UI.

## 9. TikTok event system

Normalized event shape (produced by mock source and by the Phase 7 bridge):

```ts
interface LiveEvent {
  id: string;            // unique per event; used for dedupe
  type: 'like'|'follow'|'orangeHeart'|'rose'|'gift'|'share';
  count: number;         // e.g. like batch size, gift amount
  tsMs: number;          // source timestamp
  user?: string;
}
```

Pipeline: source → `TikTokEventManager.ingest()` → dedupe → bounded queue →
per-tick drain → coalesce → apply.

- **Dedupe:** bounded LRU of seen IDs (config size); duplicates dropped.
- **Queue:** FIFO with max length; on overflow, oldest low-value events
  (likes) are merged into a count rather than dropped.
- **Coalescing:** each tick, all like/follow/heart events collapse into one
  progress addition and one counter update; one visual pulse regardless of N.
- **Effect cooldowns:** Rose effect, big-gift effect, etc. each have a
  cooldown; events during cooldown still count for progress/bonus but skip the
  visual.
- **Stale filter:** events are applied to the round active at drain time. Events
  whose source timestamp predates the current round's start are discarded.
  Events arriving during PRESENTING/REWARDING/NEXT_DESSERT are not applied to
  the next round; only `share` bonus may be banked to the reward of the
  round they arrive in (config flag).
- **Failure isolation:** processing of each event is wrapped; an exception
  logs and drops that event only.
- **Mapping (all values in `gameConfig`):**

| Event | Effect |
|---|---|
| like | `+likeProgress × count` progress |
| follow | `+followProgress` |
| orangeHeart | `+heartProgress` (larger) |
| rose | special visual effect (cooldown) |
| gift (large, by coin threshold) | complete current step |
| share | bonus reward multiplier/coins |

- **Mock source:** in-page debug panel and scripted generators (steady, burst,
  duplicate, delayed, out-of-order) for testing without TikTok. Enabled by a
  query flag / config; also used by soak and chaos tests.
- **Connection state:** `connected | reconnecting | offline`; shown on HUD
  counter. Offline never affects gameplay.

## 10. Rewards and progression

Per completed round: score, coins, XP, collection entry. Share bonus and
optional speed bonus applied from config.

Unlocks purchasable with in-game coins only: new desserts, ingredients, trays and
boxes, tools, shop decorations. No payments or gift requirement to progress.
Level derived from XP via a config curve.

v1 unlock content is small and data-driven (a unlock list in config); desserts
beyond the default set unlock by coins.

## 11. Save system

- localStorage, single key, JSON with a `version` field and schema
  validation.
- Load: parse in try/catch; on failure or invalid shape, start from defaults and
  keep the corrupt blob under a backup key. Unknown versions go through a
  migration function or fall back to defaults.
- Save: debounced and written at safe points (after REWARDING). Same-state saves
  are skipped. Storage errors (quota, disabled) are caught and logged; gameplay
  never blocks.

## 12. UI

Six HUD elements only: current dessert, progress bar, ingredient display, TikTok
live counters (likes/follows/gifts/shares + connection state), reward display
(score/coins), next dessert. Debug/mock panel is hidden unless enabled.
UIManager receives read-only snapshots; it never mutates game state.
Layout targets 9:16 portrait and 16:9 landscape, readable at stream resolution.

## 13. Testing and acceptance

Automated tests (Vitest, headless with fake timers where applicable):

1. Soak: ≥100 consecutive rounds with mock events; loop never stalls.
2. Like flood: 10k likes in one tick → single coalesced add, progress ≤ 100.
3. Follow + gift simultaneously.
4. Duplicate event IDs ignored.
5. Events during round change do not affect the new round.
6. Cancelled animations: callbacks never fire for dead rounds; registry empty
   after cleanup.
7. TikTok disconnect mid-round: game continues and completes.
8. Save/load failures: corrupt JSON, wrong version, storage throwing.
9. Stability invariants asserted every tick in soak: no second loop, progress in
   [0,100], state-transition table respected, animation/voice/timer registry
   sizes bounded.
10. Memory/performance: registry-size and heap growth check over soak; frame-time
    sample in Playwright.

Acceptance criteria (from brief): no menu can hang the game; progress never
exceeds 100; no old events affect a new dessert; no nested loops; endless play;
TikTok loss does not stop play; fully testable without TikTok.

"Complete" is only claimed for a phase after its tests pass, with the files
created/changed reported.

## 14. Phases

1. Scaffold, config, state machine, endless loop with placeholder steps
   (declared as placeholders).
2. Dessert data (8) and CookingSystem.
3. Animations and ASMR audio.
4. Event system with mock events.
5. HUD and rewards.
6. Save and progression.
7. TikTok bridge (verify officially supported route first; report limits).
8. Soak/chaos tests, performance and leak checks, bug fixing.

Each phase is built, tested, and reported before the next begins. No system is
rewritten without checking its impact on existing tests.

## 15. Known limits and open items

- Synthesized audio is lower fidelity than recorded foley; asset-based audio can
  be added later through the same `SoundId` interface.
- Canvas 2D physics is stylized (spring/particle based), not a rigid-body engine.
- TikTok has no official public Live-events API for arbitrary games; Phase 7
  will pick and document a supported route and its limits (e.g. which event
  types are actually available) before any code is written. Event types not
  available there stay mock-only and are reported as such.
