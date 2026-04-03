# TODO / Known Issues

## Bugs
- Player count on host lobby doesn't update in realtime when players leave teams (low priority)
- Points not subtracting for wrong answers in rounds (score logic)
- Projector only updates on first host-chosen question, not player-chosen
- Host doesn't show active question after countdown ends (projector/player sides work fine)

## Supabase Setup Required
- Confirm `teams`, `rooms`, `questions`, `buzzes`, `wagers` tables are all added to the Supabase realtime publication (Dashboard → Database → Replication → supabase_realtime). Without this, postgres_changes subscriptions silently do nothing — broadcasts are the fallback but not a full replacement.

## Improvements / Not Yet Built
- Winning team chooses next question (currently auto-assigned or host manually gives)
- Projector setup screen
- Format changes / content editor
- Manual score adjustment UI (partially exists via inline edit on host scoreboard)

## Final Tap — Known Edge Cases
- `currentTurnTeamId` is ephemeral (broadcast only). Host page refresh resets it — host must use "give" button to reassign.
- If host refreshes during `question` phase of FJ, state restores to `wager` phase (can't recover timer start timestamp from DB). Host must click "Reveal Anyway" to restart the question.
- Eliminated players (non-top-3) land in `fjSubPhase = 'done'` immediately on `fj_wager_open`.

## Testing Notes
- Use `⚡ FT` button in host scoreboard (dev only) to skip directly to Final Tap from any point in the game
- DEV guard: `import.meta.env.DEV` — button never appears in production builds


Fix the issue with refresh allowing players to choose categories when it's not their turn.


For the Double tap round there needs to be some overhauls on the functionality. While the other team is wagering, the player screens need to show something other  than the board. The team that selected the double tap round is the only team that can wager, guess, and gain or lose points. New sound effect and animation for winning the double tap category. 