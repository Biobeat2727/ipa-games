# TODO / Known Issues

## ✅ Resolved

### Launch-readiness fixes + player-experience pass (2026-07-20)
- **Error boundary**: `src/components/ErrorBoundary.tsx` wraps /play, /host, /projector — render crashes show a friendly reload screen instead of a white screen (session survives reload).
- **Silent buzz failure**: failed buzz insert now shows "Buzz didn't go through — tap again!" + vibration instead of silently dropping the player.
- **Connection-drop banner**: `src/components/ConnectionBanner.tsx` — amber "Reconnecting…" strip when Ably drops, green "Back online" flash on recovery.
- **FJ review stuck on missing wager**: a team in the reveal order with no wager row used to strand the host on "Loading review…" forever. Now shows a "Skip Team →" card (no score change).
- **Player-experience pass**: halftime intermission redesign (personal rank hero + medal standings + staggered reveals, player & projector), champion game-over screens (confetti on winning phones, final-rank hero for the rest, projector confetti bursts), Round 2 splash on phones, buzzer glow, pop-in/shake result animations, low-timer pulses, `prefers-reduced-motion` support.
- **Atomic clue selection**: the first valid teammate tap owns the pending clue; simultaneous picks converge on one clue, Double Tap wagering stays with the winning device, and the host can Undo Pick.
- **Atomic regular/Double Tap judgment**: Correct/Wrong now saves buzz status, team score, and question completion in one authorized transaction. Buttons lock while saving, retries are safe, and conflicting duplicate judgments are rejected.
- **Atomic Final Tap judgment**: Final Correct/Wrong now saves wager status and team score together using the locked database wager. Rapid taps cannot score twice, controls lock while saving, and connection-loss retries are safe.
- **Reliable game-over transition**: the room only enters the winner screen after the authorized `finish_game` transaction confirms every submitted Final wager is judged. It returns authoritative scores, supports safe retries, and recovers after a host refresh between the last judgment and game over.
- **Reconnect-safe response deadlines**: every buzz now receives an immutable database deadline (15s regular, 40s Double Tap). Reconnecting devices restore that exact deadline using the shared server clock, and the database rejects late, blank, or second submissions.

### PWA Stale Cache — 404 on Real Devices
- `vercel.json` added: SPA rewrite + `no-store` on `sw.js`/`registerSW.js`/`index.html`
- `globIgnores: ['**/index.html']` in workbox — SW never serves stale HTML
- Refresh after any deploy now serves the latest version automatically

---

## 🟡 Bugs

- **Player count on host lobby** — doesn't update in realtime when players leave teams. Needs testing to confirm current state. (Low priority)

---

## 🟢 Improvements / Not Yet Built

- Projector setup screen
- Format changes / content editor

---

## 🔬 Buzzer Timing Beta-Test Tool (kept in permanently, DEV-only)

Host scoreboard header has a **🔬 Timing ON/OFF** toggle (gated by `import.meta.env.DEV`,
same pattern as `⚡ Graph`/`⚡ FT` — invisible in production builds). Flip it on before
activating a question and every connected player self-reports its buzzer reveal timing
back to the host automatically — no manual per-phone reading required. Useful for
validating reveal simultaneity at real event scale (20+ devices, real venue wifi) without
walking around collecting numbers.

How it works: the toggle rides a `debugTiming: true` flag inline on the existing
`question_activated` broadcast (no separate sync mechanism, so late joiners get it too).
Each player publishes a `buzz_debug_report` the instant it reveals — including devices
that fell to the FALLBACK-DB path (missed the live broadcast entirely), which is the
failure case most worth seeing. Host renders a live table (team, device id, clock offset,
receive delay, time-since-first-reveal, path) sorted by reveal time, with the spread
(worst − best) auto-computed and flagged red past 100ms.

Code: `debugTimingMode`/`debugReports` state + table render in `src/routes/host/Game.tsx`;
`debugTimingRef` + `buzz_debug_report` publish in `src/routes/play/index.tsx`.

---

## ✅ Ably Clock-Offset Correction (buzzer reveal simultaneity) — BUILT 2026-07-17

**Status:** implemented on branch `buzzer-reveal-sync-test` after real-device testing
proved the need: laptop/phone/desktop OS clocks measured 130–190ms apart (recv delays of
530/584ms against a 450ms buffer — impossible without skew), staggering the scheduled
reveal by exactly that skew. Implementation: `syncServerClock()` / `serverNow()` in
`src/lib/ably.ts` (3 sequential `ablyClient.time()` samples, lowest-RTT wins, re-sync on
every Ably `connected`). Host schedules `revealAt = serverNow() + buffer`; players compute
reveal delay and buzz-window countdowns via `serverNow()`. Failed sync degrades gracefully
(offset stays at last value; initially 0 = local clock).

Original design sketch kept below for reference:

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
