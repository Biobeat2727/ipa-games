# TODO / Known Issues

## ✅ Resolved

### PWA Stale Cache — 404 on Real Devices
- `vercel.json` added: SPA rewrite + `no-store` on `sw.js`/`registerSW.js`/`index.html`
- `globIgnores: ['**/index.html']` in workbox — SW never serves stale HTML
- Refresh after any deploy now serves the latest version automatically

---

## 🟡 Bugs

- **Refresh mid-question** — player reconnecting mid-question gets a fresh timer and answer box even if the buzz window has already closed. `loadQuestion` needs to validate buzz window expiry against the server before restoring answer UI.
- **Player count on host lobby** — doesn't update in realtime when players leave teams. Needs testing to confirm current state. (Low priority)

---

## 🟢 Improvements / Not Yet Built

- Projector setup screen
- Format changes / content editor

---

## 🕒 Deferred: Ably Clock-Offset Correction (buzzer reveal simultaneity)

**Status:** NOT built — deferred on purpose. Only add if real-device testing shows a *specific* device consistently revealing the buzzer early or late vs the others (the signature of a wrong OS clock). If phone+laptop reveal looks tight, you never need this.

**Context — what's already built (pieces 1 & 2):**
- `question_activated` carries the public `question` inline (no per-device DB fetch in the reveal path). Host: `activateQuestion` in `src/routes/host/Game.tsx`.
- `buzz_opened_at` is a ~450ms-future reveal timestamp (`REVEAL_BUFFER_MS` in `Game.tsx`). Players `setTimeout` the buzzer flip to that instant so all devices reveal at the same wall-clock time. Player scheduling: `question_activated` handler in `src/routes/play/index.tsx` (`revealTimerRef`, `revealClaimRef`, `REVEAL_FALLBACK_GRACE_MS`).

**The gap this closes:** piece 2 currently trusts each device's NTP-synced clock (`Date.now()`). Usually accurate to tens of ms, but a device with automatic time off, a stale wifi-only tablet, or a drifted laptop can be off by seconds — and if so, that one device's reveal silently fires early/late with no correction. This makes the shared clock **Ably's server time** instead of any one phone's OS clock.

**Implementation sketch (simplified NTP against `ablyClient.time()`):**
1. On connect (and on reconnect — covers a device dropping wifi mid-game), each client fires 2–3 quick `ablyClient.time()` calls, measuring round-trip time (RTT) for each.
2. Take the sample with the **smallest RTT** (least distorted by network queueing). Compute `offsetMs = serverTime - (localSendTime + rtt/2)`. Store it per-device in a ref.
3. Host publishes `buzz_opened_at` as its own corrected time + buffer: `(Date.now() + hostOffsetMs) + REVEAL_BUFFER_MS`.
4. Each receiving client schedules against **its own** corrected clock: `delay = buzz_opened_at - (Date.now() + myOffsetMs)`, then `setTimeout`. The existing `Math.max(0, delay)` clamp already means a wildly-off device falls back to "reveal immediately" rather than breaking.

**Where it plugs in:** add offset measurement in `src/lib/ably.ts` (or a small `useAblyClockOffset` hook) exposing a `getOffset()` ref. Host uses it when computing `revealAt` in `activateQuestion`; players use it in the `question_activated` `delay` calc. No new backend, no DB migration — just extra round-trips on a connection already open.

**Cost / why deferred:** adds real surface area (round trips on connect/reconnect, offset state, a fallback for `time()` not-yet-resolved/failed) to protect against a rare failure. Per the "don't add failure points you haven't observed a need for" call — build only when a real device proves it's needed.

---

## Final Tap — Known Edge Cases (documented, not actionable)

- `currentTurnTeamId` is ephemeral (broadcast only). Host page refresh resets it — host must use "give" button to reassign.
- If host refreshes during `question` phase of FJ, state restores to `wager` phase (can't recover timer start timestamp from DB). Host must click "Reveal Anyway" to restart the question.
- Eliminated players (non-top-3) land in `fjSubPhase = 'done'` immediately on `fj_wager_open`.

---

## Testing Notes

- Use `⚡ FT` button in host scoreboard (dev only) to skip directly to Final Tap from any point in the game
- DEV guard: `import.meta.env.DEV` — button never appears in production builds
