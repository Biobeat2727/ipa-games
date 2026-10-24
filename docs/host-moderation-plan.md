# Host moderation + join hardening (plan, agreed 2026-10-24)

Host-only tools that sit unused until needed, plus closing the database paths that let any
phone write player/team rows directly. Players never see any of it unless the host acts.
Team captains / join approval were designed and shelved: `docs/future-team-captains.md`.

## Host screen (lobby `host/index.tsx` and in-game `host/Game.tsx`)

- Each team row expands to show its players (nickname, join time). Today the host sees
  teams only.
- Per team:
  - **Remove** — today's ✕ (`kick_team`), unchanged. For teams that left. No block.
  - **Block** — removes the team and blocks every phone on it for the rest of the game.
  - **Rename** — new name updates live on phones, projector and host.
- Per player:
  - **Remove** — off the team; free to rejoin any team.
  - **Block** — off the team and out of the whole game.
- **Blocked** list: nickname, team at the time, when. Each entry has **Unblock**.
- Block asks for confirmation ("Block Alex for the rest of this game?"); Remove keeps the
  existing confirmation.
- Remove/Block follow the same timing rules as `kick_team` (refused while a clue is live or
  pending, during the Final Tap question/review, and once the game is over).

## Player side

- Removed: back to team select with "The host removed you from [Team]" (existing kicked
  notice). Can rejoin.
- Blocked: "You've been removed from this game." No join or create. If the host unblocks,
  the phone returns to team select on its own.
- Late joins stay allowed throughout (no "close joining").

## Server

- **Device key.** Each phone keeps a private secret next to its session id; the server
  stores only a hash (registered on first use). Every player write proves the key, so no
  one can act as another phone. Session ids stop being readable by other players.
- **No direct writes from phones** to `players` or `teams`. Replaced by RPCs that check
  blocks and the device key:
  `join_team`, `create_team`, `leave_team`.
- **Host RPCs** (all `host_owns_room`-checked):
  `host_remove_player`, `host_block_player`, `host_block_team`, `host_unblock`,
  `host_rename_team`.
- **`room_blocks`** table: room, session id, nickname + team name snapshot, blocked_at.
- Broadcasts `player_removed`, `player_blocked`, `player_unblocked`, `team_renamed`, each
  with a DB fallback per `docs/realtime.md`.
- Audit the other phone write paths (buzzes, wagers, responses, question selection) for the
  same direct-write exposure and report findings before changing them.

## Findings 2026-10-24 (pg_policies + no-op probes with the shipped anon key)

The dashboard-created policies give the public role `true` on most player-side writes. Any
visitor to the site can do the following in **any room, from anywhere**. The probes used
nonexistent ids, so no rows were touched.

| Action | Allowed? | Impact |
|---|---|---|
| Delete any `players` row | yes | knock every phone off every team |
| Insert a `players` row into any team | yes | join any team (the moderation gap) |
| Delete any `buzzes` row | yes | wipe a live buzz queue |
| Update `buzzes.buzzed_at` / `team_id` | yes | jump the queue; move a buzz to another team |
| Submit the first response on another team's buzz | yes (trigger only blocks a *second* submit / late) | answer for someone else |
| Insert a buzz for any team | yes | buzz a rival in so they lose points |
| Delete any `wagers` row | yes | erase a team's Final Tap wager |
| Insert a wager for another team | yes | set a rival's wager first |
| Read all `wagers` (amount + response) | yes | see rivals' Final wagers and answers before submitting |
| Read every player's `session_id` | yes | impersonate a phone |
| Update/delete `teams`, `rooms`; update `wagers` | **no** | scores and game state are safe |

Teams, rooms and scores are protected by the earlier host-auth work. The open surface is the
player-side tables. These policies should live in a repo SQL file from now on.

## Order of work

1. **Phase A: lock down player-side writes and reads** (invisible to players and hosts).
   Device key; RPCs for join/create/leave team, claim buzz, submit response, submit wager,
   each verifying the device key and team membership; drop the public delete/update/insert
   policies on `players`, `buzzes`, `wagers`; hide `session_id`; keep other teams' Final
   wager amounts and responses unreadable until the host reveals them. Audit every phone and
   projector read/write path first. Highest regression risk (buzz and Final Tap hot paths),
   so it ships alone with the full test sweep.
2. **Phase B: host moderation tools** (the sections above), built on Phase A's RPCs.

## Policy query (already run 2026-10-24)

The policies that let phones write `players` were created in the dashboard and are not in
`supabase/*.sql`:

```sql
select tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('players', 'teams', 'buzzes', 'wagers', 'rooms')
order by tablename, cmd;
```

Verified 2026-10-24 with the shipped anon key: any phone can read every player's
`session_id` across all rooms.

## Rollout

- One SQL file (`supabase/host_moderation.sql`), applied between games, then deploy right
  after. Phones on an old cached build can't join teams until they update.
- Tests: new browser test (remove vs block, unblock, rename, blocked-phone screens, direct
  API writes refused); existing harness join paths updated; re-run three-round smoke, chaos,
  15- and 25-team load tests.
- Codex review after the build (security-rule change).
