# Tapped In — In-Person Beta Test Checklist

Use this document during a real beta night. It is written for the host and testers, not
developers. Do not try to run every case while guests are waiting. Complete the **Pre-Doors
Smoke Test** first, then assign the deeper cases to a few trusted players during the event.

## Test Session Record

- Date:
- Venue:
- App version/commit:
- Host device/browser:
- Projector device/browser:
- Network or hotspot used:
- Approximate player count:
- Team count:
- Test coordinator:
- Overall result: PASS / PASS WITH ISSUES / FAIL

### Result key

- `[ ]` Not tested
- `[x]` Passed
- `[!]` Failed or behaved unexpectedly
- `[~]` Partially tested

When a case fails, record its ID in the **Issue Log** at the bottom. Include the affected
device, team, approximate time, and what was on the host/projector screens.

---

# 1. Pre-Doors Smoke Test — Run Before Every Event

These are the minimum checks required before letting players join.

- [ ] **PRE-01 — Database wakes up:** Open `/host`. The host screen loads without a white
  screen, endless spinner, or database error.
- [ ] **PRE-02 — Create or resume lobby:** If no lobby exists, create one. If today's lobby
  already exists, confirm the host resumes it instead of creating a duplicate.
- [ ] **PRE-03 — Player discovers lobby:** Open `/play` on a separate phone. The current
  lobby appears without entering a room code.
- [ ] **PRE-04 — Projector discovers lobby:** Open `/projector`. It shows the same lobby and
  join information as the host.
- [ ] **PRE-05 — Content loads:** Import tonight's trivia file. The host shows the expected
  Round 1, Round 2, and Final Tap content with no import errors.
- [ ] **PRE-06 — Two-team requirement:** Join or create at least two temporary teams. The
  Start Game button becomes available only after content and two teams are present.
- [ ] **PRE-07 — One complete clue:** Start the game, pick one normal clue, wait for the
  preview, open the buzzer, buzz from a phone, submit an answer, and judge it Correct.
  Score, board, player, host, and projector must all agree.
- [ ] **PRE-08 — Wrong-answer handoff:** On another clue, have two teams buzz. Judge the
  first Wrong. The second team gets a fresh answer timer and input.
- [ ] **PRE-09 — Host Undo Pick:** Select a clue and press Undo Pick before opening the
  buzzer. Every screen returns to the board and the clue remains available.
- [ ] **PRE-10 — Sound and projector readability:** Confirm the host can hear the room,
  question text is readable from the farthest seat, and no browser controls cover the game.
- [ ] **PRE-11 — Clean start:** After the smoke test, use New Game, create the real lobby,
  and confirm the test teams, scores, and answered clues are gone.
- [ ] **PRE-12 — Network capacity:** Confirm the dedicated hotspot or chosen network is
  connected to the host, projector, and both test phones before doors open.

**Stop and fix before opening doors if PRE-01 through PRE-09 do not pass.**

---

# 2. Lobby, Joining, and Teams

- [ ] **LOB-01 — No-lobby waiting:** With no active lobby, `/play` says it is waiting for
  the host and automatically discovers a lobby created afterward.
- [ ] **LOB-02 — Projector waiting:** With no active lobby, `/projector` waits and
  automatically changes to the lobby screen after the host creates one.
- [ ] **LOB-03 — QR/join URL:** Scan the projector QR code from a phone. It opens the correct
  player page and finds the current lobby.
- [ ] **LOB-04 — Nickname required:** A player cannot continue with a blank nickname.
- [ ] **LOB-05 — Create team:** A player can create a new team, sees the correct team name,
  and appears on the host and projector.
- [ ] **LOB-06 — Join existing team:** A second phone can join the same team. Both names
  appear on the team, and the host player count increases by one.
- [ ] **LOB-07 — Multiple teams at once:** Several players create/join teams at nearly the
  same time. No team disappears, duplicates unexpectedly, or gains the wrong player.
- [ ] **LOB-08 — Team count after leaving:** Press Leave Team on a joined phone. The host
  count drops by one promptly, the departing nickname disappears from teammates' phones, and
  the player returns to team selection.
