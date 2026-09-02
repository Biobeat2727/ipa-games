-- Atomic first-tap-wins question selection.
-- Run after add_columns.sql and host_auth_security.sql.
-- Requires the 'round_3' value in public.room_status (supabase/add_round_three_1_enum.sql,
-- run on its own first) — the function bodies below reference it and would fail at call time
-- on a database without it.

begin;

-- ── Shared round configuration (also defined in add_round_three_2_game_logic.sql) ───────
-- "Which board does this status play" and "what is the Double Tap floor for
-- this round" live here so every function agrees. Mirrors src/lib/rounds.ts.

create or replace function public.regular_round_number(p_status public.room_status)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
begin
  return case p_status
    when 'round_1' then 1
    when 'round_2' then 2
    when 'round_3' then 3
    else null
  end;
end;
$$;

create or replace function public.double_tap_floor(p_round integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_round
    when 3 then 3000
    when 2 then 2000
    else 500
  end;
$$;

revoke all on function public.regular_round_number(public.room_status) from public;
revoke all on function public.double_tap_floor(integer) from public;
grant execute on function public.regular_round_number(public.room_status) to anon, authenticated;
grant execute on function public.double_tap_floor(integer) to anon, authenticated;

alter table public.rooms
  add column if not exists pending_question_id uuid references public.questions(id) on delete set null,
  add column if not exists pending_selection_team_id uuid references public.teams(id) on delete set null,
  add column if not exists pending_selection_session_id text,
  add column if not exists pending_selection_claimed_at timestamptz,
  add column if not exists pending_selection_wager integer;

create or replace function public.claim_question_selection(
  p_room_id uuid,
  p_team_id uuid,
  p_question_id uuid,
  p_session_id text
)
returns table (
  accepted boolean,
  question_id uuid,
  selecting_team_id uuid,
  selector_session_id text,
  claimed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claimed public.rooms%rowtype;
  v_existing public.rooms%rowtype;
begin
  update public.rooms as r
  set pending_question_id = p_question_id,
      pending_selection_team_id = p_team_id,
      pending_selection_session_id = p_session_id,
      pending_selection_claimed_at = clock_timestamp(),
      pending_selection_wager = null
  where r.id = p_room_id
    and r.status in ('round_1', 'round_2', 'round_3')
    and r.current_question_id is null
    and r.pending_question_id is null
    and r.current_turn_team_id = p_team_id
    and exists (
      select 1
      from public.players as p
      where p.team_id = p_team_id
        and p.session_id = p_session_id
    )
    and exists (
      select 1
      from public.questions as q
      join public.categories as c on c.id = q.category_id
      where q.id = p_question_id
        and c.room_id = p_room_id
        -- The board for this status only. point_value is never null on a
        -- regular clue, so the Final Tap clue can never be claimed here even
        -- in a historical room that stored it as round 3.
        and c.round = public.regular_round_number(r.status)
        and q.point_value is not null
        and q.is_answered = false
    )
  returning r.* into v_claimed;

  if found then
    return query select
      true,
      v_claimed.pending_question_id,
      v_claimed.pending_selection_team_id,
      v_claimed.pending_selection_session_id,
      v_claimed.pending_selection_claimed_at;
    return;
  end if;

  select r.* into v_existing
  from public.rooms as r
  where r.id = p_room_id;

  return query select
    false,
    v_existing.pending_question_id,
    v_existing.pending_selection_team_id,
    v_existing.pending_selection_session_id,
    v_existing.pending_selection_claimed_at;
end;
$$;

revoke all on function public.claim_question_selection(uuid, uuid, uuid, text) from public;
grant execute on function public.claim_question_selection(uuid, uuid, uuid, text) to anon, authenticated;

create or replace function public.confirm_question_selection(
  p_room_id uuid,
  p_team_id uuid,
  p_question_id uuid,
  p_session_id text,
  p_wager integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.rooms as r
  set pending_selection_wager = p_wager,
      pending_selection_session_id = coalesce(r.pending_selection_session_id, p_session_id)
  where r.id = p_room_id
    and r.current_question_id is null
    and r.pending_question_id = p_question_id
    and r.pending_selection_team_id = p_team_id
    and (
      r.pending_selection_session_id = p_session_id
      or (
        -- Host-assigned DT: no owning session yet — any player on the assigned
        -- team may claim it. pending_selection_wager is null guards first-wins.
        r.pending_selection_session_id is null
        and exists (
          select 1
          from public.players as p
          where p.team_id = p_team_id
            and p.session_id = p_session_id
        )
      )
    )
    and r.pending_selection_wager is null
    and exists (
      select 1
      from public.teams as t
      join public.questions as q on q.id = p_question_id
      where t.id = p_team_id
        and t.room_id = p_room_id
        and q.is_double_tap = true
        and p_wager between 5 and greatest(
          t.score,
          public.double_tap_floor(public.regular_round_number(r.status))
        )
    );

  return found;
end;
$$;

revoke all on function public.confirm_question_selection(uuid, uuid, uuid, text, integer) from public;
grant execute on function public.confirm_question_selection(uuid, uuid, uuid, text, integer) to anon, authenticated;

commit;
