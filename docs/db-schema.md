# Database Schema

## `rooms`
| Column | Type | Notes |
|---|---|---|
| id | uuid, pk | |
| code | varchar(6), unique | Join code |
| host_id | uuid | Host session reference |
| status | enum | lobby, round_1, round_2, final_jeopardy, finished |
| current_question_id | uuid, nullable | |
| created_at | timestamp | |

## `teams`
| Column | Type | Notes |
|---|---|---|
| id | uuid, pk | |
| room_id | uuid → rooms | |
| name | varchar | Display name |
| score | integer | Default 0 |
| is_active | boolean | False only at Round 2 → Final transition for non-top-3 |
| created_at | timestamp | |

## `players`
| Column | Type | Notes |
|---|---|---|
| id | uuid, pk | |
| team_id | uuid → teams | |
| nickname | varchar, nullable | Optional |
| session_id | varchar | Browser session ID, no login |
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
| category_id | uuid → categories | |
| answer | text | Displayed clue (Jeopardy style) |
| correct_question | text | Expected response, host-only |
| point_value | integer | 100-500 |
| is_answered | boolean | Default false |
| answered_by_team_id | uuid, nullable | |

## `buzzes`
| Column | Type | Notes |
|---|---|---|
| id | uuid, pk | |
| question_id | uuid → questions | |
| team_id | uuid → teams | |
| buzzed_at | timestamptz | Server-generated |
| response | text, nullable | |
| response_submitted_at | timestamp, nullable | |
| status | enum | pending, correct, wrong, expired, skipped |

## `wagers` (Final Jeopardy only)
| Column | Type | Notes |
|---|---|---|
| id | uuid, pk | |
| team_id | uuid → teams | |
| room_id | uuid → rooms | |
| amount | integer | |
| response | text, nullable | |
| status | enum | pending, correct, wrong |
| submitted_at | timestamp, nullable | |