- [ ] **LOB-09 — Delete team:** Host deletes a temporary team. It disappears from host and
  projector, and affected players are returned to a sensible join/waiting screen.
- [ ] **LOB-10 — Cannot start too early:** Start Game remains disabled with missing content
  or fewer than two teams.
- [ ] **LOB-11 — Start synchronization:** When the host starts, all phones and the projector
  enter Round 1 within a reasonable moment and show the same board.
- [ ] **LOB-12 — Player refresh in lobby:** Refresh a joined player's phone. It resumes the
  same team instead of asking the player to join again.
- [ ] **LOB-13 — Host refresh in lobby:** Refresh `/host`. It resumes today's lobby with the
  correct teams and imported content.
- [ ] **LOB-14 — Old session cleanup:** After the old game is finished and a new lobby is
  created, a previously joined phone discovers the new lobby instead of reopening the old game.
- [ ] **LOB-15 — Switch teams:** Leave one team and join another. The old team's count drops,
  the new team's count rises, and the total number of players stays unchanged.
- [ ] **LOB-16 — Rapid leave and rejoin:** Leave and immediately rejoin a team. After three
  seconds, the host shows exactly one player for that phone—not zero or two.
- [ ] **LOB-17 — Leave while offline:** Disconnect a joined phone, press Leave Team, and
  confirm it stays on the team with a retry message. Reconnect, retry, and confirm the host
  count then drops without requiring a host refresh.

---

# 3. Turn Ownership and Clue Selection

Use at least two phones on the team whose turn it is.

- [ ] **SEL-01 — Only current team can pick:** Phones on other teams see the board but
  cannot select an available clue.
- [ ] **SEL-02 — Current team can pick:** A current-team phone selects an unanswered clue.
  All screens show the same category, value, and preview countdown.
- [ ] **SEL-03 — Atomic first tap wins:** Two teammates tap two different clues as close to
  simultaneously as possible. Only one clue is selected everywhere. The other phone gets a
  clear “already selected” message and adopts the winning clue.
- [ ] **SEL-04 — Same clue simultaneous tap:** Two teammates tap the same clue at once.
  There is one preview and one question activation—not duplicates or restarted countdowns.
- [ ] **SEL-05 — Repeated rapid taps:** Rapidly tap a clue several times on one phone. Only
  one selection is recorded and the animation does not stack or freeze.
- [ ] **SEL-06 — Board locks during selection:** Once a pick is being claimed, no teammate
  can open another clue while the first pick is processing.
- [ ] **SEL-07 — Undo Pick:** Host presses Undo Pick during a normal preview. Player and
  projector return to the board, and the same clue can be selected again.
- [ ] **SEL-08 — Undo then different pick:** After Undo Pick, select a different clue. The
  new clue previews normally with no content from the undone clue left on any screen.
- [ ] **SEL-09 — Reassign turn during preview:** Host gives the turn to another team while a
  pick is pending. The preview clears, and only the newly assigned team can pick.
- [ ] **SEL-10 — Host refresh during preview:** Refresh the host during the 10-second
  preview. It restores the same pending clue and provides Undo Pick rather than losing state.
- [ ] **SEL-11 — Player refresh during preview:** Refresh the selecting phone and a teammate.
  Both recover the same pending clue instead of reopening the whole board for another pick.
- [ ] **SEL-12 — Projector refresh during preview:** Refresh the projector. It recovers the
  current game without showing a conflicting clue or stale preview.
- [ ] **SEL-13 — Answered clue locked:** After a clue is completed, no player can select it
  again, and its glass appears empty/answered on player and projector boards.
- [ ] **SEL-14 — Turn persists after host refresh:** Refresh the host while the board is
  idle. The correct team remains highlighted and is still the only team able to pick.

## Double Tap selection

- [ ] **DT-01 — Double Tap owner:** Select a Double Tap clue. Only the phone that won the
  atomic selection receives the wager form; teammates see a waiting state.
- [ ] **DT-02 — Double Tap simultaneous picks:** Two teammates tap different clues and one
  is a Double Tap. Only the winning selection proceeds; there is never both a regular preview
  and a wager screen.
