-- Phase B: host moderation — remove / block / unblock players and teams, rename teams.
--
-- Run after phase_a_1_functions.sql (and phase_a_2_lockdown.sql). Additive and safe
-- to re-run. Supersedes join_team and create_team from phase_a_1_functions.sql
-- (same bodies plus the block check). Plan: docs/host-moderation-plan.md
--
-- Remove = off the team, free to rejoin (for people who left).
-- Block  = off the team and refused by join_team / create_team for the rest of
--          this game (room). Unblock lifts it. Blocks are per phone (device id),
--          so a private tab gets around one: a speed bump, not a ban.

begin;

-- ── Blocks ──────────────────────────────────────────────────────────────────
create table if not exists public.room_blocks (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  device_id text not null,
  nickname text,
  team_name text,
  blocked_at timestamptz not null default now(),
  unique (room_id, device_id)
);

alter table public.room_blocks enable row level security;
revoke all on public.room_blocks from public, anon;
grant select on public.room_blocks to authenticated;

drop policy if exists "hosts read their blocks" on public.room_blocks;
create policy "hosts read their blocks"
on public.room_blocks for select to authenticated
using (public.host_owns_room(room_id));

create or replace function public.assert_device_not_blocked(p_device_id text, p_room_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.room_blocks as b
    where b.room_id = p_room_id and b.device_id = p_device_id
  ) then
    -- The phone shows its "removed from this game" screen on this message.
    raise exception using errcode = '42501', message = 'You have been removed from this game';
  end if;
end;
$$;

revoke all on function public.assert_device_not_blocked(text, uuid) from public, anon, authenticated;

-- Joins and blocks for the same phone in the same room take this transaction
-- lock first, so a join can't check "not blocked", lose the race to a block, and
-- then save its seat anyway.
create or replace function public.lock_room_device(p_room_id uuid, p_device_id text)
returns void
language sql
security definer
set search_path = ''
as $$
  select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_room_id::text || ':' || p_device_id, 0));
$$;

revoke all on function public.lock_room_device(uuid, text) from public, anon, authenticated;

