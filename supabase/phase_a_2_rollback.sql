-- Rollback for phase_a_2_lockdown.sql: restores the player-side policies,
-- privileges and old function grants exactly as they were on 2026-10-24
-- (from the pg_policies listing). Only for an emergency between games; it
-- reopens every gap in docs/host-moderation-plan.md. phase_a_1_functions.sql
-- stays in place either way, so the new app keeps working after a rollback.

begin;

-- players
create policy "allow_player_self_delete" on public.players for delete to public using (true);
create policy "allow_delete"             on public.players for delete to public using (true);
create policy "players_insert"           on public.players for insert to public with check (true);

-- teams
create policy "players create teams before final" on public.teams for insert to anon, authenticated
with check (
  exists (
    select 1 from public.rooms
    where rooms.id = teams.room_id
      and rooms.status = any (array['lobby'::public.room_status, 'round_1'::public.room_status,
                                    'round_2'::public.room_status, 'round_3'::public.room_status])
  )
);

-- buzzes
create policy "allow_delete"  on public.buzzes for delete to public using (true);
create policy "buzzes_insert" on public.buzzes for insert to public with check (true);
create policy "buzzes_update" on public.buzzes for update to public using (true);

-- wagers
create policy "allow_delete"       on public.wagers for delete to public using (true);
create policy "anon_insert_wagers" on public.wagers for insert to anon   with check (true);
create policy "wagers_insert"      on public.wagers for insert to public with check (true);
create policy "anon_select_wagers" on public.wagers for select to anon   using (true);
create policy "wagers_select"      on public.wagers for select to public using (true);
create policy "wagers_update"      on public.wagers for update to public using (true);
create policy "anon_update_wagers" on public.wagers for update to anon   using (true);

-- privileges (wager UPDATE stays revoked, as server_authoritative_final_responses.sql left it)
grant select, insert, delete         on public.players to anon;
grant select, insert, update, delete on public.buzzes  to anon;
grant select, insert, delete         on public.wagers  to anon;
grant insert                         on public.teams   to anon;

-- old function signatures
grant execute on function public.claim_question_selection(uuid, uuid, uuid, text)            to anon, authenticated;
grant execute on function public.confirm_question_selection(uuid, uuid, uuid, text, integer) to anon, authenticated;
grant execute on function public.submit_final_response(uuid, uuid, text, text)               to anon, authenticated;

commit;
