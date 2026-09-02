# TODO / Known Issues

## ✅ Resolved

### Launch-readiness fixes + player-experience pass (2026-07-20)
- **Reliable lobby player counts**: host counts now refresh on every player database change,
  join/leave broadcasts, and a recovery poll; stale overlapping refreshes are ignored. A failed
  Leave Team request keeps the player in place with a retry message instead of desynchronizing.
- **Refresh-safe Final Tap**: phase, revealed question, database-owned response deadline, and
  current review team are persisted on the room. Host, player, and projector refreshes recover
  the same state without restarting the 90-second timer or exposing the clue early.
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
- **Server-authoritative Final Tap responses**: phones submit through a session-validated database
  function that enforces the persisted Final deadline and locks the first teammate response. Direct
  anonymous wager updates are removed, retries are idempotent, and countdown rounding no longer
  closes Final Tap early.
- **Consistent room and player-session recovery**: host, player, and projector now share the same
  current-day active-room discovery rule. A player phone only restores its saved team after its
  browser session membership is confirmed, so abandoned prior-day rooms and copied team IDs cannot
  reopen stale games.

### PWA Stale Cache — 404 on Real Devices
- `vercel.json` added: SPA rewrite + `no-store` on `sw.js`/`registerSW.js`/`index.html`
- `globIgnores: ['**/index.html']` in workbox — SW never serves stale HTML
- Refresh after any deploy now serves the latest version automatically

---

## 🟢 Improvements / Not Yet Built

- Projector setup screen
- Format changes / content editor

### Refresh after game over loses the results screen (found 2026-08-27, FIXED 2026-09-02)

**Fixed.** The player's resume now accepts today's finished room when the phone's saved team
belongs to it and no newer lobby exists, and lands on the results (`src/routes/play/index.tsx`).
The projector falls back to today's most recent finished room
(`findMostRecentFinishedRoomToday` in `src/lib/roomDiscovery.ts`). Both poll for the next lobby
every 3s while showing a finished game, so New Game still moves everyone on — the general
`findCurrentActiveRoom()` rule was left untouched. Covered by the post-game refresh checks in
`tmp/three-round-smoke.mjs` and `tmp/chaos-test.mjs`. Original notes kept below.


Reloading a phone AFTER the host finishes the game drops the player to
"Waiting for host to open a lobby" instead of the final standings.

Cause: `findCurrentActiveRoom()` filters `.neq('status', 'finished')`
(`src/lib/roomDiscovery.ts:14`), so once the room is finished a fresh page load
finds nothing to join. Players who simply leave the screen open are unaffected —
this only bites on reload/reopen.

It matters more than it used to: the post-game feedback box and the Venmo /
website / Instagram links live only on that screen, so a reload means losing the
one prompt to send feedback.

Possible fix: let discovery fall back to today's most recent *finished* room when
the device's stored team belongs to it, and land such a player straight on the
results screen (read-only). Care needed — that function is shared by host,
player, and projector discovery, and loosening it naively would let stale rooms
reopen, which the current rule deliberately prevents. Worth a focused test with
`chaos-test.mjs` afterwards.

Found by the resilience audit; every other disruption tested (refresh mid-buzz,
refresh mid-typing, app backgrounded, browser closed and reopened, network drops,
projector refresh, intermission refresh) recovered correctly.

### Graphics / animation performance pass (raised 2026-08-27, deliberately deferred)

The game should feel smooth on every device, not just fast ones. Observed on a real
run-through; none of it blocks play:

- **Question reveal is choppy.** The full-screen clue that expands after a player taps a
  tile stutters through its transition. Prime suspect: animating properties that force
  layout/paint every frame instead of `transform`/`opacity` (which the compositor can run
  on the GPU), plus the growing element carrying a large shadow/blur.
- **Projector bubbles are framey at 60Hz.** `Bubbles` in `src/components/Barware.tsx`
  animates many elements continuously behind the board — likely too many nodes, or
  keyframes that are not compositor-only. Options: fewer bubbles on the projector, one
  canvas/SVG layer instead of N elements, or `will-change: transform`.
- **General:** audit the keyframes in `src/index.css` for non-compositable properties
  (width/height/top/left/filter), look for animations still running on screens where they
  are not visible, and profile the board at 5-6 categories x 15 teams — the heaviest real
  render.

Approach when picked up: profile first on the actual projector machine and a mid-range
phone (DevTools performance panel + paint flashing) rather than optimizing blind — the two
surfaces have very different bottlenecks. `prefers-reduced-motion` support already exists
and should stay the escape hatch.

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

## Final Tap — Known Behavior

- Eliminated players (score 0 or below after Round 2) land in `fjSubPhase = 'done'` when wagering opens.

---

## Testing Notes

- Use `⚡ FT` button in host scoreboard (dev only) to skip directly to Final Tap from any point in the game
- DEV guard: `import.meta.env.DEV` — button never appears in production builds
