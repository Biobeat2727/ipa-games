# Screen States by Mode

## /play — Player/Team View
1. Enter room code
2. Choose/create team
3. Enter nickname (optional), lobby with team list
4. Category grid (view only unless your turn)
5. Active turn: category selection
6. Question active: answer + red buzz button (full-width)
7. Buzzed in: "wait for your turn"
8. Your turn: text input + countdown timer
9. Response submitted: waiting for host
10. Correct/Wrong feedback + score animation
11. Final Jeopardy: wager → lock → answer → response → results
12. Game over: final leaderboard
13. Eliminated: "thanks for playing" + leaderboard

## /host — Host View
Persistent: room code, round/phase, team scores sidebar

1. **Lobby:** team list + player counts, Start Game button
2. **Round active:** condensed grid, whose turn, answered questions greyed
3. **Question active:** answer + correct_question visible (correct_question host-only), live buzz queue
4. **Judging:** team response large, Correct/Wrong buttons, next in queue below
5. **Between questions:** score summary, advance button
6. **Transition:** top 3, advance to Final button
7. **Final Jeopardy:** wager status, response review, mark each correct/wrong
8. **Results:** final scores, winner, new game/end options

Host controls: manual score adjust, skip question, extend timer, pause game

## /projector — Display View (read-only)
1. **Lobby:** animated wait, large room code, QR to /play
2. **Grid:** classic layout, greyed as answered
3. **Question:** large answer text, responding team name, timer bar
4. **Correct/Wrong:** full-screen feedback animation
5. **Buzz queue:** team names appearing live
6. **Leaderboard:** between rounds/questions
7. **Final Jeopardy:** wager status, dramatic reveal, countdown, results
8. **Winner:** celebration display
