# Real-Time Architecture

## Channel Structure
One channel per room: `room:{room_code}`. Every client subscribes on join.

## Broadcast Events

| Event | Payload | Effect |
|---|---|---|
| `game_state_change` | status | All clients transition screens |
| `question_activated` | question_id | Answer appears on all devices |
| `buzz_received` | team_id, queue_position | Updates buzz queue everywhere |
| `timer_start` | start_timestamp, duration_seconds | Syncs countdown across devices |
| `timer_expired` | team_id | Locks out responding team |
| `score_update` | full scores object | Updates all scoreboards |
| `turn_change` | team_id | Assigns category selection rights |
| `final_wager_locked` | team_id | Shows wager status to others |
| `game_over` | final scores | Triggers winner screen |

Also use Supabase Postgres row-level subscriptions on `buzzes` table for auto-reordering host queue.

## Timer Logic (Critical)
Timer starts on server, not client. When host opens a team's response window, `timer_start` broadcasts with server timestamp + duration. Every client calculates:

```
remaining = (start_timestamp + duration) - now
```

All devices stay in sync regardless of join time. Server marks buzz expired when time's up, regardless of client state.
