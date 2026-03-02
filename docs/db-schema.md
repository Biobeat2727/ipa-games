# Database Schema

## `rooms`
| Column | Type | Notes |
|---|---|---|
| id | uuid, pk | Primary key — also used as broadcast channel ID |
| code | varchar(6), unique | Internal artifact; generated on create but never shown to users |
| host_id | uuid | Host session reference |
| status | enum | `lobby`, `round_1`, `round_2`, `final_jeopardy`, `finished` |
| current_question_id | uuid, nullable | Set when a question is active |
| created_at | timestamp | Used to identify today's room |

**One active room at a time.** When the host creates a new room, all other rooms are immediately set to `finished`. Players and projector auto-resolve to the most recent non-finished room created today.

## `teams`
| Column | Type | Notes |
|---|---|---|
| id | uuid, pk | |
| room_id | uuid → rooms | |
| name | varchar | Display name |
| score | integer | Default 0; can go negative |
| is_active | boolean | False only for non-top-3 teams after Round 2 → Final Jeopardy transition |
| created_at | timestamp | |

## `players`
| Column | Type | Notes |
|---|---|---|
| id | uuid, pk | |
| team_id | uuid → teams | |
| nickname | varchar, nullable | Optional display name |
| session_id | varchar | Browser session ID — no auth required |
| created_at | timestamp | |

## `categories`
| Column | Type | Notes |
|---|---|---|
| id | uuid, pk | |
| room_id | uuid → rooms | |
| name | varchar | |
| round | integer | 1, 2, or 3 (Final Jeopardy) |

## `questions`
| Column | Type | Notes |
|---|---|---|
| id | uuid, pk | |
| category_id | uuid → categories | No direct room_id — filter via category_id |
| answer | text | Displayed clue (Jeopardy-style: the answer is shown, teams give the question) |
| correct_question | text | Expected response — host-only, not in `questions_public` view |
| point_value | integer | 100–500 |
| is_answered | boolean | Default false |
| answered_by_team_id | uuid, nullable | |

**Views:** `questions_public` omits `correct_question`. Players and projector always query this view; host queries `questions` directly.

## `buzzes`
| Column | Type | Notes |
|---|---|---|
| id | uuid, pk | |
| question_id | uuid → questions | |
| team_id | uuid → teams | |
| buzzed_at | timestamptz | Server-generated; used for queue ordering |
| response | text, nullable | Typed answer from responding team |
| response_submitted_at | timestamp, nullable | |
| status | enum | `pending`, `correct`, `wrong`, `expired`, `skipped` |

## `wagers` (Final Jeopardy only)
| Column | Type | Notes |
|---|---|---|
| id | uuid, pk | |
| team_id | uuid → teams | |
| room_id | uuid → rooms | |
| amount | integer | Validated to be 0–current score |
| response | text, nullable | FJ written response |
| status | enum | `pending`, `correct`, `wrong` |
| submitted_at | timestamp, nullable | Set on lock-in or timer expiry |
