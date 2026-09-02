-- Host "kick team": remove a team from a live game in one authorized transaction.
-- Run after host_auth_security.sql (needs public.host_owns_room).
--
-- Deletes the team's players, buzzes and Final wagers, detaches it from any clue
-- it answered and from the room's turn / review pointers, then deletes the team.
-- Refused while a clue is live or pending, during the Final Tap question/review
-- (the host judges or skips the team there instead), and once the game is over —
-- the same moments the host UI greys the button out, enforced here so a stale
-- screen cannot slip through.

begin;

create or replace function public.kick_team(p_team_id uuid)
returns table (
  room_id uuid,
  turn_cleared boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room_id uuid;
  v_room public.rooms%rowtype;
  v_turn_cleared boolean := false;
begin
  select t.room_id into v_room_id
  from public.teams as t
  where t.id = p_team_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Team was not found';
  end if;

  if not public.host_owns_room(v_room_id) then
    raise exception using
      errcode = '42501',
      message = 'Host is not authorized for this room';
  end if;

  select r.* into v_room
  from public.rooms as r
  where r.id = v_room_id
  for update;

  if v_room.status = 'finished' then
    raise exception using
      errcode = '55000',
      message = 'The game is already over';
  end if;

  if v_room.current_question_id is not null or v_room.pending_question_id is not null then
    raise exception using
      errcode = '55000',
      message = 'Finish or clear the current clue first';
  end if;

  if v_room.status = 'final_jeopardy' and v_room.final_phase in ('question', 'review') then
    raise exception using
      errcode = '55000',
      message = 'Wait until the Final Tap review is done';
  end if;

  delete from public.buzzes  where team_id = p_team_id;
  delete from public.wagers  where team_id = p_team_id;
  delete from public.players where team_id = p_team_id;

  update public.questions
  set answered_by_team_id = null
  where answered_by_team_id = p_team_id;

  if v_room.current_turn_team_id = p_team_id then
    v_turn_cleared := true;
  end if;

  update public.rooms
  set current_turn_team_id      = case when current_turn_team_id      = p_team_id then null else current_turn_team_id      end,
      pending_selection_team_id = case when pending_selection_team_id = p_team_id then null else pending_selection_team_id end,
      final_review_team_id      = case when final_review_team_id      = p_team_id then null else final_review_team_id      end
  where id = v_room_id;

  delete from public.teams where id = p_team_id;

  return query select v_room_id, v_turn_cleared;
end;
$$;

revoke all on function public.kick_team(uuid) from public, anon;
grant execute on function public.kick_team(uuid) to authenticated;

commit;

-- Verify (expect one row):
--   select proname, prosecdef from pg_proc where proname = 'kick_team';
