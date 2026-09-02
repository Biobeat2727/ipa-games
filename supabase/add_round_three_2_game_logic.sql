-- Round 3 migration — STEP 2 of 2: game logic that references 'round_3'.
--
-- PREREQUISITE: supabase/add_round_three_1_enum.sql has already been run AS ITS OWN
-- QUERY and succeeded. This file references the 'round_3' enum value in a policy
-- and in function bodies; if the value is not yet committed PostgreSQL raises
--     ERROR 55P04: unsafe use of new value "round_3" of enum type room_status
-- (the Supabase SQL editor runs each submission as one transaction, which is why
-- the ADD VALUE lives in a separate file).
--
-- DEPLOYMENT ORDER (important):
--   1. Run add_round_three_1_enum.sql (alone), then this file.
--   2. Then deploy the frontend that emits status = 'round_3' and stores new
--      Final Tap categories as round 4 (src/lib/rounds.ts).
--   A frontend that writes 'round_3' against a database without these two files
--   fails at the Round 2 → Round 3 transition ("invalid input value for enum").
--   The old frontend keeps working after the migration (it never emits round_3
--   and round_2 → final_jeopardy is untouched), so apply it between games, never
--   mid-game, and roll back only between games as well.
--
-- What changes:
--   * claim_question_selection / judge_buzz accept round_3 and map it ONLY to
--     categories with round = 3 that hold real (non-null) point values.
--   * confirm_question_selection / judge_buzz use one shared Double Tap floor
--     table: 1000 / 2000 / 3000 for rounds 1 / 2 / 3 (mirrors DOUBLE_TAP_FLOORS
--     in src/lib/rounds.ts — change both together).
--   * Late team creation is allowed through round_3 and still refused in
--     final_jeopardy (eligibility is computed at the round_3 → Final transition).
--   * reveal_final_question identifies the Final clue by room ownership and a
--     null point_value instead of "c.round = 3" (round 3 is now a real board;
--     new imports store Final Tap as round 4, historical rooms still have it as
--     round 3 — both keep working).
--
-- The whole file is idempotent and runs in a single transaction: re-running it
-- is safe, and a failure part-way leaves the previous definitions in place.

begin;

-- ── Shared round configuration ─────────────────────────────────────────────
-- One place for "which board does this status play" and "what is the Double
-- Tap floor for this round". plpgsql (not sql) so the body is compiled lazily
-- and never evaluates the enum literal while this transaction is still open.

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

