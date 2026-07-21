-- Authorized, idempotent Final Tap completion.
-- Run after host_auth_security.sql and atomic_final_judgment.sql.

begin;

create or replace function public.finish_game(p_room_id uuid)
returns table (
  team_id uuid,
  team_name text,
  final_score integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.room_status;
begin
  if not public.host_owns_room(p_room_id) then
    raise exception using
      errcode = '42501',
      message = 'Host is not authorized for this room';
  end if;

  select r.status into v_status
  from public.rooms as r
  where r.id = p_room_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Room was not found';
  end if;

  -- A lost response can be retried after the first call committed.
  if v_status = 'finished' then
    return query
      select t.id, t.name::text, t.score
      from public.teams as t
      where t.room_id = p_room_id
      order by t.score desc, t.created_at, t.id;
    return;
  end if;

  if v_status <> 'final_jeopardy' then
    raise exception using
      errcode = '55000',
      message = 'The room is not ready to finish';
  end if;

  if exists (
    select 1
    from public.wagers as w
    join public.teams as t on t.id = w.team_id
    where w.room_id = p_room_id
      and t.is_active
      and w.status = 'pending'
  ) then
    raise exception using
      errcode = '55000',
      message = 'A Final wager still needs judgment';
  end if;

  update public.rooms
  set status = 'finished',
      current_question_id = null,
      buzz_opened_at = null,
      current_turn_team_id = null,
      pending_question_id = null,
      pending_selection_team_id = null,
      pending_selection_session_id = null,
      pending_selection_claimed_at = null,
      pending_selection_wager = null
  where id = p_room_id;

  return query
    select t.id, t.name::text, t.score
    from public.teams as t
    where t.room_id = p_room_id
    order by t.score desc, t.created_at, t.id;
end;
$$;

revoke all on function public.finish_game(uuid) from public, anon;
grant execute on function public.finish_game(uuid) to authenticated;

commit;