- [ ] **DT-03 — Wager validation:** Try below-minimum, above-maximum, blank, and non-number
  wagers. Invalid wagers cannot be submitted and the allowed range is understandable.
- [ ] **DT-04 — Wager accepted:** Submit a valid wager. Host, selecting team, teammates, and
  projector proceed to the same clue with the correct wager behavior.
- [ ] **DT-05 — Undo before wager:** Host presses Undo Pick while the wager is pending. The
  wager form closes everywhere, the board returns, and the clue remains selectable.
- [ ] **DT-06 — Selecting phone refresh:** Refresh the selecting phone before submitting its
  wager. It recovers the wager screen and keeps ownership.
- [ ] **DT-07 — Teammate refresh:** Refresh a non-selecting teammate during wagering. It does
  not gain the wager form or submit on behalf of the winning phone.
- [ ] **DT-08 — Stale wager rejected:** Undo the pick, then try submitting from a phone that
  still had an old wager screen. The old wager must not reactivate the undone clue.

---

# 4. Preview, Question Reveal, and Buzzer

- [ ] **BUZ-01 — Preview countdown:** Player, host, and projector show the same pending clue
  and a smooth approximately 10-second preview.
- [ ] **BUZ-02 — Simultaneous buzzer reveal:** Watch at least five phones when the host opens
  the buzzer. The Buzz button appears at effectively the same time on all of them.
- [ ] **BUZ-03 — Buzzer is obvious:** The Buzz button is full-width, readable, and easy to
  hit one-handed on both small and large phones.
- [ ] **BUZ-04 — One tap registers:** A normal tap gives immediate visual, sound, and/or
  vibration feedback and appears in the host queue.
- [ ] **BUZ-05 — Failed buzz feedback:** Briefly disconnect one phone immediately before it
  buzzes. It must not falsely claim success; it should show that the buzz did not register
  and allow another attempt after reconnecting.
- [ ] **BUZ-06 — Server ordering:** Have several teams buzz almost together. The host queue
  is stable and all observers agree on the order.
- [ ] **BUZ-07 — Same-team double buzz:** Two teammates buzz simultaneously. Their team
  should appear only once in the queue. If it appears twice, record this as a high-priority bug.
- [ ] **BUZ-08 — Rapid double-tap:** One player double-taps the buzzer. It records one buzz,
  not two.
- [ ] **BUZ-09 — Late buzz:** Try buzzing after the buzz window closes. The late tap is not
  accepted into the active queue.
- [ ] **BUZ-10 — No early buzz:** Tap where the button will appear during preview. It must
  not register before the buzzer opens.
- [ ] **BUZ-11 — Non-buzzing team:** A team that never buzzes stays out of the queue and does
  not receive an answer box.
- [ ] **BUZ-12 — All-teammate answer box:** When a team reaches the front of the queue, all
  teammates see the answer input and the same timer.
- [ ] **BUZ-13 — Other teams wait:** Teams not currently answering see a clear waiting state,
  not an editable answer box.
- [ ] **BUZ-14 — Answer submits once:** Submit an answer, then tap repeatedly. The answer is
  locked once and does not create duplicate host actions.
- [ ] **BUZ-15 — Timer expiry:** Let the answer timer expire without submitting. Host and
  players advance consistently and the next queued team gets a fresh timer if applicable.
- [ ] **BUZ-16 — Empty queue:** Let a question receive no buzzes. The host can close/resolve
  it, the clue becomes answered, and the game returns to the board.

---

# 5. Host Judging, Scores, and Queue Progression

- [ ] **JDG-01 — Correct answer:** Judge an answer Correct. The correct point value is added,
  the clue is marked answered, and turn passes to the winning team.
- [ ] **JDG-02 — Wrong answer:** Judge the first team Wrong. Its score changes according to
  the game rules, and the next queued team receives a fresh answer timer.
- [ ] **JDG-03 — Multiple wrong answers:** Judge every queued team Wrong. Each team gets one
  chance in queue order, then the clue closes cleanly.
