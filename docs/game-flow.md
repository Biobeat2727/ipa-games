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

**Session resume:** If `teamId` is stored in localStorage, the app first verifies that this
browser's player session still belongs to that team and that the team's room is an unfinished room
from today. Valid sessions resume directly into `lobby` or `game`; stale sessions are cleared before
the app discovers today's current lobby.

**Kick (everyone):** When host broadcasts `lobby_closed` or room status changes to `finished`, players in `join_lobby`, `select_team`, or `lobby` phases are cleared and sent to `no_lobby`. Game-phase players receive the broadcast too and are sent to `no_lobby`.

**Kick (one team):** The host can remove a single team at any point before the Final Tap
question is revealed (lobby ✕ or scoreboard ✕, both confirm first). `kick_team` deletes the
team plus its players, buzzes and wagers, detaches it from any clue it answered and from the
room's turn/review pointers, all in one transaction, then the host broadcasts `team_kicked`.
Phones on that team clear their saved session and land on the Team-or-Solo screen with a
"host removed your team" notice — the room is kept so they can join again (a wrong-team join
is the usual reason). A phone that refreshes instead of receiving the broadcast reaches the
same place through session resume (team row gone → session cleared → auto-discover). Kicks are
refused while a clue is live or pending, during the Final Tap question/review (judge or skip
the team there instead), and once the game is over.

---

## Lobby Phase
- Teams join and choose names in real-time
- Host sees team list + player counts; can remove teams (see "Kick (one team)" above)
- Host imports content (JSON) — rounds 1, 2, and 3 must all be present and non-empty
  (`docs/content-format.md`); a bad file is rejected before existing content is touched
- Start Game requires ≥ 2 teams and content with every regular round populated
  (button reads `Content is missing Round N` otherwise). A missing Final Tap does not block.
- Host sends `game_state_change { status: 'round_1' }` broadcast on start

---

## Game shape

```
lobby → round_1 → (intermission) → round_2 → (intermission) → round_3 → (intermission) → final_jeopardy → finished
```

All round knowledge — statuses, labels, splash text, intermission copy, next-phase
calculation, Double Tap floors — comes from `src/lib/rounds.ts` (`REGULAR_ROUNDS`,
`statusToRound`, `nextStatusAfter`, `doubleTapMaxWager`, …). The database mirrors it in
`supabase/add_round_three_2_game_logic.sql`.

## Round Phase (Rounds 1, 2 & 3)
- **Optional category intros first**: when the round's categories have `description`
  text, the host's right panel auto-opens a step-through intro at round start —
  each click broadcasts `category_reveal` and pops the next category name onto the
  boards (phones + projector show hidden "?" tap handles until revealed; tile taps
  and the host question list are gated meanwhile; Skip available). Descriptions are
  host-only. Broadcast-only state: refreshed clients default to a fully revealed
  board and re-sync from the host's 5s re-broadcast; a question preview/activation
  always clears it.
- Category grid visible on projector + all player screens
- One team has the "pick" — selects a category + point value
- The first valid teammate tap atomically claims `rooms.pending_question_id`; later taps adopt that clue
- The accepted selection triggers `question_preview` broadcast (10s countdown)
- The host can undo the pending pick before opening the buzzer
- After 10s: question is activated (`rooms.current_question_id` updated + `question_activated` broadcast)
- Buzz button goes live on all player screens simultaneously
- Buzzes stored with server timestamp → host sees chronological queue
- First team in queue: the buzz row receives an immutable server deadline (15s regular,
  40s Double Tap); `timer_start` displays that shared window on every teammate's phone
- Reconnects restore the same database deadline and late/duplicate submissions are rejected
- Host judges: **Correct** or **Wrong**
  - The judgment is one authenticated database transaction; a retry is idempotent and
    conflicting/double judgments are rejected
  - **Correct:** score added, question marked `is_answered`, turn passes to winning team
  - **Wrong:** buzz marked wrong, next in queue gets fresh timer
- All buzzes exhausted or timer expires → no points, question marked answered, turn passes
- Double Tap wagers: 5 … max(team score, round floor); floors 1000 / 2000 / 3000 for
  rounds 1 / 2 / 3, enforced identically on phones, host, and in the database
- Round ends when all questions answered, or the host clicks
  **End Round N early → …** on the empty right panel (two-step: it only opens the
  same "Round N Ended Early" panel the natural finish would; nothing changes until
  the host confirms with **Show Scores & Start …**)
- Late arrivals can still create a team during any regular round (including Round 3)

---

## Round N → Round N+1 Transition (1 → 2, 2 → 3)
1. Round complete (or ended early) → host panel "Ready for Round N+1?" with a first-pick
   team list → **Show Scores & Start Round N+1** broadcasts `round_intermission` (score map
   on every screen; phones say "Round N+1 is coming …")
