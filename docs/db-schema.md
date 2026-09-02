# Database Schema

## `rooms`
| Column | Type | Notes |
|---|---|---|
| id | uuid, pk | Primary key — also used as broadcast channel ID |
| code | varchar(6), unique | Internal artifact; generated on create but never shown to users |
| host_id | uuid | Host session reference |
| status | enum | `lobby`, `round_1`, `round_2`, `round_3`, `final_jeopardy`, `finished` (`round_3` added by `supabase/add_round_three_1_enum.sql`) |
| current_question_id | uuid, nullable | Set when a question is active |
| buzz_opened_at | timestamptz, nullable | Shared server-clock start of the active 25s buzzer window |
| current_turn_team_id | uuid, nullable | Team currently allowed to select a clue |
| pending_question_id | uuid, nullable | Atomic first-tap-wins clue claim during preview |
| pending_selection_team_id | uuid, nullable | Team that owns the pending clue claim |
| pending_selection_session_id | text, nullable | Player device that won the claim (used for Double Tap wagering) |
| pending_selection_claimed_at | timestamptz, nullable | Server time of the accepted claim |
| pending_selection_wager | integer, nullable | Double Tap wager after the winning device confirms it |
| final_phase | text, nullable | Persisted Final Tap state: `starting`, `wager`, `question`, `review`, or `done` |
| final_question_id | uuid, nullable | Final clue exposed only when the host reveals it |
| final_response_deadline_at | timestamptz, nullable | Database-generated end of the shared 90s Final response window |
| final_review_team_id | uuid, nullable | Team whose response is currently on the host/projector review screen |
| created_at | timestamp | Used to identify today's room |

**One active room at a time.** When the host creates a new room, all other rooms are immediately set to `finished`. Players and projector auto-resolve to the most recent non-finished room created today.

## `teams`
| Column | Type | Notes |
|---|---|---|
| id | uuid, pk | |
| room_id | uuid → rooms | |
| name | varchar | Display name |
| score | integer | Default 0; can go negative |
| is_active | boolean | True throughout Rounds 1–3. False only for teams eliminated at the Round 3 → Final Tap transition (score 0 or below) |
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
| round | integer | 1, 2, 3 = regular boards. Final Tap is stored as **4** by current imports; rooms imported before Round 3 existed stored it as 3. Identify Final Tap by its null-value question (`src/lib/finalTap.ts`), never by round alone |
| description | text, nullable | Host-read intro text for the round-start category reveal (host-only display). Added by `supabase/add_category_descriptions.sql` |
| position | integer, nullable | Index within the round from the imported JSON — drives board left-to-right order and the reveal sequence. Null sorts alphabetically (pre-existing content). Added by `supabase/add_category_position.sql` |

## `questions`
| Column | Type | Notes |
|---|---|---|
| id | uuid, pk | |
| category_id | uuid → categories | No direct room_id — filter via category_id |
| answer | text | Displayed clue (Jeopardy-style: the answer is shown, teams give the question) |
| correct_question | text | Expected response — host-only, not in `questions_public` view |
| point_value | integer, nullable | Board value as imported (typically 100–500 / 200–1000 / 300–1500 for rounds 1 / 2 / 3). **Null only for the Final Tap clue** — this is how Final Tap is identified |
| is_answered | boolean | Default false |
| is_double_tap | boolean | Two per regular round, set at import |
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
| response_deadline_at | timestamptz | Immutable server deadline: buzz time + 15s, or +40s for Double Tap |
| status | enum | `pending`, `correct`, `wrong`, `expired`, `skipped` |

`buzzes_one_per_team_question` allows only one buzz per team/question. Host Correct/Wrong
judgments use the authenticated `judge_buzz` database function so buzz status, score, and
question completion commit together and duplicate host taps cannot score twice.
`judge_buzz`, `claim_question_selection`, and `confirm_question_selection` accept
`round_1`, `round_2`, and `round_3`; selection maps each status to categories of that round
via `public.regular_round_number(status)` and only to clues with a non-null `point_value`.
Double Tap wagers are bounded by `greatest(score, public.double_tap_floor(round))`
(500 / 2000 / 3000). Both helper functions are defined in `supabase/add_round_three_2_game_logic.sql`
(and, for fresh installs, `supabase/atomic_question_selection.sql`) and mirror
`src/lib/rounds.ts`.

## Round 3 migration (two files, two separate runs)

Apply **before** deploying a frontend that emits `round_3`; apply and roll back only
between games. PostgreSQL will not let a transaction use an enum value it just added
(`ERROR 55P04: unsafe use of new value "round_3"`), and the Supabase SQL editor runs each
submission as one transaction — so the migration is split and each file is submitted on
its own, in order. Both are idempotent.

1. `supabase/add_round_three_1_enum.sql` — only
   `alter type public.room_status add value if not exists 'round_3'`. Run it alone and wait
   for it to succeed.
2. `supabase/add_round_three_2_game_logic.sql` — `begin … commit` around the shared helpers
   `regular_round_number` / `double_tap_floor`, round-aware `claim_question_selection` /
   `confirm_question_selection` / `judge_buzz`, the team-insert policy extended to `round_3`
   (still not `final_jeopardy`), and `reveal_final_question` verifying the Final clue by room
   ownership + null `point_value`.

Verification queries are listed at the bottom of each file. Fresh installs: run the canonical
files as before, then both Round 3 files in order (step 2 re-creates every round-aware
definition).
The `buzz_response_deadline_guard` trigger creates the response deadline, replaces phone-supplied
submission timestamps with database time, and rejects blank, duplicate, or late responses.

Team creation (`players create teams before final` policy) is allowed in `lobby`,
`round_1`, `round_2`, and `round_3`, and refused in `final_jeopardy` — late arrivals can
still form a team during Round 3, but eligibility is fixed at the Final Tap transition.

## `wagers` (Final Jeopardy only)
| Column | Type | Notes |
|---|---|---|
| id | uuid, pk | |
| team_id | uuid → teams | |
| room_id | uuid → rooms | |
| amount | integer | Validated to be 0–current score |
| response | text, nullable | FJ written response, maximum 500 characters |
| status | enum | `pending`, `correct`, `wrong` |
| submitted_at | timestamp, nullable | Set by the database when the first team response is accepted |

Player responses use `submit_final_response`. The function verifies the phone's player session,
active team, room phase, and immutable Final deadline before locking the first response with a
database timestamp. Duplicate teammate submissions return the already-saved response without
overwriting it, and anonymous clients cannot update wager rows directly.

Final judgments use the authenticated `judge_final_wager` database function. It reads the locked
wager amount from the database and commits wager status and score together. Repeating the same
judgment is a safe no-op; a conflicting judgment is rejected.

The authenticated `finish_game` function rejects completion while an active team's submitted
wager is still pending, clears transient room fields, and returns authoritative final scores.
Calling it again after a lost response is safe.