- [ ] **JDG-04 — Correct after wrong:** Judge one team Wrong and a later team Correct. The
  later team receives points and the next pick.
- [ ] **JDG-05 — Prevent double judgment:** Double-click Correct and Wrong controls. A score
  must be applied only once and the board must not advance twice.
- [ ] **JDG-06 — Host control lock:** While a judgment is saving, controls should not allow a
  conflicting second action. Record any moment where rapid host input creates disagreement.
- [ ] **JDG-07 — Score agreement:** After every judgment, compare host, player, and projector
  scores. All three must match within a few seconds.
- [ ] **JDG-08 — Manual score edit:** Adjust a team's score manually. All screens update to
  the exact value, including zero and a negative value if allowed.
- [ ] **JDG-09 — Give turn:** Host gives the pick to a different team. Every screen identifies
  the new team and only that team can select.
- [ ] **JDG-10 — Host refresh after judgment:** Refresh immediately after judging. The score,
  answered clue, queue state, and current turn restore correctly.
- [ ] **JDG-11 — Projector feedback:** Correct feedback is clearly green; Wrong/continued
  queue behavior is understandable from across the room and does not linger over the next clue.
- [ ] **JDG-12 — Score animation:** Score and result animations play once without covering
  critical controls or delaying the next host action.
- [ ] **JDG-13 — Failed save and safe retry:** Interrupt the host's connection while judging,
  then restore it and use Try Again. The result applies exactly once and all screens converge.

---

# 6. Round Progression and Intermission

- [ ] **RND-01 — Complete Round 1 normally:** Answer the final available Round 1 clue. The
  host can advance without a stuck board or missing team.
- [ ] **RND-02 — Manual round advance:** Advance with unanswered clues remaining. Confirm the
  host intentionally allows it and every screen moves to the same phase.
- [ ] **RND-03 — Intermission standings:** Player and projector standings show the same team
  order and scores as the host.
- [ ] **RND-04 — Tied scores:** Create a tie before intermission. The display remains stable
  and does not randomly reorder or omit either team.
- [ ] **RND-05 — Negative score:** Give one team a negative score. Its intermission and board
  score render correctly without clipping or incorrect ranking.
- [ ] **RND-06 — Round 2 splash:** All player phones show the Round 2 transition/splash once,
  then reach the Round 2 board.
- [ ] **RND-07 — Round 2 values:** Round 2 clues award/deduct their configured values and do
  not reuse Round 1 values.
- [ ] **RND-08 — Round 2 turn:** The intended team gets the first Round 2 pick, and host turn
  reassignment works before the first clue.
- [ ] **RND-09 — Refresh during intermission:** Refresh one player and the projector. Each
  recovers the intermission or current round without replaying the wrong phase.
- [ ] **RND-10 — Fast host progression:** Advance through transition controls quickly. The app
  must not skip a round, show two overlays, or strand a player on an old screen.

---

# 7. Final Tap

Prepare at least four teams so elimination behavior can be tested.

- [ ] **FNL-01 — Top three qualify:** On entering Final Tap, exactly the top three teams are
  active. Other teams see the eliminated/thanks screen and leaderboard.
- [ ] **FNL-02 — Tie at cutoff:** Create a tie around third place. Record which team qualifies
  and confirm the result follows the intended rule consistently.
- [ ] **FNL-03 — Category reveal:** Active players and projector see the correct Final Tap
  category before wagering; the clue and answer are not revealed early.
- [ ] **FNL-04 — Open wagering:** Only active teams receive the wager form. Host status changes
  from waiting to ready as teams lock wagers.
- [ ] **FNL-05 — Wager limits:** Test zero, maximum, over-maximum, blank, and invalid wager
  input. Only legal wagers can lock.
- [ ] **FNL-06 — One wager per team:** Two teammates submit near-simultaneously. The team ends
  with one unambiguous locked wager, not two conflicting values.
- [ ] **FNL-07 — Wager survives refresh:** Refresh after locking. The player remains locked and
  does not receive a second wager opportunity.
