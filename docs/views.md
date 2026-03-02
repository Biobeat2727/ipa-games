# Screen States by View

## `/play` — Player View

| Phase | Screen |
|---|---|
| `checking` | Spinner: "Finding game…" |
| `no_lobby` | "Tapped In!" + "Waiting for host to open a lobby…" (auto-polls every 3s) |
| `join_lobby` | Lobby card with open time + **Join Lobby** button |
| `select_team` | Nickname input, team list (join existing), create new team form |
| `lobby` | Joined team name, teammate list, "Waiting for host to start…" |
| `game` | All in-game states below |

### In-game player states
1. **Board** — category grid (view only unless your turn)
2. **Your pick** — category grid is interactive; select a question
3. **Question preview** — category name + point value + 10s countdown
4. **Question active** — clue visible + red **Buzz** button (full-width)
5. **Buzzed in** — "You buzzed! Waiting your turn…"
6. **Your turn** — text input + countdown timer
7. **Response submitted** — "Waiting for host…"
8. **Correct** — green feedback + score animation
9. **Wrong** — red feedback
10. **Final Jeopardy: wager** — input + submit (active teams only)
11. **Final Jeopardy: wager locked** — "Wager locked, waiting for others…"
12. **Final Jeopardy: question** — clue + 90s timer + response input
13. **Final Jeopardy: reviewing** — "Response submitted, awaiting results…"
14. **Eliminated** — "Thanks for playing!" + leaderboard (non-top-3)
15. **Game over** — final leaderboard + winner

---

## `/host` — Host View

| Phase | Screen |
|---|---|
| `checking` | Spinner: "Checking for active room…" |
| `no_room` | "Tapped In!" + **Create Lobby** button |
| `creating` | Spinner: "Setting up room…" |
| `lobby` | Team list + player counts + content import + **Start Game** |
| `game` | Full game control panel (Game.tsx) |
| `error` | Error message + retry |

### Lobby screen
- Header: "Tapped In! — Host" + "Players join at tappedin.lol"
- Content section: imported content summary (R1/R2 category counts, FJ status) + Import/Replace JSON
- Teams section: live list with player counts per team + ✕ delete button
- Start Game button (disabled until ≥ 2 teams and content loaded)
- **New Game** button: broadcasts `lobby_closed`, marks room finished, returns to `no_room`

### Game screen (persistent layout)
- Left panel: scoreboard, question grid (by category)
- Right panel: active question area, buzz queue, judging controls
- Manual score adjust available per team
- **New Game** button in scoreboard header: kicks all clients, marks all rooms finished, reloads

---

## `/projector` — Display View (read-only)

| Phase | Screen |
|---|---|
| `checking` | Spinner: "Connecting…" |
| `waiting` | "Tapped In!" + "Waiting for host to create a lobby…" (polls every 3s) |
| `connected` | All game screens below |

### Connected screens (driven by `room.status`)
1. **Lobby** — QR code linking to `window.location.origin`, join URL text, live team list as teams join
2. **Question preview** — category name + point value + 10s countdown (large)
3. **Category grid** — full Jeopardy board, greyed cells for answered questions, score bar, whose turn
4. **Active question** — clue text (large), buzz queue or responding team name + countdown timer
5. **Correct feedback** — full-screen green flash with team name
6. **Final Jeopardy: wager** — category name, team wager status (wagering / ready)
7. **Final Jeopardy: question** — clue + 90s countdown timer + score strip
8. **Final Jeopardy: reveal** — team name, response, result (+/−wager), score strip
9. **Game over** — winner name + score + full ranked leaderboard

---

## Host Controls (during game)
- Correct / Wrong judgment buttons per buzz
- Manual score adjust (edit field per team)
- Give turn to specific team
- Skip to next round / advance to Final Jeopardy
- New Game (resets everything, kicks all clients)
