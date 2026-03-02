# Real-Time Architecture

## Channel Naming

**Single broadcast channel per room:** `room:{room.id}` (UUID)

The room's UUID is used — never the `code` column. Every client that has resolved to the same room subscribes to the same channel name. This is deterministic: every client fetches the room ID from the DB, so there is no possibility of mismatch.

Additional scoped channels:
- `host-lobby-{roomId}` — postgres_changes on `teams` (host lobby only)
- `play-room-{roomId}` — postgres_changes on `rooms` (player, watching for status changes)
- `play-teams-{roomId}` — postgres_changes on `teams` (player select_team screen)
- `play-buzz-{buzzId}` — postgres_changes on `buzzes` (player watching their own buzz result)
- `play-team-{teamId}` — postgres_changes on `players` (lobby teammate list)
- `play-kick-{roomId}` — broadcast `lobby_closed` listener (join_lobby/select_team/lobby phases)
- `host-game-{roomId}` — postgres_changes on `rooms` + `teams`
- `host-questions-{roomId}` — postgres_changes on `questions` filtered by `category_id=in.(...)`
- `host-buzzes-{questionId}` — postgres_changes on `buzzes` for active question
- `host-fj-wagers-{roomId}` — postgres_changes on `wagers`
- `projector-db-{roomId}` — postgres_changes on `rooms`, `teams`, `questions`
- `projector-buzzes-{questionId}` — postgres_changes on `buzzes` for active question

---

## Broadcast Events (all on `room:{roomId}`)

### Lobby / Lifecycle

| Event | Sender | Payload | Effect |
|---|---|---|---|
| `team_joined` | Player | `{}` | Host + other players on select_team refresh team list |
| `lobby_closed` | Host | `{}` | All clients kicked: players → `no_lobby`, projector → `waiting` |
| `game_state_change` | Host | `{ status, fj_category?, active_team_ids? }` | All clients transition to new game state |

### Question Flow

| Event | Sender | Payload | Effect |
|---|---|---|---|
| `question_preview` | Player (turn) | `{ questionId, categoryName, pointValue, startTs }` | 10s countdown shown on all screens |
| `question_activated` | Player (turn) | `{ question_id }` | Buzz button goes live; `rooms.current_question_id` set |
| `question_deactivated` | Host | `{}` | Clears active question on all clients |
| `timer_start` | Host | `{ start_timestamp, duration_seconds, team_id, buzz_id, team_name }` | Synced countdown on all screens |
| `score_update` | Host | `{ teams: [{id, score}], current_question_id?, answered_question_id? }` | Updates scores everywhere; greys out answered board cell |
| `turn_change` | Host | `{ team_id: string \| null }` | Assigns or clears category-pick rights |

### Final Jeopardy

| Event | Sender | Payload | Effect |
|---|---|---|---|
| `fj_wager_locked` | Player | `{ team_id }` | Projector + host update wager status display |
| `fj_question_revealed` | Host | `{ question_id, start_ts, duration }` | Question shown + 90s timer starts |
| `fj_timer_expired` | Host | `{}` | Players auto-submit current response |
| `fj_answer_reveal` | Host | `{ team_name, response }` | Projector shows team's response |
| `fj_answer_judged` | Host | `{ team_id, status, wager, new_score }` | Projector shows result + score change |
| `game_over` | Host | `{ scores: [{id, score}] }` | All screens show final winner |

---

## Timer Logic

Timers use sender's `Date.now()` as `start_timestamp`. All clients compute remaining time as:

```
remaining = Math.max(0, start_timestamp + duration_ms - Date.now())
```

This stays in sync regardless of when a client joined. The 10s question preview uses `startTs + 10_000`. The 30s buzz timer uses `start_timestamp + duration_seconds * 1000`.

---

## Reliability Pattern

**postgres_changes requires the table to be added to the Supabase realtime publication** (Dashboard → Database → Replication). Currently required for: `rooms`, `teams`, `questions`, `buzzes`, `wagers`.

**Broadcasts are the primary real-time path** for game events. postgres_changes is a secondary/fallback for data integrity.

**Key pattern for stable callbacks:** The projector uses `roomRef` (a ref synced to `room` state) inside `resyncAll` and `refetchTeams` so these `useCallback` functions never go stale inside effect closures. Both channels call `resyncAll()` in their `SUBSCRIBED` callbacks to catch any events missed during connection.

**`team_joined` broadcast reliability:** The player sends this on the `room:${roomId}` channel that is already subscribed (stored in `lobbyChannelRef`). A new channel with the same name must NOT be created — Supabase's client caches channel objects by name, so creating a duplicate returns the same object, and cleanup from a phase transition would silently kill it.
