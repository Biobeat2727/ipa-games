# Trivia Night App — Full Technical Reference

---

## Overview

A real-time, Jeopardy-style trivia game built as a Progressive Web App (PWA). Players join via QR code on their phones, no app store required. Three modes: Host, Player/Team, and Projector. All devices stay in sync via Supabase Realtime.

---

## Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Frontend | React + Vite | Fast builds, great ecosystem |
| Styling | Tailwind CSS | Rapid UI, easy responsive design |
| Realtime | Supabase Realtime | No custom WebSocket server needed |
| Database | Supabase Postgres | Game state persistence |
| Hosting | Vercel | Free tier, instant deploys |
| Distribution | PWA | No app store, QR code join |
| Content | JSON import | Simple, host-controlled |

---

## Database Schema

### `rooms`
| Column | Type | Notes |
|---|---|---|
| id | uuid, primary key | |
| code | varchar(6), unique | Join code for teams |
| host_id | uuid | References the host session |
| status | enum | lobby, round_1, round_2, final_jeopardy, finished |
| current_question_id | uuid, nullable | |
| created_at | timestamp | |

### `teams`
| Column | Type | Notes |
|---|---|---|
| id | uuid, primary key | |
| room_id | uuid | References rooms |
| name | varchar | Team display name |
| score | integer | Default 0 |
| is_active | boolean | Set to false only at Round 2 → Final Jeopardy transition for teams outside top 3 |
| created_at | timestamp | |

### `players`
| Column | Type | Notes |
|---|---|---|
| id | uuid, primary key | |
| team_id | uuid | References teams |
| nickname | varchar, nullable | Optional individual name |
| session_id | varchar | Browser session identifier, no login required |
| created_at | timestamp | |

### `categories`
| Column | Type | Notes |
|---|---|---|
| id | uuid, primary key | |
| room_id | uuid | References rooms |
| name | varchar | |
| round | integer | 1 or 2; use 3 for Final Jeopardy |

### `questions`
| Column | Type | Notes |
|---|---|---|
| id | uuid, primary key | |
| category_id | uuid | References categories |
| answer | text | What gets displayed to players (Jeopardy style) |
| correct_question | text | Expected response — visible to host only |
| point_value | integer | 100, 200, 300, 400, 500 |
| is_answered | boolean | Default false |
| answered_by_team_id | uuid, nullable | |

### `buzzes`
| Column | Type | Notes |
|---|---|---|
| id | uuid, primary key | |
| question_id | uuid | References questions |
| team_id | uuid | References teams |
| buzzed_at | timestamp with timezone | Server-generated, not client |
| response | text, nullable | What the team typed in |
| response_submitted_at | timestamp, nullable | |
| status | enum | pending, correct, wrong, expired, skipped |

### `wagers` (Final Jeopardy only)
| Column | Type | Notes |
|---|---|---|
| id | uuid, primary key | |
| team_id | uuid | References teams |
| room_id | uuid | References rooms |
| amount | integer | |
| response | text, nullable | |
| status | enum | pending, correct, wrong |
| submitted_at | timestamp, nullable | |

---

## Game State Flow

### Lobby Phase
- Room is created, 6-character code is generated
- Teams join and add members
- Host sees team list populating in real time
- Host hits "Start Game" when ready → status changes to `round_1`

### Round Phase (Rounds 1 and 2 — all teams play both rounds)
- Category grid appears on projector and all player screens
- The designated team has an active "choose a category" state; all others see a waiting state
- Choosing team selects a category and point value
- Question state changes to active; answer appears on projector and all phones simultaneously
- Buzz button goes live on all team devices at the same moment
- Teams buzz in; buzzes recorded with server timestamp
- Buzz queue populates on host screen in chronological order
- First team in queue enters their response within the timer window
- Host sees their response and clicks Correct or Wrong
  - **Correct:** points awarded, question marked answered, turn passes to winning team
  - **Wrong:** that buzz marked wrong, next team in queue gets a fresh timer
- If all buzzes exhausted or timer expires with no response: question marked as no winner, no points change, turn passes
- Once all questions in a category are answered, category is greyed out
- Round ends when all questions are answered, or host manually advances

### Round 2 → Final Jeopardy Transition
- Scores totaled across both rounds
- Top 3 teams flagged as `is_active = true`; all other teams set to `is_active = false`
- Eliminated teams see a "thanks for playing" screen with the full leaderboard
- All three modes show a transition/leaderboard screen
- Host advances when ready

### Final Jeopardy (Top 3 teams only)
- Single answer revealed on projector and all active team phones
- Teams submit wager first → wager locks in → team sees "wager locked, waiting for others"
- Once all three teams have locked wagers, the answer is revealed simultaneously
- 60-second timer for teams to type their response
- All responses lock in at timer end regardless of submission
- Host reviews each team's response privately
- Host marks each correct or wrong
  - Correct: wager added to score
  - Wrong: wager subtracted from score
- Winner screen displays on all devices

---

## Real-Time Architecture

### Channel Structure
One channel per room: `room:{room_code}`

Every client subscribes on join. Broadcast event types:

