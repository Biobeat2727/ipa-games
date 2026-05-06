# Game State Flow

## Room Lifecycle

**One active room at a time.** The host creates a room; players auto-find it by date. No room codes are ever shown to users.

### Host creates lobby
1. Host visits `/host` → app checks for today's active room
2. If none found → shows "Create Lobby" button
3. On create: all existing non-finished rooms are marked `finished` first, then a new room is inserted with `status = 'lobby'`
4. All currently-connected players/projector receive `lobby_closed` broadcast → kicked back to "waiting" screen → will auto-discover the new room

### Host resets mid-game ("New Game")
- Broadcasts `lobby_closed` on current room channel
- Marks all rooms `finished` in DB
- Host returns to "Create Lobby" screen
- Players/projector kicked same as above

---

## Player Join Flow

```
checking → no_lobby → join_lobby → select_team → lobby → game
```

| Phase | Description |
|---|---|
| `checking` | Auto-resolves to active room on mount |
| `no_lobby` | No active room found; polls DB every 3s until one appears |
| `join_lobby` | Active room found; shows lobby card with open time + "Join Lobby" button |
| `select_team` | Team list; player picks existing team or creates new one |
| `lobby` | Joined a team; waiting for host to start |
| `game` | All in-game screens |

**Session resume:** If `teamId` is stored in localStorage, app skips to `lobby` or `game` directly. If the saved room is now `finished`, session is cleared and player starts from `checking`.

**Kick:** When host broadcasts `lobby_closed` or room status changes to `finished`, players in `join_lobby`, `select_team`, or `lobby` phases are cleared and sent to `no_lobby`. Game-phase players receive the broadcast too and are sent to `no_lobby`.

---

## Lobby Phase
- Teams join and choose names in real-time
- Host sees team list + player counts; can delete teams
- Host imports content (JSON)
- Start Game requires ≥ 2 teams and content loaded
- Host sends `game_state_change { status: 'round_1' }` broadcast on start

---

## Round Phase (Rounds 1 & 2)
- Category grid visible on projector + all player screens
- One team has the "pick" — selects a category + point value
- Selection triggers `question_preview` broadcast (10s countdown)
- After 10s: question is activated (`rooms.current_question_id` updated + `question_activated` broadcast)
- Buzz button goes live on all player screens simultaneously
- Buzzes stored with server timestamp → host sees chronological queue
- First team in queue: text input + `timer_start` broadcast (15s countdown); ALL teammates on that team see the answer box simultaneously
- Host judges: **Correct** or **Wrong**
  - **Correct:** score added, question marked `is_answered`, turn passes to winning team
  - **Wrong:** buzz marked wrong, next in queue gets fresh timer
- All buzzes exhausted or timer expires → no points, question marked answered, turn passes
- Round ends when all questions answered or host manually advances

---

## Round 2 → Final Jeopardy Transition
- Host broadcasts `game_state_change { status: 'final_jeopardy', active_team_ids: [...] }`
- Top 3 teams by score: `is_active = true`; others: `is_active = false`
- Eliminated teams see "thanks for playing" + leaderboard
- Projector + active players see FJ category name

---

## Final Jeopardy (Final Tap)

### Host sub-phases
| Phase | Description |
|---|---|
| `starting` | Players see "Starting Soon" + category name. Host shows "Open Wagering" button. |
| `wager` | Players can submit wagers. Host shows wager status per team + "Reveal Question" button. |
| `question` | Question visible. 90s timer. Host sees response submission status per team. |
| `review` | Host judges each team's response one at a time (lowest score first). |
| `done` | `game_over` broadcast sent. Winner screen shown everywhere. |

### Player sub-phases
| Phase | Description |
|---|---|
| `incoming` | "Starting Soon" screen with FJ category name shown. |
| `wager` | Wager input form. |
| `wager_locked` | "Wager locked, waiting for others…" |
| `question` | Clue + 90s timer + response input. |
| `reviewing` | "Response submitted, awaiting results…" |
| `done` | Final leaderboard + winner. |

### Flow
1. Host calls `startFinalJeopardy()`:
   - Deletes all existing wagers for the room (clean slate)
   - Ranks teams by score; top 3 remain `is_active = true`, rest set `is_active = false`
   - Loads FJ category (round 3) + question from DB
   - Sets `rooms.status = 'final_jeopardy'`
   - Broadcasts `game_state_change { status: 'final_jeopardy', fj_category, active_team_ids }`
   - Host enters `starting` phase
2. Players receive broadcast → reset all FJ local state → enter `incoming` phase (shows category)
3. Host clicks "Open Wagering" → broadcasts `fj_wager_open { active_team_ids }`
4. Active players enter `wager` phase; eliminated players enter `done`
5. Players submit wager → wager row created in DB → player enters `wager_locked`
6. Host clicks "Reveal Question" → broadcasts `fj_question_revealed { question_id, start_ts, duration: 90 }`
7. Players see question + 90s response timer
8. Players submit response → `wagers.response` updated in DB
9. Timer ends (or auto-ends when all teams have responses) → host broadcasts `fj_timer_expired`
   - If all responses already in DB, skip the 1500ms wait
   - Players auto-submit remaining responses on `fj_timer_expired`
   - Host builds reveal order (ascending by score) → enters `review` phase
10. Host reviews each response, clicks Correct/Wrong → `fj_answer_judged` broadcast
11. After last team reviewed → `finishGame()` → `game_over` broadcast with final scores

### Auto-end behavior
- Host watches `fjWagers` (via postgres_changes on `wagers` table)
- When every active team has a non-null `response`, `fjTimerExpired` is set to trigger review
- Guard ref `fjExpiryInProgress` prevents double-invocation during the async transition
