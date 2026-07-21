-- Server-authoritative Final Tap response submission.
-- The database owns the deadline and the first accepted response for each team.

begin;

create or replace function public.submit_final_response(
  p_room_id uuid,
  p_team_id uuid,
  p_session_id text,
  p_response text
)
returns table (
  accepted boolean,
  wager_id uuid,
  saved_response text,
  response_submitted_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms%rowtype;
  v_wager public.wagers%rowtype;
  v_now timestamptz;
begin
  if p_session_id is null or btrim(p_session_id) = '' then
    raise exception 'A valid player session is required';
  end if;

  if length(p_response) > 500 then
    raise exception 'Final response is too long';
  end if;

  if not exists (
    select 1
    from public.players as p
    join public.teams as t on t.id = p.team_id
    where p.team_id = p_team_id
      and p.session_id = p_session_id
      and t.room_id = p_room_id
      and t.is_active
  ) then
    raise exception 'Player session does not belong to this active team';
  end if;

  select r.* into v_room
  from public.rooms as r
  where r.id = p_room_id
  for update;

  if not found then
    raise exception 'Room not found';
  end if;

  select w.* into v_wager
  from public.wagers as w
  where w.room_id = p_room_id
    and w.team_id = p_team_id
  for update;

  if not found then
    raise exception 'Final wager not found';
  end if;

  -- Safe retry: once the team has locked a response, return it unchanged even if
  -- the retry reaches the server after the deadline.
  if v_wager.submitted_at is not null then
    return query select
      false,
      v_wager.id,
      v_wager.response,
      v_wager.submitted_at;
    return;
  end if;

  if v_room.status <> 'final_jeopardy'
    or v_room.final_phase <> 'question'
    or v_room.final_response_deadline_at is null then
    raise exception 'Final response window is not open';
  end if;

  v_now := clock_timestamp();
  if v_now > v_room.final_response_deadline_at then
    raise exception 'Final response window has closed';
  end if;

  update public.wagers as w
  set response = nullif(btrim(p_response), ''),
      submitted_at = v_now
  where w.id = v_wager.id
  returning w.* into v_wager;

  return query select
    true,
    v_wager.id,
    v_wager.response,
    v_wager.submitted_at;
end;
$$;

revoke all on function public.submit_final_response(uuid, uuid, text, text) from public;
grant execute on function public.submit_final_response(uuid, uuid, text, text) to anon, authenticated;

-- Phones can still read and create their Final wager, but only the validated
-- function above may lock a response or submission timestamp.
revoke update on public.wagers from public, anon;

commit;
