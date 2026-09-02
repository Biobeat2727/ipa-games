# Trivia Night App

Real-time Jeopardy-style PWA. Three synced modes: Player (/play), Host (/host), Projector (/projector). Teams join via QR code on phones.

## Stack
React + Vite, TypeScript, Tailwind CSS, Supabase (Postgres + Realtime), Vercel, PWA

## Commands
- Dev: `npm run dev`
- Build: `npm run build` (runs `tsc -b` first — a type error fails the build)
- Types: `npx tsc -b`

Note: `npx tsc --noEmit` reports success without checking anything. The root
`tsconfig.json` is solution-style (`"files": []` + project references), so
`--noEmit` checks an empty file list; only `-b` walks the referenced projects.

No test or lint script is configured — `npm test` and `npm run lint` do not exist.

## Key Architecture
- One Supabase Realtime channel per room: `room:{room_code}`
- Game state lives in Postgres, broadcast events sync all clients
- Timer sync is server-side — never trust client clocks
- Wagers lock before answer reveal (enforced in game state, not just UI)
- Three regular rounds (`round_1` → `round_2` → `round_3`), then Final Tap
  (`final_jeopardy`). Round numbers, statuses, labels, next-round logic and
  Double Tap floors all come from `src/lib/rounds.ts` — never write a
  `status === 'round_2' ? … : …` ternary in a route.
- `is_active` stays true for every team through Rounds 1–3; it is only set false
  at the Round 3 → Final Tap transition (teams at 0 or below)
- Final Tap content is identified by its null `point_value` (`src/lib/finalTap.ts`).
  New imports store the Final Tap category as `round = 4`; rooms imported before
  Round 3 existed stored it as `round = 3` and still resolve.
- Double Tap wager ceiling = max(team score, round floor); floors are
  1000 / 2000 / 3000 for rounds 1 / 2 / 3, defined once in `src/lib/rounds.ts`
  and mirrored by `public.double_tap_floor()` in `supabase/add_round_three_2_game_logic.sql`.
  Values confirmed by Davey 2026-09-02 (Round 1 raised from 500).
- Database first, frontend second: `supabase/add_round_three_1_enum.sql`, `_2_game_logic.sql`, then `_3_category_round_check.sql` (three separate SQL-editor runs) must be applied
  before deploying a build that emits `round_3`; apply and roll back only between games.
- Kick team: both the lobby ✕ and the in-game scoreboard ✕ call the authorized
  `public.kick_team()` function (`supabase/kick_team.sql`) and then broadcast `team_kicked`.
  Apply that file before deploying a build with the kick buttons.

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
- Category names: 14 chars max incl. spaces/punctuation (mobile tap-handle constraint)
- Weekly round content pipeline: `.claude/skills/tapped-in-rounds/SKILL.md`
- Board visual theme: bar tap wall — categories are tap handles, point-value tiles are beer glasses (full = unanswered, empty = answered). Component: `src/components/TapCategoryColumn.tsx` (`TapHeader`, `BeerGlass`). Details in `docs/views.md`.

## Known Issues

There it is. npm install canvas-confetti silently upgraded @supabase/supabase-js from 2.49.x to 2.97.0 — a massive 48-minor-version jump. That's what broke realtime. Let me verify: