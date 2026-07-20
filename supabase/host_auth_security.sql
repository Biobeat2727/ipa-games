-- Priority 1 security: authenticated, explicitly approved hosts.
-- Review and run this migration in the Supabase SQL editor before deploying the
-- matching host UI. Existing rooms are preserved, but a signed-in host only sees
-- rooms whose host_id matches their auth.users id.

begin;

create table if not exists public.authorized_hosts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.authorized_hosts enable row level security;
alter table public.rooms enable row level security;
alter table public.teams enable row level security;
alter table public.categories enable row level security;
alter table public.questions enable row level security;
alter table public.players enable row level security;
alter table public.buzzes enable row level security;
alter table public.wagers enable row level security;

-- SECURITY DEFINER keeps ownership checks reliable without opening room rows to
-- mutation. Both helpers have a fixed search_path to prevent object shadowing.
create or replace function public.is_authorized_host()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.authorized_hosts
    where user_id = (select auth.uid())
      and is_active = true
  );
$$;

create or replace function public.host_owns_room(target_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_authorized_host()
    and exists (
      select 1
      from public.rooms
      where id = target_room_id
        and host_id = (select auth.uid())
    );
$$;

revoke all on function public.is_authorized_host() from public;
revoke all on function public.host_owns_room(uuid) from public;
grant execute on function public.is_authorized_host() to authenticated;
grant execute on function public.host_owns_room(uuid) to authenticated;

-- Replace any earlier broad policies on the tables whose writes must be host-only.
do $$
declare
  policy_record record;
begin
  for policy_record in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('authorized_hosts', 'rooms', 'teams', 'categories', 'questions')
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      policy_record.policyname,
      policy_record.schemaname,
      policy_record.tablename
    );
  end loop;
end $$;

create policy "hosts can read their approval"
on public.authorized_hosts for select to authenticated
using (user_id = (select auth.uid()));

create policy "rooms are publicly readable"
on public.rooms for select to anon, authenticated
using (true);

create policy "approved hosts create their rooms"
on public.rooms for insert to authenticated
with check (
  public.is_authorized_host()
  and host_id = (select auth.uid())
);

create policy "hosts update their rooms"
on public.rooms for update to authenticated
using (public.is_authorized_host() and host_id = (select auth.uid()))
with check (public.is_authorized_host() and host_id = (select auth.uid()));

create policy "hosts delete their rooms"
on public.rooms for delete to authenticated
using (public.is_authorized_host() and host_id = (select auth.uid()));

create policy "teams are publicly readable"
on public.teams for select to anon, authenticated
using (true);

create policy "players create teams during lobby"
on public.teams for insert to anon, authenticated
with check (
  exists (
    select 1 from public.rooms
    where rooms.id = teams.room_id
      and rooms.status = 'lobby'
  )
);

create policy "hosts update their teams"
on public.teams for update to authenticated
using (public.host_owns_room(room_id))
with check (public.host_owns_room(room_id));

create policy "hosts delete their teams"
on public.teams for delete to authenticated
using (public.host_owns_room(room_id));

create policy "categories are publicly readable"
on public.categories for select to anon, authenticated
using (true);

create policy "hosts create categories"
on public.categories for insert to authenticated
with check (public.host_owns_room(room_id));

create policy "hosts update categories"
on public.categories for update to authenticated
using (public.host_owns_room(room_id))
with check (public.host_owns_room(room_id));

create policy "hosts delete categories"
on public.categories for delete to authenticated
using (public.host_owns_room(room_id));

create policy "hosts read questions"
on public.questions for select to authenticated
using (
  exists (
    select 1 from public.categories
    where categories.id = questions.category_id
      and public.host_owns_room(categories.room_id)
  )
);

create policy "hosts create questions"
on public.questions for insert to authenticated
with check (
  exists (
    select 1 from public.categories
    where categories.id = questions.category_id
      and public.host_owns_room(categories.room_id)
  )
);

create policy "hosts update questions"
on public.questions for update to authenticated
using (
  exists (
    select 1 from public.categories
    where categories.id = questions.category_id
      and public.host_owns_room(categories.room_id)
  )
)
with check (
  exists (
    select 1 from public.categories
    where categories.id = questions.category_id
      and public.host_owns_room(categories.room_id)
  )
);

create policy "hosts delete questions"
on public.questions for delete to authenticated
using (
  exists (
    select 1 from public.categories
    where categories.id = questions.category_id
      and public.host_owns_room(categories.room_id)
  )
);

-- These policies are additive because player ownership is tightened separately in
-- Priority 2. They guarantee that the authenticated host can operate the game.
drop policy if exists "hosts manage players" on public.players;
create policy "hosts manage players"
on public.players for all to authenticated
using (
  exists (
    select 1 from public.teams
    where teams.id = players.team_id
      and public.host_owns_room(teams.room_id)
  )
)
with check (
  exists (
    select 1 from public.teams
    where teams.id = players.team_id
      and public.host_owns_room(teams.room_id)
  )
);

drop policy if exists "hosts manage buzzes" on public.buzzes;
create policy "hosts manage buzzes"
on public.buzzes for all to authenticated
using (
  exists (
    select 1
    from public.questions
    join public.categories on categories.id = questions.category_id
    where questions.id = buzzes.question_id
      and public.host_owns_room(categories.room_id)
  )
)
with check (
  exists (
    select 1
    from public.questions
    join public.categories on categories.id = questions.category_id
    where questions.id = buzzes.question_id
      and public.host_owns_room(categories.room_id)
  )
);

drop policy if exists "hosts manage wagers" on public.wagers;
create policy "hosts manage wagers"
on public.wagers for all to authenticated
using (public.host_owns_room(room_id))
with check (public.host_owns_room(room_id));

-- The public view deliberately excludes the correct response.
create or replace view public.questions_public as
select
  id,
  category_id,
  answer,
  point_value,
  is_answered,
  answered_by_team_id,
  is_double_tap
from public.questions;

revoke all on public.questions from anon;
grant select, insert, update, delete on public.questions to authenticated;
grant select on public.questions_public to anon, authenticated;
grant select, insert, update, delete on public.players, public.buzzes, public.wagers to authenticated;

revoke insert, update, delete on public.rooms from anon;
grant select on public.rooms to anon, authenticated;
grant insert, update, delete on public.rooms to authenticated;

revoke update, delete on public.teams from anon;
grant select, insert on public.teams to anon, authenticated;
grant update, delete on public.teams to authenticated;

revoke insert, update, delete on public.categories from anon;
grant select on public.categories to anon, authenticated;
grant insert, update, delete on public.categories to authenticated;

commit;

-- Approve each host separately after creating them in Supabase Authentication:
-- insert into public.authorized_hosts (user_id, display_name)
-- select id, 'Host name' from auth.users where email = 'host@example.com';
