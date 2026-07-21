-- Atomic, idempotent host judgment for Final Jeopardy wagers.
-- Run after host_auth_security.sql and deduplicate_team_actions.sql.

begin;

create or replace function public.judge_final_wager(
  p_room_id uuid,
  p_wager_id uuid,
  p_outcome text
)
returns table (
  applied boolean,
  wager_id uuid,
  team_id uuid,
  outcome text,
  wager_amount integer,
  new_score integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wager public.wagers%rowtype;
  v_team public.teams%rowtype;
  v_new_score integer;
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

  select w.* into v_wager
  from public.wagers as w
  where w.id = p_wager_id
    and w.room_id = p_room_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Final wager was not found in this room';
  end if;

  select t.* into v_team
  from public.teams as t
  where t.id = v_wager.team_id
    and t.room_id = p_room_id
  for update;

  if not found then
    raise exception using
      errcode = '22023',
      message = 'Final wager team does not belong to this room';
  end if;

  -- A retry after a lost response is a successful no-op. A conflicting second
  -- judgment is rejected so Correct and Wrong can never both change the score.
  if v_wager.status <> 'pending' then
    if v_wager.status::text <> p_outcome then
      raise exception using
        errcode = 'P0001',
        message = format('Final wager was already judged %s', v_wager.status::text);
    end if;

    return query select
      false,
      v_wager.id,
      v_wager.team_id,
      v_wager.status::text,
      v_wager.amount,
      v_team.score;
    return;
  end if;

  if not exists (
    select 1 from public.rooms as r
    where r.id = p_room_id
      and r.status = 'final_jeopardy'
  ) then
    raise exception using
      errcode = '55000',
      message = 'Final Jeopardy is no longer active';
  end if;

  if not v_team.is_active then
    raise exception using
      errcode = '22023',
      message = 'This team is not active in Final Jeopardy';
  end if;

  if v_wager.amount is null
    or v_wager.amount < 0
    or v_wager.amount > greatest(v_team.score, 0)
  then
    raise exception using
      errcode = '22023',
      message = 'Final wager is outside the allowed range';
  end if;

  update public.wagers
  set status = p_outcome::public.wager_status
  where id = v_wager.id;

  update public.teams
  set score = case
    when p_outcome = 'correct' then score + v_wager.amount
    else score - v_wager.amount
  end
  where id = v_team.id
  returning score into v_new_score;

  return query select
    true,
    v_wager.id,
    v_wager.team_id,
    p_outcome,
    v_wager.amount,
    v_new_score;
end;
$$;

revoke all on function public.judge_final_wager(uuid, uuid, text) from public, anon;
grant execute on function public.judge_final_wager(uuid, uuid, text) to authenticated;

commit;
