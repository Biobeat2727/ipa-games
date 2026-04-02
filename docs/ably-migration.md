# Ably Migration Guide

Migrate the broadcast layer from Supabase Realtime to Ably. Supabase stays for all DB operations and `postgres_changes` subscriptions. Only the pub/sub messaging layer moves.

---

## What We're Changing (and What We're Not)

**Moving to Ably:**
- All `.channel().on('broadcast', ...)` subscriptions
- All `.send({ type: 'broadcast', event: ..., payload: ... })` calls

**Staying on Supabase:**
- All `postgres_changes` subscriptions (rooms, teams, questions, buzzes, wagers, players)
- All DB reads/writes (`supabase.from(...).select/insert/update/delete`)
- Polling fallbacks (keep them — cheap insurance)

---

## Files to Change

| File | Changes |
|---|---|
| `package.json` | Add `ably` package |
| `src/lib/ably.ts` | New file — Ably client singleton |
| `src/routes/host/index.tsx` | Replace 1 broadcast channel |
| `src/routes/host/Game.tsx` | Replace 1 broadcast channel (main command hub) |
| `src/routes/play/index.tsx` | Replace 2 broadcast channels |
| `src/routes/projector/index.tsx` | Replace 1 broadcast channel |

---

## Step 0 — Setup

### Install
```bash
npm install ably
```

### Get API Key
1. Sign up at https://ably.com (free tier: 6M messages/month, 200 concurrent connections)
2. Create an app → copy the API key
3. Add to `.env.local`:
```
VITE_ABLY_KEY=your_key_here
```
4. Add same var to Vercel environment variables (Settings → Environment Variables)

### Create `src/lib/ably.ts`
```ts
import Ably from 'ably'

export const ablyClient = new Ably.Realtime({
  key: import.meta.env.VITE_ABLY_KEY,
  clientId: crypto.randomUUID(), // unique per tab/session
})
```

> **Note:** For production, switch to token auth (Ably Edge Function or Supabase Edge Function generates short-lived tokens). The API key approach is fine for now since this is a private app.

---

## Step 1 — `host/index.tsx`

### What's there now
One broadcast channel `room:${roomId}` with two listeners:
- `team_joined` → `fetchTeams()`
- `player_left` → `fetchTeams()`

No sends from this file (sends happen in Game.tsx).

### The change
```ts
// BEFORE
const bcCh = supabase.channel(`room:${roomId}`)
  .on('broadcast', { event: 'team_joined' }, () => fetchTeams(roomId))
  .on('broadcast', { event: 'player_left' }, () => fetchTeams(roomId))
  .subscribe()
// cleanup: supabase.removeChannel(bcCh)

// AFTER
const ablyChannel = ablyClient.channels.get(`room:${roomId}`)
ablyChannel.subscribe('team_joined', () => fetchTeams(roomId))
ablyChannel.subscribe('player_left', () => fetchTeams(roomId))
// cleanup: ablyChannel.unsubscribe()
```

---

## Step 2 — `host/Game.tsx`

This is the biggest change — the main command hub. One broadcast channel `room:${initialRoom.id}` stored in `broadcastRef.current`.

### Listeners (receive)
| Event | Action |
|---|---|
| `question_preview` | Sets preview info |
| `question_activated` | Updates `room.current_question_id` |
| `fj_wager_locked` | Marks team wager as locked |

### Sends (publish) — 18 total
All calls look like:
```ts
broadcastRef.current?.send({ type: 'broadcast', event: 'event_name', payload: { ... } })
```

Full event inventory:
| Event | Payload |
|---|---|
| `turn_change` | `{ team_id }` |
| `question_activated` | `{ question_id }` |
| `question_deactivated` | `{}` |
| `timer_start` | `{ start_timestamp, duration_seconds, team_id, buzz_id, team_name }` |
| `score_update` | `{ teams, current_question_id?, answered_question_id?, winning_team_id?, wrong_buzz_id? }` |
| `game_state_change` | `{ status, fj_category?, active_team_ids? }` |
| `fj_wager_open` | `{ active_team_ids }` |
| `fj_question_revealed` | `{ question_id, start_ts, duration: 90 }` |
| `fj_timer_expired` | `{}` |
| `fj_answer_reveal` | `{ team_id, team_name, response }` |
| `fj_answer_judged` | `{ team_id, status, wager, new_score }` |
| `game_over` | `{ scores }` |
| `lobby_closed` | `{}` |

