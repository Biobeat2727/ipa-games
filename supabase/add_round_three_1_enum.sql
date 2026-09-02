-- Round 3 migration — STEP 1 of 2: the enum value.
--
-- Run this file ON ITS OWN, and wait for it to succeed, before running
-- supabase/add_round_three_2_game_logic.sql.
--
-- Why two files: PostgreSQL refuses to use a freshly added enum value inside the
-- transaction that added it —
--     ERROR 55P04: unsafe use of new value "round_3" of enum type room_status
--     HINT: New enum values must be committed before they can be used.
-- The Supabase SQL editor wraps everything you submit in ONE transaction, so the
-- ADD VALUE and the policy/functions that reference 'round_3' cannot share a
-- submission. Running this file as its own query commits the value; step 2 then
-- runs against the committed enum.
--
-- Idempotent: re-running is a no-op.

alter type public.room_status add value if not exists 'round_3' after 'round_2';

-- VERIFY (run after this file, before step 2):
--   select enum_range(null::public.room_status);
--   -- {lobby,round_1,round_2,round_3,final_jeopardy,finished}
