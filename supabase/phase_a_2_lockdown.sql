-- Phase A, step 2 of 2: close the direct player-side table paths.
--
-- Apply BETWEEN GAMES, right after deploying the app build that uses the
-- phase_a_1_functions.sql functions. Phones still on an older cached build can't
-- join, buzz, answer or wager until they update (the app's update prompt).
-- Rollback: phase_a_2_rollback.sql. Verify: phase_a_verify.sql (read-only).
--
-- These policies were created in the Supabase dashboard and never lived in the
-- repo; from here on, the player-side rules are defined by these files.

begin;

-- ── players: phones read; seats change only through join/create/leave_team ──
drop policy if exists "allow_player_self_delete" on public.players;
drop policy if exists "allow_delete"             on public.players;
drop policy if exists "players_insert"           on public.players;
-- kept: "players_select" (public read), "hosts manage players"

-- ── teams: created only through create_team ──
drop policy if exists "players create teams before final" on public.teams;
-- kept: "teams are publicly readable", host update/delete policies

-- ── buzzes: phones read (queue order); writes only through claim_buzz /
--    submit_buzz_response, host writes through its own policy and judge_buzz ──
drop policy if exists "allow_delete"   on public.buzzes;
drop policy if exists "buzzes_insert"  on public.buzzes;
drop policy if exists "buzzes_update"  on public.buzzes;
-- kept: "buzzes_select", "hosts manage buzzes"

-- ── wagers: no phone access at all; phones use submit_final_wager /
--    get_my_final_wager / submit_final_response, the projector final_board ──
drop policy if exists "allow_delete"       on public.wagers;
drop policy if exists "anon_insert_wagers" on public.wagers;
drop policy if exists "wagers_insert"      on public.wagers;
drop policy if exists "anon_select_wagers" on public.wagers;
drop policy if exists "wagers_select"      on public.wagers;
drop policy if exists "wagers_update"      on public.wagers;
drop policy if exists "anon_update_wagers" on public.wagers;
-- kept: "hosts manage wagers"

-- ── Table privileges, so a future dashboard policy can't silently reopen them.
-- Revoked from PUBLIC too (anon inherits it); hosts keep their explicit grants.
revoke insert, update, delete on public.players from public, anon;
revoke insert, update, delete on public.buzzes  from public, anon;
revoke all                    on public.wagers  from public, anon;
revoke insert                 on public.teams   from public, anon;
-- Supabase's default grants also give anon TRUNCATE / TRIGGER / REFERENCES. The
-- API can't use them, but nothing needs them either (added after the first run;
-- re-running this file is safe).
revoke truncate, trigger, references on public.players, public.buzzes, public.teams from public, anon;
grant select on public.players, public.buzzes to anon;
grant select, insert, update, delete on public.players, public.buzzes, public.wagers to authenticated;

-- ── Old phone function signatures (identified by the readable session id only).
-- The key-checked overloads call them internally as the owner, so they keep working.
revoke execute on function public.claim_question_selection(uuid, uuid, uuid, text)            from public, anon, authenticated;
revoke execute on function public.confirm_question_selection(uuid, uuid, uuid, text, integer) from public, anon, authenticated;
revoke execute on function public.submit_final_response(uuid, uuid, text, text)               from public, anon, authenticated;

commit;