### The change
```ts
// BEFORE
const ch = supabase.channel(`room:${initialRoom.id}`)
  .on('broadcast', { event: 'question_preview' }, ({ payload }) => { ... })
  .on('broadcast', { event: 'question_activated' }, ({ payload }) => { ... })
  .on('broadcast', { event: 'fj_wager_locked' }, ({ payload }) => { ... })
  .subscribe((status) => {
    if (status === 'SUBSCRIBED') { /* auto-assign turn */ }
  })
broadcastRef.current = ch
// cleanup: supabase.removeChannel(ch)

// Sends:
broadcastRef.current?.send({ type: 'broadcast', event: 'turn_change', payload: { team_id } })

// AFTER
const ch = ablyClient.channels.get(`room:${initialRoom.id}`)
ch.subscribe('question_preview', ({ data }) => { /* use data instead of payload */ })
ch.subscribe('question_activated', ({ data }) => { ... })
ch.subscribe('fj_wager_locked', ({ data }) => { ... })
// On subscribe ready — Ably fires 'attached' state
ch.on('attached', () => { /* auto-assign turn */ })
broadcastRef.current = ch
// cleanup: ch.unsubscribe()

// Sends:
broadcastRef.current?.publish('turn_change', { team_id })
```

> **Key difference:** Supabase wraps data in `{ payload: ... }` — Ably puts it directly in `{ data: ... }`. Every handler needs `{ data }` instead of `{ payload }`.

---

## Step 3 — `play/index.tsx`

Two broadcast channels to replace:

### Channel 1: `play-kick-${room.id}`
Single listener: `lobby_closed` → clear session, return to no_lobby.

```ts
// BEFORE
const ch = supabase.channel(`play-kick-${room.id}`)
  .on('broadcast', { event: 'lobby_closed' }, () => { clearPlayerSession(); setPhase('no_lobby') })
  .subscribe()

// AFTER
const ch = ablyClient.channels.get(`play-kick-${room.id}`)
ch.subscribe('lobby_closed', () => { clearPlayerSession(); setPhase('no_lobby') })
```

### Channel 2: `room:${room.id}` — main game channel
This channel both receives and sends.

**Listeners (12 events):**
| Event | Action |
|---|---|
| `question_preview` | Shows preview overlay |
| `question_activated` | Enables buzz button |
| `question_deactivated` | Resets all question state |
| `timer_start` | Starts response timer |
| `score_update` | Updates scores, marks answered cells, sets buzzResult |
| `turn_change` | Sets `currentTurnTeamId` |
| `game_state_change` | Handles round/FJ transitions |
| `fj_question_revealed` | Starts FJ question phase |
| `fj_wager_open` | Opens wager entry |
| `fj_timer_expired` | Locks FJ response |
| `game_over` | Shows final scores |
| `lobby_closed` | Full state reset |

**Sends (3 events):**
| Event | When | Payload |
|---|---|---|
| `team_joined` | On team join | `{}` |
| `question_preview` | On tile tap | `{ questionId, categoryName, pointValue, startTs, doubleTapWager? }` |
| `fj_wager_locked` | On wager submit | `{ team_id }` |

```ts
// BEFORE
const ch = supabase.channel(`room:${room.id}`)
  .on('broadcast', { event: 'question_preview' }, ({ payload }) => { ... })
  // ...12 more handlers
  .subscribe()
broadcastRef.current = ch

// AFTER
const ch = ablyClient.channels.get(`room:${room.id}`)
ch.subscribe('question_preview', ({ data }) => { ... })
// ...12 more handlers
broadcastRef.current = ch

// Sends:
broadcastRef.current?.publish('question_preview', { questionId, categoryName, pointValue, startTs })
```

---

## Step 4 — `projector/index.tsx`

One broadcast channel `room:${room.id}`. Receives only — projector never sends.

**Listeners (15 events):**
`question_preview`, `question_activated`, `question_deactivated`, `timer_start`, `score_update`, `turn_change`, `game_state_change`, `team_joined`, `fj_wager_locked`, `fj_question_revealed`, `fj_timer_expired`, `fj_answer_reveal`, `fj_answer_judged`, `game_over`, `lobby_closed`

