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

## Conventions
- Dark backgrounds, high-contrast text (readable at 30ft on projector)
- Buzz button: full-width, impossible to miss
- Server-generated timestamps for all buzzes
- 6-char room codes, exclude ambiguous chars (0, O, 1, I, l)

## Known Issues
- Points not subtracting for wrong answers
- Projector only updates on first host-chosen question, not player-chosen
- Host doesn't show active question after countdown ends (projector/player sides work)
- Need to add: winning team chooses next question, projector setup, format changes