- [ ] **FNL-08 — Reveal question:** Host reveals the question. Active teams and projector show
  the same clue and approximately 90-second timer.
- [ ] **FNL-09 — Submit response:** A team submits once and sees a locked/reviewing state. Host
  status updates to show that team is ready.
- [ ] **FNL-10 — All responses auto-end:** When every active team submits, the host advances to
  review without waiting for the full timer or advancing twice.
- [ ] **FNL-11 — Timer auto-submit:** Let at least one team run out of time. Its current response
  is handled consistently, and review begins without leaving the team editable.
- [ ] **FNL-12 — Missing wager recovery:** Have a qualifying team fail to submit a wager if the
  host can advance. Review must offer a way to skip that team instead of loading forever.
- [ ] **FNL-13 — Review order:** Teams are reviewed from lowest pre-Final score to highest.
- [ ] **FNL-14 — Final Correct:** Correct judgment adds the wager exactly once on every screen.
- [ ] **FNL-15 — Final Wrong:** Wrong judgment subtracts the wager exactly once on every screen.
- [ ] **FNL-16 — Final tie:** Create a tie for first if possible. Record how the winner is
  selected/displayed and whether that matches the intended house rule.
- [ ] **FNL-17 — Winner screen:** After the last judgment, player, host, and projector agree on
  the winner and complete ranking. Confetti/animations do not hide the scores.
- [ ] **FNL-18 — Eliminated player game over:** A non-top-three phone receives the final result
  without being incorrectly returned to wagering.
- [ ] **FNL-19 — Player refresh during Final Tap:** Refresh active and eliminated phones during
  incoming, wager, wager-locked, question, reviewing, and game-over states. Each returns to the
  same state without exposing the clue early or reopening a locked input.
- [ ] **FNL-20 — Host refresh during question:** Refresh the host during the 90-second clue.
  The same clue and original remaining time return automatically—Reveal Anyway is not offered,
  and the timer never restarts at 90.
- [ ] **FNL-21 — Prevent double Final judgment:** Rapidly double-click Correct or Wrong. The
  wager changes the score exactly once and review advances only one team.
- [ ] **FNL-22 — Failed Final save and safe retry:** Interrupt the host's connection while
  judging, restore it, and use Try Again. The wager applies exactly once, then review advances.
- [ ] **FNL-23 — Failed game-over save:** Interrupt the host connection as the final team is
  judged. The host must not show a false winner screen; after reconnecting, Retry Finish uses
  the saved scores and all screens reach game over.
- [ ] **FNL-24 — Refresh between judgment and game over:** Refresh the host immediately after
  the last score saves. The host detects that review is complete and restores the winner screen
  without applying any wager again.
- [ ] **FNL-25 — Missed game-over broadcast:** Disconnect one player as the host finishes, then
  reconnect without replaying the broadcast. The phone uses the finished room state to recover
  the final scores and winner screen.
- [ ] **FNL-26 — Projector refresh during question:** Refresh the projector midway through the
  90-second clue. It restores the same clue and is within roughly one second of the host timer.
- [ ] **FNL-27 — Host refresh during review:** Refresh while a team's response is awaiting
  judgment. The host restores that team (or the first still-unjudged team) without scoring twice.
- [ ] **FNL-28 — Projector refresh during review:** Refresh while a response card is displayed.
  The projector restores the same team and response without briefly revealing the Final clue.
- [ ] **FNL-29 — Late Final response rejected:** Disconnect a phone with a response typed until
  after the timer reaches zero, reconnect, and attempt submission. The phone cannot change the
  team's saved response and the host never receives a late answer.
- [ ] **FNL-30 — Simultaneous teammate responses:** Have two teammates enter different Final
  responses and submit at nearly the same moment. Both phones settle on the same first
  server-accepted response, and neither can overwrite it.
- [ ] **FNL-31 — Final response connection retry:** Interrupt a phone's connection during a
  manual Final submission while time remains. It shows a retry message instead of a false lock;
  after reconnecting, one retry locks exactly one response.

---

# 8. Network, Reconnection, and Device Behavior

Run these with trusted testers so a deliberate disconnect does not affect regular players.