```ts
// BEFORE
const ch = supabase.channel(`room:${room.id}`)
  .on('broadcast', { event: 'question_preview' }, ({ payload }) => { ... })
  // ...14 more
  .subscribe((status) => {
    if (status === 'SUBSCRIBED') resyncAll()
  })

// AFTER
const ch = ablyClient.channels.get(`room:${room.id}`)
ch.subscribe('question_preview', ({ data }) => { ... })
// ...14 more
ch.on('attached', () => resyncAll())
```

---

## Payload Destructuring — Global Find/Replace

Every broadcast handler currently destructures `payload`:
```ts
.on('broadcast', { event: 'score_update' }, ({ payload }) => {
  setTeams(payload.teams)
})
```

After migration it's `data`:
```ts
ch.subscribe('score_update', ({ data }) => {
  setTeams(data.teams)
})
```

**Do a global search for `{ payload }` in the four route files and rename to `{ data }`.** There are approximately 30 instances total.

---

## Cleanup Pattern

| Supabase | Ably |
|---|---|
| `supabase.removeChannel(ch)` | `ch.detach()` or `ch.unsubscribe()` |
| `channel.subscribe(statusCallback)` | `ch.attach()` (optional, attaches implicitly on first subscribe) |
| Status `'SUBSCRIBED'` | State `'attached'` via `ch.on('attached', cb)` |

---

## All Broadcast Events (Reference)

| Event | Direction | Channel |
|---|---|---|
| `question_preview` | Player → Host, Projector | `room:{id}` |
| `question_activated` | Host → Player, Projector | `room:{id}` |
| `question_deactivated` | Host → Player, Projector | `room:{id}` |
| `timer_start` | Host → Player, Projector | `room:{id}` |
| `score_update` | Host → Player, Projector | `room:{id}` |
| `turn_change` | Host → Player, Projector | `room:{id}` |
| `game_state_change` | Host → Player, Projector | `room:{id}` |
| `team_joined` | Player → Host, Projector | `room:{id}` |
| `player_left` | Player → Host | `room:{id}` |
| `lobby_closed` | Host → Player, Projector | `room:{id}` and `play-kick-{id}` |
| `fj_wager_open` | Host → Player | `room:{id}` |
| `fj_wager_locked` | Player → Host, Projector | `room:{id}` |
| `fj_question_revealed` | Host → Player, Projector | `room:{id}` |
| `fj_timer_expired` | Host → Player, Projector | `room:{id}` |
| `fj_answer_reveal` | Host → Player, Projector | `room:{id}` |
| `fj_answer_judged` | Host → Projector | `room:{id}` |
| `game_over` | Host → Player, Projector | `room:{id}` |

---

## Testing Checklist

After each step, test that phase before moving on:

- [ ] Step 1: Teams appear in host lobby as players join
- [ ] Step 2: Full question flow — select → preview → buzz → judge → score update → board grey
- [ ] Step 2: Turn assignment works at game start and after correct answer
- [ ] Step 3: Player sees preview overlay on another player's tile tap
- [ ] Step 3: Buzz button goes live on `question_activated`
- [ ] Step 3: `score_update` shows correct/wrong result and returns to board
- [ ] Step 4: Projector board updates on question selection and scoring
- [ ] Full: Double Tap flow end-to-end
- [ ] Full: Final Tap (Final Jeopardy) all sub-phases
- [ ] Full: New Game resets all clients

---

## Migration Order (Recommended)

1. **Setup** (Step 0) — install, env vars, `src/lib/ably.ts`
2. **Host lobby** (Step 1) — low risk, easy win
3. **Player** (Step 3) — do this before host/Game.tsx so you can see both sides at once
4. **Projector** (Step 4) — receive-only, straightforward
5. **Host Game** (Step 2) — most complex, save for last when other sides are confirmed working

---

## Progress Tracker

- [x] Step 0 — Setup (install + env + ably.ts)
- [x] Step 1 — host/index.tsx
- [x] Step 2 — host/Game.tsx
- [x] Step 3 — play/index.tsx
- [x] Step 4 — projector/index.tsx
- [ ] Testing checklist complete
- [ ] Add VITE_ABLY_KEY to Vercel environment variables
- [ ] Deploy to Vercel
