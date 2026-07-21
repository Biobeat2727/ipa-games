-- Persisted Final Tap state and server-authoritative question deadline.
-- Run after host_auth_security.sql and finish_game_safely.sql.

begin;

alter table public.rooms
  add column if not exists final_phase text,
  add column if not exists final_question_id uuid references public.questions(id) on delete set null,
  add column if not exists final_response_deadline_at timestamptz,
  add column if not exists final_review_team_id uuid references public.teams(id) on delete set null;

alter table public.rooms
  drop constraint if exists rooms_final_phase_check;

alter table public.rooms
  add constraint rooms_final_phase_check
  check (final_phase is null or final_phase in ('starting', 'wager', 'question', 'review', 'done'));

-- Existing Final Tap rooms predate persisted phases. The safest recovery point is
-- wagering unless responses already exist, in which case the host resumes review.
update public.rooms as r
set final_phase = case
  when exists (
    select 1 from public.wagers as w
    where w.room_id = r.id and w.response is not null
  ) then 'review'
  when exists (
    select 1 from public.wagers as w
    where w.room_id = r.id
  ) then 'wager'
  else 'starting'
end
where r.status = 'final_jeopardy'
  and r.final_phase is null;

create or replace function public.reveal_final_question(
  p_room_id uuid,
  p_question_id uuid
)
returns table (
  question_id uuid,
  response_deadline_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms%rowtype;
begin
  if not public.host_owns_room(p_room_id) then
    raise exception using
      errcode = '42501',
      message = 'Host is not authorized for this room';
  end if;

  select * into v_room
  from public.rooms
  where id = p_room_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Room was not found';
  end if;

  -- A lost response can be retried without restarting or extending the timer.
  if v_room.status = 'final_jeopardy'
    and v_room.final_phase = 'question'
    and v_room.final_question_id = p_question_id
    and v_room.final_response_deadline_at is not null then
    return query select v_room.final_question_id, v_room.final_response_deadline_at;
    return;
  end if;

  if v_room.status <> 'final_jeopardy' or v_room.final_phase <> 'wager' then
    raise exception using errcode = '55000', message = 'Final question is not ready to reveal';
  end if;

  if not exists (
    select 1
    from public.questions as q
    join public.categories as c on c.id = q.category_id
    where q.id = p_question_id
      and c.room_id = p_room_id
      and c.round = 3
  ) then
    raise exception using errcode = '22023', message = 'Question is not the Final question for this room';
  end if;

  update public.rooms
  set final_phase = 'question',
      final_question_id = p_question_id,
      final_response_deadline_at = clock_timestamp() + interval '90 seconds',
      final_review_team_id = null
  where id = p_room_id
  returning rooms.final_question_id, rooms.final_response_deadline_at
  into v_room.final_question_id, v_room.final_response_deadline_at;

  return query select v_room.final_question_id, v_room.final_response_deadline_at;
end;
$$;

revoke all on function public.reveal_final_question(uuid, uuid) from public, anon;
grant execute on function public.reveal_final_question(uuid, uuid) to authenticated;

-- Keep the existing idempotent finish behavior while marking the persisted Final
-- state complete for clients that receive the room update before game_over.
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
    raise exception using errcode = '42501', message = 'Host is not authorized for this room';
  end if;

  select r.status into v_status
  from public.rooms as r
  where r.id = p_room_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Room was not found';
  end if;

  if v_status = 'finished' then
    return query
      select t.id, t.name::text, t.score
      from public.teams as t
      where t.room_id = p_room_id
      order by t.score desc, t.created_at, t.id;
    return;
  end if;

  if v_status <> 'final_jeopardy' then
    raise exception using errcode = '55000', message = 'The room is not ready to finish';
  end if;

  if exists (
    select 1
    from public.wagers as w
    join public.teams as t on t.id = w.team_id
    where w.room_id = p_room_id
      and t.is_active
      and w.status = 'pending'
  ) then
    raise exception using errcode = '55000', message = 'A Final wager still needs judgment';
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
      pending_selection_wager = null,
      final_phase = 'done',
      final_review_team_id = null
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
