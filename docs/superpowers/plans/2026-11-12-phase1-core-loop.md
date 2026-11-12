# Phase 1: Project Structure & Core Game Loop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A TypeScript/Vite project whose state machine and single game loop run endlessly (100+ rounds in tests) using declared-placeholder cooking, with every stability rule from spec §4 enforced and tested.

**Architecture:** Pure, deterministic logic driven by `update(dtMs)`. `StateMachine` validates transitions; `GameManager` owns `roundId`, per-state timers (accumulated from `dtMs`, no `setTimeout`), watchdogs and cleanup hooks; `LoopDriver` is the only `requestAnimationFrame` user. Later phases attach to `GameManager` hooks, never to the loop.

**Tech Stack:** TypeScript (strict), Vite, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-12-thai-dessert-asmr-design.md` (§3, §4, §13, §14 Phase 1)

## Global Constraints

- States exactly: `IDLE → PREPARING → COOKING → PRESENTING → REWARDING → NEXT_DESSERT → PREPARING …`; no GAME_OVER/END state.
- Transitions outside the table are rejected, logged, and leave state unchanged.
- `roundId` increments on entering PREPARING; stale-`roundId` calls are no-ops.
- `completeRound(roundId)` is idempotent.
- One loop only; `start()` guarded against re-entry.
- Every state has a max duration (watchdog) from config; nothing waits forever.
- All tunables live in `src/config/gameConfig.ts`.
- Code/identifiers in English; strict TypeScript; no `any`.
- Placeholder cooking must be labelled `PLACEHOLDER` in code and reported as such.

## Review Focus

- `update(dt)` with a huge dt (background tab, e.g. 60 000 ms): expected at most one transition per call, dt clamped to `maxFrameMs`.
- `update(NaN)`, negative or zero dt: expected ignored, no state change, no throw.
- `start()` called twice, or `stop()` then `start()`: expected one loop; `roundId` and state continue, not reset.
- `completeRound` with a past or future `roundId`, or called outside COOKING: expected `false`, state unchanged.
- A throwing state-change listener or hook: expected logged, loop keeps running.

## File Structure

```
package.json, tsconfig.json, vite.config.ts, index.html
src/config/gameConfig.ts     tunables
src/core/StateMachine.ts     states + transition table
src/core/GameManager.ts      loop logic, roundId, watchdogs, hooks
src/core/LoopDriver.ts       the only requestAnimationFrame user
src/main.ts                  minimal state readout page
tests/unit/*.test.ts         per-module tests
tests/soak/loop.soak.test.ts 100+ round soak with invariants
```

### Task 1: Scaffold and config

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/config/gameConfig.ts`, `tests/unit/config.test.ts`

**Interfaces:**
- Produces: `GameConfig` type and `defaultConfig: GameConfig` from `src/config/gameConfig.ts`:
  - `maxFrameMs: number` (100)
  - `durationsMs: { preparing: number; cooking: number; presenting: number; rewarding: number; nextDessert: number }` (nominal: 500, 3000, 800, 800, 200). `cooking` is the PLACEHOLDER auto-complete time.
  - `maxMs: { preparing: number; cooking: number; presenting: number; rewarding: number; nextDessert: number }` watchdog limits (2000, 10000, 3000, 3000, 1000)

- [ ] **Step 1: Write failing test** `tests/unit/config.test.ts`: `defaultConfig` has every key above; for each state key `maxMs[k] > durationsMs[k]`; `maxFrameMs > 0`.
- [ ] **Step 2:** Create `package.json` (scripts `dev`, `build`, `test`=`vitest run`, `typecheck`=`tsc --noEmit`; devDeps `typescript`, `vite`, `vitest`), `tsconfig.json` (`strict`, `noUncheckedIndexedAccess`, ES2022, DOM lib), `vite.config.ts`, `index.html` (loads `/src/main.ts`, has `<div id="app">`). Run `npm install`. Run `npx vitest run tests/unit/config.test.ts` → FAIL (module missing).
- [ ] **Step 3:** Implement `src/config/gameConfig.ts` with the values above.
- [ ] **Step 4:** Run `npm test && npm run typecheck` → PASS.
- [ ] **Step 5:** Commit `feat: scaffold project and game config`.

### Task 2: StateMachine

**Files:**
- Create: `src/core/StateMachine.ts`, `tests/unit/StateMachine.test.ts`

**Interfaces:**
- Produces:
  - `type GameState = 'IDLE'|'PREPARING'|'COOKING'|'PRESENTING'|'REWARDING'|'NEXT_DESSERT'`
  - `const TRANSITIONS: Record<GameState, readonly GameState[]>` — IDLE→[PREPARING]; PREPARING→[COOKING]; COOKING→[PRESENTING]; PRESENTING→[REWARDING]; REWARDING→[NEXT_DESSERT]; NEXT_DESSERT→[PREPARING]
  - `class StateMachine { get state(): GameState; canTransition(to: GameState): boolean; transition(to: GameState): boolean; onChange(fn: (from: GameState, to: GameState) => void): () => void }` — starts in `IDLE`; `transition` returns `false` and logs `console.warn` for illegal moves; listener exceptions are caught and logged.

- [ ] **Step 1: Write failing tests:** every legal edge returns `true`; every pair not in `TRANSITIONS` returns `false` and state is unchanged (loop over all 36 pairs); no state has an outgoing edge to `IDLE`; a throwing listener does not stop `transition` returning `true`; unsubscribe function stops notifications.
- [ ] **Step 2:** Run `npx vitest run tests/unit/StateMachine.test.ts` → FAIL.
- [ ] **Step 3:** Implement `StateMachine` per the interface.
- [ ] **Step 4:** Run the test file → PASS.
- [ ] **Step 5:** Commit `feat: add state machine with validated transitions`.

### Task 3: GameManager

**Files:**
- Create: `src/core/GameManager.ts`, `tests/unit/GameManager.test.ts`

**Interfaces:**
- Consumes: `StateMachine`, `GameState`, `GameConfig`.
- Produces:
  - `interface GameHooks { onEnter?(state: GameState, roundId: number): void; onCleanupRound?(roundId: number): void }`
  - `interface Snapshot { state: GameState; roundId: number; stateElapsedMs: number; roundsCompleted: number }`
  - `class GameManager { constructor(config: GameConfig, hooks?: GameHooks); start(): boolean; stop(): void; get running(): boolean; update(dtMs: number): void; completeRound(roundId: number): boolean; snapshot(): Snapshot }`

Behavior (the decisions the implementer cannot guess):
- `start()`: returns `false` if already running; otherwise transitions IDLE→PREPARING (roundId 1) the first time, or just resumes after `stop()`.
- `update(dt)`: ignore if not running or `!Number.isFinite(dt)` or `dt <= 0`; clamp `dt` to `config.maxFrameMs`; add to `stateElapsedMs`; at most ONE transition per call, when `stateElapsedMs >= durationsMs[state]`, or `>= maxMs[state]` (watchdog; log `console.warn`). In COOKING, the duration expiry is the PLACEHOLDER auto-complete; it calls the same path as `completeRound`.
- Entering PREPARING increments `roundId`. Entering NEXT_DESSERT calls `hooks.onCleanupRound(oldRoundId)` before leaving; REWARDING→NEXT_DESSERT increments `roundsCompleted` once.
- `completeRound(id)`: `true` only if `id === roundId` and state is COOKING and not already completed this round; moves COOKING→PRESENTING. Otherwise `false`.
- Hook exceptions are caught, logged, and never break `update`.

- [ ] **Step 1: Write failing tests** (drive with `update(100)` loops, config durations): (a) `start()` twice → second returns `false`; (b) full cycle visits PREPARING, COOKING, PRESENTING, REWARDING, NEXT_DESSERT, PREPARING in order with `roundId` 1 then 2; (c) `completeRound(1)` in COOKING → `true`, second call → `false`, `completeRound(99)` → `false`, call in PREPARING → `false`; (d) `update(60000)` causes exactly one transition, and stateElapsed ≤ `maxFrameMs`; (e) `update(NaN)`, `update(-5)`, `update(0)` change nothing; (f) with `durationsMs.cooking` set above `maxMs.cooking` the watchdog still advances COOKING within `maxMs.cooking`; (g) `onCleanupRound` called once per round with the old id; (h) throwing `onEnter` does not stop the cycle; (i) `stop()` then `update` does nothing, `start()` resumes same roundId/state.
- [ ] **Step 2:** Run `npx vitest run tests/unit/GameManager.test.ts` → FAIL.
- [ ] **Step 3:** Implement `GameManager`; route every state change through `StateMachine.transition`.
- [ ] **Step 4:** Run the test file → PASS; run `npm run typecheck`.
- [ ] **Step 5:** Commit `feat: add GameManager with round IDs, watchdogs and cleanup hooks`.

### Task 4: LoopDriver and page

**Files:**
- Create: `src/core/LoopDriver.ts`, `src/main.ts`, `tests/unit/LoopDriver.test.ts`

**Interfaces:**
- Consumes: `GameManager.update/start/stop`.
- Produces: `class LoopDriver { constructor(game: GameManager, raf?: (cb: (t: number) => void) => number, caf?: (id: number) => void); start(): boolean; stop(): void }` — `start()` returns `false` if already started; each frame calls `game.update(t - lastT)` (first frame dt = 0) and schedules exactly one next frame; `stop()` cancels the pending frame.

- [ ] **Step 1: Write failing tests** with a fake raf queue: `start()` twice → one pending callback only; N frames → `update` called N times with correct deltas; `stop()` leaves zero pending callbacks; after `stop()`+`start()` the first dt is 0 (no giant jump).
- [ ] **Step 2:** Run `npx vitest run tests/unit/LoopDriver.test.ts` → FAIL.
- [ ] **Step 3:** Implement `LoopDriver`. Then `src/main.ts`: create `GameManager(defaultConfig)`, `LoopDriver`, start both, and render `snapshot()` as plain text (state, roundId, rounds completed) each frame into `#app`, with a visible `PLACEHOLDER COOKING` label.
- [ ] **Step 4:** Run `npm test && npm run typecheck && npm run build` → all pass. Smoke in the browser: serve with `npx vite preview`, load in Playwright (`require('playwright')`, `chromium.launch()`), wait 6 s, assert `#app` text shows `roundsCompleted >= 1` and no console errors.
- [ ] **Step 5:** Commit `feat: add LoopDriver and state readout page`.

### Task 5: Soak test

**Files:**
- Create: `tests/soak/loop.soak.test.ts`

**Interfaces:**
- Consumes: `GameManager`, `defaultConfig`, `TRANSITIONS`.

- [ ] **Step 1: Write the test:** drive `update(16)` until `roundsCompleted === 150`, with a hook recorder. Assert every frame: state transition (if any) is in `TRANSITIONS`; `roundId` never decreases and increases by exactly 1 per PREPARING entry; `stateElapsedMs <= maxMs[state]`. Assert at end: `onCleanupRound` called exactly 150 times with distinct ids; no state `IDLE` after start; total frames bounded (loop did not stall: finishes within `150 * (sum of maxMs)/16` frames). Second case: mix random `completeRound` calls (valid, stale, future) and random bad `dt` values, seeded PRNG; same invariants hold.
- [ ] **Step 2:** Run `npx vitest run tests/soak` → expect PASS (Tasks 1–4 already implement the behavior). If anything fails, fix the code, not the assertion.
- [ ] **Step 3:** Run the whole suite `npm test && npm run typecheck && npm run build` → all green.
- [ ] **Step 4:** Commit `test: add 150-round soak test for core loop`.
- [ ] **Step 5:** Report to the user: files created/changed, test output, and the explicit note that cooking is a PLACEHOLDER until Phase 2.

## Self-Review

- **Spec coverage (Phase 1 scope):** state machine §4 (Tasks 2–3), roundId/idempotent complete/cleanup/watchdog §4 (Task 3), single loop §4 (Task 4), soak ≥100 rounds §13 items 1, 9 (Task 5), config tunables (Task 1). Out of scope for this phase by design: dessert data, progress, animation, audio, events, save, UI beyond a readout.
- **Type consistency:** `GameState`, `GameConfig`, `GameHooks`, `Snapshot` defined once and used by name.
- **Proportion:** plan carries signatures, tests and spec values only; bodies left to the implementer.