-- Host owns the room and the roster may change now. Same moments kick_team
-- refuses (and the host UI greys its buttons out): a clue live or pending, the
-- Final Tap question/review, or the game over.
create or replace function public.assert_roster_change_allowed(p_room_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_room public.rooms%rowtype;
begin
  if not public.host_owns_room(p_room_id) then
    raise exception using errcode = '42501', message = 'Host is not authorized for this room';
  end if;

  select r.* into v_room from public.rooms as r where r.id = p_room_id;

  if v_room.status = 'finished' then
    raise exception using errcode = '55000', message = 'The game is already over';
  end if;

  if v_room.current_question_id is not null or v_room.pending_question_id is not null then
    raise exception using errcode = '55000', message = 'Finish or clear the current clue first';
  end if;

  if v_room.status = 'final_jeopardy' and v_room.final_phase in ('question', 'review') then
    raise exception using errcode = '55000', message = 'Wait until the Final Tap review is done';
  end if;
end;
$$;

revoke all on function public.assert_roster_change_allowed(uuid) from public, anon, authenticated;

-- ── Phones: join / create refuse blocked devices ────────────────────────────

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

  perform public.lock_room_device(v_room_id, p_device_id);
  perform public.assert_device_not_blocked(p_device_id, v_room_id);

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
  perform public.assert_device_not_blocked(p_device_id, p_room_id);

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

-- ── Host actions ────────────────────────────────────────────────────────────

-- Remove one player's seat. They can rejoin any team.
create or replace function public.host_remove_player(p_player_id uuid)
returns table (team_id uuid, device_id text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_player public.players%rowtype;
  v_room_id uuid;
begin
  select p.* into v_player from public.players as p where p.id = p_player_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Player was not found';
  end if;

  select t.room_id into v_room_id from public.teams as t where t.id = v_player.team_id;
  perform public.assert_roster_change_allowed(v_room_id);

  delete from public.players as p where p.id = p_player_id;

  return query select v_player.team_id, v_player.session_id::text;  -- column is varchar
end;
$$;

revoke all on function public.host_remove_player(uuid) from public, anon;
grant execute on function public.host_remove_player(uuid) to authenticated;

-- Block one player's phone for the rest of the game and take every seat it
-- holds in this room.
create or replace function public.host_block_player(p_player_id uuid)
returns table (team_id uuid, device_id text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_player public.players%rowtype;
  v_team public.teams%rowtype;
begin
  select p.* into v_player from public.players as p where p.id = p_player_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Player was not found';
  end if;

  select t.* into v_team from public.teams as t where t.id = v_player.team_id;
  perform public.assert_roster_change_allowed(v_team.room_id);
  perform public.lock_room_device(v_team.room_id, v_player.session_id);

  insert into public.room_blocks (room_id, device_id, nickname, team_name)
  values (v_team.room_id, v_player.session_id, v_player.nickname, v_team.name)
  on conflict (room_id, device_id) do nothing;

  delete from public.players as p
  using public.teams as t
  where t.id = p.team_id
    and t.room_id = v_team.room_id
    and p.session_id = v_player.session_id;

  return query select v_player.team_id, v_player.session_id::text;  -- column is varchar
end;
$$;

revoke all on function public.host_block_player(uuid) from public, anon;
grant execute on function public.host_block_player(uuid) to authenticated;

-- Block every phone on a team, then remove the team (kick_team). Returns what
-- kick_team returns plus the blocked device ids, for the host's broadcast.
create or replace function public.host_block_team(p_team_id uuid)
returns table (room_id uuid, turn_cleared boolean, blocked_devices text[])
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_team public.teams%rowtype;
  v_devices text[];
begin
  select t.* into v_team from public.teams as t where t.id = p_team_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Team was not found';
  end if;

  perform public.assert_roster_change_allowed(v_team.room_id);

  select coalesce(array_agg(distinct p.session_id::text order by p.session_id::text), '{}') into v_devices
  from public.players as p
  where p.team_id = p_team_id;

  perform public.lock_room_device(v_team.room_id, d)
  from unnest(v_devices) as d;

  insert into public.room_blocks (room_id, device_id, nickname, team_name)
  select v_team.room_id, p.session_id, p.nickname, v_team.name
  from public.players as p
  where p.team_id = p_team_id
  on conflict (room_id, device_id) do nothing;

  -- Seats these phones hold on any other team in this room go too (kick_team
  -- below only clears this team's).
  delete from public.players as p
  using public.teams as t
  where t.id = p.team_id
    and t.room_id = v_team.room_id
    and p.team_id <> p_team_id
    and p.session_id = any (v_devices);

  return query
    select k.room_id, k.turn_cleared, v_devices
    from public.kick_team(p_team_id) as k;
end;
$$;

revoke all on function public.host_block_team(uuid) from public, anon;
grant execute on function public.host_block_team(uuid) to authenticated;

-- Lift a block. Allowed any time (fixing a misclick shouldn't wait for a clue).
create or replace function public.host_unblock(p_block_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_block public.room_blocks%rowtype;
begin
  select b.* into v_block from public.room_blocks as b where b.id = p_block_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Block was not found';
  end if;

  if not public.host_owns_room(v_block.room_id) then
    raise exception using errcode = '42501', message = 'Host is not authorized for this room';
  end if;

  delete from public.room_blocks as b where b.id = p_block_id;
  return v_block.device_id;
end;
$$;

revoke all on function public.host_unblock(uuid) from public, anon;
grant execute on function public.host_unblock(uuid) to authenticated;

-- Rename a team (any time). Same rules as create_team: 1-40 characters, unique
-- in the room ignoring case.
create or replace function public.host_rename_team(p_team_id uuid, p_name text)
returns setof public.teams
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_team public.teams%rowtype;
begin
  select t.* into v_team from public.teams as t where t.id = p_team_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Team was not found';
  end if;

  if not public.host_owns_room(v_team.room_id) then
    raise exception using errcode = '42501', message = 'Host is not authorized for this room';
  end if;

  if v_name = '' or length(v_name) > 40 then
    raise exception using errcode = '22023', message = 'Team name must be 1 to 40 characters';
  end if;

  if exists (
    select 1 from public.teams as t
    where t.room_id = v_team.room_id
      and t.id <> p_team_id
      and lower(btrim(t.name)) = lower(v_name)
  ) then
    raise exception using errcode = '23505', message = 'Another team already has that name';
  end if;

  update public.teams as t set name = v_name where t.id = p_team_id
  returning t.* into v_team;

  return next v_team;
end;
$$;

revoke all on function public.host_rename_team(uuid, text) from public, anon;
grant execute on function public.host_rename_team(uuid, text) to authenticated;

commit;
