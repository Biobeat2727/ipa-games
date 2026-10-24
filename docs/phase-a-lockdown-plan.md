# Phase A: player-side lockdown (plan for review, 2026-10-24)

Goal: nothing a phone can do through the public Supabase key or the public Ably key lets it
act for another team, disrupt a room it isn't in, or see what it shouldn't. Players and
hosts should notice no difference. Phase B (host Remove / Block / Unblock / Rename) builds on
this. See `docs/host-moderation-plan.md` for the findings table.

## Audit: every database path the clients use

**Host** (`host/index.tsx`, `host/Game.tsx`, `useEmptyTeamSweep`) runs signed in as an
approved host. Its reads and writes go through host-owned-room policies or host RPCs
(`judge_buzz`, `judge_final_wager`, `kick_team`, `reveal_final_question`, `finish_game`).
**No change needed.**

**Phone** (`play/index.tsx`), with the anon key:

| Path | Today | Exposure |
|---|---|---|
| Create team (`teams` insert, :1783) | direct insert | any visitor can create teams in any room |
| Join team (`players` insert, :1850) | direct insert | join any team |
| Leave / retire other seats (`players` delete, :1809, :1860) | direct delete, filtered by session id | policy is `true`: can delete anyone's seat |
| Buzz (`buzzes` insert + read-back, :1722, :1731) | direct insert | buzz for any team |
| Submit answer (`buzzes` update, :1989) | direct update; trigger guards deadline/first submit | answer on another team's buzz; rewrite `buzzed_at` / `team_id` |
| Final wager (`wagers` insert, :2171) | direct insert | wager for another team; delete any wager |
| Own Final wager (`wagers` select, :1307, :1314, :1421, :2177) | table read | reads **every** team's wager and Final answer |
| Pick a clue / confirm Double Tap wager (`claim_question_selection`, `confirm_question_selection`) | RPC, caller identified by `p_session_id` | session ids are public, so anyone can act as the selecting phone |
| Final answer (`submit_final_response`) | RPC, identified by `p_session_id` | same impersonation |
| Board / clues (`questions_public`) | view read | **clue text for every unplayed question is readable**, so a team can pre-read and look up the whole board (the "clue hidden until Open Buzzer" rule is UI-only) |
| Teams, players, rooms, buzzes reads; realtime on rooms/teams/players/own buzz | public read | fine once identity needs a secret (see below) |

**Projector** (anon key): reads `teams`, `categories`, `questions_public`, `buzzes`, and
`wagers` (all rows, to show who has wagered, and the reviewed team's answer after a refresh
during review). Needs a narrower wager read; everything else is fine.

**Correct responses are safe:** phones get "permission denied" on the full `questions` table.
`feedback`, `mailing_list` and `authorized_hosts` return no rows to the anon key.

**Ably** (`src/lib/ably.ts`): every client connects with the full API key from
`VITE_ABLY_KEY`. Anyone can lift it from the site and publish fake host events
(`question_activated`, `score_update`, `team_kicked`, Final reveals) to any room, or run up
usage on the account. Scores stay correct in the database, but screens can be spoofed.

## Design

### 1. Device identity (key, not login)
- Each phone gets a **new device id + private secret** (random, stored in localStorage).
  The server stores only a SHA-256 hash of the secret, in a `player_devices` table that has
  no anon access at all. The first call from a new device id registers it; every later call
  must present the matching secret.
- The device id is newly generated, so it was never readable anywhere before it registered.
  That means nobody can pre-claim a real phone's id. It replaces `session_id` as the public
  identifier in `players` and `rooms.pending_selection_session_id`; being readable is harmless
  because acting needs the secret.
- Considered and rejected: **Supabase anonymous sign-in.** Its default sign-up rate limit is
  per IP, and every phone at a bar shares one IP, so a busy night could hit it. It also
  creates an auth user per phone, and it collides with the host's login when one browser
  tests both roles.

