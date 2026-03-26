# Trivia Night App

Real-time Jeopardy-style PWA. Three synced modes: Player (/play), Host (/host), Projector (/projector). Teams join via QR code on phones.

## Stack
React + Vite, TypeScript, Tailwind CSS, Supabase (Postgres + Realtime), Vercel, PWA

## Commands
- Dev: `npm run dev`
- Build: `npm run build`
- Test: `npm test`
- Types: `npx tsc --noEmit`
- Lint: `npm run lint`

## Key Architecture
- One Supabase Realtime channel per room: `room:{room_code}`
- Game state lives in Postgres, broadcast events sync all clients
- Timer sync is server-side — never trust client clocks
- Wagers lock before answer reveal (enforced in game state, not just UI)
- `is_active` flag only set false at Round 2 → Final Jeopardy transition

## Detailed Docs (read when working on these areas)
- `docs/db-schema.md` — Full database schema (all tables/columns)
- `docs/game-flow.md` — Complete game state machine and phase transitions
- `docs/realtime.md` — Channel structure, event types, timer logic
- `docs/views.md` — All screen states for player, host, and projector modes
- `docs/content-format.md` — JSON import format for trivia content
- `docs/pwa-networking.md` — PWA config, service worker, hotspot setup

## Supabase RLS
- **All tables have RLS enabled** — anon key is blocked by default for writes
- DELETE policies must be explicitly created: `CREATE POLICY "allow_delete" ON <table> FOR DELETE USING (true);`
- Tables requiring policies: `players`, `teams`, `rooms`, `categories`, `questions`, `buzzes`, `wagers`
- Silent failure pattern: RLS blocks return `{ data: [], error: null }` with `count: 0` — no error thrown
- When a DB write seems to do nothing, check RLS first (`SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public'`)
- `postgres_changes` DELETE events require the row to actually be deleted — if RLS blocks the delete, no event fires

## Session / Identity
- `session_id` (`trivia_session_id`) is **permanent** — never cleared, even by `clearPlayerSession()`
- `clearPlayerSession()` only removes `roomCode` and `teamId` from localStorage
- Always delete player rows by `session_id`, not by a stored player ID state (state can be null on page refresh)

## Conventions
- Dark backgrounds, high-contrast text (readable at 30ft on projector)
- Buzz button: full-width, impossible to miss
- Server-generated timestamps for all buzzes
- 6-char room codes, exclude ambiguous chars (0, O, 1, I, l)

## Final Jeopardy (Final Tap) — Implementation Notes
- FJ sub-phases (host): `starting` → `wager` → `question` → `review` → `done`
- FJ sub-phases (player): `incoming` → `wager` → `wager_locked` → `question` → `reviewing` → `done`
- `startFinalJeopardy()` deletes all wagers for the room before running (prevents stale data across dev reloads)
- Host page refresh during FJ: rehydrated from DB in a `useEffect` guarded by `room.status === 'final_jeopardy' && fjPhase === null`. Phase detected from wager rows: no wagers → `starting`, wagers+no responses → `wager`, wagers+responses → `review`
- `fjExpiryInProgress` ref guards the timer expiry handler against re-entrancy. Auto-end effect only has `[fjWagers]` in deps (not `fjTimerExpired`) to prevent the feedback loop
- Timer expiry skips the 1500ms wait if all responses are already in the DB
- DEV-only `⚡ FT` button in host scoreboard header (gated by `import.meta.env.DEV`) calls `startFinalJeopardy()` directly for fast testing
- `lobby_closed` handler must reset `fjSubPhase` to null or the game-over screen persists after new game starts
- `game_state_change { status: 'final_jeopardy' }` handler resets all player FJ state before setting `incoming`

## Temporary Event Theming (Birthday Edition — remove after event)
Four things to remove when done:

1. **Birthday message** — `src/routes/play/index.tsx`, select_team screen. Delete the two `<p>` lines and the comment between the `<h1>` and the nickname `<input>`. Restore `mb-8` on the `<h1>`.
2. **Balloon animation CSS** — `src/index.css`. Delete the `@keyframes balloon-float { ... }` block.
3. **Balloons + confetti in play/index.tsx:**
   - Remove `import confetti from 'canvas-confetti'` at the top
   - Remove `const [showBalloons, setShowBalloons] = useState(false)` state
   - Remove the `useEffect` block commented `// Launch balloons + confetti when the team selection screen appears`
   - Remove the balloon overlay JSX block (the `{showBalloons && (<div ...>)}`) inside the select_team screen
4. **Uninstall the package:** `npm uninstall canvas-confetti` and `npm uninstall -D @types/canvas-confetti`

## Known Issues
- Points not subtracting for wrong answers
- Projector only updates on first host-chosen question, not player-chosen
- Host doesn't show active question after countdown ends (projector/player sides work)
- Need to add: winning team chooses next question, projector setup, format changes
