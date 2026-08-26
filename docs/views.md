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
1. **Board** — category grid (view only unless your turn); tap/glass visual theme (see below)
2. **Your pick** — category grid is interactive; select a question
3. **Question preview** — category name + point value + 10s countdown
4. **Question active** — clue visible + red **Buzz** button (full-width)
5. **Buzzed in** — "You buzzed! Waiting your turn…"
6. **Your turn** — text input + countdown timer
7. **Response submitted** — "Waiting for host…"
8. **Correct** — green feedback + score animation
9. **Wrong** — red feedback
10. **Final Tap: incoming** — "Starting Soon!" + FJ category name displayed (all active players)
11. **Final Tap: wager** — wager input + submit (active teams only)
12. **Final Tap: wager locked** — "Wager locked, waiting for others…"
13. **Final Tap: question** — clue + 90s timer + response input
14. **Final Tap: reviewing** — "Response submitted, awaiting results…"
15. **Eliminated** — "Thanks for playing!" + leaderboard (non-top-3); set to `done` sub-phase
16. **Game over** — final leaderboard + winner (`fjSubPhase === 'done'`)

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
- Left panel: scoreboard, question grid (by category; each category shows its
  `description` in small grey text under the name when content has one)
- Right panel: active question area, buzz queue, judging controls
- **Category intro panel** (right panel, auto-opens at round start when the
  round's categories have descriptions): step-through list of categories with
  their read-aloud descriptions; "Reveal ‘X’ →" pops that category onto every
  board, "To the board →" / "Skip intros" finishes. The host question list is
  disabled while it's open, and a live/pending question always outranks it.
- Manual score adjust available per team
- **New Game** button in scoreboard header: kicks all clients, marks all rooms finished, reloads
- **⚡ FT** button (DEV only, `import.meta.env.DEV`): calls `startFinalJeopardy()` directly; hidden in production

### Host Final Tap screens
- **starting**: Players see waiting screen. Host sees active team list + "Open Wagering" button.
- **wager**: Per-team wager status (pulsing grey → solid green when locked). "Reveal Question" button.
- **question**: Timer + per-team response status (pulsing grey → "locked in" green). "End Timer Early" button. Auto-advances when all teams submit.
- **review**: One team at a time; shows wager amount + response text + Correct/Wrong buttons. Ordered lowest→highest score.
- **done**: Winner + ranked leaderboard + New Game button.

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
3. **Category grid** — full Jeopardy board, tap/glass visual theme (see below), score bar, whose turn. During round-start category intros, unrevealed headers render as dim "?" tap handles and each reveal pops in (`category_reveal` broadcast)
4. **Active question** — clue text (large), buzz queue or responding team name + countdown timer
5. **Correct feedback** — full-screen green flash with team name
6. **Final Jeopardy: wager** — category name, team wager status (wagering / ready)
7. **Final Jeopardy: question** — clue + 90s countdown timer + score strip
8. **Final Jeopardy: reveal** — team name, response, result (+/−wager), score strip
9. **Game over** — winner name + score + full ranked leaderboard

---

## Board Visual Theme — Tap & Glass (bar aesthetic)

The Jeopardy-style category grid (player board + projector board) is themed as a bar tap wall: each category is a tap handle, each point-value tile is a beer glass that's full (unanswered) or empty (answered).

- Component: [`src/components/TapCategoryColumn.tsx`](../src/components/TapCategoryColumn.tsx)
  - `TapHeader({ categoryName, reveal? })` — wood/brass tap handle used as the category header, replaces the old flat blue header box. `reveal: 'hidden' | 'revealing' | 'shown'` (default `'shown'`) drives the round-start category intros: `hidden` shows a dim "?" (the real name is laid out invisibly so the row height doesn't jump), `revealing` plays the one-shot `cat-reveal-pop` zoom. `tapHeaderRevealFor(revealedIds, catId)` maps the `category_reveal` broadcast state to this prop — player and projector both use it so the screens can't disagree
  - `BeerGlass({ pointValue, state, onClick, disabled, dimmed })` — SVG glass tile
    - `state: 'full' | 'draining' | 'empty'` — `full` = unanswered (shows point value + wavy foam head + rising bubble animation), `empty` = answered (drained, no click). `draining` is only used by the standalone demo page, not real game state — in real usage the CSS transition (900ms ease-in on fill height) animates `full → empty` automatically when `is_answered` flips true, no intermediate state needed.
    - `disabled` — controls click-ability independent of fill state (e.g. not your turn)
    - `dimmed` — visual desaturate/opacity when not interactive (not your turn), separate from `disabled` so empty-but-my-turn vs full-but-not-my-turn read differently
  - Also exports a default `TapCategoryColumn` (header + column of glasses) used only by the standalone design sandbox — the real board views (`play`, `projector`) import `BeerGlass`/`TapHeader` directly since they interleave categories × point values in a shared grid rather than rendering per-category columns.
- Wired into: `src/routes/play/index.tsx` (board render, ~line 1575) and `src/routes/projector/index.tsx` (category grid, ~line 854). **Not** wired into `/host` — the host's question list (`Game.tsx`) is a compact management list, not the visual board, so it kept its original styling.
- The player board's tile-selection flip-card animation (shows `$value` → category name mid-flip before the full preview overlay opens) was re-themed from blue to amber/wood gradients to match, but its timing/logic (`flippingId`, `tileRect` zoom-to-overlay) is unchanged.
- Projector's board wrapper background changed from `bg-blue-950` (old Jeopardy-blue leftover) to `bg-gray-950` to match the new palette and the rest of the projector's screens.
- Sandbox/design preview: `/preview` route → `src/routes/preview/TapPreview.tsx` — standalone page for iterating on the glass/tap visuals without needing a live game session. Not linked from any real navigation; safe to leave in place or delete later.

## Host Controls (during game)
- Correct / Wrong judgment buttons per buzz
- Manual score adjust (edit field per team)
- Give turn to specific team
- Skip to next round / advance to Final Jeopardy
- New Game (resets everything, kicks all clients)
