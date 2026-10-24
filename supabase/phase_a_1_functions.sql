-- Phase A, step 1 of 2: device keys and player-side functions (additive).
--
-- Every phone action (join/create/leave a team, buzz, answer, wager, pick a clue,
-- confirm a Double Tap wager, answer the Final) gets a function that proves the
-- phone's private device key and derives its team from its own seat. Nothing is
-- closed yet: the open table policies stay until phase_a_2_lockdown.sql, so the
-- currently deployed app keeps working after this runs.
--
-- Run after add_round_three_2_game_logic.sql, persist_final_tap_state.sql and
-- server_authoritative_final_responses.sql. Safe to re-run.
-- join_team and create_team are superseded by phase_b_moderation.sql (adds the
-- block check). Re-running this file after Phase B would drop that check, so
-- re-run phase_b_moderation.sql afterwards if you ever do.
-- Plan: docs/phase-a-lockdown-plan.md

begin;

-- ── Device keys ─────────────────────────────────────────────────────────────
-- A phone holds a random device id (public: it is stored in players.session_id
-- and rooms.pending_selection_session_id) and a random secret that never leaves
-- the phone. Only a SHA-256 of the secret is stored. The id is generated fresh
-- for this scheme, so it cannot be read anywhere before its first call registers
-- it; after that, acting as the device requires the secret.

create table if not exists public.player_devices (
  device_id text primary key,
  secret_hash bytea not null,
  created_at timestamptz not null default now()
);

alter table public.player_devices enable row level security;
revoke all on public.player_devices from public, anon, authenticated;

