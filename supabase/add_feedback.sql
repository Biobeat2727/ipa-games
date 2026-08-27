-- Post-game feedback: players send thoughts and bug reports from the results
-- screen instead of having to catch the host in person.
--
-- Anon may INSERT only. There is deliberately no anon SELECT policy: with RLS
-- on and no read policy, players cannot read each other's submissions (or their
-- own back), while the host reads everything from the Supabase dashboard, which
-- uses the service role and bypasses RLS.
--
-- Run this in the Supabase SQL editor. Until it is applied the feedback form
-- shows a "couldn't send" message and nothing else in the game is affected.

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references public.rooms(id) on delete set null,
  team_id uuid references public.teams(id) on delete set null,
  -- Denormalized so a submission survives the room/team rows being cleaned up
  team_name text,
  kind text not null default 'thoughts',
  message text not null,
  created_at timestamptz not null default now()
);

alter table public.feedback enable row level security;

drop policy if exists "anyone can send feedback" on public.feedback;

create policy "anyone can send feedback"
on public.feedback for insert to anon, authenticated
with check (
  -- Guard against junk/abuse: a real message, and nothing large enough to be a
  -- payload dump. Length is enforced in the database, not just the UI.
  char_length(message) between 1 and 2000
  and char_length(coalesce(team_name, '')) <= 100
  and kind in ('thoughts', 'bug')
);

-- Host reads submissions newest first:
--   select created_at, kind, team_name, message from public.feedback order by created_at desc;
create index if not exists feedback_created_at_idx on public.feedback (created_at desc);
