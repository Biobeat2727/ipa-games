-- Round 3 migration — STEP 3 of 3: let categories.round hold the Final Tap row.
--
-- Run after add_round_three_1_enum.sql and add_round_three_2_game_logic.sql.
-- Safe to run on its own submission; idempotent.
--
-- Why: the live database carries a check constraint on categories.round that
-- was created in the Supabase dashboard (it exists in no file in this repo), and
-- it only allowed rounds 1–3 back when round 3 WAS Final Tap. With three regular
-- rounds, new imports store the Final Tap category as round 4
-- (FINAL_TAP_STORAGE_ROUND in src/lib/rounds.ts) and the insert failed with
--     new row for relation "categories" violates check constraint "categories_round_check"
-- The importer now probes for this before deleting a room's content, and points
-- the host at this file.
--
-- Allowed values after this file: 1, 2, 3 (regular boards) and 4 (Final Tap).

begin;

alter table public.categories
  drop constraint if exists categories_round_check;

alter table public.categories
  add constraint categories_round_check
  check (round between 1 and 4);

commit;

-- VERIFY:
--   select pg_get_constraintdef(oid)
--   from pg_constraint
--   where conrelid = 'public.categories'::regclass
--     and conname = 'categories_round_check';
--   -- CHECK (((round >= 1) AND (round <= 4)))
--
-- ROLLBACK (between games, after reverting the frontend and removing any
-- round-4 rows): re-add the constraint with `check (round between 1 and 3)`.