create or replace function public.verify_player_device(p_device_id text, p_device_secret text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash bytea;
  v_stored bytea;
begin
  if p_device_id is null or length(p_device_id) <> 36
    or p_device_secret is null or length(p_device_secret) <> 64 then
    raise exception using errcode = '28000', message = 'Device key is missing or malformed';
  end if;

  -- The secret is 256 random bits, so a fast hash is enough (no password stretching).
  v_hash := pg_catalog.sha256(pg_catalog.convert_to(p_device_secret, 'UTF8'));

  -- First use registers the id — but never an id that was already public before
  -- keys existed (a pre-key session id on an old seat or pending pick): anyone
  -- could read those and claim them first. New phones always register on their
  -- first call, before they hold any seat, so this never blocks them.
  if not exists (select 1 from public.player_devices as d where d.device_id = p_device_id)
    and (
      exists (select 1 from public.players as p where p.session_id = p_device_id)
      or exists (select 1 from public.rooms as r where r.pending_selection_session_id = p_device_id)
    ) then
    raise exception using errcode = '28000', message = 'Device id predates device keys';
  end if;

  insert into public.player_devices (device_id, secret_hash)
  values (p_device_id, v_hash)
  on conflict (device_id) do nothing;

  select d.secret_hash into v_stored
  from public.player_devices as d
  where d.device_id = p_device_id;

  if v_stored is distinct from v_hash then
    raise exception using errcode = '28000', message = 'Device key does not match';
  end if;
end;
$$;

revoke all on function public.verify_player_device(text, text) from public, anon, authenticated;

-- The device's seat (team) in a room, or null. A device holds at most one seat
-- per room: join/create retire the others.
create or replace function public.device_team_in_room(p_device_id text, p_room_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.team_id
  from public.players as p
  join public.teams as t on t.id = p.team_id
  where p.session_id = p_device_id
    and t.room_id = p_room_id
  order by p.created_at desc
  limit 1;
$$;

revoke all on function public.device_team_in_room(text, uuid) from public, anon, authenticated;

-- ── Teams and seats ─────────────────────────────────────────────────────────

-- Take a seat on a team (idempotent) and retire this device's other seats in the
-- same room. Seats from earlier games are kept (attendance history).
create or replace function public.join_team(
  p_team_id uuid,
  p_nickname text,
  p_device_id text,
  p_device_secret text
)
returns setof public.players
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room_id uuid;
  v_player public.players%rowtype;
begin
  perform public.verify_player_device(p_device_id, p_device_secret);

  if length(coalesce(p_nickname, '')) > 40 then
    raise exception using errcode = '22023', message = 'Nickname is too long';
  end if;

  select t.room_id into v_room_id
  from public.teams as t
  where t.id = p_team_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'Team was not found';
  end if;

  select p.* into v_player
  from public.players as p
  where p.team_id = p_team_id
    and p.session_id = p_device_id
  limit 1;

  if not found then
    insert into public.players (team_id, session_id, nickname)
    values (p_team_id, p_device_id, nullif(btrim(p_nickname), ''))
    returning * into v_player;
  end if;

  delete from public.players as p
  using public.teams as t
  where t.id = p.team_id
    and t.room_id = v_room_id
    and p.session_id = p_device_id
    and p.team_id <> p_team_id;

  return next v_player;
end;
$$;

revoke all on function public.join_team(uuid, text, text, text) from public;
grant execute on function public.join_team(uuid, text, text, text) to anon, authenticated;

-- Create a team and take its first seat in one step. The phone supplies the team
-- id, so a retry after a lost response finds the same team instead of making an
-- orphan (the host's empty-team sweep may have removed it; then it is recreated).
create or replace function public.create_team(
  p_room_id uuid,
  p_team_id uuid,
  p_name text,
  p_nickname text,
  p_device_id text,
  p_device_secret text
)
returns setof public.teams
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_team public.teams%rowtype;
begin
  perform public.verify_player_device(p_device_id, p_device_secret);

  if v_name = '' or length(v_name) > 40 then
    raise exception using errcode = '22023', message = 'Team name must be 1 to 40 characters';
  end if;

  select t.* into v_team
  from public.teams as t
  where t.id = p_team_id;

  if found then
    if v_team.room_id <> p_room_id or btrim(v_team.name) <> v_name then
      raise exception using errcode = '22023', message = 'Team id is already in use';
    end if;
  else
    -- Same window as the old "players create teams before final" policy.
    if not exists (
      select 1 from public.rooms as r
      where r.id = p_room_id
        and r.status in ('lobby', 'round_1', 'round_2', 'round_3')
    ) then
      raise exception using errcode = '55000', message = 'Teams cannot be created right now';
    end if;

    if exists (
      select 1 from public.teams as t
      where t.room_id = p_room_id
        and lower(btrim(t.name)) = lower(v_name)
    ) then
      raise exception using errcode = '23505', message = 'Team name is already taken';
    end if;

    insert into public.teams (id, room_id, name)
    values (p_team_id, p_room_id, v_name)
    returning * into v_team;
  end if;

  perform public.join_team(v_team.id, p_nickname, p_device_id, p_device_secret);

  return next v_team;
end;
$$;

revoke all on function public.create_team(uuid, uuid, text, text, text, text) from public;
grant execute on function public.create_team(uuid, uuid, text, text, text, text) to anon, authenticated;

-- Leave a team (or, with a null team, every seat this device holds — the old
-- client behavior). Returns the number of seats removed.
create or replace function public.leave_team(
  p_team_id uuid,
  p_device_id text,
  p_device_secret text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform public.verify_player_device(p_device_id, p_device_secret);

  delete from public.players as p
  where p.session_id = p_device_id
    and (p_team_id is null or p.team_id = p_team_id);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.leave_team(uuid, text, text) from public;
grant execute on function public.leave_team(uuid, text, text) to anon, authenticated;

-- ── Buzzing and answering ───────────────────────────────────────────────────

-- One round trip: claim (or find) this device's team buzz on the live clue and
-- return its queue position. buzzed_at stays the database default and the
-- deadline trigger still stamps response_deadline_at, exactly as a direct insert.
create or replace function public.claim_buzz(
  p_question_id uuid,
  p_device_id text,
  p_device_secret text
)
returns table (
  buzz_id uuid,
  team_id uuid,
  buzzed_at timestamptz,
  response_deadline_at timestamptz,
  created boolean,
  queue_position integer
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_room_id uuid;
  v_team_id uuid;
  v_buzz public.buzzes%rowtype;
  v_created boolean := false;
  v_position integer;
begin
  perform public.verify_player_device(p_device_id, p_device_secret);

  select c.room_id into v_room_id
  from public.questions as q
  join public.categories as c on c.id = q.category_id
  where q.id = p_question_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'Question was not found';
  end if;

  if not exists (
    select 1 from public.rooms as r
    where r.id = v_room_id and r.current_question_id = p_question_id
  ) then
    raise exception using errcode = '55000', message = 'That clue is not live';
  end if;

  -- A regular clue's buzzer opens at the host's shared reveal instant
  -- (buzz_opened_at, written with current_question_id). 150ms of slack covers
  -- clock differences; nobody can see the button light and tap that fast.
  -- Double Tap has no buzz window: the selecting team auto-buzzes at once.
  if not exists (
    select 1
    from public.rooms as r
    join public.questions as q on q.id = p_question_id
    where r.id = v_room_id
      and (
        coalesce(q.is_double_tap, false)
        or (r.buzz_opened_at is not null
            and clock_timestamp() >= r.buzz_opened_at - interval '150 milliseconds')
      )
  ) then
    raise exception using errcode = '55000', message = 'The buzzer is not open yet';
  end if;

  v_team_id := public.device_team_in_room(p_device_id, v_room_id);
  if v_team_id is null then
    raise exception using errcode = '42501', message = 'This phone is not on a team in this game';
  end if;

  insert into public.buzzes (question_id, team_id, status)
  values (p_question_id, v_team_id, 'pending')
  on conflict (question_id, team_id) do nothing
  returning * into v_buzz;

  if found then
    v_created := true;
  else
    select b.* into v_buzz
    from public.buzzes as b
    where b.question_id = p_question_id
      and b.team_id = v_team_id;
  end if;

  select count(*)::integer into v_position
  from public.buzzes as b
  where b.question_id = p_question_id
    and b.buzzed_at <= v_buzz.buzzed_at;

  return query select
    v_buzz.id, v_buzz.team_id, v_buzz.buzzed_at, v_buzz.response_deadline_at,
    v_created, v_position;
end;
$$;

revoke all on function public.claim_buzz(uuid, text, text) from public;
grant execute on function public.claim_buzz(uuid, text, text) to anon, authenticated;

-- Submit the team's typed answer on its own buzz. The deadline trigger still
-- rejects late, blank and second submissions with the same messages as before.
create or replace function public.submit_buzz_response(
  p_buzz_id uuid,
  p_response text,
  p_device_id text,
  p_device_secret text
)
returns table (
  accepted boolean,
  saved_response text,
  response_submitted_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_buzz public.buzzes%rowtype;
begin
  perform public.verify_player_device(p_device_id, p_device_secret);

  if length(coalesce(p_response, '')) > 500 then
    raise exception using errcode = '22023', message = 'Response is too long';
  end if;

  select b.* into v_buzz
  from public.buzzes as b
  where b.id = p_buzz_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'Buzz was not found';
  end if;

  if not exists (
    select 1 from public.players as p
    where p.team_id = v_buzz.team_id
      and p.session_id = p_device_id
  ) then
    raise exception using errcode = '42501', message = 'That buzz belongs to another team';
  end if;

  if v_buzz.response_submitted_at is not null then
    return query select false, v_buzz.response, v_buzz.response_submitted_at;
    return;
  end if;

  update public.buzzes as b
  set response = btrim(p_response),
      response_submitted_at = clock_timestamp()
  where b.id = p_buzz_id
    and b.response_submitted_at is null
  returning b.* into v_buzz;

  if not found then
    -- A teammate's submission landed between the read and the update.
    select b.* into v_buzz from public.buzzes as b where b.id = p_buzz_id;
    return query select false, v_buzz.response, v_buzz.response_submitted_at;
    return;
  end if;

  return query select true, v_buzz.response, v_buzz.response_submitted_at;
end;
$$;

revoke all on function public.submit_buzz_response(uuid, text, text, text) from public;
grant execute on function public.submit_buzz_response(uuid, text, text, text) to anon, authenticated;

-- ── Final Tap wagers ────────────────────────────────────────────────────────

-- Lock this device's team wager. Wagers lock before the clue is revealed: only
-- while final_phase is 'starting' or 'wager', for an active team, 0..score.
-- A second submission (teammate) returns the saved wager unchanged.
create or replace function public.submit_final_wager(
  p_room_id uuid,
  p_amount integer,
  p_device_id text,
  p_device_secret text
)
returns table (
  accepted boolean,
  wager_id uuid,
  team_id uuid,
  amount integer
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_team public.teams%rowtype;
  v_room public.rooms%rowtype;
  v_wager public.wagers%rowtype;
begin
  perform public.verify_player_device(p_device_id, p_device_secret);

  select t.* into v_team
  from public.teams as t
  where t.id = public.device_team_in_room(p_device_id, p_room_id);

  if not found or not v_team.is_active then
    raise exception using errcode = '42501', message = 'This phone is not on an active team in this game';
  end if;

  select w.* into v_wager
  from public.wagers as w
  where w.room_id = p_room_id and w.team_id = v_team.id;

  if found then
    return query select false, v_wager.id, v_wager.team_id, v_wager.amount;
    return;
  end if;

  select r.* into v_room from public.rooms as r where r.id = p_room_id;
  if v_room.status <> 'final_jeopardy'
    or coalesce(v_room.final_phase, 'starting') not in ('starting', 'wager') then
    raise exception using errcode = '55000', message = 'Final wagers are closed';
  end if;

  if p_amount is null or p_amount < 0 or p_amount > greatest(v_team.score, 0) then
    raise exception using errcode = '22023', message = 'Wager must be between 0 and your score';
  end if;

  insert into public.wagers (team_id, room_id, amount, status)
  values (v_team.id, p_room_id, p_amount, 'pending')
  on conflict (room_id, team_id) do nothing
  returning * into v_wager;

  if not found then
    select w.* into v_wager
    from public.wagers as w
    where w.room_id = p_room_id and w.team_id = v_team.id;
    return query select false, v_wager.id, v_wager.team_id, v_wager.amount;
    return;
  end if;

  return query select true, v_wager.id, v_wager.team_id, v_wager.amount;
end;
$$;

revoke all on function public.submit_final_wager(uuid, integer, text, text) from public;
grant execute on function public.submit_final_wager(uuid, integer, text, text) to anon, authenticated;

-- This device's own team wager (or no row).
create or replace function public.get_my_final_wager(
  p_room_id uuid,
  p_device_id text,
  p_device_secret text
)
returns table (
  wager_id uuid,
  team_id uuid,
  amount integer,
  response text,
  status text,
  submitted_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public.verify_player_device(p_device_id, p_device_secret);

  return query
    select w.id, w.team_id, w.amount, w.response, w.status::text, w.submitted_at
    from public.wagers as w
    where w.room_id = p_room_id
      and w.team_id = public.device_team_in_room(p_device_id, p_room_id);
end;
$$;

revoke all on function public.get_my_final_wager(uuid, text, text) from public;
grant execute on function public.get_my_final_wager(uuid, text, text) to anon, authenticated;

-- Public Final board (projector, phones): which teams have wagered / answered.
-- A team's answer is visible once the host is reviewing it or has judged it; its
-- wager and result once judged; everything once the game is finished.
create or replace function public.final_board(p_room_id uuid)
returns table (
  team_id uuid,
  has_wagered boolean,
  submitted boolean,
  amount integer,
  response text,
  status text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    w.team_id,
    true,
    w.submitted_at is not null,
    case when r.status = 'finished' or w.status::text <> 'pending' then w.amount end,
    case when r.status = 'finished' or w.status::text <> 'pending'
           or w.team_id = r.final_review_team_id then w.response end,
    case when r.status = 'finished' or w.status::text <> 'pending' then w.status::text end
  from public.wagers as w
  join public.rooms as r on r.id = w.room_id
  where w.room_id = p_room_id;
$$;

revoke all on function public.final_board(uuid) from public;
grant execute on function public.final_board(uuid) to anon, authenticated;

-- ── Existing phone functions, now key-checked ───────────────────────────────
-- New overloads with a trailing p_device_secret. They verify the key, then run
-- the existing logic (security definer, so they keep calling the old versions
-- after phase_a_2_lockdown.sql revokes those from phones).

create or replace function public.claim_question_selection(
  p_room_id uuid,
  p_team_id uuid,
  p_question_id uuid,
  p_session_id text,
  p_device_secret text
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
begin
  perform public.verify_player_device(p_session_id, p_device_secret);
  return query select * from public.claim_question_selection(p_room_id, p_team_id, p_question_id, p_session_id);
end;
$$;

revoke all on function public.claim_question_selection(uuid, uuid, uuid, text, text) from public;
grant execute on function public.claim_question_selection(uuid, uuid, uuid, text, text) to anon, authenticated;

create or replace function public.confirm_question_selection(
  p_room_id uuid,
  p_team_id uuid,
  p_question_id uuid,
  p_session_id text,
  p_wager integer,
  p_device_secret text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.verify_player_device(p_session_id, p_device_secret);
  return public.confirm_question_selection(p_room_id, p_team_id, p_question_id, p_session_id, p_wager);
end;
$$;

revoke all on function public.confirm_question_selection(uuid, uuid, uuid, text, integer, text) from public;
grant execute on function public.confirm_question_selection(uuid, uuid, uuid, text, integer, text) to anon, authenticated;

create or replace function public.submit_final_response(
  p_room_id uuid,
  p_team_id uuid,
  p_session_id text,
  p_response text,
  p_device_secret text
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
begin
  perform public.verify_player_device(p_session_id, p_device_secret);
  return query select * from public.submit_final_response(p_room_id, p_team_id, p_session_id, p_response);
end;
$$;

revoke all on function public.submit_final_response(uuid, uuid, text, text, text) from public;
grant execute on function public.submit_final_response(uuid, uuid, text, text, text) to anon, authenticated;

-- ── Clue text stays hidden until it is played ──────────────────────────────
-- Same columns as before; `answer` (the clue) is null until the clue is
-- revealed (a regular clue at its buzz_opened_at instant, a Double Tap once live),
-- answered, or (Final) revealed by the host. Correct responses were never here.
create or replace view public.questions_public as
select
  q.id,
  q.category_id,
  case
    when q.is_answered
      or (r.current_question_id = q.id
          and (coalesce(q.is_double_tap, false)
               or (r.buzz_opened_at is not null
                   and now() >= r.buzz_opened_at - interval '150 milliseconds')))
      or (r.final_question_id = q.id and r.final_phase in ('question', 'review', 'done'))
      or r.status = 'finished'
    then q.answer
  end as answer,
  q.point_value,
  q.is_answered,
  q.answered_by_team_id,
  q.is_double_tap
from public.questions as q
join public.categories as c on c.id = q.category_id
join public.rooms as r on r.id = c.room_id;

grant select on public.questions_public to anon, authenticated;

commit;