2. **Begin Round N+1** (`beginNextRound` in `src/routes/host/Game.tsx`, one implementation
   for both transitions):
   - `UPDATE rooms SET status = <next> … WHERE id = … AND status = <current>` — the status
     precondition plus an in-flight guard means a double-tapped button can never move the
     room two rounds
   - Nothing local changes and nothing is broadcast until the update succeeds; a DB error
     is shown under the button and the intermission stays up
   - On success: intermission cleared, `game_state_change { status: 'round_N+1' }`
     broadcast, first-pick `turn_change`
3. Phones and projector show the `ROUND N+1` splash, wipe question / Double Tap /
   category-reveal / intermission state, and load that round's board
4. `is_active` is untouched — nobody is eliminated between regular rounds

---

## Round 3 → Final Jeopardy Transition
- Only after the **last** regular round (`isLastRegularRound` in `src/lib/rounds.ts`).
  The host panel reads "Ready for Final Tap?" and lists Advancing / Eliminated
- Host broadcasts `game_state_change { status: 'final_jeopardy', active_team_ids: [...] }`
- Every team with a score above 0: `is_active = true`; teams at 0 or below: `is_active = false`
  (fallback: if no team is positive, the top 3 advance so the game still gets a finale)
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
   - Ranks teams by score; every team above 0 remains `is_active = true`, the rest set
     `is_active = false` (see `fjAdvancing()` in `src/routes/host/Game.tsx` — falls back to
     the top 3 only when nobody is positive)
   - Loads the Final Tap category + clue via `findFinalTapCategory(roomId, 'host')`
     (`src/lib/finalTap.ts`): the category owning the room's null-`point_value` question,
     preferring storage round 4 (current imports) over round 3 (historical rooms). It is
     never "the round 3 category" — round 3 is now a playable board
   - Sets `rooms.status = 'final_jeopardy'`
   - Broadcasts `game_state_change { status: 'final_jeopardy', fj_category, active_team_ids }`
   - Host enters `starting` phase
2. Players receive broadcast → reset all FJ local state → enter `incoming` phase (shows category)
3. Host clicks "Open Wagering" → persists `rooms.final_phase = 'wager'`, then broadcasts
   `fj_wager_open { active_team_ids }`
4. Active players enter `wager` phase; eliminated players enter `done`
5. Players submit wager → wager row created in DB → player enters `wager_locked`
6. Host clicks "Reveal Question" → `reveal_final_question` atomically persists the question
   and a database-generated 90-second deadline, then the host broadcasts
   `fj_question_revealed { question_id, response_deadline_at, duration: 90 }`
7. Players see question + 90s response timer
8. Players submit response → `submit_final_response` verifies the player session, active team,
   Final phase, and database deadline, then locks the team's first response
9. Timer ends (or auto-ends when all teams have responses) → host broadcasts `fj_timer_expired`
   - If all responses already in DB, skip the 1500ms wait
   - Phones attempt to lock their current text just before the deadline; the expiry broadcast is
     an idempotent fallback and cannot create a late response
   - Host builds reveal order (ascending by score), persists `final_phase = 'review'` and
     `final_review_team_id`, then enters `review`
10. Host reviews each response, clicks Correct/Wrong → `judge_final_wager` commits wager
    status and score atomically → `fj_answer_judged` broadcast
    - Controls lock while saving; same-result retries are safe and cannot score twice
11. After the last team is reviewed, `finish_game` atomically marks the room finished and
    returns authoritative scores → host enters `done` → `game_over` broadcast
    - A failed completion stays on review with **Retry Finish**; retries are idempotent
    - Host refresh after the last judgment detects that no wagers remain and completes safely
    - Players that miss `game_over` recover the final scores from the persisted `finished` room

### Refresh recovery
- Host, player, and projector rebuild Final Tap from the four persisted room fields.
- Public clients recover the Final Tap category *name* with
  `findFinalTapCategory(roomId, 'public')`, which reads only ids/point values through
  `questions_public`; the clue text is never queried before `final_phase = 'question'`.
- `reveal_final_question` accepts only a question that belongs to the room and has a null
  `point_value`, so a Round 3 clue can never be revealed as the Final.
- Every timer compares the immutable database deadline with `serverNow()`; refreshes cannot
  restart or extend the response window.
- `submit_final_response` compares arrival time with the database deadline, so a slow or altered
  phone clock cannot extend the response window.
- During review, `final_review_team_id` lets a refreshed projector restore the exact answer card.

### Auto-end behavior
- Host watches `fjWagers` (via postgres_changes on `wagers` table)
- When every active team has a non-null `response`, `fjTimerExpired` is set to trigger review
- Guard ref `fjExpiryInProgress` prevents double-invocation during the async transition
