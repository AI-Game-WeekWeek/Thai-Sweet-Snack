# Phases 5–6: UI, Rewards, Save and Progression — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline). Steps use checkbox syntax.

**Goal:** A readable six-element HUD, per-round rewards, coin-based unlocks with no pay-to-play, and a save system that can never block or corrupt gameplay.

**Architecture:** `ProfileData` (score, coins, xp, collection, unlocked ids) is the single persisted state, owned by `RewardManager` (awards idempotently per round) and changed by `ProgressionManager` (unlock purchases). `SaveSystem` serializes it through an injectable storage. `UIManager` renders read-only snapshots to the DOM. `Game` awards at REWARDING and saves at NEXT_DESSERT.

**Tech Stack:** TypeScript, DOM, Vitest (+ `happy-dom` for the HUD test).

**Spec:** `docs/superpowers/specs/2026-11-12-thai-dessert-asmr-design.md` (§10, §11, §12)

## Global Constraints

- HUD shows exactly: current dessert, progress bar, ingredients, TikTok live counters (+connection), reward (score/coins), next dessert. No other buttons.
- Rewards never require money or gifts; unlocks use in-game coins only.
- `award` is idempotent per `roundId`; a second call returns the same result without adding again.
- Save: versioned JSON, validated on load, corrupt data backed up and replaced by defaults, storage errors swallowed (logged), never blocks the loop, skipped when nothing changed.
- All reward/level/save tunables in `gameConfig`.

## Review Focus

- Corrupt JSON, wrong version, wrong field types, negative or NaN numbers, huge numbers in the save.
- `localStorage` throwing on read, on write (quota), or missing entirely.
- Award called twice for one round; award with a stale roundId.
- Unlock with insufficient coins, unknown id, already unlocked, double call.
- HUD update with missing dessert (before the first round) and with 1 000 snapshots (no DOM growth).

### Task 1: RewardManager and profile
**Files:** Modify `src/config/gameConfig.ts` (`reward: { speedParMs: number; speedBonusMaxPct: number; xpBase: number; xpGrowth: number }` = 25000 / 30 / 100 / 1.25); Create `src/reward/types.ts`, `src/reward/RewardManager.ts`, `tests/unit/RewardManager.test.ts`.
**Interfaces:** `interface ProfileData { version: 1; score: number; coins: number; xp: number; rounds: number; collection: Record<string, number>; unlocked: string[] }`; `interface RewardResult { roundId: number; dessertId: string; score: number; coins: number; xp: number; levelUp: boolean }`; `class RewardManager { constructor(config: GameConfig, profile?: ProfileData); award(def: DessertDef, ctx: { roundId: number; bonusPct: number; cookMs: number }): RewardResult | null; get profile(): Readonly<ProfileData>; get level(): number; get last(): RewardResult | null; spend(coins: number): boolean; replaceProfile(p: ProfileData): void }`; `defaultProfile(defaultUnlocked: string[]): ProfileData`. Score/coins = base × (1 + (bonusPct + speedBonusPct)/100), rounded; speed bonus scales linearly from `speedBonusMaxPct` (instant) to 0 (≥ `speedParMs`); level = largest L with cumulative `xpBase × growth^(k-1)` ≤ xp.
- [ ] Tests: base values; bonus and speed bonus math; idempotent per round (`award` twice → same object, totals once); stale/duplicate roundId; NaN/negative inputs clamped to 0; level thresholds and `levelUp`; `spend` rejects more than owned or negative/NaN; collection counts. RED → implement → GREEN → commit.

### Task 2: HUD (UIManager)
**Files:** Create `src/ui/UIManager.ts`, `tests/unit/UIManager.test.ts`, `index.html` styles; Modify `src/Game.ts` (snapshot gains `ingredients`, `reward`, `level`, `toast`), `src/main.ts`.
**Interfaces:** `class UIManager { constructor(root: HTMLElement); render(s: GameSnapshot): void; destroy(): void }` — builds the six elements once, `render` only touches nodes whose text/width changed; ingredient chips rebuilt only when the dessert changes; a reward toast shows `+score +coins` during REWARDING and the unlock message when present.
- [ ] Tests (`// @vitest-environment happy-dom`): six regions exist; progress bar width follows progress and clamps 0–100; ingredient chips match the dessert and don't rebuild when unchanged (same node identity); null dessert shows a neutral placeholder; 1 000 renders leave the DOM node count constant; `destroy` empties the root. Add `happy-dom` devDependency. RED → implement → GREEN → commit.

### Task 3: Award in the game loop
**Files:** Modify `src/Game.ts`, `tests/unit/Game.test.ts`; Create `tests/unit/GameReward.test.ts`.
- [ ] `Game` takes an optional `RewardManager`; on entering REWARDING awards once per round with `cookMs` = game-clock time since COOKING started and `bonusPct`; `snapshot()` exposes totals and last result. Tests: one award per round across 20 rounds; a stale completion cannot double-award; coins/score only increase; share bonus raises the award. Commit.

### Task 4: SaveSystem
**Files:** Create `src/save/SaveSystem.ts`, `tests/unit/SaveSystem.test.ts`; Modify `src/config/gameConfig.ts` (`save: { key: string; backupKey: string }`).
**Interfaces:** `interface StorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }`; `class SaveSystem { constructor(config: GameConfig, storage: StorageLike | null, defaultUnlocked: string[]); load(): ProfileData; save(p: ProfileData): boolean }`. `load` never throws: parse failure, wrong version, wrong types → defaults (the corrupt blob copied to `backupKey`); numbers sanitized (finite, ≥ 0, capped at 1e12); unknown dessert ids kept out of `unlocked`/`collection` only if a known-id list is supplied; default-unlocked always included. `save` skips when the serialized value equals the last saved, catches every storage error and returns `false`.
- [ ] Tests for every Review Focus save item incl. storage null and throwing getItem/setItem. RED → implement → GREEN → commit.

### Task 5: Progression (unlocks) and integration
**Files:** Create `src/reward/ProgressionManager.ts`, `tests/unit/ProgressionManager.test.ts`; Modify `src/Game.ts`, `src/main.ts`; Create `tests/unit/GameSave.test.ts`.
**Interfaces:** `class ProgressionManager { constructor(defs: readonly DessertDef[], rewards: RewardManager); unlock(id: string): 'ok'|'unknown'|'already'|'insufficient'; nextAffordable(): DessertDef | null }`; `Game` auto-unlocks the cheapest affordable locked dessert at NEXT_DESSERT (config `progression.autoUnlock`, default true), updates `DessertManager.setUnlocked`, sets a toast, and saves via `SaveSystem` at NEXT_DESSERT (try/catch, never blocks).
- [ ] Tests: unlock result codes and coin spend; auto-unlock picks the cheapest affordable and only once; a throwing/full storage never stops the loop over 30 rounds; load → play → save → reload restores coins, collection and unlocked desserts; corrupt save at startup still starts a new game. `main.ts` loads the profile from `localStorage` (guarded) and mounts the HUD. Commit.

### Task 6: Soak
**Files:** Create `tests/soak/progress.soak.test.ts`.
- [ ] 150 rounds with an in-memory storage that randomly throws and with event chaos: coins/score monotonic non-decreasing except spend, level consistent with xp, saved profile always re-loadable, all desserts eventually unlock, loop never stalls. Commit `test: progression soak`.

## Self-Review
§10 in Tasks 1, 3, 5; §11 in Tasks 4–6; §12 in Task 2. Pay-to-play is excluded by construction (no gift/payment path touches coins).