### 2. Phone actions become functions (each verifies device secret + team membership)
| New / changed function | Replaces |
|---|---|
| `create_team(room, name, nickname)`: team + seat in one step, retires other seats in the room | teams insert + players insert + cleanup |
| `join_team(team, nickname)`: seat, retires other seats in the room | players insert + cleanup |
| `leave_team(room)` | players delete |
| `claim_buzz(question)`: team derived from the caller's seat; same server timestamp and deadline trigger | buzzes insert + read-back |
| `submit_buzz_response(buzz, text)`: buzz must belong to caller's team | buzzes update |
| `submit_final_wager(room, amount)` / `get_my_final_wager(room)` | wagers insert / select |
| `claim_question_selection`, `confirm_question_selection`, `submit_final_response`: add the secret check | same functions, `p_session_id` only |
| `final_board(room)` (anon, for projector + phones): who has wagered; amount, answer and result only for teams the host has revealed or judged | projector `wagers` read |

Same rules as today otherwise (late joins allowed, team creation refused in Final Tap, one
buzz per team per clue, wager 0–score, Final deadline). No gameplay changes.

### 3. Close the direct paths
- `players`: drop public insert/delete. Keep read.
- `teams`: drop the anon insert policy (creation goes through `create_team`).
- `buzzes`: drop public insert/update/delete. Keep read (queue order; normal-clue answers
  are spoken aloud anyway).
- `wagers`: drop all public/anon policies (read included).
- Also revoke the matching table privileges, so a future dashboard policy can't silently
  reopen them.
- `questions_public`: clue text is null until the clue is live (`rooms.current_question_id`)
  or answered; Final clue only once the host reveals it.

### 4. Ably (Phase A2, after the database work)
- Replace the embedded key with **token auth** from a small Vercel function: hosts (verified
  by their Supabase login) get publish rights on their room; phones and projector get
  subscribe plus a separate player-events channel. That means splitting host-only events from
  phone events (`team_answer_submitted`, `timer_start`, `team_locked_out`, `team_joined`).
- **Quick win you can do in the Ably dashboard now:** restrict the key's capabilities to the
  `room:*` / lobby channels the app uses. That doesn't stop spoofing, but it limits misuse of
  the key outside the app.

## Rollout (two SQL steps, between games)
1. **Additive SQL** (`supabase/phase_a_1_functions.sql`): device table, new and updated
   functions, `final_board`, view change. Old app keeps working, since the open policies are
   still there.
2. **Deploy the app** that uses only the new functions. Run the full test sweep against it.
3. **Lockdown SQL** (`supabase/phase_a_2_lockdown.sql`): drop the open policies and revoke
   privileges, captured in the repo from now on. Phones on an old cached build can't join or
   buzz until they update, so apply right after deploy, between games. A rollback file
   restores today's policies.

The updated `confirm_question_selection` / `submit_final_response` keep their old signatures
until step 3, so an old phone mid-update still works between steps 1 and 3.

## Testing
- New `tmp/security-probe.mjs`: with the anon key, each attack in the findings table must
  fail (delete/insert seats, buzz or answer for another team, rewrite buzz time/team,
  read/insert/delete wagers, read an unplayed clue, act with a known device id but wrong
  secret). Run it before step 3 (expect failures to *succeed*, proving the probe works) and
  after (all refused).
- Full harness sweep, with harness join/buzz paths updated: three-round smoke, chaos,
  15- and 25-team load, keyboard, armed buzzer, kick, turn, draft-timeout, updates,
  projector fit. Compare buzz latency under load before and after: buzzing gains a
  function call, and fairness still uses the database timestamp.
- Codex review of the SQL and client changes before step 3.

## Decisions for Davey
1. Device key (recommended) vs Supabase anonymous sign-in.
2. Two-step rollout (recommended) vs one combined SQL run.
3. Hide unplayed clue text in `questions_public` as part of Phase A (recommended).
4. Optional: also refuse buzzes before `buzz_opened_at` on the server. Not recommended yet:
   clock offsets of a few ms could reject honest taps; the existing tap lockout covers it.
5. Ably token auth as Phase A2 right after (recommended), plus the dashboard key restriction
   now.
