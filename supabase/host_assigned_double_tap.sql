-- Host-assigned Double Taps.
-- When the host assigns a Double Tap to a team, the pending selection is
-- claimed with pending_selection_session_id = NULL (no clicking device).
-- Every phone on that team then shows the wager screen; the first submit
-- must win atomically and stamp its session as the selection's owner.
-- Supersedes confirm_question_selection from atomic_question_selection.sql
-- (that file has been updated to match for fresh installs).
-- Run in the Supabase SQL editor, after atomic_question_selection.sql (which
-- defines the shared regular_round_number / double_tap_floor helpers).

begin;

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
          -- Rounds 1 / 2 / 3 → 1000 / 2000 / 3000, same table as the phones
          public.double_tap_floor(public.regular_round_number(r.status))
        )
    );

  return found;
end;
$$;

revoke all on function public.confirm_question_selection(uuid, uuid, uuid, text, integer) from public;
grant execute on function public.confirm_question_selection(uuid, uuid, uuid, text, integer) to anon, authenticated;

commit;
