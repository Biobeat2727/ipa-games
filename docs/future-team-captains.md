# Team captains & join approval (shelved)

Status: **designed, not built.** Shelved 2026-10-24 in favor of host-only moderation
(Remove / Block / Unblock / Rename). Revisit only if team-hopping trolls become a real,
repeated problem. If it comes back, consider the lighter **"Lock team"** variant first
(see the end of this doc).

## Why it was shelved

- Approval would add friction to every normal join (the most common player action) to stop
  a rare troll, and adds new failure modes (a captain's phone asleep in a pocket).
- Every captain/approval rule is something new hosts at other bars would have to learn.
- At a bar, people are physically present; the host's Block tool covers the troll case.

## The design, as agreed with Davey

### Captain
- Whoever creates a team is its captain.
- On creating a team, the captain sees a notice with two buttons:
  *"You're the captain of [Team]. Anyone who wants to join needs your OK."*
  **[Approve each request]** · **[Let everyone in automatically]**
- Solo ("On my own") teams skip all of this.
- The host can make any team member captain from the host screen (players come up to the
  host if the captain's phone dies or they leave).
- If the captain leaves or is removed, the next player to have joined becomes captain
  automatically, so a team is never stuck; the host can change it.

### Join requests
- Tapping an existing team sends a request; the requester sees
  *"Waiting for [Team] to let you in…"* with Cancel.
- The captain gets an "Alex wants to join — Allow / Deny" banner on whatever screen they're
  on. It must never cover the buzzer or the answer box.
- Requests expire after ~60 seconds.
- Deny = that phone can't request that team again this game (a team-scoped block). It can
  still join or create other teams.
- The host's Blocked list shows captain denials alongside host blocks; **Unblock** undoes an
  accidental deny.

### Auto-approve
- Captain toggle, **off by default**; offered in the creation notice and in a team-settings
  spot the captain can reach later.
- Enforced server-side: with it on, a request is approved the instant it arrives.
- Blocks still win: a host-blocked phone, or one this team denied, stays out.
- Setting stays with the team across captain swaps.
- Host screen shows a small "auto" tag on teams with it on.
- Open question left undecided: whether captains may *remove* (never block) their own
  teammates, or whether removal stays host-only.

### Data / enforcement sketch
- `teams.captain_player_id`, `teams.auto_approve boolean default false`.
- `join_requests` (room, team, device, nickname, status: pending / approved / denied /
  expired / cancelled, created_at).
- Captain denials stored in the same blocks table the host uses, with a `team_id` scope
  (null = whole game) and a reason (`host_block` / `captain_deny`).
- RPCs: `request_join`, `cancel_join_request`, `respond_join_request` (captain-only, verified
  by the device key), `host_set_captain`, `set_auto_approve`.
- Broadcasts: `join_request`, `join_response`, `captain_changed`, with a DB fallback per
  `docs/realtime.md`.
- Builds on the device key and join/leave RPCs from the host-moderation work, so most of
  the server plumbing will already exist.

## Lighter alternative: "Lock team"
- Teams are open by default (today's behavior).
- Any team member can tap **Lock team**; a locked team accepts no new joiners.
- Someone who belongs on a locked team asks a teammate to unlock it or comes to the host.
- Friction lands only on teams that ask for it; no request/approval UI at all.
