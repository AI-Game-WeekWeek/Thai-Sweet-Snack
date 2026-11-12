# Phase 7: TikTok Integration (Provider-Neutral Bridge) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline).

**Goal:** Let real viewer events reach the game over a local WebSocket bridge, with reconnection and graceful offline behaviour, without assuming a TikTok API that is not officially available.

## Research finding (decides the design)

Searches (Euler Stream docs, tik.tools, TikTok-Live-Connector README, TikFinity) consistently state that **TikTok offers no official public API for reading LIVE events (likes, gifts, follows, shares)**. What exists: (a) third-party managed services that deliver events via WebSocket/webhook, and (b) reverse-engineered open-source connectors that can break when TikTok changes its service and may conflict with TikTok's terms. I could not reach TikTok's own developer pages to confirm; the streamer must check TikTok's current terms and the chosen provider's terms.

**Decision:** the game and bridge speak one documented, provider-neutral event format (`LiveEvent`). The bridge accepts events from any source the streamer is entitled to use through an authenticated local HTTP endpoint (`POST /event`) and relays them to the game over WebSocket. No reverse-engineered connector is bundled. A small adapter doc shows how a provider's webhook/WebSocket maps to `LiveEvent`. Event types a provider cannot supply simply never arrive (the game does not depend on any of them).

## Global Constraints

- The browser never talks to TikTok; it only connects to a bridge URL the streamer configures.
- Bridge binds to `127.0.0.1` by default; shared token required for `POST /event` (Bearer) and for the WebSocket (`?token=`); constant-time compare; bodies ≤ 64 KB; message rate limited.
- Disconnects never affect gameplay: state shown as `connected | reconnecting | offline`, reconnect with exponential backoff + jitter (1 s → 30 s cap), at most one socket at a time, `stop()` leaves no timers.
- Every inbound message goes through `TikTokEventManager.ingest` (validation, dedupe); the source never trusts payloads.

## Review Focus

- Garbage/oversized/binary WebSocket messages, a flood of messages, an array with a bad element.
- Server closes mid-round; reconnect storm; `stop()` during a pending reconnect; heartbeat timeout with a half-open socket.
- Wrong/missing token; non-JSON body; body over the limit; token compared in constant time.
- Missing `WebSocket` global (non-browser/old browser): offline, no throw.

### Task 1: WebSocketSource (game side)
**Files:** Create `src/tiktok/WebSocketSource.ts`, `tests/unit/WebSocketSource.test.ts`.
**Interfaces:** `interface WsLike { onopen; onmessage; onclose; onerror; close(): void; readonly readyState: number }`; `class WebSocketSource { constructor(opts: { url: string; sink: (raw: unknown) => void; onState: (s: ConnectionState) => void; create?: (url: string) => WsLike; heartbeatMs?: number; backoff?: { minMs: number; maxMs: number }; rng?: () => number; maxMessageBytes?: number }); start(): void; stop(): void }`.
Behavior: `start` idempotent; state `reconnecting` while connecting, `connected` on open; messages: string only, ≤ `maxMessageBytes` (64 KB), JSON-parsed; `{ping:true}` refreshes the heartbeat and is not forwarded; arrays forwarded element by element (a bad element does not block others); no message for `heartbeatMs` (default 45 s) → close and reconnect; close/error → `reconnecting` + backoff timer (min 1 s doubling to max 30 s with jitter; reset on a successful open that stays up); `stop()` → `offline`, closes the socket, clears timers; `create` throwing or missing → `offline`, retry per backoff; sink exceptions caught.
- [ ] Tests with a fake socket + `vi.useFakeTimers`: connect/state transitions; messages forwarded; ping not forwarded; garbage/oversize/binary ignored; array with bad element; backoff doubling and cap; jitter bounded; reset after stable open; heartbeat timeout reconnects; `stop` during pending reconnect leaves zero timers and no further sockets; double `start` → one socket; `create` throws → offline and retries. RED → implement → GREEN → commit.

### Task 2: Bridge server
**Files:** Create `server/bridge.ts` (library: `createBridge(opts) → { start(): Promise<{port}>; stop(): Promise<void>; publish(event) }`), `server/main.ts` (CLI: reads `BRIDGE_TOKEN`, `BRIDGE_PORT`, `BRIDGE_HOST`), `tsconfig.server.json`, `tests/server/bridge.test.ts`; devDeps `ws`, `@types/ws`, `@types/node`; scripts `bridge`, root tsconfig excludes `server` and `tests/server`.
Behavior: HTTP `POST /event` (Bearer token, JSON object or array ≤ 64 KB, validated with the same shape rules as the game → 202 with count / 400 / 401 / 413 / 429); `GET /health` → 200 without auth; WebSocket upgrade requires `?token=`; broadcast to all clients; server ping message `{ping:true}` every 15 s; per-IP/token rate limit (config); refuses to start without a token (≥ 16 chars); `stop()` closes sockets and timers.
- [ ] Tests (port 0): auth failures for HTTP and WS; valid POST reaches a connected WS client; array and invalid elements (valid ones relayed, count reported); oversize → 413; non-JSON → 400; rate limit → 429; ping arrives; start without token throws; `stop()` frees the port. RED → implement → GREEN → commit.

### Task 3: Wire into the page and document
**Files:** Modify `src/main.ts` (`?bridge=ws://127.0.0.1:8787&token=...` starts a `WebSocketSource` feeding `game.ingestEvent` and `events.setConnection`; `stop` on `pagehide`), Create `docs/tiktok-integration.md` (research finding above, run instructions, token handling, `curl` example, provider mapping table showing which TikTok events map to which `LiveEvent` types, limits), Create `tests/unit/GameBridge.test.ts`.
- [ ] Integration test: `Game` + `WebSocketSource` with a fake socket: events raise progress; closing the socket mid-round does not stop the round, state shows `reconnecting`; reconnect resumes events; `stop()` ends cleanly; garbage messages never break the loop. Commit `feat: provider-neutral TikTok bridge`.

### Task 4: End-to-end check
- [ ] Start the real bridge on a free port, open the built page in Playwright with `?bridge=...`, `curl`/`fetch` several events, confirm the HUD counters rise and the page shows `connected`; kill the bridge, confirm the game keeps cooking and shows `reconnecting`; restart, confirm it reconnects. Record the result in the final report.

## Self-Review
§5 integration requirements: reconnection, disconnection safety, no assumed API (research finding), testable without TikTok (mock still default). Remaining risk is outside this repo: provider choice and terms compliance.
