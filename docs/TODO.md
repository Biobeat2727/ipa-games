# TODO / Known Issues

## ✅ Resolved

### PWA Stale Cache — 404 on Real Devices
- `vercel.json` added: SPA rewrite + `no-store` on `sw.js`/`registerSW.js`/`index.html`
- `globIgnores: ['**/index.html']` in workbox — SW never serves stale HTML
- Refresh after any deploy now serves the latest version automatically

---

## 🟡 Bugs

- **Refresh mid-question** — player reconnecting mid-question gets a fresh timer and answer box even if the buzz window has already closed. `loadQuestion` needs to validate buzz window expiry against the server before restoring answer UI.
- **Player count on host lobby** — doesn't update in realtime when players leave teams. Needs testing to confirm current state. (Low priority)

---

## 🟢 Improvements / Not Yet Built

- Projector setup screen
- Format changes / content editor

---

## Final Tap — Known Edge Cases (documented, not actionable)

- `currentTurnTeamId` is ephemeral (broadcast only). Host page refresh resets it — host must use "give" button to reassign.
- If host refreshes during `question` phase of FJ, state restores to `wager` phase (can't recover timer start timestamp from DB). Host must click "Reveal Anyway" to restart the question.
- Eliminated players (non-top-3) land in `fjSubPhase = 'done'` immediately on `fj_wager_open`.

---

## Testing Notes

- Use `⚡ FT` button in host scoreboard (dev only) to skip directly to Final Tap from any point in the game
- DEV guard: `import.meta.env.DEV` — button never appears in production builds
