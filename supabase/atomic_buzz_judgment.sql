-- Atomic, idempotent host judgment for regular and Double Tap buzzes.
-- Run after host_auth_security.sql and deduplicate_team_actions.sql.

begin;

create or replace function public.judge_buzz(
  p_room_id uuid,
  p_buzz_id uuid,
  p_outcome text,
  p_points integer
)
returns table (
  applied boolean,
  buzz_id uuid,
  team_id uuid,
  question_id uuid,
  outcome text,
  new_score integer,
  question_done boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_buzz public.buzzes%rowtype;
  v_team public.teams%rowtype;
  v_question public.questions%rowtype;
  v_round integer;
  v_new_score integer;
  v_question_done boolean;
  v_max_wager integer;
begin
  if not public.host_owns_room(p_room_id) then
    raise exception using
      errcode = '42501',
      message = 'Host is not authorized for this room';
  end if;

  if p_outcome not in ('correct', 'wrong') then
    raise exception using
      errcode = '22023',
      message = 'Outcome must be correct or wrong';
  end if;

  select b.* into v_buzz
  from public.buzzes as b
  where b.id = p_buzz_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Buzz was not found';
  end if;

  select t.* into v_team
  from public.teams as t
  where t.id = v_buzz.team_id
    and t.room_id = p_room_id
  for update;

  if not found then
    raise exception using
      errcode = '22023',
      message = 'Buzz team does not belong to this room';
  end if;

  select q.* into v_question
  from public.questions as q
  join public.categories as c on c.id = q.category_id
  where q.id = v_buzz.question_id
    and c.room_id = p_room_id
  for update of q;

  if not found then
    raise exception using
      errcode = '22023',
      message = 'Buzz question does not belong to this room';
  end if;

  select c.round into v_round
  from public.categories as c
  where c.id = v_question.category_id;

  -- A retry after a lost response is a successful no-op. A conflicting second
  -- judgment is rejected so Correct and Wrong can never both change the score.
  if v_buzz.status <> 'pending' then
    if v_buzz.status::text <> p_outcome then
      raise exception using
        errcode = 'P0001',
        message = format('Buzz was already judged %s', v_buzz.status::text);
    end if;

    return query select
      false,
      v_buzz.id,
      v_buzz.team_id,
      v_buzz.question_id,
      v_buzz.status::text,
      v_team.score,
      v_question.is_answered;
    return;
  end if;

  if not exists (
    select 1 from public.rooms as r
    where r.id = p_room_id
      and r.current_question_id = v_buzz.question_id
      and r.status in ('round_1', 'round_2')
  ) then
    raise exception using
      errcode = '55000',
      message = 'This question is no longer active';
  end if;

  if p_points is null or p_points < 0 then
    raise exception using
      errcode = '22023',
      message = 'Point value must be non-negative';
  end if;

  if coalesce(v_question.is_double_tap, false) then
    v_max_wager := greatest(
      v_team.score,
      case when v_round = 2 then 2000 else 500 end
    );
    if p_points not between 5 and v_max_wager then
      raise exception using
        errcode = '22023',
        message = 'Double Tap wager is outside the allowed range';
    end if;
  elsif p_points is distinct from v_question.point_value then
    raise exception using
      errcode = '22023',
      message = 'Point value does not match the active question';
  end if;

  if p_outcome = 'correct' then
    update public.buzzes
    set status = 'correct'
    where id = v_buzz.id;

    update public.teams
    set score = score + p_points
    where id = v_team.id
    returning score into v_new_score;

    update public.questions
    set is_answered = true,
        answered_by_team_id = v_team.id
    where id = v_question.id;

    v_question_done := true;
  else
    update public.buzzes
    set status = 'wrong'
    where id = v_buzz.id;

    update public.teams
    set score = score - p_points
    where id = v_team.id
    returning score into v_new_score;

    select not exists (
      select 1
      from public.buzzes as remaining
      where remaining.question_id = v_question.id
        and remaining.status = 'pending'
    ) into v_question_done;

    if v_question_done then
      update public.questions
      set is_answered = true,
          answered_by_team_id = null
      where id = v_question.id;
    end if;
  end if;

  return query select
    true,
    v_buzz.id,
    v_buzz.team_id,
    v_buzz.question_id,
    p_outcome,
    v_new_score,
    v_question_done;
end;
$$;

revoke all on function public.judge_buzz(uuid, uuid, text, integer) from public, anon;
grant execute on function public.judge_buzz(uuid, uuid, text, integer) to authenticated;

commit;
