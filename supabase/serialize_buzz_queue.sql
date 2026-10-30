-- Exact buzz queue positions.
-- claim_buzz used to count "buzzes at or before mine" inside the same
-- transaction that inserted the buzz. Teams tapping at the shared reveal instant
-- could not see each other's uncommitted rows, so several phones were told
-- "1st" while the host (which reads after commit) showed the real order.
--
-- Fix: take a per-clue lock before inserting, and stamp buzzed_at only once the
-- lock is held. Buzzes on one clue are now recorded one at a time, so each
-- phone's count sees every earlier buzz, and buzzed_at order (which the host
-- and projector sort by) matches the order the positions were handed out.
-- The lock is held for a single insert + count — a few milliseconds.
--
-- Supersedes claim_buzz from phase_a_1_functions.sql (that file has been
-- updated to match for fresh installs). Safe to run between or during games;
-- no app deploy needed. Run in the Supabase SQL editor.

begin;

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

  -- One buzz at a time per clue. Released at commit, after which the next
  -- waiting buzz's count (a fresh snapshot) includes this one.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('claim_buzz:' || p_question_id::text, 0)
  );

  -- Stamped under the lock (not the transaction-start default), so buzzed_at
  -- order is exactly the order positions were assigned.
  insert into public.buzzes (question_id, team_id, status, buzzed_at)
  values (p_question_id, v_team_id, 'pending', clock_timestamp())
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

commit;
