-- Let late arrivals in after the game has started.
--
-- The original policy allowed team creation only while the room was in 'lobby':
--
--   create policy "players create teams during lobby" ... and rooms.status = 'lobby'
--
-- People turn up a few questions late, and that policy locked them out entirely
-- unless they happened to have a friend already playing. Joining an EXISTING team
-- mid-game always worked (the players table has no room-status check), so the
-- effect was arbitrary: latecomers with friends got in, solo latecomers did not.
--
-- Final Tap is deliberately excluded. Wagers and eligibility are computed at the
-- round_2 -> final_jeopardy transition, so a team appearing after that point would
-- be in the final without a wager. If you decide you want that too, add
-- 'final_jeopardy' to the list below.
--
-- Late teams start on 0 while everyone else has points. That is inherent to
-- joining late and is a host decision, not a technical one.

drop policy if exists "players create teams during lobby" on public.teams;

create policy "players create teams before final"
on public.teams for insert to anon, authenticated
with check (
  exists (
    select 1 from public.rooms
    where rooms.id = teams.room_id
      and rooms.status in ('lobby', 'round_1', 'round_2')
  )
);

-- Verify (expect: one row, the new policy):
--   select polname from pg_policy
--   where polrelid = 'public.teams'::regclass and polcmd = 'a';
