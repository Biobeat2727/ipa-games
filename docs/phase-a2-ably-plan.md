# Phase A2: Ably token auth (DEFERRED until scaling, 2026-10-24)

**Status: designed, not built. Davey's call (2026-10-24):** not worth it for a single bar. Do it
before selling Tapped In to other bars or running it with hosts you don't know.

**Why it waited:** the worst case is disruption, not a corrupted game. A savvy visitor could fake
host messages on screens (a fake clue, scores or game over), but scores, buzzes and wagers live
in the database, which Phase A locked down, so a refresh restores the truth. The build costs a
server function, a channel split touching every screen, and a key handover in two dashboards.

**Why the key is exposed at all:** the app runs entirely in the browser, and it connects to Ably
with the API key itself (`VITE_ABLY_KEY`). Every `VITE_…` setting is baked into the JavaScript
sent to every visitor, so anyone can read it in their browser's developer tools. Ably supports
this for prototypes; for production it recommends token auth (below). The Supabase anon key is
public the same way, but it is *designed* to be public: database rules govern it (Phase A).
Ably keys are not; their limits live in the Ably dashboard.

**Interim option (5 minutes, Ably dashboard):** restrict the existing key's capabilities to the
`room:*` channels the app uses. That doesn't stop fake host messages, but it stops the key being
used to burn through the account's message allowance on other channels, which could cut live
updates mid-game.

**When it's time:** also consider per-bar separation (each host and room isolated), which a
multi-bar setup wants anyway.

---

Problem: every client connects with the full Ably API key from `VITE_ABLY_KEY`, which ships
in the public JavaScript bundle. Anyone can lift it and publish fake host events
(`question_activated`, `score_update`, `team_kicked`, Final reveals, `game_over`) to any room,
or run up usage on the account. Database state (scores, buzzes) stays correct, but screens can
be spoofed.

## Inventory (who sends what today, all on `room:{id}`)

- **Host only:** category_reveal, fj_answer_judged, fj_answer_reveal, fj_question_revealed,
  fj_timer_expired, fj_wager_open, game_over, game_state_change, intermission_closed,
  lobby_closed, player_blocked, player_removed, player_unblocked, question_activated,
  question_deactivated, question_selection_cleared, round_intermission, score_update,
  team_kicked, team_renamed, turn_change.
- **Phones:** buzz_debug_report, fj_wager_locked, player_left, team_answer_submitted,
  team_joined, team_locked_out.
- **Both host and phones:** question_preview (a phone picking a clue), timer_start (a phone
  buzzing in).
- **Projector:** category_reveal_sync (phones send it too).

Ably permissions are per channel (send / receive), not per message type, so phones can't keep
sending on the host's channel without being able to send host messages there.

## Design

1. **Server-issued tokens.** A Vercel function `api/ably-token.ts` holds the key server-side
   (`ABLY_API_KEY`, never shipped to browsers) and hands each client a 1-hour token:
   - Phones and projector: receive on `room:*`; send and receive on `phones:*`.
   - A signed-in, approved host (Supabase login checked with `is_authorized_host()`): send and
     receive on both.
   The client asks for a token on connect and renews it automatically. The host page asks again
   after sign-in. Tokens are fetched once per connection, never per message, so tapping in is
   unaffected.
2. **Channel split.** Host messages stay on `room:{id}`. Phone and projector messages move to
   `phones:{id}`. A small helper (`roomChannels(roomId)` in `src/lib/ably.ts`) sends each event
   on the right channel and listens on both where an event can come from either side
   (`question_preview`, `timer_start`). Mechanical change at the ~9 places that open a room
   channel.
3. **Routing.** `vercel.json`'s catch-all rewrite gets an exception for `/api/`. Local dev
   serves the same function through a Vite middleware, so the test scripts run against it.
4. **Retire the public key.** After deploy, the old key (public in every old bundle) is revoked
   in the Ably dashboard.

## What stays possible (accepted residual)

A phone can still send *phone-type* messages on `phones:{id}`, for example a fake "Team X
submitted an answer" or a fake buzz timer. Impact: one screen briefly shows wrong state;
scores and buzz order stay correct in the database. Host messages (clues, scores, kicks,
reveals, game over) can no longer be faked. A later hardening step could have screens check
phone messages against the database.

## Davey's steps (Ably + Vercel dashboards)

1. Ably dashboard → your app → API Keys → **create a new key** (all capabilities).
2. Vercel → project → Settings → Environment Variables → add `ABLY_API_KEY` = the new key
   (Production and Preview). Do **not** prefix it with `VITE_`.
3. Add the same line to `.env.local` on this PC, so local dev and the test scripts can mint
   tokens.
4. After the new build is deployed and checked, between games: **revoke the old key** in the
   Ably dashboard. Phones still on an old cached build lose live updates until they reload.

## Testing

Smoke, chaos, updates, moderation, start-confirm and kick against the token setup locally; a
check that a phone token is refused when it tries to send on `room:{id}`; and the buzz-speed
bench (no expected change). Codex review before commit.