- [ ] **NET-01 — Connection banner:** Turn Wi-Fi off on a player phone. It shows a clear
  Reconnecting message rather than silently freezing.
- [ ] **NET-02 — Back online:** Restore Wi-Fi. The phone shows that it is back online and
  resynchronizes to the current score and game state.
- [ ] **NET-03 — Missed preview:** Disconnect during clue selection and reconnect during the
  preview. The phone recovers the selected clue instead of allowing another pick.
- [ ] **NET-04 — Missed buzzer opening:** Disconnect before buzzer reveal and reconnect while
  the clue is active. Record whether the phone receives a usable current state and does not
  show a stale board.
- [ ] **NET-05 — Reconnect after buzzing:** Disconnect after a registered buzz. Reconnect and
  confirm the team remains in the correct queue position.
- [ ] **NET-06 — Refresh while answering:** Refresh a phone with the answer box open. It must
  not receive a fresh full timer after the original answer window has expired.
- [ ] **NET-07 — Background/foreground:** Lock a phone for 20–30 seconds, then unlock it. The
  app catches up without showing an old timer or old clue.
- [ ] **NET-08 — Switch networks:** Move a phone from Wi-Fi to cellular and back. It reconnects
  without changing team or duplicating the player.
- [ ] **NET-09 — Host brief disconnect:** Disconnect the host, then restore it. Player and
  projector screens remain understandable, and the host recovers the authoritative state.
- [ ] **NET-10 — Projector brief disconnect:** Disconnect and restore the projector. It catches
  up without host intervention or a stale full-screen result.
- [ ] **NET-11 — Error recovery screen:** If a test build can intentionally trigger a render
  error, verify the friendly reload screen appears instead of a blank white page.
- [ ] **NET-12 — PWA reopening:** Add the game to a phone's home screen or reopen an installed
  copy. It loads the current production version and resumes the correct team.
- [ ] **NET-13 — Old cache after deployment:** After a deployment, fully close and reopen a
  previously used phone. It should load the new version without a 404 or manual cache clear.
- [ ] **NET-14 — Mixed browsers:** Test at least one recent iPhone/Safari and one Android/Chrome
  device. Core joining, selection, buzzing, answer, and reconnect flows work on both.
- [ ] **NET-15 — Double Tap answer refresh:** Refresh a selecting team's phone during its
  40-second response window. It restores the remaining time from the original deadline rather
  than changing to 15 seconds or restarting at 40.
- [ ] **NET-16 — Late response rejected:** Keep a response typed as the timer reaches zero and
  attempt to submit it. The database rejects it, the phone stays closed, and the host does not
  receive a late answer.

---

# 9. Capacity and Real-Room Stress

Target beta load: 25–40 players across approximately 15–20 teams.

- [ ] **LOAD-01 — Peak joins:** Have most players join within a short period. Host/projector
  remain responsive and team/player counts settle correctly.
- [ ] **LOAD-02 — Full board sync:** With all devices connected, select and complete several
  clues. No subset of phones remains on the previous clue or board state.
- [ ] **LOAD-03 — Buzz storm:** Ask every team to buzz on the same clue. Host receives a stable
  queue, one entry per team, without freezing or losing the first buzz.
- [ ] **LOAD-04 — Reveal spread:** Watch many phones during buzzer reveal. Record the worst
  visibly early/late device, its model, browser, and network signal.
- [ ] **LOAD-05 — Repeated questions:** Run at least ten clues without refreshing anything.
  Timers, sounds, animations, queues, and scores remain responsive with no gradual slowdown.
- [ ] **LOAD-06 — Long-event stability:** Keep host and projector open for the full event.
  Neither sleeps, disconnects permanently, overheats, or accumulates stale overlays.
- [ ] **LOAD-07 — Simultaneous team actions:** Ask several teams to submit answers at nearly
  the same time on different devices. The active team and queue do not become confused.
- [ ] **LOAD-08 — Quota warning signs:** Record any connection failures, rate-limit messages,
  delayed updates, or unexplained disconnect clusters for later Ably/Supabase review.

