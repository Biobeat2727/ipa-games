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

## Realtime Reliability — Polling Fallbacks (added Mar 27 2026)
Supabase Realtime had a major outage (17+ incidents in March 2026). Polling fallbacks added as resilience layer — they run alongside Realtime and kick in automatically if WebSocket fails:
- **Host lobby** (`host/index.tsx`): polls teams every 3s
- **Player room status** (`play/index.tsx`): polls rooms + team score every 3s — covers game start, current_question_id (buzz button), score updates
- **Host buzz queue** (`host/Game.tsx`): polls buzzes every 2s when question is active
- **Player question selection**: ~~allowed when `currentTurnTeamId === null`~~ — **removed**. Turn must be explicitly assigned. Board is locked until `turn_change` broadcast/DB arrives.

**Supabase package pinned:** `"@supabase/supabase-js": "2.97.0"` (exact, no `^`) in package.json. Do not upgrade without testing Realtime first.

**Planned migration:** Replace Supabase broadcast layer with **Ably** for better reliability. Supabase DB stays for all data. Only the `.channel().on('broadcast')` / `.send()` calls change.

## Player Board UI
- Board grid is fully dynamic: `repeat(${boardCategories.length}, 1fr)` — supports 3 or 4 categories
- Tile height: `h-20` (80px), font: `clamp(1rem, 4vw, 1.4rem)` — sized for mobile with 4 categories
- Category headers: `clamp(0.65rem, 3vw, 0.9rem)`
- **Card flip animation** on question selection: tile flips 3D (600ms) → overlay expands from tile position to full screen → preview screen
- `flippingId` state tracks which tile is animating
- Broadcast fires immediately on tap; `setPreviewInfo` fires at 600ms (after flip)
- **Preview overlay** renders for ALL players when `previewInfo` is set. Tile-expand animation only on the selecting device (has `tileRect`); all others get instant fullscreen overlay.
- `loadQuestion()` async call in the `room.current_question_id` useEffect has a `cancelled` flag — prevents stale DB response from re-setting `activeQuestion` after `question_deactivated` already cleared state

## Host Emergency Controls (added Apr 2 2026)
During active question (top-right of question card):
- **Skip** — marks question `is_answered: true` in DB (greys cell everywhere), broadcasts answered state, deactivates. Use when time's up and no one gets it.
- **Return to Board** — deactivates without marking answered. Question stays available to pick again.

During preview countdown:
- **Abort** — cancels preview, broadcasts `question_deactivated` so all clients reset.

In buzz queue panel:
- **Clear** — deletes all buzzes from DB and resets queue. Use when a DC'd player's ghost buzz is blocking the queue.

## Vite / PWA Config (vite.config.ts)
- `devOptions: { enabled: false }` — service worker disabled in dev. No more stale cached JS during development.
- `workbox: { skipWaiting: true, clientsClaim: true }` — in production, new deployments activate immediately across all open tabs.
- `server: { watch: { usePolling: true } }` — fixes HMR on Windows (file watcher misses changes without polling).
- Landscape warning CSS uses `pointer: coarse` — only shows on touchscreen devices, never on desktop/laptop.
- No JS orientation lock — removed entirely. CSS overlay is sufficient.

## Known Issues
- Points not subtracting for wrong answers
- Projector only updates on first host-chosen question, not player-chosen
- Host doesn't show active question after countdown ends (projector/player sides work)
- Need to add: winning team chooses next question, projector setup, format changes
