# Launch-Readiness Audit — 2026-07-17

Audit of the app as a **paid, live-event product**. Focus: what fails in front of real
players, what erodes trust, and where "professional polish" is missing — not code
aesthetics. Findings are ordered by how badly they'd hurt a paid event.

Each item lists the **user-facing symptom** first (what a player/host actually sees),
then the technical cause, the fix, and rough effort. Items marked **[VERIFY]** are things
I strongly suspect from the code but can't fully confirm without looking at the live
Supabase project (RLS policies, table constraints).

Legend: 🔴 fix before charging money · 🟠 fix during beta · 🟡 polish · 🔵 operational (no code)

---

## 🔴 Critical

### 1. A single render crash = blank white screen, no recovery
- **Symptom:** if any screen hits an unexpected error (a malformed broadcast, an
  unexpected `null`), that player's phone goes **completely blank**. The only way back is
  a manual refresh — which a player won't know to do, and which may drop them from the
  current question. In a room full of paying players, this is the worst-feeling failure.
- **Cause:** there is no React **error boundary** anywhere. `src/App.tsx` renders the
  routes directly, so one thrown error unmounts the entire app.
- **Fix:** add a top-level `ErrorBoundary` that catches render errors and shows a friendly
  "Something went wrong — reconnecting…" screen that auto-reloads after a second (and a
  manual "Tap to reload" button). This converts a dead white screen into a self-healing
  blip. ~30–45 min.

### 2. A failed buzz is silent — the player thinks they buzzed but didn't
- **Symptom:** player taps the buzzer, hears the sound, feels the vibrate — but if the
  buzz didn't actually record (network blip, Supabase hiccup), **nothing tells them.**
  They believe they buzzed first; the host never sees it. At a competitive paid event this
  is a direct "I buzzed and it didn't count!" argument.
- **Cause:** `src/routes/play/index.tsx` `handleSubmitBuzz` — on insert failure it just
  does `setBuzzing(false); return` with no user feedback and no retry.
- **Fix:** on failure, keep the buzzer "armed" and show a brief "Didn't register — tap
  again" state, and/or auto-retry the insert once. The player must never be left believing
  a failed buzz succeeded. ~30 min.

---

## 🟠 Important (address during beta)

### 3. Players get no warning when their connection drops
- **Symptom:** on shaky venue wifi, a player's realtime connection can silently drop. They
  stop receiving broadcasts — **the buzzer never appears, timers freeze** — with zero
  indication anything is wrong. They just think the game is stuck or broken.
- **Cause:** there is no handling of Ably connection state (`disconnected` / `suspended` /
  `failed`) or `navigator.onLine` anywhere in the app. Room/score state has a 3s DB polling
  fallback, but **broadcast-only events (buzzer reveal, timer start) have no fallback** — a
  disconnected player simply misses the question.
- **Fix:** subscribe to Ably connection state; show a "Reconnecting…" banner while not
  connected; on reconnect, re-run the existing resync so the player catches up. This is the
  single biggest reliability win for real venue conditions. ~1–2 hrs.

### 4. One team can appear twice in the buzz queue [VERIFY]
- **Symptom:** two teammates tapping the buzzer at nearly the same instant can both
  register a buzz, so the team shows up **twice** in the host's queue.
- **Cause:** the "already buzzed" guard (`hasBuzzed`) is per-phone, so two phones on the
  same team race before either's `timer_start` broadcast propagates. The `buzzes` table
  (per `docs/db-schema.md`) has **no unique constraint on `(question_id, team_id)`** to
  stop it at the database level.
- **Fix:** add a `UNIQUE (question_id, team_id)` constraint on `buzzes` so the second
  insert is rejected cleanly, and treat that rejection as "already buzzed" on the client.
  Small migration + a few lines. **[VERIFY]** the constraint isn't already there.

### 5. Answers may be readable by players — cheating vector [VERIFY]
- **Symptom:** a technically-savvy player could read **every correct answer** before the
  game, from their own phone.
- **Cause:** players are meant to use the `questions_public` view (which hides
  `correct_question`). But the **projector code queries the full `questions` table**
  (`src/routes/projector/index.tsx:98`), and the projector runs as the same anonymous
  client a player has. For that query to work, the `questions` table must be readable by
  the anonymous key — which means a player could run the same query in their browser
  console and get all answers. The `questions_public` view only helps if the base
  `questions` table is **not** anon-readable. (Note: `docs/db-schema.md` says the projector
  uses `questions_public`, but the code does not — a doc/code mismatch.)
