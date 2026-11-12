# Phase 2: Dessert Data & Cooking System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder cooking timer with real data-driven cooking: 8 Thai desserts, a clamped progress manager, a step runner, and a shuffle-bag dessert picker, all wired into the existing endless loop.

**Architecture:** Dessert recipes are pure data validated at load. `ProgressManager` is the single place progress changes. `CookingSystem` turns progress into steps (bands by weight), runs time-based auto progress, and has its own per-step watchdog. A `Game` composition root wires them to `GameManager` hooks; `GameManager` stays generic.

**Tech Stack:** TypeScript (strict), Vite, Vitest (unchanged).

**Spec:** `docs/superpowers/specs/2026-11-12-thai-dessert-asmr-design.md` (§5, §6, §14 Phase 2)

## Global Constraints

- Progress is 0..100, mutated only by `ProgressManager`; stale `roundId`, NaN, negative are rejected; clamp at 100.
- Step bands are proportional to `weight`; "Complete Current Step" sets progress to the current step's band end.
- Round completes at 100 once (idempotent); every step has a watchdog `maxMs`.
- A dessert is data only; adding one = one file in `src/dessert/data/` plus one registry line, no gameplay change.
- Unknown `anim`/`sound` ids: logged warning at load, game keeps working (fallback happens in Phase 3).
- v1 menu exactly: ขนมชั้น, ลูกชุบ, ฝอยทอง, ทองหยิบ, ทองหยอด, ขนมครก, บัวลอย, ขนมเบื้อง.
- Next dessert by shuffle-bag, no immediate repeat when more than one is unlocked.
- All tunables in `src/config/gameConfig.ts`; strict TS, no `any`.
- Animations and audio are Phase 3: steps carry `anim`/`sound` ids only; the HUD readout is text.

## Review Focus

- `add()` with NaN, Infinity, negative, 1e12: expected no change or clamp to 100, never over 100.
- Stale or future `roundId` on `add`/`completeCurrentStep`: expected ignored.
- `completeCurrentStep` on the last step, called twice: expected `onComplete` fires once.
- One unlocked dessert, or an empty unlocked set: expected repeat allowed / safe default, no throw, no infinite loop.
- A recipe with zero/negative weights or no steps: expected rejected at load with a clear error.

## File Structure

```
src/config/gameConfig.ts       modify: placeholderCooking, cooking.baseProgressPerSec, liveConfig
src/dessert/types.ts           DessertDef, StepDef, AnimId, SoundId
src/dessert/validate.ts        validateDessert()
src/dessert/data/*.ts          8 recipes + index.ts registry
src/dessert/DessertManager.ts  shuffle-bag picker
src/cooking/ProgressManager.ts clamped progress
src/cooking/CookingSystem.ts   bands, auto progress, step watchdog
src/core/GameManager.ts        modify: onTick hook, placeholderCooking switch
src/Game.ts                    composition root
src/main.ts                    modify: readout
tests/unit/*.test.ts, tests/soak/cooking.soak.test.ts
```

### Task 1: Config additions and ProgressManager

**Files:**
- Modify: `src/config/gameConfig.ts`, `tests/unit/config.test.ts`
- Create: `src/cooking/ProgressManager.ts`, `tests/unit/ProgressManager.test.ts`

**Interfaces:**
- Produces: `GameConfig` gains `placeholderCooking: boolean` (default `true` in `defaultConfig`) and `cooking: { baseProgressPerSec: number }` (3.5). New export `liveConfig: GameConfig` = `defaultConfig` with `placeholderCooking: false` and `maxMs.cooking: 180000` (global watchdog above any recipe).
- Produces: `class ProgressManager { startRound(roundId: number): void; add(amount: number, roundId: number): number; setAtLeast(value: number, roundId: number): number; get value(): number; get roundId(): number }` — `add`/`setAtLeast` return the amount actually applied (0 when rejected); `startRound` resets value to 0.