---

# 10. Visuals, Animations, Sound, and Accessibility

- [ ] **UX-01 — Far-seat readability:** From the farthest seat, category names, clue text,
  timers, scores, active team, and Final Tap status are readable.
- [ ] **UX-02 — Small-phone layout:** On the smallest available phone, no important control is
  clipped, covered by the browser bar, or requires horizontal scrolling.
- [ ] **UX-03 — Large text/nickname:** Use long team and player names. Layouts wrap or truncate
  gracefully without covering scores or buttons.
- [ ] **UX-04 — Selection animation:** Beer-glass/tile selection animation is smooth, plays
  once, and ends on the correct clue.
- [ ] **UX-05 — Answered-glass animation:** Completed clues drain/empty once and remain clearly
  distinguishable from available clues.
- [ ] **UX-06 — Timer urgency:** Low-time animation is noticeable without making the number
  unreadable or moving controls under a player's finger.
- [ ] **UX-07 — Correct/Wrong feedback:** Color, text, and motion make the result clear even to
  someone who cannot rely on color alone.
- [ ] **UX-08 — Reduced motion:** On a phone with Reduce Motion enabled, the game remains usable
  and avoids aggressive shake/confetti effects.
- [ ] **UX-09 — Sound check:** Buzzer/result sounds occur at the intended moment, do not repeat,
  and are not required to understand the state.
- [ ] **UX-10 — Vibration fallback:** Where vibration is unsupported or disabled, visual
  feedback still clearly confirms a registered buzz.
- [ ] **UX-11 — Accidental zoom:** Repeated tapping does not zoom the page or make the buzzer
  harder to hit.
- [ ] **UX-12 — Host under pressure:** The host can identify the current team, queue, submitted
  answer, judgment controls, and Undo Pick quickly while speaking into a microphone.

---

# 11. Ending, Resetting, and Starting Another Game

- [ ] **END-01 — Normal finish:** Finishing Final Tap marks the game complete and leaves every
  screen on a stable final result.
- [ ] **END-02 — New Game from game over:** Host starts New Game. All connected players and the
  projector leave the old result and wait for/discover the new lobby.
- [ ] **END-03 — Emergency New Game mid-round:** During a disposable test game, press New Game.
  All clients exit the old room, and old scores/questions cannot leak into the new lobby.
- [ ] **END-04 — Multiple old rooms:** Confirm the host resumes only today's active room and
  does not expose an older finished game.
- [ ] **END-05 — Rejoin next game:** A phone from the previous game can join the new game with a
  new or existing team normally.
- [ ] **END-06 — Projector reset:** The projector follows the reset automatically without a
  manual URL change or stale winner screen.

---

# 12. End-of-Night Sign-Off

- [ ] All Pre-Doors tests passed.
- [ ] No score disagreement remained unresolved.
- [ ] No team appeared twice in one buzz queue.
- [ ] No two clues were selected from one turn.
- [ ] No player reported a successful-looking buzz that was missing from the host queue.
- [ ] No device remained silently disconnected or stuck on an old question.
- [ ] Host, player, and projector agreed on the winner.
- [ ] Every `[!]` result has an Issue Log entry.
- [ ] Screenshots/video were captured for visual or timing problems.
- [ ] Tester feedback was collected before people left.

## Quick tester feedback

Ask five players these questions:

1. At any point, were you unsure what you were supposed to do?
2. Did you ever tap something and wonder whether it worked?
3. Did the buzzer feel fair compared with the other phones?
4. Could you read the projector comfortably from your seat?
5. What was the most frustrating or slowest part of the night?
6. What part felt the most fun or polished?

---

# Issue Log

Copy this block for every unexpected result.

## Issue ___

- Test case ID:
- Time observed:
- Severity: Show-stopper / Major / Minor / Cosmetic
- Device and browser:
- Team/player:
- Network state or signal:
- What the tester did:
- What was expected:
- What actually happened:
- What host showed:
- What projector showed:
- Reproduced a second time: Yes / No / Not attempted
- Screenshot or video filename:
- Temporary workaround used:
- Additional notes:
