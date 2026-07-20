-- One canonical buzz per team/question and one Final Tap wager per team/room.
-- Existing beta duplicates are reduced to the earliest server-recorded action
-- before the unique indexes are installed.

begin;

with ranked_buzzes as (
  select
    id,
    row_number() over (
      partition by question_id, team_id
      order by buzzed_at asc, id asc
    ) as duplicate_rank
  from public.buzzes
)
delete from public.buzzes
where id in (
  select id from ranked_buzzes where duplicate_rank > 1
);

create unique index if not exists buzzes_one_per_team_question
on public.buzzes (question_id, team_id);

with ranked_wagers as (
  select
    id,
    row_number() over (
      partition by room_id, team_id
      order by submitted_at asc nulls last, id asc
    ) as duplicate_rank
  from public.wagers
)
delete from public.wagers
where id in (
  select id from ranked_wagers where duplicate_rank > 1
);

create unique index if not exists wagers_one_per_team_room
on public.wagers (room_id, team_id);

commit;