- [ ] **Step 1: Write failing tests** — config: `liveConfig.placeholderCooking === false`, `defaultConfig.placeholderCooking === true`, `liveConfig.maxMs.cooking > 60000`, `cooking.baseProgressPerSec > 0`. ProgressManager: starts 0; `add(30,1)` after `startRound(1)` → 30; `add(1e12,1)` → value 100 and returns 70; `add(NaN|Infinity|-5|0, 1)` → 0 applied, value unchanged; `add(5, 2)` and `add(5, 0)` with round 1 active → 0 applied; `setAtLeast(40,1)` raises to 40, `setAtLeast(10,1)` leaves 40; `startRound(2)` resets to 0 and `add(5,1)` is then rejected.
- [ ] **Step 2:** Run `npx vitest run tests/unit/ProgressManager.test.ts tests/unit/config.test.ts` → FAIL.
- [ ] **Step 3:** Implement per Interfaces; `Infinity` is rejected (not clamped) since it signals a bad source.
- [ ] **Step 4:** `npm test && npm run typecheck` → PASS.
- [ ] **Step 5:** Commit `feat: add ProgressManager and cooking config`.

### Task 2: Dessert data and DessertManager

**Files:**
- Create: `src/dessert/types.ts`, `src/dessert/validate.ts`, `src/dessert/data/{khanomChan,lukChup,foiThong,thongYip,thongYod,khanomKrok,buaLoy,khanomBuang,index}.ts`, `src/dessert/DessertManager.ts`, `tests/unit/dessert.test.ts`, `tests/unit/DessertManager.test.ts`