- **Fix:** **[VERIFY]** the RLS policy on `questions` in the Supabase dashboard. If anon
  can `SELECT` it, either (a) lock `questions` down and point the projector at
  `questions_public` too, or (b) accept it as a known low-risk gap for a friendly crowd.
  For a paid event with prizes, close it. ~30 min once RLS is confirmed.

### 6. Judge writes aren't checked — scores and board can silently diverge

**Resolved for regular and Double Tap clues:** Correct/Wrong now uses the authenticated `judge_buzz` database transaction.
Buzz status, score, and question completion succeed or fail together; same-result retries are
safe, conflicting re-judgments are rejected, and host controls lock while the save is in flight.
- **Symptom:** rare, but a team's score could update while the question fails to mark as
  answered (or vice-versa), leaving the board and scores inconsistent for the rest of the
  game.
- **Cause:** `handleCorrect` / `handleWrong` in `Game.tsx` fire several DB writes via
  `Promise.all` with **no error checking**. If one write is silently rejected (e.g. an RLS
  edge case returns `{ error: null }` but writes nothing), the others still proceed.
- **Fix:** check each write's result and surface a host-visible warning if any fails, so
  the host can re-judge rather than unknowingly continuing from a bad state. Also disable
  the Correct/Wrong buttons while a judgment is in flight to prevent double-application from
  an impatient double-tap. ~45 min.

---

## 🟡 Polish / professional feel

### 7. Host refresh mid-game loses the "current turn" highlight
- Already tracked in `docs/TODO.md`. Turn is now persisted to `rooms.current_turn_team_id`
  (`Game.tsx` `assignTurn`) and players hydrate it, but the **host** view doesn't restore
  it on refresh. Minor, but looks unpolished if the host reloads. Hydrate
  `currentTurnTeamId` from the room row in the host's init.

### 8. Refresh mid-question can restore a stale answer box
- Already in `docs/TODO.md`: a player reconnecting mid-question can get a fresh answer box
  even if the buzz window already closed. Worth validating buzz-window expiry on restore.

---

## 🔵 Operational / infra (no code changes)

### 9. Supabase free-tier auto-pause → pre-event checklist item
- The DB pauses after ~1 week idle. It will **not** pause during a live event (constant
  activity keeps it awake), so the real exposure is just: it paused during a quiet week and
  you arrive to a cold DB the morning of. Unpausing is quick. **Mitigation:** a run-of-show
  step — "day before: open the app, wake the DB, play one full test round." No paid upgrade
  required unless player counts grow (see #10).

### 10. Confirm Ably + Supabase plan limits cover peak load [VERIFY]
- A buzz storm (every team buzzing at once) plus per-question broadcasts multiplies fast
  with player count. Before a paid event at real scale, confirm your Ably message/connection
  quota and Supabase concurrent-connection limits comfortably exceed
  `(teams × players)` at peak. Cheap to check, expensive to discover live.

### 11. No run-of-show / smoke-test checklist yet
- A one-page pre-event checklist (wake DB, import content, create lobby, join from a second
  phone, run one question end-to-end, verify projector) turns "hope it works" into "verified
  it works" before doors open. Worth writing once and reusing every week.

---

## ✅ Checked and looked solid

So the audit reads as balanced, not alarmist — these areas held up:
- **Realtime resilience basics:** room status, scores, buzzes, and lobby all have 3s (or
  2s) polling fallbacks layered under the realtime subscriptions — good defensive design.
- **Buzzer reveal timing:** just hardened (inline payload + scheduled reveal + race guard).
- **Cache/deploy safety:** `vercel.json` + workbox config correctly prevent stale
  HTML/service-worker serving after deploys.
- **Dev-only tools** (`⚡ FT`, `⚡ Graph`) are correctly gated behind `import.meta.env.DEV`
  and won't appear in production.
- **Secrets:** only the public anon key ships to the client (by design); `.env*` files are
  gitignored.
- **Refresh survival:** substantial, careful work already exists for reconnecting
  mid-question, mid-wager, and mid-double-tap.

---

## Suggested order

1. **#1 error boundary** and **#2 silent buzz** — small, high-impact, do first.
2. **#3 connection banner** — the biggest real-venue reliability gain.
3. **#4 / #5 [VERIFY]** — quick dashboard checks; fix if confirmed.
4. **#6 judge-write checks are complete**; proceed to polish (#7, #8).
5. Write the **run-of-show checklist** (#11) before the first paid night.