-- Double Tap ceiling floor per regular round. A team may wager up to
-- greatest(score, floor). Values set 2026-09-02: 1000 / 2000 / 3000. Keep
-- src/lib/rounds.ts DOUBLE_TAP_FLOORS in sync; re-run this file after a change.
create or replace function public.double_tap_floor(p_round integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_round
    when 3 then 3000
    when 2 then 2000
    else 1000
  end;
$$;

revoke all on function public.regular_round_number(public.room_status) from public;
revoke all on function public.double_tap_floor(integer) from public;
grant execute on function public.regular_round_number(public.room_status) to anon, authenticated;
grant execute on function public.double_tap_floor(integer) to anon, authenticated;

-- ── Atomic clue selection (supersedes atomic_question_selection.sql) ────────

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

-- ── Double Tap wager confirmation (supersedes host_assigned_double_tap.sql) ─

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

-- ── Atomic host judgment (supersedes atomic_buzz_judgment.sql) ──────────────

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
      and r.status in ('round_1', 'round_2', 'round_3')
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
    v_max_wager := greatest(v_team.score, public.double_tap_floor(v_round));
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

-- ── Late team creation through Round 3 (supersedes allow_late_join.sql) ─────
-- Final Tap stays excluded: eligibility and wagers are computed at the
-- round_3 → final_jeopardy transition, so a team appearing after that point
-- would sit in the final without a wager.

drop policy if exists "players create teams during lobby" on public.teams;
drop policy if exists "players create teams before final" on public.teams;

create policy "players create teams before final"
on public.teams for insert to anon, authenticated
with check (
  exists (
    select 1 from public.rooms
    where rooms.id = teams.room_id
      and rooms.status in ('lobby', 'round_1', 'round_2', 'round_3')
  )
);

-- ── Final clue reveal (supersedes reveal_final_question in persist_final_tap_state.sql)

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

  -- The Final clue is the room's wager-scored question (null point_value). This
  -- holds for new imports (category round 4) and historical rooms (round 3)
  -- alike, and can never match a Round 3 board clue.
  if not exists (
    select 1
    from public.questions as q
    join public.categories as c on c.id = q.category_id
    where q.id = p_question_id
      and c.room_id = p_room_id
      and q.point_value is null
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

commit;

-- ───────────────────────────────────────────────────────────────────────────
-- VERIFY (run after COMMIT; each should match the expectation in the comment)
-- ───────────────────────────────────────────────────────────────────────────
-- 1. Enum contains round_3 (from step 1):
--   select enum_range(null::public.room_status);
--   -- {lobby,round_1,round_2,round_3,final_jeopardy,finished}
--
-- 2. Shared configuration answers correctly (aliases matter: the Supabase results
--    grid keys columns by name, so unaliased duplicates overwrite each other):
--   select public.regular_round_number('round_3'::public.room_status)        as r3_round,
--          public.regular_round_number('final_jeopardy'::public.room_status) as final_round,
--          public.double_tap_floor(1) as floor_r1,
--          public.double_tap_floor(2) as floor_r2,
--          public.double_tap_floor(3) as floor_r3;
--   -- 3, null, 1000, 2000, 3000
--
-- 3. Selection + judgment accept round_3 and use the shared floor:
--   select pg_get_functiondef('public.claim_question_selection(uuid,uuid,uuid,text)'::regprocedure)
--     ~ 'round_3' as claim_ok,
--          pg_get_functiondef('public.judge_buzz(uuid,uuid,text,integer)'::regprocedure)
--     ~ 'double_tap_floor' as judge_ok,
--          pg_get_functiondef('public.confirm_question_selection(uuid,uuid,uuid,text,integer)'::regprocedure)
--     ~ 'double_tap_floor' as confirm_ok;
--   -- true, true, true
--
-- 4. Exactly one team-insert policy, and it lists round_3 but not final_jeopardy:
--   select polname, pg_get_expr(polwithcheck, polrelid) as with_check
--   from pg_policy
--   where polrelid = 'public.teams'::regclass and polcmd = 'a';
--   -- one row: "players create teams before final", … in ('lobby','round_1','round_2','round_3')
--
-- 5. Final reveal no longer depends on c.round = 3:
--   select pg_get_functiondef('public.reveal_final_question(uuid,uuid)'::regprocedure)
--     ~ 'point_value is null' as reveal_ok;
--   -- true
--
-- 6. Security posture preserved (all security definer, empty search_path):
--   select proname, prosecdef, proconfig
--   from pg_proc
--   where pronamespace = 'public'::regnamespace
--     and proname in ('claim_question_selection','confirm_question_selection','judge_buzz','reveal_final_question');
--   -- prosecdef = true, proconfig = {search_path=} for every row
--
-- ROLLBACK (between games only, after reverting the frontend):
--   Re-run, in this order, the previous canonical definitions:
--     supabase/atomic_question_selection.sql (pre-Round-3 version from git),
--     supabase/host_assigned_double_tap.sql, supabase/atomic_buzz_judgment.sql,
--     supabase/allow_late_join.sql, supabase/persist_final_tap_state.sql.
--   PostgreSQL cannot drop an enum value; leaving 'round_3' in room_status is
--   harmless because the old frontend never emits it. Rooms created by the new
--   frontend store Final Tap as round 4 — the old code (round = 3 lookup) will
--   not find those; finish or discard such rooms before rolling back.