**Interfaces:**
- Produces (`types.ts`): `AnimId = 'pour'|'stir'|'drizzle'|'steam'|'cut'|'arrange'|'fry'|'shape'|'knead'|'spread'|'boil'`; `SoundId = 'pour'|'stir'|'syrup'|'steam'|'slice'|'arrange'|'sizzle'|'boil'|'pop'`; `StepDef`, `DessertDef` exactly as in spec §5 (`unlock: { default: true } | { cost: number }`; `StepDef.weight`, `maxMs`).
- Produces: `validateDessert(def: DessertDef): string[]` (empty = valid). Errors for: no steps; any weight ≤ 0 or non-finite; any `maxMs` ≤ 0; duplicate step ids; empty ingredients; empty `nameTh`. Unknown `anim`/`sound` → warning via `console.warn`, not an error.
- Produces: `ALL_DESSERTS: readonly DessertDef[]` (8, in the spec's order) from `data/index.ts`, which throws at import if any recipe fails `validateDessert` or ids are not unique.
- Produces: `class DessertManager { constructor(defs: readonly DessertDef[], unlockedIds: readonly string[], rng?: () => number); next(): DessertDef; peekNext(): DessertDef; get(id: string): DessertDef | undefined; setUnlocked(ids: readonly string[]): void }` — shuffle-bag over unlocked defs (Fisher–Yates with `rng`); bag refills when empty and the first pick of a new bag is never the previous dessert when more than one is unlocked; an empty/unknown unlocked set falls back to the first def with `unlock.default`; `peekNext()` returns what `next()` will return next without consuming it.
- v1 data: 4–5 steps each (stir/pour/steam/cut/arrange etc. fitting the real recipe), Thai step names, ingredient lists with colors, `unlock: { default: true }` for ขนมชั้น, ทองหยอด, ขนมครก, บัวลอย; `{ cost }` of 150/200/250/300 for ลูกชุบ, ฝอยทอง, ทองหยิบ, ขนมเบื้อง. Step `maxMs` 8000–20000, weights sum arbitrary (normalized by bands).

- [ ] **Step 1: Write failing tests** — `dessert.test.ts`: `ALL_DESSERTS` has 8 entries with exactly the spec's Thai names; ids unique; each passes `validateDessert`; each has ≥ 4 steps and every `anim`/`sound` is in the known id sets; `validateDessert` rejects (one case each): zero steps, weight 0, weight NaN, maxMs 0, duplicate step id, empty ingredients. `DessertManager.test.ts` (seeded rng): over 100 `next()` calls with 8 unlocked, never the same dessert twice in a row and each dessert appears at least 12 times; each bag of 8 contains all 8; with 1 unlocked, `next()` always returns it; with `[]` and with `['nope']`, `next()` returns a default-unlocked dessert; `peekNext()` equals the following `next()`; `setUnlocked` changes the pool.
- [ ] **Step 2:** Run both files → FAIL.
- [ ] **Step 3:** Implement types, validation, the 8 data files, registry, `DessertManager`.
- [ ] **Step 4:** `npm test && npm run typecheck` → PASS.
- [ ] **Step 5:** Commit `feat: add 8 dessert recipes, validation and DessertManager`.

### Task 3: CookingSystem

**Files:**
- Create: `src/cooking/CookingSystem.ts`, `tests/unit/CookingSystem.test.ts`

**Interfaces:**
- Consumes: `DessertDef`, `StepDef`, `ProgressManager`, `GameConfig`.
- Produces:
  - `interface CookingCallbacks { onStepStart?(step: StepDef, index: number, roundId: number): void; onStepComplete?(step: StepDef, index: number, roundId: number): void; onComplete?(roundId: number): void }`
  - `class CookingSystem { constructor(config: GameConfig, progress: ProgressManager, callbacks?: CookingCallbacks); start(def: DessertDef, roundId: number): void; update(dtMs: number): void; addProgress(amount: number): number; completeCurrentStep(): boolean; cancel(): void; snapshot(): { active: boolean; dessertId: string | null; stepIndex: number; stepId: string | null; progress: number } }`
- Behavior: `start` calls `progress.startRound(roundId)` and fires `onStepStart(step 0)`. Band end for step *i* = 100 × cumulative weight / total weight. `update(dt)` (ignored if inactive or dt invalid; dt not clamped here, caller clamps) adds `baseProgressPerSec × dt/1000`, accumulates the current step's elapsed time, and force-completes the step (sets progress to its band end, logs a warning) when elapsed ≥ `step.maxMs`. After any progress change, every step whose band end ≤ progress is completed in order (`onStepComplete`, then `onStepStart` for the next). At progress 100, `onComplete(roundId)` fires exactly once and the system becomes inactive. `addProgress` goes through `ProgressManager.add` with the active roundId and returns the applied amount (0 when inactive). `completeCurrentStep()` returns `false` when inactive. `cancel()` makes the system inactive without firing callbacks. Callback exceptions are caught and logged.

- [ ] **Step 1: Write failing tests** (small 3-step test dessert with weights 1/2/1 → band ends 25/75/100; use baseProgressPerSec 10): bands (progress 24 → step 0; 26 → step 1; 76 → step 2); callbacks fire in order `start0, complete0, start1, …, complete2, onComplete`; one `addProgress(1e9)` completes all steps in order and `onComplete` fires once; `completeCurrentStep()` ×3 completes the round, a 4th returns `false` and `onComplete` still once; step watchdog: with `step.maxMs = 1000` and zero base rate, `update(100)` ×10 force-completes step 0; `cancel()` then `update`/`addProgress` do nothing and no callbacks fire; `start` again resets (new roundId accepted, old-round state gone); a throwing callback does not stop later callbacks or the round from completing; `update(NaN|-1|0)` ignored.
- [ ] **Step 2:** Run `npx vitest run tests/unit/CookingSystem.test.ts` → FAIL.
- [ ] **Step 3:** Implement `CookingSystem` per Behavior.
- [ ] **Step 4:** `npm test && npm run typecheck` → PASS.
- [ ] **Step 5:** Commit `feat: add CookingSystem with bands and step watchdog`.

### Task 4: Wire into the loop, soak, smoke

**Files:**
- Modify: `src/core/GameManager.ts`, `src/main.ts`, `tests/unit/GameManager.test.ts`
- Create: `src/Game.ts`, `tests/unit/Game.test.ts`, `tests/soak/cooking.soak.test.ts`

**Interfaces:**
- `GameHooks` gains `onTick?(state: GameState, dtMs: number, roundId: number): void` — called in `update()` after the dt is validated and clamped, before elapsed/transition checks, with the clamped dt; exceptions caught and logged.
- `GameManager` COOKING duration expiry auto-completes only when `config.placeholderCooking` is `true`; the `maxMs.cooking` watchdog is unchanged.
- `class Game { constructor(config: GameConfig, dessertManager: DessertManager); readonly manager: GameManager; update(dtMs: number): void; start(): boolean; snapshot(): { state; roundId; roundsCompleted; dessertNameTh: string | null; nextDessertNameTh: string; stepNameTh: string | null; progress: number } }` — composition root: on PREPARING picks `dessertManager.next()`, on COOKING calls `cooking.start(def, roundId)`, `onTick` in COOKING forwards dt to `cooking.update`, `cooking.onComplete(id)` calls `manager.completeRound(id)`, `onCleanupRound` calls `cooking.cancel()`. `Game.update` is what `LoopDriver` drives (it only needs `update`).
- `LoopDriver` is unchanged: it takes any object with `update(dt: number): void` (change its constructor type from `GameManager` to `{ update(dtMs: number): void }`).
- `main.ts` builds `new Game(liveConfig, new DessertManager(ALL_DESSERTS, defaults, Math.random))`, drives it with `LoopDriver`, shows dessert, step, progress, next dessert (Thai names), no `PLACEHOLDER` label.

- [ ] **Step 1: Write failing tests** — GameManager: `onTick` receives clamped dt only while running and for valid dt; with `placeholderCooking: false` COOKING does not end at `durationsMs.cooking` but ends at `maxMs.cooking`. Game: after `start()` and updates, PREPARING picks a dessert (`dessertNameTh` set), COOKING advances `progress` from 0 upward, full round ends in PRESENTING with progress 100 and next round picks a different dessert; stale `completeRound` can't skip a round; `cooking.cancel` is called on round cleanup (progress for old round no longer changes).
- [ ] **Step 2:** Run the new tests → FAIL.
- [ ] **Step 3:** Implement the hook, `Game`, `LoopDriver` type change, `main.ts`.
- [ ] **Step 4:** `tests/soak/cooking.soak.test.ts` — 120 rounds through `Game` with `liveConfig` and all 8 desserts unlocked, driven by `update(16)`: every frame `0 ≤ progress ≤ 100`; every round visits steps in order; every dessert appears; frame count bounded; second case injects random `addProgress`-like pressure by calling `game.cooking`-level APIs only via public `Game` methods exposed for tests (`game.debugAddProgress(n)`, `game.debugCompleteStep()`; both no-ops outside COOKING) with hostile values (NaN, 1e12, −5). Run `npm test && npm run typecheck && npm run build` → all pass.
- [ ] **Step 5:** Browser smoke (preview + Playwright): within 90 s the page shows a Thai dessert name, a step name, progress rising, and `roundsCompleted >= 1` with no console errors (set a test-only URL flag `?speed=10` that multiplies dt, read in `main.ts`, to keep the smoke short).
- [ ] **Step 6:** Commit `feat: wire cooking system into game loop`.

## Self-Review

- **Spec coverage (Phase 2):** dessert data and validation §5 (Task 2), shuffle-bag §5 (Task 2), progress/bands/auto-progress/complete-step/idempotent complete §6 (Tasks 1, 3), integration with the single loop §4 (Task 4). Recipe/ingredient data is in Task 2; cooking animation, ASMR sound, events, rewards, save are later phases.
- **Type consistency:** `DessertDef`, `StepDef`, `ProgressManager`, `CookingSystem`, `Game` named once and reused.
- **Proportion:** signatures, behavior rules and test cases only.
