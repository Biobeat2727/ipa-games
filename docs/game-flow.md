# Game State Flow

## Lobby
- Room created with 6-char code
- Teams join, add members (real-time updates)
- Host hits "Start Game" → status = `round_1`

## Round Phase (Rounds 1 & 2 — all teams play both)
- Category grid on projector + all player screens
- Designated team has "choose category" state; others see waiting
- Team selects category + point value → question activated
- Answer appears on projector + all phones simultaneously
- Buzz button goes live on all devices at same moment
- Buzzes recorded with server timestamp → queue populates on host screen chronologically
- First team in queue: text input with countdown timer
- Host judges: Correct or Wrong
  - **Correct:** points awarded, question marked answered, turn → winning team
  - **Wrong:** buzz marked wrong, next team in queue gets fresh timer
- All buzzes exhausted or timer expires: no winner, no points, turn passes
- Round ends when all questions answered or host manually advances

## Round 2 → Final Jeopardy Transition
- Scores totaled across both rounds
- Top 3 teams: `is_active = true`; all others: `is_active = false`
- Eliminated teams see "thanks for playing" + leaderboard
- All modes show transition/leaderboard screen
- Host advances when ready

## Final Jeopardy (Top 3 only)
1. Single answer revealed on projector + active team phones
2. Teams submit wager → locks in → "wager locked, waiting" message
3. All three wagers locked → answer revealed simultaneously
4. 60-second timer for response
5. All responses lock at timer end regardless
6. Host reviews each privately, marks correct/wrong
   - Correct: wager added to score
   - Wrong: wager subtracted from score
7. Winner screen on all devices
