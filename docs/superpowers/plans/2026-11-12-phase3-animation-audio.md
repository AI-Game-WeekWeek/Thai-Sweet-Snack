# Phase 3: Cooking Animation & ASMR Audio — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline, chosen by the user). Steps use checkbox syntax.

**Goal:** Cancelable, leak-free animations and synthesized ASMR sound wired to each recipe step, with a Canvas 2D scene that makes cooking visibly satisfying.

**Architecture:** `AnimationManager` (headless tween registry, round-tagged) and `AudioManager` (Web Audio synth, injectable context, round-tagged voices) are independent of rendering. `ParticleSystem` (capped) and `Renderer` (Canvas 2D) read animation state. `Game` triggers animation and sound from the cooking step callbacks and cancels both on round cleanup.

**Tech Stack:** TypeScript, Canvas 2D, Web Audio API, Vitest (fake audio context).

**Spec:** `docs/superpowers/specs/2026-11-12-thai-dessert-asmr-design.md` (§7, §8, §4 cleanup rules)

## Global Constraints

- Every animation/voice is tagged with `roundId`; `cancelRound`/`stopRound` on cleanup; cancel never fires `onDone`.
- `onDone` fires exactly once per animation (`finished` | `timeout` | `error`); no animation can wait forever (`maxMs`).
- A throwing or unknown animation falls back to a plain timer; the game never waits on it.
- Particle count capped; overflow reduces spawning, never frame rate.
- Voices capped (`audio.maxVoices`); oldest stolen. Audio unavailable or blocked → silent, no error.
- All durations/caps/volumes in `gameConfig`.
- Round completion waits for the final step's animation to finish or time out (spec §6), bounded by `maxMs`.

## Review Focus

- Same animation key played twice quickly: old one cancelled silently, one active.
- `cancelRound` during `update` (callback cancels another animation): no crash, no double `onDone`.
- 10 000 `play` calls in one tick: active count stays at the cap.
- AudioContext construction throws / `resume()` rejects: game keeps running silently.
- Muted or unavailable audio: `play` returns without scheduling nodes.

### Task 1: AnimationManager
**Files:** Create `src/anim/AnimationManager.ts`, `tests/unit/AnimationManager.test.ts`; Modify `src/config/gameConfig.ts` (`anim: { maxActive: number }` = 64).
**Interfaces:** Produces `AnimSpec { kind: AnimId; durationMs: number; maxMs?: number; key?: string; onUpdate?(t: number, dtMs: number): void; onDone?(reason: 'finished'|'timeout'|'error'): void }`; `class AnimationManager { constructor(config: GameConfig); play(spec: AnimSpec, roundId: number): number; cancel(handle: number): boolean; cancelRound(roundId: number): number; update(dtMs: number): void; get activeCount(): number; isActive(handle: number): boolean }`.
- [ ] Tests: progresses t 0→1 and fires `finished` once; `maxMs` (< durationMs) → `timeout`; throwing `onUpdate` → `error` once, others unaffected; `cancel` stops callbacks and never calls `onDone`; `cancelRound` cancels only that round; same `key` restarts (old silent); cap evicts oldest silently; invalid dt ignored; cancelling another animation inside a callback is safe; 10 000 plays → `activeCount` ≤ cap.
- [ ] Run RED → implement → GREEN → commit `feat: add AnimationManager`.

### Task 2: ParticleSystem
**Files:** Create `src/anim/ParticleSystem.ts`, `tests/unit/ParticleSystem.test.ts`; Modify config (`particles: { cap: number; gravity: number }` = 600 / 900).
**Interfaces:** `class ParticleSystem { constructor(cap: number, gravity: number); spawn(p: { x; y; vx; vy; lifeMs; size; color: string }): boolean; update(dtMs: number): void; clear(): void; get count(): number; forEach(fn: (p: Readonly<Particle>) => void): void }`.
- [ ] Tests: spawn beyond cap returns `false` and `count` ≤ cap; particles expire after `lifeMs`; gravity moves vy; `clear()` empties; NaN/invalid spawn rejected.
- [ ] RED → implement → GREEN → commit `feat: add capped ParticleSystem`.