| Event | Payload | Effect |
|---|---|---|
| `game_state_change` | status | All clients transition screens |
| `question_activated` | question_id | Answer appears on all devices |
| `buzz_received` | team_id, queue_position | Updates buzz queue on all screens |
| `timer_start` | start_timestamp, duration_seconds | Syncs countdown across all devices |
| `timer_expired` | team_id | Locks out responding team |
| `score_update` | full scores object | Updates all scoreboards |
| `turn_change` | team_id | Assigns category selection rights |
| `final_wager_locked` | team_id | Shows wager status to others |
| `game_over` | final scores | Triggers winner screen |

Also use Supabase Postgres row-level subscriptions on the `buzzes` table so the host queue auto-reorders as new buzzes arrive.

### Timer Logic (Critical)
The timer must start on the server, not the client. When a question goes active and the first buzz comes in, the host clicks to open that team's response window. A `timer_start` event is broadcast with a server timestamp and duration. Every client calculates remaining time as:

```
remaining = (start_timestamp + duration) - now
```

This keeps all devices in sync regardless of when they joined. When time expires, the server marks that buzz as expired regardless of what the client reports.

---

## Three App Modes

### /play — Player/Team View

All screen states in order:

1. Enter room code
2. Choose existing team or create new team
3. Enter nickname (optional), join team, see lobby with team member list
4. Category grid — view only unless it's your team's turn
5. Active turn: category selection interface
6. Question active: answer displayed, red buzz button prominent and full-width
7. Buzzed in, waiting: "You buzzed in — wait for your turn"
8. Your turn to respond: text input with visible countdown timer
9. Response submitted: waiting for host judgment
10. Correct/Wrong feedback with score update animation
11. Final Jeopardy: wager input → locked confirmation → answer display → response input → waiting for results
12. Game over: final leaderboard
13. Eliminated after Round 2: "Thanks for playing" screen with leaderboard

### /host — Host View

Persistent elements: room code, current round/phase, team scores sidebar

Screen states:

1. **Lobby:** team list with player counts, Start Game button
2. **Round active:** condensed category grid, whose turn it is, answered questions greyed
3. **Question active:** answer and correct_question both visible (correct_question shown to host only), buzz queue populating in real time
4. **Judging:** current team's response displayed large, Correct and Wrong buttons, next team in queue shown below
5. **Between questions:** quick score summary, advance button
6. **Transition screen:** top 3 displayed, advance to Final Jeopardy button
7. **Final Jeopardy:** wager status per team (submitted/waiting), response review, mark correct/wrong per team, advance to results
8. **Results:** final scores, winner announcement, option to start new game or end session

Additional host controls:
- Manual score adjustment (for disputes)
- Skip a question
- Extend a timer
- Pause game state (freezes all client screens)

### /projector — Display View

Read-only. Subscribes to the same real-time channel and renders game state for a large screen.

1. **Lobby:** animated waiting screen, room code displayed large, QR code linking to /play
2. **Category grid:** classic grid layout, point values greyed as answered
3. **Question active:** answer text displayed large, team name of who's responding, timer bar across top or bottom
4. **Correct/Wrong:** brief full-screen feedback animation
5. **Buzz queue:** team names appearing as they buzz in (creates excitement in the room)
6. **Leaderboard:** between rounds and optionally between questions
7. **Final Jeopardy:** wager submission status, dramatic answer reveal, countdown, results
8. **Winner screen:** celebration display

---

## Room Codes

- 6-character alphanumeric
- Exclude ambiguous characters: 0, O, 1, I, l
- Check uniqueness against active rooms before assigning
- Rooms are reusable across nights — reset status and clear questions/teams

---

## Content Structure (JSON Import Format)

```json
{
  "rounds": [
    {
      "round": 1,
      "categories": [
        {
          "name": "Category Name",
          "questions": [
            {
              "point_value": 100,
              "answer": "This is the displayed clue",
              "correct_question": "What is the expected answer"
            },
            {
              "point_value": 200,
              "answer": "This is the displayed clue",
              "correct_question": "What is the expected answer"
            },
            {
              "point_value": 300,
              "answer": "This is the displayed clue",
              "correct_question": "What is the expected answer"
            },
            {
              "point_value": 400,
              "answer": "This is the displayed clue",
              "correct_question": "What is the expected answer"
            },
            {
              "point_value": 500,
              "answer": "This is the displayed clue",
              "correct_question": "What is the expected answer"
            }
          ]
        }
      ]
    },
    {
      "round": 2,
      "categories": []
    }
  ],
  "final_jeopardy": {
    "category": "Category Name",
    "answer": "The final clue",
    "correct_question": "What is the correct response"
  }
}
```

Standard format: 5–6 categories per round, 5 point values each (25–30 questions per round). Scale up or down as needed.

---

## PWA Configuration

`manifest.json` requirements:
- `name` and `short_name`
- Icons at 192px and 512px
- `theme_color` — pick something bold
- `display: "standalone"` — removes browser chrome when launched from home screen
- `start_url: "/play"`

