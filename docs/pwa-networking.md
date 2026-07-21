# PWA & Networking

## PWA manifest.json
- `name` + `short_name`: "Tapped In!"
- Icons: 192px and 512px
- `theme_color`: bold accent color
- `display: "standalone"` — removes browser chrome, feels native
- `start_url: "/play"`
- Service worker for offline app shell caching (bar WiFi resilience)

## Networking
Run off a dedicated mobile hotspot, not bar WiFi. Print SSID/password at tables and on the projector lobby screen. Supabase WebSocket connections are lightweight — 50 phones is negligible data.

## Room Resolution (no codes)
There are no room codes shown to users. Players and projector auto-resolve to the active room:

1. Query `rooms` for the most recent non-`finished` room created today (local midnight cutoff)
2. If found → proceed; if not → poll every 3s until one appears
3. "Today" is determined by local midnight so rooms from previous events don't bleed through

**Why no codes?** This is a single-bar, single-host app. One room at a time. Codes add friction and a failure mode. The room's UUID is used internally as the broadcast channel ID.

## Session Persistence
Players store their `team_id` in `localStorage`. On return visit:
- Confirm this browser's `session_id` still has a player row on the saved team
- Look up team → look up room → if the room is active and was created today, resume into lobby/game
- If membership, team, or current room is missing → clear the stale session and discover today's lobby

Host, player, and projector room discovery all use the same current-day query. The authenticated
host additionally filters by room ownership.

## URLs
| Route | Description |
|---|---|
| `/play` | Player/team interface |
| `/host` | Host control panel |
| `/projector` | Big-screen display (read-only) |

All routes are SPA pages — no server-side rendering. Deployed on Vercel.