### Task 3: AudioManager
**Files:** Create `src/audio/AudioManager.ts`, `tests/unit/AudioManager.test.ts`; Modify config (`audio: { maxVoices: number; master: number }` = 8 / 0.6).
**Interfaces:** `class AudioManager { constructor(config: GameConfig, createContext?: () => AudioContext); unlock(): void; play(sound: SoundId, roundId: number): boolean; stopRound(roundId: number): number; setMuted(m: boolean): void; get activeVoices(): number }`. `unlock()` creates/resumes the context lazily (call from a user gesture); every failure is caught → silent mode.
- [ ] Tests with a fake context (counts created nodes, `onended` simulation): play before unlock → `false`; after unlock `true`; voice cap steals the oldest (`activeVoices` ≤ cap); `stopRound` stops only that round's voices; muted → no nodes created; factory throws → no throw, `play` false; `resume()` rejects → no unhandled rejection; every `SoundId` has a recipe (loop over `SOUND_IDS`).
- [ ] RED → implement synth recipes (filtered noise + envelopes; pour/stir/syrup/steam/slice/arrange/sizzle/boil/pop) → GREEN → commit `feat: add synthesized ASMR AudioManager`.

### Task 4: Renderer and integration
**Files:** Create `src/render/Renderer.ts`; Modify `src/Game.ts`, `src/main.ts`, `tests/unit/Game.test.ts`; Create `tests/unit/GameFx.test.ts`.
**Interfaces:** `Game` constructor gains optional `fx?: { animations: AnimationManager; audio: AudioManager; particles?: ParticleSystem }`. On cooking `onStepStart(step)`: `animations.play({kind: step.anim, durationMs: step.maxMs*0.8 → capped by config, key: 'step'}, roundId)` and `audio.play(step.sound, roundId)`; on PRESENTING play `arrange` + `pop`; `onCleanupRound` calls `animations.cancelRound` and `audio.stopRound`. Round completion: cooking `onComplete` is held until the final step's animation `onDone` (or its `maxMs`) before `manager.completeRound`. `Game.update(dt)` also advances animations and particles. `Renderer.draw(ctx, snapshot, fxState)` draws bowl/tray, fill level = progress, per-kind effects (pour stream, stir spiral, steam puffs, syrup thread, cut line, arranged pieces with spring squash/bounce) using the dessert palette.
- [ ] Tests (headless, with real `AnimationManager`, fake `AudioManager`): step start plays the matching anim kind and sound; cleanup cancels the old round's animations and voices (counts zero in next PREPARING); round completion waits for the final animation then completes; if the animation never finishes the `maxMs` timeout still completes the round; existing Game tests still pass without `fx`.
- [ ] Implement; `main.ts` mounts a `<canvas>`, unlocks audio on first pointer/key, keeps the text readout. Verify with `npm test && npm run typecheck && npm run build`, then a Playwright screenshot (deviceScaleFactor 1) at ~10 s of `?speed=1` and check the canvas has non-background pixels and no console errors.
- [ ] Commit `feat: wire animation and audio into the cooking loop`.

### Task 5: Soak for leaks
**Files:** Create `tests/soak/fx.soak.test.ts`.
- [ ] 120 rounds through `Game` with real `AnimationManager`, `ParticleSystem` and a fake `AudioManager`: after every round cleanup `activeCount`/`activeVoices` are 0; max active ≤ cap; particle count ≤ cap; no `onDone` from a cancelled animation; second case with hostile debug injections and cancelled animations mid-round. `npm test` green → commit `test: fx leak soak`.

## Self-Review
Spec §7/§8 covered by Tasks 1–4; §6 final-animation rule in Task 4; leak/cleanup §9 in Task 5. Visual quality is judged by screenshot only; recorded audio is out of scope (synth only).
