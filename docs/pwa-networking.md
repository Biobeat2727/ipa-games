# PWA & Networking

## PWA manifest.json
- `name` + `short_name`
- Icons: 192px and 512px
- `theme_color`: something bold
- `display: "standalone"` (removes browser chrome)
- `start_url: "/play"`
- Service worker for offline app shell caching (bar WiFi resilience)

## Networking
Run off dedicated mobile hotspot, not bar WiFi. Print SSID/password at tables and on QR landing page. Supabase WebSocket connections are lightweight — 50 phones = negligible data.

## Room Codes
- 6-char alphanumeric
- Exclude: 0, O, 1, I, l
- Check uniqueness against active rooms
- Rooms reusable across nights (reset status, clear questions/teams)