Add a service worker for offline caching of the app shell. This ensures slow bar WiFi doesn't break the experience after the initial page load.

---

## Networking

**Run the game off a dedicated mobile hotspot, not the bar's WiFi.** A hotspot gives you full control over the connection and eliminates the biggest reliability risk of the night.

- Print or display the hotspot SSID and password at each table
- Include it on the QR code landing page
- Supabase WebSocket connections are lightweight — 50 phones will use negligible data

---

## Suggested Build Order

1. ✅ Supabase schema setup
2. ✅ Basic room creation and team joining
3. ✅ Real-time sync verified between two browser tabs
4. ✅ Buzz mechanic with server-side timestamping
5. ✅ Host judging interface
6. ✅ Projector view
7. Full round flow end to end
8. Final Jeopardy wagering
9. PWA manifest and service worker
10. Polish, animations, and mobile UX

---

## Current Project State

### What is built and working
- Supabase schema: all tables, enums, RLS policies, server-side buzz timestamp trigger, `questions_public` view
- `/host` lobby: room auto-creates on load, resumes from localStorage, real-time team list, JSON content import, Start Game button
- `/host` game screen: question list (R1/R2) with activate/deactivate, live scores, buzz queue ordered by server timestamp, Judge button, judging panel with 30-second timer + color bar, Correct/Wrong buttons
- `/play` full flow: room code entry → team select/create → lobby waiting → game screens (buzz button, response input with countdown/color bar, stand-by with team name, correct/wrong feedback with colored backgrounds and point changes, score display)
- `/projector` full flow: code entry → lobby (room code + team list) → Jeopardy grid (correct columns/rows, greyed when answered) → active question (big text) → buzz queue → judging (team name + countdown) → correct feedback flash → finished/winner screen; score strip at bottom throughout; fully responsive with clamp() font sizes
- Real-time sync: postgres_changes subscriptions on rooms, teams, questions, buzzes; broadcast channel (`room:{code}`) for timer_start (includes team_name) and score_update events
- Session persistence: localStorage resume for both host and player across refreshes
- Turn management (partial): host auto-assigns first turn to first team at game start; turn passes to winning team after a correct answer; host can manually reassign via "give" button; all clients receive `turn_change` broadcast; turn is cleared after all buzzes exhausted
- Question selection flow: player whose turn it is picks from the board → 10-second `question_preview` countdown on all screens → question activates on all screens simultaneously; host has its own 10-second fallback activation so it never misses a question even if a broadcast is dropped
- Bug fixes: wrong answers deduct points + broadcast; judging state clears when question deactivated; content.ts validates JSON before deleting; final_jeopardy is optional in JSON; host `question_activated` handler now updates `room.current_question_id` directly (previously relied only on slow postgres_changes); all buzzes wrong → question auto-deactivates and turn is cleared

### Key files
- `src/lib/supabase.ts` — typed Supabase client
- `src/lib/types.ts` — all DB types + Database generic
- `src/lib/session.ts` — localStorage helpers (host/player identity)
- `src/lib/roomCode.ts` — 6-char code generator (excludes ambiguous chars)
- `src/lib/content.ts` — JSON import + validation (validates before deleting) + ContentSummary
- `src/routes/host/index.tsx` — host phase orchestration (creating/lobby/game/error)
- `src/routes/host/Game.tsx` — host game screen (questions, buzz queue, judging, scores)
- `src/routes/play/index.tsx` — player full flow (all phases in one file)
- `src/routes/projector/index.tsx` — full projector display (lobby/grid/question/judging/winner)
- `test-content.json` — sample content for testing (3 categories × 2 rounds + FJ)

### Supabase setup notes
- Realtime enabled for: rooms, teams, questions, buzzes, wagers (ALTER PUBLICATION supabase_realtime ADD TABLE ...)
- `questions_public` view requires: GRANT SELECT ON questions_public TO anon, authenticated
- All RLS policies are permissive (anon key, trusted host environment)

### What is NOT yet built
- Round 2 → Final Jeopardy transition (is_active flag, top-3 cutoff)
- Final Jeopardy wagering flow
- Manual score adjustment on host
- Vercel deployment

---

## Notes for Later

- **Turn persistence** — `currentTurnTeamId` lives only in broadcast state; a page refresh on the host resets it to null. Could persist in a `rooms` column if needed.
- **Round 2 → Final Jeopardy transition** — need to rank teams after R2, set is_active=false for non-top-3, show cutoff screen
- **Final Jeopardy** — wager input → lock → answer reveal → response → host judging → winner screen
- **Manual score adjustment** — host should be able to edit a team's score directly (disputes)

---

## Key Design Rules

- **Projector text must be readable at 30+ feet** with ambient bar lighting — dark background, high contrast, large fonts
- **Buzz button on player screens should be full-width and prominent** — people are drinking, make it impossible to miss
- **Timer sync is server-side** — never trust client clocks
- **Wagers must lock before the answer is revealed** — enforce this in game state, not just UI
- **is_active flag is only set to false at the Round 2 → Final Jeopardy transition** — all teams play rounds 1 and 2