-- Tapped In! mailing list: players opt in with their email on the end-of-game
-- screen; the host downloads the list as CSV from the host lobby / game-over
-- screen and imports it into whatever email tool they use.
-- Run after host_auth_security.sql (needs public.is_authorized_host).
--
-- Players never touch the table directly. Sign-ups go through
-- public.join_mailing_list(), which validates and lowercases the address and
-- silently ignores one that's already on the list, so the form can't be used
-- to probe who has signed up. There is no anon read policy at all: only an
-- authorized host (signed in) can read the list.
--
-- Run this in the Supabase SQL editor BEFORE deploying the build with the
-- sign-up form. Until it is applied the form shows "couldn't sign you up" and
-- nothing else in the game is affected.

begin;

create table if not exists public.mailing_list (
  id uuid primary key default gen_random_uuid(),
  -- Stored lowercased + trimmed; unique so a repeat sign-up is a no-op
  email text not null unique,
  -- Where they signed up (denormalized team name survives room cleanup)
  room_id uuid references public.rooms(id) on delete set null,
  team_name text,
  created_at timestamptz not null default now()
);

alter table public.mailing_list enable row level security;

drop policy if exists "hosts read the mailing list" on public.mailing_list;
create policy "hosts read the mailing list"
on public.mailing_list for select to authenticated
using (public.is_authorized_host());

create or replace function public.join_mailing_list(
  p_email text,
  p_room_id uuid default null,
  p_team_name text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if char_length(v_email) not between 6 and 254
     or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception using
      errcode = '22023',
      message = 'That doesn''t look like an email address';
  end if;

  insert into public.mailing_list (email, room_id, team_name)
  values (
    v_email,
    -- Ignore a room id that no longer exists rather than failing the sign-up
    (select r.id from public.rooms as r where r.id = p_room_id),
    left(nullif(btrim(coalesce(p_team_name, '')), ''), 100)
  )
  on conflict (email) do nothing;
end;
$$;

revoke all on function public.join_mailing_list(text, uuid, text) from public;
grant execute on function public.join_mailing_list(text, uuid, text) to anon, authenticated;

create index if not exists mailing_list_created_at_idx on public.mailing_list (created_at desc);

commit;

-- Verify (expect one row each):
--   select proname, prosecdef from pg_proc where proname = 'join_mailing_list';
--   select count(*) from public.mailing_list;
